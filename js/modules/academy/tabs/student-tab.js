/**
 * modules/academy/tabs/student-tab.js - Student Sub-Tab
 * Handles student management, grades, rankings, and schedules
 * 
 * This module is responsible for:
 *   - Character list filtered by selected class (reuses CharacterList)
 *   - Student detail view (grades, ranking, schedule)
 *   - Grade entry and editing
 *   - Ranking display and management
 *   - Schedule viewing
 * 
 * IMPORTANT:
 *   - UI-ONLY - all mutations delegate to domain cores
 *   - Uses AcademyClasses DIRECTLY for class entity mutations
 *   - Uses AcademyClasses.addStudent/removeStudent for membership
 *     (DEPRECATED DELEGATES to CharacterClasses; still work but will
 *     be removed once the Academy UI rework lands)
 *   - Uses AcademyUI for state management
 *   - Uses AcademyAggregator for projections
 *   - Uses AcademyGrades for grade operations
 *   - Uses AcademyRanking for ranking operations (lazy)
 *   - Uses AcademySchedule for schedule operations
 *   - Uses AcademyQueries for read-only access
 *   - CharacterList is REUSED (not duplicated)
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 * 
 * PROMISE CONTRACT (v15+):
 *   - AcademyClasses.addStudent / removeStudent return Promises.
 *   - AcademyGrades.saveGrades returns a Promise.
 *   - AcademyRanking.autoGenerate is synchronous (see note below).
 *   - AcademySchedule.setStudentRestDays is synchronous.
 *   - AcademySchedule.getStudentRestDays is synchronous.
 * 
 * KNOWN LIMITATION:
 *   - AcademyRanking.autoGenerate currently mutates academy.rankings
 *     directly and does not go through MutationPipeline. This is a
 *     pre-existing limitation carried forward from the pre-v15 code.
 *     Fixing it is out of scope for the v15 data-model pass.
 * 
 * DEPENDENCY RESOLUTION:
 *   - Modules guaranteed to be loaded before this file are captured at
 *     module load.
 *   - Modules NOT guaranteed at load time (CharacterList, AcademyRanking)
 *     are resolved lazily at call time via accessor functions.
 * 
 * DEPENDENCIES (loaded before this file - captured at load):
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyClasses
 *   - window.AcademyQueries
 *   - window.AcademyGrades
 *   - window.AcademySchedule
 *   - window.CharacterQueries
 *   - window.CalendarConstants
 *   - window.NotificationSystem
 *   - window.DomUtils
 * 
 * DEPENDENCIES (lazy - resolved at call time):
 *   - window.CharacterList
 *   - window.AcademyRanking
 * 
 * USAGE:
 *   var tab = window.StudentTab;
 *   var html = tab.render(state);
 *   tab.bindEvents(container);
 */

