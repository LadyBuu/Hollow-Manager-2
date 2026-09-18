/**
 * modules/academy/academy-tournament-aggregator.js
 * Academy Tournament Aggregator
 *
 * Path: js/modules/academy/academy-tournament-aggregator.js
 *
 * Academy-scoped projection builder for the Exams view.
 *
 * RESPONSIBILITIES:
 *   - Build the exam view model for a class + week
 *   - Build the exam pool (eligible characters or teams)
 *   - Surface eliminations with provenance for the UI
 *   - Surface final passers
 *   - Resolve participant and team display names for the UI
 *   - Stamp prior-round outcomes on pool items (C8)
 *   - Stamp collapse state on round VMs (C4)
 *
 * NOT RESPONSIBILITIES:
 *   - Mutations
 *   - Rendering
 *   - Domain validation (Schema / Rules)
 *   - Match generation (TournamentMatches)
 *   - Elimination writes (TournamentEliminationCascade)
 *   - Prior-round derivation (TournamentQueries owns it)
 *   - Collapse-state persistence (AcademyUI owns it)
 *
 * ARCHITECTURE:
 *
 *     TournamentQueries            (reads + prior-round derivation)
 *     TournamentSchema             (structural interpretation)
 *     AcademyUI                    (UI state, incl. collapse)
 *     AcademyAggregator            (class + roster)
 *     TeamQueries                  (team identity)
 *     EliminationQueries           (cross-tournament elimination state)
 *     CharacterQueries             (participant name resolution)
 *              │
 *              ▼
 *     AcademyTournamentAggregator  (this module)
 *              │
 *              ▼
 *     AcademyTournamentView
 *
 * NO INTERMEDIATE VM LAYER. The generic TournamentAggregator is gone.
 * This module reads the canonical tournament record directly and
 * produces exactly the projection the Academy Exams view needs.
 *
 * IDENTITY PRESERVATION:
 *   Round and match IDs pass through unchanged. They are the dispatch
 *   keys for every round- and match-scoped action in the Exams view.
 *   A projection that drops the ID disables the corresponding action.
 *
 * ARCHIVED TOURNAMENTS:
 *   TournamentQueries.getExamForClassAndWeek excludes archived
 *   tournaments. The Exams view therefore does not surface archived
 *   exams as "the active exam for this week." A tournament retrieved
 *   by ID is returned unfiltered; this module does not need to check
 *   archivedAt because getExamForClassAndWeek already did.
 *
 * ELIMINATION PROVENANCE:
 *   Every elimination record surfaced here carries fromRoundId and
 *   fromMatchId when they exist. The UI may use them for debug
 *   affordances; the Restore button does not require them.
 *
 *   Entries whose participantType is not 'character' are dropped.
 *   The elimination cascade only eliminates individual characters,
 *   and the Restore action targets a character ID.
 *
 * EXAM MODE:
 *   - When an exam exists, its `mode` field is authoritative.
 *   - When no exam exists, mode is 'individuals'.
 *   - Mode is NOT inferred from the presence of academic teams in
 *     the class.
 *
 * WEEK SEMANTICS:
 *   - No `week || 1` fallback. Invalid weeks return a null exam VM.
 *   - The canonical week parser is CalendarValidation.parseWeek.
 *
 * POOL MEMBERSHIP:
 *   Character pool: students only. Instructors do NOT appear.
 *   Team pool: persistent academic Team entities active this week.
 *   The pool is filtered against eliminations when EliminationQueries
 *   is available. When it is not, the pool does not fabricate
 *   "everyone is eligible" and does not fabricate "everyone is
 *   eliminated"; it defers the elimination flag entirely.
 *
 * PRIOR-ROUND OUTCOMES (C8):
 *   The pool is opened by the Add-Match / Edit-Match modals, which
 *   are always scoped to a specific target round. When the caller
 *   provides `options.currentRoundId`, this aggregator resolves the
 *   round IMMEDIATELY BEFORE it and stamps each pool item with
 *   `priorRoundOutcome`:
 *
 *     'pass'  — the participant passed in the previous round
 *     'retry' — the participant retried in the previous round
 *     null    — no badge: no prior round, prior round incomplete,
 *               or the participant did not appear in a completed
 *               match of the prior round
 *
 *   The derivation lives in TournamentQueries.getPriorRoundOutcomes.
 *   This module does not walk rounds itself; it consumes the map.
 *
 * ROUND COLLAPSE (C4):
 *   Each round VM carries `isCollapsed`, resolved from AcademyUI.
 *   The default is "expanded": a round that has never been collapsed
 *   carries `isCollapsed: false`.
 *
 *   The persistence and the default policy live in AcademyUI. This
 *   module is a pure reader: it asks AcademyUI for the state of each
 *   round and stamps the result. The view does not decide the
 *   default; it reads `round.isCollapsed` as a fact.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.TournamentQueries
 *   - window.TournamentSchema
 *   - window.TeamQueries
 *   - window.CharacterQueries
 *   - window.CalendarValidation
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.EliminationQueries
 *     When present, characters eliminated before the displayed week
 *     are filtered out of the character pool. When absent, the pool
 *     includes everyone and does not misrepresent the state.
 */

