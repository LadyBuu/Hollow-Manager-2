/**
 * modules/academy/academy-schedule-assign-modal.js
 * Academy Schedule Assign Modal
 *
 * Path: js/modules/academy/academy-schedule-assign-modal.js
 *
 * The modal that lets a user assign a single student to a single
 * slot, remove a single student from a slot they're already in, or
 * delete an entire teaching group from the schedule.
 *
 * MODES:
 *   'assign'          (default) pick a discipline + duration, submit
 *                     → AcademySchedule.assignStudentToSlot
 *   'remove-student'  confirm removal of one student from one group
 *                     → AcademyTeachingGroups.removeMemberRecord
 *   'remove-group'    confirm deletion of the entire group and every
 *                     session and student membership it owns
 *                     → AcademySchedule.removeTeachingGroup
 *
 * WHAT THIS MODULE OWNS:
 *   The modal shell, its content, its listeners, its view model, and
 *   its submission handlers for all three modes. The modal is opened
 *   from the character detail panel's Schedule tab, via the People
 *   controller, when the user clicks a grid cell.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The schedule grid. CalendarRenderer produces it.
 *   - The click dispatch. AcademyPeopleController routes
 *     data-action="schedule-assign" (empty cells) and
 *     data-action="schedule-slot-open" (occupied cells) to this
 *     module's openModal.
 *   - Group and session resolution. AcademySchedule.assignStudentToSlot
 *     owns it. This modal does not decide which group a student joins,
 *     whether a session should be created, or which instructor
 *     applies. It collects intent and passes it to the domain.
 *   - Discipline eligibility. The modal offers the class's active
 *     offerings via AcademyClassDisciplinesQueries; whether a given
 *     offering is legal for the student is decided by the domain
 *     when the mutation runs.
 *   - Collision policy. The domain detects collisions; this modal
 *     surfaces the rejection and offers a retry with allowCollisions.
 *
 * MODAL SHAPE — ASSIGN MODE:
 *   Header: "Assign discipline"
 *   Body:
 *     - Slot summary line: "Monday, 9:00 AM, Week 5"
 *     - Discipline select (the class's active offerings)
 *     - Duration select (MIN_CLASS_DURATION to MAX_CLASS_DURATION)
 *   Footer:
 *     - Cancel
 *     - Assign (disabled until a discipline is chosen)
 *
 * MODAL SHAPE — REMOVE-STUDENT MODE:
 *   Header: "Remove student from slot"
 *   Body:
 *     - Slot summary line
 *     - Warning panel: "Remove [Name] from this slot?"
 *     - Detail: discipline, duration, member count
 *   Footer:
 *     - Cancel
 *     - Remove (danger)
 *
 * MODAL SHAPE — REMOVE-GROUP MODE:
 *   Header: "Delete teaching group"
 *   Body:
 *     - Slot summary line
 *     - Warning panel: "Delete this group and every session on it?"
 *     - Detail: discipline, duration, member count, session count
 *   Footer:
 *     - Cancel
 *     - Delete Group (danger)
 *
 * COLLISION RETRY:
 *   When AcademySchedule.assignStudentToSlot rejects with
 *   reason: 'student_collision' or reason: 'instructor_collision',
 *   the modal does not close. It shows a confirmation inline.
 *   Other rejections are shown as an error toast.
 *
 * WINDOW SEMANTICS:
 *   The membership window is derived by the domain, not the modal.
 *   The domain caps it at the tighter of the enrolment interval and
 *   the discipline's endWeek. This modal passes only `week`.
 *
 * INPUT VALIDATION:
 *   The modal performs strict numeric validation on the values it
 *   receives from the controller. This is UX validation, not
 *   authority. The domain re-validates everything.
 *
 * LISTENER DISCIPLINE:
 *   Content listeners are bound ONCE, on the modal's content element,
 *   when the modal is created. Re-rendering replaces innerHTML but
 *   does not rebind. Modal-level listeners are installed by
 *   Modal.modalSetup.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyUI
 *   - window.AcademyClassDisciplinesQueries
 *   - window.AcademyDisciplines
 *   - window.AcademySchedule
 *   - window.AcademyTeachingGroups
 *   - window.CharacterQueries
 *   - window.CalendarConstants
 *
 * USAGE:
 *   // Assign
 *   AcademyScheduleAssignModal.openModal({
 *       charId: 'char_1',
 *       classId: 'class_1',
 *       week: 5, day: 1, startHour: 9,
 *       onClose: function() { ... }
 *   });
 *
 *   // Remove student
 *   AcademyScheduleAssignModal.openModal({
 *       mode: 'remove-student',
 *       charId: 'char_1',
 *       classId: 'class_1',
 *       week: 5, day: 1, startHour: 9,
 *       groupId: 'tgroup_abc',
 *       sessionId: 'tsession_xyz',
 *       disciplineName: 'English',
 *       duration: 2,
 *       memberCount: 4,
 *       onClose: function() { ... }
 *   });
 *
 *   // Remove group
 *   AcademyScheduleAssignModal.openModal({
 *       mode: 'remove-group',
 *       classId: 'class_1',
 *       week: 5, day: 1, startHour: 9,
 *       groupId: 'tgroup_abc',
 *       sessionId: 'tsession_xyz',
 *       disciplineName: 'English',
 *       duration: 2,
 *       memberCount: 4,
 *       sessionCount: 3,
 *       onClose: function() { ... }
 *   });
 */

