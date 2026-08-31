/**
 * js/modules/missions/missions-queries.js - Mission Queries
 * PURE read-only queries. Does NOT mutate data.
 * 
 * QUERY PHILOSOPHY:
 *   - All queries are PURE: no side effects, no mutation
 *   - Use MissionsCore for data access
 *   - Use MissionsSchema for display helpers
 *   - Return defensive copies where appropriate
 */

(function() {
    'use strict';

    if (window.__missionsQueriesLoaded) return;

    if (!window.MissionsCore) {
        console.error('MissionsQueries: MissionsCore required.');
        return;
    }

    if (!window.MissionsSchema) {
        console.error('MissionsQueries: MissionsSchema required.');
        return;
    }

    window.__missionsQueriesLoaded = true;

    var Core = window.MissionsCore;
    var Schema = window.MissionsSchema;

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getTeamName(teamId) {
        if (!teamId) return 'Unassigned';
        var data = window.data || {};
        if (!Array.isArray(data.teams)) return 'Unknown Team';
        var team = data.teams.find(function(t) {
            return t && String(t.id) === String(teamId);
        });
        return team ? team.name : 'Unknown Team';
    }

    function getTeamTypeLabel(teamId) {
        if (!teamId) return '';
        var data = window.data || {};
        if (!Array.isArray(data.teams)) return '';
        var team = data.teams.find(function(t) {
            return t && String(t.id) === String(teamId);
        });
        if (!team) return '';
        var typeMap = {
            'academic': 'Academic',
            'professional': 'Professional',
            'temporary': 'Temporary',
            'internship': 'Temporary'
        };
        return typeMap[team.type] || '';
    }

    function getDisplayName(char) {
        if (!char) return 'Unknown';
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char.name || char.firstName || 'Unknown';
    }

    function getSupportPersonnelNames(mission) {
        if (!mission || !mission.supportPersonnel) return [];
        var names = [];
        var data = window.data || {};
        if (!Array.isArray(data.characters)) return names;
        mission.supportPersonnel.forEach(function(id) {
            var char = data.characters.find(function(c) {
                return c && String(c.id) === String(id);
            });
            if (char) {
                names.push(getDisplayName(char));
            }
        });
        return names;
    }

    // ============================================================
    // QUERIES API
    // ============================================================

    var MissionsQueries = {
        // Core data access
        getMission: Core.getMission,
        getMissions: Core.getMissions,
        getMissionsByType: Core.getMissionsByType,
        getMissionTypeCounts: Core.getMissionTypeCounts,

        // Team info
        getTeamName: getTeamName,
        getTeamTypeLabel: getTeamTypeLabel,

        // Support personnel
        getSupportPersonnel: Core.getSupportPersonnel,
        getSupportPersonnelNames: getSupportPersonnelNames,

        // Schema display helpers (delegated)
        getMissionTypeLabel: Schema.getMissionTypeLabel,
        getMissionTypeIcon: Schema.getMissionTypeIcon,
        getMissionTypeColor: Schema.getMissionTypeColor,
        getSubtypeLabel: Schema.getSubtypeLabel,
        getEscalationLabel: Schema.getEscalationLabel,
        getBillingLabel: Schema.getBillingLabel,
        getPriorityInfo: Schema.getPriorityInfo,
        getStatusInfo: Schema.getStatusInfo,
        getDifficultyLabel: Schema.getDifficultyLabel,
        getMonthName: Schema.getMonthName,

        // Mission ID
        generateMissionId: Core.generateMissionId || function() { return ''; },

        // Constants
        MISSION_TYPES: Schema.MISSION_TYPES
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsQueries = MissionsQueries;

})();
