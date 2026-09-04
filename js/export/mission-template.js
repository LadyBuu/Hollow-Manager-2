/**
 * js/export/mission-template.js - Mission CSV Template
 * Path: js/export/mission-template.js
 */

(function() {
    'use strict';

    var parser = window.CSV;
    var utils = window.ExportUtils;

    function exportMissionTemplate() {
        var records = [
            ['# MISSIONS'],
            ['MissionId', 'Title', 'Status', 'Priority', 'Difficulty', 'TeamId', 'Location',
             'Duration', 'Pay', 'Progress', 'Objectives'],
            ['', 'Operation Nightfall', 'active', 'high', 'hard', '', 'Berlin',
             '2 weeks', '5000 credits', '50', '[{"text":"Infiltrate base","done":true},{"text":"Retrieve documents","done":true}]'],
            ['', 'Rescue Mission', 'active', 'medium', 'medium', '', 'London',
             '3 days', '2000 credits', '0', '[{"text":"Find hostages","done":false},{"text":"Extract safely","done":false}]']
        ];

        var csvContent = parser.arrayToCSV(records);
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        utils.downloadBlob(blob, 'missions-template.csv');

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported mission template CSV');
        }
    }

    window.exportMissionTemplate = exportMissionTemplate;

})();
