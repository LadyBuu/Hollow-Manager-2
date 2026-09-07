/**
 * js/modules/missions/missions-queries.js - Mission Queries
 * PURE read-only queries. Does NOT mutate data.
 * 
 * QUERY PHILOSOPHY:
 *   - All queries are PURE: no side effects, no mutation
 *   - Use MissionRules for domain calculations
 *   - Use CharacterQueries for character data
 *   - Use TeamQueries for team data
 *   - Return DEFENSIVE COPIES (clones) where appropriate
 *   - Do NOT access window.data directly
 *   - Do NOT expose live references that can be mutated
 *   - Do NOT forward Schema APIs - use Schema directly in views if needed
 * 
 * QUERY LAYER CONTRACT:
 *   - getMission() returns a CLONE - safe for reading
 *   - getMissions() returns CLONES - safe for reading
 *   - All ID comparisons use IdUtils.normaliseId()
 *   - Team/character lookups use canonical domain queries
 *   - No presentation metadata - use MissionViews for that
 *   - No validation predicates - use MissionsSchema for that
 * 
 * DEPENDENCIES:
 *   - window.MissionsSchema (required - for structural access)
 *   - window.MissionRules (required - for calculations)
 *   - window.CharacterQueries (required)
 *   - window.TeamQueries (required)
 *   - window.IdUtils (required - for ID normalisation)
 *   - window.ObjectUtils (required - for deep cloning)
 */

