/**
 * modules/academy/academy-tournament-events.js - Academy Exams Event Wiring
 * Modal builders + mutation orchestration for the Academy-embedded
 * Exams view.
 *
 * Path: js/modules/academy/academy-tournament-events.js
 *
 * This module is responsible for:
 *   - Creating an exam for a class + week (single-week scope)
 *   - Deleting an exam
 *   - Toggling participants in/out of the pool
 *   - Adding and removing rounds
 *   - Auto-generating matches for a round
 *   - Manually adding a match
 *   - Editing a match (participants, type, pairings)
 *   - Completing a match (per-participant or per-team results)
 *   - Removing a match
 *   - Marking the exam completed
 *
 * IMPORTANT:
 *   - All mutations route through TournamentCore / TournamentMatches.
 *   - Both modules are MutationPipeline-wrapped. Every call resolves
 *     to { success, data?, message? }. This module chains `.then()`.
 *   - This module does NOT call saveData().
 *   - This module does NOT mutate window.data directly.
 *   - This module does NOT bind DOM events. It exposes handler
 *     functions that AcademyView calls from its delegated listeners.
 *   - All modals use window.Modal.
 *
 * CLASS LOOKUPS:
 *   Class records are read via AcademyClasses.getClass. The old
 *   AcademyQueries facade is no longer used here.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful
 *   - 'fail'  : not advanced; eliminated
 *
 * PUBLIC API (called by AcademyView):
 *   - setOnChangeCallback(fn)
 *   - createExam(classId, week, mode)
 *   - deleteExam(examId)
 *   - togglePoolMember(examId, participantId)
 *   - addRound(examId)
 *   - removeRound(examId, roundIndex)
 *   - autoGenerateRound(examId, roundIndex)
 *   - addMatchManual(examId, roundIndex)
 *   - editMatch(examId, roundIndex, matchIndex)
 *   - completeMatch(examId, roundIndex, matchIndex)
 *   - removeMatch(examId, roundIndex, matchIndex)
 *   - completeExam(examId)
 *
 * PERSISTENCE:
 *   TournamentCore and TournamentMatches are pipeline-wrapped.
 *   MutationPipeline owns persistence, rollback, and activity logging.
 *   This module awaits the resolved result and reacts on success.
 *
 * DEPENDENCIES:
 *   - window.DomUtils          (MANDATORY)
 *   - window.Modal             (MANDATORY)
 *   - window.NotificationSystem (MANDATORY)
 *   - window.TournamentCore    (MANDATORY)
 *   - window.TournamentMatches (MANDATORY)
 *   - window.TournamentQueries (MANDATORY)
 *   - window.TournamentSchema  (MANDATORY)
 *   - window.AcademyClasses    (MANDATORY)
 *   - window.CharacterQueries  (MANDATORY)
 *   - window.TeamQueries       (LAZY)
 *   - window.TournamentAggregator (LAZY)
 */

