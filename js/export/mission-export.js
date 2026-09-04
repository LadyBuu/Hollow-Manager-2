/**
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
