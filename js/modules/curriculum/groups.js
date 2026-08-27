/**
 * js/modules/curriculum/groups.js - Auto-Group Management
 * Groups are created based on Discipline + Instructor combination
 * Path: js/modules/curriculum/groups.js
 * 
 * This module is responsible for:
 *   - Rendering auto-groups UI
 *   - Group, student, and slot management UI (delegates to core)
 *   - Rebuilding groups from schedules (delegates to core)
 * 
 * IMPORTANT: 
 *   - All application-data mutations are delegated to core functions.
 *   - This module does NOT mutate window.data directly.
 *   - Persistence is handled through the central saveData() function.
 *   - This module does not implement persistence itself.
 *   - State (expanded groups) is stored locally (UI state, not persisted).
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 * 
 * ARCHITECTURAL NOTE:
 *   - Schedules are the authoritative source of truth.
 *   - Auto-groups are an indexed/managed representation of schedule relationships.
 *   - Groups can be rebuilt from schedules if they become out of sync.
 *   - Core mutation functions update both groups AND schedules atomically.
 *   - Slot identity: (week, day, hour) uniquely identifies a slot in the core.
 *   - Adding a student to a group assigns them to ALL slots in that group.
 *   - Removing a student removes them from ALL slots in that group.
 *   - All core mutation functions return { success: boolean, message?: string, ... }
 *   - The UI checks result.success for all operations.
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - UI state only (expanded groups)
    // ============================================================

    var expandedGroups = {};

    // ============================================================
    // RENDER AUTO-GROUPS VIEW - Public API (only this is exposed)
    // ============================================================

    function renderAutoGroupsView(container) {
        if (!container) {
            container = document.getElementById('groups-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading auto-groups data...</p>';
            return;
        }

        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[Groups] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        container.innerHTML = getAutoGroupsHTML();
        refreshGroupsView();
        initAutoGroupsEvents();
    }

    // ============================================================
    // REFRESH GROUPS VIEW - Centralised refresh
    // ============================================================

    function refreshGroupsView() {
        cleanupExpandedGroups();
        populateGroupFilters();
        renderGroups();
    }

    // ============================================================
    // CLEANUP STALE EXPANDED GROUPS
    // ============================================================

    function cleanupExpandedGroups() {
        var groups = window.getAllAutoGroups ? window.getAllAutoGroups() : {};
        Object.keys(expandedGroups).forEach(function(key) {
            if (!groups[key]) {
                delete expandedGroups[key];
            }
        });
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
    // SAFE API ACCESSORS
    // ============================================================

    function safeGetStudents() {
        return typeof window.getStudents === 'function' ? window.getStudents() : [];
    }

    function safeGetInstructors() {
        return typeof window.getInstructors === 'function' ? window.getInstructors() : [];
    }

    // ============================================================
    // AUTO-GROUPS HTML
    // ============================================================

    function getAutoGroupsHTML() {
        return `
            <div class="page-header">
                <h2>■ Auto-Groups</h2>
                <div class="header-actions">
                    <span style="font-size:0.7rem;color:var(--text-dim);">Groups auto-created from Discipline + Instructor</span>
                    <button id="refresh-auto-groups-btn" class="small secondary">↻ Refresh View</button>
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
            <div id="groups-container">
                <p class="empty-state">No groups created yet. Groups are auto-created when students are assigned to classes.</p>
            </div>
        `;
    }

    // ============================================================
    // POPULATE GROUP FILTERS
    // ============================================================

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
            var exists = Array.from(disciplineSelect.options).some(function(opt) {
                return opt.value === currentValue;
            });
            disciplineSelect.value = exists ? currentValue : 'all';
        }

        if (instructorSelect) {
            var instructors = safeGetInstructors();
            var currentValue = instructorSelect.value;
            instructorSelect.innerHTML = '<option value="all">All Instructors</option>';
            instructors.forEach(function(c) {
                var name = typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(c)
                    : (c.name || 'Unknown');
                var option = document.createElement('option');
                option.value = c.id;
                option.textContent = name;
                instructorSelect.appendChild(option);
            });
            var exists = Array.from(instructorSelect.options).some(function(opt) {
                return opt.value === currentValue;
            });
            instructorSelect.value = exists ? currentValue : 'all';
        }
    }

    // ============================================================
    // RENDER GROUPS - Main rendering function
    // ============================================================

    function renderGroups() {
        var container = document.getElementById('groups-container');
        if (!container) return;

        var disciplineFilter = document.getElementById('group-filter-discipline') ? 
            document.getElementById('group-filter-discipline').value : 'all';
        var instructorFilter = document.getElementById('group-filter-instructor') ? 
            document.getElementById('group-filter-instructor').value : 'all';

        var groups = window.getAllAutoGroups ? window.getAllAutoGroups() : {};
        var groupKeys = Object.keys(groups);

        if (disciplineFilter !== 'all') {
            groupKeys = groupKeys.filter(function(key) {
                return groups[key] && String(groups[key].disciplineId) === String(disciplineFilter);
            });
        }
        if (instructorFilter !== 'all') {
            groupKeys = groupKeys.filter(function(key) {
                return groups[key] && String(groups[key].instructorId) === String(instructorFilter);
            });
        }

        if (groupKeys.length === 0) {
            container.innerHTML = '<p class="empty-state">No groups found. Groups are auto-created when students are assigned to classes with the same discipline and instructor.</p>';
            return;
        }

        groupKeys.sort(function(a, b) {
            return (groups[a].displayName || a).localeCompare(groups[b].displayName || b);
        });

        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var html = '<div style="display:flex;flex-direction:column;gap:12px;">';

        groupKeys.forEach(function(key) {
            var group = groups[key];
            if (!group) return;

            var discipline = window.getDiscipline(group.disciplineId);
            var instructor = window.getCharacterById(group.instructorId);
            var instructorName = instructor ? (typeof window.getDisplayName === 'function'
                ? window.getDisplayName(instructor)
                : (instructor.name || 'Unknown')) : 'Unknown';
            var studentCount = group.students ? group.students.length : 0;
            var slotCount = group.slots ? group.slots.length : 0;
            var isExpanded = expandedGroups[key] || false;

            var safeDisplayName = escapeHtml(group.displayName || 'Unknown Group');
            var safeInstructorName = escapeHtml(instructorName);
            var safeDisciplineName = discipline ? escapeHtml(discipline.name) : 'Unknown';

            html += '<div class="auto-group-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
            html += '<div style="cursor:pointer;" data-group-key="' + escapeHtml(key) + '" class="group-toggle">';
            html += '<strong style="color:var(--accent);">' + safeDisplayName + '</strong>';
            html += ' <span style="color:var(--text-dim);font-size:0.75rem;">(' + studentCount + ' students, ' + slotCount + ' slots)</span>';
            html += '</div>';
            html += '<div style="display:flex;align-items:center;gap:8px;">';
            html += '<span style="font-size:0.7rem;color:var(--text-dim);cursor:pointer;" class="group-toggle" data-group-key="' + escapeHtml(key) + '">' + (isExpanded ? '▾' : '▸') + '</span>';
            html += '</div>';
            html += '</div>';

            if (isExpanded) {
                html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-soft);">';

                html += '<div style="margin-bottom:8px;font-size:0.75rem;color:var(--text-dim);">';
                html += 'Instructor: <strong>' + safeInstructorName + '</strong>';
                html += ' | Discipline: <strong>' + safeDisciplineName + '</strong>';
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
                        var labelDisplay = slot.label ? ' [' + escapeHtml(slot.label) + ']' : '';
                        var safeDayName = escapeHtml(dayNames[slot.day] || 'Unknown');
                        html += '<span style="background:var(--bg);padding:2px 8px;border-radius:10px;font-size:0.7rem;margin:2px;display:inline-block;border:1px solid var(--border-soft);">';
                        html += 'Week ' + slot.week + ' - ' + safeDayName + ' ' + hourDisplay + ':00 ' + ampm + durationDisplay + labelDisplay;
                        html += ' <button class="remove-slot-from-group small" data-key="' + escapeHtml(key) + '" data-week="' + slot.week + '" data-day="' + slot.day + '" data-hour="' + slot.hour + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;">✕</button>';
                        html += '</span>';
                    });
                    html += '</div>';
                }

                if (group.students && group.students.length > 0) {
                    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">';
                    html += '<span style="font-size:0.7rem;color:var(--text-dim);">Students:</span> ';
                    group.students.forEach(function(id) {
                        var student = window.getCharacterById(id);
                        var name = student ? (typeof window.getDisplayName === 'function'
                            ? window.getDisplayName(student)
                            : (student.name || 'Unknown')) : 'Unknown';
                        html += '<span class="student-tag" style="background:var(--bg);padding:2px 10px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);">' + escapeHtml(name);
                        html += ' <button class="remove-from-group-btn small" data-key="' + escapeHtml(key) + '" data-student="' + escapeHtml(id) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;">✕</button>';
                        html += '</span>';
                    });
                    html += '</div>';
                } else {
                    html += '<div style="color:var(--text-dim);font-size:0.75rem;margin-bottom:8px;">No students in this group</div>';
                }

                // Add student
                html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px;background:var(--warning-soft);border-radius:4px;border:1px solid var(--warning);">';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">⚠ Add student to this group and assign them to <strong>all</strong> scheduled class times:</span>';
                html += '<select class="add-student-to-group-select" data-key="' + escapeHtml(key) + '" style="flex:1;min-width:120px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:0.7rem;">';
                html += '<option value="">Select student...</option>';

                var allStudents = safeGetStudents();
                var currentStudentIds = group.students || [];
                allStudents.forEach(function(s) {
                    if (currentStudentIds.indexOf(s.id) === -1) {
                        var name = typeof window.getDisplayName === 'function'
                            ? window.getDisplayName(s)
                            : (s.name || 'Unknown');
                        html += '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(name) + '</option>';
                    }
                });
                html += '</select>';
                html += '<button class="add-student-to-group-btn small primary" data-key="' + escapeHtml(key) + '">Add to Group</button>';
                html += '</div>';

                // Add slot
                html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px;background:var(--danger-soft);border-radius:4px;border:1px solid var(--danger);">';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">⚠ Add class time to group' + 
                    (studentCount > 0 ? ' and to <strong>all ' + studentCount + ' student(s)</strong> in this group' : '') + ':</span>';
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
                html += '<button class="add-slot-to-group-btn small primary" data-key="' + escapeHtml(key) + '">Add Time</button>';
                html += '</div>';

                html += '</div>';
            }

            html += '</div>';
        });

        html += '</div>';
        container.innerHTML = html;

        attachGroupEventListeners();
    }

    // ============================================================
    // ATTACH GROUP EVENT LISTENERS
    // ============================================================

    function attachGroupEventListeners() {
        var container = document.getElementById('groups-container');
        if (!container) return;

        container.querySelectorAll('.group-toggle').forEach(function(el) {
            el.addEventListener('click', function() {
                var key = this.dataset.groupKey;
                if (key) {
                    toggleAutoGroup(key);
                }
            });
        });

        container.querySelectorAll('.remove-from-group-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var key = this.dataset.key;
                var studentId = this.dataset.student;

                var group = window.getGroupByKey ? window.getGroupByKey(key) : null;
                var student = window.getCharacterById(studentId);
                var name = student ? (typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(student)
                    : (student.name || 'Unknown')) : 'Unknown';

                if (!confirm(
                    'Remove "' + name + '" from this group?\n\n' +
                    'This will remove them from ALL classes associated with this group.\n' +
                    (group && group.slots && group.slots.length > 0 ? 
                        'Slots: ' + group.slots.map(function(s) {
                            return 'W' + s.week + ' D' + s.day + ' H' + s.hour;
                        }).join(', ') : 
                        'No slots assigned') +
                    '\n\nContinue?'
                )) return;

                var result = window.removeStudentFromGroup(key, studentId);
                if (result && result.success) {
                    refreshGroupsView();
                    if (typeof window.renderStudentScheduleView === 'function') {
                        window.renderStudentScheduleView();
                    } else if (typeof window.renderStudentSchedule === 'function') {
                        window.renderStudentSchedule();
                    }
                    if (typeof window.renderInstructorCalendar === 'function') {
                        window.renderInstructorCalendar();
                    }
                    
                    if (typeof window.saveData === 'function') {
                        window.saveData()
                            .then(function() {
                                showNotification('Removed ' + name + ' from group.', 'success');
                            })
                            .catch(function(err) {
                                console.error('Failed to save group change:', err);
                                showNotification('Group updated in memory, but persistence failed.', 'error');
                            });
                    } else {
                        showNotification('Removed ' + name + ' from group.', 'success');
                    }
                } else {
                    showNotification(result && result.message ? result.message : 'Failed to remove student from group.', 'error');
                }
            });
        });

        container.querySelectorAll('.add-student-to-group-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var key = this.dataset.key;
                var parent = this.parentElement;
                var select = parent.querySelector('.add-student-to-group-select');
                var studentId = select ? select.value : null;

                if (!studentId) {
                    showNotification('Please select a student.', 'error');
                    return;
                }

                var student = window.getCharacterById(studentId);
                var name = student ? (typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(student)
                    : (student.name || 'Unknown')) : 'Unknown';

                if (!confirm(
                    'Add "' + name + '" to this group?\n\n' +
                    'This will assign them to ALL classes associated with this group.\n' +
                    'The student will be added to every time slot in this group.\n\n' +
                    'Continue?'
                )) return;

                var result = window.addStudentToGroup(key, studentId);
                if (result && result.success) {
                    refreshGroupsView();
                    if (typeof window.renderStudentScheduleView === 'function') {
                        window.renderStudentScheduleView();
                    } else if (typeof window.renderStudentSchedule === 'function') {
                        window.renderStudentSchedule();
                    }
                    if (typeof window.renderInstructorCalendar === 'function') {
                        window.renderInstructorCalendar();
                    }

                    var msg = 'Added ' + name + ' to group.';
                    if (result.conflictStudents && result.conflictStudents.length > 0) {
                        msg += '\n\nCould not add ' + result.conflictStudents.join(', ') + ' due to conflicts.';
                    }

                    if (typeof window.saveData === 'function') {
                        window.saveData()
                            .then(function() {
                                showNotification(msg, 'success');
                            })
                            .catch(function(err) {
                                console.error('Failed to save group change:', err);
                                showNotification('Group updated in memory, but persistence failed.', 'error');
                            });
                    } else {
                        showNotification(msg, 'success');
                    }
                } else {
                    showNotification(result && result.message ? result.message : 'Failed to add student.', 'error');
                }
            });
        });

        container.querySelectorAll('.remove-slot-from-group').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var key = this.dataset.key;
                var week = parseInt(this.dataset.week);
                var day = parseInt(this.dataset.day);
                var hour = parseInt(this.dataset.hour);

                var group = window.getGroupByKey ? window.getGroupByKey(key) : null;
                var studentCount = group && group.students ? group.students.length : 0;

                if (!confirm(
                    'Remove this class time from the group?\n\n' +
                    'Week ' + week + ', Day ' + day + ', Hour ' + hour + '\n' +
                    'This will remove the slot from ' + studentCount + ' student schedule(s).\n\n' +
                    'Continue?'
                )) return;

                var result = window.removeSlotFromGroup(key, week, day, hour);
                if (result && result.success) {
                    refreshGroupsView();
                    if (typeof window.renderStudentScheduleView === 'function') {
                        window.renderStudentScheduleView();
                    } else if (typeof window.renderStudentSchedule === 'function') {
                        window.renderStudentSchedule();
                    }
                    if (typeof window.renderInstructorCalendar === 'function') {
                        window.renderInstructorCalendar();
                    }

                    if (typeof window.saveData === 'function') {
                        window.saveData()
                            .then(function() {
                                showNotification('Class time removed from group.', 'success');
                            })
                            .catch(function(err) {
                                console.error('Failed to save group change:', err);
                                showNotification('Group updated in memory, but persistence failed.', 'error');
                            });
                    } else {
                        showNotification('Class time removed from group.', 'success');
                    }
                } else {
                    showNotification(result && result.message ? result.message : 'Failed to remove class time.', 'error');
                }
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

                var group = window.getGroupByKey ? window.getGroupByKey(key) : null;
                var studentCount = group && group.students ? group.students.length : 0;

                var confirmMsg = 'Add this class time to the group?\n\n' +
                    'Week ' + week + ', Day ' + day + ', Hour ' + hour + '\n' +
                    'Duration: ' + duration + 'h' + (label ? ' Label: ' + label : '');
                
                if (studentCount > 0) {
                    confirmMsg += '\n\nThis will add the slot to ' + studentCount + ' student schedule(s).';
                }
                confirmMsg += '\n\nContinue?';

                if (!confirm(confirmMsg)) return;

                var result = window.addSlotToGroup(key, week, day, hour, duration, label);
                if (result && result.success) {
                    refreshGroupsView();
                    if (typeof window.renderStudentScheduleView === 'function') {
                        window.renderStudentScheduleView();
                    } else if (typeof window.renderStudentSchedule === 'function') {
                        window.renderStudentSchedule();
                    }
                    if (typeof window.renderInstructorCalendar === 'function') {
                        window.renderInstructorCalendar();
                    }

                    var msg = 'Added class time to group. ' + (result.addedCount || 0) + ' student(s) added.';
                    if (result.conflictStudents && result.conflictStudents.length > 0) {
                        msg += '\n\nCould not add these students due to conflicts:\n' + result.conflictStudents.join('\n');
                    }

                    if (typeof window.saveData === 'function') {
                        window.saveData()
                            .then(function() {
                                showNotification(msg, 'success');
                            })
                            .catch(function(err) {
                                console.error('Failed to save group change:', err);
                                showNotification('Group updated in memory, but persistence failed.', 'error');
                            });
                    } else {
                        showNotification(msg, 'success');
                    }
                } else {
                    showNotification(result && result.message ? result.message : 'Failed to add class time.', 'error');
                }
            });
        });
    }

    // ============================================================
    // TOGGLE AUTO GROUP
    // ============================================================

    function toggleAutoGroup(key) {
        if (expandedGroups[key]) {
            delete expandedGroups[key];
        } else {
            expandedGroups[key] = true;
        }
        renderGroups();
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
            console.log('[Groups]', message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initAutoGroupsEvents() {
        var refreshBtn = document.getElementById('refresh-auto-groups-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                refreshGroupsView();
            });
        }

        var rebuildBtn = document.getElementById('rebuild-auto-groups-btn');
        if (rebuildBtn) {
            rebuildBtn.addEventListener('click', function() {
                if (!confirm(
                    'Rebuild all groups from existing schedules?\n\n' +
                    'Existing auto-groups will be replaced using the current schedules.\n' +
                    'Any manually added group slots or relationships that are not\n' +
                    'represented in schedules will be lost.\n\n' +
                    'Continue?'
                )) return;

                var result = window.rebuildGroupsFromSchedules();
                if (result && result.success) {
                    refreshGroupsView();
                    
                    if (typeof window.saveData === 'function') {
                        window.saveData()
                            .then(function() {
                                showNotification('Groups rebuilt successfully! ' + (result.count || 0) + ' groups created.', 'success');
                            })
                            .catch(function(err) {
                                console.error('Failed to save rebuilt groups:', err);
                                showNotification('Groups rebuilt in memory, but persistence failed.', 'error');
                            });
                    } else {
                        showNotification('Groups rebuilt successfully! ' + (result.count || 0) + ' groups created.', 'success');
                    }
                } else {
                    showNotification(result && result.message ? result.message : 'Failed to rebuild groups.', 'error');
                }
            });
        }

        var disciplineFilter = document.getElementById('group-filter-discipline');
        if (disciplineFilter) {
            disciplineFilter.addEventListener('change', function() {
                renderGroups();
            });
        }

        var instructorFilter = document.getElementById('group-filter-instructor');
        if (instructorFilter) {
            instructorFilter.addEventListener('change', function() {
                renderGroups();
            });
        }
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderAutoGroupsView = renderAutoGroupsView;
    window.refreshGroupsView = refreshGroupsView;

})();
