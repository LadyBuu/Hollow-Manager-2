/**
 * modules/teams/team-ui.js - Team UI State
 * Transient UI state for the Team module.
 *
 * Path: js/modules/teams/team-ui.js
 *
 * This module is the SINGLE SOURCE OF TRUTH for Team UI state:
 *   - Which tab is selected (professional | temporary | civilian)
 *   - Which team is expanded in the list
 *   - Per-tab filter values (year, status)
 *
 * IMPORTANT:
 *   - UI state only. No domain data. No mutations. No domain reads.
 *   - Persistence is sessionStorage only. UI state is deliberately
 *     ephemeral; anything that must survive a page reload belongs
 *     in window.data, not here.
 *   - Every setter is typed and validates its input. There are no
 *     generic escape hatches for setting arbitrary keys.
 *   - Returned state is a structural clone. A caller cannot mutate
 *     live state by holding the reference.
 *   - Modal context is NOT tracked here. The team or member a modal
 *     is acting on lives on the modal's own DOM (dataset attributes,
 *     form arguments). There is no cross-render modal state.
 *
 * STORAGE VERSION:
 *   The key is versioned ('team_ui_state_v1'). A version bump
 *   abandons the previous state entirely; there is no migration
 *   between versions. This is deliberate — UI state is a cache,
 *   and caching stale shape across a code change produces bugs
 *   that are harder to diagnose than losing a saved tab.
 *
 * TAB VOCABULARY:
 *   The valid tabs are:
 *     'professional' | 'temporary' | 'civilian'
 *
 *   'academic' is NOT a tab here. Academic teams are managed by the
 *   Academy module. TeamUI never sees them.
 *
 * FILTER SEMANTICS:
 *   Filters are per-tab. Each tab has its own filter object. Setting
 *   a filter on one tab does not affect another. The filter object
 *   for a tab is created on first access from the canonical defaults.
 *
 * DEPENDENCIES:
 *   None.
 *
 * USAGE:
 *   var UI = window.TeamUI;
 *   UI.getCurrentTab();
 *   UI.setCurrentTab('professional');
 *   UI.getFilter('professional');
 *   UI.setFilter('professional', 'filterYear', 2025);
 */

