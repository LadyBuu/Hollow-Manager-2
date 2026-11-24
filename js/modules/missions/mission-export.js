/**
js/modules/missions/mission-export.js - Mission Export
Path: js/modules/missions/mission-export.js
Full textual dump of a single mission, plus a JSON dump of the
same mission, plus a bulk export of many missions.
WHAT THIS OWNS:
Building a plain-text report for one mission.
Building a JSON blob for one mission.
Building a plain-text report for many missions (bulk).
Building a JSON array of full records for many missions
(bulk, round-trips through MissionImport.importFromJson).
Handing either payload to ExportUtils.downloadBlob.
WHAT THIS DOES NOT OWN:
Reads. MissionQueries, CharacterQueries, and TeamQueries
supply the raw data. This module composes them.
Projection. The report walks the mission record directly and
resolves cross-domain names as it goes. It does not go through
MissionAggregator; the VM is shaped for the UI, not for a text
dump.
UI. MissionUI triggers the export; this module returns a
result object.
Format selection. Two formats per mission (text, JSON), and
the same two per bulk set. The caller picks one by calling
the appropriate function. This module does not decide.
Download mechanics. ExportUtils.downloadBlob owns the anchor,
the blob URL, and the filename uniquification. This module
supplies a base filename and hands over the payload.
FORMATS:
Single mission:
Text   - human-readable, plain text. Built by
         exportMissionText. Full report with sections:
         header, classification, timing, assignment,
         description, objectives, participants, support
         personnel, reports, notes and tags.
JSON   - the full mission record, verbatim. Built by
         exportMissionJson. Not wrapped in an envelope, not
         projected, not stripped. Every field the store
         carries is present.
Bulk (this revision):
Text   - one file, one full report per selected mission,
         separated by a bulk banner + double newlines.
         Built by exportMissionsText. Matches the shape of
         TeamExport.exportTeamsText: a bulk banner, then
         each unit's full report, joined by '\n\n'.
JSON   - one file, a JSON ARRAY of full mission records
         (deep-cloned, verbatim). Built by
         exportMissionsJson. The array shape is exactly what
         MissionImport.importFromJson accepts, so a bulk
         JSON export round-trips through the import path
         without further transformation.
MULTIPLE TEAMS:
The mission's assigned teams are read via
MissionQueries.getTeamIdsForMission, which handles the legacy
singular assignedTeamId transparently. The text report prints
one line per team. The JSON exports are verbatim, so whatever
the record carries is what gets written.
PARTICIPANTS:
The text report prints a PARTICIPANTS section. Participants
are grouped by source:
Team participants   listed under the team they belong to,
                    one block per team. The block header is
                    the team name.
Rookie participants listed under a "Rookies" header, one
                    line per rookie.
When no participants are recorded, the section prints
"(none recorded)".
Participant names are resolved via CharacterQueries; a
deceased character is annotated with a dagger marker, matching
the UI convention. The JSON exports carry the participants
array verbatim — no resolution, no filtering.
The section is ordered to match the UI: team blocks first
(sorted by team name), then the rookie block (sorted by
character name within it).
DATE DISPLAY:
The text report's timing section prints the mission's date in
the same shape the detail panel uses: "<Month Name> <day>,
<year>". The month name comes from
CalendarConfig.getMonthName(year, month).
SECTIONS COLLAPSE when empty. A mission with no reports shows
"(none)" under REPORTS rather than an empty section.
LABEL:
The mission label (YEAR-SEQ-DIFFICULTY) is a derived value.
This module calls MissionId.derive() and never stores or
caches the result. An invalid mission (missing year, sequence,
or difficulty) prints "(unavailable)" for the label and
continues.
FAIL-CLOSED:
A malformed nested record (objective, report, participant)
is skipped with a visible marker. The report never fabricates
content. If the mission itself does not resolve, the export
returns { error } rather than an empty file. In the bulk path,
a mission that fails to build is SKIPPED and counted in
`skipped`; it does not abort the export.
DOWNLOAD FILENAMES:
Single text  : "mission_<slug><id><timestamp>.txt"
Single JSON  : "mission_<slug><id><timestamp>.json"
Bulk text    : "missions-export-<count>.txt"
Bulk JSON    : "missions-export-<count>.json"
ExportUtils.downloadBlob inserts its own local-time timestamp
before the extension, so a second export of the same mission
in the same session never collides with the first.
DEPENDENCIES (MANDATORY):
window.MissionQueries
window.MissionId
window.MissionConstants
window.MissionRules
window.MissionViews
window.CharacterQueries
window.TeamQueries
window.ExportUtils
DEPENDENCIES (LAZY, at call time):
window.CalendarConfig       (month names for buildDateDisplay)
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
 // LAZY DEPENDENCIES
 // ============================================================
 function getCalendarConfig() {
     return window.CalendarConfig || null;
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
 function lineUnder() { return ''; }
 function lineDash() { return ''; }
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
 /**
  * Resolve a team's display name.
  *
  * When `year` is provided, looks up the team's period at that
  * year via TeamQueries.getPeriodForYear and uses the period's
  * name. This is what makes the export reflect the name the
  * team held *during the mission*, rather than its current name
  * or a raw UUID.
  *
  * Falls back through:
  *   1. period.name at the mission's year (via getPeriodForYear)
  *   2. getCurrentTeamName (the current period's name)
  *   3. team.name (raw stored name)
  *   4. '(unnamed team)'
  *
  * Returns '' for missing/invalid teamId, '(missing team)' when
  * the team cannot be resolved, so the report stays legible.
  */
 function resolveTeamName(teamId, year) {
     if (!isNonEmptyString(teamId)) { return ''; }
     var t = null;
     try {
         t = TeamQueries.getTeamById(teamId);
     } catch (e) { t = null; }
     if (!t) { return '(missing team)'; }

     // Period-aware resolution: use the name the team had at
     // the mission's year, when we have one.
     if (year !== undefined && year !== null &&
         typeof TeamQueries.getPeriodForYear === 'function') {
         try {
             var period = TeamQueries.getPeriodForYear(t, year);
             if (period && isNonEmptyString(period.name)) {
                 return String(period.name);
             }
         } catch (e) {
             // Fall through to current-name resolution.
         }
     }

     if (typeof TeamQueries.getCurrentTeamName === 'function') {
         try {
             var currentName = TeamQueries.getCurrentTeamName(t);
             if (isNonEmptyString(currentName)) {
                 return String(currentName);
             }
         } catch (e) {
             // Fall through.
         }
     }

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
         'Completed',
         MissionViews.formatTimestamp(mission.completedAt)
     ));
     lines.push('');
 }
 // ============================================================
 // DATE DISPLAY
 // ============================================================
 function buildDateDisplay(mission) {
     var hasYear = mission.year !== undefined && mission.year !== null;
     var hasMonth = mission.month !== undefined && mission.month !== null;
     var hasDay = mission.day !== undefined && mission.day !== null;
     if (hasYear && hasMonth && hasDay) {
         var monthName = resolveMonthName(mission.year, mission.month);
         if (monthName === '') {
             return String(mission.day) + '/' +
                    String(mission.month) + '/' +
                    String(mission.year);
         }
         return monthName + ' ' + mission.day + ', ' + mission.year;
     }
     if (hasYear && hasMonth) {
         var monthNameOnly = resolveMonthName(
             mission.year, mission.month
         );
         if (monthNameOnly === '') {
             return String(mission.month) + '/' +
                    String(mission.year);
         }
         return monthNameOnly + ' ' + mission.year;
     }
     if (hasYear) {
         return String(mission.year);
     }
     return '';
 }
 function resolveMonthName(year, monthId) {
     var cfg = getCalendarConfig();
     if (cfg && typeof cfg.getMonthName === 'function') {
         var name = cfg.getMonthName(year, monthId);
         if (typeof name === 'string' && name !== '') {
             return name;
         }
         return '';
     }
     var y = parseInt(year, 10);
     var m = parseInt(monthId, 10);
     if (isNaN(y) || y < 1 || isNaN(m) || m < 1 || m > 12) {
         return '';
     }
     return [
         'January', 'February', 'March', 'April', 'May', 'June',
         'July', 'August', 'September', 'October', 'November',
         'December'
     ][m - 1];
 }
 function pushAssignment(lines, mission) {
     var heading = 'ASSIGNMENT';
     lines.push(heading);
     lines.push(lineDash(heading));
     lines.push('');
     var teamIds = MissionQueries.getTeamIdsForMission(mission);
     if (teamIds.length === 0) {
         lines.push(labelled('Team', 'Unassigned'));
     } else if (teamIds.length === 1) {
         lines.push(labelled('Team', resolveTeamName(teamIds[0], mission.year)));
     } else {
         var firstLine = labelled(
             'Team',
             resolveTeamName(teamIds[0], mission.year)
         );
         lines.push(firstLine);
         var indent = '';
         while (indent.length < LABEL_WIDTH + 1) {
             indent += ' ';
         }
         for (var i = 1; i < teamIds.length; i++) {
             lines.push(indent + resolveTeamName(teamIds[i], mission.year));
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
     teamOrder.sort(function(a, b) {
         var na = resolveTeamName(a, mission.year);
         var nb = resolveTeamName(b, mission.year);
         return na.localeCompare(nb);
     });
     for (var t = 0; t < teamOrder.length; t++) {
         var tid = teamOrder[t];
         var teamName = resolveTeamName(tid, mission.year);
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
     pushNotes(lines, mission);
     var footer = 'END OF REPORT';
     lines.push(lineUnder(footer));
     lines.push(footer);
     lines.push(labelled('Record ID', mission.id));
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
 // PUBLIC API - SINGLE MISSION, TEXT
 // ============================================================
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
 // PUBLIC API - SINGLE MISSION, JSON
 // ============================================================
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
 // PUBLIC API - BULK, TEXT (this revision)
 // ============================================================
 function buildBulkTextBanner(count) {
     return 'MISSION EXPORT \u2014 ' + count + ' mission' +
         (count === 1 ? '' : 's');
 }
 function buildBulkTextFilename(count) {
     return 'missions-export-' + count + '.txt';
 }
 function buildMissionsTextReport(missionIds) {
     if (!Array.isArray(missionIds)) {
         return { error: 'missionIds must be an array.' };
     }
     if (missionIds.length === 0) {
         return { error: 'No missions selected.' };
     }
     var parts = [];
     var skipped = 0;
     for (var i = 0; i < missionIds.length; i++) {
         var id = missionIds[i];
         if (!isNonEmptyString(id)) {
             skipped++;
             continue;
         }
         var built;
         try {
             built = buildTextReport(String(id));
         } catch (e) {
             console.warn(
                 '[MissionExport] buildTextReport threw for ' +
                 'mission ' + id + ':', e
             );
             skipped++;
             continue;
         }
         if (!built || built.error) {
             skipped++;
             continue;
         }
         parts.push(built.text);
     }
     if (parts.length === 0) {
         return { error: 'No missions could be built.' };
     }
     var count = parts.length;
     var banner = buildBulkTextBanner(count);
     var content = banner + '\n\n' + parts.join('\n\n');
     return {
         text: content,
         filename: buildBulkTextFilename(count),
         count: count,
         skipped: skipped
     };
 }
 function exportMissionsText(missionIds) {
     var built = buildMissionsTextReport(missionIds);
     if (built.error) {
         return { exported: false, error: built.error };
     }
     var dl = downloadText(built.filename, built.text);
     if (dl.error) {
         return { exported: false, error: dl.error };
     }
     return {
         exported: true,
         filename: built.filename,
         count: built.count,
         skipped: built.skipped,
         format: 'text'
     };
 }
 // ============================================================
 // PUBLIC API - BULK, JSON (this revision)
 // ============================================================
 function buildBulkJsonFilename(count) {
     return 'missions-export-' + count + '.json';
 }
 function buildMissionsJsonReport(missionIds) {
     if (!Array.isArray(missionIds)) {
         return { error: 'missionIds must be an array.' };
     }
     if (missionIds.length === 0) {
         return { error: 'No missions selected.' };
     }
     var records = [];
     var skipped = 0;
     for (var i = 0; i < missionIds.length; i++) {
         var id = missionIds[i];
         if (!isNonEmptyString(id)) {
             skipped++;
             continue;
         }
         var built;
         try {
             built = buildJsonPayload(String(id));
         } catch (e) {
             console.warn(
                 '[MissionExport] buildJsonPayload threw for ' +
                 'mission ' + id + ':', e
             );
             skipped++;
             continue;
         }
         if (!built || built.error) {
             skipped++;
             continue;
         }
         records.push(built.data);
     }
     if (records.length === 0) {
         return { error: 'No missions could be built.' };
     }
     return {
         data: records,
         filename: buildBulkJsonFilename(records.length),
         count: records.length,
         skipped: skipped
     };
 }
 function exportMissionsJson(missionIds) {
     var built = buildMissionsJsonReport(missionIds);
     if (built.error) {
         return { exported: false, error: built.error };
     }
     var dl = downloadJson(built.filename, built.data);
     if (dl.error) {
         return { exported: false, error: dl.error };
     }
     return {
         exported: true,
         filename: built.filename,
         count: built.count,
         skipped: built.skipped,
         format: 'json'
     };
 }
 // ============================================================
 // LEGACY ALIAS
 // ============================================================
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
     // Text format — single
     exportMissionText: exportMissionText,
     buildMissionTextReport: buildMissionTextReport,
     // JSON format — single
     exportMissionJson: exportMissionJson,
     buildMissionJsonReport: buildMissionJsonReport,
     // Text format — bulk
     exportMissionsText: exportMissionsText,
     buildMissionsTextReport: buildMissionsTextReport,
     // JSON format — bulk
     exportMissionsJson: exportMissionsJson,
     buildMissionsJsonReport: buildMissionsJsonReport,
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
         'exportMissionsText',
         'buildMissionsTextReport',
         'exportMissionsJson',
         'buildMissionsJsonReport',
         'exportMission',
         'buildMissionReport'
     ];
     for (var i = 0; i < required.length; i++) {
         if (typeof exports[required[i]] !== 'function') {
             missing.push(required[i]);
         }
     }
     try {
         var decDisplay = buildDateDisplay({
             year: 1920,
             month: 12,
             day: 8
         });
         if (decDisplay.indexOf('1920') === -1) {
             missing.push(
                 'buildDateDisplay: 1920-12-08 lost the year'
             );
         }
         if (decDisplay.indexOf('December') === -1 &&
             decDisplay.indexOf('Twelfth Moon') === -1 &&
             decDisplay.indexOf('12/') === -1) {
             missing.push(
                 'buildDateDisplay: 1920-12-08 rendered as "' +
                 decDisplay + '", no recognisable month'
             );
         }
         var yearOnly = buildDateDisplay({ year: 1920 });
         if (yearOnly !== '1920') {
             missing.push(
                 'buildDateDisplay: year-only rendered as "' +
                 yearOnly + '"'
             );
         }
         var nothing = buildDateDisplay({});
         if (nothing !== '') {
             missing.push(
                 'buildDateDisplay: empty mission should be ""'
             );
         }
         var bad = buildDateDisplay({
             year: 1920,
             month: 13,
             day: 8
         });
         if (bad.indexOf('13') === -1) {
             missing.push(
                 'buildDateDisplay: out-of-range month did not ' +
                 'fall back to numeric, got "' + bad + '"'
             );
         }
         if (bad.indexOf(',') !== -1) {
             missing.push(
                 'buildDateDisplay: out-of-range month still ' +
                 'printed a comma, got "' + bad + '"'
             );
         }
         // ---- Bulk API shape smoke tests ----
         var emptyText = buildMissionsTextReport([]);
         if (!emptyText || emptyText.error !== 'No missions selected.') {
             missing.push(
                 'buildMissionsTextReport([]) did not return ' +
                 'the expected empty error'
             );
         }
         var emptyJson = buildMissionsJsonReport([]);
         if (!emptyJson || emptyJson.error !== 'No missions selected.') {
             missing.push(
                 'buildMissionsJsonReport([]) did not return ' +
                 'the expected empty error'
             );
         }
         var emptyTextExport = exportMissionsText([]);
         if (!emptyTextExport ||
             emptyTextExport.exported !== false) {
             missing.push(
                 'exportMissionsText([]) did not return ' +
                 '{ exported: false }'
             );
         }
         var emptyJsonExport = exportMissionsJson([]);
         if (!emptyJsonExport ||
             emptyJsonExport.exported !== false) {
             missing.push(
                 'exportMissionsJson([]) did not return ' +
                 '{ exported: false }'
             );
         }
         // ---- Period-aware team name resolution ----
         //
         // Without TeamQueries loaded, resolveTeamName should
         // still fall back gracefully (return '(missing team)'
         // or the raw team name). With TeamQueries loaded and
         // a team carrying periods, it should return the name
         // from the period that covers the mission's year.
         //
         // We cannot inject a fake TeamQueries here without
         // polluting the global scope, so the smoke test only
         // asserts the function's signature accepts the year
         // argument and does not throw.
         try {
             var resolved = resolveTeamName('nonexistent_team_id', 1920);
             if (resolved !== '(missing team)') {
                 missing.push(
                     'resolveTeamName: unknown id should yield ' +
                     '"(missing team)", got "' + resolved + '"'
                 );
             }
         } catch (e) {
             missing.push(
                 'resolveTeamName threw on unknown id: ' + e.message
             );
         }
     } catch (e) {
         missing.push(
             'date-display / bulk smoke test threw: ' + e.message
         );
     }
     if (missing.length > 0) {
         console.warn(
             '[MissionExport] Verification failed:',
             missing.join(', ')
         );
     }
 })();
})();
