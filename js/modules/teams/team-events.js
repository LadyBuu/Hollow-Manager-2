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
 *   - Own the TEAM LIST's selection set (for bulk export).
 *   - Own the periods editor's DOM-only staging.
 *   - Open the team export picker and the candidate export.
 *   - Open the team verifier modal.
 *   - Open the kill-team modal.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Domain logic. TeamCore owns mutations; TeamQueries owns reads;
 *     TeamAggregator owns projections.
 *   - Rendering. TeamRender owns HTML.
 *   - Eligibility. TeamQueries.getProfessionalPersonnelAtPeriod
 *     owns it.
 *   - The verifier's checks. TeamVerifier owns them.
 *   - The verifier's HTML. TeamVerifierView owns it.
 *   - The kill modal's HTML and per-character mutation.
 *     TeamKillModal owns them.
 *   - The single-file bulk export. TeamExport owns it.
 *   - The specialisation vocabulary. MissionConstants owns it.
 *   - The periods shape. TeamCore owns the schema.
 *
 * VIEW MODES:
 *   'teams' | 'pool' | 'timeline'. Module-level. Forced to 'teams'
 *   on non-professional tabs. Reset on init and destroy.
 *
 * POOL STATE:
 *   _poolExpandedIds  { [characterId]: true }
 *   _poolSelectedIds  { [characterId]: true }
 *
 * TEAM SELECTION STATE:
 *   _teamSelectedIds  { [teamId]: true }
 *
 * PERIODS EDITOR:
 *   The team form's periods editor is a DOM-only staging area.
 *   Rows can be added, removed, reordered by the user; chip
 *   lists within each row can be edited. Nothing hits the store
 *   until submit, when collectPeriodsFromForm reads every row
 *   back out.
 *
 *   Handlers:
 *
 *     #add-team-period-btn         appends a new row
 *     .team-period-remove          removes the row it is inside
 *     .team-period-specialisation-add
 *                                  adds a chip within its row
 *     .team-specialisation-remove  removes the chip it is inside
 *
 *   The add-row handler inherits the previous row's tactical
 *   style and specialisations, per the periods model. The new
 *   row's start year defaults to the current application year;
 *   the previous row's end year is auto-set to (start - 1) unless
 *   the user has already given it an explicit end.
 *
 *   All four handlers bind on the modal, not through the
 *   container delegation chain. The form is its own modal shell
 *   and is not a descendant of the teams container.
 *
 * EXPORT BUTTONS:
 *   Page header Export button (#team-export-btn)
 *     Bulk. Exports every ticked team into ONE file.
 *
 *   Per-row .export-team button
 *     Single team. Exports that team directly with no picker
 *     when it has one period; opens the picker when it has more
 *     than one, so the user chooses which period to export.
 *
 * TIMELINE STATE:
 *   _timelineYearStart, _timelineYearEnd, _timelineExpandedYears.
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
 *   - window.TeamExport       (bulk and single-team export)
 *   - window.TeamExportPicker (per-row single-team export)
 *   - window.CandidateExport
 *   - window.TeamVerifierView
 *   - window.TeamKillModal
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
    if (!TeamQueries ||
        typeof TeamQueries.getPeriods !== 'function') {
        _missing.push('TeamQueries.getPeriods');
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

    function escapeAttribute(value) {
        if (window.DomUtils &&
            typeof window.DomUtils.escapeAttribute === 'function') {
            return window.DomUtils.escapeAttribute(value);
        }
        return escapeHtml(value);
    }

    function getApplicationYear() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }
        return new Date().getFullYear();
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

    var _timelineYearStart = null;
    var _timelineYearEnd = null;
    var _timelineExpandedYears = Object.create(null);

    var _poolExpandedIds = Object.create(null);
    var _poolSelectedIds = Object.create(null);

    var _teamSelectedIds = Object.create(null);

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
        pageVM.teamSelectedIds = _teamSelectedIds;

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
        _teamSelectedIds = Object.create(null);
        _pendingTeamMemberIds = null;

        bindTabSwitching();
        bindModeToggle();
        bindAddTeam();
        bindMatchmaking();
        bindVerify();
        bindTeamExport();
        bindTeamSelection();
        bindCandidateExport();
        bindTeamActions();
        bindKillTeam();
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
        _teamSelectedIds = Object.create(null);
        _pendingTeamMemberIds = null;
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function bindTabSwitching() {
        delegate('.tab-btn', 'click', function(e, target) {
            var tab = target.dataset.tab;
            if (!tab) { return; }

            var previousTab = TeamUI.getCurrentTab();
            if (tab !== previousTab) {
                _teamSelectedIds = Object.create(null);
            }

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

    function bindPoolActions() {
        delegate(
            '[data-action="pool-toggle-expand"]',
            'click',
            function(e, target) {
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

        delegate(
            '.pool-select-cell',
            'click',
            function(e) {
                if (e.stopPropagation) {
                    e.stopPropagation();
                }
            }
        );

        delegate(
            '#pool-clear-selection',
            'click',
            function(e) {
                e.preventDefault();
                _poolSelectedIds = Object.create(null);
                refreshUI();
            }
        );

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
    // TEAM SELECTION (bulk export)
    // ============================================================

    function bindTeamSelection() {
        delegate(
            '.team-select-checkbox',
            'change',
            function(e, target) {
                if (e.stopPropagation) {
                    e.stopPropagation();
                }

                var teamId = target.dataset.teamId;
                if (!teamId) { return; }

                if (target.checked) {
                    _teamSelectedIds[String(teamId)] = true;
                } else {
                    delete _teamSelectedIds[String(teamId)];
                }

                refreshUI();
            }
        );

        delegate(
            '.team-select-cell',
            'click',
            function(e) {
                if (e.stopPropagation) {
                    e.stopPropagation();
                }
            }
        );
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

        if (!editId &&
            Array.isArray(_pendingTeamMemberIds) &&
            _pendingTeamMemberIds.length > 0) {
            prependPendingMembersStrip(
                contentEl, _pendingTeamMemberIds
            );
        }

        Modal.modalSetup(modal, function() {
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

        var grid = form.querySelector('.form-grid');
        if (grid && grid.parentNode) {
            grid.parentNode.insertBefore(strip, grid);
        } else {
            form.insertBefore(strip, form.firstChild);
        }
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

        // ---- Periods editor: add / remove / chips ----

        var addPeriodBtn = contentEl.querySelector(
            '#add-team-period-btn'
        );
        if (addPeriodBtn) {
            addPeriodBtn.addEventListener('click', function() {
                appendPeriodRow(form);
            });
        }

        contentEl.addEventListener('click', function(e) {
            var target = e.target;
            if (!target || typeof target.closest !== 'function') {
                return;
            }

            // ---- Remove a period row ----
            var removePeriodBtn = target.closest(
                '.team-period-remove'
            );
            if (removePeriodBtn) {
                e.preventDefault();
                removePeriodRow(form, removePeriodBtn);
                return;
            }

            // ---- Add a specialisation chip in this row ----
            var addSpecBtn = target.closest(
                '.team-period-specialisation-add'
            );
            if (addSpecBtn) {
                e.preventDefault();
                appendSpecialisationChip(addSpecBtn);
                return;
            }

            // ---- Remove a specialisation chip ----
            var removeSpecBtn = target.closest(
                '.team-specialisation-remove'
            );
            if (removeSpecBtn) {
                e.preventDefault();
                removeSpecialisationChip(removeSpecBtn);
                return;
            }
        });

        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveTeam(form, modal);
        });
    }

    // ============================================================
    // PERIODS EDITOR
    // ============================================================
    //
    // All four helpers below operate on the DOM only. Nothing
    // hits the store until saveTeam runs.

    /**
     * Append a new period row to the periods list.
     *
     * The new row inherits the previous row's tactical style and
     * specialisations (per the periods model). Its start year is
     * the current application year; the previous row's end year
     * is auto-set to (start - 1) unless it already has an
     * explicit end.
     *
     * The new row becomes the LAST row, so its end year input is
     * disabled and read-only (the open-ended current period). The
     * previously-last row loses that treatment and gains a normal
     * end input.
     */
    function appendPeriodRow(form) {
        var list = form.querySelector('#team-periods-list');
        if (!list) { return; }

        var rows = list.querySelectorAll('.team-period-row');
        var lastRow = rows.length > 0
            ? rows[rows.length - 1]
            : null;

        var inheritedStyle = '';
        var inheritedSpecs = [];

        if (lastRow) {
            var styleEl = lastRow.querySelector(
                '.team-period-style'
            );
            if (styleEl) {
                inheritedStyle = String(styleEl.value || '');
            }

            var chipEls = lastRow.querySelectorAll(
                '.team-specialisation-chip'
            );
            for (var c = 0; c < chipEls.length; c++) {
                var id = chipEls[c].dataset.specialisationId;
                if (!isNonEmptyString(id)) { continue; }
                var nameEl = chipEls[c].querySelector(
                    '.team-specialisation-chip-name'
                );
                var label = nameEl
                    ? String(nameEl.textContent || '')
                    : id;
                inheritedSpecs.push({ id: id, label: label });
            }
        }

        // ---- Determine the new row's start year ----
        var newStart = getApplicationYear();

        // ---- Auto-close the previous row at (newStart - 1) ----
        if (lastRow) {
            var prevEndEl = lastRow.querySelector(
                '.team-period-end'
            );
            // The previous row was the last, so its end was a
            // disabled input. Convert it to an editable number
            // input and set its value.
            if (prevEndEl) {
                var wasLastDisabled =
                    prevEndEl.hasAttribute('disabled');
                if (wasLastDisabled) {
                    replaceEndInputWithEditable(
                        prevEndEl, String(newStart - 1)
                    );
                } else {
                    var currentEnd = String(prevEndEl.value || '');
                    if (currentEnd === '') {
                        prevEndEl.value = String(newStart - 1);
                    }
                }
            }

            // Remove the "(open)" hint and its wrapper treatment
            // on the previous row's end field.
            var hint = lastRow.querySelector(
                '.team-period-field-hint'
            );
            if (hint && hint.parentNode) {
                hint.parentNode.removeChild(hint);
            }

            // The previous row is no longer the last. Update its
            // data attribute and clear the readonly / disabled
            // flags on the end input.
            lastRow.dataset.isLast = 'false';
        }

        // ---- Build the new row ----
        var newRowHtml = buildNewPeriodRowHTML(
            newStart,
            inheritedStyle,
            inheritedSpecs,
            getSpecialisationOptions(form)
        );

        var wrapper = document.createElement('div');
        wrapper.innerHTML = newRowHtml;
        var newRow = wrapper.firstElementChild;
        if (!newRow) { return; }

        list.appendChild(newRow);

        // ---- Re-index every row ----
        reindexPeriodRows(list);

        // ---- Refresh the remove buttons visibility ----
        updateRemoveButtons(list);

        // ---- Focus the new row's name input ----
        var newNameEl = newRow.querySelector('.team-period-name');
        if (newNameEl && typeof newNameEl.focus === 'function') {
            setTimeout(function() {
                try { newNameEl.focus(); } catch (e) {}
            }, 0);
        }
    }

    /**
     * Replace the previous row's disabled end input with an
     * editable number input carrying the given value.
     */
    function replaceEndInputWithEditable(oldInput, value) {
        var newInput = document.createElement('input');
        newInput.type = 'number';
        newInput.className = 'team-period-end';
        newInput.min = '1';
        newInput.value = value;
        newInput.placeholder = 'Year';
        if (oldInput && oldInput.parentNode) {
            oldInput.parentNode.replaceChild(newInput, oldInput);
        }
    }

    /**
     * Build the HTML for a single new period row. Mirrors the
     * renderer's row markup, but with the new row's data.
     */
    function buildNewPeriodRowHTML(
        startYear, style, specialisations, options
    ) {
        var startStr = String(startYear);

        var html = '';
        html += '<div class="team-period-row" ' +
                    'data-period-index="0" ' +
                    'data-is-last="true">';

        html += '<div class="team-period-row-header">';
        html += '<span class="team-period-row-label">' +
                    'Period' +
                '</span>';
        html += '<button type="button" ' +
                    'class="small danger team-period-remove" ' +
                    'data-period-index="0" ' +
                    'title="Remove this period">' +
                    '\u2715' +
                '</button>';
        html += '</div>';

        html += '<div class="team-period-row-fields">';

        html += '<div class="team-period-field team-period-field-name">';
        html += '<label class="team-period-field-label">Name</label>';
        html += '<input type="text" class="team-period-name" ' +
                    'value="" ' +
                    'placeholder="e.g., Rapid">';
        html += '</div>';

        html += '<div class="team-period-field team-period-field-start">';
        html += '<label class="team-period-field-label">Start</label>';
        html += '<input type="number" class="team-period-start" ' +
                    'min="1" value="' +
                    escapeAttribute(startStr) + '" ' +
                    'placeholder="Year">';
        html += '</div>';

        html += '<div class="team-period-field team-period-field-end">';
        html += '<label class="team-period-field-label">End</label>';
        html += '<input type="text" class="team-period-end" ' +
                    'value="" placeholder="present" ' +
                    'readonly disabled>';
        html += '<span class="team-period-field-hint">(open)</span>';
        html += '</div>';

        html += '</div>';

        html += '<div class="team-period-tactical-style-row">';
        html += '<label class="team-period-field-label">' +
                    'Tactical Style' +
                '</label>';
        html += '<textarea class="team-period-style" rows="3" ' +
                    'placeholder="How the team works together. ' +
                    'Fighting style, doctrine, tone.">' +
                    escapeHtml(style) +
                '</textarea>';
        html += '</div>';

        // ---- Specialisations ----
        html += '<div class="team-period-specialisations-row">';
        html += '<label class="team-period-field-label">' +
                    'Specialisations' +
                '</label>';

        html += '<div class="team-period-specialisation-input-group">';
        html += buildSpecialisationSelectHTML(
            specialisations, options
        );
        html += '<button type="button" ' +
                    'class="small primary ' +
                    'team-period-specialisation-add"' +
                    (options.length === 0 ? ' disabled' : '') + '>' +
                    '+ Add' +
                '</button>';
        html += '</div>';

        html += '<div class="team-period-specialisation-chips">';
        if (specialisations.length === 0) {
            html += '<p class="empty-state small">' +
                        'No specialisations selected.' +
                    '</p>';
        } else {
            for (var i = 0; i < specialisations.length; i++) {
                var s = specialisations[i];
                html += renderSpecialisationChipHTML(s.id, s.label);
            }
        }
        html += '</div>';

        html += '</div>';

        html += '</div>';
        return html;
    }

    function buildSpecialisationSelectHTML(selected, options) {
        var selectedSet = Object.create(null);
        for (var i = 0; i < selected.length; i++) {
            selectedSet[selected[i].id] = true;
        }

        var available = [];
        for (var j = 0; j < options.length; j++) {
            var opt = options[j];
            if (!opt || !isNonEmptyString(opt.id)) { continue; }
            if (selectedSet[opt.id] === true) { continue; }
            available.push(opt);
        }

        var html = '';
        html += '<select class="team-period-specialisation-select"' +
                    (available.length === 0 ? ' disabled' : '') + '>';

        if (available.length === 0) {
            var placeholderText = options.length === 0
                ? 'No specialisations available'
                : 'All specialisations already selected';
            html += '<option value="" disabled selected>' +
                        escapeHtml(placeholderText) +
                    '</option>';
        } else {
            html += '<option value="">Select...</option>';
            for (var a = 0; a < available.length; a++) {
                var avail = available[a];
                html += '<option value="' +
                            escapeAttribute(avail.id) + '">' +
                            escapeHtml(avail.label) +
                        '</option>';
            }
        }

        html += '</select>';
        return html;
    }

    function renderSpecialisationChipHTML(id, label) {
        var html = '';
        html += '<div class="team-specialisation-chip" ' +
                    'data-specialisation-id="' +
                        escapeAttribute(id) + '">';
        html += '<span class="team-specialisation-chip-name">' +
                    escapeHtml(label) +
                '</span>';
        html += '<button type="button" class="small danger ' +
                    'team-specialisation-remove" ' +
                    'data-specialisation-id="' +
                        escapeAttribute(id) + '">' +
                    '\u2715' +
                '</button>';
        html += '</div>';
        return html;
    }

    /**
     * Read the specialisation options off the form's first row.
     * The renderer emits them as <option> elements inside the
     * select; we harvest the id/label pairs from there so the new
     * row's select shows the same vocabulary.
     */
    function getSpecialisationOptions(form) {
        var result = [];
        var seen = Object.create(null);

        var selects = form.querySelectorAll(
            '.team-period-specialisation-select'
        );
        for (var s = 0; s < selects.length; s++) {
            var opts = selects[s].querySelectorAll('option');
            for (var o = 0; o < opts.length; o++) {
                var opt = opts[o];
                var id = String(opt.value || '');
                if (id === '') { continue; }
                if (seen[id]) { continue; }
                seen[id] = true;
                result.push({
                    id: id,
                    label: String(opt.textContent || id)
                });
            }
        }

        // Any option already selected in an existing row is
        // included too — the renderer removes it from the select
        // when it is a chip, but the vocabulary must still be
        // complete for other rows.
        var chips = form.querySelectorAll(
            '.team-specialisation-chip'
        );
        for (var c = 0; c < chips.length; c++) {
            var chipId = chips[c].dataset.specialisationId;
            if (!isNonEmptyString(chipId)) { continue; }
            if (seen[chipId]) { continue; }
            var nameEl = chips[c].querySelector(
                '.team-specialisation-chip-name'
            );
            var label = nameEl
                ? String(nameEl.textContent || '')
                : chipId;
            seen[chipId] = true;
            result.push({ id: chipId, label: label });
        }

        result.sort(function(a, b) {
            return a.label.localeCompare(b.label);
        });

        return result;
    }

    /**
     * Remove the period row the button lives inside.
     *
     * The last remaining row is never removed: a team must always
     * have at least one period. The button is not rendered when
     * there is only one row, but a defensive check here protects
     * against a stale button.
     */
    function removePeriodRow(form, button) {
        var list = form.querySelector('#team-periods-list');
        if (!list) { return; }

        var rows = list.querySelectorAll('.team-period-row');
        if (rows.length <= 1) {
            notify(
                'A team must have at least one period.',
                'warning'
            );
            return;
        }

        var row = button.closest
            ? button.closest('.team-period-row')
            : null;
        if (!row) { return; }

        var wasLast = row.dataset.isLast === 'true';
        row.parentNode.removeChild(row);

        // ---- If the removed row was the last one, the new last
        //      row becomes the open-ended current period. ----
        if (wasLast) {
            var remaining = list.querySelectorAll(
                '.team-period-row'
            );
            var newLast = remaining[remaining.length - 1];
            if (newLast) {
                promoteToCurrentPeriod(newLast);
            }
        }

        reindexPeriodRows(list);
        updateRemoveButtons(list);
    }

    /**
     * Turn a row into the open-ended current period: disable and
     * clear its end input, add the "(open)" hint, set the
     * data-is-last flag.
     */
    function promoteToCurrentPeriod(row) {
        row.dataset.isLast = 'true';

        var endEl = row.querySelector('.team-period-end');
        if (endEl) {
            // Replace with a disabled, read-only text input.
            var replacement = document.createElement('input');
            replacement.type = 'text';
            replacement.className = 'team-period-end';
            replacement.value = '';
            replacement.placeholder = 'present';
            replacement.readOnly = true;
            replacement.disabled = true;

            if (endEl.parentNode) {
                endEl.parentNode.replaceChild(replacement, endEl);
            }
        }

        // Add the "(open)" hint if not present.
        var fieldEnd = row.querySelector(
            '.team-period-field-end'
        );
        if (fieldEnd && !fieldEnd.querySelector(
            '.team-period-field-hint'
        )) {
            var hint = document.createElement('span');
            hint.className = 'team-period-field-hint';
            hint.textContent = '(open)';
            fieldEnd.appendChild(hint);
        }
    }

    /**
     * Renumber every row's data-period-index and the labels on
     * their remove buttons.
     */
    function reindexPeriodRows(list) {
        var rows = list.querySelectorAll('.team-period-row');
        for (var i = 0; i < rows.length; i++) {
            rows[i].dataset.periodIndex = String(i);

            var label = rows[i].querySelector(
                '.team-period-row-label'
            );
            if (label) {
                var isLast = rows[i].dataset.isLast === 'true';
                label.textContent = isLast
                    ? 'Period ' + (i + 1) + ' (current)'
                    : 'Period ' + (i + 1);
            }

            var removeBtn = rows[i].querySelector(
                '.team-period-remove'
            );
            if (removeBtn) {
                removeBtn.dataset.periodIndex = String(i);
            }
        }
    }

    /**
     * Show or hide the remove button on each row. The remove is
     * hidden when there is only one row.
     */
    function updateRemoveButtons(list) {
        var rows = list.querySelectorAll('.team-period-row');
        var showRemove = rows.length > 1;

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var existing = row.querySelector(
                '.team-period-remove'
            );

            if (showRemove && !existing) {
                var header = row.querySelector(
                    '.team-period-row-header'
                );
                if (!header) { continue; }
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'small danger team-period-remove';
                btn.dataset.periodIndex = String(i);
                btn.title = 'Remove this period';
                btn.textContent = '\u2715';
                header.appendChild(btn);
            } else if (!showRemove && existing) {
                existing.parentNode.removeChild(existing);
            }
        }
    }

    /**
     * Append a specialisation chip to the row the Add button
     * lives in. Refuses duplicates within the same row.
     */
    function appendSpecialisationChip(addButton) {
        var row = addButton.closest
            ? addButton.closest('.team-period-row')
            : null;
        if (!row) { return; }

        var select = row.querySelector(
            '.team-period-specialisation-select'
        );
        var chipsHost = row.querySelector(
            '.team-period-specialisation-chips'
        );
        if (!select || !chipsHost) { return; }

        var id = select.value;
        if (!id) {
            notify('Select a specialisation first.', 'warning');
            return;
        }

        // Duplicate check within the row.
        var existing = chipsHost.querySelectorAll(
            '.team-specialisation-chip'
        );
        for (var i = 0; i < existing.length; i++) {
            if (existing[i].dataset.specialisationId === id) {
                notify(
                    'That specialisation is already selected.',
                    'warning'
                );
                select.value = '';
                return;
            }
        }

        var label = '';
        for (var o = 0; o < select.options.length; o++) {
            if (select.options[o].value === id) {
                label = String(select.options[o].textContent || '');
                break;
            }
        }
        if (!label) { label = id; }

        var empty = chipsHost.querySelector('.empty-state');
        if (empty) {
            empty.parentNode.removeChild(empty);
        }

        var wrapper = document.createElement('div');
        wrapper.innerHTML = renderSpecialisationChipHTML(id, label);
        var chip = wrapper.firstElementChild;
        if (chip) {
            chipsHost.appendChild(chip);
        }

        // Remove the now-used option from the select so it does
        // not appear twice.
        for (var s = 0; s < select.options.length; s++) {
            if (select.options[s].value === id) {
                select.removeChild(select.options[s]);
                break;
            }
        }
        select.value = '';

        // If the select just became empty, disable it and set a
        // placeholder.
        if (select.options.length === 0) {
            select.disabled = true;
            var placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.selected = true;
            placeholder.textContent =
                'All specialisations already selected';
            select.appendChild(placeholder);
        }
    }

    /**
     * Remove the specialisation chip the button lives inside.
     * Restores the option to the row's select.
     */
    function removeSpecialisationChip(button) {
        var chip = button.closest
            ? button.closest('.team-specialisation-chip')
            : null;
        if (!chip) { return; }

        var id = chip.dataset.specialisationId;
        var label = '';
        var nameEl = chip.querySelector(
            '.team-specialisation-chip-name'
        );
        if (nameEl) {
            label = String(nameEl.textContent || '');
        }

        var row = chip.closest('.team-period-row');
        var chipsHost = chip.parentNode;
        chip.parentNode.removeChild(chip);

        if (chipsHost && chipsHost.querySelectorAll(
            '.team-specialisation-chip'
        ).length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state small';
            empty.textContent = 'No specialisations selected.';
            chipsHost.appendChild(empty);
        }

        // ---- Restore the option to the select ----
        if (row && id) {
            var select = row.querySelector(
                '.team-period-specialisation-select'
            );
            if (select) {
                // If the select was disabled with the "all selected"
                // placeholder, clear it first.
                if (select.disabled) {
                    select.innerHTML = '';
                    select.disabled = false;
                    var initial = document.createElement('option');
                    initial.value = '';
                    initial.textContent = 'Select...';
                    select.appendChild(initial);
                }

                // Insert in alphabetical order among the existing
                // options, so the list stays sorted.
                var newOption = document.createElement('option');
                newOption.value = id;
                newOption.textContent = label || id;

                var inserted = false;
                var opts = select.querySelectorAll('option');
                for (var i = 1; i < opts.length; i++) {
                    var optLabel = String(
                        opts[i].textContent || ''
                    );
                    if ((label || id).localeCompare(optLabel) < 0) {
                        select.insertBefore(
                            newOption, opts[i]
                        );
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) {
                    select.appendChild(newOption);
                }

                select.value = '';
            }
        }
    }

    // ============================================================
    // FORM SUBMIT
    // ============================================================

    function saveTeam(form, modal) {
        var editId = form.dataset.editId || null;

        var nameEl = form.querySelector('#team-name');
        var typeEl = form.querySelector('#team-type');
        var classEl = form.querySelector('#team-class');
        var numberEl = form.querySelector('#team-number');
        var statusEl = form.querySelector('#team-status');
        var missionEl = form.querySelector('#team-mission');

        var currentName = nameEl ? nameEl.value.trim() : '';
        if (!currentName) {
            notify('Team name is required.', 'error');
            return;
        }

        var type = typeEl ? typeEl.value : 'professional';
        var status = statusEl ? statusEl.value : 'active';

        var temporaryMission = missionEl
            ? (missionEl.value || null)
            : null;

        // ---- Collect periods ----
        var periods = collectPeriodsFromForm(form);
        if (periods === null) {
            // collectPeriodsFromForm already notified.
            return;
        }

        // ---- The top-level name writes to the last period. ----
        //
        // The user may have edited the current name at the top of
        // the form without touching the periods editor. That
        // edit is the authoritative value for the current
        // period's name.
        if (periods.length > 0) {
            periods[periods.length - 1].name = currentName;
        }

        // ---- Build the update payload ----
        //
        // We pass the periods array directly. TeamCore reads
        // periods[last].name as the denormalised name, and reads
        // periods[0].start / periods[last].end as the scalar
        // start / end mirrors. There is no separate start / end
        // input at the top of the form anymore.
        var teamData = {
            name: currentName,
            type: type,
            status: status,
            classId: classEl ? classEl.value : null,
            teamNumber: numberEl ? numberEl.value.trim() : '',
            temporaryMission: temporaryMission,
            periods: periods
        };

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

            if (editId) {
                _pendingTeamMemberIds = null;
                closeModal(modal);
                refreshUI();
                return;
            }

            var newTeamId = result.data &&
                result.data.team &&
                result.data.team.id
                ? String(result.data.team.id)
                : null;

            // The team's start period is now periods[0].start;
            // use it as the join year for the pending members.
            var newTeamStartPeriod = '';
            if (result.data &&
                result.data.team &&
                Array.isArray(result.data.team.periods) &&
                result.data.team.periods.length > 0) {
                var first = result.data.team.periods[0];
                if (first && isNonEmptyString(first.startPeriod)) {
                    newTeamStartPeriod = String(first.startPeriod);
                }
            }

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
                    'Team created, but its first period has no ' +
                    'start year, so the selected members could not ' +
                    'be added. Set a start year on the first period ' +
                    'to add them.',
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

    /**
     * Read every period row out of the form.
     *
     * Returns an array of { startPeriod, endPeriod, name,
     * tacticalStyle, specialisations }, or null on a validation
     * failure (with a notification already shown).
     *
     * Validation performed here:
     *   - name is required on every row
     *   - start is required and a positive integer
     *   - end (when present) is a positive integer >= start
     *   - the last row's end is forced to ''
     */
    function collectPeriodsFromForm(form) {
        var list = form.querySelector('#team-periods-list');
        if (!list) {
            notify('Periods list is missing.', 'error');
            return null;
        }

        var rows = list.querySelectorAll('.team-period-row');
        if (rows.length === 0) {
            notify(
                'A team must have at least one period.',
                'error'
            );
            return null;
        }

        var result = [];

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var isLast = (i === rows.length - 1);

            var nameEl = row.querySelector('.team-period-name');
            var startEl = row.querySelector('.team-period-start');
            var endEl = row.querySelector('.team-period-end');
            var styleEl = row.querySelector('.team-period-style');

            var name = nameEl
                ? String(nameEl.value || '').trim()
                : '';
            if (name === '') {
                notify(
                    'Period ' + (i + 1) + ' requires a name.',
                    'error'
                );
                return null;
            }

            var startRaw = startEl
                ? String(startEl.value || '').trim()
                : '';
            var startNum = parsePositiveInteger(startRaw);
            if (startNum === null) {
                notify(
                    'Period ' + (i + 1) +
                    ' requires a valid start year.',
                    'error'
                );
                return null;
            }

            // The last row is the open-ended current period.
            // Its end is always '' regardless of what the input
            // says (the input is disabled).
            var endCanon = '';
            if (!isLast) {
                var endRaw = endEl
                    ? String(endEl.value || '').trim()
                    : '';
                if (endRaw === '') {
                    notify(
                        'Period ' + (i + 1) +
                        ' requires an end year.',
                        'error'
                    );
                    return null;
                }
                var endNum = parsePositiveInteger(endRaw);
                if (endNum === null) {
                    notify(
                        'Period ' + (i + 1) +
                        ' has an invalid end year.',
                        'error'
                    );
                    return null;
                }
                if (endNum < startNum) {
                    notify(
                        'Period ' + (i + 1) +
                        ' ends before it starts.',
                        'error'
                    );
                    return null;
                }
                endCanon = String(endNum);
            }

            var style = styleEl
                ? String(styleEl.value || '')
                : '';

            var specialisations = collectSpecialisationIdsFromRow(row);

            result.push({
                startPeriod: String(startNum),
                endPeriod: endCanon,
                name: name,
                tacticalStyle: style,
                specialisations: specialisations
            });
        }

        return result;
    }

    function collectSpecialisationIdsFromRow(row) {
        var chips = row.querySelectorAll(
            '.team-specialisation-chip'
        );
        var ids = [];
        for (var i = 0; i < chips.length; i++) {
            var id = chips[i].dataset.specialisationId;
            if (isNonEmptyString(id)) {
                ids.push(id);
            }
        }
        return ids;
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
            handleBulkTeamExport();
        });
    }

    function handleBulkTeamExport() {
        var Exporter = window.TeamExport || null;
        if (!Exporter ||
            typeof Exporter.exportTeamsText !== 'function') {
            notify(
                'Team export is not available.',
                'error'
            );
            return;
        }

        var selectedIds = objectKeysWithTrue(_teamSelectedIds);

        if (selectedIds.length === 0) {
            notify(
                'Select at least one team to export.',
                'info'
            );
            return;
        }

        var result = null;
        try {
            result = Exporter.exportTeamsText(selectedIds);
        } catch (err) {
            console.warn(
                '[TeamEvents] TeamExport.exportTeamsText threw:',
                err
            );
            notify(
                'Export failed: ' +
                (err && err.message ? err.message : String(err)),
                'error'
            );
            return;
        }

        if (result && result.exported) {
            var msg = 'Exported ' + result.count + ' team' +
                (result.count === 1 ? '' : 's') +
                ': ' + result.filename;
            if (typeof result.skipped === 'number' &&
                result.skipped > 0) {
                msg += ' (' + result.skipped +
                    ' skipped)';
            }
            notify(msg, 'success');

            _teamSelectedIds = Object.create(null);
            refreshUI();
            return;
        }

        notify(
            'Export failed: ' +
            ((result && result.error) || 'Unknown error'),
            'error'
        );
    }

    function openTeamExportPicker(teamId, options) {
        options = options || {};

        var Picker = window.TeamExportPicker || null;
        if (!Picker || typeof Picker.openModal !== 'function') {
            notify('Team export is not available.', 'error');
            return;
        }

        try {
            Picker.openModal({
                teamId: teamId,
                direct: options.direct === true
            });
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
            if (!teamId) { return; }

            // The period picker is only shown when the team has
            // more than one period. A single-period team exports
            // directly, matching the previous behaviour.
            var team = null;
            try {
                team = TeamQueries.getTeamById(teamId);
            } catch (err) {
                team = null;
            }

            var periodCount = 0;
            if (team) {
                var periods = TeamQueries.getPeriods(team);
                periodCount = periods.length;
            }

            if (periodCount <= 1) {
                openTeamExportPicker(teamId, { direct: true });
            } else {
                openTeamExportPicker(teamId, { direct: false });
            }
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

    // ============================================================
    // KILL TEAM
    // ============================================================

    function bindKillTeam() {
        delegate('.kill-team', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();

            var teamId = target.dataset.id;
            if (!teamId) { return; }

            var Killer = window.TeamKillModal || null;
            if (!Killer ||
                typeof Killer.openModal !== 'function') {
                notify(
                    'Kill Team is not available. ' +
                    'TeamKillModal is not loaded.',
                    'error'
                );
                return;
            }

            try {
                Killer.openModal(teamId);
            } catch (err) {
                console.warn(
                    '[TeamEvents] TeamKillModal.openModal threw:',
                    err
                );
                notify(
                    'Failed to open Kill Team: ' +
                    (err && err.message ? err.message : String(err)),
                    'error'
                );
            }
        });
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

            delete _teamSelectedIds[String(teamId)];

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
                    escapeHtml(vm.teamName) +
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

        if (tab === 'professional') {
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
