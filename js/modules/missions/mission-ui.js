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
 *     picker state, import modal state, form scratch state,
 *     bulk-selection state).
 *   - Render via MissionRender from VMs produced by
 *     MissionAggregator.
 *   - Dispatch user actions from data-action attributes.
 *   - Call MissionCore mutations.
 *   - Refresh the view after a successful mutation.
 *   - Show notifications on success and failure.
 *   - Manage modal lifecycle (open, close, DOM cleanup).
 *   - Confirm before discarding an unsaved form.
 *   - Track the missions-list selection set (bulk export).
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   Domain rules, validation, mutations, projections, reads, and
 *   rendering. Each of those lives in its own module
 *   (MissionRules, MissionSchema, MissionCore, MissionAggregator,
 *   MissionQueries, MissionRender respectively). This module
 *   orchestrates them.
 *
 * BULK SELECTION (this revision):
 *   The missions list carries a per-row .mission-select-checkbox,
 *   mirroring the teams list. The set of ticked mission ids lives
 *   in _missionSelectedIds. It is:
 *
 *     - reset on renderMissions (a fresh view has no selection),
 *     - reset on destroyMissions,
 *     - reset after a successful bulk export.
 *
 *   The header carries #mission-export-selected-btn. It is disabled
 *   when the set is empty and reads "Export (N)" otherwise.
 *   Clicking it opens a small format picker (Text / JSON) which
 *   calls MissionExport.exportMissionsText or exportMissionsJson.
 *   Both produce a single file:
 *
 *     Text  — missions-export-<N>.txt, one full report per
 *             selected mission, separated by a bulk banner.
 *     JSON  — missions-export-<N>.json, a JSON array of full
 *             mission records. Round-trips through
 *             MissionImport.importFromJson.
 *
 *   A click that lands inside .mission-select-cell is stopped
 *   before the row's own data-action handler runs, so ticking a
 *   checkbox does not also open the mission detail modal.
 *
 * PARTICIPANTS:
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
 * DISCARD CONFIRM (this revision):
 *   The form can be closed three ways: the × at the top of the
 *   modal, the "Discard Changes" button in the action bar, and
 *   (not wired here) the Escape key. All in-form close paths
 *   route through handleCloseForm(), which compares the form's
 *   current field values against a baseline captured when the
 *   form opened. If anything has changed, a confirm prompt
 *   appears before the form is torn down.
 *
 *   The dirty check is COARSE and ERR-ON-THE-SIDE-OF-DIRTY: any
 *   difference from the baseline counts as dirty.
 *
 *   KNOWN LIMITATION:
 *   On EDIT, a team-member participant toggle writes to the store
 *   immediately (MissionCore.addParticipant / removeParticipant),
 *   so discarding the form does NOT roll back an already-committed
 *   toggle. On CREATE there is no immediate write, so discard is
 *   clean.
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
 *   Two separate flows:
 *
 *     - Single-mission export from the detail panel's Export
 *       button, via the #mission-export-modal picker (Text /
 *       JSON per mission).
 *     - Bulk export from the header's #mission-export-selected-btn,
 *       via the #mission-bulk-export-modal picker (Text / JSON
 *       across the selection).
 *
 * MISSION IMPORT:
 *   A header button opens the import modal.
 *
 * ACTIVITY LOG HAS BEEN REMOVED:
 *   The mission log field has been retired. There is no log modal,
 *   no prompt, no `mission-add-log` action. The relevant handler
 *   and branch are gone.
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
    var _formState = {
        editId: null,
        participants: [],
        baseline: null
    };

    // Bulk-selection state for the missions list. Mirrors the
    // teams list's _teamSelectedIds. Reset on render, on destroy,
    // and after a successful bulk export.
    var _missionSelectedIds = Object.create(null);

    // Year-field debounce timer for the participant-panel refresh.
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

        // Reset the bulk-selection set. A fresh render is a fresh
        // selection context; nothing in the new view has been
        // ticked yet.
        _missionSelectedIds = Object.create(null);

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
            counts: listVM.counts || {},
            selectedIds: _missionSelectedIds
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
        ensureBulkExportModalShell(container);

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

        listHost.innerHTML = MissionRender.renderList(
            vm.missions,
            { selectedIds: _missionSelectedIds }
        );

        var totalEl = container.querySelector('#mission-count-total');
        if (totalEl) {
            totalEl.textContent = String(vm.counts.total || 0);
        }
        var readyEl = container.querySelector('#mission-count-ready');
        if (readyEl) {
            readyEl.textContent = String(vm.counts.readyForCompletion || 0);
        }

        // Refresh the header export button's enabled state and
        // label to match the current selection.
        refreshBulkExportButton(container);
    }

    /**
     * Update the header's #mission-export-selected-btn to reflect
     * the current _missionSelectedIds set. Called after a list
     * re-render and after every selection toggle.
     */
    function refreshBulkExportButton(container) {
        if (!container) { return; }
        var btn = container.querySelector(
            '#mission-export-selected-btn'
        );
        if (!btn) { return; }

        var count = 0;
        for (var k in _missionSelectedIds) {
            if (Object.prototype.hasOwnProperty.call(
                _missionSelectedIds, k
            ) && _missionSelectedIds[k] === true) {
                count++;
            }
        }

        btn.disabled = count === 0;
        btn.textContent = count > 0
            ? 'Export (' + count + ')'
            : 'Export';
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
    // BULK EXPORT MODAL SHELL
    // ============================================================

    function ensureBulkExportModalShell(container) {
        if (!container) { return; }

        var existing = container.querySelector(
            '#mission-bulk-export-modal'
        );
        if (existing) { return; }

        var shell = document.createElement('div');
        shell.id = 'mission-bulk-export-modal';
        shell.className = 'modal hidden';

        var content = document.createElement('div');
        content.className = 'modal-content modal-bulk-export-content';
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

        // ---- Bulk-selection checkbox ----
        //
        // A change event on .mission-select-checkbox updates the
        // selection set and re-renders the list so the row's
        // selected class and the header button both reflect the
        // new state. The list is small; a full re-render is
        // simpler and less error-prone than a surgical update.
        if (target.dataset &&
            target.dataset.missionId &&
            target.classList &&
            target.classList.contains('mission-select-checkbox')) {

            var mid = String(target.dataset.missionId);
            if (target.checked) {
                _missionSelectedIds[mid] = true;
            } else {
                delete _missionSelectedIds[mid];
            }

            renderListInto(state.container);
            return;
        }

        // ---- Participant checkboxes (team-member rows) ----
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

            var bulkModal = state.container
                ? state.container.querySelector(
                    '#mission-bulk-export-modal'
                )
                : null;
            if (bulkModal &&
                !bulkModal.classList.contains('hidden')) {
                event.preventDefault();
                closeBulkExportModal();
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
        // ---- Selection-cell propagation guard ----
        //
        // A click that lands inside the selection cell must not
        // reach the row's data-action handler. The checkbox's own
        // change event is what actually updates the set; the
        // click only matters for stopping propagation.
        if (event.target.closest &&
            event.target.closest('.mission-select-cell')) {
            event.stopPropagation();
            return;
        }

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
                handleCloseForm();
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

            case 'mission-export-selected':
                event.preventDefault();
                openBulkExportModal();
                return;

            case 'mission-bulk-export-cancel':
                event.preventDefault();
                closeBulkExportModal();
                return;

            case 'mission-bulk-export-submit':
                event.preventDefault();
                handleBulkExportSubmit();
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

        _formState.participants = stageParticipantsFromVM(vm);
        _formState.baseline = null;

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

            _formState.baseline = buildFormBaseline(form);
        }

        var primarySelect = contentEl.querySelector('#mission-primary-type');
        var subtypeSelect = contentEl.querySelector('#mission-subtype');
        if (primarySelect && subtypeSelect) {
            addSafeListener(primarySelect, 'change', function() {
                updateSubtypeOptions(primarySelect, subtypeSelect);
            });
        }
    }

    function handleCloseForm() {
        if (!state.container) { return; }

        var contentEl = state.container.querySelector(
            '#mission-form-content'
        );
        if (!contentEl) {
            return;
        }

        var form = contentEl.querySelector('#mission-form-inner');

        if (form && isFormDirty(form)) {
            var confirmed = window.confirm(
                'Discard unsaved changes to this mission?'
            );
            if (!confirmed) {
                return;
            }
        }

        closeFormModal();
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
        _formState.baseline = null;
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
    // FORM DIRTY CHECK
    // ============================================================

    function buildFormBaseline(form) {
        if (!form) { return null; }

        return {
            title: readValue(form, '#mission-title'),
            description: readValue(form, '#mission-description'),
            year: readValue(form, '#mission-year'),
            month: readValue(form, '#mission-month'),
            day: readValue(form, '#mission-day'),
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
            notes: readValue(form, '#mission-notes'),
            tags: readValue(form, '#mission-tags'),

            assignedTeamIds: readAssignedTeamIdsFromForm(form),
            supportPersonnel: readSupportPersonnelFromForm(form),
            objectives: readObjectivesFromForm(form),

            participantKeys: participantKeySet()
        };
    }

    function isFormDirty(form) {
        if (!form) { return false; }
        var baseline = _formState.baseline;
        if (!baseline) {
            return true;
        }

        var current = buildFormBaseline(form);

        var scalarKeys = [
            'title', 'description',
            'year', 'month', 'day',
            'primaryType', 'subtype', 'secondaryType',
            'escalation', 'threatType', 'environment',
            'location', 'duration',
            'difficulty', 'priority',
            'basePay', 'surchargePay', 'billing',
            'status', 'notes', 'tags'
        ];
        for (var i = 0; i < scalarKeys.length; i++) {
            var k = scalarKeys[i];
            if (baseline[k] !== current[k]) { return true; }
        }

        if (!sameStringSet(baseline.assignedTeamIds,
                           current.assignedTeamIds)) {
            return true;
        }

        if (!sameStringSet(baseline.supportPersonnel,
                           current.supportPersonnel)) {
            return true;
        }

        if (!sameObjectives(baseline.objectives,
                            current.objectives)) {
            return true;
        }

        if (!sameStringSet(baseline.participantKeys,
                           current.participantKeys)) {
            return true;
        }

        return false;
    }

    function participantKeySet() {
        var keys = [];
        for (var i = 0; i < _formState.participants.length; i++) {
            var p = _formState.participants[i];
            if (!p || !p.characterId) { continue; }
            var cid = String(p.characterId);
            var tid = (p.teamId === undefined || p.teamId === null)
                ? '__null__'
                : String(p.teamId);
            keys.push(cid + '::' + tid);
        }
        return keys;
    }

    function sameStringSet(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) {
            return false;
        }
        if (a.length !== b.length) { return false; }

        var setA = Object.create(null);
        for (var i = 0; i < a.length; i++) {
            setA[String(a[i])] = (setA[String(a[i])] || 0) + 1;
        }
        for (var j = 0; j < b.length; j++) {
            var k = String(b[j]);
            if (!setA[k]) { return false; }
            setA[k]--;
        }
        return true;
    }

    function sameObjectives(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) {
            return false;
        }
        if (a.length !== b.length) { return false; }
        for (var i = 0; i < a.length; i++) {
            if (a[i].text !== b[i].text) { return false; }
            if (a[i].done !== b[i].done) { return false; }
        }
        return true;
    }

    // ============================================================
    // PARTICIPANT STAGING
    // ============================================================

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

    function refreshParticipantsPanelFromFormState() {
        if (!state.container) { return; }

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

    function stageParticipant(characterId, teamId, source) {
        if (!characterId) { return; }
        var cid = String(characterId);
        var tid = (teamId === undefined || teamId === null ||
                   teamId === '')
            ? null
            : String(teamId);
        var src = source || (tid === null ? 'rookie' : 'team');

        if (src === 'team' && tid === null) { return; }
        if (src === 'rookie' && tid !== null) { return; }

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

    function handleParticipantToggle(checkbox) {
        if (!checkbox) { return; }

        var missionId = checkbox.dataset.missionId;
        var characterId = checkbox.dataset.characterId;
        var teamId = checkbox.dataset.teamId || '';
        var source = checkbox.dataset.source || 'team';
        var checked = checkbox.checked === true;

        if (!characterId) { return; }

        if (source === 'team' && teamId === '') { return; }

        if (checked) {
            stageParticipant(characterId, teamId, source);
        } else {
            unstageParticipant(characterId, teamId);
        }

        if (!missionId) {
            refreshParticipantsPanelFromFormState();
            return;
        }

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

            if (checked) {
                unstageParticipant(characterId, teamId);
            } else {
                stageParticipant(characterId, teamId, source);
            }

            refreshParticipantsPanelFromFormState();
            notify('Failed to update participant.', 'error');
        });
    }

    function handleRemoveParticipant(
        missionId, characterId, teamIdStr, actionEl
    ) {
        if (!characterId) { return; }

        var teamId = (teamIdStr && teamIdStr !== '')
            ? teamIdStr
            : null;

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

        if (inForm) {
            unstageParticipant(characterId, teamId);
        }

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

        if (teamId) {
            pruneStagedParticipantsForTeam(teamId);
        }
        refreshParticipantsPanelFromFormState();
    }

    // ============================================================
    // EXPORT MODAL (single mission)
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
    // BULK EXPORT MODAL (this revision)
    // ============================================================

    function openBulkExportModal() {
        if (!isContainerAttached()) {
            notifyContainerLost();
            return;
        }

        var ids = Object.keys(_missionSelectedIds)
            .filter(function(k) {
                return _missionSelectedIds[k] === true;
            });

        if (ids.length === 0) {
            notify('Select at least one mission to export.', 'info');
            return;
        }

        ensureBulkExportModalShell(state.container);

        var modal = state.container.querySelector(
            '#mission-bulk-export-modal'
        );
        if (!modal) {
            notify('Could not open the bulk export picker.', 'error');
            return;
        }

        var contentEl = modal.querySelector(
            '.modal-bulk-export-content'
        );
        if (!contentEl) {
            contentEl = document.createElement('div');
            contentEl.className =
                'modal-content modal-bulk-export-content';
            modal.appendChild(contentEl);
        }

        contentEl.innerHTML = buildBulkExportModalHTML(ids.length);
        showModal(modal);
    }

    function buildBulkExportModalHTML(count) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Export ' + count + ' Mission' +
                    (count === 1 ? '' : 's') +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="mission-bulk-export-cancel" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';
        html += '<p class="field-hint" ' +
                    'style="font-size:0.75rem;color:var(--text-dim);' +
                    'margin:0 0 12px 0;line-height:1.5;">' +
                    'Pick a format. Text is a human-readable report ' +
                    'for each mission, one after another in a single ' +
                    'file. JSON is an array of full mission records, ' +
                    'and is the format the import accepts back for ' +
                    'round-tripping.' +
                '</p>';

        html += '<div class="mission-export-formats">';
        html += buildBulkFormatRow(
            'text', 'Text report',
            'All selected missions as one plain-text file.'
        );
        html += buildBulkFormatRow(
            'json', 'JSON',
            'All selected missions as a JSON array of records. ' +
            'Round-trips through the import path.'
        );
        html += '</div>';

        html += '<div id="mission-bulk-export-error" ' +
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
                    'data-action="mission-bulk-export-cancel">' +
                    'Cancel' +
                '</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="mission-bulk-export-submit">' +
                    'Export' +
                '</button>';
        html += '</div>';

        return html;
    }

    function buildBulkFormatRow(value, title, description) {
        var html = '';
        html += '<label class="mission-export-format">';
        html += '<input type="radio" ' +
                    'name="mission-bulk-export-format" ' +
                    'value="' + escapeAttribute(value) + '"' +
                    (value === 'text' ? ' checked' : '') + '>';
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

    function closeBulkExportModal() {
        if (!state.container) { return; }
        var modal = state.container.querySelector(
            '#mission-bulk-export-modal'
        );
        if (!modal) { return; }
        var contentEl = modal.querySelector(
            '.modal-bulk-export-content'
        );
        hideModal(modal);
        if (contentEl) { contentEl.innerHTML = ''; }
    }

    function setBulkExportError(message) {
        if (!state.container) { return; }
        var modal = state.container.querySelector(
            '#mission-bulk-export-modal'
        );
        if (!modal) { return; }
        var errEl = modal.querySelector(
            '#mission-bulk-export-error'
        );
        if (!errEl) { return; }

        if (!message) {
            errEl.style.display = 'none';
            errEl.textContent = '';
            return;
        }
        errEl.textContent = message;
        errEl.style.display = 'block';
    }

    function handleBulkExportSubmit() {
        if (!state.container) { return; }

        var modal = state.container.querySelector(
            '#mission-bulk-export-modal'
        );
        if (!modal) { return; }

        var radio = modal.querySelector(
            'input[name="mission-bulk-export-format"]:checked'
        );
        var format = radio ? String(radio.value || 'text') : 'text';

        var ids = Object.keys(_missionSelectedIds)
            .filter(function(k) {
                return _missionSelectedIds[k] === true;
            });

        if (ids.length === 0) {
            setBulkExportError('No missions selected.');
            return;
        }

        var Exporter = getMissionExport();
        if (!Exporter) {
            setBulkExportError(
                'Mission export module is not loaded. Check the ' +
                'script order in index.html.'
            );
            return;
        }

        var fn = format === 'json'
            ? Exporter.exportMissionsJson
            : Exporter.exportMissionsText;

        if (typeof fn !== 'function') {
            setBulkExportError(
                'The ' + format + ' bulk export is not available.'
            );
            return;
        }

        var result;
        try {
            result = fn.call(Exporter, ids);
        } catch (err) {
            console.warn(
                '[MissionUI] bulk export threw:', err
            );
            setBulkExportError(
                'Export failed: ' +
                (err && err.message ? err.message : String(err))
            );
            return;
        }

        if (result && result.exported) {
            var msg = 'Exported ' + result.count + ' mission' +
                (result.count === 1 ? '' : 's') +
                ': ' + result.filename;
            if (result.skipped > 0) {
                msg += ' (' + result.skipped + ' skipped)';
            }
            notify(msg, 'success');

            _missionSelectedIds = Object.create(null);
            closeBulkExportModal();
            renderListInto(state.container);
            return;
        }

        setBulkExportError(
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
        _missionSelectedIds = Object.create(null);
        _formState.editId = null;
        _formState.participants = [];
        _formState.baseline = null;
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
