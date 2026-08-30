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
        populateSubtypeSelectors();
        renderMissions();
        initMissionEvents();
    }

    function getMissionsHTML() {
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
                <div class="modal-content" style="max-width:700px;">
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
                                    <input type="text" id="mission-id" placeholder="e.g., ML-001">
                                </div>
                                <div class="form-group">
                                    <label>Contract Type</label>
                                    <input type="text" id="mission-contract-type" placeholder="e.g., Investigation">
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
                                    <label>Pay/Reward</label>
                                    <input type="text" id="mission-pay" placeholder="e.g., 5000 credits">
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

            html += '<div class="list-item" style="grid-template-columns:1fr 0.8fr 0.6fr 0.6fr 0.6fr 0.6fr 0.6fr 1fr;cursor:pointer;" data-id="' + mission.id + '">';
            html += '<span><strong>' + mission.title + '</strong>';
            if (mission.status === 'completed') {
                html += ' <span style="color:var(--info);font-size:0.6rem;">✓</span>';
            }
            if (mission.missionId) {
                html += ' <span style="color:var(--text-dim);font-size:0.6rem;">[' + mission.missionId + ']</span>';
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

        var mission = {
            id: window.generateId('miss'),
            missionId: missionData.missionId || '',
            title: missionData.title || 'Untitled Mission',
            description: missionData.description || '',
            contractType: missionData.contractType || '',
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
            pay: missionData.pay || '',
            billing: missionData.billing || 'original',
            assignedTeamId: missionData.assignedTeamId || null,
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
            window.logActivity('Created mission: ' + mission.title + ' (' + getMissionTypeLabel(mission.primaryType) + ')');
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
            <div class="detail-row"><span class="label">Mission ID:</span> <span>${mission.missionId || 'N/A'}</span></div>
            <div class="detail-row"><span class="label">Contract Type:</span> <span>${mission.contractType || 'N/A'}</span></div>
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
            <div class="detail-row"><span class="label">Location:</span> <span>${mission.location || 'Not specified'}</span></div>
            <div class="detail-row"><span class="label">Duration:</span> <span>${mission.duration || 'Not specified'}</span></div>
            <div class="detail-row"><span class="label">Pay:</span> <span>${mission.pay || 'Not specified'}</span></div>
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

        document.getElementById('mission-objectives-list').innerHTML = '';

        if (editId) {
            title.textContent = 'Edit Mission';
            var mission = getMission(editId);
            if (mission) {
                document.getElementById('mission-title').value = mission.title || '';
                document.getElementById('mission-id').value = mission.missionId || '';
                document.getElementById('mission-contract-type').value = mission.contractType || '';
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
                document.getElementById('mission-pay').value = mission.pay || '';
                document.getElementById('mission-billing').value = mission.billing || 'original';
                document.getElementById('mission-status').value = mission.status || 'active';
                document.getElementById('mission-team').value = mission.assignedTeamId || '';
                document.getElementById('mission-objective').value = '';
                document.getElementById('mission-notes').value = mission.notes || '';
                document.getElementById('mission-tags').value = (mission.tags || []).join(', ');

                if (mission.objectives) {
                    mission.objectives.forEach(function(obj) {
                        addObjectiveToList(obj.text);
                    });
                }
                form.dataset.editId = editId;
            }
        } else {
            title.textContent = 'Create Mission';
            form.reset();
            document.getElementById('mission-primary-type').value = '';
            document.getElementById('mission-subtype').value = '';
            document.getElementById('mission-secondary-type').value = '';
            document.getElementById('mission-escalation').value = 'tier_ii';
            document.getElementById('mission-difficulty').value = 'medium';
            document.getElementById('mission-priority').value = 'medium';
            document.getElementById('mission-team').value = '';
            delete form.dataset.editId;
        }
        populateSubtypeSelectors();
    }

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

        var tags = document.getElementById('mission-tags').value.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; });

        var missionData = {
            missionId: document.getElementById('mission-id').value.trim(),
            title: document.getElementById('mission-title').value.trim(),
            description: document.getElementById('mission-description').value.trim(),
            contractType: document.getElementById('mission-contract-type').value.trim(),
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
            pay: document.getElementById('mission-pay').value.trim(),
            billing: document.getElementById('mission-billing').value || 'original',
            assignedTeamId: document.getElementById('mission-team').value || null,
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
        lines.push('Title,MissionID,ContractType,Status,Priority,Difficulty,PrimaryType,Subtype,SecondaryType,Escalation,ThreatType,Environment,Team,TeamType,Location,Duration,Pay,Billing,Progress,Objectives,Notes,Tags,CreatedAt,CompletedAt');

        missions.forEach(function(m) {
            var teamName = getTeamName(m.assignedTeamId);
            var teamType = getTeamTypeLabel(m.assignedTeamId);
            var primaryType = getMissionTypeLabel(m.primaryType);
            var secondaryType = m.secondaryType ? getMissionTypeLabel(m.secondaryType) : '';
            var subtypeLabel = getSubtypeLabel(m.subtype);
            var escalationLabel = getEscalationLabel(m.escalation);
            var billingLabel = getBillingLabel(m.billing);
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
                csvField(m.title || ''),
                csvField(m.missionId || ''),
                csvField(m.contractType || ''),
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
                csvField(m.pay || ''),
                csvField(billingLabel),
                m.progress || '0',
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
            'Title,MissionID,ContractType,Status,Priority,Difficulty,PrimaryType,Subtype,SecondaryType,Escalation,ThreatType,Environment,Team,TeamType,Location,Duration,Pay,Billing,Progress,Objectives,Notes,Tags,CreatedAt,CompletedAt',
            'Operation Nightfall,ML-001,Investigation,active,high,hard,investigation,reconnaissance,research,Tier IV,Human/Magical,Urban,Raven Squad,Professional,Berlin,2 weeks,5000 credits,Escalated,50,Infiltrate base;Retrieve documents ✓;Extract intel,Use stealth approach,covert;rescue,2024-01-15,',
            'Field Testing Alpha,FT-001,Research,active,medium,medium,research,field_testing,,Tier II,Magical,Lab,Team Alpha,Academic,London,3 days,2000 credits,Original,0,Test new tracking spell;Document results,Proceed with caution,testing;magic,2024-01-20,',
            'Supply Run,SR-001,Logistics,completed,low,easy,acquisition,resources,,Tier I,,Rural,Logistics Team,Temporary,Outpost 7,1 day,500 credits,Original,100,Deliver supplies ✓;Check inventory ✓,All delivered,logistics;supply,2024-01-10,2024-01-11'
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
                        var possibleHeaders = ['Title', 'MissionID', 'ContractType', 'Status', 'Priority', 'Difficulty', 'PrimaryType', 'Subtype', 'SecondaryType', 'Escalation', 'ThreatType', 'Environment', 'Team', 'TeamType', 'Location', 'Duration', 'Pay', 'Billing', 'Progress', 'Objectives', 'Notes', 'Tags', 'CreatedAt', 'CompletedAt'];
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
                        missionId: '',
                        contractType: '',
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
                        location: '',
                        duration: '',
                        pay: '',
                        billing: 'original',
                        progress: 0,
                        objectives: [],
                        notes: '',
                        tags: []
                    };

                    var headerMap = {
                        'Title': 'title',
                        'MissionID': 'missionId',
                        'ContractType': 'contractType',
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
                        'Pay': 'pay',
                        'Billing': 'billing',
                        'Progress': 'progress',
                        'Objectives': 'objectives',
                        'Notes': 'notes',
                        'Tags': 'tags'
                    };

                    if (headers.length === 0) {
                        headers = ['Title', 'MissionID', 'ContractType', 'Status', 'Priority', 'Difficulty', 'PrimaryType', 'Subtype', 'SecondaryType', 'Escalation', 'ThreatType', 'Environment', 'Team', 'TeamType', 'Location', 'Duration', 'Pay', 'Billing', 'Progress', 'Objectives', 'Notes', 'Tags', 'CreatedAt', 'CompletedAt'];
                    }

                    headers.forEach(function(header, index) {
                        var value = values[index] ? values[index].trim() : '';
                        var mapped = headerMap[header];

                        if (!mapped) return;

                        if (mapped === 'title') {
                            missionData.title = value;
                        } else if (mapped === 'missionId') {
                            missionData.missionId = value;
                        } else if (mapped === 'contractType') {
                            missionData.contractType = value;
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
                        } else if (mapped === 'pay') {
                            missionData.pay = value;
                        } else if (mapped === 'billing') {
                            var billingValues = ['original', 'escalated', 'emergency', 'internal'];
                            if (billingValues.indexOf(value) !== -1) {
                                missionData.billing = value;
                            }
                        } else if (mapped === 'progress') {
                            var prog = parseInt(value);
                            if (!isNaN(prog)) missionData.progress = prog;
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
    window.populateSubtypeSelectors = populateSubtypeSelectors;
    window.addObjectiveToList = addObjectiveToList;
    window.exportMissionsCSV = exportMissionsCSV;
    window.exportMissionTemplateCSV = exportMissionTemplateCSV;
    window.importMissionsCSV = importMissionsCSV;
    window.csvField = csvField;
    window.parseCSVLine = parseCSVLine;
    window.MISSION_TYPES = MISSION_TYPES;

})();
