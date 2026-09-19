/**
 * modules/academy/academy-class-disciplines-picker.js
 * Academy Class-Disciplines Picker — modal renderer
 *
 * Path: js/modules/academy/academy-class-disciplines-picker.js
 *
 * WHAT THIS MODULE OWNS:
 *   The modal that lets a user say which disciplines a class
 *   offers, mark each as mandatory or optional for this class, and
 *   assign instructors to each offered discipline.
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
 *     - It writes through AcademyClassDisciplines and
 *       AcademyEnrolments. It does not write anywhere else.
 *     - It closes on save, on cancel, on backdrop click, and on
 *       Escape.
 *     - Only one picker modal is open at a time. Opening a second
 *       closes the first.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The class-discipline marker store  (AcademyClassDisciplines)
 *   - The enrolment store                (AcademyEnrolments)
 *   - The global discipline list         (AcademyDisciplines)
 *   - The class detail panel             (AcademyClassDetail)
 *   - The People controller              (AcademyPeopleController)
 *   - Rendering the People view
 *
 * WRITE SEMANTICS (why this module has two modes):
 *
 *   A class-discipline marker carries exactly two fields: identity
 *   and `mandatory`. It does NOT carry an instructor list. That
 *   relationship lives in the enrolment store.
 *
 *   The picker therefore writes to TWO stores, and the two writes
 *   are decoupled:
 *
 *     1. Checkbox toggle and mandatory toggle
 *          -> AcademyClassDisciplines.setClassDiscipline /
 *             .removeClassDiscipline
 *          Saved immediately. On success, the VM is refetched so the
 *          row reflects the new state.
 *
 *     2. Instructor assignment
 *          -> AcademyEnrolments.enrol / .leave
 *          Deferred until the Save button is pressed. Instructor
 *          edits are held in memory as a pending change set, and
 *          flushed in one sequence when Save is pressed.
 *
 *   The asymmetry is deliberate. A checkbox toggle is a single
 *   decision and there is no partial state to lose. Instructor
 *   assignment is a set of decisions (who, which discipline, enrol
 *   or leave) and bouncing the modal per toggle would fight the
 *   user's flow.
 *
 * INSTRUCTOR ENROLMENT WINDOW:
 *   Instructor enrolments use the DISCIPLINE's window, matching
 *   addClassDiscipline's auto-enrolment window. A discipline with
 *   startWeek 1 and endWeek 24 produces instructor enrolments
 *   spanning weeks 1–24.
 *
 *   The picker therefore does not take or need the display week for
 *   instructor writes. It DOES take the display week for
 *   `activeInWeek` display badges, because "is this offering active
 *   right now?" is a display question, not a write question.
 *
 *   When the discipline has no valid startWeek, the picker refuses
 *   to enrol instructors and shows an inline hint on that row. The
 *   user is expected to fix the discipline's start week in the
 *   Disciplines view before assigning instructors to it.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyAggregator
 *   - window.AcademyClassDisciplines
 *   - window.AcademyEnrolments
 *   - window.AcademyDisciplines
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
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademyDisciplines = window.AcademyDisciplines;

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
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.enrol !== 'function' ||
        typeof AcademyEnrolments.leave !== 'function') {
        _missing.push('AcademyEnrolments mutations');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyClassDisciplinesPicker] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyClassDisciplinesPickerLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // The picker is modal-singleton: at most one instance is open at
    // a time. The state below describes that instance.

    var _modal = null;
    var _classId = null;
    var _week = null;
    var _onClose = null;
    var _boundHandlers = null;

    // Pending instructor changes.
    //
    // Keyed by composite: `${disciplineId}::${instructorId}`.
    // Value: 'enrol' | 'leave'
    //
    // A pending 'enrol' means: this instructor should be enrolled in
    // this discipline for this class. A pending 'leave' means: this
    // instructor should be removed from this discipline for this
    // class.
    //
    // When a discipline is unchecked, all its pending instructor
    // changes are dropped (the discipline is no longer offered, so
    // instructor assignment is meaningless).
    //
    // When an instructor is toggled twice back to their original
    // state, the pending entry is removed rather than left as a
    // no-op. This keeps the Save button's "there are unsaved
    // changes" state accurate.
    var _pendingInstructorChanges = Object.create(null);

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function makePendingKey(disciplineId, instructorId) {
        return String(disciplineId) + '::' + String(instructorId);
    }

    function hasPendingInstructorChanges() {
        return Object.keys(_pendingInstructorChanges).length > 0;
    }

    function clearPendingInstructorChanges() {
        _pendingInstructorChanges = Object.create(null);
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
     *   `activeInWeek` badges. Optional; when absent, no row shows
     *   as active.
     * @param {function} [options.onClose] - Called once, when the
     *   modal closes for any reason (save, cancel, backdrop, Escape).
     *   The caller uses this to re-render the class detail panel.
     * @returns {object|null} The modal element, or null on failure
     */
    function openModal(classId, options) {
        if (!isNonEmptyString(classId)) {
            notify('Class ID is required.', 'error');
            return null;
        }

        // Close any prior instance cleanly.
        closeModal();

        options = options || {};

        _classId = String(classId);
        _week = (typeof options.week === 'number' && isFinite(options.week))
            ? options.week
            : null;
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        clearPendingInstructorChanges();

        // Fetch the VM. When the class does not exist, bail out.
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

        // Create the modal shell.
        var modal = Modal.createModal('academy-class-disciplines-picker-modal');
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

        renderIntoContent(contentEl, vm);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        bindModalHandlers(modal, contentEl);

        return modal;
    }

    function closeModal() {
        var modal = _modal;
        var onClose = _onClose;

        _modal = null;
        _classId = null;
        _week = null;
        _onClose = null;

        unbindModalHandlers();
        clearPendingInstructorChanges();

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
        _classId = null;
        _week = null;
        _onClose = null;
        unbindModalHandlers();
        clearPendingInstructorChanges();
    }

    // ============================================================
    // RENDER
    // ============================================================
    //
    // The render is a full re-render of the modal's content. Every
    // mutation that succeeds triggers a VM refetch and a re-render.
    // The picker holds no DOM state across mutations; it re-reads
    // everything.

    function renderIntoContent(contentEl, vm) {
        if (!contentEl || !vm) { return; }

        contentEl.innerHTML = buildModalHTML(vm);
        bindContentHandlers(contentEl);
    }

    function refetchAndRender() {
        if (!_modal || !_classId) { return; }

        var contentEl = _modal.querySelector('.modal-content');
        if (!contentEl) { return; }

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

        renderIntoContent(contentEl, vm);
    }

    // ============================================================
    // HTML
    // ============================================================

    function buildModalHTML(vm) {
        var disciplines = Array.isArray(vm.disciplines)
            ? vm.disciplines
            : [];

        var unsaved = hasPendingInstructorChanges();

        var html = '';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>' +
                    'Disciplines for ' +
                    DomUtils.escapeHtml(vm.className || 'Class') +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-picker-action="cancel" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body">';

        if (disciplines.length === 0) {
            html += '<p class="empty-state">' +
                        'No disciplines exist yet. Create a discipline ' +
                        'first from the Disciplines view.' +
                    '</p>';
        } else {
            html += '<div class="academy-picker-summary">' +
                        '<span class="academy-picker-summary-label">' +
                            'Offered by this class:' +
                        '</span> ' +
                        '<span class="academy-picker-summary-count">' +
                            countOffered(disciplines) +
                        '</span> of ' +
                        '<span class="academy-picker-summary-total">' +
                            disciplines.length +
                        '</span>';
                    '</div>';

            html += '<div class="academy-picker-list">';

            for (var i = 0; i < disciplines.length; i++) {
                html += renderDisciplineRow(disciplines[i]);
            }

            html += '</div>';
        }

        if (unsaved) {
            html += '<div class="academy-picker-unsaved">' +
                        'Instructor changes are pending. ' +
                        'Press Save to commit them.' +
                    '</div>';
        }

        html += '</div>';

        // ---- Footer ----
        html += '<div class="modal-footer academy-picker-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-picker-action="cancel">Cancel</button>';
        html += '<button type="button" class="primary" ' +
                    'data-picker-action="save"' +
                    (unsaved ? '' : ' disabled') +
                    '>Save</button>';
        html += '</div>';

        return html;
    }

    function countOffered(disciplines) {
        var n = 0;
        for (var i = 0; i < disciplines.length; i++) {
            if (disciplines[i] && disciplines[i].offered) { n++; }
        }
        return n;
    }

    function renderDisciplineRow(row) {
        if (!row || !row.id) { return ''; }

        var isOffered = row.offered === true;

        var rowClasses = 'academy-picker-row';
        if (isOffered) { rowClasses += ' academy-picker-row-offered'; }

        var html = '';
        html += '<div class="' + rowClasses + '" ' +
                    'data-discipline-id="' +
                        DomUtils.escapeAttribute(row.id) + '">';

        // ---- Checkbox + name + type badge ----
        html += '<div class="academy-picker-row-header">';

        html += '<label class="academy-picker-checkbox-label">';
        html += '<input type="checkbox" ' +
                    'class="academy-picker-checkbox" ' +
                    'data-picker-action="toggle-offered" ' +
                    'data-discipline-id="' +
                        DomUtils.escapeAttribute(row.id) + '"' +
                    (isOffered ? ' checked' : '') + '>';
        html += '<span class="academy-picker-discipline-name">' +
                    DomUtils.escapeHtml(row.name) +
                '</span>';
        html += '</label>';

        html += '<span class="academy-picker-type-badge ' +
                    getTypeBadgeClass(row.type) + '">' +
                    DomUtils.escapeHtml(row.typeLabel) +
                '</span>';

        // ---- Active / ended badge (discipline window) ----
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
        }

        html += '</div>';

        // ---- Expanded body, only when offered ----
        if (isOffered) {
            html += renderOfferedRowBody(row);
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

    function getTypeBadgeClass(type) {
        if (type === 'mandatory') {
            return 'academy-picker-type-mandatory';
        }
        if (type === 'optional') {
            return 'academy-picker-type-optional';
        }
        return 'academy-picker-type-unknown';
    }

    function renderOfferedRowBody(row) {
        var html = '';

        html += '<div class="academy-picker-row-body">';

        // ---- Mandatory toggle ----
        html += '<div class="academy-picker-row-control">';
        html += '<label class="academy-picker-mandatory-label">';
        html += '<input type="checkbox" ' +
                    'class="academy-picker-mandatory-checkbox" ' +
                    'data-picker-action="toggle-mandatory" ' +
                    'data-discipline-id="' +
                        DomUtils.escapeAttribute(row.id) + '"' +
                    (row.mandatory ? ' checked' : '') + '>';
        html += '<span>Mandatory for this class</span>';
        html += '</label>';
        html += '</div>';

        // ---- Instructor picker ----
        html += '<div class="academy-picker-row-control ' +
                    'academy-picker-instructors">';
        html += '<div class="academy-picker-instructors-label">' +
                    'Instructors for this class' +
                '</div>';

        var instructors = Array.isArray(row.instructors)
            ? row.instructors
            : [];

        if (instructors.length === 0) {
            html += '<p class="empty-state small">' +
                        'No characters are in instructor mode. Toggle ' +
                        'the mode checkbox in the character panel to ' +
                        'promote a character to instructor.' +
                    '</p>';
        } else if (row.startWeek === null || row.startWeek === undefined) {
            html += '<p class="empty-state small">' +
                        'This discipline has no start week set. ' +
                        'Set it in the Disciplines view before assigning ' +
                        'instructors.' +
                    '</p>';
        } else {
            html += '<div class="academy-picker-instructor-grid">';
            for (var i = 0; i < instructors.length; i++) {
                html += renderInstructorCheckbox(row.id, instructors[i]);
            }
            html += '</div>';
        }

        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderInstructorCheckbox(disciplineId, instructor) {
        // Compute the effective checked state:
        //   - Start from the VM's `assigned` flag (what's in the store).
        //   - Apply any pending change for this (discipline, instructor).
        //
        // A pending 'enrol' forces checked, 'leave' forces unchecked,
        // and the absence of a pending entry means "use the store's
        // current state."
        var key = makePendingKey(disciplineId, instructor.id);
        var pending = _pendingInstructorChanges[key];

        var checked;
        if (pending === 'enrol') {
            checked = true;
        } else if (pending === 'leave') {
            checked = false;
        } else {
            checked = instructor.assigned === true;
        }

        var html = '';
        html += '<label class="academy-picker-instructor-item' +
                    (checked ? ' academy-picker-instructor-checked' : '') +
                    '">';
        html += '<input type="checkbox" ' +
                    'class="academy-picker-instructor-checkbox" ' +
                    'data-picker-action="toggle-instructor" ' +
                    'data-discipline-id="' +
                        DomUtils.escapeAttribute(disciplineId) + '" ' +
                    'data-instructor-id="' +
                        DomUtils.escapeAttribute(instructor.id) + '" ' +
                    'data-was-assigned="' +
                        (instructor.assigned ? 'true' : 'false') + '"' +
                    (checked ? ' checked' : '') + '>';
        html += '<span>' +
                    DomUtils.escapeHtml(instructor.name) +
                '</span>';
        html += '</label>';
        return html;
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================
    //
    // Content handlers are rebound on every render, because the
    // content is replaced wholesale. The modal-level handler (for
    // Escape and backdrop click) is bound once, on open, and stays.

    function bindContentHandlers(contentEl) {
        if (!contentEl) { return; }

        // Delegated change handler for all checkboxes.
        contentEl.addEventListener('change', handleContentChange);

        // Delegated click handler for footer buttons.
        contentEl.addEventListener('click', handleContentClick);
    }

    function bindModalHandlers(modal, contentEl) {
        unbindModalHandlers();

        var onKeydown = function(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeModal();
            }
        };

        var onBackdropClick = function(e) {
            if (e.target === modal) {
                closeModal();
            }
        };

        document.addEventListener('keydown', onKeydown);
        modal.addEventListener('click', onBackdropClick);

        _boundHandlers = {
            onKeydown: onKeydown,
            onBackdropClick: onBackdropClick,
            modal: modal
        };
    }

    function unbindModalHandlers() {
        if (!_boundHandlers) { return; }

        try {
            document.removeEventListener(
                'keydown', _boundHandlers.onKeydown
            );
        } catch (e) { /* ignore */ }

        try {
            if (_boundHandlers.modal) {
                _boundHandlers.modal.removeEventListener(
                    'click', _boundHandlers.onBackdropClick
                );
            }
        } catch (e) { /* ignore */ }

        _boundHandlers = null;
    }

    // ============================================================
    // CONTENT EVENT HANDLERS
    // ============================================================

    function handleContentClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var btn = target.closest('[data-picker-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.pickerAction;

        if (action === 'cancel') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'save') {
            e.preventDefault();
            handleSave();
            return;
        }
    }

    function handleContentChange(e) {
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

        if (action === 'toggle-instructor') {
            e.preventDefault();
            handleToggleInstructor(
                target.dataset.disciplineId,
                target.dataset.instructorId,
                target.dataset.wasAssigned === 'true',
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
            // Create the marker. `mandatory` defaults from the
            // discipline's type on creation (AcademyClassDisciplines
            // handles the default when we do not supply one).
            promise = AcademyClassDisciplines.setClassDiscipline(
                _classId,
                disciplineId,
                {}
            );
        } else {
            // Remove the marker. Any pending instructor changes for
            // this discipline are dropped, because an unoffered
            // discipline has no instructor assignment.
            dropPendingChangesForDiscipline(disciplineId);
            promise = AcademyClassDisciplines.removeClassDiscipline(
                _classId,
                disciplineId
            );
        }

        promise.then(function(result) {
            if (result && result.success) {
                refetchAndRender();
            }
            // On failure, the pipeline already notified. The
            // checkbox will correct itself on the next refetch.
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

    function handleToggleInstructor(
        disciplineId,
        instructorId,
        wasAssigned,
        nowChecked
    ) {
        if (!_classId) { return; }
        if (!isNonEmptyString(disciplineId)) { return; }
        if (!isNonEmptyString(instructorId)) { return; }

        var key = makePendingKey(disciplineId, instructorId);

        // If the user toggled back to the original state, drop the
        // pending entry rather than leaving a no-op.
        if (wasAssigned === nowChecked) {
            delete _pendingInstructorChanges[key];
        } else {
            _pendingInstructorChanges[key] = nowChecked
                ? 'enrol'
                : 'leave';
        }

        // Re-render to update the visual state of the row and the
        // Save button.
        refetchAndRender();
    }

    function dropPendingChangesForDiscipline(disciplineId) {
        var prefix = String(disciplineId) + '::';
        var keys = Object.keys(_pendingInstructorChanges);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf(prefix) === 0) {
                delete _pendingInstructorChanges[keys[i]];
            }
        }
    }

    // ============================================================
    // SAVE
    // ============================================================
    //
    // Flushes every pending instructor change in one sequence. The
    // mutations are individually atomic (each goes through
    // MutationPipeline) but the sequence is not transactional as a
    // whole. That is acceptable for this flow: the user's edits are
    // independent decisions, and a partial success with clear
    // failure feedback is better than a hard rollback that discards
    // successful enrolments.

    function handleSave() {
        if (!_classId) { return; }

        var pending = collectPendingChanges();

        if (pending.length === 0) {
            // Nothing to save. Close as if the user pressed Cancel
            // — no persistence work to do.
            closeModal();
            return;
        }

        // Resolve each pending change's discipline window. When a
        // discipline has no valid startWeek, its pending changes are
        // dropped with a warning. The picker's UI already prevents
        // this at the row level; the guard here is defence in depth.
        var runnable = [];
        var skipped = 0;

        for (var i = 0; i < pending.length; i++) {
            var change = pending[i];
            var discipline = AcademyDisciplines.getDiscipline(
                change.disciplineId
            );

            var startWeek = discipline && typeof discipline.startWeek === 'number'
                ? discipline.startWeek
                : null;

            if (startWeek === null) {
                skipped++;
                continue;
            }

            var endWeek = null;
            if (discipline.endWeek !== undefined &&
                discipline.endWeek !== null &&
                discipline.endWeek !== '') {
                var parsedEnd = Number(discipline.endWeek);
                if (Number.isInteger(parsedEnd)) {
                    endWeek = parsedEnd;
                }
            }

            runnable.push({
                disciplineId: change.disciplineId,
                instructorId: change.instructorId,
                action: change.action,
                startWeek: startWeek,
                endWeek: endWeek
            });
        }

        if (skipped > 0) {
            notify(
                'Skipped ' + skipped + ' instructor change(s) for ' +
                'disciplines with no start week.',
                'error'
            );
        }

        if (runnable.length === 0) {
            clearPendingInstructorChanges();
            refetchAndRender();
            return;
        }

        // Sequential execution. Each call returns a Promise; we
        // chain them so that a failure in one does not cascade into
        // a broken sequence. Every result is inspected; failures are
        // collected for the final notification.
        var failures = [];
        var chain = Promise.resolve();

        runnable.forEach(function(item) {
            chain = chain.then(function() {
                return runOneInstructorChange(item);
            }).then(function(result) {
                if (!result || !result.success) {
                    failures.push({
                        disciplineId: item.disciplineId,
                        instructorId: item.instructorId,
                        action: item.action,
                        message: (result && result.message) ||
                            'Unknown error'
                    });
                }
            }).catch(function(err) {
                failures.push({
                    disciplineId: item.disciplineId,
                    instructorId: item.instructorId,
                    action: item.action,
                    message: String(err && err.message || err)
                });
            });
        });

        chain.then(function() {
            if (failures.length === 0) {
                clearPendingInstructorChanges();
                closeModal();
                return;
            }

            // Partial failure. Keep the modal open so the user can
            // see the state and retry. Successful changes are
            // already persisted; failed ones remain pending.
            notify(
                'Failed to save ' + failures.length +
                ' instructor change(s). See console for details.',
                'error'
            );
            for (var k = 0; k < failures.length; k++) {
                console.warn(
                    '[AcademyClassDisciplinesPicker] save failure:',
                    failures[k]
                );
            }

            // Rebuild the pending set to only the failures.
            var failedKeys = Object.create(null);
            for (var f = 0; f < failures.length; f++) {
                var fail = failures[f];
                failedKeys[makePendingKey(
                    fail.disciplineId,
                    fail.instructorId
                )] = fail.action;
            }
            _pendingInstructorChanges = failedKeys;

            refetchAndRender();
        });
    }

    function collectPendingChanges() {
        var result = [];
        var keys = Object.keys(_pendingInstructorChanges);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var action = _pendingInstructorChanges[key];
            if (action !== 'enrol' && action !== 'leave') {
                continue;
            }
            var sep = key.indexOf('::');
            if (sep === -1) { continue; }
            var disciplineId = key.substring(0, sep);
            var instructorId = key.substring(sep + 2);
            result.push({
                disciplineId: disciplineId,
                instructorId: instructorId,
                action: action
            });
        }
        return result;
    }

    function runOneInstructorChange(item) {
        if (item.action === 'enrol') {
            return AcademyEnrolments.enrol(
                item.instructorId,
                _classId,
                item.disciplineId,
                item.startWeek
            );
        }

        if (item.action === 'leave') {
            // Leaving effective week N means the previous week is
            // the last enrolled week. Use startWeek + 1 as the
            // effective week when the discipline starts at the same
            // week as the enrolment; otherwise use the week after
            // the discipline starts.
            //
            // The simplest correct semantics: effectiveWeek =
            // item.startWeek. Under AcademyEnrolments.leave's rules,
            // an interval that starts on or after the effective week
            // is removed entirely. Since we only ever create
            // instructor enrolments starting at the discipline's
            // startWeek, the interval starts exactly at effective
            // week, and the remove is clean.
            var effectiveWeek = item.startWeek;
            return AcademyEnrolments.leave(
                item.instructorId,
                _classId,
                item.disciplineId,
                effectiveWeek
            );
        }

        return Promise.resolve({
            success: false,
            message: 'Unknown action: ' + item.action
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