/**
 * js/modules/shared/mission-constants.js - Mission Constants
 *
 * Path: js/modules/missions/mission-constants.js
 *
 * Single source of truth for mission vocabulary and canonical
 * defaults. Every enum, label map, and creation default that the
 * mission domain uses lives here.
 *
 * WHAT THIS MODULE OWNS:
 *   - Valid statuses, priorities, difficulties, billing types,
 *     escalation tiers.
 *   - The mission type taxonomy (categories + subtypes).
 *   - Human-facing labels for every enum value.
 *   - The difficulty → code mapping used by the mission ID label.
 *   - Creation defaults (what a mission looks like when a field is
 *     not supplied).
 *   - The canonical difficulty vocabulary (easy / medium / hard /
 *     expert). "extreme" is NOT a valid difficulty. If a caller ever
 *     supplies it, it is rejected, not silently coerced.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - Validate missions (MissionSchema).
 *   - Enforce domain rules (MissionRules).
 *   - Read or write data.
 *   - Format anything for display (MissionViews owns presentation
 *     formatting like "Tier III - Dangerous"; this module owns the
 *     raw label strings only because they are canonical domain
 *     vocabulary, not computed presentation).
 *   - Know about storage, ID generation, or the pipeline.
 *
 * DESIGN NOTES:
 *   - Every enum is a frozen array. Every label map is a frozen
 *     object. Callers cannot mutate the shared collections.
 *   - Getter functions return fresh copies of the collections so
 *     callers can sort, filter, or extend a copy without touching
 *     the canonical collections.
 *   - The mission type taxonomy is structured:
 *       {
 *         id, label, description,
 *         subtypes: [{ id, label }, ...]
 *       }
 *     The subtypes were previously a flat array of IDs with a
 *     separate SUBTYPE_LABELS map. That map has been folded into
 *     the taxonomy so a subtype's label lives with the subtype.
 *
 * YEAR SEMANTICS:
 *   Years are UNBOUNDED positive integers. There is no MIN_YEAR or
 *   MAX_YEAR. Any integer >= 1 is a valid year. Validation lives in
 *   MissionId.isValidYear.
 *
 * DEPENDENCIES:
 *   None.
 */

