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
 *   - Rest days as a concept. class.restDays is stored and
 *     validated by AcademyClasses. This module is a pass-through:
 *     it reads the class's restDays for a class-member projection
 *     and copies them onto the VM. The location grid does NOT
 *     inherit class rest days (a room is a resource, not a class
 *     member).
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
 *       groupId:         string | null,
 *       sessionId:       string | null,
 *       coOccupants:     [{ groupId, disciplineName,
 *                           instructorName }, ...],
 *       isContinuation:  boolean
 *     }
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
 *   to one entity's own occurrences.
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
 *   - window.AcademyLocations
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
    // REST DAYS (v30)
    // ============================================================
    //
    // A class carries its restDays. The rest-day concept is a
    // property of the class, not of the individual student or
    // instructor: a class is a cohort with a shared timetable.
    //
    // The three class-member projections (student, instructor,
    // class) read the class's restDays and copy them onto the VM.
    // The location projection does NOT — a room can be used by
    // two classes with different rest days, so it cannot inherit
    // either class's.
    //
    // Shape at read time:
    //   class.restDays = [dayNumber, ...], integers in
    //   [CalendarConstants.MIN_DAY, CalendarConstants.MAX_DAY],
    //   no duplicates. AcademyClasses validates on write; the
    //   reader is defensive anyway.

    function readClassRestDays(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var cls = AcademyClasses.getClass(classId);
        if (!cls || !Array.isArray(cls.restDays)) {
            return [];
        }
        return normaliseRestDaysArray(cls.restDays);
    }

    function normaliseRestDaysArray(raw) {
        if (!Array.isArray(raw)) { return []; }
        var seen = Object.create(null);
        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var n = Number(raw[i]);
            if (!Number.isInteger(n)) { continue; }
            if (n < CalendarConstants.MIN_DAY ||
                n > CalendarConstants.MAX_DAY) {
                continue;
            }
            var key = String(n);
            if (seen[key]) { continue; }
            seen[key] = true;
            result.push(n);
        }
        result.sort(function(a, b) { return a - b; });
        return result;
    }

    /**
     * Resolve the class whose rest days apply to a given student
     * or instructor grid.
     *
     * A character may be a member of more than one class. The grid
     * shows one week's schedule for one character; the character's
     * own rest days are the ones the class they are viewing in the
     * Academy People view declares. That class is the currently
     * selected class.
     *
     * The aggregator does not read AcademyUI. The caller (the
     * character detail aggregator, via the People controller) has
     * already resolved the classId and passes it in options. When
     * no class is supplied, restDays is []: the projection does
     * not guess.
     */

    // ============================================================
    // SLOT DESCRIPTORS
    // ============================================================

    function buildCoOccupant(occurrence) {
        return {
            groupId: toIdOrNull(occurrence.groupId),
            disciplineName: getDisciplineName(occurrence.disciplineId),
            instructorName: getCharacterDisplayName(occurrence.instructorId)
        };
    }

    function buildSlotDescriptor(occurrence) {
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

        return {
            day: occurrence.day,
            startHour: occurrence.startTime,
            duration: duration,
            slot: {
                disciplineId: occurrence.disciplineId || null,
                disciplineName: getDisciplineName(occurrence.disciplineId),
                duration: duration,
                label: '',
                groupLabel: '',
                instructorId: occurrence.instructorId || null,
                instructorName: getCharacterDisplayName(occurrence.instructorId),
                groupId: toIdOrNull(occurrence.groupId),
                sessionId: toIdOrNull(occurrence.sessionId),
                coOccupants: [],
                isContinuation: false
            }
        };
    }

    function pivotOccurrencesToSchedule(occurrences) {
        var schedule = {};

        if (!Array.isArray(occurrences) || occurrences.length === 0) {
            return schedule;
        }

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            var expanded = buildSlotDescriptor(occ);
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
                cell.coOccupants.push(buildCoOccupant(occ));
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
    //
    // REST DAYS:
    //   The caller passes options.classId when it wants the class's
    //   rest days applied. The legacy `getStudentScheduleViewModel(
    //   studentId, week)` two-argument form has no class and yields
    //   restDays: []. Callers that want rest days use the
    //   options-object form.

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

        var schedule = pivotOccurrencesToSchedule(occurrences);

        return {
            schedule: schedule,
            restDays: readClassRestDays(classId),
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

        var schedule = pivotOccurrencesToSchedule(occurrences);

        return {
            schedule: schedule,
            restDays: readClassRestDays(classId),
            entityName: CharacterQueries.getDisplayName(char) || 'Instructor',
            modeLabel: 'Instructor Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // LOCATION SCHEDULE VM
    // ============================================================
    //
    // REST DAYS:
    //   The location projection does NOT inherit class rest days.
    //   A room can be used by two classes with different rest days,
    //   so it cannot inherit either class's. The VM always returns
    //   restDays: [].

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

        var schedule = pivotOccurrencesToSchedule(occurrences);

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
    //
    // REST DAYS:
    //   The class grid is the class's own schedule, so the class's
    //   rest days apply. Read directly from the class record.

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

        var schedule = pivotOccurrencesToSchedule(occurrences);

        return {
            schedule: schedule,
            restDays: readClassRestDays(classId),
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
    })();

})();
