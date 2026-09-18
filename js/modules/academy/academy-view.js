/**
 * modules/academy/academy-view.js - Academy Unified Shell
 * UI controller and coordinator for the Academy tab.
 *
 * Path: js/modules/academy/academy-view.js
 *
 * RESPONSIBILITIES:
 *   - Own the top-level Academy shell (view switcher)
 *   - Delegate rendering to the per-view controller registry
 *   - Own the class/character/week/people-filter shared state via
 *     AcademyUI (typed API)
 *   - Bind container-level event delegation for the active
 *     controller
 *   - Route events to the active controller
 *   - Preserve scroll position of same-view sidebars across
 *     refreshes (C6)
 *
 * NOT RESPONSIBILITIES:
 *   - Feature rendering. That is the controllers'.
 *   - Feature state. That is the controllers'.
 *   - Feature event handling. That is the controllers'.
 *   - Domain reads. Those happen in the aggregators.
 *   - Domain validation. That happens in the domain modules.
 *   - Domain mutation. Those are delegated to the owning module.
 *
 * CONTROLLER MODEL:
 *   Six feature controllers, one per Academy view:
 *
 *     people          AcademyPeopleController
 *     tournaments     AcademyExamController      (rendered as "Exams")
 *     weeklyTeams     AcademyWeeklyTeamsController
 *     rankings        AcademyRankingController   (S1.7, not yet shipped)
 *     disciplines     AcademyDisciplineController
 *     locations       AcademyLocationController
 *
 *   A controller is a plain object with an optional subset of:
 *     render(host, context)
 *     handleClick(e)
 *     handleChange(e)
 *     handleInput(e)
 *     handleKeydown(e)
 *     unmount()
 *
 *   The shell invokes optional methods through
 *   AcademyControllerContract.invoke, which returns undefined for
 *   absent methods rather than throwing.
 *
 *   Controllers are registered in modules/academy/index.js.
 *
 * DEPENDENCY DIRECTION:
 *   Shell → registry → controller.
 *   Controllers never reference this module.
 *
 * VIEW-BY-VIEW MIGRATION STATUS:
 *   After S1.6:
 *     people          controlled
 *     tournaments     controlled
 *     weeklyTeams     controlled
 *     disciplines     controlled
 *     locations       controlled
 *     rankings        still inline (S1.7)
 *
 *   The Rankings branch is the only remaining feature-specific code
 *   in this file. S1.7 removes it, S1.8 removes the leftover inline
 *   dispatchers and confirms the dependency whitelist.
 *
 * SCROLL RESTORATION (C6):
 *   Same-view refreshes only. When render() runs, it captures the
 *   scrollTop of any scrollable sidebar currently in the DOM, swaps
 *   the container's innerHTML, then restores the captured scrollTop
 *   onto the same selector in the new DOM.
 *
 *   The set of selectors is deliberately small and explicit:
 *     - .academy-people-sidebar
 *     - .academy-weekly-teams-sidebar
 *     - .academy-exams-sidebar
 *     - .academy-exams-detail
 *
 *   Rules:
 *     - A selector that is absent before the swap is not captured.
 *     - A selector that is absent after the swap is not restored.
 *     - No fallback to document scroll.
 *     - No module state. The map lives on the stack of a single
 *       render() call.
 *     - Not persisted. Leaving a view and returning resets to 0.
 *
 * DEPENDENCIES (MANDATORY):
 *   - AcademyUI
 *   - DomUtils
 *   - CalendarConstants
 *
 * DEPENDENCIES (OPTIONAL, feature-scoped):
 *   - AcademyAggregator                       (rankings, until S1.7)
 *   - AcademyRankingView                      (rankings, until S1.7)
 *   - AcademyControllers                      (registry)
 *   - AcademyControllerContract               (invoke helper)
 *   - AcademyCRUDModals                       (onChange wiring)
 *   - NotificationSystem                      (via controllers)
 */

