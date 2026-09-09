/**
 * js/modules/missions/mission-ui.js - Mission UI Controller
 * Event wiring, modal management, user interactions for missions.
 * 
 * UI PHILOSOPHY:
 *   - UI is the boundary between user and domain
 *   - All mutations go through MissionCore
 *   - All reads go through MissionQueries (preferred) or MissionCore
 *   - All rendering goes through MissionRender
 *   - Persistence is owned by MissionCore/MutationPipeline (UI has NO persistence knowledge)
 *   - Event handlers use delegation with CURRENT mission resolution
 * 
 * PERSISTENCE CONTRACT:
 *   - UI does NOT call saveData() - this is handled by MutationPipeline
 *   - UI only calls MissionCore commands and waits for results
 *   - On success: refresh UI, show notification
 *   - On failure: show notification with error message
 *   - No optimistic updates that could diverge from persisted state
 * 
 * DEPENDENCIES:
 *   - window.MissionCore (required)
 *   - window.MissionRender (required)
 *   - window.MissionQueries (required)
 *   - window.MissionAggregator (required)
 *   - window.NotificationSystem (from notification.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.Modal (from modal.js) - optional, falls back to DOM modals
 * 
 * LOAD ORDER:
 *   - mission-schema.js (FIRST)
 *   - mission-queries.js
 *   - mission-core.js
 *   - mission-aggregator.js
 *   - mission-views.js
 *   - mission-render.js
 *   - mission-ui.js (LAST)
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__missionUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.MissionCore) {
        return;
    }

    if (!window.MissionRender) {
        return;
    }

    if (!window.MissionQueries) {
        return;
    }

    if (!window.MissionAggregator) {
        return;
    }

    if (!window.NotificationSystem || typeof window.NotificationSystem.notify !== 'function') {
        return;
    }

    if (!window.TabManager || typeof window.TabManager.register !== 'function') {
        return;
    }

    // Mark as loaded ONLY after all dependencies are confirmed
    window.__missionUILoaded = true;

    var Core = window.MissionCore;
    var Render = window.MissionRender;
    var Queries = window.MissionQueries;
    var Aggregator = window.MissionAggregator;
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
        currentFilter: 'all',
        isInitialized: false
    };

    var _eventListeners = [];
    var _container = null;

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
    // ID NORMALISATION
    // ============================================================

    function normaliseId(id) {
        if (Queries && typeof Queries.normaliseId === 'function') {
            return Queries.normaliseId(id);
        }
        if (id === null || id === undefined) {
            return null;
        }
        return String(id).trim();
    }

    // ============================================================
    // GET AVAILABLE TEAMS (delegates to Queries)
    // ============================================================

    function getAvailableTeams() {
        return Queries.getEligibleTeams ? Queries.getEligibleTeams() : [];
    }

    function getTeamName(teamId) {
        if (!teamId) {
            return 'Unassigned';
        }
        // Use Aggregator if available
        if (Aggregator && typeof Aggregator.resolveTeamName === 'function') {
            return Aggregator.resolveTeamName(teamId);
        }
        // Fallback to Queries
        if (Queries && typeof Queries.getTeamName === 'function') {
            return Queries.getTeamName(teamId);
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

            var target = e.target;

            // Toggle objective
            var checkbox = target.closest('.objective-item input[type="checkbox"]');
            if (checkbox) {
                var objIndex = parseInt(checkbox.dataset.index, 10);
                if (!isNaN(objIndex)) {
                    handleToggleObjective(missionId, objIndex, checkbox.checked);
                }
                return;
            }

            // Delete mission
            var deleteBtn = target.closest('#delete-mission-from-detail');
            if (deleteBtn) {
                handleDeleteMission(missionId);
                return;
            }

            // Edit mission
            var editBtn = target.closest('#edit-mission-from-detail');
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

            // View mission - click on the whole item or view button
            var item = target.closest('.mission-item');
            if (item && !target.closest('button')) {
                viewMission(item.dataset.id);
                return;
            }

            // Edit button
            var editBtn = target.closest('.edit-mission');
            if (editBtn) {
                e.preventDefault();
                showMissionForm(editBtn.dataset.id);
                return;
            }

            // Delete button
            var deleteBtn = target.closest('.delete-mission');
            if (deleteBtn) {
                e.preventDefault();
                handleDeleteMission(deleteBtn.dataset.id);
                return;
            }

            // Complete button
            var completeBtn = target.closest('.complete-mission');
            if (completeBtn) {
                e.preventDefault();
                handleCompleteMission(completeBtn.dataset.id);
                return;
            }

            // View button
            var viewBtn = target.closest('.view-mission');
            if (viewBtn) {
                e.preventDefault();
                viewMission(viewBtn.dataset.id);
                return;
            }
        });

        // Add mission button
        var addBtn = document.getElementById('add-mission-btn');
        if (addBtn && !addBtn._listener) {
            addBtn._listener = true;
            addSafeEventListener(addBtn, 'click', function() {
                showMissionForm();
            });
        }

        // Filter select
        var filterSelect = document.getElementById('mission-filter');
        if (filterSelect && !filterSelect._listener) {
            filterSelect._listener = true;
            addSafeEventListener(filterSelect, 'change', function() {
                state.currentFilter = this.value;
                renderMissionList();
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

        // Store container reference
        _container = container;

        // Remove existing listeners before rendering
        removeAllEventListeners();

        // Render container HTML
        container.innerHTML = Render.renderContainer();

        // Render mission list
        renderMissionList();

        // Setup modal close handlers
        setupModalCloseButton('mission-form-modal', closeMissionForm);
        setupModalCloseButton('mission-detail-modal', closeMissionDetail);
        setupModalOutsideClick('mission-form-modal', closeMissionForm);
        setupModalOutsideClick('mission-detail-modal', closeMissionDetail);

        state.isInitialized = true;
    }

    function renderMissionList() {
        var listContainer = _container ? _container.querySelector('#missions-list') : document.getElementById('missions-list');
        var countEl = _container ? _container.querySelector('#mission-count') : document.getElementById('mission-count');

        if (!listContainer) {
            return;
        }

        var filter = state.currentFilter || 'all';

        // Use Aggregator for view model
        var viewModel = Aggregator.getMissionListViewModel({ filter: filter });

        var html = Render.renderList(viewModel.missions);
        listContainer.innerHTML = html;

        if (countEl) {
            countEl.textContent = viewModel.filtered;
        }

        attachListEvents(listContainer);
    }

    function destroyMissions() {
        removeAllEventListeners();
        _container = null;
        state.isInitialized = false;
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    function viewMission(id) {
        // Use Aggregator for detail view model
        var viewModel = Aggregator.getMissionDetailViewModel(id);
        if (!viewModel) {
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
            title.textContent = viewModel.mission.title;
        }

        var content = document.getElementById('mission-detail-content');
        if (!content) {
            return;
        }

        var html = Render.renderDetail(viewModel.mission);
        content.innerHTML = html;

        modal.dataset.missionId = id;
        modal.classList.remove('hidden');

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

        // Use Aggregator for form view model
        var viewModel = Aggregator.getMissionFormViewModel({ editId: editId });
        var mission = viewModel.mission;

        if (editId && !mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        title.textContent = mission ? 'Edit Mission' : 'Create Mission';

        var formModel = {
            mission: mission,
            teams: viewModel.teams,
            characters: viewModel.characters,
            supportIds: viewModel.supportIds,
            difficulties: VALID_DIFFICULTIES,
            priorities: VALID_PRIORITIES,
            statuses: VALID_STATUSES,
            defaultYear: viewModel.defaultYear,
            defaultMonth: viewModel.defaultMonth,
            defaultDay: viewModel.defaultDay
        };

        var html = Render.renderForm(formModel);
        content.innerHTML = html;

        modal.dataset.editId = editId || '';
        modal.classList.remove('hidden');

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

        // Populate support personnel
        var supportList = form.querySelector('#mission-support-list');
        if (supportList && mission && Array.isArray(mission.supportPersonnel)) {
            renderSupportList(supportList, mission.supportPersonnel);
        }

        // Populate objectives
        var objectivesList = form.querySelector('#mission-objectives-list');
        if (objectivesList && mission && Array.isArray(mission.objectives)) {
            renderObjectivesList(objectivesList, mission.objectives);
        }

        // Form submit
        addSafeEventListener(form, 'submit', function(e) {
            e.preventDefault();
            handleFormSubmit(modal);
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

        // Add support button
        var addSupportBtn = form.querySelector('#add-support-btn');
        if (addSupportBtn) {
            addSafeEventListener(addSupportBtn, 'click', function() {
                var select = form.querySelector('#mission-support-select');
                var list = form.querySelector('#mission-support-list');
                if (select && list && select.value) {
                    addSupportRow(list, select.value);
                    select.value = '';
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

    function populateTeamSelect(select, currentValue) {
        var teams = getAvailableTeams();

        select.innerHTML = '<option value="">Unassigned</option>';

        var sortedTeams = teams.slice();
        sortedTeams.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        for (var i = 0; i < sortedTeams.length; i++) {
            var team = sortedTeams[i];
            var option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name || 'Unknown Team';
            if (currentValue && String(team.id) === String(currentValue)) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        if (currentValue) {
            var exists = false;
            for (var j = 0; j < select.options.length; j++) {
                if (select.options[j].value === currentValue) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                select.value = '';
            }
        }
    }

    function renderSupportList(container, supportIds) {
        container.innerHTML = '';

        if (!Array.isArray(supportIds) || supportIds.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No support personnel assigned.';
            container.appendChild(empty);
            return;
        }

        for (var i = 0; i < supportIds.length; i++) {
            var id = supportIds[i];
            var name = getCharacterDisplayName(id);

            var row = document.createElement('div');
            row.className = 'support-row';
            row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 4px;border-bottom:1px solid var(--border-soft);';

            var nameSpan = document.createElement('span');
            nameSpan.textContent = name || 'Unknown';
            nameSpan.style.cssText = 'font-size:0.75rem;';

            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'small danger remove-support';
            removeBtn.textContent = 'x';
            removeBtn.dataset.id = id;
            removeBtn.style.cssText = 'font-size:0.6rem;padding:0 4px;';

            addSafeEventListener(removeBtn, 'click', function(e) {
                var targetId = this.dataset.id;
                var list = this.closest('#mission-support-list');
                if (list && targetId) {
                    // Remove from DOM
                    var row = this.closest('.support-row');
                    if (row) {
                        row.remove();
                    }
                    // Update hidden state or form data
                }
            });

            row.appendChild(nameSpan);
            row.appendChild(removeBtn);
            container.appendChild(row);
        }
    }

    function addSupportRow(container, characterId) {
        // Check if already added
        var existing = container.querySelectorAll('.support-row');
        for (var i = 0; i < existing.length; i++) {
            var btn = existing[i].querySelector('.remove-support');
            if (btn && btn.dataset.id === characterId) {
                showNotification('Character already added.', 'warning');
                return;
            }
        }

        var name = getCharacterDisplayName(characterId);

        var row = document.createElement('div');
        row.className = 'support-row';
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:2px 4px;border-bottom:1px solid var(--border-soft);';

        var nameSpan = document.createElement('span');
        nameSpan.textContent = name || 'Unknown';
        nameSpan.style.cssText = 'font-size:0.75rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-support';
        removeBtn.textContent = 'x';
        removeBtn.dataset.id = characterId;
        removeBtn.style.cssText = 'font-size:0.6rem;padding:0 4px;';

        addSafeEventListener(removeBtn, 'click', function(e) {
            var targetId = this.dataset.id;
            var list = this.closest('#mission-support-list');
            if (list && targetId) {
                var row = this.closest('.support-row');
                if (row) {
                    row.remove();
                }
            }
        });

        row.appendChild(nameSpan);
        row.appendChild(removeBtn);

        // Remove empty state if present
        var empty = container.querySelector('.empty-state');
        if (empty) {
            empty.remove();
        }

        container.appendChild(row);
    }

    function renderObjectivesList(container, objectives) {
        container.innerHTML = '';

        if (!Array.isArray(objectives) || objectives.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No objectives defined.';
            container.appendChild(empty);
            return;
        }

        for (var i = 0; i < objectives.length; i++) {
            var obj = objectives[i];
            addObjectiveRow(container, obj.text, obj.done);
        }
    }

    function addObjectiveRow(container, text, done) {
        // Remove empty state if present
        var empty = container.querySelector('.empty-state');
        if (empty) {
            empty.remove();
        }

        var row = document.createElement('div');
        row.className = 'objective-row';
        row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'objective-done';
        checkbox.checked = done || false;
        checkbox.style.cssText = 'accent-color:var(--accent);';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'objective-input';
        input.value = text || '';
        input.placeholder = 'Objective text...';
        input.style.cssText = 'flex:1;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-objective';
        removeBtn.textContent = 'x';
        removeBtn.style.cssText = 'font-size:0.6rem;padding:0 4px;';

        addSafeEventListener(removeBtn, 'click', function() {
            var parent = this.closest('.objective-row');
            var container = parent ? parent.parentNode : null;
            if (parent) {
                parent.remove();
            }
            if (container && container.children.length === 0) {
                var empty = document.createElement('p');
                empty.className = 'empty-state';
                empty.textContent = 'No objectives defined.';
                container.appendChild(empty);
            }
        });

        row.appendChild(checkbox);
        row.appendChild(input);
        row.appendChild(removeBtn);
        container.appendChild(row);
    }

    function getCharacterDisplayName(charId) {
        if (window.CharacterQueries && typeof window.CharacterQueries.getDisplayName === 'function') {
            var char = window.CharacterQueries.getCharacterById(charId);
            if (char) {
                return window.CharacterQueries.getDisplayName(char);
            }
        }
        return 'Unknown';
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
    // FORM SUBMIT HANDLER - NO PERSISTENCE KNOWLEDGE
    // ============================================================

    function handleFormSubmit(modal) {
        var editId = modal.dataset.editId;
        var form = modal.querySelector('#mission-form-inner');

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
            basePay: form.querySelector('#mission-base-pay').value.trim(),
            surchargePay: form.querySelector('#mission-surcharge-pay').value.trim(),
            objectives: []
        };

        if (!data.title) {
            showNotification('Mission title is required.', 'warning');
            return;
        }

        // Collect objectives
        var objectiveRows = form.querySelectorAll('.objective-row');
        for (var i = 0; i < objectiveRows.length; i++) {
            var row = objectiveRows[i];
            var input = row.querySelector('.objective-input');
            var checkbox = row.querySelector('.objective-done');
            if (input && input.value.trim()) {
                data.objectives.push({
                    text: input.value.trim(),
                    done: checkbox ? checkbox.checked : false
                });
            }
        }

        if (data.objectives.length === 0) {
            showNotification('At least one objective is required.', 'warning');
            return;
        }

        // Collect support personnel
        var supportList = form.querySelector('#mission-support-list');
        var supportIds = [];
        if (supportList) {
            var removeBtns = supportList.querySelectorAll('.remove-support');
            for (var j = 0; j < removeBtns.length; j++) {
                var id = removeBtns[j].dataset.id;
                if (id) {
                    supportIds.push(id);
                }
            }
        }
        data.supportPersonnel = supportIds;

        // Collect tags
        var tagsInput = form.querySelector('#mission-tags');
        if (tagsInput && tagsInput.value.trim()) {
            data.tags = tagsInput.value.split(',').map(function(t) {
                return t.trim();
            }).filter(function(t) {
                return t !== '';
            });
        }

        // Collect date
        var yearInput = form.querySelector('#mission-year');
        var monthSelect = form.querySelector('#mission-month');
        var dayInput = form.querySelector('#mission-day');
        if (yearInput && yearInput.value) {
            data.year = parseInt(yearInput.value, 10);
        }
        if (monthSelect && monthSelect.value) {
            data.month = parseInt(monthSelect.value, 10);
        }
        if (dayInput && dayInput.value) {
            data.day = parseInt(dayInput.value, 10);
        }

        // Collect type fields
        var primaryType = form.querySelector('#mission-primary-type');
        var subtype = form.querySelector('#mission-subtype');
        var secondaryType = form.querySelector('#mission-secondary-type');
        var escalation = form.querySelector('#mission-escalation');
        var threatType = form.querySelector('#mission-threat-type');
        var environment = form.querySelector('#mission-environment');
        var billing = form.querySelector('#mission-billing');

        if (primaryType) data.primaryType = primaryType.value;
        if (subtype) data.subtype = subtype.value;
        if (secondaryType) data.secondaryType = secondaryType.value;
        if (escalation) data.escalation = escalation.value;
        if (threatType) data.threatType = threatType.value;
        if (environment) data.environment = environment.value;
        if (billing) data.billing = billing.value;

        // ---- CALL CORE (NO saveData) ----
        var promise;
        if (editId) {
            promise = Core.updateMission(editId, data);
        } else {
            promise = Core.createMission(data);
        }

        promise
            .then(function(result) {
                if (result && result.success) {
                    closeMissionForm();
                    renderMissionList();
                    if (editId && state.currentMissionId === normaliseId(editId)) {
                        viewMission(editId);
                    }
                    showNotification(
                        editId ? 'Mission updated successfully!' : 'Mission created successfully!',
                        'success'
                    );
                } else {
                    showNotification(
                        result && result.message ? result.message : 'Failed to save mission.',
                        'error'
                    );
                }
            })
            .catch(function(err) {
                showNotification('An unexpected error occurred: ' + err.message, 'error');
            });
    }

    // ============================================================
    // MISSION HANDLERS - NO PERSISTENCE KNOWLEDGE
    // ============================================================

    function handleDeleteMission(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        showConfirmation('Delete "' + mission.title + '" permanently? This action cannot be undone.')
            .then(function(confirmed) {
                if (confirmed) {
                    Core.deleteMission(id)
                        .then(function(result) {
                            if (result && result.success) {
                                renderMissionList();
                                closeMissionDetail();
                                showNotification('Mission deleted successfully!', 'success');
                            } else {
                                showNotification(
                                    result && result.message ? result.message : 'Failed to delete mission.',
                                    'error'
                                );
                            }
                        })
                        .catch(function(err) {
                            showNotification('An unexpected error occurred: ' + err.message, 'error');
                        });
                }
            })
            .catch(function() {
                // Ignore errors from confirmation
            });
    }

    function handleCompleteMission(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        // Check if ready for completion
        if (!Core.isReadyForCompletion(mission)) {
            var progress = Core.calculateProgress(mission.objectives);
            showNotification('Mission is ' + progress + '% complete. Complete all objectives first.', 'warning');
            return;
        }

        showConfirmation('Complete "' + mission.title + '"?')
            .then(function(confirmed) {
                if (confirmed) {
                    Core.completeMission(id)
                        .then(function(result) {
                            if (result && result.success) {
                                renderMissionList();
                                if (state.currentMissionId === normaliseId(id)) {
                                    viewMission(id);
                                }
                                showNotification('Mission completed successfully!', 'success');
                            } else {
                                showNotification(
                                    result && result.message ? result.message : 'Failed to complete mission.',
                                    'error'
                                );
                            }
                        })
                        .catch(function(err) {
                            showNotification('An unexpected error occurred: ' + err.message, 'error');
                        });
                }
            })
            .catch(function() {
                // Ignore errors from confirmation
            });
    }

    function handleCancelMission(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        showConfirmation('Cancel "' + mission.title + '"?')
            .then(function(confirmed) {
                if (confirmed) {
                    Core.cancelMission(id)
                        .then(function(result) {
                            if (result && result.success) {
                                renderMissionList();
                                if (state.currentMissionId === normaliseId(id)) {
                                    viewMission(id);
                                }
                                showNotification('Mission cancelled.', 'info');
                            } else {
                                showNotification(
                                    result && result.message ? result.message : 'Failed to cancel mission.',
                                    'error'
                                );
                            }
                        })
                        .catch(function(err) {
                            showNotification('An unexpected error occurred: ' + err.message, 'error');
                        });
                }
            })
            .catch(function() {
                // Ignore errors from confirmation
            });
    }

    function handleReactivateMission(id) {
        var mission = Core.getMission(id);
        if (!mission) {
            showNotification('Mission not found.', 'error');
            return;
        }

        showConfirmation('Reactivate "' + mission.title + '"?')
            .then(function(confirmed) {
                if (confirmed) {
                    Core.reactivateMission(id)
                        .then(function(result) {
                            if (result && result.success) {
                                renderMissionList();
                                if (state.currentMissionId === normaliseId(id)) {
                                    viewMission(id);
                                }
                                showNotification('Mission reactivated.', 'success');
                            } else {
                                showNotification(
                                    result && result.message ? result.message : 'Failed to reactivate mission.',
                                    'error'
                                );
                            }
                        })
                        .catch(function(err) {
                            showNotification('An unexpected error occurred: ' + err.message, 'error');
                        });
                }
            })
            .catch(function() {
                // Ignore errors from confirmation
            });
    }

    function handleToggleObjective(missionId, index, done) {
        Core.toggleObjective(missionId, index)
            .then(function(result) {
                if (result && result.success) {
                    if (state.currentMissionId === normaliseId(missionId)) {
                        viewMission(missionId);
                    }
                    renderMissionList();
                } else {
                    showNotification(
                        result && result.message ? result.message : 'Failed to toggle objective.',
                        'error'
                    );
                }
            })
            .catch(function(err) {
                showNotification('An unexpected error occurred: ' + err.message, 'error');
            });
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

    window.MissionUI = {
        render: renderMissions,
        viewMission: viewMission,
        closeMissionDetail: closeMissionDetail,
        showMissionForm: showMissionForm,
        renderMissionList: renderMissionList,
        destroy: destroyMissions,
        getState: function() { return state; }
    };

})();
