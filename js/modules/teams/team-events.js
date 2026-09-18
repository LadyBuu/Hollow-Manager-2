/**
 * modules/teams/team-events.js - Team Events
 * Event orchestration for the team domain.
 *
 * Path: js/modules/teams/team-events.js
 *
 * This module is responsible for:
 *   - init / destroy - bind and unbind delegated listeners
 *   - Routing user interactions to TeamCore mutations
 *   - Updating TeamUI state
 *   - Requesting fresh view models from TeamAggregator
 *   - Handing view models to TeamRender
 *   - Managing the open/close of modals
 *   - Reading and writing form field values
 *
 * IMPORTANT:
 *   - Orchestration only. This module does NOT query the domain,
 *     does NOT generate HTML, does NOT read raw storage.
 *   - TeamCore owns mutations. TeamAggregator owns projections.
 *     TeamUI owns transient UI state. TeamRender owns HTML.
 *   - All mutation results are Promises from MutationPipeline. On
 *     success, request a fresh VM and re-render. On failure, the
 *     pipeline has already notified; do not double-notify.
 *   - Delegation is scoped to the container. No document-level
 *     listeners that could match unrelated UI.
 *
 * MEMBER MANAGER (BUG-E13):
 *   The professional member manager is now the SHARED manager
 *   (window.MemberManager), wired through
 *   window.MemberAdapterTeams. The manager lives in
 *   js/modules/shared/member-manager.js and is identical on both
 *   the Teams tab and Academy Weekly Teams. All the per-domain
 *   logic lives in the adapter.
 *
 *   This module's only remaining job for the member manager is:
 *     1. Create the modal shell once (on demand).
 *     2. Append a .modal-content.
 *     3. Modal.modalSetup + Modal.showModal.
 *     4. MemberManager.open(contentEl, { teamId, period, adapter, onClose }).
 *
 *   The modal shell is created OUTSIDE the container that
 *   refreshUI() rebuilds. refreshUI() no longer destroys it. This
 *   is what fixes the "Member modal not found" bug: the shell is
 *   owned by document.body, not by the Teams-tab container.
 *
 * REMOVED (BUG-E13):
 *   - showMemberModal, closeMemberModal, addMemberFromModal,
 *     refreshMemberListInPlace, populateMemberCandidates,
 *     bindMemberModal.
 *   - openMemberManager and all its external renderers
 *     (renderMemberManagerBody, renderManagerMemberRow,
 *     renderManagerPlaceholderRow, renderMemberEditorBody,
 *     bindManagerEvents, bindEditorClose, bindEditorEvents).
 *   - The single-row edit-member modal and its submit handler.
 *
 * DEPENDENCIES:
 *   - window.TeamCore       (MANDATORY)
 *   - window.TeamAggregator (MANDATORY)
 *   - window.TeamUI         (MANDATORY)
 *   - window.TeamRender     (MANDATORY)
 *   - window.Modal          (MANDATORY)
 *   - window.MemberManager  (MANDATORY — shared component)
 *   - window.MemberAdapterTeams (MANDATORY — professional adapter)
 *   - window.NotificationSystem (MANDATORY)
 *   - window.DomUtils       (MANDATORY)
 *
 * USAGE:
 *   var TE = window.TeamEvents;
 *   TE.init(container);
 *   TE.destroy();
 */