(function() {
    'use strict';

    if (window.__academyViewLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!AcademyUI || typeof AcademyUI.getSelectedView !== 'function') {
        _missing.push('AcademyUI.getSelectedView');
    }
    if (!AcademyUI || typeof AcademyUI.setSelectedView !== 'function') {
        _missing.push('AcademyUI.setSelectedView');
    }
    if (!AcademyUI || typeof AcademyUI.getSelectedClassId !== 'function') {
        _missing.push('AcademyUI.getSelectedClassId');
    }
    if (!AcademyUI || typeof AcademyUI.getSelectedCharacterId !== 'function') {
        _missing.push('AcademyUI.getSelectedCharacterId');
    }
    if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
    }
    if (!AcademyUI || typeof AcademyUI.setDisplayWeek !== 'function') {
        _missing.push('AcademyUI.setDisplayWeek');
    }
    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyView] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyViewLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getControllers() {
        return window.AcademyControllers || null;
    }

    function getControllerContract() {
        return window.AcademyControllerContract || null;
    }

    function getAcademyAggregator() {
        return window.AcademyAggregator || null;
    }

    function getRankingViewModule() {
        return window.AcademyRankingView || null;
    }

    function getAcademyCRUDModals() {
        return window.AcademyCRUDModals || null;
    }

    function getNotificationSystem() {
        return window.NotificationSystem || null;
    }

    function notify(message, type) {
        var NS = getNotificationSystem();
        if (NS && typeof NS.notify === 'function') {
            NS.notify(message, type || 'info');
        }
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var VIEWS = [
        { id: 'people',       label: 'People' },
        { id: 'tournaments',  label: 'Exams' },
        { id: 'weeklyTeams',  label: 'Weekly Teams' },
        { id: 'rankings',     label: 'Rankings' },
        { id: 'disciplines',  label: 'Disciplines' },
        { id: 'locations',    label: 'Locations' }
    ];

    var VALID_VIEW_IDS = VIEWS.map(function(v) { return v.id; });

    // ============================================================
    // SCROLL RESTORATION (C6)
    // ============================================================

    var SCROLL_RESTORE_SELECTORS = [
        '.academy-people-sidebar',
        '.academy-weekly-teams-sidebar',
        '.academy-exams-sidebar',
        '.academy-exams-detail'
    ];

    function captureSidebarScroll(container) {
        var captured = {};
        if (!container || typeof container.querySelector !== 'function') {
            return captured;
        }

        for (var i = 0; i < SCROLL_RESTORE_SELECTORS.length; i++) {
            var selector = SCROLL_RESTORE_SELECTORS[i];
            var el = container.querySelector(selector);
            if (!el) { continue; }
            if (typeof el.scrollTop !== 'number') { continue; }
            captured[selector] = el.scrollTop;
        }

        return captured;
    }

    function restoreSidebarScroll(container, captured) {
        if (!container || typeof container.querySelector !== 'function') {
            return;
        }
        if (!captured || typeof captured !== 'object') {
            return;
        }

        for (var i = 0; i < SCROLL_RESTORE_SELECTORS.length; i++) {
            var selector = SCROLL_RESTORE_SELECTORS[i];
            if (!Object.prototype.hasOwnProperty.call(captured, selector)) {
                continue;
            }
            var el = container.querySelector(selector);
            if (!el) { continue; }
            if (typeof el.scrollTop !== 'number') { continue; }
            var value = captured[selector];
            if (typeof value !== 'number' || !isFinite(value)) {
                continue;
            }
            el.scrollTop = value;
        }
    }

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // The shell owns exactly three pieces of module state:
    //   - The bound container and its delegated handlers.
    //   - The last view it rendered a controller for, so the
    //     outgoing controller's unmount() runs on view switches.
    //   - The Rankings class selection, which is still inline
    //     (moved to a controller in S1.7).

    var _boundContainer = null;
    var _boundHandlers = null;

    // The view whose controller was active on the previous render.
    // Used to invoke that controller's unmount() when the active view
    // changes.
    var _lastRenderedControllerView = null;

    // Rankings inline state (S1.7 removes this).
    var _selectedRankingClassId = null;

    // ============================================================
    // ENTRY POINT
    // ============================================================

    function render(container) {
        if (!container) {
            container = document.getElementById('tab-academy');
        }
        if (!container) {
            return;
        }

        // Unmount the outgoing controller before rendering the new
        // view. On a same-view refresh, this is a no-op (the view id
        // is unchanged and the controller's unmount is not called).
        unmountOutgoingControllerIfPresent();

        var view = AcademyUI.getSelectedView();
        if (VALID_VIEW_IDS.indexOf(view) === -1) {
            view = 'people';
        }

        var html = '';
        html += renderViewNav(view);

        switch (view) {
            case 'people':
                html += renderControllerHost('academy-people-host');
                break;
            case 'tournaments':
                html += renderControllerHost('academy-exams-host');
                break;
            case 'weeklyTeams':
                html += renderControllerHost('academy-weekly-teams-host');
                break;
            case 'rankings':
                // Rankings still renders inline (S1.7).
                html += renderRankingView();
                break;
            case 'disciplines':
                html += renderControllerHost('academy-disciplines-host');
                break;
            case 'locations':
                html += renderControllerHost('academy-locations-host');
                break;
            default:
                html += renderPlaceholder('Unknown view: ' + view);
        }

        // C6 — capture scrollable sidebars before the innerHTML
        // swap. Restore after.
        var capturedScroll = captureSidebarScroll(container);

        container.innerHTML = html;

        restoreSidebarScroll(container, capturedScroll);

        bindEvents(container);
        wireCRUDModalsCallbacks();
        mountActiveControllerIfPresent();
    }

    function refreshView() {
        if (!_boundContainer) {
            return;
        }
        render(_boundContainer);
    }

    function unmount() {
        unmountOutgoingControllerIfPresent(true);

        unbindEvents();

        _boundContainer = null;
        _lastRenderedControllerView = null;
    }

    // ============================================================
    // VIEW NAV
    // ============================================================

    function renderViewNav(activeView) {
        var html = '<div class="academy-view-nav">';
        for (var i = 0; i < VIEWS.length; i++) {
            var v = VIEWS[i];
            var isActive = v.id === activeView;
            html += '<button type="button" ' +
                        'class="academy-view-btn' +
                            (isActive ? ' active' : '') + '" ' +
                        'data-view="' + DomUtils.escapeAttribute(v.id) + '">' +
                        DomUtils.escapeHtml(v.label) +
                    '</button>';
        }
        html += '</div>';
        return html;
    }

    function renderControllerHost(hostId) {
        return '<div class="academy-view-content" ' +
                    'id="' + DomUtils.escapeAttribute(hostId) + '"></div>';
    }

    function renderPlaceholder(label) {
        return (
            '<div class="academy-body academy-body-placeholder">' +
                '<p class="empty-state">' +
                    DomUtils.escapeHtml(label) +
                '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // RANKINGS VIEW (INLINE — S1.7 MIGRATES)
    // ============================================================

    function renderRankingView() {
        var Renderer = getRankingViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Rankings');
        }

        var AcademyAggregator = getAcademyAggregator();
        if (!AcademyAggregator ||
            typeof AcademyAggregator.getRankingViewModel !== 'function') {
            return renderPlaceholder('Rankings');
        }

        var week = AcademyUI.getDisplayWeek();

        if (!_selectedRankingClassId) {
            var peopleClassId = AcademyUI.getSelectedClassId();
            if (peopleClassId) {
                _selectedRankingClassId = peopleClassId;
            }
        }

        var vm;
        try {
            vm = AcademyAggregator.getRankingViewModel(
                _selectedRankingClassId,
                week
            );
        } catch (e) {
            console.warn(
                '[AcademyView] getRankingViewModel threw:', e
            );
            return renderPlaceholder('Rankings');
        }

        if (vm && vm.classId) {
            _selectedRankingClassId = vm.classId;
        }

        try {
            return Renderer.renderHTML(vm);
        } catch (e) {
            console.warn(
                '[AcademyView] AcademyRankingView.renderHTML threw:', e
            );
            return renderPlaceholder('Rankings');
        }
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

    function bindEvents(container) {
        unbindEvents();
        _boundContainer = container;

        var clickHandler = function(e) { onDelegatedClick(e); };
        var changeHandler = function(e) { onDelegatedChange(e); };
        var inputHandler = function(e) { onDelegatedInput(e); };
        var keydownHandler = function(e) { onDelegatedKeydown(e); };

        container.addEventListener('click', clickHandler);
        container.addEventListener('change', changeHandler);
        container.addEventListener('input', inputHandler);
        container.addEventListener('keydown', keydownHandler);

        _boundHandlers = {
            click: clickHandler,
            change: changeHandler,
            input: inputHandler,
            keydown: keydownHandler
        };
    }

    function unbindEvents() {
        if (_boundContainer && _boundHandlers) {
            _boundContainer.removeEventListener('click', _boundHandlers.click);
            _boundContainer.removeEventListener('change', _boundHandlers.change);
            _boundContainer.removeEventListener('input', _boundHandlers.input);
            _boundContainer.removeEventListener('keydown', _boundHandlers.keydown);
        }
        _boundHandlers = null;
    }

    function wireCRUDModalsCallbacks() {
        var CRUD = getAcademyCRUDModals();
        if (CRUD && typeof CRUD.setOnChangeCallback === 'function') {
            CRUD.setOnChangeCallback(refreshView);
        }
        // AcademyTournamentEvents.setOnChangeCallback is wired by
        // AcademyExamController on each render.
    }

    // ============================================================
    // CONTROLLER MOUNT DISPATCH
    // ============================================================

    function mountActiveControllerIfPresent() {
        var view = AcademyUI.getSelectedView();

        if (view === 'people') {
            mountPeopleControllerIfPresent();
            return;
        }
        if (view === 'tournaments') {
            mountExamControllerIfPresent();
            return;
        }
        if (view === 'weeklyTeams') {
            mountWeeklyTeamsControllerIfPresent();
            return;
        }
        if (view === 'disciplines') {
            mountDisciplineControllerIfPresent();
            return;
        }
        if (view === 'locations') {
            mountLocationControllerIfPresent();
            return;
        }
        // 'rankings' is inline (S1.7).
    }

    function unmountOutgoingControllerIfPresent(isShellTeardown) {
        var Registry = getControllers();
        var Contract = getControllerContract();
        if (!Registry || typeof Registry.get !== 'function') { return; }
        if (!Contract || typeof Contract.invoke !== 'function') { return; }

        var activeView = AcademyUI.getSelectedView();

        // Determine which controller to unmount.
        var outgoingView;
        if (isShellTeardown === true) {
            // Shell is being torn down: unmount whatever was last
            // rendered, regardless of what the current view says.
            outgoingView = _lastRenderedControllerView;
        } else if (_lastRenderedControllerView &&
                   _lastRenderedControllerView !== activeView) {
            // View changed: unmount the previous view's controller.
            outgoingView = _lastRenderedControllerView;
        } else {
            // Same view (or no prior view). Nothing to unmount.
            return;
        }

        if (!outgoingView) { return; }

        var outgoing = Registry.get(outgoingView);
        if (!outgoing) {
            _lastRenderedControllerView = isShellTeardown === true
                ? null
                : activeView;
            return;
        }

        try {
            Contract.invoke(outgoing, 'unmount', []);
        } catch (e) {
            console.warn(
                '[AcademyView] controller unmount threw for view "' +
                outgoingView + '":', e
            );
        }

        _lastRenderedControllerView = isShellTeardown === true
            ? null
            : activeView;
    }

    // ---- Per-controller mount helpers ----

    function mountPeopleControllerIfPresent() {
        var controller = lookupController('people');
        if (!controller) { return; }

        var host = document.getElementById('academy-people-host');
        if (!host) { return; }

        var context = {
            onChange: function() { refreshView(); }
        };

        invokeRender(controller, host, context, 'people');
    }

    function mountExamControllerIfPresent() {
        var controller = lookupController('tournaments');
        if (!controller) { return; }

        var host = document.getElementById('academy-exams-host');
        if (!host) { return; }

        var context = {
            week: AcademyUI.getDisplayWeek(),
            onChange: function() { refreshView(); }
        };

        invokeRender(controller, host, context, 'tournaments');
    }

    function mountWeeklyTeamsControllerIfPresent() {
        var controller = lookupController('weeklyTeams');
        if (!controller) { return; }

        var host = document.getElementById('academy-weekly-teams-host');
        if (!host) { return; }

        var context = {
            week: AcademyUI.getDisplayWeek(),
            selectedClassId: AcademyUI.getSelectedClassId(),
            selectedTeamId: null,
            onChange: function(updates) {
                if (updates && typeof updates === 'object') {
                    // The controller reports any selection it resolved
                    // via the onChange payload. The shell does not
                    // track the team selection separately; it lives
                    // in the controller and is passed back on the
                    // next render.
                }
                refreshView();
            },
            onSelectTeam: function(teamId) {
                // The controller owns the team selection. It passes
                // the resolved id back to itself on the next render.
                // This callback is a signal that the selection
                // changed and the shell should re-render.
                refreshView();
            },
            onSelectClass: function(classId) {
                if (classId) {
                    AcademyUI.selectClass(classId);
                } else {
                    AcademyUI.selectClass(null);
                }
                refreshView();
            },
            onOpenCharacterInPeople: function(charId) {
                if (!isNonEmptyString(charId)) { return; }
                var classId = AcademyUI.getSelectedClassId();
                if (classId) {
                    AcademyUI.selectClass(classId);
                }
                AcademyUI.selectCharacter(charId);
                AcademyUI.setSelectedView('people');
                refreshView();
            }
        };

        invokeRender(controller, host, context, 'weeklyTeams');
    }

    function mountDisciplineControllerIfPresent() {
        var controller = lookupController('disciplines');
        if (!controller) { return; }

        var host = document.getElementById('academy-disciplines-host');
        if (!host) { return; }

        var context = {
            onChange: function() { refreshView(); }
        };

        invokeRender(controller, host, context, 'disciplines');
    }

    function mountLocationControllerIfPresent() {
        var controller = lookupController('locations');
        if (!controller) { return; }

        var host = document.getElementById('academy-locations-host');
        if (!host) { return; }

        var context = {
            week: AcademyUI.getDisplayWeek(),
            onChange: function() { refreshView(); }
        };

        invokeRender(controller, host, context, 'locations');
    }

    function lookupController(viewId) {
        var Registry = getControllers();
        if (!Registry || typeof Registry.get !== 'function') {
            return null;
        }
        return Registry.get(viewId);
    }

    function invokeRender(controller, host, context, viewId) {
        var Contract = getControllerContract();
        if (!Contract || typeof Contract.invoke !== 'function') {
            return;
        }

        // Record that we rendered this view's controller, so the
        // outgoing-unmount step knows which controller to unmount on
        // the next view change.
        _lastRenderedControllerView = viewId;

        try {
            Contract.invoke(controller, 'render', [host, context]);
        } catch (e) {
            console.warn(
                '[AcademyView] controller render threw for view "' +
                viewId + '":', e
            );
            host.innerHTML =
                '<p class="empty-state">' +
                    'Failed to render this view.' +
                '</p>';
        }
    }

    // ============================================================
    // DELEGATED CLICK
    // ============================================================

    function onDelegatedClick(e) {
        var target = e.target;

        // ---- View switcher ----
        var viewBtn = target.closest('.academy-view-btn');
        if (viewBtn) {
            e.preventDefault();
            handleViewSwitch(viewBtn.dataset.view);
            return;
        }

        // ---- Rankings row (still inline until S1.7) ----
        var rankingRow = target.closest('.academy-ranking-row');
        if (rankingRow) {
            e.preventDefault();
            var rankingCharId = rankingRow.dataset
                ? rankingRow.dataset.characterId
                : null;
            if (rankingCharId) {
                var rankingClassId = _selectedRankingClassId ||
                    AcademyUI.getSelectedClassId();
                if (rankingClassId) {
                    AcademyUI.selectClass(rankingClassId);
                }
                AcademyUI.selectCharacter(rankingCharId);
                AcademyUI.setSelectedView('people');
                refreshView();
            }
            return;
        }

        // ---- Route everything else to the active controller ----
        routeEventToActiveController('handleClick', e);
    }

    // ============================================================
    // DELEGATED CHANGE
    // ============================================================

    function onDelegatedChange(e) {
        var target = e.target;

        // ---- Rankings week input (still inline until S1.7) ----
        if (target.id === 'academy-ranking-week-input') {
            commitRankingWeek(target.value);
            return;
        }

        // ---- Rankings class select (still inline until S1.7) ----
        if (target.id === 'academy-ranking-class-select') {
            _selectedRankingClassId = target.value || null;
            refreshView();
            return;
        }

        // ---- Route everything else to the active controller ----
        routeEventToActiveController('handleChange', e);
    }

    // ============================================================
    // DELEGATED INPUT
    // ============================================================

    function onDelegatedInput(e) {
        // No shell-owned input handlers remain. Every input event is
        // handled by the active controller.
        routeEventToActiveController('handleInput', e);
    }

    // ============================================================
    // DELEGATED KEYDOWN
    // ============================================================

    function onDelegatedKeydown(e) {
        var target = e.target;
        if (e.key !== 'Enter') { return; }

        // ---- Rankings week input (still inline until S1.7) ----
        if (target.id === 'academy-ranking-week-input') {
            e.preventDefault();
            commitRankingWeek(target.value);
            return;
        }

        // ---- Route everything else to the active controller ----
        routeEventToActiveController('handleKeydown', e);
    }

    // ============================================================
    // CONTROLLER EVENT ROUTING
    // ============================================================

    function routeEventToActiveController(methodName, e) {
        var Registry = getControllers();
        var Contract = getControllerContract();
        if (!Registry || typeof Registry.get !== 'function') { return; }
        if (!Contract || typeof Contract.invoke !== 'function') { return; }

        var view = AcademyUI.getSelectedView();
        var controller = Registry.get(view);
        if (!controller) { return; }

        try {
            Contract.invoke(controller, methodName, [e]);
        } catch (err) {
            console.warn(
                '[AcademyView] controller ' + methodName +
                ' threw for view "' + view + '":', err
            );
        }
    }

    // ============================================================
    // VIEW SWITCHER
    // ============================================================

    function handleViewSwitch(viewId) {
        if (!viewId) { return; }
        if (VALID_VIEW_IDS.indexOf(viewId) === -1) { return; }
        if (AcademyUI.setSelectedView(viewId)) {
            refreshView();
        }
    }

    // ============================================================
    // RANKINGS WEEK (INLINE — S1.7 MIGRATES)
    // ============================================================

    function commitRankingWeek(value) {
        var accepted = AcademyUI.setDisplayWeek(value);
        if (accepted) {
            refreshView();
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyView = {
        render: render,
        refreshView: refreshView,
        unmount: unmount,
        VIEWS: VIEWS
    };

})();
