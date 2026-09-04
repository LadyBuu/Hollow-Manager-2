/**
 * js/modules/calendar/core/metadata-core.js - Calendar Metadata Core
 * Metadata helpers for the calendar system
 * Path: js/modules/calendar/core/metadata-core.js
 * 
 * This module handles:
 *   - Class metadata retrieval (instructor, label, duration, location)
 *   - Metadata candidate building and committing
 *   - Metadata cleanup operations (delete, clear by prefix)
 * 
 * IMPORTANT:
 *   - This module is PURE - no side effects, no data mutation (except through provided functions)
 *   - All deep cloning uses ObjectUtils.deepClone (or structuredClone fallback)
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
 *   - window.ObjectUtils (from object-utils.js)
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarMetadataCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        return;
    }

    window.__calendarMetadataCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var METADATA_KEYS = ['classInstructors', 'classLabels', 'classGroupLabels', 'classDurations', 'classLocations'];

    // ============================================================
    // HELPERS
    // ============================================================

    function deepClone(value) {
        return window.ObjectUtils.deepClone(value);
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function validateDuration(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 4) ? num : null;
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    // ============================================================
    // METADATA RETRIEVAL
    // ============================================================

    /**
     * Get class metadata for a specific hour.
     * Returns null if the hour is not a class start (no duration metadata).
     * Validates duration is between 1 and 4.
     * 
     * @param {object} metadata - Metadata object with classDurations, classInstructors, etc.
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @param {number} day - Day number (1-7)
     * @param {number} hour - Hour number (0-23)
     * @returns {object|null} { key, instructorId, label, groupLabel, duration, locationId } or null
     */
    function getClassMetadata(metadata, studentId, week, day, hour) {
        var key = getScheduleKey(studentId, week, day, hour);

        var duration = getValidClassDuration(metadata, key);

        if (duration === null) {
            return null;
        }

        return {
            key: key,
            instructorId: metadata.classInstructors
                ? metadata.classInstructors[key]
                : null,
            label: metadata.classLabels
                ? metadata.classLabels[key] || ''
                : '',
            groupLabel: metadata.classGroupLabels
                ? metadata.classGroupLabels[key]
                : null,
            duration: duration,
            locationId: metadata.classLocations
                ? metadata.classLocations[key]
                : null
        };
    }

    /**
     * Get valid class duration from metadata.
     * Returns null if no valid duration exists.
     * 
     * @param {object} metadata - Metadata object with classDurations
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {number|null} Duration or null if invalid
     */
    function getValidClassDuration(metadata, key) {
        if (!metadata || !metadata.classDurations) {
            return null;
        }
        var duration = metadata.classDurations[key];
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
    function buildMetadataCandidates(curriculum) {
        var metadata = {};

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            var source = curriculum && curriculum[key] ? curriculum[key] : {};
            var cloned = deepClone(source);
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
     * @param {object} metadataCandidates - Metadata candidates object
     */
    function commitMetadataCandidates(curriculum, metadataCandidates) {
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            curriculum[key] = metadataCandidates[key];
        }
    }

    // ============================================================
    // METADATA CLEANUP
    // ============================================================

    /**
     * Clear metadata for a given prefix.
     * Used for bulk cleanup operations.
     * 
     * @param {object} metadataCandidates - Metadata candidates object
     * @param {string} prefix - Prefix to match (e.g., 'studentId_week_')
     */
    function clearMetadataForPrefix(metadataCandidates, prefix) {
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var storeKey = METADATA_KEYS[i];
            var store = metadataCandidates[storeKey];
            if (!store) {
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

    /**
     * Delete all metadata for a specific class key.
     * 
     * @param {object} metadataCandidates - Metadata candidates object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     */
    function deleteClassMetadata(metadataCandidates, key) {
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var storeKey = METADATA_KEYS[i];
            var store = metadataCandidates[storeKey];
            if (store && store[key] !== undefined) {
                delete store[key];
            }
        }
    }

    /**
     * Check if a class has metadata at a specific key.
     * 
     * @param {object} metadata - Metadata object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {boolean} True if the class has duration metadata
     */
    function hasClassMetadata(metadata, key) {
        if (!metadata || !metadata.classDurations) {
            return false;
        }
        return metadata.classDurations[key] !== undefined && metadata.classDurations[key] !== null;
    }

    /**
     * Get all metadata keys for a student and week.
     * 
     * @param {object} metadata - Metadata object
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @returns {array} Array of metadata keys (full schedule keys)
     */
    function getMetadataKeysForStudentWeek(metadata, studentId, week) {
        var prefix = String(studentId) + '_' + String(week) + '_';
        var keys = [];

        if (!metadata || !metadata.classDurations) {
            return keys;
        }

        for (var key in metadata.classDurations) {
            if (Object.prototype.hasOwnProperty.call(metadata.classDurations, key) &&
                key.indexOf(prefix) === 0) {
                keys.push(key);
            }
        }

        return keys;
    }

    /**
     * Get the instructor ID for a class.
     * 
     * @param {object} metadata - Metadata object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {string|null} Instructor ID or null
     */
    function getClassInstructor(metadata, key) {
        if (!metadata || !metadata.classInstructors) {
            return null;
        }
        return metadata.classInstructors[key] || null;
    }

    /**
     * Get the label for a class.
     * 
     * @param {object} metadata - Metadata object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {string} Label or empty string
     */
    function getClassLabel(metadata, key) {
        if (!metadata || !metadata.classLabels) {
            return '';
        }
        return metadata.classLabels[key] || '';
    }

    /**
     * Get the group label for a class.
     * 
     * @param {object} metadata - Metadata object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {string|null} Group label or null
     */
    function getClassGroupLabel(metadata, key) {
        if (!metadata || !metadata.classGroupLabels) {
            return null;
        }
        return metadata.classGroupLabels[key] || null;
    }

    /**
     * Get the location ID for a class.
     * 
     * @param {object} metadata - Metadata object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @returns {string|null} Location ID or null
     */
    function getClassLocation(metadata, key) {
        if (!metadata || !metadata.classLocations) {
            return null;
        }
        return metadata.classLocations[key] || null;
    }

    /**
     * Set metadata for a class key.
     * 
     * @param {object} metadataCandidates - Metadata candidates object
     * @param {string} key - Schedule key (studentId_week_day_hour)
     * @param {object} data - Metadata data { instructorId, label, groupLabel, duration, locationId }
     */
    function setClassMetadata(metadataCandidates, key, data) {
        if (!metadataCandidates || !key || !data) {
            return;
        }

        if (data.instructorId !== undefined && data.instructorId !== null) {
            metadataCandidates.classInstructors[key] = data.instructorId;
        } else {
            delete metadataCandidates.classInstructors[key];
        }

        if (data.label !== undefined && data.label !== null) {
            metadataCandidates.classLabels[key] = data.label;
        } else {
            delete metadataCandidates.classLabels[key];
        }

        if (data.groupLabel !== undefined && data.groupLabel !== null) {
            metadataCandidates.classGroupLabels[key] = data.groupLabel;
        } else {
            delete metadataCandidates.classGroupLabels[key];
        }

        if (data.duration !== undefined && data.duration !== null) {
            var durationNum = validateDuration(data.duration);
            if (durationNum !== null) {
                metadataCandidates.classDurations[key] = durationNum;
            }
        }

        if (data.locationId !== undefined && data.locationId !== null) {
            metadataCandidates.classLocations[key] = data.locationId;
        } else {
            delete metadataCandidates.classLocations[key];
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarMetadataCore = {
        // Constants
        METADATA_KEYS: METADATA_KEYS,

        // Retrieval
        getClassMetadata: getClassMetadata,
        getValidClassDuration: getValidClassDuration,

        // Candidate building and committing
        buildMetadataCandidates: buildMetadataCandidates,
        commitMetadataCandidates: commitMetadataCandidates,

        // Cleanup
        clearMetadataForPrefix: clearMetadataForPrefix,
        deleteClassMetadata: deleteClassMetadata,

        // Helpers
        hasClassMetadata: hasClassMetadata,
        getMetadataKeysForStudentWeek: getMetadataKeysForStudentWeek,
        getClassInstructor: getClassInstructor,
        getClassLabel: getClassLabel,
        getClassGroupLabel: getClassGroupLabel,
        getClassLocation: getClassLocation,
        setClassMetadata: setClassMetadata,

        // Utility
        getScheduleKey: getScheduleKey,
        validateDuration: validateDuration
    };

})();
