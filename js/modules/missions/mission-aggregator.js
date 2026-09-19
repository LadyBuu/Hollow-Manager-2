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
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Reads, mutations, structural validation, domain rules, or
 *     presentation vocabulary. Each of those lives in its own
 *     module (MissionQueries, MissionCore, MissionSchema,
 *     MissionRules, MissionViews respectively). This module calls
 *     them and composes their results.
 *   - The mission label's grammar. MissionId owns the grammar and
 *     the derivation. This module attaches the derived label to
 *     VMs; it does not compute it.
 *
 * VM SHAPE PRINCIPLES:
 *   - Every VM is a plain data structure. No functions, no live
 *     references to mission, team, or character records.
 *   - Every reference to a cross-domain entity is either an ID or
 *     a resolved { id, name } pair. Never the whole entity.
 *   - Derived values (missionId, progress, pay, capability flags)
 *     are present on VMs so renderers never compute them.
 *   - Missing or unresolvable references resolve to `null` or an
 *     explicit "Unknown"/"Unassigned" string, not to fabricated
 *     entity IDs.
 *
 * LABEL SEMANTICS:
 *   The mission label (YEAR-SEQ-DIFFICULTY) is a DERIVED value.
 *   It is never stored, and the form layer does not preview it.
 *   On an edit VM, the current label is exposed as `currentLabel`
 *   for display only; the form does not offer it as an input.
 *   Changing year or difficulty re-derives the label at read time;
 *   the stored `sequence` is frozen at creation and never changes.
 *
 * DATE DEFAULTS:
 *   The form VM's date defaults are (currentYear, 1, 1). The
 *   current calendar year is the only "now"-dependent value; month
 *   and day are the fixed start of the year. The UI layer may
 *   reset untouched month/day when the year input changes; the
 *   aggregator does not do that — it just supplies the initial
 *   defaults.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.MissionQueries
 *   - window.MissionConstants
 *   - window.MissionId
 *   - window.MissionRules
 *   - window.MissionViews
 *   - window.CharacterQueries
 *   - window.TeamQueries
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
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionAggregatorLoaded = true;

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

    // ============================================================
    // ENTITY RESOLUTION
    // ============================================================
    //
    // Cross-domain lookups. Each resolver returns a small
    // { id, name } projection or null. It never returns the raw
    // entity.

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
            name: isNonEmptyString(team.name) ? team.name : 'Unnamed Team'
        };
    }

    function resolveTeamNameOrUnassigned(teamId) {
        if (!isNonEmptyString(teamId)) {
            return 'Unassigned';
        }
        var ref = resolveTeamRef(teamId);
        return ref ? ref.name : 'Unknown Team';
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
            var ta = isNonEmptyString(a.createdAt) ? a.createdAt : '';
            var tb = isNonEmptyString(b.createdAt) ? b.createdAt : '';
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
    // LOG PROJECTION
    // ============================================================

    function buildLogVM(mission) {
        if (!mission || !Array.isArray(mission.log)) {
            return [];
        }

        // Display order is newest first. The persistence order is
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
    //
    // Delegated to MissionRules. This module does not re-implement
    // any rule.

    function buildCapabilitiesVM(mission) {
        return {
            edit: MissionRules.canEdit(mission),
            modifyObjectives: MissionRules.canModifyObjectives(mission),
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

        var hasYear = mission.year !== undefined && mission.year !== null;
        var hasMonth = mission.month !== undefined && mission.month !== null;
        var hasDay = mission.day !== undefined && mission.day !== null;

        if (hasYear && hasMonth && hasDay) {
            var monthNames = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November',
                'December'
            ];
            var monthName = monthNames[mission.month - 1] || '';
            return monthName + ' ' + mission.day + ', ' + mission.year;
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

    /**
     * Build the list view model.
     *
     * @param {object} [options]
     * @param {string} [options.filter] - 'all' | 'active' |
     *   'completed' | 'cancelled'
     * @param {string} [options.search] - free-text search
     * @param {string} [options.teamId] - filter by assigned team
     * @param {string} [options.typeId] - filter by mission type
     * @param {string} [options.sort] - 'date' | 'title' | 'priority'
     *   | 'status' | 'progress'
     * @param {string} [options.sortDirection] - 'asc' | 'desc'
     * @param {boolean} [options.includeArchived]
     * @returns {object} { missions, total, filtered, counts }
     */
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
                return m.assignedTeamId !== undefined &&
                       m.assignedTeamId !== null &&
                       String(m.assignedTeamId) === teamTarget;
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

        // Counts are computed against the status-filtered set, before
        // team/type/search filtering, so the sidebar shows "how many
        // are active" independent of the current search.
        var counts = buildStatusCounts(missions);

        return {
            missions: items,
            total: total,
            filtered: items.length,
            counts: counts
        };
    }

    function buildListItemVM(mission) {
        var statusInfo = MissionViews.getStatusInfo(mission.status);
        var priorityInfo = MissionViews.getPriorityInfo(mission.priority);
        var progress = MissionRules.calculateProgress(mission.objectives);
        var supportCount = Array.isArray(mission.supportPersonnel)
            ? mission.supportPersonnel.length
            : 0;

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

            teamId: mission.assignedTeamId || null,
            teamName: resolveTeamNameOrUnassigned(mission.assignedTeamId),

            supportCount: supportCount,

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
            secondaryTypeLabel: MissionConstants.getMissionTypeLabel(
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

            isReadyForCompletion: MissionRules.isReadyForCompletion(
                mission
            )
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

    /**
     * Build the detail view model for a single mission.
     *
     * @param {string} missionId - Mission UUID
     * @returns {object|null}
     */
    function getMissionDetailViewModel(missionId) {
        var mission = MissionQueries.getMission(missionId);
        if (!mission) { return null; }

        var statusInfo = MissionViews.getStatusInfo(mission.status);
        var priorityInfo = MissionViews.getPriorityInfo(mission.priority);
        var progress = MissionRules.calculateProgress(mission.objectives);

        var supportPersonnel = buildSupportPersonnelVM(mission);
        var reports = buildReportsVM(mission);
        var log = buildLogVM(mission);
        var objectives = buildObjectivesVM(mission);
        var capabilities = buildCapabilitiesVM(mission);

        var teamRef = resolveTeamRef(mission.assignedTeamId);

        return {
            id: mission.id,
            missionId: MissionId.derive(mission) || '',
            title: mission.title || 'Untitled',
            description: mission.description || '',

            dateDisplay: buildDateDisplay(mission),
            year: mission.year !== undefined ? mission.year : null,
            month: mission.month !== undefined ? mission.month : null,
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
            secondaryTypeLabel: MissionConstants.getMissionTypeLabel(
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

            teamId: mission.assignedTeamId || null,
            teamName: teamRef ? teamRef.name : 'Unassigned',

            supportPersonnel: supportPersonnel,
            supportCount: supportPersonnel.length,

            objectives: objectives,
            progress: progress,

            reports: reports,
            reportCount: reports.length,

            log: log,
            logCount: log.length,

            tags: Array.isArray(mission.tags) ? mission.tags.slice() : [],

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
            classFilterEnabled: mission.classFilterEnabled === true
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
     * (year, sequence, difficulty); sequence is assigned at creation
     * and never changes. On edit VMs, `currentLabel` carries the
     * current derived label for display only. On create VMs,
     * `currentLabel` is null.
     *
     * DATE DEFAULTS:
     *   `defaults` supplies the initial (year, month, day) for a new
     *   mission: current calendar year, January, 1st. The UI layer
     *   decides whether to reset month/day when the year changes;
     *   the aggregator only supplies the starting values.
     *
     * @param {object} [options]
     * @param {string} [options.editId] - Mission UUID to edit
     * @returns {object|null}
     */
    function getMissionFormViewModel(options) {
        options = options || {};

        var editId = isNonEmptyString(options.editId)
            ? options.editId
            : null;

        var mission = editId ? MissionQueries.getMission(editId) : null;
        if (editId && !mission) {
            return null;
        }

        var isEdit = mission !== null;

        // Teams eligible for assignment.
        var teams = MissionRules.filterEligibleTeams(
            TeamQueries.getTeams ? TeamQueries.getTeams() : []
        );

        var teamOptions = teams.map(function(t) {
            return {
                id: t.id,
                name: isNonEmptyString(t.name) ? t.name : 'Unnamed Team'
            };
        });
        teamOptions.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        // Characters available for support personnel.
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

        // Enum lists.
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

        var escalationTiers = MissionConstants.getValidEscalationTiers()
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

        // currentLabel is a DISPLAY-ONLY field: the derived label for
        // an existing mission, or null on create. The form does not
        // offer it as an input, and MissionCore recomputes the label
        // from stored fields on every read.
        var currentLabel = isEdit ? MissionId.derive(mission) : null;

        var now = new Date();

        return {
            isEdit: isEdit,
            editId: editId,

            mission: mission ? buildFormMissionFields(mission) : null,
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
                year: now.getFullYear(),
                month: 1,
                day: 1
            }
        };
    }

    /**
     * Project the fields the form needs from an existing mission.
     * Does not expose the whole record.
     */
    function buildFormMissionFields(mission) {
        return {
            id: mission.id,
            title: mission.title || '',
            description: mission.description || '',
            year: mission.year !== undefined ? mission.year : null,
            month: mission.month !== undefined ? mission.month : null,
            day: mission.day !== undefined ? mission.day : null,
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
            assignedTeamId: mission.assignedTeamId || null,
            supportPersonnel: Array.isArray(mission.supportPersonnel)
                ? mission.supportPersonnel.slice()
                : [],
            status: mission.status || '',
            objectives: buildObjectivesVM(mission),
            notes: mission.notes || '',
            tags: Array.isArray(mission.tags) ? mission.tags.slice() : [],
            classFilterEnabled: mission.classFilterEnabled === true
        };
    }

    // ============================================================
    // STATISTICS VM
    // ============================================================

    /**
     * Statistics VM for dashboard display.
     */
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
        getMissionStatisticsViewModel: getMissionStatisticsViewModel
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
            'getMissionStatisticsViewModel'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionAggregator] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();