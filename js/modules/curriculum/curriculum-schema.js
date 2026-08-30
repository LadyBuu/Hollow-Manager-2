/**
 * js/core/curriculum/curriculum-schema.js - Curriculum Schema Initialisation
 * Path: js/core/curriculum/curriculum-schema.js
 * 
 * This module provides schema initialisation and repair functions.
 * 
 * IMPORTANT:
 *   - ensureCurriculum() is IDEMPOTENT: safe to call multiple times
 *   - It adds missing structure and repairs malformed structure
 *   - Valid existing data is preserved
 *   - It should be called during application bootstrap
 *   - All mutation modules depend on the schema being present
 *   - This function is a REPAIR operation, not a domain mutation
 * 
 * REPAIR SEMANTICS:
 *   - Missing collections are created with defaults.
 *   - Valid collections are preserved unchanged.
 *   - Malformed collections are replaced with empty defaults.
 *   - Repair may discard data contained inside malformed structures.
 *   - No valid data is intentionally deleted.
 *   - Deep content validation belongs to the relevant domain module.
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumSchemaLoaded) {
        return;
    }
    window.__curriculumSchemaLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumSchema: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumSchema: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // DEFAULT CURRICULUM DATA
    // ============================================================

    function getDefaultCurriculum() {
        return {
            disciplines: [],
            schedules: {},
            restDays: {},
            examDays: {},
            grades: {},
            rankings: {},
            currentWeek: 1,
            classInstructors: {},
            classLabels: {},
            classGroupLabels: {},
            classDurations: {},
            classLocations: {},
            instructorClasses: {},
            instructorTemplates: {},
            instructorBlocks: {},
            instructorGroups: {},
            disciplineGroups: {},
            autoGroups: {}
        };
    }

    // ============================================================
    // ENSURE CURRICULUM SCHEMA
    // ============================================================

    function ensureCurriculum() {
        var data = getDataStore();

        if (!data) {
            return;
        }

        // Ensure curriculum exists and is an object
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }

        // Get defaults
        var defaults = getDefaultCurriculum();

        // Repair every collection in the schema
        for (var key in defaults) {
            if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
                continue;
            }

            var current = data.curriculum[key];
            var defaultValue = defaults[key];
            var isDefaultArray = Array.isArray(defaultValue);

            // Case 1: Missing or null
            if (current === undefined || current === null) {
                data.curriculum[key] = deepClone(defaultValue);
                continue;
            }

            // Case 2: Should be array but isn't
            if (isDefaultArray && !Array.isArray(current)) {
                data.curriculum[key] = [];
                continue;
            }

            // Case 3: Should be object but isn't (including arrays)
            if (!isDefaultArray && !isObject(current)) {
                data.curriculum[key] = deepClone(defaultValue);
                continue;
            }

            // Case 4: Correct top-level type - preserve it
            // Deep content validation belongs to the relevant domain module.
        }

        // ============================================================
        // TOP-LEVEL COLLECTIONS (outside curriculum)
        // ============================================================

        if (!Array.isArray(data.classes)) {
            data.classes = [];
        }

        if (!Array.isArray(data.locations)) {
            data.locations = [];
        }

        if (!isObject(data.locationSchedules)) {
            data.locationSchedules = {};
        }

        // ============================================================
        // CURRENT WEEK (ensure valid integer)
        // ============================================================

        if (!Number.isInteger(data.curriculum.currentWeek) ||
            data.curriculum.currentWeek < 1 ||
            data.curriculum.currentWeek > 52) {
            data.curriculum.currentWeek = 1;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ensureCurriculum = ensureCurriculum;

    window.CurriculumSchema = {
        ensureCurriculum: ensureCurriculum,
        getDefaultCurriculum: getDefaultCurriculum
    };

})();
