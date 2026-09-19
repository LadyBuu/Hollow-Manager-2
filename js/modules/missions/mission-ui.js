/**
 * js/modules/missions/mission-ui.js - Mission UI Controller
 *
 * Path: js/modules/missions/mission-ui.js
 *
 * UI controller for the missions tab.
 *
 * RESPONSIBILITIES:
 *   - Own transient UI state (current filter, current mission id,
 *     which modal is open).
 *   - Render via MissionRender from VMs produced by
 *     MissionAggregator.
 *   - Dispatch user actions from data-action attributes.
 *   - Call MissionCore mutations.
 *   - Refresh the view after a successful mutation.
 *   - Show notifications on success and failure.
 *   - Manage modal lifecycle (open, close, DOM cleanup).
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   Domain rules, validation, mutations, projections, reads, and
 *   rendering. Each of those lives in its own module
 *   (MissionRules, MissionSchema, MissionCore, MissionAggregator,
 *   MissionQueries, MissionRender respectively). This module
 *   orchestrates them.
 *
 * EVENT DELEGATION:
 *   One click listener on the container. One change listener. One
 *   submit listener. Every interactive element carries
 *   data-action, and the delegated handler reads it and dispatches.
 *   No per-element addEventListener for the mission UI itself.
 *
 * LISTENER LIFECYCLE:
 *   Every listener is registered through addSafeListener, which
 *   records { element, type, handler, options } in a module-level
 *   array. removeAllListeners walks that array and removes each
 *   entry. renderMissions removes the previous batch before
 *   installing a new one.
 *
 * CONTEXT DISCRIMINATION:
 *   Two classes of button share action names between the detail
 *   modal and the form modal: add/remove support, add/remove
 *   objective. The discriminator is the presence of a
 *   `data-mission-id` attribute on the button:
 *
 *     data-mission-id present -> the button belongs to the detail
 *                                modal; the action is a domain
 *                                mutation on an existing mission.
 *     data-mission-id absent  -> the button belongs to the form
 *                                modal; the action adds or removes
 *                                an unsaved DOM row.
 *
 *   The renderer guarantees this: detail-panel buttons always emit
 *   data-mission-id; form-panel buttons never do. Using the
 *   attribute rather than `document.activeElement` or
 *   `.closest('#mission-form-inner')` makes the discriminator
 *   stable against focus changes and against the form being
 *   rendered outside its current host id.
 *
 * DETACHED CONTAINER GUARD:
 *   openFormModal and openDetailModal check that state.container
 *   is still attached to the document before querying for modal
 *   shells. A detached container means the tab's DOM was rebuilt
 *   without re-running renderMissions, or the tab was torn down
 *   but state was not cleared. Querying a detached container
 *   silently returns null, and the click produces no visible
 *   feedback; the guard turns that into a toast.
 *
 * MODAL LIFECYCLE:
 *   The shells are rendered once by MissionRender.renderContainer.
 *   The controller shows/hides them by toggling the `hidden`
 *   class and writes content into the content host. Content is
 *   cleared on close so no stale DOM hangs around. The mission
 *   container is replaced on each renderMissions() call, so the
 *   modal DOM is rebuilt from scratch and any per-modal listeners
 *   registered through addSafeListener are cleaned up
 *   automatically by removeAllListeners at the top of
 *   renderMissions.
 *
 * MISSION LABEL:
 *   The form does not preview the mission label. On create, the
 *   form shows "Assigned on save"; on edit, it shows the current
 *   derived label. Neither is a form field. The controller has no
 *   label-preview listener.
 *
 * DATE FIELDS:
 *   The year / month / day inputs carry data-mission-*-field
 *   markers. When the user edits year, the controller resets
 *   month and day to 1 unless the user has already explicitly
 *   edited them. "Explicitly edited" is tracked per-field by a
 *   data-touched="true" attribute that the controller sets on the
 *   first input or change event on that field.
 *
 * DEPENDENCIES (MANDATORY):
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

    var NotificationSystem = window.NotificationSystem;
    var MissionCore = window.MissionCore;
    var MissionQueries = window.MissionQueries;
    var MissionAggregator = window.MissionAggregator;
    var MissionRender = window.MissionRender;

    var _missing = [];

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
    // CONTAINER HEALTH
    // ============================================================

    function isContainerAttached() {
        if (!state.container) { return false; }
        if (!document.body) { return false; }
        return document.body.contains(state.container);
    }

    function notifyContainerLost() {
        notify(
            'The mission view is out of sync. Please reload the tab.',
            'error'
        );
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

        // Guard the list VM build. A failure here must not prevent
        // the container's modal shells and the delegated listeners
        // from being installed; otherwise the tab renders a dead
        // button with no listener attached.
        var listVM;
        try {
            listVM = MissionAggregator.getMissionListViewModel({
                filter: state.currentFilter
            });
        } catch (e) {
            console.warn(
                '[MissionUI] getMissionListViewModel threw during render:',
                e
            );
            listVM = { missions: [], counts: {} };
        }

        container.innerHTML = MissionRender.renderContainer({
            filter: state.currentFilter,
            counts: listVM.counts || {}
        });

        try {
            renderListInto(container);
        } catch (e) {
            console.warn(
                '[MissionUI] renderListInto threw during render:',
                e
            );
        }

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
        addSafeListener(container, 'input', handleContainerInput);
    }

    function handleContainerChange(event) {
        var target = event.target;

        if (target.id === 'mission-filter') {
            state.currentFilter = target.value || 'all';
            renderMissions(state.container);
            return;
        }

        // The year / month / day inputs are handled on 'input' for
        // live typing; 'change' covers paste-and-blur and
        // programmatic set. Both handlers call the same logic.
        if (isDateField(target)) {
            handleDateFieldChange(target);
            return;
        }
    }

    function handleContainerInput(event) {
        var target = event.target;
        if (isDateField(target)) {
            handleDateFieldChange(target);
        }
    }

    function isDateField(el) {
        if (!el || !el.dataset) { return false; }
        return el.dataset.missionYearField === 'true' ||
               el.dataset.missionMonthField === 'true' ||
               el.dataset.missionDayField === 'true';
    }

    /**
     * Called on every input / change of a date field.
     *
     * Two jobs:
     *   1. Mark month and day as touched the first time the user
     *      edits them, so a later year change does not overwrite
     *      their explicit value.
     *   2. When the year field changes, reset untouched month and
     *      day to 1.
     *
     * Year itself is not marked as touched; there is no scenario
     * in which resetting year is desirable.
     */
    function handleDateFieldChange(el) {
        if (el.dataset.missionMonthField === 'true' ||
            el.dataset.missionDayField === 'true') {
            el.dataset.touched = 'true';
            return;
        }

        if (el.dataset.missionYearField !== 'true') {
            return;
        }

        var form = el.closest('form');
        if (!form) { return; }

        var monthEl = form.querySelector('[data-mission-month-field="true"]');
        var dayEl = form.querySelector('[data-mission-day-field="true"]');

        if (monthEl && monthEl.dataset.touched !== 'true') {
            monthEl.value = '1';
        }
        if (dayEl && dayEl.dataset.touched !== 'true') {
            dayEl.value = '1';
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
                    actionEl.dataset.objectiveIndex,
                    actionEl
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
                    actionEl.dataset.characterId,
                    actionEl
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
        if (!missionId) { return; }

        if (!isContainerAttached()) {
            console.warn(
                '[MissionUI] openDetailModal: container is missing or detached.'
            );
            notifyContainerLost();
            return;
        }

        var vm = null;
        try {
            vm = MissionAggregator.getMissionDetailViewModel(missionId);
        } catch (e) {
            console.warn(
                '[MissionUI] getMissionDetailViewModel threw:',
                e
            );
            vm = null;
        }

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

        if (!modal || !contentEl) {
            console.warn(
                '[MissionUI] openDetailModal: modal shell not found in container.'
            );
            notify('Could not open the mission detail panel.', 'error');
            return;
        }

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
        if (!isContainerAttached()) {
            console.warn(
                '[MissionUI] openFormModal: container is missing or detached.'
            );
            notifyContainerLost();
            return;
        }

        var vm = null;
        try {
            vm = MissionAggregator.getMissionFormViewModel({
                editId: editId
            });
        } catch (e) {
            console.warn(
                '[MissionUI] getMissionFormViewModel threw:',
                e
            );
            vm = null;
        }

        if (!vm) {
            notify('Could not prepare the mission form.', 'error');
            return;
        }

        var modal = state.container.querySelector('#mission-form-modal');
        var titleEl = state.container.querySelector('#mission-form-title');
        var contentEl = state.container.querySelector(
            '#mission-form-content'
        );

        if (!modal || !contentEl) {
            console.warn(
                '[MissionUI] openFormModal: modal shell not found in container.'
            );
            notify('Could not open the mission form.', 'error');
            return;
        }

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

        subtypeSelect.innerHTML = '';

        if (!type || !Array.isArray(type.subtypes) ||
            type.subtypes.length === 0) {
            var placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.textContent = type
                ? '(no subtypes for this category)'
                : '(select a category first)';
            subtypeSelect.appendChild(placeholder);
            return;
        }

        var initial = document.createElement('option');
        initial.value = '';
        initial.textContent = 'Select...';
        subtypeSelect.appendChild(initial);

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

        var tagsRaw = readValue(form, '#mission-tags');
        data.tags = tagsRaw
            ? tagsRaw.split(',').map(function(s) { return s.trim(); })
                .filter(function(s) { return s !== ''; })
            : [];

        data.supportPersonnel = readSupportPersonnelFromForm(form);
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
    // call the domain. They append DOM rows that collectFormData
    // reads on submit. Form state lives in the DOM.

    function appendSupportRowToForm(form) {
        var select = form.querySelector('#mission-support-select');
        var host = form.querySelector('#mission-support-list');
        if (!select || !host) { return; }

        var id = select.value;
        if (!id) {
            notify('Select a character first.', 'warning');
            return;
        }

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

    /**
     * Handle the remove-objective action.
     *
     * The button carries data-mission-id when it belongs to the
     * detail panel (removes a persisted objective) and omits it
     * when it belongs to the form's objective list (removes an
     * unsaved DOM row).
     */
    function handleRemoveObjective(missionId, indexStr, actionEl) {
        if (missionId) {
            var index = parseInt(indexStr, 10);
            if (isNaN(index) || index < 0) { return; }
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

        if (actionEl) {
            removeObjectiveRowFromForm(actionEl);
        }
    }

    /**
     * Handle the add-objective action.
     *
     * With a mission-id: opens the form in edit mode, where the
     * user can add an objective and save.
     *
     * Without a mission-id: appends a DOM row to the form's
     * objective list.
     */
    function handleAddObjective(missionId, actionEl) {
        if (!missionId) {
            var form = actionEl && actionEl.closest
                ? actionEl.closest('form')
                : null;
            if (form) {
                appendObjectiveRowToForm(form);
            }
            return;
        }

        openFormModal(missionId);
    }

    /**
     * Handle the add-support action.
     *
     * With a mission-id: opens the form in edit mode.
     * Without a mission-id: appends a DOM row to the form's
     * support list.
     */
    function handleAddSupport(missionId, actionEl) {
        if (!missionId) {
            var form = actionEl && actionEl.closest
                ? actionEl.closest('form')
                : null;
            if (form) {
                appendSupportRowToForm(form);
            }
            return;
        }

        openFormModal(missionId);
    }

    /**
     * Handle the remove-support action.
     *
     * The button carries data-mission-id in the detail panel and
     * omits it in the form. That presence is the discriminator:
     * detail-panel removals go through the domain; form-panel
     * removals drop the DOM row.
     */
    function handleRemoveSupport(missionId, characterId, actionEl) {
        if (!characterId) { return; }

        if (!missionId) {
            if (actionEl) {
                removeSupportRowFromForm(actionEl);
            }
            return;
        }

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
    // EXPOSE
    // ============================================================
    //
    // This module does NOT register with TabManager. Registration
    // is owned by modules/missions/index.js.

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