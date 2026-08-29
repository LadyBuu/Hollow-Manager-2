/**
 * calendar/calendar-views.js - Calendar View Renderers
 * Pure rendering functions for Student, Instructor, and Location calendar views
 * Path: js/calendar/calendar-views.js
 * 
 * This module handles:
 *   - Student schedule view (with rest days, discipline availability)
 *   - Instructor calendar view (with templates, blocks, assigned students)
 *   - Location schedule view (with assigned classes)
 *   - Sidebar rendering for each view type
 *   - Pure render functions (no event binding, no data mutation)
 * 
 * IMPORTANT:
 *   - All functions are PURE: data in, HTML/dom out
 *   - No event listeners are attached here
 *   - No data mutation occurs here
 *   - All user-controlled content is escaped
 *   - Views are built using CalendarGrid
 * 
 * DEPENDENCIES:
 *   - CalendarGrid (shared grid renderer)
 *   - ScheduleCore (schedule queries)
 *   - CalendarCore (calendar operations)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarViewsLoaded) {
        return;
    }
    window.__calendarViewsLoaded = true;

    // ============================================================
    // HTML ESCAPE
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
    // CONSTANTS
    // ============================================================

    var DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    function getDayName(day) {
        return DAY_NAMES[day] || 'Unknown';
    }

    function getDayShort(day) {
        return DAY_SHORT[day] || 'Unknown';
    }

    function formatHourShort(hour) {
        var h = hour;
        var ampm = h >= 12 ? 'PM' : 'AM';
        if (h === 0) { h = 12; ampm = 'AM'; }
        if (h === 12) { ampm = 'PM'; }
        if (h > 12) { h = h - 12; }
        return h + ampm;
    }

    // ============================================================
    // STUDENT VIEW
    // ============================================================

    function renderStudentView(container, studentId, week, options) {
        options = options || {};

        if (!container) return null;

        // Get data
        var weekNum = parseInt(week) || 1;
        var schedule = getStudentSchedule(studentId, weekNum);
        var restDays = getStudentRestDays(studentId, weekNum);
        var available = getAvailableDisciplinesForStudent(studentId, weekNum);

        // Build grid data
        var gridData = buildStudentGridData(schedule, restDays, available, options);

        // Render grid
        var gridOptions = {
            mode: 'student',
            days: [1, 2, 3, 4, 5, 6, 7],
            hours: getHours(5, 23),
            formatHour: formatHourShort,
            formatDay: getDayName,
            showLegend: options.showLegend !== false,
            emptyLabel: '+',
            getSlotClass: function(slot) {
                if (slot && slot.isRestDay) {
                    return 'rest-day';
                }
                return '';
            },
            transformSlot: function(slot, day, hour) {
                // Mark rest days
                if (restDays && restDays.indexOf(day) !== -1) {
                    slot.isRestDay = true;
                    slot.occupied = false;
                    slot.blocked = false;
                }
                return slot;
            }
        };

        var grid = window.CalendarGrid.render(null, gridData, gridOptions);

        // Build sidebar
        var sidebar = renderStudentSidebar(studentId, weekNum, schedule, restDays, available);

        // Combine
        var wrapper = document.createElement('div');
        wrapper.className = 'calendar-view student-view';

        var gridWrapper = document.createElement('div');
        gridWrapper.className = 'calendar-grid-wrapper';
        gridWrapper.appendChild(grid);

        wrapper.appendChild(gridWrapper);

        var sidebarWrapper = document.createElement('div');
        sidebarWrapper.className = 'calendar-sidebar';
        sidebarWrapper.innerHTML = sidebar;

        wrapper.appendChild(sidebarWrapper);

        container.appendChild(wrapper);

        return wrapper;
    }

    function buildStudentGridData(schedule, restDays, available, options) {
        var grid = {};

        for (var day = 1; day <= 7; day++) {
            grid[day] = {};

            for (var hour = 5; hour <= 23; hour++) {
                var isRestDay = restDays && restDays.indexOf(day) !== -1;

                if (isRestDay) {
                    grid[day][hour] = {
                        occupied: false,
                        blocked: false,
                        isRestDay: true,
                        label: 'Rest Day',
                        duration: 1,
                        students: []
                    };
                    continue;
                }

                var disciplineId = schedule && schedule[day] ? schedule[day][hour] : null;

                if (disciplineId) {
                    var discipline = getDiscipline(disciplineId);
                    var duration = getClassDuration(studentId, week, day, hour) || 1;
                    var instructorId = getClassInstructor(studentId, week, day, hour);
                    var instructorName = '';
                    if (instructorId) {
                        var instructor = getCharacterById(instructorId);
                        if (instructor) {
                            instructorName = getDisplayName(instructor);
                        }
                    }
                    var label = getClassLabel(studentId, week, day, hour);
                    var groupLabel = getClassGroupLabel(studentId, week, day, hour);

                    grid[day][hour] = {
                        occupied: true,
                        blocked: false,
                        disciplineId: disciplineId,
                        disciplineName: discipline ? discipline.name : 'Unknown',
                        duration: duration,
                        students: [],
                        label: label,
                        groupLabel: groupLabel,
                        instructorId: instructorId,
                        instructorName: instructorName,
                        isTemplate: false,
                        isFull: false,
                        data: {
                            disciplineId: disciplineId,
                            instructorId: instructorId,
                            label: label,
                            groupLabel: groupLabel
                        }
                    };
                } else {
                    grid[day][hour] = {
                        occupied: false,
                        blocked: false,
                        duration: 1,
                        students: [],
                        label: null,
                        groupLabel: null
                    };
                }
            }
        }

        return grid;
    }

    function renderStudentSidebar(studentId, week, schedule, restDays, available) {
        var html = '';

        // Week Overview
        html += '<div class="sidebar-section">';
        html += '<h4>Week Overview</h4>';

        var classCount = countClasses(schedule);
        if (classCount === 0) {
            html += '<p class="empty-state">No classes scheduled</p>';
        } else {
            html += '<div class="activity-list">';
            var classes = getClassList(studentId, week, schedule);
            classes.forEach(function(cls) {
                html += '<div class="activity-item">';
                html += '<span class="activity-time">' + escapeHtml(cls.dayName) + ' ' + escapeHtml(cls.time) + '</span>';
                html += '<span class="activity-name"><strong>' + escapeHtml(cls.name) + '</strong></span>';
                if (cls.instructor) {
                    html += '<span class="activity-instructor">(' + escapeHtml(cls.instructor) + ')</span>';
                }
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>';

        // Available Disciplines
        html += '<div class="sidebar-section">';
        html += '<h4>Available Disciplines</h4>';

        if (!available || available.length === 0) {
            html += '<p class="empty-state">All disciplines are full</p>';
        } else {
            html += '<div class="available-list">';
            available.forEach(function(item) {
                var disc = item.discipline;
                var instructorDisplay = item.instructorNames.length > 0
                    ? item.instructorNames.join(', ')
                    : 'No instructors assigned';
                html += '<div class="available-item" data-discipline="' + escapeHtml(disc.id) + '">';
                html += '<span class="available-name">' + escapeHtml(disc.name) + '</span>';
                html += '<span class="available-hours">' + item.used + '/' + item.maxHours + 'h</span>';
                html += '<span class="available-instructor" style="font-size:0.6rem;color:var(--text-dim);">' + escapeHtml(instructorDisplay) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>';

        // Rest Days
        html += '<div class="sidebar-section">';
        html += '<h4>Rest Days</h4>';
        html += '<div class="rest-day-controls">';

        for (var d = 1; d <= 7; d++) {
            var isChecked = restDays && restDays.indexOf(d) !== -1;
            var dayName = getDayShort(d);
            html += '<label>';
            html += '<input type="checkbox" class="rest-day-check" data-day="' + d + '" ' + (isChecked ? 'checked' : '') + '>';
            html += escapeHtml(dayName);
            html += '</label>';
        }

        html += '</div>';
        html += '<button id="save-rest-days-btn" class="small primary">Save Rest Days</button>';
        html += '</div>';

        // Hours Summary
        html += '<div class="sidebar-section">';
        html += '<h4>Hours Summary</h4>';

        var usedHours = countClasses(schedule);
        var totalHours = getTotalWeeklyHours();
        html += '<p>Used: <strong id="schedule-hours-used">' + usedHours + '</strong> / <span id="schedule-hours-total">' + totalHours + '</span></p>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // INSTRUCTOR VIEW
    // ============================================================

    function renderInstructorView(container, instructorId, week, options) {
        options = options || {};

        if (!container) return null;

        var weekNum = parseInt(week) || 1;

        // Get data
        var templates = getInstructorTemplates(instructorId, weekNum);
        var blocks = getInstructorBlocks(instructorId, weekNum);
        var studentAssignments = getInstructorStudentAssignments(instructorId, weekNum);

        // Build grid data
        var gridData = buildInstructorGridData(templates, blocks, studentAssignments, options);

        // Render grid
        var gridOptions = {
            mode: 'instructor',
            days: [1, 2, 3, 4, 5, 6, 7],
            hours: getHours(5, 23),
            formatHour: formatHourShort,
            formatDay: getDayName,
            showLegend: options.showLegend !== false,
            emptyLabel: '+',
            getSlotClass: function(slot) {
                if (slot && slot.blocked) {
                    return 'blocked';
                }
                if (slot && slot.isTemplate) {
                    return 'template';
                }
                return '';
            },
            transformSlot: function(slot, day, hour) {
                return slot;
            }
        };

        var grid = window.CalendarGrid.render(null, gridData, gridOptions);

        // Build sidebar
        var sidebar = renderInstructorSidebar(instructorId, weekNum, templates, blocks, studentAssignments);

        // Combine
        var wrapper = document.createElement('div');
        wrapper.className = 'calendar-view instructor-view';

        var gridWrapper = document.createElement('div');
        gridWrapper.className = 'calendar-grid-wrapper';
        gridWrapper.appendChild(grid);

        wrapper.appendChild(gridWrapper);

        var sidebarWrapper = document.createElement('div');
        sidebarWrapper.className = 'calendar-sidebar';
        sidebarWrapper.innerHTML = sidebar;

        wrapper.appendChild(sidebarWrapper);

        container.appendChild(wrapper);

        return wrapper;
    }

    function buildInstructorGridData(templates, blocks, studentAssignments, options) {
        var grid = {};

        // Merge templates and blocks
        var allSlots = {};

        // Add templates
        for (var key in templates) {
            if (!Object.prototype.hasOwnProperty.call(templates, key)) continue;
            var parts = key.split('_');
            var day = parseInt(parts[0]);
            var hour = parseInt(parts[1]);
            var template = templates[key];

            var slotKey = day + '_' + hour;
            if (!allSlots[slotKey]) {
                allSlots[slotKey] = {
                    day: day,
                    hour: hour,
                    occupied: true,
                    blocked: false,
                    isTemplate: true,
                    disciplineId: template.disciplineId,
                    disciplineName: getDisciplineName(template.disciplineId),
                    duration: template.duration || 1,
                    students: template.assignedStudents || [],
                    label: template.label || null,
                    groupLabel: template.groupLabel || null,
                    instructorId: null,
                    instructorName: null
                };
            } else {
                // Merge
                var existing = allSlots[slotKey];
                existing.isTemplate = true;
                if (!existing.disciplineId) existing.disciplineId = template.disciplineId;
                if (!existing.disciplineName) existing.disciplineName = getDisciplineName(template.disciplineId);
                if (template.assignedStudents) {
                    existing.students = existing.students.concat(template.assignedStudents);
                }
                if (template.label) existing.label = template.label;
                if (template.groupLabel) existing.groupLabel = template.groupLabel;
            }
        }

        // Add blocks
        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) continue;
            var dayNum = parseInt(day);
            var dayBlocks = blocks[day];

            for (var hour in dayBlocks) {
                if (!Object.prototype.hasOwnProperty.call(dayBlocks, hour)) continue;
                var hourNum = parseInt(hour);
                var block = dayBlocks[hour];

                var slotKey = dayNum + '_' + hourNum;
                if (!allSlots[slotKey]) {
                    allSlots[slotKey] = {
                        day: dayNum,
                        hour: hourNum,
                        occupied: true,
                        blocked: true,
                        isTemplate: false,
                        disciplineId: null,
                        disciplineName: null,
                        duration: block.duration || 1,
                        students: [],
                        label: block.label || 'Blocked Time',
                        groupLabel: block.groupLabel || null,
                        instructorId: null,
                        instructorName: null
                    };
                } else {
                    // Mark as blocked (overrides template)
                    var existing = allSlots[slotKey];
                    existing.blocked = true;
                    existing.occupied = true;
                    existing.isTemplate = false;
                    if (block.duration) existing.duration = block.duration;
                    if (block.label) existing.label = block.label;
                    if (block.groupLabel) existing.groupLabel = block.groupLabel;
                }
            }
        }

        // Build grid
        for (var day = 1; day <= 7; day++) {
            grid[day] = {};

            for (var hour = 5; hour <= 23; hour++) {
                var slotKey = day + '_' + hour;
                if (allSlots[slotKey]) {
                    grid[day][hour] = allSlots[slotKey];
                } else {
                    grid[day][hour] = {
                        occupied: false,
                        blocked: false,
                        duration: 1,
                        students: [],
                        label: null,
                        groupLabel: null
                    };
                }
            }
        }

        return grid;
    }

    function renderInstructorSidebar(instructorId, week, templates, blocks, studentAssignments) {
        var html = '';

        // Instructor Info
        var instructor = getCharacterById(instructorId);
        var instructorName = instructor ? getDisplayName(instructor) : 'Unknown';

        html += '<div class="sidebar-section">';
        html += '<h4>Instructor</h4>';
        html += '<p><strong>' + escapeHtml(instructorName) + '</strong></p>';
        html += '</div>';

        // Summary
        html += '<div class="sidebar-section">';
        html += '<h4>Summary</h4>';

        var templateCount = Object.keys(templates).length;
        var blockCount = countBlocks(blocks);
        var studentCount = countAssignedStudents(studentAssignments);

        html += '<div class="summary-grid">';
        html += '<div class="summary-item"><span class="summary-label">Templates</span><span class="summary-value">' + templateCount + '</span></div>';
        html += '<div class="summary-item"><span class="summary-label">Blocks</span><span class="summary-value">' + blockCount + '</span></div>';
        html += '<div class="summary-item"><span class="summary-label">Students</span><span class="summary-value">' + studentCount + '</span></div>';
        html += '</div>';
        html += '</div>';

        // Groups (if available)
        var groups = getDisciplineGroupsForInstructor(instructorId, week);
        var groupKeys = Object.keys(groups);

        if (groupKeys.length > 0) {
            html += '<div class="sidebar-section">';
            html += '<h4>Groups</h4>';
            html += '<div class="group-list">';

            groupKeys.slice(0, 5).forEach(function(key) {
                var group = groups[key];
                var studentCount = group.students ? group.students.length : 0;
                html += '<div class="group-item">';
                html += '<span class="group-name">' + escapeHtml(group.disciplineName) + ' - G' + escapeHtml(group.groupLabel) + '</span>';
                html += '<span class="group-count">' + studentCount + ' students</span>';
                html += '</div>';
            });

            if (groupKeys.length > 5) {
                html += '<div class="group-more">+' + (groupKeys.length - 5) + ' more</div>';
            }

            html += '</div>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // LOCATION VIEW
    // ============================================================

    function renderLocationView(container, locationId, week, options) {
        options = options || {};

        if (!container) return null;

        var weekNum = parseInt(week) || 1;

        // Get data
        var schedule = getLocationSchedule(locationId, weekNum);
        var location = getLocation(locationId);

        // Build grid data
        var gridData = buildLocationGridData(schedule, location, options);

        // Render grid
        var gridOptions = {
            mode: 'location',
            days: [1, 2, 3, 4, 5, 6, 7],
            hours: getHours(5, 23),
            formatHour: formatHourShort,
            formatDay: getDayName,
            showLegend: options.showLegend !== false,
            emptyLabel: '+',
            getSlotClass: function(slot) {
                if (slot && slot.isFull) {
                    return 'full';
                }
                return '';
            },
            transformSlot: function(slot, day, hour) {
                return slot;
            }
        };

        var grid = window.CalendarGrid.render(null, gridData, gridOptions);

        // Build sidebar
        var sidebar = renderLocationSidebar(locationId, weekNum, schedule, location);

        // Combine
        var wrapper = document.createElement('div');
        wrapper.className = 'calendar-view location-view';

        var gridWrapper = document.createElement('div');
        gridWrapper.className = 'calendar-grid-wrapper';
        gridWrapper.appendChild(grid);

        wrapper.appendChild(gridWrapper);

        var sidebarWrapper = document.createElement('div');
        sidebarWrapper.className = 'calendar-sidebar';
        sidebarWrapper.innerHTML = sidebar;

        wrapper.appendChild(sidebarWrapper);

        container.appendChild(wrapper);

        return wrapper;
    }

    function buildLocationGridData(schedule, location, options) {
        var grid = {};

        for (var day = 1; day <= 7; day++) {
            grid[day] = {};

            for (var hour = 5; hour <= 23; hour++) {
                var disciplineId = schedule && schedule[day] ? schedule[day][hour] : null;

                if (disciplineId) {
                    var discipline = getDiscipline(disciplineId);
                    var duration = 1;
                    // Check for multi-hour class
                    for (var h = hour + 1; h <= 23; h++) {
                        if (schedule[day] && schedule[day][h] === disciplineId) {
                            duration++;
                        } else {
                            break;
                        }
                    }

                    grid[day][hour] = {
                        occupied: true,
                        blocked: false,
                        disciplineId: disciplineId,
                        disciplineName: discipline ? discipline.name : 'Unknown',
                        duration: duration,
                        students: [],
                        label: null,
                        groupLabel: null,
                        isFull: false,
                        data: {
                            disciplineId: disciplineId
                        }
                    };
                } else {
                    grid[day][hour] = {
                        occupied: false,
                        blocked: false,
                        duration: 1,
                        students: [],
                        label: null,
                        groupLabel: null
                    };
                }
            }
        }

        return grid;
    }

    function renderLocationSidebar(locationId, week, schedule, location) {
        var html = '';

        // Location Info
        var locationName = location ? location.name : 'Unknown';
        var locationType = location ? getLocationTypeLabel(location.type) : 'Unknown';
        var capacity = location ? location.capacity : null;

        html += '<div class="sidebar-section">';
        html += '<h4>Location</h4>';
        html += '<p><strong>' + escapeHtml(locationName) + '</strong></p>';
        html += '<p style="font-size:0.75rem;color:var(--text-dim);">Type: ' + escapeHtml(locationType) + '</p>';
        if (capacity !== null && capacity !== undefined && capacity !== '') {
            html += '<p style="font-size:0.75rem;color:var(--text-dim);">Capacity: ' + escapeHtml(capacity) + '</p>';
        }
        html += '</div>';

        // Usage Summary
        html += '<div class="sidebar-section">';
        html += '<h4>Usage Summary</h4>';

        var usageCount = countLocationUsage(schedule);
        var capacityDisplay = capacity !== null && capacity !== undefined && capacity !== ''
            ? capacity
            : 'Unlimited';

        html += '<div class="summary-grid">';
        html += '<div class="summary-item"><span class="summary-label">Classes</span><span class="summary-value">' + usageCount + '</span></div>';
        html += '<div class="summary-item"><span class="summary-label">Capacity</span><span class="summary-value">' + escapeHtml(capacityDisplay) + '</span></div>';
        html += '</div>';

        if (capacity !== null && capacity !== undefined && capacity !== '' && capacity > 0) {
            var utilization = Math.min(100, Math.round((usageCount / capacity) * 100));
            var color = utilization > 80 ? 'var(--danger)' : (utilization > 60 ? 'var(--warning)' : 'var(--accent)');
            html += '<div class="utilization-bar">';
            html += '<div class="utilization-fill" style="width:' + utilization + '%;background:' + color + ';"></div>';
            html += '</div>';
            html += '<div style="font-size:0.7rem;color:var(--text-dim);text-align:center;">' + utilization + '% utilized</div>';
        }

        html += '</div>';

        // Classes by Discipline
        var disciplineCounts = getDisciplineCountsFromSchedule(schedule);
        var discKeys = Object.keys(disciplineCounts);

        if (discKeys.length > 0) {
            html += '<div class="sidebar-section">';
            html += '<h4>Classes by Discipline</h4>';
            html += '<div class="discipline-list">';

            discKeys.slice(0, 5).forEach(function(discId) {
                var count = disciplineCounts[discId];
                var discipline = getDiscipline(discId);
                var name = discipline ? discipline.name : 'Unknown';
                html += '<div class="discipline-item">';
                html += '<span class="discipline-name">' + escapeHtml(name) + '</span>';
                html += '<span class="discipline-count">' + count + '</span>';
                html += '</div>';
            });

            if (discKeys.length > 5) {
                html += '<div class="discipline-more">+' + (discKeys.length - 5) + ' more</div>';
            }

            html += '</div>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================

    function getHours(start, end) {
        var hours = [];
        for (var h = start; h <= end; h++) {
            hours.push(h);
        }
        return hours;
    }

    function countClasses(schedule) {
        var count = 0;
        if (!schedule) return 0;

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            for (var hour in schedule[day]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) continue;
                if (schedule[day][hour]) count++;
            }
        }
        return count;
    }

    function countBlocks(blocks) {
        var count = 0;
        if (!blocks) return 0;

        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) continue;
            for (var hour in blocks[day]) {
                if (!Object.prototype.hasOwnProperty.call(blocks[day], hour)) continue;
                count++;
            }
        }
        return count;
    }

    function countAssignedStudents(studentAssignments) {
        var count = 0;
        if (!studentAssignments) return 0;

        var seen = {};
        for (var i = 0; i < studentAssignments.length; i++) {
            var id = studentAssignments[i];
            if (!seen[id]) {
                seen[id] = true;
                count++;
            }
        }
        return count;
    }

    function countLocationUsage(schedule) {
        var count = 0;
        if (!schedule) return 0;

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            for (var hour in schedule[day]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) continue;
                if (schedule[day][hour]) count++;
            }
        }
        return count;
    }

    function getDisciplineCountsFromSchedule(schedule) {
        var counts = {};
        if (!schedule) return counts;

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            for (var hour in schedule[day]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) continue;
                var discId = schedule[day][hour];
                if (discId) {
                    if (!counts[discId]) counts[discId] = 0;
                    counts[discId]++;
                }
            }
        }
        return counts;
    }

    function getClassList(studentId, week, schedule) {
        var classes = [];
        if (!schedule) return classes;

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            for (var hour in schedule[day]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) continue;
                var disciplineId = schedule[day][hour];
                if (!disciplineId) continue;

                var discipline = getDiscipline(disciplineId);
                var instructorId = getClassInstructor(studentId, week, parseInt(day), parseInt(hour));
                var instructorName = '';
                if (instructorId) {
                    var instructor = getCharacterById(instructorId);
                    if (instructor) {
                        instructorName = getDisplayName(instructor);
                    }
                }

                classes.push({
                    day: parseInt(day),
                    dayName: getDayName(parseInt(day)),
                    hour: parseInt(hour),
                    time: formatHourShort(parseInt(hour)),
                    name: discipline ? discipline.name : 'Unknown',
                    instructor: instructorName
                });
            }
        }

        classes.sort(function(a, b) {
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        return classes;
    }

    function getTotalWeeklyHours() {
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return 0;
        }

        var total = 0;
        data.curriculum.disciplines.forEach(function(d) {
            var hours = d.weeklyHours ? Number(d.weeklyHours) : 0;
            if (hours > 0) total += hours;
        });
        return total;
    }

    // ============================================================
    // DATA ACCESS WRAPPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getStudentSchedule(studentId, week) {
        if (typeof window.getStudentSchedule === 'function') {
            return window.getStudentSchedule(studentId, week);
        }
        return {};
    }

    function getStudentRestDays(studentId, week) {
        if (typeof window.getStudentRestDays === 'function') {
            return window.getStudentRestDays(studentId, week);
        }
        return [];
    }

    function getDiscipline(id) {
        if (typeof window.getDiscipline === 'function') {
            return window.getDiscipline(id);
        }
        return null;
    }

    function getDisciplineName(id) {
        var disc = getDiscipline(id);
        return disc ? disc.name : 'Unknown';
    }

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        return null;
    }

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char ? char.name || 'Unknown' : 'Unknown';
    }

    function getClassInstructor(studentId, week, day, hour) {
        if (typeof window.getClassInstructor === 'function') {
            return window.getClassInstructor(studentId, week, day, hour);
        }
        return null;
    }

    function getClassLabel(studentId, week, day, hour) {
        if (typeof window.getClassLabel === 'function') {
            return window.getClassLabel(studentId, week, day, hour);
        }
        return null;
    }

    function getClassGroupLabel(studentId, week, day, hour) {
        if (typeof window.getClassGroupLabel === 'function') {
            return window.getClassGroupLabel(studentId, week, day, hour);
        }
        return null;
    }

    function getClassDuration(studentId, week, day, hour) {
        if (typeof window.getClassDuration === 'function') {
            return window.getClassDuration(studentId, week, day, hour);
        }
        return 1;
    }

    function getInstructorTemplates(instructorId, week) {
        if (typeof window.getInstructorTemplates === 'function') {
            return window.getInstructorTemplates(instructorId, week);
        }
        return {};
    }

    function getInstructorBlocks(instructorId, week) {
        if (typeof window.getInstructorBlocks === 'function') {
            return window.getInstructorBlocks(instructorId, week);
        }
        return {};
    }

    function getInstructorStudentAssignments(instructorId, week) {
        if (typeof window.getInstructorStudentAssignments === 'function') {
            return window.getInstructorStudentAssignments(instructorId, week);
        }
        return [];
    }

    function getLocationSchedule(locationId, week) {
        if (typeof window.getLocationSchedule === 'function') {
            return window.getLocationSchedule(locationId, week);
        }
        return {};
    }

    function getLocation(id) {
        if (typeof window.getLocation === 'function') {
            return window.getLocation(id);
        }
        return null;
    }

    function getLocationTypeLabel(type) {
        if (typeof window.getLocationTypeLabel === 'function') {
            return window.getLocationTypeLabel(type);
        }
        return type || 'Other';
    }

    function getDisciplineGroupsForInstructor(instructorId, week) {
        if (typeof window.getDisciplineGroupsForInstructor === 'function') {
            return window.getDisciplineGroupsForInstructor(instructorId, week);
        }
        return {};
    }

    function getAvailableDisciplinesForStudent(studentId, week) {
        if (typeof window.getAvailableDisciplinesForStudent === 'function') {
            return window.getAvailableDisciplinesForStudent(studentId, week);
        }
        return [];
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarViews = {
        // Main renderers
        renderStudentView: renderStudentView,
        renderInstructorView: renderInstructorView,
        renderLocationView: renderLocationView,

        // Grid data builders
        buildStudentGridData: buildStudentGridData,
        buildInstructorGridData: buildInstructorGridData,
        buildLocationGridData: buildLocationGridData,

        // Sidebar renderers
        renderStudentSidebar: renderStudentSidebar,
        renderInstructorSidebar: renderInstructorSidebar,
        renderLocationSidebar: renderLocationSidebar,

        // Utility functions
        getHours: getHours,
        countClasses: countClasses,
        getClassList: getClassList,
        getTotalWeeklyHours: getTotalWeeklyHours,
        getDayName: getDayName,
        getDayShort: getDayShort,
        formatHourShort: formatHourShort
    };

})();
