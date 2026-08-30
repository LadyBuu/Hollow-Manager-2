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
 *   1. curriculum-validators.js
 *   2. curriculum-schema.js
 *   3. curriculum-classes.js
 *   4. curriculum-disciplines.js
 *   5. curriculum-groups.js
 *   6. curriculum-schedule.js
 *   7. curriculum-ranking.js
 *   8. curriculum-instructor.js
 *   9. curriculum-grades.js
 *   10. curriculum-locations.js
 *   11. curriculum-location-schedule.js
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
 *   ├── getGrades() / getGrade()
 *   ├── saveGrades() / saveGrade() / deleteGrade()
 *   └── calculateGradeSummary()
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
    // VERIFY REQUIRED DEPENDENCIES
    // ============================================================
    // This manifest does not load modules, but it can verify
    // that the expected core modules are available.

    var requiredFunctions = [
        'ensureCurriculum',
        'createClass',
        'updateClass',
        'deleteClass',
        'getClass',
        'getClasses',
        'createDiscipline',
        'updateDiscipline',
        'deleteDiscipline',
        'getDiscipline',
        'getDisciplines',
        'getAvailableDisciplines',
        'getStudentSchedule',
        'setStudentScheduleClass',
        'removeStudentScheduleClass',
        'getRankings',
        'setRankings',
        'updateStudentRank',
        'autoGenerateRankings',
        'calculateGradeSummary',
        'getGrades',
        'saveGrades',
        'getLocation',
        'getLocations',
        'createLocation',
        'updateLocation',
        'deleteLocation',
        'getLocationSchedule',
        'setLocationClass',
        'removeLocationClass',
        'clearLocationSchedule',
        'getAllAutoGroups',
        'createAutoGroup',
        'deleteAutoGroup',
        'addStudentToGroup',
        'removeStudentFromGroup',
        'addSlotToGroup',
        'removeSlotFromGroup',
        'rebuildGroupsFromSchedules',
        'addInstructorClassTemplate',
        'removeInstructorClassTemplate',
        'addInstructorBlock',
        'removeInstructorBlock'
    ];

    var missing = [];

    for (var i = 0; i < requiredFunctions.length; i++) {
        var fnName = requiredFunctions[i];
        if (typeof window[fnName] !== 'function') {
            missing.push(fnName);
        }
    }

    if (missing.length > 0) {
        // Only log in development to avoid noise
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[CurriculumCore] Some core modules appear to be missing:', missing.join(', '));
            console.warn('[CurriculumCore] Check script load order. Expected order:');
            console.warn('  1. curriculum-validators.js');
            console.warn('  2. curriculum-schema.js');
            console.warn('  3. curriculum-classes.js');
            console.warn('  4. curriculum-disciplines.js');
            console.warn('  5. curriculum-groups.js');
            console.warn('  6. curriculum-schedule.js');
            console.warn('  7. curriculum-ranking.js');
            console.warn('  8. curriculum-instructor.js');
            console.warn('  9. curriculum-grades.js');
            console.warn('  10. curriculum-locations.js');
            console.warn('  11. curriculum-location-schedule.js');
        }
    }

    // ============================================================
    // EXPOSE MODULE REFERENCE (optional)
    // ============================================================

    window.CurriculumCore = {
        version: '1.0.0',
        modules: {
            validators: !!window.CurriculumValidators,
            schema: typeof window.ensureCurriculum === 'function',
            classes: typeof window.createClass === 'function',
            disciplines: typeof window.createDiscipline === 'function',
            groups: typeof window.createAutoGroup === 'function',
            schedule: typeof window.setStudentScheduleClass === 'function',
            ranking: typeof window.setRankings === 'function',
            instructor: typeof window.addInstructorClassTemplate === 'function',
            grades: typeof window.saveGrades === 'function',
            locations: typeof window.createLocation === 'function',
            locationSchedule: typeof window.setLocationClass === 'function'
        }
    };

})();
