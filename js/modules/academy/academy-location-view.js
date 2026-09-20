/**
 * modules/academy/academy-location-view.js - Academy Location View
 * Standalone view for browsing locations.
 *
 * Path: js/modules/academy/academy-location-view.js
 *
 * This module is responsible for:
 *   - Rendering the top bar with the week selector
 *   - Rendering the location list with type/search filters
 *   - Rendering the location detail panel (type, capacity,
 *     schedule host)
 *   - Rendering an empty state when no location is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic.
 *   - Does NOT fetch data. Does NOT call AcademyLocations directly.
 *   - Receives a view model from AcademyAggregator.getLocationViewModel.
 *   - Does NOT bind events. Buttons and rows emit data-* attributes
 *     that AcademyView's delegated container listeners resolve.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns an HTML string.
 *
 * SCHEDULE HOST:
 *   The detail panel renders an empty #academy-location-schedule-host
 *   div. Mounting the grid into that host is a controller-lifecycle
 *   concern and lives in AcademyLocationController's
 *   mountLocationScheduleGridIfPresent, not here. The renderer emits
 *   the host; the controller injects the grid.
 *
 *   This mirrors the character detail panel's Schedule tab: the
 *   renderer emits #academy-schedule-host, and the People controller
 *   mounts the grid into it.
 *
 * WEEK SELECTOR:
 *   The top bar carries the week input. This is the same pattern
 *   every other Academy view with a week selector uses. Changing
 *   the week fires #academy-location-week-input's change event,
 *   which the controller routes to AcademyUI.setDisplayWeek.
 *
 * VIEW MODEL SOURCE:
 *   AcademyAggregator.getLocationViewModel(filters, week,
 *   selectedLocationId). Every display-ready value (including
 *   typeLabel) is on the VM.
 *
 * INTERFACE:
 *   AcademyLocationView.renderHTML(viewModel) -> string
 *
 *   viewModel:
 *     {
 *       locations:   [ <rowVM> ],
 *       selected:    <detailVM> | null,
 *       filters:     { type, search },
 *       week:        number | null,
 *       total:       number
 *     }
 *
 *   rowVM:
 *     {
 *       id:            string,
 *       name:          string,
 *       type:          string,
 *       typeLabel:     string,
 *       capacity:      number | null,
 *       scheduleCount: number
 *     }
 *
 *   detailVM:
 *     {
 *       id:         string,
 *       name:       string,
 *       type:       string,
 *       typeLabel:  string,
 *       capacity:   number | null,
 *       schedule:   [ <slotVM> ]
 *     }
 *
 *   The `schedule` array on detailVM is no longer rendered here.
 *   It is dead (the grid replaces it), but the VM still carries it
 *   because AcademyAggregator computes the count from it. Removing
 *   it from the VM is a separate change.
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   - #academy-location-week-input                        (change/keydown)
 *   - .academy-location-row [data-location-id]            (click)
 *   - #academy-location-type-filter                       (change)
 *   - #academy-location-search                            (input)
 *   - [data-action="location-add"]                        (click)
 *   - [data-action="location-edit"]   [data-location-id]  (click)
 *   - [data-action="location-delete"] [data-location-id]  (click)
 *
 * DEPENDENCIES:
 *   - window.DomUtils         (MANDATORY)
 *   - window.CalendarConstants (MANDATORY) — week bounds
 */

