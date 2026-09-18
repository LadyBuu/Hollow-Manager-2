/**
 * shared/queries/elimination-queries.js - Elimination Queries
 * Read-only elimination domain queries.
 *
 * Path: js/shared/queries/elimination-queries.js
 *
 * This module is the SINGLE SOURCE OF TRUTH for elimination read
 * semantics. It answers questions about character eliminations. It
 * does NOT mutate anything. Mutation paths live elsewhere:
 *
 *   - Standalone eliminations (Drop Out and its undo):
 *       AcademyEliminations (js/modules/academy/academy-eliminations.js)
 *
 *   - Tournament-generated eliminations (cascade on match completion
 *     and reversal on remove/reopen):
 *       TournamentEliminationCascade
 *         (js/modules/tournaments/tournament-elimination-cascade.js)
 *
 *   - Cache maintenance (character.eliminatedWeeks):
 *       rebuildEliminatedWeeks is exported from THIS module so both
 *       mutation modules call one implementation.
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
 *   "eliminated at the END of week N", not at the START.
 *
 *   Concretely:
 *     isCharacterEliminatedByWeek(char, N)       → false
 *     isCharacterEliminatedByWeek(char, N + 1)   → true
 *
 *   The boundary is STRICTLY LESS THAN: an elimination at week E is
 *   "before" week W when E < W.
 *
 *   Week only makes sense inside a single year. Cross-year queries
 *   use year.
 *
 * YEAR BOUNDARY SEMANTICS:
 *   A character eliminated in year Y is INELIGIBLE from year Y
 *   onward. The boundary is INCLUSIVE at the year level:
 *
 *     isCharacterEliminatedByYear(char, Y)       → true
 *     isCharacterEliminatedByYear(char, Y - 1)   → false
 *
 *   A year is the coarsest unit the application works with.
 *   Elimination in year Y means the character was knocked out during
 *   year Y, so any query "as of year Y?" answers yes.
 *
 *   Year is the unit that character-list filtering and cross-year
 *   elimination reports use. Week is retained for display and for
 *   intra-year ordering.
 *
 * ELIMINATION SOURCE OF TRUTH:
 *   character.eliminations[] is the ONLY source of truth. Each entry
 *   is:
 *     {
 *       id: string,
 *       tournamentId: string | null,
 *       year: integer,          // REQUIRED (v25+)
 *       week: integer,          // 1-52, retained
 *       reason: string,
 *       standalone: boolean,
 *       fromMatch: boolean
 *     }
 *
 *   The derived character.eliminatedWeeks[] cache is maintained by
 *   rebuildEliminatedWeeks. It contains weeks only and is not a
 *   source of truth.
 *
 * WEEK PARSING:
 *   Week parsing goes through CalendarValidation.parseWeek, which is
 *   the canonical strict parser (integer-only, in-range, no silent
 *   coercion of trailing characters). This module does NOT define
 *   its own bounds or parser.
 *
 * ID-OR-OBJECT ARGUMENTS:
 *   The per-character query functions accept EITHER a character ID or
 *   a character object. When passed an object, it is used directly.
 *   When passed an ID, the character is looked up in window.data.
 *   This lets callers that already have an object skip the lookup.
 *
 *   The lookup is bounded by the character list. Calling these
 *   functions in a tight loop with IDs is O(N·M). For hot paths, pass
 *   the object.
 *
 * LIVE READS ONLY:
 *   This module reads window.data. It does NOT accept an appData
 *   snapshot argument. Transaction-local validation inside
 *   MutationPipeline must operate on the snapshot the pipeline
 *   supplies; that is the cascade's concern, not this module's.
 *   Keeping the two surfaces separate prevents live-read semantics
 *   from leaking into transaction code and vice versa.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CalendarValidation
 *
 * DEPENDENCIES (LAZY):
 *   - window.data (canonical character store)
 */

