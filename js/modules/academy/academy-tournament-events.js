/**
 * modules/academy/academy-tournament-events.js
 * Academy Exams Event Wiring
 *
 * Path: js/modules/academy/academy-tournament-events.js
 *
 * Mutation orchestration for the Academy-embedded Exams view.
 *
 * RESPONSIBILITIES:
 *   - Route user actions from the Exams view to the domain
 *   - Build the modal view models the view needs
 *   - Open and close the modal shells
 *   - Read the collected form payload from the view's collector
 *   - Notify the caller's onChange callback when a mutation succeeds
 *   - Surface rejected mutations as console warnings + toasts
 *   - Handle round collapse toggles (C4; UI-only, no mutation)
 *   - Enrich picker entries with prior-round outcomes (C8)
 *
 * NOT RESPONSIBILITIES:
 *   - HTML construction. The view module builds all modal HTML.
 *   - Domain validation. Schema / Rules own it.
 *   - Domain reads via window.data. TournamentQueries owns reads.
 *   - Identity computation. Queries and Schema own it.
 *   - Eligibility computation for the pool panel. The aggregator
 *     owns the pool VM.
 *   - Collapse-state persistence. AcademyUI owns it; this layer
 *     only reads and writes through its typed API.
 *
 * ACTION NAMING:
 *   Every action element carries data-action with an 'exam-' prefix.
 *   The dispatcher in academy-view.js routes by prefix; this module
 *   receives the unprefixed verb.
 *
 *   Every action element also carries the identity it needs:
 *     data-exam-id      on every exam-scoped action
 *     data-round-id     on every round- and match-scoped action,
 *                       including the collapse toggle
 *     data-match-id     on every match-scoped action
 *     data-pool-id      on pool toggle actions
 *     data-character-id on elimination restore actions
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal(className) returns a bare .modal shell. This
 *   module appends a fresh .modal-content wrapper before calling
 *   Modal.modalSetup() and Modal.showModal(). All modal content is
 *   supplied by AcademyTournamentView's builder functions.
 *
 * MODAL CLOSE SEMANTICS:
 *   Modal.hideModal is ASYNCHRONOUS. closeModal below awaits the
 *   returned Promise before removing the element from the DOM.
 *   Prefer Modal.closeModal (full teardown, cleanup list, focus
 *   restore) when available.
 *
 * MUTATION FEEDBACK:
 *   Every mutation's .then handler checks `result.success`. On
 *   success, the modal closes and the caller's onChange runs. On
 *   failure, the result's message is logged and toasted.
 *
 * ROUND COLLAPSE (C4):
 *   The collapse toggle is a UI-ONLY action. It does not enter the
 *   mutation pipeline, does not touch domain data, and does not
 *   open a modal. The handler:
 *
 *     1. Reads the current expanded state via
 *        AcademyUI.isRoundExpanded(examId, roundId, true).
 *     2. Writes the opposite state via
 *        AcademyUI.setRoundExpanded(examId, roundId, !current).
 *     3. Calls notifyChange() to trigger a re-render.
 *
 *   The default is EXPANDED. That default lives in the call to
 *   isRoundExpanded — this module passes `true` explicitly so the
 *   policy is visible at the call site, not hidden in AcademyUI.
 *
 *   This is the ONLY place in this module that writes UI state. If
 *   that ever changes, the pattern to preserve is: the events layer
 *   owns the *intent* (user clicked collapse), AcademyUI owns the
 *   *storage*, and the aggregator owns the *read for render*.
 *
 * PRIOR-ROUND OUTCOMES (C8):
 *   buildEligibleForNewMatch is called by addMatchManual and
 *   editMatch to produce the checkbox list the picker renders. Both
 *   callers pass through (examId, roundId); this function uses them
 *   to derive the outcome map for the round IMMEDIATELY BEFORE
 *   roundId, and stamps each entry.
 *
 *   The map is { [participantId]: 'pass' | 'retry' }. Participants
 *   whose outcome is absent get `priorRoundOutcome: null`, and the
 *   view renders no badge for them.
 *
 *   This is a read, not a mutation. It is called at modal-open time,
 *   not at render time, so the eligible list is always fresh with
 *   respect to the target round.
 *
 * RESTORE ELIMINATED PARTICIPANT:
 *   The Restore button in the Eliminated section routes to
 *   TournamentEliminationCascade.restoreCharacterElimination inside
 *   a MutationPipeline transaction. The cascade removes the
 *   elimination record on both the tournament side and the character
 *   side.
 *
 *   This is DISTINCT from the cascade reversal that runs inside
 *   removeMatch / removeRound / reopenMatch / reopenRound:
 *
 *     - Cascade reversal removes eliminations by provenance
 *       (fromMatchId / fromRoundId). Runs when the match, round, or
 *       tournament is removed, or when a match or round is reopened.
 *     - Manual restore removes eliminations by
 *       (tournamentId, characterId). Runs when the user clicks
 *       Restore. Provenance-agnostic.
 *
 *   All three compose safely.
 *
 * REOPEN (v21):
 *   Three reopen actions, at three levels of granularity:
 *
 *     exam-reopen-exam    Reopen the exam itself. Sets status back
 *                         to 'active'. Does NOT touch eliminations
 *                         or match results. Ungates the round and
 *                         match edit buttons.
 *
 *     exam-reopen-round   Reopen every match in a round. Reverses
 *                         every elimination produced by any match in
 *                         the round. Sets every match to 'pending'.
 *                         Match results are preserved.
 *
 *     exam-reopen-match   Reopen one match. Reverses eliminations
 *                         produced by that match. Sets the match to
 *                         'pending'. Results preserved.
 *
 *   Each shows a confirmation modal before dispatching. The
 *   confirmation text explains what will be reversed.
 *
 * ARCHIVE vs DELETE:
 *   The "Delete Exam" button routes to TournamentCore.archiveTournament.
 *   Archive sets archivedAt and status 'completed'. All history —
 *   rounds, matches, eliminations — is preserved. The archived exam
 *   disappears from the pool panel and from getExamForClassAndWeek.
 *   Physical destruction is available via TournamentCore.purgeTournament
 *   but is not wired to any UI button.
 *
 * ERROR HANDLING:
 *   - Domain mutations resolve to { success, data?, message? }. On
 *     success this module closes the modal and calls onChange. On
 *     failure the message is logged and toasted.
 *   - A thrown error from a mutation is logged and toasted.
 *   - The onChange callback is wrapped in try/catch.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyUI                    (C4)
 *   - window.AcademyTournamentView
 *   - window.AcademyClasses
 *   - window.TournamentCore
 *   - window.TournamentMatches
 *   - window.TournamentQueries            (C8 added getPriorRoundOutcomes)
 *   - window.TournamentEliminationCascade
 *   - window.TournamentSchema
 *   - window.CharacterQueries
 *   - window.TeamQueries
 *   - window.MutationPipeline
 *   - window.CalendarValidation
 */

