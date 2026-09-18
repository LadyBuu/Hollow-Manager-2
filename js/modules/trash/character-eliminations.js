/**
 * js/modules/characters/character-eliminations.js - Character Eliminations
 * Handles tournament and standalone eliminations for characters.
 *
 * Path: js/modules/characters/character-eliminations.js
 *
 * RESPONSIBILITIES:
 *   - Add standalone eliminations (via MutationPipeline)
 *   - Remove standalone eliminations (via MutationPipeline)
 *   - Mark / unmark tournament eliminations (via MutationPipeline)
 *   - Remove all eliminations (via MutationPipeline)
 *   - Provide a cascade strip helper for character deletion
 *
 *   QUERY functions are DELEGATED to EliminationQueries, which is the
 *   single source of truth for elimination read semantics. This module
 *   does NOT reimplement the week-boundary rule or the elimination
 *   source-of-truth rule.
 *
 * IMPORTANT:
 *   All mutations use MutationPipeline:
 *     VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI COMMIT
 *   Returns structured results for caller handling.
 *   No UI dependencies. No DOM access.
 *
 * ELIMINATION vs DECEASED:
 *   These are separate concepts.
 *     - An ELIMINATION is a competitive-exam outcome: the character
 *       is knocked out of the running and cannot participate in
 *       subsequent exams.
 *     - DECEASED is a life event: the character is no longer alive.
 *   A character can be deceased without being eliminated, eliminated
 *   without being deceased, both, or neither.
 *
 *   This module operates on eliminations only. It does not read or
 *   write character.deceased or character.deathWeek.
 *
 * WEEK BOUNDARY SEMANTICS:
 *   A character eliminated in week N is ELIGIBLE during week N and
 *   INELIGIBLE from week N+1 onward. "Eliminated at week N" means
 *   "eliminated at the END of week N", not "at the START".
 *
 *   Concretely:
 *     isCharacterEliminatedByWeek(char, N)       → false
 *     isCharacterEliminatedByWeek(char, N + 1)   → true
 *
 *   The boundary is STRICTLY LESS THAN: an elimination at week E
 *   counts as "before" week W when E < W.
 *
 * ELIMINATION SOURCES OF TRUTH:
 *   character.eliminations[] is the ONLY source of truth. Each entry
 *   is:
 *     {
 *       id: string,
 *       tournamentId: string | null,
 *       week: number,
 *       reason: string,
 *       standalone: boolean,
 *       fromMatch: boolean
 *     }
 *
 *   The derived character.eliminatedWeeks[] field is a cache rebuilt
 *   from (1) after every mutation. It is NOT a source of truth.
 *
 * WEEK SEMANTICS:
 *   Weeks are bounded by CalendarConstants.MIN_WEEK / MAX_WEEK.
 *   Week parsing is strict: integers and integer strings only. No
 *   silent coercion of "12garbage" to 12.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.TournamentQueries
 *   - window.EliminationQueries
 *   - window.MutationPipeline
 *   - window.IdUtils
 *   - window.CalendarConstants
 *
 * USAGE:
 *   var CE = window.CharacterEliminations;
 *
 *   CE.addStandalone('char_123', 5, 'Dropped out')
 *       .then(function(result) { ... });
 *
 *   CE.markTournamentEliminated('char_123', 'tourn_789', 3)
 *       .then(function(result) { ... });
 *
 *   // Read queries (delegated to EliminationQueries):
 *   var eliminated = CE.isCharacterEliminatedByWeek(charObj, 5);
 *   var week = CE.getEliminationWeek(charObj);
 *   var reason = CE.getEliminationReason(charObj);
 */

