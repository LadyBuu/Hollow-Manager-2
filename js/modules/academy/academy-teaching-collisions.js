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
 * CLUSTERING ALGORITHM:
 *   Collisions are reported as CONNECTED OVERLAP CLUSTERS, not as
 *   pairwise entries.
 *
 *   A cluster is a maximal set of occurrences for one resource
 *   where each member overlaps at least one other member of the
 *   same cluster. A chain of overlaps is one collision entry, not
 *   N-1 pairwise entries.
 *
 *   Concretely:
 *
 *     A 9-10, B 9-10, C 9-10        → one cluster {A,B,C}
 *     A 9-10, B 9-10, C 10-11       → cluster {A,B} and a
 *                                      singleton {C}
 *     A 9-10, B 9-10, C 14-15,
 *       D 14-15                     → two clusters {A,B}, {C,D}
 *     A 9-11, B 10-12, C 12-13      → cluster {A,B} and singleton
 *                                      {C} (B and C do not
 *                                      overlap)
 *
 *   The cluster walk sorts by (day, startTime, sessionId), then
 *   walks with a running "latest end" pointer. A new session
 *   joins the current cluster iff its startTime is strictly less
 *   than the cluster's latest end. That is exactly the overlap
 *   condition against the cluster's latest-ending member, and
 *   because the cluster's latest end is the maximum of all its
 *   members' end times, it is also the condition against at least
 *   one member.
 *
 *   Clusters with fewer than two members are not collisions and
 *   are dropped.
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
 *         startTime: number,
 *         endTime: number,
 *         sessionIds: [string, string, ...],
 *         occurrences: [Occurrence, ...]
 *       },
 *       ...
 *     ],
 *     count: number,
 *     hasAny: boolean
 *   }
 *
 *   startTime and endTime describe the cluster's overall occupied
 *   window: the minimum startTime across members and the maximum
 *   endTime. For a cluster of one member they would be that
 *   member's window; singletons are dropped, so they never appear.
 *
 *   A collision groups TOGETHER all occurrences of the same
 *   resource that overlap in time. If three sessions overlap for
 *   the same instructor at 9:00, they produce ONE collision entry
 *   with three sessionIds, not three separate pairwise collisions.
 *
 * OCCURRENCE INPUT CONTRACT:
 *   detectCollisionsInOccurrences expects an array of occurrences
 *   produced by AcademyTeachingProjector.projectWeek. The fields
 *   this module reads:
 *
 *     sessionId  — non-empty string, unique per occurrence in the
 *                  week. Not used for grouping, used for identity
 *                  in the report and for sort tie-breaking.
 *     week       — non-negative integer, the week being queried.
 *                  Used in the report only.
 *     day        — positive integer, 1-7. Used for overlap.
 *     startTime  — non-negative integer, hour. Used for overlap.
 *     duration   — positive integer, hours. Used for overlap.
 *
 *   The resource-indexing fields:
 *
 *     instructorId — non-empty string, ALWAYS present. Per the
 *                    projector's occurrence contract, every
 *                    occurrence names an instructor. A null or
 *                    undefined instructorId is a contract
 *                    violation and throws.
 *     locationId   — non-empty string OR null. Null is
 *                    legitimate: it means no location is assigned
 *                    to this occurrence. A null locationId is
 *                    silently skipped, not treated as a violation.
 *     studentIds   — array of non-empty strings, present on class
 *                    occurrences only. Absent (not an array) on
 *                    commitment occurrences; those are silently
 *                    skipped by student indexing. A null or
 *                    undefined studentIds on an occurrence that
 *                    otherwise looks like a class occurrence is a
 *                    contract violation, but this module cannot
 *                    distinguish "not a class occurrence" from
 *                    "malformed class occurrence" without
 *                    inspecting `kind`. It treats a missing
 *                    studentIds array as "not a class occurrence"
 *                    and skips. Commitments are the only
 *                    non-class occurrences today.
 *
 *   assertOccurrence(occ) checks the fields the algorithm reads
 *   (sessionId, week, day, startTime, duration). It does not
 *   check the resource-indexing fields; those are validated by
 *   the indexing functions, which apply the per-field policy
 *   above.
 *
 * RESOURCE MISSING-ID POLICY:
 *   The projector guarantees instructorId on every occurrence.
 *   A missing instructorId is therefore a contract violation and
 *   throws. This is symmetric to the projector's own throw on
 *   malformed records: a broken contract surfaces where it is
 *   used, not where it is silently swallowed.
 *
 *   studentIds and locationId follow the projector's null-
 *   semantics: null means "absent on this occurrence" and is
 *   skipped without error. Their absence is data, not a bug.
 *
 * PURITY:
 *   Every function is a pure read over the projector's output.
 *   No storage access, no mutation, no DOM, no global state.
 *
 * DEDUPLICATION CONTRACT:
 *   This module does not deduplicate occurrences. If the projector
 *   emits the same session twice — which it should not, but a bug
 *   in the projector or an unusual snapshot could produce — the
 *   duplicate appears in the report as two occurrences that
 *   overlap, and is reported as a collision. The cluster walk
 *   does not check occurrence identity beyond the sort order.
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
     * Assert the fields collision detection reads.
     *
     * This is the minimum set the algorithm needs:
     *   - sessionId  : identity for the report and for tie-breaks
     *   - week       : the week being queried (used in the report)
     *   - day        : overlap axis
     *   - startTime  : overlap axis
     *   - duration   : overlap axis (end = start + duration)
     *
     * The resource-indexing fields (instructorId, locationId,
     * studentIds) are NOT checked here. Their absence is handled
     * per-field by the indexing functions, per the projector's
     * occurrence contract.
     *
     * Throws on any violation. A malformed occurrence is a
     * projector bug, not evidence that the occurrence does not
     * exist.
     */
    function assertOccurrence(occ, index) {
        var where = (index === undefined || index === null)
            ? 'occurrence'
            : 'occurrence at index ' + index;

        if (!isPlainObject(occ)) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ': expected a plain object, got ' +
                (occ === null ? 'null' :
                 Array.isArray(occ) ? 'array' :
                 typeof occ) + '.'
            );
        }

        if (!isNonEmptyString(occ.sessionId)) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ': sessionId must be a non-empty string.'
            );
        }

        if (typeof occ.week !== 'number' ||
            !isFinite(occ.week) ||
            !Number.isInteger(occ.week) ||
            occ.week < 0) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ' (sessionId ' + occ.sessionId + '): week must be a ' +
                'non-negative integer.'
            );
        }

        if (typeof occ.day !== 'number' ||
            !isFinite(occ.day) ||
            !Number.isInteger(occ.day) ||
            occ.day < 1) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ' (sessionId ' + occ.sessionId + '): day must be a ' +
                'positive integer.'
            );
        }

        if (typeof occ.startTime !== 'number' ||
            !isFinite(occ.startTime) ||
            !Number.isInteger(occ.startTime) ||
            occ.startTime < 0) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ' (sessionId ' + occ.sessionId + '): startTime must ' +
                'be a non-negative integer.'
            );
        }

        if (typeof occ.duration !== 'number' ||
            !isFinite(occ.duration) ||
            !Number.isInteger(occ.duration) ||
            occ.duration < 1) {
            throw new Error(
                '[AcademyTeachingCollisions] Malformed ' + where +
                ' (sessionId ' + occ.sessionId + '): duration must be ' +
                'a positive integer.'
            );
        }
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
    //
    // Each indexing function applies the projector's per-field
    // policy:
    //
    //   student
    //     Reads occ.studentIds. A missing or non-array studentIds
    //     is treated as "not a class occurrence" and the
    //     occurrence is skipped. Commitments are the only
    //     non-class occurrences today.
    //
    //   instructor
    //     Reads occ.instructorId. Per the projector's contract,
    //     instructorId is ALWAYS present on every occurrence. A
    //     null or undefined instructorId is a contract violation
    //     and throws.
    //
    //   location
    //     Reads occ.locationId. A null locationId is legitimate
    //     and the occurrence is skipped (no location to collide
    //     on). A non-string non-null locationId is a contract
    //     violation and throws.
    //
    // Groups keys are `${resourceType}:${resourceId}`.
    // Values are arrays of occurrences.

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
        if (!Array.isArray(occ.studentIds)) {
            // Not a class occurrence (or a malformed one). The
            // projector's contract says commitment occurrences do
            // not carry studentIds. Skip; the occurrence is
            // handled by the instructor and location indexers.
            return;
        }
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

        if (id === null || id === undefined) {
            throw new Error(
                '[AcademyTeachingCollisions] Occurrence ' +
                occ.sessionId + ' is missing an instructorId. The ' +
                'projector\'s occurrence contract requires every ' +
                'occurrence to name an instructor.'
            );
        }

        if (!isNonEmptyString(id)) {
            throw new Error(
                '[AcademyTeachingCollisions] Occurrence ' +
                occ.sessionId + ' has an invalid instructorId (' +
                JSON.stringify(id) + ').'
            );
        }

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

        if (id === null || id === undefined) {
            // Legitimate. No location assigned; nothing to
            // collide against.
            return;
        }

        if (!isNonEmptyString(id)) {
            throw new Error(
                '[AcademyTeachingCollisions] Occurrence ' +
                occ.sessionId + ' has an invalid locationId (' +
                JSON.stringify(id) + ').'
            );
        }

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
     *   Maintain a running cluster: the first occurrence is the
     *   cluster seed. For each subsequent occurrence, if its
     *   startTime is strictly less than the cluster's latest end,
     *   it overlaps the latest-ending member and joins the
     *   cluster. Otherwise the cluster is emitted and a new one
     *   starts.
     *
     *   Because sessions are sorted by (day, startTime), once a
     *   session starts at or after the cluster's latest end, no
     *   later session can overlap the cluster either. A single-
     *   pass walk is correct.
     *
     *   The cluster is emitted only when it has 2+ members.
     *   Singletons are not collisions.
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
        var clusterEarliestStart = -1;
        var clusterDay = -1;

        for (var i = 0; i < occurrences.length; i++) {
            var occ = occurrences[i];

            var startsNewCluster = false;

            if (cluster.length === 0) {
                startsNewCluster = true;
            } else if (occ.day !== clusterDay) {
                startsNewCluster = true;
            } else if (occ.startTime >= clusterLatestEnd) {
                // No overlap: the occurrence starts at or after the
                // cluster's latest end. Since the cluster's latest
                // end is the maximum of all its members' end times,
                // starting at or after it is exactly the condition
                // for not overlapping any member.
                startsNewCluster = true;
            }

            if (startsNewCluster) {
                emitClusterIfCollision(
                    group, cluster, collisions
                );
                cluster = [occ];
                clusterLatestEnd = getEndTime(occ);
                clusterEarliestStart = occ.startTime;
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

        var sessionIds = [];
        var earliestStart = Infinity;
        var latestEnd = -Infinity;

        for (var i = 0; i < cluster.length; i++) {
            var occ = cluster[i];
            sessionIds.push(occ.sessionId);

            if (occ.startTime < earliestStart) {
                earliestStart = occ.startTime;
            }
            var end = getEndTime(occ);
            if (end > latestEnd) {
                latestEnd = end;
            }
        }

        out.push({
            resourceType: group.resourceType,
            resourceId: group.resourceId,
            week: cluster[0].week,
            day: cluster[0].day,
            startTime: earliestStart,
            endTime: latestEnd,
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

        if (weekNum === null) {
            return {
                week: null,
                collisions: [],
                count: 0,
                hasAny: false
            };
        }

        if (!Array.isArray(occurrences)) {
            throw new Error(
                '[AcademyTeachingCollisions] ' +
                'detectCollisionsInOccurrences requires an array of ' +
                'occurrences. Got ' +
                (occurrences === null ? 'null' :
                 typeof occurrences) + '.'
            );
        }

        // Assert every occurrence up front. This is a hard failure
        // on malformed input, not a silent skip. See the file
        // header for the contract.
        for (var v = 0; v < occurrences.length; v++) {
            assertOccurrence(occurrences[v], v);
        }

        var allCollisions = [];

        var resourceTypes = ['student', 'instructor', 'location'];
        for (var t = 0; t < resourceTypes.length; t++) {
            var groups = indexByResource(
                occurrences, resourceTypes[t]
            );
            var keys = Object.keys(groups);
            for (var k = 0; k < keys.length; k++) {
                var group = groups[keys[k]];
                var collisions = findCollisionsInGroup(group);
                for (var c = 0; c < collisions.length; c++) {
                    allCollisions.push(collisions[c]);
                }
            }
        }

        // Stable order: by resourceType, then resourceId, then
        // day, then startTime. So the same input produces the
        // same output.
        allCollisions.sort(function(a, b) {
            if (a.resourceType !== b.resourceType) {
                return a.resourceType < b.resourceType ? -1 : 1;
            }
            if (a.resourceId !== b.resourceId) {
                return a.resourceId < b.resourceId ? -1 : 1;
            }
            if (a.day !== b.day) { return a.day - b.day; }
            if (a.startTime !== b.startTime) {
                return a.startTime - b.startTime;
            }
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
     * NAMING AND COST:
     *   The name says what it does: checks one resource for
     *   collisions. It reprojects the week on every call, because
     *   it delegates to detectCollisions.
     *
     *   Not for bulk UI loops. A caller that needs to check many
     *   resources for the same week should call detectCollisions
     *   once and filter the returned list.
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

        // Smoke tests on the pure pieces: overlap detection and
        // the single-pass cluster walk. These do not require the
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

            // Cluster walk: three-session chain produces one entry
            // (transitive overlap), not three.
            var group5 = {
                resourceType: 'instructor',
                resourceId: 'inst_2',
                occurrences: [
                    { sessionId: 's1', week: 1, day: 1, startTime: 9, duration: 2 },
                    { sessionId: 's2', week: 1, day: 1, startTime: 10, duration: 2 },
                    { sessionId: 's3', week: 1, day: 1, startTime: 11, duration: 1 }
                ]
            };
            var collisions5 = findCollisionsInGroup(group5);
            if (collisions5.length !== 1 ||
                collisions5[0].sessionIds.length !== 3) {
                missing.push(
                    'a transitive overlap chain did not collapse into ' +
                    'one cluster'
                );
            }

            // Collision entry carries startTime/endTime.
            var entry5 = collisions5[0];
            if (entry5.startTime !== 9 || entry5.endTime !== 12) {
                missing.push(
                    'collision entry startTime/endTime do not span ' +
                    'the cluster (got ' + entry5.startTime + '-' +
                    entry5.endTime + ')'
                );
            }

            // Missing instructorId throws.
            var threw = false;
            try {
                addOccurrenceForInstructor(
                    { sessionId: 'sx', instructorId: null },
                    Object.create(null)
                );
            } catch (e) {
                threw = true;
            }
            if (threw !== true) {
                missing.push(
                    'a null instructorId was accepted; it should throw'
                );
            }

            // Null locationId is legitimate and skipped.
            var locGroups = Object.create(null);
            addOccurrenceForLocation(
                { sessionId: 'sy', locationId: null },
                locGroups
            );
            if (Object.keys(locGroups).length !== 0) {
                missing.push(
                    'a null locationId produced a resource group; it ' +
                    'should be skipped'
                );
            }

            // Missing studentIds is legitimate (not a class
            // occurrence) and skipped.
            var stuGroups = Object.create(null);
            addOccurrenceForStudent(
                { sessionId: 'sz' },
                stuGroups
            );
            if (Object.keys(stuGroups).length !== 0) {
                missing.push(
                    'an occurrence with no studentIds produced a ' +
                    'resource group; it should be skipped'
                );
            }

            // assertOccurrence rejects a bad duration.
            var threw2 = false;
            try {
                assertOccurrence(
                    { sessionId: 's1', week: 1, day: 1,
                      startTime: 9, duration: 0 },
                    0
                );
            } catch (e) {
                threw2 = true;
            }
            if (threw2 !== true) {
                missing.push(
                    'assertOccurrence accepted a zero duration'
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
