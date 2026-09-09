/**
 * modules/tournaments/tournaments-render.js - Tournament Rendering
 * PURE rendering functions. Takes data, returns HTML.
 * Does NOT mutate data or attach event handlers.
 * Path: js/modules/tournaments/tournaments-render.js
 * 
 * RENDER PHILOSOPHY:
 *   - All rendering is PURE: data in, HTML out
 *   - No direct window.data access
 *   - No calls to Queries, Core, or Aggregator
 *   - Does NOT attach event handlers (UI layer handles that)
 *   - Does NOT make decisions about data meaning
 *   - Uses CSS classes over inline styles
 *   - Escapes all user-controlled content
 *   - All data should be pre-resolved by Aggregator
 * 
 * IMPORTANT:
 *   - This module receives data from Aggregator
 *   - It does NOT fetch data itself
 *   - All display names are pre-resolved
 *   - All status/outcome displays are pre-computed
 *   - No domain logic - purely presentation
 * 
 * DEPENDENCIES:
 *   - window.DomUtils (for escapeHtml) - MANDATORY
 *   - window.CalendarConstants (for bounds in forms) - MANDATORY
 * 
 * USAGE:
 *   var Render = window.TournamentsRender;
 *   var html = Render.renderList(viewModel);
 *   var detail = Render.renderDetail(viewModel);
 *   var form = Render.renderForm(tournament, modeOptions, statusOptions);
 */

