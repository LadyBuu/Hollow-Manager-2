/**
 * modules/teams/team-events.js - Team Events
 * Event orchestration for the team domain
 * 
 * This module provides:
 *   - init - Bind all event listeners
 *   - destroy - Clean up all event listeners
 *   - Team CRUD event handlers (create, update, delete)
 *   - Member management event handlers (add, remove, edit)
 *   - Ranking management event handlers (add, remove)
 *   - Filter and navigation event handlers
 *   - Modal event handlers
 * 
 * IMPORTANT:
 *   - Orchestrates UI interactions
 *   - Calls TeamCore for mutations
 *   - Calls TeamAggregator for data projections
 *   - Calls TeamUI for state management
 *   - Calls TeamRender for rendering
 *   - Uses Modal for modal lifecycle
 *   - Uses NotificationSystem for notifications
 *   - No direct data mutation
 *   - No direct DOM manipulation (delegates to TeamRender)
 * 
 * DEPENDENCIES:
 *   - window.TeamCore (from team-core.js) - MANDATORY
 *   - window.TeamAggregator (from team-aggregator.js) - MANDATORY
 *   - window.TeamUI (from team-ui.js) - MANDATORY
 *   - window.TeamRender (from team-render.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 * 
 * USAGE:
 *   var TE = window.TeamEvents;
 *   TE.init(container);
 *   // Later:
 *   TE.destroy();
 */

