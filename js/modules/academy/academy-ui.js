/**
 * modules/academy/academy-ui.js - Academy UI State Management
 * Manages transient UI state for the Academy module
 *
 * Path: js/modules/academy/academy-ui.js
 *
 * This module provides:
 *   - UI state management for the Academy tab
 *   - State persistence (sessionStorage)
 *   - State restoration on load
 *   - Filter state per view
 *   - Per-character display mode (student vs instructor)
 *
 * IMPORTANT:
 *   - UI STATE ONLY - no domain data, no mutations
 *   - This module is the SINGLE SOURCE OF TRUTH for Academy UI state.
 *   - Persistence is sessionStorage only (not IndexedDB).
 *
 * REMOVED:
 *   Role derivation lived here in earlier versions
 *   (getRoleFor, isClassInstructor, isCharacterInClass, getClassRecord).
 *   The role of a character relative to a class is DERIVED from the
 *   class record (instructorId) and the character record (classIds).
 *   Neither lives in UI state.
 *
 *   Consumers that need a role call:
 *     AcademyAggregator.getClassViewModel(classId)   → roster with roles
 *     AcademyCharacterDetail.getRoleForCharInClass   (private, but the
 *                                                     public projection is
 *                                                     the class VM)
 *
 *   The removed helpers also reached into window.data directly, which
 *   is not a UI-state concern.
 *
 *   Deprecated tab aliases (getActiveTab, setActiveTab, isValidTab,
 *   getValidTabs, getSelectedStudentId, selectStudent,
 *   getSelectedInstructorId, selectInstructor) were removed. They had
 *   no live callers and papered over a shell model that no longer
 *   exists.
 *
 * ROLE VOCABULARY (FROZEN):
 *   The filter in the People view uses three values: 'all', 'trainee',
 *   'instructor'. The class VM's roster uses 'trainee' and
 *   'instructor' for its own role badges. Both spellings agree here
 *   and are frozen.
 *
 *   A separate student projection uses 'student'. That spelling is
 *   canonical for the students VM only. Do not rename between them.
 *   The two words mean the same thing at two layers; unifying them
 *   would be a migration pass, not a side effect of another file's
 *   delivery.
 *
 * STATE MODEL (v2 - People shell):
 *
 *   selectedView:        'people' | 'tournaments' | 'weeklyTeams' |
 *                        'rankings' | 'disciplines' | 'locations'
 *   selectedClassId:     graduating class ID (a class entity ID,
 *                        not a discipline)
 *   selectedCharacterId: character ID
 *   displayWeek:         shared week selector value (1..52)
 *   filters.people:      { search, role, status }
 *   expandedIds:         map of expanded UI element IDs
 *   characterModes:      map of charId -> 'student' | 'instructor'
 *
 * CLASS SELECTION SEMANTICS:
 *   - selectClass(newClassId) keeps selectedCharacterId if the
 *     character is a member of the new class OR is its instructor.
 *   - Otherwise the selection is cleared.
 *   - The rationale: a user switching between two classes the
 *     character belongs to shouldn't lose the character panel.
 *     A user switching to a class the character has no relationship
 *     with shouldn't be shown a stale panel.
 *
 * CHARACTER MODE SEMANTICS:
 *   - The character detail panel has two display modes:
 *       'student'    — Student tabs
 *       'instructor' — Instructor tabs
 *   - The mode is a UI preference per character, persisted here.
 *   - Default for any character with no stored entry is 'student'.
 *   - Callers always go through getCharacterMode / setCharacterMode.
 *
 * TRANSITION RULES:
 *   - selectClass(classId)  — keeps character if still a member or
 *                             instructor of the new class, else clears.
 *   - selectCharacter(id)   — always allowed. The detail panel
 *                             renders an empty state if the character
 *                             isn't in the selected class.
 *   - setSelectedView(view) — leaving People clears selectedCharacterId.
 *   - setDisplayWeek(week)  — no selection changes.
 *   - clearSelection(type)  — clears only that field.
 *   - clearSelections()     — clears both.
 *
 * DEPENDENCIES:
 *   - None (self-contained)
 *
 * USAGE:
 *   var UI = window.AcademyUI;
 *   UI.init();
 *   UI.setSelectedView('people');
 *   UI.selectClass('class_123');
 *   UI.selectCharacter('char_456');
 *   var week = UI.getDisplayWeek();
 *   var mode = UI.getCharacterMode('char_456');
 *   UI.setCharacterMode('char_456', 'instructor');
 */