(function() {
    'use strict';

    if (window.__studentTabLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - LOAD-TIME (guaranteed available)
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyClasses = window.AcademyClasses;
    var AcademyQueries = window.AcademyQueries;
    var AcademyGrades = window.AcademyGrades;
    var AcademySchedule = window.AcademySchedule;
    var CharacterQueries = window.CharacterQueries;
    var CalendarConstants = window.CalendarConstants;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY RESOLUTION - LAZY (not guaranteed at load time)
    // ============================================================

    /**
     * Get CharacterList, resolved at call time.
     * CharacterList loads after this module in the current script order
     * (Character domain loads after Academy domain).
     * 
     * @returns {object|null} CharacterList or null if not yet loaded
     */
    function getCharacterList() {
        return window.CharacterList || null;
    }

    /**
     * Get AcademyRanking, resolved at call time.
     * AcademyRanking loads after this module in the current script order.
     * 
     * @returns {object|null} AcademyRanking or null if not yet loaded
     */
    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - LOAD-TIME ONLY
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyUI || typeof AcademyUI.getSelectedClassId !== 'function') {
            missing.push('AcademyUI.getSelectedClassId');
        }
        if (!AcademyUI || typeof AcademyUI.getSelectedStudentId !== 'function') {
            missing.push('AcademyUI.getSelectedStudentId');
        }
        if (!AcademyUI || typeof AcademyUI.selectStudent !== 'function') {
            missing.push('AcademyUI.selectStudent');
        }
        if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
            missing.push('AcademyUI.getDisplayWeek');
        }

        if (!AcademyAggregator || typeof AcademyAggregator.getStudentViewModel !== 'function') {
            missing.push('AcademyAggregator.getStudentViewModel');
        }
        if (!AcademyAggregator || typeof AcademyAggregator.getClassViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassViewModel');
        }

        if (!AcademyClasses || typeof AcademyClasses.addStudent !== 'function') {
            missing.push('AcademyClasses.addStudent');
        }
        if (!AcademyClasses || typeof AcademyClasses.removeStudent !== 'function') {
            missing.push('AcademyClasses.removeStudent');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassStudents !== 'function') {
            missing.push('AcademyQueries.getClassStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableStudents !== 'function') {
            missing.push('AcademyQueries.getAvailableStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }

        if (!AcademyGrades || typeof AcademyGrades.getStudentGrades !== 'function') {
            missing.push('AcademyGrades.getStudentGrades');
        }
        if (!AcademyGrades || typeof AcademyGrades.saveGrades !== 'function') {
            missing.push('AcademyGrades.saveGrades');
        }
        if (!AcademyGrades || typeof AcademyGrades.calculateSummary !== 'function') {
            missing.push('AcademyGrades.calculateSummary');
        }
        if (!AcademyGrades || typeof AcademyGrades.calculateStudentGPA !== 'function') {
            missing.push('AcademyGrades.calculateStudentGPA');
        }

        if (!AcademySchedule || typeof AcademySchedule.getStudentSchedule !== 'function') {
            missing.push('AcademySchedule.getStudentSchedule');
        }
        if (!AcademySchedule || typeof AcademySchedule.getStudentRestDays !== 'function') {
            missing.push('AcademySchedule.getStudentRestDays');
        }
        if (!AcademySchedule || typeof AcademySchedule.setStudentRestDays !== 'function') {
            missing.push('AcademySchedule.setStudentRestDays');
        }
        if (!AcademySchedule || typeof AcademySchedule.getClassDetails !== 'function') {
            missing.push('AcademySchedule.getClassDetails');
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

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }
        if (!CalendarConstants || typeof CalendarConstants.MAX_WEEK !== 'number') {
            missing.push('CalendarConstants.MAX_WEEK');
        }
        if (!CalendarConstants || typeof CalendarConstants.DAY_NAMES_SHORT !== 'object') {
            missing.push('CalendarConstants.DAY_NAMES_SHORT');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        // CharacterList and AcademyRanking deliberately not checked
        // here — resolved lazily at call time.

        if (missing.length > 0) {
            console.warn('[StudentTab] Missing load-time dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // REFRESH HELPER
    // ============================================================

    var _currentContainer = null;

    /**
     * Ask the Academy shell to re-render the current sub-tab.
     * Falls back to a local re-render if the shell isn't available.
     */
    function requestRefresh() {
        if (window.AcademyEvents && typeof window.AcademyEvents.refreshUI === 'function') {
            window.AcademyEvents.refreshUI();
        } else if (_currentContainer) {
            var html = render({
                selectedClassId: AcademyUI.getSelectedClassId(),
                selectedStudentId: AcademyUI.getSelectedStudentId(),
                displayWeek: AcademyUI.getDisplayWeek()
            });
            _currentContainer.innerHTML = html;
            bindEvents(_currentContainer);
        }
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK || 1;
    var MAX_WEEK = CalendarConstants.MAX_WEEK || 52;
    var DAY_NAMES_SHORT = CalendarConstants.DAY_NAMES_SHORT || ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR || 8;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR || 18;

    // ============================================================
    // RENDER - Main entry point
    // ============================================================

    function render(state) {
        if (!checkDependencies()) {
            return '<p class="empty-state">Student tab dependencies not loaded.</p>';
        }

        state = state || {};
        var selectedClassId = state.selectedClassId || null;
        var selectedStudentId = state.selectedStudentId || null;
        var week = state.displayWeek || 1;

        var selectedClass = selectedClassId ? AcademyQueries.getClass(selectedClassId) : null;
        var studentVM = selectedStudentId ? AcademyAggregator.getStudentViewModel(selectedStudentId, {
            week: week,
            includeGrades: true,
            includeRanking: true,
            includeSchedule: true,
            includeClasses: true
        }) : null;

        var html = '';

        // Header
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
        html += '<label for="student-week-input">Week:</label>';
        html += '<input type="number" id="student-week-input" value="' + week + '" min="' + MIN_WEEK + '" max="' + MAX_WEEK + '" class="small">';
        html += '<button id="student-week-apply" class="small secondary">Apply</button>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        // Layout
        html += '<div class="student-tab-layout">';
        html += '<div class="student-tab-sidebar">';
        html += '<div class="student-tab-filters">';
        html += '<input type="text" id="student-name-filter" placeholder="Filter by name..." class="small" value="' +
            escapeHtml((AcademyUI.getFilter('student') || {}).search || '') + '">';
        html += '<button id="student-filter-clear" class="small secondary">Clear</button>';
        html += '</div>';
        html += '<div id="student-character-list">';
        html += '<!-- CharacterList will render here -->';
        html += '</div>';
        html += '</div>';

        // Detail
        html += '<div class="student-tab-detail">';
        if (studentVM) {
            html += renderStudentDetail(studentVM, week);
        } else if (selectedClassId) {
            html += '<p class="empty-state">Select a student to view details.</p>';
        } else {
            html += '<p class="empty-state">Select a class to view students.</p>';
        }
        html += '</div>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER STUDENT DETAIL
    // ============================================================

    function renderStudentDetail(studentVM, week) {
        if (!studentVM) {
            return '<p class="empty-state">Student not found.</p>';
        }

        var html = '';

        // Header
        html += '<div class="student-detail-header">';
        html += '<h3 class="student-detail-name">' + escapeHtml(studentVM.name) + '</h3>';
        html += '<span class="student-detail-status">' + escapeHtml(studentVM.status || '') + '</span>';
        if (studentVM.deceased) {
            html += '<span class="student-detail-deceased">[Deceased]</span>';
        }
        html += '</div>';

        // Tabs
        html += '<div class="student-detail-tabs">';
        html += '<button class="detail-tab-btn active" data-tab="grades">Grades</button>';
        html += '<button class="detail-tab-btn" data-tab="ranking">Ranking</button>';
        html += '<button class="detail-tab-btn" data-tab="schedule">Schedule</button>';
        html += '</div>';

        // Grades tab
        html += '<div class="detail-tab-panel active" data-tab="grades">';
        html += renderGradesTab(studentVM, week);
        html += '</div>';

        // Ranking tab
        html += '<div class="detail-tab-panel" data-tab="ranking" style="display:none;">';
        html += renderRankingTab(studentVM, week);
        html += '</div>';

        // Schedule tab
        html += '<div class="detail-tab-panel" data-tab="schedule" style="display:none;">';
        html += renderScheduleTab(studentVM, week);
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER GRADES TAB
    // ============================================================

    function renderGradesTab(studentVM, week) {
        var grades = studentVM.grades || [];
        var gradeSummary = studentVM.gradeSummary || {};
        var gpa = studentVM.gpa || {};

        var html = '';

        // Summary
        html += '<div class="grades-summary">';
        html += '<div class="stat-item"><span class="stat-label">Average</span><span class="stat-value">' +
            (gradeSummary.average !== undefined && gradeSummary.average !== null ? gradeSummary.average.toFixed(1) + '%' : '--') + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">GPA</span><span class="stat-value">' +
            (gpa.gpa !== undefined && gpa.gpa !== null ? gpa.gpa.toFixed(2) : '--') + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Pass Rate</span><span class="stat-value">' +
            (gradeSummary.passRate !== undefined && gradeSummary.passRate !== null ? gradeSummary.passRate + '%' : '--') + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Graded</span><span class="stat-value">' +
            (gradeSummary.passing !== undefined && gradeSummary.failing !== undefined ? (gradeSummary.passing + gradeSummary.failing) : '0') + '</span></div>';
        html += '</div>';

        // Grades table
        if (grades.length === 0) {
            html += '<p class="empty-state small">No grades recorded for this week.</p>';
        } else {
            html += '<div class="grades-table-container">';
            html += '<table class="grades-table">';
            html += '<thead>';
            html += '<tr>';
            html += '<th>Discipline</th>';
            html += '<th>Type</th>';
            html += '<th>Weight</th>';
            html += '<th>Score</th>';
            html += '<th>Grade</th>';
            html += '<th>Weighted</th>';
            html += '</tr>';
            html += '</thead>';
            html += '<tbody>';

            for (var i = 0; i < grades.length; i++) {
                var g = grades[i];
                var letter = getLetterGrade(g.percentage || g.score || 0);
                var weighted = (g.weight || 1) * (g.percentage || g.score || 0);

                html += '<tr>';
                html += '<td>' + escapeHtml(g.disciplineName || 'Unknown') + '</td>';
                html += '<td>' + escapeHtml(g.type || 'assignment') + '</td>';
                html += '<td>' + (g.weight || 1).toFixed(1) + '</td>';
                html += '<td>';
                html += '<input type="number" class="grade-input" data-discipline="' + escapeAttribute(g.disciplineId) + '" ';
                html += 'value="' + (g.score !== undefined && g.score !== null ? g.score : '') + '" min="0" max="100" step="0.5" ';
                html += 'style="width:60px;padding:2px 4px;font-size:0.7rem;">';
                html += '</td>';
                html += '<td class="grade-letter">' + escapeHtml(letter.label) + '</td>';
                html += '<td class="weighted-score">' + (weighted ? weighted.toFixed(1) : '--') + '</td>';
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

    function renderRankingTab(studentVM, week) {
        var ranking = studentVM.ranking || null;

        var html = '';

        // Current ranking
        html += '<div class="ranking-header">';
        html += '<div class="ranking-info">';
        html += '<span class="ranking-label">Rank:</span>';
        html += '<span class="ranking-value">' + (ranking ? '#' + ranking.rank : 'Unranked') + '</span>';
        if (ranking && ranking.totalStudents) {
            html += '<span class="ranking-total">of ' + ranking.totalStudents + ' students</span>';
        }
        if (ranking && ranking.className) {
            html += '<span class="ranking-class">in ' + escapeHtml(ranking.className) + '</span>';
        }
        html += '</div>';
        html += '<div class="ranking-actions">';
        html += '<button id="ranking-auto-btn" class="primary small">Auto-Generate</button>';
        html += '</div>';
        html += '</div>';

        // Ranking details
        if (ranking) {
            html += '<div class="ranking-details">';
            html += '<div class="ranking-stat"><span class="stat-label">Average</span><span class="stat-value">' +
                (ranking.average !== null ? ranking.average.toFixed(1) + '%' : '--') + '</span></div>';
            html += '<div class="ranking-stat"><span class="stat-label">Grade Count</span><span class="stat-value">' +
                (ranking.gradeCount || 0) + '</span></div>';
            html += '</div>';
        } else {
            html += '<p class="empty-state small">No ranking data available.</p>';
        }

        return html;
    }

    // ============================================================
    // RENDER SCHEDULE TAB
    // ============================================================

    function renderScheduleTab(studentVM, week) {
        var schedule = studentVM.schedule || [];
        var restDays = AcademySchedule.getStudentRestDays(studentVM.id, week);

        var dayNames = DAY_NAMES_SHORT.slice(1);
        var startHour = CALENDAR_START_HOUR;
        var endHour = CALENDAR_END_HOUR;

        var hours = [];
        for (var h = startHour; h <= endHour; h++) {
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

        // Build lookup for schedule entries
        var scheduleLookup = {};
        for (var i = 0; i < schedule.length; i++) {
            var entry = schedule[i];
            var key = entry.day + '_' + entry.hour;
            scheduleLookup[key] = entry;
        }

        for (var h2 = 0; h2 < hours.length; h2++) {
            var hour = hours[h2];
            html += '<tr>';
            html += '<td class="schedule-time">' + hour + ':00</td>';

            for (var d3 = 1; d3 <= 7; d3++) {
                var key = d3 + '_' + hour;
                var entry = scheduleLookup[key] || null;
                var isRestDay = restDays.indexOf(d3) !== -1;

                var display = '';
                var className = 'schedule-empty';

                if (isRestDay) {
                    display = '--';
                    className = 'schedule-rest';
                } else if (entry) {
                    display = entry.disciplineName || 'Unknown';
                    className = 'schedule-class';
                    if (entry.duration && entry.duration > 1) {
                        display += ' (' + entry.duration + 'h)';
                    }
                } else {
                    display = '\u00b7';
                    className = 'schedule-empty';
                }

                html += '<td class="' + className + '" data-day="' + d3 + '" data-hour="' + hour + '"';
                if (entry) {
                    html += ' data-discipline="' + escapeAttribute(entry.disciplineId || '') + '"';
                }
                html += '>';
                html += '<span class="schedule-cell-content">' + escapeHtml(display) + '</span>';
                if (entry && entry.instructorName) {
                    html += '<span class="schedule-instructor">(' + escapeHtml(entry.instructorName) + ')</span>';
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
    // HELPER - Letter Grade
    // ============================================================

    function getLetterGrade(score) {
        var num = Number(score);
        if (isNaN(num) || num < 0 || num > 100) {
            return { label: '?', description: 'Invalid' };
        }

        if (num >= 90) { return { label: 'A', description: 'Excellent' }; }
        if (num >= 80) { return { label: 'B', description: 'Good' }; }
        if (num >= 70) { return { label: 'C', description: 'Satisfactory' }; }
        if (num >= 60) { return { label: 'D', description: 'Below Average' }; }
        return { label: 'F', description: 'Failing' };
    }

    // ============================================================
    // REFRESH CHARACTER LIST
    // ============================================================

    function refreshCharacterList() {
        var container = document.getElementById('student-character-list');
        if (!container) { return; }

        // ---- RESOLVE CHARACTERLIST AT CALL TIME ----
        var CharacterList = getCharacterList();
        if (!CharacterList || typeof CharacterList.render !== 'function') {
            container.innerHTML = '<p class="empty-state small">Character list not available.</p>';
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        var classFilter = document.getElementById('char-class-filter');
        if (classFilter && classId) {
            classFilter.value = classId;
        }

        // CharacterList.render() reads its own filter inputs and
        // renders into #characters-container. If that container is
        // not present in the Academy sidebar, the list won't appear
        // here — this is a known coupling that Phase 4 will address.
        CharacterList.render();
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindEvents(container) {
        if (!container) {
            return;
        }

        _currentContainer = container;

        // ---- Week apply ----
        var weekApply = container.querySelector('#student-week-apply');
        if (weekApply) {
            weekApply.addEventListener('click', function() {
                var input = container.querySelector('#student-week-input');
                if (input) {
                    var week = parseInt(input.value, 10);
                    if (!isNaN(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                        AcademyUI.setDisplayWeek(week);
                        requestRefresh();
                    } else {
                        notify('Please enter a valid week (' + MIN_WEEK + '-' + MAX_WEEK + ').', 'error');
                    }
                }
            });
        }

        // ---- Week input enter ----
        var weekInput = container.querySelector('#student-week-input');
        if (weekInput) {
            weekInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    var applyBtn = container.querySelector('#student-week-apply');
                    if (applyBtn) { applyBtn.click(); }
                }
            });
        }

        // ---- Name filter ----
        var nameFilter = container.querySelector('#student-name-filter');
        if (nameFilter) {
            nameFilter.addEventListener('input', function() {
                var tab = this.dataset.tab || 'student';
                var key = 'search';
                AcademyUI.setFilter(tab, key, this.value);
                refreshCharacterList();
            });
        }

        // ---- Filter clear ----
        var clearBtn = container.querySelector('#student-filter-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                var filter = container.querySelector('#student-name-filter');
                if (filter) { filter.value = ''; }
                var tab = 'student';
                AcademyUI.resetFilter(tab);
                refreshCharacterList();
            });
        }

        // ---- Detail tab switching ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.detail-tab-btn');
            if (btn) {
                var tab = btn.dataset.tab;
                if (tab) {
                    switchDetailTab(container, tab);
                }
            }
        });

        // ---- Save grades ----
        var saveGradesBtn = container.querySelector('#grades-save-btn');
        if (saveGradesBtn) {
            saveGradesBtn.addEventListener('click', function() {
                handleSaveGrades(container);
            });
        }

        // ---- Auto-generate rankings ----
        var autoRankBtn = container.querySelector('#ranking-auto-btn');
        if (autoRankBtn) {
            autoRankBtn.addEventListener('click', function() {
                handleAutoGenerateRankings();
            });
        }

        // ---- Save rest days ----
        var restDaysBtn = container.querySelector('#schedule-rest-days-save');
        if (restDaysBtn) {
            restDaysBtn.addEventListener('click', function() {
                handleSaveRestDays(container);
            });
        }

        // ---- Grade input validation ----
        container.addEventListener('input', function(e) {
            var input = e.target.closest('.grade-input');
            if (input) {
                updateGradePreview(input);
            }
        });

        container.addEventListener('blur', function(e) {
            var input = e.target.closest('.grade-input');
            if (input) {
                validateGradeInput(input);
            }
        }, true);

        // ---- Student selection via CharacterList ----
        document.addEventListener('characterSelected', function(e) {
            if (e.detail && e.detail.characterId) {
                AcademyUI.selectStudent(e.detail.characterId);
                requestRefresh();
            }
        });

        // Initial render
        refreshCharacterList();

        return function() {
            // Cleanup - no-op for now
        };
    }

    // ============================================================
    // SWITCH DETAIL TAB
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

        var value = input.value.trim();
        var letterEl = row.querySelector('.grade-letter');
        var weightedEl = row.querySelector('.weighted-score');

        if (value !== '' && !isNaN(Number(value))) {
            var numericScore = Number(value);
            if (numericScore >= 0 && numericScore <= 100) {
                var letter = getLetterGrade(numericScore);
                if (letterEl) { letterEl.textContent = letter.label; }
                if (weightedEl) {
                    // Weight not known from the input alone; leave
                    // the existing weighted display untouched.
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

    // ============================================================
    // HANDLERS
    // ============================================================

    /**
     * Save grades from the currently-rendered grade table.
     * 
     * NOTE: AcademyGrades.saveGrades has signature:
     *     saveGrades(gradesDataArray, options)
     * where gradesDataArray is an array of grade DTOs, each carrying
     * its own studentId, classId, disciplineId, week, score, maxScore,
     * type, weight.
     * 
     * The previous implementation passed (studentId, week, gradesMap),
     * which is not the accepted shape and was silently rejected by the
     * "Grade data array is required" guard. This version constructs the
     * array correctly.
     */
    function handleSaveGrades(container) {
        var studentId = AcademyUI.getSelectedStudentId();
        if (!studentId) {
            notify('No student selected.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        var gradeDtos = [];
        var validationErrors = [];

        var inputs = container.querySelectorAll('.grade-input');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var disciplineId = input.dataset.discipline;
            if (!disciplineId) {
                continue;
            }

            var currentValue = input.value.trim();
            if (currentValue === '') {
                continue;
            }

            var numericValue = Number(currentValue);
            if (!isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
                var d = AcademyQueries.getDiscipline ? AcademyQueries.getDiscipline(disciplineId) : null;
                validationErrors.push(d ? d.name : disciplineId);
                continue;
            }

            gradeDtos.push({
                studentId: studentId,
                classId: classId,
                disciplineId: disciplineId,
                week: week,
                score: Math.round(numericValue * 10) / 10,
                maxScore: 100,
                type: input.dataset.gradeType || 'assignment',
                weight: parseFloat(input.dataset.gradeWeight) || 1.0
            });
        }

        if (validationErrors.length > 0) {
            notify('Invalid scores for: ' + validationErrors.join(', '), 'error');
            return;
        }

        if (gradeDtos.length === 0) {
            notify('No grades to save.', 'info');
            return;
        }

        // AcademyGrades.saveGrades returns a Promise.
        AcademyGrades.saveGrades(gradeDtos, { overwrite: true })
            .then(function(result) {
                if (result && result.success) {
                    var savedCount = (result.data && result.data.successCount) || gradeDtos.length;
                    notify('Saved ' + savedCount + ' grade' + (savedCount === 1 ? '' : 's') + '.', 'success');
                    requestRefresh();
                } else {
                    notify(result ? result.message : 'Failed to save grades.', 'error');
                }
            })
            .catch(function(err) {
                notify('Failed to save grades.', 'error');
                console.error('[StudentTab] handleSaveGrades error:', err);
            });
    }

    /**
     * Auto-generate rankings for the selected class and current week.
     * 
     * NOTE: AcademyRanking.autoGenerate has signature
     *     autoGenerate(classId, week, options)
     * 
     * The previous implementation in this file called
     * autoGenerate(week), which failed silently with
     * "Class ID is required".
     * 
     * autoGenerate is synchronous in the current implementation (it
     * mutates academy.rankings directly and returns a result object).
     * It is not yet routed through MutationPipeline.
     */
    function handleAutoGenerateRankings() {
        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        if (!confirm('Auto-generate rankings for week ' + week + ' from grade data?')) {
            return;
        }

        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking || typeof AcademyRanking.autoGenerate !== 'function') {
            notify('Ranking generation not available.', 'error');
            return;
        }

        var result = AcademyRanking.autoGenerate(classId, week);

        if (result && result.success) {
            var count = result.data && result.data.totalStudents !== undefined
                ? result.data.totalStudents
                : 0;
            var countMsg = count > 0 ? ' (' + count + ' students ranked)' : '';
            notify('Auto-generated rankings for week ' + week + countMsg + '.', 'success');
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to auto-generate rankings.', 'error');
        }
    }

    function handleSaveRestDays(container) {
        var studentId = AcademyUI.getSelectedStudentId();
        if (!studentId) {
            notify('No student selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var checkboxes = container.querySelectorAll('.rest-day-checkbox:checked');
        var days = [];
        for (var i = 0; i < checkboxes.length; i++) {
            var dayNum = parseInt(checkboxes[i].value, 10);
            if (!isNaN(dayNum)) {
                days.push(dayNum);
            }
        }

        // AcademySchedule.setStudentRestDays is synchronous (it
        // delegates to ScheduleCore.setRestDays and returns the result
        // object directly).
        var result = AcademySchedule.setStudentRestDays(studentId, week, days);

        if (result && result.success) {
            notify('Rest days saved successfully.', 'success');
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to save rest days.', 'error');
        }
    }

    // ============================================================
    // MUTATION HANDLERS - Using AcademyClasses directly
    // ============================================================
    // These are exposed for external callers but are not currently
    // wired to any button in this tab. They're kept because
    // academy-events.js and other tabs may want to call them.
    // 
    // AcademyClasses.addStudent / removeStudent are Promise-based
    // (they delegate to CharacterClasses).

    function handleAddStudentToClass(studentId) {
        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        AcademyClasses.addStudent(classId, studentId)
            .then(function(result) {
                if (result && result.success) {
                    notify('Student added to class.', 'success');
                    requestRefresh();
                } else {
                    notify(result ? result.message : 'Failed to add student.', 'error');
                }
            })
            .catch(function(err) {
                notify('Failed to add student.', 'error');
                console.error('[StudentTab] handleAddStudentToClass error:', err);
            });
    }

    function handleRemoveStudentFromClass(classId, studentId) {
        AcademyClasses.removeStudent(classId, studentId)
            .then(function(result) {
                if (result && result.success) {
                    notify('Student removed from class.', 'success');
                    requestRefresh();
                } else {
                    notify(result ? result.message : 'Failed to remove student.', 'error');
                }
            })
            .catch(function(err) {
                notify('Failed to remove student.', 'error');
                console.error('[StudentTab] handleRemoveStudentFromClass error:', err);
            });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.StudentTab = {
        render: render,
        bindEvents: bindEvents,
        switchDetailTab: switchDetailTab,
        refreshCharacterList: refreshCharacterList,
        handleSaveGrades: handleSaveGrades,
        handleAutoGenerateRankings: handleAutoGenerateRankings,
        handleSaveRestDays: handleSaveRestDays,
        handleAddStudentToClass: handleAddStudentToClass,
        handleRemoveStudentFromClass: handleRemoveStudentFromClass
    };

    window.__studentTabLoaded = true;

})();
