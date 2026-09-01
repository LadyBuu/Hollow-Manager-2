/**
 * js/modules/academia/academia-main.js - Academia Main Entry Point
 * Uses existing character list with class filter extension
 * Auto-detects student/instructor role for schedule view
 * Path: js/modules/academia/academia-main.js
 */

(function() {
    'use strict';

    if (window.__academiaMainLoaded) {
        return;
    }
    window.__academiaMainLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var state = window.academiaState || {
        selectedCharacterId: null,
        filterClass: 'all',
        filterName: '',
        activeTab: 'schedule',
        currentWeek: 1,
        viewMode: null // 'student', 'instructor', or null (auto-detect)
    };

    window.academiaState = state;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = [
            'getStudents',
            'getClasses',
            'getCharacterById',
            'getDisplayName',
            'getCurrentStatus',
            'getAvailableDisciplines',
            'getStudentSchedule',
            'getGrades',
            'saveGrades',
            'calculateGradeSummary',
            'CalendarUI',
            'CalendarModes'
        ];

        required.forEach(function(name) {
            if (typeof window[name] === 'undefined') {
                missing.push(name);
            }
        });

        // getGradeLetter is OPTIONAL - create fallback if missing
        if (typeof window.getGradeLetter === 'undefined') {
            window.getGradeLetter = function(discipline, score) {
                if (!discipline || !discipline.gradingSystem || discipline.gradingSystem.length === 0) {
                    return '';
                }
                var numScore = Number(score);
                if (!isFinite(numScore) || numScore < 0 || numScore > 100) {
                    return '';
                }
                var sorted = discipline.gradingSystem.slice().sort(function(a, b) {
                    return (b.min || 0) - (a.min || 0);
                });
                for (var i = 0; i < sorted.length; i++) {
                    var grade = sorted[i];
                    var min = Number(grade.min);
                    var max = Number(grade.max);
                    if (isFinite(min) && isFinite(max) && numScore >= min && numScore <= max) {
                        return grade.label || grade.letter || '';
                    }
                }
                return '';
            };
            console.log('[Academia] getGradeLetter fallback created');
        }

        if (missing.length > 0) {
            console.warn('[Academia] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // ROLE DETECTION
    // ============================================================

    function detectCharacterRole(char) {
        if (!char) {
            return { isStudent: false, isInstructor: false, role: 'none' };
        }

        var status = window.getCurrentStatus ? window.getCurrentStatus(char).toLowerCase() : '';
        var isStudent = false;
        var isInstructor = false;

        // Check if character has a student status (trainee, rookie, junior, etc.)
        var studentStatuses = ['trainee', 'rookie', 'junior', 'student'];
        for (var i = 0; i < studentStatuses.length; i++) {
            if (status === studentStatuses[i] || status.indexOf(studentStatuses[i]) !== -1) {
                isStudent = true;
                break;
            }
        }

        // Check if character has an instructor status
        var instructorStatuses = ['instructor', 'teacher', 'professor', 'senior'];
        for (var i = 0; i < instructorStatuses.length; i++) {
            if (status === instructorStatuses[i] || status.indexOf(instructorStatuses[i]) !== -1) {
                isInstructor = true;
                break;
            }
        }

        // Also check careerStatus for historical data
        if (char.careerStatus && Array.isArray(char.careerStatus)) {
            for (var i = 0; i < char.careerStatus.length; i++) {
                var entry = char.careerStatus[i];
                if (!entry || !entry.status) continue;
                var entryStatus = String(entry.status).toLowerCase();
                
                for (var j = 0; j < studentStatuses.length; j++) {
                    if (entryStatus === studentStatuses[j] || entryStatus.indexOf(studentStatuses[j]) !== -1) {
                        isStudent = true;
                        break;
                    }
                }
                for (var j = 0; j < instructorStatuses.length; j++) {
                    if (entryStatus === instructorStatuses[j] || entryStatus.indexOf(instructorStatuses[j]) !== -1) {
                        isInstructor = true;
                        break;
                    }
                }
            }
        }

        return {
            isStudent: isStudent,
            isInstructor: isInstructor,
            role: isStudent && isInstructor ? 'both' : (isStudent ? 'student' : (isInstructor ? 'instructor' : 'none'))
        };
    }

    function getDefaultViewMode(char) {
        var role = detectCharacterRole(char);
        
        if (role.role === 'both') {
            // If both, default to student (user can switch via dropdown)
            return 'student';
        } else if (role.role === 'student') {
            return 'student';
        } else if (role.role === 'instructor') {
            return 'instructor';
        } else {
            // No role detected, default to student
            return 'student';
        }
    }

    function getAvailableViewModes(char) {
        var role = detectCharacterRole(char);
        var modes = [];
        
        if (role.isStudent) {
            modes.push({ value: 'student', label: 'Student Schedule' });
        }
        if (role.isInstructor) {
            modes.push({ value: 'instructor', label: 'Instructor Schedule' });
        }
        
        // If no modes detected, default to student
        if (modes.length === 0) {
            modes.push({ value: 'student', label: 'Schedule' });
        }
        
        return modes;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderAcademia(container) {
        if (!container) {
            container = document.getElementById('tab-academia');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading academia data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Academia dependencies not loaded. Check console.</p>';
            return;
        }

        try {
            if (typeof window.ensureCurriculum === 'function') {
                window.ensureCurriculum();
            }
        } catch (e) {
            console.warn('[Academia] ensureCurriculum() failed:', e);
        }

        container.innerHTML = getAcademiaHTML();

        // Render the character list
        renderCharacterList(container);

        // Render the detail panel
        renderDetail(container);

        // Bind events
        bindEvents(container);

        console.log('[Academia] Rendered successfully');
    }

    // ============================================================
    // ACADEMIA HTML
    // ============================================================

    function getAcademiaHTML() {
        return `
            <div class="page-header">
                <h2>Academia</h2>
                <div style="display:flex;gap:8px;align-items:center;">
                    <button id="academia-refresh-btn" class="small secondary">↻ Refresh</button>
                </div>
            </div>
            <div class="academia-layout" style="display:grid;grid-template-columns:320px 1fr;gap:16px;">
                <div id="academia-character-list" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:10px;max-height:600px;overflow-y:auto;">
                    <div id="academia-list-container"></div>
                </div>
                <div id="academia-detail-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;overflow-y:auto;max-height:600px;">
                    <p class="empty-state">Select a character to view academic details.</p>
                </div>
            </div>
        `;
    }

    // ============================================================
    // CHARACTER LIST
    // ============================================================

    function renderCharacterList(container) {
        var listContainer = container.querySelector('#academia-list-container');
        if (!listContainer) {
            return;
        }

        var students = window.getStudents();
        var classes = window.getClasses();

        var html = '';

        // Class filter
        html += '<div class="academia-filters" style="margin-bottom:8px;">';
        html += '<select id="academia-class-filter" style="width:100%;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;margin-bottom:4px;">';
        html += '<option value="all">All Classes</option>';

        classes.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var selected = String(state.filterClass) === String(cls.id) ? ' selected' : '';
            html += '<option value="' + escapeHtml(cls.id) + '"' + selected + '>' + escapeHtml(cls.name) + '</option>';
        }

        html += '</select>';

        // Name filter
        html += '<input type="text" id="academia-name-filter" value="' + escapeHtml(state.filterName || '') + '" placeholder="Search characters..." style="width:100%;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">';
        html += '</div>';

        // Character list
        html += '<div id="academia-characters-list" style="display:flex;flex-direction:column;gap:2px;max-height:450px;overflow-y:auto;">';

        var filteredStudents = students.filter(function(char) {
            if (state.filterName) {
                var name = window.getDisplayName(char);
                if (!name.toLowerCase().includes(state.filterName.toLowerCase())) {
                    return false;
                }
            }

            if (state.filterClass !== 'all') {
                var classIds = Array.isArray(char.classIds) ? char.classIds : [];
                if (!classIds.some(function(id) { return String(id) === String(state.filterClass); })) {
                    return false;
                }
            }

            return true;
        });

        filteredStudents.sort(function(a, b) {
            return window.getDisplayName(a).localeCompare(window.getDisplayName(b));
        });

        if (filteredStudents.length === 0) {
            html += '<p class="empty-state" style="padding:10px;font-size:0.75rem;">No students found.</p>';
        } else {
            var selectedId = state.selectedCharacterId;

            for (var i = 0; i < filteredStudents.length; i++) {
                var char = filteredStudents[i];
                var name = window.getDisplayName(char);
                var status = window.getCurrentStatus(char);
                var isSelected = String(char.id) === String(selectedId);
                var isDeceased = char.deceased || false;

                // Show role indicator
                var role = detectCharacterRole(char);
                var roleIcon = '';
                if (role.role === 'both') {
                    roleIcon = ' <span style="font-size:0.5rem;color:var(--warning);">[S/I]</span>';
                } else if (role.role === 'student') {
                    roleIcon = ' <span style="font-size:0.5rem;color:var(--accent);">[S]</span>';
                } else if (role.role === 'instructor') {
                    roleIcon = ' <span style="font-size:0.5rem;color:var(--info);">[I]</span>';
                }

                var classesDisplay = '';
                if (char.classIds && char.classIds.length > 0) {
                    var classNames = char.classIds.map(function(id) {
                        var cls = window.getClass(id);
                        return cls ? cls.name : null;
                    }).filter(Boolean);
                    if (classNames.length > 0) {
                        classesDisplay = ' <span style="font-size:0.5rem;color:var(--text-dim);">(' + classNames.join(', ') + ')</span>';
                    }
                }

                html += '<div class="academia-list-item" data-id="' + escapeHtml(char.id) + '" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-radius:4px;cursor:pointer;transition:0.15s;border-bottom:1px solid var(--border-soft);' + (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') + (isDeceased ? 'opacity:0.4;' : '') + '">';
                html += '<span class="char-name" style="font-size:0.75rem;font-weight:500;">' + escapeHtml(name) + roleIcon + classesDisplay + '</span>';
                html += '<span class="char-status" style="font-size:0.55rem;color:var(--text-dim);">' + escapeHtml(status) + '</span>';
                html += '</div>';
            }
        }

        html += '</div>';

        listContainer.innerHTML = html;

        // Bind list click events
        var items = listContainer.querySelectorAll('.academia-list-item');
        for (var i = 0; i < items.length; i++) {
            var el = items[i];
            el.addEventListener('click', function() {
                state.selectedCharacterId = this.dataset.id;
                // Reset view mode when changing character (will auto-detect)
                state.viewMode = null;
                renderAcademia(container);
            });
        }

        // Bind filter events
        var classFilter = listContainer.querySelector('#academia-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                state.filterClass = this.value;
                renderAcademia(container);
            });
        }

        var nameFilter = listContainer.querySelector('#academia-name-filter');
        if (nameFilter) {
            nameFilter.addEventListener('input', function() {
                state.filterName = this.value;
                clearTimeout(this._timeout);
                this._timeout = setTimeout(function() {
                    renderAcademia(container);
                }, 300);
            });
        }
    }

    // ============================================================
    // DETAIL PANEL
    // ============================================================

    function renderDetail(container) {
        var detailContainer = container.querySelector('#academia-detail-container');
        if (!detailContainer) {
            return;
        }

        if (!state.selectedCharacterId) {
            detailContainer.innerHTML = '<p class="empty-state">Select a character to view academic details.</p>';
            return;
        }

        var char = window.getCharacterById(state.selectedCharacterId);
        if (!char) {
            detailContainer.innerHTML = '<p class="empty-state">Character not found.</p>';
            return;
        }

        var characterName = window.getDisplayName(char);
        var activeTab = state.activeTab || 'schedule';
        
        // Auto-detect view mode
        var role = detectCharacterRole(char);
        var availableModes = getAvailableViewModes(char);
        
        // Determine current view mode
        var currentViewMode = state.viewMode;
        if (!currentViewMode || !availableModes.some(function(m) { return m.value === currentViewMode; })) {
            // Auto-detect: if both, default to student; otherwise use the only available
            if (role.role === 'both') {
                currentViewMode = 'student';
            } else if (availableModes.length === 1) {
                currentViewMode = availableModes[0].value;
            } else {
                currentViewMode = 'student';
            }
            state.viewMode = currentViewMode;
        }

        var html = '';
        html += '<div class="academia-detail-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border-soft);">';
        html += '<h3 style="color:var(--accent);margin:0;">' + escapeHtml(characterName) + '</h3>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
        
        // View mode dropdown (only show if multiple modes available)
        if (availableModes.length > 1) {
            html += '<select id="academia-view-mode" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">';
            for (var i = 0; i < availableModes.length; i++) {
                var mode = availableModes[i];
                var selected = mode.value === currentViewMode ? ' selected' : '';
                html += '<option value="' + escapeHtml(mode.value) + '"' + selected + '>' + escapeHtml(mode.label) + '</option>';
            }
            html += '</select>';
        }
        
        html += '<button class="academia-tab-btn small ' + (activeTab === 'schedule' ? 'primary' : 'secondary') + '" data-tab="schedule">Schedule</button>';
        html += '<button class="academia-tab-btn small ' + (activeTab === 'grades' ? 'primary' : 'secondary') + '" data-tab="grades">Grades</button>';
        html += '</div>';
        html += '</div>';

        html += '<div id="academia-detail-content">';
        if (activeTab === 'schedule') {
            html += '<div id="academia-schedule-container" style="min-height:300px;"></div>';
        } else {
            html += '<div id="academia-grades-container"></div>';
        }
        html += '</div>';

        detailContainer.innerHTML = html;

        // Bind view mode change
        var viewModeSelect = detailContainer.querySelector('#academia-view-mode');
        if (viewModeSelect) {
            viewModeSelect.addEventListener('change', function() {
                state.viewMode = this.value;
                renderDetail(container);
            });
        }

        // Render schedule or grades
        if (activeTab === 'schedule') {
            renderScheduleTab(detailContainer, char, currentViewMode);
        } else {
            renderGradesTab(detailContainer, char);
        }

        // Bind tab switching
        var tabBtns = detailContainer.querySelectorAll('.academia-tab-btn');
        tabBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                state.activeTab = this.dataset.tab;
                renderDetail(container);
            });
        });
    }

    // ============================================================
    // SCHEDULE TAB - Using CalendarUI with auto-detected mode
    // ============================================================

    function renderScheduleTab(container, char, viewMode) {
        var scheduleContainer = container.querySelector('#academia-schedule-container');
        if (!scheduleContainer) {
            return;
        }

        if (typeof window.CalendarUI === 'undefined') {
            scheduleContainer.innerHTML = '<p class="empty-state">Calendar module not loaded.</p>';
            return;
        }

        if (typeof window.CalendarModes === 'undefined') {
            scheduleContainer.innerHTML = '<p class="empty-state">Calendar modes not loaded.</p>';
            return;
        }

        // Determine which mode to use
        var modeToUse = viewMode || 'student';
        
        // Check if the mode is available
        if (!window.CalendarModes.hasMode(modeToUse)) {
            // Fallback to student
            modeToUse = 'student';
            if (!window.CalendarModes.hasMode(modeToUse)) {
                scheduleContainer.innerHTML = '<p class="empty-state">No calendar modes available.</p>';
                return;
            }
        }

        // Create a container for the calendar
        var calendarContainer = document.createElement('div');
        calendarContainer.id = 'academia-calendar-container';
        calendarContainer.style.width = '100%';
        calendarContainer.style.minHeight = '400px';
        scheduleContainer.innerHTML = '';
        scheduleContainer.appendChild(calendarContainer);

        // Get current week from state
        var week = state.currentWeek || 1;

        // Initialize CalendarUI
        try {
            window.CalendarUI.init(calendarContainer, {
                mode: modeToUse,
                selectedId: char.id,
                week: week
            }, {
                onStateChange: function(newState) {
                    if (newState && newState.week) {
                        state.currentWeek = newState.week;
                    }
                }
            });

            console.log('[Academia] CalendarUI initialized for ' + modeToUse + ':', char.id);
        } catch (e) {
            console.error('[Academia] Failed to initialize CalendarUI:', e);
            scheduleContainer.innerHTML = '<p class="empty-state">Error loading calendar. Please refresh.</p>';
        }
    }

    // ============================================================
    // GRADES TAB
    // ============================================================

    function renderGradesTab(container, char) {
        var gradesContainer = container.querySelector('#academia-grades-container');
        if (!gradesContainer) {
            return;
        }

        // Use the existing grades view if available
        if (typeof window.renderAcademiaGrades === 'function') {
            window.renderAcademiaGrades(gradesContainer, char.id);
            return;
        }

        // Fallback: render simple grades view
        renderSimpleGradesView(gradesContainer, char);
    }

    function renderSimpleGradesView(container, char) {
        var studentId = char.id;
        var week = state.currentWeek || 1;
        var grades = window.getGrades(studentId, week) || {};
        var disciplines = window.getAvailableDisciplines(week) || [];

        var html = '<div class="grades-view">';
        html += '<div class="grades-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h4 style="margin:0;">' + escapeHtml(window.getDisplayName(char)) + ' - Week ' + week + '</h4>';
        html += '<div style="display:flex;gap:8px;align-items:center;">';
        html += '<button id="grades-prev-week" class="small">[<]</button>';
        html += '<span style="font-weight:600;">Week ' + week + '</span>';
        html += '<button id="grades-next-week" class="small">[>]</button>';
        html += '</div>';
        html += '</div>';

        if (disciplines.length === 0) {
            html += '<p class="empty-state">No disciplines available for week ' + week + '.</p>';
        } else {
            // Get student's schedule to know which disciplines they're enrolled in
            var schedule = window.getStudentSchedule(studentId, week) || {};
            var enrolledDisciplineIds = [];
            for (var day in schedule) {
                if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
                var daySchedule = schedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') continue;
                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                    var discId = daySchedule[hour];
                    if (discId && enrolledDisciplineIds.indexOf(discId) === -1) {
                        enrolledDisciplineIds.push(discId);
                    }
                }
            }

            html += '<table class="grades-table" style="width:100%;border-collapse:collapse;font-size:0.8rem;">';
            html += '<thead><tr style="background:var(--panel-alt);border-bottom:1px solid var(--border);">';
            html += '<th style="padding:6px 8px;text-align:left;">Discipline</th>';
            html += '<th style="padding:6px 8px;text-align:left;">Instructor</th>';
            html += '<th style="padding:6px 8px;text-align:center;">Score</th>';
            html += '<th style="padding:6px 8px;text-align:center;">Grade</th>';
            html += '<th style="padding:6px 8px;text-align:center;">Weighted</th>';
            html += '</tr></thead><tbody>';

            for (var i = 0; i < disciplines.length; i++) {
                var d = disciplines[i];
                var isEnrolled = enrolledDisciplineIds.some(function(id) { return String(id) === String(d.id); });
                
                // Only show disciplines the student is enrolled in (has schedule)
                if (enrolledDisciplineIds.length > 0 && !isEnrolled) {
                    continue;
                }

                var score = grades[d.id] !== undefined ? grades[d.id] : '';
                var letter = '';
                var weighted = '';

                if (score !== '' && score !== undefined && score !== null) {
                    var numericScore = Number(score);
                    if (!isNaN(numericScore)) {
                        if (typeof window.getGradeLetter === 'function') {
                            letter = window.getGradeLetter(d, numericScore);
                        }
                        if (d.weight) {
                            weighted = (numericScore * d.weight).toFixed(1);
                        }
                    }
                }

                var instructorNames = [];
                if (d.instructorIds) {
                    for (var j = 0; j < d.instructorIds.length; j++) {
                        var inst = window.getCharacterById(d.instructorIds[j]);
                        if (inst) {
                            instructorNames.push(window.getDisplayName(inst));
                        }
                    }
                }

                html += '<tr style="border-bottom:1px solid var(--border-soft);">';
                html += '<td style="padding:4px 8px;">' + escapeHtml(d.name) + '</td>';
                html += '<td style="padding:4px 8px;font-size:0.7rem;color:var(--text-dim);">' + escapeHtml(instructorNames.join(', ') || 'Not assigned') + '</td>';
                html += '<td style="padding:4px 8px;text-align:center;"><input type="number" class="grade-input" data-discipline="' + escapeHtml(d.id) + '" value="' + escapeHtml(String(score)) + '" min="0" max="100" step="0.5" style="width:70px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 4px;text-align:center;"></td>';
                html += '<td style="padding:4px 8px;text-align:center;font-weight:600;" class="grade-letter">' + escapeHtml(letter) + '</td>';
                html += '<td style="padding:4px 8px;text-align:center;font-weight:600;" class="weighted-score">' + escapeHtml(weighted) + '</td>';
                html += '</tr>';
            }

            html += '</tbody></table>';
            html += '<div style="margin-top:12px;"><button id="save-grades-btn" class="primary small">Save Grades</button></div>';
        }

        // Summary
        if (typeof window.calculateGradeSummary === 'function') {
            var summary = window.calculateGradeSummary(studentId, week);
            if (summary) {
                html += '<div class="grades-summary" style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;">';
                html += '<h5 style="margin:0 0 8px 0;color:var(--text-dim);">Summary</h5>';
                html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">';
                html += '<div><span style="color:var(--text-dim);">Average:</span> <strong>' + (summary.average !== null ? summary.average.toFixed(1) : '--') + '</strong></div>';
                html += '<div><span style="color:var(--text-dim);">Graded:</span> <strong>' + summary.gradedCount + '/' + summary.scheduledCount + '</strong></div>';
                html += '<div><span style="color:var(--text-dim);">Mandatory:</span> <strong>' + summary.mandatoryGraded + '/' + summary.mandatoryScheduled + '</strong></div>';
                html += '<div><span style="color:var(--text-dim);">Optional:</span> <strong>' + summary.optionalGraded + '/' + summary.optionalScheduled + '</strong></div>';
                html += '</div>';
                html += '</div>';
            }
        }

        html += '</div>';

        container.innerHTML = html;

        // Bind grade input events for live preview
        var inputs = container.querySelectorAll('.grade-input');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            input.addEventListener('input', function() {
                var row = this.closest('tr');
                if (!row) return;
                var disciplineId = this.dataset.discipline;
                var value = this.value.trim();
                var letterEl = row.querySelector('.grade-letter');
                var weightedEl = row.querySelector('.weighted-score');

                if (value !== '' && !isNaN(Number(value))) {
                    var numericScore = Number(value);
                    if (numericScore >= 0 && numericScore <= 100) {
                        var discipline = window.getDiscipline(disciplineId);
                        if (discipline) {
                            if (typeof window.getGradeLetter === 'function') {
                                letterEl.textContent = window.getGradeLetter(discipline, numericScore);
                            }
                            if (discipline.weight && weightedEl) {
                                weightedEl.textContent = (numericScore * discipline.weight).toFixed(1);
                            }
                        }
                    }
                } else if (value === '') {
                    letterEl.textContent = '';
                    if (weightedEl) weightedEl.textContent = '';
                }
            });
        }

        // Bind save button
        var saveBtn = container.querySelector('#save-grades-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                saveGrades(container, studentId);
            });
        }

        // Bind week navigation
        var prevBtn = container.querySelector('#grades-prev-week');
        var nextBtn = container.querySelector('#grades-next-week');

        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderSimpleGradesView(container, char);
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderSimpleGradesView(container, char);
                }
            });
        }
    }

    function saveGrades(container, studentId) {
        var grades = {};
        var hasChanges = false;
        var invalidInputs = [];

        var inputs = container.querySelectorAll('.grade-input');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var disciplineId = input.dataset.discipline;
            var value = input.value.trim();

            if (value === '') {
                grades[disciplineId] = undefined;
                hasChanges = true;
            } else if (!isNaN(Number(value))) {
                var numericScore = Number(value);
                if (numericScore >= 0 && numericScore <= 100) {
                    grades[disciplineId] = numericScore;
                    hasChanges = true;
                } else {
                    invalidInputs.push(disciplineId);
                }
            }
        }

        if (invalidInputs.length > 0) {
            var names = invalidInputs.map(function(id) {
                var d = window.getDiscipline(id);
                return d ? d.name : id;
            });
            alert('Invalid scores for: ' + names.join(', ') + '. Please enter values between 0 and 100.');
            return;
        }

        if (!hasChanges) {
            alert('No changes to save.');
            return;
        }

        if (typeof window.saveGrades === 'function') {
            var week = state.currentWeek || 1;
            var result = window.saveGrades(studentId, week, grades);
            if (result && result.success) {
                alert('Grades saved successfully!');
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function() {
                        console.warn('Persistence failed, but grades saved in memory.');
                    });
                }
                // Re-render
                var char = window.getCharacterById(studentId);
                if (char) {
                    renderSimpleGradesView(container, char);
                }
            } else {
                alert('Failed to save grades: ' + (result && result.message ? result.message : 'Unknown error'));
            }
        } else {
            alert('saveGrades function not available. Grades saved in memory only.');
        }
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindEvents(container) {
        var refreshBtn = container.querySelector('#academia-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                renderAcademia(container);
            });
        }
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
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('academia', renderAcademia);
    }

    // ============================================================
    // LIFECYCLE
    // ============================================================

    document.addEventListener('dataReady', function() {
        setTimeout(function() {
            var container = document.getElementById('tab-academia');
            if (container && container.style.display !== 'none') {
                renderAcademia(container);
            }
        }, 100);
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'academia') {
            var container = document.getElementById('tab-academia');
            if (container) {
                renderAcademia(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-academia');
            if (container && container.style.display !== 'none') {
                renderAcademia(container);
            }
        }, 200);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderAcademia = renderAcademia;
    window.academiaState = state;

})();
