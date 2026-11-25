/**
 * modules/academy/controllers/academy-location-controller.js
 * Academy Location Controller
 *
 * Path: js/modules/academy/controllers/academy-location-controller.js
 *
 * The Locations feature controller. Owns the Locations view.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Locations view into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by
 *     the shell for events inside the host.
 *   - The location selection.
 *   - The list filter and search debounce.
 *   - Routing location-* actions to AcademyCRUDModals.
 *   - Mounting the read-only schedule grid into
 *     #academy-location-schedule-host.
 *   - Mounting the co-occupants panel into
 *     #academy-schedule-co-occupants-host, when a marker is
 *     clicked.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The display week. Read and written through AcademyUI.
 *   - Re-rendering the shell.
 *   - Location domain reads and writes.
 *
 * CO-OCCUPANTS PANEL:
 *   The location grid is read-only: cells carry no action. The
 *   one interactive element inside an occupied cell is the
 *   co-occupant marker, which emits
 *   data-action="schedule-co-occupants-open" with the cell's
 *   day and hour. This controller resolves the slot's
 *   coOccupants list from the grid VM it already fetched and
 *   renders a detail panel below the grid.
 *
 *   Only one panel is open at a time. Clicking the same marker
 *   closes it. Clicking a different marker swaps contents.
 *   Re-rendering the view (week change, location change) clears
 *   the panel state.
 *
 * SCHEDULE GRID:
 *   Produced by AcademyCalendarAggregator, handed to
 *   CalendarRenderer.
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

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function escapeHtml(value) {
        var DU = window.DomUtils;
        if (DU && typeof DU.escapeHtml === 'function') {
            return DU.escapeHtml(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        var DU = window.DomUtils;
        if (DU && typeof DU.escapeAttribute === 'function') {
            return DU.escapeAttribute(value);
        }
        return escapeHtml(value);
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _host = null;
    var _context = null;

    var _selectedLocationId = null;
    var _locationFilters = { type: 'all', search: '' };
    var _locationSearchTimer = null;

    // Co-occupants panel state.
    //
    //   _openCoOccupantsSlot = { day, hour } | null
    //
    // The slot descriptor itself is re-resolved from the grid VM
    // on every mount, so the panel never holds a stale reference
    // to a slot.
    var _openCoOccupantsSlot = null;

    // Cached grid VM per render. Used by the co-occupants
    // handler to resolve the slot descriptor by (day, hour)
    // without a second aggregator call.
    var _currentGridVM = null;

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

        // A re-render invalidates the panel: the grid is about to
        // be replaced, and the slot it referenced may no longer
        // exist (different week, different location).
        _openCoOccupantsSlot = null;
        _currentGridVM = null;

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

        // Cache the grid VM so the co-occupants handler can
        // resolve slot descriptors without a second aggregator
        // call. Cleared on every render.
        _currentGridVM = gridVM;

        var renderState = {
            selectedId: locationId,
            week: week
        };

        var renderVM = {
            // canEdit is false: the location grid is read-only.
            canEdit: false,
            canEditInstructorSlot: false,

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
            return;
        }

        // If the panel was open before this render and the same
        // slot still exists on the new grid, re-mount it. The
        // render() entry point clears the panel state, so this
        // branch is only reached on the initial mount or on a
        // re-mount triggered without a full render pass.
        if (_openCoOccupantsSlot) {
            mountCoOccupantsPanel();
        }
    }

    // ============================================================
    // CO-OCCUPANTS PANEL
    // ============================================================

    function handleCoOccupantsOpen(el) {
        if (!el || !el.dataset) { return; }

        var day = parseInt(el.dataset.day, 10);
        var hour = parseInt(el.dataset.hour, 10);

        if (isNaN(day) || isNaN(hour)) {
            return;
        }

        var slot = { day: day, hour: hour };

        // Toggle: clicking the same marker again closes the panel.
        if (_openCoOccupantsSlot &&
            _openCoOccupantsSlot.day === day &&
            _openCoOccupantsSlot.hour === hour) {
            closeCoOccupantsPanel();
            return;
        }

        _openCoOccupantsSlot = slot;
        mountCoOccupantsPanel();
    }

    function closeCoOccupantsPanel() {
        _openCoOccupantsSlot = null;
        var host = document.getElementById(
            'academy-schedule-co-occupants-host'
        );
        if (host) {
            host.innerHTML = '';
        }
    }

    function resolveSlotDescriptor(day, hour) {
        if (!_currentGridVM || !_currentGridVM.schedule) {
            return null;
        }
        var daySchedule = _currentGridVM.schedule[day];
        if (!daySchedule || typeof daySchedule !== 'object') {
            return null;
        }
        var slot = daySchedule[hour];
        if (!slot || typeof slot !== 'object') {
            return null;
        }
        return slot;
    }

    function mountCoOccupantsPanel() {
        var host = document.getElementById(
            'academy-schedule-co-occupants-host'
        );
        if (!host) { return; }

        if (!_openCoOccupantsSlot) {
            host.innerHTML = '';
            return;
        }

        var day = _openCoOccupantsSlot.day;
        var hour = _openCoOccupantsSlot.hour;

        var slot = resolveSlotDescriptor(day, hour);
        if (!slot) {
            host.innerHTML = '';
            _openCoOccupantsSlot = null;
            return;
        }

        host.innerHTML = buildCoOccupantsPanelHTML(slot, day, hour);
    }

    /**
     * Build the panel HTML.
     *
     * Two slots can share a cell: the primary (the one the
     * projector placed first) and the co-occupants. Both are
     * rendered, the primary first, so the panel is a complete
     * list of who is in the room.
     */
    function buildCoOccupantsPanelHTML(slot, day, hour) {
        var AC = window.CalendarConstants;
        var dayLabel = AC && typeof AC.getDayName === 'function'
            ? (AC.getDayName(day) || ('Day ' + day))
            : ('Day ' + day);
        var hourLabel = AC && typeof AC.formatHour === 'function'
            ? (AC.formatHour(hour) || (hour + ':00'))
            : (hour + ':00');

        var primary = {
            disciplineName: slot.disciplineName || 'Unknown',
            instructorName: slot.instructorName || '',
            duration: isFiniteNumber(slot.duration) ? slot.duration : 1
        };

        var coOccupants = Array.isArray(slot.coOccupants)
            ? slot.coOccupants
            : [];

        var total = 1 + coOccupants.length;

        var html = '';
        html += '<div class="schedule-co-occupants-panel">';

        html += '<div class="schedule-co-occupants-header">';
        html += '<span class="schedule-co-occupants-title">' +
                    escapeHtml(dayLabel) + ', ' +
                    escapeHtml(hourLabel) +
                '</span>';
        html += '<span class="schedule-co-occupants-count">' +
                    total + ' group' + (total === 1 ? '' : 's') +
                    ' in this slot' +
                '</span>';
        html += '<button type="button" ' +
                    'class="schedule-co-occupants-close" ' +
                    'data-action="schedule-co-occupants-close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<ul class="schedule-co-occupants-list">';
        html += renderCoOccupantsRow(primary, true);
        for (var i = 0; i < coOccupants.length; i++) {
            html += renderCoOccupantsRow(coOccupants[i], false);
        }
        html += '</ul>';

        html += '</div>';

        return html;
    }

    function renderCoOccupantsRow(occ, isPrimary) {
        if (!occ) { return ''; }

        var disciplineName = isNonEmptyString(occ.disciplineName)
            ? occ.disciplineName
            : 'Unknown Discipline';
        var instructorName = isNonEmptyString(occ.instructorName)
            ? occ.instructorName
            : '';
        var duration = isFiniteNumber(occ.duration)
            ? occ.duration
            : null;

        var rowClass = 'schedule-co-occupants-row';
        if (isPrimary) {
            rowClass += ' schedule-co-occupants-row-primary';
        }

        var html = '';
        html += '<li class="' + rowClass + '">';

        html += '<span class="schedule-co-occupants-bullet">' +
                    (isPrimary ? '\u25cf' : '\u25cb') +
                '</span>';

        html += '<span class="schedule-co-occupants-discipline">' +
                    escapeHtml(disciplineName) +
                '</span>';

        if (instructorName) {
            html += '<span class="schedule-co-occupants-instructor">' +
                        escapeHtml(instructorName) +
                    '</span>';
        } else {
            html += '<span class="schedule-co-occupants-instructor ' +
                        'schedule-co-occupants-instructor-empty">' +
                        'No instructor' +
                    '</span>';
        }

        if (duration !== null && duration > 1) {
            html += '<span class="schedule-co-occupants-duration">' +
                        duration + 'h' +
                    '</span>';
        }

        html += '</li>';
        return html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        // ---- Co-occupants panel close button ----
        if (target.closest('[data-action="schedule-co-occupants-close"]')) {
            e.preventDefault();
            closeCoOccupantsPanel();
            return;
        }

        // ---- Co-occupants marker ----
        //
        // Checked BEFORE the location row and the generic action
        // dispatch, because the marker lives inside the grid,
        // which lives inside a detail panel that is inside a
        // location detail container. The location row check
        // would not match it (rows live in the sidebar), but
        // ordering makes the intent explicit.
        var marker = target.closest(
            '[data-action="schedule-co-occupants-open"]'
        );
        if (marker && marker.dataset) {
            e.preventDefault();
            handleCoOccupantsOpen(marker);
            return;
        }

        // ---- Location row selection ----
        var row = target.closest('.academy-location-row');
        if (row && row.dataset && row.dataset.locationId) {
            e.preventDefault();
            // Selecting a location invalidates any open panel;
            // the slot it referenced belongs to the old location.
            _openCoOccupantsSlot = null;
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

        _openCoOccupantsSlot = null;
        _currentGridVM = null;

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
