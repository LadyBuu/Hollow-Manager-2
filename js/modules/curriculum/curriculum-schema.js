/**
 * js/core/curriculum/curriculum-schema.js - Curriculum Schema Initialisation
 * Path: js/core/curriculum/curriculum-schema.js
 * 
 * This module provides schema initialisation and repair functions.
 * 
 * IMPORTANT:
 *   - ensureCurriculum() is IDEMPOTENT: safe to call multiple times
 *   - It only adds missing structure, never deletes data
 *   - It should be called during application bootstrap
 *   - All mutation modules depend on the schema being present
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

        // Ensure curriculum exists
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }

        // Get defaults and merge
        var defaults = getDefaultCurriculum();

        for (var key in defaults) {
            if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
                continue;
            }

            if (data.curriculum[key] === undefined) {
                data.curriculum[key] = defaults[key];
            }
        }

        // Ensure top-level collections exist
        if (!Array.isArray(data.classes)) {
            data.classes = [];
        }

        if (!Array.isArray(data.locations)) {
            data.locations = [];
        }

        if (!data.locationSchedules || typeof data.locationSchedules !== 'object') {
            data.locationSchedules = {};
        }

        // Ensure rankings is an object
        if (!isObject(data.curriculum.rankings)) {
            data.curriculum.rankings = {};
        }

        // Ensure grades is an object
        if (!isObject(data.curriculum.grades)) {
            data.curriculum.grades = {};
        }

        // Ensure schedules is an object
        if (!isObject(data.curriculum.schedules)) {
            data.curriculum.schedules = {};
        }

        // Ensure restDays is an object
        if (!isObject(data.curriculum.restDays)) {
            data.curriculum.restDays = {};
        }

        // Ensure autoGroups is an object
        if (!isObject(data.curriculum.autoGroups)) {
            data.curriculum.autoGroups = {};
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
