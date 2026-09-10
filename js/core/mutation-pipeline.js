/**
 * core/mutation-pipeline.js - Mutation Pipeline
 * Centralised mutation orchestration with transaction semantics
 * 
 * Path: js/core/mutation-pipeline.js
 * 
 * This module provides:
 *   - performMutation() - Standard VALIDATE -> SNAPSHOT -> MUTATE -> PERSIST -> LOG -> UI COMMIT
 *   - createSafeBackup() - Centralised deep cloning via ObjectUtils
 *   - saveWithPromise() - Wraps window.saveData() to catch synchronous exceptions
 * 
 * IMPORTANT:
 *   - All mutations should use performMutation() for consistency
 *   - Mutations are SERIALISED to prevent rollback conflicts
 *   - createSafeBackup() uses ObjectUtils.deepClone() (SINGLE SOURCE OF TRUTH)
 *   - saveWithPromise() ensures saveData() errors become Promise rejections
 *   - This module does NOT show UI - caller handles UX via callbacks
 *   - Uses NotificationSystem for notifications when available
 *   - Uses ActivityLog for logging (SINGLE SOURCE OF TRUTH)
 *   - Uses ObjectUtils for cloning (SINGLE SOURCE OF TRUTH)
 * 
 * MUTATION CONTRACT:
 *   performMutation(config) expects:
 *     config = {
 *       // Required
 *       validate: function(data) { ... },          // Returns { valid: true } or { valid: false, message: string }
 *       mutate: function(data, backup) { ... },    // Mutates data (caller owns this)
 *       
 *       // Optional
 *       logMessage: function(result) { ... },      // Or string
 *       onSuccess: function(result) { ... },       // UI commit / notification
 *       onRollback: function(backup) { ... },      // Custom rollback behaviour
 *       onFailure: function(error) { ... },        // Custom failure handling
 *       skipLog: false,                            // Skip activity logging
 *       skipNotification: false,                   // Skip notifications
 *       successMessage: 'Operation completed successfully.',
 *       failureMessage: 'Operation failed.',
 *       
 *       // For testing
 *       _testSaveFailure: false                    // Force save failure for testing
 *     }
 * 
 * RETURNS: Promise<{ success: boolean, data?: any, message?: string }>
 * 
 * STATE SOURCE OF TRUTH:
 *   - window.data is the canonical application state
 *   - DOM is the temporary source of form input only
 *   - Backups are created from window.data before mutation
 *   - Rollback restores window.data from backup
 *   - Mutations are serialised to prevent rollback conflicts
 * 
 * DEPENDENCIES:
 *   - window.saveData (from database.js)
 *   - window.data (global state)
 *   - window.ObjectUtils (for deepClone) - MANDATORY
 *   - window.ActivityLog (for activity logging) - MANDATORY
 *   - window.NotificationSystem (for notifications - optional, falls back to alert)
 * 
 * HISTORY:
 *   - Previously depended on window.CoreUtils.deepClone. CoreUtils no longer
 *     exists in the architecture; its responsibilities were split across
 *     ObjectUtils, ValidationUtils, and IdUtils. This module now uses
 *     ObjectUtils.deepClone, which is the canonical deep clone utility.
 */

