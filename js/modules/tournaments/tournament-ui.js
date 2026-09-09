/**
 * modules/tournaments/tournaments-ui.js - Tournament UI State Management
 * Manages transient UI state for the tournament module
 * Path: js/modules/tournaments/tournaments-ui.js
 * 
 * This module provides:
 *   - UI state management (selectedTournamentId, activeTab, filters, expanded items)
 *   - State persistence (sessionStorage)
 *   - State restoration on page load
 *   - Filter state management
 *   - Modal state management
 *   - View mode management
 * 
 * IMPORTANT:
 *   - UI STATE ONLY - no domain data, no mutations
 *   - No TournamentQueries dependencies - state is purely UI
 *   - No persistence to IndexedDB (sessionStorage only for UX)
 *   - Filters are UI state, not domain queries
 *   - This module is the SINGLE SOURCE OF TRUTH for tournament UI state
 *   - All data access removed - this is pure state management
 * 
 * STATE CATEGORIES:
 *   - Navigation: selectedTournamentId, activeTab
 *   - Filters: statusFilter, searchFilter, modeFilter, classFilter
 *   - Expansion: expandedTournamentId, expandedRoundId, expandedMatchId
 *   - Modal: modalState (type, data)
 *   - View: viewMode (list/grid/detail)
 *   - Sorting: sortField, sortDirection
 *   - Pagination: page, perPage
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   var UI = window.TournamentsUI;
 *   UI.init();
 *   UI.setSelectedTournamentId('tourn_123');
 *   var id = UI.getSelectedTournamentId();
 *   UI.setFilter('status', 'active');
 *   var filter = UI.getFilter('status');
 */

