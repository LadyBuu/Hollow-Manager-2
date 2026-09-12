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
 * STATE MODEL:
 * 
 *   activeTab:      'list' | 'detail'
 *                   Which panel is showing.
 *                   'list'   - the tournament list (or grid).
 *                   'detail' - a single tournament's detail panel.
 * 
 *   viewMode:       'list' | 'grid'
 *                   How the list panel is laid out.
 *                   ONLY consulted when activeTab === 'list'.
 *                   Never set to 'detail'; use setActiveTab instead.
 * 
 *   The two fields are orthogonal:
 *     - activeTab is which panel.
 *     - viewMode is how the list panel looks when it's the active panel.
 *   Returning from detail restores whatever viewMode the user last chose.
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
 *   UI.setActiveTab('detail');
 *   UI.setViewMode('grid');
 */

(function() {
    'use strict';

    if (window.__tournamentsUILoaded) {
        return;
    }
    window.__tournamentsUILoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_ACTIVE_TABS = ['list', 'detail'];
    var VALID_VIEW_MODES = ['list', 'grid'];

    // ============================================================
    // DEFAULT STATE - Immutable template
    // ============================================================

    var DEFAULT_STATE = {
        // Navigation
        selectedTournamentId: null,
        activeTab: 'list',      // 'list' | 'detail'

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

        // View layout for the list panel (only used when activeTab === 'list')
        viewMode: 'list',       // 'list' | 'grid'

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
                return mergeWithDefaults(parsed);
            }
        } catch (e) {
            // Ignore storage errors
        }
        return getDefaultState();
    }

    /**
     * Merge persisted state with defaults, validating each field.
     * Unknown fields are dropped. Invalid values fall back to defaults.
     * This is defensive: sessionStorage may contain state from an
     * earlier version of this module with a different shape.
     * 
     * @param {object} parsed - Parsed sessionStorage state
     * @returns {object} Merged state
     */
    function mergeWithDefaults(parsed) {
        var merged = getDefaultState();

        if (!parsed || typeof parsed !== 'object') {
            return merged;
        }

        // activeTab: only 'list' or 'detail'
        if (typeof parsed.activeTab === 'string' &&
            VALID_ACTIVE_TABS.indexOf(parsed.activeTab) !== -1) {
            merged.activeTab = parsed.activeTab;
        }

        // viewMode: only 'list' or 'grid'. Silently reject 'detail'
        // from legacy state that used the old (overlapping) enum.
        if (typeof parsed.viewMode === 'string' &&
            VALID_VIEW_MODES.indexOf(parsed.viewMode) !== -1) {
            merged.viewMode = parsed.viewMode;
        }

        // selectedTournamentId
        if (parsed.selectedTournamentId !== undefined &&
            parsed.selectedTournamentId !== null) {
            merged.selectedTournamentId = String(parsed.selectedTournamentId);
        }

        // Filters
        if (parsed.filters && typeof parsed.filters === 'object') {
            var filterKeys = ['status', 'search', 'mode', 'classId'];
            for (var i = 0; i < filterKeys.length; i++) {
                var key = filterKeys[i];
                if (parsed.filters[key] !== undefined) {
                    merged.filters[key] = parsed.filters[key];
                }
            }
        }

        // Expansion
        if (parsed.expandedTournamentId !== undefined) {
            merged.expandedTournamentId = parsed.expandedTournamentId;
        }
        if (parsed.expandedRoundId !== undefined) {
            merged.expandedRoundId = parsed.expandedRoundId;
        }
        if (parsed.expandedMatchId !== undefined) {
            merged.expandedMatchId = parsed.expandedMatchId;
        }

        // Modal
        if (parsed.modal && typeof parsed.modal === 'object') {
            merged.modal.type = parsed.modal.type || null;
            merged.modal.data = parsed.modal.data || null;
        }

        // Sort
        if (parsed.sort && typeof parsed.sort === 'object') {
            if (typeof parsed.sort.field === 'string') {
                merged.sort.field = parsed.sort.field;
            }
            if (parsed.sort.direction === 'asc' || parsed.sort.direction === 'desc') {
                merged.sort.direction = parsed.sort.direction;
            }
        }

        // Pagination
        if (parsed.pagination && typeof parsed.pagination === 'object') {
            if (typeof parsed.pagination.page === 'number' && parsed.pagination.page >= 1) {
                merged.pagination.page = parsed.pagination.page;
            }
            if (typeof parsed.pagination.perPage === 'number' && parsed.pagination.perPage >= 1) {
                merged.pagination.perPage = parsed.pagination.perPage;
            }
        }

        return merged;
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
    // PUBLIC API - Lifecycle
    // ============================================================

    function init() {
        _state = loadState();
    }

    function getState(key) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (key) {
            return _state[key];
        }
        return _state;
    }

    function setState(key, value) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state[key] = value;
        saveState();
    }

    function updateState(updates) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (!updates || typeof updates !== 'object') {
            return;
        }
        for (var key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                _state[key] = updates[key];
            }
        }
        saveState();
    }

    function resetState() {
        _state = getDefaultState();
        saveState();
    }

    // ============================================================
    // NAVIGATION - activeTab (which panel)
    // ============================================================

    function getSelectedTournamentId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.selectedTournamentId;
    }

    function setSelectedTournamentId(tournamentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        var normalised = tournamentId ? String(tournamentId) : null;
        if (normalised !== _state.selectedTournamentId) {
            _state.selectedTournamentId = normalised;
            saveState();
        }
    }

    function clearSelectedTournament() {
        setSelectedTournamentId(null);
    }

    /**
     * Get the active panel.
     * 
     * @returns {string} 'list' or 'detail'
     */
    function getActiveTab() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.activeTab || 'list';
    }

    /**
     * Set the active panel.
     * 
     * Valid values are 'list' and 'detail'. Anything else is rejected.
     * 
     * @param {string} tab - 'list' or 'detail'
     * @returns {boolean} True if the tab was accepted
     */
    function setActiveTab(tab) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (VALID_ACTIVE_TABS.indexOf(tab) === -1) {
            return false;
        }
        if (tab !== _state.activeTab) {
            _state.activeTab = tab;
            saveState();
        }
        return true;
    }

    /**
     * Show a specific tournament's detail panel.
     * Sets both selectedTournamentId and activeTab in one call.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {boolean} True if accepted
     */
    function showTournamentDetail(tournamentId) {
        if (!tournamentId) {
            return false;
        }
        if (!_state) {
            _state = getDefaultState();
        }
        _state.selectedTournamentId = String(tournamentId);
        _state.activeTab = 'detail';
        saveState();
        return true;
    }

    /**
     * Return from the detail panel to the list panel.
     * Clears the selected tournament ID and sets activeTab to 'list'.
     * Preserves viewMode, filters, sort, and pagination.
     */
    function showTournamentList() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.selectedTournamentId = null;
        _state.activeTab = 'list';
        saveState();
    }

    // ============================================================
    // NAVIGATION - viewMode (list panel layout)
    // ============================================================

    /**
     * Get the list panel layout mode.
     * 
     * @returns {string} 'list' or 'grid'
     */
    function getViewMode() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.viewMode || 'list';
    }

    /**
     * Set the list panel layout mode.
     * 
     * Valid values are 'list' and 'grid'. 'detail' is rejected here —
     * use setActiveTab('detail') or showTournamentDetail() instead.
     * 
     * @param {string} mode - 'list' or 'grid'
     * @returns {boolean} True if the mode was accepted
     */
    function setViewMode(mode) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (VALID_VIEW_MODES.indexOf(mode) === -1) {
            return false;
        }
        if (mode !== _state.viewMode) {
            _state.viewMode = mode;
            saveState();
        }
        return true;
    }

    /**
     * Toggle between list and grid view.
     * Only affects viewMode. Does NOT change activeTab.
     * 
     * @returns {string} The new view mode
     */
    function toggleViewMode() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.viewMode = _state.viewMode === 'list' ? 'grid' : 'list';
        saveState();
        return _state.viewMode;
    }

    // ============================================================
    // FILTERS
    // ============================================================

    function getFilter(key) {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.filters[key];
    }

    function getFilters() {
        if (!_state) {
            _state = getDefaultState();
        }
        return Object.assign({}, _state.filters);
    }

    function setFilter(key, value) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (_state.filters[key] !== value) {
            _state.filters[key] = value;
            saveState();
        }
    }

    function updateFilters(updates) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (!updates || typeof updates !== 'object') {
            return;
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

    function resetFilters() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.filters = JSON.parse(JSON.stringify(DEFAULT_STATE.filters));
        saveState();
    }

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

    function getExpandedTournamentId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedTournamentId;
    }

    function setExpandedTournamentId(tournamentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (tournamentId !== _state.expandedTournamentId) {
            _state.expandedTournamentId = tournamentId;
            saveState();
        }
    }

    function toggleExpandedTournament(tournamentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (_state.expandedTournamentId === tournamentId) {
            _state.expandedTournamentId = null;
            saveState();
            return false;
        }
        _state.expandedTournamentId = tournamentId;
        saveState();
        return true;
    }

    function isTournamentExpanded(tournamentId) {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedTournamentId === tournamentId;
    }

    function getExpandedRoundId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedRoundId;
    }

    function setExpandedRoundId(roundId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (roundId !== _state.expandedRoundId) {
            _state.expandedRoundId = roundId;
            saveState();
        }
    }

    function toggleExpandedRound(roundId) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (_state.expandedRoundId === roundId) {
            _state.expandedRoundId = null;
            saveState();
            return false;
        }
        _state.expandedRoundId = roundId;
        saveState();
        return true;
    }

    function getExpandedMatchId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.expandedMatchId;
    }

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

    function getModalState() {
        if (!_state) {
            _state = getDefaultState();
        }
        return Object.assign({}, _state.modal);
    }

    function setModalState(type, data) {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.modal.type = type || null;
        _state.modal.data = data || null;
        saveState();
    }

    function clearModalState() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.modal.type = null;
        _state.modal.data = null;
        saveState();
    }

    function isModalOpen() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.modal.type !== null;
    }

    function isModalType(type) {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.modal.type === type;
    }

    // ============================================================
    // SORTING
    // ============================================================

    function getSort() {
        if (!_state) {
            _state = getDefaultState();
        }
        return Object.assign({}, _state.sort);
    }

    function setSortField(field) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (_state.sort.field !== field) {
            _state.sort.field = field;
            saveState();
        }
    }

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

    function toggleSortDirection() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.sort.direction = _state.sort.direction === 'asc' ? 'desc' : 'asc';
        saveState();
    }

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

    function getPage() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.pagination.page || 1;
    }

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

    function getPerPage() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.pagination.perPage || 20;
    }

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
            _state.pagination.page = 1;
            saveState();
        }
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function isValidTab(tab) {
        return VALID_ACTIVE_TABS.indexOf(tab) !== -1;
    }

    function isValidViewMode(mode) {
        return VALID_VIEW_MODES.indexOf(mode) !== -1;
    }

    function isValidFilterKey(key) {
        return key === 'status' || key === 'search' || key === 'mode' || key === 'classId';
    }

    function isValidStatusFilter(status) {
        return status === 'all' || status === 'active' || status === 'completed' || status === 'draft';
    }

    function isValidModeFilter(mode) {
        return mode === 'all' || mode === 'teams' || mode === 'individuals';
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    init();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsUI = {
        // Lifecycle
        init: init,
        getState: getState,
        setState: setState,
        updateState: updateState,
        resetState: resetState,

        // Navigation - panel
        getSelectedTournamentId: getSelectedTournamentId,
        setSelectedTournamentId: setSelectedTournamentId,
        clearSelectedTournament: clearSelectedTournament,
        getActiveTab: getActiveTab,
        setActiveTab: setActiveTab,
        showTournamentDetail: showTournamentDetail,
        showTournamentList: showTournamentList,

        // Navigation - layout
        getViewMode: getViewMode,
        setViewMode: setViewMode,
        toggleViewMode: toggleViewMode,

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

        // Constants (read-only)
        DEFAULT_STATE: DEFAULT_STATE,
        VALID_ACTIVE_TABS: VALID_ACTIVE_TABS,
        VALID_VIEW_MODES: VALID_VIEW_MODES
    };

})();