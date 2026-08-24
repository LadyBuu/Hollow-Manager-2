/**
 * js/modules/tournaments/tournaments-ui.js - Tournament UI
 * Handles tournament rendering and user interaction
 * Path: js/modules/tournaments/tournaments-ui.js
 */

(function() {
    'use strict';

    var tournamentState = {
        currentTournamentId: null,
        currentMode: 'teams',
        expandedMatch: null,
        editingMatch: null
    };

    function renderTournaments(container) {
        if (!container) {
            container = document.getElementById('tab-tournaments');
        }
        if (!container) return;

        // Check if data exists
        if (!window.data) {
            console.warn('No data available for tournaments, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading tournament data...</p>';
            return;
        }

        // Ensure tournaments array exists
        if (!window.data.tournaments) {
            window.data.tournaments = [];
        }

        container.innerHTML = getTournamentsHTML();
        renderTournamentList();
        initTournamentEvents();
    }

    function getTournamentsHTML() {
        return `
            <div class="page-header">
                <h2>Tournaments</h2>
                <button id="add-tournament-btn" class="primary">+ New Tournament</button>
            </div>
            <div id="tournament-list">
                <div class="list-header tourn-header">
                    <span>Name</span>
                    <span>Mode</span>
                    <span>Rounds</span>
                    <span>Participants</span>
                    <span>Status</span>
                    <span>Actions</span>
                </div>
                <div id="tournaments-container">
                    <p class="empty-state">No tournaments created yet.</p>
                </div>
            </div>

            <!-- Tournament Form Modal -->
            <div id="tournament-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:500px;">
                    <div class="modal-header">
                        <h3 id="tournament-form-title">New Tournament</h3>
                        <button class="close-modal" id="close-tournament-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="tournament-form-inner">
                            <div class="form-group">
                                <label>Tournament Name *</label>
                                <input type="text" id="tournament-name" required>
                            </div>
                            <div class="form-group">
                                <label>Mode *</label>
                                <select id="tournament-mode">
                                    <option value="teams">Teams</option>
                                    <option value="individuals">Individuals</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Start Week</label>
                                <input type="number" id="tournament-start-week" min="1" max="52" value="1">
                            </div>
                            <div class="form-group">
                                <label>End Week</label>
                                <input type="number" id="tournament-end-week" min="1" max="52" value="52">
                            </div>
                            <div class="form-group">
                                <label>Number of Rounds</label>
                                <input type="number" id="tournament-rounds" min="1" max="10" value="1">
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-tournament-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-tournament-btn" class="primary">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Tournament Detail Modal -->
            <div id="tournament-detail-modal" class="modal hidden">
                <div class="modal-content wide">
                    <div class="modal-header">
                        <h3 id="detail-tournament-name">Tournament</h3>
                        <button class="close-modal" id="close-tournament-detail">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="tournament-info" style="margin-bottom:12px;"></div>

                        <!-- Participants Section -->
                        <div id="participants-section" style="margin-bottom:16px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border);">
                            <h4 style="color:var(--accent);font-size:0.9rem;margin-bottom:8px;">Participants</h4>
                            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                                <select id="participant-select" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                    <option value="">Add participant...</option>
                                </select>
                                <button id="add-participant-btn" class="primary small">Add</button>
                            </div>
                            <div id="participants-list" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;"></div>
                        </div>

                        <!-- Rounds Section -->
                        <div id="rounds-section" style="margin-bottom:16px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                                <h4 style="color:var(--accent);font-size:0.9rem;margin:0;">Rounds</h4>
                                <button id="create-round-btn" class="primary small">+ Create Round</button>
                                <span style="font-size:0.7rem;color:var(--text-dim);" id="rounds-status">0 / 0 rounds</span>
                            </div>
                            <div id="rounds-container"></div>
                        </div>

                        <!-- Elimination Management -->
                        <div id="elimination-section" style="margin-bottom:16px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border);">
                            <h4 style="color:var(--danger);font-size:0.9rem;margin-bottom:8px;">Individual Eliminations</h4>
                            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
                                <select id="elimination-select" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                    <option value="">Select individual...</option>
                                </select>
                                <button id="eliminate-btn" class="danger small">Eliminate</button>
                                <button id="uneliminate-btn" class="secondary small">Restore</button>
                            </div>
                            <div id="elimination-list" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
                        </div>

                        <!-- Winner Display -->
                        <div id="winner-section" style="padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--accent);">
                            <h4 style="color:var(--accent);font-size:0.9rem;margin-bottom:8px;">Tournament Winner</h4>
                            <div id="winner-display" style="font-weight:600;color:var(--accent);font-size:1.1rem;">
                                Not determined yet
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Match Edit Modal -->
            <div id="match-edit-modal" class="modal hidden">
                <div class="modal-content" style="max-width:650px;">
                    <div class="modal-header">
                        <h3 id="match-edit-title">Edit Match</h3>
                        <button class="close-modal" id="close-match-edit">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="match-edit-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderTournamentList() {
        var container = document.getElementById('tournaments-container');
        if (!container) return;

        var tournaments = window.getTournaments();
        if (tournaments.length === 0) {
            container.innerHTML = '<p class="empty-state">No tournaments created yet.</p>';
            return;
        }

        var html = '';
        tournaments.forEach(function(tourn) {
            var participantCount = tourn.participants ? tourn.participants.length : 0;
            var modeLabel = tourn.mode === 'teams' ? 'Teams' : 'Individuals';
            var statusColor = window.getTournamentStatusColor(tourn.status);
            var roundCount = tourn.rounds ? tourn.rounds.length : 0;
            var winnerDisplay = '';
            if (tourn.winner) {
                var winnerName = window.getParticipantName(tourn.winner);
                if (winnerName) {
                    winnerDisplay = ' ★ ' + winnerName;
                }
            }

            html += '<div class="list-item tourn-item" data-id="' + tourn.id + '">' +
                '<span><strong>' + tourn.name + '</strong>' + winnerDisplay + '</span>' +
                '<span style="font-size:0.75rem;">' + modeLabel + '</span>' +
                '<span>' + roundCount + '/' + tourn.totalRounds + '</span>' +
                '<span>' + participantCount + '</span>' +
                '<span style="color:' + statusColor + ';font-size:0.75rem;font-weight:600;">' + (tourn.status || 'draft') + '</span>' +
                '<span class="actions">' +
                    '<button class="small view-tournament" data-id="' + tourn.id + '">View</button>' +
                    '<button class="small edit-tournament" data-id="' + tourn.id + '">Edit</button>' +
                    '<button class="small danger delete-tournament" data-id="' + tourn.id + '">Delete</button>' +
                '</span>' +
            '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.view-tournament').forEach(function(btn) {
            btn.addEventListener('click', function() { viewTournament(btn.dataset.id); });
        });
        container.querySelectorAll('.edit-tournament').forEach(function(btn) {
            btn.addEventListener('click', function() { showTournamentForm(btn.dataset.id); });
        });
        container.querySelectorAll('.delete-tournament').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (window.deleteTournament(btn.dataset.id)) {
                    renderTournamentList();
                    closeTournamentDetail();
                }
            });
        });
    }

    function viewTournament(id) {
        var tourn = window.getTournament(id);
        if (!tourn) {
            return;
        }

        window.ensureTournamentArrays(tourn);
        window.checkRoundStatuses(tourn);

        tournamentState.currentTournamentId = id;

        var modal = document.getElementById('tournament-detail-modal');
        document.getElementById('detail-tournament-name').textContent = tourn.name;

        var info = document.getElementById('tournament-info');
        var statusColor = window.getTournamentStatusColor(tourn.status);
        var modeLabel = tourn.mode === 'teams' ? 'Teams' : 'Individuals';
        var winnerDisplay = '';
        if (tourn.winner) {
            var winnerName = window.getParticipantName(tourn.winner);
            if (winnerName) {
                winnerDisplay = ' | Winner: <span style="color:var(--accent);font-weight:600;">' + winnerName + '</span>';
            }
        }

        info.innerHTML =
            '<span style="color:var(--text-dim);font-size:0.8rem;">' +
            'Mode: <strong>' + modeLabel + '</strong> | ' +
            'Weeks ' + tourn.startWeek + ' - ' + tourn.endWeek + ' | ' +
            'Rounds: ' + (tourn.rounds ? tourn.rounds.length : 0) + '/' + tourn.totalRounds + ' | ' +
            'Status: <span style="color:' + statusColor + ';font-weight:600;">' + (tourn.status || 'draft') + '</span>' +
            winnerDisplay +
            '</span>';

        populateParticipantSelector(tourn);
        renderParticipants(tourn);
        renderRounds(tourn);
        renderEliminations(tourn);
        renderWinner(tourn);

        modal.dataset.tournamentId = id;
        modal.classList.remove('hidden');
    }

    function populateParticipantSelector(tourn) {
        var select = document.getElementById('participant-select');
        if (!select) return;

        var existingIds = (tourn.participants || []).map(function(p) { return p.id; });
        var startWeek = parseInt(tourn.startWeek) || 1;
        var endWeek = parseInt(tourn.endWeek) || 52;

        var options = [];

        if (tourn.mode === 'teams') {
            var data = window.data || {};
            var teams = data.teams ? data.teams.filter(function(t) {
                if (t.status === 'deleted') return false;
                if (existingIds.indexOf(t.id) !== -1) return false;
                var start = parseInt(t.startPeriod);
                var end = parseInt(t.endPeriod);
                if (isNaN(start)) return true;
                return start <= endWeek && (isNaN(end) || end >= startWeek);
            }) : [];
            teams.sort(function(a, b) { return a.name.localeCompare(b.name); });
            teams.forEach(function(t) {
                options.push({ id: t.id, name: t.name + ' (team)' });
            });
        } else {
            var chars = window.data ? window.data.characters : [];
            var trainees = chars.filter(function(c) {
                if (c.deceased) return false;
                if (existingIds.indexOf(c.id) !== -1) return false;
                if (window.isCharacterEliminatedByWeek(c, startWeek)) return false;
                var status = window.getCurrentStatus(c).toLowerCase();
                return status === 'trainee' || status === 'rookie' || status === 'junior';
            });
            trainees.sort(function(a, b) {
                var nameA = window.getDisplayName(a).toLowerCase();
                var nameB = window.getDisplayName(b).toLowerCase();
                return nameA.localeCompare(nameB);
            });
            trainees.forEach(function(c) {
                var name = window.getDisplayName(c);
                options.push({ id: c.id, name: name + ' (trainee)' });
            });
        }

        select.innerHTML = '<option value="">Add participant...</option>';
        options.forEach(function(opt) {
            var option = document.createElement('option');
            option.value = opt.id;
            option.textContent = opt.name;
            select.appendChild(option);
        });
    }

    function renderParticipants(tourn) {
        var container = document.getElementById('participants-list');
        if (!tourn.participants || tourn.participants.length === 0) {
            container.innerHTML = '<span style="color:var(--text-dim);font-size:0.75rem;">No participants added</span>';
            return;
        }

        var html = '';
        tourn.participants.forEach(function(p) {
            var name = window.getParticipantName(p.id);
            var isEliminated = tourn.eliminations && tourn.eliminations.some(function(e) { return String(e.participantId) === String(p.id); });
            var color = isEliminated ? 'var(--danger)' : 'var(--border)';
            var status = isEliminated ? ' ✘' : '';

            html += '<span style="background:var(--panel-alt);padding:2px 8px;border-radius:10px;font-size:0.75rem;border:1px solid ' + color + ';">';
            html += name + status;
            html += ' <button class="remove-participant small" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;" data-id="' + p.id + '">✕</button>';
            html += '</span>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.remove-participant').forEach(function(btn) {
            btn.addEventListener('click', function() {
                removeParticipant(tourn.id, this.dataset.id);
            });
        });
    }

    function renderRounds(tourn) {
        var container = document.getElementById('rounds-container');
        var status = document.getElementById('rounds-status');

        if (!tourn.rounds || !Array.isArray(tourn.rounds)) tourn.rounds = [];

        var roundCount = tourn.rounds.length;
        if (status) status.textContent = roundCount + ' / ' + tourn.totalRounds + ' rounds';

        if (roundCount === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No rounds created.</p>';
            return;
        }

        var html = '';
        tourn.rounds.forEach(function(round, roundIndex) {
            var roundLabel = (roundIndex + 1);
            var isCompleted = round.status === 'completed';
            var matchCount = round.matches ? round.matches.length : 0;

            html += '<div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:8px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">';
            html += '<div><strong style="color:var(--accent);">Round ' + roundLabel + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + matchCount + ' matches)</span>';
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

            html += renderRoundStatusSummary(tourn, roundIndex);

            if (!isCompleted) {
                html += '<button class="small primary add-match-btn" data-round="' + roundIndex + '" style="margin-bottom:6px;">+ Add Match</button>';
            }

            if (round.matches && round.matches.length > 0) {
                html += '<div style="display:flex;flex-direction:column;gap:4px;padding-left:8px;">';
                round.matches.forEach(function(match, matchIndex) {
                    var isGroupExam = match.type === 'group_exam';
                    var participantNames = [];

                    if (match.participants) {
                        match.participants.forEach(function(id) {
                            var name = window.getParticipantName(id);
                            if (isGroupExam) {
                                var result = match.results && match.results[id];
                                if (result === 'pass') {
                                    name += ' ✓ Pass';
                                } else if (result === 'fail') {
                                    name += ' ✗ Fail';
                                } else {
                                    name += ' ⏳ Pending';
                                }
                            } else {
                                var isWinner = match.winner && String(match.winner) === String(id);
                                var isLoser = match.loser && String(match.loser) === String(id);
                                var isAdvancing = match.status === 'completed' && !isWinner && !isLoser && match.participants.length > 2;
                                if (isWinner) name += ' ★';
                                else if (isLoser) name += ' ✘';
                                else if (isAdvancing) name += ' ↑';
                            }
                            participantNames.push(name);
                        });
                    }

                    var matchStatus = match.status || 'pending';
                    var statusColor = matchStatus === 'completed' ? 'var(--accent)' : 'var(--warning)';
                    var borderColor = matchStatus === 'completed' ? 'var(--accent)' : 'var(--warning)';
                    var matchTypeLabel = isGroupExam ? ' [Exam]' : '';

                    html += '<div class="match-item" data-round="' + roundIndex + '" data-match="' + matchIndex + '" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + borderColor + ';cursor:pointer;">';
                    html += '<span style="font-size:0.75rem;"><strong>' + participantNames.join(' vs ') + '</strong>' + matchTypeLabel + '</span>';
                    html += '<span style="font-size:0.65rem;color:' + statusColor + ';">' + matchStatus + '</span>';
                    html += '</div>';
                });
                html += '</div>';
            }

            html += '</div>';
        });

        container.innerHTML = html;

        container.querySelectorAll('.match-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var roundIndex = parseInt(this.dataset.round);
                var matchIndex = parseInt(this.dataset.match);
                showEditMatchModal(tourn.id, roundIndex, matchIndex);
            });
        });

        container.querySelectorAll('.add-match-btn').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function() {
                var roundIndex = parseInt(this.dataset.round);
                showAddMatchModal(tourn.id, roundIndex);
            });
        });

        container.querySelectorAll('.edit-round-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var roundIndex = parseInt(this.dataset.round);
                showEditRoundModal(tourn.id, roundIndex);
            });
        });

        container.querySelectorAll('.view-round-status-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var roundIndex = parseInt(this.dataset.round);
                showRoundStatusModal(tourn.id, roundIndex);
            });
        });

        container.querySelectorAll('.delete-round-btn').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', function() {
                deleteRound(tourn.id, parseInt(this.dataset.round));
            });
        });
    }

    function renderRoundStatusSummary(tourn, roundIndex) {
        var round = tourn.rounds[roundIndex];
        if (!round) return '';

        var html = '';
        var participants = window.getRoundParticipants(tourn, roundIndex);
        var eliminatedIds = [];
        var advancingIds = [];
        var winnerIds = [];
        var loserIds = [];
        var pendingIds = [];
        var passedIds = [];
        var failedIds = [];

        if (round.matches) {
            round.matches.forEach(function(match) {
                var isGroupExam = match.type === 'group_exam';

                if (match.participants) {
                    match.participants.forEach(function(id) {
                        if (isGroupExam) {
                            var result = match.results && match.results[id];
                            if (result === 'pass') {
                                if (passedIds.indexOf(id) === -1) passedIds.push(id);
                            } else if (result === 'fail') {
                                if (failedIds.indexOf(id) === -1) failedIds.push(id);
                            } else {
                                if (pendingIds.indexOf(id) === -1) pendingIds.push(id);
                            }
                        } else {
                            var isWinner = match.winner && String(match.winner) === String(id);
                            var isLoser = match.loser && String(match.loser) === String(id);
                            var isAdvancing = match.advancing && match.advancing.some(function(aid) { return String(aid) === String(id); });

                            if (isWinner) {
                                if (winnerIds.indexOf(id) === -1) winnerIds.push(id);
                            } else if (isLoser) {
                                if (loserIds.indexOf(id) === -1) loserIds.push(id);
                            } else if (isAdvancing || (match.status === 'completed' && !isWinner && !isLoser)) {
                                if (advancingIds.indexOf(id) === -1) advancingIds.push(id);
                            } else {
                                if (pendingIds.indexOf(id) === -1) pendingIds.push(id);
                            }
                        }
                    });
                }
            });
        }

        if (tourn.eliminations) {
            tourn.eliminations.forEach(function(elim) {
                if (eliminatedIds.indexOf(elim.participantId) === -1) {
                    var inRound = participants.some(function(id) { return String(id) === String(elim.participantId); });
                    if (inRound) {
                        eliminatedIds.push(elim.participantId);
                    }
                }
            });
        }

        var hasStatus = winnerIds.length > 0 || loserIds.length > 0 || advancingIds.length > 0 ||
                        pendingIds.length > 0 || passedIds.length > 0 || failedIds.length > 0;

        if (hasStatus) {
            html += '<div style="background:var(--bg);border-radius:4px;padding:6px 8px;margin-bottom:6px;border:1px solid var(--border-soft);">';
            html += '<div style="font-size:0.65rem;color:var(--text-dim);margin-bottom:4px;">Round Status:</div>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';

            if (winnerIds.length > 0) {
                html += '<span style="background:var(--accent-soft);padding:1px 6px;border-radius:8px;font-size:0.65rem;border:1px solid var(--accent);">🏆 Winners: ';
                var names = winnerIds.map(function(id) { return window.getParticipantName(id); });
                html += names.join(', ');
                html += '</span>';
            }

            if (advancingIds.length > 0) {
                html += '<span style="background:var(--warning-soft);padding:1px 6px;border-radius:8px;font-size:0.65rem;border:1px solid var(--warning);">↑ Advancing: ';
                var names = advancingIds.map(function(id) { return window.getParticipantName(id); });
                html += names.join(', ');
                html += '</span>';
            }

            if (passedIds.length > 0) {
                html += '<span style="background:var(--accent-soft);padding:1px 6px;border-radius:8px;font-size:0.65rem;border:1px solid var(--accent);">✓ Passed: ';
                var names = passedIds.map(function(id) { return window.getParticipantName(id); });
                html += names.join(', ');
                html += '</span>';
            }

            if (failedIds.length > 0) {
                html += '<span style="background:var(--danger-soft);padding:1px 6px;border-radius:8px;font-size:0.65rem;border:1px solid var(--danger);">✗ Failed: ';
                var names = failedIds.map(function(id) { return window.getParticipantName(id); });
                html += names.join(', ');
                html += '</span>';
            }

            if (loserIds.length > 0) {
                html += '<span style="background:var(--danger-soft);padding:1px 6px;border-radius:8px;font-size:0.65rem;border:1px solid var(--danger);">✘ Eliminated: ';
                var names = loserIds.map(function(id) { return window.getParticipantName(id); });
                html += names.join(', ');
                html += '</span>';
            }

            if (pendingIds.length > 0) {
                html += '<span style="background:var(--bg);padding:1px 6px;border-radius:8px;font-size:0.65rem;border:1px solid var(--border);">⏳ Pending: ';
                var names = pendingIds.map(function(id) { return window.getParticipantName(id); });
                html += names.join(', ');
                html += '</span>';
            }

            html += '</div>';
            html += '</div>';
        }

        return html;
    }

    function showRoundStatusModal(tournId, roundIndex) {
        var tourn = window.getTournament(tournId);
        if (!tourn || !tourn.rounds || !tourn.rounds[roundIndex]) return;

        var round = tourn.rounds[roundIndex];
        var roundLabel = roundIndex + 1;

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:550px;">
                <div class="modal-header">
                    <h3>Round ${roundLabel} - Status</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom:12px;">
                        <p style="color:var(--text-dim);font-size:0.8rem;">
                            Status: <strong style="color:${round.status === 'completed' ? 'var(--accent)' : 'var(--warning)'}">${round.status || 'pending'}</strong>
                            | Matches: <strong>${round.matches ? round.matches.length : 0}</strong>
                            | Match Size: <strong>${round.matchSize || 2}</strong>
                        </p>
                    </div>
                    <div style="margin-bottom:12px;">
                        <h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:6px;">Participants</h4>
                        ${renderParticipantStatusList(tourn, roundIndex)}
                    </div>
                    <div style="margin-bottom:12px;">
                        <h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:6px;">Matches</h4>
                        ${renderMatchStatusList(tourn, roundIndex)}
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="close-status-modal" class="secondary">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#close-status-modal').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });
    }

    function renderParticipantStatusList(tourn, roundIndex) {
        var round = tourn.rounds[roundIndex];
        if (!round) return '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No participants</p>';

        var participants = window.getRoundParticipants(tourn, roundIndex);
        if (participants.length === 0) {
            return '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No participants in this round</p>';
        }

        var html = '<div style="display:flex;flex-wrap:wrap;gap:4px;">';

        participants.forEach(function(id) {
            var name = window.getParticipantName(id);
            var status = window.getParticipantRoundStatus(tourn, roundIndex, id);
            var color = 'var(--text-dim)';
            var icon = '';
            var bg = 'var(--panel-alt)';

            if (status === 'winner') {
                color = 'var(--accent)';
                icon = '🏆 ';
                bg = 'var(--accent-soft)';
            } else if (status === 'advancing') {
                color = 'var(--warning)';
                icon = '↑ ';
                bg = 'var(--warning-soft)';
            } else if (status === 'eliminated') {
                color = 'var(--danger)';
                icon = '✘ ';
                bg = 'var(--danger-soft)';
            } else if (status === 'passed') {
                color = 'var(--accent)';
                icon = '✓ ';
                bg = 'var(--accent-soft)';
            } else if (status === 'failed') {
                color = 'var(--danger)';
                icon = '✗ ';
                bg = 'var(--danger-soft)';
            } else if (status === 'pending') {
                color = 'var(--text-dim)';
                icon = '⏳ ';
                bg = 'var(--bg)';
            }

            html += '<span style="background:' + bg + ';padding:2px 10px;border-radius:12px;font-size:0.75rem;border:1px solid ' + color + ';color:' + color + ';">';
            html += icon + name;
            html += '</span>';
        });

        html += '</div>';
        return html;
    }

    function renderMatchStatusList(tourn, roundIndex) {
        var round = tourn.rounds[roundIndex];
        if (!round || !round.matches || round.matches.length === 0) {
            return '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No matches</p>';
        }

        var html = '<div style="display:flex;flex-direction:column;gap:4px;">';

        round.matches.forEach(function(match, matchIndex) {
            var isGroupExam = match.type === 'group_exam';
            var participantNames = [];

            if (match.participants) {
                match.participants.forEach(function(id) {
                    var name = window.getParticipantName(id);
                    if (isGroupExam) {
                        var result = match.results && match.results[id];
                        if (result === 'pass') name = '✓ ' + name;
                        else if (result === 'fail') name = '✗ ' + name;
                        else name = '⏳ ' + name;
                    } else {
                        var isWinner = match.winner && String(match.winner) === String(id);
                        var isLoser = match.loser && String(match.loser) === String(id);
                        var isAdvancing = match.advancing && match.advancing.some(function(aid) { return String(aid) === String(id); });
                        if (isWinner) name = '🏆 ' + name;
                        else if (isLoser) name = '✘ ' + name;
                        else if (isAdvancing) name = '↑ ' + name;
                    }
                    participantNames.push(name);
                });
            }

            var matchStatus = match.status || 'pending';
            var statusColor = matchStatus === 'completed' ? 'var(--accent)' : 'var(--warning)';
            var borderColor = matchStatus === 'completed' ? 'var(--accent)' : 'var(--warning)';
            var matchTypeLabel = isGroupExam ? ' [Exam]' : '';

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + borderColor + ';">';
            html += '<span style="font-size:0.75rem;"><strong>Match ' + (matchIndex + 1) + ':</strong> ' + participantNames.join(' vs ') + matchTypeLabel + '</span>';
            html += '<span style="font-size:0.65rem;color:' + statusColor + ';">' + matchStatus + '</span>';
            html += '</div>';
        });

        html += '</div>';
        return html;
    }

    function showEditRoundModal(tournId, roundIndex) {
        var tourn = window.getTournament(tournId);
        if (!tourn || !tourn.rounds || !tourn.rounds[roundIndex]) return;

        var round = tourn.rounds[roundIndex];

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:450px;">
                <div class="modal-header">
                    <h3>Edit Round ${roundIndex + 1}</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Match Type:</label>
                        <select id="edit-round-match-type" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <option value="standard" ${round.matchType !== 'group_exam' ? 'selected' : ''}>Standard (Winner/Loser)</option>
                            <option value="group_exam" ${round.matchType === 'group_exam' ? 'selected' : ''}>Group Exam (Pass/Fail)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Match Size (participants per match):</label>
                        <select id="edit-round-match-size" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <option value="2" ${round.matchSize === 2 ? 'selected' : ''}>2</option>
                            <option value="3" ${round.matchSize === 3 ? 'selected' : ''}>3</option>
                            <option value="4" ${round.matchSize === 4 ? 'selected' : ''}>4</option>
                        </select>
                    </div>
                    <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);">
                        <p style="font-size:0.75rem;color:var(--text-dim);">
                            <strong>Current matches:</strong> ${round.matches ? round.matches.length : 0}
                            ${round.matches && round.matches.length > 0 ? ' (matches will be preserved)' : ''}
                        </p>
                        <p style="font-size:0.75rem;color:var(--text-dim);">
                            <strong>Participants in this round:</strong>
                            ${window.getRoundParticipants(tourn, roundIndex).length}
                        </p>
                    </div>
                    <div style="margin-top:12px;display:flex;gap:4px;flex-wrap:wrap;">
                        <button id="regenerate-matches-btn" class="primary small">↻ Regenerate Matches</button>
                    </div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-edit-round" class="secondary">Close</button>
                        <button type="button" id="save-edit-round" class="primary">Save Changes</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').onclick = function() { modal.remove(); };
        modal.querySelector('#cancel-edit-round').onclick = function() { modal.remove(); };
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });

        modal.querySelector('#save-edit-round').onclick = function() {
            var matchType = document.getElementById('edit-round-match-type').value;
            var matchSize = parseInt(document.getElementById('edit-round-match-size').value);

            if (matchType !== round.matchType) {
                round.matchType = matchType;
            }
            if (matchSize !== round.matchSize) {
                round.matchSize = matchSize;
            }

            if (round.matches && round.matches.length > 0) {
                if (confirm('Changing match settings will regenerate all matches in this round. Continue?')) {
                    regenerateRoundMatches(tourn, roundIndex);
                }
            }
            modal.remove();
            viewTournament(tournId);
        };

        modal.querySelector('#regenerate-matches-btn').onclick = function() {
            if (confirm('This will delete all existing matches in this round and recreate them. Continue?')) {
                regenerateRoundMatches(tourn, roundIndex);
                modal.remove();
                viewTournament(tournId);
            }
        };
    }

    function regenerateRoundMatches(tourn, roundIndex) {
        var round = tourn.rounds[roundIndex];
        var matchSize = round.matchSize || 2;
        var matchType = round.matchType || 'standard';

        var allParticipants = window.getRoundParticipants(tourn, roundIndex);

        if (allParticipants.length === 0 && roundIndex > 0) {
            var prevRound = tourn.rounds[roundIndex - 1];
            if (prevRound && prevRound.matches) {
                prevRound.matches.forEach(function(m) {
                    if (m.participants) {
                        m.participants.forEach(function(id) {
                            var isEliminated = tourn.eliminations && tourn.eliminations.some(function(e) {
                                return String(e.participantId) === String(id);
                            });
                            if (!isEliminated && allParticipants.indexOf(id) === -1) {
                                allParticipants.push(id);
                            }
                        });
                    }
                    if (m.advancing && m.advancing.length > 0) {
                        m.advancing.forEach(function(id) {
                            if (allParticipants.indexOf(id) === -1) {
                                allParticipants.push(id);
                            }
                        });
                    }
                });
            }
        }

        if (allParticipants.length < 2) {
            alert('Not enough participants to create matches. Need at least 2 participants.');
            return;
        }

        var shuffled = allParticipants.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
        }

        var newMatches = [];
        for (var i = 0; i < shuffled.length; i += matchSize) {
            var matchParticipants = shuffled.slice(i, i + matchSize);
            if (matchParticipants.length >= 2) {
                var match = {
                    participants: matchParticipants,
                    status: 'pending',
                    type: matchType
                };

                if (matchType === 'group_exam') {
                    match.results = {};
                    match.participants.forEach(function(id) {
                        match.results[id] = null;
                    });
                } else {
                    match.winner = null;
                    match.loser = null;
                    match.advancing = [];
                }

                newMatches.push(match);
            } else if (matchParticipants.length === 1 && newMatches.length > 0) {
                var lastMatch = newMatches[newMatches.length - 1];
                if (lastMatch.participants.length < matchSize) {
                    lastMatch.participants.push(matchParticipants[0]);
                    if (matchType === 'group_exam') {
                        lastMatch.results[matchParticipants[0]] = null;
                    }
                }
            }
        }

        if (newMatches.length > 0 && newMatches[newMatches.length - 1].participants.length < 2) {
            var leftover = newMatches[newMatches.length - 1].participants;
            newMatches.pop();
            if (newMatches.length > 0) {
                newMatches[0].participants = newMatches[0].participants.concat(leftover);
                if (matchType === 'group_exam') {
                    leftover.forEach(function(id) {
                        newMatches[0].results[id] = null;
                    });
                }
            }
        }

        round.matches = newMatches;
        round.status = 'pending';

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
    }

    function renderEliminations(tourn) {
        var container = document.getElementById('elimination-list');
        var select = document.getElementById('elimination-select');

        if (!tourn.participants || tourn.participants.length === 0) {
            if (select) {
                select.innerHTML = '<option value="">No participants available</option>';
            }
            container.innerHTML = '<span style="color:var(--text-dim);font-size:0.75rem;">No participants in tournament</span>';
            return;
        }

        if (select) {
            var participants = tourn.participants || [];
            var currentValue = select.value;
            select.innerHTML = '<option value="">Select individual...</option>';

            var currentWeek = parseInt(tourn.startWeek) || 1;
            var allChars = [];

            participants.forEach(function(p) {
                var char = window.getCharacterById(p.id);
                if (char) {
                    var name = window.getDisplayName(char);
                    var teamName = '';
                    var data = window.data || {};
                    if (data.teams) {
                        data.teams.forEach(function(t) {
                            if (t.members) {
                                t.members.forEach(function(m) {
                                    if (String(m.characterId) === String(char.id)) {
                                        teamName = t.name;
                                    }
                                });
                            }
                        });
                    }

                    var isEliminatedInThisTournament = tourn.eliminations && tourn.eliminations.some(function(e) {
                        return String(e.participantId) === String(char.id);
                    });

                    var wasEliminatedBefore = false;
                    if (char.eliminatedWeeks && char.eliminatedWeeks.length > 0) {
                        for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                            var elimWeek = parseInt(char.eliminatedWeeks[i]);
                            if (!isNaN(elimWeek) && elimWeek < currentWeek) {
                                wasEliminatedBefore = true;
                                break;
                            }
                        }
                    }
                    if (char.eliminations) {
                        for (var i = 0; i < char.eliminations.length; i++) {
                            var elim = char.eliminations[i];
                            if (elim.standalone) {
                                var elimWeek = parseInt(elim.week);
                                if (!isNaN(elimWeek) && elimWeek < currentWeek) {
                                    wasEliminatedBefore = true;
                                    break;
                                }
                            }
                        }
                    }

                    var isDeceased = char.deceased || false;
                    if (isDeceased) {
                        if (char.deathYear) {
                            var deathYear = parseInt(char.deathYear);
                            if (!isNaN(deathYear) && deathYear <= currentWeek) {
                                isDeceased = true;
                            }
                        }
                        if (char.deathAge) {
                            var birthYear = parseInt(char.birthYear);
                            if (!isNaN(birthYear)) {
                                var deathYear = birthYear + parseInt(char.deathAge);
                                if (deathYear <= currentWeek) {
                                    isDeceased = true;
                                }
                            }
                        }
                    }

                    allChars.push({
                        id: char.id,
                        name: name,
                        team: teamName,
                        isEliminatedInThisTournament: isEliminatedInThisTournament,
                        wasEliminatedBefore: wasEliminatedBefore || isDeceased,
                        isDeceased: isDeceased
                    });
                }
            });

            if (tourn.mode === 'teams') {
                participants.forEach(function(p) {
                    var team = window.getTeamById(p.id);
                    if (team && team.members) {
                        team.members.forEach(function(member) {
                            var char = window.getCharacterById(member.characterId);
                            if (char) {
                                var name = window.getDisplayName(char);
                                var isInList = allChars.some(function(c) { return String(c.id) === String(char.id); });
                                if (!isInList) {
                                    var isEliminatedInThisTournament = tourn.eliminations && tourn.eliminations.some(function(e) {
                                        return String(e.participantId) === String(char.id);
                                    });

                                    var wasEliminatedBefore = false;
                                    if (char.eliminatedWeeks && char.eliminatedWeeks.length > 0) {
                                        for (var i = 0; i < char.eliminatedWeeks.length; i++) {
                                            var elimWeek = parseInt(char.eliminatedWeeks[i]);
                                            if (!isNaN(elimWeek) && elimWeek < currentWeek) {
                                                wasEliminatedBefore = true;
                                                break;
                                            }
                                        }
                                    }
                                    if (char.eliminations) {
                                        for (var i = 0; i < char.eliminations.length; i++) {
                                            var elim = char.eliminations[i];
                                            if (elim.standalone) {
                                                var elimWeek = parseInt(elim.week);
                                                if (!isNaN(elimWeek) && elimWeek < currentWeek) {
                                                    wasEliminatedBefore = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }

                                    var isDeceased = char.deceased || false;
                                    if (isDeceased) {
                                        if (char.deathYear) {
                                            var deathYear = parseInt(char.deathYear);
                                            if (!isNaN(deathYear) && deathYear <= currentWeek) {
                                                isDeceased = true;
                                            }
                                        }
                                        if (char.deathAge) {
                                            var birthYear = parseInt(char.birthYear);
                                            if (!isNaN(birthYear)) {
                                                var deathYear = birthYear + parseInt(char.deathAge);
                                                if (deathYear <= currentWeek) {
                                                    isDeceased = true;
                                                }
                                            }
                                        }
                                    }

                                    allChars.push({
                                        id: char.id,
                                        name: name,
                                        team: team.name,
                                        isEliminatedInThisTournament: isEliminatedInThisTournament,
                                        wasEliminatedBefore: wasEliminatedBefore || isDeceased,
                                        isDeceased: isDeceased
                                    });
                                }
                            }
                        });
                    }
                });
            }

            var seen = {};
            allChars = allChars.filter(function(c) {
                if (seen[c.id]) return false;
                seen[c.id] = true;
                return true;
            });

            allChars.sort(function(a, b) { return a.name.localeCompare(b.name); });

            var availableChars = [];
            var eliminatedInThisTournament = [];
            var eliminatedBefore = [];

            allChars.forEach(function(c) {
                if (c.isEliminatedInThisTournament) {
                    eliminatedInThisTournament.push(c);
                } else if (c.wasEliminatedBefore || c.isDeceased) {
                    eliminatedBefore.push(c);
                } else {
                    availableChars.push(c);
                }
            });

            availableChars.forEach(function(c) {
                var option = document.createElement('option');
                option.value = c.id;
                var teamDisplay = c.team ? ' (' + c.team + ')' : '';
                option.textContent = c.name + teamDisplay + ' ✓ available';
                option.style.color = 'var(--accent)';
                select.appendChild(option);
            });

            if (eliminatedInThisTournament.length > 0) {
                var separator = document.createElement('option');
                separator.disabled = true;
                separator.textContent = '──────────────── Already eliminated in this tournament ────────────────';
                separator.style.color = 'var(--text-dim)';
                select.appendChild(separator);

                eliminatedInThisTournament.forEach(function(c) {
                    var option = document.createElement('option');
                    option.value = c.id;
                    var teamDisplay = c.team ? ' (' + c.team + ')' : '';
                    option.textContent = c.name + teamDisplay + ' ✘ eliminated';
                    option.style.color = 'var(--danger)';
                    option.disabled = true;
                    select.appendChild(option);
                });
            }

            if (eliminatedBefore.length > 0) {
                var separator = document.createElement('option');
                separator.disabled = true;
                separator.textContent = '──────────────── Eliminated in previous tournaments ────────────────';
                separator.style.color = 'var(--text-dim)';
                select.appendChild(separator);

                eliminatedBefore.forEach(function(c) {
                    var option = document.createElement('option');
                    option.value = c.id;
                    var teamDisplay = c.team ? ' (' + c.team + ')' : '';
                    var reason = c.isDeceased ? ' ✝ deceased' : ' ⚠ eliminated before week ' + currentWeek;
                    option.textContent = c.name + teamDisplay + reason;
                    option.style.color = 'var(--text-dim)';
                    option.style.textDecoration = 'line-through';
                    option.disabled = true;
                    select.appendChild(option);
                });
            }

            if (currentValue) select.value = currentValue;
        }

        if (!tourn.eliminations || tourn.eliminations.length === 0) {
            container.innerHTML = '<span style="color:var(--text-dim);font-size:0.75rem;">No eliminations</span>';
            return;
        }

        var html = '';
        var currentWeek = parseInt(tourn.startWeek) || 1;

        tourn.eliminations.forEach(function(elim) {
            var name = window.getParticipantName(elim.participantId);
            var teamName = '';
            var data = window.data || {};
            if (data.teams) {
                data.teams.forEach(function(t) {
                    if (t.members) {
                        t.members.forEach(function(m) {
                            if (String(m.characterId) === String(elim.participantId)) {
                                teamName = t.name;
                            }
                        });
                    }
                });
            }

            var elimWeek = parseInt(elim.week);
            var isBeforeStart = !isNaN(elimWeek) && elimWeek < currentWeek;

            html += '<span style="background:' + (isBeforeStart ? 'var(--bg)' : 'var(--danger-soft)') + ';padding:2px 8px;border-radius:10px;font-size:0.75rem;border:1px solid ' + (isBeforeStart ? 'var(--border)' : 'var(--danger)') + ';' + (isBeforeStart ? 'opacity:0.5;' : '') + '">';
            html += name + (teamName ? ' (' + teamName + ')' : '') + ' ✘';
            if (isBeforeStart) {
                html += ' <span style="font-size:0.6rem;color:var(--text-dim);">(before tournament)</span>';
            }
            if (!isBeforeStart) {
                html += ' <button class="uneliminate-btn small" style="background:none;border:none;color:var(--text);cursor:pointer;font-size:0.6rem;padding:0 2px;" data-id="' + elim.participantId + '">↻</button>';
            }
            html += '</span>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.uneliminate-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                uneliminateParticipant(tourn.id, this.dataset.id);
            });
        });
    }

    function renderWinner(tourn) {
        var container = document.getElementById('winner-display');
        if (tourn.winner) {
            var name = window.getParticipantName(tourn.winner);
            container.innerHTML = '🏆 ' + name;
            container.style.color = 'var(--accent)';
            container.style.fontWeight = '600';
            container.style.fontSize = '1.1rem';
        } else {
            container.innerHTML = 'Not determined yet';
            container.style.color = 'var(--text-dim)';
            container.style.fontWeight = 'normal';
            container.style.fontSize = '1rem';
        }
    }

    function showAddMatchModal(tournId, roundIndex) {
        var tourn = window.getTournament(tournId);
        if (!tourn || !tourn.rounds || !tourn.rounds[roundIndex]) return;

        var round = tourn.rounds[roundIndex];
        var availableParticipants = getAvailableParticipants(tourn, roundIndex + 1);

        if (availableParticipants.length < 2) {
            alert('Need at least 2 available participants.');
            return;
        }

        var matchType = round.matchType || 'standard';
        var isGroupExam = matchType === 'group_exam';

        var modal = document.getElementById('match-edit-modal');
        document.getElementById('match-edit-title').textContent = 'Add Match - Round ' + (roundIndex + 1) + (isGroupExam ? ' (Exam)' : '');

        var content = document.getElementById('match-edit-content');

        var html = '<div style="margin-bottom:12px;">';
        html += '<p style="color:var(--text-dim);font-size:0.8rem;">';
        if (isGroupExam) {
            html += 'Click participants to add/remove them from this exam group. Each participant will get a <strong>Pass</strong> or <strong>Fail</strong> result.';
        } else {
            html += 'Click participants to add/remove them from the match.';
        }
        html += '</p>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:8px;background:var(--panel-alt);border-radius:6px;min-height:40px;border:1px dashed var(--border);" id="match-selected-participants">';
        html += '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">Click participants below to select them...</span>';
        html += '</div>';
        html += '</div>';

        html += '<div style="margin-bottom:12px;">';
        html += '<label style="font-size:0.7rem;color:var(--text-dim);">Group size:</label>';
        html += '<input type="number" id="match-size-input" min="2" max="10" value="' + (round.matchSize || 2) + '" style="width:60px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-left:8px;">';
        html += '</div>';

        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;" id="match-available-participants">';
        availableParticipants.forEach(function(id) {
            var name = window.getParticipantName(id);
            html += '<button class="small participant-tag" data-id="' + id + '" style="background:var(--panel-alt);border:1px solid var(--border-soft);padding:4px 10px;border-radius:10px;cursor:pointer;">' + name + '</button>';
        });
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" id="cancel-add-match" class="secondary">Cancel</button>';
        html += '<button type="button" id="create-match-submit" class="primary">Create Match</button>';
        html += '</div>';

        content.innerHTML = html;
        content.dataset.tournId = tournId;
        content.dataset.roundIndex = roundIndex;

        var selectedIds = [];
        var selectedContainer = document.getElementById('match-selected-participants');
        var availableContainer = document.getElementById('match-available-participants');

        function updateSelection() {
            var matchSize = parseInt(document.getElementById('match-size-input').value) || 2;

            if (selectedIds.length === 0) {
                selectedContainer.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">Click participants below to select them...</span>';
            } else {
                var html = '<div style="display:flex;flex-wrap:wrap;gap:4px;width:100%;">';
                selectedIds.forEach(function(id) {
                    var name = window.getParticipantName(id);
                    html += '<span style="background:var(--accent-soft);padding:2px 10px;border-radius:10px;font-size:0.75rem;border:1px solid var(--accent);display:inline-flex;align-items:center;gap:4px;">' + name + ' <button class="remove-selected small" data-id="' + id + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button></span>';
                });
                var remaining = matchSize - selectedIds.length;
                if (remaining > 0) {
                    html += '<span style="color:var(--text-dim);font-size:0.65rem;padding:4px;">Add ' + remaining + ' more</span>';
                } else {
                    html += '<span style="color:var(--accent);font-size:0.65rem;padding:4px;">✓ Ready!</span>';
                }
                html += '</div>';
                selectedContainer.innerHTML = html;
            }

            availableContainer.querySelectorAll('.participant-tag').forEach(function(btn) {
                var id = btn.dataset.id;
                if (selectedIds.indexOf(id) !== -1) {
                    btn.style.background = 'var(--accent-soft)';
                    btn.style.borderColor = 'var(--accent)';
                    btn.textContent = window.getParticipantName(id) + ' ✓';
                } else {
                    btn.style.background = 'var(--panel-alt)';
                    btn.style.borderColor = 'var(--border-soft)';
                    btn.textContent = window.getParticipantName(id);
                }
            });
        }

        availableContainer.querySelectorAll('.participant-tag').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = this.dataset.id;
                var matchSize = parseInt(document.getElementById('match-size-input').value) || 2;
                var idx = selectedIds.indexOf(id);
                if (idx !== -1) {
                    selectedIds.splice(idx, 1);
                } else if (selectedIds.length < matchSize) {
                    selectedIds.push(id);
                } else {
                    alert('Maximum participants reached (' + matchSize + ').');
                }
                updateSelection();
            });
        });

        selectedContainer.addEventListener('click', function(e) {
            if (e.target.classList.contains('remove-selected')) {
                var id = e.target.dataset.id;
                var idx = selectedIds.indexOf(id);
                if (idx !== -1) selectedIds.splice(idx, 1);
                updateSelection();
            }
        });

        document.getElementById('match-size-input').addEventListener('change', function() {
            var matchSize = parseInt(this.value) || 2;
            if (selectedIds.length > matchSize) {
                alert('You have ' + selectedIds.length + ' participants selected, but the group only allows ' + matchSize + '.');
                selectedIds = selectedIds.slice(0, matchSize);
            }
            updateSelection();
        });

        document.getElementById('create-match-submit').onclick = function() {
            var matchSize = parseInt(document.getElementById('match-size-input').value) || 2;
            if (selectedIds.length < 2) {
                alert('Please select at least 2 participants.');
                return;
            }
            if (selectedIds.length !== matchSize) {
                alert('You need exactly ' + matchSize + ' participants.');
                return;
            }

            var round = tourn.rounds[roundIndex];
            if (!round.matches) round.matches = [];

            var newMatch = {
                participants: selectedIds.slice(),
                status: 'pending',
                type: matchType
            };

            if (isGroupExam) {
                newMatch.results = {};
                selectedIds.forEach(function(id) {
                    newMatch.results[id] = null;
                });
            } else {
                newMatch.winner = null;
                newMatch.loser = null;
                newMatch.advancing = [];
            }

            round.matches.push(newMatch);

            if (round.status === 'completed') {
                round.status = 'pending';
                tourn.status = 'active';
            }

            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }
            modal.classList.add('hidden');
            viewTournament(tournId);
        };

        document.getElementById('cancel-add-match').onclick = function() {
            modal.classList.add('hidden');
        };

        updateSelection();
        modal.classList.remove('hidden');
    }

    function showEditMatchModal(tournId, roundIndex, matchIndex) {
        var tourn = window.getTournament(tournId);
        if (!tourn || !tourn.rounds || !tourn.rounds[roundIndex]) return;

        var round = tourn.rounds[roundIndex];
        var match = round.matches[matchIndex];
        if (!match) return;

        var isGroupExam = match.type === 'group_exam';

        var modal = document.getElementById('match-edit-modal');
        document.getElementById('match-edit-title').textContent = 'Edit ' + (isGroupExam ? 'Exam' : 'Match') + ' - Round ' + (roundIndex + 1);

        var content = document.getElementById('match-edit-content');

        if (isGroupExam) {
            var html = '<div style="margin-bottom:12px;">';
            html += '<p style="color:var(--text-dim);font-size:0.8rem;">Set Pass/Fail for each participant.</p>';
            html += '</div>';

            html += '<div style="margin-bottom:12px;">';
            html += '<p style="color:var(--text-dim);font-size:0.8rem;">Participants:</p>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;">';
            match.participants.forEach(function(id) {
                var name = window.getParticipantName(id);
                var result = match.results && match.results[id];
                var isPassed = result === 'pass';
                var isFailed = result === 'fail';
                var isPending = !result || result === null;
                var style = 'background:var(--panel-alt);padding:2px 8px;border-radius:10px;font-size:0.75rem;border:1px solid var(--border-soft);';
                if (isPassed) style += 'border-color:var(--accent);background:var(--accent-soft);';
                else if (isFailed) style += 'border-color:var(--danger);background:var(--danger-soft);';
                html += '<span style="' + style + '">' + name +
                    (isPassed ? ' ✓ Pass' : '') +
                    (isFailed ? ' ✗ Fail' : '') +
                    (isPending ? ' ⏳ Pending' : '') +
                '</span>';
            });
            html += '</div>';
            html += '</div>';

            html += '<div style="margin-bottom:12px;">';
            html += '<label style="font-size:0.7rem;color:var(--text-dim);">Set Results:</label>';
            html += '<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">';
            match.participants.forEach(function(id) {
                var name = window.getParticipantName(id);
                var result = match.results && match.results[id];
                var isPassed = result === 'pass';
                var isFailed = result === 'fail';

                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">';
                html += '<span style="font-size:0.8rem;font-weight:500;">' + name + '</span>';
                html += '<div style="display:flex;gap:4px;">';
                html += '<button class="small ' + (isPassed ? 'primary' : 'secondary') + ' set-exam-result" data-participant="' + id + '" data-result="pass">✓ Pass</button>';
                html += '<button class="small ' + (isFailed ? 'danger' : 'secondary') + ' set-exam-result" data-participant="' + id + '" data-result="fail">✗ Fail</button>';
                if (isPassed || isFailed) {
                    html += '<button class="small secondary set-exam-result" data-participant="' + id + '" data-result="clear">Clear</button>';
                }
                html += '</div>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';

            var evaluated = 0;
            if (match.results) {
                for (var key in match.results) {
                    if (match.results[key] === 'pass' || match.results[key] === 'fail') {
                        evaluated++;
                    }
                }
            }
            var total = match.participants ? match.participants.length : 0;
            var allEvaluated = evaluated === total && total > 0;

            html += '<div style="margin-bottom:12px;padding:8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">';
            html += '<span style="font-size:0.75rem;color:var(--text-dim);">Progress: <strong>' + evaluated + '/' + total + '</strong> evaluated</span>';
            if (allEvaluated) {
                html += ' <span style="color:var(--accent);font-weight:600;">✓ All evaluated!</span>';
            }
            html += '</div>';

            html += '<div class="form-actions">';
            html += '<button type="button" id="save-exam-results" class="primary">Save Results</button>';
            html += '<button type="button" id="delete-match-btn" class="danger">Delete Exam</button>';
            html += '<button type="button" id="cancel-edit-match" class="secondary">Cancel</button>';
            html += '</div>';

            content.innerHTML = html;
            content.dataset.tournId = tournId;
            content.dataset.roundIndex = roundIndex;
            content.dataset.matchIndex = matchIndex;

            content.querySelectorAll('.set-exam-result').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var participantId = this.dataset.participant;
                    var result = this.dataset.result;

                    var t = window.getTournament(tournId);
                    if (!t) return;
                    var m = t.rounds[roundIndex].matches[matchIndex];
                    if (!m) return;

                    if (result === 'clear') {
                        m.results[participantId] = null;
                    } else {
                        m.results[participantId] = result;
                    }

                    var allDone = true;
                    for (var key in m.results) {
                        if (m.results[key] !== 'pass' && m.results[key] !== 'fail') {
                            allDone = false;
                            break;
                        }
                    }
                    if (allDone && m.participants.length > 0) {
                        m.status = 'completed';
                    } else {
                        m.status = 'pending';
                    }

                    if (typeof window.saveData === 'function') {
                        window.saveData().catch(function(err) { /* ignore */ });
                    }
                    showEditMatchModal(tournId, roundIndex, matchIndex);
                });
            });

            document.getElementById('save-exam-results').onclick = function() {
                var t = window.getTournament(tournId);
                if (!t) return;
                var m = t.rounds[roundIndex].matches[matchIndex];
                if (!m) return;

                var allDone = true;
                for (var key in m.results) {
                    if (m.results[key] !== 'pass' && m.results[key] !== 'fail') {
                        allDone = false;
                        break;
                    }
                }

                if (!allDone) {
                    if (!confirm('Not all participants have results yet. Save anyway?')) {
                        return;
                    }
                }

                m.status = allDone ? 'completed' : 'pending';
                window.checkRoundStatuses(t);

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
                modal.classList.add('hidden');
                viewTournament(tournId);
            };

        } else {
            var html = '<div style="margin-bottom:12px;">';
            html += '<p style="color:var(--text-dim);font-size:0.8rem;">For matches with more than 2 participants:</p>';
            html += '<ul style="color:var(--text-dim);font-size:0.75rem;margin:4px 0 8px 20px;padding:0;">';
            html += '<li><strong style="color:var(--accent);">1 Winner</strong> — advances to next round</li>';
            html += '<li><strong style="color:var(--danger);">1 Loser</strong> — eliminated from tournament</li>';
            html += '<li><strong style="color:var(--warning);">Remaining participants</strong> — advance to another match</li>';
            html += '</ul>';
            html += '</div>';

            html += '<div style="margin-bottom:12px;">';
            html += '<p style="color:var(--text-dim);font-size:0.8rem;">Participants:</p>';
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;">';
            match.participants.forEach(function(id) {
                var name = window.getParticipantName(id);
                var isWinner = match.winner && String(match.winner) === String(id);
                var isLoser = match.loser && String(match.loser) === String(id);
                var isAdvancing = match.status === 'completed' && !isWinner && !isLoser && match.participants.length > 2;
                var style = 'background:var(--panel-alt);padding:2px 8px;border-radius:10px;font-size:0.75rem;border:1px solid var(--border-soft);';
                if (isWinner) style += 'border-color:var(--accent);background:var(--accent-soft);';
                else if (isLoser) style += 'border-color:var(--danger);background:var(--danger-soft);';
                else if (isAdvancing) style += 'border-color:var(--warning);background:var(--warning-soft);';
                html += '<span style="' + style + '">' + name +
                    (isWinner ? ' ★ Winner' : '') +
                    (isLoser ? ' ✘ Loser' : '') +
                    (isAdvancing ? ' ↑ Advances' : '') +
                '</span>';
            });
            html += '</div>';
            html += '</div>';

            html += '<div style="margin-bottom:12px;">';
            html += '<label style="font-size:0.7rem;color:var(--text-dim);">Winner:</label>';
            html += '<select id="edit-match-winner" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;margin-left:8px;width:auto;min-width:150px;">';
            html += '<option value="">None</option>';
            match.participants.forEach(function(id) {
                var name = window.getParticipantName(id);
                var selected = match.winner && String(match.winner) === String(id) ? 'selected' : '';
                html += '<option value="' + id + '" ' + selected + '>' + name + '</option>';
            });
            html += '</select>';
            html += '</div>';

            html += '<div style="margin-bottom:12px;">';
            html += '<label style="font-size:0.7rem;color:var(--text-dim);">Loser (eliminated):</label>';
            html += '<select id="edit-match-loser" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;margin-left:8px;width:auto;min-width:150px;">';
            html += '<option value="">None</option>';
            match.participants.forEach(function(id) {
                var name = window.getParticipantName(id);
                var selected = match.loser && String(match.loser) === String(id) ? 'selected' : '';
                var isWinner = match.winner && String(match.winner) === String(id);
                var disabled = isWinner ? 'disabled' : '';
                html += '<option value="' + id + '" ' + selected + ' ' + disabled + '>' + name + (isWinner ? ' (already winner)' : '') + '</option>';
            });
            html += '</select>';
            html += '</div>';

            html += '<div class="form-actions">';
            html += '<button type="button" id="save-edit-match" class="primary">Save Match Results</button>';
            html += '<button type="button" id="delete-match-btn" class="danger">Delete Match</button>';
            html += '<button type="button" id="cancel-edit-match" class="secondary">Cancel</button>';
            html += '</div>';

            content.innerHTML = html;
            content.dataset.tournId = tournId;
            content.dataset.roundIndex = roundIndex;
            content.dataset.matchIndex = matchIndex;

            var winnerSelect = document.getElementById('edit-match-winner');
            var loserSelect = document.getElementById('edit-match-loser');

            if (winnerSelect) {
                winnerSelect.addEventListener('change', function() {
                    var winnerId = this.value;
                    if (loserSelect && winnerId) {
                        Array.from(loserSelect.options).forEach(function(opt) {
                            if (opt.value === winnerId) {
                                opt.disabled = true;
                                if (opt.selected) {
                                    opt.selected = false;
                                }
                            } else {
                                opt.disabled = false;
                            }
                        });
                    }
                });
            }

            if (loserSelect) {
                loserSelect.addEventListener('change', function() {
                    var loserId = this.value;
                    if (winnerSelect && loserId) {
                        Array.from(winnerSelect.options).forEach(function(opt) {
                            if (opt.value === loserId) {
                                opt.disabled = true;
                                if (opt.selected) {
                                    opt.selected = false;
                                }
                            } else {
                                opt.disabled = false;
                            }
                        });
                    }
                });
            }

            document.getElementById('save-edit-match').onclick = function() {
                var winnerId = document.getElementById('edit-match-winner').value;
                var loserId = document.getElementById('edit-match-loser') ? document.getElementById('edit-match-loser').value : null;
                var match = tourn.rounds[roundIndex].matches[matchIndex];

                if (winnerId && loserId && winnerId === loserId) {
                    alert('A participant cannot be both winner and loser.');
                    return;
                }

                if (match.participants.length === 2 && !winnerId) {
                    alert('For 2-person matches, you must select a winner.');
                    return;
                }

                if (winnerId) {
                    match.winner = winnerId;
                    match.status = 'completed';
                } else {
                    match.winner = null;
                    if (!loserId) {
                        match.status = 'pending';
                    }
                }

                if (loserId) {
                    match.loser = loserId;
                    if (!tourn.eliminations) tourn.eliminations = [];
                    if (!tourn.eliminations.some(function(e) { return String(e.participantId) === String(loserId); })) {
                        tourn.eliminations.push({
                            participantId: loserId,
                            week: parseInt(tourn.startWeek) || 1,
                            reason: 'Lost in Round ' + (roundIndex + 1)
                        });
                        window.markCharacterEliminated(loserId, tourn, 'Lost in Round ' + (roundIndex + 1));
                    }
                } else {
                    match.loser = null;
                }

                if (winnerId) {
                    match.status = 'completed';
                }

                var advancingParticipants = match.participants.filter(function(id) {
                    return String(id) !== String(winnerId) && String(id) !== String(loserId);
                });

                if (advancingParticipants.length > 0) {
                    match.advancing = advancingParticipants;
                }

                var allMatchesComplete = true;
                round.matches.forEach(function(m) {
                    if (m.status !== 'completed') {
                        allMatchesComplete = false;
                    }
                });

                if (allMatchesComplete) {
                    round.status = 'completed';
                } else if (winnerId) {
                    round.status = 'in_progress';
                }

                window.checkRoundStatuses(tourn);

                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
                modal.classList.add('hidden');
                viewTournament(tournId);
                if (typeof window.renderCharacterList === 'function') {
                    window.renderCharacterList();
                }
            };
        }

        var deleteBtn = document.getElementById('delete-match-btn');
        if (deleteBtn) {
            deleteBtn.onclick = function() {
                if (confirm('Delete this ' + (isGroupExam ? 'exam' : 'match') + '?')) {
                    deleteMatch(tournId, roundIndex, matchIndex);
                    modal.classList.add('hidden');
                }
            };
        }

        var cancelBtn = document.getElementById('cancel-edit-match');
        if (cancelBtn) {
            cancelBtn.onclick = function() {
                modal.classList.add('hidden');
            };
        }

        modal.classList.remove('hidden');
    }

    function getAvailableParticipants(tourn, roundNumber) {
        if (!tourn.participants) return [];

        var eliminatedIds = [];
        if (tourn.eliminations) {
            tourn.eliminations.forEach(function(e) {
                eliminatedIds.push(e.participantId);
            });
        }

        var usedInRound = [];
        if (tourn.rounds) {
            tourn.rounds.forEach(function(r) {
                if (r.roundNumber === roundNumber && r.matches) {
                    r.matches.forEach(function(m) {
                        if (m.participants) {
                            m.participants.forEach(function(id) {
                                usedInRound.push(id);
                            });
                        }
                    });
                }
            });
        }

        var available = [];
        tourn.participants.forEach(function(p) {
            var id = p.id;
            if (eliminatedIds.indexOf(id) !== -1) return;
            if (usedInRound.indexOf(id) !== -1) return;
            available.push(id);
        });

        return available;
    }

    function addParticipant() {
        var modal = document.getElementById('tournament-detail-modal');
        var tournId = modal.dataset.tournamentId;
        var tourn = window.getTournament(tournId);
        if (!tourn) {
            alert('Tournament not found.');
            return;
        }

        var select = document.getElementById('participant-select');
        var id = select.value;
        if (!id) {
            alert('Please select a participant.');
            return;
        }

        if (!tourn.participants) tourn.participants = [];
        if (tourn.participants.some(function(p) { return String(p.id) === String(id); })) {
            alert('Already added.');
            return;
        }

        var name = window.getParticipantName(id);
        tourn.participants.push({ id: id, addedAt: new Date().toISOString() });

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                viewTournament(tournId);
            }).catch(function(err) {
                alert('Failed to add participant.');
            });
        } else {
            viewTournament(tournId);
        }
    }

    function removeParticipant(tournId, participantId) {
        if (!confirm('Remove this participant from the tournament?')) return;
        var tourn = window.getTournament(tournId);
        if (!tourn) return;
        tourn.participants = tourn.participants.filter(function(p) { return String(p.id) !== String(participantId); });
        if (tourn.eliminations) {
            tourn.eliminations = tourn.eliminations.filter(function(e) { return String(e.participantId) !== String(participantId); });
        }
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        viewTournament(tournId);
    }

    function eliminateParticipant() {
        var modal = document.getElementById('tournament-detail-modal');
        var tournId = modal.dataset.tournamentId;
        var tourn = window.getTournament(tournId);
        if (!tourn) {
            alert('Tournament not found.');
            return;
        }

        var select = document.getElementById('elimination-select');
        var id = select.value;
        if (!id) {
            alert('Please select an individual to eliminate.');
            return;
        }

        if (tourn.eliminations && tourn.eliminations.some(function(e) { return String(e.participantId) === String(id); })) {
            alert('Already eliminated.');
            return;
        }

        if (!tourn.eliminations) tourn.eliminations = [];
        var week = parseInt(tourn.startWeek) || 1;
        tourn.eliminations.push({
            participantId: id,
            week: week,
            reason: 'Eliminated'
        });

        window.markCharacterEliminated(id, tourn, 'Eliminated from tournament');

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                viewTournament(tournId);
                if (typeof window.renderCharacterList === 'function') {
                    window.renderCharacterList();
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            }).catch(function(err) {
                alert('Failed to eliminate participant.');
            });
        } else {
            viewTournament(tournId);
        }
    }

    function uneliminateParticipant(tournId, participantId) {
        var tourn = window.getTournament(tournId);
        if (!tourn) return;

        tourn.eliminations = tourn.eliminations.filter(function(e) { return String(e.participantId) !== String(participantId); });

        window.unmarkCharacterEliminated(participantId, tourn);

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                viewTournament(tournId);
                if (typeof window.renderCharacterList === 'function') {
                    window.renderCharacterList();
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            }).catch(function(err) {
                alert('Failed to restore participant.');
            });
        } else {
            viewTournament(tournId);
        }
    }

    function createRound() {
        var modal = document.getElementById('tournament-detail-modal');
        var tournId = modal.dataset.tournamentId;
        var tourn = window.getTournament(tournId);
        if (!tourn) return;

        if (!tourn.rounds) tourn.rounds = [];
        if (tourn.rounds.length >= tourn.totalRounds) {
            alert('Maximum rounds reached for this tournament.');
            return;
        }

        if (!tourn.participants || tourn.participants.length < 2) {
            alert('Need at least 2 participants to create a round.');
            return;
        }

        var roundNumber = tourn.rounds.length + 1;
        var matchSize = 2;
        var matchType = 'standard';

        if (roundNumber > 1) {
            var prevRound = tourn.rounds[roundNumber - 2];
            if (prevRound && prevRound.matchSize) {
                matchSize = prevRound.matchSize;
            }
            if (prevRound && prevRound.matchType) {
                matchType = prevRound.matchType;
            }
        }

        var newRound = {
            roundNumber: roundNumber,
            status: 'pending',
            matchSize: matchSize,
            matchType: matchType,
            matches: []
        };

        if (roundNumber > 1) {
            var previousRound = tourn.rounds[roundNumber - 2];
            var advancingIds = [];

            if (previousRound.matches) {
                previousRound.matches.forEach(function(match) {
                    if (match.type === 'group_exam') {
                        if (match.results) {
                            for (var id in match.results) {
                                if (match.results[id] === 'pass' && advancingIds.indexOf(id) === -1) {
                                    advancingIds.push(id);
                                }
                            }
                        }
                    } else if (match.status === 'completed') {
                        if (match.winner) {
                            advancingIds.push(match.winner);
                        }
                        if (match.advancing) {
                            match.advancing.forEach(function(id) {
                                if (advancingIds.indexOf(id) === -1) {
                                    advancingIds.push(id);
                                }
                            });
                        }
                        if (!match.winner && !match.loser) {
                            match.participants.forEach(function(id) {
                                if (advancingIds.indexOf(id) === -1) {
                                    advancingIds.push(id);
                                }
                            });
                        }
                    } else {
                        match.participants.forEach(function(id) {
                            if (advancingIds.indexOf(id) === -1) {
                                advancingIds.push(id);
                            }
                        });
                    }
                });
            }

            advancingIds = advancingIds.filter(function(id, index, self) {
                return self.indexOf(id) === index;
            });

            if (tourn.eliminations) {
                advancingIds = advancingIds.filter(function(id) {
                    return !tourn.eliminations.some(function(e) { return String(e.participantId) === String(id); });
                });
            }

            if (advancingIds.length > 0) {
                newRound.availableParticipants = advancingIds.slice();
            }

            if ((!advancingIds || advancingIds.length < 2) && previousRound.matches && previousRound.matches.length > 0) {
                var allPreviousParticipants = [];
                previousRound.matches.forEach(function(m) {
                    if (m.participants) {
                        m.participants.forEach(function(id) {
                            if (allPreviousParticipants.indexOf(id) === -1) {
                                allPreviousParticipants.push(id);
                            }
                        });
                    }
                });

                var eliminatedCount = tourn.eliminations ? tourn.eliminations.length : 0;
                var remaining = allPreviousParticipants.length - eliminatedCount;
                if (remaining < 2) {
                    alert('Not enough participants remain for another round. ' + remaining + ' participant(s) remaining.');
                    return;
                }
            }
        }

        tourn.rounds.push(newRound);
        tourn.status = 'active';

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        viewTournament(tournId);
    }

    function deleteRound(tournId, roundIndex) {
        var tourn = window.getTournament(tournId);
        if (!tourn || !tourn.rounds) return;

        var round = tourn.rounds[roundIndex];
        var matchCount = round.matches ? round.matches.length : 0;

        if (!confirm('Delete Round ' + (roundIndex + 1) + ' with ' + matchCount + ' matches?')) return;

        tourn.rounds.splice(roundIndex, 1);

        tourn.rounds.forEach(function(r, idx) {
            r.roundNumber = idx + 1;
        });

        if (tourn.rounds.length === 0) {
            tourn.status = 'draft';
            tourn.winner = null;
        } else {
            window.checkRoundStatuses(tourn);
        }

        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted round ' + (roundIndex + 1) + ' from tournament: ' + tourn.name);
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        viewTournament(tournId);
    }

    function deleteMatch(tournId, roundIndex, matchIndex) {
        var tourn = window.getTournament(tournId);
        if (!tourn || !tourn.rounds || !tourn.rounds[roundIndex]) return;

        if (!confirm('Delete this match?')) return;

        tourn.rounds[roundIndex].matches.splice(matchIndex, 1);
        window.checkRoundStatuses(tourn);

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        viewTournament(tournId);
    }

    function showTournamentForm(editId) {
        var modal = document.getElementById('tournament-form-modal');
        var title = document.getElementById('tournament-form-title');
        var form = document.getElementById('tournament-form-inner');

        modal.classList.remove('hidden');

        if (editId) {
            title.textContent = 'Edit Tournament';
            var tourn = window.getTournament(editId);
            if (tourn) {
                document.getElementById('tournament-name').value = tourn.name || '';
                document.getElementById('tournament-mode').value = tourn.mode || 'teams';
                document.getElementById('tournament-start-week').value = tourn.startWeek || '1';
                document.getElementById('tournament-end-week').value = tourn.endWeek || '52';
                document.getElementById('tournament-rounds').value = tourn.totalRounds || '1';
                form.dataset.editId = editId;
            }
        } else {
            title.textContent = 'New Tournament';
            form.reset();
            document.getElementById('tournament-mode').value = 'teams';
            document.getElementById('tournament-start-week').value = '1';
            document.getElementById('tournament-end-week').value = '52';
            document.getElementById('tournament-rounds').value = '1';
            delete form.dataset.editId;
        }
    }

    function saveTournament(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var formData = {
            name: document.getElementById('tournament-name').value.trim(),
            mode: document.getElementById('tournament-mode').value,
            startWeek: parseInt(document.getElementById('tournament-start-week').value) || 1,
            endWeek: parseInt(document.getElementById('tournament-end-week').value) || 52,
            totalRounds: parseInt(document.getElementById('tournament-rounds').value) || 1
        };

        if (!formData.name) { alert('Tournament name is required.'); return; }
        if (formData.startWeek > formData.endWeek) {
            alert('Start week must be before end week.');
            return;
        }

        if (editId) {
            var tourn = window.updateTournament(editId, formData);
            if (tourn) {
                window.ensureTournamentArrays(tourn);
            }
            if (typeof window.logActivity === 'function') {
                window.logActivity('Updated tournament: ' + formData.name);
            }
        } else {
            var tourn = window.createTournament(formData);
            window.ensureTournamentArrays(tourn);
            if (typeof window.logActivity === 'function') {
                window.logActivity('Created tournament: ' + formData.name);
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        closeTournamentForm();
        renderTournamentList();
    }

    function closeTournamentForm() {
        document.getElementById('tournament-form-modal').classList.add('hidden');
    }

    function closeTournamentDetail() {
        document.getElementById('tournament-detail-modal').classList.add('hidden');
        tournamentState.currentTournamentId = null;
    }

    function initTournamentEvents() {
        var addBtn = document.getElementById('add-tournament-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() { showTournamentForm(); });
        }

        var closeFormBtn = document.getElementById('close-tournament-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', closeTournamentForm);
        }
        var cancelFormBtn = document.getElementById('cancel-tournament-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', closeTournamentForm);
        }

        var form = document.getElementById('tournament-form-inner');
        if (form) {
            form.addEventListener('submit', saveTournament);
        }

        var closeDetailBtn = document.getElementById('close-tournament-detail');
        if (closeDetailBtn) {
            closeDetailBtn.addEventListener('click', closeTournamentDetail);
        }
        var detailModal = document.getElementById('tournament-detail-modal');
        if (detailModal) {
            detailModal.addEventListener('click', function(e) {
                if (e.target === this) closeTournamentDetail();
            });
        }

        var addParticipantBtn = document.getElementById('add-participant-btn');
        if (addParticipantBtn) {
            addParticipantBtn.addEventListener('click', addParticipant);
        }

        var createRoundBtn = document.getElementById('create-round-btn');
        if (createRoundBtn) {
            createRoundBtn.addEventListener('click', createRound);
        }

        var eliminateBtn = document.getElementById('eliminate-btn');
        if (eliminateBtn) {
            eliminateBtn.addEventListener('click', eliminateParticipant);
        }

        var uneliminateBtn = document.getElementById('uneliminate-btn');
        if (uneliminateBtn) {
            uneliminateBtn.addEventListener('click', function() {
                var modal = document.getElementById('tournament-detail-modal');
                var tournId = modal.dataset.tournamentId;
                var tourn = window.getTournament(tournId);
                if (!tourn) return;
                var select = document.getElementById('elimination-select');
                var id = select.value;
                if (!id) { alert('Please select an individual.'); return; }
                uneliminateParticipant(tournId, id);
            });
        }

        var closeMatchEdit = document.getElementById('close-match-edit');
        if (closeMatchEdit) {
            closeMatchEdit.addEventListener('click', function() {
                document.getElementById('match-edit-modal').classList.add('hidden');
            });
        }
        var matchModal = document.getElementById('match-edit-modal');
        if (matchModal) {
            matchModal.addEventListener('click', function(e) {
                if (e.target === this) this.classList.add('hidden');
            });
        }

        var formModal = document.getElementById('tournament-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) closeTournamentForm();
            });
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('tournaments', renderTournaments);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-tournaments');
        if (container && container.style.display !== 'none') {
            renderTournaments(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'tournaments') {
            var container = document.getElementById('tab-tournaments');
            if (container) {
                renderTournaments(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-tournaments');
            if (container && container.style.display !== 'none') {
                renderTournaments(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderTournaments = renderTournaments;
    window.tournamentState = tournamentState;

    console.log('tournaments-ui.js loaded');

})();
