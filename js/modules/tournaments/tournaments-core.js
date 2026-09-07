/**
 * js/modules/tournaments/tournaments-core.js - Core Tournament Operations
 * CANONICAL mutation API for tournaments.
 * 
 * MUTATION PHILOSOPHY:
 *   - Caller is responsible for persistence via MutationUtils
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Schema is SOLE source of truth for STRUCTURAL validation
 *   - Lifecycle is SOLE source of truth for OPERATION permissions
 *   - Core owns MUTATION implementation semantics
 *   - Mutations are VALIDATION-ATOMIC: all validation completes before any mutation
 *   - Malformed existing data is NOT silently repaired
 *   - Getters return DEFENSIVE COPIES to prevent external mutation
 * 
 * SCHEMA vs CORE vs LIFECYCLE DISTINCTION:
 *   - Schema: "Is this tournament structurally valid?"
 *   - Lifecycle: "Is this operation allowed for this status?"
 *   - Core: "Perform the mutation if valid and allowed"
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT call saveData()
 *   - This module does NOT log activity
 *   - MutationUtils owns persistence and activity logging
 * 
 * DEPENDENCIES:
 *   - window.TournamentsSchema - SOLE source of truth for structural validation
 *   - window.TournamentLifecycle - SOLE source of truth for lifecycle permissions
 *   - window.CharacterQueries - Character existence and data queries
 *   - window.TeamQueries - Team existence and data queries
 *   - window.CalendarValidation - Week validation
 *   - window.IdUtils - ID generation
 *   - window.ObjectUtils - Deep cloning
 * 
 * CANONICAL FIELDS:
 *   - id, name, mode, startWeek, endWeek, totalRounds, status
 *   - participants, rounds, eliminations, winner, createdAt, _schemaVersion
 *   - graduatingClassId, classFilterEnabled
 *   - currentRound is DERIVED from rounds.length - NEVER STORED
 * 
 * ROUND NUMBER SEMANTICS:
 *   - roundNumber is POSITIONAL per schema definition (index + 1)
 *   - Removing a round renumbers subsequent rounds
 *   - This is INTENTIONAL: round numbers are structural identifiers
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tournamentsCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.TournamentsSchema) {
        missing.push('TournamentsSchema');
    }

    if (!window.TournamentLifecycle) {
        missing.push('TournamentLifecycle');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamById !== 'function') {
        missing.push('TeamQueries.getTeamById');
    }

    if (!window.CalendarValidation) {
        missing.push('CalendarValidation');
    }

    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (missing.length > 0) {
        throw new Error('[TournamentsCore] Missing dependencies: ' + missing.join(', '));
    }

    window.__tournamentsCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Schema = window.TournamentsSchema;
    var Lifecycle = window.TournamentLifecycle;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var CalendarValidation = window.CalendarValidation;
    var IdUtils = window.IdUtils;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_MODES = Schema.VALID_MODES;
    var VALID_STATUSES = Schema.VALID_STATUSES;
    var VALID_PARTICIPANT_TYPES = Schema.VALID_PARTICIPANT_TYPES;
    var MIN_WEEK = Schema.MIN_WEEK;
    var MAX_WEEK = Schema.MAX_WEEK;

    // Updateable properties - frozen
    var UPDATEABLE_PROPERTIES = Object.freeze([
        'name', 'mode', 'startWeek', 'endWeek', 'totalRounds', 'status',
        'graduatingClassId', 'classFilterEnabled'
    ]);

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
        return Schema.normaliseId(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < 1) {
            return null;
        }
        return num;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
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
        strict = strict !== false;
        return Schema.validateTournament(tournament, { strict: strict });
    }

    function getValidatedTournament(id, strict) {
        strict = strict === true;
        var tournament = getTournamentInternal(id);
        if (!tournament) {
            return null;
        }
        var validation = validateTournament(tournament, strict);
        if (!validation.valid) {
            return null;
        }
        return tournament;
    }

    function canonicaliseUpdateValue(key, value) {
        if (key === 'startWeek' || key === 'endWeek' || key === 'totalRounds') {
            return CalendarValidation.parseWeek(value);
        }
        return value;
    }

    function buildProposedState(tournament, updates) {
        var proposed = Object.assign({}, tournament);
        Object.keys(updates).forEach(function(key) {
            if (updates[key] !== undefined) {
                proposed[key] = canonicaliseUpdateValue(key, updates[key]);
            }
        });
        return proposed;
    }

    function generateUniqueId(appData) {
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

    function participantExists(participants, id) {
        var normalised = normaliseId(id);
        if (normalised === null) {
            return false;
        }
        for (var i = 0; i < participants.length; i++) {
            if (normaliseId(participants[i].id) === normalised) {
                return true;
            }
        }
        return false;
    }

    function getParticipant(participants, id) {
        var normalised = normaliseId(id);
        if (normalised === null) {
            return null;
        }
        for (var i = 0; i < participants.length; i++) {
            if (normaliseId(participants[i].id) === normalised) {
                return participants[i];
            }
        }
        return null;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // CORE API
    // ============================================================

    var TournamentsCore = {
        // Constants exposed for callers (from Schema)
        VALID_MODES: VALID_MODES,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,

        // Schema access for callers
        Schema: Schema,
        Lifecycle: Lifecycle,

        // ============================================================
        // GETTERS - Return DEFENSIVE COPIES
        // ============================================================

        /**
         * Get a tournament by ID. Returns a defensive copy.
         * Do NOT mutate the returned object - it's a copy.
         * 
         * @param {string} id - Tournament ID
         * @returns {object|null} Tournament object or null
         */
        getTournament: function(id) {
            var tournament = getTournamentInternal(id);
            if (!tournament) {
                return null;
            }
            return deepClone(tournament);
        },

        /**
         * Get all tournaments. Returns a shallow array copy containing
         * defensive copies of tournament objects.
         * 
         * @returns {array} Array of tournament objects
         */
        getTournaments: function() {
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
        },

        /**
         * Get all tournaments (alias for getTournaments).
         * 
         * @returns {array} Array of tournament objects
         */
        getAllTournaments: function() {
            return this.getTournaments();
        },

        // ============================================================
        // CREATE
        // ============================================================

        /**
         * Create a new tournament.
         * Produces CANONICAL objects only. No legacy fields.
         * 
         * @param {object} data - Tournament data
         * @returns {object|null} Created tournament or null
         */
        createTournament: function(data) {
            if (!isObject(data)) {
                return null;
            }

            // ---- PHASE 1: VALIDATE INPUTS ----
            if (!isNonEmptyString(data.name)) {
                return null;
            }
            var name = data.name.trim();

            var mode = data.mode || 'teams';
            if (!Schema.isValidMode(mode)) {
                return null;
            }

            var startWeek = data.startWeek !== undefined ? data.startWeek : MIN_WEEK;
            var parsedStart = CalendarValidation.parseWeek(startWeek);
            if (parsedStart === null) {
                return null;
            }

            var endWeek = data.endWeek !== undefined ? data.endWeek : MAX_WEEK;
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
        },

        // ============================================================
        // UPDATE
        // ============================================================

        /**
         * Update an existing tournament.
         * Rejects unknown update keys.
         * Validates proposed state leniently to preserve legacy fields.
         * 
         * @param {string} id - Tournament ID
         * @param {object} updates - Updates to apply
         * @returns {object|null} Updated tournament or null
         */
        updateTournament: function(id, updates) {
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

                if (!onlyNameChange && !Lifecycle.canEditTournament(tournament)) {
                    return null;
                }
            }

            // ---- PHASE 3: REJECT UNKNOWN UPDATE KEYS ----
            var unknownKeys = updateKeys.filter(function(key) {
                return UPDATEABLE_PROPERTIES.indexOf(key) === -1;
            });
            if (unknownKeys.length > 0) {
                return null;
            }

            // ---- PHASE 4: BUILD PROPOSED STATE ----
            var proposed = buildProposedState(tournament, updates);

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
            var changes = [];
            var hasChanges = false;

            UPDATEABLE_PROPERTIES.forEach(function(key) {
                if (updates[key] === undefined) {
                    return;
                }
                if (tournament[key] !== proposed[key]) {
                    tournament[key] = proposed[key];
                    changes.push(key);
                    hasChanges = true;
                }
            });

            if (!hasChanges) {
                return deepClone(tournament);
            }

            return deepClone(tournament);
        },

        // ============================================================
        // DELETE
        // ============================================================

        /**
         * Delete a tournament permanently.
         * Any tournament can be deleted regardless of status.
         * 
         * @param {string} id - Tournament ID
         * @returns {boolean} Success
         */
        deleteTournament: function(id) {
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
        },

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
        addParticipant: function(tournamentId, participant) {
            if (!isObject(participant)) {
                return false;
            }

            var id = normaliseId(participant.id);
            if (id === null) {
                return false;
            }

            var type = participant.type || 'character';
            if (!Schema.isValidParticipantType(type)) {
                return false;
            }

            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) {
                return false;
            }

            if (!Array.isArray(tournament.participants)) {
                return false;
            }

            // ---- PHASE 2: LIFECYCLE CHECK ----
            if (!Lifecycle.canModifyParticipants(tournament)) {
                return false;
            }

            // OPERATION RULE: participant type must match tournament mode
            var canonicalType = Schema.getCanonicalParticipantType(tournament.mode);
            if (canonicalType === null) {
                return false;
            }
            if (type !== canonicalType) {
                return false;
            }

            var data = getDataStore();
            if (!data) {
                return false;
            }

            // Verify entity exists using domain queries
            if (type === 'character') {
                if (!CharacterQueries.getCharacterById(id)) {
                    return false;
                }
            } else if (type === 'team') {
                if (!TeamQueries.getTeamById(id)) {
                    return false;
                }
            } else {
                return false;
            }

            // Check for duplicate using both id and type
            var exists = tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id && p.type === type;
            });

            if (exists) {
                return false;
            }

            // ---- PHASE 3: BUILD PROPOSED STATE ----
            var proposed = Object.assign({}, tournament);
            proposed.participants = tournament.participants.slice();
            proposed.participants.push({
                id: id,
                type: type,
                addedAt: new Date().toISOString()
            });

            // ---- PHASE 4: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) {
                return false;
            }

            // ---- PHASE 5: APPLY MUTATION ----
            tournament.participants = proposed.participants;

            return true;
        },

        /**
         * Remove a participant from a tournament.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {string} participantId - Participant ID
         * @returns {boolean} Success
         */
        removeParticipant: function(tournamentId, participantId) {
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
            if (!Lifecycle.canModifyParticipants(tournament)) {
                return false;
            }

            // OPERATION RULE: participants cannot be removed after rounds exist
            if (Array.isArray(tournament.rounds) && tournament.rounds.length > 0) {
                return false;
            }

            // Check if participant exists (by id and type)
            var participantRecord = getParticipant(tournament.participants, id);
            if (!participantRecord) {
                return false;
            }

            // ---- PHASE 3: BUILD PROPOSED STATE ----
            var proposed = Object.assign({}, tournament);
            proposed.participants = tournament.participants.filter(function(p) {
                return !(p && normaliseId(p.id) === id);
            });

            // ---- PHASE 4: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) {
                return false;
            }

            // ---- PHASE 5: APPLY MUTATION ----
            tournament.participants = proposed.participants;

            return true;
        },

        // ============================================================
        // ROUND OPERATIONS
        // ============================================================

        /**
         * Add a round to a tournament.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {object} roundData - { matchSize, matchType }
         * @returns {boolean} Success
         */
        addRound: function(tournamentId, roundData) {
            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return false;
            }

            // ---- PHASE 2: LIFECYCLE CHECK ----
            if (!Lifecycle.canAddRound(tournament, tournament.rounds.length, tournament.totalRounds)) {
                return false;
            }

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
                    if (!Schema.isValidMatchType(roundData.matchType)) {
                        return false;
                    }
                    matchType = roundData.matchType;
                }
            }

            // ---- PHASE 3: BUILD PROPOSED STATE ----
            var round = {
                roundNumber: tournament.rounds.length + 1,
                status: 'pending',
                matchSize: matchSize,
                matchType: matchType,
                matches: []
            };

            var proposed = Object.assign({}, tournament);
            proposed.rounds = tournament.rounds.slice().map(function(r) {
                return Object.assign({}, r);
            });
            proposed.rounds.push(round);

            // If status is draft, promote to active
            if (proposed.status === 'draft') {
                proposed.status = 'active';
            }

            // ---- PHASE 4: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) {
                return false;
            }

            // ---- PHASE 5: APPLY MUTATION ----
            tournament.rounds = proposed.rounds;
            if (proposed.status !== tournament.status) {
                tournament.status = proposed.status;
            }

            return true;
        },

        /**
         * Remove a round from a tournament.
         * Rounds are renumbered after removal (positional semantics).
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of round to remove (0-based)
         * @returns {boolean} Success
         */
        removeRound: function(tournamentId, roundIndex) {
            var index = Number(roundIndex);
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
            // Round removal only allowed in draft status
            if (!Lifecycle.canEditTournament(tournament)) {
                return false;
            }

            // ---- PHASE 3: BUILD PROPOSED STATE ----
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

            // ---- PHASE 4: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) {
                return false;
            }

            // ---- PHASE 5: APPLY MUTATION ----
            tournament.rounds = proposed.rounds;
            tournament.status = proposed.status;
            tournament.winner = proposed.winner;

            return true;
        },

        // ============================================================
        // TOURNAMENT COMPLETION
        // ============================================================

        /**
         * Mark a tournament as completed.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {boolean} force - Force completion (bypasses prerequisites)
         * @returns {boolean} Success
         */
        completeTournament: function(tournamentId, force) {
            force = force === true;

            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) {
                return false;
            }

            // ---- PHASE 2: LIFECYCLE CHECK ----
            if (!Lifecycle.canCompleteTournament(tournament, !!tournament.winner)) {
                return false;
            }

            if (tournament.status === 'completed') {
                return false;
            }

            // ---- PHASE 3: CHECK COMPLETION PREREQUISITES ----
            if (!force) {
                // Check that all rounds are completed and winner exists
                var allRoundsComplete = Array.isArray(tournament.rounds) &&
                    tournament.rounds.every(function(r) {
                        return r && r.status === 'completed';
                    });

                if (!allRoundsComplete || !tournament.winner) {
                    return false;
                }
            }

            // ---- PHASE 4: BUILD PROPOSED STATE ----
            var proposed = Object.assign({}, tournament);
            proposed.status = 'completed';

            // ---- PHASE 5: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) {
                return false;
            }

            // ---- PHASE 6: APPLY MUTATION ----
            tournament.status = proposed.status;

            return true;
        },

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
        getLifecycleStatus: function(tournamentId) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament) {
                return {
                    status: 'unknown',
                    valid: false,
                    mutable: false,
                    edit: false,
                    participants: false,
                    rounds: false,
                    eliminations: false,
                    complete: false,
                    terminal: false
                };
            }
            return Lifecycle.getLifecycleStatus(tournament);
        },

        // ============================================================
        // QUERY HELPERS (Delegated to Schema - read-only)
        // ============================================================

        /**
         * Get the current round number (derived from rounds.length).
         * This is a QUERY, not a stored value.
         * 
         * @param {object} tournament - Tournament object
         * @returns {number} Current round number
         */
        getCurrentRound: function(tournament) {
            if (!tournament || !Array.isArray(tournament.rounds)) {
                return 0;
            }
            return tournament.rounds.length;
        },

        /**
         * Check if a tournament is complete.
         * This is a QUERY-LAYER projection.
         * 
         * @param {string} tournamentId - Tournament ID
         * @returns {boolean} True if complete
         */
        isComplete: function(tournamentId) {
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
        },

        /**
         * Get participants of a tournament (defensive copy).
         * 
         * @param {string} tournamentId - Tournament ID
         * @returns {array} Array of participants
         */
        getParticipants: function(tournamentId) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament || !Array.isArray(tournament.participants)) {
                return [];
            }
            return tournament.participants.map(function(p) {
                return deepClone(p);
            }).filter(function(p) { return p !== null; });
        },

        /**
         * Check if a participant is in a tournament.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {string} participantId - Participant ID
         * @param {string} participantType - Participant type (optional)
         * @returns {boolean} True if participant is in tournament
         */
        isParticipantInTournament: function(tournamentId, participantId, participantType) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament) {
                return false;
            }
            return Schema.isParticipantInTournament(tournament, participantId, participantType);
        },

        /**
         * Get participant type from tournament record.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {string} participantId - Participant ID
         * @returns {string|null} Participant type or null
         */
        getParticipantType: function(tournamentId, participantId) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament) {
                return null;
            }
            return Schema.getParticipantTypeFromRecord(tournament, participantId);
        },

        /**
         * Check if a participant is eliminated.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {string} participantId - Participant ID
         * @returns {boolean} True if eliminated
         */
        isParticipantEliminated: function(tournamentId, participantId) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament) {
                return false;
            }
            return Schema.isParticipantEliminated(tournament, participantId);
        },

        /**
         * Get the canonical participant type for a mode.
         * 
         * @param {string} mode - Tournament mode
         * @returns {string|null} Canonical participant type or null
         */
        getCanonicalParticipantType: function(mode) {
            return Schema.getCanonicalParticipantType(mode);
        },

        /**
         * Get active participants (not eliminated).
         * 
         * @param {string} tournamentId - Tournament ID
         * @returns {array} Array of active participants
         */
        getActiveParticipants: function(tournamentId) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament || !Array.isArray(tournament.participants)) {
                return [];
            }

            var eliminations = Array.isArray(tournament.eliminations)
                ? tournament.eliminations
                : [];

            var eliminatedIds = {};
            for (var i = 0; i < eliminations.length; i++) {
                var id = normaliseId(eliminations[i].participantId);
                if (id !== null) {
                    eliminatedIds[id] = true;
                }
            }

            var result = [];
            for (var i = 0; i < tournament.participants.length; i++) {
                var p = tournament.participants[i];
                if (p && !eliminatedIds[normaliseId(p.id)]) {
                    result.push(deepClone(p));
                }
            }
            return result;
        },

        /**
         * Validate a tournament against the schema.
         * 
         * @param {object} tournament - Tournament to validate
         * @param {boolean} strict - Strict validation
         * @returns {object} Validation result
         */
        validateTournament: function(tournament, strict) {
            strict = strict !== false;
            return Schema.validateTournament(tournament, { strict: strict });
        },

        /**
         * Get a validation report for a tournament.
         * 
         * @param {object} tournament - Tournament to report on
         * @returns {object} Validation report
         */
        getValidationReport: function(tournament) {
            return Schema.getValidationReport(tournament);
        },

        /**
         * Get the winner of a tournament (defensive copy).
         * 
         * @param {string} tournamentId - Tournament ID
         * @returns {object|null} Winner object or null
         */
        getWinner: function(tournamentId) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament || !tournament.winner) {
                return null;
            }
            return deepClone(tournament.winner);
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsCore = TournamentsCore;

})();