(function() {
    'use strict';

    if (window.__academyTournamentEventsLoaded) {
        return;
    }
    window.__academyTournamentEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }
        if (!window.TournamentCore ||
            typeof window.TournamentCore.createTournament !== 'function') {
            missing.push('TournamentCore');
        }
        if (!window.TournamentMatches ||
            typeof window.TournamentMatches.createMatch !== 'function') {
            missing.push('TournamentMatches');
        }
        if (!window.TournamentQueries ||
            typeof window.TournamentQueries.getTournament !== 'function') {
            missing.push('TournamentQueries');
        }
        if (!window.AcademyClasses ||
            typeof window.AcademyClasses.getClass !== 'function') {
            missing.push('AcademyClasses');
        }

        if (missing.length > 0) {
            console.warn('[AcademyTournamentEvents] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    // ============================================================
    // CHANGE CALLBACK
    // ============================================================

    var _onChange = null;

    function setOnChangeCallback(fn) {
        _onChange = (typeof fn === 'function') ? fn : null;
    }

    function notifyChange() {
        if (typeof _onChange === 'function') {
            try {
                _onChange();
            } catch (e) {
                console.warn('[AcademyTournamentEvents] onChange threw:', e);
            }
        }
    }

    // ============================================================
    // CLASS LOOKUP
    // ============================================================

    function getClassRecord(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        if (!window.AcademyClasses ||
            typeof window.AcademyClasses.getClass !== 'function') {
            return null;
        }
        return window.AcademyClasses.getClass(classId);
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    function openModal(className, html, onBind) {
        var modal = Modal.createModal(className);
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return null;
        }

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = html;
        modal.appendChild(contentEl);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        if (typeof onBind === 'function') {
            onBind(modal, function close() {
                try {
                    if (Modal && typeof Modal.closeModal === 'function') {
                        Modal.closeModal(modal);
                    }
                } catch (e) { /* ignore */ }
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
            });
        }

        return modal;
    }

    function bindCommonModalControls(modal, close) {
        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', close);
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) { close(); }
        });
    }

    // ============================================================
    // RESULT SELECT INPUT
    // ============================================================

    function renderResultSelect(name, currentValue) {
        var value = currentValue || 'pass';
        var options = [
            { value: 'pass', label: 'Pass' },
            { value: 'retry', label: 'Retry' },
            { value: 'fail', label: 'Fail' }
        ];

        var html = '<select class="at-result-select" name="' +
                    escapeAttribute(name) + '">';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var sel = opt.value === value ? ' selected' : '';
            html += '<option value="' + escapeAttribute(opt.value) + '"' + sel + '>' +
                        escapeHtml(opt.label) +
                    '</option>';
        }
        html += '</select>';
        return html;
    }

    // ============================================================
    // CREATE EXAM
    // ============================================================

    function createExam(classId, week, mode) {
        if (!checkDependencies()) { return; }

        if (!classId || !week) {
            notify('Class and week are required.', 'error');
            return;
        }

        var classRecord = getClassRecord(classId);
        if (!classRecord) {
            notify('Class not found.', 'error');
            return;
        }

        var resolvedMode = mode || 'individuals';
        var modeLabel = resolvedMode === 'teams' ? 'Team Exam' : 'Character Exam';
        var defaultName = modeLabel + ' \u2014 ' +
            (classRecord.name || 'Class') + ' Wk ' + week;

        var html = '';
        html += '<form id="at-create-exam-form" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + escapeAttribute(String(week)) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Create Exam</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="at-exam-name">Exam Name</label>';
        html += '<input type="text" id="at-exam-name" class="at-exam-name" ' +
                    'value="' + escapeAttribute(defaultName) + '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="at-exam-mode">Mode</label>';
        html += '<select id="at-exam-mode" class="at-exam-mode">';
        html += '<option value="individuals"' +
                    (resolvedMode === 'individuals' ? ' selected' : '') +
                    '>Individuals</option>';
        html += '<option value="teams"' +
                    (resolvedMode === 'teams' ? ' selected' : '') +
                    '>Teams</option>';
        html += '</select>';
        html += '<p class="field-hint">' +
                    'Individuals: characters compete. Teams: academic teams compete.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="at-exam-total-rounds">Total Rounds</label>';
        html += '<input type="number" id="at-exam-total-rounds" ' +
                    'class="at-exam-total-rounds" value="1" min="1">';
        html += '<p class="field-hint">' +
                    'Each round can hold one or more matches.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Create Exam</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        openModal('at-create-exam-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-create-exam-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var nameInput = form.querySelector('.at-exam-name');
                var modeInput = form.querySelector('.at-exam-mode');
                var roundsInput = form.querySelector('.at-exam-total-rounds');

                var name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    notify('Exam name is required.', 'error');
                    return;
                }

                var examMode = modeInput ? modeInput.value : 'individuals';
                var totalRounds = roundsInput
                    ? parseInt(roundsInput.value, 10) || 1
                    : 1;

                var Core = window.TournamentCore;
                if (!Core) {
                    notify('Tournament core not available.', 'error');
                    return;
                }

                Core.createTournament({
                    name: name,
                    mode: examMode,
                    startWeek: week,
                    endWeek: week,
                    totalRounds: totalRounds,
                    graduatingClassId: classId,
                    classFilterEnabled: true,
                    status: 'draft'
                }).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                    // On failure, pipeline already notified.
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] createTournament failed:', err);
                    notify('Failed to create exam.', 'error');
                });
            });
        });
    }

    // ============================================================
    // DELETE EXAM
    // ============================================================

    function deleteExam(examId) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var Queries = window.TournamentQueries;
        var exam = Queries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var html = '';
        html += '<form id="at-delete-exam-form">';
        html += '<div class="modal-header">';
        html += '<h3>Delete Exam</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' + escapeHtml(exam.name || 'this exam') +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'All rounds, matches, and results will be removed.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Exam</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';

        openModal('at-delete-exam-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-delete-exam-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var Core = window.TournamentCore;
                if (!Core) { return; }

                Core.deleteTournament(examId).then(function(result) {
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
    // TOGGLE POOL MEMBER
    // ============================================================

    function togglePoolMember(examId, participantId) {
        if (!checkDependencies()) { return; }
        if (!examId || !participantId) { return; }

        var Queries = window.TournamentQueries;
        var Core = window.TournamentCore;
        if (!Queries || !Core) { return; }

        var exam = Queries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var inExam = Queries.isParticipantInTournament(examId, participantId);

        if (inExam) {
            Core.removeParticipant(examId, participantId).then(function(result) {
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

        Core.addParticipant(examId, {
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
    // ADD ROUND
    // ============================================================

    function addRound(examId) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var Queries = window.TournamentQueries;
        var exam = Queries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var isTeamMode = exam.mode === 'teams';

        var html = '';
        html += '<form id="at-add-round-form">';
        html += '<div class="modal-header">';
        html += '<h3>Add Round</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="at-round-type">Match Type</label>';
        html += '<select id="at-round-type" class="at-round-type">';
        if (isTeamMode) {
            html += '<option value="team_vs_team" selected>Team Match</option>';
        } else {
            html += '<option value="group_exam" selected>Group Exam</option>';
            html += '<option value="pair_exam">Pair Exam</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="at-round-size">Participants per Match</label>';
        html += '<input type="number" id="at-round-size" class="at-round-size" ' +
                    'value="2" min="2" max="20">';
        html += '<p class="field-hint">' +
                    'For pairs, this value is ignored. ' +
                    'For team matches, this is the number of teams per match.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Add Round</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        openModal('at-add-round-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-add-round-form');
            if (!form) { return; }

            var typeSelect = form.querySelector('.at-round-type');
            var sizeInput = form.querySelector('.at-round-size');
            if (typeSelect && sizeInput) {
                typeSelect.addEventListener('change', function() {
                    var isPair = typeSelect.value === 'pair_exam';
                    sizeInput.disabled = isPair;
                    if (isPair) {
                        sizeInput.value = '2';
                    }
                });
            }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var type = typeSelect ? typeSelect.value : 'group_exam';
                var size = sizeInput ? parseInt(sizeInput.value, 10) || 2 : 2;
                var isPairExam = type === 'pair_exam';

                var matchType = isPairExam ? 'group_exam' : type;
                if (!isTeamMode && type === 'group_exam') {
                    matchType = 'group_exam';
                }

                var Core = window.TournamentCore;
                Core.addRound(examId, {
                    matchSize: isPairExam ? 2 : size,
                    matchType: matchType,
                    isPairExam: isPairExam
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

    // ============================================================
    // REMOVE ROUND
    // ============================================================

    function removeRound(examId, roundIndex) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var idx = parseInt(roundIndex, 10);
        if (isNaN(idx) || idx < 0) { return; }

        var html = '';
        html += '<form id="at-remove-round-form">';
        html += '<div class="modal-header">';
        html += '<h3>Remove Round</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Remove <strong>Round ' + (idx + 1) + '</strong> and all its matches?</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Remove Round</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';

        openModal('at-remove-round-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-remove-round-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var Core = window.TournamentCore;
                Core.removeRound(examId, idx).then(function(result) {
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
    // AUTO-GENERATE ROUND
    // ============================================================

    function autoGenerateRound(examId, roundIndex) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var idx = parseInt(roundIndex, 10);
        if (isNaN(idx) || idx < 0) { return; }

        var Queries = window.TournamentQueries;
        var Matches = window.TournamentMatches;
        if (!Queries || !Matches) { return; }

        var exam = Queries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var round = Queries.getRound(examId, idx);
        if (!round) {
            notify('Round not found.', 'error');
            return;
        }

        var eligible = Matches.getEligibleParticipants(examId);
        var alreadyInRound = {};
        if (Array.isArray(round.matches)) {
            for (var m = 0; m < round.matches.length; m++) {
                var match = round.matches[m];
                if (match && Array.isArray(match.participants)) {
                    for (var p = 0; p < match.participants.length; p++) {
                        alreadyInRound[String(match.participants[p])] = true;
                    }
                }
            }
        }

        var available = eligible.filter(function(id) {
            return !alreadyInRound[id];
        });

        var defaultSize = round.matchSize || 2;
        var isPairExam = round.isPairExam === true;

        var previewCount = 0;
        if (isPairExam) {
            previewCount = Math.ceil(available.length / 2);
            if (available.length % 2 === 1 && available.length >= 3) {
                previewCount = Math.floor((available.length - 3) / 2) + 1;
            }
        } else {
            previewCount = Math.floor(available.length / defaultSize);
        }

        var html = '';
        html += '<form id="at-auto-generate-form">';
        html += '<div class="modal-header">';
        html += '<h3>Auto-Generate Round ' + (idx + 1) + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';

        html += '<p class="at-auto-info">' +
                    'Eligible participants (not eliminated, not already in a match this round): ' +
                    '<strong>' + available.length + '</strong>' +
                '</p>';

        if (!isPairExam) {
            html += '<div class="form-group">';
            html += '<label for="at-auto-match-size">Participants per Match</label>';
            html += '<input type="number" id="at-auto-match-size" ' +
                        'class="at-auto-match-size" ' +
                        'value="' + escapeAttribute(String(defaultSize)) + '" ' +
                        'min="2" max="20">';
            html += '</div>';
        } else {
            html += '<p class="at-auto-info">' +
                        'Pair exams group participants into pairs of 2 ' +
                        '(or one triple of 3 for odd counts).' +
                    '</p>';
        }

        html += '<p class="at-auto-preview" id="at-auto-preview">' +
                    'Will create approximately <strong>' + previewCount +
                    '</strong> match' + (previewCount === 1 ? '' : 'es') + '.' +
                '</p>';

        if (available.length < 2) {
            html += '<p class="at-auto-warning">' +
                        'Not enough eligible participants to generate a match.' +
                    '</p>';
        }

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary"' +
                    (available.length < 2 ? ' disabled' : '') +
                    '>Generate</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        openModal('at-auto-generate-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-auto-generate-form');
            if (!form) { return; }

            var sizeInput = form.querySelector('.at-auto-match-size');
            var previewEl = form.querySelector('#at-auto-preview');

            if (sizeInput && previewEl) {
                sizeInput.addEventListener('input', function() {
                    var size = parseInt(sizeInput.value, 10) || 2;
                    if (size < 2) { size = 2; }
                    var count = Math.floor(available.length / size);
                    previewEl.innerHTML = 'Will create approximately ' +
                        '<strong>' + count + '</strong> match' +
                        (count === 1 ? '' : 'es') + '.';
                });
            }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var matchSize = isPairExam
                    ? 2
                    : (sizeInput ? parseInt(sizeInput.value, 10) || 2 : 2);

                Matches.generateMatches(examId, idx, {
                    matchSize: matchSize
                }).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                    // On failure, pipeline has already notified.
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] generateMatches failed:', err);
                    notify('Failed to auto-generate matches.', 'error');
                });
            });
        });
    }

    // ============================================================
    // ADD MATCH (MANUAL)
    // ============================================================

    function addMatchManual(examId, roundIndex) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var idx = parseInt(roundIndex, 10);
        if (isNaN(idx) || idx < 0) { return; }

        var Queries = window.TournamentQueries;
        var Matches = window.TournamentMatches;
        if (!Queries || !Matches) { return; }

        var exam = Queries.getTournament(examId);
        if (!exam) {
            notify('Exam not found.', 'error');
            return;
        }

        var round = Queries.getRound(examId, idx);
        if (!round) {
            notify('Round not found.', 'error');
            return;
        }

        var mode = exam.mode || 'individuals';
        var matchType = round.matchType || 'group_exam';
        var isPairExam = round.isPairExam === true;
        var matchSize = round.matchSize || 2;

        var eligible = Matches.getEligibleParticipants(examId);
        var alreadyInRound = {};
        if (Array.isArray(round.matches)) {
            for (var m = 0; m < round.matches.length; m++) {
                var match = round.matches[m];
                if (match && Array.isArray(match.participants)) {
                    for (var p = 0; p < match.participants.length; p++) {
                        alreadyInRound[String(match.participants[p])] = true;
                    }
                }
            }
        }

        var available = eligible.filter(function(id) {
            return !alreadyInRound[id];
        });

        var html = '';
        html += '<form id="at-add-match-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '" ' +
                    'data-round-index="' + escapeAttribute(String(idx)) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Add Match \u2014 Round ' + (idx + 1) + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        if (isPairExam) {
            html += renderPairPicker(available, matchSize);
        } else {
            html += renderParticipantPicker(available, matchSize, mode);
        }

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Add Match</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        openModal('at-add-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-add-match-form');
            if (!form) { return; }

            if (isPairExam) {
                bindPairPicker(form);
            }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var participants = [];
                var pairings = null;

                if (isPairExam) {
                    var selected = collectPairPicker(form);
                    if (!selected || selected.length === 0) {
                        notify('Please select at least one pair.', 'error');
                        return;
                    }
                    for (var i = 0; i < selected.length; i++) {
                        for (var j = 0; j < selected[i].length; j++) {
                            participants.push(selected[i][j]);
                        }
                    }
                    pairings = selected;
                } else {
                    participants = collectParticipantPicker(form);
                }

                if (participants.length < 2) {
                    notify('Please select at least 2 participants.', 'error');
                    return;
                }

                var payload = {
                    participants: participants,
                    type: matchType
                };

                if (isPairExam) {
                    payload.isPairExam = true;
                    payload.pairings = pairings;
                }

                Matches.createMatch(examId, idx, payload).then(function(result) {
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

    function renderParticipantPicker(available, matchSize, mode) {
        var html = '';
        html += '<div class="at-picker" data-match-size="' +
                    escapeAttribute(String(matchSize)) + '">';

        html += '<p class="at-picker-hint">' +
                    'Select exactly <strong>' + matchSize + '</strong> ' +
                    (mode === 'teams' ? 'teams' : 'characters') + '.' +
                '</p>';

        if (available.length === 0) {
            html += '<p class="empty-state small">No eligible participants.</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="at-picker-list">';
        for (var i = 0; i < available.length; i++) {
            var id = available[i];
            var name = getParticipantDisplayNameForPool(id, mode);
            html += '<label class="at-picker-item">' +
                        '<input type="checkbox" class="at-picker-check" ' +
                            'value="' + escapeAttribute(id) + '">' +
                        '<span>' + escapeHtml(name) + '</span>' +
                    '</label>';
        }
        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderPairPicker(available) {
        var html = '';
        html += '<div class="at-pair-picker">';

        html += '<p class="at-picker-hint">' +
                    'Add pairs or triples of participants. Each pair works together.' +
                '</p>';

        if (available.length < 2) {
            html += '<p class="empty-state small">' +
                        'Need at least 2 eligible participants.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div id="at-pair-builder">';
        html += '<div class="at-pair-inputs">';
        html += '<select class="at-pair-select at-pair-select-1">';
        html += '<option value="">Select participant...</option>';
        for (var i = 0; i < available.length; i++) {
            var id = available[i];
            html += '<option value="' + escapeAttribute(id) + '">' +
                        escapeHtml(getParticipantDisplayNameForPool(id, 'individuals')) +
                    '</option>';
        }
        html += '</select>';

        html += '<select class="at-pair-select at-pair-select-2">';
        html += '<option value="">Select participant...</option>';
        for (var j = 0; j < available.length; j++) {
            var id2 = available[j];
            html += '<option value="' + escapeAttribute(id2) + '">' +
                        escapeHtml(getParticipantDisplayNameForPool(id2, 'individuals')) +
                    '</option>';
        }
        html += '</select>';

        html += '<select class="at-pair-select at-pair-select-3">';
        html += '<option value="">(optional 3rd)</option>';
        for (var k = 0; k < available.length; k++) {
            var id3 = available[k];
            html += '<option value="' + escapeAttribute(id3) + '">' +
                        escapeHtml(getParticipantDisplayNameForPool(id3, 'individuals')) +
                    '</option>';
        }
        html += '</select>';

        html += '<button type="button" class="small secondary at-pair-add">+ Add</button>';
        html += '</div>';

        html += '<div class="at-pair-list"></div>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function bindPairPicker(form) {
        var listEl = form.querySelector('.at-pair-list');
        var addBtn = form.querySelector('.at-pair-add');
        var select1 = form.querySelector('.at-pair-select-1');
        var select2 = form.querySelector('.at-pair-select-2');
        var select3 = form.querySelector('.at-pair-select-3');

        if (!listEl || !addBtn) { return; }

        addBtn.addEventListener('click', function() {
            var v1 = select1 ? select1.value : '';
            var v2 = select2 ? select2.value : '';
            var v3 = select3 ? select3.value : '';

            if (!v1 || !v2) {
                notify('Please select at least 2 participants for the pair.', 'error');
                return;
            }

            if (v1 === v2 || (v3 && (v3 === v1 || v3 === v2))) {
                notify('Participants in a pair must be distinct.', 'error');
                return;
            }

            var group = [v1, v2];
            if (v3) { group.push(v3); }

            var row = document.createElement('div');
            row.className = 'at-pair-row';
            var names = group.map(function(id) {
                return getParticipantDisplayNameForPool(id, 'individuals');
            }).join(' + ');

            row.innerHTML =
                '<span class="at-pair-row-text">' + escapeHtml(names) + '</span>' +
                '<button type="button" class="small danger at-pair-remove">\u2715</button>';
            row.dataset.pair = JSON.stringify(group);

            var removeBtn = row.querySelector('.at-pair-remove');
            if (removeBtn) {
                removeBtn.addEventListener('click', function() {
                    row.parentNode.removeChild(row);
                });
            }

            listEl.appendChild(row);

            if (select1) { select1.value = ''; }
            if (select2) { select2.value = ''; }
            if (select3) { select3.value = ''; }
        });
    }

    function collectPairPicker(form) {
        var rows = form.querySelectorAll('.at-pair-row');
        var pairs = [];
        for (var i = 0; i < rows.length; i++) {
            try {
                var pair = JSON.parse(rows[i].dataset.pair || '[]');
                if (Array.isArray(pair) && pair.length >= 2) {
                    pairs.push(pair);
                }
            } catch (e) {
                // Ignore malformed
            }
        }
        return pairs;
    }

    function collectParticipantPicker(form) {
        var checks = form.querySelectorAll('.at-picker-check');
        var ids = [];
        for (var i = 0; i < checks.length; i++) {
            if (checks[i].checked) {
                ids.push(checks[i].value);
            }
        }
        return ids;
    }

    function getParticipantDisplayNameForPool(participantId, mode) {
        if (mode === 'teams') {
            var TeamQueries = window.TeamQueries;
            if (TeamQueries && typeof TeamQueries.getTeamById === 'function') {
                var team = TeamQueries.getTeamById(participantId);
                if (team) { return team.name || 'Unknown Team'; }
            }
            return 'Unknown Team';
        }

        var CharacterQueries = window.CharacterQueries;
        if (CharacterQueries && typeof CharacterQueries.getCharacterById === 'function') {
            var char = CharacterQueries.getCharacterById(participantId);
            if (char) { return CharacterQueries.getDisplayName(char); }
        }
        return 'Unknown';
    }

    // ============================================================
    // EDIT MATCH
    // ============================================================

    function editMatch(examId, roundIndex, matchIndex) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var idx = parseInt(roundIndex, 10);
        var mIdx = parseInt(matchIndex, 10);
        if (isNaN(idx) || isNaN(mIdx)) { return; }

        var Queries = window.TournamentQueries;
        var Matches = window.TournamentMatches;
        if (!Queries || !Matches) { return; }

        var match = Queries.getMatch(examId, idx, mIdx);
        if (!match) {
            notify('Match not found.', 'error');
            return;
        }

        var exam = Queries.getTournament(examId);
        var mode = exam ? exam.mode : 'individuals';
        var matchType = match.type || 'group_exam';
        var isPairExam = match.isPairExam === true;

        var eligible = Queries.getParticipants(examId).filter(function(p) {
            return !Queries.isParticipantEliminated(examId, p.id);
        }).map(function(p) { return p.id; });

        var currentIds = Array.isArray(match.participants)
            ? match.participants.slice()
            : [];

        var html = '';
        html += '<form id="at-edit-match-form">';
        html += '<div class="modal-header">';
        html += '<h3>Edit Match</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';

        html += '<p class="at-picker-hint">' +
                    'Current match is a ' +
                    escapeHtml(getMatchTypeLabelLocal(matchType, isPairExam)) +
                    '. Select new participants.' +
                '</p>';

        if (eligible.length === 0) {
            html += '<p class="empty-state small">No eligible participants.</p>';
        } else {
            html += '<div class="at-picker-list">';
            for (var i = 0; i < eligible.length; i++) {
                var id = eligible[i];
                var isChecked = currentIds.indexOf(String(id)) !== -1;
                var name = getParticipantDisplayNameForPool(id, mode);
                html += '<label class="at-picker-item">' +
                            '<input type="checkbox" class="at-picker-check" ' +
                                'value="' + escapeAttribute(id) + '"' +
                                (isChecked ? ' checked' : '') + '>' +
                            '<span>' + escapeHtml(name) + '</span>' +
                        '</label>';
            }
            html += '</div>';
        }

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Save Changes</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        openModal('at-edit-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-edit-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var newIds = collectParticipantPicker(form);
                if (newIds.length < 2) {
                    notify('Please select at least 2 participants.', 'error');
                    return;
                }

                var payload = {
                    participants: newIds
                };

                if (isPairExam) {
                    payload.pairings = [];
                }

                Matches.updateMatch(examId, idx, mIdx, payload).then(function(result) {
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

    function getMatchTypeLabelLocal(type, isPairExam) {
        if (isPairExam) { return 'Pair Exam'; }
        if (type === 'team_vs_team') { return 'Team Match'; }
        if (type === 'group_exam') { return 'Group Exam'; }
        return 'Standard';
    }

    // ============================================================
    // COMPLETE MATCH
    // ============================================================

    function completeMatch(examId, roundIndex, matchIndex) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var idx = parseInt(roundIndex, 10);
        var mIdx = parseInt(matchIndex, 10);
        if (isNaN(idx) || isNaN(mIdx)) { return; }

        var Queries = window.TournamentQueries;
        var Matches = window.TournamentMatches;
        if (!Queries || !Matches) { return; }

        var match = Queries.getMatch(examId, idx, mIdx);
        if (!match) {
            notify('Match not found.', 'error');
            return;
        }

        var exam = Queries.getTournament(examId);
        var mode = exam ? exam.mode : 'individuals';
        var matchType = match.type || 'group_exam';

        var html = '';
        html += '<form id="at-complete-match-form">';
        html += '<div class="modal-header">';
        html += '<h3>Complete Match</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';

        if (matchType === 'team_vs_team') {
            html += renderTeamCompletionBody(match, mode);
        } else {
            html += renderGroupCompletionBody(match, mode);
        }

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Complete Match</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        openModal('at-complete-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-complete-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                if (matchType === 'team_vs_team') {
                    var payload = collectTeamCompletionResult(form);
                    if (!payload) { return; }

                    Matches.completeMatch(examId, idx, mIdx, payload).then(function(result) {
                        if (result && result.success) {
                            close();
                            notifyChange();
                        }
                    }).catch(function(err) {
                        console.warn('[AcademyExams] completeMatch failed:', err);
                        notify('Failed to complete match.', 'error');
                    });
                } else {
                    var results = collectGroupCompletionResult(form);
                    if (!results) { return; }

                    Matches.completeMatch(examId, idx, mIdx, {
                        results: results
                    }).then(function(result) {
                        if (result && result.success) {
                            close();
                            notifyChange();
                        }
                    }).catch(function(err) {
                        console.warn('[AcademyExams] completeMatch failed:', err);
                        notify('Failed to complete match.', 'error');
                    });
                }
            });
        });
    }

    function renderGroupCompletionBody(match, mode) {
        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];

        var html = '';
        html += '<p class="at-picker-hint">' +
                    'Set the result for each participant. Default is Pass.' +
                '</p>';

        if (participants.length === 0) {
            html += '<p class="empty-state small">This match has no participants.</p>';
            return html;
        }

        html += '<div class="at-completion-list">';
        for (var i = 0; i < participants.length; i++) {
            var pid = participants[i];
            var name = getParticipantDisplayNameForPool(pid, mode);
            html += '<div class="at-completion-row" ' +
                        'data-participant-id="' + escapeAttribute(pid) + '">';
            html += '<span class="at-completion-name">' +
                        escapeHtml(name) +
                    '</span>';
            html += renderResultSelect('result_' + pid, 'pass');
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function collectGroupCompletionResult(form) {
        var rows = form.querySelectorAll('.at-completion-row');
        var results = {};

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var pid = row.dataset.participantId;
            if (!pid) { continue; }
            var select = row.querySelector('.at-result-select');
            var value = select ? select.value : 'pass';
            results[pid] = value;
        }

        if (Object.keys(results).length === 0) {
            notify('No participants to complete.', 'error');
            return null;
        }

        return results;
    }

    function renderTeamCompletionBody(match, mode) {
        var teams = Array.isArray(match.participants) ? match.participants : [];

        var html = '';
        html += '<p class="at-picker-hint">' +
                    'Set the result for each team and each member. ' +
                    'All default to Pass.' +
                '</p>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">This match has no teams.</p>';
            return html;
        }

        html += '<div class="at-team-completion-list">';
        for (var i = 0; i < teams.length; i++) {
            var teamId = teams[i];
            var teamName = getParticipantDisplayNameForPool(teamId, 'teams');

            html += '<div class="at-team-completion-group" ' +
                        'data-team-id="' + escapeAttribute(teamId) + '">';

            html += '<div class="at-team-completion-team-row">';
            html += '<span class="at-team-completion-name">' +
                        escapeHtml(teamName) +
                    '</span>';
            html += renderResultSelect('team_result_' + teamId, 'pass');
            html += '</div>';

            var TeamQueries = window.TeamQueries;
            var team = TeamQueries && typeof TeamQueries.getTeamById === 'function'
                ? TeamQueries.getTeamById(teamId)
                : null;

            if (team && Array.isArray(team.members) && team.members.length > 0) {
                html += '<div class="at-team-completion-members">';
                for (var j = 0; j < team.members.length; j++) {
                    var member = team.members[j];
                    if (!member || !member.characterId) { continue; }
                    var charName = getParticipantDisplayNameForPool(
                        member.characterId, 'individuals'
                    );
                    html += '<div class="at-team-completion-member-row" ' +
                                'data-character-id="' +
                                    escapeAttribute(member.characterId) + '">';
                    html += '<span class="at-team-completion-member-name">' +
                                escapeHtml(charName) +
                            '</span>';
                    html += renderResultSelect(
                        'member_result_' + member.characterId,
                        'pass'
                    );
                    html += '</div>';
                }
                html += '</div>';
            }

            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function collectTeamCompletionResult(form) {
        var teamGroups = form.querySelectorAll('.at-team-completion-group');
        var teamResults = {};
        var individualResults = {};

        for (var i = 0; i < teamGroups.length; i++) {
            var group = teamGroups[i];
            var teamId = group.dataset.teamId;
            if (!teamId) { continue; }

            var teamSelect = group.querySelector('.at-team-completion-team-row .at-result-select');
            teamResults[teamId] = teamSelect ? teamSelect.value : 'pass';

            var memberRows = group.querySelectorAll('.at-team-completion-member-row');
            for (var j = 0; j < memberRows.length; j++) {
                var mRow = memberRows[j];
                var charId = mRow.dataset.characterId;
                if (!charId) { continue; }
                var memberSelect = mRow.querySelector('.at-result-select');
                individualResults[charId] = memberSelect ? memberSelect.value : 'pass';
            }
        }

        if (Object.keys(teamResults).length === 0) {
            notify('No teams to complete.', 'error');
            return null;
        }

        return {
            teamResults: teamResults,
            individualResults: individualResults
        };
    }

    // ============================================================
    // REMOVE MATCH
    // ============================================================

    function removeMatch(examId, roundIndex, matchIndex) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var idx = parseInt(roundIndex, 10);
        var mIdx = parseInt(matchIndex, 10);
        if (isNaN(idx) || isNaN(mIdx)) { return; }

        var html = '';
        html += '<form id="at-remove-match-form">';
        html += '<div class="modal-header">';
        html += '<h3>Remove Match</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Remove this match from Round ' + (idx + 1) + '?</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Remove Match</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';

        openModal('at-remove-match-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#at-remove-match-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var Matches = window.TournamentMatches;
                Matches.removeMatch(examId, idx, mIdx).then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyTournamentEvents] removeMatch failed:', err);
                    notify('Failed to remove match.', 'error');
                });
            });
        });
    }

    // ============================================================
    // COMPLETE EXAM
    // ============================================================

    function completeExam(examId) {
        if (!checkDependencies()) { return; }
        if (!examId) { return; }

        var Core = window.TournamentCore;
        Core.completeTournament(examId, true).then(function(result) {
            if (result && result.success) {
                notifyChange();
            }
            // On failure, pipeline already notified.
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
            'createExam', 'deleteExam', 'togglePoolMember',
            'addRound', 'removeRound', 'autoGenerateRound',
            'addMatchManual', 'editMatch', 'completeMatch', 'removeMatch',
            'completeExam'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyTournamentEvents] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
