/**
 * js/import-export/ui.js - Import/Export UI Wiring
 * UI binding for import/export operations - no business logic
 *
 * Path: js/import-export/ui.js
 *
 * This module wires up export/import UI controls to the underlying
 * import/export pipeline functions. It handles:
 *   - Button click handlers
 *   - File input triggers
 *   - Notifications
 *   - UI refresh after operations
 *
 * IMPORTANT:
 *   - NO business logic - delegates to pipeline modules
 *   - NO data mutation
 *   - NO persistence
 *   - Uses NotificationSystem for user feedback
 *   - Uses TabManager for UI refresh
 *   - Self-contained UI lifecycle
 *
 * ACTIVE SURFACE:
 *   Eight controls are wired today:
 *
 *     export-json-btn              download JSON backup
 *     import-json-btn              open the JSON file picker
 *     json-file-input              the picker itself
 *     export-graduates-json-btn    open the graduates export picker
 *     export-characters-csv-btn    export all characters to CSV
 *     import-characters-csv-btn    open the characters CSV picker
 *     characters-csv-file-input    the picker itself
 *     template-characters-csv-btn  download a characters CSV template
 *
 *   The character CSV controls live in the character module's page
 *   header (rendered by characters/index.js's getCharactersHTML),
 *   not in the application header. That is deliberate: they are
 *   character-specific, they belong with the character list, and
 *   they sit next to "+ Add" where the user is already looking.
 *
 *   Every control's binding lives here, in one place. There is no
 *   second binding path. See the "ONE BINDING PER CONTROL" note
 *   below.
 *
 * ONE BINDING PER CONTROL:
 *   Each header button is bound exactly once, by this module's
 *   init(). There is no delegation fallback elsewhere in the tree.
 *
 *   This is a deliberate architectural choice. Earlier revisions
 *   had character-events.js also bind the same three character CSV
 *   buttons via delegated document-level listeners, and those
 *   listeners pointed at window-level function names that never
 *   existed. The result was a button that looked wired and did
 *   nothing.
 *
 *   If a control is ever restored to a different module's markup,
 *   add its bind call HERE, not in that module. Do not split the
 *   binding across two files. The two-path pattern is what caused
 *   the character export to appear broken for a release.
 *
 * REMOVED FROM THE UI (handlers kept as public exports for callers
 * that still route to them programmatically, or for a future
 * restore):
 *
 *     Mission CSV:    export, import, template
 *     Graduates CSV:  export (the picker is shared with JSON)
 *     Teams JSON:     export (picker opens the same modal)
 *     Teams CSV:      export (same)
 *
 *   The picker-open handlers for Graduates and Teams are still
 *   exported because the picker modules themselves are unchanged
 *   and can be opened from anywhere.
 *
 * GRADUATES EXPORT:
 *   The graduate button opens a picker modal listing every class.
 *   The user picks a class, then chooses JSON or CSV inside the
 *   picker. The picker owns the download; ui.js only opens it.
 *
 * TEAMS EXPORT:
 *   The team pickers open a modal showing a pre-flight count of
 *   professional teams, members, and stints, with an optional
 *   status filter. Same rationale as graduates.
 *
 * DEPENDENCIES:
 *   - window.ExportUtils (from export-utils.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.TabManager (from tab-manager.js) - MANDATORY
 *   - window.CharacterCSV (from csv/character-csv.js) - MANDATORY
 *   - window.MissionCSV (from csv/mission-csv.js) - MANDATORY
 *   - window.ImportPipeline (from import-pipeline.js) - MANDATORY
 *   - window.JSONIO (from json-io.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.ActivityLog (from activity-log.js) - MANDATORY
 *
 * DEPENDENCIES (LAZY, resolved at click time):
 *   - window.GraduatesExportPicker
 *   - window.TeamExportPicker
 *
 * USAGE:
 *   // Auto-initializes on DOM ready
 *   // Or manually:
 *   window.ImportExportUI.init();
 */

