/**
 * js/modules/academy/academy-calendar-aggregator.js
 * Academy Calendar Aggregator
 *
 * Path: js/modules/academy/academy-calendar-aggregator.js
 *
 * Projector-backed schedule projections for the Academy domain.
 *
 * WHAT THIS OWNS:
 *   Producing schedule view models for students, instructors,
 *   locations, classes, and disciplines from the
 *   AcademyTeachingProjector. Every VM is shaped for
 *   CalendarRenderer.renderGrid.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Storage. Reads go through the projector.
 *   - Writes. Schedule mutations are owned by AcademySchedule.
 *   - Collisions. AcademyTeachingCollisions owns them.
 *   - Rendering. CalendarRenderer owns that.
 *   - The `slot.label` field. Every slot descriptor carries
 *     `label: ''`. The field exists for a caller that wants to
 *     stamp a user-authored label onto a slot; the aggregator does
 *     not invent one. CalendarRenderer derives the visible text
 *     from the rest of the descriptor (discipline, group,
 *     instructor). If a future caller needs to render a label,
 *     it should compute one and write it in a view-model post-
 *     processing step, not here.
 *
 * ARCHITECTURE:
 *
 *     AcademyTeachingProjector
 *         ↓  projectWeek / projectForStudent / projectForInstructor /
 *            projectForLocation / projectForClass /
 *            projectForClassDiscipline
 *         ↓  flat Occurrence[]
 *         ↓
 *     AcademyCalendarAggregator   (this module)
 *         ↓  schedule VMs shaped for CalendarRenderer
 *         ↓
 *     CalendarRenderer.renderGrid
 *         ↓  HTML
 *
 * ERROR POLICY:
 *   The projector is a mandatory dependency. If it throws, or if
 *   it returns something that is not an array, the aggregator
 *   returns `null` for that VM. It does NOT return an empty
 *   schedule.
 *
 *   The distinction matters:
 *
 *     entity exists, no occurrences   → VM with `schedule: {}`.
 *     projector threw                 → null.
 *     projector returned garbage      → null.
 *
 *   A projector failure is not "the calendar is empty." It is a
 *   bug in the projector (or a broken occurrence in its input),
 *   and the caller should be able to distinguish it. Converting it
 *   into an empty VM would make a broken projector look like a
 *   quiet week.
 *
 *   The same policy applies to the location display-name lookup:
 *   if AcademyLocations.getLocationName throws, the exception
 *   propagates. It is not silently converted into "use the ID."
 *
 * REST DAYS:
 *   class.restDays and class.restDaysByWeek are stored and
 *   validated by AcademyClasses. This module reads the week's
 *   effective rest days via AcademyClasses.getRestDaysForWeek and
 *   copies the result onto the VM.
 *
 *   The location grid does NOT inherit class rest days (a room is
 *   a resource, not a class member).
 *
 *   The discipline grid DOES inherit class rest days, because a
 *   discipline grid is class-scoped.
 *
 * VM SHAPE (consumed by CalendarRenderer.renderGrid):
 *   {
 *     schedule:   { day: { hour: slotDescriptor } },
 *     restDays:   [number],
 *     entityName: string,
 *     modeLabel:  string,
 *     hours:      [number]
 *   }
 *
 *   slotDescriptor:
 *     {
 *       disciplineId:    string | null,
 *       disciplineName:  string,
 *       duration:        number,
 *       label:           string,          // always ''
 *       groupLabel:      string,
 *       groupColorIndex: number | null,
 *       instructorId:    string | null,
 *       instructorName:  string,
 *       classId:         string | null,
 *       className:       string,
 *       groupId:         string | null,
 *       sessionId:       string | null,
 *       coOccupants:     [coOccupantDescriptor, ...],
 *       isContinuation:  boolean
 *     }
 *
 *   coOccupantDescriptor:
 *     {
 *       groupId:         string | null,
 *       groupLabel:      string,
 *       colorIndex:      number | null,
 *       disciplineName:  string,
 *       instructorName:  string,
 *       sessionId:       string | null,
 *       duration:        number
 *     }
 *
 * CO-OCCUPANCY:
 *   The pivot writes the first occurrence at a (day, hour) into the
 *   cell's slot descriptor. Every subsequent occurrence at that
 *   cell that is not a continuation of the same session is appended
 *   to `slot.coOccupants`.
 *
 *   A co-occupant means two or more occurrences share a cell. On a
 *   location grid it means two groups share the room. On a student
 *   or instructor grid it means a double-booking. On a class or
 *   discipline grid it means two groups meeting at the same slot.
 *   The aggregator reports what the projector returned; the
 *   semantic answer ("is this a conflict?") belongs to
 *   AcademyTeachingCollisions.
 *
 * GROUP LABELS:
 *   Every teaching group has a display name. The name comes from
 *   the group record:
 *
 *     - customName when the user has set one.
 *     - otherwise `${discipline.name} ${letterFromNumber(groupNumber)}`.
 *
 *   The letter is derived from the group's monotonic groupNumber,
 *   which is scoped to (classId, disciplineId, instructorId). Group
 *   1 → A, 2 → B, ... 26 → Z, 27 → AA, and so on.
 *
 *   The resolver is built ONCE per public VM call, as a
 *   groupId → displayName map. This keeps the cost at O(groups)
 *   regardless of how many occurrences the week produces, and it
 *   avoids a per-slot deep clone of the group record.
 *
 * GROUP COLOR CODING:
 *   Each group gets a deterministic palette index derived from its
 *   groupNumber, mod GROUP_COLOR_PALETTE_SIZE. Group 1 → 0,
 *   group 2 → 1, ..., group N → (N-1) mod PALETTE_SIZE.
 *
 *   The index is emitted on the slot descriptor and on each
 *   co-occupant. The renderer maps the index to a CSS class. The
 *   index is deterministic: the same group has the same palette
 *   slot on every grid, every render, every session. It is NOT
 *   globally unique; groups 1 and 9 share a palette slot because
 *   there are only eight palette slots.
 *
 * NULL SEMANTICS:
 *   Every public function returns null when:
 *     - the entity id is missing or malformed
 *     - the week is missing, malformed, or out of range
 *     - the entity does not exist in the store
 *     - the projector threw, or returned a non-array
 *
 *   When the entity exists and the projector returns an empty
 *   array, the VM is returned with an empty `schedule: {}`.
 *
 * CLASS CONTEXT (student / instructor VMs):
 *   The student and instructor projections accept an options
 *   object:
 *
 *     { week, classId }
 *
 *   `classId` is the class context for rest days. When supplied,
 *   the VM carries the class's rest days for the week. When
 *   omitted (or null), the VM carries `restDays: []`; the
 *   aggregator does NOT pick a class on the caller's behalf.
 *
 *   This is deliberately explicit. The student schedule itself
 *   comes from `Projector.projectForStudent(studentId, week)` —
 *   it is not class-scoped. The rest days come from the class.
 *   A caller that wants "the student's schedule in the context of
 *   class X" passes classId. A caller that just wants "the
 *   student's schedule" passes none, and gets no rest-day
 *   decoration.
 *
 * DISCIPLINE SCHEDULE SUMMARY:
 *   The panel that sits below the discipline schedule grid. Two
 *   questions: how many students are enrolled in this discipline
 *   for this class, and how many of them do not have a group
 *   assigned.
 *
 *   ENROLLED POPULATION — NOT WEEK-SCOPED. Every student in this
 *   class whose enrolment record names this discipline. Enrolment
 *   is a year-level fact. Instructors are filtered out by
 *   `mode === 'instructor'`; a character enrolled to teach is not
 *   a student.
 *
 *   ASSIGNED — NOT WEEK-SCOPED. A student is assigned when their
 *   characterId appears in the `members[]` array of any teaching
 *   group of this discipline for this class. Presence-based. A
 *   student whose membership interval is entirely in the past
 *   still counts; the panel reports the population, not the
 *   current-week schedule. (The grid next to it is week-scoped;
 *   the panel answers a different question.)
 *
 *   ELIMINATED — included in both enrolledCount and
 *   unassignedCount, with `eliminated: true` on the row and the
 *   elimination week when available. The panel reports the
 *   population honestly; callers that want "how many can I
 *   actually assign this week" subtract eliminatedCount
 *   themselves.
 *
 *   The `week` argument is passed through to the VM for display
 *   and for elimination resolution. It does not scope the
 *   enrolled population, the assigned list, or the unassigned
 *   list. Only the elimination flag is week-dependent (via
 *   EliminationQueries.isCharacterEliminatedByWeek).
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyTeachingProjector
 *   - window.CalendarConstants
 *   - window.CalendarValidation
 *   - window.AcademyDisciplines
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyTeachingGroups
 *   - window.AcademyEnrolments
 *
 * DEPENDENCIES (LAZY, used only if present):
 *   - window.AcademyLocations        (location display-name)
 *   - window.EliminationQueries      (elimination flag on the
 *                                     summary VM)
 */

