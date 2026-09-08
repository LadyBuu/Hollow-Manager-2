/**
 * shared/queries/mission-queries.js - Mission Queries
 * Read-only mission domain queries
 * Path: js/shared/queries/mission-queries.js
 * 
 * This module provides READ-ONLY access to mission data.
 * All mutations go through missions-core.js
 * 
 * OWNERSHIP: Mission domain
 * DEPENDENCIES: None (reads from window.data directly)
 * 
 * IMPORTANT: All getters return DEFENSIVE COPIES (clones)
 * to prevent external mutation of mission data.
 */

(function() {
    'use strict';

    if (window.__missionQueriesLoaded) return;
    window.__missionQueriesLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function normaliseId(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') return value;
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) {}
        }
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function getDataStore() {
        return window.data || {};
    }

    function getMissionArray() {
        var data = getDataStore();
        return Array.isArray(data.missions) ? data.missions : [];
    }

    // ============================================================
    // MISSION LOOKUP
    // ============================================================

    function getMission(missionId) {
        if (!isNonEmptyString(missionId)) return null;
        var target = normaliseId(missionId);
        var missions = getMissionArray();

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!m) continue;
            if (normaliseId(m.id) === target || normaliseId(m.missionId) === target) {
                return deepClone(m);
            }
        }
        return null;
    }

    function getMissions(filter) {
        var missions = getMissionArray();
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!m) continue;

            if (filter === 'active' && m.status !== 'active') continue;
            if (filter === 'completed' && m.status !== 'completed') continue;
            if (filter === 'cancelled' && m.status !== 'cancelled') continue;

            result.push(deepClone(m));
        }

        // Sort by creation date (newest first)
        result.sort(function(a, b) {
            var dateA = a.createdAt || '';
            var dateB = b.createdAt || '';
            return dateB.localeCompare(dateA);
        });

        return result;
    }

    function getActiveMissions() {
        return getMissions('active');
    }

    function getCompletedMissions() {
        return getMissions('completed');
    }

    function getCancelledMissions() {
        return getMissions('cancelled');
    }

    // ============================================================
    // MISSION BY TEAM
    // ============================================================

    function getMissionsByTeam(teamId, filter) {
        if (!isNonEmptyString(teamId)) return [];

        var missions = getMissions(filter);
        var target = normaliseId(teamId);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m && normaliseId(m.assignedTeamId) === target) {
                result.push(m);
            }
        }

        return result;
    }

    function getMissionsForCharacter(characterId) {
        if (!isNonEmptyString(characterId)) return [];

        // Get all missions and check if character is support personnel
        var missions = getMissions('all');
        var target = normaliseId(characterId);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!m) continue;

            var support = Array.isArray(m.supportPersonnel) ? m.supportPersonnel : [];
            for (var j = 0; j < support.length; j++) {
                if (normaliseId(support[j]) === target) {
                    result.push(m);
                    break;
                }
            }
        }

        return result;
    }

    // ============================================================
    // MISSION BY TYPE
    // ============================================================

    function getMissionsByType(typeId, filter) {
        if (!isNonEmptyString(typeId)) return [];

        var missions = getMissions(filter);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!m) continue;

            if (m.primaryType === typeId || m.secondaryType === typeId) {
                result.push(m);
            }
        }

        return result;
    }

    function getMissionsByTag(tag, filter) {
        if (!isNonEmptyString(tag)) return [];

        var missions = getMissions(filter);
        var searchTag = tag.toLowerCase().trim();
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!m || !Array.isArray(m.tags)) continue;

            var found = false;
            for (var j = 0; j < m.tags.length; j++) {
                if (typeof m.tags[j] === 'string' && m.tags[j].toLowerCase().trim() === searchTag) {
                    found = true;
                    break;
                }
            }

            if (found) {
                result.push(m);
            }
        }

        return result;
    }

    // ============================================================
    // MISSION SEARCH
    // ============================================================

    function searchMissions(query, filter) {
        if (!query || typeof query !== 'string') return getMissions(filter);

        var searchTerm = query.toLowerCase().trim();
        if (!searchTerm) return getMissions(filter);

        var missions = getMissions(filter);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!m) continue;

            var title = (m.title || '').toLowerCase();
            var description = (m.description || '').toLowerCase();
            var notes = (m.notes || '').toLowerCase();
            var missionId = (m.missionId || '').toLowerCase();
            var location = (m.location || '').toLowerCase();

            if (title.indexOf(searchTerm) !== -1 ||
                description.indexOf(searchTerm) !== -1 ||
                notes.indexOf(searchTerm) !== -1 ||
                missionId.indexOf(searchTerm) !== -1 ||
                location.indexOf(searchTerm) !== -1) {
                result.push(m);
            }
        }

        return result;
    }

    // ============================================================
    // SUPPORT PERSONNEL
    // ============================================================

    function getSupportPersonnel(mission) {
        var missionObj = typeof mission === 'string' ? getMission(mission) : mission;
        if (!missionObj) return [];

        var supportIds = Array.isArray(missionObj.supportPersonnel) ? missionObj.supportPersonnel : [];
        var result = [];

        for (var i = 0; i < supportIds.length; i++) {
            var character = window.CharacterQueries ?
                window.CharacterQueries.getCharacterById(supportIds[i]) : null;
            if (character) {
                result.push(character);
            }
        }

        return result;
    }

    function getSupportPersonnelNames(mission) {
        var characters = getSupportPersonnel(mission);
        var names = [];

        for (var i = 0; i < characters.length; i++) {
            var name = window.CharacterQueries ?
                window.CharacterQueries.getDisplayName(characters[i]) :
                characters[i].firstName || 'Unknown';
            names.push(name);
        }

        return names;
    }

    // ============================================================
    // MISSION STATISTICS
    // ============================================================

    function getActiveCount() {
        var missions = getMissions('all');
        var count = 0;

        for (var i = 0; i < missions.length; i++) {
            if (missions[i].status === 'active') count++;
        }

        return count;
    }

    function getCompletedCount() {
        var missions = getMissions('all');
        var count = 0;

        for (var i = 0; i < missions.length; i++) {
            if (missions[i].status === 'completed') count++;
        }

        return count;
    }

    function getCancelledCount() {
        var missions = getMissions('all');
        var count = 0;

        for (var i = 0; i < missions.length; i++) {
            if (missions[i].status === 'cancelled') count++;
        }

        return count;
    }

    function getStatistics() {
        var allMissions = getMissions('all');
        var stats = {
            total: allMissions.length,
            active: 0,
            completed: 0,
            cancelled: 0,
            byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
            byDifficulty: { easy: 0, medium: 0, hard: 0, expert: 0 }
        };

        for (var i = 0; i < allMissions.length; i++) {
            var m = allMissions[i];
            if (!m) continue;

            if (m.status === 'active') stats.active++;
            else if (m.status === 'completed') stats.completed++;
            else if (m.status === 'cancelled') stats.cancelled++;

            if (m.priority && stats.byPriority[m.priority] !== undefined) {
                stats.byPriority[m.priority]++;
            }

            if (m.difficulty && stats.byDifficulty[m.difficulty] !== undefined) {
                stats.byDifficulty[m.difficulty]++;
            }
        }

        return stats;
    }

    // ============================================================
    // TEAM ELIGIBILITY (Mission-specific)
    // ============================================================

    function getEligibleTeams() {
        var teams = window.TeamQueries ?
            window.TeamQueries.getTeams() : [];

        var result = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team) continue;

            // Only Professional and Temporary teams can be assigned missions
            if (team.type !== 'professional' && team.type !== 'temporary') continue;
            if (team.status !== 'active') continue;

            result.push(team);
        }

        return result;
    }

    function isTeamEligibleForMission(team) {
        if (!team) return false;
        if (team.type !== 'professional' && team.type !== 'temporary') return false;
        if (team.status !== 'active') return false;
        return true;
    }

    // ============================================================
    // UNIQUE TAGS
    // ============================================================

    function getUniqueTags(filter) {
        var missions = getMissions(filter);
        var tagSet = {};

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!m || !Array.isArray(m.tags)) continue;

            for (var j = 0; j < m.tags.length; j++) {
                var tag = m.tags[j];
                if (typeof tag === 'string' && tag.trim()) {
                    tagSet[tag.trim().toLowerCase()] = true;
                }
            }
        }

        var result = Object.keys(tagSet);
        result.sort();
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionQueries = {
        // Mission lookup
        getMission: getMission,
        getMissions: getMissions,
        getActiveMissions: getActiveMissions,
        getCompletedMissions: getCompletedMissions,
        getCancelledMissions: getCancelledMissions,

        // By team
        getMissionsByTeam: getMissionsByTeam,
        getMissionsForCharacter: getMissionsForCharacter,

        // By type
        getMissionsByType: getMissionsByType,
        getMissionsByTag: getMissionsByTag,

        // Search
        searchMissions: searchMissions,

        // Support personnel
        getSupportPersonnel: getSupportPersonnel,
        getSupportPersonnelNames: getSupportPersonnelNames,

        // Statistics
        getActiveCount: getActiveCount,
        getCompletedCount: getCompletedCount,
        getCancelledCount: getCancelledCount,
        getStatistics: getStatistics,

        // Team eligibility
        getEligibleTeams: getEligibleTeams,
        isTeamEligibleForMission: isTeamEligibleForMission,

        // Tags
        getUniqueTags: getUniqueTags
    };

})();
