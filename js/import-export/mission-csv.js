/**
 * js/import-export/csv/mission-csv.js - Mission CSV
 * Canonical source for all mission CSV operations
 * 
 * This module consolidates:
 *   - Mission CSV schema (column definitions, field mapping)
 *   - Mission CSV export (serialization)
 *   - Mission CSV import (parsing)
 *   - Mission CSV template generation
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for mission CSV
 *   - All mission CSV operations use this module
 *   - PURE functions - no side effects, no mutations
 *   - No persistence, no DOM, no state
 *   - Import returns candidates (does NOT mutate)
 *   - Export is read-only (does NOT access window.data directly)
 * 
 * DEPENDENCIES:
 *   - window.CSV (from csv-parser.js) - MANDATORY
 *   - window.ImportResult (from import-result.js) - MANDATORY
 *   - window.ExportUtils (from export-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var MissionCSV = window.MissionCSV;
 *   
 *   // Export
 *   var result = MissionCSV.export(missions);
 *   // or
 *   var result = MissionCSV.exportFromData();
 *   
 *   // Import
 *   var result = MissionCSV.import(csvText);
 *   var candidates = result.getValid();
 *   
 *   // Template
 *   var result = MissionCSV.exportTemplate();
 *   var content = MissionCSV.getTemplateContent();
 */

