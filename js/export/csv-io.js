/**
 * js/export/csv-io.js - CSV Import/Export
 * Path: js/export/csv-io.js
 * 
 * Import pipeline:
 *   Parse
 *     ↓
 *   Detect format version
 *     ↓
 *   Build empty canonical structure
 *     ↓
 *   Scan all rows: collect primary entities first (order-independent)
 *     ↓
 *   Scan all rows: collect relationships (order-independent)
 *     ↓
 *   Rebuild reference maps
 *     ↓
 *   Migrate / Normalise (with validation)
 *     ↓
 *   Rebuild reference maps (post-migration)
 *     ↓
 *   Validate references (post-migration)
 *     ↓
 *   Show warnings (capped)
 *     ↓
 *   Confirm replacement
 *     ↓
 *   Persist to database (saveData must return true on success)
 *     ↓
 *   Swap live state
 *     ↓
 *   Render (with separate error handling)
 * 
 * IMPORT PHILOSOPHY:
 *   - Missing optional reference → null it (missions, classId)
 *   - Missing required reference → skip relationship (team members, tournament records)
 *   - Malformed primary entity → abort import with error
 *   - Invalid enum values → abort import with error
 *   - Blank rows → silently skipped
 *   - Malformed JSON field → warn and use fallback
 *   - Warnings are capped at 50 to prevent UI explosion
 *   - JSON fields are type-validated (arrays must be arrays, etc.)
 *   - Numeric fields are strictly validated (no "12garbage" allowed)
 *   - saveData() must return true on success, throw/reject on failure
 *   - If saveData is unavailable, import fails (no in-memory only mode)
 */

