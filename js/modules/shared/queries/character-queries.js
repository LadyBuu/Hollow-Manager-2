/**
 * shared/queries/character-queries.js - Character Queries
 * Read-only character domain queries.
 *
 * Path: js/shared/queries/character-queries.js
 *
 * WHAT THIS OWNS:
 *   - Character lookup by id (memoized).
 *   - Display name resolution.
 *   - Time (current year, current week).
 *   - Death, age.
 *   - Status (current, at year) and status-tier predicates.
 *   - Career-status-by-year predicates and year getters.
 *   - Phase eligibility (character-side only; team-aware
 *     eligibility lives in TeamQueries).
 *   - List queries.
 *
 * CHARACTER ID INDEX:
 *   A memoized Map<id, character> keyed by the live store. The
 *   index rebuilds when:
 *     - window.data.characters is a different array reference, or
 *     - its length differs, or
 *     - any indexed id no longer maps to the object at that position
 *       (slot replacement without invalidation).
 *
 *   The third check is a freshness self-heal. Slot replacement —
 *   writing a new object into chars[i] without changing the array
 *   or its length — would otherwise leave the index returning the
 *   old object and produce "edits don't persist after save" symptoms.
 *
 *   Mutation paths SHOULD still call invalidateCharacterIndex()
 *   after a slot replacement. The self-heal makes the call optional,
 *   not mandatory.
 *
 * STATUS TIERS:
 *   Delegates to CharacterConstants.classifyStatus, which returns
 *   'student' | 'instructor' | 'support' | null. `senior` is a
 *   student tier. `support` is its own tier. The tiers are disjoint.
 *
 * DEPENDENCIES:
 *   - window.data
 *   - window.CharacterConstants (optional at load; a hardcoded
 *     fallback mirrors the canonical tiers)
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

    // ============================================================
    // CHARACTER ID INDEX
    // ============================================================

    var _idIndex = null;
    var _idIndexSourceRef = null;
    var _idIndexSourceLength = -1;

    function getIdIndex() {
        var chars = getCharacterData();

        if (_idIndex !== null &&
            chars === _idIndexSourceRef &&
            chars.length === _idIndexSourceLength) {

            // Freshness self-heal: exit on the first stale slot.
            var fresh = true;
            for (var s = 0; s < chars.length; s++) {
                var c = chars[s];
                if (!c || typeof c !== 'object' ||
                    c.id === undefined || c.id === null) {
                    continue;
                }
                var key = String(c.id);
                var cached = _idIndex.get(key);
                if (cached !== undefined && cached !== c) {
                    fresh = false;
                    break;
                }
            }
            if (fresh) {
                return _idIndex;
            }
        }

        var map = new Map();
        for (var i = 0; i < chars.length; i++) {
            var ch = chars[i];
            if (ch && typeof ch === 'object' &&
                ch.id !== undefined && ch.id !== null) {
                map.set(String(ch.id), ch);
            }
        }

        _idIndex = map;
        _idIndexSourceRef = chars;
        _idIndexSourceLength = chars.length;
        return _idIndex;
    }

    function invalidateCharacterIndex() {
        _idIndex = null;
        _idIndexSourceRef = null;
        _idIndexSourceLength = -1;
    }

    function getCharacterById(charId) {
        if (!charId) { return null; }
        var idx = getIdIndex();
        var found = idx.get(String(charId));
        return found || null;
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

        // ---- displayParts shape ----
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
                name = name
                    ? name + ' (' + alias + ')'
                    : '(' + alias + ')';
            }

            if (!name) {
                name = [firstName, lastName]
                    .filter(Boolean)
                    .join(' ');
            }

            return name || 'Unknown';
        }

        // ---- Legacy nameFormat ----
        var format = char.nameFormat || 'firstlast';

        switch (format) {
            case 'lastfirst':
                if (lastName && firstName) {
                    return lastName + ', ' + firstName;
                }
                return lastName || firstName || 'Unknown';
            case 'nicklast':
                return [nickname || firstName, lastName]
                    .filter(Boolean)
                    .join(' ') || 'Unknown';
            case 'firstnick':
                if (!firstName && !nickname) {
                    return lastName || 'Unknown';
                }
                if (!nickname) {
                    return [firstName, lastName]
                        .filter(Boolean)
                        .join(' ');
                }
                return firstName
                    ? firstName + ' "' + nickname + '"' +
                        (lastName ? ' ' + lastName : '')
                    : '"' + nickname + '"' +
                        (lastName ? ' ' + lastName : '');
            case 'alias':
                return alias ||
                    [firstName, lastName].filter(Boolean).join(' ') ||
                    'Unknown';
            case 'firstlast':
            default:
                return [firstName, lastName]
                    .filter(Boolean)
                    .join(' ') || 'Unknown';
        }
    }

    function getFullName(char) {
        if (!char || typeof char !== 'object') { return 'Unknown'; }
        var parts = [char.firstName, char.middleName, char.lastName]
            .filter(function(part) {
                return part !== undefined &&
                    part !== null &&
                    String(part).trim() !== '';
            })
            .map(function(part) { return String(part).trim(); });
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
    // DEATH
    // ============================================================

    function isDeceased(char, year, week) {
        if (!char || typeof char !== 'object') { return false; }

        var deathYearRaw = char.deathYear;
        if (deathYearRaw === undefined ||
            deathYearRaw === null ||
            String(deathYearRaw).trim() === '') {
            return false;
        }

        var deathYear = parseInt(deathYearRaw, 10);
        if (isNaN(deathYear)) { return false; }

        var checkYear = (typeof year === 'number' && isFinite(year))
            ? year
            : getCurrentYear();

        if (checkYear < deathYear) { return false; }
        if (checkYear > deathYear) { return true; }

        // Same year: fall back to week if defined.
        var deathWeekRaw = char.deathWeek;
        if (deathWeekRaw === undefined ||
            deathWeekRaw === null ||
            String(deathWeekRaw).trim() === '') {
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
        if (deathYearRaw === undefined || deathYearRaw === null) {
            return false;
        }
        return String(deathYearRaw).trim() !== '';
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
            // Prefer the recorded death age. Falls back to deathYear
            // minus birthYear when deathAge is missing or malformed.
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
        return getStatusAtYearInternal(char, getCurrentYear(), true);
    }

    function getStatusAtYear(char, year) {
        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) {
            return 'Civilian';
        }
        return getStatusAtYearInternal(char, yearNum, false);
    }

    function getStatusAtYearInternal(char, yearNum, appendFormer) {
        if (!char ||
            !char.careerStatus ||
            char.careerStatus.length === 0) {
            return 'Civilian';
        }

        var bestStatus = null;
        var bestScore = null;

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }
            if (!entry.status) { continue; }

            var startRaw = entry.startYear;
            var startNum = null;
            if (startRaw !== undefined &&
                startRaw !== null &&
                String(startRaw).trim() !== '') {
                startNum = parseInt(startRaw, 10);
                if (isNaN(startNum)) {
                    // Malformed start year: skip. Treating a typo as
                    // "since the beginning of time" would silently
                    // include the entry in every query.
                    continue;
                }
            }

            if (startNum !== null && startNum > yearNum) {
                continue;
            }

            var endRaw = entry.endYear;
            var endNum = null;
            if (endRaw !== undefined &&
                endRaw !== null &&
                String(endRaw).trim() !== '') {
                endNum = parseInt(endRaw, 10);
                if (isNaN(endNum)) { endNum = null; }
            }

            // endYear < yearNum, not <=: an entry that ends in year Y
            // is still held during Y.
            if (endNum !== null && endNum < yearNum) {
                continue;
            }

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

        if (!bestStatus) { return 'Civilian'; }

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
    // STATUS PREDICATES (current year)
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
    // STATUS-BY-YEAR
    // ============================================================

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

            var startRaw = entry.startYear;
            if (startRaw === undefined ||
                startRaw === null ||
                String(startRaw).trim() === '') {
                return true;
            }

            var startNum = parseInt(startRaw, 10);
            if (isNaN(startNum)) {
                // Malformed year treated as blank; the alternative
                // is silently dropping the entry.
                return true;
            }

            if (startNum <= yearNum) { return true; }
        }

        return false;
    }

    function isSeniorByYear(char, year) {
        return isStatusByYear(char, year, 'senior');
    }

    function isJuniorOrSeniorByYear(char, year) {
        if (isStatusByYear(char, year, 'junior')) { return true; }
        return isStatusByYear(char, year, 'senior');
    }

    function isSupportByYear(char, year) {
        return isStatusByYear(char, year, 'support');
    }

    function isInstructorByYear(char, year) {
        return isStatusByYear(char, year, 'instructor');
    }

    // ============================================================
    // CAREER STATUS YEAR (earliest)
    // ============================================================

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

    function getSupportYear(char) {
        return getCareerStatusYear(char, 'support');
    }

    function getInstructorYear(char) {
        return getCareerStatusYear(char, 'instructor');
    }

    // ============================================================
    // PROFESSIONALLY-ELIGIBLE PHASE BY YEAR
    // ============================================================
    //
    // Character-side only. Does NOT consult the team store.
    //
    // AVAILABLE when:
    //   - junior OR senior by year Y
    //   - NOT instructor by year Y
    //
    // Support status is deliberately not consulted here. A support
    // member in their student phase passes; whether they enter the
    // roster is decided downstream by the team-aware query.
    //
    // Fail-closed: malformed character or invalid year returns false.

    function isProfessionallyEligiblePhaseAtYear(char, year) {
        if (!char || typeof char !== 'object') { return false; }

        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) { return false; }

        if (!isJuniorOrSeniorByYear(char, yearNum)) { return false; }
        if (isInstructorByYear(char, yearNum)) { return false; }

        return true;
    }

    // ============================================================
    // LIST QUERIES
    // ============================================================

    function getCharacters() {
        return getCharacterData().slice();
    }

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
        if (!char.stats || typeof char.stats !== 'object') {
            return createDefaultStats();
        }
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
        invalidateCharacterIndex: invalidateCharacterIndex,

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
        isSupportByYear: isSupportByYear,
        isInstructorByYear: isInstructorByYear,

        // Career-status year getters
        getCareerStatusYear: getCareerStatusYear,
        getJuniorYear: getJuniorYear,
        getSeniorYear: getSeniorYear,
        getSupportYear: getSupportYear,
        getInstructorYear: getInstructorYear,

        // Phase eligibility (character-side only)
        isProfessionallyEligiblePhaseAtYear:
            isProfessionallyEligiblePhaseAtYear,

        // Lists
        getCharacters: getCharacters,
        getStudents: getStudents,
        getInstructors: getInstructors,
        getNonCivilianCharacters: getNonCivilianCharacters,

        // Stats
        getCharacterStats: getCharacterStats
    };

})();
