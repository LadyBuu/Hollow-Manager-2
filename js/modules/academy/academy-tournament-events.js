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
 *   The events module reads these from the element. It does not
 *   query the domain to discover them.
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal(className) returns a bare .modal shell. This
 *   module appends a fresh .modal-content wrapper before calling
 *   Modal.modalSetup() and Modal.showModal(). All modal content is
 *   supplied by AcademyTournamentView's builder functions. The events
 *   module does not build HTML strings.
 *
 * ERROR HANDLING:
 *   - Domain mutations resolve to { success, data?, message? }. On
 *     success this module closes the modal and calls onChange. On
 *     failure the pipeline has already notified; this module does not
 *     double-notify.
 *   - A thrown error from a mutation is logged. It is a bug and
 *     should surface in the console.
 *   - The onChange callback is wrapped in try/catch so a throwing
 *     consumer does not break the events module's own state.
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
 * DEPENDENCIES (OPTIONAL, feature-scoped):
 *   - window.AcademyTournamentView — supplies modal HTML and form
 *     collectors. When absent, modal-opening functions are no-ops that
 *     log a warning. The mutations still work if a caller invokes
 *     them with explicit payloads.
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

    function getSchema() {
        return window.TournamentSchema || null;
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

    /**
     * Read data-exam-id from an action element, or walk up to the
     * nearest ancestor that carries one. The renderer emits
     * data-exam-id on the exam-detail wrapper and on each action; the
     * walk handles both cases.
     */
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

    /**
     * Open a modal.
     *
     * @param {string} className - CSS class for the modal shell
     * @param {string} contentHTML - Contents of the .modal-content wrapper
     * @param {function} onBind - Called with (modal, closeModal) after show
     * @returns {HTMLElement|null}
     */
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

    /**
     * Close a modal. Uses Modal.hideModal when available, falls back
     * to Modal.closeModal. After either, the modal element is removed
     * from the DOM so a fresh createModal produces a clean shell.
     */
    function closeModal(modal) {
        if (!modal) { return; }

        try {
            if (typeof Modal.hideModal === 'function') {
                Modal.hideModal(modal);
            } else if (typeof Modal.closeModal === 'function') {
                Modal.closeModal(modal);
            }
        } catch (e) {
            console.warn('[AcademyTournamentEvents] Modal close failed:', e);
        }

        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
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

    /**
     * Open the Create Exam modal.
     *
     * The modal HTML is built by AcademyTournamentView. This function
     * supplies the class and week it should pre-fill from the caller's
     * arguments.
     */
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
            return;
        }

        var exam = TournamentQueries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var inExam = TournamentQueries.isParticipantInTournament(examId, participantId);

        if (inExam) {
            TournamentCore.removeParticipant(examId, participantId).then(function(result) {
                if (result && result.success) {
                    notifyChange();
                }
            }).catch(function(err) {
                console.warn('[AcademyTournamentEvents] removeParticipant failed:', err);
                notify('Could not remove participant.', 'error');
            });
            return;
        }

        var canonicalType = exam.mode === 'teams' ? 'team' : 'character';

        TournamentCore.addParticipant(examId, {
            id: participantId,
            type: canonicalType
        }).then(function(result) {
            if (result && result.success) {
                notifyChange();
            }
        }).catch(function(err) {
            console.warn('[AcademyTournamentEvents] addParticipant failed:', err);
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

                TournamentCore.addRound(examId, {
                    matchSize: payload.matchSize,
                    matchType: payload.matchType,
                    isPairExam: payload.isPairExam
                }).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] addRound failed:', err);
                    notify('Failed to add round.', 'error');
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

                // Preserve existing pairings for pair exams. The view's
                // collector returns the pairings it read from the VM;
                // empty array means "the pair exam has no explicit
                // pairings" and the domain re-partitions.
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

        // Exposed helpers. The view's action elements carry the IDs;
        // these are used by academy-view.js's dispatcher when it needs
        // to resolve an ID from an event element without knowing the
        // element structure.
        resolveExamIdFromEl: resolveExamIdFromEl,
        resolveRoundIdFromEl: resolveRoundIdFromEl,
        resolveMatchIdFromEl: resolveMatchIdFromEl
    };

})();
