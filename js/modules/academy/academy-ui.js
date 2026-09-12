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
 *   - Derived role computation for a character in a graduating class
 * 
 * IMPORTANT:
 *   - UI STATE ONLY - no domain data, no mutations
 *   - No AcademyQueries dependencies for state storage
 *   - Persistence is sessionStorage only (not IndexedDB)
 *   - This module is the SINGLE SOURCE OF TRUTH for Academy UI state
 * 
 * STATE MODEL (v2 - People shell):
 * 
 *   selectedView:      'people' | 'weeklyTeams' | 'rankings' |
 *                      'disciplines' | 'locations'
 *   selectedClassId:   graduating class ID (a class entity ID,
 *                      not a discipline)
 *   selectedCharacterId: character ID
 *   displayWeek:       shared week selector value (1..52)
 *   filters.people:    { search, role, status }
 *   expandedIds:       map of expanded UI element IDs
 * 
 * ROLE SEMANTICS:
 *   - A character's role is defined RELATIVE TO A GRADUATING CLASS.
 *   - 'instructor' means class.instructorId === char.id.
 *   - 'trainee' means any other case where the character is a member.
 *   - Role is DERIVED, not stored. Use getRoleFor(charId, classId).
 *   - There is no selectedRole field. The role follows from the
 *     (character, class) pair.
 * 
 * TRANSITION RULES:
 *   - selectClass(classId):
 *       * If selectedCharacterId is set and that character is a member
 *         of the new class (or is its instructor), keep the selection.
 *       * Otherwise clear selectedCharacterId.
 *       * Keep selectedView and displayWeek.
 *   - selectCharacter(charId):
 *       * Keep selectedClassId and displayWeek.
 *       * Character selection is always allowed, even if the character
 *         is not a member of the selected class. The detail panel
 *         renders an empty state in that case.
 *   - setSelectedView(view):
 *       * Keep selectedClassId and displayWeek.
 *       * If the new view is not 'people', clear selectedCharacterId.
 *   - setDisplayWeek(week):
 *       * No selection changes.
 *   - clearSelection('class' | 'character'):
 *       * Clears only that field.
 *   - clearSelections():
 *       * Clears both.
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 *   - getRoleFor optionally uses window.AcademyQueries if available,
 *     but degrades gracefully without it.
 * 
 * USAGE:
 *   var UI = window.AcademyUI;
 *   UI.init();
 *   UI.setSelectedView('people');
 *   UI.selectClass('class_123');
 *   UI.selectCharacter('char_456');
 *   var role = UI.getRoleFor('char_456', 'class_123');
 *   var week = UI.getDisplayWeek();
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

    var VALID_VIEWS = ['people', 'weeklyTeams', 'rankings', 'disciplines', 'locations'];
    var DEFAULT_VIEW = 'people';

    var VALID_ROLES = ['trainee', 'instructor'];
    var DEFAULT_ROLE = 'trainee';

    var VALID_ROLE_FILTERS = ['all', 'trainee', 'instructor'];
    var DEFAULT_ROLE_FILTER = 'all';

    var VALID_STATUS_FILTERS = ['active', 'eliminated', 'deceased', 'all'];
    var DEFAULT_STATUS_FILTER = 'active';

    var MIN_WEEK = 1;
    var MAX_WEEK = 52;
    var DEFAULT_WEEK = 1;

    // ============================================================
    // DEFAULT STATE - Immutable template
    // ============================================================

    var DEFAULT_STATE = {
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
        expandedIds: {}
    };

    // ============================================================
    // LIVE STATE
    // ============================================================

    var _state = null;

    // ============================================================
    // STORAGE
    // ============================================================

    var STORAGE_KEY = 'academy_ui_state_v2';

    // ============================================================
    // STATE INITIALIZATION
    // ============================================================

    function getDefaultState() {
        return JSON.parse(JSON.stringify(DEFAULT_STATE));
    }

    function isValidView(view) {
        return VALID_VIEWS.indexOf(view) !== -1;
    }

    function isValidRole(role) {
        return VALID_ROLES.indexOf(role) !== -1;
    }

    function isValidRoleFilter(value) {
        return VALID_ROLE_FILTERS.indexOf(value) !== -1;
    }

    function isValidStatusFilter(value) {
        return VALID_STATUS_FILTERS.indexOf(value) !== -1;
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
    // LAZY ACCESS TO ACADEMY QUERIES
    // ============================================================
    // 
    // getRoleFor needs to inspect the class record to determine
    // whether a character is the instructor. We use AcademyQueries
    // if it is loaded; otherwise we fall back to reading window.data
    // directly. This keeps the module usable at load time before
    // AcademyQueries is present.

    function getAcademyQueries() {
        return window.AcademyQueries || null;
    }

    function getClassRecord(classId) {
        if (!classId) {
            return null;
        }

        var AcademyQueries = getAcademyQueries();
        if (AcademyQueries && typeof AcademyQueries.getClass === 'function') {
            return AcademyQueries.getClass(classId);
        }

        // Fallback: read directly from window.data.
        var data = window.data;
        if (!data || !data.academy || !data.academy.graduatingClasses) {
            return null;
        }
        return data.academy.graduatingClasses[String(classId)] || null;
    }

    function isCharacterInClass(charId, classId) {
        if (!charId || !classId) {
            return false;
        }

        var AcademyQueries = getAcademyQueries();
        if (AcademyQueries && typeof AcademyQueries.isCharacterInClass === 'function') {
            var char = null;
            if (typeof AcademyQueries.getClassStudents === 'function') {
                var students = AcademyQueries.getClassStudents(classId) || [];
                for (var i = 0; i < students.length; i++) {
                    if (String(students[i].id) === String(charId)) {
                        return true;
                    }
                }
            }
        }

        // Fallback: read character.classIds directly.
        var data = window.data;
        if (!data || !Array.isArray(data.characters)) {
            return false;
        }
        for (var j = 0; j < data.characters.length; j++) {
            var c = data.characters[j];
            if (!c || String(c.id) !== String(charId)) {
                continue;
            }
            var classIds = Array.isArray(c.classIds) ? c.classIds : [];
            for (var k = 0; k < classIds.length; k++) {
                if (String(classIds[k]) === String(classId)) {
                    return true;
                }
            }
            return false;
        }
        return false;
    }

    // ============================================================
    // ROLE DERIVATION
    // ============================================================

    /**
     * Determine the role of a character relative to a graduating class.
     * 
     * Returns:
     *   'instructor' — the character is the class's instructor
     *                  (class.instructorId === charId)
     *   'trainee'    — any other case where the class exists
     *   null         — the class does not exist
     * 
     * @param {string} charId - Character ID
     * @param {string} classId - Graduating class ID
     * @returns {'instructor'|'trainee'|null}
     */
    function getRoleFor(charId, classId) {
        if (!classId) {
            return null;
        }

        var cls = getClassRecord(classId);
        if (!cls) {
            return null;
        }

        if (!charId) {
            return null;
        }

        if (cls.instructorId && String(cls.instructorId) === String(charId)) {
            return 'instructor';
        }

        return 'trainee';
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
    // PUBLIC API - Views
    // ============================================================

    function getSelectedView() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.selectedView;
    }

    function setSelectedView(view) {
        if (!_state) {
            _state = getDefaultState();
        }
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
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.selectedClassId;
    }

    function selectClass(classId) {
        if (!_state) {
            _state = getDefaultState();
        }

        var normalised = classId ? String(classId) : null;
        if (normalised === _state.selectedClassId) {
            return;
        }

        var oldClassId = _state.selectedClassId;
        _state.selectedClassId = normalised;

        // If a character was selected, keep it only if the character is
        // a member of the new class or its instructor.
        if (_state.selectedCharacterId && normalised) {
            var stillMember = isCharacterInClass(_state.selectedCharacterId, normalised);
            var isInstructor = false;

            if (!stillMember) {
                var cls = getClassRecord(normalised);
                if (cls && cls.instructorId) {
                    isInstructor = String(cls.instructorId) === String(_state.selectedCharacterId);
                }
            }

            if (!stillMember && !isInstructor) {
                _state.selectedCharacterId = null;
            }
        }

        // Clearing the class (classId === null) also clears the
        // character selection, since there's no longer a context for it.
        if (!normalised) {
            _state.selectedCharacterId = null;
        }

        saveState();
    }

    // ============================================================
    // PUBLIC API - Character Selection
    // ============================================================

    function getSelectedCharacterId() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.selectedCharacterId;
    }

    function selectCharacter(charId) {
        if (!_state) {
            _state = getDefaultState();
        }

        var normalised = charId ? String(charId) : null;
        if (normalised === _state.selectedCharacterId) {
            return;
        }

        // Character selection is always allowed, even if the character
        // is not a member of the selected class. The detail panel
        // renders an empty state if they aren't.
        _state.selectedCharacterId = normalised;

        saveState();
    }

    // ============================================================
    // PUBLIC API - Week
    // ============================================================

    function getDisplayWeek() {
        if (!_state) {
            _state = getDefaultState();
        }
        return _state.displayWeek || DEFAULT_WEEK;
    }

    function setDisplayWeek(week) {
        if (!_state) {
            _state = getDefaultState();
        }
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
    // PUBLIC API - Filters
    // ============================================================

    function getFilter(view) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (!view || !_state.filters[view]) {
            return {};
        }
        return Object.assign({}, _state.filters[view]);
    }

    function setFilter(view, key, value) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (!view || !key) {
            return;
        }

        // Views are lazily added to the filters map.
        if (!_state.filters[view]) {
            _state.filters[view] = {};
        }

        _state.filters[view][key] = value;
        saveState();
    }

    function updateFilter(view, updates) {
        if (!_state) {
            _state = getDefaultState();
        }
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
        if (!_state) {
            _state = getDefaultState();
        }
        if (!view) {
            return;
        }

        // Reset only to defaults we know about.
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
        if (!_state) {
            _state = getDefaultState();
        }
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
        if (!_state) {
            _state = getDefaultState();
        }
        return !!_state.expandedIds[id];
    }

    function setExpanded(id, expanded) {
        if (!_state) {
            _state = getDefaultState();
        }
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
        if (!_state) {
            _state = getDefaultState();
        }
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
        if (!_state) {
            _state = getDefaultState();
        }
        return Object.assign({}, _state.expandedIds);
    }

    function clearExpanded() {
        if (!_state) {
            _state = getDefaultState();
        }
        _state.expandedIds = {};
        saveState();
    }

    // ============================================================
    // PUBLIC API - Selections
    // ============================================================

    function clearSelection(type) {
        if (!_state) {
            _state = getDefaultState();
        }
        if (type === 'class') {
            _state.selectedClassId = null;
            // Clearing the class also clears the character, since
            // there's no longer a context for it.
            _state.selectedCharacterId = null;
        } else if (type === 'character') {
            _state.selectedCharacterId = null;
        }
        saveState();
    }

    function clearSelections() {
        if (!_state) {
            _state = getDefaultState();
        }
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
    // DEPRECATED ALIASES - Backward compatibility during transition
    // ============================================================
    // 
    // These exist so that class-tab.js, student-tab.js, faculty-tab.js
    // continue to work while we migrate to the People shell. They map
    // to the new state model and will be removed once the tabs are
    // deleted in Phase 12.

    /**
     * @deprecated Use getSelectedView() instead.
     */
    function getActiveTab() {
        // The old API used 'class' | 'student' | 'faculty'.
        // All of them map to the 'people' view in the new model.
        return 'class';
    }

    /**
     * @deprecated Use setSelectedView() instead.
     */
    function setActiveTab(tab) {
        // Any tab argument maps to 'people'.
        setSelectedView('people');
        return true;
    }

    /**
     * @deprecated Use isValidView() instead.
     */
    function isValidTab(tab) {
        return tab === 'class' || tab === 'student' || tab === 'faculty';
    }

    /**
     * @deprecated Use getValidViews() instead.
     */
    function getValidTabs() {
        return ['class', 'student', 'faculty'];
    }

    /**
     * @deprecated Use getSelectedCharacterId() instead.
     */
    function getSelectedStudentId() {
        var charId = getSelectedCharacterId();
        if (!charId) {
            return null;
        }
        var classId = getSelectedClassId();
        if (!classId) {
            return null;
        }
        var role = getRoleFor(charId, classId);
        return role === 'trainee' ? charId : null;
    }

    /**
     * @deprecated Use selectCharacter() instead.
     */
    function selectStudent(studentId) {
        selectCharacter(studentId);
    }

    /**
     * @deprecated Use getSelectedCharacterId() instead.
     */
    function getSelectedInstructorId() {
        var charId = getSelectedCharacterId();
        if (!charId) {
            return null;
        }
        var classId = getSelectedClassId();
        if (!classId) {
            return null;
        }
        var role = getRoleFor(charId, classId);
        return role === 'instructor' ? charId : null;
    }

    /**
     * @deprecated Use selectCharacter() instead.
     */
    function selectInstructor(instructorId) {
        selectCharacter(instructorId);
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

        // Role
        getRoleFor: getRoleFor,
        getValidRoleFilters: getValidRoleFilters,
        isValidRoleFilter: isValidRoleFilterPublic,

        // Constants (read-only)
        DEFAULT_STATE: DEFAULT_STATE,
        VALID_VIEWS: VALID_VIEWS,
        VALID_ROLE_FILTERS: VALID_ROLE_FILTERS,
        VALID_STATUS_FILTERS: VALID_STATUS_FILTERS,

        // Deprecated aliases (removed in Phase 12)
        getActiveTab: getActiveTab,
        setActiveTab: setActiveTab,
        isValidTab: isValidTab,
        getValidTabs: getValidTabs,
        getSelectedStudentId: getSelectedStudentId,
        selectStudent: selectStudent,
        getSelectedInstructorId: getSelectedInstructorId,
        selectInstructor: selectInstructor
    };

})();