(function() {
    'use strict';

    if (window.__missionConstantsLoaded) {
        return;
    }
    window.__missionConstantsLoaded = true;

    // ============================================================
    // STATUS
    // ============================================================

    var VALID_STATUSES = Object.freeze([
        'active',
        'completed',
        'cancelled'
    ]);

    var STATUS_LABELS = Object.freeze({
        'active':    'Active',
        'completed': 'Completed',
        'cancelled': 'Cancelled'
    });

    // ============================================================
    // PRIORITY
    // ============================================================

    var VALID_PRIORITIES = Object.freeze([
        'low',
        'medium',
        'high',
        'critical'
    ]);

    var PRIORITY_LABELS = Object.freeze({
        'low':      'Low',
        'medium':   'Medium',
        'high':     'High',
        'critical': 'Critical'
    });

    // ============================================================
    // DIFFICULTY
    // ============================================================
    //
    // The canonical difficulty vocabulary is:
    //
    //   easy | medium | hard | expert
    //
    // "extreme" is NOT part of this vocabulary. If it appears in
    // legacy data or caller input, it is rejected by Schema, not
    // silently mapped to "expert".
    //
    // Each difficulty has a single-letter code used by the mission
    // ID label (MissionId). The mapping is one-way: code → name is
    // also provided for parsing.

    var VALID_DIFFICULTIES = Object.freeze([
        'easy',
        'medium',
        'hard',
        'expert'
    ]);

    var DIFFICULTY_LABELS = Object.freeze({
        'easy':   'Easy',
        'medium': 'Medium',
        'hard':   'Hard',
        'expert': 'Expert'
    });

    var DIFFICULTY_CODES = Object.freeze({
        'easy':   'E',
        'medium': 'M',
        'hard':   'H',
        'expert': 'X'
    });

    var DIFFICULTY_FROM_CODE = Object.freeze({
        'E': 'easy',
        'M': 'medium',
        'H': 'hard',
        'X': 'expert'
    });

    // ============================================================
    // BILLING
    // ============================================================

    var VALID_BILLING_TYPES = Object.freeze([
        'original',
        'escalated',
        'emergency',
        'internal'
    ]);

    var BILLING_LABELS = Object.freeze({
        'original':  'Original Contract',
        'escalated': 'Escalated / Surcharge',
        'emergency': 'Emergency Intervention',
        'internal':  'Internal / Research'
    });

    // ============================================================
    // ESCALATION
    // ============================================================

    var VALID_ESCALATION_TIERS = Object.freeze([
        'tier_i',
        'tier_ii',
        'tier_iii',
        'tier_iv',
        'tier_v'
    ]);

    var ESCALATION_LABELS = Object.freeze({
        'tier_i':   'Tier I - Routine',
        'tier_ii':  'Tier II - Complicated',
        'tier_iii': 'Tier III - Dangerous',
        'tier_iv':  'Tier IV - Critical',
        'tier_v':   'Tier V - Catastrophic'
    });

    // ============================================================
    // MISSION TYPE TAXONOMY
    // ============================================================
    //
    // Each type carries its own subtype list. A subtype's label
    // lives next to the subtype, so adding a subtype is a one-line
    // change in one place.
    //
    // The taxonomy is deeply frozen: no caller can add a subtype at
    // runtime. If a new subtype is needed, it is added here and the
    // change is versioned with the module.

    var MISSION_TYPES = Object.freeze({
        'combat': Object.freeze({
            id: 'combat',
            label: 'Combat',
            description: 'Direct combat operations, elimination, defence, protection',
            subtypes: Object.freeze([
                Object.freeze({ id: 'elimination', label: 'Elimination' }),
                Object.freeze({ id: 'defence',     label: 'Defence' }),
                Object.freeze({ id: 'protection',  label: 'Protection' })
            ])
        }),

        'recovery': Object.freeze({
            id: 'recovery',
            label: 'Recovery',
            description: 'Retrieval of people, materials, or artifacts',
            subtypes: Object.freeze([
                Object.freeze({ id: 'retrieval',         label: 'Retrieval' }),
                Object.freeze({ id: 'rescue',            label: 'Rescue' }),
                Object.freeze({ id: 'material_recovery', label: 'Material Recovery' }),
                Object.freeze({ id: 'artifact_recovery', label: 'Artifact Recovery' })
            ])
        }),

        'investigation': Object.freeze({
            id: 'investigation',
            label: 'Investigation',
            description: 'Investigations, reconnaissance, surveillance',
            subtypes: Object.freeze([
                Object.freeze({ id: 'investigation',   label: 'Investigation' }),
                Object.freeze({ id: 'reconnaissance',  label: 'Reconnaissance' }),
                Object.freeze({ id: 'surveillance',    label: 'Surveillance' })
            ])
        }),

        'exploration': Object.freeze({
            id: 'exploration',
            label: 'Exploration',
            description: 'Exploration, surveys, expeditions',
            subtypes: Object.freeze([
                Object.freeze({ id: 'exploration', label: 'Exploration' }),
                Object.freeze({ id: 'survey',      label: 'Survey' }),
                Object.freeze({ id: 'expedition',  label: 'Expedition' })
            ])
        }),

        'infiltration': Object.freeze({
            id: 'infiltration',
            label: 'Infiltration',
            description: 'Stealth entry, social infiltration, espionage',
            subtypes: Object.freeze([
                Object.freeze({ id: 'stealth_entry',       label: 'Stealth Entry' }),
                Object.freeze({ id: 'social_infiltration', label: 'Social Infiltration' }),
                Object.freeze({ id: 'theft_recovery',      label: 'Theft / Recovery' }),
                Object.freeze({ id: 'espionage',           label: 'Espionage' })
            ])
        }),

        'containment': Object.freeze({
            id: 'containment',
            label: 'Containment',
            description: 'Capture, magical containment, quarantine',
            subtypes: Object.freeze([
                Object.freeze({ id: 'capture',             label: 'Capture' }),
                Object.freeze({ id: 'magical_containment', label: 'Magical Containment' }),
                Object.freeze({ id: 'quarantine',          label: 'Quarantine' })
            ])
        }),

        'acquisition': Object.freeze({
            id: 'acquisition',
            label: 'Acquisition',
            description: 'Gathering ingredients, resources, or specimens',
            subtypes: Object.freeze([
                Object.freeze({ id: 'ingredients', label: 'Ingredients' }),
                Object.freeze({ id: 'resources',   label: 'Resources' }),
                Object.freeze({ id: 'specimens',   label: 'Specimens' })
            ])
        }),

        'research': Object.freeze({
            id: 'research',
            label: 'Research',
            description: 'Observation, field research, field testing',
            subtypes: Object.freeze([
                Object.freeze({ id: 'observation',    label: 'Observation' }),
                Object.freeze({ id: 'field_research', label: 'Field Research' }),
                Object.freeze({ id: 'field_testing',  label: 'Field Testing' })
            ])
        }),

        'diplomatic': Object.freeze({
            id: 'diplomatic',
            label: 'Diplomatic',
            description: 'Negotiation, mediation, representation',
            subtypes: Object.freeze([
                Object.freeze({ id: 'negotiation',    label: 'Negotiation' }),
                Object.freeze({ id: 'mediation',      label: 'Mediation' }),
                Object.freeze({ id: 'representation', label: 'Representation' })
            ])
        }),

        'assassination': Object.freeze({
            id: 'assassination',
            label: 'Assassination',
            description: 'Targeted elimination',
            subtypes: Object.freeze([
                Object.freeze({ id: 'targeted_elimination', label: 'Targeted Elimination' })
            ])
        })
    });

    // ============================================================
    // CREATION DEFAULTS
    // ============================================================
    //
    // These are the values MissionCore uses when a mission is
    // created without an explicit value for the field. They are
    // NOT schema defaults: nothing fills them into a persisted
    // record outside of a create operation. Reading a mission that
    // lacks a field does not apply these.

    var DEFAULT_STATUS = 'active';
    var DEFAULT_PRIORITY = 'medium';
    var DEFAULT_DIFFICULTY = 'medium';
    var DEFAULT_BILLING = 'original';
    var DEFAULT_ESCALATION = 'tier_ii';

    // ============================================================
    // ID LABEL FORMAT
    // ============================================================
    //
    // The human-facing mission label format is:
    //
    //   YEAR-SEQ-DIFFICULTY
    //
    // For example: 2026-005-E, 2026-012-M, 25000-003-X.
    //
    // YEAR is unbounded. It is formatted with a minimum width of
    // four digits; longer years are printed in full (a year of 25000
    // renders as "25000", not "5000").
    //
    // SEQ is the mission's sequence number within (year, difficulty).
    // It is formatted with a minimum width of three digits; longer
    // sequences are printed in full.
    //
    // DIFFICULTY is the single-letter code from DIFFICULTY_CODES.

    var LABEL_YEAR_MIN_WIDTH = 4;
    var LABEL_SEQUENCE_MIN_WIDTH = 3;
    var LABEL_SEPARATOR = '-';

    // ============================================================
    // LOOKUP HELPERS - Pure, no side effects
    // ============================================================
    //
    // These are the only functions this module exposes. They do NOT
    // perform validation of any kind; that is Schema's job. They
    // return null for unknown input, never a fabricated default.

    function isValidStatus(value) {
        return VALID_STATUSES.indexOf(value) !== -1;
    }

    function isValidPriority(value) {
        return VALID_PRIORITIES.indexOf(value) !== -1;
    }

    function isValidDifficulty(value) {
        return VALID_DIFFICULTIES.indexOf(value) !== -1;
    }

    function isValidBilling(value) {
        return VALID_BILLING_TYPES.indexOf(value) !== -1;
    }

    function isValidEscalation(value) {
        return VALID_ESCALATION_TIERS.indexOf(value) !== -1;
    }

    function isValidMissionType(typeId) {
        return Object.prototype.hasOwnProperty.call(MISSION_TYPES, typeId);
    }

    function isValidSubtype(typeId, subtypeId) {
        if (!isValidMissionType(typeId)) { return false; }
        var type = MISSION_TYPES[typeId];
        for (var i = 0; i < type.subtypes.length; i++) {
            if (type.subtypes[i].id === subtypeId) {
                return true;
            }
        }
        return false;
    }

    function getDifficultyCode(difficulty) {
        if (!isValidDifficulty(difficulty)) {
            return null;
        }
        return DIFFICULTY_CODES[difficulty];
    }

    function getDifficultyFromCode(code) {
        if (typeof code !== 'string' || code.length !== 1) {
            return null;
        }
        return DIFFICULTY_FROM_CODE[code] || null;
    }

    function getStatusLabel(status) {
        if (!isValidStatus(status)) {
            return null;
        }
        return STATUS_LABELS[status];
    }

    function getPriorityLabel(priority) {
        if (!isValidPriority(priority)) {
            return null;
        }
        return PRIORITY_LABELS[priority];
    }

    function getDifficultyLabel(difficulty) {
        if (!isValidDifficulty(difficulty)) {
            return null;
        }
        return DIFFICULTY_LABELS[difficulty];
    }

    function getBillingLabel(billing) {
        if (!isValidBilling(billing)) {
            return null;
        }
        return BILLING_LABELS[billing];
    }

    function getEscalationLabel(tier) {
        if (!isValidEscalation(tier)) {
            return null;
        }
        return ESCALATION_LABELS[tier];
    }

    function getMissionType(typeId) {
        if (!isValidMissionType(typeId)) {
            return null;
        }
        // Return a defensive copy so a caller cannot mutate the
        // frozen taxonomy by holding the returned object.
        var type = MISSION_TYPES[typeId];
        var subtypes = [];
        for (var i = 0; i < type.subtypes.length; i++) {
            subtypes.push({
                id: type.subtypes[i].id,
                label: type.subtypes[i].label
            });
        }
        return {
            id: type.id,
            label: type.label,
            description: type.description,
            subtypes: subtypes
        };
    }

    function getMissionTypeLabel(typeId) {
        if (!isValidMissionType(typeId)) {
            return null;
        }
        return MISSION_TYPES[typeId].label;
    }

    function getSubtypeLabel(typeId, subtypeId) {
        if (!isValidSubtype(typeId, subtypeId)) {
            return null;
        }
        var type = MISSION_TYPES[typeId];
        for (var i = 0; i < type.subtypes.length; i++) {
            if (type.subtypes[i].id === subtypeId) {
                return type.subtypes[i].label;
            }
        }
        return null;
    }

    // ============================================================
    // DEFENSIVE GETTERS - Return fresh arrays/objects
    // ============================================================

    function getValidStatuses() {
        return VALID_STATUSES.slice();
    }

    function getValidPriorities() {
        return VALID_PRIORITIES.slice();
    }

    function getValidDifficulties() {
        return VALID_DIFFICULTIES.slice();
    }

    function getValidBillingTypes() {
        return VALID_BILLING_TYPES.slice();
    }

    function getValidEscalationTiers() {
        return VALID_ESCALATION_TIERS.slice();
    }

    function getMissionTypes() {
        var result = {};
        var keys = Object.keys(MISSION_TYPES);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = getMissionType(keys[i]);
        }
        return result;
    }

    function getSubtypesForType(typeId) {
        var type = getMissionType(typeId);
        return type ? type.subtypes : [];
    }

    function getDefaults() {
        return {
            status: DEFAULT_STATUS,
            priority: DEFAULT_PRIORITY,
            difficulty: DEFAULT_DIFFICULTY,
            billing: DEFAULT_BILLING,
            escalation: DEFAULT_ESCALATION
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionConstants = Object.freeze({
        // Enum arrays (frozen, read-only references)
        VALID_STATUSES: VALID_STATUSES,
        VALID_PRIORITIES: VALID_PRIORITIES,
        VALID_DIFFICULTIES: VALID_DIFFICULTIES,
        VALID_BILLING_TYPES: VALID_BILLING_TYPES,
        VALID_ESCALATION_TIERS: VALID_ESCALATION_TIERS,

        // Label maps (frozen, read-only references)
        STATUS_LABELS: STATUS_LABELS,
        PRIORITY_LABELS: PRIORITY_LABELS,
        DIFFICULTY_LABELS: DIFFICULTY_LABELS,
        DIFFICULTY_CODES: DIFFICULTY_CODES,
        DIFFICULTY_FROM_CODE: DIFFICULTY_FROM_CODE,
        BILLING_LABELS: BILLING_LABELS,
        ESCALATION_LABELS: ESCALATION_LABELS,

        // Taxonomy (frozen, read-only reference)
        MISSION_TYPES: MISSION_TYPES,

        // Creation defaults
        DEFAULT_STATUS: DEFAULT_STATUS,
        DEFAULT_PRIORITY: DEFAULT_PRIORITY,
        DEFAULT_DIFFICULTY: DEFAULT_DIFFICULTY,
        DEFAULT_BILLING: DEFAULT_BILLING,
        DEFAULT_ESCALATION: DEFAULT_ESCALATION,

        // Label format configuration
        LABEL_YEAR_MIN_WIDTH: LABEL_YEAR_MIN_WIDTH,
        LABEL_SEQUENCE_MIN_WIDTH: LABEL_SEQUENCE_MIN_WIDTH,
        LABEL_SEPARATOR: LABEL_SEPARATOR,

        // Validation helpers
        isValidStatus: isValidStatus,
        isValidPriority: isValidPriority,
        isValidDifficulty: isValidDifficulty,
        isValidBilling: isValidBilling,
        isValidEscalation: isValidEscalation,
        isValidMissionType: isValidMissionType,
        isValidSubtype: isValidSubtype,

        // Lookup helpers (return null for unknown, never a default)
        getDifficultyCode: getDifficultyCode,
        getDifficultyFromCode: getDifficultyFromCode,
        getStatusLabel: getStatusLabel,
        getPriorityLabel: getPriorityLabel,
        getDifficultyLabel: getDifficultyLabel,
        getBillingLabel: getBillingLabel,
        getEscalationLabel: getEscalationLabel,
        getMissionType: getMissionType,
        getMissionTypeLabel: getMissionTypeLabel,
        getSubtypeLabel: getSubtypeLabel,

        // Defensive getters (return fresh copies)
        getValidStatuses: getValidStatuses,
        getValidPriorities: getValidPriorities,
        getValidDifficulties: getValidDifficulties,
        getValidBillingTypes: getValidBillingTypes,
        getValidEscalationTiers: getValidEscalationTiers,
        getMissionTypes: getMissionTypes,
        getSubtypesForType: getSubtypesForType,
        getDefaults: getDefaults
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionConstants;
        var missing = [];

        var requiredArrays = [
            'VALID_STATUSES',
            'VALID_PRIORITIES',
            'VALID_DIFFICULTIES',
            'VALID_BILLING_TYPES',
            'VALID_ESCALATION_TIERS'
        ];
        for (var i = 0; i < requiredArrays.length; i++) {
            if (!Array.isArray(exports[requiredArrays[i]]) ||
                exports[requiredArrays[i]].length === 0) {
                missing.push(requiredArrays[i]);
            }
        }

        var requiredFunctions = [
            'isValidStatus',
            'isValidPriority',
            'isValidDifficulty',
            'isValidBilling',
            'isValidEscalation',
            'isValidMissionType',
            'isValidSubtype',
            'getDifficultyCode',
            'getDifficultyFromCode',
            'getStatusLabel',
            'getPriorityLabel',
            'getDifficultyLabel',
            'getBillingLabel',
            'getEscalationLabel',
            'getMissionType',
            'getMissionTypeLabel',
            'getSubtypeLabel',
            'getValidStatuses',
            'getValidPriorities',
            'getValidDifficulties',
            'getValidBillingTypes',
            'getValidEscalationTiers',
            'getMissionTypes',
            'getSubtypesForType',
            'getDefaults'
        ];
        for (var j = 0; j < requiredFunctions.length; j++) {
            if (typeof exports[requiredFunctions[j]] !== 'function') {
                missing.push(requiredFunctions[j]);
            }
        }

        // Confirm every difficulty has a code, and every code has a
        // difficulty. A mismatch here would silently corrupt the
        // mission ID grammar.
        for (var d = 0; d < VALID_DIFFICULTIES.length; d++) {
            var diff = VALID_DIFFICULTIES[d];
            var code = DIFFICULTY_CODES[diff];
            if (!code) {
                missing.push('DIFFICULTY_CODES[' + diff + ']');
                continue;
            }
            if (DIFFICULTY_FROM_CODE[code] !== diff) {
                missing.push(
                    'DIFFICULTY_FROM_CODE[' + code + '] ' +
                    'does not round-trip to ' + diff
                );
            }
        }

        // Confirm every status has a label.
        for (var s = 0; s < VALID_STATUSES.length; s++) {
            if (!STATUS_LABELS[VALID_STATUSES[s]]) {
                missing.push('STATUS_LABELS[' + VALID_STATUSES[s] + ']');
            }
        }

        // Confirm every priority has a label.
        for (var p = 0; p < VALID_PRIORITIES.length; p++) {
            if (!PRIORITY_LABELS[VALID_PRIORITIES[p]]) {
                missing.push('PRIORITY_LABELS[' + VALID_PRIORITIES[p] + ']');
            }
        }

        // Confirm every billing type has a label.
        for (var b = 0; b < VALID_BILLING_TYPES.length; b++) {
            if (!BILLING_LABELS[VALID_BILLING_TYPES[b]]) {
                missing.push('BILLING_LABELS[' + VALID_BILLING_TYPES[b] + ']');
            }
        }

        // Confirm every escalation tier has a label.
        for (var e = 0; e < VALID_ESCALATION_TIERS.length; e++) {
            if (!ESCALATION_LABELS[VALID_ESCALATION_TIERS[e]]) {
                missing.push(
                    'ESCALATION_LABELS[' + VALID_ESCALATION_TIERS[e] + ']'
                );
            }
        }

        // Confirm every mission type has an id, label, description,
        // and at least one subtype, and every subtype has an id and
        // label.
        var typeKeys = Object.keys(MISSION_TYPES);
        for (var t = 0; t < typeKeys.length; t++) {
            var typeKey = typeKeys[t];
            var type = MISSION_TYPES[typeKey];
            if (type.id !== typeKey) {
                missing.push('MISSION_TYPES[' + typeKey + '].id mismatch');
            }
            if (typeof type.label !== 'string' || type.label === '') {
                missing.push('MISSION_TYPES[' + typeKey + '].label');
            }
            if (typeof type.description !== 'string') {
                missing.push('MISSION_TYPES[' + typeKey + '].description');
            }
            if (!Array.isArray(type.subtypes) || type.subtypes.length === 0) {
                missing.push('MISSION_TYPES[' + typeKey + '].subtypes');
                continue;
            }
            for (var st = 0; st < type.subtypes.length; st++) {
                var subtype = type.subtypes[st];
                if (typeof subtype.id !== 'string' || subtype.id === '') {
                    missing.push(
                        'MISSION_TYPES[' + typeKey +
                        '].subtypes[' + st + '].id'
                    );
                }
                if (typeof subtype.label !== 'string' || subtype.label === '') {
                    missing.push(
                        'MISSION_TYPES[' + typeKey +
                        '].subtypes[' + st + '].label'
                    );
                }
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionConstants] Verification failed - ' +
                'some constants may be missing or malformed:',
                missing.join(', ')
            );
        }
    })();

})();