(function() {
    'use strict';

    if (window.__mutationPipelineLoaded) {
        return;
    }
    window.__mutationPipelineLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var ActivityLog = window.ActivityLog;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (typeof window.saveData !== 'function') {
            missing.push('window.saveData');
        }

        if (!window.data || typeof window.data !== 'object') {
            missing.push('window.data');
        }

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // NotificationSystem is optional - falls back to alert()
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            console.warn('[MutationPipeline] NotificationSystem not available - notifications will fall back to alert()');
        }

        if (missing.length > 0) {
            throw new Error('MutationPipeline: Missing critical dependencies: ' + missing.join(', '));
        }

        return true;
    }

    // ============================================================
    // MUTATION QUEUE - Serialises mutations
    // ============================================================

    var _mutationQueue = [];
    var _isMutating = false;

    function processMutationQueue() {
        if (_isMutating || _mutationQueue.length === 0) {
            return;
        }

        _isMutating = true;
        var item = _mutationQueue.shift();

        executeMutation(item.config)
            .then(function(result) {
                _isMutating = false;
                try {
                    item.resolve(result);
                } catch (e) {
                    // Ignore resolver errors
                }
                processMutationQueue();
            })
            .catch(function(err) {
                _isMutating = false;
                try {
                    item.reject(err);
                } catch (e) {
                    // Ignore rejector errors
                }
                processMutationQueue();
            });
    }

    function enqueueMutation(config) {
        return new Promise(function(resolve, reject) {
            _mutationQueue.push({
                config: config,
                resolve: resolve,
                reject: reject
            });
            processMutationQueue();
        });
    }

    // ============================================================
    // NOTIFICATION HELPER - Uses NotificationSystem or falls back
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
            return;
        }

        if (typeof window.alert === 'function') {
            window.alert(message);
        }
    }

    // ============================================================
    // ROLLBACK HELPER
    // ============================================================

    function restoreFromBackup(data, backup) {
        var keys = Object.keys(data);
        for (var i = 0; i < keys.length; i++) {
            delete data[keys[i]];
        }

        var backupKeys = Object.keys(backup);
        for (var j = 0; j < backupKeys.length; j++) {
            data[backupKeys[j]] = backup[backupKeys[j]];
        }
    }

    // ============================================================
    // CENTRALISED BACKUP CREATION
    // ============================================================

    function createSafeBackup(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('MutationPipeline: Cannot backup invalid data.');
        }

        return ObjectUtils.deepClone(data);
    }

    // ============================================================
    // SAVE WRAPPER - Converts sync exceptions to Promise rejections
    // ============================================================

    function saveWithPromise(options) {
        options = options || {};

        if (typeof window.saveData !== 'function') {
            return Promise.reject(new Error('saveData is not available.'));
        }

        if (options._testFailure) {
            return Promise.reject(new Error('Simulated save failure for testing.'));
        }

        return Promise.resolve()
            .then(function() {
                return window.saveData();
            })
            .then(function(result) {
                if (result === false) {
                    return Promise.reject(new Error('Save operation returned false.'));
                }
                if (result && typeof result === 'object' && result.success === false) {
                    return Promise.reject(new Error(result.message || 'Save operation failed.'));
                }
                return result;
            });
    }

    // ============================================================
    // EXECUTE MUTATION - Single mutation execution
    // ============================================================

    function executeMutation(config) {
        return new Promise(function(resolve, reject) {
            try {
                // ---- PHASE 1: VALIDATE CONFIG ----
                if (!config || typeof config !== 'object') {
                    reject(new Error('Mutation configuration is required.'));
                    return;
                }

                if (typeof config.validate !== 'function') {
                    reject(new Error('config.validate must be a function.'));
                    return;
                }

                if (typeof config.mutate !== 'function') {
                    reject(new Error('config.mutate must be a function.'));
                    return;
                }

                checkDependencies();

                // ---- PHASE 2: EXTRACT CONFIG ----
                var logMessage = config.logMessage || 'Mutation performed.';
                var onSuccess = config.onSuccess || null;
                var onRollback = config.onRollback || null;
                var onFailure = config.onFailure || null;
                var skipLog = config.skipLog === true;
                var skipNotification = config.skipNotification === true;
                var successMessage = config.successMessage || 'Operation completed successfully.';
                var failureMessage = config.failureMessage || 'Operation failed.';

                // ---- PHASE 3: RUN VALIDATION ----
                var data = window.data;
                var validationResult;

                try {
                    validationResult = config.validate(data);
                } catch (err) {
                    validationResult = {
                        valid: false,
                        message: err.message || 'Validation error.'
                    };
                }

                if (!validationResult || validationResult.valid !== true) {
                    var errorMsg = validationResult && validationResult.message
                        ? validationResult.message
                        : 'Validation failed.';

                    if (!skipNotification) {
                        showNotification(errorMsg, 'error');
                    }

                    if (typeof onFailure === 'function') {
                        try {
                            onFailure(errorMsg);
                        } catch (e) {
                            // Ignore onFailure errors
                        }
                    }

                    resolve({
                        success: false,
                        message: errorMsg,
                        error: validationResult
                    });
                    return;
                }

                // ---- PHASE 4: CREATE SNAPSHOT ----
                var backup = createSafeBackup(data);

                // ---- PHASE 5: MUTATE ----
                var mutationResult;

                try {
                    mutationResult = config.mutate(data, backup);
                } catch (err) {
                    try {
                        restoreFromBackup(data, backup);
                    } catch (rollbackErr) {
                        reject(new Error('Mutation failed and rollback failed: ' + rollbackErr.message));
                        return;
                    }

                    if (!skipNotification) {
                        showNotification('Error during mutation: ' + err.message, 'error');
                    }

                    if (typeof onRollback === 'function') {
                        try {
                            onRollback(backup);
                        } catch (e) {
                            // Ignore onRollback errors
                        }
                    }

                    resolve({
                        success: false,
                        message: err.message || 'Mutation failed.',
                        error: err
                    });
                    return;
                }

                // ---- PHASE 6: PERSIST ----
                var saveOptions = {};
                if (config._testSaveFailure) {
                    saveOptions._testFailure = true;
                }

                saveWithPromise(saveOptions)
                    .then(function() {
                        // ---- PHASE 7: LOG ----
                        if (!skipLog) {
                            try {
                                var logMsg = typeof logMessage === 'function'
                                    ? logMessage(mutationResult)
                                    : logMessage;

                                if (ActivityLog && typeof ActivityLog.record === 'function') {
                                    ActivityLog.record(logMsg);
                                }
                            } catch (logErr) {
                                // Ignore logging errors (failure-safe)
                            }
                        }

                        // ---- PHASE 8: UI COMMIT ----
                        var dataToReturn = mutationResult && mutationResult.data !== undefined
                            ? mutationResult.data
                            : mutationResult;

                        if (typeof onSuccess === 'function') {
                            try {
                                onSuccess(dataToReturn);
                            } catch (successErr) {
                                // Ignore onSuccess errors
                            }
                        }

                        if (!skipNotification && successMessage) {
                            var finalMessage = typeof successMessage === 'function'
                                ? successMessage(mutationResult)
                                : successMessage;

                            if (finalMessage) {
                                showNotification(finalMessage, 'success');
                            }
                        }

                        resolve({
                            success: true,
                            data: dataToReturn,
                            message: typeof successMessage === 'function'
                                ? successMessage(mutationResult)
                                : successMessage
                        });
                    })
                    .catch(function(err) {
                        // ---- PHASE 9: ROLLBACK ----
                        try {
                            restoreFromBackup(window.data, backup);
                        } catch (rollbackErr) {
                            reject(new Error('Persistence failed and rollback failed: ' + rollbackErr.message));
                            return;
                        }

                        var errorMsg = err && err.message
                            ? err.message
                            : failureMessage;

                        if (!skipNotification) {
                            showNotification(errorMsg, 'error');
                        }

                        if (typeof onRollback === 'function') {
                            try {
                                onRollback(backup);
                            } catch (e) {
                                // Ignore onRollback errors
                            }
                        }

                        if (typeof onFailure === 'function') {
                            try {
                                onFailure(err);
                            } catch (e) {
                                // Ignore onFailure errors
                            }
                        }

                        resolve({
                            success: false,
                            message: errorMsg,
                            error: err
                        });
                    });

            } catch (err) {
                reject(err);
            }
        });
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function performMutation(config) {
        return enqueueMutation(config);
    }

    function simpleMutation(logMessage, successMessage, failureMessage, mutateFn, validateFn) {
        validateFn = validateFn || function(data) {
            return { valid: true };
        };

        return performMutation({
            validate: validateFn,
            mutate: mutateFn,
            logMessage: logMessage,
            successMessage: successMessage || 'Operation completed.',
            failureMessage: failureMessage || 'Operation failed.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MutationPipeline = {
        performMutation: performMutation,
        createSafeBackup: createSafeBackup,
        saveWithPromise: saveWithPromise,
        simpleMutation: simpleMutation
    };

})();
