/**
 * modules/academy/academy-grades-editor.js - Academy Inline Grades Editor
 * Inline editor for a single character's grades within a class and week.
 *
 * Path: js/modules/academy/academy-grades-editor.js
 *
 * RESPONSIBILITIES:
 *   - Render the character's grades for a (class, week) pair,
 *     GROUPED BY DISCIPLINE and COLLAPSIBLE.
 *   - Render the Add Grade form and Edit Grade modal.
 *   - Render the Delete Grade confirmation modal.
 *   - Wire per-row Edit / Delete buttons and per-discipline Add
 *     buttons via container delegation.
 *   - Route every mutation through AcademyGrades (Promise-based).
 *   - Convert percentages to the discipline's grading scheme for
 *     display (percentage remains the source of truth).
 *
 * NOT RESPONSIBILITIES:
 *   - Domain validation. AcademyGrades validates.
 *   - Notifications. The pipeline notifies.
 *   - Persistence. The pipeline persists.
 *
 * WEEK SCOPING:
 *   The editor is WEEK-SCOPED. It mounts for a (character, class,
 *   week) triple. The displayed grades are those for that week,
 *   only. The grade form's week field is FIXED at mount time and
 *   cannot be changed.
 *
 * DISCIPLINE GROUPING:
 *   Grades are grouped by discipline. Each discipline renders as a
 *   collapsible block:
 *
 *     [▾] Combat Training   [2 grades]   [+ Add]
 *     |   Class Assignment  Tue, 08:00   85% (B)   Edit Delete
 *     |   Quiz              Take-home    72% (C)   Edit Delete
 *
 *     [▸] History          [1 grade]    [+ Add]
 *
 *   The discipline name, the grade count, and a per-discipline
 *   "+ Add" button live on the header. Clicking the header toggles
 *   the block's body.
 *
 *   The per-discipline "+ Add" opens the grade form with the
 *   discipline pre-selected. The top-level "+ Add Grade" button
 *   stays; it opens the form with no discipline pre-selected.
 *
 *   Disciplines with no grades for the mounted week do not appear.
 *
 * COLLAPSE STATE:
 *   Collapse state is stored in AcademyUI's expandedIds map, keyed
 *     grades:<charId>:<classId>:<week>:<disciplineId>
 *   The default is EXPANDED. A discipline the user has never
 *   touched renders with its body open.
 *
 *   When AcademyUI is unavailable, the default is EXPANDED and
 *   toggling is a no-op.
 *
 *   After a save, if the grade was added to a collapsed discipline,
 *   the discipline is expanded so the new grade is visible.
 *
 * SLOT PICKER — DISCIPLINE-SCOPED (this revision):
 *   The Add/Edit Grade form carries a slot picker instead of the
 *   retired free-date input. The picker's options are the class
 *   meetings the character has FOR THE SELECTED DISCIPLINE, at the
 *   mounted week:
 *
 *     Tuesday, 08:00 — Combat Training A
 *     Thursday, 10:00 — Combat Training A
 *
 *   Each option's value encodes
 *     { day, startTime, groupId }
 *   on the grade record. The character's occurrences come from
 *   AcademyTeachingProjector.projectForStudent, filtered to
 *   occurrences whose classId matches the mounted class AND whose
 *   disciplineId matches the selected discipline.
 *
 *   THE PICKER REBUILDS WHEN THE DISCIPLINE CHANGES. The selected
 *   slot is reset to empty when the discipline changes: the old
 *   slot belonged to the old discipline's context, even if the
 *   (day, hour) coordinates happen to coincide with a meeting of
 *   the new discipline.
 *
 *   homeAssignment hides the slot picker entirely. The grade's
 *   slot is null.
 *
 *   EMPTY PICKER POLICY:
 *     When the selected discipline has no class meetings this week
 *     (the character is unassigned, or the discipline's group has
 *     no sessions), the picker shows a disabled dropdown with a
 *     message, and save is still allowed with slot: null. The slot
 *     is descriptive metadata; forbidding save because the schedule
 *     happens to be empty would block grading a take-home quiz
 *     whose meeting was cancelled.
 *
 * CONTEXT VERIFICATION:
 *   Every mutation is checked against the mounted context before
 *   dispatch. A grade being edited or deleted MUST belong to the
 *   mounted (character, class) pair.
 *
 * ASYNC SAFETY:
 *   Every asynchronous callback captures the current `_openToken`.
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal returns a bare .modal shell. The modal content
 *   helper here appends a fresh .modal-content wrapper.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.ValidationUtils
 *   - window.AcademyGrades
 *   - window.AcademyDisciplines
 *   - window.AcademyGradeSchemes
 *   - window.AcademyEnrolments
 *   - window.CalendarConstants
 *
 * DEPENDENCIES (OPTIONAL, used if present):
 *   - window.AcademyUI
 *   - window.AcademyTeachingProjector
 */

