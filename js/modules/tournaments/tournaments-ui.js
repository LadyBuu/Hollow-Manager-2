/**
 * js/modules/tournaments/tournaments-ui.js - Tournament UI Controller
 * Event wiring, modal management, user interactions.
 * Delegates data operations to TournamentsCore.
 * Delegates rendering to TournamentsRender.
 * Path: js/modules/tournaments/tournaments-ui.js
 */

(function() {
    'use strict';

    if (window.__tournamentsUILoaded) return;
    window.__tournamentsUILoaded = true;

    if (!window.TournamentsCore) {
        console.error('TournamentsUI: TournamentsCore required.');
        return;
    }

    if (!window.TournamentsRender) {
        console.error('TournamentsUI: TournamentsRender required.');
        return;
    }

    var state = {
        currentTournamentId: null,
        expandedMatch: null,
        editingMatch: null
    };

    function renderTournaments(container) {
        if (!container) container = document.getElementById('tab-tournaments');
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading tournament data...</p>';
            return;
        }

        container.innerHTML = getTournamentsHTML();
        renderTournamentList();
        initTournamentEvents(container);
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
            <!-- Modals: tournament-form-modal, tournament-detail-modal, match-edit-modal -->
            ${getModalsHTML()}
        `;
    }

    function renderTournamentList() {
        var container = document.getElementById('tournaments-container');
        if (!container) return;

        var tournaments = window.TournamentsCore.getTournaments();
        var html = window.TournamentsRender.renderList(tournaments, state.currentTournamentId);
        container.innerHTML = html;

        // Attach event listeners
        container.querySelectorAll('.view-tournament').forEach(function(btn) {
            btn.addEventListener('click', function() { viewTournament(this.dataset.id); });
        });
        container.querySelectorAll('.edit-tournament').forEach(function(btn) {
            btn.addEventListener('click', function() { showTournamentForm(this.dataset.id); });
        });
        container.querySelectorAll('.delete-tournament').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (window.TournamentsCore.deleteTournament(this.dataset.id)) {
                    renderTournamentList();
                    closeTournamentDetail();
                }
            });
        });
    }

    function viewTournament(id) {
        var tournament = window.TournamentsCore.getTournament(id);
        if (!tournament) return;

        state.currentTournamentId = id;

        var modal = document.getElementById('tournament-detail-modal');
        document.getElementById('detail-tournament-name').textContent = tournament.name;

        var content = document.getElementById('tournament-detail-content');
        var html = window.TournamentsRender.renderDetail(tournament);
        content.innerHTML = html;

        modal.dataset.tournamentId = id;
        modal.classList.remove('hidden');

        // Wire up detail-specific events
        wireDetailEvents(tournament);
    }

    function wireDetailEvents(tournament) {
        // Add participant
        var addBtn = document.getElementById('add-participant-btn');
        if (addBtn) {
            addBtn.onclick = function() {
                var select = document.getElementById('participant-select');
                var id = select.value;
                if (!id) { alert('Select a participant.'); return; }

                var result = window.TournamentsCore.addParticipant(tournament.id, { id: id, type: 'character' });
                if (result) {
                    viewTournament(tournament.id);
                    // Caller must save
                    if (typeof window.saveData === 'function') {
                        window.saveData().catch(function(err) {
                            console.error('Failed to save participant addition:', err);
                        });
                    }
                } else {
                    alert('Failed to add participant.');
                }
            };
        }

        // Create round
        var createBtn = document.getElementById('create-round-btn');
        if (createBtn) {
            createBtn.onclick = function() {
                var result = window.TournamentsCore.addRound(tournament.id, {});
                if (result) {
                    viewTournament(tournament.id);
                    if (typeof window.saveData === 'function') {
                        window.saveData().catch(function(err) {
                            console.error('Failed to save round creation:', err);
                        });
                    }
                }
            };
        }

        // Remove participant (delegated)
        document.querySelectorAll('.remove-participant').forEach(function(btn) {
            btn.onclick = function() {
                var participantId = this.dataset.id;
                if (participantId && confirm('Remove this participant?')) {
                    var result = window.TournamentsCore.removeParticipant(tournament.id, participantId);
                    if (result) {
                        viewTournament(tournament.id);
                        if (typeof window.saveData === 'function') {
                            window.saveData().catch(function(err) {
                                console.error('Failed to save participant removal:', err);
                            });
                        }
                    }
                }
            };
        });

        // Match items (delegated)
        document.querySelectorAll('.match-item').forEach(function(el) {
            el.onclick = function() {
                var roundIndex = parseInt(this.dataset.round);
                var matchIndex = parseInt(this.dataset.match);
                showEditMatchModal(tournament.id, roundIndex, matchIndex);
            };
        });

        // Add match
        document.querySelectorAll('.add-match-btn').forEach(function(btn) {
            btn.onclick = function() {
                var roundIndex = parseInt(this.dataset.round);
                showAddMatchModal(tournament.id, roundIndex);
            };
        });
    }

    // ============================================================
    // MODAL HELPERS (simplified - full implementation omitted for brevity)
    // ============================================================

    function showTournamentForm(editId) { /* ... */ }
    function closeTournamentForm() { /* ... */ }
    function closeTournamentDetail() { /* ... */ }
    function showEditMatchModal(tournamentId, roundIndex, matchIndex) { /* ... */ }
    function showAddMatchModal(tournamentId, roundIndex) { /* ... */ }
    function getModalsHTML() { /* ... */ }
    function initTournamentEvents(container) { /* ... */ }

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
            if (container) renderTournaments(container);
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

    window.renderTournaments = renderTournaments;

})();
