/**
 * js/modules/missions/mission-id.js - Mission ID Generation
 * Single source of truth for mission ID generation and parsing
 * Path: js/modules/missions/mission-id.js
 * 
 * This module handles:
 *   - Mission ID generation (format: YYYY-SEQ-DIFFICULTY)
 *   - Mission ID parsing
 *   - Mission ID validation
 *   - Next sequence number calculation
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for mission IDs
 *   - ID format: YYYY-SEQ-DIFFICULTY (e.g., 2026-005-E)
 *   - Sequence numbers are per year and difficulty level
 *   - Difficulty codes: E (Easy), M (Medium), H (Hard), X (Extreme)
 *   - This module does NOT call saveData() - callers own persistence
 *   - Uses MissionsQueries for read-only access to existing missions
 *   - If MissionsQueries is not available, uses window.data directly
 * 
 * DEPENDENCIES:
 *   - window.MissionsQueries (from missions-queries.js) - OPTIONAL (with fallback)
 *   - window.TeamQueries (from team-queries.js) - OPTIONAL (with fallback)
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var missionId = window.MissionId.generate('team_123', 2026, 'E');
 *   var parsed = window.MissionId.parse('2026-005-E');
 *   var valid = window.MissionId.validate('2026-005-E');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__missionIdLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - Partial (with fallbacks)
    // ============================================================

    if (!window.CalendarConstants) {
        throw new Error('[MissionId] CalendarConstants is required.');
    }

    var CalendarConstants = window.CalendarConstants;
    var MissionsQueries = window.MissionsQueries;
    var TeamQueries = window.TeamQueries;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DIFFICULTY_CODES = {
        easy: 'E',
        medium: 'M',
        hard: 'H',
        extreme: 'X'
    };

    var DIFFICULTY_NAMES = {
        E: 'Easy',
        M: 'Medium',
        H: 'Hard',
        X: 'Extreme'
    };

    var MIN_YEAR = 1900;
    var MAX_YEAR = 2100;

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getYear() {
        return new Date().getFullYear();
    }

    function getDifficultyCode(difficulty) {
        if (!difficulty) {
            return 'M';
        }
        var code = DIFFICULTY_CODES[difficulty.toLowerCase()];
        return code || 'M';
    }

    function getDifficultyName(code) {
        return DIFFICULTY_NAMES[code] || 'Medium';
    }

    function padNumber(num, length) {
        return String(num).padStart(length, '0');
    }

    // ============================================================
    // GET EXISTING MISSION IDS (with fallback)
    // ============================================================

    function getExistingMissionIds() {
        var ids = [];

        // Try MissionsQueries first
        if (MissionsQueries && typeof MissionsQueries.getMissions === 'function') {
            try {
                var missions = MissionsQueries.getMissions();
                if (Array.isArray(missions)) {
                    for (var i = 0; i < missions.length; i++) {
                        if (missions[i] && missions[i].id) {
                            ids.push(missions[i].id);
                        }
                        if (missions[i] && missions[i].missionId) {
                            ids.push(missions[i].missionId);
                        }
                    }
                }
                return ids;
            } catch (e) {
                // Fall through to window.data
            }
        }

        // Fallback to window.data
        if (window.data && window.data.missions && Array.isArray(window.data.missions)) {
            var missions = window.data.missions;
            for (var i = 0; i < missions.length; i++) {
                if (missions[i] && missions[i].id) {
                    ids.push(missions[i].id);
                }
                if (missions[i] && missions[i].missionId) {
                    ids.push(missions[i].missionId);
                }
            }
        }

        return ids;
    }

    // ============================================================
    // TEAM LOOKUP (with fallback)
    // ============================================================

    function getTeamName(teamId) {
        // Try TeamQueries first
        if (TeamQueries && typeof TeamQueries.getTeamById === 'function') {
            try {
                var team = TeamQueries.getTeamById(teamId);
                if (team) {
                    return team.name || 'Team ' + teamId;
                }
            } catch (e) {
                // Fall through
            }
        }

        // Fallback to window.data
        if (window.data && window.data.teams && Array.isArray(window.data.teams)) {
            var teams = window.data.teams;
            for (var i = 0; i < teams.length; i++) {
                if (String(teams[i].id) === String(teamId)) {
                    return teams[i].name || 'Team ' + teamId;
                }
            }
        }

        return 'Team ' + teamId;
    }

    // ============================================================
    // GENERATE MISSION ID
    // ============================================================

    /**
     * Generate a new mission ID.
     * Format: YYYY-SEQ-DIFFICULTY
     * 
     * @param {string} teamId - Team ID (used for preview, not in ID)
     * @param {number} year - Year (default: current year)
     * @param {string} difficulty - Difficulty level (easy, medium, hard, extreme)
     * @param {Array} existingIds - Optional array of existing IDs (if not provided, will be fetched)
     * @returns {string} Mission ID
     */
    function generate(teamId, year, difficulty, existingIds) {
        // Validate year
        var targetYear = year || getYear();
        if (typeof targetYear !== 'number' || targetYear < MIN_YEAR || targetYear > MAX_YEAR) {
            targetYear = getYear();
        }

        // Validate difficulty
        var diffCode = getDifficultyCode(difficulty);

        // Get existing IDs
        var ids = existingIds || getExistingMissionIds();

        // Filter to IDs matching year and difficulty
        var prefix = String(targetYear) + '-';
        var suffix = '-' + diffCode;

        var seqNumbers = [];

        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (typeof id !== 'string') {
                continue;
            }

            // Check if ID matches year and difficulty format
            if (id.startsWith(prefix) && id.endsWith(suffix)) {
                var middle = id.substring(prefix.length, id.length - suffix.length);
                var seqNum = parseInt(middle, 10);
                if (!isNaN(seqNum) && seqNum > 0) {
                    seqNumbers.push(seqNum);
                }
            }
        }

        // Find next sequence number
        var nextSeq = 1;
        if (seqNumbers.length > 0) {
            seqNumbers.sort(function(a, b) { return a - b; });
            for (var i = 0; i < seqNumbers.length; i++) {
                if (seqNumbers[i] === nextSeq) {
                    nextSeq++;
                } else if (seqNumbers[i] > nextSeq) {
                    break;
                }
            }
        }

        var seqStr = padNumber(nextSeq, 3);
        return String(targetYear) + '-' + seqStr + '-' + diffCode;
    }

    /**
     * Generate a preview of the next mission ID.
     * Useful for showing the user what ID will be generated.
     * 
     * @param {string} teamId - Team ID (used for preview, not in ID)
     * @param {number} year - Year (default: current year)
     * @param {string} difficulty - Difficulty level (easy, medium, hard, extreme)
     * @param {number} sequence - Optional sequence number override
     * @returns {string} Mission ID preview
     */
    function generatePreview(teamId, year, difficulty, sequence) {
        var targetYear = year || getYear();
        if (typeof targetYear !== 'number' || targetYear < MIN_YEAR || targetYear > MAX_YEAR) {
            targetYear = getYear();
        }

        var diffCode = getDifficultyCode(difficulty);
        var seqNum = sequence || 1;
        var ids = getExistingMissionIds();

        // Filter to IDs matching year and difficulty
        var prefix = String(targetYear) + '-';
        var suffix = '-' + diffCode;

        var seqNumbers = [];

        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (typeof id !== 'string') {
                continue;
            }

            if (id.startsWith(prefix) && id.endsWith(suffix)) {
                var middle = id.substring(prefix.length, id.length - suffix.length);
                var seq = parseInt(middle, 10);
                if (!isNaN(seq) && seq > 0) {
                    seqNumbers.push(seq);
                }
            }
        }

        if (seqNumbers.length > 0) {
            seqNumbers.sort(function(a, b) { return a - b; });
            var nextSeq = 1;
            for (var i = 0; i < seqNumbers.length; i++) {
                if (seqNumbers[i] === nextSeq) {
                    nextSeq++;
                } else if (seqNumbers[i] > nextSeq) {
                    break;
                }
            }
            seqNum = nextSeq;
        }

        var seqStr = padNumber(seqNum, 3);
        return String(targetYear) + '-' + seqStr + '-' + diffCode;
    }

    // ============================================================
    // PARSE MISSION ID
    // ============================================================

    /**
     * Parse a mission ID into its components.
     * 
     * @param {string} missionId - Mission ID to parse
     * @returns {object|null} { year, sequence, difficulty, difficultyName } or null
     */
    function parse(missionId) {
        if (!isNonEmptyString(missionId)) {
            return null;
        }

        var trimmed = missionId.trim();

        // Format: YYYY-SEQ-DIFFICULTY
        var parts = trimmed.split('-');
        if (parts.length !== 3) {
            return null;
        }

        var year = parseInt(parts[0], 10);
        if (isNaN(year) || year < MIN_YEAR || year > MAX_YEAR) {
            return null;
        }

        var seq = parseInt(parts[1], 10);
        if (isNaN(seq) || seq < 1) {
            return null;
        }

        var difficulty = parts[2];
        if (!DIFFICULTY_NAMES[difficulty]) {
            return null;
        }

        return {
            year: year,
            sequence: seq,
            difficulty: difficulty,
            difficultyName: DIFFICULTY_NAMES[difficulty]
        };
    }

    // ============================================================
    // VALIDATE MISSION ID
    // ============================================================

    /**
     * Validate a mission ID format.
     * 
     * @param {string} missionId - Mission ID to validate
     * @returns {boolean} True if valid
     */
    function validate(missionId) {
        return parse(missionId) !== null;
    }

    /**
     * Validate and get detailed information about a mission ID.
     * 
     * @param {string} missionId - Mission ID to validate
     * @returns {object} { valid: boolean, parsed: object|null, message: string }
     */
    function validateDetailed(missionId) {
        if (!isNonEmptyString(missionId)) {
            return { valid: false, parsed: null, message: 'Mission ID is empty.' };
        }

        var parsed = parse(missionId);
        if (!parsed) {
            return { valid: false, parsed: null, message: 'Invalid mission ID format. Expected: YYYY-SEQ-DIFFICULTY' };
        }

        return { valid: true, parsed: parsed, message: 'Valid mission ID.' };
    }

    // ============================================================
    // FORMAT FUNCTIONS
    // ============================================================

    /**
     * Format a mission ID for display.
     * 
     * @param {string} missionId - Mission ID to format
     * @param {string} teamId - Team ID for additional context
     * @returns {string} Formatted mission ID
     */
    function format(missionId, teamId) {
        if (!isNonEmptyString(missionId)) {
            return '';
        }

        var parsed = parse(missionId);
        if (!parsed) {
            return missionId;
        }

        var result = parsed.year + '-' + padNumber(parsed.sequence, 3) + '-' + parsed.difficulty;

        if (teamId) {
            var teamName = getTeamName(teamId);
            result += ' (' + teamName + ')';
        }

        return result;
    }

    /**
     * Get the team ID from a mission ID.
     * Note: Mission ID does not contain team ID, this is a lookup function.
     * 
     * @param {string} missionId - Mission ID
     * @param {Array} missions - Optional array of missions to search
     * @returns {string|null} Team ID or null
     */
    function getMissionIdTeam(missionId, missions) {
        var missionData = missions || (window.data && window.data.missions ? window.data.missions : []);

        for (var i = 0; i < missionData.length; i++) {
            var m = missionData[i];
            if (m && (String(m.id) === String(missionId) || String(m.missionId) === String(missionId))) {
                return m.assignedTeamId || null;
            }
        }

        return null;
    }

    /**
     * Get the year from a mission ID.
     * 
     * @param {string} missionId - Mission ID
     * @returns {number|null} Year or null
     */
    function getMissionIdYear(missionId) {
        var parsed = parse(missionId);
        return parsed ? parsed.year : null;
    }

    /**
     * Get the difficulty from a mission ID.
     * 
     * @param {string} missionId - Mission ID
     * @returns {string|null} Difficulty code or null
     */
    function getMissionIdDifficulty(missionId) {
        var parsed = parse(missionId);
        return parsed ? parsed.difficulty : null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionId = {
        // Generation
        generate: generate,
        generatePreview: generatePreview,

        // Parsing
        parse: parse,

        // Validation
        validate: validate,
        validateDetailed: validateDetailed,

        // Formatting
        format: format,
        getMissionIdTeam: getMissionIdTeam,
        getMissionIdYear: getMissionIdYear,
        getMissionIdDifficulty: getMissionIdDifficulty,

        // Constants
        DIFFICULTY_CODES: DIFFICULTY_CODES,
        DIFFICULTY_NAMES: DIFFICULTY_NAMES,
        MIN_YEAR: MIN_YEAR,
        MAX_YEAR: MAX_YEAR
    };

    window.__missionIdLoaded = true;

})();
