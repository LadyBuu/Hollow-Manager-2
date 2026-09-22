/**
 * modules/academy/academy-crud-modals.js - Academy CRUD Modals
 * Modal HTML builders + lifecycle helpers for Academy CRUD operations.
 *
 * Path: js/modules/academy/academy-crud-modals.js
 *
 * RESPONSIBILITIES:
 *   - Build modal HTML for Class, Location, and Discipline CRUD
 *   - Build the Social Score editor modal
 *   - Build the Add Character to Class modal (stacked, collapsible,
 *     two-container bulk picker)
 *   - Open the modal via window.Modal
 *   - Wire form submission to the domain mutation
 *   - Close on success; leave open on failure so the user can retry
 *
 * NOT RESPONSIBILITIES:
 *   - Domain validation. Every mutation goes through its domain module,
 *     which routes through MutationPipeline. The pipeline validates.
 *   - Notifications. The pipeline notifies on success and failure.
 *     This module only notifies when it invokes a caller-supplied
 *     onChange callback.
 *   - Roster derivation. The roster is derived by the aggregator;
 *     this module receives the resulting candidate list.
 *
 * INPUT BOUNDS:
 *   Every enumerated input (statuses, location types, capacity bounds,
 *   social-score bounds, rest-day bounds) is read from its owning
 *   domain module. The builders do not hardcode any of these.
 *
 * STRICT PARSING:
 *   Integer inputs (class year, location capacity) are parsed via
 *   ValidationUtils.parseStrictPositiveInteger. Inputs like "2026foo",
 *   "3.9", and "-1" are rejected.
 *
 * REST DAYS (v30, extended v31):
 *   class.restDays is the DEFAULT set of rest days. class.restDaysByWeek
 *   is a sparse map of per-week overrides.
 *
 *   The form has two sections:
 *
 *     1. "Default Rest Days": seven checkboxes. Every week not
 *        overridden by a rule uses these.
 *
 *     2. "Per-Week Overrides": a list of rules. Each rule has a
 *        mode (all / odd / even / range / single), optional week
 *        bounds, and seven checkboxes. Rules are evaluated in
 *        the order listed; later rules overwrite earlier ones
 *        for the weeks they match. This is CSS-like precedence.
 *
 *   On save, the form expands rules into a sparse per-week map.
 *   A rule that matches every week of the class's run expands to
 *   52 entries; a rule that matches "odd weeks" expands to 26;
 *   a single-week rule expands to 1.
 *
 *   The domain validates the resulting map and stores it. On read,
 *   AcademyClasses.getRestDaysForWeek resolves the effective set
 *   for a given week from the map or the default.
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal(className) returns a bare .modal shell. This
 *   module's openModal helper appends a fresh .modal-content wrapper
 *   before setup, matching the contract used by every other Academy
 *   modal module.
 *
 * MODAL CLOSE SEMANTICS:
 *   Modal.hideModal is ASYNCHRONOUS. closeModal below awaits the
 *   returned Promise before removing the element from the DOM.
 *   Prefer Modal.closeModal when available.
 *
 * ADD CHARACTER TO CLASS — STACKED COLLAPSIBLE PICKER:
 *   The modal presents candidates in two stacked containers:
 *
 *     TOP     Unassigned.        Expanded by default.
 *     BOTTOM  In Other Classes.  Collapsed by default.
 *
 *   Each container is a self-contained box with:
 *     - A clickable header (caret + label + count badge).
 *     - An action row (Select all / Clear) shown only when expanded.
 *     - A scrollable body of one-character-per-line checkbox rows.
 *
 *   Collapse state is carried as data-expanded="true|false" on the
 *   container root. The header's aria-expanded mirrors it. The caret
 *   glyph is emitted once as U+25B8 (▸) and rotated 90° via CSS when
 *   the container is expanded; the renderer does not swap the glyph.
 *
 *   The search box filters rows in BOTH containers. A container
 *   whose rows are all filtered out shows a "No matches" hint inside
 *   its body (visible only when that container is expanded).
 *
 *   Select-all scopes to the button's own container and to that
 *   container's VISIBLE rows. Clear scopes to the button's own
 *   container's rows, visible or hidden.
 *
 *   The submit handler reads every checked character ID across both
 *   containers and runs a SEQUENTIAL chain of AcademyClasses.addToClass
 *   calls. Each call is its own MutationPipeline transaction, so this
 *   is not atomic as a whole; a mid-chain failure leaves the earlier
 *   successes committed. The failure mode for "add to class" is almost
 *   always "this character is already a member," which is not worth
 *   rolling the whole batch back over.
 *
 *   On completion:
 *     - All succeeded: toast success, close, refresh.
 *     - Some succeeded, some failed: toast warning with counts, log
 *       per-row failures, close, refresh, then REOPEN the modal so
 *       the user can immediately pick up the remaining candidates
 *       (the candidate list shrinks automatically).
 *     - None succeeded: toast error, log per-row failures, close,
 *       refresh. No reopen — the modal would just show the same
 *       candidates with the same failures waiting.
 *
 * CANDIDATE SOURCING:
 *   The candidate list excludes:
 *     - Characters already in the target class (students)
 *     - Characters who teach something in the target class at the
 *       display week (instructors)
 *   Sourced from AcademyAggregator.getClassStudentsViewModel and
 *   AcademyClasses.getClassInstructorIds respectively.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.ValidationUtils
 *   - window.AcademyClasses
 *   - window.AcademyDisciplines
 *   - window.AcademyLocations
 *   - window.CharacterQueries
 *   - window.AcademyAggregator
 *   - window.CalendarConstants
 *
 * DEPENDENCIES (OPTIONAL, lazily accessed):
 *   - window.AcademySocialScore
 *   - window.AcademyUI
 */