(function() {
    'use strict';

    if (window.__eliminationQueriesLoaded) { return; }
    window.__eliminationQueriesLoaded = true;

    // ============================================================
    // MANDATORY DEPENDENCY: CalendarValidation
    // ============================================================

    var CalendarValidation = window.CalendarValidation;

    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        throw new Error(
            '[EliminationQueries] Missing mandatory dependency: ' +
            'CalendarValidation.parseWeek'
        );
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function getCharacterData() {
        var data = window.data || {};
        return Array.isArray(data.characters) ? data.characters : [];
    }

    /**
     * Resolve a character ID or character object to a character
     * object. Returns null when the input cannot be resolved.
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

        // ID form: look up in the live store.
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

    /**
     * Parse a week using the canonical parser.
     * Returns an integer in range, or null.
     */
    function parseWeek(value) {
        return CalendarValidation.parseWeek(value);
    }

    /**
     * Parse a year. Years are unbounded positive integers. Accepts
     * numbers and pure-digit strings. Returns an integer >= 1, or
     * null.
     */
    function parseYear(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) { return null; }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) { return null; }
            var n = Number(trimmed);
            if (!Number.isInteger(n) || n < 1) { return null; }
            return n;
        }
        return null;
    }

    // ============================================================
    // WEEK-BASED QUERIES
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
     *   state is NOT considered.
     *
     *   Week is only meaningful inside a single year. This query does
     *   NOT filter by year; it reads any elimination record whose
     *   week is strictly less than the given week, regardless of
     *   which year the record belongs to. Callers that need
     *   year-scoping use isCharacterEliminatedByYear.
     *
     * @param {string|object} charIdOrObject - Character ID or object
     * @param {number|string} week - Week number
     * @returns {boolean}
     */
    function isCharacterEliminatedByWeek(charIdOrObject, week) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return false; }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
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

            // Strictly less than: elimination at week E counts as
            // "eliminated before week W" only when E < W.
            if (elimWeek < weekNum) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the earliest elimination WEEK across all sources.
     *
     * SEMANTICS:
     *   Returns the smallest week value across every valid
     *   elimination record on the character. This is NOT "the week
     *   the character was most recently eliminated" and it is NOT
     *   "the current tournament's elimination week." It is the
     *   earliest elimination the character has ever recorded, by
     *   week value alone.
     *
     *   Because week is only meaningful inside a single year, and
     *   because a character can have eliminations in multiple
     *   years, this value is only coherent when the caller knows
     *   the character's eliminations all belong to one year. The
     *   primary consumer is display: the banner that says
     *   "Eliminated in Week W of Year Y" uses both getEliminationWeek
     *   and getEliminationYear, and pairs them.
     *
     *   Returns null when the character has no valid elimination
     *   weeks. The deceased state is NOT considered.
     *
     * @param {string|object} charIdOrObject
     * @returns {number|null}
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

            if (earliest === null || elimWeek < earliest) {
                earliest = elimWeek;
            }
        }

        return earliest;
    }

    /**
     * Get the reason from the character's EARLIEST elimination.
     *
     * SEMANTICS:
     *   Picks the elimination record with the smallest week value
     *   that also carries a usable reason, and returns that reason.
     *   This is a display convenience, not a semantic answer to
     *   "why was this character eliminated in the current
     *   tournament." Callers that need the current tournament's
     *   reason read the tournament's elimination record directly.
     *
     *   Returns 'Unknown' when no elimination has a usable reason.
     *
     * @param {string|object} charIdOrObject
     * @returns {string}
     */
    function getEliminationReason(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return 'Unknown'; }

        if (!Array.isArray(char.eliminations)) {
            return 'Unknown';
        }

        var earliestWeek = null;
        var earliestReason = null;

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim) { continue; }
            if (typeof elim.reason !== 'string') { continue; }
            if (elim.reason.trim() === '') { continue; }

            var elimWeek = parseWeek(elim.week);
            if (elimWeek === null) { continue; }

            if (earliestWeek === null || elimWeek < earliestWeek) {
                earliestWeek = elimWeek;
                earliestReason = elim.reason;
            }
        }

        return earliestReason !== null ? earliestReason : 'Unknown';
    }

    /**
     * Get the IDs of every character eliminated BEFORE the given
     * week.
     *
     * Uses the same strictly-less-than boundary as
     * isCharacterEliminatedByWeek. Week-scoped; not year-scoped.
     *
     * @param {number|string} week
     * @param {array} [characters] - Optional character list. Uses
     *   window.data.characters when absent.
     * @returns {array} Array of character IDs
     */
    function getEliminatedCharacters(week, characters) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var list = Array.isArray(characters)
            ? characters
            : getCharacterData();
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
     * Get the IDs of every character NOT eliminated before the given
     * week.
     *
     * NAMING:
     *   The name is deliberately long. "Active" would be wrong: this
     *   predicate says nothing about deceased state, class
     *   membership, enrolment, role, or any other dimension of
     *   activity. It answers exactly one question: "has this
     *   character failed to be eliminated before week W?"
     *
     *   A character eliminated AT week W is included here, because
     *   they are still eligible during week W.
     *
     * @param {number|string} week
     * @param {array} [characters]
     * @returns {array} Array of character IDs
     */
    function getCharactersNotEliminatedByWeek(week, characters) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var list = Array.isArray(characters)
            ? characters
            : getCharacterData();
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
    // YEAR-BASED QUERIES
    // ============================================================

    /**
     * Is the character eliminated as of the given year?
     *
     * SEMANTICS:
     *   A character with an elimination in year Y is eliminated for
     *   every year >= Y. A character with no eliminations is not
     *   eliminated for any year. The boundary is INCLUSIVE:
     *   eliminated in year Y answers "yes" for year Y itself.
     *
     *   Records without a valid `year` field are ignored. This is the
     *   pre-v25 shape; the v25 migration backfills every record.
     *
     * @param {string|object} charIdOrObject
     * @param {number|string} year
     * @returns {boolean}
     */
    function isCharacterEliminatedByYear(charIdOrObject, year) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return false; }

        var yearNum = parseYear(year);
        if (yearNum === null) {
            return false;
        }

        if (!Array.isArray(char.eliminations)) {
            return false;
        }

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim) { continue; }

            var elimYear = parseYear(elim.year);
            if (elimYear === null) { continue; }

            if (elimYear <= yearNum) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the earliest elimination YEAR across all sources.
     *
     * SEMANTICS:
     *   Returns the smallest year value across every valid
     *   elimination record on the character. This is "the year the
     *   character was first eliminated," which is what the
     *   character-list badge and the Academic tab banner both
     *   display.
     *
     *   Returns null when the character has no valid elimination
     *   years.
     *
     * @param {string|object} charIdOrObject
     * @returns {number|null}
     */
    function getEliminationYear(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return null; }

        if (!Array.isArray(char.eliminations)) {
            return null;
        }

        var earliest = null;

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim) { continue; }

            var elimYear = parseYear(elim.year);
            if (elimYear === null) { continue; }

            if (earliest === null || elimYear < earliest) {
                earliest = elimYear;
            }
        }

        return earliest;
    }

    /**
     * Get the IDs of every character eliminated as of the given
     * year.
     *
     * @param {number|string} year
     * @param {array} [characters]
     * @returns {array} Array of character IDs
     */
    function getEliminatedCharactersByYear(year, characters) {
        var yearNum = parseYear(year);
        if (yearNum === null) {
            return [];
        }

        var list = Array.isArray(characters)
            ? characters
            : getCharacterData();
        var result = [];

        for (var i = 0; i < list.length; i++) {
            var char = list[i];
            if (!char || !char.id) { continue; }
            if (isCharacterEliminatedByYear(char, yearNum)) {
                result.push(char.id);
            }
        }

        return result;
    }

    /**
     * Get the IDs of every character NOT eliminated as of the given
     * year.
     *
     * NAMING:
     *   Same caveat as getCharactersNotEliminatedByWeek. This
     *   predicate says nothing about deceased state, class
     *   membership, enrolment, or role. It answers exactly one
     *   question.
     *
     * @param {number|string} year
     * @param {array} [characters]
     * @returns {array} Array of character IDs
     */
    function getActiveCharactersByYear(year, characters) {
        var yearNum = parseYear(year);
        if (yearNum === null) {
            return [];
        }

        var list = Array.isArray(characters)
            ? characters
            : getCharacterData();
        var result = [];

        for (var i = 0; i < list.length; i++) {
            var char = list[i];
            if (!char || !char.id) { continue; }
            if (!isCharacterEliminatedByYear(char, yearNum)) {
                result.push(char.id);
            }
        }

        return result;
    }

    // ============================================================
    // DERIVED CACHE MAINTENANCE
    // ============================================================
    //
    // character.eliminatedWeeks[] is a derived cache maintained by
    // every writer of character.eliminations[]. Both mutation modules
    // call this function after writing or removing an elimination:
    //
    //   - AcademyEliminations (addStandalone, removeStandalone)
    //   - TournamentEliminationCascade (applyFailEliminations and all
    //     the reversal operations)
    //
    // The cache holds weeks only and deduplicates across years: two
    // eliminations in the same week of different years produce a
    // single entry. It is a display convenience, not a source of
    // truth.

    /**
     * Rebuild the derived eliminatedWeeks array from eliminations.
     * Mutates the character in place. Intended to be called from
     * inside pipeline mutate() callbacks, on a live character
     * reference.
     *
     * @param {object} char
     */
    function rebuildEliminatedWeeks(char) {
        if (!char) { return; }

        if (!Array.isArray(char.eliminations)) {
            char.eliminations = [];
        }

        char.eliminatedWeeks = [];

        for (var i = 0; i < char.eliminations.length; i++) {
            var e = char.eliminations[i];
            if (!e || typeof e !== 'object') { continue; }

            var week = parseWeek(e.week);
            if (week === null) { continue; }

            if (char.eliminatedWeeks.indexOf(week) === -1) {
                char.eliminatedWeeks.push(week);
            }
        }

        char.eliminatedWeeks.sort(function(a, b) { return a - b; });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.EliminationQueries = {
        // Week-based queries
        isCharacterEliminatedByWeek: isCharacterEliminatedByWeek,
        getEliminationWeek: getEliminationWeek,
        getEliminationReason: getEliminationReason,
        getEliminatedCharacters: getEliminatedCharacters,
        getCharactersNotEliminatedByWeek: getCharactersNotEliminatedByWeek,

        // Year-based queries
        isCharacterEliminatedByYear: isCharacterEliminatedByYear,
        getEliminationYear: getEliminationYear,
        getEliminatedCharactersByYear: getEliminatedCharactersByYear,
        getActiveCharactersByYear: getActiveCharactersByYear,

        // Derived cache maintenance (used by both mutation modules)
        rebuildEliminatedWeeks: rebuildEliminatedWeeks
    };

})();
