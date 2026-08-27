/**
 * js/modules/curriculum/grades.js - Grade Management Module
 * Handles student grades with weekly view and summary
 * Path: js/modules/curriculum/grades.js
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
 *   - This module does not implement persistence itself.
 *   - Grades are only counted for disciplines the student is actually scheduled in.
 *   - Saving preserves existing grades and only updates changed fields.
 *   - All core mutation functions return { success: boolean, message?: string, ... }
 *   - undefined in saveData means "delete this grade".
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
    // RENDER GRADES VIEW - Public API (only this is exposed)
    // ============================================================

    function renderGradesView(container) {
        if (!container) {
            container = document.getElementById('grades-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading grades data...</p>';
            return;
        }

        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[Grades] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        if (typeof window.saveGrades !== 'function') {
            console.error('[Grades] saveGrades() is not available.');
            container.innerHTML = '<p class="empty-state">Grades core module not loaded. Please refresh the page.</p>';
            return;
        }

        if (typeof window.getGrades !== 'function') {
            console.error('[Grades] getGrades() is not available.');
            container.innerHTML = '<p class="empty-state">Grades core module not loaded. Please refresh the page.</p>';
            return;
        }

        container.innerHTML = getGradesHTML();
        populateStudentSelector();
        renderGrades();
        initGradesEvents();
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
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
            <div class="grades-controls">
                <div class="student-selector">
                    <label for="grades-student">Student:</label>
                    <select id="grades-student">
                        <option value="">Select a student...</option>
                    </select>
                </div>
                <div class="week-nav">
                    <button id="prev-grade-week" class="small">← Prev</button>
                    <span id="grade-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-grade-week" class="small">Next →</button>
                </div>
            </div>
            <div id="grades-container">
                <p class="empty-state">Select a student to view and manage grades</p>
            </div>
            <div class="grades-summary">
                <h3>Weekly Summary</h3>
                <div id="grades-summary-content">
                    <p class="empty-state">No grades data available</p>
                </div>
            </div>
        `;
    }

    // ============================================================
    // POPULATE STUDENT SELECTOR
    // ============================================================

    function populateStudentSelector() {
        var select = document.getElementById('grades-student');
        if (!select) return;

        var students = window.getStudents();
        var currentValue = select.value;
        
        select.innerHTML = '<option value="">Select a student...</option>';
        students.forEach(function(student) {
            var name = window.getDisplayName(student);
            var option = document.createElement('option');
            option.value = student.id;
            option.textContent = name;
            select.appendChild(option);
        });

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
    // STRICT GRADES EQUALITY CHECK - Uses Number() not parseFloat()
    // ============================================================

    function gradesEqual(a, b) {
        if (a === '' && b === '') return true;

        var numA = Number(a);
        var numB = Number(b);

        // Only treat as numeric if both are non-empty finite numbers
        if (a !== '' && b !== '' && isFinite(numA) && isFinite(numB)) {
            return numA === numB;
        }

        return String(a) === String(b);
    }

    // ============================================================
    // STRICT NUMERIC VALIDATION - Uses Number() not parseFloat()
    // ============================================================

    function isValidGrade(value) {
        if (value === '' || value === undefined || value === null) return false;
        var num = Number(value);
        return isFinite(num) && num >= 0 && num <= 100;
    }

    function getStrictNumber(value) {
        var num = Number(value);
        return isFinite(num) ? num : NaN;
    }

    // ============================================================
    // RENDER GRADES
    // ============================================================

    function renderGrades() {
        var container = document.getElementById('grades-container');
        var summary = document.getElementById('grades-summary-content');

        var weekDisplay = document.getElementById('grade-week-display');
        if (weekDisplay) weekDisplay.textContent = 'Week ' + state.currentWeek;

        var select = document.getElementById('grades-student');
        if (select && select.value) {
            state.selectedStudentId = select.value;
        }

        if (!state.selectedStudentId) {
            if (container) container.innerHTML = '<p class="empty-state">Select a student to view and manage grades</p>';
            if (summary) summary.innerHTML = '<p class="empty-state">No grades data available</p>';
            return;
        }

        var student = window.getCharacterById(state.selectedStudentId);
        if (!student) {
            if (container) container.innerHTML = '<p class="empty-state">Student not found</p>';
            return;
        }

        var allDisciplines = window.getAvailableDisciplines(state.currentWeek);
        if (allDisciplines.length === 0) {
            if (container) container.innerHTML = '<p class="empty-state">No disciplines available for week ' + state.currentWeek + '</p>';
            if (summary) summary.innerHTML = '<p class="empty-state">No grades data available</p>';
            return;
        }

        var schedule = window.getStudentSchedule(state.selectedStudentId, state.currentWeek);
        var studentDisciplineIds = getStudentDisciplineIds(schedule);

        var grades = {};
        if (typeof window.getGrades === 'function') {
            grades = window.getGrades(state.selectedStudentId, state.currentWeek) || {};
        }

        var disciplines = allDisciplines.filter(function(d) {
            return d && typeof d === 'object';
        });

        if (disciplines.length === 0) {
            if (container) container.innerHTML = '<p class="empty-state">No disciplines available</p>';
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

        disciplines.forEach(function(d) {
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
            var weightedDisplay = '—';

            if (hasScore && isInSchedule) {
                var numericScore = getStrictNumber(score);
                if (isFinite(numericScore)) {
                    // Letter grade is independent of weight
                    letter = getGradeLetter(d, numericScore);

                    // Weighted contribution only if weight exists
                    if (d.weight) {
                        weighted = numericScore * d.weight;
                        weightedDisplay = weighted.toFixed(1);
                    }
                }
            }

            var typeLabel = d.type === 'mandatory' ? '■' : (d.type === 'optional' ? '□' : '—');
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : (d.type === 'optional' ? 'var(--warning)' : 'var(--text-dim)');
            var instructors = getInstructorNames(d);
            var instructorDisplay = instructors.length > 0 ? instructors[0] : '—';

            var safeName = escapeHtml(d.name);
            var safeInstructor = escapeHtml(instructorDisplay);
            var safeScore = escapeHtml(score);
            var safeLetter = escapeHtml(letter);
            var safeWeightedDisplay = escapeHtml(weightedDisplay);
            var safeOriginalScore = escapeHtml(hasScore ? score : '');

            html += '<tr' + (isInSchedule ? '' : ' style="opacity:0.4;"') + '>';
            html += '<td>' + safeName + (isInSchedule ? '' : ' <span style="font-size:0.6rem;color:var(--text-dim);">(not scheduled)</span>') + '</td>';
            html += '<td style="color:' + typeColor + ';font-size:0.7rem;">' + typeLabel + '</td>';
            html += '<td style="font-size:0.7rem;">' + safeInstructor + '</td>';
            html += '<td class="weight">' + (d.weight || 1) + '</td>';
            html += '<td><input type="number" class="grade-input" data-discipline="' + escapeHtml(d.id) + '" data-original="' + safeOriginalScore + '" value="' + safeScore + '" min="0" max="100" step="0.1" ' + (isInSchedule ? '' : 'disabled style="opacity:0.4;"') + '></td>';
            html += '<td class="grade-letter">' + (safeLetter || '—') + '</td>';
            html += '<td class="weighted-score">' + safeWeightedDisplay + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        html += '<div style="margin-top:12px;"><button id="save-grades-btn" class="primary small">Save Grades</button></div>';
        
        if (container) {
            container.innerHTML = html;

            // Live preview while editing
            container.querySelectorAll('.grade-input:not([disabled])').forEach(function(input) {
                input.addEventListener('input', function() {
                    var row = this.closest('tr');
                    if (!row) return;

                    var disciplineId = this.dataset.discipline;
                    var discipline = window.getDiscipline(disciplineId);
                    var value = this.value.trim();

                    if (isValidGrade(value)) {
                        var numericValue = Number(value);
                        var letter = getGradeLetter(discipline, numericValue);
                        var weighted = discipline && discipline.weight
                            ? numericValue * discipline.weight
                            : 0;

                        row.querySelector('.grade-letter').textContent = letter || '—';
                        row.querySelector('.weighted-score').textContent = weighted.toFixed(1);
                    } else if (value === '') {
                        row.querySelector('.grade-letter').textContent = '—';
                        row.querySelector('.weighted-score').textContent = '—';
                    }
                    // Invalid non-empty values: leave existing preview unchanged
                });
            });

            var saveBtn = container.querySelector('#save-grades-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', function() {
                    saveGrades();
                });
            }
        }

        updateGradeSummary(student, disciplines, grades, studentDisciplineIds);
    }

    // ============================================================
    // GET STUDENT DISCIPLINE IDS FROM SCHEDULE
    // ============================================================

    function getStudentDisciplineIds(schedule) {
        var ids = [];
        if (!schedule || typeof schedule !== 'object') return ids;
        
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;
            
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var disciplineId = daySchedule[hour];
                if (disciplineId && ids.indexOf(disciplineId) === -1) {
                    ids.push(disciplineId);
                }
            }
        }
        return ids;
    }

    // ============================================================
    // GET INSTRUCTOR NAMES
    // ============================================================

    function getInstructorNames(discipline) {
        var names = [];
        if (discipline && discipline.instructorIds) {
            discipline.instructorIds.forEach(function(id) {
                var instructor = window.getCharacterById(id);
                if (instructor) {
                    names.push(window.getDisplayName(instructor));
                }
            });
        }
        return names;
    }

    // ============================================================
    // GRADE LETTER CALCULATION
    // ============================================================

    function getGradeLetter(discipline, score) {
        if (!discipline || !discipline.gradingSystem || discipline.gradingSystem.length === 0) {
            return '';
        }
        
        if (score === undefined || score === null || isNaN(score)) {
            return '';
        }

        var numScore = Number(score);
        if (!isFinite(numScore)) return '';

        var sorted = discipline.gradingSystem.slice().sort(function(a, b) {
            return (b.min || 0) - (a.min || 0);
        });

        for (var i = 0; i < sorted.length; i++) {
            var grade = sorted[i];
            var min = Number(grade.min);
            var max = Number(grade.max);
            
            if (isFinite(min) && isFinite(max) && numScore >= min && numScore <= max) {
                return grade.letter;
            }
        }

        return '';
    }

    // ============================================================
    // UPDATE GRADE SUMMARY
    // ============================================================

    function updateGradeSummary(student, disciplines, grades, studentDisciplineIds) {
        var summary = document.getElementById('grades-summary-content');
        if (!summary) return;

        if (!student) {
            summary.innerHTML = '<p class="empty-state">No grades data available</p>';
            return;
        }

        var totalWeighted = 0;
        var totalWeight = 0;
        var count = 0;
        var mandatoryCount = 0;
        var optionalCount = 0;
        var scheduledCount = 0;

        disciplines.forEach(function(d) {
            var isInSchedule = studentDisciplineIds.some(function(id) {
                return String(id) === String(d.id);
            });

            if (!isInSchedule) return;
            
            scheduledCount++;
            var score = grades[d.id];
            
            if (score !== undefined && score !== null && score !== '' && d.weight) {
                var numericScore = Number(score);
                if (isFinite(numericScore)) {
                    totalWeighted += numericScore * d.weight;
                    totalWeight += d.weight;
                    count++;
                    if (d.type === 'mandatory') mandatoryCount++;
                    else if (d.type === 'optional') optionalCount++;
                }
            }
        });

        var average = totalWeight > 0 ? totalWeighted / totalWeight : 0;

        var statusText;
        var statusColor;

        if (count === 0) {
            statusText = '— Not yet graded';
            statusColor = 'var(--text-dim)';
        } else if (average >= 70) {
            statusText = '✓ Passing';
            statusColor = 'var(--accent)';
        } else {
            statusText = '⚠ Needs Work';
            statusColor = 'var(--danger)';
        }

        var html = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;">' +
            '<div style="background:var(--bg);padding:12px;border-radius:6px;"><span style="color:var(--text-dim);">Average</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--accent);">' + average.toFixed(1) + '</span></div>' +
            '<div style="background:var(--bg);padding:12px;border-radius:6px;"><span style="color:var(--text-dim);">Graded</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--text);">' + count + '/' + scheduledCount + '</span></div>' +
            '<div style="background:var(--bg);padding:12px;border-radius:6px;"><span style="color:var(--text-dim);">■ Mandatory</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--accent);">' + mandatoryCount + '</span></div>' +
            '<div style="background:var(--bg);padding:12px;border-radius:6px;"><span style="color:var(--text-dim);">□ Optional</span><br><span style="font-size:1.8rem;font-weight:700;color:var(--warning);">' + optionalCount + '</span></div>' +
        '</div>';

        html += '<div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;">' +
            '<span style="color:var(--text-dim);">Status: </span>' +
            '<span style="font-weight:700;color:' + statusColor + ';">' + statusText + '</span>' +
            ' <span style="color:var(--text-dim);font-size:0.75rem;">(' + count + ' of ' + scheduledCount + ' disciplines graded)</span>' +
        '</div>';

        summary.innerHTML = html;
    }

    // ============================================================
    // SAVE GRADES - Only sends changed fields with strict validation
    // ============================================================

    function saveGrades() {
        if (!state.selectedStudentId) {
            showNotification('No student selected.', 'error');
            return;
        }

        var grades = {};
        var hasChanges = false;
        var invalidInputs = [];

        document.querySelectorAll('.grade-input:not([disabled])').forEach(function(input) {
            var disciplineId = input.dataset.discipline;
            var originalValue = input.dataset.original || '';
            var currentValue = input.value.trim();

            if (gradesEqual(currentValue, originalValue)) {
                return;
            }

            if (currentValue === '') {
                grades[disciplineId] = undefined;
                hasChanges = true;
                return;
            }

            // Strict validation: Number() not parseFloat()
            var numericValue = Number(currentValue);

            if (!isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
                invalidInputs.push(disciplineId);
                return;
            }

            grades[disciplineId] = numericValue;
            hasChanges = true;
        });

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
            console.error('[Grades] saveGrades() is not available.');
            showNotification('Grades system is not available. Please refresh the page.', 'error');
            return;
        }

        var result = window.saveGrades(state.selectedStudentId, state.currentWeek, grades);
        
        if (!result || !result.success) {
            showNotification(
                result && result.message ? result.message : 'Failed to save grades.',
                'error'
            );
            return;
        }

        renderGrades();

        if (typeof window.logActivity === 'function') {
            window.logActivity('Saved grades for student week ' + state.currentWeek);
        }

        showNotification('Grades saved successfully!', 'success');
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
        } else {
            console.log('[Grades]', message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initGradesEvents() {
        var studentSelect = document.getElementById('grades-student');
        if (studentSelect) {
            var newSelect = studentSelect.cloneNode(true);
            studentSelect.parentNode.replaceChild(newSelect, studentSelect);
            studentSelect = newSelect;

            studentSelect.addEventListener('change', function() {
                state.selectedStudentId = this.value;
                renderGrades();
            });
        }

        var prevBtn = document.getElementById('prev-grade-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderGrades();
                }
            });
        }

        var nextBtn = document.getElementById('next-grade-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderGrades();
                }
            });
        }

        if (studentSelect && studentSelect.options.length > 1 && !state.selectedStudentId) {
            studentSelect.selectedIndex = 1;
            state.selectedStudentId = studentSelect.value;
            setTimeout(renderGrades, 50);
        }
    }

    // ============================================================
    // REGISTER WITH CURRICULUM MAIN
    // ============================================================

    if (typeof window.curriculumState !== 'undefined') {
        window.curriculumState.grades = state;
    }

    // ============================================================
    // EXPOSE FUNCTIONS - Minimal public API
    // ============================================================

    window.renderGradesView = renderGradesView;
    window.gradesState = state;

})();
