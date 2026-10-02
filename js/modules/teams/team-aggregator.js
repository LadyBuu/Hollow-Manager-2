/**
 * modules/teams/team-aggregator.js - Team Aggregator
 * Team's integration boundary with external domains.
 *
 * Path: js/modules/teams/team-aggregator.js
 *
 * WHAT THIS OWNS:
 *   - Building Team-shaped view models from canonical reads.
 *   - The Professional Pool VM (getProfessionalPoolViewModel).
 *   - The Matchmaking Planner VM
 *     (getMatchmakingPlannerViewModel).
 *   - Team list, team detail, member modal, ranking modal VMs.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. TeamQueries owns them.
 *   - Mutations. TeamCore owns them.
 *   - Rendering. TeamRender owns it.
 *   - Eligibility. TeamQueries.getProfessionalPersonnelAtPeriod
 *     owns it; this module projects the resulting records.
 *
 * PROFESSIONAL POOL:
 *   getProfessionalPoolViewModel({ period }) projects
 *   TeamQueries.getProfessionalPersonnelAtPeriod(period) into
 *   display-shaped rows.
 *
 *   The query returns every character who has a junior-or-senior
 *   phase and was never on a professional team during it, minus
 *   the deceased / eliminated / retired. That set is INDEPENDENT
 *   of the query period: a character whose student phase was
 *   1895-1897 shows up at a 1920 query, with availability
 *   "1895-1897".
 *
 *   The aggregator's only job is to partition the returned set
 *   by where the query period sits relative to each character's
 *   availability window:
 *
 *     available    query period is inside [from, to]
 *     historical   query period is outside [from, to]
 *
 *   Both buckets carry the same row shape. Neither bucket drops
 *   a character.
 *
 * MATCHMAKING PLANNER:
 *   getMatchmakingPlannerViewModel({ period, targetSize })
 *   returns the two-column planner VM:
 *
 *     teams         professional teams whose active member count
 *                   is strictly below targetSize, each carrying
 *                   its existing members with their intervals
 *                   (join + leave) for display
 *
 *     candidates    the SAME canonical pool rows as
 *                   getProfessionalPoolViewModel, flattened from
 *                   available + historical. Not year-filtered.
 *                   Every eligible character is visible; the
 *                   user picks years explicitly.
 *
 *   The planner does NOT re-rank, re-filter, or exclude. It
 *   projects the query and the team index. Every semantic
 *   decision is either in TeamQueries (who is eligible) or in
 *   TeamCore (what the mutation accepts).
 *
 * TEMPORARY MISSION DISPLAY:
 *   Team detail VMs surface `temporaryMission` and
 *   `temporaryMissionName`. The mission name is resolved via
 *   MissionQueries when available; when it is not, the raw ID is
 *   shown.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.MissionQueries     (temporaryMission name resolution)
 *   - window.CharacterConstants (status tier classification)
 *   - window.EliminationQueries (member modal eligibility)
 */

