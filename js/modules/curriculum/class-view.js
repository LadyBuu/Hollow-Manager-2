/**
 * js/modules/curriculum/class-view.js - Class View Module
 * Shows classes grouped by discipline and instructor
 * Path: js/modules/curriculum/class-view.js
 */

(function() {
    'use strict';

    var state = {
        currentWeek: 1,
        filterDiscipline: 'all'
    };

    function renderClassView(container) {
        if (!container) {
            container = document.getElementById('class-view-content');
        }
        if (!container) return;

        container.innerHTML = getClassViewHTML();

        populateClassFilter();
        initClassViewEvents();
        renderClassData();
    }

    function getClassViewHTML() {
        return `
            <div class="page-header">
                <h2>Class View</h2>
                <div class="header-actions">
                    <button id="export-class-view-btn" class="small primary">\u2193 Export</button>
                </div>
            </div>
            <div class="calendar-controls">
                <div class="week-nav">
                    <button id="prev-class-week" class="small">\u2190 Prev</button>
                    <span id="class-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-class-week" class="small">Next \u2192</button>
                    <button id="goto-class-week" class="small primary">Go to Week</button>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <label for="class-discipline-filter" style="font-size:0.75rem;color:var(--text-dim);">Filter:</label>
                    <select id="class-discipline-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Disciplines</option>
                        <option value="mandatory">\u25A3 Mandatory Only</option>
                        <option value="optional">\u25A2 Optional Only</option>
                    </select>
                </div>
            </div>
            <div id="class-view-container">
                <p class="empty-state">Loading class data...</p>
            </div>
        `;
    }

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

        var disciplines = allDisciplines;
        if (state.filterDiscipline === 'mandatory') {
            disciplines = disciplines.filter(function(d) { return d.type === 'mandatory'; });
        } else if (state.filterDiscipline === 'optional') {
            disciplines = disciplines.filter(function(d) { return d.type === 'optional'; });
        }

        if (disciplines.length === 0) {
            container.innerHTML = '<p class="empty-state">No ' + state.filterDiscipline + ' disciplines available for week ' + state.currentWeek + '</p>';
            return;
        }

        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        var html = '';
        disciplines.forEach(function(discipline) {
            var instructorGroups = {};

            students.forEach(function(student) {
                var schedule = window.getStudentSchedule(student.id, state.currentWeek);
                for (var day in schedule) {
                    for (var hour in schedule[day]) {
                        if (String(schedule[day][hour]) === String(discipline.id)) {
                            var instructorId = null;
                            if (typeof window.getClassInstructor === 'function') {
                                instructorId = window.getClassInstructor(student.id, state.currentWeek, parseInt(day), parseInt(hour));
                            }

                            var instructorKey = instructorId || 'unassigned';
                            if (!instructorGroups[instructorKey]) {
                                instructorGroups[instructorKey] = {
                                    instructorId: instructorId,
                                    classes: {}
                                };
                            }

                            var classKey = day + '_' + hour;
                            if (!instructorGroups[instructorKey].classes[classKey]) {
                                instructorGroups[instructorKey].classes[classKey] = {
                                    day: parseInt(day),
                                    hour: parseInt(hour),
                                    students: []
                                };
                            }
                            instructorGroups[instructorKey].classes[classKey].students.push(student);
                        }
                    }
                }
            });

            if (Object.keys(instructorGroups).length === 0) {
                return;
            }

            var typeLabel = discipline.type === 'mandatory' ? '\u25A3 Mandatory' : '\u25A2 Optional';
            var typeColor = discipline.type === 'mandatory' ? 'var(--accent)' : 'var(--warning)';

            html += '<div class="class-view-discipline" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">';
            html += '<h3 style="color:var(--accent);margin:0;">' + discipline.name + '</h3>';
            html += '<span style="font-size:0.75rem;padding:2px 12px;border-radius:12px;background:' + typeColor + '33;color:' + typeColor + ';border:1px solid ' + typeColor + ';">' + typeLabel + '</span>';
            html += '</div>';

            var instructorKeys = Object.keys(instructorGroups).sort(function(a, b) {
                if (a === 'unassigned') return 1;
                if (b === 'unassigned') return -1;
                return a.localeCompare(b);
            });

            instructorKeys.forEach(function(key) {
                var group = instructorGroups[key];
                var instructorName = 'Not assigned';
                if (group.instructorId) {
                    var instructor = window.getCharacterById(group.instructorId);
                    if (instructor) {
                        instructorName = window.getDisplayName(instructor);
                    }
                }

                html += '<div style="background:var(--bg);border-radius:6px;padding:10px 12px;margin-bottom:8px;border-left:3px solid var(--accent);">';
                html += '<div style="font-weight:600;color:var(--accent);font-size:0.85rem;margin-bottom:6px;">\u25CA ' + instructorName + '</div>';

                var classKeys = Object.keys(group.classes).sort(function(a, b) {
                    var aParts = a.split('_');
                    var bParts = b.split('_');
                    if (parseInt(aParts[0]) !== parseInt(bParts[0])) {
                        return parseInt(aParts[0]) - parseInt(bParts[0]);
                    }
                    return parseInt(aParts[1]) - parseInt(bParts[1]);
                });

                classKeys.forEach(function(classKey) {
                    var cls = group.classes[classKey];
                    var hourDisplay = cls.hour > 12 ? cls.hour - 12 : cls.hour;
                    var ampm = cls.hour >= 12 ? 'PM' : 'AM';
                    if (cls.hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                    if (cls.hour === 12) { ampm = 'PM'; }

                    var isFull = discipline.maxStudents && cls.students.length >= discipline.maxStudents;

                    html += '<div style="background:var(--panel-alt);border-radius:4px;padding:6px 10px;margin-bottom:4px;border-left:3px solid ' + (isFull ? 'var(--danger)' : typeColor) + ';">';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">';
                    html += '<span style="font-weight:500;font-size:0.8rem;">' + dayNames[cls.day] + ' at ' + hourDisplay + ':00 ' + ampm + '</span>';
                    html += '<span style="font-size:0.7rem;color:var(--text-dim);">' + cls.students.length + ' student' + (cls.students.length > 1 ? 's' : '') + (isFull ? ' <span style="color:var(--danger);">FULL</span>' : '') + '</span>';
                    html += '</div>';
                    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
                    cls.students.forEach(function(student) {
                        var name = window.getDisplayName(student);
                        var status = window.getCurrentStatus(student);
                        var isDeceased = student.deceased || false;
                        html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;' + (isDeceased ? 'opacity:0.4;text-decoration:line-through;' : '') + '">' + name + ' <span style="color:var(--text-dim);font-size:0.6rem;">(' + status + ')</span></span>';
                    });
                    html += '</div>';
                    html += '</div>';
                });

                html += '</div>';
            });

            html += '</div>';
        });

        if (html === '') {
            container.innerHTML = '<p class="empty-state">No classes scheduled for week ' + state.currentWeek + '</p>';
        } else {
            container.innerHTML = html;
        }
    }

    function populateClassFilter() {
        var select = document.getElementById('class-discipline-filter');
        if (!select) return;

        var currentValue = select.value;
        select.innerHTML = `
            <option value="all">All Disciplines</option>
            <option value="mandatory">\u25A3 Mandatory Only</option>
            <option value="optional">\u25A2 Optional Only</option>
        `;

        if (currentValue) {
            select.value = currentValue;
        } else if (state.filterDiscipline) {
            select.value = state.filterDiscipline;
        }
    }

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
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        state.currentWeek = w;
                        renderClassData();
                    } else {
                        alert('Please enter a valid week (1-52).');
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

    function exportClassView() {
        var container = document.getElementById('class-view-container');
        if (!container) return;

        var week = state.currentWeek;

        var win = window.open('', '_blank');
        win.document.write('<html><head><title>Class View - Week ' + week + '</title>');
        win.document.write('<style>');
        win.document.write('body{font-family:Arial,sans-serif;padding:20px;background:#fff;color:#333;}');
        win.document.write('.class-view-discipline{border:1px solid #ccc;border-radius:8px;padding:16px;margin-bottom:16px;}');
        win.document.write('.discipline-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:8px;}');
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

    // Register with curriculum main if available
    if (typeof window.curriculumState !== 'undefined') {
        window.curriculumState.classView = state;
    }

    window.renderClassView = renderClassView;
    window.renderClassData = renderClassData;
    window.populateClassFilter = populateClassFilter;
    window.initClassViewEvents = initClassViewEvents;
    window.exportClassView = exportClassView;
    window.classViewState = state;

})();