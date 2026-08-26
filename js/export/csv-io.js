/**
 * js/export/csv-io.js - CSV Import/Export
 * Path: js/export/csv-io.js
 */

(function() {
    'use strict';

    var utils = window.ExportUtils;
    var schema = window.CSVSchema;

    function exportCSV() {
        var data = window.data || {};
        if (!utils.hasCSVExportableData(data)) {
            alert('No CSV-exportable data found.\n\nCSV exports: Characters, Teams, Tournaments, Missions, and Disciplines.\nUse JSON for complete backups.');
            return;
        }

        var records = [];

        // Characters
        records.push([schema.characters.sectionMarker]);
        records.push(schema.characters.header);
        (data.characters || []).forEach(function(c) {
            records.push(schema.characters.export(c));
        });
        records.push([]);

        // Teams
        records.push([schema.teams.sectionMarker]);
        records.push(schema.teams.header);
        (data.teams || []).forEach(function(t) {
            records.push(schema.teams.export(t));
        });
        records.push([]);

        // Team Members
        records.push([schema.teamMembers.sectionMarker]);
        records.push(schema.teamMembers.header);
        (data.teams || []).forEach(function(t) {
            var memberRows = schema.teamMembers.export(t);
            memberRows.forEach(function(row) {
                records.push(row);
            });
        });
        records.push([]);

        // Team Rankings
        records.push([schema.teamRankings.sectionMarker]);
        records.push(schema.teamRankings.header);
        (data.teams || []).forEach(function(t) {
            var rankingRows = schema.teamRankings.export(t);
            rankingRows.forEach(function(row) {
                records.push(row);
            });
        });
        records.push([]);

        // Tournaments
        records.push([schema.tournaments.sectionMarker]);
        records.push(schema.tournaments.header);
        (data.tournaments || []).forEach(function(t) {
            records.push(schema.tournaments.export(t));
        });
        records.push([]);

        // Tournament Teams
        records.push([schema.tournamentTeams.sectionMarker]);
        records.push(schema.tournamentTeams.header);
        (data.tournaments || []).forEach(function(t) {
            var teamRows = schema.tournamentTeams.export(t);
            teamRows.forEach(function(row) {
                records.push(row);
            });
        });
        records.push([]);

        // Tournament Matches
        records.push([schema.tournamentMatches.sectionMarker]);
        records.push(schema.tournamentMatches.header);
        (data.tournaments || []).forEach(function(t) {
            var matchRows = schema.tournamentMatches.export(t);
            matchRows.forEach(function(row) {
                records.push(row);
            });
        });
        records.push([]);

        // Tournament Eliminations
        records.push([schema.tournamentEliminations.sectionMarker]);
        records.push(schema.tournamentEliminations.header);
        (data.tournaments || []).forEach(function(t) {
            var elimRows = schema.tournamentEliminations.export(t);
            elimRows.forEach(function(row) {
                records.push(row);
            });
        });
        records.push([]);

        // Tournament Participants
        records.push([schema.tournamentParticipants.sectionMarker]);
        records.push(schema.tournamentParticipants.header);
        (data.tournaments || []).forEach(function(t) {
            var participantRows = schema.tournamentParticipants.export(t);
            participantRows.forEach(function(row) {
                records.push(row);
            });
        });
        records.push([]);

        // Missions
        records.push([schema.missions.sectionMarker]);
        records.push(schema.missions.header);
        (data.missions || []).forEach(function(m) {
            records.push(schema.missions.export(m));
        });
        records.push([]);

        // Disciplines
        records.push([schema.disciplines.sectionMarker]);
        records.push(schema.disciplines.header);
        if (data.curriculum && Array.isArray(data.curriculum.disciplines)) {
            data.curriculum.disciplines.forEach(function(d) {
                records.push(schema.disciplines.export(d));
            });
        }

        var csvContent = window.CSV.arrayToCSV(records);
        var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        var filename = 'hollow-blades-data-' + new Date().toISOString().slice(0, 10) + '.csv';
        
        utils.downloadBlob(blob, filename);

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported data to CSV');
        }
    }

    function importCSV(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var records = window.CSV.parse(e.target.result);
                if (records.length === 0) {
                    alert('No data found in CSV file.');
                    return;
                }

                // Get a fresh empty data structure from the canonical source
                var newData = getEmptyData();
                var charMap = {};
                var teamMap = {};
                var tournMap = {};
                var idTracker = {
                    characters: {},
                    teams: {},
                    tournaments: {},
                    missions: {},
                    disciplines: {}
                };
                var warnings = [];
                var context = { 
                    charMap: charMap, 
                    teamMap: teamMap, 
                    tournMap: tournMap,
                    warnings: warnings
                };
                var section = '';

                for (var i = 0; i < records.length; i++) {
                    var row = records[i];
                    if (row.length === 0) continue;

                    var first = (row[0] || '').trim();

                    // Detect section
                    var detectedSection = null;
                    for (var key in schema) {
                        if (schema[key].sectionMarker === first) {
                            detectedSection = key;
                            break;
                        }
                    }

                    if (detectedSection) {
                        section = detectedSection;
                        i++;
                        // Skip header row
                        continue;
                    }

                    if (!section) continue;

                    var importer = schema[section];
                    if (!importer || typeof importer.import !== 'function') continue;

                    try {
                        var result = importer.import(row, context);
                        
                        // Determine which collection this result belongs to
                        if (result && typeof result === 'object') {
                            var id = result.id;
                            var collection = getCollectionForSection(section);
                            
                            if (id && collection && idTracker[collection] && idTracker[collection][id]) {
                                throw new Error('Duplicate ' + collection.slice(0, -1) + ' ID "' + id + '" found in CSV.');
                            }
                            if (id && collection && idTracker[collection]) {
                                idTracker[collection][id] = true;
                            }

                            // Add to appropriate collection
                            if (section === 'characters') {
                                newData.characters.push(result);
                                charMap[result.id] = result;
                            } else if (section === 'teams') {
                                newData.teams.push(result);
                                teamMap[result.id] = result;
                            } else if (section === 'tournaments') {
                                newData.tournaments.push(result);
                                tournMap[result.id] = result;
                            } else if (section === 'missions') {
                                newData.missions.push(result);
                            } else if (section === 'disciplines') {
                                if (!newData.curriculum) newData.curriculum = getEmptyCurriculum();
                                if (!Array.isArray(newData.curriculum.disciplines)) newData.curriculum.disciplines = [];
                                newData.curriculum.disciplines.push(result);
                            }
                        }
                    } catch (err) {
                        alert('Error importing row ' + (i + 1) + ': ' + err.message);
                        return;
                    }
                }

                // Migrate and normalise
                if (typeof window.migrateData === 'function') {
                    try {
                        newData = window.migrateData(newData);
                    } catch (migrateErr) {
                        alert('Migration failed: ' + migrateErr.message);
                        return;
                    }
                }

                if (!utils.hasCSVExportableData(newData)) {
                    alert('No valid CSV-exportable data found in file.\n\nCSV imports: Characters, Teams, Tournaments, Missions, and Disciplines.');
                    return;
                }

                if (!confirm('This will replace all current data. Continue?')) {
                    return;
                }

                // Create backup only after confirmation
                var backup = utils.cloneData(window.data);
                var persisted = false;

                if (typeof window.saveData === 'function') {
                    Promise.resolve(window.saveData(newData))
                        .then(function() {
                            persisted = true;
                            window.data = newData;
                            onImportSuccess(newData, persisted, 'CSV', warnings);
                        })
                        .catch(function(err) {
                            if (backup) {
                                window.data = backup;
                            }
                            alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                        });
                } else {
                    window.data = newData;
                    onImportSuccess(newData, false, 'CSV', warnings);
                }

            } catch (err) {
                alert('Failed to import CSV: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function getCollectionForSection(section) {
        var map = {
            'characters': 'characters',
            'teams': 'teams',
            'tournaments': 'tournaments',
            'missions': 'missions',
            'disciplines': 'disciplines'
        };
        return map[section] || null;
    }

    function onImportSuccess(data, persisted, format, warnings) {
        if (typeof window.logActivity === 'function') {
            window.logActivity('Imported data from ' + format);
        }
        if (typeof window.renderAll === 'function') {
            window.renderAll();
        }
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        
        // Show the result with warnings if any
        if (persisted) {
            var charCount = data.characters ? data.characters.length : 0;
            var teamCount = data.teams ? data.teams.length : 0;
            var tournCount = data.tournaments ? data.tournaments.length : 0;
            var missionCount = data.missions ? data.missions.length : 0;
            
            var msg = format + ' import completed successfully!\n\n' +
                'Characters: ' + charCount + '\n' +
                'Teams: ' + teamCount + '\n' +
                'Tournaments: ' + tournCount + '\n' +
                'Missions: ' + missionCount;
            
            if (warnings && warnings.length > 0) {
                msg += '\n\n⚠ Warnings:\n' + warnings.join('\n');
            }
            
            if (format === 'CSV') {
                msg += '\n\nNote: CSV only imports basic character info, teams, tournaments, missions, and disciplines.\n' +
                       'Use JSON for complete data restoration.';
            }
            
            alert(msg);
        } else {
            var warnMsg = format + ' import completed but data could NOT be saved to persistent storage.\n\n' +
                  'Your data will be lost when you refresh the page.\n' +
                  'Please check your browser settings and try again.';
            
            if (warnings && warnings.length > 0) {
                warnMsg += '\n\n⚠ Warnings:\n' + warnings.join('\n');
            }
            
            alert(warnMsg);
        }
    }

    // Delegate to canonical data/state layer
    function getEmptyData() {
        if (typeof window.getDefaultData === 'function') {
            return window.getDefaultData();
        }
        
        // Fallback - but ideally this should come from the canonical source
        return {
            characters: [],
            teams: [],
            tournaments: [],
            missions: [],
            activities: [],
            classes: [],
            locations: [],
            locationSchedules: {},
            currentYear: new Date().getFullYear(),
            currentWeek: 1,
            curriculum: getEmptyCurriculum(),
            social: getEmptySocial(),
            statsConfig: getDefaultStatsConfig(),
            _dataVersion: 12
        };
    }

    function getEmptyCurriculum() {
        return {
            disciplines: [],
            schedules: {},
            restDays: {},
            examDays: {},
            grades: {},
            rankings: {},
            currentWeek: 1,
            classInstructors: {},
            classLabels: {},
            classGroupLabels: {},
            classDurations: {},
            classLocations: {},
            instructorClasses: {},
            instructorTemplates: {},
            instructorBlocks: {},
            instructorGroups: {},
            disciplineGroups: {},
            autoGroups: {}
        };
    }

    function getEmptySocial() {
        return {
            relationships: [],
            relationshipTypes: [
                { id: 'familiar', label: 'Familiar', color: '#8cbb3a' },
                { id: 'professional', label: 'Professional', color: '#c9a24b' },
                { id: 'romantic', label: 'Romantic', color: '#c1453c' },
                { id: 'friendship', label: 'Friendship', color: '#4a9bc7' },
                { id: 'mentor', label: 'Mentor/Mentee', color: '#9b59b6' },
                { id: 'rivalry', label: 'Rivalry', color: '#e67e22' },
                { id: 'alliance', label: 'Alliance', color: '#27ae60' },
                { id: 'other', label: 'Other', color: '#7f8c8d' }
            ],
            nextId: 1
        };
    }

    function getDefaultStatsConfig() {
        return {
            classes: [
                { id: 'warrior', label: 'Warrior', icon: '⚔', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                { id: 'skirmisher', label: 'Skirmisher', icon: '🏹', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 } },
                { id: 'protector', label: 'Protector', icon: '🛡', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'cha'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, cha: 0.15, dex: 0.05 }, minStats: { str: 13, con: 12 } },
                { id: 'sage', label: 'Sage', icon: '📚', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                { id: 'mystic', label: 'Mystic', icon: '✦', primaryStats: ['wis', 'cha'], secondaryStats: ['con', 'int'], statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05 }, minStats: { wis: 13, cha: 12 } },
                { id: 'stalker', label: 'Stalker', icon: '🗡', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
                { id: 'spellblade', label: 'Spellblade', icon: '⚡', primaryStats: ['str', 'int'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05 }, minStats: { str: 13, int: 12 } },
                { id: 'channeler', label: 'Channeler', icon: '✦', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'warden', label: 'Warden', icon: '⚔', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'adept', label: 'Adept', icon: '✦', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
                { id: 'artificer', label: 'Artificer', icon: '⚙', primaryStats: ['int', 'dex'], secondaryStats: ['con', 'wis'], statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, dex: 12 } },
                { id: 'occultist', label: 'Occultist', icon: '✦', primaryStats: ['int', 'cha'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05 }, minStats: { int: 13, cha: 13 } },
                { id: 'blade_dancer', label: 'Blade Dancer', icon: '🗡', primaryStats: ['dex', 'cha'], secondaryStats: ['str', 'con'], statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05 }, minStats: { dex: 13, cha: 12 } },
                { id: 'elementalist', label: 'Elementalist', icon: '✦', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                { id: 'sentinel', label: 'Sentinel', icon: '🛡', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'dex'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, dex: 0.15, cha: 0.05 }, minStats: { str: 13, con: 12 } }
            ]
        };
    }

    // Expose
    window.exportCSV = exportCSV;
    window.importCSV = importCSV;

})();
