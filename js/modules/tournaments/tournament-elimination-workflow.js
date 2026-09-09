/**
 * modules/tournaments/tournament-elimination-workflow.js - Tournament Elimination Workflow
 * Cross-domain elimination operations for tournaments
 * Path: js/modules/tournaments/tournament-elimination-workflow.js
 * 
 * This module is responsible for:
 *   - Marking a character as eliminated from a tournament
 *   - Restoring a character from tournament elimination
 *   - Cross-domain atomic validation (tournament + character)
 *   - Coordinating tournament and character state changes
 *   - Using TournamentCore + TournamentMatches for tournament mutations
 *   - Using CharacterEliminations for character mutations
 * 
 * IMPORTANT:
 *   - This is a CROSS-DOMAIN WORKFLOW combining:
 *     - TournamentCore (tournament eliminations)
 *     - TournamentsMatches (match state updates)
 *     - CharacterEliminations (character eliminations, eliminatedWeeks)
 *   - All operations are CANDIDATE-BASED: validate, build candidates, commit
 *   - This module does NOT call saveData()
 *   - This module does NOT log activity
 *   - MutationPipeline owns persistence and activity logging
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - Cross-domain consistency: tournament and character states must remain in sync
 * 
 * DEPENDENCIES (lazily loaded):
 *   - window.TournamentCore - Tournament operations
 *   - window.TournamentsMatches - Match operations
 *   - window.TournamentSchema - Structural validation
 *   - window.TournamentLifecycle - Lifecycle permissions
 *   - window.TournamentRules - Domain conditions
 *   - window.TournamentQueries - Read operations
 *   - window.CharacterQueries - Character queries
 *   - window.CharacterEliminations - Character elimination mutations
 *   - window.CalendarValidation - Week validation
 *   - window.IdUtils - ID normalisation
 *   - window.MutationPipeline - Persistence
 * 
 * USAGE:
 *   var workflow = window.TournamentEliminationWorkflow;
 *   var result = workflow.markCharacterEliminated(tournamentId, characterId, week, reason);
 *   var result = workflow.unmarkCharacterEliminated(tournamentId, characterId);
 */

