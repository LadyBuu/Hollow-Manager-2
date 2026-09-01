/**
 * js/modules/academia/academia-grades.js - Academia Grades View
 * Student grade management
 * Path: js/modules/academia/academia-grades.js
 * 
 * This module is responsible for:
 *   - Rendering the grades view
 *   - Displaying student grades by week
 *   - Calculating averages and letter grades
 *   - Saving grade data (delegates to core)
 * 
 * LIFECYCLE:
 *   This module is rendered by academia-main.js via TabManager.
 * 
 * DEPENDENCIES:
 *   - window.getStudents (from core-utils.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getAvailableDisciplines (from curriculum-disciplines.js)
 *   - window.getDiscipline (from curriculum-disciplines.js)
 *   - window.getStudentSchedule (from curriculum-schedule.js)
 *   - window.getStudentDisciplineIds (from curriculum-schedule.js)
 *   - window.getGrades (from curriculum-grades.js)
 *   - window.saveGrades (from curriculum-grades.js)
 *   - window.calculateGradeSummary (from curriculum-grades.js)
 *   - window.getGradeLetter (from curriculum-grades.js)
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Grades UI state
    // ============================================================

    var state = window.academiaGradesState || {
        selectedStudentId: null,
        currentWeek: 1
    };

    window.academiaGradesState = state;

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

        if (typeof window.getGradeLetter !== 'function') {
            missing.push('getGradeLetter');
        }

        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
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
    // RENDER ACADEMIA GRADES - Public API
    // ============================================================

    function renderAcademiaGrades(container) {
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
        return `
            <div class="page-header">
                <h2>Grades</h2>
            </div>
            <div class="grades-controls" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:12px;">
                <div class="student-selector" style="display:flex;align-items:center;gap:6px;">
                    <label for="grades-student" style="font-size:0.75rem;color:var(--text-dim);">Student:</label>
                    <select id="grades-student" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;min-width:150px;">
                        <option value="">Select a student...</option>
                    </select>
                </div>
                <div class="week-nav" style="display:flex;align-items:center;gap:6px;">
                    <button id="prev-grade-week" class="small">[<]</button>
                    <span id="grade-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-grade-week" class="small">[>]</button>
                </div>
            </div>
            <div id="grades-container">
                <p class="empty-state">Select a student to view and manage grades</p>
            </div>
            <div class="grades-summary" style="margin-top:16px;">
                <h3 style="font-size:0.9rem;color:var(--text-dim);margin-bottom:8px;">Weekly Summary</h3>
                <div id="grades-summary-content">
                    <p class="empty-state">No grades data available</p>
                </div>
            </div>
        `;
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
        if (currentValue) {
            var exists = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === currentValue) {
                    exists = true;
                    break;
                }
            }
            if (exists) {
                select.value = currentValue;
            } else {
                state.selectedStudentId = null;
            }
        }

        if (state.selectedStudentId) {
            var exists2 = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === state.selectedStudentId) {
                    exists2 = true;
                    break;
                }
            }
            if (exists2) {
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

    function isValidWeight(weight) {
        return isFinite(Number(weight)) && Number(weight) > 0;
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

        var html = '<table class="grades-table" style="width:100%;border-collapse:collapse;font-size:0.8rem;">';
        html += '<thead><tr style="background:var(--panel-alt);border-bottom:1px solid var(--border);">';
        html += '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-dim);">Discipline</th>';
        html += '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-dim);">Type</th>';
        html += '<th style="padding:6px 8px;text-align:left;font-weight:600;color:var(--text-dim);">Instructor</th>';
        html += '<th style="padding:6px 8px;text-align:center;font-weight:600;color:var(--text-dim);">Weight</th>';
        html += '<th style="padding:6px 8px;text-align:center;font-weight:600;color:var(--text-dim);">Score</th>';
        html += '<th style="padding:6px 8px;text-align:center;font-weight:600;color:var(--text-dim);">Grade</th>';
        html += '<th style="padding:6px 8px;text-align:center;font-weight:600;color:var(--text-dim);">Weighted</th>';
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
                    if (typeof window.getGradeLetter === 'function') {
                        var letterResult = window.getGradeLetter(d, numericScore);
                        if (letterResult !== null && letterResult !== undefined) {
                            letter = letterResult;
                        }
                    }

                    if (isValidWeight(d.weight)) {
                        weighted = numericScore * Number(d.weight);
                        weightedDisplay = weighted.toFixed(1);
                    }
                }
            }

            var typeLabel = d.type === 'mandatory' ? '■' : (d.type === 'optional' ? '□' : '--');
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : (d.type === 'optional' ? 'var(--warning)' : 'var(--text-dim)');

            var instructors = getInstructorNames(d);
            var instructorDisplay = instructors.length > 0 ? instructors[0] : '--';

            var safeName = escapeHtml(d.name);
            var safeInstructor = escapeHtml(instructorDisplay);
            var safeScore = escapeHtml(score);
            var safeLetter = escapeHtml(letter);
            var safeWeightedDisplay = escapeHtml(weightedDisplay);

            var disabledAttr = isInSchedule ? '' : 'disabled style="opacity:0.4;"';
            var rowStyle = isInSchedule ? '' : ' style="opacity:0.4;"';

            html += '<tr' + rowStyle + '>';
            html += '<td style="padding:4px 8px;border-bottom:1px solid var(--border-soft);">' + safeName + (isInSchedule ? '' : ' <span style="font-size:0.55rem;color:var(--text-dim);">(not scheduled)</span>') + '</td>';
            html += '<td style="padding:4px 8px;border-bottom:1px solid var(--border-soft);color:' + typeColor + ';font-size:0.7rem;">' + typeLabel + '</td>';
            html += '<td style="padding:4px 8px;border-bottom:1px solid var(--border-soft);font-size:0.7rem;">' + safeInstructor + '</td>';
            html += '<td style="padding:4px 8px;border-bottom:1px solid var(--border-soft);text-align:center;">' + (d.weight || 1) + '</td>';
            html += '<td style="padding:4px 8px;border-bottom:1px solid var(--border-soft);text-align:center;"><input type="number" class="grade-input" data-discipline="' + escapeHtml(d.id) + '" data-original="' + safeScore + '" value="' + safeScore + '" min="0" max="100" step="0.1" ' + disabledAttr + ' style="width:70px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 4px;font-size:0.75rem;text-align:center;"></td>';
            html += '<td style="padding:4px 8px;border-bottom:1px solid var(--border-soft);text-align:center;font-weight:600;" class="grade-letter">' + (safeLetter || '--') + '</td>';
            html += '<td style="padding:4px 8px;border-bottom:1px solid var(--border-soft);text-align:center;font-weight:600;" class="weighted-score">' + safeWeightedDisplay + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        html += '<div style="margin-top:12px;"><button id="save-grades-btn" class="primary small">Save Grades</button></div>';

        gradesContainer.innerHTML = html;

        // Live preview while editing
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

                    var discipline = null;
                    for (var j = 0; j < disciplines.length; j++) {
                        if (String(disciplines[j].id) === String(disciplineId)) {
                            discipline = disciplines[j];
                            break;
                        }
                    }

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
    // UPDATE GRADE SUMMARY
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

        var html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;">' +
            '<div style="background:var(--bg);padding:10px;border-radius:6px;text-align:center;"><span style="color:var(--text-dim);font-size:0.7rem;">Average</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--accent);">' + averageDisplay + '</span></div>' +
            '<div style="background:var(--bg);padding:10px;border-radius:6px;text-align:center;"><span style="color:var(--text-dim);font-size:0.7rem;">Graded</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--text);">' + summary.gradedCount + '/' + summary.scheduledCount + '</span></div>' +
            '<div style="background:var(--bg);padding:10px;border-radius:6px;text-align:center;"><span style="color:var(--text-dim);font-size:0.7rem;">Mandatory</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--accent);">' + summary.mandatoryGraded + '/' + summary.mandatoryScheduled + '</span></div>' +
            '<div style="background:var(--bg);padding:10px;border-radius:6px;text-align:center;"><span style="color:var(--text-dim);font-size:0.7rem;">Optional</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--warning);">' + summary.optionalGraded + '/' + summary.optionalScheduled + '</span></div>' +
        '</div>';

        html += '<div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:6px;">' +
            '<span style="color:var(--text-dim);">Status: </span>' +
            '<span style="font-weight:700;color:' + statusColor + ';">' + statusText + '</span>' +
            ' <span style="color:var(--text-dim);font-size:0.7rem;">(' + summary.gradedCount + ' of ' + summary.scheduledCount + ' disciplines graded)</span>' +
        '</div>';

        summaryContainer.innerHTML = html;
    }

    // ============================================================
    // SAVE GRADES
    // ============================================================

    function saveGrades(container) {
        if (!state.selectedStudentId) {
            showNotification('No student selected.', 'error');
            return;
        }

        var grades = {};
        var hasChanges = false;
        var invalidInputs = [];

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

        // Re-render from canonical state
        renderGrades(container);

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
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderAcademiaGrades = renderAcademiaGrades;
    window.academiaGradesState = state;

})();
