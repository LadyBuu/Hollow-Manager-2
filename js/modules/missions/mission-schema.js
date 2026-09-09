/**
 * js/modules/missions/missions-schema.js - Mission Schema
 * SINGLE SOURCE OF TRUTH for all mission validation rules and constants.
 * 
 * SCHEMA PHILOSOPHY:
 *   - One constitution for all mission data
 *   - Used by Core, Queries, and UI
 *   - All validation rules are centralised here
 *   - PURE: no side effects, no mutation
 *   - CRASH-SAFE: never throws on malformed input; returns errors
 *   - Validates STRUCTURE and CONTENTS, not just container types
 *   - canonicaliseMissionShape() transforms structurally valid input
 *   - Does NOT derive business state (progress, pay, completedAt) - that belongs in MissionRules
 *   - Does NOT handle calendar validation - use CalendarValidation
 *   - Does NOT handle ID normalisation - use IdUtils
 * 
 * MISSION TYPE TAXONOMY:
 *   1. Combat - Elimination, Defence, Protection
 *   2. Recovery - Retrieval, Rescue, Recovery of materials/artifacts
 *   3. Investigation - Investigation, Reconnaissance, Surveillance
 *   4. Exploration - Exploration, Survey, Expedition
 *   5. Infiltration - Stealth entry, Social infiltration, Theft/recovery, Espionage
 *   6. Containment - Capture, Magical containment, Quarantine
 *   7. Acquisition - Ingredients, Resources, Specimens
 *   8. Research - Observation, Field research, Field testing
 *   9. Diplomatic - Negotiation, Mediation, Representation
 *   10. Assassination
 * 
 * DIFFICULTY CODES:
 *   E = Easy, M = Medium, H = Hard, X = Expert
 * 
 * DERIVED FIELDS (validated but not calculated by schema):
 *   - progress: MUST match calculateProgress(objectives) (validation only)
 *   - pay: MUST match calculatePay(basePay, surchargePay) (validation only)
 *   - completedAt: MUST be consistent with status (validation only)
 * 
 * CANONICALISATION:
 *   - canonicaliseMissionShape() only transforms structurally valid input
 *   - Invalid nested records are rejected (not silently discarded)
 *   - Unknown fields are stripped (schema is authoritative)
 *   - Returns { valid, errors, value } with detailed error reporting
 *   - Does NOT derive progress, pay, or completedAt
 */

