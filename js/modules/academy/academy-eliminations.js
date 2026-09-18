/**
 * modules/academy/academy-eliminations.js - Academy Eliminations
 * Character-side standalone elimination mutations.
 *
 * Path: js/modules/academy/academy-eliminations.js
 *
 * This module owns the STANDALONE elimination mutations for
 * characters: the Drop Out flow, and the undo of a mistaken Drop
 * Out. It does NOT own:
 *
 *   - Reads. EliminationQueries is the read authority
 *     (isCharacterEliminatedByWeek, isCharacterEliminatedByYear,
 *     getEliminationWeek, getEliminationYear, etc.).
 *
 *   - Tournament-generated eliminations. TournamentEliminationCascade
 *     owns those, including the cascade on match completion and the
 *     reversal on remove/reopen.
 *
 *   - The character-side mirror of a tournament elimination. The
 *     cascade writes that record itself, transaction-locally.
 *
 *   - The derived character.eliminatedWeeks[] cache. The single
 *     implementation lives in EliminationQueries.rebuildEliminatedWeeks.
 *     This module calls it after every write or removal.
 *
 * WHY THIS MODULE IS IN ACADEMY, NOT CHARACTERS:
 *   The Drop Out action is initiated from the Academy People view's
 *   character detail panel. Elimination is an academic outcome — a
 *   character is knocked out of the competitive exam sequence — and
 *   the surrounding context (the class, the current week) is Academy
 *   state. Putting the mutation here keeps the Academy view's
 *   dependency surface self-contained: the view calls
 *   AcademyEliminations, not a character-domain module it would
 *   otherwise have to reach across tabs for.
 *
 * ELIMINATION vs DECEASED:
 *   These are separate concepts. This module operates on eliminations
 *   only. It does not read or write character.deceased or
 *   character.deathWeek. A character can be deceased without being
 *   eliminated, eliminated without being deceased, both, or neither.
 *
 * YEAR SEMANTICS (v25+):
 *   Every elimination record carries a `year` — the year the
 *   character was eliminated. Elimination at year Y means eliminated
 *   from year Y onward.
 *
 *   Resolution order at write time:
 *     1. Explicit `year` argument, when supplied and valid.
 *     2. The character's sole class's year, when the character is a
 *        member of exactly one class with a numeric year.
 *     3. window.data.currentYear.
 *     4. The current calendar year.
 *
 *   Steps 3 and 4 log a warning. A missing class year is a
 *   data-quality signal, not a silent default.
 *
 * WEEK SEMANTICS:
 *   Weeks are parsed by CalendarValidation.parseWeek, the canonical
 *   strict parser. Integers and pure-integer strings in [MIN_WEEK,
 *   MAX_WEEK]. No silent coercion of trailing characters.
 *
 *   Week is retained for display and intra-year ordering. The
 *   duplicate check uses (year, week): two drop-outs on the same
 *   week of two different years are distinct events.
 *
 * DUPLICATE SEMANTICS:
 *   addStandalone rejects a Drop Out when the character already has
 *   an elimination with the same (year, week). This is a shape-level
 *   duplicate check, not a semantic one: it does not ask whether the
 *   character is eliminated as of some year. A character eliminated
 *   in a tournament and then dropped out in the same week of the
 *   same year is a distinct record and is allowed.
 *
 * MUTATION CONTRACT:
 *   Both public mutations return a Promise<{ success, data?, message? }>.
 *   Both route through MutationPipeline. Both are atomic: if
 *   persistence fails, the transaction rolls back.
 *
 * UNDO SEMANTICS:
 *   removeStandalone is the undo path. It removes a standalone
 *   elimination by ID. It does NOT touch tournament-driven
 *   eliminations (those have their own reversal path via the
 *   cascade) and does NOT touch any other record on the character.
 *
 *   The pipeline's own rollback handles a failed removal. If the
 *   user needs to undo a successful removal, they re-add the record
 *   via addStandalone with the same week and year.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.EliminationQueries
 *   - window.MutationPipeline
 *   - window.IdUtils
 *   - window.CalendarValidation
 *
 * DEPENDENCIES (LAZY):
 *   - window.AcademyClasses    (resolving the character's sole class year)
 *
 * USAGE:
 *   var AE = window.AcademyEliminations;
 *
 *   AE.addStandalone('char_123', 5, 'Dropped out')
 *       .then(function(result) { ... });
 *
 *   AE.addStandalone('char_123', 5, 'Dropped out', 2026)
 *       .then(function(result) { ... });
 *
 *   AE.removeStandalone('char_123', 'elim_abc')
 *       .then(function(result) { ... });
 */

