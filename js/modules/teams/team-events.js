/**
 * modules/teams/team-events.js - Team Events
 * Event orchestration for the Team domain.
 *
 * Path: js/modules/teams/team-events.js
 *
 * RESPONSIBILITIES:
 *   - init / destroy: bind and unbind delegated listeners.
 *   - Route user interactions to TeamCore mutations.
 *   - Update TeamUI state.
 *   - Request fresh VMs from TeamAggregator; hand them to TeamRender.
 *   - Open and close modals.
 *   - Read form field values.
 *   - Own the matchmaking planner's state (via TeamAggregator).
 *   - Own the professional tab's view mode.
 *   - Own the timeline's range and expanded-years state.
 *   - Own the professional pool's expansion and selection state.
 *   - Open the team export picker and the candidate export.
 *   - Open the team verifier modal.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Domain logic. TeamCore owns mutations; TeamQueries owns reads;
 *     TeamAggregator owns projections.
 *   - Rendering. TeamRender owns HTML.
 *   - Eligibility. TeamQueries.getProfessionalPersonnelAtPeriod
 *     owns it.
 *   - The verifier's checks. TeamVerifier owns them.
 *   - The verifier's HTML. TeamVerifierView owns it.
 *
 * VIEW MODES:
 *   'teams' | 'pool' | 'timeline'. Module-level. Forced to 'teams'
 *   on non-professional tabs. Reset on init and destroy.
 *
 * POOL STATE:
 *   _poolExpandedIds  { [characterId]: true }
 *   _poolSelectedIds  { [characterId]: true }
 *
 *   Both are reset when:
 *     - the view mode changes away from 'pool'
 *     - the tab changes away from 'professional'
 *     - init/destroy
 *
 *   Both are passed onto the page VM by refreshUI.
 *
 * CREATE TEAM FROM SELECTION:
 *   Clicking Create Team from Selection opens the standard team
 *   form. The selected character IDs are stashed in
 *   _pendingTeamMemberIds. When the form submits successfully and
 *   the resulting team has a startPeriod, batchAddMembers is
 *   called with those IDs at that period. If the form is
 *   cancelled, the pending list is cleared.
 *
 * TIMELINE STATE:
 *   _timelineYearStart, _timelineYearEnd, _timelineExpandedYears.
 *   Defaults are (currentYear - 20, currentYear + 5) on first use.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamCore
 *   - window.TeamQueries
 *   - window.TeamAggregator
 *   - window.TeamUI
 *   - window.TeamRender
 *   - window.TeamMatchmakingView
 *   - window.Modal
 *   - window.MemberManager
 *   - window.MemberAdapterTeams
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (LAZY, at click time):
 *   - window.TeamExportPicker
 *   - window.CandidateExport
 *   - window.TeamVerifierView
 */

