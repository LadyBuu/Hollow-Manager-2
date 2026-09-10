/**
 * shared/queries/character-queries.js - Character Queries
 * Read-only character domain queries
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - No dependencies on other modules
 *   - Reads from window.data directly
 * 
 * DEATH MODEL:
 *   - Death is TIME-DEPENDENT, not a stored boolean
 *   - char.deathYear stores the year of death (empty if alive)
 *   - char.deathWeek stores the week of death (optional)
 *   - char.deceased is a CACHED value equal to isDeceased(char, currentYear)
 *   - Consumers should call isDeceased() for correctness
 *   - The raw char.deceased field exists for legacy compatibility
 * 
 * DISPLAY NAME MODEL:
 *   - If char.displayParts is present, use the checkbox-driven order:
 *       First Nickname Middle Last (Alias)
 *   - Otherwise fall back to char.nameFormat (legacy)
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state)
 */

(function() {
    'use strict';

    if (window.__characterQueriesLoaded) { return; }
    window.__characterQueriesLoaded = true;

    // ============================================================
    // DATA ACCESS
    // ============================================================

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

    // ============================================================
    // DISPLAY NAME
    // ============================================================

    /**
     * Get the display name for a character.
     * 
     * Uses displayParts if present on the character:
     *   First Nickname Middle Last (Alias)
     * 
     * Falls back to the legacy nameFormat switch if displayParts is
     * missing entirely, so existing characters keep displaying as before.
     * 
     * If all displayParts are false, falls back to firstName + lastName
     * so we never render a blank name.
     * 
     * @param {object} char - Character object
     * @returns {string} Display name
     */
    function getDisplayName(char) {
        if (!char || typeof char !== 'object') { return 'Unknown'; }

        var firstName  = String(char.firstName  || '').trim();
        var middleName = String(char.middleName || '').trim();
        var lastName   = String(char.lastName   || '').trim();
        var nickname   = String(char.nickname   || '').trim();
        var alias      = String(char.alias      || '').trim();

        // ---- If displayParts exists, use it ----
        if (char.displayParts && typeof char.displayParts === 'object') {
            var parts = [];

            if (char.displayParts.first !== false && firstName) {
                parts.push(firstName);
            }
            if (char.displayParts.nickname === true && nickname) {
                parts.push(nickname);
            }
            if (char.displayParts.middle !== false && middleName) {
                parts.push(middleName);
            }
            if (char.displayParts.last !== false && lastName) {
                parts.push(lastName);
            }

            var name = parts.join(' ');

            if (char.displayParts.alias === true && alias) {
                name = name ? name + ' (' + alias + ')' : '(' + alias + ')';
            }

            // Fallback: nothing checked or nothing populated
            if (!name) {
                name = [firstName, lastName].filter(Boolean).join(' ');
            }

            return name || 'Unknown';
        }

        // ---- Legacy path: nameFormat ----
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
                return firstName
                    ? firstName + ' "' + nickname + '"' + (lastName ? ' ' + lastName : '')
                    : '"' + nickname + '"' + (lastName ? ' ' + lastName : '');
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

    // ============================================================
    // TIME
    // ============================================================

    function getCurrentYear() {
        if (window.data && typeof window.data.currentYear === 'number') {
            return window.data.currentYear;
        }
        return new Date().getFullYear();
    }

    function getCurrentWeek() {
        if (window.data && typeof window.data.currentWeek === 'number') {
            return window.data.currentWeek;
        }
        return 1;
    }

    // ============================================================
    // DEATH QUERIES
    // ============================================================

    /**
     * Check if a character is dead as of a given year (and week).
     * 
     * Rules:
     *   - No deathYear → always alive
     *   - deathYear set → dead from that year onward
     *   - deathYear + deathWeek set + same year → dead from that week onward
     * 
     * @param {object} char - Character object
     * @param {number} [year] - Year to check (defaults to current)
     * @param {number} [week] - Week to check (defaults to current)
     * @returns {boolean} True if the character is dead as of that year/week
     */
    function isDeceased(char, year, week) {
        if (!char || typeof char !== 'object') { return false; }

        var deathYearRaw = char.deathYear;
        if (deathYearRaw === undefined || deathYearRaw === null || String(deathYearRaw).trim() === '') {
            return false;
        }

        var deathYear = parseInt(deathYearRaw, 10);
        if (isNaN(deathYear)) { return false; }

        var checkYear = (typeof year === 'number' && isFinite(year))
            ? year
            : getCurrentYear();

        if (checkYear < deathYear) { return false; }
        if (checkYear > deathYear) { return true; }

        // Same year - check week if available
        var deathWeekRaw = char.deathWeek;
        if (deathWeekRaw === undefined || deathWeekRaw === null || String(deathWeekRaw).trim() === '') {
            return true;
        }

        var deathWeek = parseInt(deathWeekRaw, 10);
        if (isNaN(deathWeek)) { return true; }

        var checkWeek = (typeof week === 'number' && isFinite(week))
            ? week
            : getCurrentWeek();

        return checkWeek >= deathWeek;
    }

    /**
     * Inverse of isDeceased.
     * 
     * @param {object} char - Character object
     * @param {number} [year] - Year to check (defaults to current)
     * @param {number} [week] - Week to check (defaults to current)
     * @returns {boolean} True if the character is alive as of that year/week
     */
    function isAlive(char, year, week) {
        return !isDeceased(char, year, week);
    }

    /**
     * Check if a character has a death record (regardless of current year).
     * Useful for form editing: "has the user declared this character dead?"
     * 
     * @param {object} char - Character object
     * @returns {boolean} True if the character has a deathYear
     */
    function hasDeathRecord(char) {
        if (!char || typeof char !== 'object') { return false; }
        var deathYearRaw = char.deathYear;
        if (deathYearRaw === undefined || deathYearRaw === null) { return false; }
        if (String(deathYearRaw).trim() === '') { return false; }
        return true;
    }

    // ============================================================
    // AGE
    // ============================================================

    /**
     * Calculate the age of a character as of a given year.
     * 
     * If the character is dead as of the given year, age is derived
     * from deathYear (preferred) or explicit deathAge.
     * If alive, age is birthYear to checkYear.
     * 
     * @param {object} char - Character object
     * @param {number} [year] - Year to compute age for (defaults to current)
     * @returns {number|null} Age in years or null if undeterminable
     */
    function calculateAge(char, year) {
        if (!char || typeof char !== 'object') { return null; }

        var birthYear = parseInt(char.birthYear, 10);
        if (isNaN(birthYear)) { return null; }

        var checkYear = (typeof year === 'number' && isFinite(year))
            ? year
            : getCurrentYear();

        if (birthYear > checkYear) { return null; }

        // If dead as of the check year, use death-derived age
        if (isDeceased(char, checkYear)) {
            var deathAge = parseInt(char.deathAge, 10);
            if (!isNaN(deathAge)) { return deathAge; }

            var deathYear = parseInt(char.deathYear, 10);
            if (!isNaN(deathYear)) {
                if (deathYear < birthYear) { return null; }
                return deathYear - birthYear;
            }

            return null;
        }

        return checkYear - birthYear;
    }

    function getCharacterAge(char, year) {
        var age = calculateAge(char, year);
        return age !== null ? age + ' yrs' : '-';
    }

    // ============================================================
    // STATUS
    // ============================================================

    /**
     * Get the character's current career status.
     * NOTE: This does NOT consult isDeceased. A dead instructor is still
     * an instructor by career. Callers that want "alive and instructing"
     * should combine this with isAlive().
     */
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
        var status = getCurrentStatus(char).toLowerCase();
        return status === 'trainee' || status === 'rookie' || status === 'junior' || status === 'student';
    }

    function isInstructor(char) {
        if (!char || typeof char !== 'object') { return false; }
        var status = getCurrentStatus(char).toLowerCase();
        return status === 'instructor' || status === 'teacher' || status === 'professor' || status === 'senior';
    }

    function isCivilian(char) {
        if (!char || typeof char !== 'object') { return false; }
        return getCurrentStatus(char).toLowerCase() === 'civilian';
    }

    // ============================================================
    // LIST QUERIES
    // ============================================================

    function getCharacters() { return getCharacterData().slice(); }

    /**
     * Get all students.
     * NOTE: Does NOT filter by alive/dead. A student who is currently dead
     * is still a student by career. Callers that want "alive students"
     * should filter with isAlive().
     */
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

    /**
     * Get all instructors.
     * NOTE: Does NOT filter by alive/dead. See getStudents() note.
     */
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
            if (c && typeof c === 'object' && !isCivilian(c)) {
                result.push(c);
            }
        }
        return result.sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    // ============================================================
    // STATS
    // ============================================================

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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterQueries = {
        // Core lookup
        getCharacterById: getCharacterById,
        getCharacterNameById: getCharacterNameById,

        // Display name
        getDisplayName: getDisplayName,
        getFullName: getFullName,
        getNicknameOrFirstName: getNicknameOrFirstName,

        // Time
        getCurrentYear: getCurrentYear,
        getCurrentWeek: getCurrentWeek,

        // Death
        isDeceased: isDeceased,
        isAlive: isAlive,
        hasDeathRecord: hasDeathRecord,

        // Age
        calculateAge: calculateAge,
        getCharacterAge: getCharacterAge,

        // Status
        getCurrentStatus: getCurrentStatus,
        isStudent: isStudent,
        isInstructor: isInstructor,
        isCivilian: isCivilian,

        // Lists
        getCharacters: getCharacters,
        getStudents: getStudents,
        getInstructors: getInstructors,
        getNonCivilianCharacters: getNonCivilianCharacters,

        // Stats
        getCharacterStats: getCharacterStats
    };

})();