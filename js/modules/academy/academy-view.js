/**
 * modules/academy/academy-view.js - Academy Unified Shell
 * Top-level renderer for the Academy tab
 *
 * Path: js/modules/academy/academy-view.js
 *
 * This module provides:
 *   - The unified Academy shell (view switcher, class dropdown, week selector)
 *   - Five views: People, Weekly Teams, Rankings, Disciplines, Locations
 *   - Delegation to AcademyClassDetail / AcademyCharacterDetail for the
 *     People view's right panel
 *   - Delegation to AcademyDisciplineView / AcademyLocationView /
 *     AcademyRankingView / AcademyWeeklyTeamsView for the other views
 *   - Container-level event delegation for all views
 *
 * IMPORTANT:
 *   - RENDER + WIRE - no mutations, no domain logic
 *   - Reads state from AcademyUI
 *   - Reads projections from AcademyAggregator / AcademyQueries
 *   - Delegates rendering to per-view renderers where they exist
 *   - Uses container-level event delegation (survives innerHTML replacement)
 *   - Uses DomUtils for escaping
 *
 * VIEWS:
 *   people       - class + character browsing
 *   weeklyTeams  - academic teams per class and week
 *   rankings     - class rankings for a week
 *   disciplines  - discipline (curriculum) browser
 *   locations    - location browser with schedules
 *
 * LAYOUT:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ [People] [Weekly Teams] [Rankings] [Disciplines] [...] │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ View-specific body                                       │
 *   └─────────────────────────────────────────────────────────┘
 *
 *   The People view has its own class + week bar.
 *   Weekly Teams and Rankings have their own class + week bars.
 *   Disciplines and Locations are class-independent.
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
 *   - window.AcademyClassDetail (LAZY)
 *   - window.AcademyCharacterDetail (LAZY)
 *   - window.AcademyDisciplineView (LAZY)
 *   - window.AcademyLocationView (LAZY)
 *   - window.AcademyRankingView (LAZY)
 *   - window.AcademyWeeklyTeamsView (LAZY)
 *   - window.CalendarQueries (LAZY - for location schedules)
 *   - window.TeamQueries (LAZY - for weekly teams)
 *   - window.TeamConstants (LAZY - for team labels)
 *   - window.DisciplineQueries (LAZY - for discipline names)
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
        return window.AcademyClassDetail || window.ClassDetail || null;
    }

    function getCharacterDetailModule() {
        // NOTE: window.CharacterDetail is the modal from
        // modules/characters/character-detail.js. The Academy panel
        // renderer exposes itself as window.AcademyCharacterDetail.
        return window.AcademyCharacterDetail || null;
    }

    function getDisciplineViewModule() {
        return window.AcademyDisciplineView || null;
    }

    function getLocationViewModule() {
        return window.AcademyLocationView || null;
    }

    function getRankingViewModule() {
        return window.AcademyRankingView || null;
    }

    function getWeeklyTeamsViewModule() {
        return window.AcademyWeeklyTeamsView || null;
    }

    function getCharacterDisplayName(charId) {
        if (!charId) {
            return 'Unknown';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return 'Unknown';
        }
        return CharacterQueries.getDisplayName(char);
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
            renderBody(view);

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
    // BODY - Dispatches by view
    // ============================================================

    function renderBody(view) {
        switch (view) {
            case 'people':
                return renderPeopleView();
            case 'weeklyTeams':
                return renderWeeklyTeamsView();
            case 'rankings':
                return renderRankingView();
            case 'disciplines':
                return renderDisciplineView();
            case 'locations':
                return renderLocationView();
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
        var html = '';

        html += renderPeopleTopBar();

        var classId = AcademyUI.getSelectedClassId();
        var charId = AcademyUI.getSelectedCharacterId();

        if (!classId) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">Select a class to view its members.</p>' +
                    '</div>';
            return html;
        }

        var classVM = AcademyAggregator.getClassViewModel(classId, {
            includeStudents: true,
            includeTeams: false,
            includeRankings: false,
            includeGrades: false
        });

        if (!classVM) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">Class not found.</p>' +
                    '</div>';
            return html;
        }

        html += '<div class="academy-body academy-people-layout">' +
                    renderCharacterPanel(classVM, charId) +
                    renderDetailPanel(classVM, charId) +
                '</div>';

        return html;
    }

    function renderPeopleTopBar() {
        var classId = AcademyUI.getSelectedClassId();
        var week = AcademyUI.getDisplayWeek();

        var html = '<div class="academy-top-bar">';

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
            if (!cls || !cls.id) { continue; }
            var isSelected = classId && String(classId) === String(cls.id);
            html += '<option value="' + escapeAttribute(cls.id) + '" ' +
                (isSelected ? 'selected' : '') + '>' +
                escapeHtml(cls.name || 'Unnamed Class') +
                '</option>';
        }

        html += '</select>';
        html += '<button id="academy-add-class-btn" class="primary small" type="button">+ Add Class</button>';
        html += '</div>';

        html += '<div class="academy-top-right">';
        html += '<label class="academy-top-label">Week:</label>';
        html += '<input type="number" id="academy-week-input" class="academy-week-input" ' +
            'value="' + escapeAttribute(String(week)) + '" ' +
            'min="' + getMinWeek() + '" max="' + getMaxWeek() + '">';
        html += '</div>';

        html += '</div>';
        return html;
    }

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
            if (isSelected) { classes += ' selected'; }
            if (s.deceased) { classes += ' deceased'; }

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
    // DISCIPLINE VIEW
    // ============================================================

    var _selectedDisciplineId = null;

    function renderDisciplineView() {
        var Renderer = getDisciplineViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Disciplines');
        }

        var filters = AcademyUI.getFilter('disciplines') || {};

        var disciplines = AcademyQueries.getDisciplines
            ? AcademyQueries.getDisciplines()
            : [];

        disciplines = applyDisciplineFilters(disciplines, filters);

        var selected = null;
        if (_selectedDisciplineId) {
            for (var i = 0; i < disciplines.length; i++) {
                if (String(disciplines[i].id) === String(_selectedDisciplineId)) {
                    selected = buildDisciplineDetailVM(disciplines[i]);
                    break;
                }
            }
            if (!selected) {
                _selectedDisciplineId = null;
            }
        }

        var listVM = disciplines.map(buildDisciplineListRowVM);

        return Renderer.renderHTML({
            disciplines: listVM,
            selected: selected,
            filters: filters,
            total: listVM.length
        });
    }

    function applyDisciplineFilters(disciplines, filters) {
        var type = filters.type || 'all';
        var search = (filters.search || '').toLowerCase().trim();

        return disciplines.filter(function(d) {
            if (!d || !d.id) { return false; }
            if (type !== 'all' && d.type !== type) { return false; }
            if (search && (d.name || '').toLowerCase().indexOf(search) === -1) { return false; }
            return true;
        });
    }

    function buildDisciplineListRowVM(d) {
        return {
            id: d.id,
            name: d.name,
            type: d.type,
            startWeek: d.startWeek,
            endWeek: d.endWeek,
            weeklyHours: d.weeklyHours,
            weight: d.weight,
            instructorIds: d.instructorIds || [],
            instructorNames: (d.instructorIds || []).map(function(id) {
                return getCharacterDisplayName(id);
            })
        };
    }

    function buildDisciplineDetailVM(d) {
        var vm = buildDisciplineListRowVM(d);
        vm.description = d.description || '';
        return vm;
    }

    // ============================================================
    // LOCATION VIEW
    // ============================================================

    var _selectedLocationId = null;

    function renderLocationView() {
        var Renderer = getLocationViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Locations');
        }

        var filters = AcademyUI.getFilter('locations') || {};
        var week = AcademyUI.getDisplayWeek();

        var locations = AcademyQueries.getLocations
            ? AcademyQueries.getLocations()
            : [];

        locations = applyLocationFilters(locations, filters);

        var selected = null;
        if (_selectedLocationId) {
            for (var i = 0; i < locations.length; i++) {
                if (String(locations[i].id) === String(_selectedLocationId)) {
                    selected = buildLocationDetailVM(locations[i], week);
                    break;
                }
            }
            if (!selected) {
                _selectedLocationId = null;
            }
        }

        var listVM = locations.map(buildLocationListRowVM);

        return Renderer.renderHTML({
            locations: listVM,
            selected: selected,
            filters: filters,
            week: week,
            scheduleWeek: week,
            total: listVM.length
        });
    }

    function applyLocationFilters(locations, filters) {
        var type = filters.type || 'all';
        var search = (filters.search || '').toLowerCase().trim();

        return locations.filter(function(l) {
            if (!l || !l.id) { return false; }
            if (type !== 'all' && l.type !== type) { return false; }
            if (search && (l.name || '').toLowerCase().indexOf(search) === -1) { return false; }
            return true;
        });
    }

    function buildLocationListRowVM(l) {
        var schedule = getLocationScheduleForWeek(l.id, AcademyUI.getDisplayWeek());
        return {
            id: l.id,
            name: l.name,
            type: l.type,
            capacity: l.capacity,
            scheduleCount: schedule.length
        };
    }

    function buildLocationDetailVM(l, week) {
        var schedule = getLocationScheduleForWeek(l.id, week);
        return {
            id: l.id,
            name: l.name,
            type: l.type,
            capacity: l.capacity,
            schedule: schedule
        };
    }

    function getLocationScheduleForWeek(locationId, week) {
        if (!locationId || !week) { return []; }

        var CQ = window.CalendarQueries;
        if (!CQ || typeof CQ.getLocationSchedule !== 'function') {
            return [];
        }

        var raw = CQ.getLocationSchedule(locationId, week);
        if (!raw || typeof raw !== 'object') {
            return [];
        }

        var entries = [];
        var disciplineCache = {};

        for (var dayKey in raw) {
            if (!Object.prototype.hasOwnProperty.call(raw, dayKey)) { continue; }
            var dayNum = parseInt(dayKey, 10);
            if (isNaN(dayNum)) { continue; }
            var daySchedule = raw[dayKey];
            if (!daySchedule || typeof daySchedule !== 'object') { continue; }

            for (var hourKey in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hourKey)) { continue; }
                var hourNum = parseInt(hourKey, 10);
                if (isNaN(hourNum)) { continue; }
                var disciplineId = daySchedule[hourKey];
                if (!disciplineId) { continue; }

                var metadata = null;
                if (typeof CQ.getSlotMetadata === 'function') {
                    metadata = CQ.getSlotMetadata(locationId, week, dayNum, hourNum);
                }

                var disciplineName = disciplineCache[disciplineId];
                if (disciplineName === undefined) {
                    disciplineName = resolveDisciplineName(disciplineId);
                    disciplineCache[disciplineId] = disciplineName;
                }

                entries.push({
                    day: dayNum,
                    hour: hourNum,
                    disciplineId: disciplineId,
                    disciplineName: disciplineName,
                    duration: metadata && metadata.duration ? metadata.duration : 1,
                    label: metadata && metadata.label ? metadata.label : ''
                });
            }
        }

        entries.sort(function(a, b) {
            if (a.day !== b.day) { return a.day - b.day; }
            return a.hour - b.hour;
        });

        return entries;
    }

    function resolveDisciplineName(disciplineId) {
        var DiscQ = window.DisciplineQueries;
        if (DiscQ && typeof DiscQ.getDiscipline === 'function') {
            var d = DiscQ.getDiscipline(disciplineId);
            if (d && d.name) { return d.name; }
        }
        return 'Unknown';
    }

    // ============================================================
    // RANKING VIEW
    // ============================================================

    var _selectedRankingClassId = null;

    function renderRankingView() {
        var Renderer = getRankingViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Rankings');
        }

        var week = AcademyUI.getDisplayWeek();

        var classes = AcademyQueries.getClasses() || [];
        classes = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var classListVM = classes.map(function(c) {
            return { id: c.id, name: c.name };
        });

        // Default to People's selected class on first entry.
        if (!_selectedRankingClassId) {
            var peopleClassId = AcademyUI.getSelectedClassId();
            if (peopleClassId) {
                _selectedRankingClassId = peopleClassId;
            }
        }

        var selectedClass = null;
        if (_selectedRankingClassId) {
            for (var i = 0; i < classes.length; i++) {
                if (String(classes[i].id) === String(_selectedRankingClassId)) {
                    selectedClass = classes[i];
                    break;
                }
            }
            if (!selectedClass) {
                _selectedRankingClassId = null;
            }
        }

        var entries = [];
        if (selectedClass) {
            entries = buildRankingEntries(selectedClass, week);
        }

        return Renderer.renderHTML({
            classes: classListVM,
            classId: _selectedRankingClassId,
            className: selectedClass ? selectedClass.name : null,
            week: week,
            entries: entries,
            total: entries.length
        });
    }

    function buildRankingEntries(classRecord, week) {
        if (!AcademyQueries || typeof AcademyQueries.calculateClassRanking !== 'function') {
            return [];
        }

        var raw = AcademyQueries.calculateClassRanking(classRecord.id, week) || [];
        if (!Array.isArray(raw)) {
            return [];
        }

        var instructorId = classRecord.instructorId
            ? String(classRecord.instructorId)
            : null;

        var entries = raw.map(function(e) {
            if (!e) { return null; }
            var studentId = e.studentId ? String(e.studentId) : '';
            return {
                studentId: studentId,
                studentName: e.name || e.studentName || getCharacterDisplayName(studentId),
                rank: e.rank,
                average: e.average,
                gradeCount: e.gradeCount || 0,
                isInstructor: instructorId !== null && studentId === instructorId
            };
        }).filter(function(e) { return e !== null; });

        entries.sort(function(a, b) {
            var ra = typeof a.rank === 'number' ? a.rank : 999;
            var rb = typeof b.rank === 'number' ? b.rank : 999;
            return ra - rb;
        });

        return entries;
    }

    // ============================================================
    // WEEKLY TEAMS VIEW
    // ============================================================

    var _selectedWeeklyTeamsClassId = null;
    var _selectedWeeklyTeamId = null;

    function renderWeeklyTeamsView() {
        var Renderer = getWeeklyTeamsViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Weekly Teams');
        }

        var week = AcademyUI.getDisplayWeek();

        var classes = AcademyQueries.getClasses() || [];
        classes = classes.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var classListVM = classes.map(function(c) {
            return { id: c.id, name: c.name };
        });

        // Default to People's selected class on first entry.
        if (!_selectedWeeklyTeamsClassId) {
            var peopleClassId = AcademyUI.getSelectedClassId();
            if (peopleClassId) {
                _selectedWeeklyTeamsClassId = peopleClassId;
            }
        }

        var selectedClass = null;
        if (_selectedWeeklyTeamsClassId) {
            for (var i = 0; i < classes.length; i++) {
                if (String(classes[i].id) === String(_selectedWeeklyTeamsClassId)) {
                    selectedClass = classes[i];
                    break;
                }
            }
            if (!selectedClass) {
                _selectedWeeklyTeamsClassId = null;
            }
        }

        var teams = [];
        if (selectedClass) {
            teams = buildWeeklyTeamsList(selectedClass, week);
        }

        // Resolve selected team.
        var selectedTeamVM = null;
        if (_selectedWeeklyTeamId && selectedClass) {
            for (var j = 0; j < teams.length; j++) {
                if (String(teams[j].id) === String(_selectedWeeklyTeamId)) {
                    selectedTeamVM = buildWeeklyTeamDetail(teams[j]._team, week);
                    break;
                }
            }
            if (!selectedTeamVM) {
                _selectedWeeklyTeamId = null;
            }
        }

        // Strip the private _team reference from the list VM.
        var teamsVM = teams.map(function(t) {
            return {
                id: t.id,
                name: t.name,
                type: t.type,
                typeLabel: t.typeLabel,
                periodLabel: t.periodLabel,
                periodDisplay: t.periodDisplay,
                memberCount: t.memberCount,
                activeMemberCount: t.activeMemberCount,
                status: t.status
            };
        });

        return Renderer.renderHTML({
            classes: classListVM,
            classId: _selectedWeeklyTeamsClassId,
            className: selectedClass ? selectedClass.name : null,
            week: week,
            teams: teamsVM,
            selectedTeamId: _selectedWeeklyTeamId,
            selectedTeam: selectedTeamVM
        });
    }

    function buildWeeklyTeamsList(classRecord, week) {
        var TeamQ = window.TeamQueries;
        if (!TeamQ || typeof TeamQ.getTeamsByClass !== 'function') {
            return [];
        }

        var raw = TeamQ.getTeamsByClass(classRecord.id) || [];
        if (!Array.isArray(raw)) {
            return [];
        }

        var items = [];

        for (var i = 0; i < raw.length; i++) {
            var team = raw[i];
            if (!team || !team.id) { continue; }

            // Academy tab shows academic teams only.
            if (team.type !== 'academic') { continue; }

            var activeMembers = buildTeamMembersVM(team, week).filter(function(m) {
                return m.activeAtPeriod;
            });

            items.push({
                id: team.id,
                name: team.name || 'Unnamed Team',
                type: team.type,
                typeLabel: getTeamTypeLabel(team.type),
                periodLabel: getTeamPeriodLabel(team.type),
                periodDisplay: getTeamPeriodDisplay(team),
                memberCount: Array.isArray(team.members) ? team.members.length : 0,
                activeMemberCount: activeMembers.length,
                status: team.status || 'active',
                temporaryMission: team.temporaryMission || null,
                _team: team
            });
        }

        items.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return items;
    }

    function buildWeeklyTeamDetail(team, week) {
        if (!team) { return null; }

        var members = buildTeamMembersVM(team, week);

        return {
            id: team.id,
            name: team.name || 'Unnamed Team',
            type: team.type,
            typeLabel: getTeamTypeLabel(team.type),
            periodLabel: getTeamPeriodLabel(team.type),
            periodDisplay: getTeamPeriodDisplay(team),
            status: team.status || 'active',
            temporaryMission: team.temporaryMission || null,
            members: members,
            activeMemberCount: members.filter(function(m) {
                return m.activeAtPeriod;
            }).length
        };
    }

    function buildTeamMembersVM(team, week) {
        if (!team || !Array.isArray(team.members)) {
            return [];
        }

        var periodNum = parseInt(week, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = 1;
        }

        var result = [];

        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || !member.characterId) { continue; }

            var char = CharacterQueries.getCharacterById(member.characterId);
            var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
            var status = char ? CharacterQueries.getCurrentStatus(char) : '';
            var age = char ? CharacterQueries.getCharacterAge(char) : '';
            var deceased = char ? (char.deceased === true) : false;

            var joinNum = parseInt(member.joinPeriod, 10);
            var leaveNum = parseInt(member.leavePeriod, 10);
            var hasJoin = member.joinPeriod !== undefined && member.joinPeriod !== null && member.joinPeriod !== '';
            var hasLeave = member.leavePeriod !== undefined && member.leavePeriod !== null && member.leavePeriod !== '';
            var joined = !hasJoin || (!isNaN(joinNum) && joinNum <= periodNum);
            var notLeft = !hasLeave || (!isNaN(leaveNum) && leaveNum >= periodNum);
            var activeAtPeriod = joined && notLeft;

            result.push({
                characterId: member.characterId,
                name: name,
                status: status,
                age: age,
                deceased: deceased,
                role: member.role || 'Member',
                joinPeriod: member.joinPeriod || '',
                leavePeriod: member.leavePeriod || '',
                activeAtPeriod: activeAtPeriod
            });
        }

        result.sort(function(a, b) {
            if (a.activeAtPeriod && !b.activeAtPeriod) { return -1; }
            if (!a.activeAtPeriod && b.activeAtPeriod) { return 1; }
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    function getTeamTypeLabel(type) {
        if (window.TeamConstants && typeof window.TeamConstants.getTypeLabel === 'function') {
            return window.TeamConstants.getTypeLabel(type);
        }
        if (type === 'academic') return 'Academic';
        if (type === 'professional') return 'Professional';
        if (type === 'temporary') return 'Temporary';
        if (type === 'civilian') return 'Civilian';
        return 'Team';
    }

    function getTeamPeriodLabel(type) {
        if (window.TeamConstants && typeof window.TeamConstants.getPeriodLabel === 'function') {
            return window.TeamConstants.getPeriodLabel(type);
        }
        if (type === 'academic') return 'Week';
        return 'Year';
    }

    function getTeamPeriodDisplay(team) {
        if (window.TeamQueries && typeof window.TeamQueries.getTeamPeriodDisplay === 'function') {
            return window.TeamQueries.getTeamPeriodDisplay(team);
        }
        return '';
    }

    // ============================================================
    // EVENT WIRING
    // ============================================================
    //
    // Delegation strategy:
    //   - Listeners attached to the CONTAINER once per container
    //     identity. Since the container is stable across re-renders
    //     (only its innerHTML changes), we use a marker to prevent
    //     stacking listeners.
    //   - Handlers use event.target.closest() to resolve targets, so
    //     they survive innerHTML replacement.

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

    // ============================================================
    // DELEGATED CLICK
    // ============================================================

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

        // ---- Weekly team row selection ----
        var weeklyTeamRow = target.closest('.academy-weekly-team-row');
        if (weeklyTeamRow) {
            e.preventDefault();
            var weeklyTeamId = weeklyTeamRow.dataset.teamId;
            if (weeklyTeamId) {
                _selectedWeeklyTeamId =
                    (String(_selectedWeeklyTeamId) === String(weeklyTeamId))
                        ? null
                        : weeklyTeamId;
                refreshView();
            }
            return;
        }

        // ---- Weekly team member row (navigate to People) ----
        var weeklyMemberRow = target.closest('.academy-weekly-team-member-row');
        if (weeklyMemberRow) {
            e.preventDefault();
            var weeklyMemberId = weeklyMemberRow.dataset.characterId;
            if (weeklyMemberId) {
                if (_selectedWeeklyTeamsClassId) {
                    AcademyUI.selectClass(_selectedWeeklyTeamsClassId);
                }
                AcademyUI.selectCharacter(weeklyMemberId);
                AcademyUI.setSelectedView('people');
                refreshView();
            }
            return;
        }

        // ---- Discipline row selection ----
        var disciplineRow = target.closest('.academy-discipline-row');
        if (disciplineRow) {
            e.preventDefault();
            var disciplineId = disciplineRow.dataset.disciplineId;
            if (disciplineId) {
                _selectedDisciplineId =
                    (String(_selectedDisciplineId) === String(disciplineId))
                        ? null
                        : disciplineId;
                refreshView();
            }
            return;
        }

        // ---- Location row selection ----
        var locationRow = target.closest('.academy-location-row');
        if (locationRow) {
            e.preventDefault();
            var locationId = locationRow.dataset.locationId;
            if (locationId) {
                _selectedLocationId =
                    (String(_selectedLocationId) === String(locationId))
                        ? null
                        : locationId;
                refreshView();
            }
            return;
        }

        // ---- Ranking row selection (navigate to People) ----
        var rankingRow = target.closest('.academy-ranking-row');
        if (rankingRow) {
            e.preventDefault();
            var rankingCharId = rankingRow.dataset.characterId;
            if (rankingCharId) {
                var rankingClassId = _selectedRankingClassId || AcademyUI.getSelectedClassId();
                if (rankingClassId) {
                    AcademyUI.selectClass(rankingClassId);
                }
                AcademyUI.selectCharacter(rankingCharId);
                AcademyUI.setSelectedView('people');
                refreshView();
            }
            return;
        }

        // ---- Character row selection (People sidebar + roster) ----
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

            if (actionEl.dataset.classId) {
                e.preventDefault();
                handleClassAction(action, actionEl.dataset.classId);
                return;
            }

            if (actionEl.dataset.disciplineId) {
                e.preventDefault();
                handleDisciplineAction(action, actionEl.dataset.disciplineId);
                return;
            }

            if (actionEl.dataset.locationId) {
                e.preventDefault();
                handleLocationAction(action, actionEl.dataset.locationId);
                return;
            }

            return;
        }
    }

    // ============================================================
    // DELEGATED CHANGE
    // ============================================================

    function handleDelegatedChange(e) {
        var target = e.target;

        // ---- People view ----
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

        // ---- Rankings view ----
        if (target.id === 'academy-ranking-class-select') {
            _selectedRankingClassId = target.value || null;
            refreshView();
            return;
        }

        if (target.id === 'academy-ranking-week-input') {
            var rankWeek = parseInt(target.value, 10);
            if (!isNaN(rankWeek) && rankWeek >= getMinWeek() && rankWeek <= getMaxWeek()) {
                AcademyUI.setDisplayWeek(rankWeek);
                refreshView();
            }
            return;
        }

        // ---- Weekly Teams view ----
        if (target.id === 'academy-weekly-teams-class-select') {
            _selectedWeeklyTeamsClassId = target.value || null;
            _selectedWeeklyTeamId = null;
            refreshView();
            return;
        }

        if (target.id === 'academy-weekly-teams-week-input') {
            var weeklyTeamsWeek = parseInt(target.value, 10);
            if (!isNaN(weeklyTeamsWeek) && weeklyTeamsWeek >= getMinWeek() && weeklyTeamsWeek <= getMaxWeek()) {
                AcademyUI.setDisplayWeek(weeklyTeamsWeek);
                refreshView();
            }
            return;
        }

        // ---- Disciplines view ----
        if (target.id === 'academy-discipline-type-filter') {
            AcademyUI.setFilter('disciplines', 'type', target.value);
            refreshView();
            return;
        }

        // ---- Locations view ----
        if (target.id === 'academy-location-type-filter') {
            AcademyUI.setFilter('locations', 'type', target.value);
            refreshView();
            return;
        }
    }

    // ============================================================
    // DELEGATED INPUT
    // ============================================================

    function handleDelegatedInput(e) {
        var target = e.target;

        if (target.id === 'academy-people-search') {
            debounceSearch(target.value);
            return;
        }
        if (target.id === 'academy-discipline-search') {
            debounceDisciplineSearch(target.value);
            return;
        }
        if (target.id === 'academy-location-search') {
            debounceLocationSearch(target.value);
            return;
        }
    }

    // ============================================================
    // DELEGATED KEYDOWN
    // ============================================================

    function handleDelegatedKeydown(e) {
        var target = e.target;

        if (target.id === 'academy-week-input' && e.key === 'Enter') {
            e.preventDefault();
            handleWeekChange(target.value);
            return;
        }
        if (target.id === 'academy-ranking-week-input' && e.key === 'Enter') {
            e.preventDefault();
            var rankWeek = parseInt(target.value, 10);
            if (!isNaN(rankWeek) && rankWeek >= getMinWeek() && rankWeek <= getMaxWeek()) {
                AcademyUI.setDisplayWeek(rankWeek);
                refreshView();
            }
            return;
        }
        if (target.id === 'academy-weekly-teams-week-input' && e.key === 'Enter') {
            e.preventDefault();
            var teamsWeek = parseInt(target.value, 10);
            if (!isNaN(teamsWeek) && teamsWeek >= getMinWeek() && teamsWeek <= getMaxWeek()) {
                AcademyUI.setDisplayWeek(teamsWeek);
                refreshView();
            }
            return;
        }
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleViewSwitch(viewId) {
        if (!viewId) { return; }
        if (AcademyUI.setSelectedView(viewId)) {
            refreshView();
        }
    }

    function handleClassSelect(classId) {
        if (!classId) {
            AcademyUI.selectClass(null);
            refreshView();
            return;
        }
        AcademyUI.selectClass(classId);
        refreshView();
    }

    function handleCharacterSelect(charId) {
        if (!charId) { return; }
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
        if (isNaN(week) || week < getMinWeek() || week > getMaxWeek()) {
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
        if (!char) { return; }
        if (window.CharacterDetail && typeof window.CharacterDetail.open === 'function') {
            window.CharacterDetail.open(charId);
        } else {
            notify('Character detail view not available.', 'error');
        }
    }

    function handleEditCharacter(charId) {
        // character-events.js listens for this exact event on document.
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
        // panel renders as a summary. Session E delivers the modals.
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

    function handleDisciplineAction(action, disciplineId) {
        // Discipline CRUD is delivered in Session E.
        switch (action) {
            case 'edit-discipline':
                break;
            case 'delete-discipline':
                break;
            default:
                break;
        }
    }

    function handleLocationAction(action, locationId) {
        // Location CRUD is delivered in Session E.
        switch (action) {
            case 'edit-location':
                break;
            case 'delete-location':
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
        if (name === null) { return; }
        name = name.trim();
        if (!name) { return; }

        window.AcademyClasses.create(name).then(function(result) {
            if (result && result.success) {
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
    var _disciplineSearchTimer = null;
    var _locationSearchTimer = null;

    function debounceSearch(value) {
        if (_searchTimer) { clearTimeout(_searchTimer); }
        _searchTimer = setTimeout(function() {
            _searchTimer = null;
            AcademyUI.setFilter('people', 'search', value);
            refreshView();
        }, 150);
    }

    function debounceDisciplineSearch(value) {
        if (_disciplineSearchTimer) { clearTimeout(_disciplineSearchTimer); }
        _disciplineSearchTimer = setTimeout(function() {
            _disciplineSearchTimer = null;
            AcademyUI.setFilter('disciplines', 'search', value);
            refreshView();
        }, 150);
    }

    function debounceLocationSearch(value) {
        if (_locationSearchTimer) { clearTimeout(_locationSearchTimer); }
        _locationSearchTimer = setTimeout(function() {
            _locationSearchTimer = null;
            AcademyUI.setFilter('locations', 'search', value);
            refreshView();
        }, 150);
    }

    // ============================================================
    // REFRESH
    // ============================================================

    function refreshView() {
        var container = document.getElementById('tab-academy');
        if (!container) { return; }
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