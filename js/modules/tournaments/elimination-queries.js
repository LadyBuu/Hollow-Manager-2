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
 *   use year. isCharacterEliminatedByWeek therefore accepts an
 *   optional `year` argument; see the YEAR SCOPING note below.
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
 * YEAR SCOPING (isCharacterEliminatedByWeek):
 *   isCharacterEliminatedByWeek(char, week) is year-agnostic. A
 *   character eliminated in week 3 of 1920 answers "yes" for week 10
 *   of 1930 — which is almost never what the caller means.
 *
 *   isCharacterEliminatedByWeek(char, week, year) filters to records
 *   whose year matches. Callers that know the year should pass it.
 *   Callers that don't (rare; mostly legacy) keep the old behaviour
 *   by omitting the third argument.
 *
 *   The variant that accepts a year is the correct one for any
 *   caller that has a year in hand. character-aggregator.js's detail
 *   and academic projections now pass the current year.
 *
 * ELIMINATION SOURCE OF TRUTH:
 *   character.eliminations[] is the ONLY source of truth. Each entry
 *   is:
 *     {
 *       id: string,
 *       tournamentId: string | null,
 *       year: integer,          // REQUIRED (v25+)
 *       week: integer,          // 1-52, REQUIRED (v25+)
 *       reason: string,
 *       standalone: boolean,
 *       fromMatch: boolean
 *     }
 *
 *   The derived character.eliminatedWeeks[] cache is maintained by
 *   rebuildEliminatedWeeks. It contains weeks only and is not a
 *   source of truth.
 *
 * FAIL-CLOSED RECORD POLICY (E6):
 *   A record must have BOTH a valid year AND a valid week to be
 *   counted by ANY query. A record with only one of the two is
 *   treated as unusable and skipped everywhere. This is stricter
 *   than the previous behaviour, which allowed a year-only record
 *   to be counted by year queries and a week-only record to be
 *   counted by week queries. The old behaviour made the two views
 *   disagree; the fail-closed policy makes them agree.
 *
 *   Callers that want raw record access (exports, verifiers) walk
 *   char.eliminations[] directly and are unaffected.
 *
 * WEEK PARSING:
 *   Week parsing goes through CalendarValidation.parseWeek, which is
 *   the canonical strict parser (integer-only, in-range, no silent
 *   coercion of trailing characters). This module does NOT define
 *   its own bounds or parser.
 *
 *   CalendarValidation is resolved LAZILY at call time. A missing
 *   CalendarValidation throws a clear error the first time a
 *   week-using function is called; it does not fail this module at
 *   load. That removes a load-order race (CalendarValidation might
 *   arrive after elimination-queries.js).
 *
 * ID-OR-OBJECT ARGUMENTS:
 *   The per-character query functions accept EITHER a character ID or
 *   a character object. When passed an object, it is used directly.
 *   When passed an ID, the character is resolved via a memoized
 *   lookup (see CHARACTER ID RESOLUTION below).
 *
 * CHARACTER ID RESOLUTION (E4):
 *   When window.CharacterQueries is loaded, resolveCharacter delegates
 *   to CharacterQueries.getCharacterById. That is the canonical
 *   index, and it has a freshness self-heal that the local index did
 *   not. Delegating removes a third duplicate index in the codebase
 *   and eliminates the drift between the two.
 *
 *   When CharacterQueries is NOT loaded, resolveCharacter falls back
 *   to a local memoized index. The fallback exists for a load-order
 *   race and for a stripped-down context (tests, tools) that loads
 *   only this module.
 *
 * LIVE READS ONLY:
 *   This module reads window.data. It does NOT accept an appData
 *   snapshot argument. Transaction-local validation inside
 *   MutationPipeline must operate on the snapshot the pipeline
 *   supplies; that is the cascade's concern, not this module's.
 *
 * DEPENDENCIES (MANDATORY at call time, not at load):
 *   - window.CalendarValidation  (week-using functions only)
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterQueries    (preferred id resolver)
 *   - window.data                (canonical character store)
 */

