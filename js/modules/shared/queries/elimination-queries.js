/**
 * shared/queries/elimination-queries.js - Elimination Queries
 * Read-only elimination domain queries.
 * 
 * Path: js/shared/queries/elimination-queries.js
 * 
 * This module provides READ-ONLY access to character elimination data.
 * It is the SINGLE SOURCE OF TRUTH for elimination read semantics.
 * 
 * ELIMINATION vs DECEASED:
 *   These are separate concepts. This module answers questions about
 *   ELIMINATION only. It does not consult character.deceased or
 *   character.deathWeek. A character can be deceased without ever
 *   being eliminated, and eliminated without ever being deceased.
 *   Callers that want to ask "is this character dead?" use
 *   CharacterQueries.isDeceased (year-aware) or check char.deceased.
 * 
 * WEEK BOUNDARY SEMANTICS:
 *   A character eliminated in week N is ELIGIBLE during week N and
 *   INELIGIBLE from week N+1 onward. "Eliminated at week N" means
 *   "eliminated at the END of week N", not "eliminated at the START".
 * 
 *   Concretely:
 *     isCharacterEliminatedByWeek(char, N)       → false
 *     isCharacterEliminatedByWeek(char, N + 1)   → true
 * 
 *   The boundary is STRICTLY LESS THAN: an elimination at week E is
 *   "before" week W when E < W.
 * 
 * ELIMINATION SOURCE OF TRUTH:
 *   character.eliminations[] is the ONLY source of truth. Each entry
 *   is:
 *     {
 *       id: string,
 *       tournamentId: string | null,
 *       week: number,
 *       reason: string,
 *       standalone: boolean,   // true for non-tournament eliminations
 *       fromMatch: boolean
 *     }
 * 
 *   The derived character.eliminatedWeeks[] field is NOT the source
 *   of truth. It is a convenience cache maintained by the mutation
 *   module (character-eliminations.js) and must not be read here.
 * 
 * ID-OR-OBJECT ARGUMENTS:
 *   The primary query functions accept EITHER a character ID or a
 *   character object. When passed an object, it is used directly.
 *   When passed an ID, the character is looked up. This lets callers
 *   that already have an ID skip the CharacterQueries round-trip.
 * 
 *   The lookup is bounded by the character list. Calling these
 *   functions in a tight loop with IDs is O(N·M) where N is the
 *   number of calls and M is the character count. For hot paths,
 *   pass the character object.
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state)
 */

