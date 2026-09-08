/**
 * shared/queries/character-queries.js - Character Queries
 * Read-only character domain queries
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - No dependencies on other modules
 *   - Reads from window.data directly
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state)
 */

(function() {
    'use strict';

    if (window.__characterQueriesLoaded) { return; }
    window.__characterQueriesLoaded = true;

    function getCharacterData() {
        var data = window.data || {};
        return Array.isArray(data.characters) ? data.characters : [];
    }

    function getCharacterById(charId) {
        if (!charId) { return null; }
        var target = String(charId);
        var chars = getCharacterData();
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (c && typeof c === 'object' && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    function getCharacterNameById(charId) {
        if (!charId) { return 'Unknown'; }
        var char = getCharacterById(charId);
        return char ? getDisplayName(char) : 'Unknown';
    }

    function getDisplayName(char) {
        if (!char || typeof char !== 'object') { return 'Unknown'; }
        var firstName = String(char.firstName || '').trim();
        var lastName = String(char.lastName || '').trim();
        var middleName = String(char.middleName || '').trim();
        var nickname = String(char.nickname || '').trim();
        var alias = String(char.alias || '').trim();
        var format = char.nameFormat || 'firstlast';

        switch (format) {
            case 'lastfirst':
                if (lastName && firstName) { return lastName + ', ' + firstName; }
                return lastName || firstName || 'Unknown';
            case 'nicklast':
                return [nickname || firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
            case 'firstnick':
                if (!firstName && !nickname) { return lastName || 'Unknown'; }
                if (!nickname) { return [firstName, lastName].filter(Boolean).join(' '); }
                return firstName ? firstName + ' "' + nickname + '"' + (lastName ? ' ' + lastName : '') : '"' + nickname + '"' + (lastName ? ' ' + lastName : '');
            case 'alias':
                return alias || [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
            case 'firstlast':
            default:
                return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
        }
    }

    function getFullName(char) {
        if (!char || typeof char !== 'object') { return 'Unknown'; }
        var parts = [char.firstName, char.middleName, char.lastName].filter(function(part) {
            return part !== undefined && part !== null && String(part).trim() !== '';
        }).map(function(part) { return String(part).trim(); });
        return parts.length ? parts.join(' ') : 'Unknown';
    }

    function getNicknameOrFirstName(char) {
        if (!char || typeof char !== 'object') { return 'Unknown'; }
        var nickname = String(char.nickname || '').trim();
        var firstName = String(char.firstName || '').trim();
        return nickname || firstName || 'Unknown';
    }

    function getCurrentYear() {
        if (window.data && typeof window.data.currentYear === 'number') {
            return window.data.currentYear;
        }
        return new Date().getFullYear();
    }

    function calculateAge(char) {
        if (!char || typeof char !== 'object') { return null; }
        var birthYear = parseInt(char.birthYear, 10);
        if (isNaN(birthYear)) { return null; }
        var currentYear = getCurrentYear();
        if (birthYear > currentYear) { return null; }
        if (char.deceased) {
            var deathAge = parseInt(char.deathAge, 10);
            if (!isNaN(deathAge)) { return deathAge; }
            var deathYear = parseInt(char.deathYear, 10);
            if (!isNaN(deathYear)) {
                if (deathYear < birthYear) { return null; }
                return deathYear - birthYear;
            }
            return null;
        }
        return currentYear - birthYear;
    }

    function getCharacterAge(char) {
        var age = calculateAge(char);
        return age !== null ? age + ' yrs' : '-';
    }

    function getCurrentStatus(char) {
        if (!char || !char.careerStatus || char.careerStatus.length === 0) {
            return 'Civilian';
        }
        var currentYear = getCurrentYear();
        var bestStatus = 'Civilian';
        var bestScore = { isActive: false, endYear: -Infinity, startYear: -Infinity, index: Infinity };

        char.careerStatus.forEach(function(status, index) {
            if (!status || !status.status) { return; }
            var start = parseInt(status.startYear, 10);
            if (isNaN(start) || start > currentYear) { return; }
            var end = parseInt(status.endYear, 10);
            var isActive = isNaN(end) || currentYear <= end;
            var endYear = isNaN(end) ? Infinity : end;

            var isBetter = false;
            if (isActive !== bestScore.isActive) {
                isBetter = isActive;
            } else if (endYear !== bestScore.endYear) {
                isBetter = endYear > bestScore.endYear;
            } else if (start !== bestScore.startYear) {
                isBetter = start > bestScore.startYear;
            } else {
                isBetter = index < bestScore.index;
            }

            if (isBetter) {
                bestScore = { isActive: isActive, endYear: endYear, startYear: start, index: index };
                var statusName = String(status.status);
                bestStatus = statusName.charAt(0).toUpperCase() + statusName.slice(1);
            }
        });

        if (bestScore.isActive) { return bestStatus; }
        if (bestScore.endYear > -Infinity) { return bestStatus + ' (Former)'; }
        return 'Civilian';
    }

    function isStudent(char) {
        if (!char || typeof char !== 'object') { return false; }
        if (char.deceased) { return false; }
        var status = getCurrentStatus(char).toLowerCase();
        return status === 'trainee' || status === 'rookie' || status === 'junior' || status === 'student';
    }

    function isInstructor(char) {
        if (!char || typeof char !== 'object') { return false; }
        if (char.deceased) { return false; }
        var status = getCurrentStatus(char).toLowerCase();
        return status === 'instructor' || status === 'teacher' || status === 'professor' || status === 'senior';
    }

    function isCivilian(char) {
        if (!char || typeof char !== 'object') { return false; }
        if (char.deceased) { return false; }
        return getCurrentStatus(char).toLowerCase() === 'civilian';
    }

    function getCharacters() { return getCharacterData().slice(); }

    function getStudents() {
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (isStudent(c)) { result.push(c); }
        }
        return result.sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    function getInstructors() {
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (isInstructor(c)) { result.push(c); }
        }
        return result.sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    function getNonCivilianCharacters() {
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (c && typeof c === 'object' && !c.deceased && !isCivilian(c)) {
                result.push(c);
            }
        }
        return result.sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    function getCharacterStats(char) {
        if (!char) { return createDefaultStats(); }
        if (!char.stats || typeof char.stats !== 'object') { return createDefaultStats(); }
        var stats = char.stats;
        var result = {};
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        statKeys.forEach(function(key) {
            var val = stats[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = val;
            } else {
                result[key] = 10;
            }
        });
        return result;
    }

    function createDefaultStats() {
        var result = {};
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        statKeys.forEach(function(key) { result[key] = 10; });
        return result;
    }

    window.CharacterQueries = {
        getCharacterById: getCharacterById,
        getCharacterNameById: getCharacterNameById,
        getDisplayName: getDisplayName,
        getFullName: getFullName,
        getNicknameOrFirstName: getNicknameOrFirstName,
        calculateAge: calculateAge,
        getCharacterAge: getCharacterAge,
        getCurrentYear: getCurrentYear,
        getCurrentStatus: getCurrentStatus,
        isStudent: isStudent,
        isInstructor: isInstructor,
        isCivilian: isCivilian,
        getCharacters: getCharacters,
        getStudents: getStudents,
        getInstructors: getInstructors,
        getNonCivilianCharacters: getNonCivilianCharacters,
        getCharacterStats: getCharacterStats
    };

})();
