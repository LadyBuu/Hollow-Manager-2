/**
 * js/modules/missions/mission-aggregator.js - Mission Aggregator
 * Mission's integration boundary with external domains
 * 
 * This module provides Mission-specific projections by composing
 * data from MissionQueries and external queries.
 * 
 * IMPORTANT:
 *   - Projection builder, not a query registry
 *   - Composes MissionQueries + TeamQueries + CharacterQueries
 *   - Returns Mission-shaped view models
 *   - Never exposes external query APIs directly
 *   - Never mutates data
 *   - No UI dependencies
 *   - No passthrough methods
 * 
 * API SHAPE:
 *   ✓ getMissionListViewModel(options)
 *   ✓ getMissionDetailViewModel(missionId)
 *   ✓ getMissionFormViewModel(options)
 *   ✓ getMissionPageViewModel(options)
 *   ✓ getMissionStatisticsViewModel()
 *   ✓ resolveTeamName(teamId)
 *   ✓ resolveSupportNames(supportIds)
 * 
 * DEPENDENCIES:
 *   - window.MissionQueries (from mission-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.MissionViews (from mission-views.js) - MANDATORY
 * 
 * USAGE:
 *   var MA = window.MissionAggregator;
 *   var list = MA.getMissionListViewModel({ filter: 'active' });
 *   var detail = MA.getMissionDetailViewModel('miss_123');
 *   var form = MA.getMissionFormViewModel({ editId: 'miss_123' });
 */