(function() {
    'use strict';

    if (window.__tournamentEliminationWorkflowLoaded) {
        return;
    }

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getTournamentCore() {
        return window.TournamentCore || null;
    }

    function getTournamentsMatches() {
        return window.TournamentsMatches || null;
    }

    function getTournamentSchema() {
        return window.TournamentSchema || null;
    }

    function getTournamentLifecycle() {
        return window.TournamentLifecycle || null;
    }

    function getTournamentRules() {
        return window.TournamentRules || null;
    }

    function getTournamentQueries() {
        return window.TournamentQueries || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getCharacterEliminations() {
        return window.CharacterEliminations || null;
    }

    function getCalendarValidation() {
        return window.CalendarValidation || null;
    }

    function getIdUtils() {
        return window.IdUtils || null;
    }

    function getMutationPipeline() {
        return window.MutationPipeline || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getTournamentCore()) {
            missing.push('TournamentCore (lazy)');
        }
        if (!getTournamentsMatches()) {
            missing.push('TournamentsMatches (lazy)');
        }
        if (!getTournamentSchema()) {
            missing.push('TournamentSchema (lazy)');
        }
        if (!getTournamentLifecycle()) {
            missing.push('TournamentLifecycle (lazy)');
        }
        if (!getTournamentRules()) {
            missing.push('TournamentRules (lazy)');
        }
        if (!getTournamentQueries()) {
            missing.push('TournamentQueries (lazy)');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries (lazy)');
        }
        if (!getCharacterEliminations()) {
            missing.push('CharacterEliminations (lazy)');
        }
        if (!getCalendarValidation()) {
            missing.push('CalendarValidation (lazy)');
        }
        if (!getIdUtils()) {
            missing.push('IdUtils (lazy)');
        }
        if (!getMutationPipeline()) {
            missing.push('MutationPipeline (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[TournamentEliminationWorkflow] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function normaliseId(value) {
        var IdUtils = getIdUtils();
        if (IdUtils && typeof IdUtils.normaliseId === 'function') {
            return IdUtils.normaliseId(value);
        }
        if (value === null || value === undefined) {
            return null;
        }
        var str = String(value).trim();
        return str !== '' ? str : null;
    }

    function isValidWeek(value) {
        var CalendarValidation = getCalendarValidation();
        if (CalendarValidation && typeof CalendarValidation.parseWeek === 'function') {
            return CalendarValidation.parseWeek(value) !== null;
        }
        var num = parseInt(value, 10);
        return !isNaN(num) && num >= 1 && num <= 52;
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function getDataStore() {
        return window.data || {};
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // REBUILD ELIMINATED WEEKS
    // ============================================================

    /**
     * Rebuild eliminated weeks from eliminations data.
     * This ensures derived state remains consistent with source data.
     * This is a PURE function that does NOT mutate the input.
     * 
     * @param {object} char - Character object
     * @returns {array} Array of eliminated week numbers
     */
    function rebuildEliminatedWeeks(char) {
        var CalendarValidation = getCalendarValidation();

        if (!char || typeof char !== 'object') {
            return [];
        }

        if (!Array.isArray(char.eliminations)) {
            return [];
        }

        var weeks = [];
        var seen = {};

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim || typeof elim !== 'object') {
                continue;
            }

            var week = CalendarValidation ? CalendarValidation.parseWeek(elim.week) : null;
            if (week === null) {
                continue;
            }

            var key = String(week);
            if (!seen[key]) {
                seen[key] = true;
                weeks.push(week);
            }
        }

        weeks.sort(function(a, b) {
            return a - b;
        });

        return weeks;
    }

    /**
     * Build a complete proposed character state for elimination mutations.
     * 
     * @param {object} char - Character object
     * @param {string} tournamentId - Tournament ID
     * @param {object} charElimination - Character elimination record
     * @returns {object} Proposed character state
     */
    function buildProposedCharacterState(char, tournamentId, charElimination) {
        var proposedChar = {
            id: char.id,
            firstName: char.firstName,
            lastName: char.lastName,
            eliminations: Array.isArray(char.eliminations) ? char.eliminations.slice() : [],
            eliminatedWeeks: []
        };

        // Preserve other properties
        for (var key in char) {
            if (Object.prototype.hasOwnProperty.call(char, key) &&
                key !== 'id' && key !== 'firstName' && key !== 'lastName' &&
                key !== 'eliminations' && key !== 'eliminatedWeeks') {
                proposedChar[key] = char[key];
            }
        }

        proposedChar.eliminations.push({
            tournamentId: tournamentId,
            week: charElimination.week,
            reason: charElimination.reason,
            standalone: false,
            fromMatch: true
        });

        // Rebuild derived state
        proposedChar.eliminatedWeeks = rebuildEliminatedWeeks(proposedChar);

        return proposedChar;
    }

    /**
     * Validate a proposed character state.
     * 
     * @param {object} proposedChar - Proposed character state
     * @param {string} tournamentId - Tournament ID
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateProposedCharacter(proposedChar, tournamentId) {
        if (!proposedChar || typeof proposedChar !== 'object') {
            return { valid: false, message: 'Invalid character state.' };
        }

        if (!Array.isArray(proposedChar.eliminations)) {
            return { valid: false, message: 'Character eliminations must be an array.' };
        }

        var tournamentIdNormalised = normaliseId(tournamentId);
        if (tournamentIdNormalised === null) {
            return { valid: false, message: 'Invalid tournament ID.' };
        }

        // Check for duplicate tournament eliminations
        var count = 0;
        for (var i = 0; i < proposedChar.eliminations.length; i++) {
            var e = proposedChar.eliminations[i];
            if (e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised) {
                count++;
            }
        }

        if (count > 1) {
            return { valid: false, message: 'Duplicate tournament elimination found.' };
        }

        // Check that eliminatedWeeks is consistent with eliminations
        var expectedWeeks = rebuildEliminatedWeeks(proposedChar);
        var actualWeeks = proposedChar.eliminatedWeeks || [];

        if (expectedWeeks.length !== actualWeeks.length) {
            return { valid: false, message: 'Eliminated weeks are inconsistent with eliminations.' };
        }

        for (var i = 0; i < expectedWeeks.length; i++) {
            if (actualWeeks.indexOf(expectedWeeks[i]) === -1) {
                return { valid: false, message: 'Eliminated weeks are inconsistent with eliminations.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // MUTATION PIPELINE WRAPPER
    // ============================================================

    /**
     * Execute a mutation through MutationPipeline.
     * 
     * @param {object} config - Mutation configuration
     * @param {string} config.logMessage - Activity log message
     * @param {string} config.successMessage - Success notification message
     * @param {string} config.failureMessage - Failure notification message
     * @param {function} config.validate - Validation function
     * @param {function} config.mutate - Mutation function
     * @param {function} config.onSuccess - Success callback
     * @param {function} config.onFailure - Failure callback
     * @returns {Promise<object>} { success: boolean, data?: any, message?: string }
     */
    function executeMutation(config) {
        var Pipeline = getMutationPipeline();
        if (!Pipeline || typeof Pipeline.performMutation !== 'function') {
            return Promise.resolve({
                success: false,
                message: 'MutationPipeline not available.'
            });
        }

        return Pipeline.performMutation({
            validate: config.validate || function(data) {
                return { valid: true };
            },
            mutate: config.mutate,
            logMessage: config.logMessage || 'Elimination operation performed.',
            successMessage: config.successMessage || 'Operation completed.',
            failureMessage: config.failureMessage || 'Operation failed.',
            onSuccess: config.onSuccess || null,
            onFailure: config.onFailure || null
        });
    }

    // ============================================================
    // MARK CHARACTER ELIMINATED
    // ============================================================

    /**
     * Mark a character as eliminated from a tournament.
     * Cross-domain atomic: validates BOTH tournament and character states before mutation.
     * 
     * OPERATION RULE: Elimination week must fall within tournament week range.
     * LIFECYCLE RULE: Only active tournaments can have eliminations.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} characterId - Character ID
     * @param {number|string} week - Week of elimination
     * @param {string} reason - Reason for elimination (optional)
     * @returns {Promise<object>} { success: boolean, message?: string, data?: object }
     */
    function markCharacterEliminated(tournamentId, characterId, week, reason) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var CalendarValidation = getCalendarValidation();

        var weekNum = CalendarValidation ? CalendarValidation.parseWeek(week) : null;
        if (weekNum === null) {
            var Schema = getTournamentSchema();
            var minWeek = Schema ? Schema.MIN_WEEK || 1 : 1;
            var maxWeek = Schema ? Schema.MAX_WEEK || 52 : 52;
            return Promise.resolve(failure('Invalid week: must be between ' + minWeek + ' and ' + maxWeek));
        }

        var eliminationReason = typeof reason === 'string' && reason.trim() !== ''
            ? reason.trim()
            : 'Eliminated from tournament';

        var characterIdNormalised = normaliseId(characterId);
        if (characterIdNormalised === null) {
            return Promise.resolve(failure('Invalid character ID.'));
        }

        var tournamentIdNormalised = normaliseId(tournamentId);
        if (tournamentIdNormalised === null) {
            return Promise.resolve(failure('Invalid tournament ID.'));
        }

        // ---- PHASE 2: RETRIEVE AND VALIDATE TOURNAMENT ----
        var Queries = getTournamentQueries();
        if (!Queries) {
            return Promise.resolve(failure('TournamentQueries not available.'));
        }

        var tournament = Queries.getTournament(tournamentIdNormalised);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        // Validate tournament structure
        var Schema = getTournamentSchema();
        if (Schema) {
            var structValidation = Schema.validateTournament(tournament, { strict: false });
            if (!structValidation.valid) {
                return Promise.resolve(failure('Tournament data is malformed.'));
            }
        }

        // ---- PHASE 3: LIFECYCLE CHECK ----
        var Lifecycle = getTournamentLifecycle();
        if (Lifecycle && !Lifecycle.canModifyEliminations(tournament)) {
            return Promise.resolve(failure('Eliminations cannot be modified in tournament status "' + tournament.status + '".'));
        }

        // OPERATION RULE: Elimination week must be within tournament bounds
        if (weekNum < tournament.startWeek || weekNum > tournament.endWeek) {
            return Promise.resolve(failure('Elimination week ' + weekNum + ' is outside tournament week range ' +
                tournament.startWeek + '-' + tournament.endWeek));
        }

        // ---- PHASE 4: CHECK PARTICIPANT ----
        if (!Schema || !Schema.isParticipantInTournament(tournament, characterIdNormalised)) {
            return Promise.resolve(failure('Character is not a participant in this tournament.'));
        }

        var participantType = Schema ? Schema.getParticipantTypeFromRecord(tournament, characterIdNormalised) : null;
        if (participantType !== 'character') {
            return Promise.resolve(failure('Participant is not a character (type: ' + participantType + ').'));
        }

        // Check if already eliminated
        if (Schema && Schema.isParticipantEliminated(tournament, characterIdNormalised)) {
            return Promise.resolve(failure('Character is already eliminated from this tournament.'));
        }

        // ---- PHASE 5: RETRIEVE AND VALIDATE CHARACTER ----
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return Promise.resolve(failure('CharacterQueries not available.'));
        }

        var char = CharacterQueries.getCharacterById(characterIdNormalised);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        // ---- PHASE 6: CHECK IF CHARACTER IS ELIMINATED BY OTHER MEANS ----
        var CharacterEliminations = getCharacterEliminations();
        if (CharacterEliminations && typeof CharacterEliminations.isCharacterEliminatedByWeek === 'function') {
            if (CharacterEliminations.isCharacterEliminatedByWeek(char, weekNum)) {
                return Promise.resolve(failure('Character is already eliminated at or before week ' + weekNum + '.'));
            }
        }

        // ---- PHASE 7: BUILD PROPOSED CHARACTER STATE ----
        var charElimination = {
            week: weekNum,
            reason: eliminationReason
        };

        var proposedChar = buildProposedCharacterState(char, tournamentIdNormalised, charElimination);

        var charValidation = validateProposedCharacter(proposedChar, tournamentIdNormalised);
        if (!charValidation.valid) {
            return Promise.resolve(failure('Character state validation failed: ' + charValidation.message));
        }

        // ---- PHASE 8: BUILD PROPOSED TOURNAMENT STATE ----
        var tournamentElimination = {
            participantId: characterIdNormalised,
            participantType: 'character',
            week: weekNum,
            reason: eliminationReason
        };

        var proposedTournament = Object.assign({}, tournament);
        proposedTournament.eliminations = Array.isArray(tournament.eliminations)
            ? tournament.eliminations.slice()
            : [];
        proposedTournament.eliminations.push(tournamentElimination);

        // Validate proposed tournament against schema
        if (Schema) {
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: false });
            if (!tournValidation.valid) {
                var errors = tournValidation.errors.join('; ');
                return Promise.resolve(failure('Tournament validation failed: ' + errors));
            }
        }

        // ---- PHASE 9: EXECUTE MUTATION ----
        var targetTournamentId = tournamentIdNormalised;
        var targetCharacterId = characterIdNormalised;
        var targetWeek = weekNum;
        var targetReason = eliminationReason;
        var proposedCharCopy = JSON.parse(JSON.stringify(proposedChar));
        var proposedTournamentCopy = JSON.parse(JSON.stringify(proposedTournament));

        return executeMutation({
            validate: function(data) {
                // Re-validate within transaction
                var currentTournament = null;
                if (Array.isArray(data.tournaments)) {
                    for (var i = 0; i < data.tournaments.length; i++) {
                        if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === targetTournamentId) {
                            currentTournament = data.tournaments[i];
                            break;
                        }
                    }
                }

                if (!currentTournament) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }

                var currentChar = null;
                if (Array.isArray(data.characters)) {
                    for (var i = 0; i < data.characters.length; i++) {
                        if (data.characters[i] && normaliseId(data.characters[i].id) === targetCharacterId) {
                            currentChar = data.characters[i];
                            break;
                        }
                    }
                }

                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                return { valid: true };
            },
            mutate: function(data) {
                // Find and update tournament
                var tournIndex = -1;
                for (var i = 0; i < data.tournaments.length; i++) {
                    if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === targetTournamentId) {
                        tournIndex = i;
                        break;
                    }
                }

                if (tournIndex === -1) {
                    throw new Error('Tournament not found in data store.');
                }

                // Find and update character
                var charIndex = -1;
                if (Array.isArray(data.characters)) {
                    for (var i = 0; i < data.characters.length; i++) {
                        if (data.characters[i] && normaliseId(data.characters[i].id) === targetCharacterId) {
                            charIndex = i;
                            break;
                        }
                    }
                }

                if (charIndex === -1) {
                    throw new Error('Character not found in data store.');
                }

                // Apply tournament mutation
                data.tournaments[tournIndex].eliminations = proposedTournamentCopy.eliminations;

                // Apply character mutation
                var targetChar = data.characters[charIndex];
                targetChar.eliminations = proposedCharCopy.eliminations;
                targetChar.eliminatedWeeks = proposedCharCopy.eliminatedWeeks;

                return {
                    tournamentId: targetTournamentId,
                    characterId: targetCharacterId,
                    week: targetWeek,
                    reason: targetReason
                };
            },
            logMessage: function(result) {
                var CharacterQueries = getCharacterQueries();
                var name = CharacterQueries ? CharacterQueries.getCharacterNameById(targetCharacterId) : targetCharacterId;
                return 'Eliminated ' + name + ' from tournament (week ' + targetWeek + '): ' + targetReason;
            },
            successMessage: 'Character eliminated from tournament.',
            failureMessage: 'Failed to eliminate character from tournament.'
        });
    }

    // ============================================================
    // UNMARK CHARACTER ELIMINATED
    // ============================================================

    /**
     * Restore a character from tournament elimination.
     * Cross-domain atomic: validates BOTH tournament and character states before mutation.
     * 
     * LIFECYCLE RULE: Only active tournaments can have eliminations restored.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} characterId - Character ID
     * @returns {Promise<object>} { success: boolean, message?: string, data?: object }
     */
    function unmarkCharacterEliminated(tournamentId, characterId) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var characterIdNormalised = normaliseId(characterId);
        if (characterIdNormalised === null) {
            return Promise.resolve(failure('Invalid character ID.'));
        }

        var tournamentIdNormalised = normaliseId(tournamentId);
        if (tournamentIdNormalised === null) {
            return Promise.resolve(failure('Invalid tournament ID.'));
        }

        // ---- PHASE 2: RETRIEVE AND VALIDATE TOURNAMENT ----
        var Queries = getTournamentQueries();
        if (!Queries) {
            return Promise.resolve(failure('TournamentQueries not available.'));
        }

        var tournament = Queries.getTournament(tournamentIdNormalised);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        // Validate tournament structure
        var Schema = getTournamentSchema();
        if (Schema) {
            var structValidation = Schema.validateTournament(tournament, { strict: false });
            if (!structValidation.valid) {
                return Promise.resolve(failure('Tournament data is malformed.'));
            }
        }

        // ---- PHASE 3: LIFECYCLE CHECK ----
        var Lifecycle = getTournamentLifecycle();
        if (Lifecycle && !Lifecycle.canModifyEliminations(tournament)) {
            return Promise.resolve(failure('Eliminations cannot be modified in tournament status "' + tournament.status + '".'));
        }

        // ---- PHASE 4: CHECK ELIMINATION EXISTS ----
        if (!Schema || !Schema.isParticipantEliminated(tournament, characterIdNormalised)) {
            return Promise.resolve(failure('Character is not eliminated from this tournament.'));
        }

        // ---- PHASE 5: RETRIEVE CHARACTER ----
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return Promise.resolve(failure('CharacterQueries not available.'));
        }

        var char = CharacterQueries.getCharacterById(characterIdNormalised);
        if (!char) {
            return Promise.resolve(failure('Character not found.'));
        }

        // Check that the character-side elimination exists
        var charElimExists = false;
        if (Array.isArray(char.eliminations)) {
            for (var i = 0; i < char.eliminations.length; i++) {
                var e = char.eliminations[i];
                if (e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised) {
                    charElimExists = true;
                    break;
                }
            }
        }

        if (!charElimExists) {
            return Promise.resolve(failure('Character elimination record not found.'));
        }

        // ---- PHASE 6: BUILD PROPOSED CHARACTER STATE ----
        var proposedChar = {
            id: char.id,
            firstName: char.firstName,
            lastName: char.lastName,
            eliminations: Array.isArray(char.eliminations) ? char.eliminations.slice() : [],
            eliminatedWeeks: []
        };

        // Preserve other properties
        for (var key in char) {
            if (Object.prototype.hasOwnProperty.call(char, key) &&
                key !== 'id' && key !== 'firstName' && key !== 'lastName' &&
                key !== 'eliminations' && key !== 'eliminatedWeeks') {
                proposedChar[key] = char[key];
            }
        }

        // Remove the tournament elimination
        proposedChar.eliminations = proposedChar.eliminations.filter(function(e) {
            return !(e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised);
        });

        // Rebuild derived state
        proposedChar.eliminatedWeeks = rebuildEliminatedWeeks(proposedChar);

        // Validate proposed character state
        var charValidation = validateProposedCharacter(proposedChar, tournamentIdNormalised);
        if (!charValidation.valid) {
            return Promise.resolve(failure('Character state validation failed: ' + charValidation.message));
        }

        // ---- PHASE 7: BUILD PROPOSED TOURNAMENT STATE ----
        var proposedTournament = Object.assign({}, tournament);
        proposedTournament.eliminations = Array.isArray(tournament.eliminations)
            ? tournament.eliminations.slice()
            : [];

        // Remove the elimination from tournament
        proposedTournament.eliminations = proposedTournament.eliminations.filter(function(e) {
            return !(e && e.participantType === 'character' &&
                normaliseId(e.participantId) === characterIdNormalised);
        });

        // Validate proposed tournament against schema
        if (Schema) {
            var tournValidation = Schema.validateTournament(proposedTournament, { strict: false });
            if (!tournValidation.valid) {
                var errors = tournValidation.errors.join('; ');
                return Promise.resolve(failure('Tournament validation failed: ' + errors));
            }
        }

        // ---- PHASE 8: EXECUTE MUTATION ----
        var targetTournamentId = tournamentIdNormalised;
        var targetCharacterId = characterIdNormalised;
        var proposedCharCopy = JSON.parse(JSON.stringify(proposedChar));
        var proposedTournamentCopy = JSON.parse(JSON.stringify(proposedTournament));

        return executeMutation({
            validate: function(data) {
                // Re-validate within transaction
                var currentTournament = null;
                if (Array.isArray(data.tournaments)) {
                    for (var i = 0; i < data.tournaments.length; i++) {
                        if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === targetTournamentId) {
                            currentTournament = data.tournaments[i];
                            break;
                        }
                    }
                }

                if (!currentTournament) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }

                var currentChar = null;
                if (Array.isArray(data.characters)) {
                    for (var i = 0; i < data.characters.length; i++) {
                        if (data.characters[i] && normaliseId(data.characters[i].id) === targetCharacterId) {
                            currentChar = data.characters[i];
                            break;
                        }
                    }
                }

                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }

                return { valid: true };
            },
            mutate: function(data) {
                // Find and update tournament
                var tournIndex = -1;
                for (var i = 0; i < data.tournaments.length; i++) {
                    if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === targetTournamentId) {
                        tournIndex = i;
                        break;
                    }
                }

                if (tournIndex === -1) {
                    throw new Error('Tournament not found in data store.');
                }

                // Find and update character
                var charIndex = -1;
                if (Array.isArray(data.characters)) {
                    for (var i = 0; i < data.characters.length; i++) {
                        if (data.characters[i] && normaliseId(data.characters[i].id) === targetCharacterId) {
                            charIndex = i;
                            break;
                        }
                    }
                }

                if (charIndex === -1) {
                    throw new Error('Character not found in data store.');
                }

                // Apply tournament mutation
                data.tournaments[tournIndex].eliminations = proposedTournamentCopy.eliminations;

                // Apply character mutation
                var targetChar = data.characters[charIndex];
                targetChar.eliminations = proposedCharCopy.eliminations;
                targetChar.eliminatedWeeks = proposedCharCopy.eliminatedWeeks;

                return {
                    tournamentId: targetTournamentId,
                    characterId: targetCharacterId
                };
            },
            logMessage: function(result) {
                var CharacterQueries = getCharacterQueries();
                var name = CharacterQueries ? CharacterQueries.getCharacterNameById(targetCharacterId) : targetCharacterId;
                return 'Restored ' + name + ' from tournament elimination.';
            },
            successMessage: 'Character restored from tournament.',
            failureMessage: 'Failed to restore character from tournament.'
        });
    }

    // ============================================================
    // QUERY HELPERS
    // ============================================================

    /**
     * Check if a character is eliminated in a tournament.
     * Delegates to TournamentSchema.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} characterId - Character ID
     * @returns {boolean} True if eliminated
     */
    function isCharacterEliminated(tournamentId, characterId) {
        var Queries = getTournamentQueries();
        if (!Queries) {
            return false;
        }

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) {
            return false;
        }

        var id = normaliseId(characterId);
        if (id === null) {
            return false;
        }

        var Schema = getTournamentSchema();
        if (Schema && typeof Schema.isParticipantEliminated === 'function') {
            return Schema.isParticipantEliminated(tournament, id);
        }

        return false;
    }

    /**
     * Get all character eliminations from a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of elimination records
     */
    function getCharacterEliminations(tournamentId) {
        var Queries = getTournamentQueries();
        if (!Queries) {
            return [];
        }

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return [];
        }

        return tournament.eliminations
            .filter(function(e) {
                return e && e.participantType === 'character';
            })
            .slice();
    }

    /**
     * Get eliminated weeks for a character from tournament data only.
     * 
     * @param {string} characterId - Character ID
     * @returns {array} Array of eliminated week numbers
     */
    function getCharacterEliminatedWeeks(characterId) {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) {
            return [];
        }

        return rebuildEliminatedWeeks(char);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentEliminationWorkflow = {
        // Core operations
        markCharacterEliminated: markCharacterEliminated,
        unmarkCharacterEliminated: unmarkCharacterEliminated,

        // Query helpers
        isCharacterEliminated: isCharacterEliminated,
        getCharacterEliminations: getCharacterEliminations,
        getCharacterEliminatedWeeks: getCharacterEliminatedWeeks,

        // Internal helpers (exposed for testing)
        rebuildEliminatedWeeks: rebuildEliminatedWeeks,
        buildProposedCharacterState: buildProposedCharacterState,
        validateProposedCharacter: validateProposedCharacter
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentEliminationWorkflow;
        var missing = [];

        var required = [
            'markCharacterEliminated', 'unmarkCharacterEliminated',
            'isCharacterEliminated', 'getCharacterEliminations',
            'getCharacterEliminatedWeeks',
            'rebuildEliminatedWeeks', 'buildProposedCharacterState',
            'validateProposedCharacter'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentEliminationWorkflow] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentEliminationWorkflow] All exports verified successfully.');
        }
    })();

})();
