/**
 * js/core/mutation-utils.js - Mutation Utilities
 * Centralised mutation pipeline and backup creation
 * Path: js/modules/shared/mutation-utils.js
 * 
 * This module provides:
 *   - performMutation() - Standard VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI COMMIT
 *   - createSafeBackup() - Centralised deep cloning with structuredClone + JSON fallback
 *   - saveWithPromise() - Wraps window.saveData() to catch synchronous exceptions
 * 
 * IMPORTANT:
 *   - All mutations should use performMutation() for consistency
 *   - createSafeBackup() is the SINGLE source of truth for cloning
 *   - saveWithPromise() ensures saveData() errors become Promise rejections
 *   - This module does NOT call saveData() directly - it wraps it
 *   - This module does NOT show UI - caller handles UX
 *   - USES NotificationSystem for notifications - SINGLE SOURCE OF TRUTH
 *   - USES DomUtils for DOM-related utilities when needed
 * 
 * MUTATION CONTRACT:
 *   performMutation(config) expects:
 *     config = {
 *       // Required
 *       validate: function() { ... },           // Returns { valid: true } or { valid: false, message: string }
 *       mutate: function() { ... },             // Mutates window.data (caller owns this)
 *       
 *       // Optional
 *       getData: function() { return window.data; }, // Override for custom data source
 *       logMessage: function() { return 'Mutation performed'; }, // Or string
 *       onSuccess: function(result) { ... },    // UI commit / notification
 *       onRollback: function(backup) { ... },   // Custom rollback behaviour
 *       onFailure: function(error) { ... },     // Custom failure handling
 *       skipLog: false,                         // Skip activity logging
 *       skipNotification: false,                // Skip notifications
 *       successMessage: 'Operation completed successfully.',
 *       failureMessage: 'Operation failed.',
 *       
 *       // For testing
 *       _testSaveFailure: false                 // Force save failure for testing
 *     }
 * 
 * RETURNS: Promise<{ success: boolean, data?: any, message?: string }>
 * 
 * STATE SOURCE OF TRUTH:
 *   - window.data is the canonical application state
 *   - DOM is the temporary source of form input only
 *   - Backups are created from window.data before mutation
 *   - Rollback restores window.data from backup
 * 
 * DEPENDENCIES:
 *   - window.saveData (from database.js)
 *   - window.data (global state)
 *   - window.logActivity (optional, from core-utils.js)
 *   - window.NotificationSystem (from notification.js) - SINGLE SOURCE OF TRUTH
 *   - window.DomUtils (from dom-utils.js) - SINGLE SOURCE OF TRUTH
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__mutationUtilsLoaded) {
        return;
    }
    window.__mutationUtilsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var NotificationSystem = window.NotificationSystem || window;
    var DomUtils = window.DomUtils || window;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        if (typeof window.saveData !== 'function') {
            console.warn('MutationUtils: window.saveData is not available.');
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION HELPER - DELEGATES TO NotificationSystem
    // ============================================================

    /**
     * Show a notification toast.
     * Delegates to NotificationSystem - the SINGLE SOURCE OF TRUTH.
     * 
     * @param {string} message - Notification message
     * @param {string} type - 'success' | 'error' | 'warning' | 'info'
     */
    function showNotification(message, type) {
        type = type || 'info';

        // Primary: Use NotificationSystem
        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
            return;
        }

        // Secondary: Use DomUtils as fallback
        if (DomUtils && typeof DomUtils.notify === 'function') {
            DomUtils.notify(message, type);
            return;
        }

        // Last resort fallback (should never be reached)
        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // CENTRALISED BACKUP CREATION
    // ============================================================

    /**
     * Create a safe backup of application state.
     * This is the SINGLE source of truth for cloning.
     * 
     * @param {object} data - The data to clone (usually window.data)
     * @returns {object|null} Deep clone of data, or null on failure
     */
    function createSafeBackup(data) {
        if (!data || typeof data !== 'object') {
            console.warn('MutationUtils: Cannot backup invalid data.');
            return null;
        }

        try {
            // Prefer database module's clone if available
            if (window.db && typeof window.db.createSafeCopy === 'function') {
                return window.db.createSafeCopy(data);
            }

            // Use structuredClone if available (modern browsers)
            if (typeof structuredClone === 'function') {
                try {
                    return structuredClone(data);
                } catch (e) {
                    console.warn('MutationUtils: structuredClone failed, falling back to JSON:', e);
                }
            }

            // Fallback to JSON
            try {
                return JSON.parse(JSON.stringify(data));
            } catch (e) {
                console.warn('MutationUtils: JSON clone failed:', e);
                return null;
            }
        } catch (err) {
            console.warn('MutationUtils: Failed to create backup:', err);
            return null;
        }
    }

    // ============================================================
    // SAVE WRAPPER - Converts sync exceptions to Promise rejections
    // ============================================================

    /**
     * Wrapper around window.saveData() that catches synchronous exceptions.
     * Ensures all save errors become Promise rejections.
     * 
     * @param {object} options - Optional configuration
     * @param {boolean} options._testFailure - Force failure for testing
     * @returns {Promise<void>}
     */
    function saveWithPromise(options) {
        options = options || {};

        if (!checkDependencies()) {
            return Promise.reject(new Error('saveData is not available.'));
        }

        // For testing: simulate save failure
        if (options._testFailure) {
            return Promise.reject(new Error('Simulated save failure for testing.'));
        }

        // Wrap in Promise.resolve to catch synchronous exceptions
        return Promise.resolve()
            .then(function() {
                return window.saveData();
            })
            .then(function(result) {
                // If saveData returns false or { success: false }, treat as failure
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
    // CENTRALISED MUTATION PIPELINE
    // ============================================================

    /**
     * Perform a mutation with the standard pipeline:
     * VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI COMMIT
     * 
     * @param {object} config - Mutation configuration
     * @returns {Promise<{ success: boolean, data?: any, message?: string }>}
     */
    function performMutation(config) {
        // ---- PHASE 1: VALIDATE CONFIG ----
        if (!config || typeof config !== 'object') {
            var configError = new Error('Mutation configuration is required.');
            return Promise.resolve({
                success: false,
                message: configError.message,
                error: configError
            });
        }

        if (typeof config.validate !== 'function') {
            var validateError = new Error('config.validate must be a function.');
            return Promise.resolve({
                success: false,
                message: validateError.message,
                error: validateError
            });
        }

        if (typeof config.mutate !== 'function') {
            var mutateError = new Error('config.mutate must be a function.');
            return Promise.resolve({
                success: false,
                message: mutateError.message,
                error: mutateError
            });
        }

        if (!checkDependencies()) {
            var depError = new Error('Dependencies not loaded. Please refresh the page.');
            return Promise.resolve({
                success: false,
                message: depError.message,
                error: depError
            });
        }

        // ---- PHASE 2: EXTRACT CONFIG ----
        var getData = config.getData || function() { return window.data; };
        var logMessage = config.logMessage || 'Mutation performed.';
        var onSuccess = config.onSuccess || null;
        var onRollback = config.onRollback || null;
        var onFailure = config.onFailure || null;
        var skipLog = config.skipLog === true;
        var skipNotification = config.skipNotification === true;
        var successMessage = config.successMessage || 'Operation completed successfully.';
        var failureMessage = config.failureMessage || 'Operation failed.';
        var validationError = null;

        // ---- PHASE 3: RUN VALIDATION ----
        var validationResult;
        try {
            validationResult = config.validate();
        } catch (err) {
            validationError = err;
            validationResult = { valid: false, message: err.message || 'Validation error.' };
        }

        if (!validationResult || validationResult.valid !== true) {
            var errorMsg = validationResult && validationResult.message
                ? validationResult.message
                : (validationError ? validationError.message : 'Validation failed.');
            
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

            return Promise.resolve({
                success: false,
                message: errorMsg,
                error: validationError
            });
        }

        // ---- PHASE 4: CREATE SNAPSHOT ----
        var data = getData();
        if (!data || typeof data !== 'object') {
            var dataError = new Error('Data store is not available.');
            if (!skipNotification) {
                showNotification(dataError.message, 'error');
            }
            return Promise.resolve({
                success: false,
                message: dataError.message,
                error: dataError
            });
        }

        var backup = createSafeBackup(data);
        if (!backup) {
            var backupError = new Error('Unable to create backup. Please try again.');
            if (!skipNotification) {
                showNotification(backupError.message, 'error');
            }
            return Promise.resolve({
                success: false,
                message: backupError.message,
                error: backupError
            });
        }

        // ---- PHASE 5: MUTATE ----
        var mutationResult;
        try {
            mutationResult = config.mutate(data, backup);
        } catch (err) {
            // Rollback on mutation error
            try {
                var rollbackData = getData();
                if (rollbackData) {
                    Object.keys(rollbackData).forEach(function(key) {
                        delete rollbackData[key];
                    });
                    Object.keys(backup).forEach(function(key) {
                        rollbackData[key] = backup[key];
                    });
                }
            } catch (rollbackErr) {
                console.error('MutationUtils: Rollback failed during mutation error:', rollbackErr);
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

            return Promise.resolve({
                success: false,
                message: err.message || 'Mutation failed.',
                error: err
            });
        }

        // ---- PHASE 6: PERSIST ----
        var saveOptions = {};
        if (config._testSaveFailure) {
            saveOptions._testFailure = true;
        }

        return saveWithPromise(saveOptions)
            .then(function() {
                // ---- PHASE 7: LOG ----
                if (!skipLog) {
                    try {
                        var logMsg = typeof logMessage === 'function'
                            ? logMessage(mutationResult)
                            : logMessage;
                        if (typeof window.logActivity === 'function') {
                            window.logActivity(logMsg);
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
                        console.error('MutationUtils: onSuccess callback error:', successErr);
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

                return {
                    success: true,
                    data: dataToReturn,
                    message: typeof successMessage === 'function'
                        ? successMessage(mutationResult)
                        : successMessage
                };
            })
            .catch(function(err) {
                // ---- PHASE 9: ROLLBACK ----
                try {
                    var rollbackData = getData();
                    if (rollbackData) {
                        // Clear and restore
                        Object.keys(rollbackData).forEach(function(key) {
                            delete rollbackData[key];
                        });
                        Object.keys(backup).forEach(function(key) {
                            rollbackData[key] = backup[key];
                        });
                    }
                } catch (rollbackErr) {
                    console.error('MutationUtils: Rollback failed during persistence error:', rollbackErr);
                }

                var errorMsg = err && err.message
                    ? err.message
                    : 'Failed to persist changes.';

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

                return {
                    success: false,
                    message: errorMsg,
                    error: err
                };
            });
    }

    // ============================================================
    // CONVENIENCE WRAPPERS
    // ============================================================

    /**
     * Simple mutation wrapper for operations that don't need complex config.
     * 
     * @param {string} logMessage - Activity log message
     * @param {string} successMessage - User-facing success message
     * @param {string} failureMessage - User-facing failure message
     * @param {Function} mutateFn - Mutation function that receives (data, backup)
     * @param {Function} validateFn - Optional validation function
     * @returns {Promise<{ success: boolean, data?: any, message?: string }>}
     */
    function simpleMutation(logMessage, successMessage, failureMessage, mutateFn, validateFn) {
        validateFn = validateFn || function() { return { valid: true }; };

        return performMutation({
            validate: validateFn,
            mutate: mutateFn,
            logMessage: logMessage,
            successMessage: successMessage || 'Operation completed.',
            failureMessage: failureMessage || 'Operation failed.'
        });
    }

    /**
     * Safe refresh of UI components after mutation.
     * Calls optional renderers if they exist.
     */
    function refreshUI(options) {
        options = options || {};

        // Character list
        if (options.characterList !== false) {
            if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                try { window.CharacterList.render(); } catch (e) { /* Ignore */ }
            }
        }

        // Character form
        if (options.characterForm && options.characterId !== undefined) {
            if (typeof window.showCharacterForm === 'function') {
                try { window.showCharacterForm(options.characterId); } catch (e) { /* Ignore */ }
            }
        }

        // Dashboard stats
        if (options.dashboardStats !== false) {
            if (typeof window.updateDashboardStats === 'function') {
                try { window.updateDashboardStats(); } catch (e) { /* Ignore */ }
            }
        }

        // Custom refresh
        if (typeof options.customRefresh === 'function') {
            try { options.customRefresh(); } catch (e) { /* Ignore */ }
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MutationUtils = {
        // Core
        performMutation: performMutation,
        createSafeBackup: createSafeBackup,
        saveWithPromise: saveWithPromise,

        // Convenience
        simpleMutation: simpleMutation,
        refreshUI: refreshUI,

        // Notification (for modules that need it)
        showNotification: showNotification
    };

    // Also expose individual functions globally for backward compatibility
    window.createSafeBackup = createSafeBackup;

})();
