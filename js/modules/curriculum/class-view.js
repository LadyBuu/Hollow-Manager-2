/**
 * js/modules/curriculum/class-view.js - Class View Module
 * Shows classes grouped by discipline and instructor
 * Path: js/modules/curriculum/class-view.js
 * 
 * This module is responsible for:
 *   - Rendering a summary view of all scheduled classes
 *   - Grouping classes by discipline and instructor
 *   - Displaying student rosters for each class
 *   - Filtering by discipline type (mandatory/optional)
 *   - Exporting the class view to a printable format
 * 
 * IMPORTANT:
 *   - All data is read-only (no mutations)
 *   - This module does NOT mutate window.data directly.
 *   - UI state is managed through shared curriculum state.
 *   - Render is triggered by curriculum-main.js via TabManager.
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 * 
 * ARCHITECTURAL NOTE:
 *   - Classes are inferred from student schedules.
 *   - A class is defined as: discipline + instructor + day + hour + duration.
 *   - Duration is included in grouping to distinguish different class lengths.
 *   - Students with the same discipline, instructor, day, hour, and duration
 *     are grouped into one class.
 *   - Deceased students are displayed with reduced opacity.
 *   - A class with no students is not displayed (class view shows enrolled classes).
 *   - Only the starting hour of a multi-hour class is used for grouping.
 *   - Class start detection is based on duration metadata (not discipline continuity).
 *   - Duration metadata is stored only at class starts, so it's the authoritative source.
 *   - The discipline filter properly filters which disciplines are included.
 *   - Schedule positions (day/hour) are validated before processing.
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Class view UI state, stored in shared curriculum state
    // ============================================================

    if (!window.curriculumState) {
        window.curriculumState = {};
    }
    
    if (!window.curriculumState.classView) {
        window.curriculumState.classView = {
            currentWeek: 1,
            filterDiscipline: 'all'
        };
    }

    var state = window.curriculumState.classView;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // ============================================================
    // RENDER CLASS VIEW - Public API (only this is exposed)
    // ============================================================

    function renderClassView(container) {
        if (!container) {
            container = document.getElementById('class-view-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading class view data...</p>';
            return;
        }

        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[ClassView] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        // Verify all core dependencies
        var requiredDeps = [
            { name: 'getStudents', fn: window.getStudents },
            { name: 'getAvailableDisciplines', fn: window.getAvailableDisciplines },
            { name: 'getDiscipline', fn: window.getDiscipline },
            { name: 'getDisplayName', fn: window.getDisplayName },
            { name: 'getCharacterById', fn: window.getCharacterById },
            { name: 'getStudentSchedule', fn: window.getStudentSchedule },
            { name: 'getClassInstructor', fn: window.getClassInstructor },
            { name: 'getClassDuration', fn: window.getClassDuration }
        ];

        for (var i = 0; i < requiredDeps.length; i++) {
            if (typeof requiredDeps[i].fn !== 'function') {
                console.error('[ClassView] ' + requiredDeps[i].name + '() is not available.');
                container.innerHTML = '<p class="empty-state">Class view core module not loaded. Please refresh the page.</p>';
                return;
            }
        }

        container.innerHTML = getClassViewHTML();
        populateClassFilter();
        renderClassData();
        initClassViewEvents();
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
    // GET SAFE DISPLAY NAME
    // ============================================================

    function getSafeDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char && char.name ? char.name : 'Unknown';
    }

    // ============================================================
    // CLASS VIEW HTML
    // ============================================================

    function getClassViewHTML() {
        return `
            <div class="page-header">
                <h2>Class View</h2>
                <div class="header-actions">
                    <button id="export-class-view-btn" class="small primary">↓ Export</button>
                </div>
            </div>
            <div class="calendar-controls">
                <div class="week-nav">
                    <button id="prev-class-week" class="small">← Prev</button>
                    <span id="class-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-class-week" class="small">Next →</button>
                    <button id="goto-class-week" class="small primary">Go to Week</button>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <label for="class-discipline-filter" style="font-size:0.75rem;color:var(--text-dim);">Filter:</label>
                    <select id="class-discipline-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Disciplines</option>
                        <option value="mandatory">■ Mandatory Only</option>
                        <option value="optional">□ Optional Only</option>
                    </select>
                </div>
            </div>
            <div id="class-view-container">
                <p class="empty-state">Loading class data...</p>
            </div>
        `;
    }

    // ============================================================
    // POPULATE CLASS FILTER
    // ============================================================

    function populateClassFilter() {
        var select = document.getElementById('class-discipline-filter');
        if (!select) return;

        var valueToSet = state.filterDiscipline || 'all';

        // Normalise invalid filter values
        if (valueToSet !== 'all' && valueToSet !== 'mandatory' && valueToSet !== 'optional') {
            valueToSet = 'all';
            state.filterDiscipline = 'all';
        }

        select.innerHTML = `
            <option value="all" ${valueToSet === 'all' ? 'selected' : ''}>All Disciplines</option>
            <option value="mandatory" ${valueToSet === 'mandatory' ? 'selected' : ''}>■ Mandatory Only</option>
            <option value="optional" ${valueToSet === 'optional' ? 'selected' : ''}>□ Optional Only</option>
        `;
    }

    // ============================================================
    // RENDER CLASS DATA - Read-only
    // ============================================================

    function renderClassData() {
        var container = document.getElementById('class-view-container');
        if (!container) return;

        var weekDisplay = document.getElementById('class-week-display');
        if (weekDisplay) weekDisplay.textContent = 'Week ' + state.currentWeek;

        var students = window.getStudents();
        if (students.length === 0) {
            container.innerHTML = '<p class="empty-state">No students found. Add some students first.</p>';
            return;
        }

        var allDisciplines = window.getAvailableDisciplines(state.currentWeek);
        if (allDisciplines.length === 0) {
            container.innerHTML = '<p class="empty-state">No disciplines available for week ' + state.currentWeek + '. Add some disciplines first.</p>';
            return;
        }

        var filterType = document.getElementById('class-discipline-filter') ? 
            document.getElementById('class-discipline-filter').value : 'all';

        // Filter disciplines based on selection
        var disciplines = allDisciplines;
        if (filterType === 'mandatory') {
            disciplines = disciplines.filter(function(d) { return d.type === 'mandatory'; });
        } else if (filterType === 'optional') {
            disciplines = disciplines.filter(function(d) { return d.type === 'optional'; });
        }

        if (disciplines.length === 0) {
            container.innerHTML = '<p class="empty-state">No ' + filterType + ' disciplines available for week ' + state.currentWeek + '</p>';
            return;
        }

        // Build discipline map for fast lookup
        var disciplineMap = {};
        disciplines.forEach(function(discipline) {
            disciplineMap[String(discipline.id)] = true;
        });

        // Build class index from student schedules
        var classIndex = {};

        students.forEach(function(student) {
            var schedule = window.getStudentSchedule(student.id, state.currentWeek);
            if (!schedule || typeof schedule !== 'object') return;

            for (var day in schedule) {
                if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
                var daySchedule = schedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') continue;

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                    var disciplineId = daySchedule[hour];
                    if (!disciplineId) continue;

                    // Validate schedule position
                    var hourNum = parseInt(hour, 10);
                    var dayNum = parseInt(day, 10);

                    if (!Number.isInteger(hourNum) || !Number.isInteger(dayNum)) {
                        console.warn('[ClassView] Invalid schedule position:', {
                            studentId: student.id,
                            week: state.currentWeek,
                            day: day,
                            hour: hour
                        });
                        continue;
                    }

                    // Apply discipline filter
                    if (!disciplineMap[String(disciplineId)]) {
                        continue;
                    }

                    // Check if this is a class start by looking for duration metadata
                    // (duration metadata is only stored at class starts)
                    var duration = window.getClassDuration(student.id, state.currentWeek, dayNum, hourNum);

                    if (!Number.isInteger(duration) || duration < 1) {
                        // Not a class start, or invalid data
                        continue;
                    }

                    // Get instructor for this class
                    var instructorId = window.getClassInstructor(student.id, state.currentWeek, dayNum, hourNum);

                    // Key: discipline_instructor_day_hour_duration
                    var key = disciplineId + '|' + (instructorId || 'unassigned') + '|' + dayNum + '|' + hourNum + '|' + duration;

                    if (!classIndex[key]) {
                        var discipline = window.getDiscipline(disciplineId);
                        var instructor = instructorId ? window.getCharacterById(instructorId) : null;

                        classIndex[key] = {
                            disciplineId: disciplineId,
                            discipline: discipline,
                            instructorId: instructorId,
                            instructor: instructor,
                            day: dayNum,
                            hour: hourNum,
                            duration: duration,
                            students: []
                        };
                    }

                    // Check if student already in this class
                    var alreadyInClass = classIndex[key].students.some(function(s) {
                        return String(s.id) === String(student.id);
                    });

                    if (!alreadyInClass) {
                        classIndex[key].students.push(student);
                    }
                }
            }
        });

        var classKeys = Object.keys(classIndex);

        if (classKeys.length === 0) {
            container.innerHTML = '<p class="empty-state">No classes scheduled for week ' + state.currentWeek + '</p>';
            return;
        }

        // Sort classes by discipline name
        classKeys.sort(function(a, b) {
            var aDisc = classIndex[a].discipline;
            var bDisc = classIndex[b].discipline;
            var aName = aDisc ? aDisc.name : '';
            var bName = bDisc ? bDisc.name : '';
            return aName.localeCompare(bName);
        });

        var html = '';
        var currentDisciplineId = null;
        var disciplineClasses = [];

        classKeys.forEach(function(key) {
            var cls = classIndex[key];
            if (!cls || !cls.discipline) return;

            var discId = cls.disciplineId;

            if (currentDisciplineId !== discId) {
                if (disciplineClasses.length > 0) {
                    html += renderDisciplineGroup(currentDisciplineId, disciplineClasses);
                }
                currentDisciplineId = discId;
                disciplineClasses = [];
            }

            disciplineClasses.push(cls);
        });

        if (disciplineClasses.length > 0) {
            html += renderDisciplineGroup(currentDisciplineId, disciplineClasses);
        }

        if (html === '') {
            container.innerHTML = '<p class="empty-state">No classes scheduled for week ' + state.currentWeek + '</p>';
        } else {
            container.innerHTML = html;
        }
    }

    // ============================================================
    // RENDER DISCIPLINE GROUP
    // ============================================================

    function renderDisciplineGroup(disciplineId, classes) {
        var firstClass = classes[0];
        var discipline = firstClass.discipline;
        if (!discipline) return '';

        var typeLabel = discipline.type === 'mandatory' ? '■ Mandatory' : '□ Optional';
        var typeColor = discipline.type === 'mandatory' ? 'var(--accent)' : 'var(--warning)';

        var safeDisciplineName = escapeHtml(discipline.name);

        // Build CSS classes for the badge to avoid invalid inline CSS
        var typeClass = discipline.type === 'mandatory' ? 'mandatory' : 'optional';

        var html = '';
        html += '<div class="class-view-discipline" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);margin:0;">' + safeDisciplineName + '</h3>';
        html += '<span class="class-type-badge ' + typeClass + '">' + typeLabel + '</span>';
        html += '</div>';

        var instructorGroups = {};
        classes.forEach(function(cls) {
            var instructorKey = cls.instructorId || 'unassigned';
            if (!instructorGroups[instructorKey]) {
                instructorGroups[instructorKey] = {
                    instructorId: cls.instructorId,
                    instructor: cls.instructor,
                    classes: []
                };
            }
            instructorGroups[instructorKey].classes.push(cls);
        });

        var instructorKeys = Object.keys(instructorGroups).sort(function(a, b) {
            if (a === 'unassigned') return 1;
            if (b === 'unassigned') return -1;
            if (a === b) return 0;
            var aInstructor = instructorGroups[a].instructor;
            var bInstructor = instructorGroups[b].instructor;
            var aName = aInstructor ? getSafeDisplayName(aInstructor) : '';
            var bName = bInstructor ? getSafeDisplayName(bInstructor) : '';
            return aName.localeCompare(bName);
        });

        instructorKeys.forEach(function(key) {
            var group = instructorGroups[key];
            var instructorName = 'Not assigned';
            if (group.instructorId) {
                var instructor = group.instructor;
                if (instructor) {
                    instructorName = getSafeDisplayName(instructor);
                }
            }

            var safeInstructorName = escapeHtml(instructorName);

            html += '<div style="background:var(--bg);border-radius:6px;padding:10px 12px;margin-bottom:8px;border-left:3px solid var(--accent);">';
            html += '<div style="font-weight:600;color:var(--accent);font-size:0.85rem;margin-bottom:6px;">◊ ' + safeInstructorName + '</div>';

            var sortedClasses = group.classes.slice().sort(function(a, b) {
                if (a.day !== b.day) return a.day - b.day;
                return a.hour - b.hour;
            });

            sortedClasses.forEach(function(cls) {
                var hourDisplay = cls.hour > 12 ? cls.hour - 12 : cls.hour;
                var ampm = cls.hour >= 12 ? 'PM' : 'AM';
                if (cls.hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                if (cls.hour === 12) { ampm = 'PM'; }

                var hasMaxStudents = discipline.maxStudents !== null &&
                                      discipline.maxStudents !== undefined &&
                                      discipline.maxStudents !== '';
                var isFull = hasMaxStudents &&
                             cls.students.length >= Number(discipline.maxStudents);

                var safeDayName = escapeHtml(DAY_NAMES[cls.day]);
                var safeHourDisplay = escapeHtml(hourDisplay + ':00 ' + ampm);
                var durationDisplay = cls.duration > 1 ? ' (' + cls.duration + 'h)' : '';

                html += '<div style="background:var(--panel-alt);border-radius:4px;padding:6px 10px;margin-bottom:4px;border-left:3px solid ' + (isFull ? 'var(--danger)' : typeColor) + ';">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">';
                html += '<span style="font-weight:500;font-size:0.8rem;">' + safeDayName + ' at ' + safeHourDisplay + durationDisplay + '</span>';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">' + cls.students.length + ' student' + (cls.students.length > 1 ? 's' : '') + (isFull ? ' <span style="color:var(--danger);">FULL</span>' : '') + '</span>';
                html += '</div>';
                html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';

                var sortedStudents = cls.students.slice().sort(function(a, b) {
                    return getSafeDisplayName(a).localeCompare(getSafeDisplayName(b));
                });

                sortedStudents.forEach(function(student) {
                    var name = getSafeDisplayName(student);
                    var status = window.getCurrentStatus ? window.getCurrentStatus(student) : '';
                    var isDeceased = student.deceased || false;
                    var safeName = escapeHtml(name);
                    var safeStatus = escapeHtml(status);

                    html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;' + 
                        (isDeceased ? 'opacity:0.4;text-decoration:line-through;' : '') + '">' + 
                        safeName + ' <span style="color:var(--text-dim);font-size:0.6rem;">(' + safeStatus + ')</span></span>';
                });

                html += '</div>';
                html += '</div>';
            });

            html += '</div>';
        });

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPORT CLASS VIEW
    // ============================================================

    function exportClassView() {
        var container = document.getElementById('class-view-container');
        if (!container) return;

        var week = state.currentWeek;

        var win = window.open('', '_blank');
        if (!win) {
            showNotification('Please allow pop-ups to export the class view.', 'error');
            return;
        }

        win.document.write('<!DOCTYPE html><html><head><title>Class View - Week ' + week + '</title>');
        win.document.write('<style>');
        win.document.write('body{font-family:Arial,sans-serif;padding:20px;background:#fff;color:#333;}');
        win.document.write('.class-view-discipline{border:1px solid #ccc;border-radius:8px;padding:16px;margin-bottom:16px;}');
        win.document.write('.discipline-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:8px;}');
        win.document.write('.class-type-badge{font-size:0.75rem;padding:2px 12px;border-radius:12px;}');
        win.document.write('.class-type-badge.mandatory{background:rgba(140,187,58,0.15);color:#8cbb3a;border:1px solid #8cbb3a;}');
        win.document.write('.class-type-badge.optional{background:rgba(201,162,75,0.15);color:#c9a24b;border:1px solid #c9a24b;}');
        win.document.write('.instructor-group{background:#f5f5f5;border-radius:6px;padding:10px 12px;margin-bottom:8px;border-left:3px solid #4CAF50;}');
        win.document.write('.instructor-name{font-weight:600;color:#2E7D32;font-size:0.85rem;margin-bottom:6px;}');
        win.document.write('.class-group{background:#e8e8e8;border-radius:4px;padding:6px 10px;margin-bottom:4px;}');
        win.document.write('.class-time{font-weight:500;font-size:0.8rem;margin-bottom:4px;}');
        win.document.write('.student-tag{background:#fff;padding:2px 10px;border-radius:12px;font-size:0.7rem;display:inline-block;margin:2px;}');
        win.document.write('.student-tag .status{color:#666;font-size:0.6rem;}');
        win.document.write('.full{color:#d32f2f;}');
        win.document.write('</style></head><body>');
        win.document.write('<h1>Class View - Week ' + week + '</h1>');
        win.document.write('<p>Generated: ' + new Date().toLocaleString() + '</p>');
        win.document.write('<hr>');

        var cloneContainer = container.cloneNode(true);
        win.document.write(cloneContainer.innerHTML);

        win.document.write('</body></html>');
        win.document.close();
        win.print();
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
            console.log('[ClassView]', message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initClassViewEvents() {
        var prevBtn = document.getElementById('prev-class-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderClassData();
                }
            });
        }

        var nextBtn = document.getElementById('next-class-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderClassData();
                }
            });
        }

        var gotoBtn = document.getElementById('goto-class-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', state.currentWeek);
                if (week) {
                    var w = parseInt(week, 10);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        state.currentWeek = w;
                        renderClassData();
                    } else {
                        showNotification('Please enter a valid week (1-52).', 'error');
                    }
                }
            });
        }

        var filterSelect = document.getElementById('class-discipline-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', function() {
                state.filterDiscipline = this.value;
                renderClassData();
            });
        }

        var exportBtn = document.getElementById('export-class-view-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportClassView);
        }
    }

    // ============================================================
    // REGISTER WITH CURRICULUM MAIN
    // ============================================================

    window.curriculumState.classView = state;

    // ============================================================
    // EXPOSE FUNCTIONS - Minimal public API
    // ============================================================

    window.renderClassView = renderClassView;

})();