(function() {
    'use strict';

    if (window.__academyTournamentAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var TournamentQueries = window.TournamentQueries;
    var Schema = window.TournamentSchema;
    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;
    var CalendarValidation = window.CalendarValidation;

    var _missing = [];

    if (!AcademyUI ||
        typeof AcademyUI.isRoundExpanded !== 'function') {
        _missing.push('AcademyUI.isRoundExpanded');
    }

    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassListViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassListViewModel');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }

    if (!TournamentQueries ||
        typeof TournamentQueries.getExamForClassAndWeek !== 'function') {
        _missing.push('TournamentQueries.getExamForClassAndWeek');
    }
    if (!TournamentQueries ||
        typeof TournamentQueries.getTournament !== 'function') {
        _missing.push('TournamentQueries.getTournament');
    }
    if (!TournamentQueries ||
        typeof TournamentQueries.getParticipants !== 'function') {
        _missing.push('TournamentQueries.getParticipants');
    }
    if (!TournamentQueries ||
        typeof TournamentQueries.getRounds !== 'function') {
        _missing.push('TournamentQueries.getRounds');
    }
    if (!TournamentQueries ||
        typeof TournamentQueries.getEliminations !== 'function') {
        _missing.push('TournamentQueries.getEliminations');
    }
    if (!TournamentQueries ||
        typeof TournamentQueries.getFinalPassers !== 'function') {
        _missing.push('TournamentQueries.getFinalPassers');
    }
    // C8 — prior-round derivation.
    if (!TournamentQueries ||
        typeof TournamentQueries.getPriorRoundOutcomes !== 'function') {
        _missing.push('TournamentQueries.getPriorRoundOutcomes');
    }

    if (!Schema ||
        typeof Schema.isParticipantEliminated !== 'function') {
        _missing.push('TournamentSchema.isParticipantEliminated');
    }
    if (!Schema ||
        typeof Schema.getParticipantTypeFromRecord !== 'function') {
        _missing.push('TournamentSchema.getParticipantTypeFromRecord');
    }

    if (!TeamQueries ||
        typeof TeamQueries.getTeamsByClass !== 'function') {
        _missing.push('TeamQueries.getTeamsByClass');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }

    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTournamentAggregator] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyTournamentAggregatorLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCIES
    // ============================================================

    function getEliminationQueries() {
        return window.EliminationQueries || null;
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

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    /**
     * Resolve the week using the canonical parser.
     * Returns null when the week is invalid. Callers decide what to do.
     */
    function resolveWeek(week) {
        return CalendarValidation.parseWeek(week);
    }

    /**
     * Resolve the target round ID from an options bag.
     *
     * Accepts a non-empty string. Anything else normalises to null,
     * meaning "no target round; do not stamp prior-round outcomes."
     */
    function resolveCurrentRoundId(options) {
        if (!options || typeof options !== 'object') {
            return null;
        }
        var value = options.currentRoundId;
        if (!isNonEmptyString(value)) {
            return null;
        }
        return String(value);
    }

    // ============================================================
    // NAME RESOLUTION
    // ============================================================

    function getCharacterName(characterId) {
        if (!isNonEmptyString(characterId)) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return 'Unknown'; }
        return CharacterQueries.getDisplayName(char);
    }

    function getTeamName(teamId) {
        if (!isNonEmptyString(teamId)) { return 'Unknown Team'; }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) { return 'Unknown Team'; }
        return isNonEmptyString(team.name) ? team.name : 'Unnamed Team';
    }

    /**
     * Resolve a participant's display name given its type.
     * Character → CharacterQueries. Team → TeamQueries.
     */
    function resolveParticipantName(participantId, participantType) {
        if (participantType === 'team') {
            return getTeamName(participantId);
        }
        return getCharacterName(participantId);
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Build the Academy exam view model for a (class, week) pair.
     *
     * @param {string} classId
     * @param {number|string} week
     * @param {object} [options]
     * @param {string} [options.currentRoundId]
     *   The round the picker is targeting. When provided, the pool
     *   carries `priorRoundOutcome` per item, derived from the round
     *   immediately before this one. When omitted, every pool item
     *   carries `priorRoundOutcome: null` and no badge renders.
     * @returns {object} View model
     */
    function getExamViewModel(classId, week, options) {
        var weekNum = resolveWeek(week);
        var currentRoundId = resolveCurrentRoundId(options);

        var classListFull = AcademyAggregator.getClassListViewModel() || [];
        var classListVM = classListFull.map(function(c) {
            return { id: c.id, name: c.name };
        });

        if (weekNum === null) {
            return {
                classList: classListVM,
                classId: null,
                className: null,
                week: null,
                exam: null,
                pool: []
            };
        }

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

        var examRecord = TournamentQueries.getExamForClassAndWeek(
            selectedClass.id,
            weekNum
        );

        var examVM = null;
        if (examRecord) {
            examVM = buildExamViewModel(examRecord);
        }

        var pool = buildExamPool(
            selectedClass.id,
            weekNum,
            examVM,
            currentRoundId
        );

        return {
            classList: classListVM,
            classId: selectedClass.id,
            className: selectedClass.name,
            week: weekNum,
            exam: examVM,
            pool: pool
        };
    }

    // ============================================================
    // EXAM VM
    // ============================================================

    function buildExamViewModel(examRecord) {
        if (!examRecord) { return null; }

        var examId = examRecord.id;
        var mode = examRecord.mode || 'individuals';

        var participants = buildParticipantsVM(examId);
        var eliminations = buildEliminationsVM(examId);
        var finalPassers = buildFinalPassersVM(examId);

        var roundsRaw = TournamentQueries.getRounds(examId) || [];
        var rounds = [];
        for (var i = 0; i < roundsRaw.length; i++) {
            rounds.push(buildExamRoundVM(roundsRaw[i], i, examId));
        }

        return {
            id: examId,
            name: isNonEmptyString(examRecord.name)
                ? examRecord.name
                : 'Exam',
            status: examRecord.status || 'draft',
            statusLabel: getStatusLabel(examRecord.status),
            mode: mode,
            modeLabel: getModeLabel(mode),
            startWeek: examRecord.startWeek,
            endWeek: examRecord.endWeek,
            archivedAt: examRecord.archivedAt || null,
            participantCount: participants.length,
            roundCount: rounds.length,
            totalRounds: isFiniteNumber(examRecord.totalRounds)
                ? examRecord.totalRounds
                : 1,
            participants: participants,
            eliminations: eliminations,
            eliminationCount: eliminations.length,
            finalPassers: finalPassers,
            finalPasserCount: finalPassers.length,
            rounds: rounds
        };
    }

    // ============================================================
    // PARTICIPANTS
    // ============================================================

    function buildParticipantsVM(examId) {
        var raw = TournamentQueries.getParticipants(examId) || [];
        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var p = raw[i];
            if (!p || !p.id) { continue; }
            result.push({
                id: p.id,
                name: resolveParticipantName(p.id, p.type),
                type: p.type,
                typeLabel: getParticipantTypeLabel(p.type)
            });
        }
        return result;
    }

    // ============================================================
    // ROUNDS AND MATCHES
    // ============================================================

    /**
     * Build a round VM.
     *
     * @param {object} round - The raw round record.
     * @param {number} index - Positional index within the tournament.
     * @param {string} examId - The owning tournament ID. Used to
     *   resolve collapse state from AcademyUI, which is keyed by
     *   (examId, roundId).
     */
    function buildExamRoundVM(round, index, examId) {
        if (!round) { return null; }

        var matches = [];
        var matchesRaw = Array.isArray(round.matches) ? round.matches : [];
        for (var i = 0; i < matchesRaw.length; i++) {
            var m = buildExamMatchVM(matchesRaw[i], i);
            if (m) { matches.push(m); }
        }

        // C4 — resolve collapse state from AcademyUI. The default
        // is "expanded", passed explicitly so the policy is visible
        // at the call site. `isCollapsed` is the negation of the
        // UI's `isRoundExpanded`, because the VM describes the state
        // the view actually applies.
        var isCollapsed = false;
        if (isNonEmptyString(examId) && isNonEmptyString(round.id)) {
            var isExpanded = AcademyUI.isRoundExpanded(
                examId,
                round.id,
                true
            );
            isCollapsed = isExpanded !== true;
        }

        return {
            id: round.id,
            index: index,
            roundNumber: isFiniteNumber(round.roundNumber)
                ? round.roundNumber
                : (index + 1),
            status: round.status || 'pending',
            statusLabel: getMatchStatusLabel(round.status),
            matchSize: isFiniteNumber(round.matchSize)
                ? round.matchSize
                : 2,
            matchType: round.matchType || 'group_exam',
            matchTypeLabel: getMatchTypeLabel(round.matchType),
            isPairExam: round.isPairExam === true,
            isCollapsed: isCollapsed,
            matches: matches,
            matchCount: matches.length
        };
    }

    function buildExamMatchVM(match, index) {
        if (!match) { return null; }

        var type = match.type || 'group_exam';
        var isTeamMatch = type === 'team_vs_team';
        var isPairExam = match.isPairExam === true;

        var vm = {
            id: match.id,
            index: index,
            type: type,
            typeLabel: getMatchTypeLabel(type),
            status: match.status || 'pending',
            statusLabel: getMatchStatusLabel(match.status),
            isPairExam: isPairExam,
            isGroupExam: type === 'group_exam',
            isTeamMatch: isTeamMatch,
            isComplete: match.status === 'completed',
            participantCount: Array.isArray(match.participants)
                ? match.participants.length
                : 0
        };

        if (type === 'group_exam') {
            var participantsRaw = Array.isArray(match.participants)
                ? match.participants
                : [];
            var results = match.results || {};

            vm.participants = participantsRaw.map(function(pid) {
                return buildGroupExamParticipantVM(pid, results[pid]);
            });

            if (isPairExam && Array.isArray(match.pairings)) {
                vm.pairings = match.pairings.map(function(pair) {
                    if (!Array.isArray(pair)) { return []; }
                    return pair.map(function(pid) {
                        return buildGroupExamParticipantVM(
                            pid,
                            results[pid]
                        );
                    });
                });
            }
        }

        if (type === 'team_vs_team') {
            var teamsRaw = Array.isArray(match.participants)
                ? match.participants
                : [];
            var teamResults = match.teamResults || {};
            var individualResults = match.individualResults || {};

            vm.teams = teamsRaw.map(function(teamId) {
                return buildTeamMatchTeamVM(
                    teamId,
                    teamResults[teamId],
                    individualResults
                );
            });
        }

        return vm;
    }

    function buildGroupExamParticipantVM(participantId, result) {
        if (!participantId) { return null; }
        var resultValue = result || 'pending';
        return {
            id: String(participantId),
            name: getCharacterName(participantId),
            type: 'character',
            typeLabel: 'Character',
            result: result || null,
            resultCategory: getResultCategory(result),
            outcomeDisplay: getOutcomeDisplay(resultValue),
            isPassing: result === 'pass',
            isRetrying: result === 'retry',
            isFailing: result === 'fail'
        };
    }

    function buildTeamMatchTeamVM(teamId, teamResult, individualResults) {
        if (!teamId) { return null; }

        var team = TeamQueries.getTeamById(teamId);
        var members = [];

        if (team && Array.isArray(team.members)) {
            for (var i = 0; i < team.members.length; i++) {
                var member = team.members[i];
                if (!member || !member.characterId) { continue; }
                var memberResult = individualResults[member.characterId];
                members.push({
                    characterId: member.characterId,
                    name: getCharacterName(member.characterId),
                    role: member.role || 'Member',
                    result: memberResult || null,
                    resultCategory: getResultCategory(memberResult),
                    outcomeDisplay: getOutcomeDisplay(
                        memberResult || 'pending'
                    ),
                    isPassing: memberResult === 'pass',
                    isRetrying: memberResult === 'retry',
                    isFailing: memberResult === 'fail'
                });
            }
        }

        var teamResultValue = teamResult || 'pending';

        return {
            teamId: String(teamId),
            name: getTeamName(teamId),
            result: teamResult || null,
            resultCategory: getResultCategory(teamResult),
            outcomeDisplay: getOutcomeDisplay(teamResultValue),
            isPassing: teamResult === 'pass',
            isRetrying: teamResult === 'retry',
            isFailing: teamResult === 'fail',
            members: members,
            memberCount: members.length
        };
    }

    // ============================================================
    // ELIMINATIONS VM
    // ============================================================
    //
    // Reads elimination records directly from TournamentQueries.
    // Each entry carries provenance (fromRoundId, fromMatchId) as-is,
    // or null when absent.
    //
    // Entries whose participantType is not 'character' are dropped:
    // the elimination cascade only eliminates individuals, and the
    // Restore action targets a character ID.
    //
    // Sorted by week descending, then name ascending. The UI wants
    // newest eliminations first, with ties broken consistently.

    function buildEliminationsVM(examId) {
        var raw = TournamentQueries.getEliminations(examId) || [];
        if (raw.length === 0) { return []; }

        var result = [];

        for (var i = 0; i < raw.length; i++) {
            var e = raw[i];
            if (!e) { continue; }
            if (e.participantType && e.participantType !== 'character') {
                continue;
            }

            var participantId = e.participantId
                ? String(e.participantId)
                : null;
            if (!participantId) { continue; }

            var fromRoundId = isNonEmptyString(e.fromRoundId)
                ? e.fromRoundId
                : null;
            var fromMatchId = isNonEmptyString(e.fromMatchId)
                ? e.fromMatchId
                : null;

            result.push({
                participantId: participantId,
                participantType: 'character',
                participantName: getCharacterName(participantId),
                week: isFiniteNumber(e.week) ? e.week : null,
                reason: isNonEmptyString(e.reason) ? e.reason : '',
                standalone: e.standalone === true,
                fromRoundId: fromRoundId,
                fromMatchId: fromMatchId,
                hasProvenance: fromMatchId !== null
            });
        }

        result.sort(function(a, b) {
            var wa = isFiniteNumber(a.week) ? a.week : -1;
            var wb = isFiniteNumber(b.week) ? b.week : -1;
            if (wa !== wb) { return wb - wa; }
            return String(a.participantName || '').localeCompare(
                String(b.participantName || '')
            );
        });

        return result;
    }

    // ============================================================
    // FINAL PASSERS VM
    // ============================================================
    //
    // FIX (T4): participant type is resolved via
    // TournamentQueries.getParticipantTypeFromRecord, which takes
    // (tournamentId, participantId). The previous version called
    // Schema.getParticipantTypeFromRecord with the same argument
    // shape, but the Schema function expects a tournament OBJECT,
    // not an ID. It returned null for every participant, and the
    // fallback `|| 'character'` was applied unconditionally. For
    // team-mode exams, whose final passers are team IDs, that
    // caused getCharacterName(teamId) to return 'Unknown'.

    function buildFinalPassersVM(examId) {
        var ids = TournamentQueries.getFinalPassers(examId) || [];
        var result = [];
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            if (!isNonEmptyString(id)) { continue; }
            var type = TournamentQueries.getParticipantTypeFromRecord(
                examId, id
            ) || 'character';
            result.push({
                id: id,
                name: resolveParticipantName(id, type),
                type: type,
                typeLabel: getParticipantTypeLabel(type)
            });
        }
        return result;
    }

    // ============================================================
    // EXAM POOL
    // ============================================================
    //
    // The pool is the set of candidates the Exams view can add to the
    // exam or restore from elimination.
    //
    // When an exam exists, its mode determines whether the pool is
    // characters or teams.
    // When no exam exists, the pool is characters.
    //
    // Elimination filtering uses EliminationQueries when available.
    // When it is absent, the pool does not misrepresent elimination
    // state: characters are included, and the `eliminated` flag is
    // false because we do not know. That is the honest answer.
    //
    // PRIOR-ROUND OUTCOMES (C8):
    //   When `currentRoundId` is provided AND an exam exists, this
    //   function calls TournamentQueries.getPriorRoundOutcomes(examId,
    //   currentRoundId) once and stamps each pool item with the
    //   participant's 'pass' | 'retry' outcome, or null.

    function buildExamPool(classId, week, examVM, currentRoundId) {
        var mode = 'individuals';
        if (examVM && examVM.mode) {
            mode = examVM.mode;
        }

        var inExamSet = Object.create(null);
        if (examVM && Array.isArray(examVM.participants)) {
            for (var i = 0; i < examVM.participants.length; i++) {
                var p = examVM.participants[i];
                if (p && p.id) {
                    inExamSet[String(p.id)] = true;
                }
            }
        }

        var priorOutcomes = resolvePriorOutcomes(
            examVM,
            currentRoundId
        );

        if (mode === 'teams') {
            return buildTeamPoolForClass(
                classId, week, inExamSet, priorOutcomes
            );
        }
        return buildCharacterPoolForClass(
            classId, week, inExamSet, priorOutcomes
        );
    }

    /**
     * Build the prior-outcome map for a pool.
     *
     * Returns an empty object when there is no exam, no current round,
     * or the derivation throws.
     */
    function resolvePriorOutcomes(examVM, currentRoundId) {
        if (!examVM || !isNonEmptyString(examVM.id)) {
            return {};
        }
        if (!isNonEmptyString(currentRoundId)) {
            return {};
        }

        try {
            var map = TournamentQueries.getPriorRoundOutcomes(
                examVM.id,
                currentRoundId
            );
            if (!map || typeof map !== 'object') {
                return {};
            }
            return map;
        } catch (e) {
            console.warn(
                '[AcademyTournamentAggregator] ' +
                'getPriorRoundOutcomes failed:', e
            );
            return {};
        }
    }

    /**
     * Read the prior-round outcome for a pool item from the
     * pre-resolved map.
     *
     * Returns 'pass' | 'retry' | null.
     */
    function readPriorOutcome(map, id) {
        if (!map || !isNonEmptyString(id)) {
            return null;
        }
        var value = map[String(id)];
        if (value === 'pass' || value === 'retry') {
            return value;
        }
        return null;
    }

    function buildCharacterPoolForClass(
        classId,
        week,
        inExamSet,
        priorOutcomes
    ) {
        var students = AcademyAggregator.getClassStudentsViewModel(
            classId
        ) || [];

        var EQ = getEliminationQueries();
        var canCheckElimination = EQ &&
            typeof EQ.isCharacterEliminatedByWeek === 'function';

        var pool = [];
        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            if (!student || !student.id) { continue; }

            var eliminated = false;
            if (canCheckElimination) {
                try {
                    eliminated = EQ.isCharacterEliminatedByWeek(
                        student.id,
                        week
                    ) === true;
                } catch (e) {
                    eliminated = false;
                }
            }

            pool.push({
                id: student.id,
                name: student.name,
                subtitle: student.status || '',
                inExam: inExamSet[String(student.id)] === true,
                eliminated: eliminated,
                priorRoundOutcome: readPriorOutcome(
                    priorOutcomes, student.id
                )
            });
        }

        return pool;
    }

    function buildTeamPoolForClass(
        classId,
        week,
        inExamSet,
        priorOutcomes
    ) {
        var teams = TeamQueries.getTeamsByClass(classId) || [];

        var pool = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            if (team.type !== 'academic') { continue; }

            var active = true;
            if (typeof TeamQueries.isTeamActiveAtPeriod === 'function') {
                active = TeamQueries.isTeamActiveAtPeriod(team, week) === true;
            }
            if (!active) { continue; }

            var subtitleParts = [];
            if (team.periodDisplay) {
                subtitleParts.push(team.periodDisplay);
            }
            if (team.status && team.status !== 'active') {
                subtitleParts.push(team.status);
            }

            pool.push({
                id: team.id,
                name: isNonEmptyString(team.name)
                    ? team.name
                    : 'Unnamed Team',
                subtitle: subtitleParts.join(' \u00b7 '),
                inExam: inExamSet[String(team.id)] === true,
                eliminated: false,
                priorRoundOutcome: readPriorOutcome(
                    priorOutcomes, team.id
                )
            });
        }

        return pool;
    }

    // ============================================================
    // LABEL HELPERS
    // ============================================================

    function getStatusLabel(status) {
        switch (status) {
            case 'draft':     return 'Draft';
            case 'active':    return 'Active';
            case 'completed': return 'Completed';
            default:          return safeString(status);
        }
    }

    function getModeLabel(mode) {
        if (mode === 'teams') { return 'Teams'; }
        if (mode === 'individuals') { return 'Individuals'; }
        return '';
    }

    function getMatchStatusLabel(status) {
        switch (status) {
            case 'pending':     return 'Pending';
            case 'in_progress': return 'In Progress';
            case 'completed':   return 'Completed';
            default:            return safeString(status);
        }
    }

    function getMatchTypeLabel(type) {
        switch (type) {
            case 'group_exam':   return 'Group Exam';
            case 'team_vs_team': return 'Team Match';
            default:             return safeString(type);
        }
    }

    function getParticipantTypeLabel(type) {
        if (type === 'character') { return 'Character'; }
        if (type === 'team') { return 'Team'; }
        return 'Unknown';
    }

    function getResultCategory(resultValue) {
        if (resultValue === 'pass') { return 'passed'; }
        if (resultValue === 'retry') { return 'retry'; }
        if (resultValue === 'fail') { return 'failed'; }
        return 'unknown';
    }

    function getOutcomeDisplay(outcome) {
        var map = {
            'pass':      { text: '\u2713', class: 'outcome-pass',    label: 'Pass' },
            'retry':     { text: '\u21bb', class: 'outcome-retry',   label: 'Retry' },
            'fail':      { text: '\u2717', class: 'outcome-fail',    label: 'Fail' },
            'pending':   { text: '\u23f3', class: 'outcome-pending', label: 'Pending' },
            'unknown':   { text: '?',      class: 'outcome-unknown', label: 'Unknown' }
        };
        return map[outcome] || {
            text: '?',
            class: 'outcome-unknown',
            label: 'Unknown'
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTournamentAggregator = {
        getExamViewModel: getExamViewModel
    };

})();
