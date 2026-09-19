/**
 * modules/academy/academy-teaching-collisions.js - Academy Teaching Collisions
 *
 * Path: js/modules/academy/academy-teaching-collisions.js
 *
 * Detects resource collisions in a week's projected teaching
 * schedule.
 *
 * WHAT THIS MODULE OWNS:
 *   - Reading the projector's occurrence list for a week.
 *   - Grouping occurrences by resource (student, instructor,
 *     location).
 *   - Detecting time overlaps within each resource's occurrences.
 *   - Returning a structured report of every collision found.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Occurrence projection. AcademyTeachingProjector owns it.
 *   - Weekly-hours validation. AcademyTeachingValidation owns it.
 *   - Mutations. Nothing in the schedule stack mutates here.
 *   - Policy. This module reports collisions; whether a specific
 *     collision should be forbidden is a domain decision. For
 *     example, an instructor teaching two groups at the same time
 *     is usually a collision, but a policy might allow it for a
 *     shared-assembly session. This module reports the fact;
 *     callers decide what to do.
 *
 * THE THREE RESOURCE TYPES:
 *
 *   student
 *     The same student appears in two occurrences whose times
 *     overlap in the same week. This is the case that matters most
 *     to a timetable: a human cannot be in two lessons at once.
 *
 *   instructor
 *     The same instructor appears in two occurrences whose times
 *     overlap in the same week.
 *
 *   location
 *     The same location appears in two occurrences whose times
 *     overlap in the same week.
 *
 *   Two students being in different lessons at the same time is
 *   NOT a collision. Two groups meeting at the same time is NOT a
 *   collision. Two groups meeting in the same room at the same
 *   time IS.
 *
 * WHY RESOURCE GROUPS:
 *   An instructor teaching the same group in two consecutive hours
 *   is not a collision — the hours do not overlap. An instructor
 *   teaching two different groups in the same hour IS a collision.
 *   Grouping by resource is the only way to make that distinction
 *   explicit. Grouping by time alone cannot tell the two apart.
 *
 * TIME OVERLAP:
 *   All sessions have integer start hours and integer durations.
 *   Two occurrences overlap when:
 *
 *     a.start < b.end && b.start < a.end
 *
 *   where end = start + duration.
 *
 *   A one-hour session at 9:00 and a one-hour session at 10:00 do
 *   not overlap. Two one-hour sessions at 9:00 do.
 *
 * REPORT SHAPE:
 *
 *   {
 *     week: number,
 *     collisions: [
 *       {
 *         resourceType: 'student' | 'instructor' | 'location',
 *         resourceId: string,
 *         week: number,
 *         day: number,
 *         sessionIds: [string, string, ...],  // 2+ session IDs
 *         occurrences: [Occurrence, ...]      // full details
 *       },
 *       ...
 *     ],
 *     count: number,
 *     hasAny: boolean
 *   }
 *
 *   A collision groups TOGETHER all occurrences of the same
 *   resource that overlap in time. If three sessions overlap for
 *   the same instructor at 9:00, they produce ONE collision entry
 *   with three sessionIds, not three separate pairwise collisions.
 *
 *   The grouping is by (resourceType, resourceId, day, timeRange).
 *   Two overlapping sessions at 9:00 are one entry. A separate
 *   overlap at 14:00 is a different entry.
 *
 * PURITY:
 *   Every function is a pure read over the projector's output.
 *   No storage access, no mutation, no DOM, no global state.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyTeachingProjector
 *   - window.CalendarValidation
 */

