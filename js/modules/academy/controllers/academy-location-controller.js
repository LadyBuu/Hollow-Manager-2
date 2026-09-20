/**
 * modules/academy/controllers/academy-location-controller.js
 * Academy Location Controller
 *
 * Path: js/modules/academy/controllers/academy-location-controller.js
 *
 * The Locations feature controller. Owns the Locations view: its
 * render, its row selection, its type/search filters, its week
 * selector, its CRUD modal routing, and the schedule grid mount.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Locations view into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by
 *     the shell for events that occur inside the host.
 *   - The location selection (_selectedLocationId).
 *   - The list filter (_locationFilters).
 *   - The search debounce timer.
 *   - Routing location-* actions to AcademyCRUDModals.
 *   - Mounting the schedule grid into
 *     #academy-location-schedule-host.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The display week. The controller reads and writes it through
 *     AcademyUI.
 *   - Re-rendering the shell.
 *   - Location domain reads and writes.
 *
 * SCHEDULE GRID:
 *   Produced by AcademyCalendarAggregator, handed to
 *   CalendarRenderer. This controller asks for the grid VM and
 *   places the HTML. It does not know how the grid is shaped.
 *
 * WEEK SELECTOR:
 *   The location view's top bar carries a week input. Changing
 *   the week fires AcademyUI.setDisplayWeek and re-renders. The
 *   grid re-mounts on the new week because render is re-entered.
 *
 * DEPENDENCIES (mandatory):
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyLocationView
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (lazy):
 *   - window.AcademyCRUDModals
 *   - window.AcademyCalendarAggregator
 *   - window.CalendarRenderer
 */

