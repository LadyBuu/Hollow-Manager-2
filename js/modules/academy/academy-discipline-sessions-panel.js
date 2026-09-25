/**
 * modules/academy/academy-discipline-sessions-panel.js
 * Academy Discipline Sessions Panel
 *
 * Path: js/modules/academy/academy-discipline-sessions-panel.js
 *
 * The panel that sits below the discipline schedule grid and its
 * enrollment summary, in the Disciplines view's Schedule tab.
 *
 * WHAT IT SHOWS:
 *   Every active teaching group of a (class, discipline, week)
 *   triple, across every instructor. For each group:
 *     - the group's display name
 *     - the instructor
 *     - every session of the group that is active this week
 *     - the group's active roster for the week
 *     - an inline "+ Add Student" button that opens the candidate
 *       picker (same component as the instructor tab)
 *     - a per-student Remove button
 *
 * WHAT IT DOES NOT SHOW:
 *   Anything scoped to a single instructor. The instructor tab
 *   already exists and is scoped that way. This panel is the
 *   discipline-scoped mirror: all instructors, one discipline.
 *
 * RENDER ONLY:
 *   This module produces HTML. It does not fetch, mutate, or bind
 *   events. The controller mounts the HTML and routes the data-*
 *   markers below.
 *
 * VM SHAPE (from buildSessionViewModel):
 *   {
 *     classId, className,
 *     disciplineId, disciplineName,
 *     week,
 *     groups: [ groupVM ],
 *     totalGroups, totalSessions, totalMembers
 *   }
 *
 *   groupVM:
 *   {
 *     groupId, displayName,
 *     instructorId, instructorName,
 *     memberCount,
 *     members: [ { characterId, name, status } ],
 *     sessions: [ { sessionId, day, dayLabel, startTime,
 *                   startTimeLabel, duration, durationLabel,
 *                   locationId, locationName } ],
 *     isPickerOpen: boolean,
 *     pickerCandidates: { candidates, blocked } | null
 *   }
 *
 *   The `isPickerOpen` and `pickerCandidates` fields are stamped
 *   onto the VM by the controller, not by buildSessionViewModel.
 *   The builder leaves them at their defaults (false / null); the
 *   controller overwrites the entry for the group whose picker is
 *   currently open.
 *
 * EVENTS EMITTED (data-* attributes):
 *   [data-action="discipline-sessions-add-student"]      (click)
 *   [data-action="discipline-sessions-add-student-cancel"] (click)
 *   [data-action="discipline-sessions-add-student-submit"] (click)
 *   [data-action="discipline-sessions-remove-student"]   (click)
 *   [data-action="discipline-sessions-add-student-toggle"] (click)
 *     Toggles the candidate checkbox. Handled by the controller's
 *     delegated input handler via the checkbox class, not by this
 *     marker. The marker is emitted for symmetry only.
 *
 * PICKER MARKUP:
 *   The candidate picker emits the same classes, data attributes,
 *   and structural selectors as the one in academy-character-detail.js:
 *
 *     .academy-teaching-group-candidate-picker        (root)
 *     .academy-teaching-group-candidate-checkbox      (each eligible row)
 *     .academy-teaching-group-candidate-row           (each row)
 *     .academy-teaching-group-candidate-section       (each section)
 *     .academy-teaching-group-candidate-search        (search input)
 *     [data-section="eligible"] / [data-section="blocked"]
 *     [data-bulk-action="select-all"] / [data-bulk-action="clear"]
 *     [data-action="teaching-groups-add-student-submit"]
 *     [data-action="teaching-groups-add-student-cancel"]
 *
 *   The People controller's candidate-picker handlers read these
 *   selectors structurally, not by module. Any picker markup that
 *   uses the same classes works with the same handlers, provided
 *   the controller routes the events. This module emits those
 *   markers verbatim so the discipline controller's parallel
 *   handlers can reuse the same structural selectors.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.CalendarConstants (MANDATORY)
 *   - window.AcademyTeachingGroups (for the VM builder)
 *   - window.AcademyTeachingSessions (for the VM builder)
 *   - window.AcademyClasses (for class existence)
 *   - window.AcademyDisciplines (for discipline existence)
 *   - window.CharacterQueries (for instructor and member names)
 */

