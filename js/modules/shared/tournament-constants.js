/**
 * modules/tournaments/tournament-constants.js - Tournament Constants
 * Single source of truth for all tournament-related constants
 * Path: js/modules/tournaments/tournament-constants.js
 * 
 * This module provides:
 *   - Tournament status definitions (draft, active, completed)
 *   - Tournament mode definitions (teams, individuals)
 *   - Match type definitions (standard, group_exam)
 *   - Match status definitions (pending, in_progress, completed)
 *   - Participant type definitions (character, team)
 *   - Group exam result definitions (pass, fail)
 *   - Lifecycle rules (permissions by status)
 *   - Status transition rules
 *   - Default values
 *   - Bounds from CalendarConstants
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for tournament constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - Uses lazy loading for CalendarConstants
 *   - Validation runs BEFORE publishing to ensure integrity
 *   - No DOM, no state, no persistence - pure constants only
 * 
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Tournaments are scoped to WEEKS (bounded 1-52), not years.
 *   - Year bounds were never used by tournament logic; they were
 *     inherited from CalendarConstants for symmetry with teams.
 *     They are removed here.
 * 
 * DEPENDENCIES:
 *   - window.CalendarConstants (for week bounds) - LAZY LOADED
 * 
 * USAGE:
 *   var TC = window.TournamentConstants;
 *   var statuses = TC.VALID_STATUSES;
 *   var isDraft = TC.VALID_STATUSES.indexOf(status) !== -1;
 *   var canEdit = TC.LIFECYCLE_RULES[status].edit;
 *   var weekRange = { min: TC.MIN_WEEK, max: TC.MAX_WEEK };
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tournamentConstantsLoaded) {
        return;
    }
    window.__tournamentConstantsLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    // ============================================================
    // GET BOUNDS - Lazy load from CalendarConstants
    // ============================================================
    // 
    // Only week bounds are relevant for tournaments. Year bounds
    // are no longer part of the calendar model.

    function getBounds() {
        var CC = getCalendarConstants();
        if (!CC) {
            // Default bounds if CalendarConstants not loaded yet
            return {
                MIN_WEEK: 1,
                MAX_WEEK: 52
            };
        }
        return {
            MIN_WEEK: CC.MIN_WEEK || 1,
            MAX_WEEK: CC.MAX_WEEK || 52
        };
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];
        var CC = getCalendarConstants();

        if (!CC) {
            missing.push('CalendarConstants (lazy)');
        } else {
            // Verify required properties exist
            var required = ['MIN_WEEK', 'MAX_WEEK'];
            for (var i = 0; i < required.length; i++) {
                if (typeof CC[required[i]] !== 'number') {
                    missing.push('CalendarConstants.' + required[i]);
                }
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentConstants] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }

        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }

        return Object.freeze(obj);
    }

    // ============================================================
    // TOURNAMENT STATUSES - Canonical Source of Truth
    // ============================================================

    /**
     * Valid tournament statuses.
     * 
     * - draft: Tournament is being set up, editable
     * - active: Tournament is running, limited edits
     * - completed: Tournament is finished, read-only
     */
    var VALID_STATUSES = [
        'draft',
        'active',
        'completed'
    ];

    // ============================================================
    // TOURNAMENT MODES - Canonical Source of Truth
    // ============================================================

    /**
     * Valid tournament modes.
     * 
     * - teams: Participants are teams
     * - individuals: Participants are individual characters
     */
    var VALID_MODES = [
        'teams',
        'individuals'
    ];

    // ============================================================
    // MATCH TYPES - Canonical Source of Truth
    // ============================================================

    /**
     * Valid match types.
     * 
     * - standard: Two participants, winner advances
     * - group_exam: Multiple participants, pass/fail results
     */
    var VALID_MATCH_TYPES = [
        'standard',
        'group_exam'
    ];

    // ============================================================
    // MATCH STATUSES - Canonical Source of Truth
    // ============================================================

    /**
     * Valid match statuses.
     * 
     * - pending: Match not yet played
     * - in_progress: Match is currently being played
     * - completed: Match is finished
     */
    var VALID_MATCH_STATUSES = [
        'pending',
        'in_progress',
        'completed'
    ];

    // ============================================================
    // PARTICIPANT TYPES - Canonical Source of Truth
    // ============================================================

    /**
     * Valid participant types.
     * 
     * - character: A single character
     * - team: A team of characters
     */
    var VALID_PARTICIPANT_TYPES = [
        'character',
        'team'
    ];

    // ============================================================
    // GROUP EXAM RESULTS - Canonical Source of Truth
    // ============================================================

    /**
     * Valid group exam results.
     * 
     * - pass: Participant advances
     * - fail: Participant is eliminated
     */
    var VALID_GROUP_EXAM_RESULTS = [
        'pass',
        'fail'
    ];

    // ============================================================
    // DEFAULT VALUES
    // ============================================================

    var DEFAULT_STATUS = 'draft';
    var DEFAULT_MODE = 'teams';
    var DEFAULT_MATCH_TYPE = 'standard';
    var DEFAULT_ROUND_MATCH_SIZE = 2;
    var DEFAULT_TOTAL_ROUNDS = 1;

    // ============================================================
    // LIFECYCLE RULES - Explicit permissions by status
    // ============================================================

    /**
     * Lifecycle rules per status.
     * 
     * Each status defines what operations are permitted:
     * - canEditMetadata: Can change name, mode, weeks, totalRounds
     * - canModifyParticipants: Can add/remove participants
     * - canAddRounds: Can add new rounds
     * - canRemoveRounds: Can remove existing rounds (subject to rules)
     * - canModifyEliminations: Can add/remove eliminations
     * - canComplete: Can mark tournament as completed
     * 
     * NOTE: These are STATUS-BASED permissions.
     * Additional conditions are checked in TournamentRules.
     */
    var LIFECYCLE_RULES = {
        draft: {
            canEditMetadata: true,
            canModifyParticipants: true,
            canAddRounds: true,
            canRemoveRounds: true,
            canModifyEliminations: false,
            canComplete: false,
            description: 'Setup phase - fully editable'
        },
        active: {
            canEditMetadata: true,
            canModifyParticipants: false,
            canAddRounds: true,
            canRemoveRounds: false,  // Cannot remove once active
            canModifyEliminations: true,
            canComplete: true,
            description: 'Running phase - limited edits'
        },
        completed: {
            canEditMetadata: false,
            canModifyParticipants: false,
            canAddRounds: false,
            canRemoveRounds: false,
            canModifyEliminations: false,
            canComplete: false,
            description: 'Finished phase - read only'
        }
    };

    // ============================================================
    // STATUS TRANSITION RULES
    // ============================================================

    /**
     * Allowed status transitions.
     * Maps from status to array of allowed target statuses.
     */
    var STATUS_TRANSITIONS = {
        'draft': ['active', 'completed'],
        'active': ['completed'],
        'completed': []
    };

    // ============================================================
    // CANONICAL PARTICIPANT TYPE BY MODE
    // ============================================================

    /**
     * Mapping from mode to canonical participant type.
     */
    var MODE_TO_PARTICIPANT_TYPE = {
        'teams': 'team',
        'individuals': 'character'
    };

    // ============================================================
    // DERIVED DATA
    // ============================================================

    // Status set for quick lookup
    var _statusSet = Object.create(null);
    VALID_STATUSES.forEach(function(s) {
        _statusSet[s] = true;
    });

    // Mode set for quick lookup
    var _modeSet = Object.create(null);
    VALID_MODES.forEach(function(m) {
        _modeSet[m] = true;
    });

    // Match type set for quick lookup
    var _matchTypeSet = Object.create(null);
    VALID_MATCH_TYPES.forEach(function(t) {
        _matchTypeSet[t] = true;
    });

    // Match status set for quick lookup
    var _matchStatusSet = Object.create(null);
    VALID_MATCH_STATUSES.forEach(function(s) {
        _matchStatusSet[s] = true;
    });

    // Participant type set for quick lookup
    var _participantTypeSet = Object.create(null);
    VALID_PARTICIPANT_TYPES.forEach(function(t) {
        _participantTypeSet[t] = true;
    });

    // Group exam result set for quick lookup
    var _groupExamResultSet = Object.create(null);
    VALID_GROUP_EXAM_RESULTS.forEach(function(r) {
        _groupExamResultSet[r] = true;
    });

    // ============================================================
    // LOOKUP FUNCTIONS
    // ============================================================

    /**
     * Check if a status is valid.
     * 
     * @param {string} status - Status to check
     * @returns {boolean} True if valid
     */
    function isValidStatus(status) {
        return _statusSet[status] === true;
    }

    /**
     * Check if a mode is valid.
     * 
     * @param {string} mode - Mode to check
     * @returns {boolean} True if valid
     */
    function isValidMode(mode) {
        return _modeSet[mode] === true;
    }

    /**
     * Check if a match type is valid.
     * 
     * @param {string} type - Match type to check
     * @returns {boolean} True if valid
     */
    function isValidMatchType(type) {
        return _matchTypeSet[type] === true;
    }

    /**
     * Check if a match status is valid.
     * 
     * @param {string} status - Match status to check
     * @returns {boolean} True if valid
     */
    function isValidMatchStatus(status) {
        return _matchStatusSet[status] === true;
    }

    /**
     * Check if a participant type is valid.
     * 
     * @param {string} type - Participant type to check
     * @returns {boolean} True if valid
     */
    function isValidParticipantType(type) {
        return _participantTypeSet[type] === true;
    }

    /**
     * Check if a group exam result is valid.
     * 
     * @param {string} result - Result to check
     * @returns {boolean} True if valid
     */
    function isValidGroupExamResult(result) {
        return _groupExamResultSet[result] === true;
    }

    /**
     * Get the canonical participant type for a mode.
     * 
     * @param {string} mode - Tournament mode
     * @returns {string|null} Canonical participant type or null
     */
    function getCanonicalParticipantType(mode) {
        return MODE_TO_PARTICIPANT_TYPE[mode] || null;
    }

    /**
     * Check if a participant type matches the canonical type for a mode.
     * 
     * @param {string} mode - Tournament mode
     * @param {string} type - Participant type
     * @returns {boolean} True if matches
     */
    function isParticipantTypeCanonical(mode, type) {
        return getCanonicalParticipantType(mode) === type;
    }

    /**
     * Get lifecycle rules for a status.
     * 
     * @param {string} status - Tournament status
     * @returns {object|null} Lifecycle rules or null
     */
    function getLifecycleRules(status) {
        return LIFECYCLE_RULES[status] || null;
    }

    /**
     * Check if a status transition is allowed.
     * 
     * @param {string} fromStatus - Current status
     * @param {string} toStatus - Target status
     * @returns {boolean} True if transition is allowed
     */
    function isStatusTransitionAllowed(fromStatus, toStatus) {
        if (!isValidStatus(fromStatus) || !isValidStatus(toStatus)) {
            return false;
        }
        if (fromStatus === toStatus) {
            return true;  // No-op transition is always allowed
        }
        var allowed = STATUS_TRANSITIONS[fromStatus];
        return allowed && allowed.indexOf(toStatus) !== -1;
    }

    /**
     * Get allowed transitions for a status.
     * 
     * @param {string} status - Current status
     * @returns {array} Array of allowed target statuses
     */
    function getAllowedTransitions(status) {
        if (!isValidStatus(status)) {
            return [];
        }
        return STATUS_TRANSITIONS[status] || [];
    }

    // ============================================================
    // COMPUTED PROPERTIES (lazy loaded from CalendarConstants)
    // ============================================================

    var _computedBounds = null;

    function getComputedBounds() {
        if (!_computedBounds) {
            var bounds = getBounds();
            _computedBounds = {
                MIN_WEEK: bounds.MIN_WEEK,
                MAX_WEEK: bounds.MAX_WEEK
            };
            Object.freeze(_computedBounds);
        }
        return _computedBounds;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate all constants for internal consistency.
     * 
     * Invariants checked:
     *   - VALID_STATUSES: non-empty, no duplicates, no empty strings
     *   - VALID_MODES: non-empty, no duplicates
     *   - VALID_MATCH_TYPES: non-empty, no duplicates
     *   - VALID_MATCH_STATUSES: non-empty, no duplicates
     *   - VALID_PARTICIPANT_TYPES: non-empty, no duplicates
     *   - VALID_GROUP_EXAM_RESULTS: non-empty, no duplicates
     *   - DEFAULT_* values are in their respective valid sets
     *   - DEFAULT_ROUND_MATCH_SIZE >= 2
     *   - LIFECYCLE_RULES keys match VALID_STATUSES exactly
     *   - LIFECYCLE_RULES entries have all required boolean capabilities
     *     and a non-empty description
     *   - STATUS_TRANSITIONS keys match VALID_STATUSES exactly
     *   - Every transition target is a valid status
     *   - No status transitions to itself via the table (no-op handled
     *     separately by isStatusTransitionAllowed)
     *   - MODE_TO_PARTICIPANT_TYPE keys match VALID_MODES exactly
     *   - MODE_TO_PARTICIPANT_TYPE values are valid participant types
     * 
     * Runs once at load. Logs warnings; does not throw.
     * 
     * @returns {boolean} True if all constants validate
     */
    function validateConstants() {
        var errors = [];

        // ---- VALID_STATUSES ----
        if (!Array.isArray(VALID_STATUSES) || VALID_STATUSES.length === 0) {
            errors.push('VALID_STATUSES must be a non-empty array.');
        }

        var statusSet = Object.create(null);
        VALID_STATUSES.forEach(function(s, index) {
            if (typeof s !== 'string' || s.trim() === '') {
                errors.push('VALID_STATUSES[' + index + '] must be a non-empty string.');
                return;
            }
            if (statusSet[s]) {
                errors.push('Duplicate status: "' + s + '".');
            }
            statusSet[s] = true;
        });

        // ---- VALID_MODES ----
        if (!Array.isArray(VALID_MODES) || VALID_MODES.length === 0) {
            errors.push('VALID_MODES must be a non-empty array.');
        }

        var modeSet = Object.create(null);
        VALID_MODES.forEach(function(m, index) {
            if (typeof m !== 'string' || m.trim() === '') {
                errors.push('VALID_MODES[' + index + '] must be a non-empty string.');
                return;
            }
            if (modeSet[m]) {
                errors.push('Duplicate mode: "' + m + '".');
            }
            modeSet[m] = true;
        });

        // ---- VALID_MATCH_TYPES ----
        if (!Array.isArray(VALID_MATCH_TYPES) || VALID_MATCH_TYPES.length === 0) {
            errors.push('VALID_MATCH_TYPES must be a non-empty array.');
        }

        var matchTypeSet = Object.create(null);
        VALID_MATCH_TYPES.forEach(function(t, index) {
            if (typeof t !== 'string' || t.trim() === '') {
                errors.push('VALID_MATCH_TYPES[' + index + '] must be a non-empty string.');
                return;
            }
            if (matchTypeSet[t]) {
                errors.push('Duplicate match type: "' + t + '".');
            }
            matchTypeSet[t] = true;
        });

        // ---- VALID_MATCH_STATUSES ----
        if (!Array.isArray(VALID_MATCH_STATUSES) || VALID_MATCH_STATUSES.length === 0) {
            errors.push('VALID_MATCH_STATUSES must be a non-empty array.');
        }

        var matchStatusSet = Object.create(null);
        VALID_MATCH_STATUSES.forEach(function(s, index) {
            if (typeof s !== 'string' || s.trim() === '') {
                errors.push('VALID_MATCH_STATUSES[' + index + '] must be a non-empty string.');
                return;
            }
            if (matchStatusSet[s]) {
                errors.push('Duplicate match status: "' + s + '".');
            }
            matchStatusSet[s] = true;
        });

        // ---- VALID_PARTICIPANT_TYPES ----
        if (!Array.isArray(VALID_PARTICIPANT_TYPES) || VALID_PARTICIPANT_TYPES.length === 0) {
            errors.push('VALID_PARTICIPANT_TYPES must be a non-empty array.');
        }

        var participantTypeSet = Object.create(null);
        VALID_PARTICIPANT_TYPES.forEach(function(t, index) {
            if (typeof t !== 'string' || t.trim() === '') {
                errors.push('VALID_PARTICIPANT_TYPES[' + index + '] must be a non-empty string.');
                return;
            }
            if (participantTypeSet[t]) {
                errors.push('Duplicate participant type: "' + t + '".');
            }
            participantTypeSet[t] = true;
        });

        // ---- VALID_GROUP_EXAM_RESULTS ----
        if (!Array.isArray(VALID_GROUP_EXAM_RESULTS) || VALID_GROUP_EXAM_RESULTS.length === 0) {
            errors.push('VALID_GROUP_EXAM_RESULTS must be a non-empty array.');
        }

        var resultSet = Object.create(null);
        VALID_GROUP_EXAM_RESULTS.forEach(function(r, index) {
            if (typeof r !== 'string' || r.trim() === '') {
                errors.push('VALID_GROUP_EXAM_RESULTS[' + index + '] must be a non-empty string.');
                return;
            }
            if (resultSet[r]) {
                errors.push('Duplicate group exam result: "' + r + '".');
            }
            resultSet[r] = true;
        });

        // ---- DEFAULTS ----
        if (typeof DEFAULT_STATUS !== 'string' || !statusSet[DEFAULT_STATUS]) {
            errors.push('DEFAULT_STATUS must be a valid status.');
        }
        if (typeof DEFAULT_MODE !== 'string' || !modeSet[DEFAULT_MODE]) {
            errors.push('DEFAULT_MODE must be a valid mode.');
        }
        if (typeof DEFAULT_MATCH_TYPE !== 'string' || !matchTypeSet[DEFAULT_MATCH_TYPE]) {
            errors.push('DEFAULT_MATCH_TYPE must be a valid match type.');
        }
        if (typeof DEFAULT_ROUND_MATCH_SIZE !== 'number' || DEFAULT_ROUND_MATCH_SIZE < 2) {
            errors.push('DEFAULT_ROUND_MATCH_SIZE must be a number >= 2.');
        }
        if (typeof DEFAULT_TOTAL_ROUNDS !== 'number' || DEFAULT_TOTAL_ROUNDS < 1) {
            errors.push('DEFAULT_TOTAL_ROUNDS must be a number >= 1.');
        }

        // ---- LIFECYCLE_RULES ----
        if (!LIFECYCLE_RULES || typeof LIFECYCLE_RULES !== 'object') {
            errors.push('LIFECYCLE_RULES must be an object.');
        } else {
            var lifecycleKeys = Object.keys(LIFECYCLE_RULES);

            // Every valid status must have a rules entry
            VALID_STATUSES.forEach(function(s) {
                if (lifecycleKeys.indexOf(s) === -1) {
                    errors.push('LIFECYCLE_RULES is missing entry for status "' + s + '".');
                }
            });

            // Every lifecycle key must be a valid status
            lifecycleKeys.forEach(function(s) {
                if (!statusSet[s]) {
                    errors.push('LIFECYCLE_RULES contains invalid status: "' + s + '".');
                    return;
                }
                var rules = LIFECYCLE_RULES[s];
                if (!rules || typeof rules !== 'object') {
                    errors.push('LIFECYCLE_RULES["' + s + '"] must be an object.');
                    return;
                }
                var requiredProps = [
                    'canEditMetadata',
                    'canModifyParticipants',
                    'canAddRounds',
                    'canRemoveRounds',
                    'canModifyEliminations',
                    'canComplete'
                ];
                for (var j = 0; j < requiredProps.length; j++) {
                    if (typeof rules[requiredProps[j]] !== 'boolean') {
                        errors.push('LIFECYCLE_RULES["' + s + '"].' + requiredProps[j] + ' must be a boolean.');
                    }
                }
                if (!rules.description || typeof rules.description !== 'string') {
                    errors.push('LIFECYCLE_RULES["' + s + '"].description is required.');
                }
            });
        }

        // ---- STATUS_TRANSITIONS ----
        if (!STATUS_TRANSITIONS || typeof STATUS_TRANSITIONS !== 'object') {
            errors.push('STATUS_TRANSITIONS must be an object.');
        } else {
            var transitionKeys = Object.keys(STATUS_TRANSITIONS);

            // Every valid status must have a transitions entry
            VALID_STATUSES.forEach(function(s) {
                if (transitionKeys.indexOf(s) === -1) {
                    errors.push('STATUS_TRANSITIONS is missing entry for status "' + s + '".');
                }
            });

            // Every transition key must be a valid status
            transitionKeys.forEach(function(s) {
                if (!statusSet[s]) {
                    errors.push('STATUS_TRANSITIONS contains invalid status: "' + s + '".');
                    return;
                }
                var targets = STATUS_TRANSITIONS[s];
                if (!Array.isArray(targets)) {
                    errors.push('STATUS_TRANSITIONS["' + s + '"] must be an array.');
                    return;
                }
                var seenTargets = Object.create(null);
                for (var j = 0; j < targets.length; j++) {
                    var target = targets[j];
                    if (!statusSet[target]) {
                        errors.push('STATUS_TRANSITIONS["' + s + '"] contains invalid target: "' + target + '".');
                        continue;
                    }
                    if (target === s) {
                        errors.push('STATUS_TRANSITIONS["' + s + '"] must not include itself as a target.');
                    }
                    if (seenTargets[target]) {
                        errors.push('STATUS_TRANSITIONS["' + s + '"] contains duplicate target: "' + target + '".');
                    }
                    seenTargets[target] = true;
                }
            });
        }

        // ---- MODE_TO_PARTICIPANT_TYPE ----
        if (!MODE_TO_PARTICIPANT_TYPE || typeof MODE_TO_PARTICIPANT_TYPE !== 'object') {
            errors.push('MODE_TO_PARTICIPANT_TYPE must be an object.');
        } else {
            var modeKeys = Object.keys(MODE_TO_PARTICIPANT_TYPE);

            // Every valid mode must have a mapping
            VALID_MODES.forEach(function(m) {
                if (modeKeys.indexOf(m) === -1) {
                    errors.push('MODE_TO_PARTICIPANT_TYPE is missing entry for mode "' + m + '".');
                }
            });

            // Every mapping key must be a valid mode, and every value
            // must be a valid participant type
            modeKeys.forEach(function(m) {
                if (!modeSet[m]) {
                    errors.push('MODE_TO_PARTICIPANT_TYPE contains invalid mode: "' + m + '".');
                    return;
                }
                var type = MODE_TO_PARTICIPANT_TYPE[m];
                if (!participantTypeSet[type]) {
                    errors.push('MODE_TO_PARTICIPANT_TYPE["' + m + '"] contains invalid type: "' + type + '".');
                }
            });
        }

        if (errors.length > 0) {
            console.warn('[TournamentConstants] Validation errors:', errors);
        }

        return errors.length === 0;
    }

    // ============================================================
    // RUN VALIDATION
    // ============================================================

    validateConstants();

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    deepFreeze(VALID_STATUSES);
    deepFreeze(VALID_MODES);
    deepFreeze(VALID_MATCH_TYPES);
    deepFreeze(VALID_MATCH_STATUSES);
    deepFreeze(VALID_PARTICIPANT_TYPES);
    deepFreeze(VALID_GROUP_EXAM_RESULTS);
    deepFreeze(LIFECYCLE_RULES);
    deepFreeze(STATUS_TRANSITIONS);
    deepFreeze(MODE_TO_PARTICIPANT_TYPE);
    deepFreeze(_statusSet);
    deepFreeze(_modeSet);
    deepFreeze(_matchTypeSet);
    deepFreeze(_matchStatusSet);
    deepFreeze(_participantTypeSet);
    deepFreeze(_groupExamResultSet);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentConstants = Object.freeze({
        // Raw definitions (read-only)
        VALID_STATUSES: VALID_STATUSES,
        VALID_MODES: VALID_MODES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,

        // Defaults
        DEFAULT_STATUS: DEFAULT_STATUS,
        DEFAULT_MODE: DEFAULT_MODE,
        DEFAULT_MATCH_TYPE: DEFAULT_MATCH_TYPE,
        DEFAULT_ROUND_MATCH_SIZE: DEFAULT_ROUND_MATCH_SIZE,
        DEFAULT_TOTAL_ROUNDS: DEFAULT_TOTAL_ROUNDS,

        // Lifecycle
        LIFECYCLE_RULES: LIFECYCLE_RULES,
        STATUS_TRANSITIONS: STATUS_TRANSITIONS,

        // Mode mapping
        MODE_TO_PARTICIPANT_TYPE: MODE_TO_PARTICIPANT_TYPE,

        // Bounds (computed from CalendarConstants at runtime)
        // Years are unbounded — no MIN_YEAR / MAX_YEAR.
        get MIN_WEEK() { return getComputedBounds().MIN_WEEK; },
        get MAX_WEEK() { return getComputedBounds().MAX_WEEK; },

        // Lookup functions
        isValidStatus: isValidStatus,
        isValidMode: isValidMode,
        isValidMatchType: isValidMatchType,
        isValidMatchStatus: isValidMatchStatus,
        isValidParticipantType: isValidParticipantType,
        isValidGroupExamResult: isValidGroupExamResult,

        getCanonicalParticipantType: getCanonicalParticipantType,
        isParticipantTypeCanonical: isParticipantTypeCanonical,

        getLifecycleRules: getLifecycleRules,

        isStatusTransitionAllowed: isStatusTransitionAllowed,
        getAllowedTransitions: getAllowedTransitions,

        // Re-check dependencies
        checkDependencies: checkDependencies,
        validateConstants: validateConstants
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentConstants;
        var missing = [];

        // Check computed properties
        try {
            var week = exports.MIN_WEEK;
            if (typeof week !== 'number') {
                missing.push('MIN_WEEK (computed)');
            }
        } catch (e) {
            missing.push('MIN_WEEK (computed property error)');
        }

        // Check functions
        var required = [
            'isValidStatus', 'isValidMode', 'isValidMatchType',
            'isValidMatchStatus', 'isValidParticipantType', 'isValidGroupExamResult',
            'getCanonicalParticipantType', 'isParticipantTypeCanonical',
            'getLifecycleRules', 'isStatusTransitionAllowed', 'getAllowedTransitions'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Check constants
        var constants = [
            'VALID_STATUSES', 'VALID_MODES', 'VALID_MATCH_TYPES',
            'VALID_MATCH_STATUSES', 'VALID_PARTICIPANT_TYPES', 'VALID_GROUP_EXAM_RESULTS',
            'LIFECYCLE_RULES', 'STATUS_TRANSITIONS', 'MODE_TO_PARTICIPANT_TYPE'
        ];

        for (var i = 0; i < constants.length; i++) {
            if (exports[constants[i]] === undefined) {
                missing.push(constants[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentConstants] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentConstants] All exports verified successfully.');
            console.log('[TournamentConstants] Bounds:', {
                MIN_WEEK: exports.MIN_WEEK,
                MAX_WEEK: exports.MAX_WEEK
            });
        }
    })();

})();