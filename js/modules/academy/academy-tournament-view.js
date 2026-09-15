/**
 * modules/academy/academy-tournament-view.js - Academy Tournament (Exams) View
 * Pure renderer and modal builder for the Academy-embedded Exams view.
 *
 * Path: js/modules/academy/academy-tournament-view.js
 *
 * RESPONSIBILITIES:
 *   - Rendering the Exams view body (top bar, pool panel, exam panel,
 *     rounds, matches, final passers)
 *   - Building the modal HTML for exam, round, and match interactions
 *   - Collecting form field values from the rendered modals
 *
 * NOT RESPONSIBILITIES:
 *   - Event binding. AcademyView binds; this module emits data-*.
 *   - Domain reads beyond the pool fallback. The aggregator owns
 *     interaction VMs; until those land, one clearly-marked helper
 *     reads eligible participants from TournamentQueries.
 *   - Validation. Every collector returns raw field values; the
 *     domain validates.
 *
 * PAIR-PICKER CONTRACT:
 *   The pair picker emits a "+ Add" button with data-action="exam-pair-add".
 *   AcademyView handles the click: it reads the three selects, validates
 *   distinctness, and appends a .at-pair-row to .at-pair-list with
 *   data-pair set to a JSON-stringified array of participant IDs.
 *   Each row carries a .at-pair-remove button that emits
 *   data-action="exam-pair-remove". The collector reads the rows.
 *
 * IMPORTANT:
 *   - RENDER ONLY. No mutations. The one domain read (pool fallback) is
 *     documented and isolated.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns HTML strings. Never touches the DOM.
 *
 * ACTION NAMING:
 *   Every action carries the 'exam-' prefix so AcademyView's
 *   prefix-based dispatcher routes them deterministically.
 *
 * ID SEMANTICS:
 *   data-exam-id   on every exam-scoped action
 *   data-round-id  on every round- and match-scoped action
 *   data-match-id  on every match-scoped action
 *   data-pool-id   on pool toggle actions
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal returns a bare .modal shell. The events module
 *   appends a .modal-content wrapper. Every builder here returns the
 *   inner content of that wrapper, not a full modal shell.
 *
 * VM LABEL SEMANTICS:
 *   The VM supplies display labels. The renderer prefers them and
 *   falls back to raw enum values only when the label is absent and
 *   the raw value is a real value.
 *
 * RESULT VOCABULARY:
 *   'pass' | 'retry' | 'fail'
 *
 * CREATE EXAM MODAL — UX NOTES:
 *   The modal opens after the user has already picked a class and week
 *   in the top bar, so those are fixed and displayed as read-only
 *   context rather than as editable fields.
 *
 *   Total Rounds is presented with a short explanation of what a
 *   round is. It defaults to 5 rather than 1, because most users add
 *   more than one round and the domain now auto-bumps the capacity
 *   when the user adds a round beyond the current total. The default
 *   is a starting point, not a hard ceiling.
 *
 *   Mode is presented last, after the user has read the other fields,
 *   so the choice is made with full context.
 *
 * ADD ROUND MODAL — CAPACITY NOTE:
 *   The modal does not surface the tournament's totalRounds. If the
 *   user is at capacity, the events module auto-bumps totalRounds
 *   before adding the round. The modal is unaware of the capacity
 *   rule; it just submits a round configuration.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *
 * DEPENDENCIES (OPTIONAL, used by modal builders):
 *   - window.TournamentQueries
 *   - window.TournamentAggregator
 *   - window.CharacterQueries
 *   - window.TeamQueries
 *
 * USAGE:
 *   var html = AcademyTournamentView.renderHTML(vm);
 *   container.innerHTML = html;
 *
 *   var modalHTML = AcademyTournamentView.buildCreateExamModalHTML(opts);
 *   var payload = AcademyTournamentView.collectCreateExamForm(formEl);
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
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getTournamentQueries() { return window.TournamentQueries || null; }
    function getTournamentAggregator() { return window.TournamentAggregator || null; }
    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getTeamQueries() { return window.TeamQueries || null; }

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

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
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
    // DISPLAY NAME RESOLUTION
    // ============================================================

    function getParticipantDisplayName(participantId, mode) {
        var Aggregator = getTournamentAggregator();
        if (Aggregator && typeof Aggregator.getParticipantName === 'function') {
            var name = Aggregator.getParticipantName(null, participantId);
            if (isNonEmptyString(name) && name !== 'Unknown') { return name; }
        }

        if (mode === 'teams') {
            var TeamQ = getTeamQueries();
            if (TeamQ && typeof TeamQ.getTeamById === 'function') {
                var team = TeamQ.getTeamById(participantId);
                if (team) { return team.name || 'Unknown Team'; }
            }
            return 'Unknown Team';
        }

        var CQ = getCharacterQueries();
        if (CQ && typeof CQ.getCharacterById === 'function') {
            var char = CQ.getCharacterById(participantId);
            if (char && typeof CQ.getDisplayName === 'function') {
                return CQ.getDisplayName(char);
            }
        }
        return 'Unknown';
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
    // POOL PANEL
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
    // EXAM PANEL
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

        var html = '';
        html += '<div class="at-round" ' +
                    'data-round-id="' + escapeAttribute(round.id || '') + '">';

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
    // FINAL PASSERS
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
    // MODAL HELPERS - Shared fragments
    // ============================================================

    function renderModalHeader(title, closeId) {
        var idAttr = closeId
            ? ' id="' + escapeAttribute(closeId) + '"'
            : '';
        return (
            '<div class="modal-header">' +
                '<h3>' + escapeHtml(title) + '</h3>' +
                '<button type="button" class="close-modal"' + idAttr + '>' +
                    '&times;' +
                '</button>' +
            '</div>'
        );
    }

    function renderResultSelect(name, currentValue) {
        var value = isNonEmptyString(currentValue) ? currentValue : 'pass';
        var options = [
            { value: 'pass',  label: 'Pass' },
            { value: 'retry', label: 'Retry' },
            { value: 'fail',  label: 'Fail' }
        ];

        var html = '<select class="at-result-select" ' +
                    'name="' + escapeAttribute(name) + '">';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var sel = opt.value === value ? ' selected' : '';
            html += '<option value="' + escapeAttribute(opt.value) + '"' +
                        sel + '>' +
                        escapeHtml(opt.label) +
                    '</option>';
        }
        html += '</select>';
        return html;
    }

    // ============================================================
    // MODAL HELPERS - Eligible participants (isolated fallback)
    // ============================================================

    function getEligibleParticipantsForModal(examId, roundId) {
        var Queries = getTournamentQueries();
        var Matches = window.TournamentMatches;

        if (!Queries || !Matches) {
            return [];
        }

        if (typeof Matches.getEligibleParticipants !== 'function') {
            return [];
        }

        var pool = [];
        try {
            pool = Matches.getEligibleParticipants(examId) || [];
        } catch (e) {
            return [];
        }

        if (!roundId) {
            return pool;
        }

        if (typeof Queries.getRound !== 'function') {
            return pool;
        }

        var round = null;
        try {
            round = Queries.getRound(examId, roundId);
        } catch (e) {
            return pool;
        }

        if (!round || !Array.isArray(round.matches)) {
            return pool;
        }

        var already = {};
        for (var i = 0; i < round.matches.length; i++) {
            var match = round.matches[i];
            if (!match || !Array.isArray(match.participants)) { continue; }
            for (var j = 0; j < match.participants.length; j++) {
                already[String(match.participants[j])] = true;
            }
        }

        var filtered = [];
        for (var k = 0; k < pool.length; k++) {
            if (!already[String(pool[k])]) {
                filtered.push(pool[k]);
            }
        }
        return filtered;
    }

    // ============================================================
    // MODAL BUILDER - Create Exam
    // ============================================================
    //
    // UX NOTES:
    //   - The class and week are fixed (they came from the top bar).
    //     The modal shows them as read-only context so the user knows
    //     what they're creating the exam for.
    //   - Total Rounds defaults to 5. This is a starting point, not a
    //     ceiling: the events module auto-bumps capacity when the user
    //     adds a round beyond the current total.
    //   - Mode is presented last, after the user has read the other
    //     fields, so the choice is made with full context.
    //   - Field hints are written for a first-time user: they explain
    //     what a round is, what the mode choices mean, and that
    //     participants are added after creation.

    function buildCreateExamModalHTML(options) {
        options = options || {};
        var classId = options.classId || '';
        var className = options.className || 'Class';
        var week = options.week;
        var mode = options.mode || 'individuals';

        var modeLabel = mode === 'teams' ? 'Team Exam' : 'Character Exam';
        var defaultName = modeLabel + ' \u2014 ' +
            className + ' Wk ' + safeString(week);

        var html = '';
        html += '<form id="at-create-exam-form" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + escapeAttribute(safeString(week)) + '">';

        html += renderModalHeader('Create Exam');

        html += '<div class="modal-body">';

        // ---- Fixed context: class + week ----
        html += '<div class="form-group at-fixed-context">';
        html += '<label>Creating exam for</label>';
        html += '<p class="at-context-line">' +
                    '<strong>' + escapeHtml(className) + '</strong>' +
                    ' in <strong>Week ' + escapeHtml(safeString(week)) +
                    '</strong>' +
                '</p>';
        html += '</div>';

        // ---- Name ----
        html += '<div class="form-group">';
        html += '<label for="at-exam-name">Exam Name</label>';
        html += '<input type="text" id="at-exam-name" class="at-exam-name" ' +
                    'value="' + escapeAttribute(defaultName) + '">';
        html += '<p class="field-hint">' +
                    'A label for this exam. You can change it later.' +
                '</p>';
        html += '</div>';

        // ---- Total Rounds ----
        html += '<div class="form-group">';
        html += '<label for="at-exam-total-rounds">Maximum Rounds</label>';
        html += '<input type="number" id="at-exam-total-rounds" ' +
                    'class="at-exam-total-rounds" value="5" min="1">';
        html += '<p class="field-hint">' +
                    'A round is one pass through the class. Each round ' +
                    'holds one or more matches, and participants advance ' +
                    'from one round to the next based on their match ' +
                    'results. You can raise this later if you need more ' +
                    'rounds; the exam expands automatically when you add ' +
                    'a round beyond the current maximum.' +
                '</p>';
        html += '</div>';

        // ---- Mode ----
        html += '<div class="form-group">';
        html += '<label for="at-exam-mode">Mode</label>';
        html += '<select id="at-exam-mode" class="at-exam-mode">';
        html += '<option value="individuals"' +
                    (mode === 'individuals' ? ' selected' : '') +
                    '>Individuals</option>';
        html += '<option value="teams"' +
                    (mode === 'teams' ? ' selected' : '') +
                    '>Teams</option>';
        html += '</select>';
        html += '<p class="field-hint">' +
                    '<strong>Individuals:</strong> characters compete on ' +
                    'their own. ' +
                    '<strong>Teams:</strong> pre-existing academic teams ' +
                    'compete. You can add or remove participants after ' +
                    'creating the exam. The mode determines who the exam ' +
                    'can recruit from, so pick the one that matches how ' +
                    'this class runs.' +
                '</p>';
        html += '</div>';

        // ---- Actions ----
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Create Exam</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function collectCreateExamForm(form) {
        if (!form) { return null; }

        var nameEl = form.querySelector('.at-exam-name');
        var modeEl = form.querySelector('.at-exam-mode');
        var roundsEl = form.querySelector('.at-exam-total-rounds');

        var name = nameEl ? nameEl.value.trim() : '';
        var mode = modeEl ? modeEl.value : 'individuals';
        var totalRounds = roundsEl ? parseInt(roundsEl.value, 10) : 5;
        if (isNaN(totalRounds) || totalRounds < 1) {
            totalRounds = 5;
        }

        return {
            name: name,
            mode: mode,
            totalRounds: totalRounds
        };
    }

    // ============================================================
    // MODAL BUILDER - Delete Exam
    // ============================================================

    function buildDeleteExamModalHTML(exam) {
        var name = (exam && exam.name) || 'this exam';

        var html = '';
        html += '<form id="at-delete-exam-form">';
        html += renderModalHeader('Delete Exam');
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' + escapeHtml(name) +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'All rounds, matches, and results will be removed.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Exam</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // MODAL BUILDER - Add Round
    // ============================================================

    function buildAddRoundModalHTML(options) {
        options = options || {};
        var isTeamMode = options.isTeamMode === true;

        var html = '';
        html += '<form id="at-add-round-form">';
        html += renderModalHeader('Add Round');
        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="at-round-type">Match Type</label>';
        html += '<select id="at-round-type" class="at-round-type">';
        if (isTeamMode) {
            html += '<option value="team_vs_team" selected>' +
                        'Team Match' +
                    '</option>';
        } else {
            html += '<option value="group_exam" selected>Group Exam</option>';
            html += '<option value="pair_exam">Pair Exam</option>';
        }
        html += '</select>';
        html += '<p class="field-hint">' +
                    (isTeamMode
                        ? 'Team matches pit two or more academic teams ' +
                          'against each other.'
                        : 'A group exam has every participant compete ' +
                          'individually. A pair exam splits participants ' +
                          'into pairs or triples that work together.') +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="at-round-size">Participants per Match</label>';
        html += '<input type="number" id="at-round-size" ' +
                    'class="at-round-size" value="2" min="2" max="20">';
        html += '<p class="field-hint">' +
                    'How many participants go into each match. ' +
                    (isTeamMode
                        ? 'This is the number of teams per match.'
                        : 'For pair exams, this value is ignored.') +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Add Round</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function collectAddRoundForm(form) {
        if (!form) { return null; }

        var typeEl = form.querySelector('.at-round-type');
        var sizeEl = form.querySelector('.at-round-size');

        var type = typeEl ? typeEl.value : 'group_exam';
        var size = sizeEl ? parseInt(sizeEl.value, 10) : 2;
        if (isNaN(size) || size < 2) {
            size = 2;
        }

        var isPairExam = type === 'pair_exam';
        var matchType = isPairExam ? 'group_exam' : type;

        return {
            matchSize: isPairExam ? 2 : size,
            matchType: matchType,
            isPairExam: isPairExam
        };
    }

    // ============================================================
    // MODAL BUILDER - Remove Round
    // ============================================================

    function buildRemoveRoundModalHTML(options) {
        var html = '';
        html += '<form id="at-remove-round-form">';
        html += renderModalHeader('Remove Round');
        html += '<div class="modal-body">';
        html += '<p>Remove this round and all its matches?</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Remove Round</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // MODAL BUILDER - Auto-Generate Round
    // ============================================================

    function buildAutoGenerateRoundModalHTML(options) {
        options = options || {};
        var examId = options.examId || '';
        var roundId = options.roundId || '';

        var eligible = getEligibleParticipantsForModal(examId, roundId);
        var available = eligible.length;

        var html = '';
        html += '<form id="at-auto-generate-form">';
        html += renderModalHeader('Auto-Generate Round');
        html += '<div class="modal-body">';

        html += '<p class="at-auto-info">' +
                    'Eligible participants (not eliminated, not already in a match this round): ' +
                    '<strong>' + available + '</strong>' +
                '</p>';

        html += '<div class="form-group">';
        html += '<label for="at-auto-match-size">Participants per Match</label>';
        html += '<input type="number" id="at-auto-match-size" ' +
                    'class="at-auto-match-size" value="2" min="2" max="20">';
        html += '</div>';

        html += '<p class="at-auto-preview" id="at-auto-preview">' +
                    'Will create approximately <strong>0</strong> matches.' +
                '</p>';

        if (available < 2) {
            html += '<p class="at-auto-warning">' +
                        'Not enough eligible participants to generate a match.' +
                    '</p>';
        }

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary"' +
                    (available < 2 ? ' disabled' : '') +
                    '>Generate</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function collectAutoGenerateRoundForm(form) {
        if (!form) { return { matchSize: null }; }

        var sizeEl = form.querySelector('.at-auto-match-size');
        var size = sizeEl ? parseInt(sizeEl.value, 10) : 2;
        if (isNaN(size) || size < 2) {
            size = 2;
        }

        return { matchSize: size };
    }

    // ============================================================
    // MODAL HELPERS - Participant / Pair pickers
    // ============================================================

    function renderParticipantPicker(examId, roundId, mode) {
        var eligible = getEligibleParticipantsForModal(examId, roundId);

        var html = '';
        html += '<div class="at-picker">';
        html += '<p class="at-picker-hint">' +
                    'Select 2 or more ' +
                    (mode === 'teams' ? 'teams' : 'characters') + '.' +
                '</p>';

        if (eligible.length === 0) {
            html += '<p class="empty-state small">' +
                        'No eligible participants.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="at-picker-list">';
        for (var i = 0; i < eligible.length; i++) {
            var id = eligible[i];
            var name = getParticipantDisplayName(id, mode);
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

    function renderPairPicker(examId, roundId) {
        var eligible = getEligibleParticipantsForModal(examId, roundId);

        var html = '';
        html += '<div class="at-pair-picker">';

        html += '<p class="at-picker-hint">' +
                    'Add pairs or triples of participants. ' +
                    'Each pair works together.' +
                '</p>';

        if (eligible.length < 2) {
            html += '<p class="empty-state small">' +
                        'Need at least 2 eligible participants.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div id="at-pair-builder">';
        html += '<div class="at-pair-inputs">';

        for (var slot = 1; slot <= 3; slot++) {
            var slotAttr = 'data-pair-slot="' + slot + '"';
            var selectClass = 'at-pair-select at-pair-select-' + slot;
            html += '<select class="' + selectClass + '" ' + slotAttr + '>';
            html += '<option value="">' +
                        (slot === 3
                            ? '(optional 3rd)'
                            : 'Select participant...') +
                    '</option>';
            for (var i = 0; i < eligible.length; i++) {
                var id = eligible[i];
                html += '<option value="' + escapeAttribute(id) + '">' +
                            escapeHtml(
                                getParticipantDisplayName(id, 'individuals')
                            ) +
                        '</option>';
            }
            html += '</select>';
        }

        html += '<button type="button" class="small secondary at-pair-add" ' +
                    'data-action="exam-pair-add">' +
                    '+ Add' +
                '</button>';
        html += '</div>';

        html += '<div class="at-pair-list"></div>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function collectPickerSelections(form) {
        var checks = form.querySelectorAll('.at-picker-check');
        var ids = [];
        for (var i = 0; i < checks.length; i++) {
            if (checks[i].checked) {
                ids.push(checks[i].value);
            }
        }
        return ids;
    }

    function collectPairings(form) {
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

    // ============================================================
    // MODAL BUILDER - Add Match (Manual)
    // ============================================================

    function buildAddMatchModalHTML(options) {
        options = options || {};
        var examId = options.examId || '';
        var roundId = options.roundId || '';

        var Queries = getTournamentQueries();
        var exam = Queries ? Queries.getTournament(examId) : null;
        var mode = exam ? exam.mode : 'individuals';

        var isPairExam = false;
        if (Queries && typeof Queries.getRound === 'function') {
            var round = Queries.getRound(examId, roundId);
            if (round) {
                isPairExam = round.isPairExam === true;
            }
        }

        var html = '';
        html += '<form id="at-add-match-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '" ' +
                    'data-round-id="' + escapeAttribute(roundId) + '">';

        html += renderModalHeader('Add Match');
        html += '<div class="modal-body">';

        if (isPairExam) {
            html += renderPairPicker(examId, roundId);
        } else {
            html += renderParticipantPicker(examId, roundId, mode);
        }

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Add Match</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function collectAddMatchForm(form) {
        if (!form) { return null; }

        var isPairExam = !!form.querySelector('.at-pair-picker');

        if (isPairExam) {
            var pairings = collectPairings(form);
            var participants = [];
            for (var i = 0; i < pairings.length; i++) {
                for (var j = 0; j < pairings[i].length; j++) {
                    participants.push(pairings[i][j]);
                }
            }
            return {
                participants: participants,
                matchType: 'group_exam',
                isPairExam: true,
                pairings: pairings
            };
        }

        return {
            participants: collectPickerSelections(form),
            matchType: null,
            isPairExam: false
        };
    }

    // ============================================================
    // MODAL BUILDER - Edit Match
    // ============================================================

    function buildEditMatchModalHTML(options) {
        options = options || {};
        var examId = options.examId || '';
        var roundId = options.roundId || '';
        var matchId = options.matchId || '';

        var Queries = getTournamentQueries();
        var exam = Queries ? Queries.getTournament(examId) : null;
        var mode = exam ? exam.mode : 'individuals';

        var match = null;
        if (Queries && typeof Queries.getMatch === 'function') {
            match = Queries.getMatch(examId, roundId, matchId);
        }

        var currentParticipants = match && Array.isArray(match.participants)
            ? match.participants
            : [];
        var isPairExam = match && match.isPairExam === true;

        var html = '';
        html += '<form id="at-edit-match-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '" ' +
                    'data-round-id="' + escapeAttribute(roundId) + '" ' +
                    'data-match-id="' + escapeAttribute(matchId) + '">';

        html += renderModalHeader('Edit Match');
        html += '<div class="modal-body">';

        if (isPairExam) {
            html += renderPairPicker(examId, roundId);
        } else {
            html += renderEditParticipantPicker(
                examId, roundId, mode, currentParticipants
            );
        }

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Save Changes</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function renderEditParticipantPicker(examId, roundId, mode, currentIds) {
        var eligible = getEligibleParticipantsForModal(examId, roundId);

        var combined = {};
        var ordered = [];
        for (var i = 0; i < eligible.length; i++) {
            if (!combined[eligible[i]]) {
                combined[eligible[i]] = true;
                ordered.push(eligible[i]);
            }
        }
        for (var j = 0; j < currentIds.length; j++) {
            var id = String(currentIds[j]);
            if (!combined[id]) {
                combined[id] = true;
                ordered.push(id);
            }
        }

        var currentSet = {};
        for (var k = 0; k < currentIds.length; k++) {
            currentSet[String(currentIds[k])] = true;
        }

        var html = '';
        html += '<div class="at-picker">';
        html += '<p class="at-picker-hint">' +
                    'Select 2 or more ' +
                    (mode === 'teams' ? 'teams' : 'characters') + '.' +
                '</p>';

        if (ordered.length === 0) {
            html += '<p class="empty-state small">' +
                        'No eligible participants.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="at-picker-list">';
        for (var m = 0; m < ordered.length; m++) {
            var pid = ordered[m];
            var name = getParticipantDisplayName(pid, mode);
            var isChecked = currentSet[String(pid)] === true;
            html += '<label class="at-picker-item">' +
                        '<input type="checkbox" class="at-picker-check" ' +
                            'value="' + escapeAttribute(pid) + '"' +
                            (isChecked ? ' checked' : '') + '>' +
                        '<span>' + escapeHtml(name) + '</span>' +
                    '</label>';
        }
        html += '</div>';
        html += '</div>';
        return html;
    }

    function collectEditMatchForm(form) {
        if (!form) { return null; }

        var isPairExam = !!form.querySelector('.at-pair-picker');

        if (isPairExam) {
            var pairings = collectPairings(form);
            var participants = [];
            for (var i = 0; i < pairings.length; i++) {
                for (var j = 0; j < pairings[i].length; j++) {
                    participants.push(pairings[i][j]);
                }
            }
            return {
                participants: participants,
                isPairExam: true,
                pairings: pairings
            };
        }

        return {
            participants: collectPickerSelections(form),
            isPairExam: false
        };
    }

    // ============================================================
    // MODAL BUILDER - Complete Match
    // ============================================================

    function buildCompleteMatchModalHTML(options) {
        options = options || {};
        var examId = options.examId || '';
        var roundId = options.roundId || '';
        var matchId = options.matchId || '';

        var Queries = getTournamentQueries();
        var exam = Queries ? Queries.getTournament(examId) : null;
        var mode = exam ? exam.mode : 'individuals';

        var match = null;
        if (Queries && typeof Queries.getMatch === 'function') {
            match = Queries.getMatch(examId, roundId, matchId);
        }

        if (!match) {
            return (
                '<form id="at-complete-match-form">' +
                    renderModalHeader('Complete Match') +
                    '<div class="modal-body">' +
                        '<p class="empty-state small">Match not found.</p>' +
                    '</div>' +
                '</form>'
            );
        }

        var matchType = match.type || 'group_exam';
        var isTeamMatch = matchType === 'team_vs_team';

        var html = '';
        html += '<form id="at-complete-match-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '" ' +
                    'data-round-id="' + escapeAttribute(roundId) + '" ' +
                    'data-match-id="' + escapeAttribute(matchId) + '" ' +
                    'data-match-type="' + escapeAttribute(matchType) + '">';

        html += renderModalHeader('Complete Match');
        html += '<div class="modal-body">';

        if (isTeamMatch) {
            html += renderTeamCompletionBody(match, mode);
        } else {
            html += renderGroupCompletionBody(match, mode);
        }

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Complete Match</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function renderGroupCompletionBody(match, mode) {
        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];
        var existingResults = match.results || {};

        var html = '';
        html += '<p class="at-picker-hint">' +
                    'Set the result for each participant. Default is Pass.' +
                '</p>';

        if (participants.length === 0) {
            html += '<p class="empty-state small">' +
                        'This match has no participants.' +
                    '</p>';
            return html;
        }

        html += '<div class="at-completion-list">';
        for (var i = 0; i < participants.length; i++) {
            var pid = participants[i];
            var name = getParticipantDisplayName(pid, mode);
            var current = existingResults[String(pid)] || '';
            html += '<div class="at-completion-row" ' +
                        'data-participant-id="' + escapeAttribute(pid) + '">';
            html += '<span class="at-completion-name">' +
                        escapeHtml(name) +
                    '</span>';
            html += renderResultSelect('result_' + pid, current);
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function renderTeamCompletionBody(match, mode) {
        var teams = Array.isArray(match.participants) ? match.participants : [];
        var existingTeamResults = match.teamResults || {};
        var existingIndividualResults = match.individualResults || {};
        var TeamQueries = getTeamQueries();

        var html = '';
        html += '<p class="at-picker-hint">' +
                    'Set the result for each team and each member. ' +
                    'All default to Pass.' +
                '</p>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">' +
                        'This match has no teams.' +
                    '</p>';
            return html;
        }

        html += '<div class="at-team-completion-list">';
        for (var i = 0; i < teams.length; i++) {
            var teamId = teams[i];
            var teamName = getParticipantDisplayName(teamId, 'teams');
            var teamCurrent = existingTeamResults[String(teamId)] || '';

            html += '<div class="at-team-completion-group" ' +
                        'data-team-id="' + escapeAttribute(teamId) + '">';

            html += '<div class="at-team-completion-team-row">';
            html += '<span class="at-team-completion-name">' +
                        escapeHtml(teamName) +
                    '</span>';
            html += renderResultSelect('team_result_' + teamId, teamCurrent);
            html += '</div>';

            var team = (TeamQueries &&
                typeof TeamQueries.getTeamById === 'function')
                ? TeamQueries.getTeamById(teamId)
                : null;

            if (team && Array.isArray(team.members) && team.members.length > 0) {
                html += '<div class="at-team-completion-members">';
                for (var j = 0; j < team.members.length; j++) {
                    var member = team.members[j];
                    if (!member || !member.characterId) { continue; }
                    var charName = getParticipantDisplayName(
                        member.characterId, 'individuals'
                    );
                    var charCurrent = existingIndividualResults[
                        String(member.characterId)
                    ] || '';
                    html += '<div class="at-team-completion-member-row" ' +
                                'data-character-id="' +
                                    escapeAttribute(member.characterId) + '">';
                    html += '<span class="at-team-completion-member-name">' +
                                escapeHtml(charName) +
                            '</span>';
                    html += renderResultSelect(
                        'member_result_' + member.characterId,
                        charCurrent
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

    function collectCompleteMatchForm(form) {
        if (!form) { return null; }

        var matchType = form.dataset.matchType || 'group_exam';

        if (matchType === 'team_vs_team') {
            return collectTeamCompletionPayload(form);
        }
        return collectGroupCompletionPayload(form);
    }

    function collectGroupCompletionPayload(form) {
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

        return { results: results };
    }

    function collectTeamCompletionPayload(form) {
        var teamGroups = form.querySelectorAll('.at-team-completion-group');
        var teamResults = {};
        var individualResults = {};

        for (var i = 0; i < teamGroups.length; i++) {
            var group = teamGroups[i];
            var teamId = group.dataset.teamId;
            if (!teamId) { continue; }

            var teamSelect = group.querySelector(
                '.at-team-completion-team-row .at-result-select'
            );
            teamResults[teamId] = teamSelect ? teamSelect.value : 'pass';

            var memberRows = group.querySelectorAll(
                '.at-team-completion-member-row'
            );
            for (var j = 0; j < memberRows.length; j++) {
                var mRow = memberRows[j];
                var charId = mRow.dataset.characterId;
                if (!charId) { continue; }
                var memberSelect = mRow.querySelector('.at-result-select');
                individualResults[charId] = memberSelect
                    ? memberSelect.value
                    : 'pass';
            }
        }

        return {
            teamResults: teamResults,
            individualResults: individualResults
        };
    }

    // ============================================================
    // MODAL BUILDER - Remove Match
    // ============================================================

    function buildRemoveMatchModalHTML(options) {
        var html = '';
        html += '<form id="at-remove-match-form">';
        html += renderModalHeader('Remove Match');
        html += '<div class="modal-body">';
        html += '<p>Remove this match?</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Remove Match</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyTournamentView = {
        renderHTML: renderHTML,

        buildCreateExamModalHTML: buildCreateExamModalHTML,
        buildDeleteExamModalHTML: buildDeleteExamModalHTML,
        buildAddRoundModalHTML: buildAddRoundModalHTML,
        buildRemoveRoundModalHTML: buildRemoveRoundModalHTML,
        buildAutoGenerateRoundModalHTML: buildAutoGenerateRoundModalHTML,
        buildAddMatchModalHTML: buildAddMatchModalHTML,
        buildEditMatchModalHTML: buildEditMatchModalHTML,
        buildCompleteMatchModalHTML: buildCompleteMatchModalHTML,
        buildRemoveMatchModalHTML: buildRemoveMatchModalHTML,

        collectCreateExamForm: collectCreateExamForm,
        collectAddRoundForm: collectAddRoundForm,
        collectAutoGenerateRoundForm: collectAutoGenerateRoundForm,
        collectAddMatchForm: collectAddMatchForm,
        collectEditMatchForm: collectEditMatchForm,
        collectCompleteMatchForm: collectCompleteMatchForm
    };

})();
