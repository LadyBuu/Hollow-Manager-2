/**
 * js/export/character-export.js - Character CSV Export
 * Path: js/export/character-export.js
 * 
 * Exports ONLY characters to CSV.
 * Format matches character-import.js.
 */

(function() {
    'use strict';

    var utils = window.ExportUtils;
    var parser = window.CSV;

    function exportCharactersCSV() {
        var data = window.data || {};
        var characters = Array.isArray(data.characters) ? data.characters : [];

        if (characters.length === 0) {
            alert('No characters to export.');
            return;
        }

        var records = [
            ['# CHARACTERS'],
            ['CharacterId', 'FirstName', 'MiddleName', 'LastName', 'BirthYear', 'Gender', 'AssociatedNames',
             'EyeColor', 'HairColor', 'SkinColor', 'Height', 'Weight', 'Build', 'AppearanceNotes',
             'Notes', 'Deceased', 'DeathYear', 'DeathCause', 'DeathAge', 'Specialty',
             'CareerStatus', 'EliminatedWeeks']
        ];

        characters.forEach(function(char) {
            records.push([
                char.id || '',
                char.firstName || '',
                char.middleName || '',
                char.lastName || '',
                char.birthYear || '',
                char.gender || '',
                char.associatedNames || '',
                char.eyes || '',
                char.hair || '',
                char.skin || '',
                char.height || '',
                char.weight || '',
                char.build || '',
                char.appearanceNotes || '',
                char.notes || '',
                char.deceased ? 'true' : 'false',
                char.deathYear || '',
                char.deathCause || '',
                char.deathAge || '',
                char.specialty || '',
                JSON.stringify(char.careerStatus || []),
                JSON.stringify(char.eliminatedWeeks || [])
            ]);
        });

        var csvContent = parser.arrayToCSV(records);
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        utils.downloadBlob(blob, 'characters-' + new Date().toISOString().slice(0, 10) + '.csv');

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported characters to CSV');
        }
    }

    // Expose
    window.exportCharactersCSV = exportCharactersCSV;

})();
