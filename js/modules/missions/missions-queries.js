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
 * 
 * QUERY LAYER CONTRACT:
 *   - getMission() returns a CLONE - safe for reading, not a live reference
 *   - getMissions() returns CLONES - safe for reading
 *   - All display helpers are pure functions
 *   - ID comparisons use Schema.normaliseId() for consistency
 * 
 * DEPENDENCIES:
 *   - MissionsCore (required)
 *   - MissionsSchema (required)
 *   - window.getDisplayName (optional, for character names)
 *   - window.getCharacterById (optional, for character lookup)
 *   - window.getTeamById (optional, for team lookup)
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
    // ID NORMALISATION (Delegated to Schema)
    // ============================================================

    function normaliseId(id) {
        return Schema.normaliseId(id);
    }

    // ============================================================
    // DATA ACCESS HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        return window.data;
    }

    function getCharacterById(id) {
        var target = normaliseId(id);
        if (target === null) return null;
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && normaliseId(c.id) === target;
        }) || null;
    }

    function getTeamById(id) {
        var target = normaliseId(id);
        if (target === null) return null;
        var data = getDataStore();
        if (!data || !Array.isArray(data.teams)) return null;
        return data.teams.find(function(t) {
            return t && normaliseId(t.id) === target;
        }) || null;
    }

    function getDisplayName(char) {
        if (!char) return 'Unknown';
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char.name || char.firstName || 'Unknown';
    }

    // ============================================================
    // QUERIES API
    // ============================================================

    var MissionsQueries = {
        // ============================================================
        // CORE DATA ACCESS (Returns clones)
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
        // TEAM INFO HELPERS
        // ============================================================

        /**
         * Get team name by ID.
         * Uses normaliseId() for consistent comparison.
         */
        getTeamName: function(teamId) {
            if (!teamId) return 'Unassigned';
            var team = getTeamById(teamId);
            return team ? team.name : 'Unknown Team';
        },

        /**
         * Get team type label by ID.
         * Uses normaliseId() for consistent comparison.
         */
        getTeamTypeLabel: function(teamId) {
            if (!teamId) return '';
            var team = getTeamById(teamId);
            if (!team) return '';
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
            if (!team) return '';
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
         * 
         * @param {object|string} mission - Mission object or mission ID
         * @returns {array} Array of character names
         */
        getSupportPersonnelNames: function(mission) {
            var missionObj = typeof mission === 'string' ? this.getMission(mission) : mission;
            if (!missionObj || !missionObj.supportPersonnel) return [];

            var names = [];
            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) return names;

            missionObj.supportPersonnel.forEach(function(id) {
                var char = data.characters.find(function(c) {
                    return c && normaliseId(c.id) === normaliseId(id);
                });
                if (char) {
                    names.push(getDisplayName(char));
                }
            });

            return names;
        },

        /**
         * Get a single support personnel name.
         * 
         * @param {object} char - Character object
         * @returns {string} Character display name
         */
        getSupportPersonnelName: function(char) {
            if (!char) return 'Unknown';
            return getDisplayName(char);
        },

        // ============================================================
        // CHARACTER INFO HELPERS
        // ============================================================

        /**
         * Get a character's display name.
         */
        getDisplayName: function(char) {
            return getDisplayName(char);
        },

        /**
         * Get a character by ID.
         * Uses normaliseId() for consistent comparison.
         * Returns a CLONE - safe for reading.
         */
        getCharacter: function(id) {
            var char = getCharacterById(id);
            if (!char) return null;
            // Return a shallow clone
            return {
                id: char.id,
                firstName: char.firstName || '',
                lastName: char.lastName || '',
                middleName: char.middleName || '',
                nickname: char.nickname || '',
                name: char.name || char.firstName || 'Unknown',
                deceased: !!char.deceased,
                status: char.status || 'active',
                classIds: Array.isArray(char.classIds) ? char.classIds.slice() : []
            };
        },

        /**
         * Get a team by ID.
         * Uses normaliseId() for consistent comparison.
         * Returns a CLONE - safe for reading.
         */
        getTeam: function(id) {
            var team = getTeamById(id);
            if (!team) return null;
            return {
                id: team.id,
                name: team.name || '',
                type: team.type || '',
                status: team.status || 'active',
                members: Array.isArray(team.members) ? team.members.slice() : []
            };
        },

        // ============================================================
        // MISSION STATISTICS
        // ============================================================

        /**
         * Get mission statistics.
         * 
         * @returns {object} { total, active, completed, cancelled, byPriority, byDifficulty }
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

            // Initialize byType
            var typeKeys = Object.keys(Schema.MISSION_TYPES);
            typeKeys.forEach(function(key) {
                stats.byType[key] = 0;
            });

            missions.forEach(function(m) {
                if (m.status === 'active') stats.active++;
                else if (m.status === 'completed') stats.completed++;
                else if (m.status === 'cancelled') stats.cancelled++;

                if (m.priority && stats.byPriority[m.priority] !== undefined) {
                    stats.byPriority[m.priority]++;
                }

                if (m.difficulty && stats.byDifficulty[m.difficulty] !== undefined) {
                    stats.byDifficulty[m.difficulty]++;
                }

                if (m.primaryType && stats.byType[m.primaryType] !== undefined) {
                    stats.byType[m.primaryType]++;
                }
            });

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
            if (!query || typeof query !== 'string') return [];
            var searchTerm = query.toLowerCase().trim();
            if (!searchTerm) return this.getMissions(filter);

            var missions = this.getMissions(filter);
            return missions.filter(function(m) {
                var title = (m.title || '').toLowerCase();
                var description = (m.description || '').toLowerCase();
                var notes = (m.notes || '').toLowerCase();
                var missionId = (m.missionId || '').toLowerCase();

                return title.indexOf(searchTerm) !== -1 ||
                       description.indexOf(searchTerm) !== -1 ||
                       notes.indexOf(searchTerm) !== -1 ||
                       missionId.indexOf(searchTerm) !== -1;
            });
        },

        /**
         * Get missions assigned to a specific team.
         * 
         * @param {string} teamId - Team ID
         * @param {string} filter - Optional status filter
         * @returns {array} Array of mission clones
         */
        getMissionsByTeam: function(teamId, filter) {
            var target = normaliseId(teamId);
            if (target === null) return [];

            var missions = this.getMissions(filter);
            return missions.filter(function(m) {
                return m.assignedTeamId && normaliseId(m.assignedTeamId) === target;
            });
        },

        /**
         * Get missions with a specific tag.
         * 
         * @param {string} tag - Tag to search for
         * @param {string} filter - Optional status filter
         * @returns {array} Array of mission clones
         */
        getMissionsByTag: function(tag, filter) {
            if (!tag || typeof tag !== 'string') return [];
            var searchTag = tag.toLowerCase().trim();
            if (!searchTag) return this.getMissions(filter);

            var missions = this.getMissions(filter);
            return missions.filter(function(m) {
                if (!Array.isArray(m.tags)) return false;
                return m.tags.some(function(t) {
                    return t.toLowerCase() === searchTag;
                });
            });
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

            missions.forEach(function(m) {
                if (Array.isArray(m.tags)) {
                    m.tags.forEach(function(tag) {
                        if (tag && typeof tag === 'string') {
                            tagSet[tag.trim()] = true;
                        }
                    });
                }
            });

            return Object.keys(tagSet).sort();
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
        // MISSION TYPE HELPERS
        // ============================================================

        /**
         * Get all available mission types.
         */
        getMissionTypes: function() {
            var types = {};
            Object.keys(Schema.MISSION_TYPES).forEach(function(key) {
                var type = Schema.MISSION_TYPES[key];
                types[key] = {
                    id: type.id,
                    label: type.label,
                    icon: type.icon,
                    color: type.color,
                    description: type.description,
                    subtypes: type.subtypes.slice()
                };
            });
            return types;
        },

        /**
         * Get subtypes for a mission type.
         */
        getSubtypesForType: function(typeId) {
            var type = Schema.getMissionType(typeId);
            return type ? type.subtypes.slice() : [];
        },

        /**
         * Get all subtype labels.
         */
        getSubtypeLabels: function() {
            return Object.assign({}, Schema.SUBTYPE_LABELS);
        },

        // ============================================================
        // MISSION ID FORMATTING
        // ============================================================

        /**
         * Format a mission ID for display.
         */
        formatMissionId: function(missionId) {
            if (!missionId) return '—';
            return String(missionId);
        },

        /**
         * Parse a mission ID into components.
         * Returns { team, year, difficulty, sequence } or null.
         */
        parseMissionId: function(missionId) {
            if (!missionId || typeof missionId !== 'string') return null;
            // Format: TEAM-YY-D999
            var parts = missionId.split('-');
            if (parts.length !== 3) return null;

            var team = parts[0] || '';
            var year = parts[1] || '';
            var rest = parts[2] || '';

            // Difficulty is first char of rest, sequence is rest
            var difficultyCode = rest.charAt(0) || '';
            var sequence = rest.substring(1) || '';

            // Map difficulty code back to label
            var difficultyMap = {
                'E': 'easy',
                'M': 'medium',
                'H': 'hard',
                'X': 'expert'
            };

            return {
                team: team,
                year: year,
                difficultyCode: difficultyCode,
                difficulty: difficultyMap[difficultyCode] || null,
                sequence: sequence,
                full: missionId
            };
        },

        // ============================================================
        // CONSTANTS ACCESS
        // ============================================================

        MISSION_TYPES: Schema.MISSION_TYPES,
        VALID_STATUSES: Schema.VALID_STATUSES,
        VALID_PRIORITIES: Schema.VALID_PRIORITIES,
        VALID_DIFFICULTIES: Schema.VALID_DIFFICULTIES,
        VALID_BILLING_TYPES: Schema.VALID_BILLING_TYPES,
        VALID_ESCALATION_TIERS: Schema.VALID_ESCALATION_TIERS,
        DIFFICULTY_CODES: Schema.DIFFICULTY_CODES,
        MONTH_NAMES: Schema.MONTH_NAMES
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsQueries = MissionsQueries;

})();
