/**
 * modules/teams/team-events.js - Team Events
 * Event orchestration for the Team domain.
 *
 * Path: js/modules/teams/team-events.js
 *
 * RESPONSIBILITIES:
 *   - init / destroy: bind and unbind delegated listeners on the
 *     container.
 *   - Route user interactions to TeamCore mutations.
 *   - Update TeamUI state.
 *   - Request fresh VMs from TeamAggregator and TeamQueries.
 *   - Hand VMs to TeamRender.
 *   - Open and close modals.
 *   - Read and write form field values.
 *   - Own the matchmaking modal's proposal state.
 *   - Own the professional tab's view mode (Teams / Unassigned /
 *     Timeline).
 *   - Own the timeline's year-range and expanded-years state.
 *   - Open the team export picker (TeamExportPicker).
 *
 * IMPORTANT:
 *   - Orchestration only. No domain reads beyond TeamQueries,
 *     TeamAggregator, and the two scalar reads
 *     (window.data.currentYear, the tab's filterYear).
 *   - No HTML construction beyond the modal shells. All inner
 *     markup comes from the renderers.
 *   - TeamCore owns mutations; TeamAggregator owns projections;
 *     TeamUI owns transient state; TeamRender owns HTML.
 *   - Mutation results are Promises. On success, request a fresh
 *     VM and re-render. On failure, the pipeline has already
 *     notified; do not double-notify.
 *   - Delegation is scoped to the container. Modal shells are
 *     appended to document.body and are wired directly by the
 *     function that opens them.
 *
 * VIEW MODES:
 *   The professional tab carries a three-way toggle:
 *
 *     [ Teams | Unassigned | Timeline ]
 *
 *   The mode is a module-level string (`_viewMode`). It is NOT
 *   part of TeamUI's persisted state. Reset to 'teams' on init
 *   and on leaving the professional tab.
 *
 *   On the professional tab:
 *     'teams'      the default. List of teams with filters.
 *     'unassigned' the roster of candidates and staff.
 *     'timeline'   the vertical timeline.
 *
 *   On the Temporary and Civilian tabs, only 'teams' is
 *   meaningful. `_viewMode` is forced to 'teams' when the user
 *   switches to a non-professional tab.
 *
 * TIMELINE STATE:
 *   Three pieces of module-level state:
 *
 *     _timelineYearStart      number | null
 *     _timelineYearEnd        number | null
 *     _timelineExpandedYears  { [year]: true }
 *
 *   The year range defaults to [currentYear - 20, currentYear + 5]
 *   the first time the Timeline view is shown. The user can edit
 *   the range with the two inputs at the top of the timeline. The
 *   Apply button rebuilds the VM with the new range.
 *
 *   The expanded-years map survives range changes. If the user
 *   expands 1918 and then changes the range, 1918 stays expanded
 *   if it is still in range.
 *
 *   The map is cleared on init and on leaving the timeline mode.
 *
 * TIMELINE INTERACTIONS:
 *   - Click a year circle (`.timeline-circle[data-year]`)
 *     toggles that year in the expanded map.
 *   - Click a team name (`.timeline-team-name[data-team-id]`)
 *     opens the member manager modal for that team at the year
 *     of the click.
 *   - Click `#timeline-apply-btn` rebuilds the VM with the
 *     current input values.
 *   - Click `#timeline-expand-all-btn` marks every year in the
 *     current VM as expanded.
 *   - Click `#timeline-collapse-all-btn` clears the expanded map.
 *
 *   All five are bound via `delegate()` on the container so they
 *   survive re-renders.
 *
 * TEAM EXPORT:
 *   The Export button lives in the Teams page header. It opens
 *   the team export picker (TeamExportPicker). The picker owns
 *   the format choice (JSON / CSV) and the status filter; this
 *   module only opens it.
 *
 *   The picker is resolved LAZILY at click time so a missing
 *   module produces a toast, not a boot-time crash.
 *
 * MATCHMAKING MODAL:
 *   Unchanged. The candidate rows carry the career milestone
 *   fields (juniorYear, seniorYear, supportYear, instructorYear,
 *   milestoneYear, milestoneLabel). This module preserves those
 *   fields when it augments the raw matcher output.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamCore
 *   - window.TeamQueries
 *   - window.TeamAggregator
 *   - window.TeamUI
 *   - window.TeamRender
 *   - window.TeamMatchmaking
 *   - window.TeamMatchmakingView
 *   - window.Modal
 *   - window.MemberManager
 *   - window.MemberAdapterTeams
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (LAZY, resolved at click time):
 *   - window.TeamExportPicker  (Export button)
 *   - window.TimelineQueries   (via TeamAggregator, for the VM)
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
    var TeamMatchmaking = window.TeamMatchmaking;
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
        typeof TeamAggregator.getTeamMatchmakingViewModel !==
            'function') {
        _missing.push(
            'TeamAggregator.getTeamMatchmakingViewModel'
        );
    }
    if (!TeamAggregator ||
        typeof TeamAggregator.getUnassignedViewModel !==
            'function') {
        _missing.push(
            'TeamAggregator.getUnassignedViewModel'
        );
    }
    if (!TeamAggregator ||
        typeof TeamAggregator.getTimelineViewModel !==
            'function') {
        _missing.push(
            'TeamAggregator.getTimelineViewModel'
        );
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

    if (!TeamMatchmaking ||
        typeof TeamMatchmaking.buildProposal !== 'function') {
        _missing.push('TeamMatchmaking.buildProposal');
    }

    if (!TeamMatchmakingView ||
        typeof TeamMatchmakingView.renderHTML !== 'function') {
        _missing.push('TeamMatchmakingView.renderHTML');
    }
    if (!TeamMatchmakingView ||
        typeof TeamMatchmakingView.collectSetup !== 'function') {
        _missing.push('TeamMatchmakingView.collectSetup');
    }
    if (!TeamMatchmakingView ||
        typeof TeamMatchmakingView.readAddSelect !== 'function') {
        _missing.push('TeamMatchmakingView.readAddSelect');
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

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _initialized = false;
    var _container = null;
    var _eventListeners = [];

    var _memberManagerModal = null;
    var _matchmakingModal = null;

    // Professional-tab view mode. One of 'teams', 'unassigned',
    // 'timeline'. Module-level, not persisted. See the VIEW MODES
    // note in the file header.
    var _viewMode = 'teams';

    // Timeline state. See the TIMELINE STATE note in the file
    // header.
    var _timelineYearStart = null;
    var _timelineYearEnd = null;
    var _timelineExpandedYears = Object.create(null);

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
                // Ignore
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

        // The unassigned and timeline modes are only meaningful on
        // the professional tab. If the user is on another tab,
        // force Teams mode. This keeps the toggle from leaking
        // state across tabs.
        if (currentTab !== 'professional') {
            _viewMode = 'teams';
        }

        var pageVM = TeamAggregator.getTeamPageViewModel({
            type: currentTab,
            period: period,
            expandedTeamId:
                _viewMode === 'teams' ? expandedTeamId : null
        });

        // Restore the persisted expandedTeamId when we come back
        // to Teams mode.
        if (_viewMode === 'teams' &&
            pageVM.expandedTeamId !== expandedTeamId) {
            TeamUI.setExpandedTeamId(pageVM.expandedTeamId);
        }

        // Attach mode-specific VMs.
        pageVM.viewMode = _viewMode;

        if (currentTab === 'professional' &&
            _viewMode === 'unassigned') {
            var unassignedVM = null;
            try {
                unassignedVM =
                    TeamAggregator.getUnassignedViewModel();
            } catch (e) {
                console.warn(
                    '[TeamEvents] getUnassignedViewModel failed:', e
                );
                unassignedVM = null;
            }
            pageVM.unassignedVM = unassignedVM;
        } else {
            pageVM.unassignedVM = null;
        }

        if (currentTab === 'professional' &&
            _viewMode === 'timeline') {
            ensureTimelineRange();
            var timelineVM = null;
            try {
                timelineVM =
                    TeamAggregator.getTimelineViewModel({
                        start: _timelineYearStart,
                        end: _timelineYearEnd
                    });
            } catch (e) {
                console.warn(
                    '[TeamEvents] getTimelineViewModel failed:', e
                );
                timelineVM = null;
            }
            pageVM.timelineVM = timelineVM;
            pageVM.timelineExpandedYears = _timelineExpandedYears;
        } else {
            pageVM.timelineVM = null;
            pageVM.timelineExpandedYears = null;
        }

        _container.innerHTML =
            TeamRender.renderContainer(pageVM);

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

    /**
     * Ensure the timeline year range has a value. Sets defaults on
     * first use; does nothing once a range is present.
     *
     * Default: [currentYear - 20, currentYear + 5]. If the
     * application year is unavailable, [1900, 1930] is used as a
     * fallback so the user sees something.
     */
    function ensureTimelineRange() {
        if (_timelineYearStart !== null &&
            _timelineYearEnd !== null) {
            return;
        }

        var currentYear = getApplicationYear();
        if (currentYear === null) {
            _timelineYearStart = 1900;
            _timelineYearEnd = 1930;
            return;
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

        // Reset transient state. A remount is a fresh start.
        _viewMode = 'teams';
        _timelineYearStart = null;
        _timelineYearEnd = null;
        _timelineExpandedYears = Object.create(null);

        bindTabSwitching();
        bindModeToggle();
        bindAddTeam();
        bindMatchmaking();
        bindTeamExport();
        bindTeamActions();
        bindFilters();
        bindTimelineActions();

        _initialized = true;
    }

    function destroy() {
        if (_memberManagerModal) {
            try {
                Modal.closeModal(_memberManagerModal);
            } catch (e) {
                // Ignore
            }
            _memberManagerModal = null;
        }

        if (_matchmakingModal) {
            try {
                Modal.closeModal(_matchmakingModal);
            } catch (e) {
                // Ignore
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
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function bindTabSwitching() {
        delegate('.tab-btn', 'click', function(e, target) {
            var tab = target.dataset.tab;
            if (!tab) { return; }

            // Leaving the professional tab resets the view mode.
            if (tab !== 'professional') {
                _viewMode = 'teams';
            }

            TeamUI.setCurrentTab(tab);
            refreshUI();
        });
    }

    // ============================================================
    // MODE TOGGLE (professional tab only)
    // ============================================================

    function bindModeToggle() {
        delegate('.mode-btn', 'click', function(e, target) {
            e.preventDefault();

            // Guard: the toggle only makes sense on the
            // professional tab.
            if (TeamUI.getCurrentTab() !== 'professional') {
                return;
            }

            var mode = target.dataset.mode;
            if (mode !== 'teams' &&
                mode !== 'unassigned' &&
                mode !== 'timeline') {
                return;
            }

            if (mode === _viewMode) { return; }

            _viewMode = mode;

            // When entering Unassigned or Timeline mode, collapse
            // any expanded team. The expanded team is not rendered
            // there.
            if (_viewMode !== 'teams') {
                TeamUI.setExpandedTeamId(null);
            }

            // Reset the expanded-years map when leaving Timeline
            // mode. Re-entering starts from a clean slate.
            if (_viewMode !== 'timeline') {
                _timelineExpandedYears = Object.create(null);
            }

            refreshUI();
        });
    }

    // ============================================================
    // TIMELINE ACTIONS
    // ============================================================
    //
    // Five handlers, all delegated on the container so they survive
    // re-renders:
    //
    //   .timeline-circle[data-year]         toggle that year
    //   .timeline-team-name[data-team-id]   open member manager
    //   #timeline-apply-btn                 rebuild with new range
    //   #timeline-expand-all-btn            expand every year
    //   #timeline-collapse-all-btn          collapse every year
    //
    // See the TIMELINE INTERACTIONS note in the file header.

    function bindTimelineActions() {
        // ---- Year circle ----
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

        // ---- Team name in a composition line ----
        delegate('.timeline-team-name', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();

            var teamId = target.dataset.teamId;
            if (!teamId) { return; }

            // The team name lives inside a year row. Use the row's
            // data-year to open the member manager at the year of
            // the click, not at the current application year.
            var row = target.closest('.timeline-year');
            var year = row
                ? parseInt(row.dataset.year, 10)
                : NaN;

            openMemberManager(
                teamId,
                isNaN(year) || year < 1 ? null : year
            );
        });

        // ---- Apply range ----
        delegate('#timeline-apply-btn', 'click', function(e) {
            e.preventDefault();
            applyTimelineRange();
        });

        // ---- Enter key on the range inputs ----
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

        // ---- Expand all / collapse all ----
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

        // Normalise an inverted range.
        var lo = Math.min(startNum, endNum);
        var hi = Math.max(startNum, endNum);

        _timelineYearStart = lo;
        _timelineYearEnd = hi;

        // Drop expanded years that are now outside the range so the
        // map does not grow without bound as the user scrolls
        // through history.
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
        // Read the range currently in the DOM so we expand exactly
        // the years the user is looking at, not everything the
        // aggregator could produce.
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
    // ADD TEAM
    // ============================================================

    function bindAddTeam() {
        delegate('#add-team-btn', 'click', function(e) {
            e.preventDefault();
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

        Modal.showModal(modal);

        bindTeamFormEvents(modal, contentEl);
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

        var teamData = {
            name: name,
            type: type,
            startPeriod: startEl ? startEl.value : '',
            endPeriod: endEl ? endEl.value : '',
            status: status,
            classId: classEl ? classEl.value : null,
            teamNumber: numberEl ? numberEl.value.trim() : '',
            temporaryMission:
                (type === 'temporary' ||
                 type === 'professional')
                ? (missionEl ? missionEl.value : null)
                : null,
            nameHistory: collectNameHistory(form)
        };

        var promise = editId
            ? TeamCore.updateTeam(editId, teamData)
            : TeamCore.createTeam(teamData);

        promise.then(function(result) {
            if (!result || !result.success) { return; }
            closeModal(modal);
            refreshUI();
        }).catch(function(err) {
            console.warn(
                '[TeamEvents] saveTeam failed:', err
            );
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
    // MATCHMAKING
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
                // Ignore
            }
            _matchmakingModal = null;
        }

        var data = window.data || {};
        var defaultYear =
            typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0
                ? Math.floor(data.currentYear)
                : null;

        var modal = Modal.createModal('team-matchmaking-modal');
        if (!modal) {
            notify('Could not open matchmaking.', 'error');
            return;
        }
        modal.id = 'team-matchmaking-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide matchmaking-content';
        modal.appendChild(contentEl);

        modal.__matchmakingState = {
            mode: 'setup',
            setupYear: defaultYear,
            setupTargetSize: 3,
            year: null,
            targetSize: null,
            candidatesById: Object.create(null),
            assignments: [],
            unassigned: []
        };

        _matchmakingModal = modal;

        Modal.modalSetup(modal, function() {
            closeMatchmakingModal();
        });
        Modal.showModal(modal);

        renderMatchmaking(modal, contentEl);
        bindMatchmakingEvents(modal, contentEl);
    }

    function closeMatchmakingModal() {
        var modal = _matchmakingModal;
        _matchmakingModal = null;

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore
            }
        }

        refreshUI();
    }

    function renderMatchmaking(modal, contentEl) {
        var state = modal.__matchmakingState;
        if (!state) { return; }

        if (state.mode === 'setup') {
            contentEl.innerHTML =
                TeamMatchmakingView.renderHTML({
                    mode: 'setup',
                    defaultYear: state.setupYear,
                    defaultTargetSize: state.setupTargetSize
                });
        } else {
            contentEl.innerHTML =
                TeamMatchmakingView.renderHTML({
                    mode: 'proposal',
                    year: state.year,
                    targetSize: state.targetSize,
                    assignments: state.assignments,
                    unassigned: state.unassigned,
                    candidatesById: state.candidatesById
                });
        }
    }

    function bindMatchmakingEvents(modal, contentEl) {
        contentEl.addEventListener('click', function(e) {
            var actionEl = e.target.closest
                ? e.target.closest('[data-action]')
                : null;
            if (!actionEl || !actionEl.dataset) { return; }

            var action = actionEl.dataset.action;
            switch (action) {
                case 'matchmaking-close':
                    e.preventDefault();
                    closeMatchmakingModal();
                    return;
                case 'matchmaking-build':
                    e.preventDefault();
                    handleMatchmakingBuild(modal, contentEl);
                    return;
                case 'matchmaking-back':
                    e.preventDefault();
                    handleMatchmakingBack(modal, contentEl);
                    return;
                case 'matchmaking-remove-addition':
                    e.preventDefault();
                    handleMatchmakingRemoveAddition(
                        modal, contentEl, actionEl
                    );
                    return;
                case 'matchmaking-add-addition':
                    e.preventDefault();
                    handleMatchmakingAddAddition(
                        modal, contentEl, actionEl
                    );
                    return;
                case 'matchmaking-commit':
                    e.preventDefault();
                    handleMatchmakingCommit(modal, contentEl);
                    return;
                default:
                    return;
            }
        });
    }

    function handleMatchmakingBuild(modal, contentEl) {
        var state = modal.__matchmakingState;
        if (!state) { return; }

        var form = TeamMatchmakingView.collectSetup(contentEl);
        if (!form) { return; }

        var year = parsePositiveInteger(form.year);
        if (year === null) {
            notify('Year must be a positive integer.', 'error');
            return;
        }

        var targetSize = parsePositiveInteger(form.targetSize);
        if (targetSize === null) {
            notify(
                'Target size must be a positive integer.',
                'error'
            );
            return;
        }

        state.setupYear = year;
        state.setupTargetSize = targetSize;

        var vm;
        try {
            vm = TeamAggregator.getTeamMatchmakingViewModel(
                year, targetSize
            );
        } catch (e) {
            console.warn(
                '[TeamEvents] getTeamMatchmakingViewModel failed:',
                e
            );
            notify('Failed to build matchmaking pool.', 'error');
            return;
        }

        if (!vm || vm.candidates.length === 0) {
            notify(
                'No eligible candidates for the selected year.',
                'info'
            );
        }

        var candidatesById = Object.create(null);
        for (var i = 0; i < vm.candidates.length; i++) {
            var c = vm.candidates[i];
            candidatesById[c.id] = c;
        }

        var raw = TeamMatchmaking.buildProposal({
            year: year,
            targetSize: targetSize,
            candidates: vm.candidates,
            targets: vm.targets
        });

        var assignments = [];
        var placedIds = Object.create(null);

        for (var a = 0; a < raw.assignments.length; a++) {
            var rawAsg = raw.assignments[a];
            var additions = [];
            for (var j = 0; j < rawAsg.additions.length; j++) {
                var addition = rawAsg.additions[j];
                placedIds[addition.id] = true;

                var full = candidatesById[addition.id];

                additions.push({
                    id: addition.id,
                    name: full ? full.name : addition.name,
                    status: full ? full.status : '',
                    history: full ? full.history : [],

                    juniorYear: full ? full.juniorYear : null,
                    seniorYear: full ? full.seniorYear : null,
                    supportYear: full ? full.supportYear : null,
                    instructorYear: full
                        ? full.instructorYear
                        : null,
                    milestoneYear: full
                        ? full.milestoneYear
                        : null,
                    milestoneLabel: full
                        ? full.milestoneLabel
                        : ''
                });
            }
            assignments.push({
                teamId: rawAsg.teamId,
                teamName: rawAsg.teamName,
                additions: additions
            });
        }

        var unassigned = [];
        for (var u = 0; u < vm.candidates.length; u++) {
            var cand = vm.candidates[u];
            if (placedIds[cand.id]) { continue; }
            unassigned.push(cand);
        }

        state.mode = 'proposal';
        state.year = year;
        state.targetSize = targetSize;
        state.candidatesById = candidatesById;
        state.assignments = assignments;
        state.unassigned = unassigned;

        renderMatchmaking(modal, contentEl);
    }

    function handleMatchmakingBack(modal, contentEl) {
        var state = modal.__matchmakingState;
        if (!state) { return; }

        state.mode = 'setup';
        state.year = null;
        state.targetSize = null;
        state.assignments = [];
        state.unassigned = [];
        state.candidatesById = Object.create(null);

        renderMatchmaking(modal, contentEl);
    }

    function handleMatchmakingRemoveAddition(
        modal, contentEl, actionEl
    ) {
        var state = modal.__matchmakingState;
        if (!state || state.mode !== 'proposal') { return; }

        var teamId = actionEl.dataset.teamId;
        var charId = actionEl.dataset.characterId;
        if (!teamId || !charId) { return; }

        var assignmentIndex = -1;
        for (var i = 0; i < state.assignments.length; i++) {
            if (state.assignments[i].teamId === teamId) {
                assignmentIndex = i;
                break;
            }
        }
        if (assignmentIndex === -1) { return; }

        var assignment = state.assignments[assignmentIndex];
        var additionIndex = -1;
        for (var j = 0; j < assignment.additions.length; j++) {
            if (assignment.additions[j].id === charId) {
                additionIndex = j;
                break;
            }
        }
        if (additionIndex === -1) { return; }

        var removed = assignment.additions.splice(
            additionIndex, 1
        )[0];

        var candidate = state.candidatesById[removed.id];
        if (candidate) {
            state.unassigned.push(candidate);
            state.unassigned.sort(function(a, b) {
                var aYear = (a && a.milestoneYear !== undefined &&
                             a.milestoneYear !== null)
                    ? a.milestoneYear
                    : null;
                var bYear = (b && b.milestoneYear !== undefined &&
                             b.milestoneYear !== null)
                    ? b.milestoneYear
                    : null;

                if (aYear !== null && bYear !== null) {
                    if (aYear !== bYear) { return aYear - bYear; }
                    return a.name.localeCompare(b.name);
                }
                if (aYear !== null) { return -1; }
                if (bYear !== null) { return 1; }
                return a.name.localeCompare(b.name);
            });
        }

        if (assignment.additions.length === 0) {
            state.assignments.splice(assignmentIndex, 1);
        }

        renderMatchmaking(modal, contentEl);
    }

    function handleMatchmakingAddAddition(
        modal, contentEl, actionEl
    ) {
        var state = modal.__matchmakingState;
        if (!state || state.mode !== 'proposal') { return; }

        var teamId = actionEl.dataset.teamId;
        if (!teamId) { return; }

        var select = contentEl.querySelector(
            '.matchmaking-add-select[data-team-id="' +
            cssEscape(teamId) + '"]'
        );
        if (!select) { return; }

        var charId = TeamMatchmakingView.readAddSelect(select);
        if (!charId) {
            notify('Select a character to add.', 'error');
            return;
        }

        var candidate = state.candidatesById[charId];
        if (!candidate) { return; }

        var assignment = null;
        for (var i = 0; i < state.assignments.length; i++) {
            if (state.assignments[i].teamId === teamId) {
                assignment = state.assignments[i];
                break;
            }
        }
        if (!assignment) {
            renderMatchmaking(modal, contentEl);
            return;
        }

        var unassignedIndex = -1;
        for (var u = 0; u < state.unassigned.length; u++) {
            if (state.unassigned[u].id === charId) {
                unassignedIndex = u;
                break;
            }
        }
        if (unassignedIndex !== -1) {
            state.unassigned.splice(unassignedIndex, 1);
        }

        assignment.additions.push(candidate);
        assignment.additions.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        renderMatchmaking(modal, contentEl);
    }

    function handleMatchmakingCommit(modal, contentEl) {
        var state = modal.__matchmakingState;
        if (!state || state.mode !== 'proposal') { return; }

        var flat = [];
        for (var i = 0; i < state.assignments.length; i++) {
            var assignment = state.assignments[i];
            for (var j = 0;
                 j < assignment.additions.length;
                 j++) {
                flat.push({
                    teamId: assignment.teamId,
                    charId: assignment.additions[j].id,
                    joinPeriod: String(state.year),
                    leavePeriod: '',
                    role: 'Member'
                });
            }
        }

        if (flat.length === 0) {
            notify('Nothing to commit.', 'info');
            return;
        }

        TeamCore.batchAddMembers(flat).then(function(result) {
            if (!result || !result.success) {
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
        }).catch(function(err) {
            console.warn(
                '[TeamEvents] batchAddMembers failed:', err
            );
            notify('Failed to commit proposal.', 'error');
        });
    }

    function cssEscape(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value).replace(/(["\\])/g, '\\$1');
    }

    // ============================================================
    // TEAM EXPORT
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

    // ============================================================
    // TEAM ROW ACTIONS
    // ============================================================

    function bindTeamActions() {
        delegate('.edit-team', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) {
                showTeamForm(teamId);
            }
        });

        delegate('.delete-team', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) {
                deleteTeam(teamId);
            }
        });

        delegate('.manage-members', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) {
                openMemberManager(teamId);
            }
        });

        delegate('.manage-rankings', 'click', function(e, target) {
            e.preventDefault();
            var teamId = target.dataset.id;
            if (teamId) {
                showRankingModal(teamId);
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
                // Ignore
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
                // Ignore
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
    // MODAL CLOSE
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
        openMatchmakingModal: openMatchmakingModal
    });

})();