(function() {
    'use strict';

    if (window.__academyTournamentEventsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyUI = window.AcademyUI;
    var View = window.AcademyTournamentView;
    var AcademyClasses = window.AcademyClasses;
    var TournamentCore = window.TournamentCore;
    var TournamentMatches = window.TournamentMatches;
    var TournamentQueries = window.TournamentQueries;
    var EliminationCascade = window.TournamentEliminationCascade;
    var Schema = window.TournamentSchema;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var MutationPipeline = window.MutationPipeline;
    var CalendarValidation = window.CalendarValidation;

    var _missing = [];

    // UI infrastructure
    if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
        _missing.push('DomUtils.escapeHtml');
    }
    if (!Modal || typeof Modal.createModal !== 'function') {
        _missing.push('Modal.createModal');
    }
    if (!Modal || typeof Modal.showModal !== 'function') {
        _missing.push('Modal.showModal');
    }
    if (!Modal || typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal.modalSetup');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    // C4 — collapse toggle needs AcademyUI for state read/write.
    if (!AcademyUI ||
        typeof AcademyUI.isRoundExpanded !== 'function' ||
        typeof AcademyUI.setRoundExpanded !== 'function') {
        _missing.push('AcademyUI round collapse API');
    }

    // View layer
    if (!View || typeof View.renderHTML !== 'function') {
        _missing.push('AcademyTournamentView.renderHTML');
    }
    if (!View || typeof View.buildCreateExamModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildCreateExamModalHTML');
    }
    if (!View || typeof View.buildDeleteExamModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildDeleteExamModalHTML');
    }
    if (!View || typeof View.buildAddRoundModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildAddRoundModalHTML');
    }
    if (!View || typeof View.buildRemoveRoundModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildRemoveRoundModalHTML');
    }
    if (!View || typeof View.buildReopenRoundModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildReopenRoundModalHTML');
    }
    if (!View || typeof View.buildAutoGenerateRoundModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildAutoGenerateRoundModalHTML');
    }
    if (!View || typeof View.buildAddMatchModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildAddMatchModalHTML');
    }
    if (!View || typeof View.buildEditMatchModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildEditMatchModalHTML');
    }
    if (!View || typeof View.buildCompleteMatchModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildCompleteMatchModalHTML');
    }
    if (!View || typeof View.buildReopenMatchModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildReopenMatchModalHTML');
    }
    if (!View || typeof View.buildReopenExamModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildReopenExamModalHTML');
    }
    if (!View || typeof View.buildRemoveMatchModalHTML !== 'function') {
        _missing.push('AcademyTournamentView.buildRemoveMatchModalHTML');
    }
    if (!View || typeof View.collectCreateExamForm !== 'function') {
        _missing.push('AcademyTournamentView.collectCreateExamForm');
    }
    if (!View || typeof View.collectAddRoundForm !== 'function') {
        _missing.push('AcademyTournamentView.collectAddRoundForm');
    }
    if (!View || typeof View.collectAutoGenerateRoundForm !== 'function') {
        _missing.push('AcademyTournamentView.collectAutoGenerateRoundForm');
    }
    if (!View || typeof View.collectAddMatchForm !== 'function') {
        _missing.push('AcademyTournamentView.collectAddMatchForm');
    }
    if (!View || typeof View.collectEditMatchForm !== 'function') {
        _missing.push('AcademyTournamentView.collectEditMatchForm');
    }
    if (!View || typeof View.collectCompleteMatchForm !== 'function') {
        _missing.push('AcademyTournamentView.collectCompleteMatchForm');
    }

    // Academy
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }

    // Domain
    if (!TournamentCore || typeof TournamentCore.createTournament !== 'function') {
        _missing.push('TournamentCore.createTournament');
    }
    if (!TournamentCore || typeof TournamentCore.archiveTournament !== 'function') {
        _missing.push('TournamentCore.archiveTournament');
    }
    if (!TournamentCore || typeof TournamentCore.updateTournament !== 'function') {
        _missing.push('TournamentCore.updateTournament');
    }
    if (!TournamentCore || typeof TournamentCore.addRound !== 'function') {
        _missing.push('TournamentCore.addRound');
    }
    if (!TournamentCore || typeof TournamentCore.removeRound !== 'function') {
        _missing.push('TournamentCore.removeRound');
    }
    if (!TournamentCore || typeof TournamentCore.reopenRound !== 'function') {
        _missing.push('TournamentCore.reopenRound');
    }
    if (!TournamentCore || typeof TournamentCore.addParticipant !== 'function') {
        _missing.push('TournamentCore.addParticipant');
    }
    if (!TournamentCore || typeof TournamentCore.removeParticipant !== 'function') {
        _missing.push('TournamentCore.removeParticipant');
    }
    if (!TournamentMatches || typeof TournamentMatches.createMatch !== 'function') {
        _missing.push('TournamentMatches.createMatch');
    }
    if (!TournamentMatches || typeof TournamentMatches.updateMatch !== 'function') {
        _missing.push('TournamentMatches.updateMatch');
    }
    if (!TournamentMatches || typeof TournamentMatches.removeMatch !== 'function') {
        _missing.push('TournamentMatches.removeMatch');
    }
    if (!TournamentMatches || typeof TournamentMatches.completeMatch !== 'function') {
        _missing.push('TournamentMatches.completeMatch');
    }
    if (!TournamentMatches || typeof TournamentMatches.reopenMatch !== 'function') {
        _missing.push('TournamentMatches.reopenMatch');
    }
    if (!TournamentMatches || typeof TournamentMatches.generateMatches !== 'function') {
        _missing.push('TournamentMatches.generateMatches');
    }
    if (!TournamentMatches || typeof TournamentMatches.getEligibleParticipants !== 'function') {
        _missing.push('TournamentMatches.getEligibleParticipants');
    }
    if (!TournamentQueries || typeof TournamentQueries.getTournament !== 'function') {
        _missing.push('TournamentQueries.getTournament');
    }
    if (!TournamentQueries || typeof TournamentQueries.getRound !== 'function') {
        _missing.push('TournamentQueries.getRound');
    }
    if (!TournamentQueries || typeof TournamentQueries.getMatch !== 'function') {
        _missing.push('TournamentQueries.getMatch');
    }
    if (!TournamentQueries || typeof TournamentQueries.isParticipantInTournament !== 'function') {
        _missing.push('TournamentQueries.isParticipantInTournament');
    }
    // C8 — prior-round derivation.
    if (!TournamentQueries ||
        typeof TournamentQueries.getPriorRoundOutcomes !== 'function') {
        _missing.push('TournamentQueries.getPriorRoundOutcomes');
    }
    if (!EliminationCascade ||
        typeof EliminationCascade.restoreCharacterElimination !== 'function') {
        _missing.push(
            'TournamentEliminationCascade.restoreCharacterElimination'
        );
    }
    if (!Schema || typeof Schema.findRoundById !== 'function') {
        _missing.push('TournamentSchema.findRoundById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTournamentEvents] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyTournamentEventsLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isArray(value) {
        return Array.isArray(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

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

    function resolveParticipantName(participantId, participantType) {
        if (participantType === 'team') {
            return getTeamName(participantId);
        }
        return getCharacterName(participantId);
    }

    function getCanonicalParticipantTypeForExam(exam) {
        if (!exam) { return 'character'; }
        if (exam.mode === 'teams') { return 'team'; }
        return 'character';
    }

    /**
     * Surface a rejected mutation. Logs to console AND toasts the
     * message.
     */
    function rejectMutation(label, result) {
        var message = (result && result.message)
            ? result.message
            : 'Mutation was rejected without a message.';
        console.warn(
            '[AcademyTournamentEvents] ' + label + ' rejected:', message
        );
        notify(message, 'error');
    }

    /**
     * Surface a thrown error from a mutation.
     */
    function failMutation(label, err, userMessage) {
        console.warn(
            '[AcademyTournamentEvents] ' + label + ' failed:', err
        );
        notify(userMessage || 'Operation failed.', 'error');
    }

    // ============================================================
    // CHANGE CALLBACK
    // ============================================================

    var _onChange = null;

    function setOnChangeCallback(fn) {
        _onChange = (typeof fn === 'function') ? fn : null;
    }

    function notifyChange() {
        if (typeof _onChange !== 'function') { return; }
        try {
            _onChange();
        } catch (e) {
            console.warn(
                '[AcademyTournamentEvents] onChange callback threw:', e
            );
        }
    }

    // ============================================================
    // MUTATION RESULT HANDLER
    // ============================================================

    function handleMutation(promise, options) {
        options = options || {};
        var label = options.label || 'mutation';
        var errorMessage = options.errorMessage || 'Operation failed.';
        var onSuccess = options.onSuccess;

        return promise.then(function(result) {
            if (result && result.success) {
                if (typeof onSuccess === 'function') {
                    onSuccess(result);
                }
                return;
            }
            rejectMutation(label, result);
        }).catch(function(err) {
            failMutation(label, err, errorMessage);
        });
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    function openModal(className, contentHTML, onBind) {
        var modal = Modal.createModal(className);
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return null;
        }

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = contentHTML || '';
        modal.appendChild(contentEl);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var close = function() {
            closeModal(modal);
        };

        if (typeof onBind === 'function') {
            onBind(modal, close);
        }

        return modal;
    }

    function closeModal(modal) {
        if (!modal) { return; }
        if (!modal.parentNode) { return; }

        var teardownPromise;

        try {
            if (typeof Modal.closeModal === 'function') {
                teardownPromise = Modal.closeModal(modal);
            } else if (typeof Modal.hideModal === 'function') {
                teardownPromise = Modal.hideModal(modal);
            }
        } catch (e) {
            console.warn(
                '[AcademyTournamentEvents] Modal teardown threw:', e
            );
            teardownPromise = null;
        }

        var finalize = function() {
            if (modal.parentNode) {
                try {
                    modal.parentNode.removeChild(modal);
                } catch (e) {
                    // Already detached.
                }
            }
        };

        if (teardownPromise && typeof teardownPromise.then === 'function') {
            teardownPromise.then(finalize).catch(function(err) {
                console.warn(
                    '[AcademyTournamentEvents] Modal teardown failed:', err
                );
                finalize();
            });
        } else {
            finalize();
        }
    }

    function bindCommonModalControls(modal, close) {
        if (!modal || typeof close !== 'function') { return; }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', close);
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                close();
            }
        });
    }

    // ============================================================
    // MODAL VM BUILDERS
    // ============================================================

    /**
     * Build the eligible-participant list for the Add-Match /
     * Edit-Match modal.
     *
     * Each entry is { id, name, priorRoundOutcome }.
     *
     * priorRoundOutcome is derived from the round IMMEDIATELY BEFORE
     * `roundId` (C8). When there is no previous round, or the
     * previous round has no completed matches for this participant,
     * the field is null and the view renders no badge.
     *
     * The prior-outcome derivation is a READ. It is not part of the
     * mutation pipeline. It is called at modal-open time, so the
     * eligible list is always fresh with respect to the target round.
     */
    function buildEligibleForNewMatch(examId, roundId) {
        var rawIds = TournamentMatches.getEligibleParticipants(examId)
            || [];
        var exam = TournamentQueries.getTournament(examId);
        if (!exam) { return []; }

        var mode = exam.mode || 'individuals';

        // Exclude participants already in a match in this round.
        var alreadyAssigned = Object.create(null);
        var round = TournamentQueries.getRound(examId, roundId);
        if (round && isArray(round.matches)) {
            for (var m = 0; m < round.matches.length; m++) {
                var match = round.matches[m];
                if (!match || !isArray(match.participants)) {
                    continue;
                }
                for (var p = 0; p < match.participants.length; p++) {
                    alreadyAssigned[String(match.participants[p])] = true;
                }
            }
        }

        // C8 — prior-round outcomes. One derivation, one map, reused
        // for every entry. When there is no previous round or the
        // query throws, the map is empty and every entry carries
        // null.
        var priorOutcomes = {};
        try {
            priorOutcomes = TournamentQueries.getPriorRoundOutcomes(
                examId,
                roundId
            ) || {};
        } catch (e) {
            console.warn(
                '[AcademyTournamentEvents] getPriorRoundOutcomes ' +
                'failed:', e
            );
            priorOutcomes = {};
        }

        var result = [];
        for (var i = 0; i < rawIds.length; i++) {
            var id = String(rawIds[i]);
            if (alreadyAssigned[id]) { continue; }

            var outcome = priorOutcomes[id];
            if (outcome !== 'pass' && outcome !== 'retry') {
                outcome = null;
            }

            result.push({
                id: id,
                name: resolveParticipantName(
                    id,
                    mode === 'teams' ? 'team' : 'character'
                ),
                priorRoundOutcome: outcome
            });
        }
        return result;
    }

    /**
     * Build the team VM list the Complete-Match modal needs for a
     * team_vs_team match.
     */
    function buildTeamCompletionVMs(match) {
        var teamIds = isArray(match.participants)
            ? match.participants
            : [];
        var existingTeamResults = match.teamResults || {};
        var existingIndividualResults = match.individualResults || {};
        var result = [];

        for (var i = 0; i < teamIds.length; i++) {
            var teamId = teamIds[i];
            if (!teamId) { continue; }

            var team = TeamQueries.getTeamById(teamId);
            var members = [];

            if (team && isArray(team.members)) {
                for (var j = 0; j < team.members.length; j++) {
                    var member = team.members[j];
                    if (!member || !member.characterId) { continue; }
                    members.push({
                        id: member.characterId,
                        name: getCharacterName(member.characterId)
                    });
                }
            }

            result.push({
                id: String(teamId),
                name: getTeamName(teamId),
                members: members
            });
        }

        return result;
    }

    // ============================================================
    // ROUND COLLAPSE TOGGLE (C4)
    // ============================================================
    //
    // UI-ONLY. No mutation, no modal, no domain read. The handler:
    //
    //   1. Reads the current expanded state from AcademyUI. The
    //      default passed in is `true`, matching the C4 policy:
    //      "all rounds expanded on first view." If the default ever
    //      changes, this call site is where the change goes.
    //
    //   2. Writes the opposite state back. AcademyUI stores
    //      collapsed-only (absence means expanded), so passing
    //      `true` here removes any stored record.
    //
    //   3. Calls notifyChange() to trigger a re-render of the
    //      Exams view. The aggregator reads the new state on the
    //      next buildExamViewModel call and stamps each round's
    //      VM accordingly.
    //
    // The examId and roundId come from the button's data-*
    // attributes. Both are required; missing either is a no-op
    // (with a console warning, so a broken caller surfaces).

    function toggleRoundCollapse(examId, roundId) {
        if (!isNonEmptyString(examId) || !isNonEmptyString(roundId)) {
            console.warn(
                '[AcademyTournamentEvents] toggleRoundCollapse: ' +
                'missing examId or roundId',
                { examId: examId, roundId: roundId }
            );
            return;
        }

        // The default is "expanded". Passing it explicitly here keeps
        // the policy at the call site.
        var currentExpanded = AcademyUI.isRoundExpanded(
            examId,
            roundId,
            true
        );

        AcademyUI.setRoundExpanded(examId, roundId, !currentExpanded);

        notifyChange();
    }

    // ============================================================
    // EXAM CRUD
    // ============================================================

    function createExam(classId, week, mode) {
        if (!isNonEmptyString(classId) ||
            week === undefined ||
            week === null) {
            notify('Class and week are required.', 'error');
            return;
        }

        var classRecord = AcademyClasses.getClass(classId);
        if (!classRecord) {
            notify('Class not found.', 'error');
            return;
        }

        var html = View.buildCreateExamModalHTML({
            classId: classId,
            className: classRecord.name || 'Unnamed Class',
            week: week,
            mode: mode || 'individuals'
        });

        openModal('at-create-exam-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-create-exam-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = View.collectCreateExamForm(form);
                if (!payload || !payload.name) {
                    notify('Exam name is required.', 'error');
                    return;
                }

                handleMutation(
                    TournamentCore.createTournament({
                        name: payload.name,
                        mode: payload.mode,
                        startWeek: week,
                        endWeek: week,
                        totalRounds: payload.totalRounds,
                        graduatingClassId: classId,
                        classFilterEnabled: true,
                        status: 'draft'
                    }),
                    {
                        label: 'createTournament',
                        errorMessage: 'Failed to create exam.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    function deleteExam(examId) {
        if (!isNonEmptyString(examId)) { return; }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var html = View.buildDeleteExamModalHTML({
            name: exam.name || 'this exam'
        });

        openModal('at-delete-exam-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-delete-exam-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                handleMutation(
                    TournamentCore.archiveTournament(examId),
                    {
                        label: 'archiveTournament',
                        errorMessage: 'Failed to delete exam.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // REOPEN — EXAM
    // ============================================================

    /**
     * Reopen the exam itself. Flips status back to 'active'.
     *
     * Does NOT touch rounds, matches, or eliminations. It un-gates
     * the round and match edit buttons by removing the
     * exam.status === 'completed' condition they check.
     */
    function reopenExam(examId) {
        if (!isNonEmptyString(examId)) { return; }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        if (exam.status !== 'completed') {
            notify('Exam is not completed.', 'info');
            return;
        }

        var html = View.buildReopenExamModalHTML();

        openModal('at-reopen-exam-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-reopen-exam-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                handleMutation(
                    TournamentCore.updateTournament(examId, {
                        status: 'active'
                    }),
                    {
                        label: 'reopenExam',
                        errorMessage: 'Failed to reopen exam.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // REOPEN — ROUND
    // ============================================================

    /**
     * Reopen every match in a round.
     *
     * Reverses every elimination produced by any match in the round,
     * flips every match back to 'pending', and resets the round's
     * status to 'pending'. Match results are preserved.
     */
    function reopenRound(examId, roundId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(roundId)) {
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var round = TournamentQueries.getRound(examId, roundId);
        if (!round) {
            notify('Round not found.', 'error');
            return;
        }

        var html = View.buildReopenRoundModalHTML();

        openModal('at-reopen-round-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-reopen-round-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                handleMutation(
                    TournamentCore.reopenRound(examId, roundId),
                    {
                        label: 'reopenRound',
                        errorMessage: 'Failed to reopen round.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // REOPEN — MATCH
    // ============================================================

    /**
     * Reopen a single match.
     *
     * Reverses eliminations produced by this match and flips the
     * match back to 'pending'. Results preserved.
     */
    function reopenMatch(examId, roundId, matchId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(roundId) ||
            !isNonEmptyString(matchId)) {
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var match = TournamentQueries.getMatch(
            examId, roundId, matchId
        );
        if (!match) {
            notify('Match not found.', 'error');
            return;
        }

        if (match.status !== 'completed') {
            notify('Match is not completed.', 'info');
            return;
        }

        var html = View.buildReopenMatchModalHTML();

        openModal('at-reopen-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-reopen-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                handleMutation(
                    TournamentMatches.reopenMatch(
                        examId, roundId, matchId
                    ),
                    {
                        label: 'reopenMatch',
                        errorMessage: 'Failed to reopen match.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // POOL MEMBERSHIP
    // ============================================================

    function togglePoolMember(examId, participantId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(participantId)) {
            console.warn(
                '[AcademyTournamentEvents] togglePoolMember: missing ids',
                { examId: examId, participantId: participantId }
            );
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var participantType =
            getCanonicalParticipantTypeForExam(exam);
        var inExam = TournamentQueries.isParticipantInTournament(
            examId,
            participantId
        ) === true;

        if (inExam) {
            handleMutation(
                TournamentCore.removeParticipant(examId, participantId),
                {
                    label: 'removeParticipant',
                    errorMessage: 'Could not remove participant.',
                    onSuccess: function() {
                        notifyChange();
                    }
                }
            );
            return;
        }

        handleMutation(
            TournamentCore.addParticipant(examId, {
                id: participantId,
                type: participantType
            }),
            {
                label: 'addParticipant',
                errorMessage: 'Could not add participant.',
                onSuccess: function() {
                    notifyChange();
                }
            }
        );
    }

    // ============================================================
    // RESTORE ELIMINATED PARTICIPANT
    // ============================================================

    function restoreEliminatedParticipant(examId, characterId) {
        if (!isNonEmptyString(examId)) {
            notify('Exam ID is required.', 'error');
            return;
        }
        if (!isNonEmptyString(characterId)) {
            notify('Character ID is required.', 'error');
            return;
        }

        var promise = MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                if (!Array.isArray(appData.tournaments)) {
                    return {
                        valid: false,
                        message: 'Tournament store is not available.'
                    };
                }
                var found = false;
                for (var i = 0; i < appData.tournaments.length; i++) {
                    var t = appData.tournaments[i];
                    if (t && String(t.id) === String(examId)) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message: 'Exam no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                return EliminationCascade.restoreCharacterElimination(
                    appData,
                    examId,
                    characterId
                );
            },
            logMessage: 'Restored character from tournament elimination',
            successMessage: 'Character restored from elimination.',
            failureMessage: 'Failed to restore character.'
        });

        handleMutation(promise, {
            label: 'restoreCharacterElimination',
            errorMessage: 'Could not restore character from elimination.',
            onSuccess: function() {
                notifyChange();
            }
        });
    }

    // ============================================================
    // ROUNDS
    // ============================================================

    function addRound(examId) {
        if (!isNonEmptyString(examId)) { return; }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var html = View.buildAddRoundModalHTML({
            isTeamMode: exam.mode === 'teams'
        });

        openModal('at-add-round-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-add-round-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = View.collectAddRoundForm(form);
                if (!payload) { return; }

                handleMutation(
                    TournamentCore.addRound(examId, {
                        matchSize: payload.matchSize,
                        matchType: payload.matchType,
                        isPairExam: payload.isPairExam
                    }),
                    {
                        label: 'addRound',
                        errorMessage: 'Failed to add round.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    function removeRound(examId, roundId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(roundId)) {
            return;
        }

        var html = View.buildRemoveRoundModalHTML();

        openModal('at-remove-round-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-remove-round-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                handleMutation(
                    TournamentCore.removeRound(examId, roundId),
                    {
                        label: 'removeRound',
                        errorMessage: 'Failed to remove round.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // MATCH GENERATION
    // ============================================================

    function autoGenerateRound(examId, roundId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(roundId)) {
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var eligible = buildEligibleForNewMatch(examId, roundId);

        var html = View.buildAutoGenerateRoundModalHTML({
            examId: examId,
            roundId: roundId,
            eligibleParticipants: eligible
        });

        openModal('at-auto-generate-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-auto-generate-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = View.collectAutoGenerateRoundForm(form);

                handleMutation(
                    TournamentMatches.generateMatches(
                        examId,
                        roundId,
                        { matchSize: payload.matchSize }
                    ),
                    {
                        label: 'generateMatches',
                        errorMessage:
                            'Failed to auto-generate matches.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // MATCHES - Manual Add
    // ============================================================

    function addMatchManual(examId, roundId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(roundId)) {
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var round = TournamentQueries.getRound(examId, roundId);
        if (!round) {
            notify('Round not found.', 'error');
            return;
        }

        var eligible = buildEligibleForNewMatch(examId, roundId);

        var html = View.buildAddMatchModalHTML({
            examId: examId,
            roundId: roundId,
            mode: exam.mode || 'individuals',
            isPairExam: round.isPairExam === true,
            eligibleParticipants: eligible
        });

        openModal('at-add-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-add-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = View.collectAddMatchForm(form);
                if (!payload ||
                    !isArray(payload.participants) ||
                    payload.participants.length < 2) {
                    notify(
                        'Please select at least 2 participants.',
                        'error'
                    );
                    return;
                }

                handleMutation(
                    TournamentMatches.createMatch(examId, roundId, {
                        participants: payload.participants,
                        type: payload.matchType,
                        isPairExam: payload.isPairExam === true,
                        pairings: payload.pairings || undefined
                    }),
                    {
                        label: 'createMatch',
                        errorMessage: 'Failed to add match.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // MATCHES - Edit
    // ============================================================

    function editMatch(examId, roundId, matchId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(roundId) ||
            !isNonEmptyString(matchId)) {
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var round = TournamentQueries.getRound(examId, roundId);
        if (!round) {
            notify('Round not found.', 'error');
            return;
        }

        var match = TournamentQueries.getMatch(
            examId, roundId, matchId
        );
        if (!match) {
            notify('Match not found.', 'error');
            return;
        }

        var eligible = buildEligibleForNewMatch(examId, roundId);
        var currentParticipants = isArray(match.participants)
            ? match.participants.slice()
            : [];

        var html = View.buildEditMatchModalHTML({
            examId: examId,
            roundId: roundId,
            matchId: matchId,
            mode: exam.mode || 'individuals',
            isPairExam: match.isPairExam === true,
            eligibleParticipants: eligible,
            currentParticipants: currentParticipants
        });

        openModal('at-edit-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-edit-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = View.collectEditMatchForm(form);
                if (!payload ||
                    !isArray(payload.participants) ||
                    payload.participants.length < 2) {
                    notify(
                        'Please select at least 2 participants.',
                        'error'
                    );
                    return;
                }

                var updatePayload = {
                    participants: payload.participants
                };

                if (payload.isPairExam === true) {
                    updatePayload.isPairExam = true;
                    if (isArray(payload.pairings) &&
                        payload.pairings.length > 0) {
                        updatePayload.pairings = payload.pairings;
                    }
                }

                handleMutation(
                    TournamentMatches.updateMatch(
                        examId, roundId, matchId, updatePayload
                    ),
                    {
                        label: 'updateMatch',
                        errorMessage: 'Failed to update match.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // MATCHES - Complete
    // ============================================================

    function completeMatch(examId, roundId, matchId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(roundId) ||
            !isNonEmptyString(matchId)) {
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var match = TournamentQueries.getMatch(
            examId, roundId, matchId
        );
        if (!match) {
            notify('Match not found.', 'error');
            return;
        }

        var mode = exam.mode || 'individuals';
        var matchType = match.type || 'group_exam';

        var modalOptions = {
            examId: examId,
            roundId: roundId,
            matchId: matchId,
            matchType: matchType,
            mode: mode
        };

        if (matchType === 'team_vs_team') {
            modalOptions.teams = buildTeamCompletionVMs(match);
            modalOptions.existingTeamResults = match.teamResults || {};
            modalOptions.existingIndividualResults =
                match.individualResults || {};
        } else {
            var participants = isArray(match.participants)
                ? match.participants
                : [];
            modalOptions.participants = participants.map(function(pid) {
                return {
                    id: String(pid),
                    name: getCharacterName(pid)
                };
            });
            modalOptions.existingResults = match.results || {};
        }

        var html = View.buildCompleteMatchModalHTML(modalOptions);

        openModal('at-complete-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-complete-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = View.collectCompleteMatchForm(form);
                if (!payload) {
                    notify(
                        'Could not read match results.',
                        'error'
                    );
                    return;
                }

                handleMutation(
                    TournamentMatches.completeMatch(
                        examId, roundId, matchId, payload
                    ),
                    {
                        label: 'completeMatch',
                        errorMessage: 'Failed to complete match.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // MATCHES - Remove
    // ============================================================

    function removeMatch(examId, roundId, matchId) {
        if (!isNonEmptyString(examId) ||
            !isNonEmptyString(roundId) ||
            !isNonEmptyString(matchId)) {
            return;
        }

        var html = View.buildRemoveMatchModalHTML();

        openModal('at-remove-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-remove-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                handleMutation(
                    TournamentMatches.removeMatch(
                        examId, roundId, matchId
                    ),
                    {
                        label: 'removeMatch',
                        errorMessage: 'Failed to remove match.',
                        onSuccess: function() {
                            close();
                            notifyChange();
                        }
                    }
                );
            });
        });
    }

    // ============================================================
    // EXAM COMPLETION
    // ============================================================

    function completeExam(examId) {
        if (!isNonEmptyString(examId)) { return; }

        handleMutation(
            TournamentCore.updateTournament(examId, {
                status: 'completed'
            }),
            {
                label: 'completeExam',
                errorMessage: 'Could not complete the exam.',
                onSuccess: function() {
                    notifyChange();
                }
            }
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTournamentEvents = {
        setOnChangeCallback: setOnChangeCallback,

        createExam: createExam,
        deleteExam: deleteExam,
        reopenExam: reopenExam,
        togglePoolMember: togglePoolMember,

        addRound: addRound,
        removeRound: removeRound,
        reopenRound: reopenRound,
        toggleRoundCollapse: toggleRoundCollapse,
        autoGenerateRound: autoGenerateRound,
        addMatchManual: addMatchManual,
        editMatch: editMatch,
        completeMatch: completeMatch,
        reopenMatch: reopenMatch,
        removeMatch: removeMatch,

        restoreEliminatedParticipant: restoreEliminatedParticipant,

        completeExam: completeExam
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTournamentEvents;
        var missing = [];

        var required = [
            'setOnChangeCallback',
            'createExam',
            'deleteExam',
            'reopenExam',
            'togglePoolMember',
            'addRound',
            'removeRound',
            'reopenRound',
            'toggleRoundCollapse',
            'autoGenerateRound',
            'addMatchManual',
            'editMatch',
            'completeMatch',
            'reopenMatch',
            'removeMatch',
            'restoreEliminatedParticipant',
            'completeExam'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTournamentEvents] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
