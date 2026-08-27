/**
 * js/modules/tournaments/tournaments-render.js - Tournament Rendering
 * PURE rendering functions. Takes data, returns HTML.
 * Does NOT mutate data or attach event handlers.
 * Path: js/modules/tournaments/tournaments-render.js
 */

(function() {
    'use strict';

    if (window.__tournamentsRenderLoaded) return;
    window.__tournamentsRenderLoaded = true;

    if (!window.TournamentsQueries) {
        console.error('TournamentsRender: TournamentsQueries required.');
        return;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    var TournamentsRender = {
        /**
         * Render tournament list.
         */
        renderList: function(tournaments, expandedId) {
            if (!tournaments || tournaments.length === 0) {
                return '<p class="empty-state">No tournaments created yet.</p>';
            }

            var html = '';
            var queries = window.TournamentsQueries;

            html += '<div class="list-header tourn-header">';
            html += '<span>Name</span>';
            html += '<span>Mode</span>';
            html += '<span>Rounds</span>';
            html += '<span>Participants</span>';
            html += '<span>Status</span>';
            html += '<span>Actions</span>';
            html += '</div>';

            tournaments.forEach(function(tourn) {
                var statusColor = queries.getStatusColor(tourn.status);
                var winnerName = queries.getWinnerName(tourn);
                var participantCount = Array.isArray(tourn.participants) ? tourn.participants.length : 0;
                var roundCount = Array.isArray(tourn.rounds) ? tourn.rounds.length : 0;
                var isExpanded = expandedId === tourn.id;

                html += '<div class="list-item tourn-item" data-id="' + escapeHtml(tourn.id) + '">';
                html += '<span><strong>' + escapeHtml(tourn.name) + '</strong>' +
                    (winnerName !== 'Not determined' ? ' ★ ' + escapeHtml(winnerName) : '') + '</span>';
                html += '<span style="font-size:0.75rem;">' + escapeHtml(tourn.mode) + '</span>';
                html += '<span>' + roundCount + '/' + escapeHtml(tourn.totalRounds) + '</span>';
                html += '<span>' + participantCount + '</span>';
                html += '<span style="color:' + statusColor + ';font-size:0.75rem;font-weight:600;">' + escapeHtml(tourn.status) + '</span>';
                html += '<span class="actions">';
                html += '<button class="small view-tournament" data-id="' + escapeHtml(tourn.id) + '">View</button>';
                html += '<button class="small edit-tournament" data-id="' + escapeHtml(tourn.id) + '">Edit</button>';
                html += '<button class="small danger delete-tournament" data-id="' + escapeHtml(tourn.id) + '">Delete</button>';
                html += '</span>';
                html += '</div>';
            });

            return html;
        },

        /**
         * Render tournament detail (participants, rounds, eliminations, winner).
         */
        renderDetail: function(tournament, queries) {
            if (!tournament) return '<p class="empty-state">Tournament not found.</p>';

            queries = queries || window.TournamentsQueries;

            var html = '';

            // Info
            html += this.renderInfo(tournament, queries);

            // Participants
            html += this.renderParticipants(tournament);

            // Rounds
            html += this.renderRounds(tournament, queries);

            // Eliminations
            html += this.renderEliminations(tournament, queries);

            // Winner
            html += this.renderWinner(tournament, queries);

            return html;
        },

        renderInfo: function(tournament, queries) {
            var statusColor = queries.getStatusColor(tournament.status);
            var winnerName = queries.getWinnerName(tournament);

            return '<div id="tournament-info" style="margin-bottom:12px;">' +
                '<span style="color:var(--text-dim);font-size:0.8rem;">' +
                'Mode: <strong>' + escapeHtml(tournament.mode) + '</strong> | ' +
                'Weeks ' + escapeHtml(tournament.startWeek) + ' - ' + escapeHtml(tournament.endWeek) + ' | ' +
                'Rounds: ' + (tournament.rounds ? tournament.rounds.length : 0) + '/' + escapeHtml(tournament.totalRounds) + ' | ' +
                'Status: <span style="color:' + statusColor + ';font-weight:600;">' + escapeHtml(tournament.status) + '</span>' +
                (winnerName !== 'Not determined' ? ' | Winner: <span style="color:var(--accent);font-weight:600;">' + escapeHtml(winnerName) + '</span>' : '') +
                '</span>' +
                '</div>';
        },

        renderParticipants: function(tournament) {
            var participants = Array.isArray(tournament.participants) ? tournament.participants : [];

            var html = '<div id="participants-section" style="margin-bottom:16px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border);">';
            html += '<h4 style="color:var(--accent);font-size:0.9rem;margin-bottom:8px;">Participants</h4>';

            if (participants.length === 0) {
                html += '<span style="color:var(--text-dim);font-size:0.75rem;">No participants added</span>';
            } else {
                html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
                participants.forEach(function(p) {
                    var name = window.TournamentsQueries.getParticipantName(p);
                    var isEliminated = Array.isArray(tournament.eliminations) &&
                        tournament.eliminations.some(function(e) {
                            return e && String(e.participantId) === String(p.id);
                        });
                    var color = isEliminated ? 'var(--danger)' : 'var(--border)';
                    html += '<span style="background:var(--panel-alt);padding:2px 8px;border-radius:10px;font-size:0.75rem;border:1px solid ' + color + ';">';
                    html += escapeHtml(name) + (isEliminated ? ' ✘' : '');
                    html += ' <button class="remove-participant small" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;" data-id="' + escapeHtml(p.id) + '">✕</button>';
                    html += '</span>';
                });
                html += '</div>';
            }

            html += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;">';
            html += '<select id="participant-select" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">';
            html += '<option value="">Add participant...</option>';
            html += '</select>';
            html += '<button id="add-participant-btn" class="primary small">Add</button>';
            html += '</div>';

            html += '</div>';
            return html;
        },

        renderRounds: function(tournament, queries) {
            var rounds = Array.isArray(tournament.rounds) ? tournament.rounds : [];

            var html = '<div id="rounds-section" style="margin-bottom:16px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">';
            html += '<h4 style="color:var(--accent);font-size:0.9rem;margin:0;">Rounds</h4>';
            html += '<button id="create-round-btn" class="primary small">+ Create Round</button>';
            html += '<span style="font-size:0.7rem;color:var(--text-dim);" id="rounds-status">' + rounds.length + ' / ' + tournament.totalRounds + ' rounds</span>';
            html += '</div>';

            if (rounds.length === 0) {
                html += '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No rounds created.</p>';
            } else {
                rounds.forEach(function(round, roundIndex) {
                    var isCompleted = round.status === 'completed';
                    var matchCount = Array.isArray(round.matches) ? round.matches.length : 0;

                    html += '<div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:8px;">';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">';
                    html += '<div><strong style="color:var(--accent);">Round ' + (roundIndex + 1) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + matchCount + ' matches)</span>';
                    html += ' <span style="font-size:0.65rem;padding:1px 8px;border-radius:8px;background:' +
                        (isCompleted ? 'var(--info-soft);color:var(--info);' : 'var(--bg);color:var(--text-dim);') + '">' +
                        (isCompleted ? '✓ Complete' : (matchCount > 0 ? 'In progress' : 'Empty')) + '</span>';
                    html += '</div>';
                    html += '<div style="display:flex;gap:4px;">';
                    html += '<button class="small secondary view-round-status-btn" data-round="' + roundIndex + '">◊ Status</button>';
                    html += '<button class="small secondary edit-round-btn" data-round="' + roundIndex + '">⚙ Edit</button>';
                    html += '<button class="small danger delete-round-btn" data-round="' + roundIndex + '">✕ Delete</button>';
                    html += '</div>';
                    html += '</div>';

                    // Match list
                    if (Array.isArray(round.matches) && round.matches.length > 0) {
                        html += '<div style="display:flex;flex-direction:column;gap:4px;padding-left:8px;">';
                        round.matches.forEach(function(match, matchIndex) {
                            var participantNames = [];
                            if (Array.isArray(match.participants)) {
                                match.participants.forEach(function(id) {
                                    var name = queries.getParticipantName(id);
                                    if (match.type === 'group_exam') {
                                        var result = match.results && match.results[id];
                                        if (result === 'pass') name += ' ✓ Pass';
                                        else if (result === 'fail') name += ' ✗ Fail';
                                        else name += ' ⏳ Pending';
                                    } else {
                                        var isWinner = match.winner && String(match.winner) === String(id);
                                        var isLoser = match.loser && String(match.loser) === String(id);
                                        if (isWinner) name += ' ★';
                                        else if (isLoser) name += ' ✘';
                                    }
                                    participantNames.push(name);
                                });
                            }

                            var matchStatus = match.status || 'pending';
                            var statusColor = matchStatus === 'completed' ? 'var(--accent)' : 'var(--warning)';
                            var borderColor = matchStatus === 'completed' ? 'var(--accent)' : 'var(--warning)';
                            var matchTypeLabel = match.type === 'group_exam' ? ' [Exam]' : '';

                            html += '<div class="match-item" data-round="' + roundIndex + '" data-match="' + matchIndex + '" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + borderColor + ';cursor:pointer;">';
                            html += '<span style="font-size:0.75rem;"><strong>' + participantNames.join(' vs ') + '</strong>' + matchTypeLabel + '</span>';
                            html += '<span style="font-size:0.65rem;color:' + statusColor + ';">' + matchStatus + '</span>';
                            html += '</div>';
                        });
                        html += '</div>';
                    }

                    if (!isCompleted) {
                        html += '<button class="small primary add-match-btn" data-round="' + roundIndex + '" style="margin-top:6px;">+ Add Match</button>';
                    }

                    html += '</div>';
                });
            }

            html += '</div>';
            return html;
        },

        renderEliminations: function(tournament, queries) {
            var eliminations = Array.isArray(tournament.eliminations) ? tournament.eliminations : [];

            var html = '<div id="elimination-section" style="margin-bottom:16px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border);">';
            html += '<h4 style="color:var(--danger);font-size:0.9rem;margin-bottom:8px;">Eliminations</h4>';

            if (eliminations.length === 0) {
                html += '<span style="color:var(--text-dim);font-size:0.75rem;">No eliminations</span>';
            } else {
                html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
                eliminations.forEach(function(e) {
                    var name = queries.getParticipantName(e.participantId);
                    html += '<span style="background:var(--danger-soft);padding:2px 8px;border-radius:10px;font-size:0.75rem;border:1px solid var(--danger);">';
                    html += escapeHtml(name) + ' ✘';
                    html += ' <button class="uneliminate-btn small" style="background:none;border:none;color:var(--text);cursor:pointer;font-size:0.6rem;padding:0 2px;" data-id="' + escapeHtml(e.participantId) + '">↻</button>';
                    html += '</span>';
                });
                html += '</div>';
            }

            html += '</div>';
            return html;
        },

        renderWinner: function(tournament, queries) {
            var winnerName = queries.getWinnerName(tournament);

            return '<div id="winner-section" style="padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--accent);">' +
                '<h4 style="color:var(--accent);font-size:0.9rem;margin-bottom:8px;">Tournament Winner</h4>' +
                '<div style="font-weight:600;color:var(--accent);font-size:1.1rem;">' + escapeHtml(winnerName) + '</div>' +
                '</div>';
        }
    };

    window.TournamentsRender = TournamentsRender;

})();
