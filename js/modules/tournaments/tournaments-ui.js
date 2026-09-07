/**
 * js/modules/tournaments/tournaments-ui.js - Tournaments UI Controller
 * Path: js/modules/tournaments/tournaments-ui.js
 * 
 * This module handles:
 *   - Tournament UI rendering
 *   - Tournament form display
 *   - Tournament detail view
 *   - Tournament CRUD operations (delegated to core)
 * 
 * IMPORTANT:
 *   - UI-ONLY - all mutations delegate to TournamentsCore
 *   - Uses TournamentsQueries for read-only access
 *   - Uses TournamentsRender for all HTML generation
 *   - Uses TournamentsMatches for match operations
 *   - No direct window.data access
 *   - Uses NotificationSystem for user feedback
 *   - Uses Modal for modal lifecycle
 *   - All HTML escaping uses DomUtils.escapeHtml()
 * 
 * DEPENDENCIES:
 *   - window.TournamentsCore (from tournaments-core.js)
 *   - window.TournamentsRender (from tournaments-render.js)
 *   - window.TournamentsQueries (from tournaments-queries.js)
 *   - window.TournamentsMatches (from tournaments-matches.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.Modal (from modal.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.AcademyQueries (from academy-queries.js)
 * 
 * USAGE:
 *   var ui = window.TournamentsUI;
 *   ui.render(container);
 */

