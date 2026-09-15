/**
 * modules/academy/academy-grades-editor.js - Academy Inline Grades Editor
 * Inline editor for a single character's grades within a class.
 *
 * Path: js/modules/academy/academy-grades-editor.js
 *
 * RESPONSIBILITIES:
 *   - Render the grades table for a (character, class) pair
 *   - Render the Add Grade form and Edit Grade modal
 *   - Render the Delete Grade confirmation modal
 *   - Wire per-row Edit / Delete buttons via container delegation
 *   - Route every mutation through AcademyGrades (Promise-based)
 *   - Convert percentages to the discipline's grading scheme for
 *     display (percentage remains the source of truth)
 *
 * NOT RESPONSIBILITIES:
 *   - Domain validation. AcademyGrades validates.
 *   - Notifications. The pipeline notifies.
 *   - Persistence. The pipeline persists.
 *
 * LIFECYCLE:
 *   mount(container, charId, classId, week)
 *   refresh()  — re-render after a mutation succeeds
 *   unmount(container) — remove listeners
 *
 * CLASS + WEEK CONTEXT:
 *   The class and week are FIXED at mount time. Changing class or week
 *   requires a re-mount. The editor does not track UI state changes
 *   on its own; the caller (AcademyView) owns that.
 *
 * GRADE SCHEME:
 *   Grades are stored as percentages (score + maxScore). The scheme is
 *   a display layer. It is read from AcademyDisciplines.getGradeScheme,
 *   which normalizes on read.
 *
 * ENROLLMENT:
 *   The discipline picker sources its options from the student's
 *   enrollment for the selected class via AcademyEnrolments. Enrollment
 *   is class-scoped. character.disciplineIds is not read.
 *
 * WEEK SEMANTICS:
 *   Weeks are parsed via ValidationUtils.parseStrictPositiveInteger and
 *   bounded by CalendarConstants.MIN_WEEK / MAX_WEEK. No silent
 *   coercion of "12garbage" to 12.
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal returns a bare .modal shell. The modal content
 *   helper here appends a fresh .modal-content wrapper, matching the
 *   pattern used by the rest of the Academy shell.
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
 * DEPENDENCIES (OPTIONAL, used for display only):
 *   - window.CharacterQueries
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
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK / MAX_WEEK');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyGradesEditor] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyGradesEditorLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSOR
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var DEFAULT_MAX_SCORE = 100;
    var DEFAULT_GRADE_TYPE = 'assignment';

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

    /**
     * Get the normalized grade scheme for a discipline.
     * AcademyDisciplines.getGradeScheme normalizes on read; this
     * helper is a thin wrapper that also handles the missing-discipline
     * case.
     */
    function getSchemeForDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return GradeSchemes.normalizeScheme(null);
        }
        return AcademyDisciplines.getGradeScheme(disciplineId);
    }

    /**
     * Get the numeric percentage of a grade.
     * Prefers the derived `percentage` field when present; falls back
     * to computing from score / maxScore.
     */
    function getGradePercentage(grade) {
        if (!grade) { return null; }
        if (isFiniteNumber(grade.percentage)) { return grade.percentage; }

        var score = parseFiniteNumber(grade.score);
        var max = parseFiniteNumber(grade.maxScore);
        if (score === null || max === null || max <= 0) { return null; }
        return Math.round((score / max) * 100);
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

    function buildLabelPreview(score, scheme) {
        if (!isFiniteNumber(score)) { return ''; }
        return GradeSchemes.getGradeDisplay(scheme, score);
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

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) { cancelBtn.addEventListener('click', close); }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { close(); }
        });
    }

    // ============================================================
    // ENROLLMENT PICKER
    // ============================================================

    /**
     * Get the discipline options from the student's enrollment for a
     * class. Returns an array of { id, name, activeThisWeek }.
     * Enrollment is class-scoped; the source of truth is AcademyEnrolments.
     */
    function getEnrolledDisciplineOptions(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return [];
        }

        var enrolledIds = AcademyEnrolments.getStudentDisciplines(studentId, classId);
        if (!Array.isArray(enrolledIds) || enrolledIds.length === 0) {
            return [];
        }

        var weekNum = parseStrictWeek(week);
        var options = [];

        for (var i = 0; i < enrolledIds.length; i++) {
            var id = enrolledIds[i];
            if (!isNonEmptyString(id)) { continue; }

            var discipline = AcademyDisciplines.getDiscipline(id);
            if (!discipline) { continue; }

            var activeThisWeek = true;
            if (weekNum !== null) {
                var startWeek = ValidationUtils.parseStrictPositiveInteger(discipline.startWeek);
                var endWeek = ValidationUtils.parseStrictPositiveInteger(discipline.endWeek);
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
                activeThisWeek: activeThisWeek
            });
        }

        options.sort(function(a, b) {
            if (a.activeThisWeek && !b.activeThisWeek) { return -1; }
            if (!a.activeThisWeek && b.activeThisWeek) { return 1; }
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
    }

    function refresh() {
        if (!_state.container || !_state.charId) {
            return;
        }
        render();
    }

    // ============================================================
    // RENDER — TABLE
    // ============================================================

    function render() {
        if (!_state.container) { return; }

        var charId = _state.charId;
        var classId = _state.classId;

        var grades;
        if (classId) {
            grades = AcademyGrades.getStudentClassGrades(charId, classId) || [];
        } else {
            grades = AcademyGrades.getStudentGrades(charId) || [];
        }

        grades = grades.slice().sort(function(a, b) {
            var wa = parseStrictWeek(a.week) || 0;
            var wb = parseStrictWeek(b.week) || 0;
            if (wa !== wb) { return wa - wb; }
            return String(a.date || '').localeCompare(String(b.date || ''));
        });

        var html = '';
        html += '<div class="academy-grades-editor">';

        html += '<div class="academy-grades-editor-header">';
        html += '<h4 class="academy-grades-editor-title">Grades</h4>';
        html += '<button type="button" ' +
                    'class="primary small academy-add-grade-btn" ' +
                    'data-action="add-grade">' +
                    '+ Add Grade' +
                '</button>';
        html += '</div>';

        if (grades.length === 0) {
            html += '<p class="empty-state small">' +
                        'No grades recorded for this character in this class.' +
                    '</p>';
            html += '</div>';
            _state.container.innerHTML = html;
            return;
        }

        html += '<div class="academy-grades-editor-table-wrapper">';
        html += '<table class="academy-grades-editor-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th class="week-col">Week</th>';
        html += '<th class="discipline-col">Discipline</th>';
        html += '<th class="type-col">Type</th>';
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

        // Summary line
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

    function renderGradeRow(grade) {
        var percentage = getGradePercentage(grade);
        var scoreClass = getScoreClass(percentage);
        var disciplineName = getDisciplineName(grade.disciplineId);
        var scheme = getSchemeForDiscipline(grade.disciplineId);
        var scoreDisplay = formatScoreDisplay(grade, scheme);

        var typeLabel = isNonEmptyString(grade.type)
            ? grade.type
            : DEFAULT_GRADE_TYPE;
        var weekLabel = grade.week !== undefined && grade.week !== null
            ? String(grade.week)
            : '\u2014';

        var html = '';
        html += '<tr class="academy-grades-editor-row" ' +
                    'data-grade-id="' + escapeAttribute(grade.id || '') + '">';
        html += '<td class="week-col">' + escapeHtml(weekLabel) + '</td>';
        html += '<td class="discipline-col">' + escapeHtml(disciplineName) + '</td>';
        html += '<td class="type-col">' + escapeHtml(typeLabel) + '</td>';
        html += '<td class="score-col">' +
                    '<span class="' + scoreClass + '">' +
                        escapeHtml(scoreDisplay) +
                    '</span>' +
                '</td>';
        html += '<td class="actions-col">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="edit-grade" ' +
                    'data-grade-id="' + escapeAttribute(grade.id || '') + '">' +
                    'Edit' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="delete-grade" ' +
                    'data-grade-id="' + escapeAttribute(grade.id || '') + '">' +
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

        switch (action) {
            case 'add-grade':
                e.preventDefault();
                openGradeForm(null);
                return;
            case 'edit-grade':
                e.preventDefault();
                if (gradeId) { openGradeForm(gradeId); }
                return;
            case 'delete-grade':
                e.preventDefault();
                if (gradeId) { confirmDeleteGrade(gradeId); }
                return;
            default:
                return;
        }
    }

    // ============================================================
    // ADD / EDIT GRADE FORM
    // ============================================================

    function openGradeForm(gradeId) {
        var existing = null;
        if (gradeId) {
            existing = AcademyGrades.getGrade(gradeId);
            if (!existing) {
                notify('Grade not found.', 'error');
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
            : [DEFAULT_GRADE_TYPE];

        var modal = openModalShell('academy-grade-form-modal');
        if (!modal) { return; }

        // Initial discipline:
        //   - Edit mode: the grade's own discipline.
        //   - Create mode: first active enrollment, if any.
        var initialDisciplineId = g.disciplineId || null;
        if (!initialDisciplineId) {
            for (var i = 0; i < disciplineOptions.length; i++) {
                if (disciplineOptions[i].activeThisWeek) {
                    initialDisciplineId = disciplineOptions[i].id;
                    break;
                }
            }
        }

        var initialScheme = getSchemeForDiscipline(initialDisciplineId);

        var initialScore = (g.score !== undefined && g.score !== null)
            ? g.score
            : '';
        var initialPreview = '';
        var initialScoreNum = parseFiniteNumber(initialScore);
        if (initialScoreNum !== null) {
            initialPreview = buildLabelPreview(initialScoreNum, initialScheme);
        }

        var hasEnrollment = disciplineOptions.length > 0;
        var hasActiveEnrollment = false;
        for (var k = 0; k < disciplineOptions.length; k++) {
            if (disciplineOptions[k].activeThisWeek) {
                hasActiveEnrollment = true;
                break;
            }
        }

        var html = '';
        html += '<form id="academy-grade-form" ' +
                    'data-edit-id="' +
                        (isEdit ? escapeAttribute(existing.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Grade' : 'Add Grade') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // Discipline picker.
        html += '<div class="form-group">';
        html += '<label for="ag-disc-select">Discipline *</label>';
        html += '<select id="ag-disc-select" class="ag-disc-select" required>';

        if (!hasEnrollment) {
            html += '<option value="">' +
                        'Not enrolled in any disciplines for this class' +
                    '</option>';
        } else {
            html += '<option value="">Select a discipline...</option>';
            for (var d = 0; d < disciplineOptions.length; d++) {
                var opt = disciplineOptions[d];
                var selected = String(opt.id) === String(initialDisciplineId)
                    ? ' selected'
                    : '';
                var disabled = opt.activeThisWeek ? '' : ' disabled';
                var suffix = opt.activeThisWeek ? '' : ' (not active this week)';
                html += '<option value="' + escapeAttribute(opt.id) + '"' +
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
        } else if (!hasActiveEnrollment) {
            html += '<p class="field-hint">' +
                        'None of this student\'s enrolled disciplines are ' +
                        'active during week ' +
                        escapeHtml(String(_state.week)) + '.' +
                    '</p>';
        }

        html += '</div>';

        // Type.
        html += '<div class="form-group">';
        html += '<label for="ag-type-select">Type</label>';
        html += '<select id="ag-type-select" class="ag-type-select">';
        for (var t = 0; t < validTypes.length; t++) {
            var type = validTypes[t];
            var tSel = (g.type || DEFAULT_GRADE_TYPE) === type ? ' selected' : '';
            html += '<option value="' + escapeAttribute(type) + '"' + tSel + '>' +
                        escapeHtml(type.charAt(0).toUpperCase() + type.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '<p class="field-hint">' +
                    'Weight comes from the discipline\'s assessment setup.' +
                '</p>';
        html += '</div>';

        // Week.
        html += '<div class="form-group">';
        html += '<label for="ag-week-input">Week *</label>';
        html += '<input type="number" id="ag-week-input" class="ag-week-input" ' +
                    'value="' + escapeAttribute(String(
                        g.week !== undefined && g.week !== null
                            ? g.week
                            : _state.week
                    )) + '" ' +
                    'min="' + escapeAttribute(String(MIN_WEEK)) + '" ' +
                    'max="' + escapeAttribute(String(MAX_WEEK)) + '" required>';
        html += '</div>';

        // Score / Max score.
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

        // Live label preview.
        html += '<div class="form-group ag-grade-preview-group">';
        html += '<span class="ag-grade-preview-label">Converted:</span> ';
        html += '<span id="ag-grade-preview" class="ag-grade-preview">' +
                    escapeHtml(initialPreview || '\u2014') +
                '</span>';
        html += '</div>';

        // Date.
        html += '<div class="form-group">';
        html += '<label for="ag-date-input">Date</label>';
        html += '<input type="date" id="ag-date-input" class="ag-date-input" ' +
                    'value="' + escapeAttribute(g.date || '') + '">';
        html += '</div>';

        // Notes.
        html += '<div class="form-group">';
        html += '<label for="ag-notes-input">Notes</label>';
        html += '<textarea id="ag-notes-input" class="ag-notes-input" ' +
                    'rows="2">' +
                    escapeHtml(g.notes || '') +
                '</textarea>';
        html += '</div>';

        // Actions.
        var submitDisabled = (!hasEnrollment || !hasActiveEnrollment)
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
        bindGradeFormEvents(modal, existing);
    }

    function bindGradeFormEvents(modal, existing) {
        var close = function() {
            closeModal(modal);
        };

        bindCommonModalControls(modal, close);

        var form = modal.querySelector('#academy-grade-form');
        if (!form) { return; }

        var discInput = form.querySelector('.ag-disc-select');
        var scoreInput = form.querySelector('.ag-score-input');
        var previewEl = form.querySelector('#ag-grade-preview');

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

            var preview = buildLabelPreview(score, scheme);
            previewEl.textContent = preview || '\u2014';
        }

        if (scoreInput) {
            scoreInput.addEventListener('input', updatePreview);
        }
        if (discInput) {
            discInput.addEventListener('change', updatePreview);
        }

        form.addEventListener('submit', function(e) {
            e.preventDefault();

            var typeInput = form.querySelector('.ag-type-select');
            var weekInput = form.querySelector('.ag-week-input');
            var maxInput = form.querySelector('.ag-max-score-input');
            var dateInput = form.querySelector('.ag-date-input');
            var notesInput = form.querySelector('.ag-notes-input');

            var disciplineId = discInput ? discInput.value : '';
            var week = weekInput ? parseStrictWeek(weekInput.value) : null;
            var score = scoreInput ? parseFiniteNumber(scoreInput.value) : null;
            var maxScore = maxInput && maxInput.value !== ''
                ? parseFiniteNumber(maxInput.value)
                : DEFAULT_MAX_SCORE;

            if (!disciplineId) {
                notify('Please select a discipline.', 'error');
                return;
            }
            if (week === null) {
                notify('Week must be between ' + MIN_WEEK +
                    ' and ' + MAX_WEEK + '.', 'error');
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

            var payload = {
                studentId: _state.charId,
                classId: _state.classId,
                disciplineId: disciplineId,
                week: week,
                score: score,
                maxScore: maxScore,
                type: typeInput ? typeInput.value : DEFAULT_GRADE_TYPE,
                date: dateInput ? dateInput.value : undefined,
                notes: notesInput ? notesInput.value.trim() : ''
            };

            var promise;
            if (existing && existing.id) {
                promise = AcademyGrades.update(existing.id, payload);
            } else {
                promise = AcademyGrades.create(payload);
            }

            promise.then(function(result) {
                if (result && result.success) {
                    close();
                    refresh();
                }
                // On failure, the pipeline has already notified.
                // Modal stays open so the user can retry.
            }).catch(function(err) {
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

        var disciplineName = getDisciplineName(grade.disciplineId);
        var scheme = getSchemeForDiscipline(grade.disciplineId);
        var scoreDisplay = formatScoreDisplay(grade, scheme);

        var modal = openModalShell('academy-grade-delete-modal');
        if (!modal) { return; }

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
                ' \u2014 Week ' + escapeHtml(String(grade.week)) +
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

        var close = function() {
            closeModal(modal);
        };

        bindCommonModalControls(modal, close);

        var form = modal.querySelector('#academy-grade-delete-form');
        if (!form) { return; }

        form.addEventListener('submit', function(e) {
            e.preventDefault();

            AcademyGrades.delete(gradeId).then(function(result) {
                if (result && result.success) {
                    close();
                    refresh();
                }
            }).catch(function(err) {
                console.warn('[AcademyGradesEditor] Delete failed:', err);
                notify('Failed to delete grade.', 'error');
            });
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyGradesEditor = {
        mount: mount,
        unmount: unmount,
        refresh: refresh,
        render: render
    };

})();
