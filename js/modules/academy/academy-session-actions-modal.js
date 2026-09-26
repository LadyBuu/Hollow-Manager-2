/**
 * modules/academy/academy-session-actions-modal.js
 * Academy Session Actions Modal
 *
 * Path: js/modules/academy/academy-session-actions-modal.js
 *
 * The small action modal that opens when a user clicks an occupied
 * cell on the discipline schedule grid. It offers three actions on
 * the session that owns the cell:
 *
 *   Edit                     — opens AcademySessionFormModal in
 *                              edit mode.
 *   Delete                   — confirms and removes the session
 *                              record.
 *   Add another instructor   — closes this modal and asks the
 *                              caller to open the instructor
 *                              picker pre-filled with the same
 *                              day/hour. The picker creates a
 *                              second session at the slot for a
 *                              different instructor; the grid
 *                              then renders two co-occupants in
 *                              the cell.
 *
 * WHAT THIS MODULE OWNS:
 *   - The action modal shell.
 *   - Its content (session summary + three buttons + a cancel).
 *   - The delete confirm sub-state (inline, not a second modal).
 *   - Routing Edit to AcademySessionFormModal.
 *   - Routing Delete to AcademyTeachingSessions.removeSessionRecord.
 *   - Routing Add-another-instructor to the caller-supplied
 *     `onAddInstructor` callback.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The session edit form. AcademySessionFormModal owns it.
 *   - The instructor picker. AcademyScheduleInstructorModal owns
 *     it. This modal does not know what the picker is; it calls a
 *     callback and the callback opens the picker.
 *   - The teaching-sessions store. AcademyTeachingSessions owns it.
 *   - The grid. CalendarRenderer owns it.
 *   - The click dispatch that opened this modal. The discipline
 *     controller owns it.
 *
 * WHY NO "MOVE" ACTION:
 *   AcademySessionFormModal's edit mode already exposes day, start
 *   hour, and location as editable fields. Duration is locked
 *   (deliberately — see that module's header). So "move" is not a
 *   distinct operation; it is "edit the day and start hour."
 *
 * ADD-ANOTHER-INSTRUCTOR CALLBACK:
 *   The modal does not know how to open the instructor picker, and
 *   it should not. The discipline controller passes a callback via
 *   options.onAddInstructor. The callback receives (day, hour) and
 *   is expected to open the picker itself.
 *
 *   When the callback is absent, the third button is not rendered.
 *   That keeps the modal from offering an action it cannot perform.
 *
 *   The modal closes itself before invoking the callback. Ordering
 *   matters: if the caller opens a new modal from inside the
 *   callback and this modal has not closed yet, the two modals
 *   stack. Closing first avoids that.
 *
 * DELETE CONFIRMATION:
 *   Inline, in the same modal. Clicking Delete swaps the modal body
 *   to a confirm state: a short warning and two buttons (Cancel /
 *   Delete Session). Confirm performs the removal and closes. Cancel
 *   returns to the action state.
 *
 * ASYNC SAFETY:
 *   Every asynchronous callback captures the current
 *   `_sessionToken`. A new modal opened (or the current one closed)
 *   before the callback runs makes the callback a no-op. This
 *   prevents a stale removal from closing a freshly-opened modal.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyTeachingSessions
 *   - window.AcademyTeachingGroups
 *   - window.AcademyDisciplines
 *   - window.AcademyLocations
 *   - window.AcademySessionFormModal
 *   - window.CalendarConstants
 */

