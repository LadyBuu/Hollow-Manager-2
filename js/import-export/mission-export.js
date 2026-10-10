/**
 * js/modules/missions/mission-export.js - Mission Export
 *
 * Path: js/modules/missions/mission-export.js
 *
 * Full textual dump of a single mission.
 *
 * WHAT THIS OWNS:
 *   - Building a plain-text report for one mission.
 *   - Handing the payload to ExportUtils.downloadBlob.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. MissionQueries, CharacterQueries, and TeamQueries
 *     supply the raw data. This module composes them.
 *   - Projection. The report walks the mission record directly and
 *     resolves cross-domain names as it goes. It does not go through
 *     MissionAggregator; the VM is shaped for the UI, not for a text
 *     dump.
 *   - UI. MissionEvents / MissionUI triggers the export; this module
 *     returns a result object.
 *   - Format selection. One format: plain text.
 *   - Download mechanics. ExportUtils.downloadBlob owns the anchor,
 *     the blob URL, and the filename uniquification. This module
 *     supplies a base filename and hands over the payload.
 *
 * REPORT CONTENTS (in order):
 *   - Header: title, mission ID (derived), status, priority.
 *   - Classification: difficulty, type chain, escalation, billing.
 *   - Timing: date, created, completed, archived.
 *   - Assignment: team, location, duration, pay.
 *   - Description.
 *   - Objectives: checklist with progress.
 *   - Support personnel: resolved names.
 *   - Reports: full text of each, timestamped, author resolved.
 *   - Activity log: timestamped entries.
 *   - Notes and tags.
 *
 * SECTIONS COLLAPSE when empty. A mission with no reports shows
 * "(none)" under REPORTS rather than an empty section. The reader
 * always sees what is present and what is not.
 *
 * LABEL:
 *   The mission label (YEAR-SEQ-DIFFICULTY) is a derived value.
 *   This module calls MissionId.derive() and never stores or
 *   caches the result. An invalid mission (missing year, sequence,
 *   or difficulty) prints "(unavailable)" for the label and
 *   continues.
 *
 * FAIL-CLOSED:
 *   A malformed nested record (objective, report, log entry) is
 *   skipped with a visible marker. The report never fabricates
 *   content. If the mission itself does not resolve, the export
 *   returns { error } rather than an empty file.
 *
 * DOWNLOAD FILENAMES:
 *   This module produces a base filename of the form
 *   "mission_<slug>_<id>_<timestamp>.txt". ExportUtils.downloadBlob
 *   inserts its own local-time timestamp before the extension, so a
 *   second export of the same mission in the same session never
 *   collides with the first. The per-module timestamp remains
 *   because it makes the base name human-readable in logs; the
 *   central timestamp is what guarantees uniqueness.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.MissionQueries
 *   - window.MissionId
 *   - window.MissionConstants
 *   - window.MissionRules
 *   - window.MissionViews
 *   - window.CharacterQueries
 *   - window.TeamQueries
 *   - window.ExportUtils
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - (none)
 */

