/**
 * modules/academy/academy-aggregator.js - Academy Aggregator
 * Cross-domain projection builder for the Academy domain.
 *
 * Path: js/modules/academy/academy-aggregator.js
 *
 * PROJECTIONS:
 *   Classes:
 *     getClassListViewModel()
 *     getClassViewModel(classId, week)
 *     getClassStudentsViewModel(classId, week)
 *
 *   People:
 *     getPeopleViewModel(classId, options)
 *
 *   Characters:
 *     getStudentViewModel(studentId, options)
 *     getInstructorViewModel(instructorId, options)
 *
 *   Instructor:
 *     getClassInstructorDisciplines(classId, instructorId, week)
 *     getInstructorGroupPickerViewModel(classId, instructorId, disciplineId, week)
 *
 *   Disciplines:
 *     getDisciplineListViewModel(filters)
 *     getDisciplineEditorViewModel(options)
 *
 *   Class-discipline picker (v27):
 *     getClassDisciplinesPickerViewModel(classId, options)
 *
 *   Rankings:
 *     getRankingViewModel(classId, week)
 *
 *   Locations:
 *     getLocationViewModel(filters, week, selectedLocationId)
 *
 *   Weekly Teams:
 *     getWeeklyTeamsViewModel(classId, week, selectedTeamId)
 *     getWeeklyTeamMemberManagerViewModel({ classId, teamId, week })
 *     getUnassignedTeamsViewModel({ classId })
 *
 *   Rebalance (v32):
 *     getRebalanceInputViewModel(classId, disciplineId, week, options)
 *
 *   Free slots (v33):
 *     getFreeSlotCandidateStudentsViewModel(classId, disciplineId, week)
 *
 * IMPORTANT:
 *   - Projection builder. Never mutates. No UI dependencies.
 *   - Composes domain modules. Never walks raw storage.
 *   - No fallback values for missing domain data. When a source is
 *     absent, the projection returns null or an empty collection.
 *   - The class VM is deliberately small (header fields only). It
 *     does NOT carry an instructor field; see INSTRUCTOR-OF-CLASS
 *     below.
 *
 * INSTRUCTOR-OF-CLASS — TWO QUERIES, TWO QUESTIONS:
 *
 *   "Who is an instructor of this class?"
 *
 *     character.mode === 'instructor'
 *       AND this class is in character.classIds
 *
 *   That is the whole rule. It is a YEAR-LEVEL fact. It does not
 *   change when a discipline stops running for the term. It does
 *   not change week to week. A character who taught this class
 *   during weeks 1-4 and stopped is still an instructor of this
 *   class in week 12. The role is theirs until the class or the
 *   role itself changes.
 *
 *   This is the answer used for roster derivation, role
 *   classification, the People sidebar, the Weekly Teams candidate
 *   pool, and the Add-Character-to-Class picker.
 *
 *   "Who is actively teaching this class this week?"
 *
 *     AcademyClasses.getClassInstructorIds(classId, week)
 *
 *   Week-scoped. Reads per-discipline instructor enrolments and
 *   filters by week. A character who taught weeks 1-4 is NOT in the
 *   week-12 answer, even though they are still an instructor of
 *   this class.
 *
 *   This is the answer used for schedule collision detection, the
 *   teaching projector, the ranking view's instructor-exclusion
 *   list (ranking eligibility is a live-schedule question), and
 *   anywhere else that needs to know what is actually running.
 *
 *   The two are deliberately separate. They used to be conflated:
 *   the roster derivation, role classification, and candidate
 *   pools all reached for the week-scoped query, which meant an
 *   instructor whose disciplines had ended for the term silently
 *   became a student in every derived view. The character's stored
 *   mode was correct throughout; only the views were wrong. That
 *   bug is fixed here: those views now consult the year-level
 *   rule.
 *
 * INSTRUCTOR DISCIPLINES (v27):
 *   getClassInstructorDisciplines(classId, instructorId, week)
 *   answers "which of this class's disciplines does this specific
 *   instructor teach during this week?" It reads per-discipline
 *   instructor enrolments, filtered to the class's offerings that
 *   are active in the week.
 *
 *   It is the per-instructor mirror of
 *   AcademyClasses.getClassInstructorIds, which answers the same
 *   question for every instructor at once.
 *
 *   The result is what the instructor-schedule modal's discipline
 *   dropdown consumes.
 *
 * INSTRUCTOR GROUP PICKER (v28):
 *   getInstructorGroupPickerViewModel(classId, instructorId,
 *   disciplineId, week) answers "which existing teaching groups
 *   exist for this (class, discipline, instructor) triple that
 *   are active during this week, and what are their display names
 *   and counts?"
 *
 *   The result is what the instructor-schedule modal's group
 *   dropdown consumes.
 *
 *   DEPENDENCY NOTE:
 *     This projection requires AcademyTeachingGroups and
 *     AcademyTeachingSessions. Neither is a load-time dependency
 *     of this aggregator; both are resolved at call time. A
 *     missing module throws — it is not silently treated as "no
 *     groups." See the function's own comment for why.
 *
 * REBALANCE INPUT (v32):
 *   getRebalanceInputViewModel(classId, disciplineId, week, options)
 *   assembles the input object AcademyBalanceSuggestions.suggest
 *   consumes. It does NOT run the algorithm; that is the caller's
 *   job.
 *
 *   The VM carries:
 *     - every enrolled student of this class-discipline who is
 *       active this week (via AcademyEnrolments.getEnrolledStudents)
 *     - each student's occupied slots for the week (via
 *       AcademyTeachingProjector.projectForStudent)
 *     - every existing teaching group of this (class, discipline)
 *       pair (via AcademyTeachingGroups.getGroupsForDiscipline)
 *     - each group's sessions (via
 *       AcademyTeachingSessions.getSessionsForGroup)
 *
 *   ELIMINATED STUDENTS:
 *     A student who was enrolled at the start of the year but has
 *     since been eliminated is NOT included in the rebalance
 *     input. Enrolment is a year-level fact; participation is not.
 *     An eliminated student cannot take the class, so they cannot
 *     be placed into a group.
 *
 *     The check uses EliminationQueries.isCharacterEliminatedByWeek,
 *     which applies the same boundary the roster derivation uses:
 *     eliminated at week E counts for weeks > E, not for week E
 *     itself. A student eliminated in week 4 is still eligible
 *     during week 4 and ineligible from week 5 onward.
 *
 *     When EliminationQueries is not loaded, the check is skipped.
 *     That preserves the pre-fix behavior rather than silently
 *     excluding students on the basis of a module that is not
 *     present.
 *
 *   The VM also carries presentation metadata the rebalance modal
 *   needs: student names, group display names, group instructor
 *   names, group member counts. The algorithm ignores the metadata;
 *   it consumes only the students[].id, students[].currentGroupId,
 *   students[].occupied, groups[].groupId, and groups[].sessions
 *   fields.
 *
 *   The occupied list for a student INCLUDES the sessions of the
 *   groups they are already in. That is deliberate: the algorithm
 *   subtracts the current group's sessions before building the
 *   allowed-groups matrix (see AcademyBalanceSuggestions), because
 *   the rebalance is precisely the operation that relocates the
 *   student. The caller that wants "rebalance but leave Alice
 *   alone" passes Alice in `excludedStudentIds`.
 *
 *   Options:
 *     { excludedStudentIds?: string[], groupIds?: string[] }
 *
 *   FAILURE POLICY:
 *     Missing class, missing discipline, invalid week → null.
 *     Missing enrolled students → empty students array (a class
 *     with no students is a legitimate state).
 *     Projector failure for a student → that student's occupied
 *     array is empty, and the student carries
 *     `occupiedUnavailable: true` so the caller can warn.
 *     Missing teaching groups module → null (the rebalance is
 *     meaningless without groups).
 *     Missing teaching sessions module → each group's sessions
 *     array is empty; the group can accept any student.
 *
 * FREE SLOT CANDIDATE STUDENTS (v33):
 *   getFreeSlotCandidateStudentsViewModel(classId, disciplineId,
 *   week) answers "which students are eligible to be placed into a
 *   new session for this discipline right now?"
 *
 *   This is the student list the free-slots filter panel consumes.
 *   The question is deliberately narrower than "every enrolled
 *   student" and the answer is deliberately conservative:
 *
 *     A student is a candidate when ALL of the following hold:
 *       - they are enrolled in this discipline for this class at
 *         this week
 *       - they are not in instructor mode (instructors are not
 *         students)
 *       - they are not eliminated as of this week
 *       - they are not deceased
 *       - they are not currently an active member of any teaching
 *         group of this (class, discipline) pair at this week
 *
 *   The last condition is the important one. A student already in
 *   a group has nowhere to go; the free-slots panel is a search
 *   for candidates who need placement, not a roster. Excluding
 *   assigned students keeps the list short and its meaning clear.
 *
 *   The result is an array of:
 *     { id, name, status }
 *   sorted by name ascending, then id ascending.
 *
 *   FAILURE POLICY:
 *     Missing class, missing discipline, invalid week → null.
 *     Missing AcademyTeachingGroups → throws (via require); the
 *       "already assigned" question cannot be answered without it.
 *     Missing enrolment or elimination data → conservative
 *       exclusion. If we cannot confirm a student is unassigned
 *       and eligible, they do not appear.
 *
 *   WHY THIS PROJECTION EXISTS:
 *     An earlier revision built this list inside the view
 *     (academy-discipline-view.js). That put domain reads —
 *     enrolment, elimination, teaching-group membership — inside a
 *     renderer. Moving it here centralizes the "who is a valid
 *     candidate for a new slot" question in one place, so the
 *     rebalance modal and the free-slots panel agree by
 *     construction. It also means the view is a renderer again,
 *     which is what it was supposed to be.
 *
 * RANGE PREDICATES:
 *   The "does this range contain this week" question is owned by
 *   window.RangeUtils, which is the canonical range-predicate module
 *   for the whole application. This aggregator delegates to
 *   RangeUtils.containsWeek. Do not reimplement the range math here;
 *   it lives in one place, on purpose.
 *
 * MEMBER INTERVALS MODEL (v24):
 *   Each team member entry on a persistent Team entity is:
 *
 *     {
 *       memberId,        // stable per-entry identifier
 *       characterId,
 *       role,
 *       intervals: [
 *         { joinPeriod, leavePeriod },
 *         ...
 *       ]
 *     }
 *
 *   The member VM carries the entry's `intervals` array verbatim
 *   (each interval gets its own periodDisplay string), plus a flat
 *   `periodDisplay` summary for list views that don't expand them.
 *
 * WEEKLY TEAMS WEEK FILTER:
 *   The team list for a given (class, week) is filtered by the
 *   PERSISTENT Team entity's own startPeriod / endPeriod AND by the
 *   weekly-team window record. Both must contain the week.
 *
 * WEEKLY TEAMS ROSTER:
 *   The roster for a team comes from the PERSISTENT Team entity's
 *   members[] array, filtered by week through
 *   TeamQueries.getActiveTeamMembers. The weekly-team record carries
 *   ONLY the week window.
 *
 * FORMER MEMBERS:
 *   getWeeklyTeamMemberManagerViewModel returns BOTH:
 *     members       — active at the display week
 *     formerMembers — entries with no interval containing the
 *                     display week, but at least one interval whose
 *                     leavePeriod is present and strictly less than
 *                     the display week
 *
 * ORPHAN TEAMS:
 *   Academic Teams with classId === null are surfaced by
 *   getUnassignedTeamsViewModel and by the orphanTeams field on the
 *   Weekly Teams VM.
 *
 * CLASS-DISCIPLINE PICKER (v27):
 *   The picker VM is derived from two sources:
 *     - AcademyDisciplines.getDisciplines()          (global list)
 *     - AcademyClassDisciplinesQueries.hasClassDiscipline
 *                                                     (offered?)
 *
 *   The picker is a MARKER EDITOR. It shows which disciplines a
 *   class offers, and the per-class `mandatory` flag on each offered
 *   discipline. It does NOT show instructors.
 *
 * DISCIPLINE LIST (v27):
 *   getDisciplineListViewModel does not carry instructorIds or
 *   instructorNames.
 *
 * SCHEDULE SOURCE:
 *   Location schedule projections read from
 *   AcademyCalendarAggregator, which is projector-backed.
 *
 * ELIMINATION SEMANTICS:
 *   The People sidebar and the weekly-team candidate pool both use
 *   the SAME definition of "eliminated": eliminated as of the
 *   displayed week, computed by
 *   EliminationQueries.isCharacterEliminatedByWeek. Boundary rule:
 *   elimination at week E counts for week W when E < W.
 *
 *   People filter values: 'active', 'eliminated', 'deceased', 'all'.
 *   'active' excludes both deceased and eliminated.
 *
 * FAIL-CLOSED ELIGIBILITY:
 *   getWeeklyTeamMemberManagerViewModel treats EliminationQueries as
 *   a required dependency. Missing or throwing → the projection
 *   throws. It does NOT silently treat the candidate as eligible.
 *
 * DEPENDENCIES (MANDATORY):
 *   - AcademyClasses
 *   - AcademyDisciplines
 *   - AcademyClassDisciplinesQueries
 *   - AcademyEnrolments
 *   - CharacterQueries
 *   - AcademyLocations
 *   - TeamQueries
 *   - TeamConstants
 *   - CalendarConstants
 *   - RangeUtils
 *
 * DEPENDENCIES (LAZY, resolved at call time):
 *   - TeamAggregator
 *   - AcademyWeeklyTeams
 *   - AcademyRanking
 *   - AcademyCalendarAggregator
 *   - AcademyGrades
 *   - EliminationQueries
 *   - AcademyTeachingGroups      (rebalance VM, free-slot candidates,
 *                                 and the instructor group picker)
 *   - AcademyTeachingSessions    (rebalance VM and the instructor
 *                                 group picker)
 *   - AcademyTeachingProjector   (rebalance VM)
 */

