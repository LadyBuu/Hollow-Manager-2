/**
 * modules/teams/team-aggregator.js - Team Aggregator
 * Team's integration boundary with external domains.
 *
 * Path: js/modules/teams/team-aggregator.js
 *
 * Projections that compose TeamQueries, CharacterQueries,
 * AcademyQueries, and MissionQueries into Team-shaped view models.
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
 * CLASS MEMBERSHIP SIGNAL (v29):
 *   The "in class" tier signal for the member modal reads class
 *   membership from two sources:
 *
 *     1. Students: the class's roster, via
 *        AcademyQueries.getClassStudentIds.
 *     2. Instructors: AcademyClasses.getClassInstructorIdsAllTime,
 *        which derives the class's instructors from per-discipline
 *        instructor enrolments.
 *
 *   The retired `class.instructorId` field is not consulted. It was
 *   removed in v29; the relationship is expressed through
 *   instructor enrolments.
 *
 *   The all-time query is used here (not the week-scoped
 *   getClassInstructorIds) because the tier signal is a statement
 *   about class membership, not about a specific week's schedule.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.CharacterQueries
 *   - window.AcademyQueries
 *   - window.AcademyClasses           (getClassInstructorIdsAllTime)
 *
 * DEPENDENCIES (LAZY, read at call time):
 *   - window.TeamUI             (filter bar VM defaults)
 *   - window.EliminationQueries (candidate elimination filter)
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
    var AcademyQueries = window.AcademyQueries;
    var AcademyClasses = window.AcademyClasses;

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

    if (!AcademyQueries ||
        typeof AcademyQueries.getClassDisplayName !== 'function') {
        _missing.push('AcademyQueries.getClassDisplayName');
    }
    if (!AcademyQueries ||
        typeof AcademyQueries.getClassStudentIds !== 'function') {
        _missing.push('AcademyQueries.getClassStudentIds');
    }
    if (!AcademyQueries ||
        typeof AcademyQueries.getClass !== 'function') {
        _missing.push('AcademyQueries.getClass');
    }

    if (!AcademyClasses ||
        typeof AcademyClasses.getClassInstructorIdsAllTime !==
            'function') {
        _missing.push('AcademyClasses.getClassInstructorIdsAllTime');
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
        var name = AcademyQueries.getClassDisplayName(classId);
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

    function buildClassMembershipSet(classId) {
        var result = Object.create(null);
        if (!isNonEmptyString(classId)) {
            return result;
        }

        var studentIds = [];
        try {
            studentIds =
                AcademyQueries.getClassStudentIds(classId) || [];
        } catch (e) {
            studentIds = [];
        }
        if (Array.isArray(studentIds)) {
            for (var s = 0; s < studentIds.length; s++) {
                if (studentIds[s]) {
                    result[String(studentIds[s])] = true;
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
        var classes = AcademyQueries.getClasses() || [];
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

    /**
     * Get a view model for the ranking modal.
     */
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
    // MATCHMAKING VIEW MODEL
    // ============================================================
    //
    // This is the ONE projection in this file that walks the team
    // store directly. The walk builds two things:
    //
    //   1. The candidate pool: every character alive at year Y who
    //      is NOT an active member of any professional team at Y.
    //   2. The history map: for every character in the candidate
    //      pool, the years in which they have appeared on any
    //      professional team. Built from ALL professional teams,
    //      current or historical, by reading every member entry's
    //      intervals.
    //
    // WHY ONE WALK:
    //   The history map must cover every candidate. Deriving it by
    //   calling TeamQueries.getTeamsForCharacter(charId, year,
    //   'professional') once per candidate would be O(candidates ×
    //   teams) and cannot find years other than the queried one.
    //   Years are unbounded, so there is no finite range to iterate.
    //   A single walk over data.teams[] — reading each professional
    //   team's member list once — is O(teams × members) and
    //   produces the complete picture.
    //
    // WHY NOT A QUERY:
    //   This derivation is specific to matchmaking. Putting it on
    //   TeamQueries would put a matchmaking-shaped read on the
    //   canonical query surface. The aggregator owns the projection;
    //   the walk lives here.
    //
    // INPUT:
    //   year       : positive integer
    //   targetSize : positive integer
    //
    // OUTPUT:
    //   {
    //     year,
    //     targetSize,
    //     candidates: [ { id, name, status, deceased, history } ]
    //     targets:    [ { teamId, teamName, currentMemberCount,
    //                     classDisplay, periodDisplay } ]
    //   }
    //
    //   `history` is an array of year strings (ascending). Empty
    //   when the character has never been on a professional team.
    //
    //   `targets` is sorted least-full first, ties by name. The
    //   matchmaking algorithm re-sorts defensively, but the VM
    //   presents the same order the algorithm will use so the modal
    //   can render before running the algorithm.

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

        // ---- Walk every professional team once. ----
        //
        // getAllTeamMemberRecords is the raw member list — no
        // period filter, no window filter, no clone-per-call from
        // a filtered query. This is what makes the history
        // derivation complete: we see every member entry and every
        // interval, current or historical.
        var allProfessionalTeams = TeamQueries.getTeams(
            'professional',
            null,
            false
        );

        var historyByChar = Object.create(null);
        var activeAtYearByChar = Object.create(null);
        var activeCountByTeam = Object.create(null);

        for (var t = 0; t < allProfessionalTeams.length; t++) {
            var team = allProfessionalTeams[t];
            if (!team || !team.id) { continue; }

            var teamId = String(team.id);
            var members = TeamQueries.getAllTeamMemberRecords(team);
            var activeHere = 0;

            for (var m = 0; m < members.length; m++) {
                var member = members[m];
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

                    // Skip intervals whose join is malformed. A
                    // blank join means "unbounded on the left",
                    // which for history purposes we treat as
                    // starting at the earliest possible year.
                    // The interval is still usable for history.
                    var lo = (joinNum !== null)
                        ? joinNum
                        : 1;
                    var hi = (leaveNum !== null)
                        ? leaveNum
                        : yearNum;

                    // Only extend history up to the queried
                    // year. Years after the query are not
                    // relevant to "has this character been on a
                    // professional team by year Y".
                    if (lo > yearNum) { continue; }
                    var hiClamped = Math.min(hi, yearNum);
                    if (hiClamped < lo) { continue; }

                    if (!historyByChar[charId]) {
                        historyByChar[charId] =
                            Object.create(null);
                    }
                    for (var y = lo; y <= hiClamped; y++) {
                        historyByChar[charId][y] = true;
                    }

                    // Active-at-year check for THIS interval.
                    if (lo <= yearNum && hiClamped >= yearNum) {
                        activeAtYearByChar[charId] = true;
                    }
                }
            }

            activeCountByTeam[teamId] =
                TeamQueries.getActiveTeamMembers(
                    team, yearNum
                ).length;

            void activeHere;
        }

        // ---- Build the candidate pool. ----
        //
        // Every character alive at year Y who is NOT active on a
        // professional team at Y.
        var allChars = CharacterQueries.getCharacters() || [];
        var candidates = [];

        for (var c = 0; c < allChars.length; c++) {
            var char = allChars[c];
            if (!char || !char.id) { continue; }

            var cid = String(char.id);

            var deceased = false;
            try {
                deceased =
                    CharacterQueries.isDeceased(char, yearNum)
                    === true;
            } catch (e) {
                deceased = char.deceased === true;
            }
            if (deceased) { continue; }

            if (activeAtYearByChar[cid] === true) { continue; }

            var historyYears = [];
            if (historyByChar[cid]) {
                var yearKeys = Object.keys(historyByChar[cid]);
                for (var h = 0; h < yearKeys.length; h++) {
                    historyYears.push(yearKeys[h]);
                }
                historyYears.sort(function(a, b) {
                    return parseInt(a, 10) - parseInt(b, 10);
                });
            }

            candidates.push({
                id: cid,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char),
                deceased: false,
                history: historyYears
            });
        }

        candidates.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        // ---- Build the target list. ----
        //
        // Professional teams active at year Y whose active member
        // count is below targetSize.
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
        // Core projections
        getTeamViewModel: getTeamViewModel,
        getTeamListViewModel: getTeamListViewModel,
        getTeamMembersViewModel: getTeamMembersViewModel,
        getTeamPageViewModel: getTeamPageViewModel,

        // Form / modal VMs
        getTeamFormViewModel: getTeamFormViewModel,
        getMemberModalViewModel: getMemberModalViewModel,
        getRankingModalViewModel: getRankingModalViewModel,
        getFilterBarViewModel: getFilterBarViewModel,

        // Matchmaking VM
        getTeamMatchmakingViewModel: getTeamMatchmakingViewModel,

        // Display helpers
        getTeamPeriodDisplay: getTeamPeriodDisplay,
        getRankingHistoryDisplay: getRankingHistoryDisplay
    });

})();
