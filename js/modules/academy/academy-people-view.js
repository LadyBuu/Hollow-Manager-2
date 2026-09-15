/**
 * modules/academy/academy-people-view.js - Academy People View
 * Pure renderer for the People layout.
 *
 * Path: js/modules/academy/academy-people-view.js
 *
 * This module renders:
 *   - The left sidebar: filters + character list
 *   - The right panel placeholder (the actual class/character detail
 *     panel is rendered by AcademyClassDetail / AcademyCharacterDetail,
 *     orchestrated by AcademyView)
 *
 * IMPORTANT:
 *   - RENDER ONLY. No domain reads, no filtering, no aggregation.
 *   - Receives a VM from AcademyAggregator.getPeopleViewModel.
 *   - Emits data-* attributes for AcademyView's delegated handlers.
 *   - Returns an HTML string.
 *
 * VM SHAPE (from AcademyAggregator.getPeopleViewModel):
 *   {
 *     classList:       [{ id, name }],
 *     classId:         string|null,
 *     className:      string|null,
 *     filters:         { search, role, status },
 *     people:          [{
 *       id, name, status, role, deceased, isSelected
 *     }],
 *     totalCount:      number,
 *     filteredCount:   number
 *   }
 *
 * EVENTS EMITTED:
 *   - .academy-character-row [data-character-id]
 *   - #academy-people-search (input)
 *   - #academy-people-role (change)
 *   - #academy-people-status (change)
 *
 * DEPENDENCIES:
 *   - window.DomUtils (mandatory)
 */

(function() {
    'use strict';

    if (window.__academyPeopleViewLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyPeopleView] Missing mandatory dependency: DomUtils'
        );
    }

    window.__academyPeopleViewLoaded = true;

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderHTML(vm) {
        if (!vm || typeof vm !== 'object') {
            throw new Error('[AcademyPeopleView] View model is required.');
        }

        var html = '';
        html += '<div class="academy-body academy-people-layout">';
        html += renderSidebar(vm);
        html += '<div class="academy-people-detail" id="academy-people-detail"></div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // SIDEBAR
    // ============================================================

    function renderSidebar(vm) {
        var html = '';
        html += '<div class="academy-people-sidebar">';
        html += renderFilters(vm.filters);
        html += renderCharacterList(vm);
        html += '</div>';
        return html;
    }

    function renderFilters(filters) {
        filters = filters || {};
        var search = typeof filters.search === 'string' ? filters.search : '';
        var role = filters.role || 'all';
        var status = filters.status || 'active';

        var html = '';
        html += '<div class="academy-character-filters">';

        html += '<input type="text" id="academy-people-search" ' +
                    'class="academy-people-search" ' +
                    'placeholder="Search..." ' +
                    'value="' + escapeAttribute(search) + '">';

        html += '<label class="academy-filter-label">Role:</label>';
        html += '<select id="academy-people-role" class="academy-people-role">';
        html += '<option value="all" ' + (role === 'all' ? 'selected' : '') + '>All</option>';
        html += '<option value="student" ' + (role === 'student' ? 'selected' : '') + '>Students</option>';
        html += '<option value="instructor" ' + (role === 'instructor' ? 'selected' : '') + '>Instructors</option>';
        html += '</select>';

        html += '<label class="academy-filter-label">Status:</label>';
        html += '<select id="academy-people-status" class="academy-people-status">';
        html += '<option value="active" ' + (status === 'active' ? 'selected' : '') + '>Active</option>';
        html += '<option value="eliminated" ' + (status === 'eliminated' ? 'selected' : '') + '>Eliminated</option>';
        html += '<option value="deceased" ' + (status === 'deceased' ? 'selected' : '') + '>Deceased</option>';
        html += '<option value="all" ' + (status === 'all' ? 'selected' : '') + '>All</option>';
        html += '</select>';

        html += '</div>';
        return html;
    }

    function renderCharacterList(vm) {
        var people = Array.isArray(vm.people) ? vm.people : [];

        var html = '';
        html += '<div class="academy-character-list" id="academy-character-list">';

        if (people.length === 0) {
            html += '<p class="empty-state small">' +
                        'No characters match the current filters.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < people.length; i++) {
            html += renderCharacterRow(people[i]);
        }

        html += '</div>';
        return html;
    }

    function renderCharacterRow(person) {
        if (!person || !person.id) {
            return '';
        }

        var classes = 'academy-character-row';
        if (person.isSelected) { classes += ' selected'; }
        if (person.deceased) { classes += ' deceased'; }

        var html = '';
        html += '<div class="' + classes + '" ' +
                    'data-character-id="' + escapeAttribute(person.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-character-row-main">';
        html += '<span class="academy-character-name">' +
                    escapeHtml(person.name) +
                '</span>';
        if (person.role === 'instructor') {
            html += '<span class="academy-character-role-badge">Instructor</span>';
        }
        html += '</div>';

        if (person.status) {
            html += '<div class="academy-character-row-status">' +
                        escapeHtml(person.status) +
                    '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyPeopleView = {
        renderHTML: renderHTML
    };

})();
