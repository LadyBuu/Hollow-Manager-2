/**
 * modules/teams/team-aggregator.js - Team Aggregator
 * Team's integration boundary with external domains.
 *
 * Path: js/modules/teams/team-aggregator.js
 *
 * This module provides Team-specific projections by composing data
 * from TeamQueries, CharacterQueries, and AcademyQueries.
 *
 * IMPORTANT:
 *   - Projection builder, not a query registry.
 *   - Composes query modules and domain read surfaces. Never walks
 *     raw storage.
 *   - Returns Team-shaped view models. No raw domain entities escape.
 *   - Never mutates data. No UI dependencies. No passthrough methods.
 *   - Every public projection returns a self-contained VM. If a VM
 *     field is a nested object, it is a nested VM, not a domain
 *     record.
 *
 * PERIOD SEMANTICS:
 *   - Periods are REQUIRED. The aggregator does not fall back to 1.
 *   - When a caller passes an invalid period, the projection returns
 *     an empty result or a null selected team. It does not invent a
 *     period.
 *   - Callers that want the "current application year" fetch it from
 *     TeamUI or from window.data.currentYear and pass it in.
 *
 * STATUS SEMANTICS:
 *   - A team is "operational" when its status is 'active' or
 *     'inactive'. Deprecated teams are not operational.
 *   - This module does not reimplement the predicate. It calls
 *     TeamQueries.isTeamOperational.
 *
 * MEMBER INTERVALS MODEL (v24):
 *   A team member entry carries an `intervals` array:
 *
 *     {
 *       memberId,        // stable per-entry identifier
 *       characterId,
 *       role,
 *       intervals: [
 *         { joinPeriod, leavePeriod },
 *         ...
 *       ]
 *     }
 *
 *   Each interval describes one stint. A character may have multiple
 *   stints on the same team. The member VM produced by this module
 *   carries the full intervals array, plus a flat convenience
 *   summary (joinPeriod / leavePeriod from the first interval) for
 *   renderers that show one period per member.
 *
 * MEMBER ACTIVE-AT-PERIOD SEMANTICS:
 *   TeamQueries.getActiveTeamMembers is the SINGLE SOURCE OF TRUTH
 *   for "which members are active at period P". This module uses its
 *   result to build an active-id set. It does NOT re-parse intervals.
 *
 * MEMBER-MODAL CANDIDATE SEMANTICS:
 *   The member-modal VM's `candidates` array is the pool of
 *   characters that CAN be added to the team.
 *   - CANDIDATE POOL: when the team has a classId, the pool is
 *     restricted to the class roster at the requested period. When
 *     the team has no classId, the pool falls back to all
 *     characters.
 *   - EXCLUSIONS: current team members (any character with an entry
 *     on the team, active or former), instructors, and characters
 *     already in another academic team of the same class this
 *     period are all excluded.
 *
 * RANKING SEMANTICS:
 *   - Ranking history lives on the team as `rankingHistory`.
 *   - The team's current rank is DERIVED from history via
 *     TeamQueries.getRankingSummary.
 *   - This module does not read a persisted `currentRank` field.
 *
 * API:
 *   Core projections:
 *     - getTeamViewModel(teamId, options)
 *     - getTeamListViewModel(options)
 *     - getTeamMembersViewModel(teamId, period)
 *     - getTeamPageViewModel(options)
 *     - getCandidateCharactersAtPeriod(teamType, period)
 *
 *   Form / modal VMs:
 *     - getTeamFormViewModel(teamId)
 *     - getMemberModalViewModel(teamId, period)
 *     - getRankingModalViewModel(teamId)
 *     - getFilterBarViewModel(tab)
 *
 *   Display helpers (also used by other render paths):
 *     - getTeamPeriodDisplay(team)
 *     - getRankDisplay(team)
 *     - getRankingHistoryDisplay(team)
 *
 * DEPENDENCIES:
 *   - window.TeamQueries        (MANDATORY)
 *   - window.TeamConstants      (MANDATORY)
 *   - window.CharacterQueries   (MANDATORY)
 *   - window.AcademyQueries     (MANDATORY) — for class display names
 *     and class-scoped candidate pools
 *   - window.TeamUI             (OPTIONAL) — for filter bar VM defaults
 *
 * USAGE:
 *   var vm = TeamAggregator.getTeamViewModel('team_123', { period: 2025 });
 *   var list = TeamAggregator.getTeamListViewModel({
 *       type: 'professional', period: 2025
 *   });
 *   var members = TeamAggregator.getTeamMembersViewModel('team_123', 2025);
 *   var candidates = TeamAggregator.getCandidateCharactersAtPeriod('professional', 2025);
 */

