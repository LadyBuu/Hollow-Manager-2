/**
 * js/modules/calendar/core/index.js - Calendar Core Entry Point
 * Exports all core calendar mutation functions
 * Path: js/modules/calendar/core/index.js
 * 
 * This module combines all calendar core sub-modules into a single API.
 * All mutation functions are candidate-based and validate before commit.
 * 
 * SUB-MODULES:
 *   - student-core.js - Student schedule operations
 *   - instructor-core.js - Instructor template/block operations
 *   - location-core.js - Location schedule operations
 *   - grid-core.js - Shared grid helpers, overlap detection
 *   - metadata-core.js - Metadata helpers (classInstructors, classLabels, etc.)
 * 
 * IMPORTANT:
 *   - This is a THIN PUBLIC FACADE - delegates to canonical owners
 *   - No implementation logic - only delegation and dependency checking
 *   - This module does NOT call saveData() - callers own persistence
 *   - All ID normalisation uses canonical IdUtils when needed
 *   - All deep cloning uses ObjectUtils.deepClone (or structuredClone fallback)
 * 
 * DEPENDENCIES:
 *   - window.CalendarStudentCore (from core/student-core.js)
 *   - window.CalendarInstructorCore (from core/instructor-core.js)
 *   - window.CalendarLocationCore (from core/location-core.js)
 *   - window.CalendarGridCore (from core/grid-core.js)
 *   - window.CalendarMetadataCore (from core/metadata-core.js)
 * 
 * USAGE:
 *   var core = window.CalendarCore;
 *   var result = core.setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration);
 *   if (result && result.success) { console.log('Class added'); }
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.CalendarStudentCore) {
        console.error('[CalendarCore] CalendarStudentCore is required.');
        return;
    }

    if (!window.CalendarInstructorCore) {
        console.error('[CalendarCore] CalendarInstructorCore is required.');
        return;
    }

    if (!window.CalendarLocationCore) {
        console.error('[CalendarCore] CalendarLocationCore is required.');
        return;
    }

    if (!window.CalendarGridCore) {
        console.error('[CalendarCore] CalendarGridCore is required.');
        return;
    }

    if (!window.CalendarMetadataCore) {
        console.error('[CalendarCore] CalendarMetadataCore is required.');
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var StudentCore = window.CalendarStudentCore;
    var InstructorCore = window.CalendarInstructorCore;
    var LocationCore = window.CalendarLocationCore;
    var GridCore = window.CalendarGridCore;
    var MetadataCore = window.CalendarMetadataCore;

    // ============================================================
    // PUBLIC API - Delegates to canonical owners
    // ============================================================

    var CalendarCore = {
        // ============================================================
        // STUDENT SCHEDULE OPERATIONS
        // ============================================================

        /**
         * Get a student's schedule for a specific week.
         * Returns a cloned copy to prevent external mutation.
         */
        getStudentSchedule: StudentCore.getStudentSchedule,

        /**
         * Set a student's schedule class.
         * Candidate-based: validates, clones, modifies, commits.
         */
        setStudentScheduleClass: StudentCore.setStudentScheduleClass,

        /**
         * Remove a class from a student's schedule.
         * Candidate-based: validates, clones, modifies, commits.
         * Uses metadata to find the correct start hour.
         */
        removeStudentScheduleClass: StudentCore.removeStudentScheduleClass,

        /**
         * Duplicate a student's schedule from one week to another.
         * Candidate-based: validates, clones, modifies, commits.
         * Checks entire duration before copying.
         */
        duplicateStudentSchedule: StudentCore.duplicateStudentSchedule,

        /**
         * Clear a student's schedule for a week.
         * Candidate-based: validates, clones, modifies, commits.
         */
        clearStudentSchedule: StudentCore.clearStudentSchedule,

        /**
         * Get a student's rest days for a week.
         */
        getStudentRestDays: StudentCore.getStudentRestDays,

        /**
         * Set a student's rest days for a week.
         * Candidate-based: validates, clones, modifies, commits.
         */
        setStudentRestDays: StudentCore.setStudentRestDays,

        // ============================================================
        // INSTRUCTOR CALENDAR OPERATIONS
        // ============================================================

        /**
         * Get instructor class templates for a week.
         * Returns a cloned copy to prevent external mutation.
         */
        getInstructorTemplates: InstructorCore.getInstructorTemplates,

        /**
         * Set an instructor class template.
         * Candidate-based: validates, clones, modifies, commits.
         * Duration-aware overlap detection.
         */
        setInstructorTemplate: InstructorCore.setInstructorTemplate,

        /**
         * Remove an instructor class template.
         * Candidate-based: validates, clones, modifies, commits.
         */
        removeInstructorTemplate: InstructorCore.removeInstructorTemplate,

        /**
         * Get instructor blocks for a week.
         * Returns a cloned copy to prevent external mutation.
         */
        getInstructorBlocks: InstructorCore.getInstructorBlocks,

        /**
         * Set an instructor block.
         * Candidate-based: validates, clones, modifies, commits.
         * Duration-aware overlap detection.
         */
        setInstructorBlock: InstructorCore.setInstructorBlock,

        /**
         * Remove an instructor block.
         * Candidate-based: validates, clones, modifies, commits.
         */
        removeInstructorBlock: InstructorCore.removeInstructorBlock,

        // ============================================================
        // LOCATION SCHEDULE OPERATIONS
        // ============================================================

        /**
         * Get a location schedule for a week.
         * Returns a cloned copy to prevent external mutation.
         */
        getLocationSchedule: LocationCore.getLocationSchedule,

        /**
         * Assign a class to a location.
         * Candidate-based: validates, clones, modifies, commits.
         */
        setLocationClass: LocationCore.setLocationClass,

        /**
         * Remove a class from a location.
         * Candidate-based: validates, clones, modifies, commits.
         */
        removeLocationClass: LocationCore.removeLocationClass,

        /**
         * Clear a location schedule for a week.
         * Candidate-based: validates, clones, modifies, commits.
         */
        clearLocationSchedule: LocationCore.clearLocationSchedule,

        /**
         * Get the location of a class.
         * Resolves continuation hours to the class start.
         */
        getClassLocation: LocationCore.getClassLocation,

        /**
         * Set the location of a class.
         * Candidate-based: validates, clones, modifies, commits.
         */
        setClassLocation: LocationCore.setClassLocation,

        // ============================================================
        // SHARED GRID HELPERS
        // ============================================================

        /**
         * Build a grid from a schedule.
         * Distinguishes class starts from continuations.
         */
        buildGrid: GridCore.buildGrid,

        /**
         * Get occupied hours for a day.
         */
        getOccupiedHours: GridCore.getOccupiedHours,

        /**
         * Get available hours for a day.
         * Returns individual empty cells (not duration-aware).
         */
        getAvailableHours: GridCore.getAvailableHours,

        /**
         * Get available start hours for a given duration.
         * Duration-aware: checks if a class of the given duration can start at each hour.
         */
        getAvailableStartHours: GridCore.getAvailableStartHours,

        /**
         * Get continuous occupied hours of the same discipline.
         * Measures OCCUPIED HOURS, not class duration.
         */
        getContinuousOccupiedHours: GridCore.getContinuousOccupiedHours,

        /**
         * Check if a day has any occupied hours.
         */
        hasOccupiedHours: GridCore.hasOccupiedHours,

        /**
         * Get all occupied days in a schedule.
         */
        getOccupiedDays: GridCore.getOccupiedDays,

        /**
         * Get the total number of occupied hours in a schedule.
         */
        getTotalOccupiedHours: GridCore.getTotalOccupiedHours,

        /**
         * Get the total number of available hours in a schedule.
         */
        getTotalAvailableHours: GridCore.getTotalAvailableHours,

        // ============================================================
        // METADATA HELPERS
        // ============================================================

        /**
         * Get class metadata for a specific hour.
         * Returns null if the hour is not a class start.
         */
        getClassMetadata: MetadataCore.getClassMetadata,

        /**
         * Get valid class duration from curriculum metadata.
         */
        getValidClassDuration: MetadataCore.getValidClassDuration,

        /**
         * Check if a class has valid metadata.
         */
        hasClassMetadata: MetadataCore.hasClassMetadata,

        /**
         * Get all metadata keys for a student and week.
         */
        getKeysForStudentWeek: MetadataCore.getKeysForStudentWeek,

        /**
         * Get a metadata store by key.
         */
        getStore: MetadataCore.getStore,

        // ============================================================
        // CONSTANTS
        // ============================================================

        /**
         * Calendar constants (bounds, formatting).
         * @deprecated Use window.CalendarConstants directly.
         */
        constants: window.CalendarConstants,

        /**
         * Grid core constants.
         */
        CALENDAR_START_HOUR: GridCore.CALENDAR_START_HOUR,
        CALENDAR_END_HOUR: GridCore.CALENDAR_END_HOUR,
        MAX_DURATION: GridCore.MAX_DURATION,
        DAY_NAMES: GridCore.DAY_NAMES
    };

    // ============================================================
    // SET LOADED FLAG
    // ============================================================

    window.__calendarCoreLoaded = true;

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarCore = CalendarCore;

})();