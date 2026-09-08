/**
 * modules/academy/academy-ui.js - Academy UI State Management
 * Manages transient UI state for the Academy module
 * 
 * This module provides:
 *   - UI state management (activeTab, selectedClassId, selectedStudentId, etc.)
 *   - State persistence (sessionStorage)
 *   - State restoration on page load
 *   - Filter state management
 *   - Week selection state
 * 
 * IMPORTANT:
 *   - UI STATE ONLY - no domain data, no mutations
 *   - No AcademyQueries dependencies - state is purely UI
 *   - No persistence to IndexedDB (sessionStorage only for UX)
 *   - Filters are UI state, not domain queries
 *   - This module is the SINGLE SOURCE OF TRUTH for UI state
 * 
 * STATE CATEGORIES:
 *   - Navigation: activeTab, selectedClassId, selectedStudentId, selectedInstructorId
 *   - Display: displayWeek
 *   - Filters: search terms per tab
 *   - Expansion: expandedIds
 * 
 * DEPENDENCIES:
 *   - window.AcademyConstants (for sub-tab definitions) - MANDATORY
 * 
 * USAGE:
 *   var UI = window.AcademyUI;
 *   UI.init();
 *   UI.setActiveTab('class');
 *   var tab = UI.getActiveTab();
 *   UI.setDisplayWeek(5);
 *   UI.selectClass('class_123');
 *   var selected = UI.getSelectedClassId();
 */

