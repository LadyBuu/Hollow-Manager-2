/**
 * js/modules/missions/missions-ui.js - Mission UI Controller
 * Event wiring, modal management, user interactions.
 * 
 * UI PHILOSOPHY:
 *   - All mutations go through MissionsCore
 *   - All reads go through MissionsQueries
 *   - All rendering goes through MissionsRender
 *   - Persistence is owned by the UI (calls saveData after mutations)
 *   - Event handlers use delegation with CURRENT mission resolution
 * 
 * DEPENDENCIES:
 *   - MissionsCore (required)
 *   - MissionsRender (required)
 *   - MissionsQueries (required)
 *   - window.saveData (required)
 *   - window.TabManager (from tab-manager.js)
 */

(function() {
    'use strict';

    if (window.__missionsUILoaded) return;

    if (!window.MissionsCore) {
        console.error('MissionsUI: MissionsCore required.');
        return;
    }
    if (!window.MissionsRender) {
        console.error('MissionsUI: MissionsRender required.');
        return;
    }
    if (!window.MissionsQueries) {
        console.error('MissionsUI: MissionsQueries required.');
        return;
    }
    if (typeof window.saveData !== 'function') {
        console.error('MissionsUI: saveData() is required for persistence.');
        return;
    }

    window.__missionsUILoaded = true;

    var Core = window.MissionsCore;
    var Render = window.MissionsRender;
    var Queries = window.MissionsQueries;

    // ============================================================
    // PRIVATE STATE
    // ============================================================

    var state = {
        currentMissionId: null,
        filter: 'all'
    };

    // ============================================================
    // PERSISTENCE
    // ============================================================

    var _persistenceQueue = Promise.resolve();

    function queueSave() {
        _persistenceQueue = _persistenceQueue
            .catch(function() {})
            .then(function() {
                return window.saveData();
            });
        return _persistenceQueue;
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (window.NotificationSystem && typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type);
            return;
        }
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        console.log('[' + type + ']', message);
    }

    function showConfirmation(message) {
        return Promise.resolve(confirm(message));
    }

    // ============================================================
    // ID HELPERS
    // ============================================================

    function normaliseId(id) {
        return id !== undefined && id !== null ? String(id) : null;
    }

    // ============================================================
    // DATA HELPERS
    // ============================================================

    function getTeams() {
        var data = window.data || {};
        if (!Array.isArray(data.teams)) return [];
        return data.teams.filter(function(t) {
            return t && t.status !== 'deleted' && t.status !== 'inactive';
        });
    }

    function getCharacters() {
        var data = window.data || {};
        if (!Array.isArray(data.characters)) return [];
        return data.characters.filter(function(c) {
            return c && !c.deceased;
        });
    }

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char.name || char.firstName || 'Unknown';
    }

    // ============================================================
    // UI FUNCTIONS
    // ============================================================

    function renderMissionsView(container) {
        if (!container) {
            container = document.getElementById('tab-missions');
        }
        if (!container) return;

        container.innerHTML = getContainerHTML();
        renderMissions();
        initEvents();
    }

    function getContainerHTML() {
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
                <select id="mission-filter">
                    <option value="all">All Missions</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
                <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Total: <span id="mission-count">0</span></span>
            </div>
            <div id="missions-list"></div>
            ${getModalsHTML()}
        `;
    }

    function getModalsHTML() {
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
    }

    // ============================================================
    // RENDER MISSIONS
    // ============================================================

    function renderMissions() {
        var container = document.getElementById('missions-list');
        if (!container) return;

        var filter = document.getElementById('mission-filter') ? document.getElementById('mission-filter').value : 'all';
        state.filter = filter;

        var missions = Core.getMissions(filter);
        var count = document.getElementById('mission-count');
        if (count) count.textContent = missions.length;

        var html = Render.renderList(missions);
        container.innerHTML = html;

        // Attach click events to mission items
        container.querySelectorAll('.mission-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                if (id) showMissionDetail(id);
            });
        });
    }

    // ============================================================
    // MISSION FORM
    // ============================================================

    function showMissionForm(editId) {
        var modal = document.getElementById('mission-form-modal');
        var title = document.getElementById('mission-form-title');
        var content = document.getElementById('mission-form-content');

        if (!modal || !title || !content) return;

        var mission = editId ? Core.getMission(editId) : null;
        var teams = getTeams();
        var characters = getCharacters();

        title.textContent = mission ? 'Edit Mission' : 'Create Mission';

        var html = Render.renderForm(mission, teams, characters);
        content.innerHTML = html;

        modal.dataset.editId = editId || '';
        modal.classList.remove('hidden');

        setupModalOutsideClick('mission-form-modal', closeMissionForm);

        // Set up support personnel tags
        if (mission && mission.supportPersonnel) {
            mission.supportPersonnel.forEach(function(charId) {
                var char = characters.find(function(c) { return String(c.id) === String(charId); });
                if (char) {
                    addSupportTag(charId, getDisplayName(char));
                }
            });
        }

        attachFormEvents(modal, mission);
    }

    function attachFormEvents(modal, mission) {
        var form = modal.querySelector('#mission-form-inner');
        if (!form) return;

        // Pay calculation
        var basePayInput = document.getElementById('mission-base-pay');
        var surchargeInput = document.getElementById('mission-surcharge-pay');
        if (basePayInput && surchargeInput) {
            basePayInput.addEventListener('input', calculateTotalPay);
            surchargeInput.addEventListener('input', calculateTotalPay);
        }

        // Mission ID preview
        var teamSelect = document.getElementById('mission-team');
        var yearInput = document.getElementById('mission-year');
        var difficultySelect = document.getElementById('mission-difficulty');
        var idInput = document.getElementById('mission-id');

        function updateMissionIdPreview() {
            var teamId = teamSelect ? teamSelect.value : null;
            var year = parseInt(yearInput ? yearInput.value : new Date().getFullYear());
            var difficulty = difficultySelect ? difficultySelect.value : 'medium';
            if (year && !isNaN(year)) {
                idInput.value = Core.generateMissionId(teamId, year, difficulty);
            }
        }

        if (teamSelect) teamSelect.addEventListener('change', updateMissionIdPreview);
        if (yearInput) yearInput.addEventListener('change', updateMissionIdPreview);
        if (difficultySelect) difficultySelect.addEventListener('change', updateMissionIdPreview);

        // Primary type -> subtype
        var primarySelect = document.getElementById('mission-primary-type');
        var subtypeSelect = document.getElementById('mission-subtype');
        if (primarySelect && subtypeSelect) {
            primarySelect.addEventListener('change', function() {
                populateSubtypes(this.value);
            });
        }

        // Objectives
        var addObjBtn = document.getElementById('add-objective-btn');
        if (addObjBtn) {
            addObjBtn.addEventListener('click', function() {
                var input = document.getElementById('mission-objective');
                if (input && input.value.trim()) {
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
                    var btn = document.getElementById('add-objective-btn');
                    if (btn) btn.click();
                }
            });
        }

        // Support personnel
        var addSupportBtn = document.getElementById('add-support-btn');
        if (addSupportBtn) {
            addSupportBtn.addEventListener('click', function() {
                var select = document.getElementById('mission-support-select');
                if (select && select.value) {
                    var char = getCharacters().find(function(c) { return String(c.id) === String(select.value); });
                    if (char) {
                        addSupportTag(select.value, getDisplayName(char));
                        select.value = '';
                    }
                }
            });
        }

        // Submit
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveMission(e);
        });

        // Cancel
        var cancelBtn = document.getElementById('cancel-mission-form');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeMissionForm);
        }

        var closeBtn = document.getElementById('close-mission-form');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeMissionForm);
        }

        // Initial subtype population
        if (primarySelect) {
            populateSubtypes(primarySelect.value);
        }
    }

    function populateSubtypes(primaryType) {
        var subtypeSelect = document.getElementById('mission-subtype');
        if (!subtypeSelect) return;

        subtypeSelect.innerHTML = '<option value="">Select...</option>';

        if (primaryType && Queries.MISSION_TYPES[primaryType]) {
            var subtypes = Queries.MISSION_TYPES[primaryType].subtypes || [];
            subtypes.forEach(function(subtype) {
                var label = Queries.getSubtypeLabel(subtype);
                var option = document.createElement('option');
                option.value = subtype;
                option.textContent = label;
                subtypeSelect.appendChild(option);
            });
        }
    }

    function addObjectiveToList(text) {
        var container = document.getElementById('mission-objectives-list');
        if (!container) return;

        var div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center;';
        div.innerHTML = `
            <span style="flex:1;font-size:0.8rem;padding:4px 8px;background:var(--bg);border-radius:4px;">${escapeHtml(text)}</span>
            <button type="button" class="small danger remove-objective-btn">✕</button>
            <input type="hidden" value="${escapeHtml(text)}">
        `;
        container.appendChild(div);

        div.querySelector('.remove-objective-btn').onclick = function() {
            div.remove();
        };
    }

    function addSupportTag(characterId, characterName) {
        var container = document.getElementById('mission-support-list');
        if (!container) return;

        var existing = container.querySelector('[data-id="' + characterId + '"]');
        if (existing) return;

        var div = document.createElement('div');
        div.dataset.id = characterId;
        div.style.cssText = 'display:flex;align-items:center;gap:4px;background:var(--panel-alt);padding:2px 8px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);';
        div.innerHTML = `
            <span>${escapeHtml(characterName)}</span>
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

    function collectObjectives() {
        var container = document.getElementById('mission-objectives-list');
        if (!container) return [];
        var objectives = [];
        container.querySelectorAll('.remove-objective-btn').forEach(function(btn) {
            var parent = btn.parentElement;
            var text = parent.querySelector('input[type="hidden"]') ? parent.querySelector('input[type="hidden"]').value : parent.querySelector('span').textContent || '';
            if (text.trim()) {
                objectives.push({ text: text.trim(), done: false });
            }
        });
        return objectives;
    }

    function calculateTotalPay() {
        var basePay = document.getElementById('mission-base-pay');
        var surcharge = document.getElementById('mission-surcharge-pay');
        var totalInput = document.getElementById('mission-total-pay');
        if (!basePay || !surcharge || !totalInput) return;

        var baseNum = parseFloat(basePay.value.replace(/[^0-9.]/g, ''));
        var surchargeNum = parseFloat(surcharge.value.replace(/[^0-9.]/g, ''));

        if (!isNaN(baseNum) && !isNaN(surchargeNum)) {
            totalInput.value = (baseNum + surchargeNum).toFixed(2) + ' credits';
        } else if (!isNaN(baseNum)) {
            totalInput.value = baseNum.toFixed(2) + ' credits';
        } else if (!isNaN(surchargeNum)) {
            totalInput.value = surchargeNum.toFixed(2) + ' credits';
        } else {
            totalInput.value = '';
        }
    }

    function saveMission(e) {
        var form = e.target;
        var editId = form.closest('#mission-form-modal') ? form.closest('#mission-form-modal').dataset.editId : null;

        var objectives = collectObjectives();
        var objectiveInput = document.getElementById('mission-objective');
        if (objectiveInput && objectiveInput.value.trim()) {
            objectives.push({ text: objectiveInput.value.trim(), done: false });
            objectiveInput.value = '';
        }

        var supportPersonnel = collectSupportPersonnel();

        var tags = document.getElementById('mission-tags') ? 
            document.getElementById('mission-tags').value.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; }) : [];

        var year = parseInt(document.getElementById('mission-year') ? document.getElementById('mission-year').value : new Date().getFullYear());
        if (!year || isNaN(year) || year < 1000 || year > 9999) {
            year = new Date().getFullYear();
        }

        var missionData = {
            title: document.getElementById('mission-title') ? document.getElementById('mission-title').value.trim() : '',
            year: year,
            month: parseInt(document.getElementById('mission-month') ? document.getElementById('mission-month').value : new Date().getMonth() + 1),
            day: parseInt(document.getElementById('mission-day') ? document.getElementById('mission-day').value : new Date().getDate()),
            description: document.getElementById('mission-description') ? document.getElementById('mission-description').value.trim() : '',
            primaryType: document.getElementById('mission-primary-type') ? document.getElementById('mission-primary-type').value : '',
            subtype: document.getElementById('mission-subtype') ? document.getElementById('mission-subtype').value : '',
            secondaryType: document.getElementById('mission-secondary-type') ? document.getElementById('mission-secondary-type').value : '',
            escalation: document.getElementById('mission-escalation') ? document.getElementById('mission-escalation').value : 'tier_ii',
            threatType: document.getElementById('mission-threat-type') ? document.getElementById('mission-threat-type').value.trim() : '',
            environment: document.getElementById('mission-environment') ? document.getElementById('mission-environment').value.trim() : '',
            location: document.getElementById('mission-location') ? document.getElementById('mission-location').value.trim() : '',
            duration: document.getElementById('mission-duration') ? document.getElementById('mission-duration').value.trim() : '',
            difficulty: document.getElementById('mission-difficulty') ? document.getElementById('mission-difficulty').value : 'medium',
            priority: document.getElementById('mission-priority') ? document.getElementById('mission-priority').value : 'medium',
            basePay: document.getElementById('mission-base-pay') ? document.getElementById('mission-base-pay').value.trim() : '',
            surchargePay: document.getElementById('mission-surcharge-pay') ? document.getElementById('mission-surcharge-pay').value.trim() : '',
            billing: document.getElementById('mission-billing') ? document.getElementById('mission-billing').value : 'original',
            assignedTeamId: document.getElementById('mission-team') ? document.getElementById('mission-team').value || null : null,
            supportPersonnel: supportPersonnel,
            status: document.getElementById('mission-status') ? document.getElementById('mission-status').value : 'active',
            objectives: objectives,
            notes: document.getElementById('mission-notes') ? document.getElementById('mission-notes').value.trim() : '',
            tags: tags
        };

        if (!missionData.title) {
            showNotification('Mission title is required.', 'error');
            return;
        }

        var result;
        if (editId) {
            result = Core.updateMission(editId, missionData);
            if (result) Core.addLog(editId, 'Mission updated');
        } else {
            result = Core.createMission(missionData);
            if (result) Core.addLog(result.id, 'Mission created');
        }

        if (!result) {
            showNotification('Failed to save mission.', 'error');
            return;
        }

        closeMissionForm();
        renderMissions();
        queueSave();
        showNotification('Mission saved successfully.', 'success');
    }

    function closeMissionForm() {
        var modal = document.getElementById('mission-form-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // MISSION DETAIL
    // ============================================================

    function showMissionDetail(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        var modal = document.getElementById('mission-detail-modal');
        var content = document.getElementById('mission-detail-content');
        var title = document.getElementById('detail-mission-title');

        if (!modal || !content || !title) return;

        title.textContent = mission.title;
        content.innerHTML = Render.renderDetail(mission);

        modal.dataset.missionId = id;
        modal.classList.remove('hidden');

        setupModalOutsideClick('mission-detail-modal', closeMissionDetail);

        // Objective checkboxes
        content.querySelectorAll('.objective-check').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var missionId = this.dataset.mission;
                var index = parseInt(this.dataset.index);
                Core.toggleObjective(missionId, index);
                queueSave();
                showMissionDetail(missionId);
                renderMissions();
            });
        });

        // Edit button
        var editBtn = document.getElementById('edit-mission-from-detail');
        if (editBtn) {
            var newEditBtn = editBtn.cloneNode(true);
            editBtn.parentNode.replaceChild(newEditBtn, editBtn);
            newEditBtn.addEventListener('click', function() {
                var id = modal.dataset.missionId;
                if (id) {
                    closeMissionDetail();
                    showMissionForm(id);
                }
            });
        }

        // Delete button
        var deleteBtn = document.getElementById('delete-mission-from-detail');
        if (deleteBtn) {
            var newDeleteBtn = deleteBtn.cloneNode(true);
            deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
            newDeleteBtn.addEventListener('click', function() {
                var id = modal.dataset.missionId;
                if (id && confirm('Delete this mission permanently?')) {
                    Core.deleteMission(id);
                    queueSave();
                    closeMissionDetail();
                    renderMissions();
                    showNotification('Mission deleted.', 'success');
                }
            });
        }

        // Close button
        var closeBtn = document.getElementById('close-mission-detail');
        if (closeBtn) {
            var newCloseBtn = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
            newCloseBtn.addEventListener('click', closeMissionDetail);
        }
    }

    function closeMissionDetail() {
        var modal = document.getElementById('mission-detail-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================

    function setupModalOutsideClick(modalId, closeFn) {
        var modal = document.getElementById(modalId);
        if (!modal) return;
        if (modal._outsideListener) return;
        modal._outsideListener = true;

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeFn();
            }
        });
    }

    // ============================================================
    // CSV EXPORT / IMPORT
    // ============================================================

    function exportMissionsCSV() {
        var missions = Core.getMissions('all');
        if (missions.length === 0) {
            showNotification('No missions to export.', 'warning');
            return;
        }

        var lines = [];
        var headers = [
            'MissionID', 'Title', 'Year', 'Month', 'Day', 'Status', 'Priority', 'Difficulty',
            'PrimaryType', 'Subtype', 'SecondaryType', 'Escalation', 'ThreatType', 'Environment',
            'Team', 'Location', 'Duration', 'BasePay', 'SurchargePay', 'TotalPay', 'Billing',
            'Progress', 'SupportPersonnel', 'Objectives', 'Notes', 'Tags', 'CreatedAt', 'CompletedAt'
        ];
        lines.push(headers.join(','));

        missions.forEach(function(m) {
            var teamName = Queries.getTeamName(m.assignedTeamId);
            var primaryType = Queries.getMissionTypeLabel(m.primaryType);
            var secondaryType = m.secondaryType ? Queries.getMissionTypeLabel(m.secondaryType) : '';
            var subtypeLabel = Queries.getSubtypeLabel(m.subtype);
            var escalationLabel = Queries.getEscalationLabel(m.escalation);
            var billingLabel = Queries.getBillingLabel(m.billing);

            var supportNames = Queries.getSupportPersonnelNames(m).join('; ');
            var objectivesStr = m.objectives ? m.objectives.map(function(o) {
                return o.text + (o.done ? ' ✓' : '');
            }).join('; ') : '';
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

        showNotification('Exported ' + missions.length + ' missions.', 'success');
    }

    function exportMissionTemplateCSV() {
        var lines = [
            'MissionID,Title,Year,Month,Day,Status,Priority,Difficulty,PrimaryType,Subtype,SecondaryType,Escalation,ThreatType,Environment,Team,Location,Duration,BasePay,SurchargePay,TotalPay,Billing,Progress,SupportPersonnel,Objectives,Notes,Tags,CreatedAt,CompletedAt',
            'RS-2026-H001,Operation Nightfall,2026,6,15,active,high,hard,investigation,reconnaissance,research,Tier IV,Human/Magical,Urban,Raven Squad,Berlin,2 weeks,5000,2000,7000,Escalated,50,Dr. Sarah Chen,Infiltrate base;Retrieve documents ✓,Use stealth approach,covert;rescue,2024-01-15,',
            'AT-2026-M001,Field Testing Alpha,2026,7,20,active,medium,medium,research,field_testing,,Tier II,Magical,Lab,Team Alpha,London,3 days,2000,,2000,Original,0,,Test tracking spell,Proceed with caution,testing;magic,2024-01-20,',
            'LG-2026-E001,Supply Run,2026,8,5,completed,low,easy,acquisition,resources,,Tier I,,Rural,Logistics Team,Outpost 7,1 day,500,,500,Original,100,Corp. Davis,Deliver supplies ✓;Check inventory ✓,All delivered,logistics;supply,2024-01-10,2024-01-11'
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

        showNotification('Template CSV downloaded.', 'success');
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
                        var possibleHeaders = ['MissionID', 'Title', 'Year', 'Month', 'Day', 'Status', 'Priority', 'Difficulty', 'PrimaryType', 'Subtype', 'SecondaryType', 'Escalation', 'ThreatType', 'Environment', 'Team', 'Location', 'Duration', 'BasePay', 'SurchargePay', 'TotalPay', 'Billing', 'Progress', 'SupportPersonnel', 'Objectives', 'Notes', 'Tags', 'CreatedAt', 'CompletedAt'];
                        var headerMatch = values.filter(function(v) { return possibleHeaders.indexOf(v.trim()) !== -1; }).length;
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
                        headers = ['MissionID', 'Title', 'Year', 'Month', 'Day', 'Status', 'Priority', 'Difficulty', 'PrimaryType', 'Subtype', 'SecondaryType', 'Escalation', 'ThreatType', 'Environment', 'Team', 'Location', 'Duration', 'BasePay', 'SurchargePay', 'TotalPay', 'Billing', 'Progress', 'SupportPersonnel', 'Objectives', 'Notes', 'Tags', 'CreatedAt', 'CompletedAt'];
                    }

                    headers.forEach(function(header, index) {
                        var value = values[index] ? values[index].trim() : '';
                        var mapped = headerMap[header];
                        if (!mapped) return;

                        // Parse each field...
                        if (mapped === 'title') missionData.title = value;
                        else if (mapped === 'year') { var y = parseInt(value); if (!isNaN(y) && y >= 1000 && y <= 9999) missionData.year = y; }
                        else if (mapped === 'month') { var m = parseInt(value); if (!isNaN(m) && m >= 1 && m <= 12) missionData.month = m; }
                        else if (mapped === 'day') { var d = parseInt(value); if (!isNaN(d) && d >= 1 && d <= 31) missionData.day = d; }
                        else if (mapped === 'status') { if (['active', 'completed', 'cancelled'].indexOf(value) !== -1) missionData.status = value; }
                        else if (mapped === 'priority') { if (['low', 'medium', 'high', 'critical'].indexOf(value) !== -1) missionData.priority = value; }
                        else if (mapped === 'difficulty') { if (['easy', 'medium', 'hard', 'expert'].indexOf(value) !== -1) missionData.difficulty = value; }
                        else if (mapped === 'primaryType') { if (Queries.MISSION_TYPES[value]) missionData.primaryType = value; }
                        else if (mapped === 'subtype') { missionData.subtype = value; }
                        else if (mapped === 'secondaryType') { if (Queries.MISSION_TYPES[value]) missionData.secondaryType = value; }
                        else if (mapped === 'escalation') { if (['tier_i', 'tier_ii', 'tier_iii', 'tier_iv', 'tier_v'].indexOf(value) !== -1) missionData.escalation = value; }
                        else if (mapped === 'threatType') missionData.threatType = value;
                        else if (mapped === 'environment') missionData.environment = value;
                        else if (mapped === 'teamName') {
                            if (value) {
                                var teams = getTeams();
                                var team = teams.find(function(t) { return t.name.toLowerCase() === value.toLowerCase(); });
                                if (team) missionData.assignedTeamId = team.id;
                            }
                        }
                        else if (mapped === 'location') missionData.location = value;
                        else if (mapped === 'duration') missionData.duration = value;
                        else if (mapped === 'basePay') missionData.basePay = value;
                        else if (mapped === 'surchargePay') missionData.surchargePay = value;
                        else if (mapped === 'billing') { if (['original', 'escalated', 'emergency', 'internal'].indexOf(value) !== -1) missionData.billing = value; }
                        else if (mapped === 'progress') { var prog = parseInt(value); if (!isNaN(prog)) missionData.progress = prog; }
                        else if (mapped === 'supportPersonnel') {
                            if (value) {
                                var supportNames = value.split(';').map(function(n) { return n.trim(); }).filter(function(n) { return n; });
                                var characters = getCharacters();
                                supportNames.forEach(function(name) {
                                    var char = characters.find(function(c) {
                                        var charName = getDisplayName(c);
                                        return charName.toLowerCase() === name.toLowerCase();
                                    });
                                    if (char) missionData.supportPersonnel.push(char.id);
                                });
                            }
                        }
                        else if (mapped === 'objectives') {
                            if (value) {
                                var objParts = value.split(';');
                                objParts.forEach(function(part) {
                                    part = part.trim();
                                    if (part) {
                                        var done = part.endsWith('✓');
                                        var text = part.replace(/✓$/, '').trim();
                                        if (text) missionData.objectives.push({ text: text, done: done });
                                    }
                                });
                            }
                        }
                        else if (mapped === 'notes') missionData.notes = value;
                        else if (mapped === 'tags') {
                            if (value) missionData.tags = value.split(';').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
                        }
                    });

                    if (!missionData.title) {
                        errorCount++;
                        continue;
                    }

                    var newMission = Core.createMission(missionData);
                    if (newMission) {
                        importedCount++;
                        if (missionData.status === 'completed') {
                            newMission.status = 'completed';
                            newMission.completedAt = new Date().toISOString();
                        }
                        if (missionData.progress > 0) {
                            newMission.progress = missionData.progress;
                        }
                        Core.addLog(newMission.id, 'Imported from CSV');
                    }
                }

                queueSave().then(function() {
                    renderMissions();
                    showNotification('Imported ' + importedCount + ' missions. Errors: ' + errorCount, 'success');
                }).catch(function() {
                    renderMissions();
                    showNotification('Imported ' + importedCount + ' missions (save failed).', 'warning');
                });

            } catch (err) {
                showNotification('Failed to import CSV: ' + err.message, 'error');
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
                } else if (ch !== '\n' && ch !== '\r') {
                    current += ch;
                }
            }
        }
        values.push(current.trim());
        return values;
    }

    // ============================================================
    // EVENT INITIALIZATION
    // ============================================================

    function initEvents() {
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

        var filterSelect = document.getElementById('mission-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', renderMissions);
        }
    }

    // ============================================================
    // LIFECYCLE
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('missions', renderMissionsView);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-missions');
        if (container && container.style.display !== 'none') {
            renderMissionsView(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'missions') {
            var container = document.getElementById('tab-missions');
            if (container) renderMissionsView(container);
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
    window.showMissionDetail = showMissionDetail;
    window.closeMissionForm = closeMissionForm;
    window.closeMissionDetail = closeMissionDetail;
    window.exportMissionsCSV = exportMissionsCSV;
    window.importMissionsCSV = importMissionsCSV;

})();
