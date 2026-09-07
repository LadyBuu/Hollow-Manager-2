/**
 * js/modules/tournaments/tournaments-ui.js - Tournament UI Controller
 * Event wiring, modal management, user interactions.
 * 
 * UI PHILOSOPHY:
 *   - UI is the boundary between user and domain
 *   - All mutations go through TournamentsCore or TournamentsMatches
 *   - All reads go through TournamentsQueries
 *   - All rendering goes through TournamentsRender
 *   - Persistence is owned by MutationUtils (not the UI)
 *   - Event handlers use delegation with CURRENT tournament resolution
 *   - Single lifecycle owner (TabManager)
 *   - UI state is private, not exposed globally
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT call saveData()
 *   - This module does NOT own persistence
 *   - MutationUtils owns persistence and activity logging
 *   - The UI assumes optimistic updates (memory first, then persist)
 * 
 * DEPENDENCIES:
 *   - window.TournamentsCore - REQUIRED
 *   - window.TournamentsRender - REQUIRED
 *   - window.TournamentsQueries - REQUIRED
 *   - window.TournamentsMatches - REQUIRED
 *   - window.NotificationSystem - REQUIRED
 *   - window.Modal - REQUIRED
 *   - window.TabManager - REQUIRED
 *   - window.ClassesQueries - REQUIRED
 * 
 * LOAD ORDER:
 *   - tournaments-schema.js (FIRST)
 *   - tournament-lifecycle.js
 *   - tournaments-core.js
 *   - tournaments-queries.js
 *   - tournaments-matches.js
 *   - tournaments-render.js
 *   - tournaments-ui.js (LAST)
 */