(function() {
    'use strict';

    if (window.__academySessionActionsModalLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyTeachingSessions = window.AcademyTeachingSessions;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyLocations = window.AcademyLocations;
    var AcademySessionFormModal = window.AcademySessionFormModal;
    var CalendarConstants = window.CalendarConstants;

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
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!AcademyTeachingSessions ||
        typeof AcademyTeachingSessions.getSession !== 'function' ||
        typeof AcademyTeachingSessions.removeSessionRecord !== 'function') {
        _missing.push('AcademyTeachingSessions API');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroup !== 'function') {
        _missing.push('AcademyTeachingGroups.getGroup');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyLocations ||
        typeof AcademyLocations.getLocation !== 'function') {
        _missing.push('AcademyLocations.getLocation');
    }
    if (!AcademySessionFormModal ||
        typeof AcademySessionFormModal.openModal !== 'function') {
        _missing.push('AcademySessionFormModal.openModal');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.getDayName !== 'function' ||
        typeof CalendarConstants.formatHour !== 'function') {
        _missing.push('CalendarConstants day/hour helpers');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademySessionActionsModal] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academySessionActionsModalLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _context = null;
    var _onClose = null;
    var _onAddInstructor = null;

    var _contentClickHandler = null;

    var _sessionToken = 0;
    var _busy = false;

    // 'actions' | 'confirm-delete'
    var _state = 'actions';

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function formatDay(day) {
        try {
            return CalendarConstants.getDayName(day) || ('Day ' + day);
        } catch (e) {
            return 'Day ' + day;
        }
    }

    function formatStartHour(hour) {
        try {
            var s = CalendarConstants.formatHour(hour);
            return isNonEmptyString(s) ? s : (hour + ':00');
        } catch (e) {
            return hour + ':00';
        }
    }

    // ============================================================
    // CONTEXT RESOLUTION
    // ============================================================
    //
    // The session is the source of truth. Everything the modal shows
    // is derived from the session record at open time. We resolve
    // the group and discipline for display; if either has gone
    // missing since the grid rendered, we still open (the session
    // exists and is deletable), but the display name falls back.
    //
    // We do NOT re-read the session on every render. The session
    // is captured on open. A re-render after an external change
    // would need a fresh open, which is fine; this modal is
    // short-lived.

    function buildContext(options) {
        if (!options || typeof options !== 'object') {
            return null;
        }

        var sessionId = isNonEmptyString(options.sessionId)
            ? String(options.sessionId)
            : null;
        if (sessionId === null) {
            return null;
        }

        var session = null;
        try {
            session = AcademyTeachingSessions.getSession(sessionId);
        } catch (e) {
            console.warn(
                '[AcademySessionActionsModal] getSession threw:', e
            );
            return null;
        }
        if (!session) {
            return null;
        }

        var group = null;
        var disciplineId = null;
        var disciplineName = '';
        var instructorId = null;

        if (isNonEmptyString(session.groupId)) {
            try {
                group = AcademyTeachingGroups.getGroup(session.groupId);
            } catch (e) {
                group = null;
            }
        }

        if (group) {
            if (isNonEmptyString(group.disciplineId)) {
                disciplineId = String(group.disciplineId);
                var disc = AcademyDisciplines.getDiscipline(disciplineId);
                if (disc && isNonEmptyString(disc.name)) {
                    disciplineName = disc.name;
                }
            }
            if (isNonEmptyString(group.instructorId)) {
                instructorId = String(group.instructorId);
            }
        }

        var groupDisplayName = '';
        if (group) {
            if (isNonEmptyString(group.customName)) {
                groupDisplayName = String(group.customName).trim();
            } else if (disciplineName !== '' &&
                typeof group.groupNumber === 'number' &&
                group.groupNumber > 0) {
                groupDisplayName = disciplineName + ' ' +
                    group.groupNumber;
            } else if (disciplineName !== '') {
                groupDisplayName = disciplineName;
            }
        }

        var locationName = '';
        if (isNonEmptyString(session.locationId)) {
            try {
                var loc = AcademyLocations.getLocation(session.locationId);
                if (loc && isNonEmptyString(loc.name)) {
                    locationName = loc.name;
                }
            } catch (e) {
                locationName = '';
            }
        }

        return {
            sessionId: sessionId,
            session: session,
            groupId: isNonEmptyString(session.groupId)
                ? String(session.groupId)
                : null,
            groupDisplayName: groupDisplayName,
            disciplineId: disciplineId,
            disciplineName: disciplineName,
            instructorId: instructorId,
            locationId: isNonEmptyString(session.locationId)
                ? String(session.locationId)
                : null,
            locationName: locationName,
            classId: isNonEmptyString(options.classId)
                ? String(options.classId)
                : (group && isNonEmptyString(group.classId)
                    ? String(group.classId)
                    : null)
        };
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the session actions modal.
     *
     * @param {object} options
     * @param {string} options.sessionId   Required.
     * @param {string} [options.classId]   Class context.
     * @param {function} [options.onAddInstructor] Called with
     *   (day, hour) when the user clicks "Add another instructor
     *   here". The callback is responsible for opening the
     *   instructor picker. When absent, the button is not rendered.
     * @param {function} [options.onClose] Called once when the modal
     *   closes for any reason.
     * @returns {object|null} The modal element, or null on failure.
     */
    function openModal(options) {
        if (!options || typeof options !== 'object') {
            notify('Invalid session request.', 'error');
            return null;
        }

        var context = buildContext(options);
        if (!context) {
            notify('Session not found.', 'error');
            return null;
        }

        closeModal();

        _context = context;
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;
        _onAddInstructor =
            typeof options.onAddInstructor === 'function'
                ? options.onAddInstructor
                : null;

        _state = 'actions';
        _busy = false;

        // Bump the token. Any callback from a previous instance
        // becomes a no-op.
        _sessionToken++;
        var myToken = _sessionToken;

        var shell = Modal.createModal('academy-session-actions-modal');
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'academy-session-actions-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        _contentClickHandler = function(e) {
            handleContentClick(e, myToken);
        };
        contentEl.addEventListener('click', _contentClickHandler);

        renderContent();

        Modal.modalSetup(shell, function() {
            closeModal();
        });
        Modal.showModal(shell);

        return shell;
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;
        var onClose = _onClose;

        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }

        // Invalidate any in-flight callbacks.
        _sessionToken++;

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
                    '[AcademySessionActionsModal] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _context = null;
        _onClose = null;
        _onAddInstructor = null;
        _contentClickHandler = null;
        _state = 'actions';
        _busy = false;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl || !_context) { return; }
        _contentEl.innerHTML = buildModalHTML();
    }

    function buildModalHTML() {
        if (_state === 'confirm-delete') {
            return buildConfirmDeleteHTML();
        }
        return buildActionsHTML();
    }

    // ============================================================
    // HTML — ACTION STATE
    // ============================================================

    function buildActionsHTML() {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Session</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-session-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += renderSessionSummary();

        html += '<div class="academy-session-actions">';

        html += '<button type="button" class="primary" ' +
                    'data-session-action="edit"' +
                    (_busy ? ' disabled' : '') + '>' +
                    'Edit Session' +
                '</button>';

        html += '<button type="button" class="danger" ' +
                    'data-session-action="delete"' +
                    (_busy ? ' disabled' : '') + '>' +
                    'Delete Session' +
                '</button>';

        // The "add another instructor" action is only available
        // when the caller supplied a callback. A modal that cannot
        // perform the action does not offer it.
        if (_onAddInstructor !== null) {
            html += '<button type="button" class="secondary ' +
                        'academy-session-actions-add-instructor" ' +
                        'data-session-action="add-instructor"' +
                        (_busy ? ' disabled' : '') + '>' +
                        'Add another instructor here' +
                    '</button>';
        }

        html += '</div>';

        html += '</div>';

        html += '<div class="modal-footer academy-session-actions-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-session-action="close"' +
                    (_busy ? ' disabled' : '') + '>' +
                    'Cancel' +
                '</button>';
        html += '</div>';

        return html;
    }

    function renderSessionSummary() {
        var session = _context.session;
        var html = '';

        html += '<div class="academy-session-summary">';

        if (_context.groupDisplayName !== '') {
            html += renderSummaryRow(
                'Group', _context.groupDisplayName
            );
        }
        if (_context.disciplineName !== '') {
            html += renderSummaryRow(
                'Discipline', _context.disciplineName
            );
        }

        var dayLabel = formatDay(session.day);
        var timeLabel = formatStartHour(session.startTime);
        var duration = (typeof session.duration === 'number' &&
                        session.duration > 0)
            ? session.duration
            : 1;
        var timeBlock = dayLabel + ', ' + timeLabel +
            ' (' + duration + 'h)';
        html += renderSummaryRow('Time', timeBlock);

        if (_context.locationName !== '') {
            html += renderSummaryRow('Location', _context.locationName);
        }

        html += '</div>';
        return html;
    }

    function renderSummaryRow(label, value) {
        return (
            '<div class="academy-session-summary-row">' +
                '<span class="academy-session-summary-label">' +
                    escapeHtml(label) +
                '</span>' +
                '<span class="academy-session-summary-value">' +
                    escapeHtml(value) +
                '</span>' +
            '</div>'
        );
    }

    // ============================================================
    // HTML — CONFIRM-DELETE STATE
    // ============================================================

    function buildConfirmDeleteHTML() {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Delete Session</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-session-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p>Delete this session?</p>';

        html += '<div class="academy-session-summary">';
        if (_context.groupDisplayName !== '') {
            html += renderSummaryRow(
                'Group', _context.groupDisplayName
            );
        }
        var session = _context.session;
        var dayLabel = formatDay(session.day);
        var timeLabel = formatStartHour(session.startTime);
        var duration = (typeof session.duration === 'number' &&
                        session.duration > 0)
            ? session.duration
            : 1;
        html += renderSummaryRow(
            'Time',
            dayLabel + ', ' + timeLabel + ' (' + duration + 'h)'
        );
        html += '</div>';

        html += '<p class="text-dim academy-session-delete-warning">' +
                    'The session is removed from the group. Student ' +
                    'memberships are unaffected. If you meant to end ' +
                    'the session from a specific week onward, use ' +
                    'Edit instead.' +
                '</p>';

        html += '</div>';

        html += '<div class="modal-footer academy-session-actions-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-session-action="cancel-delete"' +
                    (_busy ? ' disabled' : '') + '>' +
                    'Cancel' +
                '</button>';
        html += '<button type="button" class="danger" ' +
                    'data-session-action="confirm-delete"' +
                    (_busy ? ' disabled' : '') + '>' +
                    'Delete Session' +
                '</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // EVENT HANDLER
    // ============================================================

    function handleContentClick(e, myToken) {
        if (myToken !== _sessionToken) { return; }
        if (_busy) {
            e.preventDefault();
            return;
        }

        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var actionEl = target.closest('[data-session-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.sessionAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'edit') {
            e.preventDefault();
            handleEdit(myToken);
            return;
        }

        if (action === 'delete') {
            e.preventDefault();
            _state = 'confirm-delete';
            renderContent();
            return;
        }

        if (action === 'cancel-delete') {
            e.preventDefault();
            _state = 'actions';
            renderContent();
            return;
        }

        if (action === 'confirm-delete') {
            e.preventDefault();
            handleConfirmDelete(myToken);
            return;
        }

        if (action === 'add-instructor') {
            e.preventDefault();
            handleAddInstructor();
            return;
        }
    }

    // ============================================================
    // EDIT
    // ============================================================
    //
    // AcademySessionFormModal opens its own modal and closes itself
    // on success. We do NOT close this modal before calling it; if
    // the user cancels the edit form, they should return to this
    // action menu, not to a blank screen.
    //
    // The edit form's onClose callback fires when the form closes
    // for any reason. If the form succeeded, we want this modal to
    // close too. If it was cancelled, we want this modal to stay.
    // The form does not tell us which case fired.
    //
    // Practical resolution: close this modal whenever the form
    // closes. Rationale: a user who opened Edit and then closed
    // the form has either saved (done) or abandoned (also done).
    // Either way, returning the user to the grid is the right end
    // state. This is the simplest policy that does not require the
    // form modal to grow an outcome channel.

    function handleEdit(myToken) {
        if (!_context) { return; }

        var formOptions = {
            mode: 'edit',
            groupId: _context.groupId,
            sessionId: _context.sessionId,
            onClose: function() {
                if (myToken !== _sessionToken) { return; }
                closeModal();
            }
        };

        try {
            AcademySessionFormModal.openModal(formOptions);
        } catch (e) {
            console.warn(
                '[AcademySessionActionsModal] opening the edit form ' +
                'threw:', e
            );
            notify('Could not open the session form.', 'error');
        }
    }

    // ============================================================
    // DELETE
    // ============================================================

    function handleConfirmDelete(myToken) {
        if (!_context) { return; }

        var sessionId = _context.sessionId;

        _busy = true;
        renderContent();

        AcademyTeachingSessions.removeSessionRecord(sessionId)
            .then(function(result) {
                if (myToken !== _sessionToken) { return; }
                _busy = false;

                if (result && result.success) {
                    notify('Session deleted.', 'success');
                    closeModal();
                    return;
                }

                var msg = (result && result.message)
                    ? result.message
                    : 'Could not delete the session.';
                notify(msg, 'error');
                _state = 'actions';
                renderContent();
            })
            .catch(function(err) {
                if (myToken !== _sessionToken) { return; }
                _busy = false;
                console.warn(
                    '[AcademySessionActionsModal] removeSessionRecord ' +
                    'threw:', err
                );
                notify('Could not delete the session.', 'error');
                _state = 'actions';
                renderContent();
            });
    }

    // ============================================================
    // ADD ANOTHER INSTRUCTOR
    // ============================================================
    //
    // Close this modal first, then invoke the callback. Ordering
    // matters: if the callback opens a new modal and this modal
    // has not closed yet, the two modals stack in the DOM. Closing
    // first avoids that.
    //
    // The session's day and startTime come from the captured
    // `_context.session` — the same values the summary row shows.
    // The callback receives them and is responsible for opening
    // the instructor picker with `mode: 'picker'` and the same
    // class / discipline / week the caller already knows about.
    //
    // Errors thrown by the callback are logged but not surfaced;
    // the callback is expected to do its own user-facing error
    // handling (the controller's callback notifies on failure).

    function handleAddInstructor() {
        if (!_context) { return; }
        if (_onAddInstructor === null) { return; }

        var session = _context.session;
        var day = session.day;
        var hour = session.startTime;

        if (typeof day !== 'number' || typeof hour !== 'number') {
            notify(
                'Cannot determine the slot for this session.',
                'error'
            );
            return;
        }

        // Capture the callback before closing, because closeModal
        // resets module state.
        var callback = _onAddInstructor;

        closeModal();

        try {
            callback(day, hour);
        } catch (e) {
            console.warn(
                '[AcademySessionActionsModal] onAddInstructor ' +
                'threw:', e
            );
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySessionActionsModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademySessionActionsModal;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademySessionActionsModal] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
