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

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.ScheduleCore || typeof window.ScheduleCore.getStudentSchedule !== 'function') {
        missing.push('ScheduleCore.getStudentSchedule');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.getStudentRestDays !== 'function') {
        missing.push('ScheduleCore.getStudentRestDays');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.hasConflict !== 'function') {
        missing.push('ScheduleCore.hasConflict');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.isRestDay !== 'function') {
        missing.push('ScheduleCore.isRestDay');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.findClassStart !== 'function') {
        missing.push('ScheduleCore.findClassStart');
    }
    if (!window.ScheduleCore || typeof window.ScheduleCore.getSlotMetadata !== 'function') {
        missing.push('ScheduleCore.getSlotMetadata');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getStudents !== 'function') {
        missing.push('CharacterQueries.getStudents');
    }
    if (!window.CharacterQueries || typeof window.CharacterQueries.getInstructors !== 'function') {
        missing.push('CharacterQueries.getInstructors');
    }

    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getDiscipline !== 'function') {
        missing.push('DisciplineQueries.getDiscipline');
    }
    if (!window.DisciplineQueries || typeof window.DisciplineQueries.getAvailableDisciplines !== 'function') {
        missing.push('DisciplineQueries.getAvailableDisciplines');
    }

    if (!window.LocationQueries || typeof window.LocationQueries.getLocation !== 'function') {
        missing.push('LocationQueries.getLocation');
    }
    if (!window.LocationQueries || typeof window.LocationQueries.getLocations !== 'function') {
        missing.push('LocationQueries.getLocations');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (missing.length > 0) {
        throw new Error('[CalendarQueries] Missing dependencies: ' + missing.join(', '));
    }

    window.__calendarQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ScheduleCore = window.ScheduleCore;
    var CharacterQueries = window.CharacterQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var LocationQueries = window.LocationQueries;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
   