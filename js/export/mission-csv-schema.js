/**
 * js/export/mission-csv-schema.js
 * Canonical Mission CSV schema - single source of truth for all mission CSV operations.
 * 
 * This module defines:
 * - The CSV section header
 * - Column names and order
 * - Field mapping between CSV and mission objects
 * - Parsing logic for CSV rows
 * - Serialization logic for mission objects
 * - Template generation
 * 
 * All mission CSV operations (export, import, template) should use this schema.
 */

(function() {
    'use strict';

    // ============================================================
    // SECTION HEADER
    // ============================================================

    /**
     * The section marker used in CSV files to identify mission data.
     * Must appear on a line by itself before the mission data.
     */
    var SECTION = '# MISSIONS';

    // ============================================================
    // COLUMN DEFINITIONS
    // ============================================================

    /**
     * Canonical column order for mission CSV.
     * This defines the exact order of columns in exported files
     * and the expected order in imported files.
     */
    var COLUMNS = [
        'MissionId',
        'Title',
        'Status',
        'Priority',
        'Difficulty',
        'TeamId',
        'Location',
        'Duration',
        'Pay',
        'Progress',
        'Objectives'
    ];

    /**
     * Map column index to mission field name.
     * Used during import to assign CSV values to mission properties.
     */
    var FIELD_MAP = {
        0: 'id',
        1: 'title',
        2: 'status',
        3: 'priority',
        4: 'difficulty',
        5: 'assignedTeamId',
        6: 'location',
        7: 'duration',
        8: 'pay',
        9: 'progress',
        10: 'objectives'
    };

    /**
     * Required fields for a valid mission row.
     * Used during import validation.
     */
    var REQUIRED_FIELDS = {
        title: { index: 1, label: 'Title' }
    };

    /**
     * Valid status values for missions.
     * Used for enum validation during import.
     */
    var VALID_STATUSES = ['active', 'completed', 'cancelled', 'on_hold', ''];

    /**
     * Valid priority values for missions.
     * Used for enum validation during import.
     */
    var VALID_PRIORITIES = ['low', 'medium', 'high', 'critical', ''];

    /**
     * Valid difficulty values for missions.
     * Used for enum validation during import.
     */
    var VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme', ''];

    // ============================================================
    // PARSING
    // ============================================================

    /**
     * Parse a CSV row into a mission candidate object.
     * 
     * @param {Array} row - CSV row as array of strings
     * @param {Function} warnFn - Optional warning callback (message, fieldName)
     * @returns {Object} { valid: boolean, mission: object|null, errors: string[], warnings: string[] }
     */
    function parseRow(row, warnFn) {
        var errors = [];
        var warnings = [];

        // Validate required fields
        var title = String(row[1] || '').trim();
        if (!title) {
            errors.push('Mission row missing title');
            return { valid: false, mission: null, errors: errors, warnings: warnings };
        }

        // Extract ID - null means "create new"
        var id = String(row[0] || '').trim() || null;

        // Parse status with enum validation
        var status = String(row[2] || '').trim();
        if (status && VALID_STATUSES.indexOf(status) === -1) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid status "' + status + '" - using empty', 'Status');
            }
            status = '';
        }

        // Parse priority with enum validation
        var priority = String(row[3] || '').trim();
        if (priority && VALID_PRIORITIES.indexOf(priority) === -1) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid priority "' + priority + '" - using empty', 'Priority');
            }
            priority = '';
        }

        // Parse difficulty with enum validation
        var difficulty = String(row[4] || '').trim();
        if (difficulty && VALID_DIFFICULTIES.indexOf(difficulty) === -1) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid difficulty "' + difficulty + '" - using empty', 'Difficulty');
            }
            difficulty = '';
        }

        // Parse team ID - null means unassigned
        var teamId = String(row[5] || '').trim() || null;

        // Parse progress as integer
        var progress = parseProgressField(row[9], warnFn);

        // Parse objectives as JSON array
        var objectives = parseJSONField(row[10], [], warnFn, 'Objectives');

        // Build mission candidate
        var mission = {
            // Identity
            id: id,
            title: title,

            // Status and metadata
            status: status,
            priority: priority,
            difficulty: difficulty,

            // Assignment
            assignedTeamId: teamId,

            // Location and logistics
            location: String(row[6] || '').trim(),
            duration: String(row[7] || '').trim(),
            pay: String(row[8] || '').trim(),

            // Progress tracking
            progress: progress,

            // Structured data
            objectives: objectives
        };

        return {
            valid: true,
            mission: mission,
            errors: errors,
            warnings: warnings
        };
    }

    /**
     * Parse the progress field from a CSV cell.
     * Progress should be an integer between 0 and 100.
     * 
     * @param {string} value - Raw cell value
     * @param {Function} warnFn - Warning callback
     * @returns {number} Parsed progress (0-100)
     */
    function parseProgressField(value, warnFn) {
        var str = String(value == null ? '' : value).trim();

        if (str === '') {
            return 0;
        }

        // Check if it's a valid integer
        if (!/^\d+$/.test(str)) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid progress value "' + str + '" - using 0', 'Progress');
            }
            return 0;
        }

        var parsed = parseInt(str, 10);

        if (!Number.isSafeInteger(parsed)) {
            if (typeof warnFn === 'function') {
                warnFn('Progress value "' + str + '" is outside safe range - using 0', 'Progress');
            }
            return 0;
        }

        // Clamp to valid range
        if (parsed < 0) {
            if (typeof warnFn === 'function') {
                warnFn('Progress value "' + str + '" is below 0 - clamping to 0', 'Progress');
            }
            return 0;
        }

        if (parsed > 100) {
            if (typeof warnFn === 'function') {
                warnFn('Progress value "' + str + '" is above 100 - clamping to 100', 'Progress');
            }
            return 100;
        }

        return parsed;
    }

    /**
     * Parse a JSON field from a CSV cell.
     * Returns fallback if the field is empty or invalid.
     * 
     * @param {string} value - Raw cell value
     * @param {*} fallback - Default value if parsing fails
     * @param {Function} warnFn - Warning callback
     * @param {string} fieldName - Name of the field for error messages
     * @returns {*} Parsed value or fallback
     */
    function parseJSONField(value, fallback, warnFn, fieldName) {
        var str = String(value == null ? '' : value).trim();

        if (str === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(str);
            return parsed;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON in "' + fieldName + '": ' + e.message + ' - using fallback', fieldName);
            }
            return fallback;
        }
    }

    /**
     * Parse an objective array from a CSV cell.
     * Validates that each objective has the expected structure.
     * 
     * @param {string} value - Raw cell value
     * @param {Function} warnFn - Warning callback
     * @returns {Array} Parsed objectives
     */
    function parseObjectivesField(value, warnFn) {
        var raw = String(value == null ? '' : value).trim();

        if (raw === '') {
            return [];
        }

        try {
            var parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                if (typeof warnFn === 'function') {
                    warnFn('Objectives must be a JSON array - using empty array', 'Objectives');
                }
                return [];
            }

            // Validate each objective has text and done fields
            var validObjectives = parsed.filter(function(obj, index) {
                if (!obj || typeof obj !== 'object') {
                    if (typeof warnFn === 'function') {
                        warnFn('Objective at index ' + index + ' is not an object - skipping', 'Objectives');
                    }
                    return false;
                }

                if (typeof obj.text !== 'string' || obj.text.trim() === '') {
                    if (typeof warnFn === 'function') {
                        warnFn('Objective at index ' + index + ' has no text - skipping', 'Objectives');
                    }
                    return false;
                }

                return true;
            });

            return validObjectives;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON in Objectives: ' + e.message + ' - using empty array', 'Objectives');
            }
            return [];
        }
    }

    // ============================================================
    // SERIALIZATION
    // ============================================================

    /**
     * Convert a mission object to a CSV row (array of strings).
     * 
     * @param {Object} mission - Mission object
     * @returns {Array} CSV row as array of strings
     */
    function toRow(mission) {
        if (!mission || typeof mission !== 'object') {
            return COLUMNS.map(function() { return ''; });
        }

        // Format objectives for CSV
        var objectives = mission.objectives || [];

        return [
            mission.id ?? '',
            mission.title ?? '',
            mission.status ?? '',
            mission.priority ?? '',
            mission.difficulty ?? '',
            mission.assignedTeamId ?? '',
            mission.location ?? '',
            mission.duration ?? '',
            mission.pay ?? '',
            mission.progress ?? 0,
            JSON.stringify(objectives)
        ];
    }

    /**
     * Convert an array of mission objects to CSV rows.
     * 
     * @param {Array} missions - Array of mission objects
     * @returns {Array} Array of CSV rows (including header)
     */
    function toRows(missions) {
        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }

        var rows = [
            [SECTION],
            COLUMNS.slice() // Copy header array
        ];

        missions.forEach(function(mission) {
            rows.push(toRow(mission));
        });

        return rows;
    }

    /**
     * Get the CSV header row.
     * 
     * @returns {Array} Header row as array of strings
     */
    function getHeader() {
        return COLUMNS.slice();
    }

    // ============================================================
    // TEMPLATE
    // ============================================================

    /**
     * Generate example/template rows for the CSV template.
     * 
     * @returns {Array} Template rows (including section and header)
     */
    function getTemplateRows() {
        return [
            [SECTION],
            COLUMNS.slice(),
            [
                '',                                     // MissionId
                'Operation Nightfall',                  // Title
                'active',                               // Status
                'high',                                 // Priority
                'hard',                                 // Difficulty
                '',                                     // TeamId
                'Berlin',                               // Location
                '2 weeks',                              // Duration
                '5000',                                 // Pay
                '50',                                   // Progress
                '[{"text":"Infiltrate base","done":true},{"text":"Retrieve documents","done":true}]' // Objectives
            ],
            [
                '',                                     // MissionId
                'Rescue Mission',                       // Title
                'active',                               // Status
                'medium',                               // Priority
                'medium',                               // Difficulty
                '',                                     // TeamId
                'London',                               // Location
                '3 days',                               // Duration
                '2000',                                 // Pay
                '0',                                    // Progress
                '[{"text":"Find hostages","done":false},{"text":"Extract safely","done":false}]' // Objectives
            ]
        ];
    }

    /**
     * Get example mission template as an array of mission objects.
     * Useful for testing or seeding.
     * 
     * @returns {Array} Template mission objects
     */
    function getTemplateMissions() {
        return [
            {
                id: null,
                title: 'Operation Nightfall',
                status: 'active',
                priority: 'high',
                difficulty: 'hard',
                assignedTeamId: null,
                location: 'Berlin',
                duration: '2 weeks',
                pay: '5000',
                progress: 50,
                objectives: [
                    { text: 'Infiltrate base', done: true },
                    { text: 'Retrieve documents', done: true }
                ]
            },
            {
                id: null,
                title: 'Rescue Mission',
                status: 'active',
                priority: 'medium',
                difficulty: 'medium',
                assignedTeamId: null,
                location: 'London',
                duration: '3 days',
                pay: '2000',
                progress: 0,
                objectives: [
                    { text: 'Find hostages', done: false },
                    { text: 'Extract safely', done: false }
                ]
            }
        ];
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    /**
     * Check if a mission candidate is complete enough for import.
     * 
     * @param {Object} candidate - Mission candidate from parseRow
     * @returns {boolean} True if valid
     */
    function isValidCandidate(candidate) {
        if (!candidate || typeof candidate !== 'object') return false;
        var title = candidate.title || '';
        return title.trim().length > 0;
    }

    /**
     * Get a list of all column names.
     * 
     * @returns {Array} Column names
     */
    function getColumns() {
        return COLUMNS.slice();
    }

    /**
     * Get the column index for a given field name.
     * 
     * @param {string} fieldName - Mission field name
     * @returns {number|null} Column index or null if not found
     */
    function getColumnIndex(fieldName) {
        for (var key in FIELD_MAP) {
            if (FIELD_MAP.hasOwnProperty(key) && FIELD_MAP[key] === fieldName) {
                return parseInt(key, 10);
            }
        }
        return null;
    }

    /**
     * Get the mission field name for a given column index.
     * 
     * @param {number} index - Column index
     * @returns {string|null} Field name or null if not found
     */
    function getFieldName(index) {
        return FIELD_MAP[index] || null;
    }

    /**
     * Get valid status values.
     * 
     * @returns {Array} Valid status strings
     */
    function getValidStatuses() {
        return VALID_STATUSES.slice();
    }

    /**
     * Get valid priority values.
     * 
     * @returns {Array} Valid priority strings
     */
    function getValidPriorities() {
        return VALID_PRIORITIES.slice();
    }

    /**
     * Get valid difficulty values.
     * 
     * @returns {Array} Valid difficulty strings
     */
    function getValidDifficulties() {
        return VALID_DIFFICULTIES.slice();
    }

    /**
     * Validate a status value.
     * 
     * @param {string} value - Status to validate
     * @returns {boolean} True if valid
     */
    function isValidStatus(value) {
        return VALID_STATUSES.indexOf(value) !== -1;
    }

    /**
     * Validate a priority value.
     * 
     * @param {string} value - Priority to validate
     * @returns {boolean} True if valid
     */
    function isValidPriority(value) {
        return VALID_PRIORITIES.indexOf(value) !== -1;
    }

    /**
     * Validate a difficulty value.
     * 
     * @param {string} value - Difficulty to validate
     * @returns {boolean} True if valid
     */
    function isValidDifficulty(value) {
        return VALID_DIFFICULTIES.indexOf(value) !== -1;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionCSVSchema = {
        // Constants
        SECTION: SECTION,
        COLUMNS: COLUMNS,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PRIORITIES: VALID_PRIORITIES,
        VALID_DIFFICULTIES: VALID_DIFFICULTIES,

        // Parsing
        parseRow: parseRow,
        parseProgressField: parseProgressField,
        parseJSONField: parseJSONField,
        parseObjectivesField: parseObjectivesField,

        // Serialization
        toRow: toRow,
        toRows: toRows,
        getHeader: getHeader,

        // Template
        getTemplateRows: getTemplateRows,
        getTemplateMissions: getTemplateMissions,

        // Validation helpers
        isValidCandidate: isValidCandidate,
        getColumns: getColumns,
        getColumnIndex: getColumnIndex,
        getFieldName: getFieldName,
        getValidStatuses: getValidStatuses,
        getValidPriorities: getValidPriorities,
        getValidDifficulties: getValidDifficulties,
        isValidStatus: isValidStatus,
        isValidPriority: isValidPriority,
        isValidDifficulty: isValidDifficulty
    };

})();
