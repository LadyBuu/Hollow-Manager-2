/**
 * modules/academy/academy-tournament-view.js
 * Academy Tournament (Exams) View
 *
 * Path: js/modules/academy/academy-tournament-view.js
 *
 * Pure renderer and modal builder for the Academy-embedded Exams
 * view.
 *
 * RESPONSIBILITIES:
 *   - Render the Exams view body (top bar, pool panel, exam panel,
 *     rounds, matches, eliminations, final passers)
 *   - Build modal HTML from a VM
 *   - Collect raw form values from modals
 *   - Render a collapse toggle on each round header (C4)
 *   - Render prior-round pass/retry badges in the picker (C8)
 *   - Render an "Edit Exam" button in the exam header and provide
 *     the edit modal builder/collector (C5)
 *
 * NOT RESPONSIBILITIES:
 *   - Event binding. AcademyView binds; this module emits data-*.
 *   - Domain reads. All data arrives in the VM.
 *   - Domain validation. Collectors return raw field values.
 *   - Name resolution. The aggregator resolves display names.
 *   - Eligibility computation. The aggregator builds the pool.
 *   - Collapse-state persistence. AcademyUI owns it; this module
 *     only reads `round.isCollapsed` off the VM.
 *   - Prior-round derivation. TournamentQueries owns it; this
 *     module only reads `priorRoundOutcome` off pool items and
 *     eligible-participant entries.
 *   - Exam update. The events layer routes the collected form
 *     through TournamentCore.updateTournament.
 *
 * OUTCOME DISPLAY:
 *   This module does NOT own an outcome-display map. It consumes
 *   the `vm.outcomeDisplay` tuple (`text`, `class`, `label`) that
 *   AcademyTournamentAggregator produces. The glyph choice — and
 *   the PV-2 monochrome decision — lives on the aggregator.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
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
    // ESCAPING
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

    function isArray(value) {
        return Array.isArray(value);
    }

    // ============================================================
    // CSS CLASS HELPERS
    // ============================================================

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

    // ============================================================
    // OUTCOME BADGE
    // ============================================================

    function renderOutcomeBadge(vm) {
        if (!vm || !vm.outcomeDisplay) {
            return '<span class="at-outcome-badge at-outcome-unknown">' +
                        '?' +
                    '</span>';
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

    // ============================================================
    // PRIOR-ROUND OUTCOME BADGE (C8)
    // ============================================================

    function renderPriorOutcomeBadge(outcome) {
        if (outcome !== 'pass' && outcome !== 'retry') {
            return '';
        }
        var label = outcome === 'pass' ? 'Pass' : 'Retry';
        var cls = 'at-prior-outcome at-prior-outcome-' + outcome;
        return '<span class="' + escapeAttribute(cls) + '" ' +
                    'title="' +
                        escapeAttribute('Previous round: ' + label) +
                    '">' +
                    escapeHtml(label) +
                '</span>';
    }

    // ============================================================
    // TOP-LEVEL RENDER
    // ============================================================

    function renderHTML(viewModel) {
        if (!viewModel || typeof viewModel !== 'object') {
            throw new Error(
                '[AcademyTournamentView] renderHTML requires a view model.'
            );
        }

        var vm = viewModel;
        var classId = isNonEmptyString(vm.classId) ? vm.classId : null;

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
    // TOP BAR
    // ============================================================

    function renderTopBar(vm) {
        var classes = isArray(vm.classList) ? vm.classList : [];
        var classId = isNonEmptyString(vm.classId) ? vm.classId : null;
        var week = isFiniteNumber(vm.week) ? vm.week : null;

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
            var selected = classId &&
                String(classId) === String(cls.id)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        selected + '>' +
                        escapeHtml(cls.name || '') +
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
                        week !== null ? String(week) : ''
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
        var pool = isArray(vm.pool) ? vm.pool : [];
        var exam = vm.exam || null;

        var title = 'Eligible This Week';
        var modeLabel = '';

        if (exam) {
            if (exam.mode === 'teams') {
                title = 'Teams This Week';
            } else if (exam.mode === 'individuals') {
                title = 'Characters This Week';
            }
            if (isNonEmptyString(exam.modeLabel)) {
                modeLabel = exam.modeLabel + ' exam';
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
                    escapeHtml(item.name || '') +
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
        var exam = vm.exam || null;
        var week = isFiniteNumber(vm.week) ? vm.week : null;

        var html = '';
        html += '<div class="academy-exams-detail">';

        if (!exam) {
            html += renderNoExamState(week);
            html += '</div>';
            return html;
        }

        html += '<div class="academy-exams-detail-block" ' +
                    'data-exam-id="' + escapeAttribute(exam.id) + '">';
        html += renderExamHeader(exam, week);
        html += renderExamRounds(exam);
        html += renderEliminations(exam);
        html += renderFinalPassers(exam);
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderNoExamState(week) {
        var weekDisplay = week !== null ? String(week) : '';
        var html = '';
        html += '<div class="academy-exams-no-exam">';
        html += '<h3 class="academy-exams-no-exam-title">' +
                    'No Exam for Week ' + escapeHtml(weekDisplay) +
                '</h3>';
        html += '<p class="empty-state small">' +
                    'Create an exam to run eliminations for this class ' +
                    'this week.' +
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
        var statusLabel = exam.statusLabel || '';
        var modeLabel = exam.modeLabel || '';
        var isComplete = exam.status === 'completed';

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
        if (week !== null) {
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
        if (isFiniteNumber(exam.finalPasserCount) &&
            exam.finalPasserCount > 0) {
            html += '<span class="at-meta-item at-meta-final">' +
                        '<span class="meta-label">Final Passers:</span> ' +
                        escapeHtml(String(exam.finalPasserCount)) +
                    '</span>';
        }
        html += '</div>';

        html += '<div class="academy-exams-detail-actions">';

        // C5 — Edit Exam. Available regardless of exam status: the
        // exam record is a soft-label record, and the user is the
        // authority on when they want to correct the name or week.
        html += '<button type="button" class="small secondary" ' +
                    'data-action="exam-edit" ' +
                    'data-exam-id="' + escapeAttribute(exam.id) + '">' +
                    'Edit Exam' +
                '</button>';

        if (!isComplete) {
            html += '<button type="button" class="small primary" ' +
                        'data-action="exam-add-round" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '">' +
                        '+ Add Round' +
                    '</button>';

            if (exam.roundCount > 0) {
                html += '<button type="button" class="small secondary" ' +
                            'data-action="exam-complete" ' +
                            'data-exam-id="' +
                                escapeAttribute(exam.id) + '">' +
                            'Mark Completed' +
                        '</button>';
            }
        } else {
            // Reopening the exam flips its status back to 'active'.
            // It does NOT touch rounds, matches, or eliminations.
            // The round-level and match-level reopen buttons become
            // available once the exam is active again.
            html += '<button type="button" class="small secondary" ' +
                        'data-action="exam-reopen-exam" ' +
                        'data-exam-id="' +
                            escapeAttribute(exam.id) + '">' +
                        'Reopen Exam' +
                    '</button>';
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

    function renderExamRounds(exam) {
        var rounds = isArray(exam.rounds) ? exam.rounds : [];

        var html = '';
        html += '<div class="academy-exams-rounds">';

        if (rounds.length === 0) {
            html += '<p class="empty-state small">' +
                        'No rounds yet. Add a round to start running ' +
                        'matches.' +
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

    function roundHasCompletedMatch(round) {
        if (!round || !isArray(round.matches)) { return false; }
        for (var i = 0; i < round.matches.length; i++) {
            var m = round.matches[i];
            if (m && m.isComplete === true) { return true; }
        }
        return false;
    }

    function renderRound(round, exam) {
        if (!round) { return ''; }

        var isExamComplete = exam.status === 'completed';
        var canEditRound = !isExamComplete;
        var canReopenRound = !isExamComplete &&
            roundHasCompletedMatch(round);

        // C4 — collapse state comes from the VM. The aggregator
        // resolves it from AcademyUI; the view treats it as a
        // read-only fact. Default when the field is missing is
        // "expanded", matching the aggregator's stated policy.
        var isCollapsed = round.isCollapsed === true;

        var roundClasses = 'at-round';
        if (isCollapsed) { roundClasses += ' is-collapsed'; }

        var html = '';
        html += '<div class="' + roundClasses + '" ' +
                    'data-round-id="' +
                        escapeAttribute(round.id || '') + '">';

        html += '<div class="at-round-header">';

        // ---- Collapse toggle (C4) ----
        html += '<button type="button" ' +
                    'class="at-round-collapse-toggle" ' +
                    'data-action="exam-toggle-round-collapse" ' +
                    'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                    'data-round-id="' +
                        escapeAttribute(round.id || '') + '" ' +
                    'title="' +
                        escapeAttribute(isCollapsed
                            ? 'Expand this round'
                            : 'Collapse this round') + '" ' +
                    'aria-expanded="' +
                        escapeAttribute(isCollapsed ? 'false' : 'true') +
                    '">';
        html += '<span class="at-round-collapse-icon">' +
                    (isCollapsed ? '\u25b8' : '\u25be') +
                '</span>';
        html += '</button>';

        html += '<div class="at-round-title">';
        html += '<strong>Round ' +
                    escapeHtml(String(round.roundNumber || '')) +
                '</strong>';

        var matchTypeLabel = round.matchTypeLabel || 'Group Exam';
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

        html += ' <span class="at-round-count">' +
                    round.matchCount + ' match' +
                    (round.matchCount === 1 ? '' : 'es') +
                '</span>';
        html += '</div>';

        if (canEditRound) {
            html += '<div class="at-round-actions">';

            if (canReopenRound) {
                html += '<button type="button" class="small secondary" ' +
                            'data-action="exam-reopen-round" ' +
                            'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                            'data-round-id="' +
                                escapeAttribute(round.id || '') + '" ' +
                            'title="Reopen every completed match in ' +
                                'this round for editing">' +
                            'Reopen Round' +
                        '</button>';
            }

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

        // ---- Round body (collapsible) ----
        html += '<div class="at-round-body">';

        var matches = isArray(round.matches) ? round.matches : [];
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

        html += '</div>';
        return html;
    }

    // ============================================================
    // MATCH
    // ============================================================

    function renderMatch(match, round, exam, isExamComplete) {
        if (!match) { return ''; }

        var canEditMatch = !isExamComplete && !match.isComplete;
        var canReopenMatch = !isExamComplete && match.isComplete === true;

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
                    escapeHtml(match.statusLabel || '') +
                '</span>';

        if (canEditMatch) {
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
        } else if (canReopenMatch) {
            html += '<div class="at-match-actions">';

            html += '<button type="button" class="small secondary" ' +
                        'data-action="exam-reopen-match" ' +
                        'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                        'data-round-id="' +
                            escapeAttribute(round.id || '') + '" ' +
                        'data-match-id="' +
                            escapeAttribute(match.id || '') + '" ' +
                        'title="Reopen this match for editing. ' +
                            'Eliminations produced by it are reversed.">' +
                        'Reopen' +
                    '</button>';

            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderGroupExamBody(match) {
        var participants = isArray(match.participants)
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
        var pairings = isArray(match.pairings) ? match.pairings : [];

        if (pairings.length === 0) {
            return renderGroupExamBody(match);
        }

        var html = '';
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
        var teams = isArray(match.teams) ? match.teams : [];

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
                    escapeHtml(team.name || '') +
                '</span>';
        html += renderOutcomeBadge(team);
        html += '</div>';

        var members = isArray(team.members) ? team.members : [];
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
                    escapeHtml(member.name || '') +
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
                    escapeHtml(participant.name || '') +
                '</span>';
        html += renderOutcomeBadge(participant);
        html += '</div>';
        return html;
    }

    // ============================================================
    // ELIMINATED SECTION
    // ============================================================

    function renderEliminations(exam) {
        var eliminations = isArray(exam.eliminations)
            ? exam.eliminations
            : [];

        var html = '';
        html += '<div class="at-eliminations-section">';

        html += '<div class="at-eliminations-header">';
        html += '<h4 class="at-eliminations-title">Eliminated</h4>';
        html += '<span class="at-eliminations-count">' +
                    eliminations.length +
                '</span>';
        html += '</div>';

        if (eliminations.length === 0) {
            html += '<p class="empty-state small at-eliminations-empty">' +
                        'No characters have been eliminated from this ' +
                        'exam.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="at-eliminations-list">';
        for (var i = 0; i < eliminations.length; i++) {
            html += renderEliminationRow(eliminations[i], exam);
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderEliminationRow(elimination, exam) {
        if (!elimination || !elimination.participantId) { return ''; }

        var name = isNonEmptyString(elimination.participantName)
            ? elimination.participantName
            : 'Unknown';

        var weekDisplay = isFiniteNumber(elimination.week)
            ? String(elimination.week)
            : '\u2014';

        var reason = isNonEmptyString(elimination.reason)
            ? elimination.reason
            : '';

        var rowClass = 'at-elimination-row';
        if (elimination.standalone === true) {
            rowClass += ' at-elimination-standalone';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(elimination.participantId) + '">';

        html += '<div class="at-elimination-main">';
        html += '<span class="at-elimination-name">' +
                    escapeHtml(name) +
                '</span>';
        html += '<span class="at-elimination-week">' +
                    'Week ' + escapeHtml(weekDisplay) +
                '</span>';
        html += '</div>';

        if (reason) {
            html += '<div class="at-elimination-reason">' +
                        escapeHtml(reason) +
                    '</div>';
        }

        html += '<div class="at-elimination-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="exam-restore-eliminated" ' +
                    'data-exam-id="' + escapeAttribute(exam.id) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(elimination.participantId) + '" ' +
                    'title="Restore this character from elimination">' +
                    'Restore' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // FINAL PASSERS
    // ============================================================

    function renderFinalPassers(exam) {
        var passers = isArray(exam.finalPassers) ? exam.finalPassers : [];
        var rounds = isArray(exam.rounds) ? exam.rounds : [];

        if (rounds.length === 0) {
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
                            escapeHtml(p.name || '') +
                            (isNonEmptyString(p.type) &&
                                p.type !== 'character'
                                ? ' <span class="at-final-passer-type">(' +
                                    escapeHtml(p.typeLabel || p.type) +
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

    function renderModalHeader(title) {
        return (
            '<div class="modal-header">' +
                '<h3>' + escapeHtml(title) + '</h3>' +
                '<button type="button" class="close-modal">' +
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
    // MODAL BUILDER - Create Exam
    // ============================================================

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

        html += '<div class="form-group at-fixed-context">';
        html += '<label>Creating exam for</label>';
        html += '<p class="at-context-line">' +
                    '<strong>' + escapeHtml(className) + '</strong>' +
                    ' in <strong>Week ' + escapeHtml(safeString(week)) +
                    '</strong>' +
                '</p>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="at-exam-name">Exam Name</label>';
        html += '<input type="text" id="at-exam-name" class="at-exam-name" ' +
                    'value="' + escapeAttribute(defaultName) + '">';
        html += '<p class="field-hint">' +
                    'A label for this exam. You can change it later.' +
                '</p>';
        html += '</div>';

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
    // MODAL BUILDER - Edit Exam (C5)
    // ============================================================
    //
    // Fields:
    //   - Exam Name        (text input)
    //   - Week             (single integer input)
    //
    // A single week is used because this UI scopes exams to one
    // week. On submit, the events layer sets both startWeek and
    // endWeek to that value.
    //
    // No other fields are exposed. Participants, rounds, matches,
    // and mode are edited through their own affordances. Mode in
    // particular cannot be changed after creation: the domain
    // rejects it once participants exist.

    function buildEditExamModalHTML(options) {
        options = options || {};
        var examId = options.examId || '';
        var name = options.name || '';
        var week = options.week;

        var weekValue = isFiniteNumber(week) ? String(week) : '';

        var html = '';
        html += '<form id="at-edit-exam-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '">';

        html += renderModalHeader('Edit Exam');

        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="at-edit-exam-name">Exam Name</label>';
        html += '<input type="text" id="at-edit-exam-name" ' +
                    'class="at-edit-exam-name" ' +
                    'value="' + escapeAttribute(name) + '" required>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="at-edit-exam-week">Week</label>';
        html += '<input type="number" id="at-edit-exam-week" ' +
                    'class="at-edit-exam-week" ' +
                    'value="' + escapeAttribute(weekValue) + '" ' +
                    'min="1" max="52" required>';
        html += '<p class="field-hint">' +
                    'The week this exam runs. Sets both start and end ' +
                    'week, because exams are scoped to a single week.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Save Changes</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function collectEditExamForm(form) {
        if (!form) { return null; }

        var nameEl = form.querySelector('.at-edit-exam-name');
        var weekEl = form.querySelector('.at-edit-exam-week');

        var name = nameEl ? nameEl.value.trim() : '';
        var week = weekEl ? parseInt(weekEl.value, 10) : NaN;

        return {
            name: name,
            week: isNaN(week) ? null : week
        };
    }

    // ============================================================
    // MODAL BUILDER - Delete Exam
    // ============================================================

    function buildDeleteExamModalHTML(options) {
        options = options || {};
        var name = options.name || 'this exam';

        var html = '';
        html += '<form id="at-delete-exam-form">';
        html += renderModalHeader('Delete Exam');
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' + escapeHtml(name) +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'All rounds, matches, and results will be removed. ' +
                    'Any character eliminations produced by this exam ' +
                    'will be reversed.' +
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
            html += '<option value="group_exam" selected>' +
                        'Group Exam' +
                    '</option>';
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

    function buildRemoveRoundModalHTML() {
        var html = '';
        html += '<form id="at-remove-round-form">';
        html += renderModalHeader('Remove Round');
        html += '<div class="modal-body">';
        html += '<p>Remove this round and all its matches?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'Any eliminations produced by completed matches in ' +
                    'this round will be reversed.' +
                '</p>';
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
    // MODAL BUILDER - Reopen Round
    // ============================================================

    function buildReopenRoundModalHTML() {
        var html = '';
        html += '<form id="at-reopen-round-form">';
        html += renderModalHeader('Reopen Round');
        html += '<div class="modal-body">';
        html += '<p>Reopen every match in this round for editing?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'Any eliminations produced by completed matches in ' +
                    'this round will be reversed. Match results are ' +
                    'preserved; you can edit them and complete the ' +
                    'matches again.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Reopen Round</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // MODAL BUILDER - Reopen Match
    // ============================================================

    function buildReopenMatchModalHTML() {
        var html = '';
        html += '<form id="at-reopen-match-form">';
        html += renderModalHeader('Reopen Match');
        html += '<div class="modal-body">';
        html += '<p>Reopen this match for editing?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'Any eliminations produced by this match will be ' +
                    'reversed. The match results are preserved; you can ' +
                    'edit them and complete the match again.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Reopen Match</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // MODAL BUILDER - Reopen Exam
    // ============================================================

    function buildReopenExamModalHTML() {
        var html = '';
        html += '<form id="at-reopen-exam-form">';
        html += renderModalHeader('Reopen Exam');
        html += '<div class="modal-body">';
        html += '<p>Reopen this exam for editing?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'The exam\'s status flips back to "Active". Round ' +
                    'and match edit buttons become available again. ' +
                    'This does not touch eliminations or match results.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Reopen Exam</button>';
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
        var eligibleParticipants = isArray(options.eligibleParticipants)
            ? options.eligibleParticipants
            : [];

        var available = eligibleParticipants.length;

        var html = '';
        html += '<form id="at-auto-generate-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '" ' +
                    'data-round-id="' + escapeAttribute(roundId) + '">';
        html += renderModalHeader('Auto-Generate Round');
        html += '<div class="modal-body">';

        html += '<p class="at-auto-info">' +
                    'Eligible participants (not eliminated, not ' +
                    'already in a match this round): ' +
                    '<strong>' + available + '</strong>' +
                '</p>';

        html += '<div class="form-group">';
        html += '<label for="at-auto-match-size">' +
                    'Participants per Match' +
                '</label>';
        html += '<input type="number" id="at-auto-match-size" ' +
                    'class="at-auto-match-size" value="2" min="2" max="20">';
        html += '</div>';

        if (available < 2) {
            html += '<p class="at-auto-warning">' +
                        'Not enough eligible participants to generate a ' +
                        'match.' +
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

    function renderParticipantPicker(eligible, mode) {
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
            var item = eligible[i];
            if (!item || !item.id) { continue; }

            var badge = renderPriorOutcomeBadge(item.priorRoundOutcome);

            html += '<label class="at-picker-item">' +
                        '<input type="checkbox" class="at-picker-check" ' +
                            'value="' + escapeAttribute(item.id) + '">' +
                        '<span class="at-picker-item-name">' +
                            escapeHtml(item.name || '') +
                        '</span>' +
                        badge +
                    '</label>';
        }
        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderPairPicker(eligible) {
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
                var item = eligible[i];
                if (!item || !item.id) { continue; }
                html += '<option value="' + escapeAttribute(item.id) + '">' +
                            escapeHtml(item.name || '') +
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
                // Ignore malformed UI-generated JSON.
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
        var mode = options.mode || 'individuals';
        var isPairExam = options.isPairExam === true;
        var eligible = isArray(options.eligibleParticipants)
            ? options.eligibleParticipants
            : [];

        var html = '';
        html += '<form id="at-add-match-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '" ' +
                    'data-round-id="' + escapeAttribute(roundId) + '">';

        html += renderModalHeader('Add Match');
        html += '<div class="modal-body">';

        if (isPairExam) {
            html += renderPairPicker(eligible);
        } else {
            html += renderParticipantPicker(eligible, mode);
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
        var mode = options.mode || 'individuals';
        var isPairExam = options.isPairExam === true;
        var eligible = isArray(options.eligibleParticipants)
            ? options.eligibleParticipants
            : [];
        var currentParticipants = isArray(options.currentParticipants)
            ? options.currentParticipants
            : [];

        var html = '';
        html += '<form id="at-edit-match-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '" ' +
                    'data-round-id="' + escapeAttribute(roundId) + '" ' +
                    'data-match-id="' + escapeAttribute(matchId) + '">';

        html += renderModalHeader('Edit Match');
        html += '<div class="modal-body">';

        if (isPairExam) {
            html += renderPairPicker(eligible);
        } else {
            html += renderEditParticipantPicker(
                eligible, currentParticipants, mode
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

    function renderEditParticipantPicker(
        eligible,
        currentIds,
        mode
    ) {
        var combined = Object.create(null);
        var ordered = [];

        function addEntry(id, name, priorRoundOutcome) {
            var key = String(id);
            if (combined[key]) { return; }
            combined[key] = {
                id: key,
                name: name,
                priorRoundOutcome: priorRoundOutcome
            };
            ordered.push(combined[key]);
        }

        for (var i = 0; i < eligible.length; i++) {
            var e = eligible[i];
            if (!e || !e.id) { continue; }
            addEntry(
                e.id,
                e.name || '',
                e.priorRoundOutcome
            );
        }

        for (var j = 0; j < currentIds.length; j++) {
            var id = currentIds[j];
            if (!id) { continue; }
            if (combined[String(id)]) { continue; }
            addEntry(id, String(id), null);
        }

        var currentSet = Object.create(null);
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
            var item = ordered[m];
            var isChecked = currentSet[String(item.id)] === true;
            var badge = renderPriorOutcomeBadge(item.priorRoundOutcome);

            html += '<label class="at-picker-item">' +
                        '<input type="checkbox" class="at-picker-check" ' +
                            'value="' + escapeAttribute(item.id) + '"' +
                            (isChecked ? ' checked' : '') + '>' +
                        '<span class="at-picker-item-name">' +
                            escapeHtml(item.name) +
                        '</span>' +
                        badge +
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
        var matchType = options.matchType || 'group_exam';

        var html = '';
        html += '<form id="at-complete-match-form" ' +
                    'data-exam-id="' + escapeAttribute(examId) + '" ' +
                    'data-round-id="' + escapeAttribute(roundId) + '" ' +
                    'data-match-id="' + escapeAttribute(matchId) + '" ' +
                    'data-match-type="' + escapeAttribute(matchType) + '">';

        html += renderModalHeader('Complete Match');
        html += '<div class="modal-body">';

        if (matchType === 'team_vs_team') {
            html += renderTeamCompletionBody(options);
        } else {
            html += renderGroupCompletionBody(options);
        }

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    'Complete Match' +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function renderGroupCompletionBody(options) {
        var participants = isArray(options.participants)
            ? options.participants
            : [];
        var existingResults = options.existingResults || {};

        var html = '';
        html += '<p class="at-picker-hint">' +
                    'Set the result for each participant. Default is Pass. ' +
                    'A Fail marks the participant as eliminated from the ' +
                    'exam.' +
                '</p>';

        if (participants.length === 0) {
            html += '<p class="empty-state small">' +
                        'This match has no participants.' +
                    '</p>';
            return html;
        }

        html += '<div class="at-completion-list">';
        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            if (!p || !p.id) { continue; }
            var current = existingResults[String(p.id)] || '';
            html += '<div class="at-completion-row" ' +
                        'data-participant-id="' + escapeAttribute(p.id) + '">';
            html += '<span class="at-completion-name">' +
                        escapeHtml(p.name || '') +
                    '</span>';
            html += renderResultSelect('result_' + p.id, current);
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function renderTeamCompletionBody(options) {
        var teams = isArray(options.teams) ? options.teams : [];
        var existingTeamResults = options.existingTeamResults || {};
        var existingIndividualResults =
            options.existingIndividualResults || {};

        var html = '';
        html += '<p class="at-picker-hint">' +
                    'Set the result for each team and each member. ' +
                    'All default to Pass. A Fail on an individual member ' +
                    'marks that member as eliminated; a Fail on the team ' +
                    'does not eliminate its members.' +
                '</p>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">' +
                        'This match has no teams.' +
                    '</p>';
            return html;
        }

        html += '<div class="at-team-completion-list">';
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            var teamCurrent = existingTeamResults[String(team.id)] || '';

            html += '<div class="at-team-completion-group" ' +
                        'data-team-id="' + escapeAttribute(team.id) + '">';

            html += '<div class="at-team-completion-team-row">';
            html += '<span class="at-team-completion-name">' +
                        escapeHtml(team.name || '') +
                    '</span>';
            html += renderResultSelect(
                'team_result_' + team.id,
                teamCurrent
            );
            html += '</div>';

            var members = isArray(team.members) ? team.members : [];
            if (members.length > 0) {
                html += '<div class="at-team-completion-members">';
                for (var j = 0; j < members.length; j++) {
                    var m = members[j];
                    if (!m || !m.id) { continue; }
                    var charCurrent = existingIndividualResults[
                        String(m.id)
                    ] || '';
                    html += '<div class="at-team-completion-member-row" ' +
                                'data-character-id="' +
                                    escapeAttribute(m.id) + '">';
                    html += '<span class="at-team-completion-member-name">' +
                                escapeHtml(m.name || '') +
                            '</span>';
                    html += renderResultSelect(
                        'member_result_' + m.id,
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
        var teamGroups = form.querySelectorAll(
            '.at-team-completion-group'
        );
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

    function buildRemoveMatchModalHTML() {
        var html = '';
        html += '<form id="at-remove-match-form">';
        html += renderModalHeader('Remove Match');
        html += '<div class="modal-body">';
        html += '<p>Remove this match?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'If the match was completed, any eliminations it ' +
                    'produced will be reversed.' +
                '</p>';
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

    window.AcademyTournamentView = Object.freeze({
        renderHTML: renderHTML,

        buildCreateExamModalHTML: buildCreateExamModalHTML,
        buildEditExamModalHTML: buildEditExamModalHTML,
        buildDeleteExamModalHTML: buildDeleteExamModalHTML,
        buildAddRoundModalHTML: buildAddRoundModalHTML,
        buildRemoveRoundModalHTML: buildRemoveRoundModalHTML,
        buildReopenRoundModalHTML: buildReopenRoundModalHTML,
        buildAutoGenerateRoundModalHTML: buildAutoGenerateRoundModalHTML,
        buildAddMatchModalHTML: buildAddMatchModalHTML,
        buildEditMatchModalHTML: buildEditMatchModalHTML,
        buildCompleteMatchModalHTML: buildCompleteMatchModalHTML,
        buildReopenMatchModalHTML: buildReopenMatchModalHTML,
        buildReopenExamModalHTML: buildReopenExamModalHTML,
        buildRemoveMatchModalHTML: buildRemoveMatchModalHTML,

        collectCreateExamForm: collectCreateExamForm,
        collectEditExamForm: collectEditExamForm,
        collectAddRoundForm: collectAddRoundForm,
        collectAutoGenerateRoundForm: collectAutoGenerateRoundForm,
        collectAddMatchForm: collectAddMatchForm,
        collectEditMatchForm: collectEditMatchForm,
        collectCompleteMatchForm: collectCompleteMatchForm
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyTournamentView;
        var missing = [];

        var required = [
            'renderHTML',
            'buildCreateExamModalHTML',
            'buildEditExamModalHTML',
            'buildDeleteExamModalHTML',
            'buildAddRoundModalHTML',
            'buildRemoveRoundModalHTML',
            'buildReopenRoundModalHTML',
            'buildAutoGenerateRoundModalHTML',
            'buildAddMatchModalHTML',
            'buildEditMatchModalHTML',
            'buildCompleteMatchModalHTML',
            'buildReopenMatchModalHTML',
            'buildReopenExamModalHTML',
            'buildRemoveMatchModalHTML',
            'collectCreateExamForm',
            'collectEditExamForm',
            'collectAddRoundForm',
            'collectAutoGenerateRoundForm',
            'collectAddMatchForm',
            'collectEditMatchForm',
            'collectCompleteMatchForm'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyTournamentView] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();