(function() {
    'use strict';

    if (window.__academyLocationControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var View = window.AcademyLocationView;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    if (!AcademyUI ||
        typeof AcademyUI.getDisplayWeek !== 'function' ||
        typeof AcademyUI.setDisplayWeek !== 'function') {
        _missing.push('AcademyUI display-week API');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getLocationViewModel !== 'function') {
        _missing.push('AcademyAggregator.getLocationViewModel');
    }
    if (!View || typeof View.renderHTML !== 'function') {
        _missing.push('AcademyLocationView.renderHTML');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyLocationController] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyLocationControllerLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getCRUDModals() {
        return window.AcademyCRUDModals || null;
    }

    function getCalendarAggregator() {
        return window.AcademyCalendarAggregator || null;
    }

    function getCalendarRenderer() {
        return window.CalendarRenderer || null;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _host = null;
    var _context = null;

    var _selectedLocationId = null;
    var _locationFilters = { type: 'all', search: '' };
    var _locationSearchTimer = null;

    // ============================================================
    // CONTEXT NORMALISATION
    // ============================================================

    function normaliseContext(rawContext) {
        var ctx = rawContext && typeof rawContext === 'object'
            ? rawContext
            : {};

        var onChange = typeof ctx.onChange === 'function'
            ? ctx.onChange
            : function() {};

        return { onChange: onChange };
    }

    function getContext() {
        if (_context) { return _context; }
        return normaliseContext(null);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(host, rawContext) {
        if (!host || typeof host !== 'object') {
            return;
        }

        _host = host;
        _context = normaliseContext(rawContext);

        var week = AcademyUI.getDisplayWeek();

        var vm;
        try {
            vm = AcademyAggregator.getLocationViewModel(
                _locationFilters,
                week,
                _selectedLocationId
            );
        } catch (e) {
            console.warn(
                '[AcademyLocationController] getLocationViewModel ' +
                'threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to load locations.' +
                    '</p>' +
                '</div>';
            return;
        }

        if (!vm.selected) {
            _selectedLocationId = null;
        }

        var html;
        try {
            html = View.renderHTML(vm);
        } catch (e) {
            console.warn(
                '[AcademyLocationController] renderHTML threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to render locations.' +
                    '</p>' +
                '</div>';
            return;
        }

        host.innerHTML = html;

        // Mount the schedule grid into its host. Runs after the
        // innerHTML swap, so the host element is present.
        if (_selectedLocationId) {
            mountLocationScheduleGridIfPresent(_selectedLocationId, week);
        }
    }

    // ============================================================
    // SCHEDULE GRID MOUNT
    // ============================================================

    function mountLocationScheduleGridIfPresent(locationId, week) {
        var host = document.getElementById(
            'academy-location-schedule-host'
        );
        if (!host) { return; }

        var Renderer = getCalendarRenderer();
        if (!Renderer || typeof Renderer.renderGrid !== 'function') {
            host.innerHTML = '<p class="empty-state small">' +
                'Calendar renderer not available.' +
                '</p>';
            return;
        }

        var ACA = getCalendarAggregator();
        if (!ACA || typeof ACA.getLocationScheduleViewModel !== 'function') {
            host.innerHTML = '<p class="empty-state small">' +
                'Schedule data not available.' +
                '</p>';
            return;
        }

        var gridVM = null;
        try {
            gridVM = ACA.getLocationScheduleViewModel(locationId, week);
        } catch (e) {
            console.warn(
                '[AcademyLocationController] ' +
                'getLocationScheduleViewModel threw:', e
            );
        }

        if (!gridVM) {
            host.innerHTML = '<p class="empty-state small">' +
                'Schedule data not available.' +
                '</p>';
            return;
        }

        var renderState = {
            selectedId: locationId,
            week: week
        };

        var renderVM = {
            // canEdit is false: the location grid is read-only. A
            // location is a resource, not an actor; the assign
            // flow belongs to the character's schedule grid.
            canEdit: false,

            mode: null,
            schedule: gridVM.schedule,
            restDays: gridVM.restDays,
            entityName: gridVM.entityName,
            modeLabel: gridVM.modeLabel,
            showEmptySlots: false,
            showRestDays: true,
            hours: gridVM.hours
        };

        try {
            host.innerHTML = Renderer.renderGrid(renderState, renderVM);
        } catch (e) {
            console.warn(
                '[AcademyLocationController] renderGrid failed:', e
            );
            host.innerHTML = '<p class="empty-state small">' +
                'Failed to render schedule grid.' +
                '</p>';
        }
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        // ---- Location row selection ----
        var row = target.closest('.academy-location-row');
        if (row && row.dataset && row.dataset.locationId) {
            e.preventDefault();
            handleRowClick(row.dataset.locationId);
            return;
        }

        // ---- Delegated action dispatch ----
        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;
        if (!isNonEmptyString(action)) { return; }

        switch (action) {
            case 'location-add':
                e.preventDefault();
                openLocationForm(null);
                return;
            case 'location-edit':
                e.preventDefault();
                openLocationForm(actionEl.dataset.locationId);
                return;
            case 'location-delete':
                e.preventDefault();
                openLocationDelete(actionEl.dataset.locationId);
                return;
            default:
                // Diagnostic: a click on an element carrying
                // data-action that the switch does not recognise.
                // If you see this in the console when clicking a
                // location control, the action name is mismatched
                // between the view and this controller.
                console.warn(
                    '[AcademyLocationController] unhandled action:',
                    action
                );
                return;
        }
    }

    function handleChange(e) {
        var target = e.target;
        if (!target || !target.id) { return; }

        if (target.id === 'academy-location-type-filter') {
            _locationFilters.type = target.value;
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        if (target.id === 'academy-location-week-input') {
            commitDisplayWeek(target.value);
            return;
        }
    }

    function handleInput(e) {
        var target = e.target;
        if (!target || !target.id) { return; }

        if (target.id === 'academy-location-search') {
            debounceLocationSearch(target.value);
            return;
        }
    }

    function handleKeydown(e) {
        var target = e.target;
        if (!target || e.key !== 'Enter') { return; }

        if (target.id === 'academy-location-week-input') {
            e.preventDefault();
            commitDisplayWeek(target.value);
            return;
        }
    }

    // ============================================================
    // ROW SELECTION
    // ============================================================

    function handleRowClick(locationId) {
        var next = (String(_selectedLocationId) === String(locationId))
            ? null
            : String(locationId);
        _selectedLocationId = next;
        var ctx = getContext();
        ctx.onChange();
    }

    // ============================================================
    // WEEK COMMIT
    // ============================================================

    function commitDisplayWeek(value) {
        var accepted = AcademyUI.setDisplayWeek(value);
        if (accepted) {
            var ctx = getContext();
            ctx.onChange();
        }
    }

    // ============================================================
    // CRUD MODAL ROUTING
    // ============================================================

    function openLocationForm(locationId) {
        var CRUD = getCRUDModals();
        if (!CRUD || typeof CRUD.openLocationForm !== 'function') {
            notify('CRUD module not available.', 'error');
            return;
        }
        CRUD.openLocationForm(locationId || null);
    }

    function openLocationDelete(locationId) {
        if (!isNonEmptyString(locationId)) { return; }

        var CRUD = getCRUDModals();
        if (!CRUD || typeof CRUD.openLocationDelete !== 'function') {
            notify('CRUD module not available.', 'error');
            return;
        }
        CRUD.openLocationDelete(locationId);
    }

    // ============================================================
    // SEARCH DEBOUNCE
    // ============================================================

    function debounceLocationSearch(value) {
        if (_locationSearchTimer) {
            clearTimeout(_locationSearchTimer);
        }
        _locationSearchTimer = setTimeout(function() {
            _locationSearchTimer = null;
            _locationFilters.search = value;
            var ctx = getContext();
            ctx.onChange();
        }, 150);
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        if (_locationSearchTimer) {
            clearTimeout(_locationSearchTimer);
            _locationSearchTimer = null;
        }

        _host = null;
        _context = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyLocationController = Object.freeze({
        render: render,
        handleClick: handleClick,
        handleChange: handleChange,
        handleInput: handleInput,
        handleKeydown: handleKeydown,
        unmount: unmount
    });

})();