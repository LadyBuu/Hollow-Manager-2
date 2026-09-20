/**
 * modules/academy/academy-session-form-modal.js
 * Academy Session Form Modal
 *
 * Path: js/modules/academy/academy-session-form-modal.js
 *
 * The add/edit form modal for a teaching group's sessions.
 *
 * MODES:
 *   'add'   four fields: day, start hour, duration, location
 *   'edit'  three fields: day, start hour, location
 *           (duration is NOT editable after creation)
 *
 * WINDOW:
 *   The session's startWeek / endWeek are ALWAYS the discipline's
 *   startWeek / endWeek. The modal does not surface week fields.
 *   The domain owns the window; the form never touches it.
 *
 *   On 'add', the modal reads the discipline for the group and
 *   passes its startWeek / endWeek through to createSession.
 *   On 'edit', the modal does not change the window.
 *
 * DURATION ASYMMETRY:
 *   Add sets duration; edit does not. Editing duration would
 *   create a different slot shape and break the grid's exact-match
 *   resolution in AcademySchedule.assignStudentToSlot. The
 *   asymmetry is deliberate.
 *
 * LOCATION:
 *   Optional per-session. Sourced from AcademyLocations. Two
 *   sessions of the same group can have different locations. The
 *   dropdown always carries an empty "(no location)" option.
 *
 * SUBMISSION:
 *   Add  -> AcademyTeachingSessions.createSession({
 *             groupId, day, startTime, duration, locationId,
 *             startWeek, endWeek
 *           })
 *   Edit -> AcademyTeachingSessions.updateSession(sessionId, {
 *             day, startTime, locationId
 *           })
 *
 *   On success: close the modal.
 *   On failure: notify with the domain's message and stay open.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The teaching-sessions store  (AcademyTeachingSessions)
 *   - The group record             (AcademyTeachingGroups)
 *   - The discipline window        (AcademyDisciplines)
 *   - The location list            (AcademyLocations)
 *   - Group membership             (AcademyTeachingGroups)
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyTeachingSessions
 *   - window.AcademyTeachingGroups
 *   - window.AcademyDisciplines
 *   - window.AcademyLocations
 *   - window.CalendarConstants
 *
 * USAGE:
 *   // Add a session
 *   AcademySessionFormModal.openModal({
 *       mode: 'add',
 *       groupId: 'tgroup_abc',
 *       onClose: function() { ... }
 *   });
 *
 *   // Edit a session
 *   AcademySessionFormModal.openModal({
 *       mode: 'edit',
 *       groupId: 'tgroup_abc',
 *       sessionId: 'tsession_xyz',
 *       onClose: function() { ... }
 *   });
 */

