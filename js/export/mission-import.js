/**
 * js/export/mission-import.js - Mission CSV Import
 * Path: js/export/mission-import.js
 * 
 * Imports ONLY missions from a CSV file.
 * Does NOT affect characters, teams, etc.
 * 
 * Format: MissionId, Title, Status, Priority, Difficulty, TeamId, Location,
 *          Duration, Pay, Progress, Objectives
 */

(function() {
    'use strict';

    var utils = window.ExportUtils;
    var parser = window.CSV;

    function importMissions(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var records = parser.parse(e.target.result);
                if (records.length === 0) {
                    alert('No data found in CSV file.');
                    return;
                }

                var missionRows = extractMissionRows(records);
                if (missionRows.length === 0) {
                    alert('No mission data found in CSV file.\n\n' +
                          'The file must contain a "# MISSIONS" section.');
                    return;
                }

                var imported = parseMissionRows(missionRows);
                if (imported.length === 0) {
                    alert('No valid mission data found.');
                    return;
                }

                var msg = 'This will import ' + imported.length + ' mission(s).\n\n' +
                          'Existing missions with matching IDs will be updated.\n' +
                          'New missions will be added.\n\n' +
                          'Other data (characters, teams, etc.) is NOT affected.\n\n' +
                          'Continue?';

                if (!confirm(msg)) {
                    return;
                }

                // Merge into existing data
                var existing = window.data || {};
                if (!Array.isArray(existing.missions)) {
                    existing.missions = [];
                }

                var updated = 0;
                var added = 0;

                imported.forEach(function(mission) {
                    var existingIndex = existing.missions.findIndex(function(m) {
                        return m && String(m.id) === String(mission.id);
                    });

                    if (existingIndex !== -1) {
                        existing.missions[existingIndex] = mission;
                        updated++;
                    } else {
                        existing.missions.push(mission);
                        added++;
                    }
                });

                window.data = existing;

                // Persist
                if (typeof window.saveData === 'function') {
                    window.saveData()
                        .then(function() {
                            alert('Mission import completed!\n\n' +
                                  'Added: ' + added + '\n' +
                                  'Updated: ' + updated + '\n' +
                                  'Total: ' + imported.length);
                            if (typeof window.renderAll === 'function') {
                                window.renderAll();
                            }
                            if (typeof window.renderMissions === 'function') {
                                window.renderMissions();
                            }
                        })
                        .catch(function(err) {
                            alert('Missions imported in memory, but persistence failed: ' + err.message);
                        });
                } else {
                    alert('Missions imported but could not be saved. Please refresh.');
                }

            } catch (err) {
                alert('Failed to import missions: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function extractMissionRows(records) {
        var rows = [];
        var inSection = false;

        for (var i = 0; i < records.length; i++) {
            var row = records[i];
            if (utils.isBlankRow(row)) continue;

            var first = String(row[0] || '').trim();
            if (first === '# MISSIONS') {
                inSection = true;
                i++; // Skip header
                continue;
            }

            if (inSection && first === 'MissionId') {
                // Header row - skip
                continue;
            }

            if (inSection) {
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

    function parseMissionRows(rows) {
        var missions = [];

        rows.forEach(function(row) {
            try {
                var mission = parseMissionRow(row);
                if (mission) {
                    missions.push(mission);
                }
            } catch (e) {
                console.warn('Skipping row:', row, e.message);
            }
        });

        return missions;
    }

    function parseMissionRow(row) {
        // MissionId, Title, Status, Priority, Difficulty, TeamId, Location,
        // Duration, Pay, Progress, Objectives

        var id = String(row[0] || '').trim() || 'miss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        var title = String(row[1] || '').trim();

        if (!title) {
            console.warn('Mission row missing title:', row);
            return null;
        }

        var status = String(row[2] || '').trim() || 'active';
        var priority = String(row[3] || '').trim() || 'medium';
        var difficulty = String(row[4] || '').trim() || 'medium';
        var teamId = String(row[5] || '').trim() || null;
        var location = String(row[6] || '').trim();
        var duration = String(row[7] || '').trim();
        var pay = String(row[8] || '').trim();
        var progress = parseInt(row[9], 10) || 0;
        var objectives = parseJSON(row[10], []);

        return {
            id: id,
            missionId: id,
            title: title,
            description: '',
            year: null,
            month: null,
            day: null,
            primaryType: '',
            subtype: '',
            secondaryType: '',
            escalation: 'tier_ii',
            threatType: '',
            environment: '',
            location: location,
            duration: duration,
            difficulty: difficulty,
            priority: priority,
            basePay: pay || '',
            surchargePay: '',
            pay: pay || '',
            billing: 'original',
            assignedTeamId: teamId,
            supportPersonnel: [],
            status: status,
            objectives: objectives,
            progress: progress,
            notes: '',
            tags: [],
            createdAt: new Date().toISOString(),
            completedAt: status === 'completed' ? new Date().toISOString() : null,
            log: []
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
    window.importMissionsCSV = importMissions;

})();
