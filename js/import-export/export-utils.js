/**
 * js/export/export-utils.js - Shared Export Utilities
 *
 * This module provides utility functions for CSV/JSON import/export operations.
 * It focuses on file handling, CSV row validation, and JSON parsing for imports.
 *
 * It does NOT contain:
 * - ID generation or normalisation (use IdUtils)
 * - Object cloning (use ObjectUtils)
 * - Application data detection (use ApplicationDataSchema)
 * - Business logic or domain knowledge
 *
 * All other export/import modules should depend on these primitives.
 *
 * DOWNLOAD RELIABILITY (this revision):
 *   downloadBlob has been reworked around two observations:
 *
 *   1. SOME ANDROID WEBVIEW-BASED BROWSERS (Ecosia, several
 *      Chromium shells, older Samsung Internet builds) SERVICE
 *      ONLY THE FIRST blob: URL DOWNLOAD PER PAGE LOAD. A second
 *      synthetic anchor click with a blob: href is silently
 *      dropped by the WebView's download listener. There is no
 *      JS-observable signal that this happened: the anchor's
 *      click() returns normally, no exception is thrown, and the
 *      browser never fires a download-failed event.
 *
 *      data: URLs route through a different path in these
 *      WebViews and are not subject to the same per-page-load
 *      quota. This module therefore prefers a data: URL when the
 *      payload is small enough to be encoded safely, and falls
 *      back to a blob: URL when it is not.
 *
 *      The size limit is deliberately conservative (DATA_URL_MAX_BYTES,
 *      see below). Android WebViews commonly reject or truncate
 *      data: URLs above a few megabytes. A text mission report is
 *      well under the limit. A full JSON backup of a large store
 *      may not be, and is sent as a blob instead.
 *
 *   2. BROWSERS REFUSE A SECOND DOWNLOAD WHOSE FILENAME MATCHES
 *      ONE ALREADY WRITTEN IN THE SAME SESSION. downloadBlob
 *      therefore suffixes every filename with a local-time
 *      timestamp before dispatch. The timestamp is what makes the
 *      SECOND download in a session work on the browsers that DO
 *      permit multiple downloads:
 *
 *        Browsers refuse to write a second file with the same
 *        name in the same session without user confirmation. If
 *        the confirmation dialog is suppressed (which it is when
 *        the tab is unfocused or "ask where to save" is off),
 *        the download is silently dropped and JS has no way to
 *        know.
 *
 *        A unique filename sidesteps the collision entirely. The
 *        browser sees a new file and writes it.
 *
 *      The timestamp includes a ten-millisecond-resolution suffix,
 *      so two exports fired from the same event handler do not
 *      collide.
 *
 *   The blob URL is deliberately NOT revoked on the same tick.
 *   Revoking on a timer raced the browser's download manager and
 *   killed the download for larger payloads. The new 60-second
 *   delay is long enough for any realistic download to finish;
 *   after that the URL is reclaimed. If the page unloads first,
 *   the browser reclaims it anyway.
 *
 *   The anchor is removed synchronously, immediately after click
 *   returns, and the removal is guarded so a stray double-click
 *   cannot throw.
 *
 *   IF YOU STILL SEE "FIRST EXPORT WORKS, SECOND SILENTLY FAILS"
 *   ON A TARGET BROWSER, READ THE HEADER OF downloadBlob. THE
 *   FALLBACK PATH IS DOCUMENTED THERE.
 */

