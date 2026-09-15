/**
 * modules/academy/academy-location-view.js - Academy Location View
 * Standalone view for browsing locations.
 *
 * Path: js/modules/academy/academy-location-view.js
 *
 * This module is responsible for:
 *   - Rendering the location list with type/search filters
 *   - Rendering the location detail panel (type, capacity, schedule)
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
 * VIEW MODEL SOURCE:
 *   AcademyAggregator.getLocationViewModel(filters, week, selectedLocationId).
 *   Every display-ready value (including typeLabel) is on the VM.
 *   The renderer does not derive labels from raw enum values.
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
 *   slotVM:
 *     {
 *       day:            number,    // 1-7
 *       hour:           number,    // 0-23
 *       disciplineId:   string,
 *       disciplineName: string,
 *       duration:       number | null,
 *       label:          string
 *     }
 *
 *   The `schedule` array is pre-sorted by (day, hour) in the
 *   aggregator. The renderer does not re-sort.
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   - .academy-location-row [data-location-id]           (click)
 *   - #academy-location-type-filter                      (change)
 *   - #academy-location-search                           (input)
 *   - [data-action="location-add"]                       (click)
 *   - [data-action="location-edit"]   [data-location-id] (click)
 *   - [data-action="location-delete"] [data-location-id] (click)
 *
 * DEPENDENCIES:
 *   - window.DomUtils         (MANDATORY)
 *   - window.CalendarConstants (MANDATORY) — day / hour labels
 *
 * USAGE:
 *   var html = AcademyLocationView.renderHTML(vm);
 *   container.innerHTML = html;
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
        typeof CalendarConstants.getDayName !== 'function') {
        throw new Error(
            '[AcademyLocationView] Missing mandatory dependency: ' +
            'CalendarConstants.getDayName'
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

    function getDayName(dayNum) {
        return CalendarConstants.getDayName(dayNum) || ('Day ' + dayNum);
    }

    function formatHour(hourNum) {
        if (typeof CalendarConstants.formatHour === 'function') {
            return CalendarConstants.formatHour(hourNum);
        }
        return String(hourNum) + ':00';
    }

    function formatCapacity(value) {
        if (!isFiniteNumber(value) || value <= 0) {
            return '';
        }
        return String(value);
    }

    function formatDuration(value) {
        if (!isFiniteNumber(value)) {
            return '\u2014';
        }
        return String(value) + 'h';
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
                renderListPanel(locations, filters) +
                renderDetailPanel(selected, vm.week) +
            '</div>'
        );
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
                    'Select a location to view its details.' +
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

        var schedule = Array.isArray(l.schedule) ? l.schedule : [];
        var count = schedule.length;

        html += '<div class="academy-location-detail-section-header">';
        html += '<h4 class="academy-location-detail-section-title">Schedule</h4>';
        html += '<span class="academy-location-detail-section-subtitle">' +
                    (isFiniteNumber(week)
                        ? 'Week ' + escapeHtml(String(week))
                        : '') +
                '</span>';
        html += '<span class="academy-location-detail-section-count">' +
                    count +
                '</span>';
        html += '</div>';

        if (count === 0) {
            html += '<p class="empty-state small">' +
                        'No classes scheduled at this location for this week.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        // The VM pre-sorts the schedule by (day, hour). No re-sort here.
        html += '<table class="academy-location-schedule-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th class="day-col">Day</th>';
        html += '<th class="time-col">Time</th>';
        html += '<th class="discipline-col">Discipline</th>';
        html += '<th class="duration-col">Duration</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var i = 0; i < schedule.length; i++) {
            html += renderScheduleRow(schedule[i]);
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    function renderScheduleRow(entry) {
        if (!entry) {
            return '';
        }

        var dayName = getDayName(entry.day);
        var hourDisplay = formatHour(entry.hour);
        var disciplineName = entry.disciplineName || 'Unknown';
        var durationDisplay = formatDuration(entry.duration);
        var label = isNonEmptyString(entry.label) ? entry.label : '';

        var html = '<tr class="academy-location-schedule-row">';
        html += '<td class="day-col">' + escapeHtml(dayName) + '</td>';
        html += '<td class="time-col">' + escapeHtml(hourDisplay) + '</td>';
        html += '<td class="discipline-col">' + escapeHtml(disciplineName);
        if (label) {
            html += ' <span class="academy-location-schedule-label">[' +
                        escapeHtml(label) +
                    ']</span>';
        }
        html += '</td>';
        html += '<td class="duration-col">' +
                    escapeHtml(durationDisplay) +
                '</td>';
        html += '</tr>';

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyLocationView = {
        renderHTML: renderHTML
    };

})();
