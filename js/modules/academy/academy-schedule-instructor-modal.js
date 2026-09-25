/**
 * modules/academy/academy-schedule-instructor-modal.js
 * Academy Schedule Instructor Modal
 *
 * Path: js/modules/academy/academy-schedule-instructor-modal.js
 *
 * The modal that lets an instructor claim an empty slot in their
 * own schedule grid for one of their disciplines, OR that lets a
 * discipline-grid click open a picker to choose which instructor
 * owns a new session at that slot.
 *
 * MODES:
 *   'direct'  (default) — instructorId is required; the modal is
 *                         opened from the instructor grid, which
 *                         already knows who the instructor is.
 *                         Behavior is unchanged from prior
 *                         revisions.
 *
 *   'picker'             — instructorId is optional. When absent,
 *                         the modal renders a discipline-scoped
 *                         instructor picker above the discipline
 *                         dropdown. When present, the picker is
 *                         skipped and the modal behaves like
 *                         'direct'. `disciplineId` is REQUIRED in
 *                         picker mode and pre-selects the
 *                         discipline dropdown, which renders
 *                         disabled.
 *
 * PICKER SOURCE:
 *   The instructor list is built from
 *   AcademyClasses.getClassInstructorIds(
 *     classId, week, { disciplineId }
 *   )
 *   then resolved to { id, name } via CharacterQueries. This is the
 *   canonical week-scoped query for "who teaches this discipline
 *   for this class this week" and it is already used by
 *   AcademyScheduleAssignModal for the same purpose.
 *
 *   A zero-instructor result is an inline error with a disabled
 *   submit. A one-instructor result is auto-selected (picker is not
 *   rendered). A multi-instructor result renders the picker.
 *
 * DISCIPLINE DROPDOWN IN PICKER MODE:
 *   When mode === 'picker', the discipline is fixed to the
 *   disciplineId passed in. The dropdown is rendered for
 *   orientation (the user sees which discipline they are
 *   scheduling for) but is disabled. Changing it would contradict
 *   the grid the user clicked on.
 *
 * FORM FIELDS (both modes):
 *   - Discipline  dropdown. Required.
 *   - Instructor  picker (picker mode only; direct mode has it
 *                 resolved by the caller).
 *   - Group       dropdown, sourced from the existing teaching
 *                 groups for the selected (class, discipline,
 *                 instructor) triple. Offers every existing group
 *                 plus a "create new group" sentinel. Only
 *                 rendered once a discipline AND an instructor are
 *                 resolved.
 *   - Duration    dropdown, MIN_CLASS_DURATION to
 *                 MAX_CLASS_DURATION. Required.
 *   - Location    dropdown, sourced from AcademyLocations.
 *                 Optional. An empty selection sends null.
 *
 * SESSION LOCATION:
 *   The location is applied ONLY when the domain creates a new
 *   session. When the resolver finds an exact-match session, the
 *   location select is ignored — the session keeps its own
 *   location. That is the domain's rule and this modal honors it
 *   by not pretending to override it.
 *
 * WINDOW:
 *   The session's startWeek / endWeek are the discipline's.
 *   The form does not surface week fields.
 *
 * EMPTY STATE:
 *   When the instructor teaches no disciplines for the currently
 *   selected class, the modal opens with a message and a disabled
 *   submit. There is nothing to offer.
 *
 *   In picker mode, when the discipline has no instructors this
 *   week, the modal shows the same style of empty state but with
 *   a different message.
 *
 * SUBMISSION:
 *   AcademySchedule.scheduleInstructorSlot({
 *       instructorId, classId, disciplineId,
 *       week, day, startHour, duration, locationId,
 *       groupId       OR forceNewGroup: true,
 *       allowCollisions
 *   })
 *
 *   On success: close, notify.
 *   On instructor_collision: inline retry prompt.
 *   On group_session_overlap: toast, stay open.
 *   On other rejections: toast, stay open.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The schedule coordinator (AcademySchedule owns it)
 *   - The teaching groups and sessions stores
 *   - The instructor's discipline list (derived from enrolments)
 *   - The location store (AcademyLocations owns it)
 *   - The grid (CalendarRenderer)
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyClasses
 *   - window.AcademyAggregator
 *   - window.AcademySchedule
 *   - window.AcademyLocations
 *   - window.AcademyTeachingGroups
 *   - window.AcademyDisciplines
 *   - window.AcademyUI
 *   - window.CharacterQueries
 *   - window.CalendarConstants
 */

