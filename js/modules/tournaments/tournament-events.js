/**
 * modules/tournaments/tournament-events.js - Tournament Events
 * Event orchestration for the tournament module
 * Path: js/modules/tournaments/tournament-events.js
 * 
 * This module provides:
 *   - init - Bind all event listeners
 *   - destroy - Clean up all event listeners
 *   - Tournament CRUD event handlers (create, update, delete)
 *   - Participant management event handlers (add, remove)
 *   - Match management event handlers (create, update, complete, remove)
 *   - Round management event handlers (add, remove)
 *   - Tournament completion event handlers
 *   - Filter and view mode event handlers
 *   - Modal event handlers
 * 
 * IMPORTANT:
 *   - Orchestrates UI interactions - THIN layer
 *   - Calls TournamentCore for tournament/round mutations
 *   - Calls TournamentMatches for match mutations
 *   - Calls TournamentAggregator for data projections
 *   - Calls TournamentUI for state management
 *   - Uses NotificationSystem for notifications
 *   - Uses Modal for modal lifecycle
 *   - No direct data mutation
 *   - No direct DOM manipulation (delegates to Render)
 *   - No direct window.data access
 * 
 * DEPENDENCIES:
 *   - window.TournamentUI (from tournament-ui.js) - MANDATORY
 *   - window.TournamentAggregator (from tournament-aggregator.js) - MANDATORY
 *   - window.TournamentCore (from tournament-core.js) - MANDATORY
 *   - window.TournamentMatches (from tournament-matches.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 * 
 * USAGE:
 *   var TE = window.TournamentEvents;
 *   TE.init(container);
 *   // Later:
 *   TE.destroy();
 */

