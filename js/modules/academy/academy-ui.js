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
 *   - Per-character display mode (student / instructor) — READ ONLY,
 *     the value is a domain fact owned by CharacterCRUD.setMode
 *   - People filter state
 *   - Expanded element ids
 *   - Tournament round collapse state (C4)
 *
 * IMPORTANT:
 *   - UI STATE ONLY. No domain data. No mutations.
 *   - Persistence is sessionStorage only (not IndexedDB).
 *   - Every setter validates its own input. There are no generic
 *     escape hatches for setting arbitrary state keys.
 *   - The public API describes user intent, not internal shape:
 *       selectClass(), selectCharacter(), setDisplayWeek(),
 *       setPeopleFilter(), ...
 *
 * SELECTION LIFECYCLE:
 *   The three selections — view, class, character — interact:
 *
 *     view change       -> character may clear (non-People views do
 *                          not carry a character selection);
 *                          class remains
 *     class change      -> character clears unconditionally
 *     character change  -> no effect on view or class
 *
 *   A class selection survives a view change because every view
 *   that reads it (Weekly Teams, Rankings, Discipline Schedule
 *   tab, Locations, Exams) is class-scoped. Only the character
 *   selection is People-specific.
 *
 * CHARACTER MODE (v27+):
 *   The character's mode is a DOMAIN FACT. It lives on the character
 *   record as `character.mode`, and it is written by
 *   CharacterCRUD.setMode. This module is a READ-ONLY window onto
 *   that fact:
 *
 *     AcademyUI.getCharacterMode(charId)
 *       -> reads CharacterQueries.getCharacterById(charId).mode
 *       -> returns 'student' | 'instructor' | null
 *
 *   READ SEMANTICS:
 *     - null / blank charId               -> null
 *     - character does not exist          -> null
 *     - character exists, mode==='instructor' -> 'instructor'
 *     - character exists, anything else   -> 'student'
 *     - CharacterQueries unavailable      -> throws
 *
 *   A missing character is not the same as a student. Callers that
 *   need a mode for a missing character must decide what that
 *   means. An earlier revision returned 'student' for that case,
 *   which fabricated a domain fact out of a failed reference.
 *
 *   The write-side API (setCharacterMode, toggleCharacterMode,
 *   clearCharacterMode, isValidCharacterMode, getValidCharacterModes,
 *   VALID_CHARACTER_MODES, DEFAULT_CHARACTER_MODE) is GONE. Callers
 *   that want to change the mode call CharacterCRUD.setMode and
 *   trigger a re-render on success.
 *
 *   The sessionStorage `characterModes` map is GONE. Previously this
 *   module kept a per-character mode map in session state; the mode
 *   reset to 'student' on every page reload. That made the instructor
 *   relationship non-persistent, which is wrong for a domain fact.
 *
 * DEPENDENCY MODEL:
 *   CharacterQueries is LAZY-BUT-MANDATORY. The module loads without
 *   it, initialises, and serves view / class / week / filter state
 *   normally. `getCharacterMode` is the only method that requires
 *   CharacterQueries, and it resolves the dependency at call time.
 *   A missing module at that moment throws — it is not a silent
 *   fallback to a fabricated mode.
 *
 *   This distinction matters because the entire Academy UI state
 *   surface (view selection, class selection, display week, People
 *   filters, expansion state, round collapse state) does not depend
 *   on the character-query layer. Gating module load on a read-only
 *   helper is a load-order failure disguised as a dependency.
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
 *   - Character mode write API (v27) — the mode is a domain fact.
 *   - Character mode sessionStorage map (v27) — same reason.
 *   - `expandedRoundIds` internal name and `getExpandedRoundIds` /
 *     `clearExpandedRoundIds` public API. The map stores COLLAPSED
 *     rounds (non-default exceptions). The old name inverted the
 *     meaning on every read. Renamed to `collapsedRoundIds` /
 *     `getCollapsedRoundIds` / `clearCollapsedRoundIds`.
 *
 *   MIGRATION NOTE — v4 → v5:
 *     The storage key was bumped from `academy_ui_state_v4` to
 *     `academy_ui_state_v5` in the same revision that renamed the
 *     round map. A v4 session state carries `expandedRoundIds`
 *     (the old name); a v5 state carries `collapsedRoundIds` (the
 *     new name). The strict merge in mergeWithDefaults only reads
 *     known fields, so a v4 state loaded under the v5 key would
 *     have been silently emptied. Bumping the key makes the
 *     abandonment explicit instead of accidental: the v4 state is
 *     discarded wholesale, and the module starts from defaults.
 *     Round collapse state is disposable by design; nothing of
 *     value is lost.
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
 * TOURNAMENT ROUND COLLAPSE (C4):
 *   The Exams view renders a round header with a collapse toggle.
 *   The collapse state is persisted here, keyed by
 *   `${examId}::${roundId}` so different exams do not share collapse
 *   state for rounds that happen to have the same round ID across
 *   tournaments (which should not happen, but the namespacing is
 *   cheap insurance).
 *
 *   The default is EXPANDED. There is no "first round only" special
 *   case. A round the user has never touched is expanded; the user
 *   collapses it and the choice persists in session storage.
 *
 *   Storage shape: `{ [compositeKey]: true }` — only collapsed
 *   rounds are recorded. A missing key means "expanded" (the
 *   default). Storing only the non-default state keeps the
 *   persisted object small and lets the default change in the
 *   future without leaving stale entries behind.
 *
 *   The default policy is INTERNAL (`DEFAULT_ROUND_EXPANDED`). It is
 *   not a caller-supplied argument, because two callers passing
 *   different defaults for the same state would disagree about what
 *   the state means.
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants  (MIN_WEEK, MAX_WEEK) — MANDATORY at
 *     load.
 *   - window.CharacterQueries   (getCharacterById) — LAZY, resolved
 *     at call time by getCharacterMode. Mandatory when that method
 *     is invoked.
 *
 * USAGE:
 *   AcademyUI.getSelectedView();
 *   AcademyUI.setSelectedView('people');
 *   AcademyUI.selectClass('class_123');
 *   AcademyUI.selectCharacter('char_456');
 *   AcademyUI.setDisplayWeek(5);
 *   AcademyUI.getCharacterMode('char_456');  // read-only; use CharacterCRUD.setMode to write
 *   AcademyUI.getPeopleFilter();
 *   AcademyUI.setPeopleFilter({ role: 'student' });
 *
 *   // Tournament round collapse
 *   AcademyUI.isRoundExpanded('tourn_abc', 'round_xyz');
 *   AcademyUI.setRoundExpanded('tourn_abc', 'round_xyz', false);
 *   AcademyUI.getCollapsedRoundIds();
 */

