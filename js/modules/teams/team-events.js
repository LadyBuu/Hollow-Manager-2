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
 *   member's period is really "editing one interval." The Teams
 *   tab's edit form is scoped to a specific interval by
 *   data-character-id + data-join-period. Role edits apply to the
 *   whole member entry; leave edits apply to the one interval.
 *
 *   saveEditMember sequences up to two mutations:
 *     1. Role change → TeamCore.updateMember (role only)
 *     2. Leave change → TeamCore.endMemberInterval OR
 *                       TeamCore.reopenMemberInterval
 *
 *   joinPeriod is immutable. The edit form does not allow it.
 *
 * MODAL LIFECYCLE:
 *   Modal shells are declared in TeamRender.getModalsHTML() and
 *   inserted on every full-page render. Modal lifecycle (backdrop
 *   click, escape key, focus trap, focus restore) is owned by
 *   window.Modal. Show modals by calling Modal.modalSetup(modal)
 *   followed by Modal.showModal(modal). Do not roll your own show
 *   path — that bypasses the lifecycle and leaves modals stuck open.
 *
 * EXTERNAL ENTRY POINTS:
 *   openMemberManager(container, teamId, period, options)
 *   openMemberEditor(container, teamId, charId, period, options)
 *
 *   Both render into a container the caller owns, wire the
 *   add/remove/edit buttons to TeamCore directly, and re-render in
 *   place after mutations. They do not use TeamUI, they do not
 *   require the Teams tab to be mounted.
 *
 * CLOSE SEMANTICS (external entry points):
 *   The caller owns the modal shell. This module does not call
 *   Modal.closeModal / hideModal for those instances. Instead, the
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
 *     entry points to display names in the add-member picker)
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
    // MEMBER MODAL (Teams tab)
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
            var joinPeriod = target.dataset.joinPeriod;
            var teamId = TeamUI.getModalTeamId();
            if (teamId && charId) {
                showEditMemberModal(teamId, charId, joinPeriod);
            }
        });

        delegate('.remove-member', 'click', function(e, target) {
            e.preventDefault();

            var charId = target.dataset.characterId;
            var joinPeriod = target.dataset.joinPeriod;
            var teamId = TeamUI.getModalTeamId();
            if (!teamId || !charId) return;

            // Remove ONE interval. If this is the last interval,
            // purgeMemberInterval prunes the whole entry.
            if (!confirm('Remove this stint from the team?')) {
                return;
            }

            if (!isNonEmptyString(joinPeriod)) {
                // Defensive: no interval address available.
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

        // TeamCore.addMember accepts the flat { joinPeriod, leavePeriod }
        // form and wraps it into a single interval.
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
    // EDIT MEMBER MODAL (Teams tab)
    // ============================================================

    function showEditMemberModal(teamId, charId, joinPeriod) {
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

        // Find the interval with the requested joinPeriod.
        var interval = null;
        var targetJoin = (joinPeriod === undefined || joinPeriod === null)
            ? ''
            : String(joinPeriod);
        if (Array.isArray(member.intervals)) {
            for (var j = 0; j < member.intervals.length; j++) {
                var iv = member.intervals[j];
                if (!iv) continue;
                var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                    ? ''
                    : String(iv.joinPeriod);
                if (ivJoin === targetJoin) {
                    interval = iv;
                    break;
                }
            }
        }

        var modal = document.getElementById('edit-member-modal');
        if (!modal) return;

        var body = modal.querySelector('#edit-member-body');
        if (!body) return;

        // Build the form VM. When no interval was matched, the form
        // opens in role-only mode (joinPeriod is blank, leave is
        // read-only-disabled by the renderer because it can't know
        // which interval to edit).
        var formVM = {
            characterId: member.characterId,
            characterName: member.displayName,
            role: member.role,
            joinPeriod: interval ? interval.joinPeriod : '',
            leavePeriod: interval ? interval.leavePeriod : ''
        };

        // If no specific interval was selected but the member has
        // exactly one interval, fall back to that one.
        if (!interval && Array.isArray(member.intervals) &&
            member.intervals.length === 1) {
            var only = member.intervals[0];
            formVM.joinPeriod = (only.joinPeriod === undefined || only.joinPeriod === null)
                ? ''
                : String(only.joinPeriod);
            formVM.leavePeriod = (only.leavePeriod === undefined || only.leavePeriod === null)
                ? ''
                : String(only.leavePeriod);
        }

        body.innerHTML = TeamRender.renderMemberForm(formVM);

        TeamUI.setModalMemberId(charId);

        showModal(modal);

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

        if (form._submitBound) {
            return;
        }
        form._submitBound = true;

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveEditMember(form);
        });
    }

    /**
     * Save the edit-member form.
     *
     * SEQUENCED MUTATIONS:
     *   1. Role change → TeamCore.updateMember (role only).
     *   2. Leave change → TeamCore.endMemberInterval OR
     *                     TeamCore.reopenMemberInterval.
     *
     * If a mutation fails, the chain stops and the modal stays open.
     * On full success, the modal closes and the list refreshes.
     *
     * joinPeriod is IMMUTABLE. The form does not allow it.
     */
    function saveEditMember(form) {
        var teamId = TeamUI.getModalTeamId();
        var charId = form.dataset.characterId;
        var joinPeriod = form.dataset.joinPeriod || '';

        if (!teamId || !charId) {
            notify('No member selected.', 'error');
            return;
        }

        var roleEl = form.querySelector('#edit-member-role');
        var leaveEl = form.querySelector('#edit-member-leave');

        var newRole = roleEl ? roleEl.value.trim() : '';
        var newLeaveRaw = leaveEl ? leaveEl.value.trim() : '';

        // ---- Determine what changed ----
        // We don't have the previous values on the form directly, so
        // we re-fetch the member and compare. If the member no longer
        // has the interval, the mutation for leave will fail with a
        // clear message; that's the right outcome.
        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);
        var vm = TeamAggregator.getMemberModalViewModel(teamId, period);

        var member = null;
        if (vm) {
            for (var i = 0; i < vm.members.length; i++) {
                if (String(vm.members[i].characterId) === String(charId)) {
                    member = vm.members[i];
                    break;
                }
            }
        }

        if (!member) {
            notify('Member no longer exists.', 'error');
            return;
        }

        var targetJoin = String(joinPeriod);
        var interval = null;
        if (Array.isArray(member.intervals)) {
            for (var j = 0; j < member.intervals.length; j++) {
                var iv = member.intervals[j];
                if (!iv) continue;
                var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                    ? ''
                    : String(iv.joinPeriod);
                if (ivJoin === targetJoin) {
                    interval = iv;
                    break;
                }
            }
        }

        if (!interval) {
            // Role-only edit. Interval editing requires a specific
            // stint address.
            if (newRole === (member.role || '')) {
                notify('No changes to save.', 'info');
                return;
            }
            TeamCore.updateMember(teamId, charId, { role: newRole })
                .then(function(result) {
                    if (!result || !result.success) return;
                    closeEditMemberModal();
                    refreshMemberListInPlace(teamId);
                    refreshUI();
                })
                .catch(function(err) {
                    console.warn('[TeamEvents] updateMember (role) failed:', err);
                    notify('Failed to update role.', 'error');
                });
            return;
        }

        // Determine changes.
        var roleChanged = newRole !== (member.role || '');
        var currentLeave = (interval.leavePeriod === undefined ||
                            interval.leavePeriod === null)
            ? ''
            : String(interval.leavePeriod);
        var leaveChanged = newLeaveRaw !== currentLeave;

        if (!roleChanged && !leaveChanged) {
            notify('No changes to save.', 'info');
            return;
        }

        // Build the mutation chain.
        var chain = Promise.resolve();
        var roleFailed = false;
        var leaveFailed = false;

        if (roleChanged) {
            chain = chain.then(function() {
                return TeamCore.updateMember(teamId, charId, { role: newRole })
                    .then(function(result) {
                        if (!result || !result.success) {
                            roleFailed = true;
                        }
                    });
            });
        }

        if (leaveChanged) {
            chain = chain.then(function() {
                if (roleFailed) return;  // Abort on prior failure.
                if (newLeaveRaw === '') {
                    return TeamCore.reopenMemberInterval(
                        teamId, charId, joinPeriod
                    ).then(function(result) {
                        if (!result || !result.success) {
                            leaveFailed = true;
                        }
                    });
                }
                return TeamCore.endMemberInterval(
                    teamId, charId, joinPeriod, newLeaveRaw
                ).then(function(result) {
                    if (!result || !result.success) {
                        leaveFailed = true;
                    }
                });
            });
        }

        chain.then(function() {
            if (roleFailed || leaveFailed) {
                // The pipeline already notified. Keep the modal open.
                return;
            }
            closeEditMemberModal();
            refreshMemberListInPlace(teamId);
            refreshUI();
        }).catch(function(err) {
            console.warn('[TeamEvents] saveEditMember failed:', err);
            notify('Failed to save changes.', 'error');
        });
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
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttr(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // EXTERNAL ENTRY POINT - MEMBER MANAGER
    // ============================================================
    //
    // Container-based. Does not use TeamUI. Does not require the
    // Teams tab to be mounted.
    //
    // RENDERS ONE ROW PER INTERVAL.
    //
    // The per-interval Remove button calls TeamCore.purgeMemberInterval.
    // The whole-entry Remove button (on the placeholder row for a
    // member with no stints) calls TeamCore.removeMember.

    function openMemberManager(container, teamId, period, options) {
        if (!container || !teamId) {
            return null;
        }

        options = options || {};
        var onClose = (typeof options.onClose === 'function')
            ? options.onClose
            : null;
        var onMutation = (typeof options.onMutation === 'function')
            ? options.onMutation
            : null;

        var disposed = false;

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

        function render() {
            if (disposed || !container.parentNode) {
                return;
            }

            var vm = TeamAggregator.getMemberModalViewModel(teamId, period);

            if (!vm) {
                container.innerHTML = renderMemberManagerBody({
                    teamId: teamId,
                    teamName: 'Team',
                    members: [],
                    candidates: []
                }, { notFound: true });
                bindCloseButtons(container, invokeOnClose);
                return;
            }

            container.innerHTML = renderMemberManagerBody(vm, { notFound: false });
            bindManagerEvents(container, vm, {
                onMutation: invokeOnMutation,
                onClose: invokeOnClose,
                refresh: render
            });
        }

        function close() {
            disposed = true;
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
    // EXTERNAL ENTRY POINT - MEMBER EDITOR
    // ============================================================
    //
    // Same container-based pattern as openMemberManager. Edits ONE
    // interval identified by the form's data-join-period. Role is
    // per-member; leave is per-interval.

    function openMemberEditor(container, teamId, charId, period, options) {
        if (!container || !teamId || !charId) {
            return null;
        }

        options = options || {};
        var onClose = (typeof options.onClose === 'function')
            ? options.onClose
            : null;
        var onMutation = (typeof options.onMutation === 'function')
            ? options.onMutation
            : null;
        var joinPeriod = isNonEmptyString(options.joinPeriod)
            ? String(options.joinPeriod)
            : '';

        var disposed = false;

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

        function render() {
            if (disposed || !container.parentNode) {
                return;
            }

            var vm = TeamAggregator.getMemberModalViewModel(teamId, period);
            if (!vm) {
                container.innerHTML = renderMemberEditorBody(null, {
                    teamName: 'Team',
                    notFound: true
                });
                bindEditorClose(container, invokeOnClose);
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
                container.innerHTML = renderMemberEditorBody(null, {
                    teamName: vm.teamName,
                    notFound: true
                });
                bindEditorClose(container, invokeOnClose);
                return;
            }

            // Locate the interval.
            var interval = null;
            if (Array.isArray(member.intervals)) {
                for (var j = 0; j < member.intervals.length; j++) {
                    var iv = member.intervals[j];
                    if (!iv) continue;
                    var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    if (ivJoin === joinPeriod) {
                        interval = iv;
                        break;
                    }
                }
            }

            // Fallback: single interval.
            if (!interval && Array.isArray(member.intervals) &&
                member.intervals.length === 1) {
                interval = member.intervals[0];
            }

            var formVM = {
                characterId: member.characterId,
                characterName: member.displayName,
                role: member.role,
                joinPeriod: interval
                    ? (interval.joinPeriod === undefined || interval.joinPeriod === null)
                        ? ''
                        : String(interval.joinPeriod)
                    : '',
                leavePeriod: interval
                    ? (interval.leavePeriod === undefined || interval.leavePeriod === null)
                        ? ''
                        : String(interval.leavePeriod)
                    : ''
            };

            container.innerHTML = renderMemberEditorBody(formVM, {
                teamName: vm.teamName,
                notFound: false
            });
            bindEditorEvents(container, formVM, teamId, charId, {
                onMutation: invokeOnMutation,
                onClose: invokeOnClose,
                refresh: render
            });
        }

        function close() {
            disposed = true;
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

    function renderMemberManagerBody(vm, opts) {
        opts = opts || {};
        var notFound = opts.notFound === true;

        var members = Array.isArray(vm.members) ? vm.members : [];
        var candidates = Array.isArray(vm.candidates) ? vm.candidates : [];

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Manage Members \u2014 ' + escapeHtml(vm.teamName || 'Team') + '</h3>';
        html += '<button type="button" class="close-modal team-events-close-btn">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        if (notFound) {
            html += '<p class="empty-state small">Team not found.</p>';
        } else {
            html += '<div class="form-group">';
            html += '<label>Current Members (' + members.length + ')</label>';

            if (members.length === 0) {
                html += '<p class="empty-state small">No members yet.</p>';
            } else {
                html += '<div class="academy-team-members-list">';
                for (var i = 0; i < members.length; i++) {
                    var member = members[i];
                    if (!member) continue;

                    var intervals = Array.isArray(member.intervals)
                        ? member.intervals
                        : [];

                    if (intervals.length === 0) {
                        html += renderManagerPlaceholderRow(member);
                        continue;
                    }

                    for (var j = 0; j < intervals.length; j++) {
                        html += renderManagerMemberRow(
                            member, intervals[j], j === 0
                        );
                    }
                }
                html += '</div>';
            }

            html += '</div>';

            html += '<div class="form-group">';
            html += '<label for="te-member-select">Add Member</label>';

            if (candidates.length === 0) {
                html += '<p class="field-hint">' +
                            'No more characters available to add.' +
                        '</p>';
            } else {
                html += '<select id="te-member-select" class="te-member-select">';
                html += '<option value="">Select a character...</option>';
                for (var k = 0; k < candidates.length; k++) {
                    var c = candidates[k];
                    html += '<option value="' + escapeAttr(c.id) + '">' +
                                escapeHtml(c.name + (isNonEmptyString(c.status) ? ' (' + c.status + ')' : '')) +
                            '</option>';
                }
                html += '</select>';

                html += '<div class="te-member-add-row">';
                html += '<input type="text" class="te-member-role" ' +
                            'placeholder="Role (optional)">';
                html += '<input type="text" class="te-member-join" ' +
                            'placeholder="Join period (optional)">';
                html += '<input type="text" class="te-member-leave" ' +
                            'placeholder="Leave period (optional)">';
                html += '<button type="button" ' +
                            'class="small primary te-member-add-btn">Add</button>';
                html += '</div>';
            }

            html += '</div>';
        }

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="secondary te-member-close-btn">Close</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    function renderManagerMemberRow(member, interval, isFirstIntervalRow) {
        if (!member || !member.characterId) { return ''; }
        if (!interval || typeof interval !== 'object') { return ''; }

        var charIdAttr = escapeAttr(member.characterId);
        var joinAttr = escapeAttr(
            interval.joinPeriod === undefined || interval.joinPeriod === null
                ? ''
                : String(interval.joinPeriod)
        );

        var rowClass = 'academy-team-member-row';
        if (!isFirstIntervalRow) {
            rowClass += ' academy-team-member-row-continuation';
        }

        var joinDisplay = isNonEmptyString(interval.joinPeriod)
            ? interval.joinPeriod
            : '\u2014';
        var leaveDisplay = isNonEmptyString(interval.leavePeriod)
            ? interval.leavePeriod
            : '\u2014';

        var role = (isFirstIntervalRow && isNonEmptyString(member.role) && member.role !== 'Member')
            ? member.role
            : '';

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '">';

        if (isFirstIntervalRow) {
            html += '<span class="academy-team-member-name">' +
                        escapeHtml(member.displayName || 'Unknown') +
                    '</span>';
            if (role) {
                html += '<span class="academy-team-member-role">' +
                            escapeHtml(role) +
                        '</span>';
            }
        } else {
            html += '<span class="academy-team-member-name">' +
                        '\u21b3' +
                    '</span>';
        }

        html += '<span class="academy-team-member-period">' +
                    'Join ' + escapeHtml(joinDisplay) +
                    ' \u2013 Leave ' + escapeHtml(leaveDisplay) +
                '</span>';

        html += '<button type="button" ' +
                    'class="small danger te-member-remove-btn" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '">' +
                    'Remove stint' +
                '</button>';

        html += '</div>';
        return html;
    }

    function renderManagerPlaceholderRow(member) {
        if (!member || !member.characterId) { return ''; }

        var charIdAttr = escapeAttr(member.characterId);

        var html = '';
        html += '<div class="academy-team-member-row academy-team-member-row-placeholder" ' +
                    'data-character-id="' + charIdAttr + '">';

        html += '<span class="academy-team-member-name">' +
                    escapeHtml(member.displayName || 'Unknown') +
                '</span>';

        html += '<span class="academy-team-member-period">' +
                    'No stints recorded.' +
                '</span>';

        html += '<button type="button" ' +
                    'class="small danger te-member-remove-entry-btn" ' +
                    'data-character-id="' + charIdAttr + '">' +
                    'Remove member' +
                '</button>';

        html += '</div>';
        return html;
    }

    function renderMemberEditorBody(formVM, opts) {
        opts = opts || {};
        var notFound = opts.notFound === true;
        var teamName = opts.teamName || 'Team';

        var html = '';
        html += '<div class="modal-header">';
        html += '<h3>Edit Member \u2014 ' + escapeHtml(teamName) + '</h3>';
        html += '<button type="button" class="close-modal te-member-editor-close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        if (notFound || !formVM) {
            html += '<p class="empty-state small">Member not found.</p>';
        } else {
            var joinDisplay = isNonEmptyString(formVM.joinPeriod)
                ? formVM.joinPeriod
                : '\u2014';
            var leaveValue = isNonEmptyString(formVM.leavePeriod)
                ? formVM.leavePeriod
                : '';

            html += '<form id="te-member-editor-form" ' +
                        'data-character-id="' + escapeAttr(formVM.characterId) + '" ' +
                        'data-join-period="' + escapeAttr(formVM.joinPeriod || '') + '">';

            html += '<div class="form-group">';
            html += '<label>Character</label>';
            html += '<p style="margin:4px 0 12px 0;font-weight:600;">' +
                        escapeHtml(formVM.characterName || 'Unknown') +
                    '</p>';
            html += '</div>';

            html += '<div class="form-group">';
            html += '<label for="te-edit-member-role">Role</label>';
            html += '<input type="text" id="te-edit-member-role" ' +
                        'value="' + escapeAttr(formVM.role || '') + '">';
            html += '<p class="field-hint">Applies to the whole member.</p>';
            html += '</div>';

            html += '<div class="form-group">';
            html += '<label>Join Period</label>';
            html += '<input type="text" value="' + escapeAttr(joinDisplay) + '" readonly disabled>';
            html += '<p class="field-hint">' +
                        'Join is immutable. Remove the stint to change it.' +
                    '</p>';
            html += '</div>';

            html += '<div class="form-group">';
            html += '<label for="te-edit-member-leave">Leave Period</label>';
            html += '<input type="text" id="te-edit-member-leave" ' +
                        'value="' + escapeAttr(leaveValue) + '">';
            html += '<p class="field-hint">Blank means ongoing.</p>';
            html += '</div>';

            html += '<div class="form-actions">';
            html += '<button type="button" class="secondary te-member-editor-cancel">Cancel</button>';
            html += '<button type="submit" class="primary te-member-editor-save">Save Changes</button>';
            html += '</div>';

            html += '</form>';
        }

        if (notFound || !formVM) {
            html += '<div class="form-actions">';
            html += '<button type="button" class="secondary te-member-editor-cancel">Close</button>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXTERNAL BINDINGS (not exported)
    // ============================================================

    function bindCloseButtons(container, onClose) {
        var closeBtns = container.querySelectorAll(
            '.team-events-close-btn, .te-member-close-btn'
        );
        for (var i = 0; i < closeBtns.length; i++) {
            closeBtns[i].addEventListener('click', function() {
                onClose();
            });
        }
    }

    function bindManagerEvents(container, vm, ctx) {
        bindCloseButtons(container, ctx.onClose);

        // ---- Per-interval Remove: purge this stint ----
        var removeBtns = container.querySelectorAll('.te-member-remove-btn');
        for (var j = 0; j < removeBtns.length; j++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    var charId = btn.dataset.characterId;
                    var joinPeriod = btn.dataset.joinPeriod;
                    if (!charId) { return; }
                    if (!confirm('Remove this stint from the team?')) {
                        return;
                    }
                    if (!isNonEmptyString(joinPeriod)) {
                        // Single-interval fallback: try purgeMemberInterval
                        // without a joinPeriod. TeamCore will match the
                        // only interval and reject otherwise.
                        TeamCore.purgeMemberInterval(vm.teamId, charId, '')
                            .then(function(result) {
                                if (result && result.success) {
                                    ctx.refresh();
                                    ctx.onMutation();
                                }
                            })
                            .catch(function(err) {
                                console.warn('[TeamEvents] purgeMemberInterval failed:', err);
                                notify('Failed to remove stint.', 'error');
                            });
                        return;
                    }
                    TeamCore.purgeMemberInterval(vm.teamId, charId, joinPeriod)
                        .then(function(result) {
                            if (result && result.success) {
                                ctx.refresh();
                                ctx.onMutation();
                            }
                        })
                        .catch(function(err) {
                            console.warn('[TeamEvents] purgeMemberInterval failed:', err);
                            notify('Failed to remove stint.', 'error');
                        });
                });
            })(removeBtns[j]);
        }

        // ---- Whole-entry Remove: placeholder rows only ----
        var removeEntryBtns = container.querySelectorAll('.te-member-remove-entry-btn');
        for (var k = 0; k < removeEntryBtns.length; k++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    var charId = btn.dataset.characterId;
                    if (!charId) { return; }
                    if (!confirm('Remove this member entirely (all stints)?')) {
                        return;
                    }
                    TeamCore.removeMember(vm.teamId, charId)
                        .then(function(result) {
                            if (result && result.success) {
                                ctx.refresh();
                                ctx.onMutation();
                            }
                        })
                        .catch(function(err) {
                            console.warn('[TeamEvents] removeMember failed:', err);
                            notify('Failed to remove member.', 'error');
                        });
                });
            })(removeEntryBtns[k]);
        }

        // ---- Add member ----
        var addBtn = container.querySelector('.te-member-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                var select = container.querySelector('.te-member-select');
                var roleInput = container.querySelector('.te-member-role');
                var joinInput = container.querySelector('.te-member-join');
                var leaveInput = container.querySelector('.te-member-leave');

                var charId = select ? select.value : '';
                if (!charId) {
                    notify('Select a character to add.', 'error');
                    return;
                }

                TeamCore.addMember(vm.teamId, {
                    characterId: charId,
                    role: roleInput ? roleInput.value.trim() : '',
                    joinPeriod: joinInput ? joinInput.value.trim() : '',
                    leavePeriod: leaveInput ? leaveInput.value.trim() : ''
                }).then(function(result) {
                    if (result && result.success) {
                        ctx.refresh();
                        ctx.onMutation();
                    }
                }).catch(function(err) {
                    console.warn('[TeamEvents] addMember failed:', err);
                    notify('Failed to add member.', 'error');
                });
            });
        }
    }

    function bindEditorClose(container, onClose) {
        var closeBtns = container.querySelectorAll(
            '.te-member-editor-close, .te-member-editor-cancel'
        );
        for (var i = 0; i < closeBtns.length; i++) {
            closeBtns[i].addEventListener('click', function() {
                onClose();
            });
        }
    }

    /**
     * Bind the external editor's submit handler.
     *
     * The editor edits ONE interval. Save sequences:
     *   1. Role change → TeamCore.updateMember (role only).
     *   2. Leave change → TeamCore.endMemberInterval OR
     *                     TeamCore.reopenMemberInterval.
     *
     * joinPeriod is IMMUTABLE; the form's join field is read-only.
     */
    function bindEditorEvents(container, formVM, teamId, charId, ctx) {
        bindEditorClose(container, ctx.onClose);

        var form = container.querySelector('#te-member-editor-form');
        if (!form) { return; }

        var joinPeriod = form.dataset.joinPeriod || '';

        form.addEventListener('submit', function(e) {
            e.preventDefault();

            var roleInput = form.querySelector('#te-edit-member-role');
            var leaveInput = form.querySelector('#te-edit-member-leave');

            var newRole = roleInput ? roleInput.value.trim() : '';
            var newLeaveRaw = leaveInput ? leaveInput.value.trim() : '';

            var roleChanged = newRole !== (formVM.role || '');
            var currentLeave = formVM.leavePeriod || '';
            var leaveChanged = newLeaveRaw !== currentLeave;

            if (!roleChanged && !leaveChanged) {
                notify('No changes to save.', 'info');
                return;
            }

            if (leaveChanged && !isNonEmptyString(formVM.joinPeriod)) {
                notify(
                    'A specific stint is required to edit the leave week.',
                    'error'
                );
                return;
            }

            var chain = Promise.resolve();
            var failed = false;

            if (roleChanged) {
                chain = chain.then(function() {
                    return TeamCore.updateMember(teamId, charId, { role: newRole })
                        .then(function(result) {
                            if (!result || !result.success) { failed = true; }
                        });
                });
            }

            if (leaveChanged) {
                chain = chain.then(function() {
                    if (failed) return;
                    if (newLeaveRaw === '') {
                        return TeamCore.reopenMemberInterval(
                            teamId, charId, formVM.joinPeriod
                        ).then(function(result) {
                            if (!result || !result.success) { failed = true; }
                        });
                    }
                    return TeamCore.endMemberInterval(
                        teamId, charId, formVM.joinPeriod, newLeaveRaw
                    ).then(function(result) {
                        if (!result || !result.success) { failed = true; }
                    });
                });
            }

            chain.then(function() {
                if (failed) return;
                ctx.onMutation();
                ctx.onClose();
            }).catch(function(err) {
                console.warn('[TeamEvents] editor save failed:', err);
                notify('Failed to save changes.', 'error');
            });
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
        closeTeamForm: closeTeamForm,
        showMemberModal: showMemberModal,
        closeMemberModal: closeMemberModal,
        showRankingModal: showRankingModal,
        closeRankingModal: closeRankingModal,

        // External entry points (container-based)
        openMemberManager: openMemberManager,
        openMemberEditor: openMemberEditor
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
            'openMemberManager', 'openMemberEditor'
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
