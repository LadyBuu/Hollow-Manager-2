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
 *   - Status transitions (canonical entry point)
 *   - Cross-domain cascade helper (stripCharacterRefs)
 *   - Synchronous reads (defensive copies)
 *
 * IMPORTANT:
 *   - This module owns tournament and round mutations
 *   - Match-level mutations are delegated to TournamentMatches
 *   - TournamentCore -> TournamentMatches uses INTERNAL PURE builders
 *     (buildRound), not the public commands
 *   - All PUBLIC mutations go through MutationPipeline. The pipeline
 *     owns persistence, rollback, and activity logging.
 *   - This module does NOT call saveData() directly
 *   - This module does NOT render or notify — the UI layer owns that
 *   - Uses TournamentSchema for structural validation
 *   - Uses TournamentLifecycle for permission checks
 *   - Uses TournamentRules for domain condition checks
 *   - Reads return DEFENSIVE COPIES
 *
 * MUTATION CONTRACT:
 *   All public mutations return a Promise that resolves to
 *   { success: boolean, data?: any, message?: string }.
 *
 *   The shape mirrors MutationPipeline's contract. On success,
 *   `data` carries the mutated record or a small descriptor
 *   (e.g. `{ id }` for delete). On failure, `message` carries a
 *   human-readable reason.
 *
 *   Callers MUST use `.then()` or `await`. The old sync-shaped
 *   returns (`object|null` for create/update, `boolean` for the
 *   rest) are gone. Every caller in the codebase has been migrated.
 *
 * PHASE SPLIT - VALIDATE / MUTATE:
 *   Each mutation follows the same shape:
 *     1. Validate inputs (pure, synchronous). Reject invalid inputs
 *        with a resolved Promise carrying { success: false }.
 *     2. Build a candidate object (pure, synchronous). The candidate
 *        is a fully-formed record or state that will be written if
 *        the pipeline validate step passes.
 *     3. Hand the pipeline a validate callback (reads the snapshot)
 *        and a mutate callback (writes to the snapshot).
 *     4. The pipeline snapshots, applies mutate, persists, and rolls
 *        back on failure. This module never touches window.data.
 *
 *   The validate callback re-checks the pre-flight conditions against
 *   the pipeline's snapshot. It is not redundant: between the
 *   pre-flight check and the pipeline's snapshot, another mutation
 *   could have been queued. The snapshot is the source of truth at
 *   mutate time.
 *
 * STATUS TRANSITIONS:
 *   - status is NOT an updatable field via updateTournament
 *   - transitionStatus() is the SINGLE canonical entry point for
 *     status changes
 *   - completeTournament() is a thin wrapper around
 *     transitionStatus(id, 'completed')
 *
 * YEAR SEMANTICS:
 *   - Tournaments are scoped to WEEKS (bounded 1-52), not years.
 *
 * MATCH DELEGATION:
 *   - addRound() uses TournamentMatches.buildRound() (internal pure builder)
 *   - addRound() does NOT call TournamentMatches.createMatch() (public
 *     command). The public command is pipeline-wrapped; calling it
 *     from inside this module's pipeline transaction would nest
 *     pipelines, which is not supported.
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   Pure w.r.t. appData. Called from CharacterCRUD.deleteCharacter
 *   inside its own pipeline transaction. Never throws.
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
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *
 * USAGE:
 *   var Core = window.TournamentCore;
 *
 *   Core.createTournament({ name: 'Spring Cup' }).then(function(result) {
 *       if (result.success) {
 *           var tournament = result.data;
 *       }
 *   });
 *
 *   Core.addParticipant('tourn_123', { id: 'char_123', type: 'character' })
 *       .then(function(result) { ... });
 *
 *   // Reads stay synchronous
 *   var tournament = Core.getTournament('tourn_123');
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

    function getMutationPipeline() {
        return window.MutationPipeline || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getSchema()) { missing.push('TournamentSchema (lazy)'); }
        if (!getLifecycle()) { missing.push('TournamentLifecycle (lazy)'); }
        if (!getRules()) { missing.push('TournamentRules (lazy)'); }
        if (!getMatches()) { missing.push('TournamentMatches (lazy)'); }
        if (!getQueries()) { missing.push('TournamentQueries (lazy)'); }
        if (!getCharacterQueries()) { missing.push('CharacterQueries (lazy)'); }
        if (!getTeamQueries()) { missing.push('TeamQueries (lazy)'); }
        if (!getCalendarValidation()) { missing.push('CalendarValidation (lazy)'); }
        if (!getIdUtils()) { missing.push('IdUtils (lazy)'); }
        if (!getObjectUtils()) { missing.push('ObjectUtils (lazy)'); }
        if (!getMutationPipeline()) { missing.push('MutationPipeline (lazy)'); }

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

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function getDataStore() {
        return window.data || {};
    }

    /**
     * Internal lookup against window.data. Used for pre-flight
     * checks and for the read path. Mutations never use this to
     * write; they use the pipeline's appData snapshot.
     */
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

    // ============================================================
    // INTERNAL SCHEMA / RECORD HELPERS
    // ============================================================

    function validateTournamentInternal(tournament, strict) {
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
        var validation = validateTournamentInternal(tournament, strict === true);
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

    function getParticipantTypeFromRecord(tournament, participantId) {
        var Schema = getSchema();
        if (Schema && typeof Schema.getParticipantTypeFromRecord === 'function') {
            return Schema.getParticipantTypeFromRecord(tournament, participantId);
        }
        return null;
    }

    function isParticipantInTournamentRecord(tournament, participantId, participantType) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isParticipantInTournament === 'function') {
            return Schema.isParticipantInTournament(tournament, participantId, participantType);
        }
        return false;
    }

    function isParticipantEliminatedRecord(tournament, participantId) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isParticipantEliminated === 'function') {
            return Schema.isParticipantEliminated(tournament, participantId);
        }
        return false;
    }

    // ============================================================
    // PIPELINE WRAPPER
    // ============================================================
    //
    // Every mutation below runs inside a MutationPipeline transaction.
    // The wrapper is the single place that shapes the failure log
    // message when the pipeline itself is unavailable. Everything
    // else is handled by the pipeline.

    function runMutation(config) {
        var Pipeline = getMutationPipeline();
        if (!Pipeline || typeof Pipeline.performMutation !== 'function') {
            return Promise.resolve(
                failure('MutationPipeline is not available.')
            );
        }

        return Pipeline.performMutation({
            validate: config.validate || function() { return { valid: true }; },
            mutate: config.mutate,
            logMessage: config.logMessage,
            successMessage: config.successMessage || 'Tournament updated.',
            failureMessage: config.failureMessage || 'Failed to update tournament.'
        });
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    /**
     * Strip all references to a character from tournaments.
     *
     * A character can appear as:
     *   - A tournament participant (participant.type === 'character').
     *   - An elimination record (participantType === 'character').
     *   - The tournament winner (if winner.type === 'character').
     *   - A match participant inside rounds[].matches[].participants[].
     *     Match participants are stored as raw ID arrays; matching IDs
     *     are filtered out. Matches that become empty are pruned.
     *     Within a surviving match, winner / loser / advancing[] fields
     *     are also cleared of the deleted character.
     *
     * This helper is PURE with respect to appData: it mutates the
     * tournaments array, but it does not touch window.data. It is
     * designed to be called from inside a pipeline mutate() callback
     * in another module's transaction. It never throws.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} charId - Character ID to strip
     * @returns {object} Cascade summary
     */
    function stripCharacterRefs(appData, charId) {
        var result = {
            participantRecordsRemoved: 0,
            eliminationRecordsRemoved: 0,
            winnerRecordsCleared: 0,
            matchParticipantSlotsRemoved: 0,
            matchesPruned: 0
        };

        if (!appData || !charId) {
            return result;
        }

        if (!Array.isArray(appData.tournaments)) {
            return result;
        }

        var target = String(charId);

        for (var i = 0; i < appData.tournaments.length; i++) {
            var tournament = appData.tournaments[i];
            if (!tournament || typeof tournament !== 'object') {
                continue;
            }

            if (Array.isArray(tournament.participants)) {
                var beforeP = tournament.participants.length;
                tournament.participants = tournament.participants.filter(function(p) {
                    if (!p) { return true; }
                    if (p.type !== 'character') { return true; }
                    return String(p.id) !== target;
                });
                result.participantRecordsRemoved += beforeP - tournament.participants.length;
            }

            if (Array.isArray(tournament.eliminations)) {
                var beforeE = tournament.eliminations.length;
                tournament.eliminations = tournament.eliminations.filter(function(e) {
                    if (!e) { return true; }
                    if (e.participantType !== 'character') { return true; }
                    return String(e.participantId) !== target;
                });
                result.eliminationRecordsRemoved += beforeE - tournament.eliminations.length;
            }

            if (tournament.winner &&
                tournament.winner.type === 'character' &&
                String(tournament.winner.id) === target) {
                tournament.winner = null;
                result.winnerRecordsCleared++;
            }

            if (Array.isArray(tournament.rounds)) {
                for (var r = 0; r < tournament.rounds.length; r++) {
                    var round = tournament.rounds[r];
                    if (!round || !Array.isArray(round.matches)) {
                        continue;
                    }

                    var matchesToKeep = [];

                    for (var m = 0; m < round.matches.length; m++) {
                        var match = round.matches[m];
                        if (!match || typeof match !== 'object') {
                            matchesToKeep.push(match);
                            continue;
                        }

                        if (Array.isArray(match.participants)) {
                            var beforeM = match.participants.length;
                            match.participants = match.participants.filter(function(id) {
                                return String(id) !== target;
                            });
                            result.matchParticipantSlotsRemoved +=
                                beforeM - match.participants.length;
                        }

                        if (Array.isArray(match.participants) && match.participants.length === 0) {
                            result.matchesPruned++;
                            continue;
                        }

                        if (match.winner && String(match.winner) === target) {
                            match.winner = null;
                        }
                        if (match.loser && String(match.loser) === target) {
                            match.loser = null;
                        }
                        if (Array.isArray(match.advancing)) {
                            match.advancing = match.advancing.filter(function(id) {
                                return String(id) !== target;
                            });
                        }

                        matchesToKeep.push(match);
                    }

                    round.matches = matchesToKeep;
                }
            }
        }

        return result;
    }

    // ============================================================
    // READ HELPERS (delegated to Queries)
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
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return false;
        }

        if (tournament.status !== 'completed') {
            return false;
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
     * @returns {Promise<{ success, data?, message? }>}
     */
    function createTournament(data) {
        if (!isObject(data)) {
            return Promise.resolve(failure('Tournament data is required.'));
        }

        if (!isNonEmptyString(data.name)) {
            return Promise.resolve(failure('Tournament name is required.'));
        }
        var name = data.name.trim();

        var Schema = getSchema();
        var CalendarValidation = getCalendarValidation();

        if (!Schema || !CalendarValidation) {
            return Promise.resolve(failure('Schema or CalendarValidation not available.'));
        }

        var mode = data.mode || 'teams';
        if (!Schema.isValidMode(mode)) {
            return Promise.resolve(failure('Invalid mode: ' + mode));
        }

        var startWeek = data.startWeek !== undefined ? data.startWeek : 1;
        var parsedStart = CalendarValidation.parseWeek(startWeek);
        if (parsedStart === null) {
            return Promise.resolve(failure('Invalid start week.'));
        }

        var endWeek = data.endWeek !== undefined ? data.endWeek : 52;
        var parsedEnd = CalendarValidation.parseWeek(endWeek);
        if (parsedEnd === null) {
            return Promise.resolve(failure('Invalid end week.'));
        }

        if (parsedStart > parsedEnd) {
            return Promise.resolve(failure('Start week cannot be after end week.'));
        }

        var totalRounds = data.totalRounds !== undefined ? data.totalRounds : 1;
        var parsedRounds = parsePositiveInteger(totalRounds);
        if (parsedRounds === null) {
            return Promise.resolve(failure('Invalid total rounds.'));
        }

        var status = data.status || 'draft';
        if (!Schema.isValidStatus(status)) {
            return Promise.resolve(failure('Invalid status: ' + status));
        }

        var graduatingClassId = data.graduatingClassId !== undefined
            ? normaliseId(data.graduatingClassId)
            : null;

        var classFilterEnabled = data.classFilterEnabled !== false;

        var appData = getDataStore();
        if (!appData) {
            return Promise.resolve(failure('Data store not available.'));
        }

        var id = generateUniqueId(appData);
        if (id === null) {
            return Promise.resolve(failure('Failed to generate a unique tournament ID.'));
        }

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

        var validation = validateTournamentInternal(newTournament, true);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.errors.join('; ')));
        }

        return runMutation({
            validate: function(appDataSnapshot) {
                if (!appDataSnapshot || !Array.isArray(appDataSnapshot.tournaments)) {
                    return { valid: false, message: 'Tournament store is not available.' };
                }
                // Re-check for ID collision inside the snapshot.
                var collision = appDataSnapshot.tournaments.some(function(t) {
                    return t && normaliseId(t.id) === id;
                });
                if (collision) {
                    return { valid: false, message: 'Tournament ID collision.' };
                }
                return { valid: true };
            },
            mutate: function(appDataSnapshot) {
                if (!Array.isArray(appDataSnapshot.tournaments)) {
                    appDataSnapshot.tournaments = [];
                }
                appDataSnapshot.tournaments.push(deepClone(newTournament));
                return { tournament: newTournament, id: id };
            },
            logMessage: 'Created tournament: ' + name,
            successMessage: 'Tournament created successfully!',
            failureMessage: 'Failed to create tournament.'
        });
    }

    /**
     * Update an existing tournament.
     *
     * UPDATABLE FIELDS:
     *   name, mode, startWeek, endWeek, totalRounds,
     *   graduatingClassId, classFilterEnabled
     *
     * @param {string} id
     * @param {object} updates
     * @returns {Promise<{ success, data?, message? }>}
     */
    function updateTournament(id, updates) {
        if (!isObject(updates)) {
            return Promise.resolve(failure('Updates must be an object.'));
        }

        var updateKeys = Object.keys(updates);
        if (updateKeys.length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var hasUndefined = updateKeys.some(function(key) {
            return updates[key] === undefined;
        });
        if (hasUndefined) {
            return Promise.resolve(failure('Updates cannot contain undefined values.'));
        }

        var tournament = getValidatedTournament(id, false);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var allowedKeys = [
            'name',
            'mode',
            'startWeek',
            'endWeek',
            'totalRounds',
            'graduatingClassId',
            'classFilterEnabled'
        ];
        var unknownKeys = updateKeys.filter(function(key) {
            return allowedKeys.indexOf(key) === -1;
        });
        if (unknownKeys.length > 0) {
            return Promise.resolve(failure(
                'Unknown or non-updatable keys: ' + unknownKeys.join(', ')
            ));
        }

        var Lifecycle = getLifecycle();
        if (!Lifecycle) {
            return Promise.resolve(failure('TournamentLifecycle not available.'));
        }

        var isStructuralUpdate = updateKeys.some(function(key) {
            return ['name', 'mode', 'startWeek', 'endWeek', 'totalRounds'].indexOf(key) !== -1;
        });

        if (isStructuralUpdate) {
            var onlyNameChange = updateKeys.every(function(key) {
                return key === 'name';
            });

            if (!onlyNameChange && !Lifecycle.canEditMetadata(tournament)) {
                return Promise.resolve(failure('Tournament status does not permit this update.'));
            }
        }

        var proposed = Object.assign({}, tournament);
        Object.keys(updates).forEach(function(key) {
            if (updates[key] !== undefined) {
                proposed[key] = updates[key];
            }
        });

        if (updates.totalRounds !== undefined) {
            var newTotal = parsePositiveInteger(proposed.totalRounds);
            if (newTotal !== null && Array.isArray(tournament.rounds) && tournament.rounds.length > newTotal) {
                return Promise.resolve(failure('Cannot reduce total rounds below the existing round count.'));
            }
        }

        if (updates.mode !== undefined && updates.mode !== tournament.mode) {
            if (Array.isArray(tournament.participants) && tournament.participants.length > 0) {
                return Promise.resolve(failure('Cannot change mode while participants exist.'));
            }
        }

        var validation = validateTournamentInternal(proposed, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.errors.join('; ')));
        }

        var targetId = normaliseId(id);

        return runMutation({
            validate: function(appDataSnapshot) {
                if (!appDataSnapshot || !Array.isArray(appDataSnapshot.tournaments)) {
                    return { valid: false, message: 'Tournament store is not available.' };
                }
                var found = appDataSnapshot.tournaments.some(function(t) {
                    return t && normaliseId(t.id) === targetId;
                });
                if (!found) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appDataSnapshot) {
                var idx = -1;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Tournament not found in data store.');
                }

                var target = appDataSnapshot.tournaments[idx];
                allowedKeys.forEach(function(key) {
                    if (updates[key] === undefined) {
                        return;
                    }
                    target[key] = proposed[key];
                });

                return { tournament: target, id: targetId };
            },
            logMessage: 'Updated tournament: ' + proposed.name,
            successMessage: 'Tournament updated successfully!',
            failureMessage: 'Failed to update tournament.'
        });
    }

    /**
     * Delete a tournament permanently.
     *
     * @param {string} id
     * @returns {Promise<{ success, data?, message? }>}
     */
    function deleteTournament(id) {
        var normalisedId = normaliseId(id);
        if (normalisedId === null) {
            return Promise.resolve(failure('Tournament ID is required.'));
        }

        var tournament = getValidatedTournament(normalisedId, false);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var tournamentName = tournament.name || 'Unknown';

        return runMutation({
            validate: function(appDataSnapshot) {
                if (!appDataSnapshot || !Array.isArray(appDataSnapshot.tournaments)) {
                    return { valid: false, message: 'Tournament store is not available.' };
                }
                var found = appDataSnapshot.tournaments.some(function(t) {
                    return t && normaliseId(t.id) === normalisedId;
                });
                if (!found) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appDataSnapshot) {
                var idx = -1;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === normalisedId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Tournament not found in data store.');
                }
                appDataSnapshot.tournaments.splice(idx, 1);
                return { id: normalisedId };
            },
            logMessage: 'Deleted tournament: ' + tournamentName,
            successMessage: 'Tournament deleted successfully!',
            failureMessage: 'Failed to delete tournament.'
        });
    }

    // ============================================================
    // PARTICIPANT OPERATIONS
    // ============================================================

    /**
     * Add a participant to a tournament.
     *
     * @param {string} tournamentId
     * @param {object} participant - { id, type }
     * @returns {Promise<{ success, data?, message? }>}
     */
    function addParticipant(tournamentId, participant) {
        if (!isObject(participant)) {
            return Promise.resolve(failure('Participant data is required.'));
        }

        var id = normaliseId(participant.id);
        if (id === null) {
            return Promise.resolve(failure('Participant ID is required.'));
        }

        var type = participant.type || 'character';

        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        if (!Array.isArray(tournament.participants)) {
            return Promise.resolve(failure('Tournament participant list is malformed.'));
        }

        var Lifecycle = getLifecycle();
        if (!Lifecycle || !Lifecycle.canModifyParticipants(tournament)) {
            return Promise.resolve(failure(
                'Tournament status "' + tournament.status + '" does not permit participant changes.'
            ));
        }

        var Rules = getRules();
        if (Rules && typeof Rules.canAddParticipant === 'function') {
            if (!Rules.canAddParticipant(tournament, id, type)) {
                return Promise.resolve(failure('Participant cannot be added to this tournament.'));
            }
        }

        var Schema = getSchema();
        if (!Schema || !Schema.isValidParticipantType(type)) {
            return Promise.resolve(failure('Invalid participant type: ' + type));
        }

        var canonicalType = Schema.getCanonicalParticipantType(tournament.mode);
        if (canonicalType === null || type !== canonicalType) {
            return Promise.resolve(failure(
                'Participant type "' + type + '" does not match tournament mode "' +
                tournament.mode + '" (expected "' + canonicalType + '").'
            ));
        }

        var CharacterQueries = getCharacterQueries();
        var TeamQueries = getTeamQueries();

        if (type === 'character') {
            if (!CharacterQueries || !CharacterQueries.getCharacterById(id)) {
                return Promise.resolve(failure('Character not found.'));
            }
        } else if (type === 'team') {
            if (!TeamQueries || !TeamQueries.getTeamById(id)) {
                return Promise.resolve(failure('Team not found.'));
            }
        } else {
            return Promise.resolve(failure('Unsupported participant type.'));
        }

        var exists = tournament.participants.some(function(p) {
            return p && normaliseId(p.id) === id && p.type === type;
        });
        if (exists) {
            return Promise.resolve(failure('Participant is already in this tournament.'));
        }

        var targetId = normaliseId(tournamentId);

        return runMutation({
            validate: function(appDataSnapshot) {
                if (!appDataSnapshot || !Array.isArray(appDataSnapshot.tournaments)) {
                    return { valid: false, message: 'Tournament store is not available.' };
                }
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }
                if (!Array.isArray(current.participants)) {
                    return { valid: false, message: 'Tournament participant list is malformed.' };
                }
                var dup = current.participants.some(function(p) {
                    return p && normaliseId(p.id) === id && p.type === type;
                });
                if (dup) {
                    return { valid: false, message: 'Participant is already in this tournament.' };
                }
                return { valid: true };
            },
            mutate: function(appDataSnapshot) {
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current) {
                    throw new Error('Tournament not found in data store.');
                }
                if (!Array.isArray(current.participants)) {
                    current.participants = [];
                }
                current.participants.push({
                    id: id,
                    type: type,
                    addedAt: new Date().toISOString()
                });
                return { participantId: id, type: type };
            },
            logMessage: 'Added participant to tournament: ' + (tournament.name || targetId),
            successMessage: 'Participant added successfully!',
            failureMessage: 'Failed to add participant.'
        });
    }

    /**
     * Remove a participant from a tournament.
     *
     * @param {string} tournamentId
     * @param {string} participantId
     * @returns {Promise<{ success, data?, message? }>}
     */
    function removeParticipant(tournamentId, participantId) {
        var id = normaliseId(participantId);
        if (id === null) {
            return Promise.resolve(failure('Participant ID is required.'));
        }

        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var Lifecycle = getLifecycle();
        if (!Lifecycle || !Lifecycle.canModifyParticipants(tournament)) {
            return Promise.resolve(failure(
                'Tournament status "' + tournament.status + '" does not permit participant changes.'
            ));
        }

        var Rules = getRules();
        if (Rules && typeof Rules.canRemoveParticipant === 'function') {
            if (!Rules.canRemoveParticipant(tournament, id)) {
                return Promise.resolve(failure('Participant cannot be removed from this tournament.'));
            }
        }

        var participantRecord = null;
        for (var i = 0; i < tournament.participants.length; i++) {
            if (normaliseId(tournament.participants[i].id) === id) {
                participantRecord = tournament.participants[i];
                break;
            }
        }

        if (!participantRecord) {
            return Promise.resolve(failure('Participant not found in this tournament.'));
        }

        var targetId = normaliseId(tournamentId);

        return runMutation({
            validate: function(appDataSnapshot) {
                if (!appDataSnapshot || !Array.isArray(appDataSnapshot.tournaments)) {
                    return { valid: false, message: 'Tournament store is not available.' };
                }
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }
                var present = Array.isArray(current.participants) &&
                    current.participants.some(function(p) {
                        return p && normaliseId(p.id) === id;
                    });
                if (!present) {
                    return { valid: false, message: 'Participant no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appDataSnapshot) {
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current || !Array.isArray(current.participants)) {
                    throw new Error('Tournament not found in data store.');
                }
                current.participants = current.participants.filter(function(p) {
                    return !(p && normaliseId(p.id) === id);
                });
                return { participantId: id };
            },
            logMessage: 'Removed participant from tournament: ' + (tournament.name || targetId),
            successMessage: 'Participant removed successfully!',
            failureMessage: 'Failed to remove participant.'
        });
    }

    // ============================================================
    // ROUND OPERATIONS
    // ============================================================

    /**
     * Add a round to a tournament.
     *
     * @param {string} tournamentId
     * @param {object} roundData - { matchSize, matchType, isPairExam? }
     * @returns {Promise<{ success, data?, message? }>}
     */
    function addRound(tournamentId, roundData) {
        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var Lifecycle = getLifecycle();
        if (!Lifecycle) {
            return Promise.resolve(failure('TournamentLifecycle not available.'));
        }

        if (!Lifecycle.canAddRound(tournament, tournament.rounds.length, tournament.totalRounds)) {
            return Promise.resolve(failure('Cannot add another round to this tournament.'));
        }

        var Rules = getRules();
        if (Rules && typeof Rules.canAddRound === 'function') {
            if (!Rules.canAddRound(tournament, roundData)) {
                return Promise.resolve(failure('Round cannot be added to this tournament.'));
            }
        }

        var matchSize = 2;
        var matchType = 'group_exam';
        var isPairExam = false;

        if (roundData && typeof roundData === 'object') {
            if (roundData.matchSize !== undefined) {
                var size = parsePositiveInteger(roundData.matchSize);
                if (size === null || size < 2) {
                    return Promise.resolve(failure('Match size must be an integer >= 2.'));
                }
                matchSize = size;
            }

            if (roundData.matchType !== undefined) {
                var Schema = getSchema();
                if (!Schema || !Schema.isValidMatchType(roundData.matchType)) {
                    return Promise.resolve(failure('Invalid match type: ' + roundData.matchType));
                }
                matchType = roundData.matchType;
            }

            if (roundData.isPairExam === true) {
                isPairExam = true;
                if (matchType !== 'group_exam') {
                    matchType = 'group_exam';
                }
                matchSize = 2;
            }
        }

        var Matches = getMatches();
        if (!Matches || typeof Matches.buildRound !== 'function') {
            return Promise.resolve(failure('TournamentMatches.buildRound is not available.'));
        }

        var participants = [];
        if (Array.isArray(tournament.participants)) {
            for (var i = 0; i < tournament.participants.length; i++) {
                var p = tournament.participants[i];
                if (p && !isParticipantEliminatedRecord(tournament, p.id)) {
                    participants.push(p.id);
                }
            }
        }

        var roundNumber = tournament.rounds.length + 1;
        var round = Matches.buildRound({
            matchSize: matchSize,
            matchType: matchType,
            roundNumber: roundNumber,
            isPairExam: isPairExam
        }, participants);

        if (!round) {
            return Promise.resolve(failure('Failed to build round.'));
        }

        var targetId = normaliseId(tournamentId);
        var roundCopy = deepClone(round);
        var promoteToActive = tournament.status === 'draft';

        return runMutation({
            validate: function(appDataSnapshot) {
                if (!appDataSnapshot || !Array.isArray(appDataSnapshot.tournaments)) {
                    return { valid: false, message: 'Tournament store is not available.' };
                }
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appDataSnapshot) {
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current) {
                    throw new Error('Tournament not found in data store.');
                }
                if (!Array.isArray(current.rounds)) {
                    current.rounds = [];
                }
                current.rounds.push(roundCopy);
                if (promoteToActive) {
                    current.status = 'active';
                }
                return { round: roundCopy };
            },
            logMessage: 'Added round to tournament: ' + (tournament.name || targetId),
            successMessage: 'Round added successfully!',
            failureMessage: 'Failed to add round.'
        });
    }

    /**
     * Remove a round from a tournament.
     *
     * @param {string} tournamentId
     * @param {number} roundIndex
     * @returns {Promise<{ success, data?, message? }>}
     */
    function removeRound(tournamentId, roundIndex) {
        var index = parseInt(roundIndex, 10);
        if (!Number.isInteger(index)) {
            return Promise.resolve(failure('Round index is required.'));
        }

        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        if (index < 0 || index >= tournament.rounds.length) {
            return Promise.resolve(failure('Round not found.'));
        }

        var Lifecycle = getLifecycle();
        if (!Lifecycle) {
            return Promise.resolve(failure('TournamentLifecycle not available.'));
        }

        if (!Lifecycle.canRemoveRounds(tournament)) {
            return Promise.resolve(failure(
                'Tournament status "' + tournament.status + '" does not permit round removal.'
            ));
        }

        var Rules = getRules();
        if (Rules && typeof Rules.canRemoveRound === 'function') {
            if (!Rules.canRemoveRound(tournament, index)) {
                return Promise.resolve(failure('Round cannot be removed from this tournament.'));
            }
        }

        var targetId = normaliseId(tournamentId);

        return runMutation({
            validate: function(appDataSnapshot) {
                if (!appDataSnapshot || !Array.isArray(appDataSnapshot.tournaments)) {
                    return { valid: false, message: 'Tournament store is not available.' };
                }
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current || !Array.isArray(current.rounds)) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }
                if (index >= current.rounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appDataSnapshot) {
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current || !Array.isArray(current.rounds)) {
                    throw new Error('Tournament not found in data store.');
                }
                current.rounds = current.rounds
                    .filter(function(_, idx) { return idx !== index; })
                    .map(function(round, idx) {
                        var copy = Object.assign({}, round);
                        copy.roundNumber = idx + 1;
                        return copy;
                    });

                if (current.rounds.length === 0) {
                    current.status = 'draft';
                    current.winner = null;
                }

                return { id: targetId };
            },
            logMessage: 'Removed round ' + (index + 1) + ' from tournament: ' + (tournament.name || targetId),
            successMessage: 'Round removed successfully!',
            failureMessage: 'Failed to remove round.'
        });
    }

    // ============================================================
    // STATUS TRANSITION
    // ============================================================

    /**
     * Transition a tournament to a new status.
     *
     * @param {string} tournamentId
     * @param {string} newStatus
     * @param {boolean} force
     * @returns {Promise<{ success, data?, message? }>}
     */
    function transitionStatus(tournamentId, newStatus, force) {
        force = force === true;

        var Schema = getSchema();
        if (!Schema || !Schema.isValidStatus(newStatus)) {
            return Promise.resolve(failure('Invalid status: ' + newStatus));
        }

        var tournament = getValidatedTournament(tournamentId, false);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var currentStatus = tournament.status;

        var Lifecycle = getLifecycle();
        if (!Lifecycle) {
            return Promise.resolve(failure('TournamentLifecycle not available.'));
        }

        if (!Lifecycle.isValidStatusTransition(currentStatus, newStatus)) {
            return Promise.resolve(failure(
                'Transition from "' + currentStatus + '" to "' + newStatus + '" is not allowed.'
            ));
        }

        if (currentStatus === newStatus) {
            return Promise.resolve(failure('Tournament is already in status "' + newStatus + '".'));
        }

        var Rules = getRules();

        if (!force) {
            if (currentStatus === 'draft' && newStatus === 'active') {
                if (Rules && typeof Rules.canStartTournament === 'function') {
                    if (!Rules.canStartTournament(tournament)) {
                        return Promise.resolve(failure('Tournament prerequisites for start are not met.'));
                    }
                }
            }

            if (currentStatus === 'active' && newStatus === 'completed') {
                if (Rules && typeof Rules.isReadyForCompletion === 'function') {
                    if (!Rules.isReadyForCompletion(tournament)) {
                        return Promise.resolve(failure('Tournament is not ready for completion.'));
                    }
                }

                var allRoundsComplete = Array.isArray(tournament.rounds) &&
                    tournament.rounds.length > 0 &&
                    tournament.rounds.every(function(r) {
                        return r && r.status === 'completed';
                    });

                if (!allRoundsComplete || !tournament.winner) {
                    return Promise.resolve(failure('All rounds must be complete and a winner set.'));
                }
            }
        }

        var targetId = normaliseId(tournamentId);

        return runMutation({
            validate: function(appDataSnapshot) {
                if (!appDataSnapshot || !Array.isArray(appDataSnapshot.tournaments)) {
                    return { valid: false, message: 'Tournament store is not available.' };
                }
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }
                if (current.status !== currentStatus) {
                    return { valid: false, message: 'Tournament status has changed since this request was made.' };
                }
                return { valid: true };
            },
            mutate: function(appDataSnapshot) {
                var current = null;
                for (var i = 0; i < appDataSnapshot.tournaments.length; i++) {
                    if (normaliseId(appDataSnapshot.tournaments[i].id) === targetId) {
                        current = appDataSnapshot.tournaments[i];
                        break;
                    }
                }
                if (!current) {
                    throw new Error('Tournament not found in data store.');
                }
                current.status = newStatus;
                return { id: targetId, status: newStatus };
            },
            logMessage: 'Transitioned tournament to "' + newStatus + '": ' + (tournament.name || targetId),
            successMessage: 'Tournament status updated!',
            failureMessage: 'Failed to update tournament status.'
        });
    }

    /**
     * Complete a tournament.
     *
     * @param {string} tournamentId
     * @param {boolean} force
     * @returns {Promise<{ success, data?, message? }>}
     */
    function completeTournament(tournamentId, force) {
        return transitionStatus(tournamentId, 'completed', force === true);
    }

    // ============================================================
    // LIFECYCLE STATUS QUERY (synchronous)
    // ============================================================

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

    function getLifecycleRules(status) {
        var Lifecycle = getLifecycle();
        if (Lifecycle && typeof Lifecycle.getLifecycleRules === 'function') {
            return Lifecycle.getLifecycleRules(status);
        }
        return null;
    }

    function getAllowedTransitions(tournamentId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return [];
        }

        var Lifecycle = getLifecycle();
        if (Lifecycle && typeof Lifecycle.getTransitionOptions === 'function') {
            return Lifecycle.getTransitionOptions(tournament.status);
        }

        return [];
    }

    // ============================================================
    // PUBLIC QUERY HELPERS (synchronous)
    // ============================================================

    function isParticipantInTournament(tournamentId, participantId, participantType) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return false;
        }
        return isParticipantInTournamentRecord(tournament, participantId, participantType);
    }

    function getParticipantType(tournamentId, participantId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return null;
        }
        return getParticipantTypeFromRecord(tournament, participantId);
    }

    function isParticipantEliminated(tournamentId, participantId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament) {
            return false;
        }
        return isParticipantEliminatedRecord(tournament, participantId);
    }

    function getActiveParticipants(tournamentId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && !isParticipantEliminatedRecord(tournament, p.id)) {
                result.push(deepClone(p));
            }
        }
        return result;
    }

    function getWinner(tournamentId) {
        var tournament = getTournamentInternal(tournamentId);
        if (!tournament || !tournament.winner) {
            return null;
        }
        return deepClone(tournament.winner);
    }

    function validateTournament(tournament, strict) {
        return validateTournamentInternal(tournament, strict !== false);
    }

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
        // ---- Tournament CRUD (Promise-based) ----
        createTournament: createTournament,
        updateTournament: updateTournament,
        deleteTournament: deleteTournament,

        // ---- Participant Management (Promise-based) ----
        addParticipant: addParticipant,
        removeParticipant: removeParticipant,

        // ---- Round Management (Promise-based) ----
        addRound: addRound,
        removeRound: removeRound,

        // ---- Status Transitions (Promise-based) ----
        transitionStatus: transitionStatus,
        completeTournament: completeTournament,

        // ---- Lifecycle Status (synchronous) ----
        getLifecycleStatus: getLifecycleStatus,
        getLifecycleRules: getLifecycleRules,
        getAllowedTransitions: getAllowedTransitions,

        // ---- Cascade helpers (for cross-domain cleanup) ----
        stripCharacterRefs: stripCharacterRefs,

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
            'transitionStatus', 'completeTournament',
            'getLifecycleStatus', 'getLifecycleRules', 'getAllowedTransitions',
            'stripCharacterRefs',
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
        }
    })();

})();
