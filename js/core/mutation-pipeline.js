/**
 * core/mutation-pipeline.js - Mutation Pipeline
 * Path: js/core/mutation-pipeline.js
 *
 * Standard mutation flow:
 *   VALIDATE -> SNAPSHOT -> MUTATE (+ LOG) -> PERSIST -> UI COMMIT
 *
 * IMPORTANT:
 *   - Mutations are serialised via a queue.
 *   - The activity log entry is recorded INSIDE the mutate phase so
 *     it is written by the same save as the change it describes.
 *   - A throw AFTER a successful save does NOT trigger a rollback.
 *     Only save failure rolls back. Post-save callbacks are invoked
 *     in isolation.
 *   - Async mutate functions are supported and awaited.
 *   - Dependencies (ObjectUtils, ActivityLog, NotificationSystem) are
 *     read lazily at call time, not captured at load time.
 *
 * MUTATION CONTRACT:
 *   performMutation({
 *     validate: function(data) { return { valid, message? }; },
 *     mutate:   function(data, backup) { ... },   // may return a Promise
 *
 *     logMessage:       string | function(result) -> string,
 *     onSuccess:        function(result) { ... },
 *     onRollback:       function(backup) { ... },
 *     onFailure:        function(error, stage) { ... },
 *                       // stage: 'validate' | 'mutate' | 'save'
 *
 *     skipLog:          boolean,
 *     skipNotification: boolean,
 *     successMessage:   string | function(result),
 *     failureMessage:   string,
 *
 *     _testSaveFailure: boolean  // testing only
 *   })
 *
 * RETURNS: Promise<{ success: boolean, data?: any, message?: string }>
 *
 * DIAGNOSTICS:
 *   Set window.MutationPipeline._diagnostic = true at runtime to
 *   enable tracing. Off by default.
 */