(function() {
    'use strict';

    if (window.__academyUILoaded) {
        return;
    }
    window.__academyUILoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var AcademyConstants = window.AcademyConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyConstants || !Array.isArray(AcademyConstants.ACADEMY_SUBTABS)) {
            missing.push('AcademyConstants.ACADEMY_SUBTABS');
        }

        if (missing.length > 0) {
            console.warn('[AcademyUI] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // DEFAULT STATE - Immutable template
    // ============================================================

    var DEFAULT_STATE = {
        // Navigation
        activeTab: 'class',
        selectedClassId: null,
        selectedStudentId: null,
        selectedInstructorId: null,

        // Display
        displayWeek: 1,

        // Filters
        filters: {
            class: {
                search: '',
                status: 'all'
            },
            student: {
                search: '',
                status: 'all'
            },
            faculty: {
                search: '',
                status: 'all'
            }
        },

        // Expansion
        expandedIds: {}
    };

    // ============================================================
    // VALID SUB-TABS (from AcademyConstants)
    // ============================================================

    var VALID_TABS = AcademyConstants.ACADEMY_SUBTABS.map(function(tab) {
        return tab.id;
    });

    var DEFAULT_TAB = VALID_TABS.length > 0 ? VALID_TABS[0] : 'class';

    // ============================================================
    // LIVE STATE
    // ============================================================

    var _state = null;

    // ============================================================
    // STORAGE KEY
    // ============================================================

    var STORAGE_KEY = 'academy_ui_state';

    // ============================================================
    // STATE INITIALIZATION
    // ============================================================

    function getDefaultState() {
        return JSON.parse(JSON.stringify(DEFAULT_STATE));
    }

    function loadState() {
        try {
            var saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                var parsed = JSON.parse(saved);
                var merged = getDefaultState();

                for (var key in parsed) {
                    if (Object.prototype.hasOwnProperty.call(merged, key)) {
                        if (key === 'filters' && typeof parsed[key] === 'object') {
                            for (var tab in parsed[key]) {
                                if (Object.prototype.hasOwnProperty.call(merged[key], tab)) {
                                    for (var filterKey in parsed[key][tab]) {
                                        merged[key][tab][filterKey] = parsed[key][tab][filterKey];
                                    }
                                }
                            }
                        } else if (key === 'expandedIds' && typeof parsed[key] === 'object') {
                            for (var id in parsed[key]) {
                                merged[key][id] = parsed[key][id];
                            }
                        } else {
                            merged[key] = parsed[key];
                        }
                    }
                }

                // Validate activeTab
                if (VALID_TABS.indexOf(merged.activeTab) === -1) {
                    merged.activeTab = DEFAULT_TAB;
                }

                return merged;
            }
        } catch (e) {
            // Ignore storage errors
        }
        return getDefaultState();
    }

    function saveState() {
        if (!_state) {
            return;
        }
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
        } catch (e) {
            // Ignore storage errors
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Initialize the UI state.
     * Should be called once at module startup.
     */
    function init() {
        _state = loadState();
    }

    /**
     * Get the current UI state.
     * 
     * @param {string} key - Optional state key
     * @returns {*} State value or entire state
     */
    function getState(key) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (key) {
            return _state[key];
        }
        return _state;
    }

    /**
     * Set a UI state value.
     * 
     * @param {string} key - State key
     * @param {*} value - Value to set
     */
    function setState(key, value) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state[key] = value;
        saveState();
    }

    /**
     * Update multiple state values at once.
     * 
     * @param {object} updates - Key-value pairs to update
     */
    function updateState(updates) {
        if (!_state) {
            _state = getDefaultState();
        }
        for (var key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                _state[key] = updates[key];
            }
        }
        saveState();
    }

    /**
     * Reset state to defaults.
     */
    function resetState() {
        _state = getDefaultState();
        saveState();
    }

    // ============================================================
    // NAVIGATION
    // ============================================================

    /**
     * Get the active sub-tab.
     * 
     * @returns {string} Active tab ID
     */
    function getActiveTab() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.activeTab;
    }

    /**
     * Set the active sub-tab.
     * 
     * @param {string} tab - Tab ID ('class', 'student', 'faculty')
     * @returns {boolean} True if valid
     */
    function setActiveTab(tab) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (VALID_TABS.indexOf(tab) === -1) {
            return false;
        }
        if (tab !== _state.activeTab) {
            _state.activeTab = tab;
            saveState();
        }
        return true;
    }

    /**
     * Check if a tab is valid.
     * 
     * @param {string} tab - Tab ID
     * @returns {boolean} True if valid
     */
    function isValidTab(tab) {
        return VALID_TABS.indexOf(tab) !== -1;
    }

    /**
     * Get all valid tab IDs.
     * 
     * @returns {Array} Array of valid tab IDs
     */
    function getValidTabs() {
        return VALID_TABS.slice();
    }

    // ============================================================
    // SELECTIONS
    // ============================================================

    /**
     * Get the selected class ID.
     * 
     * @returns {string|null} Selected class ID or null
     */
    function getSelectedClassId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.selectedClassId;
    }

    /**
     * Set the selected class ID.
     * 
     * @param {string|null} classId - Class ID or null
     */
    function selectClass(classId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (classId !== _state.selectedClassId) {
            _state.selectedClassId = classId;
            saveState();
        }
    }

    /**
     * Get the selected student ID.
     * 
     * @returns {string|null} Selected student ID or null
     */
    function getSelectedStudentId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.selectedStudentId;
    }

    /**
     * Set the selected student ID.
     * 
     * @param {string|null} studentId - Student ID or null
     */
    function selectStudent(studentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (studentId !== _state.selectedStudentId) {
            _state.selectedStudentId = studentId;
            saveState();
        }
    }

    /**
     * Get the selected instructor ID.
     * 
     * @returns {string|null} Selected instructor ID or null
     */
    function getSelectedInstructorId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.selectedInstructorId;
    }

    /**
     * Set the selected instructor ID.
     * 
     * @param {string|null} instructorId - Instructor ID or null
     */
    function selectInstructor(instructorId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (instructorId !== _state.selectedInstructorId) {
            _state.selectedInstructorId = instructorId;
            saveState();
        }
    }

    /**
     * Clear all selections.
     */
    function clearSelections() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.selectedClassId = null;
        _state.selectedStudentId = null;
        _state.selectedInstructorId = null;
        saveState();
    }

    /**
     * Clear selections for a specific type.
     * 
     * @param {string} type - 'class', 'student', or 'instructor'
     */
    function clearSelection(type) {
        if (!_state) {
            _state = getDefaultState();
        }
        var key = 'selected' + type.charAt(0).toUpperCase() + type.slice(1) + 'Id';
        if (key in _state) {
            _state[key] = null;
            saveState();
        }
    }

    // ============================================================
    // DISPLAY WEEK
    // ============================================================

    /**
     * Get the display week.
     * 
     * @returns {number} Display week
     */
    function getDisplayWeek() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.displayWeek || 1;
    }

    /**
     * Set the display week.
     * 
     * @param {number} week - Week number
     */
    function setDisplayWeek(week) {
        if (!_state) {
            _state = getDefaultState();
        }
        var num = parseInt(week, 10);
        if (isNaN(num) || num < 1) {
            return;
        }
        if (num !== _state.displayWeek) {
            _state.displayWeek = num;
            saveState();
        }
    }

    // ============================================================
    // FILTERS
    // ============================================================

    /**
     * Get filters for a specific tab.
     * 
     * @param {string} tab - Tab ID ('class', 'student', 'faculty')
     * @returns {object} Filter object
     */
    function getFilter(tab) {
        if (!_state) {
            _state = getDefaultState();
        }
        var filters = _state.filters[tab];
        if (!filters) {
            return { search: '', status: 'all' };
        }
        return Object.assign({}, filters);
    }

    /**
     * Set a filter value for a specific tab.
     * 
     * @param {string} tab - Tab ID
     * @param {string} key - Filter key
     * @param {*} value - Filter value
     */
    function setFilter(tab, key, value) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (!_state.filters[tab]) {
            _state.filters[tab] = { search: '', status: 'all' };
        }
        _state.filters[tab][key] = value;
        saveState();
    }

    /**
     * Update multiple filter values for a specific tab.
     * 
     * @param {string} tab - Tab ID
     * @param {object} updates - Key-value pairs to update
     */
    function updateFilter(tab, updates) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (!_state.filters[tab]) {
            _state.filters[tab] = { search: '', status: 'all' };
        }
        for (var key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                _state.filters[tab][key] = updates[key];
            }
        }
        saveState();
    }

    /**
     * Reset filters for a specific tab to defaults.
     * 
     * @param {string} tab - Tab ID
     */
    function resetFilter(tab) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.filters[tab] = { search: '', status: 'all' };
        saveState();
    }

    /**
     * Reset all filters to defaults.
     */
    function resetAllFilters() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.filters = JSON.parse(JSON.stringify(DEFAULT_STATE.filters));
        saveState();
    }

    // ============================================================
    // EXPANSION
    // ============================================================

    /**
     * Check if an ID is expanded.
     * 
     * @param {string} id - ID to check
     * @returns {boolean} True if expanded
     */
    function isExpanded(id) {
        if (!_state) {
            _state = getDefaultState();
        }
        return !!_state.expandedIds[id];
    }

    /**
     * Set expanded state for an ID.
     * 
     * @param {string} id - ID
     * @param {boolean} expanded - Expanded state
     */
    function setExpanded(id, expanded) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (expanded) {
            _state.expandedIds[id] = true;
        } else {
            delete _state.expandedIds[id];
        }
        saveState();
    }

    /**
     * Toggle expanded state for an ID.
     * 
     * @param {string} id - ID
     * @returns {boolean} New expanded state
     */
    function toggleExpanded(id) {
        if (!_state) {
            _state = getDefaultState();
        }
        var current = !!_state.expandedIds[id];
        if (current) {
            delete _state.expandedIds[id];
        } else {
            _state.expandedIds[id] = true;
        }
        saveState();
        return !current;
    }

    /**
     * Get all expanded IDs.
     * 
     * @returns {object} Map of expanded IDs
     */
    function getExpandedIds() {
        if (!_state) {
            _state = getDefaultState();
        }
        return Object.assign({}, _state.expandedIds);
    }

    /**
     * Clear all expanded IDs.
     */
    function clearExpanded() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.expandedIds = {};
        saveState();
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    // Auto-initialize on load
    init();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyUI = {
        // State management
        init: init,
        getState: getState,
        setState: setState,
        updateState: updateState,
        resetState: resetState,

        // Navigation
        getActiveTab: getActiveTab,
        setActiveTab: setActiveTab,
        isValidTab: isValidTab,
        getValidTabs: getValidTabs,

        // Selections
        getSelectedClassId: getSelectedClassId,
        selectClass: selectClass,
        getSelectedStudentId: getSelectedStudentId,
        selectStudent: selectStudent,
        getSelectedInstructorId: getSelectedInstructorId,
        selectInstructor: selectInstructor,
        clearSelections: clearSelections,
        clearSelection: clearSelection,

        // Display week
        getDisplayWeek: getDisplayWeek,
        setDisplayWeek: setDisplayWeek,

        // Filters
        getFilter: getFilter,
        setFilter: setFilter,
        updateFilter: updateFilter,
        resetFilter: resetFilter,
        resetAllFilters: resetAllFilters,

        // Expansion
        isExpanded: isExpanded,
        setExpanded: setExpanded,
        toggleExpanded: toggleExpanded,
        getExpandedIds: getExpandedIds,
        clearExpanded: clearExpanded,

        // Default state (read-only)
        DEFAULT_STATE: DEFAULT_STATE,
        VALID_TABS: VALID_TABS
    };

})();