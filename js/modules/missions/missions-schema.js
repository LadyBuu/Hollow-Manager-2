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
 */

(function() {
    'use strict';

    if (window.__missionsSchemaLoaded) return;
    window.__missionsSchemaLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var SCHEMA_VERSION = 1;

    var VALID_STATUSES = ['active', 'completed', 'cancelled'];
    var VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
    var VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
    var VALID_BILLING_TYPES = ['original', 'escalated', 'emergency', 'internal'];
    var VALID_ESCALATION_TIERS = ['tier_i', 'tier_ii', 'tier_iii', 'tier_iv', 'tier_v'];

    var DIFFICULTY_CODES = {
        'easy': 'E',
        'medium': 'M',
        'hard': 'H',
        'expert': 'X'
    };

    var MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // ============================================================
    // MISSION TYPE TAXONOMY
    // ============================================================

    var MISSION_TYPES = {
        'combat': {
            id: 'combat',
            label: 'Combat',
            icon: '⚔',
            color: 'var(--danger)',
            description: 'Direct combat operations, elimination, defence, protection',
            subtypes: ['elimination', 'defence', 'protection']
        },
        'recovery': {
            id: 'recovery',
            label: 'Recovery',
            icon: '◈',
            color: 'var(--warning)',
            description: 'Retrieval of people, materials, or artifacts',
            subtypes: ['retrieval', 'rescue', 'material_recovery', 'artifact_recovery']
        },
        'investigation': {
            id: 'investigation',
            label: 'Investigation',
            icon: '◉',
            color: 'var(--accent)',
            description: 'Investigations, reconnaissance, surveillance',
            subtypes: ['investigation', 'reconnaissance', 'surveillance']
        },
        'exploration': {
            id: 'exploration',
            label: 'Exploration',
            icon: '⌂',
            color: 'var(--info)',
            description: 'Exploration, surveys, expeditions',
            subtypes: ['exploration', 'survey', 'expedition']
        },
        'infiltration': {
            id: 'infiltration',
            label: 'Infiltration',
            icon: '◈',
            color: 'var(--warning)',
            description: 'Stealth entry, social infiltration, espionage',
            subtypes: ['stealth_entry', 'social_infiltration', 'theft_recovery', 'espionage']
        },
        'containment': {
            id: 'containment',
            label: 'Containment',
            icon: '⊗',
            color: 'var(--warning)',
            description: 'Capture, magical containment, quarantine',
            subtypes: ['capture', 'magical_containment', 'quarantine']
        },
        'acquisition': {
            id: 'acquisition',
            label: 'Acquisition',
            icon: '◈',
            color: 'var(--accent)',
            description: 'Gathering ingredients, resources, or specimens',
            subtypes: ['ingredients', 'resources', 'specimens']
        },
        'research': {
            id: 'research',
            label: 'Research',
            icon: '◈',
            color: 'var(--info)',
            description: 'Observation, field research, field testing',
            subtypes: ['observation', 'field_research', 'field_testing']
        },
        'diplomatic': {
            id: 'diplomatic',
            label: 'Diplomatic',
            icon: '◈',
            color: 'var(--accent)',
            description: 'Negotiation, mediation, representation',
            subtypes: ['negotiation', 'mediation', 'representation']
        },
        'assassination': {
            id: 'assassination',
            label: 'Assassination',
            icon: '◈',
            color: 'var(--danger)',
            description: 'Targeted elimination',
            subtypes: ['targeted_elimination']
        }
    };

    // Subtype labels for display
    var SUBTYPE_LABELS = {
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
    };

    var ESCALATION_LABELS = {
        'tier_i': 'Tier I - Routine',
        'tier_ii': 'Tier II - Complicated',
        'tier_iii': 'Tier III - Dangerous',
        'tier_iv': 'Tier IV - Critical',
        'tier_v': 'Tier V - Catastrophic'
    };

    var BILLING_LABELS = {
        'original': 'Original Contract',
        'escalated': 'Escalated / Surcharge',
        'emergency': 'Emergency Intervention',
        'internal': 'Internal / Research'
    };

    var PRIORITY_INFO = {
        'critical': { label: 'Critical', color: 'var(--danger)' },
        'high': { label: 'High', color: 'var(--warning)' },
        'medium': { label: 'Medium', color: 'var(--warning)' },
        'low': { label: 'Low', color: 'var(--accent)' }
    };

    var STATUS_INFO = {
        'active': { label: 'Active', color: 'var(--accent)' },
        'completed': { label: 'Completed', color: 'var(--info)' },
        'cancelled': { label: 'Cancelled', color: 'var(--danger)' }
    };

    var DIFFICULTY_LABELS = {
        'easy': 'Easy',
        'medium': 'Medium',
        'hard': 'Hard',
        'expert': 'Expert'
    };

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isValidStatus(status) {
        return status && VALID_STATUSES.indexOf(status) !== -1;
    }

    function isValidPriority(priority) {
        return priority && VALID_PRIORITIES.indexOf(priority) !== -1;
    }

    function isValidDifficulty(difficulty) {
        return difficulty && VALID_DIFFICULTIES.indexOf(difficulty) !== -1;
    }

    function isValidBilling(billing) {
        return billing && VALID_BILLING_TYPES.indexOf(billing) !== -1;
    }

    function isValidEscalation(escalation) {
        return escalation && VALID_ESCALATION_TIERS.indexOf(escalation) !== -1;
    }

    function isValidMissionType(type) {
        return type && MISSION_TYPES[type] !== undefined;
    }

    function isValidSubtype(typeId, subtype) {
        if (!typeId || !subtype) return false;
        var type = MISSION_TYPES[typeId];
        if (!type) return false;
        return type.subtypes.indexOf(subtype) !== -1;
    }

    function normaliseId(id) {
        if (id === undefined || id === null) return null;
        if (typeof id === 'object') return null;
        var normalised = String(id).trim();
        return normalised !== '' ? normalised : null;
    }

    function getMissionType(typeId) {
        return MISSION_TYPES[typeId] || null;
    }

    function getMissionTypeLabel(typeId) {
        var type = getMissionType(typeId);
        return type ? type.label : typeId || 'Unclassified';
    }

    function getMissionTypeIcon(typeId) {
        var type = getMissionType(typeId);
        return type ? type.icon : '◈';
    }

    function getMissionTypeColor(typeId) {
        var type = getMissionType(typeId);
        return type ? type.color : 'var(--text-dim)';
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

    function getPriorityInfo(priority) {
        return PRIORITY_INFO[priority] || { label: 'Medium', color: 'var(--text-dim)' };
    }

    function getStatusInfo(status) {
        return STATUS_INFO[status] || { label: 'Active', color: 'var(--text-dim)' };
    }

    function getDifficultyLabel(difficulty) {
        return DIFFICULTY_LABELS[difficulty] || difficulty || 'Medium';
    }

    function getDifficultyCode(difficulty) {
        return DIFFICULTY_CODES[difficulty] || 'M';
    }

    function getMonthName(month) {
        var num = parseInt(month, 10);
        if (isNaN(num) || num < 1 || num > 12) return '';
        return MONTH_NAMES[num - 1];
    }

    // ============================================================
    // MISSION VALIDATION
    // ============================================================

    function validateMission(mission) {
        var errors = [];

        if (!mission || typeof mission !== 'object') {
            return { valid: false, errors: ['Mission must be an object.'] };
        }

        if (!isNonEmptyString(mission.title)) {
            errors.push('Mission title is required.');
        }

        if (mission.primaryType && !isValidMissionType(mission.primaryType)) {
            errors.push('Invalid primary type.');
        }

        if (mission.subtype && mission.primaryType && !isValidSubtype(mission.primaryType, mission.subtype)) {
            errors.push('Invalid subtype for primary type.');
        }

        if (mission.secondaryType && !isValidMissionType(mission.secondaryType)) {
            errors.push('Invalid secondary type.');
        }

        if (mission.status && !isValidStatus(mission.status)) {
            errors.push('Invalid status.');
        }

        if (mission.priority && !isValidPriority(mission.priority)) {
            errors.push('Invalid priority.');
        }

        if (mission.difficulty && !isValidDifficulty(mission.difficulty)) {
            errors.push('Invalid difficulty.');
        }

        if (mission.billing && !isValidBilling(mission.billing)) {
            errors.push('Invalid billing type.');
        }

        if (mission.escalation && !isValidEscalation(mission.escalation)) {
            errors.push('Invalid escalation tier.');
        }

        if (mission.year !== undefined) {
            var year = parseInt(mission.year, 10);
            if (isNaN(year) || year < 1000 || year > 9999) {
                errors.push('Year must be a valid 4-digit year.');
            }
        }

        if (mission.month !== undefined) {
            var month = parseInt(mission.month, 10);
            if (isNaN(month) || month < 1 || month > 12) {
                errors.push('Month must be between 1 and 12.');
            }
        }

        if (mission.day !== undefined) {
            var day = parseInt(mission.day, 10);
            if (isNaN(day) || day < 1 || day > 31) {
                errors.push('Day must be between 1 and 31.');
            }
        }

        if (mission.objectives && !Array.isArray(mission.objectives)) {
            errors.push('Objectives must be an array.');
        }

        if (mission.tags && !Array.isArray(mission.tags)) {
            errors.push('Tags must be an array.');
        }

        if (mission.supportPersonnel && !Array.isArray(mission.supportPersonnel)) {
            errors.push('Support personnel must be an array.');
        }

        if (mission.log && !Array.isArray(mission.log)) {
            errors.push('Log must be an array.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionsSchema = {
        // Constants
        SCHEMA_VERSION: SCHEMA_VERSION,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PRIORITIES: VALID_PRIORITIES,
        VALID_DIFFICULTIES: VALID_DIFFICULTIES,
        VALID_BILLING_TYPES: VALID_BILLING_TYPES,
        VALID_ESCALATION_TIERS: VALID_ESCALATION_TIERS,
        DIFFICULTY_CODES: DIFFICULTY_CODES,
        MONTH_NAMES: MONTH_NAMES,
        MISSION_TYPES: MISSION_TYPES,
        SUBTYPE_LABELS: SUBTYPE_LABELS,
        ESCALATION_LABELS: ESCALATION_LABELS,
        BILLING_LABELS: BILLING_LABELS,
        PRIORITY_INFO: PRIORITY_INFO,
        STATUS_INFO: STATUS_INFO,
        DIFFICULTY_LABELS: DIFFICULTY_LABELS,

        // Type helpers
        isObject: isObject,
        isNonEmptyString: isNonEmptyString,
        isValidStatus: isValidStatus,
        isValidPriority: isValidPriority,
        isValidDifficulty: isValidDifficulty,
        isValidBilling: isValidBilling,
        isValidEscalation: isValidEscalation,
        isValidMissionType: isValidMissionType,
        isValidSubtype: isValidSubtype,
        normaliseId: normaliseId,
        getMissionType: getMissionType,
        getMissionTypeLabel: getMissionTypeLabel,
        getMissionTypeIcon: getMissionTypeIcon,
        getMissionTypeColor: getMissionTypeColor,
        getSubtypeLabel: getSubtypeLabel,
        getEscalationLabel: getEscalationLabel,
        getBillingLabel: getBillingLabel,
        getPriorityInfo: getPriorityInfo,
        getStatusInfo: getStatusInfo,
        getDifficultyLabel: getDifficultyLabel,
        getDifficultyCode: getDifficultyCode,
        getMonthName: getMonthName,

        // Validation
        validateMission: validateMission
    };

})();
