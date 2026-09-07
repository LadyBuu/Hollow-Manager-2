/**
 * js/modules/missions/mission-views.js - Mission Views
 * Presentation metadata for missions
 * Path: js/modules/missions/mission-views.js
 * 
 * This module provides:
 *   - Priority labels and colors
 *   - Status labels and colors
 *   - Difficulty labels
 *   - Mission type icons and colors
 *   - Subtype labels
 *   - Escalation labels
 *   - Billing labels
 * 
 * IMPORTANT:
 *   - PURE presentation functions - no business logic
 *   - No persistence, no DOM, no state
 *   - Consumes MissionsSchema for canonical values
 *   - Maps domain values to presentation values
 *   - All functions return strings (never objects that could be mutated)
 *   - No fallbacks - uses canonical schema values
 * 
 * DEPENDENCIES:
 *   - window.MissionsSchema (required)
 * 
 * USAGE:
 *   var Views = window.MissionViews;
 *   var label = Views.getPriorityLabel('critical');  // "Critical"
 *   var color = Views.getPriorityColor('critical'); // "var(--danger)"
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__missionViewsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.MissionsSchema) {
        throw new Error('[MissionViews] MissionsSchema is required.');
    }

    window.__missionViewsLoaded = true;

    var Schema = window.MissionsSchema;

    // ============================================================
    // CONSTANTS - Derived from Schema, frozen
    // ============================================================

    // Priority labels and colors (presentation only)
    var PRIORITY_LABELS = Object.freeze({
        'critical': 'Critical',
        'high': 'High',
        'medium': 'Medium',
        'low': 'Low'
    });

    var PRIORITY_COLORS = Object.freeze({
        'critical': 'var(--danger)',
        'high': 'var(--warning)',
        'medium': 'var(--accent)',
        'low': 'var(--text-dim)'
    });

    var PRIORITY_CLASSES = Object.freeze({
        'critical': 'priority-critical',
        'high': 'priority-high',
        'medium': 'priority-medium',
        'low': 'priority-low'
    });

    // Status labels and colors (presentation only)
    var STATUS_LABELS = Object.freeze({
        'active': 'Active',
        'completed': 'Completed',
        'cancelled': 'Cancelled'
    });

    var STATUS_COLORS = Object.freeze({
        'active': 'var(--accent)',
        'completed': 'var(--info)',
        'cancelled': 'var(--danger)'
    });

    var STATUS_CLASSES = Object.freeze({
        'active': 'status-active',
        'completed': 'status-completed',
        'cancelled': 'status-cancelled'
    });

    // Difficulty labels
    var DIFFICULTY_LABELS = Object.freeze({
        'easy': 'Easy',
        'medium': 'Medium',
        'hard': 'Hard',
        'expert': 'Expert'
    });

    // Escalation labels
    var ESCALATION_LABELS = Object.freeze({
        'tier_i': 'Tier I - Routine',
        'tier_ii': 'Tier II - Complicated',
        'tier_iii': 'Tier III - Dangerous',
        'tier_iv': 'Tier IV - Critical',
        'tier_v': 'Tier V - Catastrophic'
    });

    // Billing labels
    var BILLING_LABELS = Object.freeze({
        'original': 'Original Contract',
        'escalated': 'Escalated / Surcharge',
        'emergency': 'Emergency Intervention',
        'internal': 'Internal / Research'
    });

    // Mission type icons and colors (presentation only)
    var MISSION_TYPE_ICONS = Object.freeze({
        'combat': '⚔',
        'recovery': '🔍',
        'investigation': '🔍',
        'exploration': '🧭',
        'infiltration': '🥷',
        'containment': '🔒',
        'acquisition': '📦',
        'research': '🔬',
        'diplomatic': '🤝',
        'assassination': '🎯'
    });

    var MISSION_TYPE_COLORS = Object.freeze({
        'combat': 'var(--danger)',
        'recovery': 'var(--warning)',
        'investigation': 'var(--accent)',
        'exploration': 'var(--info)',
        'infiltration': 'var(--warning)',
        'containment': 'var(--warning)',
        'acquisition': 'var(--accent)',
        'research': 'var(--info)',
        'diplomatic': 'var(--accent)',
        'assassination': 'var(--danger)'
    });

    // Subtype labels
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
    // PRIORITY HELPERS
    // ============================================================

    /**
     * Get the display label for a priority value.
     * 
     * @param {string} priority - Priority value
     * @returns {string} Display label
     */
    function getPriorityLabel(priority) {
        return PRIORITY_LABELS[priority] || priority || 'Medium';
    }

    /**
     * Get the CSS color for a priority value.
     * 
     * @param {string} priority - Priority value
     * @returns {string} CSS color value
     */
    function getPriorityColor(priority) {
        return PRIORITY_COLORS[priority] || 'var(--text-dim)';
    }

    /**
     * Get the CSS class for a priority value.
     * 
     * @param {string} priority - Priority value
     * @returns {string} CSS class name
     */
    function getPriorityClass(priority) {
        return PRIORITY_CLASSES[priority] || 'priority-medium';
    }

    /**
     * Get the complete priority info object.
     * 
     * @param {string} priority - Priority value
     * @returns {object} { label, color, class }
     */
    function getPriorityInfo(priority) {
        return {
            label: getPriorityLabel(priority),
            color: getPriorityColor(priority),
            class: getPriorityClass(priority)
        };
    }

    // ============================================================
    // STATUS HELPERS
    // ============================================================

    /**
     * Get the display label for a status value.
     * 
     * @param {string} status - Status value
     * @returns {string} Display label
     */
    function getStatusLabel(status) {
        return STATUS_LABELS[status] || status || 'Active';
    }

    /**
     * Get the CSS color for a status value.
     * 
     * @param {string} status - Status value
     * @returns {string} CSS color value
     */
    function getStatusColor(status) {
        return STATUS_COLORS[status] || 'var(--text-dim)';
    }

    /**
     * Get the CSS class for a status value.
     * 
     * @param {string} status - Status value
     * @returns {string} CSS class name
     */
    function getStatusClass(status) {
        return STATUS_CLASSES[status] || 'status-active';
    }

    /**
     * Get the complete status info object.
     * 
     * @param {string} status - Status value
     * @returns {object} { label, color, class }
     */
    function getStatusInfo(status) {
        return {
            label: getStatusLabel(status),
            color: getStatusColor(status),
            class: getStatusClass(status)
        };
    }

    // ============================================================
    // DIFFICULTY HELPERS
    // ============================================================

    /**
     * Get the display label for a difficulty value.
     * 
     * @param {string} difficulty - Difficulty value
     * @returns {string} Display label
     */
    function getDifficultyLabel(difficulty) {
        return DIFFICULTY_LABELS[difficulty] || difficulty || 'Medium';
    }

    /**
     * Get the difficulty code for a difficulty value.
     * Delegates to Schema.
     * 
     * @param {string} difficulty - Difficulty value
     * @returns {string} Difficulty code (E, M, H, X)
     */
    function getDifficultyCode(difficulty) {
        return Schema.getDifficultyCode(difficulty) || 'M';
    }

    // ============================================================
    // ESCALATION HELPERS
    // ============================================================

    /**
     * Get the display label for an escalation tier.
     * 
     * @param {string} escalation - Escalation tier value
     * @returns {string} Display label
     */
    function getEscalationLabel(escalation) {
        return ESCALATION_LABELS[escalation] || escalation || 'Tier II - Complicated';
    }

    // ============================================================
    // BILLING HELPERS
    // ============================================================

    /**
     * Get the display label for a billing type.
     * 
     * @param {string} billing - Billing type value
     * @returns {string} Display label
     */
    function getBillingLabel(billing) {
        return BILLING_LABELS[billing] || billing || 'Original Contract';
    }

    // ============================================================
    // MISSION TYPE HELPERS
    // ============================================================

    /**
     * Get the display icon for a mission type.
     * 
     * @param {string} typeId - Mission type ID
     * @returns {string} Icon character
     */
    function getMissionTypeIcon(typeId) {
        return MISSION_TYPE_ICONS[typeId] || '📋';
    }

    /**
     * Get the CSS color for a mission type.
     * 
     * @param {string} typeId - Mission type ID
     * @returns {string} CSS color value
     */
    function getMissionTypeColor(typeId) {
        return MISSION_TYPE_COLORS[typeId] || 'var(--text-dim)';
    }

    /**
     * Get the label for a mission type.
     * Delegates to Schema.
     * 
     * @param {string} typeId - Mission type ID
     * @returns {string} Display label
     */
    function getMissionTypeLabel(typeId) {
        return Schema.getMissionTypeLabel(typeId);
    }

    /**
     * Get complete mission type info.
     * 
     * @param {string} typeId - Mission type ID
     * @returns {object} { label, icon, color }
     */
    function getMissionTypeInfo(typeId) {
        return {
            label: getMissionTypeLabel(typeId),
            icon: getMissionTypeIcon(typeId),
            color: getMissionTypeColor(typeId)
        };
    }

    // ============================================================
    // SUBTYPE HELPERS
    // ============================================================

    /**
     * Get the display label for a subtype.
     * 
     * @param {string} subtypeId - Subtype ID
     * @returns {string} Display label
     */
    function getSubtypeLabel(subtypeId) {
        return SUBTYPE_LABELS[subtypeId] || subtypeId || '';
    }

    // ============================================================
    // FORMAT HELPERS
    // ============================================================

    /**
     * Format a mission ID for display.
     * 
     * @param {string} missionId - Mission ID
     * @returns {string} Formatted mission ID
     */
    function formatMissionId(missionId) {
        if (!missionId) {
            return '—';
        }
        return String(missionId);
    }

    /**
     * Parse a mission ID into components.
     * 
     * @param {string} missionId - Mission ID
     * @returns {object|null} { team, year, difficultyCode, difficulty, sequence, full } or null
     */
    function parseMissionId(missionId) {
        if (!missionId || typeof missionId !== 'string') {
            return null;
        }

        var match = /^([^-]+)-(\d{2})-([EMHX])(\d+)$/.exec(missionId);
        if (!match) {
            return null;
        }

        var difficultyMap = {
            'E': 'easy',
            'M': 'medium',
            'H': 'hard',
            'X': 'expert'
        };

        return {
            team: match[1],
            year: match[2],
            difficultyCode: match[3],
            difficulty: difficultyMap[match[3]] || null,
            sequence: match[4],
            full: missionId
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionViews = {
        // Priority
        getPriorityLabel: getPriorityLabel,
        getPriorityColor: getPriorityColor,
        getPriorityClass: getPriorityClass,
        getPriorityInfo: getPriorityInfo,

        // Status
        getStatusLabel: getStatusLabel,
        getStatusColor: getStatusColor,
        getStatusClass: getStatusClass,
        getStatusInfo: getStatusInfo,

        // Difficulty
        getDifficultyLabel: getDifficultyLabel,
        getDifficultyCode: getDifficultyCode,

        // Escalation
        getEscalationLabel: getEscalationLabel,

        // Billing
        getBillingLabel: getBillingLabel,

        // Mission type
        getMissionTypeLabel: getMissionTypeLabel,
        getMissionTypeIcon: getMissionTypeIcon,
        getMissionTypeColor: getMissionTypeColor,
        getMissionTypeInfo: getMissionTypeInfo,

        // Subtype
        getSubtypeLabel: getSubtypeLabel,

        // Formatting
        formatMissionId: formatMissionId,
        parseMissionId: parseMissionId,

        // Constants (read-only references)
        PRIORITY_LABELS: PRIORITY_LABELS,
        PRIORITY_COLORS: PRIORITY_COLORS,
        PRIORITY_CLASSES: PRIORITY_CLASSES,
        STATUS_LABELS: STATUS_LABELS,
        STATUS_COLORS: STATUS_COLORS,
        STATUS_CLASSES: STATUS_CLASSES,
        DIFFICULTY_LABELS: DIFFICULTY_LABELS,
        ESCALATION_LABELS: ESCALATION_LABELS,
        BILLING_LABELS: BILLING_LABELS,
        MISSION_TYPE_ICONS: MISSION_TYPE_ICONS,
        MISSION_TYPE_COLORS: MISSION_TYPE_COLORS,
        SUBTYPE_LABELS: SUBTYPE_LABELS
    };

})();