(function() {
    'use strict';

    if (window.__academyTeachingCollisionsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var Projector = window.AcademyTeachingProjector;
    var CalendarValidation = window.CalendarValidation;

    var _missing = [];

    if (!Projector) {
        _missing.push('AcademyTeachingProjector (module)');
    } else {
        if (typeof Projector.projectWeek !== 'function') {
            _missing.push('AcademyTeachingProjector.projectWeek');
        }
    }

    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTeachingCollisions] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyTeachingCollisionsLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    /**
     * Parse a week via the canonical parser. The parser is a
     * mandatory dependency: the module is only reachable after
     * CalendarValidation is loaded (the projector requires it at
     * its own load time), so no fallback is needed.
     */
    function parseWeek(week) {
        return CalendarValidation.parseWeek(week);
    }

    /**
     * Compute an occurrence's end hour.
     * Inclusive on start, exclusive on end (as any interval is).
     */
    function getEndTime(occurrence) {
        return occurrence.startTime + occurrence.duration;
    }

    /**
     * Do two occurrences overlap in time?
     *
     * Two occurrences overlap when they are on the same day and:
     *
     *   a.start < b.end  AND  b.start < a.end
     *
     * where end = start + duration.
     *
     * The `<` (not `<=`) on both bounds means back-to-back sessions
     * (9-10 and 10-11) do not overlap.
     */
    function occurrencesOverlap(a, b) {
        if (a.day !== b.day) { return false; }
        var aEnd = getEndTime(a);
        var bEnd = getEndTime(b);
        return a.startTime < bEnd && b.startTime < aEnd;
    }

    // ============================================================
    // RESOURCE INDEXING
    // ============================================================

    /**
     * Build a Map-like object grouping occurrences by resource.
     *
     * Keys are `${resourceType}:${resourceId}`.
     * Values are arrays of occurrences.
     */
    function indexByResource(occurrences, resourceType) {
        var groups = Object.create(null);

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];
            if (!isPlainObject(occ)) { continue; }

            if (resourceType === 'student') {
                addOccurrenceForStudent(occ, groups);
            } else if (resourceType === 'instructor') {
                addOccurrenceForInstructor(occ, groups);
            } else if (resourceType === 'location') {
                addOccurrenceForLocation(occ, groups);
            }
        }

        return groups;
    }

    function addOccurrenceForStudent(occ, groups) {
        if (!Array.isArray(occ.studentIds)) { return; }
        for (var i = 0; i < occ.studentIds.length; i++) {
            var id = occ.studentIds[i];
            if (!isNonEmptyString(id)) { continue; }
            var key = 'student:' + id;
            if (!groups[key]) {
                groups[key] = {
                    resourceType: 'student',
                    resourceId: String(id),
                    occurrences: []
                };
            }
            groups[key].occurrences.push(occ);
        }
    }

    function addOccurrenceForInstructor(occ, groups) {
        var id = occ.instructorId;
        if (!isNonEmptyString(id)) { return; }
        var key = 'instructor:' + id;
        if (!groups[key]) {
            groups[key] = {
                resourceType: 'instructor',
                resourceId: String(id),
                occurrences: []
            };
        }
        groups[key].occurrences.push(occ);
    }

    function addOccurrenceForLocation(occ, groups) {
        var id = occ.locationId;
        if (!isNonEmptyString(id)) { return; }
        var key = 'location:' + id;
        if (!groups[key]) {
            groups[key] = {
                resourceType: 'location',
                resourceId: String(id),
                occurrences: []
            };
        }
        groups[key].occurrences.push(occ);
    }

    // ============================================================
    // COLLISION DETECTION WITHIN A GROUP
    // ============================================================

    /**
     * For one resource group, find all time-overlapping clusters
     * of occurrences.
     *
     * Algorithm:
     *   Sort occurrences by (day, startTime, sessionId). Walk them.
     *   Maintain a running "cluster": the first occurrence is the
     *   cluster seed. For each subsequent occurrence, if it overlaps
     *   ANY occurrence already in the cluster, it joins the cluster.
     *   Otherwise the cluster is emitted and a new one starts.
     *
     *   Because sessions are sorted by (day, startTime), once a
     *   session starts after the latest-ending session in the
     *   cluster, no later session can overlap the cluster either.
     *   So a single-pass walk is correct.
     *
     *   The cluster is emitted only when it has 2+ members. Singletons
     *   are not collisions.
     */
    function findCollisionsInGroup(group) {
        var occurrences = group.occurrences.slice();

        occurrences.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
            return String(a.sessionId).localeCompare(String(b.sessionId));
        });

        var collisions = [];

        var cluster = [];
        var clusterLatestEnd = -1;
        var clusterDay = -1;

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];

            var startsNewCluster = false;

            if (cluster.length === 0) {
                startsNewCluster = true;
            } else if (occ.day !== clusterDay) {
                startsNewCluster = true;
            } else if (occ.startTime >= clusterLatestEnd) {
                // No overlap with the cluster: the occurrence starts
                // at or after the cluster's latest end.
                startsNewCluster = true;
            } else {
                // Overlaps the cluster's latest-ending member; since
                // the cluster's latest end is the max end time of all
                // its members, it also overlaps at least one member.
                // But we still need to confirm at least one actual
                // overlap, because `startTime < clusterLatestEnd`
                // implies the new session started before the last
                // session ended. That IS the definition of overlap.
            }

            if (startsNewCluster) {
                emitClusterIfCollision(
                    group, cluster, collisions
                );
                cluster = [occ];
                clusterLatestEnd = getEndTime(occ);
                clusterDay = occ.day;
            } else {
                cluster.push(occ);
                var end = getEndTime(occ);
                if (end > clusterLatestEnd) {
                    clusterLatestEnd = end;
                }
            }
        }

        emitClusterIfCollision(group, cluster, collisions);

        return collisions;
    }

    function emitClusterIfCollision(group, cluster, out) {
        if (cluster.length < 2) { return; }

        // Build the collision report entry.
        var sessionIds = [];
        for (var i = 0; i < cluster.length; i++) {
            sessionIds.push(cluster[i].sessionId);
        }

        out.push({
            resourceType: group.resourceType,
            resourceId: group.resourceId,
            week: cluster[0].week,
            day: cluster[0].day,
            sessionIds: sessionIds,
            occurrences: cluster.slice()
        });
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Detect every collision in a given week.
     *
     * @param {number|string} week
     * @returns {object} {
     *   week,
     *   collisions: [CollisionEntry],
     *   count,
     *   hasAny
     * }
     */
    function detectCollisions(week) {
        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return {
                week: null,
                collisions: [],
                count: 0,
                hasAny: false
            };
        }

        var occurrences = Projector.projectWeek(weekNum);
        return detectCollisionsInOccurrences(weekNum, occurrences);
    }

    /**
     * Detect collisions across an already-projected occurrence
     * list. Useful when a caller has already obtained the
     * occurrences and does not want to re-project.
     *
     * @param {number} week
     * @param {array} occurrences
     * @returns {object} same shape as detectCollisions
     */
    function detectCollisionsInOccurrences(week, occurrences) {
        var weekNum = parseWeek(week);
        var list = Array.isArray(occurrences) ? occurrences : [];

        if (weekNum === null) {
            return {
                week: null,
                collisions: [],
                count: 0,
                hasAny: false
            };
        }

        var allCollisions = [];

        var resourceTypes = ['student', 'instructor', 'location'];
        for (var t = 0; t < resourceTypes.length; t++) {
            var groups = indexByResource(list, resourceTypes[t]);
            var keys = Object.keys(groups);
            for (var k = 0; k < keys.length; k++) {
                var group = groups[keys[k]];
                var collisions = findCollisionsInGroup(group);
                for (var c = 0; c < collisions.length; c++) {
                    allCollisions.push(collisions[c]);
                }
            }
        }

        // Stable order: by resourceType, then resourceId, then day,
        // then time. So the same input produces the same output.
        allCollisions.sort(function(a, b) {
            if (a.resourceType !== b.resourceType) {
                return a.resourceType < b.resourceType ? -1 : 1;
            }
            if (a.resourceId !== b.resourceId) {
                return a.resourceId < b.resourceId ? -1 : 1;
            }
            if (a.day !== b.day) { return a.day - b.day; }
            return 0;
        });

        return {
            week: weekNum,
            collisions: allCollisions,
            count: allCollisions.length,
            hasAny: allCollisions.length > 0
        };
    }

    /**
     * Convenience: check whether a specific resource has any
     * collisions in a given week.
     *
     * @param {string} resourceType - 'student' | 'instructor' | 'location'
     * @param {string} resourceId
     * @param {number|string} week
     * @returns {boolean}
     */
    function hasCollisionsFor(resourceType, resourceId, week) {
        if (!isNonEmptyString(resourceType) ||
            !isNonEmptyString(resourceId)) {
            return false;
        }
        if (resourceType !== 'student' &&
            resourceType !== 'instructor' &&
            resourceType !== 'location') {
            return false;
        }

        var report = detectCollisions(week);
        for (var i = 0; i < report.collisions.length; i++) {
            var c = report.collisions[i];
            if (c.resourceType === resourceType &&
                c.resourceId === String(resourceId)) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTeachingCollisions = Object.freeze({
        detectCollisions: detectCollisions,
        detectCollisionsInOccurrences: detectCollisionsInOccurrences,
        hasCollisionsFor: hasCollisionsFor
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTeachingCollisions;
        var missing = [];

        var required = [
            'detectCollisions',
            'detectCollisionsInOccurrences',
            'hasCollisionsFor'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke tests on the pure pieces: overlap detection and the
        // single-pass cluster walk. These do not require the
        // projector to be wired up.
        try {
            // No overlap: back-to-back sessions.
            if (occurrencesOverlap(
                { day: 1, startTime: 9, duration: 1 },
                { day: 1, startTime: 10, duration: 1 }
            ) !== false) {
                missing.push('back-to-back sessions were flagged as overlapping');
            }

            // Overlap: same slot.
            if (occurrencesOverlap(
                { day: 1, startTime: 9, duration: 1 },
                { day: 1, startTime: 9, duration: 1 }
            ) !== true) {
                missing.push('identical slots were not flagged as overlapping');
            }

            // Overlap: partial.
            if (occurrencesOverlap(
                { day: 1, startTime: 9, duration: 2 },
                { day: 1, startTime: 10, duration: 2 }
            ) !== true) {
                missing.push('partial overlap was not detected');
            }

            // No overlap: different days.
            if (occurrencesOverlap(
                { day: 1, startTime: 9, duration: 2 },
                { day: 2, startTime: 9, duration: 2 }
            ) !== false) {
                missing.push('different days were flagged as overlapping');
            }

            // Cluster walk: two overlapping sessions produce one
            // collision entry, not two.
            var group1 = {
                resourceType: 'instructor',
                resourceId: 'inst_1',
                occurrences: [
                    { sessionId: 's1', week: 1, day: 1, startTime: 9, duration: 1 },
                    { sessionId: 's2', week: 1, day: 1, startTime: 9, duration: 1 }
                ]
            };
            var collisions1 = findCollisionsInGroup(group1);
            if (collisions1.length !== 1) {
                missing.push(
                    'two overlapping sessions for one instructor ' +
                    'produced ' + collisions1.length +
                    ' collision entries instead of 1'
                );
            } else if (collisions1[0].sessionIds.length !== 2) {
                missing.push(
                    'collision entry did not contain both sessions'
                );
            }

            // Cluster walk: three overlapping sessions produce ONE
            // entry with three sessions, not three pairwise entries.
            var group2 = {
                resourceType: 'student',
                resourceId: 'char_1',
                occurrences: [
                    { sessionId: 's1', week: 1, day: 1, startTime: 9, duration: 1 },
                    { sessionId: 's2', week: 1, day: 1, startTime: 9, duration: 1 },
                    { sessionId: 's3', week: 1, day: 1, startTime: 9, duration: 1 }
                ]
            };
            var collisions2 = findCollisionsInGroup(group2);
            if (collisions2.length !== 1 ||
                collisions2[0].sessionIds.length !== 3) {
                missing.push(
                    'three overlapping sessions did not collapse into ' +
                    'one entry with three sessions'
                );
            }

            // Cluster walk: two disjoint overlaps on the same day
            // produce two entries.
            var group3 = {
                resourceType: 'student',
                resourceId: 'char_1',
                occurrences: [
                    { sessionId: 's1', week: 1, day: 1, startTime: 9, duration: 1 },
                    { sessionId: 's2', week: 1, day: 1, startTime: 9, duration: 1 },
                    { sessionId: 's3', week: 1, day: 1, startTime: 14, duration: 1 },
                    { sessionId: 's4', week: 1, day: 1, startTime: 14, duration: 1 }
                ]
            };
            var collisions3 = findCollisionsInGroup(group3);
            if (collisions3.length !== 2) {
                missing.push(
                    'two disjoint overlaps did not produce two entries ' +
                    '(got ' + collisions3.length + ')'
                );
            }

            // Cluster walk: singletons are not collisions.
            var group4 = {
                resourceType: 'location',
                resourceId: 'loc_1',
                occurrences: [
                    { sessionId: 's1', week: 1, day: 1, startTime: 9, duration: 1 },
                    { sessionId: 's2', week: 1, day: 1, startTime: 10, duration: 1 }
                ]
            };
            var collisions4 = findCollisionsInGroup(group4);
            if (collisions4.length !== 0) {
                missing.push(
                    'non-overlapping sessions produced a collision entry'
                );
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTeachingCollisions] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();