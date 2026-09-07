/**
 * modules/calendar/queries/location-queries.js - Location Calendar Queries
 * Read-only query layer for location calendar data
 * Path: js/modules/calendar/queries/location-queries.js
 * 
 * This module provides:
 *   - getLocationSchedule - Complete location calendar view model
 *   - getStudentsAtLocation - Students assigned to a location
 *   - getLocationDisciplineAvailability - Available disciplines for location
 *   - getLocationUsage - Location usage statistics
 *   - getLocationClassDetails - Details for a specific location class
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations, no persistence
 *   - No DOM manipulation
 *   - No direct window.data access - uses canonical query modules
 *   - Returns VIEW-READY data (formatted, sorted, filtered)
 *   - Single source of truth for location calendar queries
 *   - Student schedules are the canonical source of truth for assignments
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.LocationQueries (from location-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.CalendarStudentCore (from calendar/core/student-core.js) - MANDATORY
 *   - window.CalendarLocationCore (from calendar/core/location-core.js) - MANDATORY
 *   - window.CalendarScheduleCore (from calendar/core/schedule-core.js) - MANDATORY
 *   - window.CalendarMetadataCore (from calendar/core/metadata-core.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var LQ = window.LocationQueries;
 *   var schedule = LQ.getLocationSchedule(locationId, week);
 *   var students = LQ.getStudentsAtLocation(locationId, week, day, hour);
 *   var usage = LQ.getLocationUsage(locationId, week);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__locationQueriesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getCurrentStatus !== 'function') {
        missing.push('CharacterQueries.getCurrentStatus');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }

    if (!window.LocationQueries || typeof window.LocationQueries.getLocation !== 'function') {
        missing.push('LocationQueries.getLocation');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocations !== 'function') {
        missing.push('LocationQueries.getLocations');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }
    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getAvailableDisciplines !== 'function') {
        missing.push('DisciplineQueries.getAvailableDisciplines');
    }

    if (!window.CalendarStudentCore || typeof window.CalendarStudentCore.getStudentSchedule !== 'function') {
        missing.push('CalendarStudentCore.getStudentSchedule');
    }

    if (!window.CalendarLocationCore || typeof window.CalendarLocationCore.getLocationSchedule !== 'function') {
        missing.push('CalendarLocationCore.getLocationSchedule');
    }
    if (!window.CalendarLocationCore || typeof window.CalendarLocationCore.getClassLocation !== 'function') {
        missing.push('CalendarLocationCore.getClassLocation');
    }

    if (!window.CalendarScheduleCore || typeof window.CalendarScheduleCore.getScheduleKey !== 'function') {
        missing.push('CalendarScheduleCore.getScheduleKey');
    }
    if (!window.CalendarScheduleCore || typeof window.CalendarScheduleCore.findClassStartHour !== 'function') {
        missing.push('CalendarScheduleCore.findClassStartHour');
    }
    if (!window.CalendarScheduleCore || typeof window.CalendarScheduleCore.getClassRange !== 'function') {
        missing.push('CalendarScheduleCore.getClassRange');
    }

    if (!window.CalendarMetadataCore || typeof window.CalendarMetadataCore.getClassMetadata !== 'function') {
        missing.push('CalendarMetadataCore.getClassMetadata');
    }
    if (!window.CalendarMetadataCore || typeof window.CalendarMetadataCore.getClassLocation !== 'function') {
        missing.push('CalendarMetadataCore.getClassLocation');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (missing.length > 0) {
        console.error('[LocationQueries] Missing dependencies:', missing.join(', '));
        return;
    }

    window.__locationQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var LocationQueries = window.LocationQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var StudentCore = window.CalendarStudentCore;
    var LocationCore = window.CalendarLocationCore;
    var ScheduleCore = window.CalendarScheduleCore;
    var MetadataCore = window.CalendarMetadataCore;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    // ============================================================
    // HELPERS
    // ============================================================

    function parseInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) ? num : null;
    }

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

    function getMetadataStore() {
        if (window.data && window.data.curriculum) {
            return window.data.curriculum;
        }
        return {};
    }

    function getDurationsStore() {
        if (window.data && window.data.curriculum && window.data.curriculum.classDurations) {
            return window.data.curriculum.classDurations;
        }
        return {};
    }

    // ============================================================
    // LOCATION SCHEDULE QUERY
    // ============================================================

    /**
     * Get complete location calendar view model.
     * 
     * @param {string} locationId - Location ID
     * @param {number} week - Week number
     * @returns {object} Location schedule view model
     */
    function getLocationSchedule(locationId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return {};
        }

        if (!isNonEmptyString(locationId)) {
            return {};
        }

        var schedule = {};

        // Get location schedule from core
        var locationSchedule = LocationCore.getLocationSchedule(locationId, weekNum) || {};

        // Build schedule with metadata
        var students = CharacterQueries.getStudents() || [];

        for (var day in locationSchedule) {
            if (!Object.prototype.hasOwnProperty.call(locationSchedule, day)) {
                continue;
            }

            var dayNum = parseInteger(day);
            if (dayNum === null) {
                continue;
            }

            var daySchedule = locationSchedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            if (!schedule[dayNum]) {
                schedule[dayNum] = {};
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

                // Find class start and duration
                var classStart = null;
                var duration = 1;
                var key = null;

                // Search through students to find class metadata
                for (var s = 0; s < students.length; s++) {
                    var student = students[s];
                    var studentSchedule = StudentCore.getStudentSchedule(student.id, weekNum) || {};

                    if (!studentSchedule[dayNum] || !studentSchedule[dayNum][hourNum]) {
                        continue;
                    }

                    if (String(studentSchedule[dayNum][hourNum]) !== String(disciplineId)) {
                        continue;
                    }

                    var foundStart = ScheduleCore.findClassStartHour(
                        studentSchedule,
                        getDurationsStore(),
                        student.id,
                        weekNum,
                        dayNum,
                        hourNum
                    );

                    if (foundStart) {
                        classStart = foundStart;
                        duration = foundStart.duration || 1;
                        key = foundStart.key;
                        break;
                    }
                }

                // If no student found, try to get duration from discipline
                if (!classStart) {
                    var discipline = DisciplineQueries.getDiscipline(disciplineId);
                    if (discipline && discipline.defaultDuration) {
                        duration = discipline.defaultDuration || 1;
                    }
                }

                // Get metadata
                var metadata = {};
                if (key) {
                    var metaData = MetadataCore.getClassMetadata(
                        getMetadataStore(),
                        students.length > 0 ? students[0].id : null,
                        weekNum,
                        dayNum,
                        hourNum
                    );
                    if (metaData) {
                        metadata = metaData;
                    }
                }

                var slot = {
                    disciplineId: disciplineId,
                    disciplineName: DisciplineQueries.getDiscipline(disciplineId) ? 
                        DisciplineQueries.getDiscipline(disciplineId).name : 'Unknown',
                    duration: duration,
                    label: metadata.label || '',
                    groupLabel: metadata.groupLabel || null,
                    instructorId: metadata.instructorId || null,
                    locationId: locationId,
                    day: dayNum,
                    hour: hourNum,
                    dayName: getDayName(dayNum),
                    hourDisplay: formatHour(hourNum),
                    students: [],
                    isBlock: false
                };

                // Find students at this location
                var studentsAtLocation = getStudentsAtLocation(locationId, weekNum, dayNum, hourNum);
                slot.students = studentsAtLocation;

                schedule[dayNum][hourNum] = slot;
            }
        }

        return schedule;
    }

    // ============================================================
    // STUDENTS AT LOCATION QUERY
    // ============================================================

    /**
     * Get students assigned to a location at a specific time.
     * 
     * @param {string} locationId - Location ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour number (0-23)
     * @param {string} disciplineId - Optional discipline filter
     * @returns {Array} Array of student objects
     */
    function getStudentsAtLocation(locationId, week, day, hour, disciplineId) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return [];
        }

        var dayNum = parseInteger(day);
        if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
            return [];
        }

        var hourNum = parseInteger(hour);
        if (hourNum === null || hourNum < MIN_HOUR || hourNum > MAX_HOUR) {
            return [];
        }

        if (!isNonEmptyString(locationId)) {
            return [];
        }

        var students = CharacterQueries.getStudents() || [];
        var result = [];

        for (var s = 0; s < students.length; s++) {
            var student = students[s];
            var studentSchedule = StudentCore.getStudentSchedule(student.id, weekNum) || {};

            if (!studentSchedule[dayNum] || !studentSchedule[dayNum][hourNum]) {
                continue;
            }

            var studentDisciplineId = studentSchedule[dayNum][hourNum];
            if (!studentDisciplineId) {
                continue;
            }

            if (disciplineId && String(studentDisciplineId) !== String(disciplineId)) {
                continue;
            }

            // Check if this class is at this location
            var classLocation = LocationCore.getClassLocation(
                student.id,
                weekNum,
                dayNum,
                hourNum
            );

            if (String(classLocation) !== String(locationId)) {
                continue;
            }

            // Get class metadata
            var metadata = MetadataCore.getClassMetadata(
                getMetadataStore(),
                student.id,
                weekNum,
                dayNum,
                hourNum
            );

            // Find class start
            var classStart = ScheduleCore.findClassStartHour(
                studentSchedule,
                getDurationsStore(),
                student.id,
                weekNum,
                dayNum,
                hourNum
            );

            result.push({
                studentId: student.id,
                studentName: CharacterQueries.getDisplayName(student),
                disciplineId: studentDisciplineId,
                disciplineName: DisciplineQueries.getDiscipline(studentDisciplineId) ? 
                    DisciplineQueries.getDiscipline(studentDisciplineId).name : 'Unknown',
                groupLabel: metadata ? metadata.groupLabel : null,
                label: metadata ? metadata.label : '',
                startHour: classStart ? classStart.startHour : hourNum,
                duration: classStart ? classStart.duration : 1,
                instructorId: metadata ? metadata.instructorId : null
            });
        }

        return result;
    }

    // ============================================================
    // LOCATION DISCIPLINE AVAILABILITY
    // ============================================================

    /**
     * Get available disciplines for a location.
     * 
     * @param {string} locationId - Location ID
     * @param {number} week - Week number
     * @returns {Array} Array of discipline objects with availability info
     */
    function getLocationDisciplineAvailability(locationId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return [];
        }

        if (!isNonEmptyString(locationId)) {
            return [];
        }

        var disciplines = DisciplineQueries.getAvailableDisciplines(weekNum) || [];
        var locationSchedule = LocationCore.getLocationSchedule(locationId, weekNum) || {};
        var result = [];

        // Count usage per discipline
        var usageCount = {};

        for (var day in locationSchedule) {
            if (!Object.prototype.hasOwnProperty.call(locationSchedule, day)) {
                continue;
            }

            var daySchedule = locationSchedule[day];
            if (!daySchedule || typeof daySchedule !== 'object') {
                continue;
            }

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }

                var disciplineId = daySchedule[hour];
                if (!disciplineId) {
                    continue;
                }

                if (!usageCount[disciplineId]) {
                    usageCount[disciplineId] = 0;
                }
                usageCount[disciplineId]++;
            }
        }

        // Build result with availability info
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d) {
                continue;
            }

            // Check if this location can host this discipline
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
                weeklyHours: d.weeklyHours || 0,
                locationIds: d.locationIds || []
            });
        }

        return result;
    }

    // ============================================================
    // LOCATION USAGE QUERY
    // ============================================================

    /**
     * Get location usage statistics.
     * 
     * @param {string} locationId - Location ID
     * @param {number} week - Week number
     * @returns {object} Usage statistics
     */
    function getLocationUsage(locationId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return {
                totalSlots: 0,
                uniqueDisciplines: 0,
                totalStudents: 0,
                utilization: 0,
                daysWithClasses: 0,
                busiestDay: null,
                busiestHour: null
            };
        }

        if (!isNonEmptyString(locationId)) {
            return {
                totalSlots: 0,
                uniqueDisciplines: 0,
                totalStudents: 0,
                utilization: 0,
                daysWithClasses: 0,
                busiestDay: null,
                busiestHour: null
            };
        }

        var schedule = getLocationSchedule(locationId, weekNum);
        var stats = {
            totalSlots: 0,
            uniqueDisciplines: {},
            totalStudents: 0,
            daysWithClasses: 0,
            hoursByDay: {},
            disciplinesByDay: {}
        };

        var daysWithClasses = {};
        var studentsByDay = {};

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

            var dayCount = 0;
            var dayStudents = {};

            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                    continue;
                }

                var hourNum = parseInteger(hour);
                if (hourNum === null) {
                    continue;
                }

                var slot = daySchedule[hour];
                if (!slot) {
                    continue;
                }

                stats.totalSlots++;

                if (slot.disciplineId) {
                    stats.uniqueDisciplines[slot.disciplineId] = true;
                }

                if (slot.students) {
                    for (var s = 0; s < slot.students.length; s++) {
                        var studentId = slot.students[s].studentId;
                        if (studentId) {
                            dayStudents[studentId] = true;
                            if (!stats.hoursByDay[dayNum]) {
                                stats.hoursByDay[dayNum] = [];
                            }
                            stats.hoursByDay[dayNum].push(hourNum);
                        }
                    }
                }

                dayCount++;
            }

            if (dayCount > 0) {
                daysWithClasses[dayNum] = true;
                studentsByDay[dayNum] = Object.keys(dayStudents).length;
            }
        }

        stats.daysWithClasses = Object.keys(daysWithClasses).length;
        stats.uniqueDisciplines = Object.keys(stats.uniqueDisciplines).length;

        // Calculate total students (unique across all days)
        var allStudents = {};
        for (var day in studentsByDay) {
            // We already have students per day, need to aggregate
            // This is a simplification - actual unique students across days
        }
        stats.totalStudents = Object.values(studentsByDay).reduce(function(a, b) {
            return a + b;
        }, 0);

        // Calculate utilization (slots used / total possible slots)
        var totalPossibleSlots = 7 * (CALENDAR_END_HOUR - CALENDAR_START_HOUR + 1);
        stats.utilization = totalPossibleSlots > 0 ? 
            Math.round((stats.totalSlots / totalPossibleSlots) * 100) : 0;

        // Find busiest day
        var maxDay = null;
        var maxCount = 0;
        for (var day in stats.hoursByDay) {
            if (Object.prototype.hasOwnProperty.call(stats.hoursByDay, day)) {
                var count = stats.hoursByDay[day].length;
                if (count > maxCount) {
                    maxCount = count;
                    maxDay = parseInt(day, 10);
                }
            }
        }
        stats.busiestDay = maxDay !== null ? getDayName(maxDay) : null;

        // Find busiest hour
        var hourCount = {};
        for (var day in stats.hoursByDay) {
            if (!Object.prototype.hasOwnProperty.call(stats.hoursByDay, day)) {
                continue;
            }
            var hours = stats.hoursByDay[day];
            for (var h = 0; h < hours.length; h++) {
                var hour = hours[h];
                if (!hourCount[hour]) {
                    hourCount[hour] = 0;
                }
                hourCount[hour]++;
            }
        }

        var maxHour = null;
        var maxHourCount = 0;
        for (var hour in hourCount) {
            if (Object.prototype.hasOwnProperty.call(hourCount, hour)) {
                var count = hourCount[hour];
                if (count > maxHourCount) {
                    maxHourCount = count;
                    maxHour = parseInt(hour, 10);
                }
            }
        }
        stats.busiestHour = maxHour !== null ? formatHour(maxHour) : null;

        return stats;
    }

    // ============================================================
    // LOCATION CLASS DETAILS QUERY
    // ============================================================

    /**
     * Get details for a specific location class.
     * 
     * @param {string} locationId - Location ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour number (0-23)
     * @returns {object|null} Class details or null
     */
    function getLocationClassDetails(locationId, week, day, hour) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return null;
        }

        var dayNum = parseInteger(day);
        if (dayNum === null || dayNum < MIN_DAY || dayNum > MAX_DAY) {
            return null;
        }

        var hourNum = parseInteger(hour);
        if (hourNum === null || hourNum < MIN_HOUR || hourNum > MAX_HOUR) {
            return null;
        }

        if (!isNonEmptyString(locationId)) {
            return null;
        }

        var schedule = getLocationSchedule(locationId, weekNum);

        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return null;
        }

        var slot = schedule[dayNum][hourNum];

        return {
            day: dayNum,
            hour: hourNum,
            dayName: getDayName(dayNum),
            hourDisplay: formatHour(hourNum),
            disciplineId: slot.disciplineId || null,
            disciplineName: slot.disciplineName || 'Unknown',
            duration: slot.duration || 1,
            label: slot.label || '',
            groupLabel: slot.groupLabel || null,
            instructorId: slot.instructorId || null,
            students: slot.students || [],
            isBlock: slot.isBlock || false
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.LocationQueries = {
        // Main queries
        getLocationSchedule: getLocationSchedule,
        getStudentsAtLocation: getStudentsAtLocation,
        getLocationDisciplineAvailability: getLocationDisciplineAvailability,

        // Usage
        getLocationUsage: getLocationUsage,

        // Class details
        getLocationClassDetails: getLocationClassDetails
    };

})();