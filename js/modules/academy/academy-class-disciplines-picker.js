/**
 * modules/academy/academy-class-disciplines-picker.js
 * Academy Class-Disciplines Picker — modal renderer
 *
 * Path: js/modules/academy/academy-class-disciplines-picker.js
 *
 * WHAT THIS MODULE OWNS:
 *   The modal that lets a user say which disciplines a class
 *   offers, and mark each offered discipline as mandatory or
 *   optional for this class.
 *
 *   The modal is opened from the class detail panel
 *   (academy-class-detail.js) via the "+ Disciplines" button, which
 *   emits data-action="edit-class-disciplines". The Academy People
 *   controller routes that action to openModal(classId).
 *
 *   Modal lifecycle:
 *     - The picker creates its own .modal shell, appended to
 *       document.body, so it survives a re-render of the People
 *       view's content host.
 *     - It reads its VM from
 *       AcademyAggregator.getClassDisciplinesPickerViewModel(classId,
 *       { week }).
 *     - It writes through AcademyClassDisciplines only.
 *     - It closes on the Close button, on backdrop click, and on
 *       Escape.
 *     - Only one picker modal is open at a time. Opening a second
 *       closes the first.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The class-discipline marker store   (AcademyClassDisciplines)
 *   - The class-discipline marker reads   (AcademyClassDisciplinesQueries)
 *   - The enrolment store                 (AcademyEnrolments)
 *   - Instructor-of-a-discipline-for-a-class. That relationship is
 *     expressed through enrolments and edited from the character's
 *     own Disciplines tab, not from this picker.
 *   - The global discipline list          (AcademyDisciplines)
 *   - The class detail panel              (AcademyClassDetail)
 *   - The People controller               (AcademyPeopleController)
 *
 * WRITE SEMANTICS:
 *   Every toggle writes immediately. There is no Save button, no
 *   pending state, no deferred flush.
 *
 *     Checkbox toggle
 *       -> AcademyClassDisciplines.setClassDiscipline /
 *          .removeClassDiscipline
 *
 *     Mandatory toggle
 *       -> AcademyClassDisciplines.setClassDiscipline with the
 *          mandatory flag flipped.
 *
 *   Both go through MutationPipeline. On success AND on failure,
 *   the VM is refetched so the row reflects the domain's actual
 *   state. The domain is authoritative; the UI returns to it.
 *
 * ASYNC SAFETY:
 *   Every asynchronous callback captures the current
 *   `_instanceToken`. If a new modal has been opened (or the
 *   current one closed) before the callback runs, the callback is
 *   a no-op. This prevents stale operations from touching a fresh
 *   modal.
 *
 *   The same token guards per-row mutations and bulk operations.
 *
 * PER-ROW LOCK:
 *   A discipline whose mutation is in flight is tracked in
 *   `_pendingDisciplineIds`. Clicks on that row are ignored until
 *   the mutation completes. Other rows remain interactive.
 *   The locked row renders disabled.
 *
 * BULK OPERATIONS:
 *   Select all / Unselect all are sequential chains of individual
 *   mutations. Each underlying write is atomic; the bulk operation
 *   as a whole is not transactional. Partial success with clear
 *   failure feedback is the outcome.
 *
 *   While a bulk runs, `_busy` is true and all interactive
 *   controls render disabled.
 *
 * VM CONTRACT:
 *   The aggregator's contract is strict: `vm.disciplines` is an
 *   array. A malformed VM is reported as an error, not silently
 *   rendered as "no disciplines exist yet." A throw from the
 *   aggregator propagates as a visible error; it is not translated
 *   into "class not found."
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyAggregator
 *   - window.AcademyClassDisciplines
 */

