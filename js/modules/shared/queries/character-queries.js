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
 * DISCIPLINE ENROLLMENT:
 *   Enrollment is owned by AcademyEnrolments and is CLASS-SCOPED.
 *   It lives at academy.enrolments[classId][charId] = [disciplineId].
 *
 *   character.disciplineIds is dead. It is NOT read here. It is NOT
 *   written anywhere in the current codebase. Legacy records may
 *   still carry the field; nothing consumes it, and it disappears
 *   naturally as records are edited.
 *
 *   Callers that need a character's enrolled disciplines call
 *   AcademyEnrolments.getStudentDisciplines(charId, classId).
 *
 * STATUS TIERS:
 *   The canonical tier classifier is CharacterConstants.classifyStatus.
 *   It returns 'student', 'instructor', 'support', or null. The three
 *   tiers are disjoint and are enforced at CharacterConstants load.
 *
 *   This module's predicates (isStudent, isInstructor, isCivilian)
 *   delegate to CharacterConstants.classifyStatus. Reimplementing
 *   the tier logic here is what produced the "senior is an
 *   instructor" bug: the predicate's local string comparison did
 *   not match the canonical tier membership.
 *
 *   `senior` is a STUDENT status, not an instructor status. A
 *   senior is a final-year student, still enrolled, still
 *   participating in academic teams and exams. This was the bug.
 *
 *   `support` is its own tier: neither student nor instructor.
 *   Support staff (medics, technicians, administrative roles) are
 *   excluded from student-scoped and instructor-scoped queries
 *   alike. isCivilian does not report support as civilian; support
 *   is not civilian, it is support.
 *
 * SENIOR-BY-YEAR:
 *   isSeniorByYear(char, year) answers "has this character reached
 *   senior status as of year Y?" It reads char.careerStatus, looks
 *   for an entry whose status normalises to 'senior', and checks
 *   that entry's startYear is <= Y.
 *
 *   A blank startYear on a senior entry is treated as "senior from
 *   the beginning of time" and passes. This is a data-quality
 *   signal, not a filter reason.
 *
 *   A senior entry whose startYear is after Y does NOT count. A
 *   character who becomes senior in 1919 is not senior in 1918.
 *
 *   This is the predicate the matchmaking pool uses: professional
 *   teams only accept members who have reached senior status.
 *
 *   The predicate is distinct from isSenior(char), which would
 *   answer "is this character senior right now?" against the
 *   current year. isSeniorByYear is the explicit, year-scoped
 *   form.
 *
 * DEPENDENCIES:
 *   - window.data                 (canonical state)
 *   - window.CharacterConstants   (canonical status tiers; optional
 *                                  at load, with a hardcoded fallback
 *                                  that mirrors the canonical tiers)
 */