(function() {
    'use strict';

    if (window.__academyAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyClassDisciplinesQueries =
        window.AcademyClassDisciplinesQueries;
    var AcademyEnrolments = window.AcademyEnrolments;
    var CharacterQueries = window.CharacterQueries;
    var AcademyLocations = window.AcademyLocations;
    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CalendarConstants = window.CalendarConstants;
    var RangeUtils = window.RangeUtils;

    // ============================================================
    // MANDATORY DEPENDENCY CHECK
    // ============================================================

    var _missing = [];

    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClasses !== 'function') {
        _missing.push('AcademyClasses.getClasses');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClassInstructorIds !== 'function') {
        _missing.push('AcademyClasses.getClassInstructorIds');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDisciplines !== 'function') {
        _missing.push('AcademyDisciplines.getDisciplines');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.hasClassDiscipline !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries.hasClassDiscipline');
    }
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.isActiveInWeek !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries.isActiveInWeek');
    }
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.getClassDiscipline !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries.getClassDiscipline');
    }
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.getClassDisciplinesForClass !== 'function') {
        _missing.push(
            'AcademyClassDisciplinesQueries.getClassDisciplinesForClass'
        );
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.isEnrolledInWeek !== 'function') {
        _missing.push('AcademyEnrolments.isEnrolledInWeek');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.getEnrolledStudents !== 'function') {
        _missing.push('AcademyEnrolments.getEnrolledStudents');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
        _missing.push('CharacterQueries.getCurrentStatus');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterAge !== 'function') {
        _missing.push('CharacterQueries.getCharacterAge');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!AcademyLocations || typeof AcademyLocations.getLocations !== 'function') {
        _missing.push('AcademyLocations.getLocations');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
        _missing.push('TeamQueries.getTeamsByClass');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
        _missing.push('TeamQueries.getTeamName');
    }
    if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
        _missing.push('TeamQueries.getActiveTeamMembers');
    }
    if (!TeamQueries || typeof TeamQueries.isTeamActiveAtPeriod !== 'function') {
        _missing.push('TeamQueries.isTeamActiveAtPeriod');
    }
    if (!TeamQueries || typeof TeamQueries.getAllTeamMemberRecords !== 'function') {
        _missing.push('TeamQueries.getAllTeamMemberRecords');
    }
    if (!TeamConstants) {
        _missing.push('TeamConstants');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }
    if (!RangeUtils || typeof RangeUtils.containsWeek !== 'function') {
        _missing.push('RangeUtils.containsWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // LAZY OPTIONAL DEPENDENCIES
    // ============================================================

    function getTeamAggregator() {
        return window.TeamAggregator || null;
    }

    function getAcademyWeeklyTeams() {
        return window.AcademyWeeklyTeams || null;
    }

    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    function getAcademyCalendarAggregator() {
        return window.AcademyCalendarAggregator || null;
    }

    function getAcademyGrades() {
        return window.AcademyGrades || null;
    }

    function getGradeSchemes() {
        return window.AcademyGradeSchemes || null;
    }

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    // ============================================================
    // LAZY-BUT-MANDATORY DEPENDENCIES
    // ============================================================
    //
    // Resolved at call time by the projections that need them.
    // Missing at call time throws; it is not silently treated as
    // "no data." This is the "lazy ≠ optional" pattern: load order
    // is deferred, mandatory-ness is not.

    /**
     * Resolve AcademyTeachingGroups for the group-picker projection,
     * the rebalance VM, and the free-slot candidate students
     * projection.
     * Throws when the module is missing or malformed.
     */
    function requireAcademyTeachingGroups(contextLabel) {
        var ATG = window.AcademyTeachingGroups;
        if (!ATG ||
            typeof ATG.getGroupsForClassDisciplineInstructor !== 'function' ||
            typeof ATG.getActiveMembers !== 'function') {
            throw new Error(
                '[AcademyAggregator] AcademyTeachingGroups is required ' +
                'by ' + contextLabel + '. Check the script load order ' +
                'in index.html.'
            );
        }
        return ATG;
    }

    /**
     * Resolve AcademyTeachingSessions for the group-picker
     * projection's session counts and for the rebalance VM.
     * Throws when the module is missing or malformed.
     */
    function requireAcademyTeachingSessions(contextLabel) {
        var ATS = window.AcademyTeachingSessions;
        if (!ATS || typeof ATS.getSessionsForGroup !== 'function') {
            throw new Error(
                '[AcademyAggregator] AcademyTeachingSessions is required ' +
                'by ' + contextLabel + '. Check the script load order ' +
                'in index.html.'
            );
        }
        return ATS;
    }

    /**
     * Resolve AcademyTeachingProjector for the rebalance VM.
     * Throws when the module is missing or malformed.
     */
    function requireAcademyTeachingProjector(contextLabel) {
        var ATP = window.AcademyTeachingProjector;
        if (!ATP ||
            typeof ATP.projectForStudent !== 'function') {
            throw new Error(
                '[AcademyAggregator] AcademyTeachingProjector is required ' +
                'by ' + contextLabel + '. Check the script load order ' +
                'in index.html.'
            );
        }
        return ATP;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    /**
     * Resolve a week to a bounded integer, or null.
     */
    function resolveWeek(week) {
        if (week === undefined || week === null || week === '') {
            return null;
        }
        var n = Number(week);
        if (!Number.isInteger(n)) {
            return null;
        }
        if (n < CalendarConstants.MIN_WEEK ||
            n > CalendarConstants.MAX_WEEK) {
            return null;
        }
        return n;
    }

    function getCharacterDisplayName(charId) {
        if (!charId) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return 'Unknown'; }
        return CharacterQueries.getDisplayName(char);
    }

    function getTeamPeriodDisplay(team) {
        var TA = getTeamAggregator();
        if (TA && typeof TA.getTeamPeriodDisplay === 'function') {
            return TA.getTeamPeriodDisplay(team);
        }
        return '-';
    }

    /**
     * Return the IDs of every instructor actively teaching in this
     * class at the given week.
     *
     * Delegates to AcademyClasses.getClassInstructorIds, which is
     * the canonical WEEK-SCOPED query. Returns an empty array when
     * the query is unavailable or the class has no active
     * instructors that week.
     *
     * USE THIS FOR:
     *   - Schedule collision detection
     *   - "Who is teaching this class this week?" displays
     *
     * DO NOT USE THIS FOR:
     *   - Roster derivation
     *   - Role classification
     *   - Candidate pools
     *   - Anything that answers "who is an instructor OF this class?"
     *
     * Those questions are YEAR-LEVEL and use
     * getClassInstructorSetForClass below.
     */
    function getClassInstructorIds(classId, week, disciplineId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        if (week === undefined || week === null) {
            return [];
        }
        if (typeof AcademyClasses.getClassInstructorIds !== 'function') {
            return [];
        }
        var options = null;
        if (isNonEmptyString(disciplineId)) {
            options = { disciplineId: String(disciplineId) };
        }
        try {
            var ids = AcademyClasses.getClassInstructorIds(
                classId, week, options
            );
            return Array.isArray(ids) ? ids : [];
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getClassInstructorIds failed:', e
            );
            return [];
        }
    }

    /**
     * Return the set of characters who are instructors OF THIS CLASS.
     *
     * THE RULE (year-level, not week-scoped):
     *
     *     character.mode === 'instructor'
     *       AND this class is in character.classIds
     *
     * That is the whole rule. A character who is an instructor of
     * this class stays an instructor of this class when their
     * disciplines stop running for the term.
     *
     * Returns an object shaped as a set for O(1) membership tests:
     *   { [charId: string]: true }
     */
    function getClassInstructorSetForClass(classId) {
        var set = Object.create(null);
        if (!isNonEmptyString(classId)) {
            return set;
        }

        var target = String(classId);
        var all = CharacterQueries.getCharacters() || [];

        for (var i = 0; i < all.length; i++) {
            var c = all[i];
            if (!c || !c.id) { continue; }
            if (c.mode !== 'instructor') { continue; }
            if (!Array.isArray(c.classIds)) { continue; }

            for (var j = 0; j < c.classIds.length; j++) {
                if (String(c.classIds[j]) === target) {
                    set[String(c.id)] = true;
                    break;
                }
            }
        }

        return set;
    }

    /**
     * Build a set-shaped lookup from an array of character IDs.
     * Keys are stringified so numeric-string mismatches do not
     * produce false negatives.
     */
    function buildIdSet(ids) {
        var set = Object.create(null);
        if (!Array.isArray(ids)) { return set; }
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] === undefined || ids[i] === null) { continue; }
            var key = String(ids[i]);
            if (key === '') { continue; }
            set[key] = true;
        }
        return set;
    }

    // ============================================================
    // INSTRUCTOR DISCIPLINES
    // ============================================================

    function getClassInstructorDisciplines(classId, instructorId, week) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(instructorId)) {
            return [];
        }

        var weekNum = resolveWeek(week);
        if (weekNum === null) {
            return [];
        }

        var char = CharacterQueries.getCharacterById(instructorId);
        if (!char || char.mode !== 'instructor') {
            return [];
        }

        var targetClass = String(classId);
        var targetChar = String(instructorId);

        var markers = AcademyClassDisciplinesQueries
            .getClassDisciplinesForClass(targetClass) || [];

        var result = [];

        for (var i = 0; i < markers.length; i++) {
            var marker = markers[i];
            if (!marker || !marker.disciplineId) { continue; }

            var disciplineId = String(marker.disciplineId);

            var enrolled = AcademyEnrolments.isEnrolledInWeek(
                targetChar,
                targetClass,
                disciplineId,
                weekNum
            ) === true;

            if (!enrolled) { continue; }

            var disc = AcademyDisciplines.getDiscipline(disciplineId);
            if (!disc) { continue; }

            result.push({
                id: String(disc.id),
                name: isNonEmptyString(disc.name)
                    ? disc.name
                    : 'Unnamed Discipline',
                type: disc.type || 'mandatory'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // INSTRUCTOR GROUP PICKER
    // ============================================================

    function getInstructorGroupPickerViewModel(
        classId,
        instructorId,
        disciplineId,
        week
    ) {
        if (!isNonEmptyString(classId) ||
            !isNonEmptyString(instructorId) ||
            !isNonEmptyString(disciplineId)) {
            return { groups: [] };
        }

        var weekNum = resolveWeek(week);
        if (weekNum === null) {
            return { groups: [] };
        }

        var targetClass = String(classId);
        var targetInstructor = String(instructorId);
        var targetDiscipline = String(disciplineId);

        var ATG = requireAcademyTeachingGroups(
            'getInstructorGroupPickerViewModel'
        );
        var ATS = requireAcademyTeachingSessions(
            'getInstructorGroupPickerViewModel'
        );

        var rawGroups = ATG.getGroupsForClassDisciplineInstructor(
            targetClass,
            targetDiscipline,
            targetInstructor
        ) || [];

        if (!Array.isArray(rawGroups)) {
            rawGroups = [];
        }

        var discipline = AcademyDisciplines.getDiscipline(
            targetDiscipline
        );
        var disciplineName = (discipline &&
                              isNonEmptyString(discipline.name))
            ? discipline.name
            : 'Unnamed Discipline';

        var result = [];

        for (var i = 0; i < rawGroups.length; i++) {
            var group = rawGroups[i];
            if (!group || !group.id) { continue; }

            var startOk = true;
            if (group.startWeek !== undefined &&
                group.startWeek !== null &&
                group.startWeek !== '') {
                if (typeof group.startWeek !== 'number' ||
                    !isFinite(group.startWeek)) {
                    startOk = false;
                } else if (weekNum < group.startWeek) {
                    startOk = false;
                }
            }

            var endOk = true;
            if (startOk &&
                group.endWeek !== undefined &&
                group.endWeek !== null &&
                group.endWeek !== '') {
                if (typeof group.endWeek !== 'number' ||
                    !isFinite(group.endWeek)) {
                    endOk = false;
                } else if (weekNum > group.endWeek) {
                    endOk = false;
                }
            }

            if (!startOk || !endOk) { continue; }

            var groupNumber = isFiniteNumber(group.groupNumber)
                ? group.groupNumber
                : 0;

            var customName = isNonEmptyString(group.customName)
                ? String(group.customName).trim()
                : null;

            var displayName;
            if (customName !== null) {
                displayName = customName;
            } else if (groupNumber > 0) {
                displayName = disciplineName + ' ' + groupNumber;
            } else {
                displayName = disciplineName;
            }

            var members = ATG.getActiveMembers(group.id, weekNum) || [];
            var memberCount = Array.isArray(members)
                ? members.length
                : 0;

            var sessions = ATS.getSessionsForGroup(group.id) || [];
            var sessionCount = Array.isArray(sessions)
                ? sessions.length
                : 0;

            result.push({
                groupId: String(group.id),
                groupNumber: groupNumber,
                displayName: displayName,
                memberCount: memberCount,
                sessionCount: sessionCount
            });
        }

        result.sort(function(a, b) {
            if (a.groupNumber !== b.groupNumber) {
                return a.groupNumber - b.groupNumber;
            }
            return a.groupId.localeCompare(b.groupId);
        });

        return { groups: result };
    }

    // ============================================================
    // REBALANCE INPUT (v32)
    // ============================================================
    //
    // Assembles the input object AcademyBalanceSuggestions.suggest
    // consumes. Does NOT run the algorithm.
    //
    // ELIMINATED STUDENTS:
    //   A student who is eliminated as of the rebalance week is
    //   excluded. Enrolment is a year-level fact; participation is
    //   not. An eliminated student cannot take the class, so they
    //   cannot be placed into a group.
    //
    //   The check uses EliminationQueries.isCharacterEliminatedByWeek,
    //   which applies the same boundary the roster derivation uses:
    //   eliminated at week E counts for weeks > E, not for week E
    //   itself.
    //
    //   When EliminationQueries is not loaded, the check is skipped.
    //   That preserves the pre-fix behavior rather than silently
    //   excluding students on the basis of a module that is not
    //   present.

    function getRebalanceInputViewModel(
        classId,
        disciplineId,
        week,
        options
    ) {
        if (!isNonEmptyString(classId)) { return null; }
        if (!isNonEmptyString(disciplineId)) { return null; }

        var weekNum = resolveWeek(week);
        if (weekNum === null) { return null; }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return null; }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) { return null; }

        options = (options && typeof options === 'object')
            ? options
            : {};

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        var ATG = requireAcademyTeachingGroups(
            'getRebalanceInputViewModel'
        );
        var ATS = requireAcademyTeachingSessions(
            'getRebalanceInputViewModel'
        );
        var ATP = requireAcademyTeachingProjector(
            'getRebalanceInputViewModel'
        );

        var excludedStudentSet = buildIdSet(
            Array.isArray(options.excludedStudentIds)
                ? options.excludedStudentIds
                : []
        );

        var groupFilter = null;
        if (Array.isArray(options.groupIds)) {
            groupFilter = buildIdSet(options.groupIds);
        }

        // ---- Elimination check availability ----
        //
        // Resolved once. If the module is not loaded, the check is
        // skipped for every student. If it is loaded but throws for
        // a specific student, that student is conservatively
        // excluded.
        var EQ = getEliminationQueries();
        var eliminationCheckAvailable = EQ &&
            typeof EQ.isCharacterEliminatedByWeek === 'function';

        var enrolledStudentIds = [];
        try {
            enrolledStudentIds = AcademyEnrolments.getEnrolledStudents(
                targetClass, targetDiscipline, weekNum
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getEnrolledStudents failed:', e
            );
            enrolledStudentIds = [];
        }

        if (!Array.isArray(enrolledStudentIds)) {
            enrolledStudentIds = [];
        }

        var rawGroups = [];
        try {
            rawGroups = ATG.getGroupsForDiscipline(
                targetClass, targetDiscipline
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getGroupsForDiscipline failed:', e
            );
            rawGroups = [];
        }

        if (!Array.isArray(rawGroups)) {
            rawGroups = [];
        }

        var disciplineName = isNonEmptyString(discipline.name)
            ? discipline.name
            : 'Unnamed Discipline';

        var groupVMs = [];

        for (var gi = 0; gi < rawGroups.length; gi++) {
            var rawGroup = rawGroups[gi];
            if (!rawGroup || !rawGroup.id) { continue; }

            var groupId = String(rawGroup.id);

            if (groupFilter !== null &&
                groupFilter[groupId] !== true) {
                continue;
            }

            var instructorId = isNonEmptyString(rawGroup.instructorId)
                ? String(rawGroup.instructorId)
                : null;
            var instructorName = instructorId
                ? getCharacterDisplayName(instructorId)
                : '';

            var groupNumber = isFiniteNumber(rawGroup.groupNumber)
                ? rawGroup.groupNumber
                : 0;
            var customName = isNonEmptyString(rawGroup.customName)
                ? String(rawGroup.customName).trim()
                : null;

            var groupDisplayName;
            if (customName !== null) {
                groupDisplayName = customName;
            } else if (groupNumber > 0) {
                groupDisplayName = disciplineName + ' ' + groupNumber;
            } else {
                groupDisplayName = disciplineName;
            }

            var activeMembers = [];
            try {
                activeMembers = ATG.getActiveMembers(
                    groupId, weekNum
                ) || [];
            } catch (e) {
                activeMembers = [];
            }
            var memberCount = Array.isArray(activeMembers)
                ? activeMembers.length
                : 0;

            var rawSessions = [];
            try {
                rawSessions = ATS.getSessionsForGroup(groupId) || [];
            } catch (e) {
                rawSessions = [];
            }
            if (!Array.isArray(rawSessions)) {
                rawSessions = [];
            }

            var sessionVMs = [];
            for (var si = 0; si < rawSessions.length; si++) {
                var s = rawSessions[si];
                if (!s) { continue; }

                var sStart = isFiniteNumber(s.startWeek)
                    ? s.startWeek : null;
                var sEnd = (s.endWeek !== undefined &&
                            s.endWeek !== null)
                    ? s.endWeek : null;

                if (sStart !== null && weekNum < sStart) { continue; }
                if (sEnd !== null && weekNum > sEnd) { continue; }

                if (typeof s.day !== 'number') { continue; }
                if (typeof s.startTime !== 'number') { continue; }

                sessionVMs.push({
                    day: s.day,
                    startTime: s.startTime,
                    duration: isFiniteNumber(s.duration) && s.duration > 0
                        ? s.duration
                        : 1
                });
            }

            groupVMs.push({
                groupId: groupId,
                displayName: groupDisplayName,
                instructorId: instructorId,
                instructorName: instructorName,
                memberCount: memberCount,
                sessions: sessionVMs
            });
        }

        groupVMs.sort(function(a, b) {
            return a.displayName.localeCompare(b.displayName);
        });

        var studentVMs = [];

        for (var sti = 0; sti < enrolledStudentIds.length; sti++) {
            var studentIdRaw = enrolledStudentIds[sti];
            if (!isNonEmptyString(studentIdRaw)) { continue; }

            var studentId = String(studentIdRaw);

            if (excludedStudentSet[studentId] === true) {
                continue;
            }

            var char = CharacterQueries.getCharacterById(studentId);
            if (!char) { continue; }

            if (char.mode === 'instructor') { continue; }

            // ---- Eliminated students cannot be rebalanced ----
            //
            // Enrolment is a year-level fact. Participation is not.
            // A student eliminated at or before the rebalance week
            // cannot take the class, so they cannot be placed into
            // any group.
            //
            // If the elimination check throws for a specific
            // student, that student is conservatively excluded.
            // If the module is not loaded at all, the check is
            // skipped entirely (the outer `eliminationCheckAvailable`
            // guard).
            if (eliminationCheckAvailable) {
                var eliminatedNow = false;
                try {
                    eliminatedNow = EQ.isCharacterEliminatedByWeek(
                        studentId, weekNum
                    ) === true;
                } catch (e) {
                    eliminatedNow = true;
                }
                if (eliminatedNow) { continue; }
            }

            var occupied = [];
            var occupiedUnavailable = false;

            try {
                var occurrences = ATP.projectForStudent(
                    studentId, weekNum
                ) || [];
                if (!Array.isArray(occurrences)) {
                    occurrences = [];
                    occupiedUnavailable = true;
                }
                for (var oi = 0; oi < occurrences.length; oi++) {
                    var occ = occurrences[oi];
                    if (!occ) { continue; }
                    if (typeof occ.day !== 'number') { continue; }
                    if (typeof occ.startTime !== 'number') { continue; }
                    occupied.push({
                        day: occ.day,
                        startTime: occ.startTime,
                        duration: isFiniteNumber(occ.duration) &&
                                  occ.duration > 0
                            ? occ.duration
                            : 1
                    });
                }
            } catch (e) {
                console.warn(
                    '[AcademyAggregator] projectForStudent failed for ' +
                    studentId + ':', e
                );
                occupied = [];
                occupiedUnavailable = true;
            }

            var currentGroupId = null;
            try {
                if (typeof ATG.getGroupForStudentInClassDiscipline ===
                    'function') {
                    var currentGroup =
                        ATG.getGroupForStudentInClassDiscipline(
                            targetClass,
                            targetDiscipline,
                            studentId,
                            weekNum
                        );
                    if (currentGroup && currentGroup.id) {
                        currentGroupId = String(currentGroup.id);
                    }
                }
            } catch (e) {
                currentGroupId = null;
            }

            studentVMs.push({
                id: studentId,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char),
                occupied: occupied,
                currentGroupId: currentGroupId,
                occupiedUnavailable: occupiedUnavailable
            });
        }

        studentVMs.sort(function(a, b) {
            var an = String(a.name || '');
            var bn = String(b.name || '');
            if (an !== bn) {
                return an.localeCompare(bn);
            }
            return a.id.localeCompare(b.id);
        });

        return {
            classId: targetClass,
            className: isNonEmptyString(cls.name)
                ? cls.name
                : 'Unnamed Class',
            disciplineId: targetDiscipline,
            disciplineName: disciplineName,
            week: weekNum,

            students: studentVMs,
            groups: groupVMs,

            studentCount: studentVMs.length,
            groupCount: groupVMs.length,

            unavailableStudentCount: countUnavailable(studentVMs)
        };
    }

    function countUnavailable(studentVMs) {
        var n = 0;
        for (var i = 0; i < studentVMs.length; i++) {
            if (studentVMs[i].occupiedUnavailable === true) {
                n++;
            }
        }
        return n;
    }

    // ============================================================
    // FREE SLOT CANDIDATE STUDENTS (v33)
    // ============================================================
    //
    // The student list the free-slots filter panel consumes.
    //
    // A student is a CANDIDATE for a free slot when ALL of these
    // hold:
    //
    //   - they are enrolled in this discipline for this class at
    //     this week
    //   - they are not in instructor mode
    //   - they are not eliminated as of this week
    //   - they are not deceased
    //   - they are not currently an active member of ANY teaching
    //     group of this (class, discipline) pair at this week
    //
    // See the file header for why this projection exists, and why
    // the last condition is the important one.
    //
    // FAILURE POLICY:
    //   Missing class, discipline, or week → null.
    //   Missing AcademyTeachingGroups → throws (via require).
    //   Missing EliminationQueries → conservative exclusion: with
    //     no way to check elimination, we cannot confirm a student
    //     is eligible, so the projection returns [] for the
    //     elimination-dependent portion. In practice this is very
    //     unlikely (EliminationQueries is loaded early) but the
    //     failure mode is safe: fewer candidates, never more.
    //   Missing enrolment data → the student is not in the enrolled
    //     set, so they do not appear.

    function getFreeSlotCandidateStudentsViewModel(
        classId,
        disciplineId,
        week
    ) {
        if (!isNonEmptyString(classId)) { return null; }
        if (!isNonEmptyString(disciplineId)) { return null; }

        var weekNum = resolveWeek(week);
        if (weekNum === null) { return null; }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return null; }

        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        if (!discipline) { return null; }

        var targetClass = String(classId);
        var targetDiscipline = String(disciplineId);

        var ATG = requireAcademyTeachingGroups(
            'getFreeSlotCandidateStudentsViewModel'
        );

        // ---- Enrolled students this week ----
        var enrolledStudentIds = [];
        try {
            enrolledStudentIds = AcademyEnrolments.getEnrolledStudents(
                targetClass, targetDiscipline, weekNum
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getEnrolledStudents failed:', e
            );
            enrolledStudentIds = [];
        }

        if (!Array.isArray(enrolledStudentIds)) {
            enrolledStudentIds = [];
        }

        // ---- Assigned students: active member of any group ----
        //
        // A student who appears in the members[] array of any
        // teaching group of this (class, discipline) pair AND has
        // an active interval at this week is already assigned. They
        // are not a candidate.
        //
        // Note: this is NOT the same as `getGroupForStudentInClassDiscipline`.
        // That function returns the single group a student is in,
        // which is correct for that question. Here we want "is this
        // student in any group at all," which needs the union
        // across all groups. We build it directly.

        var assignedSet = Object.create(null);

        var groups = [];
        try {
            groups = ATG.getGroupsForDiscipline(
                targetClass, targetDiscipline
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getGroupsForDiscipline failed:', e
            );
            groups = [];
        }

        if (!Array.isArray(groups)) {
            groups = [];
        }

        for (var g = 0; g < groups.length; g++) {
            var group = groups[g];
            if (!group || !group.id) { continue; }

            var activeMembers = [];
            try {
                activeMembers = ATG.getActiveMembers(
                    group.id, weekNum
                ) || [];
            } catch (e) {
                activeMembers = [];
            }
            if (!Array.isArray(activeMembers)) {
                activeMembers = [];
            }

            for (var m = 0; m < activeMembers.length; m++) {
                if (isNonEmptyString(activeMembers[m])) {
                    assignedSet[String(activeMembers[m])] = true;
                }
            }
        }

        // ---- Elimination dependency ----
        //
        // Conservative: without EliminationQueries we cannot
        // confirm eligibility. Return [] so the caller does not
        // present a list we cannot stand behind. This is the
        // fail-closed rule, matching the weekly-team member manager.

        var EQ = getEliminationQueries();
        if (!EQ ||
            typeof EQ.isCharacterEliminatedByWeek !== 'function') {
            console.warn(
                '[AcademyAggregator] ' +
                'getFreeSlotCandidateStudentsViewModel requires ' +
                'EliminationQueries.isCharacterEliminatedByWeek. ' +
                'Returning an empty candidate list rather than ' +
                'presenting unverified students.'
            );
            return {
                classId: targetClass,
                className: isNonEmptyString(cls.name)
                    ? cls.name
                    : 'Unnamed Class',
                disciplineId: targetDiscipline,
                disciplineName: isNonEmptyString(discipline.name)
                    ? discipline.name
                    : 'Unnamed Discipline',
                week: weekNum,
                students: [],
                studentCount: 0
            };
        }

        // ---- Build the candidate list ----

        var result = [];

        for (var i = 0; i < enrolledStudentIds.length; i++) {
            var studentIdRaw = enrolledStudentIds[i];
            if (!isNonEmptyString(studentIdRaw)) { continue; }

            var studentId = String(studentIdRaw);

            // Already in a group? Not a candidate.
            if (assignedSet[studentId] === true) { continue; }

            var char = CharacterQueries.getCharacterById(studentId);
            if (!char) { continue; }

            // Instructors are not students.
            if (char.mode === 'instructor') { continue; }

            // Deceased at any point? Not a candidate.
            if (char.deceased === true) { continue; }

            // Eliminated as of this week? Not a candidate.
            var eliminated = false;
            try {
                eliminated = EQ.isCharacterEliminatedByWeek(
                    studentId, weekNum
                ) === true;
            } catch (e) {
                // If the elimination check throws for this
                // student, we cannot confirm eligibility.
                // Conservative: exclude them.
                eliminated = true;
            }
            if (eliminated) { continue; }

            result.push({
                id: studentId,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char)
            });
        }

        result.sort(function(a, b) {
            var an = String(a.name || '');
            var bn = String(b.name || '');
            if (an !== bn) {
                return an.localeCompare(bn);
            }
            return a.id.localeCompare(b.id);
        });

        return {
            classId: targetClass,
            className: isNonEmptyString(cls.name)
                ? cls.name
                : 'Unnamed Class',
            disciplineId: targetDiscipline,
            disciplineName: isNonEmptyString(discipline.name)
                ? discipline.name
                : 'Unnamed Discipline',
            week: weekNum,
            students: result,
            studentCount: result.length
        };
    }

    // ============================================================
    // ELIMINATION PROJECTION
    // ============================================================

    function readEliminationState(charId, week) {
        var result = {
            eliminated: false,
            eliminationWeek: null,
            eliminationReason: ''
        };

        if (week === null) {
            return result;
        }

        var EQ = getEliminationQueries();
        if (!EQ || typeof EQ.isCharacterEliminatedByWeek !== 'function') {
            return result;
        }

        result.eliminated = EQ.isCharacterEliminatedByWeek(charId, week) === true;

        if (result.eliminated) {
            if (typeof EQ.getEliminationWeek === 'function') {
                result.eliminationWeek = EQ.getEliminationWeek(charId);
            }
            if (typeof EQ.getEliminationReason === 'function') {
                var reason = EQ.getEliminationReason(charId);
                if (typeof reason === 'string' && reason !== 'Unknown') {
                    result.eliminationReason = reason;
                }
            }
        }

        return result;
    }

    // ============================================================
    // ROSTER DERIVATION
    // ============================================================

    function deriveClassRoster(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return [];
        }

        var weekNum = resolveWeek(week);

        // YEAR-LEVEL instructor exclusion. Not week-scoped.
        var instructorSet = getClassInstructorSetForClass(classId);

        var all = CharacterQueries.getCharacters() || [];
        var target = String(classId);
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var c = all[i];
            if (!c || !c.id) { continue; }

            if (instructorSet[String(c.id)]) {
                continue;
            }

            var classIds = Array.isArray(c.classIds) ? c.classIds : [];
            var found = false;
            for (var j = 0; j < classIds.length; j++) {
                if (String(classIds[j]) === target) {
                    found = true;
                    break;
                }
            }
            if (!found) { continue; }

            var elim = readEliminationState(c.id, weekNum);

            result.push({
                id: c.id,
                name: CharacterQueries.getDisplayName(c),
                status: CharacterQueries.getCurrentStatus(c),
                age: CharacterQueries.getCharacterAge(c),
                deceased: c.deceased === true,
                eliminated: elim.eliminated,
                eliminationWeek: elim.eliminationWeek,
                eliminationReason: elim.eliminationReason,
                role: 'student'
            });
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    // ============================================================
    // CLASS LIST
    // ============================================================

    function getClassListViewModel() {
        var classes = AcademyClasses.getClasses() || [];
        classes = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return classes.map(function(c) {
            return {
                id: c.id,
                name: c.name || 'Unnamed Class',
                status: c.status || 'active',
                year: c.year || null
            };
        });
    }

    // ============================================================
    // CLASS STUDENTS
    // ============================================================

    function getClassStudentsViewModel(classId, week) {
        return deriveClassRoster(classId, week);
    }

    // ============================================================
    // CLASS VIEW MODEL
    // ============================================================

    function getClassViewModel(classId, week) {
        if (!classId) { return null; }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) { return null; }

        var roster = deriveClassRoster(classId, week);
        var studentCount = roster.length;

        return {
            id: cls.id,
            name: cls.name || 'Unnamed Class',
            status: cls.status || 'active',
            year: cls.year || null,
            description: cls.description || '',
            studentCount: studentCount,
            createdAt: cls.createdAt || ''
        };
    }

    // ============================================================
    // PEOPLE VIEW MODEL
    // ============================================================

    function getPeopleViewModel(classId, options) {
        options = options || {};

        var filters = options.filters && typeof options.filters === 'object'
            ? options.filters
            : { search: '', role: 'all', status: 'active' };

        var selectedCharacterId = isNonEmptyString(options.selectedCharacterId)
            ? String(options.selectedCharacterId)
            : null;

        var weekNum = resolveWeek(options.week);

        var classList = getClassListViewModel();

        var selectedClass = null;
        if (isNonEmptyString(classId)) {
            for (var i = 0; i < classList.length; i++) {
                if (String(classList[i].id) === String(classId)) {
                    selectedClass = classList[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classList: classList,
                classId: null,
                className: null,
                week: weekNum,
                filters: filters,
                people: [],
                totalCount: 0,
                filteredCount: 0
            };
        }

        var students = getClassStudentsViewModel(
            selectedClass.id,
            weekNum
        );

        // YEAR-LEVEL instructors of this class. Not week-scoped.
        var instructorSet = getClassInstructorSetForClass(
            selectedClass.id
        );

        var alreadyPresent = buildIdSet(
            students.map(function(s) { return s.id; })
        );

        var instructorIds = Object.keys(instructorSet);
        for (var ii = 0; ii < instructorIds.length; ii++) {
            var instrId = String(instructorIds[ii]);
            if (alreadyPresent[instrId]) { continue; }

            var instructorChar = CharacterQueries.getCharacterById(instrId);
            if (!instructorChar) { continue; }

            var instrElim = readEliminationState(instrId, weekNum);
            students = students.concat([{
                id: instructorChar.id,
                name: CharacterQueries.getDisplayName(instructorChar),
                status: CharacterQueries.getCurrentStatus(instructorChar),
                age: CharacterQueries.getCharacterAge(instructorChar),
                deceased: instructorChar.deceased === true,
                eliminated: instrElim.eliminated,
                eliminationWeek: instrElim.eliminationWeek,
                eliminationReason: instrElim.eliminationReason,
                role: 'instructor'
            }]);
        }

        var search = (filters.search || '').toLowerCase().trim();
        var roleFilter = filters.role || 'all';
        var statusFilter = filters.status || 'active';

        var filtered = students.filter(function(person) {
            if (search && person.name.toLowerCase().indexOf(search) === -1) {
                return false;
            }
            if (roleFilter !== 'all' && person.role !== roleFilter) {
                return false;
            }
            if (statusFilter !== 'all') {
                var isDeceased = person.deceased === true;
                var isEliminated = person.eliminated === true;

                if (statusFilter === 'deceased' && !isDeceased) {
                    return false;
                }
                if (statusFilter === 'eliminated' && !isEliminated) {
                    return false;
                }
                if (statusFilter === 'active' &&
                    (isDeceased || isEliminated)) {
                    return false;
                }
            }
            return true;
        });

        filtered.sort(function(a, b) {
            if (a.role !== b.role) {
                return a.role === 'student' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        var people = filtered.map(function(person) {
            return {
                id: person.id,
                name: person.name,
                status: person.status,
                role: person.role,
                deceased: person.deceased === true,
                eliminated: person.eliminated === true,
                eliminationWeek: person.eliminationWeek,
                eliminationReason: person.eliminationReason,
                isSelected: selectedCharacterId !== null &&
                    String(person.id) === selectedCharacterId
            };
        });

        return {
            classList: classList,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: weekNum,
            filters: filters,
            people: people,
            totalCount: students.length,
            filteredCount: people.length
        };
    }

    // ============================================================
    // CHARACTER PROJECTIONS
    // ============================================================

    function getStudentViewModel(studentId, options) {
        if (!studentId) { return null; }

        options = options || {};
        var week = options.week !== undefined ? options.week : null;

        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) { return null; }

        var classes = AcademyClasses.getCharacterClasses(student) || [];

        return {
            id: student.id,
            name: CharacterQueries.getDisplayName(student),
            fullName: typeof CharacterQueries.getFullName === 'function'
                ? CharacterQueries.getFullName(student)
                : CharacterQueries.getDisplayName(student),
            status: CharacterQueries.getCurrentStatus(student),
            age: CharacterQueries.getCharacterAge(student),
            deceased: student.deceased === true,
            birthYear: student.birthYear || '',
            gender: student.gender || '',
            week: week,
            classes: classes.map(function(cls) {
                return {
                    id: cls.id,
                    name: cls.name || 'Unnamed Class',
                    status: cls.status || 'active'
                };
            }),
            classCount: classes.length
        };
    }

    function getInstructorViewModel(instructorId, options) {
        if (!instructorId) { return null; }

        options = options || {};
        var week = options.week !== undefined ? options.week : null;

        var instructor = CharacterQueries.getCharacterById(instructorId);
        if (!instructor) { return null; }

        return {
            id: instructor.id,
            name: CharacterQueries.getDisplayName(instructor),
            status: CharacterQueries.getCurrentStatus(instructor),
            age: CharacterQueries.getCharacterAge(instructor),
            deceased: instructor.deceased === true,
            week: week
        };
    }

    // ============================================================
    // DISCIPLINE LIST
    // ============================================================

    function getDisciplineListViewModel(filters) {
        filters = filters || {};

        var disciplines = AcademyDisciplines.getDisciplines() || [];
        var type = filters.type || 'all';
        var search = (filters.search || '').toLowerCase().trim();

        var filtered = disciplines.filter(function(d) {
            if (!d || !d.id) { return false; }
            if (type !== 'all' && d.type !== type) { return false; }
            if (search && (d.name || '').toLowerCase().indexOf(search) === -1) {
                return false;
            }
            return true;
        });

        var listVM = filtered.map(function(d) {
            return {
                id: d.id,
                name: d.name,
                type: d.type,
                typeLabel: getDisciplineTypeLabel(d.type),
                startWeek: d.startWeek,
                endWeek: d.endWeek,
                weeklyHours: d.weeklyHours,
                weight: d.weight
            };
        });

        return {
            disciplines: listVM,
            filters: filters,
            total: listVM.length
        };
    }

    function getDisciplineTypeLabel(type) {
        if (type === 'mandatory') { return 'Mandatory'; }
        if (type === 'optional') { return 'Optional'; }
        return 'Unknown';
    }

    // ============================================================
    // DISCIPLINE EDITOR VIEW MODEL
    // ============================================================

    function getDisciplineEditorViewModel(options) {
        options = options || {};

        var draft = options.draft;
        if (!draft) {
            return null;
        }

        var isNew = options.isNew === true;
        var errors = options.errors && typeof options.errors === 'object'
            ? options.errors
            : {};

        var GradeSchemes = getGradeSchemes();
        var schemePreview = '';
        var schemePresetId = 'numeric';
        var schemePresets = [
            { id: 'letter',    label: 'Letter Grade' },
            { id: 'pass_fail', label: 'Pass / Fail' },
            { id: 'numeric',   label: 'Numeric' },
            { id: 'custom',    label: 'Custom' }
        ];

        if (GradeSchemes) {
            if (typeof GradeSchemes.getRangeLabel === 'function') {
                schemePreview = GradeSchemes.getRangeLabel(draft.gradeScheme) || '';
            }
            if (typeof GradeSchemes.getPresets === 'function') {
                var presets = GradeSchemes.getPresets() || [];
                schemePresets = presets.map(function(p) {
                    return { id: p.id, label: p.label };
                });
            }
        }

        if (draft.gradeScheme && typeof draft.gradeScheme.id === 'string') {
            schemePresetId = draft.gradeScheme.id;
        }

        var assessmentTypes = [];
        var defaultAssessmentWeights = {};
        if (typeof AcademyDisciplines.getValidAssessmentTypes === 'function') {
            assessmentTypes = AcademyDisciplines.getValidAssessmentTypes() || [];
        }
        if (typeof AcademyDisciplines.getDefaultAssessmentWeights === 'function') {
            defaultAssessmentWeights = AcademyDisciplines.getDefaultAssessmentWeights() || {};
        }

        var assessmentWeights = draft.assessmentWeights &&
            typeof draft.assessmentWeights === 'object'
            ? draft.assessmentWeights
            : defaultAssessmentWeights;

        return {
            id: isNew ? null : draft.id,
            name: draft.name || '',
            type: draft.type || 'mandatory',
            startWeek: typeof draft.startWeek === 'number' ? draft.startWeek : 1,
            endWeek: typeof draft.endWeek === 'number' ? draft.endWeek : 52,
            weeklyHours: typeof draft.weeklyHours === 'number' ? draft.weeklyHours : 1,
            weight: typeof draft.weight === 'number' ? draft.weight : 1,
            gradeScheme: draft.gradeScheme || null,
            schemePresetId: schemePresetId,
            schemePreview: schemePreview,
            schemePresets: schemePresets,
            assessmentTypes: assessmentTypes,
            assessmentWeights: assessmentWeights,
            defaultAssessmentWeights: defaultAssessmentWeights,
            fieldErrors: errors,
            isNew: isNew
        };
    }

    // ============================================================
    // CLASS-DISCIPLINE PICKER VIEW MODEL (v27)
    // ============================================================

    function getClassDisciplinesPickerViewModel(classId, options) {
        options = options || {};

        if (!isNonEmptyString(classId)) {
            return null;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return null;
        }

        var weekNum = resolveWeek(options.week);

        var allDisciplines = AcademyDisciplines.getDisciplines() || [];

        allDisciplines = allDisciplines.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var rows = [];

        for (var i = 0; i < allDisciplines.length; i++) {
            var d = allDisciplines[i];
            if (!d || !d.id) { continue; }

            var offered = AcademyClassDisciplinesQueries.hasClassDiscipline(
                classId, d.id
            );

            var activeInWeek = false;
            if (weekNum !== null) {
                activeInWeek =
                    AcademyClassDisciplinesQueries.isActiveInWeek(
                        classId, d.id, weekNum
                    );
            }

            var mandatory = false;
            if (offered) {
                var marker =
                    AcademyClassDisciplinesQueries.getClassDiscipline(
                        classId, d.id
                    );
                mandatory = marker && marker.mandatory === true;
            }

            rows.push({
                id: d.id,
                name: d.name || 'Unnamed Discipline',
                type: d.type || 'mandatory',
                typeLabel: getDisciplineTypeLabel(d.type),
                startWeek: isFiniteNumber(d.startWeek) ? d.startWeek : null,
                endWeek: (d.endWeek === null || d.endWeek === undefined)
                    ? null
                    : (isFiniteNumber(d.endWeek) ? d.endWeek : null),
                activeInWeek: activeInWeek,
                offered: offered,
                mandatory: mandatory
            });
        }

        return {
            classId: cls.id,
            className: cls.name || 'Unnamed Class',
            disciplines: rows
        };
    }

    // ============================================================
    // RANKING VIEW MODEL
    // ============================================================

    function getRankingViewModel(classId, week) {
        var classList = getClassListViewModel();

        var selectedClass = null;
        if (classId) {
            for (var i = 0; i < classList.length; i++) {
                if (String(classList[i].id) === String(classId)) {
                    selectedClass = classList[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classes: classList,
                classId: null,
                className: null,
                week: week,
                entries: [],
                total: 0
            };
        }

        var entries = buildRankingEntries(selectedClass.id, week);

        return {
            classes: classList,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: week,
            entries: entries,
            total: entries.length
        };
    }

    function buildRankingEntries(classId, week) {
        var Ranking = getAcademyRanking();
        if (!Ranking || typeof Ranking.getClassRankings !== 'function') {
            return [];
        }

        var ranked;
        try {
            ranked = Ranking.getClassRankings(classId, week) || [];
        } catch (e) {
            return [];
        }

        // WEEK-SCOPED instructor exclusion.
        var weekNum = resolveWeek(week);
        var instructorIds = getClassInstructorIds(classId, weekNum);
        var instructorSet = buildIdSet(instructorIds);

        var entries = ranked.map(function(r) {
            var studentId = r.studentId || r.characterId;
            var name = r.studentName || getCharacterDisplayName(studentId);

            var average = null;
            if (isFiniteNumber(r.average)) {
                average = r.average;
            } else if (isFiniteNumber(r.academicAverage)) {
                average = r.academicAverage;
            } else if (isFiniteNumber(r.overallScore)) {
                average = r.overallScore;
            }

            var rank = isFiniteNumber(r.rank) ? r.rank : null;
            var gradeCount = isFiniteNumber(r.gradeCount) ? r.gradeCount : null;

            return {
                characterId: studentId,
                characterName: name,
                rank: rank,
                rankDisplay: rank !== null ? '#' + rank : '\u2014',
                average: average,
                averageDisplay: average !== null ? String(average) : '\u2014',
                gradeCount: gradeCount,
                gradeCountDisplay: gradeCount !== null ? String(gradeCount) : '\u2014',
                isInstructor: instructorSet[String(studentId)] === true
            };
        });

        entries.sort(function(a, b) {
            var ar = a.rank !== null ? a.rank : 999999;
            var br = b.rank !== null ? b.rank : 999999;
            return ar - br;
        });

        return entries;
    }

    // ============================================================
    // LOCATION VIEW MODEL
    // ============================================================

    function getLocationViewModel(filters, week, selectedLocationId) {
        filters = filters || {};

        var allLocations = AcademyLocations.getLocations() || [];

        var type = filters.type || 'all';
        var search = (filters.search || '').toLowerCase().trim();

        var filtered = allLocations.filter(function(l) {
            if (!l || !l.id) { return false; }
            if (type !== 'all' && l.type !== type) { return false; }
            if (search && (l.name || '').toLowerCase().indexOf(search) === -1) {
                return false;
            }
            return true;
        });

        var selected = null;
        if (selectedLocationId) {
            for (var i = 0; i < filtered.length; i++) {
                if (String(filtered[i].id) === String(selectedLocationId)) {
                    selected = buildLocationDetailVM(filtered[i], week);
                    break;
                }
            }
        }

        var listVM = filtered.map(function(l) {
            return buildLocationListRowVM(l, week);
        });

        return {
            locations: listVM,
            selected: selected,
            filters: filters,
            week: week,
            total: listVM.length
        };
    }

    function buildLocationListRowVM(location, week) {
        var schedule = getLocationScheduleForWeek(location.id, week);
        return {
            id: location.id,
            name: location.name,
            type: location.type,
            typeLabel: getLocationTypeLabel(location.type),
            capacity: location.capacity !== undefined ? location.capacity : null,
            scheduleCount: schedule.length
        };
    }

    function buildLocationDetailVM(location, week) {
        var schedule = getLocationScheduleForWeek(location.id, week);
        return {
            id: location.id,
            name: location.name,
            type: location.type,
            typeLabel: getLocationTypeLabel(location.type),
            capacity: location.capacity !== undefined ? location.capacity : null,
            schedule: schedule
        };
    }

    function getLocationTypeLabel(type) {
        if (!isNonEmptyString(type)) { return 'Other'; }
        return type.charAt(0).toUpperCase() + type.slice(1);
    }

    function getLocationScheduleForWeek(locationId, week) {
        if (!locationId || week === undefined || week === null) {
            return [];
        }

        var ACA = getAcademyCalendarAggregator();
        if (!ACA || typeof ACA.getLocationScheduleViewModel !== 'function') {
            return [];
        }

        var vm;
        try {
            vm = ACA.getLocationScheduleViewModel(locationId, week);
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getLocationScheduleViewModel failed:',
                e
            );
            return [];
        }

        if (!vm || !vm.schedule) {
            return [];
        }

        return flattenScheduleMap(vm.schedule);
    }

    function flattenScheduleMap(scheduleMap) {
        var result = [];
        if (!scheduleMap || typeof scheduleMap !== 'object') {
            return result;
        }

        var dayKeys = Object.keys(scheduleMap);
        for (var i = 0; i < dayKeys.length; i++) {
            var dayKey = dayKeys[i];
            var dayNum = parseInt(dayKey, 10);
            if (isNaN(dayNum)) { continue; }

            var daySchedule = scheduleMap[dayKey];
            if (!daySchedule || typeof daySchedule !== 'object') { continue; }

            var hourKeys = Object.keys(daySchedule);
            for (var j = 0; j < hourKeys.length; j++) {
                var hourKey = hourKeys[j];
                var hourNum = parseInt(hourKey, 10);
                if (isNaN(hourNum)) { continue; }

                var slot = daySchedule[hourKey];
                if (!slot) { continue; }

                result.push({
                    day: dayNum,
                    hour: hourNum,
                    disciplineId: slot.disciplineId || null,
                    disciplineName: slot.disciplineName || 'Unknown',
                    duration: isFiniteNumber(slot.duration) ? slot.duration : 1,
                    label: isNonEmptyString(slot.label) ? slot.label : ''
                });
            }
        }

        result.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            return a.hour - b.hour;
        });

        return result;
    }

    // ============================================================
    // WEEKLY TEAMS VIEW MODEL
    // ============================================================

    function getWeeklyTeamsViewModel(classId, week, selectedTeamId) {
        var classList = getClassListViewModel();

        var selectedClass = null;
        if (classId) {
            for (var i = 0; i < classList.length; i++) {
                if (String(classList[i].id) === String(classId)) {
                    selectedClass = classList[i];
                    break;
                }
            }
        }

        var orphanTeams = getUnassignedTeamsViewModel().orphanTeams;

        var orphanClasses = classList.map(function(c) {
            return { id: c.id, name: c.name };
        });

        if (!selectedClass) {
            return {
                classes: classList,
                classId: null,
                className: null,
                week: week,
                teams: [],
                selectedTeamId: null,
                selectedTeam: null,
                orphanTeams: orphanTeams,
                orphanClasses: orphanClasses
            };
        }

        var AWT = getAcademyWeeklyTeams();
        var scheduledTeamIds = Object.create(null);
        if (AWT && typeof AWT.getWeeklyTeams === 'function') {
            var assignments;
            try {
                assignments = AWT.getWeeklyTeams(selectedClass.id, week) || {};
            } catch (e) {
                assignments = {};
            }
            var scheduledKeys = Object.keys(assignments);
            for (var k = 0; k < scheduledKeys.length; k++) {
                scheduledTeamIds[String(scheduledKeys[k])] = true;
            }
        }

        var teams = buildWeeklyTeamsList(
            selectedClass.id,
            week,
            scheduledTeamIds
        );

        var selectedTeamVM = null;
        var resolvedSelectedTeamId = null;
        if (selectedTeamId) {
            for (var j = 0; j < teams.length; j++) {
                if (String(teams[j].id) === String(selectedTeamId)) {
                    selectedTeamVM = buildWeeklyTeamDetail(teams[j]._team, week);
                    resolvedSelectedTeamId = teams[j].id;
                    break;
                }
            }
        }

        var teamsVM = teams.map(function(t) {
            return {
                id: t.id,
                name: t.name,
                type: t.type,
                typeLabel: t.typeLabel,
                status: t.status,
                statusLabel: t.statusLabel,
                periodLabel: t.periodLabel,
                periodDisplay: t.periodDisplay,
                memberCount: t.memberCount
            };
        });

        return {
            classes: classList,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: week,
            teams: teamsVM,
            selectedTeamId: resolvedSelectedTeamId,
            selectedTeam: selectedTeamVM,
            orphanTeams: orphanTeams,
            orphanClasses: orphanClasses
        };
    }

    function buildWeeklyTeamsList(classId, week, scheduledTeamIds) {
        if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
            return [];
        }

        var raw = TeamQueries.getTeamsByClass(classId) || [];
        if (!Array.isArray(raw)) {
            return [];
        }

        var items = [];

        for (var i = 0; i < raw.length; i++) {
            var team = raw[i];
            if (!team || !team.id) { continue; }
            if (team.type !== 'academic') { continue; }

            if (typeof TeamQueries.isTeamActiveAtPeriod === 'function') {
                if (!TeamQueries.isTeamActiveAtPeriod(team, week)) {
                    continue;
                }
            }

            if (scheduledTeamIds &&
                scheduledTeamIds[String(team.id)] !== true) {
                continue;
            }

            var activeMembers = TeamQueries.getActiveTeamMembers(
                team,
                week
            ) || [];

            items.push({
                id: team.id,
                name: team.name || 'Unnamed Team',
                type: team.type,
                typeLabel: TeamConstants.getTypeLabel(team.type),
                status: team.status || 'active',
                statusLabel: getTeamStatusLabel(team.status),
                periodLabel: TeamConstants.getPeriodLabel(team.type),
                periodDisplay: getTeamPeriodDisplay(team),
                memberCount: activeMembers.length,
                _team: team
            });
        }

        items.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return items;
    }

    function getTeamStatusLabel(status) {
        if (!isNonEmptyString(status)) { return 'Active'; }
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    function buildWeeklyTeamDetail(team, week) {
        if (!team) { return null; }

        var activeMembers = TeamQueries.getActiveTeamMembers(
            team,
            week
        ) || [];

        var members = buildTeamMembersVM(activeMembers, team.type);

        return {
            id: team.id,
            name: team.name || 'Unnamed Team',
            type: team.type,
            typeLabel: TeamConstants.getTypeLabel(team.type),
            status: team.status || 'active',
            statusLabel: getTeamStatusLabel(team.status),
            periodLabel: TeamConstants.getPeriodLabel(team.type),
            periodDisplay: getTeamPeriodDisplay(team),
            temporaryMission: team.temporaryMission || null,
            memberCount: members.length,
            members: members
        };
    }

    // ============================================================
    // MEMBER PERIOD DISPLAY
    // ============================================================

    function formatMemberPeriodDisplay(joinPeriod, leavePeriod, teamType) {
        var isAcademic = String(teamType) === 'academic';
        var prefix = isAcademic ? 'Wk ' : '';

        var hasJoin = joinPeriod !== undefined &&
                      joinPeriod !== null &&
                      joinPeriod !== '';
        var hasLeave = leavePeriod !== undefined &&
                       leavePeriod !== null &&
                       leavePeriod !== '';

        var joinStr = hasJoin ? String(joinPeriod) : '';
        var leaveStr = hasLeave ? String(leavePeriod) : '';

        if (joinStr && leaveStr) {
            return prefix + joinStr + ' \u2013 ' + prefix + leaveStr;
        }
        if (joinStr) {
            return prefix + joinStr + ' \u2013';
        }
        if (leaveStr) {
            return 'Until ' + prefix + leaveStr;
        }
        return '';
    }

    // ============================================================
    // TEAM MEMBERS VIEW MODEL
    // ============================================================

    function buildTeamMembersVM(activeMemberRecords, teamType) {
        if (!Array.isArray(activeMemberRecords)) {
            return [];
        }

        var result = [];

        for (var i = 0; i < activeMemberRecords.length; i++) {
            var record = activeMemberRecords[i];
            if (!record) { continue; }

            var charId = record.characterId;
            if (!charId) { continue; }

            var memberId = isNonEmptyString(record.memberId)
                ? String(record.memberId)
                : '';

            var intervalsVM = [];
            var summaryParts = [];
            if (Array.isArray(record.intervals)) {
                for (var j = 0; j < record.intervals.length; j++) {
                    var iv = record.intervals[j];
                    if (!iv || typeof iv !== 'object') { continue; }

                    var ivJoin = (iv.joinPeriod !== undefined &&
                                  iv.joinPeriod !== null)
                        ? String(iv.joinPeriod)
                        : '';
                    var ivLeave = (iv.leavePeriod !== undefined &&
                                   iv.leavePeriod !== null)
                        ? String(iv.leavePeriod)
                        : '';

                    var ivDisplay = formatMemberPeriodDisplay(
                        ivJoin, ivLeave, teamType
                    );

                    intervalsVM.push({
                        joinPeriod: ivJoin,
                        leavePeriod: ivLeave,
                        periodDisplay: ivDisplay
                    });

                    if (ivDisplay) {
                        summaryParts.push(ivDisplay);
                    }
                }
            }

            var periodDisplay = summaryParts.join('; ');

            var char = CharacterQueries.getCharacterById(charId);
            if (!char) {
                result.push({
                    memberId: memberId,
                    characterId: charId,
                    name: 'Unknown',
                    role: record.role || 'Member',
                    roleLabel: '',
                    age: '',
                    statusLabel: '',
                    deceased: false,
                    intervals: intervalsVM,
                    periodDisplay: periodDisplay
                });
                continue;
            }

            result.push({
                memberId: memberId,
                characterId: charId,
                name: CharacterQueries.getDisplayName(char),
                role: record.role || 'Member',
                roleLabel: '',
                age: CharacterQueries.getCharacterAge(char),
                statusLabel: CharacterQueries.getCurrentStatus(char),
                deceased: char.deceased === true,
                intervals: intervalsVM,
                periodDisplay: periodDisplay
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // MEMBER PARTITION (active / former)
    // ============================================================

    function partitionTeamMembers(team, weekNum) {
        var activeRecords = TeamQueries.getActiveTeamMembers(team, weekNum) || [];

        var activeKeys = Object.create(null);
        for (var i = 0; i < activeRecords.length; i++) {
            var rec = activeRecords[i];
            if (!rec) { continue; }

            if (isNonEmptyString(rec.memberId)) {
                activeKeys['id:' + String(rec.memberId)] = true;
            }
            var cid = rec.characterId !== undefined && rec.characterId !== null
                ? String(rec.characterId)
                : '';
            var firstJoin = '';
            if (Array.isArray(rec.intervals) && rec.intervals.length > 0) {
                var first = rec.intervals[0];
                if (first && first.joinPeriod !== undefined &&
                    first.joinPeriod !== null) {
                    firstJoin = String(first.joinPeriod);
                }
            }
            activeKeys['composite:' + cid + '::' + firstJoin] = true;
        }

        var allRecords = TeamQueries.getAllTeamMemberRecords(team) || [];
        var formerRecords = [];

        for (var j = 0; j < allRecords.length; j++) {
            var m = allRecords[j];
            if (!m) { continue; }

            if (isNonEmptyString(m.memberId) &&
                activeKeys['id:' + String(m.memberId)]) {
                continue;
            }
            var mCid = m.characterId !== undefined && m.characterId !== null
                ? String(m.characterId)
                : '';
            var mFirstJoin = '';
            if (Array.isArray(m.intervals) && m.intervals.length > 0) {
                var mFirst = m.intervals[0];
                if (mFirst && mFirst.joinPeriod !== undefined &&
                    mFirst.joinPeriod !== null) {
                    mFirstJoin = String(mFirst.joinPeriod);
                }
            }
            if (activeKeys['composite:' + mCid + '::' + mFirstJoin]) {
                continue;
            }

            if (!Array.isArray(m.intervals)) { continue; }

            var isFormer = false;
            for (var k = 0; k < m.intervals.length; k++) {
                var iv = m.intervals[k];
                if (!iv || typeof iv !== 'object') { continue; }

                var hasLeave = iv.leavePeriod !== undefined &&
                               iv.leavePeriod !== null &&
                               iv.leavePeriod !== '';
                if (!hasLeave) { continue; }

                var leaveNum = TeamConstants.parsePeriod(iv.leavePeriod);
                if (leaveNum === null) { continue; }

                if (leaveNum < weekNum) {
                    isFormer = true;
                    break;
                }
            }

            if (isFormer) {
                formerRecords.push(m);
            }
        }

        return {
            activeRecords: activeRecords,
            formerRecords: formerRecords
        };
    }

    // ============================================================
    // UNASSIGNED (ORPHAN) ACADEMIC TEAMS
    // ============================================================

    function getUnassignedTeamsViewModel(options) {
        options = options || {};

        var AWT = getAcademyWeeklyTeams();
        if (!AWT || typeof AWT.getOrphanAcademicTeams !== 'function') {
            return { orphanTeams: [] };
        }

        var orphans = [];
        try {
            orphans = AWT.getOrphanAcademicTeams() || [];
        } catch (e) {
            console.warn(
                '[AcademyAggregator] getOrphanAcademicTeams failed:', e
            );
            return { orphanTeams: [] };
        }

        var result = orphans.map(function(o) {
            return {
                id: o.id,
                name: o.name || 'Unnamed Team',
                memberCount: isFiniteNumber(o.memberCount) ? o.memberCount : 0,
                suggestedClassId: isNonEmptyString(o.suggestedClassId)
                    ? o.suggestedClassId
                    : null
            };
        });

        return { orphanTeams: result };
    }

    // ============================================================
    // WEEKLY TEAM MEMBER MANAGER VIEW MODEL
    // ============================================================

    function getWeeklyTeamMemberManagerViewModel(options) {
        if (!options || typeof options !== 'object') {
            return null;
        }

        var classId = isNonEmptyString(options.classId)
            ? String(options.classId)
            : null;
        var teamId = isNonEmptyString(options.teamId)
            ? String(options.teamId)
            : null;
        var weekNum = resolveWeek(options.week);

        if (!classId || !teamId || weekNum === null) {
            return null;
        }

        var EQ = getEliminationQueries();
        if (!EQ || typeof EQ.isCharacterEliminatedByWeek !== 'function') {
            throw new Error(
                '[AcademyAggregator] getWeeklyTeamMemberManagerViewModel ' +
                'requires EliminationQueries.isCharacterEliminatedByWeek. ' +
                'The candidate pool cannot be built without it.'
            );
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }
        if (team.classId === null ||
            team.classId === undefined ||
            team.classId === '') {
            return null;
        }
        if (String(team.classId) !== classId) {
            return null;
        }

        var partition = partitionTeamMembers(team, weekNum);

        var members = buildTeamMembersVM(partition.activeRecords, team.type);
        var formerMembers = buildTeamMembersVM(
            partition.formerRecords, team.type
        );

        var allCurrentIds = Object.create(null);
        if (Array.isArray(team.members)) {
            for (var c = 0; c < team.members.length; c++) {
                var m = team.members[c];
                if (m && m.characterId) {
                    allCurrentIds[String(m.characterId)] = true;
                }
            }
        }

        var assignedElsewhere = Object.create(null);
        var classTeams = TeamQueries.getTeamsByClass(classId, 'operational') || [];
        for (var t = 0; t < classTeams.length; t++) {
            var sibling = classTeams[t];
            if (!sibling || String(sibling.id) === teamId) continue;
            if (TeamConstants.normalizeTeamType(sibling.type) !== 'academic') continue;
            var siblingMembers = TeamQueries.getActiveTeamMembers(sibling, weekNum) || [];
            for (var s = 0; s < siblingMembers.length; s++) {
                var sm = siblingMembers[s];
                if (sm && sm.characterId) {
                    assignedElsewhere[String(sm.characterId)] = true;
                }
            }
        }

        var instructorSet = getClassInstructorSetForClass(classId);

        var roster = deriveClassRoster(classId, weekNum);

        var candidates = [];

        for (var r = 0; r < roster.length; r++) {
            var student = roster[r];
            if (!student || !student.id) continue;

            var studentId = String(student.id);

            if (instructorSet[studentId]) {
                continue;
            }
            if (allCurrentIds[studentId]) {
                continue;
            }
            if (assignedElsewhere[studentId]) {
                continue;
            }

            if (EQ.isCharacterEliminatedByWeek(studentId, weekNum) === true) {
                continue;
            }

            candidates.push({
                id: studentId,
                name: student.name,
                status: student.status || ''
            });
        }

        candidates.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return {
            teamId: teamId,
            teamName: team.name || 'Unnamed Team',
            week: weekNum,
            members: members,
            formerMembers: formerMembers,
            candidates: candidates
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyAggregator = Object.freeze({
        // Class projections
        getClassListViewModel: getClassListViewModel,
        getClassViewModel: getClassViewModel,
        getClassStudentsViewModel: getClassStudentsViewModel,

        // People
        getPeopleViewModel: getPeopleViewModel,

        // Character projections
        getStudentViewModel: getStudentViewModel,
        getInstructorViewModel: getInstructorViewModel,

        // Instructor projections
        getClassInstructorDisciplines: getClassInstructorDisciplines,
        getInstructorGroupPickerViewModel: getInstructorGroupPickerViewModel,

        // Discipline projections
        getDisciplineListViewModel: getDisciplineListViewModel,
        getDisciplineEditorViewModel: getDisciplineEditorViewModel,

        // Class-discipline picker
        getClassDisciplinesPickerViewModel: getClassDisciplinesPickerViewModel,

        // Ranking
        getRankingViewModel: getRankingViewModel,

        // Location
        getLocationViewModel: getLocationViewModel,

        // Weekly teams
        getWeeklyTeamsViewModel: getWeeklyTeamsViewModel,
        getWeeklyTeamMemberManagerViewModel: getWeeklyTeamMemberManagerViewModel,
        getUnassignedTeamsViewModel: getUnassignedTeamsViewModel,

        // Rebalance input (v32)
        getRebalanceInputViewModel: getRebalanceInputViewModel,

        // Free slot candidates (v33)
        getFreeSlotCandidateStudentsViewModel:
            getFreeSlotCandidateStudentsViewModel,

        // Instructor-of-class (YEAR-LEVEL rule).
        getClassInstructorSetForClass: getClassInstructorSetForClass
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyAggregator;
        var missing = [];

        var required = [
            'getClassListViewModel',
            'getClassViewModel',
            'getClassStudentsViewModel',
            'getPeopleViewModel',
            'getStudentViewModel',
            'getInstructorViewModel',
            'getClassInstructorDisciplines',
            'getInstructorGroupPickerViewModel',
            'getDisciplineListViewModel',
            'getDisciplineEditorViewModel',
            'getClassDisciplinesPickerViewModel',
            'getRankingViewModel',
            'getLocationViewModel',
            'getWeeklyTeamsViewModel',
            'getWeeklyTeamMemberManagerViewModel',
            'getUnassignedTeamsViewModel',
            'getRebalanceInputViewModel',
            'getFreeSlotCandidateStudentsViewModel',
            'getClassInstructorSetForClass'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (RangeUtils.containsWeek(5, 1, 10) !== true) {
                missing.push('RangeUtils.containsWeek active-in-range failed');
            }
            if (RangeUtils.containsWeek(10, 1, 10) !== true) {
                missing.push('RangeUtils.containsWeek inclusive end failed');
            }
            if (RangeUtils.containsWeek(11, 1, 10) !== false) {
                missing.push('RangeUtils.containsWeek past-end failed');
            }
            if (RangeUtils.containsWeek(52, 1, null) !== true) {
                missing.push('RangeUtils.containsWeek open end failed');
            }
        } catch (e) {
            missing.push('range-delegation smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyAggregator] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
