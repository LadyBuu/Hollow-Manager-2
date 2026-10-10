/**
 * modules/teams/team-export.js - Team Export
 * Full textual dump of a single team.
 *
 * Path: js/modules/teams/team-export.js
 *
 * WHAT THIS OWNS:
 *   - Building a plain-text report for one team.
 *   - Handing the payload to ExportUtils.downloadBlob.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. TeamQueries, CharacterQueries, and the other
 *     cross-domain readers supply the raw data. This module
 *     composes them.
 *   - UI. TeamEvents triggers the export; this module returns a
 *     result object.
 *   - Format selection. One format: plain text.
 *   - Download mechanics. ExportUtils.downloadBlob owns the
 *     anchor, the blob URL, and the filename uniquification.
 *     This module supplies a base filename and hands over the
 *     payload.
 *
 * REPORT CONTENTS:
 *   - Team header: name, type, status, period, class, team number,
 *     associated mission, created-at.
 *   - Name history.
 *   - Ranking history.
 *   - Members section: every member entry (active and former),
 *     with role, intervals, and an embedded character snapshot.
 *   - Character snapshot: name, status, age, physical stats
 *     (with modifiers), magic proficiencies (non-zero only),
 *     HP / MP, weapons, special moves, career status history,
 *     department memberships, and OTHER PROFESSIONAL team
 *     memberships.
 *
 * ACADEMIC TEAMS ARE EXCLUDED FROM THE SNAPSHOT (this revision):
 *   pushOtherTeamMemberships now filters to professional teams
 *   only. The snapshot already carries every professional
 *   membership from the top-level TEAMS section; the OTHER
 *   TEAMS line is a cross-reference to teams the reader is not
 *   looking at. Academic teams are a different domain and are
 *   covered by the Academy view, not this report.
 *
 * DOWNLOAD FILENAMES:
 *   This module produces a base filename of the form
 *   "team_<slug>_<timestamp>.txt". ExportUtils.downloadBlob
 *   inserts its own local-time timestamp before the extension, so
 *   a second export of the same team in the same session never
 *   collides with the first.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.CharacterQueries
 *   - window.ExportUtils
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.CharacterStats     (stats and magic; absent =
 *                                "(unavailable)")
 *   - window.MagicConstants     (magic type labels; absent = raw
 *                                keys)
 *   - window.MissionQueries     (mission title resolution)
 *   - window.DepartmentQueries  (department memberships)
 *   - window.AcademyClasses     (class name resolution)
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
        if (hasStart) { return String(start) + '\u2013'; }
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
    // REPORT BUILDER
    // ============================================================

    function buildReport(teamId) {
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return { error: 'Team not found.' };
        }

        var lines = [];

        var title = 'TEAM REPORT: ' + (team.name || 'Unnamed Team');
        lines.push(title);
        lines.push(lineUnder(title));
        lines.push('');

        pushTeamHeader(lines, team);
        pushNameHistory(lines, team);
        pushRankingHistory(lines, team);
        pushMembersSection(lines, team);

        return {
            exported: true,
            filename: buildFilename(team),
            text: lines.join('\n')
        };
    }

    function buildFilename(team) {
        return 'team_' +
            slugify(team.name) +
            '_' + timestampSlug() +
            '.txt';
    }

    // ============================================================
    // TEAM HEADER
    // ============================================================

    function pushTeamHeader(lines, team) {
        lines.push('SECTION 1: TEAM');
        lines.push(lineDash('SECTION 1: TEAM'));
        lines.push('');

        lines.push('Name:        ' + (team.name || 'Unnamed Team'));
        lines.push('ID:          ' + safeString(team.id));
        lines.push('Type:        ' +
            (TeamConstants.getTypeLabel(team.type) || team.type || '') +
        '');
        lines.push('Status:      ' + safeString(team.status || 'active'));
        lines.push('Period:      ' + formatPeriod(
            team.startPeriod, team.endPeriod
        ));
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
    // NAME HISTORY
    // ============================================================

    function pushNameHistory(lines, team) {
        lines.push('SECTION 2: NAME HISTORY');
        lines.push(lineDash('SECTION 2: NAME HISTORY'));
        lines.push('');

        var history = Array.isArray(team.nameHistory)
            ? team.nameHistory
            : [];

        if (history.length === 0) {
            lines.push('  (no name history)');
            lines.push('');
            return;
        }

        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!entry || typeof entry !== 'object') { continue; }
            var name = safeString(entry.name);
            var period = formatPeriod(
                entry.startPeriod, entry.endPeriod
            );
            lines.push('  - ' + name + ' (' + period + ')');
        }

        lines.push('');
    }

    // ============================================================
    // RANKING HISTORY
    // ============================================================

    function pushRankingHistory(lines, team) {
        lines.push('SECTION 3: RANKING HISTORY');
        lines.push(lineDash('SECTION 3: RANKING HISTORY'));
        lines.push('');

        var summary = TeamQueries.getRankingSummary(team);
        var history = summary && Array.isArray(summary.history)
            ? summary.history
            : [];

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

    function pushMembersSection(lines, team) {
        lines.push('SECTION 4: MEMBERS');
        lines.push(lineDash('SECTION 4: MEMBERS'));
        lines.push('');

        var members = TeamQueries.getAllTeamMemberRecords(team);

        if (!Array.isArray(members) || members.length === 0) {
            lines.push('  (no members)');
            lines.push('');
            return;
        }

        for (var i = 0; i < members.length; i++) {
            pushMemberRecord(lines, members[i], i + 1, members.length);
        }
    }

    function pushMemberRecord(lines, member, index, total) {
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

        pushMemberIntervals(lines, member);
        pushCharacterSnapshot(lines, char);

        lines.push('');
    }

    function pushMemberIntervals(lines, member) {
        var intervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

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
        // CharacterStats is a lazy dependency. When it is not
        // loaded -- which can happen if the export is triggered
        // before the character module hierarchy finishes loading
        // -- the line reports "(unavailable)" and the report
        // continues.
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

            // Include the modifier when the module can compute
            // one. The modifier is derived from the value; a
            // missing helper falls back to the value alone.
            if (typeof CharacterStats.getModifierDisplay ===
                'function' && typeof v === 'number') {
                try {
                    display = v + ' (' +
                        CharacterStats.getModifierDisplay(v) + ')';
                } catch (e) {
                    // Fall through to the plain value.
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
        // ---- Weapons ----
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

        // ---- Special moves ----
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

        // Filter to professional only. Academic, temporary, and
        // civilian memberships are out of scope for this report:
        // academic teams belong to the Academy view, and
        // temporary / civilian are separate domains. The top-level
        // TEAMS section above is already professional-only.
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
            lines.push('        - ' + p.name + statusSuffix);
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Export a single team as a plain-text report.
     *
     * @param {string} teamId
     * @returns {object}
     *   { exported: true, filename, count } on success
     *   { error: string } on failure
     */
    function exportTeam(teamId) {
        if (!isNonEmptyString(teamId)) {
            return { error: 'Team ID is required.' };
        }

        var built;
        try {
            built = buildReport(teamId);
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
        var memberCount = team && Array.isArray(team.members)
            ? team.members.length
            : 0;

        return {
            exported: true,
            filename: built.filename,
            count: memberCount
        };
    }

    /**
     * Build the report without downloading. For tests and preview.
     *
     * @param {string} teamId
     * @returns {object}
     *   { text, filename, memberCount } on success
     *   { error: string } on failure
     */
    function buildTeamReport(teamId) {
        if (!isNonEmptyString(teamId)) {
            return { error: 'Team ID is required.' };
        }

        var built;
        try {
            built = buildReport(teamId);
        } catch (e) {
            return { error: 'Failed to build report: ' + e.message };
        }

        if (built.error) { return built; }

        var team = TeamQueries.getTeamById(teamId);
        var memberCount = team && Array.isArray(team.members)
            ? team.members.length
            : 0;

        return {
            text: built.text,
            filename: built.filename,
            memberCount: memberCount
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamExport = Object.freeze({
        exportTeam: exportTeam,
        buildTeamReport: buildTeamReport
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamExport;
        var missing = [];

        if (typeof exports.exportTeam !== 'function') {
            missing.push('exportTeam');
        }
        if (typeof exports.buildTeamReport !== 'function') {
            missing.push('buildTeamReport');
        }

        if (missing.length > 0) {
            console.warn(
                '[TeamExport] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
