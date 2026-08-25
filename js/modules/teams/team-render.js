/**
 * js/modules/teams/team-render.js - Team Rendering
 * Handles rendering team lists and team data
 * Path: js/modules/teams/team-render.js
 */

(function() {
    'use strict';

    var TeamRender = {
        /**
         * Render a list of teams
         * @param {array} teams - Array of team objects
         * @param {string} type - Team type for labels
         * @param {number} filterPeriod - Current period for member filtering
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

            var html = '';
            var headerHtml = `
                <div class="list-header team-header" style="grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;">
                    <span>Team Name</span>
                    <span>Period</span>
                    <span>Rank</span>
                    <span>Members</span>
                    <span>Actions</span>
                </div>
            `;
            html += headerHtml;

            var self = this;

            teams.forEach(function(team) {
                var periodDisplay = window.TeamCore.getPeriodDisplay(team);
                var typeLabel = window.TeamCore.getTypeLabel(team.type);

                var filterPeriodNum = parseInt(filterPeriod) || 1;
                var activeMembers = window.TeamCore.getActiveMembers(team, filterPeriodNum);
                var memberCount = activeMembers.length;

                var isExpanded = (expandedTeamId === team.id);
                var isInactive = team.status === 'deprecated' || team.status === 'inactive';
                var inactiveStyle = isInactive ? 'opacity:0.6;background:var(--panel-alt);' : '';

                var rankDisplay = team.currentRank || '-';

                var classDisplay = '';
                if (team.type === 'academic' && team.classId) {
                    var className = window.getClassDisplayName(team.classId);
                    if (className && className !== 'Unassigned') {
                        classDisplay = ' <span style="font-size:0.6rem;color:var(--accent);">[' + className + ']</span>';
                    }
                }

                html += '<div class="list-item team-item" data-id="' + team.id + '" style="grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;' + inactiveStyle + '">';
                html += '<span><strong>' + team.name + '</strong>' + classDisplay + ' <span style="font-size:0.6rem;color:var(--text-dim);">' + typeLabel + '</span>';
                if (isInactive) {
                    html += ' <span style="color:var(--text-dim);font-size:0.6rem;">(Inactive)</span>';
                }
                html += '</span>';
                html += '<span style="font-size:0.75rem;">' + periodDisplay + '</span>';
                html += '<span style="font-size:0.75rem;">' + rankDisplay + '</span>';
                html += '<span style="font-size:0.75rem;">' + memberCount + '</span>';
                html += '<span class="actions">' +
                    '<button class="small toggle-members" data-id="' + team.id + '">' + (isExpanded ? '▾' : '▸') + '</button>' +
                    '<button class="small manage-members" data-id="' + team.id + '">Members</button>' +
                    '<button class="small manage-rankings" data-id="' + team.id + '">Rankings</button>' +
                    '<button class="small edit-team" data-id="' + team.id + '">Edit</button>' +
                    '<button class="small danger delete-team" data-id="' + team.id + '">Delete</button>' +
                    '</span>';
                html += '</div>';

                if (isExpanded) {
                    html += self.renderExpandedMembers(team, filterPeriodNum);
                }
            });

            return html;
        },

        /**
         * Render expanded members section
         * @param {object} team - Team object
         * @param {number} filterPeriod - Current period
         * @returns {string} HTML string
         */
        renderExpandedMembers: function(team, filterPeriod) {
            var activeMembers = window.TeamCore.getActiveMembers(team, filterPeriod);
            var html = '<div class="team-members-expanded" data-team-id="' + team.id + '">';

            if (activeMembers.length > 0) {
                html += '<div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:4px;">Current Active Members:</div>';
                activeMembers.forEach(function(member) {
                    var char = window.getCharacterById(member.characterId);
                    var name = char ? window.getDisplayName(char) : 'Unknown';
                    var age = char ? window.getCharacterAge(char) : '-';
                    var deadMarker = char && char.deceased ? ' ✝' : '';

                    var status = team.type === 'academic' 
                        ? window.TeamMembers.getStatusAtWeek(member, filterPeriod) 
                        : window.TeamMembers.getStatusAtPeriod(member, filterPeriod, team.type);
                    var statusInfo = window.TeamCore.getMemberStatusInfo(status);

                    html += '<div class="member-entry" style="border-left:3px solid ' + statusInfo.color + ';padding-left:8px;">' +
                        '<span>' + name + deadMarker + ' <span class="role">(' + (member.role || 'Member') + ')</span></span>' +
                        '<span style="color:var(--text-dim);font-size:0.75rem;">Age: ' + age + ' | Joined: ' + (member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + member.leavePeriod : '') + ' | <span style="color:' + statusInfo.color + ';">' + statusInfo.label + '</span></span>' +
                        '</div>';
                });
            } else {
                html += '<div class="member-entry empty" style="color:var(--text-dim);font-size:0.8rem;">No active members this period</div>';
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
            return `
                <div class="page-header">
                    <h2>Team Manager</h2>
                    <button id="add-team-btn" class="primary">+ Add Team</button>
                </div>
                <div class="tab-container">
                    <div class="tab-nav" id="team-tab-nav">
                        <button class="tab-btn ${activeTab === 'academic' ? 'active' : ''}" data-tab="academic">Academic</button>
                        <button class="tab-btn ${activeTab === 'professional' ? 'active' : ''}" data-tab="professional">Professional</button>
                        <button class="tab-btn ${activeTab === 'temporary' ? 'active' : ''}" data-tab="temporary">Temporary</button>
                        <button class="tab-btn ${activeTab === 'civilian' ? 'active' : ''}" data-tab="civilian">Civilian</button>
                    </div>
                    <div class="tab-content" id="team-tab-content">
                        <div id="tab-academic" class="tab-panel ${activeTab === 'academic' ? 'active' : ''}" style="${activeTab === 'academic' ? 'display:block;' : 'display:none;'}">
                            <div id="academic-content"></div>
                        </div>
                        <div id="tab-professional" class="tab-panel ${activeTab === 'professional' ? 'active' : ''}" style="${activeTab === 'professional' ? 'display:block;' : 'display:none;'}">
                            <div id="professional-content"></div>
                        </div>
                        <div id="tab-temporary" class="tab-panel ${activeTab === 'temporary' ? 'active' : ''}" style="${activeTab === 'temporary' ? 'display:block;' : 'display:none;'}">
                            <div id="temporary-content"></div>
                        </div>
                        <div id="tab-civilian" class="tab-panel ${activeTab === 'civilian' ? 'active' : ''}" style="${activeTab === 'civilian' ? 'display:block;' : 'display:none;'}">
                            <div id="civilian-content"></div>
                        </div>
                    </div>
                </div>
            `;
        }
    };

    window.TeamRender = TeamRender;

})();