(function() {
    'use strict';

    if (window.__academyCRUDModalsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var ValidationUtils = window.ValidationUtils;
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyLocations = window.AcademyLocations;
    var CharacterQueries = window.CharacterQueries;
    var AcademyAggregator = window.AcademyAggregator;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
        _missing.push('DomUtils.escapeHtml');
    }
    if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeAttribute');
    }
    if (!Modal || typeof Modal.createModal !== 'function') {
        _missing.push('Modal.createModal');
    }
    if (!Modal || typeof Modal.showModal !== 'function') {
        _missing.push('Modal.showModal');
    }
    if (!Modal || typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal.modalSetup');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!ValidationUtils || typeof ValidationUtils.parseStrictPositiveInteger !== 'function') {
        _missing.push('ValidationUtils.parseStrictPositiveInteger');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyClasses || typeof AcademyClasses.addToClass !== 'function') {
        _missing.push('AcademyClasses.addToClass');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClassInstructorIds !== 'function') {
        _missing.push('AcademyClasses.getClassInstructorIds');
    }
    if (!AcademyClasses || !Array.isArray(AcademyClasses.VALID_STATUSES)) {
        _missing.push('AcademyClasses.VALID_STATUSES');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyLocations || typeof AcademyLocations.getLocation !== 'function') {
        _missing.push('AcademyLocations.getLocation');
    }
    if (!AcademyLocations || typeof AcademyLocations.getValidLocationTypes !== 'function') {
        _missing.push('AcademyLocations.getValidLocationTypes');
    }
    if (!AcademyLocations ||
        typeof AcademyLocations.MIN_CAPACITY !== 'number' ||
        typeof AcademyLocations.MAX_CAPACITY !== 'number') {
        _missing.push('AcademyLocations.MIN_CAPACITY / MAX_CAPACITY');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterAge !== 'function') {
        _missing.push('CharacterQueries.getCharacterAge');
    }
    if (!AcademyAggregator || typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_DAY !== 'number' ||
        typeof CalendarConstants.MAX_DAY !== 'number' ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants day/week bounds');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyCRUDModals] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyCRUDModalsLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademySocialScore() {
        return window.AcademySocialScore || null;
    }

    function getAcademyUI() {
        return window.AcademyUI || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    function compareAlpha(a, b) {
        var sa = isNonEmptyString(a) ? a : '';
        var sb = isNonEmptyString(b) ? b : '';
        return sa.localeCompare(sb);
    }

    function formatCharacterOptionLabel(name, age) {
        var safeName = isNonEmptyString(name) ? name : 'Unknown';
        var safeAge = isNonEmptyString(age) && age !== '-'
            ? age
            : '';
        if (safeAge === '') {
            return safeName;
        }
        return safeName + ' (' + safeAge + ')';
    }

    /**
     * Escape a value for use in a CSS attribute selector.
     * Minimal implementation; column keys are 'unassigned' and
     * 'assigned' in practice, but the helper is defensive.
     */
    function cssEscape(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value).replace(/(["\\])/g, '\\$1');
    }

    function getDisplayWeek() {
        var AcademyUI = getAcademyUI();
        if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
            return null;
        }
        try {
            var week = AcademyUI.getDisplayWeek();
            if (typeof week === 'number' && isFinite(week) &&
                Number.isInteger(week)) {
                return week;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function getClassInstructorIdsForDisplay(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var week = getDisplayWeek();
        if (week === null) {
            return [];
        }
        try {
            var ids = AcademyClasses.getClassInstructorIds(classId, week);
            return Array.isArray(ids) ? ids : [];
        } catch (e) {
            console.warn(
                '[AcademyCRUDModals] getClassInstructorIds failed:', e
            );
            return [];
        }
    }

    // ============================================================
    // DOMAIN LOOKUPS
    // ============================================================

    function getClassRecord(classId) {
        if (!isNonEmptyString(classId)) { return null; }
        return AcademyClasses.getClass(classId);
    }

    function getDisciplineRecord(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return null; }
        return AcademyDisciplines.getDiscipline(disciplineId);
    }

    function getLocationRecord(locationId) {
        if (!isNonEmptyString(locationId)) { return null; }
        return AcademyLocations.getLocation(locationId);
    }

    // ============================================================
    // REST DAYS (class form)
    // ============================================================

    var DAY_ORDER = [
        { num: 1, short: 'Mon' },
        { num: 2, short: 'Tue' },
        { num: 3, short: 'Wed' },
        { num: 4, short: 'Thu' },
        { num: 5, short: 'Fri' },
        { num: 6, short: 'Sat' },
        { num: 7, short: 'Sun' }
    ];

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    function normaliseRestDaysForForm(raw) {
        if (!Array.isArray(raw)) { return []; }
        var seen = Object.create(null);
        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var n = Number(raw[i]);
            if (!Number.isInteger(n)) { continue; }
            if (n < CalendarConstants.MIN_DAY ||
                n > CalendarConstants.MAX_DAY) {
                continue;
            }
            var key = String(n);
            if (seen[key]) { continue; }
            seen[key] = true;
            result.push(n);
        }
        return result;
    }

    function renderRestDayCheckboxes(prefix, selectedDays) {
        var selected = normaliseRestDaysForForm(selectedDays);
        var selectedSet = Object.create(null);
        for (var i = 0; i < selected.length; i++) {
            selectedSet[String(selected[i])] = true;
        }

        var html = '';
        html += '<div class="academy-rest-days-row">';
        for (var d = 0; d < DAY_ORDER.length; d++) {
            var entry = DAY_ORDER[d];
            var checked = selectedSet[String(entry.num)] ? ' checked' : '';
            html += '<label class="academy-rest-day-toggle">';
            html += '<input type="checkbox" ' +
                        'class="academy-rest-day-checkbox" ' +
                        'data-rest-day="' + entry.num + '" ' +
                        'data-rest-day-owner="' + escapeAttribute(prefix) + '"' +
                        checked + '>';
            html += '<span class="academy-rest-day-label">' +
                        escapeHtml(entry.short) +
                    '</span>';
            html += '</label>';
        }
        html += '</div>';
        return html;
    }

    function buildRestDaysFieldset(selectedDays) {
        var html = '';
        html += '<fieldset class="academy-rest-days-fieldset">';
        html += '<legend class="academy-rest-days-legend">' +
                    'Default Rest Days' +
                '</legend>';
        html += '<p class="field-hint academy-rest-days-hint">' +
                    'Days this class does not meet, unless a per-week ' +
                    'override below says otherwise.' +
                '</p>';
        html += renderRestDayCheckboxes('default', selectedDays);
        html += '</fieldset>';
        return html;
    }

    function buildRestDayRulesFieldset(existingRules) {
        var rules = Array.isArray(existingRules) ? existingRules : [];

        var html = '';
        html += '<fieldset class="academy-rest-day-rules-fieldset">';
        html += '<legend class="academy-rest-day-rules-legend">' +
                    'Per-Week Overrides' +
                '</legend>';
        html += '<p class="field-hint academy-rest-day-rules-hint">' +
                    'Optional. Rules apply top-to-bottom; later rules ' +
                    'override earlier ones for the weeks they match. ' +
                    'Leave all checkboxes unchecked to mark a week ' +
                    'with no rest days.' +
                '</p>';

        html += '<div class="academy-rest-day-rules-list" ' +
                    'id="academy-rest-day-rules-list">';

        if (rules.length === 0) {
            // No stored rules; the empty list is fine. The user
            // adds rules with the button below.
        } else {
            for (var i = 0; i < rules.length; i++) {
                html += renderRestDayRuleRow(rules[i]);
            }
        }

        html += '</div>';

        html += '<button type="button" ' +
                    'class="small add-rest-day-rule-btn" ' +
                    'id="add-rest-day-rule-btn">' +
                    '+ Add Rule' +
                '</button>';

        html += '</fieldset>';
        return html;
    }

    function renderRestDayRuleRow(rule) {
        rule = rule || {};
        var mode = isNonEmptyString(rule.mode) ? rule.mode : 'all';
        var start = rule.startWeek !== undefined && rule.startWeek !== null
            ? String(rule.startWeek)
            : '';
        var end = rule.endWeek !== undefined && rule.endWeek !== null
            ? String(rule.endWeek)
            : '';
        var days = Array.isArray(rule.days) ? rule.days : [];

        var html = '';
        html += '<div class="academy-rest-day-rule-row">';

        html += '<div class="academy-rest-day-rule-mode">';
        html += '<label class="academy-rest-day-rule-mode-label">Apply to:</label>';
        html += '<select class="academy-rest-day-rule-mode-select">';
        html += '<option value="all"' +
                    (mode === 'all' ? ' selected' : '') + '>All weeks</option>';
        html += '<option value="odd"' +
                    (mode === 'odd' ? ' selected' : '') + '>Odd weeks</option>';
        html += '<option value="even"' +
                    (mode === 'even' ? ' selected' : '') + '>Even weeks</option>';
        html += '<option value="range"' +
                    (mode === 'range' ? ' selected' : '') + '>Range</option>';
        html += '<option value="single"' +
                    (mode === 'single' ? ' selected' : '') + '>Single week</option>';
        html += '</select>';
        html += '</div>';

        html += '<div class="academy-rest-day-rule-bounds">';
        html += '<label class="academy-rest-day-rule-bounds-label">' +
                    'Start:' +
                '</label>';
        html += '<input type="number" ' +
                    'class="academy-rest-day-rule-start" ' +
                    'min="' + MIN_WEEK + '" max="' + MAX_WEEK + '" ' +
                    'value="' + escapeAttribute(start) + '">';
        html += '<label class="academy-rest-day-rule-bounds-label">' +
                    'End:' +
                '</label>';
        html += '<input type="number" ' +
                    'class="academy-rest-day-rule-end" ' +
                    'min="' + MIN_WEEK + '" max="' + MAX_WEEK + '" ' +
                    'value="' + escapeAttribute(end) + '">';
        html += '</div>';

        html += renderRestDayCheckboxes('rule', days);

        html += '<button type="button" ' +
                    'class="small danger remove-rest-day-rule-btn" ' +
                    'title="Remove this rule">' +
                    '\u2715' +
                '</button>';

        html += '</div>';
        return html;
    }

    function collectDefaultRestDaysFromForm(form) {
        if (!form) { return []; }
        var boxes = form.querySelectorAll(
            '.academy-rest-day-checkbox[data-rest-day-owner="default"]'
        );
        return collectCheckedDays(boxes);
    }

    function collectRestDayRulesFromForm(form) {
        if (!form) { return []; }
        var list = form.querySelector('#academy-rest-day-rules-list');
        if (!list) { return []; }

        var rows = list.querySelectorAll('.academy-rest-day-rule-row');
        var rules = [];

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];

            var modeEl = row.querySelector(
                '.academy-rest-day-rule-mode-select'
            );
            var startEl = row.querySelector(
                '.academy-rest-day-rule-start'
            );
            var endEl = row.querySelector(
                '.academy-rest-day-rule-end'
            );

            var mode = modeEl ? modeEl.value : 'all';
            var start = startEl ? startEl.value.trim() : '';
            var end = endEl ? endEl.value.trim() : '';

            var boxes = row.querySelectorAll(
                '.academy-rest-day-checkbox[data-rest-day-owner="rule"]'
            );
            var days = collectCheckedDays(boxes);

            rules.push({
                mode: mode,
                startWeek: start === '' ? null : start,
                endWeek: end === '' ? null : end,
                days: days
            });
        }

        return rules;
    }

    function collectCheckedDays(boxes) {
        var result = [];
        for (var i = 0; i < boxes.length; i++) {
            var box = boxes[i];
            if (!box || !box.checked) { continue; }
            var n = Number(box.dataset ? box.dataset.restDay : null);
            if (!Number.isInteger(n)) { continue; }
            if (n < CalendarConstants.MIN_DAY ||
                n > CalendarConstants.MAX_DAY) {
                continue;
            }
            result.push(n);
        }
        result.sort(function(a, b) { return a - b; });
        return result;
    }

    function expandRestDayRulesToMap(rules) {
        var map = {};

        if (!Array.isArray(rules) || rules.length === 0) {
            return map;
        }

        for (var i = 0; i < rules.length; i++) {
            var rule = rules[i];
            if (!rule || typeof rule !== 'object') { continue; }

            var days = Array.isArray(rule.days) ? rule.days.slice() : [];
            days.sort(function(a, b) { return a - b; });

            var mode = isNonEmptyString(rule.mode) ? rule.mode : 'all';

            if (mode === 'all') {
                for (var w = MIN_WEEK; w <= MAX_WEEK; w++) {
                    map[String(w)] = days.slice();
                }
                continue;
            }

            if (mode === 'odd') {
                for (var wo = MIN_WEEK; wo <= MAX_WEEK; wo += 2) {
                    map[String(wo)] = days.slice();
                }
                continue;
            }

            if (mode === 'even') {
                var startEven = MIN_WEEK % 2 === 0
                    ? MIN_WEEK
                    : MIN_WEEK + 1;
                for (var we = startEven; we <= MAX_WEEK; we += 2) {
                    map[String(we)] = days.slice();
                }
                continue;
            }

            if (mode === 'single') {
                var single = parseInt(rule.startWeek, 10);
                if (isNaN(single)) { continue; }
                if (single < MIN_WEEK || single > MAX_WEEK) { continue; }
                map[String(single)] = days.slice();
                continue;
            }

            if (mode === 'range') {
                var rangeStart = parseInt(rule.startWeek, 10);
                var rangeEnd = parseInt(rule.endWeek, 10);
                if (isNaN(rangeStart) || isNaN(rangeEnd)) { continue; }
                if (rangeStart > rangeEnd) { continue; }
                if (rangeStart < MIN_WEEK) { rangeStart = MIN_WEEK; }
                if (rangeEnd > MAX_WEEK) { rangeEnd = MAX_WEEK; }
                for (var wr = rangeStart; wr <= rangeEnd; wr++) {
                    map[String(wr)] = days.slice();
                }
                continue;
            }
        }

        return map;
    }

    function deriveRulesFromRestDaysByWeek(map) {
        if (!map || typeof map !== 'object') { return []; }

        var keys = Object.keys(map);
        if (keys.length === 0) { return []; }

        var sorted = [];
        for (var i = 0; i < keys.length; i++) {
            var n = parseInt(keys[i], 10);
            if (isNaN(n)) { continue; }
            if (n < MIN_WEEK || n > MAX_WEEK) { continue; }
            sorted.push(n);
        }
        sorted.sort(function(a, b) { return a - b; });
        if (sorted.length === 0) { return []; }

        // ---- Common pattern 1: every week present, all identical ----
        if (sorted.length === MAX_WEEK - MIN_WEEK + 1) {
            var first = map[String(sorted[0])];
            var allSame = true;
            for (var c = 1; c < sorted.length; c++) {
                if (!arraysEqual(map[String(sorted[c])], first)) {
                    allSame = false;
                    break;
                }
            }
            if (allSame) {
                return [{
                    mode: 'all',
                    startWeek: null,
                    endWeek: null,
                    days: first.slice()
                }];
            }
        }

        // ---- Common pattern 2: odd weeks only, all identical ----
        var isOddOnly = true;
        var oddDays = null;
        for (var oi = 0; oi < sorted.length; oi++) {
            var wOdd = sorted[oi];
            if (wOdd % 2 === 0) { isOddOnly = false; break; }
            if (oddDays === null) {
                oddDays = map[String(wOdd)];
            } else if (!arraysEqual(map[String(wOdd)], oddDays)) {
                isOddOnly = false;
                break;
            }
        }
        if (isOddOnly && oddDays !== null) {
            return [{
                mode: 'odd',
                startWeek: null,
                endWeek: null,
                days: oddDays.slice()
            }];
        }

        // ---- Common pattern 3: even weeks only, all identical ----
        var isEvenOnly = true;
        var evenDays = null;
        for (var ei = 0; ei < sorted.length; ei++) {
            var wEven = sorted[ei];
            if (wEven % 2 !== 0) { isEvenOnly = false; break; }
            if (evenDays === null) {
                evenDays = map[String(wEven)];
            } else if (!arraysEqual(map[String(wEven)], evenDays)) {
                isEvenOnly = false;
                break;
            }
        }
        if (isEvenOnly && evenDays !== null) {
            return [{
                mode: 'even',
                startWeek: null,
                endWeek: null,
                days: evenDays.slice()
            }];
        }

        // ---- Common pattern 4: contiguous range, all identical ----
        var isContiguous = true;
        for (var ci = 1; ci < sorted.length; ci++) {
            if (sorted[ci] !== sorted[ci - 1] + 1) {
                isContiguous = false;
                break;
            }
        }
        if (isContiguous && sorted.length > 1) {
            var firstDays = map[String(sorted[0])];
            var rangeSame = true;
            for (var ri = 1; ri < sorted.length; ri++) {
                if (!arraysEqual(map[String(sorted[ri])], firstDays)) {
                    rangeSame = false;
                    break;
                }
            }
            if (rangeSame) {
                return [{
                    mode: 'range',
                    startWeek: String(sorted[0]),
                    endWeek: String(sorted[sorted.length - 1]),
                    days: firstDays.slice()
                }];
            }
        }

        // ---- Fallback: one single-week rule per entry ----
        var rules = [];
        for (var si = 0; si < sorted.length; si++) {
            var week = sorted[si];
            rules.push({
                mode: 'single',
                startWeek: String(week),
                endWeek: null,
                days: (map[String(week)] || []).slice()
            });
        }
        return rules;
    }

    function arraysEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) { return false; }
        if (a.length !== b.length) { return false; }
        for (var i = 0; i < a.length; i++) {
            if (Number(a[i]) !== Number(b[i])) { return false; }
        }
        return true;
    }

    // ============================================================
    // CHANGE NOTIFICATION
    // ============================================================

    var _onChange = null;

    function setOnChangeCallback(fn) {
        _onChange = (typeof fn === 'function') ? fn : null;
    }

    function notifyChange() {
        if (typeof _onChange !== 'function') { return; }
        try {
            _onChange();
        } catch (e) {
            console.warn('[AcademyCRUDModals] onChange callback threw:', e);
        }
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    function openModal(className, html, onBind) {
        var modal = Modal.createModal(className);
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return null;
        }

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = html || '';
        modal.appendChild(contentEl);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var close = function() {
            closeModal(modal);
        };

        if (typeof onBind === 'function') {
            onBind(modal, close);
        }

        return modal;
    }

    function closeModal(modal) {
        if (!modal) { return; }

        if (!modal.parentNode) {
            return;
        }

        var teardownPromise;

        try {
            if (typeof Modal.closeModal === 'function') {
                teardownPromise = Modal.closeModal(modal);
            } else if (typeof Modal.hideModal === 'function') {
                teardownPromise = Modal.hideModal(modal);
            }
        } catch (e) {
            console.warn('[AcademyCRUDModals] Modal teardown threw:', e);
            teardownPromise = null;
        }

        var finalize = function() {
            if (modal.parentNode) {
                try {
                    modal.parentNode.removeChild(modal);
                } catch (e) {
                    // Already detached
                }
            }
        };

        if (teardownPromise && typeof teardownPromise.then === 'function') {
            teardownPromise.then(finalize).catch(function(err) {
                console.warn('[AcademyCRUDModals] Modal teardown failed:', err);
                finalize();
            });
        } else {
            finalize();
        }
    }

    function bindCommonModalControls(modal, close) {
        if (!modal || typeof close !== 'function') { return; }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', close);
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                close();
            }
        });
    }

    // ============================================================
    // CLASS — FORM HTML
    // ============================================================

    function buildClassFormHTML(cls) {
        var isEdit = !!cls;
        var c = cls || {};

        var statuses = AcademyClasses.VALID_STATUSES;

        var restDays = Array.isArray(c.restDays) ? c.restDays : [];
        var restDaysByWeek = (c.restDaysByWeek && typeof c.restDaysByWeek === 'object' && !Array.isArray(c.restDaysByWeek))
            ? c.restDaysByWeek
            : {};

        var existingRules = deriveRulesFromRestDaysByWeek(restDaysByWeek);

        var html = '';
        html += '<form id="academy-class-form" class="academy-crud-form" ' +
                    'data-edit-id="' +
                        (isEdit ? escapeAttribute(c.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Class' : 'Create Class') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="ac-class-name">Class Name *</label>';
        html += '<input type="text" id="ac-class-name" class="ac-class-name" ' +
                    'value="' + escapeAttribute(c.name || '') + '" required>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="ac-class-year">Year</label>';
        html += '<input type="number" id="ac-class-year" class="ac-class-year" ' +
                    'value="' + escapeAttribute(
                        c.year !== undefined && c.year !== null
                            ? String(c.year)
                            : ''
                    ) + '" ' +
                    'min="1" placeholder="e.g., 2026">';
        html += '<p class="field-hint">' +
                    'Any positive integer, or blank for unspecified.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="ac-class-status">Status</label>';
        html += '<select id="ac-class-status" class="ac-class-status">';
        for (var i = 0; i < statuses.length; i++) {
            var s = statuses[i];
            var sel = (c.status || 'active') === s ? ' selected' : '';
            html += '<option value="' + escapeAttribute(s) + '"' + sel + '>' +
                        escapeHtml(s.charAt(0).toUpperCase() + s.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="ac-class-description">Description</label>';
        html += '<textarea id="ac-class-description" ' +
                    'class="ac-class-description" rows="3" ' +
                    'placeholder="Optional description...">' +
                    escapeHtml(c.description || '') +
                '</textarea>';
        html += '</div>';

        html += buildRestDaysFieldset(restDays);

        html += buildRestDayRulesFieldset(existingRules);

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Update' : 'Create') + ' Class' +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    // ============================================================
    // CLASS — DELETE CONFIRM HTML
    // ============================================================

    function buildClassDeleteHTML(cls) {
        var html = '';
        html += '<form id="academy-class-delete-form">';
        html += '<div class="modal-header">';
        html += '<h3>Delete Class</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' +
                    escapeHtml(cls.name || 'this class') +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the class entity, strips its ID from ' +
                    'every character, and deletes its teams, grades, ' +
                    'rankings, and enrollments.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Class</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // CLASS — ADD CHARACTER (stacked collapsible picker)
    // ============================================================

    function buildAddCharacterToClassHTML(vm) {
        var free = Array.isArray(vm.candidatesUnassigned)
            ? vm.candidatesUnassigned
            : [];
        var assigned = Array.isArray(vm.candidatesAssigned)
            ? vm.candidatesAssigned
            : [];
        var total = free.length + assigned.length;

        var html = '';
        html += '<form id="academy-add-character-form" ' +
                    'data-class-id="' + escapeAttribute(vm.classId) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Add Characters to ' +
                    escapeHtml(vm.className || 'Class') +
                '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        if (total === 0) {
            html += '<p class="field-hint">' +
                        'All characters are already in this class.' +
                    '</p>';
            html += '<div class="form-actions">';
            html += '<button type="button" ' +
                        'class="cancel-modal-btn secondary">Close</button>';
            html += '</div>';
            html += '</div>';
            html += '</form>';
            return html;
        }

        // ---- Search ----
        html += '<div class="form-group">';
        html += '<input type="text" id="ac-add-character-search" ' +
                    'class="ac-add-character-search" ' +
                    'placeholder="Search characters...">';
        html += '</div>';

        // ---- Stacked collapsible containers ----
        html += '<div class="ac-add-character-picker">';
        html += buildPickerContainer({
            columnKey: 'unassigned',
            title: 'Unassigned',
            entries: free,
            emptyMessage: 'No unassigned characters.',
            defaultExpanded: true
        });
        html += buildPickerContainer({
            columnKey: 'assigned',
            title: 'In Other Classes',
            entries: assigned,
            emptyMessage: 'No characters in other classes.',
            defaultExpanded: false
        });
        html += '</div>';

        // ---- Footer ----
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary" ' +
                    'id="ac-add-character-submit">Add Selected</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function buildPickerContainer(options) {
        var columnKey = options.columnKey;
        var title = options.title;
        var entries = options.entries || [];
        var emptyMessage = options.emptyMessage || 'No entries.';
        var defaultExpanded = options.defaultExpanded === true;

        var expandedAttr = defaultExpanded ? 'true' : 'false';

        var html = '';
        html += '<div class="ac-add-character-container" ' +
                    'data-column="' + escapeAttribute(columnKey) + '" ' +
                    'data-expanded="' + expandedAttr + '">';

        // ---- Header (clickable) ----
        html += '<button type="button" ' +
                    'class="ac-add-character-container-header" ' +
                    'data-container-toggle="true" ' +
                    'data-column="' + escapeAttribute(columnKey) + '" ' +
                    'aria-expanded="' + expandedAttr + '">';
        html += '<span class="ac-add-character-container-caret">' +
                    '\u25b8' +
                '</span>';
        html += '<span class="ac-add-character-container-title">' +
                    escapeHtml(title) +
                '</span>';
        html += '<span class="ac-add-character-container-count" ' +
                    'data-column-count="' + escapeAttribute(columnKey) + '">' +
                    entries.length +
                '</span>';
        html += '</button>';

        // ---- Action row ----
        html += '<div class="ac-add-character-container-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-bulk-action="select-all" ' +
                    'data-column="' + escapeAttribute(columnKey) + '">' +
                    'Select all' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-bulk-action="clear-column" ' +
                    'data-column="' + escapeAttribute(columnKey) + '">' +
                    'Clear' +
                '</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="ac-add-character-container-body" ' +
                    'data-column-body="' + escapeAttribute(columnKey) + '">';

        if (entries.length === 0) {
            html += '<div class="ac-add-character-container-empty">' +
                        escapeHtml(emptyMessage) +
                    '</div>';
        } else {
            for (var i = 0; i < entries.length; i++) {
                html += renderCharacterCheckbox(entries[i], columnKey);
            }
        }

        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderCharacterCheckbox(entry, columnKey) {
        if (!entry || !entry.id) { return ''; }

        var label = formatCharacterOptionLabel(entry.name, entry.age);
        var searchKey = (entry.name || '').toLowerCase();

        var html = '';
        html += '<label class="ac-add-character-row" ' +
                    'data-character-id="' + escapeAttribute(entry.id) + '" ' +
                    'data-search-key="' + escapeAttribute(searchKey) + '" ' +
                    'data-column="' + escapeAttribute(columnKey) + '">';
        html += '<input type="checkbox" class="ac-add-character-checkbox" ' +
                    'value="' + escapeAttribute(entry.id) + '">';
        html += '<span class="ac-add-character-name">' +
                    escapeHtml(label) +
                '</span>';
        html += '</label>';

        return html;
    }

    function buildAddCharacterToClassViewModel(classId) {
        var cls = getClassRecord(classId);
        if (!cls) { return null; }

        var currentIds = Object.create(null);

        var students = AcademyAggregator.getClassStudentsViewModel(classId) || [];
        for (var i = 0; i < students.length; i++) {
            if (students[i] && students[i].id) {
                currentIds[String(students[i].id)] = true;
            }
        }

        var instructorIds = getClassInstructorIdsForDisplay(classId);
        for (var ii = 0; ii < instructorIds.length; ii++) {
            if (instructorIds[ii]) {
                currentIds[String(instructorIds[ii])] = true;
            }
        }

        var all = CharacterQueries.getCharacters() || [];
        var free = [];
        var assigned = [];

        for (var j = 0; j < all.length; j++) {
            var c = all[j];
            if (!c || !c.id) { continue; }
            if (currentIds[String(c.id)]) { continue; }

            var entry = {
                id: c.id,
                name: CharacterQueries.getDisplayName(c),
                age: CharacterQueries.getCharacterAge(c),
                status: CharacterQueries.getCurrentStatus(c)
            };

            var hasAnyClass = Array.isArray(c.classIds) && c.classIds.length > 0;
            if (hasAnyClass) {
                assigned.push(entry);
            } else {
                free.push(entry);
            }
        }

        free.sort(function(a, b) { return compareAlpha(a.name, b.name); });
        assigned.sort(function(a, b) { return compareAlpha(a.name, b.name); });

        return {
            classId: cls.id,
            className: cls.name || 'Unnamed Class',
            candidatesUnassigned: free,
            candidatesAssigned: assigned,
            candidates: free.concat(assigned)
        };
    }

    // ============================================================
    // CLASS — ADD CHARACTER (stacked collapsible picker) — events
    // ============================================================

    function bindBulkCharacterPickerEvents(form) {
        var searchEl = form.querySelector('#ac-add-character-search');

        function updateCounts() {
            var containers = form.querySelectorAll(
                '.ac-add-character-container'
            );
            for (var c = 0; c < containers.length; c++) {
                var container = containers[c];
                var key = container.dataset.column;
                var badge = container.querySelector(
                    '[data-column-count="' + key + '"]'
                );
                if (!badge) { continue; }

                var checked = container.querySelectorAll(
                    '.ac-add-character-checkbox:checked'
                ).length;
                var total = container.querySelectorAll(
                    '.ac-add-character-row'
                ).length;

                badge.textContent = checked > 0
                    ? checked + ' / ' + total
                    : String(total);

                if (checked > 0) {
                    badge.classList.add('has-selected');
                } else {
                    badge.classList.remove('has-selected');
                }
            }
        }

        if (searchEl) {
            searchEl.addEventListener('input', function() {
                var term = searchEl.value.toLowerCase().trim();
                var rows = form.querySelectorAll('.ac-add-character-row');

                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    var key = row.dataset.searchKey || '';
                    var matches = term === '' || key.indexOf(term) !== -1;
                    if (matches) {
                        row.classList.remove('hidden-by-search');
                    } else {
                        row.classList.add('hidden-by-search');
                    }
                }

                updateContainerEmptyState(form);
            });
        }

        form.addEventListener('change', function(e) {
            if (e.target && e.target.classList &&
                e.target.classList.contains('ac-add-character-checkbox')) {
                updateCounts();
            }
        });

        form.addEventListener('click', function(e) {
            var target = e.target;
            if (!target || typeof target.closest !== 'function') { return; }

            // ---- Container header toggle ----
            var headerEl = target.closest(
                '[data-container-toggle="true"]'
            );
            if (headerEl) {
                e.preventDefault();
                toggleContainer(headerEl);
                return;
            }

            // ---- Bulk actions ----
            var actionEl = target.closest('[data-bulk-action]');
            if (!actionEl) { return; }
            e.preventDefault();

            var action = actionEl.dataset.bulkAction;
            var columnKey = actionEl.dataset.column;

            if (action === 'select-all') {
                selectAllVisibleInContainer(form, columnKey);
                updateCounts();
                return;
            }

            if (action === 'clear-column') {
                clearContainer(form, columnKey);
                updateCounts();
                return;
            }
        });
    }

    function toggleContainer(headerEl) {
        if (!headerEl) { return; }
        var container = headerEl.closest('.ac-add-character-container');
        if (!container) { return; }

        var current = container.dataset.expanded === 'true';
        var next = !current;

        container.dataset.expanded = next ? 'true' : 'false';
        headerEl.setAttribute('aria-expanded', next ? 'true' : 'false');
    }

    function selectAllVisibleInContainer(form, columnKey) {
        if (!columnKey) { return; }

        var container = form.querySelector(
            '.ac-add-character-container[data-column="' +
            cssEscape(columnKey) + '"]'
        );
        if (!container) { return; }

        var rows = container.querySelectorAll(
            '.ac-add-character-row:not(.hidden-by-search)'
        );
        for (var i = 0; i < rows.length; i++) {
            var checkbox = rows[i].querySelector(
                '.ac-add-character-checkbox'
            );
            if (checkbox) {
                checkbox.checked = true;
            }
        }
    }

    function clearContainer(form, columnKey) {
        if (!columnKey) { return; }

        var container = form.querySelector(
            '.ac-add-character-container[data-column="' +
            cssEscape(columnKey) + '"]'
        );
        if (!container) { return; }

        var checkboxes = container.querySelectorAll(
            '.ac-add-character-checkbox'
        );
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = false;
        }
    }

    function updateContainerEmptyState(form) {
        var containers = form.querySelectorAll(
            '.ac-add-character-container'
        );

        for (var c = 0; c < containers.length; c++) {
            var container = containers[c];
            var body = container.querySelector(
                '.ac-add-character-container-body'
            );
            if (!body) { continue; }

            var totalRows = body.querySelectorAll(
                '.ac-add-character-row'
            ).length;
            if (totalRows === 0) {
                // Container was empty at build time; its build-time
                // empty hint is already the only content.
                continue;
            }

            var visibleRows = body.querySelectorAll(
                '.ac-add-character-row:not(.hidden-by-search)'
            ).length;

            var noMatches = body.querySelector(
                '.ac-add-character-container-no-matches'
            );

            if (visibleRows === 0) {
                if (!noMatches) {
                    noMatches = document.createElement('div');
                    noMatches.className =
                        'ac-add-character-container-empty ' +
                        'ac-add-character-container-no-matches';
                    noMatches.textContent = 'No matches.';
                    body.appendChild(noMatches);
                }
                noMatches.classList.remove('hidden');
            } else if (noMatches) {
                noMatches.classList.add('hidden');
            }
        }
    }

    function collectSelectedCharacterIds(form) {
        var checks = form.querySelectorAll(
            '.ac-add-character-checkbox:checked'
        );
        var ids = [];
        for (var i = 0; i < checks.length; i++) {
            if (checks[i].value) {
                ids.push(checks[i].value);
            }
        }
        return ids;
    }

    /**
     * Sequential chain of addToClass calls. Not atomic: each call is
     * its own MutationPipeline transaction. Earlier successes are
     * committed even if a later call fails.
     *
     * On completion:
     *   - all success  → toast, close, refresh
     *   - partial      → warn, log failures, close, refresh, reopen
     *   - none success → error, log failures, close, refresh
     */
    function runBulkAddCharacters(ids, classId, closeModalFn) {
        var failures = [];
        var succeeded = 0;

        var submitBtn = document.getElementById('ac-add-character-submit');
        if (submitBtn) { submitBtn.disabled = true; }

        var chain = Promise.resolve();

        ids.forEach(function(charId) {
            chain = chain.then(function() {
                return AcademyClasses.addToClass(charId, classId)
                    .then(function(result) {
                        if (result && result.success) {
                            succeeded++;
                        } else {
                            failures.push({
                                characterId: charId,
                                message: (result && result.message) ||
                                    'Unknown error'
                            });
                        }
                    })
                    .catch(function(err) {
                        failures.push({
                            characterId: charId,
                            message: String(err && err.message || err)
                        });
                    });
            });
        });

        chain.then(function() {
            var total = succeeded + failures.length;

            if (failures.length === 0) {
                notify(
                    'Added ' + succeeded + ' character' +
                    (succeeded === 1 ? '' : 's') + ' to the class.',
                    'success'
                );
                closeModalFn();
                notifyChange();
                return;
            }

            for (var i = 0; i < failures.length; i++) {
                console.warn(
                    '[AcademyCRUDModals] bulk add-character failure:',
                    failures[i]
                );
            }

            if (succeeded === 0) {
                notify(
                    'Could not add any of the ' + total +
                    ' selected character(s). See console for details.',
                    'error'
                );
                closeModalFn();
                notifyChange();
                return;
            }

            notify(
                'Added ' + succeeded + ' of ' + total +
                ' character(s). Some failed. See console for details.',
                'warning'
            );

            closeModalFn();
            notifyChange();

            // Reopen on a fresh tick so the user can pick up the
            // remaining candidates without re-clicking the button.
            setTimeout(function() {
                openAddCharacterToClass(classId);
            }, 0);
        });
    }

    // ============================================================
    // CLASS — ADD CHARACTER (entry point)
    // ============================================================

    function openAddCharacterToClass(classId) {
        var vm = buildAddCharacterToClassViewModel(classId);
        if (!vm) {
            notify('Class not found.', 'error');
            return;
        }

        var html = buildAddCharacterToClassHTML(vm);

        openModal('academy-add-character-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-add-character-form');
            if (!form) { return; }

            bindBulkCharacterPickerEvents(form);

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var ids = collectSelectedCharacterIds(form);
                if (ids.length === 0) {
                    notify('Select at least one character.', 'error');
                    return;
                }

                runBulkAddCharacters(ids, vm.classId, close);
            });
        });
    }

    // ============================================================
    // DISCIPLINE — DELETE CONFIRM HTML
    // ============================================================

    function buildDisciplineDeleteHTML(disc) {
        var html = '';
        html += '<form id="academy-discipline-delete-form">';
        html += '<div class="modal-header">';
        html += '<h3>Delete Discipline</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' +
                    escapeHtml(disc.name || 'this discipline') +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the discipline, its auto-groups, ' +
                    'enrollments, and any grades and schedule slots ' +
                    'referencing it.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Discipline</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // LOCATION — FORM HTML
    // ============================================================

    function buildLocationFormHTML(loc) {
        var isEdit = !!loc;
        var l = loc || {};

        var types = AcademyLocations.getValidLocationTypes();
        var minCapacity = AcademyLocations.MIN_CAPACITY;
        var maxCapacity = AcademyLocations.MAX_CAPACITY;

        var html = '';
        html += '<form id="academy-location-form" class="academy-crud-form" ' +
                    'data-edit-id="' +
                        (isEdit ? escapeAttribute(l.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Location' : 'Create Location') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="ac-loc-name">Location Name *</label>';
        html += '<input type="text" id="ac-loc-name" class="ac-loc-name" ' +
                    'value="' + escapeAttribute(l.name || '') + '" required>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="ac-loc-type">Type</label>';
        html += '<select id="ac-loc-type" class="ac-loc-type">';
        for (var i = 0; i < types.length; i++) {
            var t = types[i];
            var sel = (l.type || 'other') === t ? ' selected' : '';
            html += '<option value="' + escapeAttribute(t) + '"' + sel + '>' +
                        escapeHtml(t.charAt(0).toUpperCase() + t.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="ac-loc-capacity">Capacity</label>';
        html += '<input type="number" id="ac-loc-capacity" ' +
                    'class="ac-loc-capacity" ' +
                    'value="' + escapeAttribute(
                        l.capacity !== undefined && l.capacity !== null
                            ? String(l.capacity)
                            : ''
                    ) + '" ' +
                    'min="' + escapeAttribute(String(minCapacity)) + '" ' +
                    'max="' + escapeAttribute(String(maxCapacity)) + '" ' +
                    'placeholder="Optional">';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Update' : 'Create') + ' Location' +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    // ============================================================
    // LOCATION — DELETE CONFIRM HTML
    // ============================================================

    function buildLocationDeleteHTML(loc) {
        var html = '';
        html += '<form id="academy-location-delete-form">';
        html += '<div class="modal-header">';
        html += '<h3>Delete Location</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' +
                    escapeHtml(loc.name || 'this location') +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the location, its weekly schedules, and ' +
                    'class-to-location assignments.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Location</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // SOCIAL SCORE — FORM HTML
    // ============================================================

    function buildSocialScoreFormHTML(charId, classId, week, currentValue) {
        var ASS = getAcademySocialScore();
        var minScore = (ASS && typeof ASS.MIN_SCORE === 'number')
            ? ASS.MIN_SCORE
            : 0;
        var maxScore = (ASS && typeof ASS.MAX_SCORE === 'number')
            ? ASS.MAX_SCORE
            : 100;

        var hasCurrent = typeof currentValue === 'number' && isFinite(currentValue);
        var currentStr = hasCurrent ? String(currentValue) : '';

        var html = '';
        html += '<form id="academy-social-score-form" ' +
                    'data-character-id="' + escapeAttribute(charId) + '" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + escapeAttribute(String(week)) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Set Social Score</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="ac-social-score-input">Score (' +
                    escapeHtml(String(minScore)) + '\u2013' +
                    escapeHtml(String(maxScore)) +
                ')</label>';
        html += '<input type="number" id="ac-social-score-input" ' +
                    'class="ac-social-score-input" ' +
                    'value="' + escapeAttribute(currentStr) + '" ' +
                    'min="' + escapeAttribute(String(minScore)) + '" ' +
                    'max="' + escapeAttribute(String(maxScore)) + '" ' +
                    'step="1" required>';
        html += '<p class="field-hint">' +
                    'Social score contributes to the overall performance ' +
                    'blend for this student in this class for the ' +
                    'selected week.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Save</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    // ============================================================
    // OPEN — CLASS FORM
    // ============================================================

    function openClassForm(classId) {
        var cls = null;
        if (classId) {
            cls = getClassRecord(classId);
        }

        var html = buildClassFormHTML(cls);

        openModal('academy-class-form-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-class-form');
            if (!form) { return; }

            // ---- "+ Add Rule" button ----
            var addRuleBtn = form.querySelector('#add-rest-day-rule-btn');
            if (addRuleBtn) {
                addRuleBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    var list = form.querySelector('#academy-rest-day-rules-list');
                    if (!list) { return; }
                    var wrapper = document.createElement('div');
                    wrapper.innerHTML = renderRestDayRuleRow({
                        mode: 'all',
                        startWeek: null,
                        endWeek: null,
                        days: []
                    });
                    var row = wrapper.firstElementChild;
                    if (row) {
                        list.appendChild(row);
                    }
                });
            }

            // ---- Rule removal, delegated on the form ----
            form.addEventListener('click', function(e) {
                var removeBtn = e.target.closest
                    ? e.target.closest('.remove-rest-day-rule-btn')
                    : null;
                if (!removeBtn) { return; }
                e.preventDefault();
                var row = removeBtn.closest('.academy-rest-day-rule-row');
                if (row && row.parentNode) {
                    row.parentNode.removeChild(row);
                }
            });

            // ---- Submit ----
            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var nameInput = form.querySelector('.ac-class-name');
                var yearInput = form.querySelector('.ac-class-year');
                var statusInput = form.querySelector('.ac-class-status');
                var descInput = form.querySelector('.ac-class-description');

                var name = nameInput ? nameInput.value.trim() : '';
                var yearRaw = yearInput ? yearInput.value.trim() : '';
                var status = statusInput ? statusInput.value : 'active';
                var description = descInput ? descInput.value.trim() : '';

                if (!name) {
                    notify('Class name is required.', 'error');
                    return;
                }

                var yearValue = null;
                if (yearRaw !== '') {
                    yearValue = ValidationUtils.parseStrictPositiveInteger(yearRaw);
                    if (yearValue === null) {
                        notify('Year must be a positive integer.', 'error');
                        return;
                    }
                }

                var restDays = collectDefaultRestDaysFromForm(form);
                var rules = collectRestDayRulesFromForm(form);
                var restDaysByWeek = expandRestDayRulesToMap(rules);

                var payload = {
                    name: name,
                    year: yearValue,
                    status: status,
                    description: description,
                    restDays: restDays,
                    restDaysByWeek: restDaysByWeek
                };

                var promise = (cls && cls.id)
                    ? AcademyClasses.update(cls.id, payload)
                    : AcademyClasses.create(name, payload);

                promise.then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Class save failed:', err);
                    notify('Failed to save class.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — CLASS DELETE
    // ============================================================

    function openClassDelete(classId) {
        var cls = getClassRecord(classId);
        if (!cls) {
            notify('Class not found.', 'error');
            return;
        }

        var html = buildClassDeleteHTML(cls);

        openModal('academy-class-delete-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-class-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                AcademyClasses.delete(cls.id).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Class delete failed:', err);
                    notify('Failed to delete class.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — DISCIPLINE DELETE
    // ============================================================

    function openDisciplineDelete(disciplineId) {
        var disc = getDisciplineRecord(disciplineId);
        if (!disc) {
            notify('Discipline not found.', 'error');
            return;
        }

        var html = buildDisciplineDeleteHTML(disc);

        openModal('academy-discipline-delete-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-discipline-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                AcademyDisciplines.delete(disc.id).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Discipline delete failed:', err);
                    notify('Failed to delete discipline.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — LOCATION FORM
    // ============================================================

    function openLocationForm(locationId) {
        var loc = null;
        if (locationId) {
            loc = getLocationRecord(locationId);
        }

        var html = buildLocationFormHTML(loc);

        openModal('academy-location-form-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-location-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var nameInput = form.querySelector('.ac-loc-name');
                var typeInput = form.querySelector('.ac-loc-type');
                var capInput = form.querySelector('.ac-loc-capacity');

                var name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    notify('Location name is required.', 'error');
                    return;
                }

                var capRaw = capInput ? capInput.value.trim() : '';
                var capacity = null;
                if (capRaw !== '') {
                    capacity = ValidationUtils.parseStrictPositiveInteger(capRaw);
                    if (capacity === null) {
                        notify('Capacity must be a positive integer.', 'error');
                        return;
                    }
                }

                var payload = {
                    name: name,
                    type: typeInput ? typeInput.value : 'other',
                    capacity: capacity
                };

                var promise = (loc && loc.id)
                    ? AcademyLocations.update(loc.id, payload)
                    : AcademyLocations.create(payload);

                promise.then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Location save failed:', err);
                    notify('Failed to save location.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — LOCATION DELETE
    // ============================================================

    function openLocationDelete(locationId) {
        var loc = getLocationRecord(locationId);
        if (!loc) {
            notify('Location not found.', 'error');
            return;
        }

        var html = buildLocationDeleteHTML(loc);

        openModal('academy-location-delete-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-location-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                AcademyLocations.delete(loc.id).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Location delete failed:', err);
                    notify('Failed to delete location.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — SOCIAL SCORE
    // ============================================================

    function openSocialScoreForm(charId, classId, week) {
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }
        if (!isNonEmptyString(classId)) {
            notify('Select a class before editing a social score.', 'error');
            return;
        }

        var weekNum = ValidationUtils.parseStrictPositiveInteger(week);
        if (weekNum === null) {
            notify('Valid week is required.', 'error');
            return;
        }

        var ASS = getAcademySocialScore();
        if (!ASS || typeof ASS.setSocialScore !== 'function') {
            notify('Social score module not available.', 'error');
            return;
        }

        var currentValue = null;
        if (typeof ASS.getSocialScore === 'function') {
            try {
                currentValue = ASS.getSocialScore(charId, classId, weekNum);
            } catch (e) {
                console.warn('[AcademyCRUDModals] getSocialScore failed:', e);
                currentValue = null;
            }
        }

        var html = buildSocialScoreFormHTML(charId, classId, weekNum, currentValue);

        openModal('academy-social-score-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-social-score-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var input = form.querySelector('.ac-social-score-input');
                var raw = input ? input.value.trim() : '';

                if (raw === '') {
                    notify('Score is required.', 'error');
                    return;
                }

                var value = parseFloat(raw);
                if (isNaN(value)) {
                    notify('Score must be a number.', 'error');
                    return;
                }

                ASS.setSocialScore(charId, classId, weekNum, value)
                    .then(function(result) {
                        if (result && result.success) {
                            close();
                            notifyChange();
                        }
                    })
                    .catch(function(err) {
                        console.warn(
                            '[AcademyCRUDModals] Set social score failed:', err
                        );
                        notify('Failed to save social score.', 'error');
                    });
            });
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCRUDModals = Object.freeze({
        openClassForm: openClassForm,
        openClassDelete: openClassDelete,
        openAddCharacterToClass: openAddCharacterToClass,

        openDisciplineDelete: openDisciplineDelete,

        openLocationForm: openLocationForm,
        openLocationDelete: openLocationDelete,

        openSocialScoreForm: openSocialScoreForm,

        setOnChangeCallback: setOnChangeCallback,

        buildClassFormHTML: buildClassFormHTML,
        buildClassDeleteHTML: buildClassDeleteHTML,
        buildAddCharacterToClassHTML: buildAddCharacterToClassHTML,
        buildDisciplineDeleteHTML: buildDisciplineDeleteHTML,
        buildLocationFormHTML: buildLocationFormHTML,
        buildLocationDeleteHTML: buildLocationDeleteHTML,
        buildSocialScoreFormHTML: buildSocialScoreFormHTML
    });

})();
