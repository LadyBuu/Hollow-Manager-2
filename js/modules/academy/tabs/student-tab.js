/**
 * js/modules/academy/tabs/student-tab.js - Student Sub-Tab
 * Handles student management, grades, rankings, and schedules
 * Path: js/modules/academy/tabs/student-tab.js
 * 
 * This module is responsible for:
 *   - Character list filtered by selected class (reuses CharacterList)
 *   - Student detail view (grades, ranking, schedule)
 *   - Grade entry and editing
 *   - Ranking display and management
 *   - Schedule viewing
 * 
 * IMPORTANT:
 *   - CharacterList is REUSED (not duplicated)
 *   - All mutations delegate to domain cores
 *   - This module is UI-ONLY - all mutations delegate to domain cores
 *   - Uses AcademyGrades for grade operations
 *   - Uses AcademyRanking for ranking operations
 *   - Uses AcademySchedule for schedule operations
 *   - Uses AcademyQueries for read-only access
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 *   - All modals use Modal system
 * 
 * DEPENDENCIES:
 *   - window.AcademyGrades (from academy-grades.js)
 *   - window.AcademyRanking (from academy-ranking.js)
 *   - window.AcademySchedule (from academy-schedule.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.CharacterList (from character-list.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.Modal (from modal.js)
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__studentTabLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademyGrades = window.AcademyGrades;
    var AcademyRanking = window.AcademyRanking;
    var AcademySchedule = window.AcademySchedule;
    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var CharacterList = window.CharacterList;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyGrades || typeof AcademyGrades.getGrades !== 'function') {
            missing.push('AcademyGrades.getGrades');
        }
        if (!AcademyGrades || typeof AcademyGrades.saveGrades !== 'function') {
            missing.push('AcademyGrades.saveGrades');
        }
        if (!AcademyGrades || typeof AcademyGrades.calculateSummary !== 'function') {
            missing.push('AcademyGrades.calculateSummary');
        }
        if (!AcademyGrades || typeof AcademyGrades.getClassSummary !== 'function') {
            missing.push('AcademyGrades.getClassSummary');
        }

        if (!AcademyRanking || typeof AcademyRanking.getRankings !== 'function') {
            missing.push('AcademyRanking.getRankings');
        }
        if (!AcademyRanking || typeof AcademyRanking.getStudentRank !== 'function') {
            missing.push('AcademyRanking.getStudentRank');
        }
        if (!AcademyRanking || typeof AcademyRanking.autoGenerate !== 'function') {
            missing.push('AcademyRanking.autoGenerate');
        }
        if (!AcademyRanking || typeof AcademyRanking.updateStudentRank !== 'function') {
            missing.push('AcademyRanking.updateStudentRank');
        }
        if (!AcademyRanking || typeof AcademyRanking.removeStudentFromRankings !== 'function') {
            missing.push('AcademyRanking.removeStudentFromRankings');
        }
        if (!AcademyRanking || typeof AcademyRanking.getRankingsWithDetails !== 'function') {
            missing.push('AcademyRanking.getRankingsWithDetails');
        }
        if (!AcademyRanking || typeof AcademyRanking.getClassRankings !== 'function') {
            missing.push('AcademyRanking.getClassRankings');
        }

        if (!AcademySchedule || typeof AcademySchedule.getStudentSchedule !== 'function') {
            missing.push('AcademySchedule.getStudentSchedule');
        }
        if (!AcademySchedule || typeof AcademySchedule.getStudentRestDays !== 'function') {
            missing.push('AcademySchedule.getStudentRestDays');
        }
        if (!AcademySchedule || typeof AcademySchedule.setRestDays !== 'function') {
            missing.push('AcademySchedule.setRestDays');
        }
        if (!AcademySchedule || typeof AcademySchedule.getClassDetails !== 'function') {
            missing.push('AcademySchedule.getClassDetails');
        }
        if (!AcademySchedule || typeof AcademySchedule.getConflicts !== 'function') {
            missing.push('AcademySchedule.getConflicts');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademyQueries.getAvailableDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        if (!CharacterList || typeof CharacterList.render !== 'function') {
            missing.push('CharacterList.render');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (missing.length > 0) {
            console.warn('StudentTab: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__studentTabLoaded = true;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    function persistMutation(successMessage, errorMessage) {
        if (typeof window.saveData !== 'function') {
            showNotification('Changes were applied in memory, but persistent storage is unavailable.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (successMessage) {
                    showNotification(successMessage, 'success');
                }
            })
            .catch(function() {
                if (errorMessage) {
                    showNotification(errorMessage, 'error');
                }
            });
    }

    // ============================================================
    // RENDER STUDENT TAB
    // ============================================================

    function renderStudentTab(state) {
        var selectedClassId = state.selectedClassId;
        var selectedStudentId = state.selectedStudentId;
        var week = state.selectedWeek || 1;

        var selectedClass = selectedClassId ? AcademyQueries.getClass(selectedClassId) : null;
        var selectedStudent = selectedStudentId ? CharacterQueries.getCharacterById(selectedStudentId) : null;

        var html = '';

        // Header with class filter info and week selector
        html += '<div class="student-tab-header">';
        html += '<div class="student-tab-title">';
        html += '<h3>Students</h3>';
        if (selectedClass) {
            html += '<span class="student-tab-class">' + escapeHtml(selectedClass.name) + '</span>';
        } else {
            html += '<span class="student-tab-class muted">No class selected</span>';
        }
        html += '</div>';
        html += '<div class="student-tab-controls">';
        html += '<div class="week-selector">';
        html += '<label>Week:</label>';
        html += '<input type="number" id="student-week-input" value="' + week + '" min="1" max="52" class="small">';
        html += '<button id="student-week-apply" class="small secondary">Apply</button>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        // Character list (reuses CharacterList)
        html += '<div class="student-tab-layout">';
        html += '<div class="student-tab-sidebar">';
        html += '<div class="student-tab-filters">';
        html += '<input type="text" id="student-name-filter" placeholder="Filter by name..." class="small">';
        html += '<button id="student-filter-clear" class="small secondary">Clear</button>';
        html += '</div>';
        html += '<div id="student-character-list">';
        html += '<!-- CharacterList will render here -->';
        html += '</div>';
        html += '</div>';

        // Student detail
        html += '<div class="student-tab-detail">';
        if (selectedStudent) {
            html += renderStudentDetail(state, selectedStudent);
        } else {
            html += '<p class="empty-state">Select a student to view details.</p>';
        }
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER STUDENT DETAIL
    // ============================================================

    function renderStudentDetail(state, student) {
        if (!student) {
            return '<p class="empty-state">Student not found.</p>';
        }

        var studentId = student.id;
        var week = state.selectedWeek || 1;
        var name = CharacterQueries.getDisplayName(student);
        var status = CharacterQueries.getCurrentStatus(student);

        var html = '';

        // Header
        html += '<div class="student-detail-header">';
        html += '<h3 class="student-detail-name">' + escapeHtml(name) + '</h3>';
        html += '<span class="student-detail-status">' + escapeHtml(status) + '</span>';
        if (student.deceased) {
            html += '<span class="student-detail-deceased">[Deceased]</span>';
        }
        html += '</div>';

        // Tabs within detail
        html += '<div class="student-detail-tabs">';
        html += '<button class="detail-tab-btn active" data-tab="grades">Grades</button>';
        html += '<button class="detail-tab-btn" data-tab="ranking">Ranking</button>';
        html += '<button class="detail-tab-btn" data-tab="schedule">Schedule</button>';
        html += '</div>';

        // Grades tab
        html += '<div class="detail-tab-panel active" data-tab="grades">';
        html += renderGradesTab(state, student);
        html += '</div>';

        // Ranking tab
        html += '<div class="detail-tab-panel" data-tab="ranking" style="display:none;">';
        html += renderRankingTab(state, student);
        html += '</div>';

        // Schedule tab
        html += '<div class="detail-tab-panel" data-tab="schedule" style="display:none;">';
        html += renderScheduleTab(state, student);
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER GRADES TAB
    // ============================================================

    function renderGradesTab(state, student) {
        var studentId = student.id;
        var week = state.selectedWeek || 1;

        var grades = AcademyGrades.getGrades(studentId, week);
        var summary = AcademyGrades.calculateSummary(studentId, week);

        var html = '';

        // Summary stats
        html += '<div class="grades-summary">';
        if (summary) {
            html += '<div class="stat-item"><span class="stat-label">Average</span><span class="stat-value">' + 
                (summary.average !== null ? summary.average.toFixed(1) + '%' : '--') + '</span></div>';
            html += '<div class="stat-item"><span class="stat-label">Graded</span><span class="stat-value">' + 
                summary.gradedCount + '/' + summary.scheduledCount + '</span></div>';
            html += '<div class="stat-item"><span class="stat-label">Weighted</span><span class="stat-value">' + 
                summary.totalWeight.toFixed(1) + '</span></div>';
        } else {
            html += '<div class="stat-item"><span class="stat-label">No grades</span></div>';
        }
        html += '</div>';

        // Grade table
        var disciplines = AcademyQueries.getAvailableDisciplines(week);
        if (disciplines.length === 0) {
            html += '<p class="empty-state small">No disciplines available this week.</p>';
        } else {
            html += '<div class="grades-table-container">';
            html += '<table class="grades-table">';
            html += '<thead>';
            html += '<tr>';
            html += '<th>Discipline</th>';
            html += '<th>Type</th>';
            html += '<th>Weight</th>';
            html += '<th>Score</th>';
            html += '<th>Letter</th>';
            html += '<th>Weighted</th>';
            html += '</tr>';
            html += '</thead>';
            html += '<tbody>';

            for (var i = 0; i < disciplines.length; i++) {
                var disc = disciplines[i];
                var score = grades[disc.id] !== undefined ? grades[disc.id] : '';
                var letter = '';
                var weighted = '';

                if (score !== '' && score !== null) {
                    var numScore = parseFloat(score);
                    if (!isNaN(numScore) && numScore >= 0 && numScore <= 100) {
                        letter = AcademyGrades.getGradeLetter ? AcademyGrades.getGradeLetter(disc, numScore) : '';
                        var weight = parseFloat(disc.weight) || 1;
                        weighted = (numScore * weight).toFixed(1);
                    }
                }

                var isMandatory = disc.type === 'mandatory';

                html += '<tr>';
                html += '<td>' + escapeHtml(disc.name) + '</td>';
                html += '<td>' + (isMandatory ? 'Mandatory' : 'Optional') + '</td>';
                html += '<td>' + escapeHtml(disc.weight || '1') + '</td>';
                html += '<td>';
                html += '<input type="number" class="grade-input" data-discipline="' + escapeHtml(disc.id) + '" ';
                html += 'value="' + escapeHtml(score) + '" min="0" max="100" step="0.5" ';
                html += 'style="width:60px;padding:2px 4px;font-size:0.7rem;">';
                html += '</td>';
                html += '<td class="grade-letter">' + escapeHtml(letter) + '</td>';
                html += '<td class="weighted-score">' + escapeHtml(weighted) + '</td>';
                html += '</tr>';
            }

            html += '</tbody>';
            html += '</table>';
            html += '</div>';

            html += '<div class="grades-actions">';
            html += '<button id="grades-save-btn" class="primary small">Save Grades</button>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER RANKING TAB
    // ============================================================

    function renderRankingTab(state, student) {
        var studentId = student.id;
        var week = state.selectedWeek || 1;

        var rankings = AcademyRanking.getRankingsWithDetails(week);
        var studentRank = AcademyRanking.getStudentRank(week, studentId);

        var html = '';

        // Header
        html += '<div class="ranking-header">';
        html += '<div class="ranking-info">';
        html += '<span class="ranking-label">Your Rank:</span>';
        html += '<span class="ranking-value">' + (studentRank !== null ? '#' + studentRank : 'Unranked') + '</span>';
        html += '<span class="ranking-total">of ' + rankings.length + ' students</span>';
        html += '</div>';
        html += '<div class="ranking-actions">';
        html += '<button id="ranking-auto-btn" class="primary small">Auto-Generate</button>';
        html += '<button id="ranking-refresh-btn" class="secondary small">Refresh</button>';
        html += '</div>';
        html += '</div>';

        // Ranking table
        if (rankings.length === 0) {
            html += '<p class="empty-state small">No rankings for this week.</p>';
        } else {
            html += '<div class="ranking-table-container">';
            html += '<table class="ranking-table">';
            html += '<thead>';
            html += '<tr>';
            html += '<th>Rank</th>';
            html += '<th>Student</th>';
            html += '<th>Status</th>';
            html += '<th>Average</th>';
            html += '</tr>';
            html += '</thead>';
            html += '<tbody>';

            for (var i = 0; i < rankings.length; i++) {
                var entry = rankings[i];
                var char = CharacterQueries.getCharacterById(entry.studentId);
                var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
                var status = char ? CharacterQueries.getCurrentStatus(char) : '';
                var isCurrent = String(entry.studentId) === String(studentId);

                var summary = AcademyGrades.calculateSummary(entry.studentId, week);
                var avg = summary && summary.average !== null ? summary.average.toFixed(1) + '%' : '--';

                html += '<tr class="' + (isCurrent ? 'current-student' : '') + '">';
                html += '<td><strong>#' + entry.rank + '</strong></td>';
                html += '<td>' + escapeHtml(name) + (isCurrent ? ' <span class="current-badge">(You)</span>' : '') + '</td>';
                html += '<td>' + escapeHtml(status) + '</td>';
                html += '<td>' + escapeHtml(avg) + '</td>';
                html += '</tr>';
            }

            html += '</tbody>';
            html += '</table>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER SCHEDULE TAB
    // ============================================================

    function renderScheduleTab(state, student) {
        var studentId = student.id;
        var week = state.selectedWeek || 1;

        var schedule = AcademySchedule.getStudentSchedule(studentId, week);
        var restDays = AcademySchedule.getStudentRestDays(studentId, week);

        var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        var hours = [];
        for (var h = 8; h <= 18; h++) {
            hours.push(h);
        }

        var html = '';

        // Rest days
        html += '<div class="schedule-rest-days">';
        html += '<label>Rest Days:</label>';
        html += '<div class="rest-days-checkboxes">';
        for (var d = 1; d <= 7; d++) {
            var checked = restDays.indexOf(d) !== -1;
            html += '<label class="rest-day-check">';
            html += '<input type="checkbox" class="rest-day-checkbox" value="' + d + '" ' + (checked ? 'checked' : '') + '>';
            html += dayNames[d - 1];
            html += '</label>';
        }
        html += '</div>';
        html += '<button id="schedule-rest-days-save" class="small secondary">Save Rest Days</button>';
        html += '</div>';

        // Schedule grid
        html += '<div class="schedule-grid-container">';
        html += '<table class="schedule-grid">';
        html += '<thead>';
        html += '<tr><th>Time</th>';
        for (var d2 = 1; d2 <= 7; d2++) {
            html += '<th>' + dayNames[d2 - 1] + '</th>';
        }
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var h2 = 0; h2 < hours.length; h2++) {
            var hour = hours[h2];
            var timeLabel = hour + ':00';
            html += '<tr>';
            html += '<td class="schedule-time">' + timeLabel + '</td>';

            for (var d3 = 1; d3 <= 7; d3++) {
                var classId = schedule[d3] && schedule[d3][hour] ? schedule[d3][hour] : null;
                var display = '';
                var className = 'schedule-empty';
                var duration = 1;
                var instructorName = '';

                if (restDays.indexOf(d3) !== -1) {
                    display = '--';
                    className = 'schedule-rest';
                } else if (classId) {
                    var details = AcademySchedule.getClassDetails(studentId, week, d3, hour);
                    display = details ? details.disciplineName : 'Unknown';
                    className = 'schedule-class';
                    duration = details ? details.duration : 1;
                    instructorName = details ? details.instructorName : '';
                } else {
                    display = '·';
                    className = 'schedule-empty';
                }

                var dataAttrs = '';
                if (classId) {
                    dataAttrs = ' data-discipline="' + escapeHtml(classId) + '"';
                }

                html += '<td class="' + className + '" data-day="' + d3 + '" data-hour="' + hour + '"' + dataAttrs + '>';
                html += '<span class="schedule-cell-content">' + escapeHtml(display) + '</span>';
                if (classId && duration > 1) {
                    html += '<span class="schedule-duration">' + duration + 'h</span>';
                }
                if (instructorName) {
                    html += '<span class="schedule-instructor">(' + escapeHtml(instructorName) + ')</span>';
                }
                html += '</td>';
            }

            html += '</tr>';
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

    function bindStudentTabEvents(container) {
        // Apply week
        var weekApply = container.querySelector('#student-week-apply');
        if (weekApply) {
            weekApply.addEventListener('click', function() {
                var input = container.querySelector('#student-week-input');
                if (input) {
                    var week = parseInt(input.value, 10);
                    if (!isNaN(week) && week >= 1 && week <= 52) {
                        if (window.academyState && typeof window.academyState.selectWeek === 'function') {
                            window.academyState.selectWeek(week);
                            if (typeof window.refreshStudentDetail === 'function') {
                                window.refreshStudentDetail();
                            }
                            if (typeof window.refreshAcademy === 'function') {
                                window.refreshAcademy();
                            }
                        }
                    } else {
                        showNotification('Please enter a valid week (1-52).', 'error');
                    }
                }
            });
        }

        // Week input enter key
        var weekInput = container.querySelector('#student-week-input');
        if (weekInput) {
            weekInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    var applyBtn = container.querySelector('#student-week-apply');
                    if (applyBtn) { applyBtn.click(); }
                }
            });
        }

        // Student name filter
        var nameFilter = container.querySelector('#student-name-filter');
        if (nameFilter) {
            nameFilter.addEventListener('input', function() {
                if (CharacterList && typeof CharacterList.render === 'function') {
                    CharacterList.render();
                }
            });
        }

        // Clear filter
        var clearBtn = container.querySelector('#student-filter-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                var filter = container.querySelector('#student-name-filter');
                if (filter) { filter.value = ''; }
                if (CharacterList && typeof CharacterList.render === 'function') {
                    CharacterList.render();
                }
            });
        }

        // Detail tab switching
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.detail-tab-btn');
            if (btn) {
                var tab = btn.dataset.tab;
                if (tab) {
                    switchDetailTab(container, tab);
                }
            }
        });

        // Save grades
        var saveGradesBtn = container.querySelector('#grades-save-btn');
        if (saveGradesBtn) {
            saveGradesBtn.addEventListener('click', function() {
                handleSaveGrades(container);
            });
        }

        // Auto-generate rankings
        var autoRankBtn = container.querySelector('#ranking-auto-btn');
        if (autoRankBtn) {
            autoRankBtn.addEventListener('click', function() {
                handleAutoGenerateRankings(container);
            });
        }

        // Refresh rankings
        var refreshRankBtn = container.querySelector('#ranking-refresh-btn');
        if (refreshRankBtn) {
            refreshRankBtn.addEventListener('click', function() {
                if (window.academyState && typeof window.academyState.getSelectedWeek === 'function') {
                    var week = window.academyState.getSelectedWeek();
                    if (window.academyState && typeof window.academyState.getSelectedStudentId === 'function') {
                        var studentId = window.academyState.getSelectedStudentId();
                        if (studentId) {
                            if (typeof window.refreshStudentDetail === 'function') {
                                window.refreshStudentDetail();
                            }
                        }
                    }
                }
            });
        }

        // Save rest days
        var restDaysBtn = container.querySelector('#schedule-rest-days-save');
        if (restDaysBtn) {
            restDaysBtn.addEventListener('click', function() {
                handleSaveRestDays(container);
            });
        }

        // Grade input live preview
        container.addEventListener('input', function(e) {
            var input = e.target.closest('.grade-input');
            if (input) {
                updateGradePreview(input);
            }
        });

        // Grade input blur validation
        container.addEventListener('blur', function(e) {
            var input = e.target.closest('.grade-input');
            if (input) {
                validateGradeInput(input);
            }
        }, true);

        // Rest day checkbox change
        container.addEventListener('change', function(e) {
            var checkbox = e.target.closest('.rest-day-checkbox');
            if (checkbox) {
                // Preview change - actual save happens on button click
            }
        });

        // Character list selection - delegate to CharacterList events
        // CharacterList handles its own click events
    }

    // ============================================================
    // DETAIL TAB SWITCHING
    // ============================================================

    function switchDetailTab(container, tab) {
        var btns = container.querySelectorAll('.detail-tab-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].dataset.tab === tab);
        }

        var panels = container.querySelectorAll('.detail-tab-panel');
        for (var j = 0; j < panels.length; j++) {
            var panel = panels[j];
            var isActive = panel.dataset.tab === tab;
            panel.style.display = isActive ? 'block' : 'none';
            panel.classList.toggle('active', isActive);
        }
    }

    // ============================================================
    // GRADE HELPERS
    // ============================================================

    function updateGradePreview(input) {
        var row = input.closest('tr');
        if (!row) { return; }

        var disciplineId = input.dataset.discipline;
        var value = input.value.trim();
        var letterEl = row.querySelector('.grade-letter');
        var weightedEl = row.querySelector('.weighted-score');

        if (!disciplineId) { return; }

        var disc = AcademyQueries.getDiscipline(disciplineId);
        if (!disc) { return; }

        if (value !== '' && !isNaN(Number(value))) {
            var numericScore = Number(value);
            if (numericScore >= 0 && numericScore <= 100) {
                var letter = AcademyGrades.getGradeLetter ? AcademyGrades.getGradeLetter(disc, numericScore) : '';
                if (letterEl) {
                    letterEl.textContent = letter || '--';
                }
                if (weightedEl && disc.weight) {
                    var weighted = numericScore * Number(disc.weight);
                    weightedEl.textContent = weighted.toFixed(1);
                }
            }
        } else if (value === '') {
            if (letterEl) { letterEl.textContent = '--'; }
            if (weightedEl) { weightedEl.textContent = '--'; }
        }
    }

    function validateGradeInput(input) {
        var value = input.value.trim();
        if (value === '') { return; }

        var num = Number(value);
        if (isNaN(num) || num < 0 || num > 100) {
            input.style.borderColor = 'var(--danger)';
        } else {
            input.style.borderColor = 'var(--accent)';
        }
    }

    function handleSaveGrades(container) {
        var studentId = window.academyState ? window.academyState.getSelectedStudentId() : null;
        if (!studentId) {
            showNotification('No student selected.', 'error');
            return;
        }

        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var grades = {};
        var hasChanges = false;
        var invalidInputs = [];

        var inputs = container.querySelectorAll('.grade-input');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var disciplineId = input.dataset.discipline;
            var currentValue = input.value.trim();

            if (currentValue === '') {
                grades[disciplineId] = null;
                hasChanges = true;
                continue;
            }

            var numericValue = Number(currentValue);
            if (!isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
                invalidInputs.push(disciplineId);
                continue;
            }

            grades[disciplineId] = Math.round(numericValue * 10) / 10;
            hasChanges = true;
        }

        if (invalidInputs.length > 0) {
            var names = invalidInputs.map(function(id) {
                var d = AcademyQueries.getDiscipline(id);
                return d ? d.name : id;
            });
            showNotification('Invalid scores for: ' + names.join(', '), 'error');
            return;
        }

        if (!hasChanges) {
            showNotification('No changes to save.', 'info');
            return;
        }

        var result = AcademyGrades.saveGrades(studentId, week, grades);

        if (result && result.success) {
            showNotification('Grades saved successfully.', 'success');
            if (typeof window.refreshStudentDetail === 'function') {
                window.refreshStudentDetail();
            }
            persistMutation(null, 'Grades saved in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to save grades.', 'error');
        }
    }

    // ============================================================
    // RANKING HELPERS
    // ============================================================

    function handleAutoGenerateRankings(container) {
        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        if (!confirm('Auto-generate rankings for week ' + week + ' from grade data?')) {
            return;
        }

        var result = AcademyRanking.autoGenerate(week);

        if (result && result.success) {
            var count = result.count || 0;
            showNotification('Auto-generated rankings for week ' + week + ' (' + count + ' students ranked).', 'success');
            if (typeof window.refreshStudentDetail === 'function') {
                window.refreshStudentDetail();
            }
            persistMutation(null, 'Rankings generated in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to auto-generate rankings.', 'error');
        }
    }

    // ============================================================
    // SCHEDULE HELPERS
    // ============================================================

    function handleSaveRestDays(container) {
        var studentId = window.academyState ? window.academyState.getSelectedStudentId() : null;
        if (!studentId) {
            showNotification('No student selected.', 'error');
            return;
        }

        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var checkboxes = container.querySelectorAll('.rest-day-checkbox:checked');
        var days = [];
        for (var i = 0; i < checkboxes.length; i++) {
            days.push(parseInt(checkboxes[i].value, 10));
        }

        var result = AcademySchedule.setRestDays(studentId, week, days);

        if (result && result.success) {
            showNotification('Rest days saved successfully.', 'success');
            if (typeof window.refreshStudentDetail === 'function') {
                window.refreshStudentDetail();
            }
            persistMutation(null, 'Rest days saved in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to save rest days.', 'error');
        }
    }

    // ============================================================
    // CHARACTER LIST INTEGRATION
    // ============================================================

    function refreshCharacterList() {
        var container = document.getElementById('student-character-list');
        if (!container) { return; }

        // Render CharacterList into the container
        if (CharacterList && typeof CharacterList.render === 'function') {
            // Set up class filter based on selected class
            var classId = window.academyState ? window.academyState.getSelectedClassId() : null;
            if (classId) {
                var classFilter = document.getElementById('char-class-filter');
                if (classFilter) {
                    classFilter.value = classId;
                }
            }
            CharacterList.render();
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.StudentTab = {
        render: renderStudentTab,
        renderStudentDetail: renderStudentDetail,
        renderGradesTab: renderGradesTab,
        renderRankingTab: renderRankingTab,
        renderScheduleTab: renderScheduleTab,
        bindEvents: bindStudentTabEvents,
        refreshCharacterList: refreshCharacterList,
        switchDetailTab: switchDetailTab,
        handleSaveGrades: handleSaveGrades,
        handleAutoGenerateRankings: handleAutoGenerateRankings,
        handleSaveRestDays: handleSaveRestDays
    };

})();