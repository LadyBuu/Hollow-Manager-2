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
 *   - Academic: Teams active during a specific 2-week block
 *   - Professional: Teams active during a specific year (interval overlap)
 *   - Temporary: Teams active during a specific year (interval overlap)
 *   - Civilian: All civilian teams (status filtering not supported)
 * 
 * PERIOD SEMANTICS:
 *   - Academic periods: week numbers (1-52), displayed as 2-week blocks
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
 *   - Callers should use canonical types ('academic', 'professional', 'temporary', 'civilian')
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
        return;
    }
    if (!window.TeamQueries) {
        return;
    }
    if (!window.CALENDAR_CONSTANTS) {
        return;
    }
    if (!window.ValidationUtils) {
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
         * @param {string} type - Team type (academic, professional, temporary, civilian)
         * @param {object} filter - Filter options
         * @param {number|string} filter.filterWeek - Week for academic teams
         * @param {number|string} filter.filterYear - Year for professional/temporary teams
         * @param {string} filter.filterStatus - 'active' or 'inactive'
         * @param {string} filter.filterClass - Class ID for academic teams
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

            if (normalisedType === 'academic') {
                var weekNum = parseNumericPeriod(filter.filterWeek);
                if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
                    weekNum = MIN_WEEK;
                }

                var block = getWeekBlock(weekNum);
                if (!block) {
                    return [];
                }

                result = result.filter(function(team) {
                    var start = parseNumericPeriod(team.startPeriod);
                    var end = parseNumericPeriod(team.endPeriod);
                    // Missing start = active indefinitely from beginning
                    if (start === null) {
                        return true;
                    }
                    // Interval overlap: team's period overlaps the selected block
                    return start <= block.end && (end === null || end >= block.start);
                });

                var classFilter = filter.filterClass || 'all';
                if (classFilter !== 'all') {
                    result = result.filter(function(team) {
                        return String(team.classId) === String(classFilter);
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

            } else if (normalisedType === 'professional' || normalisedType === 'temporary') {
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
                'academic': { filterWeek: 1, filterStatus: 'active', filterClass: 'all' },
                'professional': { filterYear: '', filterStatus: 'active' },
                'temporary': { filterYear: '', filterStatus: 'active' },
                'civilian': {}
            };

            var defaultFilter = defaults[normalisedType];
            if (!defaultFilter) {
                return null;
            }

            // Return a shallow copy
            return Object.assign({}, defaultFilter);
        },

        /**
         * Get the valid week range for academic teams.
         * @returns {object} { min: number, max: number }
         */
        getWeekRange: function() {
            return { min: MIN_WEEK, max: MAX_WEEK };
        },

        /**
         * Get the valid year range for non-academic teams.
         * @returns {object} { min: number, max: number }
         */
        getYearRange: function() {
            return { min: MIN_YEAR, max: MAX_YEAR };
        },

        /**
         * Check if a week is valid for academic teams.
         * @param {number|string} week - Week number
         * @returns {boolean} True if valid
         */
        isValidWeek: function(week) {
            return isValidWeek(week);
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
         * Get the week block for a given week number.
         * @param {number|string} week - Week number
         * @returns {object|null} { start, end, block, label } or null
         */
        getWeekBlock: function(week) {
            return getWeekBlock(week);
        },

        /**
         * Get the period label for a team type.
         * @param {string} teamType - Team type
         * @returns {string} Period label
         */
        getPeriodLabel: function(teamType) {
            return teamType === 'academic' ? 'Week' : 'Year';
        },

        /**
         * Get the valid period range for a team type.
         * @param {string} teamType - Team type
         * @returns {object} { min, max, label }
         */
        getPeriodRange: function(teamType) {
            if (teamType === 'academic') {
                return {
                    min: MIN_WEEK,
                    max: MAX_WEEK,
                    label: 'Week'
                };
            }
            return {
                min: MIN_YEAR,
                max: MAX_YEAR,
                label: 'Year'
            };
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamFilters = TeamFilters;

})();
