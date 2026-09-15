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
 *   - Query elimination status
 *   - Provide a cascade strip helper for character deletion
 *
 * IMPORTANT:
 *   All mutations use MutationPipeline:
 *     VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI COMMIT
 *   Returns structured results for caller handling.
 *   No UI dependencies. No DOM access.
 *
 * ELIMINATION SOURCES OF TRUTH:
 *   1. character.eliminations[] — explicit elimination records
 *      (tournament or standalone).
 *   2. character.deceased + character.deathWeek — the death timeline
 *      as an implicit elimination boundary.
 *   Both are checked by isCharacterEliminatedByWeek. The derived
 *   character.eliminatedWeeks[] field is NOT a source of truth; it is
 *   rebuilt from (1) after every mutation.
 *
 * WEEK SEMANTICS:
 *   Weeks are bounded by CalendarConstants.MIN_WEEK / MAX_WEEK.
 *   Week parsing is strict: integers and integer strings only. No
 *   silent coercion of "12garbage" to 12.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.TournamentQueries
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
    // CORE QUERIES - Pure functions
    // ============================================================

    /**
     * Rebuild the derived eliminatedWeeks array from eliminations.
     * Mutates the character in place. Called only inside pipeline
     * mutate() callbacks.
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

    /**
     * Is the character eliminated by the given week?
     *
     * Checks explicit elimination records first, then the death
     * timeline. A deceased character with no valid deathWeek is
     * treated as eliminated from week 1.
     */
    function isCharacterEliminatedByWeek(char, week) {
        if (!char) return false;

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return false;
        }

        // Explicit elimination records.
        var eliminations = Array.isArray(char.eliminations)
            ? char.eliminations
            : [];
        for (var i = 0; i < eliminations.length; i++) {
            var elimWeek = parseWeek(eliminations[i].week);
            if (elimWeek !== null && elimWeek <= weekNum) {
                return true;
            }
        }

        // Death timeline.
        if (char.deceased) {
            var deathWeek = parseWeek(char.deathWeek);
            var hasValidDeathWeek = (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== '' &&
                deathWeek !== null
            );

            if (hasValidDeathWeek) {
                return deathWeek <= weekNum;
            }
            return true;
        }

        return false;
    }

    /**
     * Earliest week at which the character is eliminated.
     * Considers explicit eliminations and the death timeline.
     */
    function getEliminationWeek(char) {
        if (!char) return null;

        var eliminations = Array.isArray(char.eliminations)
            ? char.eliminations
            : [];
        var earliest = null;

        for (var i = 0; i < eliminations.length; i++) {
            var week = parseWeek(eliminations[i].week);
            if (week !== null) {
                if (earliest === null || week < earliest) {
                    earliest = week;
                }
            }
        }

        if (char.deceased) {
            var deathWeek = parseWeek(char.deathWeek);
            var hasValidDeathWeek = (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== '' &&
                deathWeek !== null
            );

            if (hasValidDeathWeek) {
                if (earliest === null || deathWeek < earliest) {
                    earliest = deathWeek;
                }
            } else {
                if (earliest === null || MIN_WEEK < earliest) {
                    earliest = MIN_WEEK;
                }
            }
        }

        return earliest;
    }

    /**
     * Human-readable reason for the character's elimination.
     */
    function getEliminationReason(char) {
        if (!char) return 'Unknown';

        var eliminations = Array.isArray(char.eliminations)
            ? char.eliminations
            : [];

        for (var i = 0; i < eliminations.length; i++) {
            if (eliminations[i] && eliminations[i].reason) {
                return eliminations[i].reason;
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

    /**
     * IDs of every character eliminated at or before the given week.
     */
    function getEliminatedCharacters(week, characters) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        if (!characters) {
            var data = window.data || {};
            characters = Array.isArray(data.characters)
                ? data.characters
                : [];
        }

        var result = [];
        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (isCharacterEliminatedByWeek(char, weekNum)) {
                result.push(char.id);
            }
        }
        return result;
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

        if (isCharacterEliminatedByWeek(char, weekNum)) {
            return Promise.resolve({
                success: false,
                message: 'This character is already eliminated at or ' +
                    'before week ' + weekNum + '.'
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
                if (isCharacterEliminatedByWeek(currentChar, weekNum)) {
                    return {
                        valid: false,
                        message: 'Character is already eliminated at or ' +
                            'before week ' + weekNum + '.'
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

        if (isCharacterEliminatedByWeek(char, weekNum)) {
            return Promise.resolve({
                success: false,
                message: 'Character is already eliminated at or ' +
                    'before week ' + weekNum + '.'
            });
        }

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
                if (isCharacterEliminatedByWeek(currentChar, weekNum)) {
                    return {
                        valid: false,
                        message: 'Character is already eliminated at or ' +
                            'before week ' + weekNum + '.'
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

        // Queries
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
