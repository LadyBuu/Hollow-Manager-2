/**
 * js/modules/missions.js - Mission Manager
 * Handles mission creation, assignment, tracking, and completion
 * Path: js/modules/missions.js
 * 
 * MISSION TYPE TAXONOMY:
 * 
 * Primary Categories:
 *   1. Combat - Elimination, Defence, Protection
 *   2. Recovery - Retrieval, Rescue, Recovery of materials/artifacts
 *   3. Investigation - Investigation, Reconnaissance, Surveillance
 *   4. Exploration - Exploration, Survey, Expedition
 *   5. Infiltration - Stealth entry, Social infiltration, Theft/recovery, Espionage
 *   6. Containment - Capture, Magical containment, Quarantine
 *   7. Acquisition - Ingredients, Resources, Specimens
 *   8. Research - Observation, Field research, Field testing
 *   9. Diplomatic - Negotiation, Mediation, Representation
 *   10. Assassination
 * 
 * Format: Primary Category | Subtype | Secondary Category (optional)
 * Example: "Investigation | Reconnaissance"
 * 
 * MISSION ID FORMAT:
 *   {TeamAbbr}-{Year}-{DifficultyCode}{Sequence}
 *   Example: RS-2026-H001 (Raven Squad, 2026, Hard, #1)
 * 
 * DIFFICULTY CODES:
 *   E = Easy
 *   M = Medium  
 *   H = Hard
 *   X = Expert
 * 
 * SUPPORT PERSONNEL:
 *   Individual characters can be added to missions as support.
 *   They are separate from the assigned team and can be any character.
 */