(function() {
    'use strict';

    if (window.__characterQueriesLoaded) { return; }
    window.__characterQueriesLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterConstants = window.CharacterConstants;

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

    function isAlive(char, year, week) {
        return !isDeceased(char, year, week);
    }

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

    function calculateAge(char, year) {
        if (!char || typeof char !== 'object') { return null; }

        var birthYear = parseInt(char.birthYear, 10);
        if (isNaN(birthYear)) { return null; }

        var checkYear = (typeof year === 'number' && isFinite(year))
            ? year
            : getCurrentYear();

        if (birthYear > checkYear) { return null; }

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

    // ============================================================
    // STATUS TIER CLASSIFICATION
    // ============================================================

    var FALLBACK_STUDENT = ['trainee', 'rookie', 'junior', 'senior', 'student'];
    var FALLBACK_INSTRUCTOR = ['instructor', 'teacher', 'professor'];
    var FALLBACK_SUPPORT = ['support'];

    /**
     * Classify a status string into a tier.
     *
     * Delegates to CharacterConstants.classifyStatus when available.
     * Falls back to a hardcoded classifier that mirrors the canonical
     * tier membership when the constants module has not loaded.
     *
     * A status string with a ' (Former)' suffix is classified by its
     * base tier. A former instructor is still classified as an
     * instructor. The tier describes what role the status string
     * names, not whether the role is current.
     *
     * @param {string} status
     * @returns {string|null} 'student' | 'instructor' | 'support' | null
     */
    function classifyStatusTier(status) {
        if (!status || typeof status !== 'string') { return null; }

        if (CharacterConstants &&
            typeof CharacterConstants.classifyStatus === 'function') {
            return CharacterConstants.classifyStatus(status);
        }

        var base = status.toLowerCase();
        var formerIndex = base.indexOf(' (former)');
        if (formerIndex !== -1) {
            base = base.substring(0, formerIndex).trim();
        }

        if (FALLBACK_STUDENT.indexOf(base) !== -1) { return 'student'; }
        if (FALLBACK_INSTRUCTOR.indexOf(base) !== -1) { return 'instructor'; }
        if (FALLBACK_SUPPORT.indexOf(base) !== -1) { return 'support'; }
        return null;
    }

    // ============================================================
    // STATUS PREDICATES
    // ============================================================

    function isStudent(char) {
        if (!char || typeof char !== 'object') { return false; }
        return classifyStatusTier(getCurrentStatus(char)) === 'student';
    }

    function isInstructor(char) {
        if (!char || typeof char !== 'object') { return false; }
        return classifyStatusTier(getCurrentStatus(char)) === 'instructor';
    }

    function isSupport(char) {
        if (!char || typeof char !== 'object') { return false; }
        return classifyStatusTier(getCurrentStatus(char)) === 'support';
    }

    function isCivilian(char) {
        if (!char || typeof char !== 'object') { return false; }
        return getCurrentStatus(char).toLowerCase() === 'civilian';
    }

    // ============================================================
    // SENIOR-BY-YEAR
    // ============================================================
    //
    // Answers "has this character reached senior status as of year
    // Y?" by walking char.careerStatus and looking for a senior
    // entry whose startYear <= Y.
    //
    // A blank startYear on a senior entry is treated as "senior from
    // the beginning of time" and passes. The blank is a
    // data-quality signal, not a filter reason.
    //
    // A senior entry whose startYear is after Y does NOT count.
    // A character who becomes senior in 1919 is not senior in 1918.
    //
    // Returns false when:
    //   - char is missing or malformed
    //   - year is not a positive integer
    //   - char.careerStatus is not an array
    //   - there is no senior entry with startYear <= year

    function isSeniorByYear(char, year) {
        if (!char || typeof char !== 'object') { return false; }

        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) { return false; }

        if (!Array.isArray(char.careerStatus)) { return false; }

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }
            if (typeof entry.status !== 'string') { continue; }

            var statusStr = entry.status.trim().toLowerCase();
            if (statusStr !== 'senior') { continue; }

            // Blank startYear: senior from the beginning of time.
            var startRaw = entry.startYear;
            if (startRaw === undefined ||
                startRaw === null ||
                String(startRaw).trim() === '') {
                return true;
            }

            var startNum = parseInt(startRaw, 10);
            if (isNaN(startNum)) {
                // Malformed start year: treated like a blank, i.e.
                // senior from the beginning of time. The alternative
                // would be to silently drop a character whose senior
                // entry has a typo in the year field.
                return true;
            }

            if (startNum <= yearNum) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // LIST QUERIES
    // ============================================================

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
        isSupport: isSupport,
        isCivilian: isCivilian,

        // Senior-by-year (matchmaking predicate)
        isSeniorByYear: isSeniorByYear,

        // Lists
        getCharacters: getCharacters,
        getStudents: getStudents,
        getInstructors: getInstructors,
        getNonCivilianCharacters: getNonCivilianCharacters,

        // Stats
        getCharacterStats: getCharacterStats
    };

})();