(function() {
    'use strict';

    if (window.__importExportUILoaded) return;
    window.__importExportUILoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var deps = {
        ExportUtils: window.ExportUtils,
        NotificationSystem: window.NotificationSystem,
        TabManager: window.TabManager,
        CharacterCSV: window.CharacterCSV,
        MissionCSV: window.MissionCSV,
        ImportPipeline: window.ImportPipeline,
        JSONIO: window.JSONIO,
        MutationPipeline: window.MutationPipeline,
        ActivityLog: window.ActivityLog
    };

    var missing = [];
    for (var name in deps) {
        if (!deps[name]) {
            missing.push(name);
        }
    }

    if (missing.length > 0) {
        console.warn('[ImportExportUI] Missing dependencies (will use fallbacks):', missing.join(', '));
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _handlers = {};

    // ============================================================
    // NOTIFICATION HELPERS
    // ============================================================

    function notify(message, type) {
        var notifier = deps.NotificationSystem;

        if (notifier) {
            if (type === 'error' && typeof notifier.notifyError === 'function') {
                notifier.notifyError(message);
            } else if (type === 'warning' && typeof notifier.notifyWarning === 'function') {
                notifier.notifyWarning(message);
            } else if (type === 'success' && typeof notifier.notifySuccess === 'function') {
                notifier.notifySuccess(message);
            } else if (typeof notifier.notify === 'function') {
                notifier.notify(message, type || 'info');
            } else if (typeof notifier.notifyInfo === 'function') {
                notifier.notifyInfo(message);
            } else {
                console.log('[ImportExportUI]', message);
            }
        } else {
            console.log('[ImportExportUI]', message);
        }
    }

    function notifySuccess(message) {
        notify(message, 'success');
    }

    function notifyError(message) {
        notify(message, 'error');
    }

    function notifyWarning(message) {
        notify(message, 'warning');
    }

    function notifyInfo(message) {
        notify(message, 'info');
    }

    // ============================================================
    // UI REFRESH
    // ============================================================

    function refreshUI() {
        try {
            if (deps.TabManager && typeof deps.TabManager.refreshCurrent === 'function') {
                deps.TabManager.refreshCurrent();
            } else if (typeof window.renderAll === 'function') {
                window.renderAll();
            } else if (typeof window.renderAllFeatures === 'function') {
                window.renderAllFeatures();
            }
        } catch (e) {
            console.warn('[ImportExportUI] UI refresh failed:', e.message);
        }
    }

    // ============================================================
    // BUTTON BINDING
    // ============================================================
    //
    // bindButton and bindFileInput are the shared machinery. Both
    // silently skip a missing target: a control that is not in the
    // markup is not an error, it is a control the current UI does
    // not render.
    //
    // The clone-and-replace pattern is retained so re-init (which
    // some flows trigger via the dataReady event) does not stack
    // duplicate listeners on the same element.

    function bindButton(id, handler) {
        if (_handlers[id]) return;
        _handlers[id] = handler;

        var btn = document.getElementById(id);
        if (!btn) {
            return;
        }

        var newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', function(e) {
            e.preventDefault();
            try {
                handler(e);
            } catch (err) {
                notifyError('Operation failed: ' + err.message);
                console.error('[ImportExportUI] Error:', err);
            }
        });
    }

    function bindFileInput(id, handler) {
        if (_handlers[id]) return;
        _handlers[id] = handler;

        var input = document.getElementById(id);
        if (!input) {
            return;
        }

        var newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);

        newInput.addEventListener('change', function() {
            if (this.files && this.files.length > 0) {
                try {
                    handler(this.files[0]);
                } catch (err) {
                    notifyError('File operation failed: ' + err.message);
                    console.error('[ImportExportUI] File error:', err);
                }
                this.value = '';
            }
        });
    }

    function triggerFileInput(id) {
        var input = document.getElementById(id);
        if (input) {
            input.click();
        } else {
            notifyError('File input not found');
        }
    }

    // ============================================================
    // HANDLERS - JSON
    // ============================================================

    function handleJSONExport() {
        var JSONIO = deps.JSONIO;
        if (!JSONIO) {
            notifyError('JSON export not available');
            return;
        }

        if (typeof JSONIO.exportJSON !== 'function') {
            notifyError('JSON export not available');
            return;
        }

        var data = window.data || {};
        var result = JSONIO.exportJSON(data, { pretty: true });

        if (result.exported) {
            notifySuccess('JSON backup exported: ' + result.filename);
            try {
                deps.ActivityLog.record('Exported JSON backup: ' + result.filename, 'export');
            } catch (e) {
                // Non-fatal
            }
        } else {
            notifyError('Export failed: ' + (result.error || 'Unknown error'));
        }
    }

    function handleJSONImport(file) {
        var JSONIO = deps.JSONIO;
        var Pipeline = deps.ImportPipeline;

        if (!JSONIO || typeof JSONIO.importJSONFromFile !== 'function') {
            notifyError('JSON import not available');
            return;
        }

        JSONIO.importJSONFromFile(file)
            .then(function(result) {
                if (!result.valid) {
                    notifyError('JSON import failed: ' + (result.error || 'Unknown error'));
                    return;
                }

                if (!JSONIO.hasData(result.data)) {
                    notifyWarning('No application data found in JSON file.');
                    return;
                }

                var summary = JSONIO.getDataSummary(result.data);
                var msg = 'JSON import parsed successfully.\n\n';
                msg += 'Records found:\n';
                for (var key in summary.collections) {
                    if (summary.collections.hasOwnProperty(key)) {
                        var val = summary.collections[key];
                        if (typeof val === 'object') {
                            var subParts = [];
                            for (var subKey in val) {
                                if (val.hasOwnProperty(subKey)) {
                                    subParts.push(subKey + ': ' + val[subKey]);
                                }
                            }
                            msg += '  - ' + key + ': { ' + subParts.join(', ') + ' }\n';
                        } else {
                            msg += '  - ' + key + ': ' + val + '\n';
                        }
                    }
                }
                msg += '\nTotal: ' + summary.total + ' records';
                msg += '\n\nThis will replace all current data. Continue?';

                if (!confirm(msg)) {
                    return;
                }

                if (Pipeline && typeof Pipeline.importFromEnvelope === 'function') {
                    if (result.data.format && result.data.format === 'hollow-blades') {
                        return Pipeline.importFromEnvelope(result.data, {
                            sourceName: file.name,
                            preserveExistingIds: true,
                            autoFixIds: true,
                            skipValidation: false
                        });
                    } else {
                        return Pipeline.importFromJSON(JSON.stringify(result.data), {
                            sourceName: file.name,
                            preserveExistingIds: true,
                            autoFixIds: true,
                            skipValidation: false
                        });
                    }
                } else {
                    return new Promise(function(resolve, reject) {
                        deps.MutationPipeline.performMutation({
                            validate: function() {
                                return { valid: true };
                            },
                            mutate: function(data) {
                                var keys = Object.keys(data);
                                for (var i = 0; i < keys.length; i++) {
                                    delete data[keys[i]];
                                }
                                var newKeys = Object.keys(result.data);
                                for (var j = 0; j < newKeys.length; j++) {
                                    data[newKeys[j]] = result.data[newKeys[j]];
                                }
                            },
                            logMessage: 'Imported data from JSON: ' + file.name,
                            successMessage: 'JSON import completed: ' + summary.total + ' records imported',
                            failureMessage: 'JSON import failed'
                        }).then(function(mutationResult) {
                            if (mutationResult.success) {
                                resolve({ success: true });
                            } else {
                                reject(new Error(mutationResult.message || 'Import failed'));
                            }
                        });
                    });
                }
            })
            .then(function(importResult) {
                if (importResult && importResult.success) {
                    var details = importResult.details || {};
                    var summary = details.summary || {};
                    var message = 'JSON import completed successfully';
                    if (summary.totalRecords !== undefined) {
                        message += ': ' + summary.totalRecords + ' records';
                    }
                    notifySuccess(message);
                    refreshUI();
                } else if (importResult && !importResult.success) {
                    var errors = importResult.errors || [];
                    var errorMsg = errors.length > 0 ? errors[0] : 'Unknown error';
                    notifyError('JSON import failed: ' + errorMsg);
                }
            })
            .catch(function(err) {
                notifyError('JSON import failed: ' + err.message);
            });
    }

    // ============================================================
    // HANDLERS - Character CSV
    // ============================================================
    //
    // Bound by init() above. The three header buttons in the
    // character module's page header route here through
    // bindButton / bindFileInput.

    function handleCharacterExport() {
        var CharacterCSV = deps.CharacterCSV;
        if (!CharacterCSV || typeof CharacterCSV.exportFromData !== 'function') {
            notifyError('Character export not available');
            return;
        }

        try {
            var result = CharacterCSV.exportFromData();
            if (result && result.message) {
                if (result.message === 'No characters to export.') {
                    notifyWarning(result.message);
                } else {
                    notifySuccess(result.message);
                    try {
                        deps.ActivityLog.record('Exported ' + result.count + ' characters to CSV', 'export');
                    } catch (e) {
                        // Non-fatal
                    }
                }
            } else if (result && result.count !== undefined) {
                notifySuccess('Exported ' + result.count + ' characters');
            } else {
                notifySuccess('Characters exported');
            }
        } catch (err) {
            notifyError('Export failed: ' + err.message);
        }
    }

    function handleCharacterImport(file) {
        var CharacterCSV = deps.CharacterCSV;
        if (!CharacterCSV || typeof CharacterCSV.importFromFile !== 'function') {
            notifyError('Character import not available');
            return;
        }

        CharacterCSV.importFromFile(file)
            .then(function(result) {
                if (result.hasErrors()) {
                    var summary = result.getSummary();
                    var msg = 'Found ' + summary.errors + ' error(s) in the file.\n\n';
                    var errors = result.getErrors(true);
                    for (var i = 0; i < Math.min(errors.length, 5); i++) {
                        var err = errors[i];
                        var rowInfo = err.metadata && err.metadata.row ? 'Row ' + err.metadata.row + ': ' : '';
                        msg += rowInfo + err.message + '\n';
                    }
                    if (errors.length > 5) {
                        msg += '\n... and ' + (errors.length - 5) + ' more errors.';
                    }
                    if (!confirm(msg + '\n\nContinue with valid rows?')) {
                        return;
                    }
                }

                if (!result.hasValid()) {
                    notifyWarning('No valid characters found to import.');
                    return;
                }

                var candidates = result.getValid();
                var summary = result.getSummary();

                var confirmMsg = 'Import ' + candidates.length + ' character(s)?\n\n';
                confirmMsg += 'Valid rows: ' + summary.valid + '\n';
                if (summary.errors > 0) confirmMsg += 'Errors: ' + summary.errors + ' (skipped)\n';
                if (summary.warnings > 0) confirmMsg += 'Warnings: ' + summary.warnings;

                if (!confirm(confirmMsg)) return;

                if (window.CharacterCore && typeof window.CharacterCore.importCharacters === 'function') {
                    return window.CharacterCore.importCharacters(candidates);
                } else {
                    return new Promise(function(resolve, reject) {
                        deps.MutationPipeline.performMutation({
                            validate: function(data) {
                                if (!Array.isArray(data.characters)) {
                                    return { valid: false, message: 'Characters data not available.' };
                                }
                                return { valid: true };
                            },
                            mutate: function(data) {
                                for (var j = 0; j < candidates.length; j++) {
                                    var candidate = candidates[j];
                                    if (candidate.id) {
                                        var found = false;
                                        for (var k = 0; k < data.characters.length; k++) {
                                            if (String(data.characters[k].id) === String(candidate.id)) {
                                                data.characters[k] = candidate;
                                                found = true;
                                                break;
                                            }
                                        }
                                        if (!found) {
                                            data.characters.push(candidate);
                                        }
                                    } else {
                                        data.characters.push(candidate);
                                    }
                                }
                            },
                            logMessage: 'Imported ' + candidates.length + ' characters from CSV',
                            successMessage: 'Import completed: ' + candidates.length + ' characters imported',
                            failureMessage: 'Character import failed'
                        }).then(function(mutationResult) {
                            if (mutationResult.success) {
                                resolve({ success: true, added: candidates.length });
                            } else {
                                reject(new Error(mutationResult.message || 'Import failed'));
                            }
                        });
                    });
                }
            })
            .then(function(importResult) {
                if (importResult && importResult.success !== false) {
                    var added = importResult.added || importResult.count || 0;
                    notifySuccess('Character import completed: ' + added + ' characters processed');
                    refreshUI();
                }
            })
            .catch(function(err) {
                notifyError('Import failed: ' + err.message);
            });
    }

    function handleCharacterTemplate() {
        var CharacterCSV = deps.CharacterCSV;
        if (!CharacterCSV || typeof CharacterCSV.exportTemplate !== 'function') {
            notifyError('Character template not available');
            return;
        }

        try {
            var result = CharacterCSV.exportTemplate();
            if (result && result.exported) {
                notifySuccess('Character template downloaded: ' + result.filename);
            } else {
                notifySuccess('Character template downloaded');
            }
        } catch (err) {
            notifyError('Template generation failed: ' + err.message);
        }
    }

    // ============================================================
    // HANDLERS - Mission CSV
    // ============================================================
    //
    // No bound controls today. Kept as public exports for a future
    // restore of the mission CSV buttons.

    function handleMissionExport() {
        var MissionCSV = deps.MissionCSV;
        if (!MissionCSV || typeof MissionCSV.exportFromData !== 'function') {
            notifyError('Mission export not available');
            return;
        }

        try {
            var result = MissionCSV.exportFromData();
            if (result && result.message) {
                if (result.message === 'No missions to export.') {
                    notifyWarning(result.message);
                } else {
                    notifySuccess(result.message);
                    try {
                        deps.ActivityLog.record('Exported ' + result.count + ' missions to CSV', 'export');
                    } catch (e) {
                        // Non-fatal
                    }
                }
            } else if (result && result.count !== undefined) {
                notifySuccess('Exported ' + result.count + ' missions');
            } else {
                notifySuccess('Missions exported');
            }
        } catch (err) {
            notifyError('Export failed: ' + err.message);
        }
    }

    function handleMissionImport(file) {
        var MissionCSV = deps.MissionCSV;
        if (!MissionCSV || typeof MissionCSV.importFromFile !== 'function') {
            notifyError('Mission import not available');
            return;
        }

        MissionCSV.importFromFile(file)
            .then(function(result) {
                if (result.hasErrors()) {
                    var summary = result.getSummary();
                    var msg = 'Found ' + summary.errors + ' error(s) in the file.\n\n';
                    var errors = result.getErrors(true);
                    for (var i = 0; i < Math.min(errors.length, 5); i++) {
                        var err = errors[i];
                        var rowInfo = err.metadata && err.metadata.row ? 'Row ' + err.metadata.row + ': ' : '';
                        msg += rowInfo + err.message + '\n';
                    }
                    if (errors.length > 5) {
                        msg += '\n... and ' + (errors.length - 5) + ' more errors.';
                    }
                    if (!confirm(msg + '\n\nContinue with valid rows?')) {
                        return;
                    }
                }

                if (!result.hasValid()) {
                    notifyWarning('No valid missions found to import.');
                    return;
                }

                var candidates = result.getValid();
                var summary = result.getSummary();

                var confirmMsg = 'Import ' + candidates.length + ' mission(s)?\n\n';
                confirmMsg += 'Valid rows: ' + summary.valid + '\n';
                if (summary.errors > 0) confirmMsg += 'Errors: ' + summary.errors + ' (skipped)\n';
                if (summary.warnings > 0) confirmMsg += 'Warnings: ' + summary.warnings;

                if (!confirm(confirmMsg)) return;

                if (window.MissionCore && typeof window.MissionCore.importMissions === 'function') {
                    return window.MissionCore.importMissions(candidates);
                } else {
                    return new Promise(function(resolve, reject) {
                        deps.MutationPipeline.performMutation({
                            validate: function(data) {
                                if (!Array.isArray(data.missions)) {
                                    return { valid: false, message: 'Missions data not available.' };
                                }
                                return { valid: true };
                            },
                            mutate: function(data) {
                                for (var j = 0; j < candidates.length; j++) {
                                    var candidate = candidates[j];
                                    if (candidate.id) {
                                        var found = false;
                                        for (var k = 0; k < data.missions.length; k++) {
                                            if (String(data.missions[k].id) === String(candidate.id)) {
                                                data.missions[k] = candidate;
                                                found = true;
                                                break;
                                            }
                                        }
                                        if (!found) {
                                            data.missions.push(candidate);
                                        }
                                    } else {
                                        data.missions.push(candidate);
                                    }
                                }
                            },
                            logMessage: 'Imported ' + candidates.length + ' missions from CSV',
                            successMessage: 'Import completed: ' + candidates.length + ' missions imported',
                            failureMessage: 'Mission import failed'
                        }).then(function(mutationResult) {
                            if (mutationResult.success) {
                                resolve({ success: true, added: candidates.length });
                            } else {
                                reject(new Error(mutationResult.message || 'Import failed'));
                            }
                        });
                    });
                }
            })
            .then(function(importResult) {
                if (importResult && importResult.success !== false) {
                    var added = importResult.added || importResult.count || 0;
                    notifySuccess('Mission import completed: ' + added + ' missions processed');
                    refreshUI();
                }
            })
            .catch(function(err) {
                notifyError('Import failed: ' + err.message);
            });
    }

    function handleMissionTemplate() {
        var MissionCSV = deps.MissionCSV;
        if (!MissionCSV || typeof MissionCSV.exportTemplate !== 'function') {
            notifyError('Mission template not available');
            return;
        }

        try {
            var result = MissionCSV.exportTemplate();
            if (result && result.exported) {
                notifySuccess('Mission template downloaded: ' + result.filename);
            } else {
                notifySuccess('Mission template downloaded');
            }
        } catch (err) {
            notifyError('Template generation failed: ' + err.message);
        }
    }

    // ============================================================
    // HANDLERS - Graduates Export
    // ============================================================
    //
    // The header exposes one graduates button (JSON). The picker
    // itself offers both JSON and CSV. The CSV handler remains
    // exported for callers that open the picker directly.

    function getGraduatesExportPicker() {
        return window.GraduatesExportPicker || null;
    }

    function handleGraduatesJSONExport() {
        var Picker = getGraduatesExportPicker();
        if (!Picker || typeof Picker.openModal !== 'function') {
            notifyError('Graduates export not available');
            return;
        }
        try {
            Picker.openModal();
        } catch (err) {
            notifyError('Graduates export failed: ' + err.message);
        }
    }

    function handleGraduatesCSVExport() {
        var Picker = getGraduatesExportPicker();
        if (!Picker || typeof Picker.openModal !== 'function') {
            notifyError('Graduates export not available');
            return;
        }
        try {
            Picker.openModal();
        } catch (err) {
            notifyError('Graduates export failed: ' + err.message);
        }
    }

    // ============================================================
    // HANDLERS - Teams Export
    // ============================================================
    //
    // No bound controls today. Both handlers open the same picker;
    // the format is chosen inside the modal. Kept as public exports
    // for callers that open the picker directly.

    function getTeamExportPicker() {
        return window.TeamExportPicker || null;
    }

    function handleTeamsJSONExport() {
        var Picker = getTeamExportPicker();
        if (!Picker || typeof Picker.openModal !== 'function') {
            notifyError('Team export not available');
            return;
        }
        try {
            Picker.openModal();
        } catch (err) {
            notifyError('Team export failed: ' + err.message);
        }
    }

    function handleTeamsCSVExport() {
        var Picker = getTeamExportPicker();
        if (!Picker || typeof Picker.openModal !== 'function') {
            notifyError('Team export not available');
            return;
        }
        try {
            Picker.openModal();
        } catch (err) {
            notifyError('Team export failed: ' + err.message);
        }
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================
    //
    // Every header control is bound here, and only here. See the
    // ONE BINDING PER CONTROL note in the file header.
    //
    // If a control is restored to the markup, add its bind call
    // here. Do not split the binding across two files.

    function init() {
        if (_initialized) return;
        _initialized = true;

        if (!deps.ExportUtils) {
            console.warn('[ImportExportUI] ExportUtils not available - exports will not work');
        }
        if (!deps.NotificationSystem) {
            console.warn('[ImportExportUI] NotificationSystem not available - notifications will fallback to console');
        }

        // ---- JSON Backup ----
        bindButton('export-json-btn', handleJSONExport);
        bindButton('import-json-btn', function() {
            triggerFileInput('json-file-input');
        });
        bindFileInput('json-file-input', handleJSONImport);

        // ---- Graduates Export ----
        // One button. The picker offers JSON and CSV inside.
        bindButton('export-graduates-json-btn', handleGraduatesJSONExport);

        // ---- Character CSV ----
        // Three buttons in the character module's page header
        // (rendered by characters/index.js's getCharactersHTML),
        // plus the hidden file input next to them.
        //
        // The character page re-renders on every list refresh, so
        // the buttons are re-created each time. bindButton uses the
        // clone-and-replace pattern, which means a re-bind after a
        // re-render works correctly without stacking listeners.
        bindButton('export-characters-csv-btn', handleCharacterExport);
        bindButton('import-characters-csv-btn', function() {
            triggerFileInput('characters-csv-file-input');
        });
        bindFileInput('characters-csv-file-input', handleCharacterImport);
        bindButton('template-characters-csv-btn', handleCharacterTemplate);

        // --------------------------------------------------------
        // NOT WIRED
        // --------------------------------------------------------
        //
        // The controls below have no markup in index.html. Their
        // handlers are still exported above; do not bind them here
        // until the markup returns.
        //
        //   export-missions-csv-btn
        //   import-missions-csv-btn
        //   missions-csv-file-input
        //   template-missions-csv-btn
        //   export-graduates-csv-btn
        //   export-teams-json-btn
        //   export-teams-csv-btn
    }

    // ============================================================
    // DESTROY / CLEANUP
    // ============================================================

    function destroy() {
        _initialized = false;
        _handlers = {};
    }

    // ============================================================
    // LIFECYCLE
    // ============================================================

    function tryInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            init();
        } else {
            document.addEventListener('DOMContentLoaded', init);
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ImportExportUI = {
        init: init,
        destroy: destroy,

        // Handlers (exposed for testing and for callers that route
        // to them programmatically; see the header's ACTIVE SURFACE
        // and REMOVED FROM THE UI notes)
        handleJSONExport: handleJSONExport,
        handleJSONImport: handleJSONImport,
        handleCharacterExport: handleCharacterExport,
        handleCharacterImport: handleCharacterImport,
        handleCharacterTemplate: handleCharacterTemplate,
        handleMissionExport: handleMissionExport,
        handleMissionImport: handleMissionImport,
        handleMissionTemplate: handleMissionTemplate,
        handleGraduatesJSONExport: handleGraduatesJSONExport,
        handleGraduatesCSVExport: handleGraduatesCSVExport,
        handleTeamsJSONExport: handleTeamsJSONExport,
        handleTeamsCSVExport: handleTeamsCSVExport,

        // Utilities
        bindButton: bindButton,
        bindFileInput: bindFileInput,
        triggerFileInput: triggerFileInput,
        refreshUI: refreshUI,
        notify: notify
    };

    // ============================================================
    // AUTO-INIT
    // ============================================================

    tryInit();

    document.addEventListener('dataReady', function() {
        if (!_initialized) {
            init();
        }
    });

})();
