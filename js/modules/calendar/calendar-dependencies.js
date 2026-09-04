/**
 * js/modules/calendar/calendar-dependencies.js - Calendar Dependency Validation
 * Centralized dependency validation for all calendar modules
 * Path: js/modules/calendar/calendar-dependencies.js
 * 
 * This module provides:
 *   - Centralized dependency checking for calendar modes
 *   - Shared calendar dependency validation
 *   - Function existence checking
 *   - Module existence checking
 * 
 * IMPORTANT:
 *   - This module is PURE - no side effects
 *   - No DOM manipulation
 *   - No data mutation
 *   - Used by all calendar mode modules
 *   - Provides fail-fast validation
 * 
 * USAGE:
 *   // Validate mode dependencies
 *   if (!CalendarDependencies.validateMode('student', [
 *       'getStudents', 'getStudentSchedule', 'setStudentScheduleClass'
 *   ])) {
 *       return;
 *   }
 * 
 *   // Validate shared dependencies
 *   if (!CalendarDependencies.validateShared()) {
 *       return;
 *   }
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarDependenciesLoaded) {
        return;
    }

    // ============================================================
    // SHARED DEPENDENCIES
    // ============================================================

    var SHARED_REQUIRED = [
        { name: 'CalendarUtils', check: 'formatHour' },
        { name: 'CalendarRenderer', check: 'renderGrid' },
        { name: 'CalendarModes', check: 'registerMode' },
        { name: 'DomUtils', check: 'escapeHtml' },
        { name: 'NotificationSystem', check: 'notify' },
        { name: 'saveData', check: null }
    ];

    // ============================================================
    // MODE DEPENDENCY MAPS
    // ============================================================

    var MODE_DEPENDENCIES = {
        'student': [
            { name: 'getStudents', check: null },
            { name: 'getDisplayName', check: null },
            { name: 'getCharacterById', check: null },
            { name: 'getStudentSchedule', check: null },
            { name: 'getStudentRestDays', check: null },
            { name: 'getAvailableDisciplines', check: null },
            { name: 'getDiscipline', check: null },
            { name: 'getClassInstructor', check: null },
            { name: 'getClassDuration', check: null },
            { name: 'getClassLabel', check: null },
            { name: 'getClassGroupLabel', check: null },
            { name: 'setStudentScheduleClass', check: null },
            { name: 'removeStudentScheduleClass', check: null },
            { name: 'setStudentRestDays', check: null }
        ],
        'instructor': [
            { name: 'getInstructors', check: null },
            { name: 'getDisplayName', check: null },
            { name: 'getCharacterById', check: null },
            { name: 'getAvailableDisciplines', check: null },
            { name: 'getDiscipline', check: null },
            { name: 'getStudentSchedule', check: null },
            { name: 'getStudents', check: null },
            { name: 'getClassInstructor', check: null },
            { name: 'getClassDuration', check: null },
            { name: 'getClassLabel', check: null },
            { name: 'getClassGroupLabel', check: null },
            { name: 'getInstructorTemplates', check: null },
            { name: 'getInstructorBlocks', check: null },
            { name: 'addInstructorClassTemplate', check: null },
            { name: 'removeInstructorClassTemplate', check: null },
            { name: 'removeInstructorBlock', check: null },
            { name: 'updateInstructorClassAssignments', check: null }
        ],
        'location': [
            { name: 'getLocations', check: null },
            { name: 'getLocation', check: null },
            { name: 'getLocationSchedule', check: null },
            { name: 'getAvailableDisciplines', check: null },
            { name: 'getDiscipline', check: null },
            { name: 'getStudents', check: null },
            { name: 'getStudentSchedule', check: null },
            { name: 'getDisplayName', check: null },
            { name: 'getCharacterById', check: null },
            { name: 'getLocationClassDuration', check: null },
            { name: 'getClassLocation', check: null },
            { name: 'setLocationClass', check: null },
            { name: 'removeLocationClass', check: null },
            { name: 'clearLocationSchedule', check: null },
            { name: 'getLocationUsage', check: null },
            { name: 'getLocationUsageByWeek', check: null },
            { name: 'getLocationCapacity', check: null }
        ]
    };

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    var CalendarDependencies = {
        /**
         * Validate shared calendar dependencies.
         * Checks that all required shared modules are loaded.
         * 
         * @returns {boolean} True if all dependencies are available
         */
        validateShared: function() {
            var missing = [];

            for (var i = 0; i < SHARED_REQUIRED.length; i++) {
                var dep = SHARED_REQUIRED[i];
                var module = window[dep.name];

                if (!module) {
                    missing.push(dep.name);
                    continue;
                }

                if (dep.check && typeof module[dep.check] !== 'function') {
                    missing.push(dep.name + '.' + dep.check);
                }
            }

            if (missing.length > 0) {
                console.warn('CalendarDependencies: Missing shared dependencies:', missing.join(', '));
                return false;
            }

            return true;
        },

        /**
         * Validate dependencies for a specific calendar mode.
         * 
         * @param {string} modeName - 'student' | 'instructor' | 'location'
         * @param {array} requiredFunctions - Array of function names to check
         * @returns {boolean} True if all dependencies are available
         */
        validateMode: function(modeName, requiredFunctions) {
            if (!modeName || typeof modeName !== 'string') {
                console.warn('CalendarDependencies: Mode name is required.');
                return false;
            }

            if (!Array.isArray(requiredFunctions)) {
                console.warn('CalendarDependencies: requiredFunctions must be an array.');
                return false;
            }

            // Check shared dependencies first
            if (!this.validateShared()) {
                return false;
            }

            // Check mode-specific dependencies
            var missing = [];

            for (var i = 0; i < requiredFunctions.length; i++) {
                var fnName = requiredFunctions[i];
                if (typeof window[fnName] !== 'function') {
                    missing.push(fnName);
                }
            }

            if (missing.length > 0) {
                console.warn('CalendarDependencies: Mode "' + modeName + '" missing functions:', missing.join(', '));
                return false;
            }

            return true;
        },

        /**
         * Validate dependencies for a mode using the predefined dependency map.
         * 
         * @param {string} modeName - 'student' | 'instructor' | 'location'
         * @returns {boolean} True if all dependencies are available
         */
        validateModeFromMap: function(modeName) {
            var deps = MODE_DEPENDENCIES[modeName];
            if (!deps) {
                console.warn('CalendarDependencies: Unknown mode "' + modeName + '"');
                return false;
            }

            // Extract function names from the dependency map
            var functionNames = [];
            for (var i = 0; i < deps.length; i++) {
                functionNames.push(deps[i].name);
            }

            return this.validateMode(modeName, functionNames);
        },

        /**
         * Check if a single function exists on the window object.
         * 
         * @param {string} fnName - Function name to check
         * @returns {boolean} True if the function exists
         */
        hasFunction: function(fnName) {
            if (!fnName || typeof fnName !== 'string') {
                return false;
            }
            return typeof window[fnName] === 'function';
        },

        /**
         * Check if multiple functions exist on the window object.
         * 
         * @param {array} fnNames - Array of function names to check
         * @returns {array} Array of missing function names
         */
        getMissingFunctions: function(fnNames) {
            if (!Array.isArray(fnNames)) {
                return [];
            }

            var missing = [];
            for (var i = 0; i < fnNames.length; i++) {
                if (!this.hasFunction(fnNames[i])) {
                    missing.push(fnNames[i]);
                }
            }
            return missing;
        },

        /**
         * Validate that a module exists on the window object.
         * 
         * @param {string} moduleName - Module name to check
         * @param {string} methodName - Optional method name to check
         * @returns {boolean} True if the module exists (and method if provided)
         */
        hasModule: function(moduleName, methodName) {
            if (!moduleName || typeof moduleName !== 'string') {
                return false;
            }

            var module = window[moduleName];
            if (!module) {
                return false;
            }

            if (methodName && typeof methodName === 'string') {
                return typeof module[methodName] === 'function';
            }

            return true;
        },

        /**
         * Get the predefined dependencies for a mode.
         * 
         * @param {string} modeName - 'student' | 'instructor' | 'location'
         * @returns {array|null} Array of dependency objects or null if not found
         */
        getModeDependencies: function(modeName) {
            return MODE_DEPENDENCIES[modeName] || null;
        },

        /**
         * Get all mode names that have defined dependencies.
         * 
         * @returns {array} Array of mode names
         */
        getModeNames: function() {
            var result = [];
            for (var key in MODE_DEPENDENCIES) {
                if (Object.prototype.hasOwnProperty.call(MODE_DEPENDENCIES, key)) {
                    result.push(key);
                }
            }
            return result;
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarDependencies = CalendarDependencies;

    window.__calendarDependenciesLoaded = true;

})();
