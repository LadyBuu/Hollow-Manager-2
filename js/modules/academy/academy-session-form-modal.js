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
 *
 *   DERIVATION LOCATION:
 *     The modal reads discipline.startWeek / discipline.endWeek and
 *     passes them to AcademyTeachingSessions.createSession. This is
 *     a DERIVED value, not a modal-owned fact. The correct long-term
 *     home is inside createSession itself, which would read the
 *     discipline and compute the window internally.
 *
 *     That move is deferred: it changes createSession's input
 *     contract and cascades through the schedule coordinator's call
 *     sites. Until it lands, this modal is the derivation point and
 *     the header records that so the next reader does not assume
 *     the modal owns the window.
 *
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
 *   AcademyLocations is treated as MANDATORY here. When a query
 *   fails, the failure propagates; the modal does not convert it
 *   into "no locations available."
 *
 * CALENDAR END BOUNDARY:
 *   CALENDAR_END_HOUR is the last hour that may be OCCUPIED. A
 *   session that starts at CALENDAR_END_HOUR with duration 1
 *   occupies [CALENDAR_END_HOUR, CALENDAR_END_HOUR + 1), which is
 *   valid. The exclusive end of the calendar day is therefore
 *   CALENDAR_END_HOUR + 1, exposed here as CALENDAR_END_TIME.
 *
 *   The same derived constant appears in
 *   academy-teaching-sessions.js and
 *   academy-instructor-commitments.js. Do not change the
 *   arithmetic here without changing it there.
 *
 * ASYNC SAFETY:
 *   Every asynchronous callback captures the current
 *   `_sessionToken`. If a new modal has been opened (or the
 *   current one closed) before the callback runs, the callback is
 *   a no-op. This prevents stale operations from mutating a fresh
 *   modal's state.
 *
 *   A `_busy` flag additionally disables the submit control while
 *   a mutation is in flight, so a double-click cannot fire two
 *   writes.
 *
 * DOMAIN READS:
 *   The modal resolves the group, session, discipline, and
 *   location list ONCE per open, into `_context`. Domain records
 *   are NOT held across the modal's lifetime; the VM is rebuilt
 *   from `_context` on every render and the identity fields
 *   (`groupId`, `sessionId`, `mode`) are what persist.
 *
 *   This is the same pattern the discipline picker uses. Holding
 *   a domain record across a modal's life is a stale-state window;
 *   the record can change underneath the modal between render and
 *   submit.
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
 *   The modal never touches window.data. It never writes. All
 *   state changes go through AcademyTeachingSessions.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The teaching-sessions store  (AcademyTeachingSessions)
 *   - The group record             (AcademyTeachingGroups)
 *   - The discipline window        (AcademyDisciplines) — see
 *                                    DERIVATION LOCATION above
 *   - The location list            (AcademyLocations)
 *   - Group membership             (AcademyTeachingGroups)
 *   - Collision detection          (AcademyTeachingCollisions)
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

    // CALENDAR_END_HOUR is the last hour that may be occupied. A
    // session that starts at that hour with duration 1 occupies
    // [CALENDAR_END_HOUR, CALENDAR_END_HOUR + 1), which is valid.
    // The exclusive end of the calendar day is therefore
    // CALENDAR_END_HOUR + 1.
    //
    // The same derived constant appears in
    // academy-teaching-sessions.js and
    // academy-instructor-commitments.js. Do not change the
    // arithmetic here without changing it there.
    var CALENDAR_END_TIME = CalendarConstants.CALENDAR_END_HOUR + 1;

    // Named default for the add form. Form convenience, not a
    // domain default. The domain accepts any valid hour.
    var DEFAULT_START_HOUR = 9;
    var DEFAULT_DURATION = 1;

    var VALID_MODES = ['add', 'edit'];

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // _context holds IDENTITY only. Domain records (group, session,
    // discipline) are resolved fresh on every render from these IDs.
    //
    // _sessionToken is incremented on every open and close. Async
    // callbacks capture the token at submit time and become no-ops
    // if the token has advanced.

    var _modal = null;
    var _contentEl = null;
    var _context = null;
    var _onClose = null;
    var _contentClickHandler = null;
    var _contentSubmitHandler = null;

    var _sessionToken = 0;
    var _busy = false;

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
        return CalendarConstants.getDayName(day);
    }

    function formatHourLabel(hour) {
        if (!isFiniteNumber(hour)) { return '?:00'; }
        return CalendarConstants.formatHour(hour);
    }

    // ============================================================
    // DOMAIN RESOLUTION
    // ============================================================
    //
    // Every resolution distinguishes "not found" (returns null)
    // from "query failed" (the exception propagates). A failed
    // query is a broken dependency, not evidence that a record is
    // absent.

    function resolveGroup(groupId) {
        if (!isNonEmptyString(groupId)) { return null; }
        return AcademyTeachingGroups.getGroup(groupId);
    }

    function resolveSession(sessionId) {
        if (!isNonEmptyString(sessionId)) { return null; }
        return AcademyTeachingSessions.getSession(sessionId);
    }

    function resolveDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return null; }
        return AcademyDisciplines.getDiscipline(disciplineId);
    }

    function resolveLocations() {
        var all = AcademyLocations.getLocations() || [];
        all.sort(function(a, b) {
            return String(a.name || '').localeCompare(
                String(b.name || '')
            );
        });
        return all;
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

        var group;
        try {
            group = resolveGroup(options.groupId);
        } catch (e) {
            console.warn(
                '[AcademySessionFormModal] getGroup threw:', e
            );
            notify('Failed to load teaching group.', 'error');
            return null;
        }
        if (!group) {
            notify('Teaching group not found.', 'error');
            return null;
        }

        var sessionId = null;
        if (mode === 'edit') {
            if (!isNonEmptyString(options.sessionId)) {
                notify('Session ID is required for editing.', 'error');
                return null;
            }
            var session;
            try {
                session = resolveSession(options.sessionId);
            } catch (e) {
                console.warn(
                    '[AcademySessionFormModal] getSession threw:', e
                );
                notify('Failed to load session.', 'error');
                return null;
            }
            if (!session) {
                notify('Session not found.', 'error');
                return null;
            }
            if (String(session.groupId) !== String(group.id)) {
                notify('Session does not belong to this group.', 'error');
                return null;
            }
            sessionId = String(session.id);
        }

        closeModal();

        _context = {
            mode: mode,
            groupId: String(group.id),
            sessionId: sessionId
        };
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        // Bump the token. Any callback from a previous instance
        // becomes a no-op.
        _sessionToken++;
        var myToken = _sessionToken;

        _busy = false;

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

        _contentClickHandler = function(e) {
            handleContentClick(e, myToken);
        };
        _contentSubmitHandler = function(e) {
            handleContentSubmit(e, myToken);
        };

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
        _busy = false;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================
    //
    // The VM is built fresh on every render from _context's IDs.
    // Domain records are resolved here; the modal does not cache
    // them across renders.

    function buildViewModel() {
        if (!_context) { return null; }

        var group = resolveGroup(_context.groupId);
        if (!group) {
            return null;
        }

        var discipline = resolveDiscipline(group.disciplineId);
        if (!discipline) {
            return null;
        }

        var disciplineName = isNonEmptyString(discipline.name)
            ? discipline.name
            : 'Unnamed Discipline';

        var groupDisplayName = isNonEmptyString(group.customName)
            ? group.customName
            : disciplineName;

        var session = null;
        if (_context.mode === 'edit' && _context.sessionId) {
            session = resolveSession(_context.sessionId);
            if (!session) {
                return null;
            }
        }

        var vm = {
            mode: _context.mode,
            groupId: _context.groupId,
            groupDisplayName: groupDisplayName,
            disciplineName: disciplineName,
            isEdit: _context.mode === 'edit',
            busy: _busy
        };

        if (session) {
            vm.currentDay = session.day;
            vm.currentStartTime = session.startTime;
            vm.currentDuration = session.duration;
            vm.currentLocationId = session.locationId || '';
        } else {
            vm.currentDay = MIN_DAY;
            vm.currentStartTime = DEFAULT_START_HOUR;
            vm.currentDuration = DEFAULT_DURATION;
            vm.currentLocationId = '';
        }

        vm.locations = resolveLocations();

        return vm;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl) { return; }
        var vm = buildViewModel();
        if (!vm) {
            // The VM could not be built because a referenced record
            // vanished between open and render. Close cleanly rather
            // than rendering a broken form.
            notify(
                'The teaching group or session is no longer available.',
                'error'
            );
            closeModal();
            return;
        }
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
                            isEdit && _context.sessionId
                                ? _context.sessionId
                                : ''
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
                    'class="academy-session-day"' +
                    (vm.busy ? ' disabled' : '') + '>';
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
                    'class="academy-session-start-hour"' +
                    (vm.busy ? ' disabled' : '') + '>';
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
                        'class="academy-session-duration"' +
                        (vm.busy ? ' disabled' : '') + '>';
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
                    'class="academy-session-location"' +
                    (vm.busy ? ' disabled' : '') + '>';
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
                    'data-session-action="close"' +
                    (vm.busy ? ' disabled' : '') + '>Cancel</button>';
        html += '<button type="submit" class="primary"' +
                    (vm.busy ? ' disabled' : '') + '>' +
                    escapeHtml(isEdit ? 'Save Changes' : 'Add Session') +
                '</button>';
        html += '</div>';

        html += '</form>';
        return html;
    }

    // ============================================================
    // EVENT HANDLERS
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
    }

    function handleContentSubmit(e, myToken) {
        if (myToken !== _sessionToken) { return; }

        var form = e.target;
        if (!form || form.id !== 'academy-session-form') {
            return;
        }
        e.preventDefault();
        submitForm(form, myToken);
    }

    // ============================================================
    // SUBMIT
    // ============================================================

    function submitForm(form, myToken) {
        if (!_context) { return; }
        if (_busy) { return; }

        var dayInput = form.querySelector('.academy-session-day');
        var hourInput = form.querySelector(
            '.academy-session-start-hour'
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
            submitEdit(day, startTime, locationId, myToken);
        } else {
            submitAdd(form, day, startTime, locationId, myToken);
        }
    }

    function submitAdd(form, day, startTime, locationId, myToken) {
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

        if (startTime + duration > CALENDAR_END_TIME) {
            notify(
                'Session would extend beyond the end of the day.',
                'error'
            );
            return;
        }

        // Resolve the group and its discipline fresh. See the
        // DERIVATION LOCATION note in the header: the window is
        // derived here, from the discipline's own startWeek /
        // endWeek, and passed to createSession.
        var group = resolveGroup(_context.groupId);
        if (!group) {
            notify('Teaching group is no longer available.', 'error');
            closeModal();
            return;
        }

        var discipline = resolveDiscipline(group.disciplineId);
        if (!discipline) {
            notify('Discipline is no longer available.', 'error');
            closeModal();
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

        _busy = true;
        renderContent();

        AcademyTeachingSessions.createSession({
            groupId: _context.groupId,
            day: day,
            startTime: startTime,
            duration: duration,
            locationId: locationId,
            startWeek: startWeek,
            endWeek: endWeek
        }).then(function(result) {
            if (myToken !== _sessionToken) { return; }
            _busy = false;

            if (result && result.success) {
                notify('Session added.', 'success');
                closeModal();
                return;
            }

            var msg = (result && result.message)
                ? result.message
                : 'Failed to add session.';
            notify(msg, 'error');
            renderContent();
        }).catch(function(err) {
            if (myToken !== _sessionToken) { return; }
            _busy = false;
            console.warn(
                '[AcademySessionFormModal] createSession threw:', err
            );
            notify('Failed to add session.', 'error');
            renderContent();
        });
    }

    function submitEdit(day, startTime, locationId, myToken) {
        if (!_context.sessionId) {
            notify('Session ID is missing.', 'error');
            return;
        }

        _busy = true;
        renderContent();

        AcademyTeachingSessions.updateSession(
            _context.sessionId,
            {
                day: day,
                startTime: startTime,
                locationId: locationId
            }
        ).then(function(result) {
            if (myToken !== _sessionToken) { return; }
            _busy = false;

            if (result && result.success) {
                notify('Session updated.', 'success');
                closeModal();
                return;
            }

            var msg = (result && result.message)
                ? result.message
                : 'Failed to update session.';
            notify(msg, 'error');
            renderContent();
        }).catch(function(err) {
            if (myToken !== _sessionToken) { return; }
            _busy = false;
            console.warn(
                '[AcademySessionFormModal] updateSession threw:', err
            );
            notify('Failed to update session.', 'error');
            renderContent();
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

        try {
            if (CALENDAR_END_TIME !==
                CalendarConstants.CALENDAR_END_HOUR + 1) {
                missing.push(
                    'CALENDAR_END_TIME is not CALENDAR_END_HOUR + 1'
                );
            }
            if (DEFAULT_START_HOUR < MIN_HOUR ||
                DEFAULT_START_HOUR > MAX_HOUR) {
                missing.push(
                    'DEFAULT_START_HOUR is out of calendar bounds'
                );
            }
            if (DEFAULT_DURATION < MIN_DURATION ||
                DEFAULT_DURATION > MAX_DURATION) {
                missing.push(
                    'DEFAULT_DURATION is out of calendar bounds'
                );
            }
            if (DEFAULT_START_HOUR + DEFAULT_DURATION > CALENDAR_END_TIME) {
                missing.push(
                    'Default start + duration extends past ' +
                    'CALENDAR_END_TIME'
                );
            }
        } catch (e) {
            missing.push('verification threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademySessionFormModal] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
