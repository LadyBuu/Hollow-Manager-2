/**
 * modules/teams/team-export.js - Team Export
 * Full textual dump of one or more teams, optionally scoped to
 * a single period.
 *
 * Path: js/modules/teams/team-export.js
 *
 * WHAT THIS OWNS:
 *   - Building a plain-text report for one team.
 *   - Building a plain-text report for many teams.
 *   - Scoping the single-team report to a specific period.
 *   - Handing the payload to ExportUtils.downloadBlob.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. TeamQueries, CharacterQueries, and the other
 *     cross-domain readers supply the raw data. This module
 *     composes them.
 *   - UI. TeamEvents / TeamExportPicker trigger the export; this
 *     module returns a result object.
 *   - Format selection. One format: plain text.
 *   - Download mechanics. ExportUtils.downloadBlob owns the
 *     anchor, the blob URL, and the filename uniquification.
 *   - The periods shape. TeamCore owns the schema. This module
 *     reads the periods via TeamQueries.
 *   - The specialisation vocabulary. MissionConstants owns the
 *     mission type taxonomy.
 *
 * TWO ENTRY POINTS:
 *
 *   exportTeam(teamId, options)
 *     One team. When `options.period` is a period entry (or a
 *     start year + end year pair), the report is scoped to that
 *     period:
 *       - the header shows the period's name, tactical style,
 *         specialisations, start, end
 *       - the member list includes only members whose stints
 *         overlap the period, per the half-open predicate in
 *         TeamQueries
 *       - the ranking history includes only rankings within the
 *         period
 *       - the periods list is omitted (a slice export is not a
 *         history export)
 *     When `options.period` is absent, the report uses the
 *     current (last) period with no member or ranking filtering.
 *
 *   exportTeamsText(teamIds)
 *     Many teams in one file. Each team's report is built with
 *     its CURRENT period (the last one), with no filtering. The
 *     bulk export does not offer a period selector; a user who
 *     wants a period-specific file exports that team
 *     individually.
 *
 * PERIOD OPTION SHAPE:
 *   The `options.period` argument is a plain object:
 *
 *     {
 *       startPeriod: '1900',
 *       endPeriod: '1905',       // '' means open-ended
 *       name: 'Rapid',
 *       tacticalStyle: '',
 *       specialisations: []
 *     }
 *
 *   The caller is expected to pass an entry from the team's
 *   periods array, or a display-shaped equivalent. Both the
 *   storage shape and the resolved display shape are accepted:
 *   `specialisations` may be an array of ids or an array of
 *   { id, label } refs.
 *
 *   When the option is omitted, the export runs without period
 *   scoping and uses the current period's values for the header.
 *
 * REPORT CONTENTS (per team):
 *   - Team header: name, type, status, period, class, team number,
 *     associated mission, tactical style, specialisations,
 *     created-at.
 *   - Periods section: every period when the export is not
 *     scoped to one. Omitted when a specific period is being
 *     exported.
 *   - Ranking history: filtered to the period when scoped.
 *   - Members section: every member whose stints overlap the
 *     period when scoped; every member otherwise.
 *   - Character snapshot: name, status, age, physical stats,
 *     magic proficiencies, HP / MP, weapons, special moves,
 *     career status history, department memberships, and other
 *     professional team memberships.
 *
 * MEMBERSHIP FILTER:
 *   When scoped to a period P, a member is included iff any of
 *   their stints overlaps P, where "overlaps" is the half-open
 *   predicate owned by TeamQueries.intervalOverlapsPeriod:
 *
 *     stint.join  <  period.end    (strict)
 *     stint.leave >= period.start  (inclusive)
 *
 *   The 1905-joiner does not appear in a period ending in 1905;
 *   they appear in the next period. A member who joined before
 *   the period and stayed into it does appear.
 *
 * DOWNLOAD FILENAMES:
 *   Single team:  "team_<slug>_<timestamp>.txt"
 *   Scoped:       "team_<slug>_<periodslug>_<timestamp>.txt"
 *   Bulk:         "teams-export-<count>.txt"
 *
 *   ExportUtils.downloadBlob inserts its own local-time timestamp
 *   before the extension.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.CharacterQueries
 *   - window.ExportUtils
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.MissionConstants    (specialisation labels)
 *   - window.CharacterStats      (stats and magic)
 *   - window.MagicConstants      (magic type labels)
 *   - window.MissionQueries      (mission title resolution)
 *   - window.DepartmentQueries   (department memberships)
 *   - window.AcademyClasses      (class name resolution)
 */

