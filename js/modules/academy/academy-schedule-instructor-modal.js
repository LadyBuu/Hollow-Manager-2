/**
 * modules/academy/academy-schedule-instructor-modal.js
 * Academy Schedule Instructor Modal
 *
 * Path: js/modules/academy/academy-schedule-instructor-modal.js
 *
 * The modal that lets an instructor claim an empty slot in their
 * own schedule grid for one of their disciplines.
 *
 * MODE:
 *   'add' only. Editing an existing session is done from the
 *   Teaching Groups tab's Sessions list, not from the grid.
 *
 * FORM FIELDS:
 *   - Discipline  dropdown, sourced from the instructor's
 *                 disciplines for the currently selected class.
 *                 Required.
 *   - Duration    dropdown, MIN_CLASS_DURATION to
 *                 MAX_CLASS_DURATION. Required.
 *   - Location    dropdown, sourced from AcademyLocations.
 *                 Optional. An empty selection sends null.
 *
 * The slot's (day, startHour) come from the clicked grid cell.
 * The week comes from the display week. Neither is editable.
 *
 * SESSION LOCATION:
 *   The location is applied ONLY when the domain creates a new
 *   session. When the resolver finds an exact-match session
 *   (same day / start hour / duration on a candidate group), the
 *   location select is ignored — the session keeps its own
 *   location. That is the domain's rule and this modal honors it
 *   by not pretending to override it.
 *
 *   To change an existing session's location, use the session
 *   form (from the Teaching Groups tab's Sessions list).
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
 * SUBMISSION:
 *   AcademySchedule.scheduleInstructorSlot({
 *       instructorId, classId, disciplineId,
 *       week, day, startHour, duration, locationId,
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
 *   - window.AcademyAggregator
 *   - window.AcademySchedule
 *   - window.AcademyLocations
 *   - window.AcademyUI
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
    var AcademyAggregator = window.AcademyAggregator;
    var AcademySchedule = window.AcademySchedule;
    var AcademyLocations = window.AcademyLocations;
    var AcademyUI = window.AcademyUI;
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
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }
    if (!AcademySchedule ||
        typeof AcademySchedule.scheduleInstructorSlot !== 'function') {
        _missing.push('AcademySchedule.scheduleInstructorSlot');
    }
    if (!AcademyLocations ||
        typeof AcademyLocations.getLocations !== 'function') {
        _missing.push('AcademyLocations.getLocations');
    }
    if (!AcademyUI ||
        typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
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

    // ============================================================
    // ENTRY POINT
    // ============================================================

    function openModal(options) {
        if (!options || typeof options !== 'object') {
            notify('Invalid slot request.', 'error');
            return null;
        }

        if (!isNonEmptyString(options.instructorId)) {
            notify('Instructor ID is required.', 'error');
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

        closeModal();

        _context = {
            instructorId: String(options.instructorId),
            classId: String(options.classId),
            week: week,
            day: day,
            startHour: startHour
        };
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;
        _selectedDisciplineId = '';
        _selectedDuration = DEFAULT_DURATION;
        _selectedLocationId = '';
        _pendingCollision = null;
        _busy = false;

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

        return {
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
            pendingCollision: _pendingCollision,
            busy: _busy
        };
    }

    function deriveInstructorDisciplines(classId, charId, week) {
        var result = [];

        var ACDQ = window.AcademyClassDisciplinesQueries;
        var AD = window.AcademyDisciplines;
        var AE = window.AcademyEnrolments;
        var CQ = window.CharacterQueries;

        if (!ACDQ || typeof ACDQ.getClassDisciplinesForClass !== 'function') {
            return result;
        }
        if (!AD || typeof AD.getDiscipline !== 'function') {
            return result;
        }
        if (!AE || typeof AE.isEnrolledInWeek !== 'function') {
            return result;
        }

        var char = null;
        if (CQ && typeof CQ.getCharacterById === 'function') {
            char = CQ.getCharacterById(charId);
        }
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
                    'data-instructor-id="' +
                        escapeAttribute(vm.instructorId) + '" ' +
                    'data-class-id="' +
                        escapeAttribute(vm.classId) + '">';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>Add to instructor schedule</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-instructor-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body">';

        html += '<p class="academy-schedule-instructor-summary">' +
                    'Slot: <strong>' +
                    escapeHtml(vm.slotDisplay) +
                    '</strong>' +
                '</p>';

        if (vm.disciplines.length === 0) {
            html += '<p class="empty-state small">' +
                        'Not assigned to teach any disciplines for ' +
                        'this class. Use the Disciplines tab to add ' +
                        'one.' +
                    '</p>';
            html += '</div>';
            html += renderFooter(vm, true);
            return html;
        }

        // ---- Discipline ----
        html += '<div class="form-group">';
        html += '<label for="academy-schedule-instructor-discipline">' +
                    'Discipline *' +
                '</label>';
        html += '<select id="academy-schedule-instructor-discipline" ' +
                    'class="academy-schedule-instructor-discipline"' +
                    (vm.busy ? ' disabled' : '') + '>';
        html += '<option value="">Select a discipline...</option>';
        for (var i = 0; i < vm.disciplines.length; i++) {
            var d = vm.disciplines[i];
            var selected = String(d.id) === String(vm.selectedDisciplineId)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(d.id) + '"' +
                        selected + '>' +
                        escapeHtml(d.name) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Duration ----
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

        // ---- Location (optional) ----
        html += renderLocationSelect(vm);

        if (vm.pendingCollision) {
            html += renderCollisionPrompt(vm.pendingCollision);
        }

        html += '</div>';

        // ---- Footer ----
        html += renderFooter(vm, false);

        html += '</form>';
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

    function renderFooter(vm, noDisciplines) {
        var busy = vm.busy === true;
        var hasCollision = !!vm.pendingCollision;
        var hasDiscipline = isNonEmptyString(vm.selectedDisciplineId);

        var submitDisabled = noDisciplines || busy ||
            (!hasCollision && !hasDiscipline);

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
            _selectedDisciplineId = target.value || '';
            if (_pendingCollision) {
                _pendingCollision = null;
            }
            renderContent();
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

        var duration = parseStrictInteger(_selectedDuration);
        if (duration === null) {
            duration = DEFAULT_DURATION;
        }

        var locationId = isNonEmptyString(_selectedLocationId)
            ? String(_selectedLocationId)
            : null;

        _busy = true;
        renderContent();

        AcademySchedule.scheduleInstructorSlot({
            instructorId: _context.instructorId,
            classId: _context.classId,
            disciplineId: _selectedDisciplineId,
            week: _context.week,
            day: _context.day,
            startHour: _context.startHour,
            duration: duration,
            locationId: locationId,
            allowCollisions: allowCollisions === true
        }).then(function(result) {
            _busy = false;

            if (result && result.success) {
                notify('Slot added to instructor schedule.', 'success');
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
        }).catch(function(err) {
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

        if (missing.length > 0) {
            console.warn(
                '[AcademyScheduleInstructorModal] Verification - ' +
                'some exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
