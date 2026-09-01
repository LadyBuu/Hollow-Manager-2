/**
 * js/modules/academia/academia-main.js - Academia Main Entry Point
 * Uses existing character list with class filter extension
 * Auto-detects student/instructor role for schedule view
 * Mobile-friendly with collapsible sidebar
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
        viewMode: null, // 'student', 'instructor', or null (auto-detect)
        sidebarCollapsed: false
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

        var studentStatuses = ['trainee', 'rookie', 'junior', 'student'];
        for (var i = 0; i < studentStatuses.length; i++) {
            if (status === studentStatuses[i] || status.indexOf(studentStatuses[i]) !== -1) {
                isStudent = true;
                break;
            }
        }

        var instructorStatuses = ['instructor', 'teacher', 'professor', 'senior'];
        for (var i = 0; i < instructorStatuses.length; i++) {
            if (status === instructorStatuses[i] || status.indexOf(instructorStatuses[i]) !== -1) {
                isInstructor = true;
                break;
            }
        }

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
        if (role.role === 'both' || role.role === 'student') {
            return 'student';
        } else if (role.role === 'instructor') {
            return 'instructor';
        }
        return 'student';
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

        renderCharacterList(container);
        renderDetail(container);
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
        html += '<input type="text" id="academia-name-filter" value="' + escapeHtml(state.filterName || '') + '" placeholder="Search characters..." style="width:100%;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">';
        html += '</div>';

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

        var items = listContainer.querySelectorAll('.academia-list-item');
        for (var i = 0; i < items.length; i++) {
            var el = items[i];
            el.addEventListener('click', function() {
                state.selectedCharacterId = this.dataset.id;
                state.viewMode = null;
                renderAcademia(container);
            });
        }

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
        var currentViewMode = state.viewMode || getDefaultViewMode(char);
        state.viewMode = currentViewMode;

        var html = '';
        html += '<div class="academia-detail-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border-soft);">';
        html += '<h3 style="color:var(--accent);margin:0;">' + escapeHtml(characterName) + '</h3>';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
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

        if (activeTab === 'schedule') {
            renderScheduleTab(detailContainer, char, currentViewMode);
        } else {
            renderGradesTab(detailContainer, char);
        }

        var tabBtns = detailContainer.querySelectorAll('.academia-tab-btn');
        tabBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                state.activeTab = this.dataset.tab;
                renderDetail(container);
            });
        });
    }

    // ============================================================
    // SCHEDULE TAB - With Copy Week and Collapsible Sidebar
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

        var modeToUse = viewMode || 'student';
        if (!window.CalendarModes.hasMode(modeToUse)) {
            modeToUse = 'student';
            if (!window.CalendarModes.hasMode(modeToUse)) {
                scheduleContainer.innerHTML = '<p class="empty-state">No calendar modes available.</p>';
                return;
            }
        }

        // Create calendar container
        var calendarContainer = document.createElement('div');
        calendarContainer.id = 'academia-calendar-container';
        calendarContainer.style.width = '100%';
        calendarContainer.style.minHeight = '400px';
        scheduleContainer.innerHTML = '';
        scheduleContainer.appendChild(calendarContainer);

        // Add copy week controls
        var controlsContainer = document.createElement('div');
        controlsContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;padding:8px 12px;background:var(--panel-alt);border-radius:6px;border:1px solid var(--border-soft);';
        controlsContainer.innerHTML = `
            <span style="font-size:0.75rem;color:var(--text-dim);">Week ${state.currentWeek}</span>
            <button id="copy-week-btn" class="small primary" style="margin-left:auto;">Copy Week</button>
            <div id="copy-week-target" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;">
                <span style="font-size:0.75rem;color:var(--text-dim);">to:</span>
                <input type="number" id="copy-week-target-input" value="${state.currentWeek + 1}" min="1" max="52" style="width:60px;padding:2px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
                <button id="copy-week-confirm" class="small success">Confirm</button>
                <button id="copy-week-cancel" class="small secondary">Cancel</button>
            </div>
            <button id="toggle-sidebar-btn" class="small secondary" style="margin-left:4px;">${state.sidebarCollapsed ? 'Show' : 'Hide'} Sidebar</button>
        `;
        scheduleContainer.insertBefore(controlsContainer, calendarContainer);

        // Copy week controls
        var copyBtn = controlsContainer.querySelector('#copy-week-btn');
        var targetDiv = controlsContainer.querySelector('#copy-week-target');
        var confirmBtn = controlsContainer.querySelector('#copy-week-confirm');
        var cancelBtn = controlsContainer.querySelector('#copy-week-cancel');
        var targetInput = controlsContainer.querySelector('#copy-week-target-input');

        if (copyBtn) {
            copyBtn.addEventListener('click', function() {
                targetDiv.style.display = 'flex';
                copyBtn.style.display = 'none';
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                targetDiv.style.display = 'none';
                copyBtn.style.display = 'inline-block';
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', function() {
                var targetWeek = parseInt(targetInput.value, 10);
                if (isNaN(targetWeek) || targetWeek < 1 || targetWeek > 52) {
                    showNotification('Please enter a valid week (1-52).', 'error');
                    return;
                }
                if (targetWeek === state.currentWeek) {
                    showNotification('Cannot copy to the same week.', 'error');
                    return;
                }
                copyWeek(char.id, state.currentWeek, targetWeek, calendarContainer);
                targetDiv.style.display = 'none';
                copyBtn.style.display = 'inline-block';
            });
        }

        // Toggle sidebar
        var toggleBtn = controlsContainer.querySelector('#toggle-sidebar-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function() {
                state.sidebarCollapsed = !state.sidebarCollapsed;
                this.textContent = state.sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar';
                var sidebar = calendarContainer.querySelector('.schedule-sidebar');
                if (sidebar) {
                    sidebar.style.display = state.sidebarCollapsed ? 'none' : 'flex';
                }
            });
        }

        var week = state.currentWeek || 1;

        try {
            window.CalendarUI.init(calendarContainer, {
                mode: modeToUse,
                selectedId: char.id,
                week: week
            }, {
                onStateChange: function(newState) {
                    if (newState && newState.week) {
                        state.currentWeek = newState.week;
                        // Update week display
                        var weekDisplay = controlsContainer.querySelector('span');
                        if (weekDisplay) {
                            weekDisplay.textContent = 'Week ' + state.currentWeek;
                        }
                        // Update target input
                        if (targetInput) {
                            targetInput.value = state.currentWeek + 1;
                        }
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
    // COPY WEEK
    // ============================================================

    function copyWeek(studentId, sourceWeek, targetWeek, container) {
        if (typeof window.duplicateStudentSchedule !== 'function') {
            showNotification('Copy week function not available.', 'error');
            return;
        }

        // Show loading state
        var originalHtml = container.innerHTML;
        container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);">Copying schedule...</div>';

        var result = window.duplicateStudentSchedule(studentId, sourceWeek, targetWeek, true);

        if (result && result.success) {
            // Re-render
            if (typeof window.saveData === 'function') {
                window.saveData()
                    .then(function() {
                        showNotification('Schedule copied from week ' + sourceWeek + ' to week ' + targetWeek + '.', 'success');
                        // Re-initialize calendar
                        var calendarContainer = container.querySelector('#academia-calendar-container');
                        if (calendarContainer) {
                            // Re-render will happen via state change
                            window.CalendarUI.setState({ week: targetWeek });
                            window.CalendarUI.render();
                        }
                    })
                    .catch(function() {
                        showNotification('Schedule copied in memory, but persistence failed.', 'error');
                        window.CalendarUI.render();
                    });
            } else {
                showNotification('Schedule copied from week ' + sourceWeek + ' to week ' + targetWeek + '.', 'success');
                window.CalendarUI.render();
            }
        } else {
            container.innerHTML = originalHtml;
            showNotification(result && result.message ? result.message : 'Failed to copy schedule.', 'error');
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

        if (typeof window.renderAcademiaGrades === 'function') {
            window.renderAcademiaGrades(gradesContainer, char.id);
            return;
        }

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

        html += '</div>';

        container.innerHTML = html;

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

        var saveBtn = container.querySelector('#save-grades-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                saveGrades(container, studentId);
            });
        }

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
    // NOTIFICATION HELPER
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        if (typeof window.notify === 'function') {
            window.notify(message, type);
            return;
        }
        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
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