(function() {
    'use strict';

    if (window.__teamExportLoaded) {
        return;
    }
    window.__teamExportLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CharacterQueries = window.CharacterQueries;
    var ExportUtils = window.ExportUtils;

    var _missing = [];

    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getAllTeamMemberRecords !== 'function') {
        _missing.push('TeamQueries.getAllTeamMemberRecords');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getRankingSummary !== 'function') {
        _missing.push('TeamQueries.getRankingSummary');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getPeriods !== 'function') {
        _missing.push('TeamQueries.getPeriods');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getCurrentPeriod !== 'function') {
        _missing.push('TeamQueries.getCurrentPeriod');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getCurrentTeamName !== 'function') {
        _missing.push('TeamQueries.getCurrentTeamName');
    }
    if (!TeamQueries ||
        typeof TeamQueries.intervalOverlapsPeriod !== 'function') {
        _missing.push('TeamQueries.intervalOverlapsPeriod');
    }
    if (!TeamQueries ||
        typeof TeamQueries.rankingInPeriod !== 'function') {
        _missing.push('TeamQueries.rankingInPeriod');
    }

    if (!TeamConstants ||
        typeof TeamConstants.getTypeLabel !== 'function') {
        _missing.push('TeamConstants.getTypeLabel');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!ExportUtils ||
        typeof ExportUtils.downloadBlob !== 'function') {
        _missing.push('ExportUtils.downloadBlob');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamExport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getMissionConstants() {
        return window.MissionConstants || null;
    }

    function getCharacterStats() {
        return window.CharacterStats || null;
    }

    function getMagicConstants() {
        return window.MagicConstants || null;
    }

    function getMissionQueries() {
        return window.MissionQueries || null;
    }

    function getDepartmentQueries() {
        return window.DepartmentQueries || null;
    }

    function getAcademyClasses() {
        return window.AcademyClasses || null;
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
        if (!text || typeof text !== 'string') { return 'team'; }
        return text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'team';
    }

    function formatPeriod(start, end) {
        var hasStart = start !== undefined && start !== null &&
                       String(start).trim() !== '';
        var hasEnd = end !== undefined && end !== null &&
                     String(end).trim() !== '';
        if (hasStart && hasEnd) {
            return String(start) + '\u2013' + String(end);
        }
        if (hasStart) { return String(start) + '\u2013present'; }
        if (hasEnd) { return '\u2013' + String(end); }
        return 'unbounded';
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function isObject(value) {
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
    // DESCRIPTIVE FIELDS
    // ============================================================
    //
    // Specialisations in a period entry may be an array of ids or
    // an array of { id, label } refs. Both are accepted.

    function resolveSpecialisationLabels(raw) {
        if (!Array.isArray(raw) || raw.length === 0) { return []; }

        var MC = getMissionConstants();
        var canLabel = MC &&
            typeof MC.getMissionTypeLabel === 'function';
        var canValidate = MC &&
            typeof MC.isValidMissionType === 'function';

        var seen = Object.create(null);
        var labels = [];

        for (var i = 0; i < raw.length; i++) {
            var entry = raw[i];
            if (!entry) { continue; }

            var id = '';
            var providedLabel = '';

            if (typeof entry === 'string') {
                id = entry.trim();
            } else if (isObject(entry)) {
                if (isNonEmptyString(entry.id)) {
                    id = String(entry.id).trim();
                }
                if (isNonEmptyString(entry.label)) {
                    providedLabel = String(entry.label);
                }
            }

            if (id === '') { continue; }
            if (seen[id] === true) { continue; }
            if (canValidate && !MC.isValidMissionType(id)) {
                continue;
            }
            seen[id] = true;

            var label = providedLabel;
            if (label === '' && canLabel) {
                var resolved = MC.getMissionTypeLabel(id);
                if (isNonEmptyString(resolved)) {
                    label = resolved;
                }
            }
            if (label === '') { label = id; }

            labels.push(label);
        }

        return labels;
    }

    // ============================================================
    // PERIOD RESOLUTION
    // ============================================================
    //
    // The `options.period` argument, when present, is a period
    // entry. This module does not check that the entry belongs to
    // the team; the caller is trusted to have selected it from
    // the team's own periods array.

    function resolveEffectivePeriod(team, requestedPeriod) {
        if (requestedPeriod && isObject(requestedPeriod)) {
            return requestedPeriod;
        }
        return TeamQueries.getCurrentPeriod(team);
    }

    function isPeriodScoped(requestedPeriod) {
        return !!(requestedPeriod && isObject(requestedPeriod));
    }

    // ============================================================
    // MEMBER FILTER
    // ============================================================
    //
    // When a period is in scope, a member is included iff any
    // stint overlaps the period, using the half-open predicate
    // owned by TeamQueries.
    //
    // When no period is in scope (a bulk export), every member is
    // included.

    function memberBelongsToPeriod(member, period) {
        if (!member || typeof member !== 'object') { return false; }
        if (!Array.isArray(member.intervals)) { return false; }

        var start = period.startPeriod;
        var end = period.endPeriod;

        for (var i = 0; i < member.intervals.length; i++) {
            var iv = member.intervals[i];
            if (!iv || typeof iv !== 'object') { continue; }

            if (TeamQueries.intervalOverlapsPeriod(
                iv.joinPeriod,
                iv.leavePeriod,
                start,
                end
            )) {
                return true;
            }
        }

        return false;
    }

    function filterMembersForPeriod(members, period) {
        if (!Array.isArray(members)) { return []; }
        if (!period) { return members.slice(); }

        var result = [];
        for (var i = 0; i < members.length; i++) {
            if (memberBelongsToPeriod(members[i], period)) {
                result.push(members[i]);
            }
        }
        return result;
    }

    function filterRankingsForPeriod(rankings, period) {
        if (!Array.isArray(rankings)) { return []; }
        if (!period) { return rankings.slice(); }

        var start = period.startPeriod;
        var end = period.endPeriod;

        var result = [];
        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];
            if (!entry || typeof entry !== 'object') { continue; }
            if (TeamQueries.rankingInPeriod(
                entry.period,
                start,
                end
            )) {
                result.push(entry);
            }
        }
        return result;
    }

    // ============================================================
    // REPORT BUILDER
    // ============================================================

    /**
     * Build a plain-text report for one team.
     *
     * When `options.period` is a period entry, the report is
     * scoped to it. Otherwise the report is unscoped and uses the
     * current period's header values with no member or ranking
     * filtering.
     */
    function buildReport(teamId, options) {
        options = options || {};

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return { error: 'Team not found.' };
        }

        var scoped = isPeriodScoped(options.period);
        var period = resolveEffectivePeriod(team, options.period);

        // Period is required to render a header. A team with no
        // periods array (an unmigrated record) is a hard failure
        // for a scoped export and a soft failure for an unscoped
        // one — the latter falls back to the top-level name.
        if (!period && scoped) {
            return {
                error: 'The requested period was not found on the ' +
                    'team.'
            };
        }

        var lines = [];

        var titleName = period && isNonEmptyString(period.name)
            ? String(period.name)
            : TeamQueries.getCurrentTeamName(team);

        var title = 'TEAM REPORT: ' + titleName;
        if (scoped) {
            title += ' (' + formatPeriod(
                period.startPeriod, period.endPeriod
            ) + ')';
        }
        lines.push(title);
        lines.push(lineUnder(title));
        lines.push('');

        pushTeamHeader(lines, team, period, scoped);
        if (!scoped) {
            pushPeriodsSection(lines, team);
        }
        pushRankingHistory(lines, team, scoped ? period : null);
        pushMembersSection(lines, team, scoped ? period : null);

        return {
            exported: true,
            filename: buildFilename(team, scoped ? period : null),
            text: lines.join('\n')
        };
    }

    function buildFilename(team, period) {
        var currentName = TeamQueries.getCurrentTeamName(team);
        var slug = slugify(currentName);

        if (period && isObject(period)) {
            var start = isNonEmptyString(period.startPeriod)
                ? String(period.startPeriod)
                : '';
            var end = isNonEmptyString(period.endPeriod)
                ? String(period.endPeriod)
                : 'present';
            var periodSlug = start === ''
                ? slugify(end)
                : slugify(start + '-' + end);
            return 'team_' + slug + '_' + periodSlug +
                '_' + timestampSlug() + '.txt';
        }

        return 'team_' + slug + '_' + timestampSlug() + '.txt';
    }

    // ============================================================
    // TEAM HEADER
    // ============================================================

    function pushTeamHeader(lines, team, period, scoped) {
        lines.push('SECTION 1: TEAM');
        lines.push(lineDash('SECTION 1: TEAM'));
        lines.push('');

        var displayName = period && isNonEmptyString(period.name)
            ? String(period.name)
            : TeamQueries.getCurrentTeamName(team);

        lines.push('Name:        ' + displayName);
        lines.push('ID:          ' + safeString(team.id));
        lines.push('Type:        ' +
            (TeamConstants.getTypeLabel(team.type) || team.type || '') +
        '');
        lines.push('Status:      ' + safeString(team.status || 'active'));

        // ---- Period line ----
        //
        // When scoped, the period line is the period's own range.
        // When unscoped, the period line is the team's overall
        // span, derived from periods[0].start and
        // periods[last].end.
        var periodDisplay = '';
        if (scoped && period) {
            periodDisplay = formatPeriod(
                period.startPeriod, period.endPeriod
            );
        } else {
            var periods = TeamQueries.getPeriods(team);
            if (periods.length > 0) {
                var firstStart = periods[0].startPeriod;
                var lastEnd = periods[periods.length - 1].endPeriod;
                periodDisplay = formatPeriod(firstStart, lastEnd);
            } else {
                periodDisplay = formatPeriod(
                    team.startPeriod, team.endPeriod
                );
            }
        }
        lines.push('Period:      ' + periodDisplay);

        lines.push('Team Number: ' +
            (isNonEmptyString(team.teamNumber)
                ? team.teamNumber
                : '\u2014')
        );

        if (isNonEmptyString(team.classId)) {
            var className = resolveClassName(team.classId);
            lines.push('Class:       ' + className);
        } else {
            lines.push('Class:       \u2014');
        }

        var missionLabel = '\u2014';
        if (isNonEmptyString(team.temporaryMission)) {
            var missionName = resolveMissionName(team.temporaryMission);
            missionLabel = missionName || team.temporaryMission;
        }
        lines.push('Mission:     ' + missionLabel);

        // ---- Tactical style and specialisations ----
        //
        // Both come from the effective period when one is
        // available. When no period is available (an unmigrated
        // record), they fall back to the legacy scalars.
        var style = '';
        var specSource = [];

        if (period) {
            if (isNonEmptyString(period.tacticalStyle)) {
                style = String(period.tacticalStyle).trim();
            }
            if (Array.isArray(period.specialisations)) {
                specSource = period.specialisations;
            }
        } else {
            if (isNonEmptyString(team.tacticalStyle)) {
                style = String(team.tacticalStyle).trim();
            } else if (isNonEmptyString(team.style)) {
                style = String(team.style).trim();
            }
            if (Array.isArray(team.specialisations)) {
                specSource = team.specialisations;
            }
        }

        if (style !== '') {
            lines.push('Tactical Style: ' + style);
        }

        var specLabels = resolveSpecialisationLabels(specSource);
        if (specLabels.length > 0) {
            lines.push('Specialisations: ' + specLabels.join(', '));
        }

        if (isNonEmptyString(team.createdAt)) {
            lines.push('Created:     ' + team.createdAt);
        }
        if (isNonEmptyString(team.updatedAt)) {
            lines.push('Updated:     ' + team.updatedAt);
        }

        lines.push('');
    }

    function resolveClassName(classId) {
        var AcademyClasses = getAcademyClasses();
        if (AcademyClasses &&
            typeof AcademyClasses.getDisplayName === 'function') {
            var name = AcademyClasses.getDisplayName(classId);
            if (name && name !== 'Unknown Class') { return name; }
        }
        return classId;
    }

    function resolveMissionName(missionId) {
        var MQ = getMissionQueries();
        if (!MQ || typeof MQ.getMission !== 'function') {
            return null;
        }
        try {
            var mission = MQ.getMission(missionId);
            if (mission && isNonEmptyString(mission.title)) {
                return mission.title;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    // ============================================================
    // PERIODS SECTION
    // ============================================================
    //
    // Every period, in array order. Omitted when the export is
    // scoped to a single period: a slice export is not a history
    // export.

    function pushPeriodsSection(lines, team) {
        lines.push('SECTION 2: PERIODS');
        lines.push(lineDash('SECTION 2: PERIODS'));
        lines.push('');

        var periods = TeamQueries.getPeriods(team);
        if (periods.length === 0) {
            lines.push('  (no periods recorded)');
            lines.push('');
            return;
        }

        for (var i = 0; i < periods.length; i++) {
            var period = periods[i];
            if (!period || typeof period !== 'object') { continue; }

            var name = isNonEmptyString(period.name)
                ? String(period.name)
                : 'Unnamed';
            var range = formatPeriod(
                period.startPeriod, period.endPeriod
            );

            lines.push('  - ' + name + ' (' + range + ')');

            if (isNonEmptyString(period.tacticalStyle)) {
                lines.push('      Tactical Style: ' +
                    String(period.tacticalStyle).trim());
            }

            var specLabels = resolveSpecialisationLabels(
                period.specialisations
            );
            if (specLabels.length > 0) {
                lines.push('      Specialisations: ' +
                    specLabels.join(', '));
            }
        }

        lines.push('');
    }

    // ============================================================
    // RANKING HISTORY
    // ============================================================

    function pushRankingHistory(lines, team, period) {
        lines.push('SECTION 3: RANKING HISTORY');
        lines.push(lineDash('SECTION 3: RANKING HISTORY'));
        lines.push('');

        var summary = TeamQueries.getRankingSummary(team);
        var history = summary && Array.isArray(summary.history)
            ? summary.history
            : [];

        if (period) {
            history = filterRankingsForPeriod(history, period);
        }

        if (history.length === 0) {
            lines.push('  (no ranking history)');
            lines.push('');
            return;
        }

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!entry) { continue; }
            lines.push(
                '  ' + safeString(entry.period) +
                ': #' + safeString(entry.rank)
            );
        }

        lines.push('');
    }

    // ============================================================
    // MEMBERS
    // ============================================================

    function pushMembersSection(lines, team, period) {
        lines.push('SECTION 4: MEMBERS');
        lines.push(lineDash('SECTION 4: MEMBERS'));
        lines.push('');

        var allMembers = TeamQueries.getAllTeamMemberRecords(team);

        // When a period is in scope, restrict to members whose
        // stints overlap the period. When unscoped, every member
        // is included.
        var members = period
            ? filterMembersForPeriod(allMembers, period)
            : allMembers;

        if (!Array.isArray(members) || members.length === 0) {
            lines.push('  (no members' +
                (period ? ' in this period' : '') + ')');
            lines.push('');
            return;
        }

        for (var i = 0; i < members.length; i++) {
            pushMemberRecord(
                lines, members[i], i + 1, members.length, period
            );
        }
    }

    function pushMemberRecord(
        lines, member, index, total, period
    ) {
        if (!member || typeof member !== 'object') { return; }

        var charId = member.characterId;
        var char = charId
            ? CharacterQueries.getCharacterById(charId)
            : null;
        var displayName = char
            ? CharacterQueries.getDisplayName(char)
            : 'Unknown';

        lines.push('');
        lines.push('  MEMBER ' + index + ' of ' + total +
            ': ' + displayName);
        lines.push('  ' + lineDash(
            'MEMBER ' + index + ' of ' + total + ': ' + displayName
        ));

        lines.push('    Character ID: ' + safeString(charId));
        lines.push('    Role:         ' +
            (isNonEmptyString(member.role)
                ? member.role
                : '(none)')
        );

        pushMemberIntervals(lines, member, period);
        pushCharacterSnapshot(lines, char);

        lines.push('');
    }

    /**
     * Print the member's stints.
     *
     * When a period is in scope, only stints overlapping the
     * period are printed; a stint that ends before the period
     * or starts after it is not relevant to the reader. When no
     * period is in scope, every stint is printed.
     */
    function pushMemberIntervals(lines, member, period) {
        var intervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

        if (period) {
            var filtered = [];
            for (var f = 0; f < intervals.length; f++) {
                var ivF = intervals[f];
                if (!ivF || typeof ivF !== 'object') { continue; }
                if (TeamQueries.intervalOverlapsPeriod(
                    ivF.joinPeriod,
                    ivF.leavePeriod,
                    period.startPeriod,
                    period.endPeriod
                )) {
                    filtered.push(ivF);
                }
            }
            intervals = filtered;
        }

        lines.push('    Stints:');

        if (intervals.length === 0) {
            lines.push('      (no stints recorded)');
            return;
        }

        for (var i = 0; i < intervals.length; i++) {
            var iv = intervals[i];
            if (!iv || typeof iv !== 'object') { continue; }
            lines.push('      - ' + formatPeriod(
                iv.joinPeriod, iv.leavePeriod
            ));
        }
    }

    // ============================================================
    // CHARACTER SNAPSHOT
    // ============================================================

    function pushCharacterSnapshot(lines, char) {
        if (!char) {
            lines.push('    Character snapshot: (character not found)');
            return;
        }

        lines.push('');
        lines.push('    Character snapshot:');

        lines.push('      Name:      ' +
            CharacterQueries.getDisplayName(char));
        lines.push('      Status:    ' +
            CharacterQueries.getCurrentStatus(char));
        lines.push('      Age:       ' +
            CharacterQueries.getCharacterAge(char));
        lines.push('      Birth:     ' +
            safeString(char.birthYear || '\u2014'));
        lines.push('      Gender:    ' +
            safeString(char.gender || '\u2014'));

        pushStats(lines, char);
        pushMagic(lines, char);
        pushWeaponsAndMoves(lines, char);
        pushCareerStatus(lines, char);
        pushDepartmentMemberships(lines, char);
        pushOtherTeamMemberships(lines, char);
    }

    function pushStats(lines, char) {
        var CharacterStats = getCharacterStats();
        if (!CharacterStats ||
            typeof CharacterStats.getCharacterStats !== 'function') {
            lines.push('      Stats:     (unavailable)');
            return;
        }

        var stats;
        try {
            stats = CharacterStats.getCharacterStats(char);
        } catch (e) {
            stats = null;
        }

        if (!stats || typeof stats !== 'object') {
            lines.push('      Stats:     (unavailable)');
            return;
        }

        var keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        var parts = [];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = stats[k];
            var display = (typeof v === 'number') ? v : '\u2014';

            if (typeof CharacterStats.getModifierDisplay ===
                'function' && typeof v === 'number') {
                try {
                    display = v + ' (' +
                        CharacterStats.getModifierDisplay(v) + ')';
                } catch (e) {
                    // Fall through.
                }
            }

            parts.push(k.toUpperCase() + ' ' + display);
        }
        lines.push('      Stats:     ' + parts.join(' \u00b7 '));

        var hp = isFiniteNumber(char.hp) ? char.hp : 0;
        var mp = isFiniteNumber(char.mp) ? char.mp : 0;
        lines.push('      HP / MP:   ' + hp + ' / ' + mp);
    }

    function pushMagic(lines, char) {
        var CharacterStats = getCharacterStats();
        var MC = getMagicConstants();

        if (!CharacterStats ||
            typeof CharacterStats.getCharacterMagic !== 'function') {
            return;
        }

        var magic;
        try {
            magic = CharacterStats.getCharacterMagic(char);
        } catch (e) {
            magic = null;
        }

        if (!magic || typeof magic !== 'object') {
            return;
        }

        var keys = [];
        if (MC && typeof MC.getTypeKeys === 'function') {
            keys = MC.getTypeKeys();
        } else {
            keys = Object.keys(magic);
        }

        var parts = [];
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = magic[key];
            if (!isFiniteNumber(value) || value <= 0) {
                continue;
            }

            var label = key;
            if (MC && typeof MC.getTypeLabel === 'function') {
                label = MC.getTypeLabel(key) || key;
            }

            parts.push(label + ' ' + value);
        }

        if (parts.length === 0) {
            return;
        }

        lines.push('      Magic:     ' + parts.join(' \u00b7 '));
    }

    function pushWeaponsAndMoves(lines, char) {
        if (Array.isArray(char.weapons) && char.weapons.length > 0) {
            var weapons = [];
            for (var i = 0; i < char.weapons.length; i++) {
                var w = char.weapons[i];
                if (!isObject(w)) { continue; }
                var name = isNonEmptyString(w.name)
                    ? String(w.name)
                    : '';
                if (name === '') { continue; }
                if (isNonEmptyString(w.type)) {
                    name += ' (' + w.type + ')';
                }
                weapons.push(name);
            }
            if (weapons.length > 0) {
                lines.push('      Weapons:   ' +
                    weapons.join('; '));
            }
        }

        var sm = isObject(char.specialMoves)
            ? char.specialMoves
            : null;

        if (sm) {
            var phys = listMoveNames(sm.physical);
            var mag = listMoveNames(sm.magical);

            if (phys) {
                lines.push('      Moves (P): ' + phys);
            }
            if (mag) {
                lines.push('      Moves (M): ' + mag);
            }
        }

        if (isNonEmptyString(char.combatNotes)) {
            lines.push('      Combat:    ' + char.combatNotes);
        }
    }

    function listMoveNames(list) {
        if (!Array.isArray(list) || list.length === 0) {
            return '';
        }
        var names = [];
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (!isObject(m)) { continue; }
            if (!isNonEmptyString(m.name)) { continue; }
            names.push(String(m.name));
        }
        return names.join(', ');
    }

    function pushCareerStatus(lines, char) {
        var careerStatus = Array.isArray(char.careerStatus)
            ? char.careerStatus
            : [];

        if (careerStatus.length === 0) {
            lines.push('      Career:    (none recorded)');
            return;
        }

        lines.push('      Career:');
        for (var i = 0; i < careerStatus.length; i++) {
            var entry = careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }
            var status = safeString(entry.status || 'unknown');
            var period = formatPeriod(
                entry.startYear, entry.endYear
            );
            var suffix = isNonEmptyString(entry.title)
                ? ' [' + entry.title + ']'
                : '';
            lines.push('        - ' + status +
                ' (' + period + ')' + suffix);
        }
    }

    function pushDepartmentMemberships(lines, char) {
        var DQ = getDepartmentQueries();
        if (!DQ ||
            typeof DQ.getDepartmentsForCharacter !== 'function') {
            return;
        }

        var departments;
        try {
            departments = DQ.getDepartmentsForCharacter(char.id) || [];
        } catch (e) {
            departments = [];
        }

        if (!Array.isArray(departments) || departments.length === 0) {
            return;
        }

        lines.push('      Departments:');
        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (!dept || !dept.name) { continue; }
            lines.push('        - ' + dept.name);
        }
    }

    function pushOtherTeamMemberships(lines, char) {
        if (!TeamQueries ||
            typeof TeamQueries
                .getTeamsForCharacterAllTimeIncludingDeprecated !==
            'function') {
            return;
        }

        var teams;
        try {
            teams = TeamQueries
                .getTeamsForCharacterAllTimeIncludingDeprecated(
                    char.id
                ) || [];
        } catch (e) {
            return;
        }

        if (!Array.isArray(teams) || teams.length === 0) {
            return;
        }

        var professional = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.name) { continue; }
            if (team.type !== 'professional') { continue; }
            professional.push(team);
        }

        if (professional.length === 0) { return; }

        lines.push('      Other teams:');
        for (var j = 0; j < professional.length; j++) {
            var p = professional[j];
            var status = p.status || 'active';
            var statusSuffix = status === 'deprecated'
                ? ' [deprecated]'
                : '';
            lines.push('        - ' +
                TeamQueries.getCurrentTeamName(p) +
                statusSuffix);
        }
    }

    // ============================================================
    // PUBLIC API - SINGLE TEAM
    // ============================================================

    /**
     * Export a single team as a plain-text report.
     *
     * @param {string} teamId
     * @param {object} [options]
     * @param {object} [options.period]  A period entry to scope
     *   the export to. Omit for the current period.
     * @returns {object}
     *   { exported: true, filename, count, period } on success
     *   { error: string } on failure
     */
    function exportTeam(teamId, options) {
        options = options || {};

        if (!isNonEmptyString(teamId)) {
            return { error: 'Team ID is required.' };
        }

        var built;
        try {
            built = buildReport(teamId, options);
        } catch (e) {
            console.warn(
                '[TeamExport] buildReport threw:', e
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

        var team = TeamQueries.getTeamById(teamId);

        // Count only the members included in the export.
        var memberCount = 0;
        if (team) {
            var members = TeamQueries.getAllTeamMemberRecords(team);
            if (isPeriodScoped(options.period)) {
                members = filterMembersForPeriod(
                    members, options.period
                );
            }
            memberCount = members.length;
        }

        return {
            exported: true,
            filename: built.filename,
            count: memberCount,
            period: options.period || null
        };
    }

    /**
     * Build the report for one team without downloading.
     */
    function buildTeamReport(teamId, options) {
        options = options || {};

        if (!isNonEmptyString(teamId)) {
            return { error: 'Team ID is required.' };
        }

        var built;
        try {
            built = buildReport(teamId, options);
        } catch (e) {
            return { error: 'Failed to build report: ' + e.message };
        }

        if (built.error) { return built; }

        var team = TeamQueries.getTeamById(teamId);
        var memberCount = 0;
        if (team) {
            var members = TeamQueries.getAllTeamMemberRecords(team);
            if (isPeriodScoped(options.period)) {
                members = filterMembersForPeriod(
                    members, options.period
                );
            }
            memberCount = members.length;
        }

        return {
            text: built.text,
            filename: built.filename,
            memberCount: memberCount
        };
    }

    // ============================================================
    // PUBLIC API - BULK TEAM EXPORT
    // ============================================================
    //
    // Concatenates the individual reports for a set of teams into
    // one file, under a bulk banner. Each team's report uses its
    // CURRENT period (the last one), with no member or ranking
    // filtering. The bulk export does not offer a period
    // selector.

    function buildBulkBanner(count) {
        var bannerWidth = 64;
        var banner = '';
        for (var i = 0; i < bannerWidth; i++) {
            banner += '=';
        }

        return banner + '\n' +
            'TEAM EXPORT \u2014 ' + count + ' team' +
            (count === 1 ? '' : 's') + '\n' +
            'Generated: ' + new Date().toISOString() + '\n' +
            banner;
    }

    function buildBulkFilename(count) {
        return 'teams-export-' + count + '.txt';
    }

    function exportTeamsText(teamIds) {
        if (!Array.isArray(teamIds)) {
            return {
                exported: false,
                error: 'teamIds must be an array.'
            };
        }

        if (teamIds.length === 0) {
            return {
                exported: false,
                error: 'No teams selected.'
            };
        }

        var parts = [];
        var skipped = 0;

        for (var i = 0; i < teamIds.length; i++) {
            var id = teamIds[i];
            if (!isNonEmptyString(id)) {
                skipped++;
                continue;
            }

            var built;
            try {
                built = buildReport(String(id), {});
            } catch (e) {
                console.warn(
                    '[TeamExport] buildReport threw for team ' +
                    id + ':', e
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
            return {
                exported: false,
                error: 'No teams could be built.'
            };
        }

        var count = parts.length;

        var banner = buildBulkBanner(count);
        var content = banner + '\n\n' + parts.join('\n\n');

        var filename = buildBulkFilename(count);

        var blob;
        try {
            blob = new Blob([content], {
                type: 'text/plain;charset=utf-8'
            });
        } catch (e) {
            return {
                exported: false,
                error: 'Failed to build file blob: ' + e.message
            };
        }

        try {
            ExportUtils.downloadBlob(blob, filename);
        } catch (e) {
            return {
                exported: false,
                error: 'Download failed: ' + e.message
            };
        }

        return {
            exported: true,
            filename: filename,
            count: count,
            skipped: skipped
        };
    }

    function buildTeamsTextReport(teamIds) {
        if (!Array.isArray(teamIds)) {
            return { error: 'teamIds must be an array.' };
        }
        if (teamIds.length === 0) {
            return { error: 'No teams selected.' };
        }

        var parts = [];
        var skipped = 0;

        for (var i = 0; i < teamIds.length; i++) {
            var id = teamIds[i];
            if (!isNonEmptyString(id)) {
                skipped++;
                continue;
            }

            var built;
            try {
                built = buildReport(String(id), {});
            } catch (e) {
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
            return { error: 'No teams could be built.' };
        }

        var count = parts.length;
        var banner = buildBulkBanner(count);
        var content = banner + '\n\n' + parts.join('\n\n');

        return {
            text: content,
            filename: buildBulkFilename(count),
            count: count,
            skipped: skipped
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamExport = Object.freeze({
        // Single team
        exportTeam: exportTeam,
        buildTeamReport: buildTeamReport,

        // Bulk
        exportTeamsText: exportTeamsText,
        buildTeamsTextReport: buildTeamsTextReport
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamExport;
        var missing = [];

        var required = [
            'exportTeam',
            'buildTeamReport',
            'exportTeamsText',
            'buildTeamsTextReport'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // ---- Predicate smoke test ----
        //
        // The Rapid / Rapid II table, applied to the export's
        // member filter. Uses the same predicate the filter uses.
        try {
            var rapid = { startPeriod: '1900', endPeriod: '1905' };
            var rii = { startPeriod: '1905', endPeriod: '' };

            function stintIn(stint, period) {
                return TeamQueries.intervalOverlapsPeriod(
                    stint[0], stint[1],
                    period.startPeriod, period.endPeriod
                );
            }

            if (!stintIn(['1898', ''], rapid)) {
                missing.push('1898–present should be in Rapid');
            }
            if (!stintIn(['1898', ''], rii)) {
                missing.push('1898–present should be in Rapid II');
            }
            if (!stintIn(['1900', '1904'], rapid)) {
                missing.push('1900–1904 should be in Rapid');
            }
            if (stintIn(['1900', '1904'], rii)) {
                missing.push('1900–1904 should NOT be in Rapid II');
            }
            if (!stintIn(['1904', '1908'], rapid)) {
                missing.push('1904–1908 should be in Rapid');
            }
            if (!stintIn(['1904', '1908'], rii)) {
                missing.push('1904–1908 should be in Rapid II');
            }
            if (stintIn(['1905', ''], rapid)) {
                missing.push('1905–present should NOT be in Rapid');
            }
            if (!stintIn(['1905', ''], rii)) {
                missing.push('1905–present should be in Rapid II');
            }
            if (stintIn(['1906', '1910'], rapid)) {
                missing.push('1906–1910 should NOT be in Rapid');
            }
            if (!stintIn(['1906', '1910'], rii)) {
                missing.push('1906–1910 should be in Rapid II');
            }
        } catch (e) {
            missing.push('predicate smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamExport] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