(function() {
    'use strict';

    if (window.__characterEliminationsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TournamentQueries = window.TournamentQueries;
    var EliminationQueries = window.EliminationQueries;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!TournamentQueries ||
        typeof TournamentQueries.getTournament !== 'function') {
        _missing.push('TournamentQueries.getTournament');
    }
    if (!EliminationQueries ||
        typeof EliminationQueries.isCharacterEliminatedByWeek !== 'function') {
        _missing.push('EliminationQueries.isCharacterEliminatedByWeek');
    }
    if (!EliminationQueries ||
        typeof EliminationQueries.getEliminationWeek !== 'function') {
        _missing.push('EliminationQueries.getEliminationWeek');
    }
    if (!EliminationQueries ||
        typeof EliminationQueries.getEliminationReason !== 'function') {
        _missing.push('EliminationQueries.getEliminationReason');
    }
    if (!EliminationQueries ||
        typeof EliminationQueries.getEliminatedCharacters !== 'function') {
        _missing.push('EliminationQueries.getEliminatedCharacters');
    }
    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK / MAX_WEEK');
    }

    if (_missing.length > 0) {
        throw new Error(
            'CharacterEliminations: Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__characterEliminationsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // WEEK PARSING
    // ============================================================
    //
    // Strict. Accepts integers in range and pure-integer strings.
    // Rejects floats, trailing characters, NaN, and out-of-range
    // values. No silent coercion.

    function parseWeek(value) {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'number') {
            if (!Number.isInteger(value)) { return null; }
            if (value < MIN_WEEK || value > MAX_WEEK) { return null; }
            return value;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            if (!Number.isInteger(n)) { return null; }
            if (n < MIN_WEEK || n > MAX_WEEK) { return null; }
            return n;
        }

        return null;
    }

    function validateWeek(week) {
        return parseWeek(week) !== null;
    }

    // ============================================================
    // DERIVED-CACHE MAINTENANCE
    // ============================================================

    /**
     * Rebuild the derived eliminatedWeeks array from eliminations.
     * Mutates the character in place. Called only inside pipeline
     * mutate() callbacks.
     *
     * eliminatedWeeks is a convenience cache: a sorted, deduplicated
     * list of every valid elimination week. It is NOT a source of
     * truth. Readers that need the semantics should call
     * EliminationQueries.
     */
    function rebuildEliminatedWeeks(char) {
        if (!char) return;

        if (!Array.isArray(char.eliminations)) {
            char.eliminations = [];
        }

        char.eliminatedWeeks = [];

        char.eliminations.forEach(function(e) {
            var week = parseWeek(e.week);
            if (week !== null && char.eliminatedWeeks.indexOf(week) === -1) {
                char.eliminatedWeeks.push(week);
            }
        });

        char.eliminatedWeeks.sort(function(a, b) { return a - b; });
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    /**
     * Does this character have an elimination record with the given
     * week? Used for preflight duplicate detection. This is a
     * shape-level check, not a semantic one — it asks "is there an
     * elimination at exactly this week", not "is this character
     * eliminated at or before this week".
     */
    function hasEliminationAtWeek(char, weekNum) {
        if (!char || !Array.isArray(char.eliminations)) {
            return false;
        }
        for (var i = 0; i < char.eliminations.length; i++) {
            var w = parseWeek(char.eliminations[i].week);
            if (w !== null && w === weekNum) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // QUERIES - DELEGATED TO EliminationQueries
    // ============================================================
    //
    // These are pass-throughs. The canonical implementation lives in
    // EliminationQueries. Any behaviour change to the week boundary,
    // the source-of-truth rule, or the treatment of deceased
    // characters belongs there, not here.

    function isCharacterEliminatedByWeek(charIdOrObject, week) {
        return EliminationQueries.isCharacterEliminatedByWeek(
            charIdOrObject, week
        );
    }

    function getEliminationWeek(charIdOrObject) {
        return EliminationQueries.getEliminationWeek(charIdOrObject);
    }

    function getEliminationReason(charIdOrObject) {
        return EliminationQueries.getEliminationReason(charIdOrObject);
    }

    function getEliminatedCharacters(week, characters) {
        return EliminationQueries.getEliminatedCharacters(week, characters);
    }

    // ============================================================
    // ADD STANDALONE ELIMINATION
    // ============================================================

    function addStandalone(charId, week, reason) {
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
                message: 'Week must be between ' +
                    MIN_WEEK + ' and ' + MAX_WEEK + '.'
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

        // Preflight duplicate check: reject when the character
        // already has an elimination at exactly this week. This is
        // independent of the "eliminated before week N" semantic:
        // a character who is going to be eliminated at week N for
        // the first time is not yet "eliminated before week N", so
        // the strictly-less-than boundary would not catch a
        // same-week duplicate.
        if (hasEliminationAtWeek(char, weekNum)) {
            return Promise.resolve({
                success: false,
                message: 'This character already has an elimination ' +
                    'recorded for week ' + weekNum + '.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                if (hasEliminationAtWeek(currentChar, weekNum)) {
                    return {
                        valid: false,
                        message: 'Character already has an elimination ' +
                            'recorded for week ' + weekNum + '.'
                    };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                if (!Array.isArray(currentChar.eliminations)) {
                    currentChar.eliminations = [];
                }

                var elimination = {
                    id: IdUtils.generateId('elim'),
                    tournamentId: null,
                    week: weekNum,
                    reason: reason,
                    standalone: true,
                    fromMatch: false
                };

                currentChar.eliminations.push(elimination);
                rebuildEliminatedWeeks(currentChar);

                return {
                    elimination: elimination,
                    characterId: charId,
                    week: weekNum,
                    reason: reason
                };
            },
            logMessage: function() {
                return 'Eliminated ' + name +
                    ' (standalone, week ' + weekNum + '): ' + reason;
            },
            successMessage: function() {
                return 'Character eliminated successfully!';
            },
            failureMessage: 'Failed to add elimination.'
        });
    }

    // ============================================================
    // REMOVE STANDALONE ELIMINATION
    // ============================================================

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

        var targetId = String(eliminationId);

        var elim = null;
        if (Array.isArray(char.eliminations)) {
            elim = char.eliminations.find(function(e) {
                return e && e.standalone && String(e.id) === targetId;
            });
        }

        if (!elim) {
            return Promise.resolve({
                success: false,
                message: 'Standalone elimination not found.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);
        var elimWeek = elim.week;
        var elimReason = elim.reason || '';

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                var currentElim = null;
                if (Array.isArray(currentChar.eliminations)) {
                    currentElim = currentChar.eliminations.find(function(e) {
                        return e && e.standalone &&
                            String(e.id) === targetId;
                    });
                }
                if (!currentElim) {
                    return {
                        valid: false,
                        message: 'Standalone elimination no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }
                if (!Array.isArray(currentChar.eliminations)) {
                    throw new Error('No eliminations found.');
                }

                var found = false;
                currentChar.eliminations =
                    currentChar.eliminations.filter(function(e) {
                        if (e && e.standalone &&
                            String(e.id) === targetId) {
                            found = true;
                            return false;
                        }
                        return true;
                    });

                if (!found) {
                    throw new Error('Standalone elimination not found.');
                }

                rebuildEliminatedWeeks(currentChar);

                return {
                    characterId: charId,
                    eliminationId: targetId,
                    week: elimWeek,
                    reason: elimReason
                };
            },
            logMessage: function(result) {
                return 'Removed standalone elimination for ' + name +
                    ' (week ' + result.week + ')';
            },
            successMessage: function() {
                return 'Standalone elimination removed.';
            },
            failureMessage: 'Failed to remove elimination.'
        });
    }

    // ============================================================
    // MARK TOURNAMENT ELIMINATION
    // ============================================================

    function markTournamentEliminated(charId, tournamentId, week, reason) {
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (!tournamentId) {
            return Promise.resolve({
                success: false,
                message: 'Tournament ID is required.'
            });
        }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return Promise.resolve({
                success: false,
                message: 'Week must be between ' +
                    MIN_WEEK + ' and ' + MAX_WEEK + '.'
            });
        }

        reason = reason && typeof reason === 'string'
            ? reason.trim()
            : 'Eliminated from tournament';

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var tourn = TournamentQueries.getTournament(tournamentId);
        if (!tourn) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        // Preflight duplicate: reject when the character already has
        // an elimination for this tournament. Tournaments span one
        // week block; the (character, tournament) pair is the
        // identity, not the week.
        var alreadyExists = false;
        if (Array.isArray(char.eliminations)) {
            alreadyExists = char.eliminations.some(function(e) {
                return e && !e.standalone &&
                    String(e.tournamentId) === String(tournamentId);
            });
        }

        if (alreadyExists) {
            return Promise.resolve({
                success: false,
                message: 'Character is already eliminated from this ' +
                    'tournament.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                var currentTourn =
                    TournamentQueries.getTournament(tournamentId);
                if (!currentTourn) {
                    return {
                        valid: false,
                        message: 'Tournament no longer exists.'
                    };
                }
                var currentExists = false;
                if (Array.isArray(currentChar.eliminations)) {
                    currentExists = currentChar.eliminations.some(
                        function(e) {
                            return e && !e.standalone &&
                                String(e.tournamentId) ===
                                    String(tournamentId);
                        }
                    );
                }
                if (currentExists) {
                    return {
                        valid: false,
                        message: 'Character is already eliminated from ' +
                            'this tournament.'
                    };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                if (!Array.isArray(currentChar.eliminations)) {
                    currentChar.eliminations = [];
                }

                var elimination = {
                    id: IdUtils.generateId('elim'),
                    tournamentId: tournamentId,
                    week: weekNum,
                    reason: reason,
                    standalone: false,
                    fromMatch: true
                };

                currentChar.eliminations.push(elimination);
                rebuildEliminatedWeeks(currentChar);

                return {
                    elimination: elimination,
                    characterId: charId,
                    tournamentId: tournamentId,
                    tournamentName: tourn.name,
                    week: weekNum,
                    reason: reason
                };
            },
            logMessage: function(result) {
                return 'Eliminated ' + name + ' from ' +
                    result.tournamentName + ' (week ' + result.week + ')';
            },
            successMessage: function() {
                return 'Character eliminated from tournament!';
            },
            failureMessage: 'Failed to mark character eliminated.'
        });
    }

    // ============================================================
    // UNMARK TOURNAMENT ELIMINATION
    // ============================================================

    function unmarkTournamentEliminated(charId, tournamentId) {
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (!tournamentId) {
            return Promise.resolve({
                success: false,
                message: 'Tournament ID is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var tourn = TournamentQueries.getTournament(tournamentId);
        if (!tourn) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        var elim = null;
        if (Array.isArray(char.eliminations)) {
            elim = char.eliminations.find(function(e) {
                return e && !e.standalone &&
                    String(e.tournamentId) === String(tournamentId);
            });
        }

        if (!elim) {
            return Promise.resolve({
                success: false,
                message: 'Character is not eliminated from this tournament.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);
        var elimWeek = elim.week;

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                var currentTourn =
                    TournamentQueries.getTournament(tournamentId);
                if (!currentTourn) {
                    return {
                        valid: false,
                        message: 'Tournament no longer exists.'
                    };
                }
                var currentElim = null;
                if (Array.isArray(currentChar.eliminations)) {
                    currentElim = currentChar.eliminations.find(function(e) {
                        return e && !e.standalone &&
                            String(e.tournamentId) ===
                                String(tournamentId);
                    });
                }
                if (!currentElim) {
                    return {
                        valid: false,
                        message: 'Character is not eliminated from this ' +
                            'tournament.'
                    };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }
                if (!Array.isArray(currentChar.eliminations)) {
                    throw new Error('No eliminations found.');
                }

                var found = false;
                currentChar.eliminations =
                    currentChar.eliminations.filter(function(e) {
                        if (e && !e.standalone &&
                            String(e.tournamentId) ===
                                String(tournamentId)) {
                            found = true;
                            return false;
                        }
                        return true;
                    });

                if (!found) {
                    throw new Error('Elimination not found.');
                }

                rebuildEliminatedWeeks(currentChar);

                return {
                    characterId: charId,
                    tournamentId: tournamentId,
                    tournamentName: tourn.name,
                    week: elimWeek
                };
            },
            logMessage: function(result) {
                return 'Restored ' + name + ' from ' +
                    result.tournamentName;
            },
            successMessage: function() {
                return 'Character restored from tournament!';
            },
            failureMessage: 'Failed to unmark character eliminated.'
        });
    }

    // ============================================================
    // REMOVE ALL ELIMINATIONS
    // ============================================================

    function removeAllEliminations(charId) {
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var count = Array.isArray(char.eliminations)
            ? char.eliminations.length
            : 0;
        if (count === 0) {
            return Promise.resolve({
                success: true,
                count: 0,
                message: 'No eliminations to remove.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                var removedCount = Array.isArray(currentChar.eliminations)
                    ? currentChar.eliminations.length
                    : 0;
                currentChar.eliminations = [];
                rebuildEliminatedWeeks(currentChar);

                return { removedCount: removedCount };
            },
            logMessage: function(result) {
                return 'Removed ' + result.removedCount +
                    ' eliminations from ' + name;
            },
            successMessage: function(result) {
                return 'Removed ' + result.removedCount + ' eliminations.';
            },
            failureMessage: 'Failed to remove eliminations.'
        });
    }

    // ============================================================
    // CASCADE HELPER
    // ============================================================
    //
    // Strip all eliminations for a character from an appData snapshot.
    // Pure w.r.t. appData. Called from CharacterCRUD.deleteCharacter
    // inside its pipeline transaction.
    //
    // In practice this is a no-op when the character is being removed
    // entirely (the character record disappears with its eliminations
    // attached). It exists so that a future partial-delete path — or
    // a caller that wants to keep the character but clear their
    // eliminations — has a canonical entry point.

    function stripCharacterRefs(appData, charId) {
        var result = { eliminationsRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }
        if (!Array.isArray(appData.characters)) {
            return result;
        }

        var target = String(charId);
        var character = null;
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && String(c.id) === target) {
                character = c;
                break;
            }
        }

        if (!character) {
            return result;
        }

        if (Array.isArray(character.eliminations)) {
            result.eliminationsRemoved = character.eliminations.length;
            character.eliminations = [];
        }
        character.eliminatedWeeks = [];

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterEliminations = {
        // Mutations
        addStandalone: addStandalone,
        removeStandalone: removeStandalone,
        markTournamentEliminated: markTournamentEliminated,
        unmarkTournamentEliminated: unmarkTournamentEliminated,
        removeAllEliminations: removeAllEliminations,

        // Queries (delegated to EliminationQueries)
        isCharacterEliminatedByWeek: isCharacterEliminatedByWeek,
        getEliminationWeek: getEliminationWeek,
        getEliminationReason: getEliminationReason,
        getEliminatedCharacters: getEliminatedCharacters,

        // Utilities
        validateWeek: validateWeek,
        rebuildEliminatedWeeks: rebuildEliminatedWeeks,

        // Cascade helpers
        stripCharacterRefs: stripCharacterRefs,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