(function() {
    'use strict';

    var utils = window.ExportUtils;
    var schema = window.CSVSchema;
    var MAX_WARNINGS = 50;

    // Warning helper with cap
    function addWarning(warnings, message) {
        if (warnings.length < MAX_WARNINGS) {
            warnings.push(message);
        } else if (warnings.length === MAX_WARNINGS) {
            warnings.push('Additional warnings omitted.');
        }
    }

    function exportCSV() {
        var data = window.data || {};
        if (!utils.hasCSVExportableData(data)) {
            alert('No CSV-exportable data found.\n\nCSV exports Characters, Teams, Tournaments, Missions, and Disciplines,\nincluding related team and tournament records.\nUse JSON for complete backups.');
            return;
        }

        var records = [];

        // Format version
        records.push(schema.version.export());
        records.push([]);

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
            // Outer try/catch for all import errors - single alert
            try {
                var records = window.CSV.parse(e.target.result);
                if (records.length === 0) {
                    alert('No data found in CSV file.');
                    return;
                }

                // Detect format version using canonical parser
                var version = schema.version.detect(records);
                if (version === 'unknown') {
                    // No version marker - assume version 1 but warn
                    if (!confirm('This CSV file does not contain a format version marker.\n\n' +
                                 'Assuming format version 1.\n\n' +
                                 'Continue with import?')) {
                        return;
                    }
                } else if (version !== '1') {
                    if (!confirm('This CSV file appears to be from a different version.\n\n' +
                                 'Detected version: ' + version + '\n' +
                                 'Supported version: 1\n\n' +
                                 'Import may not work correctly. Continue anyway?')) {
                        return;
                    }
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
                    addWarning: function(msg) {
                        addWarning(warnings, msg);
                    }
                };
                var foundExportableData = false;

                // ============================================================
                // PHASE 1: Parse sections and collect rows by type
                // ============================================================

                var sections = {};
                var currentSection = null;

                for (var i = 0; i < records.length; i++) {
                    var row = records[i];
                    if (utils.isBlankRow(row)) continue;

                    var first = (row[0] == null ? '' : row[0]).trim();

                    // Skip version marker
                    if (first === '# HOLLOW BLADES CSV') {
                        continue;
                    }

                    // Detect section
                    var detectedSection = null;
                    for (var key in schema) {
                        if (key === 'version') continue;
                        if (schema[key].sectionMarker === first) {
                            detectedSection = key;
                            break;
                        }
                    }

                    if (detectedSection) {
                        currentSection = detectedSection;
                        i++;
                        // Read and validate header
                        var headerRow = records[i] || [];
                        var headerValidator = schema[currentSection].validateHeader;
                        if (typeof headerValidator === 'function') {
                            if (!headerValidator(headerRow)) {
                                alert('Invalid header for section "' + currentSection + '".\n\n' +
                                      'Expected: ' + schema[currentSection].header.join(', ') + '\n' +
                                      'Got: ' + headerRow.join(', '));
                                return;
                            }
                        }
                        if (!sections[currentSection]) {
                            sections[currentSection] = [];
                        }
                        continue;
                    }

                    if (!currentSection) continue;

                    // Store row for later processing
                    if (!sections[currentSection]) {
                        sections[currentSection] = [];
                    }
                    sections[currentSection].push(row);
                }

                // ============================================================
                // PHASE 2: Process primary entities FIRST (order independent)
                // ============================================================

                var primarySections = utils.CSV_PRIMARY_COLLECTIONS;

                primarySections.forEach(function(sectionName) {
                    var rows = sections[sectionName] || [];
                    var importer = schema[sectionName];
                    if (!importer || typeof importer.import !== 'function') return;

                    rows.forEach(function(row, idx) {
                        try {
                            var result = importer.import(row, context);

                            if (result && typeof result === 'object') {
                                var id = result.id;
                                var collection = getCollectionForSection(sectionName);

                                if (id && collection && idTracker[collection] && idTracker[collection][id]) {
                                    throw new Error('Duplicate ' + collection.slice(0, -1) + ' ID "' + id + '" found in CSV.');
                                }
                                if (id && collection && idTracker[collection]) {
                                    idTracker[collection][id] = true;
                                }

                                // Add to appropriate collection
                                if (sectionName === 'characters') {
                                    newData.characters.push(result);
                                    charMap[utils.normaliseId(result.id)] = result;
                                    foundExportableData = true;
                                } else if (sectionName === 'teams') {
                                    newData.teams.push(result);
                                    teamMap[utils.normaliseId(result.id)] = result;
                                    foundExportableData = true;
                                } else if (sectionName === 'tournaments') {
                                    newData.tournaments.push(result);
                                    tournMap[utils.normaliseId(result.id)] = result;
                                    foundExportableData = true;
                                } else if (sectionName === 'missions') {
                                    newData.missions.push(result);
                                    foundExportableData = true;
                                } else if (sectionName === 'disciplines') {
                                    if (!newData.curriculum) newData.curriculum = getEmptyCurriculum();
                                    if (!Array.isArray(newData.curriculum.disciplines)) newData.curriculum.disciplines = [];
                                    newData.curriculum.disciplines.push(result);
                                    foundExportableData = true;
                                }
                            }
                        } catch (err) {
                            // Wrap error with context and rethrow for outer handler
                            throw new Error(
                                'Error importing ' + sectionName +
                                ' row ' + (idx + 1) +
                                ': ' + err.message
                            );
                        }
                    });
                });

                // ============================================================
                // PHASE 3: Process relationships SECOND (order independent)
                // ============================================================

                var relationshipSections = ['teamMembers', 'teamRankings', 'tournamentTeams',
                                           'tournamentMatches', 'tournamentEliminations', 'tournamentParticipants'];

                relationshipSections.forEach(function(sectionName) {
                    var rows = sections[sectionName] || [];
                    var importer = schema[sectionName];
                    if (!importer || typeof importer.import !== 'function') return;

                    rows.forEach(function(row, idx) {
                        try {
                            importer.import(row, context);
                        } catch (err) {
                            throw new Error(
                                'Error importing ' + sectionName +
                                ' row ' + (idx + 1) +
                                ': ' + err.message
                            );
                        }
                    });
                });

                // Validate that we found something to import
                if (!foundExportableData) {
                    alert('No valid CSV-exportable data found in file.\n\nCSV imports: Characters, Teams, Tournaments, Missions, and Disciplines.');
                    return;
                }

                // ============================================================
                // PHASE 4: Rebuild maps, migrate, rebuild again, validate
                // ============================================================

                // Rebuild reference maps before migration (ensures consistency)
                rebuildReferenceMaps(newData, context);

                // MIGRATE AND NORMALISE - with validation
                if (typeof window.migrateData === 'function') {
                    try {
                        var migratedData = window.migrateData(newData);
                        
                        // Validate migration result
                        if (!migratedData || typeof migratedData !== 'object') {
                            throw new Error('Migration returned an invalid data structure.');
                        }
                        
                        newData = migratedData;
                    } catch (migrateErr) {
                        alert('Migration failed: ' + migrateErr.message);
                        return;
                    }
                }

                // Rebuild reference maps after migration (migration may have changed IDs/structure)
                rebuildReferenceMaps(newData, context);

                // Post-migration referential validation
                validateImportedReferences(newData, warnings, context.addWarning);

                // Validate the resulting data structure
                if (!utils.hasCSVExportableData(newData)) {
                    alert('Imported data failed validation. The resulting data structure appears incomplete.');
                    return;
                }

                // ============================================================
                // PHASE 5: Confirm and persist
                // ============================================================

                // Build confirmation message with warnings
                var confirmMsg = 'This import will replace all current data.\n\n';

                var charCount = newData.characters ? newData.characters.length : 0;
                var teamCount = newData.teams ? newData.teams.length : 0;
                var tournCount = newData.tournaments ? newData.tournaments.length : 0;
                var missionCount = newData.missions ? newData.missions.length : 0;

                confirmMsg += 'Characters: ' + charCount + '\n';
                confirmMsg += 'Teams: ' + teamCount + '\n';
                confirmMsg += 'Tournaments: ' + tournCount + '\n';
                confirmMsg += 'Missions: ' + missionCount + '\n\n';

                if (warnings.length > 0) {
                    confirmMsg += '⚠ Warnings:\n';
                    confirmMsg += warnings.join('\n') + '\n\n';
                }

                confirmMsg += 'Continue with import?';

                if (!confirm(confirmMsg)) {
                    return;
                }

                // ============================================================
                // PHASE 6: Persist with explicit contract enforcement
                // ============================================================

                // Create backup only after confirmation
                var backup = utils.cloneData(window.data);
                var persisted = false;

                // saveData must exist and return true on success
                if (typeof window.saveData !== 'function') {
                    alert(
                        'Cannot import CSV: saveData() is unavailable.\n\n' +
                        'The imported data was not applied.\n' +
                        'Please ensure the application has loaded correctly before importing.'
                    );
                    return;
                }

                // Execute save with explicit success check
                Promise.resolve(window.saveData(newData))
                    .then(function(result) {
                        // Strict contract: result must be exactly true
                        if (result !== true) {
                            throw new Error('saveData did not confirm successful persistence.');
                        }
                        
                        // Persistence confirmed
                        persisted = true;
                        window.data = newData;

                        // Post-persistence UI refresh - separate error handling
                        try {
                            onImportSuccess(newData, true, 'CSV', warnings);
                        } catch (renderErr) {
                            console.error('Import persisted successfully, but UI refresh failed:', renderErr);
                            alert(
                                'CSV import was saved successfully, but the interface could not refresh.\n\n' +
                                'Please reload the page to see your imported data.'
                            );
                        }
                    })
                    .catch(function(err) {
                        // Only roll back if persistence actually failed
                        if (!persisted && backup) {
                            window.data = backup;
                        }
                        alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                    });

            } catch (err) {
                // Single alert for all import errors
                alert('Failed to import CSV: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    /**
     * Rebuild reference maps from the current data
     * Used before and after migration
     */
    function rebuildReferenceMaps(data, context) {
        context.charMap = {};
        context.teamMap = {};
        context.tournMap = {};

        (data.characters || []).forEach(function(char) {
            context.charMap[utils.normaliseId(char.id)] = char;
        });

        (data.teams || []).forEach(function(team) {
            context.teamMap[utils.normaliseId(team.id)] = team;
        });

        (data.tournaments || []).forEach(function(tourn) {
            context.tournMap[utils.normaliseId(tourn.id)] = tourn;
        });
    }

    /**
     * Post-import referential validation
     * Checks all foreign keys after import is complete
     * Repairs dangling references where possible (nulls them)
     */
    function validateImportedReferences(data, warnings, addWarning) {
        // Validate missions - null broken references
        if (Array.isArray(data.missions)) {
            data.missions.forEach(function(mission) {
                if (mission.assignedTeamId) {
                    var teamExists = data.teams && data.teams.some(function(t) {
                        return utils.normaliseId(t.id) === utils.normaliseId(mission.assignedTeamId);
                    });
                    if (!teamExists) {
                        addWarning('Mission "' + mission.title + '" references unknown team "' + mission.assignedTeamId + '" - clearing reference');
                        mission.assignedTeamId = null;
                    }
                }
            });
        }

        // Validate team members and class IDs
        if (Array.isArray(data.teams)) {
            data.teams.forEach(function(team) {
                if (Array.isArray(team.members)) {
                    team.members.forEach(function(member) {
                        var charExists = data.characters && data.characters.some(function(c) {
                            return utils.normaliseId(c.id) === utils.normaliseId(member.characterId);
                        });
                        if (!charExists) {
                            addWarning('Team "' + team.name + '" references unknown character "' + member.characterId + '"');
                        }
                    });
                }
                // Validate team classId - null if invalid
                if (team.classId) {
                    // Check if classId refers to a discipline in curriculum
                    var classExists = data.curriculum && 
                                      Array.isArray(data.curriculum.disciplines) &&
                                      data.curriculum.disciplines.some(function(d) {
                                          return utils.normaliseId(d.id) === utils.normaliseId(team.classId);
                                      });
                    
                    // Also check if there's a separate classes collection
                    if (!classExists && data.classes) {
                        classExists = data.classes.some(function(c) {
                            return utils.normaliseId(c.id) === utils.normaliseId(team.classId);
                        });
                    }
                    
                    if (!classExists) {
                        addWarning('Team "' + team.name + '" references class "' + team.classId + '" which was not found - clearing reference');
                        team.classId = null;
                    }
                }
            });
        }

        // Validate tournament teams
        if (Array.isArray(data.tournaments)) {
            data.tournaments.forEach(function(tourn) {
                if (Array.isArray(tourn.teams)) {
                    tourn.teams.forEach(function(entry) {
                        var teamExists = data.teams && data.teams.some(function(t) {
                            return utils.normaliseId(t.id) === utils.normaliseId(entry.teamId);
                        });
                        if (!teamExists) {
                            addWarning('Tournament "' + tourn.name + '" references unknown team "' + entry.teamId + '"');
                        }
                    });
                }

                // Validate tournament matches
                if (Array.isArray(tourn.matches)) {
                    tourn.matches.forEach(function(match) {
                        if (match.team1Id) {
                            var team1Exists = data.teams && data.teams.some(function(t) {
                                return utils.normaliseId(t.id) === utils.normaliseId(match.team1Id);
                            });
                            if (!team1Exists) {
                                addWarning('Tournament "' + tourn.name + '" match references unknown team1 "' + match.team1Id + '"');
                            }
                        }
                        if (match.team2Id) {
                            var team2Exists = data.teams && data.teams.some(function(t) {
                                return utils.normaliseId(t.id) === utils.normaliseId(match.team2Id);
                            });
                            if (!team2Exists) {
                                addWarning('Tournament "' + tourn.name + '" match references unknown team2 "' + match.team2Id + '"');
                            }
                        }
                        if (match.winner) {
                            var winnerExists = false;
                            if (match.winnerType === 'team') {
                                winnerExists = data.teams && data.teams.some(function(t) {
                                    return utils.normaliseId(t.id) === utils.normaliseId(match.winner);
                                });
                            } else if (match.winnerType === 'character') {
                                winnerExists = data.characters && data.characters.some(function(c) {
                                    return utils.normaliseId(c.id) === utils.normaliseId(match.winner);
                                });
                            } else {
                                // Try both if type not specified
                                if (data.teams && data.teams.some(function(t) { return utils.normaliseId(t.id) === utils.normaliseId(match.winner); })) {
                                    winnerExists = true;
                                }
                                if (!winnerExists && data.characters && data.characters.some(function(c) { return utils.normaliseId(c.id) === utils.normaliseId(match.winner); })) {
                                    winnerExists = true;
                                }
                            }
                            if (!winnerExists) {
                                addWarning('Tournament "' + tourn.name + '" match references unknown winner "' + match.winner + '"');
                            }
                        }
                    });
                }

                // Validate tournament eliminations
                if (Array.isArray(tourn.eliminations)) {
                    tourn.eliminations.forEach(function(elim) {
                        if (elim.participantId) {
                            var participantExists = false;
                            if (elim.participantType === 'character') {
                                participantExists = data.characters && data.characters.some(function(c) {
                                    return utils.normaliseId(c.id) === utils.normaliseId(elim.participantId);
                                });
                            } else if (elim.participantType === 'team') {
                                participantExists = data.teams && data.teams.some(function(t) {
                                    return utils.normaliseId(t.id) === utils.normaliseId(elim.participantId);
                                });
                            }
                            if (!participantExists) {
                                addWarning('Tournament "' + tourn.name + '" elimination references unknown participant "' + elim.participantId + '"');
                            }
                        }
                        if (elim.teamId) {
                            var teamExists = data.teams && data.teams.some(function(t) {
                                return utils.normaliseId(t.id) === utils.normaliseId(elim.teamId);
                            });
                            if (!teamExists) {
                                addWarning('Tournament "' + tourn.name + '" elimination references unknown team "' + elim.teamId + '"');
                            }
                        }
                    });
                }

                // Validate tournament participants
                if (Array.isArray(tourn.participants)) {
                    tourn.participants.forEach(function(participant) {
                        if (participant.id) {
                            var exists = false;
                            if (participant.type === 'character') {
                                exists = data.characters && data.characters.some(function(c) {
                                    return utils.normaliseId(c.id) === utils.normaliseId(participant.id);
                                });
                            } else if (participant.type === 'team') {
                                exists = data.teams && data.teams.some(function(t) {
                                    return utils.normaliseId(t.id) === utils.normaliseId(participant.id);
                                });
                            }
                            if (!exists) {
                                addWarning('Tournament "' + tourn.name + '" references unknown participant "' + participant.id + '"');
                            }
                        }
                    });
                }

                // Validate tournament winner
                if (tourn.winner) {
                    var winnerExists = false;
                    if (data.teams && data.teams.some(function(t) { return utils.normaliseId(t.id) === utils.normaliseId(tourn.winner); })) {
                        winnerExists = true;
                    }
                    if (!winnerExists && data.characters && data.characters.some(function(c) { return utils.normaliseId(c.id) === utils.normaliseId(tourn.winner); })) {
                        winnerExists = true;
                    }
                    if (!winnerExists) {
                        addWarning('Tournament "' + tourn.name + '" references unknown winner "' + tourn.winner + '"');
                    }
                }
            });
        }
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
            msg += '\n\nNote: CSV imports Characters, Teams, Tournaments, Missions, and Disciplines,\n' +
                   'including related team and tournament records.\n' +
                   'Use JSON for complete data restoration.';
        }

        alert(msg);
    }

    // Delegate to canonical data/state layer - fail loudly if not available
    function getEmptyData() {
        if (typeof window.getDefaultData !== 'function') {
            throw new Error(
                'Cannot import CSV: canonical data initializer is unavailable.\n\n' +
                'Please ensure the application has loaded correctly before importing CSV.'
            );
        }

        return window.getDefaultData();
    }

    // Delegate to canonical curriculum initializer - fail loudly if not available
    function getEmptyCurriculum() {
        if (typeof window.getDefaultCurriculum !== 'function') {
            throw new Error(
                'Cannot import CSV: canonical curriculum initializer is unavailable.\n\n' +
                'Please ensure the application has loaded correctly before importing CSV.'
            );
        }

        return window.getDefaultCurriculum();
    }

    // Expose
    window.exportCSV = exportCSV;
    window.importCSV = importCSV;

})();
