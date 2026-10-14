/**
 * js/core/state.js - Central State Management
 * Single source of truth for all application UI state
 * Path: js/core/state.js
 *
 * IMPORTANT:
 * - This module manages UI state ONLY, not domain data.
 * - Domain data (characters, teams, etc.) lives in window.data.
 * - UI state is NOT persisted to IndexedDB.
 * - All UI state is stored in a single object for easy debugging.
 * - DefaultAppState is a TEMPLATE for resets - treat as immutable.
 *
 * STATE HIERARCHY:
 * - AppState is the root state object.
 * - Each module has its own namespace.
 * - Sub-states represent different views within a module.
 *
 * NAVIGATION STATE:
 * - Which tab is currently active is managed by TabManager.
 * - State values here are view-specific (e.g., which week to show).
 * - SessionState.lastTab tracks the previously visited tab for
 *   navigation flow (written by TabManager's onTabChange listener).
 *
 * PERSISTENCE:
 * - UI state does NOT auto-save.
 * - If a value needs to survive page reload, it should be in window.data.
 * - UI state is deliberately ephemeral.
 *
 * OBSERVABILITY:
 * - State changes notify listeners registered via onStateChange().
 * - Listeners receive (module, key, value, oldValue).
 * - Mutating a returned sub-object directly bypasses notification.
 *   Use setState / updateState for tracked changes.
 * - Listener errors are caught and logged to the console.
 */

// ============================================================
// DEFAULT STATE - Immutable template for resets
// ============================================================

var DefaultAppState = {
    dashboard: {},

    characters: {
        filterStatus: 'all',
        filterName: '',
        hideDeceased: false,
        hideEliminated: false,
        formEditId: null,
        activeFormTab: 'name'
    },

    teams: {
        currentTab: 'academic',
        expandedTeamId: null,
        currentTeamId: null,
        filters: {
            academic: { filterWeek: 1, filterStatus: 'active', filterClass: 'all' },
            professional: { filterYear: '', filterStatus: 'active' },
            temporary: { filterYear: '', filterStatus: 'active' },
            civilian: { filterStatus: 'active' }
        }
    },

    tournaments: {
        currentTournamentId: null,
        currentMode: 'teams',
        expandedMatch: null,
        editingMatch: null
    },

    curriculum: {
        grade: {
            currentWeek: 1,
            selectedStudentId: null
        },
        ranking: {
            currentWeek: 1
        },
        classView: {
            currentWeek: 1,
            filterDiscipline: 'all'
        },
        instructorCalendar: {
            currentWeek: 1,
            selectedInstructorId: null,
            expandedGroups: {}
        },
        studentSchedule: {
            currentWeek: 1,
            selectedStudentId: null
        },
        autoGroups: {
            expanded: {}
        },
        classes: {
            selectedClassId: null,
            viewMode: 'roster',
            distributionWeek: 1,
            maxTeamSize: 4
        }
    },

    missions: {
        currentFilter: 'all',
        currentMissionId: null
    },

    social: {
        selectedCharacterId: null,
        viewMode: 'list',
        zoomLevel: 1,
        panX: 0,
        panY: 0,
        expandedNodes: {}
    }
};

// ============================================================
// LIVE STATE - Initialised from defaults
// ============================================================

var AppState = JSON.parse(JSON.stringify(DefaultAppState));

// ============================================================
// DEFAULT SESSION STATE - Immutable template
// ============================================================

var DefaultSessionState = {
    characterListOpen: false,
    navOpen: false,
    lastTab: 'dashboard'
};

// ============================================================
// LIVE SESSION STATE - Initialised from defaults
// ============================================================

var SessionState = JSON.parse(JSON.stringify(DefaultSessionState));

// ============================================================
// STATE CHANGE LISTENERS
// ============================================================

var _stateChangeListeners = [];

// ============================================================
// HELPERS
// ============================================================

function hasStateKey(module, key) {
    if (!AppState[module]) { return false; }
    return Object.prototype.hasOwnProperty.call(AppState[module], key);
}

