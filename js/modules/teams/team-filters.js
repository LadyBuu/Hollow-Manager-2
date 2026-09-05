/**
 * js/modules/teams/team-filters.js - Team Filter Logic
 * Handles filtering teams by various criteria
 * Path: js/modules/teams/team-filters.js
 * 
 * This module is responsible for:
 *   - Filtering teams by type and criteria
 *   - Providing default filter values
 *   - Validating periods (week, year) against calendar constants
 * 
 * IMPORTANT:
 *   - This module is PURE FILTERING logic
 *   - No DOM manipulation or HTML generation
 *   - No presentation logic
 *   - Uses TeamCore for type normalisation
 *   - Uses TeamQueries for team data access
 *   - Uses CalendarConstants for period bounds
 *   - Filtering operates on a SHALLOW COPY of team data
 *   - Team objects themselves are not mutated
 *   - Filter results are pure (no mutation of source data)
 * 
 * FILTER SEMANTICS:
 *   - Professional: Teams active during a specific year (interval overlap)
 *   - Temporary: Teams active during a specific year (interval overlap)
 *   - Civilian: All civilian teams (status filtering not supported)
 * 
 * PERIOD SEMANTICS:
 *   - Professional periods: years (e.g., 2025)
 *   - Temporary periods: years (e.g., 2025)
 *   - "Active during" means the team's period interval overlaps the selected period
 *   - Missing startPeriod = active indefinitely from the beginning
 *   - Missing endPeriod = ongoing (active forever)
 * 
 * STATUS FILTER SEMANTICS:
 *   - 'active': Show only active teams
 *   - 'inactive': Show only inactive/deprecated teams
 * 
 * API CONTRACT:
 *   - filterTeams() normalises the type parameter using TeamCore
 *   - getDefaultFilter() returns null for invalid types
 *   - Callers should use canonical types ('professional', 'temporary', 'civilian')
 * 
 * DEPENDENCIES:
 *   - window.TeamCore - Core team operations (required)
 *   - window.TeamQueries - Team query operations (required)
 *   - window.CALENDAR_CONSTANTS - Week/year constants (required)
 *   - window.ValidationUtils - Period parsing (required)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamFiltersLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.TeamCore) {
        console.warn('TeamFilters: TeamCore not available.');
        return;
    }
    if (!window.TeamQueries) {
        console.warn('TeamFilters: TeamQueries not available.');
        return;
    }
    if (!window.CALENDAR_CONSTANTS) {
        console.warn('TeamFilters: CALENDAR_CONSTANTS not available.');
        return;
    }
    if (!window.ValidationUtils) {
        console.warn('TeamFilters: ValidationUtils not available.');
        return;
    }

    window.__teamFiltersLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var CALENDAR = window.CALENDAR_CONSTANTS;
    var ValidationUtils = window.ValidationUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK;
    var MAX_WEEK = CALENDAR.MAX_WEEK;
    var MIN_YEAR = CALENDAR.MIN_YEAR;
    var MAX_YEAR = CALENDAR.MAX_YEAR;
    var WEEKS_PER_BLOCK = 2;

    // ============================================================
    // PERIOD PARSING - Delegate to ValidationUtils
    // ============================================================

    function parseNumericPeriod(value) {
        return ValidationUtils.parseStrictPositivePeriod(value);
    }

    function isValidWeek(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function isValidYear(value) {
        var num = parseNumericPeriod(value);
        return num !== null && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    function getWeekBlock(weekNum) {
        var num = parseNumericPeriod(weekNum);
        if (num === null || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }

        var blockIndex = Math.floor((num - 1) / WEEKS_PER_BLOCK);
        var start = (blockIndex * WEEKS_PER_BLOCK) + 1;
        var end = Math.min(start + WEEKS_PER_BLOCK - 1, MAX_WEEK);

        return {
            start: start,
            end: end,
            block: blockIndex + 1,
            label: 'Wk ' + start + '-' + end
        };
    }

    // ============================================================
    // TEAM FILTERING - Uses TeamQueries
    // ============================================================

    var TeamFilters = {
        /**
         * Filter teams by type and criteria.
         * Pure: operates on a shallow copy of team data.
         * 
         * @param {string} type - Team type (professional, temporary, civilian)
         * @param {object} filter - Filter options
         * @param {number|string} filter.filterYear - Year for professional/temporary teams
         * @param {string} filter.filterStatus - 'active' or 'inactive'
         * @returns {array} Filtered teams (sorted, shallow-copied)
         */
        filterTeams: function(type, filter) {
            // Normalise type using TeamCore's canonical logic
            var normalisedType = TeamCore.normalizeTeamType(type);
            if (normalisedType === null) {
                return [];
            }

            // Get teams using TeamQueries
            var teams = TeamQueries.getTeams(normalisedType, 'all', false);

            if (teams.length === 0) {
                return [];
            }

            // Copy the array to protect against mutation
            var result = teams.slice();

            filter = filter || {};

            if (normalisedType === 'professional' || normalisedType === 'temporary') {
                var year = parseNumericPeriod(filter.filterYear);
                if (year !== null && year >= MIN_YEAR && year <= MAX_YEAR) {
                    // Filter by interval overlap: team's period includes the selected year
                    result = result.filter(function(team) {
                        var start = parseNumericPeriod(team.startPeriod);
                        var end = parseNumericPeriod(team.endPeriod);
                        // Missing start = active indefinitely from beginning
                        if (start === null) {
                            return true;
                        }
                        // Team starts after selected year -> not active during this year
                        if (start > year) {
                            return false;
                        }
                        // Team ends before selected year -> not active during this year
                        if (end !== null && end < year) {
                            return false;
                        }
                        return true;
                    });
                }

                if (filter.filterStatus === 'active') {
                    result = result.filter(function(team) {
                        return team.status === 'active';
                    });
                } else if (filter.filterStatus === 'inactive') {
                    result = result.filter(function(team) {
                        return team.status === 'deprecated' || team.status === 'inactive';
                    });
                }

            } else if (normalisedType === 'civilian') {
                // Civilian teams: no status filtering
                // All civilian teams are shown
            }

            // Sort teams consistently
            result.sort(function(a, b) {
                // Active teams first for professional and temporary
                if (normalisedType === 'professional' || normalisedType === 'temporary') {
                    var aActive = a.status === 'active' ? 0 : 1;
                    var bActive = b.status === 'active' ? 0 : 1;
                    if (aActive !== bActive) {
                        return aActive - bActive;
                    }
                }
                return (a.name || '').localeCompare(b.name || '');
            });

            return result;
        },

        /**
         * Get default filter for a team type.
         * Returns null for invalid types.
         * 
         * @param {string} type - Team type (canonical)
         * @returns {object|null} Default filter or null
         */
        getDefaultFilter: function(type) {
            var normalisedType = TeamCore.normalizeTeamType(type);
            if (!normalisedType) {
                return null;
            }

            var defaults = {
                'professional': { filterYear: '', filterStatus: 'active' },
                'temporary': { filterYear: '', filterStatus: 'active' },
                'civilian': { filterStatus: 'active' }
            };

            var defaultFilter = defaults[normalisedType];
            if (!defaultFilter) {
                return null;
            }

            // Return a shallow copy
            return Object.assign({}, defaultFilter);
        },

        /**
         * Get the valid year range for non-academic teams.
         * @returns {object} { min: number, max: number }
         */
        getYearRange: function() {
            return { min: MIN_YEAR, max: MAX_YEAR };
        },

        /**
         * Check if a year is valid for non-academic teams.
         * @param {number|string} year - Year
         * @returns {boolean} True if valid
         */
        isValidYear: function(year) {
            return isValidYear(year);
        },

        /**
         * Get the period label for a team type.
         * @param {string} teamType - Team type
         * @returns {string} Period label
         */
        getPeriodLabel: function(teamType) {
            return 'Year';
        },

        /**
         * Get the valid period range for a team type.
         * @param {string} teamType - Team type
         * @returns {object} { min, max, label }
         */
        getPeriodRange: function(teamType) {
            return {
                min: MIN_YEAR,
                max: MAX_YEAR,
                label: 'Year'
            };
        },

        /**
         * Filter teams by period (year-based).
         * 
         * @param {array} teams - Array of team objects
         * @param {number|string} year - Year to filter by
         * @returns {array} Filtered teams
         */
        filterByYear: function(teams, year) {
            if (!Array.isArray(teams)) {
                return [];
            }

            var yearNum = parseNumericPeriod(year);
            if (yearNum === null || yearNum < MIN_YEAR || yearNum > MAX_YEAR) {
                return teams.slice();
            }

            return teams.filter(function(team) {
                var start = parseNumericPeriod(team.startPeriod);
                var end = parseNumericPeriod(team.endPeriod);
                // Missing start = active indefinitely from beginning
                if (start === null) {
                    return true;
                }
                // Team starts after selected year -> not active during this year
                if (start > yearNum) {
                    return false;
                }
                // Team ends before selected year -> not active during this year
                if (end !== null && end < yearNum) {
                    return false;
                }
                return true;
            });
        },

        /**
         * Filter teams by status.
         * 
         * @param {array} teams - Array of team objects
         * @param {string} status - 'active' or 'inactive'
         * @returns {array} Filtered teams
         */
        filterByStatus: function(teams, status) {
            if (!Array.isArray(teams)) {
                return [];
            }

            if (status === 'active') {
                return teams.filter(function(team) {
                    return team.status === 'active';
                });
            }

            if (status === 'inactive') {
                return teams.filter(function(team) {
                    return team.status === 'deprecated' || team.status === 'inactive';
                });
            }

            return teams.slice();
        },

        /**
         * Check if a team is active at a given year.
         * 
         * @param {object} team - Team object
         * @param {number|string} year - Year to check
         * @returns {boolean} True if active
         */
        isActiveAtYear: function(team, year) {
            if (!team || typeof team !== 'object') {
                return false;
            }

            var yearNum = parseNumericPeriod(year);
            if (yearNum === null || yearNum < MIN_YEAR || yearNum > MAX_YEAR) {
                return false;
            }

            var start = parseNumericPeriod(team.startPeriod);
            var end = parseNumericPeriod(team.endPeriod);

            // Missing start = active indefinitely from beginning
            if (start === null) {
                return true;
            }

            // Team starts after selected year -> not active
            if (start > yearNum) {
                return false;
            }

            // Team ends before selected year -> not active
            if (end !== null && end < yearNum) {
                return false;
            }

            return true;
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamFilters = TeamFilters;

})();
