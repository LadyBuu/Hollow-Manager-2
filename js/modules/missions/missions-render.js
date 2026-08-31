/**
 * js/modules/missions/missions-render.js - Mission Rendering
 * PURE rendering functions. Takes data, returns HTML.
 * Does NOT mutate data or attach event handlers.
 * 
 * RENDER PHILOSOPHY:
 *   - All rendering is PURE: data in, HTML out
 *   - Uses Queries for data interpretation
 *   - Escapes all user-controlled content
 *   - Does NOT attach event handlers (UI layer handles that)
 *   - Generates semantic HTML with CSS classes for styling
 * 
 * RENDER CONTRACT:
 *   - All functions return HTML strings
 *   - All user-controlled values are escaped
 *   - No DOM manipulation, no event listeners
 *   - Data interpretation is delegated to Queries
 * 
 * DEPENDENCIES:
 *   - MissionsQueries (required)
 *   - MissionsSchema (required for constants)
 */

(function() {
    'use strict';

    if (window.__missionsRenderLoaded) return;

    if (!window.MissionsQueries) {
        console.error('MissionsRender: MissionsQueries required.');
        return;
    }

    if (!window.MissionsSchema) {
        console.error('MissionsRender: MissionsSchema required.');
        return;
    }

    window.__missionsRenderLoaded = true;

    var Queries = window.MissionsQueries;
    var Schema = window.MissionsSchema;
    var MISSION_TYPES = Schema.MISSION_TYPES;
    var MONTH_NAMES = Schema.MONTH_NAMES;
    var PRIORITY_INFO = Schema.PRIORITY_INFO;
    var STATUS_INFO = Schema.STATUS_INFO;

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // COLOR HELPERS
    // ============================================================

    function getStatusColor(status) {
        var info = Queries.getStatusInfo(status);
        return info.color || 'var(--text-dim)';
    }

    function getPriorityColor(priority) {
        var info = Queries.getPriorityInfo(priority);
        return info.color || 'var(--text-dim)';
    }

    // ============================================================
    // RENDER API
    // ============================================================

    var MissionsRender = {
        /**
         * Render the mission list.
         * 
         * @param {array} missions - Array of mission objects
         * @returns {string} HTML string
         */
        renderList: function(missions) {
            if (!missions || missions.length === 0) {
                return '<p class="empty-state">No missions found.</p>';
            }

            var html = '';
            missions.forEach(function(mission) {
                var priorityInfo = Queries.getPriorityInfo(mission.priority);
                var statusInfo = Queries.getStatusInfo(mission.status);
                var teamName = Queries.getTeamName(mission.assignedTeamId);
                var teamType = Queries.getTeamTypeLabel(mission.assignedTeamId);
                var teamDisplay = teamName + (teamType ? ' (' + teamType + ')' : '');
                var difficultyLabel = Queries.getDifficultyLabel(mission.difficulty);
                var supportCount = mission.supportPersonnel ? mission.supportPersonnel.length : 0;

                var primaryType = mission.primaryType ? Queries.getMissionTypeLabel(mission.primaryType) : 'Unclassified';
                var subtypeLabel = Queries.getSubtypeLabel(mission.subtype);
                var secondaryType = mission.secondaryType ? Queries.getMissionTypeLabel(mission.secondaryType) : '';

                var typeDisplay = primaryType;
                if (subtypeLabel) typeDisplay += ' | ' + subtypeLabel;
                if (secondaryType) typeDisplay += ' | ' + secondaryType;

                var escalationLabel = Queries.getEscalationLabel(mission.escalation);
                var progressBar = mission.progress || 0;

                // Date display
                var dateDisplay = '';
                if (mission.year && mission.month && mission.day) {
                    var monthName = Queries.getMonthName(mission.month);
                    dateDisplay = monthName + ' ' + mission.day + ', ' + mission.year;
                } else if (mission.year) {
                    dateDisplay = String(mission.year);
                }

                html += '<div class="list-item mission-item" data-id="' + escapeHtml(mission.id) + '" style="grid-template-columns:0.8fr 0.8fr 1.2fr 0.8fr 0.5fr 0.5fr 0.5fr 0.5fr 0.6fr 0.5fr;cursor:pointer;">';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);font-family:monospace;">' + escapeHtml(mission.missionId || '—') + '</span>';
                html += '<span style="font-size:0.65rem;color:var(--text-dim);">' + escapeHtml(dateDisplay) + '</span>';
                html += '<span><strong>' + escapeHtml(mission.title) + '</strong>';
                if (mission.status === 'completed') {
                    html += ' <span style="color:var(--info);font-size:0.6rem;">✓</span>';
                }
                if (supportCount > 0) {
                    html += ' <span style="color:var(--accent);font-size:0.6rem;">+' + supportCount + ' support</span>';
                }
                html += '</span>';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">' + escapeHtml(typeDisplay) + '</span>';
                html += '<span style="font-size:0.65rem;color:var(--text-dim);">' + escapeHtml(escalationLabel) + '</span>';
                html += '<span style="color:' + escapeHtml(priorityInfo.color) + ';font-size:0.75rem;">' + escapeHtml(priorityInfo.label) + '</span>';
                html += '<span style="font-size:0.75rem;">' + escapeHtml(difficultyLabel) + '</span>';
                html += '<span style="color:' + escapeHtml(statusInfo.color) + ';font-size:0.75rem;">' + escapeHtml(statusInfo.label) + '</span>';
                html += '<span style="font-size:0.75rem;">' + escapeHtml(teamDisplay) + '</span>';
                html += '<span style="display:flex;align-items:center;gap:8px;">';
                html += '<div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden;">';
                html += '<div style="height:100%;width:' + escapeHtml(progressBar) + '%;background:var(--accent);border-radius:3px;"></div>';
                html += '</div>';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);min-width:35px;">' + escapeHtml(progressBar) + '%</span>';
                html += '</span>';
                html += '</div>';
            });

            return html;
        },

        /**
         * Render the mission form.
         * 
         * @param {object} mission - Mission object (null for new)
         * @param {array} teams - Array of team objects
         * @param {array} characters - Array of character objects
         * @param {array} supportIds - Array of support personnel IDs (for edit)
         * @returns {string} HTML string
         */
        renderForm: function(mission, teams, characters, supportIds) {
            var isEdit = !!mission;
            var m = mission || {};
            var now = new Date();

            var year = m.year || now.getFullYear();
            var month = m.month || now.getMonth() + 1;
            var day = m.day || now.getDate();

            supportIds = Array.isArray(supportIds) ? supportIds : [];

            var html = '<form class="mission-form" id="mission-form-inner">';
            html += '<div class="form-grid">';

            // Title
            html += '<div class="form-group full-width">';
            html += '<label>Mission Title *</label>';
            html += '<input type="text" id="mission-title" value="' + escapeHtml(m.title || '') + '" required placeholder="e.g., Operation Nightfall">';
            html += '</div>';

            // Description
            html += '<div class="form-group full-width">';
            html += '<label>Description</label>';
            html += '<textarea id="mission-description" rows="2" placeholder="Brief description of the mission...">' + escapeHtml(m.description || '') + '</textarea>';
            html += '</div>';

            // Mission ID (read-only)
            html += '<div class="form-group">';
            html += '<label>Mission ID</label>';
            html += '<input type="text" id="mission-id" readonly placeholder="Auto-generated" style="background:var(--bg);color:var(--text-dim);" value="' + escapeHtml(m.missionId || '') + '">';
            html += '<span style="font-size:0.6rem;color:var(--text-dim);">Auto-generated from Team, Year, Difficulty</span>';
            html += '</div>';

            // Date
            html += '<div class="form-group">';
            html += '<label>Date</label>';
            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
            html += '<div><label style="font-size:0.65rem;color:var(--text-dim);">Year</label><input type="number" id="mission-year" value="' + escapeHtml(year) + '" min="1900" max="9999" style="width:80px;"></div>';
            html += '<div><label style="font-size:0.65rem;color:var(--text-dim);">Month</label><select id="mission-month" style="width:100px;">';
            MONTH_NAMES.forEach(function(name, index) {
                var monthNum = index + 1;
                var selected = monthNum === month ? 'selected' : '';
                html += '<option value="' + monthNum + '" ' + selected + '>' + escapeHtml(name) + '</option>';
            });
            html += '</select></div>';
            html += '<div><label style="font-size:0.65rem;color:var(--text-dim);">Day</label><input type="number" id="mission-day" value="' + escapeHtml(day) + '" min="1" max="31" style="width:60px;"></div>';
            html += '</div></div>';

            // Primary Type
            html += '<div class="form-group">';
            html += '<label>Primary Category</label>';
            html += '<select id="mission-primary-type">';
            html += '<option value="">Select...</option>';
            Object.keys(MISSION_TYPES).forEach(function(key) {
                var type = MISSION_TYPES[key];
                var selected = m.primaryType === key ? 'selected' : '';
                html += '<option value="' + escapeHtml(key) + '" ' + selected + '>' + escapeHtml(type.icon + ' ' + type.label) + '</option>';
            });
            html += '</select></div>';

            // Subtype
            html += '<div class="form-group">';
            html += '<label>Subtype</label>';
            html += '<select id="mission-subtype">';
            html += '<option value="">Select...</option>';
            if (m.primaryType && MISSION_TYPES[m.primaryType]) {
                var subtypes = MISSION_TYPES[m.primaryType].subtypes;
                subtypes.forEach(function(subtype) {
                    var label = Queries.getSubtypeLabel(subtype);
                    var selected = m.subtype === subtype ? 'selected' : '';
                    html += '<option value="' + escapeHtml(subtype) + '" ' + selected + '>' + escapeHtml(label) + '</option>';
                });
            }
            html += '</select></div>';

            // Secondary Type
            html += '<div class="form-group">';
            html += '<label>Secondary Category</label>';
            html += '<select id="mission-secondary-type">';
            html += '<option value="">None</option>';
            Object.keys(MISSION_TYPES).forEach(function(key) {
                var type = MISSION_TYPES[key];
                var selected = m.secondaryType === key ? 'selected' : '';
                html += '<option value="' + escapeHtml(key) + '" ' + selected + '>' + escapeHtml(type.icon + ' ' + type.label) + '</option>';
            });
            html += '</select></div>';

            // Escalation
            html += '<div class="form-group">';
            html += '<label>Escalation Level</label>';
            html += '<select id="mission-escalation">';
            ['tier_i', 'tier_ii', 'tier_iii', 'tier_iv', 'tier_v'].forEach(function(tier) {
                var label = Queries.getEscalationLabel(tier);
                var selected = m.escalation === tier ? 'selected' : '';
                html += '<option value="' + escapeHtml(tier) + '" ' + selected + '>' + escapeHtml(label) + '</option>';
            });
            html += '</select></div>';

            // Threat Type
            html += '<div class="form-group">';
            html += '<label>Threat Type</label>';
            html += '<input type="text" id="mission-threat-type" value="' + escapeHtml(m.threatType || '') + '" placeholder="e.g., Human / Magical / Construct">';
            html += '</div>';

            // Environment
            html += '<div class="form-group">';
            html += '<label>Environment</label>';
            html += '<input type="text" id="mission-environment" value="' + escapeHtml(m.environment || '') + '" placeholder="e.g., Rural / Ley-Line Site / Underground">';
            html += '</div>';

            // Location
            html += '<div class="form-group">';
            html += '<label>Location</label>';
            html += '<input type="text" id="mission-location" value="' + escapeHtml(m.location || '') + '" placeholder="e.g., Berlin, Germany">';
            html += '</div>';

            // Duration
            html += '<div class="form-group">';
            html += '<label>Expected Duration</label>';
            html += '<input type="text" id="mission-duration" value="' + escapeHtml(m.duration || '') + '" placeholder="e.g., 3 days, 2 weeks">';
            html += '</div>';

            // Difficulty
            html += '<div class="form-group">';
            html += '<label>Difficulty</label>';
            html += '<select id="mission-difficulty">';
            ['easy', 'medium', 'hard', 'expert'].forEach(function(diff) {
                var label = Queries.getDifficultyLabel(diff);
                var selected = m.difficulty === diff ? 'selected' : '';
                html += '<option value="' + escapeHtml(diff) + '" ' + selected + '>' + escapeHtml(label) + '</option>';
            });
            html += '</select></div>';

            // Priority
            html += '<div class="form-group">';
            html += '<label>Priority</label>';
            html += '<select id="mission-priority">';
            ['low', 'medium', 'high', 'critical'].forEach(function(pri) {
                var info = Queries.getPriorityInfo(pri);
                var selected = m.priority === pri ? 'selected' : '';
                html += '<option value="' + escapeHtml(pri) + '" ' + selected + '>' + escapeHtml(info.label) + '</option>';
            });
            html += '</select></div>';

            // Base Pay
            html += '<div class="form-group">';
            html += '<label>Base Contract Pay</label>';
            html += '<input type="text" id="mission-base-pay" value="' + escapeHtml(m.basePay || '') + '" placeholder="e.g., 5000 credits">';
            html += '</div>';

            // Surcharge Pay
            html += '<div class="form-group">';
            html += '<label>Surcharge / Escalation Pay</label>';
            html += '<input type="text" id="mission-surcharge-pay" value="' + escapeHtml(m.surchargePay || '') + '" placeholder="e.g., 2000 credits">';
            html += '</div>';

            // Total Pay (read-only)
            html += '<div class="form-group">';
            html += '<label>Total Pay</label>';
            html += '<input type="text" id="mission-total-pay" readonly placeholder="Auto-calculated" style="background:var(--bg);color:var(--accent);font-weight:bold;" value="' + escapeHtml(m.pay || '') + '">';
            html += '</div>';

            // Billing
            html += '<div class="form-group">';
            html += '<label>Billing Status</label>';
            html += '<select id="mission-billing">';
            ['original', 'escalated', 'emergency', 'internal'].forEach(function(bill) {
                var label = Queries.getBillingLabel(bill);
                var selected = m.billing === bill ? 'selected' : '';
                html += '<option value="' + escapeHtml(bill) + '" ' + selected + '>' + escapeHtml(label) + '</option>';
            });
            html += '</select></div>';

            // Status
            html += '<div class="form-group">';
            html += '<label>Status</label>';
            html += '<select id="mission-status">';
            ['active', 'completed', 'cancelled'].forEach(function(status) {
                var info = Queries.getStatusInfo(status);
                var selected = m.status === status ? 'selected' : '';
                html += '<option value="' + escapeHtml(status) + '" ' + selected + '>' + escapeHtml(info.label) + '</option>';
            });
            html += '</select></div>';

            // Assign Team
            html += '<div class="form-group">';
            html += '<label>Assign Team</label>';
            html += '<select id="mission-team">';
            html += '<option value="">Unassigned</option>';
            if (Array.isArray(teams)) {
                var sortedTeams = teams.slice().sort(function(a, b) {
                    return (a.name || '').localeCompare(b.name || '');
                });
                sortedTeams.forEach(function(team) {
                    var selected = m.assignedTeamId === team.id ? 'selected' : '';
                    html += '<option value="' + escapeHtml(team.id) + '" ' + selected + '>' + escapeHtml(team.name) + '</option>';
                });
            }
            html += '</select></div>';

            // Support Personnel
            html += '<div class="form-group full-width">';
            html += '<label>Support Personnel</label>';
            html += '<p style="font-size:0.7rem;color:var(--text-dim);margin-bottom:4px;">Individual characters assigned to support this mission</p>';
            html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
            html += '<select id="mission-support-select" style="flex:1;min-width:150px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.7rem;">';
            html += '<option value="">Select character...</option>';
            if (Array.isArray(characters)) {
                var sortedChars = characters.slice().sort(function(a, b) {
                    var nameA = a.firstName || a.name || '';
                    var nameB = b.firstName || b.name || '';
                    return nameA.localeCompare(nameB);
                });
                sortedChars.forEach(function(char) {
                    var name = char.firstName || char.name || 'Unknown';
                    if (char.lastName) name += ' ' + char.lastName;
                    html += '<option value="' + escapeHtml(char.id) + '">' + escapeHtml(name) + '</option>';
                });
            }
            html += '</select>';
            html += '<button type="button" id="add-support-btn" class="small primary">+ Add Support</button>';
            html += '</div>';
            html += '<div id="mission-support-list" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">';
            // Support tags will be populated by UI
            html += '</div></div>';

            // Objectives
            html += '<div class="form-group full-width">';
            html += '<label>Objectives</label>';
            html += '<input type="text" id="mission-objective" placeholder="Add objective...">';
            html += '<button type="button" id="add-objective-btn" class="small primary" style="margin-top:4px;">+ Add Objective</button>';
            html += '<div id="mission-objectives-list" style="margin-top:8px;">';
            if (Array.isArray(m.objectives)) {
                m.objectives.forEach(function(obj) {
                    html += '<div style="display:flex;gap:6px;margin-bottom:4px;align-items:center;">';
                    html += '<span style="flex:1;font-size:0.8rem;padding:4px 8px;background:var(--bg);border-radius:4px;">' + escapeHtml(obj.text) + '</span>';
                    html += '<button type="button" class="small danger remove-objective-btn">✕</button>';
                    html += '<input type="hidden" class="objective-text" value="' + escapeHtml(obj.text) + '">';
                    html += '</div>';
                });
            }
            html += '</div></div>';

            // Notes
            html += '<div class="form-group full-width">';
            html += '<label>Notes</label>';
            html += '<textarea id="mission-notes" rows="2" placeholder="Additional notes...">' + escapeHtml(m.notes || '') + '</textarea>';
            html += '</div>';

            // Tags
            html += '<div class="form-group full-width">';
            html += '<label>Tags (comma separated)</label>';
            html += '<input type="text" id="mission-tags" value="' + escapeHtml(Array.isArray(m.tags) ? m.tags.join(', ') : '') + '" placeholder="e.g., covert, rescue, extraction">';
            html += '</div>';

            html += '</div>';

            // Actions
            html += '<div class="form-actions">';
            html += '<button type="button" id="cancel-mission-form" class="secondary">Cancel</button>';
            html += '<button type="submit" id="save-mission-btn" class="primary">' + (isEdit ? 'Update' : 'Create') + ' Mission</button>';
            html += '</div>';
            html += '</form>';

            return html;
        },

        /**
         * Render mission detail view.
         * 
         * @param {object} mission - Mission object
         * @returns {string} HTML string
         */
        renderDetail: function(mission) {
            if (!mission) return '<p class="empty-state">Mission not found.</p>';

            var priorityInfo = Queries.getPriorityInfo(mission.priority);
            var statusInfo = Queries.getStatusInfo(mission.status);
            var teamName = Queries.getTeamName(mission.assignedTeamId);
            var teamType = Queries.getTeamTypeLabel(mission.assignedTeamId);
            var teamDisplay = teamName + (teamType ? ' (' + teamType + ')' : '');
            var difficultyLabel = Queries.getDifficultyLabel(mission.difficulty);
            var supportPersonnel = Queries.getSupportPersonnel(mission);
            var supportNames = supportPersonnel.map(function(c) {
                return Queries.getSupportPersonnelName(c);
            });

            var primaryType = mission.primaryType ? Queries.getMissionTypeLabel(mission.primaryType) : 'Unclassified';
            var secondaryType = mission.secondaryType ? Queries.getMissionTypeLabel(mission.secondaryType) : 'None';
            var subtypeLabel = Queries.getSubtypeLabel(mission.subtype) || 'None';
            var escalationLabel = Queries.getEscalationLabel(mission.escalation);
            var billingLabel = Queries.getBillingLabel(mission.billing);

            var progressBar = mission.progress || 0;
            var createdAt = mission.createdAt ? new Date(mission.createdAt).toLocaleDateString() : '';
            var completedAt = mission.completedAt ? new Date(mission.completedAt).toLocaleDateString() : 'Not completed';

            var dateDisplay = '';
            if (mission.year && mission.month && mission.day) {
                var monthName = Queries.getMonthName(mission.month);
                dateDisplay = monthName + ' ' + mission.day + ', ' + mission.year;
            } else if (mission.year) {
                dateDisplay = String(mission.year);
            } else {
                dateDisplay = 'Not specified';
            }

            var payDisplay = '';
            if (mission.basePay && mission.surchargePay) {
                payDisplay = 'Base: ' + mission.basePay + ' | Surcharge: ' + mission.surchargePay + ' | Total: ' + mission.pay;
            } else if (mission.basePay) {
                payDisplay = 'Base: ' + mission.basePay;
            } else if (mission.pay) {
                payDisplay = mission.pay;
            } else {
                payDisplay = 'Not specified';
            }

            var html = '<div class="mission-detail">';

            // Basic info
            html += '<div class="detail-row"><span class="label">Mission ID:</span> <span style="font-family:monospace;font-weight:bold;color:var(--accent);">' + escapeHtml(mission.missionId || 'N/A') + '</span></div>';
            html += '<div class="detail-row"><span class="label">Date:</span> <span>' + escapeHtml(dateDisplay) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Status:</span> <span style="color:' + escapeHtml(statusInfo.color) + ';font-weight:600;">' + escapeHtml(statusInfo.label) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Priority:</span> <span style="color:' + escapeHtml(priorityInfo.color) + ';font-weight:600;">' + escapeHtml(priorityInfo.label) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Difficulty:</span> <span>' + escapeHtml(difficultyLabel) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Primary Category:</span> <span>' + escapeHtml(primaryType) + '</span></div>';
            if (mission.subtype) {
                html += '<div class="detail-row"><span class="label">Subtype:</span> <span>' + escapeHtml(subtypeLabel) + '</span></div>';
            }
            if (mission.secondaryType) {
                html += '<div class="detail-row"><span class="label">Secondary Category:</span> <span>' + escapeHtml(secondaryType) + '</span></div>';
            }
            html += '<div class="detail-row"><span class="label">Escalation Level:</span> <span>' + escapeHtml(escalationLabel) + '</span></div>';
            if (mission.threatType) {
                html += '<div class="detail-row"><span class="label">Threat Type:</span> <span>' + escapeHtml(mission.threatType) + '</span></div>';
            }
            if (mission.environment) {
                html += '<div class="detail-row"><span class="label">Environment:</span> <span>' + escapeHtml(mission.environment) + '</span></div>';
            }
            html += '<div class="detail-row"><span class="label">Team:</span> <span>' + escapeHtml(teamDisplay) + '</span></div>';

            // Support personnel
            if (supportNames.length > 0) {
                html += '<div class="detail-row"><span class="label">Support Personnel:</span> <span>' + escapeHtml(supportNames.join(', ')) + '</span></div>';
            }

            html += '<div class="detail-row"><span class="label">Location:</span> <span>' + escapeHtml(mission.location || 'Not specified') + '</span></div>';
            html += '<div class="detail-row"><span class="label">Duration:</span> <span>' + escapeHtml(mission.duration || 'Not specified') + '</span></div>';
            html += '<div class="detail-row"><span class="label">Payment:</span> <span>' + escapeHtml(payDisplay) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Billing:</span> <span>' + escapeHtml(billingLabel) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Created:</span> <span>' + escapeHtml(createdAt) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Completed:</span> <span>' + escapeHtml(completedAt) + '</span></div>';

            if (mission.description) {
                html += '<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="label">Description:</span><span style="padding:4px 0;">' + escapeHtml(mission.description) + '</span></div>';
            }
            if (mission.notes) {
                html += '<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="label">Notes:</span><span style="padding:4px 0;">' + escapeHtml(mission.notes) + '</span></div>';
            }

            // Tags
            if (mission.tags && mission.tags.length > 0) {
                html += '<div class="detail-row" style="flex-wrap:wrap;"><span class="label">Tags:</span>';
                mission.tags.forEach(function(tag) {
                    html += '<span style="background:var(--panel-alt);padding:2px 8px;border-radius:10px;font-size:0.65rem;color:var(--text-dim);margin-right:4px;">#' + escapeHtml(tag) + '</span>';
                });
                html += '</div>';
            }

            // Progress
            html += '<div style="margin-top:8px;"><strong>Progress:</strong>';
            html += '<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">';
            html += '<div style="flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden;">';
            html += '<div style="height:100%;width:' + escapeHtml(progressBar) + '%;background:var(--accent);border-radius:4px;"></div>';
            html += '</div>';
            html += '<span style="font-size:0.8rem;color:var(--text-dim);min-width:40px;">' + escapeHtml(progressBar) + '%</span>';
            html += '</div></div>';

            // Objectives
            if (mission.objectives && mission.objectives.length > 0) {
                html += '<div style="margin-top:8px;"><strong>Objectives:</strong><ul style="list-style:none;padding:0;margin:4px 0;">';
                mission.objectives.forEach(function(obj, index) {
                    var doneClass = obj.done ? 'style="text-decoration:line-through;color:var(--text-dim);"' : '';
                    html += '<li style="padding:4px 8px;border-bottom:1px solid var(--border-soft);display:flex;align-items:center;gap:8px;" ' + doneClass + '>';
                    html += '<input type="checkbox" ' + (obj.done ? 'checked' : '') + ' data-mission="' + escapeHtml(mission.id) + '" data-index="' + index + '" class="objective-check">';
                    html += '<span>' + escapeHtml(obj.text) + '</span>';
                    html += '</li>';
                });
                html += '</ul></div>';
            }

            // Activity log
            if (mission.log && mission.log.length > 0) {
                html += '<div style="margin-top:12px;max-height:150px;overflow-y:auto;font-size:0.75rem;background:var(--bg);border-radius:6px;padding:8px;">';
                html += '<strong>Activity Log:</strong>';
                mission.log.slice().reverse().forEach(function(entry) {
                    var date = new Date(entry.timestamp).toLocaleString();
                    html += '<div style="padding:2px 0;border-bottom:1px solid var(--border-soft);color:var(--text-dim);">' + escapeHtml(date) + ' - ' + escapeHtml(entry.message) + '</div>';
                });
                html += '</div>';
            }

            html += '</div>';
            return html;
        },

        /**
         * Render the main container HTML.
         * 
         * @returns {string} HTML string
         */
        renderContainer: function() {
            return `
                <div class="page-header">
                    <h2>Mission Manager</h2>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button id="add-mission-btn" class="primary">+ New Mission</button>
                        <button id="export-missions-csv-btn" class="small">⌘ Export CSV</button>
                        <button id="import-missions-csv-btn" class="small">⌘ Import CSV</button>
                        <button id="template-missions-csv-btn" class="small secondary">⌘ Template CSV</button>
                        <input type="file" id="missions-csv-file-input" accept=".csv" style="display:none" />
                    </div>
                </div>
                <div class="filter-section">
                    <label for="mission-filter">Filter:</label>
                    <select id="mission-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Missions</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                    <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Total: <span id="mission-count">0</span></span>
                </div>
                <div id="missions-list"></div>
                ${this.renderModals()}
            `;
        },

        /**
         * Render modal HTML.
         * 
         * @returns {string} HTML string
         */
        renderModals: function() {
            return `
                <div id="mission-form-modal" class="modal hidden">
                    <div class="modal-content" style="max-width:750px;">
                        <div class="modal-header">
                            <h3 id="mission-form-title">Create Mission</h3>
                            <button class="close-modal" id="close-mission-form">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div id="mission-form-content"></div>
                        </div>
                    </div>
                </div>

                <div id="mission-detail-modal" class="modal hidden">
                    <div class="modal-content" style="max-width:700px;">
                        <div class="modal-header">
                            <h3 id="detail-mission-title">Mission Details</h3>
                            <button class="close-modal" id="close-mission-detail">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div id="mission-detail-content"></div>
                            <div class="form-actions" style="margin-top:16px;">
                                <button type="button" id="edit-mission-from-detail" class="primary">Edit</button>
                                <button type="button" id="delete-mission-from-detail" class="danger">Delete Mission</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        },

        /**
         * Render a support personnel tag.
         * 
         * @param {string} characterId - Character ID
         * @param {string} characterName - Character display name
         * @returns {string} HTML string
         */
        renderSupportTag: function(characterId, characterName) {
            return `
                <div class="support-tag" data-id="${escapeHtml(characterId)}" style="display:flex;align-items:center;gap:4px;background:var(--panel-alt);padding:2px 8px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);">
                    <span>${escapeHtml(characterName)}</span>
                    <button type="button" class="remove-support-btn" data-id="${escapeHtml(characterId)}" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button>
                    <input type="hidden" class="support-personnel-id" value="${escapeHtml(characterId)}">
                </div>
            `;
        },

        /**
         * Render an objective list item.
         * 
         * @param {string} text - Objective text
         * @param {boolean} done - Whether the objective is done
         * @param {number} index - Objective index
         * @param {string} missionId - Mission ID (for checkbox data)
         * @returns {string} HTML string
         */
        renderObjective: function(text, done, index, missionId) {
            var doneClass = done ? 'style="text-decoration:line-through;color:var(--text-dim);"' : '';
            return `
                <div style="display:flex;gap:6px;margin-bottom:4px;align-items:center;" data-index="${escapeHtml(index)}">
                    <input type="checkbox" ${done ? 'checked' : ''} data-mission="${escapeHtml(missionId)}" data-index="${escapeHtml(index)}" class="objective-check">
                    <span style="flex:1;font-size:0.8rem;padding:4px 8px;background:var(--bg);border-radius:4px;" ${doneClass}>${escapeHtml(text)}</span>
                    <button type="button" class="small danger remove-objective-btn" data-index="${escapeHtml(index)}">✕</button>
                    <input type="hidden" class="objective-text" value="${escapeHtml(text)}">
                </div>
            `;
        },

        /**
         * Render an empty state message.
         * 
         * @param {string} message - Message to display
         * @returns {string} HTML string
         */
        renderEmpty: function(message) {
            return '<p class="empty-state">' + escapeHtml(message || 'No items found.') + '</p>';
        },

        /**
         * Render a loading state.
         * 
         * @returns {string} HTML string
         */
        renderLoading: function() {
            return '<p class="empty-state">Loading mission data...</p>';
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsRender = MissionsRender;

})();