(function() {
    'use strict';

    if (window.__mutationPipelineLoaded) return;
    window.__mutationPipelineLoaded = true;

    var _DIAGNOSTIC = false;
    var _warnedAboutNotificationSystem = false;

    function diag() {
        if (!_DIAGNOSTIC) { return; }
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[MP]');
        console.log.apply(console, args);
    }

    function diagWarn() {
        if (!_DIAGNOSTIC) { return; }
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[MP]');
        console.warn.apply(console, args);
    }

    // ============================================================
    // LAZY DEPENDENCY ACCESS
    // ============================================================

    function getObjectUtils()        { return window.ObjectUtils; }
    function getActivityLog()        { return window.ActivityLog; }
    function getNotificationSystem() { return window.NotificationSystem; }

    function checkDependencies() {
        var missing = [];

        if (typeof window.saveData !== 'function') {
            missing.push('window.saveData');
        }
        if (!window.data || typeof window.data !== 'object') {
            missing.push('window.data');
        }
        if (typeof window.structuredClone !== 'function') {
            missing.push('structuredClone');
        }

        var ObjectUtils = getObjectUtils();
        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        var ActivityLog = getActivityLog();
        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        if (missing.length > 0) {
            throw new Error(
                'MutationPipeline: Missing critical dependencies: ' +
                missing.join(', ')
            );
        }
    }

    // ============================================================
    // MUTATION QUEUE
    // ============================================================

    var _mutationQueue = [];
    var _isMutating = false;

    function processMutationQueue() {
        if (_isMutating || _mutationQueue.length === 0) { return; }

        _isMutating = true;
        var item = _mutationQueue.shift();

        executeMutation(item.config)
            .then(function(result) {
                _isMutating = false;
                try { item.resolve(result); } catch (e) {}
                processMutationQueue();
            })
            .catch(function(err) {
                _isMutating = false;
                try { item.reject(err); } catch (e) {}
                processMutationQueue();
            });
    }

    function enqueueMutation(config) {
        return new Promise(function(resolve, reject) {
            _mutationQueue.push({ config: config, resolve: resolve, reject: reject });
            processMutationQueue();
        });
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        var NS = getNotificationSystem();
        if (NS && typeof NS.notify === 'function') {
            NS.notify(message, type);
            return;
        }

        if (!_warnedAboutNotificationSystem) {
            _warnedAboutNotificationSystem = true;
            console.warn(
                '[MutationPipeline] NotificationSystem unavailable; ' +
                'falling back to alert().'
            );
        }

        if (typeof window.alert === 'function') {
            window.alert(message);
        }
    }

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

    function createSafeBackup(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('MutationPipeline: Cannot backup invalid data.');
        }
        var ObjectUtils = getObjectUtils();
        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            throw new Error('MutationPipeline: ObjectUtils.deepClone is required.');
        }
        return ObjectUtils.deepClone(data);
    }

    function saveWithPromise(options) {
        options = options || {};

        if (typeof window.saveData !== 'function') {
            return Promise.reject(new Error('saveData is not available.'));
        }
        if (options._testFailure) {
            return Promise.reject(new Error('Simulated save failure for testing.'));
        }

        return Promise.resolve()
            .then(function() { return window.saveData(); })
            .then(function(result) {
                if (result === false) {
                    return Promise.reject(new Error('Save operation returned false.'));
                }
                if (result && typeof result === 'object' &&
                    result.success === false) {
                    return Promise.reject(new Error(
                        result.message || 'Save operation failed.'
                    ));
                }
                return result;
            });
    }

    function resolveMessage(value, result) {
        return typeof value === 'function' ? value(result) : value;
    }

    // ============================================================
    // EXECUTE MUTATION
    // ============================================================

    function executeMutation(config) {
        return new Promise(function(resolve, reject) {
            try {
                // ---- PHASE 1: CONFIG VALIDATION ----
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

                var logMessage       = config.logMessage || 'Mutation performed.';
                var onSuccess        = config.onSuccess || null;
                var onRollback       = config.onRollback || null;
                var onFailure        = config.onFailure || null;
                var skipLog          = config.skipLog === true;
                var skipNotification = config.skipNotification === true;
                var successMessage   = config.successMessage || 'Operation completed successfully.';
                var failureMessage   = config.failureMessage || 'Operation failed.';

                var data = window.data;

                // ---- PHASE 2: VALIDATE ----
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

                    diagWarn('validation FAILED:', errorMsg);

                    if (!skipNotification) { showNotification(errorMsg, 'error'); }
                    if (typeof onFailure === 'function') {
                        try { onFailure(errorMsg, 'validate'); } catch (e) {}
                    }

                    resolve({ success: false, message: errorMsg, error: validationResult });
                    return;
                }

                // ---- PHASE 3: SNAPSHOT ----
                var backup;
                try {
                    backup = createSafeBackup(data);
                } catch (backupErr) {
                    reject(backupErr);
                    return;
                }

                // ---- PHASE 4: MUTATE (may be async) ----
                var mutationResult;
                try {
                    mutationResult = config.mutate(data, backup);
                } catch (mutateErr) {
                    handleMutateThrow(data, backup, mutateErr, onRollback,
                        skipNotification, resolve, reject);
                    return;
                }

                Promise.resolve(mutationResult)
                    .then(function(resolvedResult) {
                        // ---- PHASE 5: LOG (commits with the save) ----
                        if (!skipLog) {
                            try {
                                var ActivityLog = getActivityLog();
                                if (ActivityLog &&
                                    typeof ActivityLog.record === 'function') {
                                    var logMsg = typeof logMessage === 'function'
                                        ? logMessage(resolvedResult)
                                        : logMessage;
                                    ActivityLog.record(logMsg);
                                }
                            } catch (logErr) {
                                // Logging failure is non-fatal.
                            }
                        }

                        // ---- PHASE 6: PERSIST ----
                        var saveOptions = {};
                        if (config._testSaveFailure) {
                            saveOptions._testFailure = true;
                        }

                        return saveWithPromise(saveOptions)
                            .then(
                                function() {
                                    // onSaved: post-processing.
                                    // No rollback is possible from here.
                                    commitSuccess(
                                        resolvedResult,
                                        successMessage,
                                        onSuccess,
                                        skipNotification,
                                        resolve
                                    );
                                },
                                function(saveErr) {
                                    // onSaveFailed: rollback.
                                    handleSaveFailure(
                                        data, backup, saveErr, failureMessage,
                                        onRollback, onFailure, skipNotification,
                                        resolve, reject
                                    );
                                }
                            );
                    })
                    .catch(function(asyncErr) {
                        // The mutate promise rejected: treat as a
                        // mutate-phase failure.
                        handleMutateThrow(data, backup, asyncErr, onRollback,
                            skipNotification, resolve, reject);
                    });

            } catch (outerErr) {
                diagWarn('executeMutation threw:', outerErr);
                reject(outerErr);
            }
        });
    }

    function commitSuccess(mutationResult, successMessage, onSuccess,
                           skipNotification, resolve) {
        var dataToReturn = mutationResult && mutationResult.data !== undefined
            ? mutationResult.data
            : mutationResult;

        if (typeof onSuccess === 'function') {
            try { onSuccess(dataToReturn); } catch (e) {
                console.error('[MutationPipeline] onSuccess threw:', e);
            }
        }

        var finalMessage = null;
        if (!skipNotification && successMessage) {
            finalMessage = resolveMessage(successMessage, mutationResult);
            if (finalMessage) {
                try { showNotification(finalMessage, 'success'); }
                catch (e) { console.error('[MutationPipeline] notify threw:', e); }
            }
        }

        resolve({
            success: true,
            data: dataToReturn,
            message: finalMessage
        });
    }

    function handleMutateThrow(data, backup, err, onRollback,
                               skipNotification, resolve, reject) {
        try {
            restoreFromBackup(data, backup);
        } catch (rollbackErr) {
            reject(new Error(
                'Mutation failed and rollback failed: ' + rollbackErr.message
            ));
            return;
        }

        if (!skipNotification) {
            showNotification('Error during mutation: ' + err.message, 'error');
        }
        if (typeof onRollback === 'function') {
            try { onRollback(backup); } catch (e) {}
        }

        resolve({
            success: false,
            message: err.message || 'Mutation failed.',
            error: err
        });
    }

    function handleSaveFailure(data, backup, saveErr, failureMessage,
                               onRollback, onFailure, skipNotification,
                               resolve, reject) {
        diagWarn('save failed; rolling back');

        try {
            restoreFromBackup(data, backup);
        } catch (rollbackErr) {
            reject(new Error(
                'Persistence failed and rollback failed: ' + rollbackErr.message
            ));
            return;
        }

        var errorMsg = saveErr && saveErr.message ? saveErr.message : failureMessage;

        if (!skipNotification) {
            showNotification(errorMsg, 'error');
        }
        if (typeof onRollback === 'function') {
            try { onRollback(backup); } catch (e) {}
        }
        if (typeof onFailure === 'function') {
            try { onFailure(saveErr, 'save'); } catch (e) {}
        }

        resolve({ success: false, message: errorMsg, error: saveErr });
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function performMutation(config) {
        return enqueueMutation(config);
    }

    function simpleMutation(logMessage, successMessage, failureMessage,
                            mutateFn, validateFn) {
        validateFn = validateFn || function() { return { valid: true }; };
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
        simpleMutation: simpleMutation,
        get _diagnostic() { return _DIAGNOSTIC; },
        set _diagnostic(v) { _DIAGNOSTIC = !!v; }
    };

})();
