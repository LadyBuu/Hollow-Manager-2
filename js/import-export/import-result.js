/**
 * js/export/import-result.js
 * Structured import result container for CSV imports.
 * 
 * This module provides a consistent way to collect and report
 * import results including valid records, errors, and warnings.
 * 
 * Usage:
 *   var result = new ImportResult();
 *   // ... parse rows, add results ...
 *   if (result.hasErrors()) { /* handle errors * / }
 *   var summary = result.getSummary();
 *   var validRecords = result.getValid();
 */

(function() {
    'use strict';

    // ============================================================
    // ImportResult Class
    // ============================================================

    /**
     * Creates a new import result container.
     * 
     * @param {Object} options - Configuration options
     * @param {number} options.maxErrors - Maximum errors to store (default: 100)
     * @param {number} options.maxWarnings - Maximum warnings to store (default: 100)
     */
    function ImportResult(options) {
        options = options || {};

        this._valid = [];
        this._errors = [];
        this._warnings = [];

        this._added = 0;
        this._updated = 0;
        this._skipped = 0;

        this._maxErrors = options.maxErrors || 100;
        this._maxWarnings = options.maxWarnings || 100;

        this._errorTruncated = false;
        this._warningTruncated = false;
    }

    // ============================================================
    // Adding Results
    // ============================================================

    /**
     * Add a valid record to the result.
     * 
     * @param {Object} record - The parsed record (character, mission, etc.)
     * @param {Object} metadata - Optional metadata (row number, source, etc.)
     */
    ImportResult.prototype.addValid = function(record, metadata) {
        if (!record || typeof record !== 'object') {
            this.addError('Invalid record: not an object', metadata);
            return;
        }

        this._valid.push({
            record: record,
            metadata: metadata || {}
        });
    };

    /**
     * Add an error to the result.
     * 
     * @param {string} message - Error message
     * @param {Object} metadata - Optional metadata (row number, field, etc.)
     */
    ImportResult.prototype.addError = function(message, metadata) {
        if (this._errors.length >= this._maxErrors) {
            if (!this._errorTruncated) {
                this._errors.push({
                    message: 'Additional errors omitted (limit: ' + this._maxErrors + ')',
                    metadata: { truncated: true }
                });
                this._errorTruncated = true;
            }
            return;
        }

        this._errors.push({
            message: message,
            metadata: metadata || {}
        });
    };

    /**
     * Add a warning to the result.
     * 
     * @param {string} message - Warning message
     * @param {Object} metadata - Optional metadata (row number, field, etc.)
     */
    ImportResult.prototype.addWarning = function(message, metadata) {
        if (this._warnings.length >= this._maxWarnings) {
            if (!this._warningTruncated) {
                this._warnings.push({
                    message: 'Additional warnings omitted (limit: ' + this._maxWarnings + ')',
                    metadata: { truncated: true }
                });
                this._warningTruncated = true;
            }
            return;
        }

        this._warnings.push({
            message: message,
            metadata: metadata || {}
        });
    };

    /**
     * Add a skipped record (one that was parsed but not imported).
     * 
     * @param {Object} record - The parsed record
     * @param {string} reason - Why it was skipped
     * @param {Object} metadata - Optional metadata
     */
    ImportResult.prototype.addSkipped = function(record, reason, metadata) {
        if (typeof reason !== 'string') {
            reason = 'Skipped';
        }

        this._skipped++;
        this.addWarning('Skipped: ' + reason, metadata);
    };

    // ============================================================
    // Counters
    // ============================================================

    /**
     * Set the number of records added.
     * 
     * @param {number} count - Number of new records
     */
    ImportResult.prototype.setAdded = function(count) {
        this._added = typeof count === 'number' && count >= 0 ? count : 0;
    };

    /**
     * Increment the added counter.
     * 
     * @param {number} increment - Amount to increment (default: 1)
     */
    ImportResult.prototype.incrementAdded = function(increment) {
        this._added += (typeof increment === 'number' && increment > 0) ? increment : 1;
    };

    /**
     * Set the number of records updated.
     * 
     * @param {number} count - Number of existing records updated
     */
    ImportResult.prototype.setUpdated = function(count) {
        this._updated = typeof count === 'number' && count >= 0 ? count : 0;
    };

    /**
     * Increment the updated counter.
     * 
     * @param {number} increment - Amount to increment (default: 1)
     */
    ImportResult.prototype.incrementUpdated = function(increment) {
        this._updated += (typeof increment === 'number' && increment > 0) ? increment : 1;
    };

    // ============================================================
    // Query Methods
    // ============================================================

    /**
     * Check if there are any errors.
     * 
     * @returns {boolean} True if errors exist
     */
    ImportResult.prototype.hasErrors = function() {
        return this._errors.length > 0;
    };

    /**
     * Check if there are any warnings.
     * 
     * @returns {boolean} True if warnings exist
     */
    ImportResult.prototype.hasWarnings = function() {
        return this._warnings.length > 0;
    };

    /**
     * Check if there are any valid records.
     * 
     * @returns {boolean} True if valid records exist
     */
    ImportResult.prototype.hasValid = function() {
        return this._valid.length > 0;
    };

    /**
     * Get the total number of records processed.
     * 
     * @returns {number} Total records (valid + errors + skipped)
     */
    ImportResult.prototype.getTotal = function() {
        return this._valid.length + this._errors.length + this._skipped;
    };

    /**
     * Get all valid records.
     * 
     * @param {boolean} includeMetadata - Include metadata in results
     * @returns {Array} Array of valid records
     */
    ImportResult.prototype.getValid = function(includeMetadata) {
        if (includeMetadata) {
            return this._valid.slice();
        }
        return this._valid.map(function(item) {
            return item.record;
        });
    };

    /**
     * Get all errors.
     * 
     * @param {boolean} includeMetadata - Include metadata in results
     * @returns {Array} Array of errors
     */
    ImportResult.prototype.getErrors = function(includeMetadata) {
        if (includeMetadata) {
            return this._errors.slice();
        }
        return this._errors.map(function(item) {
            return item.message;
        });
    };

    /**
     * Get all warnings.
     * 
     * @param {boolean} includeMetadata - Include metadata in results
     * @returns {Array} Array of warnings
     */
    ImportResult.prototype.getWarnings = function(includeMetadata) {
        if (includeMetadata) {
            return this._warnings.slice();
        }
        return this._warnings.map(function(item) {
            return item.message;
        });
    };

    /**
     * Get errors that are associated with a specific row.
     * 
     * @param {number} rowNumber - Row number
     * @returns {Array} Errors for that row
     */
    ImportResult.prototype.getErrorsForRow = function(rowNumber) {
        return this._errors.filter(function(item) {
            return item.metadata && item.metadata.row === rowNumber;
        });
    };

    /**
     * Get warnings that are associated with a specific row.
     * 
     * @param {number} rowNumber - Row number
     * @returns {Array} Warnings for that row
     */
    ImportResult.prototype.getWarningsForRow = function(rowNumber) {
        return this._warnings.filter(function(item) {
            return item.metadata && item.metadata.row === rowNumber;
        });
    };

    // ============================================================
    // Summary
    // ============================================================

    /**
     * Get a summary of the import result.
     * 
     * @returns {Object} Summary statistics
     */
    ImportResult.prototype.getSummary = function() {
        return {
            total: this.getTotal(),
            valid: this._valid.length,
            errors: this._errors.length,
            warnings: this._warnings.length,
            added: this._added,
            updated: this._updated,
            skipped: this._skipped,
            hasErrors: this.hasErrors(),
            hasWarnings: this.hasWarnings(),
            errorTruncated: this._errorTruncated,
            warningTruncated: this._warningTruncated
        };
    };

    /**
     * Get a human-readable summary string.
     * 
     * @param {Object} options - Formatting options
     * @param {boolean} options.includeDetails - Include error/warning details
     * @param {number} options.maxDetails - Max details to show (default: 5)
     * @returns {string} Formatted summary
     */
    ImportResult.prototype.getSummaryString = function(options) {
        options = options || {};
        var maxDetails = options.maxDetails || 5;

        var summary = this.getSummary();
        var lines = [];

        lines.push('Import Summary:');
        lines.push('  Valid records: ' + summary.valid);
        lines.push('  Added: ' + summary.added);
        lines.push('  Updated: ' + summary.updated);
        lines.push('  Skipped: ' + summary.skipped);

        if (summary.errors > 0) {
            lines.push('  Errors: ' + summary.errors + (summary.errorTruncated ? ' (truncated)' : ''));
            if (options.includeDetails) {
                var errors = this.getErrors(true);
                var shown = 0;
                for (var i = 0; i < errors.length && shown < maxDetails; i++) {
                    var err = errors[i];
                    var rowInfo = err.metadata && err.metadata.row ? ' [row ' + err.metadata.row + ']' : '';
                    lines.push('    - ' + err.message + rowInfo);
                    shown++;
                }
                if (errors.length > maxDetails) {
                    lines.push('    ... and ' + (errors.length - maxDetails) + ' more errors');
                }
            }
        }

        if (summary.warnings > 0) {
            lines.push('  Warnings: ' + summary.warnings + (summary.warningTruncated ? ' (truncated)' : ''));
            if (options.includeDetails) {
                var warnings = this.getWarnings(true);
                var shownW = 0;
                for (var j = 0; j < warnings.length && shownW < maxDetails; j++) {
                    var warn = warnings[j];
                    var rowInfo = warn.metadata && warn.metadata.row ? ' [row ' + warn.metadata.row + ']' : '';
                    lines.push('    - ' + warn.message + rowInfo);
                    shownW++;
                }
                if (warnings.length > maxDetails) {
                    lines.push('    ... and ' + (warnings.length - maxDetails) + ' more warnings');
                }
            }
        }

        return lines.join('\n');
    };

    // ============================================================
    // Merging
    // ============================================================

    /**
     * Merge another ImportResult into this one.
     * 
     * @param {ImportResult} other - Another ImportResult instance
     */
    ImportResult.prototype.merge = function(other) {
        if (!(other instanceof ImportResult)) {
            throw new TypeError('Must merge with another ImportResult');
        }

        var valid = other.getValid(true);
        for (var i = 0; i < valid.length; i++) {
            this.addValid(valid[i].record, valid[i].metadata);
        }

        var errors = other.getErrors(true);
        for (var j = 0; j < errors.length; j++) {
            this.addError(errors[j].message, errors[j].metadata);
        }

        var warnings = other.getWarnings(true);
        for (var k = 0; k < warnings.length; k++) {
            this.addWarning(warnings[k].message, warnings[k].metadata);
        }

        this._added += other._added;
        this._updated += other._updated;
        this._skipped += other._skipped;
    };

    // ============================================================
    // Serialization
    // ============================================================

    /**
     * Convert the result to a plain object for serialization.
     * 
     * @returns {Object} Plain object representation
     */
    ImportResult.prototype.toObject = function() {
        return {
            summary: this.getSummary(),
            valid: this.getValid(true),
            errors: this.getErrors(true),
            warnings: this.getWarnings(true)
        };
    };

    /**
     * Convert the result to a JSON string.
     * 
     * @param {number} indent - Indentation level
     * @returns {string} JSON string
     */
    ImportResult.prototype.toJSON = function(indent) {
        return JSON.stringify(this.toObject(), null, indent || 2);
    };

    // ============================================================
    // Factory Methods
    // ============================================================

    /**
     * Create an ImportResult from a plain object.
     * 
     * @param {Object} obj - Plain object with valid/errors/warnings
     * @returns {ImportResult} New ImportResult instance
     */
    ImportResult.fromObject = function(obj) {
        var result = new ImportResult();

        if (obj && typeof obj === 'object') {
            if (Array.isArray(obj.valid)) {
                for (var i = 0; i < obj.valid.length; i++) {
                    var item = obj.valid[i];
                    if (item && typeof item === 'object') {
                        result.addValid(item.record || item, item.metadata);
                    }
                }
            }

            if (Array.isArray(obj.errors)) {
                for (var j = 0; j < obj.errors.length; j++) {
                    var err = obj.errors[j];
                    if (typeof err === 'string') {
                        result.addError(err);
                    } else if (err && typeof err === 'object') {
                        result.addError(err.message || 'Unknown error', err.metadata);
                    }
                }
            }

            if (Array.isArray(obj.warnings)) {
                for (var k = 0; k < obj.warnings.length; k++) {
                    var warn = obj.warnings[k];
                    if (typeof warn === 'string') {
                        result.addWarning(warn);
                    } else if (warn && typeof warn === 'object') {
                        result.addWarning(warn.message || 'Unknown warning', warn.metadata);
                    }
                }
            }

            if (typeof obj.added === 'number') {
                result.setAdded(obj.added);
            }
            if (typeof obj.updated === 'number') {
                result.setUpdated(obj.updated);
            }
        }

        return result;
    };

    /**
     * Create an empty ImportResult.
     * 
     * @returns {ImportResult} Empty ImportResult
     */
    ImportResult.empty = function() {
        return new ImportResult();
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ImportResult = ImportResult;

})();
