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
 *   - Rest days as a concept. class.restDays and
 *     class.restDaysByWeek are stored and validated by
 *     AcademyClasses. This module is a pass-through: it resolves
 *     the week's rest days via
 *     AcademyClasses.getRestDaysForWeek and copies the result
 *     onto the VM. The location grid does NOT inherit class rest
 *     days (a room is a resource, not a class member). The
 *     discipline grid DOES inherit class rest days, because a
 *     discipline grid is class-scoped: the sessions it shows are
 *     the class's sessions.
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
 *       label:           string,
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
 *   On a LOCATION grid, co-occupancy means "two or more groups
 *   share this room at this time."
 *
 *   On a STUDENT grid, the projection is scoped to one student's
 *   own sessions. A co-occupant means the student is double-booked.
 *
 *   On an INSTRUCTOR grid, the same reasoning applies: the
 *   projection is scoped to one instructor's sessions, so a
 *   co-occupant is another meeting the instructor is committed to
 *   at the same slot.
 *
 *   On a CLASS grid, and on a DISCIPLINE grid scoped to a class,
 *   a co-occupant means two or more groups are meeting at the same
 *   slot. If they are for the same discipline, they might be
 *   parallel sections (fine) or a scheduling mistake (not fine).
 *   The aggregator does not decide which; it reports what the
 *   projector returned, and the user decides. AcademyTeachingCollisions
 *   owns the semantic answer.
 *
 * DISCIPLINE GRID:
 *   getDisciplineScheduleViewModel(classId, disciplineId, week)
 *   projects `Projector.projectForClassDiscipline`, which filters
 *   projectWeek to occurrences whose classId AND disciplineId both
 *   match. The result is every session of that discipline for that
 *   class this week, across every instructor and every group.
 *
 *   The grid does NOT distinguish instructors visually beyond what
 *   the slot descriptor already carries: instructor name is
 *   rendered per cell, and co-occupants list additional sessions
 *   at the same slot. If two instructors teach parallel sections
 *   of the same discipline at the same hour, both are shown.
 *
 *   Rest days apply, because the discipline grid is class-scoped
 *   and shows the class's sessions.
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
 *
 *   When the entity exists but has no occurrences this week, the
 *   VM is returned with an empty `schedule: {}`.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyTeachingProjector
 *   - window.CalendarConstants
 *   - window.CalendarValidation
 *   - window.AcademyDisciplines
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *
 * DEPENDENCIES (LAZY, used only if present):
 *   - window.AcademyTeachingGroups   (group display-name resolution)
 *   - window.AcademyLocations        (location display-name)
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

    function getAcademyTeachingGroups() {
        return window.AcademyTeachingGroups || null;
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

    function getLocationDisplayName(locationId) {
        if (!isNonEmptyString(locationId)) {
            return 'Location';
        }
        var AL = getAcademyLocations();
        if (!AL || typeof AL.getLocationName !== 'function') {
            return locationId;
        }
        try {
            var name = AL.getLocationName(locationId);
            if (isNonEmptyString(name) && name !== 'Unknown') {
                return name;
            }
            return locationId;
        } catch (e) {
            return locationId;
        }
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

    function buildGroupMaps(groupIds) {
        var names = Object.create(null);
        var colors = Object.create(null);

        var Groups = getAcademyTeachingGroups();
        if (!Groups || typeof Groups.getGroup !== 'function') {
            return { names: names, colors: colors };
        }

        var keys = Object.keys(groupIds || {});
        for (var i = 0; i < keys.length; i++) {
            var gid = keys[i];
            var g = null;
            try {
                g = Groups.getGroup(gid);
            } catch (e) {
                g = null;
            }
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
        try {
            var days = AcademyClasses.getRestDaysForWeek(
                classId, weekNum
            );
            return Array.isArray(days) ? days.slice() : [];
        } catch (e) {
            console.warn(
                '[AcademyCalendarAggregator] getRestDaysForWeek failed:',
                e
            );
            return [];
        }
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

    function safeProjectorCall(fn, label) {
        try {
            var result = fn();
            if (Array.isArray(result)) {
                return result;
            }
            return [];
        } catch (e) {
            console.warn(
                '[AcademyCalendarAggregator] ' + label + ' threw:', e
            );
            return [];
        }
    }

    // ============================================================
    // STUDENT SCHEDULE VM
    // ============================================================

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

        var occurrences = safeProjectorCall(function() {
            return Projector.projectForStudent(studentId, weekNum);
        }, 'projectForStudent');

        var groupMaps = buildGroupMaps(
            collectGroupIds(occurrences)
        );
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

        var occurrences = safeProjectorCall(function() {
            return Projector.projectForInstructor(instructorId, weekNum);
        }, 'projectForInstructor');

        var groupMaps = buildGroupMaps(
            collectGroupIds(occurrences)
        );
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
            var loc = null;
            try {
                loc = AL.getLocation(locationId);
            } catch (e) {
                loc = null;
            }
            if (!loc) {
                return null;
            }
        }

        var occurrences = safeProjectorCall(function() {
            return Projector.projectForLocation(locationId, weekNum);
        }, 'projectForLocation');

        var groupMaps = buildGroupMaps(
            collectGroupIds(occurrences)
        );
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

        var occurrences = safeProjectorCall(function() {
            return Projector.projectForClass(classId, weekNum);
        }, 'projectForClass');

        var groupMaps = buildGroupMaps(
            collectGroupIds(occurrences)
        );
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
    // filter over projectWeek. This is the same teaching-model
    // projection every other grid uses. No parallel scheduling
    // model.
    //
    // Rest days apply, because a discipline grid is class-scoped.
    // The sessions it shows are the class's sessions; the class's
    // rest days suppress occurrences on those days.
    //
    // Entity name: "<Discipline> — <Class>" so the header identifies
    // both the discipline and the class scope. Without the class
    // name, two classes' grids would show the same label for the
    // same discipline and the reader would have to infer the scope
    // from context.

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

        var occurrences = safeProjectorCall(function() {
            return Projector.projectForClassDiscipline(
                classId, disciplineId, weekNum
            );
        }, 'projectForClassDiscipline');

        var groupMaps = buildGroupMaps(
            collectGroupIds(occurrences)
        );
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
    // WEEK OVERVIEW VM
    // ============================================================

    function getWeekOverviewViewModel(week) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var occurrences = safeProjectorCall(function() {
            return Projector.projectWeek(weekNum);
        }, 'projectWeek');

        var sessions = Object.create(null);
        var groups = Object.create(null);
        var classes = Object.create(null);
        var instructors = Object.create(null);
        var locations = Object.create(null);
        var studentOccurrences = 0;

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
                studentOccurrences += occ.studentIds.length;
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
            studentOccurrenceCount: studentOccurrences
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
