/**
 * core/group-core.js - Auto-Group Core Operations
 * Single source of truth for all auto-group related data mutations
 * Path: js/core/group-core.js
 * 
 * This module handles:
 *   - Auto-group CRUD (create, read, update, delete)
 *   - Student assignment to groups (with conflict detection)
 *   - Slot management (add/remove class times)
 *   - Group rebuild from schedules
 *   - Group filtering and queries
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 * 
 * PERSISTENCE CONTRACT:
 *   - Mutations are applied to window.data in memory
 *   - Caller is responsible for saveData() persistence
 *   - No rollback is provided after mutation begins
 * 
 * GROUP SEMANTICS:
 *   - Groups are auto-created from Discipline + Instructor combinations
 *   - A group has a disciplineId, instructorId, displayName
 *   - Students in a group are assigned to ALL slots in the group
 *   - Slots are (week, day, hour, duration, label)
 *   - Adding a student to a group assigns them to all slots
 *   - Removing a student removes them from all slots
 *   - Groups are stored in curriculum.autoGroups
 *   - Group key = disciplineId + '_' + instructorId
 *   - Groups can be rebuilt from schedules if they become out of sync
 */

(function() {
    'use strict';

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
    }

    function getDiscipline(id) {
        if (typeof window.getDiscipline === 'function') {
            return window.getDiscipline(id);
        }
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        return data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        }) || null;
    }

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
    }

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        if (char && char.firstName) {
            return char.firstName + (char.lastName ? ' ' + char.lastName : '');
        }
        return 'Unknown';
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateDay(value) {
        return isSafeInteger(value) && value >= 1 && value <= 7;
    }

    function validateHour(value) {
        return isSafeInteger(value) && value >= 0 && value <= 23;
    }

    function validateDuration(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 4 ? num : null;
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function ensureGroupStructure() {
        var data = getDataStore();
        if (!data) return null;

        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }

        if (!data.curriculum.autoGroups || typeof data.curriculum.autoGroups !== 'object') {
            data.curriculum.autoGroups = {};
        }

        if (!data.curriculum.schedules || typeof data.curriculum.schedules !== 'object') {
            data.curriculum.schedules = {};
        }

        if (!data.curriculum.classInstructors || typeof data.curriculum.classInstructors !== 'object') {
            data.curriculum.classInstructors = {};
        }

        if (!data.curriculum.classLabels || typeof data.curriculum.classLabels !== 'object') {
            data.curriculum.classLabels = {};
        }

        if (!data.curriculum.classGroupLabels || typeof data.curriculum.classGroupLabels !== 'object') {
            data.curriculum.classGroupLabels = {};
        }

        if (!data.curriculum.classDurations || typeof data.curriculum.classDurations !== 'object') {
            data.curriculum.classDurations = {};
        }

        return data;
    }

    // ============================================================
    // GROUP QUERIES
    // ============================================================

    function getAllAutoGroups() {
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.autoGroups) {
            return {};
        }
        return data.curriculum.autoGroups;
    }

    function getAutoGroup(key) {
        var groups = getAllAutoGroups();
        return groups[key] || null;
    }

    function getGroupsByDiscipline(disciplineId) {
        var groups = getAllAutoGroups();
        var result = {};

        for (var key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
            var group = groups[key];
            if (group && String(group.disciplineId) === String(disciplineId)) {
                result[key] = group;
            }
        }

        return result;
    }

    function getGroupsByInstructor(instructorId) {
        var groups = getAllAutoGroups();
        var result = {};

        for (var key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
            var group = groups[key];
            if (group && String(group.instructorId) === String(instructorId)) {
                result[key] = group;
            }
        }

        return result;
    }

    function getGroupStudents(key) {
        var group = getAutoGroup(key);
        if (!group || !Array.isArray(group.students)) {
            return [];
        }
        return group.students.slice();
    }

    function getGroupSlots(key) {
        var group = getAutoGroup(key);
        if (!group || !Array.isArray(group.slots)) {
            return [];
        }
        return group.slots.slice();
    }

    function getGroupStudentCount(key) {
        return getGroupStudents(key).length;
    }

    function getGroupSlotCount(key) {
        return getGroupSlots(key).length;
    }

    function isStudentInGroup(key, studentId) {
        var students = getGroupStudents(key);
        return students.some(function(id) {
            return String(id) === String(studentId);
        });
    }

    // ============================================================
    // GROUP MUTATIONS
    // ============================================================

    function createAutoGroup(disciplineId, instructorId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(disciplineId)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        if (!isNonEmptyString(instructorId)) {
            return { success: false, message: 'Instructor ID is required.' };
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return { success: false, message: 'Discipline not found.' };
        }

        var instructor = getCharacterById(instructorId);
        if (!instructor) {
            return { success: false, message: 'Instructor not found.' };
        }

        // ---- PHASE 2: CHECK EXISTING ----
        var store = ensureGroupStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var groupKey = disciplineId + '_' + instructorId;

        if (store.curriculum.autoGroups[groupKey]) {
            return { success: false, message: 'Group already exists for this discipline and instructor.' };
        }

        // ---- PHASE 3: BUILD GROUP ----
        var instructorName = getDisplayName(instructor);
        var shortInstructor = instructorName;
        var parts = instructorName.split(' ');
        if (parts.length >= 2) {
            shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
        }

        var group = {
            id: groupKey,
            disciplineId: disciplineId,
            instructorId: instructorId,
            displayName: discipline.name + ' (' + shortInstructor + ')',
            students: [],
            slots: [],
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 4: APPLY ----
        store.curriculum.autoGroups[groupKey] = group;

        logActivity('Created auto-group: ' + group.displayName);
        return { success: true, group: group };
    }

    function deleteAutoGroup(key) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var store = getDataStore();
        if (!store || !store.curriculum || !store.curriculum.autoGroups) {
            return { success: false, message: 'No groups found.' };
        }

        var group = store.curriculum.autoGroups[key];
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        var displayName = group.displayName || key;
        var students = Array.isArray(group.students) ? group.students : [];
        var slots = Array.isArray(group.slots) ? group.slots : [];

        // ---- PHASE 3: REMOVE STUDENTS FROM SCHEDULES ----
        if (students.length > 0 && slots.length > 0) {
            slots.forEach(function(slot) {
                var weekNum = validateWeek(slot.week);
                if (weekNum === null) return;

                students.forEach(function(studentId) {
                    var schedule = getStudentSchedule(studentId, weekNum);
                    if (!schedule) return;

                    var day = slot.day;
                    var hour = slot.hour;
                    var duration = slot.duration || 1;

                    for (var h = hour; h < hour + duration && h <= 23; h++) {
                        if (schedule[day] && schedule[day][h] === group.disciplineId) {
                            delete schedule[day][h];
                        }
                    }

                    var key2 = getScheduleKey(studentId, weekNum, day, hour);
                    delete store.curriculum.classInstructors[key2];
                    delete store.curriculum.classLabels[key2];
                    delete store.curriculum.classGroupLabels[key2];
                    delete store.curriculum.classDurations[key2];
                });
            });
        }

        // ---- PHASE 4: DELETE ----
        delete store.curriculum.autoGroups[key];

        logActivity('Deleted auto-group: ' + displayName);
        return { success: true };
    }

    // ============================================================
    // STUDENT MANAGEMENT
    // ============================================================

    function addStudentToGroup(key, studentId, options) {
        options = options || {};

        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }

        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        var student = getCharacterById(studentId);
        if (!student) {
            return { success: false, message: 'Student not found.' };
        }

        if (!Array.isArray(group.students)) {
            group.students = [];
        }

        if (group.students.indexOf(studentId) !== -1) {
            return { success: false, message: 'Student already in this group.' };
        }

        // ---- PHASE 2: CHECK CONFLICTS ----
        var slots = Array.isArray(group.slots) ? group.slots : [];
        var conflicts = [];

        if (slots.length > 0) {
            slots.forEach(function(slot) {
                var weekNum = validateWeek(slot.week);
                if (weekNum === null) return;

                var schedule = getStudentSchedule(studentId, weekNum);
                if (!schedule) return;

                var day = slot.day;
                var hour = slot.hour;
                var duration = slot.duration || 1;

                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (schedule[day] && schedule[day][h]) {
                        conflicts.push({
                            week: weekNum,
                            day: day,
                            hour: h,
                            existingDiscipline: schedule[day][h]
                        });
                        break;
                    }
                }
            });
        }

        // ---- PHASE 3: HANDLE CONFLICTS ----
        if (conflicts.length > 0 && !options.confirmed) {
            return {
                success: false,
                message: 'Student has schedule conflicts.',
                conflicts: conflicts,
                requiresConfirmation: true
            };
        }

        // ---- PHASE 4: APPLY (with conflict resolution if confirmed) ----
        var store = ensureGroupStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        // Clear conflicts if confirmed
        if (options.confirmed) {
            slots.forEach(function(slot) {
                var weekNum = validateWeek(slot.week);
                if (weekNum === null) return;

                var schedule = getStudentSchedule(studentId, weekNum);
                if (!schedule) return;

                var day = slot.day;
                var hour = slot.hour;
                var duration = slot.duration || 1;

                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (schedule[day] && schedule[day][h]) {
                        delete schedule[day][h];
                        var key2 = getScheduleKey(studentId, weekNum, day, h);
                        delete store.curriculum.classInstructors[key2];
                        delete store.curriculum.classLabels[key2];
                        delete store.curriculum.classGroupLabels[key2];
                        delete store.curriculum.classDurations[key2];
                    }
                }
            });
        }

        // Assign student to all slots
        slots.forEach(function(slot) {
            var weekNum = validateWeek(slot.week);
            if (weekNum === null) return;

            var schedule = getStudentSchedule(studentId, weekNum);
            if (!schedule) return;

            var day = slot.day;
            var hour = slot.hour;
            var duration = slot.duration || 1;

            if (!schedule[day]) schedule[day] = {};

            for (var h = hour; h < hour + duration && h <= 23; h++) {
                schedule[day][h] = group.disciplineId;
            }

            var key2 = getScheduleKey(studentId, weekNum, day, hour);

            if (group.instructorId) {
                store.curriculum.classInstructors[key2] = group.instructorId;
            }

            if (slot.label) {
                store.curriculum.classLabels[key2] = slot.label;
            }

            store.curriculum.classGroupLabels[key2] = 'auto-group';

            if (slot.duration) {
                store.curriculum.classDurations[key2] = slot.duration;
            }
        });

        // Add student to group
        group.students.push(studentId);
        group.students.sort();

        var studentName = getDisplayName(student);
        logActivity('Added ' + studentName + ' to group: ' + group.displayName);

        return {
            success: true,
            message: 'Student added to group.',
            conflictCount: conflicts.length
        };
    }

    function removeStudentFromGroup(key, studentId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }

        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        if (!Array.isArray(group.students)) {
            return { success: false, message: 'Group has no students.' };
        }

        if (group.students.indexOf(studentId) === -1) {
            return { success: false, message: 'Student not in this group.' };
        }

        // ---- PHASE 2: REMOVE FROM SCHEDULES ----
        var store = ensureGroupStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var slots = Array.isArray(group.slots) ? group.slots : [];
        var studentName = 'Unknown';
        var student = getCharacterById(studentId);
        if (student) studentName = getDisplayName(student);

        slots.forEach(function(slot) {
            var weekNum = validateWeek(slot.week);
            if (weekNum === null) return;

            var schedule = getStudentSchedule(studentId, weekNum);
            if (!schedule) return;

            var day = slot.day;
            var hour = slot.hour;
            var duration = slot.duration || 1;

            for (var h = hour; h < hour + duration && h <= 23; h++) {
                if (schedule[day] && schedule[day][h] === group.disciplineId) {
                    delete schedule[day][h];
                }
            }

            var key2 = getScheduleKey(studentId, weekNum, day, hour);
            delete store.curriculum.classInstructors[key2];
            delete store.curriculum.classLabels[key2];
            delete store.curriculum.classGroupLabels[key2];
            delete store.curriculum.classDurations[key2];
        });

        // ---- PHASE 3: REMOVE FROM GROUP ----
        group.students = group.students.filter(function(id) {
            return String(id) !== String(studentId);
        });

        // Clean up empty groups
        var hasStudents = group.students.length > 0;
        var hasSlots = group.slots && group.slots.length > 0;

        if (!hasStudents && !hasSlots) {
            delete store.curriculum.autoGroups[key];
        }

        logActivity('Removed ' + studentName + ' from group: ' + group.displayName);
        return { success: true };
    }

    // ============================================================
    // SLOT MANAGEMENT
    // ============================================================

    function addSlotToGroup(key, week, day, hour, duration, label) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!validateDay(day)) {
            return { success: false, message: 'Valid day is required (1-7).' };
        }

        if (!validateHour(hour)) {
            return { success: false, message: 'Valid hour is required (0-23).' };
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return { success: false, message: 'Duration must be between 1 and 4 hours.' };
        }

        if (hour + durationNum > 24) {
            return { success: false, message: 'Class duration extends beyond the end of the day.' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        if (!Array.isArray(group.slots)) {
            group.slots = [];
        }

        // Check if slot already exists
        var slotExists = group.slots.some(function(s) {
            return s.week === weekNum && s.day === day && s.hour === hour;
        });

        if (slotExists) {
            return { success: false, message: 'Slot already exists in this group.' };
        }

        // ---- PHASE 2: APPLY TO STUDENTS ----
        var store = ensureGroupStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        // Add slot to group
        var newSlot = {
            week: weekNum,
            day: day,
            hour: hour,
            duration: durationNum,
            label: label || ''
        };

        group.slots.push(newSlot);
        group.slots.sort(function(a, b) {
            if (a.week !== b.week) return a.week - b.week;
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        // Assign to existing students
        var addedCount = 0;
        var conflictStudents = [];

        if (Array.isArray(group.students) && group.students.length > 0) {
            group.students.forEach(function(studentId) {
                var schedule = getStudentSchedule(studentId, weekNum);
                if (!schedule) return;

                var hasConflict = false;
                for (var h = hour; h < hour + durationNum && h <= 23; h++) {
                    if (schedule[day] && schedule[day][h]) {
                        hasConflict = true;
                        break;
                    }
                }

                if (hasConflict) {
                    var student = getCharacterById(studentId);
                    conflictStudents.push(student ? getDisplayName(student) : 'Unknown');
                } else {
                    if (!schedule[day]) schedule[day] = {};

                    for (var h = hour; h < hour + durationNum && h <= 23; h++) {
                        schedule[day][h] = group.disciplineId;
                    }

                    var key2 = getScheduleKey(studentId, weekNum, day, hour);

                    if (group.instructorId) {
                        store.curriculum.classInstructors[key2] = group.instructorId;
                    }

                    if (label) {
                        store.curriculum.classLabels[key2] = label;
                    }

                    store.curriculum.classGroupLabels[key2] = 'auto-group';
                    store.curriculum.classDurations[key2] = durationNum;

                    addedCount++;
                }
            });
        }

        logActivity('Added slot to group: ' + group.displayName);

        return {
            success: true,
            addedCount: addedCount,
            conflictStudents: conflictStudents
        };
    }

    function removeSlotFromGroup(key, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return { success: false, message: 'Group key is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!validateDay(day)) {
            return { success: false, message: 'Valid day is required (1-7).' };
        }

        if (!validateHour(hour)) {
            return { success: false, message: 'Valid hour is required (0-23).' };
        }

        var group = getAutoGroup(key);
        if (!group) {
            return { success: false, message: 'Group not found.' };
        }

        if (!Array.isArray(group.slots)) {
            return { success: false, message: 'Group has no slots.' };
        }

        // Find slot
        var slotIndex = -1;
        var slotData = null;

        for (var i = 0; i < group.slots.length; i++) {
            var s = group.slots[i];
            if (s.week === weekNum && s.day === day && s.hour === hour) {
                slotIndex = i;
                slotData = s;
                break;
            }
        }

        if (slotIndex === -1) {
            return { success: false, message: 'Slot not found in group.' };
        }

        // ---- PHASE 2: REMOVE FROM STUDENTS ----
        var store = ensureGroupStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var students = Array.isArray(group.students) ? group.students : [];
        var duration = slotData.duration || 1;

        students.forEach(function(studentId) {
            var schedule = getStudentSchedule(studentId, weekNum);
            if (!schedule) return;

            for (var h = hour; h < hour + duration && h <= 23; h++) {
                if (schedule[day] && schedule[day][h] === group.disciplineId) {
                    delete schedule[day][h];
                }
            }

            var key2 = getScheduleKey(studentId, weekNum, day, hour);
            delete store.curriculum.classInstructors[key2];
            delete store.curriculum.classLabels[key2];
            delete store.curriculum.classGroupLabels[key2];
            delete store.curriculum.classDurations[key2];
        });

        // ---- PHASE 3: REMOVE FROM GROUP ----
        group.slots.splice(slotIndex, 1);

        // Clean up empty groups
        var hasStudents = group.students && group.students.length > 0;
        var hasSlots = group.slots && group.slots.length > 0;

        if (!hasStudents && !hasSlots) {
            delete store.curriculum.autoGroups[key];
        }

        logActivity('Removed slot from group: ' + group.displayName);
        return { success: true };
    }

    // ============================================================
    // GROUP REBUILD
    // ============================================================

    function rebuildGroupsFromSchedules() {
        // ---- PHASE 1: RETRIEVE ----
        var store = ensureGroupStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var newGroups = {};
        var count = 0;

        var students = getStudents();
        if (!Array.isArray(students)) students = [];

        // ---- PHASE 2: SCAN SCHEDULES ----
        students.forEach(function(student) {
            var studentId = student.id;
            var schedule = store.curriculum.schedules ? store.curriculum.schedules[studentId] : null;
            if (!schedule || !isObject(schedule)) return;

            for (var week in schedule) {
                if (!Object.prototype.hasOwnProperty.call(schedule, week)) continue;

                var weekNum = parseInt(week, 10);
                if (isNaN(weekNum)) continue;

                var weekSchedule = schedule[weekNum];
                if (!isObject(weekSchedule)) continue;

                for (var day in weekSchedule) {
                    if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) continue;

                    var dayNum = parseInt(day, 10);
                    if (isNaN(dayNum)) continue;

                    var daySchedule = weekSchedule[dayNum];
                    if (!isObject(daySchedule)) continue;

                    for (var hour in daySchedule) {
                        if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;

                        var hourNum = parseInt(hour, 10);
                        if (isNaN(hourNum)) continue;

                        var disciplineId = daySchedule[hourNum];
                        if (!disciplineId) continue;

                        // Find class start
                        var classInfo = findClassStart(store, studentId, weekNum, dayNum, hourNum);
                        if (!classInfo) continue;

                        // Only process the start hour
                        if (classInfo.startHour !== hourNum) continue;

                        // Get instructor
                        var instructorId = null;
                        var key = getScheduleKey(studentId, weekNum, dayNum, classInfo.startHour);

                        if (store.curriculum.classInstructors) {
                            instructorId = store.curriculum.classInstructors[key];
                        }

                        if (!instructorId) continue;

                        // Build group key
                        var groupKey = disciplineId + '_' + instructorId;

                        if (!newGroups[groupKey]) {
                            var discipline = getDiscipline(disciplineId);
                            var instructor = getCharacterById(instructorId);
                            var disciplineName = discipline ? discipline.name : 'Unknown';
                            var instructorName = instructor ? getDisplayName(instructor) : 'Unknown';

                            var shortInstructor = instructorName;
                            var parts = instructorName.split(' ');
                            if (parts.length >= 2) {
                                shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
                            }

                            newGroups[groupKey] = {
                                id: groupKey,
                                disciplineId: disciplineId,
                                instructorId: instructorId,
                                displayName: disciplineName + ' (' + shortInstructor + ')',
                                students: [],
                                slots: [],
                                createdAt: new Date().toISOString()
                            };
                            count++;
                        }

                        var group = newGroups[groupKey];

                        // Add student
                        if (group.students.indexOf(studentId) === -1) {
                            group.students.push(studentId);
                            group.students.sort();
                        }

                        // Add slot
                        var slotExists = group.slots.some(function(s) {
                            return s.week === weekNum && s.day === dayNum && s.hour === classInfo.startHour;
                        });

                        if (!slotExists) {
                            var label = null;
                            var labelKey = getScheduleKey(studentId, weekNum, dayNum, classInfo.startHour);

                            if (store.curriculum.classLabels) {
                                label = store.curriculum.classLabels[labelKey] || '';
                            }

                            group.slots.push({
                                week: weekNum,
                                day: dayNum,
                                hour: classInfo.startHour,
                                duration: classInfo.duration || 1,
                                label: label || ''
                            });

                            // Sort slots
                            group.slots.sort(function(a, b) {
                                if (a.week !== b.week) return a.week - b.week;
                                if (a.day !== b.day) return a.day - b.day;
                                return a.hour - b.hour;
                            });
                        }
                    }
                }
            }
        });

        // ---- PHASE 3: REPLACE GROUPS ----
        store.curriculum.autoGroups = newGroups;

        logActivity('Rebuilt groups from schedules: ' + count + ' groups created');
        return { success: true, count: count };
    }

    function findClassStart(store, studentId, week, day, hour) {
        if (!store || !store.curriculum || !store.curriculum.schedules) return null;
        if (!store.curriculum.schedules[studentId]) return null;
        if (!store.curriculum.schedules[studentId][week]) return null;

        var schedule = store.curriculum.schedules[studentId][week];
        if (!schedule[day]) return null;

        var disciplineId = schedule[day][hour];
        if (!disciplineId) return null;

        // Find start
        var startHour = hour;
        while (startHour > 0 && schedule[day][startHour - 1] === disciplineId) {
            startHour--;
        }

        // Get duration
        var key = getScheduleKey(studentId, week, day, startHour);
        var duration = store.curriculum.classDurations ? store.curriculum.classDurations[key] : null;

        if (!duration) {
            var endHour = startHour;
            while (endHour < 23 && schedule[day][endHour + 1] === disciplineId) {
                endHour++;
            }
            duration = endHour - startHour + 1;
        }

        return {
            startHour: startHour,
            duration: duration,
            disciplineId: disciplineId
        };
    }

    // ============================================================
    // STUDENT HELPERS
    // ============================================================

    function getStudents() {
        if (typeof window.getStudents === 'function') {
            return window.getStudents();
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return [];

        return data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') return false;
            if (c.deceased) return false;

            var status = getStudentStatus(c);
            return status === 'trainee' || status === 'rookie' || status === 'junior';
        });
    }

    function getStudentStatus(char) {
        if (typeof window.getCurrentStatus === 'function') {
            var status = window.getCurrentStatus(char);
            return status.toLowerCase();
        }
        return '';
    }

    // ============================================================
    // SCHEDULE HELPERS
    // ============================================================

    function getStudentSchedule(studentId, week) {
        if (typeof window.getStudentSchedule === 'function') {
            return window.getStudentSchedule(studentId, week);
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) return {};

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.schedules) return {};

        var studentSchedule = data.curriculum.schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) return {};

        return studentSchedule[weekNum];
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.GroupCore = {
        // Queries
        getAllAutoGroups: getAllAutoGroups,
        getAutoGroup: getAutoGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getGroupStudents: getGroupStudents,
        getGroupSlots: getGroupSlots,
        getGroupStudentCount: getGroupStudentCount,
        getGroupSlotCount: getGroupSlotCount,
        isStudentInGroup: isStudentInGroup,

        // Mutations
        createAutoGroup: createAutoGroup,
        deleteAutoGroup: deleteAutoGroup,
        addStudentToGroup: addStudentToGroup,
        removeStudentFromGroup: removeStudentFromGroup,
        addSlotToGroup: addSlotToGroup,
        removeSlotFromGroup: removeSlotFromGroup,
        rebuildGroupsFromSchedules: rebuildGroupsFromSchedules,

        // Helpers
        findClassStart: findClassStart
    };

})();
