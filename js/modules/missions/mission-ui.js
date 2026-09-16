/**
 * js/modules/missions/mission-ui.js - Mission UI Controller
 *
 * Path: js/modules/missions/mission-ui.js
 *
 * UI controller for the missions tab.
 *
 * RESPONSIBILITIES:
 *   - Own transient UI state (current filter, current mission id,
 *     which modal is open, pending input buffers).
 *   - Render via MissionRender from VMs produced by
 *     MissionAggregator.
 *   - Dispatch user actions from data-action attributes.
 *   - Call MissionCore mutations.
 *   - Refresh the view after a successful mutation.
 *   - Show notifications on success and failure.
 *   - Manage modal lifecycle (open, close, DOM cleanup).
 *
 * NOT RESPONSIBILITIES:
 *   - Domain rules. MissionRules owns them.
 *   - Domain validation. MissionSchema owns it.
 *   - Mutations. MissionCore owns them.
 *   - Projections. MissionAggregator owns them.
 *   - Reads. MissionQueries owns them.
 *   - Rendering. MissionRender owns it. This module never builds
 *     HTML by string concatenation.
 *   - Storage. Nothing here touches window.data.
 *
 * EVENT DELEGATION:
 *   One click listener on the container. One change listener. One
 *   submit listener. Every interactive element carries
 *   data-action, and the delegated handler reads it and dispatches.
 *   No per-element addEventListener for the mission UI itself.
 *   The only exceptions are the report and log modals, which have
 *   their own form submit handlers bound to their own forms.
 *
 * LISTENER LIFECYCLE:
 *   Every listener is registered through addSafeListener, which
 *   records { element, type, handler, options } in a module-level
 *   array. removeAllListeners walks that array and removes each
 *   entry. Calling renderMissions() removes the previous batch
 *   before installing a new one.
 *
 * MODAL LIFECYCLE:
 *   The shells are rendered once by MissionRender.renderContainer.
 *   The controller shows/hides them by toggling the `hidden`
 *   class on the shell element and writing content into the
 *   content host. Content is cleared on close so no stale DOM
 *   hangs around.
 *
 * MODAL CONTENT:
 *   Modal shells live inside the mission container. The mission
 *   container itself is replaced on each renderMissions() call, so
 *   the modal DOM is rebuilt from scratch. Any per-modal listeners
 *   registered through addSafeListener are cleaned up
 *   automatically by removeAllListeners at the top of
 *   renderMissions.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TabManager
 *   - window.NotificationSystem
 *   - window.MissionCore
 *   - window.MissionQueries
 *   - window.MissionAggregator
 *   - window.MissionRender
 */