(function() {
    'use strict';

    if (window.__tournamentsRenderLoaded) {
        return;
    }

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getDomUtils() {
        return window.DomUtils || null;
    }

    function getCalendarConstants() {
        return window.CalendarConstants || window.CALENDAR_CONSTANTS || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getDomUtils()) {
            missing.push('DomUtils (lazy)');
        }
        if (!getCalendarConstants()) {
            missing.push('CalendarConstants (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[TournamentsRender] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Fallback
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // CONSTANTS - Lazy loaded from CalendarConstants
    // ============================================================

    function getConstants() {
        var CC = getCalendarConstants();
        if (CC) {
            return {
                MIN_WEEK: CC.MIN_WEEK || 1,
                MAX_WEEK: CC.MAX_WEEK || 52,
                MIN_DAY: CC.MIN_DAY || 1,
                MAX_DAY: CC.MAX_DAY || 7,
                MIN_HOUR: CC.MIN_HOUR || 0,
                MAX_HOUR: CC.MAX_HOUR || 23,
                CALENDAR_START_HOUR: CC.CALENDAR_START_HOUR || 5,
                CALENDAR_END_HOUR: CC.CALENDAR_END_HOUR || 23,
                MIN_CLASS_DURATION: CC.MIN_CLASS_DURATION || 1,
                MAX_CLASS_DURATION: CC.MAX_CLASS_DURATION || 4,
                DAY_NAMES_SHORT: CC.DAY_NAMES_SHORT || ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            };
        }
        return {
            MIN_WEEK: 1,
            MAX_WEEK: 52,
            MIN_DAY: 1,
            MAX_DAY: 7,
            MIN_HOUR: 0,
            MAX_HOUR: 23,
            CALENDAR_START_HOUR: 5,
            CALENDAR_END_HOUR: 23,
            MIN_CLASS_DURATION: 1,
            MAX_CLASS_DURATION: 4,
            DAY_NAMES_SHORT: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        };
    }

    // ============================================================
    // DISPLAY HELPERS (PURE - no data access)
    // ============================================================

    /**
     * Get outcome display for a participant.
     * 
     * @param {string} outcome - Outcome type
     * @returns {object} { text: string, class: string, label: string }
     */
    function getOutcomeDisplay(outcome) {
        var map = {
            'winner': { text: '★', class: 'outcome-winner', label: 'Winner' },
            'advancing': { text: '→', class: 'outcome-advancing', label: 'Advancing' },
            'eliminated': { text: '✘', class: 'outcome-eliminated', label: 'Eliminated' },
            'passed': { text: '✓', class: 'outcome-passed', label: 'Passed' },
            'failed': { text: '✗', class: 'outcome-failed', label: 'Failed' },
            'pending': { text: '⏳', class: 'outcome-pending', label: 'Pending' },
            'unknown': { text: '?', class: 'outcome-unknown', label: 'Unknown' }
        };
        return map[outcome] || { text: '?', class: 'outcome-unknown', label: 'Unknown' };
    }

    /**
     * Get tournament status display.
     * 
     * @param {string} status - Tournament status
     * @returns {object} { text: string, class: string }
     */
    function getTournamentStatusDisplay(status) {
        var map = {
            'draft': { text: 'Draft', class: 'status-draft' },
            'active': { text: 'Active', class: 'status-active' },
            'completed': { text: 'Completed', class: 'status-completed' }
        };
        return map[status] || { text: status || 'Unknown', class: 'status-unknown' };
    }

    /**
     * Get round status display.
     * 
     * @param {string} status - Round status
     * @returns {object} { text: string, class: string }
     */
    function getRoundStatusDisplay(status) {
        var map = {
            'pending': { text: 'Pending', class: 'round-status-pending' },
            'in_progress': { text: 'In Progress', class: 'round-status-in-progress' },
            'completed': { text: 'Completed', class: 'round-status-completed' }
        };
        return map[status] || { text: status || 'Unknown', class: 'round-status-unknown' };
    }

    /**
     * Get match status display.
     * 
     * @param {string} status - Match status
     * @returns {object} { text: string, class: string }
     */
    function getMatchStatusDisplay(status) {
        var map = {
            'pending': { text: 'Pending', class: 'match-status-pending' },
            'in_progress': { text: 'In Progress', class: 'match-status-in-progress' },
            'completed': { text: 'Completed', class: 'match-status-completed' }
        };
        return map[status] || { text: status || 'Unknown', class: 'match-status-unknown' };
    }

    /**
     * Get participant type label.
     * 
     * @param {string} type - Participant type
     * @returns {string} Label
     */
    function getParticipantTypeLabel(type) {
        if (type === 'character') {
            return 'Character';
        }
        if (type === 'team') {
            return 'Team';
        }
        return 'Unknown';
    }

    // ============================================================
    // RENDER API - Pure functions
    // ============================================================

    /**
     * Render a tournament list from a view model.
     * 
     * @param {object} listVM - List view model from Aggregator
     * @returns {string} HTML string
     */
    function renderList(listVM) {
        var tournaments = listVM && listVM.tournaments ? listVM.tournaments : [];

        if (tournaments.length === 0) {
            return '<p class="empty-state">No tournaments found. Create your first tournament!</p>';
        }

        var html = '';
        html += '<div class="list-header tourn-header">';
        html += '<span>Name</span>';
        html += '<span>Mode</span>';
        html += '<span>Rounds</span>';
        html += '<span>Participants</span>';
        html += '<span>Status</span>';
        html += '<span>Actions</span>';
        html += '</div>';

        for (var i = 0; i < tournaments.length; i++) {
            var tourn = tournaments[i];
            var statusDisplay = getTournamentStatusDisplay(tourn.status);
            var isComplete = tourn.hasWinner && tourn.roundCount > 0;

            html += '<div class="list-item tourn-item" data-id="' + escapeAttribute(tourn.id) + '">';
            html += '<span><strong>' + escapeHtml(tourn.name) + '</strong>' +
                (isComplete && tourn.winnerName ? ' ★ ' + escapeHtml(tourn.winnerName) : '') +
                (tourn.graduatingClassName ? ' <span class="class-tag">' + escapeHtml(tourn.graduatingClassName) + '</span>' : '') +
                '</span>';
            html += '<span class="tourn-mode">' + escapeHtml(tourn.modeLabel || tourn.mode) + '</span>';
            html += '<span class="tourn-rounds">' + tourn.roundCount + '/' + tourn.totalRounds + '</span>';
            html += '<span class="tourn-participants">' + tourn.participantCount + '</span>';
            html += '<span class="tourn-status ' + statusDisplay.class + '">' + escapeHtml(statusDisplay.text) + '</span>';
            html += '<span class="actions">';
            html += '<button class="small view-tournament-btn" data-id="' + escapeAttribute(tourn.id) + '">View</button>';
            html += '<button class="small edit-tournament-btn" data-id="' + escapeAttribute(tourn.id) + '">Edit</button>';
            html += '<button class="small danger delete-tournament-btn" data-id="' + escapeAttribute(tourn.id) + '">Delete</button>';
            html += '</span>';
            html += '</div>';
        }

        return html;
    }

    /**
     * Render a tournament grid from a view model.
     * 
     * @param {object} listVM - List view model from Aggregator
     * @returns {string} HTML string
     */
    function renderGrid(listVM) {
        var tournaments = listVM && listVM.tournaments ? listVM.tournaments : [];

        if (tournaments.length === 0) {
            return '<p class="empty-state">No tournaments found.</p>';
        }

        var html = '<div class="tournament-grid">';
        for (var i = 0; i < tournaments.length; i++) {
            var tourn = tournaments[i];
            html += renderGridCard(tourn);
        }
        html += '</div>';

        return html;
    }

    /**
     * Render a tournament grid card.
     * 
     * @param {object} tourn - Tournament list item
     * @returns {string} HTML string
     */
    function renderGridCard(tourn) {
        var statusDisplay = getTournamentStatusDisplay(tourn.status);

        var html = '';
        html += '<div class="tournament-card" data-id="' + escapeAttribute(tourn.id) + '">';
        html += '<div class="tournament-card-header">';
        html += '<span class="tournament-card-name">' + escapeHtml(tourn.name) + '</span>';
        if (tourn.graduatingClassName) {
            html += '<span class="class-tag">' + escapeHtml(tourn.graduatingClassName) + '</span>';
        }
        html += '<span class="tournament-card-status ' + statusDisplay.class + '">' + escapeHtml(statusDisplay.text) + '</span>';
        html += '</div>';
        html += '<div class="tournament-card-body">';
        html += '<div class="tournament-card-stats">';
        html += '<span class="stat">' + tourn.participantCount + ' participants</span>';
        html += '<span class="stat">' + tourn.roundCount + ' rounds</span>';
        if (tourn.hasWinner && tourn.winnerName) {
            html += '<span class="stat winner">★ ' + escapeHtml(tourn.winnerName) + '</span>';
        }
        html += '</div>';
        html += '<div class="tournament-card-meta">';
        html += '<span class="mode">' + escapeHtml(tourn.modeLabel || tourn.mode) + '</span>';
        html += '<span class="created-at">' + formatDate(tourn.createdAt) + '</span>';
        html += '</div>';
        html += '</div>';
        html += '<div class="tournament-card-actions">';
        html += '<button class="view-tournament-btn small" data-id="' + escapeAttribute(tourn.id) + '">View</button>';
        html += '<button class="edit-tournament-btn small" data-id="' + escapeAttribute(tourn.id) + '">Edit</button>';
        html += '<button class="delete-tournament-btn small danger" data-id="' + escapeAttribute(tourn.id) + '">Delete</button>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    /**
     * Render tournament detail from a view model.
     * 
     * @param {object} detailVM - Detail view model from Aggregator
     * @returns {string} HTML string
     */
    function renderDetail(detailVM) {
        if (!detailVM) {
            return '<p class="empty-state">Tournament not found.</p>';
        }

        var html = '';
        html += renderInfo(detailVM);
        html += renderParticipants(detailVM);
        html += renderRounds(detailVM);
        html += renderEliminations(detailVM);
        html += renderWinner(detailVM);

        return html;
    }

    /**
     * Render tournament info section.
     * 
     * @param {object} detailVM - Detail view model
     * @returns {string} HTML string
     */
    function renderInfo(detailVM) {
        if (!detailVM) {
            return '';
        }

        var statusDisplay = getTournamentStatusDisplay(detailVM.status);
        var isComplete = detailVM.hasWinner && detailVM.roundCount > 0;

        var html = '<div class="tourn-info">';
        html += '<span class="tourn-info-item"><strong>' + escapeHtml(detailVM.name) + '</strong></span>';
        html += '<span class="tourn-info-item">Mode: <strong>' + escapeHtml(detailVM.modeLabel || detailVM.mode) + '</strong></span>';
        html += '<span class="tourn-info-item">Weeks ' + escapeHtml(detailVM.startWeek) + ' - ' + escapeHtml(detailVM.endWeek) + '</span>';
        html += '<span class="tourn-info-item">Rounds: ' + detailVM.roundCount + '/' + detailVM.totalRounds + '</span>';
        html += '<span class="tourn-info-item">Status: <span class="tourn-status ' + statusDisplay.class + '">' + escapeHtml(statusDisplay.text) + '</span></span>';
        if (detailVM.graduatingClassName) {
            html += '<span class="tourn-info-item">Class: <strong>' + escapeHtml(detailVM.graduatingClassName) + '</strong></span>';
        }
        if (isComplete && detailVM.winner) {
            html += '<span class="tourn-info-item tourn-winner-badge">Winner: ' + escapeHtml(detailVM.winner.name) + '</span>';
        }
        html += '</div>';

        return html;
    }

    /**
     * Render participants section.
     * 
     * @param {object} detailVM - Detail view model
     * @returns {string} HTML string
     */
    function renderParticipants(detailVM) {
        var participants = detailVM.participants || [];
        var isComplete = detailVM.status === 'completed';
        var hasHistory = detailVM.roundCount > 0;

        var html = '<div class="tourn-section participants-section">';
        html += '<h4 class="section-title">Participants (' + participants.length + ')</h4>';

        if (participants.length === 0) {
            html += '<span class="empty-message">No participants added</span>';
        } else {
            html += '<div class="participant-list">';
            for (var i = 0; i < participants.length; i++) {
                var p = participants[i];
                var classes = 'participant-tag';
                if (p.eliminated) {
                    classes += ' eliminated';
                }
                if (detailVM.winner && String(detailVM.winner.id) === String(p.id)) {
                    classes += ' winner';
                }

                html += '<span class="' + classes + '">';
                html += escapeHtml(p.name);
                html += ' <span class="participant-type">(' + escapeHtml(p.typeLabel || p.type) + ')</span>';
                if (p.eliminated) {
                    html += ' ✘';
                }
                if (detailVM.winner && String(detailVM.winner.id) === String(p.id)) {
                    html += ' ★';
                }
                html += '</span>';
            }
            html += '</div>';
        }

        html += '</div>';

        return html;
    }

    /**
     * Render rounds section.
     * 
     * @param {object} detailVM - Detail view model
     * @returns {string} HTML string
     */
    function renderRounds(detailVM) {
        var rounds = detailVM.rounds || [];
        var isComplete = detailVM.status === 'completed';

        var html = '<div class="tourn-section rounds-section">';
        html += '<div class="section-header">';
        html += '<h4 class="section-title">Rounds</h4>';
        html += '<span class="rounds-count">' + rounds.length + ' / ' + detailVM.totalRounds + ' rounds</span>';
        html += '</div>';

        if (rounds.length === 0) {
            html += '<p class="empty-message">No rounds created.</p>';
        } else {
            for (var i = 0; i < rounds.length; i++) {
                var round = rounds[i];
                var statusDisplay = getRoundStatusDisplay(round.status);

                html += '<div class="round-item" data-round="' + i + '">';
                html += '<div class="round-header">';
                html += '<div class="round-title">';
                html += '<strong>Round ' + round.roundNumber + '</strong>';
                html += ' <span class="round-matches">(' + round.matchCount + ' matches)</span>';
                html += ' <span class="round-status ' + statusDisplay.class + '">' + statusDisplay.text + '</span>';
                html += '</div>';
                if (!isComplete) {
                    html += '<div class="round-actions">';
                    html += '<button class="small edit-round-btn" data-round="' + i + '">Edit</button>';
                    html += '<button class="small danger delete-round-btn" data-round="' + i + '">Delete</button>';
                    html += '</div>';
                }
                html += '</div>';

                if (round.matches && round.matches.length > 0) {
                    html += '<div class="match-list">';
                    for (var j = 0; j < round.matches.length; j++) {
                        var match = round.matches[j];
                        html += renderMatchItem(match, i, j, isComplete);
                    }
                    html += '</div>';
                }

                html += '</div>';
            }
        }

        html += '</div>';

        return html;
    }

    /**
     * Render a single match item.
     * 
     * @param {object} match - Match view model
     * @param {number} roundIndex - Round index
     * @param {number} matchIndex - Match index
     * @param {boolean} isComplete - Tournament complete
     * @returns {string} HTML string
     */
    function renderMatchItem(match, roundIndex, matchIndex, isComplete) {
        var statusDisplay = getMatchStatusDisplay(match.status);

        var html = '<div class="match-item" data-round="' + roundIndex + '" data-match="' + matchIndex + '">';

        var namesHtml = '';
        if (match.participants && match.participants.length > 0) {
            for (var k = 0; k < match.participants.length; k++) {
                var p = match.participants[k];
                var outcomeDisplay = getOutcomeDisplay(p.outcome);
                if (k > 0) {
                    namesHtml += ' <span class="match-vs">vs</span> ';
                }
                namesHtml += '<span class="match-participant ' + outcomeDisplay.class + '" data-id="' + escapeAttribute(p.id) + '">';
                namesHtml += escapeHtml(p.name);
                if (outcomeDisplay.text) {
                    namesHtml += ' ' + outcomeDisplay.text;
                }
                namesHtml += '</span>';
            }
        } else {
            namesHtml = '<span class="match-empty">TBD</span>';
        }

        html += '<span class="match-participants">' + namesHtml + '</span>';

        if (match.isGroupExam) {
            html += '<span class="match-type-badge">Exam</span>';
        }

        html += '<span class="match-status ' + statusDisplay.class + '">' + statusDisplay.text + '</span>';

        if (!isComplete && match.status !== 'completed') {
            html += '<button class="small edit-match-btn" data-round="' + roundIndex + '" data-match="' + matchIndex + '">Edit</button>';
            html += '<button class="small complete-match-btn" data-round="' + roundIndex + '" data-match="' + matchIndex + '">Complete</button>';
        }

        html += '</div>';

        return html;
    }

    /**
     * Render eliminations section.
     * 
     * @param {object} detailVM - Detail view model
     * @returns {string} HTML string
     */
    function renderEliminations(detailVM) {
        var eliminations = detailVM.eliminations || [];
        var isComplete = detailVM.status === 'completed';

        var html = '<div class="tourn-section eliminations-section">';
        html += '<h4 class="section-title">Eliminations</h4>';

        if (eliminations.length === 0) {
            html += '<span class="empty-message">No eliminations</span>';
        } else {
            html += '<div class="elimination-list">';
            for (var i = 0; i < eliminations.length; i++) {
                var e = eliminations[i];
                html += '<span class="elimination-tag">';
                html += escapeHtml(e.participantName || e.participantId);
                html += ' ✘';
                html += ' <span class="elimination-detail">(' + escapeHtml(e.reason || 'Eliminated') + ', Week ' + escapeHtml(e.week) + ')</span>';
                html += '</span>';
            }
            html += '</div>';
        }

        html += '</div>';

        return html;
    }

    /**
     * Render winner section.
     * 
     * @param {object} detailVM - Detail view model
     * @returns {string} HTML string
     */
    function renderWinner(detailVM) {
        var html = '<div class="tourn-section winner-section">';
        html += '<h4 class="section-title">Tournament Winner</h4>';

        if (detailVM.hasWinner && detailVM.winner) {
            html += '<div class="winner-display">';
            html += '<span class="winner-name">' + escapeHtml(detailVM.winner.name) + '</span>';
            html += '<span class="winner-type">(' + escapeHtml(detailVM.winner.typeLabel || detailVM.winner.type) + ')</span>';
            html += '</div>';
        } else if (detailVM.status === 'completed') {
            html += '<span class="empty-message">Winner not set</span>';
        } else {
            html += '<span class="pending-message">Tournament in progress</span>';
        }

        html += '</div>';

        return html;
    }

    /**
     * Render tournament form.
     * 
     * @param {object} tournament - Tournament data (optional)
     * @param {array} modeOptions - Array of mode options
     * @param {array} statusOptions - Array of status options
     * @param {array} classOptions - Array of class options for dropdown
     * @returns {string} HTML string
     */
    function renderForm(tournament, modeOptions, statusOptions, classOptions) {
        var isEdit = !!tournament;
        var t = tournament || {};
        var constants = getConstants();

        modeOptions = Array.isArray(modeOptions) ? modeOptions : ['teams', 'individuals'];
        statusOptions = Array.isArray(statusOptions) ? statusOptions : ['draft', 'active', 'completed'];
        classOptions = Array.isArray(classOptions) ? classOptions : [];

        var html = '<form class="tournament-form" id="tournament-form" data-edit-id="' + (isEdit ? escapeAttribute(t.id) : '') + '">';

        // Name
        html += '<div class="form-group">';
        html += '<label>Tournament Name *</label>';
        html += '<input type="text" id="tournament-name" class="tournament-name" value="' + escapeHtml(t.name || '') + '" required>';
        html += '</div>';

        // Mode
        html += '<div class="form-group">';
        html += '<label>Mode</label>';
        html += '<select id="tournament-mode" class="tournament-mode">';
        for (var i = 0; i < modeOptions.length; i++) {
            var mode = modeOptions[i];
            var selected = t.mode === mode ? ' selected' : '';
            html += '<option value="' + escapeAttribute(mode) + '"' + selected + '>' + escapeHtml(mode.charAt(0).toUpperCase() + mode.slice(1)) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Week range
        html += '<div class="form-row">';
        html += '<div class="form-group">';
        html += '<label>Start Week</label>';
        html += '<input type="number" id="tournament-start-week" class="tournament-start-week" value="' + escapeHtml(t.startWeek || constants.MIN_WEEK) + '" min="' + constants.MIN_WEEK + '" max="' + constants.MAX_WEEK + '">';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label>End Week</label>';
        html += '<input type="number" id="tournament-end-week" class="tournament-end-week" value="' + escapeHtml(t.endWeek || constants.MAX_WEEK) + '" min="' + constants.MIN_WEEK + '" max="' + constants.MAX_WEEK + '">';
        html += '</div>';
        html += '</div>';

        // Total rounds
        html += '<div class="form-group">';
        html += '<label>Total Rounds</label>';
        html += '<input type="number" id="tournament-total-rounds" class="tournament-total-rounds" value="' + escapeHtml(t.totalRounds || 1) + '" min="1">';
        html += '</div>';

        // Graduating class
        html += '<div class="form-group" id="class-filter-group">';
        html += '<label>Graduating Class</label>';
        html += '<select id="tournament-class" class="tournament-class">';
        html += '<option value="">None</option>';
        for (var i = 0; i < classOptions.length; i++) {
            var cls = classOptions[i];
            var selected = t.graduatingClassId && String(cls.id) === String(t.graduatingClassId) ? ' selected' : '';
            html += '<option value="' + escapeAttribute(cls.id) + '"' + selected + '>' + escapeHtml(cls.name || cls.id) + '</option>';
        }
        html += '</select>';
        html += '<div style="margin-top:4px;display:flex;align-items:center;gap:6px;">';
        var filterChecked = t.classFilterEnabled !== false;
        html += '<input type="checkbox" id="tournament-class-filter-enabled" class="tournament-class-filter-enabled" ' + (filterChecked ? 'checked' : '') + '>';
        html += '<label for="tournament-class-filter-enabled" style="font-size:0.7rem;color:var(--text-dim);">Only allow characters from this class</label>';
        html += '</div>';
        html += '</div>';

        // Status
        html += '<div class="form-group">';
        html += '<label>Status</label>';
        html += '<select id="tournament-status" class="tournament-status">';
        for (var i = 0; i < statusOptions.length; i++) {
            var status = statusOptions[i];
            var selected = t.status === status ? ' selected' : '';
            html += '<option value="' + escapeAttribute(status) + '"' + selected + '>' + escapeHtml(status.charAt(0).toUpperCase() + status.slice(1)) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Actions
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-form-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' + (isEdit ? 'Update' : 'Create') + ' Tournament</button>';
        html += '</div>';

        html += '</form>';

        return html;
    }

    /**
     * Render add participant form.
     * 
     * @param {object} tournament - Tournament object
     * @param {array} availableParticipants - Array of available participants
     * @param {string} canonicalType - 'character' or 'team'
     * @param {string} typeLabel - 'Character' or 'Team'
     * @returns {string} HTML string
     */
    function renderAddParticipantForm(tournament, availableParticipants, canonicalType, typeLabel) {
        var html = '';
        html += '<form id="add-participant-form" data-tournament-id="' + escapeAttribute(tournament.id) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Add Participant</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // Participant type
        html += '<div class="form-group">';
        html += '<label>Type</label>';
        html += '<select id="participant-type-select" class="participant-type-select">';
        html += '<option value="' + escapeAttribute(canonicalType) + '">' + escapeHtml(typeLabel) + '</option>';
        html += '</select>';
        html += '</div>';

        // Participant select
        html += '<div class="form-group">';
        html += '<label>Select ' + escapeHtml(typeLabel) + '</label>';
        html += '<select id="participant-select" class="participant-select" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < availableParticipants.length; i++) {
            var p = availableParticipants[i];
            html += '<option value="' + escapeAttribute(p.id) + '">' + escapeHtml(p.name) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-add-participant secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Add Participant</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    /**
     * Render add match form.
     * 
     * @param {object} tournament - Tournament object
     * @param {number} roundIndex - Round index
     * @param {array} activeParticipants - Active participants for this round
     * @returns {string} HTML string
     */
    function renderAddMatchForm(tournament, roundIndex, activeParticipants) {
        var html = '';
        html += '<form id="add-match-form" data-tournament-id="' + escapeAttribute(tournament.id) + '" data-round-index="' + escapeAttribute(roundIndex) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Add Match - Round ' + (roundIndex + 1) + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // Match type
        html += '<div class="form-group">';
        html += '<label>Match Type</label>';
        html += '<select id="match-type" class="match-type">';
        html += '<option value="standard">Standard</option>';
        html += '<option value="group_exam">Group Exam</option>';
        html += '</select>';
        html += '</div>';

        // Participants
        html += '<div class="form-group">';
        html += '<label>Participant 1</label>';
        html += '<select id="match-participant-1" class="match-participant-1" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < activeParticipants.length; i++) {
            var p = activeParticipants[i];
            html += '<option value="' + escapeAttribute(p.id) + '">' + escapeHtml(p.name) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Participant 2</label>';
        html += '<select id="match-participant-2" class="match-participant-2" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < activeParticipants.length; i++) {
            var p = activeParticipants[i];
            html += '<option value="' + escapeAttribute(p.id) + '">' + escapeHtml(p.name) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-add-match secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Add Match</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    /**
     * Render edit match form.
     * 
     * @param {object} tournament - Tournament object
     * @param {number} roundIndex - Round index
     * @param {object} match - Match object
     * @param {array} activeParticipants - Active participants
     * @returns {string} HTML string
     */
    function renderEditMatchForm(tournament, roundIndex, match, activeParticipants) {
        var html = '';
        html += '<form id="edit-match-form" data-tournament-id="' + escapeAttribute(tournament.id) + '" data-round-index="' + escapeAttribute(roundIndex) + '" data-match-id="' + escapeAttribute(match.id || '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>Edit Match</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // Match type
        html += '<div class="form-group">';
        html += '<label>Match Type</label>';
        html += '<select id="match-type" class="match-type">';
        html += '<option value="standard"' + (match.type === 'standard' ? ' selected' : '') + '>Standard</option>';
        html += '<option value="group_exam"' + (match.type === 'group_exam' ? ' selected' : '') + '>Group Exam</option>';
        html += '</select>';
        html += '</div>';

        // Participants
        html += '<div class="form-group">';
        html += '<label>Participant 1</label>';
        html += '<select id="match-participant-1" class="match-participant-1" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < activeParticipants.length; i++) {
            var p = activeParticipants[i];
            var selected = match.participants && match.participants[0] === p.id ? ' selected' : '';
            html += '<option value="' + escapeAttribute(p.id) + '"' + selected + '>' + escapeHtml(p.name) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Participant 2</label>';
        html += '<select id="match-participant-2" class="match-participant-2" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < activeParticipants.length; i++) {
            var p = activeParticipants[i];
            var selected = match.participants && match.participants[1] === p.id ? ' selected' : '';
            html += '<option value="' + escapeAttribute(p.id) + '"' + selected + '>' + escapeHtml(p.name) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-edit-match secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Update Match</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    /**
     * Render complete match form.
     * 
     * @param {object} tournament - Tournament object
     * @param {number} roundIndex - Round index
     * @param {object} match - Match object
     * @returns {string} HTML string
     */
    function renderCompleteMatchForm(tournament, roundIndex, match) {
        var html = '';
        html += '<form id="complete-match-form" data-tournament-id="' + escapeAttribute(tournament.id) + '" data-round-index="' + escapeAttribute(roundIndex) + '" data-match-id="' + escapeAttribute(match.id || '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>Complete Match</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="match-info">Select the winner for this match.</p>';

        // Winner select
        html += '<div class="form-group">';
        html += '<label>Winner</label>';
        html += '<select id="match-winner-select" class="match-winner-select" required>';
        html += '<option value="">Select winner...</option>';
        if (match.participants) {
            for (var i = 0; i < match.participants.length; i++) {
                var id = match.participants[i];
                var name = match.participantNames ? match.participantNames[i] : id;
                html += '<option value="' + escapeAttribute(id) + '">' + escapeHtml(name) + '</option>';
            }
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-complete-match secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Complete Match</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    /**
     * Render filter bar.
     * 
     * @param {object} filters - Filter values
     * @param {object} options - Filter options (statuses, modes)
     * @returns {string} HTML string
     */
    function renderFilterBar(filters, options) {
        options = options || {};
        var statuses = options.statuses || ['all', 'draft', 'active', 'completed'];
        var modes = options.modes || ['all', 'teams', 'individuals'];

        var status = filters.status || 'all';
        var search = filters.search || '';
        var mode = filters.mode || 'all';

        var html = '';
        html += '<div class="tournament-filters">';

        // Status filter
        html += '<div class="filter-group">';
        html += '<select id="tournament-status-filter" class="tournament-status-filter">';
        for (var i = 0; i < statuses.length; i++) {
            var s = statuses[i];
            var selected = s === status ? ' selected' : '';
            var label = s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1);
            html += '<option value="' + escapeAttribute(s) + '"' + selected + '>' + escapeHtml(label) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Mode filter
        html += '<div class="filter-group">';
        html += '<select id="tournament-mode-filter" class="tournament-mode-filter">';
        for (var i = 0; i < modes.length; i++) {
            var m = modes[i];
            var selected = m === mode ? ' selected' : '';
            var label = m === 'all' ? 'All Modes' : m.charAt(0).toUpperCase() + m.slice(1);
            html += '<option value="' + escapeAttribute(m) + '"' + selected + '>' + escapeHtml(label) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Search
        html += '<div class="filter-group search-group">';
        html += '<input type="text" id="tournament-search-filter" class="tournament-search-filter" placeholder="Search tournaments..." value="' + escapeHtml(search) + '">';
        html += '</div>';

        // Clear
        html += '<button id="clear-tournament-filters" class="clear-tournament-filters small secondary">Clear</button>';

        html += '</div>';

        return html;
    }

    /**
     * Format date for display.
     * 
     * @param {string} dateString - ISO date string
     * @returns {string} Formatted date or 'Recent'
     */
    function formatDate(dateString) {
        if (!dateString) {
            return 'Recent';
        }
        var date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return 'Recent';
        }
        var now = new Date();
        var diff = now - date;
        var days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days < 1) {
            return 'Today';
        }
        if (days < 7) {
            return days + 'd ago';
        }
        return date.toLocaleDateString();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsRender = {
        // List/Grid
        renderList: renderList,
        renderGrid: renderGrid,
        renderGridCard: renderGridCard,

        // Detail
        renderDetail: renderDetail,
        renderInfo: renderInfo,
        renderParticipants: renderParticipants,
        renderRounds: renderRounds,
        renderMatchItem: renderMatchItem,
        renderEliminations: renderEliminations,
        renderWinner: renderWinner,

        // Forms
        renderForm: renderForm,
        renderAddParticipantForm: renderAddParticipantForm,
        renderAddMatchForm: renderAddMatchForm,
        renderEditMatchForm: renderEditMatchForm,
        renderCompleteMatchForm: renderCompleteMatchForm,

        // Filters
        renderFilterBar: renderFilterBar,

        // Display helpers (pure)
        getOutcomeDisplay: getOutcomeDisplay,
        getTournamentStatusDisplay: getTournamentStatusDisplay,
        getRoundStatusDisplay: getRoundStatusDisplay,
        getMatchStatusDisplay: getMatchStatusDisplay,
        getParticipantTypeLabel: getParticipantTypeLabel,
        formatDate: formatDate,

        // Escaping
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentsRender;
        var missing = [];

        var required = [
            'renderList', 'renderGrid', 'renderGridCard',
            'renderDetail', 'renderInfo', 'renderParticipants',
            'renderRounds', 'renderMatchItem', 'renderEliminations',
            'renderWinner',
            'renderForm', 'renderAddParticipantForm',
            'renderAddMatchForm', 'renderEditMatchForm',
            'renderCompleteMatchForm',
            'renderFilterBar',
            'getOutcomeDisplay', 'getTournamentStatusDisplay',
            'getRoundStatusDisplay', 'getMatchStatusDisplay',
            'getParticipantTypeLabel', 'formatDate',
            'escapeHtml', 'escapeAttribute'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentsRender] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentsRender] All exports verified successfully.');
        }
    })();

})();