(function() {
    'use strict';

    if (window.__academyCalendarAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var Projector = window.AcademyTeachingProjector;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var AcademyDisciplines = window.AcademyDisciplines;
    var CharacterQueries = window.CharacterQueries;
    var AcademyClasses = window.AcademyClasses;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyEnrolments = window.AcademyEnrolments;

    var _missing = [];

    if (!Projector || typeof Projector.projectWeek !== 'function') {
        _missing.push('AcademyTeachingProjector.projectWeek');
    }
    if (!Projector || typeof Projector.projectForStudent !== 'function') {
        _missing.push('AcademyTeachingProjector.projectForStudent');
    }
    if (!Projector || typeof Projector.projectForInstructor !== 'function') {
        _missing.push('AcademyTeachingProjector.projectForInstructor');
    }
    if (!Projector || typeof Projector.projectForLocation !== 'function') {
        _missing.push('AcademyTeachingProjector.projectForLocation');
    }
    if (!Projector || typeof Projector.projectForClass !== 'function') {
        _missing.push('AcademyTeachingProjector.projectForClass');
    }
    if (!Projector ||
        typeof Projector.projectForClassDiscipline !== 'function') {
        _missing.push(
            'AcademyTeachingProjector.projectForClassDiscipline'
        );
    }

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number' ||
        typeof CalendarConstants.MIN_DAY !== 'number' ||
        typeof CalendarConstants.MAX_DAY !== 'number' ||
        typeof CalendarConstants.MIN_HOUR !== 'number' ||
        typeof CalendarConstants.MAX_HOUR !== 'number' ||
        typeof CalendarConstants.CALENDAR_START_HOUR !== 'number' ||
        typeof CalendarConstants.CALENDAR_END_HOUR !== 'number') {
        _missing.push('CalendarConstants bounds');
    }

    if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getRestDaysForWeek !== 'function') {
        _missing.push('AcademyClasses.getRestDaysForWeek');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroup !== 'function') {
        _missing.push('AcademyTeachingGroups.getGroup');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroupsForDiscipline !== 'function') {
        _missing.push('AcademyTeachingGroups.getGroupsForDiscipline');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.getClassEnrolments !== 'function') {
        _missing.push('AcademyEnrolments.getClassEnrolments');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyCalendarAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyCalendarAggregatorLoaded = true;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getAcademyLocations() {
        return window.AcademyLocations || null;
    }

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var GROUP_COLOR_PALETTE_SIZE = 8;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function parseWeek(week) {
        if (week === undefined || week === null || week === '') {
            return null;
        }
        var parsed = CalendarValidation.parseWeek(week);
        if (parsed === null) {
            return null;
        }
        if (parsed < CalendarConstants.MIN_WEEK ||
            parsed > CalendarConstants.MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    function getDisciplineName(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return 'Unknown';
        }
        var d = AcademyDisciplines.getDiscipline(disciplineId);
        if (!d) {
            return 'Unknown';
        }
        if (!isNonEmptyString(d.name)) {
            return 'Unknown';
        }
        return d.name;
    }

    function getCharacterDisplayName(charId) {
        if (!isNonEmptyString(charId)) {
            return '';
        }
        var c = CharacterQueries.getCharacterById(charId);
        if (!c) {
            return '';
        }
        return CharacterQueries.getDisplayName(c) || '';
    }

    function getClassDisplayName(classId) {
        if (!isNonEmptyString(classId)) {
            return 'Class';
        }
        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return classId;
        }
        return isNonEmptyString(cls.name) ? cls.name : classId;
    }

    /**
     * Resolve a location's display name.
     *
     * When AcademyLocations is not loaded, falls back to the raw ID.
     * That is a documented optional dependency.
     *
     * When AcademyLocations IS loaded and its lookup throws, the
     * exception propagates. The aggregator does not mask a domain
     * failure as "use the ID instead."
     */
    function getLocationDisplayName(locationId) {
        if (!isNonEmptyString(locationId)) {
            return 'Location';
        }

        var AL = getAcademyLocations();
        if (!AL || typeof AL.getLocationName !== 'function') {
            return locationId;
        }

        var name = AL.getLocationName(locationId);
        if (isNonEmptyString(name) && name !== 'Unknown') {
            return name;
        }
        return locationId;
    }

    function getHoursRange() {
        var start = CalendarConstants.CALENDAR_START_HOUR;
        var end = CalendarConstants.CALENDAR_END_HOUR;
        var hours = [];
        for (var h = start; h <= end; h++) {
            hours.push(h);
        }
        return hours;
    }

    function toIdOrNull(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var str = String(value);
        return str === '' ? null : str;
    }

    // ============================================================
    // PROJECTOR CALL — STRUCTURED RESULT
    // ============================================================
    //
    // The projector is mandatory. When it succeeds and returns an
    // array, the caller gets `{ ok: true, occurrences: [...] }`.
    // When it throws, or returns a non-array, the caller gets
    // `{ ok: false, message }`.
    //
    // The caller decides what to do. Public VMs return null on
    // failure. They do not substitute an empty schedule.

    function callProjector(fn, label) {
        var result;
        try {
            result = fn();
        } catch (e) {
            console.warn(
                '[AcademyCalendarAggregator] ' + label + ' threw:', e
            );
            return {
                ok: false,
                message: label + ' threw: ' +
                    (e && e.message ? e.message : e)
            };
        }

        if (!Array.isArray(result)) {
            console.warn(
                '[AcademyCalendarAggregator] ' + label +
                ' returned a non-array:', result
            );
            return {
                ok: false,
                message: label + ' returned a non-array.'
            };
        }

        return { ok: true, occurrences: result };
    }

    // ============================================================
    // GROUP DISPLAY NAMES AND COLORS
    // ============================================================

    function letterFromNumber(n) {
        var num = parseInt(n, 10);
        if (isNaN(num) || num < 1) {
            return '';
        }
        var result = '';
        while (num > 0) {
            var rem = (num - 1) % 26;
            result = String.fromCharCode(65 + rem) + result;
            num = Math.floor((num - 1) / 26);
        }
        return result;
    }

    function colorIndexFromGroupNumber(n) {
        var num = parseInt(n, 10);
        if (isNaN(num) || num < 1) {
            return 0;
        }
        return (num - 1) % GROUP_COLOR_PALETTE_SIZE;
    }

    /**
     * Build the groupId → displayName and groupId → colorIndex maps
     * for the given set of group IDs.
     *
     * AcademyTeachingGroups is mandatory. A group ID that does not
     * resolve gets an empty display name and null color index; the
     * caller decides what to render in that case. The lookup itself
     * can throw and that exception propagates.
     */
    function buildGroupMaps(groupIds) {
        var names = Object.create(null);
        var colors = Object.create(null);

        var keys = Object.keys(groupIds || {});
        for (var i = 0; i < keys.length; i++) {
            var gid = keys[i];
            var g = AcademyTeachingGroups.getGroup(gid);
            if (!g) {
                names[gid] = '';
                colors[gid] = null;
                continue;
            }

            if (isNonEmptyString(g.customName)) {
                names[gid] = String(g.customName);
            } else {
                var disciplineName = getDisciplineName(g.disciplineId);
                var letter = letterFromNumber(g.groupNumber);
                if (letter !== '') {
                    names[gid] = disciplineName + ' ' + letter;
                } else {
                    names[gid] = disciplineName;
                }
            }

            colors[gid] = colorIndexFromGroupNumber(g.groupNumber);
        }

        return { names: names, colors: colors };
    }

    function collectGroupIds(occurrences) {
        var ids = Object.create(null);
        if (!Array.isArray(occurrences)) {
            return ids;
        }
        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!occ) { continue; }
            var gid = toIdOrNull(occ.groupId);
            if (gid !== null) {
                ids[gid] = true;
            }
        }
        return ids;
    }

    // ============================================================
    // REST DAYS
    // ============================================================

    function readClassRestDays(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return [];
        }
        var days = AcademyClasses.getRestDaysForWeek(classId, weekNum);
        return Array.isArray(days) ? days.slice() : [];
    }

    // ============================================================
    // SLOT DESCRIPTORS
    // ============================================================

    function buildCoOccupant(occurrence, groupMaps) {
        var gid = toIdOrNull(occurrence.groupId);
        var groupLabel = '';
        var colorIndex = null;
        if (gid !== null) {
            if (groupMaps && groupMaps.names && groupMaps.names[gid]) {
                groupLabel = groupMaps.names[gid];
            }
            if (groupMaps && groupMaps.colors) {
                var c = groupMaps.colors[gid];
                if (c !== undefined && c !== null) {
                    colorIndex = c;
                }
            }
        }

        var duration = 1;
        if (isFiniteNumber(occurrence.duration) &&
            occurrence.duration > 0) {
            duration = Math.round(occurrence.duration);
        }

        return {
            groupId: gid,
            groupLabel: groupLabel,
            colorIndex: colorIndex,
            disciplineName: getDisciplineName(occurrence.disciplineId),
            instructorName: getCharacterDisplayName(occurrence.instructorId),
            sessionId: toIdOrNull(occurrence.sessionId),
            duration: duration
        };
    }

    function buildSlotDescriptor(occurrence, groupMaps) {
        if (!occurrence || typeof occurrence !== 'object') {
            return null;
        }
        if (!isFiniteNumber(occurrence.day)) {
            return null;
        }
        if (!isFiniteNumber(occurrence.startTime)) {
            return null;
        }

        var duration = 1;
        if (isFiniteNumber(occurrence.duration) && occurrence.duration > 0) {
            duration = Math.round(occurrence.duration);
        }

        var gid = toIdOrNull(occurrence.groupId);
        var groupLabel = '';
        var colorIndex = null;
        if (gid !== null) {
            if (groupMaps && groupMaps.names && groupMaps.names[gid]) {
                groupLabel = groupMaps.names[gid];
            }
            if (groupMaps && groupMaps.colors) {
                var c = groupMaps.colors[gid];
                if (c !== undefined && c !== null) {
                    colorIndex = c;
                }
            }
        }

        var cid = toIdOrNull(occurrence.classId);
        var className = '';
        if (cid !== null) {
            className = getClassDisplayName(cid);
        }

        return {
            day: occurrence.day,
            startHour: occurrence.startTime,
            duration: duration,
            slot: {
                disciplineId: occurrence.disciplineId || null,
                disciplineName: getDisciplineName(occurrence.disciplineId),
                duration: duration,
                label: '',
                groupLabel: groupLabel,
                groupColorIndex: colorIndex,
                instructorId: occurrence.instructorId || null,
                instructorName: getCharacterDisplayName(occurrence.instructorId),
                classId: cid,
                className: className,
                groupId: gid,
                sessionId: toIdOrNull(occurrence.sessionId),
                coOccupants: [],
                isContinuation: false
            }
        };
    }

    function pivotOccurrencesToSchedule(occurrences, groupMaps) {
        var schedule = {};

        if (!Array.isArray(occurrences) || occurrences.length === 0) {
            return schedule;
        }

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            var expanded = buildSlotDescriptor(occ, groupMaps);
            if (!expanded) { continue; }

            var day = expanded.day;
            var startHour = expanded.startHour;
            var duration = expanded.duration;
            var slot = expanded.slot;

            if (!schedule[day]) {
                schedule[day] = {};
            }

            for (var h = 0; h < duration; h++) {
                var hour = startHour + h;
                if (hour > CalendarConstants.MAX_HOUR) { break; }
                if (hour < CalendarConstants.MIN_HOUR) { continue; }

                var cell = schedule[day][hour];

                if (!cell) {
                    if (h === 0) {
                        schedule[day][hour] = slot;
                    } else {
                        schedule[day][hour] = {
                            disciplineId: slot.disciplineId,
                            disciplineName: slot.disciplineName,
                            duration: slot.duration,
                            label: slot.label,
                            groupLabel: slot.groupLabel,
                            groupColorIndex: slot.groupColorIndex,
                            instructorId: slot.instructorId,
                            instructorName: slot.instructorName,
                            classId: slot.classId,
                            className: slot.className,
                            groupId: slot.groupId,
                            sessionId: slot.sessionId,
                            coOccupants: [],
                            isContinuation: true
                        };
                    }
                    continue;
                }

                if (cell.sessionId !== null &&
                    slot.sessionId !== null &&
                    String(cell.sessionId) === String(slot.sessionId)) {
                    continue;
                }

                if (!Array.isArray(cell.coOccupants)) {
                    cell.coOccupants = [];
                }
                cell.coOccupants.push(buildCoOccupant(occ, groupMaps));
            }
        }

        return schedule;
    }

    // ============================================================
    // STUDENT SCHEDULE VM
    // ============================================================
    //
    // Options: { week, classId }
    //
    // classId, when present, is the class context for rest days.
    // When absent or null, the VM carries restDays: [].

    function getStudentScheduleViewModel(studentId, weekOrOptions) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var week = weekOrOptions;
        var classId = null;

        if (weekOrOptions !== undefined &&
            weekOrOptions !== null &&
            typeof weekOrOptions === 'object') {
            week = weekOrOptions.week;
            if (isNonEmptyString(weekOrOptions.classId)) {
                classId = String(weekOrOptions.classId);
            }
        }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var char = CharacterQueries.getCharacterById(studentId);
        if (!char) {
            return null;
        }

        var call = callProjector(function() {
            return Projector.projectForStudent(studentId, weekNum);
        }, 'projectForStudent');

        if (!call.ok) {
            return null;
        }

        var occurrences = call.occurrences;

        var groupMaps = buildGroupMaps(collectGroupIds(occurrences));
        var schedule = pivotOccurrencesToSchedule(occurrences, groupMaps);

        return {
            schedule: schedule,
            restDays: readClassRestDays(classId, weekNum),
            entityName: CharacterQueries.getDisplayName(char) || 'Student',
            modeLabel: 'Student Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // INSTRUCTOR SCHEDULE VM
    // ============================================================
    //
    // Options: { week, classId }
    // Same class-context semantics as the student VM.

    function getInstructorScheduleViewModel(instructorId, weekOrOptions) {
        if (!isNonEmptyString(instructorId)) {
            return null;
        }

        var week = weekOrOptions;
        var classId = null;

        if (weekOrOptions !== undefined &&
            weekOrOptions !== null &&
            typeof weekOrOptions === 'object') {
            week = weekOrOptions.week;
            if (isNonEmptyString(weekOrOptions.classId)) {
                classId = String(weekOrOptions.classId);
            }
        }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var char = CharacterQueries.getCharacterById(instructorId);
        if (!char) {
            return null;
        }

        var call = callProjector(function() {
            return Projector.projectForInstructor(instructorId, weekNum);
        }, 'projectForInstructor');

        if (!call.ok) {
            return null;
        }

        var occurrences = call.occurrences;

        var groupMaps = buildGroupMaps(collectGroupIds(occurrences));
        var schedule = pivotOccurrencesToSchedule(occurrences, groupMaps);

        return {
            schedule: schedule,
            restDays: readClassRestDays(classId, weekNum),
            entityName: CharacterQueries.getDisplayName(char) || 'Instructor',
            modeLabel: 'Instructor Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // LOCATION SCHEDULE VM
    // ============================================================

    function getLocationScheduleViewModel(locationId, week) {
        if (!isNonEmptyString(locationId)) {
            return null;
        }
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var AL = getAcademyLocations();
        if (AL && typeof AL.getLocation === 'function') {
            var loc = AL.getLocation(locationId);
            if (!loc) {
                return null;
            }
        }

        var call = callProjector(function() {
            return Projector.projectForLocation(locationId, weekNum);
        }, 'projectForLocation');

        if (!call.ok) {
            return null;
        }

        var occurrences = call.occurrences;

        var groupMaps = buildGroupMaps(collectGroupIds(occurrences));
        var schedule = pivotOccurrencesToSchedule(occurrences, groupMaps);

        return {
            schedule: schedule,
            restDays: [],
            entityName: getLocationDisplayName(locationId),
            modeLabel: 'Location Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // CLASS SCHEDULE VM
    // ============================================================

    function getClassScheduleViewModel(classId, week) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var call = callProjector(function() {
            return Projector.projectForClass(classId, weekNum);
        }, 'projectForClass');

        if (!call.ok) {
            return null;
        }

        var occurrences = call.occurrences;

        var groupMaps = buildGroupMaps(collectGroupIds(occurrences));
        var schedule = pivotOccurrencesToSchedule(occurrences, groupMaps);

        return {
            schedule: schedule,
            restDays: readClassRestDays(classId, weekNum),
            entityName: getClassDisplayName(classId),
            modeLabel: 'Class Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // DISCIPLINE SCHEDULE VM
    // ============================================================
    //
    // One discipline, one class, one week. Every instructor of that
    // discipline, every group, every session.
    //
    // Data source: Projector.projectForClassDiscipline, which is a
    // filter over projectWeek. Same teaching-model projection every
    // other grid uses. No parallel scheduling model.
    //
    // Rest days apply, because a discipline grid is class-scoped.

    function getDisciplineScheduleViewModel(classId, disciplineId, week) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) {
            return null;
        }

        var call = callProjector(function() {
            return Projector.projectForClassDiscipline(
                classId, disciplineId, weekNum
            );
        }, 'projectForClassDiscipline');

        if (!call.ok) {
            return null;
        }

        var occurrences = call.occurrences;

        var groupMaps = buildGroupMaps(collectGroupIds(occurrences));
        var schedule = pivotOccurrencesToSchedule(occurrences, groupMaps);

        var disciplineName = isNonEmptyString(discipline.name)
            ? discipline.name
            : 'Unknown Discipline';
        var className = getClassDisplayName(classId);

        return {
            schedule: schedule,
            restDays: readClassRestDays(classId, weekNum),
            entityName: disciplineName + ' \u2014 ' + className,
            modeLabel: 'Discipline Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // DISCIPLINE SCHEDULE SUMMARY VM
    // ============================================================
    //
    // The panel below the discipline schedule grid.
    //
    // ENROLLED — NOT WEEK-SCOPED. Every student in this class whose
    // enrolment record names this discipline. Instructors are
    // filtered out by mode === 'instructor'. The data comes from
    // AcademyEnrolments.getClassEnrolments(classId), which returns
    // { charId: [disciplineId, ...] } for the whole class window.
    //
    // ASSIGNED — NOT WEEK-SCOPED. A student is assigned when their
    // characterId appears in the members[] array of any teaching
    // group of this discipline for this class. Presence-based: a
    // membership interval that ended weeks ago still counts. The
    // panel reports the population, not the current-week schedule.
    //
    // ELIMINATED — included in both counts, marked on the row. The
    // elimination flag is week-dependent (via
    // EliminationQueries.isCharacterEliminatedByWeek); everything
    // else is week-agnostic.
    //
    // The week parameter is passed through to the VM for display
    // and for the elimination flag. It does not scope the enrolled
    // population, the assigned list, or the unassigned list.

    function getDisciplineScheduleSummaryViewModel(
        classId,
        disciplineId,
        week
    ) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) {
            return null;
        }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        // ---- Enrolled population (not week-scoped) ----
        var enrolmentsByChar = {};
        try {
            enrolmentsByChar = AcademyEnrolments.getClassEnrolments(
                targetClass
            ) || {};
        } catch (e) {
            console.warn(
                '[AcademyCalendarAggregator] getClassEnrolments failed:',
                e
            );
            enrolmentsByChar = {};
        }

        // ---- Assigned set (not week-scoped) ----
        //
        // Build the set of characterIds that appear in the members[]
        // array of ANY teaching group of this discipline for this
        // class. Presence-based: no interval check, no week filter.
        var assignedSet = Object.create(null);

        var groups = [];
        try {
            groups = AcademyTeachingGroups.getGroupsForDiscipline(
                targetClass, targetDiscipline
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyCalendarAggregator] getGroupsForDiscipline ' +
                'failed:', e
            );
            groups = [];
        }

        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            if (!group || !Array.isArray(group.members)) { continue; }
            for (var m = 0; m < group.members.length; m++) {
                var member = group.members[m];
                if (!member || !member.characterId) { continue; }
                assignedSet[String(member.characterId)] = true;
            }
        }

        // ---- Build the enrolled roster ----
        var eligibleRows = [];
        var charIds = Object.keys(enrolmentsByChar);

        var EQ = getEliminationQueries();

        for (var i = 0; i < charIds.length; i++) {
            var charId = charIds[i];
            var disciplines = enrolmentsByChar[charId];

            if (!Array.isArray(disciplines)) { continue; }
            if (disciplines.indexOf(targetDiscipline) === -1) {
                continue;
            }

            var char = CharacterQueries.getCharacterById(charId);
            if (!char) { continue; }

            // Instructors are not students.
            if (char.mode === 'instructor') { continue; }

            var eliminated = false;
            var eliminationWeek = null;

            if (EQ &&
                typeof EQ.isCharacterEliminatedByWeek === 'function') {
                try {
                    eliminated = EQ.isCharacterEliminatedByWeek(
                        charId, weekNum
                    ) === true;
                } catch (e) {
                    eliminated = false;
                }
            }

            if (eliminated &&
                EQ &&
                typeof EQ.getEliminationWeek === 'function') {
                try {
                    var ew = EQ.getEliminationWeek(charId);
                    if (isFiniteNumber(ew)) {
                        eliminationWeek = ew;
                    }
                } catch (e) {
                    eliminationWeek = null;
                }
            }

            var assigned = assignedSet[String(charId)] === true;

            eligibleRows.push({
                id: charId,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char),
                eliminated: eliminated,
                eliminationWeek: eliminationWeek,
                assigned: assigned
            });
        }

        var assigned = [];
        var unassigned = [];

        for (var s = 0; s < eligibleRows.length; s++) {
            var entry = eligibleRows[s];
            if (entry.assigned) {
                assigned.push(entry);
            } else {
                unassigned.push(entry);
            }
        }

        assigned.sort(function(a, b) {
            return String(a.name).localeCompare(String(b.name));
        });
        unassigned.sort(function(a, b) {
            return String(a.name).localeCompare(String(b.name));
        });

        var eliminatedInUnassigned = 0;
        for (var u = 0; u < unassigned.length; u++) {
            if (unassigned[u].eliminated) {
                eliminatedInUnassigned++;
            }
        }

        return {
            classId: targetClass,
            className: isNonEmptyString(cls.name)
                ? cls.name
                : 'Unnamed Class',
            disciplineId: targetDiscipline,
            disciplineName: isNonEmptyString(discipline.name)
                ? discipline.name
                : 'Unknown Discipline',
            week: weekNum,

            enrolledCount: eligibleRows.length,
            assignedCount: assigned.length,
            unassignedCount: unassigned.length,
            eliminatedCount: eliminatedInUnassigned,

            assigned: assigned,
            unassigned: unassigned
        };
    }

    // ============================================================
    // WEEK OVERVIEW VM
    // ============================================================
    //
    // `studentAssignmentCount` is the sum, across every occurrence,
    // of occ.studentIds.length. It counts student-session
    // assignments represented in the projection, not unique
    // students: one session with 20 students contributes 20.

    function getWeekOverviewViewModel(week) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var call = callProjector(function() {
            return Projector.projectWeek(weekNum);
        }, 'projectWeek');

        if (!call.ok) {
            return null;
        }

        var occurrences = call.occurrences;

        var sessions = Object.create(null);
        var groups = Object.create(null);
        var classes = Object.create(null);
        var instructors = Object.create(null);
        var locations = Object.create(null);
        var studentAssignments = 0;

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!occ) { continue; }

            if (occ.sessionId) {
                sessions[String(occ.sessionId)] = true;
            }
            if (occ.groupId) {
                groups[String(occ.groupId)] = true;
            }
            if (occ.classId) {
                classes[String(occ.classId)] = true;
            }
            if (occ.instructorId) {
                instructors[String(occ.instructorId)] = true;
            }
            if (occ.locationId) {
                locations[String(occ.locationId)] = true;
            }
            if (Array.isArray(occ.studentIds)) {
                studentAssignments += occ.studentIds.length;
            }
        }

        return {
            week: weekNum,
            occurrenceCount: occurrences.length,
            uniqueSessionCount: Object.keys(sessions).length,
            uniqueGroupCount: Object.keys(groups).length,
            uniqueClassCount: Object.keys(classes).length,
            uniqueInstructorCount: Object.keys(instructors).length,
            uniqueLocationCount: Object.keys(locations).length,
            studentAssignmentCount: studentAssignments
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCalendarAggregator = Object.freeze({
        getStudentScheduleViewModel: getStudentScheduleViewModel,
        getInstructorScheduleViewModel: getInstructorScheduleViewModel,
        getLocationScheduleViewModel: getLocationScheduleViewModel,
        getClassScheduleViewModel: getClassScheduleViewModel,
        getDisciplineScheduleViewModel: getDisciplineScheduleViewModel,
        getDisciplineScheduleSummaryViewModel:
            getDisciplineScheduleSummaryViewModel,
        getWeekOverviewViewModel: getWeekOverviewViewModel,

        GROUP_COLOR_PALETTE_SIZE: GROUP_COLOR_PALETTE_SIZE
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyCalendarAggregator;
        var missing = [];

        var required = [
            'getStudentScheduleViewModel',
            'getInstructorScheduleViewModel',
            'getLocationScheduleViewModel',
            'getClassScheduleViewModel',
            'getDisciplineScheduleViewModel',
            'getDisciplineScheduleSummaryViewModel',
            'getWeekOverviewViewModel'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (letterFromNumber(1) !== 'A') {
                missing.push('letterFromNumber(1) !== A');
            }
            if (letterFromNumber(26) !== 'Z') {
                missing.push('letterFromNumber(26) !== Z');
            }
            if (letterFromNumber(27) !== 'AA') {
                missing.push('letterFromNumber(27) !== AA');
            }

            if (colorIndexFromGroupNumber(1) !== 0) {
                missing.push('colorIndexFromGroupNumber(1) !== 0');
            }
            if (colorIndexFromGroupNumber(8) !== 7) {
                missing.push('colorIndexFromGroupNumber(8) !== 7');
            }
            if (colorIndexFromGroupNumber(9) !== 0) {
                missing.push('colorIndexFromGroupNumber(9) !== 0');
            }
            if (colorIndexFromGroupNumber(0) !== 0) {
                missing.push('colorIndexFromGroupNumber(0) !== 0');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyCalendarAggregator] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
