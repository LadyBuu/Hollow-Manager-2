/**
 * js/modules/missions/mission-rules.js - Mission Rules
 * Single source of truth for mission derivation and lifecycle rules
 * Path: js/modules/missions/mission-rules.js
 * 
 * This module provides:
 *   - Progress calculation from objectives
 *   - Pay calculation from basePay + surchargePay
 *   - Status derivation (auto-completion)
 *   - CompletedAt timestamp rules
 *   - Objective mutability checks
 *   - Auto-completion predicates
 *   - Mission eligibility rules
 * 
 * IMPORTANT:
 *   - PURE functions - no side effects, no mutations
 *   - No persistence, no DOM, no state
 *   - Consumes MissionsSchema for validation
 *   - Domain logic only - no presentation
 *   - All functions are deterministic
 *   - No fallbacks - uses canonical values
 * 
 * DEPENDENCIES:
 *   - window.MissionsSchema (required)
 *   - window.CalendarValidation (required) - for date validation if needed
 * 
 * USAGE:
 *   var Rules = window.MissionRules;
 *   var progress = Rules.calculateProgress(objectives);
 *   var pay = Rules.calculatePay(basePay, surchargePay);
 *   var status = Rules.deriveStatus(originalStatus, progress, objectives);
 *   var canModify = Rules.canModifyObjectives(mission);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__missionRulesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.MissionsSchema) {
        throw new Error('[MissionRules] MissionsSchema is required.');
    }

    window.__missionRulesLoaded = true;

    var Schema = window.MissionsSchema;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_STATUSES = Schema.VALID_STATUSES;

    // ============================================================
    // PROGRESS CALCULATION
    // ============================================================

    /**
     * Calculate progress percentage from objectives.
     * 
     * @param {array} objectives - Array of objective objects
     * @returns {number} Progress percentage (0-100)
     */
    function calculateProgress(objectives) {
        if (!Array.isArray(objectives) || objectives.length === 0) {
            return 0;
        }

        var completed = 0;
        for (var i = 0; i < objectives.length; i++) {
            var objective = objectives[i];
            if (objective && objective.done) {
                completed++;
            }
        }

        return Math.round((completed / objectives.length) * 100);
    }

    // ============================================================
    // PAY CALCULATION
    // ============================================================

    /**
     * Parse a pay value from string or number.
     * Returns null for invalid values.
     * 
     * @param {*} value - Pay value to parse
     * @returns {number|null} Parsed number or null
     */
    function parsePayValue(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        var text = String(value).trim();
        var match = text.match(/^-?\d+(?:\.\d+)?$/);

        if (!match) {
            return null;
        }

        var num = Number(text);
        return Number.isFinite(num) ? num : null;
    }

    /**
     * Calculate total pay from base pay and surcharge pay.
     * 
     * @param {*} basePay - Base pay value
     * @param {*} surchargePay - Surcharge pay value
     * @returns {string} Formatted pay string or empty string
     */
    function calculatePay(basePay, surchargePay) {
        var baseNum = parsePayValue(basePay);
        var surchargeNum = parsePayValue(surchargePay);

        // Negative pay is rejected
        if (baseNum !== null && baseNum < 0) {
            return '';
        }
        if (surchargeNum !== null && surchargeNum < 0) {
            return '';
        }

        if (baseNum !== null && surchargeNum !== null) {
            return (baseNum + surchargeNum).toFixed(2) + ' credits';
        }

        if (baseNum !== null) {
            return baseNum.toFixed(2) + ' credits';
        }

        if (surchargeNum !== null) {
            return surchargeNum.toFixed(2) + ' credits';
        }

        return '';
    }

    /**
     * Calculate pay as a number (for comparisons).
     * 
     * @param {*} basePay - Base pay value
     * @param {*} surchargePay - Surcharge pay value
     * @returns {number|null} Total pay as number or null
     */
    function calculatePayNumber(basePay, surchargePay) {
        var baseNum = parsePayValue(basePay);
        var surchargeNum = parsePayValue(surchargePay);

        if (baseNum !== null && surchargeNum !== null) {
            return baseNum + surchargeNum;
        }

        if (baseNum !== null) {
            return baseNum;
        }

        if (surchargeNum !== null) {
            return surchargeNum;
        }

        return null;
    }

    // ============================================================
    // STATUS DERIVATION
    // ============================================================

    /**
     * Derive the appropriate status based on progress and current status.
     * 
     * @param {string} originalStatus - Current status
     * @param {number} progress - Progress percentage (0-100)
     * @param {array} objectives - Array of objective objects
     * @returns {string} Derived status
     */
    function deriveStatus(originalStatus, progress, objectives) {
        // If already completed or cancelled, preserve unless explicitly changed
        if (originalStatus === 'completed' || originalStatus === 'cancelled') {
            return originalStatus;
        }

        // Auto-complete if progress is 100%
        if (progress === 100) {
            return 'completed';
        }

        // Otherwise keep active
        return 'active';
    }

    /**
     * Check if a mission should auto-complete.
     * 
     * @param {object} mission - Mission object
     * @returns {boolean} True if mission should auto-complete
     */
    function shouldAutoComplete(mission) {
        if (!mission || typeof mission !== 'object') {
            return false;
        }

        if (mission.status === 'completed' || mission.status === 'cancelled') {
            return false;
        }

        var progress = mission.progress !== undefined ? mission.progress : calculateProgress(mission.objectives);
        return progress === 100;
    }

    // ============================================================
    // COMPLETED AT RULES
    // ============================================================

    /**
     * Determine the appropriate completedAt value based on status transition.
     * 
     * @param {string} originalStatus - Current status
     * @param {string} proposedStatus - Proposed status
     * @param {string|null} originalCompletedAt - Current completedAt value
     * @param {number} progress - Current progress (0-100)
     * @param {string} policy - 'first' or 'current' (default: 'current')
     * @returns {string|null} Appropriate completedAt value
     */
    function deriveCompletedAt(originalStatus, proposedStatus, originalCompletedAt, progress, policy) {
        policy = policy || 'current';

        // If becoming completed
        if (proposedStatus === 'completed' && originalStatus !== 'completed') {
            return new Date().toISOString();
        }

        // If leaving completed
        if (proposedStatus !== 'completed' && originalStatus === 'completed') {
            if (policy === 'first') {
                return originalCompletedAt || null;
            }
            return null;
        }

        // If auto-completing via progress
        if (progress === 100 && originalStatus !== 'completed' && proposedStatus !== 'cancelled') {
            return new Date().toISOString();
        }

        // Preserve existing
        return originalCompletedAt || null;
    }

    /**
     * Check if a status transition is valid.
     * 
     * @param {string} fromStatus - Current status
     * @param {string} toStatus - Proposed status
     * @returns {boolean} True if transition is valid
     */
    function isValidStatusTransition(fromStatus, toStatus) {
        if (fromStatus === toStatus) {
            return true;
        }

        if (fromStatus === 'completed' && toStatus === 'active') {
            return true;
        }

        if (fromStatus === 'completed' && toStatus === 'cancelled') {
            return true;
        }

        if (fromStatus === 'active' && toStatus === 'completed') {
            return true;
        }

        if (fromStatus === 'active' && toStatus === 'cancelled') {
            return true;
        }

        if (fromStatus === 'cancelled' && toStatus === 'active') {
            return true;
        }

        return false;
    }

    // ============================================================
    // OBJECTIVE MUTABILITY
    // ============================================================

    /**
     * Check if objectives can be modified for a mission.
     * 
     * @param {object} mission - Mission object
     * @returns {boolean} True if objectives can be modified
     */
    function canModifyObjectives(mission) {
        if (!mission || typeof mission !== 'object') {
            return false;
        }

        return mission.status !== 'completed' && mission.status !== 'cancelled';
    }

    /**
     * Check if objectives can be modified given statuses.
     * 
     * @param {string} originalStatus - Current status
     * @param {string} proposedStatus - Proposed status
     * @param {boolean} hasObjectiveUpdate - Whether objectives are being updated
     * @returns {boolean} True if objectives can be modified
     */
    function canModifyObjectivesWithTransition(originalStatus, proposedStatus, hasObjectiveUpdate) {
        if (!hasObjectiveUpdate) {
            return true;
        }

        if (originalStatus === 'completed' || originalStatus === 'cancelled') {
            return false;
        }

        if (proposedStatus === 'completed' || proposedStatus === 'cancelled') {
            return false;
        }

        return true;
    }

    // ============================================================
    // MISSION ELIGIBILITY RULES
    // ============================================================

    /**
     * Check if a team is eligible for mission assignment.
     * 
     * @param {object} team - Team object
     * @returns {boolean} True if team is eligible
     */
    function isTeamEligibleForMission(team) {
        if (!team || typeof team !== 'object') {
            return false;
        }

        // Only Professional and Temporary teams can be assigned missions
        if (team.type !== 'professional' && team.type !== 'temporary') {
            return false;
        }

        // Team must be active
        if (team.status !== 'active') {
            return false;
        }

        return true;
    }

    /**
     * Filter teams to only those eligible for mission assignment.
     * 
     * @param {array} teams - Array of team objects
     * @returns {array} Filtered array of eligible teams
     */
    function filterEligibleTeams(teams) {
        if (!Array.isArray(teams)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < teams.length; i++) {
            if (isTeamEligibleForMission(teams[i])) {
                result.push(teams[i]);
            }
        }
        return result;
    }

    // ============================================================
    // MISSION DERIVATION - Complete state recalculation
    // ============================================================

    /**
     * Recalculate all derived fields for a mission.
     * Pure function - returns a new mission object with derived fields updated.
     * 
     * @param {object} mission - Mission object
     * @param {string} completedAtPolicy - 'first' or 'current' (default: 'current')
     * @returns {object} Mission with derived fields recalculated
     */
    function recalculateMission(mission, completedAtPolicy) {
        completedAtPolicy = completedAtPolicy || 'current';

        if (!mission || typeof mission !== 'object') {
            return mission;
        }

        var result = Object.assign({}, mission);

        // Recalculate progress from objectives
        result.progress = calculateProgress(result.objectives);

        // Recalculate pay from basePay and surchargePay
        result.pay = calculatePay(result.basePay, result.surchargePay);

        // Derive status from progress
        var derivedStatus = deriveStatus(result.status, result.progress, result.objectives);

        // Update completedAt if status changed
        if (derivedStatus !== result.status) {
            result.completedAt = deriveCompletedAt(
                result.status,
                derivedStatus,
                result.completedAt,
                result.progress,
                completedAtPolicy
            );
            result.status = derivedStatus;
        }

        return result;
    }

    /**
     * Get the valid status transitions for a given status.
     * 
     * @param {string} status - Current status
     * @returns {array} Array of valid target statuses
     */
    function getValidTransitions(status) {
        var allStatuses = VALID_STATUSES.slice();
        var result = [];

        for (var i = 0; i < allStatuses.length; i++) {
            if (isValidStatusTransition(status, allStatuses[i])) {
                result.push(allStatuses[i]);
            }
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionRules = {
        // Progress
        calculateProgress: calculateProgress,

        // Pay
        parsePayValue: parsePayValue,
        calculatePay: calculatePay,
        calculatePayNumber: calculatePayNumber,

        // Status
        deriveStatus: deriveStatus,
        shouldAutoComplete: shouldAutoComplete,

        // CompletedAt
        deriveCompletedAt: deriveCompletedAt,

        // Transitions
        isValidStatusTransition: isValidStatusTransition,
        getValidTransitions: getValidTransitions,

        // Objectives
        canModifyObjectives: canModifyObjectives,
        canModifyObjectivesWithTransition: canModifyObjectivesWithTransition,

        // Eligibility
        isTeamEligibleForMission: isTeamEligibleForMission,
        filterEligibleTeams: filterEligibleTeams,

        // Complete recalculation
        recalculateMission: recalculateMission
    };

})();