(function() {
    'use strict';

    if (window.__teamUILoaded) {
        return;
    }
    window.__teamUILoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var STORAGE_KEY = 'team_ui_state_v1';

    var VALID_TABS = ['professional', 'temporary', 'civilian'];
    var DEFAULT_TAB = 'professional';

    // ============================================================
    // DEFAULT STATE
    // ============================================================
    //
    // Frozen. Callers cannot mutate the template by holding a
    // reference. getDefaultState() returns a fresh structural clone.

    var DEFAULT_STATE = Object.freeze({
        currentTab: DEFAULT_TAB,
        expandedTeamId: null,

        filters: Object.freeze({
            professional: Object.freeze({
                filterYear: '',
                filterStatus: 'active'
            }),
            temporary: Object.freeze({
                filterYear: '',
                filterStatus: 'active'
            }),
            civilian: Object.freeze({
                filterStatus: 'active'
            })
        })
    });

    // Frozen. Same rationale as DEFAULT_STATE.
    var DEFAULT_FILTERS = Object.freeze({
        professional: Object.freeze({
            filterYear: '',
            filterStatus: 'active'
        }),
        temporary: Object.freeze({
            filterYear: '',
            filterStatus: 'active'
        }),
        civilian: Object.freeze({
            filterStatus: 'active'
        })
    });

    // ============================================================
    // HELPERS
    // ============================================================

    function clone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            // Cloning a plain state object cannot fail in practice.
            // If it does, return the empty default rather than a
            // possibly-aliased input.
            return {};
        }
    }

    function getDefaultState() {
        return clone(DEFAULT_STATE);
    }

    function getFilterDefaults(tab) {
        var defaults = DEFAULT_FILTERS[tab] || DEFAULT_FILTERS[DEFAULT_TAB];
        return clone(defaults);
    }

    // ============================================================
    // STORAGE
    // ============================================================

    function loadState() {
        try {
            var saved = sessionStorage.getItem(STORAGE_KEY);
            if (!saved) {
                return getDefaultState();
            }
            var parsed = JSON.parse(saved);
            if (!parsed || typeof parsed !== 'object') {
                return getDefaultState();
            }
            return mergeWithDefaults(parsed);
        } catch (e) {
            return getDefaultState();
        }
    }

    /**
     * Merge persisted state with defaults.
     *
     * Unknown fields are dropped. Invalid values fall back to the
     * default. This is what makes a future schema change safe: a
     * stale value is rejected instead of being carried forward.
     */
    function mergeWithDefaults(parsed) {
        var merged = getDefaultState();

        if (typeof parsed.currentTab === 'string' &&
            VALID_TABS.indexOf(parsed.currentTab) !== -1) {
            merged.currentTab = parsed.currentTab;
        }

        if (typeof parsed.expandedTeamId === 'string' &&
            parsed.expandedTeamId !== '') {
            merged.expandedTeamId = parsed.expandedTeamId;
        }

        if (parsed.filters && typeof parsed.filters === 'object') {
            for (var t = 0; t < VALID_TABS.length; t++) {
                var tab = VALID_TABS[t];
                var saved = parsed.filters[tab];
                if (!saved || typeof saved !== 'object') {
                    continue;
                }
                var defaults = DEFAULT_FILTERS[tab] || {};
                var keys = Object.keys(defaults);
                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    if (Object.prototype.hasOwnProperty.call(saved, key)) {
                        merged.filters[tab][key] = saved[key];
                    }
                }
            }
        }

        return merged;
    }

    function saveState() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
        } catch (e) {
            // Storage full or unavailable. UI state is disposable.
        }
    }

    // ============================================================
    // LIVE STATE
    // ============================================================
    //
    // Initialized at declaration. There is no separate init step;
    // the state is ready the moment this module loads.
    //
    // init() remains exported for callers that expect a lifecycle
    // hook. It reloads from storage.

    var _state = loadState();

    // ============================================================
    // LIFECYCLE
    // ============================================================

    /**
     * Reload state from storage. Idempotent.
     */
    function init() {
        _state = loadState();
    }

    function resetState() {
        _state = getDefaultState();
        saveState();
    }

    // ============================================================
    // STATE SNAPSHOT
    // ============================================================

    /**
     * Get a structural clone of the entire UI state.
     *
     * The clone means a caller cannot mutate live state through
     * the returned object.
     */
    function getState() {
        return clone(_state);
    }

    // ============================================================
    // TAB
    // ============================================================

    function isValidTab(tab) {
        return typeof tab === 'string' && VALID_TABS.indexOf(tab) !== -1;
    }

    function getValidTab(tab) {
        return isValidTab(tab) ? tab : DEFAULT_TAB;
    }

    function getCurrentTab() {
        return _state.currentTab;
    }

    /**
     * Set the current tab.
     *
     * Rejects invalid tabs rather than storing them. A typo in a
     * caller would otherwise persist and surface as an empty list
     * on the next render, which is harder to diagnose than a
     * rejected setter.
     *
     * @param {string} tab
     * @returns {boolean} true when the value was accepted
     */
    function setCurrentTab(tab) {
        if (!isValidTab(tab)) {
            return false;
        }
        if (tab === _state.currentTab) {
            return true;
        }
        _state.currentTab = tab;
        saveState();
        return true;
    }

    function getValidTabs() {
        return VALID_TABS.slice();
    }

    // ============================================================
    // EXPANDED TEAM
    // ============================================================

    function getExpandedTeamId() {
        return _state.expandedTeamId;
    }

    function setExpandedTeamId(teamId) {
        var next = (typeof teamId === 'string' && teamId !== '')
            ? teamId
            : null;
        if (next === _state.expandedTeamId) {
            return;
        }
        _state.expandedTeamId = next;
        saveState();
    }

    /**
     * Toggle the expanded state of a team.
     * Returns the state AFTER the toggle.
     */
    function toggleExpandedTeam(teamId) {
        if (typeof teamId !== 'string' || teamId === '') {
            return false;
        }
        if (_state.expandedTeamId === teamId) {
            _state.expandedTeamId = null;
            saveState();
            return false;
        }
        _state.expandedTeamId = teamId;
        saveState();
        return true;
    }

    function isTeamExpanded(teamId) {
        if (typeof teamId !== 'string' || teamId === '') {
            return false;
        }
        return _state.expandedTeamId === teamId;
    }

    // ============================================================
    // FILTERS
    // ============================================================

    /**
     * Get the default filter object for a tab.
     * Returns a fresh copy. Mutating the return value does not
     * affect the template.
     */
    function getDefaultFilter(tab) {
        return getFilterDefaults(tab);
    }

    /**
     * Get a tab's current filter as a shallow copy.
     *
     * Filter values are primitives (number, string, boolean), so a
     * shallow copy is a full isolation guarantee.
     */
    function getFilter(tab) {
        var filters = _state.filters[tab];
        if (!filters) {
            return getFilterDefaults(tab);
        }
        return Object.assign({}, filters);
    }

    /**
     * Set one filter key on a tab.
     *
     * The tab must be valid; the key must already exist on the
     * tab's default filter. Setting an unknown key is rejected.
     * This is what keeps the filter shape canonical.
     */
    function setFilter(tab, key, value) {
        if (!isValidTab(tab)) {
            return false;
        }
        var defaults = DEFAULT_FILTERS[tab];
        if (!defaults ||
            !Object.prototype.hasOwnProperty.call(defaults, key)) {
            return false;
        }
        if (!_state.filters[tab]) {
            _state.filters[tab] = getFilterDefaults(tab);
        }
        if (_state.filters[tab][key] === value) {
            return true;
        }
        _state.filters[tab][key] = value;
        saveState();
        return true;
    }

    /**
     * Update multiple filter keys on a tab atomically.
     *
     * Any invalid key rejects the entire call; no key is updated.
     * This mirrors AcademyUI.setPeopleFilter's contract.
     */
    function updateFilter(tab, updates) {
        if (!isValidTab(tab)) {
            return false;
        }
        if (!updates || typeof updates !== 'object') {
            return false;
        }

        var defaults = DEFAULT_FILTERS[tab];
        if (!defaults) {
            return false;
        }

        var keys = Object.keys(updates);
        for (var i = 0; i < keys.length; i++) {
            if (!Object.prototype.hasOwnProperty.call(defaults, keys[i])) {
                return false;
            }
        }

        if (!_state.filters[tab]) {
            _state.filters[tab] = getFilterDefaults(tab);
        }

        var changed = false;
        for (var j = 0; j < keys.length; j++) {
            var key = keys[j];
            if (_state.filters[tab][key] !== updates[key]) {
                _state.filters[tab][key] = updates[key];
                changed = true;
            }
        }

        if (changed) {
            saveState();
        }
        return true;
    }

    function resetFilter(tab) {
        if (!isValidTab(tab)) {
            return;
        }
        _state.filters[tab] = getFilterDefaults(tab);
        saveState();
    }

    function resetAllFilters() {
        for (var i = 0; i < VALID_TABS.length; i++) {
            var tab = VALID_TABS[i];
            _state.filters[tab] = getFilterDefaults(tab);
        }
        saveState();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamUI = Object.freeze({
        // Lifecycle
        init: init,
        resetState: resetState,
        getState: getState,

        // Tab
        getCurrentTab: getCurrentTab,
        setCurrentTab: setCurrentTab,
        getValidTabs: getValidTabs,
        isValidTab: isValidTab,
        getValidTab: getValidTab,

        // Expanded team
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

        // Read-only constants
        DEFAULT_STATE: DEFAULT_STATE,
        DEFAULT_FILTERS: DEFAULT_FILTERS
    });

})();