(function() {
    'use strict';

    if (window.__academySessionFormModalLoaded) {
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
        typeof AcademyTeachingSessions.createSession !== 'function' ||
        typeof AcademyTeachingSessions.updateSession !== 'function' ||
        typeof AcademyTeachingSessions.getSession !== 'function') {
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
        typeof AcademyLocations.getLocations !== 'function') {
        _missing.push('AcademyLocations.getLocations');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_DAY !== 'number' ||
        typeof CalendarConstants.MAX_DAY !== 'number' ||
        typeof CalendarConstants.MIN_HOUR !== 'number' ||
        typeof CalendarConstants.MAX_HOUR !== 'number' ||
        typeof CalendarConstants.MIN_CLASS_DURATION !== 'number' ||
        typeof CalendarConstants.MAX_CLASS_DURATION !== 'number' ||
        typeof CalendarConstants.CALENDAR_END_HOUR !== 'number' ||
        typeof CalendarConstants.getDayName !== 'function' ||
        typeof CalendarConstants.formatHour !== 'function') {
        _missing.push('CalendarConstants day/hour/duration helpers');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademySessionFormModal] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academySessionFormModalLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var MIN_DURATION = CalendarConstants.MIN_CLASS_DURATION;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;

    var VALID_MODES = ['add', 'edit'];

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _context = null;
    var _onClose = null;
    var _contentClickHandler = null;
    var _contentSubmitHandler = null;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
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

    function formatDayLabel(day) {
        if (!isFiniteNumber(day)) { return 'Day ?'; }
        try {
            return CalendarConstants.getDayName(day) || ('Day ' + day);
        } catch (e) {
            return 'Day ' + day;
        }
    }

    function formatHourLabel(hour) {
        if (!isFiniteNumber(hour)) { return '?:00'; }
        try {
            var s = CalendarConstants.formatHour(hour);
            return isNonEmptyString(s) ? s : (hour + ':00');
        } catch (e) {
            return hour + ':00';
        }
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the session form.
     *
     * @param {object} options
     * @param {string} [options.mode]      'add' (default) | 'edit'
     * @param {string} options.groupId     required
     * @param {string} [options.sessionId] required for 'edit'
     * @param {function} [options.onClose] called once when the
     *                                     modal closes
     * @returns {object|null} the modal element, or null on failure
     */
    function openModal(options) {
        if (!options || typeof options !== 'object') {
            notify('Invalid session form request.', 'error');
            return null;
        }

        var mode = isNonEmptyString(options.mode)
            ? String(options.mode)
            : 'add';

        if (VALID_MODES.indexOf(mode) === -1) {
            notify('Unknown session form mode.', 'error');
            return null;
        }

        if (!isNonEmptyString(options.groupId)) {
            notify('Group ID is required.', 'error');
            return null;
        }

        var group = null;
        try {
            group = AcademyTeachingGroups.getGroup(options.groupId);
        } catch (e) {
            group = null;
        }
        if (!group) {
            notify('Teaching group not found.', 'error');
            return null;
        }

        var session = null;
        if (mode === 'edit') {
            if (!isNonEmptyString(options.sessionId)) {
                notify('Session ID is required for editing.', 'error');
                return null;
            }
            try {
                session = AcademyTeachingSessions.getSession(
                    options.sessionId
                );
            } catch (e) {
                session = null;
            }
            if (!session) {
                notify('Session not found.', 'error');
                return null;
            }
            if (String(session.groupId) !== String(group.id)) {
                notify('Session does not belong to this group.', 'error');
                return null;
            }
        }

        closeModal();

        _context = {
            mode: mode,
            groupId: String(group.id),
            group: group,
            sessionId: session ? String(session.id) : null,
            session: session
        };
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        var shell = Modal.createModal('academy-session-form-modal');
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'academy-session-form-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        _contentClickHandler = handleContentClick;
        _contentSubmitHandler = handleContentSubmit;
        contentEl.addEventListener('click', _contentClickHandler);
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
                    '[AcademySessionFormModal] onClose threw:', e
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
        _contentSubmitHandler = null;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================

    function buildViewModel() {
        if (!_context) { return null; }

        var group = _context.group;
        var session = _context.session;

        var disciplineName = 'Unknown Discipline';
        var disciplineStartWeek = null;
        var disciplineEndWeek = null;

        if (isNonEmptyString(group.disciplineId)) {
            var disc = null;
            try {
                disc = AcademyDisciplines.getDiscipline(
                    group.disciplineId
                );
            } catch (e) {
                disc = null;
            }
            if (disc) {
                if (isNonEmptyString(disc.name)) {
                    disciplineName = disc.name;
                }
                if (isFiniteNumber(disc.startWeek)) {
                    disciplineStartWeek = disc.startWeek;
                }
                if (disc.endWeek !== undefined &&
                    disc.endWeek !== null) {
                    disciplineEndWeek = disc.endWeek;
                }
            }
        }

        var groupDisplayName = isNonEmptyString(group.customName)
            ? group.customName
            : disciplineName;

        var vm = {
            mode: _context.mode,
            groupId: _context.groupId,
            groupDisplayName: groupDisplayName,
            disciplineName: disciplineName,
            disciplineStartWeek: disciplineStartWeek,
            disciplineEndWeek: disciplineEndWeek,
            isEdit: _context.mode === 'edit'
        };

        if (_context.mode === 'edit' && session) {
            vm.currentDay = session.day;
            vm.currentStartTime = session.startTime;
            vm.currentDuration = session.duration;
            vm.currentLocationId = session.locationId || '';
        } else {
            // Sensible defaults for the add form: Monday, 9am, 1h.
            vm.currentDay = MIN_DAY;
            vm.currentStartTime = 9;
            vm.currentDuration = 1;
            vm.currentLocationId = '';
        }

        var allLocations = [];
        try {
            allLocations = AcademyLocations.getLocations() || [];
        } catch (e) {
            allLocations = [];
        }
        allLocations.sort(function(a, b) {
            return String(a.name || '').localeCompare(
                String(b.name || '')
            );
        });
        vm.locations = allLocations;

        return vm;
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
        var isEdit = vm.isEdit;
        var title = isEdit ? 'Edit Session' : 'Add Session';

        var html = '';
        html += '<form id="academy-session-form" ' +
                    'data-group-id="' +
                        escapeAttribute(vm.groupId) + '" ' +
                    'data-session-id="' +
                        escapeAttribute(
                            isEdit ? _context.sessionId : ''
                        ) + '">';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>' + escapeHtml(title) + '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-session-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body">';

        html += '<p class="academy-session-form-summary">' +
                    'Group: <strong>' +
                    escapeHtml(vm.groupDisplayName) +
                    '</strong>' +
                '</p>';

        // ---- Day ----
        html += '<div class="form-group">';
        html += '<label for="academy-session-day">Day</label>';
        html += '<select id="academy-session-day" ' +
                    'class="academy-session-day">';
        for (var d = MIN_DAY; d <= MAX_DAY; d++) {
            html += '<option value="' + d + '"' +
                        (d === vm.currentDay ? ' selected' : '') +
                        '>' +
                        escapeHtml(formatDayLabel(d)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Start hour ----
        html += '<div class="form-group">';
        html += '<label for="academy-session-start-hour">' +
                    'Start Hour' +
                '</label>';
        html += '<select id="academy-session-start-hour" ' +
                    'class="academy-session-start-hour">';
        for (var h = MIN_HOUR; h <= MAX_HOUR; h++) {
            html += '<option value="' + h + '"' +
                        (h === vm.currentStartTime ? ' selected' : '') +
                        '>' +
                        escapeHtml(formatHourLabel(h)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Duration (ADD only) ----
        if (!isEdit) {
            html += '<div class="form-group">';
            html += '<label for="academy-session-duration">' +
                        'Duration (hours)' +
                    '</label>';
            html += '<select id="academy-session-duration" ' +
                        'class="academy-session-duration">';
            for (var dur = MIN_DURATION; dur <= MAX_DURATION; dur++) {
                html += '<option value="' + dur + '"' +
                            (dur === vm.currentDuration
                                ? ' selected' : '') + '>' +
                            dur + ' hour' + (dur === 1 ? '' : 's') +
                        '</option>';
            }
            html += '</select>';
            html += '<p class="field-hint">' +
                        'Duration is set once when the session is ' +
                        'created. It cannot be changed afterward; ' +
                        'remove and re-add the session to change it.' +
                    '</p>';
            html += '</div>';
        } else {
            html += '<div class="form-group academy-session-duration-readonly">';
            html += '<label>Duration</label>';
            html += '<p class="academy-session-duration-value">' +
                        escapeHtml(String(vm.currentDuration)) +
                        ' hour' +
                        (vm.currentDuration === 1 ? '' : 's') +
                        ' ' +
                        '<span class="academy-session-duration-locked">' +
                            '(not editable)' +
                        '</span>' +
                    '</p>';
            html += '</div>';
        }

        // ---- Location ----
        html += '<div class="form-group">';
        html += '<label for="academy-session-location">' +
                    'Location' +
                '</label>';
        html += '<select id="academy-session-location" ' +
                    'class="academy-session-location">';
        html += '<option value="">(no location)</option>';
        for (var i = 0; i < vm.locations.length; i++) {
            var loc = vm.locations[i];
            if (!loc || !loc.id) { continue; }
            var locSelected = String(loc.id) ===
                String(vm.currentLocationId) ? ' selected' : '';
            html += '<option value="' +
                        escapeAttribute(loc.id) + '"' + locSelected + '>' +
                        escapeHtml(loc.name || 'Unnamed Location') +
                    '</option>';
        }
        html += '</select>';
        html += '<p class="field-hint">' +
                    'Optional. Two sessions of the same group can ' +
                    'have different locations.' +
                '</p>';
        html += '</div>';

        html += '</div>';

        // ---- Footer ----
        html += '<div class="modal-footer academy-session-form-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-session-action="close">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    escapeHtml(isEdit ? 'Save Changes' : 'Add Session') +
                '</button>';
        html += '</div>';

        html += '</form>';
        return html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleContentClick(e) {
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
    }

    function handleContentSubmit(e) {
        var form = e.target;
        if (!form || form.id !== 'academy-session-form') {
            return;
        }
        e.preventDefault();
        submitForm(form);
    }

    // ============================================================
    // SUBMIT
    // ============================================================

    function submitForm(form) {
        if (!_context) { return; }

        var dayInput = form.querySelector('.academy-session-day');
        var hourInput = form.querySelector(
            '.academy-session-start-hour'
        );
        var durationInput = form.querySelector(
            '.academy-session-duration'
        );
        var locationInput = form.querySelector(
            '.academy-session-location'
        );

        var day = parseStrictInteger(dayInput ? dayInput.value : null);
        if (day === null || day < MIN_DAY || day > MAX_DAY) {
            notify('Valid day is required.', 'error');
            return;
        }

        var startTime = parseStrictInteger(
            hourInput ? hourInput.value : null
        );
        if (startTime === null ||
            startTime < MIN_HOUR ||
            startTime > MAX_HOUR) {
            notify('Valid start hour is required.', 'error');
            return;
        }

        var locationId = locationInput && isNonEmptyString(
            locationInput.value
        )
            ? String(locationInput.value)
            : null;

        if (_context.mode === 'edit') {
            submitEdit(form, day, startTime, locationId);
        } else {
            submitAdd(
                form, day, startTime, locationInput, locationId
            );
        }
    }

    function submitAdd(form, day, startTime, locationInput, locationId) {
        var durationInput = form.querySelector(
            '.academy-session-duration'
        );
        var duration = parseStrictInteger(
            durationInput ? durationInput.value : null
        );
        if (duration === null ||
            duration < MIN_DURATION ||
            duration > MAX_DURATION) {
            notify(
                'Duration must be between ' + MIN_DURATION +
                ' and ' + MAX_DURATION + ' hours.',
                'error'
            );
            return;
        }

        if (startTime + duration > CALENDAR_END_HOUR + 1) {
            notify(
                'Session would extend beyond the end of the day.',
                'error'
            );
            return;
        }

        // Resolve the discipline's window. The session's window
        // IS the discipline's window; the form never surfaces
        // week fields.
        var group = _context.group;
        var discipline = null;
        try {
            discipline = AcademyDisciplines.getDiscipline(
                group.disciplineId
            );
        } catch (e) {
            discipline = null;
        }
        if (!discipline) {
            notify('Discipline not found.', 'error');
            return;
        }

        var startWeek = parseStrictInteger(discipline.startWeek);
        if (startWeek === null) {
            notify(
                'The discipline has no valid start week. ' +
                'Set it before adding sessions.',
                'error'
            );
            return;
        }

        var endWeek = null;
        if (discipline.endWeek !== undefined &&
            discipline.endWeek !== null &&
            discipline.endWeek !== '') {
            endWeek = parseStrictInteger(discipline.endWeek);
            if (endWeek === null) {
                notify('The discipline has an invalid end week.', 'error');
                return;
            }
        }

        AcademyTeachingSessions.createSession({
            groupId: _context.groupId,
            day: day,
            startTime: startTime,
            duration: duration,
            locationId: locationId,
            startWeek: startWeek,
            endWeek: endWeek
        }).then(function(result) {
            if (result && result.success) {
                notify('Session added.', 'success');
                closeModal();
            } else if (result && result.message) {
                notify(result.message, 'error');
            } else {
                notify('Failed to add session.', 'error');
            }
        }).catch(function(err) {
            console.warn(
                '[AcademySessionFormModal] createSession threw:', err
            );
            notify('Failed to add session.', 'error');
        });
    }

    function submitEdit(form, day, startTime, locationId) {
        if (!_context.sessionId) {
            notify('Session ID is missing.', 'error');
            return;
        }

        AcademyTeachingSessions.updateSession(
            _context.sessionId,
            {
                day: day,
                startTime: startTime,
                locationId: locationId
            }
        ).then(function(result) {
            if (result && result.success) {
                notify('Session updated.', 'success');
                closeModal();
            } else if (result && result.message) {
                notify(result.message, 'error');
            } else {
                notify('Failed to update session.', 'error');
            }
        }).catch(function(err) {
            console.warn(
                '[AcademySessionFormModal] updateSession threw:', err
            );
            notify('Failed to update session.', 'error');
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySessionFormModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademySessionFormModal;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademySessionFormModal] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();