/**
 * modules/academy/academy-tournament-view.js - Academy Tournament (Exams) View
 * Pure renderer for the Academy-embedded Exams view.
 *
 * Path: js/modules/academy/academy-tournament-view.js
 *
 * This module is responsible for:
 *   - Rendering the top bar (class + week selectors)
 *   - Rendering the left pool panel: eligible participants for the
 *     week (characters or teams, mode-dependent)
 *   - Rendering the right exam panel: exam header, rounds, matches,
 *     and final passers
 *   - Rendering each match with pass/fail/retry badges
 *   - Rendering pair exams with visual pair groupings
 *   - Rendering team matches with team-level + member-level results
 *   - Rendering empty states: no class, no exam, no rounds, no matches
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Does NOT fetch data. Receives a view model from AcademyView.
 *   - Does NOT bind events. Emits data-* attributes that AcademyView's
 *     delegated container listeners resolve.
 *   - Uses DomUtils for escaping (mandatory, no fallbacks).
 *   - Returns an HTML string.
 *
 * LABEL SEMANTICS:
 *   - Where a label describes a specific form control, it is a
 *     <label for="..."> bound to that control's id.
 *   - Where the text sits beside a control but is not bound to it
 *     (e.g. a "Week:" caption next to a number input), it is a
 *     <span class="academy-top-label">. Using <label> without a
 *     `for` and without a wrapped control was a screen-reader
 *     problem; it is fixed here.
 *
 * VM LABELS:
 *   The view reads display text from the view model whenever the VM
 *   provides it:
 *     - exam.statusLabel            (falls back to exam.status)
 *     - exam.modeLabel              (falls back to a derived label)
 *     - round.statusLabel           (falls back to round.status)
 *     - match.statusLabel           (falls back to match.status)
 *     - match.typeLabel             (falls back to a derived label)
 *   The view does NOT re-map enum strings to display strings. That
 *   mapping belongs to the aggregator. If the VM omits a label, the
 *   view renders the raw value, which is the truthful fallback.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful
 *   - 'fail'  : not advanced; eliminated
 *
 * INTERFACE:
 *   AcademyTournamentView.renderHTML(viewModel) -> string
 *
 *   viewModel:
 *     {
 *       classes:   [ { id, name } ],
 *       classId:   string | null,
 *       className: string | null,
 *       week:      number,
 *       exam: <examVM> | null,
 *       pool: [ { id, name, subtitle, inExam, eliminated } ]
 *     }
 *
 *   examVM:
 *     {
 *       id, name, status, statusLabel, mode, modeLabel,
 *       participantCount, roundCount, totalRounds,
 *       finalPassers: [ { id, name, type } ],
 *       finalPasserCount,
 *       rounds: [ {
 *         index, roundNumber, status, statusLabel,
 *         matchSize, matchType, matchTypeLabel,
 *         isPairExam,
 *         matches: [ <matchVM> ]
 *       } ]
 *     }
 *
 *   matchVM:
 *     {
 *       index, id, type, typeLabel, status, statusLabel,
 *       isPairExam, isGroupExam, isTeamMatch, isComplete,
 *       participantCount,
 *       participants: [ <participantVM> ],     // for group_exam/pair_exam
 *       pairings: [ [ <participantVM> ] ],     // for pair exams
 *       teams: [ <teamVM> ]                     // for team_vs_team
 *     }
 *
 *   participantVM:
 *     { id, name, type, typeLabel, result, resultCategory,
 *       outcomeDisplay: { text, class, label },
 *       isPassing, isRetrying, isFailing }
 *
 *   teamVM:
 *     { teamId, name, result, resultCategory,
 *       outcomeDisplay: { text, class, label },
 *       isPassing, isRetrying, isFailing,
 *       members: [ <memberVM> ], memberCount }
 *
 *   memberVM:
 *     { characterId, name, role, result, resultCategory,
 *       outcomeDisplay, isPassing, isRetrying, isFailing }
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   - #at-class-select (change)
 *   - #at-week-input   (change / Enter)
 *   - [data-action="create-exam"]
 *   - [data-action="delete-exam"]
 *   - [data-action="add-round"]
 *   - [data-action="remove-round"] [data-round-index]
 *   - [data-action="auto-generate-round"] [data-round-index]
 *   - [data-action="add-match"] [data-round-index]
 *   - [data-action="edit-match"] [data-round-index] [data-match-index]
 *   - [data-action="complete-match"] [data-round-index] [data-match-index]
 *   - [data-action="remove-match"] [data-round-index] [data-match-index]
 *   - [data-action="toggle-pool-member"] [data-pool-id]
 *   - [data-action="complete-exam"]
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *
 * USAGE:
 *   var html = AcademyTournamentView.renderHTML(vm);
 *   container.innerHTML = html;
 */

