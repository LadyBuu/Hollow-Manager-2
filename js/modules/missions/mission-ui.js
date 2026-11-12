/**
 * js/modules/missions/mission-ui.js - Mission UI Controller
 *
 * Path: js/modules/missions/mission-ui.js
 *
 * UI controller for the missions tab.
 *
 * RESPONSIBILITIES:
 *   - Own transient UI state (current filter, current mission id,
 *     which modal is open, report-form scratch state, export
 *     picker state, import modal state, form scratch state).
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
 * PARTICIPANTS (this revision):
 *   The mission form carries a participant editor that must work
 *   on BOTH create and edit. On edit, the stored mission record is
 *   authoritative until save; on create, there is no stored record
 *   at all. The panel therefore cannot read its inputs from
 *   MissionQueries or from a stored mission id.
 *
 *   Two sources feed the panel:
 *
 *     _formState.participants
 *       The STAGED participant list for the form currently open.
 *       Initialised from vm.mission.participants on edit, and
 *       [] on create. Every toggle, every rookie-picker return,
 *       and every form-side participant removal updates this
 *       array. It is the single source of truth for the panel
 *       and for the submit payload.
 *
 *     The live form DOM
 *       Team chips (#mission-teams-list) and the year input
 *       (#mission-year) are read on every panel refresh so the
 *       panel reflects the CURRENT team assignment and year, not
 *       the values that were in the record when the form opened.
 *
 *   The panel is rebuilt through
 *   MissionAggregator.getParticipantsViewModelFromFormState(...)
 *   and swapped in place (refreshParticipantsPanelFromFormState).
 *   The surrounding form — every other input, the team chips, the
 *   support rows, the objectives, the rookie chip list — is left
 *   byte-identical. Ticking a participant or returning from the
 *   picker must not discard an unsaved edit elsewhere in the form.
 *
 *   SUBMIT PATH:
 *   _formState.participants is included in collectFormData's
 *   payload, so MissionCore.createMission / updateMission receive
 *   them. On create this is the ONLY write path (no mission id
 *   exists while the user is ticking boxes). On edit, the
 *   immediate-write path (MissionCore.addParticipant /
 *   removeParticipant) is retained so the stored record stays
 *   consistent even if the user navigates away without saving;
 *   the submit payload then writes the staged array on top,
 *   which is a no-op when the two agree and a reconcile when they
 *   do not.
 *
 *   Two event wires:
 *
 *     mission-toggle-participant
 *       Fires from a team-member checkbox inside the form's
 *       participant panel. The controller reads characterId,
 *       teamId, and the checked flag, updates
 *       _formState.participants, and (on edit) also calls
 *       MissionCore.addParticipant / removeParticipant. The panel
 *       is re-rendered in place afterwards.
 *
 *     mission-open-rookie-picker
 *       Fires from the "+ Add Rookies" button on the form's
 *       participant panel, from the "Add Rookies" button on the
 *       detail panel's Participants section header, and from any
 *       other surface that needs it. When the picker closes, its
 *       onClose callback refreshes whichever surface launched it,
 *       AND resyncs _formState.participants from the store (the
 *       picker writes through MissionCore directly).
 *
 * REPORT FORM MODAL:
 *   The report form is a modal, not a browser prompt. It carries
 *   an author select, a redacted checkbox, and a large textarea.
 *
 * MULTIPLE TEAMS:
 *   The mission form's "Assign Team" control is a chip list. The
 *   controller reads the chips on submit and passes the array to
 *   MissionCore. Chip add and remove are DOM-only operations
 *   inside the form modal; only the submit writes to the store.
 *   Chip add and remove also refresh the participant panel, and
 *   chip remove prunes staged participants whose teamId matches
 *   the removed team.
 *
 * MISSION EXPORT:
 *   The detail panel's Export button opens a small format picker
 *   modal with two options: Text and JSON.
 *
 * MISSION IMPORT:
 *   A header button opens the import modal.
 *
 * ACTIVITY LOG HAS BEEN REMOVED:
 *   The mission detail panel used to carry a "+ Log Entry"
 *   button and the controller used to route it to a
 *   window.prompt that appended a free-text entry to the
 *   mission's `log` array. The mission log field has been
 *   retired. There is no log modal, no prompt, no
 *   `mission-add-log` action. The relevant handler and branch
 *   are gone.
 *
 * EVENT DELEGATION:
 *   One click listener on the container. One change listener. One
 *   input listener. One keydown listener. Every interactive
 *   element carries data-action, and the delegated handler reads
 *   it and dispatches.
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
 *   objective, add/remove team. The discriminator is the presence
 *   of a `data-mission-id` attribute on the button.
 *
 *   The participant toggles are form-only. They always carry
 *   `data-mission-id`.
 *
 *   The rookie-picker launch button is emitted from two surfaces
 *   (form panel and detail panel) and always carries
 *   `data-mission-id`. The controller routes both to the same
 *   opener.
 *
 * DETACHED CONTAINER GUARD:
 *   Modal openers check that state.container is still attached
 *   to the document before querying for modal shells.
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
 *   - window.MissionImport
 *   - window.MissionRookiePicker
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
            'addParticipant',
            'removeParticipant',
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
            'getMissionStatisticsViewModel',
            'getReportAuthorOptionsViewModel',
            'getParticipantsViewModel',
            'getParticipantsViewModelFromFormState'
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
    var _reportForm = {
        mode: 'create',
        missionId: null,
        missionTitle: '',
        reportId: null,
        authorId: '',
        authorRedacted: false,
        text: ''
    };

    // Export picker scratch state. Reset on open and on close.
    var _exportPicker = {
        missionId: null,
        missionTitle: '',
        format: 'text'
    };

    // Import modal scratch state. Reset on open and on close.
    var _importModal = {
        format: 'json'
    };

    // Form scratch state. The form modal is rebuilt from the VM on
    // open; the participant panel is re-rendered in place on a
    // team-member toggle, on a team-chip edit, on a year-field
    // edit, and when the rookie picker closes. The surrounding
    // form inputs are left untouched.
    //
    // editId:        the id of the mission being edited, or null
    //                on create.
    // participants:  the STAGED participant list for the form
    //                currently open. This is the single source of
    //                truth for the panel and for the submit
    //                payload. Initialised from
    //                vm.mission.participants on edit, [] on create.
    var _formState = {
        editId: null,
        participants: []
    };

    // Year-field debounce timer for the participant-panel refresh.
    // Editing the year can change which team members are active,
    // and users type the year a digit at a time; a short debounce
    // avoids re-rendering on every keystroke.
    var _yearRefreshTimer = null;
    var YEAR_REFRESH_DEBOUNCE_MS = 200;

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getMissionExport() {
        return window.MissionExport || null;
    }

    function getMissionImport() {
        return window.MissionImport || null;
    }

    function getMissionRookiePicker() {
        return window.MissionRookiePicker || null;
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
    // RENDER
    // ============================================================

    function renderMissions(container) {
        if (!container) {
            container = document.getElementById('tab-missions');
        }
        if (!container) {
            return;
        }

        removeAllListeners();

        state.container = container;

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

        // ---- Participant checkboxes (team-member rows) ----
        //
        // The change event fires when a checkbox is toggled. The
        // click event also fires; that is handled below. We react
        // only to the change event so the toggle runs once.
        //
        // Rookie toggles are the rookie picker's concern; the
        // form's rookie section is a chip list and does not carry
        // these attributes.
        if (target.dataset &&
            target.dataset.action === 'mission-toggle-participant') {
            handleParticipantToggle(target);
            return;
        }

        // ---- Report form ----
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

        // ---- Export picker ----
        if (target.name === 'mission-export-format') {
            _exportPicker.format = String(target.value || 'text');
            return;
        }

        // ---- Import modal ----
        if (target.name === 'mission-import-format') {
            _importModal.format = String(target.value || 'json');
            updateImportPlaceholder();
            return;
        }

        // ---- Form date fields ----
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

        // Ctrl / Cmd + Enter from the import textarea submits.
        if (target.id === 'mission-import-text' &&
            (event.ctrlKey || event.metaKey) &&
            event.key === 'Enter') {
            event.preventDefault();
            handleImportSubmit();
            return;
        }

        // Escape closes whichever modal is open.
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

            var exportModal = state.container
                ? state.container.querySelector(
                    '#mission-export-modal'
                )
                : null;
            if (exportModal &&
                !exportModal.classList.contains('hidden')) {
                event.preventDefault();
                closeExportModal();
                return;
            }

            var importModal = state.container
                ? state.container.querySelector(
                    '#mission-import-modal'
                )
                : null;
            if (importModal &&
                !importModal.classList.contains('hidden')) {
                event.preventDefault();
                closeImportModal();
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

        // Year changed: the participant panel's membership depends
        // on the mission year. Debounce a refresh so typing a
        // four-digit year does not trigger four rebuilds.
        scheduleParticipantsPanelRefresh();
    }

    function scheduleParticipantsPanelRefresh() {
        if (_yearRefreshTimer !== null) {
            clearTimeout(_yearRefreshTimer);
        }
        _yearRefreshTimer = setTimeout(function() {
            _yearRefreshTimer = null;
            refreshParticipantsPanelFromFormState();
        }, YEAR_REFRESH_DEBOUNCE_MS);
    }

    function cancelScheduledParticipantsPanelRefresh() {
        if (_yearRefreshTimer !== null) {
            clearTimeout(_yearRefreshTimer);
            _yearRefreshTimer = null;
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

            case 'mission-edit-participants':
                event.preventDefault();
                openFormModal(missionId);
                return;

            case 'mission-open-rookie-picker':
                event.preventDefault();
                handleOpenRookiePicker(missionId);
                return;

            case 'mission-export':
                event.preventDefault();
                openExportModal(missionId);
                return;

            case 'mission-export-cancel':
                event.preventDefault();
                closeExportModal();
                return;

            case 'mission-export-submit':
                event.preventDefault();
                handleExportSubmit();
                return;

            case 'mission-import':
                event.preventDefault();
                openImportModal();
                return;

            case 'mission-import-cancel':
                event.preventDefault();
                closeImportModal();
                return;

            case 'mission-import-submit':
                event.preventDefault();
                handleImportSubmit();
                return;

            case 'mission-import-file':
                event.preventDefault();
                openImportFilePicker();
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

            case 'mission-add-team':
                event.preventDefault();
                handleAddTeam(missionId, actionEl);
                return;

            case 'mission-remove-team':
                event.preventDefault();
                handleRemoveTeam(
                    missionId,
                    actionEl.dataset.teamId,
                    actionEl
                );
                return;

            case 'mission-remove-participant':
                event.preventDefault();
                handleRemoveParticipant(
                    missionId,
                    actionEl.dataset.characterId,
                    actionEl.dataset.teamId || '',
                    actionEl
                );
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

        _formState.editId = editId || null;

        // Stage the participant list. On edit this starts from the
        // stored mission's participants; on create it starts empty
        // and grows as the user ticks team-member checkboxes.
        _formState.participants = stageParticipantsFromVM(vm);

        // Attach the form-state participants VM so the renderer
        // can build the panel on FIRST render. The panel is then
        // kept in sync in place by refreshParticipantsPanelFromFormState
        // whenever the team chips, year field, or staged list change.
        vm.participantsVM = buildParticipantsVMFromFormState(vm);

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

        cancelScheduledParticipantsPanelRefresh();

        var modal = state.container.querySelector('#mission-form-modal');
        var contentEl = state.container.querySelector(
            '#mission-form-content'
        );

        if (modal) { hideModal(modal); }
        if (contentEl) { contentEl.innerHTML = ''; }

        _formState.editId = null;
        _formState.participants = [];
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
    // PARTICIPANT STAGING
    // ============================================================
    //
    // _formState.participants is the single source of truth for
    // the form's participant panel and for the submit payload.
    // It is initialised from the VM on open, updated on every
    // toggle, and pruned when a team chip is removed.

    /**
     * Extract the initial staged participant list from a form VM.
     * On edit, this is a deep copy of vm.mission.participants. On
     * create, it is an empty array.
     */
    function stageParticipantsFromVM(vm) {
        if (!vm || !vm.mission ||
            !Array.isArray(vm.mission.participants)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < vm.mission.participants.length; i++) {
            var p = vm.mission.participants[i];
            if (!p || typeof p !== 'object') { continue; }
            result.push({
                characterId: p.characterId,
                teamId: (p.teamId !== undefined) ? p.teamId : null,
                source: p.source
            });
        }
        return result;
    }

    /**
     * Build a form-state participants VM from the CURRENT form
     * inputs:
     *
     *   - team ids from the team chips (or from the form VM on the
     *     first render, when the chips have not been rendered yet);
     *   - year from the year input (or from the form VM on the
     *     first render);
     *   - the staged participant list.
     */
    function buildParticipantsVMFromFormState(vm) {
        var form = null;
        if (state.container) {
            var contentEl = state.container.querySelector(
                '#mission-form-content'
            );
            if (contentEl) {
                form = contentEl.querySelector('#mission-form-inner');
            }
        }

        var teamIds = [];
        var year = null;

        if (form) {
            teamIds = readAssignedTeamIdsFromForm(form);
            var yearEl = form.querySelector('#mission-year');
            if (yearEl) {
                year = yearEl.value;
            }
        } else if (vm && vm.mission) {
            // First render: the chips have not been emitted yet.
            // Fall back to the VM's assigned team ids and year.
            if (Array.isArray(vm.mission.assignedTeamIds)) {
                teamIds = vm.mission.assignedTeamIds.slice();
            }
            if (vm.mission.year !== undefined &&
                vm.mission.year !== null) {
                year = vm.mission.year;
            }
        }

        if (year === null && vm && vm.defaults) {
            year = vm.defaults.year;
        }

        var missionId = _formState.editId;
        var missionTitle = vm && vm.mission
            ? (vm.mission.title || 'Mission')
            : 'Mission';

        try {
            return MissionAggregator.getParticipantsViewModelFromFormState({
                missionId: missionId,
                missionTitle: missionTitle,
                year: year,
                assignedTeamIds: teamIds,
                participants: _formState.participants
            });
        } catch (e) {
            console.warn(
                '[MissionUI] getParticipantsViewModelFromFormState ' +
                'threw:', e
            );
            return null;
        }
    }

    /**
     * Rebuild the participants panel inside the open form and swap
     * the panel node in place.
     *
     * The panel is re-rendered from the CURRENT form state (team
     * chips, year field, staged participants), not from a stored
     * mission id. The rest of the form — every other input, the
     * team chips, the support rows, the objectives, the rookie
     * chip list — is left byte-identical. That is the point:
     * ticking a participant, adding a team chip, or changing the
     * year must not discard an unsaved edit elsewhere in the form.
     *
     * No-op when the form is not open, or when the panel node
     * cannot be found.
     */
    function refreshParticipantsPanelFromFormState() {
        if (!state.container) { return; }
        if (!_formState.editId && !_formState.isCreate) {
            // Guard against refreshing a panel that does not
            // belong to an open form. We only know the form is
            // open by the presence of the modal shell, so check
            // that instead of editId (which is null on create).
        }

        var contentEl = state.container.querySelector(
            '#mission-form-content'
        );
        if (!contentEl) { return; }

        var form = contentEl.querySelector('#mission-form-inner');
        if (!form) { return; }

        var panelNode = form.querySelector(
            '#mission-participants-panel'
        );
        if (!panelNode) { return; }

        // Rebuild the form VM so the renderer receives a VM whose
        // non-participant fields match the form's current contract.
        // We only swap the participants panel node.
        var renderVM = null;
        try {
            renderVM = MissionAggregator.getMissionFormViewModel({
                editId: _formState.editId
            });
        } catch (e) {
            renderVM = null;
        }
        if (!renderVM) { return; }

        renderVM.editId = _formState.editId;
        renderVM.participantsVM = buildParticipantsVMFromFormState(
            renderVM
        );

        var tmp = document.createElement('div');
        tmp.innerHTML = MissionRender.renderForm(renderVM);

        var newPanel = tmp.querySelector('#mission-participants-panel');
        if (!newPanel) { return; }

        panelNode.parentNode.replaceChild(newPanel, panelNode);
    }

    /**
     * Add or remove a participant from the staged list. Returns the
     * new list. Does not write to the store; the caller decides
     * whether to persist.
     */
    function stageParticipant(characterId, teamId, source) {
        if (!characterId) { return; }
        var cid = String(characterId);
        var tid = (teamId === undefined || teamId === null ||
                   teamId === '')
            ? null
            : String(teamId);
        var src = source || (tid === null ? 'rookie' : 'team');

        // Reject incoherent source/teamId combinations up front,
        // matching MissionSchema's participant validator.
        if (src === 'team' && tid === null) { return; }
        if (src === 'rookie' && tid !== null) { return; }

        // Dedup on (characterId, teamId).
        for (var i = 0; i < _formState.participants.length; i++) {
            var p = _formState.participants[i];
            if (String(p.characterId) !== cid) { continue; }
            var pTid = (p.teamId === undefined || p.teamId === null)
                ? null
                : String(p.teamId);
            if (pTid === tid) { return; }
        }

        _formState.participants.push({
            characterId: cid,
            teamId: tid,
            source: src
        });
    }

    function unstageParticipant(characterId, teamId) {
        if (!characterId) { return; }
        var cid = String(characterId);
        var tid = (teamId === undefined || teamId === null ||
                   teamId === '')
            ? null
            : String(teamId);

        var kept = [];
        for (var i = 0; i < _formState.participants.length; i++) {
            var p = _formState.participants[i];
            var pCid = String(p.characterId);
            var pTid = (p.teamId === undefined || p.teamId === null)
                ? null
                : String(p.teamId);

            if (pCid === cid && pTid === tid) { continue; }
            kept.push(p);
        }
        _formState.participants = kept;
    }

    function pruneStagedParticipantsForTeam(teamId) {
        if (!teamId) { return; }
        var target = String(teamId);

        var kept = [];
        for (var i = 0; i < _formState.participants.length; i++) {
            var p = _formState.participants[i];
            if (p.teamId === null || p.teamId === undefined) {
                kept.push(p);
                continue;
            }
            if (String(p.teamId) === target) { continue; }
            kept.push(p);
        }
        _formState.participants = kept;
    }

    /**
     * Reload the staged participant list from the STORE. Used
     * after the rookie picker closes, because the picker writes
     * through MissionCore directly and the staged list must
     * reflect those writes.
     *
     * No-op on create (no mission id exists yet; the staged list
     * is the only source of truth).
     */
    function resyncStagedParticipantsFromStore() {
        if (!_formState.editId) { return; }

        var mission = null;
        try {
            mission = MissionQueries.getMission(_formState.editId);
        } catch (e) {
            mission = null;
        }
        if (!mission) { return; }

        var participants =
            MissionQueries.getParticipantsForMission(mission);

        var next = [];
        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            next.push({
                characterId: p.characterId,
                teamId: p.teamId,
                source: p.source
            });
        }
        _formState.participants = next;
    }

    // ============================================================
    // PARTICIPANT TOGGLE (team-member checkboxes)
    // ============================================================

    /**
     * Toggle a team-member participant on the mission.
     *
     * The checkbox carries data-character-id, data-team-id, and
     * data-source="team". Rookie toggles do not go through this
     * path; the picker owns them.
     *
     * On create: stage the toggle and re-render the panel. The
     *           write happens on submit, via the create payload.
     * On edit:   stage the toggle AND call MissionCore immediately,
     *           so the stored record stays consistent even if the
     *           user navigates away without saving. Re-render the
     *           panel afterwards.
     */
    function handleParticipantToggle(checkbox) {
        if (!checkbox) { return; }

        var missionId = checkbox.dataset.missionId;
        var characterId = checkbox.dataset.characterId;
        var teamId = checkbox.dataset.teamId || '';
        var source = checkbox.dataset.source || 'team';
        var checked = checkbox.checked === true;

        if (!characterId) { return; }

        // On the form, teamId is required for team participants.
        // Rookie entries are managed by the picker and do not use
        // this handler.
        if (source === 'team' && teamId === '') { return; }

        // ---- Stage the toggle ----
        if (checked) {
            stageParticipant(characterId, teamId, source);
        } else {
            unstageParticipant(characterId, teamId);
        }

        // ---- On create, there is no mission row to write to ----
        if (!missionId) {
            refreshParticipantsPanelFromFormState();
            return;
        }

        // ---- On edit, mirror the toggle to the store ----
        var promise;
        if (checked) {
            promise = MissionCore.addParticipant(
                missionId,
                characterId,
                teamId
            );
        } else {
            promise = MissionCore.removeParticipant(
                missionId,
                characterId,
                teamId
            );
        }

        promise.then(function(result) {
            if (result && result.success) {
                refreshParticipantsPanelFromFormState();
                return;
            }

            // The store write failed. Roll back the staged toggle
            // so the panel and the payload stay aligned with the
            // store, and report.
            if (checked) {
                unstageParticipant(characterId, teamId);
            } else {
                stageParticipant(characterId, teamId, source);
            }

            refreshParticipantsPanelFromFormState();

            notify(
                (result && result.message) ||
                    'Could not update participant.',
                'error'
            );
        }).catch(function(err) {
            console.warn(
                '[MissionUI] participant toggle failed:', err
            );

            // Same rollback as the failure branch above.
            if (checked) {
                unstageParticipant(characterId, teamId);
            } else {
                stageParticipant(characterId, teamId, source);
            }

            refreshParticipantsPanelFromFormState();
            notify('Failed to update participant.', 'error');
        });
    }

    /**
     * Remove a participant. Called by the detail panel's per-row
     * remove button and by the rookie chip's ✕ in the form.
     *
     * For a detail-panel remove, the surrounding mission is
     * refreshed through the standard post-mutation path.
     *
     * For a form-side remove, the staged list is updated and the
     * form's participant panel is refreshed in place; the
     * surrounding form is not closed. If the form is editing an
     * existing mission, the removal is also mirrored to the store
     * so the record stays consistent.
     *
     * The two cases are distinguished by whether the form modal is
     * open and the passed-in element is inside it.
     */
    function handleRemoveParticipant(
        missionId, characterId, teamIdStr, actionEl
    ) {
        if (!characterId) { return; }

        var teamId = (teamIdStr && teamIdStr !== '')
            ? teamIdStr
            : null;

        // Is the action element inside the mission form's
        // participant panel?
        var inForm = false;
        if (actionEl && state.container) {
            var formContent = state.container.querySelector(
                '#mission-form-content'
            );
            if (formContent && formContent.contains(actionEl)) {
                inForm = true;
            }
        }

        if (!inForm) {
            if (!window.confirm('Remove this participant?')) {
                return;
            }
        }

        // Update the staged list first. This is the source of
        // truth for the form panel and for the submit payload.
        if (inForm) {
            unstageParticipant(characterId, teamId);
        }

        // ---- On create, there is no mission row to write to ----
        if (!missionId) {
            if (inForm) {
                refreshParticipantsPanelFromFormState();
            }
            return;
        }

        var promise = MissionCore.removeParticipant(
            missionId, characterId, teamId
        );

        promise.then(function(result) {
            if (!result || !result.success) {
                if (result && result.message) {
                    notify(result.message, 'error');
                }

                // Roll back the staged removal.
                if (inForm) {
                    stageParticipant(
                        characterId,
                        teamId,
                        teamId === null ? 'rookie' : 'team'
                    );
                    refreshParticipantsPanelFromFormState();
                }
                return;
            }

            if (inForm) {
                refreshParticipantsPanelFromFormState();
                return;
            }

            openDetailModal(missionId);
            refreshAfterMutation();
        }).catch(function(err) {
            console.warn(
                '[MissionUI] removeParticipant failed:', err
            );
            notify('Failed to remove participant.', 'error');

            if (inForm) {
                stageParticipant(
                    characterId,
                    teamId,
                    teamId === null ? 'rookie' : 'team'
                );
                refreshParticipantsPanelFromFormState();
            }
        });
    }

    // ============================================================
    // ROOKIE PICKER
    // ============================================================

    /**
     * Open the rookie picker modal for a mission.
     *
     * The picker owns its own write path. On close, the onClose
     * callback refreshes whichever surface launched it:
     *
     *   - If the mission form is open and editing the same
     *     mission, the form's participant panel is re-rendered
     *     in place, and the staged list is resynced from the
     *     store (the picker writes through MissionCore directly).
     *   - If the detail panel is open on the same mission, the
     *     detail panel is re-rendered.
     *   - Either way, the list is refreshed so the participant
     *     count on the row is up to date.
     *
     * On CREATE there is no mission id yet. The picker cannot
     * write, so the opener is a no-op with a toast. The user adds
     * rookies after the mission exists (via the detail panel).
     */
    function handleOpenRookiePicker(missionId) {
        if (!missionId) {
            notify(
                'Save the mission first, then add rookies from ' +
                'the detail panel.',
                'info'
            );
            return;
        }

        var Picker = getMissionRookiePicker();
        if (!Picker || typeof Picker.openModal !== 'function') {
            notify(
                'The rookie picker is not available. ' +
                'MissionRookiePicker is not loaded.',
                'error'
            );
            return;
        }

        // Determine whether the picker was launched from the form
        // or from the detail panel. The onClose behaviour differs.
        var formContent = state.container
            ? state.container.querySelector('#mission-form-content')
            : null;
        var launchedFromForm = false;

        if (formContent && _formState.editId &&
            String(_formState.editId) === String(missionId)) {
            launchedFromForm = true;
        }

        try {
            Picker.openModal(missionId, {
                onClose: function() {
                    if (launchedFromForm) {
                        // The picker wrote through MissionCore.
                        // Resync the staged list from the store,
                        // then rebuild the panel.
                        resyncStagedParticipantsFromStore();
                        refreshParticipantsPanelFromFormState();
                        return;
                    }
                    if (state.currentMissionId &&
                        String(state.currentMissionId) ===
                            String(missionId)) {
                        openDetailModal(missionId);
                    }
                    refreshAfterMutation();
                }
            });
        } catch (err) {
            console.warn(
                '[MissionUI] MissionRookiePicker.openModal threw:',
                err
            );
            notify(
                'Failed to open the rookie picker: ' +
                (err && err.message ? err.message : String(err)),
                'error'
            );
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
            assignedTeamIds: readAssignedTeamIdsFromForm(form),
            notes: readValue(form, '#mission-notes'),

            // Participants come from the STAGED list, which is the
            // single source of truth for the form's participant
            // panel. On create this is the ONLY write path (no
            // mission id exists while the user is ticking boxes).
            // On edit, the immediate-write path (MissionCore
            // .addParticipant / removeParticipant) already ran for
            // every toggle; sending the staged array on submit is
            // a reconcile that keeps the two in sync.
            participants: cloneParticipantStage()
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

    function cloneParticipantStage() {
        var out = [];
        for (var i = 0; i < _formState.participants.length; i++) {
            var p = _formState.participants[i];
            out.push({
                characterId: p.characterId,
                teamId: p.teamId,
                source: p.source
            });
        }
        return out;
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

    function readAssignedTeamIdsFromForm(form) {
        var host = form.querySelector('#mission-teams-list');
        if (!host) { return []; }
        var rows = host.querySelectorAll('.mission-team-chip');
        var ids = [];
        for (var i = 0; i < rows.length; i++) {
            var id = rows[i].dataset.teamId;
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
    // FORM-SIDE SUPPORT / OBJECTIVE / TEAM ROW MANAGEMENT
    // ============================================================

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

    function appendTeamChipToForm(form) {
        var select = form.querySelector('#mission-team-select');
        var host = form.querySelector('#mission-teams-list');
        if (!select || !host) { return; }

        var teamId = select.value;
        if (!teamId) {
            notify('Select a team first.', 'warning');
            return;
        }

        var existing = host.querySelectorAll('.mission-team-chip');
        for (var i = 0; i < existing.length; i++) {
            if (existing[i].dataset.teamId === teamId) {
                notify('Team is already assigned.', 'warning');
                return;
            }
        }

        var label = '';
        for (var o = 0; o < select.options.length; o++) {
            if (select.options[o].value === teamId) {
                label = select.options[o].textContent;
                break;
            }
        }

        var empty = host.querySelector('.empty-state');
        if (empty) { empty.remove(); }

        var chip = document.createElement('div');
        chip.className = 'mission-team-chip';
        chip.dataset.teamId = teamId;
        chip.innerHTML =
            '<span class="mission-team-chip-name">' +
                escapeHtml(label || teamId) +
            '</span>' +
            '<button type="button" class="small danger" ' +
                'data-action="mission-remove-team" ' +
                'data-team-id="' +
                    escapeAttribute(teamId) + '">' +
                '×' +
            '</button>';

        host.appendChild(chip);
        select.value = '';

        // The panel's team sections depend on the assigned team
        // list. Rebuild it in place.
        refreshParticipantsPanelFromFormState();
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

    function removeTeamChipFromForm(button) {
        var chip = button.closest('.mission-team-chip');
        if (!chip) { return; }
        var teamId = chip.dataset.teamId || '';
        var host = chip.parentNode;
        chip.remove();

        if (host &&
            host.querySelectorAll('.mission-team-chip').length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state small';
            empty.textContent = 'No teams assigned.';
            host.appendChild(empty);
        }

        // Removing a team removes that team's participants from
        // the mission. Prune the staged list to match, then
        // rebuild the panel in place.
        if (teamId) {
            pruneStagedParticipantsForTeam(teamId);
        }
        refreshParticipantsPanelFromFormState();
    }

    // ============================================================
    // EXPORT MODAL
    // ============================================================

    function ensureExportModalShell(container) {
        if (!container) { return; }

        var existing = container.querySelector(
            '#mission-export-modal'
        );
        if (existing) { return; }

        var shell = document.createElement('div');
        shell.id = 'mission-export-modal';
        shell.className = 'modal hidden';

        var content = document.createElement('div');
        content.className = 'modal-content modal-export-content';
        shell.appendChild(content);

        container.appendChild(shell);
    }

    function openExportModal(missionId) {
        if (!missionId) { return; }

        if (!isContainerAttached()) {
            console.warn(
                '[MissionUI] openExportModal: container is missing ' +
                'or detached.'
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

        _exportPicker.missionId = String(missionId);
        _exportPicker.missionTitle = mission.title || 'Mission';
        _exportPicker.format = 'text';

        ensureExportModalShell(state.container);

        var modal = state.container.querySelector(
            '#mission-export-modal'
        );
        if (!modal) {
            notify('Could not open the export picker.', 'error');
            return;
        }

        var contentEl = modal.querySelector('.modal-export-content');
        if (!contentEl) {
            contentEl = document.createElement('div');
            contentEl.className = 'modal-content modal-export-content';
            modal.appendChild(contentEl);
        }

        contentEl.innerHTML = buildExportModalHTML(
            _exportPicker.missionTitle,
            _exportPicker.format
        );
        showModal(modal);
    }

    function buildExportModalHTML(missionTitle, currentFormat) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Export Mission \u2014 ' +
                    escapeHtml(missionTitle) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="mission-export-cancel" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';
        html += '<p class="field-hint" ' +
                    'style="font-size:0.75rem;color:var(--text-dim);' +
                    'margin:0 0 12px 0;line-height:1.5;">' +
                    'Pick a format. Text is a human-readable ' +
                    'report. JSON is the full record, and is the ' +
                    'format the import accepts back for ' +
                    'round-tripping.' +
                '</p>';

        html += '<div class="mission-export-formats">';
        html += buildExportFormatRow(
            'text',
            'Text report',
            'A formatted plain-text document. Team and character ' +
            'names are resolved. Not intended for import.',
            currentFormat
        );
        html += buildExportFormatRow(
            'json',
            'JSON',
            'The full mission record, verbatim. Round-trips ' +
            'through the import path.',
            currentFormat
        );
        html += '</div>';

        html += '<div id="mission-export-error" ' +
                    'class="mission-export-error" ' +
                    'style="display:none;margin-top:10px;' +
                    'padding:8px 12px;' +
                    'background:var(--danger-soft);' +
                    'border-left:3px solid var(--danger);' +
                    'border-radius:4px;' +
                    'font-size:0.75rem;' +
                    'color:var(--danger);"></div>';

        html += '</div>';

        html += '<div class="form-actions" ' +
                    'style="display:flex;gap:8px;' +
                    'justify-content:flex-end;' +
                    'margin-top:12px;padding-top:12px;' +
                    'border-top:1px solid var(--border-soft);">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-export-cancel">Cancel</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="mission-export-submit">Export</button>';
        html += '</div>';

        return html;
    }

    function buildExportFormatRow(value, title, description, current) {
        var checked = current === value ? ' checked' : '';

        var html = '';
        html += '<label class="mission-export-format' +
                    (checked ? ' is-selected' : '') + '">';
        html += '<input type="radio" name="mission-export-format" ' +
                    'value="' + escapeAttribute(value) + '"' +
                    checked + '>';
        html += '<span class="mission-export-format-body">';
        html += '<span class="mission-export-format-title">' +
                    escapeHtml(title) +
                '</span>';
        html += '<span class="mission-export-format-desc">' +
                    escapeHtml(description) +
                '</span>';
        html += '</span>';
        html += '</label>';

        return html;
    }

    function closeExportModal() {
        if (!state.container) {
            resetExportPicker();
            return;
        }

        var modal = state.container.querySelector(
            '#mission-export-modal'
        );
        var contentEl = modal
            ? modal.querySelector('.modal-export-content')
            : null;

        if (modal) { hideModal(modal); }
        if (contentEl) { contentEl.innerHTML = ''; }

        resetExportPicker();
    }

    function resetExportPicker() {
        _exportPicker.missionId = null;
        _exportPicker.missionTitle = '';
        _exportPicker.format = 'text';
    }

    function setExportError(message) {
        if (!state.container) { return; }
        var modal = state.container.querySelector(
            '#mission-export-modal'
        );
        if (!modal) { return; }
        var errEl = modal.querySelector('#mission-export-error');
        if (!errEl) { return; }

        if (!message) {
            errEl.style.display = 'none';
            errEl.textContent = '';
            return;
        }
        errEl.textContent = message;
        errEl.style.display = 'block';
    }

    function handleExportSubmit() {
        if (!_exportPicker.missionId) { return; }

        var Exporter = getMissionExport();
        if (!Exporter) {
            setExportError(
                'Mission export module is not loaded. Check the ' +
                'script order in index.html.'
            );
            return;
        }

        var isJson = _exportPicker.format === 'json';
        var fn = isJson
            ? Exporter.exportMissionJson
            : Exporter.exportMissionText;

        if (typeof fn !== 'function') {
            setExportError(
                'The ' + (isJson ? 'JSON' : 'text') +
                ' export is not available.'
            );
            return;
        }

        var result;
        try {
            result = fn.call(Exporter, _exportPicker.missionId);
        } catch (err) {
            console.warn(
                '[MissionUI] MissionExport threw:', err
            );
            setExportError(
                'Export failed: ' +
                (err && err.message ? err.message : String(err))
            );
            return;
        }

        if (result && result.exported) {
            notify(
                'Mission exported: ' + result.filename,
                'success'
            );
            closeExportModal();
            return;
        }

        setExportError(
            (result && result.error) || 'Unknown error.'
        );
    }

    // ============================================================
    // IMPORT MODAL
    // ============================================================

    function ensureImportModalShell(container) {
        if (!container) { return; }

        var existing = container.querySelector(
            '#mission-import-modal'
        );
        if (existing) { return; }

        var shell = document.createElement('div');
        shell.id = 'mission-import-modal';
        shell.className = 'modal hidden';

        var content = document.createElement('div');
        content.className = 'modal-content modal-import-content';
        shell.appendChild(content);

        container.appendChild(shell);
    }

    function openImportModal() {
        if (!isContainerAttached()) {
            console.warn(
                '[MissionUI] openImportModal: container is missing ' +
                'or detached.'
            );
            notifyContainerLost();
            return;
        }

        _importModal.format = 'json';

        ensureImportModalShell(state.container);

        var modal = state.container.querySelector(
            '#mission-import-modal'
        );
        if (!modal) {
            notify('Could not open the import modal.', 'error');
            return;
        }

        var contentEl = modal.querySelector('.modal-import-content');
        if (!contentEl) {
            contentEl = document.createElement('div');
            contentEl.className = 'modal-content modal-import-content';
            modal.appendChild(contentEl);
        }

        contentEl.innerHTML = buildImportModalHTML(
            _importModal.format
        );
        showModal(modal);

        setTimeout(function() {
            var textEl = contentEl.querySelector(
                '#mission-import-text'
            );
            if (textEl && typeof textEl.focus === 'function') {
                try { textEl.focus(); } catch (e) {}
            }
        }, 50);
    }

    function buildImportModalHTML(currentFormat) {
        var isJson = currentFormat === 'json';

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Import Missions</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="mission-import-cancel" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body modal-import-body">';

        html += '<p class="field-hint" ' +
                    'style="font-size:0.75rem;color:var(--text-dim);' +
                    'margin:0 0 12px 0;line-height:1.5;">' +
                    'Paste a JSON object, a JSON array, or a CSV ' +
                    'file\u2019s contents below. Every mission is ' +
                    'imported sequentially; a failure on one record ' +
                    'does not stop the rest.' +
                '</p>';

        html += '<div class="form-group">';
        html += '<label>Format</label>';
        html += '<div class="mission-import-formats">';

        html += '<label class="mission-import-format' +
                    (isJson ? ' is-selected' : '') + '">';
        html += '<input type="radio" name="mission-import-format" ' +
                    'value="json"' + (isJson ? ' checked' : '') + '>';
        html += '<span>JSON \u2014 single object or array of ' +
                    'missions. Existing missions (matched by id) ' +
                    'are updated; new missions are created.</span>';
        html += '</label>';

        html += '<label class="mission-import-format' +
                    (isJson ? '' : ' is-selected') + '">';
        html += '<input type="radio" name="mission-import-format" ' +
                    'value="csv"' + (isJson ? '' : ' checked') + '>';
        html += '<span>CSV \u2014 one row per mission. Every row ' +
                    'creates a new mission. Use JSON if you need ' +
                    'to update existing missions.</span>';
        html += '</label>';

        html += '</div>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="mission-import-text">Import data</label>';
        html += '<textarea id="mission-import-text" ' +
                    'rows="14" ' +
                    'spellcheck="false" ' +
                    'autocomplete="off" ' +
                    'placeholder="' +
                        (isJson
                            ? '{ &quot;title&quot;: ... } or [ ... ]'
                            : 'MissionId,Title,Status,...') +
                    '" ' +
                    'style="width:100%;min-height:260px;' +
                    'padding:8px 10px;' +
                    'background:var(--bg);' +
                    'border:1px solid var(--border);' +
                    'color:var(--text);' +
                    'border-radius:6px;' +
                    'font-family:monospace;' +
                    'font-size:0.72rem;' +
                    'line-height:1.5;' +
                    'resize:vertical;' +
                    'white-space:pre;' +
                    'overflow:auto;"></textarea>';
        html += '<span class="field-hint" ' +
                    'style="font-size:0.65rem;">' +
                    'Ctrl / Cmd + Enter to import.' +
                '</span>';
        html += '</div>';

        html += '<div class="mission-import-file-row" ' +
                    'style="display:flex;justify-content:space-between;' +
                    'align-items:center;gap:8px;margin-top:10px;' +
                    'flex-wrap:wrap;">';
        html += '<button type="button" ' +
                    'class="secondary small" ' +
                    'data-action="mission-import-file" ' +
                    'style="font-size:0.7rem;padding:4px 10px;">' +
                    'Load from file...' +
                '</button>';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">' +
                    'Or paste directly.' +
                '</span>';
        html += '</div>';

        html += '<div id="mission-import-error" ' +
                    'class="mission-import-error" ' +
                    'style="display:none;margin-top:10px;' +
                    'padding:8px 12px;' +
                    'background:var(--danger-soft);' +
                    'border-left:3px solid var(--danger);' +
                    'border-radius:4px;' +
                    'font-size:0.75rem;' +
                    'color:var(--danger);' +
                    'max-height:120px;overflow-y:auto;' +
                    'white-space:pre-wrap;"></div>';

        html += '</div>';

        html += '<div class="form-actions" ' +
                    'style="display:flex;gap:8px;' +
                    'justify-content:flex-end;' +
                    'margin-top:12px;padding-top:12px;' +
                    'border-top:1px solid var(--border-soft);">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-import-cancel">Cancel</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="mission-import-submit">Import</button>';
        html += '</div>';

        return html;
    }

    function updateImportPlaceholder() {
        if (!state.container) { return; }
        var modal = state.container.querySelector(
            '#mission-import-modal'
        );
        if (!modal) { return; }
        var textEl = modal.querySelector('#mission-import-text');
        if (!textEl) { return; }

        textEl.placeholder = _importModal.format === 'json'
            ? '{ "title": ... } or [ ... ]'
            : 'MissionId,Title,Status,...';

        var labels = modal.querySelectorAll(
            '.mission-import-format'
        );
        for (var i = 0; i < labels.length; i++) {
            var input = labels[i].querySelector('input');
            if (!input) { continue; }
            if (input.value === _importModal.format) {
                labels[i].classList.add('is-selected');
            } else {
                labels[i].classList.remove('is-selected');
            }
        }
    }

    function closeImportModal() {
        if (!state.container) {
            resetImportModal();
            return;
        }

        var modal = state.container.querySelector(
            '#mission-import-modal'
        );
        var contentEl = modal
            ? modal.querySelector('.modal-import-content')
            : null;

        if (modal) { hideModal(modal); }
        if (contentEl) { contentEl.innerHTML = ''; }

        resetImportModal();
    }

    function resetImportModal() {
        _importModal.format = 'json';
    }

    function setImportError(message) {
        if (!state.container) { return; }
        var modal = state.container.querySelector(
            '#mission-import-modal'
        );
        if (!modal) { return; }
        var errEl = modal.querySelector('#mission-import-error');
        if (!errEl) { return; }

        if (!message) {
            errEl.style.display = 'none';
            errEl.textContent = '';
            return;
        }
        errEl.textContent = message;
        errEl.style.display = 'block';
    }

    function openImportFilePicker() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.csv,application/json,text/csv';
        input.style.display = 'none';

        input.addEventListener('change', function() {
            var file = input.files && input.files[0];
            if (!file) {
                cleanup();
                return;
            }

            var reader = new FileReader();
            reader.onerror = function() {
                setImportError('Failed to read the file.');
                cleanup();
            };
            reader.onload = function() {
                var text = String(reader.result || '');

                if (/\.csv$/i.test(file.name)) {
                    _importModal.format = 'csv';
                } else if (/\.json$/i.test(file.name)) {
                    _importModal.format = 'json';
                }

                var modal = state.container
                    ? state.container.querySelector(
                        '#mission-import-modal'
                    )
                    : null;
                if (modal) {
                    var radios = modal.querySelectorAll(
                        'input[name="mission-import-format"]'
                    );
                    for (var r = 0; r < radios.length; r++) {
                        radios[r].checked =
                            radios[r].value === _importModal.format;
                    }
                }
                updateImportPlaceholder();

                var textEl = modal
                    ? modal.querySelector('#mission-import-text')
                    : null;
                if (textEl) {
                    textEl.value = text;
                    textEl.focus();
                    setImportError('');
                }

                cleanup();
            };
            reader.readAsText(file);
        });

        function cleanup() {
            try {
                if (input.parentNode) {
                    input.parentNode.removeChild(input);
                }
            } catch (e) { /* ignore */ }
        }

        document.body.appendChild(input);
        input.click();
    }

    function handleImportSubmit() {
        if (!state.container) { return; }

        var modal = state.container.querySelector(
            '#mission-import-modal'
        );
        if (!modal) { return; }

        var textEl = modal.querySelector('#mission-import-text');
        if (!textEl) { return; }

        var text = String(textEl.value || '');
        if (text.trim() === '') {
            setImportError('Paste or load some data first.');
            return;
        }

        var Importer = getMissionImport();
        if (!Importer ||
            typeof Importer.importText !== 'function') {
            setImportError(
                'Mission import module is not loaded. Check the ' +
                'script order in index.html.'
            );
            return;
        }

        setImportError('');

        var promise;
        try {
            promise = Importer.importText(text, {
                format: _importModal.format
            });
        } catch (err) {
            console.warn(
                '[MissionUI] MissionImport.importText threw:', err
            );
            setImportError(
                'Import failed: ' +
                (err && err.message ? err.message : String(err))
            );
            return;
        }

        promise.then(function(result) {
            reportImportResult(result);
        }).catch(function(err) {
            console.warn(
                '[MissionUI] MissionImport rejected:', err
            );
            setImportError(
                'Import failed: ' +
                (err && err.message ? err.message : String(err))
            );
        });
    }

    function reportImportResult(result) {
        if (!result) {
            setImportError('Import returned no result.');
            notify('Import failed.', 'error');
            return;
        }

        var imported = result.imported || 0;
        var created = result.created || 0;
        var updated = result.updated || 0;
        var failed = result.failed || 0;
        var errors = Array.isArray(result.errors) ? result.errors : [];
        var warnings = Array.isArray(result.warnings)
            ? result.warnings
            : [];

        if (result.success && failed === 0) {
            var parts = [];
            if (created > 0) {
                parts.push(created + ' created');
            }
            if (updated > 0) {
                parts.push(updated + ' updated');
            }
            notify(
                'Imported ' + imported + ' mission' +
                (imported === 1 ? '' : 's') +
                (parts.length > 0 ? ' (' + parts.join(', ') + ')' : '') +
                '.',
                'success'
            );
            closeImportModal();
            refreshAfterMutation();
            return;
        }

        var lines = [];

        if (imported > 0) {
            lines.push(
                'Imported ' + imported + ' mission' +
                (imported === 1 ? '' : 's') + ' ' +
                '(' + created + ' created, ' + updated +
                ' updated).'
            );
        } else {
            lines.push('No missions imported.');
        }

        if (failed > 0) {
            lines.push(failed + ' record' +
                (failed === 1 ? '' : 's') + ' failed:');
        }

        var MAX_SHOWN = 20;
        for (var i = 0;
             i < errors.length && i < MAX_SHOWN;
             i++) {
            var e = errors[i];
            var where = '';
            if (e.row !== undefined && e.row !== null) {
                where = 'Row ' + e.row + ': ';
            }
            lines.push('  ' + where +
                (e.message || 'Unknown error.'));
        }
        if (errors.length > MAX_SHOWN) {
            lines.push('  \u2026 and ' +
                (errors.length - MAX_SHOWN) +
                ' more errors.');
        }

        if (warnings.length > 0 && failed === 0) {
            for (var w = 0;
                 w < warnings.length && w < MAX_SHOWN;
                 w++) {
                lines.push('  ' + warnings[w]);
            }
            if (warnings.length > MAX_SHOWN) {
                lines.push('  \u2026 and ' +
                    (warnings.length - MAX_SHOWN) +
                    ' more warnings.');
            }
        }

        setImportError(lines.join('\n'));

        if (imported > 0) {
            notify(
                'Import completed with ' + failed +
                ' failure' + (failed === 1 ? '' : 's') +
                '. See the modal for details.',
                'warning'
            );
            refreshAfterMutation();
        } else {
            notify(
                'Import failed. See the modal for details.',
                'error'
            );
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

    function handleAddTeam(missionId, actionEl) {
        if (!missionId) {
            var form = actionEl && actionEl.closest
                ? actionEl.closest('form')
                : null;
            if (form) {
                appendTeamChipToForm(form);
            }
            return;
        }

        openFormModal(missionId);
    }

    function handleRemoveTeam(missionId, teamId, actionEl) {
        if (!teamId) { return; }

        if (!missionId) {
            if (actionEl) {
                removeTeamChipFromForm(actionEl);
            }
            return;
        }

        if (!window.confirm('Remove this team from the mission?')) {
            return;
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            notify('Mission not found.', 'error');
            return;
        }

        var currentIds = MissionQueries.getTeamIdsForMission(mission);
        var nextIds = currentIds.filter(function(id) {
            return String(id) !== String(teamId);
        });

        handleMutation(
            MissionCore.updateMission(missionId, {
                assignedTeamIds: nextIds
            }),
            {
                onSuccess: function() {
                    openDetailModal(missionId);
                    refreshAfterMutation();
                }
            }
        );
    }

    // ============================================================
    // REPORT FORM MODAL
    // ============================================================

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

        _reportForm.mode = reportId ? 'edit' : 'create';
        _reportForm.missionId = String(missionId);
        _reportForm.missionTitle = mission.title || 'Mission';
        _reportForm.reportId = reportId ? String(reportId) : null;
        _reportForm.authorId = '';
        _reportForm.authorRedacted = false;
        _reportForm.text = '';

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

        var authorOptions = null;
        try {
            authorOptions = MissionAggregator
                .getReportAuthorOptionsViewModel(missionId);
        } catch (e) {
            console.warn(
                '[MissionUI] getReportAuthorOptionsViewModel threw:',
                e
            );
            authorOptions = null;
        }

        if (!authorOptions) {
            authorOptions = {
                missionId: String(missionId),
                missionTitle: mission.title || 'Mission',
                teamMembers: [],
                otherCharacters: []
            };
        }

        var vm = {
            mode: _reportForm.mode,
            missionId: _reportForm.missionId,
            missionTitle: _reportForm.missionTitle,
            reportId: _reportForm.reportId,
            authorId: _reportForm.authorId,
            authorRedacted: _reportForm.authorRedacted,
            text: _reportForm.text,
            teamMembers: authorOptions.teamMembers,
            otherCharacters: authorOptions.otherCharacters
        };

        contentEl.innerHTML =
            MissionRender.renderReportFormModal(vm);
        showModal(modal);

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
        cancelScheduledParticipantsPanelRefresh();
        state.container = null;
        state.currentMissionId = null;
        state.currentFilter = 'all';
        resetReportForm();
        resetExportPicker();
        resetImportModal();
        _formState.editId = null;
        _formState.participants = [];
    }

    // ============================================================
    // EXPOSE
    // ============================================================

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