(function() {
    'use strict';

    if (window.__missionAggregatorLoaded) {
        return;
    }
    window.__missionAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var MissionQueries = window.MissionQueries;
    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;
    var MissionViews = window.MissionViews;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!MissionQueries || typeof MissionQueries.getMissions !== 'function') {
            missing.push('MissionQueries.getMissions');
        }
        if (!MissionQueries || typeof MissionQueries.getMission !== 'function') {
            missing.push('MissionQueries.getMission');
        }
        if (!MissionQueries || typeof MissionQueries.getEligibleTeams !== 'function') {
            missing.push('MissionQueries.getEligibleTeams');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }

        if (!MissionViews || typeof MissionViews.getPriorityInfo !== 'function') {
            missing.push('MissionViews.getPriorityInfo');
        }
        if (!MissionViews || typeof MissionViews.getStatusInfo !== 'function') {
            missing.push('MissionViews.getStatusInfo');
        }
        if (!MissionViews || typeof MissionViews.getDifficultyLabel !== 'function') {
            missing.push('MissionViews.getDifficultyLabel');
        }
        if (!MissionViews || typeof MissionViews.getMissionTypeLabel !== 'function') {
            missing.push('MissionViews.getMissionTypeLabel');
        }

        if (missing.length > 0) {
            console.warn('[MissionAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function getTeamName(teamId) {
        if (!teamId) {
            return 'Unassigned';
        }
        return TeamQueries.getTeamName(teamId) || 'Unknown Team';
    }

    function getTeamType(teamId) {
        if (!teamId) {
            return null;
        }
        var team = TeamQueries.getTeamById(teamId);
        return team ? team.type : null;
    }

    function getCharacterDisplayName(charId) {
        if (!charId) {
            return 'Unknown';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return 'Unknown';
        }
        return CharacterQueries.getDisplayName(char);
    }

    function resolveSupportNames(supportIds) {
        if (!Array.isArray(supportIds) || supportIds.length === 0) {
            return [];
        }

        var names = [];
        for (var i = 0; i < supportIds.length; i++) {
            var name = getCharacterDisplayName(supportIds[i]);
            if (name !== 'Unknown') {
                names.push(name);
            }
        }
        return names;
    }

    function resolveSupportCharacters(supportIds) {
        if (!Array.isArray(supportIds) || supportIds.length === 0) {
            return [];
        }

        var characters = [];
        for (var i = 0; i < supportIds.length; i++) {
            var char = CharacterQueries.getCharacterById(supportIds[i]);
            if (char) {
                characters.push({
                    id: char.id,
                    name: CharacterQueries.getDisplayName(char),
                    status: CharacterQueries.getCurrentStatus(char),
                    character: char
                });
            }
        }
        return characters;
    }

    function getSafeProgress(value) {
        var progress = Number(value);
        if (!Number.isFinite(progress)) {
            return 0;
        }
        if (progress < 0) {
            return 0;
        }
        if (progress > 100) {
            return 100;
        }
        return Math.round(progress);
    }

    function getStatusInfo(status) {
        return MissionViews.getStatusInfo(status) || {
            label: status || 'Unknown',
            color: 'var(--text-dim)',
            class: 'status-unknown'
        };
    }

    function getPriorityInfo(priority) {
        return MissionViews.getPriorityInfo(priority) || {
            label: priority || 'Medium',
            color: 'var(--text-dim)',
            class: 'priority-medium'
        };
    }

    function getDifficultyLabel(difficulty) {
        return MissionViews.getDifficultyLabel(difficulty) || difficulty || 'Medium';
    }

    function getMissionTypeLabel(typeId) {
        return MissionViews.getMissionTypeLabel(typeId) || typeId || 'Unclassified';
    }

    function getSubtypeLabel(subtypeId) {
        return MissionViews.getSubtypeLabel(subtypeId) || subtypeId || '';
    }

    function getEscalationLabel(escalation) {
        return MissionViews.getEscalationLabel(escalation) || escalation || 'Tier II - Complicated';
    }

    // ============================================================
    // MISSION LIST VIEW MODEL
    // ============================================================

    /**
     * Get a view model for a list of missions.
     * Collection-level projection - avoids per-mission N+1 queries.
     * 
     * @param {object} options - Options
     * @param {string} options.filter - Status filter ('all', 'active', 'completed', 'cancelled')
     * @param {string} options.search - Search by title or missionId
     * @param {string} options.teamId - Filter by team ID
     * @param {string} options.typeId - Filter by mission type
     * @param {string} options.sort - Sort field ('title', 'date', 'priority', 'status', 'progress')
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @returns {object} { missions: Array, total: number, filtered: number, counts: object }
     */
    function getMissionListViewModel(options) {
        options = options || {};
        var filter = options.filter || 'all';
        var search = options.search || '';
        var teamId = options.teamId || null;
        var typeId = options.typeId || null;
        var sort = options.sort || 'date';
        var sortDirection = options.sortDirection || 'desc';

        // Get missions from MissionQueries
        var missions = MissionQueries.getMissions(filter);

        // Apply team filter
        if (teamId) {
            missions = missions.filter(function(m) {
                return m.assignedTeamId && String(m.assignedTeamId) === String(teamId);
            });
        }

        // Apply type filter
        if (typeId) {
            missions = missions.filter(function(m) {
                return m.primaryType === typeId || m.secondaryType === typeId;
            });
        }

        // Apply search filter
        if (search) {
            var lowerSearch = search.toLowerCase();
            missions = missions.filter(function(m) {
                var title = (m.title || '').toLowerCase();
                var missionId = (m.missionId || '').toLowerCase();
                var location = (m.location || '').toLowerCase();
                return title.indexOf(lowerSearch) !== -1 ||
                       missionId.indexOf(lowerSearch) !== -1 ||
                       location.indexOf(lowerSearch) !== -1;
            });
        }

        // Build list items
        var listItems = missions.map(function(m) {
            var priorityInfo = getPriorityInfo(m.priority);
            var statusInfo = getStatusInfo(m.status);
            var supportCount = Array.isArray(m.supportPersonnel) ? m.supportPersonnel.length : 0;

            return {
                id: m.id,
                missionId: m.missionId || '—',
                title: m.title || 'Untitled',
                status: m.status || 'active',
                statusLabel: statusInfo.label,
                statusClass: statusInfo.class,
                priority: m.priority || 'medium',
                priorityLabel: priorityInfo.label,
                priorityClass: priorityInfo.class,
                difficulty: m.difficulty || 'medium',
                difficultyLabel: getDifficultyLabel(m.difficulty),
                progress: getSafeProgress(m.progress),
                teamId: m.assignedTeamId,
                teamName: getTeamName(m.assignedTeamId),
                supportCount: supportCount,
                location: m.location || '',
                primaryType: m.primaryType || '',
                primaryTypeLabel: getMissionTypeLabel(m.primaryType),
                subtype: m.subtype || '',
                subtypeLabel: getSubtypeLabel(m.subtype),
                escalation: m.escalation || 'tier_ii',
                escalationLabel: getEscalationLabel(m.escalation),
                date: m.year ? m.year + (m.month ? '-' + String(m.month).padStart(2, '0') : '') : '',
                createdAt: m.createdAt || '',
                isCompleted: m.status === 'completed',
                isCancelled: m.status === 'cancelled',
                isActive: m.status === 'active',
                isReadyForCompletion: getSafeProgress(m.progress) === 100 && m.status !== 'completed'
            };
        });

        // Sort
        var total = listItems.length;

        listItems.sort(function(a, b) {
            var aVal, bVal;

            switch (sort) {
                case 'title':
                    aVal = a.title || '';
                    bVal = b.title || '';
                    break;
                case 'date':
                    aVal = a.date || a.createdAt || '';
                    bVal = b.date || b.createdAt || '';
                    break;
                case 'priority':
                    var priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
                    aVal = priorityOrder[a.priority] || 999;
                    bVal = priorityOrder[b.priority] || 999;
                    break;
                case 'status':
                    var statusOrder = { 'active': 0, 'completed': 1, 'cancelled': 2 };
                    aVal = statusOrder[a.status] || 999;
                    bVal = statusOrder[b.status] || 999;
                    break;
                case 'progress':
                    aVal = a.progress;
                    bVal = b.progress;
                    break;
                default:
                    aVal = a.title || '';
                    bVal = b.title || '';
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

        // Counts
        var counts = {
            total: missions.length,
            active: missions.filter(function(m) { return m.status === 'active'; }).length,
            completed: missions.filter(function(m) { return m.status === 'completed'; }).length,
            cancelled: missions.filter(function(m) { return m.status === 'cancelled'; }).length,
            ready: missions.filter(function(m) {
                return getSafeProgress(m.progress) === 100 && m.status !== 'completed';
            }).length
        };

        return {
            missions: listItems,
            total: total,
            filtered: listItems.length,
            counts: counts
        };
    }

    // ============================================================
    // MISSION DETAIL VIEW MODEL
    // ============================================================

    /**
     * Get a complete view model for a single mission.
     * Resolves team name, support personnel, and presentation metadata.
     * 
     * @param {string} missionId - Mission ID
     * @param {object} options - Options
     * @param {boolean} options.includeSupport - Include support personnel details (default: true)
     * @param {boolean} options.includeLog - Include activity log (default: true)
     * @returns {object|null} Mission detail view model or null
     */
    function getMissionDetailViewModel(missionId, options) {
        if (!missionId) {
            return null;
        }

        options = options || {};
        var includeSupport = options.includeSupport !== false;
        var includeLog = options.includeLog !== false;

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return null;
        }

        var priorityInfo = getPriorityInfo(mission.priority);
        var statusInfo = getStatusInfo(mission.status);
        var progress = getSafeProgress(mission.progress);

        var viewModel = {
            // Raw mission (defensive copy)
            mission: mission,

            // Resolved fields
            teamName: getTeamName(mission.assignedTeamId),
            teamType: getTeamType(mission.assignedTeamId),

            // Presentation metadata
            priorityLabel: priorityInfo.label,
            priorityColor: priorityInfo.color,
            priorityClass: priorityInfo.class,
            statusLabel: statusInfo.label,
            statusColor: statusInfo.color,
            statusClass: statusInfo.class,
            difficultyLabel: getDifficultyLabel(mission.difficulty),
            primaryTypeLabel: getMissionTypeLabel(mission.primaryType),
            secondaryTypeLabel: mission.secondaryType ? getMissionTypeLabel(mission.secondaryType) : null,
            subtypeLabel: getSubtypeLabel(mission.subtype),
            escalationLabel: getEscalationLabel(mission.escalation),
            billingLabel: MissionViews.getBillingLabel(mission.billing),

            // Progress
            progress: progress,
            isComplete: progress === 100,
            isReadyForCompletion: progress === 100 && mission.status !== 'completed',

            // Status flags
            isActive: mission.status === 'active',
            isCompleted: mission.status === 'completed',
            isCancelled: mission.status === 'cancelled',

            // Editability
            canEdit: mission.status !== 'completed' && mission.status !== 'cancelled',
            canModifyObjectives: mission.status !== 'completed' && mission.status !== 'cancelled',
            canComplete: mission.status === 'active' && progress === 100,
            canCancel: mission.status === 'active',
            canReactivate: mission.status === 'completed' || mission.status === 'cancelled',

            // Support personnel
            supportCount: Array.isArray(mission.supportPersonnel) ? mission.supportPersonnel.length : 0,
            supportNames: includeSupport ? resolveSupportNames(mission.supportPersonnel) : [],
            supportCharacters: includeSupport ? resolveSupportCharacters(mission.supportPersonnel) : [],

            // Log
            log: includeLog ? (mission.log || []).slice() : [],
            logCount: includeLog ? (mission.log || []).length : 0
        };

        return viewModel;
    }

    // ============================================================
    // MISSION FORM VIEW MODEL
    // ============================================================

    /**
     * Get a view model for the mission form.
     * Returns mission data with available teams and characters.
     * 
     * @param {object} options - Options
     * @param {string} options.editId - Mission ID to edit (optional)
     * @param {boolean} options.includeAllTeams - Include all teams (default: false, only eligible)
     * @returns {object} Form view model
     */
    function getMissionFormViewModel(options) {
        options = options || {};
        var editId = options.editId || null;
        var includeAllTeams = options.includeAllTeams || false;

        var mission = editId ? MissionQueries.getMission(editId) : null;

        // Get teams
        var teams = [];
        if (includeAllTeams) {
            // Get all active teams (not just eligible)
            var allTeams = TeamQueries.getTeams ? TeamQueries.getTeams(null, 'active', false) : [];
            teams = allTeams;
        } else {
            teams = MissionQueries.getEligibleTeams() || [];
        }

        // Get characters for support personnel selection
        var characters = CharacterQueries.getCharacters ? CharacterQueries.getCharacters() : [];

        // Sort characters by display name
        if (characters.length > 0) {
            characters.sort(function(a, b) {
                return CharacterQueries.getDisplayName(a).localeCompare(
                    CharacterQueries.getDisplayName(b)
                );
            });
        }

        // Get support IDs if editing
        var supportIds = mission && Array.isArray(mission.supportPersonnel)
            ? mission.supportPersonnel.slice()
            : [];

        // Get objectives if editing
        var objectives = mission && Array.isArray(mission.objectives)
            ? mission.objectives.slice()
            : [];

        return {
            mission: mission,
            isEdit: !!mission,
            editId: editId,
            teams: teams,
            characters: characters,
            supportIds: supportIds,
            objectives: objectives,
            defaultYear: new Date().getFullYear(),
            defaultMonth: new Date().getMonth() + 1,
            defaultDay: new Date().getDate()
        };
    }

    // ============================================================
    // MISSION PAGE VIEW MODEL
    // ============================================================

    /**
     * Get a complete mission page view model.
     * Combines list and stats for the main mission page.
     * 
     * @param {object} options - Options
     * @param {string} options.filter - Status filter
     * @param {string} options.search - Search term
     * @param {string} options.teamId - Team filter
     * @returns {object} Page view model
     */
    function getMissionPageViewModel(options) {
        options = options || {};
        var filter = options.filter || 'all';
        var search = options.search || '';
        var teamId = options.teamId || null;

        var listVM = getMissionListViewModel({
            filter: filter,
            search: search,
            teamId: teamId
        });

        // Get statistics
        var stats = MissionQueries.getStatistics ? MissionQueries.getStatistics() : null;

        return {
            missions: listVM.missions,
            total: listVM.total,
            filtered: listVM.filtered,
            counts: listVM.counts,
            filter: filter,
            search: search,
            teamId: teamId,
            statistics: stats || {
                total: 0,
                active: 0,
                completed: 0,
                cancelled: 0,
                byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
                byDifficulty: { easy: 0, medium: 0, hard: 0, expert: 0 }
            }
        };
    }

    // ============================================================
    // MISSION STATISTICS VIEW MODEL
    // ============================================================

    /**
     * Get mission statistics for dashboard display.
     * 
     * @returns {object} Statistics view model
     */
    function getMissionStatisticsViewModel() {
        var stats = MissionQueries.getStatistics ? MissionQueries.getStatistics() : null;

        if (!stats) {
            return {
                total: 0,
                active: 0,
                completed: 0,
                cancelled: 0,
                byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
                byDifficulty: { easy: 0, medium: 0, hard: 0, expert: 0 },
                completionRate: 0,
                activePercentage: 0
            };
        }

        var total = stats.total || 0;
        var active = stats.active || 0;
        var completed = stats.completed || 0;
        var cancelled = stats.cancelled || 0;

        return {
            total: total,
            active: active,
            completed: completed,
            cancelled: cancelled,
            byPriority: stats.byPriority || { critical: 0, high: 0, medium: 0, low: 0 },
            byDifficulty: stats.byDifficulty || { easy: 0, medium: 0, hard: 0, expert: 0 },
            completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
            activePercentage: total > 0 ? Math.round((active / total) * 100) : 0
        };
    }

    // ============================================================
    // RESOLUTION HELPERS (exposed for views)
    // ============================================================

    /**
     * Resolve a team name from a team ID.
     * 
     * @param {string} teamId - Team ID
     * @returns {string} Team name
     */
    function resolveTeamName(teamId) {
        return getTeamName(teamId);
    }

    /**
     * Resolve support personnel names from support IDs.
     * 
     * @param {array} supportIds - Array of character IDs
     * @returns {array} Array of character names
     */
    function resolveSupportNames(supportIds) {
        return resolveSupportNames(supportIds);
    }

    /**
     * Check if a mission can be edited.
     * 
     * @param {object} mission - Mission object
     * @returns {boolean} True if editable
     */
    function canEditMission(mission) {
        if (!mission) {
            return false;
        }
        return mission.status !== 'completed' && mission.status !== 'cancelled';
    }

    /**
     * Check if a mission can be completed.
     * 
     * @param {object} mission - Mission object
     * @returns {boolean} True if completable
     */
    function canCompleteMission(mission) {
        if (!mission) {
            return false;
        }
        if (mission.status !== 'active') {
            return false;
        }
        var progress = getSafeProgress(mission.progress);
        return progress === 100;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionAggregator = {
        // Projections
        getMissionListViewModel: getMissionListViewModel,
        getMissionDetailViewModel: getMissionDetailViewModel,
        getMissionFormViewModel: getMissionFormViewModel,
        getMissionPageViewModel: getMissionPageViewModel,
        getMissionStatisticsViewModel: getMissionStatisticsViewModel,

        // Resolution helpers
        resolveTeamName: resolveTeamName,
        resolveSupportNames: resolveSupportNames,
        resolveSupportCharacters: resolveSupportCharacters,
        canEditMission: canEditMission,
        canCompleteMission: canCompleteMission,

        // Exposed for convenience (delegates to Views)
        getPriorityInfo: getPriorityInfo,
        getStatusInfo: getStatusInfo,
        getDifficultyLabel: getDifficultyLabel,
        getMissionTypeLabel: getMissionTypeLabel,
        getSubtypeLabel: getSubtypeLabel,
        getEscalationLabel: getEscalationLabel,
        getSafeProgress: getSafeProgress
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionAggregator;
        var missing = [];

        var required = [
            'getMissionListViewModel',
            'getMissionDetailViewModel',
            'getMissionFormViewModel',
            'getMissionPageViewModel',
            'getMissionStatisticsViewModel',
            'resolveTeamName',
            'resolveSupportNames',
            'resolveSupportCharacters',
            'canEditMission',
            'canCompleteMission'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[MissionAggregator] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[MissionAggregator] All exports verified successfully.');
        }
    })();

})();
