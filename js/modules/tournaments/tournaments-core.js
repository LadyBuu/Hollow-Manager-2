/**
 * js/modules/tournaments/tournaments-core.js - Core Tournament Operations
 * CANONICAL mutation API for tournaments.
 * 
 * MUTATION PHILOSOPHY:
 *   - Caller is responsible for persistence (saveData)
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Schema is SOLE source of truth for STRUCTURAL validation
 *   - Core owns OPERATION-LEVEL business rules and mutation semantics
 *   - Mutations are VALIDATION-ATOMIC: all validation completes before any mutation
 *   - Malformed existing data is NOT silently repaired
 *   - Getters return LIVE references to domain objects (do not mutate them directly)
 * 
 * SCHEMA vs CORE DISTINCTION:
 *   - Schema: "Is this tournament structurally valid?"
 *   - Core: "Is this operation allowed?"
 *   - Schema validates the object graph; Core validates operation semantics
 * 
 * TOURNAMENT LIFECYCLE RULES:
 *   ┌─────────┬──────────┬──────────┬───────────┐
 *   │          │  Draft   │  Active  │ Completed │
 *   ├─────────┼──────────┼──────────┼───────────┤
 *   │ rename  │    ✓     │    ✓     │     -     │
 *   │ change mode│  ✓*    │    -     │     -     │
 *   │ change weeks│ ✓     │    -     │     -     │
 *   │ change rounds│ ✓    │    -     │     -     │
 *   │ add participant│ ✓  │    -     │     -     │
 *   │ remove participant│✓│    -     │     -     │
 *   │ add round│   ✓     │    ✓     │     -     │
 *   │ remove round│  ✓    │    -     │     -     │
 *   │ eliminate │   -    │    ✓     │     -     │
 *   │ restore   │   -    │    ✓     │     -     │
 *   │ complete  │   -    │    ✓     │     -     │
 *   │ delete    │   ✓    │    ✓     │     ✓     │
 *   └─────────┴──────────┴──────────┴───────────┘
 *   * mode cannot change if participants exist
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT call saveData()
 *   - Callers own persistence
 * 
 * MUTATION PATTERN (applied to ALL mutations):
 *   1. Retrieve existing data (live reference)
 *   2. Validate existing structure (pre-mutation check)
 *   3. Validate operation-specific inputs (REJECT invalid)
 *   4. Build complete proposed state, cloning every structure that will be mutated
 *   5. Validate proposed state against Schema
 *   6. Apply mutations (only if all validation passes)
 * 
 * GETTER SEMANTICS:
 *   - getTournament() returns a live reference to the domain object.
 *     Callers MUST NOT mutate it directly; use Core mutation methods.
 *   - getTournaments() returns a shallow array copy containing live tournament
 *     references. The array is safe to iterate, but the tournament objects
 *     inside are live references.
 *   - getAllTournaments() returns a shallow array copy containing live tournament
 *     references. Same semantics as getTournaments().
 * 
 * DELETION SEMANTICS:
 *   - deleteTournament() validates the existing tournament structure before
 *     deletion. Malformed tournaments are rejected to maintain data integrity.
 *   - For administrative purge of corrupted records, use a separate repair/delete
 *     operation (TournamentsRepair).
 * 
 * DEPENDENCIES:
 *   - window.TournamentsSchema - SOLE source of truth for structural validation (required)
 *   - window.CALENDAR_CONSTANTS - Week constants (from constants.js)
 *   - window.ID_CONSTANTS - ID prefixes (from constants.js)
 *   - window.logActivity - Activity logging (from app.js)
 * 
 * CANONICAL FIELDS:
 *   - id, name, mode, startWeek, endWeek, totalRounds, status
 *   - participants, rounds, eliminations, winner, createdAt, _schemaVersion
 *   - currentRound is DERIVED from rounds.length - NEVER STORED
 *   - teams, matches, winners are LEGACY - NOT PART OF CANONICAL SCHEMA
 * 
 * ROUND NUMBER SEMANTICS:
 *   - roundNumber is POSITIONAL per schema definition (index + 1)
 *   - Removing a round renumbers subsequent rounds
 *   - This is INTENTIONAL: round numbers are structural identifiers
 *   - No external references should rely on roundNumber stability
 */