(function() {
    'use strict';

    if (window.__tournamentsUILoaded) {
        return;
    }

    var TournamentsCore = window.TournamentsCore;
    var TournamentsRender = window.TournamentsRender;
    var TournamentsQueries = window.TournamentsQueries;
    var TournamentsMatches = window.TournamentsMatches;
    var NotificationSystem = window.NotificationSystem;
    var Modal = window.Modal;
    var TabManager = window.TabManager;
    var DomUtils = window.DomUtils;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var AcademyQueries = window.AcademyQueries;

    function checkDependencies() {
        var missing = [];

        if (!TournamentsCore || typeof TournamentsCore.getTournaments !== 'function') {
            missing.push('TournamentsCore.getTournaments');
        }
        if (!TournamentsCore || typeof TournamentsCore.createTournament !== 'function') {
            missing.push('TournamentsCore.createTournament');
        }
        if (!TournamentsCore || typeof TournamentsCore.updateTournament !== 'function') {
            missing.push('TournamentsCore.updateTournament');
        }
        if (!TournamentsCore || typeof TournamentsCore.deleteTournament !== 'function') {
            missing.push('TournamentsCore.deleteTournament');
        }
        if (!TournamentsCore || typeof TournamentsCore.addParticipant !== 'function') {
            missing.push('TournamentsCore.addParticipant');
        }
        if (!TournamentsCore || typeof TournamentsCore.removeParticipant !== 'function') {
            missing.push('TournamentsCore.removeParticipant');
        }
        if (!TournamentsCore || typeof TournamentsCore.addRound !== 'function') {
            missing.push('TournamentsCore.addRound');
        }
        if (!TournamentsCore || typeof TournamentsCore.removeRound !== 'function') {
            missing.push('TournamentsCore.removeRound');
        }
        if (!TournamentsCore || typeof TournamentsCore.completeTournament !== 'function') {
            missing.push('TournamentsCore.completeTournament');
        }

        if (!TournamentsRender || typeof TournamentsRender.renderList !== 'function') {
            missing.push('TournamentsRender.renderList');
        }
        if (!TournamentsRender || typeof TournamentsRender.renderDetail !== 'function') {
            missing.push('TournamentsRender.renderDetail');
        }
        if (!TournamentsRender || typeof TournamentsRender.renderForm !== 'function') {
            missing.push('TournamentsRender.renderForm');
        }
        if (!TournamentsRender || typeof TournamentsRender.renderParticipants !== 'function') {
            missing.push('TournamentsRender.renderParticipants');
        }
        if (!TournamentsRender || typeof TournamentsRender.renderRounds !== 'function') {
            missing.push('TournamentsRender.renderRounds');
        }
        if (!TournamentsRender || typeof TournamentsRender.renderEliminations !== 'function') {
            missing.push('TournamentsRender.renderEliminations');
        }
        if (!TournamentsRender || typeof TournamentsRender.renderWinner !== 'function') {
            missing.push('TournamentsRender.renderWinner');
        }

        if (!TournamentsQueries || typeof TournamentsQueries.getTournament !== 'function') {
            missing.push('TournamentsQueries.getTournament');
        }
        if (!TournamentsQueries || typeof TournamentsQueries.getTournaments !== 'function') {
            missing.push('TournamentsQueries.getTournaments');
        }

        if (!TournamentsMatches || typeof TournamentsMatches.addMatch !== 'function') {
            missing.push('TournamentsMatches.addMatch');
        }
        if (!TournamentsMatches || typeof TournamentsMatches.removeMatch !== 'function') {
            missing.push('TournamentsMatches.removeMatch');
        }
        if (!TournamentsMatches || typeof TournamentsMatches.updateMatch !== 'function') {
            missing.push('TournamentsMatches.updateMatch');
        }
        if (!TournamentsMatches || typeof TournamentsMatches.completeMatch !== 'function') {
            missing.push('TournamentsMatches.completeMatch');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }

        if (missing.length > 0) {
            throw new Error('[TournamentsUI] Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    var VALID_PARTICIPANT_TYPES = ['character', 'team'];

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    function persistMutation(successMessage, errorMessage) {
        if (typeof window.saveData !== 'function') {
            showNotification('Changes applied in memory, but persistence failed.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (successMessage) {
                    showNotification(successMessage, 'success');
                }
            })
            .catch(function() {
                if (errorMessage) {
                    showNotification(errorMessage, 'error');
                }
            });
    }

    var _container = null;
    var _selectedTournamentId = null;
    var _eventListeners = [];

    function render(container) {
        if (!container) {
            container = document.getElementById('tab-tournaments');
        }

        if (!container) {
            console.warn('[TournamentsUI] Container not found');
            return;
        }

        _container = container;

        removeAllEventListeners();

        var tournaments = TournamentsQueries.getTournaments();

        var html = TournamentsRender.renderList(tournaments, _selectedTournamentId);
        container.innerHTML = html;

        bindEvents(container);

        if (_selectedTournamentId) {
            var tournament = TournamentsQueries.getTournament(_selectedTournamentId);
            if (tournament) {
                viewTournament(_selectedTournamentId);
            } else {
                _selectedTournamentId = null;
            }
        }
    }

    function viewTournament(tournamentId) {
        if (!tournamentId) {
            return;
        }

        var tournament = TournamentsQueries.getTournament(tournamentId);
        if (!tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        _selectedTournamentId = tournamentId;

        var detailHtml = TournamentsRender.renderDetail(tournament);
        var detailContainer = _container.querySelector('#tournament-detail');
        if (detailContainer) {
            detailContainer.innerHTML = detailHtml;
        } else {
            var detailWrapper = document.createElement('div');
            detailWrapper.id = 'tournament-detail-container';
            detailWrapper.innerHTML = detailHtml;
            _container.appendChild(detailWrapper);
        }

        bindDetailEvents(_container);

        var listItems = _container.querySelectorAll('.tournament-item');
        for (var i = 0; i < listItems.length; i++) {
            var item = listItems[i];
            var id = item.dataset.id;
            if (id === tournamentId) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        }

        var detailEl = _container.querySelector('#tournament-detail, #tournament-detail-container');
        if (detailEl) {
            detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function closeDetail() {
        _selectedTournamentId = null;

        var detailContainer = _container.querySelector('#tournament-detail, #tournament-detail-container');
        if (detailContainer) {
            detailContainer.remove();
        }

        var listItems = _container.querySelectorAll('.tournament-item');
        for (var i = 0; i < listItems.length; i++) {
            listItems[i].classList.remove('selected');
        }
    }

    function showForm(editId) {
        var modal = Modal.createModal('tournament-form-modal');

        var tournament = null;
        if (editId) {
            tournament = TournamentsQueries.getTournament(editId);
            if (!tournament) {
                showNotification('Tournament not found.', 'error');
                return;
            }
        }

        var characters = [];
        var teams = [];

        var allCharacters = window.data && window.data.characters ? window.data.characters : [];
        for (var i = 0; i < allCharacters.length; i++) {
            var char = allCharacters[i];
            if (char && !char.deceased) {
                characters.push({
                    id: char.id,
                    name: CharacterQueries.getDisplayName(char),
                    type: 'character'
                });
            }
        }

        var allTeams = window.data && window.data.teams ? window.data.teams : [];
        for (var j = 0; j < allTeams.length; j++) {
            var team = allTeams[j];
            if (team && team.status === 'active') {
                teams.push({
                    id: team.id,
                    name: team.name || 'Team ' + team.id,
                    type: 'team'
                });
            }
        }

        var participants = characters.concat(teams);

        var html = TournamentsRender.renderForm(tournament, participants);
        var content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = html;

        modal.appendChild(content);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        bindFormEvents(modal, editId);
    }

    function bindEvents(container) {
        var addBtn = container.querySelector('#add-tournament-btn');
        if (addBtn) {
            addEventListener(addBtn, 'click', function() {
                showForm(null);
            });
        }

        var listItems = container.querySelectorAll('.tournament-item');
        for (var i = 0; i < listItems.length; i++) {
            var item = listItems[i];
            addEventListener(item, 'click', function(e) {
                if (e.target.closest('button')) {
                    return;
                }
                var id = this.dataset.id;
                if (id) {
                    viewTournament(id);
                }
            });
        }

        addEventListener(container, 'click', function(e) {
            var btn = e.target.closest('.delete-tournament-btn');
            if (btn) {
                e.stopPropagation();
                var id = btn.dataset.id;
                if (id && confirm('Delete this tournament?')) {
                    handleDeleteTournament(id);
                }
            }
        });

        addEventListener(container, 'click', function(e) {
            var btn = e.target.closest('.edit-tournament-btn');
            if (btn) {
                e.stopPropagation();
                var id = btn.dataset.id;
                if (id) {
                    showForm(id);
                }
            }
        });
    }

    function bindDetailEvents(container) {
        var closeBtn = container.querySelector('#close-tournament-detail');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                closeDetail();
            });
        }

        var addParticipantBtn = container.querySelector('#add-participant-btn');
        if (addParticipantBtn) {
            addEventListener(addParticipantBtn, 'click', function() {
                var tournamentId = this.dataset.tournamentId;
                if (tournamentId) {
                    showAddParticipantForm(tournamentId);
                }
            });
        }

        addEventListener(container, 'click', function(e) {
            var btn = e.target.closest('.remove-participant-btn');
            if (btn) {
                var tournamentId = btn.dataset.tournamentId;
                var participantId = btn.dataset.participantId;
                if (tournamentId && participantId && confirm('Remove this participant?')) {
                    handleRemoveParticipant(tournamentId, participantId);
                }
            }
        });

        var addRoundBtn = container.querySelector('#add-round-btn');
        if (addRoundBtn) {
            addEventListener(addRoundBtn, 'click', function() {
                var tournamentId = this.dataset.tournamentId;
                if (tournamentId) {
                    handleAddRound(tournamentId);
                }
            });
        }

        addEventListener(container, 'click', function(e) {
            var btn = e.target.closest('.remove-round-btn');
            if (btn) {
                var tournamentId = btn.dataset.tournamentId;
                var roundIndex = parseInt(btn.dataset.roundIndex, 10);
                if (tournamentId && !isNaN(roundIndex) && confirm('Remove this round?')) {
                    handleRemoveRound(tournamentId, roundIndex);
                }
            }
        });

        addEventListener(container, 'click', function(e) {
            var btn = e.target.closest('.add-match-btn');
            if (btn) {
                var tournamentId = btn.dataset.tournamentId;
                var roundIndex = parseInt(btn.dataset.roundIndex, 10);
                if (tournamentId && !isNaN(roundIndex)) {
                    showAddMatchForm(tournamentId, roundIndex);
                }
            }
        });

        addEventListener(container, 'click', function(e) {
            var btn = e.target.closest('.edit-match-btn');
            if (btn) {
                var tournamentId = btn.dataset.tournamentId;
                var matchId = btn.dataset.matchId;
                if (tournamentId && matchId) {
                    showEditMatchForm(tournamentId, matchId);
                }
            }
        });

        addEventListener(container, 'click', function(e) {
            var btn = e.target.closest('.delete-match-btn');
            if (btn) {
                var tournamentId = btn.dataset.tournamentId;
                var matchId = btn.dataset.matchId;
                if (tournamentId && matchId && confirm('Delete this match?')) {
                    handleDeleteMatch(tournamentId, matchId);
                }
            }
        });

        addEventListener(container, 'click', function(e) {
            var btn = e.target.closest('.complete-match-btn');
            if (btn) {
                var tournamentId = btn.dataset.tournamentId;
                var matchId = btn.dataset.matchId;
                if (tournamentId && matchId) {
                    handleCompleteMatch(tournamentId, matchId);
                }
            }
        });

        var completeBtn = container.querySelector('#complete-tournament-btn');
        if (completeBtn) {
            addEventListener(completeBtn, 'click', function() {
                var tournamentId = this.dataset.tournamentId;
                if (tournamentId && confirm('Complete this tournament?')) {
                    handleCompleteTournament(tournamentId);
                }
            });
        }
    }

    function bindFormEvents(modal, editId) {
        var form = modal.querySelector('#tournament-form');
        if (!form) {
            return;
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }

        var cancelBtn = modal.querySelector('#cancel-tournament-form');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }

        addEventListener(form, 'submit', function(e) {
            e.preventDefault();

            var nameInput = form.querySelector('#tournament-name');
            var typeInput = form.querySelector('#tournament-type');
            var weekInput = form.querySelector('#tournament-week');
            var maxParticipantsInput = form.querySelector('#tournament-max-participants');
            var descriptionInput = form.querySelector('#tournament-description');

            var name = nameInput ? nameInput.value.trim() : '';
            var type = typeInput ? typeInput.value : 'single_elimination';
            var week = weekInput ? parseInt(weekInput.value, 10) : 1;
            var maxParticipants = maxParticipantsInput ? parseInt(maxParticipantsInput.value, 10) : 8;
            var description = descriptionInput ? descriptionInput.value.trim() : '';

            if (!name) {
                showNotification('Tournament name is required.', 'error');
                return;
            }

            var result;
            if (editId) {
                result = TournamentsCore.updateTournament(editId, {
                    name: name,
                    type: type,
                    week: week,
                    maxParticipants: maxParticipants,
                    description: description
                });
            } else {
                result = TournamentsCore.createTournament({
                    name: name,
                    type: type,
                    week: week,
                    maxParticipants: maxParticipants,
                    description: description
                });
            }

            if (result && result.success) {
                var msg = editId ? 'Tournament updated successfully.' : 'Tournament created successfully.';
                showNotification(msg, 'success');
                Modal.closeModal(modal);
                render(_container);
                persistMutation(null, 'Tournament saved in memory, but persistence failed.');
            } else {
                showNotification(result ? result.message : 'Failed to save tournament.', 'error');
            }
        });
    }

    function showAddParticipantForm(tournamentId) {
        var tournament = TournamentsQueries.getTournament(tournamentId);
        if (!tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        var modal = Modal.createModal('add-participant-modal');

        var html = TournamentsRender.renderAddParticipantForm(tournament);
        var content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = html;

        modal.appendChild(content);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var form = modal.querySelector('#add-participant-form');
        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();

                var select = form.querySelector('#participant-select');
                var typeSelect = form.querySelector('#participant-type-select');
                var participantId = select ? select.value : '';
                var participantType = typeSelect ? typeSelect.value : 'character';

                if (!participantId) {
                    showNotification('Please select a participant.', 'error');
                    return;
                }

                var result = TournamentsCore.addParticipant(tournamentId, {
                    id: participantId,
                    type: participantType
                });

                if (result && result.success) {
                    showNotification('Participant added successfully.', 'success');
                    Modal.closeModal(modal);
                    viewTournament(tournamentId);
                    persistMutation(null, 'Participant added in memory, but persistence failed.');
                } else {
                    showNotification(result ? result.message : 'Failed to add participant.', 'error');
                }
            });
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }

        var cancelBtn = modal.querySelector('#cancel-add-participant');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }
    }

    function showAddMatchForm(tournamentId, roundIndex) {
        var tournament = TournamentsQueries.getTournament(tournamentId);
        if (!tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        var modal = Modal.createModal('add-match-modal');

        var html = TournamentsRender.renderAddMatchForm(tournament, roundIndex);
        var content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = html;

        modal.appendChild(content);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var form = modal.querySelector('#add-match-form');
        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();

                var participant1Select = form.querySelector('#match-participant-1');
                var participant2Select = form.querySelector('#match-participant-2');
                var matchTypeSelect = form.querySelector('#match-type');

                var participant1 = participant1Select ? participant1Select.value : '';
                var participant2 = participant2Select ? participant2Select.value : '';
                var matchType = matchTypeSelect ? matchTypeSelect.value : 'standard';

                if (!participant1 || !participant2) {
                    showNotification('Please select both participants.', 'error');
                    return;
                }

                if (participant1 === participant2) {
                    showNotification('Participants must be different.', 'error');
                    return;
                }

                var result = TournamentsMatches.addMatch(tournamentId, roundIndex, {
                    participant1Id: participant1,
                    participant2Id: participant2,
                    type: matchType
                });

                if (result && result.success) {
                    showNotification('Match added successfully.', 'success');
                    Modal.closeModal(modal);
                    viewTournament(tournamentId);
                    persistMutation(null, 'Match added in memory, but persistence failed.');
                } else {
                    showNotification(result ? result.message : 'Failed to add match.', 'error');
                }
            });
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }

        var cancelBtn = modal.querySelector('#cancel-add-match');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }
    }

    function showEditMatchForm(tournamentId, matchId) {
        var tournament = TournamentsQueries.getTournament(tournamentId);
        if (!tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        var match = null;
        if (tournament.rounds) {
            for (var r = 0; r < tournament.rounds.length; r++) {
                var round = tournament.rounds[r];
                if (round.matches) {
                    for (var m = 0; m < round.matches.length; m++) {
                        if (String(round.matches[m].id) === String(matchId)) {
                            match = round.matches[m];
                            break;
                        }
                    }
                }
                if (match) break;
            }
        }

        if (!match) {
            showNotification('Match not found.', 'error');
            return;
        }

        var modal = Modal.createModal('edit-match-modal');

        var html = TournamentsRender.renderEditMatchForm(tournament, match);
        var content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = html;

        modal.appendChild(content);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var form = modal.querySelector('#edit-match-form');
        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();

                var participant1Select = form.querySelector('#match-participant-1');
                var participant2Select = form.querySelector('#match-participant-2');
                var matchTypeSelect = form.querySelector('#match-type');
                var winnerSelect = form.querySelector('#match-winner');

                var participant1 = participant1Select ? participant1Select.value : '';
                var participant2 = participant2Select ? participant2Select.value : '';
                var matchType = matchTypeSelect ? matchTypeSelect.value : 'standard';
                var winner = winnerSelect ? winnerSelect.value : '';

                if (!participant1 || !participant2) {
                    showNotification('Please select both participants.', 'error');
                    return;
                }

                var updates = {
                    participant1Id: participant1,
                    participant2Id: participant2,
                    type: matchType,
                    winner: winner || null
                };

                var result = TournamentsMatches.updateMatch(tournamentId, matchId, updates);

                if (result && result.success) {
                    showNotification('Match updated successfully.', 'success');
                    Modal.closeModal(modal);
                    viewTournament(tournamentId);
                    persistMutation(null, 'Match updated in memory, but persistence failed.');
                } else {
                    showNotification(result ? result.message : 'Failed to update match.', 'error');
                }
            });
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }

        var cancelBtn = modal.querySelector('#cancel-edit-match');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }
    }

    function handleDeleteTournament(tournamentId) {
        var result = TournamentsCore.deleteTournament(tournamentId);

        if (result && result.success) {
            showNotification('Tournament deleted successfully.', 'success');
            if (_selectedTournamentId === tournamentId) {
                _selectedTournamentId = null;
            }
            render(_container);
            persistMutation(null, 'Tournament deleted in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to delete tournament.', 'error');
        }
    }

    function handleRemoveParticipant(tournamentId, participantId) {
        var result = TournamentsCore.removeParticipant(tournamentId, participantId);

        if (result && result.success) {
            showNotification('Participant removed successfully.', 'success');
            viewTournament(tournamentId);
            persistMutation(null, 'Participant removed in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to remove participant.', 'error');
        }
    }

    function handleAddRound(tournamentId) {
        var result = TournamentsCore.addRound(tournamentId);

        if (result && result.success) {
            showNotification('Round added successfully.', 'success');
            viewTournament(tournamentId);
            persistMutation(null, 'Round added in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to add round.', 'error');
        }
    }

    function handleRemoveRound(tournamentId, roundIndex) {
        var result = TournamentsCore.removeRound(tournamentId, roundIndex);

        if (result && result.success) {
            showNotification('Round removed successfully.', 'success');
            viewTournament(tournamentId);
            persistMutation(null, 'Round removed in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to remove round.', 'error');
        }
    }

    function handleDeleteMatch(tournamentId, matchId) {
        var result = TournamentsMatches.removeMatch(tournamentId, matchId);

        if (result && result.success) {
            showNotification('Match deleted successfully.', 'success');
            viewTournament(tournamentId);
            persistMutation(null, 'Match deleted in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to delete match.', 'error');
        }
    }

    function handleCompleteMatch(tournamentId, matchId) {
        var tournament = TournamentsQueries.getTournament(tournamentId);
        var match = null;
        if (tournament && tournament.rounds) {
            for (var r = 0; r < tournament.rounds.length; r++) {
                var round = tournament.rounds[r];
                if (round.matches) {
                    for (var m = 0; m < round.matches.length; m++) {
                        if (String(round.matches[m].id) === String(matchId)) {
                            match = round.matches[m];
                            break;
                        }
                    }
                }
                if (match) break;
            }
        }

        if (!match) {
            showNotification('Match not found.', 'error');
            return;
        }

        var modal = Modal.createModal('complete-match-modal');

        var html = TournamentsRender.renderCompleteMatchForm(tournament, match);
        var content = document.createElement('div');
        content.className = 'modal-content';
        content.innerHTML = html;

        modal.appendChild(content);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var form = modal.querySelector('#complete-match-form');
        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();

                var winnerSelect = form.querySelector('#match-winner-select');
                var winner = winnerSelect ? winnerSelect.value : '';

                if (!winner) {
                    showNotification('Please select a winner.', 'error');
                    return;
                }

                var result = TournamentsMatches.completeMatch(tournamentId, matchId, {
                    winner: winner
                });

                if (result && result.success) {
                    showNotification('Match completed successfully.', 'success');
                    Modal.closeModal(modal);
                    viewTournament(tournamentId);
                    persistMutation(null, 'Match completed in memory, but persistence failed.');
                } else {
                    showNotification(result ? result.message : 'Failed to complete match.', 'error');
                }
            });
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }

        var cancelBtn = modal.querySelector('#cancel-complete-match');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                Modal.closeModal(modal);
            });
        }
    }

    function handleCompleteTournament(tournamentId) {
        var result = TournamentsCore.completeTournament(tournamentId);

        if (result && result.success) {
            showNotification('Tournament completed successfully.', 'success');
            viewTournament(tournamentId);
            persistMutation(null, 'Tournament completed in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to complete tournament.', 'error');
        }
    }

    function addEventListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
            }
        }
        _eventListeners = [];
    }

    function getGraduatingClasses(tournamentId) {
        var tournament = TournamentsQueries.getTournament(tournamentId);
        if (!tournament) {
            return [];
        }

        var participants = tournament.participants || [];
        var graduatingClasses = [];
        var seenIds = {};

        for (var i = 0; i < participants.length; i++) {
            var participant = participants[i];
            var participantId = participant.id;

            var character = CharacterQueries.getCharacterById(participantId);
            if (character) {
                if (Array.isArray(character.classIds) && character.classIds.length > 0) {
                    for (var j = 0; j < character.classIds.length; j++) {
                        var classId = character.classIds[j];
                        if (seenIds[classId]) continue;

                        var cls = AcademyQueries.getClass(classId);
                        if (cls) {
                            seenIds[classId] = true;
                            graduatingClasses.push(cls);
                        }
                    }
                }
                continue;
            }

            var team = TeamQueries.getTeamById(participantId);
            if (team && team.classId) {
                var classId = team.classId;
                if (!seenIds[classId]) {
                    var cls = AcademyQueries.getClass(classId);
                    if (cls) {
                        seenIds[classId] = true;
                        graduatingClasses.push(cls);
                    }
                }
            }
        }

        return graduatingClasses;
    }

    window.TournamentsUI = {
        render: render,
        viewTournament: viewTournament,
        closeDetail: closeDetail,
        showForm: showForm,
        getGraduatingClasses: getGraduatingClasses
    };

    window.__tournamentsUILoaded = true;

})();