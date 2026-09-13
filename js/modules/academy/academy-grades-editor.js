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
 * LIFECYCLE:
 *   mount(container, charId, classId, week)  → render + bind
 *   refresh()                                 → re-render only
 *   unmount(container)                        → remove listeners
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.AcademyGrades (MANDATORY)
 *   - window.AcademyQueries (MANDATORY)
 *   - window.CharacterQueries (MANDATORY)
 *   - window.DisciplineQueries (MANDATORY)
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
    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
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
        if (!AcademyGrades || typeof AcademyGrades.getStudentGrades !== 'function') {
            missing.push('AcademyGrades.getStudentGrades');
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
        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
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
        var d = DisciplineQueries.getDiscipline(disciplineId);
        return d && d.name ? d.name : 'Unknown';
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

    function getGradePercentage(grade) {
        if (!grade) { return null; }
        if (isFiniteNumber(grade.percentage)) { return grade.percentage; }
        if (isFiniteNumber(grade.score) && isFiniteNumber(grade.maxScore) && grade.maxScore > 0) {
            return Math.round((grade.score / grade.maxScore) * 100);
        }
        return null;
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

    /**
     * Mount the grades editor into a host container.
     *
     * @param {HTMLElement} container - Host element
     * @param {string} charId - Character ID
     * @param {string} classId - Class context (grades are scoped here)
     * @param {number} week - Week to show
     */
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

        // Delegation on the container. The editor's content is re-rendered
        // frequently; a single delegated listener on the host survives
        // every innerHTML swap.
        if (!_state.listening) {
            _delegatedHandler = function(e) {
                handleDelegatedClick(e);
            };
            container.addEventListener('click', _delegatedHandler);
            _state.listening = true;
        }
    }

    /**
     * Unmount the editor from a specific container (or the current one).
     *
     * @param {HTMLElement} [container] - Container to detach from. If
     *        omitted, detaches from the current _state.container.
     */
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

    /**
     * Re-render using the current state.
     */
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
        var week = _state.week;

        // Fetch all grades for this student; the editor shows all weeks
        // and class-scopes the add/edit form.
        var allGrades = AcademyGrades.getStudentGrades(charId) || [];

        // Sort by week asc, then date.
        allGrades = allGrades.slice().sort(function(a, b) {
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

        if (allGrades.length === 0) {
            html += '<p class="empty-state small">No grades recorded for this character.</p>';
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
        html += '<th class="weight-col">Weight</th>';
        html += '<th class="score-col">Score</th>';
        html += '<th class="actions-col">Actions</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var i = 0; i < allGrades.length; i++) {
            html += renderGradeRow(allGrades[i]);
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
        var percentageLabel = percentage !== null ? String(percentage) + '%' : '\u2014';
        var scoreClass = getScoreClass(percentage);
        var disciplineName = getDisciplineName(grade.disciplineId);
        var typeLabel = isNonEmptyString(grade.type) ? grade.type : 'assignment';
        var weekLabel = grade.week !== undefined && grade.week !== null
            ? String(grade.week)
            : '\u2014';
        var weightLabel = isFiniteNumber(grade.weight) ? String(grade.weight) : '1';

        var html = '';
        html += '<tr class="academy-grades-editor-row" ' +
                    'data-grade-id="' + escapeAttribute(grade.id || '') + '">';
        html += '<td class="week-col">' + escapeHtml(weekLabel) + '</td>';
        html += '<td class="discipline-col">' + escapeHtml(disciplineName) + '</td>';
        html += '<td class="type-col">' + escapeHtml(typeLabel) + '</td>';
        html += '<td class="weight-col">' + escapeHtml(weightLabel) + '</td>';
        html += '<td class="score-col">' +
                    '<span class="' + scoreClass + '">' +
                        escapeHtml(percentageLabel) +
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

        // Discipline options: available disciplines for the selected week,
        // falling back to all disciplines if the week filter returns empty.
        var disciplines = [];
        if (DisciplineQueries.getAvailableDisciplines) {
            disciplines = DisciplineQueries.getAvailableDisciplines(_state.week) || [];
        }
        if (disciplines.length === 0 && DisciplineQueries.getDisciplines) {
            disciplines = DisciplineQueries.getDisciplines() || [];
        }

        var validTypes = (AcademyGrades.VALID_GRADE_TYPES) || [
            'exam', 'assignment', 'participation', 'project', 'quiz', 'final'
        ];

        var modal = Modal.createModal('academy-grade-form-modal');
        if (!modal) {
            notify('Could not create modal.', 'error');
            return;
        }

        var html = '';
        html += '<form id="academy-grade-form" data-edit-id="' +
                    (isEdit ? escapeAttribute(existing.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Grade' : 'Add Grade') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // Discipline
        html += '<div class="form-group">';
        html += '<label for="ag-disc-select">Discipline *</label>';
        html += '<select id="ag-disc-select" class="ag-disc-select" required>';
        html += '<option value="">Select a discipline...</option>';
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d || !d.id) { continue; }
            var dSel = String(d.id) === String(g.disciplineId || '') ? ' selected' : '';
            html += '<option value="' + escapeAttribute(d.id) + '"' + dSel + '>' +
                        escapeHtml(d.name || d.id) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Type
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
        html += '</div>';

        // Week
        html += '<div class="form-group">';
        html += '<label for="ag-week-input">Week *</label>';
        html += '<input type="number" id="ag-week-input" class="ag-week-input" ' +
                    'value="' + escapeAttribute(String(g.week !== undefined && g.week !== null ? g.week : _state.week)) + '" ' +
                    'min="1" max="52" required>';
        html += '</div>';

        // Score / Max score
        html += '<div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        html += '<div class="form-group">';
        html += '<label for="ag-score-input">Score *</label>';
        html += '<input type="number" step="0.1" id="ag-score-input" class="ag-score-input" ' +
                    'value="' + escapeAttribute(g.score !== undefined && g.score !== null ? String(g.score) : '') + '" ' +
                    'min="0" required>';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label for="ag-max-score-input">Max Score</label>';
        html += '<input type="number" step="0.1" id="ag-max-score-input" class="ag-max-score-input" ' +
                    'value="' + escapeAttribute(g.maxScore !== undefined && g.maxScore !== null ? String(g.maxScore) : '100') + '" ' +
                    'min="1">';
        html += '</div>';
        html += '</div>';

        // Weight
        html += '<div class="form-group">';
        html += '<label for="ag-weight-input">Weight</label>';
        html += '<input type="number" step="0.1" id="ag-weight-input" class="ag-weight-input" ' +
                    'value="' + escapeAttribute(g.weight !== undefined && g.weight !== null ? String(g.weight) : '1.0') + '" ' +
                    'min="0" max="2">';
        html += '<p class="field-hint">Weight 0–2. Weighted averages use this factor.</p>';
        html += '</div>';

        // Date
        html += '<div class="form-group">';
        html += '<label for="ag-date-input">Date</label>';
        html += '<input type="date" id="ag-date-input" class="ag-date-input" ' +
                    'value="' + escapeAttribute(g.date || '') + '">';
        html += '</div>';

        // Notes
        html += '<div class="form-group">';
        html += '<label for="ag-notes-input">Notes</label>';
        html += '<textarea id="ag-notes-input" class="ag-notes-input" rows="2">' +
                    escapeHtml(g.notes || '') +
                '</textarea>';
        html += '</div>';

        // Actions
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Update Grade' : 'Add Grade') +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = html;
        modal.appendChild(contentEl);

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

        form.addEventListener('submit', function(e) {
            e.preventDefault();

            var discInput = form.querySelector('.ag-disc-select');
            var typeInput = form.querySelector('.ag-type-select');
            var weekInput = form.querySelector('.ag-week-input');
            var scoreInput = form.querySelector('.ag-score-input');
            var maxInput = form.querySelector('.ag-max-score-input');
            var weightInput = form.querySelector('.ag-weight-input');
            var dateInput = form.querySelector('.ag-date-input');
            var notesInput = form.querySelector('.ag-notes-input');

            var disciplineId = discInput ? discInput.value : '';
            var week = weekInput ? parseInt(weekInput.value, 10) : NaN;
            var score = scoreInput ? parseFloat(scoreInput.value) : NaN;

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

            var payload = {
                studentId: _state.charId,
                classId: _state.classId,
                disciplineId: disciplineId,
                week: week,
                score: score,
                maxScore: maxInput && maxInput.value ? parseFloat(maxInput.value) : 100,
                weight: weightInput && weightInput.value ? parseFloat(weightInput.value) : 1.0,
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
        var percentage = getGradePercentage(grade);

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
                ' — Week ' + escapeHtml(String(grade.week)) +
                (percentage !== null ? ' — ' + escapeHtml(String(percentage)) + '%' : '');
        html += '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Grade</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = html;
        modal.appendChild(contentEl);

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