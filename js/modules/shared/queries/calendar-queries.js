/**
 * shared/queries/calendar-queries.js - Calendar Queries
 * Read-only calendar/schedule queries
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - NO dependencies on ScheduleCore
 *   - NO dependencies on MutationUtils
 *   - NO UI dependencies
 *   - Reads window.data.curriculum directly
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state)
 *   - CalendarConstants (for bounds)
 *   - CalendarValidation (for validation) - if available
 */

(function() {
    'use strict';

    if (window.__calendarQueriesLoaded) { return; }
    window.__calendarQueriesLoaded = true;

    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    function getCurriculum() {
        var data = window.data || {};
        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return {};
        }
        return data.curriculum;
    }

    function getScheduleData() {
        var curriculum = getCurriculum();
        return curriculum.schedules || {};
    }

    function getRestDaysData() {
        var curriculum = getCurriculum();
        return curriculum.restDays || {};
    }

    function getMetadataData() {
        var curriculum = getCurriculum();
        return curriculum.metadata || {};
    }

    function getInstructorTemplatesData() {
        var curriculum = getCurriculum();
        return curriculum.instructorTemplates || {};
    }

    function getInstructorBlocksData() {
        var curriculum = getCurriculum();
        return curriculum.instructorBlocks || {};
    }

    function getLocationSchedulesData() {
        var curriculum = getCurriculum();
        return curriculum.locationSchedules || {};
    }

    // ============================================================
    // STUDENT SCHEDULE QUERIES
    // ============================================================

    function getStudentSchedule(studentId, week) {
        var weekNum = CalendarConstants.isValidWeek ? CalendarConstants.isValidWeek(week) : parseInt(week, 10);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !studentId) {
            return {};
        }

        var schedules = getScheduleData();
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return {};
        }

        return schedules[studentId][weekNum];
    }

    function getStudentRestDays(studentId, week) {
        var weekNum = CalendarConstants.isValidWeek ? CalendarConstants.isValidWeek(week) : parseInt(week, 10);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !studentId) {
            return [];
        }

        var restDays = getRestDaysData();
        if (!restDays[studentId] || !restDays[studentId][weekNum]) {
            return [];
        }

        return restDays[studentId][weekNum].slice();
    }

    function getSlotMetadata(studentId, week, day, hour) {
        var weekNum = CalendarConstants.isValidWeek ? CalendarConstants.isValidWeek(week) : parseInt(week, 10);
        var dayNum = CalendarConstants.isValidDay ? CalendarConstants.isValidDay(day) : parseInt(day, 10);
        var hourNum = CalendarConstants.isValidHour ? CalendarConstants.isValidHour(hour) : parseInt(hour, 10);

        if (weekNum === null || weekNum === undefined || isNaN(weekNum) ||
            dayNum === null || dayNum === undefined || isNaN(dayNum) ||
            hourNum === null || hourNum === undefined || isNaN(hourNum) ||
            !studentId) {
            return null;
        }

        var metadata = getMetadataData();
        var key = String(studentId) + '_' + String(weekNum) + '_' + String(dayNum) + '_' + String(hourNum);
        return metadata[key] || null;
    }

    // ============================================================
    // INSTRUCTOR SCHEDULE QUERIES
    // ============================================================

    function getInstructorTemplates(instructorId, week) {
        var weekNum = CalendarConstants.isValidWeek ? CalendarConstants.isValidWeek(week) : parseInt(week, 10);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !instructorId) {
            return {};
        }

        var templates = getInstructorTemplatesData();
        if (!templates[instructorId] || !templates[instructorId][weekNum]) {
            return {};
        }

        return templates[instructorId][weekNum];
    }

    function getInstructorBlocks(instructorId, week) {
        var weekNum = CalendarConstants.isValidWeek ? CalendarConstants.isValidWeek(week) : parseInt(week, 10);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !instructorId) {
            return {};
        }

        var blocks = getInstructorBlocksData();
        if (!blocks[instructorId] || !blocks[instructorId][weekNum]) {
            return {};
        }

        return blocks[instructorId][weekNum];
    }

    // ============================================================
    // LOCATION SCHEDULE QUERIES
    // ============================================================

    function getLocationSchedule(locationId, week) {
        var weekNum = CalendarConstants.isValidWeek ? CalendarConstants.isValidWeek(week) : parseInt(week, 10);
        if (weekNum === null || weekNum === undefined || isNaN(weekNum) || !locationId) {
            return {};
        }

        var schedules = getLocationSchedulesData();
        if (!schedules[locationId] || !schedules[locationId][weekNum]) {
            return {};
        }

        return schedules[locationId][weekNum];
    }

    // ============================================================
    // CONFLICT DETECTION
    // ============================================================

    function hasConflict(schedule, day, hour, duration) {
        var dayNum = CalendarConstants.isValidDay ? CalendarConstants.isValidDay(day) : parseInt(day, 10);
        var hourNum = CalendarConstants.isValidHour ? CalendarConstants.isValidHour(hour) : parseInt(hour, 10);
        var durationNum = CalendarConstants.isValidDuration ? CalendarConstants.isValidDuration(duration) : parseInt(duration, 10);

        if (dayNum === null || dayNum === undefined || isNaN(dayNum) ||
            hourNum === null || hourNum === undefined || isNaN(hourNum) ||
            durationNum === null || durationNum === undefined || isNaN(durationNum)) {
            return true;
        }

        if (!schedule || !schedule[dayNum]) {
            return false;
        }

        var maxHour = Math.min(hourNum + durationNum, CalendarConstants.MAX_HOUR + 1);
        for (var h = hourNum; h < maxHour; h++) {
            if (schedule[dayNum][h]) {
                return true;
            }
        }

        return false;
    }

    function isRestDay(restDays, day) {
        if (!Array.isArray(restDays)) { return false; }
        var dayNum = CalendarConstants.isValidDay ? CalendarConstants.isValidDay(day) : parseInt(day, 10);
        if (dayNum === null || dayNum === undefined || isNaN(dayNum)) { return false; }
        return restDays.indexOf(dayNum) !== -1;
    }

    function findClassStart(schedule, metadata, studentId, week, day, hour) {
        var dayNum = CalendarConstants.isValidDay ? CalendarConstants.isValidDay(day) : parseInt(day, 10);
        var hourNum = CalendarConstants.isValidHour ? CalendarConstants.isValidHour(hour) : parseInt(hour, 10);
        var weekNum = CalendarConstants.isValidWeek ? CalendarConstants.isValidWeek(week) : parseInt(week, 10);

        if (dayNum === null || dayNum === undefined || isNaN(dayNum) ||
            hourNum === null || hourNum === undefined || isNaN(hourNum) ||
            weekNum === null || weekNum === undefined || isNaN(weekNum) ||
            !schedule || !schedule[dayNum]) {
            return null;
        }

        var disciplineId = schedule[dayNum][hourNum];
        if (!disciplineId) { return null; }

        var key = String(studentId) + '_' + String(weekNum) + '_' + String(dayNum) + '_' + String(hourNum);
        var meta = metadata && metadata[key] ? metadata[key] : null;

        if (meta && meta.duration) {
            var duration = CalendarConstants.isValidDuration ? CalendarConstants.isValidDuration(meta.duration) : parseInt(meta.duration, 10);
            if (duration !== null && duration !== undefined && !isNaN(duration)) {
                var actualDuration = 1;
                for (var h = hourNum + 1; h < hourNum + duration && h <= CalendarConstants.MAX_HOUR; h++) {
                    if (String(schedule[dayNum][h]) === String(disciplineId)) {
                        actualDuration++;
                    } else {
                        break;
                    }
                }
                if (duration === actualDuration) {
                    return {
                        startHour: hourNum,
                        duration: duration,
                        disciplineId: disciplineId,
                        key: key,
                        metadata: meta
                    };
                }
            }
        }

        // Search backwards for a metadata-defined class start
        for (var candidate = hourNum - 1; candidate >= 0; candidate--) {
            if (String(schedule[dayNum][candidate]) !== String(disciplineId)) {
                break;
            }

            var candidateKey = String(studentId) + '_' + String(weekNum) + '_' + String(dayNum) + '_' + String(candidate);
            var candidateMeta = metadata && metadata[candidateKey] ? metadata[candidateKey] : null;

            if (candidateMeta && candidateMeta.duration) {
                var candidateDuration = CalendarConstants.isValidDuration ? CalendarConstants.isValidDuration(candidateMeta.duration) : parseInt(candidateMeta.duration, 10);
                if (candidateDuration !== null && candidateDuration !== undefined && !isNaN(candidateDuration)) {
                    var actualDuration = 1;
                    for (var h2 = candidate + 1; h2 < candidate + candidateDuration && h2 <= CalendarConstants.MAX_HOUR; h2++) {
                        if (String(schedule[dayNum][h2]) === String(disciplineId)) {
                            actualDuration++;
                        } else {
                            break;
                        }
                    }
                    if (actualDuration === candidateDuration) {
                        if (hourNum < candidate + candidateDuration) {
                            return {
                                startHour: candidate,
                                duration: candidateDuration,
                                disciplineId: disciplineId,
                                key: candidateKey,
                                metadata: candidateMeta
                            };
                        }
                    }
                    break;
                }
            }
        }

        return {
            startHour: hourNum,
            duration: 1,
            disciplineId: disciplineId,
            key: key,
            metadata: null
        };
    }

    window.CalendarQueries = {
        // Student
        getStudentSchedule: getStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        getSlotMetadata: getSlotMetadata,

        // Instructor
        getInstructorTemplates: getInstructorTemplates,
        getInstructorBlocks: getInstructorBlocks,

        // Location
        getLocationSchedule: getLocationSchedule,

        // Conflict
        hasConflict: hasConflict,
        isRestDay: isRestDay,
        findClassStart: findClassStart
    };

})();