(function() {
    'use strict';

    if (window.__missionsSchemaLoaded) return;
    window.__missionsSchemaLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.CalendarValidation) {
        missing.push('CalendarValidation');
    }

    if (!window.IdUtils || typeof window.IdUtils.normaliseId !== 'function') {
        missing.push('IdUtils.normaliseId');
    }

    if (missing.length > 0) {
        throw new Error('[MissionsSchema] Missing dependencies: ' + missing.join(', '));
    }

    var CalendarValidation = window.CalendarValidation;
    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS - DEEP FROZEN
    // ============================================================

    var SCHEMA_VERSION = 1;

    var VALID_STATUSES = Object.freeze(['active', 'completed', 'cancelled']);
    var VALID_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
    var VALID_DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'expert']);
    var VALID_BILLING_TYPES = Object.freeze(['original', 'escalated', 'emergency', 'internal']);
    var VALID_ESCALATION_TIERS = Object.freeze(['tier_i', 'tier_ii', 'tier_iii', 'tier_iv', 'tier_v']);

    var DIFFICULTY_CODES = Object.freeze({
        'easy': 'E',
        'medium': 'M',
        'hard': 'H',
        'expert': 'X'
    });

    // ============================================================
    // MISSION TYPE TAXONOMY - DEEP FROZEN
    // ============================================================

    var MISSION_TYPES = Object.freeze({
        'combat': Object.freeze({
            id: 'combat',
            label: 'Combat',
            description: 'Direct combat operations, elimination, defence, protection',
            subtypes: Object.freeze(['elimination', 'defence', 'protection'])
        }),
        'recovery': Object.freeze({
            id: 'recovery',
            label: 'Recovery',
            description: 'Retrieval of people, materials, or artifacts',
            subtypes: Object.freeze(['retrieval', 'rescue', 'material_recovery', 'artifact_recovery'])
        }),
        'investigation': Object.freeze({
            id: 'investigation',
            label: 'Investigation',
            description: 'Investigations, reconnaissance, surveillance',
            subtypes: Object.freeze(['investigation', 'reconnaissance', 'surveillance'])
        }),
        'exploration': Object.freeze({
            id: 'exploration',
            label: 'Exploration',
            description: 'Exploration, surveys, expeditions',
            subtypes: Object.freeze(['exploration', 'survey', 'expedition'])
        }),
        'infiltration': Object.freeze({
            id: 'infiltration',
            label: 'Infiltration',
            description: 'Stealth entry, social infiltration, espionage',
            subtypes: Object.freeze(['stealth_entry', 'social_infiltration', 'theft_recovery', 'espionage'])
        }),
        'containment': Object.freeze({
            id: 'containment',
            label: 'Containment',
            description: 'Capture, magical containment, quarantine',
            subtypes: Object.freeze(['capture', 'magical_containment', 'quarantine'])
        }),
        'acquisition': Object.freeze({
            id: 'acquisition',
            label: 'Acquisition',
            description: 'Gathering ingredients, resources, or specimens',
            subtypes: Object.freeze(['ingredients', 'resources', 'specimens'])
        }),
        'research': Object.freeze({
            id: 'research',
            label: 'Research',
            description: 'Observation, field research, field testing',
            subtypes: Object.freeze(['observation', 'field_research', 'field_testing'])
        }),
        'diplomatic': Object.freeze({
            id: 'diplomatic',
            label: 'Diplomatic',
            description: 'Negotiation, mediation, representation',
            subtypes: Object.freeze(['negotiation', 'mediation', 'representation'])
        }),
        'assassination': Object.freeze({
            id: 'assassination',
            label: 'Assassination',
            description: 'Targeted elimination',
            subtypes: Object.freeze(['targeted_elimination'])
        })
    });

    // ============================================================
    // SUBTYPE LABELS - DEEP FROZEN
    // ============================================================

    var SUBTYPE_LABELS = Object.freeze({
        'elimination': 'Elimination',
        'defence': 'Defence',
        'protection': 'Protection',
        'retrieval': 'Retrieval',
        'rescue': 'Rescue',
        'material_recovery': 'Material Recovery',
        'artifact_recovery': 'Artifact Recovery',
        'investigation': 'Investigation',
        'reconnaissance': 'Reconnaissance',
        'surveillance': 'Surveillance',
        'exploration': 'Exploration',
        'survey': 'Survey',
        'expedition': 'Expedition',
        'stealth_entry': 'Stealth Entry',
        'social_infiltration': 'Social Infiltration',
        'theft_recovery': 'Theft / Recovery',
        'espionage': 'Espionage',
        'capture': 'Capture',
        'magical_containment': 'Magical Containment',
        'quarantine': 'Quarantine',
        'ingredients': 'Ingredients',
        'resources': 'Resources',
        'specimens': 'Specimens',
        'observation': 'Observation',
        'field_research': 'Field Research',
        'field_testing': 'Field Testing',
        'negotiation': 'Negotiation',
        'mediation': 'Mediation',
        'representation': 'Representation',
        'targeted_elimination': 'Targeted Elimination'
    });

    // ============================================================
    // ESCALATION LABELS - DEEP FROZEN
    // ============================================================

    var ESCALATION_LABELS = Object.freeze({
        'tier_i': 'Tier I - Routine',
        'tier_ii': 'Tier II - Complicated',
        'tier_iii': 'Tier III - Dangerous',
        'tier_iv': 'Tier IV - Critical',
        'tier_v': 'Tier V - Catastrophic'
    });

    // ============================================================
    // BILLING LABELS - DEEP FROZEN
    // ============================================================

    var BILLING_LABELS = Object.freeze({
        'original': 'Original Contract',
        'escalated': 'Escalated / Surcharge',
        'emergency': 'Emergency Intervention',
        'internal': 'Internal / Research'
    });

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isString(value) {
        return typeof value === 'string';
    }

    function isBoolean(value) {
        return typeof value === 'boolean';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    // ============================================================
    // VALID PREDICATES - Return proper booleans
    // ============================================================

    function isValidStatus(status) {
        return typeof status === 'string' && VALID_STATUSES.indexOf(status) !== -1;
    }

    function isValidPriority(priority) {
        return typeof priority === 'string' && VALID_PRIORITIES.indexOf(priority) !== -1;
    }

    function isValidDifficulty(difficulty) {
        return typeof difficulty === 'string' && VALID_DIFFICULTIES.indexOf(difficulty) !== -1;
    }

    function isValidBilling(billing) {
        return typeof billing === 'string' && VALID_BILLING_TYPES.indexOf(billing) !== -1;
    }

    function isValidEscalation(escalation) {
        return typeof escalation === 'string' && VALID_ESCALATION_TIERS.indexOf(escalation) !== -1;
    }

    function isValidMissionType(type) {
        return typeof type === 'string' && MISSION_TYPES[type] !== undefined;
    }

    function isValidSubtype(typeId, subtype) {
        if (typeof typeId !== 'string' || typeof subtype !== 'string') {
            return false;
        }
        var type = MISSION_TYPES[typeId];
        if (!type) {
            return false;
        }
        return type.subtypes.indexOf(subtype) !== -1;
    }

    // ============================================================
    // MISSION TYPE HELPERS
    // ============================================================

    function getMissionType(typeId) {
        return MISSION_TYPES[typeId] || null;
    }

    function getMissionTypeLabel(typeId) {
        var type = getMissionType(typeId);
        return type ? type.label : typeId || 'Unclassified';
    }

    function getSubtypeLabel(subtypeId) {
        return SUBTYPE_LABELS[subtypeId] || subtypeId || '';
    }

    function getEscalationLabel(escalation) {
        return ESCALATION_LABELS[escalation] || escalation || 'Tier II - Complicated';
    }

    function getBillingLabel(billing) {
        return BILLING_LABELS[billing] || billing || 'Original Contract';
    }

    function getDifficultyCode(difficulty) {
        return DIFFICULTY_CODES[difficulty] || 'M';
    }

    // ============================================================
    // DEEP VALIDATION - Returns errors, does not mutate
    // ============================================================

    function validateObjective(objective, index, errors) {
        if (!isObject(objective)) {
            errors.push('Objective ' + (index + 1) + ' must be an object.');
            return;
        }

        if (!isNonEmptyString(objective.text)) {
            errors.push('Objective ' + (index + 1) + ' requires non-empty text.');
        }

        if (objective.done !== undefined && !isBoolean(objective.done)) {
            errors.push('Objective ' + (index + 1) + ' done status must be boolean.');
        }
    }

    function validateLogEntry(entry, index, errors) {
        if (!isObject(entry)) {
            errors.push('Log entry ' + (index + 1) + ' must be an object.');
            return;
        }

        if (entry.timestamp !== undefined && typeof entry.timestamp !== 'string') {
            errors.push('Log entry ' + (index + 1) + ' timestamp must be a string.');
        }

        if (!isNonEmptyString(entry.message)) {
            errors.push('Log entry ' + (index + 1) + ' requires non-empty message.');
        }
    }

    function validateTag(tag, index, errors) {
        if (!isString(tag)) {
            errors.push('Tag ' + (index + 1) + ' must be a string.');
            return;
        }
        if (tag.trim() === '') {
            errors.push('Tag ' + (index + 1) + ' cannot be empty.');
        }
    }

    function validateSupportPersonnel(id, index, errors) {
        var normalised = IdUtils.normaliseId(id);
        if (normalised === null) {
            errors.push('Support personnel ' + (index + 1) + ' has invalid ID.');
        }
    }

    // ============================================================
    // MISSION VALIDATION
    // ============================================================

    function validateMission(mission) {
        var errors = [];

        if (!mission || typeof mission !== 'object') {
            return { valid: false, errors: ['Mission must be an object.'] };
        }

        // ---- TITLE ----
        if (!isNonEmptyString(mission.title)) {
            errors.push('Mission title is required.');
        }

        // ---- PRIMARY TYPE ----
        if (mission.primaryType && !isValidMissionType(mission.primaryType)) {
            errors.push('Invalid primary type: "' + mission.primaryType + '"');
        }

        // ---- SUBTYPE ----
        if (mission.subtype) {
            if (!mission.primaryType) {
                errors.push('Subtype requires a primary type.');
            } else if (!isValidSubtype(mission.primaryType, mission.subtype)) {
                errors.push('Invalid subtype "' + mission.subtype + '" for primary type "' + mission.primaryType + '".');
            }
        }

        // ---- SECONDARY TYPE ----
        if (mission.secondaryType && !isValidMissionType(mission.secondaryType)) {
            errors.push('Invalid secondary type: "' + mission.secondaryType + '"');
        }

        // ---- STATUS ----
        if (mission.status && !isValidStatus(mission.status)) {
            errors.push('Invalid status: "' + mission.status + '"');
        }

        // ---- PRIORITY ----
        if (mission.priority && !isValidPriority(mission.priority)) {
            errors.push('Invalid priority: "' + mission.priority + '"');
        }

        // ---- DIFFICULTY ----
        if (mission.difficulty && !isValidDifficulty(mission.difficulty)) {
            errors.push('Invalid difficulty: "' + mission.difficulty + '"');
        }

        // ---- BILLING ----
        if (mission.billing && !isValidBilling(mission.billing)) {
            errors.push('Invalid billing type: "' + mission.billing + '"');
        }

        // ---- ESCALATION ----
        if (mission.escalation && !isValidEscalation(mission.escalation)) {
            errors.push('Invalid escalation tier: "' + mission.escalation + '"');
        }

        // ---- DATE ----
        if (mission.year !== undefined && mission.year !== null) {
            var y = Number(mission.year);
            if (!Number.isInteger(y) || y < 1000 || y > 9999) {
                errors.push('Year must be a valid 4-digit year.');
            }
        }

        if (mission.month !== undefined && mission.month !== null) {
            var m = Number(mission.month);
            if (!Number.isInteger(m) || m < 1 || m > 12) {
                errors.push('Month must be between 1 and 12.');
            }
        }

        if (mission.day !== undefined && mission.day !== null) {
            var d = Number(mission.day);
            if (!Number.isInteger(d) || d < 1 || d > 31) {
                errors.push('Day must be between 1 and 31.');
            }
        }

        // Actual date validation (if all components present and non-null)
        var hasYear = mission.year !== undefined && mission.year !== null;
        var hasMonth = mission.month !== undefined && mission.month !== null;
        var hasDay = mission.day !== undefined && mission.day !== null;

        if (hasYear && hasMonth && hasDay) {
            if (!CalendarValidation.isValidCalendarDate(mission.year, mission.month, mission.day)) {
                errors.push('Invalid calendar date.');
            }
        }

        // ---- OBJECTIVES ----
        if (mission.objectives !== undefined) {
            if (!Array.isArray(mission.objectives)) {
                errors.push('Objectives must be an array.');
            } else {
                for (var i = 0; i < mission.objectives.length; i++) {
                    validateObjective(mission.objectives[i], i, errors);
                }
            }
        }

        // ---- TAGS ----
        if (mission.tags !== undefined) {
            if (!Array.isArray(mission.tags)) {
                errors.push('Tags must be an array.');
            } else {
                for (var i = 0; i < mission.tags.length; i++) {
                    validateTag(mission.tags[i], i, errors);
                }
            }
        }

        // ---- SUPPORT PERSONNEL ----
        if (mission.supportPersonnel !== undefined) {
            if (!Array.isArray(mission.supportPersonnel)) {
                errors.push('Support personnel must be an array.');
            } else {
                for (var i = 0; i < mission.supportPersonnel.length; i++) {
                    validateSupportPersonnel(mission.supportPersonnel[i], i, errors);
                }
            }
        }

        // ---- LOG ----
        if (mission.log !== undefined) {
            if (!Array.isArray(mission.log)) {
                errors.push('Log must be an array.');
            } else {
                for (var i = 0; i < mission.log.length; i++) {
                    validateLogEntry(mission.log[i], i, errors);
                }
            }
        }

        // ---- PROGRESS ----
        // Progress is DERIVED. Validate that if present, it's within range.
        if (mission.progress !== undefined) {
            var prog = Number(mission.progress);
            if (!Number.isFinite(prog) || prog < 0 || prog > 100) {
                errors.push('Progress must be a number between 0 and 100.');
            }
        }

        // ---- PAY ----
        // Pay is DERIVED. Validate that if present, it's a string.
        if (mission.pay !== undefined && mission.pay !== null) {
            if (typeof mission.pay !== 'string') {
                errors.push('Pay must be a string.');
            }
        }

        // ---- COMPLETED AT ----
        if (mission.completedAt !== undefined && mission.completedAt !== null) {
            if (typeof mission.completedAt !== 'string' || isNaN(new Date(mission.completedAt).getTime())) {
                errors.push('CompletedAt must be a valid ISO date string.');
            }
        }

        // ---- CREATED AT ----
        if (mission.createdAt !== undefined && mission.createdAt !== null) {
            if (typeof mission.createdAt !== 'string' || isNaN(new Date(mission.createdAt).getTime())) {
                errors.push('CreatedAt must be a valid ISO date string.');
            }
        }

        // ---- MISSION ID ----
        if (mission.missionId !== undefined && mission.missionId !== null) {
            if (!isNonEmptyString(mission.missionId)) {
                errors.push('Mission ID must be a non-empty string.');
            }
        }

        // ---- ID ----
        if (mission.id !== undefined && mission.id !== null) {
            if (!isNonEmptyString(mission.id)) {
                errors.push('ID must be a non-empty string.');
            }
        }

        // ---- GRADUATING CLASS ----
        if (mission.graduatingClassId !== undefined && mission.graduatingClassId !== null) {
            var gradId = IdUtils.normaliseId(mission.graduatingClassId);
            if (gradId === null) {
                errors.push('Invalid graduatingClassId.');
            }
        }

        // ---- CLASS FILTER ----
        if (mission.classFilterEnabled !== undefined && typeof mission.classFilterEnabled !== 'boolean') {
            errors.push('classFilterEnabled must be a boolean.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // CANONICALISE MISSION SHAPE - Structural only
    // ============================================================

    /**
     * Canonicalise a mission object to canonical form.
     * 
     * IMPORTANT SEMANTICS:
     *   - Preserves id and missionId if present (does not invent them)
     *   - Does NOT invent missing date components
     *   - Rejects invalid nested records (does not silently discard)
     *   - Strips unknown fields (schema is authoritative)
     *   - Does NOT derive progress, pay, or completedAt
     *   - Returns { valid, errors, value }
     * 
     * This is a STRUCTURAL normaliser only.
     * Business derivation belongs in MissionRules.
     * 
     * @param {object} input - Input mission data
     * @returns {object} { valid: boolean, errors: array, value: object|null }
     */
    function canonicaliseMissionShape(input) {
        var errors = [];
        var result = null;

        if (!input || typeof input !== 'object') {
            errors.push('Mission data must be an object.');
            return { valid: false, errors: errors, value: null };
        }

        // ---- PRESERVE ID AND MISSION ID ----
        var id = input.id !== undefined && input.id !== null && isNonEmptyString(input.id)
            ? String(input.id).trim()
            : null;

        var missionId = input.missionId !== undefined && input.missionId !== null && isNonEmptyString(input.missionId)
            ? String(input.missionId).trim()
            : null;

        // ---- PRESERVE INCOMPLETE DATES (no defaults) ----
        var year = input.year !== undefined && input.year !== null
            ? Number(input.year)
            : null;

        var month = input.month !== undefined && input.month !== null
            ? Number(input.month)
            : null;

        var day = input.day !== undefined && input.day !== null
            ? Number(input.day)
            : null;

        // Validate number conversions
        if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 9999)) {
            errors.push('Invalid year value.');
            year = null;
        }
        if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
            errors.push('Invalid month value.');
            month = null;
        }
        if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) {
            errors.push('Invalid day value.');
            day = null;
        }

        // ---- CLEAN OBJECTIVES (reject invalid) ----
        var objectives = [];
        if (input.objectives !== undefined) {
            if (!Array.isArray(input.objectives)) {
                errors.push('Objectives must be an array.');
            } else {
                for (var i = 0; i < input.objectives.length; i++) {
                    var o = input.objectives[i];
                    if (!o || typeof o !== 'object') {
                        errors.push('Objective ' + (i + 1) + ' must be an object.');
                        continue;
                    }
                    var text = String(o.text || '').trim();
                    if (!text) {
                        errors.push('Objective ' + (i + 1) + ' requires non-empty text.');
                        continue;
                    }
                    objectives.push({
                        text: text,
                        done: !!o.done
                    });
                }
            }
        } else {
            objectives = [];
        }

        // ---- CLEAN SUPPORT PERSONNEL (reject invalid) ----
        var supportPersonnel = [];
        if (input.supportPersonnel !== undefined) {
            if (!Array.isArray(input.supportPersonnel)) {
                errors.push('Support personnel must be an array.');
            } else {
                for (var i = 0; i < input.supportPersonnel.length; i++) {
                    var idVal = IdUtils.normaliseId(input.supportPersonnel[i]);
                    if (idVal === null) {
                        errors.push('Support personnel ' + (i + 1) + ' has invalid ID.');
                        continue;
                    }
                    supportPersonnel.push(idVal);
                }
            }
        }

        // ---- CLEAN TAGS (reject invalid) ----
        var tags = [];
        if (input.tags !== undefined) {
            if (!Array.isArray(input.tags)) {
                errors.push('Tags must be an array.');
            } else {
                for (var i = 0; i < input.tags.length; i++) {
                    var tag = input.tags[i];
                    if (typeof tag !== 'string') {
                        errors.push('Tag ' + (i + 1) + ' must be a string.');
                        continue;
                    }
                    var trimmed = tag.trim();
                    if (trimmed) {
                        tags.push(trimmed);
                    }
                }
            }
        }

        // ---- CLEAN LOG (reject invalid) ----
        var log = [];
        if (input.log !== undefined) {
            if (!Array.isArray(input.log)) {
                errors.push('Log must be an array.');
            } else {
                for (var i = 0; i < input.log.length; i++) {
                    var entry = input.log[i];
                    if (!entry || typeof entry !== 'object') {
                        errors.push('Log entry ' + (i + 1) + ' must be an object.');
                        continue;
                    }
                    var message = String(entry.message || '').trim();
                    if (!message) {
                        errors.push('Log entry ' + (i + 1) + ' requires non-empty message.');
                        continue;
                    }
                    log.push({
                        timestamp: entry.timestamp || new Date().toISOString(),
                        message: message
                    });
                }
            }
        }

        // ---- DERIVED FIELDS (validated but not calculated) ----
        // progress: validated if present, but not calculated
        var progress = null;
        if (input.progress !== undefined && input.progress !== null) {
            var prog = Number(input.progress);
            if (Number.isFinite(prog) && prog >= 0 && prog <= 100) {
                progress = prog;
            } else {
                errors.push('Progress must be a number between 0 and 100.');
                progress = 0;
            }
        } else {
            progress = 0;
        }

        // pay: validated if present, but not calculated
        var pay = '';
        if (input.pay !== undefined && input.pay !== null) {
            if (typeof input.pay === 'string') {
                pay = input.pay;
            } else {
                errors.push('Pay must be a string.');
            }
        }

        // status: validated
        var status = input.status || 'active';
        if (!isValidStatus(status)) {
            errors.push('Invalid status: "' + status + '"');
            status = 'active';
        }

        // ---- OTHER FIELDS (validated) ----
        var title = input.title && typeof input.title === 'string' ? input.title.trim() : '';
        if (!title) {
            errors.push('Mission title is required.');
        }

        var description = input.description && typeof input.description === 'string' ? input.description.trim() : '';

        var primaryType = input.primaryType || '';
        if (primaryType && !isValidMissionType(primaryType)) {
            errors.push('Invalid primary type: "' + primaryType + '"');
            primaryType = '';
        }

        var subtype = input.subtype || '';
        if (subtype && primaryType && !isValidSubtype(primaryType, subtype)) {
            errors.push('Invalid subtype "' + subtype + '" for primary type "' + primaryType + '".');
            subtype = '';
        }

        var secondaryType = input.secondaryType || '';
        if (secondaryType && !isValidMissionType(secondaryType)) {
            errors.push('Invalid secondary type: "' + secondaryType + '"');
            secondaryType = '';
        }

        var escalation = input.escalation || 'tier_ii';
        if (!isValidEscalation(escalation)) {
            errors.push('Invalid escalation tier: "' + escalation + '"');
            escalation = 'tier_ii';
        }

        var threatType = input.threatType || '';
        var environment = input.environment || '';
        var location = input.location || '';
        var duration = input.duration || '';

        var difficulty = input.difficulty || 'medium';
        if (!isValidDifficulty(difficulty)) {
            errors.push('Invalid difficulty: "' + difficulty + '"');
            difficulty = 'medium';
        }

        var priority = input.priority || 'medium';
        if (!isValidPriority(priority)) {
            errors.push('Invalid priority: "' + priority + '"');
            priority = 'medium';
        }

        var basePay = input.basePay !== undefined && input.basePay !== null ? String(input.basePay) : '';
        var surchargePay = input.surchargePay !== undefined && input.surchargePay !== null ? String(input.surchargePay) : '';

        var billing = input.billing || 'original';
        if (!isValidBilling(billing)) {
            errors.push('Invalid billing type: "' + billing + '"');
            billing = 'original';
        }

        var assignedTeamId = input.assignedTeamId || null;
        if (assignedTeamId !== null) {
            var teamId = IdUtils.normaliseId(assignedTeamId);
            if (teamId === null) {
                errors.push('Invalid assignedTeamId.');
                assignedTeamId = null;
            } else {
                assignedTeamId = teamId;
            }
        }

        var notes = input.notes || '';

        var createdAt = input.createdAt || new Date().toISOString();
        if (typeof createdAt !== 'string' || isNaN(new Date(createdAt).getTime())) {
            errors.push('CreatedAt must be a valid ISO date string.');
            createdAt = new Date().toISOString();
        }

        var completedAt = input.completedAt !== undefined && input.completedAt !== null
            ? input.completedAt
            : null;
        if (completedAt !== null && (typeof completedAt !== 'string' || isNaN(new Date(completedAt).getTime()))) {
            errors.push('CompletedAt must be a valid ISO date string or null.');
            completedAt = null;
        }

        // ---- GRADUATING CLASS ----
        var graduatingClassId = input.graduatingClassId !== undefined && input.graduatingClassId !== null
            ? IdUtils.normaliseId(input.graduatingClassId)
            : null;
        if (input.graduatingClassId !== undefined && input.graduatingClassId !== null && graduatingClassId === null) {
            errors.push('Invalid graduatingClassId.');
        }

        // ---- CLASS FILTER ----
        var classFilterEnabled = typeof input.classFilterEnabled === 'boolean'
            ? input.classFilterEnabled
            : false;

        // ---- BUILD CANONICAL OBJECT ----
        result = {
            id: id,
            missionId: missionId,
            title: title,
            description: description,
            year: year,
            month: month,
            day: day,
            primaryType: primaryType,
            subtype: subtype,
            secondaryType: secondaryType,
            escalation: escalation,
            threatType: threatType,
            environment: environment,
            location: location,
            duration: duration,
            difficulty: difficulty,
            priority: priority,
            basePay: basePay,
            surchargePay: surchargePay,
            pay: pay,
            billing: billing,
            assignedTeamId: assignedTeamId,
            supportPersonnel: supportPersonnel,
            status: status,
            objectives: objectives,
            progress: progress,
            notes: notes,
            tags: tags,
            createdAt: createdAt,
            completedAt: completedAt,
            log: log,
            graduatingClassId: graduatingClassId,
            classFilterEnabled: classFilterEnabled
        };

        return { valid: errors.length === 0, errors: errors, value: result };
    }

    // ============================================================
    // DEFENSIVE GETTERS (copies, not live references)
    // ============================================================

    function getMissionTypes() {
        var result = {};
        Object.keys(MISSION_TYPES).forEach(function(key) {
            var type = MISSION_TYPES[key];
            result[key] = {
                id: type.id,
                label: type.label,
                description: type.description,
                subtypes: type.subtypes.slice()
            };
        });
        return result;
    }

    function getSubtypesForType(typeId) {
        var type = getMissionType(typeId);
        return type ? type.subtypes.slice() : [];
    }

    function getSubtypeLabels() {
        return Object.assign({}, SUBTYPE_LABELS);
    }

    function getValidDifficulties() {
        return VALID_DIFFICULTIES.slice();
    }

    function getValidPriorities() {
        return VALID_PRIORITIES.slice();
    }

    function getValidStatuses() {
        return VALID_STATUSES.slice();
    }

    function getValidBillingTypes() {
        return VALID_BILLING_TYPES.slice();
    }

    function getValidEscalationTiers() {
        return VALID_ESCALATION_TIERS.slice();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsSchema = {
        // Constants (frozen, read-only)
        SCHEMA_VERSION: SCHEMA_VERSION,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PRIORITIES: VALID_PRIORITIES,
        VALID_DIFFICULTIES: VALID_DIFFICULTIES,
        VALID_BILLING_TYPES: VALID_BILLING_TYPES,
        VALID_ESCALATION_TIERS: VALID_ESCALATION_TIERS,
        DIFFICULTY_CODES: DIFFICULTY_CODES,
        MISSION_TYPES: MISSION_TYPES,
        SUBTYPE_LABELS: SUBTYPE_LABELS,
        ESCALATION_LABELS: ESCALATION_LABELS,
        BILLING_LABELS: BILLING_LABELS,

        // Defensive getters (copies, not live references)
        getMissionTypes: getMissionTypes,
        getSubtypesForType: getSubtypesForType,
        getSubtypeLabels: getSubtypeLabels,
        getValidDifficulties: getValidDifficulties,
        getValidPriorities: getValidPriorities,
        getValidStatuses: getValidStatuses,
        getValidBillingTypes: getValidBillingTypes,
        getValidEscalationTiers: getValidEscalationTiers,

        // Type helpers
        isObject: isObject,
        isNonEmptyString: isNonEmptyString,
        isString: isString,
        isBoolean: isBoolean,
        isFiniteNumber: isFiniteNumber,
        isValidStatus: isValidStatus,
        isValidPriority: isValidPriority,
        isValidDifficulty: isValidDifficulty,
        isValidBilling: isValidBilling,
        isValidEscalation: isValidEscalation,
        isValidMissionType: isValidMissionType,
        isValidSubtype: isValidSubtype,

        // Type display helpers (labels only - no colors/icons)
        getMissionType: getMissionType,
        getMissionTypeLabel: getMissionTypeLabel,
        getSubtypeLabel: getSubtypeLabel,
        getEscalationLabel: getEscalationLabel,
        getBillingLabel: getBillingLabel,
        getDifficultyCode: getDifficultyCode,

        // Deep validation
        validateObjective: validateObjective,
        validateLogEntry: validateLogEntry,
        validateTag: validateTag,
        validateSupportPersonnel: validateSupportPersonnel,

        // Main validation
        validateMission: validateMission,

        // Canonicalisation (structural only)
        canonicaliseMissionShape: canonicaliseMissionShape
    };

})();
