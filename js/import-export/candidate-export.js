/**
 * modules/teams/candidate-export.js - Professional Pool Candidate Export
 * Plain-text dump of the current Professional Pool.
 *
 * Path: js/modules/teams/candidate-export.js
 *
 * WHAT THIS OWNS:
 *   - Building a plain-text report from the Professional Pool VM.
 *   - Handing the payload to ExportUtils.downloadBlob.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The pool projection. TeamAggregator.getProfessionalPoolViewModel
 *     supplies the VM; this module formats and downloads it.
 *   - UI. team-events.js triggers the export; this module returns
 *     a result object.
 *   - Format selection. One format: plain text.
 *   - Download mechanics. ExportUtils.downloadBlob owns the anchor,
 *     the blob URL, and the filename uniquification. This module
 *     supplies a base filename and hands over the payload.
 *
 * DATASET:
 *   The report covers exactly what the Professional Pool view is
 *   showing: available candidates and future-assigned candidates
 *   at the requested period. It does not include:
 *     - active-team members (already assigned)
 *     - support staff (a different domain)
 *     - retired, deceased, or eliminated characters (already
 *       excluded by the pool projection upstream)
 *
 * REPORT CONTENTS:
 *   - Header with period and counts.
 *   - Available section: one line per candidate with name, age,
 *     status, availability, and any historical note.
 *   - Future Assignments section (when non-empty): same shape plus
 *     the next assignment.
 *
 * DOWNLOAD FILENAMES:
 *   This module produces a base filename of the form
 *   "pool_candidates_<period>_<timestamp>.txt". ExportUtils
 *   .downloadBlob inserts its own local-time timestamp before the
 *   extension, so a second export at the same period in the same
 *   session never collides with the first. The per-module
 *   timestamp remains because it makes the base name
 *   human-readable in logs; the central timestamp is what
 *   guarantees uniqueness.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamAggregator
 *   - window.TeamConstants
 *   - window.ExportUtils
 */

