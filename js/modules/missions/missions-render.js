/**
 * js/modules/missions/missions-render.js - Mission Rendering
 * PURE rendering functions. Takes data, returns HTML.
 * Does NOT mutate data or attach event handlers.
 * 
 * RENDER PHILOSOPHY:
 *   - All rendering is PURE: data in, HTML out
 *   - Uses Queries for data interpretation (NOT Schema directly)
 *   - Escapes all user-controlled content
 *   - Does NOT attach event handlers (UI layer handles that)
 *   - Generates semantic HTML with CSS classes for styling
 *   - Uses defensive helpers for numeric values (progress, dates)
 * 
 * RENDER CONTRACT:
 *   - All functions return HTML strings
 *   - All user-controlled values are escaped
 *   - No DOM manipulation, no event listeners
 *   - Data interpretation is delegated to Queries
 *   - Inline styles are minimised; use CSS classes where possible
 *   - Progress values are clamped to 0-100 before rendering
 *   - Dates are validated before display
 * 
 * TEAM FILTERING:
 *   - Missions can ONLY be assigned to Professional or Temporary teams
 *   - Academic and Civilian teams are excluded from the dropdown
 * 
 * DEPENDENCIES:
 *   - MissionsQueries (required)
 *   - MissionsSchema (for constants ONLY via Queries)
 */