(function() {
    'use strict';

    if (window.__eliminationQueriesLoaded) { return; }
    window.__eliminationQueriesLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY: CalendarValidation
    // ============================================================
    //
    // Resolved at call time so a load-order race cannot break this
    // module. Every public function that needs a week parser calls
    // requireCalendarValidation() first.

    function getCalendarValidation() {
        return window.CalendarValidation || null;
    }

    function requireCalendarValidation(calleeName) {
        var CV = getCalendarValidation();
        if (!CV || typeof CV.parseWeek !== 'function') {
            throw new Error(
                '[EliminationQueries] ' + calleeName +
                ' requires CalendarValidation.parseWeek. Ensure ' +
                'CalendarValidation is loaded before this function ' +
                'is called.'
            );
        }
        return CV;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function getCharacterData() {
        var data = window.data || {};
        return Array.isArray(data.characters) ? data.characters : [];
    }

    function parseWeek(value) {
        var CV = requireCalendarValidation('parseWeek');
        return CV.parseWeek(value);
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
            if (!Number.isSafeInteger(value) || value < 1) {
                return null;
            }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) { return null; }
            var n = Number(trimmed);
            if (!Number.isSafeInteger(n) || n < 1) { return null; }
            return n;
        }
        return null;
    }

    // ============================================================
    // CHARACTER ID RESOLUTION
    // ============================================================
    //
    // Preferred path: delegate to CharacterQueries.getCharacterById,
    // which is the canonical index and self-heals on slot
    // replacement.
    //
    // Fallback: a local memoized Map<id, character> keyed by the
    // live character store. Rebuilt when the array reference or its
    // length changes. Used only when CharacterQueries is absent.

    var _charIndex = null;
    var _charIndexSourceRef = null;
    var _charIndexSourceLength = -1;

    function getLocalCharacterIndex() {
        var chars = getCharacterData();

        if (_charIndex !== null &&
            chars === _charIndexSourceRef &&
            chars.length === _charIndexSourceLength) {
            return _charIndex;
        }

        var map = new Map();
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (c && typeof c === 'object' &&
                c.id !== undefined && c.id !== null) {
                map.set(String(c.id), c);
            }
        }

        _charIndex = map;
        _charIndexSourceRef = chars;
        _charIndexSourceLength = chars.length;
        return _charIndex;
    }

    /**
     * Force the local id index to be rebuilt on the next lookup.
     *
     * Exposed for mutation paths that modify window.data.characters
     * in a way that does not change the array reference or its
     * length (in-place field replacement of a character record).
     * Calling this is safe at any time; the next resolveCharacter
     * rebuilds the index from scratch.
     *
     * When CharacterQueries is loaded, this function is a no-op for
     * the resolution path (the delegation bypasses the local
     * index), but it still clears the fallback index for the case
     * where CharacterQueries later becomes unavailable.
     */
    function invalidateCharacterIndex() {
        _charIndex = null;
        _charIndexSourceRef = null;
        _charIndexSourceLength = -1;
    }

    /**
     * Resolve a character ID or character object to a character
     * object. Returns null when the input cannot be resolved.
     *
     * Object form: used directly, no lookup.
     * ID form: CharacterQueries first, local memoized fallback.
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

        // ID form: preferred path.
        var CQ = getCharacterQueries();
        if (CQ && typeof CQ.getCharacterById === 'function') {
            var found = CQ.getCharacterById(charIdOrObject);
            return found || null;
        }

        // Fallback: local index.
        var idx = getLocalCharacterIndex();
        var local = idx.get(String(charIdOrObject));
        return local || null;
    }

    // ============================================================
    // RECORD VALIDITY (E6 fail-closed)
    // ============================================================
    //
    // A record is usable only when BOTH its year and week parse.
    // Everything else skips it. This is the fail-closed policy the
    // header documents; it makes the two views agree.

    function normaliseElimination(elim) {
        if (!elim || typeof elim !== 'object') { return null; }
        var year = parseYear(elim.year);
        if (year === null) { return null; }
        var week = parseWeek(elim.week);
        if (week === null) { return null; }
        return {
            raw: elim,
            year: year,
            week: week,
            reason: typeof elim.reason === 'string'
                ? elim.reason
                : ''
        };
    }

    // ============================================================
    // HAS-ELIMINATIONS PREDICATE (E1)
    // ============================================================
    //
    // True iff the character has at least one usable elimination
    // record (year and week both parse). This is the predicate
    // callers should use instead of
    // getEliminationWeek(charId) === null as a "has none" check.
    //
    // A character with a year-only record returns false under this
    // predicate, because the record is unusable under the
    // fail-closed policy.

    /**
     * Does the character have at least one usable elimination
     * record?
     *
     * @param {string|object} charIdOrObject
     * @returns {boolean}
     */
    function hasEliminations(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return false; }
        if (!Array.isArray(char.eliminations)) { return false; }

        for (var i = 0; i < char.eliminations.length; i++) {
            if (normaliseElimination(char.eliminations[i]) !== null) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // EARLIEST ELIMINATION (E3)
    // ============================================================
    //
    // Returns the earliest usable elimination record's year, week,
    // and reason from the SAME entry. The previous API exposed
    // getEliminationWeek and getEliminationYear independently, each
    // returning the minimum of its own field — which meant a
    // character with records in different years got a week from one
    // record and a year from another. Any UI that paired them
    // (the elimination banner) showed a mismatched week/year.
    //
    // Ordering: smallest year first; ties broken by smallest week;
    // ties broken again by reason presence (a record with a usable
    // reason wins over one without, so the display has more to
    // show).

    /**
     * Get the earliest usable elimination record.
     *
     * @param {string|object} charIdOrObject
     * @returns {object|null} { week, year, reason }
     */
    function getEarliestElimination(charIdOrObject) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return null; }
        if (!Array.isArray(char.eliminations)) { return null; }

        var best = null;
        var bestYear = Infinity;
        var bestWeek = Infinity;
        var bestHasReason = false;

        for (var i = 0; i < char.eliminations.length; i++) {
            var norm = normaliseElimination(char.eliminations[i]);
            if (norm === null) { continue; }

            var hasReason = norm.reason.trim() !== '';
            var better = false;

            if (norm.year < bestYear) {
                better = true;
            } else if (norm.year === bestYear) {
                if (norm.week < bestWeek) {
                    better = true;
                } else if (norm.week === bestWeek &&
                           hasReason && !bestHasReason) {
                    better = true;
                }
            }

            if (better) {
                bestYear = norm.year;
                bestWeek = norm.week;
                bestHasReason = hasReason;
                best = {
                    week: norm.week,
                    year: norm.year,
                    reason: norm.reason
                };
            }
        }

        return best;
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
     * YEAR SCOPING:
     *   With no third argument, this query is year-blind: an
     *   elimination in week 3 of 1920 answers "yes" for week 10 of
     *   1930. Callers that know the year should pass it.
     *
     *   With a third argument, only records whose year matches are
     *   considered. A record whose year does not match is skipped,
     *   regardless of its week.
     *
     *   Under the fail-closed policy, a record must have both a
     *   usable year and a usable week to be counted at all.
     *
     * @param {string|object} charIdOrObject - Character ID or object
     * @param {number|string} week - Week number
     * @param {number|string} [year] - Optional year to scope by
     * @returns {boolean}
     */
    function isCharacterEliminatedByWeek(charIdOrObject, week, year) {
        var char = resolveCharacter(charIdOrObject);
        if (!char) { return false; }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return false;
        }

        if (!Array.isArray(char.eliminations)) {
            return false;
        }

        var yearFilter = (year === undefined || year === null)
            ? null
            : parseYear(year);
        if (year !== undefined && year !== null &&
            yearFilter === null) {
            // Caller asked for a year scope but gave an unusable
            // year. Fail closed.
            return false;
        }

        for (var i = 0; i < char.eliminations.length; i++) {
            var norm = normaliseElimination(char.eliminations[i]);
            if (norm === null) { continue; }

            if (yearFilter !== null && norm.year !== yearFilter) {
                continue;
            }

            // Strictly less than: elimination at week E counts as
            // "eliminated before week W" only when E < W.
            if (norm.week < weekNum) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the earliest elimination WEEK across all usable records.
     *
     * SEMANTICS:
     *   Returns the smallest week value across every usable
     *   elimination record on the character. This is NOT "the week
     *   the character was most recently eliminated" and it is NOT
     *   "the current tournament's elimination week." It is the
     *   earliest elimination the character has ever recorded, by
     *   week value alone.
     *
     *   Because week is only meaningful inside a single year, and
     *   because a character can have eliminations in multiple
     *   years, this value is only coherent when the caller knows
     *   the character's eliminations all belong to one year.
     *
     *   Callers that want the week and its year together should use
     *   getEarliestElimination.
     *
     *   Returns null when the character has no usable elimination
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
            var norm = normaliseElimination(char.eliminations[i]);
            if (norm === null) { continue; }

            if (earliest === null || norm.week < earliest) {
                earliest = norm.week;
            }
        }

        return earliest;
    }

    /**
     * Get the reason from the character's EARLIEST usable
     * elimination, ordered by year then week.
     *
     * SEMANTICS:
     *   Picks the earliest usable elimination record that carries
     *   a usable reason, and returns that reason. Ordering is by
     *   year first, then week, matching getEarliestElimination.
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

        var best = null;
        var bestYear = Infinity;
        var bestWeek = Infinity;

        for (var i = 0; i < char.eliminations.length; i++) {
            var norm = normaliseElimination(char.eliminations[i]);
            if (norm === null) { continue; }
            if (norm.reason.trim() === '') { continue; }

            var better = false;
            if (norm.year < bestYear) {
                better = true;
            } else if (norm.year === bestYear &&
                       norm.week < bestWeek) {
                better = true;
            }

            if (better) {
                bestYear = norm.year;
                bestWeek = norm.week;
                best = norm.reason;
            }
        }

        return best !== null ? best : 'Unknown';
    }

    /**
     * Get the IDs of every character eliminated BEFORE the given
     * week.
     *
     * Uses the same strictly-less-than boundary as
     * isCharacterEliminatedByWeek. Year-blind (no year filter is
     * applied); pass a year in the character list if you need year
     * scoping.
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
     *   A character with a usable elimination in year Y is
     *   eliminated for every year >= Y. A character with no usable
     *   eliminations is not eliminated for any year. The boundary
     *   is INCLUSIVE: eliminated in year Y answers "yes" for year
     *   Y itself.
     *
     *   Under the fail-closed policy, a record must have both a
     *   usable year and a usable week to be counted. A record with
     *   a year but a malformed week is skipped here as well.
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
            var norm = normaliseElimination(char.eliminations[i]);
            if (norm === null) { continue; }

            if (norm.year <= yearNum) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get the earliest elimination YEAR across all usable records.
     *
     * SEMANTICS:
     *   Returns the smallest year value across every usable
     *   elimination record on the character. This is "the year the
     *   character was first eliminated," which is what the
     *   character-list badge and the Academic tab banner both
     *   display.
     *
     *   Callers that want the year and its week together should use
     *   getEarliestElimination. Callers that want only the year can
     *   keep using this function.
     *
     *   Returns null when the character has no usable elimination
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
            var norm = normaliseElimination(char.eliminations[i]);
            if (norm === null) { continue; }

            if (earliest === null || norm.year < earliest) {
                earliest = norm.year;
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
            var norm = normaliseElimination(char.eliminations[i]);
            if (norm === null) { continue; }

            if (char.eliminatedWeeks.indexOf(norm.week) === -1) {
                char.eliminatedWeeks.push(norm.week);
            }
        }

        char.eliminatedWeeks.sort(function(a, b) { return a - b; });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.EliminationQueries = {
        // Has-any predicate (E1)
        hasEliminations: hasEliminations,

        // Earliest record (E3)
        getEarliestElimination: getEarliestElimination,

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
        rebuildEliminatedWeeks: rebuildEliminatedWeeks,

        // Cache control (fallback-index invalidation only; the
        // preferred id resolver is CharacterQueries, which owns its
        // own invalidation)
        invalidateCharacterIndex: invalidateCharacterIndex
    };

})();
