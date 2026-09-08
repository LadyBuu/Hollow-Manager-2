/**
 * modules/shared/academy-constants.js - Academy Constants
 * Single source of truth for all academy-related constants
 * 
 * This module provides:
 *   - Academy sub-tab definitions
 *   - Academy validation constants (MIN_SCORE, MAX_SCORE, PASSING_THRESHOLD)
 *   - Grade type definitions
 *   - Status definitions (class, student, team)
 *   - Academic term constants
 *   - Team size constants
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for academy constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - Validation runs BEFORE publishing to ensure integrity
 *   - No DOM, no state, no persistence - pure constants only
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var AC = window.AcademyConstants;
 *   var tabs = AC.ACADEMY_SUBTABS;
 *   var types = AC.GRADE_TYPES;
 *   var passing = AC.PASSING_THRESHOLD;
 *   var statuses = AC.CLASS_STATUSES;
 */

(function() {
    'use strict';

    if (window.__academyConstantsLoaded) {
        return;
    }
    window.__academyConstantsLoaded = true;

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }

        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }

        return Object.freeze(obj);
    }

    // ============================================================
    // SUB-TAB DEFINITIONS
    // ============================================================

    /**
     * Academy sub-tab definitions.
     * 
     * Properties:
     *   - id: Unique identifier (used in routing/state)
     *   - label: Human-readable display name
     *   - icon: Optional icon for display
     *   - description: Optional description
     */
    var ACADEMY_SUBTABS = [
        {
            id: 'class',
            label: 'Classes',
            icon: '📚',
            description: 'Manage classes, rosters, and academic teams'
        },
        {
            id: 'student',
            label: 'Students',
            icon: '👤',
            description: 'Manage student grades, rankings, and schedules'
        },
        {
            id: 'faculty',
            label: 'Faculty',
            icon: '👨‍🏫',
            description: 'Manage instructors, schedules, and auto-groups'
        }
    ];

    // ============================================================
    // DERIVED DATA
    // ============================================================

    var VALID_SUB_TAB_IDS = ACADEMY_SUBTABS.map(function(tab) {
        return tab.id;
    });

    var SUB_TAB_LABELS = {};
    ACADEMY_SUBTABS.forEach(function(tab) {
        SUB_TAB_LABELS[tab.id] = tab.label;
    });

    var SUB_TAB_ICONS = {};
    ACADEMY_SUBTABS.forEach(function(tab) {
        SUB_TAB_ICONS[tab.id] = tab.icon || '';
    });

    // ============================================================
    // GRADE CONSTANTS
    // ============================================================

    /**
     * Grade types for academic grading.
     */
    var GRADE_TYPES = [
        { id: 'exam', label: 'Exam', weightDefault: 1.5 },
        { id: 'assignment', label: 'Assignment', weightDefault: 1.0 },
        { id: 'participation', label: 'Participation', weightDefault: 0.5 },
        { id: 'project', label: 'Project', weightDefault: 1.2 },
        { id: 'quiz', label: 'Quiz', weightDefault: 0.8 },
        { id: 'final', label: 'Final Exam', weightDefault: 2.0 }
    ];

    var GRADE_TYPE_IDS = GRADE_TYPES.map(function(type) {
        return type.id;
    });

    var GRADE_TYPE_LABELS = {};
    GRADE_TYPES.forEach(function(type) {
        GRADE_TYPE_LABELS[type.id] = type.label;
    });

    var GRADE_TYPE_WEIGHTS = {};
    GRADE_TYPES.forEach(function(type) {
        GRADE_TYPE_WEIGHTS[type.id] = type.weightDefault;
    });

    /**
     * Grade score bounds.
     */
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;
    var PASSING_THRESHOLD = 70;

    /**
     * Letter grade mapping.
     */
    var LETTER_GRADES = [
        { min: 90, label: 'A', description: 'Excellent' },
        { min: 80, label: 'B', description: 'Good' },
        { min: 70, label: 'C', description: 'Satisfactory' },
        { min: 60, label: 'D', description: 'Below Average' },
        { min: 0, label: 'F', description: 'Failing' }
    ];

    // ============================================================
    // CLASS STATUSES
    // ============================================================

    var CLASS_STATUSES = [
        { id: 'active', label: 'Active', description: 'Currently active class' },
        { id: 'archived', label: 'Archived', description: 'Archived class (historical)' },
        { id: 'graduated', label: 'Graduated', description: 'Graduated class' }
    ];

    var CLASS_STATUS_IDS = CLASS_STATUSES.map(function(status) {
        return status.id;
    });

    var CLASS_STATUS_LABELS = {};
    CLASS_STATUSES.forEach(function(status) {
        CLASS_STATUS_LABELS[status.id] = status.label;
    });

    var DEFAULT_CLASS_STATUS = 'active';

    // ============================================================
    // STUDENT STATUSES (for eligibility filtering)
    // ============================================================

    var STUDENT_STATUSES = ['trainee', 'rookie', 'junior', 'student'];
    var INSTRUCTOR_STATUSES = ['instructor', 'teacher', 'professor', 'senior'];

    // ============================================================
    // TEAM CONSTANTS
    // ============================================================

    var MAX_TEAM_SIZE = 20;
    var MIN_TEAM_SIZE = 2;
    var DEFAULT_TEAM_SIZE = 4;

    var ACADEMIC_TEAM_TYPES = ['academic'];
    var NON_ACADEMIC_TEAM_TYPES = ['professional', 'temporary', 'civilian'];

    // ============================================================
    // RANKING CONSTANTS
    // ============================================================

    var MIN_RANK = 1;
    var RANK_BINS = 5;

    // ============================================================
    // LOOKUP FUNCTIONS
    // ============================================================

    function getSubTabs() {
        return ACADEMY_SUBTABS.slice();
    }

    function getValidSubTabIds() {
        return VALID_SUB_TAB_IDS.slice();
    }

    function getSubTabLabel(id) {
        return SUB_TAB_LABELS[id] || id;
    }

    function getSubTabIcon(id) {
        return SUB_TAB_ICONS[id] || '';
    }

    function isValidSubTab(id) {
        return VALID_SUB_TAB_IDS.indexOf(id) !== -1;
    }

    function getDefaultSubTab() {
        return VALID_SUB_TAB_IDS.length > 0 ? VALID_SUB_TAB_IDS[0] : 'class';
    }

    function getGradeTypes() {
        return GRADE_TYPES.slice();
    }

    function getGradeTypeLabel(id) {
        return GRADE_TYPE_LABELS[id] || id;
    }

    function getGradeTypeWeight(id) {
        return GRADE_TYPE_WEIGHTS[id] || 1.0;
    }

    function getLetterGrade(score) {
        var num = Number(score);
        if (isNaN(num) || num < MIN_SCORE || num > MAX_SCORE) {
            return { label: '?', description: 'Invalid' };
        }

        for (var i = 0; i < LETTER_GRADES.length; i++) {
            if (num >= LETTER_GRADES[i].min) {
                return {
                    label: LETTER_GRADES[i].label,
                    description: LETTER_GRADES[i].description
                };
            }
        }

        return { label: 'F', description: 'Failing' };
    }

    function isPassing(score) {
        var num = Number(score);
        if (isNaN(num)) {
            return false;
        }
        return num >= PASSING_THRESHOLD;
    }

    function getClassStatuses() {
        return CLASS_STATUSES.slice();
    }

    function getClassStatusLabel(id) {
        return CLASS_STATUS_LABELS[id] || id;
    }

    function isValidClassStatus(id) {
        return CLASS_STATUS_IDS.indexOf(id) !== -1;
    }

    function getDefaultClassStatus() {
        return DEFAULT_CLASS_STATUS;
    }

    function isStudentStatus(status) {
        if (!status || typeof status !== 'string') {
            return false;
        }
        return STUDENT_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }

    function isInstructorStatus(status) {
        if (!status || typeof status !== 'string') {
            return false;
        }
        return INSTRUCTOR_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        if (!Array.isArray(ACADEMY_SUBTABS) || ACADEMY_SUBTABS.length === 0) {
            errors.push('ACADEMY_SUBTABS must be a non-empty array.');
        }

        var tabIds = Object.create(null);
        ACADEMY_SUBTABS.forEach(function(tab, index) {
            if (!tab.id || typeof tab.id !== 'string') {
                errors.push('Sub-tab at index ' + index + ' missing id.');
                return;
            }
            if (tabIds[tab.id]) {
                errors.push('Duplicate sub-tab id "' + tab.id + '".');
            }
            tabIds[tab.id] = true;
            if (!tab.label || typeof tab.label !== 'string') {
                errors.push('Sub-tab "' + tab.id + '" missing label.');
            }
        });

        if (!Array.isArray(GRADE_TYPES) || GRADE_TYPES.length === 0) {
            errors.push('GRADE_TYPES must be a non-empty array.');
        }

        var typeIds = Object.create(null);
        GRADE_TYPES.forEach(function(type, index) {
            if (!type.id || typeof type.id !== 'string') {
                errors.push('Grade type at index ' + index + ' missing id.');
                return;
            }
            if (typeIds[type.id]) {
                errors.push('Duplicate grade type id "' + type.id + '".');
            }
            typeIds[type.id] = true;
            if (!type.label || typeof type.label !== 'string') {
                errors.push('Grade type "' + type.id + '" missing label.');
            }
            if (typeof type.weightDefault !== 'number' || type.weightDefault <= 0) {
                errors.push('Grade type "' + type.id + '" invalid weightDefault.');
            }
        });

        if (typeof MIN_SCORE !== 'number' || MIN_SCORE < 0) {
            errors.push('MIN_SCORE must be a non-negative number.');
        }
        if (typeof MAX_SCORE !== 'number' || MAX_SCORE <= MIN_SCORE) {
            errors.push('MAX_SCORE must be greater than MIN_SCORE.');
        }
        if (typeof PASSING_THRESHOLD !== 'number' || PASSING_THRESHOLD < MIN_SCORE || PASSING_THRESHOLD > MAX_SCORE) {
            errors.push('PASSING_THRESHOLD must be between MIN_SCORE and MAX_SCORE.');
        }

        if (!Array.isArray(LETTER_GRADES) || LETTER_GRADES.length === 0) {
            errors.push('LETTER_GRADES must be a non-empty array.');
        }

        var sortedGrades = LETTER_GRADES.slice().sort(function(a, b) {
            return b.min - a.min;
        });

        if (sortedGrades[0].min !== 90) {
            errors.push('LETTER_GRADES must include 90 for A.');
        }
        if (sortedGrades[sortedGrades.length - 1].min !== 0) {
            errors.push('LETTER_GRADES must include 0 for F.');
        }

        if (!Array.isArray(CLASS_STATUSES) || CLASS_STATUSES.length === 0) {
            errors.push('CLASS_STATUSES must be a non-empty array.');
        }

        var statusIds = Object.create(null);
        CLASS_STATUSES.forEach(function(status, index) {
            if (!status.id || typeof status.id !== 'string') {
                errors.push('Status at index ' + index + ' missing id.');
                return;
            }
            if (statusIds[status.id]) {
                errors.push('Duplicate status id "' + status.id + '".');
            }
            statusIds[status.id] = true;
            if (!status.label || typeof status.label !== 'string') {
                errors.push('Status "' + status.id + '" missing label.');
            }
        });

        if (typeof MAX_TEAM_SIZE !== 'number' || MAX_TEAM_SIZE < 1) {
            errors.push('MAX_TEAM_SIZE must be a positive number.');
        }
        if (typeof MIN_TEAM_SIZE !== 'number' || MIN_TEAM_SIZE < 1 || MIN_TEAM_SIZE > MAX_TEAM_SIZE) {
            errors.push('MIN_TEAM_SIZE must be between 1 and MAX_TEAM_SIZE.');
        }
        if (typeof DEFAULT_TEAM_SIZE !== 'number' || DEFAULT_TEAM_SIZE < MIN_TEAM_SIZE || DEFAULT_TEAM_SIZE > MAX_TEAM_SIZE) {
            errors.push('DEFAULT_TEAM_SIZE must be between MIN_TEAM_SIZE and MAX_TEAM_SIZE.');
        }

        if (typeof MIN_RANK !== 'number' || MIN_RANK < 1) {
            errors.push('MIN_RANK must be a positive number.');
        }
        if (typeof RANK_BINS !== 'number' || RANK_BINS < 1) {
            errors.push('RANK_BINS must be a positive number.');
        }

        if (errors.length > 0) {
            console.warn('[AcademyConstants] Validation errors:', errors);
        }

        return errors.length === 0;
    }

    validateConstants();

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    deepFreeze(ACADEMY_SUBTABS);
    deepFreeze(VALID_SUB_TAB_IDS);
    deepFreeze(SUB_TAB_LABELS);
    deepFreeze(SUB_TAB_ICONS);
    deepFreeze(GRADE_TYPES);
    deepFreeze(GRADE_TYPE_IDS);
    deepFreeze(GRADE_TYPE_LABELS);
    deepFreeze(GRADE_TYPE_WEIGHTS);
    deepFreeze(LETTER_GRADES);
    deepFreeze(CLASS_STATUSES);
    deepFreeze(CLASS_STATUS_IDS);
    deepFreeze(CLASS_STATUS_LABELS);
    deepFreeze(STUDENT_STATUSES);
    deepFreeze(INSTRUCTOR_STATUSES);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyConstants = Object.freeze({
        // Sub-tabs
        ACADEMY_SUBTABS: ACADEMY_SUBTABS,
        VALID_SUB_TAB_IDS: VALID_SUB_TAB_IDS,
        SUB_TAB_LABELS: SUB_TAB_LABELS,
        SUB_TAB_ICONS: SUB_TAB_ICONS,

        getSubTabs: getSubTabs,
        getValidSubTabIds: getValidSubTabIds,
        getSubTabLabel: getSubTabLabel,
        getSubTabIcon: getSubTabIcon,
        isValidSubTab: isValidSubTab,
        getDefaultSubTab: getDefaultSubTab,

        // Grades
        GRADE_TYPES: GRADE_TYPES,
        GRADE_TYPE_IDS: GRADE_TYPE_IDS,
        GRADE_TYPE_LABELS: GRADE_TYPE_LABELS,
        GRADE_TYPE_WEIGHTS: GRADE_TYPE_WEIGHTS,
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE,
        PASSING_THRESHOLD: PASSING_THRESHOLD,
        LETTER_GRADES: LETTER_GRADES,

        getGradeTypes: getGradeTypes,
        getGradeTypeLabel: getGradeTypeLabel,
        getGradeTypeWeight: getGradeTypeWeight,
        getLetterGrade: getLetterGrade,
        isPassing: isPassing,

        // Class statuses
        CLASS_STATUSES: CLASS_STATUSES,
        CLASS_STATUS_IDS: CLASS_STATUS_IDS,
        CLASS_STATUS_LABELS: CLASS_STATUS_LABELS,
        DEFAULT_CLASS_STATUS: DEFAULT_CLASS_STATUS,

        getClassStatuses: getClassStatuses,
        getClassStatusLabel: getClassStatusLabel,
        isValidClassStatus: isValidClassStatus,
        getDefaultClassStatus: getDefaultClassStatus,

        // Student/Instructor statuses
        STUDENT_STATUSES: STUDENT_STATUSES,
        INSTRUCTOR_STATUSES: INSTRUCTOR_STATUSES,

        isStudentStatus: isStudentStatus,
        isInstructorStatus: isInstructorStatus,

        // Teams
        MAX_TEAM_SIZE: MAX_TEAM_SIZE,
        MIN_TEAM_SIZE: MIN_TEAM_SIZE,
        DEFAULT_TEAM_SIZE: DEFAULT_TEAM_SIZE,
        ACADEMIC_TEAM_TYPES: ACADEMIC_TEAM_TYPES,
        NON_ACADEMIC_TEAM_TYPES: NON_ACADEMIC_TEAM_TYPES,

        // Rankings
        MIN_RANK: MIN_RANK,
        RANK_BINS: RANK_BINS
    });

})();