(function() {
    'use strict';

    if (window.__missionExportLoaded) {
        return;
    }
    window.__missionExportLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var MissionQueries = window.MissionQueries;
    var MissionId = window.MissionId;
    var MissionConstants = window.MissionConstants;
    var MissionRules = window.MissionRules;
    var MissionViews = window.MissionViews;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var ExportUtils = window.ExportUtils;

    var _missing = [];

    if (!MissionQueries ||
        typeof MissionQueries.getMission !== 'function') {
        _missing.push('MissionQueries.getMission');
    }
    if (!MissionId ||
        typeof MissionId.derive !== 'function') {
        _missing.push('MissionId.derive');
    }
    if (!MissionConstants) {
        _missing.push('MissionConstants (module)');
    } else {
        if (typeof MissionConstants.getMissionTypeLabel !== 'function') {
            _missing.push('MissionConstants.getMissionTypeLabel');
        }
        if (typeof MissionConstants.getSubtypeLabel !== 'function') {
            _missing.push('MissionConstants.getSubtypeLabel');
        }
        if (typeof MissionConstants.getDifficultyLabel !== 'function') {
            _missing.push('MissionConstants.getDifficultyLabel');
        }
        if (typeof MissionConstants.getPriorityLabel !== 'function') {
            _missing.push('MissionConstants.getPriorityLabel');
        }
        if (typeof MissionConstants.getStatusLabel !== 'function') {
            _missing.push('MissionConstants.getStatusLabel');
        }
        if (typeof MissionConstants.getEscalationLabel !== 'function') {
            _missing.push('MissionConstants.getEscalationLabel');
        }
        if (typeof MissionConstants.getBillingLabel !== 'function') {
            _missing.push('MissionConstants.getBillingLabel');
        }
    }
    if (!MissionRules ||
        typeof MissionRules.calculateProgress !== 'function') {
        _missing.push('MissionRules.calculateProgress');
    }
    if (!MissionViews ||
        typeof MissionViews.formatTimestamp !== 'function') {
        _missing.push('MissionViews.formatTimestamp');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!ExportUtils ||
        typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // SMALL HELPERS
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

    function slugify(text) {
        if (!text || typeof text !== 'string') { return 'mission'; }
        var s = text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
        return s || 'mission';
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
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
    // LABEL COLUMN
    // ============================================================
    //
    // Fixed-width label column, matching the report style used by
    // team-export.js. "Status:        Active" — the label is padded
    // to LABEL_WIDTH, then the value follows. A line is emitted
    // only when the value is non-empty.

    var LABEL_WIDTH = 15;

    function labelled(label, value) {
        if (!isNonEmptyString(value)) { return null; }
        var lbl = String(label);
        while (lbl.length < LABEL_WIDTH) { lbl += ' '; }
        return lbl + ' ' + String(value).trim();
    }

    // ============================================================
    // CROSS-DOMAIN RESOLUTION
    // ============================================================

    function resolveCharacterName(charId) {
        if (!isNonEmptyString(charId)) { return ''; }
        var c = null;
        try {
            c = CharacterQueries.getCharacterById(charId);
        } catch (e) { c = null; }
        if (!c) { return '(missing character)'; }
        try {
            return CharacterQueries.getDisplayName(c) || '(unnamed)';
        } catch (e) {
            return '(unnamed)';
        }
    }

    function resolveTeamName(teamId) {
        if (!isNonEmptyString(teamId)) { return ''; }
        var t = null;
        try {
            t = TeamQueries.getTeamById(teamId);
        } catch (e) { t = null; }
        if (!t) { return '(missing team)'; }
        return isNonEmptyString(t.name) ? t.name : '(unnamed team)';
    }

    // ============================================================
    // SECTION BUILDERS
    // ============================================================

    function pushHeader(lines, mission) {
        var title = 'MISSION REPORT: ' +
            (isNonEmptyString(mission.title)
                ? mission.title
                : 'Untitled Mission');

        lines.push(title);
        lines.push(lineUnder(title));
        lines.push('');

        var missionIdLabel = null;
        try {
            missionIdLabel = MissionId.derive(mission);
        } catch (e) {
            missionIdLabel = null;
        }

        lines.push(labelled('Mission ID', missionIdLabel || '(unavailable)'));
        lines.push(labelled('Record ID', mission.id));

        var statusLabel = MissionConstants.getStatusLabel(
            mission.status
        );
        lines.push(labelled('Status', statusLabel || mission.status || '(unknown)'));

        var priorityLabel = MissionConstants.getPriorityLabel(
            mission.priority
        );
        lines.push(labelled('Priority', priorityLabel || mission.priority || '(unknown)'));

        lines.push('');
    }

    function pushClassification(lines, mission) {
        var heading = 'CLASSIFICATION';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        var difficultyLabel = MissionConstants.getDifficultyLabel(
            mission.difficulty
        );
        lines.push(labelled('Difficulty', difficultyLabel || '(unknown)'));

        var typeChain = buildTypeChain(mission);
        lines.push(labelled('Type', typeChain));

        var escalationLabel = MissionConstants.getEscalationLabel(
            mission.escalation
        );
        lines.push(labelled('Escalation', escalationLabel || '(unknown)'));

        var billingLabel = MissionConstants.getBillingLabel(
            mission.billing
        );
        lines.push(labelled('Billing', billingLabel || '(unknown)'));

        lines.push('');
    }

    function buildTypeChain(mission) {
        var parts = [];

        var primary = MissionConstants.getMissionTypeLabel(
            mission.primaryType
        );
        if (isNonEmptyString(primary)) {
            parts.push(primary);

            var subtype = MissionConstants.getSubtypeLabel(
                mission.primaryType,
                mission.subtype
            );
            if (isNonEmptyString(subtype)) {
                parts.push(subtype);
            }
        }

        var secondary = MissionConstants.getMissionTypeLabel(
            mission.secondaryType
        );
        if (isNonEmptyString(secondary)) {
            parts.push('+ ' + secondary);
        }

        return parts.join(' / ');
    }

    function pushTiming(lines, mission) {
        var heading = 'TIMING';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        lines.push(labelled('Date', buildDateDisplay(mission)));

        lines.push(labelled(
            'Created',
            MissionViews.formatTimestamp(mission.createdAt)
        ));
        lines.push(labelled(
            'Completed',
            MissionViews.formatTimestamp(mission.completedAt)
        ));
        lines.push(labelled(
            'Archived',
            MissionViews.formatTimestamp(mission.archivedAt)
        ));

        lines.push('');
    }

    function buildDateDisplay(mission) {
        var hasYear = mission.year !== undefined && mission.year !== null;
        var hasMonth = mission.month !== undefined && mission.month !== null;
        var hasDay = mission.day !== undefined && mission.day !== null;

        if (hasYear && hasMonth && hasDay) {
            return mission.year + '-' +
                pad(mission.month, 2) + '-' +
                pad(mission.day, 2);
        }
        if (hasYear && hasMonth) {
            return mission.year + '-' + pad(mission.month, 2);
        }
        if (hasYear) {
            return String(mission.year);
        }
        return '';
    }

    function pushAssignment(lines, mission) {
        var heading = 'ASSIGNMENT';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        var teamName = resolveTeamName(mission.assignedTeamId);
        lines.push(labelled('Team', teamName || 'Unassigned'));

        lines.push(labelled('Location', mission.location));
        lines.push(labelled('Duration', mission.duration));
        lines.push(labelled('Threat type', mission.threatType));
        lines.push(labelled('Environment', mission.environment));
        lines.push(labelled('Pay', mission.pay));

        lines.push('');
    }

    function pushDescription(lines, mission) {
        if (!isNonEmptyString(mission.description)) {
            return;
        }

        var heading = 'DESCRIPTION';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');
        lines.push(indentBlock(mission.description, '  '));
        lines.push('');
    }

    function pushObjectives(lines, mission) {
        var heading = 'OBJECTIVES';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        var objectives = Array.isArray(mission.objectives)
            ? mission.objectives
            : [];

        var progress = 0;
        try {
            progress = MissionRules.calculateProgress(objectives);
        } catch (e) {
            progress = 0;
        }

        if (objectives.length === 0) {
            lines.push('  (no objectives)');
            lines.push('');
            return;
        }

        lines.push('  Progress: ' + progress + '%');
        lines.push('');

        for (var i = 0; i < objectives.length; i++) {
            var obj = objectives[i];
            if (!isPlainObject(obj)) {
                lines.push('  [malformed objective ' + (i + 1) + ']');
                continue;
            }
            var mark = obj.done === true ? '[x]' : '[ ]';
            var text = isNonEmptyString(obj.text)
                ? obj.text
                : '(empty)';
            lines.push('  ' + mark + ' ' + text);
        }

        lines.push('');
    }

    function pushSupportPersonnel(lines, mission) {
        var heading = 'SUPPORT PERSONNEL';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        var support = Array.isArray(mission.supportPersonnel)
            ? mission.supportPersonnel
            : [];

        if (support.length === 0) {
            lines.push('  (none assigned)');
            lines.push('');
            return;
        }

        for (var i = 0; i < support.length; i++) {
            var id = support[i];
            if (!isNonEmptyString(id)) {
                lines.push('  [malformed support entry ' + (i + 1) + ']');
                continue;
            }
            lines.push('  - ' + resolveCharacterName(id));
        }

        lines.push('');
    }

    function pushReports(lines, mission) {
        var heading = 'REPORTS';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        var reports = Array.isArray(mission.reports)
            ? mission.reports
            : [];

        if (reports.length === 0) {
            lines.push('  (no reports)');
            lines.push('');
            return;
        }

        // Newest first, matching the UI.
        var sorted = reports.slice().sort(function(a, b) {
            var ta = a && isNonEmptyString(a.createdAt) ? a.createdAt : '';
            var tb = b && isNonEmptyString(b.createdAt) ? b.createdAt : '';
            if (ta !== tb) { return tb.localeCompare(ta); }
            return 0;
        });

        for (var i = 0; i < sorted.length; i++) {
            var report = sorted[i];
            if (!isPlainObject(report)) {
                lines.push('  [malformed report ' + (i + 1) + ']');
                lines.push('');
                continue;
            }

            var authorName;
            if (report.authorRedacted === true || !report.authorId) {
                authorName = '(redacted)';
            } else {
                authorName = resolveCharacterName(report.authorId);
            }

            var created = MissionViews.formatTimestamp(report.createdAt);
            var edited = report.updatedAt
                ? ' (edited ' +
                  MissionViews.formatTimestamp(report.updatedAt) + ')'
                : '';

            lines.push('  ' + authorName + ' — ' + created + edited);
            lines.push('');
            lines.push(indentBlock(report.text || '', '    '));
            lines.push('');
        }
    }

    function pushActivityLog(lines, mission) {
        var heading = 'ACTIVITY LOG';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        var log = Array.isArray(mission.log) ? mission.log : [];

        if (log.length === 0) {
            lines.push('  (no activity)');
            lines.push('');
            return;
        }

        // Log is stored append-order (oldest first); display
        // newest first, matching the UI.
        for (var i = log.length - 1; i >= 0; i--) {
            var entry = log[i];
            if (!isPlainObject(entry)) {
                lines.push('  [malformed log entry ' + (i + 1) + ']');
                continue;
            }
            var ts = MissionViews.formatTimestamp(entry.timestamp);
            var msg = isNonEmptyString(entry.message)
                ? entry.message
                : '(empty)';
            lines.push('  ' + ts + '  ' + msg);
        }

        lines.push('');
    }

    function pushNotes(lines, mission) {
        var hasNotes = isNonEmptyString(mission.notes);
        var hasTags = Array.isArray(mission.tags) && mission.tags.length > 0;

        if (!hasNotes && !hasTags) {
            return;
        }

        var heading = 'NOTES';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        if (hasNotes) {
            lines.push(indentBlock(mission.notes, '  '));
        }

        if (hasTags) {
            lines.push('');
            var tagLine = [];
            for (var i = 0; i < mission.tags.length; i++) {
                var t = mission.tags[i];
                if (isNonEmptyString(t)) {
                    tagLine.push('#' + t);
                }
            }
            lines.push('  Tags: ' + tagLine.join(' '));
        }

        lines.push('');
    }

    // ============================================================
    // INDENT HELPER
    // ============================================================
    //
    // Indent every line of a multi-line block by `prefix`. Empty
    // lines are preserved without the prefix, so a paragraph that
    // contains a blank line does not get trailing whitespace.

    function indentBlock(text, prefix) {
        if (!isNonEmptyString(text)) { return ''; }
        var lines = String(text).replace(/\r\n/g, '\n').split('\n');
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            if (lines[i] === '') {
                out.push('');
            } else {
                out.push(prefix + lines[i]);
            }
        }
        return out.join('\n');
    }

    // ============================================================
    // REPORT BUILDER
    // ============================================================

    function buildReport(missionId) {
        var mission = null;
        try {
            mission = MissionQueries.getMission(missionId);
        } catch (e) {
            mission = null;
        }

        if (!mission) {
            return { error: 'Mission not found.' };
        }

        var lines = [];

        pushHeader(lines, mission);
        pushClassification(lines, mission);
        pushTiming(lines, mission);
        pushAssignment(lines, mission);
        pushDescription(lines, mission);
        pushObjectives(lines, mission);
        pushSupportPersonnel(lines, mission);
        pushReports(lines, mission);
        pushActivityLog(lines, mission);
        pushNotes(lines, mission);

        // Footer
        var footer = 'END OF REPORT';
        lines.push(lineUnder(footer));
        lines.push(footer);
        lines.push(labelled('Record ID', mission.id));
        lines.push(labelled('Generated', new Date().toISOString()));
        lines.push(lineUnder(footer));

        return {
            exported: true,
            filename: buildFilename(mission),
            text: lines.join('\n')
        };
    }

    function buildFilename(mission) {
        var slug = slugify(mission.title);
        var idPart = isNonEmptyString(mission.id)
            ? String(mission.id)
            : 'unknown';
        return 'mission_' + slug + '_' + idPart +
            '_' + timestampSlug() + '.txt';
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Export a single mission as a plain-text report.
     *
     * @param {string} missionId
     * @returns {object}
     *   { exported: true, filename, count } on success
     *   { error: string } on failure
     */
    function exportMission(missionId) {
        if (!isNonEmptyString(missionId)) {
            return { error: 'Mission ID is required.' };
        }

        var built;
        try {
            built = buildReport(String(missionId));
        } catch (e) {
            console.warn(
                '[MissionExport] buildReport threw:', e
            );
            return { error: 'Failed to build report: ' + e.message };
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

        // "count" mirrors team-export.js: it reports the number of
        // primary entities written. A mission report is one
        // mission, so the count is 1. The field exists for shape
        // parity with the other exporters.
        return {
            exported: true,
            filename: built.filename,
            count: 1
        };
    }

    /**
     * Build the report without downloading. For tests and preview.
     *
     * @param {string} missionId
     * @returns {object}
     *   { text, filename } on success
     *   { error: string } on failure
     */
    function buildMissionReport(missionId) {
        if (!isNonEmptyString(missionId)) {
            return { error: 'Mission ID is required.' };
        }

        var built;
        try {
            built = buildReport(String(missionId));
        } catch (e) {
            return { error: 'Failed to build report: ' + e.message };
        }

        if (built.error) { return built; }

        return {
            text: built.text,
            filename: built.filename
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionExport = Object.freeze({
        exportMission: exportMission,
        buildMissionReport: buildMissionReport
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionExport;
        var missing = [];

        if (typeof exports.exportMission !== 'function') {
            missing.push('exportMission');
        }
        if (typeof exports.buildMissionReport !== 'function') {
            missing.push('buildMissionReport');
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionExport] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