(function() {
    'use strict';

    if (window.__academyDisciplineSessionsPanelLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyDisciplineSessionsPanel] Missing mandatory ' +
            'dependency: DomUtils.escapeHtml / escapeAttribute'
        );
    }

    if (!CalendarConstants ||
        typeof CalendarConstants.getDayName !== 'function' ||
        typeof CalendarConstants.formatHour !== 'function') {
        throw new Error(
            '[AcademyDisciplineSessionsPanel] Missing mandatory ' +
            'dependency: CalendarConstants.getDayName / formatHour'
        );
    }

    window.__academyDisciplineSessionsPanelLoaded = true;

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function formatDayName(day) {
        try {
            var n = CalendarConstants.getDayName(day);
            return isNonEmptyString(n) ? n : ('Day ' + day);
        } catch (e) {
            return 'Day ' + day;
        }
    }

    function formatHourLabel(hour) {
        try {
            var s = CalendarConstants.formatHour(hour);
            return isNonEmptyString(s) ? s : (hour + ':00');
        } catch (e) {
            return hour + ':00';
        }
    }

    // ============================================================
    // VIEW MODEL BUILDER
    // ============================================================
    //
    // Pure with respect to the app; reads from the domain modules
    // but does not mutate anything. Returns null when the class or
    // discipline cannot be resolved, or the week is invalid.
    //
    // Every group of the discipline is considered. A group whose
    // own [startWeek, endWeek] does not contain the week is
    // skipped, because "sessions this week" is the panel's question.
    // A group with no sessions active this week is still included
    // if it exists at the week: the reader may need to add a
    // student to a group with no scheduled meetings.

    function buildSessionViewModel(classId, disciplineId, week) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(disciplineId)) {
            return null;
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) { return null; }

        var AcademyClasses = window.AcademyClasses;
        var AcademyDisciplines = window.AcademyDisciplines;
        var AcademyTeachingGroups = window.AcademyTeachingGroups;
        var AcademyTeachingSessions = window.AcademyTeachingSessions;
        var CharacterQueries = window.CharacterQueries;

        if (!AcademyClasses ||
            typeof AcademyClasses.getClass !== 'function') {
            return null;
        }
        if (!AcademyDisciplines ||
            typeof AcademyDisciplines.getDiscipline !== 'function') {
            return null;
        }
        if (!AcademyTeachingGroups ||
            typeof AcademyTeachingGroups.getGroupsForDiscipline !==
                'function' ||
            typeof AcademyTeachingGroups.getActiveMembers !== 'function') {
            return null;
        }
        if (!AcademyTeachingSessions ||
            typeof AcademyTeachingSessions.getSessionsForGroup !==
                'function') {
            return null;
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacterById !== 'function' ||
            typeof CharacterQueries.getDisplayName !== 'function') {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return null; }

        var disc = AcademyDisciplines.getDiscipline(disciplineId);
        if (!disc) { return null; }

        var rawGroups =
            AcademyTeachingGroups.getGroupsForDiscipline(
                classId, disciplineId
            ) || [];

        var groups = [];
        var totalSessions = 0;
        var totalMembers = 0;

        for (var g = 0; g < rawGroups.length; g++) {
            var group = rawGroups[g];
            if (!group || !group.id) { continue; }

            if (!weekInRange(weekNum, group.startWeek, group.endWeek)) {
                continue;
            }

            var instructorName = getCharacterName(group.instructorId);

            var members = buildMemberList(
                group.id, weekNum, AcademyTeachingGroups,
                CharacterQueries
            );
            totalMembers += members.length;

            var sessions = buildSessionList(
                group.id, weekNum, AcademyTeachingSessions
            );
            totalSessions += sessions.length;

            var displayName = getGroupDisplayName(
                group, disc.name, AcademyTeachingGroups
            );

            groups.push({
                groupId: String(group.id),
                displayName: displayName,
                instructorId: isNonEmptyString(group.instructorId)
                    ? String(group.instructorId)
                    : null,
                instructorName: instructorName,
                memberCount: members.length,
                members: members,
                sessions: sessions,
                isPickerOpen: false,
                pickerCandidates: null
            });
        }

        groups.sort(function(a, b) {
            return a.displayName.localeCompare(b.displayName);
        });

        return {
            classId: String(classId),
            className: isNonEmptyString(cls.name)
                ? cls.name
                : 'Unnamed Class',
            disciplineId: String(disciplineId),
            disciplineName: isNonEmptyString(disc.name)
                ? disc.name
                : 'Unknown Discipline',
            week: weekNum,
            groups: groups,
            totalGroups: groups.length,
            totalSessions: totalSessions,
            totalMembers: totalMembers
        };
    }

    function weekInRange(week, startWeek, endWeek) {
        if (typeof startWeek !== 'number' || !isFinite(startWeek)) {
            return false;
        }
        if (week < startWeek) { return false; }
        if (endWeek === null || endWeek === undefined) { return true; }
        if (typeof endWeek !== 'number' || !isFinite(endWeek)) {
            return true;
        }
        return week <= endWeek;
    }

    function getGroupDisplayName(group, disciplineName, TG) {
        if (isNonEmptyString(group.customName)) {
            return String(group.customName).trim();
        }
        var num = isFiniteNumber(group.groupNumber)
            ? group.groupNumber
            : 0;
        var base = isNonEmptyString(disciplineName)
            ? disciplineName
            : 'Group';
        return num > 0 ? (base + ' ' + num) : base;
    }

    function getCharacterName(charId) {
        if (!isNonEmptyString(charId)) { return ''; }
        var CharacterQueries = window.CharacterQueries;
        if (!CharacterQueries) { return ''; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return ''; }
        try {
            return CharacterQueries.getDisplayName(char) || '';
        } catch (e) {
            return '';
        }
    }

    function getCharacterStatus(charId) {
        if (!isNonEmptyString(charId)) { return ''; }
        var CharacterQueries = window.CharacterQueries;
        if (!CharacterQueries ||
            typeof CharacterQueries.getCurrentStatus !== 'function') {
            return '';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return ''; }
        try {
            return CharacterQueries.getCurrentStatus(char) || '';
        } catch (e) {
            return '';
        }
    }

    function buildMemberList(
        groupId, weekNum, TG, CQ
    ) {
        var raw = [];
        try {
            raw = TG.getActiveMembers(groupId, weekNum) || [];
        } catch (e) {
            raw = [];
        }
        if (!Array.isArray(raw)) { return []; }

        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var charId = raw[i];
            if (!isNonEmptyString(charId)) { continue; }
            var char = CQ.getCharacterById(charId);
            result.push({
                characterId: String(charId),
                name: char
                    ? (CQ.getDisplayName(char) || 'Unknown')
                    : 'Unknown',
                status: char
                    ? (CQ.getCurrentStatus(char) || '')
                    : ''
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    function buildSessionList(groupId, weekNum, TS) {
        var raw = [];
        try {
            raw = TS.getSessionsForGroup(groupId) || [];
        } catch (e) {
            raw = [];
        }
        if (!Array.isArray(raw)) { return []; }

        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var s = raw[i];
            if (!s || !s.id) { continue; }
            if (!isFiniteNumber(s.day)) { continue; }
            if (!isFiniteNumber(s.startTime)) { continue; }

            if (!weekInRange(weekNum, s.startWeek, s.endWeek)) {
                continue;
            }

            var duration = isFiniteNumber(s.duration)
                ? s.duration
                : 1;

            var locationName = '';
            var AL = window.AcademyLocations;
            if (AL && typeof AL.getLocationName === 'function' &&
                isNonEmptyString(s.locationId)) {
                try {
                    var n = AL.getLocationName(s.locationId);
                    if (isNonEmptyString(n) && n !== 'Unknown') {
                        locationName = n;
                    }
                } catch (e) {
                    locationName = '';
                }
            }

            result.push({
                sessionId: String(s.id),
                day: s.day,
                dayLabel: formatDayName(s.day),
                startTime: s.startTime,
                startTimeLabel: formatHourLabel(s.startTime),
                duration: duration,
                durationLabel: duration + 'h',
                locationId: isNonEmptyString(s.locationId)
                    ? String(s.locationId)
                    : null,
                locationName: locationName
            });
        }

        result.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            return a.startTime - b.startTime;
        });

        return result;
    }

    // ============================================================
    // RENDER — PANEL
    // ============================================================

    function renderHTML(vm) {
        if (!vm || typeof vm !== 'object') {
            throw new Error(
                '[AcademyDisciplineSessionsPanel] renderHTML requires ' +
                'a view model.'
            );
        }

        var html = '';
        html += '<div class="academy-discipline-sessions-panel">';

        html += renderHeader(vm);

        if (vm.totalGroups === 0) {
            html += renderNoGroups();
        } else {
            html += '<div class="academy-discipline-sessions-list">';
            for (var i = 0; i < vm.groups.length; i++) {
                html += renderGroupBlock(vm.groups[i], vm);
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderHeader(vm) {
        var html = '';
        html += '<div class="academy-discipline-sessions-header">';
        html += '<h4 class="academy-discipline-sessions-title">' +
                    'Teaching Sessions' +
                '</h4>';
        html += '<span class="academy-discipline-sessions-subtitle">' +
                    escapeHtml(vm.disciplineName) +
                '</span>';
        html += '<span class="academy-discipline-sessions-meta">' +
                    vm.totalGroups + ' group' +
                    (vm.totalGroups === 1 ? '' : 's') +
                    ' \u00b7 ' +
                    vm.totalSessions + ' session' +
                    (vm.totalSessions === 1 ? '' : 's') +
                    ' \u00b7 ' +
                    vm.totalMembers + ' student' +
                    (vm.totalMembers === 1 ? '' : 's') +
                '</span>';
        html += '</div>';
        return html;
    }

    function renderNoGroups() {
        return (
            '<p class="empty-state small ' +
                    'academy-discipline-sessions-empty">' +
                'No teaching groups exist for this discipline yet. ' +
                'Groups are created by an instructor from their own ' +
                'schedule grid.' +
            '</p>'
        );
    }

    // ============================================================
    // RENDER — GROUP BLOCK
    // ============================================================

    function renderGroupBlock(group, vm) {
        if (!group || !group.groupId) { return ''; }

        var html = '';
        html += '<div class="academy-discipline-session-group" ' +
                    'data-group-id="' +
                        escapeAttribute(group.groupId) + '">';

        // ---- Group header ----
        html += '<div class="academy-discipline-session-group-header">';
        html += '<span class="academy-discipline-session-group-name">' +
                    escapeHtml(group.displayName) +
                '</span>';

        if (isNonEmptyString(group.instructorName)) {
            html += '<span class="academy-discipline-session-group-instructor">' +
                        escapeHtml(group.instructorName) +
                    '</span>';
        } else {
            html += '<span class="academy-discipline-session-group-instructor ' +
                        'academy-discipline-session-group-instructor-empty">' +
                        'No instructor' +
                    '</span>';
        }

        html += '<span class="academy-discipline-session-group-members">' +
                    group.memberCount + ' student' +
                    (group.memberCount === 1 ? '' : 's') +
                '</span>';
        html += '</div>';

        // ---- Sessions list ----
        html += renderSessionsList(group);

        // ---- Roster ----
        html += renderRoster(group, vm);

        // ---- Candidate picker (when open) ----
        if (group.isPickerOpen === true) {
            html += renderCandidatePicker(
                group, group.pickerCandidates
            );
        }

        // ---- Add Student button (when picker is closed) ----
        if (group.isPickerOpen !== true) {
            html += '<div class="academy-discipline-session-group-actions">';
            html += '<button type="button" class="small primary" ' +
                        'data-action="discipline-sessions-add-student" ' +
                        'data-group-id="' +
                            escapeAttribute(group.groupId) + '">' +
                        '+ Add Student' +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderSessionsList(group) {
        var sessions = Array.isArray(group.sessions)
            ? group.sessions
            : [];

        var html = '';
        html += '<div class="academy-discipline-session-group-sessions">';

        if (sessions.length === 0) {
            html += '<p class="empty-state small ' +
                        'academy-discipline-session-group-sessions-empty">' +
                        'No sessions scheduled for this group this week.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < sessions.length; i++) {
            html += renderSessionRow(sessions[i]);
        }

        html += '</div>';
        return html;
    }

    function renderSessionRow(session) {
        if (!session || !session.sessionId) { return ''; }

        var html = '';
        html += '<div class="academy-discipline-session-row" ' +
                    'data-session-id="' +
                        escapeAttribute(session.sessionId) + '">';

        html += '<span class="academy-discipline-session-time">' +
                    escapeHtml(session.dayLabel) + ', ' +
                    escapeHtml(session.startTimeLabel) +
                '</span>';

        html += '<span class="academy-discipline-session-duration">' +
                    escapeHtml(session.durationLabel) +
                '</span>';

        if (isNonEmptyString(session.locationName)) {
            html += '<span class="academy-discipline-session-location">' +
                        escapeHtml(session.locationName) +
                    '</span>';
        }

        html += '</div>';
        return html;
    }

    function renderRoster(group, vm) {
        var members = Array.isArray(group.members) ? group.members : [];

        var html = '';
        html += '<div class="academy-discipline-session-group-roster">';

        if (members.length === 0) {
            html += '<p class="empty-state small ' +
                        'academy-discipline-session-group-roster-empty">' +
                        'No students assigned to this group this week.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < members.length; i++) {
            html += renderRosterRow(members[i], group.groupId);
        }

        html += '</div>';
        return html;
    }

    function renderRosterRow(member, groupId) {
        if (!member || !member.characterId) { return ''; }

        var html = '';
        html += '<div class="academy-discipline-session-roster-row" ' +
                    'data-character-id="' +
                        escapeAttribute(member.characterId) + '">';

        html += '<span class="academy-discipline-session-roster-name">' +
                    escapeHtml(member.name) +
                '</span>';

        if (isNonEmptyString(member.status)) {
            html += '<span class="academy-discipline-session-roster-status">' +
                        escapeHtml(member.status) +
                    '</span>';
        }

        html += '<button type="button" class="small danger" ' +
                    'data-action="discipline-sessions-remove-student" ' +
                    'data-group-id="' +
                        escapeAttribute(groupId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(member.characterId) + '">' +
                    'Remove' +
                '</button>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // RENDER — CANDIDATE PICKER
    // ============================================================
    //
    // Markup mirrors academy-character-detail.js's candidate picker.
    // Same classes, same data-* attributes, same structure. The
    // discipline controller's parallel handlers read by class and
    // by data attribute, not by module; the exact same markup works
    // with the same handler set.

    function renderCandidatePicker(group, pickerVM) {
        var hasVM = pickerVM &&
            typeof pickerVM === 'object' &&
            !Array.isArray(pickerVM);

        var eligible = hasVM && Array.isArray(pickerVM.candidates)
            ? pickerVM.candidates
            : null;
        var blocked = hasVM && Array.isArray(pickerVM.blocked)
            ? pickerVM.blocked
            : [];

        var html = '';
        html += '<div class="academy-teaching-group-candidate-picker" ' +
                    'data-group-id="' +
                        escapeAttribute(group.groupId) + '">';

        if (!hasVM) {
            html += '<p class="empty-state small">' +
                        'Loading candidates\u2026' +
                    '</p>';
            html += '</div>';
            return html;
        }

        var totalEligible = eligible ? eligible.length : 0;
        var totalBlocked = blocked.length;

        // ---- Header ----
        html += '<div class="academy-teaching-group-candidate-header">';
        html += '<span class="academy-teaching-group-candidate-title">' +
                    'Add students to ' +
                    escapeHtml(group.displayName) +
                '</span>';
        html += '</div>';

        if (totalEligible === 0 && totalBlocked === 0) {
            html += '<p class="empty-state small">' +
                        'No eligible students. Every enrolled student ' +
                        'is either already in a group for this ' +
                        'discipline, or unavailable this week.' +
                    '</p>';
            html += renderCandidatePickerFooter(group);
            html += '</div>';
            return html;
        }

        // ---- Search ----
        html += '<input type="text" ' +
                    'class="academy-teaching-group-candidate-search" ' +
                    'placeholder="Search candidates..." ' +
                    'autocomplete="off" ' +
                    'spellcheck="false">';

        // ---- Body ----
        html += '<div class="academy-teaching-group-candidate-body">';

        if (totalEligible > 0) {
            html += '<div class="academy-teaching-group-candidate-section ' +
                        'academy-teaching-group-candidate-section-eligible" ' +
                        'data-section="eligible">';
            html += '<div class="academy-teaching-group-candidate-section-header">';
            html += '<span class="academy-teaching-group-candidate-section-title">' +
                        'Eligible' +
                    '</span>';
            html += '<span class="academy-teaching-group-candidate-section-count" ' +
                        'data-section-count="eligible">' +
                        '0 / ' + totalEligible +
                    '</span>';
            html += '</div>';

            html += '<div class="academy-teaching-group-candidate-section-actions">';
            html += '<button type="button" class="small secondary" ' +
                        'data-bulk-action="select-all" ' +
                        'data-section="eligible">Select all</button>';
            html += '<button type="button" class="small secondary" ' +
                        'data-bulk-action="clear" ' +
                        'data-section="eligible">Clear</button>';
            html += '</div>';

            html += '<div class="academy-teaching-group-candidate-list">';
            for (var i = 0; i < eligible.length; i++) {
                html += renderEligibleCandidateRow(eligible[i]);
            }
            html += '</div>';
            html += '</div>';
        }

        if (totalBlocked > 0) {
            html += '<div class="academy-teaching-group-candidate-section ' +
                        'academy-teaching-group-candidate-section-blocked" ' +
                        'data-section="blocked">';
            html += '<div class="academy-teaching-group-candidate-section-header">';
            html += '<span class="academy-teaching-group-candidate-section-title">' +
                        'Would conflict' +
                    '</span>';
            html += '<span class="academy-teaching-group-candidate-section-count">' +
                        totalBlocked +
                    '</span>';
            html += '</div>';

            html += '<div class="academy-teaching-group-candidate-list">';
            for (var j = 0; j < blocked.length; j++) {
                html += renderBlockedCandidateRow(blocked[j]);
            }
            html += '</div>';
            html += '</div>';
        }

        html += '<p class="academy-teaching-group-candidate-no-matches" ' +
                    'data-no-matches ' +
                    'style="display:none;">' +
                    'No matches.' +
                '</p>';

        html += '</div>'; // body

        html += renderCandidatePickerFooter(group);
        html += '</div>'; // root
        return html;
    }

    function renderCandidatePickerFooter(group) {
        var html = '';
        html += '<div class="academy-teaching-group-candidate-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="discipline-sessions-add-student-cancel" ' +
                    'data-group-id="' +
                        escapeAttribute(group.groupId) + '">' +
                    'Cancel' +
                '</button>';
        html += '<button type="button" class="small primary ' +
                    'academy-teaching-group-candidate-submit" ' +
                    'data-action="discipline-sessions-add-student-submit" ' +
                    'data-group-id="' +
                        escapeAttribute(group.groupId) + '" ' +
                    'disabled="disabled">' +
                    'Add' +
                '</button>';
        html += '</div>';
        return html;
    }

    function renderEligibleCandidateRow(candidate) {
        if (!candidate || !candidate.id) { return ''; }

        var searchKey = String(candidate.name || '').toLowerCase();

        var html = '';
        html += '<label class="academy-teaching-group-candidate-row" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.id) + '" ' +
                    'data-search-key="' +
                        escapeAttribute(searchKey) + '">';
        html += '<input type="checkbox" ' +
                    'class="academy-teaching-group-candidate-checkbox" ' +
                    'value="' +
                        escapeAttribute(candidate.id) + '">';
        html += '<span class="academy-teaching-group-candidate-name">' +
                    escapeHtml(candidate.name) +
                '</span>';
        if (isNonEmptyString(candidate.status)) {
            html += '<span class="academy-teaching-group-candidate-status">' +
                        escapeHtml(candidate.status) +
                    '</span>';
        }
        html += '</label>';
        return html;
    }

    function renderBlockedCandidateRow(candidate) {
        if (!candidate || !candidate.id) { return ''; }

        var searchKey = String(candidate.name || '').toLowerCase();
        var reason = buildBlockedReason(candidate.conflict);

        var html = '';
        html += '<div class="academy-teaching-group-candidate-row ' +
                    'academy-teaching-group-candidate-row-blocked" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.id) + '" ' +
                    'data-search-key="' +
                        escapeAttribute(searchKey) + '" ' +
                    'aria-disabled="true">';
        html += '<span class="academy-teaching-group-candidate-blocked-icon">' +
                    '\u26a0' +
                '</span>';
        html += '<span class="academy-teaching-group-candidate-blocked-main">';
        html += '<span class="academy-teaching-group-candidate-blocked-name">' +
                    escapeHtml(candidate.name) +
                '</span>';
        if (reason) {
            html += '<span class="academy-teaching-group-candidate-blocked-reason">' +
                        escapeHtml(reason) +
                    '</span>';
        }
        html += '</span>';
        html += '</div>';
        return html;
    }

    function buildBlockedReason(conflict) {
        if (!conflict) { return ''; }

        var dayLabel = '';
        if (isFiniteNumber(conflict.day)) {
            dayLabel = formatDayName(conflict.day);
        }

        var timeLabel = '';
        if (isFiniteNumber(conflict.startTime)) {
            timeLabel = formatHourLabel(conflict.startTime);
        }

        var parts = [];
        if (dayLabel) { parts.push(dayLabel); }
        if (timeLabel) { parts.push(timeLabel); }

        if (parts.length === 0) {
            return 'Conflicts with an existing session.';
        }
        return 'Conflicts with a session on ' + parts.join(' at ');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplineSessionsPanel = Object.freeze({
        buildSessionViewModel: buildSessionViewModel,
        renderHTML: renderHTML
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyDisciplineSessionsPanel;
        var missing = [];

        var required = ['buildSessionViewModel', 'renderHTML'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyDisciplineSessionsPanel] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
