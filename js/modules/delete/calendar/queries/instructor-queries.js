/**
 * modules/calendar/queries/instructor-queries.js - Instructor Calendar Queries
 * Read-only query layer for instructor calendar data
 * Path: js/modules/calendar/queries/instructor-queries.js
 * 
 * This module provides:
 *   - getInstructorSchedule - Complete instructor calendar view model
 *   - getInstructorTemplates - Instructor templates only
 *   - getInstructorBlocks - Instructor blocks only
 *   - getAssignedStudents - Students assigned to an instructor's class
 *   - getAvailableDisciplines - Disciplines an instructor can teach
 *   - getInstructorUsage - Instructor usage statistics
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations, no persistence
 *   - No DOM manipulation
 *   - No direct window.data access - uses canonical query modules
 *   - Returns VIEW-READY data (formatted, sorted, filtered)
 *   - Single source of truth for instructor calendar queries
 *   - Student schedules are the canonical source of truth for assignments
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.CalendarStudentCore (from calendar/core/student-core.js) - MANDATORY
 *   - window.CalendarInstructorCore (from calendar/core/instructor-core.js) - MANDATORY
 *   - window.CalendarScheduleCore (from calendar/core/schedule-core.js) - MANDATORY
 *   - window.CalendarMetadataCore (from calendar/core/metadata-core.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var IQ = window.InstructorQueries;
 *   var schedule = IQ.getInstructorSchedule(instructorId, week);
 *   var disciplines = IQ.getAvailableDisciplines(instructorId, week);
 *   var students = IQ.getAssignedStudents(instructorId, week, day, hour);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__instructorQueriesLoaded) {
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

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamsForCharacter !== 'function') {
        missing.push('TeamQueries.getTeamsForCharacter');
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

    if (!window.CalendarInstructorCore || typeof window.CalendarInstructorCore.getInstructorTemplates !== 'function') {
        missing.push('CalendarInstructorCore.getInstructorTemplates');
    }
    if (!window.CalendarInstructorCore || typeof window.CalendarInstructorCore.getInstructorBlocks !== 'function') {
        missing.push('CalendarInstructorCore.getInstructorBlocks');
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

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (missing.length > 0) {
        console.error('[InstructorQueries] Missing dependencies:', missing.join(', '));
        return;
    }

    window.__instructorQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var StudentCore = window.CalendarStudentCore;
    var InstructorCore = window.CalendarInstructorCore;
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

    // ============================================================
    // INSTRUCTOR SCHEDULE QUERY
    // ============================================================

    /**
     * Get complete instructor calendar view model.
     * Combines templates, blocks, and student assignments.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @returns {object} Instructor schedule view model
     */
    function getInstructorSchedule(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return {};
        }

        if (!isNonEmptyString(instructorId)) {
            return {};
        }

        var schedule = {};

        // Get instructor templates
        var templates = InstructorCore.getInstructorTemplates(instructorId, weekNum) || {};

        // Add templates to schedule
        for (var templateKey in templates) {
            if (!Object.prototype.hasOwnProperty.call(templates, templateKey)) {
                continue;
            }

            var parts = templateKey.split('_');
            if (parts.length !== 2) {
                continue;
            }

            var day = parseInteger(parts[0]);
            var hour = parseInteger(parts[1]);

            if (day === null || hour === null) {
                continue;
            }

            var template = templates[templateKey];
            if (!template) {
                continue;
            }

            if (!schedule[day]) {
                schedule[day] = {};
            }

            schedule[day][hour] = {
                disciplineId: template.disciplineId,
                label: template.label || '',
                groupLabel: template.groupLabel || '',
                duration: template.duration || 1,
                isTemplate: true,
                isBlock: false,
                assignedStudents: template.assignedStudents || [],
                students: [] // Will be populated from student schedules
            };
        }

        // Get instructor blocks
        var blocks = InstructorCore.getInstructorBlocks(instructorId, weekNum) || {};

        for (var blockDay in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, blockDay)) {
                continue;
            }

            var dayNum = parseInteger(blockDay);
            if (dayNum === null) {
                continue;
            }

            var dayBlocks = blocks[blockDay];
            if (!dayBlocks || typeof dayBlocks !== 'object') {
                continue;
            }

            for (var blockHour in dayBlocks) {
                if (!Object.prototype.hasOwnProperty.call(dayBlocks, blockHour)) {
                    continue;
                }

                var hourNum = parseInteger(blockHour);
                if (hourNum === null) {
                    continue;
                }

                var block = dayBlocks[blockHour];
                if (!block) {
                    continue;
                }

                if (!schedule[dayNum]) {
                    schedule[dayNum] = {};
                }

                schedule[dayNum][hourNum] = {
                    isBlock: true,
                    isTemplate: false,
                    label: block.label || 'Blocked Time',
                    groupLabel: block.groupLabel || null,
                    duration: block.duration || 1,
                    disciplineId: block.disciplineId || null,
                    assignedStudents: [],
                    students: []
                };
            }
        }

        // Get student assignments (canonical source of truth)
        var students = getStudents();

        for (var s = 0; s < students.length; s++) {
            var student = students[s];
            var studentSchedule = StudentCore.getStudentSchedule(student.id, weekNum) || {};

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

                    // Check if this class is taught by this instructor
                    var metadata = MetadataCore.getClassMetadata(
                        getMetadataStore(),
                        student.id,
                        weekNum,
                        dayNum,
                        hourNum
                    );

                    if (!metadata || String(metadata.instructorId) !== String(instructorId)) {
                        continue;
                    }

                    // Find the class start
                    var classStart = ScheduleCore.findClassStartHour(
                        studentSchedule,
                        getDurationsStore(),
                        student.id,
                        weekNum,
                        dayNum,
                        hourNum
                    );

                    if (!classStart) {
                        continue;
                    }

                    // Find or create slot
                    var slotDay = dayNum;
                    var slotHour = classStart.startHour;

                    if (!schedule[slotDay]) {
                        schedule[slotDay] = {};
                    }

                    if (!schedule[slotDay][slotHour]) {
                        // This is a class that exists but doesn't have a template
                        schedule[slotDay][slotHour] = {
                            disciplineId: disciplineId,
                            label: metadata.label || '',
                            groupLabel: metadata.groupLabel || null,
                            duration: classStart.duration || 1,
                            isTemplate: false,
                            isBlock: false,
                            assignedStudents: [],
                            students: []
                        };
                    }

                    // Add student to the slot
                    if (!schedule[slotDay][slotHour].students) {
                        schedule[slotDay][slotHour].students = [];
                    }

                    var studentEntry = {
                        studentId: student.id,
                        studentName: CharacterQueries.getDisplayName(student),
                        groupLabel: metadata.groupLabel || null
                    };

                    // Avoid duplicates
                    var exists = false;
                    for (var a = 0; a < schedule[slotDay][slotHour].students.length; a++) {
                        if (String(schedule[slotDay][slotHour].students[a].studentId) === String(student.id)) {
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

        // Add helper data
        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }

            var dayNum = parseInteger(day);
            if (dayNum === null) {
                continue;
            }

            var daySchedule = schedule[day];

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

                // Add display helpers
                slot.day = dayNum;
                slot.hour = hourNum;
                slot.dayName = getDayName(dayNum);
                slot.hourDisplay = formatHour(hourNum);

                if (slot.disciplineId) {
                    var discipline = DisciplineQueries.getDiscipline(slot.disciplineId);
                    slot.disciplineName = discipline ? discipline.name : 'Unknown';
                }

                if (!slot.isBlock && !slot.isTemplate && !slot.disciplineId) {
                    slot.disciplineId = null;
                    slot.disciplineName = null;
                }
            }
        }

        return schedule;
    }

    // ============================================================
    // METADATA STORE ACCESS
    // ============================================================

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
    // STUDENT QUERY
    // ============================================================

    /**
     * Get all students.
     * Uses CharacterQueries for canonical student data.
     * 
     * @returns {Array} Array of student characters
     */
    function getStudents() {
        return CharacterQueries.getStudents() || [];
    }

    // ============================================================
    // TEMPLATE QUERIES
    // ============================================================

    /**
     * Get instructor templates for a week.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @returns {object} Templates object
     */
    function getInstructorTemplates(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return {};
        }

        if (!isNonEmptyString(instructorId)) {
            return {};
        }

        return InstructorCore.getInstructorTemplates(instructorId, weekNum) || {};
    }

    /**
     * Get instructor blocks for a week.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @returns {object} Blocks object
     */
    function getInstructorBlocks(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return {};
        }

        if (!isNonEmptyString(instructorId)) {
            return {};
        }

        return InstructorCore.getInstructorBlocks(instructorId, weekNum) || {};
    }

    // ============================================================
    // ASSIGNED STUDENTS QUERY
    // ============================================================

    /**
     * Get students assigned to an instructor's class.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour number (0-23)
     * @returns {Array} Array of student objects with assignment details
     */
    function getAssignedStudents(instructorId, week, day, hour) {
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

        if (!isNonEmptyString(instructorId)) {
            return [];
        }

        var students = getStudents();
        var assigned = [];

        for (var s = 0; s < students.length; s++) {
            var student = students[s];
            var studentSchedule = StudentCore.getStudentSchedule(student.id, weekNum) || {};

            if (!studentSchedule[dayNum] || !studentSchedule[dayNum][hourNum]) {
                continue;
            }

            var disciplineId = studentSchedule[dayNum][hourNum];
            if (!disciplineId) {
                continue;
            }

            var metadata = MetadataCore.getClassMetadata(
                getMetadataStore(),
                student.id,
                weekNum,
                dayNum,
                hourNum
            );

            if (!metadata || String(metadata.instructorId) !== String(instructorId)) {
                continue;
            }

            assigned.push({
                studentId: student.id,
                studentName: CharacterQueries.getDisplayName(student),
                disciplineId: disciplineId,
                disciplineName: DisciplineQueries.getDiscipline(disciplineId) ? DisciplineQueries.getDiscipline(disciplineId).name : 'Unknown',
                groupLabel: metadata.groupLabel || null,
                label: metadata.label || '',
                startHour: hourNum,
                duration: metadata.duration || 1
            });
        }

        return assigned;
    }

    // ============================================================
    // AVAILABLE DISCIPLINES QUERY
    // ============================================================

    /**
     * Get disciplines an instructor can teach.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @returns {Array} Array of discipline objects
     */
    function getAvailableDisciplines(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return [];
        }

        if (!isNonEmptyString(instructorId)) {
            return [];
        }

        var disciplines = DisciplineQueries.getAvailableDisciplines(weekNum) || [];
        var available = [];

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d) {
                continue;
            }

            // Check if this instructor can teach this discipline
            if (d.instructorIds) {
                for (var j = 0; j < d.instructorIds.length; j++) {
                    if (String(d.instructorIds[j]) === String(instructorId)) {
                        available.push({
                            id: d.id,
                            name: d.name,
                            label: d.name,
                            subtitle: 'Available',
                            weeklyHours: d.weeklyHours || 0,
                            instructorIds: d.instructorIds || []
                        });
                        break;
                    }
                }
            }
        }

        return available;
    }

    // ============================================================
    // INSTRUCTOR USAGE QUERY
    // ============================================================

    /**
     * Get instructor usage statistics.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @returns {object} Usage statistics
     */
    function getInstructorUsage(instructorId, week) {
        var weekNum = parseInteger(week);
        if (weekNum === null || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return {
                totalSlots: 0,
                templateSlots: 0,
                blockSlots: 0,
                assignedStudents: 0,
                totalHours: 0,
                daysWithClasses: 0
            };
        }

        if (!isNonEmptyString(instructorId)) {
            return {
                totalSlots: 0,
                templateSlots: 0,
                blockSlots: 0,
                assignedStudents: 0,
                totalHours: 0,
                daysWithClasses: 0
            };
        }

        var schedule = getInstructorSchedule(instructorId, weekNum);
        var stats = {
            totalSlots: 0,
            templateSlots: 0,
            blockSlots: 0,
            assignedStudents: 0,
            totalHours: 0,
            daysWithClasses: 0
        };

        var daysWithClasses = {};

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

                var slot = daySchedule[hour];
                if (!slot) {
                    continue;
                }

                stats.totalSlots++;

                if (slot.isBlock) {
                    stats.blockSlots++;
                } else {
                    stats.templateSlots++;
                    stats.totalHours += slot.duration || 1;

                    if (slot.students) {
                        stats.assignedStudents += slot.students.length;
                    }
                }

                daysWithClasses[dayNum] = true;
            }
        }

        stats.daysWithClasses = Object.keys(daysWithClasses).length;

        return stats;
    }

    // ============================================================
    // INSTRUCTOR CLASS DETAILS QUERY
    // ============================================================

    /**
     * Get details for a specific instructor class.
     * 
     * @param {string} instructorId - Instructor ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour number (0-23)
     * @returns {object|null} Class details or null
     */
    function getClassDetails(instructorId, week, day, hour) {
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

        if (!isNonEmptyString(instructorId)) {
            return null;
        }

        var schedule = getInstructorSchedule(instructorId, weekNum);

        if (!schedule[dayNum] || !schedule[dayNum][hourNum]) {
            return null;
        }

        var slot = schedule[dayNum][hourNum];

        var result = {
            day: dayNum,
            hour: hourNum,
            dayName: getDayName(dayNum),
            hourDisplay: formatHour(hourNum),
            isBlock: slot.isBlock || false,
            isTemplate: slot.isTemplate || false,
            label: slot.label || '',
            groupLabel: slot.groupLabel || null,
            duration: slot.duration || 1,
            disciplineId: slot.disciplineId || null,
            disciplineName: slot.disciplineName || 'Unknown',
            students: slot.students || [],
            assignedStudents: slot.assignedStudents || []
        };

        if (slot.isBlock) {
            result.blockLabel = slot.label || 'Blocked Time';
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.InstructorQueries = {
        // Main queries
        getInstructorSchedule: getInstructorSchedule,
        getInstructorTemplates: getInstructorTemplates,
        getInstructorBlocks: getInstructorBlocks,

        // Student assignments
        getAssignedStudents: getAssignedStudents,

        // Disciplines
        getAvailableDisciplines: getAvailableDisciplines,

        // Usage
        getInstructorUsage: getInstructorUsage,

        // Class details
        getClassDetails: getClassDetails,

        // Helpers
        getStudents: getStudents
    };

})();