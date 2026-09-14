/**
 * modules/academy/academy-grades-editor.js - Academy Inline Grades Editor
 * Inline editor for a single character's grades within a class + week.
 *
 * Path: js/modules/academy/academy-grades-editor.js
 *
 * This module is responsible for:
 *   - Rendering the grades editor (table + add form)
 *   - Wiring per-row Edit / Delete buttons
 *   - Wiring the Add Grade form
 *   - Delegating to AcademyGrades for all mutations
 *   - Converting percentages to the discipline's grading scheme label
 *     for display (percentage remains the source of truth)
 *
 * IMPORTANT:
 *   - RENDER + WIRE - all mutations go through AcademyGrades.
 *   - AcademyGrades mutations are Promise-based and route through
 *     MutationPipeline. The pipeline owns persistence and notification.
 *   - This module uses container-level delegation for all row actions
 *     so re-renders do not leak listeners.
 *   - This module is designed to be MOUNTED into an existing container,
 *     not to replace the whole Academy view. It's the inline grades
 *     section of the character detail panel.
 *   - The class context (classId) is fixed when the editor is rendered.
 *     Changing class must re-mount.
 *
 * GRADE SCHEME SEMANTICS:
 *   - Grades are stored as percentages (score + maxScore). The scheme
 *     is a DISPLAY layer only.
 *   - Non-numeric schemes render as "85% (B)". Numeric schemes render
 *     as "85%".
 *   - The scheme used is the one attached to the grade's discipline.
 *     If a discipline has no scheme (legacy data), the numeric default
 *     applies and no suffix is shown.
 *   - The add/edit modal shows a live preview of the label as the user
 *     types the score.
 *
 * WEIGHT MODEL (Phase 3):
 *   - Grades NO LONGER carry a weight. Weight is a property of the
 *     assessment type within a discipline, not of the individual grade.
 *   - The weight input has been REMOVED from the add/edit modal.
 *   - The Grade table does not display a weight column.
 *
 * ENROLLMENT MODEL (Phase 3):
 *   - The discipline picker in the add/edit modal is sourced from the
 *     student's enrollment for the selected class, not from all
 *     available disciplines.
 *   - Enrollment lives on character.disciplineIds.
 *   - The class context matters: a student may be enrolled in different
 *     disciplines across different classes. The picker shows the union
 *     of what the student is enrolled in, filtered to disciplines that
 *     are active during the editor's week.
 *   - When the student has no enrollment for the class, the picker
 *     shows an empty state and the submit is disabled.
 *
 * DERIVED FIELDS (Phase 3):
 *   - `percentage` and `passing` are derived by AcademyGrades on read,
 *     not stored. The editor reads them via AcademyGrades' decorator
 *     when it needs them for display.
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal may return a bare `.modal` shell or one that
 *   already contains a `.modal-content`. Both openers in this file
 *   reuse an existing wrapper if present, and append one otherwise.
 *
 * LIFECYCLE:
 *   mount(container, charId, classId, week)  → render + bind
 *   refresh()                                 → re-render only
 *   unmount(container)                        → remove listeners
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.AcademyGrades (MANDATORY)
 *   - window.AcademyDisciplines (MANDATORY)
 *   - window.AcademyGradeSchemes (MANDATORY)
 *   - window.CharacterQueries (MANDATORY)
 *   - window.NotificationSystem (MANDATORY)
 *   - window.Modal (MANDATORY)
 *
 * USAGE:
 *   var GE = window.AcademyGradesEditor;
 *   GE.mount(document.getElementById('academy-grades-editor-host'),
 *             'char_123', 'class_456', 5);
 */

