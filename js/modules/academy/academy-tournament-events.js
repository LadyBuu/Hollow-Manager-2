/**
 * modules/academy/academy-tournament-events.js - Academy Exams Event Wiring
 * Mutation orchestration for the Academy-embedded Exams view.
 *
 * Path: js/modules/academy/academy-tournament-events.js
 *
 * RESPONSIBILITIES:
 *   - Route user actions from the Exams view to TournamentCore and
 *     TournamentMatches
 *   - Open and close the modal shells the Exams view uses
 *   - Read the collected form payload from the view's collector
 *     function and hand it to the domain
 *   - Notify the caller's onChange callback when a mutation succeeds
 *
 * NOT RESPONSIBILITIES:
 *   - HTML construction. The view module builds all modal content.
 *   - Eligibility computation. The domain owns it.
 *   - Name resolution. The view or the aggregator owns it.
 *   - Domain reads via window.data. TournamentQueries owns reads.
 *
 * ACTION NAMING:
 *   Every action element carries data-action with an 'exam-' prefix.
 *   Example: data-action="exam-add-round". The dispatcher in
 *   academy-view.js routes by prefix; this module receives the
 *   unprefixed verb.
 *
 *   Every action element also carries the identity it needs:
 *     data-exam-id   — on every exam-scoped action
 *     data-round-id  — on every round- and match-scoped action
 *     data-match-id  — on every match-scoped action
 *     data-pool-id   — on pool toggle actions
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
 *   Every mutation's .then handler checks `result.success`. On success,
 *   the modal closes and the caller's onChange runs. On failure, the
 *   result's message is logged to console AND surfaced as a toast.
 *   This is why there is a console log for every rejection: a silent
 *   UI in the face of a rejected mutation is a support nightmare.
 *
 * ADD ROUND — TOTAL ROUNDS SEMANTICS:
 *   The lifecycle no longer caps rounds at totalRounds. totalRounds
 *   is a planning hint. This module just calls TournamentCore.addRound
 *   and surfaces whatever the domain says.
 *
 * ADD CHARACTER TO EXAM — DIAGNOSTICS:
 *   The Add Character button calls togglePoolMember, which reads
 *   the exam, decides add vs remove, and calls
 *   TournamentCore.addParticipant or removeParticipant. When the
 *   domain call fails, the pipeline has already shown a
 *   notification, so a silent UI is a symptom of the domain
 *   rejecting the add, not of the button being unwired.
 *
 * ERROR HANDLING:
 *   - Domain mutations resolve to { success, data?, message? }. On
 *     success this module closes the modal and calls onChange. On
 *     failure the message is logged and toasted.
 *   - A thrown error from a mutation is logged and toasted.
 *   - The onChange callback is wrapped in try/catch so a throwing
 *     consumer does not break the events module.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.TournamentCore
 *   - window.TournamentMatches
 *   - window.TournamentQueries
 *   - window.AcademyClasses
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.AcademyTournamentView — supplies modal HTML and form
 *     collectors. When absent, modal-opening functions are no-ops
 *     that log a warning.
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
    var TournamentCore = window.TournamentCore;
    var TournamentMatches = window.TournamentMatches;
    var TournamentQueries = window.TournamentQueries;
    var AcademyClasses = window.AcademyClasses;

    var _missing = [];

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
    if (!TournamentCore || typeof TournamentCore.createTournament !== 'function') {
        _missing.push('TournamentCore.createTournament');
    }
    if (!TournamentCore || typeof TournamentCore.deleteTournament !== 'function') {
        _missing.push('TournamentCore.deleteTournament');
    }
    if (!TournamentCore || typeof TournamentCore.addRound !== 'function') {
        _missing.push('TournamentCore.addRound');
    }
    if (!TournamentCore || typeof TournamentCore.removeRound !== 'function') {
        _missing.push('TournamentCore.removeRound');
    }
    if (!TournamentCore || typeof TournamentCore.addParticipant !== 'function') {
        _missing.push('TournamentCore.addParticipant');
    }
    if (!TournamentCore || typeof TournamentCore.removeParticipant !== 'function') {
        _missing.push('TournamentCore.removeParticipant');
    }
    if (!TournamentCore || typeof TournamentCore.completeTournament !== 'function') {
        _missing.push('TournamentCore.completeTournament');
    }
    if (!TournamentCore || typeof TournamentCore.updateTournament !== 'function') {
        _missing.push('TournamentCore.updateTournament');
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
    if (!TournamentMatches || typeof TournamentMatches.generateMatches !== 'function') {
        _missing.push('TournamentMatches.generateMatches');
    }
    if (!TournamentQueries || typeof TournamentQueries.getTournament !== 'function') {
        _missing.push('TournamentQueries.getTournament');
    }
    if (!TournamentQueries || typeof TournamentQueries.isParticipantInTournament !== 'function') {
        _missing.push('TournamentQueries.isParticipantInTournament');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyTournamentEvents] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyTournamentEventsLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getViewModule() {
        return window.AcademyTournamentView || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function warnOnce(label) {
        console.warn(
            '[AcademyTournamentEvents] ' + label + ' not available. ' +
            'The corresponding UI action will be a no-op.'
        );
    }

    function getCanonicalParticipantTypeForExam(exam) {
        if (!exam) { return 'character'; }
        if (exam.mode === 'teams') { return 'team'; }
        return 'character';
    }

    /**
     * Surface a rejected mutation. Logs to console AND toasts the
     * message. Used by every mutation's .then handler.
     */
    function rejectMutation(label, result) {
        var message = (result && result.message)
            ? result.message
            : 'Mutation was rejected without a message.';
        console.warn('[AcademyTournamentEvents] ' + label + ' rejected:', message);
        notify(message, 'error');
    }

    /**
     * Surface a thrown error from a mutation. Logs to console AND
     * toasts a generic failure.
     */
    function failMutation(label, err, userMessage) {
        console.warn('[AcademyTournamentEvents] ' + label + ' failed:', err);
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
            console.warn('[AcademyTournamentEvents] onChange callback threw:', e);
        }
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
            console.warn('[AcademyTournamentEvents] Modal teardown threw:', e);
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
                console.warn('[AcademyTournamentEvents] Modal teardown failed:', err);
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
    // EXAM CRUD
    // ============================================================

    function createExam(classId, week, mode) {
        var View = getViewModule();
        if (!View || typeof View.buildCreateExamModalHTML !== 'function') {
            warnOnce('AcademyTournamentView.buildCreateExamModalHTML');
            return;
        }

        if (!isNonEmptyString(classId) || week === undefined || week === null) {
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

                var payload = (typeof View.collectCreateExamForm === 'function')
                    ? View.collectCreateExamForm(form)
                    : null;

                if (!payload || !payload.name) {
                    notify('Exam name is required.', 'error');
                    return;
                }

                TournamentCore.createTournament({
                    name: payload.name,
                    mode: payload.mode,
                    startWeek: week,
                    endWeek: week,
                    totalRounds: payload.totalRounds,
                    graduatingClassId: classId,
                    classFilterEnabled: true,
                    status: 'draft'
                }).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    } else {
                        rejectMutation('createTournament', result);
                    }
                }).catch(function(err) {
                    failMutation('createTournament', err, 'Failed to create exam.');
                });
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

        var View = getViewModule();
        var html = (View && typeof View.buildDeleteExamModalHTML === 'function')
            ? View.buildDeleteExamModalHTML(exam)
            : '<form id="at-delete-exam-form">' +
                '<div class="modal-header">' +
                    '<h3>Delete Exam</h3>' +
                    '<button type="button" class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<p>Delete <strong>' +
                        DomUtils.escapeHtml(exam.name || 'this exam') +
                    '</strong> permanently?</p>' +
                    '<div class="form-actions">' +
                        '<button type="button" class="cancel-modal-btn secondary">' +
                            'Cancel</button>' +
                        '<button type="submit" class="danger">Delete Exam</button>' +
                    '</div>' +
                '</div>' +
            '</form>';

        openModal('at-delete-exam-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-delete-exam-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                TournamentCore.deleteTournament(examId).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    } else {
                        rejectMutation('deleteTournament', result);
                    }
                }).catch(function(err) {
                    failMutation('deleteTournament', err, 'Failed to delete exam.');
                });
            });
        });
    }

    // ============================================================
    // POOL MEMBERSHIP
    // ============================================================

    function togglePoolMember(examId, participantId) {
        if (!isNonEmptyString(examId) || !isNonEmptyString(participantId)) {
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

        var participantType = getCanonicalParticipantTypeForExam(exam);
        var inExam = false;

        try {
            inExam = TournamentQueries.isParticipantInTournament(
                examId,
                participantId
            ) === true;
        } catch (e) {
            console.warn(
                '[AcademyTournamentEvents] isParticipantInTournament threw:',
                e
            );
            inExam = false;
        }

        if (inExam) {
            TournamentCore.removeParticipant(examId, participantId)
                .then(function(result) {
                    if (result && result.success) {
                        notifyChange();
                    } else {
                        rejectMutation('removeParticipant', result);
                    }
                })
                .catch(function(err) {
                    failMutation('removeParticipant', err, 'Could not remove participant.');
                });
            return;
        }

        TournamentCore.addParticipant(examId, {
            id: participantId,
            type: participantType
        })
            .then(function(result) {
                if (result && result.success) {
                    notifyChange();
                } else {
                    rejectMutation('addParticipant', result);
                }
            })
            .catch(function(err) {
                failMutation('addParticipant', err, 'Could not add participant.');
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

        var View = getViewModule();
        if (!View || typeof View.buildAddRoundModalHTML !== 'function') {
            warnOnce('AcademyTournamentView.buildAddRoundModalHTML');
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

                var payload = (typeof View.collectAddRoundForm === 'function')
                    ? View.collectAddRoundForm(form)
                    : null;

                if (!payload) { return; }

                TournamentCore.addRound(examId, {
                    matchSize: payload.matchSize,
                    matchType: payload.matchType,
                    isPairExam: payload.isPairExam
                }).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    } else {
                        rejectMutation('addRound', result);
                    }
                }).catch(function(err) {
                    failMutation('addRound', err, 'Failed to add round.');
                });
            });
        });
    }

    function removeRound(examId, roundId) {
        if (!isNonEmptyString(examId) || !isNonEmptyString(roundId)) {
            return;
        }

        var View = getViewModule();
        var html = (View && typeof View.buildRemoveRoundModalHTML === 'function')
            ? View.buildRemoveRoundModalHTML({ roundId: roundId })
            : '<form id="at-remove-round-form">' +
                '<div class="modal-header">' +
                    '<h3>Remove Round</h3>' +
                    '<button type="button" class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<p>Remove this round and all its matches?</p>' +
                    '<div class="form-actions">' +
                        '<button type="button" class="cancel-modal-btn secondary">' +
                            'Cancel</button>' +
                        '<button type="submit" class="danger">Remove Round</button>' +
                    '</div>' +
                '</div>' +
            '</form>';

        openModal('at-remove-round-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-remove-round-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                TournamentCore.removeRound(examId, roundId).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    } else {
                        rejectMutation('removeRound', result);
                    }
                }).catch(function(err) {
                    failMutation('removeRound', err, 'Failed to remove round.');
                });
            });
        });
    }

    // ============================================================
    // MATCH GENERATION
    // ============================================================

    function autoGenerateRound(examId, roundId) {
        if (!isNonEmptyString(examId) || !isNonEmptyString(roundId)) {
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var View = getViewModule();
        if (!View || typeof View.buildAutoGenerateRoundModalHTML !== 'function') {
            warnOnce('AcademyTournamentView.buildAutoGenerateRoundModalHTML');
            return;
        }

        var html = View.buildAutoGenerateRoundModalHTML({
            examId: examId,
            roundId: roundId
        });

        openModal('at-auto-generate-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-auto-generate-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = (typeof View.collectAutoGenerateRoundForm === 'function')
                    ? View.collectAutoGenerateRoundForm(form)
                    : { matchSize: null };

                TournamentMatches.generateMatches(examId, roundId, {
                    matchSize: payload.matchSize
                }).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    } else {
                        rejectMutation('generateMatches', result);
                    }
                }).catch(function(err) {
                    failMutation('generateMatches', err, 'Failed to auto-generate matches.');
                });
            });
        });
    }

    // ============================================================
    // MATCHES - Manual Add
    // ============================================================

    function addMatchManual(examId, roundId) {
        if (!isNonEmptyString(examId) || !isNonEmptyString(roundId)) {
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var View = getViewModule();
        if (!View || typeof View.buildAddMatchModalHTML !== 'function') {
            warnOnce('AcademyTournamentView.buildAddMatchModalHTML');
            return;
        }

        var html = View.buildAddMatchModalHTML({
            examId: examId,
            roundId: roundId
        });

        openModal('at-add-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-add-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = (typeof View.collectAddMatchForm === 'function')
                    ? View.collectAddMatchForm(form)
                    : null;

                if (!payload || !Array.isArray(payload.participants) ||
                    payload.participants.length < 2) {
                    notify('Please select at least 2 participants.', 'error');
                    return;
                }

                TournamentMatches.createMatch(examId, roundId, {
                    participants: payload.participants,
                    type: payload.matchType,
                    isPairExam: payload.isPairExam === true,
                    pairings: payload.pairings || undefined
                }).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    } else {
                        rejectMutation('createMatch', result);
                    }
                }).catch(function(err) {
                    failMutation('createMatch', err, 'Failed to add match.');
                });
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

        var View = getViewModule();
        if (!View || typeof View.buildEditMatchModalHTML !== 'function') {
            warnOnce('AcademyTournamentView.buildEditMatchModalHTML');
            return;
        }

        var html = View.buildEditMatchModalHTML({
            examId: examId,
            roundId: roundId,
            matchId: matchId
        });

        openModal('at-edit-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-edit-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = (typeof View.collectEditMatchForm === 'function')
                    ? View.collectEditMatchForm(form)
                    : null;

                if (!payload || !Array.isArray(payload.participants) ||
                    payload.participants.length < 2) {
                    notify('Please select at least 2 participants.', 'error');
                    return;
                }

                var updatePayload = {
                    participants: payload.participants
                };

                if (payload.isPairExam === true) {
                    updatePayload.isPairExam = true;
                    if (Array.isArray(payload.pairings) &&
                        payload.pairings.length > 0) {
                        updatePayload.pairings = payload.pairings;
                    }
                }

                TournamentMatches.updateMatch(
                    examId, roundId, matchId, updatePayload
                ).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    } else {
                        rejectMutation('updateMatch', result);
                    }
                }).catch(function(err) {
                    failMutation('updateMatch', err, 'Failed to update match.');
                });
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

        var View = getViewModule();
        if (!View || typeof View.buildCompleteMatchModalHTML !== 'function') {
            warnOnce('AcademyTournamentView.buildCompleteMatchModalHTML');
            return;
        }

        var html = View.buildCompleteMatchModalHTML({
            examId: examId,
            roundId: roundId,
            matchId: matchId
        });

        openModal('at-complete-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-complete-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var payload = (typeof View.collectCompleteMatchForm === 'function')
                    ? View.collectCompleteMatchForm(form)
                    : null;

                if (!payload) {
                    notify('Could not read match results.', 'error');
                    return;
                }

                TournamentMatches.completeMatch(examId, roundId, matchId, payload)
                    .then(function(result) {
                        if (result && result.success) {
                            close();
                            notifyChange();
                        } else {
                            rejectMutation('completeMatch', result);
                        }
                    })
                    .catch(function(err) {
                        failMutation('completeMatch', err, 'Failed to complete match.');
                    });
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

        var View = getViewModule();
        var html = (View && typeof View.buildRemoveMatchModalHTML === 'function')
            ? View.buildRemoveMatchModalHTML({ roundId: roundId, matchId: matchId })
            : '<form id="at-remove-match-form">' +
                '<div class="modal-header">' +
                    '<h3>Remove Match</h3>' +
                    '<button type="button" class="close-modal">&times;</button>' +
                '</div>' +
                '<div class="modal-body">' +
                    '<p>Remove this match?</p>' +
                    '<div class="form-actions">' +
                        '<button type="button" class="cancel-modal-btn secondary">' +
                            'Cancel</button>' +
                        '<button type="submit" class="danger">Remove Match</button>' +
                    '</div>' +
                '</div>' +
            '</form>';

        openModal('at-remove-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-remove-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                TournamentMatches.removeMatch(examId, roundId, matchId)
                    .then(function(result) {
                        if (result && result.success) {
                            close();
                            notifyChange();
                        } else {
                            rejectMutation('removeMatch', result);
                        }
                    })
                    .catch(function(err) {
                        failMutation('removeMatch', err, 'Failed to remove match.');
                    });
            });
        });
    }

    // ============================================================
    // EXAM COMPLETION
    // ============================================================

    function completeExam(examId) {
        if (!isNonEmptyString(examId)) { return; }

        TournamentCore.completeTournament(examId).then(function(result) {
            if (result && result.success) {
                notifyChange();
            } else {
                rejectMutation('completeTournament', result);
            }
        }).catch(function(err) {
            failMutation('completeTournament', err, 'Could not complete the exam.');
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTournamentEvents = {
        setOnChangeCallback: setOnChangeCallback,

        createExam: createExam,
        deleteExam: deleteExam,
        togglePoolMember: togglePoolMember,

        addRound: addRound,
        removeRound: removeRound,
        autoGenerateRound: autoGenerateRound,
        addMatchManual: addMatchManual,
        editMatch: editMatch,
        completeMatch: completeMatch,
        removeMatch: removeMatch,

        completeExam: completeExam
    };

})();
