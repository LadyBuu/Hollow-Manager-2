/**
 * modules/academy/academy-view.js - Academy Unified Shell
 * Top-level renderer for the Academy tab
 * 
 * Path: js/modules/academy/academy-view.js
 * 
 * This module provides:
 *   - The unified Academy shell (view switcher, class dropdown, week selector)
 *   - The People view: character list + detail panel
 *   - Delegation to ClassDetail and CharacterDetail for the right panel
 *   - Placeholder views for Weekly Teams / Rankings / Disciplines / Locations
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Reads state from AcademyUI
 *   - Reads projections from AcademyAggregator
 *   - Delegates right-panel rendering to ClassDetail / CharacterDetail
 *   - Delegates event handling to AcademyEvents
 *   - Uses DomUtils for escaping
 * 
 * VIEWS:
 *   people       - default; class + character browsing
 *   weeklyTeams  - placeholder for now
 *   rankings     - placeholder for now
 *   disciplines  - placeholder for now
 *   locations    - placeholder for now
 * 
 * LAYOUT (people view):
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ [People] [Weekly Teams] [Rankings] [Disciplines] [...] │
 *   │ Class: [Class of 2020 ▼]  [+ Add Class]  Week: [5 ▼]   │
 *   ├──────────────────────┬──────────────────────────────────┤
 *   │ CHARACTERS           │ Detail                           │
 *   │ Search...            │                                  │
 *   │ Role: [All ▼]        │ (ClassDetail or CharacterDetail) │
 *   │ Status: [Active ▼]   │                                  │
 *   │                      │                                  │
 *   │ Alice Smith          │                                  │
 *   │ Bob Jones            │                                  │
 *   │ Jane Smith (Inst.)   │                                  │
 *   └──────────────────────┴──────────────────────────────────┘
 * 
 * DEPENDENCIES:
 *   - window.AcademyUI (MANDATORY)
 *   - window.AcademyAggregator (MANDATORY)
 *   - window.AcademyQueries (MANDATORY)
 *   - window.CharacterQueries (MANDATORY)
 *   - window.DomUtils (MANDATORY)
 *   - window.CalendarConstants (MANDATORY)
 *   - window.ClassDetail (LAZY - optional)
 *   - window.CharacterDetail (LAZY - optional)
 * 
 * USAGE:
 *   // Called by academy-events.js
 *   AcademyView.render(container);
 */

