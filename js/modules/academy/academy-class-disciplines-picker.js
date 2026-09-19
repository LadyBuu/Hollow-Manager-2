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
 *     - It writes through AcademyClassDisciplines only. It does not
 *       touch any other store.
 *     - It closes on the Close button, on backdrop click, and on
 *       Escape.
 *     - Only one picker modal is open at a time. Opening a second
 *       closes the first.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The class-discipline marker store   (AcademyClassDisciplines)
 *   - The class-discipline marker reads   (AcademyClassDisciplinesQueries)
 *     The picker receives its read data pre-assembled on the VM
 *     from AcademyAggregator. It does not import the queries module
 *     directly; if the VM ever needs a field this modal reads, the
 *     aggregator adds it. The modal stays a pure renderer over the
 *     VM.
 *   - The enrolment store                 (AcademyEnrolments)
 *   - Instructor-of-a-discipline-for-a-class. That relationship is
 *     expressed through enrolments and edited from the character's
 *     own Disciplines tab, not from this picker. The picker does
 *     NOT show, edit, or reference instructors.
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
 *   Both go through MutationPipeline. On success, the VM is
 *   refetched so the row reflects the new state. On failure, the
 *   pipeline has already notified; the modal does not re-render.
 *
 *   The modal has three close paths (Close button, backdrop click,
 *   Escape key), all of which route through closeModal.
 *
 * SELECT ALL / UNSELECT ALL:
 *   Two buttons in the summary row.
 *
 *     Select all    Enrols every currently-unoffered discipline as
 *                   optional (mandatory: false). Skips disciplines
 *                   that are already offered.
 *
 *     Unselect all  Removes every offering. Confirmation is required
 *                   when more than a small threshold of disciplines
 *                   would be affected.
 *
 *   Both are sequential chains of individual mutations. Each
 *   underlying write is atomic; the bulk operation as a whole is not
 *   transactional, because a partial success with clear failure
 *   feedback is better than a hard rollback that discards successful
 *   writes.
 *
 *   While a bulk operation is running, the picker's interactivity is
 *   suspended (a running flag). Clicks during the run are ignored;
 *   the "Select all" / "Unselect all" buttons show as disabled.
 *
 * LISTENER DISCIPLINE:
 *   Content listeners (delegated change + click) are bound ONCE, on
 *   the modal's content element, when the modal is created. Every
 *   render replaces the content's innerHTML but does not rebind.
 *
 *   Modal-level listeners (Escape and click-outside) are installed
 *   by Modal.modalSetup, which is idempotent per modal. The picker
 *   passes its closeModal as the setup callback so that Modal's
 *   handlers route through the picker's cleanup path.
 *
 * ROW LAYOUT:
 *   Each discipline row is:
 *
 *     [checkbox]  [name]  [week window badge]  [mandatory checkbox]  [Mandatory label]
 *
 *   The mandatory checkbox and label only appear when the discipline
 *   is offered. Unoffered rows carry only the checkbox and the name.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyAggregator
 *   - window.AcademyClassDisciplines
 *
 * USAGE:
 *   var Picker = window.AcademyClassDisciplinesPicker;
 *
 *   Picker.openModal('class_123', {
 *       week: 5,
 *       onClose: function() {
 *           // re-render the class detail panel
 *       }
 *   });
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

    // Threshold for confirming a bulk operation. Below this, the
    // bulk happens without a confirm dialog. Above it, the user is
    // asked first.
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

    // True while a bulk operation is running. Clicks that would
    // issue new mutations are ignored during the run; the Select
    // all / Unselect all buttons render disabled.
    var _busy = false;

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
     *   modal closes for any reason. The caller uses this to
     *   re-render the class detail panel.
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

        var vm = null;
        try {
            vm = AcademyAggregator.getClassDisciplinesPickerViewModel(
                _classId,
                { week: _week }
            );
        } catch (e) {
            console.warn(
                '[AcademyClassDisciplinesPicker] ' +
                'getClassDisciplinesPickerViewModel threw:', e
            );
        }

        if (!vm) {
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

        _contentChangeHandler = handleContentChange;
        _contentClickHandler = handleContentClick;
        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('click', _contentClickHandler);

        renderContent(vm);

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

        _modal = null;
        _contentEl = null;
        _classId = null;
        _week = null;
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
        _busy = false;

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
        _busy = false;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent(vm) {
        if (!_contentEl || !vm) { return; }
        _contentEl.innerHTML = buildModalHTML(vm);
    }

    function refetchAndRender() {
        if (!_contentEl || !_classId) { return; }

        var vm = null;
        try {
            vm = AcademyAggregator.getClassDisciplinesPickerViewModel(
                _classId,
                { week: _week }
            );
        } catch (e) {
            console.warn(
                '[AcademyClassDisciplinesPicker] ' +
                'refetch getClassDisciplinesPickerViewModel threw:', e
            );
        }

        if (!vm) {
            notify('Failed to refresh picker.', 'error');
            closeModal();
            return;
        }

        renderContent(vm);
    }

    // ============================================================
    // HTML
    // ============================================================

    function buildModalHTML(vm) {
        var disciplines = Array.isArray(vm.disciplines)
            ? vm.disciplines
            : [];

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
        var busyAttr = _busy ? ' disabled' : '';

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
                    'data-picker-action="select-all"' + busyAttr + '>' +
                    'Select all' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-picker-action="unselect-all"' + busyAttr + '>' +
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
        var busyAttr = _busy ? ' disabled' : '';

        var rowClasses = 'academy-picker-row';
        if (offered) { rowClasses += ' academy-picker-row-offered'; }

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
                    busyAttr + '>';
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
                        busyAttr + '>';
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

        if (action === 'toggle-offered') {
            e.preventDefault();
            handleToggleOffered(
                target.dataset.disciplineId,
                target.checked
            );
            return;
        }

        if (action === 'toggle-mandatory') {
            e.preventDefault();
            handleToggleMandatory(
                target.dataset.disciplineId,
                target.checked
            );
            return;
        }
    }

    // ============================================================
    // WRITE HANDLERS
    // ============================================================

    function handleToggleOffered(disciplineId, checked) {
        if (!_classId || !isNonEmptyString(disciplineId)) { return; }

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
            if (result && result.success) {
                refetchAndRender();
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyClassDisciplinesPicker] ' +
                'toggle-offered failed:', err
            );
            notify('Failed to update the class-discipline.', 'error');
        });
    }

    function handleToggleMandatory(disciplineId, checked) {
        if (!_classId || !isNonEmptyString(disciplineId)) { return; }

        AcademyClassDisciplines.setClassDiscipline(
            _classId,
            disciplineId,
            { mandatory: checked }
        ).then(function(result) {
            if (result && result.success) {
                refetchAndRender();
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyClassDisciplinesPicker] ' +
                'toggle-mandatory failed:', err
            );
            notify('Failed to update the class-discipline.', 'error');
        });
    }

    // ============================================================
    // SELECT ALL / UNSELECT ALL
    // ============================================================

    function handleSelectAll() {
        if (!_classId || _busy) { return; }

        var vm = null;
        try {
            vm = AcademyAggregator.getClassDisciplinesPickerViewModel(
                _classId,
                { week: _week }
            );
        } catch (e) {
            vm = null;
        }

        if (!vm) {
            notify('Failed to refresh picker.', 'error');
            return;
        }

        var targets = [];
        var disciplines = Array.isArray(vm.disciplines)
            ? vm.disciplines
            : [];
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

        var vm = null;
        try {
            vm = AcademyAggregator.getClassDisciplinesPickerViewModel(
                _classId,
                { week: _week }
            );
        } catch (e) {
            vm = null;
        }

        if (!vm) {
            notify('Failed to refresh picker.', 'error');
            return;
        }

        var targets = [];
        var disciplines = Array.isArray(vm.disciplines)
            ? vm.disciplines
            : [];
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
     * Each thunk returns a Promise<{success, message?}>. Failures
     * are collected. At the end:
     *   - If no failures: optionally notify a success message, and
     *     refetch-and-render.
     *   - If any failures: notify the failure message with the
     *     count, log details, and still refetch-and-render so the
     *     modal reflects whatever succeeded.
     *
     * While the chain runs, `_busy` is true. The rendered modal
     * shows disabled controls. `renderContent` is not called until
     * the chain completes, so the DOM stays stable during the run.
     *
     * @param {array} thunks
     * @param {string} successMessage
     * @param {string} failureMessage
     */
    function runBulk(thunks, successMessage, failureMessage) {
        _busy = true;

        // Re-render immediately so the buttons show disabled state.
        // This does not refetch the VM; it reuses the last-rendered
        // state, which is safe because only `_busy` changed.
        var currentVM = null;
        try {
            currentVM = AcademyAggregator.getClassDisciplinesPickerViewModel(
                _classId,
                { week: _week }
            );
        } catch (e) {
            currentVM = null;
        }
        if (currentVM) {
            renderContent(currentVM);
        }

        var failures = [];
        var chain = Promise.resolve();

        thunks.forEach(function(thunk) {
            chain = chain.then(function() {
                return thunk();
            }).then(function(result) {
                if (!result || !result.success) {
                    failures.push({
                        message: (result && result.message) ||
                            'Unknown error'
                    });
                }
            }).catch(function(err) {
                failures.push({
                    message: String(err && err.message || err)
                });
            });
        });

        chain.then(function() {
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

            // Refetch the VM and re-render. This reflects every
            // write that succeeded and clears the disabled state
            // on every control.
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