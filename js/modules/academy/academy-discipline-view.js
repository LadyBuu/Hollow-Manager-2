/**
 * modules/academy/academy-discipline-view.js - Academy Discipline View
 * Standalone view for browsing disciplines (curriculum)
 *
 * Path: js/modules/academy/academy-discipline-view.js
 *
 * This module is responsible for:
 *   - Rendering the discipline list (with type/status filters)
 *   - Rendering the discipline detail panel (instructors, weeks, weight)
 *   - Rendering an empty state when no discipline is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Does NOT fetch data. Does NOT call AcademyDisciplines directly.
 *   - Receives a view model from AcademyAggregator
 *   - Does NOT bind events. Buttons and rows emit data-* attributes
 *     that AcademyView's delegated container listeners resolve.
 *   - Uses DomUtils for escaping.
 *   - Returns an HTML string.
 *
 * INTERFACE:
 *   AcademyDisciplineView.renderHTML(viewModel) -> string
 *
 *   viewModel is the shape produced by
 *   AcademyAggregator.getDisciplineViewViewModel(options):
 *     {
 *       disciplines: [ { id, name, type, typeLabel, startWeek, endWeek,
 *                        weeklyHours, weight, instructorIds,
 *                        instructorNames[], status, description } ],
 *       selected: <same shape> | null,
 *       filters: { type, search },
 *       total: number
 *     }
 *
 *   If selected is null, the right panel renders a placeholder.
 *
 * EVENTS EMITTED (via data-* attributes, for AcademyView to bind):
 *   - .academy-discipline-row [data-discipline-id]
 *   - #academy-discipline-type-filter (change)
 *   - #academy-discipline-search (input)
 *   - [data-action="edit-discipline"] with [data-discipline-id]
 *   - [data-action="delete-discipline"] with [data-discipline-id]
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *
 * USAGE:
 *   var html = AcademyDisciplineView.renderHTML(vm);
 *   container.innerHTML = html;
 */

