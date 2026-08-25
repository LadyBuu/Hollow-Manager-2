/**
 * js/modules/teams/team-filters.js - Team Filter Logic
 * Handles filtering teams by various criteria
 * Path: js/modules/teams/team-filters.js
 */

(function() {
    'use strict';

    var TeamFilters = {
        /**
         * Filter teams by type and criteria
         * @param {string} type - Team type
         * @param {object} filter - Filter options
         * @param {object} filter.filterWeek - Week for academic teams
         * @param {object} filter.filterYear - Year for professional/temporary teams
         * @param {object} filter.filterStatus - 'active' or 'inactive'
         * @param {object} filter.filterClass - Class ID for academic teams
         * @returns {array} Filtered teams
         */
        filterTeams: function(type, filter) {
            var teams = window.TeamCore.getTeams(type);
            if (!teams || teams.length === 0) return [];

            filter = filter || {};

            if (type === 'academic') {
                var weekNum = parseInt(filter.filterWeek) || 1;
                var block = window.getWeekBlock(weekNum);

                teams = teams.filter(function(team) {
                    var start = parseInt(team.startPeriod);
                    var end = parseInt(team.endPeriod);
                    if (isNaN(start)) return true;
                    return start <= block.end && (isNaN(end) || end >= block.start);
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

            } else if (type === 'professional' || type === 'temporary') {
                var year = filter.filterYear || '';
                if (year) {
                    var yearNum = parseInt(year);
                    if (!isNaN(yearNum)) {
                        teams = teams.filter(function(team) {
                            var start = parseInt(team.startPeriod);
                            return !isNaN(start) && start >= yearNum;
                        });
                    }
                }

                if (filter.filterStatus === 'active') {
                    teams = teams.filter(function(t) { return t.status === 'active'; });
                } else if (filter.filterStatus === 'inactive') {
                    teams = teams.filter(function(t) { return t.status === 'deprecated' || t.status === 'inactive'; });
                }
            }

            // Sort teams
            teams.sort(function(a, b) {
                if (type === 'professional') {
                    var aActive = a.status === 'active' ? 0 : 1;
                    var bActive = b.status === 'active' ? 0 : 1;
                    if (aActive !== bActive) return aActive - bActive;
                }
                return a.name.localeCompare(b.name);
            });

            return teams;
        },

        /**
         * Get default filter for a team type
         * @param {string} type - Team type
         * @returns {object} Default filter
         */
        getDefaultFilter: function(type) {
            var defaults = {
                'academic': { filterWeek: 1, filterStatus: 'active', filterClass: 'all' },
                'professional': { filterYear: '', filterStatus: 'active' },
                'temporary': { filterYear: '', filterStatus: 'active' },
                'civilian': { filterStatus: 'active' }
            };
            return defaults[type] || defaults['academic'];
        },

        /**
         * Build filter HTML for a team type
         * @param {string} type - Team type
         * @param {object} filter - Current filter values
         * @param {array} classes - Available classes for academic filter
         * @returns {string} HTML string
         */
        buildFilterHTML: function(type, filter, classes) {
            classes = classes || [];

            if (type === 'academic') {
                var weekValue = filter.filterWeek || 1;
                var classFilterValue = filter.filterClass || 'all';

                var classOptions = '';
                classes.forEach(function(cls) {
                    var selected = (classFilterValue === cls.id) ? 'selected' : '';
                    classOptions += '<option value="' + cls.id + '" ' + selected + '>' + cls.name + '</option>';
                });

                return `
                    <div class="filter-section">
                        <label for="team-filter-week">Week:</label>
                        <input type="number" id="team-filter-week" value="${weekValue}" min="1" max="52" style="width:80px;">
                        <button id="apply-filter-btn" class="small primary">Apply</button>
                        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active during this 2-week block</span>
                        <label style="margin-left:12px;">Class:</label>
                        <select id="team-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                            <option value="all">All Classes</option>
                            ${classOptions}
                        </select>
                        <label style="margin-left:12px;display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-dim);cursor:pointer;">
                            <input type="checkbox" id="academic-show-inactive" ${filter.filterStatus === 'inactive' ? 'checked' : ''} style="width:auto;accent-color:var(--accent);cursor:pointer;"> Show Inactive
                        </label>
                    </div>
                `;
            } else if (type === 'professional') {
                var yearValue = filter.filterYear || '';
                return `
                    <div class="filter-section">
                        <label for="team-filter-year">Year:</label>
                        <input type="number" id="team-filter-year" value="${yearValue}" min="1900" max="2100" style="width:80px;" placeholder="All">
                        <button id="apply-filter-btn" class="small primary">Apply</button>
                        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active from this year onward</span>
                        <label style="margin-left:12px;display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-dim);cursor:pointer;">
                            <input type="checkbox" id="professional-show-inactive" ${filter.filterStatus === 'inactive' ? 'checked' : ''} style="width:auto;accent-color:var(--accent);cursor:pointer;"> Show Inactive
                        </label>
                    </div>
                `;
            } else if (type === 'temporary') {
                var yearValue = filter.filterYear || '';
                return `
                    <div class="filter-section">
                        <label for="team-filter-year">Year:</label>
                        <input type="number" id="team-filter-year" value="${yearValue}" min="1900" max="2100" style="width:80px;" placeholder="All">
                        <button id="apply-filter-btn" class="small primary">Apply</button>
                        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Shows teams active from this year onward</span>
                    </div>
                `;
            } else {
                return `
                    <div class="filter-section">
                        <span style="font-size:0.75rem;color:var(--text-dim);">All civilian teams shown</span>
                    </div>
                `;
            }
        }
    };

    window.TeamFilters = TeamFilters;

    console.log('team-filters.js loaded');

})();
