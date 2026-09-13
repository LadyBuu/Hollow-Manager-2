/**
 * modules/academy/academy-view.js - Academy Unified Shell
 * Top-level renderer for the Academy tab
 *
 * Path: js/modules/academy/academy-view.js
 *
 * This module provides:
 *   - The unified Academy shell (view switcher, class dropdown, week selector)
 *   - The People view: character list + detail panel
 *   - Delegation to AcademyClassDetail and AcademyCharacterDetail for the right panel
 *   - Full event wiring for the People view
 *   - Placeholder views for Weekly Teams / Rankings / Disciplines / Locations
 *
 * IMPORTANT:
 *   - RENDER + WIRE - no mutations, no domain logic
 *   - Reads state from AcademyUI
 *   - Reads projections from AcademyAggregator
 *   - Delegates right-panel rendering to AcademyClassDetail / AcademyCharacterDetail
 *   - Uses container-level event delegation (survives innerHTML replacement)
 *   - Uses DomUtils for escaping
 *
 * VIEWS:
 *   people       - default; class + character browsing (FULLY WIRED)
 *   weeklyTeams  - placeholder (Session E)
 *   rankings     - placeholder (Session E)
 *   disciplines  - placeholder (Session E)
 *   locations    - placeholder (Session E)
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
 *   - window.AcademyClasses (LAZY - only for Add Class)
 *   - window.NotificationSystem (LAZY - only for Add Class errors)
 *   - window.CharacterDetail (LAZY - only for View Full Profile)
 *   - window.AcademyClassDetail (LAZY - optional)
 *   - window.AcademyCharacterDetail (LAZY - optional)
 *
 * USAGE:
 *   // Called by academy/index.js
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
        // Prefer the namespaced export; fall back to the legacy name.
        return window.AcademyClassDetail || window.ClassDetail || null;
    }

    function getCharacterDetailModule() {
        // NOTE: window.CharacterDetail is the modal from
        // modules/characters/character-detail.js. The Academy panel
        // renderer exposes itself as window.AcademyCharacterDetail to
        // avoid the collision. Do NOT fall back to window.CharacterDetail
        // here — that's the modal, not the panel renderer.
        return window.AcademyCharacterDetail || null;
    }

    function notify(message, type) {
        if (window.NotificationSystem && typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type || 'info');
        }
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
     * Called by academy/index.js on mount and refresh.
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

        // Re-bind after every render. innerHTML replacement drops all
        // listeners on child nodes, so re-binding is mandatory.
        bindEvents(container);
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

    function renderTopBar(view) {
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

        html += renderCharacterFilters();

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

        html += '<input type="text" id="academy-people-search" class="academy-people-search" ' +
            'placeholder="Search..." value="' + escapeAttribute(search) + '">';

        html += '<label class="academy-filter-label">Role:</label>';
        html += '<select id="academy-people-role" class="academy-people-role">';
        html += '<option value="all" ' + (role === 'all' ? 'selected' : '') + '>All</option>';
        html += '<option value="trainee" ' + (role === 'trainee' ? 'selected' : '') + '>Trainees</option>';
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

    function renderCharacterListItems(classVM, selectedCharId) {
        var allStudents = classVM.students || [];
        var filters = AcademyUI.getFilter('people') || {};
        var search = (filters.search || '').toLowerCase().trim();
        var roleFilter = filters.role || 'all';
        var statusFilter = filters.status || 'active';

        var filtered = allStudents.filter(function(student) {
            if (search && student.name.toLowerCase().indexOf(search) === -1) {
                return false;
            }

            if (roleFilter !== 'all' && student.role !== roleFilter) {
                return false;
            }

            if (statusFilter !== 'all') {
                var isDeceased = student.deceased === true;
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

        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' + escapeHtml(CharacterQueries.getDisplayName(char)) + '</h3>' +
                '<p class="empty-state small">Character detail view coming soon.</p>' +
            '</div>'
        );
    }

    // ============================================================
    // EVENT WIRING
    // ============================================================
    //
    // Delegation strategy:
    //   - Listeners are attached to the CONTAINER once per container
    //     identity. Since the container itself is the same element
    //     across re-renders (only its innerHTML changes), we use a
    //     marker to avoid stacking listeners on the container.
    //   - Handlers use event.target.closest() to resolve the action
    //     target, so they survive innerHTML replacement.
    //
    // WHY NOT BIND ON EACH CHILD:
    //   - Inner nodes are destroyed on re-render; any per-child
    //     listener would be lost and re-added, causing leaks and
    //     duplicates. Delegation on the stable container avoids this
    //     entirely.

    var _boundContainer = null;

    function bindEvents(container) {
        if (_boundContainer === container) {
            return;
        }

        _boundContainer = container;

        container.addEventListener('click', handleDelegatedClick);
        container.addEventListener('change', handleDelegatedChange);
        container.addEventListener('input', handleDelegatedInput);
        container.addEventListener('keydown', handleDelegatedKeydown);
    }

    function handleDelegatedClick(e) {
        var target = e.target;

        // ---- View nav buttons ----
        var viewBtn = target.closest('.academy-view-btn');
        if (viewBtn) {
            e.preventDefault();
            handleViewSwitch(viewBtn.dataset.view);
            return;
        }

        // ---- Add Class button ----
        if (target.closest('#academy-add-class-btn')) {
            e.preventDefault();
            handleAddClass();
            return;
        }

        // ---- Character row selection ----
        // Matches BOTH the sidebar list rows (.academy-character-row)
        // AND the roster rows on the class detail panel
        // (.academy-student-row). Clicking either selects the character
        // and swaps the right panel to that character's detail.
        var charRow = target.closest('.academy-character-row, .academy-student-row');
        if (charRow) {
            e.preventDefault();
            handleCharacterSelect(charRow.dataset.characterId);
            return;
        }

        // ---- Character detail actions ----
        var actionEl = target.closest('[data-action]');
        if (actionEl) {
            var action = actionEl.dataset.action;
            var charId = actionEl.dataset.characterId;

            if (action === 'view-full-character' && charId) {
                e.preventDefault();
                handleViewFullCharacter(charId);
                return;
            }

            if (action === 'edit-character' && charId) {
                e.preventDefault();
                handleEditCharacter(charId);
                return;
            }

            // Class-detail panel actions. These are placeholders for
            // now — the class panel is a summary view; the actual CRUD
            // lives in the Class tab of Session E.
            if (actionEl.dataset.classId) {
                e.preventDefault();
                handleClassAction(action, actionEl.dataset.classId);
                return;
            }

            return;
        }
    }

    function handleDelegatedChange(e) {
        var target = e.target;

        if (target.id === 'academy-class-select') {
            handleClassSelect(target.value);
            return;
        }

        if (target.id === 'academy-week-input') {
            handleWeekChange(target.value);
            return;
        }

        if (target.id === 'academy-people-role') {
            AcademyUI.setFilter('people', 'role', target.value);
            refreshView();
            return;
        }

        if (target.id === 'academy-people-status') {
            AcademyUI.setFilter('people', 'status', target.value);
            refreshView();
            return;
        }
    }

    function handleDelegatedInput(e) {
        var target = e.target;

        if (target.id === 'academy-people-search') {
            debounceSearch(target.value);
            return;
        }
    }

    function handleDelegatedKeydown(e) {
        var target = e.target;

        if (target.id === 'academy-week-input' && e.key === 'Enter') {
            e.preventDefault();
            handleWeekChange(target.value);
            return;
        }
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleViewSwitch(viewId) {
        if (!viewId) {
            return;
        }
        if (AcademyUI.setSelectedView(viewId)) {
            refreshView();
        }
    }

    function handleClassSelect(classId) {
        if (!classId) {
            // Empty selection means "clear class". AcademyUI handles
            // clearing the character selection too.
            AcademyUI.selectClass(null);
            refreshView();
            return;
        }
        AcademyUI.selectClass(classId);
        refreshView();
    }

    function handleCharacterSelect(charId) {
        if (!charId) {
            return;
        }
        // Toggle-off behavior: clicking the already-selected row
        // deselects it.
        var current = AcademyUI.getSelectedCharacterId();
        if (current && String(current) === String(charId)) {
            AcademyUI.selectCharacter(null);
        } else {
            AcademyUI.selectCharacter(charId);
        }
        refreshView();
    }

    function handleWeekChange(value) {
        var week = parseInt(value, 10);
        var minWeek = getMinWeek();
        var maxWeek = getMaxWeek();
        if (isNaN(week) || week < minWeek || week > maxWeek) {
            // Snap the input back to the persisted value on invalid input.
            var input = document.getElementById('academy-week-input');
            if (input) {
                input.value = String(AcademyUI.getDisplayWeek());
            }
            return;
        }
        AcademyUI.setDisplayWeek(week);
        refreshView();
    }

    function handleViewFullCharacter(charId) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return;
        }
        if (window.CharacterDetail && typeof window.CharacterDetail.open === 'function') {
            window.CharacterDetail.open(charId);
        } else {
            notify('Character detail view not available.', 'error');
        }
    }

    function handleEditCharacter(charId) {
        // character-events.js listens for this exact event on document.
        // Dispatching it drives the full edit flow (set current edit ID,
        // render form, refresh UI, scroll into view, close mobile list).
        try {
            var event = new CustomEvent('characterEdit', {
                detail: { characterId: charId },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (err) {
            console.warn('[AcademyView] Failed to dispatch characterEdit:', err);
        }
    }

    function handleClassAction(action, classId) {
        // Class-detail panel actions. No-ops for now — the class-detail
        // panel currently renders as a summary. Full CRUD wiring happens
        // in Session E when the class management UI is ported.
        switch (action) {
            case 'add-character':
                break;
            case 'edit-class':
                break;
            case 'delete-class':
                break;
            default:
                break;
        }
    }

    function handleAddClass() {
        if (!window.AcademyClasses || typeof window.AcademyClasses.create !== 'function') {
            notify('Class module not available.', 'error');
            return;
        }

        var name = window.prompt('Class name:');
        if (name === null) {
            return;
        }
        name = name.trim();
        if (!name) {
            return;
        }

        window.AcademyClasses.create(name).then(function(result) {
            if (result && result.success) {
                // AcademyClasses.create resolves with { data: { class, classId } }.
                var newClassId = result.data && result.data.classId
                    ? result.data.classId
                    : null;
                if (newClassId) {
                    AcademyUI.selectClass(newClassId);
                }
                refreshView();
            }
            // On failure, MutationPipeline has already notified.
        }).catch(function(err) {
            console.warn('[AcademyView] Failed to create class:', err);
            notify('Failed to create class.', 'error');
        });
    }

    // ============================================================
    // SEARCH DEBOUNCE
    // ============================================================

    var _searchTimer = null;

    function debounceSearch(value) {
        if (_searchTimer) {
            clearTimeout(_searchTimer);
        }
        _searchTimer = setTimeout(function() {
            _searchTimer = null;
            AcademyUI.setFilter('people', 'search', value);
            refreshView();
        }, 150);
    }

    // ============================================================
    // REFRESH
    // ============================================================

    function refreshView() {
        var container = document.getElementById('tab-academy');
        if (!container) {
            return;
        }
        render(container);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyView = {
        render: render,
        refreshView: refreshView,
        VIEWS: VIEWS
    };

})();