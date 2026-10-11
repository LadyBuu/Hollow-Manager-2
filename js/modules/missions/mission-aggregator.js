/**
 * js/modules/missions/mission-aggregator.js - Mission Aggregator
 *
 * Path: js/modules/missions/mission-aggregator.js
 *
 * Projection builder for the mission domain.
 *
 * WHAT THIS MODULE OWNS:
 *   - Assembling UI-shaped view models from mission records,
 *     cross-domain references, and presentation metadata.
 *   - Resolving team names and support personnel names.
 *   - Resolving report author names, including the redacted case.
 *   - Deriving the mission label via MissionId.derive and
 *     attaching it to VMs as a read-only field.
 *   - Exposing capability flags (canEdit, canComplete, ...) by
 *     delegating to MissionRules.
 *   - Building the report-author options list, with team members
 *     first, then the rest of the character store alphabetically.
 *     Filler characters are excluded; deceased characters are
 *     marked.
 *   - Building the participant VM (getParticipantsViewModel) and
 *     the rookie-candidate VM (getRookieCandidatesViewModel) used
 *     by the mission form's participant panel.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Reads, mutations, structural validation, domain rules, or
 *     presentation vocabulary. Each of those lives in its own
 *     module (MissionQueries, MissionCore, MissionSchema,
 *     MissionRules, MissionViews respectively). This module calls
 *     them and composes their results.
 *   - The mission label's grammar. MissionId owns the grammar and
 *     the derivation.
 *   - Team-assignment shape. MissionQueries.getTeamIdsForMission
 *     owns the read-side coercion of the legacy singular
 *     assignedTeamId into the canonical array.
 *
 * VM SHAPE PRINCIPLES:
 *   - Every VM is a plain data structure. No functions, no live
 *     references to mission, team, or character records.
 *   - Every reference to a cross-domain entity is either an ID or
 *     a resolved { id, name } pair.
 *   - Derived values (missionId, progress, pay, capability flags)
 *     are present on VMs so renderers never compute them.
 *
 * MULTIPLE TEAMS:
 *   The detail and list VMs carry `assignedTeamIds` (array of ids)
 *   and `assignedTeams` (array of resolved { id, name } refs). The
 *   singular `teamId` / `teamName` fields are kept for backward
 *   compatibility: they carry the FIRST team in the array, or null
 *   / 'Unassigned' when the array is empty.
 *
 * REPORT AUTHOR OPTIONS:
 *   getReportAuthorOptionsViewModel(missionId) builds the option
 *   list for the report form's author <select>. Shape:
 *
 *     {
 *       missionId,
 *       missionTitle,
 *       teamMembers:     [ { id, name, deceased } ],   // may be []
 *       otherCharacters: [ { id, name, deceased } ]
 *     }
 *
 *   Team members are the active members of the mission's assigned
 *   teams at the current application year. Filler characters are
 *   excluded from both lists. Deceased characters are marked.
 *
 * PARTICIPANTS VM:
 *   getParticipantsViewModel(missionId) builds the data the
 *   mission form's participant panel needs. Shape:
 *
 *     {
 *       missionId,
 *       missionTitle,
 *       missionYear,          // the year the mission takes place
 *       assignedTeams: [      // one row per assigned team
 *         {
 *           teamId,
 *           teamName,
 *           members: [      // active members at missionYear
 *             {
 *               characterId,
 *               displayName,
 *               deceased,
 *               isParticipant   // true when this (char, team)
 *                               // is already a participant
 *             }
 *           ]
 *         }
 *       ],
 *       currentParticipants: [ // all current participant entries
 *         {
 *           characterId,
 *           displayName,
 *           teamId,
 *           teamName,           // null for rookies
 *           source,             // 'team' | 'rookie'
 *           sourceLabel,        // human label
 *           deceased
 *         }
 *       ]
 *     }
 *
 *   The panel renders `assignedTeams` as one section per team, with
 *   a checkbox per member. The checkbox is checked when
 *   isParticipant is true. Below that, the rookie section is
 *   rendered from getRookieCandidatesViewModel.
 *
 * ROOKIE CANDIDATES VM:
 *   getRookieCandidatesViewModel(missionId) builds the list for
 *   the rookie search panel. Shape:
 *
 *     {
 *       missionId,
 *       candidates: [         // sorted alphabetically by name
 *         {
 *           characterId,
 *           displayName,
 *           deceased,
 *           isParticipant,    // already added as a rookie
 *           onAssignedTeam    // already a team member on the mission
 *         }
 *       ]
 *     }
 *
 *   A candidate is any character who has ever held a 'rookie'
 *   career status, is not filler, and is not already a team member
 *   of any of the mission's assigned teams. A character who is
 *   already a rookie participant appears with isParticipant true
 *   so the UI can render them as selected; the UI can filter them
 *   out or show them checked.
 *
 *   The character pool is walked once; there is no per-call cache.
 *   The candidate list is small (rookies are a bounded slice of
 *   the character store) and the VM is rebuilt on every open of
 *   the form.
 *
 * DATE DEFAULTS:
 *   The form VM's date defaults are (applicationYear, 1, 1).
 *   `applicationYear` is `window.data.currentYear` when present,
 *   else the current calendar year.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.MissionQueries
 *   - window.MissionConstants
 *   - window.MissionId
 *   - window.MissionRules
 *   - window.MissionViews
 *   - window.CharacterQueries
 *   - window.TeamQueries
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.CharacterConstants   (rookie status check)
 */

