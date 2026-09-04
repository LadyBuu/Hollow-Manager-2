/**
 * js/export/character-template.js - Character CSV Template
 * Path: js/export/character-template.js
 */

(function() {
    'use strict';

    var parser = window.CSV;
    var utils = window.ExportUtils;

    function exportCharacterTemplate() {
        var records = [
            ['# CHARACTERS'],
            ['CharacterId', 'FirstName', 'MiddleName', 'LastName', 'BirthYear', 'Gender', 'AssociatedNames',
             'EyeColor', 'HairColor', 'SkinColor', 'Height', 'Weight', 'Build', 'AppearanceNotes',
             'Notes', 'Deceased', 'DeathYear', 'DeathCause', 'DeathAge', 'Specialty',
             'CareerStatus', 'EliminatedWeeks'],
            ['', 'John', '', 'Doe', '1990', 'Male', '', 'Blue', 'Brown', 'Fair', "5'10\"", '75kg', 'Athletic',
             '', 'Example character', 'false', '', '', '', '', '[{"status":"trainee","startYear":"1920","endYear":"1923"}]', '[]'],
            ['', 'Jane', 'Mary', 'Smith', '1992', 'Female', 'The Shadow', 'Green', 'Black', 'Olive',
             "5'7\"", '60kg', 'Slim', 'Scar on cheek', '', 'false', '', '', '', '', '[{"status":"trainee","startYear":"1920","endYear":"1923"}]', '[]']
        ];

        var csvContent = parser.arrayToCSV(records);
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        utils.downloadBlob(blob, 'characters-template.csv');

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported character template CSV');
        }
    }

    window.exportCharacterTemplate = exportCharacterTemplate;

})();
