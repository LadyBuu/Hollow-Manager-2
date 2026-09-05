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
 * - SessionState.lastTab tracks the previously visited tab for navigation flow.
 * 
 * PERSISTENCE:
 * - UI state does NOT auto-save.
 * - If a value needs to survive page reload, it should be in window.data.
 * - UI state is deliberately ephemeral.
 * 
 * STATE CATEGORIES:
 *   1. AppState - UI state that should survive view switches but not page reloads
 *   2. SessionState - Very ephemeral UI state (mobile menu, lastTab, etc.)
 *   3. window.data - Persistent domain data (IndexedDB)
 * 
 * NOTIFICATIONS:
 * - SessionState.toast has been REMOVED.
 * - NotificationSystem is the single source of truth for notifications.
 * 
 * DEFAULT STATE:
 * - DefaultAppState provides immutable defaults for resetting modules.
 * - AppState is initialised from DefaultAppState.
 * - DefaultAppState should NOT be modified directly.
 */

// ============================================================
// DEFAULT STATE - Immutable template for resets
// ============================================================

var DefaultAppState = {
    // Dashboard
    dashboard: {
        // No persistent UI state needed
    },

    // Characters
    characters: {
        filterStatus: 'all',
        filterName: '',
        hideDeceased: false,
        hideEliminated: false,
        formEditId: null,
        // Current tab within character form
        activeFormTab: 'name'
    },

    // Teams
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

    // Tournaments
    tournaments: {
        currentTournamentId: null,
        currentMode: 'teams',
        expandedMatch: null,
        editingMatch: null
    },

    // Curriculum
    curriculum: {
        // Each view owns its own week. No global week needed.
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

    // Missions
    missions: {
        currentFilter: 'all',
        currentMissionId: null
    },

    // Social
    social: {
        selectedCharacterId: null,
        viewMode: 'list',
        zoomLevel: 1,
        panX: 0,
        panY: 0,
        // Expanded nodes in graph view
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
    // lastTab tracks the previously visited tab (TabManager is the authority for current tab)
    lastTab: 'dashboard'
};

// ============================================================
// LIVE SESSION STATE - Initialised from defaults
// ============================================================

var SessionState = JSON.parse(JSON.stringify(DefaultSessionState));

// ============================================================
// STATE HELPERS
// ============================================================

function hasStateKey(module, key) {
    if (!AppState[module]) {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(AppState[module], key);
}

// ============================================================
// DEVELOPMENT WARNINGS
// ============================================================

function warnUnknownKey(module, key) {
    if (typeof console !== 'undefined' && console.warn) {
        console.warn(
            '[AppState] Unknown key "' + key + '" in module "' + module + '". ' +
            'Available keys: ' + Object.keys(AppState[module] || {}).join(', ')
        );
    }
}

function warnUnknownModule(module) {
    if (typeof console !== 'undefined' && console.warn) {
        console.warn(
            '[AppState] Unknown module "' + module + '". ' +
            'Available modules: ' + Object.keys(AppState).join(', ')
        );
    }
}

// ============================================================
// STATE GETTERS / SETTERS
// ============================================================

/**
 * Get a value from the application state.
 * @param {string} module - Module name (e.g., 'characters', 'teams')
 * @param {string} key - State key within the module
 * @returns {*} The state value, or undefined if not found
 */
function getState(module, key) {
    if (!AppState[module]) {
        warnUnknownModule(module);
        return undefined;
    }

    if (key === undefined) {
        return AppState[module];
    }

    if (!hasStateKey(module, key)) {
        warnUnknownKey(module, key);
        return undefined;
    }

    return AppState[module][key];
}

/**
 * Set a value in the application state.
 * @param {string} module - Module name
 * @param {string} key - State key within the module
 * @param {*} value - New value
 */
function setState(module, key, value) {
    if (!AppState[module]) {
        warnUnknownModule(module);
        return;
    }

    if (!hasStateKey(module, key)) {
        warnUnknownKey(module, key);
        return;
    }

    AppState[module][key] = value;
}

/**
 * Update multiple state values at once.
 * @param {string} module - Module name
 * @param {object} updates - Object containing key-value pairs to update
 */
function updateState(module, updates) {
    if (!AppState[module]) {
        warnUnknownModule(module);
        return;
    }

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        console.warn('[AppState] updateState: updates must be a plain object.');
        return;
    }

    Object.keys(updates).forEach(function(key) {
        if (!hasStateKey(module, key)) {
            warnUnknownKey(module, key);
            return;
        }
        AppState[module][key] = updates[key];
    });
}

/**
 * Get the entire state object for a module.
 * @param {string} module - Module name
 * @returns {object|null} The module's state object
 */
function getModuleState(module) {
    if (!AppState[module]) {
        warnUnknownModule(module);
        return null;
    }
    return AppState[module];
}

/**
 * Reset a module's state to its default values.
 * Uses DefaultAppState as the immutable template.
 * @param {string} module - Module name
 */
function resetModuleState(module) {
    if (!DefaultAppState[module]) {
        warnUnknownModule(module);
        return;
    }

    // Deep clone the default template
    AppState[module] = JSON.parse(JSON.stringify(DefaultAppState[module]));
}

/**
 * Reset all state to defaults (keeps session state).
 * Maintains object identity so window.AppState remains valid.
 */
function resetAllState() {
    var freshState = JSON.parse(JSON.stringify(DefaultAppState));

    Object.keys(AppState).forEach(function(module) {
        delete AppState[module];
    });

    Object.keys(freshState).forEach(function(module) {
        AppState[module] = freshState[module];
    });
}

// ============================================================
// CONVENIENCE GETTERS FOR COMMON MODULES
// ============================================================

function getCurriculumState() {
    return AppState.curriculum;
}

function getCharacterState() {
    return AppState.characters;
}

function getTeamState() {
    return AppState.teams;
}

function getTournamentState() {
    return AppState.tournaments;
}

function getSocialState() {
    return AppState.social;
}

function getMissionState() {
    return AppState.missions;
}

function getDashboardState() {
    return AppState.dashboard;
}

// ============================================================
// CURRICULUM VIEW HELPERS
// ============================================================

/**
 * Get the current week for a specific curriculum view.
 * Each view owns its own week. Returns 1 if the view doesn't exist.
 * @param {string} viewName - The curriculum view name (e.g., 'grade', 'ranking')
 * @returns {number} The week number
 */
function getCurriculumViewWeek(viewName) {
    var view = AppState.curriculum[viewName];
    if (!view) {
        warnUnknownKey('curriculum', viewName);
        return 1;
    }
    return typeof view.currentWeek === 'number' ? view.currentWeek : 1;
}

/**
 * Set the current week for a specific curriculum view.
 * @param {string} viewName - The curriculum view name
 * @param {number} week - The week number to set (must be a positive finite integer)
 */
function setCurriculumViewWeek(viewName, week) {
    var view = AppState.curriculum[viewName];
    if (!view) {
        warnUnknownKey('curriculum', viewName);
        return;
    }

    // Validate week is a positive finite integer
    if (typeof week !== 'number' || !Number.isFinite(week) || !Number.isInteger(week) || week < 1) {
        console.warn(
            '[AppState] setCurriculumViewWeek: week must be a positive finite integer. ' +
            'Received: ' + week
        );
        return;
    }

    view.currentWeek = week;
}

// ============================================================
// SESSION STATE HELPERS
// ============================================================

function getSession(key) {
    return SessionState[key];
}

function setSession(key, value) {
    SessionState[key] = value;
}

/**
 * Reset session state to defaults.
 * Maintains object identity.
 */
function resetSession() {
    var freshState = JSON.parse(JSON.stringify(DefaultSessionState));

    Object.keys(SessionState).forEach(function(key) {
        delete SessionState[key];
    });

    Object.keys(freshState).forEach(function(key) {
        SessionState[key] = freshState[key];
    });
}

// ============================================================
// STATE SERIALIZATION (for debugging)
// ============================================================

/**
 * Get a serializable snapshot of the current state.
 * Useful for debugging and logging.
 * @param {boolean} includeSession - Whether to include session state
 * @returns {object} A snapshot of the current state
 */
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

/**
 * Log the current state to the console.
 * @param {boolean} includeSession - Whether to include session state
 */
function logState(includeSession) {
    var snapshot = getStateSnapshot(includeSession);
    // eslint-disable-next-line no-console
    console.log('[State] Current state:', snapshot);
}

// ============================================================
// STATE INSPECTION (for devtools)
// ============================================================

/**
 * Get the difference between current state and defaults.
 * Useful for seeing what has changed.
 */
function getStateDiff() {
    var diff = {};
    var modules = Object.keys(DefaultAppState);

    modules.forEach(function(module) {
        var current = AppState[module];
        var defaults = DefaultAppState[module];

        if (JSON.stringify(current) !== JSON.stringify(defaults)) {
            diff[module] = {
                current: JSON.parse(JSON.stringify(current)),
                defaults: JSON.parse(JSON.stringify(defaults))
            };
        }
    });

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
window.logState = logState;
window.getStateDiff = getStateDiff;