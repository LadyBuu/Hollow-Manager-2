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
 * 
 * IMPORTANT:
 *   - This is a CROSS-DOMAIN WORKFLOW combining:
 *     - TournamentCore (tournament eliminations)
 *     - CharacterCore (character eliminations, eliminatedWeeks)
 *   - All operations are CANDIDATE-BASED: validate, build candidates, commit
 *   - This module does NOT call saveData()
 *   - This module does NOT log activity
 *   - MutationUtils owns persistence and activity logging
 *   - All validation uses CalendarValidation from calendar-validation.js
 * 
 * DEPENDENCIES:
 *   - window.TournamentsCore - Tournament operations
 *   - window.TournamentsSchema - Structural validation
 *   - window.TournamentLifecycle - Lifecycle permissions
 *   - window.CharacterQueries - Character queries
 *   - window.CalendarValidation - Week validation
 *   - window.IdUtils - ID normalisation
 * 
 * USAGE:
 *   var workflow = window.TournamentEliminationWorkflow;
 *   var result = workflow.markCharacterEliminated(tournamentId, characterId, week, reason);
 *   var result = workflow.unmarkCharacterEliminated(tournamentId, characterId);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tournamentEliminationWorkflowLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.TournamentsCore) {
        missing.push('TournamentsCore');
    }

    if (!window.TournamentsSchema) {
        missing.push('TournamentsSchema');
    }

    if (!window.TournamentLifecycle) {
        missing.push('TournamentLifecycle');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (!window.IdUtils || typeof window.IdUtils.normaliseId !== 'function') {
        missing.push('IdUtils.normaliseId');
    }

    if (missing.length > 0) {
        throw new Error('[TournamentEliminationWorkflow] Missing dependencies: ' + missing.join(', '));
    }

    window.__tournamentEliminationWorkflowLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Core = window.TournamentsCore;
    var Schema = window.TournamentsSchema;
    var Lifecycle = window.TournamentLifecycle;
    var CharacterQueries = window.CharacterQueries;
    var CalendarValidation = window.CalendarValidation;
    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = Schema.MIN_WEEK;
    var MAX_WEEK = Schema.MAX_WEEK;
    var VALID_PARTICIPANT_TYPES = Schema.VALID_PARTICIPANT_TYPES;

    // ============================================================
    // HELPERS
    // ============================================================

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function isValidWeek(value) {
        return CalendarValidation.parseWeek(value) !== null;
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
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

            var week = CalendarValidation.parseWeek(elim.week);
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
     * @returns {object} { success: boolean, message?: string }
     */
    function markCharacterEliminated(tournamentId, characterId, week, reason) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Invalid week: must be between ' + MIN_WEEK + ' and ' + MAX_WEEK);
        }

        var eliminationReason = typeof reason === 'string' && reason.trim() !== ''
            ? reason.trim()
            : 'Eliminated from tournament';

        var characterIdNormalised = normaliseId(characterId);
        if (characterIdNormalised === null) {
            return failure('Invalid character ID.');
        }

        var tournamentIdNormalised = normaliseId(tournamentId);
        if (tournamentIdNormalised === null) {
            return failure('Invalid tournament ID.');
        }

        // ---- PHASE 2: RETRIEVE AND VALIDATE TOURNAMENT ----
        var tournament = Core.getTournament(tournamentIdNormalised);
        if (!tournament) {
            return failure('Tournament not found.');
        }

        // Validate tournament structure
        var structValidation = Schema.validateTournament(tournament, { strict: false });
        if (!structValidation.valid) {
            return failure('Tournament data is malformed.');
        }

        // ---- PHASE 3: LIFECYCLE CHECK ----
        if (!Lifecycle.canModifyEliminations(tournament)) {
            return failure('Eliminations cannot be modified in tournament status "' + tournament.status + '".');
        }

        // OPERATION RULE: Elimination week must be within tournament bounds
        if (weekNum < tournament.startWeek || weekNum > tournament.endWeek) {
            return failure('Elimination week ' + weekNum + ' is outside tournament week range ' +
                tournament.startWeek + '-' + tournament.endWeek);
        }

        // ---- PHASE 4: CHECK PARTICIPANT ----
        if (!Schema.isParticipantInTournament(tournament, characterIdNormalised)) {
            return failure('Character is not a participant in this tournament.');
        }

        var participantType = Schema.getParticipantTypeFromRecord(tournament, characterIdNormalised);
        if (participantType !== 'character') {
            return failure('Participant is not a character (type: ' + participantType + ').');
        }

        // Check if already eliminated
        if (Schema.isParticipantEliminated(tournament, characterIdNormalised)) {
            return failure('Character is already eliminated from this tournament.');
        }

        // ---- PHASE 5: RETRIEVE AND VALIDATE CHARACTER ----
        var char = CharacterQueries.getCharacterById(characterIdNormalised);
        if (!char) {
            return failure('Character not found.');
        }

        // ---- PHASE 6: BUILD PROPOSED CHARACTER STATE ----
        var charElimination = {
            week: weekNum,
            reason: eliminationReason
        };

        var proposedChar = buildProposedCharacterState(char, tournamentIdNormalised, charElimination);

        // Validate proposed character state
        var charValidation = validateProposedCharacter(proposedChar, tournamentIdNormalised);
        if (!charValidation.valid) {
            return failure('Character state validation failed: ' + charValidation.message);
        }

        // ---- PHASE 7: BUILD PROPOSED TOURNAMENT STATE ----
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
        var tournValidation = Schema.validateTournament(proposedTournament, { strict: false });
        if (!tournValidation.valid) {
            var errors = tournValidation.errors.join('; ');
            return failure('Tournament validation failed: ' + errors);
        }

        // ---- PHASE 8: APPLY MUTATIONS (ALL VALIDATION COMPLETE) ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        // Find and update tournament in data store
        var tournIndex = -1;
        for (var i = 0; i < data.tournaments.length; i++) {
            if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === tournamentIdNormalised) {
                tournIndex = i;
                break;
            }
        }

        if (tournIndex === -1) {
            return failure('Tournament not found in data store.');
        }

        // Find and update character in data store
        var charIndex = -1;
        if (Array.isArray(data.characters)) {
            for (var i = 0; i < data.characters.length; i++) {
                if (data.characters[i] && normaliseId(data.characters[i].id) === characterIdNormalised) {
                    charIndex = i;
                    break;
                }
            }
        }

        if (charIndex === -1) {
            return failure('Character not found in data store.');
        }

        // Apply tournament mutation
        data.tournaments[tournIndex].eliminations = proposedTournament.eliminations;

        // Apply character mutation
        var targetChar = data.characters[charIndex];
        targetChar.eliminations = proposedChar.eliminations;
        targetChar.eliminatedWeeks = proposedChar.eliminatedWeeks;

        return success({
            tournamentId: tournamentIdNormalised,
            characterId: characterIdNormalised,
            week: weekNum,
            reason: eliminationReason
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
     * @returns {object} { success: boolean, message?: string }
     */
    function unmarkCharacterEliminated(tournamentId, characterId) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var characterIdNormalised = normaliseId(characterId);
        if (characterIdNormalised === null) {
            return failure('Invalid character ID.');
        }

        var tournamentIdNormalised = normaliseId(tournamentId);
        if (tournamentIdNormalised === null) {
            return failure('Invalid tournament ID.');
        }

        // ---- PHASE 2: RETRIEVE AND VALIDATE TOURNAMENT ----
        var tournament = Core.getTournament(tournamentIdNormalised);
        if (!tournament) {
            return failure('Tournament not found.');
        }

        // Validate tournament structure
        var structValidation = Schema.validateTournament(tournament, { strict: false });
        if (!structValidation.valid) {
            return failure('Tournament data is malformed.');
        }

        // ---- PHASE 3: LIFECYCLE CHECK ----
        if (!Lifecycle.canModifyEliminations(tournament)) {
            return failure('Eliminations cannot be modified in tournament status "' + tournament.status + '".');
        }

        // ---- PHASE 4: CHECK ELIMINATION EXISTS ----
        if (!Schema.isParticipantEliminated(tournament, characterIdNormalised)) {
            return failure('Character is not eliminated from this tournament.');
        }

        // ---- PHASE 5: RETRIEVE CHARACTER ----
        var char = CharacterQueries.getCharacterById(characterIdNormalised);
        if (!char) {
            return failure('Character not found.');
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
            return failure('Character elimination record not found.');
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
            return failure('Character state validation failed: ' + charValidation.message);
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
        var tournValidation = Schema.validateTournament(proposedTournament, { strict: false });
        if (!tournValidation.valid) {
            var errors = tournValidation.errors.join('; ');
            return failure('Tournament validation failed: ' + errors);
        }

        // ---- PHASE 8: APPLY MUTATIONS (ALL VALIDATION COMPLETE) ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        // Find and update tournament in data store
        var tournIndex = -1;
        for (var i = 0; i < data.tournaments.length; i++) {
            if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === tournamentIdNormalised) {
                tournIndex = i;
                break;
            }
        }

        if (tournIndex === -1) {
            return failure('Tournament not found in data store.');
        }

        // Find and update character in data store
        var charIndex = -1;
        if (Array.isArray(data.characters)) {
            for (var i = 0; i < data.characters.length; i++) {
                if (data.characters[i] && normaliseId(data.characters[i].id) === characterIdNormalised) {
                    charIndex = i;
                    break;
                }
            }
        }

        if (charIndex === -1) {
            return failure('Character not found in data store.');
        }

        // Apply tournament mutation
        data.tournaments[tournIndex].eliminations = proposedTournament.eliminations;

        // Apply character mutation
        var targetChar = data.characters[charIndex];
        targetChar.eliminations = proposedChar.eliminations;
        targetChar.eliminatedWeeks = proposedChar.eliminatedWeeks;

        return success({
            tournamentId: tournamentIdNormalised,
            characterId: characterIdNormalised
        });
    }

    // ============================================================
    // PROPOSED CHARACTER VALIDATION
    // ============================================================

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

        // Check for duplicate tournament eliminations
        var tournamentIdNormalised = normaliseId(tournamentId);
        if (tournamentIdNormalised === null) {
            return { valid: false, message: 'Invalid tournament ID.' };
        }

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
    // QUERY HELPERS
    // ============================================================

    /**
     * Check if a character is eliminated in a tournament.
     * Delegates to Schema.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} characterId - Character ID
     * @returns {boolean} True if eliminated
     */
    function isCharacterEliminated(tournamentId, characterId) {
        var tournament = Core.getTournament(tournamentId);
        if (!tournament) {
            return false;
        }
        var id = normaliseId(characterId);
        if (id === null) {
            return false;
        }
        return Schema.isParticipantEliminated(tournament, id);
    }

    /**
     * Get all character eliminations from a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of elimination records
     */
    function getCharacterEliminations(tournamentId) {
        var tournament = Core.getTournament(tournamentId);
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return [];
        }
        return tournament.eliminations
            .filter(function(e) {
                return e && e.participantType === 'character';
            })
            .slice();
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

        // Internal helpers (exposed for testing)
        rebuildEliminatedWeeks: rebuildEliminatedWeeks,
        buildProposedCharacterState: buildProposedCharacterState,
        validateProposedCharacter: validateProposedCharacter
    };

})();
