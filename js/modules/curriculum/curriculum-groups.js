/**
 * js/core/curriculum/curriculum-groups.js - Auto-Group Operations
 * Path: js/core/curriculum/curriculum-groups.js
 * 
 * This module provides auto-group CRUD operations.
 * Groups are created from Discipline + Instructor combinations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Groups are stored in curriculum.autoGroups
 *   - Student schedules are the canonical source of truth for assignments
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumGroupsLoaded) {
        return;
    }
    window.__curriculumGroupsLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function parseSafeInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isSafeInteger(num) ? num : null;
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
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
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

    function getStudents() {
        if (typeof window.getStudents === 'function') {
            return window.getStudents();
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }
        return data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') {
                return false;
            }
            if (c.deceased) {
                return false;
            }
            var status = getStudentStatus(c);
            return status === 'trainee' || status === 'rookie' || status === 'junior';
        });
    }

    function getStudentStatus(char) {
        if (typeof window.getCurrentStatus === 'function') {
            var status = window.getCurrentStatus(char);
            return typeof status === 'string' ? status.toLowerCase() : '';
        }
        return '';
    }

    function getInstructors() {
        if (typeof window.getInstructors === 'function') {
            return window.getInstructors();
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }
        return data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') {
                return false;
            }
            if (c.deceased) {
                return false;
            }
            var status = getStudentStatus(c);
            return status === 'instructor' || status === 'teacher' ||
                status === 'professor' || status === 'senior';
        });
    }

    function isCurrentStudent(studentId) {
        var students = getStudents();
        return students.some(function(s) {
            return String(s.id) === String(studentId);
        });
    }

    function isCurrentInstructor(instructorId) {
        var instructors = getInstructors();
        return instructors.some(function(i) {
            return String(i.id) === String(instructorId);
        });
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateDay(value) {
        var num = parseSafeInteger(value);
        return num !== null && num >= 1 && num <= 7 ? num : null;
    }

    function validateHour(value) {
        var num = parseSafeInteger(value);
        return num !== null && num >= 0 && num <= 23 ? num : null;
    }

    function validateDuration(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 4 ? num : null;
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumGroups: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumGroups: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // METADATA CONSTANTS
    // ============================================================

    var METADATA_KEYS = ['classInstructors', 'classLabels', 'classGroupLabels', 'classDurations'];
    var AUTO_GROUP_LABEL = 'auto-group';

    // ============================================================
    // METADATA HELPERS
    // ============================================================

    function buildMetadataCandidates(curriculum) {
        var metadata = {};
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            var source = curriculum && curriculum[key] ? curriculum[key] : {};
            var cloned = deepClone(source);
            if (cloned === null) {
                console.error('CurriculumGroups: Failed to clone metadata store: ' + key);
                return null;
            }
            metadata[key] = cloned;
        }
        return metadata;
    }

    function commitMetadataCandidates(curriculum, metadataCandidates) {
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            curriculum[key] = metadataCandidates[key];
        }
    }

    function getClassMetadata(metadata, studentId, week, day, hour) {
        var key = getScheduleKey(studentId, week, day, hour);
        var duration = validateDuration(metadata.classDurations && metadata.classDurations[key]);
        if (duration === null) {
            return null;
        }
        return {
            key: key,
            instructorId: metadata.classInstructors ? metadata.classInstructors[key] : null,
            label: metadata.classLabels ? metadata.classLabels[key] || '' : '',
            groupLabel: metadata.classGroupLabels ? metadata.classGroupLabels[key] : null,
            duration: duration
        };
    }

    function matchesGroupClass(schedule, metadata, studentId, week, day, hour, group, expectedDuration) {
        if (!schedule || !schedule[day]) {
            return false;
        }
        if (String(schedule[day][hour]) !== String(group.disciplineId)) {
            return false;
        }
        var meta = getClassMetadata(metadata, studentId, week, day, hour);
        if (!meta) {
            return false;
        }
        if (meta.groupLabel !== AUTO_GROUP_LABEL) {
            return false;
        }
        if (String(meta.instructorId) !== String(group.instructorId)) {
            return false;
        }
        if (expectedDuration !== undefined && meta.duration !== expectedDuration) {
            return false;
        }
        return true;
    }

    function isAutoGroupClass(metadata, studentId, week, day, hour) {
        var key = getScheduleKey(studentId, week, day, hour);
        if (metadata && metadata.classGroupLabels) {
            return metadata.classGroupLabels[key] === AUTO_GROUP_LABEL;
        }
        return false;
    }

    function slotsOverlap(slot1, slot2) {
        if (slot1.week !== slot2.week) {
            return false;
        }
        if (slot1.day !== slot2.day) {
            return false;
        }
        var s1Start = slot1.hour;
        var s1End = slot1.hour + slot1.duration;
        var s2Start = slot2.hour;
        var s2End = slot2.hour + slot2.duration;
        return s1Start < s2End && s2Start < s1End;
    }

    function hasSlotOverlap(newSlot, existingSlots) {
        for (var i = 0; i < existingSlots.length; i++) {
            if (slotsOverlap(newSlot, existingSlots[i])) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // GROUP QUERIES
    // ============================================================

    function getAllAutoGroups() {
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.autoGroups) {
            return {};
        }
        var cloned = deepClone(data.curriculum.autoGroups);
        return cloned || {};
    }

    function getAutoGroup(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        var groups = getAllAutoGroups();
        return groups[key] || null;
    }

    function getGroupsByDiscipline(disciplineId) {
        var groups = getAllAutoGroups();
        var result = {};
        for (var key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) {
                continue;
            }
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
            if (!Object.prototype.hasOwnProperty.call(groups, key)) {
                continue;
            }
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
        disciplineId = String(disciplineId);
        instructorId = String(instructorId);

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        if (!isCurrentInstructor(instructorId)) {
            return failure('Instructor not found or not an instructor.');
        }

        var instructor = getCharacterById(instructorId);
        if (!instructor) {
            return failure('Instructor not found.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var groupKey = disciplineId + '_' + instructorId;

        if (data.curriculum.autoGroups && data.curriculum.autoGroups[groupKey]) {
            return failure('Group already exists for this discipline and instructor.');
        }

        var instructorName = getDisplayName(instructor);
        var shortInstructor = instructorName;
        var parts = instructorName.split(' ');

        if (parts.length >= 2) {
            shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
        }

        var newGroup = {
            id: groupKey,
            disciplineId: disciplineId,
            instructorId: instructorId,
            displayName: discipline.name + ' (' + shortInstructor + ')',
            students: [],
            slots: [],
            createdAt: new Date().toISOString()
        };

        var resultGroup = deepClone(newGroup);
        if (resultGroup === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        candidateGroups[groupKey] = newGroup;
        data.curriculum.autoGroups = candidateGroups;

        logActivity('Created auto-group: ' + newGroup.displayName);
        return { success: true, group: resultGroup };
    }

    function deleteAutoGroup(key) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];
        var displayName = group.displayName || key;
        var students = Array.isArray(group.students) ? group.students : [];
        var slots = Array.isArray(group.slots) ? group.slots : [];

        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        // Remove students from schedules
        if (students.length > 0 && slots.length > 0) {
            for (var i = 0; i < slots.length; i++) {
                var slot = slots[i];
                var weekNum = validateWeek(slot.week);
                if (weekNum === null) {
                    continue;
                }
                var duration = validateDuration(slot.duration);
                if (duration === null) {
                    continue;
                }

                for (var s = 0; s < students.length; s++) {
                    var studentId = students[s];
                    var schedule = candidateSchedules[studentId];
                    if (!schedule || !schedule[weekNum]) {
                        continue;
                    }
                    var weekSchedule = schedule[weekNum];
                    var day = slot.day;
                    var startHour = slot.hour;

                    if (!matchesGroupClass(weekSchedule, metadataCandidates, studentId, weekNum, day, startHour, group, duration)) {
                        continue;
                    }

                    for (var h = startHour; h < startHour + duration && h <= 23; h++) {
                        if (weekSchedule[day] && weekSchedule[day][h] === group.disciplineId) {
                            delete weekSchedule[day][h];
                        }
                    }

                    var key2 = getScheduleKey(studentId, weekNum, day, startHour);
                    delete metadataCandidates.classInstructors[key2];
                    delete metadataCandidates.classLabels[key2];
                    delete metadataCandidates.classGroupLabels[key2];
                    delete metadataCandidates.classDurations[key2];
                }
            }
        }

        delete candidateGroups[key];

        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Deleted auto-group: ' + displayName);
        return { success: true };
    }

    // ============================================================
    // STUDENT MANAGEMENT
    // ============================================================

    function addStudentToGroup(key, studentId, options) {
        options = options || {};

        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        studentId = String(studentId);

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        if (!isCurrentStudent(studentId)) {
            return failure('Student not found or not a current student.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];

        if (group.students && group.students.some(function(id) { return String(id) === studentId; })) {
            return failure('Student already in this group.');
        }

        var slots = Array.isArray(group.slots) ? group.slots : [];
        var student = getCharacterById(studentId);
        if (!student) {
            return failure('Student not found.');
        }

        // Check for conflicts
        var conflicts = [];
        var schedules = data.curriculum.schedules || {};
        var metadataCandidates = buildMetadataCandidates(data.curriculum);

        if (slots.length > 0 && metadataCandidates) {
            for (var i = 0; i < slots.length; i++) {
                var slot = slots[i];
                var weekNum = validateWeek(slot.week);
                if (weekNum === null) {
                    continue;
                }
                var duration = validateDuration(slot.duration);
                if (duration === null) {
                    continue;
                }

                var studentSchedule = schedules[studentId];
                if (!studentSchedule || !studentSchedule[weekNum]) {
                    continue;
                }
                var weekSchedule = studentSchedule[weekNum];
                var day = slot.day;
                var hour = slot.hour;

                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (weekSchedule[day] && weekSchedule[day][h]) {
                        conflicts.push({
                            week: weekNum,
                            day: day,
                            hour: h,
                            startHour: hour,
                            duration: duration,
                            existingDiscipline: weekSchedule[day][h]
                        });
                        break;
                    }
                }
            }
        }

        if (conflicts.length > 0 && !options.confirmed) {
            return {
                success: false,
                message: 'Student has schedule conflicts.',
                conflicts: conflicts,
                requiresConfirmation: true
            };
        }

        // Build candidates
        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidatesClone = buildMetadataCandidates(data.curriculum);
        if (metadataCandidatesClone === null) {
            return failure('Failed to prepare metadata data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        // Clear conflicts if confirmed
        if (options.confirmed) {
            for (var i = 0; i < conflicts.length; i++) {
                var conflict = conflicts[i];
                var weekNum = conflict.week;
                var day = conflict.day;
                var startHour = conflict.startHour;
                var duration = conflict.duration;

                var studentSchedule = candidateSchedules[studentId];
                if (!studentSchedule || !studentSchedule[weekNum]) {
                    continue;
                }
                var weekSchedule = studentSchedule[weekNum];

                for (var h = startHour; h < startHour + duration && h <= 23; h++) {
                    if (weekSchedule[day] && weekSchedule[day][h] === conflict.existingDiscipline) {
                        delete weekSchedule[day][h];
                    }
                }

                var key3 = getScheduleKey(studentId, weekNum, day, startHour);
                delete metadataCandidatesClone.classInstructors[key3];
                delete metadataCandidatesClone.classLabels[key3];
                delete metadataCandidatesClone.classGroupLabels[key3];
                delete metadataCandidatesClone.classDurations[key3];
            }
        }

        // Assign student to all slots
        var assignedCount = 0;

        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            var weekNum = validateWeek(slot.week);
            if (weekNum === null) {
                continue;
            }
            var duration = validateDuration(slot.duration);
            if (duration === null) {
                continue;
            }

            if (!candidateSchedules[studentId]) {
                candidateSchedules[studentId] = {};
            }
            if (!candidateSchedules[studentId][weekNum]) {
                candidateSchedules[studentId][weekNum] = {};
            }

            var weekSchedule = candidateSchedules[studentId][weekNum];
            var day = slot.day;
            var hour = slot.hour;

            if (!weekSchedule[day]) {
                weekSchedule[day] = {};
            }

            for (var h = hour; h < hour + duration && h <= 23; h++) {
                weekSchedule[day][h] = group.disciplineId;
            }

            var key4 = getScheduleKey(studentId, weekNum, day, hour);
            metadataCandidatesClone.classInstructors[key4] = group.instructorId;
            metadataCandidatesClone.classGroupLabels[key4] = AUTO_GROUP_LABEL;
            metadataCandidatesClone.classDurations[key4] = duration;

            if (slot.label) {
                metadataCandidatesClone.classLabels[key4] = slot.label;
            } else {
                delete metadataCandidatesClone.classLabels[key4];
            }

            assignedCount++;
        }

        // Add student to group
        if (!Array.isArray(candidateGroup.students)) {
            candidateGroup.students = [];
        }
        candidateGroup.students.push(studentId);
        candidateGroup.students.sort();

        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidatesClone);

        var studentName = getDisplayName(student);
        logActivity('Added ' + studentName + ' to group: ' + group.displayName);

        return {
            success: true,
            message: 'Student added to group.',
            conflictCount: conflicts.length,
            assignedCount: assignedCount
        };
    }

    function removeStudentFromGroup(key, studentId) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        studentId = String(studentId);

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];

        if (!Array.isArray(group.students)) {
            return failure('Group has no students.');
        }

        if (!group.students.some(function(id) { return String(id) === studentId; })) {
            return failure('Student not in this group.');
        }

        var slots = Array.isArray(group.slots) ? group.slots : [];
        var student = getCharacterById(studentId);
        var studentName = student ? getDisplayName(student) : 'Unknown';

        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        // Remove student from all slots
        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            var weekNum = validateWeek(slot.week);
            if (weekNum === null) {
                continue;
            }
            var duration = validateDuration(slot.duration);
            if (duration === null) {
                continue;
            }

            var studentSchedule = candidateSchedules[studentId];
            if (!studentSchedule || !studentSchedule[weekNum]) {
                continue;
            }
            var weekSchedule = studentSchedule[weekNum];
            var day = slot.day;
            var startHour = slot.hour;

            if (!matchesGroupClass(weekSchedule, metadataCandidates, studentId, weekNum, day, startHour, group, duration)) {
                continue;
            }

            for (var h = startHour; h < startHour + duration && h <= 23; h++) {
                if (weekSchedule[day] && weekSchedule[day][h] === group.disciplineId) {
                    delete weekSchedule[day][h];
                }
            }

            var key2 = getScheduleKey(studentId, weekNum, day, startHour);
            delete metadataCandidates.classInstructors[key2];
            delete metadataCandidates.classLabels[key2];
            delete metadataCandidates.classGroupLabels[key2];
            delete metadataCandidates.classDurations[key2];
        }

        // Remove student from group
        candidateGroup.students = candidateGroup.students.filter(function(id) {
            return String(id) !== studentId;
        });

        var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
        var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;

        if (!hasStudents && !hasSlots) {
            delete candidateGroups[key];
        }

        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Removed ' + studentName + ' from group: ' + group.displayName);
        return { success: true };
    }

    // ============================================================
    // SLOT MANAGEMENT
    // ============================================================

    function addSlotToGroup(key, week, day, hour, duration, label) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (hourNum + durationNum > 24) {
            return failure('Class duration extends beyond the end of the day.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];
        var students = Array.isArray(group.students) ? group.students : [];

        // Check for overlap
        var newSlot = {
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            label: label || ''
        };

        if (hasSlotOverlap(newSlot, group.slots)) {
            return failure('Slot overlaps with an existing slot in this group.');
        }

        // Check for conflicts
        var conflictStudents = [];
        var schedules = data.curriculum.schedules || {};
        var metadataCandidates = buildMetadataCandidates(data.curriculum);

        for (var i = 0; i < students.length; i++) {
            var studentId = students[i];
            var studentSchedule = schedules[studentId];
            if (!studentSchedule || !studentSchedule[weekNum]) {
                continue;
            }
            var weekSchedule = studentSchedule[weekNum];
            var hasConflict = false;

            for (var h = hourNum; h < hourNum + durationNum && h <= 23; h++) {
                if (weekSchedule[dayNum] && weekSchedule[dayNum][h]) {
                    hasConflict = true;
                    break;
                }
            }

            if (hasConflict) {
                var student = getCharacterById(studentId);
                conflictStudents.push(student ? getDisplayName(student) : 'Unknown');
            }
        }

        if (conflictStudents.length > 0) {
            return {
                success: false,
                message: 'Some students have schedule conflicts.',
                conflictStudents: conflictStudents
            };
        }

        // Build candidates
        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidatesClone = buildMetadataCandidates(data.curriculum);
        if (metadataCandidatesClone === null) {
            return failure('Failed to prepare metadata data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        // Add slot
        if (!Array.isArray(candidateGroup.slots)) {
            candidateGroup.slots = [];
        }

        candidateGroup.slots.push(newSlot);
        candidateGroup.slots.sort(function(a, b) {
            if (a.week !== b.week) return a.week - b.week;
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        // Assign to all students
        var addedCount = 0;

        for (var i = 0; i < students.length; i++) {
            var studentId = students[i];
            var studentSchedule = candidateSchedules[studentId];
            if (!studentSchedule) {
                studentSchedule = {};
                candidateSchedules[studentId] = studentSchedule;
            }
            if (!studentSchedule[weekNum]) {
                studentSchedule[weekNum] = {};
            }
            var weekSchedule = studentSchedule[weekNum];

            if (!weekSchedule[dayNum]) {
                weekSchedule[dayNum] = {};
            }

            for (var h = hourNum; h < hourNum + durationNum && h <= 23; h++) {
                weekSchedule[dayNum][h] = group.disciplineId;
            }

            var key2 = getScheduleKey(studentId, weekNum, dayNum, hourNum);
            metadataCandidatesClone.classInstructors[key2] = group.instructorId;
            metadataCandidatesClone.classGroupLabels[key2] = AUTO_GROUP_LABEL;
            metadataCandidatesClone.classDurations[key2] = durationNum;

            if (label) {
                metadataCandidatesClone.classLabels[key2] = label;
            } else {
                delete metadataCandidatesClone.classLabels[key2];
            }

            addedCount++;
        }

        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidatesClone);

        logActivity('Added slot to group: ' + group.displayName);
        return {
            success: true,
            addedCount: addedCount,
            conflictStudents: conflictStudents
        };
    }

    function removeSlotFromGroup(key, week, day, hour) {
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];

        if (!Array.isArray(group.slots)) {
            return failure('Group has no slots.');
        }

        var slotIndex = -1;
        var slotData = null;

        for (var i = 0; i < group.slots.length; i++) {
            var s = group.slots[i];
            if (s.week === weekNum && s.day === dayNum && s.hour === hourNum) {
                slotIndex = i;
                slotData = s;
                break;
            }
        }

        if (slotIndex === -1) {
            return failure('Slot not found in group.');
        }

        var duration = validateDuration(slotData.duration);
        if (duration === null) {
            return failure('Group contains an invalid slot duration.');
        }

        var students = Array.isArray(group.students) ? group.students : [];

        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        // Remove from all students
        for (var i = 0; i < students.length; i++) {
            var studentId = students[i];
            var studentSchedule = candidateSchedules[studentId];
            if (!studentSchedule || !studentSchedule[weekNum]) {
                continue;
            }
            var weekSchedule = studentSchedule[weekNum];
            var startHour = hourNum;

            if (!matchesGroupClass(weekSchedule, metadataCandidates, studentId, weekNum, dayNum, startHour, group, duration)) {
                continue;
            }

            for (var h = startHour; h < startHour + duration && h <= 23; h++) {
                if (weekSchedule[dayNum] && weekSchedule[dayNum][h] === group.disciplineId) {
                    delete weekSchedule[dayNum][h];
                }
            }

            var key2 = getScheduleKey(studentId, weekNum, dayNum, startHour);
            delete metadataCandidates.classInstructors[key2];
            delete metadataCandidates.classLabels[key2];
            delete metadataCandidates.classGroupLabels[key2];
            delete metadataCandidates.classDurations[key2];
        }

        // Remove slot
        candidateGroup.slots.splice(slotIndex, 1);

        var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
        var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;

        if (!hasStudents && !hasSlots) {
            delete candidateGroups[key];
        }

        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Removed slot from group: ' + group.displayName);
        return { success: true };
    }

    // ============================================================
    // REBUILD GROUPS
    // ============================================================

    function rebuildGroupsFromSchedules() {
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var newGroups = {};
        var count = 0;
        var overlapErrors = [];

        var students = getStudents();
        if (!Array.isArray(students)) {
            students = [];
        }

        var schedules = data.curriculum.schedules || {};

        // Collect class instances
        var classInstances = {};

        for (var s = 0; s < students.length; s++) {
            var student = students[s];
            var studentId = student.id;
            var studentSchedules = schedules[studentId] || {};

            for (var week in studentSchedules) {
                if (!Object.prototype.hasOwnProperty.call(studentSchedules, week)) {
                    continue;
                }

                var weekNum = parseInt(week, 10);
                if (isNaN(weekNum)) {
                    continue;
                }

                var weekSchedule = studentSchedules[week];
                if (!isObject(weekSchedule)) {
                    continue;
                }

                for (var day in weekSchedule) {
                    if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) {
                        continue;
                    }

                    var dayNum = parseInt(day, 10);
                    if (isNaN(dayNum)) {
                        continue;
                    }

                    var daySchedule = weekSchedule[day];
                    if (!isObject(daySchedule)) {
                        continue;
                    }

                    for (var hour in daySchedule) {
                        if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                            continue;
                        }

                        var hourNum = parseInt(hour, 10);
                        if (isNaN(hourNum)) {
                            continue;
                        }

                        var disciplineId = daySchedule[hourNum];
                        if (!disciplineId) {
                            continue;
                        }

                        var startKey = getScheduleKey(studentId, weekNum, dayNum, hourNum);
                        var duration = validateDuration(metadataCandidates.classDurations && metadataCandidates.classDurations[startKey]);

                        if (duration === null) {
                            continue;
                        }

                        if (!isAutoGroupClass(metadataCandidates, studentId, weekNum, dayNum, hourNum)) {
                            continue;
                        }

                        var instructorId = null;
                        if (metadataCandidates.classInstructors) {
                            instructorId = metadataCandidates.classInstructors[startKey];
                        }

                        if (!instructorId) {
                            continue;
                        }

                        var groupKey = String(disciplineId) + '_' + String(instructorId);

                        if (!classInstances[groupKey]) {
                            classInstances[groupKey] = {
                                disciplineId: String(disciplineId),
                                instructorId: String(instructorId),
                                slots: [],
                                studentClasses: {}
                            };
                        }

                        var group = classInstances[groupKey];

                        var newSlot = {
                            week: weekNum,
                            day: dayNum,
                            hour: hourNum,
                            duration: duration
                        };

                        var slotExists = group.slots.some(function(existingSlot) {
                            return existingSlot.week === weekNum &&
                                existingSlot.day === dayNum &&
                                existingSlot.hour === hourNum &&
                                existingSlot.duration === duration;
                        });

                        if (!slotExists) {
                            if (hasSlotOverlap(newSlot, group.slots)) {
                                overlapErrors.push({
                                    groupKey: groupKey,
                                    studentId: studentId,
                                    week: weekNum,
                                    day: dayNum,
                                    hour: hourNum,
                                    duration: duration
                                });
                            } else {
                                group.slots.push(newSlot);
                                group.slots.sort(function(a, b) {
                                    if (a.week !== b.week) return a.week - b.week;
                                    if (a.day !== b.day) return a.day - b.day;
                                    return a.hour - b.hour;
                                });
                            }
                        }

                        var slotKey2 = weekNum + '_' + dayNum + '_' + hourNum + '_' + duration;
                        if (!group.studentClasses[studentId]) {
                            group.studentClasses[studentId] = {};
                        }
                        group.studentClasses[studentId][slotKey2] = true;
                    }
                }
            }
        }

        if (overlapErrors.length > 0) {
            return {
                success: false,
                message: 'Cannot rebuild groups: schedule data contains overlapping auto-group classes.',
                overlaps: overlapErrors,
                overlapCount: overlapErrors.length
            };
        }

        // Build groups
        for (var groupKey in classInstances) {
            if (!Object.prototype.hasOwnProperty.call(classInstances, groupKey)) {
                continue;
            }

            var instance = classInstances[groupKey];
            var slots = instance.slots;

            var validStudents = [];
            var studentIds = Object.keys(instance.studentClasses);

            for (var i = 0; i < studentIds.length; i++) {
                var studentId = studentIds[i];
                var hasAllSlots = true;

                for (var j = 0; j < slots.length; j++) {
                    var slot = slots[j];
                    var slotKey3 = slot.week + '_' + slot.day + '_' + slot.hour + '_' + slot.duration;

                    if (!instance.studentClasses[studentId] || !instance.studentClasses[studentId][slotKey3]) {
                        hasAllSlots = false;
                        break;
                    }
                }

                if (hasAllSlots) {
                    validStudents.push(studentId);
                }
            }

            if (validStudents.length === 0) {
                continue;
            }

            var discipline = getDiscipline(instance.disciplineId);
            var instructor = getCharacterById(instance.instructorId);
            var disciplineName = discipline ? discipline.name : 'Unknown';
            var instructorName = instructor ? getDisplayName(instructor) : 'Unknown';

            var shortInstructor = instructorName;
            var parts = instructorName.split(' ');

            if (parts.length >= 2) {
                shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
            }

            var group = {
                id: groupKey,
                disciplineId: instance.disciplineId,
                instructorId: instance.instructorId,
                displayName: disciplineName + ' (' + shortInstructor + ')',
                students: validStudents,
                slots: slots.slice(),
                createdAt: new Date().toISOString()
            };

            newGroups[groupKey] = group;
            count++;
        }

        var candidate = deepClone(newGroups);
        if (candidate === null) {
            return failure('Failed to prepare group data.');
        }

        data.curriculum.autoGroups = candidate;

        logActivity('Rebuilt groups from schedules: ' + count + ' groups created');
        return { success: true, count: count };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Queries
    window.getAllAutoGroups = getAllAutoGroups;
    window.getAutoGroup = getAutoGroup;
    window.getGroupsByDiscipline = getGroupsByDiscipline;
    window.getGroupsByInstructor = getGroupsByInstructor;
    window.getGroupStudents = getGroupStudents;
    window.getGroupSlots = getGroupSlots;
    window.getGroupStudentCount = getGroupStudentCount;
    window.getGroupSlotCount = getGroupSlotCount;
    window.isStudentInGroup = isStudentInGroup;

    // Mutations
    window.createAutoGroup = createAutoGroup;
    window.deleteAutoGroup = deleteAutoGroup;
    window.addStudentToGroup = addStudentToGroup;
    window.removeStudentFromGroup = removeStudentFromGroup;
    window.addSlotToGroup = addSlotToGroup;
    window.removeSlotFromGroup = removeSlotFromGroup;
    window.rebuildGroupsFromSchedules = rebuildGroupsFromSchedules;

})();