(function() {
    'use strict';

    if (window.__teamAggregatorLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CharacterQueries = window.CharacterQueries;
    var AcademyClasses = window.AcademyClasses;

    var _missing = [];

    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeams !== 'function') {
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
        typeof TeamQueries.isTeamOperational !== 'function') {
        _missing.push('TeamQueries.isTeamOperational');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeamName !== 'function') {
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
        typeof TeamQueries.getProfessionalPersonnelAtPeriod !==
        'function') {
        _missing.push(
            'TeamQueries.getProfessionalPersonnelAtPeriod'
        );
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
        typeof CharacterQueries.getStatusAtYear !== 'function') {
        _missing.push('CharacterQueries.getStatusAtYear');
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
        _missing.push(
            'AcademyClasses.getClassInstructorIdsAllTime'
        );
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__teamAggregatorLoaded = true;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getMissionQueries() {
        return window.MissionQueries || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    function getTeamUI() {
        return window.TeamUI || null;
    }

    function getTimelineQueries() {
        return window.TimelineQueries || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePeriod(value) {
        return TeamConstants.parsePeriod(value);
    }

    function parsePositiveInteger(value) {
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) {
                return null;
            }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            if (!Number.isInteger(n) || n < 1) {
                return null;
            }
            return n;
        }
        return null;
    }

    function getClassDisplayName(classId) {
        if (!isNonEmptyString(classId)) { return ''; }
        var name = AcademyClasses.getDisplayName(classId);
        if (!name || name === 'Unknown Class') { return ''; }
        return name;
    }

    function getTypeLabel(type) {
        return TeamConstants.getTypeLabel(type);
    }

    function getPeriodLabel(type) {
        return TeamConstants.getPeriodLabel(type);
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

    function buildClassMembershipSet(classId) {
        var result = Object.create(null);
        if (!isNonEmptyString(classId)) { return result; }

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
        if (!team || typeof team !== 'object') { return '-'; }

        var normalizedType = TeamConstants.normalizeTeamType(team.type);
        var start = team.startPeriod || '';
        var end = team.endPeriod || '';

        if (normalizedType === 'academic') {
            if (start && end) {
                return 'Wk ' + start + ' - Wk ' + end;
            }
            if (start) { return 'From Wk ' + start; }
            if (end) { return 'Until Wk ' + end; }
            return '-';
        }

        if (start && end) { return start + ' - ' + end; }
        if (start) { return 'From ' + start; }
        if (end) { return 'Until ' + end; }
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
    // MISSION NAME RESOLUTION
    // ============================================================

    function resolveMissionName(missionId) {
        if (!isNonEmptyString(missionId)) { return null; }
        var MQ = getMissionQueries();
        if (!MQ || typeof MQ.getMission !== 'function') {
            return null;
        }
        try {
            var mission = MQ.getMission(missionId);
            if (mission && isNonEmptyString(mission.title)) {
                return mission.title;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    // ============================================================
    // MEMBER VM
    // ============================================================

    function buildMemberVM(member, periodNum) {
        if (!member || typeof member !== 'object') { return null; }

        var charId = member.characterId;
        if (!charId) { return null; }

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
                    ? String(iv.joinPeriod) : '';
                var ivLeave = (iv.leavePeriod !== undefined &&
                               iv.leavePeriod !== null)
                    ? String(iv.leavePeriod) : '';

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
                ? String(member.memberId) : '',
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
    // TEAM DETAIL VM
    // ============================================================

    function getTeamViewModel(teamId, options) {
        if (!isNonEmptyString(teamId)) { return null; }

        options = options || {};
        var periodNum = TeamConstants.parsePeriod(options.period);
        var includeMembers = options.includeMembers !== false;
        var includeRankings = options.includeRankings !== false;
        var includeClass = options.includeClass !== false;

        var team = TeamQueries.getTeamById(teamId);
        if (!team) { return null; }

        var typeLabel = getTypeLabel(team.type);
        var periodLabel = getPeriodLabel(team.type);

        var classDisplay = '';
        if (includeClass && team.classId) {
            classDisplay = getClassDisplayName(team.classId);
        }

        var rankingSummary = TeamQueries.getRankingSummary(team);
        var periodDisplay = getTeamPeriodDisplay(team);

        var temporaryMissionId = team.temporaryMission || null;
        var temporaryMissionName = temporaryMissionId
            ? resolveMissionName(temporaryMissionId)
            : null;

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
            temporaryMission: temporaryMissionId,
            temporaryMissionName: temporaryMissionName,
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
                        team, periodNum
                    );
                var memberVMs = [];
                for (var i = 0; i < activeMembers.length; i++) {
                    var vm = buildMemberVM(
                        activeMembers[i], periodNum
                    );
                    if (vm) { memberVMs.push(vm); }
                }
                viewModel.members = memberVMs;
                viewModel.activeMemberCount = memberVMs.length;
                viewModel.totalMemberCount = team.members
                    ? team.members.length : 0;
            } else {
                viewModel.members = [];
                viewModel.activeMemberCount = 0;
                viewModel.totalMemberCount = team.members
                    ? team.members.length : 0;
            }
        }

        if (includeRankings) {
            viewModel.rankingHistory = rankingSummary.history;
            viewModel.rankingCount = rankingSummary.total;
            viewModel.currentRank = rankingSummary.current;
            viewModel.mostRecentRanking = rankingSummary.mostRecent;
        }

        return viewModel;
    }

    // ============================================================
    // TEAM LIST VM
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
                    team.name.toLowerCase().indexOf(lowerSearch) !== -1;
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

            var rankingSummary = TeamQueries.getRankingSummary(team);
            var typeLabel = getTypeLabel(team.type);
            var classDisplay = team.classId
                ? getClassDisplayName(team.classId)
                : '';

            var temporaryMissionId = team.temporaryMission || null;
            var temporaryMissionName = temporaryMissionId
                ? resolveMissionName(temporaryMissionId)
                : null;

            return {
                id: team.id,
                name: team.name,
                type: team.type,
                typeLabel: typeLabel,
                status: team.status || 'active',
                currentRank: rankingSummary.current || '',
                activeMemberCount: activeMemberCount,
                totalMemberCount: team.members
                    ? team.members.length : 0,
                periodDisplay: getTeamPeriodDisplay(team),
                isActive: team.status === 'active',
                isOperational: TeamQueries.isTeamOperational(team),
                classDisplay: classDisplay,
                teamNumber: team.teamNumber || '',
                temporaryMission: temporaryMissionId,
                temporaryMissionName: temporaryMissionName,
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
    // TEAM MEMBERS VM
    // ============================================================

    function getTeamMembersViewModel(teamId, period) {
        if (!isNonEmptyString(teamId)) { return null; }

        var periodNum = TeamConstants.parsePeriod(period);
        if (periodNum === null) { return null; }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) { return null; }

        var typeLabel = getTypeLabel(team.type);
        var periodLabel = getPeriodLabel(team.type);

        var activeMembers = TeamQueries.getActiveTeamMembers(
            team, periodNum
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
            if (!vm) { continue; }
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
    // TEAM PAGE VM
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
    // FORM / MODAL VMs
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
            if (!mission || !mission.id) { continue; }
            if (mission.status === 'cancelled') { continue; }
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
    // MEMBER MODAL VM
    // ============================================================

    function getMemberModalViewModel(teamId, period) {
        if (!isNonEmptyString(teamId)) { return null; }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) { return null; }

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
                            String(sibling.id) === String(team.id)) {
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
            if (!char || !char.id) { continue; }

            var charId = String(char.id);

            if (currentIds[charId]) { continue; }

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
                if (isCivilian) { continue; }
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
                if (eliminated) { continue; }
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
            if (tierA !== tierB) { return tierA - tierB; }
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
        if (!isNonEmptyString(teamId)) { return null; }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) { return null; }

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
    // PROFESSIONAL POOL VM
    // ============================================================
    //
    // Consumes TeamQueries.getProfessionalPersonnelAtPeriod.
    //
    // The query already applies every exclusion: deceased,
    // eliminated, retired, no student phase, and stint overlapping
    // the student window. What remains is the pool.
    //
    // The pool is INDEPENDENT of the query period. A character
    // whose student window was 1895-1897 and who was never on a
    // professional team during those years is in the pool whether
    // you query 1896 or 1920.
    //
    // The aggregator's only job is to partition that set by where
    // the query period sits relative to each character's window:
    //
    //   available    query period is inside [from, to]
    //   historical   query period is outside [from, to]
    //
    // Both buckets carry the same row shape. Neither bucket drops
    // a character.

    function getProfessionalPoolViewModel(options) {
        options = options || {};
        var periodNum = TeamConstants.parsePeriod(options.period);

        if (periodNum === null) {
            throw new Error(
                '[TeamAggregator] getProfessionalPoolViewModel ' +
                'requires a valid period.'
            );
        }

        var records = TeamQueries.getProfessionalPersonnelAtPeriod(
            periodNum
        );

        var available = [];
        var historical = [];

        for (var i = 0; i < records.length; i++) {
            var r = records[i];

            var from = r.availability
                ? r.availability.from
                : null;
            var to = r.availability
                ? r.availability.to
                : null;

            // A record with no window start is not partitionable.
            // The query should never emit one, but be explicit.
            if (from === null) { continue; }

            var isAvailableNow =
                periodNum >= from &&
                (to === null || periodNum <= to);

            var row = buildPoolRow(r, periodNum);

            if (isAvailableNow) {
                available.push(row);
            } else {
                historical.push(row);
            }
        }

        available.sort(comparePoolRows);
        historical.sort(comparePoolRows);

        return {
            period: periodNum,
            summary: {
                available: available.length,
                historical: historical.length
            },
            available: available,
            historical: historical
        };
    }

    function buildPoolRow(record, periodNum) {
        var assignmentDisplay = 'Unassigned';
        if (record.assignment.status === 'future' &&
            isNonEmptyString(record.assignment.nextTeamName) &&
            record.assignment.nextJoinYear !== null) {
            assignmentDisplay =
                record.assignment.nextTeamName +
                ' from ' + record.assignment.nextJoinYear;
        } else if (record.assignment.status === 'active' &&
            isNonEmptyString(record.assignment.currentTeamName)) {
            assignmentDisplay =
                record.assignment.currentTeamName;
        }

        return {
            characterId: record.characterId,
            displayName: record.name,
            age: record.age,
            ageDisplay: (record.age === null ||
                         record.age === undefined)
                ? ''
                : String(record.age),

            statusAtPeriod: record.statusAtPeriod,

            availability: {
                from: record.availability
                    ? record.availability.from
                    : null,
                to: record.availability
                    ? record.availability.to
                    : null,
                display: formatAvailability(record.availability)
            },

            assignment: {
                status: record.assignment.status,
                currentTeamId: record.assignment.currentTeamId,
                currentTeamName: record.assignment.currentTeamName,
                nextTeamId: record.assignment.nextTeamId,
                nextTeamName: record.assignment.nextTeamName,
                nextJoinYear: record.assignment.nextJoinYear,
                display: assignmentDisplay
            },

            career: {
                juniorYear: record.career.juniorYear,
                seniorYear: record.career.seniorYear
            },

            history: {
                hasProfessionalHistory:
                    record.history.hasProfessionalHistory,
                formerTeamCount: record.history.formerTeamCount
            }
        };
    }

    function formatAvailability(availability) {
        if (!availability) { return '\u2014'; }

        var from = availability.from;
        var to = availability.to;

        if (from === null && to === null) {
            return 'any';
        }
        if (from === null) {
            return '\u2013' + to;
        }
        if (to === null) {
            return from + '\u2013';
        }
        return from + '\u2013' + to;
    }

    function comparePoolRows(a, b) {
        var aFrom = a.availability.from;
        var bFrom = b.availability.from;

        if (aFrom === null && bFrom === null) {
            return a.displayName.localeCompare(b.displayName);
        }
        if (aFrom === null) { return -1; }
        if (bFrom === null) { return 1; }
        if (aFrom !== bFrom) { return aFrom - bFrom; }
        return a.displayName.localeCompare(b.displayName);
    }

    // ============================================================
    // MATCHMAKING PLANNER VM
    // ============================================================
    //
    // The planner is a two-column projection:
    //
    //   teams         professional teams under targetSize, each
    //                 carrying its existing members with their
    //                 intervals (join + leave) for display
    //
    //   candidates    the SAME canonical pool rows as the
    //                 Professional Pool, flattened from
    //                 available + historical. Not year-filtered:
    //                 every eligible character is visible, and
    //                 the user picks years explicitly.
    //
    // The VM does not associate candidates with teams. It does
    // not compute years. It does not validate. It projects the
    // query and the team index; TeamEvents owns the association
    // state and TeamCore owns the transaction.

    function getMatchmakingPlannerViewModel(options) {
        options = options || {};

        var periodNum = TeamConstants.parsePeriod(options.period);
        var targetSizeNum = parsePositiveInteger(options.targetSize);

        if (periodNum === null) {
            throw new Error(
                '[TeamAggregator] getMatchmakingPlannerViewModel ' +
                'requires a valid period.'
            );
        }
        if (targetSizeNum === null) {
            throw new Error(
                '[TeamAggregator] getMatchmakingPlannerViewModel ' +
                'requires a valid targetSize.'
            );
        }

        // ---- Teams under target size. ----
        var rawTeams = TeamQueries.getTeams(
            'professional', null, false
        );

        var teams = [];

        for (var t = 0; t < rawTeams.length; t++) {
            var team = rawTeams[t];
            if (!team || !team.id) { continue; }

            if (!TeamQueries.teamWindowContains(team, periodNum)) {
                continue;
            }

            var activeMembers = TeamQueries.getActiveTeamMembers(
                team, periodNum
            );
            var count = activeMembers.length;
            if (count >= targetSizeNum) { continue; }

            teams.push(buildPlannerTeamRow(
                team, activeMembers, count, targetSizeNum
            ));
        }

        teams.sort(function(a, b) {
            if (a.memberCount !== b.memberCount) {
                return a.memberCount - b.memberCount;
            }
            return a.teamName.localeCompare(b.teamName);
        });

        // ---- Candidates: the canonical pool, flattened. ----
        var records = TeamQueries.getProfessionalPersonnelAtPeriod(
            periodNum
        );

        var candidates = [];

        for (var c = 0; c < records.length; c++) {
            var r = records[c];

            var from = r.availability
                ? r.availability.from
                : null;
            if (from === null) { continue; }

            var row = buildPoolRow(r, periodNum);
            row.availabilityBucket = classifyAvailabilityBucket(
                row, periodNum
            );
            candidates.push(row);
        }

        candidates.sort(comparePoolRows);

        return {
            period: periodNum,
            targetSize: targetSizeNum,
            teams: teams,
            candidates: candidates
        };
    }

    function buildPlannerTeamRow(
        team, activeMembers, memberCount, targetSize
    ) {
        var memberRows = [];

        for (var i = 0; i < activeMembers.length; i++) {
            var member = activeMembers[i];
            if (!member || !member.characterId) { continue; }

            var vm = buildMemberVM(member, null);
            if (!vm) { continue; }

            // Collapse intervals into a single display line:
            // "1900–1904" or "1902–" or "—".
            var joinDisplay = '';
            var leaveDisplay = '';

            if (vm.intervals.length > 0) {
                var first = vm.intervals[0];
                joinDisplay = first.joinPeriod || '';
                leaveDisplay = first.leavePeriod || '';
            }

            memberRows.push({
                characterId: vm.characterId,
                memberId: vm.memberId,
                displayName: vm.displayName,
                role: vm.role,
                joinPeriod: joinDisplay,
                leavePeriod: leaveDisplay,
                intervalDisplay: formatIntervalDisplay(
                    joinDisplay, leaveDisplay
                )
            });
        }

        memberRows.sort(function(a, b) {
            return a.displayName.localeCompare(b.displayName);
        });

        return {
            teamId: String(team.id),
            teamName: team.name || 'Unnamed Team',
            memberCount: memberCount,
            targetSize: targetSize,
            remainingCapacity: targetSize - memberCount,
            periodDisplay: getTeamPeriodDisplay(team),
            members: memberRows
        };
    }

    function formatIntervalDisplay(join, leave) {
        if (join && leave) { return join + '\u2013' + leave; }
        if (join) { return join + '\u2013'; }
        if (leave) { return '\u2013' + leave; }
        return '\u2014';
    }

    function classifyAvailabilityBucket(row, periodNum) {
        var from = row.availability.from;
        var to = row.availability.to;

        if (from === null) { return 'unknown'; }

        var insideNow =
            periodNum >= from &&
            (to === null || periodNum <= to);

        if (insideNow) { return 'available'; }
        return 'outside';
    }

    // ============================================================
    // TIMELINE VM (routing)
    // ============================================================

    function getTimelineViewModel(options) {
        var TQ = getTimelineQueries();
        if (!TQ || typeof TQ.buildTimelineViewModel !== 'function') {
            throw new Error(
                '[TeamAggregator] TimelineQueries is not available.'
            );
        }
        return TQ.buildTimelineViewModel(options || {});
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

        getProfessionalPoolViewModel: getProfessionalPoolViewModel,
        getMatchmakingPlannerViewModel:
            getMatchmakingPlannerViewModel,
        getTimelineViewModel: getTimelineViewModel,

        getTeamPeriodDisplay: getTeamPeriodDisplay,
        getRankingHistoryDisplay: getRankingHistoryDisplay
    });

})();