(function() {
    'use strict';

    if (window.__teamAggregatorLoaded) {
        return;
    }
    window.__teamAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }
        if (!TeamQueries || typeof TeamQueries.getTeams !== 'function') {
            missing.push('TeamQueries.getTeams');
        }
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }
        if (!TeamQueries || typeof TeamQueries.getRankingSummary !== 'function') {
            missing.push('TeamQueries.getRankingSummary');
        }
        if (!TeamQueries || typeof TeamQueries.getSortedRankings !== 'function') {
            missing.push('TeamQueries.getSortedRankings');
        }
        if (!TeamQueries || typeof TeamQueries.isTeamOperational !== 'function') {
            missing.push('TeamQueries.isTeamOperational');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }

        if (!TeamConstants || typeof TeamConstants.getPeriodRange !== 'function') {
            missing.push('TeamConstants.getPeriodRange');
        }
        if (!TeamConstants || typeof TeamConstants.parsePeriod !== 'function') {
            missing.push('TeamConstants.parsePeriod');
        }
        if (!TeamConstants || typeof TeamConstants.getTypeLabel !== 'function') {
            missing.push('TeamConstants.getTypeLabel');
        }
        if (!TeamConstants || typeof TeamConstants.getPeriodLabel !== 'function') {
            missing.push('TeamConstants.getPeriodLabel');
        }
        if (!TeamConstants || typeof TeamConstants.normalizeTeamType !== 'function') {
            missing.push('TeamConstants.normalizeTeamType');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterAge !== 'function') {
            missing.push('CharacterQueries.getCharacterAge');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }
        if (!CharacterQueries || typeof CharacterQueries.isInstructor !== 'function') {
            missing.push('CharacterQueries.isInstructor');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClassDisplayName !== 'function') {
            missing.push('AcademyQueries.getClassDisplayName');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassStudentIds !== 'function') {
            missing.push('AcademyQueries.getClassStudentIds');
        }

        if (missing.length > 0) {
            console.warn('[TeamAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getTeamUI() {
        return window.TeamUI || null;
    }

    /**
     * Build a character summary VM from a character ID.
     *
     * ONE getCharacterById call per summary. Do not split this into
     * four helpers that each look up the character again.
     */
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

    /**
     * Does the given interval contain the given period?
     * Both bounds inclusive. Blank bounds are unbounded on that side.
     */
    function intervalContainsPeriod(interval, periodNum) {
        if (!interval || typeof interval !== 'object') {
            return false;
        }

        var hasJoin = interval.joinPeriod !== undefined &&
                      interval.joinPeriod !== null &&
                      interval.joinPeriod !== '';
        var hasLeave = interval.leavePeriod !== undefined &&
                       interval.leavePeriod !== null &&
                       interval.leavePeriod !== '';

        if (hasJoin) {
            var join = TeamConstants.parsePeriod(interval.joinPeriod);
            if (join === null) { return false; }
            if (join > periodNum) { return false; }
        }

        if (hasLeave) {
            var leave = TeamConstants.parsePeriod(interval.leavePeriod);
            if (leave === null) { return false; }
            if (leave < periodNum) { return false; }
        }

        return true;
    }

    /**
     * Build a member VM from a raw member entry.
     *
     * Carries:
     *   - memberId: stable per-entry identifier
     *   - intervals: one per stint, each with its own activeAtPeriod
     *   - flat joinPeriod / leavePeriod: convenience, from the first
     *     interval (or blank when there are no intervals)
     *   - activeAtPeriod: true if any interval contains `periodNum`
     *
     * When `periodNum` is null, activeAtPeriod is false for every
     * interval (nothing to compare against).
     */
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
                if (!iv || typeof iv !== 'object') { continue; }

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
                    active = intervalContainsPeriod(iv, periodNum);
                }

                if (i === 0) {
                    firstJoin = ivJoin;
                    firstLeave = ivLeave;
                }

                if (active) { anyActive = true; }

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
            // Convenience flat fields: the FIRST interval's bounds.
            // Renderers that show one period per member use these.
            // Renderers that expand per-stint use `intervals`.
            joinPeriod: firstJoin,
            leavePeriod: firstLeave,
            activeAtPeriod: anyActive
        };
    }

    // ============================================================
    // PERIOD DISPLAY
    // ============================================================

    /**
     * Format a team's period range for display.
     *
     * Academic: "Wk 3 - Wk 14", "From Wk 3", "Until Wk 14", or "-"
     * Other:    "2025 - 2027", "From 2025", "Until 2027", or "-"
     */
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

    /**
     * Format a team's current rank for display. Returns '-' when the
     * team has no ranking.
     */
    function getRankDisplay(team) {
        var summary = TeamQueries.getRankingSummary(team);
        return summary && summary.current ? summary.current : '-';
    }

    /**
     * Format a team's ranking history as a display string.
     */
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
    // TEAM DETAIL VIEW MODEL
    // ============================================================

    /**
     * Get a complete view model for a single team.
     *
     * @param {string} teamId
     * @param {object} options
     * @param {number|string} options.period - REQUIRED for member and
     *                                         ranking resolution.
     * @param {boolean} options.includeMembers
     * @param {boolean} options.includeRankings
     * @param {boolean} options.includeClass
     * @returns {object|null}
     */
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
            nameHistory: Array.isArray(team.nameHistory) ? team.nameHistory.slice() : [],
            memberCount: team.members ? team.members.length : 0,
            isActive: team.status === 'active',
            isOperational: TeamQueries.isTeamOperational(team),
            createdAt: team.createdAt || ''
        };

        // ---- Members ----
        if (includeMembers) {
            if (periodNum !== null) {
                var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
                var memberVMs = [];
                for (var i = 0; i < activeMembers.length; i++) {
                    var vm = buildMemberVM(activeMembers[i], periodNum);
                    if (vm) { memberVMs.push(vm); }
                }
                viewModel.members = memberVMs;
                viewModel.activeMemberCount = memberVMs.length;
                viewModel.totalMemberCount = team.members ? team.members.length : 0;
            } else {
                viewModel.members = [];
                viewModel.activeMemberCount = 0;
                viewModel.totalMemberCount = team.members ? team.members.length : 0;
            }
        }

        // ---- Rankings ----
        if (includeRankings) {
            viewModel.rankingHistory = rankingSummary.history;
            viewModel.rankingCount = rankingSummary.total;
            viewModel.currentRank = rankingSummary.current;
            viewModel.mostRecentRanking = rankingSummary.mostRecent;
        }

        return viewModel;
    }

    // ============================================================
    // TEAM LIST VIEW MODEL
    // ============================================================

    /**
     * Get a list of team list VMs.
     */
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
            type,
            status,
            includeInactive
        );

        // ---- Search filter ----
        if (search) {
            var lowerSearch = search.toLowerCase();
            teams = teams.filter(function(team) {
                return team.name && team.name.toLowerCase().indexOf(lowerSearch) !== -1;
            });
        }

        // ---- Build list items ----
        var listItems = teams.map(function(team) {
            var activeMemberCount = 0;
            if (periodNum !== null) {
                activeMemberCount = TeamQueries.getActiveTeamMemberCount(team, periodNum);
            }

            var rankingSummary = TeamQueries.getRankingSummary(team);
            var typeLabel = getTypeLabel(team.type);
            var classDisplay = team.classId ? getClassDisplayName(team.classId) : '';

            return {
                id: team.id,
                name: team.name,
                type: team.type,
                typeLabel: typeLabel,
                status: team.status || 'active',
                currentRank: rankingSummary.current || '',
                activeMemberCount: activeMemberCount,
                totalMemberCount: team.members ? team.members.length : 0,
                periodDisplay: getTeamPeriodDisplay(team),
                isActive: team.status === 'active',
                isOperational: TeamQueries.isTeamOperational(team),
                classDisplay: classDisplay,
                teamNumber: team.teamNumber || '',
                temporaryMission: team.temporaryMission || null,
                createdAt: team.createdAt || ''
            };
        });

        // ---- Sort ----
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

            if (aVal < bVal) { return sortDirection === 'desc' ? 1 : -1; }
            if (aVal > bVal) { return sortDirection === 'desc' ? -1 : 1; }
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

    /**
     * Get a member-oriented view model for a team.
     *
     * Membership classification uses TeamQueries.getActiveTeamMembers
     * as the source of truth. The result set is turned into an
     * active-id set. This module does NOT re-parse intervals.
     *
     * Each member VM carries `intervals[]` for per-stint rendering,
     * plus a flat convenience `joinPeriod` / `leavePeriod` (first
     * interval's bounds) and `activeAtPeriod`.
     */
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

        var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);

        var activeIds = Object.create(null);
        for (var i = 0; i < activeMembers.length; i++) {
            activeIds[String(activeMembers[i].characterId)] = true;
        }

        var allMembers = Array.isArray(team.members) ? team.members : [];

        var memberViewModels = [];
        for (var j = 0; j < allMembers.length; j++) {
            var vm = buildMemberVM(allMembers[j], periodNum);
            if (!vm) { continue; }
            // Override activeAtPeriod with the authoritative set.
            // (The per-interval computation and the set both agree
            // post-refactor, but the set is the source of truth.)
            vm.activeAtPeriod = activeIds[String(vm.characterId)] === true;
            memberViewModels.push(vm);
        }

        // Active members first, then alphabetical within each group.
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

    /**
     * Get a page-level view model.
     */
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

        // ---- Reconcile expanded team ----
        var expandedTeam = null;
        var resolvedExpandedId = null;

        if (expandedTeamId) {
            for (var i = 0; i < listVM.teams.length; i++) {
                if (String(listVM.teams[i].id) === String(expandedTeamId)) {
                    resolvedExpandedId = listVM.teams[i].id;
                    break;
                }
            }

            if (resolvedExpandedId) {
                expandedTeam = getTeamViewModel(resolvedExpandedId, {
                    period: periodNum !== null ? periodNum : undefined,
                    includeMembers: true,
                    includeRankings: true
                });
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
        var teams = TeamQueries.getTeams(type, 'operational', false);
        return teams.length;
    }

    // ============================================================
    // FORM / MODAL VIEW MODELS
    // ============================================================

    /**
     * Get a view model for the team form.
     */
    function getTeamFormViewModel(teamId) {
        var team = null;
        if (isNonEmptyString(teamId)) {
            team = TeamQueries.getTeamById(teamId);
        }

        var isEdit = !!team;
        var t = team || {};

        var classOptions = [];
        if (AcademyQueries && typeof AcademyQueries.getClasses === 'function') {
            var classes = AcademyQueries.getClasses() || [];
            for (var i = 0; i < classes.length; i++) {
                if (classes[i] && classes[i].id) {
                    classOptions.push({
                        id: classes[i].id,
                        name: classes[i].name || 'Unnamed Class'
                    });
                }
            }
        }

        var missionOptions = [];
        var data = window.data || {};
        var missions = Array.isArray(data.missions) ? data.missions : [];
        for (var m = 0; m < missions.length; m++) {
            var mission = missions[m];
            if (!mission || mission.status === 'cancelled') {
                continue;
            }
            missionOptions.push({
                id: mission.id,
                title: mission.title || 'Untitled',
                status: mission.status || 'active'
            });
        }
        missionOptions.sort(function(a, b) {
            if (a.status === 'active' && b.status !== 'active') { return -1; }
            if (a.status !== 'active' && b.status === 'active') { return 1; }
            return a.title.localeCompare(b.title);
        });

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
            currentRank: TeamQueries.getCurrentRank ? TeamQueries.getCurrentRank(team) : '',
            nameHistory: Array.isArray(t.nameHistory) ? t.nameHistory.slice() : [],
            classOptions: classOptions,
            missionOptions: missionOptions
        };
    }

    /**
     * Get a view model for the member modal.
     *
     * Member list carries intervals[] per member. Candidate pool is
     * unchanged: any character with an entry on the team (active or
     * former) is excluded from the pool.
     */
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

        var allowedIds = null;
        var teamClassId = isNonEmptyString(team.classId) ? String(team.classId) : null;

        if (teamClassId !== null) {
            var studentIds = AcademyQueries.getClassStudentIds(teamClassId);
            if (Array.isArray(studentIds) && studentIds.length > 0) {
                allowedIds = Object.create(null);
                for (var k = 0; k < studentIds.length; k++) {
                    allowedIds[String(studentIds[k])] = true;
                }
            }
        }

        var assignedElsewhere = Object.create(null);
        if (teamClassId !== null && periodNum !== null) {
            var siblingTeams = TeamQueries.getTeamsByClass(
                teamClassId,
                'operational'
            );
            for (var s = 0; s < siblingTeams.length; s++) {
                var sibling = siblingTeams[s];
                if (!sibling || String(sibling.id) === String(team.id)) {
                    continue;
                }
                if (TeamConstants.normalizeTeamType(sibling.type) !== 'academic') {
                    continue;
                }
                var siblingMembers = TeamQueries.getActiveTeamMembers(
                    sibling,
                    periodNum
                );
                for (var t = 0; t < siblingMembers.length; t++) {
                    var sm = siblingMembers[t];
                    if (sm && sm.characterId) {
                        assignedElsewhere[String(sm.characterId)] = true;
                    }
                }
            }
        }

        var allChars = CharacterQueries.getCharacters() || [];
        var candidates = [];

        for (var c = 0; c < allChars.length; c++) {
            var char = allChars[c];
            if (!char || !char.id) { continue; }

            var charId = String(char.id);

            if (currentIds[charId]) { continue; }
            if (CharacterQueries.isInstructor(char)) { continue; }
            if (allowedIds !== null && !allowedIds[charId]) { continue; }
            if (assignedElsewhere[charId]) { continue; }

            candidates.push({
                id: char.id,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char)
            });
        }

        candidates.sort(function(a, b) {
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

    /**
     * Get a view model for the filter bar.
     */
    function getFilterBarViewModel(tab) {
        var normalized = TeamConstants.normalizeTeamType(tab) || 'professional';
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
    // CANDIDATE CHARACTERS
    // ============================================================

    /**
     * Get candidate characters for a team type at a period.
     */
    function getCandidateCharactersAtPeriod(teamType, period) {
        var normalizedType = TeamConstants.normalizeTeamType(teamType);
        if (normalizedType === null) {
            return [];
        }

        var periodNum = TeamConstants.parsePeriod(period);
        if (periodNum === null) {
            return [];
        }

        var range = TeamConstants.getPeriodRange(normalizedType);
        if (!range) {
            return [];
        }

        if (periodNum < range.min || periodNum > range.max) {
            return [];
        }

        var eligibleStatuses = getEligibleStatuses(normalizedType);

        var allCharacters = CharacterQueries.getCharacters() || [];
        var result = [];

        for (var i = 0; i < allCharacters.length; i++) {
            var char = allCharacters[i];
            if (!char || !char.id) { continue; }
            if (char.deceased === true) { continue; }

            var status = CharacterQueries.getCurrentStatus(char);
            if (!status) { continue; }

            var statusLower = String(status).toLowerCase();
            if (eligibleStatuses.indexOf(statusLower) === -1) {
                continue;
            }

            result.push({
                id: char.id,
                name: CharacterQueries.getDisplayName(char),
                status: status
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    function getEligibleStatuses(teamType) {
        if (teamType === 'academic') {
            return ['trainee', 'rookie', 'junior', 'student'];
        }
        if (teamType === 'civilian') {
            return ['civilian'];
        }
        return ['trainee', 'rookie', 'junior', 'senior', 'instructor', 'support', 'student'];
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamAggregator = {
        // Core projections
        getTeamViewModel: getTeamViewModel,
        getTeamListViewModel: getTeamListViewModel,
        getTeamMembersViewModel: getTeamMembersViewModel,
        getTeamPageViewModel: getTeamPageViewModel,
        getCandidateCharactersAtPeriod: getCandidateCharactersAtPeriod,

        // Form / modal VMs
        getTeamFormViewModel: getTeamFormViewModel,
        getMemberModalViewModel: getMemberModalViewModel,
        getRankingModalViewModel: getRankingModalViewModel,
        getFilterBarViewModel: getFilterBarViewModel,

        // Display helpers
        getTeamPeriodDisplay: getTeamPeriodDisplay,
        getRankDisplay: getRankDisplay,
        getRankingHistoryDisplay: getRankingHistoryDisplay
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamAggregator;
        var missing = [];

        var required = [
            'getTeamViewModel',
            'getTeamListViewModel',
            'getTeamMembersViewModel',
            'getTeamPageViewModel',
            'getCandidateCharactersAtPeriod',
            'getTeamFormViewModel',
            'getMemberModalViewModel',
            'getRankingModalViewModel',
            'getFilterBarViewModel',
            'getTeamPeriodDisplay',
            'getRankDisplay',
            'getRankingHistoryDisplay'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TeamAggregator] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
