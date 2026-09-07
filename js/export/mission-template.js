/**
 * js/export/mission-template.js - Mission CSV Template
 * Generates a template CSV file for mission imports.
 * 
 * This module uses the canonical MissionCSVSchema to generate
 * template rows with example data.
 * 
 * It does NOT:
 * - Access window.data
 * - Call saveData()
 * - Show alerts or confirmations
 * - Log activity
 * - Render UI
 * - Mutate any state
 * 
 * Usage:
 *   // Download template
 *   var result = exportMissionTemplate();
 *   // result: { exported: true, filename: string }
 * 
 *   // Or get template content without downloading
 *   var csvContent = getMissionTemplateContent();
 */

(function() {
    'use strict';

    // ============================================================
    // Dependencies
    // ============================================================

    var parser = window.CSV;
    var schema = window.MissionCSVSchema;
    var fileUtils = window.FileUtils || window.ExportUtils;

    // Validate dependencies
    if (!parser || typeof parser.arrayToCSV !== 'function') {
        throw new Error('MissionTemplate: CSV parser not available');
    }
    if (!schema || typeof schema.getTemplateRows !== 'function') {
        throw new Error('MissionTemplate: MissionCSVSchema not available');
    }
    if (!fileUtils || typeof fileUtils.downloadBlob !== 'function') {
        throw new Error('MissionTemplate: FileUtils not available');
    }

    // ============================================================
    // Template Functions
    // ============================================================

    /**
     * Generate and download a mission CSV template.
     * 
     * @param {Object} options - Template options
     * @param {string} options.filename - Custom filename (optional)
     * @param {Array} options.exampleData - Custom example data (optional)
     * @param {boolean} options.includeAllStatuses - Include examples for all statuses (default: false)
     * @param {boolean} options.includeAllPriorities - Include examples for all priorities (default: false)
     * @param {boolean} options.includeAllDifficulties - Include examples for all difficulties (default: false)
     * @returns {Object} { exported: boolean, filename: string }
     */
    function exportMissionTemplate(options) {
        options = options || {};

        // Get template rows
        var rows;
        if (options.exampleData && Array.isArray(options.exampleData)) {
            // Use custom example data
            rows = schema.toRows(options.exampleData);
            // Ensure section header and column header are present
            if (rows.length < 2 || rows[0][0] !== schema.SECTION) {
                var headerRows = [
                    [schema.SECTION],
                    schema.getHeader()
                ];
                rows = headerRows.concat(rows.slice(1));
            }
        } else if (options.includeAllStatuses || options.includeAllPriorities || options.includeAllDifficulties) {
            // Generate comprehensive template with all variations
            rows = getComprehensiveTemplateRows(options);
        } else {
            // Use default template
            rows = schema.getTemplateRows();
        }

        var csvContent = parser.arrayToCSV(rows);

        // Create blob with BOM for Excel compatibility
        var blob = new Blob(['\uFEFF' + csvContent], {
            type: 'text/csv;charset=utf-8;'
        });

        // Generate filename
        var filename = options.filename || 'missions-template.csv';

        // Download
        fileUtils.downloadBlob(blob, filename);

        return {
            exported: true,
            filename: filename
        };
    }

    /**
     * Generate comprehensive template rows with all status/priority/difficulty variations.
     * 
     * @param {Object} options - Template options
     * @param {boolean} options.includeAllStatuses - Include all statuses
     * @param {boolean} options.includeAllPriorities - Include all priorities
     * @param {boolean} options.includeAllDifficulties - Include all difficulties
     * @returns {Array} Array of CSV rows
     */
    function getComprehensiveTemplateRows(options) {
        options = options || {};

        var rows = [
            [schema.SECTION],
            schema.getHeader()
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

        // Generate example combinations
        for (var s = 0; s < Math.min(statuses.length, 3); s++) {
            for (var p = 0; p < Math.min(priorities.length, 3); p++) {
                for (var d = 0; d < Math.min(difficulties.length, 3); d++) {
                    if (exampleCount >= 20) break; // Limit to 20 examples

                    var status = statuses[s];
                    var priority = priorities[p];
                    var difficulty = difficulties[d];

                    var title = status.charAt(0).toUpperCase() + status.slice(1) + ' ' +
                                priority.charAt(0).toUpperCase() + priority.slice(1) + ' ' +
                                difficulty.charAt(0).toUpperCase() + difficulty.slice(1) + ' Mission';

                    var progress = status === 'completed' ? '100' : 
                                   status === 'cancelled' ? '0' : 
                                   Math.floor(Math.random() * 80) + 10;

                    var objectives = status === 'completed' ? 
                        '[{"text":"Primary objective","done":true},{"text":"Secondary objective","done":true}]' :
                        '[{"text":"Primary objective","done":false},{"text":"Secondary objective","done":false}]';

                    rows.push([
                        '',                                     // MissionId
                        title,                                  // Title
                        status,                                 // Status
                        priority,                               // Priority
                        difficulty,                             // Difficulty
                        '',                                     // TeamId
                        'Location ' + (exampleCount + 1),       // Location
                        (Math.floor(Math.random() * 4) + 1) + ' weeks', // Duration
                        (Math.floor(Math.random() * 8) + 2) * 1000, // Pay
                        progress,                               // Progress
                        objectives                              // Objectives
                    ]);

                    exampleCount++;
                }
            }
        }

        return rows;
    }

    /**
     * Get template CSV content as a string without downloading.
     * Useful for testing or preview.
     * 
     * @param {Object} options - Template options
     * @param {Array} options.exampleData - Custom example data (optional)
     * @returns {string} CSV content
     */
    function getMissionTemplateContent(options) {
        options = options || {};

        var rows;
        if (options.exampleData && Array.isArray(options.exampleData)) {
            rows = schema.toRows(options.exampleData);
            if (rows.length < 2 || rows[0][0] !== schema.SECTION) {
                var headerRows = [
                    [schema.SECTION],
                    schema.getHeader()
                ];
                rows = headerRows.concat(rows.slice(1));
            }
        } else {
            rows = schema.getTemplateRows();
        }

        return parser.arrayToCSV(rows);
    }

    /**
     * Get template rows as an array (not CSV).
     * Useful for programmatic use.
     * 
     * @param {Object} options - Template options
     * @param {Array} options.exampleData - Custom example data (optional)
     * @returns {Array} Array of CSV rows
     */
    function getMissionTemplateRows(options) {
        options = options || {};

        if (options.exampleData && Array.isArray(options.exampleData)) {
            var rows = schema.toRows(options.exampleData);
            if (rows.length < 2 || rows[0][0] !== schema.SECTION) {
                var headerRows = [
                    [schema.SECTION],
                    schema.getHeader()
                ];
                return headerRows.concat(rows.slice(1));
            }
            return rows;
        }

        return schema.getTemplateRows();
    }

    /**
     * Get template missions as objects.
     * Useful for populating a form or preview.
     * 
     * @param {Object} options - Template options
     * @param {number} options.count - Number of template missions to return (default: 2)
     * @param {boolean} options.includeAllStatuses - Include all statuses (default: false)
     * @returns {Array} Array of mission objects
     */
    function getTemplateMissions(options) {
        options = options || {};
        var count = options.count || 2;

        if (typeof schema.getTemplateMissions === 'function') {
            var templates = schema.getTemplateMissions();

            // If includeAllStatuses, generate more examples
            if (options.includeAllStatuses) {
                var allExamples = [];
                var statuses = ['active', 'completed', 'cancelled', 'on_hold'];
                for (var i = 0; i < Math.min(statuses.length, count); i++) {
                    var baseTemplate = templates[i % templates.length];
                    if (baseTemplate) {
                        var copy = JSON.parse(JSON.stringify(baseTemplate));
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

            return templates.slice(0, count);
        }

        // Fallback if schema doesn't have template missions
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
        ].slice(0, count);
    }

    /**
     * Get a preview of the template for display.
     * 
     * @param {Object} options - Template options
     * @param {number} options.previewRows - Number of example rows to show (default: 2)
     * @returns {Object} { headers: Array, examples: Array, columnDescriptions: Object }
     */
    function getMissionTemplatePreview(options) {
        options = options || {};
        var previewRows = options.previewRows || 2;

        var rows = getMissionTemplateRows(options);
        var headers = rows.length > 1 ? rows[1] : [];
        var examples = [];

        // Skip section header (row 0) and column header (row 1)
        for (var i = 2; i < Math.min(rows.length, 2 + previewRows); i++) {
            examples.push(rows[i]);
        }

        // Column descriptions
        var columnDescriptions = {
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

        return {
            headers: headers,
            examples: examples,
            columnDescriptions: columnDescriptions
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

    /**
     * Get allowed values for each enum field.
     * 
     * @returns {Object} Map of field to allowed values
     */
    function getAllowedValues() {
        return {
            'Status': schema.getValidStatuses().filter(function(s) { return s !== ''; }),
            'Priority': schema.getValidPriorities().filter(function(p) { return p !== ''; }),
            'Difficulty': schema.getValidDifficulties().filter(function(d) { return d !== ''; })
        };
    }

    // ============================================================
    // Expose
    // ============================================================

    window.exportMissionTemplate = exportMissionTemplate;
    window.getMissionTemplateContent = getMissionTemplateContent;
    window.getMissionTemplateRows = getMissionTemplateRows;
    window.getTemplateMissions = getTemplateMissions;
    window.getMissionTemplatePreview = getMissionTemplatePreview;
    window.getMissionColumnDescriptions = getColumnDescriptions;
    window.getMissionAllowedValues = getAllowedValues;

})();
