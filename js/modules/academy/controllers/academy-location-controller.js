/**
 * modules/academy/controllers/academy-location-controller.js
 * Academy Location Controller
 *
 * Path: js/modules/academy/controllers/academy-location-controller.js
 *
 * The Locations feature controller. Owns the Locations view: its
 * render, its row selection, its type/search filters, and its CRUD
 * modal routing.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Locations view (sidebar, detail panel) into the
 *     shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by the
 *     shell for events that occur inside the host.
 *   - The location selection (_selectedLocationId) — the id of the
 *     currently expanded location, or null.
 *   - The list filter (_locationFilters: { type, search }).
 *   - The search debounce timer.
 *   - Routing location-* actions to AcademyCRUDModals
 *     (location-add, location-edit, location-delete).
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The display week. The controller reads it from AcademyUI on
 *     each render via context.week (with an AcademyUI fallback).
 *   - Re-rendering the shell. When a state change or mutation should
 *     re-render, the controller calls context.onChange().
 *   - Location domain reads and writes. AcademyLocations owns them;
 *     AcademyAggregator.getLocationViewModel produces the VM; the
 *     CRUD modals perform the mutations.
 *   - Any navigation to another view. The Locations view has no
 *     cross-view navigation.
 *
 * DEPENDENCY DIRECTION:
 *   Shell → registry → this controller.
 *   This controller never references window.AcademyView.
 *
 * RENDER SIGNATURE:
 *   render(host, context)
 *
 *   host    — the HTMLElement the shell allocates for the active
 *             controller.
 *   context — {
 *               week: number,
 *               onChange: function()
 *             }
 *
 *   The week is passed in for convenience and also readable from
 *   AcademyUI. Either path produces the same value.
 *
 * EVENT ROUTING:
 *   The controller's handleClick handles location row selection and
 *   the three location-* actions. handleChange handles the type
 *   filter. handleInput handles the search debounce.
 *
 *   The renderer's action strings and data attributes are unchanged
 *   from pre-S1.6. No renderer changes are needed.
 *
 * STATE OWNERSHIP:
 *   The location selection (_selectedLocationId) is feature state:
 *   which location's detail panel is expanded. It survives a view
 *   switch (the shell's module-scope selection did too).
 *
 *   The filter (_locationFilters) is feature state, and like the
 *   discipline filter, it survives a view switch.
 *
 *   The search debounce timer is cleared on unmount.
 *
 * DEPENDENCIES:
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyLocationView
 *   - window.AcademyCRUDModals     (lazy)
 *   - window.NotificationSystem
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
        typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
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
    // OPTIONAL DEPENDENCY ACCESSOR
    // ============================================================

    function getCRUDModals() {
        return window.AcademyCRUDModals || null;
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

        var week = typeof ctx.week === 'number' && isFinite(ctx.week)
            ? ctx.week
            : AcademyUI.getDisplayWeek();

        var onChange = typeof ctx.onChange === 'function'
            ? ctx.onChange
            : function() {};

        return {
            week: week,
            onChange: onChange
        };
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

        var vm;
        try {
            vm = AcademyAggregator.getLocationViewModel(
                _locationFilters,
                _context.week,
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

        // The aggregator may drop a stale selection (selected null
        // when the id no longer names a filtered location). Adopt
        // the resolved state so the controller's view is consistent
        // with what was actually rendered.
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
        // No keyboard shortcuts in the Locations view. Reserved.
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
        // Clear the search debounce. A pending search refresh after
        // the view is gone should not fire.
        if (_locationSearchTimer) {
            clearTimeout(_locationSearchTimer);
            _locationSearchTimer = null;
        }

        // The selection and filter are deliberately NOT cleared.
        // They survive a view switch, matching pre-S1.6 behavior.

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

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyLocationController;
        var missing = [];

        var required = [
            'render',
            'handleClick',
            'handleChange',
            'handleInput',
            'handleKeydown',
            'unmount'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyLocationController] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