(function() {
    'use strict';

    if (window.__academyGradesEditorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var ValidationUtils = window.ValidationUtils;
    var AcademyGrades = window.AcademyGrades;
    var AcademyDisciplines = window.AcademyDisciplines;
    var GradeSchemes = window.AcademyGradeSchemes;
    var AcademyEnrolments = window.AcademyEnrolments;
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
    if (!AcademyGrades || typeof AcademyGrades.getStudentClassGrades !== 'function') {
        _missing.push('AcademyGrades.getStudentClassGrades');
    }
    if (!AcademyGrades || typeof AcademyGrades.create !== 'function') {
        _missing.push('AcademyGrades.create');
    }
    if (!AcademyGrades || typeof AcademyGrades.update !== 'function') {
        _missing.push('AcademyGrades.update');
    }
    if (!AcademyGrades || typeof AcademyGrades.delete !== 'function') {
        _missing.push('AcademyGrades.delete');
    }
    if (!AcademyGrades || typeof AcademyGrades.getGrade !== 'function') {
        _missing.push('AcademyGrades.getGrade');
    }
    if (!AcademyGrades || typeof AcademyGrades.calculateSummary !== 'function') {
        _missing.push('AcademyGrades.calculateSummary');
    }
    if (!AcademyGrades || typeof AcademyGrades.calculatePercentage !== 'function') {
        _missing.push('AcademyGrades.calculatePercentage');
    }
    if (!AcademyGrades || typeof AcademyGrades.getGradeTypeLabel !== 'function') {
        _missing.push('AcademyGrades.getGradeTypeLabel');
    }
    if (!AcademyGrades || !Array.isArray(AcademyGrades.VALID_GRADE_TYPES)) {
        _missing.push('AcademyGrades.VALID_GRADE_TYPES');
    }
    if (!AcademyGrades || typeof AcademyGrades.isSlotlessType !== 'function') {
        _missing.push('AcademyGrades.isSlotlessType');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getGradeScheme !== 'function') {
        _missing.push('AcademyDisciplines.getGradeScheme');
    }
    if (!GradeSchemes || typeof GradeSchemes.getGradeDisplay !== 'function') {
        _missing.push('AcademyGradeSchemes.getGradeDisplay');
    }
    if (!GradeSchemes || typeof GradeSchemes.normalizeScheme !== 'function') {
        _missing.push('AcademyGradeSchemes.normalizeScheme');
    }
    if (!AcademyEnrolments || typeof AcademyEnrolments.getStudentDisciplines !== 'function') {
        _missing.push('AcademyEnrolments.getStudentDisciplines');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number' ||
        typeof CalendarConstants.MIN_DAY !== 'number' ||
        typeof CalendarConstants.MAX_DAY !== 'number' ||
        typeof CalendarConstants.MIN_HOUR !== 'number' ||
        typeof CalendarConstants.MAX_HOUR !== 'number') {
        _missing.push('CalendarConstants bounds');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.getDayName !== 'function' ||
        typeof CalendarConstants.formatHour !== 'function') {
        _missing.push('CalendarConstants.getDayName/formatHour');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyGradesEditor] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyGradesEditorLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademyUI() {
        return window.AcademyUI || null;
    }

    function getAcademyTeachingProjector() {
        return window.AcademyTeachingProjector || null;
    }

    function getAcademyTeachingGroups() {
        return window.AcademyTeachingGroups || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var DEFAULT_MAX_SCORE = 100;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    function parseStrictWeek(value) {
        var n = ValidationUtils.parseStrictPositiveInteger(value);
        if (n === null) { return null; }
        if (n < MIN_WEEK || n > MAX_WEEK) { return null; }
        return n;
    }

    function parseFiniteNumber(value) {
        var n = Number(value);
        if (!isFinite(n)) { return null; }
        return n;
    }

    function getDisciplineName(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return 'Unknown'; }
        var d = AcademyDisciplines.getDiscipline(disciplineId);
        return d && d.name ? d.name : 'Unknown';
    }

    function getDisciplineType(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return ''; }
        var d = AcademyDisciplines.getDiscipline(disciplineId);
        return d && d.type ? d.type : '';
    }

    function getSchemeForDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return GradeSchemes.normalizeScheme(null);
        }

        var scheme = AcademyDisciplines.getGradeScheme(disciplineId);

        if (scheme === null || scheme === undefined) {
            return GradeSchemes.normalizeScheme(null);
        }

        return scheme;
    }

    function getGradePercentage(grade) {
        if (!grade) { return null; }

        var score = parseFiniteNumber(grade.score);
        var max = parseFiniteNumber(grade.maxScore);
        if (score === null || max === null || max <= 0) { return null; }

        try {
            return AcademyGrades.calculatePercentage(score, max);
        } catch (e) {
            return null;
        }
    }

    function formatScoreDisplay(grade, scheme) {
        var pct = getGradePercentage(grade);
        if (pct === null) { return '\u2014'; }
        return GradeSchemes.getGradeDisplay(scheme, pct);
    }

    function getScoreClass(percentage) {
        if (!isFiniteNumber(percentage)) {
            return 'academy-grade-score academy-grade-score-unknown';
        }
        if (percentage >= 90) {
            return 'academy-grade-score academy-grade-score-excellent';
        }
        if (percentage >= 80) {
            return 'academy-grade-score academy-grade-score-good';
        }
        if (percentage >= 70) {
            return 'academy-grade-score academy-grade-score-passing';
        }
        return 'academy-grade-score academy-grade-score-failing';
    }

    function getTypeLabel(grade) {
        var type = isNonEmptyString(grade.type)
            ? grade.type
            : AcademyGrades.DEFAULT_GRADE_TYPE;
        return AcademyGrades.getGradeTypeLabel(type);
    }

    /**
     * Format a slot for display.
     *
     * Slots read as "Tuesday, 08:00 — Combat Training A".
     * A null slot on a non-slotless type reads as "—".
     * A slotless type (homeAssignment) reads as "Take-home".
     */
    function formatSlotLabel(grade) {
        if (!grade) { return '\u2014'; }

        if (AcademyGrades.isSlotlessType(grade.type)) {
            return 'Take-home';
        }

        if (!grade.slot || typeof grade.slot !== 'object') {
            return '\u2014';
        }

        var day = grade.slot.day;
        var startTime = grade.slot.startTime;
        var groupId = grade.slot.groupId;

        var dayLabel = '';
        if (isFiniteNumber(day)) {
            try {
                dayLabel = CalendarConstants.getDayName(day) || '';
            } catch (e) {
                dayLabel = '';
            }
        }

        var hourLabel = '';
        if (isFiniteNumber(startTime)) {
            try {
                hourLabel = CalendarConstants.formatHour(startTime) || '';
            } catch (e) {
                hourLabel = '';
            }
        }

        var head = '';
        if (dayLabel && hourLabel) {
            head = dayLabel + ', ' + hourLabel;
        } else if (dayLabel) {
            head = dayLabel;
        } else if (hourLabel) {
            head = hourLabel;
        } else {
            return '\u2014';
        }

        var groupLabel = '';
        if (isNonEmptyString(groupId)) {
            groupLabel = getGroupDisplayName(groupId);
        }

        if (groupLabel) {
            return head + ' \u2014 ' + groupLabel;
        }
        return head;
    }

    function getGroupDisplayName(groupId) {
        if (!isNonEmptyString(groupId)) { return ''; }
        var TG = getAcademyTeachingGroups();
        if (!TG || typeof TG.getGroup !== 'function') { return ''; }

        var group = null;
        try {
            group = TG.getGroup(groupId);
        } catch (e) {
            return '';
        }
        if (!group) { return ''; }

        if (isNonEmptyString(group.customName)) {
            return String(group.customName).trim();
        }

        var disciplineName = getDisciplineName(group.disciplineId);
        var num = isFiniteNumber(group.groupNumber)
            ? group.groupNumber
            : 0;
        if (num > 0) {
            return disciplineName + ' ' + num;
        }
        return disciplineName;
    }

    // ============================================================
    // SLOT OPTIONS — DISCIPLINE-SCOPED
    // ============================================================
    //
    // Build the slot picker's option list for a (charId, classId,
    // disciplineId, week) tuple. Occurrences come from the teaching
    // projector; the filter keeps only those whose classId matches
    // the mounted class AND whose disciplineId matches the selected
    // discipline.
    //
    // Each option carries:
    //   { day, startTime, groupId, label }
    //
    // The label reads "Tuesday, 08:00 — Combat Training A". The
    // group label is resolved via the teaching-groups module.
    //
    // Deduplication is by (day, startTime, groupId): two different
    // groups meeting at the same time produce two options, because
    // they are different class meetings.

    function buildSlotOptions(charId, classId, disciplineId, weekNum) {
        if (!isNonEmptyString(disciplineId)) {
            return [];
        }

        var Projector = getAcademyTeachingProjector();
        if (!Projector ||
            typeof Projector.projectForStudent !== 'function') {
            return [];
        }

        var occurrences = [];
        try {
            occurrences = Projector.projectForStudent(
                charId, weekNum
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyGradesEditor] projectForStudent threw:', e
            );
            return [];
        }

        if (!Array.isArray(occurrences)) { return []; }

        var seen = Object.create(null);
        var options = [];

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!occ) { continue; }
            if (String(occ.classId) !== String(classId)) {
                continue;
            }
            if (String(occ.disciplineId) !== String(disciplineId)) {
                continue;
            }
            if (!isFiniteNumber(occ.day)) { continue; }
            if (!isFiniteNumber(occ.startTime)) { continue; }

            var groupId = isNonEmptyString(occ.groupId)
                ? String(occ.groupId)
                : null;

            var key = String(occ.day) + '@' +
                      String(occ.startTime) + '@' +
                      String(groupId || '');
            if (seen[key]) { continue; }
            seen[key] = true;

            var dayLabel = '';
            try {
                dayLabel = CalendarConstants.getDayName(occ.day) || '';
            } catch (e) {
                dayLabel = 'Day ' + occ.day;
            }

            var hourLabel = '';
            try {
                hourLabel = CalendarConstants.formatHour(
                    occ.startTime
                ) || (occ.startTime + ':00');
            } catch (e) {
                hourLabel = occ.startTime + ':00';
            }

            var label = dayLabel + ', ' + hourLabel;

            var groupLabel = getGroupDisplayName(groupId);
            if (groupLabel) {
                label += ' \u2014 ' + groupLabel;
            }

            options.push({
                day: occ.day,
                startTime: occ.startTime,
                groupId: groupId,
                label: label
            });
        }

        options.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
            return safeString(a.groupId).localeCompare(
                safeString(b.groupId)
            );
        });

        return options;
    }

    function makeSlotValue(slot) {
        if (!slot || typeof slot !== 'object') { return ''; }
        if (!isFiniteNumber(slot.day)) { return ''; }
        if (!isFiniteNumber(slot.startTime)) { return ''; }
        var base = String(slot.day) + '@' + String(slot.startTime);
        if (isNonEmptyString(slot.groupId)) {
            return base + '@' + String(slot.groupId);
        }
        return base;
    }

    function parseSlotValue(value) {
        if (!isNonEmptyString(value)) { return null; }
        var parts = String(value).split('@');
        if (parts.length < 2 || parts.length > 3) { return null; }

        var day = parseInt(parts[0], 10);
        var startTime = parseInt(parts[1], 10);
        if (!isFinite(day) || !isFinite(startTime)) { return null; }

        var groupId = null;
        if (parts.length === 3 && parts[2] !== '') {
            groupId = parts[2];
        }

        return {
            day: day,
            startTime: startTime,
            groupId: groupId
        };
    }

    // ============================================================
    // COLLAPSE STATE
    // ============================================================

    function makeCollapseKey(charId, classId, weekNum, disciplineId) {
        return 'grades:' +
            String(charId) + ':' +
            String(classId) + ':' +
            String(weekNum) + ':' +
            String(disciplineId);
    }

    function isDisciplineExpanded(charId, classId, weekNum, disciplineId) {
        var AcademyUI = getAcademyUI();
        if (!AcademyUI || typeof AcademyUI.isExpanded !== 'function') {
            return true;
        }
        var key = makeCollapseKey(
            charId, classId, weekNum, disciplineId
        );
        return AcademyUI.isExpanded(key) === true;
    }

    function setDisciplineExpanded(
        charId, classId, weekNum, disciplineId, expanded
    ) {
        var AcademyUI = getAcademyUI();
        if (!AcademyUI || typeof AcademyUI.setExpanded !== 'function') {
            return;
        }
        var key = makeCollapseKey(
            charId, classId, weekNum, disciplineId
        );
        AcademyUI.setExpanded(key, expanded === true);
    }

    // ============================================================
    // ENROLLMENT PICKER
    // ============================================================

    function normaliseEnrolmentEntryToDisciplineId(entry) {
        if (entry === null || entry === undefined) { return null; }

        if (typeof entry === 'string') {
            var trimmed = entry.trim();
            return trimmed === '' ? null : trimmed;
        }

        if (typeof entry === 'object' && !Array.isArray(entry)) {
            var id = entry.disciplineId;
            if (typeof id === 'string' && id.trim() !== '') {
                return id.trim();
            }
            return null;
        }

        return null;
    }

    function getEnrolledDisciplineOptions(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return [];
        }

        var rawEntries = [];
        try {
            rawEntries = AcademyEnrolments.getStudentDisciplines(
                studentId, classId
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyGradesEditor] getStudentDisciplines threw:', e
            );
            rawEntries = [];
        }

        if (!Array.isArray(rawEntries)) {
            rawEntries = [];
        }

        var seen = Object.create(null);
        var disciplineIds = [];

        for (var e = 0; e < rawEntries.length; e++) {
            var id = normaliseEnrolmentEntryToDisciplineId(rawEntries[e]);
            if (id === null) { continue; }
            if (seen[id]) { continue; }
            seen[id] = true;
            disciplineIds.push(id);
        }

        if (disciplineIds.length === 0) {
            return [];
        }

        var weekNum = parseStrictWeek(week);
        var options = [];

        for (var i = 0; i < disciplineIds.length; i++) {
            var disciplineId = disciplineIds[i];
            var discipline = AcademyDisciplines.getDiscipline(disciplineId);

            if (!discipline) {
                options.push({
                    id: disciplineId,
                    name: 'Unknown Discipline',
                    type: '',
                    activeThisWeek: false,
                    missing: true
                });
                continue;
            }

            var activeThisWeek = true;
            if (weekNum !== null) {
                var startWeek = ValidationUtils.parseStrictPositiveInteger(
                    discipline.startWeek
                );
                var endWeek = ValidationUtils.parseStrictPositiveInteger(
                    discipline.endWeek
                );
                if (startWeek !== null && weekNum < startWeek) {
                    activeThisWeek = false;
                }
                if (endWeek !== null && weekNum > endWeek) {
                    activeThisWeek = false;
                }
            }

            options.push({
                id: discipline.id,
                name: discipline.name || 'Unnamed Discipline',
                type: getDisciplineType(discipline.id),
                activeThisWeek: activeThisWeek,
                missing: false
            });
        }

        options.sort(function(a, b) {
            if (a.missing !== b.missing) {
                return a.missing ? 1 : -1;
            }
            if (a.activeThisWeek !== b.activeThisWeek) {
                return a.activeThisWeek ? -1 : 1;
            }
            return (a.name || '').localeCompare(b.name || '');
        });

        return options;
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _state = {
        container: null,
        charId: null,
        classId: null,
        week: null,
        listening: false
    };

    var _delegatedHandler = null;

    var _openToken = 0;

    // ============================================================
    // MOUNT / UNMOUNT / REFRESH
    // ============================================================

    function mount(container, charId, classId, week) {
        if (!container) {
            console.warn('[AcademyGradesEditor] mount requires a container');
            return;
        }

        if (!isNonEmptyString(charId)) {
            container.innerHTML =
                '<p class="empty-state small">No character selected.</p>';
            return;
        }

        var weekNum = parseStrictWeek(week);
        if (weekNum === null) {
            container.innerHTML =
                '<p class="empty-state small">Valid week is required.</p>';
            return;
        }

        unmount(container);

        _state.container = container;
        _state.charId = String(charId);
        _state.classId = isNonEmptyString(classId) ? String(classId) : null;
        _state.week = weekNum;

        _openToken++;

        render();

        if (!_state.listening) {
            _delegatedHandler = function(e) {
                handleDelegatedClick(e);
            };
            container.addEventListener('click', _delegatedHandler);
            _state.listening = true;
        }
    }

    function unmount(container) {
        var target = container || _state.container;
        if (target && _delegatedHandler && _state.listening) {
            try {
                target.removeEventListener('click', _delegatedHandler);
            } catch (e) {
                // Ignore
            }
        }
        _delegatedHandler = null;
        _state.container = null;
        _state.charId = null;
        _state.classId = null;
        _state.week = null;
        _state.listening = false;

        _openToken++;
    }

    function refresh() {
        if (!_state.container || !_state.charId) {
            return;
        }
        render();
    }

    // ============================================================
    // CONTEXT VERIFICATION
    // ============================================================

    function gradeBelongsToMountedContext(grade) {
        if (!grade) { return false; }
        if (!_state.charId) { return false; }
        if (String(grade.studentId) !== _state.charId) { return false; }
        if (_state.classId !== null &&
            String(grade.classId) !== _state.classId) {
            return false;
        }
        return true;
    }

    // ============================================================
    // GROUPING
    // ============================================================

    function groupGradesByDiscipline(grades, charId, classId, weekNum) {
        var byDiscipline = Object.create(null);
        var order = [];

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            if (!grade) { continue; }
            var did = isNonEmptyString(grade.disciplineId)
                ? String(grade.disciplineId)
                : '__unknown__';

            if (!byDiscipline[did]) {
                byDiscipline[did] = [];
                order.push(did);
            }
            byDiscipline[did].push(grade);
        }

        var groups = [];

        for (var k = 0; k < order.length; k++) {
            var id = order[k];
            var list = byDiscipline[id];

            list.sort(function(a, b) {
                var at = safeString(a.type);
                var bt = safeString(b.type);
                if (at !== bt) { return at.localeCompare(bt); }
                return safeString(a.createdAt).localeCompare(
                    safeString(b.createdAt)
                );
            });

            groups.push({
                disciplineId: id === '__unknown__' ? '' : id,
                disciplineName: id === '__unknown__'
                    ? 'Unknown Discipline'
                    : getDisciplineName(id),
                grades: list,
                expanded: id === '__unknown__'
                    ? true
                    : isDisciplineExpanded(
                        charId, classId, weekNum, id
                    )
            });
        }

        groups.sort(function(a, b) {
            return a.disciplineName.localeCompare(b.disciplineName);
        });

        return groups;
    }

    // ============================================================
    // RENDER — GROUPED TABLE
    // ============================================================

    function render() {
        if (!_state.container) { return; }

        var charId = _state.charId;
        var classId = _state.classId;
        var weekNum = _state.week;

        var grades = AcademyGrades.getStudentClassGrades(
            charId, classId, weekNum
        ) || [];

        var groups = groupGradesByDiscipline(
            grades, charId, classId, weekNum
        );

        var html = '';
        html += '<div class="academy-grades-editor">';

        html += '<div class="academy-grades-editor-header">';
        html += '<h4 class="academy-grades-editor-title">Grades</h4>';
        html += '<span class="academy-grades-editor-week">' +
                    'Week ' + escapeHtml(String(weekNum)) +
                '</span>';
        html += '<button type="button" ' +
                    'class="primary small academy-add-grade-btn" ' +
                    'data-action="add-grade">' +
                    '+ Add Grade' +
                '</button>';
        html += '</div>';

        if (groups.length === 0) {
            html += '<p class="empty-state small">' +
                        'No grades recorded for this character in this ' +
                        'class for week ' + escapeHtml(String(weekNum)) +
                        '.' +
                    '</p>';
            html += '</div>';
            _state.container.innerHTML = html;
            return;
        }

        html += '<div class="academy-grades-group-list">';

        for (var g = 0; g < groups.length; g++) {
            html += renderDisciplineGroup(groups[g]);
        }

        html += '</div>';

        var summary = AcademyGrades.calculateSummary(grades);
        if (summary && summary.count > 0 && isFiniteNumber(summary.average)) {
            html += '<p class="academy-grades-summary">' +
                        'Average across ' + summary.count +
                        ' grade' + (summary.count === 1 ? '' : 's') + ': ' +
                        escapeHtml(String(summary.average)) + '%' +
                    '</p>';
        }

        html += '</div>';

        _state.container.innerHTML = html;
    }

    function renderDisciplineGroup(group) {
        var expanded = group.expanded === true;
        var disciplineId = group.disciplineId;
        var grades = group.grades;
        var gradeCount = grades.length;

        var countLabel = gradeCount === 1
            ? '1 grade'
            : gradeCount + ' grades';

        var html = '';
        html += '<div class="academy-grades-group" ' +
                    'data-discipline-id="' +
                        escapeAttribute(disciplineId) + '" ' +
                    'data-expanded="' +
                        escapeAttribute(expanded ? 'true' : 'false') + '">';

        html += '<div class="academy-grades-group-header">';

        html += '<button type="button" ' +
                    'class="academy-grades-group-toggle" ' +
                    'data-action="grades-toggle-discipline" ' +
                    'data-discipline-id="' +
                        escapeAttribute(disciplineId) + '" ' +
                    'aria-expanded="' +
                        escapeAttribute(expanded ? 'true' : 'false') + '" ' +
                    'title="' +
                        escapeAttribute(expanded
                            ? 'Collapse this discipline'
                            : 'Expand this discipline') + '">';
        html += '<span class="academy-grades-group-caret">' +
                    (expanded ? '\u25be' : '\u25b8') +
                '</span>';
        html += '<span class="academy-grades-group-name">' +
                    escapeHtml(group.disciplineName) +
                '</span>';
        html += '<span class="academy-grades-group-count">' +
                    escapeHtml(countLabel) +
                '</span>';
        html += '</button>';

        html += '<button type="button" ' +
                    'class="small primary ' +
                    'academy-grades-group-add-btn" ' +
                    'data-action="add-grade" ' +
                    'data-discipline-id="' +
                        escapeAttribute(disciplineId) + '" ' +
                    'title="Add a grade to ' +
                        escapeAttribute(group.disciplineName) + '">' +
                    '+ Add' +
                '</button>';

        html += '</div>';

        html += '<div class="academy-grades-group-body" ' +
                    'style="display:' +
                    (expanded ? 'block' : 'none') + ';">';

        html += '<table class="academy-grades-editor-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th class="type-col">Type</th>';
        html += '<th class="slot-col">Slot</th>';
        html += '<th class="score-col">Score</th>';
        html += '<th class="actions-col">Actions</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var i = 0; i < grades.length; i++) {
            html += renderGradeRow(grades[i]);
        }

        html += '</tbody>';
        html += '</table>';

        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderGradeRow(grade) {
        var percentage = getGradePercentage(grade);
        var scoreClass = getScoreClass(percentage);
        var scheme = getSchemeForDiscipline(grade.disciplineId);
        var scoreDisplay = formatScoreDisplay(grade, scheme);

        var typeLabel = getTypeLabel(grade);
        var slotLabel = formatSlotLabel(grade);

        var html = '';
        html += '<tr class="academy-grades-editor-row" ' +
                    'data-grade-id="' +
                        escapeAttribute(grade.id || '') + '">';
        html += '<td class="type-col">' +
                    escapeHtml(typeLabel) +
                '</td>';
        html += '<td class="slot-col">' +
                    escapeHtml(slotLabel) +
                '</td>';
        html += '<td class="score-col">' +
                    '<span class="' + scoreClass + '">' +
                        escapeHtml(scoreDisplay) +
                    '</span>' +
                '</td>';
        html += '<td class="actions-col">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="edit-grade" ' +
                    'data-grade-id="' +
                        escapeAttribute(grade.id || '') + '">' +
                    'Edit' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="delete-grade" ' +
                    'data-grade-id="' +
                        escapeAttribute(grade.id || '') + '">' +
                    'Delete' +
                '</button>';
        html += '</td>';
        html += '</tr>';
        return html;
    }

    // ============================================================
    // DELEGATED CLICK
    // ============================================================

    function handleDelegatedClick(e) {
        var target = e.target;
        var actionEl = target.closest('[data-action]');
        if (!actionEl) { return; }

        var action = actionEl.dataset.action;
        var gradeId = actionEl.dataset.gradeId;
        var disciplineId = actionEl.dataset.disciplineId;

        switch (action) {
            case 'add-grade':
                e.preventDefault();
                openGradeForm(null, disciplineId || null);
                return;
            case 'edit-grade':
                e.preventDefault();
                if (gradeId) { openGradeForm(gradeId, null); }
                return;
            case 'delete-grade':
                e.preventDefault();
                if (gradeId) { confirmDeleteGrade(gradeId); }
                return;
            case 'grades-toggle-discipline':
                e.preventDefault();
                if (disciplineId) {
                    toggleDisciplineExpanded(disciplineId);
                }
                return;
            default:
                return;
        }
    }

    function toggleDisciplineExpanded(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return; }
        if (!_state.charId || !_state.classId || _state.week === null) {
            return;
        }

        var currentlyExpanded = isDisciplineExpanded(
            _state.charId,
            _state.classId,
            _state.week,
            disciplineId
        );

        setDisciplineExpanded(
            _state.charId,
            _state.classId,
            _state.week,
            disciplineId,
            !currentlyExpanded
        );

        render();
    }

    // ============================================================
    // ADD / EDIT GRADE FORM
    // ============================================================

    function openGradeForm(gradeId, preSelectedDisciplineId) {
        var existing = null;
        if (gradeId) {
            existing = AcademyGrades.getGrade(gradeId);
            if (!existing) {
                notify('Grade not found.', 'error');
                return;
            }

            if (!gradeBelongsToMountedContext(existing)) {
                console.warn(
                    '[AcademyGradesEditor] Refusing to edit grade ' +
                    gradeId + ': it does not belong to the mounted ' +
                    'character/class context.'
                );
                notify(
                    'This grade belongs to a different character or ' +
                    'class.',
                    'error'
                );
                return;
            }
        }

        var isEdit = !!existing;
        var g = existing || {};

        var disciplineOptions = getEnrolledDisciplineOptions(
            _state.charId,
            _state.classId,
            _state.week
        );

        var validTypes = Array.isArray(AcademyGrades.VALID_GRADE_TYPES)
            ? AcademyGrades.VALID_GRADE_TYPES.slice()
            : ['classAssignment'];

        var modal = openModalShell('academy-grade-form-modal');
        if (!modal) { return; }

        var myToken = _openToken;

        // Resolve the initial discipline.
        var initialDisciplineId = g.disciplineId || null;
        if (!initialDisciplineId &&
            isNonEmptyString(preSelectedDisciplineId)) {
            initialDisciplineId = preSelectedDisciplineId;
        }
        if (!initialDisciplineId) {
            for (var i = 0; i < disciplineOptions.length; i++) {
                if (disciplineOptions[i].activeThisWeek &&
                    !disciplineOptions[i].missing) {
                    initialDisciplineId = disciplineOptions[i].id;
                    break;
                }
            }
        }

        var initialScheme = getSchemeForDiscipline(initialDisciplineId);

        var initialScore = (g.score !== undefined && g.score !== null)
            ? g.score
            : '';
        var initialScoreNum = parseFiniteNumber(initialScore);

        var hasEnrollment = disciplineOptions.length > 0;
        var hasSelectable = false;
        for (var k = 0; k < disciplineOptions.length; k++) {
            if (!disciplineOptions[k].missing) {
                hasSelectable = true;
                break;
            }
        }

        var initialType = isNonEmptyString(g.type)
            ? g.type
            : AcademyGrades.DEFAULT_GRADE_TYPE;

        var slotlessInitial = AcademyGrades.isSlotlessType(initialType);

        // Build slot options for the INITIAL discipline.
        var initialSlotOptions = buildSlotOptions(
            _state.charId,
            _state.classId,
            initialDisciplineId,
            _state.week
        );
        var initialSlotValue = makeSlotValue(g.slot);

        var weekDisplay = String(_state.week);

        var html = '';
        html += '<form id="academy-grade-form" ' +
                    'data-edit-id="' +
                        (isEdit ? escapeAttribute(existing.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Grade' : 'Add Grade') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<div class="form-group academy-grade-week-readonly">';
        html += '<label>Week</label>';
        html += '<p class="academy-grade-week-value">' +
                    escapeHtml(weekDisplay) +
                    ' <span class="academy-grade-week-locked">' +
                        '(set by the Schedule tab; not editable here)' +
                    '</span>' +
                '</p>';
        html += '</div>';

        // ---- Discipline ----
        html += '<div class="form-group">';
        html += '<label for="ag-disc-select">Discipline *</label>';
        html += '<select id="ag-disc-select" class="ag-disc-select" required>';

        if (!hasEnrollment) {
            html += '<option value="">' +
                        'Not enrolled in any disciplines for this class' +
                    '</option>';
        } else if (!hasSelectable) {
            html += '<option value="">' +
                        'All enrolled disciplines are unavailable' +
                    '</option>';
        } else {
            html += '<option value="">Select a discipline...</option>';
            for (var d = 0; d < disciplineOptions.length; d++) {
                var opt = disciplineOptions[d];
                var selected = String(opt.id) ===
                    String(initialDisciplineId)
                    ? ' selected'
                    : '';
                var disabled = (opt.missing || !opt.activeThisWeek)
                    ? ' disabled'
                    : '';
                var suffix = '';
                if (opt.missing) {
                    suffix = ' (missing)';
                } else if (!opt.activeThisWeek) {
                    suffix = ' (not active this week)';
                }
                html += '<option value="' +
                            escapeAttribute(opt.id) + '"' +
                            selected + disabled + '>' +
                            escapeHtml(opt.name + suffix) +
                        '</option>';
            }
        }

        html += '</select>';

        if (!hasEnrollment) {
            html += '<p class="field-hint">' +
                        'This student is not enrolled in any disciplines ' +
                        'for this class. Enroll them in a discipline before ' +
                        'adding grades.' +
                    '</p>';
        } else if (!hasSelectable) {
            html += '<p class="field-hint">' +
                        'None of this student\'s enrolled disciplines are ' +
                        'active during week ' +
                        escapeHtml(weekDisplay) + '.' +
                    '</p>';
        }

        html += '</div>';

        // ---- Type ----
        html += '<div class="form-group">';
        html += '<label for="ag-type-select">Type</label>';
        html += '<select id="ag-type-select" class="ag-type-select">';
        for (var t = 0; t < validTypes.length; t++) {
            var type = validTypes[t];
            var tSel = initialType === type ? ' selected' : '';
            html += '<option value="' + escapeAttribute(type) + '"' + tSel + '>' +
                        escapeHtml(AcademyGrades.getGradeTypeLabel(type)) +
                    '</option>';
        }
        html += '</select>';
        html += '<p class="field-hint">' +
                    'Weight comes from the discipline\'s assessment setup.' +
                '</p>';
        html += '</div>';

        // ---- Slot (hidden when type is slotless) ----
        html += '<div class="form-group ag-slot-group"' +
                    (slotlessInitial ? ' style="display:none;"' : '') + '>';
        html += '<label for="ag-slot-select">Slot</label>';
        html += '<div class="ag-slot-host">';
        html += renderSlotSelect(
            initialSlotOptions,
            initialSlotValue
        );
        html += '</div>';
        html += '</div>';

        // ---- Score / Max ----
        html += '<div class="form-row" ' +
                    'style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        html += '<div class="form-group">';
        html += '<label for="ag-score-input">Score *</label>';
        html += '<input type="number" step="0.1" id="ag-score-input" ' +
                    'class="ag-score-input" ' +
                    'value="' + escapeAttribute(initialScore) + '" ' +
                    'min="0" required>';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label for="ag-max-score-input">Max Score</label>';
        html += '<input type="number" step="0.1" ' +
                    'id="ag-max-score-input" class="ag-max-score-input" ' +
                    'value="' + escapeAttribute(
                        g.maxScore !== undefined && g.maxScore !== null
                            ? String(g.maxScore)
                            : String(DEFAULT_MAX_SCORE)
                    ) + '" ' +
                    'min="1">';
        html += '</div>';
        html += '</div>';

        html += '<div class="form-group ag-grade-preview-group">';
        html += '<span class="ag-grade-preview-label">Converted:</span> ';
        html += '<span id="ag-grade-preview" class="ag-grade-preview">' +
                    escapeHtml('\u2014') +
                '</span>';
        html += '</div>';

        // ---- Notes ----
        html += '<div class="form-group">';
        html += '<label for="ag-notes-input">Notes</label>';
        html += '<textarea id="ag-notes-input" class="ag-notes-input" ' +
                    'rows="2">' +
                    escapeHtml(g.notes || '') +
                '</textarea>';
        html += '</div>';

        var submitDisabled = (!hasEnrollment || !hasSelectable)
            ? ' disabled'
            : '';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary"' + submitDisabled + '>' +
                    (isEdit ? 'Update Grade' : 'Add Grade') +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        attachModalContent(modal, html);
        bindGradeFormEvents(modal, existing, myToken);

        var previewEl = modal.querySelector('#ag-grade-preview');
        if (previewEl && initialScoreNum !== null) {
            var preview = GradeSchemes.getGradeDisplay(
                initialScheme, initialScoreNum
            );
            previewEl.textContent = preview || '\u2014';
        }
    }

    /**
     * Render the slot <select> given a list of options and the
     * currently-selected slot value. Used both at initial form
     * build and on discipline change (via innerHTML replacement of
     * the slot host).
     *
     * Empty-options policy (see file header):
     *   No options at all -> disabled dropdown with an explanatory
     *   option, plus a hint below. Save is still allowed; the grade
     *   stores slot: null.
     */
    function renderSlotSelect(slotOptions, selectedValue) {
        var html = '';

        if (!Array.isArray(slotOptions) || slotOptions.length === 0) {
            html += '<select id="ag-slot-select" ' +
                        'class="ag-slot-select" disabled>';
            html += '<option value="">' +
                        'No class meetings for this discipline this week' +
                    '</option>';
            html += '</select>';
            html += '<p class="field-hint">' +
                        'No scheduled meetings of this discipline for ' +
                        'this character this week. The grade can be ' +
                        'saved without a slot.' +
                    '</p>';
            return html;
        }

        html += '<select id="ag-slot-select" class="ag-slot-select">';
        html += '<option value="">No slot (optional)</option>';

        for (var i = 0; i < slotOptions.length; i++) {
            var slot = slotOptions[i];
            var slotValue = makeSlotValue(slot);
            var selected = slotValue === selectedValue
                ? ' selected'
                : '';
            html += '<option value="' +
                        escapeAttribute(slotValue) + '"' +
                        selected + '>' +
                        escapeHtml(slot.label) +
                    '</option>';
        }

        html += '</select>';
        html += '<p class="field-hint">' +
                    'Which class meeting of this discipline this grade ' +
                    'came from.' +
                '</p>';

        return html;
    }

    function bindGradeFormEvents(modal, existing, myToken) {
        var busy = false;

        var close = function() {
            closeModal(modal);
        };

        bindCommonModalControls(modal, close);

        var form = modal.querySelector('#academy-grade-form');
        if (!form) { return; }

        var discInput = form.querySelector('.ag-disc-select');
        var typeInput = form.querySelector('.ag-type-select');
        var slotGroup = form.querySelector('.ag-slot-group');
        var slotHost = form.querySelector('.ag-slot-host');
        var scoreInput = form.querySelector('.ag-score-input');
        var previewEl = form.querySelector('#ag-grade-preview');
        var submitBtn = form.querySelector('button[type="submit"]');

        function getSlotInput() {
            return form.querySelector('.ag-slot-select');
        }

        function updatePreview() {
            if (!previewEl) { return; }

            var discId = discInput ? discInput.value : '';
            var scheme = getSchemeForDiscipline(discId);

            var rawScore = scoreInput ? scoreInput.value : '';
            var score = parseFiniteNumber(rawScore);

            if (score === null) {
                previewEl.textContent = '\u2014';
                return;
            }

            var preview = GradeSchemes.getGradeDisplay(scheme, score);
            previewEl.textContent = preview || '\u2014';
        }

        function updateSlotVisibility() {
            if (!typeInput || !slotGroup) { return; }
            var type = typeInput.value;
            var slotless = AcademyGrades.isSlotlessType(type);
            slotGroup.style.display = slotless ? 'none' : '';
        }

        /**
         * Rebuild the slot dropdown when the discipline changes.
         *
         * The currently-selected slot is DISCARDED. The old slot
         * belonged to the old discipline's context; even if the
         * (day, hour) coordinates happen to coincide with a meeting
         * of the new discipline, the meeting is a different one.
         */
        function rebuildSlotOptionsForDiscipline() {
            if (!slotHost) { return; }
            var discId = discInput ? discInput.value : '';
            if (!isNonEmptyString(discId)) {
                slotHost.innerHTML = renderSlotSelect([], '');
                return;
            }

            var options = buildSlotOptions(
                _state.charId,
                _state.classId,
                discId,
                _state.week
            );

            slotHost.innerHTML = renderSlotSelect(options, '');
        }

        if (scoreInput) {
            scoreInput.addEventListener('input', updatePreview);
        }
        if (discInput) {
            discInput.addEventListener('change', function() {
                updatePreview();
                rebuildSlotOptionsForDiscipline();
            });
        }
        if (typeInput) {
            typeInput.addEventListener('change', updateSlotVisibility);
        }

        form.addEventListener('submit', function(e) {
            e.preventDefault();

            if (busy) { return; }
            if (myToken !== _openToken) { return; }

            var maxInput = form.querySelector('.ag-max-score-input');
            var notesInput = form.querySelector('.ag-notes-input');
            var slotInput = getSlotInput();

            var disciplineId = discInput ? discInput.value : '';
            var type = typeInput ? typeInput.value : '';
            var score = scoreInput ? parseFiniteNumber(scoreInput.value) : null;
            var maxScore = maxInput && maxInput.value !== ''
                ? parseFiniteNumber(maxInput.value)
                : DEFAULT_MAX_SCORE;

            if (!disciplineId) {
                notify('Please select a discipline.', 'error');
                return;
            }
            if (!type || AcademyGrades.VALID_GRADE_TYPES.indexOf(type) === -1) {
                notify('Please select a grade type.', 'error');
                return;
            }
            if (score === null) {
                notify('Score is required and must be a number.', 'error');
                return;
            }
            if (maxScore === null || maxScore <= 0) {
                notify('Max score must be greater than 0.', 'error');
                return;
            }
            if (score > maxScore) {
                notify('Score cannot exceed max score.', 'error');
                return;
            }

            var slot = null;
            if (!AcademyGrades.isSlotlessType(type) && slotInput) {
                slot = parseSlotValue(slotInput.value);
            }

            var week = _state.week;

            var payload;
            if (existing && existing.id) {
                payload = {
                    disciplineId: disciplineId,
                    type: type,
                    slot: slot,
                    score: score,
                    maxScore: maxScore,
                    notes: notesInput ? notesInput.value.trim() : ''
                };
            } else {
                payload = {
                    studentId: _state.charId,
                    classId: _state.classId,
                    disciplineId: disciplineId,
                    week: week,
                    type: type,
                    slot: slot,
                    score: score,
                    maxScore: maxScore,
                    notes: notesInput ? notesInput.value.trim() : ''
                };
            }

            busy = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = existing
                    ? 'Updating\u2026'
                    : 'Adding\u2026';
            }

            var promise = (existing && existing.id)
                ? AcademyGrades.update(existing.id, payload)
                : AcademyGrades.create(payload);

            promise.then(function(result) {
                if (myToken !== _openToken) { return; }
                busy = false;
                if (submitBtn) { submitBtn.disabled = false; }

                if (result && result.success) {
                    if (isNonEmptyString(disciplineId)) {
                        setDisciplineExpanded(
                            _state.charId,
                            _state.classId,
                            _state.week,
                            disciplineId,
                            true
                        );
                    }
                    close();
                    refresh();
                }
            }).catch(function(err) {
                if (myToken !== _openToken) { return; }
                busy = false;
                if (submitBtn) { submitBtn.disabled = false; }
                console.warn('[AcademyGradesEditor] Save failed:', err);
                notify('Failed to save grade.', 'error');
            });
        });
    }

    // ============================================================
    // DELETE CONFIRM
    // ============================================================

    function confirmDeleteGrade(gradeId) {
        var grade = AcademyGrades.getGrade(gradeId);
        if (!grade) {
            notify('Grade not found.', 'error');
            return;
        }

        if (!gradeBelongsToMountedContext(grade)) {
            console.warn(
                '[AcademyGradesEditor] Refusing to delete grade ' +
                gradeId + ': it does not belong to the mounted ' +
                'character/class context.'
            );
            notify(
                'This grade belongs to a different character or class.',
                'error'
            );
            return;
        }

        var disciplineName = getDisciplineName(grade.disciplineId);
        var scheme = getSchemeForDiscipline(grade.disciplineId);
        var scoreDisplay = formatScoreDisplay(grade, scheme);
        var slotLabel = formatSlotLabel(grade);
        var typeLabel = getTypeLabel(grade);

        var modal = openModalShell('academy-grade-delete-modal');
        if (!modal) { return; }

        var myToken = _openToken;

        var html = '';
        html += '<form id="academy-grade-delete-form">';
        html += '<div class="modal-header">';
        html += '<h3>Delete Grade</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Delete this grade?</p>';
        html += '<p class="text-dim" style="font-size:0.8rem;">';
        html += escapeHtml(disciplineName) +
                ' \u2014 ' + escapeHtml(typeLabel) +
                ' \u2014 ' + escapeHtml(slotLabel) +
                ' \u2014 ' + escapeHtml(scoreDisplay);
        html += '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Grade</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';

        attachModalContent(modal, html);

        var busy = false;

        var close = function() {
            closeModal(modal);
        };

        bindCommonModalControls(modal, close);

        var form = modal.querySelector('#academy-grade-delete-form');
        if (!form) { return; }

        var submitBtn = form.querySelector('button[type="submit"]');

        form.addEventListener('submit', function(e) {
            e.preventDefault();

            if (busy) { return; }
            if (myToken !== _openToken) { return; }

            busy = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Deleting\u2026';
            }

            AcademyGrades.delete(gradeId).then(function(result) {
                if (myToken !== _openToken) { return; }
                busy = false;
                if (submitBtn) { submitBtn.disabled = false; }

                if (result && result.success) {
                    close();
                    refresh();
                }
            }).catch(function(err) {
                if (myToken !== _openToken) { return; }
                busy = false;
                if (submitBtn) { submitBtn.disabled = false; }
                console.warn('[AcademyGradesEditor] Delete failed:', err);
                notify('Failed to delete grade.', 'error');
            });
        });
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    function openModalShell(className) {
        var modal = Modal.createModal(className);
        if (!modal) {
            notify('Could not create modal.', 'error');
            return null;
        }
        return modal;
    }

    function attachModalContent(modal, html) {
        if (!modal) { return; }

        var contentEl = modal.querySelector('.modal-content');
        if (!contentEl) {
            contentEl = document.createElement('div');
            contentEl.className = 'modal-content';
            modal.appendChild(contentEl);
        }
        contentEl.innerHTML = html || '';

        Modal.modalSetup(modal);
        Modal.showModal(modal);
    }

    function closeModal(modal) {
        if (!modal) { return; }

        try {
            if (typeof Modal.hideModal === 'function') {
                Modal.hideModal(modal);
            } else if (typeof Modal.closeModal === 'function') {
                Modal.closeModal(modal);
            }
        } catch (e) {
            console.warn('[AcademyGradesEditor] Modal close failed:', e);
        }

        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    }

    function bindCommonModalControls(modal, close) {
        if (!modal || typeof close !== 'function') { return; }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) { closeBtn.addEventListener('click', close); }

        var cancelBtn = modal.querySelector(
            '.modal-cancel-btn, .cancel-modal-btn'
        );
        if (cancelBtn) { cancelBtn.addEventListener('click', close); }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { close(); }
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyGradesEditor = {
        mount: mount,
        unmount: unmount,
        refresh: refresh
    };

})();
