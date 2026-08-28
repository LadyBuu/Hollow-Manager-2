/**
 * js/modules/tournaments/tournaments-ui.js - Tournament UI Controller
 * Event wiring, modal management, user interactions.
 * 
 * UI PHILOSOPHY:
 *   - UI is the boundary between user and domain
 *   - All mutations go through TournamentsCore or TournamentsMatches
 *   - All reads go through TournamentsQueries (preferred) or TournamentsCore
 *   - All rendering goes through TournamentsRender
 *   - Persistence is owned by the UI (calls saveData after mutations)
 *   - Event handlers use delegation with CURRENT tournament resolution
 *   - Single lifecycle owner (TabManager)
 *   - UI state is private, not exposed globally
 * 
 * PERSISTENCE CONTRACT:
 *   - All mutation operations call saveData() after success
 *   - saveData() MUST exist and return a Promise that rejects on failure
 *   - The UI assumes optimistic updates (memory first, then persist)
 *   - If persistence fails, the user is notified but UI remains consistent
 *   - This is OPTIMISTIC persistence, not transactional persistence
 */

(function() {
    'use strict';

    if (window.__tournamentsUILoaded) return;

    // ============================================================
    // DEPENDENCIES - Must be loaded before this module is marked ready
    // ============================================================

    if (!window.TournamentsCore) {
        console.error('TournamentsUI: TournamentsCore required.');
        return;
    }
    if (!window.TournamentsRender) {
        console.error('TournamentsUI: TournamentsRender required.');
        return;
    }
    if (!window.TournamentsQueries) {
        console.error('TournamentsUI: TournamentsQueries required.');
        return;
    }
    if (!window.TournamentsMatches) {
        console.error('TournamentsUI: TournamentsMatches required.');
        return;
    }
    if (typeof window.saveData !== 'function') {
        console.error('TournamentsUI: saveData() is required for persistence.');
        return;
    }

    // Mark as loaded ONLY after all dependencies are confirmed
    window.__tournamentsUILoaded = true;

    var Core = window.TournamentsCore;
    var Render = window.TournamentsRender;
    var Queries = window.TournamentsQueries;
    var Matches = window.TournamentsMatches;

    // ============================================================
    // PRIVATE STATE
    // ============================================================

    var state = {
        currentTournamentId: null
    };

    // ============================================================
    // NOTIFICATION SYSTEM (Private)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (typeof window._showNotification === 'function') {
            window._showNotification(message, type);
            return;
        }
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        if (typeof window.notify === 'function') {
            window.notify(message, type);
            return;
        }

        console.log('[' + type + ']', message);
    }

    function showConfirmation(message) {
        if (typeof window.showConfirm === 'function') {
            return window.showConfirm(message);
        }
        if (typeof window.confirmModal === 'function') {
            return window.confirmModal(message);
        }
        return confirm(message);
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    /**
     * Perform a tournament operation and persist the result.
     * All mutation methods MUST return truthy values on success.
     * saveData() is guaranteed to exist (checked at module load).
     * 
     * This is OPTIMISTIC persistence: memory mutation happens immediately,
     * persistence happens asynchronously. If persistence fails, the user
     * is notified but the UI remains consistent with the in-memory state.
     */
    function persistOperation(operationName, operation, onSuccess, onError) {
        try {
            var result = operation();

            if (!result) {
                console.warn('TournamentsUI: ' + operationName + ' failed.');
                return false;
            }

            // Persist asynchronously - don't block UI
            Promise.resolve()
                .then(function() {
                    return window.saveData();
                })
                .catch(function(err) {
                    console.error('TournamentsUI: Failed to persist ' + operationName + ':', err);
                    showNotification(
                        'Changes were made but could not be saved to storage.',
                        'error'
                    );
                    if (typeof onError === 'function') {
                        onError(err);
                    }
                });

            if (typeof onSuccess === 'function') {
                onSuccess();
            }

            return true;
        } catch (err) {
            console.error('TournamentsUI: ' + operationName + ' threw an error:', err);
            showNotification('Operation failed: ' + err.message, 'error');
            return false;
        }
    }

    // ============================================================
    // ID NORMALISATION
    // ============================================================

    function normaliseId(id) {
        return id !== undefined && id !== null ? String(id) : null;
    }

    // ============================================================
    // POPULATE SELECTORS
    // ============================================================

    function populateParticipantSelect(select, tournament) {
        if (!select || !tournament) return;

        var mode = tournament.mode;
        var data = window.data || {};
        var options = [];

        if (mode === 'teams') {
            var teams = Array.isArray(data.teams) ? data.teams : [];
            teams.forEach(function(team) {
                if (!team || typeof team !== 'object') return;
                if (!team.id) return;
                if (team.status === 'deleted') return;
                var id = normaliseId(team.id);
                if (id === null) return;
                var isInTournament = Array.isArray(tournament.participants) &&
                    tournament.participants.some(function(p) {
                        return p && normaliseId(p.id) === id;
                    });
                if (isInTournament) return;
                options.push({
                    id: id,
                    name: team.name || 'Unknown Team',
                    type: 'team'
                });
            });
        } else {
            var chars = Array.isArray(data.characters) ? data.characters : [];
            chars.forEach(function(char) {
                if (!char || typeof char !== 'object') return;
                if (!char.id) return;
                if (char.deceased) return;
                var id = normaliseId(char.id);
                if (id === null) return;
                var isInTournament = Array.isArray(tournament.participants) &&
                    tournament.participants.some(function(p) {
                        return p && normaliseId(p.id) === id;
                    });
                if (isInTournament) return;
                var name = typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(char)
                    : char.name || 'Unknown';
                options.push({
                    id: id,
                    name: name,
                    type: 'character'
                });
            });
        }

        options.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        var currentValue = select.value;
        select.innerHTML = '<option value="">Add participant...</option>';
        options.forEach(function(opt) {
            var option = document.createElement('option');
            option.value = opt.id;
            option.textContent = opt.name + ' (' + opt.type + ')';
            option.dataset.type = opt.type;
            select.appendChild(option);
        });

        if (currentValue) {
            var exists = Array.from(select.options).some(function(opt) {
                return opt.value === currentValue;
            });
            if (exists) select.value = currentValue;
        }
    }

    function getAvailableParticipants(tournament) {
        if (!Array.isArray(tournament.participants)) return [];
        var eliminated = Array.isArray(tournament.eliminations) ?
            tournament.eliminations.map(function(e) {
                return e && e.participantId !== undefined ? normaliseId(e.participantId) : null;
            }).filter(Boolean) : [];
        return tournament.participants.filter(function(p) {
            if (!p) return false;
            var id = normaliseId(p.id);
            return id !== null && eliminated.indexOf(id) === -1;
        });
    }

    // ============================================================
    // MODAL SETUP
    // ============================================================

    function setupModalOutsideClick(modalId, closeFn) {
        var modal = document.getElementById(modalId);
        if (!modal) return;
        if (modal._outsideListener) return;
        modal._outsideListener = true;

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeFn();
            }
        });
    }

    // ============================================================
    // DETAIL EVENTS
    // ============================================================

    function attachDetailEvents(modal) {
        var content = modal.querySelector('#tournament-detail-content');
        if (!content) return;

        if (content._detailEventsAttached) return;
        content._detailEventsAttached = true;

        // Populate participant select when rendered
        var select = content.querySelector('.participant-select');
        if (select) {
            var tournamentId = modal.dataset.tournamentId;
            var tournament = Core.getTournament(tournamentId);
            if (tournament) {
                populateParticipantSelect(select, tournament);
            }
        }

        // Event delegation - resolve tournament from modal dataset each time
        content.addEventListener('click', function(e) {
            var tournamentId = modal.dataset.tournamentId;
            if (!tournamentId) return;

            var tournament = Core.getTournament(tournamentId);
            if (!tournament) return;

            var target = e.target;

            // Add participant
            var addBtn = target.closest('.add-participant-btn');
            if (addBtn) {
                var select = content.querySelector('.participant-select');
                if (!select) return;
                var id = select.value;
                if (!id) {
                    showNotification('Select a participant.', 'warning');
                    return;
                }
                var selectedOption = select.options[select.selectedIndex];
                var type = selectedOption ? selectedOption.dataset.type || 'character' : 'character';

                var success = persistOperation('addParticipant', function() {
                    return Core.addParticipant(tournament.id, { id: id, type: type });
                }, function() {
                    viewTournament(tournament.id);
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                });

                if (!success) {
                    showNotification('Failed to add participant.', 'error');
                }
                return;
            }

            // Remove participant
            var removeBtn = target.closest('.remove-participant-btn');
            if (removeBtn) {
                var participantId = removeBtn.dataset.id;
                if (!participantId) return;
                if (showConfirmation('Remove this participant from the tournament?')) {
                    var success = persistOperation('removeParticipant', function() {
                        return Core.removeParticipant(tournament.id, participantId);
                    }, function() {
                        viewTournament(tournament.id);
                        if (typeof window.updateDashboardStats === 'function') {
                            window.updateDashboardStats();
                        }
                    });
                    if (!success) {
                        showNotification('Failed to remove participant.', 'error');
                    }
                }
                return;
            }

            // Create round
            var createBtn = target.closest('.create-round-btn');
            if (createBtn) {
                var success = persistOperation('addRound', function() {
                    return Core.addRound(tournament.id, {});
                }, function() {
                    viewTournament(tournament.id);
                });
                if (!success) {
                    showNotification('Failed to create round.', 'error');
                }
                return;
            }

            // Match item - click to edit
            var matchItem = target.closest('.match-item');
            if (matchItem) {
                var roundIndex = parseInt(matchItem.dataset.round);
                var matchIndex = parseInt(matchItem.dataset.match);
                if (!isNaN(roundIndex) && !isNaN(matchIndex) && matchIndex >= 0) {
                    showEditMatchModal(tournament.id, roundIndex, matchIndex);
                }
                return;
            }

            // Add match
            var addMatchBtn = target.closest('.add-match-btn');
            if (addMatchBtn) {
                var roundIndex = parseInt(addMatchBtn.dataset.round);
                if (!isNaN(roundIndex)) {
                    showAddMatchModal(tournament.id, roundIndex);
                }
                return;
            }

            // Delete round
            var deleteRoundBtn = target.closest('.delete-round-btn');
            if (deleteRoundBtn) {
                var roundIndex = parseInt(deleteRoundBtn.dataset.round);
                if (isNaN(roundIndex)) return;
                if (showConfirmation('Delete this round? Matches will be preserved in historical records.')) {
                    var success = persistOperation('removeRound', function() {
                        return Core.removeRound(tournament.id, roundIndex);
                    }, function() {
                        viewTournament(tournament.id);
                    });
                    if (!success) {
                        showNotification('Failed to delete round.', 'error');
                    }
                }
                return;
            }

            // Uneliminate
            var unelimBtn = target.closest('.uneliminate-btn');
            if (unelimBtn) {
                var participantId = unelimBtn.dataset.id;
                if (!participantId) return;
                if (showConfirmation('Restore this participant?')) {
                    var success = persistOperation('unmarkEliminated', function() {
                        return Core.unmarkCharacterEliminated(tournament.id, participantId);
                    }, function() {
                        viewTournament(tournament.id);
                    });
                    if (!success) {
                        showNotification('Failed to restore participant.', 'error');
                    }
                }
                return;
            }

            // View round status
            var statusBtn = target.closest('.view-round-status-btn');
            if (statusBtn) {
                var roundIndex = parseInt(statusBtn.dataset.round);
                if (!isNaN(roundIndex)) {
                    showRoundStatus(tournament.id, roundIndex);
                }
                return;
            }

            // Edit round
            var editRoundBtn = target.closest('.edit-round-btn');
            if (editRoundBtn) {
                var roundIndex = parseInt(editRoundBtn.dataset.round);
                if (!isNaN(roundIndex)) {
                    showEditRoundModal(tournament.id, roundIndex);
                }
                return;
            }

            // Edit match
            var editMatchBtn = target.closest('.edit-match-btn');
            if (editMatchBtn) {
                var roundIndex = parseInt(editMatchBtn.dataset.round);
                var matchIndex = parseInt(editMatchBtn.dataset.match);
                if (!isNaN(roundIndex) && !isNaN(matchIndex) && matchIndex >= 0) {
                    showEditMatchModal(tournament.id, roundIndex, matchIndex);
                }
                return;
            }
        });
    }

    // ============================================================
    // LIST EVENTS
    // ============================================================

    function attachListEvents(container) {
        if (container._listEventsAttached) return;
        container._listEventsAttached = true;

        container.addEventListener('click', function(e) {
            var target = e.target;

            var viewBtn = target.closest('.view-tournament');
            if (viewBtn) {
                e.preventDefault();
                viewTournament(viewBtn.dataset.id);
                return;
            }

            var editBtn = target.closest('.edit-tournament');
            if (editBtn) {
                e.preventDefault();
                showTournamentForm(editBtn.dataset.id);
                return;
            }

            var deleteBtn = target.closest('.delete-tournament');
            if (deleteBtn) {
                e.preventDefault();
                var id = deleteBtn.dataset.id;
                var tournament = Core.getTournament(id);
                if (!tournament) return;
                if (showConfirmation('Delete tournament "' + tournament.name + '" permanently?')) {
                    var success = persistOperation('deleteTournament', function() {
                        return Core.deleteTournament(id);
                    }, function() {
                        renderTournamentList(document.getElementById('tab-tournaments'));
                        closeTournamentDetail();
                        if (typeof window.updateDashboardStats === 'function') {
                            window.updateDashboardStats();
                        }
                    });
                    if (!success) {
                        showNotification('Failed to delete tournament.', 'error');
                    }
                }
                return;
            }
        });

        var addBtn = document.getElementById('add-tournament-btn');
        if (addBtn && !addBtn._listener) {
            addBtn._listener = true;
            addBtn.addEventListener('click', function() {
                showTournamentForm();
            });
        }
    }

    // ============================================================
    // RENDER FUNCTIONS
    // ============================================================

    function renderTournaments(container) {
        if (!container) {
            container = document.getElementById('tab-tournaments');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading tournament data...</p>';
            return;
        }

        container.innerHTML = getTournamentsHTML();
        renderTournamentList(container);
    }

    function getTournamentsHTML() {
        return `
            <div class="page-header">
                <h2>Tournaments</h2>
                <button id="add-tournament-btn" class="primary">+ New Tournament</button>
            </div>
            <div id="tournament-list">
                <div id="tournaments-container">
                    <p class="empty-state">No tournaments created yet.</p>
                </div>
            </div>
            ${getModalsHTML()}
        `;
    }

    function getModalsHTML() {
        return `
            <div id="tournament-form-modal" class="modal hidden">
                <div class="modal-content modal-form-content">
                    <div class="modal-header">
                        <h3 id="tournament-form-title">Create Tournament</h3>
                        <button class="close-modal" id="close-tournament-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="tournament-form-content"></div>
                    </div>
                </div>
            </div>

            <div id="tournament-detail-modal" class="modal hidden">
                <div class="modal-content modal-detail-content">
                    <div class="modal-header">
                        <h3 id="detail-tournament-name">Tournament</h3>
                        <button class="close-modal" id="close-tournament-detail">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="tournament-detail-content"></div>
                    </div>
                </div>
            </div>

            <div id="match-edit-modal" class="modal hidden">
                <div class="modal-content modal-match-content">
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

    function renderTournamentList(container) {
        var listContainer = container ? container.querySelector('#tournaments-container') : document.getElementById('tournaments-container');
        if (!listContainer) return;

        var tournaments = Queries.getTournaments ? Queries.getTournaments() : Core.getTournaments();
        var html = Render.renderList(tournaments);
        listContainer.innerHTML = html;

        attachListEvents(listContainer);
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    function viewTournament(id) {
        var tournament = Core.getTournament(id);
        if (!tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        state.currentTournamentId = id;

        var modal = document.getElementById('tournament-detail-modal');
        if (!modal) return;

        var title = document.getElementById('detail-tournament-name');
        if (title) title.textContent = tournament.name;

        var content = document.getElementById('tournament-detail-content');
        if (!content) return;

        var html = Render.renderDetail(tournament);
        content.innerHTML = html;

        modal.dataset.tournamentId = id;
        modal.classList.remove('hidden');

        setupModalOutsideClick('tournament-detail-modal', closeTournamentDetail);

        attachDetailEvents(modal);

        var select = content.querySelector('.participant-select');
        if (select) {
            populateParticipantSelect(select, tournament);
        }
    }

    function closeTournamentDetail() {
        var modal = document.getElementById('tournament-detail-modal');
        if (modal) modal.classList.add('hidden');
        state.currentTournamentId = null;
    }

    // ============================================================
    // FORM FUNCTIONS
    // ============================================================

    function showTournamentForm(editId) {
        var modal = document.getElementById('tournament-form-modal');
        var title = document.getElementById('tournament-form-title');
        var content = document.getElementById('tournament-form-content');

        if (!modal || !title || !content) return;

        var tournament = editId ? Core.getTournament(editId) : null;

        if (editId && !tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        title.textContent = tournament ? 'Edit Tournament' : 'Create Tournament';

        var html = Render.renderForm(tournament, Core.VALID_MODES, Core.VALID_STATUSES);
        content.innerHTML = html;

        modal.dataset.editId = editId || '';
        modal.classList.remove('hidden');

        setupModalOutsideClick('tournament-form-modal', closeTournamentForm);

        attachFormEvents(modal, tournament);
    }

    function attachFormEvents(modal, tournament) {
        var form = modal.querySelector('#tournament-form');
        if (!form) return;

        var newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        newForm.addEventListener('submit', function(e) {
            e.preventDefault();

            var editId = modal.dataset.editId;

            var data = {
                name: this.querySelector('#tourn-name').value.trim(),
                mode: this.querySelector('#tourn-mode').value,
                startWeek: parseInt(this.querySelector('#tourn-start-week').value),
                endWeek: parseInt(this.querySelector('#tourn-end-week').value),
                totalRounds: parseInt(this.querySelector('#tourn-total-rounds').value),
                status: this.querySelector('#tourn-status').value
            };

            if (!data.name) {
                showNotification('Tournament name is required.', 'warning');
                return;
            }

            var success;
            if (editId) {
                success = persistOperation('updateTournament', function() {
                    return Core.updateTournament(editId, data);
                }, function() {
                    closeTournamentForm();
                    renderTournamentList(document.getElementById('tab-tournaments'));
                    if (state.currentTournamentId === editId) {
                        viewTournament(editId);
                    }
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                });
            } else {
                success = persistOperation('createTournament', function() {
                    return Core.createTournament(data);
                }, function() {
                    closeTournamentForm();
                    renderTournamentList(document.getElementById('tab-tournaments'));
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                });
            }

            if (!success) {
                showNotification('Failed to save tournament.', 'error');
            }
        });

        var cancelBtn = newForm.querySelector('.cancel-form-btn');
        if (cancelBtn) {
            var newCancel = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            newCancel.addEventListener('click', closeTournamentForm);
        }

        var closeBtn = document.getElementById('close-tournament-form');
        if (closeBtn) {
            var newClose = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newClose, closeBtn);
            newClose.addEventListener('click', closeTournamentForm);
        }
    }

    function closeTournamentForm() {
        var modal = document.getElementById('tournament-form-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // MATCH FUNCTIONS
    // ============================================================

    function showAddMatchModal(tournamentId, roundIndex) {
        var tournament = Core.getTournament(tournamentId);
        if (!tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        var round = tournament.rounds && tournament.rounds[roundIndex];
        if (!round) {
            showNotification('Round not found.', 'error');
            return;
        }

        var modal = document.getElementById('match-edit-modal');
        var title = document.getElementById('match-edit-title');
        var content = document.getElementById('match-edit-content');

        if (!modal || !title || !content) return;

        title.textContent = 'Add Match - Round ' + (round.roundNumber || roundIndex + 1);

        var available = getAvailableParticipants(tournament);

        var html = Render.renderMatchForm(tournament, roundIndex, -1, available);
        content.innerHTML = html;

        modal.dataset.tournamentId = tournamentId;
        modal.dataset.roundIndex = roundIndex;
        modal.dataset.matchIndex = -1;
        modal.classList.remove('hidden');

        setupModalOutsideClick('match-edit-modal', closeMatchEditModal);

        attachMatchFormEvents(modal, tournament, roundIndex, -1);
    }

    function showEditMatchModal(tournamentId, roundIndex, matchIndex) {
        var tournament = Core.getTournament(tournamentId);
        if (!tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        var match = Queries.getMatch(tournament, roundIndex, matchIndex);
        if (!match) {
            showNotification('Match not found.', 'error');
            return;
        }

        var modal = document.getElementById('match-edit-modal');
        var title = document.getElementById('match-edit-title');
        var content = document.getElementById('match-edit-content');

        if (!modal || !title || !content) return;

        var round = tournament.rounds && tournament.rounds[roundIndex];
        title.textContent = 'Edit Match - Round ' + (round ? round.roundNumber || roundIndex + 1 : roundIndex + 1);

        var available = getAvailableParticipants(tournament);

        var html = Render.renderMatchForm(tournament, roundIndex, matchIndex, available);
        content.innerHTML = html;

        modal.dataset.tournamentId = tournamentId;
        modal.dataset.roundIndex = roundIndex;
        modal.dataset.matchIndex = matchIndex;
        modal.classList.remove('hidden');

        setupModalOutsideClick('match-edit-modal', closeMatchEditModal);

        attachMatchFormEvents(modal, tournament, roundIndex, matchIndex);
    }

    function attachMatchFormEvents(modal, tournament, roundIndex, matchIndex) {
        var form = modal.querySelector('#match-form');
        if (!form) return;

        var isEdit = matchIndex >= 0;

        var newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        // Initialise winner selector
        updateWinnerSelect(newForm, tournament, roundIndex);

        newForm.addEventListener('submit', function(e) {
            e.preventDefault();

            if (!window.TournamentsMatches) {
                showNotification('Match management is not available.', 'error');
                return;
            }

            // Gather form data
            var typeSelect = this.querySelector('#match-type');
            var type = typeSelect ? typeSelect.value : 'standard';

            // Gather participants
            var participantSelects = this.querySelectorAll('.match-participant-select');
            var participantIds = [];
            participantSelects.forEach(function(sel) {
                if (sel.value) {
                    participantIds.push(sel.value);
                }
            });

            var hiddenInputs = this.querySelectorAll('input[name^="participant_"]');
            hiddenInputs.forEach(function(input) {
                if (input.value && participantIds.indexOf(input.value) === -1) {
                    participantIds.push(input.value);
                }
            });

            var round = tournament.rounds && tournament.rounds[roundIndex];
            var requiredSize = round && round.matchSize ? round.matchSize : 2;

            if (participantIds.length !== requiredSize) {
                showNotification(
                    'This match requires exactly ' + requiredSize + ' participants.',
                    'warning'
                );
                return;
            }

            // Gather results for group exam
            var results = {};
            var resultSelects = this.querySelectorAll('.exam-result-select');
            resultSelects.forEach(function(sel) {
                if (sel.value) {
                    results[sel.dataset.id] = sel.value;
                }
            });

            // Gather winner for standard matches
            var winnerSelect = this.querySelector('#match-winner');
            var winner = winnerSelect && winnerSelect.value ? winnerSelect.value : null;

            var matchData = {
                participants: participantIds,
                type: type,
                status: 'pending'
            };

            if (winner && type === 'standard') {
                matchData.winner = winner;
            }

            if (type === 'group_exam' && Object.keys(results).length > 0) {
                matchData.results = results;
            }

            // Preserve existing status for editing
            if (isEdit) {
                var currentMatch = Queries.getMatch(tournament, roundIndex, matchIndex);
                if (currentMatch && currentMatch.status !== 'pending') {
                    matchData.status = currentMatch.status;
                }
            }

            var success;
            if (isEdit) {
                success = persistOperation('updateMatch', function() {
                    return Matches.updateMatch(tournament.id, roundIndex, matchIndex, matchData);
                }, function() {
                    closeMatchEditModal();
                    viewTournament(tournament.id);
                });
            } else {
                success = persistOperation('addMatch', function() {
                    return Matches.addMatch(tournament.id, roundIndex, matchData);
                }, function() {
                    closeMatchEditModal();
                    viewTournament(tournament.id);
                });
            }

            if (!success) {
                showNotification('Failed to save match.', 'error');
            }
        });

        var cancelBtn = newForm.querySelector('.cancel-match-form-btn');
        if (cancelBtn) {
            var newCancel = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            newCancel.addEventListener('click', closeMatchEditModal);
        }

        var closeBtn = document.getElementById('close-match-edit');
        if (closeBtn) {
            var newClose = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newClose, closeBtn);
            newClose.addEventListener('click', closeMatchEditModal);
        }

        // Update winner selector when participants change
        var participantSelects2 = newForm.querySelectorAll('.match-participant-select');
        participantSelects2.forEach(function(sel) {
            sel.addEventListener('change', function() {
                updateWinnerSelect(newForm, tournament, roundIndex);
            });
        });
    }

    function updateWinnerSelect(form, tournament, roundIndex) {
        var winnerSelect = form.querySelector('#match-winner');
        if (!winnerSelect) return;

        var participantSelects = form.querySelectorAll('.match-participant-select');
        var participants = [];
        participantSelects.forEach(function(sel) {
            if (sel.value) {
                participants.push(sel.value);
            }
        });

        var hiddenInputs = form.querySelectorAll('input[name^="participant_"]');
        hiddenInputs.forEach(function(input) {
            if (input.value && participants.indexOf(input.value) === -1) {
                participants.push(input.value);
            }
        });

        var currentValue = winnerSelect.value;
        winnerSelect.innerHTML = '<option value="">Select winner...</option>';

        participants.forEach(function(id) {
            var name = Queries.getTournamentParticipantName
                ? Queries.getTournamentParticipantName(tournament, id)
                : Queries.getParticipantName(id);
            var option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            winnerSelect.appendChild(option);
        });

        if (currentValue) {
            var exists = Array.from(winnerSelect.options).some(function(opt) {
                return opt.value === currentValue;
            });
            if (exists) winnerSelect.value = currentValue;
        }

        // Show/hide winner selection
        var winnerContainer = form.querySelector('#winner-selection');
        if (winnerContainer) {
            winnerContainer.style.display = participants.length >= 2 ? 'block' : 'none';
        }
    }

    function closeMatchEditModal() {
        var modal = document.getElementById('match-edit-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // ROUND STATUS
    // ============================================================

    function showRoundStatus(tournamentId, roundIndex) {
        var tournament = Core.getTournament(tournamentId);
        if (!tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        var round = tournament.rounds && tournament.rounds[roundIndex];
        if (!round) {
            showNotification('Round not found.', 'error');
            return;
        }

        var statuses = Queries.getRoundStatusSummary(tournament, roundIndex);
        var participants = Queries.getRoundParticipants(tournament, roundIndex);

        var message = 'Round ' + (round.roundNumber || roundIndex + 1) + ' Status:\n\n';
        message += 'Status: ' + Queries.getRoundStatus(tournament, roundIndex) + '\n';
        message += 'Matches: ' + (Array.isArray(round.matches) ? round.matches.length : 0) + '\n';
        message += 'Participants: ' + participants.length + '\n\n';

        participants.forEach(function(id) {
            var status = statuses[id] || 'unknown';
            var name = Queries.getTournamentParticipantName
                ? Queries.getTournamentParticipantName(tournament, id)
                : Queries.getParticipantName(id);
            message += '  ' + name + ': ' + status + '\n';
        });

        showNotification(message, 'info');
    }

    function showEditRoundModal(tournamentId, roundIndex) {
        showNotification('Round editing is under development.', 'info');
    }

    // ============================================================
    // LIFECYCLE MANAGEMENT
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('tournaments', renderTournaments);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderTournaments = renderTournaments;
    window.viewTournament = viewTournament;
    window.closeTournamentDetail = closeTournamentDetail;

})();
