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
 *   - Rest days. There is no rest-day concept in the teaching model.
 *     VMs always return an empty restDays array.
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
 *     restDays:   [number],          // always [] in this aggregator
 *     entityName: string,
 *     modeLabel:  string,
 *     hours:      [number]           // calendar's canonical hour range
 *   }
 *
 *   slotDescriptor:
 *     {
 *       disciplineId:    string | null,
 *       disciplineName:  string,
 *       duration:        number,      // hours
 *       label:           string,      // always '' — sessions have no label
 *       groupLabel:      string,      // always '' — sessions have no group label
 *       instructorId:    string | null,
 *       instructorName:  string,
 *       isContinuation:  boolean
 *     }
 *
 *   A multi-hour occurrence is expanded into multiple entries: the
 *   first hour carries isContinuation: false; each subsequent hour
 *   carries isContinuation: true. This matches what the renderer
 *   expects when drawing spanning cells.
 *
 * OCCURRENCE SOURCE:
 *   The projector emits one Occurrence per (session, week) pair.
 *   Each occurrence carries:
 *     sessionId, groupId, classId, disciplineId, instructorId,
 *     week, day, startTime, duration, locationId, studentIds[]
 *
 *   The aggregator does not filter by studentIds when projecting a
 *   schedule view. A student schedule projection is already scoped
 *   by the projector to the occurrences that student attends. An
 *   instructor projection is scoped to the instructor's groups. A
 *   location projection is scoped to sessions at that location.
 *   The aggregator just shapes what it gets.
 *
 * NO ENRICHMENT BEYOND DISPLAY:
 *   Discipline names and instructor names are resolved here, once,
 *   because CalendarRenderer reads them directly from the slot
 *   descriptor. This is the display enrichment boundary. Nothing
 *   else is added.
 *
 * NULL SEMANTICS:
 *   Every public function returns null when:
 *     - the entity id is missing or malformed
 *     - the week is missing, malformed, or out of range
 *     - the entity does not exist in the store
 *   A null return means "no VM available". Callers render an empty
 *   state. The aggregator does not fabricate a VM with empty
 *   contents, because an empty schedule and a missing entity are
 *   different facts.
 *
 *   When the entity exists but has no occurrences this week, the
 *   VM is returned with an empty `schedule: {}`. That is the
 *   truthful answer: "this entity has a schedule, and it is empty
 *   this week."
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
 *     Used by getLocationScheduleViewModel to resolve a location's
 *     display name. When absent, the VM's entityName falls back to
 *     the location id. This is a display-only degradation; the
 *     schedule data itself is complete.
 *
 * USAGE:
 *   var VM = AcademyCalendarAggregator.getStudentScheduleViewModel(
 *       'char_123', 5
 *   );
 *   container.innerHTML = CalendarRenderer.renderGrid(state, VM);
 *
 *   var locVM = AcademyCalendarAggregator.getLocationScheduleViewModel(
 *       'loc_abc', 5
 *   );
 *   container.innerHTML = CalendarRenderer.renderGrid(state, locVM);
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
    //
    // AcademyLocations is used only for display enrichment when the
    // caller asks for a location schedule VM. If it isn't loaded
    // yet, the VM still works; the entityName just falls back to
    // the location id.

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

    /**
     * Parse a week with the canonical validator.
     * Returns an integer in [MIN_WEEK, MAX_WEEK] or null.
     */
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

    /**
     * Resolve a discipline's display name.
     * Returns 'Unknown' when the discipline doesn't exist. This
     * matches the rest of the Academy UI, which uses 'Unknown' as
     * the sentinel for missing references.
     */
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

    /**
     * Resolve a character's display name.
     * Returns '' when the character is missing. Empty string is
     * preferable to 'Unknown' for instructors: a slot with no
     * instructor should render without an instructor line, not
     * with "Unknown" written in it.
     */
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

    /**
     * Resolve a class's display name. Falls back to the id when the
     * class doesn't exist or has no name.
     */
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
     * Resolve a location's display name. Falls back to the id.
     *
     * AcademyLocations is a LAZY dependency. When it isn't loaded
     * yet, the id is used as the display name. This is a display-
     * only degradation; the schedule data is complete.
     */
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

    /**
     * Build the canonical hour range for the grid. This is what
     * CalendarRenderer uses to decide which rows to draw.
     */
    function getHoursRange() {
        var start = CalendarConstants.CALENDAR_START_HOUR;
        var end = CalendarConstants.CALENDAR_END_HOUR;
        var hours = [];
        for (var h = start; h <= end; h++) {
            hours.push(h);
        }
        return hours;
    }

    /**
     * Expand an occurrence into a slot descriptor.
     *
     * The occurrence's [startTime, startTime + duration) window is
     * split across that many hourly cells. The first cell carries
     * isContinuation: false; every subsequent cell carries true.
     * This is what the renderer expects for spanning classes.
     *
     * @param {object} occurrence
     * @returns {object|null} { day, startHour, duration, slot }
     */
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
                isContinuation: false
            }
        };
    }

    /**
     * Pivot a flat occurrence list into the schedule map the
     * renderer consumes.
     *
     * @param {array} occurrences
     * @returns {object} { day: { hour: slotDescriptor } }
     */
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

                if (h === 0) {
                    schedule[day][hour] = slot;
                } else {
                    // Continuation cells carry the same descriptor
                    // with isContinuation: true. Cloning keeps the
                    // renderer from mutating shared state.
                    schedule[day][hour] = {
                        disciplineId: slot.disciplineId,
                        disciplineName: slot.disciplineName,
                        duration: slot.duration,
                        label: slot.label,
                        groupLabel: slot.groupLabel,
                        instructorId: slot.instructorId,
                        instructorName: slot.instructorName,
                        isContinuation: true
                    };
                }
            }
        }

        return schedule;
    }

    /**
     * Run a projector call, swallowing exceptions into an empty
     * result. A throwing projector is a bug, but a broken schedule
     * VM should not take down the whole render. The console gets
     * the error; the caller gets an empty schedule.
     */
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

    /**
     * Build the schedule VM for a student's week.
     *
     * @param {string} studentId
     * @param {number|string} week
     * @returns {object|null} VM or null when the input is invalid
     */
    function getStudentScheduleViewModel(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
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
            restDays: [],
            entityName: CharacterQueries.getDisplayName(char) || 'Student',
            modeLabel: 'Student Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // INSTRUCTOR SCHEDULE VM
    // ============================================================

    /**
     * Build the schedule VM for an instructor's week.
     *
     * @param {string} instructorId
     * @param {number|string} week
     * @returns {object|null}
     */
    function getInstructorScheduleViewModel(instructorId, week) {
        if (!isNonEmptyString(instructorId)) {
            return null;
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
            restDays: [],
            entityName: CharacterQueries.getDisplayName(char) || 'Instructor',
            modeLabel: 'Instructor Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // LOCATION SCHEDULE VM
    // ============================================================

    /**
     * Build the schedule VM for a location's week.
     *
     * @param {string} locationId
     * @param {number|string} week
     * @returns {object|null}
     */
    function getLocationScheduleViewModel(locationId, week) {
        if (!isNonEmptyString(locationId)) {
            return null;
        }
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        // Location entity check is a display concern only. The
        // schedule is a projection over sessions, not over the
        // location entity. If the location store isn't loaded yet,
        // we still project — the caller might be rendering a
        // location that exists in the session data but whose
        // entity module isn't available in this build.
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

    /**
     * Build the schedule VM for a class's week.
     *
     * The grid shows every session belonging to the class's teaching
     * groups, regardless of discipline, instructor, or location.
     * This is useful for a class-level overview grid.
     *
     * @param {string} classId
     * @param {number|string} week
     * @returns {object|null}
     */
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
            restDays: [],
            entityName: getClassDisplayName(classId),
            modeLabel: 'Class Schedule',
            hours: getHoursRange()
        };
    }

    // ============================================================
    // WEEK OVERVIEW VM
    // ============================================================

    /**
     * Build a lightweight summary of one week's scheduled teaching
     * across the whole academy. Useful for dashboards.
     *
     * @param {number|string} week
     * @returns {object|null} {
     *   week,
     *   occurrenceCount,
     *   uniqueSessionCount,
     *   uniqueGroupCount,
     *   uniqueClassCount,
     *   uniqueInstructorCount,
     *   uniqueLocationCount,
     *   studentOccurrenceCount
     * }
     */
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