(function() {
    'use strict';

    // Guard: Check dependencies BEFORE marking as loaded
    if (window.__tournamentsUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.TournamentsCore) {
        missing.push('TournamentsCore');
    }

    if (!window.TournamentsRender) {
        missing.push('TournamentsRender');
    }

    if (!window.TournamentsQueries) {
        missing.push('TournamentsQueries');
    }

    if (!window.TournamentsMatches) {
        missing.push('TournamentsMatches');
    }

    if (!window.NotificationSystem || typeof window.NotificationSystem.notify !== 'function') {
        missing.push('NotificationSystem.notify');
    }

    if (!window.Modal || typeof window.Modal.showModal !== 'function') {
        missing.push('Modal.showModal');
    }

    if (!window.TabManager || typeof window.TabManager.register !== 'function') {
        missing.push('TabManager.register');
    }

    if (!window.ClassesQueries || typeof window.ClassesQueries.getGraduatingClasses !== 'function') {
        missing.push('ClassesQueries.getGraduatingClasses');
    }

    if (missing.length > 0) {
        throw new Error('[TournamentsUI] Missing dependencies: ' + missing.join(', '));
    }

    window.__tournamentsUILoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Core = window.TournamentsCore;
    var Render = window.TournamentsRender;
    var Queries = window.TournamentsQueries;
    var Matches = window.TournamentsMatches;
    var NotificationSystem = window.NotificationSystem;
    var Modal = window.Modal;
    var TabManager = window.TabManager;
    var ClassesQueries = window.ClassesQueries;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = Core.Schema.MIN_WEEK;
    var MAX_WEEK = Core.Schema.MAX_WEEK;
    var VALID_MODES = Core.VALID_MODES;
    var VALID_STATUSES = Core.VALID_STATUSES;

    // ============================================================
    // PRIVATE STATE
    // ============================================================

    var state = {
        currentTournamentId: null,
        modalListeners: []
    };

    // ============================================================
    // NOTIFICATION SYSTEM
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // CONFIRMATION
    // ============================================================

    function showConfirmation(message) {
        return Modal.confirm(message);
    }

    // ============================================================
    // POPULATE SELECTORS
    // ============================================================

    function populateClassSelect(select) {
        if (!select) {
            return;
        }

        var classes = ClassesQueries.getGraduatingClasses() || [];
        var currentValue = select.value;

        select.innerHTML = '<option value="">None</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') {
                continue;
            }
            if (!cls.id) {
                continue;
            }
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name || 'Unnamed Class';
            if (String(cls.id) === String(currentValue)) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    }

    function populateParticipantSelect(select, tournament) {
        if (!select || !tournament) {
            return;
        }

        var options = Queries.getAvailableParticipantOptions(tournament);
        var currentValue = select.value;

        select.innerHTML = '<option value="">Add participant...</option>';

        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var option = document.createElement('option');
            option.value = opt.id;
            option.textContent = opt.name + ' (' + opt.type + ')';
            option.dataset.type = opt.type;
            select.appendChild(option);
        }

        if (currentValue) {
            var exists = Array.from(select.options).some(function(o) {
                return o.value === currentValue;
            });
            if (exists) {
                select.value = currentValue;
            }
        }
    }

    function getAvailableParticipants(tournament) {
        return Queries.getAvailableParticipantOptions(tournament);
    }

    // ============================================================
    // MODAL SETUP
    // ============================================================

    function setupModal(modalId, onClose) {
        var modal = document.getElementById(modalId);
        if (!modal) {
            return;
        }

        // Use Modal utility
        Modal.setupModal(modal, onClose);
    }

    function closeModal(modalId) {
        var modal = document.getElementById(modalId);
        if (modal) {
            Modal.closeModal(modal);
        }
    }

    // ============================================================
    // DETAIL EVENTS
    // ============================================================

    function attachDetailEvents(modal) {
        var content = modal.querySelector('#tournament-detail-content');
        if (!content) {
            return;
        }

        if (content._detailEventsAttached) {
            return;
        }
        content._detailEventsAttached = true;

        content.addEventListener('click', function(e) {
            var tournamentId = modal.dataset.tournamentId;
            if (!tournamentId) {
                return;
            }

            var tournament = Core.getTournament(tournamentId);
            if (!tournament) {
                return;
            }

            var target = e.target;

            // Edit match button - check FIRST (most specific)
            var editMatchBtn = target.closest('.edit-match-btn');
            if (editMatchBtn) {
                var roundIndex = parseInt(editMatchBtn.dataset.round, 10);
                var matchIndex = parseInt(editMatchBtn.dataset.match, 10);
                if (!isNaN(roundIndex) && !isNaN(matchIndex) && matchIndex >= 0 && roundIndex >= 0) {
                    showEditMatchModal(tournament.id, roundIndex, matchIndex);
                }
                return;
            }

            // Match item - click to view/edit
            var matchItem = target.closest('.match-item');
            if (matchItem) {
                var roundIndex = parseInt(matchItem.dataset.round, 10);
                var matchIndex = parseInt(matchItem.dataset.match, 10);
                if (!isNaN(roundIndex) && !isNaN(matchIndex) && matchIndex >= 0 && roundIndex >= 0) {
                    showEditMatchModal(tournament.id, roundIndex, matchIndex);
                }
                return;
            }

            // Add participant
            var addBtn = target.closest('.add-participant-btn');
            if (addBtn) {
                var select = content.querySelector('.participant-select');
                if (!select) {
                    return;
                }
                var id = select.value;
                if (!id) {
                    showNotification('Select a participant.', 'warning');
                    return;
                }
                var selectedOption = select.options[select.selectedIndex];
                var type = selectedOption ? selectedOption.dataset.type || 'character' : 'character';

                var success = Core.addParticipant(tournament.id, { id: id, type: type });
                if (success) {
                    viewTournament(tournament.id);
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                } else {
                    showNotification('Failed to add participant.', 'error');
                }
                return;
            }

            // Remove participant
            var removeBtn = target.closest('.remove-participant-btn');
            if (removeBtn) {
                var participantId = removeBtn.dataset.id;
                if (!participantId) {
                    return;
                }
                showConfirmation('Remove this participant from the tournament?')
                    .then(function(confirmed) {
                        if (confirmed) {
                            var success = Core.removeParticipant(tournament.id, participantId);
                            if (success) {
                                viewTournament(tournament.id);
                                if (typeof window.updateDashboardStats === 'function') {
                                    window.updateDashboardStats();
                                }
                            } else {
                                showNotification('Failed to remove participant.', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        // Ignore errors from confirmation
                    });
                return;
            }

            // Create round
            var createBtn = target.closest('.create-round-btn');
            if (createBtn) {
                var success = Core.addRound(tournament.id, {});
                if (success) {
                    viewTournament(tournament.id);
                } else {
                    showNotification('Failed to create round.', 'error');
                }
                return;
            }

            // Add match
            var addMatchBtn = target.closest('.add-match-btn');
            if (addMatchBtn) {
                var roundIndex = parseInt(addMatchBtn.dataset.round, 10);
                if (!isNaN(roundIndex) && roundIndex >= 0) {
                    showAddMatchModal(tournament.id, roundIndex);
                }
                return;
            }

            // Delete round
            var deleteRoundBtn = target.closest('.delete-round-btn');
            if (deleteRoundBtn) {
                var roundIndex = parseInt(deleteRoundBtn.dataset.round, 10);
                if (isNaN(roundIndex) || roundIndex < 0) {
                    return;
                }
                showConfirmation('Delete this round? This will permanently remove the round and its matches from the tournament.')
                    .then(function(confirmed) {
                        if (confirmed) {
                            var success = Core.removeRound(tournament.id, roundIndex);
                            if (success) {
                                viewTournament(tournament.id);
                            } else {
                                showNotification('Failed to delete round.', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        // Ignore errors from confirmation
                    });
                return;
            }

            // Uneliminate
            var unelimBtn = target.closest('.uneliminate-btn');
            if (unelimBtn) {
                var participantId = unelimBtn.dataset.id;
                if (!participantId) {
                    return;
                }
                showConfirmation('Restore this participant?')
                    .then(function(confirmed) {
                        if (confirmed) {
                            var workflow = window.TournamentEliminationWorkflow;
                            if (!workflow) {
                                showNotification('Elimination management is not available.', 'error');
                                return;
                            }
                            var result = workflow.unmarkCharacterEliminated(tournament.id, participantId);
                            if (result.success) {
                                viewTournament(tournament.id);
                            } else {
                                showNotification(result.message || 'Failed to restore participant.', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        // Ignore errors from confirmation
                    });
                return;
            }

            // View round status
            var statusBtn = target.closest('.view-round-status-btn');
            if (statusBtn) {
                var roundIndex = parseInt(statusBtn.dataset.round, 10);
                if (!isNaN(roundIndex) && roundIndex >= 0) {
                    showRoundStatus(tournament.id, roundIndex);
                }
                return;
            }

            // Edit round
            var editRoundBtn = target.closest('.edit-round-btn');
            if (editRoundBtn) {
                var roundIndex = parseInt(editRoundBtn.dataset.round, 10);
                if (!isNaN(roundIndex) && roundIndex >= 0) {
                    showEditRoundModal(tournament.id, roundIndex);
                }
                return;
            }
        });
    }

    // ============================================================
    // LIST EVENTS
    // ============================================================

    function attachListEvents(container) {
        if (container._listEventsAttached) {
            return;
        }
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
                if (!tournament) {
                    return;
                }
                showConfirmation('Delete tournament "' + tournament.name + '" permanently?')
                    .then(function(confirmed) {
                        if (confirmed) {
                            var success = Core.deleteTournament(id);
                            if (success) {
                                renderTournamentList(document.getElementById('tab-tournaments'));
                                closeTournamentDetail();
                                if (typeof window.updateDashboardStats === 'function') {
                                    window.updateDashboardStats();
                                }
                            } else {
                                showNotification('Failed to delete tournament.', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        // Ignore errors from confirmation
                    });
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
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading tournament data...</p>';
            return;
        }

        container.innerHTML = getTournamentsHTML();
        renderTournamentList(container);
    }

    function getTournamentsHTML() {
        return '' +
            '<div class="page-header">' +
            '<h2>Tournaments</h2>' +
            '<button id="add-tournament-btn" class="primary">+ New Tournament</button>' +
            '</div>' +
            '<div id="tournament-list">' +
            '<div id="tournaments-container">' +
            '<p class="empty-state">No tournaments created yet.</p>' +
            '</div>' +
            '</div>' +
            getModalsHTML();
    }

    function getModalsHTML() {
        return '' +
            '<div id="tournament-form-modal" class="modal hidden">' +
            '<div class="modal-content modal-form-content">' +
            '<div class="modal-header">' +
            '<h3 id="tournament-form-title">Create Tournament</h3>' +
            '<button class="close-modal" id="close-tournament-form">&times;</button>' +
            '</div>' +
            '<div class="modal-body">' +
            '<div id="tournament-form-content"></div>' +
            '</div>' +
            '</div>' +
            '</div>' +

            '<div id="tournament-detail-modal" class="modal hidden">' +
            '<div class="modal-content modal-detail-content">' +
            '<div class="modal-header">' +
            '<h3 id="detail-tournament-name">Tournament</h3>' +
            '<button class="close-modal" id="close-tournament-detail">&times;</button>' +
            '</div>' +
            '<div class="modal-body">' +
            '<div id="tournament-detail-content"></div>' +
            '</div>' +
            '</div>' +
            '</div>' +

            '<div id="match-edit-modal" class="modal hidden">' +
            '<div class="modal-content modal-match-content">' +
            '<div class="modal-header">' +
            '<h3 id="match-edit-title">Edit Match</h3>' +
            '<button class="close-modal" id="close-match-edit">&times;</button>' +
            '</div>' +
            '<div class="modal-body">' +
            '<div id="match-edit-content"></div>' +
            '</div>' +
            '</div>' +
            '</div>';
    }

    function renderTournamentList(container) {
        var listContainer = container ?
            container.querySelector('#tournaments-container') :
            document.getElementById('tournaments-container');
        if (!listContainer) {
            return;
        }

        var tournaments = Queries.getTournaments();
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
        if (!modal) {
            return;
        }

        var title = document.getElementById('detail-tournament-name');
        if (title) {
            title.textContent = tournament.name;
        }

        var content = document.getElementById('tournament-detail-content');
        if (!content) {
            return;
        }

        var html = Render.renderDetail(tournament);
        content.innerHTML = html;

        modal.dataset.tournamentId = id;
        Modal.showModal(modal);

        setupModal('tournament-detail-modal', closeTournamentDetail);

        attachDetailEvents(modal);

        // Populate participant select
        var select = content.querySelector('.participant-select');
        if (select) {
            populateParticipantSelect(select, tournament);
        }

        // Update class filter on any class selects
        var classSelects = content.querySelectorAll('#tourn-class');
        for (var i = 0; i < classSelects.length; i++) {
            populateClassSelect(classSelects[i]);
        }
    }

    function closeTournamentDetail() {
        var modal = document.getElementById('tournament-detail-modal');
        if (modal) {
            Modal.closeModal(modal);
            var content = document.getElementById('tournament-detail-content');
            if (content) {
                content.innerHTML = '';
            }
        }
        state.currentTournamentId = null;
    }

    // ============================================================
    // FORM FUNCTIONS
    // ============================================================

    function showTournamentForm(editId) {
        var modal = document.getElementById('tournament-form-modal');
        var title = document.getElementById('tournament-form-title');
        var content = document.getElementById('tournament-form-content');

        if (!modal || !title || !content) {
            return;
        }

        var tournament = editId ? Core.getTournament(editId) : null;

        if (editId && !tournament) {
            showNotification('Tournament not found.', 'error');
            return;
        }

        title.textContent = tournament ? 'Edit Tournament' : 'Create Tournament';

        var html = Render.renderForm(
            tournament,
            VALID_MODES,
            VALID_STATUSES
        );
        content.innerHTML = html;

        // Populate class select
        var classSelect = content.querySelector('#tourn-class');
        if (classSelect) {
            populateClassSelect(classSelect);
            if (tournament && tournament.graduatingClassId) {
                classSelect.value = tournament.graduatingClassId;
            } else if (tournament && tournament.graduatingClassId === null) {
                classSelect.value = '';
            }
        }

        // Set class filter checkbox
        var filterCheckbox = content.querySelector('#tourn-class-filter-enabled');
        if (filterCheckbox && tournament) {
            filterCheckbox.checked = tournament.classFilterEnabled !== false;
        }

        modal.dataset.editId = editId || '';
        Modal.showModal(modal);

        setupModal('tournament-form-modal', closeTournamentForm);

        attachFormEvents(modal, tournament);
    }

    function attachFormEvents(modal, tournament) {
        var form = modal.querySelector('#tournament-form');
        if (!form) {
            return;
        }

        var newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        newForm.addEventListener('submit', function(e) {
            e.preventDefault();

            var editId = modal.dataset.editId;

            var data = {
                name: this.querySelector('#tourn-name').value.trim(),
                mode: this.querySelector('#tourn-mode').value,
                startWeek: parseInt(this.querySelector('#tourn-start-week').value, 10) || MIN_WEEK,
                endWeek: parseInt(this.querySelector('#tourn-end-week').value, 10) || MAX_WEEK,
                totalRounds: parseInt(this.querySelector('#tourn-total-rounds').value, 10) || 1,
                status: this.querySelector('#tourn-status').value
            };

            // Read class selector
            var classSelect = this.querySelector('#tourn-class');
            if (classSelect) {
                data.graduatingClassId = classSelect.value || null;
            }

            var filterCheckbox = this.querySelector('#tourn-class-filter-enabled');
            if (filterCheckbox) {
                data.classFilterEnabled = filterCheckbox.checked;
            }

            if (!data.name) {
                showNotification('Tournament name is required.', 'warning');
                return;
            }

            if (data.classFilterEnabled === undefined) {
                data.classFilterEnabled = false;
            }

            if (data.graduatingClassId === '') {
                data.graduatingClassId = null;
            }

            var success;
            if (editId) {
                var result = Core.updateTournament(editId, data);
                if (result) {
                    success = true;
                    closeTournamentForm();
                    renderTournamentList(document.getElementById('tab-tournaments'));
                    if (state.currentTournamentId === editId) {
                        viewTournament(editId);
                    }
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                } else {
                    success = false;
                }
            } else {
                var result = Core.createTournament(data);
                if (result) {
                    success = true;
                    closeTournamentForm();
                    renderTournamentList(document.getElementById('tab-tournaments'));
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                } else {
                    success = false;
                }
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
        closeModal('tournament-form-modal');
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

        if (!modal || !title || !content) {
            return;
        }

        title.textContent = 'Add Match - Round ' + (round.roundNumber || roundIndex + 1);

        var available = getAvailableParticipants(tournament);

        var html = Render.renderMatchForm(tournament, roundIndex, -1, available);
        content.innerHTML = html;

        modal.dataset.tournamentId = tournamentId;
        modal.dataset.roundIndex = roundIndex;
        modal.dataset.matchIndex = -1;
        Modal.showModal(modal);

        setupModal('match-edit-modal', closeMatchEditModal);

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

        if (!modal || !title || !content) {
            return;
        }

        var round = tournament.rounds && tournament.rounds[roundIndex];
        title.textContent = 'Edit Match - Round ' + (round ? round.roundNumber || roundIndex + 1 : roundIndex + 1);

        var available = getAvailableParticipants(tournament);

        var html = Render.renderMatchForm(tournament, roundIndex, matchIndex, available);
        content.innerHTML = html;

        modal.dataset.tournamentId = tournamentId;
        modal.dataset.roundIndex = roundIndex;
        modal.dataset.matchIndex = matchIndex;
        Modal.showModal(modal);

        setupModal('match-edit-modal', closeMatchEditModal);

        attachMatchFormEvents(modal, tournament, roundIndex, matchIndex);
    }

    function getUniqueParticipantIds(ids) {
        var seen = Object.create(null);
        var result = [];
        for (var i = 0; i < ids.length; i++) {
            var id = String(ids[i]).trim();
            if (id && !seen[id]) {
                seen[id] = true;
                result.push(id);
            }
        }
        return result;
    }

    function attachMatchFormEvents(modal, tournament, roundIndex, matchIndex) {
        var form = modal.querySelector('#match-form');
        if (!form) {
            return;
        }

        var isEdit = matchIndex >= 0;

        var newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        // Initialise winner selector
        updateWinnerSelect(newForm, tournament, roundIndex);

        newForm.addEventListener('submit', function(e) {
            e.preventDefault();

            var currentTournament = Core.getTournament(modal.dataset.tournamentId);
            if (!currentTournament) {
                showNotification('Tournament no longer exists.', 'error');
                return;
            }

            // Gather form data
            var typeSelect = this.querySelector('#match-type');
            var type = typeSelect ? typeSelect.value : 'standard';

            // Gather participants
            var participantSelects = this.querySelectorAll('.match-participant-select');
            var participantIds = [];
            for (var i = 0; i < participantSelects.length; i++) {
                if (participantSelects[i].value) {
                    participantIds.push(participantSelects[i].value);
                }
            }

            var hiddenInputs = this.querySelectorAll('input[name^="participant_"]');
            for (var i = 0; i < hiddenInputs.length; i++) {
                if (hiddenInputs[i].value && participantIds.indexOf(hiddenInputs[i].value) === -1) {
                    participantIds.push(hiddenInputs[i].value);
                }
            }

            // Check for duplicate participants
            var uniqueIds = getUniqueParticipantIds(participantIds);
            if (uniqueIds.length !== participantIds.length) {
                showNotification('A participant cannot appear more than once in a match.', 'warning');
                return;
            }

            var round = currentTournament.rounds && currentTournament.rounds[roundIndex];
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
            for (var i = 0; i < resultSelects.length; i++) {
                if (resultSelects[i].value) {
                    results[resultSelects[i].dataset.id] = resultSelects[i].value;
                }
            }

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
                var currentMatch = Queries.getMatch(currentTournament, roundIndex, matchIndex);
                if (currentMatch && currentMatch.status !== 'pending') {
                    matchData.status = currentMatch.status;
                }
            }

            var success;
            if (isEdit) {
                var result = Matches.updateMatch(
                    currentTournament.id,
                    roundIndex,
                    matchIndex,
                    matchData
                );
                if (result) {
                    success = true;
                    closeMatchEditModal();
                    viewTournament(currentTournament.id);
                } else {
                    success = false;
                }
            } else {
                var result = Matches.addMatch(
                    currentTournament.id,
                    roundIndex,
                    matchData
                );
                if (result) {
                    success = true;
                    closeMatchEditModal();
                    viewTournament(currentTournament.id);
                } else {
                    success = false;
                }
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
        for (var i = 0; i < participantSelects2.length; i++) {
            participantSelects2[i].addEventListener('change', function() {
                updateWinnerSelect(newForm, tournament, roundIndex);
            });
        }
    }

    function updateWinnerSelect(form, tournament, roundIndex) {
        var winnerSelect = form.querySelector('#match-winner');
        if (!winnerSelect) {
            return;
        }

        var participantSelects = form.querySelectorAll('.match-participant-select');
        var participants = [];
        for (var i = 0; i < participantSelects.length; i++) {
            if (participantSelects[i].value) {
                participants.push(participantSelects[i].value);
            }
        }

        var hiddenInputs = form.querySelectorAll('input[name^="participant_"]');
        for (var i = 0; i < hiddenInputs.length; i++) {
            if (hiddenInputs[i].value && participants.indexOf(hiddenInputs[i].value) === -1) {
                participants.push(hiddenInputs[i].value);
            }
        }

        var currentValue = winnerSelect.value;
        winnerSelect.innerHTML = '<option value="">Select winner...</option>';

        for (var i = 0; i < participants.length; i++) {
            var id = participants[i];
            var name = Queries.getTournamentParticipantName(tournament, id);
            var option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            winnerSelect.appendChild(option);
        }

        if (currentValue) {
            var exists = false;
            for (var i = 0; i < winnerSelect.options.length; i++) {
                if (winnerSelect.options[i].value === currentValue) {
                    exists = true;
                    break;
                }
            }
            if (exists) {
                winnerSelect.value = currentValue;
            }
        }

        // Show/hide winner selection
        var winnerContainer = form.querySelector('#winner-selection');
        if (winnerContainer) {
            winnerContainer.style.display = participants.length >= 2 ? 'block' : 'none';
        }
    }

    function closeMatchEditModal() {
        closeModal('match-edit-modal');
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

        // Build structured message
        var message = 'Round ' + (round.roundNumber || roundIndex + 1) + ' Status:\n\n';
        message += 'Status: ' + Queries.getRoundStatus(tournament, roundIndex) + '\n';
        message += 'Matches: ' + (Array.isArray(round.matches) ? round.matches.length : 0) + '\n';
        message += 'Participants: ' + participants.length + '\n\n';

        for (var i = 0; i < participants.length; i++) {
            var id = participants[i];
            var status = statuses[id] || 'unknown';
            var name = Queries.getTournamentParticipantName(tournament, id);
            message += '  ' + name + ': ' + status + '\n';
        }

        // Show as a modal with formatted content
        showNotification(message, 'info');
    }

    function showEditRoundModal(tournamentId, roundIndex) {
        showNotification('Round editing is under development.', 'info');
    }

    // ============================================================
    // LIFECYCLE MANAGEMENT
    // ============================================================

    if (TabManager && typeof TabManager.register === 'function') {
        TabManager.register('tournaments', renderTournaments);
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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsUI = {
        render: renderTournaments,
        view: viewTournament,
        closeDetail: closeTournamentDetail,
        showForm: showTournamentForm,
        renderList: renderTournamentList
    };

    // Legacy compatibility aliases
    window.renderTournaments = renderTournaments;
    window.viewTournament = viewTournament;
    window.closeTournamentDetail = closeTournamentDetail;

})();