(function() {
    'use strict';

    if (window.__missionAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var MissionQueries = window.MissionQueries;
    var MissionConstants = window.MissionConstants;
    var MissionId = window.MissionId;
    var MissionRules = window.MissionRules;
    var MissionViews = window.MissionViews;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;

    var _missing = [];

    if (!MissionQueries) {
        _missing.push('MissionQueries (module)');
    } else {
        if (typeof MissionQueries.getMission !== 'function') {
            _missing.push('MissionQueries.getMission');
        }
        if (typeof MissionQueries.getMissions !== 'function') {
            _missing.push('MissionQueries.getMissions');
        }
        if (typeof MissionQueries.getStatistics !== 'function') {
            _missing.push('MissionQueries.getStatistics');
        }
        if (typeof MissionQueries.getTeamIdsForMission !== 'function') {
            _missing.push('MissionQueries.getTeamIdsForMission');
        }
        if (typeof MissionQueries.getParticipantsForMission !== 'function') {
            _missing.push('MissionQueries.getParticipantsForMission');
        }
        if (typeof MissionQueries.isParticipantInMission !== 'function') {
            _missing.push('MissionQueries.isParticipantInMission');
        }
    }

    if (!MissionConstants) {
        _missing.push('MissionConstants (module)');
    }
    if (!MissionId || typeof MissionId.derive !== 'function') {
        _missing.push('MissionId.derive');
    }
    if (!MissionRules) {
        _missing.push('MissionRules (module)');
    } else {
        if (typeof MissionRules.calculateProgress !== 'function') {
            _missing.push('MissionRules.calculateProgress');
        }
        if (typeof MissionRules.canEdit !== 'function') {
            _missing.push('MissionRules.canEdit');
        }
    }
    if (!MissionViews) {
        _missing.push('MissionViews (module)');
    } else {
        if (typeof MissionViews.getStatusInfo !== 'function') {
            _missing.push('MissionViews.getStatusInfo');
        }
        if (typeof MissionViews.getPriorityInfo !== 'function') {
            _missing.push('MissionViews.getPriorityInfo');
        }
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getActiveTeamMembers !== 'function') {
        _missing.push('TeamQueries.getActiveTeamMembers');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionAggregatorLoaded = true;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    /**
     * The application year for date defaults: window.data.currentYear
     * when it is a valid positive integer, else the current calendar
     * year.
     */
    function getApplicationYear() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }
        return new Date().getFullYear();
    }

    /**
     * The application year, or null when it cannot be determined.
     * Distinct from getApplicationYear: this returns null rather
     * than falling back to the calendar year, which is what the
     * report-author team-membership filter needs. When the answer
     * is null, the filter is skipped and every member counts.
     */
    function getApplicationYearOrNull() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }
        return null;
    }

    /**
     * Resolve the year a mission takes place. Prefers mission.year
     * when it is a valid positive integer; otherwise falls back to
     * the application year. Never returns null.
     */
    function resolveMissionYear(mission) {
        if (isPlainObject(mission)) {
            var y = parseInt(mission.year, 10);
            if (!isNaN(y) && y > 0) {
                return y;
            }
        }
        return getApplicationYear();
    }

    // ============================================================
    // ROOKIE DETECTION
    // ============================================================
    //
    // "Rookie" is a career status. A character has ever been a
    // rookie when any entry in `char.careerStatus` normalises to
    // 'rookie'. Normalisation:
    //
    //   - lowercase
    //   - strip a trailing ' (former)' suffix
    //   - trim
    //
    // This is the same normalisation the team domain uses in
    // TeamQueries.normaliseCareerStatusKey. It is duplicated here
    // rather than imported because the mission domain does not
    // depend on TeamQueries' private helpers, and the rule is
    // three lines.
    //
    // A character with a `'rookie (Former)'` entry counts. A
    // character whose current status is no longer rookie but who
    // was a rookie in a past year counts.
    //
    // The check does NOT consult CharacterConstants.STUDENT_STATUSES
    // or classifyStatus. Those treat 'rookie' as one of five
    // student statuses; the question here is narrower. A character
    // who was a 'junior' has never been a rookie.

    function normaliseCareerStatusKey(status) {
        if (status === undefined || status === null) { return ''; }
        var raw = String(status).trim().toLowerCase();
        if (raw === '') { return ''; }
        var formerIdx = raw.indexOf(' (former)');
        if (formerIdx !== -1) {
            raw = raw.substring(0, formerIdx).trim();
        }
        return raw;
    }

    /**
     * Has this character ever held a 'rookie' career status?
     *
     * A filler character is not a rookie candidate, so this returns
     * false for fillers regardless of their careerStatus entries.
     */
    function hasEverBeenRookie(char) {
        if (!isPlainObject(char)) { return false; }
        if (char.isFiller === true) { return false; }
        if (!Array.isArray(char.careerStatus)) { return false; }

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!isPlainObject(entry)) { continue; }
            var key = normaliseCareerStatusKey(entry.status);
            if (key === 'rookie') {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // ENTITY RESOLUTION
    // ============================================================

    function resolveCharacterRef(characterId) {
        if (!isNonEmptyString(characterId)) { return null; }
        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) {
            return {
                id: String(characterId),
                name: 'Unknown'
            };
        }
        return {
            id: char.id,
            name: CharacterQueries.getDisplayName(char),
            status: CharacterQueries.getCurrentStatus
                ? CharacterQueries.getCurrentStatus(char)
                : null
        };
    }

    function resolveTeamRef(teamId) {
        if (!isNonEmptyString(teamId)) { return null; }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return {
                id: String(teamId),
                name: 'Unknown Team'
            };
        }
        return {
            id: team.id,
            name: isNonEmptyString(team.name)
                ? team.name
                : 'Unnamed Team'
        };
    }

    /**
     * Resolve every team id on a mission into an array of
     * { id, name } refs. Uses MissionQueries.getTeamIdsForMission
     * so the read-side coercion of the legacy scalar is applied.
     */
    function resolveAssignedTeams(mission) {
        var ids = MissionQueries.getTeamIdsForMission(mission);
        if (!Array.isArray(ids) || ids.length === 0) { return []; }

        var refs = [];
        for (var i = 0; i < ids.length; i++) {
            var ref = resolveTeamRef(ids[i]);
            if (ref) {
                refs.push(ref);
            }
        }
        return refs;
    }

    // ============================================================
    // REPORT PROJECTION
    // ============================================================

    function buildReportVM(report, mission) {
        if (!isPlainObject(report)) { return null; }

        var authorRef = null;
        if (report.authorId !== undefined && report.authorId !== null) {
            authorRef = resolveCharacterRef(report.authorId);
        }

        var authorName;
        if (report.authorRedacted === true || !authorRef) {
            authorName = 'Unknown';
        } else {
            authorName = authorRef.name;
        }

        return {
            id: report.id,
            authorId: report.authorId || null,
            authorName: authorName,
            authorRedacted: report.authorRedacted === true,
            authorStatus: authorRef && authorRef.status
                ? authorRef.status
                : null,
            text: report.text || '',
            createdAt: report.createdAt || null,
            createdAtDisplay: MissionViews.formatTimestamp
                ? MissionViews.formatTimestamp(report.createdAt)
                : '',
            updatedAt: report.updatedAt || null,
            updatedAtDisplay: MissionViews.formatTimestamp
                ? MissionViews.formatTimestamp(report.updatedAt)
                : '',
            isEdited: report.updatedAt !== undefined &&
                      report.updatedAt !== null
        };
    }

    function buildReportsVM(mission) {
        if (!mission || !Array.isArray(mission.reports)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < mission.reports.length; i++) {
            var vm = buildReportVM(mission.reports[i], mission);
            if (vm) { result.push(vm); }
        }

        // Newest first, by createdAt desc, then id for stability.
        result.sort(function(a, b) {
            var ta = isNonEmptyString(a.createdAt)
                ? a.createdAt : '';
            var tb = isNonEmptyString(b.createdAt)
                ? b.createdAt : '';
            if (ta !== tb) {
                return tb.localeCompare(ta);
            }
            return String(a.id).localeCompare(String(b.id));
        });

        return result;
    }

    // ============================================================
    // SUPPORT PERSONNEL PROJECTION
    // ============================================================

    function buildSupportPersonnelVM(mission) {
        if (!mission || !Array.isArray(mission.supportPersonnel)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < mission.supportPersonnel.length; i++) {
            var id = mission.supportPersonnel[i];
            if (!isNonEmptyString(id)) { continue; }
            var ref = resolveCharacterRef(id);
            result.push(ref || { id: String(id), name: 'Unknown' });
        }

        result.sort(function(a, b) {
            return String(a.name).localeCompare(String(b.name));
        });

        return result;
    }

    // ============================================================
    // PARTICIPANT PROJECTION
    // ============================================================
    //
    // The detail panel's participant list, and the data the form's
    // participant panel needs. See the file header for VM shapes.

    function buildParticipantsVM(mission) {
        if (!mission) { return []; }

        var raw = MissionQueries.getParticipantsForMission(mission);
        var result = [];

        for (var i = 0; i < raw.length; i++) {
            var p = raw[i];

            var charRef = resolveCharacterRef(p.characterId);
            var name = charRef ? charRef.name : 'Unknown';
            var deceased = false;
            if (charRef) {
                var char = CharacterQueries.getCharacterById(p.characterId);
                deceased = char && char.deceased === true;
            }

            var teamRef = p.teamId ? resolveTeamRef(p.teamId) : null;

            var sourceLabel = 'Unknown';
            if (typeof MissionConstants.getParticipantSourceLabel ===
                'function') {
                var lbl = MissionConstants.getParticipantSourceLabel(
                    p.source
                );
                if (lbl) { sourceLabel = lbl; }
            }

            result.push({
                characterId: p.characterId,
                displayName: name,
                deceased: deceased,
                teamId: p.teamId,
                teamName: teamRef ? teamRef.name : null,
                source: p.source,
                sourceLabel: sourceLabel
            });
        }

        // Stable ordering: team participants sorted by team name
        // then by character name; rookies (teamId null) come last
        // within their own block, sorted by character name.
        result.sort(function(a, b) {
            if (a.teamId === null && b.teamId !== null) { return 1; }
            if (a.teamId !== null && b.teamId === null) { return -1; }
            if (a.teamId !== null && b.teamId !== null) {
                var tn = String(a.teamName || '')
                    .localeCompare(String(b.teamName || ''));
                if (tn !== 0) { return tn; }
            }
            return String(a.displayName || '')
                .localeCompare(String(b.displayName || ''));
        });

        return result;
    }

    // ============================================================
    // LOG PROJECTION
    // ============================================================

    function buildLogVM(mission) {
        if (!mission || !Array.isArray(mission.log)) {
            return [];
        }

        // Display order is newest first. Persistence order is
        // append order (oldest first). Presentation reverses.
        var result = [];
        for (var i = mission.log.length - 1; i >= 0; i--) {
            var entry = mission.log[i];
            if (!isPlainObject(entry)) { continue; }
            result.push({
                timestamp: entry.timestamp || null,
                timestampDisplay: MissionViews.formatTimestamp
                    ? MissionViews.formatTimestamp(entry.timestamp)
                    : '',
                message: entry.message || ''
            });
        }

        return result;
    }

    // ============================================================
    // OBJECTIVE PROJECTION
    // ============================================================

    function buildObjectivesVM(mission) {
        if (!mission || !Array.isArray(mission.objectives)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < mission.objectives.length; i++) {
            var obj = mission.objectives[i];
            if (!isPlainObject(obj)) { continue; }
            result.push({
                index: i,
                text: obj.text || '',
                done: obj.done === true
            });
        }
        return result;
    }

    // ============================================================
    // CAPABILITY FLAGS
    // ============================================================

    function buildCapabilitiesVM(mission) {
        return {
            edit: MissionRules.canEdit(mission),
            modifyObjectives:
                MissionRules.canModifyObjectives(mission),
            complete: MissionRules.canComplete(mission),
            cancel: MissionRules.canCancel(mission),
            reactivate: MissionRules.canReactivate(mission)
        };
    }

    // ============================================================
    // DATE DISPLAY
    // ============================================================

    function buildDateDisplay(mission) {
        if (!mission) { return 'Not specified'; }

        var hasYear = mission.year !== undefined &&
                      mission.year !== null;
        var hasMonth = mission.month !== undefined &&
                       mission.month !== null;
        var hasDay = mission.day !== undefined &&
                     mission.day !== null;

        if (hasYear && hasMonth && hasDay) {
            var monthNames = [
                'January', 'February', 'March', 'April', 'May',
                'June', 'July', 'August', 'September', 'October',
                'November', 'December'
            ];
            var monthName = monthNames[mission.month - 1] || '';
            return monthName + ' ' + mission.day + ', ' +
                mission.year;
        }

        if (hasYear) {
            return String(mission.year);
        }

        return 'Not specified';
    }

    // ============================================================
    // TYPE DISPLAY
    // ============================================================

    function buildTypeDisplay(mission) {
        var primary = MissionConstants.getMissionTypeLabel(
            mission.primaryType
        ) || '';
        var subtype = MissionConstants.getSubtypeLabel(
            mission.primaryType, mission.subtype
        ) || '';
        var secondary = MissionConstants.getMissionTypeLabel(
            mission.secondaryType
        ) || '';

        var parts = [];
        if (primary) {
            parts.push(primary);
            if (subtype) { parts.push(subtype); }
        }
        if (secondary) { parts.push(secondary); }

        if (parts.length === 0) {
            return 'Unclassified';
        }
        return parts.join(' | ');
    }

    // ============================================================
    // LIST VM
    // ============================================================

    function getMissionListViewModel(options) {
        options = options || {};

        var filter = isNonEmptyString(options.filter)
            ? options.filter
            : 'all';
        var search = isNonEmptyString(options.search)
            ? options.search.trim()
            : '';
        var teamId = isNonEmptyString(options.teamId)
            ? options.teamId
            : null;
        var typeId = isNonEmptyString(options.typeId)
            ? options.typeId
            : null;
        var sort = isNonEmptyString(options.sort)
            ? options.sort
            : 'date';
        var sortDirection = options.sortDirection === 'asc'
            ? 'asc'
            : 'desc';
        var includeArchived = options.includeArchived === true;

        var statusFilter = filter === 'all' ? null : filter;

        var missions = MissionQueries.getMissions(statusFilter, {
            includeArchived: includeArchived
        });

        var total = missions.length;
        var filtered = missions;

        if (teamId !== null) {
            var teamTarget = String(teamId);
            filtered = filtered.filter(function(m) {
                return MissionQueries.isMissionAssignedToTeam(
                    m, teamTarget
                );
            });
        }

        if (typeId !== null) {
            filtered = filtered.filter(function(m) {
                return m.primaryType === typeId ||
                       m.secondaryType === typeId;
            });
        }

        if (search !== '') {
            var term = search.toLowerCase();
            filtered = filtered.filter(function(m) {
                var label = MissionId.derive(m) || '';
                var title = typeof m.title === 'string'
                    ? m.title.toLowerCase()
                    : '';
                var location = typeof m.location === 'string'
                    ? m.location.toLowerCase()
                    : '';
                var description = typeof m.description === 'string'
                    ? m.description.toLowerCase()
                    : '';
                var labelLower = label.toLowerCase();
                return title.indexOf(term) !== -1 ||
                       location.indexOf(term) !== -1 ||
                       description.indexOf(term) !== -1 ||
                       labelLower.indexOf(term) !== -1;
            });
        }

        var items = filtered.map(function(m) {
            return buildListItemVM(m);
        });

        items.sort(buildListComparator(sort, sortDirection));

        var counts = buildStatusCounts(missions);

        return {
            missions: items,
            total: total,
            filtered: items.length,
            counts: counts
        };
    }

    function buildListItemVM(mission) {
        var statusInfo =
            MissionViews.getStatusInfo(mission.status);
        var priorityInfo =
            MissionViews.getPriorityInfo(mission.priority);
        var progress = MissionRules.calculateProgress(
            mission.objectives
        );
        var supportCount = Array.isArray(mission.supportPersonnel)
            ? mission.supportPersonnel.length
            : 0;
        var participantCount =
            MissionQueries.getParticipantsForMission(mission).length;

        // Resolve the assignment list. The scalar fields below are
        // derived from the first entry of the array so list rows
        // that only render one team keep working.
        var assignedTeams = resolveAssignedTeams(mission);
        var primaryTeam = assignedTeams.length > 0
            ? assignedTeams[0]
            : null;

        return {
            id: mission.id,
            missionId: MissionId.derive(mission) || '',
            title: mission.title || 'Untitled',

            status: mission.status,
            statusLabel: statusInfo.label,
            statusClass: statusInfo.class,

            priority: mission.priority,
            priorityLabel: priorityInfo.label,
            priorityClass: priorityInfo.class,

            difficulty: mission.difficulty,
            difficultyLabel: MissionConstants.getDifficultyLabel(
                mission.difficulty
            ) || '',

            progress: progress,

            // Multiple teams.
            assignedTeamIds: assignedTeams.map(function(t) {
                return t.id;
            }),
            assignedTeams: assignedTeams,
            assignedTeamCount: assignedTeams.length,

            // Singular compatibility (old shape). The FIRST team,
            // or null. Renderers that display every team read the
            // array above.
            teamId: primaryTeam ? primaryTeam.id : null,
            teamName: primaryTeam
                ? primaryTeam.name
                : 'Unassigned',

            supportCount: supportCount,
            participantCount: participantCount,

            location: mission.location || '',

            primaryType: mission.primaryType || '',
            primaryTypeLabel: MissionConstants.getMissionTypeLabel(
                mission.primaryType
            ) || '',
            subtype: mission.subtype || '',
            subtypeLabel: MissionConstants.getSubtypeLabel(
                mission.primaryType, mission.subtype
            ) || '',
            secondaryType: mission.secondaryType || '',
            secondaryTypeLabel:
                MissionConstants.getMissionTypeLabel(
                    mission.secondaryType
                ) || '',
            typeDisplay: buildTypeDisplay(mission),

            escalation: mission.escalation,
            escalationLabel: MissionConstants.getEscalationLabel(
                mission.escalation
            ) || '',

            dateDisplay: buildDateDisplay(mission),
            createdAt: mission.createdAt || '',
            archivedAt: mission.archivedAt || null,
            isArchived: mission.archivedAt !== undefined &&
                        mission.archivedAt !== null,

            isActive: mission.status === 'active',
            isCompleted: mission.status === 'completed',
            isCancelled: mission.status === 'cancelled',

            isReadyForCompletion:
                MissionRules.isReadyForCompletion(mission)
        };
    }

    function buildListComparator(sort, direction) {
        var sign = direction === 'asc' ? 1 : -1;

        return function(a, b) {
            var av;
            var bv;

            switch (sort) {
                case 'title':
                    av = a.title || '';
                    bv = b.title || '';
                    break;

                case 'priority':
                    var priorityOrder = {
                        'critical': 0,
                        'high': 1,
                        'medium': 2,
                        'low': 3
                    };
                    av = priorityOrder[a.priority];
                    bv = priorityOrder[b.priority];
                    if (av === undefined) { av = 999; }
                    if (bv === undefined) { bv = 999; }
                    break;

                case 'status':
                    var statusOrder = {
                        'active': 0,
                        'completed': 1,
                        'cancelled': 2
                    };
                    av = statusOrder[a.status];
                    bv = statusOrder[b.status];
                    if (av === undefined) { av = 999; }
                    if (bv === undefined) { bv = 999; }
                    break;

                case 'progress':
                    av = isFiniteNumber(a.progress) ? a.progress : 0;
                    bv = isFiniteNumber(b.progress) ? b.progress : 0;
                    break;

                case 'date':
                default:
                    av = a.createdAt || '';
                    bv = b.createdAt || '';
                    break;
            }

            if (typeof av === 'string' && typeof bv === 'string') {
                var result = av.localeCompare(bv);
                if (result !== 0) { return result * sign; }
                return String(a.id).localeCompare(String(b.id));
            }

            if (av < bv) { return -1 * sign; }
            if (av > bv) { return 1 * sign; }
            return String(a.id).localeCompare(String(b.id));
        };
    }

    function buildStatusCounts(missions) {
        var counts = {
            total: missions.length,
            active: 0,
            completed: 0,
            cancelled: 0,
            readyForCompletion: 0
        };
        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m.status === 'active') { counts.active++; }
            else if (m.status === 'completed') { counts.completed++; }
            else if (m.status === 'cancelled') { counts.cancelled++; }

            if (MissionRules.isReadyForCompletion(m)) {
                counts.readyForCompletion++;
            }
        }
        return counts;
    }

    // ============================================================
    // DETAIL VM
    // ============================================================

    function getMissionDetailViewModel(missionId) {
        var mission = MissionQueries.getMission(missionId);
        if (!mission) { return null; }

        var statusInfo =
            MissionViews.getStatusInfo(mission.status);
        var priorityInfo =
            MissionViews.getPriorityInfo(mission.priority);
        var progress = MissionRules.calculateProgress(
            mission.objectives
        );

        var supportPersonnel = buildSupportPersonnelVM(mission);
        var participants = buildParticipantsVM(mission);
        var reports = buildReportsVM(mission);
        var log = buildLogVM(mission);
        var objectives = buildObjectivesVM(mission);
        var capabilities = buildCapabilitiesVM(mission);

        var assignedTeams = resolveAssignedTeams(mission);
        var primaryTeam = assignedTeams.length > 0
            ? assignedTeams[0]
            : null;

        return {
            id: mission.id,
            missionId: MissionId.derive(mission) || '',
            title: mission.title || 'Untitled',
            description: mission.description || '',

            dateDisplay: buildDateDisplay(mission),
            year: mission.year !== undefined ? mission.year : null,
            month: mission.month !== undefined
                ? mission.month : null,
            day: mission.day !== undefined ? mission.day : null,
            sequence: mission.sequence,

            status: mission.status,
            statusLabel: statusInfo.label,
            statusClass: statusInfo.class,

            priority: mission.priority,
            priorityLabel: priorityInfo.label,
            priorityClass: priorityInfo.class,

            difficulty: mission.difficulty,
            difficultyLabel: MissionConstants.getDifficultyLabel(
                mission.difficulty
            ) || '',

            primaryType: mission.primaryType || '',
            primaryTypeLabel: MissionConstants.getMissionTypeLabel(
                mission.primaryType
            ) || '',
            subtype: mission.subtype || '',
            subtypeLabel: MissionConstants.getSubtypeLabel(
                mission.primaryType, mission.subtype
            ) || '',
            secondaryType: mission.secondaryType || '',
            secondaryTypeLabel:
                MissionConstants.getMissionTypeLabel(
                    mission.secondaryType
                ) || '',
            typeDisplay: buildTypeDisplay(mission),

            escalation: mission.escalation,
            escalationLabel: MissionConstants.getEscalationLabel(
                mission.escalation
            ) || '',

            threatType: mission.threatType || '',
            environment: mission.environment || '',
            location: mission.location || '',
            duration: mission.duration || '',

            billing: mission.billing,
            billingLabel: MissionConstants.getBillingLabel(
                mission.billing
            ) || '',

            basePay: mission.basePay || '',
            surchargePay: mission.surchargePay || '',
            pay: mission.pay || '',

            // Multiple teams.
            assignedTeamIds: assignedTeams.map(function(t) {
                return t.id;
            }),
            assignedTeams: assignedTeams,
            assignedTeamCount: assignedTeams.length,

            // Singular compatibility (old shape). The FIRST team,
            // or null.
            teamId: primaryTeam ? primaryTeam.id : null,
            teamName: primaryTeam
                ? primaryTeam.name
                : 'Unassigned',

            supportPersonnel: supportPersonnel,
            supportCount: supportPersonnel.length,

            participants: participants,
            participantCount: participants.length,

            objectives: objectives,
            progress: progress,

            reports: reports,
            reportCount: reports.length,

            log: log,
            logCount: log.length,

            tags: Array.isArray(mission.tags)
                ? mission.tags.slice() : [],

            notes: mission.notes || '',

            createdAt: mission.createdAt || null,
            createdAtDisplay: MissionViews.formatTimestamp
                ? MissionViews.formatTimestamp(mission.createdAt)
                : '',
            completedAt: mission.completedAt || null,
            completedAtDisplay: MissionViews.formatTimestamp
                ? MissionViews.formatTimestamp(mission.completedAt)
                : '',
            archivedAt: mission.archivedAt || null,
            archivedAtDisplay: MissionViews.formatTimestamp
                ? MissionViews.formatTimestamp(mission.archivedAt)
                : '',

            isActive: mission.status === 'active',
            isCompleted: mission.status === 'completed',
            isCancelled: mission.status === 'cancelled',
            isArchived: mission.archivedAt !== undefined &&
                        mission.archivedAt !== null,
            isReadyForCompletion: capabilities.complete,

            capabilities: capabilities,

            graduatingClassId: mission.graduatingClassId || null,
            classFilterEnabled:
                mission.classFilterEnabled === true
        };
    }

    // ============================================================
    // FORM VM
    // ============================================================

    /**
     * Build the form view model for creating or editing a mission.
     *
     * The form does NOT preview the mission label. The label is a
     * derived value computed at read time by MissionId.derive from
     * (year, sequence, difficulty). On edit VMs, `currentLabel`
     * carries the current derived label for display only. On create
     * VMs, `currentLabel` is null.
     *
     * MULTIPLE TEAMS:
     *   `mission.assignedTeamIds` (array) is carried on the VM. The
     *   singular `mission.assignedTeamId` field is not present on
     *   the VM. Form renderers read the array.
     *
     *   `teamOptions` is the flat list of eligible teams the form
     *   can add. It does NOT include the currently-assigned teams;
     *   the renderer is expected to filter the current assignment
     *   out of the addable list.
     *
     * DATE DEFAULTS:
     *   `defaults.year` is the APPLICATION year (window.data
     *   .currentYear), falling back to the calendar year only when
     *   the application year is unavailable. Month and day are
     *   fixed at 1. The UI layer may reset untouched month/day
     *   when the year input changes.
     */
    function getMissionFormViewModel(options) {
        options = options || {};

        var editId = isNonEmptyString(options.editId)
            ? options.editId
            : null;

        var mission = editId
            ? MissionQueries.getMission(editId)
            : null;
        if (editId && !mission) {
            return null;
        }

        var isEdit = mission !== null;

        var teams = MissionRules.filterEligibleTeams(
            TeamQueries.getTeams ? TeamQueries.getTeams() : []
        );

        var teamOptions = teams.map(function(t) {
            return {
                id: t.id,
                name: isNonEmptyString(t.name)
                    ? t.name : 'Unnamed Team'
            };
        });
        teamOptions.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        var charactersRaw = CharacterQueries.getCharacters
            ? CharacterQueries.getCharacters()
            : [];
        var characterOptions = [];
        for (var i = 0; i < charactersRaw.length; i++) {
            var c = charactersRaw[i];
            if (!c || !c.id) { continue; }
            characterOptions.push({
                id: c.id,
                name: CharacterQueries.getDisplayName(c)
            });
        }
        characterOptions.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        var difficulties = MissionConstants.getValidDifficulties()
            .map(function(id) {
                return {
                    id: id,
                    label: MissionConstants.getDifficultyLabel(id)
                };
            });

        var priorities = MissionConstants.getValidPriorities()
            .map(function(id) {
                return {
                    id: id,
                    label: MissionConstants.getPriorityLabel(id)
                };
            });

        var statuses = MissionConstants.getValidStatuses()
            .map(function(id) {
                return {
                    id: id,
                    label: MissionConstants.getStatusLabel(id)
                };
            });

        var billingTypes = MissionConstants.getValidBillingTypes()
            .map(function(id) {
                return {
                    id: id,
                    label: MissionConstants.getBillingLabel(id)
                };
            });

        var escalationTiers =
            MissionConstants.getValidEscalationTiers()
            .map(function(id) {
                return {
                    id: id,
                    label: MissionConstants.getEscalationLabel(id)
                };
            });

        var missionTypes = MissionConstants.getMissionTypes();
        var typeList = Object.keys(missionTypes).map(function(key) {
            return missionTypes[key];
        });

        var currentLabel = isEdit
            ? MissionId.derive(mission)
            : null;

        return {
            isEdit: isEdit,
            editId: editId,

            mission: mission
                ? buildFormMissionFields(mission)
                : null,
            currentLabel: currentLabel,

            teams: teamOptions,
            characters: characterOptions,

            difficulties: difficulties,
            priorities: priorities,
            statuses: statuses,
            billingTypes: billingTypes,
            escalationTiers: escalationTiers,
            missionTypes: typeList,

            defaults: {
                year: getApplicationYear(),
                month: 1,
                day: 1
            }
        };
    }

    function buildFormMissionFields(mission) {
        return {
            id: mission.id,
            title: mission.title || '',
            description: mission.description || '',
            year: mission.year !== undefined
                ? mission.year : null,
            month: mission.month !== undefined
                ? mission.month : null,
            day: mission.day !== undefined
                ? mission.day : null,
            primaryType: mission.primaryType || '',
            subtype: mission.subtype || '',
            secondaryType: mission.secondaryType || '',
            escalation: mission.escalation || '',
            threatType: mission.threatType || '',
            environment: mission.environment || '',
            location: mission.location || '',
            duration: mission.duration || '',
            difficulty: mission.difficulty || '',
            priority: mission.priority || '',
            basePay: mission.basePay || '',
            surchargePay: mission.surchargePay || '',
            billing: mission.billing || '',
            assignedTeamIds:
                MissionQueries.getTeamIdsForMission(mission),
            supportPersonnel: Array.isArray(
                mission.supportPersonnel
            )
                ? mission.supportPersonnel.slice()
                : [],
            participants: Array.isArray(mission.participants)
                ? mission.participants.map(function(p) {
                    if (!isPlainObject(p)) { return p; }
                    return {
                        characterId: p.characterId,
                        teamId: p.teamId !== undefined
                            ? p.teamId
                            : null,
                        source: p.source
                    };
                })
                : [],
            status: mission.status || '',
            objectives: buildObjectivesVM(mission),
            notes: mission.notes || '',
            tags: Array.isArray(mission.tags)
                ? mission.tags.slice()
                : [],
            classFilterEnabled:
                mission.classFilterEnabled === true
        };
    }

    // ============================================================
    // PARTICIPANTS VM
    // ============================================================
    //
    // See the file header for the full shape.
    //
    // The panel renders one section per assigned team, with a
    // checkbox per active member at the mission's year. The
    // checkbox is checked when the (character, team) pair already
    // appears in participants.
    //
    // The mission's year is the mission's own `year` when set,
    // else the application year. Using the mission's year (not the
    // application year) is deliberate: a mission in 1930 should
    // list the team's 1930 membership, not the 2026 membership.

    function getParticipantsViewModel(missionId) {
        if (!isNonEmptyString(missionId)) {
            return null;
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return null;
        }

        var missionYear = resolveMissionYear(mission);
        var assignedTeamIds =
            MissionQueries.getTeamIdsForMission(mission);

        var assignedTeamsVM = [];

        for (var t = 0; t < assignedTeamIds.length; t++) {
            var teamId = assignedTeamIds[t];
            var team = null;
            try {
                team = TeamQueries.getTeamById(teamId);
            } catch (e) {
                team = null;
            }

            var teamName = team && isNonEmptyString(team.name)
                ? team.name
                : 'Unknown Team';

            var members = [];
            if (team) {
                var activeMembers = [];
                try {
                    activeMembers = TeamQueries.getActiveTeamMembers(
                        team, missionYear
                    ) || [];
                } catch (e) {
                    activeMembers = [];
                }

                for (var m = 0; m < activeMembers.length; m++) {
                    var member = activeMembers[m];
                    if (!member || !member.characterId) { continue; }

                    var charId = String(member.characterId);
                    var charRef = resolveCharacterRef(charId);

                    var deceased = false;
                    if (charRef && charRef.id) {
                        var charRecord =
                            CharacterQueries.getCharacterById(charId);
                        deceased = charRecord &&
                            charRecord.deceased === true;
                    }

                    var isParticipant =
                        MissionQueries.isParticipantInMission(
                            mission, charId, teamId
                        );

                    members.push({
                        characterId: charId,
                        displayName: charRef ? charRef.name : 'Unknown',
                        role: isNonEmptyString(member.role)
                            ? member.role : 'Member',
                        deceased: deceased,
                        isParticipant: isParticipant
                    });
                }
            }

            members.sort(function(a, b) {
                return String(a.displayName || '')
                    .localeCompare(String(b.displayName || ''));
            });

            assignedTeamsVM.push({
                teamId: teamId,
                teamName: teamName,
                members: members
            });
        }

        // Current participant entries, resolved to display shape.
        var currentParticipants = buildParticipantsVM(mission);

        return {
            missionId: String(mission.id),
            missionTitle: isNonEmptyString(mission.title)
                ? mission.title
                : 'Mission',
            missionYear: missionYear,
            assignedTeams: assignedTeamsVM,
            currentParticipants: currentParticipants
        };
    }

    // ============================================================
    // ROOKIE CANDIDATES VM
    // ============================================================
    //
    // See the file header for the full shape.
    //
    // A candidate is any character who has ever held a 'rookie'
    // career status and is not a filler. The list is sorted
    // alphabetically by display name.
    //
    // Each candidate carries three flags the UI reads:
    //
    //   deceased         the character is marked deceased
    //   isParticipant    already added as a rookie participant
    //   onAssignedTeam   already a member of one of the mission's
    //                    assigned teams (i.e. they belong in the
    //                    team-member panel, not the rookie panel)
    //
    // The UI decides how to render each combination. The aggregator
    // does not filter candidates out; filtering is a presentation
    // choice and belongs to the renderer.

    function getRookieCandidatesViewModel(missionId) {
        if (!isNonEmptyString(missionId)) {
            return null;
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return null;
        }

        var missionYear = resolveMissionYear(mission);
        var assignedTeamIds =
            MissionQueries.getTeamIdsForMission(mission);

        // Build the set of characters who are on any of the
        // mission's assigned teams at the mission's year.
        var onAssignedTeamSet = Object.create(null);
        for (var t = 0; t < assignedTeamIds.length; t++) {
            var teamId = assignedTeamIds[t];
            var team = null;
            try {
                team = TeamQueries.getTeamById(teamId);
            } catch (e) {
                team = null;
            }
            if (!team) { continue; }

            var activeMembers = [];
            try {
                activeMembers = TeamQueries.getActiveTeamMembers(
                    team, missionYear
                ) || [];
            } catch (e) {
                activeMembers = [];
            }
            for (var m = 0; m < activeMembers.length; m++) {
                var member = activeMembers[m];
                if (!member || !member.characterId) { continue; }
                onAssignedTeamSet[String(member.characterId)] = true;
            }
        }

        // Build the set of characters already added as rookie
        // participants on this mission.
        var currentParticipants =
            MissionQueries.getParticipantsForMission(mission);
        var rookieParticipantSet = Object.create(null);
        for (var p = 0; p < currentParticipants.length; p++) {
            if (currentParticipants[p].source === 'rookie') {
                rookieParticipantSet[
                    currentParticipants[p].characterId
                ] = true;
            }
        }

        var allChars = [];
        try {
            allChars = CharacterQueries.getCharacters() || [];
        } catch (e) {
            allChars = [];
        }

        var candidates = [];

        for (var c = 0; c < allChars.length; c++) {
            var char = allChars[c];
            if (!char || !char.id) { continue; }

            if (!hasEverBeenRookie(char)) { continue; }

            var charId = String(char.id);
            var name = '';
            try {
                name = CharacterQueries.getDisplayName(char) || '';
            } catch (e) {
                name = '';
            }
            if (name === '') { name = charId; }

            candidates.push({
                characterId: charId,
                displayName: name,
                deceased: char.deceased === true,
                isParticipant:
                    rookieParticipantSet[charId] === true,
                onAssignedTeam:
                    onAssignedTeamSet[charId] === true
            });
        }

        candidates.sort(function(a, b) {
            return String(a.displayName || '')
                .localeCompare(String(b.displayName || ''));
        });

        return {
            missionId: String(mission.id),
            missionTitle: isNonEmptyString(mission.title)
                ? mission.title
                : 'Mission',
            missionYear: missionYear,
            candidates: candidates
        };
    }

    // ============================================================
    // REPORT AUTHOR OPTIONS VM
    // ============================================================

    function getReportAuthorOptionsViewModel(missionId) {
        if (!isNonEmptyString(missionId)) {
            return null;
        }

        var mission = MissionQueries.getMission(missionId);
        if (!mission) {
            return null;
        }

        var assignedTeamIds =
            MissionQueries.getTeamIdsForMission(mission);

        var teamMemberIdSet = Object.create(null);
        var applicationYear = getApplicationYearOrNull();

        for (var t = 0; t < assignedTeamIds.length; t++) {
            var teamId = assignedTeamIds[t];
            var team = null;
            try {
                team = TeamQueries.getTeamById(teamId);
            } catch (e) {
                team = null;
            }
            if (!team) { continue; }

            var members = [];

            if (applicationYear !== null) {
                try {
                    members = TeamQueries.getActiveTeamMembers(
                        team, applicationYear
                    ) || [];
                } catch (e) {
                    members = [];
                }
            } else {
                members = Array.isArray(team.members)
                    ? team.members
                    : [];
            }

            for (var m = 0; m < members.length; m++) {
                var member = members[m];
                if (!member || !member.characterId) { continue; }
                var memberId = String(member.characterId);
                teamMemberIdSet[memberId] = true;
            }
        }

        var allChars = [];
        try {
            allChars = CharacterQueries.getCharacters() || [];
        } catch (e) {
            allChars = [];
        }

        var teamMembers = [];
        var otherCharacters = [];

        for (var c = 0; c < allChars.length; c++) {
            var char = allChars[c];
            if (!char || !char.id) { continue; }

            // Filler placeholders are never report authors.
            if (char.isFiller === true) { continue; }

            var charId = String(char.id);
            var name = '';
            try {
                name = CharacterQueries.getDisplayName(char) || '';
            } catch (e) {
                name = '';
            }
            if (name === '') { name = charId; }

            var deceased = char.deceased === true;

            var option = {
                id: charId,
                name: name,
                deceased: deceased
            };

            if (teamMemberIdSet[charId]) {
                teamMembers.push(option);
            } else {
                otherCharacters.push(option);
            }
        }

        teamMembers.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });
        otherCharacters.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return {
            missionId: String(mission.id),
            missionTitle: isNonEmptyString(mission.title)
                ? mission.title
                : 'Mission',
            teamMembers: teamMembers,
            otherCharacters: otherCharacters
        };
    }

    // ============================================================
    // STATISTICS VM
    // ============================================================

    function getMissionStatisticsViewModel() {
        var stats = MissionQueries.getStatistics();

        var total = stats.total;
        var completed = stats.completed;

        return {
            total: total,
            active: stats.active,
            completed: completed,
            cancelled: stats.cancelled,
            archived: stats.archived,
            byPriority: stats.byPriority,
            byDifficulty: stats.byDifficulty,
            completionRate: total > 0
                ? Math.round((completed / total) * 100)
                : 0,
            activeRate: total > 0
                ? Math.round((stats.active / total) * 100)
                : 0
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionAggregator = Object.freeze({
        getMissionListViewModel: getMissionListViewModel,
        getMissionDetailViewModel: getMissionDetailViewModel,
        getMissionFormViewModel: getMissionFormViewModel,
        getMissionStatisticsViewModel: getMissionStatisticsViewModel,
        getReportAuthorOptionsViewModel:
            getReportAuthorOptionsViewModel,
        getParticipantsViewModel: getParticipantsViewModel,
        getRookieCandidatesViewModel: getRookieCandidatesViewModel
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionAggregator;
        var missing = [];

        var required = [
            'getMissionListViewModel',
            'getMissionDetailViewModel',
            'getMissionFormViewModel',
            'getMissionStatisticsViewModel',
            'getReportAuthorOptionsViewModel',
            'getParticipantsViewModel',
            'getRookieCandidatesViewModel'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke test: rookie detection.
        try {
            if (hasEverBeenRookie({
                careerStatus: [{ status: 'rookie' }]
            }) !== true) {
                missing.push('hasEverBeenRookie did not accept a rookie');
            }
            if (hasEverBeenRookie({
                careerStatus: [{ status: 'Rookie' }]
            }) !== true) {
                missing.push('hasEverBeenRookie did not handle case');
            }
            if (hasEverBeenRookie({
                careerStatus: [{ status: 'rookie (Former)' }]
            }) !== true) {
                missing.push('hasEverBeenRookie did not accept former');
            }
            if (hasEverBeenRookie({
                careerStatus: [{ status: 'junior' }]
            }) !== false) {
                missing.push('hasEverBeenRookie accepted a junior');
            }
            if (hasEverBeenRookie({
                isFiller: true,
                careerStatus: [{ status: 'rookie' }]
            }) !== false) {
                missing.push('hasEverBeenRookie accepted a filler');
            }
            if (hasEverBeenRookie({}) !== false) {
                missing.push('hasEverBeenRookie accepted an empty record');
            }
        } catch (e) {
            missing.push('rookie smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionAggregator] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();