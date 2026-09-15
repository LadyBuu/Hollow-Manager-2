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
 * MODAL LIFECYCLE:
 *   All modals owned by this module are declared in
 *   TeamRender.getModalsHTML() and inserted into the container on
 *   every full-page render. That means:
 *
 *     1. The modal SHELLS are replaced on every refreshUI().
 *     2. Any listener bound directly to a modal element at
 *        init-time is lost after the first render.
 *     3. Modal lifecycle (backdrop click, escape key, focus trap,
 *        focus restore) is owned by window.Modal. Show modals by
 *        calling Modal.modalSetup(modal) followed by
 *        Modal.showModal(modal). Do not roll your own show path —
 *        that bypasses the lifecycle and leaves modals stuck open.
 *
 *   Close is handled by a container-delegated click listener for
 *   `.modal .close-modal` plus the modal's own backdrop-click and
 *   escape-key handlers installed by modalSetup.
 *
 * DEPENDENCIES:
 *   - window.TeamCore       (MANDATORY)
 *   - window.TeamAggregator (MANDATORY)
 *   - window.TeamUI         (MANDATORY)
 *   - window.TeamRender     (MANDATORY)
 *   - window.Modal          (MANDATORY)
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
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

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
        if (!TeamAggregator || typeof TeamAggregator.getTeamFormViewModel !== 'function') {
            missing.push('TeamAggregator.getTeamFormViewModel');
        }
        if (!TeamAggregator || typeof TeamAggregator.getMemberModalViewModel !== 'function') {
            missing.push('TeamAggregator.getMemberModalViewModel');
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

        if (!TeamRender || typeof TeamRender.renderList !== 'function') {
            missing.push('TeamRender.renderList');
        }
        if (!TeamRender || typeof TeamRender.renderFilterBar !== 'function') {
            missing.push('TeamRender.renderFilterBar');
        }
        if (!TeamRender || typeof TeamRender.renderTeamForm !== 'function') {
            missing.push('TeamRender.renderTeamForm');
        }

        if (!Modal || typeof Modal.showModal !== 'function') {
            missing.push('Modal.showModal');
        }
        if (!Modal || typeof Modal.closeModal !== 'function') {
            missing.push('Modal.closeModal');
        }
        if (!Modal || typeof Modal.modalSetup !== 'function') {
            missing.push('Modal.modalSetup');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
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
    // STATE
    // ============================================================

    var _initialized = false;
    var _container = null;
    var _eventListeners = [];

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

    /**
     * Delegate an event to a descendant of _container.
     *
     * The container scope means unrelated `.edit-team` elements
     * elsewhere in the document cannot trigger TeamEvents handlers.
     *
     * @param {string} selector
     * @param {string} eventName
     * @param {Function} handler - (event, target) => void
     */
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
    //
    // The current period for a tab is a TeamUI concern. This module
    // does not fall back to a Gregorian year or a hardcoded 1.

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

        // If the aggregator resolved a different expanded team ID
        // (e.g. stale ID invalidated against the filtered list),
        // sync it back to TeamUI.
        if (pageVM.expandedTeamId !== expandedTeamId) {
            TeamUI.setExpandedTeamId(pageVM.expandedTeamId);
        }

        // Full page replace. Delegation is scoped to _container, so
        // replacing its innerHTML does not lose the delegated
        // listeners.
        _container.innerHTML = TeamRender.renderContainer(pageVM);

        // Re-render the filter bar into its slot, since the page VM
        // does not embed it.
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
        bindModalCloseDelegation();   // NEW: single delegated close handler
        bindTeamFormModal();
        bindMemberModal();
        bindEditMemberModal();
        bindRankingModal();
        bindFilters();
        bindNameHistoryAddRemove();

        _initialized = true;
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
        _container = null;
    }

    // ============================================================
    // MODAL CLOSE DELEGATION
    // ============================================================
    //
    // All team modals live inside _container (rendered by
    // TeamRender.getModalsHTML()). Every full-page render replaces
    // their shells. Because delegation is scoped to _container and
    // matches by class, this one handler covers every modal's
    // `.close-modal` button across every re-render.
    //
    // Backdrop click and escape key are installed per-modal by
    // Modal.modalSetup(); they are not handled here.
    //
    // When a modal is closed this way, we also clear TeamUI's modal
    // state. That keeps the UI-state model consistent with the DOM:
    // no phantom "modal open" state pointing at a hidden modal.

    function bindModalCloseDelegation() {
        delegate('.modal .close-modal', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();

            var modal = target.closest('.modal');
            if (!modal) return;

            closeModalAndClearState(modal);
        });
    }

    /**
     * Close a modal and clear transient UI state.
     *
     * Shared by the delegated close handler and any per-modal
     * close wrapper (e.g. closeMemberModal's explicit path). Uses
     * Modal.hideModal() rather than closeModal() when available, so
     * the modal element is hidden but not removed — its shell
     * persists in the container and will be reused on next open.
     *
     * If Modal.hideModal is unavailable (defensive), falls back to
     * toggling the hidden class directly, mirroring the previous
     * local wrapper's behavior.
     */
    function closeModalAndClearState(modal) {
        if (!modal) return;

        try {
            if (Modal && typeof Modal.hideModal === 'function') {
                Modal.hideModal(modal);
            } else if (Modal && typeof Modal.closeModal === 'function') {
                Modal.closeModal(modal);
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
    //
    // SINGLE place this module opens a modal. Always installs the
    // Modal lifecycle (backdrop click, escape key, focus trap) before
    // showing. Bypassing this helper — by calling Modal.showModal
    // directly — leaves the modal without a close path.

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

        // Defensive fallback: show without lifecycle.
        // This should not be reached in normal operation.
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

            // The whole page re-renders, including the tab buttons
            // and the filter bar. No manual class twiddling needed.
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

        // The shell exists in the DOM (from getModalsHTML). Reuse it.
        var modal = document.getElementById('team-form-modal');
        if (!modal) {
            // Defensive: if a caller invokes showTeamForm before the
            // page has rendered its modal shells, create one.
            modal = Modal.createModal('team-form-modal');
            modal.id = 'team-form-modal';
            document.body.appendChild(modal);
            var createdContent = document.createElement('div');
            createdContent.className = 'modal-content';
            createdContent.innerHTML = TeamRender.getModalsHTML();
            modal.appendChild(createdContent);
            modal = document.getElementById('team-form-modal');
        }

        var body = modal.querySelector('#team-form-body');
        if (!body) {
            notify('Modal shell is malformed.', 'error');
            return;
        }

        body.innerHTML = TeamRender.renderTeamForm(formVM);

        var titleEl = modal.querySelector('#team-form-title');
        if (titleEl) {
            titleEl.textContent = formVM.isEdit ? 'Edit Team' : 'Add Team';
        }

        // Sync TeamUI modal state BEFORE showing, so any handler
        // that fires from modalSetup/showModal sees the right team.
        TeamUI.setModalTeamId(formVM.isEdit ? formVM.teamId : null);

        showModal(modal);

        bindTeamFormSubmit(modal);
    }

    function closeTeamForm() {
        var modal = document.getElementById('team-form-modal');
        if (modal) {
            closeModalAndClearState(modal);
        } else {
            TeamUI.clearModalState();
        }
    }

    function bindTeamFormModal() {
        delegate('#close-team-form', 'click', function(e) {
            e.preventDefault();
            closeTeamForm();
        });

        delegate('#cancel-team-form', 'click', function(e) {
            e.preventDefault();
            closeTeamForm();
        });
    }

    function bindTeamFormSubmit(modal) {
        var form = modal.querySelector('#team-form-inner');
        if (!form) return;

        // Modal-scoped listeners. These are not delegated because the
        // form exists only while the modal is open and is destroyed
        // when the modal closes. Direct listeners are correct here.
        var closeBtn = modal.querySelector('#close-team-form');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeTeamForm);
        }

        var cancelBtn = modal.querySelector('#cancel-team-form');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeTeamForm);
        }

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveTeam(form);
        });

        var addNameBtn = form.querySelector('#add-name-history-btn');
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var container = form.querySelector('#name-history-container');
                if (container) {
                    var wrapper = document.createElement('div');
                    wrapper.innerHTML = TeamRender.renderNameHistoryRow(null);
                    container.appendChild(wrapper.firstElementChild);
                }
            });
        }
    }

    function saveTeam(form) {
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
                // Pipeline already notified.
                return;
            }
            closeTeamForm();
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
        // Confirmation is a UX concern, but the name should come from
        // a VM, not a query. Resolve from the current page VM.
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
    // MEMBER MODAL
    // ============================================================

    function showMemberModal(teamId) {
        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);

        var vm = TeamAggregator.getMemberModalViewModel(teamId, period);
        if (!vm) {
            notify('Team not found.', 'error');
            return;
        }

        var modal = document.getElementById('member-modal');
        if (!modal) {
            notify('Member modal not found.', 'error');
            return;
        }

        var titleEl = modal.querySelector('#modal-team-name');
        if (titleEl) {
            titleEl.textContent = vm.teamName + ' - Members';
        }

        populateMemberCandidates(modal, vm.candidates);

        // Reset the input fields.
        var roleEl = modal.querySelector('#member-role');
        if (roleEl) roleEl.value = '';
        var joinEl = modal.querySelector('#member-join');
        if (joinEl) joinEl.value = '';
        var leaveEl = modal.querySelector('#member-leave');
        if (leaveEl) leaveEl.value = '';

        // Render the current members.
        var listContainer = modal.querySelector('#members-list');
        if (listContainer) {
            listContainer.innerHTML = TeamRender.renderMemberList(vm);
        }

        TeamUI.setModalTeamId(teamId);

        // showModal installs the lifecycle before displaying.
        showModal(modal);
    }

    function populateMemberCandidates(modal, candidates) {
        var select = modal.querySelector('#member-character');
        if (!select) return;

        var html = '<option value="">Select character...</option>';
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            html += '<option value="' + escapeAttr(c.id) + '">' +
                        escapeHtml(c.name) +
                    '</option>';
        }
        select.innerHTML = html;
    }

    function closeMemberModal() {
        var modal = document.getElementById('member-modal');
        if (modal) {
            closeModalAndClearState(modal);
        } else {
            TeamUI.clearModalState();
        }
    }

    function bindMemberModal() {
        delegate('#add-member-btn', 'click', function(e) {
            e.preventDefault();
            addMemberFromModal();
        });

        delegate('.edit-member', 'click', function(e, target) {
            var charId = target.dataset.characterId;
            var teamId = TeamUI.getModalTeamId();
            if (teamId && charId) {
                showEditMemberModal(teamId, charId);
            }
        });

        delegate('.remove-member', 'click', function(e, target) {
            var charId = target.dataset.characterId;
            var teamId = TeamUI.getModalTeamId();
            if (teamId && charId && confirm('Remove this member from the team?')) {
                TeamCore.removeMember(teamId, charId).then(function(result) {
                    if (result && result.success) {
                        refreshMemberListInPlace(teamId);
                        refreshUI();
                    }
                }).catch(function(err) {
                    console.warn('[TeamEvents] removeMember failed:', err);
                    notify('Failed to remove member.', 'error');
                });
            }
        });
    }

    function addMemberFromModal() {
        var teamId = TeamUI.getModalTeamId();
        if (!teamId) {
            notify('No team selected.', 'error');
            return;
        }

        var modal = document.getElementById('member-modal');
        if (!modal) return;

        var charSelect = modal.querySelector('#member-character');
        var roleEl = modal.querySelector('#member-role');
        var joinEl = modal.querySelector('#member-join');
        var leaveEl = modal.querySelector('#member-leave');

        var charId = charSelect ? charSelect.value : '';
        if (!charId) {
            notify('Please select a character.', 'error');
            return;
        }

        TeamCore.addMember(teamId, {
            characterId: charId,
            role: roleEl ? roleEl.value.trim() : '',
            joinPeriod: joinEl ? joinEl.value : '',
            leavePeriod: leaveEl ? leaveEl.value : ''
        }).then(function(result) {
            if (!result || !result.success) {
                return;
            }

            if (charSelect) charSelect.value = '';
            if (roleEl) roleEl.value = '';
            if (joinEl) joinEl.value = '';
            if (leaveEl) leaveEl.value = '';

            refreshMemberListInPlace(teamId);
            refreshUI();
        }).catch(function(err) {
            console.warn('[TeamEvents] addMember failed:', err);
            notify('Failed to add member.', 'error');
        });
    }

    function refreshMemberListInPlace(teamId) {
        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);
        var vm = TeamAggregator.getMemberModalViewModel(teamId, period);
        if (!vm) return;

        var modal = document.getElementById('member-modal');
        if (!modal) return;

        var listContainer = modal.querySelector('#members-list');
        if (listContainer) {
            listContainer.innerHTML = TeamRender.renderMemberList(vm);
        }
    }

    // ============================================================
    // EDIT MEMBER MODAL
    // ============================================================

    function showEditMemberModal(teamId, charId) {
        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);

        var vm = TeamAggregator.getMemberModalViewModel(teamId, period);
        if (!vm) {
            notify('Team not found.', 'error');
            return;
        }

        var member = null;
        for (var i = 0; i < vm.members.length; i++) {
            if (String(vm.members[i].characterId) === String(charId)) {
                member = vm.members[i];
                break;
            }
        }

        if (!member) {
            notify('Member not found.', 'error');
            return;
        }

        var modal = document.getElementById('edit-member-modal');
        if (!modal) return;

        var body = modal.querySelector('#edit-member-body');
        if (!body) return;

        body.innerHTML = TeamRender.renderMemberForm({
            characterId: member.characterId,
            characterName: member.displayName,
            role: member.role,
            joinPeriod: member.joinPeriod,
            leavePeriod: member.leavePeriod
        });

        TeamUI.setModalMemberId(charId);

        // showModal installs the lifecycle before displaying.
        showModal(modal);

        // Fresh form was just inserted — bind its submit handler.
        bindEditMemberFormSubmit();
    }

    function closeEditMemberModal() {
        var modal = document.getElementById('edit-member-modal');
        if (modal) {
            closeModalAndClearState(modal);
        } else {
            TeamUI.setModalMemberId(null);
        }
    }

    function bindEditMemberModal() {
        delegate('#cancel-edit-member', 'click', function(e) {
            e.preventDefault();
            closeEditMemberModal();
        });
    }

    function bindEditMemberFormSubmit() {
        var modal = document.getElementById('edit-member-modal');
        if (!modal) return;

        var form = modal.querySelector('#edit-member-form');
        if (!form) return;

        // Guard against double-binding when the form is re-rendered
        // while the modal stays open (e.g. rapid edit → edit).
        if (form._submitBound) {
            return;
        }
        form._submitBound = true;

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveEditMember(form);
        });
    }

    function saveEditMember(form) {
        var teamId = TeamUI.getModalTeamId();
        var charId = form.dataset.characterId;
        if (!teamId || !charId) {
            notify('No member selected.', 'error');
            return;
        }

        var roleEl = form.querySelector('#edit-member-role');
        var joinEl = form.querySelector('#edit-member-join');
        var leaveEl = form.querySelector('#edit-member-leave');

        TeamCore.updateMember(teamId, charId, {
            role: roleEl ? roleEl.value.trim() : '',
            joinPeriod: joinEl ? joinEl.value : '',
            leavePeriod: leaveEl ? leaveEl.value : ''
        }).then(function(result) {
            if (!result || !result.success) {
                return;
            }
            closeEditMemberModal();
            refreshMemberListInPlace(teamId);
            refreshUI();
        }).catch(function(err) {
            console.warn('[TeamEvents] updateMember failed:', err);
            notify('Failed to update member.', 'error');
        });
    }

    // ============================================================
    // RANKING MODAL
    // ============================================================

    function showRankingModal(teamId) {
        var vm = TeamAggregator.getRankingModalViewModel(teamId);
        if (!vm) {
            notify('Team not found.', 'error');
            return;
        }

        var modal = document.getElementById('ranking-modal');
        if (!modal) return;

        var titleEl = modal.querySelector('#ranking-modal-title');
        if (titleEl) {
            titleEl.textContent = vm.teamName + ' - Ranking History';
        }

        var formContainer = modal.querySelector('#ranking-form-container');
        if (formContainer) {
            formContainer.innerHTML = TeamRender.renderRankingForm();
        }

        var listContainer = modal.querySelector('#ranking-list');
        if (listContainer) {
            listContainer.innerHTML = TeamRender.renderRankingList(vm);
        }

        var periodEl = modal.querySelector('#ranking-period');
        if (periodEl) periodEl.value = '';
        var rankEl = modal.querySelector('#ranking-rank');
        if (rankEl) rankEl.value = '';

        TeamUI.setModalTeamId(teamId);

        // showModal installs the lifecycle before displaying.
        showModal(modal);
    }

    function closeRankingModal() {
        var modal = document.getElementById('ranking-modal');
        if (modal) {
            closeModalAndClearState(modal);
        } else {
            TeamUI.clearModalState();
        }
    }

    function bindRankingModal() {
        delegate('#add-ranking-btn', 'click', function(e) {
            e.preventDefault();
            addRankingFromModal();
        });

        delegate('.remove-ranking', 'click', function(e, target) {
            var period = target.dataset.period;
            var teamId = TeamUI.getModalTeamId();
            if (period && teamId && confirm('Remove this ranking entry?')) {
                TeamCore.removeRanking(teamId, period).then(function(result) {
                    if (result && result.success) {
                        refreshRankingListInPlace(teamId);
                        refreshUI();
                    }
                }).catch(function(err) {
                    console.warn('[TeamEvents] removeRanking failed:', err);
                    notify('Failed to remove ranking.', 'error');
                });
            }
        });
    }

    function addRankingFromModal() {
        var teamId = TeamUI.getModalTeamId();
        if (!teamId) {
            notify('No team selected.', 'error');
            return;
        }

        var modal = document.getElementById('ranking-modal');
        if (!modal) return;

        var periodEl = modal.querySelector('#ranking-period');
        var rankEl = modal.querySelector('#ranking-rank');

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

        TeamCore.addRanking(teamId, period, rank).then(function(result) {
            if (!result || !result.success) {
                return;
            }

            if (periodEl) periodEl.value = '';
            if (rankEl) rankEl.value = '';

            refreshRankingListInPlace(teamId);
            refreshUI();
        }).catch(function(err) {
            console.warn('[TeamEvents] addRanking failed:', err);
            notify('Failed to add ranking.', 'error');
        });
    }

    function refreshRankingListInPlace(teamId) {
        var vm = TeamAggregator.getRankingModalViewModel(teamId);
        if (!vm) return;

        var modal = document.getElementById('ranking-modal');
        if (!modal) return;

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
                    // No year filter.
                    TeamUI.setFilter(tab, 'filterYear', '');
                } else if (!isNaN(yearNum) && yearNum >= 1) {
                    TeamUI.setFilter(tab, 'filterYear', yearNum);
                }
                // Invalid input: leave the previous filter in place.
            }
        }

        var inactiveEl = _container.querySelector('#' + tab + '-show-inactive');
        if (inactiveEl) {
            TeamUI.setFilter(tab, 'filterStatus', inactiveEl.checked ? 'inactive' : 'active');
        }

        refreshUI();
    }

    // ============================================================
    // NAME HISTORY ADD / REMOVE
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
    // ESCAPING (only used to build small option lists in-place)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttr(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamEvents = {
        init: init,
        destroy: destroy,

        refreshUI: refreshUI,

        // Modal controls (exposed for external use)
        showTeamForm: showTeamForm,
        closeTeamForm: closeTeamForm,
        showMemberModal: showMemberModal,
        closeMemberModal: closeMemberModal,
        showRankingModal: showRankingModal,
        closeRankingModal: closeRankingModal
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamEvents;
        var missing = [];

        var required = [
            'init', 'destroy', 'refreshUI',
            'showTeamForm', 'closeTeamForm',
            'showMemberModal', 'closeMemberModal',
            'showRankingModal', 'closeRankingModal'
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
