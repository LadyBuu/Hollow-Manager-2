/**
 * js/core/curriculum/index.js - Curriculum Core Manifest
 * Documents the curriculum core module hierarchy.
 * Path: js/core/curriculum/index.js
 * 
 * This module is a MANIFEST, not a loader.
 * 
 * IMPORTANT:
 *   - This file does NOT load sub-modules dynamically.
 *   - Script loading is handled by the application's HTML/script loader.
 *   - Each sub-module registers its public API on window.
 *   - The order of script tags in HTML determines load order:
 * 
 * SCRIPT LOAD ORDER:
 *   1. curriculum-helpers.js
 *   2. curriculum-validators.js
 *   3. curriculum-schema.js
 *   4. curriculum-classes.js
 *   5. curriculum-disciplines.js
 *   6. curriculum-groups.js
 *   7. curriculum-schedule.js
 *   8. curriculum-ranking.js
 *   9. curriculum-instructor.js
 *   10. curriculum-grades.js
 *   11. curriculum-locations.js
 *   12. curriculum-location-schedule.js
 * 
 * PUBLIC API:
 *   - All functions are exposed via window.xxx
 *   - Callers should use window.xxx functions directly
 *   - No need to reference this file directly after load
 * 
 * CURRICULUM CORE MODULES:
 * 
 *   curriculum-validators.js
 *   ├── validateWeek()
 *   ├── validateRank()
 *   ├── validateGradingSystem()
 *   ├── validateDiscipline()
 *   ├── validateMemberData()
 *   └── validateLocation()
 * 
 *   curriculum-schema.js
 *   └── ensureCurriculum()
 * 
 *   curriculum-classes.js
 *   ├── getClass() / getClasses() / getClassByName()
 *   ├── createClass() / updateClass() / deleteClass()
 *   ├── getCharactersByClass() / getTeamsByClass()
 *   └── addCharacterToClass() / removeCharacterFromClass()
 * 
 *   curriculum-disciplines.js
 *   ├── getDiscipline() / getDisciplines() / getAvailableDisciplines()
 *   ├── createDiscipline() / updateDiscipline() / deleteDiscipline()
 *   └── getDisciplineInstructors() / getDisciplineInstructorNames()
 * 
 *   curriculum-groups.js
 *   ├── getAllAutoGroups() / getAutoGroup()
 *   ├── createAutoGroup() / deleteAutoGroup()
 *   ├── addStudentToGroup() / removeStudentFromGroup()
 *   ├── addSlotToGroup() / removeSlotFromGroup()
 *   └── rebuildGroupsFromSchedules()
 * 
 *   curriculum-schedule.js
 *   ├── getStudentSchedule()
 *   ├── setStudentScheduleClass() / removeStudentScheduleClass()
 *   ├── clearStudentSchedule() / duplicateStudentSchedule()
 *   ├── setStudentRestDays() / getStudentRestDays()
 *   └── getClassInstructor() / getClassDuration() / getClassLabel() / getClassGroupLabel()
 * 
 *   curriculum-ranking.js
 *   ├── getRankings() / getStudentRank()
 *   ├── setRankings() / updateStudentRank() / removeStudentFromRankings()
 *   ├── autoGenerateRankings()
 *   └── calculateGradeSummary()
 * 
 *   curriculum-instructor.js
 *   ├── getInstructorTemplates() / getInstructorBlocks()
 *   ├── addInstructorClassTemplate() / removeInstructorClassTemplate()
 *   └── addInstructorBlock() / removeInstructorBlock()
 * 
 *   curriculum-grades.js
 *   ├── getGrades() / getGrade() / hasGrade() / getWeekGrades()
 *   ├── saveGrades() / saveGrade() / deleteGrade()
 *   ├── deleteWeekGrades() / deleteStudentGrades()
 *   ├── calculateGradeSummary() / calculateGradeLetter()
 *   └── getGradeLetter()
 * 
 *   curriculum-locations.js
 *   ├── getLocation() / getLocations() / getLocationOptions()
 *   ├── createLocation() / updateLocation() / deleteLocation()
 *   └── getLocationUsage()
 * 
 *   curriculum-location-schedule.js
 *   ├── getLocationSchedule()
 *   ├── setLocationClass() / removeLocationClass() / clearLocationSchedule()
 *   ├── getClassLocation() / setClassLocation()
 *   └── getLocationClassDuration()
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE EXECUTION
    // ============================================================
    // This flag indicates the manifest has been processed.
    // It does NOT indicate all sub-modules are loaded.
    // Script load order must be managed in HTML.

    if (window.__curriculumCoreManifestLoaded) {
        return;
    }
    window.__curriculumCoreManifestLoaded = true;

    // ============================================================
    // HELPER: Safe function check
    // ============================================================

    function isFunction(name) {
        return typeof window[name] === 'function';
    }

    // ============================================================
    // VERIFY REQUIRED DEPENDENCIES
    // ============================================================
    // This manifest does not load modules, but it can verify
    // that the expected core modules are available.

    var requiredFunctions = [
        // Schema
        'ensureCurriculum',
        
        // Classes
        'createClass',
        'updateClass',
        'deleteClass',
        'getClass',
        'getClasses',
        'getClassByName',
        'getClassDisplayName',
        'getClassOptions',
        'getCharactersByClass',
        'getTeamsByClass',
        'getTeamCountByClass',
        'getCharacterCountByClass',
        'getCharacterClasses',
        'getCharacterClassNames',
        'classExists',
        'addCharacterToClass',
        'removeCharacterFromClass',
        
        // Disciplines
        'createDiscipline',
        'updateDiscipline',
        'deleteDiscipline',
        'getDiscipline',
        'getDisciplines',
        'getAvailableDisciplines',
        'disciplineExists',
        'getDisciplineInstructors',
        'getDisciplineInstructorNames',
        'isDisciplineInstructor',
        'isValidDisciplineType',
        'getDisciplineTypeLabel',
        'getDisciplineTypeColor',
        
        // Groups
        'getAllAutoGroups',
        'getAutoGroup',
        'getGroupsByDiscipline',
        'getGroupsByInstructor',
        'getGroupStudents',
        'getGroupSlots',
        'getGroupStudentCount',
        'getGroupSlotCount',
        'isStudentInGroup',
        'createAutoGroup',
        'deleteAutoGroup',
        'addStudentToGroup',
        'removeStudentFromGroup',
        'addSlotToGroup',
        'removeSlotFromGroup',
        'rebuildGroupsFromSchedules',
        
        // Schedule
        'getStudentSchedule',
        'getStudentScheduleWeek',
        'getStudentScheduleClass',
        'getStudentRestDays',
        'getStudentDisciplineHourUsage',
        'hasScheduleConflict',
        'setStudentScheduleClass',
        'removeStudentScheduleClass',
        'clearStudentSchedule',
        'duplicateStudentSchedule',
        'setStudentRestDays',
        'getClassMetadata',
        'getClassInstructor',
        'getClassLabel',
        'getClassGroupLabel',
        'getClassDuration',
        'getClassLocation',
        'setClassInstructor',
        'setClassLabel',
        'setClassGroupLabel',
        'setClassDuration',
        'setClassLocation',
        'getScheduleKey',
        'findClassStart',
        
        // Ranking
        'getRankings',
        'getStudentRank',
        'hasRankings',
        'getRankingCount',
        'setRankings',
        'updateStudentRank',
        'removeStudentFromRankings',
        'autoGenerateRankings',
        
        // Instructor
        'getInstructorTemplates',
        'addInstructorClassTemplate',
        'removeInstructorClassTemplate',
        'getInstructorBlocks',
        'addInstructorBlock',
        'removeInstructorBlock',
        
        // Grades
        'getGrades',
        'getGrade',
        'hasGrade',
        'getWeekGrades',
        'getStudentDisciplineIds',
        'saveGrades',
        'saveGrade',
        'deleteGrade',
        'deleteWeekGrades',
        'deleteStudentGrades',
        'calculateGradeSummary',
        'calculateGradeLetter',
        'getGradeLetter',
        
        // Locations
        'getLocation',
        'getLocations',
        'getLocationsByType',
        'getLocationByName',
        'getLocationOptions',
        'getLocationUsage',
        'getLocationUsageByWeek',
        'locationExists',
        'getLocationCapacity',
        'isLocationAvailable',
        'createLocation',
        'updateLocation',
        'deleteLocation',
        'getLocationTypeLabel',
        'getLocationTypeColor',
        'getLocationTypeIcon',
        'getLocationTypes',
        
        // Location Schedule
        'getLocationSchedule',
        'getClassLocation',
        'getLocationClassDuration',
        'setLocationClass',
        'removeLocationClass',
        'clearLocationSchedule',
        'setClassLocation'
    ];

    var missing = [];

    for (var i = 0; i < requiredFunctions.length; i++) {
        var fnName = requiredFunctions[i];
        if (typeof window[fnName] !== 'function') {
            missing.push(fnName);
        }
    }

    // ============================================================
    // CHECK FOR OPTIONAL FUNCTIONS (warn if missing)
    // ============================================================

    var optionalFunctions = [
        'getInstructorTemplates',
        'addInstructorClassTemplate',
        'removeInstructorClassTemplate',
        'getInstructorBlocks',
        'addInstructorBlock',
        'removeInstructorBlock',
        'getLocationUsageByWeek',
        'getLocationCapacity',
        'isLocationAvailable',
        'getLocationTypeIcon',
        'getLocationTypes',
        'getClassMetadata',
        'getScheduleKey',
        'findClassStart'
    ];

    var optionalMissing = [];

    for (var i = 0; i < optionalFunctions.length; i++) {
        var fnName = optionalFunctions[i];
        if (typeof window[fnName] !== 'function') {
            optionalMissing.push(fnName);
        }
    }

    // ============================================================
    // LOG STATUS
    // ============================================================

    if (missing.length > 0) {
        console.warn('[CurriculumCore] Missing required functions:', missing.join(', '));
        console.warn('[CurriculumCore] Check script load order. Expected order:');
        console.warn('  1. curriculum-helpers.js');
        console.warn('  2. curriculum-validators.js');
        console.warn('  3. curriculum-schema.js');
        console.warn('  4. curriculum-classes.js');
        console.warn('  5. curriculum-disciplines.js');
        console.warn('  6. curriculum-groups.js');
        console.warn('  7. curriculum-schedule.js');
        console.warn('  8. curriculum-ranking.js');
        console.warn('  9. curriculum-instructor.js');
        console.warn('  10. curriculum-grades.js');
        console.warn('  11. curriculum-locations.js');
        console.warn('  12. curriculum-location-schedule.js');
    }

    if (optionalMissing.length > 0) {
        console.warn('[CurriculumCore] Optional functions missing:', optionalMissing.join(', '));
    }

    if (missing.length === 0) {
        console.log('[CurriculumCore] All required functions loaded successfully.');
    }

    // ============================================================
    // EXPOSE MODULE REFERENCE
    // ============================================================

    window.CurriculumCore = {
        version: '1.0.0',
        status: {
            allRequiredLoaded: missing.length === 0,
            missingRequired: missing,
            missingOptional: optionalMissing
        },
        modules: {
            helpers: !!window.CurriculumHelpers,
            validators: !!window.CurriculumValidators,
            schema: isFunction('ensureCurriculum'),
            classes: isFunction('createClass'),
            disciplines: isFunction('createDiscipline'),
            groups: isFunction('createAutoGroup'),
            schedule: isFunction('setStudentScheduleClass'),
            ranking: isFunction('setRankings'),
            instructor: isFunction('addInstructorClassTemplate'),
            grades: isFunction('saveGrades'),
            locations: isFunction('createLocation'),
            locationSchedule: isFunction('setLocationClass')
        },
        // Helper to check if all core modules are ready
        isReady: function() {
            return this.status.allRequiredLoaded;
        },
        // Helper to get missing functions
        getMissing: function() {
            return this.status.missingRequired;
        }
    };

    // ============================================================
    // ADD HELPER FOR MODULE READINESS
    // ============================================================

    /**
     * Check if a specific curriculum module is loaded.
     * @param {string} moduleName - Module name (e.g., 'grades', 'classes')
     * @returns {boolean} True if the module is loaded
     */
    window.isCurriculumModuleLoaded = function(moduleName) {
        var moduleMap = {
            'classes': isFunction('createClass') && isFunction('getClasses'),
            'disciplines': isFunction('createDiscipline') && isFunction('getDisciplines'),
            'groups': isFunction('createAutoGroup') && isFunction('getAllAutoGroups'),
            'schedule': isFunction('setStudentScheduleClass') && isFunction('getStudentSchedule'),
            'ranking': isFunction('setRankings') && isFunction('getRankings'),
            'instructor': isFunction('addInstructorClassTemplate') && isFunction('getInstructorTemplates'),
            'grades': isFunction('saveGrades') && isFunction('getGrades') && isFunction('getGradeLetter'),
            'locations': isFunction('createLocation') && isFunction('getLocations'),
            'locationSchedule': isFunction('setLocationClass') && isFunction('getLocationSchedule'),
            'schema': isFunction('ensureCurriculum')
        };

        if (moduleMap[moduleName] === undefined) {
            return false;
        }

        return moduleMap[moduleName];
    };

    /**
     * Get a list of all loaded curriculum modules.
     * @returns {Array} Array of loaded module names
     */
    window.getLoadedCurriculumModules = function() {
        var loaded = [];
        var moduleMap = {
            'classes': isFunction('createClass') && isFunction('getClasses'),
            'disciplines': isFunction('createDiscipline') && isFunction('getDisciplines'),
            'groups': isFunction('createAutoGroup') && isFunction('getAllAutoGroups'),
            'schedule': isFunction('setStudentScheduleClass') && isFunction('getStudentSchedule'),
            'ranking': isFunction('setRankings') && isFunction('getRankings'),
            'instructor': isFunction('addInstructorClassTemplate') && isFunction('getInstructorTemplates'),
            'grades': isFunction('saveGrades') && isFunction('getGrades') && isFunction('getGradeLetter'),
            'locations': isFunction('createLocation') && isFunction('getLocations'),
            'locationSchedule': isFunction('setLocationClass') && isFunction('getLocationSchedule'),
            'schema': isFunction('ensureCurriculum')
        };

        for (var name in moduleMap) {
            if (Object.prototype.hasOwnProperty.call(moduleMap, name) && moduleMap[name]) {
                loaded.push(name);
            }
        }

        return loaded;
    };

})();
