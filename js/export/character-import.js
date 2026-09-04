/**
 * js/export/character-import.js - Character CSV Import
 * Path: js/export/character-import.js
 * 
 * Imports ONLY characters from a CSV file.
 * Does NOT affect teams, missions, tournaments, etc.
 * 
 * Format: CharacterId, FirstName, LastName, BirthYear, Gender, 
 *          CareerStatus, EliminatedWeeks, ... (full character schema)
 */

(function() {
    'use strict';

    var utils = window.ExportUtils;
    var parser = window.CSV;

    function importCharacters(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var records = parser.parse(e.target.result);
                if (records.length === 0) {
                    alert('No data found in CSV file.');
                    return;
                }

                // Detect character section
                var characterRows = extractCharacterRows(records);
                if (characterRows.length === 0) {
                    alert('No character data found in CSV file.\n\n' +
                          'The file must contain a "# CHARACTERS" section.');
                    return;
                }

                var imported = parseCharacterRows(characterRows);
                if (imported.length === 0) {
                    alert('No valid character data found.');
                    return;
                }

                // Confirm import
                var msg = 'This will import ' + imported.length + ' character(s).\n\n' +
                          'Existing characters with matching IDs will be updated.\n' +
                          'New characters will be added.\n\n' +
                          'Other data (teams, missions, etc.) is NOT affected.\n\n' +
                          'Continue?';

                if (!confirm(msg)) {
                    return;
                }

                // Merge into existing data
                var existing = window.data || {};
                if (!Array.isArray(existing.characters)) {
                    existing.characters = [];
                }

                var updated = 0;
                var added = 0;

                imported.forEach(function(char) {
                    var existingIndex = existing.characters.findIndex(function(c) {
                        return c && String(c.id) === String(char.id);
                    });

                    if (existingIndex !== -1) {
                        existing.characters[existingIndex] = char;
                        updated++;
                    } else {
                        existing.characters.push(char);
                        added++;
                    }
                });

                window.data = existing;

                // Persist
                if (typeof window.saveData === 'function') {
                    window.saveData()
                        .then(function() {
                            alert('Character import completed!\n\n' +
                                  'Added: ' + added + '\n' +
                                  'Updated: ' + updated + '\n' +
                                  'Total: ' + imported.length);
                            // Refresh UI
                            if (typeof window.renderAll === 'function') {
                                window.renderAll();
                            }
                            if (typeof window.renderCharacterList === 'function') {
                                window.renderCharacterList();
                            }
                        })
                        .catch(function(err) {
                            alert('Characters imported in memory, but persistence failed: ' + err.message);
                        });
                } else {
                    alert('Characters imported but could not be saved. Please refresh.');
                }

            } catch (err) {
                alert('Failed to import characters: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function extractCharacterRows(records) {
        var rows = [];
        var inSection = false;

        for (var i = 0; i < records.length; i++) {
            var row = records[i];
            if (utils.isBlankRow(row)) continue;

            var first = String(row[0] || '').trim();
            if (first === '# CHARACTERS') {
                inSection = true;
                i++; // Skip header
                continue;
            }

            if (inSection && first === 'CharacterId') {
                // Header row - skip
                continue;
            }

            if (inSection) {
                // Check if we've reached next section
                if (first.startsWith('#')) {
                    break;
                }
                if (row.length > 1 && row[0] && row[1]) {
                    rows.push(row);
                }
            }
        }

        return rows;
    }

    function parseCharacterRows(rows) {
        var characters = [];

        rows.forEach(function(row) {
            try {
                var char = parseCharacterRow(row);
                if (char) {
                    characters.push(char);
                }
            } catch (e) {
                console.warn('Skipping row:', row, e.message);
            }
        });

        return characters;
    }

    function parseCharacterRow(row) {
        // CharacterId, FirstName, MiddleName, LastName, BirthYear, Gender, AssociatedNames,
        // EyeColor, HairColor, SkinColor, Height, Weight, Build, AppearanceNotes,
        // Notes, Deceased, DeathYear, DeathCause, DeathAge, Specialty,
        // CareerStatus, EliminatedWeeks

        var id = String(row[0] || '').trim() || 'char_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        var firstName = String(row[1] || '').trim();
        var lastName = String(row[3] || '').trim();

        if (!firstName && !lastName) {
            console.warn('Character row missing name:', row);
            return null;
        }

        var careerStatus = parseJSON(row[20], []);
        var eliminatedWeeks = parseJSON(row[21], []);

        return {
            id: id,
            firstName: firstName,
            middleName: String(row[2] || '').trim(),
            lastName: lastName,
            birthYear: String(row[4] || '').trim(),
            gender: String(row[5] || '').trim(),
            associatedNames: String(row[6] || '').trim(),
            eyes: String(row[7] || '').trim(),
            hair: String(row[8] || '').trim(),
            skin: String(row[9] || '').trim(),
            height: String(row[10] || '').trim(),
            weight: String(row[11] || '').trim(),
            build: String(row[12] || '').trim(),
            appearanceNotes: String(row[13] || '').trim(),
            notes: String(row[14] || '').trim(),
            deceased: String(row[15] || '').trim() === 'true',
            deathYear: String(row[16] || '').trim(),
            deathCause: String(row[17] || '').trim(),
            deathAge: String(row[18] || '').trim(),
            specialty: String(row[19] || '').trim(),
            careerStatus: careerStatus,
            eliminatedWeeks: eliminatedWeeks,
            eliminations: [],
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            magic: {},
            personality: {},
            specialMoves: { physical: [], magical: [] },
            previousNames: [],
            nameFormat: 'firstlast',
            classIds: [],
            createdAt: new Date().toISOString()
        };
    }

    function parseJSON(value, fallback) {
        if (!value || typeof value !== 'string') return fallback;
        try {
            var parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (e) {
            return fallback;
        }
    }

    // Expose
    window.importCharactersCSV = importCharacters;

})();
