/**
 * shared/queries/calendar-queries.js - Calendar Queries
 * Read-only calendar/scheduling queries
 * Path: js/shared/queries/calendar-queries.js
 * 
 * This module provides READ-ONLY access to calendar/schedule data.
 * All mutations go through schedule-core.js
 * 
 * OWNERSHIP: Calendar domain
 * DEPENDENCIES: ScheduleCore, CharacterQueries, DisciplineQueries, LocationQueries
 * 
 * IMPORTANT: This module is a read facade for scheduling data.
 * It does NOT perform mutations.
 */

(function() {
    'use strict';

    if (window.__calendarQueriesLoaded) return;
    window.__calendarQueriesLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var ScheduleCore = window.ScheduleCore;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var LocationQueries = window.LocationQueries;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parseInteger(value) {
        if (value === undefined || value === null || value === '') return null;
        var num = Number(value);
        return Number.isInteger(num) ? num : null;
    }

    // ============================================================
    // STUDENT SCHEDULE QUERIES
    // ============================================================

    function getStudentSchedule(studentId, week) {
        return ScheduleCore.getStudentSchedule(studentId, week);
    }

    function getStudentRestDays(studentId, week) {
        return ScheduleCore.getStudentRestDays(studentId, week);
    }

    function getSlotMetadata(studentId, week, day, hour) {
        return ScheduleCore.getSlotMetadata(studentId, week, day, hour);
    }

    function getClassDetails(studentId, week, day, hour) {
        var schedule = getStudentSchedule(studentId, week);
        var weekNum = parseInteger(week);
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return null;
        }

        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        var metadata = getSlotMetadata(studentId, weekNum, dayNum, hourNum);

        var instructorId = metadata ? metadata.instructorId : null;
        var instructor = instructorId ? CharacterQueries.getCharacterById(instructorId) : null;

        return {
            studentId: studentId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: metadata ? metadata.duration || 1 : 1,
            disciplineId: disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            instructorId: instructorId,
            instructorName: instructor ? CharacterQueries.getDisplayName(instructor) : 'Not assigned',
            label: metadata ? metadata.label || '' : '',
            groupLabel: metadata ? metadata.groupLabel || '' : '',
            locationId: metadata ? metadata.locationId : null,
            isContinuation: false
        };
    }

    function getStudentClasses(studentId, week) {
        var schedule = getStudentSchedule(studentId, week);
        var weekNum = parseInteger(week);
        if (weekNum === null) return [];

        var classes = [];
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var dayNum = parseInteger(day);
            if (dayNum === null) continue;

            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var hourNum = parseInteger(hour);
                if (hourNum === null) continue;

                var details = getClassDetails(studentId, weekNum, dayNum, hourNum);
                if (details) {
                    classes.push(details);
                }
            }
        }

        classes.sort(function(a, b) {
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        return classes;
    }

    function getStudentWeeklyUsage(studentId, week) {
        var classes = getStudentClasses(studentId, week);
        var total = 0;
        var byDiscipline = {};

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            total += cls.duration || 1;
            var id = cls.disciplineId;
            if (!byDiscipline[id]) {
                byDiscipline[id] = {
                    disciplineId: id,
                    disciplineName: cls.disciplineName,
                    hours: 0
                };
            }
            byDiscipline[id].hours += cls.duration || 1;
        }

        return { total: total, byDiscipline: byDiscipline };
    }

    // ============================================================
    // INSTRUCTOR SCHEDULE QUERIES
    // ============================================================

    function getInstructorSchedule(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) return {};

        var students = CharacterQueries.getStudents() || [];
        var schedule = {};

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var studentSchedule = getStudentSchedule(student.id, weekNum);

            for (var day in studentSchedule) {
                if (!Object.prototype.hasOwnProperty.call(studentSchedule, day)) continue;
                var dayNum = parseInteger(day);
                if (dayNum === null) continue;

                var daySchedule = studentSchedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') continue;

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                    var hourNum = parseInteger(hour);
                    if (hourNum === null) continue;

                    var disciplineId = daySchedule[hour];
                    if (!disciplineId) continue;

                    var metadata = getSlotMetadata(student.id, weekNum, dayNum, hourNum);
                    if (!metadata || String(metadata.instructorId) !== String(instructorId)) continue;

                    if (!schedule[dayNum]) schedule[dayNum] = {};
                    if (!schedule[dayNum][hourNum]) {
                        schedule[dayNum][hourNum] = {
                            students: [],
                            disciplineId: disciplineId,
                            duration: metadata.duration || 1,
                            label: metadata.label || '',
                            groupLabel: metadata.groupLabel || ''
                        };
                    }

                    var studentEntry = {
                        studentId: student.id,
                        studentName: CharacterQueries.getDisplayName(student),
                        groupLabel: metadata.groupLabel || null
                    };

                    var exists = false;
                    for (var s = 0; s < schedule[dayNum][hourNum].students.length; s++) {
                        if (String(schedule[dayNum][hourNum].students[s].studentId) === String(student.id)) {
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        schedule[dayNum][hourNum].students.push(studentEntry);
                    }
                }
            }
        }

        return schedule;
    }

    function getInstructorTemplates(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) return {};

        var curriculum = window.data && window.data.curriculum ? window.data.curriculum : {};
        var templates = curriculum.instructorTemplates || {};
        var instructorTemplates = templates[instructorId] || {};
        return instructorTemplates[weekNum] || {};
    }

    function getInstructorBlocks(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) return {};

        var curriculum = window.data && window.data.curriculum ? window.data.curriculum : {};
        var blocks = curriculum.instructorBlocks || {};
        var instructorBlocks = blocks[instructorId] || {};
        return instructorBlocks[weekNum] || {};
    }

    function getAssignedStudents(instructorId, week, day, hour) {
        var weekNum = parseInteger(week);
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);

        if (weekNum === null || dayNum === null || hourNum === null || !isNonEmptyString(instructorId)) {
            return [];
        }

        var schedule = getInstructorSchedule(instructorId, weekNum);
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) return [];

        return schedule[dayNum][hourNum].students || [];
    }

    function getInstructorAvailableDisciplines(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) return [];

        var allDisciplines = DisciplineQueries.getAvailableDisciplines(weekNum) || [];
        var available = [];

        for (var i = 0; i < allDisciplines.length; i++) {
            var d = allDisciplines[i];
            if (!d) continue;

            if (d.instructorIds) {
                for (var j = 0; j < d.instructorIds.length; j++) {
                    if (String(d.instructorIds[j]) === String(instructorId)) {
                        available.push({
                            id: d.id,
                            name: d.name,
                            label: d.name,
                            subtitle: 'Available',
                            weeklyHours: d.weeklyHours || 0
                        });
                        break;
                    }
                }
            }
        }
        return available;
    }

    // ============================================================
    // LOCATION SCHEDULE QUERIES
    // ============================================================

    function getLocationSchedule(locationId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || !isNonEmptyString(locationId)) return {};

        var students = CharacterQueries.getStudents() || [];
        var schedule = {};

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var studentSchedule = getStudentSchedule(student.id, weekNum);

            for (var day in studentSchedule) {
                if (!Object.prototype.hasOwnProperty.call(studentSchedule, day)) continue;
                var dayNum = parseInteger(day);
                if (dayNum === null) continue;

                var daySchedule = studentSchedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') continue;

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                    var hourNum = parseInteger(hour);
                    if (hourNum === null) continue;

                    var metadata = getSlotMetadata(student.id, weekNum, dayNum, hourNum);
                    if (!metadata || String(metadata.locationId) !== String(locationId)) continue;

                    if (!schedule[dayNum]) schedule[dayNum] = {};
                    if (!schedule[dayNum][hourNum]) {
                        schedule[dayNum][hourNum] = {
                            students: [],
                            disciplineId: daySchedule[hour],
                            duration: metadata.duration || 1,
                            label: metadata.label || '',
                            groupLabel: metadata.groupLabel || ''
                        };
                    }

                    var studentEntry = {
                        studentId: student.id,
                        studentName: CharacterQueries.getDisplayName(student),
                        groupLabel: metadata.groupLabel || null
                    };

                    var exists = false;
                    for (var s = 0; s < schedule[dayNum][hourNum].students.length; s++) {
                        if (String(schedule[dayNum][hourNum].students[s].studentId) === String(student.id)) {
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        schedule[dayNum][hourNum].students.push(studentEntry);
                    }
                }
            }
        }

        return schedule;
    }

    function getLocationClassDetails(locationId, week, day, hour) {
        var weekNum = parseInteger(week);
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);

        if (weekNum === null || dayNum === null || hourNum === null || !isNonEmptyString(locationId)) {
            return null;
        }

        var schedule = getLocationSchedule(locationId, weekNum);
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) return null;

        var slot = schedule[dayNum][hourNum];
        var discipline = DisciplineQueries.getDiscipline(slot.disciplineId);

        return {
            locationId: locationId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            disciplineId: slot.disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            duration: slot.duration || 1,
            label: slot.label || '',
            groupLabel: slot.groupLabel || '',
            studentCount: slot.students ? slot.students.length : 0
        };
    }

    function getStudentsAtLocation(locationId, week, day, hour) {
        var weekNum = parseInteger(week);
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);

        if (weekNum === null || dayNum === null || hourNum === null || !isNonEmptyString(locationId)) {
            return [];
        }

        var schedule = getLocationSchedule(locationId, weekNum);
        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) return [];

        return schedule[dayNum][hourNum].students || [];
    }

    function getLocationUsage(locationId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || !isNonEmptyString(locationId)) {
            return { totalSlots: 0, totalStudents: 0, daysWithClasses: 0 };
        }

        var schedule = getLocationSchedule(locationId, weekNum);
        var totalSlots = 0;
        var totalStudents = 0;
        var daysWithClasses = 0;
        var days = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var dayNum = parseInteger(day);
            if (dayNum === null) continue;

            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            var daySlots = 0;
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var slot = daySchedule[hour];
                if (!slot) continue;

                totalSlots++;
                daySlots++;
                if (slot.students) {
                    totalStudents += slot.students.length;
                }
            }

            if (daySlots > 0) {
                days[dayNum] = true;
            }
        }

        daysWithClasses = Object.keys(days).length;

        return {
            totalSlots: totalSlots,
            totalStudents: totalStudents,
            daysWithClasses: daysWithClasses
        };
    }

    function getLocationDisciplineAvailability(locationId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || !isNonEmptyString(locationId)) return [];

        var schedule = getLocationSchedule(locationId, weekNum);
        var disciplines = DisciplineQueries.getAvailableDisciplines(weekNum) || [];
        var usageCount = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') continue;

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                var slot = daySchedule[hour];
                if (!slot || !slot.disciplineId) continue;

                usageCount[slot.disciplineId] = (usageCount[slot.disciplineId] || 0) + 1;
            }
        }

        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d) continue;

            var canHost = true;
            if (d.locationIds) {
                canHost = false;
                for (var j = 0; j < d.locationIds.length; j++) {
                    if (String(d.locationIds[j]) === String(locationId)) {
                        canHost = true;
                        break;
                    }
                }
            }

            var usedCount = usageCount[d.id] || 0;
            var maxSlots = d.maxSlotsPerLocation || 0;
            var available = maxSlots === 0 || usedCount < maxSlots;

            result.push({
                id: d.id,
                name: d.name,
                label: d.name,
                usedCount: usedCount,
                maxSlots: maxSlots,
                available: available && canHost,
                canHost: canHost,
                weeklyHours: d.weeklyHours || 0
            });
        }
        return result;
    }

    // ============================================================
    // CONFLICT DETECTION
    // ============================================================

    function hasConflict(studentId, week, day, hour, duration) {
        var schedule = getStudentSchedule(studentId, week);
        var restDays = getStudentRestDays(studentId, week);
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);
        var durationNum = parseInteger(duration);

        if (dayNum === null || hourNum === null || durationNum === null) return true;
        if (restDays.indexOf(dayNum) !== -1) return true;

        return ScheduleCore.hasConflict(schedule, dayNum, hourNum, durationNum);
    }

    function getConflicts(studentId, week, day, hour, duration) {
        var schedule = getStudentSchedule(studentId, week);
        var dayNum = parseInteger(day);
        var hourNum = parseInteger(hour);
        var durationNum = parseInteger(duration);

        if (dayNum === null || hourNum === null || durationNum === null) return [];
        if (!schedule || !schedule[dayNum]) return [];

        var conflicts = [];
        var maxHour = Math.min(hourNum + durationNum, 24);

        for (var h = hourNum; h < maxHour; h++) {
            if (schedule[dayNum] && schedule[dayNum][h]) {
                var disciplineId = schedule[dayNum][h];
                var discipline = DisciplineQueries.getDiscipline(disciplineId);
                var metadata = getSlotMetadata(studentId, week, dayNum, h);
                var instructorId = metadata ? metadata.instructorId : null;
                var instructor = instructorId ? CharacterQueries.getCharacterById(instructorId) : null;

                conflicts.push({
                    hour: h,
                    disciplineId: disciplineId,
                    disciplineName: discipline ? discipline.name : 'Unknown',
                    instructorId: instructorId,
                    instructorName: instructor ? CharacterQueries.getDisplayName(instructor) : 'Unknown',
                    label: metadata ? metadata.label || '' : ''
                });
            }
        }
        return conflicts;
    }

    function isRestDay(studentId, week, day) {
        var restDays = getStudentRestDays(studentId, week);
        var dayNum = parseInteger(day);
        if (dayNum === null) return false;
        return restDays.indexOf(dayNum) !== -1;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarQueries = {
        // Student
        getStudentSchedule: getStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        getSlotMetadata: getSlotMetadata,
        getClassDetails: getClassDetails,
        getStudentClasses: getStudentClasses,
        getStudentWeeklyUsage: getStudentWeeklyUsage,

        // Instructor
        getInstructorSchedule: getInstructorSchedule,
        getInstructorTemplates: getInstructorTemplates,
        getInstructorBlocks: getInstructorBlocks,
        getAssignedStudents: getAssignedStudents,
        getInstructorAvailableDisciplines: getInstructorAvailableDisciplines,

        // Location
        getLocationSchedule: getLocationSchedule,
        getLocationClassDetails: getLocationClassDetails,
        getStudentsAtLocation: getStudentsAtLocation,
        getLocationUsage: getLocationUsage,
        getLocationDisciplineAvailability: getLocationDisciplineAvailability,

        // Conflict
        hasConflict: hasConflict,
        getConflicts: getConflicts,
        isRestDay: isRestDay
    };

})();
