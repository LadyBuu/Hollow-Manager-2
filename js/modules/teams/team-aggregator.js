/**
 * modules/teams/team-aggregator.js - Team Aggregator
 * Team's integration boundary with external domains.
 *
 * Path: js/modules/teams/team-aggregator.js
 *
 * Projections that compose TeamQueries, CharacterQueries,
 * AcademyClasses, AcademyAggregator, and MissionQueries into
 * Team-shaped view models.
 *
 * IMPORTANT:
 *   - Projection builder, not a query registry.
 *   - Composes query modules; never walks raw storage.
 *   - Returns Team-shaped view models. No raw domain entities
 *     escape.
 *   - Never mutates data. No UI dependencies. No passthrough
 *     methods.
 *
 * EXCEPTION — MATCHMAKING HISTORY:
 *   getTeamMatchmakingViewModel performs ONE direct walk of
 *   window.data.teams. The walk is deliberate: the matchmaking
 *   modal needs a per-character "professional-team years" map for
 *   the whole candidate pool, and there is no query that produces
 *   it. Adding one would put a matchmaking-specific read on the
 *   canonical query surface. The aggregator owns the projection,
 *   so the walk lives here, is documented, and is the ONLY direct
 *   team-store walk in this file.
 *
 * PERIOD SEMANTICS:
 *   - Periods are REQUIRED. No fallback to 1.
 *   - An invalid period produces an empty list or a null selected
 *     team; the aggregator does not invent a period.
 *   - Callers that want the current application year read it from
 *     window.data.currentYear and pass it in.
 *
 * STATUS SEMANTICS:
 *   - Operational status is owned by TeamQueries. This module does
 *     not reimplement the predicate.
 *
 * MEMBER INTERVALS MODEL:
 *   A team member entry carries an `intervals` array:
 *
 *     {
 *       memberId,
 *       characterId,
 *       role,
 *       intervals: [{ joinPeriod, leavePeriod }, ...]
 *     }
 *
 *   Interval containment is owned by TeamQueries.intervalContains.
 *   This module does not reimplement it.
 *
 * MEMBER-MODAL CANDIDATE SEMANTICS:
 *   FILTER:
 *     - EXCLUDE current members of this team (any period).
 *     - EXCLUDE civilians. Instructors are never excluded as
 *       civilians, even if their status string reads 'civilian'.
 *     - EXCLUDE characters eliminated as of the resolution year.
 *       When EliminationQueries is unavailable, this filter is
 *       skipped rather than failing closed.
 *     - INCLUDE instructors, support, other-class students, and
 *       deceased characters.
 *     - Class membership is NOT a filter.
 *
 *   SORT (four tiers, alphabetical within each tier):
 *     Tier 0: in class,   not on another team of this type
 *     Tier 1: in class,       on another team of this type
 *     Tier 2: other class, not on another team of this type
 *     Tier 3: other class,     on another team of this type
 *
 *     "Another team of this type" is scoped to the team's own type
 *     at the requested period. A character on an academic team is
 *     NOT counted as assigned for a professional team.
 *
 *     Deceased status does not affect the tier.
 *
 * MATCHMAKING CANDIDATE SEMANTICS:
 *   FILTER:
 *     - EXCLUDE deceased characters (as of the target year).
 *     - EXCLUDE characters not eligible for a professional team
 *       at the target year. Eligibility is the composed predicate
 *       CharacterQueries.isProfessionallyEligiblePhaseAtYear:
 *       junior-or-senior AND not-instructor (support is NOT
 *       excluded — a support member in their student phase passes
 *       here; the team-history refinement is applied later).
 *       When the predicate is unavailable, the aggregator falls
 *       back to isJuniorOrSeniorByYear, which skips the phase
 *       check entirely, and logs a one-time warning.
 *     - EXCLUDE characters eliminated at any point, in any year,
 *       by any cause. Presence-based.
 *     - EXCLUDE characters already active on a professional team
 *       at the target year.
 *
 *   SORT:
 *     MILESTONE YEAR ASCENDING, then alphabetically by name.
 *
 *     The milestone is the EARLIEST of whichever of these career
 *     years the character has:
 *       - juniorYear
 *       - seniorYear
 *       - supportYear
 *       - instructorYear
 *
 *     Candidates with no milestone year (no careerStatus entries
 *     at all — a data-quality signal) sort after every candidate
 *     who has one, alphabetically among themselves.
 *
 * JUNIOR-OR-SENIOR STATUS:
 *   The predicate is
 *   CharacterQueries.isJuniorOrSeniorByYear(char, year).
 *   When unavailable, this filter is skipped rather than failing
 *   closed.
 *
 * ELIMINATION IN MATCHMAKING:
 *   The check is presence-based, not year-scoped. When
 *   EliminationQueries is unavailable, this filter is skipped
 *   rather than failing closed.
 *
 * CLASS MEMBERSHIP SIGNAL (v29, migrated v30):
 *   The "in class" tier signal for the member modal reads class
 *   membership from two sources:
 *
 *     1. Students: the class's roster, via
 *        AcademyAggregator.getClassStudentsViewModel.
 *     2. Instructors: AcademyClasses.getClassInstructorIdsAllTime,
 *        which derives the class's instructors from per-discipline
 *        instructor enrolments.
 *
 *   The retired AcademyQueries facade is no longer consulted. The
 *   retired `class.instructorId` field is not consulted.
 *
 * UNASSIGNED VIEW SEMANTICS:
 *   getUnassignedViewModel() reads
 *   TeamQueries.getProfessionalTeamEligibleRoster(currentYear) and
 *   projects it into two disjoint lists:
 *
 *     rows:      candidates — characters who can be placed on a
 *                professional team at the query year. This
 *                includes UNASSIGNED STAFF (the support members
 *                who have a student phase but no team history).
 *     staffRows: staff — the support and instructor characters
 *                at the query year. This includes PURE SUPPORT
 *                and UNASSIGNED STAFF. Retired support is not in
 *                the roster at all — the query has already
 *                excluded them.
 *
 *   The two lists OVERLAP at one subclass: 'support-unassigned'
 *   characters appear in BOTH. They are candidates (the point of
 *   the subclass is that they need placing) and they are staff
 *   (they hold a support role at the query year).
 *
 *   A character that is currently active on a professional team
 *   is excluded from BOTH sections. Being active is a current
 *   fact, not a historical tag.
 *
 *   Both sections carry `ageDisplay` (number as string, or an
 *   em-dash) and the candidate rows in `staffRows` carry
 *   `supportClass` for the subtype tag.
 *
 *   When window.data.currentYear is unavailable, the projection
 *   returns empty lists and a null year. It does NOT invent a
 *   year.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyAggregator           (getClassStudentsViewModel)
 *
 * DEPENDENCIES (LAZY, read at call time):
 *   - window.TeamUI             (filter bar VM defaults)
 *   - window.EliminationQueries (candidate elimination filters)
 *   - window.MissionQueries     (mission options for the team form)
 */

