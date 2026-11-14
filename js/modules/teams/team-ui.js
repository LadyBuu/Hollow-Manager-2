/**
 * modules/teams/team-ui.js - Team UI State
 * Transient UI state for the Team module.
 *
 * Path: js/modules/teams/team-ui.js
 *
 * This module is the SINGLE SOURCE OF TRUTH for Team UI state:
 *   - Which tab is selected (professional | civilian)
 *   - Which team is expanded in the list
 *   - Per-tab filter values (year, showInactive, sort,
 *     sortDirection, specialisationIds)
 *
 * IMPORTANT:
 *   - UI state only. No domain data. No mutations. No domain reads.
 *   - Persistence is sessionStorage only. UI state is deliberately
 *     ephemeral; anything that must survive a page reload belongs
 *     in window.data, not here.
 *   - Every setter is typed and validates BOTH its key AND its
 *     value. There are no generic escape hatches for setting
 *     arbitrary keys.
 *   - Returned state is a structural clone. A caller cannot mutate
 *     live state by holding the reference.
 *   - Modal context is NOT tracked here. The team or member a modal
 *     is acting on lives on the modal's own DOM (dataset attributes,
 *     form arguments). There is no cross-render modal state.
 *
 * STORAGE VERSION:
 *   The key is versioned ('team_ui_state_v3'). A version bump
 *   abandons the previous state entirely; there is no migration
 *   between versions. This is deliberate — UI state is a cache,
 *   and caching stale shape across a code change produces bugs
 *   that are harder to diagnose than losing a saved tab.
 *
 *   v1 -> v2: the 'temporary' tab was retired.
 *
 *   v2 -> v3: the Show Inactive filter changed shape. The v2
 *   filterStatus string ('active' | 'inactive') was replaced by
 *   a showInactive boolean.
 *
 *   THIS REVISION: no bump. The new filter keys (sort,
 *   sortDirection, specialisationIds) are additive. The
 *   merge-with-defaults path already drops unknown keys and fills
 *   missing keys from DEFAULT_STATE, so an existing v3 state from
 *   a live session simply picks up the new defaults on next load.
 *   Nothing old is abandoned; nothing old is reinterpreted.
 *
 * TAB VOCABULARY:
 *   The valid tabs are:
 *     'professional' | 'civilian'
 *
 *   'academic' is NOT a tab here. Academic teams are managed by the
 *   Academy module. TeamUI never sees them.
 *
 *   'temporary' was retired. The team type it labelled no longer
 *   exists in TeamConstants; records that carried it normalise to
 *   'professional'. There is nothing for a 'temporary' tab to show.
 *
 * FILTER SEMANTICS:
 *   Filters are per-tab. Each tab has its own filter object. Setting
 *   a filter on one tab does not affect another. The filter object
 *   for a tab is created on first access from the canonical defaults.
 *
 *   'filterYear':       '' (no year filter) or a positive integer.
 *   'showInactive':     false (only active) or true (active + inactive).
 *                       Maps to the query status 'active' or
 *                       'operational' respectively. Never 'inactive':
 *                       "show inactive" means "also include", not
 *                       "only show". The aggregator handles the
 *                       mapping.
 *   'sort':             'name' | 'period' | 'members'. Default
 *                       'name'.
 *   'sortDirection':    'asc' | 'desc'. Default 'asc'.
 *   'specialisationIds': array of mission-type ids. Empty array
 *                       means "no specialisation filter." A
 *                       non-empty array means "team matches if its
 *                       current specialisations contain AT LEAST
 *                       ONE of these ids." Multi-select, any-of.
 *
 * ARRAY-VALUED FILTERS:
 *   specialisationIds is the only array-valued filter today. The
 *   "did the value change" comparison in setFilter and
 *   updateFilter routes through filterValuesEqual(key, a, b),
 *   which compares arrays as SETS and everything else with ===.
 *   This exists because `a === b` on two arrays is always false,
 *   which would otherwise cause every setFilter call on
 *   specialisationIds to write to sessionStorage even when
 *   nothing changed.
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
 *   UI.setFilter('professional', 'showInactive', true);
 *   UI.setFilter('professional', 'sort', 'members');
 *   UI.setFilter('professional', 'sortDirection', 'desc');
 *   UI.setFilter('professional', 'specialisationIds',
 *                ['combat', 'recovery']);
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

    var STORAGE_KEY = 'team_ui_state_v3';

    // Old storage keys removed on load.
    var OLD_STORAGE_KEYS = [
        'team_ui_state_v1',
        'team_ui_state_v2'
    ];

    var VALID_TABS = ['professional', 'civilian'];
    var DEFAULT_TAB = 'professional';

    var VALID_SORTS = ['name', 'period', 'members'];
    var DEFAULT_SORT = 'name';

    var VALID_SORT_DIRECTIONS = ['asc', 'desc'];
    var DEFAULT_SORT_DIRECTION = 'asc';

    // ============================================================
    // DEFAULT STATE
    // ============================================================
    //
    // Frozen. Callers cannot mutate the template by holding a
    // reference. getDefaultState() returns a fresh structural clone.
    //
    // The professional filter gains three keys this revision:
    //   sort, sortDirection, specialisationIds
    // See the file header for their semantics.

    var DEFAULT_STATE = Object.freeze({
        currentTab: DEFAULT_TAB,
        expandedTeamId: null,

        filters: Object.freeze({
            professional: Object.freeze({
                filterYear: '',
                showInactive: false,
                sort: DEFAULT_SORT,
                sortDirection: DEFAULT_SORT_DIRECTION,
                specialisationIds: Object.freeze([])
            }),
            civilian: Object.freeze({
                showInactive: false
            })
        })
    });

    // DEFAULT_FILTERS is derived from DEFAULT_STATE so the two
    // cannot drift. Same shape, separate frozen reference for
    // callers who want a per-tab default without holding the
    // whole state template.
    var DEFAULT_FILTERS = Object.freeze({
        professional: DEFAULT_STATE.filters.professional,
        civilian: DEFAULT_STATE.filters.civilian
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
        var defaults = DEFAULT_FILTERS[tab];
        if (!defaults) {
            return {};
        }
        return clone(defaults);
    }

    /**
     * Is this a valid value for the named filter key on the tab?
     *
     * Every filter key has a type contract:
     *   filterYear:        '' or a positive integer
     *   showInactive:      boolean
     *   sort:              'name' | 'period' | 'members'
     *   sortDirection:     'asc' | 'desc'
     *   specialisationIds: array of non-empty strings
     *
     * Returns true when the value satisfies the key's contract.
     * Unknown keys are not validated here; the caller checks the
     * key exists against the tab's defaults first.
     */
    function isValidFilterValue(tab, key, value) {
        if (key === 'filterYear') {
            if (value === '') { return true; }
            if (typeof value === 'number' &&
                Number.isInteger(value) &&
                value >= 1) {
                return true;
            }
            if (typeof value === 'string' &&
                /^\d+$/.test(value.trim())) {
                var n = Number(value);
                return Number.isInteger(n) && n >= 1;
            }
            return false;
        }

        if (key === 'showInactive') {
            return typeof value === 'boolean';
        }

        if (key === 'sort') {
            return typeof value === 'string' &&
                VALID_SORTS.indexOf(value) !== -1;
        }

        if (key === 'sortDirection') {
            return typeof value === 'string' &&
                VALID_SORT_DIRECTIONS.indexOf(value) !== -1;
        }

        if (key === 'specialisationIds') {
            if (!Array.isArray(value)) { return false; }
            for (var i = 0; i < value.length; i++) {
                var entry = value[i];
                if (typeof entry !== 'string') { return false; }
                if (entry.trim() === '') { return false; }
            }
            return true;
        }

        // Unknown key: caller already rejected it.
        return false;
    }

    /**
     * Are two filter values for the same key equal?
     *
     * Arrays are compared as SETS (order-insensitive, dedup-
     * insensitive on the value side). Everything else uses ===.
     *
     * This exists because `a === b` on two arrays is always false,
     * which would otherwise cause every setFilter call on
     * specialisationIds to write to sessionStorage even when the
     * caller passed the same values in a different order, or a
     * caller that already had the same values built a new array.
     *
     * The set-comparison assumes array entries are unique after
     * normalisation. setFilter's writer normalises before storing,
     * so this holds for the values that reach the comparison.
     */
    function filterValuesEqual(key, a, b) {
        if (key === 'specialisationIds') {
            if (!Array.isArray(a) || !Array.isArray(b)) {
                return a === b;
            }
            if (a.length !== b.length) { return false; }
            var set = Object.create(null);
            for (var i = 0; i < a.length; i++) {
                set[String(a[i])] = true;
            }
            for (var j = 0; j < b.length; j++) {
                if (set[String(b[j])] !== true) { return false; }
            }
            return true;
        }
        return a === b;
    }

    /**
     * Normalise a filter value for storage. Currently only
     * specialisationIds needs it: it is deduped and trimmed.
     * Every other key is stored as-is (validation already
     * guaranteed its shape).
     */
    function normaliseFilterValueForStorage(key, value) {
        if (key === 'specialisationIds') {
            var seen = Object.create(null);
            var out = [];
            for (var i = 0; i < value.length; i++) {
                var s = String(value[i]).trim();
                if (s === '') { continue; }
                if (seen[s]) { continue; }
                seen[s] = true;
                out.push(s);
            }
            return out;
        }
        return value;
    }

    // ============================================================
    // STORAGE
    // ============================================================

    /**
     * Remove old storage keys from prior versions of this module.
     * Idempotent; safe to call on every load.
     */
    function removeOldStorageKeys() {
        try {
            for (var i = 0; i < OLD_STORAGE_KEYS.length; i++) {
                sessionStorage.removeItem(OLD_STORAGE_KEYS[i]);
            }
        } catch (e) {
            // sessionStorage unavailable; nothing to clean.
        }
    }

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
     * Unknown fields are dropped. Invalid KEYS are ignored.
     * Invalid VALUES are rejected and replaced by the default.
     * This is what makes a future schema change safe: a stale or
     * tampered value cannot leak into live state.
     *
     * New keys added this revision (sort, sortDirection,
     * specialisationIds) will be missing from an older stored
     * state. The merge starts from defaults, so they land on
     * their defaults; there is nothing to migrate.
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
                var defaults = DEFAULT_FILTERS[tab];
                if (!defaults) { continue; }
                var keys = Object.keys(defaults);
                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    if (!Object.prototype.hasOwnProperty.call(saved, key)) {
                        continue;
                    }
                    var savedValue = saved[key];
                    if (isValidFilterValue(tab, key, savedValue)) {
                        if (key === 'filterYear' &&
                            typeof savedValue === 'string') {
                            merged.filters[tab][key] =
                                String(savedValue);
                        } else if (key === 'specialisationIds') {
                            merged.filters[tab][key] =
                                normaliseFilterValueForStorage(
                                    key, savedValue
                                );
                        } else {
                            merged.filters[tab][key] = savedValue;
                        }
                    }
                    // Invalid values are silently dropped, replaced
                    // by the default that mergeWithDefaults began
                    // with. The sessionStorage cache is treated as
                    // untrusted input.
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

    removeOldStorageKeys();

    var _state = loadState();

    // ============================================================
    // LIFECYCLE
    // ============================================================

    /**
     * Reload state from storage.
     *
     * If the in-memory state has pending changes that were not
     * written to storage (a saveData failure, or a sessionStorage
     * quota error), init() would silently discard them by reloading
     * the older persisted state. To preserve in-memory work, init()
     * compares the serialized live state against the serialized
     * stored state and only reloads when they agree. A live state
     * that differs from storage is kept, and the stored state is
     * brought up to date via saveState().
     */
    function init() {
        var liveSerialized;
        try {
            liveSerialized = JSON.stringify(_state);
        } catch (e) {
            liveSerialized = null;
        }

        var storedSerialized;
        try {
            storedSerialized =
                sessionStorage.getItem(STORAGE_KEY);
        } catch (e) {
            storedSerialized = null;
        }

        if (liveSerialized !== null &&
            storedSerialized !== null &&
            liveSerialized !== storedSerialized) {
            // In-memory changes have not persisted. Keep them and
            // rewrite storage.
            saveState();
            return;
        }

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
     * A caller that still passes 'temporary' is rejected. The type
     * no longer exists; there is nothing to show.
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

    /**
     * Set the currently expanded team.
     *
     * Accepts string ids, null, and ''. A numeric id is coerced to
     * its string form with a warning: team ids are strings today,
     * and silently dropping a number would make the setter look
     * successful when it was not. Any other type is rejected.
     *
     * @param {string|null|number} teamId
     * @returns {boolean} true when the value was accepted
     */
    function setExpandedTeamId(teamId) {
        var next;

        if (teamId === null || teamId === undefined || teamId === '') {
            next = null;
        } else if (typeof teamId === 'string') {
            next = teamId;
        } else if (typeof teamId === 'number' &&
                   Number.isInteger(teamId) &&
                   teamId >= 1) {
            console.warn(
                '[TeamUI] setExpandedTeamId received a numeric id (' +
                teamId + '). Team ids are strings; coercing. ' +
                'Fix the caller.'
            );
            next = String(teamId);
        } else {
            console.warn(
                '[TeamUI] setExpandedTeamId received an invalid ' +
                'value of type ' + typeof teamId + '. Ignored.'
            );
            return false;
        }

        if (next === _state.expandedTeamId) {
            return true;
        }
        _state.expandedTeamId = next;
        saveState();
        return true;
    }

    /**
     * Toggle the expanded state of a team.
     * Returns the state AFTER the toggle.
     *
     * Delegates to setExpandedTeamId so the coercion and
     * validation rules are single-sourced.
     */
    function toggleExpandedTeam(teamId) {
        if (typeof teamId !== 'string' || teamId === '') {
            return false;
        }
        if (_state.expandedTeamId === teamId) {
            setExpandedTeamId(null);
            return false;
        }
        setExpandedTeamId(teamId);
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
     *
     * An invalid tab returns {} rather than falling back to the
     * default tab's filter. A caller with a typo should receive
     * nothing; silently returning another tab's defaults would
     * hide the bug.
     */
    function getDefaultFilter(tab) {
        if (!isValidTab(tab)) {
            return {};
        }
        return getFilterDefaults(tab);
    }

    /**
     * Get a tab's current filter as a copy.
     *
     * Every filter value is either a primitive or, for
     * specialisationIds, an array of strings. The copy is a deep
     * clone so a caller that mutates the returned array cannot
     * mutate live state.
     *
     * An invalid tab returns {} (see getDefaultFilter).
     */
    function getFilter(tab) {
        if (!isValidTab(tab)) {
            return {};
        }
        var filters = _state.filters[tab];
        if (!filters) {
            return getFilterDefaults(tab);
        }
        // Deep clone so specialisationIds is isolated too.
        return clone(filters);
    }

    /**
     * Set one filter key on a tab.
     *
     * The tab must be valid; the key must already exist on the
     * tab's default filter; the value must satisfy the key's type
     * contract. A failed check rejects the whole call — nothing
     * is written.
     *
     * The value is normalised for storage (deduped and trimmed
     * for array-typed keys). The "did it change" comparison is
     * value-aware for arrays (see filterValuesEqual).
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
        if (!isValidFilterValue(tab, key, value)) {
            return false;
        }
        if (!_state.filters[tab]) {
            _state.filters[tab] = getFilterDefaults(tab);
        }

        var normalised = normaliseFilterValueForStorage(key, value);

        if (filterValuesEqual(key, _state.filters[tab][key], normalised)) {
            return true;
        }
        _state.filters[tab][key] = normalised;
        saveState();
        return true;
    }

    /**
     * Update multiple filter keys on a tab atomically.
     *
     * Any invalid key OR invalid value rejects the entire call;
     * no key is updated. This mirrors AcademyUI.setPeopleFilter's
     * contract.
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
            if (!isValidFilterValue(tab, keys[i], updates[keys[i]])) {
                return false;
            }
        }

        if (!_state.filters[tab]) {
            _state.filters[tab] = getFilterDefaults(tab);
        }

        var changed = false;
        for (var j = 0; j < keys.length; j++) {
            var key = keys[j];
            var normalised = normaliseFilterValueForStorage(
                key, updates[key]
            );
            if (!filterValuesEqual(
                key, _state.filters[tab][key], normalised
            )) {
                _state.filters[tab][key] = normalised;
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

        // Sort vocabulary (for the renderer's <select>)
        getValidSorts: function() { return VALID_SORTS.slice(); },
        getValidSortDirections: function() {
            return VALID_SORT_DIRECTIONS.slice();
        },

        // Read-only constants
        DEFAULT_STATE: DEFAULT_STATE,
        DEFAULT_FILTERS: DEFAULT_FILTERS
    });

})();
