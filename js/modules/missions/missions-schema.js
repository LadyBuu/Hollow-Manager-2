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
 * DATE VALIDATION:
 *   - Validates actual calendar dates (no Feb 31)
 *   - Accepts incomplete dates (year only, year+month, etc.)
 *   - Returns true if all components are valid together
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

    var DAYS_IN_MONTH = {
        1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30,
        7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31
    };

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
            icon: '🔍',
            color: 'var(--warning)',
            description: 'Retrieval of people, materials, or artifacts',
            subtypes: ['retrieval', 'rescue', 'material_recovery', 'artifact_recovery']
        },
        'investigation': {
            id: 'investigation',
            label: 'Investigation',
            icon: '🔍',
            color: 'var(--accent)',
            description: 'Investigations, reconnaissance, surveillance',
            subtypes: ['investigation', 'reconnaissance', 'surveillance']
        },
        'exploration': {
            id: 'exploration',
            label: 'Exploration',
            icon: '🧭',
            color: 'var(--info)',
            description: 'Exploration, surveys, expeditions',
            subtypes: ['exploration', 'survey', 'expedition']
        },
        'infiltration': {
            id: 'infiltration',
            label: 'Infiltration',
            icon: '🥷',
            color: 'var(--warning)',
            description: 'Stealth entry, social infiltration, espionage',
            subtypes: ['stealth_entry', 'social_infiltration', 'theft_recovery', 'espionage']
        },
        'containment': {
            id: 'containment',
            label: 'Containment',
            icon: '🔒',
            color: 'var(--warning)',
            description: 'Capture, magical containment, quarantine',
            subtypes: ['capture', 'magical_containment', 'quarantine']
        },
        'acquisition': {
            id: 'acquisition',
            label: 'Acquisition',
            icon: '📦',
            color: 'var(--accent)',
            description: 'Gathering ingredients, resources, or specimens',
            subtypes: ['ingredients', 'resources', 'specimens']
        },
        'research': {
            id: 'research',
            label: 'Research',
            icon: '🔬',
            color: 'var(--info)',
            description: 'Observation, field research, field testing',
            subtypes: ['observation', 'field_research', 'field_testing']
        },
        'diplomatic': {
            id: 'diplomatic',
            label: 'Diplomatic',
            icon: '🤝',
            color: 'var(--accent)',
            description: 'Negotiation, mediation, representation',
            subtypes: ['negotiation', 'mediation', 'representation']
        },
        'assassination': {
            id: 'assassination',
            label: 'Assassination',
            icon: '🎯',
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

    function isString(value) {
        return typeof value === 'string';
    }

    function isBoolean(value) {
        return typeof value === 'boolean';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
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

    // ============================================================
    // DATE VALIDATION
    // ============================================================

    function isLeapYear(year) {
        if (typeof year !== 'number' || !Number.isInteger(year)) return false;
        return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    }

    function getDaysInMonth(year, month) {
        if (typeof year !== 'number' || typeof month !== 'number') return 0;
        if (!Number.isInteger(year) || !Number.isInteger(month)) return 0;
        if (month < 1 || month > 12) return 0;

        if (month === 2 && isLeapYear(year)) {
            return 29;
        }

        return DAYS_IN_MONTH[month] || 0;
    }

    function isValidCalendarDate(year, month, day) {
        // If any component is undefined, that's okay (incomplete date)
        // Only validate if all three are provided
        if (year === undefined || month === undefined || day === undefined) {
            return true;
        }

        var y = Number(year);
        var m = Number(month);
        var d = Number(day);

        if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
            return false;
        }

        if (y < 1000 || y > 9999) return false;
        if (m < 1 || m > 12) return false;
        if (d < 1) return false;

        var maxDays = getDaysInMonth(y, m);
        if (maxDays === 0) return false;

        return d <= maxDays;
    }

    function isValidYearComponent(year) {
        if (year === undefined || year === null) return true;
        var y = Number(year);
        return Number.isInteger(y) && y >= 1000 && y <= 9999;
    }

    function isValidMonthComponent(month) {
        if (month === undefined || month === null) return true;
        var m = Number(month);
        return Number.isInteger(m) && m >= 1 && m <= 12;
    }

    function isValidDayComponent(day) {
        if (day === undefined || day === null) return true;
        var d = Number(day);
        return Number.isInteger(d) && d >= 1 && d <= 31;
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

    function getMissionTypeIcon(typeId) {
        var type = getMissionType(typeId);
        return type ? type.icon : '📋';
    }

    function getMissionTypeColor(typeId) {
        var type = getMissionType(typeId);
        return type ? type.color : 'var(--text-dim)';
    }

    function getSubtypeLabel(subtypeId) {
        return SUBTYPE_LABELS[subtypeId] || subtypeId || '';
    }

    function getEscalationLabel(escalation) {
        if (escalation && ESCALATION_LABELS[escalation]) {
            return ESCALATION_LABELS[escalation];
        }
        return 'Tier II - Complicated';
    }

    function getBillingLabel(billing) {
        if (billing && BILLING_LABELS[billing]) {
            return BILLING_LABELS[billing];
        }
        return 'Original Contract';
    }

    function getPriorityInfo(priority) {
        if (priority && PRIORITY_INFO[priority]) {
            return PRIORITY_INFO[priority];
        }
        return { label: 'Medium', color: 'var(--text-dim)' };
    }

    function getStatusInfo(status) {
        if (status && STATUS_INFO[status]) {
            return STATUS_INFO[status];
        }
        return { label: 'Active', color: 'var(--text-dim)' };
    }

    function getDifficultyLabel(difficulty) {
        if (difficulty && DIFFICULTY_LABELS[difficulty]) {
            return DIFFICULTY_LABELS[difficulty];
        }
        return 'Medium';
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
    // DEEP VALIDATION
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
        var normalised = normaliseId(id);
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

        // Actual date validation (if all components present)
        if (mission.year !== undefined && mission.month !== undefined && mission.day !== undefined) {
            if (!isValidCalendarDate(mission.year, mission.month, mission.day)) {
                errors.push('Invalid calendar date.');
            }
        }

        // ---- OBJECTIVES ----
        if (mission.objectives !== undefined) {
            if (!Array.isArray(mission.objectives)) {
                errors.push('Objectives must be an array.');
            } else {
                mission.objectives.forEach(function(obj, index) {
                    validateObjective(obj, index, errors);
                });
            }
        }

        // ---- TAGS ----
        if (mission.tags !== undefined) {
            if (!Array.isArray(mission.tags)) {
                errors.push('Tags must be an array.');
            } else {
                mission.tags.forEach(function(tag, index) {
                    validateTag(tag, index, errors);
                });
            }
        }

        // ---- SUPPORT PERSONNEL ----
        if (mission.supportPersonnel !== undefined) {
            if (!Array.isArray(mission.supportPersonnel)) {
                errors.push('Support personnel must be an array.');
            } else {
                mission.supportPersonnel.forEach(function(id, index) {
                    validateSupportPersonnel(id, index, errors);
                });
            }
        }

        // ---- LOG ----
        if (mission.log !== undefined) {
            if (!Array.isArray(mission.log)) {
                errors.push('Log must be an array.');
            } else {
                mission.log.forEach(function(entry, index) {
                    validateLogEntry(entry, index, errors);
                });
            }
        }

        // ---- PROGRESS ----
        if (mission.progress !== undefined) {
            var prog = Number(mission.progress);
            if (!Number.isInteger(prog) || prog < 0 || prog > 100) {
                errors.push('Progress must be an integer between 0 and 100.');
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

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // MISSION NORMALISATION
    // ============================================================

    /**
     * Normalise a mission object to canonical form.
     * Applies defaults and cleans up nested structures.
     * Returns a clean object ready for validation.
     */
    function normaliseMission(input) {
        if (!input || typeof input !== 'object') {
            return null;
        }

        var now = new Date();

        var normalised = {
            title: input.title && typeof input.title === 'string' ? input.title.trim() : '',
            year: input.year !== undefined && input.year !== null ? Number(input.year) : now.getFullYear(),
            month: input.month !== undefined && input.month !== null ? Number(input.month) : now.getMonth() + 1,
            day: input.day !== undefined && input.day !== null ? Number(input.day) : now.getDate(),
            primaryType: input.primaryType || '',
            subtype: input.subtype || '',
            secondaryType: input.secondaryType || '',
            escalation: input.escalation || 'tier_ii',
            threatType: input.threatType || '',
            environment: input.environment || '',
            location: input.location || '',
            duration: input.duration || '',
            difficulty: input.difficulty || 'medium',
            priority: input.priority || 'medium',
            basePay: input.basePay || '',
            surchargePay: input.surchargePay || '',
            billing: input.billing || 'original',
            assignedTeamId: input.assignedTeamId || null,
            supportPersonnel: Array.isArray(input.supportPersonnel) ? input.supportPersonnel.slice() : [],
            status: input.status || 'active',
            notes: input.notes || '',
            tags: Array.isArray(input.tags) ? input.tags.map(function(t) { return String(t).trim(); }).filter(function(t) { return t; }) : [],
            description: input.description || '',
            objectives: Array.isArray(input.objectives) ? input.objectives.map(function(o) {
                if (!o || typeof o !== 'object') {
                    return { text: '', done: false };
                }
                return {
                    text: String(o.text || '').trim(),
                    done: !!o.done
                };
            }).filter(function(o) { return o.text; }) : [],
            progress: 0,
            createdAt: input.createdAt || new Date().toISOString(),
            completedAt: input.completedAt || null,
            log: Array.isArray(input.log) ? input.log.map(function(entry) {
                if (!entry || typeof entry !== 'object') {
                    return { timestamp: new Date().toISOString(), message: '' };
                }
                return {
                    timestamp: entry.timestamp || new Date().toISOString(),
                    message: String(entry.message || '').trim()
                };
            }).filter(function(entry) { return entry.message; }) : []
        };

        // Calculate progress from objectives
        var total = normalised.objectives.length;
        var completed = normalised.objectives.filter(function(o) { return o.done; }).length;
        normalised.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

        // Calculate pay from base + surcharge
        var baseNum = parseFloat(String(normalised.basePay).replace(/[^0-9.]/g, ''));
        var surchargeNum = parseFloat(String(normalised.surchargePay).replace(/[^0-9.]/g, ''));

        if (!isNaN(baseNum) && !isNaN(surchargeNum)) {
            normalised.pay = (baseNum + surchargeNum).toFixed(2) + ' credits';
        } else if (!isNaN(baseNum)) {
            normalised.pay = baseNum.toFixed(2) + ' credits';
        } else if (!isNaN(surchargeNum)) {
            normalised.pay = surchargeNum.toFixed(2) + ' credits';
        } else {
            normalised.pay = '';
        }

        // Ensure completedAt is consistent with status
        if (normalised.status === 'completed' && !normalised.completedAt) {
            normalised.completedAt = new Date().toISOString();
        } else if (normalised.status !== 'completed') {
            normalised.completedAt = null;
        }

        return normalised;
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
        DAYS_IN_MONTH: DAYS_IN_MONTH,
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
        normaliseId: normaliseId,

        // Date helpers
        isLeapYear: isLeapYear,
        getDaysInMonth: getDaysInMonth,
        isValidCalendarDate: isValidCalendarDate,
        isValidYearComponent: isValidYearComponent,
        isValidMonthComponent: isValidMonthComponent,
        isValidDayComponent: isValidDayComponent,

        // Type display helpers
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

        // Deep validation
        validateObjective: validateObjective,
        validateLogEntry: validateLogEntry,
        validateTag: validateTag,
        validateSupportPersonnel: validateSupportPersonnel,

        // Main validation
        validateMission: validateMission,

        // Normalisation
        normaliseMission: normaliseMission
    };

})();
