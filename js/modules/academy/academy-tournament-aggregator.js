/**
 * modules/academy/academy-tournament-aggregator.js - Academy Tournament Aggregator
 * Academy-scoped projection builder for the Exams view.
 *
 * Path: js/modules/academy/academy-tournament-aggregator.js
 *
 * This module is responsible for:
 *   - Building the exam view model for a class + week
 *   - Building the exam pool (eligible characters or teams)
 *   - Surfacing eliminations with enough data for the UI to render
 *     an "Eliminated" section and restore individual participants
 *
 * IMPORTANT:
 *   - Projection builder. No mutations. No persistence. No DOM.
 *   - Composes AcademyAggregator + TournamentQueries + TournamentAggregator
 *     + TeamQueries + EliminationQueries.
 *   - Does NOT depend on AcademyQueries. Class list comes from
 *     AcademyAggregator.getClassListViewModel().
 *   - Does NOT depend on CharacterQueries. Pool identity comes from
 *     AcademyAggregator.getClassStudentsViewModel(); elimination
 *     queries accept IDs directly; elimination names are resolved
 *     through TournamentAggregator.getParticipantName, which already
 *     handles both character and team participants.
 *
 * IDENTITY PRESERVATION:
 *   Round and match IDs are STABLE and are the dispatch keys for
 *   every round- and match-scoped action in the Academy Exams view.
 *   The TournamentAggregator VM carries `id` on every round and
 *   every match. This projection MUST pass those IDs through
 *   unchanged. A projection that drops the ID disables every such
 *   action silently.
 *
 * EXAM MODE SEMANTICS:
 *   - When an exam exists, its `mode` field is authoritative.
 *   - When no exam exists, mode is 'individuals'.
 *   - Mode is NOT inferred from the presence of academic teams in
 *     the class.
 *
 * WEEK SEMANTICS:
 *   - No `week || 1` defaults. Callers must supply a valid week.
 *
 * ELIMINATION QUERIES:
 *   - EliminationQueries.isCharacterEliminatedByWeek accepts either a
 *     character ID or a character object. This module passes IDs.
 *
 * POOL MEMBERSHIP:
 *   - Character pool: students only. Instructors do NOT appear.
 *   - Team pool: persistent academic Team entities from TeamQueries.
 *
 * ELIMINATION PROVENANCE:
 *   Each elimination record carries fromRoundId and fromMatchId
 *   when it was produced by the elimination cascade. Legacy
 *   eliminations (produced by the manual mark path before the
 *   cascade existed) do not. The VM carries those fields through
 *   as-is, or null when absent, so the UI can decide whether to
 *   show provenance.
 *
 * DEPENDENCIES:
 *   - window.AcademyAggregator (MANDATORY)
 *   - window.TeamQueries (MANDATORY)
 *   - window.TournamentQueries (MANDATORY)
 *   - window.TournamentAggregator (MANDATORY)
 *   - window.EliminationQueries (OPTIONAL)
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
        if (!TournamentAggregator ||
            typeof TournamentAggregator.getParticipantName !== 'function') {
            missing.push('TournamentAggregator.getParticipantName');
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

    function getExamViewModel(classId, week) {
        if (!checkDependencies()) {
            return emptyViewModel(null);
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) {
            return emptyViewModel(null);
        }

        var classListFull = AcademyAggregator.getClassListViewModel() || [];
        var classListVM = classListFull.map(function(c) {
            return { id: c.id, name: c.name };
        });

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
            includeEliminations: true,
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
            eliminations: buildEliminationsVM(vm.eliminations || [], vm.id),
            finalPassers: vm.finalPassers || [],
            finalPasserCount: vm.finalPasserCount || 0,
            rounds: (vm.rounds || []).map(buildExamRoundVM)
        };
    }

    function buildExamRoundVM(round) {
        if (!round) { return null; }

        return {
            id: round.id,
            index: round.index,
            roundNumber: round.roundNumber,
            status: round.status,
            statusLabel: round.statusDisplay ? round.statusDisplay.text : round.status,
            matchSize: round.matchSize,
            matchType: round.matchType,
            matchTypeLabel: round.matchTypeLabel,
            isPairExam: round.isPairExam === true,
            matches: (round.matches || []).map(buildExamMatchVM)
        };
    }

    function buildExamMatchVM(match) {
        if (!match) { return null; }

        var vm = {
            id: match.id,
            index: match.index,
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
    // ELIMINATIONS VM
    // ============================================================
    //
    // The upstream TournamentAggregator produces eliminations with:
    //   {
    //     participantId, participantType,
    //     participantName, week, reason, standalone
    //   }
    //
    // The raw tournament record additionally carries fromRoundId and
    // fromMatchId on cascade-produced eliminations. The upstream VM
    // does NOT surface those. This projection re-reads the raw
    // tournament record to pick them up, so the UI can render
    // provenance when it exists.
    //
    // Each elimination VM exposes:
    //   {
    //     participantId,
    //     participantType,
    //     participantName,
    //     week,
    //     reason,
    //     standalone,
    //     fromRoundId,           // string or null
    //     fromMatchId,           // string or null
    //     hasProvenance          // true when fromMatchId is present
    //   }
    //
    // Entries with participantType !== 'character' are dropped: the
    // elimination cascade only eliminates individual characters. A
    // team elimination record, if it ever appeared, would not be
    // restorable through the character-side API anyway.

    function buildEliminationsVM(eliminationVMs, examId) {
        if (!Array.isArray(eliminationVMs) || eliminationVMs.length === 0) {
            return [];
        }

        // Read the raw tournament to pick up provenance fields that
        // the upstream VM does not carry.
        var rawById = Object.create(null);
        try {
            var rawExam = TournamentQueries.getTournament(examId);
            if (rawExam && Array.isArray(rawExam.eliminations)) {
                for (var r = 0; r < rawExam.eliminations.length; r++) {
                    var raw = rawExam.eliminations[r];
                    if (!raw || !raw.participantId) { continue; }
                    var key = String(raw.participantId);
                    rawById[key] = raw;
                }
            }
        } catch (e) {
            // If the raw read fails, we degrade to VMs without
            // provenance. The UI still renders and restores work.
            rawById = Object.create(null);
        }

        var result = [];

        for (var i = 0; i < eliminationVMs.length; i++) {
            var e = eliminationVMs[i];
            if (!e) { continue; }
            if (e.participantType && e.participantType !== 'character') {
                continue;
            }

            var participantId = e.participantId ? String(e.participantId) : null;
            if (!participantId) { continue; }

            var raw = rawById[participantId] || null;
            var fromRoundId = (raw && typeof raw.fromRoundId === 'string' && raw.fromRoundId !== '')
                ? raw.fromRoundId
                : null;
            var fromMatchId = (raw && typeof raw.fromMatchId === 'string' && raw.fromMatchId !== '')
                ? raw.fromMatchId
                : null;

            result.push({
                participantId: participantId,
                participantType: 'character',
                participantName: e.participantName || 'Unknown',
                week: e.week,
                reason: e.reason || '',
                standalone: e.standalone === true,
                fromRoundId: fromRoundId,
                fromMatchId: fromMatchId,
                hasProvenance: fromMatchId !== null
            });
        }

        // Stable sort by week descending, then by name ascending.
        // The UI wants newest eliminations first, with ties broken
        // consistently so re-renders don't shuffle the list.
        result.sort(function(a, b) {
            var wa = (typeof a.week === 'number') ? a.week : -1;
            var wb = (typeof b.week === 'number') ? b.week : -1;
            if (wa !== wb) { return wb - wa; }
            return String(a.participantName || '').localeCompare(
                String(b.participantName || '')
            );
        });

        return result;
    }

    // ============================================================
    // EXAM POOL
    // ============================================================

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
        var students = AcademyAggregator.getClassStudentsViewModel(classRecord.id) || [];

        var pool = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            if (!student || !student.id) { continue; }

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
        buildExamViewModel: buildExamViewModel,
        buildExamPool: buildExamPool,
        buildCharacterPoolForClass: buildCharacterPoolForClass,
        buildTeamPoolForClass: buildTeamPoolForClass,
        buildExamRoundVM: buildExamRoundVM,
        buildExamMatchVM: buildExamMatchVM,
        buildEliminationsVM: buildEliminationsVM
    };

})();
