/**
 * js/modules/academia/academia-schedule.js - Academia Schedule View
 * Student and Instructor schedule viewer
 * Path: js/modules/academia/academia-schedule.js
 * 
 * This module is responsible for:
 *   - Rendering the schedule view
 *   - Switching between Student and Instructor views
 *   - Displaying schedule grid for the selected character
 *   - Showing class details (discipline, instructor, duration)
 * 
 * LIFECYCLE:
 *   This module is rendered by academia-main.js via TabManager.
 * 
 * DEPENDENCIES:
 *   - window.getStudents (from core-utils.js)
 *   - window.getInstructors (from core-utils.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getStudentSchedule (from curriculum-schedule.js)
 *   - window.getAvailableDisciplines (from curriculum-disciplines.js)
 *   - window.getDiscipline (from curriculum-disciplines.js)
 *   - window.getClassInstructor (from curriculum-schedule.js)
 *   - window.getClassDuration (from curriculum-schedule.js)
 *   - window.getClassLocation (from curriculum-schedule.js)
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Schedule UI state
    // ============================================================

    var state = window.academiaScheduleState || {
        viewMode: 'student', // 'student' | 'instructor'
        selectedCharacterId: null,
        currentWeek: 1
    };

    if (!state.viewMode) {
        state.viewMode = 'student';
    }

    window.academiaScheduleState = state;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var DAY_NAMES_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var HOURS = [];
    for (var h = 8; h <= 20; h++) {
        HOURS.push(h);
    }

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function validateDependencies(container) {
        var missing = [];

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
        }

        if (typeof window.getInstructors !== 'function') {
            missing.push('getInstructors');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.getStudentSchedule !== 'function') {
            missing.push('getStudentSchedule');
        }

        if (typeof window.getAvailableDisciplines !== 'function') {
            missing.push('getAvailableDisciplines');
        }

        if (typeof window.getDiscipline !== 'function') {
            missing.push('getDiscipline');
        }

        if (typeof window.getClassInstructor !== 'function') {
            missing.push('getClassInstructor');
        }

        if (typeof window.getClassDuration !== 'function') {
            missing.push('getClassDuration');
        }

        if (typeof window.getClassLocation !== 'function') {
            missing.push('getClassLocation');
        }

        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (missing.length > 0) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Schedule dependencies not loaded. Please refresh the page.</p>';
            }
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER ACADEMIA SCHEDULE - Public API
    // ============================================================

    function renderAcademiaSchedule(container) {
        if (!container) {
            container = document.getElementById('schedule-content');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading schedule data...</p>';
            return;
        }

        if (!validateDependencies(container)) {
            return;
        }

        window.ensureCurriculum();

        container.innerHTML = getScheduleHTML();
        populateCharacterSelectors(container);
        renderSchedule(container);
        initScheduleEvents(container);
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
    // SCHEDULE HTML
    // ============================================================

    function getScheduleHTML() {
        return `
            <div class="page-header">
                <h2>Schedule</h2>
            </div>
            <div class="schedule-controls">
                <div class="view-mode-selector">
                    <button class="view-mode-btn ${state.viewMode === 'student' ? 'active' : ''}" data-mode="student" style="background:${state.viewMode === 'student' ? 'var(--accent-soft)' : 'transparent'};border:1px solid ${state.viewMode === 'student' ? 'var(--accent)' : 'var(--border)'};color:${state.viewMode === 'student' ? 'var(--accent)' : 'var(--text-dim)'};padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.75rem;">Student</button>
                    <button class="view-mode-btn ${state.viewMode === 'instructor' ? 'active' : ''}" data-mode="instructor" style="background:${state.viewMode === 'instructor' ? 'var(--accent-soft)' : 'transparent'};border:1px solid ${state.viewMode === 'instructor' ? 'var(--accent)' : 'var(--border)'};color:${state.viewMode === 'instructor' ? 'var(--accent)' : 'var(--text-dim)'};padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.75rem;">Instructor</button>
                </div>
                <div class="character-selector">
                    <label for="schedule-character">${state.viewMode === 'student' ? 'Student:' : 'Instructor:'}</label>
                    <select id="schedule-character">
                        <option value="">Select...</option>
                    </select>
                </div>
                <div class="week-nav">
                    <button id="prev-schedule-week" class="small">[<]</button>
                    <span id="schedule-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-schedule-week" class="small">[>]</button>
                </div>
            </div>
            <div id="schedule-grid-container">
                <p class="empty-state">Select a ${state.viewMode === 'student' ? 'student' : 'instructor'} to view their schedule</p>
            </div>
        `;
    }

    // ============================================================
    // POPULATE CHARACTER SELECTORS
    // ============================================================

    function populateCharacterSelectors(container) {
        var select = container ? container.querySelector('#schedule-character') : document.getElementById('schedule-character');
        if (!select) {
            return;
        }

        var characters = [];
        var currentValue = select.value;

        if (state.viewMode === 'student') {
            characters = window.getStudents();
        } else {
            characters = window.getInstructors();
        }

        select.innerHTML = '<option value="">Select ' + (state.viewMode === 'student' ? 'student' : 'instructor') + '...</option>';

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            var name = window.getDisplayName(char);
            var option = document.createElement('option');
            option.value = char.id;
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
                state.selectedCharacterId = null;
            }
        }

        if (state.selectedCharacterId) {
            var exists2 = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === state.selectedCharacterId) {
                    exists2 = true;
                    break;
                }
            }
            if (exists2) {
                select.value = state.selectedCharacterId;
            } else {
                state.selectedCharacterId = null;
            }
        }

        if (!state.selectedCharacterId && select.options.length > 1) {
            select.selectedIndex = 1;
            state.selectedCharacterId = select.value;
        }
    }

    // ============================================================
    // RENDER SCHEDULE
    // ============================================================

    function renderSchedule(container) {
        var gridContainer = container ? container.querySelector('#schedule-grid-container') : document.getElementById('schedule-grid-container');
        var weekDisplay = container ? container.querySelector('#schedule-week-display') : document.getElementById('schedule-week-display');

        if (!gridContainer) {
            return;
        }

        if (weekDisplay) {
            weekDisplay.textContent = 'Week ' + state.currentWeek;
        }

        var select = container ? container.querySelector('#schedule-character') : document.getElementById('schedule-character');
        if (select && select.value) {
            state.selectedCharacterId = select.value;
        }

        if (!state.selectedCharacterId) {
            gridContainer.innerHTML = '<p class="empty-state">Select a ' + (state.viewMode === 'student' ? 'student' : 'instructor') + ' to view their schedule</p>';
            return;
        }

        var character = window.getCharacterById(state.selectedCharacterId);
        if (!character) {
            gridContainer.innerHTML = '<p class="empty-state">Character not found</p>';
            return;
        }

        var characterName = window.getDisplayName(character);
        var isStudent = state.viewMode === 'student';

        if (isStudent) {
            renderStudentSchedule(gridContainer, character, characterName);
        } else {
            renderInstructorSchedule(gridContainer, character, characterName);
        }
    }

    // ============================================================
    // RENDER STUDENT SCHEDULE
    // ============================================================

    function renderStudentSchedule(container, student, studentName) {
        var schedule = window.getStudentSchedule(student.id, state.currentWeek);

        if (!schedule || Object.keys(schedule).length === 0) {
            container.innerHTML = '<p class="empty-state">' + escapeHtml(studentName) + ' has no classes scheduled for week ' + state.currentWeek + '</p>';
            return;
        }

        var html = '<h3 style="color:var(--accent);margin-bottom:8px;">' + escapeHtml(studentName) + ' - Week ' + state.currentWeek + '</h3>';
        html += '<div class="schedule-grid">';
        html += getGridHeaderHTML();
        html += getGridBodyHTML(schedule);
        html += '</div>';

        container.innerHTML = html;
    }

    // ============================================================
    // RENDER INSTRUCTOR SCHEDULE
    // ============================================================

    function renderInstructorSchedule(container, instructor, instructorName) {
        // Get all students
        var students = window.getStudents();
        var scheduleData = {};

        // Build instructor schedule from all student schedules
        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var schedule = window.getStudentSchedule(student.id, state.currentWeek);

            if (!schedule || Object.keys(schedule).length === 0) {
                continue;
            }

            for (var day in schedule) {
                if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                    continue;
                }
                var daySchedule = schedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') {
                    continue;
                }

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                        continue;
                    }
                    var disciplineId = daySchedule[hour];
                    if (!disciplineId) {
                        continue;
                    }

                    var hourNum = parseInt(hour, 10);
                    var dayNum = parseInt(day, 10);

                    if (isNaN(hourNum) || isNaN(dayNum)) {
                        continue;
                    }

                    // Check if this instructor teaches this class
                    var classInstructor = window.getClassInstructor(student.id, state.currentWeek, dayNum, hourNum);
                    if (String(classInstructor) !== String(instructor.id)) {
                        continue;
                    }

                    var key = day + '_' + hour;
                    if (!scheduleData[key]) {
                        scheduleData[key] = {
                            day: dayNum,
                            hour: hourNum,
                            disciplineId: disciplineId,
                            students: []
                        };
                    }

                    var alreadyAdded = false;
                    for (var s = 0; s < scheduleData[key].students.length; s++) {
                        if (String(scheduleData[key].students[s].id) === String(student.id)) {
                            alreadyAdded = true;
                            break;
                        }
                    }

                    if (!alreadyAdded) {
                        scheduleData[key].students.push(student);
                    }
                }
            }
        }

        var keys = Object.keys(scheduleData);

        if (keys.length === 0) {
            container.innerHTML = '<p class="empty-state">' + escapeHtml(instructorName) + ' has no classes scheduled for week ' + state.currentWeek + '</p>';
            return;
        }

        var html = '<h3 style="color:var(--accent);margin-bottom:8px;">' + escapeHtml(instructorName) + ' - Week ' + state.currentWeek + '</h3>';
        html += '<div style="display:flex;flex-direction:column;gap:8px;">';

        keys.sort(function(a, b) {
            var aParts = a.split('_');
            var bParts = b.split('_');
            var dayA = parseInt(aParts[0], 10);
            var dayB = parseInt(bParts[0], 10);
            if (dayA !== dayB) {
                return dayA - dayB;
            }
            return parseInt(aParts[1], 10) - parseInt(bParts[1], 10);
        });

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var entry = scheduleData[key];
            var discipline = window.getDiscipline(entry.disciplineId);

            var duration = window.getClassDuration(student.id, state.currentWeek, entry.day, entry.hour);
            var location = window.getClassLocation(student.id, state.currentWeek, entry.day, entry.hour);

            var hourDisplay = entry.hour > 12 ? entry.hour - 12 : entry.hour;
            var ampm = entry.hour >= 12 ? 'PM' : 'AM';
            if (entry.hour === 0) {
                hourDisplay = 12;
                ampm = 'AM';
            }
            if (entry.hour === 12) {
                ampm = 'PM';
            }

            var durationDisplay = duration && duration > 1 ? ' (' + duration + 'h)' : '';

            html += '<div style="background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;padding:8px 12px;border-left:3px solid var(--accent);">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">';
            html += '<span style="font-weight:600;">' + escapeHtml(DAY_NAMES[entry.day] || 'Unknown') + ' at ' + hourDisplay + ':00 ' + ampm + durationDisplay + '</span>';
            html += '<span style="font-size:0.75rem;color:var(--text-dim);">' + (discipline ? escapeHtml(discipline.name) : 'Unknown') + '</span>';
            if (location) {
                html += '<span style="font-size:0.7rem;color:var(--info);">📍 ' + escapeHtml(location) + '</span>';
            }
            html += '</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">';
            html += '<span style="font-size:0.65rem;color:var(--text-dim);">Students (' + entry.students.length + '): </span>';

            entry.students.sort(function(a, b) {
                return window.getDisplayName(a).localeCompare(window.getDisplayName(b));
            });

            for (var s = 0; s < entry.students.length; s++) {
                var student = entry.students[s];
                html += '<span style="background:var(--bg);padding:1px 8px;border-radius:10px;font-size:0.65rem;">' + escapeHtml(window.getDisplayName(student)) + '</span>';
            }

            html += '</div>';
            html += '</div>';
        }

        html += '</div>';

        container.innerHTML = html;
    }

    // ============================================================
    // SCHEDULE GRID HELPERS
    // ============================================================

    function getGridHeaderHTML() {
        var html = '<div class="schedule-row schedule-header">';
        html += '<div class="schedule-cell schedule-time" style="font-weight:600;font-size:0.7rem;color:var(--text-dim);">Time</div>';

        for (var d = 1; d <= 5; d++) {
            html += '<div class="schedule-cell schedule-day" style="font-weight:600;font-size:0.7rem;color:var(--text-dim);text-align:center;">' + escapeHtml(DAY_NAMES_SHORT[d]) + '</div>';
        }

        html += '</div>';
        return html;
    }

    function getGridBodyHTML(schedule) {
        var html = '';

        for (var h = 0; h < HOURS.length; h++) {
            var hour = HOURS[h];
            var hourDisplay = hour > 12 ? hour - 12 : hour;
            var ampm = hour >= 12 ? 'PM' : 'AM';
            if (hour === 0) {
                hourDisplay = 12;
                ampm = 'AM';
            }
            if (hour === 12) {
                ampm = 'PM';
            }

            html += '<div class="schedule-row">';
            html += '<div class="schedule-cell schedule-time" style="font-size:0.65rem;color:var(--text-dim);">' + hourDisplay + ':00 ' + ampm + '</div>';

            for (var d = 1; d <= 5; d++) {
                var content = '';
                var classNames = 'schedule-cell';

                if (schedule[d] && schedule[d][hour]) {
                    var disciplineId = schedule[d][hour];
                    var discipline = window.getDiscipline(disciplineId);
                    var instructorId = window.getClassInstructor(state.selectedCharacterId, state.currentWeek, d, hour);
                    var duration = window.getClassDuration(state.selectedCharacterId, state.currentWeek, d, hour);
                    var location = window.getClassLocation(state.selectedCharacterId, state.currentWeek, d, hour);

                    var instructor = instructorId ? window.getCharacterById(instructorId) : null;
                    var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';

                    var durationDisplay = duration && duration > 1 ? ' (' + duration + 'h)' : '';
                    var locationDisplay = location ? ' 📍' : '';

                    content = '<div style="background:var(--accent-soft);border:1px solid var(--accent);border-radius:4px;padding:2px 6px;font-size:0.6rem;text-align:center;cursor:default;">';
                    content += '<div style="font-weight:600;color:var(--accent);">' + (discipline ? escapeHtml(discipline.name) : 'Unknown') + '</div>';
                    content += '<div style="color:var(--text-dim);font-size:0.5rem;">' + escapeHtml(instructorName) + durationDisplay + locationDisplay + '</div>';
                    content += '</div>';

                    classNames += ' occupied';
                } else {
                    content = '—';
                    classNames += ' empty';
                }

                html += '<div class="' + classNames + '" style="text-align:center;font-size:0.65rem;color:var(--text-dim);padding:4px;">' + content + '</div>';
            }

            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initScheduleEvents(container) {
        var viewModeBtns = container ? container.querySelectorAll('.view-mode-btn') : document.querySelectorAll('.view-mode-btn');

        viewModeBtns.forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', function() {
                var mode = this.dataset.mode;
                if (mode && mode !== state.viewMode) {
                    state.viewMode = mode;

                    // Update button styles
                    var btns = this.parentElement.querySelectorAll('.view-mode-btn');
                    btns.forEach(function(b) {
                        var isActive = b.dataset.mode === state.viewMode;
                        b.style.background = isActive ? 'var(--accent-soft)' : 'transparent';
                        b.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
                        b.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
                    });

                    var label = document.querySelector('label[for="schedule-character"]');
                    if (label) {
                        label.textContent = state.viewMode === 'student' ? 'Student:' : 'Instructor:';
                    }

                    // Reset selection
                    state.selectedCharacterId = null;
                    populateCharacterSelectors(container);
                    renderSchedule(container);
                }
            });
        });

        var characterSelect = container ? container.querySelector('#schedule-character') : document.getElementById('schedule-character');

        if (characterSelect) {
            var newSelect = characterSelect.cloneNode(true);
            characterSelect.parentNode.replaceChild(newSelect, characterSelect);

            newSelect.addEventListener('change', function() {
                state.selectedCharacterId = this.value;
                renderSchedule(container);
            });
        }

        var prevBtn = container ? container.querySelector('#prev-schedule-week') : document.getElementById('prev-schedule-week');

        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderSchedule(container);
                }
            });
        }

        var nextBtn = container ? container.querySelector('#next-schedule-week') : document.getElementById('next-schedule-week');

        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderSchedule(container);
                }
            });
        }

        // Auto-select first character if none selected
        if (!state.selectedCharacterId) {
            var select = container ? container.querySelector('#schedule-character') : document.getElementById('schedule-character');
            if (select && select.options.length > 1) {
                select.selectedIndex = 1;
                state.selectedCharacterId = select.value;
                setTimeout(function() {
                    renderSchedule(container);
                }, 50);
            }
        }
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderAcademiaSchedule = renderAcademiaSchedule;
    window.academiaScheduleState = state;

})();
