/**
 * js/modules/academia/academia-detail.js - Academia Detail View
 * Tabbed interface for viewing character academic information
 * Path: js/modules/academia/academia-detail.js
 * 
 * This module is responsible for:
 *   - Displaying character academic details with tabs
 *   - Tabbed navigation between schedule, grades, ranking, tournaments
 *   - Rendering schedule using CalendarUI
 *   - Rendering grades management
 *   - Rendering ranking display
 *   - Rendering tournament participation
 * 
 * IMPORTANT:
 *   - This module is RENDER ONLY - no mutations
 *   - All mutations delegate to AcademiaCore
 *   - USES AcademiaQueries for all data access
 *   - USES AcademiaCore for all mutations
 *   - USES CalendarUI for schedule rendering
 *   - USES DomUtils for safe DOM operations
 *   - USES NotificationSystem for notifications
 * 
 * LIFECYCLE:
 *   - show(characterId) - Renders detail for a character
 *   - switchTab(tab, characterId) - Switches to a specific tab
 *   - setWeek(week) - Updates the current week
 * 
 * DEPENDENCIES:
 *   - window.AcademiaQueries (from academia-queries.js)
 *   - window.AcademiaCore (from academia-core.js)
 *   - window.CalendarUI (from calendar-ui.js)
 *   - window.CalendarModes (from calendar-modes.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academiaDetailLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademiaQueries = window.AcademiaQueries;
    var AcademiaCore = window.AcademiaCore;
    var CalendarUI = window.CalendarUI;
    var CalendarModes = window.CalendarModes;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademiaQueries || typeof AcademiaQueries.getCharacter !== 'function') {
            missing.push('AcademiaQueries.getCharacter');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.getStudents !== 'function') {
            missing.push('AcademiaQueries.getStudents');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.getGrades !== 'function') {
            missing.push('AcademiaQueries.getGrades');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.calculateGradeSummary !== 'function') {
            missing.push('AcademiaQueries.calculateGradeSummary');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.getRankings !== 'function') {
            missing.push('AcademiaQueries.getRankings');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.getStudentRank !== 'function') {
            missing.push('AcademiaQueries.getStudentRank');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.getStudentSchedule !== 'function') {
            missing.push('AcademiaQueries.getStudentSchedule');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.getAvailableDisciplines !== 'function') {
            missing.push('AcademiaQueries.getAvailableDisciplines');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.getDiscipline !== 'function') {
            missing.push('AcademiaQueries.getDiscipline');
        }
        if (!AcademiaQueries || typeof AcademiaQueries.getGradeLetter !== 'function') {
            missing.push('AcademiaQueries.getGradeLetter');
        }

        if (!AcademiaCore || typeof AcademiaCore.saveGrades !== 'function') {
            missing.push('AcademiaCore.saveGrades');
        }
        if (!AcademiaCore || typeof AcademiaCore.autoGenerateRankings !== 'function') {
            missing.push('AcademiaCore.autoGenerateRankings');
        }
        if (!AcademiaCore || typeof AcademiaCore.updateStudentRank !== 'function') {
            missing.push('AcademiaCore.updateStudentRank');
        }

        if (!CalendarUI || typeof CalendarUI.init !== 'function') {
            missing.push('CalendarUI.init');
        }
        if (!CalendarModes || typeof CalendarModes.hasMode !== 'function') {
            missing.push('CalendarModes.hasMode');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (missing.length > 0) {
            console.warn('AcademiaDetail: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academiaDetailLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        characterId: null,
        activeTab: 'schedule',
        week: 1
    };

    var VALID_TABS = ['schedule', 'grades', 'ranking', 'tournaments'];
    var TAB_LABELS = {
        'schedule': 'Schedule',
        'grades': 'Grades',
        'ranking': 'Ranking',
        'tournaments': 'Tournaments'
    };

    // Calendar container reference for cleanup
    var _calendarContainer = null;
    var _calendarCleanup = null;

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    function getState() {
        return {
            characterId: state.characterId,
            activeTab: state.activeTab,
            week: state.week
        };
    }

    function setWeek(week) {
        var weekNum = parseInt(week, 10);
        if (!isNaN(weekNum) && weekNum >= 1 && weekNum <= 52) {
            state.week = weekNum;
        }
    }

    // ============================================================
    // MAIN SHOW FUNCTION
    // ============================================================

    function show(characterId) {
        var container = document.getElementById('academia-detail-container');
        if (!container) {
            console.warn('AcademiaDetail: Container not found');
            return;
        }

        // Clean up any existing calendar
        destroyCalendar();

        state.characterId = characterId;

        if (!characterId) {
            container.innerHTML = '<p class="empty-state">Select a character to view academic details.</p>';
            return;
        }

        var character = AcademiaQueries.getCharacter(characterId);
        if (!character) {
            container.innerHTML = '<p class="empty-state">Character not found.</p>';
            return;
        }

        container.innerHTML = getDetailHTML(character);
        renderTab(state.activeTab, character);
        bindTabEvents(container);
    }

    // ============================================================
    // DESTROY CALENDAR
    // ============================================================

    function destroyCalendar() {
        if (_calendarContainer) {
            _calendarContainer.innerHTML = '';
            _calendarContainer = null;
        }
        if (_calendarCleanup && typeof _calendarCleanup === 'function') {
            _calendarCleanup();
            _calendarCleanup = null;
        }
    }

    // ============================================================
    // GET DETAIL HTML
    // ============================================================

    function getDetailHTML(character) {
        var name = AcademiaQueries.getDisplayName(character);
        var status = AcademiaQueries.getCurrentStatus(character);
        var role = AcademiaQueries.getAcademicRole(character);

        var roleLabel = role === 'instructor' ? 'Instructor' :
                       role === 'student' ? 'Student' :
                       role === 'both' ? 'Student / Instructor' : 'Other';

        var tabsHTML = '';
        for (var i = 0; i < VALID_TABS.length; i++) {
            var tab = VALID_TABS[i];
            var isActive = tab === state.activeTab;
            tabsHTML += '<button class="tab-btn' + (isActive ? ' active' : '') + '" data-tab="' + escapeHtml(tab) + '">' + escapeHtml(TAB_LABELS[tab]) + '</button>';
        }

        return [
            '<div class="academia-detail-header">',
                '<div class="academia-detail-title">',
                    '<h3>' + escapeHtml(name) + '</h3>',
                    '<span class="role-badge">' + escapeHtml(roleLabel) + '</span>',
                    '<span class="status-badge">' + escapeHtml(status) + '</span>',
                '</div>',
                '<div class="academia-detail-actions">',
                    '<button id="academia-refresh-detail" class="small secondary">↻</button>',
                '</div>',
            '</div>',
            '<div class="academia-detail-tabs">',
                tabsHTML,
            '</div>',
            '<div id="academia-tab-content" class="academia-tab-content">',
                '<p class="empty-state">Loading...</p>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function switchTab(tab, characterId) {
        if (!tab || VALID_TABS.indexOf(tab) === -1) {
            return;
        }

        // Clean up calendar before switching away from schedule tab
        if (state.activeTab === 'schedule' && tab !== 'schedule') {
            destroyCalendar();
        }

        state.activeTab = tab;

        // Update tab buttons
        var container = document.getElementById('academia-detail-container');
        if (container) {
            var btns = container.querySelectorAll('.tab-btn');
            for (var i = 0; i < btns.length; i++) {
                var btn = btns[i];
                btn.classList.toggle('active', btn.dataset.tab === tab);
            }
        }

        var charId = characterId || state.characterId;
        if (!charId) {
            var content = document.getElementById('academia-tab-content');
            if (content) {
                content.innerHTML = '<p class="empty-state">No character selected.</p>';
            }
            return;
        }

        var character = AcademiaQueries.getCharacter(charId);
        if (!character) {
            var content = document.getElementById('academia-tab-content');
            if (content) {
                content.innerHTML = '<p class="empty-state">Character not found.</p>';
            }
            return;
        }

        renderTab(tab, character);
    }

    // ============================================================
    // RENDER TAB
    // ============================================================

    function renderTab(tab, character) {
        var container = document.getElementById('academia-tab-content');
        if (!container) {
            return;
        }

        switch (tab) {
            case 'schedule':
                renderSchedule(container, character);
                break;
            case 'grades':
                renderGrades(container, character);
                break;
            case 'ranking':
                renderRanking(container, character);
                break;
            case 'tournaments':
                renderTournaments(container, character);
                break;
            default:
                container.innerHTML = '<p class="empty-state">Unknown tab.</p>';
        }
    }

    // ============================================================
    // RENDER SCHEDULE - Uses CalendarUI
    // ============================================================

    function renderSchedule(container, character) {
        // Clear container
        container.innerHTML = '';

        var mode = AcademiaQueries.isStudent(character) ? 'student' : 'instructor';
        var role = AcademiaQueries.getAcademicRole(character);

        // If both or neither, default to student for display
        if (role === 'both' || role === 'other') {
            mode = 'student';
        }

        // Check if mode exists
        if (!CalendarModes.hasMode(mode)) {
            container.innerHTML = '<p class="empty-state">Calendar mode "' + escapeHtml(mode) + '" not available.</p>';
            return;
        }

        // Add week controls
        var controlsHTML = [
            '<div class="schedule-controls" style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">',
                '<span style="font-size:0.8rem;color:var(--text-dim);">Viewing as: <strong>' + escapeHtml(mode.charAt(0).toUpperCase() + mode.slice(1)) + '</strong></span>',
                '<div style="display:flex;gap:6px;align-items:center;">',
                    '<button id="prev-schedule-week" class="small">[<]</button>',
                    '<span id="schedule-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week ' + state.week + '</span>',
                    '<button id="next-schedule-week" class="small">[>]</button>',
                '</div>',
            '</div>'
        ].join('');

        container.innerHTML = controlsHTML;

        // Create calendar container
        var calendarContainer = document.createElement('div');
        calendarContainer.id = 'academia-calendar-container';
        calendarContainer.style.minHeight = '400px';
        container.appendChild(calendarContainer);

        _calendarContainer = calendarContainer;

        // Store cleanup function from CalendarUI
        var cleanup = CalendarUI.init(calendarContainer, {
            mode: mode,
            selectedId: character.id,
            week: state.week
        }, {
            onStateChange: function(newState) {
                if (newState && newState.week) {
                    state.week = newState.week;
                    var display = document.getElementById('schedule-week-display');
                    if (display) {
                        display.textContent = 'Week ' + state.week;
                    }
                }
            }
        });

        _calendarCleanup = cleanup;

        // Bind week navigation
        var prevBtn = container.querySelector('#prev-schedule-week');
        var nextBtn = container.querySelector('#next-schedule-week');

        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.week > 1) {
                    state.week--;
                    renderSchedule(container, character);
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.week < 52) {
                    state.week++;
                    renderSchedule(container, character);
                }
            });
        }
    }

    // ============================================================
    // RENDER GRADES
    // ============================================================

    function renderGrades(container, character) {
        var studentId = character.id;
        var week = state.week;

        var grades = AcademiaQueries.getGrades(studentId, week);
        var disciplines = AcademiaQueries.getAvailableDisciplines(week);
        var summary = AcademiaQueries.calculateGradeSummary(studentId, week);

        var html = '';

        // Header
        html += '<div class="grades-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h4 style="margin:0;">Grades - Week ' + week + '</h4>';
        html += '<div style="display:flex;gap:8px;align-items:center;">';
        html += '<button id="prev-grade-week" class="small">[<]</button>';
        html += '<span style="font-weight:600;">Week ' + week + '</span>';
        html += '<button id="next-grade-week" class="small">[>]</button>';
        html += '</div>';
        html += '</div>';

        if (!disciplines || disciplines.length === 0) {
            html += '<p class="empty-state">No disciplines available for week ' + week + '.</p>';
            container.innerHTML = html;
            return;
        }

        // Table
        html += '<table class="grades-table" style="width:100%;border-collapse:collapse;font-size:0.8rem;">';
        html += '<thead><tr style="background:var(--panel-alt);border-bottom:1px solid var(--border);">';
        html += '<th style="padding:6px 8px;text-align:left;">Discipline</th>';
        html += '<th style="padding:6px 8px;text-align:left;">Type</th>';
        html += '<th style="padding:6px 8px;text-align:center;">Score</th>';
        html += '<th style="padding:6px 8px;text-align:center;">Grade</th>';
        html += '<th style="padding:6px 8px;text-align:center;">Weighted</th>';
        html += '</tr></thead><tbody>';

        // Get student's scheduled disciplines
        var schedule = AcademiaQueries.getStudentSchedule(studentId, week);
        var studentDisciplineIds = AcademiaQueries.getStudentDisciplineIds(schedule);

        var hasGrades = false;

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var isScheduled = studentDisciplineIds.some(function(id) {
                return String(id) === String(d.id);
            });

            // Only show scheduled disciplines
            if (!isScheduled) {
                continue;
            }

            var score = grades[d.id] !== undefined ? grades[d.id] : '';
            var letter = '';
            var weighted = '';

            if (score !== '' && score !== undefined && score !== null) {
                var numericScore = Number(score);
                if (!isNaN(numericScore) && numericScore >= 0 && numericScore <= 100) {
                    hasGrades = true;
                    letter = AcademiaQueries.getGradeLetter(d, numericScore);
                    if (d.weight) {
                        weighted = (numericScore * Number(d.weight)).toFixed(1);
                    }
                }
            }

            var typeLabel = d.type === 'mandatory' ? 'Mandatory' : 'Optional';
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : 'var(--warning)';
            var safeName = escapeHtml(d.name);
            var safeType = escapeHtml(typeLabel);
            var safeScore = escapeHtml(String(score));
            var safeLetter = escapeHtml(letter);
            var safeWeighted = escapeHtml(weighted);

            html += '<tr style="border-bottom:1px solid var(--border-soft);">';
            html += '<td style="padding:4px 8px;">' + safeName + '</td>';
            html += '<td style="padding:4px 8px;font-size:0.7rem;color:' + typeColor + ';">' + safeType + '</td>';
            html += '<td style="padding:4px 8px;text-align:center;">';
            html += '<input type="number" class="grade-input" data-discipline="' + escapeHtml(d.id) + '" data-original="' + safeScore + '" value="' + safeScore + '" min="0" max="100" step="0.5" style="width:70px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 4px;text-align:center;font-size:0.75rem;">';
            html += '</td>';
            html += '<td style="padding:4px 8px;text-align:center;font-weight:600;" class="grade-letter">' + safeLetter + '</td>';
            html += '<td style="padding:4px 8px;text-align:center;font-weight:600;" class="weighted-score">' + safeWeighted + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';

        // Save button
        html += '<div style="margin-top:12px;">';
        html += '<button id="save-grades-btn" class="primary small">Save Grades</button>';
        html += '</div>';

        // Summary
        if (summary) {
            html += renderGradeSummary(summary);
        }

        container.innerHTML = html;

        // Bind grade input live preview
        var inputs = container.querySelectorAll('.grade-input');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            input.addEventListener('input', function() {
                updateGradePreview(this);
            });
        }

        // Week navigation is handled by events
    }

    // ============================================================
    // RENDER GRADE SUMMARY
    // ============================================================

    function renderGradeSummary(summary) {
        if (!summary) {
            return '';
        }

        var average = summary.average !== null ? summary.average.toFixed(1) : '--';
        var statusText = 'Not Graded';
        var statusColor = 'var(--text-dim)';

        if (summary.hasGrades) {
            if (summary.average === null) {
                statusText = 'No Weighted Average';
                statusColor = 'var(--warning)';
            } else if (summary.average >= 70) {
                statusText = 'Passing';
                statusColor = 'var(--accent)';
            } else {
                statusText = 'Needs Work';
                statusColor = 'var(--danger)';
            }
        }

        var html = '';
        html += '<div class="grades-summary" style="margin-top:16px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);">';
        html += '<h5 style="margin:0 0 8px 0;color:var(--text-dim);font-size:0.8rem;">Summary</h5>';
        html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">';
        html += '<div><span style="color:var(--text-dim);font-size:0.7rem;">Average</span><br><strong>' + average + '</strong></div>';
        html += '<div><span style="color:var(--text-dim);font-size:0.7rem;">Graded</span><br><strong>' + summary.gradedCount + '/' + summary.scheduledCount + '</strong></div>';
        html += '<div><span style="color:var(--text-dim);font-size:0.7rem;">Mandatory</span><br><strong>' + summary.mandatoryGraded + '/' + summary.mandatoryScheduled + '</strong></div>';
        html += '<div><span style="color:var(--text-dim);font-size:0.7rem;">Optional</span><br><strong>' + summary.optionalGraded + '/' + summary.optionalScheduled + '</strong></div>';
        html += '</div>';
        html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-soft);">';
        html += '<span style="color:var(--text-dim);font-size:0.7rem;">Status: </span>';
        html += '<span style="font-weight:700;color:' + statusColor + ';font-size:0.8rem;">' + statusText + '</span>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // UPDATE GRADE PREVIEW
    // ============================================================

    function updateGradePreview(input) {
        var row = input.closest('tr');
        if (!row) {
            return;
        }

        var disciplineId = input.dataset.discipline;
        var value = input.value.trim();
        var letterEl = row.querySelector('.grade-letter');
        var weightedEl = row.querySelector('.weighted-score');

        if (!disciplineId) {
            return;
        }

        var discipline = AcademiaQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return;
        }

        if (value !== '' && !isNaN(Number(value))) {
            var numericScore = Number(value);
            if (numericScore >= 0 && numericScore <= 100) {
                var letter = AcademiaQueries.getGradeLetter(discipline, numericScore);
                if (letterEl) {
                    letterEl.textContent = letter || '--';
                }
                if (weightedEl && discipline.weight) {
                    var weighted = numericScore * Number(discipline.weight);
                    weightedEl.textContent = weighted.toFixed(1);
                }
            }
        } else if (value === '') {
            if (letterEl) {
                letterEl.textContent = '--';
            }
            if (weightedEl) {
                weightedEl.textContent = '--';
            }
        }
    }

    // ============================================================
    // RENDER RANKING
    // ============================================================

    function renderRanking(container, character) {
        var week = state.week;
        var rankings = AcademiaQueries.getRankings(week);
        var studentRank = AcademiaQueries.getStudentRank(week, character.id);

        var html = '';

        // Header
        html += '<div class="ranking-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h4 style="margin:0;">Ranking - Week ' + week + '</h4>';
        html += '<div style="display:flex;gap:8px;align-items:center;">';
        html += '<button id="prev-rank-week" class="small">[<]</button>';
        html += '<span style="font-weight:600;">Week ' + week + '</span>';
        html += '<button id="next-rank-week" class="small">[>]</button>';
        html += '</div>';
        html += '</div>';

        // Student's rank
        if (studentRank !== null) {
            html += '<div style="padding:8px 12px;background:var(--accent-soft);border-radius:6px;border:1px solid var(--accent);margin-bottom:12px;">';
            html += '<span style="font-weight:600;">' + escapeHtml(AcademiaQueries.getDisplayName(character)) + '</span>';
            html += ' is ranked <strong>#' + studentRank + '</strong>';
            html += '</div>';
        } else {
            html += '<div style="padding:8px 12px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);margin-bottom:12px;color:var(--text-dim);">';
            html += escapeHtml(AcademiaQueries.getDisplayName(character)) + ' is not ranked this week.';
            html += '</div>';
        }

        // Auto-rank button
        html += '<div style="margin-bottom:12px;">';
        html += '<button id="auto-rank-btn" class="small primary">Auto-Generate Rankings</button>';
        html += '</div>';

        // Ranking table
        if (rankings.length === 0) {
            html += '<p class="empty-state">No rankings for week ' + week + '.</p>';
            container.innerHTML = html;
            return;
        }

        html += '<table class="ranking-table" style="width:100%;border-collapse:collapse;font-size:0.8rem;">';
        html += '<thead><tr style="background:var(--panel-alt);border-bottom:1px solid var(--border);">';
        html += '<th style="padding:6px 8px;text-align:center;">Rank</th>';
        html += '<th style="padding:6px 8px;text-align:left;">Student</th>';
        html += '<th style="padding:6px 8px;text-align:left;">Status</th>';
        html += '<th style="padding:6px 8px;text-align:center;">Action</th>';
        html += '</tr></thead><tbody>';

        // Get all students for lookup
        var allStudents = AcademiaQueries.getStudents();

        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];
            var student = null;
            for (var j = 0; j < allStudents.length; j++) {
                if (String(allStudents[j].id) === String(r.studentId)) {
                    student = allStudents[j];
                    break;
                }
            }

            if (!student) {
                continue;
            }

            var name = AcademiaQueries.getDisplayName(student);
            var status = AcademiaQueries.getCurrentStatus(student);
            var isCurrentStudent = String(r.studentId) === String(character.id);

            html += '<tr style="border-bottom:1px solid var(--border-soft);' + (isCurrentStudent ? 'background:var(--accent-soft);' : '') + '">';
            html += '<td style="padding:4px 8px;text-align:center;font-weight:700;color:var(--accent);">#' + r.rank + '</td>';
            html += '<td style="padding:4px 8px;">' + escapeHtml(name) + '</td>';
            html += '<td style="padding:4px 8px;font-size:0.7rem;color:var(--text-dim);">' + escapeHtml(status) + '</td>';
            html += '<td style="padding:4px 8px;text-align:center;">';
            if (!isCurrentStudent) {
                html += '<button class="small rank-move-btn" data-student="' + escapeHtml(r.studentId) + '" data-rank="' + r.rank + '">Move</button>';
            } else {
                html += '<input type="number" class="rank-input" data-student="' + escapeHtml(r.studentId) + '" value="' + r.rank + '" min="1" max="' + rankings.length + '" style="width:60px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 4px;text-align:center;font-size:0.75rem;">';
            }
            html += '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';

        container.innerHTML = html;

        // Bind rank input change events
        var rankInputs = container.querySelectorAll('.rank-input');
        for (var i = 0; i < rankInputs.length; i++) {
            var input = rankInputs[i];
            input.addEventListener('change', function() {
                var studentId = this.dataset.student;
                var newRank = parseInt(this.value, 10);
                var maxRank = parseInt(this.max, 10);

                if (isNaN(newRank) || newRank < 1 || newRank > maxRank) {
                    showNotification('Please enter a rank between 1 and ' + maxRank, 'error');
                    this.value = this.defaultValue;
                    return;
                }

                updateStudentRank(studentId, newRank);
            });
        }
    }

    // ============================================================
    // UPDATE STUDENT RANK
    // ============================================================

    function updateStudentRank(studentId, newRank) {
        var result = AcademiaCore.updateStudentRank(state.week, studentId, newRank);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to update rank.', 'error');
            return;
        }

        showNotification('Rank updated successfully.', 'success');

        // Refresh ranking tab
        if (state.characterId) {
            var character = AcademiaQueries.getCharacter(state.characterId);
            if (character) {
                renderRanking(document.getElementById('academia-tab-content'), character);
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                showNotification('Rank updated in memory, but persistence failed.', 'error');
            });
        }
    }

    // ============================================================
    // RENDER TOURNAMENTS
    // ============================================================

    function renderTournaments(container, character) {
        // Placeholder for tournament participation
        var html = '';
        html += '<div class="tournaments-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h4 style="margin:0;">Tournament Participation</h4>';
        html += '</div>';

        html += '<p class="empty-state">Tournament participation view coming soon.</p>';

        container.innerHTML = html;
    }

    // ============================================================
    // BIND TAB EVENTS
    // ============================================================

    function bindTabEvents(container) {
        var btns = container.querySelectorAll('.tab-btn');
        for (var i = 0; i < btns.length; i++) {
            var btn = btns[i];
            // Remove existing listeners to prevent duplicates
            btn.removeEventListener('click', handleTabClick);
            btn.addEventListener('click', handleTabClick);
        }

        // Refresh button
        var refreshBtn = container.querySelector('#academia-refresh-detail');
        if (refreshBtn) {
            refreshBtn.removeEventListener('click', handleRefresh);
            refreshBtn.addEventListener('click', handleRefresh);
        }
    }

    function handleTabClick(e) {
        var tab = this.dataset.tab;
        if (tab && VALID_TABS.indexOf(tab) !== -1) {
            switchTab(tab);
        }
    }

    function handleRefresh(e) {
        if (state.characterId) {
            show(state.characterId);
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademiaDetail = {
        show: show,
        switchTab: switchTab,
        setWeek: setWeek,
        getState: getState,
        destroyCalendar: destroyCalendar
    };

})();