(function() {
    'use strict';

    if (window.__tournamentEventsLoaded) {
        return;
    }
    window.__tournamentEventsLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getTournamentUI() {
        return window.TournamentUI || null;
    }

    function getTournamentAggregator() {
        return window.TournamentAggregator || null;
    }

    function getTournamentCore() {
        return window.TournamentCore || null;
    }

    function getTournamentMatches() {
        return window.TournamentMatches || null;
    }

    function getTournamentQueries() {
        return window.TournamentQueries || null;
    }

    function getNotificationSystem() {
        return window.NotificationSystem || null;
    }

    function getModal() {
        return window.Modal || null;
    }

    function getDomUtils() {
        return window.DomUtils || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    function getAcademyQueries() {
        return window.AcademyQueries || null;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getTournamentUI()) {
            missing.push('TournamentUI');
        }
        if (!getTournamentAggregator()) {
            missing.push('TournamentAggregator');
        }
        if (!getTournamentCore()) {
            missing.push('TournamentCore');
        }
        if (!getTournamentMatches()) {
            missing.push('TournamentMatches');
        }
        if (!getTournamentQueries()) {
            missing.push('TournamentQueries');
        }
        if (!getNotificationSystem()) {
            missing.push('NotificationSystem');
        }
        if (!getModal()) {
            missing.push('Modal');
        }
        if (!getDomUtils()) {
            missing.push('DomUtils');
        }

        if (missing.length > 0) {
            console.warn('[TournamentEvents] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        var NotificationSystem = getNotificationSystem();
        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
        } else {
            console.warn('[TournamentEvents] NotificationSystem not available:', message);
        }
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
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

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];
    var _container = null;
    var _renderFn = null;

    // ============================================================
    // EVENT BINDING HELPERS
    // ============================================================

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
                // Ignore cleanup errors
            }
        }
        _eventListeners = [];
    }

    function delegate(selector, eventName, handler) {
        function wrappedHandler(e) {
            var target = e.target.closest ? e.target.closest(selector) : null;
            if (!target) {
                return;
            }
            handler(e, target);
        }

        document.addEventListener(eventName, wrappedHandler);

        _eventListeners.push({
            element: document,
            eventName: eventName,
            handler: wrappedHandler,
            options: false
        });

        return wrappedHandler;
    }

    // ============================================================
    // UI REFRESH
    // ============================================================

    function refreshUI() {
        if (_renderFn && typeof _renderFn === 'function') {
            _renderFn();
        }
    }

    function setRenderFn(fn) {
        _renderFn = fn;
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (_initialized) {
            destroy();
        }

        if (!checkDependencies()) {
            console.warn('[TournamentEvents] Dependencies not met, skipping initialization');
            return;
        }

        if (!container) {
            container = document.getElementById('tab-tournaments');
        }
        if (!container) {
            console.warn('[TournamentEvents] Container not found');
            return;
        }

        _container = container;
        removeAllEventListeners();

        // Bind all events
        bindContainerEvents(container);

        _initialized = true;
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
        _container = null;
        _renderFn = null;
    }

    // ============================================================
    // BIND CONTAINER EVENTS
    // ============================================================

    function bindContainerEvents(container) {
        // ---- Tournament list ----
        bindTournamentListEvents(container);

        // ---- Tournament CRUD ----
        bindTournamentCrudEvents(container);

        // ---- Participant events ----
        bindParticipantEvents(container);

        // ---- Round events ----
        bindRoundEvents(container);

        // ---- Match events ----
        bindMatchEvents(container);

        // ---- Tournament completion ----
        bindCompletionEvents(container);

        // ---- Filter events ----
        bindFilterEvents(container);

        // ---- View mode events ----
        bindViewModeEvents(container);
    }

    // ============================================================
    // TOURNAMENT LIST EVENTS
    // ============================================================

    function bindTournamentListEvents(container) {
        // Click on tournament item
        container.addEventListener('click', function(e) {
            var item = e.target.closest('.tournament-item, .list-item.tourn-item');
            if (!item) {
                return;
            }
            // Ignore clicks on buttons
            if (e.target.closest('button')) {
                return;
            }
            var id = item.dataset.id;
            if (id) {
                handleViewTournament(id);
            }
        });

        // Delegate for view button
        delegate('.view-tournament-btn, .view-tournament', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleViewTournament(id);
            }
        });

        // Delegate for close detail
        delegate('.close-tournament-detail', 'click', function() {
            handleCloseDetail();
        });
    }

    // ============================================================
    // TOURNAMENT CRUD EVENTS
    // ============================================================

    function bindTournamentCrudEvents(container) {
        // Add tournament
        var addBtn = container.querySelector('#add-tournament-btn, .add-tournament-btn');
        if (addBtn) {
            addEventListener(addBtn, 'click', function() {
                handleShowForm(null);
            });
        }

        // Edit tournament (delegated)
        delegate('.edit-tournament-btn, .edit-tournament', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleShowForm(id);
            }
        });

        // Delete tournament (delegated)
        delegate('.delete-tournament-btn, .delete-tournament', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id && confirm('Delete this tournament permanently?')) {
                handleDeleteTournament(id);
            }
        });

        // Tournament form submit
        var form = container.querySelector('#tournament-form, .tournament-form');
        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();
                handleSaveTournament(form);
            });
        }

        // Form cancel
        var cancelBtn = container.querySelector('.cancel-form-btn, #cancel-tournament-form');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                handleCloseForm();
            });
        }

        // Modal close buttons
        var closeBtns = container.querySelectorAll('.close-modal, .modal-close-btn');
        for (var i = 0; i < closeBtns.length; i++) {
            addEventListener(closeBtns[i], 'click', function(e) {
                var modal = e.target.closest('.modal');
                if (modal) {
                    handleCloseModal(modal);
                }
            });
        }

        // Modal overlay click
        var modals = container.querySelectorAll('.modal');
        for (var i = 0; i < modals.length; i++) {
            addEventListener(modals[i], 'click', function(e) {
                if (e.target === this) {
                    handleCloseModal(this);
                }
            });
        }
    }

    // ============================================================
    // PARTICIPANT EVENTS
    // ============================================================

    function bindParticipantEvents(container) {
        // Add participant
        delegate('.add-participant-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            if (tournamentId) {
                handleShowAddParticipantForm(tournamentId);
            }
        });

        // Remove participant
        delegate('.remove-participant-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            var participantId = target.dataset.participantId || target.dataset.id;
            if (tournamentId && participantId && confirm('Remove this participant?')) {
                handleRemoveParticipant(tournamentId, participantId);
            }
        });

        // Add participant form submit
        var addParticipantForm = container.querySelector('#add-participant-form');
        if (addParticipantForm) {
            addEventListener(addParticipantForm, 'submit', function(e) {
                e.preventDefault();
                handleSaveParticipant(addParticipantForm);
            });
        }
    }

    // ============================================================
    // ROUND EVENTS
    // ============================================================

    function bindRoundEvents(container) {
        // Add round
        delegate('.add-round-btn, .create-round-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            if (tournamentId) {
                handleAddRound(tournamentId);
            }
        });

        // Remove round
        delegate('.remove-round-btn, .delete-round-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            var roundIndex = parseInt(target.dataset.roundIndex, 10);
            if (tournamentId && !isNaN(roundIndex) && confirm('Remove this round?')) {
                handleRemoveRound(tournamentId, roundIndex);
            }
        });

        // Edit round (if applicable)
        delegate('.edit-round-btn', 'click', function(e, target) {
            // Placeholder - implement if needed
            notify('Round editing not yet implemented.', 'info');
        });
    }

    // ============================================================
    // MATCH EVENTS
    // ============================================================

    function bindMatchEvents(container) {
        // Add match
        delegate('.add-match-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            var roundIndex = parseInt(target.dataset.roundIndex, 10);
            if (tournamentId && !isNaN(roundIndex)) {
                handleShowAddMatchForm(tournamentId, roundIndex);
            }
        });

        // Edit match
        delegate('.edit-match-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            var matchId = target.dataset.matchId;
            var roundIndex = parseInt(target.dataset.roundIndex, 10);
            if (tournamentId && matchId && !isNaN(roundIndex)) {
                handleShowEditMatchForm(tournamentId, roundIndex, matchId);
            }
        });

        // Delete match
        delegate('.delete-match-btn, .remove-match-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            var matchId = target.dataset.matchId;
            var roundIndex = parseInt(target.dataset.roundIndex, 10);
            if (tournamentId && matchId && !isNaN(roundIndex) && confirm('Delete this match?')) {
                handleDeleteMatch(tournamentId, roundIndex, matchId);
            }
        });

        // Complete match
        delegate('.complete-match-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            var matchId = target.dataset.matchId;
            var roundIndex = parseInt(target.dataset.roundIndex, 10);
            if (tournamentId && matchId && !isNaN(roundIndex)) {
                handleShowCompleteMatchForm(tournamentId, roundIndex, matchId);
            }
        });

        // Match form submit
        var matchForm = container.querySelector('#match-form, .match-form');
        if (matchForm) {
            addEventListener(matchForm, 'submit', function(e) {
                e.preventDefault();
                handleSaveMatch(matchForm);
            });
        }

        // Complete match form submit
        var completeMatchForm = container.querySelector('#complete-match-form');
        if (completeMatchForm) {
            addEventListener(completeMatchForm, 'submit', function(e) {
                e.preventDefault();
                handleCompleteMatch(completeMatchForm);
            });
        }
    }

    // ============================================================
    // COMPLETION EVENTS
    // ============================================================

    function bindCompletionEvents(container) {
        // Complete tournament
        delegate('.complete-tournament-btn', 'click', function(e, target) {
            var tournamentId = target.dataset.tournamentId || target.dataset.id;
            if (tournamentId && confirm('Complete this tournament?')) {
                handleCompleteTournament(tournamentId);
            }
        });
    }

    // ============================================================
    // FILTER EVENTS
    // ============================================================

    function bindFilterEvents(container) {
        // Status filter
        var statusFilter = container.querySelector('#tournament-status-filter, .tournament-status-filter');
        if (statusFilter) {
            addEventListener(statusFilter, 'change', function() {
                var UI = getTournamentUI();
                if (UI) {
                    UI.setFilter('status', this.value);
                    refreshUI();
                }
            });
        }

        // Search filter
        var searchFilter = container.querySelector('#tournament-search-filter, .tournament-search-filter');
        if (searchFilter) {
            addEventListener(searchFilter, 'input', function() {
                var UI = getTournamentUI();
                if (UI) {
                    UI.setFilter('search', this.value);
                    refreshUI();
                }
            });
        }

        // Mode filter
        var modeFilter = container.querySelector('#tournament-mode-filter, .tournament-mode-filter');
        if (modeFilter) {
            addEventListener(modeFilter, 'change', function() {
                var UI = getTournamentUI();
                if (UI) {
                    UI.setFilter('mode', this.value);
                    refreshUI();
                }
            });
        }

        // Clear filters
        var clearBtn = container.querySelector('#clear-tournament-filters, .clear-tournament-filters');
        if (clearBtn) {
            addEventListener(clearBtn, 'click', function() {
                var UI = getTournamentUI();
                if (UI) {
                    UI.resetFilters();
                    // Update filter inputs
                    var statusEl = container.querySelector('#tournament-status-filter, .tournament-status-filter');
                    if (statusEl) { statusEl.value = 'all'; }
                    var searchEl = container.querySelector('#tournament-search-filter, .tournament-search-filter');
                    if (searchEl) { searchEl.value = ''; }
                    var modeEl = container.querySelector('#tournament-mode-filter, .tournament-mode-filter');
                    if (modeEl) { modeEl.value = 'all'; }
                    refreshUI();
                }
            });
        }
    }

    // ============================================================
    // VIEW MODE EVENTS
    // ============================================================

    function bindViewModeEvents(container) {
        var listViewBtn = container.querySelector('#view-list-btn, .view-list-btn');
        var gridViewBtn = container.querySelector('#view-grid-btn, .view-grid-btn');
        var detailViewBtn = container.querySelector('#view-detail-btn, .view-detail-btn');

        if (listViewBtn) {
            addEventListener(listViewBtn, 'click', function() {
                var UI = getTournamentUI();
                if (UI) {
                    UI.setViewMode('list');
                    refreshUI();
                }
            });
        }

        if (gridViewBtn) {
            addEventListener(gridViewBtn, 'click', function() {
                var UI = getTournamentUI();
                if (UI) {
                    UI.setViewMode('grid');
                    refreshUI();
                }
            });
        }

        if (detailViewBtn) {
            addEventListener(detailViewBtn, 'click', function() {
                var UI = getTournamentUI();
                if (UI) {
                    UI.setViewMode('detail');
                    refreshUI();
                }
            });
        }
    }

    // ============================================================
    // HANDLERS - Tournament CRUD
    // ============================================================

    function handleViewTournament(tournamentId) {
        var UI = getTournamentUI();
        if (!UI) {
            notify('Tournament UI not available.', 'error');
            return;
        }

        var Queries = getTournamentQueries();
        if (!Queries) {
            notify('Tournament Queries not available.', 'error');
            return;
        }

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) {
            notify('Tournament not found.', 'error');
            return;
        }

        UI.setSelectedTournamentId(tournamentId);
        UI.setActiveTab('detail');
        refreshUI();
    }

    function handleCloseDetail() {
        var UI = getTournamentUI();
        if (UI) {
            UI.setSelectedTournamentId(null);
            UI.setActiveTab('list');
            refreshUI();
        }
    }

    function handleShowForm(editId) {
        var UI = getTournamentUI();
        if (!UI) {
            notify('Tournament UI not available.', 'error');
            return;
        }

        var Modal = getModal();
        if (!Modal) {
            notify('Modal not available.', 'error');
            return;
        }

        // Set modal state
        UI.setModalState('tournament-form', { editId: editId });

        // Create and show modal
        var modal = Modal.createModal('tournament-form-modal');
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return;
        }

        // Build form content
        var content = buildTournamentForm(editId);
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = content;

        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        // Bind form events for this modal
        bindFormEvents(modal, editId);
    }

    function handleCloseForm() {
        var Modal = getModal();
        if (Modal) {
            var modal = document.querySelector('#tournament-form-modal');
            if (modal) {
                Modal.closeModal(modal);
            }
        }
        var UI = getTournamentUI();
        if (UI) {
            UI.clearModalState();
        }
    }

    function handleSaveTournament(form) {
        var Core = getTournamentCore();
        if (!Core) {
            notify('Tournament Core not available.', 'error');
            return;
        }

        var nameInput = form.querySelector('#tournament-name, .tournament-name');
        var modeInput = form.querySelector('#tournament-mode, .tournament-mode');
        var startWeekInput = form.querySelector('#tournament-start-week, .tournament-start-week');
        var endWeekInput = form.querySelector('#tournament-end-week, .tournament-end-week');
        var totalRoundsInput = form.querySelector('#tournament-total-rounds, .tournament-total-rounds');
        var classSelect = form.querySelector('#tournament-class, .tournament-class');
        var classFilterEnabled = form.querySelector('#tournament-class-filter-enabled, .tournament-class-filter-enabled');

        var name = nameInput ? nameInput.value.trim() : '';
        var mode = modeInput ? modeInput.value : 'teams';
        var startWeek = startWeekInput ? parseInt(startWeekInput.value, 10) : 1;
        var endWeek = endWeekInput ? parseInt(endWeekInput.value, 10) : 52;
        var totalRounds = totalRoundsInput ? parseInt(totalRoundsInput.value, 10) : 1;
        var graduatingClassId = classSelect ? classSelect.value : null;
        var classFilterEnabledValue = classFilterEnabled ? classFilterEnabled.checked : false;

        if (!name) {
            notify('Tournament name is required.', 'error');
            return;
        }

        var editId = form.dataset.editId || null;
        var result;

        if (editId) {
            result = Core.updateTournament(editId, {
                name: name,
                mode: mode,
                startWeek: startWeek,
                endWeek: endWeek,
                totalRounds: totalRounds,
                graduatingClassId: graduatingClassId,
                classFilterEnabled: classFilterEnabledValue
            });
        } else {
            result = Core.createTournament({
                name: name,
                mode: mode,
                startWeek: startWeek,
                endWeek: endWeek,
                totalRounds: totalRounds,
                graduatingClassId: graduatingClassId,
                classFilterEnabled: classFilterEnabledValue
            });
        }

        if (result) {
            var msg = editId ? 'Tournament updated successfully.' : 'Tournament created successfully.';
            notify(msg, 'success');
            handleCloseForm();
            refreshUI();
            // Trigger persistence
            triggerPersistence();
        } else {
            notify('Failed to save tournament.', 'error');
        }
    }

    function handleDeleteTournament(tournamentId) {
        var Core = getTournamentCore();
        if (!Core) {
            notify('Tournament Core not available.', 'error');
            return;
        }

        var result = Core.deleteTournament(tournamentId);
        if (result) {
            notify('Tournament deleted successfully.', 'success');
            var UI = getTournamentUI();
            if (UI && UI.getSelectedTournamentId() === tournamentId) {
                UI.setSelectedTournamentId(null);
            }
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to delete tournament.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Participants
    // ============================================================

    function handleShowAddParticipantForm(tournamentId) {
        var UI = getTournamentUI();
        if (!UI) {
            notify('Tournament UI not available.', 'error');
            return;
        }

        var Modal = getModal();
        if (!Modal) {
            notify('Modal not available.', 'error');
            return;
        }

        var Queries = getTournamentQueries();
        if (!Queries) {
            notify('Tournament Queries not available.', 'error');
            return;
        }

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) {
            notify('Tournament not found.', 'error');
            return;
        }

        UI.setModalState('participant-form', { tournamentId: tournamentId });

        var modal = Modal.createModal('add-participant-modal');
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return;
        }

        var content = buildAddParticipantForm(tournament);
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = content;

        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        bindAddParticipantEvents(modal, tournamentId);
    }

    function handleSaveParticipant(form) {
        var Core = getTournamentCore();
        if (!Core) {
            notify('Tournament Core not available.', 'error');
            return;
        }

        var tournamentId = form.dataset.tournamentId;
        if (!tournamentId) {
            notify('No tournament selected.', 'error');
            return;
        }

        var participantSelect = form.querySelector('#participant-select, .participant-select');
        var typeSelect = form.querySelector('#participant-type-select, .participant-type-select');

        var participantId = participantSelect ? participantSelect.value : '';
        var participantType = typeSelect ? typeSelect.value : 'character';

        if (!participantId) {
            notify('Please select a participant.', 'error');
            return;
        }

        var result = Core.addParticipant(tournamentId, {
            id: participantId,
            type: participantType
        });

        if (result) {
            notify('Participant added successfully.', 'success');
            handleCloseModal(document.querySelector('#add-participant-modal'));
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to add participant.', 'error');
        }
    }

    function handleRemoveParticipant(tournamentId, participantId) {
        var Core = getTournamentCore();
        if (!Core) {
            notify('Tournament Core not available.', 'error');
            return;
        }

        var result = Core.removeParticipant(tournamentId, participantId);
        if (result) {
            notify('Participant removed successfully.', 'success');
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to remove participant.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Rounds
    // ============================================================

    function handleAddRound(tournamentId) {
        var Core = getTournamentCore();
        if (!Core) {
            notify('Tournament Core not available.', 'error');
            return;
        }

        var result = Core.addRound(tournamentId);
        if (result) {
            notify('Round added successfully.', 'success');
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to add round.', 'error');
        }
    }

    function handleRemoveRound(tournamentId, roundIndex) {
        var Core = getTournamentCore();
        if (!Core) {
            notify('Tournament Core not available.', 'error');
            return;
        }

        var result = Core.removeRound(tournamentId, roundIndex);
        if (result) {
            notify('Round removed successfully.', 'success');
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to remove round.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Matches
    // ============================================================

    function handleShowAddMatchForm(tournamentId, roundIndex) {
        var UI = getTournamentUI();
        if (!UI) {
            notify('Tournament UI not available.', 'error');
            return;
        }

        var Modal = getModal();
        if (!Modal) {
            notify('Modal not available.', 'error');
            return;
        }

        var Queries = getTournamentQueries();
        if (!Queries) {
            notify('Tournament Queries not available.', 'error');
            return;
        }

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) {
            notify('Tournament not found.', 'error');
            return;
        }

        UI.setModalState('match-form', { tournamentId: tournamentId, roundIndex: roundIndex });

        var modal = Modal.createModal('add-match-modal');
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return;
        }

        var content = buildAddMatchForm(tournament, roundIndex);
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = content;

        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        bindAddMatchEvents(modal, tournamentId, roundIndex);
    }

    function handleShowEditMatchForm(tournamentId, roundIndex, matchId) {
        var UI = getTournamentUI();
        if (!UI) {
            notify('Tournament UI not available.', 'error');
            return;
        }

        var Modal = getModal();
        if (!Modal) {
            notify('Modal not available.', 'error');
            return;
        }

        var Queries = getTournamentQueries();
        if (!Queries) {
            notify('Tournament Queries not available.', 'error');
            return;
        }

        var match = Queries.getMatch(tournamentId, roundIndex, matchId);
        if (!match) {
            notify('Match not found.', 'error');
            return;
        }

        UI.setModalState('match-form', { tournamentId: tournamentId, roundIndex: roundIndex, matchId: matchId });

        var modal = Modal.createModal('edit-match-modal');
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return;
        }

        var content = buildEditMatchForm(tournamentId, roundIndex, match);
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = content;

        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        bindEditMatchEvents(modal, tournamentId, roundIndex, matchId);
    }

    function handleSaveMatch(form) {
        var Matches = getTournamentMatches();
        if (!Matches) {
            notify('Tournament Matches not available.', 'error');
            return;
        }

        var tournamentId = form.dataset.tournamentId;
        var roundIndex = parseInt(form.dataset.roundIndex, 10);
        var matchId = form.dataset.matchId || null;

        if (!tournamentId || isNaN(roundIndex)) {
            notify('Invalid tournament or round.', 'error');
            return;
        }

        var participant1Select = form.querySelector('#match-participant-1, .match-participant-1');
        var participant2Select = form.querySelector('#match-participant-2, .match-participant-2');
        var matchTypeSelect = form.querySelector('#match-type, .match-type');

        var participant1 = participant1Select ? participant1Select.value : '';
        var participant2 = participant2Select ? participant2Select.value : '';
        var matchType = matchTypeSelect ? matchTypeSelect.value : 'standard';

        if (!participant1 || !participant2) {
            notify('Please select both participants.', 'error');
            return;
        }

        if (participant1 === participant2) {
            notify('Participants must be different.', 'error');
            return;
        }

        var result;
        if (matchId) {
            result = Matches.updateMatch(tournamentId, roundIndex, matchId, {
                participants: [participant1, participant2],
                type: matchType
            });
        } else {
            result = Matches.createMatch(tournamentId, roundIndex, {
                participants: [participant1, participant2],
                type: matchType
            });
        }

        if (result) {
            var msg = matchId ? 'Match updated successfully.' : 'Match added successfully.';
            notify(msg, 'success');
            handleCloseModal(document.querySelector('#add-match-modal, #edit-match-modal'));
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to save match.', 'error');
        }
    }

    function handleDeleteMatch(tournamentId, roundIndex, matchId) {
        var Matches = getTournamentMatches();
        if (!Matches) {
            notify('Tournament Matches not available.', 'error');
            return;
        }

        var result = Matches.removeMatch(tournamentId, roundIndex, matchId);
        if (result) {
            notify('Match deleted successfully.', 'success');
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to delete match.', 'error');
        }
    }

    function handleShowCompleteMatchForm(tournamentId, roundIndex, matchId) {
        var UI = getTournamentUI();
        if (!UI) {
            notify('Tournament UI not available.', 'error');
            return;
        }

        var Modal = getModal();
        if (!Modal) {
            notify('Modal not available.', 'error');
            return;
        }

        var Queries = getTournamentQueries();
        if (!Queries) {
            notify('Tournament Queries not available.', 'error');
            return;
        }

        var match = Queries.getMatch(tournamentId, roundIndex, matchId);
        if (!match) {
            notify('Match not found.', 'error');
            return;
        }

        UI.setModalState('complete-match', { tournamentId: tournamentId, roundIndex: roundIndex, matchId: matchId });

        var modal = Modal.createModal('complete-match-modal');
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return;
        }

        var content = buildCompleteMatchForm(tournamentId, roundIndex, match);
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = content;

        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        bindCompleteMatchEvents(modal, tournamentId, roundIndex, matchId);
    }

    function handleCompleteMatch(form) {
        var Matches = getTournamentMatches();
        if (!Matches) {
            notify('Tournament Matches not available.', 'error');
            return;
        }

        var tournamentId = form.dataset.tournamentId;
        var roundIndex = parseInt(form.dataset.roundIndex, 10);
        var matchId = form.dataset.matchId;

        if (!tournamentId || isNaN(roundIndex) || !matchId) {
            notify('Invalid tournament, round, or match.', 'error');
            return;
        }

        var winnerSelect = form.querySelector('#match-winner-select, .match-winner-select');
        var winner = winnerSelect ? winnerSelect.value : '';

        if (!winner) {
            notify('Please select a winner.', 'error');
            return;
        }

        var result = Matches.completeMatch(tournamentId, roundIndex, matchId, {
            winner: winner
        });

        if (result) {
            notify('Match completed successfully.', 'success');
            handleCloseModal(document.querySelector('#complete-match-modal'));
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to complete match.', 'error');
        }
    }

    // ============================================================
    // HANDLERS - Tournament Completion
    // ============================================================

    function handleCompleteTournament(tournamentId) {
        var Core = getTournamentCore();
        if (!Core) {
            notify('Tournament Core not available.', 'error');
            return;
        }

        var result = Core.completeTournament(tournamentId);
        if (result) {
            notify('Tournament completed successfully.', 'success');
            refreshUI();
            triggerPersistence();
        } else {
            notify('Failed to complete tournament.', 'error');
        }
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================

    function handleCloseModal(modal) {
        var Modal = getModal();
        if (Modal && modal) {
            Modal.closeModal(modal);
        }
        var UI = getTournamentUI();
        if (UI) {
            UI.clearModalState();
        }
    }

    // ============================================================
    // PERSISTENCE
    // ============================================================

    function triggerPersistence() {
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                notify('Changes applied in memory, but failed to persist.', 'error');
            });
        }
    }

    // ============================================================
    // BUILD FORM HTML
    // ============================================================

    function buildTournamentForm(editId) {
        var Queries = getTournamentQueries();
        var Constants = getTournamentConstants ? getTournamentConstants() : null;

        var tournament = null;
        if (editId && Queries) {
            tournament = Queries.getTournament(editId);
        }

        var t = tournament || {};
        var isEdit = !!tournament;

        var modes = Constants ? Constants.VALID_MODES || ['teams', 'individuals'] : ['teams', 'individuals'];
        var statuses = Constants ? Constants.VALID_STATUSES || ['draft', 'active', 'completed'] : ['draft', 'active', 'completed'];

        var html = '';
        html += '<form class="tournament-form" id="tournament-form" data-edit-id="' + (isEdit ? editId : '') + '">';
        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Tournament' : 'Create Tournament') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';

        // Name
        html += '<div class="form-group">';
        html += '<label>Tournament Name *</label>';
        html += '<input type="text" id="tournament-name" class="tournament-name" value="' + escapeHtml(t.name || '') + '" required>';
        html += '</div>';

        // Mode
        html += '<div class="form-group">';
        html += '<label>Mode</label>';
        html += '<select id="tournament-mode" class="tournament-mode">';
        for (var i = 0; i < modes.length; i++) {
            var mode = modes[i];
            var selected = t.mode === mode ? ' selected' : '';
            html += '<option value="' + escapeHtml(mode) + '"' + selected + '>' + escapeHtml(mode.charAt(0).toUpperCase() + mode.slice(1)) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Week range
        html += '<div class="form-row">';
        html += '<div class="form-group">';
        html += '<label>Start Week</label>';
        html += '<input type="number" id="tournament-start-week" class="tournament-start-week" value="' + escapeHtml(t.startWeek || 1) + '" min="1" max="52">';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label>End Week</label>';
        html += '<input type="number" id="tournament-end-week" class="tournament-end-week" value="' + escapeHtml(t.endWeek || 52) + '" min="1" max="52">';
        html += '</div>';
        html += '</div>';

        // Total rounds
        html += '<div class="form-group">';
        html += '<label>Total Rounds</label>';
        html += '<input type="number" id="tournament-total-rounds" class="tournament-total-rounds" value="' + escapeHtml(t.totalRounds || 1) + '" min="1">';
        html += '</div>';

        // Status
        html += '<div class="form-group">';
        html += '<label>Status</label>';
        html += '<select id="tournament-status" class="tournament-status">';
        for (var i = 0; i < statuses.length; i++) {
            var status = statuses[i];
            var selected = t.status === status ? ' selected' : '';
            html += '<option value="' + escapeHtml(status) + '"' + selected + '>' + escapeHtml(status.charAt(0).toUpperCase() + status.slice(1)) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-form-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' + (isEdit ? 'Update' : 'Create') + ' Tournament</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    function buildAddParticipantForm(tournament) {
        var CharacterQueries = getCharacterQueries();
        var TeamQueries = getTeamQueries();
        var Queries = getTournamentQueries();

        var html = '';
        html += '<form id="add-participant-form" data-tournament-id="' + escapeHtml(tournament.id) + '">';
        html += '<div class="modal-header">';
        html += '<h3>Add Participant</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';

        // Participant type
        var canonicalType = tournament.mode === 'teams' ? 'team' : 'character';
        var typeLabel = canonicalType === 'team' ? 'Team' : 'Character';

        html += '<div class="form-group">';
        html += '<label>Type</label>';
        html += '<select id="participant-type-select" class="participant-type-select">';
        html += '<option value="' + escapeHtml(canonicalType) + '">' + escapeHtml(typeLabel) + '</option>';
        html += '</select>';
        html += '</div>';

        // Participant select
        html += '<div class="form-group">';
        html += '<label>Select ' + escapeHtml(typeLabel) + '</label>';
        html += '<select id="participant-select" class="participant-select" required>';

        var participants = [];
        if (canonicalType === 'character' && CharacterQueries) {
            var allCharacters = window.data && window.data.characters ? window.data.characters : [];
            for (var i = 0; i < allCharacters.length; i++) {
                var char = allCharacters[i];
                if (char && !char.deceased) {
                    participants.push({
                        id: char.id,
                        name: CharacterQueries.getDisplayName(char),
                        type: 'character'
                    });
                }
            }
        } else if (canonicalType === 'team' && TeamQueries) {
            var allTeams = window.data && window.data.teams ? window.data.teams : [];
            for (var i = 0; i < allTeams.length; i++) {
                var team = allTeams[i];
                if (team && team.status === 'active') {
                    participants.push({
                        id: team.id,
                        name: team.name || 'Team ' + team.id,
                        type: 'team'
                    });
                }
            }
        }

        // Filter out existing participants
        var existingParticipants = Queries ? Queries.getParticipants(tournament.id) : [];
        var existingIds = {};
        for (var i = 0; i < existingParticipants.length; i++) {
            existingIds[existingParticipants[i].id] = true;
        }

        html += '<option value="">Select...</option>';
        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            if (!existingIds[p.id]) {
                html += '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</option>';
            }
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

    function buildAddMatchForm(tournament, roundIndex) {
        var Queries = getTournamentQueries();

        var html = '';
        html += '<form id="add-match-form" data-tournament-id="' + escapeHtml(tournament.id) + '" data-round-index="' + escapeHtml(roundIndex) + '">';
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
        var activeParticipants = Queries ? Queries.getActiveParticipants(tournament.id) : [];
        var canonicalType = tournament.mode === 'teams' ? 'team' : 'character';

        html += '<div class="form-group">';
        html += '<label>Participant 1</label>';
        html += '<select id="match-participant-1" class="match-participant-1" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < activeParticipants.length; i++) {
            var p = activeParticipants[i];
            var name = getParticipantDisplayName(tournament.id, p.id);
            html += '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(name) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Participant 2</label>';
        html += '<select id="match-participant-2" class="match-participant-2" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < activeParticipants.length; i++) {
            var p = activeParticipants[i];
            var name = getParticipantDisplayName(tournament.id, p.id);
            html += '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(name) + '</option>';
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

    function buildEditMatchForm(tournamentId, roundIndex, match) {
        var Queries = getTournamentQueries();

        var html = '';
        html += '<form id="edit-match-form" data-tournament-id="' + escapeHtml(tournamentId) + '" data-round-index="' + escapeHtml(roundIndex) + '" data-match-id="' + escapeHtml(match.id || '') + '">';
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
        var activeParticipants = Queries ? Queries.getActiveParticipants(tournamentId) : [];

        html += '<div class="form-group">';
        html += '<label>Participant 1</label>';
        html += '<select id="match-participant-1" class="match-participant-1" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < activeParticipants.length; i++) {
            var p = activeParticipants[i];
            var name = getParticipantDisplayName(tournamentId, p.id);
            var selected = match.participants && match.participants[0] === p.id ? ' selected' : '';
            html += '<option value="' + escapeHtml(p.id) + '"' + selected + '>' + escapeHtml(name) + '</option>';
        }
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Participant 2</label>';
        html += '<select id="match-participant-2" class="match-participant-2" required>';
        html += '<option value="">Select...</option>';
        for (var i = 0; i < activeParticipants.length; i++) {
            var p = activeParticipants[i];
            var name = getParticipantDisplayName(tournamentId, p.id);
            var selected = match.participants && match.participants[1] === p.id ? ' selected' : '';
            html += '<option value="' + escapeHtml(p.id) + '"' + selected + '>' + escapeHtml(name) + '</option>';
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

    function buildCompleteMatchForm(tournamentId, roundIndex, match) {
        var html = '';
        html += '<form id="complete-match-form" data-tournament-id="' + escapeHtml(tournamentId) + '" data-round-index="' + escapeHtml(roundIndex) + '" data-match-id="' + escapeHtml(match.id || '') + '">';
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
                var name = getParticipantDisplayName(tournamentId, id);
                html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(name) + '</option>';
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

    function getParticipantDisplayName(tournamentId, participantId) {
        var Aggregator = getTournamentAggregator();
        if (Aggregator && typeof Aggregator.getParticipantName === 'function') {
            return Aggregator.getParticipantName(tournamentId, participantId);
        }
        return participantId || 'Unknown';
    }

    // ============================================================
    // BIND FORM EVENTS
    // ============================================================

    function bindFormEvents(modal, editId) {
        // Cancel button
        var cancelBtn = modal.querySelector('.cancel-form-btn');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                handleCloseForm();
            });
        }

        // Close button
        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCloseForm();
            });
        }

        // Form submit is handled by the form's submit event
    }

    function bindAddParticipantEvents(modal, tournamentId) {
        var cancelBtn = modal.querySelector('.cancel-add-participant');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                handleCloseModal(modal);
            });
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCloseModal(modal);
            });
        }

        // Store tournamentId in form
        var form = modal.querySelector('#add-participant-form');
        if (form) {
            form.dataset.tournamentId = tournamentId;
        }
    }

    function bindAddMatchEvents(modal, tournamentId, roundIndex) {
        var cancelBtn = modal.querySelector('.cancel-add-match');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                handleCloseModal(modal);
            });
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCloseModal(modal);
            });
        }

        // Store data in form
        var form = modal.querySelector('#add-match-form');
        if (form) {
            form.dataset.tournamentId = tournamentId;
            form.dataset.roundIndex = roundIndex;
        }
    }

    function bindEditMatchEvents(modal, tournamentId, roundIndex, matchId) {
        var cancelBtn = modal.querySelector('.cancel-edit-match');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                handleCloseModal(modal);
            });
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCloseModal(modal);
            });
        }

        // Store data in form
        var form = modal.querySelector('#edit-match-form');
        if (form) {
            form.dataset.tournamentId = tournamentId;
            form.dataset.roundIndex = roundIndex;
            form.dataset.matchId = matchId;
        }
    }

    function bindCompleteMatchEvents(modal, tournamentId, roundIndex, matchId) {
        var cancelBtn = modal.querySelector('.cancel-complete-match');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                handleCloseModal(modal);
            });
        }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCloseModal(modal);
            });
        }

        // Store data in form
        var form = modal.querySelector('#complete-match-form');
        if (form) {
            form.dataset.tournamentId = tournamentId;
            form.dataset.roundIndex = roundIndex;
            form.dataset.matchId = matchId;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentEvents = {
        init: init,
        destroy: destroy,
        refreshUI: refreshUI,
        setRenderFn: setRenderFn,

        // Handlers (exposed for testing)
        handleViewTournament: handleViewTournament,
        handleCloseDetail: handleCloseDetail,
        handleShowForm: handleShowForm,
        handleCloseForm: handleCloseForm,
        handleSaveTournament: handleSaveTournament,
        handleDeleteTournament: handleDeleteTournament,
        handleShowAddParticipantForm: handleShowAddParticipantForm,
        handleSaveParticipant: handleSaveParticipant,
        handleRemoveParticipant: handleRemoveParticipant,
        handleAddRound: handleAddRound,
        handleRemoveRound: handleRemoveRound,
        handleShowAddMatchForm: handleShowAddMatchForm,
        handleShowEditMatchForm: handleShowEditMatchForm,
        handleSaveMatch: handleSaveMatch,
        handleDeleteMatch: handleDeleteMatch,
        handleShowCompleteMatchForm: handleShowCompleteMatchForm,
        handleCompleteMatch: handleCompleteMatch,
        handleCompleteTournament: handleCompleteTournament,
        handleCloseModal: handleCloseModal
    };

})();