(function() {
    'use strict';

    if (window.__teamEventsLoaded) {
        return;
    }
    window.__teamEventsLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var TeamAggregator = window.TeamAggregator;
    var TeamUI = window.TeamUI;
    var TeamRender = window.TeamRender;
    var TeamMatchmakingView = window.TeamMatchmakingView;
    var Modal = window.Modal;
    var MemberManager = window.MemberManager;
    var MemberAdapterTeams = window.MemberAdapterTeams;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    if (!TeamCore || typeof TeamCore.createTeam !== 'function') {
        _missing.push('TeamCore.createTeam');
    }
    if (!TeamCore || typeof TeamCore.updateTeam !== 'function') {
        _missing.push('TeamCore.updateTeam');
    }
    if (!TeamCore || typeof TeamCore.deleteTeam !== 'function') {
        _missing.push('TeamCore.deleteTeam');
    }
    if (!TeamCore || typeof TeamCore.addRanking !== 'function') {
        _missing.push('TeamCore.addRanking');
    }
    if (!TeamCore || typeof TeamCore.removeRanking !== 'function') {
        _missing.push('TeamCore.removeRanking');
    }
    if (!TeamCore ||
        typeof TeamCore.batchAddMembers !== 'function') {
        _missing.push('TeamCore.batchAddMembers');
    }

    if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
        _missing.push('TeamQueries.getTeamName');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getRankingSummary !== 'function') {
        _missing.push('TeamQueries.getRankingSummary');
    }

    if (!TeamAggregator ||
        typeof TeamAggregator.getTeamPageViewModel !== 'function') {
        _missing.push('TeamAggregator.getTeamPageViewModel');
    }
    if (!TeamAggregator ||
        typeof TeamAggregator.getTeamFormViewModel !== 'function') {
        _missing.push('TeamAggregator.getTeamFormViewModel');
    }
    if (!TeamAggregator ||
        typeof TeamAggregator.getRankingModalViewModel !==
        'function') {
        _missing.push('TeamAggregator.getRankingModalViewModel');
    }
    if (!TeamAggregator ||
        typeof TeamAggregator.getFilterBarViewModel !== 'function') {
        _missing.push('TeamAggregator.getFilterBarViewModel');
    }
    if (!TeamAggregator ||
        typeof TeamAggregator.getMatchmakingPlannerViewModel !==
        'function') {
        _missing.push(
            'TeamAggregator.getMatchmakingPlannerViewModel'
        );
    }
    if (!TeamAggregator ||
        typeof TeamAggregator.getProfessionalPoolViewModel !==
        'function') {
        _missing.push(
            'TeamAggregator.getProfessionalPoolViewModel'
        );
    }
    if (!TeamAggregator ||
        typeof TeamAggregator.getTimelineViewModel !==
        'function') {
        _missing.push('TeamAggregator.getTimelineViewModel');
    }

    if (!TeamUI || typeof TeamUI.getCurrentTab !== 'function') {
        _missing.push('TeamUI.getCurrentTab');
    }
    if (!TeamUI || typeof TeamUI.getExpandedTeamId !== 'function') {
        _missing.push('TeamUI.getExpandedTeamId');
    }

    if (!TeamRender ||
        typeof TeamRender.renderContainer !== 'function') {
        _missing.push('TeamRender.renderContainer');
    }
    if (!TeamRender ||
        typeof TeamRender.renderFilterBar !== 'function') {
        _missing.push('TeamRender.renderFilterBar');
    }
    if (!TeamRender ||
        typeof TeamRender.renderTeamForm !== 'function') {
        _missing.push('TeamRender.renderTeamForm');
    }
    if (!TeamRender ||
        typeof TeamRender.renderRankingForm !== 'function') {
        _missing.push('TeamRender.renderRankingForm');
    }
    if (!TeamRender ||
        typeof TeamRender.renderRankingList !== 'function') {
        _missing.push('TeamRender.renderRankingList');
    }
    if (!TeamRender ||
        typeof TeamRender.renderNameHistoryRow !== 'function') {
        _missing.push('TeamRender.renderNameHistoryRow');
    }

    if (!TeamMatchmakingView ||
        typeof TeamMatchmakingView.renderHTML !== 'function') {
        _missing.push('TeamMatchmakingView.renderHTML');
    }

    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }

    if (!MemberManager || typeof MemberManager.open !== 'function') {
        _missing.push('MemberManager.open');
    }

    if (!MemberAdapterTeams ||
        typeof MemberAdapterTeams.fetchVM !== 'function' ||
        typeof MemberAdapterTeams.addMember !== 'function' ||
        typeof MemberAdapterTeams.updateMembers !== 'function' ||
        typeof MemberAdapterTeams.removeStint !== 'function' ||
        typeof MemberAdapterTeams.rejoinStint !== 'function' ||
        typeof MemberAdapterTeams.removeMember !== 'function') {
        _missing.push('MemberAdapterTeams API');
    }

    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamEvents] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) {
                return null;
            }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            if (!Number.isInteger(n) || n < 1) {
                return null;
            }
            return n;
        }
        return null;
    }

    function cssEscape(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value).replace(/(["\\])/g, '\\$1');
    }

    function objectKeyCount(obj) {
        if (!obj) { return 0; }
        var n = 0;
        for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k) &&
                obj[k] === true) {
                n++;
            }
        }
        return n;
    }

    function objectKeysWithTrue(obj) {
        var out = [];
        if (!obj) { return out; }
        for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k) &&
                obj[k] === true) {
                out.push(k);
            }
        }
        return out;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _container = null;
    var _eventListeners = [];

    var _memberManagerModal = null;
    var _matchmakingModal = null;

    var _viewMode = 'teams';

    // Timeline state.
    var _timelineYearStart = null;
    var _timelineYearEnd = null;
    var _timelineExpandedYears = Object.create(null);

    // Pool expansion state: { [characterId]: true }
    var _poolExpandedIds = Object.create(null);

    // Pool selection state: { [characterId]: true }
    var _poolSelectedIds = Object.create(null);

    // Pending member assignments for the next createTeam success.
    // Set by the Create Team from Selection flow; cleared on
    // close or after the batch add completes.
    var _pendingTeamMemberIds = null;

    // ============================================================
    // LISTENER BOOKKEEPING
    // ============================================================

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(
                    item.eventName, item.handler
                );
            } catch (e) {
                // Ignore.
            }
        }
        _eventListeners = [];
    }

    function delegate(selector, eventName, handler) {
        if (!_container) { return; }

        function wrapped(e) {
            if (!_container) { return; }
            if (!_container.contains(e.target)) { return; }

            var target = e.target.closest
                ? e.target.closest(selector)
                : null;
            if (!target) { return; }
            if (!_container.contains(target)) { return; }

            handler(e, target);
        }

        _container.addEventListener(eventName, wrapped);
        _eventListeners.push({
            element: _container,
            eventName: eventName,
            handler: wrapped
        });
    }

    // ============================================================
    // PERIOD RESOLUTION
    // ============================================================

    function getCurrentPeriod(tab) {
        var filter = TeamUI.getFilter(tab);
        if (filter && filter.filterYear !== undefined &&
            filter.filterYear !== null &&
            filter.filterYear !== '') {
            var parsed = parseInt(filter.filterYear, 10);
            if (!isNaN(parsed) && parsed >= 1) {
                return parsed;
            }
        }

        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear)) {
            return data.currentYear;
        }

        return null;
    }

    function getApplicationYear() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }
        return null;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function refreshUI() {
        if (!_container) { return; }

        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);
        var expandedTeamId = TeamUI.getExpandedTeamId();

        if (currentTab !== 'professional') {
            _viewMode = 'teams';
            _poolExpandedIds = Object.create(null);
            _poolSelectedIds = Object.create(null);
        }

        var pageVM = TeamAggregator.getTeamPageViewModel({
            type: currentTab,
            period: period,
            expandedTeamId:
                _viewMode === 'teams' ? expandedTeamId : null
        });

        if (_viewMode === 'teams' &&
            pageVM.expandedTeamId !== expandedTeamId) {
            TeamUI.setExpandedTeamId(pageVM.expandedTeamId);
        }

        pageVM.viewMode = _viewMode;

        if (currentTab === 'professional' && _viewMode === 'pool') {
            if (period === null) {
                throw new Error(
                    '[TeamEvents] Cannot build pool without a ' +
                    'period.'
                );
            }
            pageVM.professionalPoolVM =
                TeamAggregator.getProfessionalPoolViewModel({
                    period: period
                });
            pageVM.poolExpandedIds = _poolExpandedIds;
            pageVM.poolSelectedIds = _poolSelectedIds;
        } else {
            pageVM.professionalPoolVM = null;
            pageVM.poolExpandedIds = null;
            pageVM.poolSelectedIds = null;
        }

        if (currentTab === 'professional' &&
            _viewMode === 'timeline') {
            ensureTimelineRange();
            pageVM.timelineVM =
                TeamAggregator.getTimelineViewModel({
                    start: _timelineYearStart,
                    end: _timelineYearEnd
                });
            pageVM.timelineExpandedYears = _timelineExpandedYears;
        } else {
            pageVM.timelineVM = null;
            pageVM.timelineExpandedYears = null;
        }

        _container.innerHTML = TeamRender.renderContainer(pageVM);

        var filterContainer =
            _container.querySelector('#filter-container');
        if (filterContainer) {
            var filterVM =
                TeamAggregator.getFilterBarViewModel(currentTab);
            filterVM.viewMode = _viewMode;
            filterContainer.innerHTML =
                TeamRender.renderFilterBar(filterVM);
        }
    }

    function ensureTimelineRange() {
        if (_timelineYearStart !== null &&
            _timelineYearEnd !== null) {
            return;
        }

        var currentYear = getApplicationYear();
        if (currentYear === null) {
            throw new Error(
                '[TeamEvents] Application year is required to ' +
                'build the timeline.'
            );
        }

        _timelineYearStart = currentYear - 20;
        _timelineYearEnd = currentYear + 5;
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (_initialized) {
            destroy();
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

        _viewMode = 'teams';
        _timelineYearStart = null;
        _timelineYearEnd = null;
        _timelineExpandedYears = Object.create(null);
        _poolExpandedIds = Object.create(null);
        _poolSelectedIds = Object.create(null);
        _pendingTeamMemberIds = null;

        bindTabSwitching();
        bindModeToggle();
        bindAddTeam();
        bindMatchmaking();
        bindVerify();
        bindTeamExport();
        bindCandidateExport();
        bindTeamActions();
        bindFilters();
        bindTimelineActions();
        bindPoolActions();

        _initialized = true;
    }

    function destroy() {
        if (_memberManagerModal) {
            try {
                Modal.closeModal(_memberManagerModal);
            } catch (e) {
                // Ignore.
            }
            _memberManagerModal = null;
        }

        if (_matchmakingModal) {
            try {
                Modal.closeModal(_matchmakingModal);
            } catch (e) {
                // Ignore.
            }
            _matchmakingModal = null;
        }

        removeAllEventListeners();
        _initialized = false;
        _container = null;
        _viewMode = 'teams';
        _timelineYearStart = null;
        _timelineYearEnd = null;
        _timelineExpandedYears = Object.create(null);
        _poolExpandedIds = Object.create(null);
        _poolSelectedIds = Object.create(null);
        _pendingTeamMemberIds = null;
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function bindTabSwitching() {
        delegate('.tab-btn', 'click', function(e, target) {
            var tab = target.dataset.tab;
            if (!tab) { return; }

            if (tab !== 'professional') {
                _viewMode = 'teams';
                _poolExpandedIds = Object.create(null);
                _poolSelectedIds = Object.create(null);
            }

            TeamUI.setCurrentTab(tab);
            refreshUI();
        });
    }

    // ============================================================
    // MODE TOGGLE
    // ============================================================

    function bindModeToggle() {
        delegate('.mode-btn', 'click', function(e, target) {
            e.preventDefault();

            if (TeamUI.getCurrentTab() !== 'professional') {
                return;
            }

            var mode = target.dataset.mode;
            if (mode !== 'teams' &&
                mode !== 'pool' &&
                mode !== 'timeline') {
                return;
            }

            if (mode === _viewMode) { return; }

            _viewMode = mode;

            if (_viewMode !== 'teams') {
                TeamUI.setExpandedTeamId(null);
            }
            if (_viewMode !== 'pool') {
                _poolExpandedIds = Object.create(null);
                _poolSelectedIds = Object.create(null);
            }
            if (_viewMode !== 'timeline') {
                _timelineExpandedYears = Object.create(null);
            }

            refreshUI();
        });
    }

    // ============================================================
    // TIMELINE ACTIONS
    // ============================================================

    function bindTimelineActions() {
        delegate('.timeline-circle', 'click', function(e, target) {
            e.preventDefault();

            var year = parseInt(target.dataset.year, 10);
            if (isNaN(year) || year < 1) { return; }

            if (_timelineExpandedYears[year]) {
                delete _timelineExpandedYears[year];
            } else {
                _timelineExpandedYears[year] = true;
            }

            refreshUI();
        });

        delegate('.timeline-team-name', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();

            var teamId = target.dataset.teamId;
            if (!teamId) { return; }

            var row = target.closest('.timeline-year');
            var year = row
                ? parseInt(row.dataset.year, 10)
                : NaN;

            openMemberManager(
                teamId,
                isNaN(year) || year < 1 ? null : year
            );
        });

        delegate('#timeline-apply-btn', 'click', function(e) {
            e.preventDefault();
            applyTimelineRange();
        });

        delegate('#timeline-start-year', 'keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyTimelineRange();
            }
        });
        delegate('#timeline-end-year', 'keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyTimelineRange();
            }
        });

        delegate('#timeline-expand-all-btn', 'click', function(e) {
            e.preventDefault();
            expandAllTimelineYears();
        });

        delegate('#timeline-collapse-all-btn', 'click', function(e) {
            e.preventDefault();
            collapseAllTimelineYears();
        });
    }

    function applyTimelineRange() {
        if (!_container) { return; }

        var startEl = _container.querySelector(
            '#timeline-start-year'
        );
        var endEl = _container.querySelector('#timeline-end-year');

        if (!startEl || !endEl) { return; }

        var startNum = parsePositiveInteger(startEl.value);
        var endNum = parsePositiveInteger(endEl.value);

        if (startNum === null || endNum === null) {
            notify(
                'Both range fields must be positive integers.',
                'error'
            );
            return;
        }

        var lo = Math.min(startNum, endNum);
        var hi = Math.max(startNum, endNum);

        _timelineYearStart = lo;
        _timelineYearEnd = hi;

        var keys = Object.keys(_timelineExpandedYears);
        for (var i = 0; i < keys.length; i++) {
            var y = parseInt(keys[i], 10);
            if (isNaN(y) || y < lo || y > hi) {
                delete _timelineExpandedYears[keys[i]];
            }
        }

        refreshUI();
    }

    function expandAllTimelineYears() {
        if (!_container) { return; }

        var rows = _container.querySelectorAll(
            '.timeline-year[data-year]'
        );
        _timelineExpandedYears = Object.create(null);
        for (var i = 0; i < rows.length; i++) {
            var y = parseInt(rows[i].dataset.year, 10);
            if (!isNaN(y) && y >= 1) {
                _timelineExpandedYears[y] = true;
            }
        }

        refreshUI();
    }

    function collapseAllTimelineYears() {
        _timelineExpandedYears = Object.create(null);
        refreshUI();
    }

    // ============================================================
    // POOL ACTIONS
    // ============================================================
    //
    // Three interactions:
    //   - Click on the data row (outside the checkbox) toggles
    //     expansion of that row.
    //   - Change on the checkbox toggles that character in the
    //     selection set. The change handler stops propagation so
    //     a checkbox click does not also reach the row click.
    //   - Clear button empties the selection set.
    //   - Create Team from Selection opens the team form with
    //     _pendingTeamMemberIds stashed.

    function bindPoolActions() {
        // Row click toggles expansion.
        delegate(
            '[data-action="pool-toggle-expand"]',
            'click',
            function(e, target) {
                // Ignore clicks that originated on the checkbox or
                // its container.
                var clicked = e.target;
                if (clicked && clicked.closest) {
                    if (clicked.closest('.pool-select-cell')) {
                        return;
                    }
                }

                var charId = target.dataset.id;
                if (!charId) { return; }

                if (_poolExpandedIds[charId] === true) {
                    delete _poolExpandedIds[charId];
                } else {
                    _poolExpandedIds[charId] = true;
                }

                refreshUI();
            }
        );

        // Checkbox toggles selection. Change event (not click)
        // so keyboard toggling works.
        delegate(
            '.pool-select-checkbox',
            'change',
            function(e, target) {
                if (e.stopPropagation) {
                    e.stopPropagation();
                }

                var charId = target.dataset.characterId;
                if (!charId) { return; }

                if (target.checked) {
                    _poolSelectedIds[charId] = true;
                } else {
                    delete _poolSelectedIds[charId];
                }

                refreshUI();
            }
        );

        // Prevent row-click handler from firing when the checkbox
        // itself is clicked. The change event fires after click.
        delegate(
            '.pool-select-cell',
            'click',
            function(e) {
                if (e.stopPropagation) {
                    e.stopPropagation();
                }
            }
        );

        // Clear selection.
        delegate(
            '#pool-clear-selection',
            'click',
            function(e) {
                e.preventDefault();
                _poolSelectedIds = Object.create(null);
                refreshUI();
            }
        );

        // Create Team from Selection.
        delegate(
            '#pool-create-team-btn',
            'click',
            function(e) {
                e.preventDefault();
                handleCreateTeamFromSelection();
            }
        );
    }

    function handleCreateTeamFromSelection() {
        var selectedIds = objectKeysWithTrue(_poolSelectedIds);
        if (selectedIds.length < 2) {
            notify(
                'Select at least two candidates to create a team.',
                'error'
            );
            return;
        }

        _pendingTeamMemberIds = selectedIds;

        showTeamForm(null);
    }

    // ============================================================
    // ADD TEAM
    // ============================================================

    function bindAddTeam() {
        delegate('#add-team-btn', 'click', function(e) {
            e.preventDefault();
            _pendingTeamMemberIds = null;
            showTeamForm(null);
        });
    }

    function showTeamForm(editId) {
        var formVM = TeamAggregator.getTeamFormViewModel(editId);
        if (!formVM) {
            notify('Team not found.', 'error');
            return;
        }

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

        // If we are creating from a pool selection, append a chip
        // strip at the top of the form body so the user sees who
        // is about to be added.
        if (!editId &&
            Array.isArray(_pendingTeamMemberIds) &&
            _pendingTeamMemberIds.length > 0) {
            prependPendingMembersStrip(
                contentEl, _pendingTeamMemberIds
            );
        }

        Modal.modalSetup(modal, function() {
            // Modal dismissed without saving. Clear the pending
            // list so a subsequent Add Team does not accidentally
            // inherit it.
            _pendingTeamMemberIds = null;
        });

        Modal.showModal(modal);

        bindTeamFormEvents(modal, contentEl);
    }

    function prependPendingMembersStrip(contentEl, charIds) {
        var form = contentEl.querySelector('#team-form-inner');
        if (!form) { return; }

        var names = [];
        for (var i = 0; i < charIds.length; i++) {
            var char = null;
            try {
                char = window.CharacterQueries &&
                    typeof window.CharacterQueries.getCharacterById ===
                    'function'
                    ? window.CharacterQueries.getCharacterById(
                        charIds[i]
                    )
                    : null;
            } catch (e) {
                char = null;
            }

            var name = char && window.CharacterQueries &&
                typeof window.CharacterQueries.getDisplayName ===
                'function'
                ? window.CharacterQueries.getDisplayName(char)
                : charIds[i];

            names.push(name);
        }

        var strip = document.createElement('div');
        strip.className = 'team-form-pending-members';

        var html = '';
        html += '<span class="team-form-pending-label">' +
                    'Adding ' + names.length +
                    ' member' + (names.length === 1 ? '' : 's') +
                    ' on save:' +
                '</span>';
        for (var n = 0; n < names.length; n++) {
            html += '<span class="team-form-pending-chip">' +
                        escapeHtml(names[n]) +
                    '</span>';
        }
        html += '<span class="team-form-pending-hint">' +
                    'Their join year is the team\'s Start Period.' +
                '</span>';

        strip.innerHTML = html;

        // Insert before the first form-grid inside the form.
        var grid = form.querySelector('.form-grid');
        if (grid && grid.parentNode) {
            grid.parentNode.insertBefore(strip, grid);
        } else {
            form.insertBefore(strip, form.firstChild);
        }
    }

    function escapeHtml(value) {
        if (window.DomUtils &&
            typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function bindTeamFormEvents(modal, contentEl) {
        var form = contentEl.querySelector('#team-form-inner');
        if (!form) { return; }

        function close() {
            closeModal(modal);
        }

        var closeBtn = contentEl.querySelector(
            '#close-team-form'
        );
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }

        var cancelBtn = contentEl.querySelector(
            '#cancel-team-form'
        );
        if (cancelBtn) {
            cancelBtn.addEventListener('click', close);
        }

        var addNameBtn = contentEl.querySelector(
            '#add-name-history-btn'
        );
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var containerEl = form.querySelector(
                    '#name-history-container'
                );
                if (!containerEl) { return; }
                var wrapper = document.createElement('div');
                wrapper.innerHTML =
                    TeamRender.renderNameHistoryRow(null);
                containerEl.appendChild(
                    wrapper.firstElementChild
                );
            });
        }

        contentEl.addEventListener('click', function(e) {
            var removeBtn = e.target.closest
                ? e.target.closest('.remove-name')
                : null;
            if (!removeBtn) { return; }
            e.preventDefault();

            var entry = removeBtn.closest(
                '.name-history-entry'
            );
            if (!entry) { return; }
            var parent = entry.parentElement;
            if (!parent) { return; }

            if (parent.querySelectorAll(
                '.name-history-entry'
            ).length <= 1) {
                notify(
                    'You need at least one name entry.',
                    'error'
                );
                return;
            }

            entry.remove();
        });

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveTeam(form, modal);
        });
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

        var startPeriod = startEl ? startEl.value : '';

        var temporaryMission = missionEl
            ? (missionEl.value || null)
            : null;

        var teamData = {
            name: name,
            type: type,
            startPeriod: startPeriod,
            endPeriod: endEl ? endEl.value : '',
            status: status,
            classId: classEl ? classEl.value : null,
            teamNumber: numberEl ? numberEl.value.trim() : '',
            temporaryMission: temporaryMission,
            nameHistory: collectNameHistory(form)
        };

        // Capture pending members before the async work begins.
        // The callback chain uses this local copy.
        var pendingMembers = editId
            ? null
            : (_pendingTeamMemberIds
                ? _pendingTeamMemberIds.slice()
                : null);

        var promise = editId
            ? TeamCore.updateTeam(editId, teamData)
            : TeamCore.createTeam(teamData);

        promise.then(function(result) {
            if (!result || !result.success) {
                return;
            }

            // For an edit, nothing more to do. Close and refresh.
            if (editId) {
                _pendingTeamMemberIds = null;
                closeModal(modal);
                refreshUI();
                return;
            }

            // For a new team, if there are pending members, add
            // them at the team's start period.
            var newTeamId = result.data &&
                result.data.team &&
                result.data.team.id
                ? String(result.data.team.id)
                : null;

            var newTeamStartPeriod = result.data &&
                result.data.team &&
                result.data.team.startPeriod
                ? String(result.data.team.startPeriod)
                : '';

            if (!pendingMembers ||
                pendingMembers.length === 0 ||
                !newTeamId) {
                _pendingTeamMemberIds = null;
                closeModal(modal);
                refreshUI();
                return;
            }

            if (!newTeamStartPeriod) {
                notify(
                    'Team created, but Start Period is blank so ' +
                    'the selected members could not be added. ' +
                    'Set a Start Period on the team to add them.',
                    'warning'
                );
                _pendingTeamMemberIds = null;
                closeModal(modal);
                refreshUI();
                return;
            }

            var assignments = [];
            for (var i = 0; i < pendingMembers.length; i++) {
                assignments.push({
                    teamId: newTeamId,
                    charId: pendingMembers[i],
                    joinPeriod: newTeamStartPeriod,
                    leavePeriod: '',
                    role: 'Member'
                });
            }

            return TeamCore.batchAddMembers(assignments)
                .then(function(addResult) {
                    _pendingTeamMemberIds = null;

                    if (!addResult || !addResult.success) {
                        notify(
                            'Team created, but the selected ' +
                            'members could not be added: ' +
                            ((addResult && addResult.message) ||
                                'unknown error.'),
                            'warning'
                        );
                    } else {
                        notify(
                            'Team created with ' +
                            (addResult.data
                                ? addResult.data.added
                                : pendingMembers.length) +
                            ' member' +
                            ((addResult.data &&
                                addResult.data.added === 1)
                                ? '' : 's') + '.',
                            'success'
                        );
                        // Selection has been consumed.
                        _poolSelectedIds = Object.create(null);
                    }

                    closeModal(modal);
                    refreshUI();
                })
                .catch(function(err) {
                    _pendingTeamMemberIds = null;
                    console.warn(
                        '[TeamEvents] batchAddMembers failed:',
                        err
                    );
                    notify(
                        'Team created, but adding members failed.',
                        'error'
                    );
                    closeModal(modal);
                    refreshUI();
                });
        }).catch(function(err) {
            _pendingTeamMemberIds = null;
            console.warn('[TeamEvents] saveTeam failed:', err);
            notify('Failed to save team.', 'error');
        });
    }

    function collectNameHistory(form) {
        var entries = form.querySelectorAll(
            '.name-history-entry'
        );
        var history = [];

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var nameEl = entry.querySelector(
                '.name-history-name'
            );
            var startEl = entry.querySelector(
                '.name-history-start'
            );
            var endEl = entry.querySelector(
                '.name-history-end'
            );

            var name = nameEl ? nameEl.value.trim() : '';
            if (!name) { continue; }

            history.push({
                name: name,
                startPeriod: startEl
                    ? startEl.value.trim()
                    : '',
                endPeriod: endEl
                    ? endEl.value.trim()
                    : ''
            });
        }

        return history;
    }

    // ============================================================
    // MATCHMAKING PLANNER
    // ============================================================

    function bindMatchmaking() {
        delegate('#team-matchmaking-btn', 'click', function(e) {
            e.preventDefault();
            openMatchmakingModal();
        });
    }

    function openMatchmakingModal() {
        if (_matchmakingModal) {
            try {
                Modal.closeModal(_matchmakingModal);
            } catch (e) {
                // Ignore.
            }
            _matchmakingModal = null;
        }

        var period = getCurrentPeriod('professional');
        if (period === null) {
            notify(
                'Cannot determine the current period for the ' +
                'planner.',
                'error'
            );
            return;
        }

        var targetSize = 3;

        var modal = Modal.createModal('team-matchmaking-modal');
        if (!modal) {
            notify('Could not open matchmaking planner.', 'error');
            return;
        }
        modal.id = 'team-matchmaking-modal';

        var contentEl = document.createElement('div');
        contentEl.className =
            'modal-content wide planner-content';
        modal.appendChild(contentEl);

        modal.__plannerState = {
            period: period,
            targetSize: targetSize,
            plannerVM: null
        };

        _matchmakingModal = modal;

        Modal.modalSetup(modal, function() {
            closeMatchmakingModal();
        });
        Modal.showModal(modal);

        renderPlanner(modal, contentEl);
        bindPlannerEvents(modal, contentEl);
    }

    function closeMatchmakingModal() {
        var modal = _matchmakingModal;
        _matchmakingModal = null;

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }

        refreshUI();
    }

    function renderPlanner(modal, contentEl) {
        var state = modal.__plannerState;
        if (!state) { return; }

        state.plannerVM =
            TeamAggregator.getMatchmakingPlannerViewModel({
                period: state.period,
                targetSize: state.targetSize
            });

        var vm = state.plannerVM;
        vm.mode = 'planner';

        contentEl.innerHTML =
            TeamMatchmakingView.renderHTML(vm);
    }

    function bindPlannerEvents(modal, contentEl) {
        contentEl.addEventListener('click', function(e) {
            var actionEl = e.target.closest
                ? e.target.closest('[data-action]')
                : null;
            if (!actionEl || !actionEl.dataset) { return; }

            var action = actionEl.dataset.action;
            if (action === 'matchmaking-close') {
                e.preventDefault();
                closeMatchmakingModal();
                return;
            }
            if (action === 'matchmaking-commit') {
                e.preventDefault();
                handlePlannerCommit(modal, contentEl);
                return;
            }
        });
    }

    function handlePlannerCommit(modal, contentEl) {
        var state = modal.__plannerState;
        if (!state) { return; }

        var checkboxes = contentEl.querySelectorAll(
            '.planner-assoc-checkbox'
        );

        var assignments = [];
        var invalidRows = [];

        for (var i = 0; i < checkboxes.length; i++) {
            var box = checkboxes[i];
            if (!box.checked) { continue; }

            var teamId = box.dataset.teamId;
            var charId = box.dataset.characterId;

            if (!teamId || !charId) { continue; }

            var joinEl = contentEl.querySelector(
                '.planner-assoc-join' +
                '[data-team-id="' + cssEscape(teamId) + '"]' +
                '[data-character-id="' +
                    cssEscape(charId) + '"]'
            );
            var leaveEl = contentEl.querySelector(
                '.planner-assoc-leave' +
                '[data-team-id="' + cssEscape(teamId) + '"]' +
                '[data-character-id="' +
                    cssEscape(charId) + '"]'
            );

            var joinRaw = joinEl ? joinEl.value.trim() : '';
            var leaveRaw = leaveEl ? leaveEl.value.trim() : '';

            var joinNum = parsePositiveInteger(joinRaw);
            if (joinNum === null) {
                invalidRows.push({
                    teamId: teamId,
                    charId: charId,
                    reason: 'Join year is required.'
                });
                continue;
            }

            var leaveStr = '';
            if (leaveRaw !== '') {
                var leaveNum = parsePositiveInteger(leaveRaw);
                if (leaveNum === null) {
                    invalidRows.push({
                        teamId: teamId,
                        charId: charId,
                        reason: 'Leave year must be a positive ' +
                            'integer or blank.'
                    });
                    continue;
                }
                if (leaveNum < joinNum) {
                    invalidRows.push({
                        teamId: teamId,
                        charId: charId,
                        reason: 'Leave year cannot be before join ' +
                            'year.'
                    });
                    continue;
                }
                leaveStr = String(leaveNum);
            }

            assignments.push({
                teamId: teamId,
                charId: charId,
                joinPeriod: String(joinNum),
                leavePeriod: leaveStr,
                role: 'Member'
            });
        }

        if (invalidRows.length > 0) {
            var first = invalidRows[0];
            notify(
                'Cannot commit: ' + invalidRows.length +
                ' assignment' +
                (invalidRows.length === 1 ? '' : 's') +
                ' invalid. First: ' + first.reason,
                'error'
            );
            return;
        }

        if (assignments.length === 0) {
            notify('No assignments selected.', 'info');
            return;
        }

        TeamCore.batchAddMembers(assignments)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        (result && result.message) ||
                            'Failed to commit assignments.',
                        'error'
                    );
                    return;
                }
                notify(
                    'Added ' + result.data.added +
                    ' member' +
                    (result.data.added === 1 ? '' : 's') +
                    ' across ' + result.data.teamsTouched +
                    ' team' +
                    (result.data.teamsTouched === 1 ? '' : 's') +
                    '.',
                    'success'
                );
                closeMatchmakingModal();
            })
            .catch(function(err) {
                console.warn(
                    '[TeamEvents] batchAddMembers failed:', err
                );
                notify('Failed to commit assignments.', 'error');
            });
    }

    // ============================================================
    // VERIFY
    // ============================================================

    function bindVerify() {
        delegate('#team-verify-btn', 'click', function(e) {
            e.preventDefault();
            openVerifierModal();
        });
    }

    function openVerifierModal() {
        var VerifierView = window.TeamVerifierView || null;
        if (!VerifierView ||
            typeof VerifierView.openModal !== 'function') {
            console.warn(
                '[TeamEvents] TeamVerifierView module is not ' +
                'loaded.'
            );
            notify('Team verifier is not available.', 'error');
            return;
        }

        try {
            VerifierView.openModal();
        } catch (err) {
            console.warn(
                '[TeamEvents] TeamVerifierView.openModal threw:',
                err
            );
            notify(
                'Team verifier failed to open: ' +
                (err && err.message ? err.message : String(err)),
                'error'
            );
        }
    }

    // ============================================================
    // EXPORTS
    // ============================================================

    function bindTeamExport() {
        delegate('#team-export-btn', 'click', function(e) {
            e.preventDefault();

            var Picker = window.TeamExportPicker || null;
            if (!Picker || typeof Picker.openModal !== 'function') {
                notify('Team export is not available.', 'error');
                return;
            }

            try {
                Picker.openModal();
            } catch (err) {
                console.warn(
                    '[TeamEvents] TeamExportPicker.openModal ' +
                    'threw:', err
                );
                notify(
                    'Team export failed: ' + err.message,
                    'error'
                );
            }
        });
    }

    function bindCandidateExport() {
        delegate('#export-candidates-btn', 'click', function(e) {
            e.preventDefault();

            var Exporter = window.CandidateExport || null;
            if (!Exporter || typeof Exporter.export !== 'function') {
                notify(
                    'Candidate export is not available.',
                    'error'
                );
                return;
            }

            if (TeamUI.getCurrentTab() !== 'professional' ||
                _viewMode !== 'pool') {
                notify(
                    'Candidate export is only available in the ' +
                    'Professional Pool view.',
                    'error'
                );
                return;
            }

            var period = getCurrentPeriod('professional');
            if (period === null) {
                notify(
                    'No period available for candidate export.',
                    'error'
                );
                return;
            }

            try {
                var result = Exporter.export({
                    period: period
                });
                if (result && result.exported) {
                    notify(
                        'Exported ' + result.count +
                        ' candidate' +
                        (result.count === 1 ? '' : 's') +
                        ': ' + result.filename,
                        'success'
                    );
                    return;
                }
                notify(
                    'Candidate export failed: ' +
                    ((result && result.error) || 'Unknown error'),
                    'error'
                );
            } catch (err) {
                console.warn(
                    '[TeamEvents] CandidateExport.export threw:', err
                );
                notify(
                    'Candidate export failed: ' + err.message,
                    'error'
                );
            }
        });
    }

    // ============================================================
    // TEAM ROW ACTIONS
    // ============================================================

    function bindTeamActions() {
        delegate('.edit-team', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) {
                _pendingTeamMemberIds = null;
                showTeamForm(teamId);
            }
        });

        delegate('.delete-team', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) { deleteTeam(teamId); }
        });

        delegate('.manage-members', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) { openMemberManager(teamId); }
        });

        delegate('.manage-rankings', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) { showRankingModal(teamId); }
        });

        delegate('.export-team', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) { openTeamExportPicker(teamId); }
        });

        delegate('.toggle-members', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (!teamId) { return; }

            var current = TeamUI.getExpandedTeamId();
            if (current && String(current) === String(teamId)) {
                TeamUI.setExpandedTeamId(null);
            } else {
                TeamUI.setExpandedTeamId(teamId);
            }

            refreshUI();
        });
    }

    function openTeamExportPicker(teamId) {
        var Picker = window.TeamExportPicker || null;
        if (!Picker || typeof Picker.openModal !== 'function') {
            notify('Team export is not available.', 'error');
            return;
        }

        try {
            Picker.openModal({ teamId: teamId });
        } catch (err) {
            console.warn(
                '[TeamEvents] TeamExportPicker.openModal threw:',
                err
            );
            notify(
                'Team export failed: ' + err.message,
                'error'
            );
        }
    }

    function deleteTeam(teamId) {
        var name = TeamQueries.getTeamName(teamId) || 'this team';
        if (!confirm('Delete "' + name +
            '"? The team will be removed from the manager.')) {
            return;
        }

        TeamCore.deleteTeam(teamId).then(function(result) {
            if (!result || !result.success) { return; }

            if (TeamUI.getExpandedTeamId() === teamId) {
                TeamUI.setExpandedTeamId(null);
            }

            refreshUI();
        }).catch(function(err) {
            console.warn(
                '[TeamEvents] deleteTeam failed:', err
            );
            notify('Failed to delete team.', 'error');
        });
    }

    // ============================================================
    // MEMBER MANAGER
    // ============================================================

    function openMemberManager(teamId, overridePeriod) {
        if (!isNonEmptyString(teamId)) { return; }

        var period = overridePeriod;

        if (period === undefined || period === null ||
            typeof period !== 'number' || period < 1) {
            var currentTab = TeamUI.getCurrentTab();
            period = getCurrentPeriod(currentTab);
        }

        if (period === null) {
            notify(
                'Cannot determine the current period.',
                'error'
            );
            return;
        }

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
            notify(
                'Could not open the member manager.',
                'error'
            );
            return;
        }
        modal.id = 'member-manager-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        modal.appendChild(contentEl);

        _memberManagerModal = modal;

        Modal.modalSetup(modal, function() {
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
    // RANKING MODAL
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
                    escapeHtmlSafe(vm.teamName) +
                    ' - Ranking History' +
                '</h3>';
        html += '<button type="button" class="close-modal">' +
                    '&times;' +
                '</button>';
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

        Modal.showModal(modal);

        bindRankingModalEvents(modal, contentEl, teamId);
    }

    function escapeHtmlSafe(value) {
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

    function bindRankingModalEvents(modal, contentEl, teamId) {
        function close() {
            closeModal(modal);
        }

        var closeBtn = contentEl.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
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
            if (!removeBtn) { return; }
            e.preventDefault();

            var period = removeBtn.dataset.period;
            if (!period) { return; }

            if (!confirm('Remove this ranking entry?')) {
                return;
            }

            TeamCore.removeRanking(teamId, period)
                .then(function(result) {
                    if (result && result.success) {
                        refreshRankingListInPlace(
                            modal, teamId
                        );
                        refreshUI();
                    }
                })
                .catch(function(err) {
                    console.warn(
                        '[TeamEvents] removeRanking failed:', err
                    );
                    notify(
                        'Failed to remove ranking.',
                        'error'
                    );
                });
        });
    }

    function addRankingFromModal(modal, contentEl, teamId) {
        var periodEl = contentEl.querySelector(
            '#ranking-period'
        );
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
                if (periodEl) { periodEl.value = ''; }
                if (rankEl) { rankEl.value = ''; }
                refreshRankingListInPlace(modal, teamId);
                refreshUI();
            })
            .catch(function(err) {
                console.warn(
                    '[TeamEvents] addRanking failed:', err
                );
                notify('Failed to add ranking.', 'error');
            });
    }

    function refreshRankingListInPlace(modal, teamId) {
        var vm = TeamAggregator.getRankingModalViewModel(teamId);
        if (!vm) { return; }

        var listContainer = modal.querySelector('#ranking-list');
        if (listContainer) {
            listContainer.innerHTML =
                TeamRender.renderRankingList(vm);
        }
    }

    // ============================================================
    // FILTERS
    // ============================================================

    function bindFilters() {
        delegate('#apply-filter-btn', 'click', function(e) {
            e.preventDefault();
            applyFilters();
        });

        delegate('#team-filter-year', 'keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyFilters();
            }
        });

        delegate('.filter-container input[type="checkbox"]',
            'change',
            function() {
                applyFilters();
            }
        );
    }

    function applyFilters() {
        var tab = TeamUI.getCurrentTab();

        if (tab === 'professional' || tab === 'temporary') {
            var yearEl = _container.querySelector(
                '#team-filter-year'
            );
            if (yearEl) {
                var yearRaw = yearEl.value.trim();
                if (yearRaw === '') {
                    TeamUI.setFilter(tab, 'filterYear', '');
                } else {
                    var yearNum = parseInt(yearRaw, 10);
                    if (!isNaN(yearNum) && yearNum >= 1) {
                        TeamUI.setFilter(
                            tab, 'filterYear', yearNum
                        );
                    }
                }
            }
        }

        var inactiveEl = _container.querySelector(
            '#' + tab + '-show-inactive'
        );
        if (inactiveEl) {
            TeamUI.setFilter(
                tab,
                'filterStatus',
                inactiveEl.checked ? 'inactive' : 'active'
            );
        }

        refreshUI();
    }

    // ============================================================
    // MODAL CLOSE HELPER
    // ============================================================

    function closeModal(modal) {
        if (!modal) { return; }
        try {
            Modal.closeModal(modal);
        } catch (e) {
            console.warn(
                '[TeamEvents] modal close failed:', e
            );
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamEvents = Object.freeze({
        init: init,
        destroy: destroy,

        refreshUI: refreshUI,

        showTeamForm: showTeamForm,
        showRankingModal: showRankingModal,
        openMemberManager: openMemberManager,
        openMatchmakingModal: openMatchmakingModal,
        openVerifierModal: openVerifierModal
    });

})();
