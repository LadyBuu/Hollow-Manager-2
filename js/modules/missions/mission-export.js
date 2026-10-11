/**
 * js/modules/missions/mission-export.js - Mission Export
 *
 * Path: js/modules/missions/mission-export.js
 *
 * Full textual dump of a single mission, plus a JSON dump of the
 * same mission.
 *
 * WHAT THIS OWNS:
 *   - Building a plain-text report for one mission.
 *   - Building a JSON blob for one mission.
 *   - Handing either payload to ExportUtils.downloadBlob.
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
 *   - Format selection. Two formats, but the caller picks one by
 *     calling the appropriate function. This module does not decide.
 *   - Download mechanics. ExportUtils.downloadBlob owns the anchor,
 *     the blob URL, and the filename uniquification. This module
 *     supplies a base filename and hands over the payload.
 *
 * FORMATS:
 *   Text   - human-readable, plain text. The default. Built by
 *            exportMissionText. A full report with sections:
 *            header, classification, timing, assignment,
 *            description, objectives, participants, support
 *            personnel, reports, activity log, notes and tags.
 *
 *   JSON   - the full mission record, verbatim. Built by
 *            exportMissionJson. Not wrapped in an envelope, not
 *            projected, not stripped. Every field the store
 *            carries is present. The record is deep-cloned before
 *            serialisation so the caller cannot mutate the store
 *            through the exported object.
 *
 * MULTIPLE TEAMS:
 *   The mission's assigned teams are read via
 *   MissionQueries.getTeamIdsForMission, which handles the legacy
 *   singular assignedTeamId transparently. The text report prints
 *   one line per team. The JSON export is verbatim, so whatever
 *   the record carries is what gets written.
 *
 * PARTICIPANTS (this revision):
 *   The text report prints a PARTICIPANTS section. Participants
 *   are grouped by source:
 *
 *     Team participants   listed under the team they belong to,
 *                         one block per team. The block header is
 *                         the team name.
 *
 *     Rookie participants listed under a "Rookies" header, one
 *                         line per rookie.
 *
 *   When no participants are recorded, the section prints
 *   "(none recorded)".
 *
 *   Participant names are resolved via CharacterQueries; a
 *   deceased character is annotated with a dagger marker, matching
 *   the UI convention. The JSON export carries the participants
 *   array verbatim — no resolution, no filtering.
 *
 *   The section is ordered to match the UI: team blocks first
 *   (sorted by team name), then the rookie block (sorted by
 *   character name within it).
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
 *   A malformed nested record (objective, report, log entry,
 *   participant) is skipped with a visible marker. The report
 *   never fabricates content. If the mission itself does not
 *   resolve, the export returns { error } rather than an empty
 *   file.
 *
 * DOWNLOAD FILENAMES:
 *   Text export base filename: "mission_<slug>_<id>_<timestamp>.txt".
 *   JSON export base filename: "mission_<slug>_<id>_<timestamp>.json".
 *
 *   ExportUtils.downloadBlob inserts its own local-time timestamp
 *   before the extension, so a second export of the same mission
 *   in the same session never collides with the first.
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
    if (!MissionQueries ||
        typeof MissionQueries.getTeamIdsForMission !== 'function') {
        _missing.push('MissionQueries.getTeamIdsForMission');
    }
    if (!MissionQueries ||
        typeof MissionQueries.getParticipantsForMission !== 'function') {
        _missing.push('MissionQueries.getParticipantsForMission');
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
        if (typeof MissionConstants.getParticipantSourceLabel !==
            'function') {
            _missing.push('MissionConstants.getParticipantSourceLabel');
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

    function resolveCharacterDeceased(charId) {
        if (!isNonEmptyString(charId)) { return false; }
        var c = null;
        try {
            c = CharacterQueries.getCharacterById(charId);
        } catch (e) { c = null; }
        if (!c) { return false; }
        return c.deceased === true;
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
    // SECTION BUILDERS (text)
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

        // ---- Teams ----
        //
        // One line per assigned team. When no teams are assigned,
        // a single "Team:  Unassigned" line. The label is padded so
        // the first line reads cleanly; subsequent lines align
        // under the first team name.
        var teamIds = MissionQueries.getTeamIdsForMission(mission);

        if (teamIds.length === 0) {
            lines.push(labelled('Team', 'Unassigned'));
        } else if (teamIds.length === 1) {
            lines.push(labelled('Team', resolveTeamName(teamIds[0])));
        } else {
            var firstLine = labelled(
                'Team',
                resolveTeamName(teamIds[0])
            );
            lines.push(firstLine);

            var indent = '';
            while (indent.length < LABEL_WIDTH + 1) {
                indent += ' ';
            }
            for (var i = 1; i < teamIds.length; i++) {
                lines.push(indent + resolveTeamName(teamIds[i]));
            }
        }

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

    // ============================================================
    // PARTICIPANTS (this revision)
    // ============================================================
    //
    // The section groups team participants by team, then prints
    // rookies in their own block. Team blocks are sorted by team
    // name; within each block participants are sorted by
    // character name. The rookie block is sorted by character
    // name.
    //
    // The mission's participant list is read via
    // MissionQueries.getParticipantsForMission, which normalises
    // each record and drops malformed ones.

    function pushParticipants(lines, mission) {
        var heading = 'PARTICIPANTS';
        lines.push(heading);
        lines.push(lineDash(heading));
        lines.push('');

        var participants =
            MissionQueries.getParticipantsForMission(mission);

        if (participants.length === 0) {
            lines.push('  (none recorded)');
            lines.push('');
            return;
        }

        // Partition into team participants and rookies.
        var byTeam = Object.create(null);
        var teamOrder = [];
        var rookies = [];

        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            if (p.source === 'rookie' || p.teamId === null) {
                rookies.push(p);
                continue;
            }

            var teamId = p.teamId;
            if (!byTeam[teamId]) {
                byTeam[teamId] = [];
                teamOrder.push(teamId);
            }
            byTeam[teamId].push(p);
        }

        // Sort team blocks by resolved team name.
        teamOrder.sort(function(a, b) {
            var na = resolveTeamName(a);
            var nb = resolveTeamName(b);
            return na.localeCompare(nb);
        });

        // ---- Team blocks ----
        for (var t = 0; t < teamOrder.length; t++) {
            var tid = teamOrder[t];
            var teamName = resolveTeamName(tid);
            var members = byTeam[tid];

            members.sort(function(a, b) {
                return resolveCharacterName(a.characterId)
                    .localeCompare(
                        resolveCharacterName(b.characterId)
                    );
            });

            lines.push('  ' + teamName + ':');

            for (var m = 0; m < members.length; m++) {
                lines.push(
                    '    - ' + formatParticipantLine(
                        members[m].characterId
                    )
                );
            }
            lines.push('');
        }

        // ---- Rookies ----
        if (rookies.length > 0) {
            rookies.sort(function(a, b) {
                return resolveCharacterName(a.characterId)
                    .localeCompare(
                        resolveCharacterName(b.characterId)
                    );
            });

            lines.push('  Rookies:');

            for (var r = 0; r < rookies.length; r++) {
                lines.push(
                    '    - ' + formatParticipantLine(
                        rookies[r].characterId
                    )
                );
            }
            lines.push('');
        }
    }

    /**
     * Format a single participant line. The name is resolved
     * against the character store; a deceased character gets a
     * dagger suffix matching the UI convention. A character who
     * does not resolve in the store prints as "(missing
     * character)" from resolveCharacterName.
     */
    function formatParticipantLine(charId) {
        var name = resolveCharacterName(charId);
        if (resolveCharacterDeceased(charId)) {
            name += ' \u2020';
        }
        return name;
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

            lines.push('  ' + authorName + ' \u2014 ' + created + edited);
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
    // TEXT REPORT BUILDER
    // ============================================================

    function buildTextReport(missionId) {
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
        pushParticipants(lines, mission);
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
            text: lines.join('\n'),
            mission: mission
        };
    }

    function buildTextFilename(mission) {
        var slug = slugify(mission.title);
        var idPart = isNonEmptyString(mission.id)
            ? String(mission.id)
            : 'unknown';
        return 'mission_' + slug + '_' + idPart +
            '_' + timestampSlug() + '.txt';
    }

    function buildJsonFilename(mission) {
        var slug = slugify(mission.title);
        var idPart = isNonEmptyString(mission.id)
            ? String(mission.id)
            : 'unknown';
        return 'mission_' + slug + '_' + idPart +
            '_' + timestampSlug() + '.json';
    }

    // ============================================================
    // JSON REPORT BUILDER
    // ============================================================
    //
    // The JSON export is the mission record verbatim. No envelope,
    // no projection, no stripping. Every field the store carries is
    // present, including the participants array.
    //
    // The record is deep-cloned before it is handed back. This is
    // the same discipline the read layer follows: an export is a
    // snapshot, not a live reference. A caller that mutates the
    // returned object must not mutate the store.

    function buildJsonPayload(missionId) {
        var mission = null;
        try {
            mission = MissionQueries.getMission(missionId);
        } catch (e) {
            mission = null;
        }

        if (!mission) {
            return { error: 'Mission not found.' };
        }

        var snapshot;
        try {
            snapshot = JSON.parse(JSON.stringify(mission));
        } catch (e) {
            return {
                error: 'Failed to serialise mission: ' + e.message
            };
        }

        return { data: snapshot, mission: mission };
    }

    // ============================================================
    // DOWNLOAD
    // ============================================================

    function downloadText(baseFilename, text) {
        var blob;
        try {
            blob = new Blob([text], {
                type: 'text/plain;charset=utf-8'
            });
        } catch (e) {
            return { error: 'Failed to build file blob: ' + e.message };
        }

        try {
            ExportUtils.downloadBlob(blob, baseFilename);
        } catch (e) {
            return { error: 'Download failed: ' + e.message };
        }

        return { error: null };
    }

    function downloadJson(baseFilename, data) {
        var jsonText;
        try {
            jsonText = JSON.stringify(data, null, 2);
        } catch (e) {
            return {
                error: 'Failed to serialise JSON: ' + e.message
            };
        }

        var blob;
        try {
            blob = new Blob([jsonText], {
                type: 'application/json;charset=utf-8'
            });
        } catch (e) {
            return { error: 'Failed to build file blob: ' + e.message };
        }

        try {
            ExportUtils.downloadBlob(blob, baseFilename);
        } catch (e) {
            return { error: 'Download failed: ' + e.message };
        }

        return { error: null };
    }

    // ============================================================
    // PUBLIC API - TEXT
    // ============================================================

    /**
     * Export a single mission as a plain-text report.
     *
     * @param {string} missionId
     * @returns {object}
     *   { exported: true, filename, count, format: 'text' }
     *   on success.
     *   { error: string } on failure.
     */
    function exportMissionText(missionId) {
        if (!isNonEmptyString(missionId)) {
            return { error: 'Mission ID is required.' };
        }

        var built;
        try {
            built = buildTextReport(String(missionId));
        } catch (e) {
            console.warn(
                '[MissionExport] buildTextReport threw:', e
            );
            return { error: 'Failed to build report: ' + e.message };
        }

        if (built.error) { return built; }

        var baseFilename = buildTextFilename(built.mission);

        var dl = downloadText(baseFilename, built.text);
        if (dl.error) { return dl; }

        return {
            exported: true,
            filename: baseFilename,
            count: 1,
            format: 'text'
        };
    }

    /**
     * Build the text report without downloading. For tests and
     * preview.
     */
    function buildMissionTextReport(missionId) {
        if (!isNonEmptyString(missionId)) {
            return { error: 'Mission ID is required.' };
        }

        var built;
        try {
            built = buildTextReport(String(missionId));
        } catch (e) {
            return { error: 'Failed to build report: ' + e.message };
        }

        if (built.error) { return built; }

        return {
            text: built.text,
            filename: buildTextFilename(built.mission)
        };
    }

    // ============================================================
    // PUBLIC API - JSON
    // ============================================================

    /**
     * Export a single mission as a JSON file.
     *
     * The file contains the mission record verbatim. No envelope,
     * no projection. This is the payload the import path expects
     * back, and it round-trips cleanly through MissionSchema.
     *
     * @param {string} missionId
     * @returns {object}
     *   { exported: true, filename, count, format: 'json' }
     *   on success.
     *   { error: string } on failure.
     */
    function exportMissionJson(missionId) {
        if (!isNonEmptyString(missionId)) {
            return { error: 'Mission ID is required.' };
        }

        var built;
        try {
            built = buildJsonPayload(String(missionId));
        } catch (e) {
            console.warn(
                '[MissionExport] buildJsonPayload threw:', e
            );
            return { error: 'Failed to build JSON: ' + e.message };
        }

        if (built.error) { return built; }

        var baseFilename = buildJsonFilename(built.mission);

        var dl = downloadJson(baseFilename, built.data);
        if (dl.error) { return dl; }

        return {
            exported: true,
            filename: baseFilename,
            count: 1,
            format: 'json'
        };
    }

    /**
     * Build the JSON payload without downloading. For tests and
     * preview.
     */
    function buildMissionJsonReport(missionId) {
        if (!isNonEmptyString(missionId)) {
            return { error: 'Mission ID is required.' };
        }

        var built;
        try {
            built = buildJsonPayload(String(missionId));
        } catch (e) {
            return { error: 'Failed to build JSON: ' + e.message };
        }

        if (built.error) { return built; }

        return {
            data: built.data,
            filename: buildJsonFilename(built.mission)
        };
    }

    // ============================================================
    // LEGACY ALIAS
    // ============================================================
    //
    // `exportMission` was the only export entry point before the
    // format split. Callers that still invoke it get the text
    // format, which is the default and the historical behaviour.

    function exportMission(missionId) {
        return exportMissionText(missionId);
    }

    function buildMissionReport(missionId) {
        return buildMissionTextReport(missionId);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionExport = Object.freeze({
        // Text format
        exportMissionText: exportMissionText,
        buildMissionTextReport: buildMissionTextReport,

        // JSON format
        exportMissionJson: exportMissionJson,
        buildMissionJsonReport: buildMissionJsonReport,

        // Legacy aliases. Text is the default.
        exportMission: exportMission,
        buildMissionReport: buildMissionReport
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionExport;
        var missing = [];

        var required = [
            'exportMissionText',
            'buildMissionTextReport',
            'exportMissionJson',
            'buildMissionJsonReport',
            'exportMission',
            'buildMissionReport'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionExport] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();