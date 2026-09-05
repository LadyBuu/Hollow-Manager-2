/**
 * js/modules/characters/character-eliminations.js - Character Eliminations
 * Handles tournament and standalone eliminations for characters
 * Path: js/modules/characters/character-eliminations.js
 * 
 * This module is responsible for:
 *   - Adding standalone eliminations (via MutationPipeline)
 *   - Removing standalone eliminations (via MutationPipeline)
 *   - Marking/unmarking tournament eliminations (via MutationPipeline)
 *   - Querying elimination status
 * 
 * IMPORTANT: All mutations use MutationPipeline:
 *   VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI COMMIT
 *   Returns structured results for caller handling
 *   No UI dependencies (no notifications, no confirm, no rendering)
 *   No DOM access
 *   USES CharacterQueries for character data and display names
 *   USES TournamentQueries for tournament lookup
 *   USES MutationPipeline for transaction management
 *   USES IdUtils for ID generation
 *   USES CALENDAR_CONSTANTS for week bounds
 * 
 * ELIMINATION SOURCES OF TRUTH:
 *   1. eliminations array - explicit elimination records (tournament or standalone)
 *   2. deceased + deathWeek - character death as a timeline boundary
 *   - BOTH are checked in isCharacterEliminatedByWeek()
 *   - eliminatedWeeks is DERIVED, never the source of truth
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.CALENDAR_CONSTANTS (from constants.js) - MANDATORY
 * 
 * USAGE:
 *   var CE = window.CharacterEliminations;
 *   CE.addStandalone('char_123', 5, 'Dropped out')
 *      .then(function(result) { ... });
 *   CE.removeStandalone('char_123', 'elim_456')
 *      .then(function(result) { ... });
 *   CE.markTournamentEliminated('char_123', 'tourn_789', 3)
 *      .then(function(result) { ... });
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterEliminationsLoaded) {
        return;
    }
    window.__characterEliminationsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TournamentQueries = window.TournamentQueries;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;
    var CalendarConstants = window.CALENDAR_CONSTANTS;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants ? CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = CalendarConstants ? CalendarConstants.MAX_WEEK : 52;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        // TournamentQueries is MANDATORY
        if (!TournamentQueries || typeof TournamentQueries.getTournamentById !== 'function') {
            missing.push('TournamentQueries.getTournamentById');
        }

        // MutationPipeline is MANDATORY
        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        // IdUtils is MANDATORY
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        // CalendarConstants is MANDATORY
        if (!CalendarConstants) {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (missing.length > 0) {
            console.warn('CharacterEliminations: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // CORE QUERIES - Pure functions
    // ============================================================

    /**
     * Validate a week number.
     * 
     * @param {*} week - Week value to validate
     * @returns {boolean} True if valid
     */
    function validateWeek(week) {
        var num = Number(week);
        return Number.isInteger(num) && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    /**
     * Rebuild the eliminatedWeeks array from eliminations.
     * This is a DERIVED field - it should never be the source of truth.
     * 
     * @param {object} char - Character object
     */
    function rebuildEliminatedWeeks(char) {
        if (!char) return;

        if (!Array.isArray(char.eliminations)) {
            char.eliminations = [];
        }

        char.eliminatedWeeks = [];

        char.eliminations.forEach(function(e) {
            var week = Number(e.week);
            if (Number.isInteger(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                if (char.eliminatedWeeks.indexOf(week) === -1) {
                    char.eliminatedWeeks.push(week);
                }
            }
        });

        char.eliminatedWeeks.sort(function(a, b) { return a - b; });
    }

    /**
     * Check if a character is eliminated by a given week.
     * Combines explicit elimination records with death timeline data.
     * 
     * @param {object} char - Character object
     * @param {number} week - Week number
     * @returns {boolean} True if eliminated by or before the given week
     */
    function isCharacterEliminatedByWeek(char, week) {
        if (!char) return false;

        var weekNum = Number(week);
        if (!Number.isInteger(weekNum) || weekNum < MIN_WEEK) {
            return false;
        }

        // Check explicit elimination records FIRST - only valid weeks
        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];
        for (var i = 0; i < eliminations.length; i++) {
            var elimWeek = Number(eliminations[i].week);
            if (Number.isInteger(elimWeek) &&
                elimWeek >= MIN_WEEK &&
                elimWeek <= MAX_WEEK &&
                elimWeek <= weekNum) {
                return true;
            }
        }

        // Then check death timeline
        if (char.deceased) {
            var deathWeekNum = Number(char.deathWeek);
            var hasValidDeathWeek = (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== '' &&
                Number.isInteger(deathWeekNum) &&
                deathWeekNum >= MIN_WEEK &&
                deathWeekNum <= MAX_WEEK
            );

            if (hasValidDeathWeek) {
                return deathWeekNum <= weekNum;
            }

            // Deceased with missing or invalid deathWeek = unavailable entirely
            return true;
        }

        return false;
    }

    /**
     * Get the week when a character was eliminated.
     * 
     * @param {object} char - Character object
     * @returns {number|null} Elimination week or null
     */
    function getEliminationWeek(char) {
        if (!char) return null;

        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];
        var earliestWeek = null;

        for (var i = 0; i < eliminations.length; i++) {
            var week = Number(eliminations[i].week);
            if (Number.isInteger(week) && week >= MIN_WEEK && week <= MAX_WEEK) {
                if (earliestWeek === null || week < earliestWeek) {
                    earliestWeek = week;
                }
            }
        }

        // Check death
        if (char.deceased) {
            var deathWeekNum = Number(char.deathWeek);
            var hasValidDeathWeek = (
                char.deathWeek !== undefined &&
                char.deathWeek !== null &&
                char.deathWeek !== '' &&
                Number.isInteger(deathWeekNum) &&
                deathWeekNum >= MIN_WEEK &&
                deathWeekNum <= MAX_WEEK
            );

            if (hasValidDeathWeek) {
                if (earliestWeek === null || deathWeekNum < earliestWeek) {
                    earliestWeek = deathWeekNum;
                }
            } else {
                // Deceased with invalid deathWeek - considered eliminated from week 1
                if (earliestWeek === null || 1 < earliestWeek) {
                    earliestWeek = 1;
                }
            }
        }

        return earliestWeek;
    }

    /**
     * Get the reason for elimination.
     * 
     * @param {object} char - Character object
     * @returns {string} Elimination reason
     */
    function getEliminationReason(char) {
        if (!char) return 'Unknown';

        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];

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
     * Get eliminated characters for a given week.
     * 
     * @param {number} week - Week number
     * @param {Array} characters - Array of characters (optional, uses window.data if not provided)
     * @returns {Array} Array of eliminated character IDs
     */
    function getEliminatedCharacters(week, characters) {
        var weekNum = Number(week);
        if (!Number.isInteger(weekNum) || weekNum < MIN_WEEK) {
            return [];
        }

        if (!characters) {
            var data = window.data || {};
            characters = Array.isArray(data.characters) ? data.characters : [];
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
    // ADD STANDALONE ELIMINATION - Uses MutationPipeline
    // ============================================================

    /**
     * Add a standalone elimination for a character.
     * 
     * @param {string} charId - Character ID
     * @param {number} week - Week number
     * @param {string} reason - Reason for elimination
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addStandalone(charId, week, reason) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        var weekNum = Number(week);
        if (!validateWeek(weekNum)) {
            return Promise.resolve({
                success: false,
                message: 'Week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'
            });
        }

        reason = reason && typeof reason === 'string' ? reason.trim() : 'Dropped out';

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
                message: 'This character is already eliminated at or before week ' + weekNum + '.'
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
                        message: 'Character is already eliminated at or before week ' + weekNum + '.'
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

            logMessage: function(result) {
                return 'Eliminated ' + name + ' (standalone, week ' + weekNum + '): ' + reason;
            },

            successMessage: function(result) {
                return 'Character eliminated successfully!';
            },
            failureMessage: 'Failed to add elimination.'
        });
    }

    // ============================================================
    // REMOVE STANDALONE ELIMINATION - Uses MutationPipeline
    // ============================================================

    /**
     * Remove a standalone elimination by ID.
     * 
     * @param {string} charId - Character ID
     * @param {string} eliminationId - Elimination ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function removeStandalone(charId, eliminationId) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

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

        // Find the elimination (read-only check)
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
                        return e && e.standalone && String(e.id) === targetId;
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
                currentChar.eliminations = currentChar.eliminations.filter(function(e) {
                    if (e && e.standalone && String(e.id) === targetId) {
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
                return 'Removed standalone elimination for ' + name + ' (week ' + result.week + ')';
            },

            successMessage: function(result) {
                return 'Standalone elimination removed.';
            },
            failureMessage: 'Failed to remove elimination.'
        });
    }

    // ============================================================
    // MARK TOURNAMENT ELIMINATION - Uses MutationPipeline
    // ============================================================

    /**
     * Mark a character as eliminated from a tournament.
     * 
     * @param {string} charId - Character ID
     * @param {string} tournamentId - Tournament ID
     * @param {number} week - Week number
     * @param {string} reason - Reason for elimination
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function markTournamentEliminated(charId, tournamentId, week, reason) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

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

        var weekNum = Number(week);
        if (!validateWeek(weekNum)) {
            return Promise.resolve({
                success: false,
                message: 'Week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'
            });
        }

        reason = reason && typeof reason === 'string' ? reason.trim() : 'Eliminated from tournament';

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var tourn = TournamentQueries.getTournamentById(tournamentId);
        if (!tourn) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        if (isCharacterEliminatedByWeek(char, weekNum)) {
            return Promise.resolve({
                success: false,
                message: 'Character is already eliminated at or before week ' + weekNum + '.'
            });
        }

        // Check if already eliminated from this tournament
        var alreadyExists = false;
        if (Array.isArray(char.eliminations)) {
            alreadyExists = char.eliminations.some(function(e) {
                return e && !e.standalone && String(e.tournamentId) === String(tournamentId);
            });
        }

        if (alreadyExists) {
            return Promise.resolve({
                success: false,
                message: 'Character is already eliminated from this tournament.'
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

                var currentTourn = TournamentQueries.getTournamentById(tournamentId);
                if (!currentTourn) {
                    return {
                        valid: false,
                        message: 'Tournament no longer exists.'
                    };
                }

                if (isCharacterEliminatedByWeek(currentChar, weekNum)) {
                    return {
                        valid: false,
                        message: 'Character is already eliminated at or before week ' + weekNum + '.'
                    };
                }

                var currentExists = false;
                if (Array.isArray(currentChar.eliminations)) {
                    currentExists = currentChar.eliminations.some(function(e) {
                        return e && !e.standalone && String(e.tournamentId) === String(tournamentId);
                    });
                }

                if (currentExists) {
                    return {
                        valid: false,
                        message: 'Character is already eliminated from this tournament.'
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
                return 'Eliminated ' + name + ' from ' + result.tournamentName + ' (week ' + result.week + ')';
            },

            successMessage: function(result) {
                return 'Character eliminated from tournament!';
            },
            failureMessage: 'Failed to mark character eliminated.'
        });
    }

    // ============================================================
    // UNMARK TOURNAMENT ELIMINATION - Uses MutationPipeline
    // ============================================================

    /**
     * Unmark a character as eliminated from a tournament.
     * 
     * @param {string} charId - Character ID
     * @param {string} tournamentId - Tournament ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function unmarkTournamentEliminated(charId, tournamentId) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

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

        var tourn = TournamentQueries.getTournamentById(tournamentId);
        if (!tourn) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        // Find the elimination (read-only check)
        var elim = null;
        if (Array.isArray(char.eliminations)) {
            elim = char.eliminations.find(function(e) {
                return e && !e.standalone && String(e.tournamentId) === String(tournamentId);
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

                var currentTourn = TournamentQueries.getTournamentById(tournamentId);
                if (!currentTourn) {
                    return {
                        valid: false,
                        message: 'Tournament no longer exists.'
                    };
                }

                var currentElim = null;
                if (Array.isArray(currentChar.eliminations)) {
                    currentElim = currentChar.eliminations.find(function(e) {
                        return e && !e.standalone && String(e.tournamentId) === String(tournamentId);
                    });
                }

                if (!currentElim) {
                    return {
                        valid: false,
                        message: 'Character is not eliminated from this tournament.'
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
                currentChar.eliminations = currentChar.eliminations.filter(function(e) {
                    if (e && !e.standalone && String(e.tournamentId) === String(tournamentId)) {
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
                return 'Restored ' + name + ' from ' + result.tournamentName;
            },

            successMessage: function(result) {
                return 'Character restored from tournament!';
            },
            failureMessage: 'Failed to unmark character eliminated.'
        });
    }

    // ============================================================
    // REMOVE ALL ELIMINATIONS - Uses MutationPipeline
    // ============================================================

    /**
     * Remove all eliminations for a character.
     * 
     * @param {string} charId - Character ID
     * @returns {Promise<{ success: boolean, count?: number, message?: string }>}
     */
    function removeAllEliminations(charId) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

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

        var count = Array.isArray(char.eliminations) ? char.eliminations.length : 0;
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

                var removedCount = Array.isArray(currentChar.eliminations) ? currentChar.eliminations.length : 0;
                currentChar.eliminations = [];
                rebuildEliminatedWeeks(currentChar);

                return { removedCount: removedCount };
            },

            logMessage: function(result) {
                return 'Removed ' + result.removedCount + ' eliminations from ' + name;
            },

            successMessage: function(result) {
                return 'Removed ' + result.removedCount + ' eliminations.';
            },
            failureMessage: 'Failed to remove eliminations.'
        });
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

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();