(function() {
    'use strict';

    if (window.__teamAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CharacterQueries = window.CharacterQueries;
    var AcademyClasses = window.AcademyClasses;
    var AcademyAggregator = window.AcademyAggregator;

    var _missing = [];

    if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamQueries || typeof TeamQueries.getTeams !== 'function') {
        _missing.push('TeamQueries.getTeams');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getActiveTeamMembers !== 'function') {
        _missing.push('TeamQueries.getActiveTeamMembers');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getRankingSummary !== 'function') {
        _missing.push('TeamQueries.getRankingSummary');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getSortedRankings !== 'function') {
        _missing.push('TeamQueries.getSortedRankings');
    }
    if (!TeamQueries ||
        typeof TeamQueries.isTeamOperational !== 'function') {
        _missing.push('TeamQueries.isTeamOperational');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
        _missing.push('TeamQueries.getTeamName');
    }
    if (!TeamQueries ||
        typeof TeamQueries.intervalContains !== 'function') {
        _missing.push('TeamQueries.intervalContains');
    }
    if (!TeamQueries ||
        typeof TeamQueries.teamWindowContains !== 'function') {
        _missing.push('TeamQueries.teamWindowContains');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getAllTeamMemberRecords !== 'function') {
        _missing.push('TeamQueries.getAllTeamMemberRecords');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getProfessionalTeamEligibleRoster !==
            'function') {
        _missing.push('TeamQueries.getProfessionalTeamEligibleRoster');
    }

    if (!TeamConstants ||
        typeof TeamConstants.getPeriodRange !== 'function') {
        _missing.push('TeamConstants.getPeriodRange');
    }
    if (!TeamConstants ||
        typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
    }
    if (!TeamConstants ||
        typeof TeamConstants.getTypeLabel !== 'function') {
        _missing.push('TeamConstants.getTypeLabel');
    }
    if (!TeamConstants ||
        typeof TeamConstants.getPeriodLabel !== 'function') {
        _missing.push('TeamConstants.getPeriodLabel');
    }
    if (!TeamConstants ||
        typeof TeamConstants.normalizeTeamType !== 'function') {
        _missing.push('TeamConstants.normalizeTeamType');
    }

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCurrentStatus !== 'function') {
        _missing.push('CharacterQueries.getCurrentStatus');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterAge !== 'function') {
        _missing.push('CharacterQueries.getCharacterAge');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.isInstructor !== 'function') {
        _missing.push('CharacterQueries.isInstructor');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.isDeceased !== 'function') {
        _missing.push('CharacterQueries.isDeceased');
    }

    if (!AcademyClasses ||
        typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClasses !== 'function') {
        _missing.push('AcademyClasses.getClasses');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getDisplayName !== 'function') {
        _missing.push('AcademyClasses.getDisplayName');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClassInstructorIdsAllTime !==
            'function') {
        _missing.push('AcademyClasses.getClassInstructorIdsAllTime');
    }

    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassStudentsViewModel !==
            'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__teamAggregatorLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getTeamUI() {
        return window.TeamUI || null;
    }

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    function getMissionQueries() {
        return window.MissionQueries || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function buildCharacterSummary(charId) {
        if (!isNonEmptyString(charId)) {
            return {
                characterId: charId || null,
                displayName: 'Unknown',
                status: '',
                age: '',
                deceased: false
            };
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return {
                characterId: charId,
                displayName: 'Unknown',
                status: '',
                age: '',
                deceased: false
            };
        }

        return {
            characterId: charId,
            displayName: CharacterQueries.getDisplayName(char),
            status: CharacterQueries.getCurrentStatus(char),
            age: CharacterQueries.getCharacterAge(char),
            deceased: char.deceased === true
        };
    }

    function getClassDisplayName(classId) {
        if (!isNonEmptyString(classId)) {
            return '';
        }
        var name = AcademyClasses.getDisplayName(classId);
        if (!name || name === 'Unknown Class') {
            return '';
        }
        return name;
    }

    function getTypeLabel(type) {
        return TeamConstants.getTypeLabel(type);
    }

    function getPeriodLabel(type) {
        return TeamConstants.getPeriodLabel(type);
    }

    /**
     * Build the set of character IDs that belong to the class, for
     * the member-modal "in class" tier signal.
     */
    function buildClassMembershipSet(classId) {
        var result = Object.create(null);
        if (!isNonEmptyString(classId)) {
            return result;
        }

        var students = [];
        try {
            students =
                AcademyAggregator.getClassStudentsViewModel(
                    classId, null
                ) || [];
        } catch (e) {
            students = [];
        }
        if (Array.isArray(students)) {
            for (var s = 0; s < students.length; s++) {
                var st = students[s];
                if (st && st.id) {
                    result[String(st.id)] = true;
                }
            }
        }

        var instructorIds = [];
        try {
            instructorIds =
                AcademyClasses.getClassInstructorIdsAllTime(
                    classId
                );
        } catch (e) {
            instructorIds = [];
        }
        if (Array.isArray(instructorIds)) {
            for (var i = 0; i < instructorIds.length; i++) {
                if (instructorIds[i]) {
                    result[String(instructorIds[i])] = true;
                }
            }
        }

        return result;
    }

    // ============================================================
    // PERIOD DISPLAY
    // ============================================================

    function getTeamPeriodDisplay(team) {
        if (!team || typeof team !== 'object') {
            return '-';
        }

        var normalizedType = TeamConstants.normalizeTeamType(team.type);
        var start = team.startPeriod || '';
        var end = team.endPeriod || '';

        if (normalizedType === 'academic') {
            if (start && end) {
                return 'Wk ' + start + ' - Wk ' + end;
            }
            if (start) {
                return 'From Wk ' + start;
            }
            if (end) {
                return 'Until Wk ' + end;
            }
            return '-';
        }

        if (start && end) {
            return start + ' - ' + end;
        }
        if (start) {
            return 'From ' + start;
        }
        if (end) {
            return 'Until ' + end;
        }
        return '-';
    }

    function getRankingHistoryDisplay(team) {
        var summary = TeamQueries.getRankingSummary(team);
        if (!summary || summary.total === 0) {
            return 'No ranking history';
        }

        var parts = [];
        for (var i = 0; i < summary.history.length; i++) {
            var entry = summary.history[i];
            parts.push(entry.period + ': #' + entry.rank);
        }

        return parts.join(' \u2192 ');
    }

    // ============================================================
    // MEMBER VM
    // ============================================================

    function buildMemberVM(member, periodNum) {
        if (!member || typeof member !== 'object') {
            return null;
        }

        var charId = member.characterId;
        if (!charId) {
            return null;
        }

        var summary = buildCharacterSummary(charId);

        var intervalsVM = [];
        var firstJoin = '';
        var firstLeave = '';
        var anyActive = false;

        if (Array.isArray(member.intervals)) {
            for (var i = 0; i < member.intervals.length; i++) {
                var iv = member.intervals[i];
                if (!iv || typeof iv !== 'object') {
                    continue;
                }

                var ivJoin = (iv.joinPeriod !== undefined &&
                              iv.joinPeriod !== null)
                    ? String(iv.joinPeriod)
                    : '';
                var ivLeave = (iv.leavePeriod !== undefined &&
                               iv.leavePeriod !== null)
                    ? String(iv.leavePeriod)
                    : '';

                var active = false;
                if (periodNum !== null) {
                    active = TeamQueries.intervalContains(
                        iv, periodNum
                    );
                }

                if (i === 0) {
                    firstJoin = ivJoin;
                    firstLeave = ivLeave;
                }

                if (active) {
                    anyActive = true;
                }

                intervalsVM.push({
                    joinPeriod: ivJoin,
                    leavePeriod: ivLeave,
                    activeAtPeriod: active
                });
            }
        }

        return {
            characterId: charId,
            memberId: isNonEmptyString(member.memberId)
                ? String(member.memberId)
                : '',
            displayName: summary.displayName,
            status: summary.status,
            age: summary.age,
            deceased: summary.deceased,
            role: member.role || 'Member',
            intervals: intervalsVM,
            joinPeriod: firstJoin,
            leavePeriod: firstLeave,
            activeAtPeriod: anyActive
        };
    }

    // ============================================================
    // TEAM DETAIL VIEW MODEL
    // ============================================================

    function getTeamViewModel(teamId, options) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }

        options = options || {};
        var periodNum = TeamConstants.parsePeriod(options.period);
        var includeMembers = options.includeMembers !== false;
        var includeRankings = options.includeRankings !== false;
        var includeClass = options.includeClass !== false;

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }

        var typeLabel = getTypeLabel(team.type);
        var periodLabel = getPeriodLabel(team.type);

        var classDisplay = '';
        if (includeClass && team.classId) {
            classDisplay = getClassDisplayName(team.classId);
        }

        var rankingSummary = TeamQueries.getRankingSummary(team);
        var periodDisplay = getTeamPeriodDisplay(team);

        var viewModel = {
            id: team.id,
            name: team.name,
            type: team.type,
            typeLabel: typeLabel,
            periodLabel: periodLabel,
            startPeriod: team.startPeriod || '',
            endPeriod: team.endPeriod || '',
            periodDisplay: periodDisplay,
            status: team.status || 'active',
            classId: team.classId || null,
            classDisplay: classDisplay,
            teamNumber: team.teamNumber || '',
            temporaryMission: team.temporaryMission || null,
            nameHistory: Array.isArray(team.nameHistory)
                ? team.nameHistory.slice()
                : [],
            memberCount: team.members ? team.members.length : 0,
            isActive: team.status === 'active',
            isOperational: TeamQueries.isTeamOperational(team),
            createdAt: team.createdAt || ''
        };

        if (includeMembers) {
            if (periodNum !== null) {
                var activeMembers =
                    TeamQueries.getActiveTeamMembers(
                        team,
                        periodNum
                    );
                var memberVMs = [];
                for (var i = 0; i < activeMembers.length; i++) {
                    var vm = buildMemberVM(
                        activeMembers[i], periodNum
                    );
                    if (vm) {
                        memberVMs.push(vm);
                    }
                }
                viewModel.members = memberVMs;
                viewModel.activeMemberCount = memberVMs.length;
                viewModel.totalMemberCount = team.members
                    ? team.members.length
                    : 0;
            } else {
                viewModel.members = [];
                viewModel.activeMemberCount = 0;
                viewModel.totalMemberCount = team.members
                    ? team.members.length
                    : 0;
            }
        }

        if (includeRankings) {
            viewModel.rankingHistory = rankingSummary.history;
            viewModel.rankingCount = rankingSummary.total;
            viewModel.currentRank = rankingSummary.current;
            viewModel.mostRecentRanking =
                rankingSummary.mostRecent;
        }

        return viewModel;
    }

    // ============================================================
    // TEAM LIST VIEW MODEL
    // ============================================================

    function getTeamListViewModel(options) {
        options = options || {};
        var type = options.type || null;
        var status = options.status || null;
        var periodNum = TeamConstants.parsePeriod(options.period);
        var includeInactive = options.includeInactive || false;
        var search = options.search || '';
        var sort = options.sort || 'name';
        var sortDirection = options.sortDirection || 'asc';

        var teams = TeamQueries.getTeams(
            type, status, includeInactive
        );

        if (search) {
            var lowerSearch = search.toLowerCase();
            teams = teams.filter(function(team) {
                return team.name &&
                    team.name.toLowerCase().indexOf(lowerSearch) !==
                        -1;
            });
        }

        var listItems = teams.map(function(team) {
            var activeMemberCount = 0;
            if (periodNum !== null) {
                activeMemberCount =
                    TeamQueries.getActiveTeamMemberCount(
                        team, periodNum
                    );
            }

            var rankingSummary =
                TeamQueries.getRankingSummary(team);
            var typeLabel = getTypeLabel(team.type);
            var classDisplay = team.classId
                ? getClassDisplayName(team.classId)
                : '';

            return {
                id: team.id,
                name: team.name,
                type: team.type,
                typeLabel: typeLabel,
                status: team.status || 'active',
                currentRank: rankingSummary.current || '',
                activeMemberCount: activeMemberCount,
                totalMemberCount: team.members
                    ? team.members.length
                    : 0,
                periodDisplay: getTeamPeriodDisplay(team),
                isActive: team.status === 'active',
                isOperational: TeamQueries.isTeamOperational(team),
                classDisplay: classDisplay,
                teamNumber: team.teamNumber || '',
                temporaryMission: team.temporaryMission || null,
                createdAt: team.createdAt || ''
            };
        });

        var total = listItems.length;

        listItems.sort(function(a, b) {
            var aVal, bVal;

            switch (sort) {
                case 'name':
                    aVal = a.name || '';
                    bVal = b.name || '';
                    break;
                case 'type':
                    aVal = a.typeLabel || '';
                    bVal = b.typeLabel || '';
                    break;
                case 'rank':
                    aVal = parseInt(a.currentRank, 10) || 999;
                    bVal = parseInt(b.currentRank, 10) || 999;
                    break;
                case 'members':
                    aVal = a.activeMemberCount;
                    bVal = b.activeMemberCount;
                    break;
                case 'status':
                    aVal = a.isActive ? 0 : 1;
                    bVal = b.isActive ? 0 : 1;
                    break;
                default:
                    aVal = a.name || '';
                    bVal = b.name || '';
            }

            if (typeof aVal === 'string') {
                var result = aVal.localeCompare(bVal);
                return sortDirection === 'desc' ? -result : result;
            }

            if (aVal < bVal) {
                return sortDirection === 'desc' ? 1 : -1;
            }
            if (aVal > bVal) {
                return sortDirection === 'desc' ? -1 : 1;
            }
            return 0;
        });

        return {
            teams: listItems,
            total: total,
            filtered: listItems.length
        };
    }

    // ============================================================
    // TEAM MEMBERS VIEW MODEL
    // ============================================================

    function getTeamMembersViewModel(teamId, period) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }

        var periodNum = TeamConstants.parsePeriod(period);
        if (periodNum === null) {
            return null;
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }

        var typeLabel = getTypeLabel(team.type);
        var periodLabel = getPeriodLabel(team.type);

        var activeMembers = TeamQueries.getActiveTeamMembers(
            team,
            periodNum
        );

        var activeIds = Object.create(null);
        for (var i = 0; i < activeMembers.length; i++) {
            activeIds[String(activeMembers[i].characterId)] = true;
        }

        var allMembers = Array.isArray(team.members)
            ? team.members
            : [];

        var memberViewModels = [];
        for (var j = 0; j < allMembers.length; j++) {
            var vm = buildMemberVM(allMembers[j], periodNum);
            if (!vm) {
                continue;
            }
            vm.activeAtPeriod =
                activeIds[String(vm.characterId)] === true;
            memberViewModels.push(vm);
        }

        memberViewModels.sort(function(a, b) {
            if (a.activeAtPeriod !== b.activeAtPeriod) {
                return a.activeAtPeriod ? -1 : 1;
            }
            return a.displayName.localeCompare(b.displayName);
        });

        return {
            teamId: team.id,
            teamName: team.name,
            teamType: team.type,
            typeLabel: typeLabel,
            period: periodNum,
            periodLabel: periodLabel,
            activeCount: activeMembers.length,
            totalCount: allMembers.length,
            members: memberViewModels
        };
    }

    // ============================================================
    // TEAM PAGE VIEW MODEL
    // ============================================================

    function getTeamPageViewModel(options) {
        options = options || {};
        var type = options.type || 'professional';
        var status = options.status || null;
        var periodNum = TeamConstants.parsePeriod(options.period);
        var expandedTeamId = options.expandedTeamId || null;
        var search = options.search || '';

        var listVM = getTeamListViewModel({
            type: type,
            status: status,
            period: periodNum !== null ? periodNum : undefined,
            search: search
        });

        var expandedTeam = null;
        var resolvedExpandedId = null;

        if (expandedTeamId) {
            for (var i = 0; i < listVM.teams.length; i++) {
                if (String(listVM.teams[i].id) ===
                    String(expandedTeamId)) {
                    resolvedExpandedId = listVM.teams[i].id;
                    break;
                }
            }

            if (resolvedExpandedId) {
                expandedTeam = getTeamViewModel(
                    resolvedExpandedId,
                    {
                        period: periodNum !== null
                            ? periodNum
                            : undefined,
                        includeMembers: true,
                        includeRankings: true
                    }
                );
            }
        }

        var countProfessional = countTeamsByType('professional');
        var countTemporary = countTeamsByType('temporary');
        var countCivilian = countTeamsByType('civilian');

        return {
            activeTab: type,
            period: periodNum,
            teams: listVM.teams,
            totalTeams: listVM.total,
            filteredTeams: listVM.filtered,
            expandedTeam: expandedTeam,
            expandedTeamId: resolvedExpandedId,
            counts: {
                professional: countProfessional,
                temporary: countTemporary,
                civilian: countCivilian
            },
            types: {
                professional: {
                    label: getTypeLabel('professional'),
                    periodLabel: getPeriodLabel('professional')
                },
                temporary: {
                    label: getTypeLabel('temporary'),
                    periodLabel: getPeriodLabel('temporary')
                },
                civilian: {
                    label: getTypeLabel('civilian'),
                    periodLabel: getPeriodLabel('civilian')
                }
            }
        };
    }

    function countTeamsByType(type) {
        var teams = TeamQueries.getTeams(
            type, 'operational', false
        );
        return teams.length;
    }

    // ============================================================
    // FORM / MODAL VIEW MODELS
    // ============================================================

    function getTeamFormViewModel(teamId) {
        var team = null;
        if (isNonEmptyString(teamId)) {
            team = TeamQueries.getTeamById(teamId);
        }

        var isEdit = !!team;
        var t = team || {};

        var classOptions = [];
        var classes = AcademyClasses.getClasses() || [];
        for (var i = 0; i < classes.length; i++) {
            if (classes[i] && classes[i].id) {
                classOptions.push({
                    id: classes[i].id,
                    name: classes[i].name || 'Unnamed Class'
                });
            }
        }

        return {
            isEdit: isEdit,
            teamId: t.id || null,
            name: t.name || '',
            type: t.type || 'professional',
            startPeriod: t.startPeriod || '',
            endPeriod: t.endPeriod || '',
            status: t.status || 'active',
            classId: t.classId || '',
            teamNumber: t.teamNumber || '',
            temporaryMission: t.temporaryMission || '',
            currentRank: TeamQueries.getCurrentRank(team),
            nameHistory: Array.isArray(t.nameHistory)
                ? t.nameHistory.slice()
                : [],
            classOptions: classOptions,
            missionOptions: getMissionOptions()
        };
    }

    function getMissionOptions() {
        var MQ = getMissionQueries();
        if (!MQ || typeof MQ.getMissions !== 'function') {
            return [];
        }

        var missions;
        try {
            missions = MQ.getMissions(
                null, { includeArchived: false }
            ) || [];
        } catch (e) {
            console.warn(
                '[TeamAggregator] getMissions failed:', e
            );
            return [];
        }

        var options = [];
        for (var i = 0; i < missions.length; i++) {
            var mission = missions[i];
            if (!mission || !mission.id) {
                continue;
            }
            if (mission.status === 'cancelled') {
                continue;
            }
            options.push({
                id: mission.id,
                title: mission.title || 'Untitled',
                status: mission.status || 'active'
            });
        }

        options.sort(function(a, b) {
            if (a.status === 'active' && b.status !== 'active') {
                return -1;
            }
            if (a.status !== 'active' && b.status === 'active') {
                return 1;
            }
            return a.title.localeCompare(b.title);
        });

        return options;
    }

    // ============================================================
    // MEMBER MODAL VIEW MODEL
    // ============================================================

    function getMemberModalViewModel(teamId, period) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }

        var periodNum = TeamConstants.parsePeriod(period);

        var membersVM = getTeamMembersViewModel(teamId, periodNum);

        var currentIds = Object.create(null);
        if (Array.isArray(team.members)) {
            for (var i = 0; i < team.members.length; i++) {
                var m = team.members[i];
                if (m && m.characterId) {
                    currentIds[String(m.characterId)] = true;
                }
            }
        }

        var teamClassId = isNonEmptyString(team.classId)
            ? String(team.classId)
            : null;

        var inClassSet = buildClassMembershipSet(teamClassId);

        var onAnotherTeamSet = Object.create(null);
        if (periodNum !== null && isNonEmptyString(team.type)) {
            var normalizedType =
                TeamConstants.normalizeTeamType(team.type);
            if (normalizedType !== null) {
                var allTeams = TeamQueries.getTeams(
                    normalizedType,
                    null,
                    true
                );
                if (Array.isArray(allTeams)) {
                    for (var t = 0; t < allTeams.length; t++) {
                        var sibling = allTeams[t];
                        if (!sibling ||
                            String(sibling.id) ===
                                String(team.id)) {
                            continue;
                        }
                        var siblingMembers =
                            TeamQueries.getActiveTeamMembers(
                                sibling,
                                periodNum
                            );
                        for (var sm = 0;
                             sm < siblingMembers.length;
                             sm++) {
                            var member = siblingMembers[sm];
                            if (member && member.characterId) {
                                onAnotherTeamSet[
                                    String(member.characterId)
                                ] = true;
                            }
                        }
                    }
                }
            }
        }

        var EQ = getEliminationQueries();
        var canCheckElimination = EQ &&
            typeof EQ.isCharacterEliminatedByYear === 'function';

        var eliminationYear = null;
        if (canCheckElimination) {
            var data = window.data || {};
            if (typeof data.currentYear === 'number' &&
                isFinite(data.currentYear) &&
                data.currentYear > 0) {
                eliminationYear = Math.floor(data.currentYear);
            } else {
                var startPeriodNum = TeamConstants.parsePeriod(
                    team.startPeriod
                );
                if (startPeriodNum !== null) {
                    eliminationYear = startPeriodNum;
                }
            }
        }

        var allChars = CharacterQueries.getCharacters() || [];
        var candidates = [];

        for (var c = 0; c < allChars.length; c++) {
            var char = allChars[c];
            if (!char || !char.id) {
                continue;
            }

            var charId = String(char.id);

            if (currentIds[charId]) {
                continue;
            }

            if (CharacterQueries.isInstructor(char) !== true) {
                var isCivilian = false;
                if (typeof CharacterQueries.isCivilian ===
                    'function') {
                    isCivilian =
                        CharacterQueries.isCivilian(char) === true;
                } else {
                    var statusStr =
                        CharacterQueries.getCurrentStatus(char);
                    isCivilian =
                        String(statusStr).toLowerCase() ===
                            'civilian';
                }
                if (isCivilian) {
                    continue;
                }
            }

            if (canCheckElimination && eliminationYear !== null) {
                var eliminated = false;
                try {
                    eliminated = EQ.isCharacterEliminatedByYear(
                        charId,
                        eliminationYear
                    ) === true;
                } catch (e) {
                    eliminated = false;
                }
                if (eliminated) {
                    continue;
                }
            }

            candidates.push({
                id: char.id,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char),
                deceased: char.deceased === true,
                inClass: inClassSet[charId] === true,
                onAnotherTeam:
                    onAnotherTeamSet[charId] === true
            });
        }

        candidates.sort(function(a, b) {
            var tierA = candidateTier(a);
            var tierB = candidateTier(b);
            if (tierA !== tierB) {
                return tierA - tierB;
            }
            return a.name.localeCompare(b.name);
        });

        return {
            teamId: team.id,
            teamName: team.name,
            teamClassId: teamClassId,
            period: membersVM ? membersVM.period : null,
            members: membersVM ? membersVM.members : [],
            candidates: candidates
        };
    }

    function candidateTier(candidate) {
        if (candidate.inClass) {
            return candidate.onAnotherTeam ? 1 : 0;
        }
        return candidate.onAnotherTeam ? 3 : 2;
    }

    function getRankingModalViewModel(teamId) {
        if (!isNonEmptyString(teamId)) {
            return null;
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }

        var summary = TeamQueries.getRankingSummary(team);

        return {
            teamId: team.id,
            teamName: team.name,
            currentRank: summary.current || '',
            history: summary.history,
            historyCount: summary.total,
            historyDisplay: getRankingHistoryDisplay(team)
        };
    }

    function getFilterBarViewModel(tab) {
        var normalized =
            TeamConstants.normalizeTeamType(tab) || 'professional';
        var UI = getTeamUI();

        var filter = (UI && typeof UI.getFilter === 'function')
            ? UI.getFilter(normalized)
            : {};

        return {
            tab: normalized,
            typeLabel: getTypeLabel(normalized),
            periodLabel: getPeriodLabel(normalized),
            filterYear: filter.filterYear || '',
            filterStatus: filter.filterStatus || 'active'
        };
    }

    // ============================================================
    // UNASSIGNED VIEW MODEL
    // ============================================================
    //
    // The two sections are DISJOINT except for one case.
    //
    //   rows:      candidates. Characters that can be placed on a
    //              professional team at the query year. Includes
    //              'support-unassigned' staff (support members
    //              with a student phase and no team history).
    //   staffRows: staff. Characters that hold a support or
    //              instructor role at the query year. Includes
    //              'support-pure' and 'support-unassigned'.
    //
    // The overlap is 'support-unassigned'. Those characters appear
    // in both lists. Pure support appears only in staffRows.
    // Retired support is not in the roster at all.
    //
    // A character currently active on a professional team is
    // excluded from both sections.
    //
    // Both sections inherit the roster's milestone sort. The
    // aggregator does not re-sort.

    function getUnassignedViewModel() {
        var currentYear = null;
        if (window.data &&
            typeof window.data.currentYear === 'number' &&
            isFinite(window.data.currentYear) &&
            window.data.currentYear > 0) {
            currentYear = Math.floor(window.data.currentYear);
        }

        if (currentYear === null) {
            return {
                year: null,
                rows: [],
                total: 0,
                staffRows: [],
                staffTotal: 0
            };
        }

        var roster = [];
        try {
            roster = TeamQueries.getProfessionalTeamEligibleRoster(
                currentYear
            ) || [];
        } catch (e) {
            console.warn(
                '[TeamAggregator] getProfessionalTeamEligibleRoster ' +
                'failed:', e
            );
            roster = [];
        }

        var rows = [];
        var staffRows = [];

        for (var i = 0; i < roster.length; i++) {
            var r = roster[i];
            if (!r) { continue; }

            // ---- Active exclusion ----
            //
            // A character currently active on a professional team
            // is not unassigned. Excluded from BOTH sections.
            if (r.classification === 'active') { continue; }

            // ---- Candidate row ----
            //
            // Every remaining roster character lands in the
            // candidate list. This includes:
            //   - normal students (supportClass: 'none')
            //   - unassigned staff (supportClass: 'support-unassigned')
            //
            // Retired support was already filtered out by the
            // roster query. Pure support never reached the roster
            // (no junior/senior year).
            var juniorDisplay = r.juniorYear !== null &&
                                r.juniorYear !== undefined
                ? String(r.juniorYear)
                : '\u2014';

            var seniorDisplay = r.seniorYear !== null &&
                                r.seniorYear !== undefined
                ? String(r.seniorYear)
                : '\u2014';

            var futureDisplay = '';
            if (r.futureTeamName && r.futureJoinYear !== null &&
                r.futureJoinYear !== undefined) {
                futureDisplay = r.futureTeamName +
                    ' from ' + String(r.futureJoinYear);
            }

            rows.push({
                characterId: r.characterId,
                displayName: r.name || 'Unknown',
                status: r.status || '',
                ageDisplay: r.ageDisplay || '\u2014',
                juniorDisplay: juniorDisplay,
                seniorDisplay: seniorDisplay,
                classification: r.classification,
                futureDisplay: futureDisplay,
                futureTeamName: r.futureTeamName || null,
                futureJoinYear: r.futureJoinYear !== null &&
                                r.futureJoinYear !== undefined
                    ? r.futureJoinYear
                    : null,

                // Staff subtype. 'none' for normal students,
                // 'support-unassigned' for the staff who are also
                // candidates. The renderer shows a small tag for
                // non-'none' values so the user can see which rows
                // are staff members needing placement.
                supportClass: r.supportClass || 'none'
            });

            // ---- Staff row (additive) ----
            //
            // A character with a staff tag appears a SECOND time
            // in the staff section. The two rows answer different
            // questions:
            //   - candidate row: "can this character be placed?"
            //   - staff row:     "what is this character's staff
            //                     role?"
            if (r.staffRole) {
                staffRows.push({
                    characterId: r.characterId,
                    displayName: r.name || 'Unknown',
                    status: r.status || '',
                    ageDisplay: r.ageDisplay || '\u2014',
                    staffRole: r.staffRole,
                    staffSince: r.staffSince !== null &&
                                r.staffSince !== undefined
                        ? r.staffSince
                        : null,
                    staffSinceDisplay: r.staffSince !== null &&
                                        r.staffSince !== undefined
                        ? String(r.staffSince)
                        : '\u2014',
                    supportClass: r.supportClass || 'none',
                    classification: r.classification,
                    teamName: r.formerTeamName ||
                              r.activeTeamName ||
                              null
                });
            }
        }

        return {
            year: currentYear,
            rows: rows,
            total: rows.length,
            staffRows: staffRows,
            staffTotal: staffRows.length
        };
    }

    // ============================================================
    // MATCHMAKING VIEW MODEL
    // ============================================================

    function getTeamMatchmakingViewModel(year, targetSize) {
        var yearNum = TeamConstants.parsePeriod(year);
        var targetSizeNum = TeamConstants.parsePeriod(targetSize);

        if (yearNum === null || targetSizeNum === null) {
            return {
                year: null,
                targetSize: null,
                candidates: [],
                targets: []
            };
        }

        // ---- Availability predicate selection ----
        var canCheckEligibility =
            typeof CharacterQueries
                .isProfessionallyEligiblePhaseAtYear === 'function';

        var canCheckJuniorOrSenior =
            typeof CharacterQueries.isJuniorOrSeniorByYear ===
                'function';

        if (!canCheckEligibility && !canCheckJuniorOrSenior) {
            console.warn(
                '[TeamAggregator] getTeamMatchmakingViewModel: ' +
                'CharacterQueries has neither ' +
                'isProfessionallyEligiblePhaseAtYear nor ' +
                'isJuniorOrSeniorByYear. Matchmaking will include ' +
                'everyone who is not deceased or eliminated.'
            );
        }

        var canGetJuniorYear =
            typeof CharacterQueries.getJuniorYear === 'function';
        var canGetSeniorYear =
            typeof CharacterQueries.getSeniorYear === 'function';
        var canGetSupportYear =
            typeof CharacterQueries.getSupportYear === 'function';
        var canGetInstructorYear =
            typeof CharacterQueries.getInstructorYear === 'function';

        var EQ = getEliminationQueries();
        var canCheckElimination = EQ &&
            typeof EQ.getEliminationWeek === 'function';

        // ---- Target pool: all non-deprecated professional teams. ----
        var allProfessionalTeams = TeamQueries.getTeams(
            'professional',
            null,
            false
        );

        var activeCountByTeam = Object.create(null);

        for (var t = 0; t < allProfessionalTeams.length; t++) {
            var team = allProfessionalTeams[t];
            if (!team || !team.id) { continue; }

            activeCountByTeam[String(team.id)] =
                TeamQueries.getActiveTeamMembers(
                    team, yearNum
                ).length;
        }

        // ---- Direct team-store walk (documented at top of file). ----
        var historyByChar = Object.create(null);
        var activeAtYearByChar = Object.create(null);

        for (var ht = 0; ht < allProfessionalTeams.length; ht++) {
            var hteam = allProfessionalTeams[ht];
            if (!hteam || !hteam.id) { continue; }

            var teamId = String(hteam.id);
            var members = TeamQueries.getAllTeamMemberRecords(hteam);

            for (var hm = 0; hm < members.length; hm++) {
                var member = members[hm];
                if (!member || !member.characterId) { continue; }

                var charId = String(member.characterId);
                var intervals = Array.isArray(member.intervals)
                    ? member.intervals
                    : [];

                for (var iv = 0; iv < intervals.length; iv++) {
                    var interval = intervals[iv];
                    if (!interval) { continue; }

                    var joinNum = TeamConstants.parsePeriod(
                        interval.joinPeriod
                    );
                    var leaveNum = TeamConstants.parsePeriod(
                        interval.leavePeriod
                    );

                    var lo = (joinNum !== null) ? joinNum : 1;
                    var hi = (leaveNum !== null)
                        ? leaveNum
                        : yearNum;

                    if (lo > yearNum) { continue; }
                    var hiClamped = Math.min(hi, yearNum);
                    if (hiClamped < lo) { continue; }

                    if (!historyByChar[charId]) {
                        historyByChar[charId] = Object.create(null);
                    }
                    for (var y = lo; y <= hiClamped; y++) {
                        historyByChar[charId][y] = true;
                    }

                    if (lo <= yearNum && hiClamped >= yearNum) {
                        activeAtYearByChar[charId] = true;
                    }
                }
            }
        }

        // ---- Candidate pool. ----
        var allChars = CharacterQueries.getCharacters() || [];
        var candidates = [];

        for (var c = 0; c < allChars.length; c++) {
            var char = allChars[c];
            if (!char || !char.id) { continue; }

            var cid = String(char.id);

            // 1. Deceased as of the target year.
            var deceased = false;
            try {
                deceased =
                    CharacterQueries.isDeceased(char, yearNum)
                    === true;
            } catch (e) {
                deceased = char.deceased === true;
            }
            if (deceased) { continue; }

            // 2. Available for a professional team at this year?
            if (canCheckEligibility) {
                var eligible = false;
                try {
                    eligible = CharacterQueries
                        .isProfessionallyEligiblePhaseAtYear(
                            char, yearNum
                        ) === true;
                } catch (e) {
                    eligible = false;
                }
                if (!eligible) { continue; }
            } else if (canCheckJuniorOrSenior) {
                var isEligibleStatus = false;
                try {
                    isEligibleStatus =
                        CharacterQueries.isJuniorOrSeniorByYear(
                            char, yearNum
                        ) === true;
                } catch (e) {
                    isEligibleStatus = false;
                }
                if (!isEligibleStatus) { continue; }
            }

            // 3. Eliminated at any point, in any year, any cause.
            if (canCheckElimination) {
                var earliest = null;
                try {
                    earliest = EQ.getEliminationWeek(cid);
                } catch (e) {
                    earliest = null;
                }
                if (earliest !== null && earliest !== undefined) {
                    continue;
                }
            }

            // 4. Already active on a professional team at the
            //    target year.
            if (activeAtYearByChar[cid] === true) { continue; }

            // 5. Career milestone years.
            var juniorYear = null;
            if (canGetJuniorYear) {
                try { juniorYear = CharacterQueries.getJuniorYear(char); }
                catch (e) { juniorYear = null; }
            }

            var seniorYear = null;
            if (canGetSeniorYear) {
                try { seniorYear = CharacterQueries.getSeniorYear(char); }
                catch (e) { seniorYear = null; }
            }

            var supportYear = null;
            if (canGetSupportYear) {
                try { supportYear = CharacterQueries.getSupportYear(char); }
                catch (e) { supportYear = null; }
            }

            var instructorYear = null;
            if (canGetInstructorYear) {
                try {
                    instructorYear =
                        CharacterQueries.getInstructorYear(char);
                } catch (e) {
                    instructorYear = null;
                }
            }

            // ---- Milestone. ----
            var milestoneYear = null;
            var milestoneLabel = '';

            if (juniorYear !== null) {
                milestoneYear = juniorYear;
                milestoneLabel = 'Junior ' + juniorYear;
            }
            if (seniorYear !== null &&
                (milestoneYear === null ||
                 seniorYear < milestoneYear)) {
                milestoneYear = seniorYear;
                milestoneLabel = 'Senior ' + seniorYear;
            }
            if (supportYear !== null &&
                (milestoneYear === null ||
                 supportYear < milestoneYear)) {
                milestoneYear = supportYear;
                milestoneLabel = 'Support ' + supportYear;
            }
            if (instructorYear !== null &&
                (milestoneYear === null ||
                 instructorYear < milestoneYear)) {
                milestoneYear = instructorYear;
                milestoneLabel = 'Instructor ' + instructorYear;
            }

            // ---- History (professional-team years). ----
            var historyYears = [];
            if (historyByChar[cid]) {
                var yearKeys = Object.keys(historyByChar[cid]);
                for (var hk = 0; hk < yearKeys.length; hk++) {
                    historyYears.push(yearKeys[hk]);
                }
                historyYears.sort(function(a, b) {
                    return parseInt(a, 10) - parseInt(b, 10);
                });
            }

            candidates.push({
                id: cid,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getStatusAtYear
                    ? CharacterQueries.getStatusAtYear(char, yearNum)
                    : CharacterQueries.getCurrentStatus(char),
                deceased: false,
                history: historyYears,

                juniorYear: juniorYear,
                seniorYear: seniorYear,
                supportYear: supportYear,
                instructorYear: instructorYear,

                milestoneYear: milestoneYear,
                milestoneLabel: milestoneLabel
            });
        }

        // ---- Sort: milestone year ascending, then name. ----
        candidates.sort(function(a, b) {
            var aYear = a.milestoneYear;
            var bYear = b.milestoneYear;

            if (aYear !== null && bYear !== null) {
                if (aYear !== bYear) { return aYear - bYear; }
                return a.name.localeCompare(b.name);
            }
            if (aYear !== null) { return -1; }
            if (bYear !== null) { return 1; }
            return a.name.localeCompare(b.name);
        });

        // ---- Target pool: understaffed professional teams. ----
        var targets = [];
        for (var tt = 0; tt < allProfessionalTeams.length; tt++) {
            var tTeam = allProfessionalTeams[tt];
            if (!tTeam || !tTeam.id) { continue; }

            if (!TeamQueries.teamWindowContains(tTeam, yearNum)) {
                continue;
            }

            var count = activeCountByTeam[String(tTeam.id)];
            if (typeof count !== 'number') { count = 0; }
            if (count >= targetSizeNum) { continue; }

            targets.push({
                teamId: String(tTeam.id),
                teamName: tTeam.name || 'Unnamed Team',
                currentMemberCount: count,
                classDisplay: tTeam.classId
                    ? getClassDisplayName(tTeam.classId)
                    : '',
                periodDisplay: getTeamPeriodDisplay(tTeam)
            });
        }

        targets.sort(function(a, b) {
            if (a.currentMemberCount !== b.currentMemberCount) {
                return a.currentMemberCount - b.currentMemberCount;
            }
            return a.teamName.localeCompare(b.teamName);
        });

        return {
            year: yearNum,
            targetSize: targetSizeNum,
            candidates: candidates,
            targets: targets
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamAggregator = Object.freeze({
        getTeamViewModel: getTeamViewModel,
        getTeamListViewModel: getTeamListViewModel,
        getTeamMembersViewModel: getTeamMembersViewModel,
        getTeamPageViewModel: getTeamPageViewModel,

        getTeamFormViewModel: getTeamFormViewModel,
        getMemberModalViewModel: getMemberModalViewModel,
        getRankingModalViewModel: getRankingModalViewModel,
        getFilterBarViewModel: getFilterBarViewModel,

        getUnassignedViewModel: getUnassignedViewModel,

        getTeamMatchmakingViewModel: getTeamMatchmakingViewModel,

        getTeamPeriodDisplay: getTeamPeriodDisplay,
        getRankingHistoryDisplay: getRankingHistoryDisplay
    });

})();
