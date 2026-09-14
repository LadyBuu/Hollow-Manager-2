/**
 * modules/academy/academy-tournament-aggregator.js - Academy Tournament Aggregator
 * Academy-scoped projection builder for the Exams view.
 *
 * Path: js/modules/academy/academy-tournament-aggregator.js
 *
 * This module is responsible for:
 *   - Building the exam view model for a class + week
 *   - Building the exam pool (characters or teams eligible for the exam)
 *   - Flattening TournamentAggregator's tournament VM into the shape
 *     the Exams view renderer expects
 *
 * IMPORTANT:
 *   - Projection builder. No mutations. No persistence. No DOM.
 *   - Composes TournamentQueries + TournamentAggregator + TeamQueries
 *     + CharacterQueries + EliminationQueries + AcademyAggregator.
 *   - Returns Academy-shaped view models. Never exposes external
 *     query APIs directly.
 *   - Never mutates data.
 *   - All functions are PURE with respect to window.data: they read,
 *     they do not write.
 *
 * RELATIONSHIP TO AcademyTournamentView:
 *   The renderer (AcademyTournamentView) expects a specific view model
 *   shape. This module owns the construction of that shape. The view
 *   does not reach into TournamentAggregator or TeamQueries directly.
 *
 * RELATIONSHIP TO AcademyTournamentEvents:
 *   Events owns mutations. Aggregator owns reads. The two are
 *   separate: Events never calls into Aggregator for display purposes,
 *   and Aggregator never triggers a mutation.
 *
 * DEPENDENCIES:
 *   - window.AcademyAggregator (from academy-aggregator.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.TournamentAggregator (from tournament-aggregator.js) - MANDATORY
 *   - window.EliminationQueries (from elimination-queries.js) - OPTIONAL
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
    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var TournamentQueries = window.TournamentQueries;
    var TournamentAggregator = window.TournamentAggregator;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyAggregator ||
            typeof AcademyAggregator.getClassViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassViewModel');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }

        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
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
    // PUBLIC API - Exams View Model
    // ============================================================

    /**
     * Build the full Exams view model.
     *
     * @param {string|null} classId - Currently selected class, or null
     * @param {number} week - Week number
     * @returns {object} { classList, classId, className, week, exam, pool }
     */
    function getExamViewViewModel(classId, week) {
        if (!checkDependencies()) {
            return {
                classList: [],
                classId: null,
                className: null,
                week: week || 1,
                exam: null,
                pool: []
            };
        }

        // ---- Class list ----
        var classes = AcademyQueries.getClasses() || [];
        classes = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var classListVM = classes.map(function(c) {
            return { id: c.id, name: c.name };
        });

        // ---- Resolve selected class ----
        var selectedClass = null;
        if (classId) {
            for (var i = 0; i < classes.length; i++) {
                if (String(classes[i].id) === String(classId)) {
                    selectedClass = classes[i];
                    break;
                }
            }
        }

        if (!selectedClass) {
            return {
                classList: classListVM,
                classId: null,
                className: null,
                week: week,
                exam: null,
                pool: []
            };
        }

        // ---- Exam VM + pool ----
        var examVM = buildExamViewModel(selectedClass, week);
        var pool = buildExamPool(selectedClass, week, examVM);

        return {
            classList: classListVM,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: week,
            exam: examVM,
            pool: pool
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
            finalPassers: vm.finalPassers || [],
            finalPasserCount: vm.finalPasserCount || 0,
            rounds: (vm.rounds || []).map(buildExamRoundVM)
        };
    }

    function buildExamRoundVM(round) {
        return {
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
            index: match.index,
            id: match.id,
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

    /**
     * Build the exam pool (eligible participants) for a class + week.
     *
     * The pool shows every participant that could be added to the
     * exam. When an exam exists, each pool item indicates whether it
     * is already in the exam. When no exam exists, the pool is
     * informational only.
     *
     * @param {object} classRecord - Class record
     * @param {number} week - Week number
     * @param {object|null} examVM - Exam VM (may be null)
     * @returns {array}
     */
    function buildExamPool(classRecord, week, examVM) {
        var TeamQ = window.TeamQueries;

        var mode = 'individuals';
        if (examVM && examVM.mode) {
            mode = examVM.mode;
        } else if (TeamQ && typeof TeamQ.getTeamsByClass === 'function') {
            var teams = TeamQ.getTeamsByClass(classRecord.id) || [];
            var academicCount = 0;
            for (var i = 0; i < teams.length; i++) {
                if (teams[i] && teams[i].type === 'academic') { academicCount++; }
            }
            if (academicCount > 0) {
                mode = 'teams';
            }
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
        var TQ = window.TournamentQueries;
        var inExamSet = {};
        if (TQ && typeof TQ.getParticipants === 'function') {
            var participants = TQ.getParticipants(examVM.id);
            for (var i = 0; i < participants.length; i++) {
                if (participants[i] && participants[i].id) {
                    inExamSet[String(participants[i].id)] = true;
                }
            }
        }

        if (mode === 'teams') {
            return buildTeamPoolForClass(classRecord, week, inExamSet);
        }
        return buildCharacterPoolForClass(classRecord, week, inExamSet);
    }

    function buildCharacterPoolForClass(classRecord, week, inExamSet) {
        var classVM = AcademyAggregator.getClassViewModel(classRecord.id, {
            includeStudents: true,
            includeTeams: false,
            includeRankings: false,
            includeGrades: false,
            week: week
        });

        if (!classVM || !Array.isArray(classVM.students)) {
            return [];
        }

        var EQ = window.EliminationQueries;
        var pool = [];
        for (var i = 0; i < classVM.students.length; i++) {
            var student = classVM.students[i];
            if (!student || !student.id) { continue; }

            var eliminated = false;
            if (EQ && typeof EQ.isCharacterEliminatedByWeek === 'function') {
                var char = CharacterQueries.getCharacterById(student.id);
                if (char) {
                    try {
                        eliminated = EQ.isCharacterEliminatedByWeek(char, week) === true;
                    } catch (e) {
                        eliminated = false;
                    }
                }
            }

            pool.push({
                id: student.id,
                name: student.name,
                subtitle: student.role === 'instructor'
                    ? 'Instructor'
                    : (student.status || ''),
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
            var joinW = parseInt(team.startPeriod, 10);
            var leaveW = parseInt(team.endPeriod, 10);
            if (!isNaN(joinW) && joinW > week) { active = false; }
            if (!isNaN(leaveW) && leaveW < week) { active = false; }

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
        getExamViewViewModel: getExamViewViewModel,

        // Exposed for testing
        buildExamViewModel: buildExamViewModel,
        buildExamPool: buildExamPool,
        buildCharacterPoolForClass: buildCharacterPoolForClass,
        buildTeamPoolForClass: buildTeamPoolForClass
    };

})();