(function() {
    'use strict';

    if (window.__missionUILoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var TabManager = window.TabManager;
    var NotificationSystem = window.NotificationSystem;
    var MissionCore = window.MissionCore;
    var MissionQueries = window.MissionQueries;
    var MissionAggregator = window.MissionAggregator;
    var MissionRender = window.MissionRender;

    var _missing = [];

    if (!TabManager || typeof TabManager.register !== 'function') {
        _missing.push('TabManager.register');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (!MissionCore) {
        _missing.push('MissionCore (module)');
    } else {
        var coreRequired = [
            'createMission',
            'updateMission',
            'archiveMission',
            'unarchiveMission',
            'setObjectiveDone',
            'addObjective',
            'removeObjective',
            'addSupportPersonnel',
            'removeSupportPersonnel',
            'addLog',
            'addReport',
            'updateReport',
            'removeReport',
            'completeMission',
            'cancelMission',
            'reactivateMission'
        ];
        for (var c = 0; c < coreRequired.length; c++) {
            if (typeof MissionCore[coreRequired[c]] !== 'function') {
                _missing.push('MissionCore.' + coreRequired[c]);
            }
        }
    }

    if (!MissionQueries || typeof MissionQueries.getMission !== 'function') {
        _missing.push('MissionQueries.getMission');
    }

    if (!MissionAggregator) {
        _missing.push('MissionAggregator (module)');
    } else {
        var aggRequired = [
            'getMissionListViewModel',
            'getMissionDetailViewModel',
            'getMissionFormViewModel',
            'getMissionStatisticsViewModel'
        ];
        for (var a = 0; a < aggRequired.length; a++) {
            if (typeof MissionAggregator[aggRequired[a]] !== 'function') {
                _missing.push('MissionAggregator.' + aggRequired[a]);
            }
        }
    }

    if (!MissionRender) {
        _missing.push('MissionRender (module)');
    } else {
        var renderRequired = [
            'renderContainer',
            'renderList',
            'renderDetail',
            'renderForm',
            'renderEmpty',
            'renderLoading'
        ];
        for (var r = 0; r < renderRequired.length; r++) {
            if (typeof MissionRender[renderRequired[r]] !== 'function') {
                _missing.push('MissionRender.' + renderRequired[r]);
            }
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionUI] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionUILoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        container: null,
        currentFilter: 'all',
        currentMissionId: null
    };

    var _listeners = [];

    // ============================================================
    // LISTENER LIFECYCLE
    // ============================================================

    function addSafeListener(element, type, handler, options) {
        if (!element) { return; }
        element.addEventListener(type, handler, options || false);
        _listeners.push({
            element: element,
            type: type,
            handler: handler,
            options: options || false
        });
    }

    function removeAllListeners() {
        for (var i = 0; i < _listeners.length; i++) {
            var entry = _listeners[i];
            try {
                entry.element.removeEventListener(
                    entry.type,
                    entry.handler,
                    entry.options
                );
            } catch (e) {
                // Ignore teardown errors.
            }
        }
        _listeners = [];
    }

    // ============================================================
    // NOTIFICATIONS
    // ============================================================

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // RENDER
    // ============================================================

    /**
     * Render the missions tab.
     *
     * @param {HTMLElement} container
     */
    function renderMissions(container) {
        if (!container) {
            container = document.getElementById('tab-missions');
        }
        if (!container) {
            return;
        }

        removeAllListeners();

        state.container = container;

        var listVM = MissionAggregator.getMissionListViewModel({
            filter: state.currentFilter
        });

        container.innerHTML = MissionRender.renderContainer({
            filter: state.currentFilter,
            counts: listVM.counts
        });

        renderListInto(container);

        bindContainerEvents(container);
    }

    /**
     * Re-render just the list. Called after mutations that affect
     * the list but not the open detail panel.
     */
    function renderListInto(container) {
        if (!container) {
            container = state.container;
        }
        if (!container) { return; }

        var listHost = container.querySelector('#missions-list');
        if (!listHost) { return; }

        var vm = MissionAggregator.getMissionListViewModel({
            filter: state.currentFilter
        });

        listHost.innerHTML = MissionRender.renderList(vm.missions);

        var totalEl = container.querySelector('#mission-count-total');
        if (totalEl) {
            totalEl.textContent = String(vm.counts.total || 0);
        }
        var readyEl = container.querySelector('#mission-count-ready');
        if (readyEl) {
            readyEl.textContent = String(vm.counts.readyForCompletion || 0);
        }
    }

    function refreshDetailIfOpen() {
        if (!state.container) { return; }
        if (!state.currentMissionId) { return; }

        var modal = state.container.querySelector('#mission-detail-modal');
        if (!modal) { return; }
        if (modal.classList.contains('hidden')) { return; }

        openDetailModal(state.currentMissionId);
    }

    // ============================================================
    // CONTAINER EVENTS
    // ============================================================

    function bindContainerEvents(container) {
        addSafeListener(container, 'click', handleContainerClick);
        addSafeListener(container, 'change', handleContainerChange);
    }

    function handleContainerChange(event) {
        var target = event.target;

        if (target.id === 'mission-filter') {
            state.currentFilter = target.value || 'all';
            renderMissions(state.container);
            return;
        }
    }

    function handleContainerClick(event) {
        var actionEl = event.target.closest('[data-action]');
        if (!actionEl) { return; }

        var action = actionEl.dataset.action;
        var missionId = actionEl.dataset.missionId || null;

        switch (action) {
            case 'mission-new':
                event.preventDefault();
                openFormModal(null);
                return;

            case 'mission-list-item':
                event.preventDefault();
                if (missionId) {
                    openDetailModal(missionId);
                }
                return;

            case 'mission-close-detail':
                event.preventDefault();
                closeDetailModal();
                return;

            case 'mission-close-form':
                event.preventDefault();
                closeFormModal();
                return;

            case 'mission-edit':
                event.preventDefault();
                openFormModal(missionId);
                return;

            case 'mission-archive':
                event.preventDefault();
                handleArchive(missionId);
                return;

            case 'mission-unarchive':
                event.preventDefault();
                handleUnarchive(missionId);
                return;

            case 'mission-complete':
                event.preventDefault();
                handleComplete(missionId);
                return;

            case 'mission-cancel':
                event.preventDefault();
                handleCancel(missionId);
                return;

            case 'mission-reactivate':
                event.preventDefault();
                handleReactivate(missionId);
                return;

            case 'mission-objective-toggle':
                event.preventDefault();
                handleObjectiveToggle(
                    missionId,
                    actionEl.dataset.objectiveIndex,
                    actionEl.checked === true
                );
                return;

            case 'mission-add-objective':
                event.preventDefault();
                handleAddObjective(missionId, actionEl);
                return;

            case 'mission-remove-objective':
                event.preventDefault();
                handleRemoveObjective(
                    missionId,
                    actionEl.dataset.objectiveIndex
                );
                return;

            case 'mission-add-support':
                event.preventDefault();
                handleAddSupport(missionId, actionEl);
                return;

            case 'mission-remove-support':
                event.preventDefault();
                handleRemoveSupport(
                    missionId,
                    actionEl.dataset.characterId
                );
                return;

            case 'mission-add-log':
                event.preventDefault();
                openLogModal(missionId);
                return;

            case 'mission-report-add':
                event.preventDefault();
                openReportFormModal(missionId, null);
                return;

            case 'mission-report-edit':
                event.preventDefault();
                openReportFormModal(
                    missionId,
                    actionEl.dataset.reportId
                );
                return;

            case 'mission-report-delete':
                event.preventDefault();
                handleReportDelete(
                    missionId,
                    actionEl.dataset.reportId
                );
                return;

            default:
                return;
        }
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    function showModal(modalEl) {
        if (!modalEl) { return; }
        modalEl.classList.remove('hidden');
    }

    function hideModal(modalEl) {
        if (!modalEl) { return; }
        modalEl.classList.add('hidden');
    }

    // ============================================================
    // DETAIL MODAL
    // ============================================================

    function openDetailModal(missionId) {
        if (!state.container || !missionId) { return; }

        var vm = MissionAggregator.getMissionDetailViewModel(missionId);
        if (!vm) {
            notify('Mission not found.', 'error');
            return;
        }

        state.currentMissionId = missionId;

        var modal = state.container.querySelector('#mission-detail-modal');
        var titleEl = state.container.querySelector('#mission-detail-title');
        var contentEl = state.container.querySelector(
            '#mission-detail-content'
        );

        if (!modal || !contentEl) { return; }

        if (titleEl) {
            titleEl.textContent = vm.title || 'Mission';
        }

        contentEl.innerHTML = MissionRender.renderDetail(vm);
        showModal(modal);
    }

    function closeDetailModal() {
        if (!state.container) { return; }

        var modal = state.container.querySelector('#mission-detail-modal');
        var contentEl = state.container.querySelector(
            '#mission-detail-content'
        );

        if (modal) { hideModal(modal); }
        if (contentEl) { contentEl.innerHTML = ''; }
        state.currentMissionId = null;
    }

    // ============================================================
    // FORM MODAL
    // ============================================================

    function openFormModal(editId) {
        if (!state.container) { return; }

        var vm = MissionAggregator.getMissionFormViewModel({
            editId: editId
        });

        if (!vm) {
            notify('Mission not found.', 'error');
            return;
        }

        var modal = state.container.querySelector('#mission-form-modal');
        var titleEl = state.container.querySelector('#mission-form-title');
        var contentEl = state.container.querySelector(
            '#mission-form-content'
        );

        if (!modal || !contentEl) { return; }

        if (titleEl) {
            titleEl.textContent = vm.isEdit
                ? 'Edit Mission'
                : 'Create Mission';
        }

        contentEl.innerHTML = MissionRender.renderForm(vm);
        showModal(modal);

        var form = contentEl.querySelector('#mission-form-inner');
        if (form) {
            addSafeListener(form, 'submit', function(event) {
                event.preventDefault();
                handleFormSubmit(form, editId);
            });
        }

        // Subtype select: when primary type changes, the options
        // change. We rebuild the subtype select in place.
        var primarySelect = contentEl.querySelector('#mission-primary-type');
        var subtypeSelect = contentEl.querySelector('#mission-subtype');
        if (primarySelect && subtypeSelect) {
            addSafeListener(primarySelect, 'change', function() {
                updateSubtypeOptions(primarySelect, subtypeSelect);
            });
        }
    }

    function closeFormModal() {
        if (!state.container) { return; }

        var modal = state.container.querySelector('#mission-form-modal');
        var contentEl = state.container.querySelector(
            '#mission-form-content'
        );

        if (modal) { hideModal(modal); }
        if (contentEl) { contentEl.innerHTML = ''; }
    }

    function updateSubtypeOptions(primarySelect, subtypeSelect) {
        var types = window.MissionConstants
            ? window.MissionConstants.getMissionTypes()
            : {};
        var type = types[primarySelect.value];

        subtypeSelect.innerHTML = '<option value="">Select...</option>';

        if (!type || !Array.isArray(type.subtypes)) { return; }

        for (var i = 0; i < type.subtypes.length; i++) {
            var st = type.subtypes[i];
            var opt = document.createElement('option');
            opt.value = st.id;
            opt.textContent = st.label;
            subtypeSelect.appendChild(opt);
        }
    }

    // ============================================================
    // FORM SUBMIT
    // ============================================================

    function handleFormSubmit(form, editId) {
        var data = collectFormData(form);
        if (!data) { return; }

        var promise = editId
            ? MissionCore.updateMission(editId, data)
            : MissionCore.createMission(data);

        handleMutation(promise, {
            onSuccess: function(result) {
                closeFormModal();
                refreshAfterMutation();
                var savedId = result && result.data && result.data.id
                    ? result.data.id
                    : editId;
                if (savedId && state.currentMissionId === savedId) {
                    openDetailModal(savedId);
                }
            }
        });
    }

    function collectFormData(form) {
        var title = readValue(form, '#mission-title').trim();
        if (!title) {
            notify('Mission title is required.', 'warning');
            return null;
        }

        var data = {
            title: title,
            description: readValue(form, '#mission-description'),
            year: readInteger(form, '#mission-year'),
            month: readInteger(form, '#mission-month'),
            day: readInteger(form, '#mission-day'),
            primaryType: readValue(form, '#mission-primary-type'),
            subtype: readValue(form, '#mission-subtype'),
            secondaryType: readValue(form, '#mission-secondary-type'),
            escalation: readValue(form, '#mission-escalation'),
            threatType: readValue(form, '#mission-threat-type'),
            environment: readValue(form, '#mission-environment'),
            location: readValue(form, '#mission-location'),
            duration: readValue(form, '#mission-duration'),
            difficulty: readValue(form, '#mission-difficulty'),
            priority: readValue(form, '#mission-priority'),
            basePay: readValue(form, '#mission-base-pay'),
            surchargePay: readValue(form, '#mission-surcharge-pay'),
            billing: readValue(form, '#mission-billing'),
            status: readValue(form, '#mission-status'),
            assignedTeamId: readValue(form, '#mission-team') || null,
            notes: readValue(form, '#mission-notes')
        };

        // Tags: comma-separated input becomes an array.
        var tagsRaw = readValue(form, '#mission-tags');
        data.tags = tagsRaw
            ? tagsRaw.split(',').map(function(s) { return s.trim(); })
                .filter(function(s) { return s !== ''; })
            : [];

        // Support personnel: read from the DOM rows the user built
        // via the "+ Add" button.
        data.supportPersonnel = readSupportPersonnelFromForm(form);

        // Objectives: read from the DOM rows the user built.
        data.objectives = readObjectivesFromForm(form);

        return data;
    }

    function readValue(form, selector) {
        var el = form.querySelector(selector);
        if (!el) { return ''; }
        if (typeof el.value !== 'string') { return ''; }
        return el.value;
    }

    function readInteger(form, selector) {
        var raw = readValue(form, selector);
        if (raw === '') { return null; }
        var n = parseInt(raw, 10);
        if (isNaN(n)) { return null; }
        return n;
    }

    function readSupportPersonnelFromForm(form) {
        var host = form.querySelector('#mission-support-list');
        if (!host) { return []; }
        var rows = host.querySelectorAll('.support-row');
        var ids = [];
        for (var i = 0; i < rows.length; i++) {
            var id = rows[i].dataset.characterId;
            if (id) { ids.push(id); }
        }
        return ids;
    }

    function readObjectivesFromForm(form) {
        var host = form.querySelector('#mission-objectives-list');
        if (!host) { return []; }
        var rows = host.querySelectorAll('.objective-row');
        var objectives = [];
        for (var i = 0; i < rows.length; i++) {
            var textEl = rows[i].querySelector('.objective-text-input');
            var checkEl = rows[i].querySelector('.objective-done');
            var text = textEl ? textEl.value.trim() : '';
            if (!text) { continue; }
            objectives.push({
                text: text,
                done: checkEl ? checkEl.checked === true : false
            });
        }
        return objectives;
    }

    // ============================================================
    // FORM-SIDE SUPPORT / OBJECTIVE ROW MANAGEMENT
    // ============================================================
    //
    // The + Support and + Objective buttons inside the form do not
    // call the domain. They append DOM rows that
    // collectFormData reads on submit. This keeps form state in
    // the DOM rather than duplicating it in module state.

    function handleAddSupport(missionId, actionEl) {
        // If we're inside a form, this is a form-side row addition.
        var form = actionEl.closest('#mission-form-inner');
        if (form) {
            appendSupportRowToForm(form);
            return;
        }

        // Otherwise it's the detail-panel version, which needs to
        // prompt the user. We do this via a simple modal prompt
        // pattern: open the form in edit mode.
        if (!missionId) { return; }
        openFormModal(missionId);
    }

    function appendSupportRowToForm(form) {
        var select = form.querySelector('#mission-support-select');
        var host = form.querySelector('#mission-support-list');
        if (!select || !host) { return; }

        var id = select.value;
        if (!id) {
            notify('Select a character first.', 'warning');
            return;
        }

        // Duplicate check.
        var existing = host.querySelectorAll('.support-row');
        for (var i = 0; i < existing.length; i++) {
            if (existing[i].dataset.characterId === id) {
                notify('Character is already assigned as support.', 'warning');
                return;
            }
        }

        var label = '';
        for (var o = 0; o < select.options.length; o++) {
            if (select.options[o].value === id) {
                label = select.options[o].textContent;
                break;
            }
        }

        // Remove empty-state placeholder if present.
        var empty = host.querySelector('.empty-state');
        if (empty) { empty.remove(); }

        var row = document.createElement('div');
        row.className = 'support-row';
        row.dataset.characterId = id;
        row.innerHTML =
            '<span class="support-name">' +
                escapeHtml(label || id) +
            '</span>' +
            '<button type="button" class="small danger" ' +
                'data-action="mission-remove-support" ' +
                'data-character-id="' +
                    escapeAttribute(id) + '">' +
                '×' +
            '</button>';

        host.appendChild(row);
        select.value = '';
    }

    function handleAddObjective(missionId, actionEl) {
        var form = actionEl.closest('#mission-form-inner');
        if (form) {
            appendObjectiveRowToForm(form);
            return;
        }

        if (!missionId) { return; }
        openFormModal(missionId);
    }

    function appendObjectiveRowToForm(form) {
        var input = form.querySelector('#mission-objective-input');
        var host = form.querySelector('#mission-objectives-list');
        if (!input || !host) { return; }

        var text = input.value.trim();
        if (!text) {
            notify('Objective text is required.', 'warning');
            return;
        }

        var empty = host.querySelector('.empty-state');
        if (empty) { empty.remove(); }

        var index = host.querySelectorAll('.objective-row').length;

        var row = document.createElement('div');
        row.className = 'objective-row';
        row.innerHTML =
            '<input type="checkbox" class="objective-done">' +
            '<input type="text" class="objective-text-input" ' +
                'value="' + escapeAttribute(text) + '">' +
            '<button type="button" class="small danger" ' +
                'data-action="mission-remove-objective" ' +
                'data-objective-index="' +
                    escapeAttribute(String(index)) + '">' +
                '×' +
            '</button>';

        host.appendChild(row);
        input.value = '';
    }

    // ============================================================
    // DOM-ONLY ROW REMOVAL (inside the form)
    // ============================================================

    function removeSupportRowFromForm(button) {
        var row = button.closest('.support-row');
        if (!row) { return; }
        var host = row.parentNode;
        row.remove();

        if (host && host.querySelectorAll('.support-row').length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state small';
            empty.textContent = 'No support assigned.';
            host.appendChild(empty);
        }
    }

    function removeObjectiveRowFromForm(button) {
        var row = button.closest('.objective-row');
        if (!row) { return; }
        var host = row.parentNode;
        row.remove();

        if (host && host.querySelectorAll('.objective-row').length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state small';
            empty.textContent = 'No objectives.';
            host.appendChild(empty);
        }
    }

    // ============================================================
    // DOMAIN MUTATIONS
    // ============================================================

    function handleArchive(missionId) {
        if (!missionId) { return; }
        if (!window.confirm('Archive this mission?')) { return; }

        handleMutation(MissionCore.archiveMission(missionId), {
            onSuccess: function() {
                closeDetailModal();
                refreshAfterMutation();
            }
        });
    }

    function handleUnarchive(missionId) {
        if (!missionId) { return; }
        if (!window.confirm('Unarchive this mission?')) { return; }

        handleMutation(MissionCore.unarchiveMission(missionId), {
            onSuccess: function() {
                openDetailModal(missionId);
                refreshAfterMutation();
            }
        });
    }

    function handleComplete(missionId) {
        if (!missionId) { return; }
        if (!window.confirm('Mark this mission as completed?')) { return; }

        handleMutation(MissionCore.completeMission(missionId), {
            onSuccess: function() {
                openDetailModal(missionId);
                refreshAfterMutation();
            }
        });
    }

    function handleCancel(missionId) {
        if (!missionId) { return; }
        if (!window.confirm('Cancel this mission?')) { return; }

        handleMutation(MissionCore.cancelMission(missionId), {
            onSuccess: function() {
                openDetailModal(missionId);
                refreshAfterMutation();
            }
        });
    }

    function handleReactivate(missionId) {
        if (!missionId) { return; }
        if (!window.confirm('Reactivate this mission?')) { return; }

        handleMutation(MissionCore.reactivateMission(missionId), {
            onSuccess: function() {
                openDetailModal(missionId);
                refreshAfterMutation();
            }
        });
    }

    function handleObjectiveToggle(missionId, indexStr, done) {
        if (!missionId) { return; }
        var index = parseInt(indexStr, 10);
        if (isNaN(index) || index < 0) { return; }

        handleMutation(MissionCore.setObjectiveDone(missionId, index, done), {
            onSuccess: function() {
                openDetailModal(missionId);
                refreshAfterMutation();
            }
        });
    }

    function handleRemoveObjective(missionId, indexStr) {
        if (!missionId) { return; }

        // Detail-panel path: missionId is set, index is a number.
        var index = parseInt(indexStr, 10);
        if (!isNaN(index) && missionId) {
            var detailModal = state.container
                ? state.container.querySelector('#mission-detail-modal')
                : null;
            var inDetail = detailModal &&
                !detailModal.classList.contains('hidden') &&
                state.currentMissionId === missionId;

            if (inDetail) {
                if (!window.confirm('Remove this objective?')) { return; }
                handleMutation(
                    MissionCore.removeObjective(missionId, index),
                    {
                        onSuccess: function() {
                            openDetailModal(missionId);
                            refreshAfterMutation();
                        }
                    }
                );
                return;
            }
        }

        // Form path: the button lives inside the form and just
        // removes the DOM row. The removal is not persisted until
        // the form is submitted.
        var btn = document.activeElement;
        if (btn && btn.classList &&
            btn.classList.contains('danger')) {
            removeObjectiveRowFromForm(btn);
        }
    }

    function handleAddSupport(missionId, actionEl) {
        // Form-side addition path is handled above. This branch is
        // never reached from the detail panel; the detail panel
        // opens the form for support management.
        var form = actionEl.closest('#mission-form-inner');
        if (form) {
            appendSupportRowToForm(form);
            return;
        }
        if (missionId) {
            openFormModal(missionId);
        }
    }

    function handleRemoveSupport(missionId, characterId) {
        if (!characterId) { return; }

        var actionEl = document.activeElement;
        var form = actionEl ? actionEl.closest('#mission-form-inner') : null;

        // If the button lives inside the form, remove the DOM row.
        if (form) {
            removeSupportRowFromForm(actionEl);
            return;
        }

        // Detail-panel path: missionId is required.
        if (!missionId) { return; }
        if (!window.confirm('Remove this support assignment?')) { return; }

        handleMutation(
            MissionCore.removeSupportPersonnel(missionId, characterId),
            {
                onSuccess: function() {
                    openDetailModal(missionId);
                    refreshAfterMutation();
                }
            }
        );
    }

    // ============================================================
    // LOG MODAL
    // ============================================================

    function openLogModal(missionId) {
        if (!missionId) { return; }
        var message = window.prompt('Log entry:');
        if (message === null) { return; }
        message = message.trim();
        if (!message) { return; }

        handleMutation(MissionCore.addLog(missionId, message), {
            onSuccess: function() {
                openDetailModal(missionId);
                refreshAfterMutation();
            }
        });
    }

    // ============================================================
    // REPORT MODAL
    // ============================================================

    function openReportFormModal(missionId, reportId) {
        if (!missionId) { return; }

        var existing = null;
        if (reportId) {
            var detailVM = MissionAggregator.getMissionDetailViewModel(
                missionId
            );
            if (!detailVM) { return; }
            for (var i = 0; i < detailVM.reports.length; i++) {
                if (detailVM.reports[i].id === reportId) {
                    existing = detailVM.reports[i];
                    break;
                }
            }
            if (!existing) {
                notify('Report not found.', 'error');
                return;
            }
        }

        var prompt = existing
            ? 'Edit report:'
            : 'New report:';
        var text = window.prompt(prompt, existing ? existing.text : '');
        if (text === null) { return; }
        text = text.trim();
        if (!text) {
            notify('Report text is required.', 'warning');
            return;
        }

        var promise;
        if (existing) {
            promise = MissionCore.updateReport(
                missionId,
                existing.id,
                text
            );
        } else {
            // Author is not passed; the domain defaults to a
            // redacted author for anonymous reports. Replace this
            // with a proper author picker when the UI is ready.
            promise = MissionCore.addReport(missionId, null, text);
        }

        handleMutation(promise, {
            onSuccess: function() {
                openDetailModal(missionId);
                refreshAfterMutation();
            }
        });
    }

    function handleReportDelete(missionId, reportId) {
        if (!missionId || !reportId) { return; }
        if (!window.confirm('Delete this report?')) { return; }

        handleMutation(MissionCore.removeReport(missionId, reportId), {
            onSuccess: function() {
                openDetailModal(missionId);
                refreshAfterMutation();
            }
        });
    }

    // ============================================================
    // MUTATION HANDLER
    // ============================================================

    function handleMutation(promise, options) {
        options = options || {};

        promise.then(function(result) {
            if (result && result.success) {
                if (typeof options.onSuccess === 'function') {
                    options.onSuccess(result);
                }
                return;
            }
            notify(
                result && result.message
                    ? result.message
                    : 'Operation failed.',
                'error'
            );
        }).catch(function(err) {
            console.warn('[MissionUI] Mutation threw:', err);
            notify(
                options.errorMessage || 'Operation failed.',
                'error'
            );
        });
    }

    // ============================================================
    // POST-MUTATION REFRESH
    // ============================================================

    function refreshAfterMutation() {
        if (!state.container) { return; }
        renderListInto(state.container);
        refreshDetailIfOpen();
    }

    // ============================================================
    // ESCAPING FOR DOM-BUILT ROWS
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (window.DomUtils &&
            typeof window.DomUtils.escapeAttribute === 'function') {
            return window.DomUtils.escapeAttribute(value);
        }
        return escapeHtml(value);
    }

    // ============================================================
    // LIFECYCLE
    // ============================================================

    function destroyMissions() {
        removeAllListeners();
        state.container = null;
        state.currentMissionId = null;
        state.currentFilter = 'all';
    }

    // ============================================================
    // REGISTER
    // ============================================================

    TabManager.register('missions', renderMissions);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderMissions = renderMissions;
    window.destroyMissions = destroyMissions;

    window.MissionUI = Object.freeze({
        render: renderMissions,
        destroy: destroyMissions
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionUI;
        var missing = [];

        if (typeof exports.render !== 'function') {
            missing.push('render');
        }
        if (typeof exports.destroy !== 'function') {
            missing.push('destroy');
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionUI] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
