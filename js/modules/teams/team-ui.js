/**
 * modules/teams/team-ui.js - Team UI State Management
 * Manages transient UI state for the team module
 * 
 * This module provides:
 *   - UI state management (currentTab, expandedTeamId, filters, modal state)
 *   - State persistence (sessionStorage)
 *   - State restoration on page load
 *   - Filter state management
 *   - Default filter values
 * 
 * IMPORTANT:
 *   - UI STATE ONLY - no domain data, no mutations
 *   - No TeamQueries dependencies - state is purely UI
 *   - No persistence to IndexedDB (sessionStorage only for UX)
 *   - Filters are UI state, not domain queries
 *   - This module is the SINGLE SOURCE OF TRUTH for UI state
 * 
 * STATE CATEGORIES:
 *   - Navigation: currentTab, expandedTeamId
 *   - Filters: filter values per tab
 *   - Modal state: which modal is open, IDs for editing
 *   - Flags: listExpanded, showInactive
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var UI = window.TeamUI;
 *   UI.init();
 *   UI.setCurrentTab('professional');
 *   var tab = UI.getCurrentTab();
 *   UI.setFilter('professional', 'filterYear', 2025);
 *   var filter = UI.getFilter('professional');
 *   var defaultFilter = UI.getDefaultFilter('professional');
 */

