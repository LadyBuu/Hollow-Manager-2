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
 *   locations, and classes from the AcademyTeachingProjector.
 *   Every VM is shaped for CalendarRenderer.renderGrid.
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
 *     days (a room is a resource, not a class member).
 *
 * ARCHITECTURE:
 *
 *     AcademyTeachingProjector
 *         ↓  projectWeek / projectForStudent / projectForInstructor /
 *            projectForLocation / projectForClass
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
 *       instructorId:    string | null,
 *       instructorName:  string,
 *       classId:         string | null,
 *       className:       string,
 *       groupId:         string | null,
 *       sessionId:       string | null,
 *       coOccupants:     [{ groupId, disciplineName,
 *                           instructorName }, ...],
 *       isContinuation:  boolean
 *     }
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
 *   The map is used by buildSlotDescriptor to populate groupLabel.
 *   Without it, two groups of the same discipline taught by the
 *   same instructor would render as identical cells.
 *
 * CO-OCCUPANCY:
 *   Two teaching groups can share a location. When two occurrences
 *   land in the same (day, hour) cell of a LOCATION projection,
 *   the first becomes the primary slot descriptor and the second's
 *   group identity is appended to the primary's `coOccupants`
 *   array. The cell renders as one cell, with a marker indicating
 *   how many additional groups are present.
 *
 *   Co-occupancy is a LOCATION fact. The projectForStudent /
 *   projectForInstructor / projectForClass projections are scoped
 *   to one entity's own occurrences. An instructor's grid should
 *   never merge two of their own groups into one cell; if it does,
 *   the two sessions are colliding and the collision detector
 *   should have flagged it.
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
    // GROUP DISPLAY NAMES
    // ============================================================
    //
    // The display name for a group is:
    //
    //   customName if set
    //   otherwise `${discipline.name} ${letterFromNumber(groupNumber)}`
    //
    // The letter is derived from the group's monotonic groupNumber,
    // scoped to (classId, disciplineId, instructorId). Group 1 → A,
    // 2 → B, ..., 26 → Z, 27 → AA, and so on.
    //
    // The resolver is built once per VM call. It walks every group
    // that shares a discipline with the occurrence set and produces
    // a plain groupId → displayName map. This is O(groups), not
    // O(occurrences), so the cost does not scale with the week's
    // schedule density.
    //
    // getGroup returns a DEEP CLONE. To avoid cloning every group
    // on every VM call, we only fetch the groups we actually need:
    // the ones whose IDs appear in the occurrence set. The caller
    // passes in the set of groupIds it has seen.

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

    /**
     * Build a map from groupId to displayName for the given set of
     * group IDs. Groups that cannot be resolved (missing record,
     * missing AcademyTeachingGroups, missing discipline) get an
     * empty string. The caller decides what to render in that case.
     *
     * @param {object} groupIds - object whose keys are the group IDs
     * @returns {object} groupId → displayName
     */
    function buildGroupDisplayNameMap(groupIds) {
        var result = Object.create(null);
        var Groups = getAcademyTeachingGroups();
        if (!Groups || typeof Groups.getGroup !== 'function') {
            return result;
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
                result[gid] = '';
                continue;
            }

            if (isNonEmptyString(g.customName)) {
                result[gid] = String(g.customName);
                continue;
            }

            var disciplineName = getDisciplineName(g.disciplineId);
            var letter = letterFromNumber(g.groupNumber);
            if (letter !== '') {
                result[gid] = disciplineName + ' ' + letter;
            } else {
                result[gid] = disciplineName;
            }
        }

        return result;
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
    // REST DAYS (v30, extended v31)
    // ============================================================
    //
    // A class carries its rest days. The rest-day concept is a
    // property of the class, not of the individual student or
    // instructor: a class is a cohort with a shared timetable.
    //
    // Rest days are WEEK-SCOPED. AcademyClasses resolves the
    // effective rest days for a given week from the class's
    // restDays (default) and restDaysByWeek (sparse overrides).
    // The three class-member projections read the resolved array
    // and copy it onto the VM. The location projection does NOT —
    // a room can be used by two classes with different rest days,
    // so it cannot inherit either class's.
    //
    // The projector is where rest days actually suppress
    // occurrences. By the time a schedule VM reaches this module,
    // sessions on rest days have already been filtered out of the
    // occurrence list. The VM's restDays array is a display fact:
    // the renderer dims those columns and refuses assignments
    // there.

    function readClassRestDays(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return [];
        }
        if (typeof AcademyClasses.getRestDaysForWeek !== 'function') {
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

    function buildCoOccupant(occurrence, groupNames) {
        var gid = toIdOrNull(occurrence.groupId);
        var groupLabel = '';
        if (gid !== null && groupNames && groupNames[gid]) {
            groupLabel = groupNames[gid];
        }
        return {
            groupId: gid,
            groupLabel: groupLabel,
            disciplineName: getDisciplineName(occurrence.disciplineId),
            instructorName: getCharacterDisplayName(occurrence.instructorId)
        };
    }

    function buildSlotDescriptor(occurrence, groupNames) {
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
        if (gid !== null && groupNames && groupNames[gid]) {
            groupLabel = groupNames[gid];
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

    function pivotOccurrencesToSchedule(occurrences, groupNames) {
        var schedule = {};

        if (!Array.isArray(occurrences) || occurrences.length === 0) {
            return schedule;
        }

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            var expanded = buildSlotDescriptor(occ, groupNames);
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
                cell.coOccupants.push(buildCoOccupant(occ, groupNames));
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

        var groupNames = buildGroupDisplayNameMap(
            collectGroupIds(occurrences)
        );
        var schedule = pivotOccurrencesToSchedule(occurrences, groupNames);

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

        var groupNames = buildGroupDisplayNameMap(
            collectGroupIds(occurrences)
        );
        var schedule = pivotOccurrencesToSchedule(occurrences, groupNames);

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

        var groupNames = buildGroupDisplayNameMap(
            collectGroupIds(occurrences)
        );
        var schedule = pivotOccurrencesToSchedule(occurrences, groupNames);

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

        var groupNames = buildGroupDisplayNameMap(
            collectGroupIds(occurrences)
        );
        var schedule = pivotOccurrencesToSchedule(occurrences, groupNames);

        return {
            schedule: schedule,
            restDays: readClassRestDays(classId, weekNum),
            entityName: getClassDisplayName(classId),
            modeLabel: 'Class Schedule',
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
        getWeekOverviewViewModel: getWeekOverviewViewModel
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
            'getWeekOverviewViewModel'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyCalendarAggregator] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }

        // Smoke test the letter conversion. Group 1 → A, 26 → Z,
        // 27 → AA. This is the fallback naming scheme, and a
        // regression here would produce empty labels for every
        // group in the schedule.
        try {
            if (letterFromNumber(1) !== 'A') {
                missing.push('letterFromNumber(1) !== A');
            }
            if (letterFromNumber(2) !== 'B') {
                missing.push('letterFromNumber(2) !== B');
            }
            if (letterFromNumber(26) !== 'Z') {
                missing.push('letterFromNumber(26) !== Z');
            }
            if (letterFromNumber(27) !== 'AA') {
                missing.push('letterFromNumber(27) !== AA');
            }
            if (letterFromNumber(0) !== '') {
                missing.push('letterFromNumber(0) !== ""');
            }
            if (letterFromNumber(null) !== '') {
                missing.push('letterFromNumber(null) !== ""');
            }
        } catch (e) {
            missing.push('letter-conversion smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyCalendarAggregator] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
