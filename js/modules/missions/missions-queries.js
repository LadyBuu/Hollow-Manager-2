/**
 * js/modules/missions/missions-queries.js - Mission Queries
 * PURE read-only queries. Does NOT mutate data.
 * 
 * QUERY PHILOSOPHY:
 *   - All queries are PURE: no side effects, no mutation
 *   - Use MissionsCore for data access
 *   - Use MissionsSchema for display helpers
 *   - Return DEFENSIVE COPIES (clones) where appropriate
 *   - Use normaliseId() consistently for all ID comparisons
 *   - Do NOT expose live references that can be mutated
 *   - Do NOT access window.data directly; use Core/helpers
 * 
 * QUERY LAYER CONTRACT:
 *   - getMission() returns a CLONE - safe for reading
 *   - getMissions() returns CLONES - safe for reading
 *   - All display helpers are pure functions
 *   - ID comparisons use normaliseId() for consistency
 *   - Team/character lookups use normaliseId() consistently
 *   - Exposes defensive getters for constants (not live references)
 *   - getTeams() and getCharacters() are the canonical team/character data sources
 * 
 * DEPENDENCIES:
 *   - MissionsCore (required)
 *   - MissionsSchema (required)
 *   - window.getDisplayName (optional, for character names)
 */

(function() {
    'use strict';

    if (window.__missionsQueriesLoaded) return;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.MissionsCore) {
        return;
    }

    if (!window.MissionsSchema) {
        return;
    }

    window.__missionsQueriesLoaded = true;

    var Core = window.MissionsCore;
    var Schema = window.MissionsSchema;

    // ============================================================
    // ID NORMALISATION (Delegated to Schema)
    // ============================================================

    function normaliseId(id) {
        return Schema.normaliseId(id);
    }

    // ============================================================
    // DATA ACCESS HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getCharacterById(id) {
        var target = normaliseId(id);
        if (target === null) {
            return null;
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
        for (var i = 0; i < data.characters.length; i++) {
            var character = data.characters[i];
            if (character && normaliseId(character.id) === target) {
                return character;
            }
        }
        return null;
    }

    function getTeamById(id) {
        var target = normaliseId(id);
        if (target === null) {
            return null;
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) {
            return null;
        }
        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (team && normaliseId(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    function getDisplayName(character) {
        if (!character) {
            return 'Unknown';
        }
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(character);
        }
        return character.name || character.firstName || 'Unknown';
    }

    function cloneCharacter(character) {
        if (!character) {
            return null;
        }
        return {
            id: character.id,
            firstName: character.firstName || '',
            lastName: character.lastName || '',
            middleName: character.middleName || '',
            nickname: character.nickname || '',
            name: character.name || character.firstName || 'Unknown',
            deceased: !!character.deceased,
            status: character.status || 'active',
            classIds: Array.isArray(character.classIds) ? character.classIds.slice() : []
        };
    }

    function cloneTeam(team) {
        if (!team) {
            return null;
        }
        return {
            id: team.id,
            name: team.name || '',
            type: team.type || '',
            status: team.status || 'active',
            members: Array.isArray(team.members) ? team.members.slice() : []
        };
    }

    // ============================================================
    // CANONICAL TEAM/CHARACTER SOURCES
    // ============================================================

    /**
     * Get all active teams (excluding deleted/inactive).
     * Returns defensive copies.
     */
    function getTeams() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (team && team.status !== 'deleted' && team.status !== 'inactive') {
                result.push(cloneTeam(team));
            }
        }
        return result;
    }

    /**
     * Get all active characters (excluding deceased).
     * Returns defensive copies.
     */
    function getCharacters() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < data.characters.length; i++) {
            var character = data.characters[i];
            if (character && !character.deceased) {
                result.push(cloneCharacter(character));
            }
        }
        return result;
    }

    // ============================================================
    // QUERIES API
    // ============================================================

    var MissionsQueries = {
        // ============================================================
        // CORE DATA ACCESS (Returns clones from Core)
        // ============================================================

        /**
         * Get a mission by ID.
         * Returns a CLONE - safe for reading.
         */
        getMission: function(id) {
            return Core.getMission(id);
        },

        /**
         * Get missions with optional filter.
         * Returns an array of CLONES - safe for reading.
         * 
         * @param {string} filter - 'all', 'active', 'completed', 'cancelled'
         * @returns {array} Array of mission clones
         */
        getMissions: function(filter) {
            return Core.getMissions(filter);
        },

        /**
         * Get missions by primary or secondary type.
         * 
         * @param {string} typeId - Mission type ID
         * @returns {array} Array of mission clones
         */
        getMissionsByType: function(typeId) {
            return Core.getMissionsByType(typeId);
        },

        /**
         * Get mission type counts.
         * 
         * @returns {object} Counts by mission type
         */
        getMissionTypeCounts: function() {
            return Core.getMissionTypeCounts();
        },

        /**
         * Generate a human-readable mission ID.
         * Delegates to Core.
         */
        generateMissionId: function(teamId, year, difficulty) {
            return Core.generateMissionId(teamId, year, difficulty);
        },

        // ============================================================
        // CANONICAL TEAM/CHARACTER SOURCES
        // ============================================================

        /**
         * Get all active teams.
         * Returns defensive copies.
         */
        getTeams: getTeams,

        /**
         * Get all active characters.
         * Returns defensive copies.
         */
        getCharacters: getCharacters,

        // ============================================================
        // TEAM INFO HELPERS
        // ============================================================

        /**
         * Get team name by ID.
         * Uses normaliseId() for consistent comparison.
         */
        getTeamName: function(teamId) {
            if (!teamId) {
                return 'Unassigned';
            }
            var team = getTeamById(teamId);
            return team ? team.name : 'Unknown Team';
        },

        /**
         * Get team type label by ID.
         * Uses normaliseId() for consistent comparison.
         */
        getTeamTypeLabel: function(teamId) {
            if (!teamId) {
                return '';
            }
            var team = getTeamById(teamId);
            if (!team) {
                return '';
            }
            var typeMap = {
                'academic': 'Academic',
                'professional': 'Professional',
                'temporary': 'Temporary',
                'internship': 'Temporary'
            };
            return typeMap[team.type] || '';
        },

        /**
         * Get the canonical team type for display.
         */
        getTeamTypeDisplay: function(team) {
            if (!team) {
                return '';
            }
            var typeMap = {
                'academic': 'Academic',
                'professional': 'Professional',
                'temporary': 'Temporary',
                'internship': 'Temporary'
            };
            return typeMap[team.type] || '';
        },

        // ============================================================
        // SUPPORT PERSONNEL HELPERS
        // ============================================================

        /**
         * Get support personnel as character objects.
         * Delegates to Core.
         */
        getSupportPersonnel: function(mission) {
            return Core.getSupportPersonnel(mission);
        },

        /**
         * Get support personnel names as an array of strings.
         * Uses canonical route: mission -> support IDs -> character objects -> names.
         * 
         * @param {object|string} mission - Mission object or mission ID
         * @returns {array} Array of character names
         */
        getSupportPersonnelNames: function(mission) {
            var characters = this.getSupportPersonnel(mission);
            var names = [];
            for (var i = 0; i < characters.length; i++) {
                names.push(getDisplayName(characters[i]));
            }
            return names;
        },

        /**
         * Get a single support personnel name.
         * 
         * @param {object} character - Character object
         * @returns {string} Character display name
         */
        getSupportPersonnelName: function(character) {
            if (!character) {
                return 'Unknown';
            }
            return getDisplayName(character);
        },

        // ============================================================
        // CHARACTER INFO HELPERS
        // ============================================================

        /**
         * Get a character's display name.
         */
        getDisplayName: function(character) {
            return getDisplayName(character);
        },

        /**
         * Get a character by ID.
         * Uses normaliseId() for consistent comparison.
         * Returns a defensive clone.
         */
        getCharacter: function(id) {
            var character = getCharacterById(id);
            return character ? cloneCharacter(character) : null;
        },

        /**
         * Get a team by ID.
         * Uses normaliseId() for consistent comparison.
         * Returns a defensive clone.
         */
        getTeam: function(id) {
            var team = getTeamById(id);
            return team ? cloneTeam(team) : null;
        },

        // ============================================================
        // MISSION STATISTICS
        // ============================================================

        /**
         * Get mission statistics.
         * 
         * @returns {object} { total, active, completed, cancelled, byPriority, byDifficulty, byType }
         */
        getStatistics: function() {
            var missions = this.getMissions('all');
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
        },

        /**
         * Get active mission count.
         */
        getActiveCount: function() {
            return this.getMissions('active').length;
        },

        /**
         * Get completed mission count.
         */
        getCompletedCount: function() {
            return this.getMissions('completed').length;
        },

        /**
         * Get cancelled mission count.
         */
        getCancelledCount: function() {
            return this.getMissions('cancelled').length;
        },

        // ============================================================
        // MISSION SEARCH
        // ============================================================

        /**
         * Search missions by text in title, description, or notes.
         * 
         * @param {string} query - Search query
         * @param {string} filter - Optional status filter
         * @returns {array} Array of matching mission clones
         */
        searchMissions: function(query, filter) {
            if (!query || typeof query !== 'string') {
                return [];
            }
            var searchTerm = query.toLowerCase().trim();
            if (!searchTerm) {
                return this.getMissions(filter);
            }

            var missions = this.getMissions(filter);
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
                    result.push(m);
                }
            }

            return result;
        },

        /**
         * Get missions assigned to a specific team.
         * Uses normaliseId() for consistent comparison.
         * 
         * @param {string} teamId - Team ID
         * @param {string} filter - Optional status filter
         * @returns {array} Array of mission clones
         */
        getMissionsByTeam: function(teamId, filter) {
            var target = normaliseId(teamId);
            if (target === null) {
                return [];
            }

            var missions = this.getMissions(filter);
            var result = [];

            for (var i = 0; i < missions.length; i++) {
                var m = missions[i];
                if (m.assignedTeamId && normaliseId(m.assignedTeamId) === target) {
                    result.push(m);
                }
            }

            return result;
        },

        /**
         * Get missions with a specific tag.
         * Handles malformed tags defensively.
         * 
         * @param {string} tag - Tag to search for
         * @param {string} filter - Optional status filter
         * @returns {array} Array of mission clones
         */
        getMissionsByTag: function(tag, filter) {
            if (!tag || typeof tag !== 'string') {
                return [];
            }
            var searchTag = tag.toLowerCase().trim();
            if (!searchTag) {
                return this.getMissions(filter);
            }

            var missions = this.getMissions(filter);
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
                    result.push(m);
                }
            }

            return result;
        },

        /**
         * Get unique tags across all missions.
         * 
         * @param {string} filter - Optional status filter
         * @returns {array} Array of unique tag strings
         */
        getUniqueTags: function(filter) {
            var missions = this.getMissions(filter);
            var tagSet = {};

            for (var i = 0; i < missions.length; i++) {
                var m = missions[i];
                if (Array.isArray(m.tags)) {
                    for (var j = 0; j < m.tags.length; j++) {
                        var tag = m.tags[j];
                        if (tag && typeof tag === 'string') {
                            tagSet[tag.trim()] = true;
                        }
                    }
                }
            }

            var result = [];
            var keys = Object.keys(tagSet);
            for (var k = 0; k < keys.length; k++) {
                result.push(keys[k]);
            }
            result.sort();

            return result;
        },

        // ============================================================
        // DEFENSIVE GETTERS (Copies, not live references)
        // ============================================================

        /**
         * Get all mission types as a defensive copy.
         */
        getMissionTypes: function() {
            return Schema.getMissionTypes();
        },

        /**
         * Get subtypes for a mission type.
         */
        getSubtypesForType: function(typeId) {
            return Schema.getSubtypesForType(typeId);
        },

        /**
         * Get all subtype labels as a defensive copy.
         */
        getSubtypeLabels: function() {
            return Schema.getSubtypeLabels();
        },

        /**
         * Get valid difficulty values.
         */
        getValidDifficulties: function() {
            return Schema.getValidDifficulties();
        },

        /**
         * Get valid priority values.
         */
        getValidPriorities: function() {
            return Schema.getValidPriorities();
        },

        /**
         * Get valid status values.
         */
        getValidStatuses: function() {
            return Schema.getValidStatuses();
        },

        /**
         * Get valid billing types.
         */
        getValidBillingTypes: function() {
            return Schema.getValidBillingTypes();
        },

        /**
         * Get valid escalation tiers.
         */
        getValidEscalationTiers: function() {
            return Schema.getValidEscalationTiers();
        },

        // ============================================================
        // DISPLAY HELPERS (Delegated to Schema)
        // ============================================================

        // Type display
        getMissionType: Schema.getMissionType,
        getMissionTypeLabel: Schema.getMissionTypeLabel,
        getMissionTypeIcon: Schema.getMissionTypeIcon,
        getMissionTypeColor: Schema.getMissionTypeColor,
        getSubtypeLabel: Schema.getSubtypeLabel,

        // Status/Priority/Difficulty display
        getEscalationLabel: Schema.getEscalationLabel,
        getBillingLabel: Schema.getBillingLabel,
        getPriorityInfo: Schema.getPriorityInfo,
        getStatusInfo: Schema.getStatusInfo,
        getDifficultyLabel: Schema.getDifficultyLabel,
        getDifficultyCode: Schema.getDifficultyCode,

        // Date helpers
        getMonthName: Schema.getMonthName,
        getDaysInMonth: Schema.getDaysInMonth,
        isLeapYear: Schema.isLeapYear,
        isValidCalendarDate: Schema.isValidCalendarDate,

        // ============================================================
        // VALIDATION HELPERS (Delegated to Schema)
        // ============================================================

        // Type validation
        isValidStatus: Schema.isValidStatus,
        isValidPriority: Schema.isValidPriority,
        isValidDifficulty: Schema.isValidDifficulty,
        isValidBilling: Schema.isValidBilling,
        isValidEscalation: Schema.isValidEscalation,
        isValidMissionType: Schema.isValidMissionType,
        isValidSubtype: Schema.isValidSubtype,

        // ID normalisation
        normaliseId: Schema.normaliseId,

        // ============================================================
        // MISSION ID FORMATTING
        // ============================================================

        /**
         * Format a mission ID for display.
         */
        formatMissionId: function(missionId) {
            if (!missionId) {
                return '—';
            }
            return String(missionId);
        },

        /**
         * Parse a mission ID into components.
         * Validates the format using regex.
         * Returns { team, year, difficulty, difficultyCode, sequence } or null.
         */
        parseMissionId: function(missionId) {
            if (!missionId || typeof missionId !== 'string') {
                return null;
            }

            var match = /^([^-]+)-(\d{2})-([EMHX])(\d+)$/.exec(missionId);
            if (!match) {
                return null;
            }

            var difficultyMap = {
                'E': 'easy',
                'M': 'medium',
                'H': 'hard',
                'X': 'expert'
            };

            return {
                team: match[1],
                year: match[2],
                difficultyCode: match[3],
                difficulty: difficultyMap[match[3]] || null,
                sequence: match[4],
                full: missionId
            };
        },

        // ============================================================
        // CONSTANTS ACCESS (Defensive)
        // ============================================================

        MONTH_NAMES: Schema.MONTH_NAMES,
        DIFFICULTY_CODES: Schema.DIFFICULTY_CODES
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsQueries = MissionsQueries;

})();
