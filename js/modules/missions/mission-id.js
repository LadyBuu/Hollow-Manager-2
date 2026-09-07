/**
 * js/modules/missions/mission-id.js - Mission ID
 * Mission ID generation and parsing
 * Path: js/modules/missions/mission-id.js
 * 
 * This module provides:
 *   - generateMissionId - Generate a human-readable mission ID
 *   - formatMissionId - Format a mission ID for display
 *   - parseMissionId - Parse a mission ID into components
 *   - validateMissionIdFormat - Validate mission ID format
 * 
 * IMPORTANT:
 *   - Mission ID format: {teamAbbr}-{YY}-{difficultyCode}{sequence}
 *   - Example: ABC-25-M001
 *   - sequence is stateful (scans existing missions for next number)
 *   - generateMissionId is the ONLY way to create new mission IDs
 *   - parseMissionId is the ONLY way to interpret mission IDs
 *   - No persistence, no DOM, no UI state
 *   - Uses TeamQueries for team name resolution
 *   - Uses MissionsQueries for existing ID scanning
 *   - PURE functions except for generateMissionId (which scans existing IDs)
 * 
 * DEPENDENCIES:
 *   - window.TeamQueries (required)
 *   - window.MissionsQueries (required)
 *   - window.CalendarConstants (required - for year range)
 *   - window.MissionsSchema (required - for difficulty codes)
 * 
 * USAGE:
 *   var MissionId = window.MissionId;
 *   var id = MissionId.generateMissionId(teamId, year, difficulty);
 *   var parts = MissionId.parseMissionId('ABC-25-M001');
 *   var display = MissionId.formatMissionId('ABC-25-M001');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__missionIdLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.TeamQueries || typeof window.TeamQueries.getTeamById !== 'function') {
        missing.push('TeamQueries.getTeamById');
    }

    if (!window.MissionsQueries || typeof window.MissionsQueries.getMissions !== 'function') {
        missing.push('MissionsQueries.getMissions');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.MissionsSchema) {
        missing.push('MissionsSchema');
    }

    if (missing.length > 0) {
        throw new Error('[MissionId] Missing dependencies: ' + missing.join(', '));
    }

    window.__missionIdLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var MissionsQueries = window.MissionsQueries;
    var CalendarConstants = window.CalendarConstants;
    var Schema = window.MissionsSchema;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_YEAR = CalendarConstants.MIN_YEAR || 1900;
    var MAX_YEAR = CalendarConstants.MAX_YEAR || 2100;
    var DIFFICULTY_CODES = Schema.DIFFICULTY_CODES;

    // ============================================================
    // HELPERS
    // ============================================================

    function normaliseId(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (typeof value === 'object') {
            return null;
        }
        var normalised = String(value).trim();
        return normalised !== '' ? normalised : null;
    }

    function getTeamAbbreviation(teamId) {
        if (!teamId) {
            return 'UNS';
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return 'UNS';
        }

        var teamName = typeof team.name === 'string' ? team.name.trim() : '';
        if (!teamName) {
            return 'UNS';
        }

        var nameParts = teamName.split(' ');
        var abbr;

        if (nameParts.length === 1) {
            abbr = nameParts[0].substring(0, 3).toUpperCase();
        } else {
            var abbrParts = [];
            for (var p = 0; p < nameParts.length; p++) {
                abbrParts.push(nameParts[p].charAt(0).toUpperCase());
            }
            abbr = abbrParts.join('');
        }

        if (abbr.length < 2) {
            abbr = abbr.padEnd(2, 'X');
        }

        return abbr;
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function getExistingMissionIds() {
        var missions = MissionsQueries.getMissions('all');
        var ids = [];
        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m.missionId && typeof m.missionId === 'string') {
                ids.push(m.missionId);
            }
        }
        return ids;
    }

    function findNextSequence(prefix, existingIds) {
        var regex = new RegExp('^' + escapeRegExp(prefix) + '(\\d{3})$');
        var maxSeq = 0;

        for (var i = 0; i < existingIds.length; i++) {
            var id = existingIds[i];
            var match = regex.exec(id);
            if (match) {
                var num = parseInt(match[1], 10);
                if (!isNaN(num) && num > maxSeq) {
                    maxSeq = num;
                }
            }
        }

        return maxSeq + 1;
    }

    function isValidYear(year) {
        var num = Number(year);
        return Number.isInteger(num) && num >= MIN_YEAR && num <= MAX_YEAR;
    }

    function isValidDifficulty(difficulty) {
        return difficulty && DIFFICULTY_CODES[difficulty] !== undefined;
    }

    function getDifficultyCode(difficulty) {
        return DIFFICULTY_CODES[difficulty] || 'M';
    }

    // ============================================================
    // MISSION ID GENERATION
    // ============================================================

    /**
     * Generate a human-readable mission ID.
     * Format: {teamAbbr}-{YY}-{difficultyCode}{sequence}
     * Example: ABC-25-M001
     * 
     * @param {string} teamId - Team ID
     * @param {number|string} year - Year (YYYY)
     * @param {string} difficulty - Difficulty value
     * @param {array} existingIds - Optional array of existing mission IDs
     * @returns {string} Generated mission ID
     */
    function generateMissionId(teamId, year, difficulty, existingIds) {
        // Validate inputs
        if (!isValidYear(year)) {
            year = new Date().getFullYear();
        }

        if (!isValidDifficulty(difficulty)) {
            difficulty = 'medium';
        }

        // Get team abbreviation
        var teamAbbr = getTeamAbbreviation(teamId);

        // Get year (last two digits)
        var yearStr = String(year).slice(-2);

        // Get difficulty code
        var difficultyCode = getDifficultyCode(difficulty);

        // Build prefix
        var prefix = teamAbbr + '-' + yearStr + '-' + difficultyCode;

        // Get existing IDs if not provided
        if (!Array.isArray(existingIds)) {
            existingIds = getExistingMissionIds();
        }

        // Find next sequence
        var sequence = findNextSequence(prefix, existingIds);

        return prefix + String(sequence).padStart(3, '0');
    }

    /**
     * Generate a mission ID preview without scanning existing missions.
     * Useful for form previews.
     * 
     * @param {string} teamId - Team ID
     * @param {number|string} year - Year (YYYY)
     * @param {string} difficulty - Difficulty value
     * @param {number} sequence - Sequence number (default: 1)
     * @returns {string} Preview mission ID
     */
    function generateMissionIdPreview(teamId, year, difficulty, sequence) {
        if (!isValidYear(year)) {
            year = new Date().getFullYear();
        }

        if (!isValidDifficulty(difficulty)) {
            difficulty = 'medium';
        }

        var teamAbbr = getTeamAbbreviation(teamId);
        var yearStr = String(year).slice(-2);
        var difficultyCode = getDifficultyCode(difficulty);
        var seq = Number.isInteger(sequence) && sequence >= 1 ? sequence : 1;

        return teamAbbr + '-' + yearStr + '-' + difficultyCode + String(seq).padStart(3, '0');
    }

    // ============================================================
    // MISSION ID PARSING
    // ============================================================

    /**
     * Parse a mission ID into components.
     * Returns null for invalid format.
     * 
     * @param {string} missionId - Mission ID
     * @returns {object|null} { team, year, difficultyCode, difficulty, sequence, full } or null
     */
    function parseMissionId(missionId) {
        if (!missionId || typeof missionId !== 'string') {
            return null;
        }

        var match = /^([A-Z]{2,4})-(\d{2})-([EMHX])(\d{3})$/.exec(missionId);
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
            sequence: parseInt(match[4], 10),
            full: missionId
        };
    }

    /**
     * Validate a mission ID format.
     * Returns true if the format is valid.
     * 
     * @param {string} missionId - Mission ID
     * @returns {boolean} True if format is valid
     */
    function validateMissionIdFormat(missionId) {
        return parseMissionId(missionId) !== null;
    }

    // ============================================================
    // MISSION ID FORMATTING
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
     * Get a display-friendly version of a mission ID.
     * 
     * @param {string} missionId - Mission ID
     * @returns {string} Display-friendly mission ID
     */
    function displayMissionId(missionId) {
        if (!missionId) {
            return '—';
        }

        var parsed = parseMissionId(missionId);
        if (!parsed) {
            return String(missionId);
        }

        return parsed.team + '-' + parsed.year + '-' + parsed.difficultyCode + parsed.sequence;
    }

    // ============================================================
    // MISSION ID COMPONENTS
    // ============================================================

    /**
     * Extract the team abbreviation from a mission ID.
     * 
     * @param {string} missionId - Mission ID
     * @returns {string|null} Team abbreviation or null
     */
    function getMissionIdTeam(missionId) {
        var parsed = parseMissionId(missionId);
        return parsed ? parsed.team : null;
    }

    /**
     * Extract the year from a mission ID.
     * 
     * @param {string} missionId - Mission ID
     * @returns {string|null} Year (two digits) or null
     */
    function getMissionIdYear(missionId) {
        var parsed = parseMissionId(missionId);
        return parsed ? parsed.year : null;
    }

    /**
     * Extract the difficulty from a mission ID.
     * 
     * @param {string} missionId - Mission ID
     * @returns {string|null} Difficulty value or null
     */
    function getMissionIdDifficulty(missionId) {
        var parsed = parseMissionId(missionId);
        return parsed ? parsed.difficulty : null;
    }

    /**
     * Extract the difficulty code from a mission ID.
     * 
     * @param {string} missionId - Mission ID
     * @returns {string|null} Difficulty code or null
     */
    function getMissionIdDifficultyCode(missionId) {
        var parsed = parseMissionId(missionId);
        return parsed ? parsed.difficultyCode : null;
    }

    /**
     * Extract the sequence number from a mission ID.
     * 
     * @param {string} missionId - Mission ID
     * @returns {number|null} Sequence number or null
     */
    function getMissionIdSequence(missionId) {
        var parsed = parseMissionId(missionId);
        return parsed ? parsed.sequence : null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionId = {
        // Generation
        generateMissionId: generateMissionId,
        generateMissionIdPreview: generateMissionIdPreview,

        // Parsing
        parseMissionId: parseMissionId,
        validateMissionIdFormat: validateMissionIdFormat,

        // Formatting
        formatMissionId: formatMissionId,
        displayMissionId: displayMissionId,

        // Component extraction
        getMissionIdTeam: getMissionIdTeam,
        getMissionIdYear: getMissionIdYear,
        getMissionIdDifficulty: getMissionIdDifficulty,
        getMissionIdDifficultyCode: getMissionIdDifficultyCode,
        getMissionIdSequence: getMissionIdSequence,

        // Helpers
        getTeamAbbreviation: getTeamAbbreviation,
        findNextSequence: findNextSequence,

        // Constants
        DIFFICULTY_CODES: DIFFICULTY_CODES
    };

})();