(function() {
    'use strict';

    if (window.__eliminationQueriesLoaded) { return; }
    window.__eliminationQueriesLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = 1;
    var MAX_WEEK = 52;

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function getCharacterData() {
        var data = window.data || {};
        return Array.isArray(data.characters) ? data.characters : [];
    }

    /**
     * Resolve a character ID or character object to a character object.
     * Returns null when the input cannot be resolved.
     *
     * @param {string|object} charIdOrObject
     * @returns {object|null}
     */
    function resolveCharacter(charIdOrObject) {
        if (!charIdOrObject) {
            return null;
        }

        // Object form: use directly.
        if (typeof charIdOrObject === 'object') {
            return charIdOrObject;
        }

        // ID form: look up.
        var target = String(charIdOrObject);
        var chars = getCharacterData();
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (c && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    function isValidWeek(value) {
        var num = parseInt(value, 10);
        if (isNaN(num)) { return false; }
        return num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function parseWeek(value) {
        var num = parseInt(value, 10);
        if (isNaN(num)) { return null; }
        return num;
    }

    // ============================================================
    // ELIMINATION STATUS QUERIES
    // ============================================================

    /**
     * Is the character eliminated BEFORE the given week?
     *
     * SEMANTICS:
     *   A character eliminated in week E is considered "eliminated
     *   before week W" when E < W. Elimination at week W itself does
     *   NOT count as eliminated for week W — the character is
     *   eligible during the week they are eliminated, and ineligible
     *   from the following week onward.
     *
     *   This is the correct boundary for team membership, exam
     *   eligibility, and ranking participation: a character
     *   eliminated in week 5 still participates in week 5's events.
     *
     *   Only character.eliminations[] is consulted. The deceased
     *   state is NOT considered. A deceased character with no
     *   elimination records is NOT eliminated by this function.
     *
     * @param {string|object} charIdOrObject - Character ID or object
     * @param {number|string} week - Week number
     * @returns {boolean}
     */
    function isCharacterEliminatedByWeek(charIdOrObject, week) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return false; }

        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK) {
            return false;
        }

        if (!Array.isArray(char.eliminations)) {
            return false;
        }

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim) { continue; }

            var elimWeek = parseWeek(elim.week);
            if (elimWeek === null) { continue; }
            if (elimWeek < MIN_WEEK || elimWeek > MAX_WEEK) { continue; }

            // Strictly less than: elimination at week E counts as
            // "eliminated before week W" only when E < W.
            if (elimWeek < weekNum) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the week at which the character is eliminated.
     *
     * Returns the EARLIEST week across all explicit eliminations.
     * Returns null when the character has no valid elimination
     * records. The deceased state is NOT considered.
     *
     * @param {string|object} charIdOrObject - Character ID or object
     * @returns {number|null} Week number, or null if not eliminated
     */
    function getEliminationWeek(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return null; }

        if (!Array.isArray(char.eliminations)) {
            return null;
        }

        var earliest = null;

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim) { continue; }

            var elimWeek = parseWeek(elim.week);
            if (elimWeek === null) { continue; }
            if (elimWeek < MIN_WEEK || elimWeek > MAX_WEEK) { continue; }

            if (earliest === null || elimWeek < earliest) {
                earliest = elimWeek;
            }
        }

        return earliest;
    }

    /**
     * Get a human-readable reason for the character's elimination.
     *
     * Returns the reason from the earliest explicit elimination
     * record when present. Returns 'Unknown' when the character has
     * no eliminations with a usable reason.
     *
     * Does NOT fall back to character.deathCause. Death is a
     * separate concept; callers that want the death cause should
     * ask CharacterQueries.
     *
     * @param {string|object} charIdOrObject - Character ID or object
     * @returns {string}
     */
    function getEliminationReason(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return 'Unknown'; }

        if (!Array.isArray(char.eliminations)) {
            return 'Unknown';
        }

        // Prefer the reason from the earliest elimination. We need
        // to scan once to find the earliest week with a reason, then
        // return that reason. Records without a reason are skipped.
        var earliestWeek = null;
        var earliestReason = null;

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim) { continue; }
            if (typeof elim.reason !== 'string') { continue; }
            if (elim.reason.trim() === '') { continue; }

            var elimWeek = parseWeek(elim.week);
            if (elimWeek === null) { continue; }
            if (elimWeek < MIN_WEEK || elimWeek > MAX_WEEK) { continue; }

            if (earliestWeek === null || elimWeek < earliestWeek) {
                earliestWeek = elimWeek;
                earliestReason = elim.reason;
            }
        }

        return earliestReason !== null ? earliestReason : 'Unknown';
    }

    /**
     * Get the full elimination record for a character. Returns the
     * earliest elimination record (an object with id, tournamentId,
     * week, reason, standalone, fromMatch) or null.
     *
     * @param {string|object} charIdOrObject
     * @returns {object|null}
     */
    function getEliminationRecord(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return null; }

        if (!Array.isArray(char.eliminations)) {
            return null;
        }

        var earliest = null;

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim) { continue; }

            var elimWeek = parseWeek(elim.week);
            if (elimWeek === null) { continue; }
            if (elimWeek < MIN_WEEK || elimWeek > MAX_WEEK) { continue; }

            if (earliest === null || elimWeek < earliest.week) {
                earliest = elim;
            }
        }

        return earliest;
    }

    // ============================================================
    // BULK QUERIES
    // ============================================================

    /**
     * Get the IDs of every character eliminated BEFORE the given week.
     *
     * Uses the same strictly-less-than boundary as
     * isCharacterEliminatedByWeek: elimination at week W does not
     * count as "eliminated before week W".
     *
     * @param {number|string} week - Week number
     * @param {array} [characters] - Optional character list. Uses
     *   window.data.characters when absent.
     * @returns {array} Array of character IDs
     */
    function getEliminatedCharacters(week, characters) {
        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK) {
            return [];
        }

        var list = Array.isArray(characters) ? characters : getCharacterData();
        var result = [];

        for (var i = 0; i < list.length; i++) {
            var char = list[i];
            if (!char || !char.id) { continue; }
            if (isCharacterEliminatedByWeek(char, weekNum)) {
                result.push(char.id);
            }
        }

        return result;
    }

    /**
     * Get the IDs of every character who is NOT eliminated before
     * the given week. Includes characters eliminated AT the given
     * week — they are still eligible during that week.
     *
     * @param {number|string} week - Week number
     * @param {array} [characters] - Optional character list
     * @returns {array} Array of character IDs
     */
    function getActiveCharacters(week, characters) {
        var weekNum = parseWeek(week);
        if (weekNum === null || weekNum < MIN_WEEK) {
            return [];
        }

        var list = Array.isArray(characters) ? characters : getCharacterData();
        var result = [];

        for (var i = 0; i < list.length; i++) {
            var char = list[i];
            if (!char || !char.id) { continue; }
            if (!isCharacterEliminatedByWeek(char, weekNum)) {
                result.push(char.id);
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.EliminationQueries = {
        // Per-character queries
        isCharacterEliminatedByWeek: isCharacterEliminatedByWeek,
        isCharacterEliminated: isCharacterEliminatedByWeek, // alias
        getEliminationWeek: getEliminationWeek,
        getEliminationReason: getEliminationReason,
        getEliminationRecord: getEliminationRecord,

        // Bulk queries
        getEliminatedCharacters: getEliminatedCharacters,
        getActiveCharacters: getActiveCharacters,

        // Constants (read-only)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
