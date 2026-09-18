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
 * MEMBER INTERVALS (v24):
 *   A team member entry carries an `intervals` array. Editing a
 *   member's period is really "editing one interval." Every row in
 *   the member manager is scoped to a specific interval by
 *   data-character-id + data-join-period.
 *
 * MODAL LIFECYCLE:
 *   Modal shells are declared in TeamRender.getModalsHTML() and
 *   inserted on every full-page render. Modal lifecycle (backdrop
 *   click, escape key, focus trap, focus restore) is owned by
 *   window.Modal. Show modals by calling Modal.modalSetup(modal)
 *   followed by Modal.showModal(modal). Do not roll your own show
 *   path — that bypasses the lifecycle and leaves modals stuck open.
 *
 * MEMBER MANAGER (BUG-E13 OVERHAUL):
 *   The professional member manager has been rewritten to share the
 *   academic member manager's visual language and feature set. Both
 *   managers now emit the same markup — .member-entry-block,
 *   .member-entry-header, .member-interval-row, .member-interval-
 *   bounds, .member-interval-actions, .member-form — and both
 *   support:
 *
 *     - Inline Join / Leave editing per stint
 *     - Multiple stints per member (add stint, remove stint)
 *     - Remove-member (whole entry) and Remove-stint (one interval)
 *     - Former-members section with a Restore modal offering two
 *       paths (correct the leave period, or reopen with a new
 *       interval)
 *     - Role editing inline in the member header
 *     - Batched Save: all dirty stint rows and role inputs commit
 *       in one user gesture
 *     - Revert (discard uncommitted edits) and Close
 *
 *   The two managers remain independent. This one is container-
 *   based and uses TeamCore mutations; the academic one uses
 *   AcademyWeeklyTeams mutations. They share markup, not code.
 *
 *   LEAVE NOW (academic only):
 *     The academic manager has a per-row "Leave Now" button that
 *     sets the active stint's leave to the display week. The
 *     professional manager does NOT have this button. Professional
 *     periods are years; a year-wide period has no meaningful
 *     "now" for a single-week action. The user sets the Leave year
 *     directly in the input.
 *
 * EXTERNAL ENTRY POINT:
 *   openMemberManager(container, teamId, period, options)
 *
 *   Renders into a container the caller owns, wires the add /
 *   remove / edit buttons to TeamCore directly, and re-renders in
 *   place after mutations. It does not use TeamUI, it does not
 *   require the Teams tab to be mounted.
 *
 * CLOSE SEMANTICS (external entry point):
 *   The caller owns the modal shell. This module does not call
 *   Modal.closeModal / hideModal for that instance. Instead, the
 *   close handlers invoke the caller-supplied `options.onClose`
 *   callback.
 *
 * DEPENDENCIES:
 *   - window.TeamCore       (MANDATORY)
 *   - window.TeamAggregator (MANDATORY)
 *   - window.TeamUI         (MANDATORY)
 *   - window.TeamRender     (MANDATORY)
 *   - window.Modal          (MANDATORY)
 *   - window.NotificationSystem (MANDATORY)
 *   - window.DomUtils       (MANDATORY)
 *   - window.CharacterQueries (OPTIONAL, used by the external
 *     entry point to display names in the add-member picker)
 *
 * USAGE:
 *   var TE = window.TeamEvents;
 *   TE.init(container);
 *   TE.destroy();
 *
 *   // External caller:
 *   var content = document.querySelector('.modal-content');
 *   var manager = TE.openMemberManager(content, 'team_123', 2025, {
 *       onClose: function() { Modal.closeModal(modal); },
 *       onMutation: function() { refreshAcademyView(); }
 *   });
 *   // later:
 *   manager.close();
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
        if (!TeamCore || typeof TeamCore.addMemberInterval !== 'function') {
            missing.push('TeamCore.addMemberInterval');
        }
        if (!TeamCore || typeof TeamCore.removeMember !== 'function') {
            missing.push('TeamCore.removeMember');
        }
        if (!TeamCore || typeof TeamCore.updateMember !== 'function') {
            missing.push('TeamCore.updateMember');
        }
        if (!TeamCore || typeof TeamCore.endMemberInterval !== 'function') {
            missing.push('TeamCore.endMemberInterval');
        }
        if (!TeamCore || typeof TeamCore.reopenMemberInterval !== 'function') {
            missing.push('TeamCore.reopenMemberInterval');
        }
        if (!TeamCore || typeof TeamCore.purgeMemberInterval !== 'function') {
            missing.push('TeamCore.purgeMemberInterval');
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
        if (!TeamRender || typeof TeamRender.renderMemberList !== 'function') {
            missing.push('TeamRender.renderMemberList');
        }
        if (!TeamRender || typeof TeamRender.renderMemberForm !== 'function') {
            missing.push('TeamRender.renderMemberForm');
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

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttr(value) {
        return DomUtils.escapeAttribute(value);
    }

    /**
     * Parse a strict positive integer. Returns null on any
     * malformed input. Used for period parsing in the manager.
     */
    function parsePeriodStrict(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        if (typeof value === 'number') {
            if (!Number.isInteger(value)) return null;
            if (value < 1) return null;
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) return null;
            var n = Number(trimmed);
            if (!Number.isInteger(n) || n < 1) return null;
            return n;
        }
        return null;
    }

    function parseOptionalPeriodInput(raw) {
        if (raw === undefined || raw === null) {
            return { ok: true, value: '' };
        }
        var str = String(raw).trim();
        if (str === '') {
            return { ok: true, value: '' };
        }
        var parsed = parsePeriodStrict(str);
        if (parsed === null) {
            return { ok: false };
        }
        return { ok: true, value: String(parsed) };
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
        bindMemberModal();
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

        var modal = document.getElementById('team-form-modal');
        if (!modal) {
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
    // MEMBER MODAL (Teams tab) — simple add/edit/remove
    // ============================================================
    //
    // This is the compact modal opened by .manage-members when the
    // Teams tab is mounted. It uses TeamRender.renderMemberList
    // (the compact list renderer) and TeamRender.renderMemberForm
    // (the single-interval editor).
    //
    // The full-featured manager (inline stint editing, batched
    // Save, former members, Restore) is the container-based
    // openMemberManager below. Callers that want that manager pass
    // their own container and open it directly.

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

        var roleEl = modal.querySelector('#member-role');
        if (roleEl) roleEl.value = '';
        var joinEl = modal.querySelector('#member-join');
        if (joinEl) joinEl.value = '';
        var leaveEl = modal.querySelector('#member-leave');
        if (leaveEl) leaveEl.value = '';

        var listContainer = modal.querySelector('#members-list');
        if (listContainer) {
            listContainer.innerHTML = TeamRender.renderMemberList(vm);
        }

        TeamUI.setModalTeamId(teamId);

        showModal(modal);
    }

    function populateMemberCandidates(modal, candidates) {
        var select = modal.querySelector('#member-character');
        if (!select) return;

        var html = '<option value="">Select character...</option>';
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];

            var label = c.name;
            if (c.deceased === true) {
                label += ' \u2020';
            }

            html += '<option value="' + escapeAttr(c.id) + '">' +
                        escapeHtml(label) +
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

        delegate('.remove-member', 'click', function(e, target) {
            e.preventDefault();

            var charId = target.dataset.characterId;
            var joinPeriod = target.dataset.joinPeriod;
            var teamId = TeamUI.getModalTeamId();
            if (!teamId || !charId) return;

            if (!confirm('Remove this stint from the team?')) {
                return;
            }

            if (!isNonEmptyString(joinPeriod)) {
                notify('This row does not identify a specific stint.', 'error');
                return;
            }

            TeamCore.purgeMemberInterval(teamId, charId, joinPeriod)
                .then(function(result) {
                    if (result && result.success) {
                        refreshMemberListInPlace(teamId);
                        refreshUI();
                    }
                })
                .catch(function(err) {
                    console.warn('[TeamEvents] purgeMemberInterval failed:', err);
                    notify('Failed to remove stint.', 'error');
                });
        });

        delegate('.remove-member-entry', 'click', function(e, target) {
            e.preventDefault();

            var charId = target.dataset.characterId;
            var teamId = TeamUI.getModalTeamId();
            if (!teamId || !charId) return;

            if (!confirm('Remove this member entirely (all stints)?')) {
                return;
            }

            TeamCore.removeMember(teamId, charId)
                .then(function(result) {
                    if (result && result.success) {
                        refreshMemberListInPlace(teamId);
                        refreshUI();
                    }
                })
                .catch(function(err) {
                    console.warn('[TeamEvents] removeMember failed:', err);
                    notify('Failed to remove member.', 'error');
                });
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

        populateMemberCandidates(modal, vm.candidates);
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
    // EXTERNAL ENTRY POINT — MEMBER MANAGER
    // ============================================================
    //
    // Container-based. Does not use TeamUI. Does not require the
    // Teams tab to be mounted.
    //
    // MARKUP CONTRACT (post BUG-E13):
    //   The emitted HTML uses the same class names as the academic
    //   member manager in academy-weekly-teams-members.js:
    //
    //     .member-entry.member-entry-block
    //     .member-entry-header
    //     .member-entry-name
    //     .member-entry-role        (editable input)
    //     .member-entry-status
    //     .member-entry-remove
    //     .member-interval-row
    //     .member-interval-left
    //     .member-interval-bounds
    //     .member-join / .member-leave
    //     .member-interval-input
    //     .member-interval-actions
    //     .member-interval-remove
    //     .member-interval-former
    //     .member-interval-restore
    //     .member-form              (add-member flex row)
    //     .member-manager-footer
    //     .member-inline-add-host / .member-inline-add-form
    //
    //   Both managers render the same DOM. They differ only in
    //   which mutation module they call:
    //
    //     Academic → AcademyWeeklyTeams.addMemberInterval,
    //                AcademyWeeklyTeams.updateMemberWindows,
    //                AcademyWeeklyTeams.purgeMemberRecords,
    //                AcademyWeeklyTeams.removeMemberEntry,
    //                AcademyWeeklyTeams.setLeaveAtWeek
    //
    //     Professional → TeamCore.addMemberInterval,
    //                    TeamCore.endMemberInterval,
    //                    TeamCore.reopenMemberInterval,
    //                    TeamCore.purgeMemberInterval,
    //                    TeamCore.removeMember,
    //                    TeamCore.updateMember
    //
    //   Both managers support the same features:
    //     - Inline Join / Leave editing per stint
    //     - Multiple stints per member (add / remove)
    //     - Role editing inline in the header
    //     - Former-members section with Restore-with-two-options
    //     - Batched Save / Revert / Close
    //
    //   The professional manager does NOT have a "Leave Now"
    //   button. Professional periods are years; the display period
    //   is a year-wide filter, so "leave now" would not name a
    //   specific week. The user edits the Leave year directly.
    //
    // The manager maintains its own working state across the
    // lifetime of the open session. The caller owns the container;
    // this function owns everything inside it.

    function openMemberManager(container, teamId, period, options) {
        if (!container || !isNonEmptyString(teamId)) {
            return null;
        }

        options = options || {};
        var onClose = (typeof options.onClose === 'function')
            ? options.onClose
            : null;
        var onMutation = (typeof options.onMutation === 'function')
            ? options.onMutation
            : null;

        var periodNum = parsePeriodStrict(period);

        var disposed = false;
        var clickHandler = null;
        var currentVM = null;
        var formerMembersVM = [];

        function invokeOnClose() {
            if (typeof onClose === 'function') {
                try { onClose(); } catch (e) {
                    console.warn('[TeamEvents] onClose threw:', e);
                }
            }
        }

        function invokeOnMutation() {
            if (typeof onMutation === 'function') {
                try { onMutation(); } catch (e) {
                    console.warn('[TeamEvents] onMutation threw:', e);
                }
            }
        }

        // --------------------------------------------------------
        // VM fetch
        // --------------------------------------------------------
        //
        // We use getMemberModalViewModel for the current members
        // and candidates. Former members are computed here from
        // the raw team record, because the aggregator does not
        // currently surface them on the professional side.
        //
        // "Former" means: a member entry whose active intervals do
        // NOT contain the display period, but which has at least
        // one interval with a leavePeriod strictly less than the
        // display period.

        function fetchVM() {
            var vm = TeamAggregator.getMemberModalViewModel(teamId, periodNum);
            if (!vm) {
                return null;
            }

            // Rebuild members and former members from the same
            // source. getMemberModalViewModel gives us the active
            // members via getTeamMembersViewModel; we need all
            // members to partition. Ask the raw team.
            var team = null;
            if (window.TeamQueries &&
                typeof window.TeamQueries.getTeamById === 'function') {
                team = window.TeamQueries.getTeamById(teamId);
            }

            var partition = partitionMembers(team, periodNum);

            return {
                teamId: vm.teamId,
                teamName: vm.teamName,
                teamClassId: vm.teamClassId,
                period: vm.period,
                members: partition.active,
                formerMembers: partition.former,
                candidates: vm.candidates
            };
        }

        function partitionMembers(team, periodNumValue) {
            var active = [];
            var former = [];

            if (!team || !Array.isArray(team.members)) {
                return { active: active, former: former };
            }

            var activeIds = Object.create(null);
            var activeRecords = [];
            if (window.TeamQueries &&
                typeof window.TeamQueries.getActiveTeamMembers === 'function' &&
                periodNumValue !== null) {
                activeRecords = window.TeamQueries.getActiveTeamMembers(
                    team, periodNumValue
                ) || [];
            }
            for (var i = 0; i < activeRecords.length; i++) {
                var r = activeRecords[i];
                if (r && r.characterId) {
                    activeIds[String(r.characterId)] = true;
                }
            }

            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];
                if (!member || !member.characterId) { continue; }

                var charId = String(member.characterId);
                var memberVM = buildMemberVMLocal(member, periodNumValue);

                if (activeIds[charId]) {
                    active.push(memberVM);
                    continue;
                }

                // Former: has at least one interval with a leave
                // period strictly before the display period.
                var isFormer = false;
                if (Array.isArray(member.intervals) && periodNumValue !== null) {
                    for (var iv = 0; iv < member.intervals.length; iv++) {
                        var interval = member.intervals[iv];
                        if (!interval) { continue; }
                        var lv = parseInt(interval.leavePeriod, 10);
                        if (!isNaN(lv) && lv < periodNumValue) {
                            isFormer = true;
                            break;
                        }
                    }
                }

                if (isFormer) {
                    former.push(memberVM);
                }
            }

            return { active: active, former: former };
        }

        function buildMemberVMLocal(member, periodNumValue) {
            var summary = {
                id: member.characterId,
                name: 'Unknown',
                status: ''
            };
            var char = null;
            if (window.CharacterQueries &&
                typeof window.CharacterQueries.getCharacterById === 'function') {
                char = window.CharacterQueries.getCharacterById(member.characterId);
            }
            if (char && window.CharacterQueries.getDisplayName) {
                summary.name = window.CharacterQueries.getDisplayName(char);
            }
            if (char && window.CharacterQueries.getCurrentStatus) {
                summary.status = window.CharacterQueries.getCurrentStatus(char);
            }

            var intervals = [];
            if (Array.isArray(member.intervals)) {
                for (var i = 0; i < member.intervals.length; i++) {
                    var iv = member.intervals[i];
                    if (!iv || typeof iv !== 'object') { continue; }

                    var joinStr = (iv.joinPeriod === undefined ||
                                   iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    var leaveStr = (iv.leavePeriod === undefined ||
                                    iv.leavePeriod === null)
                        ? ''
                        : String(iv.leavePeriod);

                    var periodDisplay = '';
                    if (joinStr || leaveStr) {
                        periodDisplay = (joinStr || '\u2014') +
                            ' \u2013 ' + (leaveStr || '\u2014');
                    }

                    var activeAt = false;
                    if (periodNumValue !== null) {
                        var jn = parseInt(joinStr, 10);
                        var lv = parseInt(leaveStr, 10);
                        var ok = true;
                        if (!isNaN(jn) && periodNumValue < jn) { ok = false; }
                        if (!isNaN(lv) && periodNumValue > lv) { ok = false; }
                        activeAt = ok;
                    }

                    intervals.push({
                        joinPeriod: joinStr,
                        leavePeriod: leaveStr,
                        periodDisplay: periodDisplay,
                        activeAtPeriod: activeAt
                    });
                }
            }

            return {
                characterId: member.characterId,
                memberId: member.memberId || '',
                name: summary.name,
                status: summary.status,
                statusLabel: summary.status,
                role: member.role || 'Member',
                deceased: char && char.deceased === true,
                intervals: intervals
            };
        }

        // --------------------------------------------------------
        // Render
        // --------------------------------------------------------

        function render() {
            if (disposed || !container.parentNode) {
                return;
            }

            var vm = fetchVM();
            currentVM = vm;

            if (!vm) {
                container.innerHTML = renderManagerBody({
                    teamId: teamId,
                    teamName: 'Team',
                    period: periodNum,
                    members: [],
                    formerMembers: [],
                    candidates: []
                }, { notFound: true });
                bindEvents(container);
                return;
            }

            formerMembersVM = vm.formerMembers;

            container.innerHTML = renderManagerBody(vm, { notFound: false });
            bindEvents(container);
        }

        function bindEvents(rootEl) {
            if (clickHandler) {
                rootEl.removeEventListener('click', clickHandler);
            }
            clickHandler = function(e) {
                var target = e.target.closest('[data-action]');
                if (!target) return;
                var action = target.dataset.action;
                switch (action) {
                    case 'temm-close':
                        e.preventDefault();
                        close();
                        return;
                    case 'temm-save':
                        e.preventDefault();
                        handleSaveAll();
                        return;
                    case 'temm-revert':
                        e.preventDefault();
                        handleRevert();
                        return;
                    case 'temm-add':
                        e.preventDefault();
                        handleAdd();
                        return;
                    case 'temm-remove-member':
                        e.preventDefault();
                        handleRemoveMember(target);
                        return;
                    case 'temm-remove-interval':
                        e.preventDefault();
                        handleRemoveInterval(target);
                        return;
                    case 'temm-add-stint':
                        e.preventDefault();
                        handleAddStint(target);
                        return;
                    case 'temm-restore':
                        e.preventDefault();
                        handleOpenRestore(target);
                        return;
                    case 'temm-inline-add':
                        e.preventDefault();
                        handleInlineStintAdd(target);
                        return;
                    case 'temm-inline-cancel':
                        e.preventDefault();
                        handleInlineStintCancel(target);
                        return;
                    default:
                        return;
                }
            };
            rootEl.addEventListener('click', clickHandler);
        }

        // --------------------------------------------------------
        // Save all — batched
        // --------------------------------------------------------

        function handleSaveAll() {
            if (!currentVM) { return; }

            var rows = container.querySelectorAll('.member-interval-row');
            var stintChanges = [];
            var roleChanges = [];
            var invalidMessage = null;
            var overlapMessage = null;

            // ---- Role inputs ----
            var roleInputs = container.querySelectorAll(
                '[data-role="temm-role-input"]'
            );
            for (var r = 0; r < roleInputs.length; r++) {
                var roleInput = roleInputs[r];
                var block = roleInput.closest('.member-entry-block');
                if (!block) continue;

                var charIdR = block.dataset.characterId;
                var newRole = roleInput.value.trim();
                var initialRole = roleInput.dataset.initialRole || '';

                if (newRole === initialRole) continue;

                roleChanges.push({
                    characterId: charIdR,
                    role: newRole
                });
            }

            // ---- Stint rows ----
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];

                if (row.classList.contains('member-interval-former')) {
                    continue;
                }

                var leaveInput = row.querySelector('.temm-leave-input');
                if (!leaveInput) { continue; }

                var leaveRaw = leaveInput.value;
                var initialLeave = row.dataset.initialLeave || '';
                var joinPeriod = row.dataset.joinPeriod || '';
                var rowCharId = row.dataset.characterId || '';

                var leaveParse = parseOptionalPeriodInput(leaveRaw);
                if (!leaveParse.ok) {
                    invalidMessage =
                        'Leave period must be blank or a positive integer.';
                    break;
                }

                var leaveCanonical = leaveParse.value;
                if (leaveCanonical === initialLeave) {
                    continue;
                }

                if (joinPeriod !== '' && leaveCanonical !== '') {
                    var jn = parseInt(joinPeriod, 10);
                    var lv = parseInt(leaveCanonical, 10);
                    if (!isNaN(jn) && !isNaN(lv) && lv < jn) {
                        invalidMessage =
                            'Leave cannot be before Join (' + lv +
                            ' < ' + jn + ').';
                        break;
                    }
                }

                var member = findMemberVM(rowCharId);
                if (member) {
                    var proposed = {
                        joinPeriod: joinPeriod,
                        leavePeriod: leaveCanonical
                    };
                    var conflict = wouldOverlap(member, joinPeriod, proposed);
                    if (conflict) {
                        overlapMessage =
                            'Leave period ' + leaveCanonical + ' for ' +
                            (member.name || 'this member') +
                            ' overlaps an existing stint (join ' +
                            (conflict.joinPeriod || '\u2014') + ').';
                        break;
                    }
                }

                stintChanges.push({
                    characterId: rowCharId,
                    joinPeriod: joinPeriod,
                    leavePeriod: leaveCanonical
                });
            }

            if (invalidMessage) {
                notify(invalidMessage, 'error');
                return;
            }
            if (overlapMessage) {
                notify(overlapMessage, 'error');
                return;
            }

            if (stintChanges.length === 0 && roleChanges.length === 0) {
                notify('No changes to save.', 'info');
                return;
            }

            // ---- Commit ----
            //
            // Two-phase chain:
            //   1. Role changes → TeamCore.updateMember(teamId, charId, { role })
            //   2. Stint changes → sequential endMemberInterval /
            //      reopenMemberInterval calls, one per changed row.
            //
            // Role changes go first. If a role change fails, the
            // whole save aborts and the modal stays open.
            //
            // The stint changes need to be dispatched one at a time
            // because TeamCore exposes per-interval mutations
            // (endMemberInterval, reopenMemberInterval) rather than
            // a bulk "set these leaves" call. Sequential dispatch
            // through the pipeline is fine — the pipeline serialises
            // anyway.

            var chain = Promise.resolve();
            var failed = false;

            roleChanges.forEach(function(rc) {
                chain = chain.then(function() {
                    if (failed) return;
                    return TeamCore.updateMember(
                        teamId, rc.characterId, { role: rc.role }
                    ).then(function(result) {
                        if (!result || !result.success) {
                            failed = true;
                        }
                    });
                });
            });

            stintChanges.forEach(function(sc) {
                chain = chain.then(function() {
                    if (failed) return;

                    if (sc.leavePeriod === '') {
                        return TeamCore.reopenMemberInterval(
                            teamId, sc.characterId, sc.joinPeriod
                        ).then(function(result) {
                            if (!result || !result.success) {
                                failed = true;
                            }
                        });
                    }
                    return TeamCore.endMemberInterval(
                        teamId, sc.characterId, sc.joinPeriod, sc.leavePeriod
                    ).then(function(result) {
                        if (!result || !result.success) {
                            failed = true;
                        }
                    });
                });
            });

            chain.then(function() {
                if (failed) {
                    return;
                }
                render();
                invokeOnMutation();
            }).catch(function(err) {
                console.warn('[TeamEvents] save-all failed:', err);
                notify('Failed to save changes.', 'error');
            });
        }

        function findMemberVM(charId) {
            if (!currentVM) { return null; }
            var target = String(charId);

            var list = currentVM.members || [];
            for (var i = 0; i < list.length; i++) {
                if (String(list[i].characterId) === target) {
                    return list[i];
                }
            }
            var former = formerMembersVM || [];
            for (var j = 0; j < former.length; j++) {
                if (String(former[j].characterId) === target) {
                    return former[j];
                }
            }
            return null;
        }

        function handleRevert() {
            render();
        }

        // --------------------------------------------------------
        // Add member
        // --------------------------------------------------------

        function handleAdd() {
            var select = container.querySelector('.member-form-select');
            var charId = select ? select.value : '';
            if (!charId) {
                notify('Select a character to add.', 'error');
                return;
            }

            var roleInput = container.querySelector('.member-form-role');
            var joinInput = container.querySelector('.member-form-join');
            var leaveInput = container.querySelector('.member-form-leave');

            var role = roleInput ? roleInput.value.trim() : '';
            var joinRaw = joinInput ? joinInput.value.trim() : '';
            var leaveRaw = leaveInput ? leaveInput.value.trim() : '';

            var joinParsed = joinRaw === ''
                ? periodNum
                : parsePeriodStrict(joinRaw);
            if (joinParsed === null) {
                notify('Join period must be a positive integer.', 'error');
                return;
            }

            var leaveParsed = parseOptionalPeriodInput(leaveRaw);
            if (!leaveParsed.ok) {
                notify(
                    'Leave period must be blank or a positive integer.',
                    'error'
                );
                return;
            }

            if (leaveParsed.value !== '' &&
                parseInt(leaveParsed.value, 10) < joinParsed) {
                notify('Leave cannot be before join.', 'error');
                return;
            }

            TeamCore.addMemberInterval(
                teamId, charId, String(joinParsed), leaveParsed.value
            ).then(function(result) {
                if (result && result.success) {
                    // If a role was provided, dispatch a role update
                    // as a follow-up.
                    if (role) {
                        return TeamCore.updateMember(
                            teamId, charId, { role: role }
                        );
                    }
                    return null;
                }
                return null;
            }).then(function() {
                render();
                invokeOnMutation();
            }).catch(function(err) {
                console.warn('[TeamEvents] addMemberInterval failed:', err);
                notify('Failed to add member.', 'error');
            });
        }

        // --------------------------------------------------------
        // Remove member (whole entry)
        // --------------------------------------------------------

        function handleRemoveMember(btn) {
            var charId = btn.dataset.characterId;
            if (!charId) { return; }

            var member = findMemberVM(charId);
            var name = member && member.name ? member.name : 'this member';

            if (!confirm(
                'Remove ' + name + ' entirely (all stints)?\n\n' +
                'This deletes the member\'s history on this team.'
            )) {
                return;
            }

            TeamCore.removeMember(teamId, charId)
                .then(function(result) {
                    if (result && result.success) {
                        render();
                        invokeOnMutation();
                    }
                })
                .catch(function(err) {
                    console.warn('[TeamEvents] removeMember failed:', err);
                    notify('Failed to remove member.', 'error');
                });
        }

        // --------------------------------------------------------
        // Remove interval (one stint)
        // --------------------------------------------------------

        function handleRemoveInterval(btn) {
            var charId = btn.dataset.characterId;
            var joinPeriod = btn.dataset.joinPeriod;
            if (!charId) { return; }

            if (joinPeriod === undefined || joinPeriod === null) {
                joinPeriod = '';
            }

            var member = findMemberVM(charId);
            var name = member && member.name ? member.name : 'this member';

            if (!confirm(
                'Remove this stint from ' + name + '?\n\n' +
                'If it is the last stint, the member is removed from the team.'
            )) {
                return;
            }

            TeamCore.purgeMemberInterval(teamId, charId, joinPeriod)
                .then(function(result) {
                    if (result && result.success) {
                        render();
                        invokeOnMutation();
                    }
                })
                .catch(function(err) {
                    console.warn('[TeamEvents] purgeMemberInterval failed:', err);
                    notify('Failed to remove stint.', 'error');
                });
        }

        // --------------------------------------------------------
        // Add stint (inline form)
        // --------------------------------------------------------

        function handleAddStint(btn) {
            var block = btn.closest('.member-entry-block');
            if (!block) { return; }

            var host = block.querySelector('.member-inline-add-host');
            if (!host) { return; }

            var charId = block.dataset.characterId;
            var memberId = block.dataset.memberId || '';

            var existing = host.querySelector('.member-inline-add-form');
            if (existing) {
                var existingJoin = existing.querySelector('.member-inline-add-join');
                if (existingJoin) { existingJoin.focus(); }
                return;
            }

            var member = findMemberVM(charId);
            var suggestion = suggestNextJoinPeriod(member);

            var html = '';
            html += '<div class="member-inline-add-form" ' +
                        'data-character-id="' + escapeAttr(charId) + '" ' +
                        'data-member-id="' + escapeAttr(memberId) + '">';
            html += '<label class="member-inline-add-label">Join</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input member-inline-add-join" ' +
                        'min="1" ' +
                        'value="' + escapeAttr(String(suggestion)) + '" ' +
                        'placeholder="Required">';
            html += '<label class="member-inline-add-label">Leave</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input member-inline-add-leave" ' +
                        'min="1" ' +
                        'placeholder="\u2014">';
            html += '<button type="button" ' +
                        'class="small primary" ' +
                        'data-action="temm-inline-add">Add</button>';
            html += '<button type="button" ' +
                        'class="small secondary" ' +
                        'data-action="temm-inline-cancel">Cancel</button>';
            html += '</div>';

            btn.style.display = 'none';
            host.insertAdjacentHTML('beforeend', html);

            var joinInput = host.querySelector('.member-inline-add-join');
            if (joinInput) { joinInput.focus(); }
        }

        function suggestNextJoinPeriod(member) {
            if (!member || !Array.isArray(member.intervals) ||
                member.intervals.length === 0) {
                return periodNum !== null ? periodNum : 1;
            }

            var latestLeave = 0;
            for (var i = 0; i < member.intervals.length; i++) {
                var iv = member.intervals[i];
                if (!iv) continue;
                var lv = parseInt(iv.leavePeriod, 10);
                if (!isNaN(lv) && lv > latestLeave) {
                    latestLeave = lv;
                }
            }

            if (latestLeave > 0) {
                return latestLeave + 1;
            }

            return periodNum !== null ? periodNum : 1;
        }

        function handleInlineStintCancel(btn) {
            var form = btn.closest('.member-inline-add-form');
            if (!form) { return; }

            var block = form.closest('.member-entry-block');
            if (!block) { return; }

            form.remove();
            var addBtn = block.querySelector('.member-inline-add-btn');
            if (addBtn) {
                addBtn.style.display = '';
            }
        }

        function handleInlineStintAdd(btn) {
            var form = btn.closest('.member-inline-add-form');
            if (!form) { return; }

            var block = form.closest('.member-entry-block');
            if (!block) { return; }

            var charId = block.dataset.characterId;

            var joinInput = form.querySelector('.member-inline-add-join');
            var leaveInput = form.querySelector('.member-inline-add-leave');

            var joinParsed = parsePeriodStrict(joinInput ? joinInput.value : '');
            if (joinParsed === null) {
                notify('Join period must be a positive integer.', 'error');
                return;
            }

            var leaveParsed = parseOptionalPeriodInput(
                leaveInput ? leaveInput.value : ''
            );
            if (!leaveParsed.ok) {
                notify(
                    'Leave period must be blank or a positive integer.',
                    'error'
                );
                return;
            }

            if (leaveParsed.value !== '' &&
                parseInt(leaveParsed.value, 10) < joinParsed) {
                notify('Leave cannot be before join.', 'error');
                return;
            }

            var member = findMemberVM(charId);
            var proposed = {
                joinPeriod: String(joinParsed),
                leavePeriod: leaveParsed.value
            };
            if (member) {
                var conflict = wouldOverlap(member, '', proposed);
                if (conflict) {
                    notify(
                        'This stint would overlap an existing one ' +
                        '(join ' + (conflict.joinPeriod || '\u2014') +
                        ', leave ' + (conflict.leavePeriod || '\u2014') + ').',
                        'error'
                    );
                    return;
                }
            }

            TeamCore.addMemberInterval(
                teamId, charId, String(joinParsed), leaveParsed.value
            ).then(function(result) {
                if (result && result.success) {
                    render();
                    invokeOnMutation();
                }
            }).catch(function(err) {
                console.warn('[TeamEvents] addMemberInterval failed:', err);
                notify('Failed to add stint.', 'error');
            });
        }

        // --------------------------------------------------------
        // Restore
        // --------------------------------------------------------

        function handleOpenRestore(btn) {
            var charId = btn.dataset.characterId;
            var memberId = btn.dataset.memberId;
            var joinPeriod = btn.dataset.joinPeriod;
            var leavePeriod = btn.dataset.leavePeriod;

            if (!charId) { return; }

            openRestoreModal({
                characterId: charId,
                memberId: memberId || '',
                joinPeriod: joinPeriod || '',
                leavePeriod: leavePeriod || ''
            });
        }

        function openRestoreModal(info) {
            var modal = Modal.createModal('team-member-restore-modal');
            if (!modal) {
                notify('Could not open restore dialog.', 'error');
                return;
            }

            var contentEl = document.createElement('div');
            contentEl.className = 'modal-content';
            contentEl.innerHTML = buildRestoreFormHTML(info);
            modal.appendChild(contentEl);

            Modal.modalSetup(modal);
            Modal.showModal(modal);

            var close = function() {
                try {
                    if (typeof Modal.closeModal === 'function') {
                        Modal.closeModal(modal);
                    } else if (typeof Modal.hideModal === 'function') {
                        Modal.hideModal(modal);
                    }
                } catch (e) {
                    console.warn('[TeamEvents] restore modal close failed:', e);
                }
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
            };

            var closeBtn = modal.querySelector('.close-modal');
            if (closeBtn) { closeBtn.addEventListener('click', close); }

            var cancelBtn = modal.querySelector('.cancel-modal-btn');
            if (cancelBtn) { cancelBtn.addEventListener('click', close); }

            modal.addEventListener('click', function(ev) {
                if (ev.target === modal) { close(); }
            });

            var form = modal.querySelector('#team-member-restore-form');
            if (!form) { return; }

            form.addEventListener('submit', function(ev) {
                ev.preventDefault();

                var modeInput = form.querySelector(
                    'input[name="team-restore-mode"]:checked'
                );
                var modeValue = modeInput ? modeInput.value : '';

                if (modeValue === 'correct') {
                    handleRestoreCorrect(form, info, close);
                    return;
                }
                if (modeValue === 'new') {
                    handleRestoreNew(form, info, close);
                    return;
                }
            });
        }

        function handleRestoreCorrect(form, info, close) {
            var leaveInput = form.querySelector('.team-restore-leave-input');
            var leaveRaw = leaveInput ? leaveInput.value : '';

            var parsed = parseOptionalPeriodInput(leaveRaw);
            if (!parsed.ok) {
                notify(
                    'Leave period must be blank or a positive integer.',
                    'error'
                );
                return;
            }

            // Reopening an interval in-place: if the new leave is
            // blank, use reopenMemberInterval. If the new leave is
            // set, use endMemberInterval.
            var promise;
            if (parsed.value === '') {
                promise = TeamCore.reopenMemberInterval(
                    teamId, info.characterId, info.joinPeriod
                );
            } else {
                promise = TeamCore.endMemberInterval(
                    teamId, info.characterId, info.joinPeriod, parsed.value
                );
            }

            promise.then(function(result) {
                if (result && result.success) {
                    close();
                    render();
                    invokeOnMutation();
                }
            }).catch(function(err) {
                console.warn('[TeamEvents] restore (correct) failed:', err);
                notify('Failed to restore member.', 'error');
            });
        }

        function handleRestoreNew(form, info, close) {
            var joinInput = form.querySelector('.team-restore-join-input');
            var newLeaveInput = form.querySelector('.team-restore-newleave-input');

            var joinRaw = joinInput ? joinInput.value : '';
            var newLeaveRaw = newLeaveInput ? newLeaveInput.value : '';

            var joinParsed = parsePeriodStrict(joinRaw);
            if (joinParsed === null) {
                notify(
                    'New join period must be a positive integer.',
                    'error'
                );
                return;
            }

            var newLeaveParsed = parseOptionalPeriodInput(newLeaveRaw);
            if (!newLeaveParsed.ok) {
                notify(
                    'New leave period must be blank or a positive integer.',
                    'error'
                );
                return;
            }

            if (newLeaveParsed.value !== '' &&
                parseInt(newLeaveParsed.value, 10) < joinParsed) {
                notify('Leave cannot be before join.', 'error');
                return;
            }

            var member = findMemberVM(info.characterId);
            if (member) {
                var proposed = {
                    joinPeriod: String(joinParsed),
                    leavePeriod: newLeaveParsed.value
                };
                var conflict = wouldOverlap(member, '', proposed);
                if (conflict) {
                    notify(
                        'This stint would overlap an existing one.',
                        'error'
                    );
                    return;
                }
            }

            TeamCore.addMemberInterval(
                teamId,
                info.characterId,
                String(joinParsed),
                newLeaveParsed.value
            ).then(function(result) {
                if (result && result.success) {
                    close();
                    render();
                    invokeOnMutation();
                }
            }).catch(function(err) {
                console.warn('[TeamEvents] restore (new) failed:', err);
                notify('Failed to add stint.', 'error');
            });
        }

        function buildRestoreFormHTML(info) {
            var currentLeave = isNonEmptyString(info.leavePeriod)
                ? info.leavePeriod
                : '';

            var html = '';
            html += '<form id="team-member-restore-form">';

            html += '<div class="modal-header">';
            html += '<h3>Restore Member</h3>';
            html += '<button type="button" class="close-modal">' +
                        '&times;' +
                    '</button>';
            html += '</div>';

            html += '<div class="modal-body">';

            html += '<p class="field-hint">' +
                        'Choose how to bring this member back.' +
                    '</p>';

            html += '<label class="member-restore-option">';
            html += '<input type="radio" name="team-restore-mode" ' +
                        'value="correct" checked>';
            html += '<span class="member-restore-option-body">';
            html += '<strong>Correct the leave period</strong>';
            html += '<span class="member-restore-option-hint">' +
                        'Edits this stint\'s existing window in place. ' +
                        'Use this when the leave period was recorded wrong.' +
                    '</span>';
            html += '<span class="member-restore-input-row">';
            html += '<label>Leave</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input team-restore-leave-input" ' +
                        'min="1" ' +
                        'value="' + escapeAttr(currentLeave) + '" ' +
                        'placeholder="\u2014">';
            html += '</span>';
            html += '</span>';
            html += '</label>';

            html += '<label class="member-restore-option">';
            html += '<input type="radio" name="team-restore-mode" ' +
                        'value="new">';
            html += '<span class="member-restore-option-body">';
            html += '<strong>Reopen with a new interval</strong>';
            html += '<span class="member-restore-option-hint">' +
                        'Preserves the former window and starts a fresh ' +
                        'one. Use this when they took a break and came ' +
                        'back.' +
                    '</span>';
            html += '<span class="member-restore-input-row">';
            html += '<label>Join</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input team-restore-join-input" ' +
                        'min="1" ' +
                        'value="' + escapeAttr(
                            periodNum !== null ? String(periodNum) : ''
                        ) + '">';
            html += '<label>Leave</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input team-restore-newleave-input" ' +
                        'min="1" ' +
                        'placeholder="\u2014">';
            html += '</span>';
            html += '</span>';
            html += '</label>';

            html += '<div class="form-actions">';
            html += '<button type="button" ' +
                        'class="cancel-modal-btn secondary">Cancel</button>';
            html += '<button type="submit" class="primary">Restore</button>';
            html += '</div>';

            html += '</div>';
            html += '</form>';

            return html;
        }

        function close() {
            if (disposed) return;
            disposed = true;
            if (clickHandler && container.parentNode) {
                try {
                    container.removeEventListener('click', clickHandler);
                } catch (e) {}
            }
            clickHandler = null;
            invokeOnClose();
        }

        function isOpen() {
            return !disposed && !!container.parentNode;
        }

        render();

        return {
            refresh: render,
            close: close,
            isOpen: isOpen
        };
    }

    // ============================================================
    // EXTERNAL RENDERERS (not exported)
    // ============================================================
    //
    // MARKUP CONTRACT: same class names as the academic manager in
    // academy-weekly-teams-members.js. See the docstring on
    // openMemberManager above.

    function renderManagerBody(vm, opts) {
        opts = opts || {};
        var notFound = opts.notFound === true;

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Manage Members \u2014 ' +
                    escapeHtml(vm.teamName || 'Team') +
                '</h3>';
        html += '<button type="button" ' +
                    'class="close-modal" ' +
                    'data-action="temm-close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        if (notFound) {
            html += '<p class="empty-state small">Team not found.</p>';
            html += '</div>';
            return html;
        }

        var members = Array.isArray(vm.members) ? vm.members : [];
        var formerMembers = Array.isArray(vm.formerMembers)
            ? vm.formerMembers
            : [];
        var candidates = Array.isArray(vm.candidates) ? vm.candidates : [];

        html += '<p class="field-hint">' +
                    'Edit each stint\'s Join and Leave. Add a stint to ' +
                    'record a member returning. Click Save to apply ' +
                    'every change at once.' +
                '</p>';

        // ---- Current members ----
        html += '<div class="form-group">';
        html += '<label>Current Members (' + members.length + ')</label>';

        if (members.length === 0) {
            html += '<p class="empty-state small">' +
                        'No members assigned to this team this period.' +
                    '</p>';
        } else {
            html += '<div class="member-manager-list">';
            for (var i = 0; i < members.length; i++) {
                html += renderMemberBlock(members[i]);
            }
            html += '</div>';
        }
        html += '</div>';

        // ---- Add member ----
        html += '<div class="form-group member-add-group">';
        html += '<label for="temm-member-select">Add Member</label>';

        if (candidates.length === 0) {
            html += '<p class="field-hint">' +
                        'No eligible characters available to add.' +
                    '</p>';
        } else {
            html += '<div class="member-form">';
            html += '<select id="temm-member-select" ' +
                        'class="member-form-select">';
            html += '<option value="">Select a character...</option>';
            for (var j = 0; j < candidates.length; j++) {
                var c = candidates[j];
                var label = c.name;
                if (c.deceased === true) {
                    label += ' \u2020';
                }
                html += '<option value="' + escapeAttr(c.id) + '">' +
                            escapeHtml(label) +
                        '</option>';
            }
            html += '</select>';
            html += '<input type="text" class="member-form-role" ' +
                        'placeholder="Role (optional)">';
            html += '<input type="number" class="member-form-join" ' +
                        'placeholder="Join" min="1">';
            html += '<input type="number" class="member-form-leave" ' +
                        'placeholder="Leave" min="1">';
            html += '<button type="button" ' +
                        'class="small primary member-form-add" ' +
                        'data-action="temm-add">Add</button>';
            html += '</div>';
            html += '<p class="field-hint">' +
                        'Join defaults to ' +
                        escapeHtml(
                            vm.period !== null && vm.period !== undefined
                                ? String(vm.period)
                                : 'the current period'
                        ) + ' when left blank.' +
                    '</p>';
        }
        html += '</div>';

        // ---- Former members ----
        if (formerMembers.length > 0) {
            html += '<div class="form-group member-former-group">';
            html += '<label>Former Members (' +
                        formerMembers.length + ')</label>';
            html += '<div class="member-former-list">';
            for (var k = 0; k < formerMembers.length; k++) {
                html += renderFormerMemberBlock(formerMembers[k]);
            }
            html += '</div>';
            html += '</div>';
        }

        // ---- Footer ----
        html += '<div class="form-actions member-manager-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="temm-revert">Revert</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="temm-save">Save</button>';
        html += '<button type="button" class="secondary" ' +
                    'data-action="temm-close">Close</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    function renderMemberBlock(member) {
        if (!member || !member.characterId) { return ''; }

        var memberIdAttr = escapeAttr(member.memberId || '');
        var charIdAttr = escapeAttr(member.characterId);

        var intervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

        var headerClass = 'member-entry-header';
        if (member.deceased === true) {
            headerClass += ' deceased';
        }

        var html = '';
        html += '<div class="member-entry member-entry-block" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">';

        html += '<div class="' + headerClass + '">';
        html += '<span class="member-entry-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';

        if (member.deceased === true) {
            html += '<span class="member-entry-deceased" ' +
                        'title="Deceased">\u2020</span>';
        }

        html += '<input type="text" ' +
                    'class="member-entry-role" ' +
                    'data-role="temm-role-input" ' +
                    'data-initial-role="' +
                        escapeAttr(member.role || '') + '" ' +
                    'value="' + escapeAttr(member.role || '') + '" ' +
                    'placeholder="Member">';

        if (isNonEmptyString(member.statusLabel)) {
            html += '<span class="member-entry-status">' +
                        escapeHtml(member.statusLabel) +
                    '</span>';
        }

        html += '<button type="button" ' +
                    'class="small danger member-entry-remove" ' +
                    'data-action="temm-remove-member" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">' +
                    'Remove member' +
                '</button>';
        html += '</div>';

        if (intervals.length === 0) {
            html += '<div class="member-interval-empty">' +
                        'No stints recorded. Use Add stint to create one.' +
                    '</div>';
        } else {
            html += '<div class="member-interval-rows">';
            for (var i = 0; i < intervals.length; i++) {
                html += renderIntervalRow(member, intervals[i]);
            }
            html += '</div>';
        }

        html += '<div class="member-inline-add-host">';
        html += '<button type="button" ' +
                    'class="small secondary member-inline-add-btn" ' +
                    'data-action="temm-add-stint" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">' +
                    '+ Add stint' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderIntervalRow(member, interval) {
        if (!interval || typeof interval !== 'object') { return ''; }

        var charIdAttr = escapeAttr(member.characterId);
        var memberIdAttr = escapeAttr(member.memberId || '');

        var joinStr = (interval.joinPeriod === undefined ||
                       interval.joinPeriod === null)
            ? ''
            : String(interval.joinPeriod);
        var leaveStr = (interval.leavePeriod === undefined ||
                        interval.leavePeriod === null)
            ? ''
            : String(interval.leavePeriod);

        var joinAttr = escapeAttr(joinStr);
        var initialLeaveAttr = escapeAttr(leaveStr);

        var rowClass = 'member-interval-row';
        if (interval.activeAtPeriod === true) {
            rowClass += ' is-active';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '" ' +
                    'data-initial-leave="' + initialLeaveAttr + '">';

        html += '<div class="member-interval-left">';
        html += '<div class="member-interval-bounds">';

        html += '<span class="member-join">';
        html += '<label>Join</label>';
        html += '<input type="number" ' +
                    'class="member-interval-input temm-join-input" ' +
                    'min="1" ' +
                    'value="' + joinAttr + '" ' +
                    'disabled readonly ' +
                    'data-role="temm-join-input" ' +
                    'title="Join period is fixed. Remove this stint and add a new one to change it.">';
        html += '</span>';

        html += '<span class="member-leave">';
        html += '<label>Leave</label>';
        html += '<input type="number" ' +
                    'class="member-interval-input temm-leave-input" ' +
                    'min="1" ' +
                    'value="' + initialLeaveAttr + '" ' +
                    'placeholder="\u2014" ' +
                    'data-role="temm-leave-input">';
        html += '</span>';

        html += '</div>';
        html += '</div>';

        html += '<div class="member-interval-actions">';

        // No Leave Now button on the professional side. The
        // display period is a year; "leave now" would not name a
        // specific week.

        html += '<button type="button" ' +
                    'class="small danger member-interval-remove" ' +
                    'data-action="temm-remove-interval" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '" ' +
                    'title="Remove this stint">' +
                    '\u2715' +
                '</button>';

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderFormerMemberBlock(member) {
        if (!member || !member.characterId) { return ''; }

        var charIdAttr = escapeAttr(member.characterId);
        var memberIdAttr = escapeAttr(member.memberId || '');

        var intervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

        var html = '';
        html += '<div class="member-entry member-entry-block member-entry-block-former" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">';

        html += '<div class="member-entry-header">';
        html += '<span class="member-entry-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';
        html += '</div>';

        if (intervals.length === 0) {
            html += '<div class="member-interval-row member-interval-former">';
            html += '<span class="member-former-no-stints">No stints recorded.</span>';
            html += '</div>';
        } else {
            for (var i = 0; i < intervals.length; i++) {
                html += renderFormerIntervalRow(member, intervals[i]);
            }
        }

        html += '</div>';
        return html;
    }

    function renderFormerIntervalRow(member, interval) {
        if (!interval || typeof interval !== 'object') { return ''; }

        var charIdAttr = escapeAttr(member.characterId);
        var memberIdAttr = escapeAttr(member.memberId || '');

        var joinStr = (interval.joinPeriod === undefined ||
                       interval.joinPeriod === null)
            ? ''
            : String(interval.joinPeriod);
        var leaveStr = (interval.leavePeriod === undefined ||
                        interval.leavePeriod === null)
            ? ''
            : String(interval.leavePeriod);

        var display = interval.periodDisplay;
        if (!isNonEmptyString(display)) {
            display = (joinStr || '\u2014') + ' \u2013 ' +
                      (leaveStr || '\u2014');
        }

        var html = '';
        html += '<div class="member-interval-row member-interval-former" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + escapeAttr(joinStr) + '" ' +
                    'data-initial-leave="' + escapeAttr(leaveStr) + '">';

        html += '<div class="member-interval-left">';
        html += '<span class="member-former-period">' +
                    escapeHtml(display) +
                '</span>';
        html += '</div>';

        html += '<div class="member-interval-actions">';
        html += '<button type="button" ' +
                    'class="small secondary member-interval-restore" ' +
                    'data-action="temm-restore" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + escapeAttr(joinStr) + '" ' +
                    'data-leave-period="' + escapeAttr(leaveStr) + '">' +
                    'Restore' +
                '</button>';
        html += '<button type="button" ' +
                    'class="small danger member-interval-remove" ' +
                    'data-action="temm-remove-interval" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + escapeAttr(joinStr) + '" ' +
                    'title="Remove this stint">' +
                    '\u2715' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
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
        closeTeamForm: closeTeamForm,
        showMemberModal: showMemberModal,
        closeMemberModal: closeMemberModal,
        showRankingModal: showRankingModal,
        closeRankingModal: closeRankingModal,

        // External entry points (container-based)
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
            'showTeamForm', 'closeTeamForm',
            'showMemberModal', 'closeMemberModal',
            'showRankingModal', 'closeRankingModal',
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