(function() {
    'use strict';

    if (window.__missionsQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.MissionsSchema) {
        missing.push('MissionsSchema');
    }

    if (!window.MissionRules) {
        missing.push('MissionRules');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamById !== 'function') {
        missing.push('TeamQueries.getTeamById');
    }
    if (!window.TeamQueries || typeof window.TeamQueries.getTeamName !== 'function') {
        missing.push('TeamQueries.getTeamName');
    }

    if (!window.IdUtils || typeof window.IdUtils.normaliseId !== 'function') {
        missing.push('IdUtils.normaliseId');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (missing.length > 0) {
        throw new Error('[MissionsQueries] Missing dependencies: ' + missing.join(', '));
    }

    window.__missionsQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Schema = window.MissionsSchema;
    var Rules = window.MissionRules;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var IdUtils = window.IdUtils;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_STATUSES = Schema.VALID_STATUSES;

    // ============================================================
    // HELPERS
    // ============================================================

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getMissionInternal(id) {
        var target = normaliseId(id);
        if (target === null) {
            return null;
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.missions)) {
            return null;
        }
        for (var i = 0; i < data.missions.length; i++) {
            var mission = data.missions[i];
            if (mission && normaliseId(mission.id) === target) {
                return mission;
            }
        }
        return null;
    }

    function cloneMission(mission) {
        if (!mission || typeof mission !== 'object') {
            return null;
        }
        return deepClone(mission);
    }

    function cloneMissionsArray(missions) {
        if (!Array.isArray(missions)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < missions.length; i++) {
            if (missions[i]) {
                result.push(cloneMission(missions[i]));
            }
        }
        return result;
    }

    function getMissionsInternal(filter) {
        var data = getDataStore();
        if (!data || !Array.isArray(data.missions)) {
            return [];
        }

        var missions = [];
        for (var i = 0; i < data.missions.length; i++) {
            if (data.missions[i]) {
                missions.push(data.missions[i]);
            }
        }

        if (filter === 'active') {
            var active = [];
            for (var j = 0; j < missions.length; j++) {
                if (missions[j].status === 'active') {
                    active.push(missions[j]);
                }
            }
            missions = active;
        } else if (filter === 'completed') {
            var completed = [];
            for (var k = 0; k < missions.length; k++) {
                if (missions[k].status === 'completed') {
                    completed.push(missions[k]);
                }
            }
            missions = completed;
        } else if (filter === 'cancelled') {
            var cancelled = [];
            for (var l = 0; l < missions.length; l++) {
                if (missions[l].status === 'cancelled') {
                    cancelled.push(missions[l]);
                }
            }
            missions = cancelled;
        }

        return missions;
    }

    // ============================================================
    // TEAM ELIGIBILITY - Mission-specific
    // ============================================================

    /**
     * Get teams eligible for mission assignment.
     * Uses MissionRules.isTeamEligibleForMission().
     * 
     * @returns {array} Array of eligible team objects (defensive copies)
     */
    function getEligibleTeams() {
        var teams = TeamQueries.getActiveTeams();
        return Rules.filterEligibleTeams(teams);
    }

    // ============================================================
    // MISSION QUERIES
    // ============================================================

    /**
     * Get a mission by ID (defensive copy).
     * 
     * @param {string} id - Mission ID
     * @returns {object|null} Mission object or null
     */
    function getMission(id) {
        var mission = getMissionInternal(id);
        if (!mission) {
            return null;
        }
        return cloneMission(mission);
    }

    /**
     * Get missions with optional filter (defensive copies).
     * 
     * @param {string} filter - 'all', 'active', 'completed', 'cancelled'
     * @returns {array} Array of mission clones
     */
    function getMissions(filter) {
        var missions = getMissionsInternal(filter);
        return cloneMissionsArray(missions);
    }

    /**
     * Get missions by primary or secondary type (defensive copies).
     * 
     * @param {string} typeId - Mission type ID
     * @returns {array} Array of mission clones
     */
    function getMissionsByType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return [];
        }

        var missions = getMissionsInternal('all');
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m.primaryType === typeId || m.secondaryType === typeId) {
                result.push(cloneMission(m));
            }
        }

        return result;
    }

    /**
     * Get missions assigned to a specific team (defensive copies).
     * 
     * @param {string} teamId - Team ID
     * @param {string} filter - Optional status filter
     * @returns {array} Array of mission clones
     */
    function getMissionsByTeam(teamId, filter) {
        var target = normaliseId(teamId);
        if (target === null) {
            return [];
        }

        var missions = getMissionsInternal(filter);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m.assignedTeamId && normaliseId(m.assignedTeamId) === target) {
                result.push(cloneMission(m));
            }
        }

        return result;
    }

    /**
     * Get missions with a specific tag (defensive copies).
     * 
     * @param {string} tag - Tag to search for
     * @param {string} filter - Optional status filter
     * @returns {array} Array of mission clones
     */
    function getMissionsByTag(tag, filter) {
        if (!tag || typeof tag !== 'string') {
            return [];
        }

        var searchTag = tag.toLowerCase().trim();
        if (!searchTag) {
            return [];
        }

        var missions = getMissionsInternal(filter);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!Array.isArray(m.tags)) {
                continue;
            }

            var found = false;
            for (var j = 0; j < m.tags.length; j++) {
                if (typeof m.tags[j] === 'string' && m.tags[j].toLowerCase().trim() === searchTag) {
                    found = true;
                    break;
                }
            }

            if (found) {
                result.push(cloneMission(m));
            }
        }

        return result;
    }

    /**
     * Get unique tags across all missions (normalised).
     * 
     * @param {string} filter - Optional status filter
     * @returns {array} Array of unique tag strings (normalised)
     */
    function getUniqueTags(filter) {
        var missions = getMissionsInternal(filter);
        var tagSet = Object.create(null);

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (Array.isArray(m.tags)) {
                for (var j = 0; j < m.tags.length; j++) {
                    var tag = m.tags[j];
                    if (tag && typeof tag === 'string') {
                        var normalized = tag.trim().toLowerCase();
                        if (normalized) {
                            tagSet[normalized] = true;
                        }
                    }
                }
            }
        }

        var result = Object.keys(tagSet);
        result.sort();
        return result;
    }

    /**
     * Search missions by text in title, description, or notes.
     * 
     * @param {string} query - Search query
     * @param {string} filter - Optional status filter
     * @returns {array} Array of matching mission clones
     */
    function searchMissions(query, filter) {
        if (!query || typeof query !== 'string') {
            return getMissions(filter);
        }

        var searchTerm = query.toLowerCase().trim();
        if (!searchTerm) {
            return getMissions(filter);
        }

        var missions = getMissionsInternal(filter);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            var title = (m.title || '').toLowerCase();
            var description = (m.description || '').toLowerCase();
            var notes = (m.notes || '').toLowerCase();
            var missionId = (m.missionId || '').toLowerCase();

            if (title.indexOf(searchTerm) !== -1 ||
                description.indexOf(searchTerm) !== -1 ||
                notes.indexOf(searchTerm) !== -1 ||
                missionId.indexOf(searchTerm) !== -1) {
                result.push(cloneMission(m));
            }
        }

        return result;
    }

    // ============================================================
    // SUPPORT PERSONNEL QUERIES
    // ============================================================

    /**
     * Get support personnel as character objects for a mission.
     * 
     * @param {object|string} mission - Mission object or mission ID
     * @returns {array} Array of character objects (defensive copies)
     */
    function getSupportPersonnel(mission) {
        var missionObj;

        if (mission && typeof mission === 'object') {
            missionObj = mission;
        } else {
            missionObj = getMission(mission);
        }

        if (!missionObj || !Array.isArray(missionObj.supportPersonnel)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < missionObj.supportPersonnel.length; i++) {
            var id = missionObj.supportPersonnel[i];
            var character = CharacterQueries.getCharacterById(id);
            if (character) {
                result.push(character);
            }
        }

        return result;
    }

    /**
     * Get support personnel names as an array of strings.
     * 
     * @param {object|string} mission - Mission object or mission ID
     * @returns {array} Array of character names
     */
    function getSupportPersonnelNames(mission) {
        var characters = getSupportPersonnel(mission);
        var names = [];
        for (var i = 0; i < characters.length; i++) {
            names.push(CharacterQueries.getDisplayName(characters[i]));
        }
        return names;
    }

    // ============================================================
    // MISSION TYPE COUNTS
    // ============================================================

    /**
     * Get mission type counts.
     * 
     * @returns {object} Counts by mission type
     */
    function getMissionTypeCounts() {
        var missions = getMissionsInternal('all');
        var typeKeys = Object.keys(Schema.MISSION_TYPES);
        var counts = {};

        for (var i = 0; i < typeKeys.length; i++) {
            counts[typeKeys[i]] = 0;
        }

        for (var j = 0; j < missions.length; j++) {
            var m = missions[j];
            if (m.primaryType && counts[m.primaryType] !== undefined) {
                counts[m.primaryType]++;
            }
        }

        return counts;
    }

    // ============================================================
    // MISSION STATISTICS
    // ============================================================

    /**
     * Get mission statistics.
     * 
     * @returns {object} { total, active, completed, cancelled, byPriority, byDifficulty, byType }
     */
    function getStatistics() {
        var missions = getMissionsInternal('all');
        var stats = {
            total: missions.length,
            active: 0,
            completed: 0,
            cancelled: 0,
            byPriority: {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0
            },
            byDifficulty: {
                easy: 0,
                medium: 0,
                hard: 0,
                expert: 0
            },
            byType: {}
        };

        var typeKeys = Object.keys(Schema.MISSION_TYPES);
        for (var tk = 0; tk < typeKeys.length; tk++) {
            stats.byType[typeKeys[tk]] = 0;
        }

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];

            if (m.status === 'active') {
                stats.active++;
            } else if (m.status === 'completed') {
                stats.completed++;
            } else if (m.status === 'cancelled') {
                stats.cancelled++;
            }

            if (m.priority && stats.byPriority[m.priority] !== undefined) {
                stats.byPriority[m.priority]++;
            }

            if (m.difficulty && stats.byDifficulty[m.difficulty] !== undefined) {
                stats.byDifficulty[m.difficulty]++;
            }

            if (m.primaryType && stats.byType[m.primaryType] !== undefined) {
                stats.byType[m.primaryType]++;
            }
        }

        return stats;
    }

    /**
     * Get active mission count.
     * 
     * @returns {number} Number of active missions
     */
    function getActiveCount() {
        return getStatistics().active;
    }

    /**
     * Get completed mission count.
     * 
     * @returns {number} Number of completed missions
     */
    function getCompletedCount() {
        return getStatistics().completed;
    }

    /**
     * Get cancelled mission count.
     * 
     * @returns {number} Number of cancelled missions
     */
    function getCancelledCount() {
        return getStatistics().cancelled;
    }

    // ============================================================
    // GETTERS FOR QUERY (Defensive copies)
    // ============================================================

    /**
     * Get all valid statuses as a defensive copy.
     * 
     * @returns {array} Array of valid status strings
     */
    function getValidStatuses() {
        return VALID_STATUSES.slice();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsQueries = {
        // Mission queries (defensive copies)
        getMission: getMission,
        getMissions: getMissions,
        getMissionsByType: getMissionsByType,
        getMissionsByTeam: getMissionsByTeam,
        getMissionsByTag: getMissionsByTag,
        getUniqueTags: getUniqueTags,
        searchMissions: searchMissions,

        // Support personnel
        getSupportPersonnel: getSupportPersonnel,
        getSupportPersonnelNames: getSupportPersonnelNames,

        // Type counts
        getMissionTypeCounts: getMissionTypeCounts,

        // Statistics
        getStatistics: getStatistics,
        getActiveCount: getActiveCount,
        getCompletedCount: getCompletedCount,
        getCancelledCount: getCancelledCount,

        // Team eligibility
        getEligibleTeams: getEligibleTeams,

        // Valid values (defensive)
        getValidStatuses: getValidStatuses
    };

})();
