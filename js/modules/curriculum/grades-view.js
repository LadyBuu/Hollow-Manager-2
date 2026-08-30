/**
 * js/modules/curriculum/grades-view.js - Grades Management View
 * Handles student grades with weekly view and summary
 * Path: js/modules/curriculum/grades-view.js
 * 
 * This module is responsible for:
 *   - Rendering the grades UI
 *   - Displaying student grades by week
 *   - Calculating averages and letter grades
 *   - Saving grade data (delegates to core)
 * 
 * IMPORTANT: 
 *   - All application-data mutations are delegated to core functions.
 *   - This module does NOT mutate window.data directly.
 *   - UI state is managed locally through shared curriculum state.
 *   - Persistence is handled through the central saveData() function.
 *   - The core owns validation and parsing.
 *   - This module collects raw form data and passes it to core.
 *   - UI validation is for UX only; core validation is authoritative.
 *   - Live preview uses getGradeLetter(discipline, score) for unsaved values.
 *   - Summary reflects persisted data, not unsaved changes.
 *   - Weight validation matches core semantics (isFinite && > 0).
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 * 
 * ARCHITECTURAL NOTE:
 *   - Grades are stored as scores (0-100) per student/week/discipline.
 *   - Letter grades are calculated on display from the grading system.
 *   - Unscheduled disciplines are displayed but not editable.
 *   - The summary only counts disciplines the student is scheduled in.
 *   - Live preview updates letter grade and weighted score on input.
 *   - Summary reflects persisted data, not unsaved changes.
 *   - getStudentDisciplineIds() is imported from the core.
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Grades UI state, stored in shared curriculum state
    // ============================================================

    if (!window.curriculumState) {
        window.curriculumState = {};
    }

    if (!window.curriculumState.grades) {
        window.curriculumState.grades = {
            currentWeek: 1,
            selectedStudentId: null
        };
    }

    var state = window.curriculumState.grades;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function validateDependencies(container) {
        var missing = [];

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.getAvailableDisciplines !== 'function') {
            missing.push('getAvailableDisciplines');
        }

        if (typeof window.getDiscipline !== 'function') {
            missing.push('getDiscipline');
        }

        if (typeof window.getStudentSchedule !== 'function') {
            missing.push('getStudentSchedule');
        }

        if (typeof window.getStudentDisciplineIds !== 'function') {
            missing.push('getStudentDisciplineIds');
        }

        if (typeof window.getGrades !== 'function') {
            missing.push('getGrades');
        }

        if (typeof window.saveGrades !== 'function') {
            missing.push('saveGrades');
        }

        if (typeof window.calculateGradeSummary !== 'function') {
            missing.push('calculateGradeSummary');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (typeof window.getGradeLetter !== 'function') {
            missing.push('getGradeLetter');
        }

        if (missing.length > 0) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Grades dependencies not loaded. Please refresh the page.</p>';
            }
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER GRADES VIEW - Public API
    // ============================================================

    function renderGradesView(container) {
        if (!container) {
            container = document.getElementById('grades-content');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading grades data...</p>';
            return;
        }

        if (!validateDependencies(container)) {
            return;
        }

        window.ensureCurriculum();

        container.innerHTML = getGradesHTML();
        populateStudentSelector(container);
        renderGrades(container);
        initGradesEvents(container);
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // GRADES HTML
    // ============================================================

    function getGradesHTML() {
        return (
            '<div class="page-header">' +
                '<h2>Grades</h2>' +
            '</div>' +
            '<div class="grades-controls">' +
                '<div class="student-selector">' +
                    '<label for="grades-student">Student:</label>' +
                    '<select id="grades-student">' +
                        '<option value="">Select a student...</option>' +
                    '</select>' +
                '</div>' +
                '<div class="week-nav">' +
                    '<button id="prev-grade-week" class="small">[<]</button>' +
                    '<span id="grade-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>' +
                    '<button id="next-grade-week" class="small">[>]</button>' +
                '</div>' +
            '</div>' +
            '<div id="grades-container">' +
                '<p class="empty-state">Select a student to view and manage grades</p>' +
            '</div>' +
            '<div class="grades-summary">' +
                '<h3>Weekly Summary</h3>' +
                '<div id="grades-summary-content">' +
                    '<p class="empty-state">No grades data available</p>' +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // POPULATE STUDENT SELECTOR
    // ============================================================

    function populateStudentSelector(container) {
        var select = container ? container.querySelector('#grades-student') : document.getElementById('grades-student');
        if (!select) {
            return;
        }

        var students = window.getStudents();
        var currentValue = select.value;

        select.innerHTML = '<option value="">Select a student...</option>';

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var name = window.getDisplayName(student);
            var option = document.createElement('option');
            option.value = student.id;
            option.textContent = name;
            select.appendChild(option);
        }

        // Restore selection
        var hasCurrentValue = false;
        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === currentValue) {
                hasCurrentValue = true;
                break;
            }
        }

        if (currentValue && hasCurrentValue) {
            select.value = currentValue;
        } else if (state.selectedStudentId) {
            var hasStoredValue = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === state.selectedStudentId) {
                    hasStoredValue = true;
                    break;
                }
            }
            if (hasStoredValue) {
                select.value = state.selectedStudentId;
            } else {
                state.selectedStudentId = null;
            }
        }

        if (!state.selectedStudentId && select.options.length > 1) {
            select.selectedIndex = 1;
            state.selectedStudentId = select.value;
        }
    }

    // ============================================================
    // NUMERIC-AWARE GRADE EQUALITY CHECK
    // ============================================================

    function gradesEqual(a, b) {
        if (a === '' && b === '') {
            return true;
        }

        var numA = Number(a);
        var numB = Number(b);

        if (a !== '' && b !== '' && isFinite(numA) && isFinite(numB)) {
            return numA === numB;
        }

        return String(a) === String(b);
    }

    // ============================================================
    // STRICT NUMERIC VALIDATION (UI-level only)
    // ============================================================

    function isValidGrade(value) {
        if (value === '' || value === undefined || value === null) {
            return false;
        }
        var num = Number(value);
        return isFinite(num) && num >= 0 && num <= 100;
    }

    /**
     * Validate a weight value using the same semantics as the core.
     * Returns true only if weight is a finite number greater than 0.
     */
    function isValidWeight(weight) {
        return isFinite(Number(weight)) && Number(weight) > 0;
    }

    // ============================================================
    // RENDER GRADES
    // ============================================================

    function renderGrades(container) {
        var gradesContainer = container ? container.querySelector('#grades-container') : document.getElementById('grades-container');
        var summaryContainer = container ? container.querySelector('#grades-summary-content') : document.getElementById('grades-summary-content');

        if (!gradesContainer) {
            return;
        }

        var weekDisplay = container ? container.querySelector('#grade-week-display') : document.getElementById('grade-week-display');
        if (weekDisplay) {
            weekDisplay.textContent = 'Week ' + state.currentWeek;
        }

        var select = container ? container.querySelector('#grades-student') : document.getElementById('grades-student');
        if (select && select.value) {
            state.selectedStudentId = select.value;
        }

        if (!state.selectedStudentId) {
            gradesContainer.innerHTML = '<p class="empty-state">Select a student to view and manage grades</p>';
            if (summaryContainer) {
                summaryContainer.innerHTML = '<p class="empty-state">No grades data available</p>';
            }
            return;
        }

        var student = window.getCharacterById(state.selectedStudentId);
        if (!student) {
            gradesContainer.innerHTML = '<p class="empty-state">Student not found</p>';
            return;
        }

        var allDisciplines = window.getAvailableDisciplines(state.currentWeek);
        if (allDisciplines.length === 0) {
            gradesContainer.innerHTML = '<p class="empty-state">No disciplines available for week ' + state.currentWeek + '</p>';
            if (summaryContainer) {
                summaryContainer.innerHTML = '<p class="empty-state">No grades data available</p>';
            }
            return;
        }

        var schedule = window.getStudentSchedule(state.selectedStudentId, state.currentWeek);
        var studentDisciplineIds = window.getStudentDisciplineIds(schedule);

        var grades = {};
        if (typeof window.getGrades === 'function') {
            grades = window.getGrades(state.selectedStudentId, state.currentWeek) || {};
        }

        var disciplines = allDisciplines.filter(function(d) {
            return d && typeof d === 'object';
        });

        if (disciplines.length === 0) {
            gradesContainer.innerHTML = '<p class="empty-state">No disciplines available</p>';
            return;
        }

        disciplines.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var html = '<table class="grades-table">';
        html += '<thead><tr>';
        html += '<th>Discipline</th>';
        html += '<th>Type</th>';
        html += '<th>Instructor</th>';
        html += '<th>Weight</th>';
        html += '<th>Score</th>';
        html += '<th>Grade</th>';
        html += '<th>Weighted Score</th>';
        html += '</tr></thead><tbody>';

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var isInSchedule = studentDisciplineIds.some(function(id) {
                return String(id) === String(d.id);
            });

            var score = '';
            var hasScore = false;
            if (isInSchedule) {
                var storedScore = grades[d.id];
                if (storedScore !== undefined && storedScore !== null && storedScore !== '') {
                    score = String(storedScore);
                    hasScore = true;
                }
            }

            var letter = '';
            var weighted = 0;
            var weightedDisplay = '--';

            if (hasScore && isInSchedule) {
                var numericScore = Number(score);
                if (isFinite(numericScore)) {
                    // Use getGradeLetter directly for persisted data
                    if (typeof window.getGradeLetter === 'function') {
                        var letterResult = window.getGradeLetter(d, numericScore);
                        if (letterResult !== null && letterResult !== undefined) {
                            letter = letterResult;
                        }
                    }

                    // Use same weight validation as core
                    if (isValidWeight(d.weight)) {
                        weighted = numericScore * Number(d.weight);
                        weightedDisplay = weighted.toFixed(1);
                    }
                }
            }

            var typeLabel = d.type === 'mandatory' ? '[M]' : (d.type === 'optional' ? '[O]' : '--');
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : (d.type === 'optional' ? 'var(--warning)' : 'var(--text-dim)');

            var instructors = getInstructorNames(d);
            var instructorDisplay = instructors.length > 0 ? instructors[0] : '--';

            var safeName = escapeHtml(d.name);
            var safeInstructor = escapeHtml(instructorDisplay);
            var safeScore = escapeHtml(score);
            var safeLetter = escapeHtml(letter);
            var safeWeightedDisplay = escapeHtml(weightedDisplay);

            var disabledAttr = isInSchedule ? '' : 'disabled style="opacity:0.4;"';

            html += '<tr' + (isInSchedule ? '' : ' style="opacity:0.4;"') + '>';
            html += '<td>' + safeName + (isInSchedule ? '' : ' <span style="font-size:0.6rem;color:var(--text-dim);">(not scheduled)</span>') + '</td>';
            html += '<td style="color:' + typeColor + ';font-size:0.7rem;">' + typeLabel + '</td>';
            html += '<td style="font-size:0.7rem;">' + safeInstructor + '</td>';
            html += '<td class="weight">' + (d.weight || 1) + '</td>';
            html += '<td><input type="number" class="grade-input" data-discipline="' + escapeHtml(d.id) + '" data-original="' + safeScore + '" value="' + safeScore + '" min="0" max="100" step="0.1" ' + disabledAttr + '></td>';
            html += '<td class="grade-letter">' + (safeLetter || '--') + '</td>';
            html += '<td class="weighted-score">' + safeWeightedDisplay + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        html += '<div style="margin-top:12px;"><button id="save-grades-btn" class="primary small">Save Grades</button></div>';

        gradesContainer.innerHTML = html;

        // Live preview while editing - uses getGradeLetter directly
        var gradeInputs = gradesContainer.querySelectorAll('.grade-input:not([disabled])');
        for (var i = 0; i < gradeInputs.length; i++) {
            var input = gradeInputs[i];
            input.addEventListener('input', function() {
                var row = this.closest('tr');
                if (!row) {
                    return;
                }

                var disciplineId = this.dataset.discipline;
                var value = this.value.trim();
                var letterEl = row.querySelector('.grade-letter');
                var weightedEl = row.querySelector('.weighted-score');

                if (isValidGrade(value)) {
                    var numericValue = Number(value);

                    // Look up the discipline for letter grade calculation
                    var discipline = null;
                    for (var j = 0; j < disciplines.length; j++) {
                        if (String(disciplines[j].id) === String(disciplineId)) {
                            discipline = disciplines[j];
                            break;
                        }
                    }

                    // Calculate letter grade from raw input using getGradeLetter
                    if (discipline && typeof window.getGradeLetter === 'function') {
                        var letterResult = window.getGradeLetter(discipline, numericValue);
                        if (letterResult !== null && letterResult !== undefined) {
                            letterEl.textContent = letterResult;
                        } else {
                            letterEl.textContent = '--';
                        }
                    } else {
                        letterEl.textContent = '--';
                    }

                    // Calculate weighted score using same weight validation as core
                    if (discipline && isValidWeight(discipline.weight)) {
                        var weighted = numericValue * Number(discipline.weight);
                        weightedEl.textContent = weighted.toFixed(1);
                    } else {
                        weightedEl.textContent = '--';
                    }
                } else if (value === '') {
                    letterEl.textContent = '--';
                    weightedEl.textContent = '--';
                }
            });
        }

        var saveBtn = gradesContainer.querySelector('#save-grades-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                saveGrades(container);
            });
        }

        updateGradeSummary(container, student);
    }

    // ============================================================
    // GET INSTRUCTOR NAMES
    // ============================================================

    function getInstructorNames(discipline) {
        var names = [];
        if (discipline && discipline.instructorIds) {
            for (var i = 0; i < discipline.instructorIds.length; i++) {
                var id = discipline.instructorIds[i];
                var instructor = window.getCharacterById(id);
                if (instructor) {
                    names.push(window.getDisplayName(instructor));
                }
            }
        }
        return names;
    }

    // ============================================================
    // UPDATE GRADE SUMMARY - Simplified
    // ============================================================

    function updateGradeSummary(container, student) {
        var summaryContainer = container ? container.querySelector('#grades-summary-content') : document.getElementById('grades-summary-content');
        if (!summaryContainer) {
            return;
        }

        if (!student) {
            summaryContainer.innerHTML = '<p class="empty-state">No grades data available</p>';
            return;
        }

        var summary = window.calculateGradeSummary(student.id, state.currentWeek);

        if (!summary) {
            summaryContainer.innerHTML = '<p class="empty-state">No grades data available</p>';
            return;
        }

        var averageDisplay = summary.average !== null ? summary.average.toFixed(1) : '--';
        var statusText;
        var statusColor;

        if (!summary.hasGrades) {
            statusText = 'Not Graded';
            statusColor = 'var(--text-dim)';
        } else if (summary.average === null) {
            statusText = 'No Weighted Average';
            statusColor = 'var(--warning)';
        } else if (summary.average >= 70) {
            statusText = 'Passing';
            statusColor = 'var(--accent)';
        } else {
            statusText = 'Needs Work';
            statusColor = 'var(--danger)';
        }

        var html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;">' +
            '<div style="background:var(--bg);padding:12px;border-radius:6px;"><span style="color:var(--text-dim);">Average</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--accent);">' + averageDisplay + '</span></div>' +
            '<div style="background:var(--bg);padding:12px;border-radius:6px;"><span style="color:var(--text-dim);">Graded</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--text);">' + summary.gradedCount + '/' + summary.scheduledCount + '</span></div>' +
            '<div style="background:var(--bg);padding:12px;border-radius:6px;"><span style="color:var(--text-dim);">Mandatory</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--accent);">' + summary.mandatoryGraded + '/' + summary.mandatoryScheduled + '</span></div>' +
            '<div style="background:var(--bg);padding:12px;border-radius:6px;"><span style="color:var(--text-dim);">Optional</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--warning);">' + summary.optionalGraded + '/' + summary.optionalScheduled + '</span></div>' +
        '</div>';

        html += '<div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;">' +
            '<span style="color:var(--text-dim);">Status: </span>' +
            '<span style="font-weight:700;color:' + statusColor + ';">' + statusText + '</span>' +
            ' <span style="color:var(--text-dim);font-size:0.75rem;">(' + summary.gradedCount + ' of ' + summary.scheduledCount + ' disciplines graded)</span>' +
        '</div>';

        summaryContainer.innerHTML = html;
    }

    // ============================================================
    // SAVE GRADES - Container-scoped
    // ============================================================

    function saveGrades(container) {
        if (!state.selectedStudentId) {
            showNotification('No student selected.', 'error');
            return;
        }

        var grades = {};
        var hasChanges = false;
        var invalidInputs = [];

        // Scope queries to container
        var gradeInputs = container
            ? container.querySelectorAll('.grade-input:not([disabled])')
            : document.querySelectorAll('.grade-input:not([disabled])');

        for (var i = 0; i < gradeInputs.length; i++) {
            var input = gradeInputs[i];
            var disciplineId = input.dataset.discipline;
            var originalValue = input.dataset.original || '';
            var currentValue = input.value.trim();

            if (gradesEqual(currentValue, originalValue)) {
                continue;
            }

            if (currentValue === '') {
                grades[disciplineId] = undefined;
                hasChanges = true;
                continue;
            }

            var numericValue = Number(currentValue);

            if (!isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
                invalidInputs.push(disciplineId);
                continue;
            }

            grades[disciplineId] = numericValue;
            hasChanges = true;
        }

        if (invalidInputs.length > 0) {
            var disciplineNames = invalidInputs.map(function(id) {
                var d = window.getDiscipline(id);
                return d ? d.name : id;
            });
            showNotification('Invalid scores for: ' + disciplineNames.join(', ') + '. Please enter values between 0 and 100.', 'error');
            return;
        }

        if (!hasChanges) {
            showNotification('No changes to save.', 'info');
            return;
        }

        if (typeof window.saveGrades !== 'function') {
            showNotification('Grades system is not available. Please refresh the page.', 'error');
            return;
        }

        var result = window.saveGrades(state.selectedStudentId, state.currentWeek, grades);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to save grades.', 'error');
            return;
        }

        // Re-render from canonical state (this updates data-original attributes automatically)
        renderGrades(container);

        // Core already logs the mutation. View does not log separately.

        // Persist
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification('Grades saved successfully.', 'success');
                })
                .catch(function() {
                    showNotification('Grades saved in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification('Grades saved successfully.', 'success');
        }
    }

    // ============================================================
    // NOTIFICATION HELPER
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initGradesEvents(container) {
        var studentSelect = container ? container.querySelector('#grades-student') : document.getElementById('grades-student');

        if (studentSelect) {
            var newSelect = studentSelect.cloneNode(true);
            studentSelect.parentNode.replaceChild(newSelect, studentSelect);
            studentSelect = newSelect;

            studentSelect.addEventListener('change', function() {
                state.selectedStudentId = this.value;
                renderGrades(container);
            });
        }

        var prevBtn = container ? container.querySelector('#prev-grade-week') : document.getElementById('prev-grade-week');

        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderGrades(container);
                }
            });
        }

        var nextBtn = container ? container.querySelector('#next-grade-week') : document.getElementById('next-grade-week');

        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderGrades(container);
                }
            });
        }

        if (studentSelect && studentSelect.options.length > 1 && !state.selectedStudentId) {
            studentSelect.selectedIndex = 1;
            state.selectedStudentId = studentSelect.value;
            setTimeout(function() {
                renderGrades(container);
            }, 50);
        }
    }

    // ============================================================
    // REGISTER WITH CURRICULUM MAIN
    // ============================================================

    if (typeof window.curriculumState !== 'undefined') {
        window.curriculumState.grades = state;
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderGradesView = renderGradesView;
    window.gradesState = state;

})();
