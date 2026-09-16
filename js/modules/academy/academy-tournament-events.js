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
 * ADD ROUND — TOTAL ROUNDS SEMANTICS:
 *   TournamentLifecycle.canAddRound rejects a new round when
 *   `currentRoundCount >= totalRounds`. The Create Exam modal
 *   defaults totalRounds to 5, but a user who adds more than 5
 *   rounds hits the cap. This module auto-bumps totalRounds before
 *   adding when at capacity. Two sequential pipeline mutations.
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
 *     failure the pipeline has already notified; this module does
 *     not double-notify, but does log to console for diagnosis.
 *   - A thrown error from a mutation is logged. It is a bug.
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

    function resolveExamIdFromEl(el) {
        if (!el) { return null; }
        var direct = el.dataset ? el.dataset.examId : null;
        if (isNonEmptyString(direct)) { return direct; }
        var wrapper = el.closest ? el.closest('[data-exam-id]') : null;
        if (!wrapper) { return null; }
        return wrapper.dataset.examId || null;
    }

    function resolveRoundIdFromEl(el) {
        if (!el) { return null; }
        var direct = el.dataset ? el.dataset.roundId : null;
        if (isNonEmptyString(direct)) { return direct; }
        var wrapper = el.closest ? el.closest('[data-round-id]') : null;
        if (!wrapper) { return null; }
        return wrapper.dataset.roundId || null;
    }

    function resolveMatchIdFromEl(el) {
        if (!el) { return null; }
        var direct = el.dataset ? el.dataset.matchId : null;
        if (isNonEmptyString(direct)) { return direct; }
        var wrapper = el.closest ? el.closest('[data-match-id]') : null;
        if (!wrapper) { return null; }
        return wrapper.dataset.matchId || null;
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
                    }
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] createTournament failed:', err);
                    notify('Failed to create exam.', 'error');
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
                    }
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] deleteTournament failed:', err);
                    notify('Failed to delete exam.', 'error');
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
                    } else if (result && result.message) {
                        console.warn(
                            '[AcademyTournamentEvents] removeParticipant rejected:',
                            result.message
                        );
                    }
                })
                .catch(function(err) {
                    console.warn(
                        '[AcademyTournamentEvents] removeParticipant failed:',
                        err
                    );
                    notify('Could not remove participant.', 'error');
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
                } else if (result && result.message) {
                    console.warn(
                        '[AcademyTournamentEvents] addParticipant rejected:',
                        result.message,
                        {
                            examId: examId,
                            examMode: exam.mode,
                            participantId: participantId,
                            participantType: participantType
                        }
                    );
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyTournamentEvents] addParticipant failed:',
                    err
                );
                notify('Could not add participant.', 'error');
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

                var roundData = {
                    matchSize: payload.matchSize,
                    matchType: payload.matchType,
                    isPairExam: payload.isPairExam
                };

                submitRound(examId, roundData, close);
            });
        });
    }

    function submitRound(examId, roundData, close) {
        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var currentRounds = Array.isArray(exam.rounds)
            ? exam.rounds.length
            : 0;
        var totalRounds = typeof exam.totalRounds === 'number' && exam.totalRounds >= 1
            ? exam.totalRounds
            : 1;

        var atCapacity = currentRounds >= totalRounds;

        var proceed = function() {
            TournamentCore.addRound(examId, roundData)
                .then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    } else if (result && result.message) {
                        console.warn(
                            '[AcademyTournamentEvents] addRound rejected:',
                            result.message
                        );
                    }
                })
                .catch(function(err) {
                    console.warn('[AcademyTournamentEvents] addRound failed:', err);
                    notify('Failed to add round.', 'error');
                });
        };

        if (!atCapacity) {
            proceed();
            return;
        }

        var newTotal = currentRounds + 1;

        TournamentCore.updateTournament(examId, { totalRounds: newTotal })
            .then(function(updateResult) {
                if (updateResult && updateResult.success) {
                    proceed();
                } else if (updateResult && updateResult.message) {
                    console.warn(
                        '[AcademyTournamentEvents] updateTournament rejected:',
                        updateResult.message
                    );
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyTournamentEvents] updateTournament failed:',
                    err
                );
                notify('Failed to expand exam capacity.', 'error');
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
                    }
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] removeRound failed:', err);
                    notify('Failed to remove round.', 'error');
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
                    }
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] generateMatches failed:', err);
                    notify('Failed to auto-generate matches.', 'error');
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
                    }
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] createMatch failed:', err);
                    notify('Failed to add match.', 'error');
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
                    }
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] updateMatch failed:', err);
                    notify('Failed to update match.', 'error');
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

                if (!payload) { return; }

                TournamentMatches.completeMatch(examId, roundId, matchId, payload)
                    .then(function(result) {
                        if (result && result.success) {
                            close();
                            notifyChange();
                        }
                    })
                    .catch(function(err) {
                        console.warn(
                            '[AcademyTournamentEvents] completeMatch failed:', err
                        );
                        notify('Failed to complete match.', 'error');
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
                        }
                    })
                    .catch(function(err) {
                        console.warn(
                            '[AcademyTournamentEvents] removeMatch failed:', err
                        );
                        notify('Failed to remove match.', 'error');
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
            }
        }).catch(function(err) {
            console.warn('[AcademyTournamentEvents] completeTournament failed:', err);
            notify('Could not complete the exam.', 'error');
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

        completeExam: completeExam,

        resolveExamIdFromEl: resolveExamIdFromEl,
        resolveRoundIdFromEl: resolveRoundIdFromEl,
        resolveMatchIdFromEl: resolveMatchIdFromEl
    };

})();
