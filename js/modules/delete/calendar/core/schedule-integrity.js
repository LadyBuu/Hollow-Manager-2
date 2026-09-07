/**
 * modules/calendar/core/schedule-integrity.js - Schedule Integrity Validator
 * Comprehensive schedule validation and auditing
 * Path: js/modules/calendar/core/schedule-integrity.js
 * 
 * This module provides:
 *   - validateScheduleIntegrity - Comprehensive schedule validation
 *   - checkForOrphanMetadata - Find metadata without matching schedule
 *   - checkForGaps - Find gaps in class continuity
 *   - checkForOverlaps - Find overlapping classes
 *   - checkForMalformedEntries - Find malformed schedule entries
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - No direct window.data access
 *   - PURE functions - no side effects
 *   - Uses CalendarScheduleCore for schedule semantics
 *   - Uses CalendarConstants for bounds
 *   - Uses CalendarValidation for strict parsing
 *   - Schedule is the CANONICAL source of truth
 *   - Metadata is validated against the schedule
 * 
 * DEPENDENCIES:
 *   - window.CalendarScheduleCore (from schedule-core.js) - MANDATORY
 *   - window.CalendarConstants (from shared/calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 * 
 * USAGE:
 *   var SI = window.CalendarScheduleIntegrity;
 *   var result = SI.validateScheduleIntegrity(schedule, metadata, studentId, week);
 *   if (!result.valid) {
 *       console.log('Issues:', result.issues);
 *   }
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarScheduleIntegrityLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.CalendarScheduleCore) {
        missing.push('CalendarScheduleCore');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation) {
        missing.push('CalendarValidation');
    }

    if (missing.length > 0) {
        throw new Error('[CalendarScheduleIntegrity] Missing dependencies: ' + missing.join(', '));
    }

    var ScheduleCore = window.CalendarScheduleCore;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getDayName(day) {
        return CalendarConstants.getDayName(day) || 'Unknown';
    }

    function getScheduleKey(studentId, week, day, hour) {
        return ScheduleCore.getScheduleKey(studentId, week, day, hour);
    }

    function getValidClassDuration(durations, key) {
        return ScheduleCore.getValidClassDuration(durations, key);
    }

    function validateOccupiedDuration(schedule, day, startHour, disciplineId) {
        return ScheduleCore.validateOccupiedDuration(schedule, day, startHour, disciplineId);
    }

    // ============================================================
    // INTEGRITY VALIDATION
    // ============================================================

    /**
     * Validate the integrity of a schedule.
     * Checks:
     * - All class starts have valid duration metadata
     * - All occupied hours belong to a valid class
     * - No overlapping classes
     * - All metadata keys correspond to actual classes
     * - No orphaned metadata
     * - No malformed schedule entries
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} metadata - Metadata object with classDurations, etc.
     * @param {string} studentId - Student ID for metadata lookup
     * @param {number} week - Week number for metadata lookup
     * @returns {object} { valid: boolean, issues: array, warnings: array, stats: object }
     */
    function validateScheduleIntegrity(schedule, metadata, studentId, week) {
        var results = {
            valid: true,
            issues: [],
            warnings: [],
            stats: {
                totalClasses: 0,
                validClasses: 0,
                invalidClasses: 0,
                orphanMetadata: 0,
                overlaps: 0,
                malformedEntries: 0,
                gaps: 0
            }
        };

        // ---- PHASE 1: VALIDATE INPUTS ----
        if (!schedule || typeof schedule !== 'object') {
            results.valid = false;
            results.issues.push('Schedule is not available.');
            return results;
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            results.valid = false;
            results.issues.push('Invalid week number.');
            return results;
        }

        if (!isNonEmptyString(studentId)) {
            results.valid = false;
            results.issues.push('Student ID is required.');
            return results;
        }

        // ---- PHASE 2: BUILD CLASS STARTS FROM METADATA ----
        var classStarts = [];
        var metadataKeys = metadata && metadata.classDurations ? Object.keys(metadata.classDurations) : [];
        var prefix = String(studentId) + '_' + String(week) + '_';

        for (var i = 0; i < metadataKeys.length; i++) {
            var key = metadataKeys[i];
            if (key.indexOf(prefix) !== 0) {
                continue;
            }

            var parts = key.split('_');
            if (parts.length !== 4) {
                results.warnings.push('Malformed metadata key: ' + key);
                results.stats.malformedEntries++;
                continue;
            }

            var dayKey = CalendarValidation.parseDay(parts[2]);
            var hourKey = CalendarValidation.parseHour(parts[3]);

            if (dayKey === null || hourKey === null) {
                results.warnings.push('Invalid metadata key format: ' + key);
                results.stats.malformedEntries++;
                continue;
            }

            if (dayKey < MIN_DAY || dayKey > MAX_DAY || hourKey < MIN_HOUR || hourKey > MAX_HOUR) {
                results.warnings.push('Metadata key out of bounds: ' + key);
                results.stats.malformedEntries++;
                continue;
            }

            var duration = getValidClassDuration(metadata.classDurations, key);
            if (duration === null) {
                results.warnings.push('Invalid duration in metadata: ' + key);
                results.stats.malformedEntries++;
                continue;
            }

            // Check if the class actually exists in the schedule
            if (!schedule[dayKey] || !schedule[dayKey][hourKey]) {
                results.issues.push('Orphan metadata at ' + getDayName(dayKey) + ' ' + hourKey + ':00 (no class)');
                results.stats.orphanMetadata++;
                results.valid = false;
                continue;
            }

            var disciplineId = schedule[dayKey][hourKey];
            if (!disciplineId) {
                results.issues.push('Orphan metadata at ' + getDayName(dayKey) + ' ' + hourKey + ':00 (empty schedule cell)');
                results.stats.orphanMetadata++;
                results.valid = false;
                continue;
            }

            // Validate duration matches actual occupancy
            var actualDuration = validateOccupiedDuration(schedule, dayKey, hourKey, disciplineId);
            if (actualDuration === null || actualDuration !== duration) {
                var dayName = getDayName(dayKey);
                results.issues.push('Duration mismatch at ' + dayName + ' ' + hourKey + ':00 (metadata: ' + duration + ', actual: ' + (actualDuration || 'inconsistent') + ')');
                results.stats.invalidClasses++;
                results.valid = false;
                continue;
            }

            // Check that the class doesn't extend beyond the day
            if (hourKey + duration > MAX_HOUR + 1) {
                var dayName = getDayName(dayKey);
                results.issues.push('Class extends beyond day boundary at ' + dayName + ' ' + hourKey + ':00 (duration: ' + duration + ')');
                results.stats.invalidClasses++;
                results.valid = false;
                continue;
            }

            classStarts.push({
                day: dayKey,
                hour: hourKey,
                duration: duration,
                disciplineId: disciplineId,
                key: key
            });
            results.stats.totalClasses++;
        }

        // ---- PHASE 3: FIND OCCUPIED RUNS NOT IN METADATA ----
        var occupiedRuns = findOccupiedRuns(schedule);

        for (var r = 0; r < occupiedRuns.length; r++) {
            var run = occupiedRuns[r];
            var foundInMetadata = false;

            for (var c = 0; c < classStarts.length; c++) {
                var cls = classStarts[c];
                if (cls.day === run.day && cls.hour === run.startHour &&
                    String(cls.disciplineId) === String(run.disciplineId)) {
                    foundInMetadata = true;
                    break;
                }
            }

            if (!foundInMetadata) {
                var dayName = getDayName(run.day);
                results.issues.push('Occupied run without metadata at ' + dayName + ' ' + run.startHour + ':00 - ' + (run.startHour + run.duration) + ':00 (' + run.disciplineId + ')');
                results.stats.invalidClasses++;
                results.valid = false;
            }
        }

        // ---- PHASE 4: CHECK FOR OVERLAPS ----
        for (var i = 0; i < classStarts.length; i++) {
            for (var j = i + 1; j < classStarts.length; j++) {
                var a = classStarts[i];
                var b = classStarts[j];

                if (a.day !== b.day) {
                    continue;
                }

                var aStart = a.hour;
                var aEnd = a.hour + a.duration;
                var bStart = b.hour;
                var bEnd = b.hour + b.duration;

                if (aStart < bEnd && bStart < aEnd) {
                    var dayName = getDayName(a.day);
                    results.issues.push('Overlapping classes on ' + dayName + ': ' + aStart + ':00-' + aEnd + ':00 and ' + bStart + ':00-' + bEnd + ':00');
                    results.stats.overlaps++;
                    results.valid = false;
                }
            }
        }

        // ---- PHASE 5: CHECK FOR GAPS IN MULTI-HOUR CLASSES ----
        for (var c = 0; c < classStarts.length; c++) {
            var cls = classStarts[c];
            var expectedDiscipline = cls.disciplineId;

            for (var h = cls.hour; h < cls.hour + cls.duration; h++) {
                if (!schedule[cls.day] || !schedule[cls.day][h]) {
                    var dayName = getDayName(cls.day);
                    results.issues.push('Gap in class at ' + dayName + ' ' + cls.hour + ':00 (missing hour ' + h + ':00)');
                    results.stats.gaps++;
                    results.valid = false;
                    break;
                }
                if (String(schedule[cls.day][h]) !== String(expectedDiscipline)) {
                    var dayName = getDayName(cls.day);
                    results.issues.push('Discipline mismatch in class at ' + dayName + ' ' + cls.hour + ':00 (hour ' + h + ':00 has different discipline)');
                    results.stats.gaps++;
                    results.valid = false;
                    break;
                }
            }
        }

        // ---- PHASE 6: CHECK ORPHAN METADATA IN OTHER STORES ----
        if (metadata) {
            var otherStores = ['classInstructors', 'classLabels', 'classGroupLabels', 'classLocations'];

            for (var s = 0; s < otherStores.length; s++) {
                var storeKey = otherStores[s];
                var store = metadata[storeKey];

                if (!store || typeof store !== 'object') {
                    continue;
                }

                for (var metaKey in store) {
                    if (!Object.prototype.hasOwnProperty.call(store, metaKey)) {
                        continue;
                    }

                    if (metaKey.indexOf(prefix) !== 0) {
                        continue;
                    }

                    var parts = metaKey.split('_');
                    if (parts.length !== 4) {
                        results.warnings.push('Malformed metadata key in ' + storeKey + ': ' + metaKey);
                        results.stats.malformedEntries++;
                        continue;
                    }

                    var dayKey = CalendarValidation.parseDay(parts[2]);
                    var hourKey = CalendarValidation.parseHour(parts[3]);

                    if (dayKey === null || hourKey === null) {
                        results.warnings.push('Invalid metadata key format in ' + storeKey + ': ' + metaKey);
                        results.stats.malformedEntries++;
                        continue;
                    }

                    // Check if there's a class start at this position
                    var isClassStart = false;
                    for (var c2 = 0; c2 < classStarts.length; c2++) {
                        if (classStarts[c2].day === dayKey && classStarts[c2].hour === hourKey) {
                            isClassStart = true;
                            break;
                        }
                    }

                    if (!isClassStart) {
                        var dayName = getDayName(dayKey);
                        results.warnings.push('Orphan metadata in ' + storeKey + ' at ' + dayName + ' ' + hourKey + ':00 (no class start)');
                        results.stats.orphanMetadata++;
                    }
                }
            }
        }

        // ---- PHASE 7: UPDATE STATS ----
        results.stats.validClasses = results.stats.totalClasses - results.stats.invalidClasses;

        return results;
    }

    // ============================================================
    // FIND OCCUPIED RUNS
    // ============================================================

    /**
     * Find all occupied runs in a schedule.
     * A run is a contiguous sequence of the same discipline.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @returns {Array} Array of runs { day, startHour, duration, disciplineId }
     */
    function findOccupiedRuns(schedule) {
        var runs = [];

        if (!schedule || typeof schedule !== 'object') {
            return runs;
        }

        for (var day in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                continue;
            }

            var dayNum = CalendarValidation.parseDay(day);
            if (dayNum === null) {
                continue;
            }

            var daySchedule = schedule[day];
            if (!isObject(daySchedule)) {
                continue;
            }

            var currentRun = null;
            var hours = Object.keys(daySchedule).sort(function(a, b) {
                return parseInt(a, 10) - parseInt(b, 10);
            });

            for (var h = 0; h < hours.length; h++) {
                var hourNum = CalendarValidation.parseHour(hours[h]);
                if (hourNum === null) {
                    continue;
                }

                var disciplineId = daySchedule[hours[h]];
                if (!disciplineId) {
                    continue;
                }

                if (currentRun === null) {
                    currentRun = {
                        day: dayNum,
                        startHour: hourNum,
                        duration: 1,
                        disciplineId: disciplineId
                    };
                } else if (String(currentRun.disciplineId) === String(disciplineId) &&
                           hourNum === currentRun.startHour + currentRun.duration) {
                    currentRun.duration++;
                } else {
                    runs.push(currentRun);
                    currentRun = {
                        day: dayNum,
                        startHour: hourNum,
                        duration: 1,
                        disciplineId: disciplineId
                    };
                }
            }

            if (currentRun !== null) {
                runs.push(currentRun);
            }
        }

        return runs;
    }

    // ============================================================
    // SPECIFIC CHECKS
    // ============================================================

    /**
     * Check for orphan metadata (metadata without matching schedule).
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} metadata - Metadata object with classDurations, etc.
     * @param {string} studentId - Student ID for metadata lookup
     * @param {number} week - Week number for metadata lookup
     * @returns {Array} Array of orphan metadata entries
     */
    function checkForOrphanMetadata(schedule, metadata, studentId, week) {
        var orphans = [];

        if (!metadata || typeof metadata !== 'object') {
            return orphans;
        }

        var prefix = String(studentId) + '_' + String(week) + '_';
        var stores = ['classDurations', 'classInstructors', 'classLabels', 'classGroupLabels', 'classLocations'];

        for (var s = 0; s < stores.length; s++) {
            var storeKey = stores[s];
            var store = metadata[storeKey];

            if (!store || typeof store !== 'object') {
                continue;
            }

            for (var key in store) {
                if (!Object.prototype.hasOwnProperty.call(store, key)) {
                    continue;
                }

                if (key.indexOf(prefix) !== 0) {
                    continue;
                }

                var parts = key.split('_');
                if (parts.length !== 4) {
                    continue;
                }

                var day = CalendarValidation.parseDay(parts[2]);
                var hour = CalendarValidation.parseHour(parts[3]);

                if (day === null || hour === null) {
                    continue;
                }

                if (!schedule[day] || !schedule[day][hour]) {
                    orphans.push({
                        key: key,
                        store: storeKey,
                        day: day,
                        hour: hour,
                        value: store[key]
                    });
                }
            }
        }

        return orphans;
    }

    /**
     * Check for gaps in multi-hour classes.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} durations - Class durations map { scheduleKey: duration }
     * @param {string} studentId - Student ID for metadata lookup
     * @param {number} week - Week number for metadata lookup
     * @returns {Array} Array of gap entries
     */
    function checkForGaps(schedule, durations, studentId, week) {
        var gaps = [];

        if (!schedule || typeof schedule !== 'object') {
            return gaps;
        }

        if (!durations || typeof durations !== 'object') {
            return gaps;
        }

        var prefix = String(studentId) + '_' + String(week) + '_';

        for (var key in durations) {
            if (!Object.prototype.hasOwnProperty.call(durations, key)) {
                continue;
            }

            if (key.indexOf(prefix) !== 0) {
                continue;
            }

            var parts = key.split('_');
            if (parts.length !== 4) {
                continue;
            }

            var day = CalendarValidation.parseDay(parts[2]);
            var hour = CalendarValidation.parseHour(parts[3]);

            if (day === null || hour === null) {
                continue;
            }

            var duration = getValidClassDuration(durations, key);
            if (duration === null) {
                continue;
            }

            var disciplineId = schedule[day] ? schedule[day][hour] : null;
            if (!disciplineId) {
                gaps.push({
                    key: key,
                    day: day,
                    hour: hour,
                    duration: duration,
                    reason: 'No class at start hour'
                });
                continue;
            }

            for (var h = hour; h < hour + duration; h++) {
                if (!schedule[day] || !schedule[day][h]) {
                    gaps.push({
                        key: key,
                        day: day,
                        hour: hour,
                        duration: duration,
                        missingHour: h,
                        reason: 'Missing hour ' + h + ':00'
                    });
                    break;
                }
                if (String(schedule[day][h]) !== String(disciplineId)) {
                    gaps.push({
                        key: key,
                        day: day,
                        hour: hour,
                        duration: duration,
                        missingHour: h,
                        reason: 'Discipline mismatch at ' + h + ':00'
                    });
                    break;
                }
            }
        }

        return gaps;
    }

    /**
     * Check for overlapping classes in a schedule.
     * 
     * @param {object} schedule - Schedule data { day: { hour: disciplineId } }
     * @param {object} durations - Class durations map { scheduleKey: duration }
     * @param {string} studentId - Student ID for metadata lookup
     * @param {number} week - Week number for metadata lookup
     * @returns {Array} Array of overlap entries
     */
    function checkForOverlaps(schedule, durations, studentId, week) {
        var overlaps = [];

        if (!schedule || typeof schedule !== 'object') {
            return overlaps;
        }

        if (!durations || typeof durations !== 'object') {
            return overlaps;
        }

        var prefix = String(studentId) + '_' + String(week) + '_';
        var classStarts = [];

        // Find all class starts with valid durations
        for (var key in durations) {
            if (!Object.prototype.hasOwnProperty.call(durations, key)) {
                continue;
            }

            if (key.indexOf(prefix) !== 0) {
                continue;
            }

            var parts = key.split('_');
            if (parts.length !== 4) {
                continue;
            }

            var day = CalendarValidation.parseDay(parts[2]);
            var hour = CalendarValidation.parseHour(parts[3]);

            if (day === null || hour === null) {
                continue;
            }

            var duration = getValidClassDuration(durations, key);
            if (duration === null) {
                continue;
            }

            var disciplineId = schedule[day] ? schedule[day][hour] : null;
            if (!disciplineId) {
                continue;
            }

            classStarts.push({
                key: key,
                day: day,
                hour: hour,
                duration: duration,
                disciplineId: disciplineId
            });
        }

        // Check for overlaps
        for (var i = 0; i < classStarts.length; i++) {
            for (var j = i + 1; j < classStarts.length; j++) {
                var a = classStarts[i];
                var b = classStarts[j];

                if (a.day !== b.day) {
                    continue;
                }

                var aStart = a.hour;
                var aEnd = a.hour + a.duration;
                var bStart = b.hour;
                var bEnd = b.hour + b.duration;

                if (aStart < bEnd && bStart < aEnd) {
                    overlaps.push({
                        classA: a,
                        classB: b,
                        day: a.day,
                        startHour: Math.min(aStart, bStart),
                        endHour: Math.max(aEnd, bEnd)
                    });
                }
            }
        }

        return overlaps;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.__calendarScheduleIntegrityLoaded = true;

    window.CalendarScheduleIntegrity = {
        // Main validation
        validateScheduleIntegrity: validateScheduleIntegrity,

        // Specific checks
        checkForOrphanMetadata: checkForOrphanMetadata,
        checkForGaps: checkForGaps,
        checkForOverlaps: checkForOverlaps,

        // Helpers
        findOccupiedRuns: findOccupiedRuns,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_DAY: MIN_DAY,
        MAX_DAY: MAX_DAY,
        MIN_HOUR: MIN_HOUR,
        MAX_HOUR: MAX_HOUR,
        MAX_DURATION: MAX_DURATION
    };

})();