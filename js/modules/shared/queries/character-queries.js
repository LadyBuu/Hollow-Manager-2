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
 *   The predicate is distinct from isSenior(char), which would
 *   answer "is this character senior right now?" against the
 *   current year. isSeniorByYear is the explicit, year-scoped
 *   form.
 *
 * JUNIOR-OR-SENIOR-BY-YEAR:
 *   isJuniorOrSeniorByYear(char, year) answers "has this character
 *   reached junior OR senior status as of year Y?" Professional
 *   teams accept juniors and seniors alike; the matchmaking pool
 *   and the professional-team-eligible roster projection both use
 *   this predicate.
 *
 *   The rule is the same as isSeniorByYear, broadened to accept
 *   either status string. A blank startYear passes. A startYear
 *   after Y does not count.
 *
 * CAREER STATUS YEAR:
 *   getJuniorYear(char) and getSeniorYear(char) return the
 *   earliest startYear across entries with the matching status,
 *   or null. They exist for display: the Unassigned view in the
 *   Teams tab shows both years side by side.
 *
 * STATUS-AT-YEAR:
 *   getStatusAtYear(char, year) answers "what career status did
 *   this character hold at year Y?" by walking char.careerStatus
 *   and picking the entry whose [startYear, endYear] window
 *   contains Y. When multiple entries overlap, the same
 *   tie-breaking rule getCurrentStatus uses is applied: prefer an
 *   active entry, then the latest endYear, then the latest
 *   startYear.
 *
 *   Unlike getCurrentStatus, this function does NOT append a
 *   " (Former)" suffix. The suffix exists because at a single
 *   point in time, "they held this status but it has ended" is
 *   useful information. Across a year-scoped query, the framing
 *   changes: at year Y, the character either held a status or
 *   did not. A year that falls inside a status window returns
 *   the bare status name; a year outside all windows returns
 *   'Civilian' (the same fallback getCurrentStatus uses when no
 *   entry matches).
 *
 *   Callers that want a tier ('student' | 'instructor' |
 *   'support') pass the result through
 *   CharacterConstants.classifyStatus.
 *
 *   Usage:
 *     var status = CharacterQueries.getStatusAtYear(char, 1915);
 *     var tier   = CharacterConstants.classifyStatus(status);
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

    /**
     * Get the character's current career status.
     *
     * Reads char.careerStatus and picks the best-matching entry
     * against window.data.currentYear. When the winning entry has
     * ended, appends ' (Former)' so the caller can distinguish
     * "senior" from "was a senior, now not".
     *
     * See getStatusAtYear for the year-scoped variant.
     *
     * @param {object} char
     * @returns {string} Display status
     */
    function getCurrentStatus(char) {
        return getStatusAtYearInternal(char, getCurrentYear(), true);
    }

    /**
     * Get the character's career status as of a specific year.
     *
     * Unlike getCurrentStatus, this function does NOT append a
     * ' (Former)' suffix. The suffix exists because at a single
     * point in time, "they held this status but it has ended" is
     * useful information. Across a year-scoped query, the framing
     * changes: at year Y, the character either held a status or
     * did not.
     *
     * Returns 'Civilian' when no careerStatus entry covers the
     * year, which is the same fallback getCurrentStatus uses.
     *
     * @param {object} char
     * @param {number|string} year
     * @returns {string} Display status at that year
     */
    function getStatusAtYear(char, year) {
        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) {
            return 'Civilian';
        }
        return getStatusAtYearInternal(char, yearNum, false);
    }

    /**
     * Shared implementation for getCurrentStatus and getStatusAtYear.
     *
     * The two callers differ only in the year they pass and whether
     * the ' (Former)' suffix is appended. The tie-breaking logic is
     * identical.
     *
     * PICKING RULE:
     *   Among all entries whose [startYear, endYear] window contains
     *   the given year, pick:
     *     1. an entry with no endYear (currently active at that year)
     *     2. otherwise, the entry with the latest endYear
     *     3. otherwise, the entry with the latest startYear
     *     4. otherwise, the lowest index in char.careerStatus
     *
     *   Entries whose startYear is blank are treated as "active
     *   since the beginning of time" and are included in the window
     *   check. Entries whose startYear is malformed are skipped.
     *
     *   Entries whose startYear is strictly after the given year are
     *   excluded — a character who becomes an instructor in 1915
     *   was not an instructor in 1905.
     *
     * SUFFIX BEHAVIOUR (appendFormer):
     *   When appendFormer is true and the winning entry has a
     *   non-blank endYear that is strictly before the check year,
     *   the return value is `Status + ' (Former)'`. When
     *   appendFormer is false, the bare status is returned
     *   regardless.
     *
     *   The check is `endYear < year`, not `endYear <= year`. An
     *   entry that ends in year Y is still held during Y.
     *
     * @param {object} char
     * @param {number} yearNum
     * @param {boolean} appendFormer
     * @returns {string}
     */
    function getStatusAtYearInternal(char, yearNum, appendFormer) {
        if (!char || !char.careerStatus || char.careerStatus.length === 0) {
            return 'Civilian';
        }

        var bestStatus = null;
        var bestScore = null;

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }
            if (!entry.status) { continue; }

            // Parse start year. Blank is treated as "since the
            // beginning of time" for the window check below.
            var startRaw = entry.startYear;
            var startNum = null;
            if (startRaw !== undefined &&
                startRaw !== null &&
                String(startRaw).trim() !== '') {
                startNum = parseInt(startRaw, 10);
                if (isNaN(startNum)) {
                    // Malformed start year: skip. The alternative
                    // would be to silently treat a typo as "since
                    // the beginning of time", which would silently
                    // include the entry in every query.
                    continue;
                }
            }

            // Exclude entries that begin after the query year.
            // A character who becomes an instructor in 1915 was
            // not an instructor in 1905.
            if (startNum !== null && startNum > yearNum) {
                continue;
            }

            // Parse end year. Blank means "still active".
            var endRaw = entry.endYear;
            var endNum = null;
            if (endRaw !== undefined &&
                endRaw !== null &&
                String(endRaw).trim() !== '') {
                endNum = parseInt(endRaw, 10);
                if (isNaN(endNum)) {
                    endNum = null;
                }
            }

            // Exclude entries that ended before the query year.
            // endYear < yearNum, not <=: an entry that ends in
            // year Y is still held during Y.
            if (endNum !== null && endNum < yearNum) {
                continue;
            }

            // Score this entry for the tie-break.
            var score = {
                isActive: endNum === null,
                endYear: endNum === null ? Infinity : endNum,
                startYear: startNum === null ? 0 : startNum,
                index: i
            };

            var better = false;
            if (!bestScore) {
                better = true;
            } else if (score.isActive !== bestScore.isActive) {
                better = score.isActive;
            } else if (score.endYear !== bestScore.endYear) {
                better = score.endYear > bestScore.endYear;
            } else if (score.startYear !== bestScore.startYear) {
                better = score.startYear > bestScore.startYear;
            } else {
                better = score.index < bestScore.index;
            }

            if (better) {
                bestScore = score;
                var statusName = String(entry.status);
                bestStatus = statusName.charAt(0).toUpperCase() +
                             statusName.slice(1);
            }
        }

        if (!bestStatus) {
            return 'Civilian';
        }

        if (appendFormer &&
            bestScore &&
            bestScore.endYear !== Infinity &&
            bestScore.endYear < yearNum) {
            return bestStatus + ' (Former)';
        }

        return bestStatus;
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
    // CAREER STATUS BY YEAR
    // ============================================================
    //
    // These three predicates answer "has this character reached the
    // named status as of year Y?" by walking char.careerStatus.
    //
    // A blank startYear on a matching entry is treated as "in this
    // status from the beginning of time" and passes. This is a
    // data-quality signal, not a filter reason.
    //
    // An entry whose startYear is after Y does NOT count. A
    // character who becomes senior in 1919 is not senior in 1918.
    //
    // Returns false when:
    //   - char is missing or malformed
    //   - year is not a positive integer
    //   - char.careerStatus is not an array
    //   - there is no matching entry with startYear <= year

    function isStatusByYear(char, year, statusName) {
        if (!char || typeof char !== 'object') { return false; }

        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) { return false; }

        if (!Array.isArray(char.careerStatus)) { return false; }

        var target = String(statusName).trim().toLowerCase();

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }
            if (typeof entry.status !== 'string') { continue; }

            var statusStr = entry.status.trim().toLowerCase();
            if (statusStr !== target) { continue; }

            // Blank startYear: in this status from the beginning of
            // time.
            var startRaw = entry.startYear;
            if (startRaw === undefined ||
                startRaw === null ||
                String(startRaw).trim() === '') {
                return true;
            }

            var startNum = parseInt(startRaw, 10);
            if (isNaN(startNum)) {
                // Malformed start year: treated like a blank. The
                // alternative would be to silently drop a character
                // whose entry has a typo in the year field.
                return true;
            }

            if (startNum <= yearNum) {
                return true;
            }
        }

        return false;
    }

    /**
     * Has this character reached senior status as of year Y?
     *
     * The predicate the matchmaking pool uses (and the senior
     * display in the Unassigned view reads via getSeniorYear).
     *
     * @param {object} char
     * @param {number|string} year
     * @returns {boolean}
     */
    function isSeniorByYear(char, year) {
        return isStatusByYear(char, year, 'senior');
    }

    /**
     * Has this character reached junior OR senior status as of year Y?
     *
     * Professional teams accept juniors and seniors alike. The
     * matchmaking pool and the professional-team-eligible roster
     * projection both use this predicate.
     *
     * @param {object} char
     * @param {number|string} year
     * @returns {boolean}
     */
    function isJuniorOrSeniorByYear(char, year) {
        if (isStatusByYear(char, year, 'junior')) { return true; }
        return isStatusByYear(char, year, 'senior');
    }

    // ============================================================
    // CAREER STATUS YEAR (DISPLAY)
    // ============================================================
    //
    // getJuniorYear and getSeniorYear return the earliest startYear
    // across entries with the matching status, or null. They exist
    // for display: the Unassigned view in the Teams tab shows both
    // years side by side.

    function getCareerStatusYear(char, statusName) {
        if (!char || typeof char !== 'object') { return null; }
        if (!Array.isArray(char.careerStatus)) { return null; }

        var target = String(statusName).trim().toLowerCase();
        var earliest = null;

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }
            if (typeof entry.status !== 'string') { continue; }

            var statusStr = entry.status.trim().toLowerCase();
            if (statusStr !== target) { continue; }

            var startRaw = entry.startYear;
            if (startRaw === undefined ||
                startRaw === null ||
                String(startRaw).trim() === '') {
                continue;
            }

            var startNum = parseInt(startRaw, 10);
            if (isNaN(startNum) || startNum < 1) { continue; }

            if (earliest === null || startNum < earliest) {
                earliest = startNum;
            }
        }

        return earliest;
    }

    function getJuniorYear(char) {
        return getCareerStatusYear(char, 'junior');
    }

    function getSeniorYear(char) {
        return getCareerStatusYear(char, 'senior');
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
        getStatusAtYear: getStatusAtYear,
        isStudent: isStudent,
        isInstructor: isInstructor,
        isSupport: isSupport,
        isCivilian: isCivilian,

        // Career-status-by-year predicates
        isSeniorByYear: isSeniorByYear,
        isJuniorOrSeniorByYear: isJuniorOrSeniorByYear,

        // Career-status year display
        getCareerStatusYear: getCareerStatusYear,
        getJuniorYear: getJuniorYear,
        getSeniorYear: getSeniorYear,

        // Lists
        getCharacters: getCharacters,
        getStudents: getStudents,
        getInstructors: getInstructors,
        getNonCivilianCharacters: getNonCivilianCharacters,

        // Stats
        getCharacterStats: getCharacterStats
    };

})();
