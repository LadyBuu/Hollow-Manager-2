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
 *   - Own the rankings tab's year, sort, and expanded state.
 *   - Own the TEAM LIST's selection set (for bulk export).
 *   - Own the periods editor's DOM-only staging.
 *   - Open the team export picker and the candidate export.
 *   - Open the team verifier modal.
 *   - Open the kill-team modal.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Domain logic. TeamCore owns mutations; TeamQueries owns reads;
 *     TeamAggregator owns projections.
 *   - Rendering. TeamRender owns HTML. TeamEvents delegates to it
 *     for every row that must also be re-rendered dynamically
 *     (see buildNewPeriodRowHTML).
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
 * VIEW MODES:
 *   'teams' | 'pool' | 'timeline' | 'rankings'. Module-level.
 *   Forced to 'teams' on non-professional tabs. Reset on init and
 *   destroy.
 *
 * POOL STATE:
 *   _poolExpandedIds  { [characterId]: true }
 *   _poolSelectedIds  { [characterId]: true }
 *
 * TEAM SELECTION STATE:
 *   _teamSelectedIds  { [teamId]: true }
 *
 * RANKINGS STATE:
 *   _rankingsYear            the year the rankings tab is viewing
 *   _rankingsSortMode        'rank' | 'name' | 'members'
 *   _rankingsSortDirection   'asc' | 'desc'
 *   _rankingsShowInactive    whether inactive teams are visible
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
 *   row's start year defaults to one greater than the previous
 *   row's start, or the application year if the previous start
 *   cannot be parsed. This prevents appending a row that starts
 *   before its predecessor (an ordering error that surfaces only
 *   on save). The previous row's end year is auto-set to
 *   (start - 1) unless the user has already given it an explicit
 *   end.
 *
 *   The append path builds its row HTML via TeamRender
 *   .renderPeriodRow, the same function renderPeriodsEditor uses.
 *   buildNewPeriodRowHTML is a thin adapter that shapes the
 *   append-path arguments into the renderer's contract; it does
 *   not build markup itself. This eliminates the drift hazard
 *   between the initial-render and append-path markup.
 *
 *   All four handlers bind on the modal, not through the
 *   container delegation chain. The form is its own modal shell
 *   and is not a descendant of the teams container.
 *
 * TOP-OF-FORM NAME (two-owners fix, interim):
 *   The team form has two inputs that can own the current
 *   period's name: the top-of-form #team-name field and the
 *   last period row's .team-period-name input.
 *
 *   Before this pass, saveTeam forced periods[last].name =
 *   currentName unconditionally. That meant:
 *     - a user retitling the last period in the editor lost the
 *       change if they didn't also retype the top field
 *     - saving any unrelated edit rewrote the name from the
 *       top field, which had been populated on load
 *
 *   The fix: the top field wins only if the user typed in it
 *   this session. That is detected by comparing the field's
 *   current value against its data-original-value attribute,
 *   which TeamRender wrote with the name the form opened with.
 *
 *   If the top field is untouched, the periods array wins as
 *   edited. A subsequent ship introduces a `nameIsAuto` flag
 *   that takes over the "did the user type" decision at the
 *   model layer; the dirty-check here remains valid as the
 *   writer side of that flag's semantics.
 *
 * SPECIALISATION VOCABULARY:
 *   When showTeamForm creates the modal, it stashes the form
 *   VM's specialisationOptions on the modal as
 *   __specialisationOptions. getSpecialisationOptions(form)
 *   reads from that stash when present, and falls back to
 *   scraping existing selects/chips for a vocabulary only when
 *   the stash is absent.
 *
 *   The scrape fallback is a safety net, not the primary path.
 *   Without the stash, a vocabulary entry that was selected in
 *   every existing row would be invisible to a newly-appended
 *   row's select; the stash guarantees the full vocabulary is
 *   always available.
 *
 * RANKINGS TAB:
 *   The professional tab's fourth view mode. Delegated to
 *   TeamRankingsView for the table body; TeamEvents owns the
 *   interactions:
 *
 *     #rankings-apply-year-btn        commit the year input
 *     #rankings-year-input (Enter)    same
 *     #rankings-show-inactive         toggle inactive teams
 *     #rankings-export-year-btn       call TeamExport.exportTeamsByYear
 *     .rankings-table-header button[data-sort-key]
 *                                     cycle sort key / direction
 *     .ranking-row-rank                click-to-edit the rank
 *     .rankings-clear-rank             remove the explicit entry
 *
 *   The rank editor opens inline. Enter commits, Escape cancels,
 *   blur commits. A blank value with an original value present
 *   calls TeamCore.removeRanking; a blank value with no original
 *   is a no-op.
 *
 *   DOUBLE-COMMIT GUARD:
 *   Enter and blur can both fire on the same input within one
 *   tick (Enter → commit → re-render → blur on the detached
 *   input). A module-level in-flight flag plus a per-input
 *   `dataset.committed` marker ensure a single commit per
 *   editor instance.
 *
 * TIMELINE STATE:
 *   _timelineYearStart, _timelineYearEnd, _timelineExpandedYears.
 *
 *   The range is clamped to a 200-year span. The timeline is a
 *   UI affordance over team history, not a general-purpose date
 *   explorer; 200 years covers any plausible game chronology
 *   while keeping the row count bounded. A request wider than
 *   that is clamped to the most recent 200 years and the user is
 *   notified.
 *
 * MATCHMAKING PLANNER:
 *   The planner is a MATRIX. Teams are columns, candidates are
 *   rows, and each intersection carries a radio. The radio group
 *   name is scoped per candidate:
 *
 *     name="planner-cand-<candidateId>"
 *
 *   so at most one team per candidate can be checked.
 *
 *   Below each candidate's radio row is a DETAILS STRIP: a
 *   full-width band that holds the Join and Leave inputs for the
 *   candidate's currently-checked team. When no radio is checked,
 *   the strip is hidden. When a radio is checked, the strip is
 *   populated with the team name and the two inputs, and
 *   unhidden. Moving the check to a different team in the same
 *   row swaps the strip's contents in place.
 *
 *   PENDING LEAVE:
 *   The strip preserves a typed Leave year per team within one
 *   candidate's row. Switching team A → B → A carries A's typed
 *   Leave back to A. The staging lives on the strip's
 *   data-pending-leave-by-team attribute as a JSON map keyed by
 *   teamId. Join does not need this staging because the default
 *   Join is computed from the candidate's availability window
 *   per team; Leave has no such default.
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
 *   Rankings tab Export year button (#rankings-export-year-btn)
 *     Calls TeamExport.exportTeamsByYear with the current
 *     rankings year.
 *
 * MODAL LIFECYCLE:
 *   The member manager, matchmaking planner, ranking modal, and
 *   team form each have a module-level modal variable. Opening
 *   any of them closes the previous instance first. destroy()
 *   closes every one. This prevents stacked modals and orphaned
 *   listeners when the tab is unmounted.
 *
 * LOAD ORDER AND DEPENDENCIES (deliberate):
 *   Every dependency in the DEPENDENCIES block below is
 *   resolved at module load and required. A missing dependency
 *   throws here, and the Teams tab does not exist.
 *
 *   This is deliberate. A missing core dependency is a
 *   load-order bug that must surface loudly, not be papered
 *   over with a silent degradation. A Teams tab that renders
 *   but has non-functional buttons is harder to diagnose than a
 *   Teams tab that refuses to exist and says why on the console.
 *
 *   If a future dependency can be genuinely optional, add it to
 *   the LAZY DEPENDENCIES block instead — a lazy dependency
 *   produces a toast at the point of use, which is the correct
 *   failure mode for a genuinely optional feature.
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

    var _rankingsYear = null;
    var _rankingsSortMode = 'rank';
    var _rankingsSortDirection = 'asc';
    var _rankingsShowInactive = false;

    var _pendingTeamMemberIds = null;

    var _rankCommitInFlight = false;

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
            _rankingsYear = null;
            _rankingsSortMode = 'rank';
            _rankingsSortDirection = 'asc';
            _rankingsShowInactive = false;
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

        if (currentTab === 'professional' &&
            _viewMode === 'rankings') {
            if (_rankingsYear === null) {
                _rankingsYear = period !== null
                    ? period
                    : getApplicationYear();
            }
            pageVM.rankingsVM =
                TeamAggregator.getTeamRankingsViewModel({
                    year: _rankingsYear,
                    sort: _rankingsSortMode,
                    sortDirection: _rankingsSortDirection,
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
        _rankingsSortMode = 'rank';
        _rankingsSortDirection = 'asc';
        _rankingsShowInactive = false;
        _pendingTeamMemberIds = null;
        _rankCommitInFlight = false;

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
        _rankingsSortMode = 'rank';
        _rankingsSortDirection = 'asc';
        _rankingsShowInactive = false;
        _pendingTeamMemberIds = null;
        _rankCommitInFlight = false;
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
                _rankingsSortMode = 'rank';
                _rankingsSortDirection = 'asc';
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
                _rankingsSortMode = 'rank';
                _rankingsSortDirection = 'asc';
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
    // RANKINGS TAB ACTIONS
    // ============================================================

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

        delegate(
            '.rankings-table-header button[data-sort-key]',
            'click',
            function(e, target) {
                e.preventDefault();
                var key = target.dataset.sortKey;
                if (!key) { return; }

                if (_rankingsSortMode === key) {
                    _rankingsSortDirection =
                        _rankingsSortDirection === 'asc'
                            ? 'desc' : 'asc';
                } else {
                    _rankingsSortMode = key;
                    _rankingsSortDirection = 'asc';
                }

                refreshUI();
            }
        );

        delegate('.ranking-row-rank', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();
            openRankEditor(target);
        });

        delegate('.rankings-clear-rank', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();
            clearRankAtYear(target);
        });

        delegate('.ranking-inline-input', 'blur', function(e, target) {
            commitRankEditor(target);
        });

        delegate(
            '.ranking-inline-input',
            'keydown',
            function(e, target) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRankEditor(target);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRankEditor(target);
                }
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

    function openRankEditor(span) {
        var existing = _container
            ? _container.querySelector('.ranking-inline-input')
            : null;
        if (existing) {
            commitRankEditor(existing);
        }

        var teamId = span.dataset.teamId;
        var year = span.dataset.year;
        var currentRank = span.dataset.currentRank || '';

        if (!teamId || !year) { return; }

        var input = document.createElement('input');
        input.type = 'number';
        input.className = 'ranking-inline-input';
        input.min = '1';
        input.value = currentRank;
        input.dataset.teamId = teamId;
        input.dataset.year = year;
        input.dataset.originalRank = currentRank;
        input.dataset.committed = '0';

        span.textContent = '';
        span.appendChild(input);
        span.classList.add('is-editing');

        setTimeout(function() {
            try {
                input.focus();
                input.select();
            } catch (e) { /* ignore */ }
        }, 0);
    }

    function commitRankEditor(input) {
        if (!input || !input.parentNode) { return; }

        if (input.dataset &&
            input.dataset.committed === '1') {
            return;
        }
        if (_rankCommitInFlight) {
            return;
        }

        var teamId = input.dataset.teamId;
        var year = parseInt(input.dataset.year, 10);
        var originalRank = input.dataset.originalRank || '';
        var raw = String(input.value || '').trim();

        if (!teamId || isNaN(year)) { return; }

        if (raw === '') {
            if (originalRank === '') {
                refreshUI();
                return;
            }
            input.dataset.committed = '1';
            clearRankAtYearInternal(teamId, year);
            return;
        }

        var rank = parsePositiveInteger(raw);
        if (rank === null) {
            notify(
                'Rank must be a positive integer.',
                'error'
            );
            refreshUI();
            return;
        }

        if (String(rank) === originalRank) {
            refreshUI();
            return;
        }

        input.dataset.committed = '1';
        _rankCommitInFlight = true;

        TeamCore.addRanking(teamId, year, rank)
            .then(function(result) {
                _rankCommitInFlight = false;
                if (!result || !result.success) {
                    notify(
                        'Failed to set rank: ' +
                        ((result && result.message) ||
                            'Unknown error'),
                        'error'
                    );
                }
                refreshUI();
            })
            .catch(function(err) {
                _rankCommitInFlight = false;
                console.warn(
                    '[TeamEvents] addRanking failed:', err
                );
                notify('Failed to set rank.', 'error');
                refreshUI();
            });
    }

    function cancelRankEditor(input) {
        if (!input || !input.parentNode) { return; }
        refreshUI();
    }

    function clearRankAtYear(button) {
        var teamId = button.dataset.teamId;
        var year = parseInt(button.dataset.year, 10);
        if (!teamId || isNaN(year)) { return; }
        clearRankAtYearInternal(teamId, year);
    }

    function clearRankAtYearInternal(teamId, year) {
        if (!confirm(
            'Remove the ranking entry at year ' + year + '? ' +
            'The team will fall back to its previous explicit ' +
            'ranking.'
        )) {
            refreshUI();
            return;
        }

        TeamCore.removeRanking(teamId, year)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        'Failed to remove rank: ' +
                        ((result && result.message) ||
                            'Unknown error'),
                        'error'
                    );
                }
                refreshUI();
            })
            .catch(function(err) {
                console.warn(
                    '[TeamEvents] removeRanking failed:', err
                );
                notify('Failed to remove rank.', 'error');
                refreshUI();
            });
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

        // Stash the full specialisation vocabulary on the modal.
        // appendPeriodRow reads it via getSpecialisationOptions so
        // a new row's select is never limited to "what is left
        // after every existing row has been chipped".
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
    // PERIODS EDITOR
    // ============================================================

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
        }

        if (lastRow) {
            var prevEndEl = lastRow.querySelector(
                '.team-period-end'
            );
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

            var hint = lastRow.querySelector(
                '.team-period-field-hint'
            );
            if (hint && hint.parentNode) {
                hint.parentNode.removeChild(hint);
            }

            lastRow.dataset.isLast = 'false';
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

    /**
     * Adapter from the append-path's (start, style, specs,
     * options) arguments to TeamRender.renderPeriodRow's
     * (period, index, isLast, options, canRemove) contract.
     *
     * Produces no markup itself. Every change to a period row's
     * DOM shape belongs in TeamRender.renderPeriodRow.
     *
     * canRemove is false because the appended row starts with
     * only one row-less-state ahead of it: updateRemoveButtons()
     * runs immediately after this and reveals the remove button
     * on every row once there is more than one.
     *
     * index is 0 because reindexPeriodRows() runs immediately
     * after and rewrites data-period-index on every row.
     */
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
     * Resolve the specialisation vocabulary for the append path.
     *
     * Primary source: modal.__specialisationOptions, stashed by
     * showTeamForm from the form VM's specialisationOptions. This
     * is the full vocabulary the aggregator handed the form, so a
     * new row's select always sees every pickable entry, even if
     * every existing row has already chipped the one the user
     * wants.
     *
     * Fallback: scrape existing selects and chips. This preserves
     * behaviour when the stash is absent — older callers that
     * constructed a modal without going through showTeamForm, or
     * a future change that stops stashing. The fallback never
     * sees an entry that is selected in every row, so it is
     * strictly worse than the stash; the stash is the intended
     * path.
     */
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

        // Scrape, merging anything the stash did not have.
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

        var wasLast = row.dataset.isLast === 'true';
        row.parentNode.removeChild(row);

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

    function promoteToCurrentPeriod(row) {
        row.dataset.isLast = 'true';

        var endEl = row.querySelector('.team-period-end');
        if (endEl) {
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

            TeamCore.removeRanking(teamId, period)
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

        TeamCore.addRanking(teamId, periodNum, rankNum)
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
