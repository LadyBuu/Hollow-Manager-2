/**
 * js/modules/calendar/calendar-queries.js - Calendar Queries
 * Read-only query layer for calendar data
 * Path: js/modules/calendar/calendar-queries.js
 * 
 * This module provides:
 *   - Student schedule queries
 *   - Instructor schedule queries (derived from student schedules)
 *   - Location schedule queries (derived from student schedules)
 *   - Rest day queries
 *   - Schedule statistics
 *   - Conflict detection queries
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - PURE functions - no side effects (except reading window.data)
 *   - No DOM manipulation
 *   - No direct window.data mutation
 *   - Returns clones of data where appropriate
 *   - Single source of truth for calendar read models
 *   - Student schedules are the CANONICAL source of truth
 *   - Instructor and location schedules are DERIVED from student schedules
 * 
 * DEPENDENCIES:
 *   - window.ScheduleCore (from schedule-core.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.LocationQueries (from location-queries.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 * 
 * USAGE:
 *   var queries = window.CalendarQueries;
 *   var schedule = queries.getStudentSchedule('student_123', 5);
 *   var instructorSchedule = queries.getInstructorSchedule('instructor_456', 5);
 *   var conflicts = queries.getConflicts('student_123', 5, 3, 9, 2);
 */

(function() {
    'use strict';

    if (window.__calendarQueriesLoaded) {
        return;
    }

    var ScheduleCore = window.ScheduleCore;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var LocationQueries = window.LocationQueries;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    function checkDependencies() {
        var missing = [];

        if (!ScheduleCore || typeof ScheduleCore.getStudentSchedule !== 'function') {
            missing.push('ScheduleCore.getStudentSchedule');
        }
        if (!ScheduleCore || typeof ScheduleCore.getStudentRestDays !== 'function') {
            missing.push('ScheduleCore.getStudentRestDays');
        }
        if (!ScheduleCore || typeof ScheduleCore.hasConflict !== 'function') {
            missing.push('ScheduleCore.hasConflict');
        }
        if (!ScheduleCore || typeof ScheduleCore.isRestDay !== 'function') {
            missing.push('ScheduleCore.isRestDay');
        }
        if (!ScheduleCore || typeof ScheduleCore.findClassStart !== 'function') {
            missing.push('ScheduleCore.findClassStart');
        }
        if (!ScheduleCore || typeof ScheduleCore.getSlotMetadata !== 'function') {
            missing.push('ScheduleCore.getSlotMetadata');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getStudents !== 'function') {
            missing.push('CharacterQueries.getStudents');
        }
        if (!CharacterQueries || typeof CharacterQueries.getInstructors !== 'function') {
            missing.push('CharacterQueries.getInstructors');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }
        if (!DisciplineQueries || typeof DisciplineQueries.getAvailableDisciplines !== 'function') {
            missing.push('DisciplineQueries.getAvailableDisciplines');
        }

        if (!LocationQueries || typeof LocationQueries.getLocation !== 'function') {
            missing.push('LocationQueries.getLocation');
        }
        if (!LocationQueries || typeof LocationQueries.getLocations !== 'function') {
            missing.push('LocationQueries.getLocations');
        }

        if (!CalendarConstants) {
            missing.push('CalendarConstants');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }

        if (missing.length > 0) {
            throw new Error('CalendarQueries: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getScheduleKey(studentId, week, day, hour) {
        return ScheduleCore.getScheduleKey(studentId, week, day, hour);
    }

    function getDayName(day) {
        return CalendarConstants.getDayName(day) || 'Unknown';
    }

    function formatHour(hour) {
        return CalendarConstants.formatHour(hour) || String(hour);
    }

    function parseInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) ? num : null;
    }

    function getMetadataStore() {
        if (window.data && window.data.curriculum && window.data.curriculum.metadata) {
            return window.data.curriculum.metadata;
        }
        return {};
    }

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
        var weekNum = CalendarValidation.parseWeek(week);
        var dayNum = CalendarValidation.parseDay(day);
        var hourNum = CalendarValidation.parseHour(hour);

        if (weekNum === null || dayNum === null || hourNum === null) {
            return null;
        }

        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        var metadata = getSlotMetadata(studentId, weekNum, dayNum, hourNum);

        var classStart = ScheduleCore.findClassStart(
            schedule,
            getMetadataStore(),
            studentId,
            weekNum,
            dayNum,
            hourNum
        );

        if (!classStart) {
            return null;
        }

        var instructorId = metadata ? metadata.instructorId : null;
        var instructor = instructorId ? CharacterQueries.getCharacterById(instructorId) : null;

        return {
            studentId: studentId,
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            startHour: classStart.startHour,
            duration: classStart.duration,
            disciplineId: disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            instructorId: instructorId,
            instructorName: instructor ? CharacterQueries.getDisplayName(instructor) : 'Not assigned',
            label: metadata ? metadata.label || '' : '',
            groupLabel: metadata ? metadata.groupLabel || '' : '',
            locationId: metadata ? metadata.locationId : null,
            dayName: getDayName(dayNum),
            hourDisplay: formatHour(hourNum),
            isContinuation: classStart.startHour !== hourNum,
            key: classStart.key
        };
    }

    function getStudentClasses(studentId, week) {
        var schedule = getStudentSchedule(studentId, week);
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var classes = [];
        var seenStarts = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var dayNum = parseInteger(day);
            if (dayNum === null) {
                continue;
            }

            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var hourNum = parseInteger(hour);
                if (hourNum === null) {
                    continue;
                }

                var classStart = ScheduleCore.findClassStart(
                    schedule,
                    getMetadataStore(),
                    studentId,
                    weekNum,
                    dayNum,
                    hourNum
                );

                if (!classStart) {
                    continue;
                }

                var key = classStart.startHour + '_' + classStart.duration + '_' + classStart.disciplineId;
                if (seenStarts[key]) {
                    continue;
                }
                seenStarts[key] = true;

                if (classStart.startHour === hourNum) {
                    var details = getClassDetails(studentId, weekNum, dayNum, hourNum);
                    if (details) {
                        classes.push(details);
                    }
                }
            }
        }

        classes.sort(function(a, b) {
            if (a.day !== b.day) {
                return a.day - b.day;
            }
            return a.startHour - b.startHour;
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
            if (!byDiscipline[cls.disciplineId]) {
                byDiscipline[cls.disciplineId] = {
                    disciplineId: cls.disciplineId,
                    disciplineName: cls.disciplineName,
                    hours: 0
                };
            }
            byDiscipline[cls.disciplineId].hours += cls.duration || 1;
        }

        return {
            total: total,
            byDiscipline: byDiscipline
        };
    }

    function getInstructorSchedule(instructorId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) {
            return {};
        }

        var students = CharacterQueries.getStudents() || [];
        var schedule = {};

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var studentSchedule = getStudentSchedule(student.id, weekNum);

            for (var day in studentSchedule) {
                if (!Object.prototype.hasOwnProperty.call(studentSchedule, day)) {
                    continue;
                }
                var dayNum = parseInteger(day);
                if (dayNum === null) {
                    continue;
                }

                var daySchedule = studentSchedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') {
                    continue;
                }

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                        continue;
                    }
                    var hourNum = parseInteger(hour);
                    if (hourNum === null) {
                        continue;
                    }

                    var disciplineId = daySchedule[hour];
                    if (!disciplineId) {
                        continue;
                    }

                    var metadata = getSlotMetadata(student.id, weekNum, dayNum, hourNum);
                    if (!metadata || String(metadata.instructorId) !== String(instructorId)) {
                        continue;
                    }

                    var classStart = ScheduleCore.findClassStart(
                        studentSchedule,
                        getMetadataStore(),
                        student.id,
                        weekNum,
                        dayNum,
                        hourNum
                    );

                    if (!classStart) {
                        continue;
                    }

                    var slotDay = dayNum;
                    var slotHour = classStart.startHour;

                    if (!schedule[slotDay]) {
                        schedule[slotDay] = {};
                    }
                    if (!schedule[slotDay][slotHour]) {
                        schedule[slotDay][slotHour] = {
                            students: [],
                            disciplineId: disciplineId,
                            duration: classStart.duration || 1,
                            label: metadata ? metadata.label || '' : '',
                            groupLabel: metadata ? metadata.groupLabel || '' : ''
                        };
                    }

                    var studentEntry = {
                        studentId: student.id,
                        studentName: CharacterQueries.getDisplayName(student),
                        groupLabel: metadata ? metadata.groupLabel || null : null
                    };

                    var exists = false;
                    for (var s = 0; s < schedule[slotDay][slotHour].students.length; s++) {
                        if (String(schedule[slotDay][slotHour].students[s].studentId) === String(student.id)) {
                            exists = true;
                            break;
                        }
                    }

                    if (!exists) {
                        schedule[slotDay][slotHour].students.push(studentEntry);
                    }
                }
            }
        }

        return schedule;
    }

    function getInstructorUsage(instructorId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) {
            return {
                totalSlots: 0,
                totalStudents: 0,
                totalHours: 0,
                daysWithClasses: 0,
                busiestDay: null,
                disciplines: {}
            };
        }

        var schedule = getInstructorSchedule(instructorId, weekNum);
        var stats = {
            totalSlots: 0,
            totalStudents: 0,
            totalHours: 0,
            daysWithClasses: 0,
            busiestDay: null,
            busiestHour: null,
            disciplines: {}
        };

        var daysWithClasses = {};
        var dayCounts = {};
        var hourCounts = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var dayNum = parseInteger(day);
            if (dayNum === null) {
                continue;
            }

            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            var daySlots = 0;
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var slot = daySchedule[hour];
                if (!slot) {
                    continue;
                }

                stats.totalSlots++;
                daySlots++;
                stats.totalHours += slot.duration || 1;

                if (slot.students) {
                    stats.totalStudents += slot.students.length;
                }

                if (slot.disciplineId) {
                    if (!stats.disciplines[slot.disciplineId]) {
                        stats.disciplines[slot.disciplineId] = {
                            disciplineId: slot.disciplineId,
                            disciplineName: DisciplineQueries.getDiscipline(slot.disciplineId) ?
                                DisciplineQueries.getDiscipline(slot.disciplineId).name : 'Unknown',
                            slots: 0,
                            students: 0,
                            hours: 0
                        };
                    }
                    stats.disciplines[slot.disciplineId].slots++;
                    stats.disciplines[slot.disciplineId].hours += slot.duration || 1;
                    if (slot.students) {
                        stats.disciplines[slot.disciplineId].students += slot.students.length;
                    }
                }

                var hourNum = parseInteger(hour);
                if (hourNum !== null) {
                    if (!hourCounts[hourNum]) {
                        hourCounts[hourNum] = 0;
                    }
                    hourCounts[hourNum]++;
                }
            }

            if (daySlots > 0) {
                daysWithClasses[dayNum] = true;
                dayCounts[dayNum] = daySlots;
            }
        }

        stats.daysWithClasses = Object.keys(daysWithClasses).length;

        var maxDay = null;
        var maxDayCount = 0;
        for (var day in dayCounts) {
            if (Object.prototype.hasOwnProperty.call(dayCounts, day)) {
                var count = dayCounts[day];
                if (count > maxDayCount) {
                    maxDayCount = count;
                    maxDay = parseInteger(day);
                }
            }
        }
        stats.busiestDay = maxDay !== null ? getDayName(maxDay) : null;

        var maxHour = null;
        var maxHourCount = 0;
        for (var hour in hourCounts) {
            if (Object.prototype.hasOwnProperty.call(hourCounts, hour)) {
                var count = hourCounts[hour];
                if (count > maxHourCount) {
                    maxHourCount = count;
                    maxHour = parseInteger(hour);
                }
            }
        }
        stats.busiestHour = maxHour !== null ? formatHour(maxHour) : null;

        return stats;
    }

    function getInstructorAvailableDisciplines(instructorId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(instructorId)) {
            return [];
        }

        var allDisciplines = DisciplineQueries.getAvailableDisciplines(weekNum) || [];
        var available = [];

        for (var i = 0; i < allDisciplines.length; i++) {
            var d = allDisciplines[i];
            if (!d) {
                continue;
            }

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

    function getLocationSchedule(locationId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(locationId)) {
            return {};
        }

        var students = CharacterQueries.getStudents() || [];
        var schedule = {};

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var studentSchedule = getStudentSchedule(student.id, weekNum);

            for (var day in studentSchedule) {
                if (!Object.prototype.hasOwnProperty.call(studentSchedule, day)) {
                    continue;
                }
                var dayNum = parseInteger(day);
                if (dayNum === null) {
                    continue;
                }

                var daySchedule = studentSchedule[day];
                if (!daySchedule || typeof daySchedule !== 'object') {
                    continue;
                }

                for (var hour in daySchedule) {
                    if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                        continue;
                    }
                    var hourNum = parseInteger(hour);
                    if (hourNum === null) {
                        continue;
                    }

                    var disciplineId = daySchedule[hour];
                    if (!disciplineId) {
                        continue;
                    }

                    var metadata = getSlotMetadata(student.id, weekNum, dayNum, hourNum);
                    if (!metadata || String(metadata.locationId) !== String(locationId)) {
                        continue;
                    }

                    var classStart = ScheduleCore.findClassStart(
                        studentSchedule,
                        getMetadataStore(),
                        student.id,
                        weekNum,
                        dayNum,
                        hourNum
                    );

                    if (!classStart) {
                        continue;
                    }

                    var slotDay = dayNum;
                    var slotHour = classStart.startHour;

                    if (!schedule[slotDay]) {
                        schedule[slotDay] = {};
                    }
                    if (!schedule[slotDay][slotHour]) {
                        schedule[slotDay][slotHour] = {
                            students: [],
                            disciplineId: disciplineId,
                            duration: classStart.duration || 1,
                            label: metadata ? metadata.label || '' : '',
                            groupLabel: metadata ? metadata.groupLabel || '' : ''
                        };
                    }

                    var studentEntry = {
                        studentId: student.id,
                        studentName: CharacterQueries.getDisplayName(student),
                        groupLabel: metadata ? metadata.groupLabel || null : null
                    };

                    var exists = false;
                    for (var s = 0; s < schedule[slotDay][slotHour].students.length; s++) {
                        if (String(schedule[slotDay][slotHour].students[s].studentId) === String(student.id)) {
                            exists = true;
                            break;
                        }
                    }

                    if (!exists) {
                        schedule[slotDay][slotHour].students.push(studentEntry);
                    }
                }
            }
        }

        return schedule;
    }

    function getLocationDisciplineAvailability(locationId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(locationId)) {
            return [];
        }

        var schedule = getLocationSchedule(locationId, weekNum);
        var disciplines = DisciplineQueries.getAvailableDisciplines(weekNum) || [];
        var usageCount = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var slot = daySchedule[hour];
                if (!slot || !slot.disciplineId) {
                    continue;
                }

                if (!usageCount[slot.disciplineId]) {
                    usageCount[slot.disciplineId] = 0;
                }
                usageCount[slot.disciplineId]++;
            }
        }

        var result = [];

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d) {
                continue;
            }

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

    function getLocationUsage(locationId, week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null || !isNonEmptyString(locationId)) {
            return {
                totalSlots: 0,
                totalStudents: 0,
                uniqueDisciplines: 0,
                daysWithClasses: 0,
                busiestDay: null,
                busiestHour: null,
                utilization: 0
            };
        }

        var schedule = getLocationSchedule(locationId, weekNum);
        var stats = {
            totalSlots: 0,
            totalStudents: 0,
            uniqueDisciplines: {},
            daysWithClasses: 0,
            busiestDay: null,
            busiestHour: null,
            utilization: 0
        };

        var daysWithClasses = {};
        var dayCounts = {};
        var hourCounts = {};
        var allStudents = {};

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }
            var dayNum = parseInteger(day);
            if (dayNum === null) {
                continue;
            }

            var daySchedule = schedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            var daySlots = 0;
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }
                var slot = daySchedule[hour];
                if (!slot) {
                    continue;
                }

                stats.totalSlots++;
                daySlots++;

                if (slot.disciplineId) {
                    stats.uniqueDisciplines[slot.disciplineId] = true;
                }

                if (slot.students) {
                    for (var s = 0; s < slot.students.length; s++) {
                        var studentId = slot.students[s].studentId;
                        if (studentId) {
                            allStudents[studentId] = true;
                        }
                    }
                }

                var hourNum = parseInteger(hour);
                if (hourNum !== null) {
                    if (!hourCounts[hourNum]) {
                        hourCounts[hourNum] = 0;
                    }
                    hourCounts[hourNum]++;
                }
            }

            if (daySlots > 0) {
                daysWithClasses[dayNum] = true;
                dayCounts[dayNum] = daySlots;
            }
        }

        stats.totalStudents = Object.keys(allStudents).length;
        stats.uniqueDisciplines = Object.keys(stats.uniqueDisciplines).length;
        stats.daysWithClasses = Object.keys(daysWithClasses).length;

        var totalPossibleSlots = 7 * (CALENDAR_END_HOUR - CALENDAR_START_HOUR + 1);
        stats.utilization = totalPossibleSlots > 0 ?
            Math.round((stats.totalSlots / totalPossibleSlots) * 100) : 0;

        var maxDay = null;
        var maxDayCount = 0;
        for (var day in dayCounts) {
            if (Object.prototype.hasOwnProperty.call(dayCounts, day)) {
                var count = dayCounts[day];
                if (count > maxDayCount) {
                    maxDayCount = count;
                    maxDay = parseInteger(day);
                }
            }
        }
        stats.busiestDay = maxDay !== null ? getDayName(maxDay) : null;

        var maxHour = null;
        var maxHourCount = 0;
        for (var hour in hourCounts) {
            if (Object.prototype.hasOwnProperty.call(hourCounts, hour)) {
                var count = hourCounts[hour];
                if (count > maxHourCount) {
                    maxHourCount = count;
                    maxHour = parseInteger(hour);
                }
            }
        }
        stats.busiestHour = maxHour !== null ? formatHour(maxHour) : null;

        return stats;
    }

    function hasConflict(studentId, week, day, hour, duration) {
        var schedule = getStudentSchedule(studentId, week);
        var restDays = getStudentRestDays(studentId, week);
        var dayNum = CalendarValidation.parseDay(day);
        var hourNum = CalendarValidation.parseHour(hour);
        var durationNum = CalendarValidation.parseDuration(duration);

        if (dayNum === null || hourNum === null || durationNum === null) {
            return true;
        }

        if (restDays.indexOf(dayNum) !== -1) {
            return true;
        }

        return ScheduleCore.hasConflict(schedule, dayNum, hourNum, durationNum);
    }

    function getConflicts(studentId, week, day, hour, duration) {
        var schedule = getStudentSchedule(studentId, week);
        var dayNum = CalendarValidation.parseDay(day);
        var hourNum = CalendarValidation.parseHour(hour);
        var durationNum = CalendarValidation.parseDuration(duration);

        if (dayNum === null || hourNum === null || durationNum === null) {
            return [];
        }

        var conflicts = [];

        if (!schedule || !schedule[dayNum]) {
            return conflicts;
        }

        var maxHour = Math.min(hourNum + durationNum, CALENDAR_END_HOUR + 1);
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
        var dayNum = CalendarValidation.parseDay(day);
        if (dayNum === null) {
            return false;
        }
        return restDays.indexOf(dayNum) !== -1;
    }

    window.CalendarQueries = {
        getStudentSchedule: getStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        getSlotMetadata: getSlotMetadata,
        getClassDetails: getClassDetails,
        getStudentClasses: getStudentClasses,
        getStudentWeeklyUsage: getStudentWeeklyUsage,

        getInstructorSchedule: getInstructorSchedule,
        getInstructorUsage: getInstructorUsage,
        getInstructorAvailableDisciplines: getInstructorAvailableDisciplines,

        getLocationSchedule: getLocationSchedule,
        getLocationDisciplineAvailability: getLocationDisciplineAvailability,
        getLocationUsage: getLocationUsage,

        hasConflict: hasConflict,
        getConflicts: getConflicts,
        isRestDay: isRestDay,

        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY,
        CALENDAR_START_HOUR: CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: CALENDAR_END_HOUR,
        MAX_DURATION: MAX_DURATION
    };

    window.__calendarQueriesLoaded = true;

})();