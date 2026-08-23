/**
 * js/core/state.js - Central State Management
 * Single source of truth for all application state
 * Path: js/core/state.js
 */

var AppState = {
    // Dashboard
    dashboard: {
        currentYear: new Date().getFullYear()
    },

    // Characters
    characters: {
        filterStatus: 'all',
        filterName: '',
        hideDeceased: false,
        hideEliminated: false,
        formEditId: null
    },

    // Teams
    teams: {
        currentTab: 'academic',
        expandedTeamId: null,
        currentTeamId: null,
        filters: {
            academic: { filterWeek: 1, filterStatus: 'active' },
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
        // Shared across curriculum modules
        currentWeek: 1,
        // Grades
        grade: { currentWeek: 1, selectedStudentId: null },
        // Ranking
        ranking: { currentWeek: 1 },
        // Class View
        classView: { currentWeek: 1, filterDiscipline: 'all' },
        // Instructor Calendar
        instructorCalendar: { currentWeek: 1, selectedInstructorId: null, expandedGroups: {} },
        // Student Schedule
        studentSchedule: { currentWeek: 1, selectedStudentId: null },
        // Auto Groups
        autoGroups: { expanded: {} }
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
        panY: 0
    },

    // Character Detail
    characterDetail: {
        characterId: null,
        activeTab: 'name'
    }
};

// Make globally available
window.AppState = AppState;

// Convenience getters/setters
function getState(module, key) {
    if (AppState[module] && AppState[module][key] !== undefined) {
        return AppState[module][key];
    }
    return undefined;
}

function setState(module, key, value) {
    if (AppState[module]) {
        AppState[module][key] = value;
    }
}

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

// Export to window
window.getState = getState;
window.setState = setState;
window.getCurriculumState = getCurriculumState;
window.getCharacterState = getCharacterState;
window.getTeamState = getTeamState;
window.getTournamentState = getTournamentState;
window.getSocialState = getSocialState;

console.log('state.js loaded');