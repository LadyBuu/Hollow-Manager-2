/**
 * js/import-export/ui.js - Import/Export UI Wiring
 * UI binding for import/export operations - no business logic
 *
 * Path: js/import-export/ui.js
 *
 * ACTIVE SURFACE (this revision):
 *   Three controls are wired today:
 *
 *     export-json-btn              download JSON backup
 *     import-json-btn              open the JSON file picker
 *     json-file-input              the picker itself
 *     export-graduates-json-btn    open the graduates export picker
 *     import-characters-csv-btn    open the characters CSV picker
 *     characters-csv-file-input    the picker itself
 *
 *   The character CSV EXPORT button and TEMPLATE button are no
 *   longer bound here. They are gone from the character page
 *   header, replaced by a single Export button that opens
 *   CharacterExportPicker. character-events.js owns that button
 *   because it lives inside the character page's re-rendered
 *   header.
 *
 *   Import stays here because it is plain file plumbing and its
 *   button is mounted by characters/index.js, then never
 *   re-rendered.
 *
 * ONE BINDING PER CONTROL:
 *   Each header button is bound exactly once, by this module's
 *   init() (for its three), or by character-events.js's init()
 *   (for the two character-page buttons that are NOT bound here).
 *
 * IMPORT SAFETY (this revision):
 *   Every import path routes through its owning domain's import
 *   entry point:
 *
 *     JSON backup   -> ImportPipeline.importFromEnvelope (or
 *                      importFromJSON when the file is raw)
 *     Character CSV -> CharacterCore.importCharacters
 *     Mission CSV   -> MissionCore.importMissions
 *
 *   The previous version had fallback branches that called
 *   MutationPipeline.performMutation directly, bypassing envelope
 *   validation, format migration, cross-domain validation, the
 *   empty-required-sections guard, ID uniquification, and
 *   reference updating. Those branches are gone. When the owning
 *   domain entry point is unavailable, the import refuses to run
 *   and notifies the user, rather than proceeding through a
 *   reduced-safety path.
 *
 *   The check is not a matter of caution for caution's sake: an
 *   import that does not go through the pipeline is an import
 *   that can silently wipe the store, and the confirm dialog
 *   warns about data loss that the fallback path would actually
 *   cause without the safeguards meant to prevent it.
 *
 * JSON IMPORT CONFIRM:
 *   The file-content summary shown before a JSON import is
 *   rendered as a native browser dialog (window.confirm). The
 *   wording is deliberately front-loaded: filename and total on
 *   the first line, "will replace" warning on the second, record
 *   breakdown below. A follow-up pass will replace it with a
 *   proper modal matching the pattern used by
 *   character-json-io.js and character-export-picker.js.
 *
 * JSON ROUND-TRIP (temporary):
 *   The raw-data branch below still calls
 *   Pipeline.importFromJSON(JSON.stringify(result.data), ...)
 *   even though result.data is already a parsed object. This is
 *   a temporary inefficiency left over from before the pipeline
 *   exposed an object-based entry point. It will be replaced by
 *   Pipeline.importFromObject(result.data, ...) once that entry
 *   point lands. The JSON round-trip is provably lossless for
 *   data that came out of JSON.parse, so the current code is
 *   correct; it is simply wasteful.
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
 *   - window.CharacterCore
 *   - window.MissionCore
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
    // ERROR NORMALISATION
    // ============================================================

    function errorToDisplayString(e) {
        if (typeof e === 'string') {
            return e;
        }

        if (e && typeof e === 'object') {
            var where = [];
            if (e.section) { where.push(e.section); }
            if (e.entityId) { where.push('entity ' + e.entityId); }
            if (e.field) { where.push('field ' + e.field); }
            if (e.targetId) { where.push('target ' + e.targetId); }

            var msg = e.message || 'Validation error';
            if (where.length > 0) {
                msg += ' [' + where.join(', ') + ']';
            }
            return msg;
        }

        return String(e);
    }

    function logErrors(label, errors) {
        if (!errors || errors.length === 0) {
            return;
        }
        console.error(
            '[ImportExportUI] ' + label + ' (' + errors.length + '):'
        );
        for (var i = 0; i < errors.length; i++) {
            console.error('  ' + (i + 1) + '.', errors[i]);
        }
    }

    function logWarnings(label, warnings) {
        if (!warnings || warnings.length === 0) {
            return;
        }
        console.warn(
            '[ImportExportUI] ' + label + ' (' + warnings.length + '):'
        );
        for (var i = 0; i < warnings.length; i++) {
            console.warn('  ' + (i + 1) + '.', warnings[i]);
        }
    }

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

    /**
     * Build the human-readable summary shown before a JSON import.
     *
     * Front-loaded for the native confirm dialog: filename and
     * total on the first line, "will replace" warning next, then a
     * compact breakdown of the top record counts.
     */
    function buildJSONImportConfirmMessage(filename, summary) {
        var lines = [];

        lines.push('Import "' + filename + '"?');
        lines.push('');
        lines.push('This will REPLACE all current application data.');
        lines.push('');

        // Show up to 5 top-level collections to keep the dialog
        // readable. Anything beyond that is summarised as "and N
        // more".
        var collectionNames = Object.keys(summary.collections);
        var shown = 0;
        var shownNames = [];

        for (var i = 0; i < collectionNames.length && shown < 5; i++) {
            var key = collectionNames[i];
            var val = summary.collections[key];

            if (typeof val === 'number') {
                if (val === 0) {
                    continue;
                }
                shownNames.push(key + ': ' + val);
                shown++;
            } else if (typeof val === 'object' && val !== null) {
                var subParts = [];
                var subKeys = Object.keys(val);
                for (var j = 0; j < subKeys.length; j++) {
                    var subKey = subKeys[j];
                    if (typeof val[subKey] === 'number' && val[subKey] > 0) {
                        subParts.push(subKey + ': ' + val[subKey]);
                    }
                }
                if (subParts.length > 0) {
                    shownNames.push(key + ' (' + subParts.join(', ') + ')');
                    shown++;
                }
            }
        }

        if (shownNames.length > 0) {
            lines.push('Contents: ' + shownNames.join(', '));
        }

        var remaining = 0;
        for (var k = 0; k < collectionNames.length; k++) {
            var v = summary.collections[collectionNames[k]];
            if (typeof v === 'number' && v > 0) {
                remaining++;
            }
        }
        if (remaining > shown) {
            lines.push('  (and ' + (remaining - shown) + ' more sections)');
        }

        lines.push('');
        lines.push('Total: ' + summary.total + ' records');
        lines.push('');
        lines.push('Continue?');

        return lines.join('\n');
    }

    function handleJSONImport(file) {
        var JSONIO = deps.JSONIO;
        var Pipeline = deps.ImportPipeline;

        if (!JSONIO || typeof JSONIO.importJSONFromFile !== 'function') {
            notifyError('JSON import not available');
            return;
        }

        // Import safety: when the pipeline is unavailable, refuse
        // to import rather than proceeding through a reduced path.
        // A JSON import that does not go through the pipeline can
        // wipe the store.
        if (!Pipeline) {
            notifyError(
                'Import pipeline not available. Reload the page ' +
                'and try again.'
            );
            return;
        }

        JSONIO.importJSONFromFile(file)
            .then(function(result) {
                if (!result.valid) {
                    console.error(
                        '[JSON import] parse/validation failed. Full result:',
                        result
                    );
                    notifyError('JSON import failed: ' + (result.error || 'Unknown error'));
                    return;
                }

                if (!JSONIO.hasData(result.data)) {
                    notifyWarning('No application data found in JSON file.');
                    return;
                }

                var summary = JSONIO.getDataSummary(result.data);
                var confirmMsg = buildJSONImportConfirmMessage(
                    file.name,
                    summary
                );

                if (!confirm(confirmMsg)) {
                    return;
                }

                if (result.data.format && result.data.format === 'hollow-blades') {
                    return Pipeline.importFromEnvelope(result.data, {
                        sourceName: file.name,
                        preserveExistingIds: true,
                        autoFixIds: true,
                        skipValidation: false
                    });
                }

                // Raw data (no envelope). Route through
                // importFromJSON, which builds an envelope from the
                // raw object and delegates to importFromEnvelope.
                //
                // The JSON.stringify call is a temporary
                // inefficiency: result.data is already a parsed
                // object. When import-pipeline.js exposes
                // importFromObject(data, options), this call will
                // become Pipeline.importFromObject(result.data,
                // ...) and the round-trip will disappear.
                return Pipeline.importFromJSON(JSON.stringify(result.data), {
                    sourceName: file.name,
                    preserveExistingIds: true,
                    autoFixIds: true,
                    skipValidation: false
                });
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
                    return;
                }

                if (importResult && !importResult.success) {
                    var errors = importResult.errors || [];
                    var warnings = importResult.warnings || [];

                    console.error(
                        '[JSON import] failed. Full result:',
                        importResult
                    );
                    logErrors('errors', errors);
                    logWarnings('warnings', warnings);

                    var first = errors[0];
                    var errorMsg = errorToDisplayString(first) ||
                        'Unknown error';

                    if (errors.length > 1) {
                        errorMsg += ' \u2014 ' + (errors.length - 1) +
                            ' more error(s), see console';
                    }

                    notifyError('JSON import failed: ' + errorMsg);
                    return;
                }

                // The parse path returned nothing (user cancelled
                // the confirm dialog). Silent return.
            })
            .catch(function(err) {
                console.error('[JSON import] threw:', err);
                notifyError(
                    'JSON import failed: ' +
                    (err && err.message ? err.message : String(err))
                );
            });
    }

    // ============================================================
    // HANDLERS - Character CSV
    // ============================================================
    //
    // IMPORT ONLY. Export and template now go through
    // CharacterExportPicker, which is bound by character-events.js
    // because its trigger button lives inside the character page's
    // re-rendered header.

    function handleCharacterImport(file) {
        var CharacterCSV = deps.CharacterCSV;
        if (!CharacterCSV || typeof CharacterCSV.importFromFile !== 'function') {
            notifyError('Character import not available');
            return;
        }

        var CharacterCore = window.CharacterCore || null;
        if (!CharacterCore ||
            typeof CharacterCore.importCharacters !== 'function') {
            // Import safety: without CharacterCore, there is no
            // entry point that validates the candidate list before
            // it reaches the store. Refuse rather than mutating
            // the store directly.
            notifyError(
                'Character import is not available. Reload the ' +
                'page and try again.'
            );
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

                return CharacterCore.importCharacters(candidates);
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

        var MissionCore = window.MissionCore || null;
        if (!MissionCore ||
            typeof MissionCore.importMissions !== 'function') {
            // Import safety: see handleCharacterImport.
            notifyError(
                'Mission import is not available. Reload the ' +
                'page and try again.'
            );
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

                return MissionCore.importMissions(candidates);
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
    // ONLY the JSON controls and the character CSV IMPORT control
    // are bound here. The character EXPORT and FILLERS controls
    // are bound by character-events.js because they live in the
    // character page's re-rendered header.
    //
    // See the ACTIVE SURFACE note in the file header.

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
        bindButton('export-graduates-json-btn', handleGraduatesJSONExport);

        // ---- Character CSV import ----
        //
        // The import button lives in the character page header.
        // It is mounted by characters/index.js and never
        // re-rendered, so binding it here is safe.
        bindButton('import-characters-csv-btn', function() {
            triggerFileInput('characters-csv-file-input');
        });
        bindFileInput('characters-csv-file-input', handleCharacterImport);
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

        // Handlers (exposed for testing and programmatic use)
        handleJSONExport: handleJSONExport,
        handleJSONImport: handleJSONImport,
        handleCharacterImport: handleCharacterImport,
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