(function() {
    'use strict';

    if (window.__missionsRenderLoaded) return;

    if (!window.MissionsQueries) {
        console.error('MissionsRender: MissionsQueries required.');
        return;
    }

    window.__missionsRenderLoaded = true;

    var Queries = window.MissionsQueries;

    // ============================================================
    // TEAM FILTERING - Only Professional and Temporary teams
    // ============================================================

    var ALLOWED_TEAM_TYPES = ['professional', 'temporary'];

    function isTeamAllowedForMission(team) {
        if (!team || typeof team !== 'object') return false;
        return ALLOWED_TEAM_TYPES.indexOf(team.type) !== -1;
    }

    function filterTeamsForMission(teams) {
        if (!Array.isArray(teams)) return [];
        return teams.filter(isTeamAllowedForMission);
    }

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
    // DEFENSIVE HELPERS
    // ============================================================

    /**
     * Clamp progress to 0-100 for safe CSS and display.
     */
    function getSafeProgress(value) {
        var progress = Number(value);
        if (!Number.isFinite(progress)) return 0;
        return Math.max(0, Math.min(100, Math.round(progress)));
    }

    /**
     * Get a safe display date from mission date components.
     */
    function getSafeDateDisplay(mission) {
        if (!mission) return 'Not specified';

        var hasYear = mission.year !== undefined && mission.year !== null;
        var hasMonth = mission.month !== undefined && mission.month !== null;
        var hasDay = mission.day !== undefined && mission.day !== null;

        if (hasYear && hasMonth && hasDay) {
            if (Queries.isValidCalendarDate(mission.year, mission.month, mission.day)) {
                var monthName = Queries.getMonthName(mission.month);
                return monthName + ' ' + mission.day + ', ' + mission.year;
            }
        }

        if (hasYear) {
            return String(mission.year);
        }

        return 'Not specified';
    }

    /**
     * Format a date string safely.
     */
    function formatDateSafe(dateString) {
        if (!dateString) return '';
        try {
            var date = new Date(dateString);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleDateString();
        } catch (e) {
            return '';
        }
    }

    /**
     * Format a date and time string safely.
     */
    function formatDateTimeSafe(dateString) {
        if (!dateString) return '';
        try {
            var date = new Date(dateString);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleString();
        } catch (e) {
            return '';
        }
    }

    /**
     * Format a log entry timestamp safely.
     */
    function formatLogTimestamp(timestamp) {
        if (!timestamp) return '';
        try {
            var date = new Date(timestamp);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleString();
        } catch (e) {
            return '';
        }
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
                var progressBar = getSafeProgress(mission.progress);

                var dateDisplay = getSafeDateDisplay(mission);

                html += '<div class="list-item mission-item" data-id="' + escapeHtml(mission.id) + '">';
                html += '<span class="mission-id">' + escapeHtml(mission.missionId || '—') + '</span>';
                html += '<span class="mission-date">' + escapeHtml(dateDisplay) + '</span>';
                html += '<span class="mission-title"><strong>' + escapeHtml(mission.title) + '</strong>';
                if (mission.status === 'completed') {
                    html += ' <span class="mission-completed-badge">✓</span>';
                }
                if (supportCount > 0) {
                    html += ' <span class="mission-support-badge">+' + supportCount + ' support</span>';
                }
                html += '</span>';
                html += '<span class="mission-type">' + escapeHtml(typeDisplay) + '</span>';
                html += '<span class="mission-escalation">' + escapeHtml(escalationLabel) + '</span>';
                html += '<span class="mission-priority" style="color:' + escapeHtml(priorityInfo.color) + ';">' + escapeHtml(priorityInfo.label) + '</span>';
                html += '<span class="mission-difficulty">' + escapeHtml(difficultyLabel) + '</span>';
                html += '<span class="mission-status" style="color:' + escapeHtml(statusInfo.color) + ';">' + escapeHtml(statusInfo.label) + '</span>';
                html += '<span class="mission-team">' + escapeHtml(teamDisplay) + '</span>';
                html += '<span class="mission-progress">';
                html += '<div class="progress-bar"><div class="progress-fill" style="width:' + escapeHtml(progressBar) + '%;"></div></div>';
                html += '<span class="progress-label">' + escapeHtml(progressBar) + '%</span>';
                html += '</span>';
                html += '</div>';
            });

            return html;
        },

        /**
         * Render the mission form.
         * 
         * @param {object} mission - Mission object (null for new)
         * @param {array} teams - Array of team objects (will be filtered)
         * @param {array} characters - Array of character objects
         * @param {array} supportIds - Array of support personnel IDs (for edit)
         * @returns {string} HTML string
         */
        renderForm: function(mission, teams, characters, supportIds) {
            var isEdit = !!mission;
            var m = mission || {};
            var now = new Date();

            var year = m.year !== undefined && m.year !== null ? m.year : now.getFullYear();
            var month = m.month !== undefined && m.month !== null ? m.month : now.getMonth() + 1;
            var day = m.day !== undefined && m.day !== null ? m.day : now.getDate();

            supportIds = Array.isArray(supportIds) ? supportIds : [];

            // Get valid values from Queries
            var validDifficulties = Queries.getValidDifficulties ? Queries.getValidDifficulties() : ['easy', 'medium', 'hard', 'expert'];
            var validPriorities = Queries.getValidPriorities ? Queries.getValidPriorities() : ['low', 'medium', 'high', 'critical'];
            var validStatuses = Queries.getValidStatuses ? Queries.getValidStatuses() : ['active', 'completed', 'cancelled'];
            var validBillingTypes = Queries.getValidBillingTypes ? Queries.getValidBillingTypes() : ['original', 'escalated', 'emergency', 'internal'];
            var validEscalationTiers = Queries.getValidEscalationTiers ? Queries.getValidEscalationTiers() : ['tier_i', 'tier_ii', 'tier_iii', 'tier_iv', 'tier_v'];
            var missionTypes = Queries.getMissionTypes ? Queries.getMissionTypes() : {};

            // Filter teams: ONLY Professional and Temporary teams
            var filteredTeams = filterTeamsForMission(teams);

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
            html += '<input type="text" id="mission-id" readonly placeholder="Auto-generated" class="mission-id-preview" value="' + escapeHtml(m.missionId || '') + '">';
            html += '<span class="field-hint">Auto-generated from Team, Year, Difficulty</span>';
            html += '</div>';

            // Date
            html += '<div class="form-group">';
            html += '<label>Date</label>';
            html += '<div class="date-input-group">';
            html += '<div class="date-field"><label class="date-label">Year</label><input type="number" id="mission-year" value="' + escapeHtml(year) + '" min="1000" max="9999" class="date-year"></div>';
            html += '<div class="date-field"><label class="date-label">Month</label><select id="mission-month" class="date-month">';
            Queries.MONTH_NAMES.forEach(function(name, index) {
                var monthNum = index + 1;
                var selected = monthNum === month ? 'selected' : '';
                html += '<option value="' + monthNum + '" ' + selected + '>' + escapeHtml(name) + '</option>';
            });
            html += '</select></div>';
            html += '<div class="date-field"><label class="date-label">Day</label><input type="number" id="mission-day" value="' + escapeHtml(day) + '" min="1" max="31" class="date-day"></div>';
            html += '</div></div>';

            // Primary Type
            html += '<div class="form-group">';
            html += '<label>Primary Category</label>';
            html += '<select id="mission-primary-type">';
            html += '<option value="">Select...</option>';
            Object.keys(missionTypes).forEach(function(key) {
                var type = missionTypes[key];
                var selected = m.primaryType === key ? 'selected' : '';
                html += '<option value="' + escapeHtml(key) + '" ' + selected + '>' + escapeHtml(type.icon + ' ' + type.label) + '</option>';
            });
            html += '</select></div>';

            // Subtype
            html += '<div class="form-group">';
            html += '<label>Subtype</label>';
            html += '<select id="mission-subtype">';
            html += '<option value="">Select...</option>';
            if (m.primaryType) {
                var subtypes = Queries.getSubtypesForType(m.primaryType);
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
            Object.keys(missionTypes).forEach(function(key) {
                var type = missionTypes[key];
                var selected = m.secondaryType === key ? 'selected' : '';
                html += '<option value="' + escapeHtml(key) + '" ' + selected + '>' + escapeHtml(type.icon + ' ' + type.label) + '</option>';
            });
            html += '</select></div>';

            // Escalation
            html += '<div class="form-group">';
            html += '<label>Escalation Level</label>';
            html += '<select id="mission-escalation">';
            validEscalationTiers.forEach(function(tier) {
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
            validDifficulties.forEach(function(diff) {
                var label = Queries.getDifficultyLabel(diff);
                var selected = m.difficulty === diff ? 'selected' : '';
                html += '<option value="' + escapeHtml(diff) + '" ' + selected + '>' + escapeHtml(label) + '</option>';
            });
            html += '</select></div>';

            // Priority
            html += '<div class="form-group">';
            html += '<label>Priority</label>';
            html += '<select id="mission-priority">';
            validPriorities.forEach(function(pri) {
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
            html += '<input type="text" id="mission-total-pay" readonly placeholder="Auto-calculated" class="total-pay-display" value="' + escapeHtml(m.pay || '') + '">';
            html += '</div>';

            // Billing
            html += '<div class="form-group">';
            html += '<label>Billing Status</label>';
            html += '<select id="mission-billing">';
            validBillingTypes.forEach(function(bill) {
                var label = Queries.getBillingLabel(bill);
                var selected = m.billing === bill ? 'selected' : '';
                html += '<option value="' + escapeHtml(bill) + '" ' + selected + '>' + escapeHtml(label) + '</option>';
            });
            html += '</select></div>';

            // Status
            html += '<div class="form-group">';
            html += '<label>Status</label>';
            html += '<select id="mission-status">';
            validStatuses.forEach(function(status) {
                var info = Queries.getStatusInfo(status);
                var selected = m.status === status ? 'selected' : '';
                html += '<option value="' + escapeHtml(status) + '" ' + selected + '>' + escapeHtml(info.label) + '</option>';
            });
            html += '</select></div>';

            // Assign Team - FILTERED to Professional and Temporary only
            html += '<div class="form-group">';
            html += '<label>Assign Team</label>';
            html += '<p class="field-hint" style="font-size:0.65rem;color:var(--text-dim);">Missions can only be assigned to Professional or Temporary teams</p>';
            html += '<select id="mission-team">';
            html += '<option value="">Unassigned</option>';

            if (filteredTeams.length > 0) {
                // Sort teams: Professional first, then Temporary
                var sortedTeams = filteredTeams.slice().sort(function(a, b) {
                    var typeOrder = { 'professional': 0, 'temporary': 1 };
                    var orderA = typeOrder[a.type] !== undefined ? typeOrder[a.type] : 2;
                    var orderB = typeOrder[b.type] !== undefined ? typeOrder[b.type] : 2;
                    if (orderA !== orderB) return orderA - orderB;
                    return (a.name || '').localeCompare(b.name || '');
                });

                // Group by type for optgroups
                var professionalTeams = sortedTeams.filter(function(t) { return t.type === 'professional'; });
                var temporaryTeams = sortedTeams.filter(function(t) { return t.type === 'temporary'; });

                if (professionalTeams.length > 0) {
                    html += '<optgroup label="Professional Teams">';
                    professionalTeams.forEach(function(team) {
                        var selected = Queries.normaliseId(m.assignedTeamId) === Queries.normaliseId(team.id) ? 'selected' : '';
                        html += '<option value="' + escapeHtml(team.id) + '" ' + selected + '>' + escapeHtml(team.name) + '</option>';
                    });
                    html += '</optgroup>';
                }

                if (temporaryTeams.length > 0) {
                    html += '<optgroup label="Temporary Teams">';
                    temporaryTeams.forEach(function(team) {
                        var selected = Queries.normaliseId(m.assignedTeamId) === Queries.normaliseId(team.id) ? 'selected' : '';
                        html += '<option value="' + escapeHtml(team.id) + '" ' + selected + '>' + escapeHtml(team.name) + '</option>';
                    });
                    html += '</optgroup>';
                }
            } else {
                html += '<option value="" disabled style="color:var(--text-dim);">No Professional or Temporary teams available</option>';
            }

            html += '</select></div>';

            // Support Personnel
            html += '<div class="form-group full-width">';
            html += '<label>Support Personnel</label>';
            html += '<p class="field-hint">Individual characters assigned to support this mission</p>';
            html += '<div class="support-input-group">';
            html += '<select id="mission-support-select" class="support-select">';
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
            html += '<div id="mission-support-list" class="support-list"></div></div>';

            // Objectives
            html += '<div class="form-group full-width">';
            html += '<label>Objectives</label>';
            html += '<div class="objective-input-group">';
            html += '<input type="text" id="mission-objective" placeholder="Add objective..." class="objective-input">';
            html += '<button type="button" id="add-objective-btn" class="small primary">+ Add Objective</button>';
            html += '</div>';
            html += '<div id="mission-objectives-list" class="objectives-list"></div></div>';

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
            var supportNames = Queries.getSupportPersonnelNames(mission);

            var primaryType = mission.primaryType ? Queries.getMissionTypeLabel(mission.primaryType) : 'Unclassified';
            var secondaryType = mission.secondaryType ? Queries.getMissionTypeLabel(mission.secondaryType) : 'None';
            var subtypeLabel = Queries.getSubtypeLabel(mission.subtype) || 'None';
            var escalationLabel = Queries.getEscalationLabel(mission.escalation);
            var billingLabel = Queries.getBillingLabel(mission.billing);

            var progressBar = getSafeProgress(mission.progress);
            var createdAt = formatDateSafe(mission.createdAt);
            var completedAt = mission.completedAt ? formatDateSafe(mission.completedAt) : 'Not completed';

            var dateDisplay = getSafeDateDisplay(mission);

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
            html += '<div class="detail-row"><span class="label">Mission ID:</span> <span class="mission-id-display">' + escapeHtml(mission.missionId || 'N/A') + '</span></div>';
            html += '<div class="detail-row"><span class="label">Date:</span> <span>' + escapeHtml(dateDisplay) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Status:</span> <span class="status-display" style="color:' + escapeHtml(statusInfo.color) + ';">' + escapeHtml(statusInfo.label) + '</span></div>';
            html += '<div class="detail-row"><span class="label">Priority:</span> <span class="priority-display" style="color:' + escapeHtml(priorityInfo.color) + ';">' + escapeHtml(priorityInfo.label) + '</span></div>';
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
                html += '<div class="detail-row description-row"><span class="label">Description:</span><span class="description-text">' + escapeHtml(mission.description) + '</span></div>';
            }
            if (mission.notes) {
                html += '<div class="detail-row notes-row"><span class="label">Notes:</span><span class="notes-text">' + escapeHtml(mission.notes) + '</span></div>';
            }

            // Tags
            if (mission.tags && mission.tags.length > 0) {
                html += '<div class="detail-row tags-row"><span class="label">Tags:</span><span class="tags-list">';
                mission.tags.forEach(function(tag) {
                    html += '<span class="tag">#' + escapeHtml(tag) + '</span>';
                });
                html += '</span></div>';
            }

            // Progress
            html += '<div class="progress-section"><strong>Progress:</strong>';
            html += '<div class="progress-bar-container">';
            html += '<div class="progress-bar"><div class="progress-fill" style="width:' + escapeHtml(progressBar) + '%;"></div></div>';
            html += '<span class="progress-label">' + escapeHtml(progressBar) + '%</span>';
            html += '</div></div>';

            // Objectives
            if (mission.objectives && mission.objectives.length > 0) {
                html += '<div class="objectives-section"><strong>Objectives:</strong><ul class="objectives-list">';
                mission.objectives.forEach(function(obj, index) {
                    var doneClass = obj.done ? 'objective-done' : '';
                    html += '<li class="objective-item ' + doneClass + '">';
                    html += '<input type="checkbox" ' + (obj.done ? 'checked' : '') + ' data-mission="' + escapeHtml(mission.id) + '" data-index="' + index + '" class="objective-check">';
                    html += '<span>' + escapeHtml(obj.text) + '</span>';
                    html += '</li>';
                });
                html += '</ul></div>';
            }

            // Activity log
            if (mission.log && mission.log.length > 0) {
                html += '<div class="log-section"><strong>Activity Log:</strong><div class="log-list">';
                mission.log.slice().reverse().forEach(function(entry) {
                    var timestamp = formatLogTimestamp(entry.timestamp);
                    html += '<div class="log-entry">' + escapeHtml(timestamp) + ' - ' + escapeHtml(entry.message) + '</div>';
                });
                html += '</div></div>';
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
                    <div class="header-actions">
                        <button id="add-mission-btn" class="primary">+ New Mission</button>
                        <button id="export-missions-csv-btn" class="small">⌘ Export CSV</button>
                        <button id="import-missions-csv-btn" class="small">⌘ Import CSV</button>
                        <button id="template-missions-csv-btn" class="small secondary">⌘ Template CSV</button>
                        <input type="file" id="missions-csv-file-input" accept=".csv" style="display:none" />
                    </div>
                </div>
                <div class="filter-section">
                    <label for="mission-filter">Filter:</label>
                    <select id="mission-filter">
                        <option value="all">All Missions</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                    <span class="mission-count">Total: <span id="mission-count">0</span></span>
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
                    <div class="modal-content modal-form-content">
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
                    <div class="modal-content modal-detail-content">
                        <div class="modal-header">
                            <h3 id="detail-mission-title">Mission Details</h3>
                            <button class="close-modal" id="close-mission-detail">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div id="mission-detail-content"></div>
                            <div class="form-actions">
                                <button type="button" id="edit-mission-from-detail" class="primary">Edit</button>
                                <button type="button" id="delete-mission-from-detail" class="danger">Delete Mission</button>
                            </div>
                        </div>
                    </div>
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