function notify(module, key, value, oldValue) {
    var snapshot = _stateChangeListeners.slice();
    for (var i = 0; i < snapshot.length; i++) {
        try {
            snapshot[i](module, key, value, oldValue);
        } catch (e) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[State] listener error:', e);
            }
        }
    }
}

// ============================================================
// STATE GETTERS / SETTERS
// ============================================================

function getState(module, key) {
    if (!AppState[module]) { return undefined; }
    if (key === undefined) { return AppState[module]; }
    if (!hasStateKey(module, key)) { return undefined; }
    return AppState[module][key];
}

function setState(module, key, value) {
    if (!AppState[module]) { return; }
    if (!hasStateKey(module, key)) { return; }

    var oldValue = AppState[module][key];
    AppState[module][key] = value;

    notify(module, key, value, oldValue);
}

function updateState(module, updates) {
    if (!AppState[module]) { return; }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return;
    }

    var keys = Object.keys(updates);
    var applied = [];

    // Apply all first so listeners see a consistent batch.
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (!hasStateKey(module, key)) { continue; }
        applied.push({
            key: key,
            oldValue: AppState[module][key],
            newValue: updates[key]
        });
        AppState[module][key] = updates[key];
    }

    for (var j = 0; j < applied.length; j++) {
        notify(module, applied[j].key, applied[j].newValue, applied[j].oldValue);
    }
}

function getModuleState(module) {
    if (!AppState[module]) { return null; }
    return AppState[module];
}

/**
 * Reset a module to its defaults IN PLACE, so any alias cached by
 * callers (e.g. getTeamState()) stays valid.
 */
function resetModuleState(module) {
    if (!DefaultAppState[module]) { return; }
    if (!AppState[module]) { return; }

    var defaults = JSON.parse(JSON.stringify(DefaultAppState[module]));
    var current = AppState[module];

    // Remove keys not present in defaults.
    var existingKeys = Object.keys(current);
    for (var i = 0; i < existingKeys.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(defaults, existingKeys[i])) {
            delete current[existingKeys[i]];
            notify(module, existingKeys[i], undefined, undefined);
        }
    }

    // Assign defaults.
    var defaultKeys = Object.keys(defaults);
    for (var j = 0; j < defaultKeys.length; j++) {
        var key = defaultKeys[j];
        var oldValue = current[key];
        current[key] = defaults[key];
        notify(module, key, defaults[key], oldValue);
    }
}

function resetAllState() {
    var fresh = JSON.parse(JSON.stringify(DefaultAppState));
    var moduleKeys = Object.keys(AppState);

    for (var i = 0; i < moduleKeys.length; i++) {
        var mod = moduleKeys[i];
        if (Object.prototype.hasOwnProperty.call(fresh, mod)) {
            // Replace module contents in place.
            var current = AppState[mod];
            var existingKeys = Object.keys(current);
            for (var k = 0; k < existingKeys.length; k++) {
                delete current[existingKeys[k]];
            }
            var newKeys = Object.keys(fresh[mod]);
            for (var n = 0; n < newKeys.length; n++) {
                current[newKeys[n]] = fresh[mod][newKeys[n]];
            }
            notify(mod, null, fresh[mod], null);
        } else {
            delete AppState[mod];
        }
    }

    // Add any modules that exist in defaults but not in live state.
    var freshKeys = Object.keys(fresh);
    for (var m = 0; m < freshKeys.length; m++) {
        if (!AppState[freshKeys[m]]) {
            AppState[freshKeys[m]] = fresh[freshKeys[m]];
            notify(freshKeys[m], null, fresh[freshKeys[m]], null);
        }
    }
}

// ============================================================
// STATE CHANGE SUBSCRIPTION
// ============================================================

function onStateChange(listener) {
    if (typeof listener !== 'function') {
        return function() {};
    }

    _stateChangeListeners.push(listener);

    return function() {
        var index = _stateChangeListeners.indexOf(listener);
        if (index !== -1) {
            _stateChangeListeners.splice(index, 1);
        }
    };
}