(function() {
    'use strict';

    if (window.__academyScheduleInstructorModalLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyClasses = window.AcademyClasses;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademySchedule = window.AcademySchedule;
    var AcademyLocations = window.AcademyLocations;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyUI = window.AcademyUI;
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
    if (!AcademyClasses ||
        typeof AcademyClasses.getClassInstructorIds !== 'function') {
        _missing.push('AcademyClasses.getClassInstructorIds');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassInstructorDisciplines !== 'function') {
        _missing.push('AcademyAggregator.getClassInstructorDisciplines');
    }
    if (!AcademySchedule ||
        typeof AcademySchedule.scheduleInstructorSlot !== 'function') {
        _missing.push('AcademySchedule.scheduleInstructorSlot');
    }
    if (!AcademyLocations ||
        typeof AcademyLocations.getLocations !== 'function') {
        _missing.push('AcademyLocations.getLocations');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroupsForClassDisciplineInstructor !== 'function') {
        _missing.push(
            'AcademyTeachingGroups.getGroupsForClassDisciplineInstructor'
        );
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getActiveMembers !== 'function') {
        _missing.push('AcademyTeachingGroups.getActiveMembers');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyUI ||
        typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
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
        _missing.push('CalendarConstants day/hour/duration helpers');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyScheduleInstructorModal] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyScheduleInstructorModalLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var DEFAULT_DURATION = MIN_DURATION;

    var NEW_GROUP_SENTINEL = '';

    var VALID_MODES = ['direct', 'picker'];

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _context = null;
    var _onClose = null;

    var _contentClickHandler = null;
    var _contentChangeHandler = null;
    var _contentSubmitHandler = null;

    var _selectedDisciplineId = '';
    var _selectedDuration = DEFAULT_DURATION;
    var _selectedLocationId = '';
    var _selectedGroupId = NEW_GROUP_SENTINEL;
    var _availableGroups = [];

    // Instructor picker state (picker mode only).
    var _availableInstructors = [];
    var _selectedInstructorId = '';
    var _instructorError = '';

    var _pendingCollision = null;
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

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
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

    function getCharacterName(charId) {
        if (!isNonEmptyString(charId)) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return 'Unknown'; }
        return CharacterQueries.getDisplayName(char) || 'Unknown';
    }

    // ============================================================
    // INSTRUCTOR RESOLUTION (picker mode)
    // ============================================================

    /**
     * Build the list of instructors for a (class, discipline, week)
     * triple. Uses AcademyClasses.getClassInstructorIds — the
     * canonical week-scoped query — then resolves names through
     * CharacterQueries.
     *
     * Returns an array of { id, name }, deduplicated, sorted by
     * name. An empty array means "nobody teaches this discipline
     * this week" and is reported as such by the caller; it is not
     * coerced into a synthetic entry.
     */
    function readAvailableInstructors(classId, disciplineId, week) {
        if (!isNonEmptyString(classId)) { return []; }
        if (!isNonEmptyString(disciplineId)) { return []; }

        var weekNum = parseStrictInteger(week);
        if (weekNum === null) { return []; }

        var ids = [];
        try {
            ids = AcademyClasses.getClassInstructorIds(
                classId,
                weekNum,
                { disciplineId: String(disciplineId) }
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyScheduleInstructorModal] ' +
                'getClassInstructorIds threw:', e
            );
            return [];
        }

        if (!Array.isArray(ids)) { return []; }

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < ids.length; i++) {
            if (!isNonEmptyString(ids[i])) { continue; }
            var id = String(ids[i]);
            if (seen[id]) { continue; }
            seen[id] = true;

            var char = CharacterQueries.getCharacterById(id);
            if (!char) { continue; }

            var name = CharacterQueries.getDisplayName(char);
            if (!isNonEmptyString(name)) { name = 'Unknown'; }

            result.push({ id: id, name: name });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    /**
     * Apply the picker's auto-select rules to the current state.
     *
     *   zero instructors  → _instructorError set, _selectedInstructorId ''
     *   one instructor    → _selectedInstructorId set, error cleared
     *   many instructors  → _selectedInstructorId '' unless already
     *                       valid, error cleared
     *
     * Called on open and whenever the discipline changes (which in
     * picker mode is never, because the discipline is locked; in
     * direct mode the picker is not rendered at all). Kept
     * symmetric so a future caller can invoke it after any state
     * change that could affect the instructor list.
     */
    function refreshInstructorPickerState() {
        if (!_context || _context.mode !== 'picker') { return; }

        var instructorList = readAvailableInstructors(
            _context.classId,
            _selectedDisciplineId,
            _context.week
        );

        _availableInstructors = instructorList;

        if (instructorList.length === 0) {
            _instructorError =
                'No instructor teaches this discipline for this ' +
                'class during the requested week.';
            _selectedInstructorId = '';
            _availableGroups = [];
            _selectedGroupId = NEW_GROUP_SENTINEL;
            return;
        }

        _instructorError = '';

        if (instructorList.length === 1) {
            _selectedInstructorId = instructorList[0].id;
        } else {
            // Multi-instructor: only keep a selection that is still
            // valid. Otherwise force the user to pick.
            var stillValid = false;
            for (var i = 0; i < instructorList.length; i++) {
                if (instructorList[i].id === _selectedInstructorId) {
                    stillValid = true;
                    break;
                }
            }
            if (!stillValid) {
                _selectedInstructorId = '';
            }
        }

        refreshGroupState();
    }

    // ============================================================
    // GROUP RESOLUTION
    // ============================================================

    function readAvailableGroups(classId, disciplineId, instructorId, week) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId) ||
            !isNonEmptyString(instructorId)) {
            return [];
        }

        var weekNum = parseStrictInteger(week);
        if (weekNum === null) { return []; }

        var rawGroups = [];
        try {
            rawGroups = AcademyTeachingGroups
                .getGroupsForClassDisciplineInstructor(
                    classId, disciplineId, instructorId
                ) || [];
        } catch (e) {
            console.warn(
                '[AcademyScheduleInstructorModal] ' +
                'getGroupsForClassDisciplineInstructor failed:', e
            );
            return [];
        }

        if (!Array.isArray(rawGroups)) { return []; }

        var active = [];
        for (var i = 0; i < rawGroups.length; i++) {
            var g = rawGroups[i];
            if (!g || !g.id) { continue; }

            var startOk = true;
            var endOk = true;

            if (typeof g.startWeek === 'number' && weekNum < g.startWeek) {
                startOk = false;
            }
            if (g.endWeek !== null &&
                g.endWeek !== undefined &&
                typeof g.endWeek === 'number' &&
                weekNum > g.endWeek) {
                endOk = false;
            }

            if (startOk && endOk) { active.push(g); }
        }

        active.sort(function(a, b) {
            var an = typeof a.groupNumber === 'number' ? a.groupNumber : 0;
            var bn = typeof b.groupNumber === 'number' ? b.groupNumber : 0;
            if (an !== bn) { return an - bn; }
            return String(a.id).localeCompare(String(b.id));
        });

        var disciplineName = '';
        var disc = AcademyDisciplines.getDiscipline(disciplineId);
        if (disc && isNonEmptyString(disc.name)) {
            disciplineName = disc.name;
        }

        var result = [];
        for (var j = 0; j < active.length; j++) {
            var group = active[j];

            var customName = isNonEmptyString(group.customName)
                ? String(group.customName).trim()
                : null;
            var groupNumber = typeof group.groupNumber === 'number'
                ? group.groupNumber : 0;

            var displayName = customName !== null
                ? customName
                : (disciplineName + (groupNumber > 0
                    ? ' ' + groupNumber
                    : ''));

            var memberCount = 0;
            try {
                var members = AcademyTeachingGroups.getActiveMembers(
                    group.id, weekNum
                );
                if (Array.isArray(members)) {
                    memberCount = members.length;
                }
            } catch (e) { memberCount = 0; }

            var sessionCount = 0;
            var Sessions = window.AcademyTeachingSessions;
            if (Sessions &&
                typeof Sessions.getSessionsForGroup === 'function') {
                try {
                    var sessions = Sessions.getSessionsForGroup(group.id);
                    if (Array.isArray(sessions)) {
                        sessionCount = sessions.length;
                    }
                } catch (e) { sessionCount = 0; }
            }

            result.push({
                groupId: String(group.id),
                groupNumber: groupNumber,
                displayName: displayName,
                memberCount: memberCount,
                sessionCount: sessionCount
            });
        }

        return result;
    }

    function refreshGroupState() {
        _availableGroups = [];
        _selectedGroupId = NEW_GROUP_SENTINEL;

        if (!_context) { return; }
        if (!isNonEmptyString(_selectedDisciplineId)) { return; }
        if (!isNonEmptyString(_selectedInstructorId)) { return; }

        _availableGroups = readAvailableGroups(
            _context.classId,
            _selectedDisciplineId,
            _selectedInstructorId,
            _context.week
        );

        if (_availableGroups.length > 0) {
            _selectedGroupId = _availableGroups[0].groupId;
        } else {
            _selectedGroupId = NEW_GROUP_SENTINEL;
        }
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the instructor slot modal.
     *
     * @param {object} options
     * @param {string} [options.mode]         'direct' (default) |
     *                                        'picker'
     * @param {string} [options.instructorId] Required in 'direct'
     *                                        mode. Optional in
     *                                        'picker' mode; when
     *                                        present, the picker
     *                                        is skipped.
     * @param {string} options.classId        Required.
     * @param {string} [options.disciplineId] Required in 'picker'
     *                                        mode. Optional in
     *                                        'direct' mode; when
     *                                        present, the
     *                                        discipline dropdown
     *                                        pre-selects it.
     * @param {number} options.week           Required.
     * @param {number} options.day            Required.
     * @param {number} options.startHour      Required.
     * @param {function} [options.onClose]
     * @returns {object|null} The modal element, or null on failure.
     */
    function openModal(options) {
        if (!options || typeof options !== 'object') {
            notify('Invalid slot request.', 'error');
            return null;
        }

        var mode = isNonEmptyString(options.mode)
            ? String(options.mode)
            : 'direct';

        if (VALID_MODES.indexOf(mode) === -1) {
            notify('Unknown modal mode.', 'error');
            return null;
        }

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

        // Mode-specific requirements.
        var instructorId = isNonEmptyString(options.instructorId)
            ? String(options.instructorId)
            : null;
        var disciplineId = isNonEmptyString(options.disciplineId)
            ? String(options.disciplineId)
            : null;

        if (mode === 'direct' && instructorId === null) {
            notify('Instructor ID is required.', 'error');
            return null;
        }
        if (mode === 'picker' && disciplineId === null) {
            notify('Discipline ID is required.', 'error');
            return null;
        }

        closeModal();

        _context = {
            mode: mode,
            instructorId: instructorId,
            disciplineId: disciplineId,
            classId: String(options.classId),
            week: week,
            day: day,
            startHour: startHour
        };
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        _selectedDisciplineId = disciplineId !== null
            ? disciplineId
            : '';
        _selectedDuration = DEFAULT_DURATION;
        _selectedLocationId = '';
        _selectedGroupId = NEW_GROUP_SENTINEL;
        _availableGroups = [];
        _availableInstructors = [];
        _selectedInstructorId = instructorId !== null
            ? instructorId
            : '';
        _instructorError = '';
        _pendingCollision = null;
        _busy = false;

        // In picker mode, resolve instructors and (if the picker
        // has a single candidate or is already resolved) populate
        // groups immediately.
        if (mode === 'picker') {
            refreshInstructorPickerState();
        } else if (disciplineId !== null && instructorId !== null) {
            refreshGroupState();
        }

        var shell = Modal.createModal(
            'academy-schedule-instructor-modal'
        );
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'academy-schedule-instructor-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        _contentClickHandler = handleContentClick;
        _contentChangeHandler = handleContentChange;
        _contentSubmitHandler = handleContentSubmit;

        contentEl.addEventListener('click', _contentClickHandler);
        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('submit', _contentSubmitHandler);

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
        if (contentEl && _contentChangeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _contentChangeHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentSubmitHandler) {
            try {
                contentEl.removeEventListener(
                    'submit', _contentSubmitHandler
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
                    '[AcademyScheduleInstructorModal] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _context = null;
        _onClose = null;
        _contentClickHandler = null;
        _contentChangeHandler = null;
        _contentSubmitHandler = null;
        _selectedDisciplineId = '';
        _selectedDuration = DEFAULT_DURATION;
        _selectedLocationId = '';
        _selectedGroupId = NEW_GROUP_SENTINEL;
        _availableGroups = [];
        _availableInstructors = [];
        _selectedInstructorId = '';
        _instructorError = '';
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

        var disciplines = [];
        if (_context.mode === 'picker' &&
            isNonEmptyString(_context.disciplineId)) {
            // Picker mode: single fixed discipline.
            var disc = AcademyDisciplines.getDiscipline(
                _context.disciplineId
            );
            if (disc) {
                disciplines.push({
                    id: String(disc.id),
                    name: isNonEmptyString(disc.name)
                        ? disc.name
                        : 'Unnamed Discipline',
                    type: disc.type || 'mandatory'
                });
            }
        } else if (isNonEmptyString(_context.instructorId)) {
            // Direct mode: the instructor's disciplines for this
            // class this week.
            try {
                disciplines = AcademyAggregator
                    .getClassInstructorDisciplines(
                        _context.classId,
                        _context.instructorId,
                        _context.week
                    ) || [];
            } catch (e) {
                disciplines = [];
            }

            if (disciplines.length === 0) {
                disciplines = deriveInstructorDisciplines(
                    _context.classId,
                    _context.instructorId,
                    _context.week
                );
            }
        }

        return {
            mode: _context.mode,
            instructorId: _context.instructorId,
            classId: _context.classId,
            week: _context.week,
            day: _context.day,
            startHour: _context.startHour,
            slotDisplay: slotDisplay,
            disciplines: disciplines,
            selectedDisciplineId: _selectedDisciplineId,
            selectedDuration: _selectedDuration,
            durations: buildDurationOptions(),
            locations: getAvailableLocations(),
            selectedLocationId: _selectedLocationId,
            groups: _availableGroups,
            selectedGroupId: _selectedGroupId,
            newGroupSentinel: NEW_GROUP_SENTINEL,
            pendingCollision: _pendingCollision,
            busy: _busy,
            // Picker-mode fields.
            showInstructorPicker:
                _context.mode === 'picker' &&
                _availableInstructors.length > 1,
            instructors: _availableInstructors,
            selectedInstructorId: _selectedInstructorId,
            instructorError: _instructorError
        };
    }

    /**
     * Fallback derivation for the instructor's disciplines.
     *
     * Used only when the aggregator is absent or returns an empty
     * list. It reads the class's offerings and filters to those the
     * instructor is enrolled to teach in the given week. This
     * duplicates the aggregator's logic but guarantees the modal
     * works when the aggregator is missing.
     */
    function deriveInstructorDisciplines(classId, charId, week) {
        var result = [];

        var ACDQ = window.AcademyClassDisciplinesQueries;
        var AD = window.AcademyDisciplines;
        var AE = window.AcademyEnrolments;

        if (!ACDQ || typeof ACDQ.getClassDisciplinesForClass !== 'function') {
            return result;
        }
        if (!AD || typeof AD.getDiscipline !== 'function') {
            return result;
        }
        if (!AE || typeof AE.isEnrolledInWeek !== 'function') {
            return result;
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char || char.mode !== 'instructor') {
            return result;
        }

        var markers = [];
        try {
            markers = ACDQ.getClassDisciplinesForClass(classId) || [];
        } catch (e) {
            markers = [];
        }

        for (var i = 0; i < markers.length; i++) {
            var marker = markers[i];
            if (!marker || !marker.disciplineId) { continue; }

            var enrolled = false;
            try {
                enrolled = AE.isEnrolledInWeek(
                    charId, classId, marker.disciplineId, week
                ) === true;
            } catch (e) {
                enrolled = false;
            }

            if (!enrolled) { continue; }

            var disc = AD.getDiscipline(marker.disciplineId);
            if (!disc) { continue; }

            result.push({
                id: String(disc.id),
                name: isNonEmptyString(disc.name)
                    ? disc.name
                    : 'Unnamed Discipline',
                type: disc.type || 'mandatory'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
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
        var html = '';
        html += '<form id="academy-schedule-instructor-form" ' +
                    'data-mode="' + escapeAttribute(vm.mode) + '" ' +
                    'data-class-id="' +
                        escapeAttribute(vm.classId) + '"' +
                    (vm.instructorId
                        ? ' data-instructor-id="' +
                            escapeAttribute(vm.instructorId) + '"'
                        : '') + '>';

        html += '<div class="modal-header">';
        html += '<h3>' + escapeHtml(
            vm.mode === 'picker'
                ? 'Add session to discipline'
                : 'Add to instructor schedule'
        ) + '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-instructor-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="academy-schedule-instructor-summary">' +
                    'Slot: <strong>' +
                    escapeHtml(vm.slotDisplay) +
                    '</strong>' +
                '</p>';

        // ---- Picker-mode empty state ----
        //
        // When the picker is empty (no instructors) we render an
        // inline error and a disabled submit. We do NOT render the
        // discipline dropdown in an editable state; there is
        // nothing to select.
        if (vm.mode === 'picker' &&
            isNonEmptyString(vm.instructorError) &&
            vm.instructors.length === 0) {
            html += renderNoInstructorsState(vm);
            html += '</div>';
            html += renderFooter(vm, true);
            html += '</form>';
            return html;
        }

        // ---- Direct-mode empty state ----
        if (vm.mode === 'direct' &&
            vm.disciplines.length === 0) {
            html += '<p class="empty-state small">' +
                        'Not assigned to teach any disciplines for ' +
                        'this class. Use the Disciplines tab to add ' +
                        'one.' +
                    '</p>';
            html += '</div>';
            html += renderFooter(vm, true);
            html += '</form>';
            return html;
        }

        // ---- Picker-mode instructor picker ----
        if (vm.mode === 'picker' &&
            vm.showInstructorPicker &&
            vm.instructors.length > 1) {
            html += renderInstructorPicker(vm);
        } else if (vm.mode === 'picker' &&
                   vm.instructors.length === 1) {
            html += renderInstructorAutoSelected(vm);
        }

        // ---- Discipline dropdown ----
        //
        // Picker mode: rendered but disabled, fixed to the passed
        // discipline. The user sees which discipline they are
        // scheduling for. Changing it would contradict the grid
        // they clicked on.
        //
        // Direct mode: editable, single-select across the
        // instructor's disciplines for this class.
        html += renderDisciplineField(vm);

        // ---- Group picker (only when discipline + instructor
        //      are both resolved) ----
        if (isNonEmptyString(vm.selectedDisciplineId) &&
            isNonEmptyString(vm.selectedInstructorId) &&
            !isNonEmptyString(vm.instructorError)) {
            html += renderGroupPicker(vm);
        }

        // ---- Duration ----
        html += renderDurationField(vm);

        // ---- Location ----
        html += renderLocationSelect(vm);

        if (vm.pendingCollision) {
            html += renderCollisionPrompt(vm.pendingCollision);
        }

        html += '</div>';

        html += renderFooter(vm, false);

        html += '</form>';
        return html;
    }

    function renderNoInstructorsState(vm) {
        var html = '';
        html += '<p class="empty-state small">' +
                    escapeHtml(vm.instructorError) +
                '</p>';
        html += '<p class="field-hint">' +
                    'Assign an instructor from the character\'s ' +
                    'Disciplines tab before scheduling sessions for ' +
                    'this discipline.' +
                '</p>';
        return html;
    }

    function renderInstructorPicker(vm) {
        var html = '';
        html += '<div class="form-group academy-schedule-instructor-picker">';
        html += '<label class="academy-schedule-instructor-picker-label">' +
                    'Instructor *' +
                '</label>';
        html += '<p class="field-hint academy-schedule-instructor-picker-hint">' +
                    'More than one instructor teaches this discipline ' +
                    'for this class. Choose which one owns the session.' +
                '</p>';

        html += '<div class="academy-schedule-instructor-picker-list">';

        for (var i = 0; i < vm.instructors.length; i++) {
            var instr = vm.instructors[i];
            if (!instr || !instr.id) { continue; }

            var checked = String(instr.id) ===
                String(vm.selectedInstructorId)
                ? ' checked'
                : '';

            html += '<label class="academy-schedule-instructor-picker-option">';
            html += '<input type="radio" ' +
                        'name="academy-schedule-instructor-picker" ' +
                        'class="academy-schedule-instructor-picker-radio" ' +
                        'data-instructor-id="' +
                            escapeAttribute(instr.id) + '"' +
                        checked +
                        (vm.busy ? ' disabled' : '') + '>';
            html += '<span class="academy-schedule-instructor-picker-name">' +
                        escapeHtml(instr.name) +
                    '</span>';
            html += '</label>';
        }

        html += '</div>';
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
        html += '<div class="form-group academy-schedule-instructor-single">';
        html += '<label class="academy-schedule-instructor-single-label">' +
                    'Instructor' +
                '</label>';
        html += '<p class="academy-schedule-instructor-single-value">' +
                    escapeHtml(instructor.name) +
                    ' <span class="academy-schedule-instructor-single-note">' +
                        '(only instructor for this discipline)' +
                    '</span>' +
                '</p>';
        html += '</div>';
        return html;
    }

    function renderDisciplineField(vm) {
        var isPickerMode = vm.mode === 'picker';
        var isDisabled = isPickerMode || vm.busy;

        var html = '';
        html += '<div class="form-group">';
        html += '<label for="academy-schedule-instructor-discipline">' +
                    'Discipline *' +
                '</label>';
        html += '<select id="academy-schedule-instructor-discipline" ' +
                    'class="academy-schedule-instructor-discipline"' +
                    (isDisabled ? ' disabled' : '') + '>';

        if (vm.disciplines.length === 0) {
            html += '<option value="">' +
                        'No disciplines available' +
                    '</option>';
        } else {
            if (!isPickerMode) {
                html += '<option value="">Select a discipline...</option>';
            }
            for (var i = 0; i < vm.disciplines.length; i++) {
                var d = vm.disciplines[i];
                var selected = String(d.id) ===
                    String(vm.selectedDisciplineId)
                    ? ' selected'
                    : '';
                html += '<option value="' + escapeAttribute(d.id) + '"' +
                            selected + '>' +
                            escapeHtml(d.name) +
                        '</option>';
            }
        }

        html += '</select>';

        if (isPickerMode) {
            html += '<p class="field-hint">' +
                        'Fixed to the discipline of the grid you ' +
                        'clicked. To schedule a different discipline, ' +
                        'use that discipline\'s grid.' +
                    '</p>';
        }

        html += '</div>';
        return html;
    }

    function renderGroupPicker(vm) {
        var groups = Array.isArray(vm.groups) ? vm.groups : [];
        var showCounts = groups.length > 1;

        var html = '';
        html += '<div class="form-group academy-schedule-instructor-group">';
        html += '<label for="academy-schedule-instructor-group">' +
                    'Group' +
                '</label>';

        html += '<select id="academy-schedule-instructor-group" ' +
                    'class="academy-schedule-instructor-group-select"' +
                    (vm.busy ? ' disabled' : '') + '>';

        if (groups.length === 0) {
            html += '<option value="' +
                        escapeAttribute(vm.newGroupSentinel) + '" ' +
                        'selected>' +
                        'Create a new group' +
                    '</option>';
        } else {
            for (var i = 0; i < groups.length; i++) {
                var g = groups[i];
                if (!g || !g.groupId) { continue; }

                var selected = String(g.groupId) ===
                    String(vm.selectedGroupId)
                    ? ' selected'
                    : '';

                var label = g.displayName;

                if (showCounts) {
                    var parts = [];
                    if (typeof g.memberCount === 'number') {
                        parts.push(g.memberCount + ' member' +
                            (g.memberCount === 1 ? '' : 's'));
                    }
                    if (typeof g.sessionCount === 'number') {
                        parts.push(g.sessionCount + ' session' +
                            (g.sessionCount === 1 ? '' : 's'));
                    }
                    if (parts.length > 0) {
                        label += ' (' + parts.join(', ') + ')';
                    }
                }

                html += '<option value="' +
                            escapeAttribute(g.groupId) + '"' + selected +
                            '>' +
                            escapeHtml(label) +
                        '</option>';
            }

            var newSelected = String(vm.selectedGroupId) ===
                String(vm.newGroupSentinel)
                ? ' selected'
                : '';
            html += '<option value="' +
                        escapeAttribute(vm.newGroupSentinel) + '"' +
                        newSelected + '>' +
                        'Create a new group' +
                    '</option>';
        }

        html += '</select>';
        html += '<p class="field-hint">' +
                    'The session will be added to the selected group. ' +
                    'Choosing "Create a new group" starts a fresh, ' +
                    'empty group for this discipline.' +
                '</p>';
        html += '</div>';

        return html;
    }

    function renderDurationField(vm) {
        var html = '';
        html += '<div class="form-group">';
        html += '<label for="academy-schedule-instructor-duration">' +
                    'Duration (hours)' +
                '</label>';
        html += '<select id="academy-schedule-instructor-duration" ' +
                    'class="academy-schedule-instructor-duration"' +
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
        return html;
    }

    function renderLocationSelect(vm) {
        var locations = Array.isArray(vm.locations) ? vm.locations : [];

        var html = '';
        html += '<div class="form-group">';
        html += '<label for="academy-schedule-instructor-location">' +
                    'Location' +
                '</label>';
        html += '<select id="academy-schedule-instructor-location" ' +
                    'class="academy-schedule-instructor-location"' +
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
                    'Used only when a new session is created. Reusing ' +
                    'an existing session keeps that session\'s location.' +
                '</p>';
        html += '</div>';
        return html;
    }

    /**
     * Footer.
     *
     * Submit is disabled when:
     *   - noDisciplines (nothing to submit)
     *   - busy (mutation in flight)
     *   - pending collision AND already in retry mode (retry is
     *     always enabled to allow "Add anyway")
     *   - no discipline selected (direct mode, no selection yet)
     *   - picker mode with an empty instructor list
     *   - picker mode with multi-instructor but none selected
     */
    function renderFooter(vm, noDisciplines) {
        var busy = vm.busy === true;
        var hasCollision = !!vm.pendingCollision;
        var hasDiscipline = isNonEmptyString(vm.selectedDisciplineId);
        var hasInstructor = isNonEmptyString(vm.selectedInstructorId);

        var submitDisabled = noDisciplines || busy;
        if (!hasCollision) {
            if (!hasDiscipline) { submitDisabled = true; }
            if (vm.mode === 'picker' && !hasInstructor) {
                submitDisabled = true;
            }
        }

        var submitLabel = hasCollision ? 'Add anyway' : 'Add';
        var submitAction = hasCollision
            ? 'schedule-instructor-confirm'
            : 'schedule-instructor-submit';

        var html = '';
        html += '<div class="modal-footer academy-schedule-instructor-footer">';

        html += '<button type="button" class="secondary" ' +
                    'data-instructor-action="close"' +
                    (busy ? ' disabled' : '') + '>' +
                    'Cancel' +
                '</button>';

        if (!noDisciplines) {
            html += '<button type="button" class="primary" ' +
                        'data-instructor-action="' + submitAction + '"' +
                        (submitDisabled ? ' disabled' : '') + '>' +
                        escapeHtml(submitLabel) +
                    '</button>';
        }

        html += '</div>';
        return html;
    }

    function renderCollisionPrompt(collision) {
        var message = '';

        if (collision.type === 'instructor') {
            message = (collision.instructorName || 'The instructor') +
                ' is already teaching at an overlapping time.';
        } else {
            message = 'A schedule conflict was detected.';
        }

        var html = '';
        html += '<div class="academy-schedule-instructor-collision">';
        html += '<p class="academy-schedule-instructor-collision-text">' +
                    escapeHtml(message) +
                '</p>';
        html += '<p class="academy-schedule-instructor-collision-question">' +
                    'Add anyway?' +
                '</p>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleContentClick(e) {
        if (_busy) {
            e.preventDefault();
            return;
        }

        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var btn = target.closest('[data-instructor-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.instructorAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'schedule-instructor-submit') {
            e.preventDefault();
            submit(false);
            return;
        }

        if (action === 'schedule-instructor-confirm') {
            e.preventDefault();
            submit(true);
            return;
        }
    }

    function handleContentChange(e) {
        if (_busy) { return; }

        var target = e.target;
        if (!target || !target.classList) { return; }

        if (target.classList.contains(
            'academy-schedule-instructor-discipline'
        )) {
            // Only reachable in direct mode; picker mode disables
            // the field. A discipline change invalidates the
            // resolved instructor and the group list.
            if (_context && _context.mode === 'direct') {
                _selectedDisciplineId = target.value || '';
                _pendingCollision = null;
                refreshGroupState();
                renderContent();
            }
            return;
        }

        if (target.classList.contains(
            'academy-schedule-instructor-duration'
        )) {
            var dur = parseStrictInteger(target.value);
            if (dur !== null) {
                _selectedDuration = dur;
            }
            return;
        }

        if (target.classList.contains(
            'academy-schedule-instructor-location'
        )) {
            _selectedLocationId = target.value || '';
            return;
        }

        if (target.classList.contains(
            'academy-schedule-instructor-group-select'
        )) {
            _selectedGroupId = target.value || NEW_GROUP_SENTINEL;
            _pendingCollision = null;
            return;
        }

        if (target.classList.contains(
            'academy-schedule-instructor-picker-radio'
        )) {
            var instrId = target.dataset
                ? target.dataset.instructorId
                : '';
            _selectedInstructorId = isNonEmptyString(instrId)
                ? String(instrId)
                : '';
            _pendingCollision = null;
            refreshGroupState();
            renderContent();
            return;
        }
    }

    function handleContentSubmit(e) {
        if (e.target && e.target.id ===
            'academy-schedule-instructor-form') {
            e.preventDefault();
            submit(false);
        }
    }

    // ============================================================
    // SUBMIT
    // ============================================================

    function submit(allowCollisions) {
        if (!_context) { return; }
        if (_busy) { return; }

        if (!isNonEmptyString(_selectedDisciplineId)) {
            notify('Select a discipline.', 'error');
            return;
        }

        if (_context.mode === 'picker' &&
            !isNonEmptyString(_selectedInstructorId)) {
            notify('Choose an instructor.', 'error');
            return;
        }

        // In direct mode, the instructor is fixed; the picker is
        // not shown and _selectedInstructorId was seeded from
        // _context.instructorId on open.
        var instructorId = _context.mode === 'direct'
            ? _context.instructorId
            : _selectedInstructorId;

        if (!isNonEmptyString(instructorId)) {
            notify('Instructor is required.', 'error');
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
            instructorId: instructorId,
            classId: _context.classId,
            disciplineId: _selectedDisciplineId,
            week: _context.week,
            day: _context.day,
            startHour: _context.startHour,
            duration: duration,
            locationId: locationId,
            allowCollisions: allowCollisions === true
        };

        if (isNonEmptyString(_selectedGroupId)) {
            payload.groupId = String(_selectedGroupId);
        } else {
            payload.forceNewGroup = true;
        }

        AcademySchedule.scheduleInstructorSlot(payload)
            .then(function(result) {
                _busy = false;

                if (result && result.success) {
                    notify('Session scheduled.', 'success');
                    closeModal();
                    return;
                }

                if (result && result.reason === 'instructor_collision') {
                    var collision = (result.data && result.data.collision)
                        ? result.data.collision
                        : { type: 'instructor' };
                    _pendingCollision = collision;
                    renderContent();
                    return;
                }

                _pendingCollision = null;

                var msg = (result && result.message)
                    ? result.message
                    : 'Could not add this slot.';
                notify(msg, 'error');
                renderContent();
            })
            .catch(function(err) {
                _busy = false;
                _pendingCollision = null;
                console.warn(
                    '[AcademyScheduleInstructorModal] ' +
                    'scheduleInstructorSlot threw:', err
                );
                notify('Could not add this slot.', 'error');
                renderContent();
            });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyScheduleInstructorModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyScheduleInstructorModal;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (VALID_MODES.length !== 2 ||
            VALID_MODES.indexOf('direct') === -1 ||
            VALID_MODES.indexOf('picker') === -1) {
            missing.push('VALID_MODES is missing direct or picker');
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyScheduleInstructorModal] Verification - ' +
                'some exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