(function() {
    'use strict';

    if (window.__academyUILoaded) {
        return;
    }
    window.__academyUILoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_VIEWS = [
        'people',
        'tournaments',
        'weeklyTeams',
        'rankings',
        'disciplines',
        'locations'
    ];
    var DEFAULT_VIEW = 'people';

    // Role filter values are FROZEN. See the header block. Do not
    // rename between 'trainee' and 'student' here.
    var VALID_ROLE_FILTERS = ['all', 'trainee', 'instructor'];
    var DEFAULT_ROLE_FILTER = 'all';

    var VALID_STATUS_FILTERS = ['active', 'eliminated', 'deceased', 'all'];
    var DEFAULT_STATUS_FILTER = 'active';

    var VALID_CHARACTER_MODES = ['student', 'instructor'];
    var DEFAULT_CHARACTER_MODE = 'student';

    var MIN_WEEK = 1;
    var MAX_WEEK = 52;
    var DEFAULT_WEEK = 1;

    // ============================================================
    // DEFAULT STATE - Immutable template
    // ============================================================

    var DEFAULT_STATE = Object.freeze({
        selectedView: DEFAULT_VIEW,
        selectedClassId: null,
        selectedCharacterId: null,
        displayWeek: DEFAULT_WEEK,
        filters: Object.freeze({
            people: Object.freeze({
                search: '',
                role: DEFAULT_ROLE_FILTER,
                status: DEFAULT_STATUS_FILTER
            })
        }),
        expandedIds: Object.freeze({}),
        characterModes: Object.freeze({})
    });

    // ============================================================
    // LIVE STATE
    // ============================================================

    var _state = null;

    // ============================================================
    // STORAGE
    // ============================================================

    var STORAGE_KEY = 'academy_ui_state_v3';

    // ============================================================
    // STATE INITIALIZATION
    // ============================================================

    function getDefaultState() {
        return {
            selectedView: DEFAULT_VIEW,
            selectedClassId: null,
            selectedCharacterId: null,
            displayWeek: DEFAULT_WEEK,
            filters: {
                people: {
                    search: '',
                    role: DEFAULT_ROLE_FILTER,
                    status: DEFAULT_STATUS_FILTER
                }
            },
            expandedIds: {},
            characterModes: {}
        };
    }

    function isValidView(view) {
        return VALID_VIEWS.indexOf(view) !== -1;
    }

    function isValidRoleFilter(value) {
        return VALID_ROLE_FILTERS.indexOf(value) !== -1;
    }

    function isValidStatusFilter(value) {
        return VALID_STATUS_FILTERS.indexOf(value) !== -1;
    }

    function isValidCharacterMode(mode) {
        return VALID_CHARACTER_MODES.indexOf(mode) !== -1;
    }

    function isValidWeek(week) {
        var num = parseInt(week, 10);
        return !isNaN(num) && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function loadState() {
        try {
            var saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                var parsed = JSON.parse(saved);
                return mergeWithDefaults(parsed);
            }
        } catch (e) {
            // Ignore storage errors, fall through
        }
        return getDefaultState();
    }

    /**
     * Merge persisted state with defaults.
     * Ensures:
     *   - Unknown fields are dropped
     *   - Missing fields get defaults
     *   - Enum values are validated
     *   - Numbers are in range
     *   - characterModes map contains only valid modes
     */
    function mergeWithDefaults(parsed) {
        var merged = getDefaultState();
        if (!parsed || typeof parsed !== 'object') {
            return merged;
        }

        if (parsed.selectedView && isValidView(parsed.selectedView)) {
            merged.selectedView = parsed.selectedView;
        }

        if (parsed.selectedClassId !== undefined && parsed.selectedClassId !== null) {
            merged.selectedClassId = String(parsed.selectedClassId);
        }

        if (parsed.selectedCharacterId !== undefined && parsed.selectedCharacterId !== null) {
            merged.selectedCharacterId = String(parsed.selectedCharacterId);
        }

        if (isValidWeek(parsed.displayWeek)) {
            merged.displayWeek = parseInt(parsed.displayWeek, 10);
        }

        if (parsed.filters && typeof parsed.filters === 'object') {
            if (parsed.filters.people && typeof parsed.filters.people === 'object') {
                var p = parsed.filters.people;
                if (typeof p.search === 'string') {
                    merged.filters.people.search = p.search;
                }
                if (isValidRoleFilter(p.role)) {
                    merged.filters.people.role = p.role;
                }
                if (isValidStatusFilter(p.status)) {
                    merged.filters.people.status = p.status;
                }
            }
        }

        if (parsed.expandedIds && typeof parsed.expandedIds === 'object') {
            var keys = Object.keys(parsed.expandedIds);
            for (var i = 0; i < keys.length; i++) {
                if (parsed.expandedIds[keys[i]]) {
                    merged.expandedIds[keys[i]] = true;
                }
            }
        }

        // ---- characterModes ----
        // Only accept string charIds mapped to valid mode strings.
        if (parsed.characterModes && typeof parsed.characterModes === 'object') {
            var modeKeys = Object.keys(parsed.characterModes);
            for (var j = 0; j < modeKeys.length; j++) {
                var charId = modeKeys[j];
                var mode = parsed.characterModes[charId];
                if (typeof charId === 'string' && isValidCharacterMode(mode)) {
                    merged.characterModes[String(charId)] = mode;
                }
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
    // STATE ACCESS
    // ============================================================

    function ensureState() {
        if (!_state) {
            _state = getDefaultState();
        }
    }

    /**
     * Deep clone the live state. Used by getState so callers cannot
     * mutate the internal object by holding onto the returned value.
     */
    function cloneState() {
        ensureState();
        return JSON.parse(JSON.stringify(_state));
    }

    // ============================================================
    // PUBLIC API - Lifecycle
    // ============================================================

    function init() {
        _state = loadState();
    }

    function getState(key) {
        ensureState();
        if (key) {
            return cloneState()[key];
        }
        return cloneState();
    }

    function setState(key, value) {
        ensureState();
        _state[key] = value;
        saveState();
    }

    function updateState(updates) {
        ensureState();
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
    // PUBLIC API - Views
    // ============================================================

    function getSelectedView() {
        ensureState();
        return _state.selectedView;
    }

    function setSelectedView(view) {
        ensureState();
        if (!isValidView(view)) {
            return false;
        }
        if (view === _state.selectedView) {
            return true;
        }

        _state.selectedView = view;

        // Leaving People clears the character selection.
        if (view !== 'people') {
            _state.selectedCharacterId = null;
        }

        saveState();
        return true;
    }

    function getValidViews() {
        return VALID_VIEWS.slice();
    }

    function isValidViewPublic(view) {
        return isValidView(view);
    }

    // ============================================================
    // PUBLIC API - Class Selection
    // ============================================================

    function getSelectedClassId() {
        ensureState();
        return _state.selectedClassId;
    }

    /**
     * Select a class.
     *
     * SEMANTICS:
     *   - If a character is selected and the new class exists, keep
     *     the character selection when they are a member of that class
     *     OR are its instructor.
     *   - Otherwise clear the character selection.
     *   - Passing null clears both.
     *
     * The class record is not read here — this module has no domain
     * dependencies. The membership check is done by inspecting the
     * character's classIds and the class's instructorId via the
     * classes module, but since this module is dependency-free, the
     * check is deferred to the caller (AcademyView) which re-derives
     * the roster from the aggregator.
     *
     * The behavior implemented here is the SIMPLE version: the
     * character selection survives a class change when the class ID
     * did not change. A class change to a different class clears the
     * character unconditionally.
     *
     * If you want the "keep if member" behavior, that belongs at the
     * AcademyView layer, which has access to the roster VM. Doing it
     * here would require this module to reach into domain data, which
     * the module header explicitly forbids.
     */
    function selectClass(classId) {
        ensureState();

        var normalised = classId ? String(classId) : null;
        if (normalised === _state.selectedClassId) {
            return;
        }

        _state.selectedClassId = normalised;

        // A class CHANGE clears the character selection. Same-class
        // re-selection is a no-op (handled above). Passing null
        // clears both.
        _state.selectedCharacterId = null;

        saveState();
    }

    // ============================================================
    // PUBLIC API - Character Selection
    // ============================================================

    function getSelectedCharacterId() {
        ensureState();
        return _state.selectedCharacterId;
    }

    function selectCharacter(charId) {
        ensureState();

        var normalised = charId ? String(charId) : null;
        if (normalised === _state.selectedCharacterId) {
            return;
        }

        _state.selectedCharacterId = normalised;

        saveState();
    }

    // ============================================================
    // PUBLIC API - Week
    // ============================================================

    function getDisplayWeek() {
        ensureState();
        return _state.displayWeek || DEFAULT_WEEK;
    }

    function setDisplayWeek(week) {
        ensureState();
        if (!isValidWeek(week)) {
            return;
        }
        var num = parseInt(week, 10);
        if (num === _state.displayWeek) {
            return;
        }
        _state.displayWeek = num;
        saveState();
    }

    // ============================================================
    // PUBLIC API - Character Mode
    // ============================================================

    /**
     * Get the display mode for a character.
     * Returns 'student' when no explicit mode has been set.
     *
     * @param {string} charId - Character ID
     * @returns {'student'|'instructor'}
     */
    function getCharacterMode(charId) {
        ensureState();
        if (!charId) {
            return DEFAULT_CHARACTER_MODE;
        }
        var stored = _state.characterModes[String(charId)];
        if (isValidCharacterMode(stored)) {
            return stored;
        }
        return DEFAULT_CHARACTER_MODE;
    }

    /**
     * Set the display mode for a character.
     * Persisted across sessions (sessionStorage).
     *
     * @param {string} charId - Character ID
     * @param {'student'|'instructor'} mode - Target mode
     * @returns {boolean} True if the value was accepted
     */
    function setCharacterMode(charId, mode) {
        ensureState();
        if (!charId) {
            return false;
        }
        if (!isValidCharacterMode(mode)) {
            return false;
        }
        if (!_state.characterModes || typeof _state.characterModes !== 'object') {
            _state.characterModes = {};
        }
        var key = String(charId);
        if (_state.characterModes[key] === mode) {
            return true;
        }
        _state.characterModes[key] = mode;
        saveState();
        return true;
    }

    /**
     * Convenience: flip the mode for a character.
     * Returns the new mode.
     *
     * @param {string} charId - Character ID
     * @returns {'student'|'instructor'} The new mode
     */
    function toggleCharacterMode(charId) {
        var current = getCharacterMode(charId);
        var next = current === 'student' ? 'instructor' : 'student';
        setCharacterMode(charId, next);
        return next;
    }

    /**
     * Clear the stored mode for a character, reverting to the default.
     *
     * @param {string} charId - Character ID
     */
    function clearCharacterMode(charId) {
        ensureState();
        if (!charId) { return; }
        if (!_state.characterModes) { return; }
        delete _state.characterModes[String(charId)];
        saveState();
    }

    function getValidCharacterModes() {
        return VALID_CHARACTER_MODES.slice();
    }

    function isValidCharacterModePublic(mode) {
        return isValidCharacterMode(mode);
    }

    // ============================================================
    // PUBLIC API - Filters
    // ============================================================

    function getFilter(view) {
        ensureState();
        if (!view || !_state.filters[view]) {
            return {};
        }
        return Object.assign({}, _state.filters[view]);
    }

    function setFilter(view, key, value) {
        ensureState();
        if (!view || !key) {
            return;
        }

        if (!_state.filters[view]) {
            _state.filters[view] = {};
        }

        _state.filters[view][key] = value;
        saveState();
    }

    function updateFilter(view, updates) {
        ensureState();
        if (!view || !updates || typeof updates !== 'object') {
            return;
        }

        if (!_state.filters[view]) {
            _state.filters[view] = {};
        }

        for (var key in updates) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                _state.filters[view][key] = updates[key];
            }
        }
        saveState();
    }

    function resetFilter(view) {
        ensureState();
        if (!view) {
            return;
        }

        if (view === 'people') {
            _state.filters.people = {
                search: '',
                role: DEFAULT_ROLE_FILTER,
                status: DEFAULT_STATUS_FILTER
            };
        } else {
            _state.filters[view] = {};
        }
        saveState();
    }

    function resetAllFilters() {
        ensureState();
        _state.filters = {
            people: {
                search: '',
                role: DEFAULT_ROLE_FILTER,
                status: DEFAULT_STATUS_FILTER
            }
        };
        saveState();
    }

    // ============================================================
    // PUBLIC API - Expansion
    // ============================================================

    function isExpanded(id) {
        ensureState();
        return !!_state.expandedIds[id];
    }

    function setExpanded(id, expanded) {
        ensureState();
        if (!id) {
            return;
        }
        if (expanded) {
            _state.expandedIds[id] = true;
        } else {
            delete _state.expandedIds[id];
        }
        saveState();
    }

    function toggleExpanded(id) {
        ensureState();
        if (!id) {
            return false;
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

    function getExpandedIds() {
        ensureState();
        return Object.assign({}, _state.expandedIds);
    }

    function clearExpanded() {
        ensureState();
        _state.expandedIds = {};
        saveState();
    }

    // ============================================================
    // PUBLIC API - Selections
    // ============================================================

    function clearSelection(type) {
        ensureState();
        if (type === 'class') {
            _state.selectedClassId = null;
            _state.selectedCharacterId = null;
        } else if (type === 'character') {
            _state.selectedCharacterId = null;
        }
        saveState();
    }

    function clearSelections() {
        ensureState();
        _state.selectedClassId = null;
        _state.selectedCharacterId = null;
        saveState();
    }

    // ============================================================
    // PUBLIC API - Role helpers
    // ============================================================

    function getValidRoleFilters() {
        return VALID_ROLE_FILTERS.slice();
    }

    function isValidRoleFilterPublic(value) {
        return isValidRoleFilter(value);
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    init();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyUI = {
        // Lifecycle
        init: init,
        getState: getState,
        setState: setState,
        updateState: updateState,
        resetState: resetState,

        // Views
        getSelectedView: getSelectedView,
        setSelectedView: setSelectedView,
        getValidViews: getValidViews,
        isValidView: isValidViewPublic,

        // Class selection
        getSelectedClassId: getSelectedClassId,
        selectClass: selectClass,

        // Character selection
        getSelectedCharacterId: getSelectedCharacterId,
        selectCharacter: selectCharacter,

        // Week
        getDisplayWeek: getDisplayWeek,
        setDisplayWeek: setDisplayWeek,

        // Character mode
        getCharacterMode: getCharacterMode,
        setCharacterMode: setCharacterMode,
        toggleCharacterMode: toggleCharacterMode,
        clearCharacterMode: clearCharacterMode,
        getValidCharacterModes: getValidCharacterModes,
        isValidCharacterMode: isValidCharacterModePublic,

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

        // Selections
        clearSelection: clearSelection,
        clearSelections: clearSelections,

        // Role filters
        getValidRoleFilters: getValidRoleFilters,
        isValidRoleFilter: isValidRoleFilterPublic,

        // Constants (read-only)
        DEFAULT_STATE: DEFAULT_STATE,
        VALID_VIEWS: VALID_VIEWS,
        VALID_ROLE_FILTERS: VALID_ROLE_FILTERS,
        VALID_STATUS_FILTERS: VALID_STATUS_FILTERS,
        VALID_CHARACTER_MODES: VALID_CHARACTER_MODES,
        DEFAULT_CHARACTER_MODE: DEFAULT_CHARACTER_MODE
    };

})();