(function() {
    'use strict';

    if (window.__academyScheduleAssignModalLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyUI = window.AcademyUI;
    var AcademyClassDisciplinesQueries =
        window.AcademyClassDisciplinesQueries;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademySchedule = window.AcademySchedule;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var CharacterQueries = window.CharacterQueries;
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
    if (!AcademyUI ||
        typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
    }
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.getClassDisciplinesForClass !== 'function' ||
        typeof AcademyClassDisciplinesQueries.isActiveInWeek !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries API');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademySchedule ||
        typeof AcademySchedule.assignStudentToSlot !== 'function') {
        _missing.push('AcademySchedule.assignStudentToSlot');
    }
    if (!AcademySchedule ||
        typeof AcademySchedule.removeTeachingGroup !== 'function') {
        _missing.push('AcademySchedule.removeTeachingGroup');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.removeMemberRecord !== 'function') {
        _missing.push('AcademyTeachingGroups.removeMemberRecord');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function' ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries API');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_CLASS_DURATION !== 'number' ||
        typeof CalendarConstants.MAX_CLASS_DURATION !== 'number' ||
        typeof CalendarConstants.getDayName !== 'function' ||
        typeof CalendarConstants.formatHour !== 'function') {
        _missing.push('CalendarConstants duration/day-name/hour helpers');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyScheduleAssignModal] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyScheduleAssignModalLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var DEFAULT_DURATION = MIN_DURATION;

    var VALID_MODES = ['assign', 'remove-student', 'remove-group'];

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _context = null;
    var _onClose = null;

    var _contentChangeHandler = null;
    var _contentClickHandler = null;

    // Current form state, mirrored from the DOM on input so the
    // submit handler has it even if the select element is replaced
    // by a re-render. Reset on every openModal.
    var _selectedDisciplineId = '';
    var _selectedDuration = DEFAULT_DURATION;

    // When the domain rejects with a policy collision, the modal
    // shows a confirm prompt. `_pendingCollision` holds the last
    // rejection so the retry can carry its reason forward; when
    // null, the next submit is a fresh attempt.
    var _pendingCollision = null;

    // True while a submission is in flight. Clicks that would
    // issue a second submission are ignored.
    var _busy = false;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    /**
     * Strict integer parse. Accepts an integer or a pure digit
     * string (optionally signed). Rejects floats, strings with
     * trailing characters, NaN, undefined, null.
     *
     * The domain re-validates every one of these, but the modal
     * should not accept "5foo" as week 5.
     */
    function parseStrictInteger(value) {
        if (value === undefined || value === null) { return null; }

        if (typeof value === 'number') {
            return Number.isInteger(value) ? value : null;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^-?\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            return Number.isInteger(n) ? n : null;
        }

        return null;
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

    function getCharacterName(charId) {
        if (!isNonEmptyString(charId)) { return 'the character'; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return 'the character'; }
        return CharacterQueries.getDisplayName(char) || 'the character';
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

    function formatDuration(hours) {
        var n = parseStrictInteger(hours);
        if (n === null) { n = 1; }
        return n + ' hour' + (n === 1 ? '' : 's');
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the modal.
     *
     * @param {object} options
     * @param {string} [options.mode]        'assign' (default) |
     *                                       'remove-student' |
     *                                       'remove-group'
     * @param {string} [options.charId]      required in 'assign' and
     *                                       'remove-student' modes
     * @param {string} options.classId       required in every mode
     * @param {number} options.week          required, integer
     * @param {number} options.day           required, integer
     * @param {number} options.startHour     required, integer
     * @param {string} [options.groupId]     required in 'remove-*' modes
     * @param {string} [options.sessionId]   required in 'remove-*' modes
     * @param {string} [options.disciplineName] display in 'remove-*' modes
     * @param {number} [options.duration]    display in 'remove-*' modes
     * @param {number} [options.memberCount] display in 'remove-*' modes
     * @param {number} [options.sessionCount] display in 'remove-group' mode
     * @param {function} [options.onClose]   called once when the modal
     *                                       closes, regardless of reason
     * @returns {object|null} the modal element, or null on failure
     */
    function openModal(options) {
        if (!options || typeof options !== 'object') {
            notify('Invalid schedule request.', 'error');
            return null;
        }

        var mode = isNonEmptyString(options.mode)
            ? String(options.mode)
            : 'assign';

        if (VALID_MODES.indexOf(mode) === -1) {
            notify('Unknown modal mode.', 'error');
            return null;
        }

        // ---- Common validation ----
        if (!isNonEmptyString(options.classId)) {
            notify('Class ID is required.', 'error');
            return null;
        }

        var week = parseStrictInteger(options.week);
        if (week === null) {
            notify('Valid week is required.', 'error');
            return null;
        }

        var day = parseStrictInteger(options.day);
        if (day === null) {
            notify('Valid day is required.', 'error');
            return null;
        }

        var startHour = parseStrictInteger(options.startHour);
        if (startHour === null) {
            notify('Valid start hour is required.', 'error');
            return null;
        }

        // ---- Mode-specific validation ----
        var charId = null;
        var groupId = null;
        var sessionId = null;

        if (mode === 'assign' || mode === 'remove-student') {
            if (!isNonEmptyString(options.charId)) {
                notify('Character ID is required.', 'error');
                return null;
            }
            charId = String(options.charId);
        }

        if (mode === 'remove-student' || mode === 'remove-group') {
            if (!isNonEmptyString(options.groupId)) {
                notify('Group ID is required.', 'error');
                return null;
            }
            groupId = String(options.groupId);
        }

        if (mode === 'remove-student' || mode === 'remove-group') {
            // sessionId is optional — used for display only in the
            // confirmation, not for the mutation. The cascade that
            // removes a group finds its own sessions; removing a
            // single student does not touch sessions.
            sessionId = isNonEmptyString(options.sessionId)
                ? String(options.sessionId)
                : null;
        }

        // Close any prior instance.
        closeModal();

        _context = {
            mode: mode,
            charId: charId,
            classId: String(options.classId),
            week: week,
            day: day,
            startHour: startHour,
            groupId: groupId,
            sessionId: sessionId,
            disciplineName: isNonEmptyString(options.disciplineName)
                ? String(options.disciplineName)
                : '',
            duration: parseStrictInteger(options.duration),
            memberCount: parseStrictInteger(options.memberCount),
            sessionCount: parseStrictInteger(options.sessionCount)
        };
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;
        _selectedDisciplineId = '';
        _selectedDuration = DEFAULT_DURATION;
        _pendingCollision = null;
        _busy = false;

        var shell = Modal.createModal('academy-schedule-assign-modal');
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'academy-schedule-assign-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        _contentChangeHandler = handleContentChange;
        _contentClickHandler = handleContentClick;
        contentEl.addEventListener('change', _contentChangeHandler);
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
                    '[AcademyScheduleAssignModal] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _context = null;
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
        _selectedDisciplineId = '';
        _selectedDuration = DEFAULT_DURATION;
        _pendingCollision = null;
        _busy = false;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================

    /**
     * Build the modal's view model from current context and state.
     *
     * In 'assign' mode, the discipline list is the class's active
     * offerings for the target week.
     * In 'remove-student' and 'remove-group' modes, the discipline
     * list is not needed; the context carries the display fields.
     */
    function buildViewModel() {
        if (!_context) { return null; }

        var slotDisplay = formatDay(_context.day) + ', ' +
                          formatStartHour(_context.startHour) +
                          ', Week ' + _context.week;

        var base = {
            mode: _context.mode,
            charId: _context.charId,
            classId: _context.classId,
            week: _context.week,
            day: _context.day,
            startHour: _context.startHour,
            groupId: _context.groupId,
            sessionId: _context.sessionId,
            disciplineName: _context.disciplineName,
            duration: _context.duration,
            memberCount: _context.memberCount,
            sessionCount: _context.sessionCount,
            slotDisplay: slotDisplay,
            busy: _busy,
            pendingCollision: _pendingCollision
        };

        if (_context.mode === 'assign') {
            var rows = buildAssignDisciplineRows();
            base.charName = getCharacterName(_context.charId);
            base.disciplines = rows;
            base.selectedDisciplineId = _selectedDisciplineId;
            base.selectedDuration = _selectedDuration;
            base.durations = buildDurationOptions();
        } else if (_context.mode === 'remove-student') {
            base.charName = getCharacterName(_context.charId);
        }

        return base;
    }

    function buildAssignDisciplineRows() {
        var offerings = [];
        try {
            offerings = AcademyClassDisciplinesQueries
                .getClassDisciplinesForClass(_context.classId) || [];
        } catch (e) {
            offerings = [];
        }

        var rows = [];
        for (var i = 0; i < offerings.length; i++) {
            var rec = offerings[i];
            if (!rec || !rec.disciplineId) { continue; }

            var active = false;
            try {
                active = AcademyClassDisciplinesQueries
                    .isActiveInWeek(
                        _context.classId,
                        rec.disciplineId,
                        _context.week
                    ) === true;
            } catch (e) {
                active = false;
            }
            if (!active) { continue; }

            var disc = AcademyDisciplines.getDiscipline(rec.disciplineId);
            if (!disc) { continue; }

            rows.push({
                id: String(rec.disciplineId),
                name: isNonEmptyString(disc.name)
                    ? disc.name
                    : 'Unnamed Discipline',
                mandatory: rec.mandatory === true
            });
        }

        rows.sort(function(a, b) {
            if (a.mandatory !== b.mandatory) {
                return a.mandatory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return rows;
    }

    function buildDurationOptions() {
        var durations = [];
        for (var d = MIN_DURATION; d <= MAX_DURATION; d++) {
            durations.push(d);
        }
        return durations;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl) { return; }
        var vm = buildViewModel();
        if (!vm) { return; }
        _contentEl.innerHTML = buildModalHTML(vm);
    }

    function buildModalHTML(vm) {
        switch (vm.mode) {
            case 'remove-student':
                return buildRemoveStudentHTML(vm);
            case 'remove-group':
                return buildRemoveGroupHTML(vm);
            case 'assign':
            default:
                return buildAssignHTML(vm);
        }
    }

    // ============================================================
    // HTML — ASSIGN MODE
    // ============================================================

    function buildAssignHTML(vm) {
        var html = '';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>Assign discipline</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-assign-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body">';

        html += '<p class="academy-schedule-assign-summary">' +
                    'Slot: <strong>' +
                    escapeHtml(vm.slotDisplay) +
                    '</strong> for <strong>' +
                    escapeHtml(vm.charName) +
                    '</strong>' +
                '</p>';

        if (vm.disciplines.length === 0) {
            html += '<p class="empty-state small">' +
                        'This class has no active offerings during ' +
                        'week ' + vm.week + '. Add a discipline to ' +
                        'the class first.' +
                    '</p>';
            html += '</div>';
            html += renderAssignFooter(vm, true);
            return html;
        }

        html += '<div class="form-group">';
        html += '<label for="academy-schedule-assign-discipline">' +
                    'Discipline *' +
                '</label>';
        html += '<select id="academy-schedule-assign-discipline" ' +
                    'class="academy-schedule-assign-discipline"' +
                    (vm.busy ? ' disabled' : '') + '>';
        html += '<option value="">Select a discipline...</option>';
        for (var i = 0; i < vm.disciplines.length; i++) {
            var d = vm.disciplines[i];
            var selected = String(d.id) === String(vm.selectedDisciplineId)
                ? ' selected'
                : '';
            var suffix = d.mandatory ? ' (mandatory)' : '';
            html += '<option value="' + escapeAttribute(d.id) + '"' +
                        selected + '>' +
                        escapeHtml(d.name + suffix) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="academy-schedule-assign-duration">' +
                    'Duration (hours)' +
                '</label>';
        html += '<select id="academy-schedule-assign-duration" ' +
                    'class="academy-schedule-assign-duration"' +
                    (vm.busy ? ' disabled' : '') + '>';
        for (var j = 0; j < vm.durations.length; j++) {
            var dur = vm.durations[j];
            var durSelected = dur === vm.selectedDuration
                ? ' selected'
                : '';
            html += '<option value="' + dur + '"' + durSelected + '>' +
                        dur + ' hour' + (dur === 1 ? '' : 's') +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        if (vm.pendingCollision) {
            html += renderCollisionPrompt(vm.pendingCollision);
        }

        html += '</div>';

        // ---- Footer ----
        html += renderAssignFooter(vm, false);

        return html;
    }

    function renderAssignFooter(vm, noOfferings) {
        var busy = vm.busy === true;
        var hasCollision = !!vm.pendingCollision;

        var hasDiscipline = isNonEmptyString(vm.selectedDisciplineId);
        var submitDisabled = noOfferings || busy ||
            (!hasCollision && !hasDiscipline);

        var submitLabel = hasCollision ? 'Assign anyway' : 'Assign';
        var submitAction = hasCollision
            ? 'schedule-assign-confirm'
            : 'schedule-assign-submit';

        var html = '';
        html += '<div class="modal-footer academy-schedule-assign-footer">';

        html += '<button type="button" class="secondary" ' +
                    'data-assign-action="close"' +
                    (busy ? ' disabled' : '') + '>' +
                    'Cancel' +
                '</button>';

        if (!noOfferings) {
            html += '<button type="button" class="primary" ' +
                        'data-assign-action="' + submitAction + '"' +
                        (submitDisabled ? ' disabled' : '') + '>' +
                        escapeHtml(submitLabel) +
                    '</button>';
        }

        html += '</div>';
        return html;
    }

    function renderCollisionPrompt(collision) {
        var message = '';
        if (collision.type === 'student') {
            message =
                (collision.studentName || 'The student') +
                ' is already scheduled at an overlapping time' +
                (collision.week ? ' (week ' + collision.week + ')' : '') +
                '.';
        } else if (collision.type === 'instructor') {
            message =
                (collision.instructorName || 'The instructor') +
                ' is already teaching at an overlapping time.';
        } else {
            message = 'A schedule conflict was detected.';
        }

        var html = '';
        html += '<div class="academy-schedule-assign-collision">';
        html += '<p class="academy-schedule-assign-collision-text">' +
                    escapeHtml(message) +
                '</p>';
        html += '<p class="academy-schedule-assign-collision-question">' +
                    'Assign anyway?' +
                '</p>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // HTML — REMOVE-STUDENT MODE
    // ============================================================

    function buildRemoveStudentHTML(vm) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Remove student from slot</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-assign-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="academy-schedule-assign-summary">' +
                    'Slot: <strong>' +
                    escapeHtml(vm.slotDisplay) +
                    '</strong>' +
                '</p>';

        html += '<div class="academy-schedule-assign-remove-warning">';
        html += '<p class="academy-schedule-assign-remove-warning-title">' +
                    'Remove ' +
                    escapeHtml(vm.charName) +
                    ' from this slot?' +
                '</p>';
        html += '<p class="academy-schedule-assign-remove-warning-text">' +
                    'They will no longer appear on the roster for ' +
                    'this group. The session and the group remain; ' +
                    'other students are unaffected.' +
                '</p>';
        html += '</div>';

        html += renderRemoveDetailPanel(vm, false);

        html += '</div>';

        html += '<div class="modal-footer academy-schedule-assign-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-assign-action="close"' +
                    (vm.busy ? ' disabled' : '') + '>' +
                    'Cancel' +
                '</button>';
        html += '<button type="button" class="danger" ' +
                    'data-assign-action="schedule-remove-student-submit"' +
                    (vm.busy ? ' disabled' : '') + '>' +
                    'Remove' +
                '</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // HTML — REMOVE-GROUP MODE
    // ============================================================

    function buildRemoveGroupHTML(vm) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Delete teaching group</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-assign-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="academy-schedule-assign-summary">' +
                    'Slot: <strong>' +
                    escapeHtml(vm.slotDisplay) +
                    '</strong>' +
                '</p>';

        html += '<div class="academy-schedule-assign-remove-warning">';
        html += '<p class="academy-schedule-assign-remove-warning-title">' +
                    'Delete this group and everything on it?' +
                '</p>';
        html += '<p class="academy-schedule-assign-remove-warning-text">' +
                    'This removes the teaching group, every session ' +
                    'scheduled on it, and every student membership. ' +
                    'This cannot be undone.' +
                '</p>';
        html += '</div>';

        html += renderRemoveDetailPanel(vm, true);

        html += '</div>';

        html += '<div class="modal-footer academy-schedule-assign-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-assign-action="close"' +
                    (vm.busy ? ' disabled' : '') + '>' +
                    'Cancel' +
                '</button>';
        html += '<button type="button" class="danger" ' +
                    'data-assign-action="schedule-remove-group-submit"' +
                    (vm.busy ? ' disabled' : '') + '>' +
                    'Delete Group' +
                '</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // HTML — SHARED REMOVE DETAIL PANEL
    // ============================================================

    function renderRemoveDetailPanel(vm, showSessionCount) {
        var disciplineName = isNonEmptyString(vm.disciplineName)
            ? vm.disciplineName
            : 'Unknown discipline';

        var rows = [];
        rows.push({
            label: 'Discipline',
            value: disciplineName
        });

        if (vm.duration !== null && vm.duration !== undefined) {
            rows.push({
                label: 'Duration',
                value: formatDuration(vm.duration)
            });
        }

        if (vm.memberCount !== null && vm.memberCount !== undefined) {
            rows.push({
                label: 'Students on this group',
                value: String(vm.memberCount)
            });
        }

        if (showSessionCount &&
            vm.sessionCount !== null &&
            vm.sessionCount !== undefined) {
            rows.push({
                label: 'Sessions on this group',
                value: String(vm.sessionCount)
            });
        }

        var html = '';
        html += '<div class="academy-schedule-assign-remove-detail">';
        for (var i = 0; i < rows.length; i++) {
            html += '<div class="academy-schedule-assign-remove-detail-row">';
            html += '<span class="academy-schedule-assign-remove-detail-label">' +
                        escapeHtml(rows[i].label) +
                    '</span>';
            html += '<span class="academy-schedule-assign-remove-detail-value">' +
                        escapeHtml(rows[i].value) +
                    '</span>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleContentChange(e) {
        if (_busy) { return; }
        if (!_context || _context.mode !== 'assign') { return; }

        var target = e.target;
        if (!target || !target.classList) { return; }

        if (target.classList.contains(
            'academy-schedule-assign-discipline'
        )) {
            _selectedDisciplineId = target.value || '';
            // A change in discipline invalidates any pending
            // collision prompt. The next submit is fresh.
            if (_pendingCollision) {
                _pendingCollision = null;
            }
            renderContent();
            return;
        }

        if (target.classList.contains(
            'academy-schedule-assign-duration'
        )) {
            var dur = parseStrictInteger(target.value);
            if (dur !== null) {
                _selectedDuration = dur;
            }
            return;
        }
    }

    function handleContentClick(e) {
        if (_busy) {
            e.preventDefault();
            return;
        }

        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var actionEl = target.closest('[data-assign-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.assignAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'schedule-assign-submit') {
            e.preventDefault();
            submitAssign(false);
            return;
        }

        if (action === 'schedule-assign-confirm') {
            e.preventDefault();
            submitAssign(true);
            return;
        }

        if (action === 'schedule-remove-student-submit') {
            e.preventDefault();
            submitRemoveStudent();
            return;
        }

        if (action === 'schedule-remove-group-submit') {
            e.preventDefault();
            submitRemoveGroup();
            return;
        }
    }

    // ============================================================
    // SUBMIT — ASSIGN
    // ============================================================

    function submitAssign(allowCollisions) {
        if (!_context || _context.mode !== 'assign') { return; }
        if (_busy) { return; }

        if (!isNonEmptyString(_selectedDisciplineId)) {
            notify('Select a discipline.', 'error');
            return;
        }

        var duration = parseStrictInteger(_selectedDuration);
        if (duration === null) {
            duration = DEFAULT_DURATION;
        }

        _busy = true;
        renderContent();

        var payload = {
            charId: _context.charId,
            classId: _context.classId,
            disciplineId: _selectedDisciplineId,
            week: _context.week,
            day: _context.day,
            startHour: _context.startHour,
            duration: duration,
            allowCollisions: allowCollisions === true
        };

        AcademySchedule.assignStudentToSlot(payload)
            .then(function(result) {
                _busy = false;

                if (result && result.success) {
                    notify('Slot assigned.', 'success');
                    // closeModal fires _onClose for us.
                    closeModal();
                    return;
                }

                // Rejection. Decide between a collision prompt
                // (retryable) and a structural error (not).
                if (result && result.reason === 'student_collision') {
                    var studCol = (result.data && result.data.collision)
                        ? result.data.collision
                        : { type: 'student' };
                    _pendingCollision = studCol;
                    renderContent();
                    return;
                }

                if (result && result.reason === 'instructor_collision') {
                    var instrCol = (result.data && result.data.collision)
                        ? result.data.collision
                        : { type: 'instructor' };
                    _pendingCollision = instrCol;
                    renderContent();
                    return;
                }

                // Structural rejection. Show the message, leave
                // the modal open so the user can adjust or close.
                _pendingCollision = null;

                var msg = (result && result.message)
                    ? result.message
                    : 'Could not assign this slot.';
                notify(msg, 'error');
                renderContent();
            })
            .catch(function(err) {
                _busy = false;
                _pendingCollision = null;
                console.warn(
                    '[AcademyScheduleAssignModal] assign threw:', err
                );
                notify('Could not assign this slot.', 'error');
                renderContent();
            });
    }

    // ============================================================
    // SUBMIT — REMOVE STUDENT
    // ============================================================

    function submitRemoveStudent() {
        if (!_context || _context.mode !== 'remove-student') { return; }
        if (_busy) { return; }

        if (!isNonEmptyString(_context.charId)) {
            notify('Character ID is required.', 'error');
            return;
        }
        if (!isNonEmptyString(_context.groupId)) {
            notify('Group ID is required.', 'error');
            return;
        }

        _busy = true;
        renderContent();

        AcademyTeachingGroups.removeMemberRecord(
            _context.groupId,
            _context.charId
        ).then(function(result) {
            _busy = false;

            if (result && result.success) {
                notify('Student removed from group.', 'success');
                closeModal();
                return;
            }

            var msg = (result && result.message)
                ? result.message
                : 'Could not remove the student.';
            notify(msg, 'error');
            renderContent();
        }).catch(function(err) {
            _busy = false;
            console.warn(
                '[AcademyScheduleAssignModal] removeMemberRecord threw:',
                err
            );
            notify('Could not remove the student.', 'error');
            renderContent();
        });
    }

    // ============================================================
    // SUBMIT — REMOVE GROUP
    // ============================================================

    function submitRemoveGroup() {
        if (!_context || _context.mode !== 'remove-group') { return; }
        if (_busy) { return; }

        if (!isNonEmptyString(_context.groupId)) {
            notify('Group ID is required.', 'error');
            return;
        }
        if (!isNonEmptyString(_context.classId)) {
            notify('Class ID is required.', 'error');
            return;
        }

        _busy = true;
        renderContent();

        AcademySchedule.removeTeachingGroup({
            groupId: _context.groupId,
            classId: _context.classId
        }).then(function(result) {
            _busy = false;

            if (result && result.success) {
                var stats = result.data || {};
                var sessions = (typeof stats.sessionsRemoved === 'number')
                    ? stats.sessionsRemoved
                    : 0;
                var members = (typeof stats.membersRemoved === 'number')
                    ? stats.membersRemoved
                    : 0;
                var msg = 'Teaching group deleted';
                if (sessions > 0 || members > 0) {
                    msg += ' (' + sessions + ' session' +
                        (sessions === 1 ? '' : 's') + ', ' +
                        members + ' membership' +
                        (members === 1 ? '' : 's') + ')';
                }
                msg += '.';
                notify(msg, 'success');
                closeModal();
                return;
            }

            var errMsg = (result && result.message)
                ? result.message
                : 'Could not delete the teaching group.';
            notify(errMsg, 'error');
            renderContent();
        }).catch(function(err) {
            _busy = false;
            console.warn(
                '[AcademyScheduleAssignModal] removeTeachingGroup threw:',
                err
            );
            notify('Could not delete the teaching group.', 'error');
            renderContent();
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyScheduleAssignModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyScheduleAssignModal;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyScheduleAssignModal] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();