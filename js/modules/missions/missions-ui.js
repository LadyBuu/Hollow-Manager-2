/**
 * js/modules/missions/missions-ui.js - Mission UI Controller
 * Event wiring, modal management, user interactions.
 * 
 * UI PHILOSOPHY:
 *   - UI is the boundary between user and domain
 *   - All mutations go through MissionsCore
 *   - All reads go through MissionsQueries (NOT window.data directly)
 *   - All rendering goes through MissionsRender
 *   - Persistence is owned by the UI (calls saveData after mutations)
 *   - Event handlers use DELEGATION from the stable tab container
 *   - Single lifecycle owner (TabManager)
 *   - UI state is private, not exposed globally
 * 
 * UI LAYER CONTRACT:
 *   - initEvents() sets up event delegation ONCE on the stable container
 *   - renderMissionsView() renders the full view
 *   - showMissionDetail() opens detail modal
 *   - showMissionForm() opens form modal
 *   - All mutations call Core, then queueSave()
 *   - No direct mutation of window.data
 *   - No direct reading of window.data (use Queries)
 * 
 * PERSISTENCE CONTRACT:
 *   - All mutation operations call queueSave() after success
 *   - saveData() MUST exist and return a Promise
 *   - The UI assumes optimistic updates (memory first, then persist)
 *   - If persistence fails, the user is notified
 *   - Persistence failures are NEVER silently swallowed
 * 
 * EVENT DELEGATION:
 *   - All events are delegated from #tab-missions container
 *   - No direct event binding on dynamic elements
 *   - Modal close buttons use delegation via data-attributes
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
        filter: 'all',
        formEditId: null
    };

    // ============================================================
    // PERSISTENCE QUEUE
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

    function queueSaveWithNotification(message) {
        return queueSave().catch(function(err) {
            console.error('Mission persistence failed:', err);
            showNotification(message || 'Changes saved in memory but failed to persist.', 'warning');
        });
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
        if (typeof window.showConfirm === 'function') {
            var result = window.showConfirm(message);
            if (result && typeof result.then === 'function') {
                return result;
            }
            return Promise.resolve(result);
        }
        return Promise.resolve(confirm(message));
    }

    // ============================================================
    // ID NORMALISATION
    // ============================================================

    function normaliseId(id) {
        return Queries.normaliseId(id);
    }

    // ============================================================
    // DATA HELPERS (Use Queries, not window.data directly)
    // ============================================================

    function getTeams() {
        return Queries.getTeams ? Queries.getTeams() : [];
    }

    function getCharacters() {
        return Queries.getCharacters ? Queries.getCharacters() : [];
    }

    // ============================================================
    // UI RENDER FUNCTIONS
    // ============================================================

    function renderMissionsView(container) {
        if (!container) {
            container = document.getElementById('tab-missions');
        }
        if (!container) return;

        // Store reference to container for event delegation
        if (!container._missionsContainer) {
            container._missionsContainer = true;
        }

        container.innerHTML = Render.renderContainer();
        renderMissions();

        // Events are delegated from the container - only init once
        if (!container._missionsEventsInitialized) {
            initEvents(container);
            container._missionsEventsInitialized = true;
        }
    }

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
        state.formEditId = editId || null;

        var teams = getTeams();
        var characters = getCharacters();

        title.textContent = mission ? 'Edit Mission' : 'Create Mission';

        var supportIds = mission && mission.supportPersonnel ? mission.supportPersonnel : [];
        var html = Render.renderForm(mission, teams, characters, supportIds);
        content.innerHTML = html;

        modal.dataset.editId = editId || '';
        modal.classList.remove('hidden');

        // Set up support personnel tags
        if (mission && mission.supportPersonnel) {
            mission.supportPersonnel.forEach(function(charId) {
                var char = characters.find(function(c) { return String(c.id) === String(charId); });
                if (char) {
                    addSupportTag(charId, getDisplayName(char));
                }
            });
        }

        // Set up objectives with done status preserved
        if (mission && mission.objectives) {
            mission.objectives.forEach(function(obj) {
                addObjectiveToList(obj.text, !!obj.done);
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
            var year = parseInt(yearInput ? yearInput.value : new Date().getFullYear(), 10);
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
                populateSubtypes(this.value, mission ? mission.subtype : '');
            });
            // Initial population
            populateSubtypes(primarySelect.value, mission ? mission.subtype : '');
        }

        // Objectives
        var addObjBtn = document.getElementById('add-objective-btn');
        if (addObjBtn) {
            addObjBtn.addEventListener('click', function() {
                var input = document.getElementById('mission-objective');
                if (input && input.value.trim()) {
                    addObjectiveToList(input.value.trim(), false);
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

        // Cancel - handled by delegation, but keep direct for UX
        var cancelBtn = form.querySelector('#cancel-mission-form');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function(e) {
                e.preventDefault();
                closeMissionForm();
            });
        }
    }

    function populateSubtypes(primaryType, selectedSubtype) {
        var subtypeSelect = document.getElementById('mission-subtype');
        if (!subtypeSelect) return;

        subtypeSelect.innerHTML = '<option value="">Select...</option>';

        if (primaryType) {
            var subtypes = Queries.getSubtypesForType(primaryType);
            subtypes.forEach(function(subtype) {
                var label = Queries.getSubtypeLabel(subtype);
                var option = document.createElement('option');
                option.value = subtype;
                option.textContent = label;
                if (subtype === selectedSubtype) {
                    option.selected = true;
                }
                subtypeSelect.appendChild(option);
            });
        }
    }

    function addObjectiveToList(text, done) {
        var container = document.getElementById('mission-objectives-list');
        if (!container) return;

        var div = document.createElement('div');
        div.className = 'objective-row';
        div.dataset.done = done ? 'true' : 'false';
        div.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center;';

        var textSpan = document.createElement('span');
        textSpan.style.cssText = 'flex:1;font-size:0.8rem;padding:4px 8px;background:var(--bg);border-radius:4px;';
        textSpan.textContent = text;
        if (done) {
            textSpan.style.textDecoration = 'line-through';
            textSpan.style.color = 'var(--text-dim)';
        }

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-objective-btn';
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'padding:2px 8px;font-size:0.6rem;';

        var hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.className = 'objective-text';
        hiddenInput.value = text;

        var doneInput = document.createElement('input');
        doneInput.type = 'hidden';
        doneInput.className = 'objective-done';
        doneInput.value = done ? 'true' : 'false';

        div.appendChild(textSpan);
        div.appendChild(removeBtn);
        div.appendChild(hiddenInput);
        div.appendChild(doneInput);
        container.appendChild(div);

        removeBtn.onclick = function() {
            div.remove();
        };
    }

    function addSupportTag(characterId, characterName) {
        var container = document.getElementById('mission-support-list');
        if (!container) return;

        // Use Array.from for safer lookup
        var existing = Array.from(container.children).find(function(child) {
            return child.dataset && child.dataset.id === String(characterId);
        });
        if (existing) return;

        var div = document.createElement('div');
        div.dataset.id = characterId;
        div.style.cssText = 'display:flex;align-items:center;gap:4px;background:var(--panel-alt);padding:2px 8px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);';

        var nameSpan = document.createElement('span');
        nameSpan.textContent = characterName;

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-support-btn';
        removeBtn.dataset.id = characterId;
        removeBtn.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;';
        removeBtn.textContent = '✕';

        var hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.className = 'support-personnel-id';
        hiddenInput.value = characterId;

        div.appendChild(nameSpan);
        div.appendChild(removeBtn);
        div.appendChild(hiddenInput);
        container.appendChild(div);

        removeBtn.onclick = function() {
            div.remove();
        };
    }

    function collectSupportPersonnel() {
        var container = document.getElementById('mission-support-list');
        if (!container) return [];
        var ids = [];
        container.querySelectorAll('.support-personnel-id').forEach(function(input) {
            ids.push(input.value);
        });
        return ids;
    }

    function collectObjectives() {
        var container = document.getElementById('mission-objectives-list');
        if (!container) return [];

        var objectives = [];
        container.querySelectorAll('.objective-row').forEach(function(row) {
            var textInput = row.querySelector('.objective-text');
            var doneInput = row.querySelector('.objective-done');
            if (textInput && textInput.value.trim()) {
                var done = doneInput && doneInput.value === 'true';
                objectives.push({
                    text: textInput.value.trim(),
                    done: done
                });
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
        e.preventDefault();
        var modal = document.getElementById('mission-form-modal');
        var editId = modal ? modal.dataset.editId : null;

        var objectives = collectObjectives();
        var objectiveInput = document.getElementById('mission-objective');
        if (objectiveInput && objectiveInput.value.trim()) {
            objectives.push({ text: objectiveInput.value.trim(), done: false });
            objectiveInput.value = '';
        }

        var supportPersonnel = collectSupportPersonnel();

        var tags = document.getElementById('mission-tags') ? 
            document.getElementById('mission-tags').value.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; }) : [];

        var year = parseInt(document.getElementById('mission-year') ? document.getElementById('mission-year').value : new Date().getFullYear(), 10);
        if (!year || isNaN(year) || year < 1000 || year > 9999) {
            year = new Date().getFullYear();
        }

        var missionData = {
            title: document.getElementById('mission-title') ? document.getElementById('mission-title').value.trim() : '',
            year: year,
            month: parseInt(document.getElementById('mission-month') ? document.getElementById('mission-month').value : new Date().getMonth() + 1, 10),
            day: parseInt(document.getElementById('mission-day') ? document.getElementById('mission-day').value : new Date().getDate(), 10),
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
        queueSaveWithNotification('Mission saved in memory but failed to persist.');
        showNotification('Mission saved successfully.', 'success');
    }

    function closeMissionForm() {
        var modal = document.getElementById('mission-form-modal');
        if (modal) modal.classList.add('hidden');
        state.formEditId = null;
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

        // Objective checkboxes
        content.querySelectorAll('.objective-check').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var missionId = this.dataset.mission;
                var index = parseInt(this.dataset.index, 10);
                Core.toggleObjective(missionId, index);
                queueSaveWithNotification('Failed to save objective change.');
                showMissionDetail(missionId);
                renderMissions();
            });
        });
    }

    function closeMissionDetail() {
        var modal = document.getElementById('mission-detail-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // EVENT INITIALIZATION (Delegation from stable container)
    // ============================================================

    function initEvents(container) {
        if (!container) {
            container = document.getElementById('tab-missions');
        }
        if (!container) return;

        // ---- CONTAINER-LEVEL DELEGATION ----
        container.addEventListener('click', function(e) {
            var target = e.target;

            // ---- MISSION LIST ----
            var missionItem = target.closest('.mission-item');
            if (missionItem && container.contains(missionItem)) {
                // Ignore clicks on interactive elements inside the item
                if (target.closest('button, a, input, select, textarea')) {
                    return;
                }
                var id = missionItem.dataset.id;
                if (id) showMissionDetail(id);
                return;
            }

            // ---- ADD MISSION BUTTON ----
            var addBtn = target.closest('#add-mission-btn');
            if (addBtn) {
                e.preventDefault();
                showMissionForm();
                return;
            }

            // ---- FILTER CHANGE ----
            var filterSelect = target.closest('#mission-filter');
            if (filterSelect) {
                renderMissions();
                return;
            }

            // ---- EXPORT/IMPORT BUTTONS ----
            var exportBtn = target.closest('#export-missions-csv-btn');
            if (exportBtn) {
                e.preventDefault();
                exportMissionsCSV();
                return;
            }

            var importBtn = target.closest('#import-missions-csv-btn');
            if (importBtn) {
                e.preventDefault();
                document.getElementById('missions-csv-file-input').click();
                return;
            }

            var templateBtn = target.closest('#template-missions-csv-btn');
            if (templateBtn) {
                e.preventDefault();
                exportMissionTemplateCSV();
                return;
            }

            // ---- FORM MODAL ----
            var closeFormBtn = target.closest('#close-mission-form');
            if (closeFormBtn) {
                e.preventDefault();
                closeMissionForm();
                return;
            }

            var cancelFormBtn = target.closest('#cancel-mission-form');
            if (cancelFormBtn) {
                e.preventDefault();
                closeMissionForm();
                return;
            }

            // Form modal background click
            var formModal = target.closest('#mission-form-modal');
            if (formModal && target === formModal) {
                closeMissionForm();
                return;
            }

            // ---- DETAIL MODAL ----
            var closeDetailBtn = target.closest('#close-mission-detail');
            if (closeDetailBtn) {
                e.preventDefault();
                closeMissionDetail();
                return;
            }

            var detailModal = target.closest('#mission-detail-modal');
            if (detailModal && target === detailModal) {
                closeMissionDetail();
                return;
            }

            // ---- EDIT/DELETE FROM DETAIL ----
            var editDetailBtn = target.closest('#edit-mission-from-detail');
            if (editDetailBtn) {
                e.preventDefault();
                var modal = document.getElementById('mission-detail-modal');
                var id = modal ? modal.dataset.missionId : null;
                if (id) {
                    closeMissionDetail();
                    showMissionForm(id);
                }
                return;
            }

            var deleteDetailBtn = target.closest('#delete-mission-from-detail');
            if (deleteDetailBtn) {
                e.preventDefault();
                var modal = document.getElementById('mission-detail-modal');
                var id = modal ? modal.dataset.missionId : null;
                if (id) {
                    showConfirmation('Delete this mission permanently?')
                        .then(function(confirmed) {
                            if (confirmed) {
                                Core.deleteMission(id);
                                queueSaveWithNotification('Failed to save mission deletion.');
                                closeMissionDetail();
                                renderMissions();
                                showNotification('Mission deleted.', 'success');
                            }
                        })
                        .catch(function() {});
                }
                return;
            }
        });

        // ---- FILE INPUT (separate from click delegation) ----
        var fileInput = document.getElementById('missions-csv-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', function(e) {
                if (this.files.length > 0) {
                    importMissionsCSV(this.files[0]);
                    this.value = '';
                }
            });
        }
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
            var primaryType = m.primaryType || '';  // Use internal value
            var secondaryType = m.secondaryType || '';
            var subtypeLabel = m.subtype || '';  // Use internal value
            var escalationLabel = m.escalation || 'tier_ii';
            var billingLabel = m.billing || 'original';

            var supportNames = Queries.getSupportPersonnelNames(m).join('; ');
            var objectivesStr = m.objectives ? m.objectives.map(function(o) {
                return o.text + (o.done ? ' ✓' : '');
            }).join('; ') : '';
            var tagsStr = (m.tags || []).join('; ');

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
                m.createdAt || '',
                m.completedAt || ''
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
        // Use internal canonical values, not display labels
        var lines = [
            'MissionID,Title,Year,Month,Day,Status,Priority,Difficulty,PrimaryType,Subtype,SecondaryType,Escalation,ThreatType,Environment,Team,Location,Duration,BasePay,SurchargePay,TotalPay,Billing,Progress,SupportPersonnel,Objectives,Notes,Tags,CreatedAt,CompletedAt',
            'RS-2026-H001,Operation Nightfall,2026,6,15,active,high,hard,investigation,reconnaissance,research,tier_iv,Human/Magical,Urban,Raven Squad,Berlin,2 weeks,5000,2000,7000,escalated,50,Dr. Sarah Chen;Agent Marcus,Infiltrate base;Retrieve documents ✓;Extract intel,Use stealth approach,covert;rescue,2024-01-15T00:00:00.000Z,',
            'AT-2026-M001,Field Testing Alpha,2026,7,20,active,medium,medium,research,field_testing,,tier_ii,Magical,Lab,Team Alpha,London,3 days,2000,,2000,original,0,,Test new tracking spell;Document results,Proceed with caution,testing;magic,2024-01-20T00:00:00.000Z,',
            'LG-2026-E001,Supply Run,2026,8,5,completed,low,easy,acquisition,resources,,tier_i,,Rural,Logistics Team,Outpost 7,1 day,500,,500,original,100,Cpl. Davis,Deliver supplies ✓;Check inventory ✓,All delivered,logistics;supply,2024-01-10T00:00:00.000Z,2024-01-11T00:00:00.000Z'
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

                var text = e.target.result;
                var parsed = parseCSV(text);
                if (parsed.length < 2) {
                    showNotification('CSV file is empty or invalid.', 'error');
                    return;
                }

                var headers = parsed[0];
                var rows = parsed.slice(1);
                var importedCount = 0;
                var errorCount = 0;

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
                    'Tags': 'tags',
                    'CreatedAt': 'createdAt',
                    'CompletedAt': 'completedAt'
                };

                rows.forEach(function(values, rowIndex) {
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
                        tags: [],
                        createdAt: null,
                        completedAt: null
                    };

                    headers.forEach(function(header, index) {
                        var value = values[index] ? values[index].trim() : '';
                        var mapped = headerMap[header];
                        if (!mapped) return;

                        switch (mapped) {
                            case 'title': missionData.title = value; break;
                            case 'year': { var y = parseInt(value, 10); if (!isNaN(y) && y >= 1000 && y <= 9999) missionData.year = y; } break;
                            case 'month': { var m = parseInt(value, 10); if (!isNaN(m) && m >= 1 && m <= 12) missionData.month = m; } break;
                            case 'day': { var d = parseInt(value, 10); if (!isNaN(d) && d >= 1 && d <= 31) missionData.day = d; } break;
                            case 'status': { if (['active', 'completed', 'cancelled'].indexOf(value) !== -1) missionData.status = value; } break;
                            case 'priority': { if (['low', 'medium', 'high', 'critical'].indexOf(value) !== -1) missionData.priority = value; } break;
                            case 'difficulty': { if (['easy', 'medium', 'hard', 'expert'].indexOf(value) !== -1) missionData.difficulty = value; } break;
                            case 'primaryType': { if (Queries.isValidMissionType(value)) missionData.primaryType = value; } break;
                            case 'subtype': missionData.subtype = value; break;
                            case 'secondaryType': { if (Queries.isValidMissionType(value)) missionData.secondaryType = value; } break;
                            case 'escalation': { if (['tier_i','tier_ii','tier_iii','tier_iv','tier_v'].indexOf(value) !== -1) missionData.escalation = value; } break;
                            case 'threatType': missionData.threatType = value; break;
                            case 'environment': missionData.environment = value; break;
                            case 'teamName': {
                                if (value) {
                                    var teams = getTeams();
                                    var team = teams.find(function(t) {
                                        return t && t.name && t.name.toLowerCase() === value.toLowerCase();
                                    });
                                    if (team) missionData.assignedTeamId = team.id;
                                }
                            } break;
                            case 'location': missionData.location = value; break;
                            case 'duration': missionData.duration = value; break;
                            case 'basePay': missionData.basePay = value; break;
                            case 'surchargePay': missionData.surchargePay = value; break;
                            case 'billing': { if (['original', 'escalated', 'emergency', 'internal'].indexOf(value) !== -1) missionData.billing = value; } break;
                            case 'progress': { var prog = parseInt(value, 10); if (!isNaN(prog) && prog >= 0 && prog <= 100) missionData.progress = prog; } break;
                            case 'supportPersonnel': {
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
                            } break;
                            case 'objectives': {
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
                            } break;
                            case 'notes': missionData.notes = value; break;
                            case 'tags': {
                                if (value) missionData.tags = value.split(';').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
                            } break;
                            case 'createdAt': {
                                if (value) {
                                    var date = new Date(value);
                                    if (!isNaN(date.getTime())) missionData.createdAt = date.toISOString();
                                }
                            } break;
                            case 'completedAt': {
                                if (value) {
                                    var date = new Date(value);
                                    if (!isNaN(date.getTime())) missionData.completedAt = date.toISOString();
                                }
                            } break;
                        }
                    });

                    if (!missionData.title) {
                        errorCount++;
                        return;
                    }

                    var newMission = Core.createMission(missionData);
                    if (newMission) {
                        importedCount++;
                        // Progress is derived from objectives, Core handles it
                        Core.addLog(newMission.id, 'Imported from CSV');
                    } else {
                        errorCount++;
                    }
                });

                queueSaveWithNotification('Failed to save imported missions.');
                renderMissions();
                showNotification('Imported ' + importedCount + ' missions. Errors: ' + errorCount, 'success');

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

    function parseCSV(text) {
        var rows = [];
        var currentRow = [];
        var currentField = '';
        var inQuotes = false;
        var i = 0;

        while (i < text.length) {
            var ch = text[i];

            if (inQuotes) {
                if (ch === '"' && text[i + 1] === '"') {
                    currentField += '"';
                    i += 2;
                } else if (ch === '"') {
                    inQuotes = false;
                    i++;
                } else {
                    currentField += ch;
                    i++;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                    i++;
                } else if (ch === ',') {
                    currentRow.push(currentField);
                    currentField = '';
                    i++;
                } else if (ch === '\r' && text[i + 1] === '\n') {
                    currentRow.push(currentField);
                    currentField = '';
                    rows.push(currentRow);
                    currentRow = [];
                    i += 2;
                } else if (ch === '\n') {
                    currentRow.push(currentField);
                    currentField = '';
                    rows.push(currentRow);
                    currentRow = [];
                    i++;
                } else {
                    currentField += ch;
                    i++;
                }
            }
        }

        if (currentField || currentRow.length > 0) {
            currentRow.push(currentField);
            rows.push(currentRow);
        }

        return rows;
    }

    // ============================================================
    // DISPLAY NAME HELPER (Local)
    // ============================================================

    function getDisplayName(char) {
        if (!char) return 'Unknown';
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char.name || char.firstName || 'Unknown';
    }

    // ============================================================
    // LIFECYCLE MANAGEMENT
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
    window.initMissionEvents = initEvents;

})();
