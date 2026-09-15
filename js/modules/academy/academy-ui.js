/**
 * modules/academy/academy-ui.js - Academy UI State Management
 * Manages transient UI state for the Academy module.
 *
 * Path: js/modules/academy/academy-ui.js
 *
 * This module is the SINGLE SOURCE OF TRUTH for Academy UI state:
 *   - Which view is selected
 *   - Which class and character are selected
 *   - Which week is displayed
 *   - Per-character display mode (student / instructor)
 *   - People filter state
 *   - Expanded element ids
 *
 * IMPORTANT:
 *   - UI STATE ONLY. No domain data. No mutations. No domain reads.
 *   - Persistence is sessionStorage only (not IndexedDB).
 *   - Every setter validates its own input. There are no generic
 *     escape hatches for setting arbitrary state keys.
 *   - The public API describes user intent, not internal shape:
 *       selectClass(), selectCharacter(), setDisplayWeek(),
 *       setCharacterMode(), setPeopleFilter(), ...
 *
 * REMOVED FROM PRIOR VERSIONS:
 *   - setState(key, value) and updateState(updates) — generic escape
 *     hatches that bypassed every invariant.
 *   - getFilter(view) / setFilter(view, key, value) / updateFilter —
 *     replaced by the People-specific filter API.
 *   - Public init() — the module initialises once on load. Callers
 *     that need a fresh state call resetState().
 *   - Role derivation helpers — UI state does not resolve domain roles.
 *   - 'trainee' role filter value — canonical role vocabulary is
 *     'student' | 'instructor'.
 *
 * ROLE VOCABULARY (CANONICAL):
 *   The People view filter uses three values:
 *     'all' | 'student' | 'instructor'
 *   The Academy class VM's roster carries the same 'student' or
 *   'instructor' spelling. There is no 'trainee' anywhere.
 *
 * CLASS SELECTION SEMANTICS:
 *   selectClass(classId) is a pure setter. It clears the selected
 *   character on every class change. Callers that want to preserve
 *   the character selection when the character is still a member of
 *   the newly selected class must restore it themselves after calling
 *   selectClass. This module has no opinion about class membership.
 *
 * WEEK SEMANTICS:
 *   setDisplayWeek accepts:
 *     - a plain number that is an integer in [MIN_WEEK, MAX_WEEK]
 *     - a string that is a pure digit sequence ("5", "42") whose
 *       numeric value is an integer in [MIN_WEEK, MAX_WEEK]
 *   It rejects:
 *     - floats ("5.5", 5.5)
 *     - strings with trailing characters ("12garbage", "12 ")
 *     - negative values, zero
 *     - NaN, Infinity
 *     - out-of-range values
 *   No silent coercion. The caller sees `false` for rejected input
 *   and can decide what to do (typically: leave the input element
 *   as-is so the user sees their mistake).
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants (MIN_WEEK, MAX_WEEK) — MANDATORY
 *
 * USAGE:
 *   AcademyUI.getSelectedView();
 *   AcademyUI.setSelectedView('people');
 *   AcademyUI.selectClass('class_123');
 *   AcademyUI.selectCharacter('char_456');
 *   AcademyUI.setDisplayWeek(5);
 *   AcademyUI.setCharacterMode('char_456', 'instructor');
 *   AcademyUI.getPeopleFilter();
 *   AcademyUI.setPeopleFilter({ role: 'student' });
 */