(function() {
    'use strict';

    if (window.__candidateExportLoaded) {
        return;
    }
    window.__candidateExportLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamAggregator = window.TeamAggregator;
    var TeamConstants = window.TeamConstants;
    var ExportUtils = window.ExportUtils;

    var _missing = [];

    if (!TeamAggregator ||
        typeof TeamAggregator.getProfessionalPoolViewModel !==
        'function') {
        _missing.push(
            'TeamAggregator.getProfessionalPoolViewModel'
        );
    }
    if (!TeamConstants ||
        typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
    }
    if (!ExportUtils ||
        typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[CandidateExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function pad(value, width) {
        var str = String(value);
        while (str.length < width) {
            str = '0' + str;
        }
        return str;
    }

    function timestampSlug() {
        var now = new Date();
        return now.getFullYear() + '-' +
               pad(now.getMonth() + 1, 2) + '-' +
               pad(now.getDate(), 2) + '_' +
               pad(now.getHours(), 2) + '-' +
               pad(now.getMinutes(), 2) + '-' +
               pad(now.getSeconds(), 2);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function lineUnder(text) {
        var out = '';
        for (var i = 0; i < text.length; i++) {
            out += '=';
        }
        return out;
    }

    function lineDash(text) {
        var out = '';
        for (var i = 0; i < text.length; i++) {
            out += '-';
        }
        return out;
    }

    // ============================================================
    // ROW FORMATTING
    // ============================================================
    //
    // Each row is one candidate, formatted as a compact block:
    //
    //   Name (Age) · Status
    //     Available 1902–1907
    //     Next: Team Valiant from 1909
    //     Former: 2 professional teams
    //
    // Blank fields are omitted rather than printed as "—".

    function pushPoolRow(lines, row, indent) {
        var prefix = indent || '  ';

        var header = row.displayName || 'Unknown';
        if (isNonEmptyString(row.ageDisplay)) {
            header += ' (' + row.ageDisplay + ')';
        }
        if (isNonEmptyString(row.statusAtPeriod)) {
            header += ' \u00b7 ' + row.statusAtPeriod;
        }

        lines.push(prefix + header);

        var availabilityLine = formatAvailabilityLine(row);
        if (availabilityLine) {
            lines.push(prefix + '  ' + availabilityLine);
        }

        var assignmentLine = formatAssignmentLine(row);
        if (assignmentLine) {
            lines.push(prefix + '  ' + assignmentLine);
        }

        var historyLine = formatHistoryLine(row);
        if (historyLine) {
            lines.push(prefix + '  ' + historyLine);
        }
    }

    function formatAvailabilityLine(row) {
        if (!row.availability) { return ''; }
        var display = row.availability.display;
        if (!isNonEmptyString(display)) { return ''; }
        if (display === 'any') { return 'Available any year'; }
        return 'Available ' + display;
    }

    function formatAssignmentLine(row) {
        if (!row.assignment) { return ''; }
        if (row.assignment.status !== 'future') { return ''; }

        var team = row.assignment.nextTeamName;
        var year = row.assignment.nextJoinYear;

        if (!isNonEmptyString(team)) { return ''; }
        if (year === null || year === undefined) {
            return 'Next: ' + team;
        }
        return 'Next: ' + team + ' from ' + String(year);
    }

    function formatHistoryLine(row) {
        if (!row.history) { return ''; }
        if (row.history.hasProfessionalHistory !== true) {
            return 'Former: none';
        }
        var count = row.history.formerTeamCount;
        if (typeof count !== 'number' || count <= 0) {
            return 'Former: none';
        }
        return 'Former: ' + count + ' professional team' +
            (count === 1 ? '' : 's');
    }

    // ============================================================
    // REPORT BUILDER
    // ============================================================

    function buildReport(period) {
        var poolVM = TeamAggregator.getProfessionalPoolViewModel({
            period: period
        });

        if (!poolVM) {
            return {
                error: 'Failed to build the Professional Pool.'
            };
        }

        var available = Array.isArray(poolVM.available)
            ? poolVM.available
            : [];
        var future = Array.isArray(poolVM.future)
            ? poolVM.future
            : [];

        var lines = [];

        var title = 'PROFESSIONAL POOL CANDIDATES \u2014 ' +
            String(poolVM.period);
        lines.push(title);
        lines.push(lineUnder(title));
        lines.push('');

        pushSummary(lines, available.length, future.length);
        pushAvailableSection(lines, available);
        pushFutureSection(lines, future);

        return {
            exported: true,
            filename: buildFilename(poolVM.period),
            text: lines.join('\n'),
            count: available.length + future.length,
            period: poolVM.period
        };
    }

    function buildFilename(period) {
        return 'pool_candidates_' +
            String(period) + '_' +
            timestampSlug() +
            '.txt';
    }

    function pushSummary(lines, availableCount, futureCount) {
        var total = availableCount + futureCount;

        lines.push('SUMMARY');
        lines.push(lineDash('SUMMARY'));
        lines.push('');
        lines.push('  Total candidates:  ' + total);
        lines.push('  Available now:     ' + availableCount);
        lines.push('  Future assigned:   ' + futureCount);
        lines.push('');
    }

    function pushAvailableSection(lines, available) {
        var title = 'AVAILABLE (' + available.length + ')';
        lines.push(title);
        lines.push(lineDash(title));
        lines.push('');

        if (available.length === 0) {
            lines.push('  (no available candidates)');
            lines.push('');
            return;
        }

        for (var i = 0; i < available.length; i++) {
            pushPoolRow(lines, available[i], '  ');
            lines.push('');
        }
    }

    function pushFutureSection(lines, future) {
        if (future.length === 0) { return; }

        var title = 'FUTURE ASSIGNMENTS (' + future.length + ')';
        lines.push(title);
        lines.push(lineDash(title));
        lines.push('');

        for (var i = 0; i < future.length; i++) {
            pushPoolRow(lines, future[i], '  ');
            lines.push('');
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Export the current Professional Pool as a plain-text report.
     *
     * @param {object} options
     * @param {number|string} options.period - The period to build
     *   the pool for. Required.
     * @returns {object} { exported, filename, count, period } or
     *   { error }
     */
    function exportPool(options) {
        options = options || {};

        var period = TeamConstants.parsePeriod(options.period);
        if (period === null) {
            return { error: 'A valid period is required.' };
        }

        var built;
        try {
            built = buildReport(period);
        } catch (e) {
            console.warn(
                '[CandidateExport] buildReport threw:', e
            );
            return {
                error: 'Failed to build the report: ' + e.message
            };
        }

        if (built.error) { return built; }

        var blob;
        try {
            blob = new Blob([built.text], {
                type: 'text/plain;charset=utf-8'
            });
        } catch (e) {
            return { error: 'Failed to build file blob: ' + e.message };
        }

        try {
            ExportUtils.downloadBlob(blob, built.filename);
        } catch (e) {
            return { error: 'Download failed: ' + e.message };
        }

        return {
            exported: true,
            filename: built.filename,
            count: built.count,
            period: built.period
        };
    }

    /**
     * Build the report without downloading. For tests and preview.
     *
     * @param {object} options
     * @param {number|string} options.period
     * @returns {object} { text, filename, count, period } or
     *   { error }
     */
    function buildPoolReport(options) {
        options = options || {};

        var period = TeamConstants.parsePeriod(options.period);
        if (period === null) {
            return { error: 'A valid period is required.' };
        }

        var built;
        try {
            built = buildReport(period);
        } catch (e) {
            return {
                error: 'Failed to build the report: ' + e.message
            };
        }

        if (built.error) { return built; }

        return {
            text: built.text,
            filename: built.filename,
            count: built.count,
            period: built.period
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================
    //
    // team-events.js binds #export-candidates-btn and calls
    // CandidateExport.export({ period }). The `export` alias below
    // matches that call site; `exportPool` is the canonical name.

    window.CandidateExport = Object.freeze({
        export: exportPool,
        exportPool: exportPool,
        buildPoolReport: buildPoolReport
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CandidateExport;
        var missing = [];

        if (typeof exports.export !== 'function') {
            missing.push('export');
        }
        if (typeof exports.exportPool !== 'function') {
            missing.push('exportPool');
        }
        if (typeof exports.buildPoolReport !== 'function') {
            missing.push('buildPoolReport');
        }

        if (missing.length > 0) {
            console.warn(
                '[CandidateExport] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
