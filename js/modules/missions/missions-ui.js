/**
 * js/modules/missions/missions-ui.js - Mission UI Controller
 * Event wiring, modal management, user interactions for missions.
 * 
 * UI PHILOSOPHY:
 *   - UI is the boundary between user and domain
 *   - All mutations go through MissionsCore
 *   - All reads go through MissionsQueries (preferred) or MissionsCore
 *   - All rendering goes through MissionsRender
 *   - Persistence is owned by the UI (calls saveData after mutations)
 *   - Event handlers use delegation with CURRENT mission resolution
 * 
 * PERSISTENCE CONTRACT:
 *   - All mutation operations call saveData() after success
 *   - saveData() MUST exist and return a Promise that rejects on failure
 *   - The UI assumes optimistic updates (memory first, then persist)
 *   - If persistence fails, the user is notified but UI remains consistent
 *   - Saves are SERIALIZED to prevent race conditions
 * 
 * DEPENDENCIES:
 *   - window.MissionsCore (required)
 *   - window.MissionsRender (required)
 *   - window.MissionsQueries (required)
 *   - window.saveData (required - but handled defensively)
 *   - window.NotificationSystem (from notification.js)
 *   - window.TabManager (from tab-manager.js)
 * 
 * LOAD ORDER:
 *   - missions-schema.js (FIRST)
 *   - missions-core.js
 *   - missions-queries.js
 *   - missions-render.js
 *   - missions-ui.js (LAST)
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__missionsUILoaded) return;

    // ============================================================
    // DEPENDENCIES - Defensive loading
    // ============================================================

    // Create dummy saveData if not available (prevents errors during load)
    if (typeof window.saveData !== 'function') {
        console.warn('MissionsUI: saveData() is not available. Persistence will be disabled.');
        window.saveData = function() {
            return Promise.resolve(true);
        };
    }

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

    // Mark as loaded ONLY after all dependencies are confirmed
    window.__missionsUILoaded = true;

    var Core = window.MissionsCore;
    var Render = window.MissionsRender;
    var Queries = window.MissionsQueries;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_STATUSES = ['active', 'completed', 'cancelled'];
    var VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
    var VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];

    // ============================================================
    // PRIVATE STATE
    // ============================================================

    var state = {
        currentMissionId: null,
        currentFilter: 'all'
    };

    // ============================================================
    // PERSISTENCE QUEUE - Serializes saves to prevent race conditions
    // ============================================================

    var _persistenceQueue = Promise.resolve();

    function queueSave() {
        _persistenceQueue = _persistenceQueue
            .catch(function() {
                // Keep queue alive after previous failure
            })
            .then(function() {
                return window.saveData();
            });

        return _persistenceQueue;
    }

    // ============================================================
    // NOTIFICATION SYSTEM (Private)
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

        if (typeof window.notify === 'function') {
            window.notify(message, type);
            return;
        }

        console.log('[' + type + ']', message);
    }

    /**
     * Show a confirmation dialog.
     * Returns a Promise that resolves to true if confirmed, false otherwise.
     */
    function showConfirmation(message) {
        if (typeof window.showConfirm === 'function') {
            var result = window.showConfirm(message);
            if (result && typeof result.then === 'function') {
                return result;
            }
            return Promise.resolve(result);
        }

        if (typeof window.confirmModal === 'function') {
            var result = window.confirmModal(message);
            if (result && typeof result.then === 'function') {
                return result;
            }
            return Promise.resolve(result);
        }

        return Promise.resolve(confirm(message));
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    /**
     * Perform a mission operation and persist the result.
     * All mutation methods MUST return truthy values on success.
     * saveData() is guaranteed to exist (checked at module load).
     * 
     * @param {string} operationName - Name of the operation for logging
     * @param {function} operation - Function that performs the mutation
     * @param {function} onSuccess - Called after in-memory mutation succeeds
     * @param {function} onError - Called if persistence fails (optional)
     * @param {function} onPersist - Called after persistence completes (optional)
     * @returns {boolean} True if the in-memory mutation succeeded
     */
    function persistOperation(operationName, operation, onSuccess, onError, onPersist) {
        try {
            var result = operation();

            if (!result) {
                console.warn('MissionsUI: ' + operationName + ' failed.');
                return false;
            }

            // Persist via serialized queue - don't block UI
            queueSave()
                .then(function() {
                    if (typeof onPersist === 'function') {
                        onPersist();
                    }
                })
                .catch(function(err) {
                    console.error('MissionsUI: Failed to persist ' + operationName + ':', err);
                    showNotification(
                        'Changes were made but could not be saved to storage. Please try again.',
                        'error'
                    );
                    if (typeof onError === 'function') {
                        onError(err);
                    }
                });

            if (typeof onSuccess === 'function') {
                onSuccess();
            }

            return true;
        } catch (err) {
            console.error('MissionsUI: ' + operationName + ' threw an error:', err);
            showNotification('Operation failed: ' + err.message, 'error');
            return false;
        }
    }

    // ============================================================
    // ID NORMALISATION
    // ============================================================

    function normaliseId(id) {
        return id !== undefined && id !== null ? String(id) : null;
    }

    // ============================================================
    // POPULATE SELECTORS
    // ============================================================

    function populateTeamSelect(select, currentValue) {
        if (!select) return;

        var data = window.data || {};
        var teams = Array.isArray(data.teams) ? data.teams : [];

        select.innerHTML = '<option value="">Unassigned</option>';

        var activeTeams = teams.filter(function(t) {
            return t && typeof t === 'object' && t.status === 'active';
        });

        activeTeams.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        activeTeams.forEach(function(team) {
            var option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name || 'Unknown Team';
            if (currentValue && String(team.id) === String(currentValue)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        if (currentValue) {
            var exists = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === currentValue) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                select.value = '';
            }
        }
    }

    function getAvailableTeams() {
        var data = window.data || {};
        var teams = Array.isArray(data.teams) ? data.teams : [];
        return teams.filter(function(t) {
            return t && typeof t === 'object' && t.status === 'active';
        });
    }

    function getTeamName(teamId) {
        var teams = getAvailableTeams();
        for (var i = 0; i < teams.length; i++) {
            if (String(teams[i].id) === String(teamId)) {
                return teams[i].name || 'Unknown Team';
            }
        }
        return 'Unknown Team';
    }

    // ============================================================
    // MODAL SETUP
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
    // DETAIL EVENTS
    // ============================================================

    function attachDetailEvents(modal) {
        var content = modal.querySelector('#mission-detail-content');
        if (!content) return;

        if (content._detailEventsAttached) return;
        content._detailEventsAttached = true;

        content.addEventListener('click', function(e) {
            var missionId = modal.dataset.missionId;
            if (!missionId) return;

            var mission = Core.getMission(missionId);
            if (!mission) return;

            var target = e.target;

            // Toggle objective
            var checkbox = target.closest('.objective-item input[type="checkbox"]');
            if (checkbox) {
                var objIndex = parseInt(checkbox.dataset.index, 10);
                if (!isNaN(objIndex)) {
                    toggleObjective(missionId, objIndex, checkbox.checked);
                }
                return;
            }

            // Add objective
            var addBtn = target.closest('#add-objective-btn');
            if (addBtn) {
                var input = content.querySelector('#new-objective-input');
                if (input && input.value.trim()) {
                    addObjective(missionId, input.value.trim());
                }
                return;
            }

            // Delete mission
            var deleteBtn = target.closest('#delete-mission-btn');
            if (deleteBtn) {
                deleteMissionHandler(missionId);
                return;
            }

            // Edit mission
            var editBtn = target.closest('#edit-mission-btn');
            if (editBtn) {
                showMissionForm(missionId);
                return;
            }

            // Complete mission
            var completeBtn = target.closest('#complete-mission-btn');
            if (completeBtn) {
                completeMissionHandler(missionId);
                return;
            }

            // Cancel mission
            var cancelBtn = target.closest('#cancel-mission-btn');
            if (cancelBtn) {
                cancelMissionHandler(missionId);
                return;
            }
        });
    }

    // ============================================================
    // LIST EVENTS
    // ============================================================

    function attachListEvents(container) {
        if (container._listEventsAttached) return;
        container._listEventsAttached = true;

        container.addEventListener('click', function(e) {
            var target = e.target;

            var viewBtn = target.closest('.view-mission');
            if (viewBtn) {
                e.preventDefault();
                viewMission(viewBtn.dataset.id);
                return;
            }

            var editBtn = target.closest('.edit-mission');
            if (editBtn) {
                e.preventDefault();
                showMissionForm(editBtn.dataset.id);
                return;
            }

            var deleteBtn = target.closest('.delete-mission');
            if (deleteBtn) {
                e.preventDefault();
                deleteMissionHandler(deleteBtn.dataset.id);
                return;
            }

            var completeBtn = target.closest('.complete-mission');
            if (completeBtn) {
                e.preventDefault();
                completeMissionHandler(completeBtn.dataset.id);
                return;
            }
        });

        var addBtn = document.getElementById('add-mission-btn');
        if (addBtn && !addBtn._listener) {
            addBtn._listener = true;
            addBtn.addEventListener('click', function() {
                showMissionForm();
            });
        }

        var filterSelect = document.getElementById('mission-filter');
        if (filterSelect && !filterSelect._listener) {
            filterSelect._listener = true;
            filterSelect.addEventListener('change', function() {
                state.currentFilter = this.value;
                renderMissionList(document.getElementById('tab-missions'));
            });
        }
    }

    // ============================================================
    // RENDER FUNCTIONS
    // ============================================================

    function renderMissions(container) {
        if (!container) {
            container = document.getElementById('tab-missions');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading mission data...</p>';
            return;
        }

        container.innerHTML = getMissionsHTML();
        renderMissionList(container);
    }

    function getMissionsHTML() {
        var filterOptions = '';
        var filterValues = ['all', 'active', 'completed', 'cancelled'];
        var filterLabels = ['All Missions', 'Active', 'Completed', 'Cancelled'];

        for (var i = 0; i < filterValues.length; i++) {
            var selected = state.currentFilter === filterValues[i] ? ' selected' : '';
            filterOptions += '<option value="' + filterValues[i] + '"' + selected + '>' + filterLabels[i] + '</option>';
        }

        return `
            <div class="page-header">
                <h2>Missions</h2>
                <button id="add-mission-btn" class="primary">+ New Mission</button>
            </div>
            <div class="filter-section">
                <label for="mission-filter">Filter:</label>
                <select id="mission-filter">
                    ${filterOptions}
                </select>
                <span id="mission-count" style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Total: 0</span>
            </div>
            <div id="mission-list">
                <div id="missions-container">
                    <p class="empty-state">No missions created yet.</p>
                </div>
            </div>
            ${getModalsHTML()}
        `;
    }

    function getModalsHTML() {
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
                        <h3 id="detail-mission-title">Mission</h3>
                        <button class="close-modal" id="close-mission-detail">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="mission-detail-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderMissionList(container) {
        var listContainer = container ? container.querySelector('#missions-container') : document.getElementById('missions-container');
        var countEl = container ? container.querySelector('#mission-count') : document.getElementById('mission-count');

        if (!listContainer) return;

        var filter = state.currentFilter || 'all';
        var missions = Core.getMissions();

        var filteredMissions = missions.filter(function(m) {
            if (filter === 'all') return true;
            return m.status === filter;
        });

        if (countEl) {
            countEl.textContent = 'Total: ' + filteredMissions.length;
        }

        var html = Render.renderList(filteredMissions);
        listContainer.innerHTML = html;

        attachListEvents(listContainer);
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    function viewMission(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        state.currentMissionId = normaliseId(id);

        var modal = document.getElementById('mission-detail-modal');
        if (!modal) return;

        var title = document.getElementById('detail-mission-title');
        if (title) title.textContent = mission.title;

        var content = document.getElementById('mission-detail-content');
        if (!content) return;

        var html = Render.renderDetail(mission);
        content.innerHTML = html;

        modal.dataset.missionId = id;
        modal.classList.remove('hidden');

        setupModalOutsideClick('mission-detail-modal', closeMissionDetail);

        // Bind close button
        var closeBtn = document.getElementById('close-mission-detail');
        if (closeBtn) {
            var newCloseBtn = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
            newCloseBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                closeMissionDetail();
            });
        }

        // Also handle any .close-modal inside the modal
        var modalCloseBtns = modal.querySelectorAll('.close-modal');
        modalCloseBtns.forEach(function(btn) {
            if (btn.id !== 'close-mission-detail') {
                var newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                newBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    closeMissionDetail();
                });
            }
        });

        // Populate team select
        var teamSelect = content.querySelector('#mission-team-select');
        if (teamSelect) {
            populateTeamSelect(teamSelect, mission.assignedTeamId);
        }

        attachDetailEvents(modal);
    }

    function closeMissionDetail() {
        var modal = document.getElementById('mission-detail-modal');
        if (modal) {
            modal.classList.add('hidden');
            var content = document.getElementById('mission-detail-content');
            if (content) {
                content.innerHTML = '';
            }
        }
        state.currentMissionId = null;
    }

    // ============================================================
    // FORM FUNCTIONS
    // ============================================================

    function showMissionForm(editId) {
        var modal = document.getElementById('mission-form-modal');
        var title = document.getElementById('mission-form-title');
        var content = document.getElementById('mission-form-content');

        if (!modal || !title || !content) return;

        var mission = editId ? Core.getMission(editId) : null;

        if (editId && !mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        title.textContent = mission ? 'Edit Mission' : 'Create Mission';

        var html = Render.renderForm(mission, {
            statuses: VALID_STATUSES,
            priorities: VALID_PRIORITIES,
            difficulties: VALID_DIFFICULTIES
        });

        content.innerHTML = html;

        modal.dataset.editId = editId || '';
        modal.classList.remove('hidden');

        setupModalOutsideClick('mission-form-modal', closeMissionForm);

        attachFormEvents(modal, mission);
    }

    function attachFormEvents(modal, mission) {
        var form = modal.querySelector('#mission-form');
        if (!form) return;

        var newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        // Populate team select
        var teamSelect = newForm.querySelector('#mission-team');
        if (teamSelect) {
            populateTeamSelect(teamSelect, mission ? mission.assignedTeamId : null);
        }

        newForm.addEventListener('submit', function(e) {
            e.preventDefault();

            var editId = modal.dataset.editId;

            var data = {
                title: this.querySelector('#mission-title').value.trim(),
                status: this.querySelector('#mission-status').value,
                priority: this.querySelector('#mission-priority').value,
                difficulty: this.querySelector('#mission-difficulty').value,
                assignedTeamId: this.querySelector('#mission-team').value || null,
                location: this.querySelector('#mission-location').value.trim(),
                duration: this.querySelector('#mission-duration').value.trim(),
                pay: this.querySelector('#mission-pay').value.trim(),
                description: this.querySelector('#mission-description').value.trim(),
                notes: this.querySelector('#mission-notes').value.trim(),
                objectives: []
            };

            if (!data.title) {
                showNotification('Mission title is required.', 'warning');
                return;
            }

            // Collect objectives
            var objectiveInputs = this.querySelectorAll('.objective-input');
            var objectiveChecks = this.querySelectorAll('.objective-done');
            for (var i = 0; i < objectiveInputs.length; i++) {
                var text = objectiveInputs[i].value.trim();
                if (text) {
                    var done = objectiveChecks[i] ? objectiveChecks[i].checked : false;
                    data.objectives.push({ text: text, done: done });
                }
            }

            var success;
            if (editId) {
                success = persistOperation('updateMission', function() {
                    return Core.updateMission(editId, data);
                }, function() {
                    closeMissionForm();
                    renderMissionList(document.getElementById('tab-missions'));
                    if (state.currentMissionId === normaliseId(editId)) {
                        viewMission(editId);
                    }
                });
            } else {
                success = persistOperation('createMission', function() {
                    return Core.createMission(data);
                }, function() {
                    closeMissionForm();
                    renderMissionList(document.getElementById('tab-missions'));
                });
            }

            if (!success) {
                showNotification('Failed to save mission.', 'error');
            }
        });

        // Cancel button
        var cancelBtn = newForm.querySelector('.cancel-form-btn');
        if (cancelBtn) {
            var newCancel = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            newCancel.addEventListener('click', closeMissionForm);
        }

        // Add objective button
        var addObjBtn = newForm.querySelector('#add-objective-btn');
        if (addObjBtn) {
            addObjBtn.addEventListener('click', function() {
                var container = document.getElementById('objectives-container');
                if (container) {
                    addObjectiveRow(container);
                }
            });
        }

        // Close button
        var closeBtn = document.getElementById('close-mission-form');
        if (closeBtn) {
            var newClose = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newClose, closeBtn);
            newClose.addEventListener('click', closeMissionForm);
        }
    }

    function addObjectiveRow(container) {
        var row = document.createElement('div');
        row.className = 'objective-row';
        row.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center;';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'objective-done';
        checkbox.style.cssText = 'accent-color:var(--accent);cursor:pointer;';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'objective-input';
        input.placeholder = 'Objective text...';
        input.style.cssText = 'flex:1;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-objective';
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'padding:2px 6px;font-size:0.6rem;';

        removeBtn.addEventListener('click', function() {
            if (container.children.length > 1) {
                row.remove();
            } else {
                showNotification('You need at least one objective.', 'error');
            }
        });

        row.appendChild(checkbox);
        row.appendChild(input);
        row.appendChild(removeBtn);
        container.appendChild(row);
    }

    function closeMissionForm() {
        var modal = document.getElementById('mission-form-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // MISSION HANDLERS
    // ============================================================

    function deleteMissionHandler(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        showConfirmation('Delete "' + mission.title + '" permanently? This action cannot be undone.')
            .then(function(confirmed) {
                if (confirmed) {
                    var success = persistOperation('deleteMission', function() {
                        return Core.deleteMission(id);
                    }, function() {
                        renderMissionList(document.getElementById('tab-missions'));
                        closeMissionDetail();
                    });
                    if (!success) {
                        showNotification('Failed to delete mission.', 'error');
                    }
                }
            })
            .catch(function() {
                // Ignore errors from confirmation
            });
    }

    function completeMissionHandler(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        var incompleteObjectives = 0;
        if (Array.isArray(mission.objectives)) {
            incompleteObjectives = mission.objectives.filter(function(o) {
                return o && !o.done;
            }).length;
        }

        var message = 'Complete "' + mission.title + '"';
        if (incompleteObjectives > 0) {
            message += '\n\nWarning: ' + incompleteObjectives + ' objective(s) are not completed.';
        }
        message += '\n\nContinue?';

        showConfirmation(message)
            .then(function(confirmed) {
                if (confirmed) {
                    // Set all objectives to done
                    var objectives = Array.isArray(mission.objectives) ? mission.objectives.slice() : [];
                    for (var i = 0; i < objectives.length; i++) {
                        if (objectives[i]) {
                            objectives[i].done = true;
                        }
                    }

                    var success = persistOperation('completeMission', function() {
                        return Core.completeMission(id, objectives);
                    }, function() {
                        renderMissionList(document.getElementById('tab-missions'));
                        if (state.currentMissionId === normaliseId(id)) {
                            viewMission(id);
                        }
                    });
                    if (!success) {
                        showNotification('Failed to complete mission.', 'error');
                    }
                }
            })
            .catch(function() {
                // Ignore errors from confirmation
            });
    }

    function cancelMissionHandler(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        showConfirmation('Cancel "' + mission.title + '"? This will mark it as cancelled.')
            .then(function(confirmed) {
                if (confirmed) {
                    var success = persistOperation('cancelMission', function() {
                        return Core.cancelMission(id);
                    }, function() {
                        renderMissionList(document.getElementById('tab-missions'));
                        if (state.currentMissionId === normaliseId(id)) {
                            viewMission(id);
                        }
                    });
                    if (!success) {
                        showNotification('Failed to cancel mission.', 'error');
                    }
                }
            })
            .catch(function() {
                // Ignore errors from confirmation
            });
    }

    // ============================================================
    // OBJECTIVE HANDLERS
    // ============================================================

    function toggleObjective(missionId, index, done) {
        var mission = Core.getMission(missionId);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        if (!Array.isArray(mission.objectives) || index >= mission.objectives.length) {
            showNotification('Objective not found.', 'error');
            return;
        }

        var objectives = mission.objectives.slice();
        objectives[index] = Object.assign({}, objectives[index], { done: done });

        var success = persistOperation('updateMission', function() {
            return Core.updateMission(missionId, { objectives: objectives });
        }, function() {
            if (state.currentMissionId === normaliseId(missionId)) {
                viewMission(missionId);
            }
            renderMissionList(document.getElementById('tab-missions'));
        });

        if (!success) {
            showNotification('Failed to update objective.', 'error');
        }
    }

    function addObjective(missionId, text) {
        var mission = Core.getMission(missionId);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        var objectives = Array.isArray(mission.objectives) ? mission.objectives.slice() : [];
        objectives.push({ text: text, done: false });

        var success = persistOperation('updateMission', function() {
            return Core.updateMission(missionId, { objectives: objectives });
        }, function() {
            if (state.currentMissionId === normaliseId(missionId)) {
                viewMission(missionId);
            }
            renderMissionList(document.getElementById('tab-missions'));
        });

        if (!success) {
            showNotification('Failed to add objective.', 'error');
        }
    }

    // ============================================================
    // LIFECYCLE MANAGEMENT
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('missions', renderMissions);
    }

    // Listen for data ready
    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-missions');
        if (container && container.style.display !== 'none') {
            renderMissions(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'missions') {
            var container = document.getElementById('tab-missions');
            if (container) {
                renderMissions(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-missions');
            if (container && container.style.display !== 'none') {
                renderMissions(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderMissions = renderMissions;
    window.viewMission = viewMission;
    window.closeMissionDetail = closeMissionDetail;

    window.MissionsUI = {
        render: renderMissions,
        viewMission: viewMission,
        closeMissionDetail: closeMissionDetail,
        showMissionForm: showMissionForm,
        renderMissionList: renderMissionList
    };

})();
