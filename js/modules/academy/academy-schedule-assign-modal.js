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
 *   'assign'          (default) pick a discipline + duration +
 *                     optional location, submit
 *                     → AcademySchedule.assignStudentToSlot
 *   'remove-student'  confirm removal of one student from one group
 *                     → AcademyTeachingGroups.removeMemberRecord
 *   'remove-group'    confirm deletion of the entire group and every
 *                     session and student membership it owns
 *                     → AcademySchedule.removeTeachingGroup
 *
 * WHAT THIS MODULE OWNS:
 *   The modal shell, its content, its listeners, its view model, and
 *   its submission handlers for all three modes. Opened from the
 *   character detail panel's Schedule tab, via the People controller,
 *   when the user clicks a grid cell.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The schedule grid. CalendarRenderer produces it.
 *   - The click dispatch. AcademyPeopleController routes to this
 *     module's openModal.
 *   - Group and session resolution. AcademySchedule owns it.
 *   - Discipline eligibility. The modal offers the class's active
 *     offerings via AcademyClassDisciplinesQueries; whether a given
 *     offering is legal for the student is decided by the domain.
 *   - Location eligibility. The modal offers every location in the
 *     store; the domain validates the chosen ID. An empty location
 *     is valid.
 *   - Collision policy. The domain detects collisions; this modal
 *     surfaces the rejection and offers a retry with
 *     allowCollisions.
 *
 * SESSION LOCATION:
 *   The 'assign' mode form gains a location dropdown, sourced from
 *   AcademyLocations.getLocations(). Optional. An empty selection
 *   sends locationId: null.
 *
 *   The location is applied ONLY when the domain creates a new
 *   session. When the student is assigned to an existing session
 *   (matching day / start hour / duration on a candidate group),
 *   the location select is ignored — the session keeps its own
 *   location. That is the domain's rule and this modal honors it by
 *   not pretending to override it.
 *
 *   To change the location of an existing session, use the session
 *   form (from the Teaching Groups tab's Sessions list).
 *
 * INSTRUCTOR PICKER (this revision):
 *   When more than one instructor teaches the selected discipline
 *   for the selected class at the target week, the modal offers an
 *   inline instructor picker and includes `instructorId` in the
 *   submission payload. The domain then skips its own instructor
 *   resolution and proceeds straight to the collision check.
 *
 *   The picker is reached two ways:
 *
 *     1. PRE-FLIGHT (primary).
 *        When the user picks a discipline, the modal reads the
 *        class's instructors for that (class, discipline, week)
 *        directly via AcademyClasses.getClassInstructorIds and
 *        decides:
 *          - zero instructors: show an inline error, disable submit
 *          - one instructor:   auto-select, no picker shown
 *          - many instructors: show the picker
 *        This is the normal flow. It removes the round trip and
 *        makes the multi-instructor case a first-class affordance,
 *        not a stall.
 *
 *     2. FALLBACK.
 *        If the domain still returns
 *        reason: 'ambiguous_instructor' — because the pre-flight
 *        was skipped, or because the state changed between
 *        pre-flight and submit — the modal enters the picker
 *        sub-state using the rejection's data.instructorIds. The
 *        pending discipline / duration / location selections
 *        survive the transition. The retry carries the chosen
 *        instructorId.
 *
 *   The two paths share the picker rendering. The fallback exists
 *   because two reads can disagree; it is not the primary path.
 *
 * MODAL SHAPE — ASSIGN MODE:
 *   Header: "Assign discipline"
 *   Body:
 *     - Slot summary line
 *     - Discipline select
 *     - Instructor picker (only when > 1 instructor available)
 *     - Duration select
 *     - Location select (optional)
 *   Footer:
 *     - Cancel
 *     - Assign (disabled until a discipline is chosen and an
 *       instructor is resolved)
 *
 * MODAL SHAPE — REMOVE-STUDENT MODE:
 *   Header: "Remove student from slot"
 *   Body:
 *     - Slot summary line
 *     - Warning panel
 *     - Detail: discipline, duration, member count
 *   Footer:
 *     - Cancel
 *     - Remove (danger)
 *
 * MODAL SHAPE — REMOVE-GROUP MODE:
 *   Header: "Delete teaching group"
 *   Body:
 *     - Slot summary line
 *     - Warning panel
 *     - Detail: discipline, duration, member count, session count
 *   Footer:
 *     - Cancel
 *     - Delete Group (danger)
 *
 * COLLISION RETRY:
 *   When assignStudentToSlot rejects with reason: 'student_collision'
 *   or reason: 'instructor_collision', the modal shows a
 *   confirmation inline. Other rejections are shown as an error
 *   toast.
 *
 * WINDOW SEMANTICS:
 *   The membership window is derived by the domain, not the modal.
 *   The modal passes only `week`.
 *
 * INPUT VALIDATION:
 *   The modal performs strict numeric validation on the values it
 *   receives from the controller. This is UX validation, not
 *   authority. The domain re-validates everything.
 *
 * LISTENER DISCIPLINE:
 *   Content listeners are bound ONCE, on the modal's content element,
 *   when the modal is created. Re-rendering replaces innerHTML but
 *   does not rebind.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyUI
 *   - window.AcademyClasses
 *   - window.AcademyClassDisciplinesQueries
 *   - window.AcademyDisciplines
 *   - window.AcademyLocations
 *   - window.AcademySchedule
 *   - window.AcademyTeachingGroups
 *   - window.CharacterQueries
 *   - window.CalendarConstants
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
    var AcademyClasses = window.AcademyClasses;
    var AcademyClassDisciplinesQueries =
        window.AcademyClassDisciplinesQueries;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyLocations = window.AcademyLocations;
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
    if (!AcademyClasses ||
        typeof AcademyClasses.getClassInstructorIds !== 'function') {
        _missing.push('AcademyClasses.getClassInstructorIds');
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
    if (!AcademyLocations ||
        typeof AcademyLocations.getLocations !== 'function') {
        _missing.push('AcademyLocations.getLocations');
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

    var _selectedDisciplineId = '';
    var _selectedDuration = DEFAULT_DURATION;
    var _selectedLocationId = '';

    // Instructor picker state.
    //
    //   _availableInstructors  [{ id, name }, ...]  — the current
    //                          candidate list for the selected
    //                          discipline at the target week. Empty
    //                          when no discipline is selected or
    //                          when the discipline has no
    //                          instructors.
    //   _selectedInstructorId  '' when auto-resolution has not been
    //                          needed (single instructor auto-picks
    //                          into this field) or when the picker
    //                          is still open.
    //   _instructorError       '' when the instructor situation is
    //                          clean; a message string otherwise
    //                          (e.g. "No instructor teaches this
    //                          discipline for this class").
    //   _showInstructorPicker  true when the picker panel is
    //                          rendered. Set when the candidate
    //                          list has more than one entry.
    var _availableInstructors = [];
    var _selectedInstructorId = '';
    var _instructorError = '';
    var _showInstructorPicker = false;

    // When the domain rejects with a policy collision, the modal
    // shows a confirm prompt. `_pendingCollision` holds the last
    // rejection so the retry can carry its reason forward.
    var _pendingCollision = null;

    // True while a submission is in flight.
    var _busy = false;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

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
    // LOCATION LIST
    // ============================================================

    function getAvailableLocations() {
        var all = [];
        try {
            all = AcademyLocations.getLocations() || [];
        } catch (e) {
            all = [];
        }
        all.sort(function(a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
        return all;
    }

    // ============================================================
    // INSTRUCTOR RESOLUTION
    // ============================================================
    //
    // Reads the class's instructors for a (discipline, week) pair
    // via the canonical query. Returns a normalised list of
    // { id, name } objects, sorted alphabetically by name.
    //
    // A character whose record cannot be resolved is dropped from
    // the list; the picker never offers an instructor it cannot
    // name. This is a defensive filter, not a policy decision —
    // the domain will reject the assignment if the chosen
    // instructor is not actually valid.
    //
    // Errors from the read are logged and treated as an empty list.
    // The modal then shows the "no instructor" error, which is the
    // honest UI for a broken read.

    function readAvailableInstructors(classId, disciplineId, week) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId)) {
            return [];
        }

        var weekNum = parseStrictInteger(week);
        if (weekNum === null) {
            return [];
        }

        var rawIds = [];
        try {
            rawIds = AcademyClasses.getClassInstructorIds(
                classId,
                weekNum,
                { disciplineId: String(disciplineId) }
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyScheduleAssignModal] ' +
                'getClassInstructorIds failed:', e
            );
            return [];
        }

        if (!Array.isArray(rawIds)) {
            return [];
        }

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < rawIds.length; i++) {
            if (!rawIds[i]) { continue; }
            var id = String(rawIds[i]);
            if (seen[id]) { continue; }
            seen[id] = true;

            var char = CharacterQueries.getCharacterById(id);
            if (!char) { continue; }

            var name = CharacterQueries.getDisplayName(char);
            if (!isNonEmptyString(name)) {
                name = 'Unknown';
            }

            result.push({ id: id, name: name });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    /**
     * Update instructor state based on the currently-selected
     * discipline.
     *
     * Called whenever the discipline changes, and once at open when
     * a discipline is pre-selected (it is not, in this modal — the
     * user always picks).
     *
     * Clears any prior collision state. The collision was resolved
     * against a specific instructor; changing discipline invalidates
     * it.
     */
    function refreshInstructorState() {
        _availableInstructors = [];
        _selectedInstructorId = '';
        _instructorError = '';
        _showInstructorPicker = false;
        _pendingCollision = null;

        if (!_context || _context.mode !== 'assign') {
            return;
        }

        if (!isNonEmptyString(_selectedDisciplineId)) {
            return;
        }

        var list = readAvailableInstructors(
            _context.classId,
            _selectedDisciplineId,
            _context.week
        );

        _availableInstructors = list;

        if (list.length === 0) {
            _instructorError =
                'No instructor teaches this discipline for this ' +
                'class during the requested week.';
            return;
        }

        if (list.length === 1) {
            _selectedInstructorId = list[0].id;
            return;
        }

        _showInstructorPicker = true;
        // _selectedInstructorId stays ''. The user picks.
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

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
            sessionId = isNonEmptyString(options.sessionId)
                ? String(options.sessionId)
                : null;
        }

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
        _selectedLocationId = '';
        _availableInstructors = [];
        _selectedInstructorId = '';
        _instructorError = '';
        _showInstructorPicker = false;
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
        _selectedLocationId = '';
        _availableInstructors = [];
        _selectedInstructorId = '';
        _instructorError = '';
        _showInstructorPicker = false;
        _pendingCollision = null;
        _busy = false;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================

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
            base.locations = getAvailableLocations();
            base.selectedLocationId = _selectedLocationId;
            base.instructors = _availableInstructors;
            base.selectedInstructorId = _selectedInstructorId;
            base.instructorError = _instructorError;
            base.showInstructorPicker = _showInstructorPicker;
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

        html += '<div class="modal-header">';
        html += '<h3>Assign discipline</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-assign-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

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

        // ---- Discipline ----
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

        // ---- Instructor picker / error (only when a discipline
        //      is selected) ----
        if (isNonEmptyString(vm.selectedDisciplineId)) {
            if (isNonEmptyString(vm.instructorError)) {
                html += renderInstructorError(vm.instructorError);
            } else if (vm.showInstructorPicker) {
                html += renderInstructorPicker(vm);
            } else if (isNonEmptyString(vm.selectedInstructorId)) {
                html += renderInstructorAutoSelected(vm);
            }
        }

        // ---- Duration ----
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

        // ---- Location (optional) ----
        html += renderLocationSelect(vm);

        if (vm.pendingCollision) {
            html += renderCollisionPrompt(vm.pendingCollision);
        }

        html += '</div>';

        html += renderAssignFooter(vm, false);

        return html;
    }

    function renderInstructorPicker(vm) {
        var instructors = Array.isArray(vm.instructors)
            ? vm.instructors
            : [];

        if (instructors.length === 0) { return ''; }

        var html = '';
        html += '<div class="form-group academy-schedule-assign-instructors">';
        html += '<label class="academy-schedule-assign-instructors-label">' +
                    'Instructor *' +
                '</label>';
        html += '<p class="field-hint academy-schedule-assign-instructors-hint">' +
                    'More than one instructor teaches this discipline ' +
                    'for this class. Choose which one to schedule with.' +
                '</p>';

        html += '<div class="academy-schedule-assign-instructors-list">';

        for (var i = 0; i < instructors.length; i++) {
            var instr = instructors[i];
            if (!instr || !instr.id) { continue; }

            var checked = String(instr.id) ===
                String(vm.selectedInstructorId)
                ? ' checked'
                : '';

            html += '<label class="academy-schedule-assign-instructor-option">';
            html += '<input type="radio" ' +
                        'name="academy-schedule-assign-instructor" ' +
                        'class="academy-schedule-assign-instructor-radio" ' +
                        'data-instructor-id="' +
                            escapeAttribute(instr.id) + '"' +
                        checked +
                        (vm.busy ? ' disabled' : '') + '>';
            html += '<span class="academy-schedule-assign-instructor-name">' +
                        escapeHtml(instr.name) +
                    '</span>';
            html += '</label>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderInstructorError(message) {
        var html = '';
        html += '<div class="academy-schedule-assign-instructors-error">';
        html += '<p class="academy-schedule-assign-instructors-error-text">' +
                    escapeHtml(message) +
                '</p>';
        html += '</div>';
        return html;
    }

    function renderInstructorAutoSelected(vm) {
        var instructor = null;
        for (var i = 0; i < vm.instructors.length; i++) {
            if (String(vm.instructors[i].id) ===
                String(vm.selectedInstructorId)) {
                instructor = vm.instructors[i];
                break;
            }
        }
        if (!instructor) { return ''; }

        var html = '';
        html += '<div class="form-group academy-schedule-assign-instructors">';
        html += '<label class="academy-schedule-assign-instructors-label">' +
                    'Instructor' +
                '</label>';
        html += '<p class="academy-schedule-assign-instructor-single">' +
                    escapeHtml(instructor.name) +
                    ' <span class="academy-schedule-assign-instructor-single-note">' +
                        '(only instructor for this discipline)' +
                    '</span>' +
                '</p>';
        html += '</div>';
        return html;
    }

    function renderLocationSelect(vm) {
        var locations = Array.isArray(vm.locations) ? vm.locations : [];

        var html = '';
        html += '<div class="form-group">';
        html += '<label for="academy-schedule-assign-location">' +
                    'Location' +
                '</label>';
        html += '<select id="academy-schedule-assign-location" ' +
                    'class="academy-schedule-assign-location"' +
                    (vm.busy ? ' disabled' : '') + '>';
        html += '<option value="">(no location)</option>';

        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            if (!loc || !loc.id) { continue; }
            var isSelected = String(loc.id) ===
                String(vm.selectedLocationId) ? ' selected' : '';
            html += '<option value="' +
                        escapeAttribute(loc.id) + '"' + isSelected + '>' +
                        escapeHtml(loc.name || 'Unnamed Location') +
                    '</option>';
        }

        html += '</select>';
        html += '<p class="field-hint">' +
                    'Used only when a new session is created. Adding ' +
                    'the student to an existing session keeps that ' +
                    'session\'s location.' +
                '</p>';
        html += '</div>';
        return html;
    }

    /**
     * Is the form ready to submit?
     *
     * The submit button is disabled until:
     *   - a discipline is chosen
     *   - the discipline resolves to exactly one instructor, OR
     *     the user has picked one from the picker
     *
     * A collision prompt overrides the disabled state — the user
     * is confirming an already-complete assignment.
     */
    function canSubmitAssign(vm) {
        if (vm.busy) { return false; }
        if (vm.pendingCollision) { return true; }

        if (!isNonEmptyString(vm.selectedDisciplineId)) {
            return false;
        }
        if (isNonEmptyString(vm.instructorError)) {
            return false;
        }
        if (!isNonEmptyString(vm.selectedInstructorId)) {
            return false;
        }
        return true;
    }

    function renderAssignFooter(vm, noOfferings) {
        var busy = vm.busy === true;
        var hasCollision = !!vm.pendingCollision;
        var canSubmit = canSubmitAssign(vm);

        var submitDisabled = noOfferings || !canSubmit;

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

            // A new discipline invalidates any prior collision —
            // the collision was against a specific instructor.
            // refreshInstructorState clears _pendingCollision.
            refreshInstructorState();

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

        if (target.classList.contains(
            'academy-schedule-assign-location'
        )) {
            _selectedLocationId = target.value || '';
            return;
        }

        // ---- Instructor radio ----
        if (target.classList.contains(
            'academy-schedule-assign-instructor-radio'
        )) {
            var instrId = target.dataset
                ? target.dataset.instructorId
                : '';
            _selectedInstructorId = isNonEmptyString(instrId)
                ? String(instrId)
                : '';

            // A changed instructor invalidates any prior collision.
            _pendingCollision = null;

            renderContent();
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

        if (isNonEmptyString(_instructorError)) {
            notify(_instructorError, 'error');
            return;
        }

        if (!isNonEmptyString(_selectedInstructorId)) {
            notify('Choose an instructor.', 'error');
            return;
        }

        var duration = parseStrictInteger(_selectedDuration);
        if (duration === null) {
            duration = DEFAULT_DURATION;
        }

        var locationId = isNonEmptyString(_selectedLocationId)
            ? String(_selectedLocationId)
            : null;

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
            locationId: locationId,
            instructorId: _selectedInstructorId,
            allowCollisions: allowCollisions === true
        };

        AcademySchedule.assignStudentToSlot(payload)
            .then(function(result) {
                _busy = false;

                if (result && result.success) {
                    notify('Slot assigned.', 'success');
                    closeModal();
                    return;
                }

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

                // ---- Fallback: domain says the instructor set is
                //      still ambiguous. The pre-flight was skipped
                //      or the state changed between pre-flight and
                //      submit. Re-enter the picker with the
                //      domain's list.
                if (result && result.reason === 'ambiguous_instructor') {
                    handleAmbiguousInstructorRejection(result);
                    return;
                }

                // ---- Fallback: domain says no instructor is
                //      enrolled for this discipline.
                if (result && result.reason === 'missing_instructor') {
                    _instructorError =
                        'No instructor teaches this discipline for ' +
                        'this class during the requested week.';
                    _selectedInstructorId = '';
                    _availableInstructors = [];
                    _showInstructorPicker = false;
                    _pendingCollision = null;
                    renderContent();
                    return;
                }

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

    /**
     * Handle a domain rejection with reason 'ambiguous_instructor'.
     *
     * The rejection shape is:
     *
     *   {
     *     reason: 'ambiguous_instructor',
     *     message: '...',
     *     data: { instructorIds: ['id1', 'id2', ...] }
     *   }
     *
     * We resolve the IDs to names via CharacterQueries and enter
     * the picker sub-state. If the list turns out to be empty or
     * single, we surface the appropriate error instead — the
     * domain's "ambiguous" claim is only meaningful when there are
     * at least two.
     */
    function handleAmbiguousInstructorRejection(result) {
        var ids = (result.data && Array.isArray(result.data.instructorIds))
            ? result.data.instructorIds
            : [];

        var resolved = [];
        var seen = Object.create(null);

        for (var i = 0; i < ids.length; i++) {
            if (!ids[i]) { continue; }
            var id = String(ids[i]);
            if (seen[id]) { continue; }
            seen[id] = true;

            var char = CharacterQueries.getCharacterById(id);
            if (!char) { continue; }

            var name = CharacterQueries.getDisplayName(char);
            if (!isNonEmptyString(name)) {
                name = 'Unknown';
            }

            resolved.push({ id: id, name: name });
        }

        resolved.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        if (resolved.length === 0) {
            _instructorError =
                'No instructor teaches this discipline for this ' +
                'class during the requested week.';
            _availableInstructors = [];
            _selectedInstructorId = '';
            _showInstructorPicker = false;
            renderContent();
            return;
        }

        if (resolved.length === 1) {
            _availableInstructors = resolved;
            _selectedInstructorId = resolved[0].id;
            _instructorError = '';
            _showInstructorPicker = false;
            renderContent();
            return;
        }

        // Two or more: enter the picker. Keep the user's discipline
        // and duration; the picker sits between them.
        _availableInstructors = resolved;
        _selectedInstructorId = '';
        _instructorError = '';
        _showInstructorPicker = true;
        renderContent();
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
