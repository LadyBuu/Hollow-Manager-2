/**
 * js/export/mission-export.js - Mission CSV Export
 * Pure export adapter - no UI, no persistence, no window.data
 * 
 * This module exports mission data to CSV format using the canonical
 * MissionCSVSchema for column definitions and serialization.
 * 
 * It does NOT:
 * - Access window.data directly
 * - Call saveData()
 * - Show alerts or confirmations
 * - Log activity
 * - Render UI
 * - Handle empty state (that's the caller's responsibility)
 * 
 * Usage:
 *   var missions = MissionsQueries.getMissions();
 *   var result = exportMissionsCSV(missions);
 *   // result: { count: number }
 * 
 *   // Or use the convenience function:
 *   exportMissionsFromData(); // uses MissionsQueries
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
        throw new Error('MissionCSVExport: CSV parser not available');
    }
    if (!schema || typeof schema.toRows !== 'function') {
        throw new Error('MissionCSVExport: MissionCSVSchema not available');
    }
    if (!fileUtils || typeof fileUtils.downloadBlob !== 'function') {
        throw new Error('MissionCSVExport: FileUtils not available');
    }

    // ============================================================
    // Export Functions
    // ============================================================

    /**
     * Export an array of missions to CSV format and download.
     * 
     * @param {Array} missions - Array of mission objects
     * @param {Object} options - Export options
     * @param {string} options.filename - Custom filename (optional)
     * @returns {Object} { count: number, filename: string }
     * @throws {TypeError} If missions is not an array
     */
    function exportMissionsCSV(missions, options) {
        options = options || {};

        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }

        // Generate CSV rows using the schema
        var rows = schema.toRows(missions);
        var csvContent = parser.arrayToCSV(rows);

        // Create blob with BOM for Excel compatibility
        var blob = new Blob(['\uFEFF' + csvContent], {
            type: 'text/csv;charset=utf-8;'
        });

        // Generate filename
        var filename = options.filename ||
            'missions-' + new Date().toISOString().slice(0, 10) + '.csv';

        // Download
        fileUtils.downloadBlob(blob, filename);

        return {
            count: missions.length,
            filename: filename
        };
    }

    /**
     * Export missions from the current application data.
     * Uses MissionsQueries to get missions.
     * 
     * @param {Object} options - Export options
     * @returns {Object} { count: number, filename: string, message: string|null }
     */
    function exportMissionsFromData(options) {
        options = options || {};

        // Check for MissionsQueries
        if (typeof window.MissionsQueries === 'undefined' ||
            typeof window.MissionsQueries.getMissions !== 'function') {
            throw new Error('MissionsQueries not available.');
        }

        var missions = window.MissionsQueries.getMissions();

        if (missions.length === 0) {
            return {
                count: 0,
                filename: null,
                message: 'No missions to export.'
            };
        }

        var result = exportMissionsCSV(missions, options);

        // Add message for UI feedback
        result.message = 'Exported ' + result.count + ' missions';
        return result;
    }

    /**
     * Export missions filtered by status.
     * 
     * @param {string} status - Filter by status ('active', 'completed', 'cancelled', etc.)
     * @param {Object} options - Export options
     * @returns {Object} { count: number, filename: string, message: string|null }
     */
    function exportMissionsByStatus(status, options) {
        options = options || {};

        if (typeof window.MissionsQueries === 'undefined' ||
            typeof window.MissionsQueries.getMissions !== 'function') {
            throw new Error('MissionsQueries not available.');
        }

        var missions = window.MissionsQueries.getMissions({ status: status });

        if (missions.length === 0) {
            var statusLabel = status || 'all';
            return {
                count: 0,
                filename: null,
                message: 'No ' + statusLabel + ' missions to export.'
            };
        }

        var filename = options.filename ||
            'missions-' + status + '-' + new Date().toISOString().slice(0, 10) + '.csv';

        options.filename = filename;
        var result = exportMissionsCSV(missions, options);

        var statusLabel = status || 'all';
        result.message = 'Exported ' + result.count + ' ' + statusLabel + ' missions';
        return result;
    }

    /**
     * Get CSV content as a string without downloading.
     * Useful for testing or preview.
     * 
     * @param {Array} missions - Array of mission objects
     * @returns {string} CSV content
     */
    function getMissionsCSVContent(missions) {
        if (!Array.isArray(missions)) {
            throw new TypeError('Missions must be an array.');
        }

        var rows = schema.toRows(missions);
        return parser.arrayToCSV(rows);
    }

    // ============================================================
    // Expose
    // ============================================================

    window.exportMissionsCSV = exportMissionsCSV;
    window.exportMissionsFromData = exportMissionsFromData;
    window.exportMissionsByStatus = exportMissionsByStatus;
    window.getMissionsCSVContent = getMissionsCSVContent;

})();/**
 * js/export/mission-export.js - Mission CSV Export
 * Path: js/export/mission-export.js
 * 
 * Exports ONLY missions to CSV.
 * Format matches mission-import.js.
 */

(function() {
    'use strict';

    var utils = window.ExportUtils;
    var parser = window.CSV;

    function exportMissionsCSV() {
        var data = window.data || {};
        var missions = Array.isArray(data.missions) ? data.missions : [];

        if (missions.length === 0) {
            alert('No missions to export.');
            return;
        }

        var records = [
            ['# MISSIONS'],
            ['MissionId', 'Title', 'Status', 'Priority', 'Difficulty', 'TeamId', 'Location',
             'Duration', 'Pay', 'Progress', 'Objectives']
        ];

        missions.forEach(function(m) {
            records.push([
                m.id || '',
                m.title || '',
                m.status || 'active',
                m.priority || 'medium',
                m.difficulty || 'medium',
                m.assignedTeamId || '',
                m.location || '',
                m.duration || '',
                m.pay || '',
                String(m.progress || 0),
                JSON.stringify(m.objectives || [])
            ]);
        });

        var csvContent = parser.arrayToCSV(records);
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        utils.downloadBlob(blob, 'missions-' + new Date().toISOString().slice(0, 10) + '.csv');

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported missions to CSV');
        }
    }

    // Expose
    window.exportMissionsCSV = exportMissionsCSV;

})();
