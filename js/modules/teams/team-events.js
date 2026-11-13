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
 *   - Own the rankings tab's year and expanded state.
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
 *   - The rankings tab body. TeamRankingsView owns it.
 *
 * RANKINGS TAB (ordered-list model, this revision):
 *   The Rankings tab renders a POSITION-ORDERED list per year.
 *   Rows are draggable; dragging a row onto another row inserts
 *   it at that position and shifts the tail down by one.
 *
 *   Interactions:
 *
 *     Drag a row onto another row
 *       TeamCore.moveRanking(teamId, year, newPosition).
 *       newPosition is the target row's position, adjusted for
 *       whether the drop was above or below the target row's
 *       midpoint. The controller reads the target row's
 *       data-position and the pointer's position within that
 *       row to compute newPosition.
 *
 *     Drag a row onto the empty area below the last row
 *       TeamCore.moveRanking(teamId, year, N) — append to the
 *       end. N is the row count plus one, read from the last
 *       row's data-position plus one.
 *
 *     Insert button (#rankings-insert-btn)
 *       TeamCore.insertRankingAt(teamId, year, position).
 *       A blank position means append (currentRows + 1),
 *       read from the button's data-current-rows.
 *
 *     Clear button (.rankings-clear-rank)
 *       TeamCore.removeRankingAt(teamId, year). Idempotent.
 *       After removal, the team drops out of `rows` and (if
 *       still active with no inherited rank) reappears in
 *       `unrankedTeams`.
 *
 *     Year apply button (#rankings-apply-year-btn, Enter in
 *     #rankings-year-input)
 *       Sets _rankingsYear; refreshes the tab.
 *
 *     Show Inactive toggle (#rankings-show-inactive)
 *       Sets _rankingsShowInactive; refreshes the tab.
 *
 *     Export year button (#rankings-export-year-btn)
 *       Calls TeamExport.exportTeamsByYear(_rankingsYear).
 *
 *   There is no click-to-edit rank input anymore. Position is
 *   a fact about the list, not a text field.
 *
 * PERIODS EDITOR (D2, this revision):
 *   The team form's periods editor is a DOM-only staging area.
 *   Rows can be added and removed by the user; chip lists
 *   within each row can be edited. Nothing hits the store
 *   until submit, when collectPeriodsFromForm reads every row
 *   back out.
 *
 *   The LAST period's end input is now a normal editable
 *   number input, not a read-only "present" placeholder. A
 *   blank end on the last row means the team is still ongoing;
 *   a non-blank end means the team disbanded at that year.
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
 *   row's start year defaults to one greater than the previous
 *   row's start, or the application year if the previous start
 *   cannot be parsed. The previous row's end year is auto-set
 *   to (start - 1) unless the user has already given it an
 *   explicit end.
 *
 *   Removing a row no longer promotes the remaining last row
 *   to a special "current" state. Every row's end input is
 *   editable at all times; removing a row simply leaves the
 *   new last row's end as the user last set it.
 *
 *   All four handlers bind on the modal, not through the
 *   container delegation chain. The form is its own modal shell
 *   and is not a descendant of the teams container.
 *
 * TOP-OF-FORM NAME AND nameIsAuto:
 *   Unchanged from the previous revision. The top-of-form name
 *   input and the last period's name input can both edit the
 *   current period's name; the submit-time resolution uses the
 *   dirty-check on the top field plus the team's nameIsAuto flag.
 *
 * SPECIALISATION VOCABULARY:
 *   Unchanged from the previous revision. The form VM's
 *   specialisationOptions is stashed on the modal, and
 *   getSpecialisationOptions(form) reads from that stash.
 *
 * TIMELINE STATE:
 *   Unchanged from the previous revision.
 *
 * MATCHMAKING PLANNER:
 *   Unchanged from the previous revision.
 *
 * EXPORT BUTTONS:
 *   Unchanged from the previous revision.
 *
 * MODAL LIFECYCLE:
 *   Unchanged from the previous revision.
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
 *   - window.TeamExport       (bulk, single-team, and by-year export)
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
    // ---- Rankings — ordered-list primitives ----
    if (!TeamCore || typeof TeamCore.insertRankingAt !== 'function') {
        _missing.push('TeamCore.insertRankingAt');
    }
    if (!TeamCore || typeof TeamCore.removeRankingAt !== 'function') {
        _missing.push('TeamCore.removeRankingAt');
    }
    if (!TeamCore || typeof TeamCore.moveRanking !== 'function') {
        _missing.push('TeamCore.moveRanking');
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
    if (!TeamAggregator ||
        typeof TeamAggregator.getTeamRankingsViewModel !==
        'function') {
        _missing.push('TeamAggregator.getTeamRankingsViewModel');
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
        typeof TeamRender.renderPeriodRow !== 'function') {
        _missing.push('TeamRender.renderPeriodRow');
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
        return String(value).replace(
            /["\\\n\r\t\f\b]/g,
            function(ch) {
                switch (ch) {
                    case '"':  return '\\"';
                    case '\\': return '\\\\';
                    case '\n': return '\\n';
                    case '\r': return '\\r';
                    case '\t': return '\\t';
                    case '\f': return '\\f';
                    case '\b': return '\\b';
                    default:   return ch;
                }
            }
        );
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
    var _rankingModal = null;

    var _viewMode = 'teams';

    var _timelineYearStart = null;
    var _timelineYearEnd = null;
    var _timelineExpandedYears = Object.create(null);

    var _poolExpandedIds = Object.create(null);
    var _poolSelectedIds = Object.create(null);

    var _teamSelectedIds = Object.create(null);

    // ---- Rankings — ordered-list ----
    var _rankingsYear = null;
    var _rankingsShowInactive = false;

    // Drag state (cleared on dragend and on refreshUI).
    var _rankDragTeamId = null;
    var _rankDragYear = null;

    var _pendingTeamMemberIds = null;

    var TIMELINE_MAX_SPAN = 200;

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
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }

        return null;
    }

    function getShowInactive(tab) {
        var filter = TeamUI.getFilter(tab);
        return filter && filter.showInactive === true;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function refreshUI() {
        if (!_container) { return; }

        // ---- Clear drag state before any re-render. ----
        _rankDragTeamId = null;
        _rankDragYear = null;

        var currentTab = TeamUI.getCurrentTab();
        var period = getCurrentPeriod(currentTab);
        var showInactive = getShowInactive(currentTab);
        var expandedTeamId = TeamUI.getExpandedTeamId();

        if (currentTab !== 'professional') {
            _viewMode = 'teams';
            _poolExpandedIds = Object.create(null);
            _poolSelectedIds = Object.create(null);
            _rankingsYear = null;
            _rankingsShowInactive = false;
        }

        var pageVM = TeamAggregator.getTeamPageViewModel({
            type: currentTab,
            period: period,
            showInactive: showInactive,
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

        if (currentTab === 'professional' &&
            _viewMode === 'rankings') {
            if (_rankingsYear === null) {
                _rankingsYear = period !== null
                    ? period
                    : getApplicationYear();
            }
            // ---- Ordered-list VM. No sort options. ----
            pageVM.rankingsVM =
                TeamAggregator.getTeamRankingsViewModel({
                    year: _rankingsYear,
                    showInactive: _rankingsShowInactive
                });
        } else {
            pageVM.rankingsVM = null;
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
        _rankingsYear = null;
        _rankingsShowInactive = false;
        _rankDragTeamId = null;
        _rankDragYear = null;
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
        bindRankingsActions();

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

        if (_rankingModal) {
            try {
                Modal.closeModal(_rankingModal);
            } catch (e) {
                // Ignore.
            }
            _rankingModal = null;
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
        _rankingsYear = null;
        _rankingsShowInactive = false;
        _rankDragTeamId = null;
        _rankDragYear = null;
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
                _rankingsYear = null;
                _rankingsShowInactive = false;
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
                mode !== 'timeline' &&
                mode !== 'rankings') {
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
            if (_viewMode !== 'rankings') {
                _rankingsYear = null;
                _rankingsShowInactive = false;
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

        if (hi - lo + 1 > TIMELINE_MAX_SPAN) {
            var originalSpan = hi - lo + 1;
            lo = hi - TIMELINE_MAX_SPAN + 1;
            notify(
                'Timeline range clamped to ' + TIMELINE_MAX_SPAN +
                ' years (requested span: ' + originalSpan + ').',
                'warning'
            );
        }

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
    // RANKINGS TAB ACTIONS — ordered-list model
    // ============================================================
    //
    // The Rankings tab is now a position-ordered list with
    // draggable rows and an insert strip. There is no click-to-
    // edit rank input and no sort controls.
    //
    // Interactions wired here:
    //
    //   #rankings-apply-year-btn, Enter in #rankings-year-input
    //     Commit the year.
    //
    //   #rankings-show-inactive (change)
    //     Toggle inactive teams.
    //
    //   #rankings-export-year-btn
    //     Export the year.
    //
    //   .rankings-clear-rank (click)
    //     TeamCore.removeRankingAt(teamId, year).
    //
    //   #rankings-insert-btn (click)
    //     TeamCore.insertRankingAt(teamId, year, position). Blank
    //     position means append (currentRows + 1).
    //
    //   .rankings-table-row (dragstart, dragover, dragleave,
    //                        drop, dragend)
    //     Drag-to-reorder. A drop on row N before its midpoint
    //     targets position N. A drop after its midpoint targets
    //     position N+1 (which is equivalent to "insert after row
    //     N", i.e. one position further down). The write is
    //     TeamCore.moveRanking(teamId, year, newPosition).
    //
    //     Visual feedback: the row under the pointer carries
    //     .drop-before or .drop-after (styled by teams.css).
    //     The dragged row carries .is-dragging.

    function bindRankingsActions() {
        delegate('#rankings-apply-year-btn', 'click', function(e) {
            e.preventDefault();
            applyRankingsYear();
        });

        delegate('#rankings-year-input', 'keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyRankingsYear();
            }
        });

        delegate(
            '#rankings-show-inactive',
            'change',
            function(e, target) {
                _rankingsShowInactive = target.checked === true;
                refreshUI();
            }
        );

        delegate(
            '#rankings-export-year-btn',
            'click',
            function(e) {
                e.preventDefault();
                handleRankingsExportYear();
            }
        );

        // ---- Clear entry ----
        delegate('.rankings-clear-rank', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();

            var teamId = target.dataset.teamId;
            var year = parseInt(target.dataset.year, 10);
            if (!teamId || isNaN(year)) { return; }

            handleRankingsClearEntry(teamId, year);
        });

        // ---- Insert strip ----
        delegate('#rankings-insert-btn', 'click', function(e, target) {
            e.preventDefault();
            handleRankingsInsert(target);
        });

        // ---- Drag-to-reorder ----
        delegate(
            '.rankings-table-row',
            'dragstart',
            function(e, target) {
                handleRankDragStart(e, target);
            }
        );
        delegate(
            '.rankings-table-row',
            'dragover',
            function(e, target) {
                handleRankDragOver(e, target);
            }
        );
        delegate(
            '.rankings-table-row',
            'dragleave',
            function(e, target) {
                handleRankDragLeave(e, target);
            }
        );
        delegate(
            '.rankings-table-row',
            'drop',
            function(e, target) {
                handleRankDrop(e, target);
            }
        );
        delegate(
            '.rankings-table-row',
            'dragend',
            function(e, target) {
                handleRankDragEnd(e, target);
            }
        );
    }

    function applyRankingsYear() {
        if (!_container) { return; }

        var input = _container.querySelector('#rankings-year-input');
        if (!input) { return; }

        var n = parsePositiveInteger(input.value);
        if (n === null) {
            notify('Year must be a positive integer.', 'error');
            return;
        }

        _rankingsYear = n;
        refreshUI();
    }

    function handleRankingsExportYear() {
        var Exporter = window.TeamExport || null;
        if (!Exporter ||
            typeof Exporter.exportTeamsByYear !== 'function') {
            notify('Team export is not available.', 'error');
            return;
        }

        if (_rankingsYear === null) {
            notify('No year selected.', 'error');
            return;
        }

        var result = null;
        try {
            result = Exporter.exportTeamsByYear(_rankingsYear);
        } catch (err) {
            console.warn(
                '[TeamEvents] exportTeamsByYear threw:', err
            );
            notify(
                'Export failed: ' +
                (err && err.message ? err.message : String(err)),
                'error'
            );
            return;
        }

        if (result && result.exported) {
            notify(
                'Exported ' + result.count + ' team' +
                (result.count === 1 ? '' : 's') +
                ' active in ' + _rankingsYear +
                ': ' + result.filename,
                'success'
            );
            return;
        }

        notify(
            'Export failed: ' +
            ((result && result.error) || 'Unknown error'),
            'error'
        );
    }

    function handleRankingsClearEntry(teamId, year) {
        if (!confirm(
            'Remove this team from the ranking at ' + year +
            '? The team will fall back to its previous explicit ' +
            'ranking, if any.'
        )) {
            return;
        }

        TeamCore.removeRankingAt(teamId, year)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        'Failed to remove ranking: ' +
                        ((result && result.message) ||
                            'Unknown error'),
                        'error'
                    );
                }
                refreshUI();
            })
            .catch(function(err) {
                console.warn(
                    '[TeamEvents] removeRankingAt failed:', err
                );
                notify('Failed to remove ranking.', 'error');
                refreshUI();
            });
    }

    function handleRankingsInsert(button) {
        if (!_container) { return; }

        var year = parseInt(button.dataset.year, 10);
        if (isNaN(year)) {
            // Fall back to the module year on a malformed
            // attribute.
            year = _rankingsYear;
        }
        if (year === null) {
            notify('No year selected.', 'error');
            return;
        }

        var select = _container.querySelector(
            '#rankings-insert-team'
        );
        var positionInput = _container.querySelector(
            '#rankings-insert-position'
        );

        if (!select) {
            notify('Pick a team to insert.', 'error');
            return;
        }

        var teamId = select.value;
        if (!teamId) {
            notify('Pick a team to insert.', 'error');
            return;
        }

        // A blank position means "append to the end". The
        // current row count is published on the button's
        // data-current-rows so we do not have to re-read the VM.
        var currentRows = parseInt(
            button.dataset.currentRows, 10
        );
        if (isNaN(currentRows) || currentRows < 0) {
            currentRows = 0;
        }

        var position = parsePositiveInteger(
            positionInput ? positionInput.value : ''
        );
        if (position === null) {
            position = currentRows + 1;
        }

        TeamCore.insertRankingAt(teamId, year, position)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        'Failed to insert ranking: ' +
                        ((result && result.message) ||
                            'Unknown error'),
                        'error'
                    );
                }
                refreshUI();
            })
            .catch(function(err) {
                console.warn(
                    '[TeamEvents] insertRankingAt failed:', err
                );
                notify('Failed to insert ranking.', 'error');
                refreshUI();
            });
    }

    // ---- Drag-to-reorder ----

    function handleRankDragStart(e, row) {
        var teamId = row.dataset.teamId;
        var position = parseInt(row.dataset.position, 10);

        if (!teamId || isNaN(position)) {
            e.preventDefault();
            return;
        }

        _rankDragTeamId = teamId;
        _rankDragYear = _rankingsYear;

        row.classList.add('is-dragging');

        if (e.dataTransfer) {
            try {
                e.dataTransfer.effectAllowed = 'move';
                // Some browsers require a data payload for the
                // drag to be considered valid.
                e.dataTransfer.setData(
                    'text/plain', teamId
                );
            } catch (err) {
                // Ignore.
            }
        }
    }

    function handleRankDragOver(e, row) {
        if (!_rankDragTeamId) { return; }

        var targetTeamId = row.dataset.teamId;
        if (targetTeamId === _rankDragTeamId) {
            // Dropping on the dragged row itself is a no-op.
            return;
        }

        e.preventDefault();
        if (e.dataTransfer) {
            try {
                e.dataTransfer.dropEffect = 'move';
            } catch (err) {
                // Ignore.
            }
        }

        // Decide before/after by pointer position within the
        // row.
        var rect = row.getBoundingClientRect();
        var isAfter = (e.clientY - rect.top) > (rect.height / 2);

        row.classList.remove('drop-before', 'drop-after');
        row.classList.add(isAfter ? 'drop-after' : 'drop-before');
    }

    function handleRankDragLeave(e, row) {
        row.classList.remove('drop-before', 'drop-after');
    }

    function handleRankDrop(e, row) {
        e.preventDefault();

        var draggedTeamId = _rankDragTeamId;
        var year = _rankDragYear;

        // Clear drag state immediately so a re-entrant event
        // cannot act on stale ids.
        _rankDragTeamId = null;
        _rankDragYear = null;

        row.classList.remove('drop-before', 'drop-after');
        var draggedRow = _container
            ? _container.querySelector('.rankings-table-row.is-dragging')
            : null;
        if (draggedRow) {
            draggedRow.classList.remove('is-dragging');
        }

        if (!draggedTeamId || year === null) { return; }

        var targetTeamId = row.dataset.teamId;
        if (targetTeamId === draggedTeamId) { return; }

        var targetPosition = parseInt(row.dataset.position, 10);
        if (isNaN(targetPosition)) { return; }

        // Before-vs-after decision, recomputed at drop time (the
        // dragover class is advisory; we do not trust it if the
        // pointer moved between dragover and drop).
        var rect = row.getBoundingClientRect();
        var isAfter = (e.clientY - rect.top) > (rect.height / 2);

        var newPosition = isAfter
            ? targetPosition + 1
            : targetPosition;

        TeamCore.moveRanking(draggedTeamId, year, newPosition)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        'Failed to reorder: ' +
                        ((result && result.message) ||
                            'Unknown error'),
                        'error'
                    );
                }
                refreshUI();
            })
            .catch(function(err) {
                console.warn(
                    '[TeamEvents] moveRanking failed:', err
                );
                notify('Failed to reorder.', 'error');
                refreshUI();
            });
    }

    function handleRankDragEnd(e, row) {
        _rankDragTeamId = null;
        _rankDragYear = null;

        if (row) {
            row.classList.remove(
                'is-dragging', 'drop-before', 'drop-after'
            );
        }
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

        modal.__specialisationOptions = Array.isArray(
            formVM.specialisationOptions
        )
            ? formVM.specialisationOptions.slice()
            : [];

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
            _pendingTeamMemberIds = null;
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

        var addPeriodBtn = contentEl.querySelector(
            '#add-team-period-btn'
        );
        if (addPeriodBtn) {
            addPeriodBtn.addEventListener('click', function() {
                appendPeriodRow(form, modal);
            });
        }

        contentEl.addEventListener('click', function(e) {
            var target = e.target;
            if (!target || typeof target.closest !== 'function') {
                return;
            }

            var removePeriodBtn = target.closest(
                '.team-period-remove'
            );
            if (removePeriodBtn) {
                e.preventDefault();
                removePeriodRow(form, removePeriodBtn);
                return;
            }

            var addSpecBtn = target.closest(
                '.team-period-specialisation-add'
            );
            if (addSpecBtn) {
                e.preventDefault();
                appendSpecialisationChip(addSpecBtn);
                return;
            }

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
    // PERIODS EDITOR (D2: closed last period is now allowed)
    // ============================================================
    //
    // The periods editor is a DOM-only staging area. Appending a
    // row adds a new period after the current last row; it does
    // NOT auto-close the previous last row's end input unless the
    // user left it blank (in which case it is set to newStart-1
    // so the previous period has a coherent end).
    //
    // Removing a row no longer promotes the remaining last row.
    // Every row's end input is editable at all times; removing
    // a row simply leaves the new last row's end as the user last
    // set it.
    //
    // collectPeriodsFromForm reads EVERY row's end input,
    // including the last. A blank end on the last row means
    // "still ongoing"; a non-blank end means the team disbanded
    // at that year.

    function appendPeriodRow(form, modal) {
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

        var newStart = getApplicationYear();

        if (lastRow) {
            var prevStartEl = lastRow.querySelector(
                '.team-period-start'
            );
            if (prevStartEl) {
                var prevStartNum = parsePositiveInteger(
                    prevStartEl.value
                );
                if (prevStartNum !== null &&
                    newStart <= prevStartNum) {
                    newStart = prevStartNum + 1;
                }
            }

            // ---- If the previous last row's end is blank,
            //      fill it with (newStart - 1) so the previous
            //      period has a coherent end. If it already has
            //      a non-blank end, leave it alone: the user
            //      set it, and we do not overwrite explicit
            //      values. ----
            var prevEndEl = lastRow.querySelector(
                '.team-period-end'
            );
            if (prevEndEl) {
                var currentEnd = String(prevEndEl.value || '').trim();
                if (currentEnd === '') {
                    prevEndEl.value = String(newStart - 1);
                }
            }
        }

        var newRowHtml = buildNewPeriodRowHTML(
            newStart,
            inheritedStyle,
            inheritedSpecs,
            getSpecialisationOptions(form, modal)
        );

        var wrapper = document.createElement('div');
        wrapper.innerHTML = newRowHtml;
        var newRow = wrapper.firstElementChild;
        if (!newRow) { return; }

        list.appendChild(newRow);

        reindexPeriodRows(list);
        updateRemoveButtons(list);

        var newNameEl = newRow.querySelector('.team-period-name');
        if (newNameEl && typeof newNameEl.focus === 'function') {
            setTimeout(function() {
                try { newNameEl.focus(); } catch (e) {}
            }, 0);
        }
    }

    function buildNewPeriodRowHTML(
        startYear, style, specialisations, options
    ) {
        var period = {
            startPeriod: String(startYear),
            endPeriod: '',
            name: '',
            tacticalStyle: style,
            specialisations: specialisations
        };
        return TeamRender.renderPeriodRow(
            period, 0, true, options, false
        );
    }

    function getSpecialisationOptions(form, modal) {
        var result = [];
        var seen = Object.create(null);

        if (modal &&
            Array.isArray(modal.__specialisationOptions)) {
            for (var i = 0; i < modal.__specialisationOptions.length; i++) {
                var opt = modal.__specialisationOptions[i];
                if (!opt || !isNonEmptyString(opt.id)) { continue; }
                if (seen[opt.id]) { continue; }
                seen[opt.id] = true;
                result.push({
                    id: String(opt.id),
                    label: isNonEmptyString(opt.label)
                        ? String(opt.label)
                        : String(opt.id)
                });
            }
        }

        var selects = form.querySelectorAll(
            '.team-period-specialisation-select'
        );
        for (var s = 0; s < selects.length; s++) {
            var opts = selects[s].querySelectorAll('option');
            for (var o = 0; o < opts.length; o++) {
                var optEl = opts[o];
                var id = String(optEl.value || '');
                if (id === '') { continue; }
                if (seen[id]) { continue; }
                seen[id] = true;
                result.push({
                    id: id,
                    label: String(optEl.textContent || id)
                });
            }
        }

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

        row.parentNode.removeChild(row);

        reindexPeriodRows(list);
        updateRemoveButtons(list);
    }

    function reindexPeriodRows(list) {
        var rows = list.querySelectorAll('.team-period-row');
        for (var i = 0; i < rows.length; i++) {
            rows[i].dataset.periodIndex = String(i);

            var label = rows[i].querySelector(
                '.team-period-row-label'
            );
            if (label) {
                // The "(current)" suffix is gone. Every row is
                // just "Period N". The last row is identifiable
                // by its position in the list, not by a label.
                label.textContent = 'Period ' + (i + 1);
            }

            var removeBtn = rows[i].querySelector(
                '.team-period-remove'
            );
            if (removeBtn) {
                removeBtn.dataset.periodIndex = String(i);
            }
        }
    }

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

        var chip = document.createElement('div');
        chip.className = 'team-specialisation-chip';
        chip.dataset.specialisationId = id;

        var nameSpan = document.createElement('span');
        nameSpan.className = 'team-specialisation-chip-name';
        nameSpan.textContent = label;
        chip.appendChild(nameSpan);

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className =
            'small danger team-specialisation-remove';
        removeBtn.dataset.specialisationId = id;
        removeBtn.textContent = '\u2715';
        chip.appendChild(removeBtn);

        chipsHost.appendChild(chip);

        for (var s = 0; s < select.options.length; s++) {
            if (select.options[s].value === id) {
                select.removeChild(select.options[s]);
                break;
            }
        }
        select.value = '';

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

        if (row && id) {
            var select = row.querySelector(
                '.team-period-specialisation-select'
            );
            if (select) {
                if (select.disabled) {
                    select.innerHTML = '';
                    select.disabled = false;
                    var initial = document.createElement('option');
                    initial.value = '';
                    initial.textContent = 'Select...';
                    select.appendChild(initial);
                }

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

        var topFieldTouched = false;
        if (nameEl) {
            var original = nameEl.dataset
                ? (nameEl.dataset.originalValue || '')
                : '';
            if (currentName !== original.trim()) {
                topFieldTouched = true;
            }
        }

        var type = typeEl ? typeEl.value : 'professional';
        var status = statusEl ? statusEl.value : 'active';

        var temporaryMission = missionEl
            ? (missionEl.value || null)
            : null;

        var periods = collectPeriodsFromForm(form);
        if (periods === null) {
            return;
        }

        if (periods.length > 0 && topFieldTouched) {
            periods[periods.length - 1].name = currentName;
        }

        if (!editId && periods.length > 0) {
            var lastPeriod = periods[periods.length - 1];
            if (!lastPeriod.name || lastPeriod.name === '') {
                lastPeriod.name = currentName;
            }
        }

        var teamData = {
            name: currentName,
            type: type,
            status: status,
            classId: classEl ? classEl.value : null,
            teamNumber: numberEl ? numberEl.value.trim() : '',
            temporaryMission: temporaryMission,
            periods: periods
        };

        if (editId && topFieldTouched) {
            teamData.nameIsAuto = false;
        }

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
                notify(
                    'Failed to save team: ' +
                    ((result && result.message) || 'Unknown error'),
                    'error'
                );
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
     * Read every period row's fields, including the last row's
     * end input. A blank end on any row means "unbounded on that
     * side"; for the last row specifically, that means the team
     * is still ongoing. A non-blank end on the last row means the
     * team disbanded at that year.
     *
     * The previous revision skipped the last row's end; this one
     * reads it. That is the whole point of D2.
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

            // ---- End is read on EVERY row, including the last. ----
            var endRaw = endEl
                ? String(endEl.value || '').trim()
                : '';
            var endCanon = '';
            if (endRaw !== '') {
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
    // MATCHMAKING PLANNER - MATRIX
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

        contentEl.addEventListener('input', function(e) {
            var target = e.target;
            if (!target || !target.classList) { return; }
            if (!target.classList.contains('planner-assoc-leave')) {
                return;
            }
            var teamId = target.dataset.teamId;
            var candidateId = target.dataset.characterId;
            if (!teamId || !candidateId) { return; }
            stageLeave(candidateId, teamId, target.value);
        });

        contentEl.addEventListener('change', function(e) {
            var target = e.target;
            if (!target) { return; }
            if (!target.classList ||
                !target.classList.contains('planner-assoc-radio')) {
                return;
            }

            handlePlannerRadioChange(contentEl, target);
        });
    }

    function stageLeave(candidateId, teamId, value) {
        if (!_matchmakingModal) { return; }
        var strip = findStripForCandidate(
            _matchmakingModal, candidateId
        );
        if (!strip) { return; }

        var raw = strip.dataset.pendingLeaveByTeam || '{}';
        var map;
        try {
            map = JSON.parse(raw);
            if (!map || typeof map !== 'object' ||
                Array.isArray(map)) {
                map = {};
            }
        } catch (e) {
            map = {};
        }
        map[String(teamId)] = String(value || '');
        strip.dataset.pendingLeaveByTeam = JSON.stringify(map);
    }

    function readStagedLeave(candidateId, teamId) {
        if (!_matchmakingModal) { return ''; }
        var strip = findStripForCandidate(
            _matchmakingModal, candidateId
        );
        if (!strip) { return ''; }
        var raw = strip.dataset.pendingLeaveByTeam || '{}';
        try {
            var map = JSON.parse(raw);
            if (map && typeof map === 'object' &&
                typeof map[String(teamId)] === 'string') {
                return map[String(teamId)];
            }
        } catch (e) {
            // fall through
        }
        return '';
    }

    function handlePlannerRadioChange(contentEl, radio) {
        if (!radio.checked) { return; }

        var candidateId = radio.dataset.characterId;
        var teamId = radio.dataset.teamId;
        if (!candidateId || !teamId) { return; }

        var strip = findStripForCandidate(contentEl, candidateId);

        if (!strip) { return; }

        var teamName = findTeamNameById(contentEl, teamId);

        var defaultJoin = strip.dataset.defaultJoin || '';
        var stagedLeave = readStagedLeave(candidateId, teamId);

        var stripInner = strip.querySelector(
            '.planner-row-details'
        );
        if (!stripInner) { return; }

        stripInner.innerHTML = buildStripHTML(
            candidateId, teamId, teamName,
            defaultJoin, stagedLeave
        );

        strip.removeAttribute('hidden');

        var joinInput = stripInner.querySelector(
            '.planner-assoc-join'
        );
        if (joinInput && typeof joinInput.focus === 'function') {
            setTimeout(function() {
                try { joinInput.focus(); } catch (err) {}
            }, 0);
        }
    }

    function findStripForCandidate(contentEl, candidateId) {
        return contentEl.querySelector(
            'tr.planner-matrix-details-row' +
            '[data-character-id="' + cssEscape(candidateId) + '"]'
        );
    }

    function findTeamNameById(contentEl, teamId) {
        var header = contentEl.querySelector(
            'th.planner-matrix-team-header' +
            '[data-team-id="' + cssEscape(teamId) + '"]'
        );
        if (!header) { return ''; }

        var nameEl = header.querySelector(
            '.planner-matrix-team-name'
        );
        if (!nameEl) { return ''; }
        return String(nameEl.textContent || '').trim();
    }

    function buildStripHTML(
        candidateId, teamId, teamName, defaultJoin, stagedLeave
    ) {
        var html = '';

        html += '<span class="planner-row-details-label">' +
                    'Assign to <strong>' +
                        escapeHtml(teamName || 'this team') +
                    '</strong>:' +
                '</span>';

        html += '<input type="text" ' +
                    'class="planner-assoc-join" ' +
                    'inputmode="numeric" ' +
                    'placeholder="Join" ' +
                    'value="' +
                        escapeAttribute(String(defaultJoin)) + '" ' +
                    'data-team-id="' +
                        escapeAttribute(teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidateId) + '">';

        html += '<span class="planner-row-details-dash">' +
                    '\u2013' +
                '</span>';

        html += '<input type="text" ' +
                    'class="planner-assoc-leave" ' +
                    'inputmode="numeric" ' +
                    'placeholder="Leave" ' +
                    'value="' +
                        escapeAttribute(String(stagedLeave || '')) +
                    '" ' +
                    'data-team-id="' +
                        escapeAttribute(teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidateId) + '">';

        html += '<button type="button" ' +
                    'class="small secondary planner-row-details-clear" ' +
                    'data-team-id="' +
                        escapeAttribute(teamId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidateId) + '">' +
                    'Unselect' +
                '</button>';

        return html;
    }

    function handlePlannerCommit(modal, contentEl) {
        var state = modal.__plannerState;
        if (!state) { return; }

        var checked = contentEl.querySelectorAll(
            '.planner-assoc-radio:checked'
        );

        var assignments = [];
        var invalidRows = [];

        for (var i = 0; i < checked.length; i++) {
            var radio = checked[i];

            var teamId = radio.dataset.teamId;
            var charId = radio.dataset.characterId;

            if (!teamId || !charId) { continue; }

            var strip = findStripForCandidate(contentEl, charId);
            if (!strip) {
                invalidRows.push({
                    teamId: teamId,
                    charId: charId,
                    reason: 'Details strip is missing.'
                });
                continue;
            }

            var joinEl = strip.querySelector(
                '.planner-assoc-join' +
                '[data-team-id="' + cssEscape(teamId) + '"]' +
                '[data-character-id="' + cssEscape(charId) + '"]'
            );
            var leaveEl = strip.querySelector(
                '.planner-assoc-leave' +
                '[data-team-id="' + cssEscape(teamId) + '"]' +
                '[data-character-id="' + cssEscape(charId) + '"]'
            );

            var joinRaw = joinEl ? String(joinEl.value || '').trim() : '';
            var leaveRaw = leaveEl
                ? String(leaveEl.value || '').trim()
                : '';

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
            if (!result || !result.success) {
                notify(
                    'Failed to delete team: ' +
                    ((result && result.message) ||
                        'Unknown error'),
                    'error'
                );
                return;
            }

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

        var team = null;
        try {
            team = TeamQueries.getTeamById(teamId);
        } catch (e) {
            team = null;
        }

        if (team) {
            var TC = window.TeamConstants;
            var normalized = null;
            if (TC && typeof TC.normalizeTeamType === 'function') {
                normalized = TC.normalizeTeamType(team.type);
            } else {
                normalized = team.type;
            }
            if (normalized === 'academic') {
                notify(
                    'The Teams tab does not manage academic teams. ' +
                    'Use the Academy module instead.',
                    'error'
                );
                return;
            }
        }

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
    // RANKING MODAL (per-team)
    // ============================================================
    //
    // The per-team ranking modal is unchanged from the previous
    // revision. It shows the team's own ranking history and
    // offers period/rank Add and remove controls. Those route to
    // TeamCore.addRanking / removeRanking, which are now
    // compatibility shims over insertRankingAt / removeRankingAt.

    function showRankingModal(teamId) {
        var vm = TeamAggregator.getRankingModalViewModel(teamId);
        if (!vm) {
            notify('Team not found.', 'error');
            return;
        }

        if (_rankingModal) {
            try {
                Modal.closeModal(_rankingModal);
            } catch (e) { /* ignore */ }
            _rankingModal = null;
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

        _rankingModal = modal;

        Modal.modalSetup(modal, function() {
            if (_rankingModal === modal) {
                _rankingModal = null;
            }
        });
        Modal.showModal(modal);

        bindRankingModalEvents(modal, contentEl, teamId);
    }

    function bindRankingModalEvents(modal, contentEl, teamId) {
        function close() {
            if (_rankingModal === modal) {
                _rankingModal = null;
            }
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

            TeamCore.removeRankingAt(teamId, period)
                .then(function(result) {
                    if (result && result.success) {
                        refreshRankingListInPlace(
                            modal, teamId
                        );
                        refreshUI();
                    } else {
                        notify(
                            'Failed to remove ranking: ' +
                            ((result && result.message) ||
                                'Unknown error'),
                            'error'
                        );
                    }
                })
                .catch(function(err) {
                    console.warn(
                        '[TeamEvents] removeRankingAt failed:', err
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

        var periodNum = parsePositiveInteger(
            periodEl ? periodEl.value : ''
        );
        if (periodNum === null) {
            notify(
                'Period must be a positive integer.',
                'error'
            );
            return;
        }

        var rankNum = parsePositiveInteger(
            rankEl ? rankEl.value : ''
        );
        if (rankNum === null) {
            notify(
                'Rank must be a positive integer.',
                'error'
            );
            return;
        }

        TeamCore.insertRankingAt(teamId, periodNum, rankNum)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        'Failed to add ranking: ' +
                        ((result && result.message) ||
                            'Unknown error'),
                        'error'
                    );
                    return;
                }
                if (periodEl) { periodEl.value = ''; }
                if (rankEl) { rankEl.value = ''; }
                refreshRankingListInPlace(modal, teamId);
                refreshUI();
            })
            .catch(function(err) {
                console.warn(
                    '[TeamEvents] insertRankingAt failed:', err
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

        delegate(
            '#professional-show-inactive, #civilian-show-inactive',
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
                'showInactive',
                inactiveEl.checked === true
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