(function() {
    'use strict';

    if (window.__tournamentsUILoaded) {
        return;
    }
    window.__tournamentsUILoaded = true;

    // ============================================================
    // DEFAULT STATE - Immutable template
    // ============================================================

    var DEFAULT_STATE = {
        // Navigation
        selectedTournamentId: null,
        activeTab: 'list',  // 'list' | 'detail' | 'grid'

        // Filters
        filters: {
            status: 'all',      // 'all' | 'active' | 'completed' | 'draft'
            search: '',
            mode: 'all',        // 'all' | 'teams' | 'individuals'
            classId: 'all'
        },

        // Expansion
        expandedTournamentId: null,
        expandedRoundId: null,
        expandedMatchId: null,

        // Modal state
        modal: {
            type: null,         // 'tournament-form' | 'participant-form' | 'match-form' | 'complete-match'
            data: null          // Additional modal data
        },

        // View
        viewMode: 'list',       // 'list' | 'grid' | 'detail'

        // Sorting
        sort: {
            field: 'createdAt',
            direction: 'desc'   // 'asc' | 'desc'
        },

        // Pagination
        pagination: {
            page: 1,
            perPage: 20
        }
    };

    // ============================================================
    // LIVE STATE
    // ============================================================

    var _state = null;

    // ============================================================
    // STORAGE KEY
    // ============================================================

    var STORAGE_KEY = 'tournament_ui_state';

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
                            for (var filterKey in parsed[key]) {
                                if (Object.prototype.hasOwnProperty.call(merged[key], filterKey)) {
                                    merged[key][filterKey] = parsed[key][filterKey];
                                }
                            }
                        } else if (key === 'modal' && typeof parsed[key] === 'object') {
                            merged[key].type = parsed[key].type || null;
                            merged[key].data = parsed[key].data || null;
                        } else if (key === 'sort' && typeof parsed[key] === 'object') {
                            merged[key].field = parsed[key].field || 'createdAt';
                            merged[key].direction = parsed[key].direction || 'desc';
                        } else if (key === 'pagination' && typeof parsed[key] === 'object') {
                            merged[key].page = parsed[key].page || 1;
                            merged[key].perPage = parsed[key].perPage || 20;
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
        var changed = false;
        for (var key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                _state[key] = updates[key];
                changed = true;
            }
        }
        if (changed) {
            saveState();
        }
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
     * Get the selected tournament ID.
     * 
     * @returns {string|null} Selected tournament ID or null
     */
    function getSelectedTournamentId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.selectedTournamentId;
    }

    /**
     * Set the selected tournament ID.
     * 
     * @param {string|null} tournamentId - Tournament ID or null
     */
    function setSelectedTournamentId(tournamentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (tournamentId !== _state.selectedTournamentId) {
            _state.selectedTournamentId = tournamentId;
            saveState();
        }
    }

    /**
     * Clear the selected tournament.
     */
    function clearSelectedTournament() {
        setSelectedTournamentId(null);
    }

    /**
     * Get the active tab.
     * 
     * @returns {string} Active tab ('list' | 'detail' | 'grid')
     */
    function getActiveTab() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.activeTab || 'list';
    }

    /**
     * Set the active tab.
     * 
     * @param {string} tab - Tab ('list' | 'detail' | 'grid')
     */
    function setActiveTab(tab) {
        if (!_state) {
            _state = getDefaultState();
        }
        var validTabs = ['list', 'detail', 'grid'];
        if (validTabs.indexOf(tab) === -1) {
            return;
        }
        if (tab !== _state.activeTab) {
            _state.activeTab = tab;
            saveState();
        }
    }

    // ============================================================
    // FILTERS
    // ============================================================

    /**
     * Get a filter value.
     * 
     * @param {string} key - Filter key ('status', 'search', 'mode', 'classId')
     * @returns {*} Filter value
     */
    function getFilter(key) {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.filters[key];
    }

    /**
     * Get all filters.
     * 
     * @returns {object} Filter object
     */
    function getFilters() {
        if (!_state) {
            _state = getDefaultState();
        }
        return Object.assign({}, _state.filters);
    }

    /**
     * Set a filter value.
     * 
     * @param {string} key - Filter key ('status', 'search', 'mode', 'classId')
     * @param {*} value - Filter value
     */
    function setFilter(key, value) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (_state.filters[key] !== value) {
            _state.filters[key] = value;
            saveState();
        }
    }

    /**
     * Update multiple filters at once.
     * 
     * @param {object} updates - Key-value pairs to update
     */
    function updateFilters(updates) {
        if (!_state) {
            _state = getDefaultState();
        }
        var changed = false;
        for (var key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                if (_state.filters[key] !== updates[key]) {
                    _state.filters[key] = updates[key];
                    changed = true;
                }
            }
        }
        if (changed) {
            saveState();
        }
    }

    /**
     * Reset all filters to defaults.
     */
    function resetFilters() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.filters = JSON.parse(JSON.stringify(DEFAULT_STATE.filters));
        saveState();
    }

    /**
     * Reset a specific filter to default.
     * 
     * @param {string} key - Filter key
     */
    function resetFilter(key) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (_state.filters[key] !== undefined) {
            _state.filters[key] = DEFAULT_STATE.filters[key];
            saveState();
        }
    }

    // ============================================================
    // EXPANSION
    // ============================================================

    /**
     * Get the expanded tournament ID.
     * 
     * @returns {string|null} Expanded tournament ID or null
     */
    function getExpandedTournamentId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedTournamentId;
    }

    /**
     * Set the expanded tournament ID.
     * 
     * @param {string|null} tournamentId - Tournament ID or null
     */
    function setExpandedTournamentId(tournamentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (tournamentId !== _state.expandedTournamentId) {
            _state.expandedTournamentId = tournamentId;
            saveState();
        }
    }

    /**
     * Toggle the expanded state of a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {boolean} True if expanded after toggle
     */
    function toggleExpandedTournament(tournamentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        var current = _state.expandedTournamentId;
        if (current === tournamentId) {
            _state.expandedTournamentId = null;
            saveState();
            return false;
        } else {
            _state.expandedTournamentId = tournamentId;
            saveState();
            return true;
        }
    }

    /**
     * Check if a tournament is expanded.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {boolean} True if expanded
     */
    function isTournamentExpanded(tournamentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedTournamentId === tournamentId;
    }

    /**
     * Get the expanded round ID.
     * 
     * @returns {string|null} Expanded round ID or null
     */
    function getExpandedRoundId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedRoundId;
    }

    /**
     * Set the expanded round ID.
     * 
     * @param {string|null} roundId - Round ID or null
     */
    function setExpandedRoundId(roundId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (roundId !== _state.expandedRoundId) {
            _state.expandedRoundId = roundId;
            saveState();
        }
    }

    /**
     * Toggle the expanded state of a round.
     * 
     * @param {string} roundId - Round ID
     * @returns {boolean} True if expanded after toggle
     */
    function toggleExpandedRound(roundId) {
        if (!_state) {
            _state = getDefaultState();
        }
        var current = _state.expandedRoundId;
        if (current === roundId) {
            _state.expandedRoundId = null;
            saveState();
            return false;
        } else {
            _state.expandedRoundId = roundId;
            saveState();
            return true;
        }
    }

    /**
     * Get the expanded match ID.
     * 
     * @returns {string|null} Expanded match ID or null
     */
    function getExpandedMatchId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedMatchId;
    }

    /**
     * Set the expanded match ID.
     * 
     * @param {string|null} matchId - Match ID or null
     */
    function setExpandedMatchId(matchId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (matchId !== _state.expandedMatchId) {
            _state.expandedMatchId = matchId;
            saveState();
        }
    }

    // ============================================================
    // MODAL STATE
    // ============================================================

    /**
     * Get the modal state.
     * 
     * @returns {object} { type: string|null, data: object|null }
     */
    function getModalState() {
        if (!_state) {
            _state = getDefaultState();
        }
        return Object.assign({}, _state.modal);
    }

    /**
     * Set the modal state.
     * 
     * @param {string} type - Modal type ('tournament-form', 'participant-form', 'match-form', 'complete-match')
     * @param {object} data - Additional modal data
     */
    function setModalState(type, data) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.modal.type = type || null;
        _state.modal.data = data || null;
        saveState();
    }

    /**
     * Clear the modal state.
     */
    function clearModalState() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.modal.type = null;
        _state.modal.data = null;
        saveState();
    }

    /**
     * Check if a modal is open.
     * 
     * @returns {boolean} True if a modal is open
     */
    function isModalOpen() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.modal.type !== null;
    }

    /**
     * Check if a specific modal is open.
     * 
     * @param {string} type - Modal type
     * @returns {boolean} True if the specific modal is open
     */
    function isModalType(type) {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.modal.type === type;
    }

    // ============================================================
    // VIEW MODE
    // ============================================================

    /**
     * Get the current view mode.
     * 
     * @returns {string} View mode ('list' | 'grid' | 'detail')
     */
    function getViewMode() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.viewMode || 'list';
    }

    /**
     * Set the view mode.
     * 
     * @param {string} mode - View mode ('list' | 'grid' | 'detail')
     */
    function setViewMode(mode) {
        if (!_state) {
            _state = getDefaultState();
        }
        var validModes = ['list', 'grid', 'detail'];
        if (validModes.indexOf(mode) === -1) {
            return;
        }
        if (mode !== _state.viewMode) {
            _state.viewMode = mode;
            saveState();
        }
    }

    /**
     * Toggle between list and grid view.
     */
    function toggleViewMode() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.viewMode = _state.viewMode === 'list' ? 'grid' : 'list';
        saveState();
    }

    // ============================================================
    // SORTING
    // ============================================================

    /**
     * Get the current sort configuration.
     * 
     * @returns {object} { field: string, direction: string }
     */
    function getSort() {
        if (!_state) {
            _state = getDefaultState();
        }
        return Object.assign({}, _state.sort);
    }

    /**
     * Set the sort field.
     * 
     * @param {string} field - Sort field ('name', 'createdAt', 'status', 'participantCount')
     */
    function setSortField(field) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (_state.sort.field !== field) {
            _state.sort.field = field;
            saveState();
        }
    }

    /**
     * Set the sort direction.
     * 
     * @param {string} direction - Sort direction ('asc' | 'desc')
     */
    function setSortDirection(direction) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (direction !== 'asc' && direction !== 'desc') {
            return;
        }
        if (_state.sort.direction !== direction) {
            _state.sort.direction = direction;
            saveState();
        }
    }

    /**
     * Toggle the sort direction.
     */
    function toggleSortDirection() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.sort.direction = _state.sort.direction === 'asc' ? 'desc' : 'asc';
        saveState();
    }

    /**
     * Set sort field and direction.
     * 
     * @param {string} field - Sort field
     * @param {string} direction - Sort direction ('asc' | 'desc')
     */
    function setSort(field, direction) {
        if (!_state) {
            _state = getDefaultState();
        }
        var changed = false;
        if (_state.sort.field !== field) {
            _state.sort.field = field;
            changed = true;
        }
        if (direction && _state.sort.direction !== direction) {
            _state.sort.direction = direction;
            changed = true;
        }
        if (changed) {
            saveState();
        }
    }

    // ============================================================
    // PAGINATION
    // ============================================================

    /**
     * Get the current page.
     * 
     * @returns {number} Current page
     */
    function getPage() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.pagination.page || 1;
    }

    /**
     * Set the current page.
     * 
     * @param {number} page - Page number
     */
    function setPage(page) {
        if (!_state) {
            _state = getDefaultState();
        }
        var pageNum = parseInt(page, 10);
        if (isNaN(pageNum) || pageNum < 1) {
            return;
        }
        if (_state.pagination.page !== pageNum) {
            _state.pagination.page = pageNum;
            saveState();
        }
    }

    /**
     * Get items per page.
     * 
     * @returns {number} Items per page
     */
    function getPerPage() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.pagination.perPage || 20;
    }

    /**
     * Set items per page.
     * 
     * @param {number} perPage - Items per page
     */
    function setPerPage(perPage) {
        if (!_state) {
            _state = getDefaultState();
        }
        var num = parseInt(perPage, 10);
        if (isNaN(num) || num < 1) {
            return;
        }
        if (_state.pagination.perPage !== num) {
            _state.pagination.perPage = num;
            // Reset to page 1 when changing per page
            _state.pagination.page = 1;
            saveState();
        }
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    /**
     * Validate a tab value.
     * 
     * @param {string} tab - Tab to validate
     * @returns {boolean} True if valid
     */
    function isValidTab(tab) {
        return tab === 'list' || tab === 'detail' || tab === 'grid';
    }

    /**
     * Validate a view mode.
     * 
     * @param {string} mode - View mode to validate
     * @returns {boolean} True if valid
     */
    function isValidViewMode(mode) {
        return mode === 'list' || mode === 'grid' || mode === 'detail';
    }

    /**
     * Validate a filter key.
     * 
     * @param {string} key - Filter key to validate
     * @returns {boolean} True if valid
     */
    function isValidFilterKey(key) {
        return key === 'status' || key === 'search' || key === 'mode' || key === 'classId';
    }

    /**
     * Validate a status filter value.
     * 
     * @param {string} status - Status to validate
     * @returns {boolean} True if valid
     */
    function isValidStatusFilter(status) {
        return status === 'all' || status === 'active' || status === 'completed' || status === 'draft';
    }

    /**
     * Validate a mode filter value.
     * 
     * @param {string} mode - Mode to validate
     * @returns {boolean} True if valid
     */
    function isValidModeFilter(mode) {
        return mode === 'all' || mode === 'teams' || mode === 'individuals';
    }

    // ============================================================
    // REMOVED METHODS - No longer provided (moved to Events or removed)
    // ============================================================

    // The following methods have been REMOVED from this module:
    // - render() - Moved to index.js as renderTournamentContainer()
    // - viewTournament() - Moved to TournamentEvents
    // - closeDetail() - Moved to TournamentEvents
    // - showForm() - Moved to TournamentEvents
    // - handleDeleteTournament() - Moved to TournamentEvents
    // - handleRemoveParticipant() - Moved to TournamentEvents
    // - handleAddRound() - Moved to TournamentEvents
    // - handleRemoveRound() - Moved to TournamentEvents
    // - handleDeleteMatch() - Moved to TournamentEvents
    // - handleCompleteMatch() - Moved to TournamentEvents
    // - handleCompleteTournament() - Moved to TournamentEvents
    // - getGraduatingClasses() - Moved to Aggregator
    // - persistMutation() - Moved to TournamentEvents
    // - addEventListener() - Moved to TournamentEvents
    // - removeAllEventListeners() - Moved to TournamentEvents
    // - bindEvents() - Moved to TournamentEvents
    // - bindDetailEvents() - Moved to TournamentEvents
    // - bindFormEvents() - Moved to TournamentEvents

    // ============================================================
    // INITIALIZATION
    // ============================================================

    // Auto-initialize on load
    init();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsUI = {
        // State management
        init: init,
        getState: getState,
        setState: setState,
        updateState: updateState,
        resetState: resetState,

        // Navigation
        getSelectedTournamentId: getSelectedTournamentId,
        setSelectedTournamentId: setSelectedTournamentId,
        clearSelectedTournament: clearSelectedTournament,
        getActiveTab: getActiveTab,
        setActiveTab: setActiveTab,

        // Filters
        getFilter: getFilter,
        getFilters: getFilters,
        setFilter: setFilter,
        updateFilters: updateFilters,
        resetFilters: resetFilters,
        resetFilter: resetFilter,

        // Expansion
        getExpandedTournamentId: getExpandedTournamentId,
        setExpandedTournamentId: setExpandedTournamentId,
        toggleExpandedTournament: toggleExpandedTournament,
        isTournamentExpanded: isTournamentExpanded,
        getExpandedRoundId: getExpandedRoundId,
        setExpandedRoundId: setExpandedRoundId,
        toggleExpandedRound: toggleExpandedRound,
        getExpandedMatchId: getExpandedMatchId,
        setExpandedMatchId: setExpandedMatchId,

        // Modal
        getModalState: getModalState,
        setModalState: setModalState,
        clearModalState: clearModalState,
        isModalOpen: isModalOpen,
        isModalType: isModalType,

        // View mode
        getViewMode: getViewMode,
        setViewMode: setViewMode,
        toggleViewMode: toggleViewMode,

        // Sorting
        getSort: getSort,
        setSortField: setSortField,
        setSortDirection: setSortDirection,
        toggleSortDirection: toggleSortDirection,
        setSort: setSort,

        // Pagination
        getPage: getPage,
        setPage: setPage,
        getPerPage: getPerPage,
        setPerPage: setPerPage,

        // Validation
        isValidTab: isValidTab,
        isValidViewMode: isValidViewMode,
        isValidFilterKey: isValidFilterKey,
        isValidStatusFilter: isValidStatusFilter,
        isValidModeFilter: isValidModeFilter,

        // Default state (read-only)
        DEFAULT_STATE: DEFAULT_STATE
    };

})();
