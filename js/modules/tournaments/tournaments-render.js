/**
 * js/modules/tournaments/tournaments-render.js - Tournament Rendering
 * PURE rendering functions. Takes data, returns HTML.
 * Does NOT mutate data or attach event handlers.
 * Path: js/modules/tournaments/tournaments-render.js
 * 
 * RENDER PHILOSOPHY:
 *   - All rendering is PURE: data in, HTML out
 *   - Delegates interpretation to Queries
 *   - Uses CSS classes over inline styles
 *   - Escapes all user-controlled content
 *   - Does NOT attach event handlers (UI layer handles that)
 *   - Does NOT make decisions about data meaning (Queries does that)
 *   - Participant type is determined by Queries (canonical)
 * 
 * PARTICIPANT TYPE CONTRACT:
 *   - Queries is the SINGLE AUTHORITY for participant type resolution.
 *   - This module uses Queries.getTournamentParticipantName() and
 *     Queries.getTournamentParticipantType() exclusively.
 *   - Tournament.mode is the canonical source; Queries enforces this.
 * 
 * DEPENDENCIES:
 *   - window.TournamentsQueries - REQUIRED
 *   - window.CalendarConstants - REQUIRED (for calendar bounds in forms)
 *   - window.CalendarValidation - REQUIRED (for week validation)
 * 
 * USAGE:
 *   var Render = window.TournamentsRender;
 *   var html = Render.renderList(tournaments);
 *   var detail = Render.renderDetail(tournament);
 *   var form = Render.renderForm(tournament, modeOptions, statusOptions);
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__tournamentsRenderLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.TournamentsQueries) {
        missing.push('TournamentsQueries');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation) {
        missing.push('CalendarValidation');
    }

    if (missing.length > 0) {
        throw new Error('[TournamentsRender] Missing dependencies: ' + missing.join(', '));
    }

    window.__tournamentsRenderLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Queries = window.TournamentsQueries;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var CALENDAR_START_HOUR = CalendarConstants.CALENDAR_START_HOUR;
    var CALENDAR_END_HOUR = CalendarConstants.CALENDAR_END_HOUR;
    var MAX_DURATION = CalendarConstants.MAX_CLASS_DURATION;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getOutcomeDisplay(outcome) {
        var map = {
            'winner': { text: '★', class: 'outcome-winner' },
            'advancing': { text: '→', class: 'outcome-advancing' },
            'eliminated': { text: '✘', class: 'outcome-eliminated' },
            'passed': { text: '✓', class: 'outcome-passed' },
            'failed': { text: '✗', class: 'outcome-failed' },
            'pending': { text: '⏳', class: 'outcome-pending' },
            'unknown': { text: '?', class: 'outcome-unknown' }
        };
        return map[outcome] || { text: '', class: 'outcome-unknown' };
    }

    function getTournamentStatusDisplay(status) {
        var map = {
            'draft': { text: 'Draft', class: 'status-draft' },
            'active': { text: 'Active', class: 'status-active' },
            'completed': { text: 'Completed', class: 'status-completed' }
        };
        return map[status] || { text: status || 'Unknown', class: 'status-unknown' };
    }

    function getRoundStatusDisplay(status) {
        var map = {
            'empty': { text: 'Empty', class: 'status-empty' },
            'pending': { text: 'Pending', class: 'status-pending' },
            'in_progress': { text: 'In Progress', class: 'status-in-progress' },
            'completed': { text: 'Completed', class: 'status-completed' }
        };
        return map[status] || { text: status || 'Unknown', class: 'status-unknown' };
    }

    function getCanonicalParticipantType(mode) {
        return Queries.getCanonicalParticipantType(mode);
    }

    function getParticipantName(tournament, id) {
        if (!tournament) {
            return 'Unknown';
        }
        return Queries.getTournamentParticipantName(tournament, id);
    }

    function getParticipantType(tournament, id) {
        if (!tournament) {
            return 'unknown';
        }
        return Queries.getTournamentParticipantType(tournament, id);
    }

    function getWeekRange() {
        return {
            min: MIN_WEEK,
            max: MAX_WEEK
        };
    }

    function getWinnerName(tournament) {
        return Queries.getWinnerName(tournament);
    }

    function isTournamentComplete(tournament) {
        return Queries.isTournamentComplete(tournament);
    }

    function getParticipantCount(tournament) {
        return Queries.getParticipantCount(tournament);
    }

    function getRoundCount(tournament) {
        return Queries.getRoundCount(tournament);
    }

    function getMatchCount(tournament, roundIndex) {
        return Queries.getMatchCount(tournament, roundIndex);
    }

    function getRoundStatus(tournament, roundIndex) {
        return Queries.getRoundStatus(tournament, roundIndex);
    }

    function getMatchDisplay(tournament, roundIndex, matchIndex) {
        // Use Queries to get match data, then construct display
        var match = Queries.getMatch(tournament, roundIndex, matchIndex);
        if (!match || !Array.isArray(match.participants)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < match.participants.length; i++) {
            var id = match.participants[i];
            var name = getParticipantName(tournament, id);
            var outcome = 'pending';

            // Determine outcome from match state
            if (match.type === 'group_exam') {
                var resultValue = match.results && match.results[id];
                if (resultValue === 'pass') {
                    outcome = 'passed';
                } else if (resultValue === 'fail') {
                    outcome = 'failed';
                } else if (match.status === 'completed') {
                    outcome = 'unknown';
                }
            } else {
                if (match.winner && String(match.winner) === String(id)) {
                    outcome = 'winner';
                } else if (match.loser && String(match.loser) === String(id)) {
                    outcome = 'eliminated';
                } else if (match.advancing && match.advancing.indexOf(id) !== -1) {
                    outcome = 'advancing';
                } else if (match.status === 'completed') {
                    outcome = 'unknown';
                }
            }

            result.push({
                id: id,
                name: name,
                outcome: outcome,
                isGroupExam: match.type === 'group_exam'
            });
        }

        return result;
    }

    // ============================================================
    // RENDER API
    // ============================================================

    var TournamentsRender = {
        /**
         * Get the week range constants for use in forms.
         * 
         * @returns {object} { min, max }
         */
        getWeekRange: function() {
            return getWeekRange();
        },

        /**
         * Render a list of tournaments.
         * 
         * @param {array} tournaments - Array of tournament objects
         * @returns {string} HTML string
         */
        renderList: function(tournaments) {
            if (!tournaments || tournaments.length === 0) {
                return '<p class="empty-state">No tournaments created yet.</p>';
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
                var tournName = tourn.name || 'Unknown Tournament';
                var winnerName = getWinnerName(tourn);
                var participantCount = getParticipantCount(tourn);
                var roundCount = getRoundCount(tourn);
                var isComplete = isTournamentComplete(tourn);
                var statusDisplay = getTournamentStatusDisplay(tourn.status);

                html += '<div class="list-item tourn-item" data-id="' + escapeHtml(tourn.id) + '">';
                html += '<span><strong>' + escapeHtml(tournName) + '</strong>' +
                    (isComplete && winnerName !== 'Not determined' ? ' ★ ' + escapeHtml(winnerName) : '') + '</span>';
                html += '<span class="tourn-mode">' + escapeHtml(tourn.mode || 'teams') + '</span>';
                html += '<span class="tourn-rounds">' + roundCount + '/' + escapeHtml(tourn.totalRounds || 1) + '</span>';
                html += '<span class="tourn-participants">' + participantCount + '</span>';
                html += '<span class="tourn-status ' + statusDisplay.class + '">' + escapeHtml(statusDisplay.text) + '</span>';
                html += '<span class="actions">';
                html += '<button class="small view-tournament" data-id="' + escapeHtml(tourn.id) + '">View</button>';
                html += '<button class="small edit-tournament" data-id="' + escapeHtml(tourn.id) + '">Edit</button>';
                html += '<button class="small danger delete-tournament" data-id="' + escapeHtml(tourn.id) + '">Delete</button>';
                html += '</span>';
                html += '</div>';
            }

            return html;
        },

        /**
         * Render tournament detail.
         * 
         * @param {object} tournament - Tournament object
         * @returns {string} HTML string
         */
        renderDetail: function(tournament) {
            if (!tournament) {
                return '<p class="empty-state">Tournament not found.</p>';
            }

            var html = '';
            html += renderInfo(tournament);
            html += renderParticipants(tournament);
            html += renderRounds(tournament);
            html += renderEliminations(tournament);
            html += renderWinner(tournament);

            return html;
        },

        /**
         * Render tournament info section.
         * 
         * @param {object} tournament - Tournament object
         * @returns {string} HTML string
         */
        renderInfo: renderInfo,

        /**
         * Render tournament participants section.
         * 
         * @param {object} tournament - Tournament object
         * @returns {string} HTML string
         */
        renderParticipants: renderParticipants,

        /**
         * Render tournament rounds section.
         * 
         * @param {object} tournament - Tournament object
         * @returns {string} HTML string
         */
        renderRounds: renderRounds,

        /**
         * Render tournament eliminations section.
         * 
         * @param {object} tournament - Tournament object
         * @returns {string} HTML string
         */
        renderEliminations: renderEliminations,

        /**
         * Render tournament winner section.
         * 
         * @param {object} tournament - Tournament object
         * @returns {string} HTML string
         */
        renderWinner: renderWinner,

        /**
         * Render tournament form.
         * 
         * @param {object} tournament - Tournament object (optional)
         * @param {array} modeOptions - Array of mode options (from caller)
         * @param {array} statusOptions - Array of status options (from caller)
         * @returns {string} HTML string
         */
        renderForm: function(tournament, modeOptions, statusOptions) {
            var isEdit = !!tournament;
            var t = tournament || {};
            var weekRange = getWeekRange();

            modeOptions = Array.isArray(modeOptions) ? modeOptions : ['teams', 'individuals'];
            statusOptions = Array.isArray(statusOptions) ? statusOptions : ['draft', 'active', 'completed'];

            var html = '<form class="tournament-form" id="tournament-form">';

            // Name
            html += '<div class="form-group">';
            html += '<label>Tournament Name *</label>';
            html += '<input type="text" id="tourn-name" value="' + escapeHtml(t.name || '') + '" required>';
            html += '</div>';

            // Mode
            html += '<div class="form-group">';
            html += '<label>Mode</label>';
            html += '<select id="tourn-mode">';
            for (var i = 0; i < modeOptions.length; i++) {
                var mode = modeOptions[i];
                var selected = t.mode === mode ? ' selected' : '';
                html += '<option value="' + escapeHtml(mode) + '"' + selected + '>' + escapeHtml(mode) + '</option>';
            }
            html += '</select>';
            html += '</div>';

            // Week range
            html += '<div class="form-row">';
            html += '<div class="form-group">';
            html += '<label>Start Week</label>';
            html += '<input type="number" id="tourn-start-week" value="' + escapeHtml(t.startWeek || weekRange.min) + '" min="' + weekRange.min + '" max="' + weekRange.max + '">';
            html += '</div>';
            html += '<div class="form-group">';
            html += '<label>End Week</label>';
            html += '<input type="number" id="tourn-end-week" value="' + escapeHtml(t.endWeek || weekRange.max) + '" min="' + weekRange.min + '" max="' + weekRange.max + '">';
            html += '</div>';
            html += '</div>';

            // Total rounds
            html += '<div class="form-group">';
            html += '<label>Total Rounds</label>';
            html += '<input type="number" id="tourn-total-rounds" value="' + escapeHtml(t.totalRounds || 1) + '" min="1">';
            html += '</div>';

            // Graduating class fields
            html += '<div class="form-group" id="class-filter-group">';
            html += '<label>Graduating Class</label>';
            html += '<select id="tourn-class">';
            html += '<option value="">None</option>';
            html += '<!-- Options populated by UI -->';
            html += '</select>';
            html += '<div style="margin-top:4px;display:flex;align-items:center;gap:6px;">';
            var filterChecked = t.classFilterEnabled !== false;
            html += '<input type="checkbox" id="tourn-class-filter-enabled" ' + (filterChecked ? 'checked' : '') + '>';
            html += '<label for="tourn-class-filter-enabled" style="font-size:0.7rem;color:var(--text-dim);">Only allow characters from this class</label>';
            html += '</div>';
            html += '</div>';

            // Status
            html += '<div class="form-group">';
            html += '<label>Status</label>';
            html += '<select id="tourn-status">';
            for (var i = 0; i < statusOptions.length; i++) {
                var status = statusOptions[i];
                var selected = t.status === status ? ' selected' : '';
                html += '<option value="' + escapeHtml(status) + '"' + selected + '>' + escapeHtml(status) + '</option>';
            }
            html += '</select>';
            html += '</div>';

            // Actions
            html += '<div class="form-actions">';
            html += '<button type="button" class="secondary cancel-form-btn">Cancel</button>';
            html += '<button type="submit" class="primary">' + (isEdit ? 'Update' : 'Create') + ' Tournament</button>';
            html += '</div>';

            html += '</form>';
            return html;
        },

        /**
         * Render match form.
         * 
         * @param {object} tournament - Tournament object
         * @param {number} roundIndex - Index of the round
         * @param {number} matchIndex - Index of the match (-1 for new)
         * @param {array} availableParticipants - Array of available participants
         * @returns {string} HTML string
         */
        renderMatchForm: function(tournament, roundIndex, matchIndex, availableParticipants) {
            if (!tournament) {
                return '<p class="empty-state">Tournament not available.</p>';
            }

            var round = Array.isArray(tournament.rounds) ? tournament.rounds[roundIndex] : null;
            var match = null;

            if (
                round &&
                Array.isArray(round.matches) &&
                Number.isInteger(matchIndex) &&
                matchIndex >= 0 &&
                matchIndex < round.matches.length
            ) {
                match = round.matches[matchIndex] || null;
            }

            var isEdit = !!match;
            var isGroupExam = match && match.type === 'group_exam';
            var canonicalType = getCanonicalParticipantType(tournament.mode);
            var participantTypeLabel = canonicalType === 'team' ? 'Team' : (canonicalType === 'character' ? 'Character' : 'Unknown');

            var html = '<form class="match-form" id="match-form">';

            // Match type
            html += '<div class="form-group">';
            html += '<label>Match Type</label>';
            html += '<select id="match-type">';
            html += '<option value="standard"' + (!isGroupExam ? ' selected' : '') + '>Standard</option>';
            html += '<option value="group_exam"' + (isGroupExam ? ' selected' : '') + '>Group Exam</option>';
            html += '</select>';
            html += '</div>';

            // Participants
            html += '<div class="form-group">';
            html += '<label>Participants</label>';
            html += '<div id="match-participants">';

            var participants = match ? match.participants : [];
            var maxParticipants = round ? round.matchSize : 2;

            if (participants.length === 0) {
                for (var i = 0; i < maxParticipants; i++) {
                    html += '<select class="match-participant-select" data-index="' + i + '">';
                    html += '<option value="">Select participant...</option>';
                    if (Array.isArray(availableParticipants)) {
                        for (var j = 0; j < availableParticipants.length; j++) {
                            var p = availableParticipants[j];
                            var name = getParticipantName(tournament, p.id);
                            html += '<option value="' + escapeHtml(p.id) + '">' +
                                escapeHtml(name) + ' (' + participantTypeLabel + ')' +
                                '</option>';
                        }
                    }
                    html += '</select>';
                }
            } else {
                for (var i = 0; i < participants.length; i++) {
                    var id = participants[i];
                    var name = getParticipantName(tournament, id);
                    html += '<div class="participant-slot">';
                    html += '<span>' + escapeHtml(name) + ' (' + participantTypeLabel + ')</span>';
                    html += '<input type="hidden" name="participant_' + i + '" value="' + escapeHtml(id) + '">';
                    html += '<button type="button" class="remove-match-participant small danger">✕</button>';
                    html += '</div>';
                }
                html += '<select class="match-participant-select" data-index="' + participants.length + '">';
                html += '<option value="">Add participant...</option>';
                if (Array.isArray(availableParticipants)) {
                    for (var j = 0; j < availableParticipants.length; j++) {
                        var p = availableParticipants[j];
                        var name = getParticipantName(tournament, p.id);
                        html += '<option value="' + escapeHtml(p.id) + '">' +
                            escapeHtml(name) + ' (' + participantTypeLabel + ')' +
                            '</option>';
                    }
                }
                html += '</select>';
            }

            html += '</div>';
            html += '</div>';

            // Group exam results
            if (isGroupExam && match) {
                html += '<div class="form-group">';
                html += '<label>Results</label>';
                html += '<div id="exam-results">';
                if (match.participants) {
                    for (var i = 0; i < match.participants.length; i++) {
                        var id = match.participants[i];
                        var name = getParticipantName(tournament, id);
                        var result = match.results && match.results[id];
                        html += '<div class="exam-result-row">';
                        html += '<span>' + escapeHtml(name) + ' (' + participantTypeLabel + ')</span>';
                        html += '<select class="exam-result-select" data-id="' + escapeHtml(id) + '">';
                        html += '<option value="">—</option>';
                        html += '<option value="pass"' + (result === 'pass' ? ' selected' : '') + '>Pass</option>';
                        html += '<option value="fail"' + (result === 'fail' ? ' selected' : '') + '>Fail</option>';
                        html += '</select>';
                        html += '</div>';
                    }
                }
                html += '</div>';
                html += '</div>';
            } else if (!isEdit) {
                // Winner selection (for new standard matches)
                html += '<div class="form-group hidden" id="winner-selection">';
                html += '<label>Winner</label>';
                html += '<select id="match-winner">';
                html += '<option value="">Select winner...</option>';
                html += '</select>';
                html += '</div>';
            }

            // Actions
            html += '<div class="form-actions">';
            html += '<button type="button" class="secondary cancel-match-form-btn">Cancel</button>';
            html += '<button type="submit" class="primary">' + (isEdit ? 'Update' : 'Add') + ' Match</button>';
            html += '</div>';

            html += '</form>';
            return html;
        }
    };

    // ============================================================
    // INTERNAL RENDER FUNCTIONS
    // ============================================================

    function renderInfo(tournament) {
        if (!tournament) {
            return '';
        }

        var tournName = tournament.name || 'Unknown Tournament';
        var winnerName = getWinnerName(tournament);
        var isComplete = isTournamentComplete(tournament);
        var statusDisplay = getTournamentStatusDisplay(tournament.status);
        var weekRange = getWeekRange();

        return '<div class="tourn-info">' +
            '<span class="tourn-info-item">' + escapeHtml(tournName) + '</span>' +
            '<span class="tourn-info-item">Mode: <strong>' + escapeHtml(tournament.mode || 'teams') + '</strong></span>' +
            '<span class="tourn-info-item">Weeks ' + escapeHtml(tournament.startWeek || weekRange.min) + ' - ' + escapeHtml(tournament.endWeek || weekRange.max) + '</span>' +
            '<span class="tourn-info-item">Rounds: ' + getRoundCount(tournament) + '/' + escapeHtml(tournament.totalRounds || 1) + '</span>' +
            '<span class="tourn-info-item">Status: <span class="tourn-status ' + statusDisplay.class + '">' + escapeHtml(statusDisplay.text) + '</span></span>' +
            (isComplete && winnerName !== 'Not determined' ?
                '<span class="tourn-info-item tourn-winner-badge">Winner: ' + escapeHtml(winnerName) + '</span>' :
                '') +
            '</div>';
    }

    function renderParticipants(tournament) {
        var participants = Array.isArray(tournament.participants) ? tournament.participants : [];
        var isComplete = isTournamentComplete(tournament);
        var hasHistory = getRoundCount(tournament) > 0;

        var html = '<div class="tourn-section participants-section">';
        html += '<h4 class="section-title">Participants</h4>';

        if (participants.length === 0) {
            html += '<span class="empty-message">No participants added</span>';
        } else {
            html += '<div class="participant-list">';
            for (var i = 0; i < participants.length; i++) {
                var p = participants[i];
                var name = getParticipantName(tournament, p.id);
                var isEliminated = Queries.isParticipantEliminated(tournament, p.id);

                var isWinner = false;
                if (tournament.winner && tournament.winner.id) {
                    isWinner = String(tournament.winner.id) === String(p.id);
                }

                var classes = 'participant-tag';
                if (isEliminated) {
                    classes += ' eliminated';
                }
                if (isWinner) {
                    classes += ' winner';
                }

                html += '<span class="' + classes + '">';
                html += escapeHtml(name);
                if (isEliminated) {
                    html += ' ✘';
                }
                if (isWinner) {
                    html += ' ★';
                }
                if (!isComplete && !hasHistory) {
                    html += ' <button class="remove-participant-btn" data-id="' + escapeHtml(p.id) + '">✕</button>';
                }
                html += '</span>';
            }
            html += '</div>';
        }

        if (!isComplete) {
            html += '<div class="add-participant-form">';
            html += '<select class="participant-select" data-mode="' + escapeHtml(tournament.mode || 'teams') + '">';
            html += '<option value="">Add participant...</option>';
            html += '</select>';
            html += '<button class="add-participant-btn primary small">Add</button>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderRounds(tournament) {
        var rounds = Array.isArray(tournament.rounds) ? tournament.rounds : [];
        var isComplete = isTournamentComplete(tournament);
        var roundCount = rounds.length;
        var maxRounds = tournament.totalRounds || 1;
        var showCreateRoundButton = !isComplete && roundCount < maxRounds;

        var html = '<div class="tourn-section rounds-section">';
        html += '<div class="section-header">';
        html += '<h4 class="section-title">Rounds</h4>';
        if (showCreateRoundButton) {
            html += '<button class="create-round-btn primary small">+ Create Round</button>';
        }
        html += '<span class="rounds-count">' + roundCount + ' / ' + maxRounds + ' rounds</span>';
        html += '</div>';

        if (rounds.length === 0) {
            html += '<p class="empty-message">No rounds created.</p>';
        } else {
            for (var i = 0; i < rounds.length; i++) {
                var round = rounds[i];
                var roundStatus = getRoundStatus(tournament, i);
                var statusDisplay = getRoundStatusDisplay(roundStatus);
                var matchCount = getMatchCount(tournament, i);
                var roundNumber = round.roundNumber || (i + 1);

                html += '<div class="round-item" data-round="' + i + '">';
                html += '<div class="round-header">';
                html += '<div class="round-title">';
                html += '<strong>Round ' + roundNumber + '</strong>';
                html += ' <span class="round-matches">(' + matchCount + ' matches)</span>';
                html += ' <span class="round-status ' + statusDisplay.class + '">' + statusDisplay.text + '</span>';
                html += '</div>';
                html += '<div class="round-actions">';
                if (roundStatus !== 'completed' && !isComplete) {
                    html += '<button class="small view-round-status-btn" data-round="' + i + '">Status</button>';
                    html += '<button class="small edit-round-btn" data-round="' + i + '">Edit</button>';
                }
                if (!isComplete && roundStatus !== 'completed') {
                    html += '<button class="small danger delete-round-btn" data-round="' + i + '">Delete</button>';
                }
                html += '</div>';
                html += '</div>';

                if (Array.isArray(round.matches) && round.matches.length > 0) {
                    html += '<div class="match-list">';
                    for (var j = 0; j < round.matches.length; j++) {
                        var matchDisplay = getMatchDisplay(tournament, i, j);
                        var matchStatus = round.matches[j].status || 'pending';
                        var matchStatusDisplay = getRoundStatusDisplay(matchStatus);

                        html += '<div class="match-item" data-round="' + i + '" data-match="' + j + '">';

                        var namesHtml = '';
                        for (var k = 0; k < matchDisplay.length; k++) {
                            var display = matchDisplay[k];
                            var outcomeDisplay = getOutcomeDisplay(display.outcome);
                            if (k > 0) {
                                namesHtml += ' <span class="match-vs">vs</span> ';
                            }
                            namesHtml += '<span class="match-participant ' + outcomeDisplay.class + '">' +
                                escapeHtml(display.name) +
                                (outcomeDisplay.text ? ' ' + outcomeDisplay.text : '') +
                                '</span>';
                        }

                        html += '<span class="match-participants">' + namesHtml + '</span>';

                        if (round.matches[j].type === 'group_exam') {
                            html += '<span class="match-type-badge">Exam</span>';
                        }

                        html += '<span class="match-status ' + matchStatusDisplay.class + '">' + matchStatusDisplay.text + '</span>';

                        if (!isComplete && matchStatus !== 'completed') {
                            html += '<button class="small edit-match-btn" data-round="' + i + '" data-match="' + j + '">Edit</button>';
                        }

                        html += '</div>';
                    }
                    html += '</div>';
                }

                if (roundStatus !== 'completed' && !isComplete) {
                    html += '<button class="add-match-btn small" data-round="' + i + '">+ Add Match</button>';
                }

                html += '</div>';
            }
        }

        html += '</div>';
        return html;
    }

    function renderEliminations(tournament) {
        var eliminations = Array.isArray(tournament.eliminations) ? tournament.eliminations : [];
        var isComplete = isTournamentComplete(tournament);

        var html = '<div class="tourn-section eliminations-section">';
        html += '<h4 class="section-title">Eliminations</h4>';

        if (eliminations.length === 0) {
            html += '<span class="empty-message">No eliminations</span>';
        } else {
            html += '<div class="elimination-list">';
            for (var i = 0; i < eliminations.length; i++) {
                var e = eliminations[i];
                var name = getParticipantName(tournament, e.participantId);
                var week = e.week || '?';
                var reason = e.reason || 'Eliminated';

                html += '<span class="elimination-tag">';
                html += escapeHtml(name) + ' ✘';
                html += ' <span class="elimination-detail">(' + escapeHtml(reason) + ', Week ' + escapeHtml(week) + ')</span>';
                if (!isComplete) {
                    html += ' <button class="uneliminate-btn" data-id="' + escapeHtml(e.participantId) + '">↻</button>';
                }
                html += '</span>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderWinner(tournament) {
        var isComplete = isTournamentComplete(tournament);
        var winnerName = getWinnerName(tournament);
        var winner = Queries.getWinner(tournament);

        var html = '<div class="tourn-section winner-section">';
        html += '<h4 class="section-title">Tournament Winner</h4>';

        if (isComplete && winner) {
            var canonicalType = getCanonicalParticipantType(tournament.mode);
            var typeLabel = canonicalType === 'team' ? 'Team' : (canonicalType === 'character' ? 'Character' : 'Unknown');

            html += '<div class="winner-display">';
            html += '<span class="winner-name">' + escapeHtml(winnerName) + '</span>';
            html += '<span class="winner-type">(' + typeLabel + ')</span>';
            html += '</div>';
        } else if (isComplete) {
            html += '<span class="empty-message">Winner not set</span>';
        } else {
            var roundCount = getRoundCount(tournament);
            if (roundCount > 0) {
                html += '<span class="pending-message">Tournament in progress</span>';
            } else {
                html += '<span class="empty-message">No winner yet</span>';
            }
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsRender = TournamentsRender;

})();
