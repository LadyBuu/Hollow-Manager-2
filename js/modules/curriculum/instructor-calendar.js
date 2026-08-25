/**
 * js/modules/curriculum/instructor-calendar.js - Instructor Calendar Module
 * Path: js/modules/curriculum/instructor-calendar.js
 */

(function() {
    'use strict';

    // Prevent duplicate loading
    if (window.__instructorCalendarLoaded) {
        console.warn('instructor-calendar.js already loaded, skipping duplicate initialization');
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
        
        // Populate once, not twice
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

        // Don't repopulate here - it was already done
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

                    // FIXED: Only show if instructor is explicitly assigned or is the primary instructor
                    var classInstructorId = null;
                    if (typeof window.getClassInstructor === 'function') {
                        classInstructorId = window.getClassInstructor(student.id, week, parseInt(day), parseInt(hour));
                    }

                    var isTeaching = false;
                    if (classInstructorId) {
                        // Explicit instructor assignment takes priority
                        isTeaching = String(classInstructorId) === String(instructorId);
                    } else if (discipline.instructorIds && discipline.instructorIds.length > 0) {
                        // Only use fallback if the instructor is the FIRST (primary) instructor
                        // This prevents a class from appearing for every instructor in the list
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

                    // Get duration from the starting hour only
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

                    // Only add student once per class block
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

                    // Mark all hours in the duration as occupied
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

    // Keep existing modal functions (showClassManagementModal, showAddClassModal, etc.)
    // but remove the duplicate populate calls inside them

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

    // Placeholder for modal functions - keep existing implementations
    function showClassManagementModal(slotData, day, hour) {
        // ... existing implementation ...
    }

    function showAddClassModal(day, hour) {
        // ... existing implementation ...
    }

    function showAddBlockModal() {
        // ... existing implementation ...
    }

    function removeInstructorClass(slotData, day, hour) {
        // ... existing implementation ...
    }

    function showBlockManagementModal(day, hour) {
        // ... existing implementation ...
    }

    function removeBlockedTime(day, hour) {
        // ... existing implementation ...
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
