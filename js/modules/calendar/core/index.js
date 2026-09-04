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
 *   - All mutations are candidate-based: validate, clone, modify, commit
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All ID normalisation uses Schema.normaliseId (or local equivalent)
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
 *   var result = core.setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId);
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
        return;
    }

    if (!window.CalendarInstructorCore) {
        return;
    }

    if (!window.CalendarLocationCore) {
        return;
    }

    if (!window.CalendarGridCore) {
        return;
    }

    if (!window.CalendarMetadataCore) {
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
    // COMBINE ALL CORE FUNCTIONS
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
         * Cleans stale metadata when setting a new class.
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
         * Get available slots for a day.
         */
        getAvailableSlots: GridCore.getAvailableSlots,

        /**
         * Check if a slot has a conflict.
         * Duration-aware.
         */
        hasConflict: GridCore.hasConflict,

        /**
         * Get continuous occupied hours of the same discipline.
         * Measures occupied hours, not class duration.
         */
        getContinuousOccupiedHours: GridCore.getContinuousOccupiedHours,

        /**
         * Check if a new duration-based entry overlaps with existing entries.
         */
        hasDurationOverlap: GridCore.hasDurationOverlap,

        /**
         * Check if a student schedule slot has conflicts.
         * Duration-aware.
         */
        hasStudentScheduleConflict: GridCore.hasStudentScheduleConflict,

        /**
         * Find the class start hour for a given occupied hour.
         * Uses metadata to find the start, with occupancy fallback.
         */
        findClassStartHour: GridCore.findClassStartHour,

        /**
         * Validate that occupied hours match the expected duration.
         */
        validateOccupiedDuration: GridCore.validateOccupiedDuration,

        /**
         * Validate the integrity of a schedule.
         */
        validateScheduleIntegrity: GridCore.validateScheduleIntegrity,

        // ============================================================
        // METADATA HELPERS
        // ============================================================

        /**
         * Get class metadata for a specific hour.
         * Returns null if the hour is not a class start.
         */
        getClassMetadata: MetadataCore.getClassMetadata,

        /**
         * Get valid class duration from metadata.
         */
        getValidClassDuration: MetadataCore.getValidClassDuration,

        /**
         * Build candidate copies of all curriculum metadata stores.
         */
        buildMetadataCandidates: MetadataCore.buildMetadataCandidates,

        /**
         * Commit metadata candidates to the curriculum.
         */
        commitMetadataCandidates: MetadataCore.commitMetadataCandidates,

        /**
         * Clear metadata for a given prefix.
         */
        clearMetadataForPrefix: MetadataCore.clearMetadataForPrefix,

        /**
         * Delete all metadata for a specific class key.
         */
        deleteClassMetadata: MetadataCore.deleteClassMetadata,

        // ============================================================
        // UTILITIES
        // ============================================================

        /**
         * Get a schedule key for a student, week, day, and hour.
         */
        getScheduleKey: function(studentId, week, day, hour) {
            return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
        },

        /**
         * Validate a week number.
         */
        validateWeek: function(value) {
            var num = parseInt(value, 10);
            var minWeek = 1;
            var maxWeek = 52;
            return (!isNaN(num) && num >= minWeek && num <= maxWeek) ? num : null;
        },

        /**
         * Validate a day number.
         */
        validateDay: function(value) {
            var num = parseInt(value, 10);
            return (!isNaN(num) && num >= 1 && num <= 7) ? num : null;
        },

        /**
         * Validate an hour number.
         */
        validateHour: function(value) {
            var num = parseInt(value, 10);
            return (!isNaN(num) && num >= 0 && num <= 23) ? num : null;
        },

        /**
         * Validate a duration.
         */
        validateDuration: function(value) {
            var num = parseInt(value, 10);
            return (!isNaN(num) && num >= 1 && num <= 4) ? num : null;
        },

        /**
         * Validate a schedule slot.
         */
        validateScheduleSlot: function(studentId, week, day, hour) {
            if (!studentId || typeof studentId !== 'string' || studentId.trim() === '') {
                return { success: false, message: 'Student ID is required.' };
            }

            var weekNum = this.validateWeek(week);
            if (weekNum === null) {
                return { success: false, message: 'Valid week is required (1-52).' };
            }

            var dayNum = this.validateDay(day);
            if (dayNum === null) {
                return { success: false, message: 'Valid day is required (1-7).' };
            }

            var hourNum = this.validateHour(hour);
            if (hourNum === null) {
                return { success: false, message: 'Valid hour is required (0-23).' };
            }

            return {
                success: true,
                data: {
                    studentId: String(studentId).trim(),
                    week: weekNum,
                    day: dayNum,
                    hour: hourNum
                }
            };
        },

        /**
         * Normalise an ID to a string.
         */
        normaliseId: function(value) {
            if (value === undefined || value === null) {
                return null;
            }
            var str = String(value).trim();
            return str !== '' ? str : null;
        },

        /**
         * Normalise an array of IDs to strings.
         */
        normaliseIdArray: function(arr) {
            if (!Array.isArray(arr)) {
                return [];
            }
            var result = [];
            for (var i = 0; i < arr.length; i++) {
                var id = this.normaliseId(arr[i]);
                if (id !== null && result.indexOf(id) === -1) {
                    result.push(id);
                }
            }
            return result;
        }
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
