/**
 * shared/queries/elimination-queries.js - Elimination Queries
 * Read-only elimination domain queries.
 * 
 * Path: js/shared/queries/elimination-queries.js
 * 
 * This module provides READ-ONLY access to character elimination data.
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations.
 *   - Reads from window.data.characters directly.
 *   - No dependencies on other modules.
 *   - All query functions return primitive values (boolean, number, string)
 *     or null. No object references escape.
 * 
 * ELIMINATION SOURCES OF TRUTH:
 *   1. character.eliminations[] — explicit elimination records
 *      (tournament or standalone).
 *   2. character.deceased + character.deathWeek — the death timeline
 *      as an implicit elimination boundary.
 * 
 *   Both are checked by isCharacterEliminatedByWeek. The derived
 *   character.eliminatedWeeks[] field is NOT the source of truth.
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
 * DEATH-WEEK SEMANTICS:
 *   - Deceased with a valid deathWeek: eliminated from deathWeek.
 *   - Deceased with an invalid/missing deathWeek: eliminated from
 *     week 1 (the character was dead before the timeline started).
 *   - Not deceased: eliminations array is the only source.
 * 
 * WEEK BOUNDS:
 *   Weeks are 1-52. Values outside that range are treated as invalid
 *   and do not participate in elimination calculations.
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
     * Is the character eliminated at or before the given week?
     *
     * SEMANTICS:
     *   - Checks explicit eliminations first. Any elimination whose
     *     week is valid and <= the requested week matches.
     *   - Then checks the death timeline. Deceased with a valid
     *     deathWeek: matches when deathWeek <= requested week.
     *     Deceased with an invalid deathWeek: matches for any valid
     *     requested week (eliminated from week 1).
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

        // ---- Explicit eliminations ----
        if (Array.isArray(char.eliminations)) {
            for (var i = 0; i < char.eliminations.length; i++) {
                var elim = char.eliminations[i];
                if (!elim) { continue; }
                var elimWeek = parseWeek(elim.week);
                if (elimWeek !== null && elimWeek >= MIN_WEEK && elimWeek <= MAX_WEEK && elimWeek <= weekNum) {
                    return true;
                }
            }
        }

        // ---- Death timeline ----
        if (char.deceased) {
            var deathWeek = parseWeek(char.deathWeek);
            var hasValidDeathWeek = (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== '' &&
                deathWeek !== null &&
                deathWeek >= MIN_WEEK &&
                deathWeek <= MAX_WEEK
            );

            if (hasValidDeathWeek) {
                return deathWeek <= weekNum;
            }

            // Deceased without a valid deathWeek: treated as eliminated
            // from week 1.
            return true;
        }

        return false;
    }

    /**
     * Get the earliest week at which the character is eliminated.
     * Considers both explicit eliminations and the death timeline.
     *
     * @param {string|object} charIdOrObject - Character ID or object
     * @returns {number|null} Week number, or null if not eliminated
     */
    function getEliminationWeek(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return null; }

        var earliest = null;

        // ---- Explicit eliminations ----
        if (Array.isArray(char.eliminations)) {
            for (var i = 0; i < char.eliminations.length; i++) {
                var elim = char.eliminations[i];
                if (!elim) { continue; }
                var elimWeek = parseWeek(elim.week);
                if (elimWeek !== null && elimWeek >= MIN_WEEK && elimWeek <= MAX_WEEK) {
                    if (earliest === null || elimWeek < earliest) {
                        earliest = elimWeek;
                    }
                }
            }
        }

        // ---- Death timeline ----
        if (char.deceased) {
            var deathWeek = parseWeek(char.deathWeek);
            var hasValidDeathWeek = (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== '' &&
                deathWeek !== null &&
                deathWeek >= MIN_WEEK &&
                deathWeek <= MAX_WEEK
            );

            if (hasValidDeathWeek) {
                if (earliest === null || deathWeek < earliest) {
                    earliest = deathWeek;
                }
            } else {
                // Deceased without a valid deathWeek: eliminated from
                // week 1.
                if (earliest === null || MIN_WEEK < earliest) {
                    earliest = MIN_WEEK;
                }
            }
        }

        return earliest;
    }

    /**
     * Get a human-readable reason for the character's elimination.
     *
     * SEMANTICS:
     *   - Returns the first explicit elimination's reason when present.
     *   - Falls back to the death timeline's deathCause.
     *   - Falls back to 'Deceased' when deceased but no cause.
     *   - Returns 'Unknown' when not eliminated or no reason found.
     *
     * @param {string|object} charIdOrObject - Character ID or object
     * @returns {string}
     */
    function getEliminationReason(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return 'Unknown'; }

        if (Array.isArray(char.eliminations)) {
            for (var i = 0; i < char.eliminations.length; i++) {
                var elim = char.eliminations[i];
                if (elim && typeof elim.reason === 'string' && elim.reason.trim() !== '') {
                    return elim.reason;
                }
            }
        }

        if (char.deceased && char.deathCause) {
            return 'Deceased: ' + char.deathCause;
        }
        if (char.deceased) {
            return 'Deceased';
        }

        return 'Unknown';
    }

    // ============================================================
    // BULK QUERIES
    // ============================================================

    /**
     * Get the IDs of every character eliminated at or before the
     * given week.
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
     * Get the IDs of every character who is NOT eliminated at or
     * before the given week.
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

        // Bulk queries
        getEliminatedCharacters: getEliminatedCharacters,
        getActiveCharacters: getActiveCharacters,

        // Constants (read-only)
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
