/**
 * js/modules/teams/team-render.js - Team Rendering
 * Handles rendering team lists and team data
 * Path: js/modules/teams/team-render.js
 * 
 * This module is responsible for:
 *   - Rendering a list of teams
 *   - Rendering expanded member sections
 *   - Rendering the team manager container
 * 
 * IMPORTANT: This module is PURE RENDERING.
 * It does NOT mutate data, call saveData, or perform domain logic.
 * All data operations are delegated to TeamCore, TeamMembers, TeamRankings.
 * 
 * SECURITY: All user-controlled values are escaped before HTML insertion.
 * CSS values are controlled via CSS classes, not inline styles.
 * 
 * DEPENDENCIES (required):
 *   - window.TeamCore
 *   - window.TeamQueries
 *   - window.TeamMembers
 *   - window.TeamRankings
 *   - window.CharacterQueries
 *   - window.ClassesQueries
 *   - window.CALENDAR_CONSTANTS
 *   - window.DomUtils
 *   - window.ValidationUtils
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamRenderLoaded) {
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
    if (!window.TeamMembers) {
        return;
    }
    if (!window.TeamRankings) {
        return;
    }
    if (!window.CharacterQueries) {
        return;
    }
    if (!window.ClassesQueries) {
        return;
    }
    if (!window.CALENDAR_CONSTANTS) {
        return;
    }
    if (!window.DomUtils) {
        return;
    }
    if (!window.ValidationUtils) {
        return;
    }

    window.__teamRenderLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var TeamMembers = window.TeamMembers;
    var TeamRankings = window.TeamRankings;
    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var CALENDAR = window.CALENDAR_CONSTANTS;
    var DomUtils = window.DomUtils;
    var ValidationUtils = window.ValidationUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK;
    var MAX_WEEK = CALENDAR.MAX_WEEK;
    var MIN_YEAR = CALENDAR.MIN_YEAR;
    var MAX_YEAR = CALENDAR.MAX_YEAR;

    // ============================================================
    // HTML ESCAPING - Use DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // PERIOD HELPERS - Delegate to ValidationUtils
    // ============================================================

    function parseNumericPeriod(value) {
        return ValidationUtils.parseStrictPositivePeriod(value);
    }

    // ============================================================
    // CHARACTER HELPERS - Uses CharacterQueries
    // ============================================================

    function getCharacterName(charId) {
        var character = CharacterQueries.getCharacterById(charId);
        return character ? CharacterQueries.getDisplayName(character) : 'Unknown';
    }

    function getCharacterAge(charId) {
        var character = CharacterQueries.getCharacterById(charId);
        return character ? CharacterQueries.getCharacterAge(character) : '-';
    }

    // ============================================================
    // CLASS HELPERS - Uses ClassesQueries
    // ============================================================

    function getClassDisplayName(classId) {
        return ClassesQueries.getClassDisplayName(classId);
    }

    // ============================================================
    // STATUS CSS CLASSES
    // ============================================================

    function getStatusClass(status) {
        var map = {
            'active': 'status-active',
            'left': 'status-left',
            'deceased': 'status-deceased',
            'eliminated': 'status-eliminated',
            'future': 'status-future',
            'unknown': 'status-unknown'
        };
        return map[status] || 'status-unknown';
    }

    // ============================================================
    // PERIOD LABEL HELPERS
    // ============================================================

    function getPeriodLabel(teamType) {
        return teamType === 'academic' ? 'Week' : 'Period';
    }

    function formatActiveMembersLabel(teamType, period) {
        if (teamType === 'academic') {
            return 'Active Members at Week ' + escapeHtml(String(period)) + ':';
        }
        return 'Active Members in ' + escapeHtml(String(period)) + ':';
    }

    // ============================================================
    // RANKING HELPERS
    // ============================================================

    function getTeamRankDisplay(team) {
        if (!team) {
            return '-';
        }
        return TeamRankings.getCurrentRank(team) || '-';
    }

    // ============================================================
    // TEAM LIST RENDERING
    // ============================================================

    var TeamRender = {
        /**
         * Render a list of teams
         * @param {array} teams - Array of team objects
         * @param {string} type - Team type for labels
         * @param {number|string} filterPeriod - Current period for member filtering
         * @param {string} expandedTeamId - ID of expanded team
         * @returns {string} HTML string
         */
        renderList: function(teams, type, filterPeriod, expandedTeamId) {
            if (!teams || teams.length === 0) {
                var labels = {
                    'academic': 'academic teams',
                    'professional': 'professional teams',
                    'temporary': 'temporary teams',
                    'civilian': 'civilian teams'
                };
                return '<p class="empty-state" style="padding:20px;">No ' + (labels[type] || 'teams') + ' found.</p>';
            }

            var periodNum = parseInt(filterPeriod, 10);
            if (isNaN(periodNum) || periodNum < 1) {
                periodNum = 1;
            }

            var html = '';
            html += '<div class="list-header team-header">';
            html += '<span>Team Name</span>';
            html += '<span>Period</span>';
            html += '<span>Rank</span>';
            html += '<span>Members</span>';
            html += '<span>Actions</span>';
            html += '</div>';

            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                if (!team || typeof team !== 'object') {
                    continue;
                }

                var periodDisplay = TeamQueries.getTeamPeriodDisplay(team);
                var typeLabel = TeamQueries.getTypeLabel(team.type);

                var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
                var memberCount = activeMembers.length;

                var isExpanded = (expandedTeamId === team.id);
                var isInactive = team.status === 'deprecated' || team.status === 'inactive';
                var inactiveClass = isInactive ? 'inactive' : '';

                var rankDisplay = getTeamRankDisplay(team);

                var classDisplay = '';
                if (team.type === 'academic' && team.classId) {
                    var className = getClassDisplayName(team.classId);
                    if (className && className !== 'Unassigned') {
                        classDisplay = ' <span class="team-class">[' + escapeHtml(className) + ']</span>';
                    }
                }

                // Team row - using CSS classes for styling
                html += '<div class="list-item team-item ' + inactiveClass + '" data-id="' + escapeAttribute(team.id) + '">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong>' + classDisplay + ' <span class="team-type-label">' + escapeHtml(typeLabel) + '</span>';
                if (isInactive) {
                    html += ' <span class="team-status-inactive">(Inactive)</span>';
                }
                html += '</span>';
                html += '<span class="team-period">' + escapeHtml(periodDisplay) + '</span>';
                html += '<span class="team-rank">' + escapeHtml(rankDisplay) + '</span>';
                html += '<span class="team-member-count">' + memberCount + '</span>';
                html += '<span class="actions">' +
                    '<button class="small toggle-members" data-id="' + escapeAttribute(team.id) + '">' + (isExpanded ? '▾' : '▸') + '</button>' +
                    '<button class="small manage-members" data-id="' + escapeAttribute(team.id) + '">Members</button>' +
                    '<button class="small manage-rankings" data-id="' + escapeAttribute(team.id) + '">Rankings</button>' +
                    '<button class="small edit-team" data-id="' + escapeAttribute(team.id) + '">Edit</button>' +
                    '<button class="small danger delete-team" data-id="' + escapeAttribute(team.id) + '">Delete</button>' +
                    '</span>';
                html += '</div>';

                if (isExpanded) {
                    html += this.renderExpandedMembers(team, periodNum);
                }
            }

            return html;
        },

        /**
         * Render expanded members section
         * @param {object} team - Team object
         * @param {number|string} filterPeriod - Current period
         * @returns {string} HTML string
         */
        renderExpandedMembers: function(team, filterPeriod) {
            if (!team || typeof team !== 'object') {
                return '';
            }

            var periodNum = parseInt(filterPeriod, 10);
            if (isNaN(periodNum) || periodNum < 1) {
                periodNum = 1;
            }

            var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
            var labelText = formatActiveMembersLabel(team.type, periodNum);

            var html = '<div class="team-members-expanded" data-team-id="' + escapeAttribute(team.id) + '">';

            if (activeMembers.length > 0) {
                html += '<div class="members-expanded-header">' + labelText + '</div>';
                for (var i = 0; i < activeMembers.length; i++) {
                    var member = activeMembers[i];
                    if (!member || typeof member !== 'object') {
                        continue;
                    }

                    var character = CharacterQueries.getCharacterById(member.characterId);
                    var name = character ? CharacterQueries.getDisplayName(character) : 'Unknown';
                    var age = character ? CharacterQueries.getCharacterAge(character) : '-';

                    // Use TeamMembers for status
                    var status = TeamMembers.getStatusAtPeriod(member, periodNum, team.type);
                    var statusInfo = TeamCore.getMemberStatusInfo(status);
                    var statusClass = getStatusClass(status);

                    html += '<div class="member-entry ' + statusClass + '">';
                    html += '<span>' + escapeHtml(name) + ' <span class="role">(' + escapeHtml(member.role || 'Member') + ')</span></span>';
                    html += '<span class="member-details">Age: ' + escapeHtml(age) + ' | Joined: ' + escapeHtml(member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + escapeHtml(member.leavePeriod) : '') + ' | <span class="member-status">' + escapeHtml(statusInfo.label) + '</span></span>';
                    html += '</div>';
                }
            } else {
                var periodLabel = getPeriodLabel(team.type);
                html += '<div class="member-entry empty">No active members this ' + periodLabel.toLowerCase() + '</div>';
            }

            html += '</div>';
            return html;
        },

        /**
         * Render the team manager container
         * @param {string} activeTab - Current active tab
         * @returns {string} HTML string
         */
        renderContainer: function(activeTab) {
            activeTab = activeTab || 'academic';
            return [
                '<div class="page-header">',
                    '<h2>Team Manager</h2>',
                    '<button id="add-team-btn" class="primary">+ Add Team</button>',
                '</div>',
                '<div class="tab-container">',
                    '<div class="tab-nav" id="team-tab-nav">',
                        '<button class="tab-btn ' + (activeTab === 'academic' ? 'active' : '') + '" data-tab="academic">Academic</button>',
                        '<button class="tab-btn ' + (activeTab === 'professional' ? 'active' : '') + '" data-tab="professional">Professional</button>',
                        '<button class="tab-btn ' + (activeTab === 'temporary' ? 'active' : '') + '" data-tab="temporary">Temporary</button>',
                        '<button class="tab-btn ' + (activeTab === 'civilian' ? 'active' : '') + '" data-tab="civilian">Civilian</button>',
                    '</div>',
                    '<div class="tab-content" id="team-tab-content">',
                        '<div id="tab-academic" class="tab-panel ' + (activeTab === 'academic' ? 'active' : '') + '">',
                            '<div id="academic-content"></div>',
                        '</div>',
                        '<div id="tab-professional" class="tab-panel ' + (activeTab === 'professional' ? 'active' : '') + '">',
                            '<div id="professional-content"></div>',
                        '</div>',
                        '<div id="tab-temporary" class="tab-panel ' + (activeTab === 'temporary' ? 'active' : '') + '">',
                            '<div id="temporary-content"></div>',
                        '</div>',
                        '<div id="tab-civilian" class="tab-panel ' + (activeTab === 'civilian' ? 'active' : '') + '">',
                            '<div id="civilian-content"></div>',
                        '</div>',
                    '</div>',
                '</div>'
            ].join('');
        },

        /**
         * Render a single team card for compact display
         * @param {object} team - Team object
         * @param {number|string} period - Current period
         * @returns {string} HTML string
         */
        renderTeamCard: function(team, period) {
            if (!team || typeof team !== 'object') {
                return '';
            }

            var periodNum = parseInt(period, 10);
            if (isNaN(periodNum) || periodNum < 1) {
                periodNum = 1;
            }

            var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
            var memberCount = activeMembers.length;
            var rankDisplay = getTeamRankDisplay(team);
            var periodDisplay = TeamQueries.getTeamPeriodDisplay(team);
            var typeLabel = TeamQueries.getTypeLabel(team.type);

            var isInactive = team.status === 'deprecated' || team.status === 'inactive';
            var inactiveClass = isInactive ? 'inactive' : '';

            var classDisplay = '';
            if (team.type === 'academic' && team.classId) {
                var className = getClassDisplayName(team.classId);
                if (className && className !== 'Unassigned') {
                    classDisplay = ' <span class="team-class">[' + escapeHtml(className) + ']</span>';
                }
            }

            var html = '<div class="team-card ' + inactiveClass + '" data-id="' + escapeAttribute(team.id) + '">';
            html += '<div class="team-card-header">';
            html += '<strong>' + escapeHtml(team.name) + '</strong>' + classDisplay;
            html += ' <span class="team-type-label">' + escapeHtml(typeLabel) + '</span>';
            if (isInactive) {
                html += ' <span class="team-status-inactive">(Inactive)</span>';
            }
            html += '</div>';
            html += '<div class="team-card-details">';
            html += '<span class="team-period">' + escapeHtml(periodDisplay) + '</span>';
            html += '<span class="team-rank">Rank: ' + escapeHtml(rankDisplay) + '</span>';
            html += '<span class="team-member-count">Members: ' + memberCount + '</span>';
            html += '</div>';
            html += '<div class="team-card-actions">';
            html += '<button class="small toggle-members" data-id="' + escapeAttribute(team.id) + '">▸</button>';
            html += '<button class="small manage-members" data-id="' + escapeAttribute(team.id) + '">Members</button>';
            html += '<button class="small manage-rankings" data-id="' + escapeAttribute(team.id) + '">Rankings</button>';
            html += '<button class="small edit-team" data-id="' + escapeAttribute(team.id) + '">Edit</button>';
            html += '<button class="small danger delete-team" data-id="' + escapeAttribute(team.id) + '">Delete</button>';
            html += '</div>';
            html += '</div>';

            return html;
        },

        /**
         * Render a team summary for dashboard or quick view
         * @param {object} team - Team object
         * @param {number|string} period - Current period for member count
         * @returns {string} HTML string
         */
        renderTeamSummary: function(team, period) {
            if (!team || typeof team !== 'object') {
                return '';
            }

            var periodNum = parseInt(period, 10);
            if (isNaN(periodNum) || periodNum < 1) {
                periodNum = 1;
            }

            var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);
            var memberCount = activeMembers.length;
            var rankDisplay = getTeamRankDisplay(team);
            var typeLabel = TeamQueries.getTypeLabel(team.type);

            var html = '<div class="team-summary">';
            html += '<span class="team-name">' + escapeHtml(team.name) + '</span>';
            html += '<span class="team-type">' + escapeHtml(typeLabel) + '</span>';
            html += '<span class="team-rank">#' + escapeHtml(rankDisplay) + '</span>';
            html += '<span class="team-members">' + memberCount + ' active members</span>';
            html += '</div>';

            return html;
        },

        /**
         * Get the status class for a member status
         * @param {string} status - Status string
         * @returns {string} CSS class name
         */
        getStatusClass: getStatusClass,

        /**
         * Get the period label for a team type
         * @param {string} teamType - Team type
         * @returns {string} Period label
         */
        getPeriodLabel: getPeriodLabel,

        /**
         * Check if a team is active
         * @param {object} team - Team object
         * @returns {boolean} True if active
         */
        isTeamActive: function(team) {
            return team && team.status === 'active';
        },

        /**
         * Check if a team is inactive or deprecated
         * @param {object} team - Team object
         * @returns {boolean} True if inactive
         */
        isTeamInactive: function(team) {
            return team && (team.status === 'inactive' || team.status === 'deprecated');
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamRender = TeamRender;

})();
