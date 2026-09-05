/**
 * js/modules/academy/academy-state.js - Academy UI State Management
 * Single source of truth for all Academy UI state
 * Path: js/modules/academy/academy-state.js
 * 
 * This module handles:
 *   - UI state for the Academy module
 *   - Selection state (class, student, instructor, week, tab)
 *   - State persistence (sessionStorage)
 * 
 * IMPORTANT:
 *   - This module manages UI STATE ONLY, not domain data
 *   - Domain data (classes, students, grades, etc.) lives in window.data
 *   - UI state is stored in sessionStorage for session persistence
 *   - All state changes are reflected via setters
 *   - No direct mutation of state - use setter functions
 *   - All validation uses CALENDAR_CONSTANTS from constants.js
 * 
 * STATE HIERARCHY:
 *   - selectedClassId: Currently selected class
 *   - selectedWeek: Currently selected week (1-52)
 *   - selectedStudentId: Currently selected student
 *   - selectedInstructorId: Currently selected instructor
 *   - activeSubTab: Active sub-tab ('class' | 'student' | 'faculty')
 * 
 * DEPENDENCIES:
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.AcademyQueries (from academy-queries.js)
 * 
 * USAGE:
 *   var state = window.AcademyState;
 *   state.selectClass('class_123');
 *   state.selectWeek(5);
 *   var current = state.getState();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyStateLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CalendarConstants = window.CALENDAR_CONSTANTS;
    var AcademyQueries = window.AcademyQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getCharacterById !== 'function') {
            missing.push('AcademyQueries.getCharacterById');
        }

        if (missing.length > 0) {
            console.warn('AcademyState: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyStateLoaded = true;

    // ============================================================
    // CONSTANTS - From CALENDAR_CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var VALID_SUB_TABS = ['class', 'student', 'faculty'];
    var STORAGE_KEY = 'academy_state';

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function validateWeek(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }
        return num;
    }

    function isValidSubTab(value) {
        return value && VALID_SUB_TABS.indexOf(value) !== -1;
    }

    // ============================================================
    // DEFAULT STATE
    // ============================================================

    function getDefaultState() {
        return {
            selectedClassId: null,
            selectedWeek: 1,
            selectedStudentId: null,
            selectedInstructorId: null,
            activeSubTab: 'class'
        };
    }

    // ============================================================
    // STATE STORAGE
    // ============================================================

    var _state = null;

    function loadState() {
        // Try to load from sessionStorage
        try {
            var stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored) {
                var parsed = JSON.parse(stored);
                if (parsed && typeof parsed === 'object') {
                    _state = parsed;
                    return;
                }
            }
        } catch (e) {
            // Ignore storage errors
        }

        // Fallback to defaults
        _state = getDefaultState();
    }

    function saveState() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
        } catch (e) {
            // Ignore storage errors
        }
    }

    // ============================================================
    // STATE VALIDATION
    // ============================================================

    function validateSelectedClass(classId) {
        if (!classId) {
            return true;
        }
        var cls = AcademyQueries.getClass(classId);
        return cls !== null;
    }

    function validateSelectedStudent(studentId) {
        if (!studentId) {
            return true;
        }
        var student = AcademyQueries.getCharacterById(studentId);
        return student !== null;
    }

    function validateSelectedInstructor(instructorId) {
        if (!instructorId) {
            return true;
        }
        var instructor = AcademyQueries.getCharacterById(instructorId);
        return instructor !== null;
    }

    function validateWeekValue(week) {
        return validateWeek(week) !== null;
    }

    function validateSubTabValue(subTab) {
        return isValidSubTab(subTab);
    }

    // ============================================================
    // STATE GETTERS
    // ============================================================

    function getState() {
        return {
            selectedClassId: _state.selectedClassId,
            selectedWeek: _state.selectedWeek,
            selectedStudentId: _state.selectedStudentId,
            selectedInstructorId: _state.selectedInstructorId,
            activeSubTab: _state.activeSubTab
        };
    }

    function getSelectedClassId() {
        return _state.selectedClassId;
    }

    function getSelectedWeek() {
        return _state.selectedWeek;
    }

    function getSelectedStudentId() {
        return _state.selectedStudentId;
    }

    function getSelectedInstructorId() {
        return _state.selectedInstructorId;
    }

    function getActiveSubTab() {
        return _state.activeSubTab;
    }

    // ============================================================
    // STATE SETTERS
    // ============================================================

    function selectClass(classId) {
        if (classId && !validateSelectedClass(classId)) {
            return false;
        }

        _state.selectedClassId = classId || null;

        // Clear dependent selections when class changes
        _state.selectedStudentId = null;
        _state.selectedInstructorId = null;

        saveState();
        return true;
    }

    function selectWeek(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return false;
        }

        _state.selectedWeek = weekNum;
        saveState();
        return true;
    }

    function selectStudent(studentId) {
        if (studentId && !validateSelectedStudent(studentId)) {
            return false;
        }

        _state.selectedStudentId = studentId || null;
        saveState();
        return true;
    }

    function selectInstructor(instructorId) {
        if (instructorId && !validateSelectedInstructor(instructorId)) {
            return false;
        }

        _state.selectedInstructorId = instructorId || null;
        saveState();
        return true;
    }

    function switchSubTab(subTab) {
        if (!validateSubTabValue(subTab)) {
            return false;
        }

        _state.activeSubTab = subTab;
        saveState();
        return true;
    }

    // ============================================================
    // BULK STATE OPERATIONS
    // ============================================================

    function setState(newState) {
        if (!newState || typeof newState !== 'object') {
            return false;
        }

        var changed = false;

        if (newState.selectedClassId !== undefined) {
            if (selectClass(newState.selectedClassId)) {
                changed = true;
            }
        }

        if (newState.selectedWeek !== undefined) {
            if (selectWeek(newState.selectedWeek)) {
                changed = true;
            }
        }

        if (newState.selectedStudentId !== undefined) {
            if (selectStudent(newState.selectedStudentId)) {
                changed = true;
            }
        }

        if (newState.selectedInstructorId !== undefined) {
            if (selectInstructor(newState.selectedInstructorId)) {
                changed = true;
            }
        }

        if (newState.activeSubTab !== undefined) {
            if (switchSubTab(newState.activeSubTab)) {
                changed = true;
            }
        }

        return changed;
    }

    function resetState() {
        _state = getDefaultState();
        saveState();
    }

    function clearSelections() {
        _state.selectedClassId = null;
        _state.selectedStudentId = null;
        _state.selectedInstructorId = null;
        saveState();
    }

    // ============================================================
    // STATE VALIDATION (Public)
    // ============================================================

    function isValidWeek(week) {
        return validateWeek(week) !== null;
    }

    function isValidClass(classId) {
        return validateSelectedClass(classId);
    }

    function isValidStudent(studentId) {
        return validateSelectedStudent(studentId);
    }

    function isValidInstructor(instructorId) {
        return validateSelectedInstructor(instructorId);
    }

    function isValidSubTabValue(subTab) {
        return validateSubTabValue(subTab);
    }

    function getValidSubTabs() {
        return VALID_SUB_TABS.slice();
    }

    function getWeekRange() {
        return { min: MIN_WEEK, max: MAX_WEEK };
    }

    // ============================================================
    // STATE INSPECTION (for debugging)
    // ============================================================

    function getStateDiff() {
        var current = getState();
        var defaults = getDefaultState();

        var diff = {};
        for (var key in defaults) {
            if (Object.prototype.hasOwnProperty.call(defaults, key)) {
                if (JSON.stringify(current[key]) !== JSON.stringify(defaults[key])) {
                    diff[key] = {
                        current: current[key],
                        default: defaults[key]
                    };
                }
            }
        }

        return diff;
    }

    function logState() {
        console.log('[AcademyState] Current state:', getState());
        console.log('[AcademyState] Diff from defaults:', getStateDiff());
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    loadState();

    // Validate loaded state
    if (!validateSelectedClass(_state.selectedClassId)) {
        _state.selectedClassId = null;
    }
    if (!validateSelectedStudent(_state.selectedStudentId)) {
        _state.selectedStudentId = null;
    }
    if (!validateSelectedInstructor(_state.selectedInstructorId)) {
        _state.selectedInstructorId = null;
    }
    if (!validateWeekValue(_state.selectedWeek)) {
        _state.selectedWeek = 1;
    }
    if (!validateSubTabValue(_state.activeSubTab)) {
        _state.activeSubTab = 'class';
    }

    saveState();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyState = {
        // State getters
        getState: getState,
        getSelectedClassId: getSelectedClassId,
        getSelectedWeek: getSelectedWeek,
        getSelectedStudentId: getSelectedStudentId,
        getSelectedInstructorId: getSelectedInstructorId,
        getActiveSubTab: getActiveSubTab,

        // State setters
        selectClass: selectClass,
        selectWeek: selectWeek,
        selectStudent: selectStudent,
        selectInstructor: selectInstructor,
        switchSubTab: switchSubTab,

        // Bulk operations
        setState: setState,
        resetState: resetState,
        clearSelections: clearSelections,

        // Validation
        isValidWeek: isValidWeek,
        isValidClass: isValidClass,
        isValidStudent: isValidStudent,
        isValidInstructor: isValidInstructor,
        isValidSubTabValue: isValidSubTabValue,
        getValidSubTabs: getValidSubTabs,
        getWeekRange: getWeekRange,

        // Inspection
        getStateDiff: getStateDiff,
        logState: logState,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        VALID_SUB_TABS: VALID_SUB_TABS
    };

})();