(function() {
    'use strict';

    if (window.__teamUILoaded) {
        return;
    }
    window.__teamUILoaded = true;

    // ============================================================
    // DEFAULT STATE - Immutable template
    // ============================================================

    var DEFAULT_STATE = {
        // Navigation
        currentTab: 'professional',
        expandedTeamId: null,

        // Filters per tab
        filters: {
            professional: {
                filterYear: '',
                filterStatus: 'active'
            },
            temporary: {
                filterYear: '',
                filterStatus: 'active'
            },
            civilian: {
                filterStatus: 'active'
            }
        },

        // Modal state
        modalTeamId: null,
        modalMemberId: null,
        modalRankingPeriod: null,

        // UI flags
        listExpanded: false,
        showInactive: false
    };

    // ============================================================
    // DEFAULT FILTERS (moved from team-filters.js)
    // ============================================================

    var DEFAULT_FILTERS = {
        'professional': { filterYear: '', filterStatus: 'active' },
        'temporary': { filterYear: '', filterStatus: 'active' },
        'civilian': { filterStatus: 'active' }
    };

    // ============================================================
    // LIVE STATE
    // ============================================================

    var _state = null;

    // ============================================================
    // STORAGE KEY
    // ============================================================

    var STORAGE_KEY = 'team_ui_state';

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
                        } else {
                            merged[key] = parsed[key];
                        }
                    }
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

    /**
     * Get the current tab.
     * 
     * @returns {string} Current tab ID
     */
    function getCurrentTab() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.currentTab;
    }

    /**
     * Set the current tab.
     * 
     * @param {string} tab - Tab ID ('professional', 'temporary', 'civilian')
     */
    function setCurrentTab(tab) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (tab !== _state.currentTab) {
            _state.currentTab = tab;
            saveState();
        }
    }

    /**
     * Get the expanded team ID.
     * 
     * @returns {string|null} Expanded team ID or null
     */
    function getExpandedTeamId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedTeamId;
    }

    /**
     * Set the expanded team ID.
     * 
     * @param {string|null} teamId - Team ID to expand, or null to collapse
     */
    function setExpandedTeamId(teamId) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.expandedTeamId = teamId;
        saveState();
    }

    /**
     * Toggle the expanded state of a team.
     * 
     * @param {string} teamId - Team ID to toggle
     * @returns {boolean} True if expanded after toggle
     */
    function toggleExpandedTeam(teamId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (_state.expandedTeamId === teamId) {
            _state.expandedTeamId = null;
            saveState();
            return false;
        } else {
            _state.expandedTeamId = teamId;
            saveState();
            return true;
        }
    }

    /**
     * Check if a team is expanded.
     * 
     * @param {string} teamId - Team ID to check
     * @returns {boolean} True if expanded
     */
    function isTeamExpanded(teamId) {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedTeamId === teamId;
    }

    // ============================================================
    // FILTER MANAGEMENT
    // ============================================================

    /**
     * Get default filter for a tab.
     * Moved from team-filters.js.
     * 
     * @param {string} tab - Tab ID
     * @returns {object} Default filter object
     */
    function getDefaultFilter(tab) {
        return DEFAULT_FILTERS[tab] || DEFAULT_FILTERS['professional'];
    }

    /**
     * Get filters for a specific tab.
     * 
     * @param {string} tab - Tab ID
     * @returns {object} Filter object
     */
    function getFilter(tab) {
        if (!_state) {
            _state = getDefaultState();
        }
        var filters = _state.filters[tab];
        if (!filters) {
            return Object.assign({}, getDefaultFilter(tab));
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
            _state.filters[tab] = Object.assign({}, getDefaultFilter(tab));
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
            _state.filters[tab] = Object.assign({}, getDefaultFilter(tab));
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
        _state.filters[tab] = Object.assign({}, getDefaultFilter(tab));
        saveState();
    }

    /**
     * Reset all filters to defaults.
     */
    function resetAllFilters() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.filters = JSON.parse(JSON.stringify(DEFAULT_FILTERS));
        saveState();
    }

    // ============================================================
    // MODAL STATE MANAGEMENT
    // ============================================================

    /**
     * Get the current modal team ID.
     * 
     * @returns {string|null} Modal team ID or null
     */
    function getModalTeamId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.modalTeamId;
    }

    /**
     * Set the modal team ID.
     * 
     * @param {string|null} teamId - Team ID for modal, or null
     */
    function setModalTeamId(teamId) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.modalTeamId = teamId;
        saveState();
    }

    /**
     * Get the modal member ID.
     * 
     * @returns {string|null} Modal member ID or null
     */
    function getModalMemberId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.modalMemberId;
    }

    /**
     * Set the modal member ID.
     * 
     * @param {string|null} memberId - Member ID for modal, or null
     */
    function setModalMemberId(memberId) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.modalMemberId = memberId;
        saveState();
    }

    /**
     * Get the modal ranking period.
     * 
     * @returns {string|null} Modal ranking period or null
     */
    function getModalRankingPeriod() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.modalRankingPeriod;
    }

    /**
     * Set the modal ranking period.
     * 
     * @param {string|null} period - Ranking period for modal, or null
     */
    function setModalRankingPeriod(period) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.modalRankingPeriod = period;
        saveState();
    }

    /**
     * Clear all modal state.
     */
    function clearModalState() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.modalTeamId = null;
        _state.modalMemberId = null;
        _state.modalRankingPeriod = null;
        saveState();
    }

    // ============================================================
    // FLAG MANAGEMENT
    // ============================================================

    /**
     * Check if the list is expanded.
     * 
     * @returns {boolean} True if expanded
     */
    function isListExpanded() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.listExpanded || false;
    }

    /**
     * Set the list expanded state.
     * 
     * @param {boolean} expanded - Expanded state
     */
    function setListExpanded(expanded) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.listExpanded = expanded;
        saveState();
    }

    /**
     * Check if inactive teams should be shown.
     * 
     * @returns {boolean} True if inactive should be shown
     */
    function shouldShowInactive() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.showInactive || false;
    }

    /**
     * Set the show inactive flag.
     * 
     * @param {boolean} show - Show inactive state
     */
    function setShowInactive(show) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.showInactive = show;
        saveState();
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate a tab ID.
     * 
     * @param {string} tab - Tab ID to validate
     * @returns {boolean} True if valid
     */
    function isValidTab(tab) {
        return tab === 'professional' || tab === 'temporary' || tab === 'civilian';
    }

    /**
     * Get a valid tab ID, falling back to default.
     * 
     * @param {string} tab - Tab ID to validate
     * @returns {string} Valid tab ID
     */
    function getValidTab(tab) {
        return isValidTab(tab) ? tab : 'professional';
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    // Auto-initialize on load
    init();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamUI = {
        // State management
        init: init,
        getState: getState,
        setState: setState,
        updateState: updateState,
        resetState: resetState,

        // Navigation
        getCurrentTab: getCurrentTab,
        setCurrentTab: setCurrentTab,

        // Expansion
        getExpandedTeamId: getExpandedTeamId,
        setExpandedTeamId: setExpandedTeamId,
        toggleExpandedTeam: toggleExpandedTeam,
        isTeamExpanded: isTeamExpanded,

        // Filters
        getDefaultFilter: getDefaultFilter,
        getFilter: getFilter,
        setFilter: setFilter,
        updateFilter: updateFilter,
        resetFilter: resetFilter,
        resetAllFilters: resetAllFilters,

        // Modal
        getModalTeamId: getModalTeamId,
        setModalTeamId: setModalTeamId,
        getModalMemberId: getModalMemberId,
        setModalMemberId: setModalMemberId,
        getModalRankingPeriod: getModalRankingPeriod,
        setModalRankingPeriod: setModalRankingPeriod,
        clearModalState: clearModalState,

        // Flags
        isListExpanded: isListExpanded,
        setListExpanded: setListExpanded,
        shouldShowInactive: shouldShowInactive,
        setShowInactive: setShowInactive,

        // Validation
        isValidTab: isValidTab,
        getValidTab: getValidTab,

        // Default state (read-only)
        DEFAULT_STATE: DEFAULT_STATE,
        DEFAULT_FILTERS: DEFAULT_FILTERS
    };

})();