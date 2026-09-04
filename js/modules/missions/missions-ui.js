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
 *   - window.saveData (required)
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
    if (window.__missionsUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.MissionsCore) {
        return;
    }

    if (!window.MissionsRender) {
        return;
    }

    if (!window.MissionsQueries) {
        return;
    }

    if (typeof window.saveData !== 'function') {
        return;
    }

    if (!window.NotificationSystem || typeof window.NotificationSystem.notify !== 'function') {
        return;
    }

    if (!window.TabManager || typeof window.TabManager.register !== 'function') {
        return;
    }

    // Mark as loaded ONLY after all dependencies are confirmed
    window.__missionsUILoaded = true;

    var Core = window.MissionsCore;
    var Render = window.MissionsRender;
    var Queries = window.MissionsQueries;
    var NotificationSystem = window.NotificationSystem;
    var TabManager = window.TabManager;

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

    var _eventListeners = [];

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
    // NOTIFICATION SYSTEM
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
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
    // SAFE EVENT BINDING WITH CLEANUP
    // ============================================================

    function addSafeEventListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        _eventListeners = [];
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
                    if (typeof onError === 'function') {
                        onError(err);
                    }
                });

            if (typeof onSuccess === 'function') {
                onSuccess();
            }

            return true;
        } catch (err) {
            showNotification('Operation failed: ' + err.message, 'error');
            return false;
        }
    }

    // ============================================================
    // ID NORMALISATION
    // ============================================================

    function normaliseId(id) {
        return Queries.normaliseId(id);
    }

    // ============================================================
    // POPULATE SELECTORS
    // ============================================================

    function populateTeamSelect(select, currentValue) {
        if (!select) {
            return;
        }

        var data = window.data || {};
        var teams = Array.isArray(data.teams) ? data.teams : [];

        select.innerHTML = '<option value="">Unassigned</option>';

        var activeTeams = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && team.status === 'active') {
                activeTeams.push(team);
            }
        }

        activeTeams.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        for (var j = 0; j < activeTeams.length; j++) {
            var team2 = activeTeams[j];
            var option = document.createElement('option');
            option.value = team2.id;
            option.textContent = team2.name || 'Unknown Team';
            if (currentValue && String(team2.id) === String(currentValue)) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        if (currentValue) {
            var exists = false;
            for (var k = 0; k < select.options.length; k++) {
                if (select.options[k].value === currentValue) {
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
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && team.status === 'active') {
                result.push(team);
            }
        }
        return result;
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
        if (!modal) {
            return;
        }
        if (modal._outsideListener) {
            return;
        }
        modal._outsideListener = true;

        addSafeEventListener(modal, 'click', function(e) {
            if (e.target === modal) {
                closeFn();
            }
        });
    }

    function setupModalCloseButton(modalId, closeFn) {
        var modal = document.getElementById(modalId);
        if (!modal) {
            return;
        }

        var closeButtons = modal.querySelectorAll('.close-modal');
        for (var i = 0; i < closeButtons.length; i++) {
            var btn = closeButtons[i];
            addSafeEventListener(btn, 'click', function(e) {
                e.stopPropagation();
                closeFn();
            });
        }
    }

    // ============================================================
    // DETAIL EVENTS
    // ============================================================

    function attachDetailEvents(container) {
        if (container._detailEventsAttached) {
            return;
        }
        container._detailEventsAttached = true;

        addSafeEventListener(container, 'click', function(e) {
            var missionId = container.dataset.missionId;
            if (!missionId) {
                return;
            }

            var mission = Core.getMission(missionId);
            if (!mission) {
                return;
            }

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
                var input = container.querySelector('#new-objective-input');
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
        });
    }

    // ============================================================
    // LIST EVENTS
    // ============================================================

    function attachListEvents(container) {
        if (container._listEventsAttached) {
            return;
        }
        container._listEventsAttached = true;

        addSafeEventListener(container, 'click', function(e) {
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
            addSafeEventListener(addBtn, 'click', function() {
                showMissionForm();
            });
        }

        var filterSelect = document.getElementById('mission-filter');
        if (filterSelect && !filterSelect._listener) {
            filterSelect._listener = true;
            addSafeEventListener(filterSelect, 'change', function() {
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
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading mission data...</p>';
            return;
        }

        // Remove existing listeners before rendering
        removeAllEventListeners();

        container.innerHTML = Render.renderContainer();
        renderMissionList(container);
    }

    function renderMissionList(container) {
        var listContainer = container ? container.querySelector('#missions-list') : document.getElementById('missions-list');
        var countEl = container ? container.querySelector('#mission-count') : document.getElementById('mission-count');

        if (!listContainer) {
            return;
        }

        var filter = state.currentFilter || 'all';
        var missions = Core.getMissions();

        var filteredMissions = [];
        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (filter === 'all' || m.status === filter) {
                filteredMissions.push(m);
            }
        }

        if (countEl) {
            countEl.textContent = 'Total: ' + filteredMissions.length;
        }

        var html = Render.renderList(filteredMissions);
        listContainer.innerHTML = html;

        attachListEvents(listContainer);
    }

    function destroyMissions() {
        removeAllEventListeners();
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
        if (!modal) {
            return;
        }

        var title = document.getElementById('detail-mission-title');
        if (title) {
            title.textContent = mission.title;
        }

        var content = document.getElementById('mission-detail-content');
        if (!content) {
            return;
        }

        var html = Render.renderDetail(mission);
        content.innerHTML = html;

        modal.dataset.missionId = id;
        modal.classList.remove('hidden');

        setupModalOutsideClick('mission-detail-modal', closeMissionDetail);
        setupModalCloseButton('mission-detail-modal', closeMissionDetail);

        // Store missionId on content for event delegation
        content.dataset.missionId = id;

        attachDetailEvents(content);
    }

    function closeMissionDetail() {
        var modal = document.getElementById('mission-detail-modal');
        if (modal) {
            modal.classList.add('hidden');
            var content = document.getElementById('mission-detail-content');
            if (content) {
                content.innerHTML = '';
                content.dataset.missionId = '';
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

        if (!modal || !title || !content) {
            return;
        }

        var mission = editId ? Core.getMission(editId) : null;

        if (editId && !mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        title.textContent = mission ? 'Edit Mission' : 'Create Mission';

        var teams = getAvailableTeams();
        var characters = Queries.getCharacters();

        var html = Render.renderForm(mission, teams, characters);
        content.innerHTML = html;

        modal.dataset.editId = editId || '';
        modal.classList.remove('hidden');

        setupModalOutsideClick('mission-form-modal', closeMissionForm);
        setupModalCloseButton('mission-form-modal', closeMissionForm);

        attachFormEvents(modal, mission);
    }

    function attachFormEvents(modal, mission) {
        var form = modal.querySelector('#mission-form-inner');
        if (!form) {
            return;
        }

        // Populate team select
        var teamSelect = form.querySelector('#mission-team');
        if (teamSelect) {
            populateTeamSelect(teamSelect, mission ? mission.assignedTeamId : null);
        }

        // Form submit
        addSafeEventListener(form, 'submit', function(e) {
            e.preventDefault();

            var editId = modal.dataset.editId;

            var data = {
                title: form.querySelector('#mission-title').value.trim(),
                status: form.querySelector('#mission-status').value,
                priority: form.querySelector('#mission-priority').value,
                difficulty: form.querySelector('#mission-difficulty').value,
                assignedTeamId: form.querySelector('#mission-team').value || null,
                location: form.querySelector('#mission-location').value.trim(),
                duration: form.querySelector('#mission-duration').value.trim(),
                description: form.querySelector('#mission-description').value.trim(),
                notes: form.querySelector('#mission-notes').value.trim(),
                objectives: []
            };

            if (!data.title) {
                showNotification('Mission title is required.', 'warning');
                return;
            }

            // Collect objectives
            var objectiveInputs = form.querySelectorAll('.objective-input');
            for (var i = 0; i < objectiveInputs.length; i++) {
                var text = objectiveInputs[i].value.trim();
                if (text) {
                    data.objectives.push({ text: text, done: false });
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
                }, function(err) {
                    showNotification('Failed to persist mission update: ' + err.message, 'error');
                });
            } else {
                success = persistOperation('createMission', function() {
                    return Core.createMission(data);
                }, function() {
                    closeMissionForm();
                    renderMissionList(document.getElementById('tab-missions'));
                }, function(err) {
                    showNotification('Failed to persist new mission: ' + err.message, 'error');
                });
            }

            if (!success) {
                showNotification('Failed to save mission.', 'error');
            }
        });

        // Add objective button
        var addObjBtn = form.querySelector('#add-objective-btn');
        if (addObjBtn) {
            addSafeEventListener(addObjBtn, 'click', function() {
                var container = form.querySelector('#mission-objectives-list');
                if (container) {
                    addObjectiveRow(container);
                }
            });
        }

        // Cancel button
        var cancelBtn = form.querySelector('#cancel-mission-form');
        if (cancelBtn) {
            addSafeEventListener(cancelBtn, 'click', function() {
                closeMissionForm();
            });
        }
    }

    function addObjectiveRow(container) {
        var row = document.createElement('div');
        row.className = 'objective-row';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'objective-done';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'objective-input';
        input.placeholder = 'Objective text...';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-objective';
        removeBtn.textContent = 'x';

        addSafeEventListener(removeBtn, 'click', function() {
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
        if (modal) {
            modal.classList.add('hidden');
            var content = document.getElementById('mission-form-content');
            if (content) {
                content.innerHTML = '';
            }
        }
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
                    }, function(err) {
                        showNotification('Failed to persist mission deletion: ' + err.message, 'error');
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
            for (var i = 0; i < mission.objectives.length; i++) {
                var obj = mission.objectives[i];
                if (obj && !obj.done) {
                    incompleteObjectives++;
                }
            }
        }

        var message = 'Complete "' + mission.title + '"';
        if (incompleteObjectives > 0) {
            message += '\n\nWarning: ' + incompleteObjectives + ' objective(s) are not completed.';
        }
        message += '\n\nContinue?';

        showConfirmation(message)
            .then(function(confirmed) {
                if (confirmed) {
                    var objectives = Array.isArray(mission.objectives) ? mission.objectives.slice() : [];
                    for (var j = 0; j < objectives.length; j++) {
                        if (objectives[j]) {
                            objectives[j].done = true;
                        }
                    }

                    var success = persistOperation('completeMission', function() {
                        return Core.updateMission(id, { objectives: objectives, status: 'completed' });
                    }, function() {
                        renderMissionList(document.getElementById('tab-missions'));
                        if (state.currentMissionId === normaliseId(id)) {
                            viewMission(id);
                        }
                    }, function(err) {
                        showNotification('Failed to persist mission completion: ' + err.message, 'error');
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
        objectives[index] = {
            text: objectives[index].text,
            done: done
        };

        var success = persistOperation('updateMission', function() {
            return Core.updateMission(missionId, { objectives: objectives });
        }, function() {
            if (state.currentMissionId === normaliseId(missionId)) {
                viewMission(missionId);
            }
            renderMissionList(document.getElementById('tab-missions'));
        }, function(err) {
            showNotification('Failed to persist objective update: ' + err.message, 'error');
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
        }, function(err) {
            showNotification('Failed to persist objective addition: ' + err.message, 'error');
        });

        if (!success) {
            showNotification('Failed to add objective.', 'error');
        }
    }

    // ============================================================
    // LIFECYCLE MANAGEMENT
    // ============================================================

    // TabManager is the single source of truth for lifecycle
    TabManager.register('missions', renderMissions);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderMissions = renderMissions;
    window.viewMission = viewMission;
    window.closeMissionDetail = closeMissionDetail;
    window.destroyMissions = destroyMissions;

    window.MissionsUI = {
        render: renderMissions,
        viewMission: viewMission,
        closeMissionDetail: closeMissionDetail,
        showMissionForm: showMissionForm,
        renderMissionList: renderMissionList,
        destroy: destroyMissions
    };

})();
