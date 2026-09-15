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
 *   - RENDER ONLY - no mutations, no domain logic.
 *   - Does NOT fetch data. Receives a view model from AcademyView.
 *   - Does NOT bind events. Emits data-* attributes that AcademyView's
 *     delegated container listeners resolve.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns an HTML string.
 *
 * LABEL SEMANTICS:
 *   The VM supplies display labels. The renderer prefers them:
 *     - exam.statusLabel
 *     - exam.modeLabel
 *     - round.statusLabel
 *     - round.matchTypeLabel
 *     - match.statusLabel
 *     - match.typeLabel
 *     - participant.outcomeDisplay
 *     - team.outcomeDisplay
 *     - member.outcomeDisplay
 *   Fallbacks to raw enum values exist only when the VM omits a label
 *   AND the raw value is a real value. The renderer never fabricates
 *   a label from empty input.
 *
 * ID SEMANTICS:
 *   Every exam-scoped action carries data-exam-id.
 *   Every round-scoped action carries data-round-id.
 *   Every match-scoped action carries data-match-id.
 *   The renderer does not use array indices as identity.
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
 *       week:      number | null,
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
 *       rounds: [ <roundVM> ]
 *     }
 *
 *   roundVM:
 *     {
 *       id,                       // stable round id
 *       index,                    // positional (for "Round N" display)
 *       roundNumber,
 *       status, statusLabel,
 *       matchSize, matchType, matchTypeLabel,
 *       isPairExam,
 *       matches: [ <matchVM> ]
 *     }
 *
 *   matchVM:
 *     {
 *       id,                       // stable match id
 *       index,
 *       type, typeLabel,
 *       status, statusLabel,
 *       isPairExam, isGroupExam, isTeamMatch, isComplete,
 *       participantCount,
 *       participants: [ <participantVM> ],
 *       pairings: [ [ <participantVM> ] ],
 *       teams: [ <teamVM> ]
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
 *   - [data-action="exam-create"]
 *   - [data-action="exam-delete"]
 *   - [data-action="exam-add-round"]
 *   - [data-action="exam-remove-round"]         [data-round-id]
 *   - [data-action="exam-auto-generate-round"]  [data-round-id]
 *   - [data-action="exam-add-match"]            [data-round-id]
 *   - [data-action="exam-edit-match"]           [data-round-id] [data-match-id]
 *   - [data-action="exam-complete-match"]       [data-round-id] [data-match-id]
 *   - [data-action="exam-remove-match"]         [data-round-id] [data-match-id]
 *   - [data-action="exam-toggle-pool-member"]   [data-pool-id]
 *   - [data-action="exam-complete"]
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

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyTournamentView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__academyTournamentViewLoaded = true;

    // ============================================================
    // ESCAPING HELPERS
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

    function renderOutcomeBadge(vm) {
        if (!vm || !vm.outcomeDisplay) {
            return '<span class="at-outcome-badge at-outcome-unknown">?</span>';
        }
        var display = vm.outcomeDisplay;
        var cls = 'at-outcome-badge ' + (display.class || 'outcome-unknown');
        var label = isNonEmptyString(display.label) ? display.label : '?';
        var text = isNonEmptyString(display.text) ? display.text : label;
        return '<span class="' + escapeAttribute(cls) + '" ' +
                    'title="' + escapeAttribute(label) + '">' +
                    escapeHtml(text) +
                '</span>';
    }

    function resolveExamStatusLabel(exam) {
        if (!exam) { return ''; }
        if (isNonEmptyString(exam.statusLabel)) { return exam.statusLabel; }
        return exam.status || 'unknown';
    }

    function resolveExamModeLabel(exam) {
        if (!exam) { return ''; }
        if (isNonEmptyString(exam.modeLabel)) { return exam.modeLabel; }
        if (exam.mode === 'teams') { return 'Teams'; }
        if (exam.mode === 'individuals') { return 'Individuals'; }
        return '';
    }

    function resolveRoundStatusLabel(round) {
        if (!round) { return ''; }
        if (isNonEmptyString(round.statusLabel)) { return round.statusLabel; }
        return round.status || 'pending';
    }

    function resolveMatchStatusLabel(match) {
        if (!match) { return ''; }
        if (isNonEmptyString(match.statusLabel)) { return match.statusLabel; }
        return match.status || 'pending';
    }

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
        var vm = viewModel || {};
        var classId = vm.classId || null;

        var html = '';
        html += '<div class="academy-body academy-exams-layout">';
        html += renderTopBar(vm);

        if (!classId) {
            html += '<div class="academy-exams-empty">' +
                        '<p class="empty-state small">' +
                            'Select a class to view its exam.' +
                        '</p>' +
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

        html += '<div class="academy-exams-top-left">';
        html += '<label class="academy-top-label" for="at-class-select">' +
                    'Class:' +
                '</label>';
        html += '<select id="at-class-select" class="academy-class-select">';
        html += '<option value="">Select a class...</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var selected = classId && String(classId) === String(cls.id)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        selected + '>' +
                        escapeHtml(cls.name || 'Unnamed Class') +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="academy-exams-top-right">';
        html += '<label class="academy-top-label" for="at-week-input">' +
                    'Week:' +
                '</label>';
        html += '<input type="number" id="at-week-input" ' +
                    'class="academy-week-input" ' +
                    'value="' + escapeAttribute(
                        isFiniteNumber(week) ? String(week) : ''
                    ) + '" ' +
                    'min="1" max="52">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // POOL PANEL - Left side
    // ============================================================

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
            modeLabel = resolveExamModeLabel(exam);
            if (modeLabel) {
                modeLabel = modeLabel + ' exam';
            }
        }

        var html = '';
        html += '<div class="academy-exams-sidebar">';

        html += '<div class="academy-exams-sidebar-header">';
        html += '<h4 class="academy-exams-sidebar-title">' +
                    escapeHtml(title) +
                '</h4>';
        if (modeLabel) {
            html += '<span class="academy-exams-sidebar-mode">' +
                        escapeHtml(modeLabel) +
                    '</span>';
        }
        html += '</div>';

        if (pool.length === 0) {
            html += '<p class="empty-state small">' +
                        'No eligible participants for this week.' +
                    '</p>';
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
            html += '<span class="at-pool-badge at-pool-badge-in">' +
                        'In exam' +
                    '</span>';
        }
        if (eliminated) {
            html += '<span class="at-pool-badge at-pool-badge-elim">' +
                        'Eliminated' +
                    '</span>';
        }
        html += '</div>';

        if (isNonEmptyString(item.subtitle)) {
            html += '<div class="at-pool-subtitle">' +
                        escapeHtml(item.subtitle) +
                    '</div>';
        }

        if (exam && !eliminated && exam.id) {
            html += '<div class="at-pool-actions">';
            html += '<button type="button" class="small ' +
                        (inExam ? 'secondary' : 'primary') + '" ' +
                        'data-action="exam-toggle-pool-member" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
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

        html += '<div class="academy-exams-detail-block" ' +
                    'data-exam-id="' + escapeAttribute(exam.id) + '">';
        html += renderExamHeader(exam, week);
        html += renderExamRounds(exam, week);
        html += renderFinalPassers(exam);
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderNoExamState(vm) {
        var weekDisplay = isFiniteNumber(vm.week) ? String(vm.week) : '';
        var html = '';
        html += '<div class="academy-exams-no-exam">';
        html += '<h3 class="academy-exams-no-exam-title">' +
                    'No Exam for Week ' + escapeHtml(weekDisplay) +
                '</h3>';
        html += '<p class="empty-state small">' +
                    'Create an exam to run eliminations for this class this week.' +
                '</p>';
        html += '<button type="button" class="primary" ' +
                    'data-action="exam-create">' +
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

        html += '<div class="academy-exams-detail-meta">';
        if (isFiniteNumber(week)) {
            html += '<span class="at-meta-item">' +
                        '<span class="meta-label">Week:</span> ' +
                        escapeHtml(String(week)) +
                    '</span>';
        }
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

        html += '<div class="academy-exams-detail-actions">';

        if (exam.status !== 'completed') {
            html += '<button type="button" class="small primary" ' +
                        'data-action="exam-add-round" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '">' +
                        '+ Add Round' +
                    '</button>';

            if (exam.roundCount > 0) {
                html += '<button type="button" class="small secondary" ' +
                            'data-action="exam-complete" ' +
                            'data-exam-id="' + escapeAttribute(exam.id) + '">' +
                            'Mark Completed' +
                        '</button>';
            }
        }

        html += '<button type="button" class="small danger" ' +
                    'data-action="exam-delete" ' +
                    'data-exam-id="' + escapeAttribute(exam.id) + '">' +
                    'Delete Exam' +
                '</button>';
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
                    'data-round-id="' + escapeAttribute(round.id || '') + '">';

        // Round header
        html += '<div class="at-round-header">';
        html += '<div class="at-round-title">';
        html += '<strong>Round ' +
                    escapeHtml(String(round.roundNumber || '')) +
                '</strong>';

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
                        'data-action="exam-auto-generate-round" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                        'data-round-id="' +
                            escapeAttribute(round.id || '') + '">' +
                        'Auto-Generate' +
                    '</button>';
            html += '<button type="button" class="small secondary" ' +
                        'data-action="exam-add-match" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                        'data-round-id="' +
                            escapeAttribute(round.id || '') + '">' +
                        '+ Match' +
                    '</button>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="exam-remove-round" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                        'data-round-id="' +
                            escapeAttribute(round.id || '') + '">' +
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
                html += renderMatch(matches[i], round, exam, isExamComplete);
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // MATCH
    // ============================================================

    function renderMatch(match, round, exam, isExamComplete) {
        if (!match) { return ''; }

        var isEditable = !isExamComplete && !match.isComplete;
        var statusLabel = resolveMatchStatusLabel(match);

        var html = '';
        html += '<div class="at-match" ' +
                    'data-round-id="' +
                        escapeAttribute(round.id || '') + '" ' +
                    'data-match-id="' +
                        escapeAttribute(match.id || '') + '">';

        if (match.isTeamMatch) {
            html += renderTeamMatchBody(match);
        } else if (match.isPairExam) {
            html += renderPairExamBody(match);
        } else {
            html += renderGroupExamBody(match);
        }

        html += '<div class="at-match-footer">';

        html += '<span class="at-match-status at-match-status-' +
                    escapeAttribute(match.status || 'pending') + '">' +
                    escapeHtml(statusLabel) +
                '</span>';

        if (isEditable) {
            html += '<div class="at-match-actions">';

            html += '<button type="button" class="small secondary" ' +
                        'data-action="exam-edit-match" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                        'data-round-id="' +
                            escapeAttribute(round.id || '') + '" ' +
                        'data-match-id="' +
                            escapeAttribute(match.id || '') + '">' +
                        'Edit' +
                    '</button>';

            html += '<button type="button" class="small primary" ' +
                        'data-action="exam-complete-match" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                        'data-round-id="' +
                            escapeAttribute(round.id || '') + '" ' +
                        'data-match-id="' +
                            escapeAttribute(match.id || '') + '">' +
                        'Complete' +
                    '</button>';

            html += '<button type="button" class="small danger" ' +
                        'data-action="exam-remove-match" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                        'data-round-id="' +
                            escapeAttribute(round.id || '') + '" ' +
                        'data-match-id="' +
                            escapeAttribute(match.id || '') + '">' +
                        'Remove' +
                    '</button>';

            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderGroupExamBody(match) {
        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];

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

        html += '<div class="at-team-header">';
        html += '<span class="at-team-name">' +
                    escapeHtml(team.name || 'Unknown Team') +
                '</span>';
        html += renderOutcomeBadge(team);
        html += '</div>';

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
        var passers = Array.isArray(exam.finalPassers)
            ? exam.finalPassers
            : [];

        if (!Array.isArray(exam.rounds) || exam.rounds.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="at-final-passers-section">';
        html += '<div class="at-final-passers-header">';
        html += '<h4 class="at-final-passers-title">Final Passers</h4>';
        html += '<span class="at-final-passers-count">' +
                    passers.length +
                '</span>';
        html += '</div>';

        if (passers.length === 0) {
            html += '<p class="empty-state small">' +
                        'No final passers recorded yet.' +
                    '</p>';
        } else {
            html += '<div class="at-final-passers-list">';
            for (var i = 0; i < passers.length; i++) {
                var p = passers[i];
                if (!p) { continue; }
                html += '<span class="at-final-passer-chip">' +
                            escapeHtml(p.name || 'Unknown') +
                            (isNonEmptyString(p.type) &&
                                p.type !== 'character'
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

})();