(function() {
    'use strict';

    if (window.__academyUILoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCY
    // ============================================================

    var CalendarConstants = window.CalendarConstants;

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        throw new Error(
            '[AcademyUI] Missing mandatory dependency: ' +
            'CalendarConstants.MIN_WEEK / MAX_WEEK'
        );
    }

    window.__academyUILoaded = true;

    // ============================================================
    // CONSTANTS - frozen
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var DEFAULT_WEEK = MIN_WEEK;

    var VALID_VIEWS = Object.freeze([
        'people',
        'tournaments',
        'weeklyTeams',
        'rankings',
        'disciplines',
        'locations'
    ]);
    var DEFAULT_VIEW = 'people';

    var VALID_ROLE_FILTERS = Object.freeze(['all', 'student', 'instructor']);
    var DEFAULT_ROLE_FILTER = 'all';

    var VALID_STATUS_FILTERS = Object.freeze(['active', 'eliminated', 'deceased', 'all']);
    var DEFAULT_STATUS_FILTER = 'active';

    var VALID_CHARACTER_MODES = Object.freeze(['student', 'instructor']);
    var DEFAULT_CHARACTER_MODE = 'student';

    // ============================================================
    // DEFAULT STATE
    // ============================================================
    //
    // Single canonical definition. _state is initialised from a
    // fresh clone of this template; resetState() also returns to it.
    //
    // The public DEFAULT_STATE export is a frozen clone of the same
    // template, so a caller cannot corrupt the template by mutating
    // the published copy.

    function createDefaultState() {
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

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

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

    /**
     * Strict integer parse for weeks.
     *
     * Accepts:
     *   - numbers that are integers in range
     *   - strings that are pure digit sequences whose numeric value is
     *     an integer in range
     *
     * Rejects everything else. There is no silent coercion of
     * "12garbage" to 12.
     *
     * @returns {number|null}
     */
    function parseWeekStrict(value) {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'number') {
            if (!Number.isInteger(value)) {
                return null;
            }
            if (value < MIN_WEEK || value > MAX_WEEK) {
                return null;
            }
            return value;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            if (!Number.isInteger(n)) {
                return null;
            }
            if (n < MIN_WEEK || n > MAX_WEEK) {
                return null;
            }
            return n;
        }

        return null;
    }

    /**
     * Normalise an ID-like value to a string or null.
     *
     * Rejects objects and arrays. Accepts strings and numbers.
     * Empty-string and whitespace-only strings become null.
     */
    function normaliseId(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        if (typeof value === 'object') {
            return null;
        }
        var str = String(value).trim();
        return str === '' ? null : str;
    }

    // ============================================================
    // STORAGE
    // ============================================================

    var STORAGE_KEY = 'academy_ui_state_v3';

    function loadState() {
        var defaults = createDefaultState();
        try {
            var saved = sessionStorage.getItem(STORAGE_KEY);
            if (!saved) {
                return defaults;
            }
            var parsed = JSON.parse(saved);
            if (!parsed || typeof parsed !== 'object') {
                return defaults;
            }
            return mergeWithDefaults(parsed, defaults);
        } catch (e) {
            return defaults;
        }
    }

    /**
     * Merge persisted state with defaults.
     *
     * Only known fields are accepted. Invalid values fall back to the
     * default. Unknown fields are dropped. This is what makes the
     * migration from 'trainee' to 'student' clean: session state
     * carrying role: 'trainee' is rejected and replaced with the
     * default.
     */
    function mergeWithDefaults(parsed, defaults) {
        var merged = defaults;

        if (parsed.selectedView && isValidView(parsed.selectedView)) {
            merged.selectedView = parsed.selectedView;
        }

        var classId = normaliseId(parsed.selectedClassId);
        if (classId !== null) {
            merged.selectedClassId = classId;
        }

        var charId = normaliseId(parsed.selectedCharacterId);
        if (charId !== null) {
            merged.selectedCharacterId = charId;
        }

        var week = parseWeekStrict(parsed.displayWeek);
        if (week !== null) {
            merged.displayWeek = week;
        }

        if (parsed.filters && typeof parsed.filters === 'object') {
            var p = parsed.filters.people;
            if (p && typeof p === 'object') {
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

        if (parsed.expandedIds &&
            typeof parsed.expandedIds === 'object' &&
            !Array.isArray(parsed.expandedIds)) {
            var keys = Object.keys(parsed.expandedIds);
            for (var i = 0; i < keys.length; i++) {
                if (parsed.expandedIds[keys[i]]) {
                    merged.expandedIds[keys[i]] = true;
                }
            }
        }

        if (parsed.characterModes &&
            typeof parsed.characterModes === 'object' &&
            !Array.isArray(parsed.characterModes)) {
            var modeKeys = Object.keys(parsed.characterModes);
            for (var j = 0; j < modeKeys.length; j++) {
                var id = modeKeys[j];
                var mode = parsed.characterModes[id];
                if (typeof id === 'string' && id !== '' && isValidCharacterMode(mode)) {
                    merged.characterModes[id] = mode;
                }
            }
        }

        return merged;
    }

    function saveState() {
        if (!_state) { return; }
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
        } catch (e) {
            // Storage full or unavailable — ignore.
        }
    }

    // ============================================================
    // LIVE STATE
    // ============================================================

    var _state = loadState();

    // ============================================================
    // LIFECYCLE
    // ============================================================

    /**
     * Reset to defaults.
     *
     * The only lifecycle mutator. Public because tests use it and
     * because callers occasionally want a hard reset (e.g. logout).
     * Not needed for normal operation; the module initialises on
     * load.
     */
    function resetState() {
        _state = createDefaultState();
        saveState();
    }

    /**
     * Get a deep clone of the entire state.
     *
     * Used by academy/index.js's public API. The clone means a caller
     * cannot mutate the live state by holding onto the returned
     * object.
     */
    function getState() {
        return {
            selectedView: _state.selectedView,
            selectedClassId: _state.selectedClassId,
            selectedCharacterId: _state.selectedCharacterId,
            displayWeek: _state.displayWeek,
            filters: {
                people: {
                    search: _state.filters.people.search,
                    role: _state.filters.people.role,
                    status: _state.filters.people.status
                }
            },
            expandedIds: Object.assign({}, _state.expandedIds),
            characterModes: Object.assign({}, _state.characterModes)
        };
    }

    // ============================================================
    // VIEWS
    // ============================================================

    function getSelectedView() {
        return _state.selectedView;
    }

    function setSelectedView(view) {
        if (!isValidView(view)) {
            return false;
        }
        if (view === _state.selectedView) {
            return true;
        }
        _state.selectedView = view;
        if (view !== 'people') {
            _state.selectedCharacterId = null;
        }
        saveState();
        return true;
    }

    function getValidViews() {
        return VALID_VIEWS.slice();
    }

    // ============================================================
    // CLASS SELECTION
    // ============================================================

    function getSelectedClassId() {
        return _state.selectedClassId;
    }

    /**
     * Select a class.
     *
     * Semantics:
     *   - Passing null or an empty value clears the selected class.
     *   - Any change of class clears the selected character. This
     *     module does not know which characters belong to which
     *     classes; restoring the character after a class change is
     *     the caller's responsibility (AcademyView reads the class VM
     *     and decides).
     */
    function selectClass(classId) {
        var normalised = normaliseId(classId);
        if (normalised === _state.selectedClassId) {
            return;
        }
        _state.selectedClassId = normalised;
        _state.selectedCharacterId = null;
        saveState();
    }

    // ============================================================
    // CHARACTER SELECTION
    // ============================================================

    function getSelectedCharacterId() {
        return _state.selectedCharacterId;
    }

    function selectCharacter(charId) {
        var normalised = normaliseId(charId);
        if (normalised === _state.selectedCharacterId) {
            return;
        }
        _state.selectedCharacterId = normalised;
        saveState();
    }

    // ============================================================
    // WEEK
    // ============================================================

    function getDisplayWeek() {
        return _state.displayWeek;
    }

    /**
     * Set the display week.
     *
     * @param {number|string} week - Integer in [MIN_WEEK, MAX_WEEK],
     *   or a pure digit string whose integer value is in range.
     * @returns {boolean} true if the value was accepted
     */
    function setDisplayWeek(week) {
        var n = parseWeekStrict(week);
        if (n === null) {
            return false;
        }
        if (n === _state.displayWeek) {
            return true;
        }
        _state.displayWeek = n;
        saveState();
        return true;
    }

    // ============================================================
    // CHARACTER MODE
    // ============================================================

    function getCharacterMode(charId) {
        var id = normaliseId(charId);
        if (id === null) {
            return DEFAULT_CHARACTER_MODE;
        }
        var stored = _state.characterModes[id];
        if (isValidCharacterMode(stored)) {
            return stored;
        }
        return DEFAULT_CHARACTER_MODE;
    }

    function setCharacterMode(charId, mode) {
        var id = normaliseId(charId);
        if (id === null) { return false; }
        if (!isValidCharacterMode(mode)) { return false; }
        if (_state.characterModes[id] === mode) {
            return true;
        }
        _state.characterModes[id] = mode;
        saveState();
        return true;
    }

    /**
     * Toggle the character's mode between 'student' and 'instructor'.
     * Returns the mode the character is in AFTER the toggle.
     */
    function toggleCharacterMode(charId) {
        var current = getCharacterMode(charId);
        var next = current === 'student' ? 'instructor' : 'student';
        var ok = setCharacterMode(charId, next);
        return ok ? next : current;
    }

    function clearCharacterMode(charId) {
        var id = normaliseId(charId);
        if (id === null) { return; }
        if (!Object.prototype.hasOwnProperty.call(_state.characterModes, id)) {
            return;
        }
        delete _state.characterModes[id];
        saveState();
    }

    function getValidCharacterModes() {
        return VALID_CHARACTER_MODES.slice();
    }

    // ============================================================
    // PEOPLE FILTER
    // ============================================================
    //
    // Typed API. No generic getFilter/setFilter escape hatches.

    function getPeopleFilter() {
        return {
            search: _state.filters.people.search,
            role: _state.filters.people.role,
            status: _state.filters.people.status
        };
    }

    /**
     * Set the entire People filter atomically.
     *
     * Partial updates are allowed: any field not present in `updates`
     * keeps its current value. Each present field must be valid, or
     * the whole call is rejected and no field is updated.
     *
     * @param {object} updates - { search?, role?, status? }
     * @returns {boolean} true if the update was accepted
     */
    function setPeopleFilter(updates) {
        if (!updates || typeof updates !== 'object') {
            return false;
        }

        var next = {
            search: _state.filters.people.search,
            role: _state.filters.people.role,
            status: _state.filters.people.status
        };

        if (updates.search !== undefined) {
            if (typeof updates.search !== 'string') { return false; }
            next.search = updates.search;
        }
        if (updates.role !== undefined) {
            if (!isValidRoleFilter(updates.role)) { return false; }
            next.role = updates.role;
        }
        if (updates.status !== undefined) {
            if (!isValidStatusFilter(updates.status)) { return false; }
            next.status = updates.status;
        }

        var unchanged =
            next.search === _state.filters.people.search &&
            next.role === _state.filters.people.role &&
            next.status === _state.filters.people.status;

        if (unchanged) {
            return true;
        }

        _state.filters.people = next;
        saveState();
        return true;
    }

    function setPeopleSearch(value) {
        return setPeopleFilter({ search: value });
    }

    function setPeopleRole(value) {
        return setPeopleFilter({ role: value });
    }

    function setPeopleStatus(value) {
        return setPeopleFilter({ status: value });
    }

    function resetPeopleFilter() {
        _state.filters.people = {
            search: '',
            role: DEFAULT_ROLE_FILTER,
            status: DEFAULT_STATUS_FILTER
        };
        saveState();
    }

    // ============================================================
    // EXPANSION
    // ============================================================

    function isExpanded(id) {
        if (!id) { return false; }
        return _state.expandedIds[id] === true;
    }

    function setExpanded(id, expanded) {
        if (!id) { return; }
        var key = String(id);
        var currentlyExpanded = _state.expandedIds[key] === true;
        var next = expanded === true;

        if (currentlyExpanded === next) { return; }

        if (next) {
            _state.expandedIds[key] = true;
        } else {
            delete _state.expandedIds[key];
        }
        saveState();
    }

    function toggleExpanded(id) {
        if (!id) { return false; }
        var key = String(id);
        var currentlyExpanded = _state.expandedIds[key] === true;
        if (currentlyExpanded) {
            delete _state.expandedIds[key];
        } else {
            _state.expandedIds[key] = true;
        }
        saveState();
        return !currentlyExpanded;
    }

    function getExpandedIds() {
        return Object.assign({}, _state.expandedIds);
    }

    function clearExpanded() {
        _state.expandedIds = {};
        saveState();
    }

    // ============================================================
    // SELECTIONS
    // ============================================================

    function clearSelection(type) {
        if (type === 'class') {
            _state.selectedClassId = null;
            _state.selectedCharacterId = null;
            saveState();
            return true;
        }
        if (type === 'character') {
            _state.selectedCharacterId = null;
            saveState();
            return true;
        }
        return false;
    }

    function clearSelections() {
        _state.selectedClassId = null;
        _state.selectedCharacterId = null;
        saveState();
    }

    // ============================================================
    // VALIDATION EXPORTS
    // ============================================================

    function isValidViewPublic(view) {
        return isValidView(view);
    }

    function isValidRoleFilterPublic(value) {
        return isValidRoleFilter(value);
    }

    function isValidCharacterModePublic(mode) {
        return isValidCharacterMode(mode);
    }

    function getValidRoleFilters() {
        return VALID_ROLE_FILTERS.slice();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Public DEFAULT_STATE is a frozen clone of the template.
    var DEFAULT_STATE_PUBLIC = Object.freeze(createDefaultState());

    window.AcademyUI = {
        // Lifecycle
        resetState: resetState,
        getState: getState,

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

        // People filter
        getPeopleFilter: getPeopleFilter,
        setPeopleFilter: setPeopleFilter,
        setPeopleSearch: setPeopleSearch,
        setPeopleRole: setPeopleRole,
        setPeopleStatus: setPeopleStatus,
        resetPeopleFilter: resetPeopleFilter,

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

        // Read-only constants
        VALID_VIEWS: VALID_VIEWS,
        VALID_ROLE_FILTERS: VALID_ROLE_FILTERS,
        VALID_STATUS_FILTERS: VALID_STATUS_FILTERS,
        VALID_CHARACTER_MODES: VALID_CHARACTER_MODES,
        DEFAULT_CHARACTER_MODE: DEFAULT_CHARACTER_MODE,
        DEFAULT_STATE: DEFAULT_STATE_PUBLIC
    };

})();