(function() {
    'use strict';

    if (window.__academyEliminationsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var EliminationQueries = window.EliminationQueries;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;
    var CalendarValidation = window.CalendarValidation;

    var _missing = [];

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!EliminationQueries ||
        typeof EliminationQueries.rebuildEliminatedWeeks !== 'function') {
        _missing.push('EliminationQueries.rebuildEliminatedWeeks');
    }
    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyEliminations] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyEliminationsLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY ACCESSOR
    // ============================================================

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function parseWeek(value) {
        return CalendarValidation.parseWeek(value);
    }

    function buildReason(week) {
        return 'Dropped out';
    }

    // ============================================================
    // YEAR RESOLUTION
    // ============================================================

    /**
     * Resolve the elimination year for a standalone elimination.
     *
     * Resolution order:
     *   1. Explicit `year` argument (integer >= 1).
     *   2. The character's sole class's year, when the character is a
     *      member of exactly one class with a numeric year.
     *   3. window.data.currentYear.
     *   4. The current calendar year.
     *
     * @param {object} char - Character object
     * @param {number|string} [explicitYear]
     * @returns {number} integer >= 1
     */
    function resolveStandaloneYear(char, explicitYear) {
        var y = parseInt(explicitYear, 10);
        if (!isNaN(y) && y > 0) {
            return y;
        }

        var AcademyClasses = getAcademyClasses();
        if (AcademyClasses &&
            typeof AcademyClasses.getClass === 'function' &&
            char && Array.isArray(char.classIds) &&
            char.classIds.length === 1) {
            var cls = null;
            try {
                cls = AcademyClasses.getClass(char.classIds[0]);
            } catch (e) {
                cls = null;
            }
            if (cls) {
                var clsYear = parseInt(cls.year, 10);
                if (!isNaN(clsYear) && clsYear > 0) {
                    return clsYear;
                }
            }
        }

        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            console.warn(
                '[AcademyEliminations] Could not resolve a class year ' +
                'for standalone elimination of "' +
                (char ? char.id : 'unknown') +
                '". Falling back to currentYear (' +
                data.currentYear + ').'
            );
            return Math.floor(data.currentYear);
        }

        console.warn(
            '[AcademyEliminations] Could not resolve a class year for ' +
            'standalone elimination of "' +
            (char ? char.id : 'unknown') +
            '" and no currentYear is set. Using calendar year.'
        );
        return new Date().getFullYear();
    }

    // ============================================================
    // DUPLICATE CHECK
    // ============================================================

    /**
     * Does this character have an elimination record with the given
     * (year, week)?
     *
     * Shape-level check: it asks "is there an elimination at exactly
     * this year and week", not "is this character eliminated as of
     * some year". Two records can share a week if their years differ.
     */
    function hasEliminationAtYearWeek(char, yearNum, weekNum) {
        if (!char || !Array.isArray(char.eliminations)) {
            return false;
        }
        for (var i = 0; i < char.eliminations.length; i++) {
            var e = char.eliminations[i];
            if (!e) { continue; }
            var eWeek = parseWeek(e.week);
            var eYear = parseInt(e.year, 10);
            if (eWeek === weekNum && eYear === yearNum) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // ADD STANDALONE
    // ============================================================

    /**
     * Add a standalone elimination (Drop Out).
     *
     * @param {string} charId
     * @param {number|string} week
     * @param {string} [reason]
     * @param {number|string} [year] - Optional explicit elimination
     *   year. When absent, the year is resolved from the character's
     *   sole class, then from window.data.currentYear.
     * @returns {Promise<{success, data?, message?}>}
     */
    function addStandalone(charId, week, reason, year) {
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return Promise.resolve({
                success: false,
                message: 'Valid week is required.'
            });
        }

        reason = reason && typeof reason === 'string'
            ? reason.trim()
            : 'Dropped out';

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var yearNum = resolveStandaloneYear(char, year);

        if (hasEliminationAtYearWeek(char, yearNum, weekNum)) {
            return Promise.resolve({
                success: false,
                message: 'This character already has an elimination ' +
                    'recorded for year ' + yearNum +
                    ', week ' + weekNum + '.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);
        var targetId = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                if (!Array.isArray(appData.characters)) {
                    return {
                        valid: false,
                        message: 'Character store is not available.'
                    };
                }
                var found = null;
                for (var i = 0; i < appData.characters.length; i++) {
                    var c = appData.characters[i];
                    if (c && String(c.id) === targetId) {
                        found = c;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                var currentYear = resolveStandaloneYear(found, year);
                if (hasEliminationAtYearWeek(found, currentYear, weekNum)) {
                    return {
                        valid: false,
                        message: 'Character already has an elimination ' +
                            'recorded for year ' + currentYear +
                            ', week ' + weekNum + '.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var currentChar = null;
                for (var i = 0; i < appData.characters.length; i++) {
                    var c = appData.characters[i];
                    if (c && String(c.id) === targetId) {
                        currentChar = c;
                        break;
                    }
                }
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                if (!Array.isArray(currentChar.eliminations)) {
                    currentChar.eliminations = [];
                }

                var stampYear = resolveStandaloneYear(currentChar, year);

                var elimination = {
                    id: IdUtils.generateId('elim'),
                    tournamentId: null,
                    year: stampYear,
                    week: weekNum,
                    reason: reason,
                    standalone: true,
                    fromMatch: false
                };

                currentChar.eliminations.push(elimination);
                EliminationQueries.rebuildEliminatedWeeks(currentChar);

                return {
                    elimination: elimination,
                    characterId: targetId,
                    year: stampYear,
                    week: weekNum,
                    reason: reason
                };
            },
            logMessage: function(result) {
                return 'Eliminated ' + name +
                    ' (standalone, year ' + result.year +
                    ', week ' + result.week + '): ' + reason;
            },
            successMessage: 'Character eliminated successfully.',
            failureMessage: 'Failed to add elimination.'
        });
    }

    // ============================================================
    // REMOVE STANDALONE
    // ============================================================

    /**
     * Remove a standalone elimination by ID. This is the undo path
     * for a mistaken Drop Out.
     *
     * Only standalone records are removable through this function.
     * Tournament-driven eliminations have their own reversal path in
     * TournamentEliminationCascade, keyed to the match or round that
     * produced them.
     *
     * @param {string} charId
     * @param {string} eliminationId
     * @returns {Promise<{success, data?, message?}>}
     */
    function removeStandalone(charId, eliminationId) {
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (!eliminationId) {
            return Promise.resolve({
                success: false,
                message: 'Elimination ID is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var targetElim = String(eliminationId);

        var elim = null;
        if (Array.isArray(char.eliminations)) {
            for (var i = 0; i < char.eliminations.length; i++) {
                var e = char.eliminations[i];
                if (e && e.standalone === true &&
                    String(e.id) === targetElim) {
                    elim = e;
                    break;
                }
            }
        }

        if (!elim) {
            return Promise.resolve({
                success: false,
                message: 'Standalone elimination not found.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);
        var elimYear = elim.year;
        var elimWeek = elim.week;
        var targetCharId = String(charId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                if (!Array.isArray(appData.characters)) {
                    return {
                        valid: false,
                        message: 'Character store is not available.'
                    };
                }
                var found = null;
                for (var i = 0; i < appData.characters.length; i++) {
                    var c = appData.characters[i];
                    if (c && String(c.id) === targetCharId) {
                        found = c;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                var hasElim = false;
                if (Array.isArray(found.eliminations)) {
                    for (var j = 0; j < found.eliminations.length; j++) {
                        var e = found.eliminations[j];
                        if (e && e.standalone === true &&
                            String(e.id) === targetElim) {
                            hasElim = true;
                            break;
                        }
                    }
                }
                if (!hasElim) {
                    return {
                        valid: false,
                        message: 'Standalone elimination no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var currentChar = null;
                for (var i = 0; i < appData.characters.length; i++) {
                    var c = appData.characters[i];
                    if (c && String(c.id) === targetCharId) {
                        currentChar = c;
                        break;
                    }
                }
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }
                if (!Array.isArray(currentChar.eliminations)) {
                    throw new Error('No eliminations found.');
                }

                var removed = false;
                var kept = [];
                for (var j = 0; j < currentChar.eliminations.length; j++) {
                    var e = currentChar.eliminations[j];
                    if (e && e.standalone === true &&
                        String(e.id) === targetElim) {
                        removed = true;
                        continue;
                    }
                    kept.push(e);
                }
                if (!removed) {
                    throw new Error('Standalone elimination not found.');
                }

                currentChar.eliminations = kept;
                EliminationQueries.rebuildEliminatedWeeks(currentChar);

                return {
                    characterId: targetCharId,
                    eliminationId: targetElim,
                    year: elimYear,
                    week: elimWeek
                };
            },
            logMessage: function(result) {
                var parts = [];
                if (result.year !== undefined && result.year !== null) {
                    parts.push('year ' + result.year);
                }
                if (result.week !== undefined && result.week !== null) {
                    parts.push('week ' + result.week);
                }
                var suffix = parts.length > 0
                    ? ' (' + parts.join(', ') + ')'
                    : '';
                return 'Removed standalone elimination for ' + name +
                    suffix;
            },
            successMessage: 'Standalone elimination removed.',
            failureMessage: 'Failed to remove elimination.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyEliminations = Object.freeze({
        addStandalone: addStandalone,
        removeStandalone: removeStandalone
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyEliminations;
        var missing = [];

        var required = ['addStandalone', 'removeStandalone'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyEliminations] Verification - some exports may ' +
                'be missing:', missing.join(', ')
            );
        }
    })();

})();
