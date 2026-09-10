/**
 * modules/tournaments/tournament-core.js - Tournament Core
 * CANONICAL mutation API for tournaments (tournament and round level)
 * Path: js/modules/tournaments/tournament-core.js
 * 
 * This module provides:
 *   - Tournament CRUD (create, update, delete)
 *   - Participant management (add, remove)
 *   - Round management (add, remove)
 *   - Tournament completion
 * 
 * IMPORTANT:
 *   - This module owns tournament and round mutations
 *   - Match-level mutations are delegated to TournamentMatches
 *   - TournamentCore → TournamentMatches uses INTERNAL PURE builders
 *   - Does NOT call saveData() - caller owns persistence via MutationPipeline
 *   - Does NOT log activity - MutationPipeline owns activity logging
 *   - Does NOT render or notify - UI layer owns that
 *   - Uses TournamentSchema for structural validation
 *   - Uses TournamentLifecycle for permission checks
 *   - Uses TournamentRules for domain condition checks
 *   - Returns DEFENSIVE COPIES of mutated objects
 * 
 * MUTATION PHILOSOPHY:
 *   - Caller is responsible for persistence via MutationPipeline
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Schema is SOLE source of truth for STRUCTURAL validation
 *   - Lifecycle is SOLE source of truth for OPERATION permissions
 *   - Rules is SOLE source of truth for DOMAIN CONDITIONS
 *   - Mutations are VALIDATION-ATOMIC: all validation completes before any mutation
 *   - Malformed existing data is NOT silently repaired
 *   - Getters return DEFENSIVE COPIES to prevent external mutation
 * 
 * MATCH DELEGATION:
 *   - addRound() uses TournamentMatches.buildRound() (internal pure builder)
 *   - addRound() does NOT call TournamentMatches.createMatch() (public command)
 *   - This prevents nested mutation transactions
 * 
 * DEPENDENCIES:
 *   - window.TournamentSchema (from tournament-schema.js) - MANDATORY
 *   - window.TournamentLifecycle (from tournament-lifecycle.js) - MANDATORY
 *   - window.TournamentRules (from tournament-rules.js) - MANDATORY
 *   - window.TournamentMatches (from tournament-matches.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var Core = window.TournamentCore;
 *   var tournament = Core.createTournament({ name: 'Spring Cup' });
 *   var updated = Core.updateTournament('tourn_123', { name: 'Summer Cup' });
 *   var added = Core.addParticipant('tourn_123', { id: 'char_123', type: 'character' });
 *   var round = Core.addRound('tourn_123', { matchSize: 2, matchType: 'standard' });
 *   var completed = Core.completeTournament('tourn_123');
 */