(function() {
    'use strict';

    if (window.__academyClassDisciplinesPickerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyClassDisciplines = window.AcademyClassDisciplines;

    var _missing = [];

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassDisciplinesPickerViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassDisciplinesPickerViewModel');
    }
    if (!AcademyClassDisciplines ||
        typeof AcademyClassDisciplines.setClassDiscipline !== 'function' ||
        typeof AcademyClassDisciplines.removeClassDiscipline !== 'function') {
        _missing.push('AcademyClassDisciplines mutations');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyClassDisciplinesPicker] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyClassDisciplinesPickerLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    // Threshold for confirming a bulk operation. Above this, the
    // user is asked first.
    var BULK_CONFIRM_THRESHOLD = 5;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _classId = null;
    var _week = null;
    var _onClose = null;

    var _contentChangeHandler = null;
    var _contentClickHandler = null;

    // The last authoritative VM. Re-rendered on busy-state changes
    // without refetching.
    var _vm = null;

    // Bulk operation in flight. When true, all interactive controls
    // render disabled.
    var _busy = false;

    // Per-discipline lock. A discipline ID in this set has a
    // mutation in flight; its row renders disabled and clicks on it
    // are ignored.
    var _pendingDisciplineIds = Object.create(null);

    // Instance token. Incremented on each open. Asynchronous
    // callbacks compare their captured token against this value and
    // become no-ops when it has changed.
    var _instanceToken = 0;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function isOffered(row) {
        return row && row.offered === true;
    }

    function isRowLocked(disciplineId) {
        return _pendingDisciplineIds[String(disciplineId)] === true;
    }

    function acquireRowLock(disciplineId) {
        _pendingDisciplineIds[String(disciplineId)] = true;
    }

    function releaseRowLock(disciplineId) {
        delete _pendingDisciplineIds[String(disciplineId)];
    }

    function hasAnyRowLock() {
        return Object.keys(_pendingDisciplineIds).length > 0;
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the class-disciplines picker for a class.
     *
     * @param {string} classId
     * @param {object} [options]
     * @param {number} [options.week]     - Display week for
     *   `activeInWeek` badges. Optional.
     * @param {function} [options.onClose] - Called once, when the
     *   modal closes for any reason.
     * @returns {object|null} The modal element, or null on failure
     */
    function openModal(classId, options) {
        if (!isNonEmptyString(classId)) {
            notify('Class ID is required.', 'error');
            return null;
        }

        closeModal();

        options = options || {};

        _classId = String(classId);
        _week = (typeof options.week === 'number' && isFinite(options.week))
            ? options.week
            : null;
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;
        _busy = false;
        _pendingDisciplineIds = Object.create(null);
        _vm = null;

        // Bump the instance token. Any callback that fires from a
        // previous instance becomes a no-op.
        _instanceToken++;
        var myToken = _instanceToken;

        var vm = fetchVM();
        if (vm === null) {
            notify('Class not found.', 'error');
            resetState();
            return null;
        }

        var modal = Modal.createModal(
            'academy-class-disciplines-picker-modal'
        );
        if (!modal) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        modal.id = 'academy-class-disciplines-picker-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        modal.appendChild(contentEl);

        _modal = modal;
        _contentEl = contentEl;
        _vm = vm;

        _contentChangeHandler = handleContentChange;
        _contentClickHandler = handleContentClick;
        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('click', _contentClickHandler);

        renderContent();
        void myToken;

        Modal.modalSetup(modal, function() {
            closeModal();
        });
        Modal.showModal(modal);

        return modal;
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;
        var onClose = _onClose;

        if (contentEl && _contentChangeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _contentChangeHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }

        // Invalidate any in-flight callbacks.
        _instanceToken++;

        resetState();

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }

        if (onClose) {
            try {
                onClose();
            } catch (e) {
                console.warn(
                    '[AcademyClassDisciplinesPicker] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _classId = null;
        _week = null;
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
        _vm = null;
        _busy = false;
        _pendingDisciplineIds = Object.create(null);
    }

    // ============================================================
    // VM FETCH
    // ============================================================
    //
    // Distinguishes three outcomes:
    //   - a well-formed VM (returns the VM)
    //   - the aggregator returned null (returns null → class
    //     missing)
    //   - the aggregator threw (propagates)
    //
    // The caller decides what to do. The picker does not translate
    // a throw into "class not found."

    function fetchVM() {
        if (!_classId) { return null; }

        var vm = AcademyAggregator.getClassDisciplinesPickerViewModel(
            _classId,
            { week: _week }
        );

        if (vm === null || vm === undefined) {
            return null;
        }

        if (!Array.isArray(vm.disciplines)) {
            throw new Error(
                '[AcademyClassDisciplinesPicker] Aggregator returned a ' +
                'VM whose `disciplines` field is not an array. ' +
                'The VM contract requires an array.'
            );
        }

        return vm;
    }

    function refetchAndRender() {
        if (!_contentEl || !_classId) { return; }

        var vm;
        try {
            vm = fetchVM();
        } catch (e) {
            console.warn(
                '[AcademyClassDisciplinesPicker] refetch failed:', e
            );
            notify('Failed to refresh picker.', 'error');
            closeModal();
            return;
        }

        if (vm === null) {
            notify('Class no longer exists.', 'error');
            closeModal();
            return;
        }

        _vm = vm;
        renderContent();
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl || !_vm) { return; }
        _contentEl.innerHTML = buildModalHTML(_vm);
    }

    // ============================================================
    // HTML
    // ============================================================

    function buildModalHTML(vm) {
        var disciplines = vm.disciplines;

        var offeredCount = countOffered(disciplines);
        var totalCount = disciplines.length;

        var html = '';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>' +
                    'Disciplines for ' +
                    DomUtils.escapeHtml(vm.className || 'Class') +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-picker-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body">';

        if (totalCount === 0) {
            html += '<p class="empty-state">' +
                        'No disciplines exist yet. Create a discipline ' +
                        'first from the Disciplines view.' +
                    '</p>';
        } else {
            html += renderSummaryRow(offeredCount, totalCount);
            html += '<div class="academy-picker-list">';
            for (var i = 0; i < disciplines.length; i++) {
                html += renderDisciplineRow(disciplines[i]);
            }
            html += '</div>';
        }

        html += '</div>';

        // ---- Footer ----
        html += '<div class="modal-footer academy-picker-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-picker-action="close">Close</button>';
        html += '</div>';

        return html;
    }

    function renderSummaryRow(offeredCount, totalCount) {
        // Bulk buttons are disabled while a bulk operation runs.
        // They are NOT disabled for per-row locks: a row lock does
        // not block the bulk buttons, and a bulk operation that
        // touches a locked row is prevented at the write handler,
        // not by greying out the button.
        var disabledAttr = _busy ? ' disabled' : '';

        var html = '';
        html += '<div class="academy-picker-summary">';
        html += '<span class="academy-picker-summary-label">' +
                    'Offered by this class:' +
                '</span> ';
        html += '<span class="academy-picker-summary-count">' +
                    offeredCount +
                '</span> of ';
        html += '<span class="academy-picker-summary-total">' +
                    totalCount +
                '</span>';

        html += '<div class="academy-picker-bulk-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-picker-action="select-all"' +
                    disabledAttr + '>' +
                    'Select all' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-picker-action="unselect-all"' +
                    disabledAttr + '>' +
                    'Unselect all' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function countOffered(disciplines) {
        var n = 0;
        for (var i = 0; i < disciplines.length; i++) {
            if (isOffered(disciplines[i])) { n++; }
        }
        return n;
    }

    function renderDisciplineRow(row) {
        if (!row || !row.id) { return ''; }

        var offered = isOffered(row);

        // A row is disabled while EITHER a bulk operation is
        // running OR this specific row has a mutation in flight.
        var disabled = _busy || isRowLocked(row.id);
        var disabledAttr = disabled ? ' disabled' : '';

        var rowClasses = 'academy-picker-row';
        if (offered) { rowClasses += ' academy-picker-row-offered'; }
        if (isRowLocked(row.id)) {
            rowClasses += ' academy-picker-row-busy';
        }

        var html = '';
        html += '<div class="' + rowClasses + '" ' +
                    'data-discipline-id="' +
                        DomUtils.escapeAttribute(row.id) + '">';

        // ---- Discipline checkbox + name ----
        html += '<label class="academy-picker-checkbox-label">';
        html += '<input type="checkbox" ' +
                    'class="academy-picker-checkbox" ' +
                    'data-picker-action="toggle-offered" ' +
                    'data-discipline-id="' +
                        DomUtils.escapeAttribute(row.id) + '"' +
                    (offered ? ' checked' : '') +
                    disabledAttr + '>';
        html += '<span class="academy-picker-discipline-name">' +
                    DomUtils.escapeHtml(row.name) +
                '</span>';
        html += '</label>';

        // ---- Week window badge ----
        if (row.startWeek !== null && row.startWeek !== undefined) {
            var windowLabel = formatWindowLabel(row);
            var isActive = row.activeInWeek === true;
            html += '<span class="academy-picker-window-badge' +
                        (isActive
                            ? ' academy-picker-window-active'
                            : ' academy-picker-window-inactive') +
                        '">' +
                        DomUtils.escapeHtml(windowLabel) +
                    '</span>';
        } else {
            html += '<span class="academy-picker-window-badge ' +
                        'academy-picker-window-inactive">' +
                        'No window' +
                    '</span>';
        }

        // ---- Mandatory checkbox + label. Only on offered rows. ----
        if (offered) {
            html += '<label class="academy-picker-mandatory-inline">';
            html += '<input type="checkbox" ' +
                        'class="academy-picker-mandatory-checkbox" ' +
                        'data-picker-action="toggle-mandatory" ' +
                        'data-discipline-id="' +
                            DomUtils.escapeAttribute(row.id) + '"' +
                        (row.mandatory ? ' checked' : '') +
                        disabledAttr + '>';
            html += '<span class="academy-picker-mandatory-label">' +
                        'Mandatory' +
                    '</span>';
            html += '</label>';
        }

        html += '</div>';
        return html;
    }

    function formatWindowLabel(row) {
        var s = row.startWeek;
        var e = row.endWeek;
        if (e === null || e === undefined) {
            return 'From wk ' + s;
        }
        return 'Wk ' + s + '\u2013' + e;
    }

    // ============================================================
    // CONTENT EVENT HANDLERS
    // ============================================================

    function handleContentClick(e) {
        // Bulk operations block all click actions.
        if (_busy) {
            e.preventDefault();
            return;
        }

        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var btn = target.closest('[data-picker-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.pickerAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'select-all') {
            e.preventDefault();
            handleSelectAll();
            return;
        }

        if (action === 'unselect-all') {
            e.preventDefault();
            handleUnselectAll();
            return;
        }
    }

    function handleContentChange(e) {
        if (_busy) {
            e.preventDefault();
            return;
        }

        var target = e.target;
        if (!target || !target.dataset) { return; }

        var action = target.dataset.pickerAction;
        var disciplineId = target.dataset.disciplineId;

        if (action === 'toggle-offered') {
            e.preventDefault();
            handleToggleOffered(disciplineId, target.checked);
            return;
        }

        if (action === 'toggle-mandatory') {
            e.preventDefault();
            handleToggleMandatory(disciplineId, target.checked);
            return;
        }
    }

    // ============================================================
    // WRITE HANDLERS — PER-ROW
    // ============================================================

    function handleToggleOffered(disciplineId, checked) {
        if (!_classId || !isNonEmptyString(disciplineId)) { return; }

        // Row lock: ignore repeat clicks while a write for this
        // discipline is in flight.
        if (isRowLocked(disciplineId)) {
            // Restore the input to its prior value. The domain
            // state has not changed.
            refetchAndRender();
            return;
        }

        acquireRowLock(disciplineId);
        renderContent(); // reflect the lock immediately

        var promise;

        if (checked) {
            promise = AcademyClassDisciplines.setClassDiscipline(
                _classId,
                disciplineId,
                {}
            );
        } else {
            promise = AcademyClassDisciplines.removeClassDiscipline(
                _classId,
                disciplineId
            );
        }

        promise.then(function(result) {
            releaseRowLock(disciplineId);

            if (result && result.success) {
                refetchAndRender();
                return;
            }

            // Failure. Domain state is authoritative. Refetch so
            // the checkbox returns to the real value.
            if (result && result.message) {
                notify(result.message, 'error');
            }
            refetchAndRender();
        }).catch(function(err) {
            releaseRowLock(disciplineId);
            console.warn(
                '[AcademyClassDisciplinesPicker] ' +
                'toggle-offered failed:', err
            );
            notify('Failed to update the class-discipline.', 'error');
            refetchAndRender();
        });
    }

    function handleToggleMandatory(disciplineId, checked) {
        if (!_classId || !isNonEmptyString(disciplineId)) { return; }

        if (isRowLocked(disciplineId)) {
            refetchAndRender();
            return;
        }

        acquireRowLock(disciplineId);
        renderContent();

        AcademyClassDisciplines.setClassDiscipline(
            _classId,
            disciplineId,
            { mandatory: checked }
        ).then(function(result) {
            releaseRowLock(disciplineId);

            if (result && result.success) {
                refetchAndRender();
                return;
            }

            if (result && result.message) {
                notify(result.message, 'error');
            }
            refetchAndRender();
        }).catch(function(err) {
            releaseRowLock(disciplineId);
            console.warn(
                '[AcademyClassDisciplinesPicker] ' +
                'toggle-mandatory failed:', err
            );
            notify('Failed to update the class-discipline.', 'error');
            refetchAndRender();
        });
    }

    // ============================================================
    // SELECT ALL / UNSELECT ALL
    // ============================================================

    function handleSelectAll() {
        if (!_classId || _busy) { return; }

        // Row locks in flight: the bulk operation should not race
        // with them. Refuse to start.
        if (hasAnyRowLock()) {
            notify(
                'Wait for the current update to finish before running ' +
                'a bulk operation.',
                'info'
            );
            return;
        }

        var vm = _vm;
        if (!vm) { return; }

        var targets = [];
        var disciplines = vm.disciplines;
        for (var i = 0; i < disciplines.length; i++) {
            var row = disciplines[i];
            if (!row || !row.id) { continue; }
            if (row.offered === true) { continue; }
            targets.push(row.id);
        }

        if (targets.length === 0) {
            notify('Every discipline is already offered.', 'info');
            return;
        }

        if (targets.length > BULK_CONFIRM_THRESHOLD) {
            if (!confirm(
                'Offer all ' + targets.length +
                ' remaining disciplines for this class?'
            )) {
                return;
            }
        }

        runBulk(
            targets.map(function(id) {
                return function() {
                    return AcademyClassDisciplines.setClassDiscipline(
                        _classId,
                        id,
                        {}
                    );
                };
            }),
            'Added ' + targets.length + ' offering(s).',
            'Failed to add some offerings.'
        );
    }

    function handleUnselectAll() {
        if (!_classId || _busy) { return; }

        if (hasAnyRowLock()) {
            notify(
                'Wait for the current update to finish before running ' +
                'a bulk operation.',
                'info'
            );
            return;
        }

        var vm = _vm;
        if (!vm) { return; }

        var targets = [];
        var disciplines = vm.disciplines;
        for (var i = 0; i < disciplines.length; i++) {
            var row = disciplines[i];
            if (!row || !row.id) { continue; }
            if (row.offered !== true) { continue; }
            targets.push(row.id);
        }

        if (targets.length === 0) {
            notify('This class offers nothing to remove.', 'info');
            return;
        }

        if (targets.length > BULK_CONFIRM_THRESHOLD) {
            if (!confirm(
                'Remove all ' + targets.length +
                ' offerings from this class?'
            )) {
                return;
            }
        }

        runBulk(
            targets.map(function(id) {
                return function() {
                    return AcademyClassDisciplines.removeClassDiscipline(
                        _classId,
                        id
                    );
                };
            }),
            'Removed ' + targets.length + ' offering(s).',
            'Failed to remove some offerings.'
        );
    }

    /**
     * Run a list of mutation-thunks sequentially.
     *
     * The instance token is captured at the start. Every thunk and
     * every completion callback checks that the token is still
     * current; if the modal has been closed or replaced, the run
     * stops and no further UI updates happen.
     *
     * `_busy` is set for the duration. The rendered modal shows
     * disabled controls. The bulk completes with a summary notify,
     * then refetches and re-renders.
     *
     * The bulk operation as a whole is not transactional. Each
     * underlying write is atomic; partial success is possible and
     * is reported.
     */
    function runBulk(thunks, successMessage, failureMessage) {
        var myToken = _instanceToken;

        _busy = true;
        renderContent();

        var failures = [];
        var chain = Promise.resolve();

        thunks.forEach(function(thunk) {
            chain = chain.then(function() {
                if (myToken !== _instanceToken) {
                    return;
                }
                return thunk();
            }).then(function(result) {
                if (myToken !== _instanceToken) {
                    return;
                }
                if (!result || !result.success) {
                    failures.push({
                        message: (result && result.message) ||
                            'Unknown error'
                    });
                }
            }).catch(function(err) {
                if (myToken !== _instanceToken) {
                    return;
                }
                failures.push({
                    message: String(err && err.message || err)
                });
            });
        });

        chain.then(function() {
            if (myToken !== _instanceToken) {
                return;
            }

            _busy = false;

            if (failures.length === 0) {
                notify(successMessage, 'success');
            } else {
                notify(
                    failureMessage + ' (' + failures.length +
                    ' failed). See console for details.',
                    'error'
                );
                for (var i = 0; i < failures.length; i++) {
                    console.warn(
                        '[AcademyClassDisciplinesPicker] bulk failure:',
                        failures[i]
                    );
                }
            }

            refetchAndRender();
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClassDisciplinesPicker = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyClassDisciplinesPicker;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyClassDisciplinesPicker] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
