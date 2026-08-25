/**
 * js/modules/curriculum/instructor-calendar.js - Instructor Calendar Module
 * Path: js/modules/curriculum/instructor-calendar.js
 */

(function() {
    'use strict';

    // Prevent duplicate loading
    if (window.__instructorCalendarLoaded) {
        return;
    }
    window.__instructorCalendarLoaded = true;

    var state = {
        currentWeek: 1,
        selectedInstructorId: null,
        activeGroupFilter: 'all',
        expandedGroups: {}
    };

    function renderInstructorCalendar(container) {
        if (!container) {
            container = document.getElementById('instructor-calendar-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading instructor calendar data...</p>';
            return;
        }

        container.innerHTML = getInstructorCalendarHTML();

        populateInstructorSelector();
        populateGroupFilter();
        renderInstructorCalendarData();
        renderGroupList();
        initInstructorCalendarEvents();
    }

    function getInstructorCalendarHTML() {
        return `
            <div class="page-header">
                <h2>Instructor Calendar</h2>
                <div class="header-actions">
                    <button id="add-instructor-class-btn" class="primary small">+ Add Class</button>
                    <button id="add-instructor-block-btn" class="secondary small">Block Time</button>
                </div>
            </div>
            <div class="calendar-controls">
                <div class="instructor-selector">
                    <label for="instructor-calendar-select">Instructor:</label>
                    <select id="instructor-calendar-select">
                        <option value="">Select an instructor...</option>
                    </select>
                </div>
                <div class="week-nav">
                    <button id="prev-instructor-week" class="small">← Prev</button>
                    <span id="instructor-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-instructor-week" class="small">Next →</button>
                    <button id="goto-instructor-week" class="small primary">Go to Week</button>
                </div>
                <div class="group-filter">
                    <label for="instructor-group-filter" style="font-size:0.7rem;color:var(--text-dim);">Group Filter:</label>
                    <select id="instructor-group-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Groups</option>
                    </select>
                </div>
            </div>
            <div class="schedule-grid-wrapper" id="instructor-grid-wrapper">
                <div class="schedule-grid" id="instructor-grid">
                    <div class="day-column" data-day="1">
                        <div class="day-header">Monday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="2">
                        <div class="day-header">Tuesday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="3">
                        <div class="day-header">Wednesday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="4">
                        <div class="day-header">Thursday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="5">
                        <div class="day-header">Friday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="6">
                        <div class="day-header">Saturday</div>
                        <div class="day-slots"></div>
                    </div>
                    <div class="day-column" data-day="7">
                        <div class="day-header">Sunday</div>
                        <div class="day-slots"></div>
                    </div>
                </div>
            </div>
            <div style="margin-top:8px;font-size:0.7rem;color:var(--text-dim);text-align:center;">
                Click a slot to add class • Click a class to manage students • Right-click to remove
            </div>
            <div id="instructor-groups-container" style="margin-top:16px;"></div>
        `;
    }

    function populateInstructorSelector() {
        var select = document.getElementById('instructor-calendar-select');
        if (!select) return;

        var instructors = window.getInstructors();
        var currentValue = select.value;
        select.innerHTML = '<option value="">Select an instructor...</option>';

        if (!instructors || instructors.length === 0) {
            select.innerHTML += '<option value="" disabled>No instructors found</option>';
            return;
        }

        instructors.forEach(function(instructor) {
            var name = window.getDisplayName(instructor);
            var option = document.createElement('option');
            option.value = instructor.id;
            option.textContent = name;
            if (String(instructor.id) === String(state.selectedInstructorId)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        if (currentValue && !select.querySelector('option[value="' + currentValue + '"]')) {
            state.selectedInstructorId = null;
        }
    }

    function populateGroupFilter() {
        var select = document.getElementById('instructor-group-filter');
        if (!select) return;

        if (!state.selectedInstructorId) {
            select.innerHTML = '<option value="all">All Groups</option>';
            return;
        }

        var instructorId = state.selectedInstructorId;
        var week = state.currentWeek;
        var groups = getDisciplineGroupsForInstructor(instructorId, week);
        var groupKeys = Object.keys(groups).sort();

        var currentValue = select.value;
        select.innerHTML = '<option value="all">All Groups</option>';
        groupKeys.forEach(function(key) {
            var group = groups[key];
            var option = document.createElement('option');
            option.value = key;
            option.textContent = group.disciplineName + ' - Group ' + group.groupLabel + ' (' + group.students.length + ' students)';
            select.appendChild(option);
        });

        if (currentValue && groupKeys.indexOf(currentValue) !== -1) {
            select.value = currentValue;
        } else {
            select.value = 'all';
            state.activeGroupFilter = 'all';
        }
    }

    function getDisciplineGroupsForInstructor(instructorId, week) {
        var weekNum = parseInt(week) || 1;
        var result = {};

        var disciplines = window.getAvailableDisciplines(weekNum);
        var instructorDisciplines = disciplines.filter(function(d) {
            return d.instructorIds && d.instructorIds.some(function(id) { return String(id) === String(instructorId); });
        });

        if (typeof window.getDisciplineGroups === 'function') {
            instructorDisciplines.forEach(function(discipline) {
                var groups = window.getDisciplineGroups(discipline.id);
                for (var label in groups) {
                    var key = discipline.id + '_' + label;
                    result[key] = {
                        disciplineId: discipline.id,
                        disciplineName: discipline.name,
                        groupLabel: label,
                        students: Object.keys(groups[label].students || {})
                    };
                }
            });
        }

        return result;
    }

    function renderInstructorCalendarData() {
        var grid = document.getElementById('instructor-grid');
        if (!grid) return;

        var weekDisplay = document.getElementById('instructor-week-display');
        if (weekDisplay) weekDisplay.textContent = 'Week ' + state.currentWeek;

        if (!state.selectedInstructorId) {
            var dayColumns = grid.querySelectorAll('.day-column');
            dayColumns.forEach(function(col) {
                var slots = col.querySelector('.day-slots');
                if (slots) {
                    slots.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;">Select an instructor</div>';
                }
            });
            renderGroupList();
            return;
        }

        var instructor = window.getCharacterById(state.selectedInstructorId);
        if (!instructor) {
            var dayColumns = grid.querySelectorAll('.day-column');
            dayColumns.forEach(function(col) {
                var slots = col.querySelector('.day-slots');
                if (slots) {
                    slots.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center;">Instructor not found</div>';
                }
            });
            renderGroupList();
            return;
        }

        var week = state.currentWeek;
        var instructorId = state.selectedInstructorId;
        var activeFilter = state.activeGroupFilter;

        var scheduleMap = {};
        var students = window.getStudents();

        students.forEach(function(student) {
            var schedule = window.getStudentSchedule(student.id, week);
            for (var day in schedule) {
                for (var hour in schedule[day]) {
                    var disciplineId = schedule[day][hour];
                    if (!disciplineId) continue;

                    var discipline = window.getDiscipline(disciplineId);
                    if (!discipline) continue;

                    var classInstructorId = null;
                    if (typeof window.getClassInstructor === 'function') {
                        classInstructorId = window.getClassInstructor(student.id, week, parseInt(day), parseInt(hour));
                    }

                    var isTeaching = false;
                    if (classInstructorId) {
                        isTeaching = String(classInstructorId) === String(instructorId);
                    } else if (discipline.instructorIds && discipline.instructorIds.length > 0) {
                        isTeaching = String(discipline.instructorIds[0]) === String(instructorId);
                    }

                    if (!isTeaching) continue;

                    var key = day + '_' + hour;
                    if (!scheduleMap[key]) {
                        scheduleMap[key] = {
                            day: parseInt(day),
                            hour: parseInt(hour),
                            disciplineId: disciplineId,
                            discipline: discipline,
                            students: [],
                            label: null,
                            duration: 1,
                            groupLabel: null
                        };
                    }

                    if (typeof window.getClassDuration === 'function') {
                        var duration = window.getClassDuration(student.id, week, parseInt(day), parseInt(hour));
                        if (duration && duration > scheduleMap[key].duration) {
                            scheduleMap[key].duration = duration;
                        }
                    }

                    if (typeof window.getClassLabel === 'function') {
                        var label = window.getClassLabel(student.id, week, parseInt(day), parseInt(hour));
                        if (label && !scheduleMap[key].label) {
                            scheduleMap[key].label = label;
                        }
                    }

                    if (typeof window.getClassGroupLabel === 'function') {
                        var groupLabel = window.getClassGroupLabel(student.id, week, parseInt(day), parseInt(hour));
                        if (groupLabel && !scheduleMap[key].groupLabel) {
                            scheduleMap[key].groupLabel = groupLabel;
                        }
                    }

                    var alreadyAdded = scheduleMap[key].students.some(function(s) {
                        return String(s.studentId) === String(student.id);
                    });
                    if (!alreadyAdded) {
                        scheduleMap[key].students.push({
                            studentId: student.id,
                            studentName: window.getDisplayName(student),
                            groupLabel: scheduleMap[key].groupLabel
                        });
                    }
                }
            }
        });

        var classArray = Object.values(scheduleMap).sort(function(a, b) {
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        var filteredClassArray = classArray;
        if (activeFilter !== 'all') {
            var filterParts = activeFilter.split('_');
            var filterDisciplineId = filterParts[0];
            var filterGroupLabel = filterParts[1];
            filteredClassArray = classArray.filter(function(c) {
                return c.groupLabel === filterGroupLabel && String(c.disciplineId) === String(filterDisciplineId);
            });
        }

        var hours = [];
        for (var h = 5; h <= 23; h++) {
            hours.push(h);
        }

        var dayColumns = grid.querySelectorAll('.day-column');
        dayColumns.forEach(function(column, index) {
            var day = index + 1;
            var slots = column.querySelector('.day-slots');
            if (!slots) return;

            slots.innerHTML = '';
            var occupiedHours = {};

            hours.forEach(function(hour) {
                if (occupiedHours[hour]) return;

                var slot = document.createElement('div');
                slot.className = 'time-slot';
                slot.dataset.day = day;
                slot.dataset.hour = hour;

                var timeLabel = document.createElement('span');
                timeLabel.className = 'slot-time';
                var hourDisplay = hour > 12 ? hour - 12 : hour;
                var ampm = hour >= 12 ? 'PM' : 'AM';
                if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                if (hour === 12) { ampm = 'PM'; }
                timeLabel.textContent = hourDisplay + ':00 ' + ampm;
                slot.appendChild(timeLabel);

                var slotData = filteredClassArray.find(function(c) {
                    return c.day === day && c.hour === hour;
                });

                if (slotData) {
                    var duration = slotData.duration || 1;

                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        occupiedHours[h] = true;
                    }

                    slot.classList.add('occupied');
                    slot.style.minHeight = (30 * duration) + 'px';
                    slot.style.height = (30 * duration) + 'px';
                    if (duration > 1) {
                        slot.classList.add('duration-' + duration);
                    }

                    var studentCount = slotData.students.length;
                    var labelDisplay = slotData.label ? ' [' + slotData.label + ']' : '';
                    var groupDisplay = slotData.groupLabel ? ' (G' + slotData.groupLabel + ')' : '';
                    var durationDisplay = duration > 1 ? ' (' + duration + 'h)' : '';

                    var labelEl = document.createElement('span');
                    labelEl.className = 'slot-label';
                    labelEl.textContent = slotData.discipline.name + labelDisplay + groupDisplay + durationDisplay + ' - ' + studentCount + ' students';
                    slot.appendChild(labelEl);

                    slot.addEventListener('click', function() {
                        showClassManagementModal(slotData, day, hour);
                    });

                    slot.addEventListener('contextmenu', function(e) {
                        e.preventDefault();
                        if (confirm('Remove this class?')) {
                            removeInstructorClass(slotData, day, hour);
                        }
                    });

                } else {
                    slot.classList.add('empty');
                    var labelEl = document.createElement('span');
                    labelEl.className = 'slot-label';
                    labelEl.textContent = '+';
                    slot.appendChild(labelEl);

                    slot.addEventListener('click', function() {
                        showAddClassModal(day, hour);
                    });
                }

                slots.appendChild(slot);
            });
        });

        renderGroupList();
    }

    function renderGroupList() {
        var container = document.getElementById('instructor-groups-container');
        if (!container) return;

        if (!state.selectedInstructorId) {
            container.innerHTML = '';
            return;
        }

        var instructorId = state.selectedInstructorId;
        var week = state.currentWeek;
        var instructor = window.getCharacterById(instructorId);
        var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';

        var groups = getDisciplineGroupsForInstructor(instructorId, week);
        var groupKeys = Object.keys(groups).sort();

        var html = '<div style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">';
        html += '<h4 style="color:var(--accent);font-size:0.9rem;">Groups - ' + instructorName + '</h4>';
        html += '<span style="font-size:0.7rem;color:var(--text-dim);">Groups are managed in the Groups tab</span>';
        html += '</div>';

        if (groupKeys.length === 0) {
            html += '<div style="text-align:center;color:var(--text-dim);font-size:0.8rem;padding:8px;">No groups found for this instructor.</div>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';
            groupKeys.forEach(function(key) {
                var group = groups[key];
                var studentCount = group.students.length;
                var isExpanded = state.expandedGroups[key] || false;

                html += '<div class="group-card" style="background:var(--bg);border:1px solid var(--border-soft);border-radius:var(--radius);padding:8px 12px;flex:1;min-width:150px;max-width:300px;">';
                html += '<div class="group-header" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="window.toggleGroup(\'' + key + '\')">';
                html += '<span class="group-name" style="font-weight:600;color:var(--accent);">' + group.disciplineName + ' - G' + group.groupLabel + '</span>';
                html += '<span class="group-meta" style="font-size:0.7rem;color:var(--text-dim);">' + studentCount + ' students ' + (isExpanded ? '▾' : '▸') + '</span>';
                html += '</div>';

                if (isExpanded) {
                    html += '<div class="group-students" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-soft);">';
                    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
                    if (group.students.length > 0) {
                        group.students.forEach(function(id) {
                            var student = window.getCharacterById(id);
                            if (student) {
                                var name = window.getDisplayName(student);
                                html += '<span class="student-tag" style="background:var(--panel-alt);padding:2px 8px;border-radius:12px;font-size:0.7rem;">' + name + '</span>';
                            }
                        });
                    } else {
                        html += '<span style="font-size:0.7rem;color:var(--text-dim);">No students assigned</span>';
                    }
                    html += '</div>';
                    html += '</div>';
                }

                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
    }

    function toggleGroup(key) {
        if (state.expandedGroups[key]) {
            delete state.expandedGroups[key];
        } else {
            state.expandedGroups[key] = true;
        }
        renderGroupList();
    }

    function showClassManagementModal(slotData, day, hour) {
        var discipline = slotData.discipline;
        if (!discipline) return;

        var week = state.currentWeek;
        var instructorId = state.selectedInstructorId;
        var instructor = window.getCharacterById(instructorId);
        var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';

        var hourDisplay = hour > 12 ? hour - 12 : hour;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
        if (hour === 12) { ampm = 'PM'; }
        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        var allStudents = window.getStudents();
        var assignedStudentIds = slotData.students ? slotData.students.map(function(s) { return s.studentId; }) : [];
        var duration = slotData.duration || 1;
        var label = slotData.label || '';
        var groupLabel = slotData.groupLabel || '';

        var disciplineGroups = {};
        if (typeof window.getDisciplineGroups === 'function') {
            disciplineGroups = window.getDisciplineGroups(discipline.id);
        }
        var groupLabels = Object.keys(disciplineGroups).sort();

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:550px;">
                <div class="modal-header">
                    <h3>${discipline.name} ${label ? '[' + label + ']' : ''} ${groupLabel ? '(G' + groupLabel + ')' : ''} ${duration > 1 ? '(' + duration + 'h)' : ''}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-row"><span class="label">Instructor:</span> <span>${instructorName}</span></div>
                    <div class="detail-row"><span class="label">Day/Time:</span> <span>${dayNames[day]} at ${hourDisplay}:00 ${ampm} ${duration > 1 ? '(until ' + (hour + duration) + ':00)' : ''}</span></div>
                    <div class="detail-row"><span class="label">Duration:</span> <span><strong>${duration} hour${duration > 1 ? 's' : ''}</strong></span></div>
                    <div class="detail-row"><span class="label">Group Label:</span> <span><strong>${groupLabel || 'None'}</strong></span></div>
                    <div class="detail-row"><span class="label">Assigned Students:</span> <span>${assignedStudentIds.length > 0 ? assignedStudentIds.map(function(id) { var s = window.getCharacterById(id); return s ? window.getDisplayName(s) : 'Unknown'; }).join(', ') : 'None'}</span></div>

                    ${groupLabels.length > 0 ? `
                    <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border);">
                        <label style="font-size:0.75rem;color:var(--text-dim);">Add Students from Group:</label>
                        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
                            <select id="add-from-group-select" style="flex:1;min-width:120px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                <option value="">Select a group...</option>
                                ${groupLabels.map(function(g) {
                                    var groupStudents = Object.keys(disciplineGroups[g].students || {});
                                    var alreadyAssigned = groupStudents.filter(function(id) {
                                        return assignedStudentIds.some(function(aid) { return String(aid) === String(id); });
                                    });
                                    var count = groupStudents.length;
                                    var assignedCount = alreadyAssigned.length;
                                    var status = assignedCount > 0 ? ' (' + assignedCount + '/' + count + ' already assigned)' : ' (' + count + ' students)';
                                    return '<option value="' + g + '">Group ' + g + status + '</option>';
                                }).join('')}
                            </select>
                            <button id="add-from-group-btn" class="primary small">Add All</button>
                        </div>
                    </div>
                    ` : '<div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border);"><span style="font-size:0.75rem;color:var(--text-dim);">No groups created for this discipline. Create groups in the Groups tab.</span></div>'}

                    <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border);">
                        <label style="font-size:0.75rem;color:var(--text-dim);">Individual Students:</label>
                        <div style="max-height:150px;overflow-y:auto;margin-top:4px;">
                            ${allStudents.map(function(s) {
                                var name = window.getDisplayName(s);
                                var isAssigned = assignedStudentIds.some(function(id) { return String(id) === String(s.id); });

                                var schedule = window.getStudentSchedule(s.id, week);
                                var hasConflict = false;
                                var conflictGroup = null;
                                for (var h = hour; h < hour + duration && h <= 23; h++) {
                                    if (schedule[day] && schedule[day][h]) {
                                        hasConflict = true;
                                        if (typeof window.getClassGroupLabel === 'function') {
                                            conflictGroup = window.getClassGroupLabel(s.id, week, day, h);
                                        }
                                        break;
                                    }
                                }

                                var assignedToDifferentGroup = false;
                                if (isAssigned) {
                                    var studentGroup = null;
                                    if (typeof window.getClassGroupLabel === 'function') {
                                        studentGroup = window.getClassGroupLabel(s.id, week, day, hour);
                                    }
                                    if (studentGroup && studentGroup !== groupLabel) {
                                        assignedToDifferentGroup = true;
                                    }
                                }

                                var conflictText = '';
                                if (hasConflict && conflictGroup) {
                                    conflictText = ' <span style="color:var(--danger);font-size:0.7rem;">(conflict - G' + conflictGroup + ')</span>';
                                } else if (hasConflict) {
                                    conflictText = ' <span style="color:var(--danger);font-size:0.7rem;">(conflict)</span>';
                                } else if (assignedToDifferentGroup) {
                                    conflictText = ' <span style="color:var(--warning);font-size:0.7rem;">(different group)</span>';
                                }

                                return '<label style="display:block;padding:4px 0;font-size:0.8rem;cursor:pointer;border-bottom:1px solid var(--border-soft);' +
                                    (assignedToDifferentGroup ? ' background:var(--warning-soft);' : '') + '">' +
                                    '<input type="checkbox" class="assign-student-checkbox" value="' + s.id + '" ' +
                                    (isAssigned ? 'checked' : '') +
                                    (hasConflict && !isAssigned ? ' disabled' : '') + '> ' +
                                    name +
                                    (isAssigned ? ' <span style="color:var(--accent);font-size:0.7rem;">✓ assigned</span>' : '') +
                                    conflictText +
                                '</label>';
                            }).join('')}
                        </div>
                        <button id="assign-students-btn" class="small primary" style="margin-top:8px;">Update Assignments</button>
                    </div>

                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" id="remove-class-all" class="danger">✕ Remove Class</button>
                        <button type="button" id="close-detail" class="secondary">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#close-detail').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        var addFromGroupBtn = modal.querySelector('#add-from-group-btn');
        if (addFromGroupBtn) {
            addFromGroupBtn.addEventListener('click', function() {
                var groupSelect = document.getElementById('add-from-group-select');
                var selectedGroup = groupSelect.value;
                if (!selectedGroup) {
                    alert('Please select a group.');
                    return;
                }

                var groupStudents = Object.keys(disciplineGroups[selectedGroup].students || {});
                var toAdd = groupStudents.filter(function(id) {
                    return !assignedStudentIds.some(function(aid) { return String(aid) === String(id); });
                });

                if (toAdd.length === 0) {
                    alert('All students in this group are already assigned.');
                    return;
                }

                var conflicts = [];
                toAdd.forEach(function(studentId) {
                    var schedule = window.getStudentSchedule(studentId, week);
                    var hasConflict = false;
                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        if (schedule[day] && schedule[day][h]) {
                            hasConflict = true;
                            break;
                        }
                    }
                    if (hasConflict) {
                        var student = window.getCharacterById(studentId);
                        var studentName = student ? window.getDisplayName(student) : 'Unknown';
                        conflicts.push(studentName);
                    }
                });

                if (conflicts.length > 0) {
                    if (!confirm('⚠ The following students have conflicts at this time:\n\n' +
                        conflicts.join('\n') +
                        '\n\nAdd anyway? This will overwrite their existing classes.')) {
                        return;
                    }
                }

                toAdd.forEach(function(studentId) {
                    var schedule = window.getStudentSchedule(studentId, week);

                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        if (schedule[day] && schedule[day][h]) {
                            delete schedule[day][h];
                            if (typeof window.setClassInstructor === 'function') {
                                window.setClassInstructor(studentId, week, day, h, null);
                            }
                            if (typeof window.setClassLabel === 'function') {
                                window.setClassLabel(studentId, week, day, h, null);
                            }
                            if (typeof window.setClassGroupLabel === 'function') {
                                window.setClassGroupLabel(studentId, week, day, h, null);
                            }
                            if (typeof window.setClassDuration === 'function') {
                                window.setClassDuration(studentId, week, day, h, null);
                            }
                        }
                    }

                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        if (!schedule[day]) schedule[day] = {};
                        schedule[day][h] = discipline.id;
                        if (typeof window.setClassInstructor === 'function') {
                            window.setClassInstructor(studentId, week, day, h, instructorId);
                        }
                        if (label && typeof window.setClassLabel === 'function') {
                            window.setClassLabel(studentId, week, day, h, label);
                        }
                        if (selectedGroup && typeof window.setClassGroupLabel === 'function') {
                            window.setClassGroupLabel(studentId, week, day, h, selectedGroup);
                        }
                        if (h === hour && typeof window.setClassDuration === 'function') {
                            window.setClassDuration(studentId, week, day, h, duration);
                        }
                    }

                    if (!assignedStudentIds.some(function(id) { return String(id) === String(studentId); })) {
                        assignedStudentIds.push(studentId);
                    }
                });

                var data = window.data || {};
                if (data.curriculum && data.curriculum.instructorTemplates) {
                    var templateKey = instructorId + '_' + week;
                    var classKey = day + '_' + hour;
                    if (data.curriculum.instructorTemplates[templateKey] &&
                        data.curriculum.instructorTemplates[templateKey][classKey]) {
                        data.curriculum.instructorTemplates[templateKey][classKey].assignedStudents = assignedStudentIds;
                        data.curriculum.instructorTemplates[templateKey][classKey].groupLabel = selectedGroup;
                    }
                }

                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
                        modal.remove();
                        renderInstructorCalendarData();
                        populateGroupFilter();
                        if (typeof window.renderStudentSchedule === 'function') {
                            window.renderStudentSchedule();
                        }
                        alert('Added ' + toAdd.length + ' students from Group ' + selectedGroup + '!');
                    }).catch(function(err) {
                        alert('Failed to add students from group.');
                    });
                } else {
                    modal.remove();
                    renderInstructorCalendarData();
                }
            });
        }

        modal.querySelector('#assign-students-btn').onclick = function() {
            var selectedStudents = [];
            modal.querySelectorAll('.assign-student-checkbox:checked').forEach(function(cb) {
                selectedStudents.push(cb.value);
            });

            var currentAssigned = assignedStudentIds || [];
            var toAdd = selectedStudents.filter(function(id) { return !currentAssigned.some(function(cid) { return String(cid) === String(id); }); });
            var toRemove = currentAssigned.filter(function(id) { return !selectedStudents.some(function(sid) { return String(sid) === String(id); }); });

            var groupWarnings = [];
            toAdd.forEach(function(studentId) {
                if (typeof window.getClassGroupLabel === 'function') {
                    var studentGroup = window.getClassGroupLabel(studentId, week, day, hour);
                    if (studentGroup && studentGroup !== groupLabel) {
                        var student = window.getCharacterById(studentId);
                        var studentName = student ? window.getDisplayName(student) : 'Unknown';
                        groupWarnings.push(studentName + ' is currently in Group ' + studentGroup);
                    }
                }
            });

            if (groupWarnings.length > 0) {
                if (!confirm('⚠ The following students are currently assigned to a different group:\n\n' +
                    groupWarnings.join('\n') +
                    '\n\nAssigning them here will move them to Group ' + (groupLabel || 'None') +
                    '. This will remove them from their previous group.\n\nContinue?')) {
                    return;
                }
            }

            toRemove.forEach(function(studentId) {
                var schedule = window.getStudentSchedule(studentId, week);
                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (schedule[day] && schedule[day][h]) {
                        delete schedule[day][h];
                        if (typeof window.setClassInstructor === 'function') {
                            window.setClassInstructor(studentId, week, day, h, null);
                        }
                        if (typeof window.setClassLabel === 'function') {
                            window.setClassLabel(studentId, week, day, h, null);
                        }
                        if (typeof window.setClassGroupLabel === 'function') {
                            window.setClassGroupLabel(studentId, week, day, h, null);
                        }
                        if (typeof window.setClassDuration === 'function') {
                            window.setClassDuration(studentId, week, day, h, null);
                        }
                    }
                }
            });

            toAdd.forEach(function(studentId) {
                var schedule = window.getStudentSchedule(studentId, week);
                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (!schedule[day]) schedule[day] = {};
                    schedule[day][h] = discipline.id;
                    if (typeof window.setClassInstructor === 'function') {
                        window.setClassInstructor(studentId, week, day, h, instructorId);
                    }
                    if (label && typeof window.setClassLabel === 'function') {
                        window.setClassLabel(studentId, week, day, h, label);
                    }
                    if (groupLabel && typeof window.setClassGroupLabel === 'function') {
                        window.setClassGroupLabel(studentId, week, day, h, groupLabel);
                    }
                    if (h === hour && typeof window.setClassDuration === 'function') {
                        window.setClassDuration(studentId, week, day, h, duration);
                    }
                }
            });

            var data = window.data || {};
            if (data.curriculum && data.curriculum.instructorTemplates) {
                var templateKey = instructorId + '_' + week;
                var classKey = day + '_' + hour;
                if (data.curriculum.instructorTemplates[templateKey] &&
                    data.curriculum.instructorTemplates[templateKey][classKey]) {
                    data.curriculum.instructorTemplates[templateKey][classKey].assignedStudents = selectedStudents;
                }
            }

            if (typeof window.saveData === 'function') {
                window.saveData().then(function() {
                    modal.remove();
                    renderInstructorCalendarData();
                    populateGroupFilter();
                    if (typeof window.renderStudentSchedule === 'function') {
                        window.renderStudentSchedule();
                    }
                    alert('Student assignments updated!');
                }).catch(function(err) {
                    alert('Failed to update assignments.');
                });
            } else {
                modal.remove();
                renderInstructorCalendarData();
            }
        };

        modal.querySelector('#remove-class-all').onclick = function() {
            removeInstructorClass(slotData, day, hour);
            modal.remove();
        };
    }

    function removeInstructorClass(slotData, day, hour) {
        if (!state.selectedInstructorId) return;

        var week = state.currentWeek;
        var instructorId = state.selectedInstructorId;
        var duration = slotData.duration || 1;
        var studentIds = slotData.students ? slotData.students.map(function(s) { return s.studentId; }) : [];
        var disciplineId = slotData.disciplineId;

        studentIds.forEach(function(studentId) {
            var schedule = window.getStudentSchedule(studentId, week);
            for (var h = hour; h < hour + duration && h <= 23; h++) {
                if (schedule[day] && schedule[day][h]) {
                    delete schedule[day][h];
                    if (typeof window.setClassInstructor === 'function') {
                        window.setClassInstructor(studentId, week, day, h, null);
                    }
                    if (typeof window.setClassLabel === 'function') {
                        window.setClassLabel(studentId, week, day, h, null);
                    }
                    if (typeof window.setClassGroupLabel === 'function') {
                        window.setClassGroupLabel(studentId, week, day, h, null);
                    }
                    if (typeof window.setClassDuration === 'function') {
                        window.setClassDuration(studentId, week, day, h, null);
                    }
                }
            }
        });

        var data = window.data || {};
        if (data.curriculum && data.curriculum.instructorTemplates) {
            var templateKey = instructorId + '_' + week;
            var classKey = day + '_' + hour;
            if (data.curriculum.instructorTemplates[templateKey]) {
                delete data.curriculum.instructorTemplates[templateKey][classKey];
                if (Object.keys(data.curriculum.instructorTemplates[templateKey]).length === 0) {
                    delete data.curriculum.instructorTemplates[templateKey];
                }
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                renderInstructorCalendarData();
                populateGroupFilter();
                if (typeof window.renderStudentSchedule === 'function') {
                    window.renderStudentSchedule();
                }
                alert('Class removed!');
            }).catch(function(err) {
                renderInstructorCalendarData();
            });
        } else {
            renderInstructorCalendarData();
        }
    }

    function showAddClassModal(day, hour) {
        if (!state.selectedInstructorId) {
            alert('Please select an instructor first.');
            return;
        }

        var week = state.currentWeek;
        var instructorId = state.selectedInstructorId;
        var instructor = window.getCharacterById(instructorId);
        var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';

        var disciplines = window.getAvailableDisciplines(week);
        var availableDisciplines = disciplines.filter(function(d) {
            return d.instructorIds && d.instructorIds.some(function(id) { return String(id) === String(instructorId); });
        });

        if (availableDisciplines.length === 0) {
            alert('No disciplines available for this instructor in week ' + week + '.');
            return;
        }

        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var hourDisplay = hour > 12 ? hour - 12 : hour;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
        if (hour === 12) { ampm = 'PM'; }

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:450px;">
                <div class="modal-header">
                    <h3>Add Class - ${dayNames[day]} at ${hourDisplay}:00 ${ampm}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Instructor:</label>
                        <span style="padding:6px 0;display:block;">${instructorName}</span>
                    </div>
                    <div class="form-group">
                        <label>Discipline *:</label>
                        <select id="add-class-discipline" style="width:100%;padding:8px;">
                            ${availableDisciplines.map(function(d) {
                                return '<option value="' + d.id + '">' + d.name + '</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Class Label (optional):</label>
                        <input type="text" id="add-class-label" placeholder="e.g., A, B, Group 1..." style="width:100%;padding:8px;">
                    </div>
                    <div class="form-group">
                        <label>Group Label (optional):</label>
                        <input type="text" id="add-class-group" placeholder="e.g., 1, 2, 3..." style="width:100%;padding:8px;">
                    </div>
                    <div class="form-group">
                        <label>Duration (hours):</label>
                        <select id="add-class-duration" style="width:100%;padding:8px;">
                            <option value="1">1 hour</option>
                            <option value="2">2 hours</option>
                            <option value="3">3 hours</option>
                            <option value="4">4 hours</option>
                        </select>
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-add-class" class="secondary">Cancel</button>
                        <button type="button" id="confirm-add-class" class="primary">Add Class</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#cancel-add-class').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#confirm-add-class').onclick = function() {
            var disciplineId = document.getElementById('add-class-discipline').value;
            var duration = parseInt(document.getElementById('add-class-duration').value) || 1;
            var label = document.getElementById('add-class-label').value.trim();
            var groupLabel = document.getElementById('add-class-group').value.trim();

            if (!disciplineId) {
                alert('Please select a discipline.');
                return;
            }

            var data = window.data || {};
            if (!data.curriculum) {
                data.curriculum = {};
            }
            if (!data.curriculum.instructorTemplates) {
                data.curriculum.instructorTemplates = {};
            }
            var templateKey = instructorId + '_' + week;
            if (!data.curriculum.instructorTemplates[templateKey]) {
                data.curriculum.instructorTemplates[templateKey] = {};
            }
            var classKey = day + '_' + hour;
            data.curriculum.instructorTemplates[templateKey][classKey] = {
                disciplineId: disciplineId,
                label: label,
                groupLabel: groupLabel,
                duration: duration,
                assignedStudents: []
            };

            modal.remove();

            if (typeof window.saveData === 'function') {
                window.saveData().then(function() {
                    renderInstructorCalendarData();
                    populateGroupFilter();
                    alert('Class template added! Click on the slot to assign students.');
                }).catch(function(err) {
                    renderInstructorCalendarData();
                });
            } else {
                renderInstructorCalendarData();
            }
        };
    }

    function showAddBlockModal() {
        if (!state.selectedInstructorId) {
            alert('Please select an instructor first.');
            return;
        }

        var week = state.currentWeek;
        var instructorId = state.selectedInstructorId;
        var instructor = window.getCharacterById(instructorId);
        var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';

        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        var disciplines = window.getAvailableDisciplines(week);
        var availableDisciplines = disciplines.filter(function(d) {
            return d.instructorIds && d.instructorIds.some(function(id) { return String(id) === String(instructorId); });
        });

        var existingGroups = new Set();
        if (typeof window.getDisciplineGroups === 'function') {
            availableDisciplines.forEach(function(discipline) {
                var groups = window.getDisciplineGroups(discipline.id);
                for (var label in groups) {
                    existingGroups.add(label);
                }
            });
        }

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px;">
                <div class="modal-header">
                    <h3>Block Time - ${instructorName}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Week:</label>
                        <span style="padding:6px 0;display:block;">${week}</span>
                    </div>
                    <div class="form-group">
                        <label>Day *:</label>
                        <select id="block-day" style="width:100%;padding:8px;">
                            ${[1,2,3,4,5,6,7].map(function(d) {
                                return '<option value="' + d + '">' + dayNames[d] + '</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Starting Hour *:</label>
                        <select id="block-hour" style="width:100%;padding:8px;">
                            ${[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23].map(function(h) {
                                var hourDisplay = h > 12 ? h - 12 : h;
                                var ampm = h >= 12 ? 'PM' : 'AM';
                                if (h === 0) { hourDisplay = 12; ampm = 'AM'; }
                                if (h === 12) { ampm = 'PM'; }
                                return '<option value="' + h + '">' + hourDisplay + ':00 ' + ampm + '</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Duration (hours):</label>
                        <select id="block-duration" style="width:100%;padding:8px;">
                            <option value="1">1 hour</option>
                            <option value="2">2 hours</option>
                            <option value="3">3 hours</option>
                            <option value="4">4 hours</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Label (optional):</label>
                        <input type="text" id="block-label" placeholder="e.g., Research, Office Hours..." style="width:100%;padding:8px;" value="Research">
                    </div>
                    <div class="form-group">
                        <label>Group Label (optional):</label>
                        <select id="block-group" style="width:100%;padding:8px;">
                            <option value="">No group (just block time)</option>
                            ${Array.from(existingGroups).sort().map(function(g) {
                                return '<option value="' + g + '">Group ' + g + '</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-group" id="block-discipline-group" style="display:none;">
                        <label>Discipline:</label>
                        <select id="block-discipline" style="width:100%;padding:8px;">
                            ${availableDisciplines.map(function(d) {
                                return '<option value="' + d.id + '">' + d.name + '</option>';
                            }).join('')}
                        </select>
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-block" class="secondary">Cancel</button>
                        <button type="button" id="confirm-block" class="primary">Block Time</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        var groupSelect = document.getElementById('block-group');
        var disciplineGroup = document.getElementById('block-discipline-group');

        groupSelect.addEventListener('change', function() {
            if (this.value) {
                disciplineGroup.style.display = 'block';
            } else {
                disciplineGroup.style.display = 'none';
            }
        });

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#cancel-block').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#confirm-block').onclick = function() {
            var day = parseInt(document.getElementById('block-day').value);
            var hour = parseInt(document.getElementById('block-hour').value);
            var duration = parseInt(document.getElementById('block-duration').value) || 1;
            var label = document.getElementById('block-label').value.trim() || 'Blocked Time';
            var groupLabel = document.getElementById('block-group').value;
            var disciplineId = document.getElementById('block-discipline').value;

            var data = window.data || {};
            if (!data.curriculum) {
                data.curriculum = {};
            }
            if (!data.curriculum.instructorBlocks) {
                data.curriculum.instructorBlocks = {};
            }
            var blockKey = instructorId + '_' + week;
            if (!data.curriculum.instructorBlocks[blockKey]) {
                data.curriculum.instructorBlocks[blockKey] = {};
            }
            if (!data.curriculum.instructorBlocks[blockKey][day]) {
                data.curriculum.instructorBlocks[blockKey][day] = {};
            }

            var hasConflict = false;
            for (var h = hour; h < hour + duration && h <= 23; h++) {
                if (data.curriculum.instructorBlocks[blockKey][day][h]) {
                    hasConflict = true;
                    break;
                }
            }

            if (hasConflict) {
                if (!confirm('This time slot already has a block. Overwrite?')) {
                    return;
                }
            }

            for (var h = hour; h < hour + duration && h <= 23; h++) {
                delete data.curriculum.instructorBlocks[blockKey][day][h];
            }

            data.curriculum.instructorBlocks[blockKey][day][hour] = {
                label: label,
                groupLabel: groupLabel || null,
                duration: duration
            };

            var autoAssignedCount = 0;
            if (groupLabel && disciplineId) {
                var discipline = window.getDiscipline(disciplineId);
                var students = window.getStudents();

                var groupStudents = [];
                if (typeof window.getDisciplineGroups === 'function') {
                    var groups = window.getDisciplineGroups(disciplineId);
                    if (groups[groupLabel] && groups[groupLabel].students) {
                        groupStudents = Object.keys(groups[groupLabel].students);
                    }
                }

                groupStudents.forEach(function(studentId) {
                    var schedule = window.getStudentSchedule(studentId, week);
                    var hasConflict = false;
                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        if (schedule[day] && schedule[day][h]) {
                            hasConflict = true;
                            break;
                        }
                    }

                    if (!hasConflict) {
                        for (var h = hour; h < hour + duration && h <= 23; h++) {
                            if (!schedule[day]) schedule[day] = {};
                            schedule[day][h] = disciplineId;
                            if (typeof window.setClassInstructor === 'function') {
                                window.setClassInstructor(studentId, week, day, h, instructorId);
                            }
                            if (label && typeof window.setClassLabel === 'function') {
                                window.setClassLabel(studentId, week, day, h, label);
                            }
                            if (groupLabel && typeof window.setClassGroupLabel === 'function') {
                                window.setClassGroupLabel(studentId, week, day, h, groupLabel);
                            }
                            if (h === hour && typeof window.setClassDuration === 'function') {
                                window.setClassDuration(studentId, week, day, h, duration);
                            }
                        }
                        autoAssignedCount++;
                    }
                });
            }

            modal.remove();

            if (typeof window.saveData === 'function') {
                window.saveData().then(function() {
                    renderInstructorCalendarData();
                    populateGroupFilter();
                    if (typeof window.renderStudentSchedule === 'function') {
                        window.renderStudentSchedule();
                    }
                    var msg = 'Time blocked successfully!';
                    if (autoAssignedCount > 0) {
                        msg += '\n\n✓ ' + autoAssignedCount + ' student(s) from Group ' + groupLabel + ' were automatically assigned to this block.';
                    } else if (groupLabel) {
                        msg += '\n\n⚠ No students found in Group ' + groupLabel + ' for this discipline.';
                    }
                    alert(msg);
                }).catch(function(err) {
                    renderInstructorCalendarData();
                });
            } else {
                renderInstructorCalendarData();
            }
        };
    }

    function showBlockManagementModal(day, hour) {
        if (!state.selectedInstructorId) return;

        var week = state.currentWeek;
        var instructorId = state.selectedInstructorId;
        var blockKey = instructorId + '_' + week;

        var data = window.data || {};
        if (!data.curriculum || !data.curriculum.instructorBlocks || !data.curriculum.instructorBlocks[blockKey]) return;
        if (!data.curriculum.instructorBlocks[blockKey][day] || !data.curriculum.instructorBlocks[blockKey][day][hour]) return;

        var blockData = data.curriculum.instructorBlocks[blockKey][day][hour];
        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var hourDisplay = hour > 12 ? hour - 12 : hour;
        var ampm = hour >= 12 ? 'PM' : 'AM';
        if (hour === 0) { hourDisplay = 12; ampm = 'AM'; }
        if (hour === 12) { ampm = 'PM'; }

        var groupDisplay = blockData.groupLabel ? ' (Group ' + blockData.groupLabel + ')' : '';

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:400px;">
                <div class="modal-header">
                    <h3>${blockData.label || 'Blocked Time'} ${groupDisplay}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-row"><span class="label">Day/Time:</span> <span>${dayNames[day]} at ${hourDisplay}:00 ${ampm}</span></div>
                    <div class="detail-row"><span class="label">Duration:</span> <span>${blockData.duration || 1} hour(s)</span></div>
                    <div class="detail-row"><span class="label">Label:</span> <span>${blockData.label || 'Blocked Time'}</span></div>
                    <div class="detail-row"><span class="label">Group:</span> <span>${blockData.groupLabel || 'None'}</span></div>
                    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" id="remove-block" class="danger small">✕ Remove Block</button>
                        <button type="button" id="close-block" class="secondary small">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#close-block').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#remove-block').onclick = function() {
            if (confirm('Remove this blocked time?')) {
                removeBlockedTime(day, hour);
                modal.remove();
            }
        };
    }

    function removeBlockedTime(day, hour) {
        if (!state.selectedInstructorId) return;

        var week = state.currentWeek;
        var instructorId = state.selectedInstructorId;
        var blockKey = instructorId + '_' + week;

        var data = window.data || {};
        if (data.curriculum && data.curriculum.instructorBlocks && data.curriculum.instructorBlocks[blockKey]) {
            if (data.curriculum.instructorBlocks[blockKey][day]) {
                delete data.curriculum.instructorBlocks[blockKey][day][hour];
                if (Object.keys(data.curriculum.instructorBlocks[blockKey][day]).length === 0) {
                    delete data.curriculum.instructorBlocks[blockKey][day];
                }
                if (Object.keys(data.curriculum.instructorBlocks[blockKey]).length === 0) {
                    delete data.curriculum.instructorBlocks[blockKey];
                }
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                renderInstructorCalendarData();
                populateGroupFilter();
            }).catch(function(err) {
                renderInstructorCalendarData();
            });
        } else {
            renderInstructorCalendarData();
        }
    }

    function initInstructorCalendarEvents() {
        var select = document.getElementById('instructor-calendar-select');
        if (select) {
            select.addEventListener('change', function() {
                state.selectedInstructorId = this.value;
                renderInstructorCalendarData();
                renderGroupList();
            });
        }

        var prevBtn = document.getElementById('prev-instructor-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderInstructorCalendarData();
                    renderGroupList();
                }
            });
        }

        var nextBtn = document.getElementById('next-instructor-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderInstructorCalendarData();
                    renderGroupList();
                }
            });
        }

        var gotoBtn = document.getElementById('goto-instructor-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', state.currentWeek);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        state.currentWeek = w;
                        renderInstructorCalendarData();
                        renderGroupList();
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }

        var addClassBtn = document.getElementById('add-instructor-class-btn');
        if (addClassBtn) {
            addClassBtn.addEventListener('click', function() {
                if (!state.selectedInstructorId) {
                    alert('Please select an instructor first.');
                    return;
                }
                showAddClassModal(1, 8);
            });
        }

        var addBlockBtn = document.getElementById('add-instructor-block-btn');
        if (addBlockBtn) {
            addBlockBtn.addEventListener('click', function() {
                if (!state.selectedInstructorId) {
                    alert('Please select an instructor first.');
                    return;
                }
                showAddBlockModal();
            });
        }

        var filterSelect = document.getElementById('instructor-group-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', function() {
                state.activeGroupFilter = this.value;
                renderInstructorCalendarData();
            });
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('instructor-calendar', renderInstructorCalendar);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('instructor-calendar-content');
        if (container && container.style.display !== 'none') {
            renderInstructorCalendar(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'instructor-calendar') {
            var container = document.getElementById('instructor-calendar-content');
            if (container) {
                renderInstructorCalendar(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('instructor-calendar-content');
            if (container && container.style.display !== 'none') {
                renderInstructorCalendar(container);
            }
        }, 100);
    }

    window.renderInstructorCalendar = renderInstructorCalendar;
    window.renderInstructorCalendarData = renderInstructorCalendarData;
    window.renderGroupList = renderGroupList;
    window.toggleGroup = toggleGroup;
    window.populateInstructorSelector = populateInstructorSelector;
    window.populateGroupFilter = populateGroupFilter;
    window.getDisciplineGroupsForInstructor = getDisciplineGroupsForInstructor;
    window.initInstructorCalendarEvents = initInstructorCalendarEvents;
    window.instructorCalendarState = state;

})();
