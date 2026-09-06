/**
 * js/modules/calendar/core/metadata-core.js - Calendar Metadata Core
 * Metadata helpers for the calendar system
 * Path: js/modules/calendar/core/metadata-core.js
 * 
 * This module handles:
 *   - Class metadata retrieval (instructor, label, duration, location)
 *   - Metadata candidate building and committing
 *   - Metadata cleanup operations (delete, clear by prefix)
 *   - Class metadata setting and copying
 * 
 * IMPORTANT:
 *   - No application/global state mutation - only mutates supplied objects
 *   - All deep cloning uses ObjectUtils.deepClone (MANDATORY)
 *   - All ID normalisation is consistent
 *   - Metadata is stored ONLY at the START hour of a class, not at every occupied hour
 *   - scheduleKey = studentId + '_' + week + '_' + day + '_' + hour
 *   - duration metadata is MANDATORY for all class starts
 * 
 * METADATA KEYS:
 *   - classInstructors: { [scheduleKey]: instructorId }
 *   - classLabels: { [scheduleKey]: label }
 *   - classGroupLabels: { [scheduleKey]: groupLabel }
 *   - classDurations: { [scheduleKey]: duration }
 *   - classLocations: { [scheduleKey]: locationId }
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarScheduleCore (from schedule-core.js) - MANDATORY
 * 
 * USAGE:
 *   var MC = window.CalendarMetadataCore;
 *   var metadata = MC.getClassMetadata(curriculum, studentId, week, day, hour);
 *   var candidates = MC.buildCandidates(curriculum);
 *   MC.setClassMetadata(candidates, key, { duration: 2, instructorId: '...' });
 *   MC.commitCandidates(curriculum, candidates);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarMetadataCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        console.error('[CalendarMetadataCore] ObjectUtils.deepClone is required.');
        return;
    }

    if (!window.CalendarConstants) {
        console.error('[CalendarMetadataCore] CalendarConstants is required.');
        return;
    }

    if (!window.CalendarScheduleCore) {
        console.error('[CalendarMetadataCore] CalendarScheduleCore is required.');
        return;
    }

    var ObjectUtils = window.ObjectUtils;
    var CalendarConstants = window.CalendarConstants;
    var ScheduleCore = window.CalendarScheduleCore;

    // ============================================================
    // CONSTANTS - INTERNAL (not exposed)
    // ============================================================

    var METADATA_KEYS = Object.freeze([
        'classInstructors',
        'classLabels',
        'classGroupLabels',
        'classDurations',
        'classLocations'
    ]);

    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function parseInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) ? num : null;
    }

    function getScheduleKey(studentId, week, day, hour) {
        return ScheduleCore.getScheduleKey(studentId, week, day, hour);
    }

    function validateDuration(value) {
        var num = parseInteger(value);
        if (num === null || num < 1 || num > MAX_DURATION) {
            return null;
        }
        return num;
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    // ============================================================
    // METADATA RETRIEVAL
    // ============================================================

    /**
     * Get class metadata for a specific hour.
     * Returns null if the hour is not a class start (no valid duration metadata).
     * 
     * @param {object} curriculum - Curriculum object with metadata stores
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour number (0-23)
     * @returns {object|null} { key, instructorId, label, groupLabel, duration, locationId } or null
     */
    function getClassMetadata(curriculum, studentId, week, day, hour) {
        if (!curriculum || typeof curriculum !== 'object') {
            return null;
        }

        var key = getScheduleKey(studentId, week, day, hour);
        var duration = getValidClassDuration(curriculum, key);

        if (duration === null) {
            return null;
        }

        return {
            key: key,
            instructorId: curriculum.classInstructors ? curriculum.classInstructors[key] : null,
            label: curriculum.classLabels ? curriculum.classLabels[key] || '' : '',
            groupLabel: curriculum.classGroupLabels ? curriculum.classGroupLabels[key] || null : null,
            duration: duration,
            locationId: curriculum.classLocations ? curriculum.classLocations[key] : null
        };
    }

    /**
     * Get valid class duration from curriculum metadata.
     * Returns null if no valid duration exists.
     * 
     * @param {object} curriculum - Curriculum object with classDurations
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {number|null} Duration or null if invalid
     */
    function getValidClassDuration(curriculum, key) {
        if (!curriculum || !curriculum.classDurations) {
            return null;
        }

        var duration = curriculum.classDurations[key];
        if (duration === undefined || duration === null) {
            return null;
        }

        return validateDuration(duration);
    }

    // ============================================================
    // METADATA CANDIDATE BUILDING
    // ============================================================

    /**
     * Build candidate copies of all curriculum metadata stores.
     * Returns an object with all metadata candidates, or null on failure.
     * 
     * @param {object} curriculum - Curriculum object with metadata stores
     * @returns {object|null} Metadata candidates object or null
     */
    function buildCandidates(curriculum) {
        if (!curriculum || typeof curriculum !== 'object') {
            return null;
        }

        var metadata = {};

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            var source = curriculum[key];

            // Validate store shape
            if (source !== undefined && !isObject(source)) {
                // If the store exists but is not an object, treat as corrupted
                // Return null to indicate failure
                return null;
            }

            var cloned = deepClone(source || {});
            if (cloned === null) {
                return null;
            }
            metadata[key] = cloned;
        }

        return metadata;
    }

    /**
     * Commit metadata candidates to the curriculum.
     * 
     * @param {object} curriculum - Curriculum object to commit to
     * @param {object} candidates - Metadata candidates object
     */
    function commitCandidates(curriculum, candidates) {
        if (!curriculum || typeof curriculum !== 'object') {
            return;
        }

        if (!candidates || typeof candidates !== 'object') {
            return;
        }

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            if (candidates[key] !== undefined) {
                curriculum[key] = candidates[key];
            }
        }
    }

    // ============================================================
    // METADATA MUTATION (on candidates)
    // ============================================================

    /**
     * Set metadata for a class key on candidate objects.
     * Partial update: only provided fields are updated.
     * 
     * @param {object} candidates - Metadata candidates object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @param {object} data - Metadata data
     * @param {string} data.instructorId - Instructor ID (optional)
     * @param {string} data.label - Label (optional)
     * @param {string} data.groupLabel - Group label (optional)
     * @param {number} data.duration - Duration (optional)
     * @param {string} data.locationId - Location ID (optional)
     * @returns {boolean} True if successful
     */
    function setClassMetadata(candidates, key, data) {
        if (!candidates || typeof candidates !== 'object') {
            return false;
        }

        if (!key || typeof key !== 'string') {
            return false;
        }

        if (!data || typeof data !== 'object') {
            return false;
        }

        // Duration validation - reject invalid duration
        if (data.duration !== undefined && data.duration !== null) {
            var duration = validateDuration(data.duration);
            if (duration === null) {
                return false;
            }
            candidates.classDurations[key] = duration;
        }

        // Instructor
        if (data.instructorId !== undefined) {
            if (data.instructorId === null) {
                delete candidates.classInstructors[key];
            } else {
                candidates.classInstructors[key] = String(data.instructorId);
            }
        }

        // Label
        if (data.label !== undefined) {
            if (data.label === null) {
                delete candidates.classLabels[key];
            } else {
                candidates.classLabels[key] = String(data.label);
            }
        }

        // Group label
        if (data.groupLabel !== undefined) {
            if (data.groupLabel === null) {
                delete candidates.classGroupLabels[key];
            } else {
                candidates.classGroupLabels[key] = String(data.groupLabel);
            }
        }

        // Location
        if (data.locationId !== undefined) {
            if (data.locationId === null) {
                delete candidates.classLocations[key];
            } else {
                candidates.classLocations[key] = String(data.locationId);
            }
        }

        return true;
    }

    /**
     * Copy all metadata for a class from one key to another.
     * 
     * @param {object} candidates - Metadata candidates object
     * @param {string} sourceKey - Source schedule key
     * @param {string} targetKey - Target schedule key
     * @returns {boolean} True if successful
     */
    function copyClassMetadata(candidates, sourceKey, targetKey) {
        if (!candidates || typeof candidates !== 'object') {
            return false;
        }

        if (!sourceKey || !targetKey) {
            return false;
        }

        var success = true;

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var storeKey = METADATA_KEYS[i];
            var store = candidates[storeKey];

            if (!store || typeof store !== 'object') {
                continue;
            }

            if (store[sourceKey] !== undefined) {
                // Deep clone the value to prevent reference sharing
                var value = deepClone(store[sourceKey]);
                if (value === null) {
                    success = false;
                    continue;
                }
                store[targetKey] = value;
            }
        }

        return success;
    }

    // ============================================================
    // METADATA CLEANUP (on candidates)
    // ============================================================

    /**
     * Delete all metadata for a specific class key.
     * 
     * @param {object} candidates - Metadata candidates object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     */
    function deleteClassMetadata(candidates, key) {
        if (!candidates || typeof candidates !== 'object') {
            return;
        }

        if (!key || typeof key !== 'string') {
            return;
        }

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var storeKey = METADATA_KEYS[i];
            var store = candidates[storeKey];
            if (store && store[key] !== undefined) {
                delete store[key];
            }
        }
    }

    /**
     * Clear metadata for a given prefix.
     * Used for bulk cleanup operations (e.g., clearing a student's week).
     * 
     * @param {object} candidates - Metadata candidates object
     * @param {string} prefix - Prefix to match (e.g., 'studentId_week_')
     */
    function clearMetadataForPrefix(candidates, prefix) {
        if (!candidates || typeof candidates !== 'object') {
            return;
        }

        if (!prefix || typeof prefix !== 'string') {
            return;
        }

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var storeKey = METADATA_KEYS[i];
            var store = candidates[storeKey];
            if (!store || typeof store !== 'object') {
                continue;
            }

            for (var metadataKey in store) {
                if (Object.prototype.hasOwnProperty.call(store, metadataKey) &&
                    metadataKey.indexOf(prefix) === 0) {
                    delete store[metadataKey];
                }
            }
        }
    }

    // ============================================================
    // METADATA QUERIES (on candidates/curriculum)
    // ============================================================

    /**
     * Check if a class has metadata at a specific key.
     * 
     * @param {object} curriculum - Curriculum object with classDurations
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {boolean} True if the class has valid duration metadata
     */
    function hasClassMetadata(curriculum, key) {
        return getValidClassDuration(curriculum, key) !== null;
    }

    /**
     * Get all metadata keys for a student and week.
     * 
     * @param {object} curriculum - Curriculum object with classDurations
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @returns {Array} Array of metadata keys (full schedule keys)
     */
    function getKeysForStudentWeek(curriculum, studentId, week) {
        if (!curriculum || !curriculum.classDurations) {
            return [];
        }

        var prefix = String(studentId) + '_' + String(week) + '_';
        var keys = [];

        for (var key in curriculum.classDurations) {
            if (Object.prototype.hasOwnProperty.call(curriculum.classDurations, key) &&
                key.indexOf(prefix) === 0) {
                var duration = getValidClassDuration(curriculum, key);
                if (duration !== null) {
                    keys.push(key);
                }
            }
        }

        return keys;
    }

    /**
     * Get metadata store by key from curriculum.
     * 
     * @param {object} curriculum - Curriculum object
     * @param {string} storeKey - Metadata store key
     * @returns {object} Metadata store or empty object
     */
    function getStore(curriculum, storeKey) {
        if (!curriculum || typeof curriculum !== 'object') {
            return {};
        }

        if (METADATA_KEYS.indexOf(storeKey) === -1) {
            return {};
        }

        return curriculum[storeKey] || {};
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.__calendarMetadataCoreLoaded = true;

    window.CalendarMetadataCore = {
        // Retrieval
        getClassMetadata: getClassMetadata,
        getValidClassDuration: getValidClassDuration,

        // Candidate building and committing
        buildCandidates: buildCandidates,
        commitCandidates: commitCandidates,

        // Metadata mutation (on candidates)
        setClassMetadata: setClassMetadata,
        copyClassMetadata: copyClassMetadata,

        // Cleanup (on candidates)
        deleteClassMetadata: deleteClassMetadata,
        clearMetadataForPrefix: clearMetadataForPrefix,

        // Queries
        hasClassMetadata: hasClassMetadata,
        getKeysForStudentWeek: getKeysForStudentWeek,
        getStore: getStore,

        // Constants (read-only)
        METADATA_KEYS: METADATA_KEYS,
        MAX_DURATION: MAX_DURATION
    };

})();