(function() {
    'use strict';

    if (window.__tournamentCoreLoaded) {
        return;
    }

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getSchema() {
        return window.TournamentSchema || null;
    }

    function getLifecycle() {
        return window.TournamentLifecycle || null;
    }

    function getRules() {
        return window.TournamentRules || null;
    }

    function getMatches() {
        return window.TournamentMatches || null;
    }

    function getQueries() {
        return window.TournamentQueries || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    function getCalendarValidation() {
        return window.CalendarValidation || null;
    }

    function getIdUtils() {
        return window.IdUtils || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getSchema()) {
            missing.push('TournamentSchema (lazy)');
        }
        if (!getLifecycle()) {
            missing.push('TournamentLifecycle (lazy)');
        }
        if (!getRules()) {
            missing.push('TournamentRules (lazy)');
        }
        if (!getMatches()) {
            missing.push('TournamentMatches (lazy)');
        }
        if (!getQueries()) {
            missing.push('TournamentQueries (lazy)');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries (lazy)');
        }
        if (!getTeamQueries()) {
            missing.push('TeamQueries (lazy)');
        }
        if (!getCalendarValidation()) {
            missing.push('CalendarValidation (lazy)');
        }
        if (!getIdUtils()) {
            missing.push('IdUtils (lazy)');
        }
        if (!getObjectUtils()) {
            missing.push('ObjectUtils (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[TournamentCore] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

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

    function deepClone(value) {
        var ObjectUtils = getObjectUtils();
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) {}
        }
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 1) {
            return null;
        }
        return num;
    }

    function parseWeek(value) {
        var CalendarValidation = getCalendarValidation();
        if (CalendarValidation && typeof CalendarValidation.parseWeek === 'function') {
            return CalendarValidation.parseWeek(value);
        }
        var num = parseInt(value, 10);
        return !isNaN(num) && num >= 1 && num <= 52 ? num : null;
    }

    function getDataStore() {
        return window.data || {};
    }

    function getTournamentInternal(id) {
        var normalisedId = normaliseId(id);
        if (normalisedId === null) {
            return null;
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.tournaments)) {
            return null;
        }
        for (var i = 0; i < data.tournaments.length; i++) {
            var t = data.tournaments[i];
            if (t && normaliseId(t.id) === normalisedId) {
                return t;
            }
        }
        return null;
    }

    function validateTournament(tournament, strict) {
        var Schema = getSchema();
        if (!Schema || typeof Schema.validateTournament !== 'function') {
            return { valid: false, errors: ['Schema not available'] };
        }
        return Schema.validateTournament(tournament, { strict: strict !== false });
    }

    function getValidatedTournament(id, strict) {
        var tournament = getTournamentInternal(id);
        if (!tournament) {
            return null;
        }
        var validation = validateTournament(tournament, strict === true);
        if (!validation.valid) {
            return null;
        }
        return tournament;
    }

    function generateUniqueId(appData) {
        var IdUtils = getIdUtils();
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            return null;
        }

        var attempts = 0;
        var maxAttempts = 10;
        var id;
        var generated = false;

        while (!generated && attempts < maxAttempts) {
            id = IdUtils.generateId('tourn');
            attempts++;

            var normalisedId = normaliseId(id);
            if (normalisedId === null) {
                continue;
            }

            var collision = appData.tournaments.some(function(t) {
                return t && normaliseId(t.id) === normalisedId;
            });

            if (!collision) {
                generated = true;
            }
        }

        if (!generated) {
            return null;
        }
        return normaliseId(id);
    }

    function getParticipantType(tournament, participantId) {
        var Schema = getSchema();
        if (Schema && typeof Schema.getParticipantTypeFromRecord === 'function') {
            return Schema.getParticipantTypeFromRecord(tournament, participantId);
        }
        return null;
    }

    function isParticipantInTournament(tournament, participantId) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isParticipantInTournament === 'function') {
            return Schema.isParticipantInTournament(tournament, participantId);
        }
        return false;
    }

    function isParticipantEliminated(tournament, participantId) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isParticipantEliminated === 'function') {
            return Schema.isParticipantEliminated(tournament, participantId);
        }
        return false;
    }

    // ============================================================
    // TOURNAMENT QUERY HELPERS (delegated to Queries)
    // ============================================================

    function getTournament(id) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getTournament === 'function') {
            return Queries.getTournament(id);
        }
        var tournament = getTournamentInternal(id);
        return tournament ? deepClone(tournament) : null;
    }

    function getTournaments() {
        var Queries = getQueries();
        if (Queries && typeof Queries.getTournaments === 'function') {
            return Queries.getTournaments();
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.tournaments)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < data.tournaments.length; i++) {
            if (data.tournaments[i]) {
                result.push(deepClone(data.tournaments[i]));
            }
        }
        return result;
    }

    function getParticipants(tournamentId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getParticipants === 'function') {
            return Queries.getParticipants(tournamentId);
        }
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }
        return tournament.participants.map(function(p) {
            return deepClone(p);
        }).filter(function(p) { return p !== null; });
    }

    function getRounds(tournamentId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getRounds === 'function') {
            return Queries.getRounds(tournamentId);
        }
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return [];
        }
        return tournament.rounds.map(function(r) {
            return deepClone(r);
        }).filter(function(r) { return r !== null; });
    }

    function getRoundCount(tournamentId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getRoundCount === 'function') {
            return Queries.getRoundCount(tournamentId);
        }
        var rounds = getRounds(tournamentId);
        return rounds.length;
    }

    function getCurrentRound(tournament) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return 0;
        }
        return tournament.rounds.length;
    }

    function isComplete(tournamentId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.isTournamentComplete === 'function') {
            return Queries.isTournamentComplete(tournamentId);
        }
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return false;
        }
        if (tournament.status === 'completed') {
            return true;
        }
        if (!Array.isArray(tournament.rounds) || tournament.rounds.length === 0) {
            return false;
        }
        var allRoundsComplete = tournament.rounds.every(function(r) {
            return r && r.status === 'completed';
        });
        return allRoundsComplete && !!tournament.winner;
    }

    // ============================================================
    // TOURNAMENT CRUD
    // ============================================================

    /**
     * Create a new tournament.
     * 
     * @param {object} data - Tournament data
     * @returns {object|null} Created tournament or null
     */
    function createTournament(data) {
        if (!isObject(data)) {
            return null;
        }

        // ---- PHASE 1: VALIDATE INPUTS ----
        if (!isNonEmptyString(data.name)) {
            return null;
        }
        var name = data.name.trim();

        var Schema = getSchema();
        var CalendarValidation = getCalendarValidation();

        if (!Schema || !CalendarValidation) {
            return null;
        }

        var mode = data.mode || 'teams';
        if (!Schema.isValidMode(mode)) {
            return null;
        }

        var startWeek = data.startWeek !== undefined ? data.startWeek : 1;
        var parsedStart = CalendarValidation.parseWeek(startWeek);
        if (parsedStart === null) {
            return null;
        }

        var endWeek = data.endWeek !== undefined ? data.endWeek : 52;
        var parsedEnd = CalendarValidation.parseWeek(endWeek);
        if (parsedEnd === null) {
            return null;
        }

        if (parsedStart > parsedEnd) {
            return null;
        }

        var totalRounds = data.totalRounds !== undefined ? data.totalRounds : 1;
        var parsedRounds = parsePositiveInteger(totalRounds);
        if (parsedRounds === null) {
            return null;
        }

        var status = data.status || 'draft';
        if (!Schema.isValidStatus(status)) {
            return null;
        }

        var graduatingClassId = data.graduatingClassId !== undefined
            ? normaliseId(data.graduatingClassId)
            : null;

        var classFilterEnabled = data.classFilterEnabled !== false;

        var appData = getDataStore();
        if (!appData) {
            return null;
        }

        // ---- PHASE 2: GENERATE UNIQUE ID ----
        var id = generateUniqueId(appData);
        if (id === null) {
            return null;
        }

        // ---- PHASE 3: BUILD CANONICAL TOURNAMENT ----
        var newTournament = {
            id: id,
            name: name,
            mode: mode,
            startWeek: parsedStart,
            endWeek: parsedEnd,
            totalRounds: parsedRounds,
            status: status,
            participants: [],
            rounds: [],
            eliminations: [],
            winner: null,
            createdAt: new Date().toISOString(),
            _schemaVersion: 2,
            graduatingClassId: graduatingClassId,
            classFilterEnabled: classFilterEnabled
        };

        // ---- PHASE 4: VALIDATE COMPLETE OBJECT AGAINST SCHEMA ----
        var validation = validateTournament(newTournament, true);
        if (!validation.valid) {
            return null;
        }

        // ---- PHASE 5: PERSIST (in-memory) ----
        appData.tournaments.push(newTournament);

        return deepClone(newTournament);
    }

    /**
     * Update an existing tournament.
     * 
     * @param {string} id - Tournament ID
     * @param {object} updates - Updates to apply
     * @returns {object|null} Updated tournament or null
     */
    function updateTournament(id, updates) {
        if (!isObject(updates)) {
            return null;
        }

        var updateKeys = Object.keys(updates);
        if (updateKeys.length === 0) {
            return null;
        }

        // Reject undefined values
        var hasUndefined = updateKeys.some(function(key) {
            return updates[key] === undefined;
        });
        if (hasUndefined) {
            return null;
        }

        // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING (LENIENT) ----
        var tournament = getValidatedTournament(id, false);
        if (!tournament) {
            return null;
        }

        // ---- PHASE 2: LIFECYCLE CHECK ----
        var Lifecycle = getLifecycle();
        if (!Lifecycle) {
            return null;
        }

        // Class updates (graduatingClassId, classFilterEnabled) are ALWAYS allowed
        var isClassOnlyUpdate = updateKeys.every(function(key) {
            return key === 'graduatingClassId' || key === 'classFilterEnabled';
        });

        // Structural changes require edit permission
        var isStructuralUpdate = updateKeys.some(function(key) {
            return ['name', 'mode', 'startWeek', 'endWeek', 'totalRounds'].indexOf(key) !== -1;
        });

        if (isStructuralUpdate) {
            // Name changes are allowed in active tournaments
            var onlyNameChange = updateKeys.every(function(key) {
                return key === 'name';
            });

            if (!onlyNameChange && !Lifecycle.canEditMetadata(tournament)) {
                return null;
            }
        }

        // ---- PHASE 3: REJECT UNKNOWN UPDATE KEYS ----
        var allowedKeys = ['name', 'mode', 'startWeek', 'endWeek', 'totalRounds', 'status', 'graduatingClassId', 'classFilterEnabled'];
        var unknownKeys = updateKeys.filter(function(key) {
            return allowedKeys.indexOf(key) === -1;
        });
        if (unknownKeys.length > 0) {
            return null;
        }

        // ---- PHASE 4: BUILD PROPOSED STATE ----
        var proposed = Object.assign({}, tournament);
        Object.keys(updates).forEach(function(key) {
            if (updates[key] !== undefined) {
                proposed[key] = updates[key];
            }
        });

        // ---- PHASE 5: STRUCTURAL CONSTRAINTS ----
        // totalRounds cannot be less than existing rounds
        if (updates.totalRounds !== undefined) {
            var newTotal = parsePositiveInteger(proposed.totalRounds);
            if (newTotal !== null && Array.isArray(tournament.rounds) && tournament.rounds.length > newTotal) {
                return null;
            }
        }

        // mode cannot change if participants exist
        if (updates.mode !== undefined && updates.mode !== tournament.mode) {
            if (Array.isArray(tournament.participants) && tournament.participants.length > 0) {
                return null;
            }
        }

        // ---- PHASE 6: VALIDATE PROPOSED AGAINST SCHEMA (LENIENT) ----
        var validation = validateTournament(proposed, false);
        if (!validation.valid) {
            return null;
        }

        // ---- PHASE 7: APPLY VALIDATED UPDATES ----
        var hasChanges = false;
        allowedKeys.forEach(function(key) {
            if (updates[key] === undefined) {
                return;
            }
            if (tournament[key] !== proposed[key]) {
                tournament[key] = proposed[key];
                hasChanges = true;
            }
        });

        if (!hasChanges) {
            return deepClone(tournament);
        }

        return deepClone(tournament);
    }

    /**
     * Delete a tournament permanently.
     * 
     * @param {string} id - Tournament ID
     * @returns {boolean} Success
     */
    function deleteTournament(id) {
        var normalisedId = normaliseId(id);
        if (normalisedId === null) {
            return false;
        }

        // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
        var tournament = getValidatedTournament(normalisedId, false);
        if (!tournament) {
            return false;
        }

        // ---- PHASE 2: MUTATE ----
        var data = getDataStore();
        if (!data) {
            return false;
        }

        var foundIndex = -1;
        for (var i = 0; i < data.tournaments.length; i++) {
            if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === normalisedId) {
                foundIndex = i;
                break;
            }
        }

        if (foundIndex === -1) {
            return false;
        }

        data.tournaments.splice(foundIndex, 1);

        return true;
    }

    // ============================================================
    // PARTICIPANT OPERATIONS
    // ============================================================

    /**
     * Add a participant to a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {object} participant - { id, type }
     * @returns {boolean} Success
     */
    function addParticipant(tournamentId, participant) {
        if (!isObject(participant)) {
            return false;
        }

        var id = normaliseId(participant.id);
        if (id === null) {
            return false;
        }

        var type = participant.type || 'character';

        // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament) {
            return false;
        }

        if (!Array.isArray(tournament.participants)) {
            return false;
        }

        // ---- PHASE 2: LIFECYCLE CHECK ----
        var Lifecycle = getLifecycle();
        if (!Lifecycle || !Lifecycle.canModifyParticipants(tournament)) {
            return false;
        }

        // ---- PHASE 3: RULES CHECK ----
        var Rules = getRules();
        if (Rules && typeof Rules.canAddParticipant === 'function') {
            if (!Rules.canAddParticipant(tournament, id, type)) {
                return false;
            }
        }

        // ---- PHASE 4: VALIDATE PARTICIPANT TYPE ----
        var Schema = getSchema();
        if (!Schema || !Schema.isValidParticipantType(type)) {
            return false;
        }

        var canonicalType = Schema.getCanonicalParticipantType(tournament.mode);
        if (canonicalType === null || type !== canonicalType) {
            return false;
        }

        var data = getDataStore();
        if (!data) {
            return false;
        }

        // Verify entity exists using domain queries
        var CharacterQueries = getCharacterQueries();
        var TeamQueries = getTeamQueries();

        if (type === 'character') {
            if (!CharacterQueries || !CharacterQueries.getCharacterById(id)) {
                return false;
            }
        } else if (type === 'team') {
            if (!TeamQueries || !TeamQueries.getTeamById(id)) {
                return false;
            }
        } else {
            return false;
        }

        // Check for duplicate
        var exists = tournament.participants.some(function(p) {
            return p && normaliseId(p.id) === id && p.type === type;
        });
        if (exists) {
            return false;
        }

        // ---- PHASE 5: APPLY MUTATION ----
        tournament.participants.push({
            id: id,
            type: type,
            addedAt: new Date().toISOString()
        });

        return true;
    }

    /**
     * Remove a participant from a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @returns {boolean} Success
     */
    function removeParticipant(tournamentId, participantId) {
        var id = normaliseId(participantId);
        if (id === null) {
            return false;
        }

        // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return false;
        }

        // ---- PHASE 2: LIFECYCLE CHECK ----
        var Lifecycle = getLifecycle();
        if (!Lifecycle || !Lifecycle.canModifyParticipants(tournament)) {
            return false;
        }

        // ---- PHASE 3: RULES CHECK ----
        var Rules = getRules();
        if (Rules && typeof Rules.canRemoveParticipant === 'function') {
            if (!Rules.canRemoveParticipant(tournament, id)) {
                return false;
            }
        }

        // Check if participant exists
        var participantRecord = null;
        for (var i = 0; i < tournament.participants.length; i++) {
            if (tournament.participants[i] && normaliseId(tournament.participants[i].id) === id) {
                participantRecord = tournament.participants[i];
                break;
            }
        }

        if (!participantRecord) {
            return false;
        }

        // ---- PHASE 4: APPLY MUTATION ----
        tournament.participants = tournament.participants.filter(function(p) {
            return !(p && normaliseId(p.id) === id);
        });

        return true;
    }

    // ============================================================
    // ROUND OPERATIONS - Uses TournamentMatches internal builders
    // ============================================================

    /**
     * Add a round to a tournament.
     * Uses TournamentMatches.buildRound() (internal pure builder).
     * Does NOT call TournamentMatches.createMatch() (public command).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {object} roundData - { matchSize, matchType }
     * @returns {boolean} Success
     */
    function addRound(tournamentId, roundData) {
        // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return false;
        }

        // ---- PHASE 2: LIFECYCLE CHECK ----
        var Lifecycle = getLifecycle();
        if (!Lifecycle) {
            return false;
        }

        if (!Lifecycle.canAddRound(tournament, tournament.rounds.length, tournament.totalRounds)) {
            return false;
        }

        // ---- PHASE 3: RULES CHECK ----
        var Rules = getRules();
        if (Rules && typeof Rules.canAddRound === 'function') {
            if (!Rules.canAddRound(tournament, roundData)) {
                return false;
            }
        }

        // ---- PHASE 4: VALIDATE ROUND DATA ----
        var matchSize = 2;
        var matchType = 'standard';

        if (roundData && typeof roundData === 'object') {
            if (roundData.matchSize !== undefined) {
                var size = parsePositiveInteger(roundData.matchSize);
                if (size === null || size < 2) {
                    return false;
                }
                matchSize = size;
            }

            if (roundData.matchType !== undefined) {
                var Schema = getSchema();
                if (!Schema || !Schema.isValidMatchType(roundData.matchType)) {
                    return false;
                }
                matchType = roundData.matchType;
            }
        }

        // ---- PHASE 5: BUILD ROUND USING INTERNAL BUILDER ----
        var Matches = getMatches();
        if (!Matches || typeof Matches.buildRound !== 'function') {
            return false;
        }

        // Build round with the internal pure builder
        var participants = [];
        if (Array.isArray(tournament.participants)) {
            // Get active participants for the round
            for (var i = 0; i < tournament.participants.length; i++) {
                var p = tournament.participants[i];
                if (p && !isParticipantEliminated(tournament, p.id)) {
                    participants.push(p.id);
                }
            }
        }

        var roundNumber = tournament.rounds.length + 1;
        var round = Matches.buildRound({
            matchSize: matchSize,
            matchType: matchType,
            roundNumber: roundNumber
        }, participants);

        if (!round) {
            return false;
        }

        // ---- PHASE 6: BUILD PROPOSED TOURNAMENT STATE ----
        var proposed = Object.assign({}, tournament);
        proposed.rounds = tournament.rounds.slice().map(function(r) {
            return Object.assign({}, r);
        });
        proposed.rounds.push(round);

        // If status is draft, promote to active
        if (proposed.status === 'draft') {
            proposed.status = 'active';
        }

        // ---- PHASE 7: VALIDATE PROPOSED AGAINST SCHEMA ----
        var validation = validateTournament(proposed, false);
        if (!validation.valid) {
            return false;
        }

        // ---- PHASE 8: APPLY MUTATION ----
        tournament.rounds = proposed.rounds;
        if (proposed.status !== tournament.status) {
            tournament.status = proposed.status;
        }

        return true;
    }

    /**
     * Remove a round from a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of round to remove (0-based)
     * @returns {boolean} Success
     */
    function removeRound(tournamentId, roundIndex) {
        var index = parseInt(roundIndex, 10);
        if (!Number.isInteger(index)) {
            return false;
        }

        // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return false;
        }

        if (index < 0 || index >= tournament.rounds.length) {
            return false;
        }

        // ---- PHASE 2: LIFECYCLE CHECK ----
        var Lifecycle = getLifecycle();
        if (!Lifecycle) {
            return false;
        }

        if (!Lifecycle.canRemoveRounds(tournament)) {
            return false;
        }

        // ---- PHASE 3: RULES CHECK ----
        var Rules = getRules();
        if (Rules && typeof Rules.canRemoveRound === 'function') {
            if (!Rules.canRemoveRound(tournament, index)) {
                return false;
            }
        }

        // ---- PHASE 4: BUILD PROPOSED STATE ----
        var proposed = Object.assign({}, tournament);
        proposed.rounds = tournament.rounds
            .filter(function(_, idx) {
                return idx !== index;
            })
            .map(function(round, idx) {
                var copy = Object.assign({}, round);
                copy.roundNumber = idx + 1;
                return copy;
            });

        if (proposed.rounds.length === 0) {
            proposed.status = 'draft';
            proposed.winner = null;
        }

        // ---- PHASE 5: VALIDATE PROPOSED AGAINST SCHEMA ----
        var validation = validateTournament(proposed, false);
        if (!validation.valid) {
            return false;
        }

        // ---- PHASE 6: APPLY MUTATION ----
        tournament.rounds = proposed.rounds;
        tournament.status = proposed.status;
        tournament.winner = proposed.winner;

        return true;
    }

    // ============================================================
    // TOURNAMENT COMPLETION
    // ============================================================

    /**
     * Complete a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {boolean} force - Force completion (bypasses prerequisites)
     * @returns {boolean} Success
     */
    function completeTournament(tournamentId, force) {
        force = force === true;

        // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament) {
            return false;
        }

        // ---- PHASE 2: LIFECYCLE CHECK ----
        var Lifecycle = getLifecycle();
        if (!Lifecycle) {
            return false;
        }

        if (!Lifecycle.canCompleteTournament(tournament, !!tournament.winner)) {
            return false;
        }

        if (tournament.status === 'completed') {
            return false;
        }

        // ---- PHASE 3: RULES CHECK ----
        var Rules = getRules();
        if (!force && Rules && typeof Rules.isReadyForCompletion === 'function') {
            if (!Rules.isReadyForCompletion(tournament)) {
                return false;
            }
        }

        // ---- PHASE 4: CHECK COMPLETION PREREQUISITES ----
        if (!force) {
            var allRoundsComplete = Array.isArray(tournament.rounds) &&
                tournament.rounds.every(function(r) {
                    return r && r.status === 'completed';
                });

            if (!allRoundsComplete || !tournament.winner) {
                return false;
            }
        }

        // ---- PHASE 5: BUILD PROPOSED STATE ----
        var proposed = Object.assign({}, tournament);
        proposed.status = 'completed';

        // ---- PHASE 6: VALIDATE PROPOSED AGAINST SCHEMA ----
        var validation = validateTournament(proposed, false);
        if (!validation.valid) {
            return false;
        }

        // ---- PHASE 7: APPLY MUTATION ----
        tournament.status = proposed.status;

        return true;
    }

    // ============================================================
    // LIFECYCLE STATUS QUERY
    // ============================================================

    /**
     * Get the lifecycle status of a tournament.
     * Delegates to TournamentLifecycle.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {object} Lifecycle status object
     */
    function getLifecycleStatus(tournamentId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return {
                status: 'unknown',
                valid: false,
                mutable: false,
                canEditMetadata: false,
                canModifyParticipants: false,
                canAddRounds: false,
                canRemoveRounds: false,
                canModifyEliminations: false,
                canComplete: false,
                terminal: false,
                description: 'Tournament not found'
            };
        }

        var Lifecycle = getLifecycle();
        if (Lifecycle && typeof Lifecycle.getLifecycleStatus === 'function') {
            return Lifecycle.getLifecycleStatus(tournament);
        }

        return {
            status: tournament.status || 'unknown',
            valid: true,
            mutable: false,
            canEditMetadata: false,
            canModifyParticipants: false,
            canAddRounds: false,
            canRemoveRounds: false,
            canModifyEliminations: false,
            canComplete: false,
            terminal: tournament.status === 'completed',
            description: 'Lifecycle not available'
        };
    }

    /**
     * Get the lifecycle rules for a status.
     * Delegates to TournamentLifecycle.
     * 
     * @param {string} status - Tournament status
     * @returns {object|null} Lifecycle rules or null
     */
    function getLifecycleRules(status) {
        var Lifecycle = getLifecycle();
        if (Lifecycle && typeof Lifecycle.getLifecycleRules === 'function') {
            return Lifecycle.getLifecycleRules(status);
        }
        return null;
    }

    // ============================================================
    // QUERY HELPERS (Delegated to Schema - read-only)
    // ============================================================

    /**
     * Check if a participant is in a tournament.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @param {string} participantType - Participant type (optional)
     * @returns {boolean} True if participant is in tournament
     */
    function isParticipantInTournament(tournamentId, participantId, participantType) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return false;
        }
        var Schema = getSchema();
        if (Schema && typeof Schema.isParticipantInTournament === 'function') {
            return Schema.isParticipantInTournament(tournament, participantId, participantType);
        }
        return false;
    }

    /**
     * Get participant type from tournament record.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @returns {string|null} Participant type or null
     */
    function getParticipantType(tournamentId, participantId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return null;
        }
        return getParticipantType(tournament, participantId);
    }

    /**
     * Check if a participant is eliminated.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @returns {boolean} True if eliminated
     */
    function isParticipantEliminated(tournamentId, participantId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return false;
        }
        var Schema = getSchema();
        if (Schema && typeof Schema.isParticipantEliminated === 'function') {
            return Schema.isParticipantEliminated(tournament, participantId);
        }
        return false;
    }

    /**
     * Get active participants (not eliminated).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {array} Array of active participants
     */
    function getActiveParticipants(tournamentId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && !isParticipantEliminated(tournament, p.id)) {
                result.push(deepClone(p));
            }
        }
        return result;
    }

    /**
     * Get the winner of a tournament (defensive copy).
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {object|null} Winner object or null
     */
    function getWinner(tournamentId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament || !tournament.winner) {
            return null;
        }
        return deepClone(tournament.winner);
    }

    /**
     * Validate a tournament against the schema.
     * 
     * @param {object} tournament - Tournament to validate
     * @param {boolean} strict - Strict validation
     * @returns {object} Validation result
     */
    function validateTournament(tournament, strict) {
        return validateTournament(tournament, strict !== false);
    }

    /**
     * Get a validation report for a tournament.
     * 
     * @param {object} tournament - Tournament to report on
     * @returns {object} Validation report
     */
    function getValidationReport(tournament) {
        var Schema = getSchema();
        if (Schema && typeof Schema.getValidationReport === 'function') {
            return Schema.getValidationReport(tournament);
        }
        return { valid: false, errors: ['Schema not available'] };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentCore = {
        // ---- Tournament CRUD ----
        createTournament: createTournament,
        updateTournament: updateTournament,
        deleteTournament: deleteTournament,

        // ---- Participant Management ----
        addParticipant: addParticipant,
        removeParticipant: removeParticipant,

        // ---- Round Management ----
        addRound: addRound,
        removeRound: removeRound,

        // ---- Tournament Completion ----
        completeTournament: completeTournament,

        // ---- Lifecycle Status ----
        getLifecycleStatus: getLifecycleStatus,
        getLifecycleRules: getLifecycleRules,

        // ---- Query Helpers (read-only, defensive copies) ----
        getTournament: getTournament,
        getTournaments: getTournaments,
        getParticipants: getParticipants,
        getRounds: getRounds,
        getRoundCount: getRoundCount,
        getCurrentRound: getCurrentRound,
        isComplete: isComplete,
        getWinner: getWinner,
        getActiveParticipants: getActiveParticipants,
        isParticipantInTournament: isParticipantInTournament,
        getParticipantType: getParticipantType,
        isParticipantEliminated: isParticipantEliminated,
        validateTournament: validateTournament,
        getValidationReport: getValidationReport
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentCore;
        var missing = [];

        var required = [
            'createTournament', 'updateTournament', 'deleteTournament',
            'addParticipant', 'removeParticipant',
            'addRound', 'removeRound',
            'completeTournament',
            'getLifecycleStatus', 'getLifecycleRules',
            'getTournament', 'getTournaments',
            'getParticipants', 'getRounds', 'getRoundCount',
            'getCurrentRound', 'isComplete', 'getWinner',
            'getActiveParticipants',
            'isParticipantInTournament', 'getParticipantType',
            'isParticipantEliminated',
            'validateTournament', 'getValidationReport'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentCore] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentCore] All exports verified successfully.');
        }
    })();

})();
