/**
 * js/modules/missions/mission-ui.js - Mission UI Controller
 *
 * Path: js/modules/missions/mission-ui.js
 *
 * UI controller for the missions tab.
 *
 * RESPONSIBILITIES:
 *   - Own transient UI state (current filter, current mission id,
 *     which modal is open, report-form scratch state).
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
 * REPORT FORM MODAL (this revision):
 *   The report form is a modal, not a browser prompt. It carries
 *   an author select, a redacted checkbox, and a large textarea.
 *   The controller:
 *     - builds the VM from the mission and the loaded characters;
 *     - lazily creates the modal shell on first use;
 *     - binds change/input/keydown handlers to read the fields as
 *       the user types;
 *     - dispatches submit and cancel via the delegated click
 *       handler on the container.
 *
 *   State lives in a module-level `_reportForm` object. It is
 *   reset on every open and every close. Nothing about the report
 *   form outlives the modal.
 *
 * LOG ENTRY:
 *   The mission log entry still uses window.prompt. It is a
 *   single-line note, not prose; a full modal would be
 *   over-engineered for it. This is a deliberate asymmetry, not an
 *   oversight.
 *
 * EVENT DELEGATION:
 *   One click listener on the container. One change listener. One
 *   input listener. One keydown listener for the modal. Every
 *   interactive element carries data-action, and the delegated
 *   handler reads it and dispatches.
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
 * DETACHED CONTAINER GUARD:
 *   openFormModal and openDetailModal check that state.container
 *   is still attached to the document before querying for modal
 *   shells. A detached container means the tab's DOM was rebuilt
 *   without re-running renderMissions, or the tab was torn down
 *   but state was not cleared. Querying a detached container
 *   silently returns null, and the click produces no visible
 *   feedback; the guard turns that into a toast.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.NotificationSystem
 *   - window.MissionCore
 *   - window.MissionQueries
 *   - window.MissionAggregator
 *   - window.MissionRender
 *
 * DEPENDENCIES (LAZY, at click time):
 *   - window.MissionExport
 *   - window.CharacterQueries
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
            'renderReportFormModal',
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

    // Report form scratch state. Reset on open and on close.
    // Never outlives the modal.
    var _reportForm = {
        mode: 'create',       // 'create' | 'edit'
        missionId: null,
        missionTitle: '',
        reportId: null,       // null in create mode
        authorId: '',
        authorRedacted: false,
        text: ''
    };

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

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
    // CHARACTER OPTIONS FOR THE REPORT FORM
    // ============================================================
    //
    // The report form's author select is populated from the loaded
    // character store. When CharacterQueries is not available, the
    // select is empty and the user can only submit a redacted
    // report.

    function buildCharacterOptions() {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacters !== 'function') {
            return [];
        }

        var chars = [];
        try {
            chars = CharacterQueries.getCharacters() || [];
        } catch (e) {
            chars = [];
        }

        var options = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (!c || !c.id) { continue; }
            var name = c.id;
            try {
                if (typeof CharacterQueries.getDisplayName === 'function') {
                    name = CharacterQueries.getDisplayName(c) || c.id;
                }
            } catch (e) {
                name = c.id;
            }
            options.push({
                id: String(c.id),
                name: String(name)
            });
        }

        options.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return options;
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

        ensureReportModalShell(container);

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
    // REPORT MODAL SHELL
    // ============================================================
    //
    // The report modal is created once per render and reused. Its
    // content is re-rendered every time it opens. Emitted lazily
    // because MissionRender.renderContainer does not know about it;
    // the controller owns its shell.

    function ensureReportModalShell(container) {
        if (!container) { return; }

        var existing = container.querySelector(
            '#mission-report-modal'
        );
        if (existing) { return; }

        var shell = document.createElement('div');
        shell.id = 'mission-report-modal';
        shell.className = 'modal hidden';

        var content = document.createElement('div');
        content.className = 'modal-content modal-report-content';
        shell.appendChild(content);

        container.appendChild(shell);
    }

    // ============================================================
    // CONTAINER EVENTS
    // ============================================================

    function bindContainerEvents(container) {
        addSafeListener(container, 'click', handleContainerClick);
        addSafeListener(container, 'change', handleContainerChange);
        addSafeListener(container, 'input', handleContainerInput);
        addSafeListener(container, 'keydown', handleContainerKeydown);
    }

    function handleContainerChange(event) {
        var target = event.target;

        if (target.id === 'mission-filter') {
            state.currentFilter = target.value || 'all';
            renderMissions(state.container);
            return;
        }

        // Report form: author select, redacted checkbox.
        if (target.id === 'mission-report-author') {
            _reportForm.authorId = String(target.value || '');
            return;
        }
        if (target.id === 'mission-report-redacted') {
            _reportForm.authorRedacted = target.checked === true;
            var authorEl = state.container
                ? state.container.querySelector(
                    '#mission-report-author'
                )
                : null;
            if (authorEl) {
                authorEl.disabled = _reportForm.authorRedacted;
            }
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

        if (target.id === 'mission-report-text') {
            _reportForm.text = String(target.value || '');
            return;
        }

        if (isDateField(target)) {
            handleDateFieldChange(target);
        }
    }

    function handleContainerKeydown(event) {
        var target = event.target;
        if (!target) { return; }

        // Ctrl / Cmd + Enter from the report textarea submits.
        if (target.id === 'mission-report-text' &&
            (event.ctrlKey || event.metaKey) &&
            event.key === 'Enter') {
            event.preventDefault();
            handleReportSubmit();
            return;
        }

        // Escape closes the open modals.
        if (event.key === 'Escape') {
            var reportModal = state.container
                ? state.container.querySelector(
                    '#mission-report-modal'
                )
                : null;
            if (reportModal &&
                !reportModal.classList.contains('hidden')) {
                event.preventDefault();
                closeReportModal();
                return;
            }
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

            case 'mission-export':
                event.preventDefault();
                handleExport(missionId);
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

            case 'mission-report-submit':
                event.preventDefault();
                handleReportSubmit();
                return;

            case 'mission-report-cancel':
                event.preventDefault();
                closeReportModal();
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

    /**
     * Export a single mission as a plain-text report.
     *
     * Synchronous through to the download. MissionExport builds
     * the report from the mission record and triggers a Blob
     * download in the same tick. No pipeline, no state change, no
     * refresh — the modal stays open and the mission is untouched.
     */
    function handleExport(missionId) {
        if (!missionId) { return; }

        var Exporter = window.MissionExport;
        if (!Exporter ||
            typeof Exporter.exportMission !== 'function') {
            notify(
                'Mission export is not available. Check that ' +
                'mission-export.js is loaded.',
                'error'
            );
            return;
        }

        var result;
        try {
            result = Exporter.exportMission(missionId);
        } catch (err) {
            console.warn(
                '[MissionUI] MissionExport.exportMission threw:',
                err
            );
            notify(
                'Mission export failed: ' +
                (err && err.message ? err.message : String(err)),
                'error'
            );
            return;
        }

        if (result && result.exported) {
            notify(
                'Mission exported: ' + result.filename,
                'success'
            );
            return;
        }

        notify(
            'Mission export failed: ' +
                ((result && result.error) || 'Unknown error'),
            'error'
        );
    }

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
    //
    // Log entries are single-line notes. A window.prompt is
    // adequate for them. The report form is the module that needed
    // a real modal; a log entry does not.

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
    // REPORT FORM MODAL
    // ============================================================
    //
    // The report form is a proper modal: author select, redacted
    // checkbox, large textarea. See the file header for the
    // rationale.

    function openReportFormModal(missionId, reportId) {
        if (!missionId) { return; }

        if (!isContainerAttached()) {
            console.warn(
                '[MissionUI] openReportFormModal: container is ' +
                'missing or detached.'
            );
            notifyContainerLost();
            return;
        }

        var mission = null;
        try {
            mission = MissionQueries.getMission(missionId);
        } catch (e) {
            mission = null;
        }
        if (!mission) {
            notify('Mission not found.', 'error');
            return;
        }

        // ---- Reset scratch state ----
        _reportForm.mode = reportId ? 'edit' : 'create';
        _reportForm.missionId = String(missionId);
        _reportForm.missionTitle = mission.title || 'Mission';
        _reportForm.reportId = reportId ? String(reportId) : null;
        _reportForm.authorId = '';
        _reportForm.authorRedacted = false;
        _reportForm.text = '';

        // ---- Edit mode: load the existing report ----
        if (reportId) {
            var existing = findReport(mission, reportId);
            if (!existing) {
                notify('Report not found.', 'error');
                return;
            }
            _reportForm.authorId = existing.authorId
                ? String(existing.authorId)
                : '';
            _reportForm.authorRedacted =
                existing.authorRedacted === true;
            _reportForm.text = existing.text || '';
        }

        // ---- Render into the shell ----
        var modal = state.container.querySelector(
            '#mission-report-modal'
        );
        if (!modal) {
            console.warn(
                '[MissionUI] openReportFormModal: report modal ' +
                'shell not found in container.'
            );
            notify('Could not open the report form.', 'error');
            return;
        }

        var contentEl = modal.querySelector(
            '.modal-report-content'
        );
        if (!contentEl) {
            contentEl = document.createElement('div');
            contentEl.className = 'modal-content modal-report-content';
            modal.appendChild(contentEl);
        }

        var vm = {
            mode: _reportForm.mode,
            missionId: _reportForm.missionId,
            missionTitle: _reportForm.missionTitle,
            reportId: _reportForm.reportId,
            authorId: _reportForm.authorId,
            authorRedacted: _reportForm.authorRedacted,
            text: _reportForm.text,
            characters: buildCharacterOptions()
        };

        contentEl.innerHTML =
            MissionRender.renderReportFormModal(vm);
        showModal(modal);

        // Focus the textarea on next tick. The select is not the
        // primary field; the text is.
        setTimeout(function() {
            var textEl = contentEl.querySelector(
                '#mission-report-text'
            );
            if (textEl && typeof textEl.focus === 'function') {
                try { textEl.focus(); } catch (e) {}
            }
        }, 50);
    }

    function findReport(mission, reportId) {
        if (!mission || !Array.isArray(mission.reports)) {
            return null;
        }
        var target = String(reportId);
        for (var i = 0; i < mission.reports.length; i++) {
            var r = mission.reports[i];
            if (r && String(r.id) === target) {
                return r;
            }
        }
        return null;
    }

    function closeReportModal() {
        if (!state.container) {
            resetReportForm();
            return;
        }

        var modal = state.container.querySelector(
            '#mission-report-modal'
        );
        var contentEl = modal
            ? modal.querySelector('.modal-report-content')
            : null;

        if (modal) { hideModal(modal); }
        if (contentEl) { contentEl.innerHTML = ''; }

        resetReportForm();
    }

    function resetReportForm() {
        _reportForm.mode = 'create';
        _reportForm.missionId = null;
        _reportForm.missionTitle = '';
        _reportForm.reportId = null;
        _reportForm.authorId = '';
        _reportForm.authorRedacted = false;
        _reportForm.text = '';
    }

    function setReportError(message) {
        if (!state.container) { return; }
        var modal = state.container.querySelector(
            '#mission-report-modal'
        );
        if (!modal) { return; }
        var errEl = modal.querySelector('#mission-report-error');
        if (!errEl) { return; }

        if (!message) {
            errEl.style.display = 'none';
            errEl.textContent = '';
            return;
        }
        errEl.textContent = message;
        errEl.style.display = 'block';
    }

    function handleReportSubmit() {
        if (!_reportForm.missionId) { return; }

        var text = String(_reportForm.text || '').trim();
        if (text === '') {
            setReportError('Report text is required.');
            return;
        }

        var authorId = _reportForm.authorRedacted
            ? null
            : (_reportForm.authorId || null);

        if (!_reportForm.authorRedacted && !authorId) {
            setReportError(
                'Select an author, or tick the redacted box to ' +
                'submit without attribution.'
            );
            return;
        }

        setReportError('');

        var promise;
        if (_reportForm.mode === 'edit' && _reportForm.reportId) {
            // updateReport only takes the text. The author and
            // redaction state are frozen at creation.
            promise = MissionCore.updateReport(
                _reportForm.missionId,
                _reportForm.reportId,
                text
            );
        } else {
            promise = MissionCore.addReport(
                _reportForm.missionId,
                authorId,
                text
            );
        }

        var missionId = _reportForm.missionId;

        handleMutation(promise, {
            onSuccess: function() {
                closeReportModal();
                openDetailModal(missionId);
                refreshAfterMutation();
            },
            errorMessage: 'Failed to save report.'
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
        resetReportForm();
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