(function() {
    'use strict';

    if (window.__academyGradesEditorLoaded) {
        return;
    }
    window.__academyGradesEditorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;
    var AcademyGrades = window.AcademyGrades;
    var AcademyDisciplines = window.AcademyDisciplines;
    var GradeSchemes = window.AcademyGradeSchemes;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var Modal = window.Modal;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!AcademyGrades || typeof AcademyGrades.getStudentClassGrades !== 'function') {
            missing.push('AcademyGrades.getStudentClassGrades');
        }
        if (!AcademyGrades || typeof AcademyGrades.create !== 'function') {
            missing.push('AcademyGrades.create');
        }
        if (!AcademyGrades || typeof AcademyGrades.update !== 'function') {
            missing.push('AcademyGrades.update');
        }
        if (!AcademyGrades || typeof AcademyGrades.delete !== 'function') {
            missing.push('AcademyGrades.delete');
        }
        if (!AcademyGrades || typeof AcademyGrades.getGrade !== 'function') {
            missing.push('AcademyGrades.getGrade');
        }
        if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
            missing.push('AcademyDisciplines.getDiscipline');
        }
        if (!AcademyDisciplines || typeof AcademyDisciplines.getGradeScheme !== 'function') {
            missing.push('AcademyDisciplines.getGradeScheme');
        }
        if (!GradeSchemes || typeof GradeSchemes.getGradeDisplay !== 'function') {
            missing.push('AcademyGradeSchemes.getGradeDisplay');
        }
        if (!GradeSchemes || typeof GradeSchemes.getLabelForScore !== 'function') {
            missing.push('AcademyGradeSchemes.getLabelForScore');
        }
        if (!GradeSchemes || typeof GradeSchemes.isNumericScheme !== 'function') {
            missing.push('AcademyGradeSchemes.isNumericScheme');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }
        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (missing.length > 0) {
            console.warn('[AcademyGradesEditor] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value);
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

    function getDisciplineName(disciplineId) {
        if (!disciplineId) { return 'Unknown'; }
        var d = AcademyDisciplines.getDiscipline(disciplineId);
        return d && d.name ? d.name : 'Unknown';
    }

    /**
     * Look up a discipline's grade scheme. Returns the normalized
     * numeric default when the discipline is missing or has no scheme.
     * Never returns null.
     */
    function getSchemeForDiscipline(disciplineId) {
        if (!disciplineId) {
            return GradeSchemes.normalizeScheme(null);
        }
        return AcademyDisciplines.getGradeScheme(disciplineId);
    }

    /**
     * Get the numeric percentage of a grade. Prefers the derived
     * `percentage` field when present; falls back to computing from
     * score / maxScore.
     */
    function getGradePercentage(grade) {
        if (!grade) { return null; }
        if (isFiniteNumber(grade.percentage)) { return grade.percentage; }
        if (isFiniteNumber(grade.score) && isFiniteNumber(grade.maxScore) && grade.maxScore > 0) {
            return Math.round((grade.score / grade.maxScore) * 100);
        }
        return null;
    }

    /**
     * Format a grade's score for display, using the discipline's scheme.
     *   - Numeric scheme: '85%'
     *   - Letter/PF/etc:  '85% (B)'
     *   - Missing score:  '—'
     */
    function formatScoreDisplay(grade, scheme) {
        var pct = getGradePercentage(grade);
        if (pct === null) { return '\u2014'; }
        return GradeSchemes.getGradeDisplay(scheme, pct);
    }

    function getScoreClass(percentage) {
        if (!isFiniteNumber(percentage)) {
            return 'academy-grade-score academy-grade-score-unknown';
        }
        if (percentage >= 90) return 'academy-grade-score academy-grade-score-excellent';
        if (percentage >= 80) return 'academy-grade-score academy-grade-score-good';
        if (percentage >= 70) return 'academy-grade-score academy-grade-score-passing';
        return 'academy-grade-score academy-grade-score-failing';
    }

    /**
     * Build a preview string for a score under a scheme.
     * Numeric scheme → '85%'. Non-numeric → '85% (B)'.
     */
    function buildLabelPreview(score, scheme) {
        if (!isFinite(score)) { return ''; }
        if (!GradeSchemes.isNumericScheme(scheme)) {
            var label = GradeSchemes.getLabelForScore(scheme, score);
            if (label) {
                return score + '% (' + label + ')';
            }
        }
        return score + '%';
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    function attachModalContent(modal, html) {
        if (!modal) return;

        var contentEl = modal.querySelector('.modal-content');
        if (!contentEl) {
            contentEl = document.createElement('div');
            contentEl.className = 'modal-content';
            modal.appendChild(contentEl);
        }
        contentEl.innerHTML = html;
    }

    // ============================================================
    // ENROLLMENT PICKER (Phase 3)
    // ============================================================
    //
    // The discipline picker is sourced from the student's enrollment
    // for the class context. Enrollment lives on character.disciplineIds.
    //
    // The picker is filtered to disciplines that are active during the
    // editor's week. A student enrolled in a discipline that runs in
    // weeks 1-10 cannot be graded in that discipline during week 20.

    /**
     * Get the list of disciplines the student is enrolled in that are
     * also active during the given week.
     *
     * Returns entries of the form { id, name, activeThisWeek }.
     *
     * Disciplines the student is enrolled in but that are NOT active
     * this week are still returned, with activeThisWeek: false, so the
     * picker can render them as disabled rather than silently omitting
     * them. That makes the state visible: "you are enrolled in X but
     * X doesn't run this week".
     *
     * @param {string} studentId - Student ID
     * @param {number} week - Editor's week
     * @returns {array}
     */
    function getEnrolledDisciplineOptions(studentId, week) {
        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return [];
        }

        var enrolledIds = Array.isArray(student.disciplineIds)
            ? student.disciplineIds
            : [];

        if (enrolledIds.length === 0) {
            return [];
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) {
            weekNum = null;
        }

        var options = [];
        for (var i = 0; i < enrolledIds.length; i++) {
            var id = enrolledIds[i];
            if (!isNonEmptyString(id)) { continue; }

            var discipline = AcademyDisciplines.getDiscipline(id);
            if (!discipline) {
                // Enrolled in something that no longer exists. Skip.
                continue;
            }

            var activeThisWeek = true;
            if (weekNum !== null) {
                var startWeek = parseInt(discipline.startWeek, 10);
                var endWeek = parseInt(discipline.endWeek, 10);
                if (!isNaN(startWeek) && weekNum < startWeek) {
                    activeThisWeek = false;
                }
                if (!isNaN(endWeek) && weekNum > endWeek) {
                    activeThisWeek = false;
                }
            }

            options.push({
                id: discipline.id,
                name: discipline.name || 'Unnamed Discipline',
                activeThisWeek: activeThisWeek
            });
        }

        // Sort: active first, then alphabetical.
        options.sort(function(a, b) {
            if (a.activeThisWeek && !b.activeThisWeek) { return -1; }
            if (!a.activeThisWeek && b.activeThisWeek) { return 1; }
            return (a.name || '').localeCompare(b.name || '');
        });

        return options;
    }

    // ============================================================
    // STATE - one active editor per host element
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
    // MOUNT / UNMOUNT
    // ============================================================

    function mount(container, charId, classId, week) {
        if (!checkDependencies()) {
            if (container) {
                container.innerHTML =
                    '<p class="empty-state small">Grades editor dependencies not loaded.</p>';
            }
            return;
        }

        if (!container) {
            console.warn('[AcademyGradesEditor] mount requires a container');
            return;
        }

        if (!charId) {
            container.innerHTML =
                '<p class="empty-state small">No character selected.</p>';
            return;
        }

        // Unmount any previous editor bound to this container.
        unmount(container);

        _state.container = container;
        _state.charId = String(charId);
        _state.classId = classId ? String(classId) : null;
        _state.week = isFiniteNumber(week) ? week : 1;

        render();

        // Delegation on the container. The editor's content is
        // re-rendered frequently; a single delegated listener on the
        // host survives every innerHTML swap.
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
    // RENDER
    // ============================================================

    function render() {
        if (!_state.container) { return; }

        var charId = _state.charId;
        var classId = _state.classId;

        // Fetch grades scoped to this student AND this class.
        // Phase 3: getStudentClassGrades is the class-scoped query.
        // Before Phase 3, this used getStudentGrades and filtered
        // client-side. Now the filter happens at the source.
        var grades;
        if (classId) {
            grades = AcademyGrades.getStudentClassGrades(charId, classId) || [];
        } else {
            // No class context. Fall back to all student grades.
            // This shouldn't normally happen: the editor is always
            // mounted with a class context. But if it does, showing
            // the student's grades is better than showing nothing.
            grades = AcademyGrades.getStudentGrades(charId) || [];
        }

        // Sort by week asc, then date.
        grades = grades.slice().sort(function(a, b) {
            var wa = parseInt(a.week, 10) || 0;
            var wb = parseInt(b.week, 10) || 0;
            if (wa !== wb) { return wa - wb; }
            return String(a.date || '').localeCompare(String(b.date || ''));
        });

        var html = '';
        html += '<div class="academy-grades-editor">';

        // Header
        html += '<div class="academy-grades-editor-header">';
        html += '<h4 class="academy-grades-editor-title">Grades</h4>';
        html += '<button type="button" class="primary small academy-add-grade-btn" ' +
                    'data-action="add-grade">+ Add Grade</button>';
        html += '</div>';

        if (grades.length === 0) {
            html += '<p class="empty-state small">No grades recorded for this character in this class.</p>';
            html += '</div>';
            _state.container.innerHTML = html;
            return html;
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

        html += '</div>';

        _state.container.innerHTML = html;
        return html;
    }

    function renderGradeRow(grade) {
        var percentage = getGradePercentage(grade);
        var scoreClass = getScoreClass(percentage);
        var disciplineName = getDisciplineName(grade.disciplineId);

        // Look up the scheme for this discipline and format the score.
        var scheme = getSchemeForDiscipline(grade.disciplineId);
        var scoreDisplay = formatScoreDisplay(grade, scheme);

        var typeLabel = isNonEmptyString(grade.type) ? grade.type : 'assignment';
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
                    'data-grade-id="' + escapeAttribute(grade.id || '') + '">Edit</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="delete-grade" ' +
                    'data-grade-id="' + escapeAttribute(grade.id || '') + '">Delete</button>';
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
    // ADD / EDIT GRADE MODAL
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

        // ---- Discipline picker: enrollment-sourced (Phase 3) ----
        var disciplineOptions = getEnrolledDisciplineOptions(_state.charId, _state.week);

        var validTypes = (AcademyGrades.VALID_GRADE_TYPES) || [
            'exam', 'assignment', 'participation', 'project', 'quiz', 'final'
        ];

        var modal = Modal.createModal('academy-grade-form-modal');
        if (!modal) {
            notify('Could not create modal.', 'error');
            return;
        }

        // Determine the initial discipline selection.
        //   - Edit mode: the grade's own discipline.
        //   - Create mode: the first active discipline, if any.
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

        var initialScore = (g.score !== undefined && g.score !== null) ? g.score : '';
        var initialPreview = '';
        if (initialScore !== '' && !isNaN(parseFloat(initialScore))) {
            initialPreview = buildLabelPreview(parseFloat(initialScore), initialScheme);
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
        html += '<form id="academy-grade-form" data-edit-id="' +
                    (isEdit ? escapeAttribute(existing.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Grade' : 'Add Grade') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // ---- Discipline picker ----
        html += '<div class="form-group">';
        html += '<label for="ag-disc-select">Discipline *</label>';
        html += '<select id="ag-disc-select" class="ag-disc-select" required>';

        if (!hasEnrollment) {
            html += '<option value="">Not enrolled in any disciplines for this class</option>';
        } else {
            html += '<option value="">Select a discipline...</option>';
            for (var d = 0; d < disciplineOptions.length; d++) {
                var opt = disciplineOptions[d];
                var selected = String(opt.id) === String(initialDisciplineId) ? ' selected' : '';
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
                        'This student is not enrolled in any disciplines. ' +
                        'Enroll them in a discipline before adding grades.' +
                    '</p>';
        } else if (!hasActiveEnrollment) {
            html += '<p class="field-hint">' +
                        'None of this student\'s enrolled disciplines are active during week ' +
                        escapeHtml(String(_state.week)) + '.' +
                    '</p>';
        } else if (isEdit) {
            html += '<p class="field-hint">' +
                        'Changing the discipline moves this grade to that discipline\'s scheme.' +
                    '</p>';
        }

        html += '</div>';

        // ---- Type ----
        html += '<div class="form-group">';
        html += '<label for="ag-type-select">Type</label>';
        html += '<select id="ag-type-select" class="ag-type-select">';
        for (var t = 0; t < validTypes.length; t++) {
            var type = validTypes[t];
            var tSel = (g.type || 'assignment') === type ? ' selected' : '';
            html += '<option value="' + escapeAttribute(type) + '"' + tSel + '>' +
                        escapeHtml(type.charAt(0).toUpperCase() + type.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '<p class="field-hint">Weight comes from the discipline\'s assessment setup.</p>';
        html += '</div>';

        // ---- Week ----
        html += '<div class="form-group">';
        html += '<label for="ag-week-input">Week *</label>';
        html += '<input type="number" id="ag-week-input" class="ag-week-input" ' +
                    'value="' + escapeAttribute(String(g.week !== undefined && g.week !== null ? g.week : _state.week)) + '" ' +
                    'min="1" max="52" required>';
        html += '</div>';

        // ---- Score / Max score ----
        html += '<div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        html += '<div class="form-group">';
        html += '<label for="ag-score-input">Score *</label>';
        html += '<input type="number" step="0.1" id="ag-score-input" class="ag-score-input" ' +
                    'value="' + escapeAttribute(initialScore) + '" ' +
                    'min="0" required>';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label for="ag-max-score-input">Max Score</label>';
        html += '<input type="number" step="0.1" id="ag-max-score-input" class="ag-max-score-input" ' +
                    'value="' + escapeAttribute(g.maxScore !== undefined && g.maxScore !== null ? String(g.maxScore) : '100') + '" ' +
                    'min="1">';
        html += '</div>';
        html += '</div>';

        // ---- Live label preview ----
        html += '<div class="form-group ag-grade-preview-group">';
        html += '<span class="ag-grade-preview-label">Converted:</span> ';
        html += '<span id="ag-grade-preview" class="ag-grade-preview">' +
                    escapeHtml(initialPreview || '\u2014') +
                '</span>';
        html += '</div>';

        // NOTE: Weight input has been REMOVED. Grades do not carry weight.

        // ---- Date ----
        html += '<div class="form-group">';
        html += '<label for="ag-date-input">Date</label>';
        html += '<input type="date" id="ag-date-input" class="ag-date-input" ' +
                    'value="' + escapeAttribute(g.date || '') + '">';
        html += '</div>';

        // ---- Notes ----
        html += '<div class="form-group">';
        html += '<label for="ag-notes-input">Notes</label>';
        html += '<textarea id="ag-notes-input" class="ag-notes-input" rows="2">' +
                    escapeHtml(g.notes || '') +
                '</textarea>';
        html += '</div>';

        // ---- Actions ----
        var submitDisabled = (!hasEnrollment || !hasActiveEnrollment) ? ' disabled' : '';
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary"' + submitDisabled + '>' +
                    (isEdit ? 'Update Grade' : 'Add Grade') +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        attachModalContent(modal, html);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        bindGradeFormEvents(modal, existing);
    }

    function bindGradeFormEvents(modal, existing) {
        var closeModal = function() {
            try {
                if (Modal && typeof Modal.closeModal === 'function') {
                    Modal.closeModal(modal);
                }
            } catch (e) {
                // Ignore
            }
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        };

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) { closeBtn.addEventListener('click', closeModal); }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) { cancelBtn.addEventListener('click', closeModal); }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { closeModal(); }
        });

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
            var score = parseFloat(rawScore);

            if (rawScore === '' || isNaN(score)) {
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
            var week = weekInput ? parseInt(weekInput.value, 10) : NaN;
            var score = scoreInput ? parseFloat(scoreInput.value) : NaN;
            var maxScore = maxInput && maxInput.value ? parseFloat(maxInput.value) : 100;

            if (!disciplineId) {
                notify('Please select a discipline.', 'error');
                return;
            }
            if (isNaN(week) || week < 1 || week > 52) {
                notify('Week must be between 1 and 52.', 'error');
                return;
            }
            if (isNaN(score)) {
                notify('Score is required and must be a number.', 'error');
                return;
            }
            if (isNaN(maxScore) || maxScore <= 0) {
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
                type: typeInput ? typeInput.value : 'assignment',
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
                    closeModal();
                    refresh();
                }
                // On failure, MutationPipeline already notified.
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

        var modal = Modal.createModal('academy-grade-delete-modal');
        if (!modal) {
            notify('Could not create modal.', 'error');
            return;
        }

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
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Grade</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';

        attachModalContent(modal, html);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var closeModal = function() {
            try {
                if (Modal && typeof Modal.closeModal === 'function') {
                    Modal.closeModal(modal);
                }
            } catch (e) {
                // Ignore
            }
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        };

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) { closeBtn.addEventListener('click', closeModal); }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) { cancelBtn.addEventListener('click', closeModal); }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { closeModal(); }
        });

        var form = modal.querySelector('#academy-grade-delete-form');
        if (!form) { return; }

        form.addEventListener('submit', function(e) {
            e.preventDefault();

            AcademyGrades.delete(gradeId).then(function(result) {
                if (result && result.success) {
                    closeModal();
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

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyGradesEditor;
        var missing = [];

        var required = ['mount', 'unmount', 'refresh', 'render'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyGradesEditor] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
