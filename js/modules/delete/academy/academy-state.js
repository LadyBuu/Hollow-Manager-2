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
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - Sub-tab validation uses AcademyConstants
 * 
 * STATE HIERARCHY:
 *   - selectedClassId: Currently selected class
 *   - selectedWeek: Currently selected week (1-52)
 *   - selectedStudentId: Currently selected student
 *   - selectedInstructorId: Currently selected instructor
 *   - activeSubTab: Active sub-tab (from ACADEMY_SUBTABS)
 * 
 * DEPENDENCIES:
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.AcademyConstants (from academy-constants.js)
 *   - window.AcademyClassQueries (from academy-class-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
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

    var CalendarValidation = window.CalendarValidation;
    var AcademyConstants = window.AcademyConstants;
    var AcademyClassQueries = window.AcademyClassQueries;
    var CharacterQueries = window.CharacterQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }
        if (!CalendarValidation || typeof CalendarValidation.getWeekBounds !== 'function') {
            missing.push('CalendarValidation.getWeekBounds');
        }

        if (!AcademyConstants || !Array.isArray(AcademyConstants.ACADEMY_SUBTABS)) {
            missing.push('AcademyConstants.ACADEMY_SUBTABS');
        }
        if (!AcademyConstants || !Array.isArray(AcademyConstants.VALID_SUB_TAB_IDS)) {
            missing.push('AcademyConstants.VALID_SUB_TAB_IDS');
        }

        if (!AcademyClassQueries || typeof AcademyClassQueries.getClass !== 'function') {
            missing.push('AcademyClassQueries.getClass');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (missing.length > 0) {
            throw new Error('AcademyState: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_SUB_TAB_IDS = AcademyConstants.VALID_SUB_TAB_IDS;
    var STORAGE_KEY = 'academy_state';

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
        var cls = AcademyClassQueries.getClass(classId);
        return cls !== null;
    }

    function validateSelectedStudent(studentId) {
        if (!studentId) {
            return true;
        }
        var student = CharacterQueries.getCharacterById(studentId);
        return student !== null;
    }

    function validateSelectedInstructor(instructorId) {
        if (!instructorId) {
            return true;
        }
        var instructor = CharacterQueries.getCharacterById(instructorId);
        return instructor !== null;
    }

    function validateWeekValue(week) {
        return CalendarValidation.parseWeek(week) !== null;
    }

    function validateSubTabValue(subTab) {
        return VALID_SUB_TAB_IDS.indexOf(subTab) !== -1;
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
    // STATE SETTERS - Returns boolean indicating change
    // ============================================================

    function selectClass(classId) {
        if (classId && !validateSelectedClass(classId)) {
            return false;
        }

        var changed = _state.selectedClassId !== classId;
        _state.selectedClassId = classId || null;

        // Clear dependent selections when class changes
        if (changed) {
            _state.selectedStudentId = null;
            _state.selectedInstructorId = null;
            saveState();
        }

        return changed;
    }

    function selectWeek(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return false;
        }

        var changed = _state.selectedWeek !== weekNum;
        _state.selectedWeek = weekNum;
        if (changed) {
            saveState();
        }
        return changed;
    }

    function selectStudent(studentId) {
        if (studentId && !validateSelectedStudent(studentId)) {
            return false;
        }

        var changed = _state.selectedStudentId !== studentId;
        _state.selectedStudentId = studentId || null;
        if (changed) {
            saveState();
        }
        return changed;
    }

    function selectInstructor(instructorId) {
        if (instructorId && !validateSelectedInstructor(instructorId)) {
            return false;
        }

        var changed = _state.selectedInstructorId !== instructorId;
        _state.selectedInstructorId = instructorId || null;
        if (changed) {
            saveState();
        }
        return changed;
    }

    function switchSubTab(subTab) {
        if (!validateSubTabValue(subTab)) {
            return false;
        }

        var changed = _state.activeSubTab !== subTab;
        _state.activeSubTab = subTab;
        if (changed) {
            saveState();
        }
        return changed;
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
        var changed = false;

        if (_state.selectedClassId !== null) {
            _state.selectedClassId = null;
            changed = true;
        }
        if (_state.selectedStudentId !== null) {
            _state.selectedStudentId = null;
            changed = true;
        }
        if (_state.selectedInstructorId !== null) {
            _state.selectedInstructorId = null;
            changed = true;
        }

        if (changed) {
            saveState();
        }
        return changed;
    }

    // ============================================================
    // STATE VALIDATION (Public)
    // ============================================================

    function isValidWeek(week) {
        return CalendarValidation.parseWeek(week) !== null;
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
        return VALID_SUB_TAB_IDS.slice();
    }

    function getWeekRange() {
        return CalendarValidation.getWeekBounds();
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
        var state = getState();
        var diff = getStateDiff();
        return {
            state: state,
            diff: diff
        };
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

        // State setters (return boolean)
        selectClass: selectClass,
        selectWeek: selectWeek,
        selectStudent: selectStudent,
        selectInstructor: selectInstructor,
        switchSubTab: switchSubTab,

        // Bulk operations (return boolean)
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

        // Constants (derived from AcademyConstants)
        VALID_SUB_TABS: VALID_SUB_TAB_IDS
    };

})();