(function() {
    'use strict';

    if (window.__teamEventsLoaded) {
        return;
    }
    window.__teamEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamAggregator = window.TeamAggregator;
    var TeamUI = window.TeamUI;
    var TeamRender = window.TeamRender;
    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TeamCore || typeof TeamCore.createTeam !== 'function') {
            missing.push('TeamCore.createTeam');
        }
        if (!TeamCore || typeof TeamCore.updateTeam !== 'function') {
            missing.push('TeamCore.updateTeam');
        }
        if (!TeamCore || typeof TeamCore.deleteTeam !== 'function') {
            missing.push('TeamCore.deleteTeam');
        }
        if (!TeamCore || typeof TeamCore.addMember !== 'function') {
            missing.push('TeamCore.addMember');
        }
        if (!TeamCore || typeof TeamCore.removeMember !== 'function') {
            missing.push('TeamCore.removeMember');
        }
        if (!TeamCore || typeof TeamCore.updateMember !== 'function') {
            missing.push('TeamCore.updateMember');
        }
        if (!TeamCore || typeof TeamCore.addRanking !== 'function') {
            missing.push('TeamCore.addRanking');
        }
        if (!TeamCore || typeof TeamCore.removeRanking !== 'function') {
            missing.push('TeamCore.removeRanking');
        }

        if (!TeamAggregator || typeof TeamAggregator.getTeamPageViewModel !== 'function') {
            missing.push('TeamAggregator.getTeamPageViewModel');
        }

        if (!TeamUI || typeof TeamUI.getState !== 'function') {
            missing.push('TeamUI.getState');
        }
        if (!TeamUI || typeof TeamUI.setState !== 'function') {
            missing.push('TeamUI.setState');
        }

        if (!TeamRender || typeof TeamRender.renderList !== 'function') {
            missing.push('TeamRender.renderList');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getStudents !== 'function') {
            missing.push('CharacterQueries.getStudents');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassDisplayName !== 'function') {
            missing.push('AcademyQueries.getClassDisplayName');
        }

        if (!Modal || typeof Modal.showModal !== 'function') {
            missing.push('Modal.showModal');
        }
        if (!Modal || typeof Modal.closeModal !== 'function') {
            missing.push('Modal.closeModal');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            console.warn('[TeamEvents] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // HTML ESCAPING - Use DomUtils when available
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeAttribute === 'function') {
            return window.DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];
    var _container = null;

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
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore cleanup errors
            }
        });
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
        if (!_container) {
            return;
        }

        var currentTab = TeamUI.getCurrentTab();
        var expandedTeamId = TeamUI.getExpandedTeamId();

        var viewModel = TeamAggregator.getTeamPageViewModel({
            type: currentTab,
            period: getCurrentPeriod(currentTab),
            expandedTeamId: expandedTeamId
        });

        var listContainer = _container.querySelector('#team-list-container');
        if (listContainer) {
            var html = TeamRender.renderList(
                viewModel.teams,
                currentTab,
                getCurrentPeriod(currentTab),
                expandedTeamId
            );
            listContainer.innerHTML = html;
        }

        updateStats(viewModel);
    }

    function updateStats(viewModel) {
        if (!_container) {
            return;
        }

        viewModel = viewModel || TeamAggregator.getTeamPageViewModel({
            type: TeamUI.getCurrentTab(),
            period: getCurrentPeriod(TeamUI.getCurrentTab())
        });

        var counts = viewModel.counts || { professional: 0, temporary: 0, civilian: 0 };

        var tabButtons = _container.querySelectorAll('.tab-btn');
        var tabMap = {
            'professional': counts.professional,
            'temporary': counts.temporary,
            'civilian': counts.civilian
        };

        for (var i = 0; i < tabButtons.length; i++) {
            var btn = tabButtons[i];
            var tab = btn.dataset.tab;
            var count = tabMap[tab] || 0;
            var label = btn.textContent.replace(/\(\d+\)$/, '').trim();
            btn.textContent = label + ' (' + count + ')';
        }

        var statCards = _container.querySelectorAll('.stat-card .stat-number');
        var statValues = [counts.professional, counts.temporary, counts.civilian];
        for (var j = 0; j < statCards.length && j < statValues.length; j++) {
            statCards[j].textContent = statValues[j];
        }
    }

    function getCurrentPeriod(tab) {
        var filter = TeamUI.getFilter(tab);
        if (tab === 'professional' || tab === 'temporary') {
            return filter.filterYear || 1;
        }
        return 1;
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (_initialized) {
            destroy();
        }

        if (!checkDependencies()) {
            console.warn('[TeamEvents] Dependencies not met, skipping initialization');
            return;
        }

        if (!container) {
            container = document.getElementById('tab-teams');
        }
        if (!container) {
            console.warn('[TeamEvents] Container not found');
            return;
        }

        _container = container;
        removeAllEventListeners();

        // Render the container
        renderContainer(container);

        // Bind events
        bindTabSwitching();
        bindAddTeam();
        bindTeamActions();
        bindFormModal();
        bindMemberModal();
        bindEditMemberModal();
        bindRankingModal();
        bindFilters();

        _initialized = true;
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
        _container = null;
    }

    // ============================================================
    // RENDER CONTAINER
    // ============================================================

    function renderContainer(container) {
        var currentTab = TeamUI.getCurrentTab();
        var viewModel = TeamAggregator.getTeamPageViewModel({
            type: currentTab,
            period: getCurrentPeriod(currentTab)
        });

        var html = getContainerHTML(currentTab, viewModel);
        container.innerHTML = html;
    }

    function getContainerHTML(currentTab, viewModel) {
        viewModel = viewModel || TeamAggregator.getTeamPageViewModel({ type: currentTab });

        var counts = viewModel.counts || { professional: 0, temporary: 0, civilian: 0 };
        var teams = viewModel.teams || [];
        var expandedTeamId = viewModel.expandedTeamId || null;
        var period = viewModel.period || 1;

        var html = '';

        // Header
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<button id="add-team-btn" class="primary">+ Add Team</button>';
        html += '</div>';

        // Stats
        html += '<div class="stats-grid">';
        html += '<div class="stat-card"><h3>Professional</h3><p class="stat-number">' + counts.professional + '</p></div>';
        html += '<div class="stat-card"><h3>Temporary</h3><p class="stat-number">' + counts.temporary + '</p></div>';
        html += '<div class="stat-card"><h3>Civilian</h3><p class="stat-number">' + counts.civilian + '</p></div>';
        html += '</div>';

        // Tab buttons
        html += '<div class="tab-nav" id="team-tab-nav">';
        html += '<button class="tab-btn ' + (currentTab === 'professional' ? 'active' : '') + '" data-tab="professional">Professional (' + counts.professional + ')</button>';
        html += '<button class="tab-btn ' + (currentTab === 'temporary' ? 'active' : '') + '" data-tab="temporary">Temporary (' + counts.temporary + ')</button>';
        html += '<button class="tab-btn ' + (currentTab === 'civilian' ? 'active' : '') + '" data-tab="civilian">Civilian (' + counts.civilian + ')</button>';
        html += '</div>';

        // Filter section
        html += '<div id="filter-container" class="filter-container">';
        html += buildFilterHTML(currentTab);
        html += '</div>';

        // Team list
        html += '<div id="team-list-container" class="team-list-container">';
        html += TeamRender.renderList(teams, currentTab, period, expandedTeamId);
        html += '</div>';

        // Modals
        html += getModalsHTML();

        return html;
    }

    // ============================================================
    // FILTER HTML
    // ============================================================

    function buildFilterHTML(tab) {
        var filter = TeamUI.getFilter(tab);

        if (tab === 'professional' || tab === 'temporary') {
            var html = '';
            html += '<div class="filter-row">';
            html += '<div class="filter-group">';
            html += '<label for="team-filter-year">Year:</label>';
            html += '<input type="number" id="team-filter-year" value="' + (filter.filterYear || '') + '" min="1900" max="2100" placeholder="All">';
            html += '</div>';
            html += '<div class="filter-group">';
            html += '<label for="' + tab + '-show-inactive">Show Inactive:</label>';
            html += '<input type="checkbox" id="' + tab + '-show-inactive" ' + (filter.filterStatus === 'inactive' ? 'checked' : '') + '>';
            html += '</div>';
            html += '<button id="apply-filter-btn" class="small primary">Apply</button>';
            html += '</div>';
            return html;
        }

        if (tab === 'civilian') {
            var html = '';
            html += '<div class="filter-row">';
            html += '<div class="filter-group">';
            html += '<label for="civilian-show-inactive">Show Inactive:</label>';
            html += '<input type="checkbox" id="civilian-show-inactive" ' + (filter.filterStatus === 'inactive' ? 'checked' : '') + '>';
            html += '</div>';
            html += '<button id="apply-filter-btn" class="small primary">Apply</button>';
            html += '</div>';
            return html;
        }

        return '';
    }

    // ============================================================
    // MODALS HTML
    // ============================================================

    function getModalsHTML() {
        return [
            '<!-- Team Form Modal -->',
            '<div id="team-form-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="team-form-title">Add Team</h3>',
                        '<button class="close-modal" id="close-team-form">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="team-form-inner">',
                            '<div class="form-grid">',
                                '<div class="form-group full-width">',
                                    '<label>Team Name *</label>',
                                    '<input type="text" id="team-name" required>',
                                '</div>',
                                '<div class="form-group">',
                                    '<label>Team Type *</label>',
                                    '<select id="team-type" required>',
                                        '<option value="professional">Professional</option>',
                                        '<option value="temporary">Temporary</option>',
                                        '<option value="civilian">Civilian</option>',
                                    '</select>',
                                '</div>',
                                '<div class="form-group">',
                                    '<label id="team-start-label">Start Period</label>',
                                    '<input type="text" id="team-start" placeholder="Year">',
                                '</div>',
                                '<div class="form-group">',
                                    '<label id="team-end-label">End Period (optional)</label>',
                                    '<input type="text" id="team-end" placeholder="Year">',
                                '</div>',
                                '<div class="form-group">',
                                    '<label>Current Ranking</label>',
                                    '<input type="text" id="team-ranking" readonly disabled>',
                                    '<span class="field-hint">(Read-only; use Rankings tab to modify)</span>',
                                '</div>',
                                '<div class="form-group">',
                                    '<label>Status</label>',
                                    '<select id="team-status">',
                                        '<option value="active">Active</option>',
                                        '<option value="inactive">Inactive</option>',
                                        '<option value="deprecated">Deprecated</option>',
                                    '</select>',
                                '</div>',
                                '<div class="form-group full-width" id="temporary-mission-field">',
                                    '<label>Associated Mission</label>',
                                    '<select id="team-mission">',
                                        '<option value="">None</option>',
                                    '</select>',
                                '</div>',
                                '<div class="form-group full-width">',
                                    '<label>Name History</label>',
                                    '<div id="name-history-container">',
                                        '<div class="name-history-entry" style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;">',
                                            '<input type="text" class="name-history-name" placeholder="Team Name" style="flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">',
                                            '<input type="text" class="name-history-start" placeholder="Start" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">',
                                            '<input type="text" class="name-history-end" placeholder="End" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">',
                                            '<button type="button" class="small danger remove-name" style="padding:2px 6px;font-size:0.6rem;">x</button>',
                                        '</div>',
                                    '</div>',
                                    '<button type="button" id="add-name-history-btn" class="small" style="margin-top:8px;">+ Add Name Period</button>',
                                '</div>',
                            '</div>',
                            '<div class="form-actions">',
                                '<button type="button" id="cancel-team-form" class="secondary">Cancel</button>',
                                '<button type="submit" id="save-team-btn" class="primary">Save Team</button>',
                            '</div>',
                        '</form>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Member Modal -->',
            '<div id="member-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="modal-team-name">Team Members</h3>',
                        '<button class="close-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<div class="member-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">',
                            '<select id="member-character" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                                '<option value="">Select character...</option>',
                            '</select>',
                            '<input type="text" id="member-role" placeholder="Role" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<input type="text" id="member-join" placeholder="Join" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<input type="text" id="member-leave" placeholder="Leave" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                            '<button id="add-member-btn" class="primary small">Add Member</button>',
                        '</div>',
                        '<div id="members-list">',
                            '<p class="empty-state">No members in this team</p>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Edit Member Modal -->',
            '<div id="edit-member-modal" class="modal hidden">',
                '<div class="modal-content small">',
                    '<div class="modal-header">',
                        '<h3>Edit Member</h3>',
                        '<button class="close-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="edit-member-form">',
                            '<div class="form-group">',
                                '<label>Character</label>',
                                '<p id="edit-member-name" style="margin:4px 0 12px 0;font-weight:600;"></p>',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Role</label>',
                                '<input type="text" id="edit-member-role">',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Join</label>',
                                '<input type="text" id="edit-member-join">',
                            '</div>',
                            '<div class="form-group">',
                                '<label>Leave</label>',
                                '<input type="text" id="edit-member-leave">',
                            '</div>',
                            '<div class="form-actions">',
                                '<button type="button" id="cancel-edit-member" class="secondary">Cancel</button>',
                                '<button type="submit" id="save-edit-member" class="primary">Save Changes</button>',
                            '</div>',
                        '</form>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Ranking Modal -->',
            '<div id="ranking-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="ranking-modal-title">Ranking History</h3>',
                        '<button class="close-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="ranking-form-inner">',
                            '<div class="ranking-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">',
                                '<input type="text" id="ranking-period" placeholder="Period" style="flex:1;min-width:100px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                                '<input type="number" id="ranking-rank" placeholder="Rank" min="1" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">',
                                '<button type="button" id="add-ranking-btn" class="primary small">Add Ranking</button>',
                            '</div>',
                        '</form>',
                        '<div id="ranking-list">',
                            '<p class="empty-state">No ranking history</p>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function bindTabSwitching() {
        delegate('.tab-btn', 'click', function(e, target) {
            var tab = target.dataset.tab;
            if (!tab) {
                return;
            }

            TeamUI.setCurrentTab(tab);

            var allBtns = _container.querySelectorAll('.tab-btn');
            for (var i = 0; i < allBtns.length; i++) {
                allBtns[i].classList.remove('active');
            }
            target.classList.add('active');

            var filterContainer = document.getElementById('filter-container');
            if (filterContainer) {
                filterContainer.innerHTML = buildFilterHTML(tab);
                bindFilterEvents(tab);
            }

            refreshUI();
        });
    }

    // ============================================================
    // ADD TEAM
    // ============================================================

    function bindAddTeam() {
        delegate('#add-team-btn', 'click', function() {
            showTeamForm();
        });
    }

    function showTeamForm(editId) {
        var modal = document.getElementById('team-form-modal');
        if (!modal) {
            return;
        }

        var title = document.getElementById('team-form-title');
        var form = document.getElementById('team-form-inner');

        modal.classList.remove('hidden');

        populateClassSelector();
        populateMissionSelector();

        if (editId) {
            title.textContent = 'Edit Team';
            var team = TeamCore.getTeam(editId);
            if (team) {
                setFieldValue('team-name', team.name);
                setFieldValue('team-type', team.type || 'professional');
                setFieldValue('team-start', team.startPeriod);
                setFieldValue('team-end', team.endPeriod);
                setFieldValue('team-status', team.status || 'active');

                var rankingInput = document.getElementById('team-ranking');
                if (rankingInput) {
                    var currentRank = TeamQueries.getCurrentRank(team);
                    rankingInput.value = currentRank || '';
                    rankingInput.disabled = true;
                }

                var missionSelect = document.getElementById('team-mission');
                if (missionSelect && team.temporaryMission) {
                    missionSelect.value = team.temporaryMission;
                }

                if (form) {
                    form.dataset.editId = editId;
                }

                var container = document.getElementById('name-history-container');
                if (container) {
                    container.innerHTML = '';
                    if (team.nameHistory && team.nameHistory.length > 0) {
                        for (var i = 0; i < team.nameHistory.length; i++) {
                            var entry = team.nameHistory[i];
                            addNameHistoryEntry(container, entry.name, entry.startPeriod, entry.endPeriod);
                        }
                    } else {
                        addNameHistoryEntry(container);
                    }
                }
            }
        } else {
            title.textContent = 'Add Team';
            if (form) {
                form.reset();
                setFieldValue('team-type', 'professional');
                setFieldValue('team-status', 'active');
                delete form.dataset.editId;
            }

            var container2 = document.getElementById('name-history-container');
            if (container2) {
                container2.innerHTML = '';
                addNameHistoryEntry(container2);
            }
        }

        updatePeriodLabels();
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            toggleMissionField(typeSelect.value);
        }
    }

    function closeTeamForm() {
        var modal = document.getElementById('team-form-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    function setFieldValue(id, value) {
        var el = document.getElementById(id);
        if (el) {
            el.value = value !== undefined && value !== null ? String(value) : '';
        }
    }

    function populateClassSelector() {
        var select = document.getElementById('team-class');
        if (!select) {
            return;
        }

        var classes = AcademyQueries.getClasses();
        var currentValue = select.value;
        select.innerHTML = '<option value="">Unassigned</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        }
        if (currentValue) {
            select.value = currentValue;
        }
    }

    function populateMissionSelector() {
        var select = document.getElementById('team-mission');
        if (!select) {
            return;
        }

        var data = window.data || {};
        var missions = data.missions || [];
        select.innerHTML = '<option value="">None</option>';

        var sortedMissions = missions.slice().sort(function(a, b) {
            if (a.status === 'active' && b.status !== 'active') {
                return -1;
            }
            if (a.status !== 'active' && b.status === 'active') {
                return 1;
            }
            var titleA = String(a.title || '');
            var titleB = String(b.title || '');
            return titleA.localeCompare(titleB);
        });

        for (var i = 0; i < sortedMissions.length; i++) {
            var mission = sortedMissions[i];
            if (mission.status !== 'cancelled') {
                var option = document.createElement('option');
                option.value = mission.id;
                var title = String(mission.title || 'Untitled');
                option.textContent = title + (mission.status === 'completed' ? ' (completed)' : '');
                select.appendChild(option);
            }
        }
    }

    function toggleMissionField(type) {
        var field = document.getElementById('temporary-mission-field');
        if (field) {
            field.style.display = (type === 'temporary' || type === 'professional') ? 'block' : 'none';
        }
    }

    function updatePeriodLabels() {
        var typeSelect = document.getElementById('team-type');
        if (!typeSelect) {
            return;
        }

        var type = typeSelect.value;
        var startLabel = document.getElementById('team-start-label');
        var endLabel = document.getElementById('team-end-label');
        var startInput = document.getElementById('team-start');
        var endInput = document.getElementById('team-end');

        if (type === 'academic') {
            if (startLabel) {
                startLabel.textContent = 'Start Week';
            }
            if (endLabel) {
                endLabel.textContent = 'End Week (optional)';
            }
            if (startInput) {
                startInput.placeholder = 'Week (e.g., 1)';
            }
            if (endInput) {
                endInput.placeholder = 'Week';
            }
        } else {
            if (startLabel) {
                startLabel.textContent = 'Start Period';
            }
            if (endLabel) {
                endLabel.textContent = 'End Period (optional)';
            }
            if (startInput) {
                startInput.placeholder = 'Year';
            }
            if (endInput) {
                endInput.placeholder = 'Year';
            }
        }

        toggleMissionField(type);
    }

    function addNameHistoryEntry(container, name, start, end) {
        if (!container) {
            return;
        }

        var entry = document.createElement('div');
        entry.className = 'name-history-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;';

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'name-history-name';
        nameInput.placeholder = 'Team Name';
        nameInput.value = name || '';
        nameInput.style.cssText = 'flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var startInput = document.createElement('input');
        startInput.type = 'text';
        startInput.className = 'name-history-start';
        startInput.placeholder = 'Start';
        startInput.value = start || '';
        startInput.style.cssText = 'flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var endInput = document.createElement('input');
        endInput.type = 'text';
        endInput.className = 'name-history-end';
        endInput.placeholder = 'End';
        endInput.value = end || '';
        endInput.style.cssText = 'flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-name';
        removeBtn.style.cssText = 'padding:2px 6px;font-size:0.6rem;';
        removeBtn.textContent = 'x';

        entry.appendChild(nameInput);
        entry.appendChild(startInput);
        entry.appendChild(endInput);
        entry.appendChild(removeBtn);

        container.appendChild(entry);

        removeBtn.onclick = function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                notify('You need at least one name entry.', 'error');
            }
        };
    }

    // ============================================================
    // TEAM FORM SUBMIT
    // ============================================================

    function bindFormModal() {
        var form = document.getElementById('team-form-inner');
        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();
                saveTeam();
            });
        }

        var closeBtn = document.getElementById('close-team-form');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', closeTeamForm);
        }

        var cancelBtn = document.getElementById('cancel-team-form');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', closeTeamForm);
        }

        var modal = document.getElementById('team-form-modal');
        if (modal) {
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    closeTeamForm();
                }
            });
        }

        var addNameBtn = document.getElementById('add-name-history-btn');
        if (addNameBtn) {
            addEventListener(addNameBtn, 'click', function() {
                var container = document.getElementById('name-history-container');
                if (container) {
                    addNameHistoryEntry(container);
                }
            });
        }

        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            addEventListener(typeSelect, 'change', updatePeriodLabels);
        }
    }

    function saveTeam() {
        var form = document.getElementById('team-form-inner');
        if (!form) {
            return;
        }

        var editId = form.dataset.editId || null;
        var type = document.getElementById('team-type').value;

        var teamData = {
            name: document.getElementById('team-name').value.trim(),
            type: type,
            startPeriod: document.getElementById('team-start').value || '',
            endPeriod: document.getElementById('team-end').value || '',
            status: document.getElementById('team-status').value || 'active',
            temporaryMission: (type === 'temporary' || type === 'professional')
                ? (document.getElementById('team-mission').value || null)
                : null,
            nameHistory: collectNameHistory()
        };

        if (!teamData.name) {
            notify('Team name is required.', 'error');
            return;
        }

        var result;
        if (editId) {
            result = TeamCore.updateTeam(editId, teamData);
            if (!result) {
                notify('Failed to update team.', 'error');
                return;
            }
        } else {
            result = TeamCore.createTeam(teamData);
            if (!result) {
                notify('Failed to create team.', 'error');
                return;
            }
        }

        closeTeamForm();

        refreshUI();

        notify(editId ? 'Team updated successfully!' : 'Team created successfully!', 'success');

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                notify('Changes applied in memory, but failed to persist.', 'error');
            });
        }
    }

    function collectNameHistory() {
        var entries = document.querySelectorAll('.name-history-entry');
        var history = [];

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var name = entry.querySelector('.name-history-name');
            var start = entry.querySelector('.name-history-start');
            var end = entry.querySelector('.name-history-end');

            if (name && name.value.trim()) {
                history.push({
                    name: name.value.trim(),
                    startPeriod: start ? start.value.trim() : '',
                    endPeriod: end ? end.value.trim() : ''
                });
            }
        }

        return history;
    }

    // ============================================================
    // TEAM ACTIONS (Edit, Delete, Members, Rankings)
    // ============================================================

    function bindTeamActions() {
        delegate('.edit-team', 'click', function(e, target) {
            var teamId = target.dataset.id;
            if (teamId) {
                showTeamForm(teamId);
            }
        });

        delegate('.delete-team', 'click', function(e, target) {
            var teamId = target.dataset.id;
            if (teamId) {
                deleteTeam(teamId);
            }
        });

        delegate('.manage-members', 'click', function(e, target) {
            var teamId = target.dataset.id;
            if (teamId) {
                showMemberModal(teamId);
            }
        });

        delegate('.manage-rankings', 'click', function(e, target) {
            var teamId = target.dataset.id;
            if (teamId) {
                showRankingModal(teamId);
            }
        });

        delegate('.toggle-members', 'click', function(e, target) {
            var teamId = target.dataset.id;
            if (teamId) {
                var expanded = TeamUI.toggleExpandedTeam(teamId);
                refreshUI();
            }
        });
    }

    function deleteTeam(teamId) {
        var team = TeamCore.getTeam(teamId);
        if (!team) {
            notify('Team not found.', 'error');
            return;
        }

        if (!confirm('Delete "' + team.name + '"? The team will be removed from the manager.')) {
            return;
        }

        var result = TeamCore.deleteTeam(teamId);
        if (!result) {
            notify('Failed to delete team.', 'error');
            return;
        }

        if (TeamUI.getExpandedTeamId() === teamId) {
            TeamUI.setExpandedTeamId(null);
        }

        refreshUI();

        notify('Team deleted successfully!', 'success');

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                notify('Changes applied in memory, but failed to persist.', 'error');
            });
        }
    }

    // ============================================================
    // MEMBER MODAL
    // ============================================================

    function bindMemberModal() {
        var addBtn = document.getElementById('add-member-btn');
        if (addBtn) {
            addEventListener(addBtn, 'click', addMember);
        }

        var closeBtn = document.querySelector('#member-modal .close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', closeMemberModal);
        }

        var modal = document.getElementById('member-modal');
        if (modal) {
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    closeMemberModal();
                }
            });
        }

        // Delegate for edit/remove in member list
        delegate('.edit-member', 'click', function(e, target) {
            var teamId = getModalTeamId();
            var charId = target.dataset.characterId;
            if (teamId && charId) {
                showEditMemberModal(teamId, charId);
            }
        });

        delegate('.remove-member', 'click', function(e, target) {
            var teamId = getModalTeamId();
            var charId = target.dataset.characterId;
            if (teamId && charId && confirm('Remove this member from the team?')) {
                var result = TeamCore.removeMember(teamId, charId);
                if (result) {
                    refreshMemberList(teamId);
                    refreshUI();
                    notify('Member removed successfully!', 'success');
                } else {
                    notify('Failed to remove member.', 'error');
                }
            }
        });
    }

    function getModalTeamId() {
        var modal = document.getElementById('member-modal');
        return modal ? modal.dataset.teamId : null;
    }

    function showMemberModal(teamId) {
        var modal = document.getElementById('member-modal');
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            notify('Team not found.', 'error');
            return;
        }

        TeamUI.setModalTeamId(teamId);

        var titleEl = document.getElementById('modal-team-name');
        if (titleEl) {
            titleEl.textContent = team.name + ' - Members';
        }

        populateMemberCharacterSelect(teamId);

        var roleInput = document.getElementById('member-role');
        if (roleInput) {
            roleInput.value = '';
        }
        var joinInput = document.getElementById('member-join');
        if (joinInput) {
            joinInput.value = '';
        }
        var leaveInput = document.getElementById('member-leave');
        if (leaveInput) {
            leaveInput.value = '';
        }

        modal.dataset.teamId = teamId;
        modal.classList.remove('hidden');

        refreshMemberList(teamId);
    }

    function closeMemberModal() {
        var modal = document.getElementById('member-modal');
        if (modal) {
            modal.classList.add('hidden');
            TeamUI.setModalTeamId(null);
        }
    }

    function refreshMemberList(teamId) {
        var container = document.getElementById('members-list');
        if (!container) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            container.innerHTML = '<p class="empty-state">Team not found</p>';
            return;
        }

        var members = Array.isArray(team.members) ? team.members : [];

        if (members.length === 0) {
            container.innerHTML = '<p class="empty-state">No members in this team</p>';
            return;
        }

        var html = '';
        for (var i = 0; i < members.length; i++) {
            var member = members[i];
            if (!member || typeof member !== 'object') {
                continue;
            }

            var character = CharacterQueries.getCharacterById(member.characterId);
            var name = character ? CharacterQueries.getDisplayName(character) : 'Unknown';

            html += '<div class="member-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span><strong>' + escapeHtml(name) + '</strong> <span style="color:var(--text-dim);font-size:0.65rem;">(' + escapeHtml(member.role || 'Member') + ')</span>';
            html += ' <span style="color:var(--text-dim);font-size:0.6rem;">' + escapeHtml(member.joinPeriod || '?') + (member.leavePeriod ? ' \u2192 ' + escapeHtml(member.leavePeriod) : '') + '</span>';
            html += '</span>';
            html += '<span>';
            html += '<button class="small edit-member" data-character-id="' + escapeAttribute(member.characterId) + '" style="font-size:0.6rem;padding:2px 6px;">Edit</button>';
            html += '<button class="small danger remove-member" data-character-id="' + escapeAttribute(member.characterId) + '" style="font-size:0.6rem;padding:2px 6px;">\u2715</button>';
            html += '</span>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    function populateMemberCharacterSelect(teamId) {
        var select = document.getElementById('member-character');
        if (!select) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        select.innerHTML = '<option value="">Select character...</option>';

        var characters = CharacterQueries.getStudents() || [];

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (!char || typeof char !== 'object') {
                continue;
            }

            var isInTeam = false;
            if (Array.isArray(team.members)) {
                for (var j = 0; j < team.members.length; j++) {
                    if (team.members[j] && String(team.members[j].characterId) === String(char.id)) {
                        isInTeam = true;
                        break;
                    }
                }
            }

            var option = document.createElement('option');
            option.value = char.id;
            var displayName = CharacterQueries.getDisplayName(char);
            option.textContent = displayName + (isInTeam ? ' (In Team)' : '');
            if (isInTeam) {
                option.disabled = true;
            }
            select.appendChild(option);
        }
    }

    function addMember() {
        var modal = document.getElementById('member-modal');
        if (!modal) {
            notify('Member modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        if (!teamId) {
            notify('No team selected.', 'error');
            return;
        }

        var charSelect = document.getElementById('member-character');
        var roleInput = document.getElementById('member-role');
        var joinInput = document.getElementById('member-join');
        var leaveInput = document.getElementById('member-leave');

        var charId = charSelect ? charSelect.value : '';
        var role = roleInput ? roleInput.value.trim() : '';
        var joinPeriod = joinInput ? joinInput.value : '';
        var leavePeriod = leaveInput ? leaveInput.value : '';

        if (!charId) {
            notify('Please select a character.', 'error');
            return;
        }

        var result = TeamCore.addMember(teamId, {
            characterId: charId,
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        });

        if (!result) {
            notify('Failed to add member. The character may already be in this team.', 'error');
            return;
        }

        if (charSelect) {
            charSelect.value = '';
        }
        if (roleInput) {
            roleInput.value = '';
        }
        if (joinInput) {
            joinInput.value = '';
        }
        if (leaveInput) {
            leaveInput.value = '';
        }

        refreshMemberList(teamId);
        refreshUI();
        notify('Member added successfully!', 'success');

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                notify('Changes applied in memory, but failed to persist.', 'error');
            });
        }
    }

    // ============================================================
    // EDIT MEMBER MODAL
    // ============================================================

    function bindEditMemberModal() {
        var form = document.getElementById('edit-member-form');
        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();
                saveEditMember();
            });
        }

        var closeBtn = document.querySelector('#edit-member-modal .close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', closeEditMemberModal);
        }

        var cancelBtn = document.getElementById('cancel-edit-member');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', closeEditMemberModal);
        }

        var modal = document.getElementById('edit-member-modal');
        if (modal) {
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    closeEditMemberModal();
                }
            });
        }
    }

    function showEditMemberModal(teamId, charId) {
        var modal = document.getElementById('edit-member-modal');
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team || !team.members) {
            notify('Team not found.', 'error');
            return;
        }

        var member = null;
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (m && String(m.characterId) === String(charId)) {
                member = m;
                break;
            }
        }

        if (!member) {
            notify('Member not found.', 'error');
            return;
        }

        var character = CharacterQueries.getCharacterById(charId);
        var name = character ? CharacterQueries.getDisplayName(character) : 'Unknown';

        var nameEl = document.getElementById('edit-member-name');
        if (nameEl) {
            nameEl.textContent = name;
        }

        var roleEl = document.getElementById('edit-member-role');
        if (roleEl) {
            roleEl.value = member.role || '';
        }

        var joinEl = document.getElementById('edit-member-join');
        if (joinEl) {
            joinEl.value = member.joinPeriod || '';
        }

        var leaveEl = document.getElementById('edit-member-leave');
        if (leaveEl) {
            leaveEl.value = member.leavePeriod || '';
        }

        modal.dataset.teamId = teamId;
        modal.dataset.characterId = charId;
        modal.classList.remove('hidden');
    }

    function closeEditMemberModal() {
        var modal = document.getElementById('edit-member-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    function saveEditMember() {
        var modal = document.getElementById('edit-member-modal');
        if (!modal) {
            notify('Edit member modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        var charId = modal.dataset.characterId;

        if (!teamId || !charId) {
            notify('No member selected.', 'error');
            return;
        }

        var roleInput = document.getElementById('edit-member-role');
        var joinInput = document.getElementById('edit-member-join');
        var leaveInput = document.getElementById('edit-member-leave');

        var role = roleInput ? roleInput.value.trim() : '';
        var joinPeriod = joinInput ? joinInput.value : '';
        var leavePeriod = leaveInput ? leaveInput.value : '';

        var result = TeamCore.updateMember(teamId, charId, {
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        });

        if (!result) {
            notify('Failed to update member.', 'error');
            return;
        }

        closeEditMemberModal();

        var teamModal = document.getElementById('member-modal');
        if (teamModal && teamModal.dataset.teamId) {
            refreshMemberList(teamModal.dataset.teamId);
        }
        refreshUI();
        notify('Member updated successfully!', 'success');

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                notify('Changes applied in memory, but failed to persist.', 'error');
            });
        }
    }

    // ============================================================
    // RANKING MODAL
    // ============================================================

    function bindRankingModal() {
        var addBtn = document.getElementById('add-ranking-btn');
        if (addBtn) {
            addEventListener(addBtn, 'click', addRanking);
        }

        var closeBtn = document.querySelector('#ranking-modal .close-modal');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', closeRankingModal);
        }

        var modal = document.getElementById('ranking-modal');
        if (modal) {
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    closeRankingModal();
                }
            });
        }

        delegate('.remove-ranking', 'click', function(e, target) {
            var period = target.dataset.period;
            var teamId = getRankingModalTeamId();
            if (period && teamId && confirm('Remove this ranking entry?')) {
                var result = TeamCore.removeRanking(teamId, period);
                if (result) {
                    refreshRankingList(teamId);
                    refreshUI();
                    notify('Ranking removed successfully!', 'success');
                } else {
                    notify('Failed to remove ranking.', 'error');
                }
            }
        });
    }

    function getRankingModalTeamId() {
        var modal = document.getElementById('ranking-modal');
        return modal ? modal.dataset.teamId : null;
    }

    function showRankingModal(teamId) {
        var modal = document.getElementById('ranking-modal');
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            notify('Team not found.', 'error');
            return;
        }

        TeamUI.setModalTeamId(teamId);

        var titleEl = document.getElementById('ranking-modal-title');
        if (titleEl) {
            titleEl.textContent = team.name + ' - Ranking History';
        }

        var periodInput = document.getElementById('ranking-period');
        if (periodInput) {
            periodInput.value = '';
            periodInput.placeholder = 'Period';
        }

        var rankInput = document.getElementById('ranking-rank');
        if (rankInput) {
            rankInput.value = '';
        }

        modal.dataset.teamId = teamId;
        modal.classList.remove('hidden');

        refreshRankingList(teamId);
    }

    function closeRankingModal() {
        var modal = document.getElementById('ranking-modal');
        if (modal) {
            modal.classList.add('hidden');
            TeamUI.setModalTeamId(null);
        }
    }

    function refreshRankingList(teamId) {
        var container = document.getElementById('ranking-list');
        if (!container) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            container.innerHTML = '<p class="empty-state">Team not found</p>';
            return;
        }

        var history = TeamCore.getSortedRankings(team);

        if (history.length === 0) {
            container.innerHTML = '<p class="empty-state">No ranking history</p>';
            return;
        }

        var html = '';
        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            html += '<div class="ranking-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span>Period: <strong>' + escapeHtml(entry.period) + '</strong> \u2192 Rank: <strong>#' + escapeHtml(entry.rank) + '</strong></span>';
            html += '<button class="small danger remove-ranking" data-period="' + escapeAttribute(entry.period) + '" style="font-size:0.6rem;padding:2px 6px;">\u2715</button>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    function addRanking() {
        var modal = document.getElementById('ranking-modal');
        if (!modal) {
            notify('Ranking modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        if (!teamId) {
            notify('No team selected.', 'error');
            return;
        }

        var periodInput = document.getElementById('ranking-period');
        var rankInput = document.getElementById('ranking-rank');

        var period = periodInput ? periodInput.value.trim() : '';
        var rank = rankInput ? parseInt(rankInput.value, 10) : null;

        if (!period) {
            notify('Please enter a period.', 'error');
            return;
        }

        if (!Number.isInteger(rank) || rank < 1) {
            notify('Please enter a valid rank (positive integer).', 'error');
            return;
        }

        var result = TeamCore.addRanking(teamId, period, rank);
        if (!result) {
            notify('Failed to add ranking.', 'error');
            return;
        }

        if (periodInput) {
            periodInput.value = '';
        }
        if (rankInput) {
            rankInput.value = '';
        }

        refreshRankingList(teamId);
        refreshUI();
        notify('Ranking added successfully!', 'success');

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                notify('Changes applied in memory, but failed to persist.', 'error');
            });
        }
    }

    // ============================================================
    // FILTERS
    // ============================================================

    function bindFilters() {
        bindFilterEvents(TeamUI.getCurrentTab());
    }

    function bindFilterEvents(tab) {
        var applyBtn = document.getElementById('apply-filter-btn');
        if (applyBtn) {
            addEventListener(applyBtn, 'click', function() {
                applyFilters(tab);
            });
        }

        var inactiveCheck = document.getElementById(tab + '-show-inactive');
        if (inactiveCheck) {
            addEventListener(inactiveCheck, 'change', function() {
                applyFilters(tab);
            });
        }

        var yearInput = document.getElementById('team-filter-year');
        if (yearInput) {
            addEventListener(yearInput, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    applyFilters(tab);
                }
            });
        }
    }

    function applyFilters(tab) {
        var filter = TeamUI.getFilter(tab);

        if (tab === 'professional' || tab === 'temporary') {
            var yearInput = document.getElementById('team-filter-year');
            if (yearInput) {
                var year = parseInt(yearInput.value, 10);
                if (!isNaN(year) && year >= 1900 && year <= 2100) {
                    TeamUI.setFilter(tab, 'filterYear', year);
                } else {
                    TeamUI.setFilter(tab, 'filterYear', '');
                }
            }

            var inactiveCheck = document.getElementById(tab + '-show-inactive');
            if (inactiveCheck) {
                TeamUI.setFilter(tab, 'filterStatus', inactiveCheck.checked ? 'inactive' : 'active');
            }
        }

        if (tab === 'civilian') {
            var inactiveCheck = document.getElementById('civilian-show-inactive');
            if (inactiveCheck) {
                TeamUI.setFilter(tab, 'filterStatus', inactiveCheck.checked ? 'inactive' : 'active');
            }
        }

        refreshUI();
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamEvents = {
        // Main
        init: init,
        destroy: destroy,

        // Refresh
        refreshUI: refreshUI,

        // Modal controls (for external use)
        showTeamForm: showTeamForm,
        closeTeamForm: closeTeamForm,
        showMemberModal: showMemberModal,
        closeMemberModal: closeMemberModal,
        showRankingModal: showRankingModal,
        closeRankingModal: closeRankingModal
    };

})();