(function() {
    'use strict';

    if (window.__academyUILoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES — LOAD-TIME
    // ============================================================
    //
    // Only CalendarConstants is required at load. CharacterQueries
    // is lazy-but-mandatory; see the header.

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
    // LAZY-BUT-MANDATORY DEPENDENCIES
    // ============================================================

    /**
     * Resolve CharacterQueries at call time. Throws when the module
     * is missing or malformed. This is the "lazy ≠ optional" rule:
     * load order is deferred, mandatory-ness is not.
     */
    function requireCharacterQueries() {
        var Queries = window.CharacterQueries;

        if (!Queries ||
            typeof Queries.getCharacterById !== 'function') {
            throw new Error(
                '[AcademyUI] CharacterQueries.getCharacterById is ' +
                'unavailable. It is required by getCharacterMode. ' +
                'Check the script load order in index.html.'
            );
        }

        return Queries;
    }

    // ============================================================
    // CONSTANTS — frozen
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

    var DEFAULT_CHARACTER_MODE = 'student';

    // Round collapse policy. INTERNAL. The storage layer stores
    // exceptions to this default; callers do not pass it in.
    var DEFAULT_ROUND_EXPANDED = true;

    // ============================================================
    // DEFAULT STATE
    // ============================================================
    //
    // Single canonical definition. _state is initialised from a
    // fresh clone of this template; resetState() also returns to it.
    //
    // The public DEFAULT_STATE export is a DEEP-frozen clone of the
    // same template, so a caller cannot corrupt it by mutating a
    // nested object.
    //
    // NOTE (v27): `characterModes` is gone. The mode is a domain
    // fact and does not belong in session state.
    //
    // NOTE (this revision): the collapsed-rounds map is named
    // `collapsedRoundIds`, not `expandedRoundIds`. The map stores
    // COLLAPSED rounds. The old name inverted the meaning.

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
            // C4 — tournament round collapse state.
            // { [compositeKey]: true } for COLLAPSED rounds.
            // Absence means "expanded" (the default).
            collapsedRoundIds: {}
        };
    }

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
            var v = obj[keys[i]];
            if (v && typeof v === 'object') {
                deepFreeze(v);
            }
        }
        return Object.freeze(obj);
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
    //
    // v5 key: see the MIGRATION NOTE in the file header. The bump
    // from v4 to v5 abandons the pre-rename `expandedRoundIds` map
    // explicitly rather than dropping it silently through the
    // strict merge.

    var STORAGE_KEY = 'academy_ui_state_v5';

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
     *
     * The same mechanism silently drops the old `characterModes` map
     * from pre-v27 state. It is not a known field anymore, so it is
     * not carried forward.
     *
     * The storage key was bumped to v5 in this revision, so pre-
     * rename `expandedRoundIds` state is also abandoned wholesale.
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

        // Expanded ids: values must be strictly `true`, and keys must
        // be non-empty strings. Anything else is dropped. A persisted
        // { "abc": "banana" } is not valid UI state.
        if (parsed.expandedIds &&
            typeof parsed.expandedIds === 'object' &&
            !Array.isArray(parsed.expandedIds)) {
            var keys = Object.keys(parsed.expandedIds);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (typeof key !== 'string' || key.trim() === '') {
                    continue;
                }
                if (parsed.expandedIds[key] === true) {
                    merged.expandedIds[key] = true;
                }
            }
        }

        // C4 — round collapse state.
        //
        // Only keys shaped like `${examId}::${roundId}` are accepted.
        // Both halves must be non-empty strings, with exactly one
        // separator. Values must be strictly `true`.
        if (parsed.collapsedRoundIds &&
            typeof parsed.collapsedRoundIds === 'object' &&
            !Array.isArray(parsed.collapsedRoundIds)) {
            var roundKeys = Object.keys(parsed.collapsedRoundIds);
            for (var k = 0; k < roundKeys.length; k++) {
                var composite = roundKeys[k];
                if (!isValidRoundCompositeKey(composite)) { continue; }
                if (parsed.collapsedRoundIds[composite] === true) {
                    merged.collapsedRoundIds[composite] = true;
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
            collapsedRoundIds: Object.assign(
                {}, _state.collapsedRoundIds
            )
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
    // CHARACTER MODE — READ ONLY
    // ============================================================
    //
    // The mode is a domain fact. It lives on the character record
    // and is written by CharacterCRUD.setMode. This module is a
    // read-only window onto that fact.
    //
    // READ SEMANTICS:
    //   - null / blank charId               → null
    //   - character does not exist          → null
    //   - character exists, mode==='instructor' → 'instructor'
    //   - character exists, anything else   → 'student'
    //   - CharacterQueries unavailable      → throws
    //
    // A missing character is not the same as a student. Callers that
    // need a mode for a missing character must decide what that
    // means. The previous revision returned 'student' for that case,
    // which fabricated a domain fact out of a failed reference.
    //
    // WRITE SEMANTICS:
    //   There are none. The write API has been retired. Callers that
    //   want to change the mode call CharacterCRUD.setMode and
    //   trigger a re-render on success.

    /**
     * Read the mode of a character.
     *
     * @param {string} charId
     * @returns {'student'|'instructor'|null}
     */
    function getCharacterMode(charId) {
        var id = normaliseId(charId);
        if (id === null) {
            return null;
        }

        var Queries = requireCharacterQueries();

        var char = Queries.getCharacterById(id);
        if (!char || typeof char !== 'object') {
            return null;
        }

        if (char.mode === 'instructor') {
            return 'instructor';
        }

        return DEFAULT_CHARACTER_MODE;
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
    //
    // IDs route through normaliseId() so that setExpanded({}, true)
    // cannot produce the state key "[object Object]".

    function isExpanded(id) {
        var key = normaliseId(id);
        if (key === null) { return false; }
        return _state.expandedIds[key] === true;
    }

    function setExpanded(id, expanded) {
        var key = normaliseId(id);
        if (key === null) { return; }
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
        var key = normaliseId(id);
        if (key === null) { return false; }
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
    // TOURNAMENT ROUND COLLAPSE (C4)
    // ============================================================
    //
    // STATE MODEL:
    //   The stored map holds ONLY collapsed rounds. A key that is
    //   absent means "expanded" — the default. This is the
    //   "non-default only" convention: it keeps the persisted object
    //   small, and a future change of the default (if we ever flip
    //   to collapsed-by-default) will not leave behind stale entries
    //   that silently mean the old default.
    //
    // KEY FORMAT:
    //   `${examId}::${roundId}`. The double-colon separator is chosen
    //   because neither IDs contain it. IDs are normalised to trimmed
    //   strings before use. Both halves must be non-empty, and
    //   exactly one separator must appear.
    //
    // DEFAULT POLICY:
    //   DEFAULT_ROUND_EXPANDED is a module constant. Callers do not
    //   pass it in. Two callers passing different defaults for the
    //   same state would disagree about what the state means; the
    //   storage layer is not a policy-injection point.
    //
    // WHY NOT A NESTED MAP (examId -> roundId -> bool):
    //   The aggregator reads collapse state per round in a loop over
    //   rounds. A flat map with composite keys is O(1) per lookup and
    //   serialises to a compact JSON object. A nested map is a
    //   marginal readability improvement at the cost of a deeper
    //   merge on load and a deeper clone on getState. Flat wins.

    var ROUND_KEY_SEPARATOR = '::';

    /**
     * Validate a composite round key. Requires exactly two non-empty
     * parts separated by exactly one separator.
     */
    function isValidRoundCompositeKey(key) {
        if (typeof key !== 'string') {
            return false;
        }
        var parts = key.split(ROUND_KEY_SEPARATOR);
        if (parts.length !== 2) {
            return false;
        }
        if (parts[0].trim() === '') { return false; }
        if (parts[1].trim() === '') { return false; }
        return true;
    }

    function makeRoundKey(examId, roundId) {
        var e = normaliseId(examId);
        var r = normaliseId(roundId);
        if (e === null || r === null) {
            return null;
        }
        return e + ROUND_KEY_SEPARATOR + r;
    }

    /**
     * Get the full set of collapsed round keys.
     *
     * Returns a shallow clone of the internal map. Callers cannot
     * mutate live state by holding onto the returned object.
     *
     * @returns {object} { [compositeKey]: true }
     */
    function getCollapsedRoundIds() {
        return Object.assign({}, _state.collapsedRoundIds);
    }

    /**
     * Is a specific round expanded?
     *
     * Uses the module's internal default policy. A stored entry
     * means "collapsed"; absence means "expanded" (the default).
     *
     * @param {string} examId
     * @param {string} roundId
     * @returns {boolean}
     */
    function isRoundExpanded(examId, roundId) {
        var key = makeRoundKey(examId, roundId);
        if (key === null) {
            return DEFAULT_ROUND_EXPANDED;
        }
        if (_state.collapsedRoundIds[key] === true) {
            return false;
        }
        return DEFAULT_ROUND_EXPANDED;
    }

    /**
     * Set a specific round's expanded state.
     *
     * SEMANTICS:
     *   expanded === true  → remove the collapse record (default)
     *   expanded === false → write the collapse record
     *
     * This preserves the "non-default only" invariant: a round the
     * user has never collapsed has no record, exactly as if they had
     * explicitly expanded it. Removing a record is idempotent.
     *
     * No-ops when either ID is missing. Returns true when the call
     * was accepted (whether or not it changed anything), false when
     * the input was invalid.
     *
     * @returns {boolean}
     */
    function setRoundExpanded(examId, roundId, expanded) {
        var key = makeRoundKey(examId, roundId);
        if (key === null) {
            return false;
        }
        var wantCollapsed = expanded === false;
        var currentlyCollapsed =
            _state.collapsedRoundIds[key] === true;

        if (wantCollapsed === currentlyCollapsed) {
            return true;
        }

        if (wantCollapsed) {
            _state.collapsedRoundIds[key] = true;
        } else {
            delete _state.collapsedRoundIds[key];
        }
        saveState();
        return true;
    }

    /**
     * Toggle a round's expanded state.
     *
     * Uses the module's internal default policy for a round with no
     * stored record.
     *
     * @returns {boolean} the state AFTER the toggle. When the input
     *   is invalid, returns DEFAULT_ROUND_EXPANDED.
     */
    function toggleRoundExpanded(examId, roundId) {
        var key = makeRoundKey(examId, roundId);
        if (key === null) {
            return DEFAULT_ROUND_EXPANDED;
        }

        var currentlyExpanded;
        if (_state.collapsedRoundIds[key] === true) {
            currentlyExpanded = false;
        } else {
            currentlyExpanded = DEFAULT_ROUND_EXPANDED;
        }

        var next = !currentlyExpanded;

        if (next === true) {
            delete _state.collapsedRoundIds[key];
        } else {
            _state.collapsedRoundIds[key] = true;
        }
        saveState();
        return next;
    }

    /**
     * Forget every round collapse record.
     *
     * Not called from anywhere in the current build. Exposed for
     * symmetry with clearExpanded() and for tests.
     */
    function clearCollapsedRoundIds() {
        _state.collapsedRoundIds = {};
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

    function getValidRoleFilters() {
        return VALID_ROLE_FILTERS.slice();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Public DEFAULT_STATE is a DEEP-frozen clone of the template.
    // deepFreeze is applied so a caller cannot reach into a nested
    // object (filters.people, expandedIds, collapsedRoundIds) and
    // corrupt the published template.
    var DEFAULT_STATE_PUBLIC = deepFreeze(createDefaultState());

    window.AcademyUI = Object.freeze({
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

        // Character mode — READ ONLY
        // The mode is a domain fact. Use CharacterCRUD.setMode to
        // write it. Returns 'student' | 'instructor' | null.
        getCharacterMode: getCharacterMode,

        // People filter
        getPeopleFilter: getPeopleFilter,
        setPeopleFilter: setPeopleFilter,
        setPeopleSearch: setPeopleSearch,
        setPeopleRole: setPeopleRole,
        setPeopleStatus: setPeopleStatus,
        resetPeopleFilter: resetPeopleFilter,

        // Expansion (generic — used by other views)
        isExpanded: isExpanded,
        setExpanded: setExpanded,
        toggleExpanded: toggleExpanded,
        getExpandedIds: getExpandedIds,
        clearExpanded: clearExpanded,

        // Tournament round collapse (C4)
        getCollapsedRoundIds: getCollapsedRoundIds,
        isRoundExpanded: isRoundExpanded,
        setRoundExpanded: setRoundExpanded,
        toggleRoundExpanded: toggleRoundExpanded,
        clearCollapsedRoundIds: clearCollapsedRoundIds,

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
        DEFAULT_STATE: DEFAULT_STATE_PUBLIC
    });

})();