(function() {
    'use strict';

    // Guard: allow re-initialisation if Schema loads later
    if (window.__tournamentsCoreLoaded) return;

    // ============================================================
    // DEPENDENCIES - Schema is the SOLE source of truth
    // ============================================================

    var Schema = window.TournamentsSchema;
    if (!Schema) {
        console.error('TournamentsCore: TournamentsSchema is required but not loaded.');
        return;
    }

    // Check CALENDAR_CONSTANTS
    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var MIN_WEEK = Number.isInteger(CALENDAR.MIN_WEEK) ? CALENDAR.MIN_WEEK : 1;
    var MAX_WEEK = Number.isInteger(CALENDAR.MAX_WEEK) ? CALENDAR.MAX_WEEK : 52;

    // Mark as loaded ONLY after Schema is confirmed
    window.__tournamentsCoreLoaded = true;

    // Import from Schema - NO DUPLICATED CONSTANTS OR VALIDATION
    var VALID_MODES = Schema.VALID_MODES;
    var VALID_STATUSES = Schema.VALID_STATUSES;
    var VALID_PARTICIPANT_TYPES = Schema.VALID_PARTICIPANT_TYPES;
    var UPDATEABLE_PROPERTIES = [
        'name', 'mode', 'startWeek', 'endWeek', 'totalRounds', 'status'
    ];

    var isObject = Schema.isObject;
    var parsePositiveInteger = Schema.parsePositiveInteger;
    var isValidWeek = Schema.isValidWeek;
    var isValidMode = Schema.isValidMode;
    var isValidStatus = Schema.isValidStatus;
    var isValidParticipantType = Schema.isValidParticipantType;
    var isValidMatchType = Schema.isValidMatchType;
    var normaliseId = Schema.normaliseId;

    // ============================================================
    // LIFECYCLE RULE HELPERS
    // ============================================================

    /**
     * Check if a status allows structural changes (name, mode, weeks, rounds).
     */
    function isStatusMutable(status) {
        return status === 'draft';
    }

    /**
     * Check if a status allows participant changes.
     */
    function isStatusParticipantMutable(status) {
        return status === 'draft';
    }

    /**
     * Check if a status allows elimination operations.
     */
    function isStatusEliminationMutable(status) {
        return status === 'active';
    }

    /**
     * Check if a status allows round operations.
     */
    function isStatusRoundMutable(status) {
        return status === 'draft' || status === 'active';
    }

    /**
     * Check if a status is terminal.
     */
    function isStatusTerminal(status) {
        return status === 'completed';
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        if (!Array.isArray(window.data.tournaments)) return null;
        return window.data;
    }

    /**
     * Validate a tournament object against the Schema.
     * strict: true (default) = reject unknown properties
     * strict: false = allow unknown properties, enforce all structural rules
     */
    function validateTournament(tournament, strict) {
        strict = strict !== false;
        return Schema.validateTournament(tournament, { strict: strict });
    }

    /**
     * Validate that a tournament exists and is structurally valid.
     * 
     * IMPORTANT: Default strict = false. Existing data may contain legacy
     * properties that are not in the canonical schema. We still enforce all
     * structural rules, but allow unknown properties.
     * 
     * This differs from validateTournament() which defaults to strict = true
     * for new/proposed data.
     * 
     * strict: false = allow unknown properties, enforce all structural rules (default)
     * strict: true = also reject unknown properties
     */
    function getValidatedTournament(id, strict) {
        strict = strict === true; // Default to false
        var tournament = getTournamentInternal(id);
        if (!tournament) return null;
        var validation = validateTournament(tournament, strict);
        if (!validation.valid) return null;
        return tournament;
    }

    /**
     * Internal getter - does not validate.
     * Returns the live tournament object reference.
     */
    function getTournamentInternal(id) {
        var normalisedId = normaliseId(id);
        if (normalisedId === null) return null;
        var data = getDataStore();
        if (!data) return null;
        return data.tournaments.find(function(t) {
            return t && normaliseId(t.id) === normalisedId;
        }) || null;
    }

    /**
     * Deep clone a round object for proposed state construction.
     * Clones all currently schema-defined mutable nested structures.
     */
    function cloneRound(round) {
        if (!round || typeof round !== 'object') return round;
        var copy = Object.assign({}, round);
        if (Array.isArray(round.matches)) {
            copy.matches = round.matches.map(function(match) {
                // Deep clone all schema-defined nested structures
                var matchCopy = Object.assign({}, match);
                if (match.results && typeof match.results === 'object') {
                    matchCopy.results = Object.assign({}, match.results);
                }
                if (match.participants && Array.isArray(match.participants)) {
                    matchCopy.participants = match.participants.slice();
                }
                if (match.advancing && Array.isArray(match.advancing)) {
                    matchCopy.advancing = match.advancing.slice();
                }
                return matchCopy;
            });
        }
        return copy;
    }

    /**
     * Deep clone a participant object for proposed state construction.
     * Participant objects are flat, so shallow copy is sufficient.
     */
    function cloneParticipant(participant) {
        if (!participant || typeof participant !== 'object') return participant;
        return Object.assign({}, participant);
    }

    /**
     * Deep clone an elimination record for proposed state construction.
     * Elimination records are flat, so shallow copy is sufficient.
     */
    function cloneElimination(elimination) {
        if (!elimination || typeof elimination !== 'object') return elimination;
        return Object.assign({}, elimination);
    }

    /**
     * Canonicalise numeric fields for storage.
     * Applied BEFORE validation so the validated object matches the stored object.
     */
    function canonicaliseUpdateValue(key, value) {
        if (key === 'startWeek' || key === 'endWeek' || key === 'totalRounds') {
            var num = Number(value);
            return Number.isFinite(num) ? num : value;
        }
        return value;
    }

    /**
     * Build a proposed tournament state for an update operation.
     * Only shallow-copies the tournament as no nested structures are mutated
     * by scalar field updates.
     */
    function buildProposedState(tournament, updates) {
        var proposed = Object.assign({}, tournament);
        Object.keys(updates).forEach(function(key) {
            if (updates[key] !== undefined) {
                proposed[key] = canonicaliseUpdateValue(key, updates[key]);
            }
        });
        return proposed;
    }

    /**
     * Generate a unique tournament ID with proper attempt counting.
     * Normalises the generated ID for consistent comparison.
     */
    function generateUniqueId(appData) {
        var attempts = 0;
        var maxAttempts = 10;
        var id;
        var generated = false;
        var prefix = 'tourn';

        // Use ID_CONSTANTS if available
        if (window.ID_CONSTANTS && window.ID_CONSTANTS.PREFIXES) {
            prefix = window.ID_CONSTANTS.PREFIXES.TOURNAMENT || 'tourn';
        }

        while (!generated && attempts < maxAttempts) {
            id = typeof window.generateId === 'function'
                ? window.generateId(prefix)
                : prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            attempts++;

            var normalisedId = normaliseId(id);
            if (normalisedId === null) continue;

            var collision = appData.tournaments.some(function(t) {
                return t && normaliseId(t.id) === normalisedId;
            });

            if (!collision) {
                generated = true;
            }
        }

        if (!generated) return null;
        return normaliseId(id);
    }

    /**
     * Rebuild eliminated weeks from eliminations data.
     * This ensures derived state remains consistent with source data.
     * Called after any mutation that affects eliminations.
     * 
     * NOTE: This rebuilds derived state from authoritative source data.
     * It is NOT a repair operation - it keeps derived state in sync.
     */
    function rebuildEliminatedWeeks(char) {
        if (!char || typeof char !== 'object') {
            return;
        }

        if (!Array.isArray(char.eliminations)) {
            char.eliminatedWeeks = [];
            return;
        }

        var weeks = [];
        var seen = {};

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim || typeof elim !== 'object') continue;

            var week = parsePositiveInteger(elim.week);
            if (week === null) continue;

            var key = String(week);
            if (!seen[key]) {
                seen[key] = true;
                weeks.push(week);
            }
        }

        weeks.sort(function(a, b) { return a - b; });
        char.eliminatedWeeks = weeks;
    }

    /**
     * Build a complete proposed character state for elimination mutations.
     * Ensures cross-domain atomicity.
     * 
     * NOTE: CharacterSchema is not currently available.
     * This validates cross-domain elimination invariants locally.
     */
    function buildProposedCharacterState(char, tournamentId, charElimination) {
        var proposedChar = Object.assign({}, char);
        proposedChar.eliminations = char.eliminations ? char.eliminations.slice() : [];
        proposedChar.eliminations.push(charElimination);

        // Rebuild derived state on the proposed object
        var tempChar = Object.assign({}, proposedChar);
        rebuildEliminatedWeeks(tempChar);
        proposedChar.eliminatedWeeks = tempChar.eliminatedWeeks;

        return proposedChar;
    }

    /**
     * Validate that an elimination week falls within tournament bounds.
     * Returns true if valid, false otherwise.
     */
    function isEliminationWeekInBounds(tournament, week) {
        var start = Number(tournament.startWeek);
        var end = Number(tournament.endWeek);
        var weekNum = Number(week);
        return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(weekNum) &&
            weekNum >= start && weekNum <= end;
    }

    // ============================================================
    // ACTIVITY LOGGING HELPER
    // ============================================================

    function recordActivity(message) {
        try {
            if (typeof window.logActivity === 'function') {
                window.logActivity(message);
            }
        } catch (err) {
            // Swallow logging errors
        }
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

        /**
         * Get a tournament by ID. Returns a LIVE reference.
         * Do NOT mutate the returned object directly. Use Core mutation methods.
         */
        getTournament: function(id) {
            return getTournamentInternal(id);
        },

        /**
         * Get all tournaments. Returns a SHALLOW array copy containing
         * live tournament references. The array is safe to iterate, but the
         * tournament objects are live references. Do NOT mutate them directly.
         */
        getTournaments: function() {
            var data = getDataStore();
            return data ? data.tournaments.slice() : [];
        },

        /**
         * Get all tournaments (alias for getTournaments).
         * Returns a SHALLOW array copy containing live tournament references.
         */
        getAllTournaments: function() {
            return this.getTournaments();
        },

        /**
         * Create a new tournament.
         * Produces CANONICAL objects only. No legacy fields.
         * 
         * @param {object} data - Tournament data
         * @returns {object|null} Created tournament or null
         */
        createTournament: function(data) {
            if (!isObject(data)) return null;

            // ---- PHASE 1: VALIDATE INPUTS (REJECT INVALID, NO SILENT SANITISATION) ----
            if (data.name === undefined || data.name === null || String(data.name).trim() === '') {
                return null;
            }
            var name = String(data.name).trim();

            var mode = data.mode !== undefined ? data.mode : 'teams';
            if (!isValidMode(mode)) return null;

            // Use calendar constants for defaults
            var startWeek = data.startWeek !== undefined ? data.startWeek : MIN_WEEK;
            if (!isValidWeek(startWeek)) return null;

            var endWeek = data.endWeek !== undefined ? data.endWeek : MAX_WEEK;
            if (!isValidWeek(endWeek)) return null;

            var totalRounds = data.totalRounds !== undefined ? data.totalRounds : 1;
            if (parsePositiveInteger(totalRounds) === null) return null;

            var status = data.status !== undefined ? data.status : 'draft';
            if (!isValidStatus(status)) return null;

            if (Number(startWeek) > Number(endWeek)) return null;

            var appData = getDataStore();
            if (!appData) return null;

            // ---- PHASE 2: GENERATE UNIQUE ID ----
            var id = generateUniqueId(appData);
            if (id === null) return null;

            // ---- PHASE 3: BUILD CANONICAL TOURNAMENT ----
            // CANONICAL FIELDS ONLY - no currentRound, teams, matches, winners
            var newTournament = {
                id: id,
                name: name,
                mode: mode,
                startWeek: Number(startWeek),
                endWeek: Number(endWeek),
                totalRounds: Number(totalRounds),
                status: status,
                participants: [],
                rounds: [],
                eliminations: [],
                winner: null,
                createdAt: new Date().toISOString(),
                _schemaVersion: Schema.SCHEMA_VERSION
            };

            // ---- PHASE 4: VALIDATE COMPLETE OBJECT AGAINST SCHEMA ----
            var validation = validateTournament(newTournament, true);
            if (!validation.valid) return null;

            // ---- PHASE 5: PERSIST ----
            appData.tournaments.push(newTournament);
            recordActivity('Created tournament: ' + newTournament.name);

            return newTournament;
        },

        /**
         * Update an existing tournament.
         * Rejects unknown update keys regardless of strict mode.
         * Validates proposed state leniently to preserve legacy fields.
         * 
         * LIFECYCLE RULE: Only draft tournaments can be structurally modified.
         * 
         * @param {string} id - Tournament ID
         * @param {object} updates - Updates to apply
         * @param {boolean} strict - Reserved for future use (ignored)
         * @returns {object|null} Updated tournament or null
         */
        updateTournament: function(id, updates, strict) {
            // strict parameter is reserved - updates always validate leniently
            // to preserve legacy fields

            if (!isObject(updates)) return null;

            // Reject undefined values (they mean "do not update")
            var hasUndefined = Object.keys(updates).some(function(key) {
                return updates[key] === undefined;
            });
            if (hasUndefined) return null;

            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING (LENIENT) ----
            var tournament = getValidatedTournament(id, false);
            if (!tournament) return null;

            // ---- PHASE 2: LIFECYCLE CHECK ----
            // Structural changes (name, mode, weeks, rounds) require draft status
            var isStructuralUpdate = Object.keys(updates).some(function(key) {
                return UPDATEABLE_PROPERTIES.indexOf(key) !== -1;
            });

            if (isStructuralUpdate) {
                // Name changes are allowed in active tournaments
                var onlyNameChange = Object.keys(updates).every(function(key) {
                    return key === 'name';
                });

                if (!onlyNameChange && !isStatusMutable(tournament.status)) {
                    return null;
                }
            }

            // ---- PHASE 3: REJECT UNKNOWN UPDATE KEYS (ALWAYS) ----
            var unknownKeys = Object.keys(updates).filter(function(key) {
                return UPDATEABLE_PROPERTIES.indexOf(key) === -1;
            });
            if (unknownKeys.length > 0) return null;

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
            // Always lenient to preserve legacy fields
            var validation = validateTournament(proposed, false);
            if (!validation.valid) return null;

            // ---- PHASE 7: APPLY VALIDATED UPDATES ----
            var changes = [];
            var hasChanges = false;

            UPDATEABLE_PROPERTIES.forEach(function(key) {
                if (updates[key] === undefined) return;
                if (tournament[key] !== proposed[key]) {
                    tournament[key] = proposed[key];
                    changes.push(key);
                    hasChanges = true;
                }
            });

            if (hasChanges && changes.length > 0) {
                recordActivity('Updated tournament: ' + tournament.name + ' (' + changes.join(', ') + ')');
            }

            return tournament;
        },

        /**
         * Delete a tournament permanently.
         * 
         * NOTE: Validates the existing tournament structure before deletion.
         * Malformed tournaments are rejected to maintain data integrity.
         * Use TournamentsRepair for administrative purge of corrupted records.
         * 
         * NOTE: Replaces the tournaments array reference. Any stale references
         * to window.data.tournaments held elsewhere will no longer be valid.
         * 
         * LIFECYCLE RULE: Any tournament can be deleted regardless of status.
         * 
         * @param {string} id - Tournament ID
         * @returns {boolean} Success
         */
        deleteTournament: function(id) {
            var normalisedId = normaliseId(id);
            if (normalisedId === null) return false;

            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(normalisedId, false);
            if (!tournament) return false;

            // ---- PHASE 2: MUTATE ----
            var data = getDataStore();
            if (!data) return false;

            var name = tournament.name;
            data.tournaments = data.tournaments.filter(function(t) {
                return t && normaliseId(t.id) !== normalisedId;
            });

            recordActivity('Deleted tournament: ' + name);

            return true;
        },

        /**
         * Add a participant to a tournament.
         * 
         * LIFECYCLE RULE: Only draft tournaments can receive new participants.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {object} participant - { id, type }
         * @returns {boolean} Success
         */
        addParticipant: function(tournamentId, participant) {
            var id = normaliseId(participant && participant.id);
            if (id === null) return false;

            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) return false;

            if (!Array.isArray(tournament.participants)) return false;

            // ---- PHASE 2: LIFECYCLE CHECK ----
            if (!isStatusParticipantMutable(tournament.status)) {
                return false;
            }

            var type = participant.type !== undefined ? participant.type : 'character';
            if (!isValidParticipantType(type)) return false;

            // OPERATION RULE: participant type must match tournament mode
            if (tournament.mode === 'teams' && type !== 'team') return false;
            if (tournament.mode === 'individuals' && type !== 'character') return false;

            var data = getDataStore();
            if (!data) return false;

            // Verify entity exists
            if (type === 'character') {
                var charExists = Array.isArray(data.characters) &&
                    data.characters.some(function(c) {
                        return c && normaliseId(c.id) === id;
                    });
                if (!charExists) return false;
            } else if (type === 'team') {
                var teamExists = Array.isArray(data.teams) &&
                    data.teams.some(function(t) {
                        return t && normaliseId(t.id) === id;
                    });
                if (!teamExists) return false;
            }

            // Type-aware existence check
            var exists = tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id && p.type === type;
            });

            if (exists) return false;

            // ---- PHASE 3: BUILD PROPOSED STATE (clone participants) ----
            var proposed = Object.assign({}, tournament);
            proposed.participants = tournament.participants.map(cloneParticipant);
            proposed.participants.push({
                id: id,
                type: type,
                addedAt: new Date().toISOString()
            });

            // ---- PHASE 4: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            // ---- PHASE 5: APPLY MUTATION ----
            tournament.participants = proposed.participants;

            recordActivity('Added participant to tournament: ' + tournament.name);

            return true;
        },

        /**
         * Remove a participant from a tournament.
         * Prevents removal if rounds exist (historical data preservation).
         * 
         * LIFECYCLE RULE: Only draft tournaments can have participants removed.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {string} participantId - Participant ID
         * @returns {boolean} Success
         */
        removeParticipant: function(tournamentId, participantId) {
            var id = normaliseId(participantId);
            if (id === null) return false;

            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament || !Array.isArray(tournament.participants)) return false;

            // ---- PHASE 2: LIFECYCLE CHECK ----
            if (!isStatusParticipantMutable(tournament.status)) {
                return false;
            }

            // OPERATION RULE: participants cannot be removed after rounds exist
            if (Array.isArray(tournament.rounds) && tournament.rounds.length > 0) return false;

            // Check if participant exists
            var exists = tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id;
            });
            if (!exists) return false;

            // ---- PHASE 3: BUILD PROPOSED STATE (clone participants) ----
            var proposed = Object.assign({}, tournament);
            proposed.participants = tournament.participants
                .map(cloneParticipant)
                .filter(function(p) {
                    return p && normaliseId(p.id) !== id;
                });

            // ---- PHASE 4: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            // ---- PHASE 5: APPLY MUTATION ----
            tournament.participants = proposed.participants;

            recordActivity('Removed participant from tournament: ' + tournament.name);

            return true;
        },

        /**
         * Add a round to a tournament.
         * 
         * LIFECYCLE RULE: Draft and Active tournaments can add rounds.
         * Completed tournaments cannot add rounds.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {object} roundData - { matchSize, matchType }
         * @returns {boolean} Success
         */
        addRound: function(tournamentId, roundData) {
            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) return false;

            if (!Array.isArray(tournament.rounds)) return false;

            // ---- PHASE 2: LIFECYCLE CHECK ----
            if (!isStatusRoundMutable(tournament.status)) {
                return false;
            }

            // OPERATION RULE: cannot exceed totalRounds
            if (tournament.rounds.length >= tournament.totalRounds) return false;

            var matchSize = 2;
            var matchType = 'standard';

            if (roundData && typeof roundData === 'object') {
                if (roundData.matchSize !== undefined) {
                    var size = parsePositiveInteger(roundData.matchSize);
                    if (size === null || size < 2) return false;
                    matchSize = size;
                }

                if (roundData.matchType !== undefined) {
                    if (!isValidMatchType(roundData.matchType)) return false;
                    matchType = roundData.matchType;
                }
            }

            // ---- PHASE 3: BUILD PROPOSED STATE (clone rounds) ----
            var round = {
                roundNumber: tournament.rounds.length + 1,
                status: 'pending',
                matchSize: matchSize,
                matchType: matchType,
                matches: []
            };

            var proposed = Object.assign({}, tournament);
            proposed.rounds = tournament.rounds.map(cloneRound);
            proposed.rounds.push(round);

            // currentRound is DERIVED - do not store it
            // OPERATION RULE: If status is draft, promote to active
            if (proposed.status === 'draft') {
                proposed.status = 'active';
            }

            // ---- PHASE 4: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            // ---- PHASE 5: APPLY MUTATION ----
            tournament.rounds = proposed.rounds;
            if (proposed.status !== tournament.status) {
                tournament.status = proposed.status;
            }

            recordActivity('Added round ' + round.roundNumber + ' to tournament: ' + tournament.name);

            return true;
        },

        /**
         * Remove a round from a tournament.
         * Rounds are renumbered after removal (positional semantics).
         * 
         * LIFECYCLE RULE: Only draft tournaments can remove rounds.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {number} roundIndex - Index of round to remove (0-based)
         * @returns {boolean} Success
         */
        removeRound: function(tournamentId, roundIndex) {
            // ---- VALIDATE INDEX TYPE ----
            var index = Number(roundIndex);
            if (!Number.isInteger(index)) return false;

            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament || !Array.isArray(tournament.rounds)) return false;

            if (index < 0 || index >= tournament.rounds.length) return false;

            // ---- PHASE 2: LIFECYCLE CHECK ----
            if (!isStatusMutable(tournament.status)) {
                return false;
            }

            // ---- PHASE 3: BUILD PROPOSED STATE (DEEP CLONE rounds) ----
            // Round objects must be cloned to avoid mutating originals during validation
            var proposed = Object.assign({}, tournament);
            proposed.rounds = tournament.rounds
                .filter(function(_, idx) {
                    return idx !== index;
                })
                .map(function(round, idx) {
                    var copy = cloneRound(round);
                    // Renumber rounds to maintain positional semantics
                    copy.roundNumber = idx + 1;
                    return copy;
                });

            // currentRound is DERIVED - do not store it

            if (proposed.rounds.length === 0) {
                proposed.status = 'draft';
                proposed.winner = null;
            }

            // ---- PHASE 4: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            // ---- PHASE 5: APPLY MUTATION ----
            var removedRound = tournament.rounds[index];
            tournament.rounds = proposed.rounds;
            tournament.status = proposed.status;
            tournament.winner = proposed.winner;

            var roundNum = removedRound ? removedRound.roundNumber : index + 1;
            recordActivity('Removed round ' + roundNum + ' from tournament: ' + tournament.name);

            return true;
        },

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
         * @param {string} reason - Reason for elimination
         * @returns {boolean} Success
         */
        markCharacterEliminated: function(tournamentId, characterId, week, reason) {
            // ---- PHASE 1: VALIDATE INPUTS ----
            if (!isValidWeek(week)) return false;
            var weekNum = Number(week);

            var eliminationReason;
            if (reason === undefined) {
                eliminationReason = 'Eliminated from tournament';
            } else {
                if (typeof reason !== 'string') return false;
                eliminationReason = reason;
            }

            var id = normaliseId(characterId);
            if (id === null) return false;

            // ---- PHASE 2: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) return false;

            if (!Array.isArray(tournament.eliminations)) return false;

            // ---- PHASE 3: LIFECYCLE CHECK ----
            if (!isStatusEliminationMutable(tournament.status)) {
                return false;
            }

            // OPERATION RULE: Elimination week must be within tournament bounds
            if (!isEliminationWeekInBounds(tournament, weekNum)) {
                return false;
            }

            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) return false;

            var char = data.characters.find(function(c) {
                return c && normaliseId(c.id) === id;
            });

            if (!char) return false;

            if (!Array.isArray(char.eliminations)) return false;

            var isParticipant = Array.isArray(tournament.participants) &&
                tournament.participants.some(function(p) {
                    return p &&
                        p.type === 'character' &&
                        normaliseId(p.id) === id;
                });

            if (!isParticipant) return false;

            var exists = tournament.eliminations.some(function(e) {
                return e && normaliseId(e.participantId) === id;
            });

            if (exists) return false;

            // ---- PHASE 4: BUILD PROPOSED CHARACTER STATE ----
            var tournamentIdNormalised = normaliseId(tournamentId);

            var charElimination = {
                tournamentId: tournamentIdNormalised,
                week: weekNum,
                reason: eliminationReason,
                standalone: false,
                fromMatch: true
            };

            var proposedChar = buildProposedCharacterState(char, tournamentIdNormalised, charElimination);

            // ---- PHASE 5: VALIDATE PROPOSED CHARACTER ----
            // CharacterSchema is not currently available.
            // Validate the cross-domain elimination invariants locally.
            if (!Array.isArray(proposedChar.eliminations)) {
                return false;
            }
            // Check for duplicate tournament eliminations (should not happen)
            var dupCheck = proposedChar.eliminations.filter(function(e) {
                return e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised;
            });
            if (dupCheck.length > 1) {
                return false;
            }

            // ---- PHASE 6: BUILD PROPOSED TOURNAMENT STATE ----
            var tournamentElimination = {
                participantId: id,
                participantType: 'character',
                week: weekNum,
                reason: eliminationReason
            };

            var proposedTournament = Object.assign({}, tournament);
            proposedTournament.eliminations = tournament.eliminations.map(cloneElimination);
            proposedTournament.eliminations.push(tournamentElimination);

            // ---- PHASE 7: VALIDATE PROPOSED TOURNAMENT AGAINST SCHEMA ----
            var validation = validateTournament(proposedTournament, false);
            if (!validation.valid) return false;

            // ---- PHASE 8: APPLY MUTATIONS (ALL VALIDATION COMPLETE) ----
            tournament.eliminations = proposedTournament.eliminations;
            char.eliminations = proposedChar.eliminations;
            char.eliminatedWeeks = proposedChar.eliminatedWeeks;

            recordActivity('Eliminated character from tournament: ' + tournament.name);

            return true;
        },

        /**
         * Restore a character from tournament elimination.
         * Cross-domain atomic: validates BOTH tournament and character states before mutation.
         * 
         * LIFECYCLE RULE: Only active tournaments can have eliminations restored.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {string} characterId - Character ID
         * @returns {boolean} Success
         */
        unmarkCharacterEliminated: function(tournamentId, characterId) {
            // ---- PHASE 1: VALIDATE INPUTS ----
            var id = normaliseId(characterId);
            if (id === null) return false;

            // ---- PHASE 2: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament || !Array.isArray(tournament.eliminations)) return false;

            // ---- PHASE 3: LIFECYCLE CHECK ----
            if (!isStatusEliminationMutable(tournament.status)) {
                return false;
            }

            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) return false;

            var char = data.characters.find(function(c) {
                return c && normaliseId(c.id) === id;
            });

            if (!char || !Array.isArray(char.eliminations)) return false;

            var tournamentIdNormalised = normaliseId(tournamentId);

            // Find the exact elimination to remove - type-aware
            var elimToRemove = tournament.eliminations.find(function(e) {
                return e &&
                    e.participantType === 'character' &&
                    normaliseId(e.participantId) === id;
            });

            if (!elimToRemove) return false;

            // Verify the character-side elimination exists
            var charElimExists = char.eliminations.some(function(e) {
                return e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised;
            });

            if (!charElimExists) return false;

            // ---- PHASE 4: BUILD PROPOSED CHARACTER STATE ----
            var proposedChar = Object.assign({}, char);
            proposedChar.eliminations = char.eliminations.filter(function(e) {
                return !(e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised);
            });
            rebuildEliminatedWeeks(proposedChar);

            // ---- PHASE 5: BUILD PROPOSED TOURNAMENT STATE ----
            var proposedTournament = Object.assign({}, tournament);
            proposedTournament.eliminations = tournament.eliminations
                .map(cloneElimination)
                .filter(function(e) {
                    return !(e && e.participantType === 'character' && normaliseId(e.participantId) === id);
                });

            // ---- PHASE 6: VALIDATE PROPOSED TOURNAMENT AGAINST SCHEMA ----
            var validation = validateTournament(proposedTournament, false);
            if (!validation.valid) return false;

            // ---- PHASE 7: APPLY MUTATIONS (ALL VALIDATION COMPLETE) ----
            tournament.eliminations = proposedTournament.eliminations;
            char.eliminations = proposedChar.eliminations;
            char.eliminatedWeeks = proposedChar.eliminatedWeeks;

            recordActivity('Restored character from tournament: ' + tournament.name);

            return true;
        },

        /**
         * Check if a tournament is complete.
         * 
         * @param {string} tournamentId - Tournament ID
         * @returns {boolean} True if complete
         */
        isComplete: function(tournamentId) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament) return false;
            return Schema.isTournamentComplete(tournament);
        },

        /**
         * Mark a tournament as completed.
         * 
         * LIFECYCLE RULE: Only active tournaments can be completed.
         * 
         * @param {string} tournamentId - Tournament ID
         * @param {boolean} force - Force completion even if prerequisites not met
         * @returns {boolean} Success
         */
        completeTournament: function(tournamentId, force) {
            force = force === true;

            // ---- PHASE 1: RETRIEVE AND VALIDATE EXISTING ----
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) return false;

            // ---- PHASE 2: LIFECYCLE CHECK ----
            if (!isStatusEliminationMutable(tournament.status)) {
                return false;
            }

            if (tournament.status === 'completed') return false;

            // ---- PHASE 3: CHECK COMPLETION PREREQUISITES ----
            if (!force) {
                if (!Schema.isTournamentComplete(tournament)) return false;
            }

            // ---- PHASE 4: BUILD PROPOSED STATE ----
            var proposed = Object.assign({}, tournament);
            proposed.status = 'completed';

            // ---- PHASE 5: VALIDATE PROPOSED AGAINST SCHEMA ----
            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            // ---- PHASE 6: APPLY MUTATION ----
            tournament.status = proposed.status;

            recordActivity('Completed tournament: ' + tournament.name);

            return true;
        },

        // ============================================================
        // DELEGATED SCHEMA HELPERS
        // ============================================================

        getParticipantType: function(tournament, participantId) {
            return Schema.getParticipantType(tournament, participantId);
        },

        isParticipantInTournament: function(tournament, participantId) {
            return Schema.isParticipantInTournament(tournament, participantId);
        },

        getParticipants: function(tournament) {
            return Schema.getParticipants(tournament);
        },

        getActiveParticipants: function(tournament) {
            return Schema.getActiveParticipants(tournament);
        },

        isParticipantEliminated: function(tournament, participantId) {
            return Schema.isParticipantEliminated(tournament, participantId);
        },

        validateTournament: function(tournament, strict) {
            strict = strict !== false;
            return Schema.validateTournament(tournament, { strict: strict });
        },

        getValidationReport: function(tournament) {
            return Schema.getValidationReport(tournament);
        },

        /**
         * Get the current round number (derived from rounds.length).
         * This is a QUERY, not a stored value.
         */
        getCurrentRound: function(tournament) {
            return Schema.getCurrentRound(tournament);
        },

        /**
         * Get the lifecycle status of a tournament.
         * Returns the current status and whether it can be modified.
         */
        getLifecycleStatus: function(tournament) {
            if (!tournament) {
                return { status: 'unknown', mutable: false };
            }
            return {
                status: tournament.status,
                mutable: isStatusMutable(tournament.status),
                participantMutable: isStatusParticipantMutable(tournament.status),
                eliminationMutable: isStatusEliminationMutable(tournament.status),
                roundMutable: isStatusRoundMutable(tournament.status),
                terminal: isStatusTerminal(tournament.status)
            };
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsCore = TournamentsCore;

})();
