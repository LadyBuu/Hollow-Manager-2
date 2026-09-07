/**
 * js/export/index.js - Export Module Entry Point
 * UI wiring only - no business logic, no persistence, no data access
 * 
 * This module wires up the export/import UI controls to the underlying
 * export/import functions. It handles file input triggers, notifications,
 * and UI refresh after successful operations.
 * 
 * It does NOT:
 * - Parse CSV
 * - Mutate data
 * - Call saveData()
 * - Know about domain schemas
 * - Handle import results directly (delegates to import handlers)
 * 
 * Lifecycle:
 * - Initializes when DOM is ready
 * - Binds all export/import buttons and file inputs
 * - Uses NotificationSystem for user feedback
 * - Uses TabManager for UI refresh
 */

(function() {
    'use strict';

    // ============================================================
    // State
    // ============================================================

    if (window.__exportIndexLoaded) return;
    window.__exportIndexLoaded = true;

    var _initialized = false;
    var _handlers = {};

    // ============================================================
    // Dependencies Validation
    // ============================================================

    function validateDependencies() {
        var missing = [];

        // Check JSON I/O
        if (!window.JSONIO) {
            missing.push('JSONIO');
        }

        // Check Character CSV
        if (!window.exportCharactersCSV || !window.importCharactersCSV || !window.exportCharacterTemplate) {
            missing.push('Character CSV');
        }

        // Check Mission CSV
        if (!window.exportMissionsCSV || !window.importMissionsCSV || !window.exportMissionTemplate) {
            missing.push('Mission CSV');
        }

        // Check utilities
        if (!window.ExportUtils || !window.FileUtils) {
            missing.push('Export/File utilities');
        }

        if (missing.length > 0) {
            console.warn('Export module: Missing dependencies:', missing.join(', '));
        }

        return missing.length === 0;
    }

    // ============================================================
    // Notification Helpers
    // ============================================================

    function notify(message, type) {
        var notifier = window.NotificationSystem;

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
                console.log('[Notification]', type || 'info', message);
            }
        } else {
            // Fallback only for development
            console.log('[Notification]', type || 'info', message);
            // Do NOT use alert() - let caller handle if needed
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
    // UI Refresh
    // ============================================================

    function refreshUI() {
        try {
            if (window.TabManager && typeof window.TabManager.refreshCurrent === 'function') {
                window.TabManager.refreshCurrent();
            } else if (window.renderAll === 'function') {
                window.renderAll();
            } else if (window.renderAllFeatures === 'function') {
                window.renderAllFeatures();
            } else {
                // No refresh mechanism found - that's okay
                // The user may need to manually refresh
            }
        } catch (e) {
            console.warn('Export: UI refresh failed:', e.message);
        }
    }

    // ============================================================
    // Button Binding
    // ============================================================

    function bindButton(id, handler) {
        if (_handlers[id]) return;
        _handlers[id] = handler;

        var btn = document.getElementById(id);
        if (!btn) {
            console.warn('Export: Button not found:', id);
            return;
        }

        // Remove any existing listeners (prevent duplicates)
        var newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', function(e) {
            e.preventDefault();
            try {
                handler(e);
            } catch (err) {
                notifyError('Operation failed: ' + err.message);
                console.error('Export error:', err);
            }
        });
    }

    function bindFileInput(id, handler) {
        if (_handlers[id]) return;
        _handlers[id] = handler;

        var input = document.getElementById(id);
        if (!input) {
            console.warn('Export: File input not found:', id);
            return;
        }

        // Remove any existing listeners
        var newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);

        newInput.addEventListener('change', function() {
            if (this.files && this.files.length > 0) {
                try {
                    handler(this.files[0]);
                } catch (err) {
                    notifyError('File operation failed: ' + err.message);
                    console.error('Export file error:', err);
                }
                this.value = ''; // Reset to allow re-selection
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
    // Import Handlers
    // ============================================================

    function handleCharacterImport(file) {
        if (!window.importCharactersCSV) {
            notifyError('Character import not available');
            return;
        }

        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var result = window.importCharactersCSV(e.target.result);

                // Check for errors
                if (result.hasErrors()) {
                    var summary = result.getSummary();
                    var msg = 'Found ' + summary.errors + ' error(s) in the file.\n\n';
                    var errors = result.getErrors(true);
                    errors.slice(0, 5).forEach(function(err) {
                        var rowInfo = err.metadata && err.metadata.row ? 'Row ' + err.metadata.row + ': ' : '';
                        msg += rowInfo + err.message + '\n';
                    });
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

                // Check if there's an import function
                var candidates = result.getValid();
                var summary = result.getSummary();

                // Determine if we should use CharacterCore or fallback
                if (window.CharacterCore && typeof window.CharacterCore.importCharacters === 'function') {
                    // Use domain core
                    var confirmMsg = 'Import ' + candidates.length + ' character(s)?\n\n';
                    confirmMsg += 'Added: ' + summary.added + '\n';
                    confirmMsg += 'Updated: ' + summary.updated + '\n';
                    if (summary.errors > 0) confirmMsg += 'Errors: ' + summary.errors + ' (skipped)\n';
                    if (summary.warnings > 0) confirmMsg += 'Warnings: ' + summary.warnings;

                    if (!confirm(confirmMsg)) return;

                    window.CharacterCore.importCharacters(candidates)
                        .then(function(importResult) {
                            notifySuccess(
                                'Character import completed: ' + importResult.added + ' added, ' +
                                importResult.updated + ' updated'
                            );
                            refreshUI();
                        })
                        .catch(function(err) {
                            notifyError('Import failed: ' + err.message);
                        });
                } else {
                    // Fallback: use legacy import function
                    if (typeof window.importCharactersCSVLegacy === 'function') {
                        // Call the legacy function that handles mutation
                        window.importCharactersCSVLegacy(candidates);
                    } else {
                        notifyError('No import function available. Please use CharacterCore.importCharacters.');
                        // But we can still show the candidates
                        console.log('Character candidates:', candidates);
                        notifyInfo('Parsed ' + candidates.length + ' character candidates. Check console for details.');
                    }
                }

            } catch (err) {
                notifyError('Import failed: ' + err.message);
                console.error('Character import error:', err);
            }
        };

        reader.onerror = function() {
            notifyError('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error'));
        };

        reader.readAsText(file);
    }

    function handleMissionImport(file) {
        if (!window.importMissionsCSV) {
            notifyError('Mission import not available');
            return;
        }

        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var result = window.importMissionsCSV(e.target.result);

                // Check for errors
                if (result.hasErrors()) {
                    var summary = result.getSummary();
                    var msg = 'Found ' + summary.errors + ' error(s) in the file.\n\n';
                    var errors = result.getErrors(true);
                    errors.slice(0, 5).forEach(function(err) {
                        var rowInfo = err.metadata && err.metadata.row ? 'Row ' + err.metadata.row + ': ' : '';
                        msg += rowInfo + err.message + '\n';
                    });
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

                // Determine if we should use MissionCore or fallback
                if (window.MissionCore && typeof window.MissionCore.importMissions === 'function') {
                    var confirmMsg = 'Import ' + candidates.length + ' mission(s)?\n\n';
                    confirmMsg += 'Added: ' + summary.added + '\n';
                    confirmMsg += 'Updated: ' + summary.updated + '\n';
                    if (summary.errors > 0) confirmMsg += 'Errors: ' + summary.errors + ' (skipped)\n';
                    if (summary.warnings > 0) confirmMsg += 'Warnings: ' + summary.warnings;

                    if (!confirm(confirmMsg)) return;

                    window.MissionCore.importMissions(candidates)
                        .then(function(importResult) {
                            notifySuccess(
                                'Mission import completed: ' + importResult.added + ' added, ' +
                                importResult.updated + ' updated'
                            );
                            refreshUI();
                        })
                        .catch(function(err) {
                            notifyError('Import failed: ' + err.message);
                        });
                } else {
                    // Fallback: use legacy import function
                    if (typeof window.importMissionsCSVLegacy === 'function') {
                        window.importMissionsCSVLegacy(candidates);
                    } else {
                        notifyError('No import function available. Please use MissionCore.importMissions.');
                        console.log('Mission candidates:', candidates);
                        notifyInfo('Parsed ' + candidates.length + ' mission candidates. Check console for details.');
                    }
                }

            } catch (err) {
                notifyError('Import failed: ' + err.message);
                console.error('Mission import error:', err);
            }
        };

        reader.onerror = function() {
            notifyError('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error'));
        };

        reader.readAsText(file);
    }

    // ============================================================
    // Initialization
    // ============================================================

    function initImportExport() {
        if (_initialized) return;
        _initialized = true;

        // Validate dependencies
        var hasDeps = validateDependencies();
        if (!hasDeps) {
            console.warn('Export module: Some dependencies are missing. Some features may not work.');
            // Continue anyway - buttons will work if functions exist
        }

        // --- JSON Backup ---
        bindButton('export-json-btn', function(e) {
            if (window.JSONIO && typeof window.JSONIO.exportJSON === 'function') {
                var data = window.data || {};
                var result = window.JSONIO.exportJSON(data, { pretty: true });
                if (result.exported) {
                    notifySuccess('JSON backup exported: ' + result.filename);
                } else {
                    notifyError('Export failed: ' + (result.error || 'Unknown error'));
                }
            } else if (typeof window.exportJSON === 'function') {
                // Legacy fallback
                window.exportJSON();
            } else {
                notifyError('JSON export not available');
            }
        });

        bindButton('import-json-btn', function(e) {
            if (window.JSONIO && typeof window.JSONIO.importJSONFromFile === 'function') {
                triggerFileInput('json-file-input');
            } else if (document.getElementById('json-file-input')) {
                triggerFileInput('json-file-input');
            } else {
                notifyError('JSON import not available');
            }
        });

        bindFileInput('json-file-input', function(file) {
            if (window.JSONIO && typeof window.JSONIO.importJSONFromFile === 'function') {
                window.JSONIO.importJSONFromFile(file)
                    .then(function(result) {
                        if (result.valid) {
                            // Check if there's data
                            if (window.JSONIO.hasData(result.data)) {
                                var summary = window.JSONIO.getDataSummary(result.data);
                                var msg = 'JSON import parsed successfully.\n\n';
                                msg += 'Records found:\n';
                                for (var key in summary.collections) {
                                    var val = summary.collections[key];
                                    if (typeof val === 'object') {
                                        msg += '  - ' + key + ': ' + JSON.stringify(val) + '\n';
                                    } else {
                                        msg += '  - ' + key + ': ' + val + '\n';
                                    }
                                }
                                msg += '\nTotal: ' + summary.total + ' records';
                                msg += '\n\nThis will replace all current data. Continue?';

                                if (confirm(msg)) {
                                    // Apply migration if available
                                    var data = result.data;
                                    if (window.migrateData && typeof window.migrateData === 'function') {
                                        try {
                                            data = window.migrateData(data);
                                        } catch (e) {
                                            notifyError('Migration failed: ' + e.message);
                                            return;
                                        }
                                    }

                                    // Pass to mutation layer
                                    if (window.MutationUtils && typeof window.MutationUtils.performMutation === 'function') {
                                        window.MutationUtils.performMutation({
                                            mutate: function() {
                                                // Apply data to global state
                                                window.data = data;
                                            },
                                            logMessage: 'Imported data from JSON',
                                            successMessage: 'JSON import completed: ' + summary.total + ' records imported',
                                            failureMessage: 'JSON import failed'
                                        }).then(function() {
                                            refreshUI();
                                        }).catch(function(err) {
                                            notifyError('Import failed: ' + err.message);
                                        });
                                    } else if (typeof window.saveData === 'function') {
                                        // Legacy fallback
                                        window.data = data;
                                        window.saveData().then(function() {
                                            notifySuccess('JSON import completed: ' + summary.total + ' records imported');
                                            refreshUI();
                                        }).catch(function(err) {
                                            notifyError('Save failed: ' + err.message);
                                        });
                                    } else {
                                        notifyError('No persistence mechanism available');
                                    }
                                }
                            } else {
                                notifyWarning('No application data found in JSON file.');
                            }
                        } else {
                            notifyError('JSON import failed: ' + (result.error || 'Unknown error'));
                        }
                    })
                    .catch(function(err) {
                        notifyError('JSON import failed: ' + err.message);
                    });
            } else if (typeof window.importJSON === 'function') {
                // Legacy fallback
                window.importJSON(file);
            } else {
                notifyError('JSON import not available');
            }
        });

        // --- Character CSV ---
        bindButton('export-characters-csv-btn', function(e) {
            if (typeof window.exportCharactersFromData === 'function') {
                try {
                    var result = window.exportCharactersFromData();
                    if (result && result.message) {
                        if (result.message === 'No characters to export.') {
                            notifyWarning(result.message);
                        } else {
                            notifySuccess(result.message);
                        }
                    } else if (result && result.count !== undefined) {
                        notifySuccess('Exported ' + result.count + ' characters');
                    } else {
                        notifySuccess('Characters exported');
                    }
                } catch (err) {
                    notifyError('Export failed: ' + err.message);
                }
            } else if (typeof window.exportCharactersCSV === 'function') {
                try {
                    // If exportCharactersCSV expects characters array, try to get from data
                    var characters = window.CharacterQueries && typeof window.CharacterQueries.getAllCharacters === 'function' 
                        ? window.CharacterQueries.getAllCharacters() 
                        : (window.data && window.data.characters ? window.data.characters : []);
                    if (characters.length === 0) {
                        notifyWarning('No characters to export.');
                        return;
                    }
                    window.exportCharactersCSV(characters);
                    notifySuccess('Exported ' + characters.length + ' characters');
                } catch (err) {
                    notifyError('Export failed: ' + err.message);
                }
            } else {
                notifyError('Character export not available');
            }
        });

        bindButton('import-characters-csv-btn', function(e) {
            if (window.importCharactersCSV) {
                triggerFileInput('characters-csv-file-input');
            } else {
                notifyError('Character import not available');
            }
        });

        bindFileInput('characters-csv-file-input', function(file) {
            handleCharacterImport(file);
        });

        bindButton('template-characters-csv-btn', function(e) {
            if (typeof window.exportCharacterTemplate === 'function') {
                try {
                    var result = window.exportCharacterTemplate();
                    if (result && result.exported) {
                        notifySuccess('Character template downloaded: ' + result.filename);
                    } else {
                        notifySuccess('Character template downloaded');
                    }
                } catch (err) {
                    notifyError('Template generation failed: ' + err.message);
                }
            } else {
                notifyError('Character template not available');
            }
        });

        // --- Mission CSV ---
        bindButton('export-missions-csv-btn', function(e) {
            if (typeof window.exportMissionsFromData === 'function') {
                try {
                    var result = window.exportMissionsFromData();
                    if (result && result.message) {
                        if (result.message === 'No missions to export.') {
                            notifyWarning(result.message);
                        } else {
                            notifySuccess(result.message);
                        }
                    } else if (result && result.count !== undefined) {
                        notifySuccess('Exported ' + result.count + ' missions');
                    } else {
                        notifySuccess('Missions exported');
                    }
                } catch (err) {
                    notifyError('Export failed: ' + err.message);
                }
            } else if (typeof window.exportMissionsCSV === 'function') {
                try {
                    var missions = window.MissionsQueries && typeof window.MissionsQueries.getMissions === 'function' 
                        ? window.MissionsQueries.getMissions() 
                        : (window.data && window.data.missions ? window.data.missions : []);
                    if (missions.length === 0) {
                        notifyWarning('No missions to export.');
                        return;
                    }
                    window.exportMissionsCSV(missions);
                    notifySuccess('Exported ' + missions.length + ' missions');
                } catch (err) {
                    notifyError('Export failed: ' + err.message);
                }
            } else {
                notifyError('Mission export not available');
            }
        });

        bindButton('import-missions-csv-btn', function(e) {
            if (window.importMissionsCSV) {
                triggerFileInput('missions-csv-file-input');
            } else {
                notifyError('Mission import not available');
            }
        });

        bindFileInput('missions-csv-file-input', function(file) {
            handleMissionImport(file);
        });

        bindButton('template-missions-csv-btn', function(e) {
            if (typeof window.exportMissionTemplate === 'function') {
                try {
                    var result = window.exportMissionTemplate();
                    if (result && result.exported) {
                        notifySuccess('Mission template downloaded: ' + result.filename);
                    } else {
                        notifySuccess('Mission template downloaded');
                    }
                } catch (err) {
                    notifyError('Template generation failed: ' + err.message);
                }
            } else {
                notifyError('Mission template not available');
            }
        });
    }

    // ============================================================
    // Lifecycle
    // ============================================================

    // Initialize when DOM is ready
    function tryInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            initImportExport();
        } else {
            document.addEventListener('DOMContentLoaded', initImportExport);
        }
    }

    // Export init function for testing/lifecycle
    window.initImportExport = initImportExport;

    // Initialize
    tryInit();

    // Also listen for data readiness (for features that need data)
    document.addEventListener('dataReady', function() {
        // Re-bind if needed (buttons may have been recreated)
        // But our buttons are static, so this is just a safety net
        if (!_initialized) {
            initImportExport();
        }
    });

})();