(function() {
    'use strict';

    if (window.__academyDisciplineViewLoaded) {
        return;
    }
    window.__academyDisciplineViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;

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

        if (missing.length > 0) {
            console.warn('[AcademyDisciplineView] Missing dependencies:', missing.join(', '));
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

    function getDisciplineTypeBadgeClass(type) {
        switch (type) {
            case 'mandatory': return 'academy-discipline-type-badge academy-discipline-type-mandatory';
            case 'optional':  return 'academy-discipline-type-badge academy-discipline-type-optional';
            default:          return 'academy-discipline-type-badge academy-discipline-type-unknown';
        }
    }

    function getDisciplineTypeLabel(type) {
        if (type === 'mandatory') return 'Mandatory';
        if (type === 'optional')  return 'Optional';
        return 'Unknown';
    }

    function formatWeekRange(startWeek, endWeek) {
        var s = isFiniteNumber(startWeek) ? String(startWeek) : '';
        var e = isFiniteNumber(endWeek)   ? String(endWeek)   : '';
        if (s && e) {
            return 'Weeks ' + s + '\u2013' + e;
        }
        if (s) {
            return 'From week ' + s;
        }
        if (e) {
            return 'Until week ' + e;
        }
        return '';
    }

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    /**
     * Render the discipline view.
     *
     * @param {object|null} viewModel - { disciplines, selected, filters, total }
     * @returns {string} HTML string
     */
    function renderHTML(viewModel) {
        if (!checkDependencies()) {
            return (
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">Discipline view dependencies not loaded.</p>' +
                '</div>'
            );
        }

        var vm = viewModel || {};
        var disciplines = Array.isArray(vm.disciplines) ? vm.disciplines : [];
        var selected = vm.selected || null;
        var filters = vm.filters || { type: 'all', search: '' };

        return (
            '<div class="academy-body academy-discipline-layout">' +
                renderListPanel(disciplines, filters) +
                renderDetailPanel(selected) +
            '</div>'
        );
    }

    // ============================================================
    // LIST PANEL - Left side
    // ============================================================

    function renderListPanel(disciplines, filters) {
        var html = '<div class="academy-discipline-sidebar">';

        html += renderListFilters(filters);
        html += renderListItems(disciplines);

        html += '</div>';
        return html;
    }

    function renderListFilters(filters) {
        var type = filters.type || 'all';
        var search = filters.search || '';

        var html = '<div class="academy-discipline-filters">';

        html += '<input type="text" id="academy-discipline-search" ' +
            'class="academy-discipline-search" ' +
            'placeholder="Search disciplines..." ' +
            'value="' + escapeAttribute(search) + '">';

        html += '<label class="academy-filter-label">Type:</label>';
        html += '<select id="academy-discipline-type-filter" class="academy-discipline-type-filter">';
        html += '<option value="all" ' + (type === 'all' ? 'selected' : '') + '>All</option>';
        html += '<option value="mandatory" ' + (type === 'mandatory' ? 'selected' : '') + '>Mandatory</option>';
        html += '<option value="optional" ' + (type === 'optional' ? 'selected' : '') + '>Optional</option>';
        html += '</select>';

        html += '</div>';
        return html;
    }

    function renderListItems(disciplines) {
        var html = '<div class="academy-discipline-list" id="academy-discipline-list">';

        if (!Array.isArray(disciplines) || disciplines.length === 0) {
            html += '<p class="empty-state small">No disciplines match the current filters.</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d || !d.id) {
                continue;
            }
            html += renderListRow(d);
        }

        html += '</div>';
        return html;
    }

    function renderListRow(d) {
        var badgeClass = getDisciplineTypeBadgeClass(d.type);

        var html = '';
        html += '<div class="academy-discipline-row" ' +
                    'data-discipline-id="' + escapeAttribute(d.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-discipline-row-main">';
        html += '<span class="academy-discipline-name">' + escapeHtml(d.name || 'Unnamed Discipline') + '</span>';
        html += '<span class="' + badgeClass + '">' + escapeHtml(getDisciplineTypeLabel(d.type)) + '</span>';
        html += '</div>';

        var meta = [];
        var range = formatWeekRange(d.startWeek, d.endWeek);
        if (range) {
            meta.push(escapeHtml(range));
        }
        if (isFiniteNumber(d.weeklyHours)) {
            meta.push(escapeHtml(String(d.weeklyHours)) + 'h/wk');
        }

        if (meta.length > 0) {
            html += '<div class="academy-discipline-row-meta">' + meta.join(' &middot; ') + '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL PANEL - Right side
    // ============================================================

    function renderDetailPanel(discipline) {
        var html = '<div class="academy-discipline-detail" id="academy-discipline-detail">';

        if (!discipline || !discipline.id) {
            html += renderEmptyDetailState();
        } else {
            html += renderDetailContent(discipline);
        }

        html += '</div>';
        return html;
    }

    function renderEmptyDetailState() {
        return (
            '<div class="academy-detail-empty">' +
                '<p class="empty-state small">Select a discipline to view its details.</p>' +
            '</div>'
        );
    }

    function renderDetailContent(d) {
        var badgeClass = getDisciplineTypeBadgeClass(d.type);

        var html = '';

        // ---- Header ----
        html += '<div class="academy-discipline-detail-header">';

        html += '<div class="academy-discipline-detail-title-row">';
        html += '<h3 class="academy-discipline-detail-title">' +
                    escapeHtml(d.name || 'Unnamed Discipline') +
                '</h3>';
        html += '<span class="' + badgeClass + '">' +
                    escapeHtml(getDisciplineTypeLabel(d.type)) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-discipline-detail-meta">';

        var range = formatWeekRange(d.startWeek, d.endWeek);
        if (range) {
            html += '<span class="academy-discipline-detail-meta-item">' +
                        '<span class="meta-label">Weeks:</span> ' +
                        escapeHtml(range.replace(/^Weeks /, '')) +
                    '</span>';
        }

        if (isFiniteNumber(d.weeklyHours)) {
            html += '<span class="academy-discipline-detail-meta-item">' +
                        '<span class="meta-label">Weekly Hours:</span> ' +
                        escapeHtml(String(d.weeklyHours)) +
                    '</span>';
        }

        if (isFiniteNumber(d.weight)) {
            html += '<span class="academy-discipline-detail-meta-item">' +
                        '<span class="meta-label">Weight:</span> ' +
                        escapeHtml(String(d.weight)) +
                    '</span>';
        }

        html += '</div>';

        // ---- Actions ----
        html += '<div class="academy-discipline-detail-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="edit-discipline" ' +
                    'data-discipline-id="' + escapeAttribute(d.id) + '">' +
                    'Edit Discipline' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="delete-discipline" ' +
                    'data-discipline-id="' + escapeAttribute(d.id) + '">' +
                    'Delete Discipline' +
                '</button>';
        html += '</div>';

        html += '</div>';

        // ---- Description ----
        if (isNonEmptyString(d.description)) {
            html += '<div class="academy-discipline-detail-section academy-discipline-description">';
            html += '<p>' + escapeHtml(d.description) + '</p>';
            html += '</div>';
        }

        // ---- Instructors ----
        html += renderInstructorsSection(d);

        return html;
    }

    function renderInstructorsSection(d) {
        var html = '';
        html += '<div class="academy-discipline-detail-section academy-discipline-instructors">';

        var count = Array.isArray(d.instructorNames) ? d.instructorNames.length : 0;

        html += '<div class="academy-discipline-detail-section-header">';
        html += '<h4 class="academy-discipline-detail-section-title">Instructors</h4>';
        html += '<span class="academy-discipline-detail-section-count">' + count + '</span>';
        html += '</div>';

        if (count === 0) {
            html += '<p class="empty-state small">No instructors assigned to this discipline.</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-discipline-instructor-list">';
        for (var i = 0; i < d.instructorNames.length; i++) {
            var name = d.instructorNames[i];
            if (!isNonEmptyString(name)) {
                continue;
            }
            var instructorId = Array.isArray(d.instructorIds) && d.instructorIds[i]
                ? d.instructorIds[i]
                : null;

            html += '<div class="academy-discipline-instructor-row"';
            if (instructorId) {
                html += ' data-character-id="' + escapeAttribute(instructorId) + '"';
            }
            html += '>';
            html += '<span class="academy-discipline-instructor-name">' + escapeHtml(name) + '</span>';
            html += '</div>';
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplineView = {
        renderHTML: renderHTML
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyDisciplineView;
        var missing = [];

        var required = ['renderHTML'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyDisciplineView] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();