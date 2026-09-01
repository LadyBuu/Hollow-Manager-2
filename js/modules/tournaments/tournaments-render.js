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
 *   - window.TournamentsQueries (required)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - Queries.getWeekRange() for week validation
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__tournamentsRenderLoaded) return;

    if (!window.TournamentsQueries) {
        console.error('TournamentsRender: TournamentsQueries required.');
        return;
    }

    // Check CALENDAR_CONSTANTS via Queries
    var queries = window.TournamentsQueries;
    var weekRange = queries.getWeekRange ? queries.getWeekRange() : { min: 1, max: 52 };
    var MIN_WEEK = weekRange.min;
    var MAX_WEEK = weekRange.max;

    window.__tournamentsRenderLoaded = true;

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
        return map[outcome] || { text: '', class: '' };
    }

    /**
     * Get status display info for tournament statuses.
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
     * Get status display info for round/match statuses.
     */
    function getRoundStatusDisplay(status) {
        var map = {
            'empty': { text: 'Empty', class: 'status-empty' },
            'pending': { text: 'Pending', class: 'status-pending' },
            'in_progress': { text: 'In Progress', class: 'status-in-progress' },
            'completed': { text: 'Completed', class: 'status-completed' }
        };
        return map[status] || { text: status || 'Unknown', class: 'status-unknown' };
    }

    /**
     * Get the canonical participant type for a tournament mode.
     * Delegates to Queries for the authoritative answer.
     */
    function getCanonicalParticipantType(mode) {
        if (queries.getCanonicalParticipantType) {
            return queries.getCanonicalParticipantType(mode);
        }
        return mode === 'teams' ? 'team' : (mode === 'individuals' ? 'character' : null);
    }

    /**
     * Get a participant name using Queries as the authority.
     * This is the ONLY way to get participant names in this module.
     */
    function getParticipantName(tournament, id) {
        if (!tournament) return 'Unknown';
        if (!queries.getTournamentParticipantName) {
            return 'Unknown';
        }
        return queries.getTournamentParticipantName(tournament, id);
    }

    /**
     * Get a participant type using Queries as the authority.
     * This is the ONLY way to get participant types in this module.
     */
    function getParticipantType(tournament, id) {
        if (!tournament) return 'unknown';
        if (!queries.getTournamentParticipantType) {
            return 'unknown';
        }
        return queries.getTournamentParticipantType(tournament, id);
    }

    /**
     * Get the week range for display.
     */
    function getWeekRangeDisplay() {
        return MIN_WEEK + ' - ' + MAX_WEEK;
    }

    // ============================================================
    // RENDER API
    // ============================================================

    var TournamentsRender = {
        /**
         * Get the week range constants for use in forms.
         * Delegates to Queries for the authoritative values.
         */
        getWeekRange: function() {
            if (queries.getWeekRange) {
                return queries.getWeekRange();
            }
            return { min: MIN_WEEK, max: MAX_WEEK };
        },

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

            tournaments.forEach(function(tourn) {
                // FIX: Get tournament name with fallback
                var tournName = tourn.name || 'Unknown Tournament';
                var winnerName = queries.getWinnerName ? queries.getWinnerName(tourn) : 'Not determined';
                var participantCount = queries.getParticipantCount ? queries.getParticipantCount(tourn) : 0;
                var roundCount = queries.getRoundCount ? queries.getRoundCount(tourn) : 0;
                var isComplete = queries.isTournamentComplete ? queries.isTournamentComplete(tourn) : false;
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
            });

            return html;
        },

        renderDetail: function(tournament) {
            if (!tournament) return '<p class="empty-state">Tournament not found.</p>';

            var html = '';
            html += this.renderInfo(tournament);
            html += this.renderParticipants(tournament);
            html += this.renderRounds(tournament);
            html += this.renderEliminations(tournament);
            html += this.renderWinner(tournament);

            return html;
        },

        renderInfo: function(tournament) {
            if (!tournament) return '';
            
            var tournName = tournament.name || 'Unknown Tournament';
            var winnerName = queries.getWinnerName ? queries.getWinnerName(tournament) : 'Not determined';
            var isComplete = queries.isTournamentComplete ? queries.isTournamentComplete(tournament) : false;
            var statusDisplay = getTournamentStatusDisplay(tournament.status);
            var weekRange = this.getWeekRange();

            return '<div class="tourn-info">' +
                '<span class="tourn-info-item">' + escapeHtml(tournName) + '</span>' +
                '<span class="tourn-info-item">Mode: <strong>' + escapeHtml(tournament.mode || 'teams') + '</strong></span>' +
                '<span class="tourn-info-item">Weeks ' + escapeHtml(tournament.startWeek || 1) + ' - ' + escapeHtml(tournament.endWeek || 52) +
                ' (' + escapeHtml(weekRange.min) + '-' + escapeHtml(weekRange.max) + ')</span>' +
                '<span class="tourn-info-item">Rounds: ' + (queries.getRoundCount ? queries.getRoundCount(tournament) : 0) + '/' + escapeHtml(tournament.totalRounds || 1) + '</span>' +
                '<span class="tourn-info-item">Status: <span class="tourn-status ' + statusDisplay.class + '">' + escapeHtml(statusDisplay.text) + '</span></span>' +
                (isComplete && winnerName !== 'Not determined' ?
                    '<span class="tourn-info-item tourn-winner-badge">Winner: ' + escapeHtml(winnerName) + '</span>' :
                    '') +
                '</div>';
        },

        renderParticipants: function(tournament) {
            var participants = Array.isArray(tournament.participants) ? tournament.participants : [];
            var isComplete = queries.isTournamentComplete ? queries.isTournamentComplete(tournament) : false;
            var hasHistory = queries.getRoundCount ? queries.getRoundCount(tournament) > 0 : false;

            var html = '<div class="tourn-section participants-section">';
            html += '<h4 class="section-title">Participants</h4>';

            if (participants.length === 0) {
                html += '<span class="empty-message">No participants added</span>';
            } else {
                html += '<div class="participant-list">';
                participants.forEach(function(p) {
                    // Use Queries for ALL participant name resolution
                    var name = getParticipantName(tournament, p.id);
                    var isEliminated = queries.isParticipantEliminated ? queries.isParticipantEliminated(tournament, p.id) : false;

                    // Use Queries for winner check - don't manually compare IDs
                    var isWinner = false;
                    if (tournament.winner && tournament.winner.id) {
                        var winnerId = typeof tournament.winner.id === 'string' ? tournament.winner.id : String(tournament.winner.id);
                        isWinner = winnerId === String(p.id);
                    }

                    var classes = 'participant-tag';
                    if (isEliminated) classes += ' eliminated';
                    if (isWinner) classes += ' winner';

                    html += '<span class="' + classes + '">';
                    html += escapeHtml(name);
                    if (isEliminated) html += ' ✘';
                    if (isWinner) html += ' ★';
                    if (!isComplete && !hasHistory) {
                        html += ' <button class="remove-participant-btn" data-id="' + escapeHtml(p.id) + '">✕</button>';
                    }
                    html += '</span>';
                });
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
        },

        renderRounds: function(tournament) {
            var rounds = Array.isArray(tournament.rounds) ? tournament.rounds : [];
            var isComplete = queries.isTournamentComplete ? queries.isTournamentComplete(tournament) : false;
            var roundCount = rounds.length;
            var maxRounds = tournament.totalRounds || 1;
            var canAddRound = !isComplete && roundCount < maxRounds;

            var html = '<div class="tourn-section rounds-section">';
            html += '<div class="section-header">';
            html += '<h4 class="section-title">Rounds</h4>';
            if (canAddRound) {
                html += '<button class="create-round-btn primary small">+ Create Round</button>';
            }
            html += '<span class="rounds-count">' + roundCount + ' / ' + maxRounds + ' rounds</span>';
            html += '</div>';

            if (rounds.length === 0) {
                html += '<p class="empty-message">No rounds created.</p>';
            } else {
                rounds.forEach(function(round, roundIndex) {
                    var roundStatus = queries.getRoundStatus ? queries.getRoundStatus(tournament, roundIndex) : 'empty';
                    var statusDisplay = getRoundStatusDisplay(roundStatus);
                    var matchCount = queries.getMatchCount ? queries.getMatchCount(tournament, roundIndex) : 0;
                    var roundNumber = round.roundNumber || (roundIndex + 1);

                    html += '<div class="round-item" data-round="' + roundIndex + '">';
                    html += '<div class="round-header">';
                    html += '<div class="round-title">';
                    html += '<strong>Round ' + roundNumber + '</strong>';
                    html += ' <span class="round-matches">(' + matchCount + ' matches)</span>';
                    html += ' <span class="round-status ' + statusDisplay.class + '">' + statusDisplay.text + '</span>';
                    html += '</div>';
                    html += '<div class="round-actions">';
                    if (roundStatus !== 'completed' && !isComplete) {
                        html += '<button class="small view-round-status-btn" data-round="' + roundIndex + '">Status</button>';
                        html += '<button class="small edit-round-btn" data-round="' + roundIndex + '">Edit</button>';
                    }
                    if (!isComplete && roundStatus !== 'completed') {
                        html += '<button class="small danger delete-round-btn" data-round="' + roundIndex + '">Delete</button>';
                    }
                    html += '</div>';
                    html += '</div>';

                    if (Array.isArray(round.matches) && round.matches.length > 0) {
                        html += '<div class="match-list">';
                        round.matches.forEach(function(match, matchIndex) {
                            var matchDisplay = queries.getMatchDisplay ? queries.getMatchDisplay(tournament, roundIndex, matchIndex) : [];
                            var matchStatus = match.status || 'pending';
                            var statusDisplay = getRoundStatusDisplay(matchStatus);

                            html += '<div class="match-item" data-round="' + roundIndex + '" data-match="' + matchIndex + '">';

                            var namesHtml = matchDisplay.map(function(display) {
                                var outcomeDisplay = getOutcomeDisplay(display.outcome);
                                return '<span class="match-participant ' + outcomeDisplay.class + '">' +
                                    escapeHtml(display.name) +
                                    (outcomeDisplay.text ? ' ' + outcomeDisplay.text : '') +
                                    '</span>';
                            }).join(' <span class="match-vs">vs</span> ');

                            html += '<span class="match-participants">' + namesHtml + '</span>';

                            if (match.type === 'group_exam') {
                                html += '<span class="match-type-badge">Exam</span>';
                            }

                            html += '<span class="match-status ' + statusDisplay.class + '">' + statusDisplay.text + '</span>';

                            if (!isComplete && matchStatus !== 'completed') {
                                html += '<button class="small edit-match-btn" data-round="' + roundIndex + '" data-match="' + matchIndex + '">Edit</button>';
                            }

                            html += '</div>';
                        });
                        html += '</div>';
                    }

                    if (roundStatus !== 'completed' && !isComplete) {
                        html += '<button class="add-match-btn small" data-round="' + roundIndex + '">+ Add Match</button>';
                    }

                    html += '</div>';
                });
            }

            html += '</div>';
            return html;
        },

        renderEliminations: function(tournament) {
            var eliminations = Array.isArray(tournament.eliminations) ? tournament.eliminations : [];
            var isComplete = queries.isTournamentComplete ? queries.isTournamentComplete(tournament) : false;

            var html = '<div class="tourn-section eliminations-section">';
            html += '<h4 class="section-title">Eliminations</h4>';

            if (eliminations.length === 0) {
                html += '<span class="empty-message">No eliminations</span>';
            } else {
                html += '<div class="elimination-list">';
                eliminations.forEach(function(e) {
                    // Use Queries for participant name
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
                });
                html += '</div>';
            }

            html += '</div>';
            return html;
        },

        renderWinner: function(tournament) {
            var isComplete = queries.isTournamentComplete ? queries.isTournamentComplete(tournament) : false;
            var winnerName = queries.getWinnerName ? queries.getWinnerName(tournament) : 'Not determined';
            var winner = queries.getWinner ? queries.getWinner(tournament) : null;

            var html = '<div class="tourn-section winner-section">';
            html += '<h4 class="section-title">Tournament Winner</h4>';

            if (isComplete && winner) {
                // Use Queries to get the canonical type
                var canonicalType = getCanonicalParticipantType(tournament.mode);
                var typeLabel = canonicalType === 'team' ? 'Team' : (canonicalType === 'character' ? 'Character' : 'Unknown');

                html += '<div class="winner-display">';
                html += '<span class="winner-name">' + escapeHtml(winnerName) + '</span>';
                html += '<span class="winner-type">(' + typeLabel + ')</span>';
                html += '</div>';
            } else if (isComplete) {
                html += '<span class="empty-message">Winner not set</span>';
            } else {
                var roundCount = queries.getRoundCount ? queries.getRoundCount(tournament) : 0;
                if (roundCount > 0) {
                    html += '<span class="pending-message">Tournament in progress</span>';
                } else {
                    html += '<span class="empty-message">No winner yet</span>';
                }
            }

            html += '</div>';
            return html;
        },

        renderForm: function(tournament, modeOptions, statusOptions) {
            var isEdit = !!tournament;
            var t = tournament || {};
            var weekRange = this.getWeekRange();

            modeOptions = modeOptions || ['teams', 'individuals'];
            statusOptions = statusOptions || ['draft', 'active', 'completed'];

            // FIX: Get tournament name with fallback
            var tournName = t.name || '';

            var html = '<form class="tournament-form" id="tournament-form">';
            html += '<div class="form-group">';
            html += '<label>Tournament Name *</label>';
            html += '<input type="text" id="tourn-name" value="' + escapeHtml(tournName) + '" required>';
            html += '</div>';

            html += '<div class="form-group">';
            html += '<label>Mode</label>';
            html += '<select id="tourn-mode">';
            modeOptions.forEach(function(mode) {
                var selected = t.mode === mode ? ' selected' : '';
                html += '<option value="' + escapeHtml(mode) + '"' + selected + '>' + escapeHtml(mode) + '</option>';
            });
            html += '</select>';
            html += '</div>';

            html += '<div class="form-row">';
            html += '<div class="form-group">';
            html += '<label>Start Week</label>';
            html += '<input type="number" id="tourn-start-week" value="' + escapeHtml(t.startWeek || 1) + '" min="' + weekRange.min + '" max="' + weekRange.max + '">';
            html += '</div>';
            html += '<div class="form-group">';
            html += '<label>End Week</label>';
            html += '<input type="number" id="tourn-end-week" value="' + escapeHtml(t.endWeek || 52) + '" min="' + weekRange.min + '" max="' + weekRange.max + '">';
            html += '</div>';
            html += '</div>';

            html += '<div class="form-group">';
            html += '<label>Total Rounds</label>';
            html += '<input type="number" id="tourn-total-rounds" value="' + escapeHtml(t.totalRounds || 1) + '" min="1">';
            html += '</div>';

            html += '<div class="form-group">';
            html += '<label>Status</label>';
            html += '<select id="tourn-status">';
            statusOptions.forEach(function(status) {
                var selected = t.status === status ? ' selected' : '';
                html += '<option value="' + escapeHtml(status) + '"' + selected + '>' + escapeHtml(status) + '</option>';
            });
            html += '</select>';
            html += '</div>';

            html += '<div class="form-actions">';
            html += '<button type="button" class="secondary cancel-form-btn">Cancel</button>';
            html += '<button type="submit" class="primary">' + (isEdit ? 'Update' : 'Create') + ' Tournament</button>';
            html += '</div>';

            html += '</form>';
            return html;
        },

        renderMatchForm: function(tournament, roundIndex, matchIndex, availableParticipants) {
            if (!tournament) {
                return '<p class="empty-state">Tournament not available.</p>';
            }

            var round = Array.isArray(tournament.rounds) ? tournament.rounds[roundIndex] : null;
            var match = null;

            // Defensive match retrieval with bounds checking
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

            // Use Queries for canonical participant type
            var canonicalType = getCanonicalParticipantType(tournament.mode);
            var participantTypeLabel = canonicalType === 'team' ? 'Team' : (canonicalType === 'character' ? 'Character' : 'Unknown');

            var html = '<form class="match-form" id="match-form">';
            html += '<div class="form-group">';
            html += '<label>Match Type</label>';
            html += '<select id="match-type">';
            html += '<option value="standard"' + (!isGroupExam ? ' selected' : '') + '>Standard</option>';
            html += '<option value="group_exam"' + (isGroupExam ? ' selected' : '') + '>Group Exam</option>';
            html += '</select>';
            html += '</div>';

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
                        availableParticipants.forEach(function(p) {
                            var name = getParticipantName(tournament, p.id);
                            html += '<option value="' + escapeHtml(p.id) + '">' +
                                escapeHtml(name) + ' (' + participantTypeLabel + ')' +
                                '</option>';
                        });
                    }
                    html += '</select>';
                }
            } else {
                participants.forEach(function(id, index) {
                    var name = getParticipantName(tournament, id);
                    html += '<div class="participant-slot">';
                    html += '<span>' + escapeHtml(name) + ' (' + participantTypeLabel + ')</span>';
                    html += '<input type="hidden" name="participant_' + index + '" value="' + escapeHtml(id) + '">';
                    html += '<button type="button" class="remove-match-participant small danger">✕</button>';
                    html += '</div>';
                });
                html += '<select class="match-participant-select" data-index="' + participants.length + '">';
                html += '<option value="">Add participant...</option>';
                if (Array.isArray(availableParticipants)) {
                    availableParticipants.forEach(function(p) {
                        var name = getParticipantName(tournament, p.id);
                        html += '<option value="' + escapeHtml(p.id) + '">' +
                            escapeHtml(name) + ' (' + participantTypeLabel + ')' +
                            '</option>';
                    });
                }
                html += '</select>';
            }

            html += '</div>';
            html += '</div>';

            if (isGroupExam && match) {
                html += '<div class="form-group">';
                html += '<label>Results</label>';
                html += '<div id="exam-results">';
                if (match.participants) {
                    match.participants.forEach(function(id) {
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
                    });
                }
                html += '</div>';
                html += '</div>';
            } else if (!isEdit) {
                html += '<div class="form-group hidden" id="winner-selection">';
                html += '<label>Winner</label>';
                html += '<select id="match-winner">';
                html += '<option value="">Select winner...</option>';
                html += '</select>';
                html += '</div>';
            }

            html += '<div class="form-actions">';
            html += '<button type="button" class="secondary cancel-match-form-btn">Cancel</button>';
            html += '<button type="submit" class="primary">' + (isEdit ? 'Update' : 'Add') + ' Match</button>';
            html += '</div>';

            html += '</form>';
            return html;
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsRender = TournamentsRender;

})();