(function() {
    'use strict';

    if (window.__teamEventsLoaded) {
        return;
    }
    window.__teamEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamAggregator = window.TeamAggregator;
    var TeamUI = window.TeamUI;
    var TeamRender = window.TeamRender;
    var Modal = window.Modal;
    var MemberManager = window.MemberManager;
    var MemberAdapterTeams = window.MemberAdapterTeams;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // TeamCore — creation / update / delete / rankings only.
        // Member mutations live in the shared manager via the
        // adapter; this module no longer calls them directly.
        if (!TeamCore || typeof TeamCore.createTeam !== 'function') {
            missing.push('TeamCore.createTeam');
        }
        if (!TeamCore || typeof TeamCore.updateTeam !== 'function') {
            missing.push('TeamCore.updateTeam');
        }
        if (!TeamCore || typeof TeamCore.deleteTeam !== 'function') {
            missing.push('TeamCore.deleteTeam');
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
        if (!TeamAggregator || typeof TeamAggregator.getTeamFormViewModel !== 'function') {
            missing.push('TeamAggregator.getTeamFormViewModel');
        }
        if (!TeamAggregator || typeof TeamAggregator.getRankingModalViewModel !== 'function') {
            missing.push('TeamAggregator.getRankingModalViewModel');
        }
        if (!TeamAggregator || typeof TeamAggregator.getFilterBarViewModel !== 'function') {
            missing.push('TeamAggregator.getFilterBarViewModel');
        }

        if (!TeamUI || typeof TeamUI.getCurrentTab !== 'function') {
            missing.push('TeamUI.getCurrentTab');
        }
        if (!TeamUI || typeof TeamUI.getExpandedTeamId !== 'function') {
            missing.push('TeamUI.getExpandedTeamId');
        }

        if (!TeamRender || typeof TeamRender.renderContainer !== 'function') {
            missing.push('TeamRender.renderContainer');
        }
        if (!TeamRender || typeof TeamRender.renderFilterBar !== 'function') {
            missing.push('TeamRender.renderFilterBar');
        }
        if (!TeamRender || typeof TeamRender.renderTeamForm !== 'function') {
            missing.push('TeamRender.renderTeamForm');
        }
        if (!TeamRender || typeof TeamRender.renderRankingForm !== 'function') {
            missing.push('TeamRender.renderRankingForm');
        }
        if (!TeamRender || typeof TeamRender.renderRankingList !== 'function') {
            missing.push('TeamRender.renderRankingList');
        }
        if (!TeamRender || typeof TeamRender.renderNameHistoryRow !== 'function') {
            missing.push('TeamRender.renderNameHistoryRow');
        }

        if (!Modal ||
            typeof Modal.createModal !== 'function' ||
            typeof Modal.showModal !== 'function' ||
            typeof Modal.closeModal !== 'function' ||
            typeof Modal.modalSetup !== 'function') {
            missing.push('Modal API');
        }

        if (!MemberManager || typeof MemberManager.open !== 'function') {
            missing.push('MemberManager.open');
        }

        if (!MemberAdapterTeams ||
            typeof MemberAdapterTeams.fetchVM !== 'function' ||
            typeof MemberAdapterTeams.addMember !== 'function' ||
            typeof MemberAdapterTeams.updateMembers !== 'function' ||
            typeof MemberAdapterTeams.removeStint !== 'function' ||
            typeof MemberAdapterTeams.rejoinStint !== 'function' ||
            typeof MemberAdapterTeams.removeMember !== 'function') {
            missing.push('MemberAdapterTeams API');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }

        if (missing.length > 0) {
            console.warn('[TeamEvents] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _container = null;
    var _eventListeners = [];

    // The open member-manager modal. Created on demand, appended
    // to document.body, removed when the manager closes. Kept here
    // so destroy() can close it if the Teams tab is torn down
    // while it's open.
    var _memberManagerModal = null;

    // ============================================================
    // EVENT BINDING
    // ============================================================

    function addBoundListener(element, eventName, handler) {
        if (!element) return;
        element.addEventListener(eventName, handler);
        _eventListeners.push({ element: element, eventName: eventName, handler: handler });
    }

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler);
            } catch (e) { /* ignore */ }
        }
        _eventListeners = [];
    }

    function delegate(selector, eventName, handler) {
        if (!_container) {
            return;
        }

        function wrapped(e) {
            if (!_container) return;
            if (!_container.contains(e.target)) return;

            var target = e.target.closest ? e.target.closest(selector) : null;
            if (!target) return;
            if (!_container.contains(target)) return;

            handler(e, target);
        }

        _container.addEventListener(eventName, wrapped);
        _eventListeners.push({ element: _container, eventName: eventName, handler: wrapped });
    }

    // ============================================================
    // PERIOD HELPERS
    // ============================================================

    function getCurrentPeriod(tab) {
        var filter = TeamUI.getFilter(tab);
        if (filter && filter.filterYear) {
            var parsed = parseInt(filter.filterYear, 10);
            if (!isNaN(parsed) && parsed >= 1) {
                return parsed;
            }
        }

        var data = window.data || {};
        if (typeof data.currentYear === 'number' && isFinite(data.currentYear)) {
            return data.currentYear;
        }

        return null;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function refreshUI() {
        if (!_container) {
            return;
        }

        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);
        var expandedTeamId = TeamUI.getExpandedTeamId();

        var pageVM = TeamAggregator.getTeamPageViewModel({
            type: currentTab,
            period: period,
            expandedTeamId: expandedTeamId
        });

        if (pageVM.expandedTeamId !== expandedTeamId) {
            TeamUI.setExpandedTeamId(pageVM.expandedTeamId);
        }

        _container.innerHTML = TeamRender.renderContainer(pageVM);

        var filterContainer = _container.querySelector('#filter-container');
        if (filterContainer) {
            var filterVM = TeamAggregator.getFilterBarViewModel(currentTab);
            filterContainer.innerHTML = TeamRender.renderFilterBar(filterVM);
        }
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (_initialized) {
            destroy();
        }

        if (!checkDependencies()) {
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

        bindTabSwitching();
        bindAddTeam();
        bindTeamActions();
        bindModalCloseDelegation();
        bindTeamFormModal();
        bindRankingModal();
        bindFilters();
        bindNameHistoryAddRemove();

        _initialized = true;
    }

    function destroy() {
        // Close the shared member manager if it's open.
        if (_memberManagerModal) {
            try {
                Modal.closeModal(_memberManagerModal);
            } catch (e) {
                // Ignore.
            }
            _memberManagerModal = null;
        }

        removeAllEventListeners();
        _initialized = false;
        _container = null;
    }

    // ============================================================
    // MODAL CLOSE DELEGATION
    // ============================================================

    function bindModalCloseDelegation() {
        delegate('.modal .close-modal', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();

            var modal = target.closest('.modal');
            if (!modal) return;

            closeModalAndClearState(modal);
        });
    }

    function closeModalAndClearState(modal) {
        if (!modal) return;

        try {
            if (Modal && typeof Modal.closeModal === 'function') {
                Modal.closeModal(modal);
            } else if (Modal && typeof Modal.hideModal === 'function') {
                Modal.hideModal(modal);
            } else {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            }
        } catch (err) {
            console.warn('[TeamEvents] modal close failed:', err);
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }

        TeamUI.clearModalState();
    }

    // ============================================================
    // MODAL SHOW HELPER
    // ============================================================

    function showModal(modal) {
        if (!modal) return;

        try {
            if (Modal && typeof Modal.modalSetup === 'function') {
                Modal.modalSetup(modal);
            }
        } catch (err) {
            console.warn('[TeamEvents] Modal.modalSetup failed:', err);
        }

        try {
            if (Modal && typeof Modal.showModal === 'function') {
                Modal.showModal(modal);
                return;
            }
        } catch (err) {
            console.warn('[TeamEvents] Modal.showModal failed:', err);
        }

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function bindTabSwitching() {
        delegate('.tab-btn', 'click', function(e, target) {
            var tab = target.dataset.tab;
            if (!tab) return;

            TeamUI.setCurrentTab(tab);

            refreshUI();
        });
    }

    // ============================================================
    // ADD TEAM
    // ============================================================

    function bindAddTeam() {
        delegate('#add-team-btn', 'click', function() {
            showTeamForm(null);
        });
    }

    function showTeamForm(editId) {
        var formVM = TeamAggregator.getTeamFormViewModel(editId);
        if (!formVM) {
            notify('Team not found.', 'error');
            return;
        }

        // Create the modal shell on demand.
        var modal = Modal.createModal('team-form-modal');
        if (!modal) {
            notify('Could not open team form.', 'error');
            return;
        }
        modal.id = 'team-form-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        modal.appendChild(contentEl);

        contentEl.innerHTML = TeamRender.renderTeamForm(formVM);

        // Title.
        var titleEl = contentEl.querySelector('#team-form-title');
        if (titleEl) {
            titleEl.textContent = formVM.isEdit ? 'Edit Team' : 'Add Team';
        }

        TeamUI.setModalTeamId(formVM.isEdit ? formVM.teamId : null);

        showModal(modal);

        // Wire submit + cancel + name-history add.
        bindTeamFormSubmit(modal, contentEl);
    }

    function bindTeamFormSubmit(modal, contentEl) {
        var form = contentEl.querySelector('#team-form-inner');
        if (!form) return;

        var closeBtn = contentEl.querySelector('#close-team-form');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                closeModalAndClearState(modal);
            });
        }

        var cancelBtn = contentEl.querySelector('#cancel-team-form');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                closeModalAndClearState(modal);
            });
        }

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveTeam(form, modal);
        });

        var addNameBtn = contentEl.querySelector('#add-name-history-btn');
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var containerEl = form.querySelector('#name-history-container');
                if (containerEl) {
                    var wrapper = document.createElement('div');
                    wrapper.innerHTML = TeamRender.renderNameHistoryRow(null);
                    containerEl.appendChild(wrapper.firstElementChild);
                }
            });
        }
    }

    function saveTeam(form, modal) {
        var editId = form.dataset.editId || null;

        var nameEl = form.querySelector('#team-name');
        var typeEl = form.querySelector('#team-type');
        var startEl = form.querySelector('#team-start');
        var endEl = form.querySelector('#team-end');
        var classEl = form.querySelector('#team-class');
        var numberEl = form.querySelector('#team-number');
        var statusEl = form.querySelector('#team-status');
        var missionEl = form.querySelector('#team-mission');

        var name = nameEl ? nameEl.value.trim() : '';
        if (!name) {
            notify('Team name is required.', 'error');
            return;
        }

        var type = typeEl ? typeEl.value : 'professional';
        var status = statusEl ? statusEl.value : 'active';

        var teamData = {
            name: name,
            type: type,
            startPeriod: startEl ? startEl.value : '',
            endPeriod: endEl ? endEl.value : '',
            status: status,
            classId: classEl ? classEl.value : null,
            teamNumber: numberEl ? numberEl.value.trim() : '',
            temporaryMission: (type === 'temporary' || type === 'professional')
                ? (missionEl ? missionEl.value : null)
                : null,
            nameHistory: collectNameHistory(form)
        };

        var promise = editId
            ? TeamCore.updateTeam(editId, teamData)
            : TeamCore.createTeam(teamData);

        promise.then(function(result) {
            if (!result || !result.success) {
                return;
            }
            closeModalAndClearState(modal);
            refreshUI();
        }).catch(function(err) {
            console.warn('[TeamEvents] saveTeam failed:', err);
            notify('Failed to save team.', 'error');
        });
    }

    function collectNameHistory(form) {
        var entries = form.querySelectorAll('.name-history-entry');
        var history = [];

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var nameEl = entry.querySelector('.name-history-name');
            var startEl = entry.querySelector('.name-history-start');
            var endEl = entry.querySelector('.name-history-end');

            var name = nameEl ? nameEl.value.trim() : '';
            if (!name) continue;

            history.push({
                name: name,
                startPeriod: startEl ? startEl.value.trim() : '',
                endPeriod: endEl ? endEl.value.trim() : ''
            });
        }

        return history;
    }

    // ============================================================
    // TEAM ACTIONS
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
                openMemberManager(teamId);
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
            if (!teamId) return;

            var current = TeamUI.getExpandedTeamId();
            if (current && String(current) === String(teamId)) {
                TeamUI.setExpandedTeamId(null);
            } else {
                TeamUI.setExpandedTeamId(teamId);
            }

            refreshUI();
        });
    }

    function deleteTeam(teamId) {
        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);
        var pageVM = TeamAggregator.getTeamPageViewModel({
            type: currentTab,
            period: period
        });

        var team = null;
        for (var i = 0; i < pageVM.teams.length; i++) {
            if (String(pageVM.teams[i].id) === String(teamId)) {
                team = pageVM.teams[i];
                break;
            }
        }

        var name = team ? team.name : 'this team';
        if (!confirm('Delete "' + name + '"? The team will be removed from the manager.')) {
            return;
        }

        TeamCore.deleteTeam(teamId).then(function(result) {
            if (!result || !result.success) {
                return;
            }

            if (TeamUI.getExpandedTeamId() === teamId) {
                TeamUI.setExpandedTeamId(null);
            }

            refreshUI();
        }).catch(function(err) {
            console.warn('[TeamEvents] deleteTeam failed:', err);
            notify('Failed to delete team.', 'error');
        });
    }

    // ============================================================
    // MEMBER MANAGER (shared)
    // ============================================================
    //
    // Opens the shared MemberManager with the Teams adapter.
    //
    // MODAL LIFECYCLE:
    //   - The shell is created on demand here.
    //   - It's appended to document.body by Modal.showModal.
    //   - It is NOT in _container, so refreshUI cannot destroy it.
    //   - On close, the manager calls our onClose callback, which
    //     calls Modal.closeModal (removes the shell) and
    //     refreshUI (updates the list behind).
    //
    //   Next open creates a fresh shell. No stale state.

    function openMemberManager(teamId) {
        if (!isNonEmptyString(teamId)) {
            return;
        }

        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);

        if (period === null) {
            notify('Cannot determine the current period.', 'error');
            return;
        }

        // Close any prior instance.
        if (_memberManagerModal) {
            try {
                Modal.closeModal(_memberManagerModal);
            } catch (e) {
                // Ignore.
            }
            _memberManagerModal = null;
        }

        var modal = Modal.createModal('member-manager-modal');
        if (!modal) {
            notify('Could not open the member manager.', 'error');
            return;
        }
        modal.id = 'member-manager-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        modal.appendChild(contentEl);

        _memberManagerModal = modal;

        Modal.modalSetup(modal, function() {
            // Backdrop click or Escape → close.
            closeMemberManagerModal();
        });
        Modal.showModal(modal);

        MemberManager.open(contentEl, {
            teamId: String(teamId),
            period: period,
            adapter: MemberAdapterTeams,
            onClose: function() {
                closeMemberManagerModal();
            }
        });
    }

    function closeMemberManagerModal() {
        var modal = _memberManagerModal;
        _memberManagerModal = null;

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }

        refreshUI();
    }

    // ============================================================
    // RANKING MODAL (Teams tab)
    // ============================================================

    function showRankingModal(teamId) {
        var vm = TeamAggregator.getRankingModalViewModel(teamId);
        if (!vm) {
            notify('Team not found.', 'error');
            return;
        }

        var modal = Modal.createModal('ranking-modal');
        if (!modal) {
            notify('Could not open ranking modal.', 'error');
            return;
        }
        modal.id = 'ranking-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';

        var html = '';
        html += '<div class="modal-header">';
        html += '<h3 id="ranking-modal-title">' +
                    DomUtils.escapeHtml(vm.teamName) +
                    ' - Ranking History</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<div id="ranking-form-container">' +
                    TeamRender.renderRankingForm() +
                '</div>';
        html += '<div id="ranking-list">' +
                    TeamRender.renderRankingList(vm) +
                '</div>';
        html += '</div>';
        contentEl.innerHTML = html;
        modal.appendChild(contentEl);

        TeamUI.setModalTeamId(teamId);

        showModal(modal);

        // Wire add / remove buttons against this modal.
        bindRankingModalEvents(modal, contentEl, teamId);
    }

    function bindRankingModalEvents(modal, contentEl, teamId) {
        var closeBtn = contentEl.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                closeModalAndClearState(modal);
            });
        }

        var addBtn = contentEl.querySelector('#add-ranking-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                addRankingFromModal(modal, contentEl, teamId);
            });
        }

        contentEl.addEventListener('click', function(e) {
            var removeBtn = e.target.closest
                ? e.target.closest('.remove-ranking')
                : null;
            if (!removeBtn) return;
            e.preventDefault();

            var period = removeBtn.dataset.period;
            if (!period) return;

            if (!confirm('Remove this ranking entry?')) { return; }

            TeamCore.removeRanking(teamId, period)
                .then(function(result) {
                    if (result && result.success) {
                        refreshRankingListInPlace(modal, teamId);
                        refreshUI();
                    }
                })
                .catch(function(err) {
                    console.warn('[TeamEvents] removeRanking failed:', err);
                    notify('Failed to remove ranking.', 'error');
                });
        });
    }

    function addRankingFromModal(modal, contentEl, teamId) {
        var periodEl = contentEl.querySelector('#ranking-period');
        var rankEl = contentEl.querySelector('#ranking-rank');

        var period = periodEl ? periodEl.value.trim() : '';
        if (!period) {
            notify('Please enter a period.', 'error');
            return;
        }

        var rank = rankEl ? parseInt(rankEl.value, 10) : NaN;
        if (isNaN(rank) || rank < 1) {
            notify('Please enter a valid rank.', 'error');
            return;
        }

        TeamCore.addRanking(teamId, period, rank)
            .then(function(result) {
                if (!result || !result.success) { return; }
                if (periodEl) periodEl.value = '';
                if (rankEl) rankEl.value = '';
                refreshRankingListInPlace(modal, teamId);
                refreshUI();
            })
            .catch(function(err) {
                console.warn('[TeamEvents] addRanking failed:', err);
                notify('Failed to add ranking.', 'error');
            });
    }

    function refreshRankingListInPlace(modal, teamId) {
        var vm = TeamAggregator.getRankingModalViewModel(teamId);
        if (!vm) return;

        var listContainer = modal.querySelector('#ranking-list');
        if (listContainer) {
            listContainer.innerHTML = TeamRender.renderRankingList(vm);
        }
    }

    // ============================================================
    // FILTERS
    // ============================================================

    function bindFilters() {
        delegate('#apply-filter-btn', 'click', function() {
            applyFilters();
        });

        delegate('#team-filter-year', 'keydown', function(e) {
            if (e.key === 'Enter') {
                applyFilters();
            }
        });

        delegate('.filter-container input[type="checkbox"]', 'change', function() {
            applyFilters();
        });
    }

    function applyFilters() {
        var tab = TeamUI.getCurrentTab();

        if (tab === 'professional' || tab === 'temporary') {
            var yearEl = _container.querySelector('#team-filter-year');
            if (yearEl) {
                var yearRaw = yearEl.value.trim();
                var yearNum = parseInt(yearRaw, 10);
                if (yearRaw === '') {
                    TeamUI.setFilter(tab, 'filterYear', '');
                } else if (!isNaN(yearNum) && yearNum >= 1) {
                    TeamUI.setFilter(tab, 'filterYear', yearNum);
                }
            }
        }

        var inactiveEl = _container.querySelector('#' + tab + '-show-inactive');
        if (inactiveEl) {
            TeamUI.setFilter(tab, 'filterStatus', inactiveEl.checked ? 'inactive' : 'active');
        }

        refreshUI();
    }

    // ============================================================
    // NAME HISTORY ADD / REMOVE (delegated)
    // ============================================================

    function bindNameHistoryAddRemove() {
        delegate('.remove-name', 'click', function(e, target) {
            e.preventDefault();
            var entry = target.closest('.name-history-entry');
            if (!entry) return;
            var container = entry.parentElement;
            if (!container) return;

            if (container.querySelectorAll('.name-history-entry').length <= 1) {
                notify('You need at least one name entry.', 'error');
                return;
            }

            entry.remove();
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamEvents = {
        init: init,
        destroy: destroy,

        refreshUI: refreshUI,

        // Modal controls (Teams tab internal)
        showTeamForm: showTeamForm,
        showRankingModal: showRankingModal,
        openMemberManager: openMemberManager
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamEvents;
        var missing = [];

        var required = [
            'init', 'destroy', 'refreshUI',
            'showTeamForm', 'showRankingModal',
            'openMemberManager'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TeamEvents] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();