(function() {
    'use strict';

    if (window.__academyLocationViewLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyLocationView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        throw new Error(
            '[AcademyLocationView] Missing mandatory dependency: ' +
            'CalendarConstants.MIN_WEEK / MAX_WEEK'
        );
    }

    window.__academyLocationViewLoaded = true;

    // ============================================================
    // ESCAPING HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
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

    function getLocationTypeBadgeClass(type) {
        switch (type) {
            case 'classroom':   return 'academy-location-type-badge academy-location-type-classroom';
            case 'lab':         return 'academy-location-type-badge academy-location-type-lab';
            case 'gym':         return 'academy-location-type-badge academy-location-type-gym';
            case 'field':       return 'academy-location-type-badge academy-location-type-field';
            case 'hall':        return 'academy-location-type-badge academy-location-type-hall';
            case 'auditorium':  return 'academy-location-type-badge academy-location-type-auditorium';
            case 'library':     return 'academy-location-type-badge academy-location-type-library';
            case 'office':      return 'academy-location-type-badge academy-location-type-office';
            default:            return 'academy-location-type-badge academy-location-type-other';
        }
    }

    function formatCapacity(value) {
        if (!isFiniteNumber(value) || value <= 0) {
            return '';
        }
        return String(value);
    }

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    function renderHTML(viewModel) {
        var vm = viewModel || {};
        var locations = Array.isArray(vm.locations) ? vm.locations : [];
        var selected = vm.selected || null;
        var filters = vm.filters || { type: 'all', search: '' };

        return (
            '<div class="academy-body academy-location-layout">' +
                renderTopBar(vm.week) +
                '<div class="academy-location-panels">' +
                    renderListPanel(locations, filters) +
                    renderDetailPanel(selected, vm.week) +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // TOP BAR
    // ============================================================

    function renderTopBar(week) {
        var html = '';
        html += '<div class="academy-location-top-bar">';

        html += '<div class="academy-location-top-left"></div>';

        html += '<div class="academy-location-top-right">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-location-week-input">Week:</label>';
        html += '<input type="number" id="academy-location-week-input" ' +
                    'class="academy-week-input" ' +
                    'value="' +
                        escapeAttribute(isFiniteNumber(week) ? String(week) : '') +
                    '" ' +
                    'min="' + escapeAttribute(String(CalendarConstants.MIN_WEEK)) + '" ' +
                    'max="' + escapeAttribute(String(CalendarConstants.MAX_WEEK)) + '">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // LIST PANEL - Left side
    // ============================================================

    function renderListPanel(locations, filters) {
        var html = '<div class="academy-location-sidebar">';

        html += renderListActions();
        html += renderListFilters(filters);
        html += renderListItems(locations);

        html += '</div>';
        return html;
    }

    function renderListActions() {
        return (
            '<button type="button" ' +
                'class="primary small academy-add-location-btn" ' +
                'data-action="location-add">' +
                '+ Add Location' +
            '</button>'
        );
    }

    function renderListFilters(filters) {
        var type = filters.type || 'all';
        var search = filters.search || '';

        var html = '<div class="academy-location-filters">';

        html += '<input type="text" id="academy-location-search" ' +
            'class="academy-location-search" ' +
            'placeholder="Search locations..." ' +
            'value="' + escapeAttribute(search) + '">';

        html += '<label class="academy-filter-label" ' +
                    'for="academy-location-type-filter">Type:</label>';
        html += '<select id="academy-location-type-filter" ' +
                    'class="academy-location-type-filter">';
        html += '<option value="all" ' +
                    (type === 'all' ? 'selected' : '') + '>All</option>';
        html += '<option value="classroom" ' +
                    (type === 'classroom' ? 'selected' : '') + '>Classroom</option>';
        html += '<option value="lab" ' +
                    (type === 'lab' ? 'selected' : '') + '>Lab</option>';
        html += '<option value="gym" ' +
                    (type === 'gym' ? 'selected' : '') + '>Gym</option>';
        html += '<option value="field" ' +
                    (type === 'field' ? 'selected' : '') + '>Field</option>';
        html += '<option value="hall" ' +
                    (type === 'hall' ? 'selected' : '') + '>Hall</option>';
        html += '<option value="auditorium" ' +
                    (type === 'auditorium' ? 'selected' : '') + '>Auditorium</option>';
        html += '<option value="library" ' +
                    (type === 'library' ? 'selected' : '') + '>Library</option>';
        html += '<option value="office" ' +
                    (type === 'office' ? 'selected' : '') + '>Office</option>';
        html += '<option value="other" ' +
                    (type === 'other' ? 'selected' : '') + '>Other</option>';
        html += '</select>';

        html += '</div>';
        return html;
    }

    function renderListItems(locations) {
        var html = '<div class="academy-location-list" id="academy-location-list">';

        if (!Array.isArray(locations) || locations.length === 0) {
            html += '<p class="empty-state small">' +
                        'No locations match the current filters.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < locations.length; i++) {
            var l = locations[i];
            if (!l || !l.id) {
                continue;
            }
            html += renderListRow(l);
        }

        html += '</div>';
        return html;
    }

    function renderListRow(l) {
        var badgeClass = getLocationTypeBadgeClass(l.type);

        var html = '';
        html += '<div class="academy-location-row" ' +
                    'data-location-id="' + escapeAttribute(l.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-location-row-main">';
        html += '<span class="academy-location-name">' +
                    escapeHtml(l.name || 'Unnamed Location') +
                '</span>';
        html += '<span class="' + badgeClass + '">' +
                    escapeHtml(l.typeLabel) +
                '</span>';
        html += '</div>';

        var meta = [];
        var capacity = formatCapacity(l.capacity);
        if (capacity) {
            meta.push('Capacity: ' + escapeHtml(capacity));
        }
        if (isFiniteNumber(l.scheduleCount) && l.scheduleCount > 0) {
            meta.push(escapeHtml(String(l.scheduleCount)) + ' scheduled');
        }

        if (meta.length > 0) {
            html += '<div class="academy-location-row-meta">' +
                        meta.join(' &middot; ') +
                    '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL PANEL - Right side
    // ============================================================

    function renderDetailPanel(location, week) {
        var html = '<div class="academy-location-detail" ' +
                    'id="academy-location-detail">';

        if (!location || !location.id) {
            html += renderEmptyDetailState();
        } else {
            html += renderDetailContent(location, week);
        }

        html += '</div>';
        return html;
    }

    function renderEmptyDetailState() {
        return (
            '<div class="academy-detail-empty">' +
                '<p class="empty-state small">' +
                    'Select a location to view its details and schedule.' +
                '</p>' +
            '</div>'
        );
    }

    function renderDetailContent(l, week) {
        var badgeClass = getLocationTypeBadgeClass(l.type);

        var html = '';

        // ---- Header ----
        html += '<div class="academy-location-detail-header">';

        html += '<div class="academy-location-detail-title-row">';
        html += '<h3 class="academy-location-detail-title">' +
                    escapeHtml(l.name || 'Unnamed Location') +
                '</h3>';
        html += '<span class="' + badgeClass + '">' +
                    escapeHtml(l.typeLabel) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-location-detail-meta">';

        var capacity = formatCapacity(l.capacity);
        if (capacity) {
            html += '<span class="academy-location-detail-meta-item">' +
                        '<span class="meta-label">Capacity:</span> ' +
                        escapeHtml(capacity) +
                    '</span>';
        } else {
            html += '<span class="academy-location-detail-meta-item ' +
                        'academy-meta-muted">' +
                        '<span class="meta-label">Capacity:</span> Unspecified' +
                    '</span>';
        }

        if (isFiniteNumber(week)) {
            html += '<span class="academy-location-detail-meta-item">' +
                        '<span class="meta-label">Week:</span> ' +
                        escapeHtml(String(week)) +
                    '</span>';
        }

        html += '</div>';

        // ---- Actions ----
        html += '<div class="academy-location-detail-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="location-edit" ' +
                    'data-location-id="' + escapeAttribute(l.id) + '">' +
                    'Edit Location' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="location-delete" ' +
                    'data-location-id="' + escapeAttribute(l.id) + '">' +
                    'Delete Location' +
                '</button>';
        html += '</div>';

        html += '</div>';

        // ---- Schedule section ----
        html += renderScheduleSection(l, week);

        return html;
    }

    function renderScheduleSection(l, week) {
        var html = '';
        html += '<div class="academy-location-detail-section ' +
                    'academy-location-schedule">';

        html += '<div class="academy-location-detail-section-header">';
        html += '<h4 class="academy-location-detail-section-title">Schedule</h4>';

        if (isFiniteNumber(week)) {
            html += '<span class="academy-location-detail-section-subtitle">' +
                        'Week ' + escapeHtml(String(week)) +
                    '</span>';
        }

        html += '</div>';

        // The host is empty. AcademyLocationController mounts the
        // grid into it. Mirrors the character detail panel's
        // #academy-schedule-host.
        html += '<div id="academy-location-schedule-host" ' +
                    'class="academy-location-schedule-host"></div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyLocationView = {
        renderHTML: renderHTML
    };

})();