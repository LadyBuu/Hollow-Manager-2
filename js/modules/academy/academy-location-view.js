/**
 * modules/academy/academy-location-view.js - Academy Location View
 * Standalone view for browsing locations
 *
 * Path: js/modules/academy/academy-location-view.js
 *
 * This module is responsible for:
 *   - Rendering the location list (with type/capacity filters)
 *   - Rendering the location detail panel (type, capacity, schedule)
 *   - Rendering an empty state when no location is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Does NOT fetch data. Does NOT call AcademyLocations directly.
 *   - Receives a view model from AcademyAggregator
 *   - Does NOT bind events. Buttons and rows emit data-* attributes
 *     that AcademyView's delegated container listeners resolve.
 *   - Uses DomUtils for escaping.
 *   - Returns an HTML string.
 *
 * INTERFACE:
 *   AcademyLocationView.renderHTML(viewModel) -> string
 *
 *   viewModel is the shape produced by
 *   AcademyView.renderLocationView():
 *     {
 *       locations: [ { id, name, type, typeLabel, capacity,
 *                      scheduleCount, scheduleWeek } ],
 *       selected:  { ...same shape..., schedule: [ { day, hour, disciplineId, disciplineName, duration, label } ] } | null,
 *       filters:   { type, search },
 *       total:     number
 *     }
 *
 *   If selected is null, the right panel renders a placeholder.
 *
 * EVENTS EMITTED (via data-* attributes, for AcademyView to bind):
 *   - .academy-location-row [data-location-id]
 *   - #academy-location-type-filter (change)
 *   - #academy-location-search (input)
 *   - [data-action="edit-location"] with [data-location-id]
 *   - [data-action="delete-location"] with [data-location-id]
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.CalendarConstants (MANDATORY) - day/hour labels
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
    window.__academyLocationViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }
        if (!CalendarConstants) {
            missing.push('CalendarConstants');
        }

        if (missing.length > 0) {
            console.warn('[AcademyLocationView] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // ESCAPING HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
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
        // One class per known type so CSS can colour-code.
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

    function getLocationTypeLabel(type) {
        if (!isNonEmptyString(type)) {
            return 'Other';
        }
        return type.charAt(0).toUpperCase() + type.slice(1);
    }

    function getDayName(dayNum) {
        if (CalendarConstants && typeof CalendarConstants.getDayName === 'function') {
            return CalendarConstants.getDayName(dayNum) || ('Day ' + dayNum);
        }
        var names = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        return names[dayNum] || ('Day ' + dayNum);
    }

    function formatHour(hourNum) {
        if (CalendarConstants && typeof CalendarConstants.formatHour === 'function') {
            return CalendarConstants.formatHour(hourNum);
        }
        return String(hourNum) + ':00';
    }

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    /**
     * Render the location view.
     *
     * @param {object|null} viewModel - { locations, selected, filters, total }
     * @returns {string} HTML string
     */
    function renderHTML(viewModel) {
        if (!checkDependencies()) {
            return (
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">Location view dependencies not loaded.</p>' +
                '</div>'
            );
        }

        var vm = viewModel || {};
        var locations = Array.isArray(vm.locations) ? vm.locations : [];
        var selected = vm.selected || null;
        var filters = vm.filters || { type: 'all', search: '' };

        return (
            '<div class="academy-body academy-location-layout">' +
                renderListPanel(locations, filters) +
                renderDetailPanel(selected, vm.scheduleWeek) +
            '</div>'
        );
    }

    // ============================================================
    // LIST PANEL - Left side
    // ============================================================

    function renderListPanel(locations, filters) {
        var html = '<div class="academy-location-sidebar">';

        html += renderListFilters(filters);
        html += renderListItems(locations);

        html += '</div>';
        return html;
    }

    function renderListFilters(filters) {
        var type = filters.type || 'all';
        var search = filters.search || '';

        var html = '<div class="academy-location-filters">';

        html += '<input type="text" id="academy-location-search" ' +
            'class="academy-location-search" ' +
            'placeholder="Search locations..." ' +
            'value="' + escapeAttribute(search) + '">';

        html += '<label class="academy-filter-label">Type:</label>';
        html += '<select id="academy-location-type-filter" class="academy-location-type-filter">';
        html += '<option value="all" ' + (type === 'all' ? 'selected' : '') + '>All</option>';
        html += '<option value="classroom" ' + (type === 'classroom' ? 'selected' : '') + '>Classroom</option>';
        html += '<option value="lab" ' + (type === 'lab' ? 'selected' : '') + '>Lab</option>';
        html += '<option value="gym" ' + (type === 'gym' ? 'selected' : '') + '>Gym</option>';
        html += '<option value="field" ' + (type === 'field' ? 'selected' : '') + '>Field</option>';
        html += '<option value="hall" ' + (type === 'hall' ? 'selected' : '') + '>Hall</option>';
        html += '<option value="auditorium" ' + (type === 'auditorium' ? 'selected' : '') + '>Auditorium</option>';
        html += '<option value="library" ' + (type === 'library' ? 'selected' : '') + '>Library</option>';
        html += '<option value="office" ' + (type === 'office' ? 'selected' : '') + '>Office</option>';
        html += '<option value="other" ' + (type === 'other' ? 'selected' : '') + '>Other</option>';
        html += '</select>';

        html += '</div>';
        return html;
    }

    function renderListItems(locations) {
        var html = '<div class="academy-location-list" id="academy-location-list">';

        if (!Array.isArray(locations) || locations.length === 0) {
            html += '<p class="empty-state small">No locations match the current filters.</p>';
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
        html += '<span class="academy-location-name">' + escapeHtml(l.name || 'Unnamed Location') + '</span>';
        html += '<span class="' + badgeClass + '">' + escapeHtml(getLocationTypeLabel(l.type)) + '</span>';
        html += '</div>';

        var meta = [];
        if (isFiniteNumber(l.capacity) && l.capacity > 0) {
            meta.push('Capacity: ' + escapeHtml(String(l.capacity)));
        }
        if (isFiniteNumber(l.scheduleCount) && l.scheduleCount > 0) {
            meta.push(escapeHtml(String(l.scheduleCount)) + ' scheduled');
        }

        if (meta.length > 0) {
            html += '<div class="academy-location-row-meta">' + meta.join(' &middot; ') + '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL PANEL - Right side
    // ============================================================

    function renderDetailPanel(location, week) {
        var html = '<div class="academy-location-detail" id="academy-location-detail">';

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
                '<p class="empty-state small">Select a location to view its details.</p>' +
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
                    escapeHtml(getLocationTypeLabel(l.type)) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-location-detail-meta">';

        if (isFiniteNumber(l.capacity) && l.capacity > 0) {
            html += '<span class="academy-location-detail-meta-item">' +
                        '<span class="meta-label">Capacity:</span> ' +
                        escapeHtml(String(l.capacity)) +
                    '</span>';
        } else {
            html += '<span class="academy-location-detail-meta-item academy-meta-muted">' +
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
                    'data-action="edit-location" ' +
                    'data-location-id="' + escapeAttribute(l.id) + '">' +
                    'Edit Location' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="delete-location" ' +
                    'data-location-id="' + escapeAttribute(l.id) + '">' +
                    'Delete Location' +
                '</button>';
        html += '</div>';

        html += '</div>';

        // ---- Schedule section ----
        html += renderScheduleSection(l, week);

        html += '</div>';
        return html;
    }

    function renderScheduleSection(l, week) {
        var html = '';
        html += '<div class="academy-location-detail-section academy-location-schedule">';

        var schedule = Array.isArray(l.schedule) ? l.schedule : [];
        var count = schedule.length;

        html += '<div class="academy-location-detail-section-header">';
        html += '<h4 class="academy-location-detail-section-title">Schedule</h4>';
        html += '<span class="academy-location-detail-section-subtitle">' +
                    (isFiniteNumber(week) ? 'Week ' + escapeHtml(String(week)) : '') +
                '</span>';
        html += '<span class="academy-location-detail-section-count">' + count + '</span>';
        html += '</div>';

        if (count === 0) {
            html += '<p class="empty-state small">No classes scheduled at this location for this week.</p>';
            html += '</div>';
            return html;
        }

        // Sort by day, then hour. The VM is already sorted, but we sort
        // again defensively so the renderer is correct regardless of
        // the source's ordering guarantees.
        var sorted = schedule.slice().sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            return a.hour - b.hour;
        });

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

        for (var i = 0; i < sorted.length; i++) {
            html += renderScheduleRow(sorted[i]);
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
        var duration = isFiniteNumber(entry.duration) ? entry.duration : 1;
        var label = isNonEmptyString(entry.label) ? entry.label : '';

        var html = '<tr class="academy-location-schedule-row">';
        html += '<td class="day-col">' + escapeHtml(dayName) + '</td>';
        html += '<td class="time-col">' + escapeHtml(hourDisplay) + '</td>';
        html += '<td class="discipline-col">' + escapeHtml(disciplineName);
        if (label) {
            html += ' <span class="academy-location-schedule-label">[' + escapeHtml(label) + ']</span>';
        }
        html += '</td>';
        html += '<td class="duration-col">' + escapeHtml(String(duration)) + 'h</td>';
        html += '</tr>';

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyLocationView = {
        renderHTML: renderHTML
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyLocationView;
        var missing = [];

        var required = ['renderHTML'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyLocationView] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();