(function() {
    'use strict';

    if (window.__academyViewLoaded) {
        return;
    }
    window.__academyViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyUI || typeof AcademyUI.getSelectedView !== 'function') {
            missing.push('AcademyUI.getSelectedView');
        }
        if (!AcademyUI || typeof AcademyUI.getSelectedClassId !== 'function') {
            missing.push('AcademyUI.getSelectedClassId');
        }
        if (!AcademyUI || typeof AcademyUI.getSelectedCharacterId !== 'function') {
            missing.push('AcademyUI.getSelectedCharacterId');
        }
        if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
            missing.push('AcademyUI.getDisplayWeek');
        }
        if (!AcademyUI || typeof AcademyUI.getRoleFor !== 'function') {
            missing.push('AcademyUI.getRoleFor');
        }

        if (!AcademyAggregator || typeof AcademyAggregator.getClassViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassViewModel');
        }
        if (!AcademyAggregator || typeof AcademyAggregator.getClassListViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassListViewModel');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('[AcademyView] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getMinWeek() {
        return (CalendarConstants && CalendarConstants.MIN_WEEK) || 1;
    }

    function getMaxWeek() {
        return (CalendarConstants && CalendarConstants.MAX_WEEK) || 52;
    }

    function getClassDetailModule() {
        return window.ClassDetail || null;
    }

    function getCharacterDetailModule() {
        return window.CharacterDetail || null;
    }

    // ============================================================
    // VIEW DEFINITIONS
    // ============================================================

    var VIEWS = [
        { id: 'people',       label: 'People' },
        { id: 'weeklyTeams',  label: 'Weekly Teams' },
        { id: 'rankings',     label: 'Rankings' },
        { id: 'disciplines',  label: 'Disciplines' },
        { id: 'locations',    label: 'Locations' }
    ];

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    /**
     * Render the entire Academy tab into a container.
     * Called by academy-events.js on every refresh.
     * 
     * @param {HTMLElement} container - The #tab-academy container
     */
    function render(container) {
        if (!container) {
            container = document.getElementById('tab-academy');
        }
        if (!container) {
            console.warn('[AcademyView] Container not found');
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Academy view dependencies not loaded.</p>';
            return;
        }

        var view = AcademyUI.getSelectedView();

        container.innerHTML =
            renderViewNav(view) +
            renderTopBar(view) +
            renderBody(view);
    }

    // ============================================================
    // VIEW NAV
    // ============================================================

    function renderViewNav(activeView) {
        var html = '<div class="academy-view-nav">';

        for (var i = 0; i < VIEWS.length; i++) {
            var v = VIEWS[i];
            var isActive = v.id === activeView;
            html += '<button class="academy-view-btn' + (isActive ? ' active' : '') + '" ' +
                'data-view="' + escapeAttribute(v.id) + '" ' +
                'type="button">' +
                escapeHtml(v.label) +
                '</button>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // TOP BAR - Class selector + Add Class + Week selector
    // ============================================================
    // 
    // The top bar has three sections:
    //   1. Class dropdown + Add Class button (left)
    //   2. Week selector (right)
    // 
    // The class dropdown is populated from AcademyQueries.getClasses().
    // The current selection comes from AcademyUI.getSelectedClassId().

    function renderTopBar(view) {
        // The week selector is only meaningful for views that care about
        // weeks. For now, always show it; individual views decide what to
        // do with it. Views that don't use it can ignore the value.

        var classId = AcademyUI.getSelectedClassId();
        var week = AcademyUI.getDisplayWeek();

        var html = '<div class="academy-top-bar">';

        // ---- Left: class selector + add class ----
        html += '<div class="academy-top-left">';

        html += '<label class="academy-top-label">Class:</label>';
        html += '<select id="academy-class-select" class="academy-class-select">';
        html += '<option value="">Select a class...</option>';

        var classes = AcademyQueries.getClasses() || [];
        classes.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) {
                continue;
            }
            var isSelected = classId && String(classId) === String(cls.id);
            html += '<option value="' + escapeAttribute(cls.id) + '" ' +
                (isSelected ? 'selected' : '') + '>' +
                escapeHtml(cls.name || 'Unnamed Class') +
                '</option>';
        }

        html += '</select>';

        html += '<button id="academy-add-class-btn" class="primary small" type="button">+ Add Class</button>';

        html += '</div>';

        // ---- Right: week selector ----
        html += '<div class="academy-top-right">';
        html += '<label class="academy-top-label">Week:</label>';
        html += '<input type="number" id="academy-week-input" class="academy-week-input" ' +
            'value="' + escapeAttribute(String(week)) + '" ' +
            'min="' + getMinWeek() + '" max="' + getMaxWeek() + '">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // BODY - Dispatches by view
    // ============================================================

    function renderBody(view) {
        switch (view) {
            case 'people':
                return renderPeopleView();
            case 'weeklyTeams':
                return renderPlaceholder('Weekly Teams');
            case 'rankings':
                return renderPlaceholder('Rankings');
            case 'disciplines':
                return renderPlaceholder('Disciplines');
            case 'locations':
                return renderPlaceholder('Locations');
            default:
                return renderPlaceholder('Unknown view: ' + view);
        }
    }

    function renderPlaceholder(label) {
        return (
            '<div class="academy-body academy-body-placeholder">' +
                '<p class="empty-state">' + escapeHtml(label) + ' view coming soon.</p>' +
            '</div>'
        );
    }

    // ============================================================
    // PEOPLE VIEW
    // ============================================================

    function renderPeopleView() {
        var classId = AcademyUI.getSelectedClassId();
        var charId = AcademyUI.getSelectedCharacterId();

        if (!classId) {
            return (
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">Select a class to view its members.</p>' +
                '</div>'
            );
        }

        var classVM = AcademyAggregator.getClassViewModel(classId, {
            includeStudents: true,
            includeTeams: false,
            includeRankings: false,
            includeGrades: false
        });

        if (!classVM) {
            return (
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">Class not found.</p>' +
                '</div>'
            );
        }

        return (
            '<div class="academy-body academy-people-layout">' +
                renderCharacterPanel(classVM, charId) +
                renderDetailPanel(classVM, charId) +
            '</div>'
        );
    }

    // ============================================================
    // CHARACTER PANEL - Left side
    // ============================================================

    function renderCharacterPanel(classVM, selectedCharId) {
        var html = '<div class="academy-people-sidebar">';

        // Filter row
        html += renderCharacterFilters();

        // Character list
        html += '<div class="academy-character-list" id="academy-character-list">';
        html += renderCharacterListItems(classVM, selectedCharId);
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderCharacterFilters() {
        var filters = AcademyUI.getFilter('people') || {};

        var search = filters.search || '';
        var role = filters.role || 'all';
        var status = filters.status || 'active';

        var html = '<div class="academy-character-filters">';

        // Search
        html += '<input type="text" id="academy-people-search" class="academy-people-search" ' +
            'placeholder="Search..." value="' + escapeAttribute(search) + '">';

        // Role filter
        html += '<label class="academy-filter-label">Role:</label>';
        html += '<select id="academy-people-role" class="academy-people-role">';
        html += '<option value="all" ' + (role === 'all' ? 'selected' : '') + '>All</option>';
        html += '<option value="trainee" ' + (role === 'trainee' ? 'selected' : '') + '>Trainees</option>';
        html += '<option value="instructor" ' + (role === 'instructor' ? 'selected' : '') + '>Instructors</option>';
        html += '</select>';

        // Status filter
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

    function renderCharacterListItems(classVM, selectedCharId) {
        var allStudents = classVM.students || [];
        var filters = AcademyUI.getFilter('people') || {};
        var search = (filters.search || '').toLowerCase().trim();
        var roleFilter = filters.role || 'all';
        var statusFilter = filters.status || 'active';

        // Apply filters
        var filtered = allStudents.filter(function(student) {
            // Search
            if (search && student.name.toLowerCase().indexOf(search) === -1) {
                return false;
            }

            // Role
            if (roleFilter !== 'all' && student.role !== roleFilter) {
                return false;
            }

            // Status
            if (statusFilter !== 'all') {
                var isDeceased = student.deceased === true;
                // We don't currently have elimination status on the
                // class roster. Treat 'eliminated' as a no-op filter
                // for now; it's on the deferred list.
                if (statusFilter === 'deceased' && !isDeceased) {
                    return false;
                }
                if (statusFilter === 'active' && isDeceased) {
                    return false;
                }
            }

            return true;
        });

        if (filtered.length === 0) {
            return '<p class="empty-state small">No characters match the current filters.</p>';
        }

        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var s = filtered[i];
            var isSelected = selectedCharId && String(selectedCharId) === String(s.id);

            var classes = 'academy-character-row';
            if (isSelected) {
                classes += ' selected';
            }
            if (s.deceased) {
                classes += ' deceased';
            }

            html += '<div class="' + classes + '" data-character-id="' + escapeAttribute(s.id) + '">';

            html += '<div class="academy-character-row-main">';
            html += '<span class="academy-character-name">' + escapeHtml(s.name) + '</span>';

            if (s.role === 'instructor') {
                html += '<span class="academy-character-role-badge">Instructor</span>';
            }

            html += '</div>';

            // Status line: current career status
            if (s.status) {
                html += '<div class="academy-character-row-status">' + escapeHtml(s.status) + '</div>';
            }

            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // DETAIL PANEL - Right side
    // ============================================================
    // 
    // If a character is selected, delegate to CharacterDetail.
    // Otherwise, delegate to ClassDetail.
    // 
    // If the relevant module isn't loaded, show a placeholder.

    function renderDetailPanel(classVM, charId) {
        var html = '<div class="academy-people-detail" id="academy-people-detail">';

        if (charId) {
            html += renderCharacterDetailContent(classVM, charId);
        } else {
            html += renderClassDetailContent(classVM);
        }

        html += '</div>';
        return html;
    }

    function renderClassDetailContent(classVM) {
        var ClassDetail = getClassDetailModule();
        if (ClassDetail && typeof ClassDetail.renderHTML === 'function') {
            try {
                return ClassDetail.renderHTML(classVM);
            } catch (e) {
                console.warn('[AcademyView] ClassDetail.renderHTML failed:', e);
            }
        }

        // Fallback placeholder
        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' + escapeHtml(classVM.name || 'Class') + '</h3>' +
                '<p class="empty-state small">Class detail view coming soon.</p>' +
            '</div>'
        );
    }

    function renderCharacterDetailContent(classVM, charId) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return '<p class="empty-state">Character not found.</p>';
        }

        var CharacterDetail = getCharacterDetailModule();
        if (CharacterDetail && typeof CharacterDetail.renderHTML === 'function') {
            try {
                return CharacterDetail.renderHTML(char, classVM, {
                    week: AcademyUI.getDisplayWeek()
                });
            } catch (e) {
                console.warn('[AcademyView] CharacterDetail.renderHTML failed:', e);
            }
        }

        // Fallback placeholder
        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' + escapeHtml(CharacterQueries.getDisplayName(char)) + '</h3>' +
                '<p class="empty-state small">Character detail view coming soon.</p>' +
            '</div>'
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyView = {
        render: render,
        VIEWS: VIEWS
    };

})();