(function() {
    'use strict';

    if (window.__academyTournamentViewLoaded) {
        return;
    }
    window.__academyTournamentViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }

        if (missing.length > 0) {
            console.warn('[AcademyTournamentView] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // ESCAPING HELPERS - Mandatory, no fallbacks
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
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

    function getExamStatusClass(status) {
        switch (status) {
            case 'draft':     return 'at-exam-status at-exam-status-draft';
            case 'active':    return 'at-exam-status at-exam-status-active';
            case 'completed': return 'at-exam-status at-exam-status-completed';
            default:          return 'at-exam-status at-exam-status-unknown';
        }
    }

    function getParticipantOutcomeClass(vm) {
        if (!vm) { return 'at-participant at-participant-pending'; }
        if (vm.isPassing) { return 'at-participant at-participant-pass'; }
        if (vm.isRetrying) { return 'at-participant at-participant-retry'; }
        if (vm.isFailing) { return 'at-participant at-participant-fail'; }
        return 'at-participant at-participant-pending';
    }

    function getTeamOutcomeClass(vm) {
        if (!vm) { return 'at-team at-team-pending'; }
        if (vm.isPassing) { return 'at-team at-team-pass'; }
        if (vm.isRetrying) { return 'at-team at-team-retry'; }
        if (vm.isFailing) { return 'at-team at-team-fail'; }
        return 'at-team at-team-pending';
    }

    // Renders an outcome badge from the participant or team VM's
    // outcomeDisplay object. The VM supplies text, class, and label.
    // If the VM omits outcomeDisplay, we render a neutral "?" badge
    // rather than inventing a value.
    function renderOutcomeBadge(vm) {
        if (!vm || !vm.outcomeDisplay) {
            return '<span class="at-outcome-badge at-outcome-unknown">?</span>';
        }
        var display = vm.outcomeDisplay;
        var cls = 'at-outcome-badge ' +
            (display.class || 'outcome-unknown');
        var label = isNonEmptyString(display.label) ? display.label : '?';
        var text = isNonEmptyString(display.text) ? display.text : label;
        return '<span class="' + escapeAttribute(cls) + '" title="' +
                    escapeAttribute(label) + '">' +
                    escapeHtml(text) +
                '</span>';
    }

    // Resolve exam status display text. VM first, raw fallback.
    function resolveExamStatusLabel(exam) {
        if (!exam) { return ''; }
        if (isNonEmptyString(exam.statusLabel)) { return exam.statusLabel; }
        return exam.status || 'unknown';
    }

    // Resolve exam mode display text. VM first, derived fallback.
    function resolveExamModeLabel(exam) {
        if (!exam) { return ''; }
        if (isNonEmptyString(exam.modeLabel)) { return exam.modeLabel; }
        if (exam.mode === 'teams') { return 'Teams'; }
        if (exam.mode === 'individuals') { return 'Individuals'; }
        return '';
    }

    // Resolve round status display text. VM first, raw fallback.
    function resolveRoundStatusLabel(round) {
        if (!round) { return ''; }
        if (isNonEmptyString(round.statusLabel)) { return round.statusLabel; }
        return round.status || 'pending';
    }

    // Resolve match status display text. VM first, raw fallback.
    function resolveMatchStatusLabel(match) {
        if (!match) { return ''; }
        if (isNonEmptyString(match.statusLabel)) { return match.statusLabel; }
        return match.status || 'pending';
    }

    // Resolve match type display text. VM first, derived fallback.
    function resolveMatchTypeLabel(match) {
        if (!match) { return ''; }
        if (isNonEmptyString(match.typeLabel)) { return match.typeLabel; }
        if (match.isPairExam) { return 'Pair Exam'; }
        if (match.type === 'team_vs_team') { return 'Team Match'; }
        if (match.type === 'group_exam') { return 'Group Exam'; }
        if (match.type === 'standard') { return 'Standard'; }
        return match.type || '';
    }

    // ============================================================
    // RENDER - Top-level
    // ============================================================

    function renderHTML(viewModel) {
        if (!checkDependencies()) {
            return (
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">Exams view dependencies not loaded.</p>' +
                '</div>'
            );
        }

        var vm = viewModel || {};
        var classId = vm.classId || null;

        var html = '';
        html += '<div class="academy-body academy-exams-layout">';
        html += renderTopBar(vm);

        if (!classId) {
            html += '<div class="academy-exams-empty">' +
                        '<p class="empty-state small">Select a class to view its exam.</p>' +
                    '</div>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-exams-panels">';
        html += renderPoolPanel(vm);
        html += renderExamPanel(vm);
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // TOP BAR - Class + Week
    // ============================================================

    function renderTopBar(vm) {
        var classes = Array.isArray(vm.classes) ? vm.classes : [];
        var classId = vm.classId || null;
        var week = vm.week;

        var html = '';
        html += '<div class="academy-exams-top-bar">';

        // Class select. The <label> is bound to the select via `for`.
        html += '<div class="academy-exams-top-left">';
        html += '<label class="academy-top-label" for="at-class-select">Class:</label>';
        html += '<select id="at-class-select" class="academy-class-select">';
        html += '<option value="">Select a class...</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var selected = classId && String(classId) === String(cls.id)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' + selected + '>' +
                escapeHtml(cls.name || 'Unnamed Class') +
                '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Week input. The <label> is bound to the input via `for`.
        html += '<div class="academy-exams-top-right">';
        html += '<label class="academy-top-label" for="at-week-input">Week:</label>';
        html += '<input type="number" id="at-week-input" class="academy-week-input" ' +
            'value="' + escapeAttribute(String(week || 1)) + '" ' +
            'min="1" max="52">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // POOL PANEL - Left side
    // ============================================================
    //
    // The pool shows every eligible participant for the week. When an
    // exam exists, each pool item is toggleable. When no exam exists,
    // the pool is informational.

    function renderPoolPanel(vm) {
        var pool = Array.isArray(vm.pool) ? vm.pool : [];
        var exam = vm.exam;

        var title = 'Eligible This Week';
        var modeLabel = '';

        if (exam) {
            if (exam.mode === 'teams') {
                title = 'Teams This Week';
            } else if (exam.mode === 'individuals') {
                title = 'Characters This Week';
            }
            // Read the mode label from the VM rather than re-deriving.
            modeLabel = resolveExamModeLabel(exam);
            if (modeLabel) {
                modeLabel = modeLabel + ' exam';
            }
        }

        var html = '';
        html += '<div class="academy-exams-sidebar">';

        html += '<div class="academy-exams-sidebar-header">';
        html += '<h4 class="academy-exams-sidebar-title">' + escapeHtml(title) + '</h4>';
        if (modeLabel) {
            html += '<span class="academy-exams-sidebar-mode">' +
                        escapeHtml(modeLabel) +
                    '</span>';
        }
        html += '</div>';

        if (pool.length === 0) {
            html += '<p class="empty-state small">No eligible participants for this week.</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-exams-pool-list">';
        for (var i = 0; i < pool.length; i++) {
            html += renderPoolRow(pool[i], exam);
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderPoolRow(item, exam) {
        if (!item || !item.id) { return ''; }

        var inExam = item.inExam === true;
        var eliminated = item.eliminated === true;

        var classes = 'at-pool-row';
        if (inExam) { classes += ' in-exam'; }
        if (eliminated) { classes += ' eliminated'; }

        var html = '';
        html += '<div class="' + classes + '" ' +
                    'data-pool-id="' + escapeAttribute(item.id) + '">';

        html += '<div class="at-pool-row-main">';
        html += '<span class="at-pool-name">' +
                    escapeHtml(item.name || 'Unknown') +
                '</span>';
        if (exam && inExam) {
            html += '<span class="at-pool-badge at-pool-badge-in">In exam</span>';
        }
        if (eliminated) {
            html += '<span class="at-pool-badge at-pool-badge-elim">Eliminated</span>';
        }
        html += '</div>';

        if (isNonEmptyString(item.subtitle)) {
            html += '<div class="at-pool-subtitle">' +
                        escapeHtml(item.subtitle) +
                    '</div>';
        }

        if (exam && !eliminated) {
            html += '<div class="at-pool-actions">';
            html += '<button type="button" class="small ' +
                        (inExam ? 'secondary' : 'primary') + '" ' +
                        'data-action="toggle-pool-member" ' +
                        'data-pool-id="' + escapeAttribute(item.id) + '">' +
                        (inExam ? '\u2715 Remove' : '+ Add') +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXAM PANEL - Right side
    // ============================================================

    function renderExamPanel(vm) {
        var exam = vm.exam;
        var week = vm.week;

        var html = '';
        html += '<div class="academy-exams-detail">';

        if (!exam) {
            html += renderNoExamState(vm);
            html += '</div>';
            return html;
        }

        html += renderExamHeader(exam, week);
        html += renderExamRounds(exam, week);
        html += renderFinalPassers(exam);

        html += '</div>';
        return html;
    }

    function renderNoExamState(vm) {
        var html = '';
        html += '<div class="academy-exams-no-exam">';
        html += '<h3 class="academy-exams-no-exam-title">No Exam for Week ' +
                    escapeHtml(String(vm.week || '')) +
                '</h3>';
        html += '<p class="empty-state small">' +
                    'Create an exam to run eliminations for this class this week.' +
                '</p>';
        html += '<button type="button" class="primary" ' +
                    'data-action="create-exam">' +
                    '+ Create Exam' +
                '</button>';
        html += '</div>';
        return html;
    }

    function renderExamHeader(exam, week) {
        var statusClass = getExamStatusClass(exam.status);
        var statusLabel = resolveExamStatusLabel(exam);
        var modeLabel = resolveExamModeLabel(exam);

        var html = '';
        html += '<div class="academy-exams-detail-header">';

        // Title row
        html += '<div class="academy-exams-detail-title-row">';
        html += '<h3 class="academy-exams-detail-title">' +
                    escapeHtml(exam.name || 'Exam') +
                '</h3>';
        html += '<span class="' + statusClass + '">' +
                    escapeHtml(statusLabel) +
                '</span>';
        if (modeLabel) {
            html += '<span class="at-mode-badge">' +
                        escapeHtml(modeLabel) +
                    '</span>';
        }
        html += '</div>';

        // Meta row
        html += '<div class="academy-exams-detail-meta">';
        html += '<span class="at-meta-item">' +
                    '<span class="meta-label">Week:</span> ' +
                    escapeHtml(String(week)) +
                '</span>';
        html += '<span class="at-meta-item">' +
                    '<span class="meta-label">Participants:</span> ' +
                    escapeHtml(String(exam.participantCount || 0)) +
                '</span>';
        html += '<span class="at-meta-item">' +
                    '<span class="meta-label">Rounds:</span> ' +
                    escapeHtml(String(exam.roundCount || 0)) + ' / ' +
                    escapeHtml(String(exam.totalRounds || 1)) +
                '</span>';
        if (isFiniteNumber(exam.finalPasserCount) && exam.finalPasserCount > 0) {
            html += '<span class="at-meta-item at-meta-final">' +
                        '<span class="meta-label">Final Passers:</span> ' +
                        escapeHtml(String(exam.finalPasserCount)) +
                    '</span>';
        }
        html += '</div>';

        // Actions
        html += '<div class="academy-exams-detail-actions">';

        if (exam.status !== 'completed') {
            html += '<button type="button" class="small primary" ' +
                        'data-action="add-round">+ Add Round</button>';

            if (exam.roundCount > 0) {
                html += '<button type="button" class="small secondary" ' +
                            'data-action="complete-exam">Mark Completed</button>';
            }
        }

        html += '<button type="button" class="small danger" ' +
                    'data-action="delete-exam">Delete Exam</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // ROUNDS
    // ============================================================

    function renderExamRounds(exam, week) {
        var rounds = Array.isArray(exam.rounds) ? exam.rounds : [];

        var html = '';
        html += '<div class="academy-exams-rounds">';

        if (rounds.length === 0) {
            html += '<p class="empty-state small">' +
                        'No rounds yet. Add a round to start running matches.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < rounds.length; i++) {
            html += renderRound(rounds[i], exam);
        }

        html += '</div>';
        return html;
    }

    function renderRound(round, exam) {
        if (!round) { return ''; }

        var isExamComplete = exam.status === 'completed';
        var statusLabel = resolveRoundStatusLabel(round);

        var html = '';
        html += '<div class="at-round" ' +
                    'data-round-index="' + escapeAttribute(String(round.index)) + '">';

        // Round header
        html += '<div class="at-round-header">';
        html += '<div class="at-round-title">';
        html += '<strong>Round ' + escapeHtml(String(round.roundNumber)) + '</strong>';

        // Match-type badge. Prefer the VM's matchTypeLabel; fall back
        // to a derived label using the round's flags.
        var matchTypeLabel = isNonEmptyString(round.matchTypeLabel)
            ? round.matchTypeLabel
            : (round.isPairExam
                ? 'Pair Exam'
                : (round.matchType === 'team_vs_team'
                    ? 'Team Match'
                    : 'Group Exam'));

        var matchTypeClass = 'at-round-type';
        if (round.isPairExam) {
            matchTypeClass += ' at-round-pair';
        } else if (round.matchType === 'team_vs_team') {
            matchTypeClass += ' at-round-team';
        }

        html += ' <span class="' + matchTypeClass + '">' +
                    escapeHtml(matchTypeLabel) +
                '</span>';

        if (isFiniteNumber(round.matchSize) && round.matchSize > 0) {
            html += ' <span class="at-round-size">' +
                        escapeHtml(String(round.matchSize)) + '-way' +
                    '</span>';
        }

        var matchCount = Array.isArray(round.matches) ? round.matches.length : 0;
        html += ' <span class="at-round-count">' +
                    matchCount + ' match' + (matchCount === 1 ? '' : 'es') +
                '</span>';
        html += '</div>';

        if (!isExamComplete) {
            html += '<div class="at-round-actions">';
            html += '<button type="button" class="small secondary" ' +
                        'data-action="auto-generate-round" ' +
                        'data-round-index="' + escapeAttribute(String(round.index)) + '">' +
                        'Auto-Generate' +
                    '</button>';
            html += '<button type="button" class="small secondary" ' +
                        'data-action="add-match" ' +
                        'data-round-index="' + escapeAttribute(String(round.index)) + '">' +
                        '+ Match' +
                    '</button>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="remove-round" ' +
                        'data-round-index="' + escapeAttribute(String(round.index)) + '">' +
                        'Remove' +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';

        // Matches
        var matches = Array.isArray(round.matches) ? round.matches : [];
        if (matches.length === 0) {
            html += '<p class="empty-state small">No matches yet.</p>';
        } else {
            html += '<div class="at-matches">';
            for (var i = 0; i < matches.length; i++) {
                html += renderMatch(matches[i], round, isExamComplete);
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // MATCH
    // ============================================================

    function renderMatch(match, round, isExamComplete) {
        if (!match) { return ''; }

        var isEditable = !isExamComplete && !match.isComplete;
        var statusLabel = resolveMatchStatusLabel(match);

        var html = '';
        html += '<div class="at-match" ' +
                    'data-round-index="' + escapeAttribute(String(round.index)) + '" ' +
                    'data-match-index="' + escapeAttribute(String(match.index)) + '">';

        // Body — depends on match type
        if (match.isTeamMatch) {
            html += renderTeamMatchBody(match);
        } else if (match.isPairExam) {
            html += renderPairExamBody(match);
        } else {
            html += renderGroupExamBody(match);
        }

        // Footer: status + actions
        html += '<div class="at-match-footer">';

        html += '<span class="at-match-status at-match-status-' +
                    escapeAttribute(match.status || 'pending') + '">' +
                    escapeHtml(statusLabel) +
                '</span>';

        if (isEditable) {
            html += '<div class="at-match-actions">';
            html += '<button type="button" class="small secondary" ' +
                        'data-action="edit-match" ' +
                        'data-round-index="' + escapeAttribute(String(round.index)) + '" ' +
                        'data-match-index="' + escapeAttribute(String(match.index)) + '">' +
                        'Edit' +
                    '</button>';
            html += '<button type="button" class="small primary" ' +
                        'data-action="complete-match" ' +
                        'data-round-index="' + escapeAttribute(String(round.index)) + '" ' +
                        'data-match-index="' + escapeAttribute(String(match.index)) + '">' +
                        'Complete' +
                    '</button>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="remove-match" ' +
                        'data-round-index="' + escapeAttribute(String(round.index)) + '" ' +
                        'data-match-index="' + escapeAttribute(String(match.index)) + '">' +
                        'Remove' +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // Group exam body: flat list of participants with pass/fail/retry.
    function renderGroupExamBody(match) {
        var participants = Array.isArray(match.participants) ? match.participants : [];

        var html = '';
        html += '<div class="at-participants">';
        if (participants.length === 0) {
            html += '<span class="at-empty">No participants</span>';
        } else {
            for (var i = 0; i < participants.length; i++) {
                html += renderParticipantRow(participants[i]);
            }
        }
        html += '</div>';
        return html;
    }

    // Pair exam body: grouped pairs, with pass/fail/retry badges.
    function renderPairExamBody(match) {
        var pairings = Array.isArray(match.pairings) ? match.pairings : [];

        var html = '';
        if (pairings.length === 0) {
            return renderGroupExamBody(match);
        }

        html += '<div class="at-pairs">';
        for (var i = 0; i < pairings.length; i++) {
            html += '<div class="at-pair-group">';
            html += '<div class="at-pair-header">Pair ' + (i + 1) + '</div>';
            html += '<div class="at-pair-members">';
            var pair = pairings[i];
            for (var j = 0; j < pair.length; j++) {
                html += renderParticipantRow(pair[j]);
            }
            html += '</div>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    // Team match body: each team with its team-level result and
    // member sub-rows.
    function renderTeamMatchBody(match) {
        var teams = Array.isArray(match.teams) ? match.teams : [];

        var html = '';
        html += '<div class="at-teams">';
        for (var i = 0; i < teams.length; i++) {
            html += renderTeamBlock(teams[i]);
        }
        html += '</div>';
        return html;
    }

    function renderTeamBlock(team) {
        if (!team) { return ''; }

        var teamClass = getTeamOutcomeClass(team);

        var html = '';
        html += '<div class="' + teamClass + '">';

        // Team header
        html += '<div class="at-team-header">';
        html += '<span class="at-team-name">' +
                    escapeHtml(team.name || 'Unknown Team') +
                '</span>';
        html += renderOutcomeBadge(team);
        html += '</div>';

        // Members
        var members = Array.isArray(team.members) ? team.members : [];
        if (members.length > 0) {
            html += '<div class="at-team-members">';
            for (var i = 0; i < members.length; i++) {
                html += renderTeamMemberRow(members[i]);
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderTeamMemberRow(member) {
        if (!member) { return ''; }

        var cls = 'at-team-member';
        if (member.isPassing) { cls += ' at-team-member-pass'; }
        else if (member.isRetrying) { cls += ' at-team-member-retry'; }
        else if (member.isFailing) { cls += ' at-team-member-fail'; }

        var html = '';
        html += '<div class="' + cls + '">';
        html += '<span class="at-team-member-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';
        if (isNonEmptyString(member.role) && member.role !== 'Member') {
            html += '<span class="at-team-member-role">' +
                        escapeHtml(member.role) +
                    '</span>';
        }
        html += renderOutcomeBadge(member);
        html += '</div>';
        return html;
    }

    // Standard single participant row for group/pair exams.
    function renderParticipantRow(participant) {
        if (!participant) { return ''; }

        var cls = getParticipantOutcomeClass(participant);

        var html = '';
        html += '<div class="' + cls + '">';
        html += '<span class="at-participant-name">' +
                    escapeHtml(participant.name || 'Unknown') +
                '</span>';
        html += renderOutcomeBadge(participant);
        html += '</div>';
        return html;
    }

    // ============================================================
    // FINAL PASSERS SECTION
    // ============================================================

    function renderFinalPassers(exam) {
        var passers = Array.isArray(exam.finalPassers) ? exam.finalPassers : [];

        // Only render this section when the exam has at least one round.
        if (!Array.isArray(exam.rounds) || exam.rounds.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="at-final-passers-section">';
        html += '<div class="at-final-passers-header">';
        html += '<h4 class="at-final-passers-title">Final Passers</h4>';
        html += '<span class="at-final-passers-count">' + passers.length + '</span>';
        html += '</div>';

        if (passers.length === 0) {
            html += '<p class="empty-state small">No final passers recorded yet.</p>';
        } else {
            html += '<div class="at-final-passers-list">';
            for (var i = 0; i < passers.length; i++) {
                var p = passers[i];
                if (!p) { continue; }
                html += '<span class="at-final-passer-chip">' +
                            escapeHtml(p.name || 'Unknown') +
                            (isNonEmptyString(p.type) && p.type !== 'character'
                                ? ' <span class="at-final-passer-type">(' +
                                    escapeHtml(p.type) +
                                  ')</span>'
                                : '') +
                        '</span>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTournamentView = {
        renderHTML: renderHTML
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTournamentView;
        var missing = [];

        var required = ['renderHTML'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyTournamentView] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