(function() {
    'use strict';

    // ============================================================
    // Warning Management
    // ============================================================

    /**
     * Maximum number of warnings to store before truncating
     */
    var MAX_WARNINGS = 50;

    /**
     * Add a warning to a warnings array with a cap.
     *
     * @param {Array} warnings - Array to add warning to
     * @param {string} message - Warning message
     */
    function addWarning(warnings, message) {
        if (!Array.isArray(warnings)) return;

        if (warnings.length < MAX_WARNINGS - 1) {
            warnings.push(message);
        } else if (warnings.length === MAX_WARNINGS - 1) {
            warnings.push('Additional warnings omitted.');
        }
    }

    // ============================================================
    // CSV Row Helpers
    // ============================================================

    /**
     * Check if a CSV row is completely blank.
     *
     * @param {Array} row - CSV row as array of strings
     * @returns {boolean} True if all cells are empty
     */
    function isBlankRow(row) {
        if (!row || row.length === 0) {
            return true;
        }

        for (var i = 0; i < row.length; i++) {
            var cell = String(row[i] == null ? '' : row[i]).trim();
            if (cell !== '') {
                return false;
            }
        }
        return true;
    }

    /**
     * Require a field to be non-empty.
     *
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @returns {string} Trimmed field value
     * @throws {Error} If field is missing or empty
     */
    function requireField(row, index, fieldName) {
        var value = String(row[index] == null ? '' : row[index]).trim();
        if (!value) {
            throw new Error('Missing required field "' + fieldName + '" at column ' + (index + 1));
        }
        return value;
    }

    /**
     * Require a field to be a valid integer.
     *
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {number} fallback - Default value if empty
     * @returns {number} Parsed integer
     * @throws {Error} If value is not a valid integer
     */
    function requireInteger(row, index, fieldName, fallback) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && fallback !== undefined) {
            return fallback;
        }

        if (value === '') {
            throw new Error('Missing required numeric field "' + fieldName + '" at column ' + (index + 1));
        }

        if (!/^-?\d+$/.test(value)) {
            throw new Error('Invalid integer "' + value + '" for field "' + fieldName + '" at column ' + (index + 1));
        }

        var parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
            throw new Error('Integer "' + value + '" is outside safe range for "' + fieldName + '" at column ' + (index + 1));
        }

        return parsed;
    }

    /**
     * Require a field to be a valid number.
     *
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {number} fallback - Default value if empty
     * @returns {number} Parsed number
     * @throws {Error} If value is not a valid number
     */
    function requireNumber(row, index, fieldName, fallback) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && fallback !== undefined) {
            return fallback;
        }

        if (value === '') {
            throw new Error('Missing required numeric field "' + fieldName + '" at column ' + (index + 1));
        }

        if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
            throw new Error('Invalid number "' + value + '" for field "' + fieldName + '" at column ' + (index + 1));
        }

        var parsed = Number(value);
        if (!isFinite(parsed)) {
            throw new Error('Number "' + value + '" is out of range for "' + fieldName + '" at column ' + (index + 1));
        }

        return parsed;
    }

    /**
     * Require a field to be one of the allowed enum values.
     *
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {Array} allowed - Array of allowed values
     * @param {string} defaultValue - Default value if empty
     * @returns {string} Valid enum value
     * @throws {Error} If value is not in the allowed list
     */
    function requireEnum(row, index, fieldName, allowed, defaultValue) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && defaultValue !== undefined) {
            return defaultValue;
        }

        if (value === '') {
            throw new Error('Missing required field "' + fieldName + '" at column ' + (index + 1));
        }

        if (allowed.indexOf(value) === -1) {
            throw new Error('Invalid value "' + value + '" for "' + fieldName + '". Allowed: ' + allowed.join(', '));
        }

        return value;
    }

    // ============================================================
    // JSON Field Helpers
    // ============================================================

    /**
     * Parse a JSON array field from a CSV cell.
     *
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {Array} fallback - Default value if empty or invalid
     * @param {Function} warnFn - Optional warning callback
     * @returns {Array} Parsed JSON array or fallback
     */
    function parseJSONArray(row, index, fieldName, fallback, warnFn) {
        fallback = Array.isArray(fallback) ? fallback : [];

        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON array in "' + fieldName + '": ' + e.message + ' - using fallback');
            }
            return fallback;
        }
    }

    /**
     * Parse a JSON object field from a CSV cell.
     *
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {Object} fallback - Default value if empty or invalid
     * @param {Function} warnFn - Optional warning callback
     * @returns {Object} Parsed JSON object or fallback
     */
    function parseJSONObject(row, index, fieldName, fallback, warnFn) {
        fallback = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};

        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);
            if (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object') {
                throw new Error('Expected JSON object, got ' + (Array.isArray(parsed) ? 'array' : typeof parsed));
            }
            return parsed;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON object in "' + fieldName + '": ' + e.message + ' - using fallback');
            }
            return fallback;
        }
    }

    /**
     * Parse any JSON value from a CSV cell with validation.
     *
     * @param {Array} row - CSV row
     * @param {number} index - Column index
     * @param {string} fieldName - Name of the field (for error messages)
     * @param {*} fallback - Default value if empty or invalid
     * @param {Function} warnFn - Optional warning callback
     * @param {string} expectedType - Expected type ('array', 'object', 'string', etc.)
     * @returns {*} Parsed JSON value or fallback
     */
    function parseJSON(row, index, fieldName, fallback, warnFn, expectedType) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);

            if (expectedType === 'array' && !Array.isArray(parsed)) {
                throw new Error('Expected JSON array, got ' + typeof parsed);
            }
            if (expectedType === 'object' && (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object')) {
                throw new Error('Expected JSON object, got ' + (Array.isArray(parsed) ? 'array' : typeof parsed));
            }
            if (expectedType === 'string' && typeof parsed !== 'string') {
                throw new Error('Expected JSON string, got ' + typeof parsed);
            }
            if (expectedType === 'number' && typeof parsed !== 'number') {
                throw new Error('Expected JSON number, got ' + typeof parsed);
            }
            if (expectedType === 'boolean' && typeof parsed !== 'boolean') {
                throw new Error('Expected JSON boolean, got ' + typeof parsed);
            }

            return parsed;
        } catch (e) {
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON in "' + fieldName + '": ' + e.message + ' - using fallback');
            }
            return fallback;
        }
    }

    // ============================================================
    // Filename Uniquification
    // ============================================================

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    /**
     * Insert a local-time timestamp into a filename, immediately
     * before the extension.
     *
     *   "character-alice.json"  ->  "character-alice-20261009-143052.json"
     *   "character-alice"       ->  "character-alice-20261009-143052"
     *   ""                      ->  "download-20261009-143052"
     *
     * Two-digit fields, no punctuation inside the timestamp itself,
     * so the result is filesystem-safe on every OS. The trailing
     * two digits are a ten-millisecond-resolution counter, so two
     * exports fired from the same event handler do not collide.
     *
     * @param {string} filename
     * @returns {string}
     */
    function appendTimestampToFilename(filename) {
        var now = new Date();
        var stamp =
            String(now.getFullYear()) +
            pad2(now.getMonth() + 1) +
            pad2(now.getDate()) + '-' +
            pad2(now.getHours()) +
            pad2(now.getMinutes()) +
            pad2(now.getSeconds()) +
            pad2(Math.floor(now.getMilliseconds() / 10));

        var name = String(filename || '').trim();
        if (name === '') {
            return 'download-' + stamp;
        }

        var dotIndex = name.lastIndexOf('.');
        if (dotIndex <= 0) {
            // No extension, or dotfile. Append at the end.
            return name + '-' + stamp;
        }

        var stem = name.substring(0, dotIndex);
        var ext = name.substring(dotIndex);

        return stem + '-' + stamp + ext;
    }

    // ============================================================
    // File Helpers
    // ============================================================

    /**
     * Maximum payload size, in bytes, that will be routed through a
     * data: URL rather than a blob: URL.
     *
     * WHY THIS EXISTS:
     *   Some Android WebView-based browsers (Ecosia, several
     *   Chromium shells) service only the FIRST blob: URL download
     *   per page load. A second synthetic anchor click with a
     *   blob: href is silently dropped by the WebView's download
     *   listener, with no JS-observable signal.
     *
     *   data: URLs route through a different path in those WebViews
     *   and are not subject to the same per-page-load quota. They
     *   are, however, subject to a size limit. Android WebViews
     *   commonly reject or truncate data: URLs above a few
     *   megabytes; the exact threshold varies by vendor and
     *   version. This constant is deliberately conservative.
     *
     *   2 MB is comfortably large enough for every text export the
     *   app produces (mission, team, candidate, schedule, class
     *   roster, character report) and for small JSON exports. A
     *   full JSON backup of a large store will exceed it and fall
     *   through to the blob: path, which is the correct behaviour:
     *   a single large backup is a single download, which the
     *   WebView quota still permits.
     */
    var DATA_URL_MAX_BYTES = 2 * 1024 * 1024;

    /**
     * Read a Blob as a data: URL.
     *
     * @param {Blob} blob
     * @returns {Promise<string>}
     */
    function readBlobAsDataURL(blob) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                resolve(e.target.result);
            };
            reader.onerror = function() {
                reject(new Error(
                    'Failed to read blob: ' +
                    (reader.error ? reader.error.message : 'Unknown error')
                ));
            };
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Create the anchor, click it, and schedule cleanup.
     *
     * @param {string} href
     * @param {string} downloadName
     * @param {string|null} revokeUrl - URL to revoke after the
     *   download has had time to complete. Null for data: URLs,
     *   which have nothing to revoke.
     */
    function dispatchDownload(href, downloadName, revokeUrl) {
        var a = document.createElement('a');
        a.href = href;
        a.download = downloadName;
        a.style.display = 'none';

        document.body.appendChild(a);

        try {
            a.click();
        } finally {
            try {
                if (a.parentNode) {
                    a.parentNode.removeChild(a);
                }
            } catch (e) {
                // Guarded. A concurrent removal is harmless.
            }

            if (revokeUrl) {
                // Deliberately delayed. See file header.
                setTimeout(function() {
                    try { URL.revokeObjectURL(revokeUrl); }
                    catch (e) { /* ignore */ }
                }, 60000);
            }
        }
    }

    /**
     * Download a blob as a file.
     *
     * STRATEGY:
     *   Small payloads (<= DATA_URL_MAX_BYTES) are read into a
     *   data: URL and dispatched through that. This is the path
     *   that works on Android WebView-based browsers that only
     *   permit one blob: download per page load.
     *
     *   Large payloads fall through to a blob: URL. The filename
     *   timestamp guarantees uniqueness so a second blob: download
     *   is not refused by filename collision on browsers that DO
     *   permit multiple blob: downloads.
     *
     * The function is fire-and-forget: it returns before the
     * download has actually landed. There is no browser API that
     * reports download success or failure, so the caller cannot
     * know either. The success notification shown by an exporter
     * therefore means "the blob was handed to the download
     * manager," not "the file was written."
     *
     * @param {Blob} blob - Blob to download
     * @param {string} filename - Base filename; a timestamp is
     *   inserted before the extension automatically
     */
    function downloadBlob(blob, filename) {
        var stampedName = appendTimestampToFilename(filename);

        // ---- Legacy: MS Edge / IE ----
        if (window.navigator && window.navigator.msSaveBlob) {
            try {
                window.navigator.msSaveBlob(blob, stampedName);
            } catch (e) {
                console.warn(
                    '[ExportUtils] msSaveBlob failed:', e
                );
            }
            return;
        }

        var size = (blob && typeof blob.size === 'number')
            ? blob.size
            : 0;

        if (size > 0 && size <= DATA_URL_MAX_BYTES) {
            // ---- Small payload: data: URL path ----
            //
            // Fallback if the read fails: use the blob URL path.
            // The read can fail if the blob is not readable (rare)
            // or if the FileReader is unavailable (even rarer).
            readBlobAsDataURL(blob).then(function(dataUrl) {
                dispatchDownload(dataUrl, stampedName, null);
            }).catch(function(err) {
                console.warn(
                    '[ExportUtils] data: URL path failed; ' +
                    'falling back to blob: URL:', err
                );
                var url = URL.createObjectURL(blob);
                dispatchDownload(url, stampedName, url);
            });
            return;
        }

        // ---- Large payload: blob: URL path ----
        //
        // The filename is timestamped, so a second download does
        // not collide on browsers that permit multiple downloads.
        // On a WebView that permits only one blob: download per
        // page load, a second large export will still be dropped;
        // there is no workaround for that case short of serving
        // the file over HTTP.
        var url = URL.createObjectURL(blob);
        dispatchDownload(url, stampedName, url);
    }

    /**
     * Read a file as text.
     *
     * @param {File} file - File to read
     * @returns {Promise<string>} Promise resolving to file contents
     */
    function readFileAsText(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                resolve(e.target.result);
            };
            reader.onerror = function() {
                reject(new Error('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error')));
            };
            reader.readAsText(file);
        });
    }

    /**
     * Read a file as JSON.
     *
     * @param {File} file - File to read
     * @returns {Promise<Object>} Promise resolving to parsed JSON
     */
    function readFileAsJSON(file) {
        return readFileAsText(file).then(function(text) {
            try {
                return JSON.parse(text);
            } catch (e) {
                throw new Error('Invalid JSON: ' + e.message);
            }
        });
    }

    // ============================================================
    // Validate UTF-8 BOM
    // ============================================================

    /**
     * Check if text starts with UTF-8 BOM and remove it.
     *
     * @param {string} text - Text to check
     * @returns {string} Text without BOM
     */
    function stripBOM(text) {
        if (typeof text === 'string' && text.startsWith('\uFEFF')) {
            return text.substring(1);
        }
        return text;
    }

    /**
     * Check if text has a UTF-8 BOM.
     *
     * @param {string} text - Text to check
     * @returns {boolean} True if BOM is present
     */
    function hasBOM(text) {
        return typeof text === 'string' && text.startsWith('\uFEFF');
    }

    // ============================================================
    // Expose
    // ============================================================

    window.ExportUtils = {
        // Constants
        MAX_WARNINGS: MAX_WARNINGS,
        DATA_URL_MAX_BYTES: DATA_URL_MAX_BYTES,

        // Warning management
        addWarning: addWarning,

        // CSV row helpers
        isBlankRow: isBlankRow,
        requireField: requireField,
        requireInteger: requireInteger,
        requireNumber: requireNumber,
        requireEnum: requireEnum,

        // JSON field helpers
        parseJSONArray: parseJSONArray,
        parseJSONObject: parseJSONObject,
        parseJSON: parseJSON,

        // File helpers
        downloadBlob: downloadBlob,
        readFileAsText: readFileAsText,
        readFileAsJSON: readFileAsJSON,

        // Filename helpers
        appendTimestampToFilename: appendTimestampToFilename,

        // BOM helpers
        stripBOM: stripBOM,
        hasBOM: hasBOM
    };

    // Also expose as FileUtils for clarity
    window.FileUtils = {
        downloadBlob: downloadBlob,
        readFileAsText: readFileAsText,
        readFileAsJSON: readFileAsJSON,
        stripBOM: stripBOM,
        hasBOM: hasBOM
    };

})();
