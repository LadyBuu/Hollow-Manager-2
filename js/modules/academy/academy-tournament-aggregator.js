/**
 * modules/academy/academy-tournament-aggregator.js - Academy Tournament Aggregator
 * Academy-scoped projection builder for the Exams view.
 *
 * Path: js/modules/academy/academy-tournament-aggregator.js
 *
 * This module is responsible for:
 *   - Building the exam view model for a class + week
 *   - Building the exam pool (eligible characters or teams)
 *
 * IMPORTANT:
 *   - Projection builder. No mutations. No persistence. No DOM.
 *   - Composes AcademyAggregator + TournamentQueries + TournamentAggregator
 *     + TeamQueries + EliminationQueries.
 *   - Does NOT depend on AcademyQueries. Class list comes from
 *     AcademyAggregator.getClassListViewModel().
 *   - Does NOT depend on CharacterQueries. Pool identity comes from
 *     AcademyAggregator.getClassStudentsViewModel(); elimination
 *     queries accept IDs directly.
 *
 * IDENTITY PRESERVATION:
 *   Round and match IDs are STABLE. The TournamentAggregator VM
 *   carries `id` on every round and every match. This projection
 *   MUST pass those IDs through unchanged. Every round- and match-
 *   scoped action in the Academy view reads the ID from a data-*
 *   attribute and dispatches on it; a projection that drops the ID
 *   silently disables every such action.
 *
 *   The rule is: any field on the source VM that downstream code
 *   uses as an identity or dispatch key is a REQUIRED passthrough.
 *   `id` is the primary example. `index` is preserved too because
 *   some UI code uses it for ordering.
 *
 * EXAM MODE SEMANTICS:
 *   - When an exam exists, its `mode` field is authoritative.
 *   - When no exam exists, mode is 'individuals'.
 *   - Mode is NOT inferred from the presence of academic teams in
 *     the class. That would be domain inference masquerading as UI
 *     convenience: "this class has teams, so the next exam must be
 *     team-based" is not a valid deduction.
 *
 * WEEK SEMANTICS:
 *   - No `week || 1` defaults. Callers must supply a valid week.
 *     When the week is invalid, the aggregator returns a view model
 *     with `week: null` and an empty pool. It does not silently
 *     substitute a default.
 *
 * ELIMINATION QUERIES:
 *   - EliminationQueries.isCharacterEliminatedByWeek accepts either a
 *     character ID or a character object. This module passes IDs. No
 *     CharacterQueries round-trip.
 *   - The elimination query is NOT wrapped in try/catch. If it throws,
 *     that is a bug the caller should see, not a state we should
 *     silently misrepresent as "not eliminated".
 *
 * POOL MEMBERSHIP:
 *   - Character pool: students only. Instructors do NOT appear in the
 *     pool. The class instructor is not a participant in exams, even
 *     if the class record carries an instructorId.
 *   - Team pool: persistent academic Team entities from TeamQueries.
 *     This is the Tournament domain's team concept, distinct from
 *     academy.weeklyTeams (which is the Academy's week-scoped
 *     assignment).
 *
 * PARTICIPANT DEDUPLICATION:
 *   - When an exam exists, its participant set is read from the exam
 *     VM's `participants` array. The VM was already built with
 *     `includeParticipants: true`. We do NOT call
 *     TournamentQueries.getParticipants() a second time for the same
 *     data.
 *
 * DEPENDENCIES:
 *   - window.AcademyAggregator (MANDATORY)
 *   - window.TeamQueries (MANDATORY)
 *   - window.TournamentQueries (MANDATORY)
 *   - window.TournamentAggregator (MANDATORY)
 *   - window.EliminationQueries (OPTIONAL — the `eliminated` flag
 *     degrades to false when the module is absent)
 */