(function() {
    'use strict';

    // ============================================================
    // MISSION TYPE TAXONOMY
    // ============================================================

    var MISSION_TYPES = {
        'combat': {
            id: 'combat',
            label: 'Combat',
            icon: '⚔',
            color: 'var(--danger)',
            description: 'Direct combat operations, elimination, defence, protection',
            subtypes: ['elimination', 'defence', 'protection']
        },
        'recovery': {
            id: 'recovery',
            label: 'Recovery',
            icon: '◈',
            color: 'var(--warning)',
            description: 'Retrieval of people, materials, or artifacts',
            subtypes: ['retrieval', 'rescue', 'material_recovery', 'artifact_recovery']
        },
        'investigation': {
            id: 'investigation',
            label: 'Investigation',
            icon: '◉',
            color: 'var(--accent)',
            description: 'Investigations, reconnaissance, surveillance',
            subtypes: ['investigation', 'reconnaissance', 'surveillance']
        },
        'exploration': {
            id: 'exploration',
            label: 'Exploration',
            icon: '⌂',
            color: 'var(--info)',
            description: 'Exploration, surveys, expeditions',
            subtypes: ['exploration', 'survey', 'expedition']
        },
        'infiltration': {
            id: 'infiltration',
            label: 'Infiltration',
            icon: '◈',
            color: 'var(--warning)',
            description: 'Stealth entry, social infiltration, espionage',
            subtypes: ['stealth_entry', 'social_infiltration', 'theft_recovery', 'espionage']
        },
        'containment': {
            id: 'containment',
            label: 'Containment',
            icon: '⊗',
            color: 'var(--warning)',
            description: 'Capture, magical containment, quarantine',
            subtypes: ['capture', 'magical_containment', 'quarantine']
        },
        'acquisition': {
            id: 'acquisition',
            label: 'Acquisition',
            icon: '◈',
            color: 'var(--accent)',
            description: 'Gathering ingredients, resources, or specimens',
            subtypes: ['ingredients', 'resources', 'specimens']
        },
        'research': {
            id: 'research',
            label: 'Research',
            icon: '◈',
            color: 'var(--info)',
            description: 'Observation, field research, field testing',
            subtypes: ['observation', 'field_research', 'field_testing']
        },
        'diplomatic': {
            id: 'diplomatic',
            label: 'Diplomatic',
            icon: '◈',
            color: 'var(--accent)',
            description: 'Negotiation, mediation, representation',
            subtypes: ['negotiation', 'mediation', 'representation']
        },
        'assassination': {
            id: 'assassination',
            label: 'Assassination',
            icon: '◈',
            color: 'var(--danger)',
            description: 'Targeted elimination',
            subtypes: ['targeted_elimination']
        }
    };

    // Secondary type options (same as primary types)
    var SECONDARY_TYPES = Object.keys(MISSION_TYPES);

    // Difficulty codes for mission ID generation
    var DIFFICULTY_CODES = {
        'easy': 'E',
        'medium': 'M',
        'hard': 'H',
        'expert': 'X'
    };

    // Month names for display
    var MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        currentFilter: 'all',
        currentMissionId: null
    };

    // ============================================================
    // RENDER VIEW
    // ============================================================

    function renderMissionsView(container) {
        if (!container) {
            container = document.getElementById('tab-missions');
        }
        if (!container) return;

        container.innerHTML = getMissionsHTML();

        populateTeamSelectors();
        populateCharacterSelectors();
        populateSubtypeSelectors();
        renderMissions();
        initMissionEvents();
    }

    function getMissionsHTML() {
        var currentYear = new Date().getFullYear();
        var currentMonth = new Date().getMonth() + 1;
        var currentDay = new Date().getDate();

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
            <div id="missions-list">
                <p class="empty-state">No missions created yet. Create your first mission!</p>
            </div>

            <!-- Mission Form Modal -->
            <div id="mission-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:750px;">
                    <div class="modal-header">
                        <h3 id="mission-form-title">Create Mission</h3>
                        <button class="close-modal" id="close-mission-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="mission-form-inner">
                            <div class="form-grid">
                                <div class="form-group full-width">
                                    <label>Mission Title *</label>
                                    <input type="text" id="mission-title" required placeholder="e.g., Operation Nightfall">
                                </div>
                                <div class="form-group full-width">
                                    <label>Description</label>
                                    <textarea id="mission-description" rows="2" placeholder="Brief description of the mission..."></textarea>
                                </div>
                                <div class="form-group">
                                    <label>Mission ID</label>
                                    <input type="text" id="mission-id" readonly placeholder="Auto-generated on save" style="background:var(--bg);color:var(--text-dim);">
                                    <span style="font-size:0.6rem;color:var(--text-dim);">Auto-generated: {Team}-{Year}-{Difficulty}{Sequence}</span>
                                </div>
                                <div class="form-group">
                                    <label>Date</label>
                                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                                        <div>
                                            <label style="font-size:0.65rem;color:var(--text-dim);">Year</label>
                                            <input type="number" id="mission-year" value="${currentYear}" style="width:80px;">
                                        </div>
                                        <div>
                                            <label style="font-size:0.65rem;color:var(--text-dim);">Month</label>
                                            <select id="mission-month" style="width:100px;">
                                                ${MONTH_NAMES.map(function(name, index) {
                                                    var monthNum = index + 1;
                                                    var selected = monthNum === currentMonth ? 'selected' : '';
                                                    return '<option value="' + monthNum + '" ' + selected + '>' + name + '</option>';
                                                }).join('')}
                                            </select>
                                        </div>
                                        <div>
                                            <label style="font-size:0.65rem;color:var(--text-dim);">Day</label>
                                            <input type="number" id="mission-day" value="${currentDay}" min="1" max="31" style="width:60px;">
                                        </div>
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label>Primary Category</label>
                                    <select id="mission-primary-type">
                                        <option value="">Select...</option>
                                        ${Object.keys(MISSION_TYPES).map(function(key) {
                                            var type = MISSION_TYPES[key];
                                            return '<option value="' + key + '">' + type.icon + ' ' + type.label + '</option>';
                                        }).join('')}
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Subtype</label>
                                    <select id="mission-subtype">
                                        <option value="">Select...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Secondary Category</label>
                                    <select id="mission-secondary-type">
                                        <option value="">None</option>
                                        ${Object.keys(MISSION_TYPES).map(function(key) {
                                            var type = MISSION_TYPES[key];
                                            return '<option value="' + key + '">' + type.icon + ' ' + type.label + '</option>';
                                        }).join('')}
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Escalation Level</label>
                                    <select id="mission-escalation">
                                        <option value="tier_i">Tier I - Routine</option>
                                        <option value="tier_ii" selected>Tier II - Complicated</option>
                                        <option value="tier_iii">Tier III - Dangerous</option>
                                        <option value="tier_iv">Tier IV - Critical</option>
                                        <option value="tier_v">Tier V - Catastrophic</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Threat Type</label>
                                    <input type="text" id="mission-threat-type" placeholder="e.g., Human / Magical / Construct">
                                </div>
                                <div class="form-group">
                                    <label>Environment</label>
                                    <input type="text" id="mission-environment" placeholder="e.g., Rural / Ley-Line Site / Underground">
                                </div>
                                <div class="form-group">
                                    <label>Location</label>
                                    <input type="text" id="mission-location" placeholder="e.g., Berlin, Germany">
                                </div>
                                <div class="form-group">
                                    <label>Expected Duration</label>
                                    <input type="text" id="mission-duration" placeholder="e.g., 3 days, 2 weeks">
                                </div>
                                <div class="form-group">
                                    <label>Difficulty</label>
                                    <select id="mission-difficulty">
                                        <option value="easy">Easy</option>
                                        <option value="medium" selected>Medium</option>
                                        <option value="hard">Hard</option>
                                        <option value="expert">Expert</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Priority</label>
                                    <select id="mission-priority">
                                        <option value="low">Low</option>
                                        <option value="medium" selected>Medium</option>
                                        <option value="high">High</option>
                                        <option value="critical">Critical</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Base Contract Pay</label>
                                    <input type="text" id="mission-base-pay" placeholder="e.g., 5000 credits">
                                </div>
                                <div class="form-group">
                                    <label>Surcharge / Escalation Pay</label>
                                    <input type="text" id="mission-surcharge-pay" placeholder="e.g., 2000 credits">
                                    <span style="font-size:0.6rem;color:var(--text-dim);">Additional payment for escalated circumstances</span>
                                </div>
                                <div class="form-group">
                                    <label>Total Pay</label>
                                    <input type="text" id="mission-total-pay" readonly placeholder="Auto-calculated" style="background:var(--bg);color:var(--accent);font-weight:bold;">
                                </div>
                                <div class="form-group">
                                    <label>Billing Status</label>
                                    <select id="mission-billing">
                                        <option value="original">Original Contract</option>
                                        <option value="escalated">Escalated / Surcharge</option>
                                        <option value="emergency">Emergency Intervention</option>
                                        <option value="internal">Internal / Research</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Status</label>
                                    <select id="mission-status">
                                        <option value="active">Active</option>
                                        <option value="completed">Completed</option>
                                        <option value="cancelled">Cancelled</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Assign Team</label>
                                    <select id="mission-team">
                                        <option value="">Unassigned</option>
                                    </select>
                                </div>
                                <div class="form-group full-width">
                                    <label>Support Personnel</label>
                                    <p style="font-size:0.7rem;color:var(--text-dim);margin-bottom:4px;">Individual characters assigned to support this mission</p>
                                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                                        <select id="mission-support-select" style="flex:1;min-width:150px;">
                                            <option value="">Select character...</option>
                                        </select>
                                        <button type="button" id="add-support-btn" class="small primary">+ Add Support</button>
                                    </div>
                                    <div id="mission-support-list" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;"></div>
                                </div>
                                <div class="form-group full-width">
                                    <label>Objectives</label>
                                    <input type="text" id="mission-objective" placeholder="Add objective...">
                                    <button type="button" id="add-objective-btn" class="small primary" style="margin-top:4px;">+ Add Objective</button>
                                    <div id="mission-objectives-list" style="margin-top:8px;"></div>
                                </div>
                                <div class="form-group full-width">
                                    <label>Notes</label>
                                    <textarea id="mission-notes" rows="2" placeholder="Additional notes..."></textarea>
                                </div>
                                <div class="form-group full-width">
                                    <label>Tags (comma separated)</label>
                                    <input type="text" id="mission-tags" placeholder="e.g., covert, rescue, extraction">
                                </div>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-mission-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-mission-btn" class="primary">Save Mission</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Mission Detail Modal -->
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
    }

    // ============================================================
    // AUTO-GENERATE MISSION ID
    // ============================================================

    function generateMissionId(teamId, year, difficulty) {
        var data = window.data || {};
        var missions = data.missions || [];
        
        // Get team abbreviation
        var teamAbbr = '';
        if (teamId) {
            var team = window.getTeamById(teamId);
            if (team) {
                // Generate abbreviation from team name
                var nameParts = team.name.split(' ');
                if (nameParts.length === 1) {
                    teamAbbr = nameParts[0].substring(0, 3).toUpperCase();
                } else {
                    teamAbbr = nameParts.map(function(part) {
                        return part.charAt(0).toUpperCase();
                    }).join('');
                }
                // Ensure it's at least 2 characters
                if (teamAbbr.length < 2) {
                    teamAbbr = teamAbbr.padEnd(2, 'X');
                }
            }
        }
        
        if (!teamAbbr) {
            teamAbbr = 'UNS'; // Unassigned
        }

        // Use full year for ID (no hardcoded range)
        var yearStr = String(year).slice(-2);
        var difficultyCode = DIFFICULTY_CODES[difficulty] || 'M';

        // Count missions with same prefix to get sequence number
        var prefix = teamAbbr + '-' + yearStr + '-' + difficultyCode;
        var sequence = 1;
        
        missions.forEach(function(m) {
            if (m.missionId && m.missionId.startsWith(prefix)) {
                var numPart = m.missionId.replace(prefix, '');
                var num = parseInt(numPart);
                if (!isNaN(num) && num >= sequence) {
                    sequence = num + 1;
                }
            }
        });

        return prefix + String(sequence).padStart(3, '0');
    }

    // ============================================================
    // CHARACTER SELECTOR
    // ============================================================

    function populateCharacterSelectors() {
        var select = document.getElementById('mission-support-select');
        if (!select) return;

        var characters = window.getStudents ? window.getStudents() : [];
        if (!characters || characters.length === 0) {
            characters = window.data && window.data.characters ? window.data.characters : [];
        }

        select.innerHTML = '<option value="">Select character...</option>';

        characters.forEach(function(char) {
            var name = window.getDisplayName ? window.getDisplayName(char) : (char.name || char.firstName || 'Unknown');
            var option = document.createElement('option');
            option.value = char.id;
            option.textContent = name + ' (' + (char.status || 'Active') + ')';
            select.appendChild(option);
        });
    }

    // ============================================================
    // SUBTYPE SELECTOR
    // ============================================================

    function populateSubtypeSelectors() {
        var primarySelect = document.getElementById('mission-primary-type');
        var subtypeSelect = document.getElementById('mission-subtype');

        if (!primarySelect || !subtypeSelect) return;

        var currentSubtype = subtypeSelect.value || '';

        subtypeSelect.innerHTML = '<option value="">Select...</option>';

        var selectedPrimary = primarySelect.value;
        if (selectedPrimary && MISSION_TYPES[selectedPrimary]) {
            var subtypes = MISSION_TYPES[selectedPrimary].subtypes || [];
            var subtypeLabels = {
                'elimination': 'Elimination',
                'defence': 'Defence',
                'protection': 'Protection',
                'retrieval': 'Retrieval',
                'rescue': 'Rescue',
                'material_recovery': 'Material Recovery',
                'artifact_recovery': 'Artifact Recovery',
                'investigation': 'Investigation',
                'reconnaissance': 'Reconnaissance',
                'surveillance': 'Surveillance',
                'exploration': 'Exploration',
                'survey': 'Survey',
                'expedition': 'Expedition',
                'stealth_entry': 'Stealth Entry',
                'social_infiltration': 'Social Infiltration',
                'theft_recovery': 'Theft / Recovery',
                'espionage': 'Espionage',
                'capture': 'Capture',
                'magical_containment': 'Magical Containment',
                'quarantine': 'Quarantine',
                'ingredients': 'Ingredients',
                'resources': 'Resources',
                'specimens': 'Specimens',
                'observation': 'Observation',
                'field_research': 'Field Research',
                'field_testing': 'Field Testing',
                'negotiation': 'Negotiation',
                'mediation': 'Mediation',
                'representation': 'Representation',
                'targeted_elimination': 'Targeted Elimination'
            };
            subtypes.forEach(function(subtype) {
                var option = document.createElement('option');
                option.value = subtype;
                option.textContent = subtypeLabels[subtype] || subtype;
                if (subtype === currentSubtype) {
                    option.selected = true;
                }
                subtypeSelect.appendChild(option);
            });
        }

        primarySelect.addEventListener('change', function() {
            populateSubtypeSelectors();
        });
    }

    // ============================================================
    // CALCULATE TOTAL PAY
    // ============================================================

    function calculateTotalPay() {
        var basePay = document.getElementById('mission-base-pay').value.trim();
        var surcharge = document.getElementById('mission-surcharge-pay').value.trim();
        var totalInput = document.getElementById('mission-total-pay');

        var baseNum = parseFloat(basePay.replace(/[^0-9.]/g, ''));
        var surchargeNum = parseFloat(surcharge.replace(/[^0-9.]/g, ''));

        if (!isNaN(baseNum) && !isNaN(surchargeNum)) {
            var total = baseNum + surchargeNum;
            totalInput.value = total.toFixed(2) + ' credits';
        } else if (!isNaN(baseNum)) {
            totalInput.value = baseNum.toFixed(2) + ' credits';
        } else if (!isNaN(surchargeNum)) {
            totalInput.value = surchargeNum.toFixed(2) + ' credits';
        } else {
            totalInput.value = '';
        }
    }

    // ============================================================
    // RENDER MISSIONS
    // ============================================================

    function renderMissions() {
        var container = document.getElementById('missions-list');
        if (!container) return;

        var filter = document.getElementById('mission-filter') ? document.getElementById('mission-filter').value : 'all';
        var missions = getMissions(filter);
        var count = document.getElementById('mission-count');
        if (count) count.textContent = missions.length;

        if (missions.length === 0) {
            var filterLabels = {
                'all': 'missions',
                'active': 'active missions',
                'completed': 'completed missions',
                'cancelled': 'cancelled missions'
            };
            container.innerHTML = '<p class="empty-state">No ' + (filterLabels[filter] || 'missions') + ' found.</p>';
            return;
        }

        var html = '';
        missions.forEach(function(mission) {
            var priorityInfo = getPriorityInfo(mission.priority);
            var statusInfo = getStatusInfo(mission.status);
            var teamName = getTeamName(mission.assignedTeamId);
            var teamType = getTeamTypeLabel(mission.assignedTeamId);
            var teamDisplay = teamName + (teamType ? ' (' + teamType + ')' : '');
            var progressBar = mission.progress || 0;
            var difficultyLabel = getDifficultyLabel(mission.difficulty);
            var supportCount = mission.supportPersonnel ? mission.supportPersonnel.length : 0;

            var primaryType = mission.primaryType ? MISSION_TYPES[mission.primaryType] : null;
            var secondaryType = mission.secondaryType ? MISSION_TYPES[mission.secondaryType] : null;
            var subtypeLabel = getSubtypeLabel(mission.subtype);

            var typeDisplay = '';
            if (primaryType) {
                typeDisplay = primaryType.icon + ' ' + primaryType.label;
                if (subtypeLabel) {
                    typeDisplay += ' | ' + subtypeLabel;
                }
                if (secondaryType) {
                    typeDisplay += ' | ' + secondaryType.icon + ' ' + secondaryType.label;
                }
            } else {
                typeDisplay = 'Unclassified';
            }

            var escalationLabel = getEscalationLabel(mission.escalation);
            var billingLabel = getBillingLabel(mission.billing);

            // Date display
            var dateDisplay = '';
            if (mission.year && mission.month && mission.day) {
                var monthName = MONTH_NAMES[mission.month - 1] || '';
                dateDisplay = monthName + ' ' + mission.day + ', ' + mission.year;
            } else if (mission.year) {
                dateDisplay = String(mission.year);
            }

            // Payment display
            var payDisplay = '';
            if (mission.basePay) {
                payDisplay = mission.basePay;
                if (mission.surchargePay) {
                    payDisplay += ' (+' + mission.surchargePay + ')';
                }
            } else if (mission.pay) {
                // Legacy support
                payDisplay = mission.pay;
            } else {
                payDisplay = '—';
            }

            html += '<div class="list-item" style="grid-template-columns:0.8fr 0.8fr 1fr 0.5fr 0.5fr 0.5fr 0.5fr 0.5fr 0.6fr 0.5fr;cursor:pointer;" data-id="' + mission.id + '">';
            html += '<span style="font-size:0.7rem;color:var(--text-dim);font-family:monospace;">' + (mission.missionId || '—') + '</span>';
            html += '<span style="font-size:0.65rem;color:var(--text-dim);">' + dateDisplay + '</span>';
            html += '<span><strong>' + mission.title + '</strong>';
            if (mission.status === 'completed') {
                html += ' <span style="color:var(--info);font-size:0.6rem;">✓</span>';
            }
            if (supportCount > 0) {
                html += ' <span style="color:var(--accent);font-size:0.6rem;">+' + supportCount + ' support</span>';
            }
            html += '</span>';
            html += '<span style="font-size:0.7rem;color:var(--text-dim);">' + typeDisplay + '</span>';
            html += '<span style="font-size:0.65rem;color:var(--text-dim);">' + escalationLabel + '</span>';
            html += '<span style="color:' + priorityInfo.color + ';font-size:0.75rem;">' + priorityInfo.label + '</span>';
            html += '<span style="font-size:0.75rem;">' + difficultyLabel + '</span>';
            html += '<span style="color:' + statusInfo.color + ';font-size:0.75rem;">' + statusInfo.label + '</span>';
            html += '<span style="font-size:0.75rem;">' + teamDisplay + '</span>';
            html += '<span style="display:flex;align-items:center;gap:8px;">';
            html += '<div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden;">';
            html += '<div style="height:100%;width:' + progressBar + '%;background:var(--accent);border-radius:3px;"></div>';
            html += '</div>';
            html += '<span style="font-size:0.7rem;color:var(--text-dim);min-width:35px;">' + progressBar + '%</span>';
            html += '</span>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                showMissionDetail(id);
            });
        });
    }

    // ============================================================
    // MISSION QUERIES
    // ============================================================

    function getMissions(filter) {
        var data = window.data || {};
        if (!data.missions) {
            data.missions = [];
            return [];
        }

        var missions = data.missions.slice();

        if (filter === 'active') {
            missions = missions.filter(function(m) { return m.status === 'active'; });
        } else if (filter === 'completed') {
            missions = missions.filter(function(m) { return m.status === 'completed'; });
        } else if (filter === 'cancelled') {
            missions = missions.filter(function(m) { return m.status === 'cancelled'; });
        }

        var priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
        missions.sort(function(a, b) {
            var pa = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 2;
            var pb = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 2;
            if (pa !== pb) return pa - pb;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        return missions;
    }

    function getMission(id) {
        var data = window.data || {};
        if (!data.missions) return null;
        return data.missions.find(function(m) { return String(m.id) === String(id); });
    }

    function getMissionsByType(typeId) {
        var missions = getMissions('all');
        return missions.filter(function(m) {
            return m.primaryType === typeId || m.secondaryType === typeId;
        });
    }

    function getMissionTypeCounts() {
        var missions = getMissions('all');
        var counts = {};
        Object.keys(MISSION_TYPES).forEach(function(key) {
            counts[key] = 0;
        });
        missions.forEach(function(m) {
            if (m.primaryType && counts[m.primaryType] !== undefined) {
                counts[m.primaryType]++;
            }
        });
        return counts;
    }

    function getMissionTypeLabel(typeId) {
        var type = MISSION_TYPES[typeId];
        return type ? type.label : typeId || 'Unclassified';
    }

    function getMissionTypeIcon(typeId) {
        var type = MISSION_TYPES[typeId];
        return type ? type.icon : '◈';
    }

    function getMissionTypeColor(typeId) {
        var type = MISSION_TYPES[typeId];
        return type ? type.color : 'var(--text-dim)';
    }

    function getSubtypeLabel(subtypeId) {
        var labels = {
            'elimination': 'Elimination',
            'defence': 'Defence',
            'protection': 'Protection',
            'retrieval': 'Retrieval',
            'rescue': 'Rescue',
            'material_recovery': 'Material Recovery',
            'artifact_recovery': 'Artifact Recovery',
            'investigation': 'Investigation',
            'reconnaissance': 'Reconnaissance',
            'surveillance': 'Surveillance',
            'exploration': 'Exploration',
            'survey': 'Survey',
            'expedition': 'Expedition',
            'stealth_entry': 'Stealth Entry',
            'social_infiltration': 'Social Infiltration',
            'theft_recovery': 'Theft / Recovery',
            'espionage': 'Espionage',
            'capture': 'Capture',
            'magical_containment': 'Magical Containment',
            'quarantine': 'Quarantine',
            'ingredients': 'Ingredients',
            'resources': 'Resources',
            'specimens': 'Specimens',
            'observation': 'Observation',
            'field_research': 'Field Research',
            'field_testing': 'Field Testing',
            'negotiation': 'Negotiation',
            'mediation': 'Mediation',
            'representation': 'Representation',
            'targeted_elimination': 'Targeted Elimination'
        };
        return labels[subtypeId] || subtypeId || '';
    }

    function getEscalationLabel(escalation) {
        var labels = {
            'tier_i': 'Tier I - Routine',
            'tier_ii': 'Tier II - Complicated',
            'tier_iii': 'Tier III - Dangerous',
            'tier_iv': 'Tier IV - Critical',
            'tier_v': 'Tier V - Catastrophic'
        };
        return labels[escalation] || escalation || 'Tier II - Complicated';
    }

    function getBillingLabel(billing) {
        var labels = {
            'original': 'Original Contract',
            'escalated': 'Escalated / Surcharge',
            'emergency': 'Emergency Intervention',
            'internal': 'Internal / Research'
        };
        return labels[billing] || billing || 'Original Contract';
    }

    // ============================================================
    // MISSION CRUD
    // ============================================================

    function createMission(missionData) {
        var data = window.data || {};
        if (!data.missions) data.missions = [];

        var year = missionData.year || new Date().getFullYear();
        var month = missionData.month || new Date().getMonth() + 1;
        var day = missionData.day || new Date().getDate();

        // Auto-generate mission ID
        var missionId = generateMissionId(
            missionData.assignedTeamId,
            year,
            missionData.difficulty || 'medium'
        );

        // Calculate total pay
        var totalPay = '';
        if (missionData.basePay && missionData.surchargePay) {
            var baseNum = parseFloat(missionData.basePay.replace(/[^0-9.]/g, ''));
            var surchargeNum = parseFloat(missionData.surchargePay.replace(/[^0-9.]/g, ''));
            if (!isNaN(baseNum) && !isNaN(surchargeNum)) {
                totalPay = (baseNum + surchargeNum).toFixed(2) + ' credits';
            } else if (!isNaN(baseNum)) {
                totalPay = baseNum.toFixed(2) + ' credits';
            }
        } else if (missionData.basePay) {
            totalPay = missionData.basePay;
        } else if (missionData.surchargePay) {
            totalPay = missionData.surchargePay;
        } else if (missionData.pay) {
            // Legacy support
            totalPay = missionData.pay;
        }

        var mission = {
            id: window.generateId('miss'),
            missionId: missionId,
            title: missionData.title || 'Untitled Mission',
            description: missionData.description || '',
            year: year,
            month: month,
            day: day,
            primaryType: missionData.primaryType || '',
            subtype: missionData.subtype || '',
            secondaryType: missionData.secondaryType || '',
            escalation: missionData.escalation || 'tier_ii',
            threatType: missionData.threatType || '',
            environment: missionData.environment || '',
            location: missionData.location || '',
            duration: missionData.duration || '',
            difficulty: missionData.difficulty || 'medium',
            priority: missionData.priority || 'medium',
            basePay: missionData.basePay || '',
            surchargePay: missionData.surchargePay || '',
            pay: totalPay, // Legacy support
            billing: missionData.billing || 'original',
            assignedTeamId: missionData.assignedTeamId || null,
            supportPersonnel: missionData.supportPersonnel || [],
            status: missionData.status || 'active',
            objectives: missionData.objectives || [],
            progress: 0,
            notes: missionData.notes || '',
            tags: missionData.tags || [],
            createdAt: new Date().toISOString(),
            completedAt: null,
            log: []
        };

        data.missions.push(mission);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Created mission: ' + mission.title + ' (' + mission.missionId + ')');
        }
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function updateMission(id, updates) {
        var mission = getMission(id);
        if (!mission) return null;

        var changes = [];
        for (var key in updates) {
            if (updates[key] !== undefined && updates[key] !== null && String(mission[key]) !== String(updates[key])) {
                changes.push(key);
                mission[key] = updates[key];
            }
        }

        // Re-generate mission ID if team or difficulty changed
        if (updates.assignedTeamId || updates.difficulty) {
            var newId = generateMissionId(
                mission.assignedTeamId || updates.assignedTeamId,
                mission.year || new Date().getFullYear(),
                mission.difficulty || updates.difficulty || 'medium'
            );
            if (newId !== mission.missionId) {
                mission.missionId = newId;
                changes.push('missionId');
            }
        }

        // Recalculate total pay
        if (updates.basePay !== undefined || updates.surchargePay !== undefined) {
            var baseNum = parseFloat((mission.basePay || '').replace(/[^0-9.]/g, ''));
            var surchargeNum = parseFloat((mission.surchargePay || '').replace(/[^0-9.]/g, ''));
            if (!isNaN(baseNum) && !isNaN(surchargeNum)) {
                mission.pay = (baseNum + surchargeNum).toFixed(2) + ' credits';
            } else if (!isNaN(baseNum)) {
                mission.pay = baseNum.toFixed(2) + ' credits';
            } else if (!isNaN(surchargeNum)) {
                mission.pay = surchargeNum.toFixed(2) + ' credits';
            }
            changes.push('pay');
        }

        if (updates.status === 'completed' && mission.status === 'completed') {
            mission.completedAt = new Date().toISOString();
        }

        if (updates.objectives) {
            var total = mission.objectives.length;
            var completed = mission.objectives.filter(function(o) { return o.done; }).length;
            mission.progress = total > 0 ? Math.round((completed / total) * 100) : 0;
        }

        if (changes.length > 0 && typeof window.logActivity === 'function') {
            window.logActivity('Updated mission: ' + mission.title + ' (' + changes.join(', ') + ')');
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function deleteMission(id) {
        var data = window.data || {};
        var mission = getMission(id);
        if (!mission) return false;

        data.missions = data.missions.filter(function(m) { return String(m.id) !== String(id); });
        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted mission: ' + mission.title);
        }
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return true;
    }

    function toggleObjective(missionId, objectiveIndex) {
        var mission = getMission(missionId);
        if (!mission || !mission.objectives || !mission.objectives[objectiveIndex]) return null;

        mission.objectives[objectiveIndex].done = !mission.objectives[objectiveIndex].done;

        var total = mission.objectives.length;
        var completed = mission.objectives.filter(function(o) { return o.done; }).length;
        mission.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

        if (mission.progress === 100 && mission.status === 'active') {
            mission.status = 'completed';
            mission.completedAt = new Date().toISOString();
            if (typeof window.logActivity === 'function') {
                window.logActivity('Mission completed: ' + mission.title);
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function addObjective(missionId, text) {
        var mission = getMission(missionId);
        if (!mission) return null;

        if (!mission.objectives) mission.objectives = [];
        mission.objectives.push({
            text: text,
            done: false
        });

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function addMissionLog(missionId, message) {
        var mission = getMission(missionId);
        if (!mission) return null;

        if (!mission.log) mission.log = [];
        mission.log.push({
            timestamp: new Date().toISOString(),
            message: message
        });

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    // ============================================================
    // SUPPORT PERSONNEL HELPERS
    // ============================================================

    function addSupportPersonnel(missionId, characterId) {
        var mission = getMission(missionId);
        if (!mission) return null;

        if (!mission.supportPersonnel) mission.supportPersonnel = [];

        // Check if already added
        var exists = mission.supportPersonnel.some(function(id) {
            return String(id) === String(characterId);
        });

        if (exists) {
            return mission;
        }

        mission.supportPersonnel.push(characterId);

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function removeSupportPersonnel(missionId, characterId) {
        var mission = getMission(missionId);
        if (!mission) return null;

        if (!mission.supportPersonnel) return mission;

        mission.supportPersonnel = mission.supportPersonnel.filter(function(id) {
            return String(id) !== String(characterId);
        });

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function getSupportPersonnel(mission) {
        if (!mission || !mission.supportPersonnel) return [];
        var characters = [];
        mission.supportPersonnel.forEach(function(id) {
            var char = window.getCharacterById ? window.getCharacterById(id) : null;
            if (char) {
                characters.push(char);
            }
        });
        return characters;
    }

    // ============================================================
    // TEAM SELECTORS
    // ============================================================

    function populateTeamSelectors() {
        var select = document.getElementById('mission-team');
        if (!select) return;

        var data = window.data || {};
        var allTeams = data.teams ? data.teams.filter(function(t) {
            return t.status !== 'deleted' && t.status !== 'inactive';
        }) : [];

        var academicTeams = allTeams.filter(function(t) { return t.type === 'academic'; });
        var professionalTeams = allTeams.filter(function(t) { return t.type === 'professional'; });
        var temporaryTeams = allTeams.filter(function(t) { return t.type === 'temporary' || t.type === 'internship'; });

        academicTeams.sort(function(a, b) { return a.name.localeCompare(b.name); });
        professionalTeams.sort(function(a, b) { return a.name.localeCompare(b.name); });
        temporaryTeams.sort(function(a, b) { return a.name.localeCompare(b.name); });

        select.innerHTML = '<option value="">Unassigned</option>';

        if (professionalTeams.length > 0) {
            var optGroup = document.createElement('optgroup');
            optGroup.label = 'Professional Teams';
            professionalTeams.forEach(function(team) {
                var option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name;
                optGroup.appendChild(option);
            });
            select.appendChild(optGroup);
        }

        if (temporaryTeams.length > 0) {
            var optGroup = document.createElement('optgroup');
            optGroup.label = 'Temporary Teams';
            temporaryTeams.forEach(function(team) {
                var option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name;
                optGroup.appendChild(option);
            });
            select.appendChild(optGroup);
        }

        if (academicTeams.length > 0) {
            var optGroup = document.createElement('optgroup');
            optGroup.label = 'Academic Teams';
            academicTeams.forEach(function(team) {
                var option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name + ' (Academic)';
                optGroup.appendChild(option);
            });
            select.appendChild(optGroup);
        }
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getTeamName(teamId) {
        if (!teamId) return 'Unassigned';
        var team = window.getTeamById(teamId);
        return team ? team.name : 'Unknown Team';
    }

    function getTeamTypeLabel(teamId) {
        if (!teamId) return '';
        var team = window.getTeamById(teamId);
        if (!team) return '';
        var typeMap = {
            'academic': 'Academic',
            'professional': 'Professional',
            'temporary': 'Temporary',
            'internship': 'Temporary'
        };
        return typeMap[team.type] || '';
    }

    function getPriorityInfo(priority) {
        var map = {
            'critical': { label: 'Critical', color: 'var(--danger)' },
            'high': { label: 'High', color: 'var(--warning)' },
            'medium': { label: 'Medium', color: 'var(--warning)' },
            'low': { label: 'Low', color: 'var(--accent)' }
        };
        return map[priority] || { label: 'Medium', color: 'var(--text-dim)' };
    }

    function getStatusInfo(status) {
        var map = {
            'active': { label: 'Active', color: 'var(--accent)' },
            'completed': { label: 'Completed', color: 'var(--info)' },
            'cancelled': { label: 'Cancelled', color: 'var(--danger)' }
        };
        return map[status] || { label: 'Active', color: 'var(--text-dim)' };
    }

    function getDifficultyLabel(difficulty) {
        var map = {
            'easy': 'Easy',
            'medium': 'Medium',
            'hard': 'Hard',
            'expert': 'Expert'
        };
        return map[difficulty] || difficulty || 'Medium';
    }

    // ============================================================
    // SHOW MISSION DETAIL
    // ============================================================

    function showMissionDetail(id) {
        var mission = getMission(id);
        if (!mission) return;

        var modal = document.getElementById('mission-detail-modal');
        var content = document.getElementById('mission-detail-content');
        var title = document.getElementById('detail-mission-title');
        title.textContent = mission.title;

        var priorityInfo = getPriorityInfo(mission.priority);
        var statusInfo = getStatusInfo(mission.status);
        var teamName = getTeamName(mission.assignedTeamId);
        var teamType = getTeamTypeLabel(mission.assignedTeamId);
        var teamDisplay = teamName + (teamType ? ' (' + teamType + ')' : '');
        var difficultyLabel = getDifficultyLabel(mission.difficulty);
        var supportPersonnel = getSupportPersonnel(mission);

        var primaryType = mission.primaryType ? MISSION_TYPES[mission.primaryType] : null;
        var secondaryType = mission.secondaryType ? MISSION_TYPES[mission.secondaryType] : null;
        var subtypeLabel = getSubtypeLabel(mission.subtype);
        var primaryDisplay = primaryType ? primaryType.icon + ' ' + primaryType.label : 'Unclassified';
        var secondaryDisplay = secondaryType ? secondaryType.icon + ' ' + secondaryType.label : 'None';
        var subtypeDisplay = subtypeLabel || 'None';

        var escalationLabel = getEscalationLabel(mission.escalation);
        var billingLabel = getBillingLabel(mission.billing);

        var progressBar = mission.progress || 0;
        var createdAt = new Date(mission.createdAt).toLocaleDateString();
        var completedAt = mission.completedAt ? new Date(mission.completedAt).toLocaleDateString() : 'Not completed';

        // Date display
        var dateDisplay = '';
        if (mission.year && mission.month && mission.day) {
            var monthName = MONTH_NAMES[mission.month - 1] || '';
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
            payDisplay = 'Base: ' + mission.basePay + (mission.surchargePay ? ' | Surcharge: ' + mission.surchargePay : '');
        } else if (mission.pay) {
            payDisplay = mission.pay;
        } else {
            payDisplay = 'Not specified';
        }

        // Support personnel HTML
        var supportHtml = '';
        if (supportPersonnel.length > 0) {
            supportHtml = '<div style="margin-top:8px;"><strong>Support Personnel:</strong><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">';
            supportPersonnel.forEach(function(char) {
                var name = window.getDisplayName ? window.getDisplayName(char) : (char.name || char.firstName || 'Unknown');
                supportHtml += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);">' + name + '</span>';
            });
            supportHtml += '</div></div>';
        }

        var objectivesHtml = '';
        if (mission.objectives && mission.objectives.length > 0) {
            objectivesHtml = '<div style="margin-top:8px;"><strong>Objectives:</strong><ul style="list-style:none;padding:0;margin:4px 0;">';
            mission.objectives.forEach(function(obj, index) {
                var doneClass = obj.done ? 'style="text-decoration:line-through;color:var(--text-dim);"' : '';
                objectivesHtml += '<li style="padding:4px 8px;border-bottom:1px solid var(--border-soft);display:flex;align-items:center;gap:8px;" ' + doneClass + '>';
                objectivesHtml += '<input type="checkbox" ' + (obj.done ? 'checked' : '') + ' data-mission="' + mission.id + '" data-index="' + index + '" class="objective-check">';
                objectivesHtml += '<span>' + obj.text + '</span>';
                objectivesHtml += '</li>';
            });
            objectivesHtml += '</ul></div>';
        }

        var logHtml = '';
        if (mission.log && mission.log.length > 0) {
            logHtml = '<div style="margin-top:12px;max-height:150px;overflow-y:auto;font-size:0.75rem;background:var(--bg);border-radius:6px;padding:8px;">';
            logHtml += '<strong>Activity Log:</strong>';
            mission.log.slice().reverse().forEach(function(entry) {
                var date = new Date(entry.timestamp).toLocaleString();
                logHtml += '<div style="padding:2px 0;border-bottom:1px solid var(--border-soft);color:var(--text-dim);">' + date + ' - ' + entry.message + '</div>';
            });
            logHtml += '</div>';
        }

        var tagsHtml = '';
        if (mission.tags && mission.tags.length > 0) {
            tagsHtml = '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">';
            mission.tags.forEach(function(tag) {
                tagsHtml += '<span style="background:var(--panel-alt);padding:2px 8px;border-radius:10px;font-size:0.65rem;color:var(--text-dim);">#' + tag + '</span>';
            });
            tagsHtml += '</div>';
        }

        content.innerHTML = `
            <div class="detail-row"><span class="label">Mission ID:</span> <span style="font-family:monospace;font-weight:bold;color:var(--accent);">${mission.missionId || 'N/A'}</span></div>
            <div class="detail-row"><span class="label">Date:</span> <span>${dateDisplay}</span></div>
            <div class="detail-row"><span class="label">Status:</span> <span style="color:${statusInfo.color};font-weight:600;">${statusInfo.label}</span></div>
            <div class="detail-row"><span class="label">Priority:</span> <span style="color:${priorityInfo.color};font-weight:600;">${priorityInfo.label}</span></div>
            <div class="detail-row"><span class="label">Difficulty:</span> <span>${difficultyLabel}</span></div>
            <div class="detail-row"><span class="label">Primary Category:</span> <span>${primaryDisplay}</span></div>
            ${mission.subtype ? '<div class="detail-row"><span class="label">Subtype:</span> <span>' + subtypeDisplay + '</span></div>' : ''}
            ${mission.secondaryType ? '<div class="detail-row"><span class="label">Secondary Category:</span> <span>' + secondaryDisplay + '</span></div>' : ''}
            <div class="detail-row"><span class="label">Escalation Level:</span> <span>${escalationLabel}</span></div>
            ${mission.threatType ? '<div class="detail-row"><span class="label">Threat Type:</span> <span>' + mission.threatType + '</span></div>' : ''}
            ${mission.environment ? '<div class="detail-row"><span class="label">Environment:</span> <span>' + mission.environment + '</span></div>' : ''}
            <div class="detail-row"><span class="label">Team:</span> <span>${teamDisplay}</span></div>
            ${supportHtml}
            <div class="detail-row"><span class="label">Location:</span> <span>${mission.location || 'Not specified'}</span></div>
            <div class="detail-row"><span class="label">Duration:</span> <span>${mission.duration || 'Not specified'}</span></div>
            <div class="detail-row"><span class="label">Payment:</span> <span>${payDisplay}</span></div>
            <div class="detail-row"><span class="label">Billing:</span> <span>${billingLabel}</span></div>
            <div class="detail-row"><span class="label">Created:</span> <span>${createdAt}</span></div>
            <div class="detail-row"><span class="label">Completed:</span> <span>${completedAt}</span></div>
            ${mission.description ? '<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="label">Description:</span><span style="padding:4px 0;">' + mission.description + '</span></div>' : ''}
            ${mission.notes ? '<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="label">Notes:</span><span style="padding:4px 0;">' + mission.notes + '</span></div>' : ''}
            ${tagsHtml}
            <div style="margin-top:8px;">
                <strong>Progress:</strong>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                    <div style="flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden;">
                        <div style="height:100%;width:${progressBar}%;background:var(--accent);border-radius:4px;"></div>
                    </div>
                    <span style="font-size:0.8rem;color:var(--text-dim);min-width:40px;">${progressBar}%</span>
                </div>
            </div>
            ${objectivesHtml}
            ${logHtml}
        `;

        content.querySelectorAll('.objective-check').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var missionId = this.dataset.mission;
                var index = parseInt(this.dataset.index);
                toggleObjective(missionId, index);
                showMissionDetail(missionId);
                renderMissions();
            });
        });

        modal.dataset.missionId = id;
        modal.classList.remove('hidden');
    }

    // ============================================================
    // SHOW MISSION FORM
    // ============================================================

    function showMissionForm(editId) {
        var modal = document.getElementById('mission-form-modal');
        var title = document.getElementById('mission-form-title');
        var form = document.getElementById('mission-form-inner');

        modal.classList.remove('hidden');
        populateTeamSelectors();
        populateCharacterSelectors();

        document.getElementById('mission-objectives-list').innerHTML = '';
        document.getElementById('mission-support-list').innerHTML = '';

        // Set up pay calculation
        var basePayInput = document.getElementById('mission-base-pay');
        var surchargeInput = document.getElementById('mission-surcharge-pay');
        if (basePayInput && surchargeInput) {
            basePayInput.addEventListener('input', calculateTotalPay);
            surchargeInput.addEventListener('input', calculateTotalPay);
        }

        // Update mission ID preview when team or difficulty changes
        var teamSelect = document.getElementById('mission-team');
        var yearInput = document.getElementById('mission-year');
        var difficultySelect = document.getElementById('mission-difficulty');
        var idInput = document.getElementById('mission-id');

        function updateMissionIdPreview() {
            var teamId = teamSelect ? teamSelect.value : null;
            var year = parseInt(yearInput ? yearInput.value : new Date().getFullYear());
            var difficulty = difficultySelect ? difficultySelect.value : 'medium';
            if (year && !isNaN(year)) {
                idInput.value = generateMissionId(teamId, year, difficulty);
            }
        }

        if (teamSelect) teamSelect.addEventListener('change', updateMissionIdPreview);
        if (yearInput) yearInput.addEventListener('change', updateMissionIdPreview);
        if (difficultySelect) difficultySelect.addEventListener('change', updateMissionIdPreview);

        if (editId) {
            title.textContent = 'Edit Mission';
            var mission = getMission(editId);
            if (mission) {
                document.getElementById('mission-title').value = mission.title || '';
                document.getElementById('mission-id').value = mission.missionId || '';
                document.getElementById('mission-year').value = mission.year || new Date().getFullYear();
                document.getElementById('mission-month').value = mission.month || new Date().getMonth() + 1;
                document.getElementById('mission-day').value = mission.day || new Date().getDate();
                document.getElementById('mission-description').value = mission.description || '';
                document.getElementById('mission-primary-type').value = mission.primaryType || '';
                document.getElementById('mission-subtype').value = mission.subtype || '';
                document.getElementById('mission-secondary-type').value = mission.secondaryType || '';
                document.getElementById('mission-escalation').value = mission.escalation || 'tier_ii';
                document.getElementById('mission-threat-type').value = mission.threatType || '';
                document.getElementById('mission-environment').value = mission.environment || '';
                document.getElementById('mission-location').value = mission.location || '';
                document.getElementById('mission-duration').value = mission.duration || '';
                document.getElementById('mission-difficulty').value = mission.difficulty || 'medium';
                document.getElementById('mission-priority').value = mission.priority || 'medium';
                document.getElementById('mission-base-pay').value = mission.basePay || '';
                document.getElementById('mission-surcharge-pay').value = mission.surchargePay || '';
                document.getElementById('mission-total-pay').value = mission.pay || '';
                document.getElementById('mission-billing').value = mission.billing || 'original';
                document.getElementById('mission-status').value = mission.status || 'active';
                document.getElementById('mission-team').value = mission.assignedTeamId || '';
                document.getElementById('mission-objective').value = '';
                document.getElementById('mission-notes').value = mission.notes || '';
                document.getElementById('mission-tags').value = (mission.tags || []).join(', ');

                // Populate support personnel
                if (mission.supportPersonnel) {
                    mission.supportPersonnel.forEach(function(charId) {
                        var char = window.getCharacterById ? window.getCharacterById(charId) : null;
                        if (char) {
                            addSupportTag(charId, window.getDisplayName ? window.getDisplayName(char) : (char.name || char.firstName || 'Unknown'));
                        }
                    });
                }

                if (mission.objectives) {
                    mission.objectives.forEach(function(obj) {
                        addObjectiveToList(obj.text);
                    });
                }
                form.dataset.editId = editId;
                updateMissionIdPreview();
            }
        } else {
            title.textContent = 'Create Mission';
            form.reset();
            var now = new Date();
            document.getElementById('mission-year').value = now.getFullYear();
            document.getElementById('mission-month').value = now.getMonth() + 1;
            document.getElementById('mission-day').value = now.getDate();
            document.getElementById('mission-primary-type').value = '';
            document.getElementById('mission-subtype').value = '';
            document.getElementById('mission-secondary-type').value = '';
            document.getElementById('mission-escalation').value = 'tier_ii';
            document.getElementById('mission-difficulty').value = 'medium';
            document.getElementById('mission-priority').value = 'medium';
            document.getElementById('mission-team').value = '';
            document.getElementById('mission-total-pay').value = '';
            delete form.dataset.editId;
            updateMissionIdPreview();
        }
        populateSubtypeSelectors();
    }

    // ============================================================
    // SUPPORT TAG HELPERS
    // ============================================================

    function addSupportTag(characterId, characterName) {
        var container = document.getElementById('mission-support-list');
        if (!container) return;

        // Check if already added
        var existing = container.querySelector('[data-id="' + characterId + '"]');
        if (existing) return;

        var div = document.createElement('div');
        div.dataset.id = characterId;
        div.style.cssText = 'display:flex;align-items:center;gap:4px;background:var(--panel-alt);padding:2px 8px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);';
        div.innerHTML = `
            <span>${characterName}</span>
            <button type="button" class="remove-support-btn" data-id="${characterId}" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button>
            <input type="hidden" value="${characterId}">
        `;
        container.appendChild(div);

        div.querySelector('.remove-support-btn').onclick = function() {
            div.remove();
        };
    }

    function collectSupportPersonnel() {
        var container = document.getElementById('mission-support-list');
        if (!container) return [];

        var ids = [];
        container.querySelectorAll('input[type="hidden"]').forEach(function(input) {
            ids.push(input.value);
        });
        return ids;
    }

    // ============================================================
    // OBJECTIVE HELPERS
    // ============================================================

    function addObjectiveToList(text) {
        var container = document.getElementById('mission-objectives-list');
        if (!container) return;

        var div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center;';
        div.innerHTML = `
            <span style="flex:1;font-size:0.8rem;padding:4px 8px;background:var(--bg);border-radius:4px;">${text}</span>
            <button type="button" class="small danger remove-objective-btn">✕</button>
            <input type="hidden" value="${text}">
        `;
        container.appendChild(div);

        div.querySelector('.remove-objective-btn').onclick = function() {
            div.remove();
        };
    }

    // ============================================================
    // SAVE MISSION
    // ============================================================

    function saveMission(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var objectives = [];
        document.querySelectorAll('#mission-objectives-list .remove-objective-btn').forEach(function(btn) {
            var parent = btn.parentElement;
            var text = parent.querySelector('input[type="hidden"]') ? parent.querySelector('input[type="hidden"]').value : parent.querySelector('span').textContent || '';
            if (text.trim()) {
                objectives.push({ text: text.trim(), done: false });
            }
        });

        var objectiveInput = document.getElementById('mission-objective');
        if (objectiveInput.value.trim()) {
            objectives.push({ text: objectiveInput.value.trim(), done: false });
        }

        var supportPersonnel = collectSupportPersonnel();

        var tags = document.getElementById('mission-tags').value.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; });

        var year = parseInt(document.getElementById('mission-year').value);
        if (!year || isNaN(year) || year < 1000 || year > 9999) {
            year = new Date().getFullYear();
        }

        var missionData = {
            title: document.getElementById('mission-title').value.trim(),
            year: year,
            month: parseInt(document.getElementById('mission-month').value) || new Date().getMonth() + 1,
            day: parseInt(document.getElementById('mission-day').value) || new Date().getDate(),
            description: document.getElementById('mission-description').value.trim(),
            primaryType: document.getElementById('mission-primary-type').value || '',
            subtype: document.getElementById('mission-subtype').value || '',
            secondaryType: document.getElementById('mission-secondary-type').value || '',
            escalation: document.getElementById('mission-escalation').value || 'tier_ii',
            threatType: document.getElementById('mission-threat-type').value.trim(),
            environment: document.getElementById('mission-environment').value.trim(),
            location: document.getElementById('mission-location').value.trim(),
            duration: document.getElementById('mission-duration').value.trim(),
            difficulty: document.getElementById('mission-difficulty').value,
            priority: document.getElementById('mission-priority').value,
            basePay: document.getElementById('mission-base-pay').value.trim(),
            surchargePay: document.getElementById('mission-surcharge-pay').value.trim(),
            billing: document.getElementById('mission-billing').value || 'original',
            assignedTeamId: document.getElementById('mission-team').value || null,
            supportPersonnel: supportPersonnel,
            status: document.getElementById('mission-status').value || 'active',
            objectives: objectives,
            notes: document.getElementById('mission-notes').value.trim(),
            tags: tags,
            progress: 0
        };

        if (!missionData.title) {
            alert('Mission title is required.');
            return;
        }

        if (editId) {
            var updated = updateMission(editId, missionData);
            if (updated) {
                addMissionLog(editId, 'Mission updated');
            }
        } else {
            var newMission = createMission(missionData);
            if (newMission) {
                addMissionLog(newMission.id, 'Mission created');
            }
        }

        closeMissionForm();
        renderMissions();
    }

    // ============================================================
    // CLOSE FUNCTIONS
    // ============================================================

    function closeMissionForm() {
        document.getElementById('mission-form-modal').classList.add('hidden');
    }

    function closeMissionDetail() {
        document.getElementById('mission-detail-modal').classList.add('hidden');
    }

    // ============================================================
    // CSV EXPORT / IMPORT
    // ============================================================

    function exportMissionsCSV() {
        var missions = getMissions('all');
        if (missions.length === 0) {
            alert('No missions to export.');
            return;
        }

        var lines = [];
        lines.push('MissionID,Title,Year,Month,Day,Status,Priority,Difficulty,PrimaryType,Subtype,SecondaryType,Escalation,ThreatType,Environment,Team,TeamType,Location,Duration,BasePay,SurchargePay,TotalPay,Billing,Progress,SupportPersonnel,Objectives,Notes,Tags,CreatedAt,CompletedAt');

        missions.forEach(function(m) {
            var teamName = getTeamName(m.assignedTeamId);
            var teamType = getTeamTypeLabel(m.assignedTeamId);
            var primaryType = getMissionTypeLabel(m.primaryType);
            var secondaryType = m.secondaryType ? getMissionTypeLabel(m.secondaryType) : '';
            var subtypeLabel = getSubtypeLabel(m.subtype);
            var escalationLabel = getEscalationLabel(m.escalation);
            var billingLabel = getBillingLabel(m.billing);
            
            // Support personnel names
            var supportNames = '';
            if (m.supportPersonnel && m.supportPersonnel.length > 0) {
                var names = [];
                m.supportPersonnel.forEach(function(id) {
                    var char = window.getCharacterById ? window.getCharacterById(id) : null;
                    if (char) {
                        names.push(window.getDisplayName ? window.getDisplayName(char) : (char.name || char.firstName || 'Unknown'));
                    }
                });
                supportNames = names.join('; ');
            }
            
            var objectivesStr = '';
            if (m.objectives) {
                objectivesStr = m.objectives.map(function(o) {
                    return o.text + (o.done ? ' ✓' : '');
                }).join('; ');
            }
            var tagsStr = (m.tags || []).join('; ');
            var createdAt = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '';
            var completedAt = m.completedAt ? new Date(m.completedAt).toLocaleDateString() : '';

            var row = [
                csvField(m.missionId || ''),
                csvField(m.title || ''),
                m.year || '',
                m.month || '',
                m.day || '',
                m.status || 'active',
                m.priority || 'medium',
                m.difficulty || 'medium',
                csvField(primaryType),
                csvField(subtypeLabel),
                csvField(secondaryType),
                csvField(escalationLabel),
                csvField(m.threatType || ''),
                csvField(m.environment || ''),
                csvField(teamName),
                csvField(teamType),
                csvField(m.location || ''),
                csvField(m.duration || ''),
                csvField(m.basePay || ''),
                csvField(m.surchargePay || ''),
                csvField(m.pay || ''),
                csvField(billingLabel),
                m.progress || '0',
                csvField(supportNames),
                csvField(objectivesStr),
                csvField(m.notes || ''),
                csvField(tagsStr),
                createdAt,
                completedAt
            ];
            lines.push(row.join(','));
        });

        var csvContent = lines.join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'missions-export-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported ' + missions.length + ' missions to CSV');
        }
    }

    function exportMissionTemplateCSV() {
        var lines = [
            'MissionID,Title,Year,Month,Day,Status,Priority,Difficulty,PrimaryType,Subtype,SecondaryType,Escalation,ThreatType,Environment,Team,TeamType,Location,Duration,BasePay,SurchargePay,TotalPay,Billing,Progress,SupportPersonnel,Objectives,Notes,Tags,CreatedAt,CompletedAt',
            'RS-2026-H001,Operation Nightfall,2026,6,15,active,high,hard,investigation,reconnaissance,research,Tier IV,Human/Magical,Urban,Raven Squad,Professional,Berlin,2 weeks,5000,2000,7000,Escalated,50,Dr. Sarah Chen;Agent Marcus,Infiltrate base;Retrieve documents ✓;Extract intel,Use stealth approach,covert;rescue,2024-01-15,',
            'AT-2026-M001,Field Testing Alpha,2026,7,20,active,medium,medium,research,field_testing,,Tier II,Magical,Lab,Team Alpha,Academic,London,3 days,2000,,2000,Original,0,,Test new tracking spell;Document results,Proceed with caution,testing;magic,2024-01-20,',
            'LG-2026-E001,Supply Run,2026,8,5,completed,low,easy,acquisition,resources,,Tier I,,Rural,Logistics Team,Temporary,Outpost 7,1 day,500,,500,Original,100,Cpl. Davis,Deliver supplies ✓;Check inventory ✓,All delivered,logistics;supply,2024-01-10,2024-01-11'
        ];

        var csvContent = lines.join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mission-template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported mission template CSV');
        }
    }

    function importMissionsCSV(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                if (!confirm('This will add missions from the CSV file. Existing missions will be preserved. Continue?')) return;

                var lines = e.target.result.split('\n');
                var headers = [];
                var importedCount = 0;
                var errorCount = 0;

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line) continue;

                    var values = parseCSVLine(line);

                    if (i === 0) {
                        var possibleHeaders = ['MissionID', 'Title', 'Year', 'Month', 'Day', 'Status', 'Priority', 'Difficulty', 'PrimaryType', 'Subtype', 'SecondaryType', 'Escalation', 'ThreatType', 'Environment', 'Team', 'TeamType', 'Location', 'Duration', 'BasePay', 'SurchargePay', 'TotalPay', 'Billing', 'Progress', 'SupportPersonnel', 'Objectives', 'Notes', 'Tags', 'CreatedAt', 'CompletedAt'];
                        var headerMatch = 0;
                        values.forEach(function(v) {
                            if (possibleHeaders.indexOf(v.trim()) !== -1) headerMatch++;
                        });
                        if (headerMatch >= 3) {
                            headers = values.map(function(h) { return h.trim(); });
                            continue;
                        }
                    }

                    var missionData = {
                        title: '',
                        year: new Date().getFullYear(),
                        month: new Date().getMonth() + 1,
                        day: new Date().getDate(),
                        status: 'active',
                        priority: 'medium',
                        difficulty: 'medium',
                        primaryType: '',
                        subtype: '',
                        secondaryType: '',
                        escalation: 'tier_ii',
                        threatType: '',
                        environment: '',
                        assignedTeamId: null,
                        supportPersonnel: [],
                        location: '',
                        duration: '',
                        basePay: '',
                        surchargePay: '',
                        billing: 'original',
                        progress: 0,
                        objectives: [],
                        notes: '',
                        tags: []
                    };

                    var headerMap = {
                        'MissionID': 'missionId',
                        'Title': 'title',
                        'Year': 'year',
                        'Month': 'month',
                        'Day': 'day',
                        'Status': 'status',
                        'Priority': 'priority',
                        'Difficulty': 'difficulty',
                        'PrimaryType': 'primaryType',
                        'Subtype': 'subtype',
                        'SecondaryType': 'secondaryType',
                        'Escalation': 'escalation',
                        'ThreatType': 'threatType',
                        'Environment': 'environment',
                        'Team': 'teamName',
                        'Location': 'location',
                        'Duration': 'duration',
                        'BasePay': 'basePay',
                        'SurchargePay': 'surchargePay',
                        'TotalPay': 'pay',
                        'Billing': 'billing',
                        'Progress': 'progress',
                        'SupportPersonnel': 'supportPersonnel',
                        'Objectives': 'objectives',
                        'Notes': 'notes',
                        'Tags': 'tags'
                    };

                    if (headers.length === 0) {
                        headers = ['MissionID', 'Title', 'Year', 'Month', 'Day', 'Status', 'Priority', 'Difficulty', 'PrimaryType', 'Subtype', 'SecondaryType', 'Escalation', 'ThreatType', 'Environment', 'Team', 'TeamType', 'Location', 'Duration', 'BasePay', 'SurchargePay', 'TotalPay', 'Billing', 'Progress', 'SupportPersonnel', 'Objectives', 'Notes', 'Tags', 'CreatedAt', 'CompletedAt'];
                    }

                    headers.forEach(function(header, index) {
                        var value = values[index] ? values[index].trim() : '';
                        var mapped = headerMap[header];

                        if (!mapped) return;

                        if (mapped === 'title') {
                            missionData.title = value;
                        } else if (mapped === 'missionId') {
                            // Don't import missionId, it will be auto-generated
                        } else if (mapped === 'year') {
                            var y = parseInt(value);
                            if (!isNaN(y) && y >= 1000 && y <= 9999) {
                                missionData.year = y;
                            }
                        } else if (mapped === 'month') {
                            var m = parseInt(value);
                            if (!isNaN(m) && m >= 1 && m <= 12) {
                                missionData.month = m;
                            }
                        } else if (mapped === 'day') {
                            var d = parseInt(value);
                            if (!isNaN(d) && d >= 1 && d <= 31) {
                                missionData.day = d;
                            }
                        } else if (mapped === 'status') {
                            if (['active', 'completed', 'cancelled'].indexOf(value) !== -1) {
                                missionData.status = value;
                            }
                        } else if (mapped === 'priority') {
                            if (['low', 'medium', 'high', 'critical'].indexOf(value) !== -1) {
                                missionData.priority = value;
                            }
                        } else if (mapped === 'difficulty') {
                            if (['easy', 'medium', 'hard', 'expert'].indexOf(value) !== -1) {
                                missionData.difficulty = value;
                            }
                        } else if (mapped === 'primaryType') {
                            if (MISSION_TYPES[value]) {
                                missionData.primaryType = value;
                            }
                        } else if (mapped === 'subtype') {
                            missionData.subtype = value;
                        } else if (mapped === 'secondaryType') {
                            if (MISSION_TYPES[value]) {
                                missionData.secondaryType = value;
                            }
                        } else if (mapped === 'escalation') {
                            var escalationValues = ['tier_i', 'tier_ii', 'tier_iii', 'tier_iv', 'tier_v'];
                            if (escalationValues.indexOf(value) !== -1) {
                                missionData.escalation = value;
                            }
                        } else if (mapped === 'threatType') {
                            missionData.threatType = value;
                        } else if (mapped === 'environment') {
                            missionData.environment = value;
                        } else if (mapped === 'teamName') {
                            if (value) {
                                var data = window.data || {};
                                var team = data.teams ? data.teams.find(function(t) {
                                    return t.name.toLowerCase() === value.toLowerCase() && t.status !== 'deleted';
                                }) : null;
                                if (team) {
                                    missionData.assignedTeamId = team.id;
                                }
                            }
                        } else if (mapped === 'location') {
                            missionData.location = value;
                        } else if (mapped === 'duration') {
                            missionData.duration = value;
                        } else if (mapped === 'basePay') {
                            missionData.basePay = value;
                        } else if (mapped === 'surchargePay') {
                            missionData.surchargePay = value;
                        } else if (mapped === 'billing') {
                            var billingValues = ['original', 'escalated', 'emergency', 'internal'];
                            if (billingValues.indexOf(value) !== -1) {
                                missionData.billing = value;
                            }
                        } else if (mapped === 'progress') {
                            var prog = parseInt(value);
                            if (!isNaN(prog)) missionData.progress = prog;
                        } else if (mapped === 'supportPersonnel') {
                            if (value) {
                                var supportNames = value.split(';').map(function(n) { return n.trim(); }).filter(function(n) { return n; });
                                var data = window.data || {};
                                var characters = data.characters || [];
                                supportNames.forEach(function(name) {
                                    var char = characters.find(function(c) {
                                        var charName = window.getDisplayName ? window.getDisplayName(c) : (c.name || c.firstName || '');
                                        return charName.toLowerCase() === name.toLowerCase();
                                    });
                                    if (char) {
                                        missionData.supportPersonnel.push(char.id);
                                    }
                                });
                            }
                        } else if (mapped === 'objectives') {
                            if (value) {
                                var objParts = value.split(';');
                                objParts.forEach(function(part) {
                                    part = part.trim();
                                    if (part) {
                                        var done = part.endsWith('✓') || part.endsWith('✓');
                                        var text = part.replace(/✓$/, '').trim();
                                        if (text) {
                                            missionData.objectives.push({ text: text, done: done });
                                        }
                                    }
                                });
                            }
                        } else if (mapped === 'notes') {
                            missionData.notes = value;
                        } else if (mapped === 'tags') {
                            if (value) {
                                missionData.tags = value.split(';').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
                            }
                        }
                    });

                    if (!missionData.title) {
                        errorCount++;
                        continue;
                    }

                    var newMission = createMission(missionData);
                    if (newMission) {
                        importedCount++;
                        if (missionData.status === 'completed') {
                            newMission.status = 'completed';
                            newMission.completedAt = new Date().toISOString();
                        }
                        if (missionData.progress > 0) {
                            newMission.progress = missionData.progress;
                        }
                        addMissionLog(newMission.id, 'Imported from CSV');
                    }
                }

                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
                        renderMissions();
                        alert('CSV import completed!\n\n' +
                            'Successfully imported: ' + importedCount + ' missions\n' +
                            'Errors: ' + errorCount);
                    }).catch(function(err) {
                        alert('Failed to save missions: ' + err.message);
                    });
                } else {
                    renderMissions();
                    alert('CSV import completed!\n\n' +
                        'Successfully imported: ' + importedCount + ' missions\n' +
                        'Errors: ' + errorCount);
                }

            } catch (err) {
                alert('Failed to import CSV: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function csvField(value) {
        if (value === null || value === undefined) return '';
        var str = String(value);
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function parseCSVLine(line) {
        var values = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    values.push(current.trim());
                    current = '';
                } else if (ch === '\n' || ch === '\r') {
                    // skip
                } else {
                    current += ch;
                }
            }
        }
        values.push(current.trim());
        return values;
    }

    // ============================================================
    // INIT EVENTS
    // ============================================================

    function initMissionEvents() {
        var addBtn = document.getElementById('add-mission-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() { showMissionForm(); });
        }

        var exportBtn = document.getElementById('export-missions-csv-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportMissionsCSV);
        }

        var importBtn = document.getElementById('import-missions-csv-btn');
        if (importBtn) {
            importBtn.addEventListener('click', function() {
                document.getElementById('missions-csv-file-input').click();
            });
        }
        var fileInput = document.getElementById('missions-csv-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', function(e) {
                if (this.files.length > 0) {
                    importMissionsCSV(this.files[0]);
                    this.value = '';
                }
            });
        }

        var templateBtn = document.getElementById('template-missions-csv-btn');
        if (templateBtn) {
            templateBtn.addEventListener('click', exportMissionTemplateCSV);
        }

        var closeFormBtn = document.getElementById('close-mission-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', closeMissionForm);
        }
        var cancelFormBtn = document.getElementById('cancel-mission-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', closeMissionForm);
        }
        var formModal = document.getElementById('mission-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) closeMissionForm();
            });
        }

        var form = document.getElementById('mission-form-inner');
        if (form) {
            form.addEventListener('submit', saveMission);
        }

        var addSupportBtn = document.getElementById('add-support-btn');
        if (addSupportBtn) {
            addSupportBtn.addEventListener('click', function() {
                var select = document.getElementById('mission-support-select');
                if (select && select.value) {
                    var char = window.getCharacterById ? window.getCharacterById(select.value) : null;
                    if (char) {
                        var name = window.getDisplayName ? window.getDisplayName(char) : (char.name || char.firstName || 'Unknown');
                        addSupportTag(select.value, name);
                        select.value = '';
                    }
                }
            });
        }

        var addObjBtn = document.getElementById('add-objective-btn');
        if (addObjBtn) {
            addObjBtn.addEventListener('click', function() {
                var input = document.getElementById('mission-objective');
                if (input.value.trim()) {
                    addObjectiveToList(input.value.trim());
                    input.value = '';
                }
            });
        }
        var objectiveInput = document.getElementById('mission-objective');
        if (objectiveInput) {
            objectiveInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('add-objective-btn').click();
                }
            });
        }

        var closeDetailBtn = document.getElementById('close-mission-detail');
        if (closeDetailBtn) {
            closeDetailBtn.addEventListener('click', closeMissionDetail);
        }
        var detailModal = document.getElementById('mission-detail-modal');
        if (detailModal) {
            detailModal.addEventListener('click', function(e) {
                if (e.target === this) closeMissionDetail();
            });
        }

        var filterSelect = document.getElementById('mission-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', renderMissions);
        }

        var editDetailBtn = document.getElementById('edit-mission-from-detail');
        if (editDetailBtn) {
            editDetailBtn.addEventListener('click', function() {
                var modal = document.getElementById('mission-detail-modal');
                var id = modal.dataset.missionId;
                if (id) {
                    closeMissionDetail();
                    showMissionForm(id);
                }
            });
        }

        var deleteDetailBtn = document.getElementById('delete-mission-from-detail');
        if (deleteDetailBtn) {
            deleteDetailBtn.addEventListener('click', function() {
                var modal = document.getElementById('mission-detail-modal');
                var id = modal.dataset.missionId;
                if (id && confirm('Delete this mission permanently?')) {
                    deleteMission(id);
                    closeMissionDetail();
                    renderMissions();
                }
            });
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('missions', renderMissionsView);
    }

    document.addEventListener('dataLoaded', function() {
        var container = document.getElementById('tab-missions');
        if (container && container.style.display !== 'none') {
            renderMissionsView(container);
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-missions');
            if (container && container.style.display !== 'none') {
                renderMissionsView(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderMissionsView = renderMissionsView;
    window.renderMissions = renderMissions;
    window.showMissionForm = showMissionForm;
    window.saveMission = saveMission;
    window.deleteMission = deleteMission;
    window.getMission = getMission;
    window.getMissions = getMissions;
    window.getMissionsByType = getMissionsByType;
    window.getMissionTypeCounts = getMissionTypeCounts;
    window.getMissionTypeLabel = getMissionTypeLabel;
    window.getMissionTypeIcon = getMissionTypeIcon;
    window.getMissionTypeColor = getMissionTypeColor;
    window.getSubtypeLabel = getSubtypeLabel;
    window.getEscalationLabel = getEscalationLabel;
    window.getBillingLabel = getBillingLabel;
    window.createMission = createMission;
    window.updateMission = updateMission;
    window.addMissionLog = addMissionLog;
    window.toggleObjective = toggleObjective;
    window.addObjective = addObjective;
    window.showMissionDetail = showMissionDetail;
    window.closeMissionForm = closeMissionForm;
    window.closeMissionDetail = closeMissionDetail;
    window.initMissionEvents = initMissionEvents;
    window.getTeamName = getTeamName;
    window.getTeamTypeLabel = getTeamTypeLabel;
    window.getPriorityInfo = getPriorityInfo;
    window.getStatusInfo = getStatusInfo;
    window.getDifficultyLabel = getDifficultyLabel;
    window.populateTeamSelectors = populateTeamSelectors;
    window.populateCharacterSelectors = populateCharacterSelectors;
    window.populateSubtypeSelectors = populateSubtypeSelectors;
    window.addObjectiveToList = addObjectiveToList;
    window.addSupportTag = addSupportTag;
    window.collectSupportPersonnel = collectSupportPersonnel;
    window.addSupportPersonnel = addSupportPersonnel;
    window.removeSupportPersonnel = removeSupportPersonnel;
    window.getSupportPersonnel = getSupportPersonnel;
    window.exportMissionsCSV = exportMissionsCSV;
    window.exportMissionTemplateCSV = exportMissionTemplateCSV;
    window.importMissionsCSV = importMissionsCSV;
    window.csvField = csvField;
    window.parseCSVLine = parseCSVLine;
    window.MISSION_TYPES = MISSION_TYPES;
    window.generateMissionId = generateMissionId;
    window.calculateTotalPay = calculateTotalPay;
    window.DIFFICULTY_CODES = DIFFICULTY_CODES;
    window.MONTH_NAMES = MONTH_NAMES;

})();
