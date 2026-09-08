/**
 * modules/calendar/calendar-aggregator.js - Calendar Aggregator
 * Calendar's integration boundary with external domains
 * 
 * IMPORTANT:
 *   - ONLY Calendar-layer component that composes external query results
 *   - Calendar-shaped API only - no passthrough methods
 *   - Depends on shared queries, NOT raw window.data
 *   - No mutations
 *   - No UI dependencies
 * 
 * API SHAPE:
 *   ✓ getStudentCalendar(studentId, week)
 *   ✓ getInstructorCalendar(instructorId, week)
 *   ✓ getLocationCalendar(locationId, week)
 *   ✓ getClassDetails(studentId, week, day, hour)
 *   ✓ getAssignedStudents(instructorId, week, day, hour)
 *   ✓ getStudentsAtLocation(locationId, week, day, hour)
 *   ✓ getInstructorAvailableDisciplines(instructorId, week)
 *   ✓ getLocationDisciplineAvailability(locationId, week)
 *   ✓ getStudentWeeklyUsage(studentId, week)
 * 
 * DEPENDENCIES:
 *   - CalendarQueries
 *   - CharacterQueries
 *   - DisciplineQueries
 *   - LocationQueries
 *   - TeamQueries
 */

(function() {
    'use strict';

    if (window.__calendarAggregatorLoaded) { return; }
    window.__calendarAggregatorLoaded = true;

    var CQ = window.CalendarQueries;
    var CharQ = window.CharacterQueries;
    var DiscQ = window.DisciplineQueries;
    var LocQ = window.LocationQueries;
    var TeamQ = window.TeamQueries;
    var CC = window.CalendarConstants;

    function getCurrentWeek() {
        var data = window.data || {};
        return data.currentWeek || 1;
    }

    // ============================================================
    // STUDENT CALENDAR
    // ============================================================

    function getStudentCalendar(studentId, week) {
        var weekNum = week || getCurrentWeek();
        var schedule = CQ.getStudentSchedule(studentId, weekNum);
        var restDays = CQ.getStudentRestDays(studentId, weekNum);

        var resolvedSchedule = {};
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) { continue; }
            var dayNum = parseInt(day, 10);
            if (isNaN(dayNum)) { continue; }
            resolvedSchedule[dayNum] = {};

            for (var hour in schedule[day]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) { continue; }
                var hourNum = parseInt(hour, 10);
                if (isNaN(hourNum)) { continue; }

                var disciplineId = schedule[day][hourNum];
                var discipline = DiscQ.getDiscipline(disciplineId);
                var metadata = CQ.getSlotMetadata(studentId, weekNum, dayNum, hourNum);

                resolvedSchedule[dayNum][hourNum] = {
                    disciplineId: disciplineId,
                    disciplineName: discipline ? discipline.name : 'Unknown',
                    duration: metadata ? metadata.duration || 1 : 1,
                    label: metadata ? metadata.label || '' : '',
                    groupLabel: metadata ? metadata.groupLabel || '' : '',
                    instructorId: metadata ? metadata.instructorId : null,
                    instructorName: metadata && metadata.instructorId
                        ? CharQ.getCharacterNameById(metadata.instructorId)
                        : ''
                };
            }
        }

        var student = CharQ.getCharacterById(studentId);

        return {
            studentId: studentId,
            studentName: student ? CharQ.getDisplayName(student) : 'Unknown',
            week: weekNum,
            schedule: resolvedSchedule,
            restDays: restDays,
            hasSchedule: Object.keys(resolvedSchedule).length > 0
        };
    }

    // ============================================================
    // INSTRUCTOR CALENDAR
    // ============================================================

    function getInstructorCalendar(instructorId, week) {
        var weekNum = week || getCurrentWeek();
        var templates = CQ.getInstructorTemplates(instructorId, weekNum);
        var blocks = CQ.getInstructorBlocks(instructorId, weekNum);

        var resolvedTemplates = {};
        for (var key in templates) {
            if (!Object.prototype.hasOwnProperty.call(templates, key)) { continue; }
            var template = templates[key];
            if (!template) { continue; }

            var parts = key.split('_');
            if (parts.length !== 4) { continue; }
            var dayNum = parseInt(parts[2], 10);
            var hourNum = parseInt(parts[3], 10);
            if (isNaN(dayNum) || isNaN(hourNum)) { continue; }

            var discipline = DiscQ.getDiscipline(template.disciplineId);
            var assignedStudents = [];
            if (template.assignedStudents) {
                for (var i = 0; i < template.assignedStudents.length; i++) {
                    var sid = template.assignedStudents[i];
                    var s = CharQ.getCharacterById(sid);
                    if (s) {
                        assignedStudents.push({
                            id: sid,
                            name: CharQ.getDisplayName(s)
                        });
                    }
                }
            }

            if (!resolvedTemplates[dayNum]) { resolvedTemplates[dayNum] = {}; }
            resolvedTemplates[dayNum][hourNum] = {
                disciplineId: template.disciplineId,
                disciplineName: discipline ? discipline.name : 'Unknown',
                duration: template.duration || 1,
                label: template.label || '',
                groupLabel: template.groupLabel || '',
                assignedStudents: assignedStudents,
                isTemplate: true
            };
        }

        var resolvedBlocks = {};
        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) { continue; }
            var dayNum = parseInt(day, 10);
            if (isNaN(dayNum)) { continue; }

            var dayBlocks = blocks[day];
            if (!dayBlocks || typeof dayBlocks !== 'object') { continue; }

            for (var hour in dayBlocks) {
                if (!Object.prototype.hasOwnProperty.call(dayBlocks, hour)) { continue; }
                var hourNum = parseInt(hour, 10);
                if (isNaN(hourNum)) { continue; }

                var block = dayBlocks[hour];
                if (!block) { continue; }

                if (!resolvedBlocks[dayNum]) { resolvedBlocks[dayNum] = {}; }
                resolvedBlocks[dayNum][hourNum] = {
                    duration: block.duration || 1,
                    label: block.label || 'Blocked',
                    isBlock: true
                };
            }
        }

        var instructor = CharQ.getCharacterById(instructorId);

        return {
            instructorId: instructorId,
            instructorName: instructor ? CharQ.getDisplayName(instructor) : 'Unknown',
            week: weekNum,
            templates: resolvedTemplates,
            blocks: resolvedBlocks,
            hasTemplates: Object.keys(resolvedTemplates).length > 0,
            hasBlocks: Object.keys(resolvedBlocks).length > 0
        };
    }

    // ============================================================
    // LOCATION CALENDAR
    // ============================================================

    function getLocationCalendar(locationId, week) {
        var weekNum = week || getCurrentWeek();
        var schedule = CQ.getLocationSchedule(locationId, weekNum);

        var resolvedSchedule = {};
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) { continue; }
            var dayNum = parseInt(day, 10);
            if (isNaN(dayNum)) { continue; }
            resolvedSchedule[dayNum] = {};

            for (var hour in schedule[day]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) { continue; }
                var hourNum = parseInt(hour, 10);
                if (isNaN(hourNum)) { continue; }

                var disciplineId = schedule[day][hourNum];
                var discipline = DiscQ.getDiscipline(disciplineId);
                var metadata = CQ.getSlotMetadata(locationId, weekNum, dayNum, hourNum);

                resolvedSchedule[dayNum][hourNum] = {
                    disciplineId: disciplineId,
                    disciplineName: discipline ? discipline.name : 'Unknown',
                    duration: metadata ? metadata.duration || 1 : 1,
                    label: metadata ? metadata.label || '' : '',
                    groupLabel: metadata ? metadata.groupLabel || '' : '',
                    instructorId: metadata ? metadata.instructorId : null,
                    instructorName: metadata && metadata.instructorId
                        ? CharQ.getCharacterNameById(metadata.instructorId)
                        : ''
                };
            }
        }

        var location = LocQ.getLocation(locationId);

        return {
            locationId: locationId,
            locationName: location ? location.name : 'Unknown',
            week: weekNum,
            schedule: resolvedSchedule,
            hasSchedule: Object.keys(resolvedSchedule).length > 0
        };
    }

    // ============================================================
    // CLASS DETAILS
    // ============================================================

    function getClassDetails(studentId, week, day, hour) {
        var weekNum = week || getCurrentWeek();
        var schedule = CQ.getStudentSchedule(studentId, weekNum);

        if (!schedule[day] || !schedule[day][hour]) { return null; }

        var disciplineId = schedule[day][hour];
        var discipline = DiscQ.getDiscipline(disciplineId);
        var metadata = CQ.getSlotMetadata(studentId, weekNum, day, hour);

        var duration = metadata ? metadata.duration || 1 : 1;

        // Check if this is part of a longer class
        var classStart = hour;
        for (var h = hour - 1; h >= 0; h--) {
            if (String(schedule[day][h]) === String(disciplineId)) {
                classStart = h;
            } else {
                break;
            }
        }

        var classEnd = hour;
        for (var h = hour + 1; h < hour + duration && h <= CC.MAX_HOUR; h++) {
            if (String(schedule[day][h]) === String(disciplineId)) {
                classEnd = h;
            } else {
                break;
            }
        }

        var actualDuration = classEnd - classStart + 1;

        return {
            studentId: studentId,
            week: weekNum,
            day: day,
            hour: hour,
            disciplineId: disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            duration: actualDuration,
            label: metadata ? metadata.label || '' : '',
            groupLabel: metadata ? metadata.groupLabel || '' : '',
            instructorId: metadata ? metadata.instructorId : null,
            instructorName: metadata && metadata.instructorId
                ? CharQ.getCharacterNameById(metadata.instructorId)
                : '',
            classStart: classStart,
            classEnd: classEnd,
            isContinuation: classStart < hour
        };
    }

    // ============================================================
    // ASSIGNED STUDENTS
    // ============================================================

    function getAssignedStudents(instructorId, week, day, hour) {
        var weekNum = week || getCurrentWeek();
        var templates = CQ.getInstructorTemplates(instructorId, weekNum);
        var key = String(day) + '_' + String(hour);

        var template = templates[key];
        if (!template || !template.assignedStudents) { return []; }

        var result = [];
        for (var i = 0; i < template.assignedStudents.length; i++) {
            var sid = template.assignedStudents[i];
            var s = CharQ.getCharacterById(sid);
            if (s) {
                result.push({
                    studentId: sid,
                    studentName: CharQ.getDisplayName(s),
                    groupLabel: template.groupLabel || ''
                });
            }
        }
        return result;
    }

    // ============================================================
    // STUDENTS AT LOCATION
    // ============================================================

    function getStudentsAtLocation(locationId, week, day, hour) {
        var weekNum = week || getCurrentWeek();
        var schedule = CQ.getLocationSchedule(locationId, weekNum);

        if (!schedule[day] || !schedule[day][hour]) { return []; }

        var disciplineId = schedule[day][hour];
        if (!disciplineId) { return []; }

        // Find all students taking this discipline at this time
        var allStudents = CharQ.getStudents() || [];
        var result = [];

        for (var i = 0; i < allStudents.length; i++) {
            var student = allStudents[i];
            var studentSchedule = CQ.getStudentSchedule(student.id, weekNum);
            if (studentSchedule[day] && String(studentSchedule[day][hour]) === String(disciplineId)) {
                result.push({
                    studentId: student.id,
                    studentName: CharQ.getDisplayName(student)
                });
            }
        }

        return result;
    }

    // ============================================================
    // INSTRUCTOR AVAILABLE DISCIPLINES
    // ============================================================

    function getInstructorAvailableDisciplines(instructorId, week) {
        var weekNum = week || getCurrentWeek();
        var allDisciplines = DiscQ.getAvailableDisciplines(weekNum) || [];
        var result = [];

        for (var i = 0; i < allDisciplines.length; i++) {
            var d = allDisciplines[i];
            if (!d) { continue; }

            if (d.instructorIds) {
                for (var j = 0; j < d.instructorIds.length; j++) {
                    if (String(d.instructorIds[j]) === String(instructorId)) {
                        result.push({
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
        return result;
    }

    // ============================================================
    // LOCATION DISCIPLINE AVAILABILITY
    // ============================================================

    function getLocationDisciplineAvailability(locationId, week) {
        var weekNum = week || getCurrentWeek();
        var schedule = CQ.getLocationSchedule(locationId, weekNum);
        var disciplines = DiscQ.getAvailableDisciplines(weekNum) || [];
        var usageCount = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) { continue; }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') { continue; }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) { continue; }
                var slot = daySchedule[hour];
                if (!slot) { continue; }
                usageCount[slot] = (usageCount[slot] || 0) + 1;
            }
        }

        var result = [];
        var location = LocQ.getLocation(locationId);

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d) { continue; }

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

            // Check if location has capacity constraints
            var locationCapacity = location ? location.capacity || 0 : 0;
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
    // STUDENT WEEKLY USAGE
    // ============================================================

    function getStudentWeeklyUsage(studentId, week) {
        var weekNum = week || getCurrentWeek();
        var calendar = getStudentCalendar(studentId, weekNum);
        var total = 0;
        var byDiscipline = {};

        for (var day in calendar.schedule) {
            if (!Object.prototype.hasOwnProperty.call(calendar.schedule, day)) { continue; }
            var daySchedule = calendar.schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') { continue; }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) { continue; }
                var cls = daySchedule[hour];
                if (!cls) { continue; }

                var duration = cls.duration || 1;
                total += duration;

                var id = cls.disciplineId;
                if (!byDiscipline[id]) {
                    byDiscipline[id] = {
                        disciplineId: id,
                        disciplineName: cls.disciplineName || 'Unknown',
                        hours: 0
                    };
                }
                byDiscipline[id].hours += duration;
            }
        }

        return {
            studentId: studentId,
            week: weekNum,
            totalHours: total,
            byDiscipline: byDiscipline
        };
    }

    window.CalendarAggregator = {
        getStudentCalendar: getStudentCalendar,
        getInstructorCalendar: getInstructorCalendar,
        getLocationCalendar: getLocationCalendar,
        getClassDetails: getClassDetails,
        getAssignedStudents: getAssignedStudents,
        getStudentsAtLocation: getStudentsAtLocation,
        getInstructorAvailableDisciplines: getInstructorAvailableDisciplines,
        getLocationDisciplineAvailability: getLocationDisciplineAvailability,
        getStudentWeeklyUsage: getStudentWeeklyUsage
    };

})();