// ============================================================
// CONVENIENCE GETTERS
// ============================================================

function getCurriculumState() { return AppState.curriculum; }
function getCharacterState()  { return AppState.characters; }
function getTeamState()       { return AppState.teams; }
function getTournamentState() { return AppState.tournaments; }
function getSocialState()     { return AppState.social; }
function getMissionState()    { return AppState.missions; }
function getDashboardState()  { return AppState.dashboard; }

// ============================================================
// CURRICULUM VIEW HELPERS
// ============================================================

function getCurriculumViewWeek(viewName) {
    var view = AppState.curriculum[viewName];
    if (!view) { return 1; }
    return typeof view.currentWeek === 'number' ? view.currentWeek : 1;
}

function setCurriculumViewWeek(viewName, week) {
    var view = AppState.curriculum[viewName];
    if (!view) { return; }
    if (typeof week !== 'number' || !Number.isFinite(week) ||
        !Number.isInteger(week) || week < 1) {
        return;
    }

    var oldValue = view.currentWeek;
    view.currentWeek = week;

    // Emit a real key so hasStateKey-style checks work.
    // Listeners can filter on module === 'curriculum' && key === viewName.
    notify('curriculum', viewName, view, oldValue);
}

// ============================================================
// SESSION STATE HELPERS
// ============================================================

function getSession(key) {
    return SessionState[key];
}

function setSession(key, value) {
    var oldValue = SessionState[key];
    SessionState[key] = value;
    notify('session', key, value, oldValue);
}

function resetSession() {
    var fresh = JSON.parse(JSON.stringify(DefaultSessionState));
    var existing = Object.keys(SessionState);
    for (var i = 0; i < existing.length; i++) {
        delete SessionState[existing[i]];
    }
    var keys = Object.keys(fresh);
    for (var j = 0; j < keys.length; j++) {
        SessionState[keys[j]] = fresh[keys[j]];
        notify('session', keys[j], fresh[keys[j]], undefined);
    }
}

// ============================================================
// STATE SERIALIZATION (for debugging)
// ============================================================

function getStateSnapshot(includeSession) {
    var snapshot = {
        app: JSON.parse(JSON.stringify(AppState)),
        timestamp: new Date().toISOString()
    };
    if (includeSession) {
        snapshot.session = JSON.parse(JSON.stringify(SessionState));
    }
    return snapshot;
}

function getStateDiff() {
    var diff = {};
    var modules = Object.keys(DefaultAppState);
    for (var i = 0; i < modules.length; i++) {
        var module = modules[i];
        var current = AppState[module];
        var defaults = DefaultAppState[module];
        if (JSON.stringify(current) !== JSON.stringify(defaults)) {
            diff[module] = {
                current: JSON.parse(JSON.stringify(current)),
                defaults: JSON.parse(JSON.stringify(defaults))
            };
        }
    }
    return diff;
}

// ============================================================
// EXPOSE GLOBALS
// ============================================================

window.AppState = AppState;
window.SessionState = SessionState;
window.DefaultAppState = DefaultAppState;
window.DefaultSessionState = DefaultSessionState;

window.getState = getState;
window.setState = setState;
window.updateState = updateState;
window.getModuleState = getModuleState;
window.resetModuleState = resetModuleState;
window.resetAllState = resetAllState;
window.onStateChange = onStateChange;

window.getCurriculumState = getCurriculumState;
window.getCharacterState = getCharacterState;
window.getTeamState = getTeamState;
window.getTournamentState = getTournamentState;
window.getSocialState = getSocialState;
window.getMissionState = getMissionState;
window.getDashboardState = getDashboardState;

window.getCurriculumViewWeek = getCurriculumViewWeek;
window.setCurriculumViewWeek = setCurriculumViewWeek;

window.getSession = getSession;
window.setSession = setSession;
window.resetSession = resetSession;

window.getStateSnapshot = getStateSnapshot;
window.getStateDiff = getStateDiff;
