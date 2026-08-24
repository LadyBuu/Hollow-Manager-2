/**
 * js/modules/curriculum/groups.js - Auto-Group Management
 * Groups are created based on Discipline + Instructor combination
 * Path: js/modules/curriculum/groups.js
 */

(function() {
    'use strict';

    var expandedGroups = {};

    function generateGroupKey(disciplineId, instructorId) {
        return disciplineId + '_' + instructorId;
    }

    function getAllAutoGroups() {
        var data = window.data || {};
        if (!data.curriculum) {
            data.curriculum = {};
        }
        if (!data.curriculum.autoGroups) {
            data.curriculum.autoGroups = {};
        }
        return data.curriculum.autoGroups;
    }

    function getOrCreateGroup(disciplineId, instructorId) {
        var key = generateGroupKey(disciplineId, instructorId);
        var groups = getAllAutoGroups();

        if (!groups[key]) {
            var discipline = window.getDiscipline(disciplineId);
            var instructor = window.getCharacterById(instructorId);
            var disciplineName = discipline ? discipline.name : 'Unknown';
            var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';

            var shortInstructor = instructorName;
            if (instructor) {
                var parts = instructorName.split(' ');
                if (parts.length >= 2) {
                    shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
                }
            }

            groups[key] = {
                id: key,
                disciplineId: disciplineId,
                instructorId: instructorId,
                displayName: disciplineName + ' (' + shortInstructor + ')',
                students: [],
                slots: [],
                createdAt: new Date().toISOString()
            };
        }

        return groups[key];
    }

    function getGroupByKey(key) {
        var groups = getAllAutoGroups();
        return groups[key] || null;
    }

    function getGroupsForDiscipline(disciplineId) {
        var groups = getAllAutoGroups();
        var result = {};
        for (var key in groups) {
            if (String(groups[key].disciplineId) === String(disciplineId)) {
                result[key] = groups[key];
            }
        }
        return result;
    }

    function getGroupsForInstructor(instructorId) {
        var groups = getAllAutoGroups();
        var result = {};
        for (var key in groups) {
            if (String(groups[key].instructorId) === String(instructorId)) {
                result[key] = groups[key];
            }
        }
        return result;
    }

    function getStudentGroup(studentId, disciplineId, instructorId) {
        var key = generateGroupKey(disciplineId, instructorId);
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (group && group.students.indexOf(studentId) !== -1) {
            return group;
        }
        return null;
    }

    function addStudentToGroup(key, studentId) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) return { success: false, message: 'Group not found.' };

        if (group.students.indexOf(studentId) !== -1) {
            return { success: false, message: 'Student already in this group.' };
        }

        var conflicts = [];
        var student = window.getCharacterById(studentId);
        var studentName = student ? window.getDisplayName(student) : 'Unknown';

        group.slots.forEach(function(slot) {
            var schedule = window.getStudentSchedule(studentId, slot.week);
            var hasConflict = false;
            var conflictDiscipline = null;
            var conflictInstructor = null;

            for (var h = slot.hour; h < slot.hour + (slot.duration || 1) && h <= 23; h++) {
                if (schedule[slot.day] && schedule[slot.day][h]) {
                    var discId = schedule[slot.day][h];
                    var confDisc = window.getDiscipline(discId);
                    conflictDiscipline = confDisc ? confDisc.name : 'Unknown';
                    var confInstructorId = window.getClassInstructor(studentId, slot.week, slot.day, h);
                    if (confInstructorId) {
                        var confInstructor = window.getCharacterById(confInstructorId);
                        conflictInstructor = confInstructor ? window.getDisplayName(confInstructor) : 'Unknown';
                    }
                    hasConflict = true;
                    break;
                }
            }

            if (hasConflict) {
                var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                var hourDisplay = slot.hour > 12 ? slot.hour - 12 : slot.hour;
                var ampm = slot.hour >= 12 ? 'PM' : 'AM';
                if (slot.hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                if (slot.hour === 12) { ampm = 'PM'; }
                conflicts.push({
                    week: slot.week,
                    day: dayNames[slot.day],
                    hour: hourDisplay + ':00 ' + ampm,
                    discipline: conflictDiscipline,
                    instructor: conflictInstructor || 'Unknown'
                });
            }
        });

        if (conflicts.length > 0) {
            var conflictMsg = 'Student ' + studentName + ' has conflicts in the following slots:\n\n';
            conflicts.forEach(function(c) {
                conflictMsg += '• Week ' + c.week + ', ' + c.day + ' at ' + c.hour + ' - ' + c.discipline + ' (' + c.instructor + ')\n';
            });
            conflictMsg += '\nDo you want to remove the student from their current classes in these slots and add them to this group?';

            if (!confirm(conflictMsg)) {
                return { success: false, message: 'Student not added to group due to conflicts.' };
            }

            group.slots.forEach(function(slot) {
                var schedule = window.getStudentSchedule(studentId, slot.week);
                for (var h = slot.hour; h < slot.hour + (slot.duration || 1) && h <= 23; h++) {
                    if (schedule[slot.day] && schedule[slot.day][h]) {
                        delete schedule[slot.day][h];
                        window.setClassInstructor(studentId, slot.week, slot.day, h, null);
                        window.setClassLabel(studentId, slot.week, slot.day, h, null);
                        window.setClassGroupLabel(studentId, slot.week, slot.day, h, null);
                        window.setClassDuration(studentId, slot.week, slot.day, h, null);
                    }
                }
            });
        }

        if (conflicts.length === 0 || confirm) {
            group.slots.forEach(function(slot) {
                addStudentToSlot(studentId, group.disciplineId, group.instructorId, slot);
            });
        }

        if (group.students.indexOf(studentId) === -1) {
            group.students.push(studentId);
            group.students.sort();
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return { success: true, message: 'Student added to group and all class slots.' };
    }

    function removeStudentFromGroup(key, studentId) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) return false;

        var idx = group.students.indexOf(studentId);
        if (idx === -1) return false;

        group.slots.forEach(function(slot) {
            removeStudentFromSlot(studentId, slot.week, slot.day, slot.hour);
        });

        group.students.splice(idx, 1);

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return true;
    }

    function addStudentToSlot(studentId, disciplineId, instructorId, slot) {
        var schedule = window.getStudentSchedule(studentId, slot.week);
        var duration = slot.duration || 1;
        var label = slot.label || '';

        for (var h = slot.hour; h < slot.hour + duration && h <= 23; h++) {
            if (schedule[slot.day] && schedule[slot.day][h]) {
                return false;
            }
        }

        for (var h = slot.hour; h < slot.hour + duration && h <= 23; h++) {
            if (!schedule[slot.day]) schedule[slot.day] = {};
            schedule[slot.day][h] = disciplineId;
            if (instructorId) {
                window.setClassInstructor(studentId, slot.week, slot.day, h, instructorId);
            }
            if (label && h === slot.hour) {
                window.setClassLabel(studentId, slot.week, slot.day, h, label);
            }
            if (h === slot.hour) {
                window.setClassDuration(studentId, slot.week, slot.day, h, duration);
            }
            window.setClassGroupLabel(studentId, slot.week, slot.day, h, 'auto-group');
        }

        return true;
    }

    function removeStudentFromSlot(studentId, week, day, hour) {
        var schedule = window.getStudentSchedule(studentId, week);
        var duration = window.getClassDuration(studentId, week, day, hour) || 1;

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day] && schedule[day][h]) {
                delete schedule[day][h];
                window.setClassInstructor(studentId, week, day, h, null);
                window.setClassLabel(studentId, week, day, h, null);
                window.setClassGroupLabel(studentId, week, day, h, null);
                window.setClassDuration(studentId, week, day, h, null);
            }
        }
    }

    function addSlotToGroup(key, week, day, hour, duration, label) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) return null;

        var exists = group.slots.some(function(s) {
            return s.week === week && s.day === day && s.hour === hour;
        });

        if (exists) return group;

        group.slots.push({
            week: week,
            day: day,
            hour: hour,
            duration: duration || 1,
            label: label || ''
        });

        group.slots.sort(function(a, b) {
            if (a.week !== b.week) return a.week - b.week;
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        var addedCount = 0;
        var conflictStudents = [];

        group.students.forEach(function(studentId) {
            var result = addStudentToSlot(studentId, group.disciplineId, group.instructorId, {
                week: week,
                day: day,
                hour: hour,
                duration: duration || 1,
                label: label || ''
            });
            if (result) {
                addedCount++;
            } else {
                var student = window.getCharacterById(studentId);
                var name = student ? window.getDisplayName(student) : 'Unknown';
                conflictStudents.push(name);
            }
        });

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }

        return {
            group: group,
            addedCount: addedCount,
            conflictStudents: conflictStudents
        };
    }

    function removeSlotFromGroup(key, week, day, hour) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) return false;

        var slotIndex = -1;
        group.slots.forEach(function(s, idx) {
            if (s.week === week && s.day === day && s.hour === hour) {
                slotIndex = idx;
            }
        });

        if (slotIndex === -1) return false;

        group.students.forEach(function(studentId) {
            removeStudentFromSlot(studentId, week, day, hour);
        });

        group.slots.splice(slotIndex, 1);

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return true;
    }

    function getStudentsInGroup(key) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) return [];
        return group.students.slice();
    }

    function getStudentsInGroupSlots(key) {
        var groups = getAllAutoGroups();
        var group = groups[key];
        if (!group) return {};

        var result = {};
        group.slots.forEach(function(slot) {
            var key = slot.week + '_' + slot.day + '_' + slot.hour;
            result[key] = {
                week: slot.week,
                day: slot.day,
                hour: slot.hour,
                duration: slot.duration || 1,
                label: slot.label || '',
                students: []
            };

            group.students.forEach(function(studentId) {
                var schedule = window.getStudentSchedule(studentId, slot.week);
                var hasClass = false;
                for (var h = slot.hour; h < slot.hour + (slot.duration || 1) && h <= 23; h++) {
                    if (schedule[slot.day] && schedule[slot.day][h]) {
                        hasClass = true;
                        break;
                    }
                }
                if (hasClass) {
                    var student = window.getCharacterById(studentId);
                    result[key].students.push({
                        id: studentId,
                        name: student ? window.getDisplayName(student) : 'Unknown'
                    });
                }
            });
        });

        return result;
    }

    function rebuildGroupsFromSchedules() {
        var data = window.data || {};
        data.curriculum.autoGroups = {};

        var students = window.getStudents();

        students.forEach(function(student) {
            var studentId = student.id;
            var schedule = data.curriculum.schedules ? data.curriculum.schedules[studentId] : null;
            if (!schedule) return;

            for (var week in schedule) {
                var weekNum = parseInt(week);
                if (isNaN(weekNum)) continue;

                for (var day in schedule[weekNum]) {
                    var dayNum = parseInt(day);
                    if (isNaN(dayNum)) continue;

                    for (var hour in schedule[weekNum][dayNum]) {
                        var hourNum = parseInt(hour);
                        if (isNaN(hourNum)) continue;

                        var disciplineId = schedule[weekNum][dayNum][hourNum];
                        if (!disciplineId) continue;

                        var instructorId = window.getClassInstructor(studentId, weekNum, dayNum, hourNum);
                        if (!instructorId) continue;

                        var key = generateGroupKey(disciplineId, instructorId);
                        var groups = getAllAutoGroups();

                        if (!groups[key]) {
                            var discipline = window.getDiscipline(disciplineId);
                            var instructor = window.getCharacterById(instructorId);
                            var disciplineName = discipline ? discipline.name : 'Unknown';
                            var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';
                            var shortInstructor = instructorName;
                            if (instructor) {
                                var parts = instructorName.split(' ');
                                if (parts.length >= 2) {
                                    shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
                                }
                            }

                            groups[key] = {
                                id: key,
                                disciplineId: disciplineId,
                                instructorId: instructorId,
                                displayName: disciplineName + ' (' + shortInstructor + ')',
                                students: [],
                                slots: [],
                                createdAt: new Date().toISOString()
                            };
                        }

                        var group = groups[key];

                        if (group.students.indexOf(studentId) === -1) {
                            group.students.push(studentId);
                            group.students.sort();
                        }

                        var slotExists = group.slots.some(function(s) {
                            return s.week === weekNum && s.day === dayNum && s.hour === hourNum;
                        });

                        if (!slotExists) {
                            var duration = window.getClassDuration(studentId, weekNum, dayNum, hourNum) || 1;
                            var label = window.getClassLabel(studentId, weekNum, dayNum, hourNum) || '';
                            group.slots.push({
                                week: weekNum,
                                day: dayNum,
                                hour: hourNum,
                                duration: duration,
                                label: label
                            });
                        }
                    }
                }
            }
        });

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
    }

    // ============================================================
    // UI RENDERING
    // ============================================================

    function renderAutoGroupsView(container) {
        if (!container) {
            container = document.getElementById('groups-content');
        }
        if (!container) return;

        // Check if data exists
        if (!window.data) {
            console.warn('No data available for auto-groups, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading auto-groups data...</p>';
            return;
        }

        // Ensure curriculum structure exists
        if (!window.data.curriculum) {
            window.data.curriculum = {
                disciplines: [],
                schedules: {},
                restDays: {},
                examDays: {},
                grades: {},
                rankings: {},
                currentWeek: 1,
                classInstructors: {},
                classLabels: {},
                classGroupLabels: {},
                classDurations: {},
                instructorClasses: {},
                instructorTemplates: {},
                instructorBlocks: {},
                instructorGroups: {},
                disciplineGroups: {},
                autoGroups: {}
            };
        }
        if (!window.data.curriculum.autoGroups) {
            window.data.curriculum.autoGroups = {};
        }

        container.innerHTML = getAutoGroupsHTML();

        populateGroupFilters();
        renderAutoGroups();
        initAutoGroupsEvents();
    }

    function getAutoGroupsHTML() {
        return `
            <div class="page-header">
                <h2>■ Auto-Groups</h2>
                <div class="header-actions">
                    <span style="font-size:0.7rem;color:var(--text-dim);">Groups auto-created from Discipline + Instructor</span>
                    <button id="refresh-auto-groups-btn" class="small secondary">↻ Refresh</button>
                    <button id="rebuild-auto-groups-btn" class="small primary">↻ Rebuild Groups</button>
                </div>
            </div>
            <div class="filter-section">
                <label for="group-filter-discipline">Filter:</label>
                <select id="group-filter-discipline" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                    <option value="all">All Disciplines</option>
                </select>
                <label for="group-filter-instructor" style="margin-left:8px;">Instructor:</label>
                <select id="group-filter-instructor" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                    <option value="all">All Instructors</option>
                </select>
            </div>
            <div id="auto-groups-container">
                <p class="empty-state">No groups created yet. Groups are auto-created when students are assigned to classes.</p>
            </div>
        `;
    }

    function populateGroupFilters() {
        var disciplineSelect = document.getElementById('group-filter-discipline');
        var instructorSelect = document.getElementById('group-filter-instructor');
        var data = window.data || {};

        if (disciplineSelect) {
            var disciplines = data.curriculum ? data.curriculum.disciplines || [] : [];
            var currentValue = disciplineSelect.value;
            disciplineSelect.innerHTML = '<option value="all">All Disciplines</option>';
            disciplines.forEach(function(d) {
                var option = document.createElement('option');
                option.value = d.id;
                option.textContent = d.name;
                disciplineSelect.appendChild(option);
            });
            if (currentValue) disciplineSelect.value = currentValue;
        }

        if (instructorSelect) {
            var instructors = window.getInstructors();
            var currentValue = instructorSelect.value;
            instructorSelect.innerHTML = '<option value="all">All Instructors</option>';
            instructors.forEach(function(c) {
                var name = window.getDisplayName(c);
                var option = document.createElement('option');
                option.value = c.id;
                option.textContent = name;
                instructorSelect.appendChild(option);
            });
            if (currentValue) instructorSelect.value = currentValue;
        }
    }

    function renderAutoGroups() {
        var container = document.getElementById('auto-groups-container');
        if (!container) return;

        var disciplineFilter = document.getElementById('group-filter-discipline') ? document.getElementById('group-filter-discipline').value : 'all';
        var instructorFilter = document.getElementById('group-filter-instructor') ? document.getElementById('group-filter-instructor').value : 'all';

        var groups = getAllAutoGroups();
        var groupKeys = Object.keys(groups);

        if (disciplineFilter !== 'all') {
            groupKeys = groupKeys.filter(function(key) {
                return String(groups[key].disciplineId) === String(disciplineFilter);
            });
        }
        if (instructorFilter !== 'all') {
            groupKeys = groupKeys.filter(function(key) {
                return String(groups[key].instructorId) === String(instructorFilter);
            });
        }

        if (groupKeys.length === 0) {
            container.innerHTML = '<p class="empty-state">No groups found. Groups are auto-created when students are assigned to classes with the same discipline and instructor.</p>';
            return;
        }

        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        groupKeys.sort(function(a, b) {
            return (groups[a].displayName || a).localeCompare(groups[b].displayName || b);
        });

        var html = '<div style="display:flex;flex-direction:column;gap:12px;">';

        groupKeys.forEach(function(key) {
            var group = groups[key];
            var discipline = window.getDiscipline(group.disciplineId);
            var instructor = window.getCharacterById(group.instructorId);
            var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';
            var studentCount = group.students ? group.students.length : 0;
            var slotCount = group.slots ? group.slots.length : 0;
            var isExpanded = expandedGroups[key] || false;

            html += '<div class="auto-group-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
            html += '<div style="cursor:pointer;" onclick="window.toggleAutoGroup(\'' + key + '\')">';
            html += '<strong style="color:var(--accent);">' + group.displayName + '</strong>';
            html += ' <span style="color:var(--text-dim);font-size:0.75rem;">(' + studentCount + ' students, ' + slotCount + ' slots)</span>';
            html += '</div>';
            html += '<div style="display:flex;align-items:center;gap:8px;">';
            html += '<span style="font-size:0.7rem;color:var(--text-dim);cursor:pointer;" onclick="window.toggleAutoGroup(\'' + key + '\')">' + (isExpanded ? '▾' : '▸') + '</span>';
            html += '</div>';
            html += '</div>';

            if (isExpanded) {
                html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-soft);">';

                html += '<div style="margin-bottom:8px;font-size:0.75rem;color:var(--text-dim);">';
                html += 'Instructor: <strong>' + instructorName + '</strong>';
                html += ' | Discipline: <strong>' + (discipline ? discipline.name : 'Unknown') + '</strong>';
                html += '</div>';

                if (group.slots && group.slots.length > 0) {
                    html += '<div style="margin-bottom:8px;">';
                    html += '<span style="font-size:0.7rem;color:var(--text-dim);">Class Times:</span><br>';
                    group.slots.forEach(function(slot) {
                        var hourDisplay = slot.hour > 12 ? slot.hour - 12 : slot.hour;
                        var ampm = slot.hour >= 12 ? 'PM' : 'AM';
                        if (slot.hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                        if (slot.hour === 12) { ampm = 'PM'; }
                        var durationDisplay = slot.duration > 1 ? ' (' + slot.duration + 'h)' : '';
                        var labelDisplay = slot.label ? ' [' + slot.label + ']' : '';
                        html += '<span style="background:var(--bg);padding:2px 8px;border-radius:10px;font-size:0.7rem;margin:2px;display:inline-block;border:1px solid var(--border-soft);">';
                        html += 'Week ' + slot.week + ' - ' + dayNames[slot.day] + ' ' + hourDisplay + ':00 ' + ampm + durationDisplay + labelDisplay;
                        html += ' <button class="remove-slot-from-group small" data-key="' + key + '" data-week="' + slot.week + '" data-day="' + slot.day + '" data-hour="' + slot.hour + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;">✕</button>';
                        html += '</span>';
                    });
                    html += '</div>';
                }

                if (group.students && group.students.length > 0) {
                    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">';
                    html += '<span style="font-size:0.7rem;color:var(--text-dim);">Students:</span> ';
                    group.students.forEach(function(id) {
                        var student = window.getCharacterById(id);
                        var name = student ? window.getDisplayName(student) : 'Unknown';
                        html += '<span class="student-tag" style="background:var(--bg);padding:2px 10px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);">' + name;
                        html += ' <button class="remove-from-group-btn small" data-key="' + key + '" data-student="' + id + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;">✕</button>';
                        html += '</span>';
                    });
                    html += '</div>';
                } else {
                    html += '<div style="color:var(--text-dim);font-size:0.75rem;margin-bottom:8px;">No students in this group</div>';
                }

                html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">Add student:</span>';
                html += '<select class="add-student-to-group-select" data-key="' + key + '" style="flex:1;min-width:120px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:0.7rem;">';
                html += '<option value="">Select student...</option>';

                var allStudents = window.getStudents();
                allStudents.forEach(function(s) {
                    if (group.students.indexOf(s.id) === -1) {
                        var name = window.getDisplayName(s);
                        html += '<option value="' + s.id + '">' + name + '</option>';
                    }
                });
                html += '</select>';
                html += '<button class="add-student-to-group-btn small primary" data-key="' + key + '">Add</button>';
                html += '</div>';

                html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">Add class time:</span>';
                html += '<select class="add-slot-week" style="width:60px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:0.7rem;">';
                for (var w = 1; w <= 52; w++) {
                    html += '<option value="' + w + '">W' + w + '</option>';
                }
                html += '</select>';
                html += '<select class="add-slot-day" style="width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:0.7rem;">';
                html += '<option value="1">Mon</option><option value="2">Tue</option><option value="3">Wed</option>';
                html += '<option value="4">Thu</option><option value="5">Fri</option><option value="6">Sat</option><option value="7">Sun</option>';
                html += '</select>';
                html += '<select class="add-slot-hour" style="width:70px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:0.7rem;">';
                for (var h = 8; h <= 20; h++) {
                    var hDisplay = h > 12 ? h - 12 : h;
                    var ampm = h >= 12 ? 'PM' : 'AM';
                    if (h === 0) { hDisplay = 12; ampm = 'AM'; }
                    if (h === 12) { ampm = 'PM'; }
                    html += '<option value="' + h + '">' + hDisplay + ':00 ' + ampm + '</option>';
                }
                html += '</select>';
                html += '<select class="add-slot-duration" style="width:70px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:0.7rem;">';
                html += '<option value="1">1h</option><option value="2">2h</option><option value="3">3h</option><option value="4">4h</option>';
                html += '</select>';
                html += '<input class="add-slot-label" type="text" placeholder="Label" style="width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:0.7rem;">';
                html += '<button class="add-slot-to-group-btn small primary" data-key="' + key + '">Add Time</button>';
                html += '</div>';

                html += '</div>';
            }

            html += '</div>';
        });

        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.remove-from-group-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var key = this.dataset.key;
                var studentId = this.dataset.student;

                if (!confirm('Remove this student from the group and all their classes for this discipline?')) return;

                var student = window.getCharacterById(studentId);
                var name = student ? window.getDisplayName(student) : 'Unknown';

                removeStudentFromGroup(key, studentId);
                renderAutoGroups();
                if (typeof window.renderStudentSchedule === 'function') {
                    window.renderStudentSchedule();
                }
                if (typeof window.renderInstructorCalendarData === 'function') {
                    window.renderInstructorCalendarData();
                }
                alert('Removed ' + name + ' from group and all class slots.');
            });
        });

        container.querySelectorAll('.add-student-to-group-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var key = this.dataset.key;
                var select = this.parentElement.querySelector('.add-student-to-group-select');
                var studentId = select.value;

                if (!studentId) {
                    alert('Please select a student.');
                    return;
                }

                var student = window.getCharacterById(studentId);
                var name = student ? window.getDisplayName(student) : 'Unknown';

                var result = addStudentToGroup(key, studentId);
                if (result && result.success) {
                    renderAutoGroups();
                    if (typeof window.renderStudentSchedule === 'function') {
                        window.renderStudentSchedule();
                    }
                    if (typeof window.renderInstructorCalendarData === 'function') {
                        window.renderInstructorCalendarData();
                    }
                    alert('Added ' + name + ' to group and all class slots.');
                } else {
                    alert('Failed to add student: ' + (result ? result.message : 'Unknown error'));
                }
            });
        });

        container.querySelectorAll('.remove-slot-from-group').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var key = this.dataset.key;
                var week = parseInt(this.dataset.week);
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);

                if (!confirm('Remove this class time from the group? This will remove ALL students from this slot.')) return;

                removeSlotFromGroup(key, week, day, hour);
                renderAutoGroups();
                if (typeof window.renderStudentSchedule === 'function') {
                    window.renderStudentSchedule();
                }
                if (typeof window.renderInstructorCalendarData === 'function') {
                    window.renderInstructorCalendarData();
                }
                alert('Class time removed from group.');
            });
        });

        container.querySelectorAll('.add-slot-to-group-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var key = this.dataset.key;
                var parent = this.parentElement;
                var week = parseInt(parent.querySelector('.add-slot-week').value);
                var day = parseInt(parent.querySelector('.add-slot-day').value);
                var hour = parseInt(parent.querySelector('.add-slot-hour').value);
                var duration = parseInt(parent.querySelector('.add-slot-duration').value) || 1;
                var label = parent.querySelector('.add-slot-label').value.trim();

                var result = addSlotToGroup(key, week, day, hour, duration, label);
                if (result) {
                    renderAutoGroups();
                    if (typeof window.renderStudentSchedule === 'function') {
                        window.renderStudentSchedule();
                    }
                    if (typeof window.renderInstructorCalendarData === 'function') {
                        window.renderInstructorCalendarData();
                    }
                    var msg = 'Added class time to group. ' + result.addedCount + ' student(s) added.';
                    if (result.conflictStudents.length > 0) {
                        msg += '\n\nCould not add these students due to conflicts:\n' + result.conflictStudents.join('\n');
                    }
                    alert(msg);
                } else {
                    alert('Failed to add class time.');
                }
            });
        });
    }

    function toggleAutoGroup(key) {
        if (expandedGroups[key]) {
            delete expandedGroups[key];
        } else {
            expandedGroups[key] = true;
        }
        renderAutoGroups();
    }

    function initAutoGroupsEvents() {
        var refreshBtn = document.getElementById('refresh-auto-groups-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                renderAutoGroups();
            });
        }

        var rebuildBtn = document.getElementById('rebuild-auto-groups-btn');
        if (rebuildBtn) {
            rebuildBtn.addEventListener('click', function() {
                if (confirm('Rebuild all groups from existing schedules? This will recreate all groups based on current student assignments.')) {
                    rebuildGroupsFromSchedules();
                    renderAutoGroups();
                    alert('Groups rebuilt successfully!');
                }
            });
        }

        var disciplineFilter = document.getElementById('group-filter-discipline');
        if (disciplineFilter) {
            disciplineFilter.addEventListener('change', function() {
                renderAutoGroups();
            });
        }

        var instructorFilter = document.getElementById('group-filter-instructor');
        if (instructorFilter) {
            instructorFilter.addEventListener('change', function() {
                renderAutoGroups();
            });
        }
    }

    // ============================================================
    // REGISTER WITH CURRICULUM MAIN
    // ============================================================

    if (typeof window.curriculumState !== 'undefined') {
        window.curriculumState.autoGroups = expandedGroups;
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('groups-content');
        if (container && container.style.display !== 'none') {
            renderAutoGroupsView(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'groups') {
            var container = document.getElementById('groups-content');
            if (container) {
                renderAutoGroupsView(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('groups-content');
            if (container && container.style.display !== 'none') {
                renderAutoGroupsView(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderAutoGroupsView = renderAutoGroupsView;
    window.renderAutoGroups = renderAutoGroups;
    window.getAllAutoGroups = getAllAutoGroups;
    window.getGroupByKey = getGroupByKey;
    window.getOrCreateGroup = getOrCreateGroup;
    window.getGroupsForDiscipline = getGroupsForDiscipline;
    window.getGroupsForInstructor = getGroupsForInstructor;
    window.getStudentGroup = getStudentGroup;
    window.addStudentToGroup = addStudentToGroup;
    window.removeStudentFromGroup = removeStudentFromGroup;
    window.addSlotToGroup = addSlotToGroup;
    window.removeSlotFromGroup = removeSlotFromGroup;
    window.getStudentsInGroup = getStudentsInGroup;
    window.getStudentsInGroupSlots = getStudentsInGroupSlots;
    window.generateGroupKey = generateGroupKey;
    window.rebuildGroupsFromSchedules = rebuildGroupsFromSchedules;
    window.toggleAutoGroup = toggleAutoGroup;
    window.initAutoGroupsEvents = initAutoGroupsEvents;
    window.populateGroupFilters = populateGroupFilters;

    console.log('groups.js loaded');

})();