(function() {
    'use strict';

    if (window.__missionCSVLoaded) return;
    window.__missionCSVLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.CSV || typeof window.CSV.parse !== 'function') {
        throw new Error('[MissionCSV] CSV parser is required.');
    }
    if (!window.ImportResult || typeof window.ImportResult !== 'function') {
        throw new Error('[MissionCSV] ImportResult is required.');
    }
    if (!window.ExportUtils || typeof window.ExportUtils.downloadBlob !== 'function') {
        throw new Error('[MissionCSV] ExportUtils is required.');
    }
    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        throw new Error('[MissionCSV] IdUtils is required.');
    }

    var CSV = window.CSV;
    var ImportResult = window.ImportResult;
    var ExportUtils = window.ExportUtils;
    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var SECTION = '# MISSIONS';
    var MAX_ROWS = 10000;

    var VALID_STATUSES = ['active', 'completed', 'cancelled', 'on_hold', ''];
    var VALID_PRIORITIES = ['low', 'medium', 'high', 'critical', ''];
    var VALID_DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme', ''];

    // ============================================================
    // COLUMN DEFINITIONS
    // ============================================================

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

    // ============================================================
    // SCHEMA HELPERS
    // ============================================================

    function getColumns() {
        return COLUMNS.slice();
    }

    function getHeader() {
        return COLUMNS.slice();
    }

    function getColumnIndex(fieldName) {
        for (var key in FIELD_MAP) {
            if (FIELD_MAP.hasOwnProperty(key) && FIELD_MAP[key] === fieldName) {
                return parseInt(key, 10);
            }
        }
        return null;
    }

    function getFieldName(index) {
        return FIELD_MAP[index] || null;
    }

    function getSection() {
        return SECTION;
    }

    function getValidStatuses() {
        return VALID_STATUSES.slice();
    }

    function getValidPriorities() {
        return VALID_PRIORITIES.slice();
    }

    function getValidDifficulties() {
        return VALID_DIFFICULTIES.slice();
    }

    function isValidStatus(value) {
        return VALID_STATUSES.indexOf(value) !== -1;
    }

    function isValidPriority(value) {
        return VALID_PRIORITIES.indexOf(value) !== -1;
    }

    function isValidDifficulty(value) {
        return VALID_DIFFICULTIES.indexOf(value) !== -1;
    }

    // ============================================================
    // PARSING HELPERS
    // ============================================================

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

    function parseProgressField(value, warnFn) {
        var str = String(value == null ? '' : value).trim();

        if (str === '') {
            return 0;
        }

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

            var validObjectives = [];
            for (var i = 0; i < parsed.length; i++) {
                var obj = parsed[i];
                if (!obj || typeof obj !== 'object') {
                    if (typeof warnFn === 'function') {
                        warnFn('Objective at index ' + i + ' is not an object - skipping', 'Objectives');
                    }
                    continue;
                }

                if (typeof obj.text !== 'string' || obj.text.trim() === '') {
                    if (typeof warnFn === 'function') {
                        warnFn('Objective at index ' + i + ' has no text - skipping', 'Objectives');
                    }
                    continue;
                }

                validObjectives.push(obj);
            }

            return validObjectives;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON in Objectives: ' + e.message + ' - using empty array', 'Objectives');
            }
            return [];
        }
    }

    function isValidCandidate(candidate) {
        if (!candidate || typeof candidate !== 'object') return false;
        var title = candidate.title || '';
        return title.trim().length > 0;
    }

    function isBlankRow(row) {
        if (!row || row.length === 0) {
            return true;
        }
        for (var i = 0; i < row.length; i++) {
            var cell = String(row[i] == null ? '' : row[i]).trim();
            if (cell !== '') {
                return false;
            }
        }
        return true;
    }

    // ============================================================
    // ROW PARSING
    // ============================================================

    /**
     * Parse a CSV row into a mission candidate object.
     * 
     * @param {Array} row - CSV row as array of strings
     * @param {Function} warnFn - Optional warning callback
     * @returns {Object} { valid: boolean, mission: object|null, errors: string[], warnings: string[] }
     */
    function parseRow(row, warnFn) {
        var errors = [];
        var warnings = [];

        var title = String(row[1] || '').trim();
        if (!title) {
            errors.push('Mission row missing title');
            return { valid: false, mission: null, errors: errors, warnings: warnings };
        }

        var id = String(row[0] || '').trim() || null;

        var status = String(row[2] || '').trim();
        if (status && VALID_STATUSES.indexOf(status) === -1) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid status "' + status + '" - using empty', 'Status');
            }
            status = '';
        }

        var priority = String(row[3] || '').trim();
        if (priority && VALID_PRIORITIES.indexOf(priority) === -1) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid priority "' + priority + '" - using empty', 'Priority');
            }
            priority = '';
        }

        var difficulty = String(row[4] || '').trim();
        if (difficulty && VALID_DIFFICULTIES.indexOf(difficulty) === -1) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid difficulty "' + difficulty + '" - using empty', 'Difficulty');
            }
            difficulty = '';
        }

        var teamId = String(row[5] || '').trim() || null;
        var progress = parseProgressField(row[9], warnFn);
        var objectives = parseObjectivesField(row[10], warnFn);

        var mission = {
            id: id,
            title: title,
            status: status,
            priority: priority,
            difficulty: difficulty,
            assignedTeamId: teamId,
            location: String(row[6] || '').trim(),
            duration: String(row[7] || '').trim(),
            pay: String(row[8] || '').trim(),
            progress: progress,
            objectives: objectives
        };

        return {
            valid: true,
            mission: mission,
            errors: errors,
            warnings: warnings
        };
    }

    // ============================================================
    // ROW SERIALIZATION
    // ============================================================

    /**
     * Convert a mission object to a CSV row.
     * 
     * @param {Object} mission - Mission object
     * @returns {Array} CSV row as array of strings
     */
    function toRow(mission) {
        if (!mission || typeof mission !== 'object') {
            return COLUMNS.map(function() { return ''; });
        }

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
            JSON.stringify(mission.objectives || [])
        ];
    }

    /**
     * Convert an array of mission objects to CSV rows.
     * 
     * @param {Array} missions - Array of mission objects
     * @returns {Array} Array of CSV rows (including section and header)
     */
    function toRows(missions) {
        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }

        var rows = [
            [SECTION],
            COLUMNS.slice()
        ];

        for (var i = 0; i < missions.length; i++) {
            rows.push(toRow(missions[i]));
        }

        return rows;
    }

    // ============================================================
    // EXPORT
    // ============================================================

    /**
     * Export missions to CSV and download.
     * 
     * @param {Array} missions - Array of mission objects
     * @param {Object} options - Export options
     * @param {string} options.filename - Custom filename
     * @returns {Object} { count: number, filename: string }
     */
    function exportMissions(missions, options) {
        options = options || {};

        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }

        var rows = toRows(missions);
        var csvContent = CSV.arrayToCSV(rows);

        var blob = new Blob(['\uFEFF' + csvContent], {
            type: 'text/csv;charset=utf-8;'
        });

        var filename = options.filename ||
            'missions-' + new Date().toISOString().slice(0, 10) + '.csv';

        ExportUtils.downloadBlob(blob, filename);

        return {
            count: missions.length,
            filename: filename
        };
    }

    /**
     * Export missions from the current application data.
     * 
     * @param {Object} options - Export options
     * @returns {Object} { count: number, filename: string, message: string|null }
     */
    function exportFromData(options) {
        options = options || {};

        if (!window.MissionQueries || typeof window.MissionQueries.getMissions !== 'function') {
            throw new Error('MissionQueries not available.');
        }

        var missions = window.MissionQueries.getMissions();

        if (missions.length === 0) {
            return {
                count: 0,
                filename: null,
                message: 'No missions to export.'
            };
        }

        var result = exportMissions(missions, options);
        result.message = 'Exported ' + result.count + ' missions';
        return result;
    }

    /**
     * Get CSV content as a string without downloading.
     * 
     * @param {Array} missions - Array of mission objects
     * @returns {string} CSV content
     */
    function getCSVContent(missions) {
        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }

        var rows = toRows(missions);
        return CSV.arrayToCSV(rows);
    }

    // ============================================================
    // IMPORT
    // ============================================================

    /**
     * Extract mission rows from CSV records.
     * 
     * @param {Array} records - All CSV records
     * @returns {Array} Array of mission data rows
     */
    function extractRows(records) {
        var rows = [];
        var inSection = false;

        for (var i = 0; i < records.length; i++) {
            var row = records[i];

            if (isBlankRow(row)) {
                continue;
            }

            var first = String(row[0] || '').trim();

            if (first === SECTION) {
                inSection = true;
                continue;
            }

            if (inSection && first.startsWith('#')) {
                break;
            }

            if (inSection && first === 'MissionId') {
                continue;
            }

            if (inSection) {
                if (row.length > 0 && String(row[0] || '').trim()) {
                    rows.push(row);
                }
            }
        }

        return rows;
    }

    /**
     * Parse CSV text into mission candidates.
     * 
     * @param {string} csvText - CSV file content
     * @param {Object} options - Import options
     * @param {boolean} options.strict - Reject rows with errors (default: false)
     * @param {boolean} options.validateEnums - Validate enum values (default: true)
     * @param {number} options.maxRows - Maximum rows to parse (default: 10000)
     * @returns {ImportResult} ImportResult with valid candidates, errors, warnings
     */
    function importMissions(csvText, options) {
        options = options || {};
        var strict = options.strict === true;
        var validateEnums = options.validateEnums !== false;
        var maxRows = options.maxRows || MAX_ROWS;

        var result = new ImportResult();

        // Parse CSV
        var records;
        try {
            records = CSV.parse(csvText);
        } catch (e) {
            result.addError('Failed to parse CSV: ' + e.message);
            return result;
        }

        if (records.length === 0) {
            result.addWarning('CSV file is empty');
            return result;
        }

        // Extract mission rows
        var missionRows = extractRows(records);
        if (missionRows.length === 0) {
            result.addError('No mission data found. Expected "' + SECTION + '" section.');
            return result;
        }

        if (missionRows.length > maxRows) {
            result.addError('Too many rows (' + missionRows.length + '). Maximum is ' + maxRows + '.');
            return result;
        }

        // Parse each row
        for (var i = 0; i < missionRows.length; i++) {
            var row = missionRows[i];
            var rowNumber = i + 1;

            if (isBlankRow(row)) {
                continue;
            }

            var parsed = parseRow(row, function(warning, fieldName) {
                var msg = warning;
                if (fieldName) {
                    msg = fieldName + ': ' + warning;
                }
                result.addWarning(msg, { row: rowNumber, field: fieldName });
            });

            if (parsed.valid) {
                var mission = parsed.mission;
                var hasError = false;

                // Additional enum validation if requested
                if (validateEnums) {
                    if (mission.status && !isValidStatus(mission.status)) {
                        result.addError(
                            'Invalid status "' + mission.status + '". Allowed: ' +
                            VALID_STATUSES.filter(function(s) { return s !== ''; }).join(', '),
                            { row: rowNumber, field: 'Status' }
                        );
                        hasError = true;
                    }

                    if (mission.priority && !isValidPriority(mission.priority)) {
                        result.addError(
                            'Invalid priority "' + mission.priority + '". Allowed: ' +
                            VALID_PRIORITIES.filter(function(p) { return p !== ''; }).join(', '),
                            { row: rowNumber, field: 'Priority' }
                        );
                        hasError = true;
                    }

                    if (mission.difficulty && !isValidDifficulty(mission.difficulty)) {
                        result.addError(
                            'Invalid difficulty "' + mission.difficulty + '". Allowed: ' +
                            VALID_DIFFICULTIES.filter(function(d) { return d !== ''; }).join(', '),
                            { row: rowNumber, field: 'Difficulty' }
                        );
                        hasError = true;
                    }

                    // Validate progress range
                    if (typeof mission.progress === 'number') {
                        if (mission.progress < 0 || mission.progress > 100) {
                            result.addWarning(
                                'Progress must be between 0 and 100 - got ' + mission.progress,
                                { row: rowNumber, field: 'Progress' }
                            );
                        }
                    }

                    // Validate objectives structure
                    if (Array.isArray(mission.objectives)) {
                        for (var j = 0; j < mission.objectives.length; j++) {
                            var obj = mission.objectives[j];
                            if (!obj || typeof obj !== 'object') {
                                result.addWarning(
                                    'Objective at index ' + j + ' is not an object',
                                    { row: rowNumber, field: 'Objectives' }
                                );
                            } else if (!obj.text || typeof obj.text !== 'string') {
                                result.addWarning(
                                    'Objective at index ' + j + ' has no text',
                                    { row: rowNumber, field: 'Objectives' }
                                );
                            }
                        }
                    }
                }

                if (strict && hasError) {
                    result.addSkipped(mission, 'Row had errors', { row: rowNumber });
                    continue;
                }

                if (isValidCandidate(mission)) {
                    result.addValid(mission, { row: rowNumber });
                } else {
                    result.addError('Invalid mission data (missing title)', { row: rowNumber });
                }
            }

            for (var k = 0; k < parsed.errors.length; k++) {
                result.addError(parsed.errors[k], { row: rowNumber });
            }
        }

        // Filter in strict mode
        if (strict) {
            var filteredValid = [];
            var validItems = result.getValid(true);
            for (var m = 0; m < validItems.length; m++) {
                var item = validItems[m];
                var rowNum = item.metadata && item.metadata.row;
                if (rowNum) {
                    var rowErrors = result.getErrorsForRow(rowNum);
                    if (rowErrors.length === 0) {
                        filteredValid.push(item);
                    } else {
                        result.addSkipped(item.record, 'Row had errors', { row: rowNum });
                    }
                } else {
                    filteredValid.push(item);
                }
            }
            result._valid = filteredValid;
        }

        return result;
    }

    /**
     * Parse a mission CSV file from a File object.
     * 
     * @param {File} file - CSV file
     * @param {Object} options - Import options
     * @returns {Promise<ImportResult>} Promise resolving to ImportResult
     */
    function importFromFile(file, options) {
        options = options || {};

        return new Promise(function(resolve, reject) {
            var reader = new FileReader();

            reader.onload = function(e) {
                try {
                    var result = importMissions(e.target.result, options);
                    resolve(result);
                } catch (err) {
                    reject(new Error('Failed to import missions: ' + err.message));
                }
            };

            reader.onerror = function() {
                reject(new Error('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error')));
            };

            reader.readAsText(file);
        });
    }

    // ============================================================
    // TEMPLATE
    // ============================================================

    /**
     * Get template missions as objects.
     * 
     * @param {Object} options - Template options
     * @param {number} options.count - Number of examples (default: 2)
     * @param {boolean} options.includeAllStatuses - Include all statuses (default: false)
     * @returns {Array} Array of mission objects
     */
    function getTemplateMissions(options) {
        options = options || {};
        var count = options.count || 2;

        var templates = [
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

        var result = templates.slice(0, count);

        // If includeAllStatuses, generate more examples
        if (options.includeAllStatuses) {
            var allExamples = [];
            var statuses = ['active', 'completed', 'cancelled', 'on_hold'];
            for (var i = 0; i < Math.min(statuses.length, count); i++) {
                var base = templates[i % templates.length];
                if (base) {
                    var copy = JSON.parse(JSON.stringify(base));
                    copy.status = statuses[i];
                    copy.title = statuses[i].charAt(0).toUpperCase() + statuses[i].slice(1) + ' Mission';
                    copy.progress = statuses[i] === 'completed' ? 100 :
                                    statuses[i] === 'cancelled' ? 0 :
                                    Math.floor(Math.random() * 80) + 10;
                    allExamples.push(copy);
                }
            }
            return allExamples;
        }

        return result;
    }

    /**
     * Generate comprehensive template rows with all variations.
     * 
     * @param {Object} options - Template options
     * @param {boolean} options.includeAllStatuses - Include all statuses
     * @param {boolean} options.includeAllPriorities - Include all priorities
     * @param {boolean} options.includeAllDifficulties - Include all difficulties
     * @param {number} options.maxExamples - Maximum examples (default: 20)
     * @returns {Array} Array of CSV rows
     */
    function getComprehensiveTemplateRows(options) {
        options = options || {};
        var maxExamples = options.maxExamples || 20;

        var rows = [
            [SECTION],
            COLUMNS.slice()
        ];

        var statuses = options.includeAllStatuses ?
            ['active', 'completed', 'cancelled', 'on_hold'] :
            ['active'];

        var priorities = options.includeAllPriorities ?
            ['low', 'medium', 'high', 'critical'] :
            ['medium'];

        var difficulties = options.includeAllDifficulties ?
            ['easy', 'medium', 'hard', 'extreme'] :
            ['medium'];

        var exampleCount = 0;

        for (var s = 0; s < Math.min(statuses.length, 4) && exampleCount < maxExamples; s++) {
            for (var p = 0; p < Math.min(priorities.length, 4) && exampleCount < maxExamples; p++) {
                for (var d = 0; d < Math.min(difficulties.length, 4) && exampleCount < maxExamples; d++) {
                    var status = statuses[s];
                    var priority = priorities[p];
                    var difficulty = difficulties[d];

                    var title = status.charAt(0).toUpperCase() + status.slice(1) + ' ' +
                                priority.charAt(0).toUpperCase() + priority.slice(1) + ' ' +
                                difficulty.charAt(0).toUpperCase() + difficulty.slice(1) + ' Mission';

                    var progress = status === 'completed' ? '100' :
                                   status === 'cancelled' ? '0' :
                                   String(Math.floor(Math.random() * 80) + 10);

                    var objectives = status === 'completed' ?
                        '[{"text":"Primary objective","done":true},{"text":"Secondary objective","done":true}]' :
                        '[{"text":"Primary objective","done":false},{"text":"Secondary objective","done":false}]';

                    rows.push([
                        '',
                        title,
                        status,
                        priority,
                        difficulty,
                        '',
                        'Location ' + (exampleCount + 1),
                        (Math.floor(Math.random() * 4) + 1) + ' weeks',
                        String((Math.floor(Math.random() * 8) + 2) * 1000),
                        progress,
                        objectives
                    ]);

                    exampleCount++;
                }
            }
        }

        return rows;
    }

    /**
     * Get template rows as an array.
     * 
     * @param {Object} options - Template options
     * @param {Array} options.exampleData - Custom example data
     * @param {number} options.exampleCount - Number of examples (default: 2)
     * @param {boolean} options.comprehensive - Include all enum variations (default: false)
     * @returns {Array} Array of CSV rows
     */
    function getTemplateRows(options) {
        options = options || {};

        if (options.comprehensive) {
            return getComprehensiveTemplateRows(options);
        }

        var missions;
        if (options.exampleData && Array.isArray(options.exampleData)) {
            missions = options.exampleData;
        } else {
            missions = getTemplateMissions({ count: options.exampleCount || 2 });
        }

        return toRows(missions);
    }

    /**
     * Get template CSV content as a string.
     * 
     * @param {Object} options - Template options
     * @returns {string} CSV content
     */
    function getTemplateContent(options) {
        var rows = getTemplateRows(options);
        return CSV.arrayToCSV(rows);
    }

    /**
     * Export mission CSV template.
     * 
     * @param {Object} options - Template options
     * @param {string} options.filename - Custom filename
     * @param {Array} options.exampleData - Custom example data
     * @param {boolean} options.comprehensive - Include all enum variations
     * @returns {Object} { exported: boolean, filename: string }
     */
    function exportTemplate(options) {
        options = options || {};

        var content = getTemplateContent(options);

        var blob = new Blob(['\uFEFF' + content], {
            type: 'text/csv;charset=utf-8;'
        });

        var filename = options.filename || 'missions-template.csv';
        ExportUtils.downloadBlob(blob, filename);

        return {
            exported: true,
            filename: filename
        };
    }

    /**
     * Get template preview for display.
     * 
     * @param {Object} options - Template options
     * @param {number} options.previewRows - Number of example rows to show (default: 2)
     * @returns {Object} { headers: Array, examples: Array, columnDescriptions: Object }
     */
    function getTemplatePreview(options) {
        options = options || {};
        var previewRows = options.previewRows || 2;

        var rows = getTemplateRows(options);
        var headers = rows.length > 1 ? rows[1] : [];
        var examples = [];

        for (var i = 2; i < Math.min(rows.length, 2 + previewRows); i++) {
            examples.push(rows[i]);
        }

        return {
            headers: headers,
            examples: examples,
            columnDescriptions: getColumnDescriptions(),
            allowedValues: {
                Status: VALID_STATUSES.filter(function(s) { return s !== ''; }),
                Priority: VALID_PRIORITIES.filter(function(p) { return p !== ''; }),
                Difficulty: VALID_DIFFICULTIES.filter(function(d) { return d !== ''; })
            }
        };
    }

    /**
     * Get column descriptions for UI help.
     * 
     * @returns {Object} Map of column name to description
     */
    function getColumnDescriptions() {
        return {
            'MissionId': 'Leave blank to create a new mission, or provide an existing ID to update',
            'Title': 'Required. The mission name',
            'Status': 'Optional. One of: active, completed, cancelled, on_hold',
            'Priority': 'Optional. One of: low, medium, high, critical',
            'Difficulty': 'Optional. One of: easy, medium, hard, extreme',
            'TeamId': 'Optional. ID of the team assigned to this mission',
            'Location': 'Optional. Mission location',
            'Duration': 'Optional. Mission duration (e.g., 2 weeks, 3 days)',
            'Pay': 'Optional. Mission payment (e.g., 5000)',
            'Progress': 'Optional. Number between 0 and 100',
            'Objectives': 'Optional. JSON array of objectives: [{"text":"...","done":true/false}]'
        };
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    /**
     * Validate mission candidates against the schema.
     * 
     * @param {Array} candidates - Mission candidates
     * @param {Object} options - Validation options
     * @param {boolean} options.validateEnums - Validate enum values (default: true)
     * @returns {Object} { valid: Array, invalid: Array, warnings: Array }
     */
    function validateCandidates(candidates, options) {
        options = options || {};
        var validateEnums = options.validateEnums !== false;

        if (!Array.isArray(candidates)) {
            throw new TypeError('Candidates must be an array.');
        }

        var valid = [];
        var invalid = [];
        var warnings = [];

        for (var i = 0; i < candidates.length; i++) {
            var candidate = candidates[i];

            if (!isValidCandidate(candidate)) {
                invalid.push({
                    index: i,
                    candidate: candidate,
                    reason: 'Missing required field: title'
                });
                continue;
            }

            if (validateEnums) {
                if (candidate.status && !isValidStatus(candidate.status)) {
                    warnings.push({
                        index: i,
                        candidate: candidate,
                        field: 'status',
                        value: candidate.status,
                        message: 'Invalid status "' + candidate.status + '"'
                    });
                }

                if (candidate.priority && !isValidPriority(candidate.priority)) {
                    warnings.push({
                        index: i,
                        candidate: candidate,
                        field: 'priority',
                        value: candidate.priority,
                        message: 'Invalid priority "' + candidate.priority + '"'
                    });
                }

                if (candidate.difficulty && !isValidDifficulty(candidate.difficulty)) {
                    warnings.push({
                        index: i,
                        candidate: candidate,
                        field: 'difficulty',
                        value: candidate.difficulty,
                        message: 'Invalid difficulty "' + candidate.difficulty + '"'
                    });
                }

                if (typeof candidate.progress === 'number' && (candidate.progress < 0 || candidate.progress > 100)) {
                    warnings.push({
                        index: i,
                        candidate: candidate,
                        field: 'progress',
                        value: candidate.progress,
                        message: 'Progress must be between 0 and 100'
                    });
                }

                if (Array.isArray(candidate.objectives)) {
                    for (var j = 0; j < candidate.objectives.length; j++) {
                        var obj = candidate.objectives[j];
                        if (!obj || typeof obj !== 'object') {
                            warnings.push({
                                index: i,
                                candidate: candidate,
                                field: 'objectives',
                                value: obj,
                                message: 'Objective at index ' + j + ' is not an object'
                            });
                        } else if (!obj.text || typeof obj.text !== 'string') {
                            warnings.push({
                                index: i,
                                candidate: candidate,
                                field: 'objectives',
                                value: obj,
                                message: 'Objective at index ' + j + ' has no text'
                            });
                        }
                    }
                }
            }

            valid.push(candidate);
        }

        return { valid: valid, invalid: invalid, warnings: warnings };
    }

    /**
     * Get a preview of the import result.
     * 
     * @param {ImportResult} result - Import result
     * @param {number} limit - Number of records to preview (default: 5)
     * @returns {Object} { preview: Array, total: number, hasMore: boolean }
     */
    function getImportPreview(result, limit) {
        limit = limit || 5;

        if (!(result instanceof ImportResult)) {
            throw new TypeError('Result must be an ImportResult');
        }

        var valid = result.getValid();
        var preview = valid.slice(0, limit);

        return {
            preview: preview,
            total: valid.length,
            hasMore: valid.length > limit
        };
    }

    /**
     * Get a summary of the import result for display.
     * 
     * @param {ImportResult} result - Import result
     * @returns {Object} Formatted summary
     */
    function getImportSummary(result) {
        if (!(result instanceof ImportResult)) {
            throw new TypeError('Result must be an ImportResult');
        }

        var summary = result.getSummary();

        var messages = [];
        if (summary.valid > 0) {
            messages.push(summary.valid + ' mission(s) ready to import');
        }
        if (summary.errors > 0) {
            messages.push(summary.errors + ' error(s) found');
        }
        if (summary.warnings > 0) {
            messages.push(summary.warnings + ' warning(s) found');
        }

        return {
            total: summary.total,
            valid: summary.valid,
            errors: summary.errors,
            warnings: summary.warnings,
            added: summary.added,
            updated: summary.updated,
            skipped: summary.skipped,
            hasErrors: summary.hasErrors,
            hasWarnings: summary.hasWarnings,
            message: messages.join(', ') || 'No missions found'
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionCSV = {
        // ---- Constants ----
        SECTION: SECTION,
        COLUMNS: COLUMNS,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PRIORITIES: VALID_PRIORITIES,
        VALID_DIFFICULTIES: VALID_DIFFICULTIES,

        // ---- Schema helpers ----
        getColumns: getColumns,
        getHeader: getHeader,
        getColumnIndex: getColumnIndex,
        getFieldName: getFieldName,
        getSection: getSection,
        getValidStatuses: getValidStatuses,
        getValidPriorities: getValidPriorities,
        getValidDifficulties: getValidDifficulties,
        isValidStatus: isValidStatus,
        isValidPriority: isValidPriority,
        isValidDifficulty: isValidDifficulty,

        // ---- Parsing ----
        parseRow: parseRow,
        parseProgressField: parseProgressField,
        parseJSONField: parseJSONField,
        parseObjectivesField: parseObjectivesField,
        isValidCandidate: isValidCandidate,
        extractRows: extractRows,

        // ---- Serialization ----
        toRow: toRow,
        toRows: toRows,

        // ---- Export ----
        export: exportMissions,
        exportFromData: exportFromData,
        getCSVContent: getCSVContent,

        // ---- Import ----
        import: importMissions,
        importFromFile: importFromFile,

        // ---- Template ----
        getTemplateMissions: getTemplateMissions,
        getTemplateRows: getTemplateRows,
        getTemplateContent: getTemplateContent,
        exportTemplate: exportTemplate,
        getTemplatePreview: getTemplatePreview,
        getColumnDescriptions: getColumnDescriptions,
        getComprehensiveTemplateRows: getComprehensiveTemplateRows,

        // ---- Validation ----
        validateCandidates: validateCandidates,
        getImportPreview: getImportPreview,
        getImportSummary: getImportSummary
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionCSV;
        var missing = [];

        var required = [
            'export', 'exportFromData', 'getCSVContent',
            'import', 'importFromFile',
            'exportTemplate', 'getTemplateContent', 'getTemplateRows', 'getTemplatePreview',
            'validateCandidates', 'getImportPreview', 'getImportSummary',
            'parseRow', 'toRow', 'toRows',
            'getColumns', 'getHeader', 'getSection',
            'getValidStatuses', 'getValidPriorities', 'getValidDifficulties',
            'isValidStatus', 'isValidPriority', 'isValidDifficulty'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[MissionCSV] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[MissionCSV] All exports verified successfully.');
        }
    })();

})();