(function() {
    'use strict';

    if (window.__academyTournamentAggregatorLoaded) {
        return;
    }
    window.__academyTournamentAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var AcademyAggregator = window.AcademyAggregator;
    var TeamQueries = window.TeamQueries;
    var TournamentQueries = window.TournamentQueries;
    var TournamentAggregator = window.TournamentAggregator;
    var EliminationQueries = window.EliminationQueries || null;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyAggregator ||
            typeof AcademyAggregator.getClassListViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassListViewModel');
        }
        if (!AcademyAggregator ||
            typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassStudentsViewModel');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
            missing.push('TeamQueries.getTeamsByClass');
        }

        if (!TournamentQueries ||
            typeof TournamentQueries.getExamForClassAndWeek !== 'function') {
            missing.push('TournamentQueries.getExamForClassAndWeek');
        }

        if (!TournamentAggregator ||
            typeof TournamentAggregator.getTournamentViewModel !== 'function') {
            missing.push('TournamentAggregator.getTournamentViewModel');
        }

        if (missing.length > 0) {
            console.warn('[AcademyTournamentAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    /**
     * Build the full Exams view model.
     *
     * @param {string|null} classId - Currently selected class, or null
     * @param {number} week - Week number (must be valid)
     * @returns {object} {
     *   classList: [ { id, name } ],
     *   classId: string|null,
     *   className: string|null,
     *   week: number|null,
     *   exam: object|null,
     *   pool: array
     * }
     */
    function getExamViewModel(classId, week) {
        if (!checkDependencies()) {
            return emptyViewModel(null);
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) {
            return emptyViewModel(null);
        }

        // ---- Class list from the canonical Academy projection ----
        var classListFull = AcademyAggregator.getClassListViewModel() || [];
        var classListVM = classListFull.map(function(c) {
            return { id: c.id, name: c.name };
        });

        // ---- Resolve selected class ----
        var selectedClass = null;
        if (classId) {
            for (var i = 0; i < classListVM.length; i++) {
                if (String(classListVM[i].id) === String(classId)) {
                    selectedClass = classListVM[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classList: classListVM,
                classId: null,
                className: null,
                week: weekNum,
                exam: null,
                pool: []
            };
        }

        // ---- Build ----
        var examVM = buildExamViewModel(selectedClass, weekNum);
        var pool = buildExamPool(selectedClass, weekNum, examVM);

        return {
            classList: classListVM,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: weekNum,
            exam: examVM,
            pool: pool
        };
    }

    function emptyViewModel(week) {
        return {
            classList: [],
            classId: null,
            className: null,
            week: week,
            exam: null,
            pool: []
        };
    }

    // ============================================================
    // EXAM VM
    // ============================================================

    function buildExamViewModel(classRecord, week) {
        var TQ = window.TournamentQueries;
        var TA = window.TournamentAggregator;
        if (!TQ || !TA) { return null; }

        var examRecord = null;
        if (typeof TQ.getExamForClassAndWeek === 'function') {
            examRecord = TQ.getExamForClassAndWeek(classRecord.id, week);
        }
        if (!examRecord) { return null; }

        var vm = TA.getTournamentViewModel(examRecord.id, {
            includeParticipants: true,
            includeRounds: true,
            includeEliminations: false,
            includeFinalPassers: true,
            includeStatistics: false
        });
        if (!vm) { return null; }

        return {
            id: vm.id,
            name: vm.name,
            status: vm.status,
            statusLabel: vm.statusDisplay ? vm.statusDisplay.text : vm.status,
            mode: vm.mode,
            modeLabel: vm.modeLabel,
            participantCount: vm.participantCount || 0,
            roundCount: vm.roundCount || 0,
            totalRounds: vm.totalRounds || 1,
            participants: vm.participants || [],
            finalPassers: vm.finalPassers || [],
            finalPasserCount: vm.finalPasserCount || 0,
            rounds: (vm.rounds || []).map(buildExamRoundVM)
        };
    }

    /**
     * Project a round VM.
     *
     * REQUIRED PASSTHROUGH: `id`. Every round-scoped action in the
     * Academy view reads data-round-id and dispatches on it. Dropping
     * the ID disables "Auto-Generate", "Add Match", "Remove Round",
     * and every match action that carries the round ID as context.
     */
    function buildExamRoundVM(round) {
        if (!round) { return null; }

        return {
            // ---- Identity ----
            id: round.id,
            index: round.index,

            // ---- Display ----
            roundNumber: round.roundNumber,
            status: round.status,
            statusLabel: round.statusDisplay ? round.statusDisplay.text : round.status,
            matchSize: round.matchSize,
            matchType: round.matchType,
            matchTypeLabel: round.matchTypeLabel,
            isPairExam: round.isPairExam === true,

            // ---- Matches ----
            matches: (round.matches || []).map(buildExamMatchVM)
        };
    }

    /**
     * Project a match VM.
     *
     * REQUIRED PASSTHROUGH: `id`. Every match-scoped action reads
     * data-match-id. Dropping it disables "Edit Match", "Complete
     * Match", and "Remove Match".
     */
    function buildExamMatchVM(match) {
        if (!match) { return null; }

        var vm = {
            // ---- Identity ----
            id: match.id,
            index: match.index,

            // ---- Display ----
            type: match.type,
            typeLabel: match.typeLabel,
            status: match.status,
            statusLabel: match.statusDisplay ? match.statusDisplay.text : match.status,
            isPairExam: match.isPairExam === true,
            isGroupExam: match.isGroupExam === true,
            isTeamMatch: match.isTeamMatch === true,
            isComplete: match.isComplete === true,
            participantCount: match.participantCount || 0
        };

        if (Array.isArray(match.participants)) {
            vm.participants = match.participants.map(buildExamParticipantVM);
        }

        if (Array.isArray(match.pairings)) {
            vm.pairings = match.pairings.map(function(pair) {
                return Array.isArray(pair)
                    ? pair.map(buildExamParticipantVM)
                    : [];
            });
        }

        if (Array.isArray(match.teams)) {
            vm.teams = match.teams.map(buildExamTeamVM);
        }

        return vm;
    }

    function buildExamParticipantVM(participant) {
        if (!participant) { return null; }
        return {
            id: participant.id,
            name: participant.name,
            type: participant.type,
            typeLabel: participant.typeLabel,
            result: participant.result,
            resultCategory: participant.resultCategory,
            outcomeDisplay: participant.outcomeDisplay,
            isPassing: participant.isPassing === true,
            isRetrying: participant.isRetrying === true,
            isFailing: participant.isFailing === true
        };
    }

    function buildExamTeamVM(team) {
        if (!team) { return null; }
        return {
            teamId: team.teamId,
            name: team.name,
            result: team.result,
            resultCategory: team.resultCategory,
            outcomeDisplay: team.outcomeDisplay,
            isPassing: team.isPassing === true,
            isRetrying: team.isRetrying === true,
            isFailing: team.isFailing === true,
            members: (team.members || []).map(function(member) {
                return {
                    characterId: member.characterId,
                    name: member.name,
                    role: member.role,
                    result: member.result,
                    resultCategory: member.resultCategory,
                    outcomeDisplay: member.outcomeDisplay,
                    isPassing: member.isPassing === true,
                    isRetrying: member.isRetrying === true,
                    isFailing: member.isFailing === true
                };
            }),
            memberCount: team.memberCount || 0
        };
    }

    // ============================================================
    // EXAM POOL
    // ============================================================
    //
    // MODE:
    //   - Exam exists: mode comes from the exam record.
    //   - No exam: mode is 'individuals'.
    //   - Mode is NEVER inferred from academic team existence.
    //
    // POOL SOURCE:
    //   - Characters: AcademyAggregator.getClassStudentsViewModel.
    //     Instructors are excluded. Only actual students.
    //   - Teams: TeamQueries.getTeamsByClass filtered to academic
    //     teams. These are persistent Team entities, NOT Academy
    //     weekly assignments.

    function buildExamPool(classRecord, week, examVM) {
        var mode = 'individuals';
        if (examVM && examVM.mode) {
            mode = examVM.mode;
        }

        if (examVM) {
            return buildExamPoolWithExam(classRecord, week, examVM, mode);
        }

        if (mode === 'teams') {
            return buildTeamPoolForClass(classRecord, week, {});
        }
        return buildCharacterPoolForClass(classRecord, week, {});
    }

    function buildExamPoolWithExam(classRecord, week, examVM, mode) {
        var inExamSet = {};

        // Read the participant set from the exam VM, not from a second
        // TournamentQueries call. The VM was built with
        // includeParticipants: true, so vm.participants is authoritative.
        if (examVM && Array.isArray(examVM.participants)) {
            for (var i = 0; i < examVM.participants.length; i++) {
                var p = examVM.participants[i];
                if (p && p.id) {
                    inExamSet[String(p.id)] = true;
                }
            }
        }

        if (mode === 'teams') {
            return buildTeamPoolForClass(classRecord, week, inExamSet);
        }
        return buildCharacterPoolForClass(classRecord, week, inExamSet);
    }

    function buildCharacterPoolForClass(classRecord, week, inExamSet) {
        // Canonical class students projection. Instructors are
        // excluded by the aggregator. Only students appear here.
        var students = AcademyAggregator.getClassStudentsViewModel(classRecord.id) || [];

        var pool = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            if (!student || !student.id) { continue; }

            // Elimination query takes an ID. No CharacterQueries
            // round-trip. No try/catch: if the query is broken, the
            // caller should see the error, not a silent "not
            // eliminated".
            var eliminated = false;
            if (EliminationQueries &&
                typeof EliminationQueries.isCharacterEliminatedByWeek === 'function') {
                eliminated = EliminationQueries.isCharacterEliminatedByWeek(student.id, week) === true;
            }

            pool.push({
                id: student.id,
                name: student.name,
                subtitle: student.status || '',
                inExam: inExamSet[String(student.id)] === true,
                eliminated: eliminated
            });
        }

        return pool;
    }

    function buildTeamPoolForClass(classRecord, week, inExamSet) {
        var TeamQ = window.TeamQueries;
        if (!TeamQ || typeof TeamQ.getTeamsByClass !== 'function') {
            return [];
        }

        var teams = TeamQ.getTeamsByClass(classRecord.id) || [];
        var pool = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            if (team.type !== 'academic') { continue; }

            // Activity check: prefer the domain predicate when
            // available. When it is not, do NOT invent a default
            // period. Treat the team as active — the alternative
            // (silently dropping teams whose period data is malformed)
            // is worse than showing them and letting the user decide.
            var active = true;
            if (TeamQ && typeof TeamQ.isTeamActiveAtPeriod === 'function') {
                active = TeamQ.isTeamActiveAtPeriod(team, week) === true;
            }
            if (!active) { continue; }

            var subtitleParts = [];
            if (team.periodDisplay) { subtitleParts.push(team.periodDisplay); }
            if (team.status && team.status !== 'active') {
                subtitleParts.push(team.status);
            }

            pool.push({
                id: team.id,
                name: team.name || 'Unnamed Team',
                subtitle: subtitleParts.join(' \u00b7 '),
                inExam: inExamSet[String(team.id)] === true,
                eliminated: false
            });
        }

        return pool;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTournamentAggregator = {
        getExamViewModel: getExamViewModel,

        // Exposed for testing / advanced callers. Not part of the
        // stable API.
        buildExamViewModel: buildExamViewModel,
        buildExamPool: buildExamPool,
        buildCharacterPoolForClass: buildCharacterPoolForClass,
        buildTeamPoolForClass: buildTeamPoolForClass,
        buildExamRoundVM: buildExamRoundVM,
        buildExamMatchVM: buildExamMatchVM
    };

})();
