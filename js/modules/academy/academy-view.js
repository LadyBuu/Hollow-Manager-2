/**
 * modules/academy/academy-view.js - Academy Unified Shell
 * UI controller and coordinator for the Academy tab.
 *
 * Path: js/modules/academy/academy-view.js
 *
 * RESPONSIBILITIES:
 *   - Own the top-level Academy shell (view switcher).
 *   - Resolve the active view's controller from the registry.
 *   - Hand the controller its host element and a context.
 *   - Own the single delegated listener set for the tab, and route
 *     every event to the active controller.
 *   - Own the shared CRUD modal callback wiring
 *     (AcademyCRUDModals.setOnChangeCallback).
 *   - Preserve scroll position of same-view sidebars across
 *     refreshes (C6).
 *   - Call the outgoing controller's unmount() when the active view
 *     changes and on shell teardown.
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
 *     rankings        AcademyRankingController
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
 * DEPENDENCY WHITELIST (S1.8):
 *   This module may reference:
 *     - window.AcademyUI
 *     - window.AcademyControllers
 *     - window.AcademyControllerContract
 *     - window.DomUtils
 *     - window.CalendarConstants
 *     - window.AcademyCRUDModals
 *
 *   Nothing else. No aggregators. No renderers. No domain modules.
 *   No feature-scoped state beyond the shell's own coordinator
 *   bookkeeping.
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
    //
    // These are the entire optional surface this module may reach.
    // Each is a lazy lookup because the shell loads before the
    // controllers directory and before academy-crud-modals.js's
    // setOnChangeCallback wiring is meaningful. The lookups run at
    // call time, not at IIFE time.

    function getControllers() {
        return window.AcademyControllers || null;
    }

    function getControllerContract() {
        return window.AcademyControllerContract || null;
    }

    function getAcademyCRUDModals() {
        return window.AcademyCRUDModals || null;
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
    // Three pieces of module state, all coordinator bookkeeping:
    //
    //   _boundContainer, _boundHandlers
    //     The single delegated listener set for the tab.
    //
    //   _lastRenderedControllerView
    //     The view whose controller was rendered on the previous
    //     pass. Used to invoke that controller's unmount() when the
    //     active view changes, and on shell teardown.
    //
    // No feature state. No timers. No sub-editor references.

    var _boundContainer = null;
    var _boundHandlers = null;
    var _lastRenderedControllerView = null;

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
        // view. On a same-view refresh, this is a no-op.
        unmountOutgoingControllerIfPresent(false);

        var view = AcademyUI.getSelectedView();
        if (VALID_VIEW_IDS.indexOf(view) === -1) {
            view = 'people';
        }

        var html = '';
        html += renderViewNav(view);
        html += renderControllerHostForView(view);

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
                        'data-view="' +
                            DomUtils.escapeAttribute(v.id) + '">' +
                        DomUtils.escapeHtml(v.label) +
                    '</button>';
        }
        html += '</div>';
        return html;
    }

    function renderControllerHostForView(view) {
        switch (view) {
            case 'people':
                return renderControllerHost('academy-people-host');
            case 'tournaments':
                return renderControllerHost('academy-exams-host');
            case 'weeklyTeams':
                return renderControllerHost('academy-weekly-teams-host');
            case 'rankings':
                return renderControllerHost('academy-rankings-host');
            case 'disciplines':
                return renderControllerHost('academy-disciplines-host');
            case 'locations':
                return renderControllerHost('academy-locations-host');
            default:
                return renderPlaceholder('Unknown view: ' + view);
        }
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
            _boundContainer.removeEventListener(
                'click', _boundHandlers.click
            );
            _boundContainer.removeEventListener(
                'change', _boundHandlers.change
            );
            _boundContainer.removeEventListener(
                'input', _boundHandlers.input
            );
            _boundContainer.removeEventListener(
                'keydown', _boundHandlers.keydown
            );
        }
        _boundHandlers = null;
    }

    function wireCRUDModalsCallbacks() {
        var CRUD = getAcademyCRUDModals();
        if (CRUD && typeof CRUD.setOnChangeCallback === 'function') {
            CRUD.setOnChangeCallback(refreshView);
        }
        // AcademyTournamentEvents.setOnChangeCallback is wired by
        // AcademyExamController on each render. The shell does not
        // touch it.
    }

    // ============================================================
    // CONTROLLER MOUNT DISPATCH
    // ============================================================

    function mountActiveControllerIfPresent() {
        var view = AcademyUI.getSelectedView();

        switch (view) {
            case 'people':
                mountControllerForView('people', 'academy-people-host', {
                    onChange: function() { refreshView(); }
                });
                return;

            case 'tournaments':
                mountControllerForView(
                    'tournaments',
                    'academy-exams-host',
                    {
                        week: AcademyUI.getDisplayWeek(),
                        onChange: function() { refreshView(); }
                    }
                );
                return;

            case 'weeklyTeams':
                mountControllerForView(
                    'weeklyTeams',
                    'academy-weekly-teams-host',
                    {
                        week: AcademyUI.getDisplayWeek(),
                        selectedClassId: AcademyUI.getSelectedClassId(),
                        selectedTeamId: null,
                        onChange: function() { refreshView(); },
                        onSelectTeam: function() { refreshView(); },
                        onSelectClass: function(classId) {
                            AcademyUI.selectClass(classId || null);
                            refreshView();
                        },
                        onOpenCharacterInPeople: function(charId) {
                            openCharacterInPeople(charId);
                        }
                    }
                );
                return;

            case 'rankings':
                mountControllerForView(
                    'rankings',
                    'academy-rankings-host',
                    {
                        week: AcademyUI.getDisplayWeek(),
                        onChange: function() { refreshView(); },
                        onOpenCharacterInPeople: function(charId) {
                            openCharacterInPeople(charId);
                        }
                    }
                );
                return;

            case 'disciplines':
                mountControllerForView(
                    'disciplines',
                    'academy-disciplines-host',
                    {
                        onChange: function() { refreshView(); }
                    }
                );
                return;

            case 'locations':
                mountControllerForView(
                    'locations',
                    'academy-locations-host',
                    {
                        week: AcademyUI.getDisplayWeek(),
                        onChange: function() { refreshView(); }
                    }
                );
                return;

            default:
                return;
        }
    }

    /**
     * Resolve the controller for a view, find its host element, and
     * invoke render(host, context).
     *
     * The view id is the registry key. The host id is the id of the
     * controller host placeholder the shell emitted for that view.
     * The context is supplied by the caller.
     */
    function mountControllerForView(viewId, hostId, context) {
        var controller = lookupController(viewId);
        if (!controller) { return; }

        var host = document.getElementById(hostId);
        if (!host) { return; }

        var Contract = getControllerContract();
        if (!Contract || typeof Contract.invoke !== 'function') {
            return;
        }

        // Record that this view's controller is the active one.
        // Used by unmountOutgoingControllerIfPresent on the next
        // view change.
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

    function lookupController(viewId) {
        var Registry = getControllers();
        if (!Registry || typeof Registry.get !== 'function') {
            return null;
        }
        return Registry.get(viewId);
    }

    /**
     * Unmount the outgoing controller.
     *
     * Two call sites:
     *   - render(), before the new view is written. If the active
     *     view differs from the last rendered view, the last
     *     rendered controller is unmounted.
     *   - unmount(), on shell teardown. The last rendered controller
     *     is unmounted unconditionally.
     *
     * @param {boolean} isShellTeardown
     */
    function unmountOutgoingControllerIfPresent(isShellTeardown) {
        var outgoingView;

        if (isShellTeardown === true) {
            outgoingView = _lastRenderedControllerView;
        } else {
            var activeView = AcademyUI.getSelectedView();
            if (_lastRenderedControllerView &&
                _lastRenderedControllerView !== activeView) {
                outgoingView = _lastRenderedControllerView;
            } else {
                return;
            }
        }

        if (!outgoingView) { return; }

        var Registry = getControllers();
        var Contract = getControllerContract();

        if (Registry && typeof Registry.get === 'function' &&
            Contract && typeof Contract.invoke === 'function') {
            var outgoing = Registry.get(outgoingView);
            if (outgoing) {
                try {
                    Contract.invoke(outgoing, 'unmount', []);
                } catch (e) {
                    console.warn(
                        '[AcademyView] controller unmount threw for ' +
                        'view "' + outgoingView + '":', e
                    );
                }
            }
        }

        _lastRenderedControllerView = null;
    }

    /**
     * Shared helper for the onOpenCharacterInPeople callback. Used
     * by the Weekly Teams and Ranking mount contexts.
     *
     * Navigates to People with the given character selected. The
     * class is whatever AcademyUI already has selected; if none, the
     * character selection still happens and People renders its
     * empty-class state.
     */
    function openCharacterInPeople(charId) {
        if (!isNonEmptyString(charId)) { return; }
        AcademyUI.selectCharacter(charId);
        AcademyUI.setSelectedView('people');
        refreshView();
    }

    // ============================================================
    // DELEGATED EVENT HANDLERS
    // ============================================================
    //
    // Every handler forwards to the active controller. The shell
    // handles exactly one event itself: clicks on the view switcher,
    // because the switcher is shell chrome rather than feature
    // content.

    function onDelegatedClick(e) {
        var target = e.target;

        var viewBtn = target && target.closest
            ? target.closest('.academy-view-btn')
            : null;
        if (viewBtn) {
            e.preventDefault();
            handleViewSwitch(viewBtn.dataset.view);
            return;
        }

        routeEventToActiveController('handleClick', e);
    }

    function onDelegatedChange(e) {
        routeEventToActiveController('handleChange', e);
    }

    function onDelegatedInput(e) {
        routeEventToActiveController('handleInput', e);
    }

    function onDelegatedKeydown(e) {
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
    // EXPOSE
    // ============================================================

    window.AcademyView = {
        render: render,
        refreshView: refreshView,
        unmount: unmount,
        VIEWS: VIEWS
    };

})();
