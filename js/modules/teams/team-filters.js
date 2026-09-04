/**
 * js/modules/teams/team-filters.js - Team Filter Logic
 * Handles filtering teams by various criteria
 * Path: js/modules/teams/team-filters.js
 * 
 * This module is responsible for:
 *   - Filtering teams by type and criteria
 *   - Providing default filter values
 *   - Reading filter values from DOM
 *   - Building filter HTML (safe, escaped)
 * 
 * DEPENDENCIES:
 *   - window.TeamCore - Canonical team operations (required)
 *   - window.TeamQueries - Team query operations (required)
 *   - window.CALENDAR_CONSTANTS - Week/year constants (from constants.js)
 *   - window.DomUtils - HTML escaping (from dom-utils.js)
 *   - window.ValidationUtils - Period parsing (from validation-utils.js)
 *   - window.CharacterQueries - Character data (from character-queries.js) - optional
 * 
 * IMPORTANT:
 *   - All data inserted into HTML is escaped to prevent XSS.
 *   - Filter semantics are explicit and documented.
 *   - Team type normalisation is delegated to TeamCore.
 *   - Filter results are pure (no mutation of source data).
 *   - Filters operate on a SHALLOW COPY of team data (array copy).
 *   - Team objects themselves are not mutated.
 *   - Uses TeamQueries for all team data access
 *   - Uses ValidationUtils for period parsing
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
 *   - The UI uses a checkbox labelled "Show Inactive Only" to toggle
 * 
 * API CONTRACT:
 *   - filterTeams() normalises the type parameter
 *   - getDefaultFilter(), buildFilterHTML(), readFilterFromDOM() expect canonical type names
 *   - Callers should use canonical types ('academic', 'professional', 'temporary', 'civilian')
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamFiltersLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.TeamCore) {
        console.error('TeamFilters: TeamCore is required but not loaded.');
        return;
    }

    if (!window.TeamQueries) {
        console.error('TeamFilters: TeamQueries is required but not loaded.');
        return;
    }

    window.__teamFiltersLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var DomUtils = window.DomUtils || window;
    var ValidationUtils = window.ValidationUtils || window;
    var CharacterQueries = window.CharacterQueries || window;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK || 1;
    var MAX_WEEK = CALENDAR.MAX_WEEK || 52;
    var MIN_YEAR = CALENDAR.MIN_YEAR || 1900;
    var MAX_YEAR = CALENDAR.MAX_YEAR || 2100;

    // ============================================================
    // HTML ESCAPING - Use DomUtils when available
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Fallback
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // PERIOD PARSING - Delegate to ValidationUtils
    // ============================================================

    function parseNumericPeriod(value) {
        if (ValidationUtils && typeof ValidationUtils.parseStrictPositivePeriod === 'function') {
            return ValidationUtils.parseStrictPositivePeriod(value);
        }
        // Fallback
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var str = String(value).trim();
        if (!/^\d+$/.test(str)) {
            return null;
        }
        var parsed = Number(str);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    function parsePositivePeriod(value) {
        var parsed = parseNumericPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    function isValidWeek(week) {
        var num = parseNumericPeriod(week);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function isValidYear(year) {
        var num = parseNumericPeriod(year);
        return num !== null && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    // ============================================================
    // DEPENDENCY CHECK HELPERS
    // ============================================================

    function getWeekBlock(weekNum) {
        // Try CalendarUtils first
        if (window.CalendarUtils && typeof window.CalendarUtils.getWeekBlock === 'function') {
            return window.CalendarUtils.getWeekBlock(weekNum);
        }

        // Fallback: manual calculation
        var num = parseNumericPeriod(weekNum);
        if (num === null || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }

        var WEEKS_PER_BLOCK = 2;
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
    // CHARACTER HELPERS - Delegate to CharacterQueries
    // ============================================================

    function getCharacterName(charId) {
        if (CharacterQueries && typeof CharacterQueries.getDisplayName === 'function') {
            var char = CharacterQueries.getCharacterById(charId);
            return char ? CharacterQueries.getDisplayName(char) : 'Unknown';
        }
        return 'Unknown';
    }

    function getCharacterStatus(charId) {
        if (CharacterQueries && typeof CharacterQueries.getCurrentStatus === 'function') {
            var char = CharacterQueries.getCharacterById(charId);
            return char ? CharacterQueries.getCurrentStatus(char) : '';
        }
        return '';
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

            if (teams.length === 0) return [];

            filter = filter || {};

            if (normalisedType === 'academic') {
                var weekNum = parseInt(filter.filterWeek, 10) || 1;
                // Clamp week to valid range
                if (weekNum < MIN_WEEK) weekNum = MIN_WEEK;
                if (weekNum > MAX_WEEK) weekNum = MAX_WEEK;

                var block = getWeekBlock(weekNum);
                if (!block) return [];

                teams = teams.filter(function(team) {
                    var start = parsePositivePeriod(team.startPeriod);
                    var end = parsePositivePeriod(team.endPeriod);
                    // Missing start = active indefinitely from beginning
                    if (start === null) return true;
                    // Interval overlap: team's period overlaps the selected block
                    return start <= block.end && (end === null || end >= block.start);
                });

                var classFilter = filter.filterClass || 'all';
                if (classFilter !== 'all') {
                    teams = teams.filter(function(team) {
                        return String(team.classId) === String(classFilter);
                    });
                }

                if (filter.filterStatus === 'active') {
                    teams = teams.filter(function(t) { return t.status === 'active'; });
                } else if (filter.filterStatus === 'inactive') {
                    teams = teams.filter(function(t) { return t.status === 'deprecated' || t.status === 'inactive'; });
                }

            } else if (normalisedType === 'professional' || normalisedType === 'temporary') {
                var year = parseInt(filter.filterYear, 10);
                if (!isNaN(year) && year >= MIN_YEAR && year <= MAX_YEAR) {
                    // Filter by interval overlap: team's period includes the selected year
                    teams = teams.filter(function(team) {
                        var start = parsePositivePeriod(team.startPeriod);
                        var end = parsePositivePeriod(team.endPeriod);
                        // Missing start = active indefinitely from beginning
                        if (start === null) return true;
                        // Team starts after selected year → not active during this year
                        if (start > year) return false;
                        // Team ends before selected year → not active during this year
                        if (end !== null && end < year) return false;
                        return true;
                    });
                }

                if (filter.filterStatus === 'active') {
                    teams = teams.filter(function(t) { return t.status === 'active'; });
                } else if (filter.filterStatus === 'inactive') {
                    teams = teams.filter(function(t) { return t.status === 'deprecated' || t.status === 'inactive'; });
                }

            } else if (normalisedType === 'civilian') {
                // Civilian teams: no status filtering
                // All civilian teams are shown
            }

            // Sort teams consistently
            teams.sort(function(a, b) {
                // Active teams first for professional and temporary
                if (normalisedType === 'professional' || normalisedType === 'temporary') {
                    var aActive = a.status === 'active' ? 0 : 1;
                    var bActive = b.status === 'active' ? 0 : 1;
                    if (aActive !== bActive) return aActive - bActive;
                }
                return (a.name || '').localeCompare(b.name || '');
            });

            return teams;
        },

        /**
         * Get default filter for a team type.
         * 
         * @param {string} type - Team type (canonical)
         * @returns {object} Default filter
         */
        getDefaultFilter: function(type) {
            var defaults = {
                'academic': { filterWeek: 1, filterStatus: 'active', filterClass: 'all' },
                'professional': { filterYear: '', filterStatus: 'active' },
                'temporary': { filterYear: '', filterStatus: 'active' },
                'civilian': {}  // No status filtering for civilian
            };
            return defaults[type] || defaults['academic'];
        },

        /**
         * Read filter values from the DOM and return a new filter object.
         * Pure: does not mutate the input state.
         * 
         * @param {string} type - Team type (canonical)
         * @param {object} currentState - Current filter state object (will be copied)
         * @param {object} domRefs - DOM element references (optional)
         * @returns {object} New filter state (copied from input)
         */
        readFilterFromDOM: function(type, currentState, domRefs) {
            var baseFilter = currentState || this.getDefaultFilter(type);
            var filter = Object.assign({}, baseFilter);
            domRefs = domRefs || {};

            if (type === 'academic') {
                var weekInput = domRefs.weekInput || document.getElementById('team-filter-week');
                var classFilter = domRefs.classFilter || document.getElementById('team-class-filter');
                var inactiveCheck = domRefs.inactiveCheck || document.getElementById('academic-show-inactive');

                if (weekInput) {
                    var week = parseInt(weekInput.value, 10);
                    if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                        filter.filterWeek = week;
                    }
                }
                if (classFilter) {
                    filter.filterClass = classFilter.value;
                }
                if (inactiveCheck) {
                    filter.filterStatus = inactiveCheck.checked ? 'inactive' : 'active';
                }
            } else if (type === 'professional') {
                var yearInput = domRefs.yearInput || document.getElementById('team-filter-year');
                var profInactiveCheck = domRefs.profInactiveCheck || document.getElementById('professional-show-inactive');

                if (yearInput) {
                    var year = parseInt(yearInput.value, 10);
                    if (!isNaN(year) && year >= MIN_YEAR) {
                        filter.filterYear = year;
                    } else {
                        filter.filterYear = '';
                    }
                }
                if (profInactiveCheck) {
                    filter.filterStatus = profInactiveCheck.checked ? 'inactive' : 'active';
                }
            } else if (type === 'temporary') {
                var tempYearInput = domRefs.tempYearInput || document.getElementById('team-filter-year');
                var tempInactiveCheck = domRefs.tempInactiveCheck || document.getElementById('temporary-show-inactive');

                if (tempYearInput) {
                    var year = parseInt(tempYearInput.value, 10);
                    if (!isNaN(year) && year >= MIN_YEAR) {
                        filter.filterYear = year;
                    } else {
                        filter.filterYear = '';
                    }
                }
                if (tempInactiveCheck) {
                    filter.filterStatus = tempInactiveCheck.checked ? 'inactive' : 'active';
                }
            }

            return filter;
        },

        /**
         * Build filter HTML for a team type.
         * All dynamic values are escaped to prevent XSS.
         * 
         * @param {string} type - Team type (canonical)
         * @param {object} filter - Current filter values
         * @param {array} classes - Available classes for academic filter
         * @returns {string} HTML string (safe, escaped)
         */
        buildFilterHTML: function(type, filter, classes) {
            // Defensive defaults
            filter = filter || {};
            classes = Array.isArray(classes) ? classes : [];

            var html = '';

            if (type === 'academic') {
                var weekValue = filter.filterWeek || 1;
                var classFilterValue = filter.filterClass || 'all';

                // Build class options with escaped values
                var classOptionsHtml = '';
                if (classes.length > 0) {
                    classes.forEach(function(cls) {
                        var selected = String(classFilterValue) === String(cls.id) ? ' selected' : '';
                        classOptionsHtml += '<option value="' + escapeHtml(cls.id) + '"' + selected + '>' + escapeHtml(cls.name) + '</option>';
                    });
                }

                html += '<div class="filter-section">';
                html += '<label for="team-filter-week">Week:</label>';
                html += '<input type="number" id="team-filter-week" value="' + escapeHtml(String(weekValue)) + '" min="' + MIN_WEEK + '" max="' + MAX_WEEK + '" style="width:80px;">';
                html += '<button id="apply-filter-btn" class="small primary">Apply</button>';
                html += '<span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active during this 2-week block</span>';
                html += '<label style="margin-left:12px;">Class:</label>';
                html += '<select id="team-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">';
                html += '<option value="all">All Classes</option>';
                html += classOptionsHtml;
                html += '</select>';
                html += '<label style="margin-left:12px;display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-dim);cursor:pointer;">';
                html += '<input type="checkbox" id="academic-show-inactive" ' + (filter.filterStatus === 'inactive' ? 'checked' : '') + ' style="width:auto;accent-color:var(--accent);cursor:pointer;"> Show Inactive Only';
                html += '</label>';
                html += '</div>';

            } else if (type === 'professional') {
                var yearValue = filter.filterYear || '';
                html += '<div class="filter-section">';
                html += '<label for="team-filter-year">Year:</label>';
                html += '<input type="number" id="team-filter-year" value="' + escapeHtml(String(yearValue)) + '" min="' + MIN_YEAR + '" max="' + MAX_YEAR + '" style="width:80px;" placeholder="All">';
                html += '<button id="apply-filter-btn" class="small primary">Apply</button>';
                html += '<span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active during this year</span>';
                html += '<label style="margin-left:12px;display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-dim);cursor:pointer;">';
                html += '<input type="checkbox" id="professional-show-inactive" ' + (filter.filterStatus === 'inactive' ? 'checked' : '') + ' style="width:auto;accent-color:var(--accent);cursor:pointer;"> Show Inactive Only';
                html += '</label>';
                html += '</div>';

            } else if (type === 'temporary') {
                var tempYearValue = filter.filterYear || '';
                html += '<div class="filter-section">';
                html += '<label for="team-filter-year">Year:</label>';
                html += '<input type="number" id="team-filter-year" value="' + escapeHtml(String(tempYearValue)) + '" min="' + MIN_YEAR + '" max="' + MAX_YEAR + '" style="width:80px;" placeholder="All">';
                html += '<button id="apply-filter-btn" class="small primary">Apply</button>';
                html += '<span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active during this year</span>';
                html += '<label style="margin-left:12px;display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-dim);cursor:pointer;">';
                html += '<input type="checkbox" id="temporary-show-inactive" ' + (filter.filterStatus === 'inactive' ? 'checked' : '') + ' style="width:auto;accent-color:var(--accent);cursor:pointer;"> Show Inactive Only';
                html += '</label>';
                html += '</div>';

            } else if (type === 'civilian') {
                html += '<div class="filter-section">';
                html += '<span style="font-size:0.75rem;color:var(--text-dim);">All civilian teams shown</span>';
                html += '</div>';
            }

            return html;
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
            var num = parseNumericPeriod(week);
            return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
        },

        /**
         * Check if a year is valid for non-academic teams.
         * @param {number|string} year - Year
         * @returns {boolean} True if valid
         */
        isValidYear: function(year) {
            var num = parseNumericPeriod(year);
            return num !== null && num >= MIN_YEAR && num <= MAX_YEAR;
        },

        /**
         * Get active member names for a team at a given period.
         * Uses TeamQueries for membership data.
         * 
         * @param {object} team - Team object
         * @param {number|string} period - Period (week or year)
         * @returns {array} Array of member names
         */
        getActiveMemberNames: function(team, period) {
            if (!team) return [];

            var members = TeamQueries.getActiveTeamMembers(team, period);
            var names = [];

            for (var i = 0; i < members.length; i++) {
                var member = members[i];
                if (member && member.characterId) {
                    var name = getCharacterName(member.characterId);
                    if (name) names.push(name);
                }
            }

            return names;
        },

        /**
         * Get active member count for a team at a given period.
         * Uses TeamQueries for membership data.
         * 
         * @param {object} team - Team object
         * @param {number|string} period - Period (week or year)
         * @returns {number} Count of active members
         */
        getActiveMemberCount: function(team, period) {
            if (!team) return 0;
            return TeamQueries.getActiveTeamMemberCount(team, period);
        },

        /**
         * Get the class display name for a team.
         * 
         * @param {object} team - Team object
         * @returns {string|null} Class display name or null
         */
        getTeamClassDisplayName: function(team) {
            if (!team || team.type !== 'academic') return null;
            return TeamQueries.getTeamClassDisplayName(team);
        },

        /**
         * Get the period display for a team.
         * 
         * @param {object} team - Team object
         * @returns {string} Period display string
         */
        getTeamPeriodDisplay: function(team) {
            return TeamQueries.getTeamPeriodDisplay(team);
        },

        /**
         * Get the type label for a team.
         * 
         * @param {object} team - Team object
         * @returns {string} Type label
         */
        getTeamTypeLabel: function(team) {
            if (!team) return 'Unknown';
            return TeamQueries.getTypeLabel(team.type);
        },

        /**
         * Get the current rank for a team.
         * 
         * @param {object} team - Team object
         * @returns {string} Current rank
         */
        getTeamCurrentRank: function(team) {
            if (!team) return '-';
            return TeamQueries.getTeamCurrentRank(team) || '-';
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamFilters = TeamFilters;

})();
