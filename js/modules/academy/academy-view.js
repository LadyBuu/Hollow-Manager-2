/**
 * modules/academy/academy-view.js - Academy Unified Shell
 * UI controller and coordinator for the Academy tab.
 *
 * Path: js/modules/academy/academy-view.js
 *
 * RESPONSIBILITIES:
 *   - Own the top-level Academy shell (view switcher)
 *   - Coordinate six views: People, Exams, Weekly Teams, Rankings,
 *     Disciplines, Locations
 *   - Delegate rendering to the per-view renderer modules
 *   - Delegate domain reads to the aggregators
 *   - Delegate mutations to the appropriate domain module
 *   - Own Academy-local UI state that is not part of AcademyUI's
 *     typed store
 *   - Bind container-level event delegation for all views
 *   - Mount / unmount the inline grades editor and schedule grid
 *   - Handle exam pair-picker DOM mutations
 *   - Handle Weekly Teams create/edit/delete/manage-members
 *   - Handle orphan-team assignment
 *   - Handle Auto-Distribute
 *   - Handle Clear Rosters
 *   - Handle character class membership mutations
 *
 * NOT RESPONSIBILITIES:
 *   - Domain reads. Those happen in the aggregators.
 *   - Domain validation. That happens in the domain modules.
 *   - Domain mutation. Those are delegated to the owning module.
 *
 * ROLE VOCABULARY (CANONICAL):
 *   'student' | 'instructor'. There is no 'trainee'.
 *
 * ENROLMENT MUTATIONS:
 *   AcademyEnrolments.enrol and AcademyEnrolments.leave both take a
 *   week argument. Both perform cheap pre-flight validation BEFORE
 *   entering the mutation pipeline and return a rejected
 *   { success: false, message } Promise when the week is missing or
 *   malformed. Every enrollment call below passes
 *   AcademyUI.getDisplayWeek() and surfaces the rejection message on
 *   failure.
 *
 * WEEKLY TEAMS WINDOW SYNC:
 *   The weekly-team window record (academy.weeklyTeams[classId][teamId])
 *   must stay in sync with the persistent Team's startPeriod/endPeriod.
 *   On create and on edit, this module calls
 *   AcademyWeeklyTeams.setWindow(classId, teamId, startWeek, endWeek)
 *   AFTER TeamCore.createTeam / TeamCore.updateTeam succeeds.
 *
 *   setWindow REPLACES the window. ensureWindow only widens it.
 *
 * WEEKLY TEAMS CLEAR ROSTERS (v24):
 *   The Weekly Teams sidebar exposes exactly one roster-clearing
 *   action: "Clear Rosters". It removes every member whose active
 *   window covers the currently displayed week, across every
 *   academic team of the class. Past and future stints survive.
 *   Teams stay scheduled. Team entities are untouched.
 *
 *   The former "Clear Schedule" action (which deleted the
 *   academy.weeklyTeams window records for the class, making teams
 *   disappear) is not exposed to any UI in v24. The underlying
 *   clearClassWindows helper is retained; the Auto-Distribute modal
 *   still uses clearExisting for its "wipe before redistributing"
 *   option, which calls clearClassWindows directly.
 *
 * AUTO-DISTRIBUTE SEMANTICS:
 *   Per student. Existing teams fill toward groupSize; new teams are
 *   created only when every existing team has reached groupSize.
 *
 *   ELIGIBILITY FILTER (BUG-R2):
 *     The distribution pool excludes:
 *       - students deceased at any point (char.deceased === true)
 *       - students eliminated as of the display week
 *         (EliminationQueries.isCharacterEliminatedByWeek)
 *
 *     Elimination at exactly the display week does NOT exclude the
 *     student; the boundary rule is E < W.
 *
 * WEEK SEMANTICS:
 *   Every aggregator projection that consumes a week passes
 *   AcademyUI.getDisplayWeek(). This includes:
 *     - getClassViewModel(classId, week)
 *     - getClassStudentsViewModel(classId, week)
 *     - getPeopleViewModel(classId, { ..., week })
 *   The People sidebar Status filter ('eliminated') reads the week-
 *   scoped elimination state on each person VM, which is computed by
 *   the aggregator via EliminationQueries.isCharacterEliminatedByWeek.
 *
 * DEPENDENCIES (MANDATORY):
 *   - AcademyUI
 *   - AcademyAggregator
 *   - AcademyTournamentAggregator
 *   - AcademyCharacterDetailAggregator
 *   - DomUtils
 *   - CalendarConstants
 *
 * DEPENDENCIES (OPTIONAL, feature-scoped):
 *   - CharacterQueries / CharacterClasses
 *   - AcademyDisciplines / AcademyEnrolments / AcademyGroups
 *   - CharacterEliminations
 *   - AcademyCRUDModals / AcademyTournamentEvents / AcademyGradesEditor
 *   - AcademyCharacterDetail / AcademyClassDetail
 *   - AcademyDisciplineView / AcademyLocationView / AcademyRankingView /
 *     AcademyWeeklyTeamsView / AcademyTournamentView
 *   - AcademyWeeklyTeamsMembers (Academy-scoped member manager)
 *   - AcademyWeeklyTeams (window and membership mutations)
 *   - CalendarRenderer
 *   - TeamCore / TeamQueries / TeamConstants
 *   - Modal / NotificationSystem
 */

(function() {
    'use strict';

    if (window.__academyViewLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyTournamentAggregator = window.AcademyTournamentAggregator;
    var AcademyCharacterDetailAggregator = window.AcademyCharacterDetailAggregator;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!AcademyUI || typeof AcademyUI.getSelectedView !== 'function') {
        _missing.push('AcademyUI.getSelectedView');
    }
    if (!AcademyUI || typeof AcademyUI.getSelectedClassId !== 'function') {
        _missing.push('AcademyUI.getSelectedClassId');
    }
    if (!AcademyUI || typeof AcademyUI.getSelectedCharacterId !== 'function') {
        _missing.push('AcademyUI.getSelectedCharacterId');
    }
    if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
    }
    if (!AcademyUI || typeof AcademyUI.setDisplayWeek !== 'function') {
        _missing.push('AcademyUI.setDisplayWeek');
    }
    if (!AcademyUI || typeof AcademyUI.getCharacterMode !== 'function') {
        _missing.push('AcademyUI.getCharacterMode');
    }
    if (!AcademyUI || typeof AcademyUI.setCharacterMode !== 'function') {
        _missing.push('AcademyUI.setCharacterMode');
    }
    if (!AcademyUI || typeof AcademyUI.getPeopleFilter !== 'function') {
        _missing.push('AcademyUI.getPeopleFilter');
    }
    if (!AcademyUI || typeof AcademyUI.setPeopleFilter !== 'function') {
        _missing.push('AcademyUI.setPeopleFilter');
    }

    if (!AcademyAggregator || typeof AcademyAggregator.getClassListViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassListViewModel');
    }
    if (!AcademyAggregator || typeof AcademyAggregator.getClassViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassViewModel');
    }
    if (!AcademyAggregator || typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }
    if (!AcademyAggregator || typeof AcademyAggregator.getDisciplineListViewModel !== 'function') {
        _missing.push('AcademyAggregator.getDisciplineListViewModel');
    }
    if (!AcademyAggregator || typeof AcademyAggregator.getWeeklyTeamsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getWeeklyTeamsViewModel');
    }
    if (!AcademyAggregator || typeof AcademyAggregator.getLocationViewModel !== 'function') {
        _missing.push('AcademyAggregator.getLocationViewModel');
    }
    if (!AcademyAggregator || typeof AcademyAggregator.getRankingViewModel !== 'function') {
        _missing.push('AcademyAggregator.getRankingViewModel');
    }

    if (!AcademyTournamentAggregator ||
        typeof AcademyTournamentAggregator.getExamViewModel !== 'function') {
        _missing.push('AcademyTournamentAggregator.getExamViewModel');
    }

    if (!AcademyCharacterDetailAggregator ||
        typeof AcademyCharacterDetailAggregator.getViewModel !== 'function') {
        _missing.push('AcademyCharacterDetailAggregator.getViewModel');
    }

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyView] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyViewLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getCharacterClasses() { return window.CharacterClasses || null; }
    function getAcademyDisciplines() { return window.AcademyDisciplines || null; }
    function getAcademyEnrolments() { return window.AcademyEnrolments || null; }
    function getAcademyGroups() { return window.AcademyGroups || null; }
    function getAcademyWeeklyTeams() { return window.AcademyWeeklyTeams || null; }
    function getAcademyWeeklyTeamsMembers() {
        return window.AcademyWeeklyTeamsMembers || null;
    }
    function getAcademyCRUDModals() { return window.AcademyCRUDModals || null; }
    function getAcademyTournamentEvents() { return window.AcademyTournamentEvents || null; }
    function getAcademyGradesEditor() { return window.AcademyGradesEditor || null; }
    function getCharacterDetailModule() { return window.AcademyCharacterDetail || null; }
    function getClassDetailModule() { return window.AcademyClassDetail || null; }
    function getDisciplineViewModule() { return window.AcademyDisciplineView || null; }
    function getLocationViewModule() { return window.AcademyLocationView || null; }
    function getRankingViewModule() { return window.AcademyRankingView || null; }
    function getWeeklyTeamsViewModule() { return window.AcademyWeeklyTeamsView || null; }
    function getTournamentViewModule() { return window.AcademyTournamentView || null; }
    function getNotificationSystem() { return window.NotificationSystem || null; }
    function getCalendarRenderer() { return window.CalendarRenderer || null; }
    function getTeamCore() { return window.TeamCore || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getTeamConstants() { return window.TeamConstants || null; }
    function getModal() { return window.Modal || null; }

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function notify(message, type) {
        var NS = getNotificationSystem();
        if (NS && typeof NS.notify === 'function') {
            NS.notify(message, type || 'info');
        }
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var VIEWS = [
        { id: 'people',       label: 'People' },
        { id: 'tournaments',  label: 'Exams' },
        { id: 'weeklyTeams',  label: 'Weekly Teams' },
        { id: 'rankings',     label: 'Rankings' },
        { id: 'disciplines',  label: 'Disciplines' },
        { id: 'locations',    label: 'Locations' }
    ];

    var VALID_VIEW_IDS = VIEWS.map(function(v) { return v.id; });

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _activeCharacterTab = 'main';
    var _lastCharacterIdForTab = null;

    var _selectedExamClassId = null;
    var _selectedRankingClassId = null;
    var _selectedWeeklyTeamsClassId = null;
    var _selectedWeeklyTeamId = null;
    var _selectedLocationId = null;

    var _selectedDisciplineId = null;
    var _disciplineDraft = null;
    var _disciplineDraftMode = 'empty';
    var _disciplineDraftErrors = {};

    var _boundContainer = null;
    var _boundHandlers = null;

    var _searchTimer = null;
    var _disciplineSearchTimer = null;
    var _locationSearchTimer = null;

    var _disciplineFilters = { type: 'all', search: '' };
    var _locationFilters = { type: 'all', search: '' };

    var _teamCoreConfigured = false;

    // ============================================================
    // TEAM CORE CONFIGURATION (idempotent)
    // ============================================================

    function ensureTeamCoreConfigured() {
        if (_teamCoreConfigured) { return true; }

        var TeamCore = getTeamCore();
        var CQ = getCharacterQueries();

        if (!TeamCore || typeof TeamCore.configure !== 'function') {
            return false;
        }
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return false;
        }

        var provider = {
            exists: function(appData, id) {
                if (!appData || !Array.isArray(appData.characters)) {
                    return false;
                }
                if (id === null || id === undefined || id === '') {
                    return false;
                }
                var target = String(id);
                for (var i = 0; i < appData.characters.length; i++) {
                    var c = appData.characters[i];
                    if (c && String(c.id) === target) {
                        return true;
                    }
                }
                return false;
            }
        };

        try {
            var result = TeamCore.configure({ characterProvider: provider });
            if (result === false) {
                console.warn('[AcademyView] TeamCore.configure returned false.');
                return false;
            }
            _teamCoreConfigured = true;
            return true;
        } catch (e) {
            console.warn('[AcademyView] TeamCore.configure threw:', e);
            return false;
        }
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    function render(container) {
        if (!container) {
            container = document.getElementById('tab-academy');
        }
        if (!container) {
            return;
        }

        var view = AcademyUI.getSelectedView();
        if (VALID_VIEW_IDS.indexOf(view) === -1) {
            view = 'people';
        }

        var html = '';
        html += renderViewNav(view);

        switch (view) {
            case 'people':
                html += renderPeopleView();
                break;
            case 'tournaments':
                html += renderTournamentView();
                break;
            case 'weeklyTeams':
                html += renderWeeklyTeamsView();
                break;
            case 'rankings':
                html += renderRankingView();
                break;
            case 'disciplines':
                html += renderDisciplineView();
                break;
            case 'locations':
                html += renderLocationView();
                break;
            default:
                html += renderPlaceholder('Unknown view: ' + view);
        }

        container.innerHTML = html;

        bindEvents(container);
        wireCRUDModalsCallbacks();
        mountGradesEditorIfPresent();
        mountScheduleGridIfPresent();
    }

    function refreshView() {
        if (!_boundContainer) {
            return;
        }
        render(_boundContainer);
    }

    function unmount() {
        cancelAllDebounceTimers();
        unbindEvents();
        unmountGradesEditor();
        unmountScheduleGrid();
        _boundContainer = null;
    }

    // ============================================================
    // VIEW NAV
    // ============================================================

    function renderViewNav(activeView) {
        var html = '<div class="academy-view-nav">';
        for (var i = 0; i < VIEWS.length; i++) {
            var v = VIEWS[i];
            var isActive = v.id === activeView;
            html += '<button type="button" ' +
                        'class="academy-view-btn' +
                            (isActive ? ' active' : '') + '" ' +
                        'data-view="' + escapeAttribute(v.id) + '">' +
                        escapeHtml(v.label) +
                    '</button>';
        }
        html += '</div>';
        return html;
    }

    function renderPlaceholder(label) {
        return (
            '<div class="academy-body academy-body-placeholder">' +
                '<p class="empty-state">' + escapeHtml(label) + '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // PEOPLE VIEW
    // ============================================================

    function renderPeopleView() {
        var classId = AcademyUI.getSelectedClassId();
        var charId = AcademyUI.getSelectedCharacterId();
        var week = AcademyUI.getDisplayWeek();

        var html = '';
        html += renderPeopleTopBar(classId, week);

        if (!classId) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">' +
                            'Select a class to view its members.' +
                        '</p>' +
                    '</div>';
            return html;
        }

        var classVM = AcademyAggregator.getClassViewModel(classId, week);
        if (!classVM) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">Class not found.</p>' +
                    '</div>';
            return html;
        }

        var peopleVM = AcademyAggregator.getPeopleViewModel(classId, {
            filters: AcademyUI.getPeopleFilter(),
            selectedCharacterId: charId,
            week: week
        });

        html += '<div class="academy-body academy-people-layout">';
        html += renderPeopleSidebar(peopleVM);

        html += '<div class="academy-people-detail" id="academy-people-detail">';
        if (charId) {
            resetCharacterTabIfChanged(charId);
            html += renderCharacterDetailContent(classVM, charId);
        } else {
            _lastCharacterIdForTab = null;
            _activeCharacterTab = 'main';
            html += renderClassDetailContent(classVM);
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderPeopleTopBar(selectedClassId, week) {
        var classes = AcademyAggregator.getClassListViewModel() || [];

        var html = '';
        html += '<div class="academy-top-bar">';

        html += '<div class="academy-top-left">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-class-select">Class:</label>';
        html += '<select id="academy-class-select" class="academy-class-select">';
        html += '<option value="">Select a class...</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var isSelected = selectedClassId &&
                String(selectedClassId) === String(cls.id);
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        (isSelected ? ' selected' : '') + '>' +
                        escapeHtml(cls.name) +
                    '</option>';
        }
        html += '</select>';
        html += '<button type="button" id="academy-add-class-btn" ' +
                    'class="primary small">+ Add Class</button>';
        html += '</div>';

        html += '<div class="academy-top-right">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-week-input">Week:</label>';
        html += '<input type="number" id="academy-week-input" ' +
                    'class="academy-week-input" ' +
                    'value="' + escapeAttribute(String(week)) + '" ' +
                    'min="' + MIN_WEEK + '" max="' + MAX_WEEK + '">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderPeopleSidebar(vm) {
        var filters = vm.filters || { search: '', role: 'all', status: 'active' };

        var html = '<div class="academy-people-sidebar">';

        html += '<div class="academy-character-filters">';

        html += '<input type="text" id="academy-people-search" ' +
                    'class="academy-people-search" ' +
                    'placeholder="Search..." ' +
                    'value="' + escapeAttribute(filters.search || '') + '">';

        html += '<label class="academy-filter-label" ' +
                    'for="academy-people-role">Role:</label>';
        html += '<select id="academy-people-role" class="academy-people-role">';
        html += '<option value="all"' +
                    (filters.role === 'all' ? ' selected' : '') +
                    '>All</option>';
        html += '<option value="student"' +
                    (filters.role === 'student' ? ' selected' : '') +
                    '>Students</option>';
        html += '<option value="instructor"' +
                    (filters.role === 'instructor' ? ' selected' : '') +
                    '>Instructors</option>';
        html += '</select>';

        html += '<label class="academy-filter-label" ' +
                    'for="academy-people-status">Status:</label>';
        html += '<select id="academy-people-status" class="academy-people-status">';
        html += '<option value="active"' +
                    (filters.status === 'active' ? ' selected' : '') +
                    '>Active</option>';
        html += '<option value="eliminated"' +
                    (filters.status === 'eliminated' ? ' selected' : '') +
                    '>Eliminated</option>';
        html += '<option value="deceased"' +
                    (filters.status === 'deceased' ? ' selected' : '') +
                    '>Deceased</option>';
        html += '<option value="all"' +
                    (filters.status === 'all' ? ' selected' : '') +
                    '>All</option>';
        html += '</select>';

        html += '</div>';

        html += '<div class="academy-character-list" ' +
                    'id="academy-character-list">';

        var people = vm.people || [];
        if (people.length === 0) {
            html += '<p class="empty-state small">' +
                        'No characters match the current filters.' +
                    '</p>';
        } else {
            for (var i = 0; i < people.length; i++) {
                html += renderPersonRow(people[i]);
            }
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderPersonRow(person) {
        if (!person || !person.id) {
            return '';
        }

        var classes = 'academy-character-row';
        if (person.isSelected) { classes += ' selected'; }
        if (person.deceased) { classes += ' deceased'; }
        if (person.eliminated) { classes += ' eliminated'; }

        var html = '';
        html += '<div class="' + classes + '" ' +
                    'data-character-id="' + escapeAttribute(person.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-character-row-main">';
        html += '<span class="academy-character-name">' +
                    escapeHtml(person.name || 'Unknown') +
                '</span>';
        if (person.role === 'instructor') {
            html += '<span class="academy-character-role-badge">' +
                        'Instructor' +
                    '</span>';
        }
        html += '</div>';

        if (person.eliminated) {
            var weekText = (typeof person.eliminationWeek === 'number')
                ? ' (Wk ' + person.eliminationWeek + ')'
                : '';
            html += '<div class="academy-character-row-warning">' +
                        '\u26a0 Eliminated' + escapeHtml(weekText) +
                    '</div>';
        }

        if (person.status && !person.eliminated) {
            html += '<div class="academy-character-row-status">' +
                        escapeHtml(person.status) +
                    '</div>';
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
                console.warn(
                    '[AcademyView] AcademyClassDetail.renderHTML failed:', e
                );
            }
        }
        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' + escapeHtml(classVM.name || 'Class') + '</h3>' +
                '<p class="empty-state small">' +
                    'Class detail view not available.' +
                '</p>' +
            '</div>'
        );
    }

    function renderCharacterDetailContent(classVM, charId) {
        var classId = classVM ? classVM.id : null;
        var week = AcademyUI.getDisplayWeek();
        var mode = AcademyUI.getCharacterMode(charId);

        var vm = AcademyCharacterDetailAggregator.getViewModel(charId, {
            classId: classId,
            week: week,
            mode: mode,
            tab: _activeCharacterTab
        });

        if (!vm) {
            return '<p class="empty-state">Character not found.</p>';
        }

        var CharacterDetail = getCharacterDetailModule();
        if (CharacterDetail && typeof CharacterDetail.renderHTML === 'function') {
            try {
                return CharacterDetail.renderHTML(vm);
            } catch (e) {
                console.warn(
                    '[AcademyView] AcademyCharacterDetail.renderHTML failed:',
                    e
                );
            }
        }

        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' + escapeHtml(vm.character.name) + '</h3>' +
                '<p class="empty-state small">' +
                    'Character detail view not available.' +
                '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // TOURNAMENTS / EXAMS VIEW
    // ============================================================

    function renderTournamentView() {
        var Renderer = getTournamentViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Exams');
        }

        var week = AcademyUI.getDisplayWeek();

        if (!_selectedExamClassId) {
            var peopleClassId = AcademyUI.getSelectedClassId();
            if (peopleClassId) {
                _selectedExamClassId = peopleClassId;
            }
        }

        var vm = AcademyTournamentAggregator.getExamViewModel(
            _selectedExamClassId,
            week
        );

        if (vm.classId) {
            _selectedExamClassId = vm.classId;
        }

        return Renderer.renderHTML(vm);
    }

    // ============================================================
    // WEEKLY TEAMS VIEW
    // ============================================================

    function renderWeeklyTeamsView() {
        var Renderer = getWeeklyTeamsViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Weekly Teams');
        }

        var week = AcademyUI.getDisplayWeek();

        if (!_selectedWeeklyTeamsClassId) {
            var peopleClassId = AcademyUI.getSelectedClassId();
            if (peopleClassId) {
                _selectedWeeklyTeamsClassId = peopleClassId;
            }
        }

        var vm = AcademyAggregator.getWeeklyTeamsViewModel(
            _selectedWeeklyTeamsClassId,
            week,
            _selectedWeeklyTeamId
        );

        if (vm.classId) {
            _selectedWeeklyTeamsClassId = vm.classId;
        }
        _selectedWeeklyTeamId = vm.selectedTeamId;

        return Renderer.renderHTML(vm);
    }

    // ============================================================
    // RANKING VIEW
    // ============================================================

    function renderRankingView() {
        var Renderer = getRankingViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Rankings');
        }

        var week = AcademyUI.getDisplayWeek();

        if (!_selectedRankingClassId) {
            var peopleClassId = AcademyUI.getSelectedClassId();
            if (peopleClassId) {
                _selectedRankingClassId = peopleClassId;
            }
        }

        var vm = AcademyAggregator.getRankingViewModel(
            _selectedRankingClassId,
            week
        );

        if (vm.classId) {
            _selectedRankingClassId = vm.classId;
        }

        return Renderer.renderHTML(vm);
    }

    // ============================================================
    // DISCIPLINES VIEW
    // ============================================================

    function renderDisciplineView() {
        var Renderer = getDisciplineViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Disciplines');
        }

        var listVM = AcademyAggregator.getDisciplineListViewModel(
            _disciplineFilters
        );
        var editorVM = buildDisciplineEditorVM();

        return Renderer.renderHTML({
            disciplines: listVM.disciplines,
            selected: editorVM,
            editorMode: _disciplineDraftMode,
            filters: _disciplineFilters,
            total: listVM.total
        });
    }

    function buildDisciplineEditorVM() {
        if (_disciplineDraftMode === 'empty' || !_disciplineDraft) {
            return null;
        }
        return AcademyAggregator.getDisciplineEditorViewModel({
            draft: _disciplineDraft,
            isNew: _disciplineDraftMode === 'create',
            errors: _disciplineDraftErrors
        });
    }

    function initializeDraftFromDiscipline(disciplineId) {
        var AD = getAcademyDisciplines();
        var GradeSchemes = window.AcademyGradeSchemes;
        if (!AD || !GradeSchemes) {
            notify('Discipline module not loaded.', 'error');
            return;
        }

        var record = AD.getDiscipline(disciplineId);
        if (!record) {
            notify('Discipline not found.', 'error');
            return;
        }

        _selectedDisciplineId = String(disciplineId);
        _disciplineDraftMode = 'edit';
        _disciplineDraftErrors = {};

        var weights = (typeof AD.getAssessmentWeights === 'function')
            ? AD.getAssessmentWeights(record.id)
            : {};

        _disciplineDraft = {
            id: record.id,
            name: record.name || '',
            type: record.type || 'mandatory',
            startWeek: typeof record.startWeek === 'number'
                ? record.startWeek
                : MIN_WEEK,
            endWeek: typeof record.endWeek === 'number'
                ? record.endWeek
                : MAX_WEEK,
            weeklyHours: typeof record.weeklyHours === 'number'
                ? record.weeklyHours
                : 1,
            weight: typeof record.weight === 'number' ? record.weight : 1,
            instructorIds: Array.isArray(record.instructorIds)
                ? record.instructorIds.slice()
                : [],
            gradeScheme: GradeSchemes.normalizeScheme(record.gradeScheme),
            assessmentWeights: weights || {}
        };
    }

    function initializeNewDraft() {
        var GradeSchemes = window.AcademyGradeSchemes;
        var AD = getAcademyDisciplines();
        if (!GradeSchemes) {
            notify('Grade schemes module not loaded.', 'error');
            return;
        }

        _selectedDisciplineId = null;
        _disciplineDraftMode = 'create';
        _disciplineDraftErrors = {};

        _disciplineDraft = {
            id: null,
            name: '',
            type: 'mandatory',
            startWeek: MIN_WEEK,
            endWeek: MAX_WEEK,
            weeklyHours: 1,
            weight: 1,
            instructorIds: [],
            gradeScheme: GradeSchemes.getDefaultScheme(),
            assessmentWeights: (AD &&
                typeof AD.getDefaultAssessmentWeights === 'function')
                ? AD.getDefaultAssessmentWeights()
                : {}
        };
    }

    function clearDraft() {
        _selectedDisciplineId = null;
        _disciplineDraft = null;
        _disciplineDraftMode = 'empty';
        _disciplineDraftErrors = {};
    }

    // ============================================================
    // LOCATIONS VIEW
    // ============================================================

    function renderLocationView() {
        var Renderer = getLocationViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Locations');
        }

        var week = AcademyUI.getDisplayWeek();

        var vm = AcademyAggregator.getLocationViewModel(
            _locationFilters,
            week,
            _selectedLocationId
        );

        if (!vm.selected) {
            _selectedLocationId = null;
        }

        return Renderer.renderHTML(vm);
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

    function bindEvents(container) {
        unbindEvents();
        _boundContainer = container;

        var clickHandler = function(e) { onDelegatedClick(e); };
        var changeHandler = function(e) { onDelegatedChange(e); };
        var inputHandler = function(e) { onDelegatedInput(e); };
        var keydownHandler = function(e) { onDelegatedKeydown(e); };

        container.addEventListener('click', clickHandler);
        container.addEventListener('change', changeHandler);
        container.addEventListener('input', inputHandler);
        container.addEventListener('keydown', keydownHandler);

        _boundHandlers = {
            click: clickHandler,
            change: changeHandler,
            input: inputHandler,
            keydown: keydownHandler
        };
    }

    function unbindEvents() {
        if (_boundContainer && _boundHandlers) {
            _boundContainer.removeEventListener('click', _boundHandlers.click);
            _boundContainer.removeEventListener('change', _boundHandlers.change);
            _boundContainer.removeEventListener('input', _boundHandlers.input);
            _boundContainer.removeEventListener('keydown', _boundHandlers.keydown);
        }
        _boundHandlers = null;
    }

    function cancelAllDebounceTimers() {
        if (_searchTimer) { clearTimeout(_searchTimer); _searchTimer = null; }
        if (_disciplineSearchTimer) {
            clearTimeout(_disciplineSearchTimer);
            _disciplineSearchTimer = null;
        }
        if (_locationSearchTimer) {
            clearTimeout(_locationSearchTimer);
            _locationSearchTimer = null;
        }
    }

    function wireCRUDModalsCallbacks() {
        var CRUD = getAcademyCRUDModals();
        if (CRUD && typeof CRUD.setOnChangeCallback === 'function') {
            CRUD.setOnChangeCallback(refreshView);
        }
        var TE = getAcademyTournamentEvents();
        if (TE && typeof TE.setOnChangeCallback === 'function') {
            TE.setOnChangeCallback(refreshView);
        }
    }

    // ============================================================
    // DELEGATED CLICK
    // ============================================================

    function onDelegatedClick(e) {
        var target = e.target;

        var viewBtn = target.closest('.academy-view-btn');
        if (viewBtn) {
            e.preventDefault();
            handleViewSwitch(viewBtn.dataset.view);
            return;
        }

        var charRow = target.closest(
            '.academy-character-row, .academy-student-row'
        );
        if (charRow) {
            e.preventDefault();
            handleCharacterSelect(charRow.dataset.characterId);
            return;
        }

        if (target.closest('#academy-add-class-btn')) {
            e.preventDefault();
            handleAddClass();
            return;
        }

        var discRow = target.closest('.academy-discipline-row');
        if (discRow) {
            e.preventDefault();
            if (discRow.dataset.disciplineId) {
                initializeDraftFromDiscipline(discRow.dataset.disciplineId);
                refreshView();
            }
            return;
        }

        var locRow = target.closest('.academy-location-row');
        if (locRow) {
            e.preventDefault();
            if (locRow.dataset.locationId) {
                _selectedLocationId =
                    (String(_selectedLocationId) ===
                        String(locRow.dataset.locationId))
                        ? null
                        : locRow.dataset.locationId;
                refreshView();
            }
            return;
        }

        var weeklyTeamRow = target.closest('.academy-weekly-team-row');
        if (weeklyTeamRow) {
            e.preventDefault();
            if (weeklyTeamRow.dataset.teamId) {
                _selectedWeeklyTeamId =
                    (String(_selectedWeeklyTeamId) ===
                        String(weeklyTeamRow.dataset.teamId))
                        ? null
                        : weeklyTeamRow.dataset.teamId;
                refreshView();
            }
            return;
        }

        var weeklyMemberRow = target.closest(
            '.academy-weekly-team-member-row'
        );
        if (weeklyMemberRow) {
            e.preventDefault();
            var memberId = weeklyMemberRow.dataset.characterId;
            if (memberId) {
                if (_selectedWeeklyTeamsClassId) {
                    AcademyUI.selectClass(_selectedWeeklyTeamsClassId);
                }
                AcademyUI.selectCharacter(memberId);
                AcademyUI.setSelectedView('people');
                refreshView();
            }
            return;
        }

        var rankingRow = target.closest('.academy-ranking-row');
        if (rankingRow) {
            e.preventDefault();
            var rankingCharId = rankingRow.dataset.characterId;
            if (rankingCharId) {
                var rankingClassId = _selectedRankingClassId ||
                    AcademyUI.getSelectedClassId();
                if (rankingClassId) {
                    AcademyUI.selectClass(rankingClassId);
                }
                AcademyUI.selectCharacter(rankingCharId);
                AcademyUI.setSelectedView('people');
                refreshView();
            }
            return;
        }

        var tabBtn = target.closest('.academy-character-tab-btn');
        if (tabBtn) {
            e.preventDefault();
            if (tabBtn.dataset.tab) {
                _activeCharacterTab = tabBtn.dataset.tab;
                refreshView();
            }
            return;
        }

        var actionEl = target.closest('[data-action]');
        if (actionEl) {
            var action = actionEl.dataset.action;
            if (action) {
                e.preventDefault();
                dispatchAction(action, actionEl);
                return;
            }
        }
    }

    // ============================================================
    // ACTION DISPATCH
    // ============================================================

    function dispatchAction(action, el) {
        var prefix = action.split('-')[0];
        switch (prefix) {
            case 'people':       return handlePeopleAction(action, el);
            case 'character':    return handleCharacterAction(action, el);
            case 'student':      return handlePeopleAction(action, el);
            case 'instructor':   return handlePeopleAction(action, el);
            case 'discipline':   return handleDisciplineAction(action, el);
            case 'location':     return handleLocationAction(action, el);
            case 'ranking':      return handleRankingAction(action, el);
            case 'weekly':       return handleWeeklyTeamsAction(action, el);
            case 'exam':         return handleExamAction(action, el);
            case 'apply':        return handleDisciplineEditorAction(action, el);
            case 'add':          return handleDisciplineEditorAction(action, el);
            case 'remove':       return handleDisciplineEditorAction(action, el);
            case 'reset':        return handleDisciplineEditorAction(action, el);
            case 'save':         return handleDisciplineEditorAction(action, el);
            case 'cancel':       return handleDisciplineEditorAction(action, el);
            case 'delete':       return handleDeleteDispatcher(action, el);
            case 'drop':         return handleCharacterAction(action, el);
            case 'enroll':       return handleCharacterAction(action, el);
            case 'leave':        return handleCharacterAction(action, el);
            case 'edit':         return handleEditDispatcher(action, el);
            case 'view':         return handleViewDispatcher(action, el);
            default:
                return;
        }
    }

    // ============================================================
    // ACTION HANDLERS - prefix-scoped
    // ============================================================

    function handlePeopleAction(action, el) {
        // Placeholder for People-scoped actions.
    }

    function handleCharacterAction(action, el) {
        switch (action) {
            case 'drop-out-character':
                handleDropOut(el.dataset.characterId);
                return;
            case 'character-remove-from-class':
                handleRemoveFromClass(
                    el.dataset.characterId,
                    el.dataset.classId
                );
                return;
            case 'enroll-discipline':
                handleEnrollDiscipline(el.dataset.characterId);
                return;
            case 'leave-discipline':
                handleLeaveDiscipline(
                    el.dataset.characterId,
                    el.dataset.disciplineId
                );
                return;
            case 'character-add-group-student':
                handleAddGroupStudent(el.dataset.groupKey);
                return;
            case 'character-remove-group-student':
                handleRemoveGroupStudent(
                    el.dataset.groupKey,
                    el.dataset.characterId
                );
                return;
            default:
                return;
        }
    }

    function handleExamAction(action, el) {
        var Events = getAcademyTournamentEvents();
        if (!Events) {
            notify('Exams module not loaded.', 'error');
            return;
        }

        if (action === 'exam-pair-add') {
            handlePairAdd(el);
            return;
        }
        if (action === 'exam-pair-remove') {
            handlePairRemove(el);
            return;
        }

        var examId = el.dataset.examId || null;

        switch (action) {
            case 'exam-create':
                Events.createExam(
                    _selectedExamClassId,
                    AcademyUI.getDisplayWeek()
                );
                return;
            case 'exam-delete':
                if (examId) { Events.deleteExam(examId); }
                return;
            case 'exam-reopen-exam':
                if (examId) { Events.reopenExam(examId); }
                return;
            case 'exam-toggle-pool-member':
                if (examId) {
                    Events.togglePoolMember(examId, el.dataset.poolId);
                }
                return;
            case 'exam-add-round':
                if (examId) { Events.addRound(examId); }
                return;
            case 'exam-remove-round':
                if (examId) {
                    Events.removeRound(examId, el.dataset.roundId);
                }
                return;
            case 'exam-reopen-round':
                if (examId) {
                    Events.reopenRound(examId, el.dataset.roundId);
                }
                return;
            case 'exam-auto-generate-round':
                if (examId) {
                    Events.autoGenerateRound(examId, el.dataset.roundId);
                }
                return;
            case 'exam-add-match':
                if (examId) {
                    Events.addMatchManual(examId, el.dataset.roundId);
                }
                return;
            case 'exam-edit-match':
                if (examId) {
                    Events.editMatch(
                        examId,
                        el.dataset.roundId,
                        el.dataset.matchId
                    );
                }
                return;
            case 'exam-complete-match':
                if (examId) {
                    Events.completeMatch(
                        examId,
                        el.dataset.roundId,
                        el.dataset.matchId
                    );
                }
                return;
            case 'exam-reopen-match':
                if (examId) {
                    Events.reopenMatch(
                        examId,
                        el.dataset.roundId,
                        el.dataset.matchId
                    );
                }
                return;
            case 'exam-remove-match':
                if (examId) {
                    Events.removeMatch(
                        examId,
                        el.dataset.roundId,
                        el.dataset.matchId
                    );
                }
                return;
            case 'exam-complete':
                if (examId) { Events.completeExam(examId); }
                return;
            default:
                return;
        }
    }

    function handlePairAdd(btn) {
        var form = btn.closest('form');
        if (!form) { return; }

        var slot1 = form.querySelector('[data-pair-slot="1"]');
        var slot2 = form.querySelector('[data-pair-slot="2"]');
        var slot3 = form.querySelector('[data-pair-slot="3"]');

        var v1 = slot1 ? slot1.value : '';
        var v2 = slot2 ? slot2.value : '';
        var v3 = slot3 ? slot3.value : '';

        if (!v1 || !v2) {
            notify('Please select at least 2 participants for the pair.', 'error');
            return;
        }

        if (v1 === v2 || (v3 && (v3 === v1 || v3 === v2))) {
            notify('Participants in a pair must be distinct.', 'error');
            return;
        }

        var group = [v1, v2];
        if (v3) { group.push(v3); }

        var list = form.querySelector('.at-pair-list');
        if (!list) { return; }

        var CQ = getCharacterQueries();
        var names = group.map(function(id) {
            if (CQ && CQ.getCharacterById && CQ.getDisplayName) {
                var c = CQ.getCharacterById(id);
                if (c) { return CQ.getDisplayName(c); }
            }
            return id;
        }).join(' + ');

        var row = document.createElement('div');
        row.className = 'at-pair-row';
        row.dataset.pair = JSON.stringify(group);
        row.innerHTML =
            '<span class="at-pair-row-text">' +
                escapeHtml(names) +
            '</span>' +
            '<button type="button" ' +
                'class="small danger at-pair-remove" ' +
                'data-action="exam-pair-remove">' +
                '\u2715' +
            '</button>';

        list.appendChild(row);

        if (slot1) { slot1.value = ''; }
        if (slot2) { slot2.value = ''; }
        if (slot3) { slot3.value = ''; }
    }

    function handlePairRemove(btn) {
        var row = btn.closest('.at-pair-row');
        if (!row) { return; }
        if (row.parentNode) {
            row.parentNode.removeChild(row);
        }
    }

    function handleDisciplineAction(action, el) {
        switch (action) {
            case 'discipline-apply-scheme-preset':
                handleApplySchemePreset(el);
                return;
            case 'discipline-add-band':
                handleAddBand();
                return;
            case 'discipline-remove-band':
                handleRemoveBand(el);
                return;
            case 'discipline-reset-assessment-weights':
                handleResetAssessmentWeights();
                return;
            case 'discipline-save':
                saveDisciplineDraft();
                return;
            case 'discipline-cancel':
                handleCancelDiscipline();
                return;
            case 'discipline-delete':
                handleDisciplineDelete(el.dataset.disciplineId);
                return;
            default:
                return;
        }
    }

    function handleDisciplineEditorAction(action, el) {
        var canonical = 'discipline-' + action.split('-').slice(1).join('-');
        return handleDisciplineAction(canonical, el);
    }

    function handleLocationAction(action, el) {
        var CRUD = getAcademyCRUDModals();
        switch (action) {
            case 'location-add':
                if (CRUD) { CRUD.openLocationForm(null); }
                return;
            case 'location-edit':
                if (CRUD) { CRUD.openLocationForm(el.dataset.locationId); }
                return;
            case 'location-delete':
                if (CRUD) { CRUD.openLocationDelete(el.dataset.locationId); }
                return;
            default:
                return;
        }
    }

    function handleRankingAction(action, el) {
        // Rankings view has no inline actions yet.
    }

    // ============================================================
    // WEEKLY TEAMS ACTION HANDLERS
    // ============================================================

    function handleWeeklyTeamsAction(action, el) {
        switch (action) {
            case 'weekly-teams-create-team':
                openWeeklyTeamForm(null);
                return;
            case 'weekly-teams-edit-team':
                openWeeklyTeamForm(el.dataset.teamId || null);
                return;
            case 'weekly-teams-delete-team':
                handleWeeklyTeamDelete(el.dataset.teamId);
                return;
            case 'weekly-teams-auto-distribute':
                openWeeklyTeamAutoDistributeModal();
                return;
            case 'weekly-teams-manage-members':
                openWeeklyTeamMembersModal(el.dataset.teamId);
                return;
            case 'weekly-teams-clear-rosters':
                handleWeeklyTeamsClearRosters();
                return;
            case 'weekly-teams-toggle-orphans':
                handleWeeklyTeamsToggleOrphans(el);
                return;
            case 'weekly-teams-assign-orphan-team':
                handleWeeklyTeamsAssignOrphanTeam(el);
                return;
            default:
                return;
        }
    }

    /**
     * Clear Rosters: remove every active member for the display week
     * across every academic team of the current class.
     *
     * WHAT IT DOES NOT DO:
     *   - Does not delete teams.
     *   - Does not touch team startPeriod / endPeriod.
     *   - Does not touch academy.weeklyTeams windows.
     *   - Does not touch past stints (leaveWeek < displayWeek).
     *   - Does not touch future stints (joinWeek > displayWeek).
     *
     * Teams stay scheduled and empty. History survives.
     */
    function handleWeeklyTeamsClearRosters() {
        if (!_selectedWeeklyTeamsClassId) {
            notify('Select a class first.', 'error');
            return;
        }

        var AWT = getAcademyWeeklyTeams();
        if (!AWT || typeof AWT.clearAllMembershipsForClass !== 'function') {
            notify('Weekly Teams module not available.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var rosters = {};
        if (typeof AWT.getWeeklyTeams === 'function') {
            rosters = AWT.getWeeklyTeams(
                _selectedWeeklyTeamsClassId,
                week
            ) || {};
        }

        var teamsActiveCount = 0;
        var membersActiveCount = 0;
        var teamIds = Object.keys(rosters);
        for (var i = 0; i < teamIds.length; i++) {
            teamsActiveCount++;
            var memberIds = rosters[teamIds[i]] || [];
            membersActiveCount += memberIds.length;
        }

        if (membersActiveCount === 0) {
            notify('No team members to clear for this week.', 'info');
            return;
        }

        var message =
            'Remove all ' + membersActiveCount +
            ' active team member' + (membersActiveCount === 1 ? '' : 's') +
            ' across ' + teamsActiveCount +
            ' team' + (teamsActiveCount === 1 ? '' : 's') +
            ' for week ' + week + '?\n\n' +
            'The teams themselves are NOT deleted. They stay scheduled ' +
            'and empty. Memberships that do not cover this week ' +
            '(past leaves, future joins) are kept.\n\n' +
            'This cannot be undone.';

        if (!confirm(message)) {
            return;
        }

        AWT.clearAllMembershipsForClass(_selectedWeeklyTeamsClassId, week)
            .then(function(result) {
                if (result && result.success) {
                    refreshView();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyView] clearAllMembershipsForClass failed:', err
                );
            });
    }

    /**
     * Clear Schedule: remove every weekly-team window record for the
     * current class. Persistent Team entities are untouched.
     *
     * NOT CURRENTLY WIRED TO ANY UI in v24. Retained because
     * Auto-Distribute's `clearExisting` path calls
     * AWT.clearClassWindows directly, and this function documents the
     * semantics of that operation.
     */
    function handleWeeklyTeamsClearWindows() {
        if (!_selectedWeeklyTeamsClassId) {
            notify('Select a class first.', 'error');
            return;
        }

        var AWT = getAcademyWeeklyTeams();
        if (!AWT || typeof AWT.clearClassWindows !== 'function') {
            notify('Weekly Teams module not available.', 'error');
            return;
        }

        var records = AWT.getAllTeamRecords(_selectedWeeklyTeamsClassId) || [];
        var count = records.length;

        if (count === 0) {
            notify('No teams are scheduled for this class.', 'info');
            return;
        }

        var message =
            'Clear the weekly schedule for this class?\n\n' +
            'This removes ' + count + ' scheduled team' +
            (count === 1 ? '' : 's') + ' from the Weekly Teams view.\n' +
            'The teams themselves are NOT deleted. Their rosters are ' +
            'preserved.\n\n' +
            'This cannot be undone.';

        if (!confirm(message)) {
            return;
        }

        AWT.clearClassWindows(_selectedWeeklyTeamsClassId)
            .then(function(result) {
                if (result && result.success) {
                    refreshView();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyView] clearClassWindows failed:', err
                );
            });
    }

    /**
     * Toggle the expanded state of the orphan-teams section. Pure UI.
     */
    function handleWeeklyTeamsToggleOrphans(el) {
        var section = el.closest('.academy-weekly-teams-orphan-section');
        if (!section) return;
        var list = section.querySelector('.academy-orphan-list');
        if (!list) return;
        var icon = section.querySelector('.academy-orphan-toggle-icon');
        var expanded = section.getAttribute('data-expanded') === 'true';
        if (expanded) {
            list.style.display = 'none';
            section.setAttribute('data-expanded', 'false');
            if (icon) icon.textContent = '\u25b8';
        } else {
            list.style.display = '';
            section.setAttribute('data-expanded', 'true');
            if (icon) icon.textContent = '\u25be';
        }
    }

    function handleWeeklyTeamsAssignOrphanTeam(el) {
        var teamId = el.dataset.teamId;
        if (!teamId) {
            notify('Team ID missing.', 'error');
            return;
        }

        var row = el.closest('.academy-orphan-row');
        if (!row) return;

        var select = row.querySelector('.academy-orphan-class-select');
        var classId = select ? select.value : '';

        if (!classId) {
            notify('Select a class to assign this team to.', 'error');
            return;
        }

        var AWT = getAcademyWeeklyTeams();
        if (!AWT || typeof AWT.assignTeamToClass !== 'function') {
            notify('Weekly Teams module not available.', 'error');
            return;
        }

        AWT.assignTeamToClass(classId, teamId)
            .then(function(result) {
                if (result && result.success) {
                    refreshView();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyView] assignTeamToClass failed:', err
                );
            });
    }

    function openWeeklyTeamForm(teamId) {
        var View = getWeeklyTeamsViewModule();
        var TeamCore = getTeamCore();
        var TeamQ = getTeamQueries();
        var Modal = getModal();

        if (!View || typeof View.buildTeamModalHTML !== 'function') {
            notify('Weekly Teams view not available.', 'error');
            return;
        }
        if (!TeamCore || typeof TeamCore.createTeam !== 'function' ||
            typeof TeamCore.updateTeam !== 'function') {
            notify('Team module not available.', 'error');
            return;
        }
        if (!Modal || typeof Modal.createModal !== 'function') {
            notify('Modal module not available.', 'error');
            return;
        }
        if (!_selectedWeeklyTeamsClassId) {
            notify('Select a class first.', 'error');
            return;
        }
        if (!ensureTeamCoreConfigured()) {
            notify(
                'Character module not available. Cannot save team.',
                'error'
            );
            return;
        }

        var isEdit = !!teamId;
        var team = null;

        if (isEdit) {
            if (!TeamQ || typeof TeamQ.getTeamById !== 'function') {
                notify('Team queries not available.', 'error');
                return;
            }
            team = TeamQ.getTeamById(teamId);
            if (!team) {
                notify('Team not found.', 'error');
                return;
            }
        }

        var week = AcademyUI.getDisplayWeek();
        var classId = team ? team.classId : _selectedWeeklyTeamsClassId;

        var className = 'Unnamed Class';
        var classes = AcademyAggregator.getClassListViewModel() || [];
        for (var i = 0; i < classes.length; i++) {
            if (String(classes[i].id) === String(classId)) {
                className = classes[i].name;
                break;
            }
        }

        var html = View.buildTeamModalHTML({
            team: team,
            classId: classId,
            className: className,
            week: week
        });

        var modal = Modal.createModal('academy-weekly-team-modal');
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = html;
        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var close = function() {
            try {
                if (typeof Modal.closeModal === 'function') {
                    Modal.closeModal(modal);
                } else if (typeof Modal.hideModal === 'function') {
                    Modal.hideModal(modal);
                }
            } catch (e) {
                console.warn('[AcademyView] weekly team modal close failed:', e);
            }
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        };

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) { closeBtn.addEventListener('click', close); }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) { cancelBtn.addEventListener('click', close); }

        modal.addEventListener('click', function(ev) {
            if (ev.target === modal) { close(); }
        });

        var form = modal.querySelector('#weekly-teams-team-form');
        if (!form) { return; }

        form.addEventListener('submit', function(ev) {
            ev.preventDefault();

            var payload = (typeof View.collectTeamForm === 'function')
                ? View.collectTeamForm(form)
                : null;

            if (!payload || !payload.name) {
                notify('Team name is required.', 'error');
                return;
            }

            var promise;

            if (isEdit && team) {
                promise = TeamCore.updateTeam(team.id, {
                    name: payload.name,
                    teamNumber: payload.teamNumber || '',
                    startPeriod: payload.startPeriod || String(week),
                    endPeriod: payload.endPeriod || ''
                });
            } else {
                promise = TeamCore.createTeam({
                    name: payload.name,
                    type: 'academic',
                    classId: _selectedWeeklyTeamsClassId,
                    startPeriod: payload.startPeriod || String(week),
                    endPeriod: payload.endPeriod || '',
                    teamNumber: payload.teamNumber || '',
                    status: 'active'
                });
            }

            promise.then(function(result) {
                if (!result || !result.success) {
                    return;
                }

                var AWT = getAcademyWeeklyTeams();

                if (!isEdit) {
                    var createdId = result.data && result.data.id
                        ? String(result.data.id)
                        : (result.data && result.data.team && result.data.team.id
                            ? String(result.data.team.id)
                            : null);

                    if (createdId && AWT) {
                        var createStart = payload.startPeriod || String(week);
                        var createEnd = payload.endPeriod || null;

                        if (typeof AWT.setWindow === 'function') {
                            AWT.setWindow(
                                _selectedWeeklyTeamsClassId,
                                createdId,
                                createStart,
                                createEnd
                            ).then(function() {
                                close();
                                refreshView();
                            }).catch(function(err) {
                                console.warn(
                                    '[AcademyView] setWindow for new team failed:',
                                    err
                                );
                                close();
                                refreshView();
                            });
                            return;
                        }

                        if (typeof AWT.ensureWindow === 'function') {
                            AWT.ensureWindow(
                                _selectedWeeklyTeamsClassId,
                                createdId,
                                week
                            ).then(function() {
                                close();
                                refreshView();
                            }).catch(function(err) {
                                console.warn(
                                    '[AcademyView] ensureWindow for new team failed:',
                                    err
                                );
                                close();
                                refreshView();
                            });
                            return;
                        }
                    }

                    close();
                    refreshView();
                    return;
                }

                if (isEdit && team && AWT &&
                    typeof AWT.setWindow === 'function') {
                    var editClassId = team.classId || _selectedWeeklyTeamsClassId;
                    var editStart = payload.startPeriod || team.startPeriod || String(week);
                    var editEnd = payload.endPeriod || null;

                    AWT.setWindow(
                        editClassId,
                        team.id,
                        editStart,
                        editEnd
                    ).then(function() {
                        close();
                        refreshView();
                    }).catch(function(err) {
                        console.warn(
                            '[AcademyView] setWindow for edited team failed:',
                            err
                        );
                        close();
                        refreshView();
                    });
                    return;
                }

                close();
                refreshView();
            }).catch(function(err) {
                console.warn('[AcademyView] save weekly team failed:', err);
                notify('Failed to save team.', 'error');
            });
        });
    }

    function handleWeeklyTeamDelete(teamId) {
        if (!teamId) { return; }

        var TeamCore = getTeamCore();
        if (!TeamCore || typeof TeamCore.deleteTeam !== 'function') {
            notify('Team module not available.', 'error');
            return;
        }

        var name = 'this team';
        var TeamQ = getTeamQueries();
        if (TeamQ && typeof TeamQ.getTeamById === 'function') {
            var team = TeamQ.getTeamById(teamId);
            if (team && team.name) {
                name = '"' + team.name + '"';
            }
        }

        if (!confirm('Delete ' + name + '?')) {
            return;
        }

        TeamCore.deleteTeam(teamId).then(function(result) {
            if (result && result.success) {
                if (String(_selectedWeeklyTeamId) === String(teamId)) {
                    _selectedWeeklyTeamId = null;
                }
                refreshView();
            }
        }).catch(function(err) {
            console.warn('[AcademyView] deleteTeam failed:', err);
            notify('Failed to delete team.', 'error');
        });
    }

    function openWeeklyTeamMembersModal(teamId) {
        if (!isNonEmptyString(teamId)) { return; }

        var MembersManager = getAcademyWeeklyTeamsMembers();
        var Modal = getModal();

        if (!MembersManager ||
            typeof MembersManager.openMemberManager !== 'function') {
            notify('Weekly team member manager is not available.', 'error');
            return;
        }
        if (!Modal || typeof Modal.createModal !== 'function') {
            notify('Modal module not available.', 'error');
            return;
        }
        if (!_selectedWeeklyTeamsClassId) {
            notify('Select a class first.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var teamName = 'Team';
        var TeamQ = getTeamQueries();
        if (TeamQ && typeof TeamQ.getTeamById === 'function') {
            var team = TeamQ.getTeamById(teamId);
            if (team && team.name) {
                teamName = team.name;
            }
        }

        var modal = Modal.createModal('academy-weekly-team-members-modal');
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var close = function() {
            try {
                if (typeof Modal.closeModal === 'function') {
                    Modal.closeModal(modal);
                } else if (typeof Modal.hideModal === 'function') {
                    Modal.hideModal(modal);
                }
            } catch (e) {
                console.warn(
                    '[AcademyView] member modal close failed:', e
                );
            }
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
            refreshView();
        };

        MembersManager.openMemberManager(
            contentEl,
            _selectedWeeklyTeamsClassId,
            week,
            teamId,
            {
                teamName: teamName,
                onClose: close,
                onChange: function() {
                    refreshView();
                }
            }
        );
    }

    function openWeeklyTeamAutoDistributeModal() {
        var View = getWeeklyTeamsViewModule();
        var Modal = getModal();

        if (!View || typeof View.buildAutoDistributeModalHTML !== 'function') {
            notify('Weekly Teams view not available.', 'error');
            return;
        }
        if (!Modal || typeof Modal.createModal !== 'function') {
            notify('Modal module not available.', 'error');
            return;
        }
        if (!_selectedWeeklyTeamsClassId) {
            notify('Select a class first.', 'error');
            return;
        }
        if (!ensureTeamCoreConfigured()) {
            notify(
                'Character module not available. Cannot auto-distribute.',
                'error'
            );
            return;
        }

        var TeamCore = getTeamCore();
        if (!TeamCore || typeof TeamCore.createTeam !== 'function' ||
            typeof TeamCore.addMember !== 'function') {
            notify('Team module not available.', 'error');
            return;
        }

        var AWT = getAcademyWeeklyTeams();
        if (!AWT || typeof AWT.addMember !== 'function' ||
            typeof AWT.ensureWindow !== 'function') {
            notify('Weekly teams store is not available.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        var className = 'Unnamed Class';
        var classes = AcademyAggregator.getClassListViewModel() || [];
        for (var i = 0; i < classes.length; i++) {
            if (String(classes[i].id) === String(_selectedWeeklyTeamsClassId)) {
                className = classes[i].name;
                break;
            }
        }

        // Eligible count excludes eliminated and deceased, matching
        // the filter applied inside runAutoDistributeCore.
        var rawRoster = AcademyAggregator.getClassStudentsViewModel(
            _selectedWeeklyTeamsClassId,
            week
        ) || [];
        var eligibleCount = 0;
        for (var r = 0; r < rawRoster.length; r++) {
            var s = rawRoster[r];
            if (!s) continue;
            if (s.deceased === true) continue;
            if (s.eliminated === true) continue;
            eligibleCount++;
        }

        var html = View.buildAutoDistributeModalHTML({
            classId: _selectedWeeklyTeamsClassId,
            className: className,
            week: week,
            eligibleCount: eligibleCount,
            canDistribute: eligibleCount >= 2
        });

        var modal = Modal.createModal('academy-weekly-team-auto-distribute-modal');
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = html;
        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var close = function() {
            try {
                if (typeof Modal.closeModal === 'function') {
                    Modal.closeModal(modal);
                } else if (typeof Modal.hideModal === 'function') {
                    Modal.hideModal(modal);
                }
            } catch (e) {
                console.warn(
                    '[AcademyView] auto-distribute modal close failed:', e
                );
            }
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        };

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) { closeBtn.addEventListener('click', close); }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) { cancelBtn.addEventListener('click', close); }

        modal.addEventListener('click', function(ev) {
            if (ev.target === modal) { close(); }
        });

        var form = modal.querySelector('#weekly-teams-auto-distribute-form');
        if (!form) { return; }

        form.addEventListener('submit', function(ev) {
            ev.preventDefault();

            var payload = (typeof View.collectAutoDistributeForm === 'function')
                ? View.collectAutoDistributeForm(form)
                : null;

            if (!payload) {
                notify('Could not read distribution settings.', 'error');
                return;
            }

            var groupSize = parseInt(payload.groupSize, 10);
            if (isNaN(groupSize) || groupSize < 2) {
                notify('Group size must be at least 2.', 'error');
                return;
            }

            runAutoDistribute({
                classId: _selectedWeeklyTeamsClassId,
                className: className,
                week: week,
                groupSize: groupSize,
                namePrefix: payload.namePrefix,
                clearExisting: payload.clearExisting === true
            }).then(function(result) {
                if (result && result.success) {
                    close();
                    refreshView();
                }
            }).catch(function(err) {
                console.warn('[AcademyView] Auto-Distribute failed:', err);
                notify('Auto-Distribute failed.', 'error');
            });
        });
    }

    function runAutoDistribute(ctx) {
        var TeamCore = getTeamCore();
        var TeamQ = getTeamQueries();
        var TeamConstants = getTeamConstants();
        var AWT = getAcademyWeeklyTeams();

        if (!TeamCore || !TeamQ || !TeamConstants || !AWT) {
            return Promise.resolve({
                success: false,
                message: 'Required modules are not available.'
            });
        }

        var groupSize = parseInt(ctx.groupSize, 10);
        if (isNaN(groupSize) || groupSize < 2) {
            notify('Group size must be at least 2.', 'error');
            return Promise.resolve({
                success: false,
                message: 'Invalid group size.'
            });
        }

        var preChain = Promise.resolve();
        if (ctx.clearExisting === true &&
            typeof AWT.clearClassWindows === 'function') {
            preChain = AWT.clearClassWindows(ctx.classId).then(function() {
                return null;
            }).catch(function(err) {
                console.warn(
                    '[AcademyView] clearClassWindows failed during ' +
                    'Auto-Distribute:', err
                );
                return null;
            });
        }

        return preChain.then(function() {
            return runAutoDistributeCore(
                ctx, groupSize, TeamCore, TeamQ, TeamConstants, AWT
            );
        });
    }

    function runAutoDistributeCore(ctx, groupSize, TeamCore, TeamQ, TeamConstants, AWT) {
        // ---- Roster (filtered) ----
        //
        // BUG-R2: Exclude eliminated and deceased students from the
        // distribution pool. Elimination is week-scoped: a student
        // eliminated at exactly the display week is still eligible
        // (E < W rule).
        var rawRoster = AcademyAggregator.getClassStudentsViewModel(
            ctx.classId,
            ctx.week
        ) || [];

        var roster = rawRoster.filter(function(s) {
            if (!s) return false;
            if (s.deceased === true) return false;
            if (s.eliminated === true) return false;
            return true;
        });

        if (roster.length === 0) {
            notify(
                'The class has no eligible students for this week.',
                'info'
            );
            return Promise.resolve({
                success: false,
                message: 'No eligible students.'
            });
        }

        var allTeams = TeamQ.getTeamsByClass(ctx.classId, 'operational') || [];
        var activeThisWeek = [];
        for (var i = 0; i < allTeams.length; i++) {
            var t = allTeams[i];
            if (!t) { continue; }
            if (TeamConstants.normalizeTeamType(t.type) !== 'academic') {
                continue;
            }
            if (!TeamQ.isTeamActiveAtPeriod(t, ctx.week)) {
                continue;
            }
            activeThisWeek.push(t);
        }

        var assignedIds = Object.create(null);
        var teamCounts = Object.create(null);
        for (var a = 0; a < activeThisWeek.length; a++) {
            var team = activeThisWeek[a];
            var activeMembers = TeamQ.getActiveTeamMembers(team, ctx.week);
            teamCounts[String(team.id)] = activeMembers.length;
            for (var b = 0; b < activeMembers.length; b++) {
                var m = activeMembers[b];
                if (m && m.characterId) {
                    assignedIds[String(m.characterId)] = true;
                }
            }
        }

        var unassigned = [];
        for (var r = 0; r < roster.length; r++) {
            var student = roster[r];
            if (!student || !student.id) { continue; }
            if (assignedIds[String(student.id)]) { continue; }
            unassigned.push(student);
        }
        unassigned.sort(function(a2, b2) {
            return String(a2.name || '').localeCompare(String(b2.name || ''));
        });

        if (unassigned.length === 0) {
            notify(
                'All eligible students are already assigned to a team ' +
                'this week.',
                'info'
            );
            return Promise.resolve({
                success: false,
                message: 'No unassigned students.'
            });
        }

        var rankedExisting = activeThisWeek.slice().sort(function(a2, b2) {
            var ca = teamCounts[String(a2.id)] || 0;
            var cb = teamCounts[String(b2.id)] || 0;
            if (ca !== cb) { return ca - cb; }
            return String(a2.name || '').localeCompare(String(b2.name || ''));
        });

        var namePrefix = ctx.namePrefix || 'Team ';
        var highestExistingNumber = findHighestTeamNumber(activeThisWeek, namePrefix);
        var nextNumber = highestExistingNumber + 1;

        var existingPlans = [];
        for (var e = 0; e < rankedExisting.length; e++) {
            existingPlans.push({
                type: 'existing',
                teamId: String(rankedExisting[e].id),
                teamName: rankedExisting[e].name || 'Unnamed Team',
                charIds: []
            });
        }
        var newPlans = [];

        for (var u = 0; u < unassigned.length; u++) {
            var studentId = String(unassigned[u].id);

            var bestPlan = null;
            var bestCount = Infinity;
            for (var p = 0; p < existingPlans.length; p++) {
                var plan = existingPlans[p];
                var existingCount = teamCounts[plan.teamId] || 0;
                var plannedCount = plan.charIds.length;
                var total = existingCount + plannedCount;
                if (total >= groupSize) { continue; }
                if (total < bestCount) {
                    bestCount = total;
                    bestPlan = plan;
                }
            }

            if (bestPlan) {
                bestPlan.charIds.push(studentId);
                continue;
            }

            var newName = namePrefix + nextNumber;
            nextNumber++;
            var newPlan = {
                type: 'create',
                teamName: newName,
                charIds: [studentId]
            };
            newPlans.push(newPlan);
        }

        var failed = false;
        var failureMessage = null;
        var addedToExisting = 0;
        var createdNewTeams = 0;
        var chain = Promise.resolve();

        existingPlans.forEach(function(plan) {
            if (plan.charIds.length === 0) { return; }
            plan.charIds.forEach(function(charId) {
                chain = chain.then(function() {
                    if (failed) { return; }
                    return AWT.addMember(
                        ctx.classId,
                        plan.teamId,
                        charId,
                        ctx.week
                    ).then(function(res) {
                        if (!res || !res.success) {
                            failed = true;
                            failureMessage =
                                'Could not add a student to ' + plan.teamName + ': ' +
                                (res && res.message ? res.message : 'unknown error');
                            console.warn(
                                '[AcademyView] addMember rejected:',
                                res && res.message
                            );
                            return;
                        }
                        addedToExisting++;
                    });
                });
            });
        });

        newPlans.forEach(function(plan) {
            chain = chain.then(function() {
                if (failed) { return; }
                return TeamCore.createTeam({
                    name: plan.teamName,
                    type: 'academic',
                    classId: ctx.classId,
                    startPeriod: String(ctx.week),
                    endPeriod: '',
                    status: 'active'
                }).then(function(res) {
                    if (!res || !res.success) {
                        failed = true;
                        failureMessage =
                            'Could not create team ' + plan.teamName + ': ' +
                            (res && res.message ? res.message : 'unknown error');
                        console.warn(
                            '[AcademyView] createTeam rejected:',
                            res && res.message
                        );
                        return;
                    }

                    var newTeamId = res.data && res.data.id
                        ? String(res.data.id)
                        : (res.data && res.data.team && res.data.team.id
                            ? String(res.data.team.id)
                            : null);

                    if (!newTeamId) {
                        failed = true;
                        failureMessage =
                            'Newly-created team ' + plan.teamName + ' has no id.';
                        return;
                    }

                    createdNewTeams++;

                    var windowPromise = (typeof AWT.setWindow === 'function')
                        ? AWT.setWindow(
                            ctx.classId, newTeamId, ctx.week, null
                        )
                        : AWT.ensureWindow(ctx.classId, newTeamId, ctx.week);

                    return windowPromise.then(function() {
                        var memberChain = Promise.resolve();
                        plan.charIds.forEach(function(charId) {
                            memberChain = memberChain.then(function() {
                                if (failed) { return; }
                                return AWT.addMember(
                                    ctx.classId,
                                    newTeamId,
                                    charId,
                                    ctx.week
                                ).then(function(inner) {
                                    if (!inner || !inner.success) {
                                        failed = true;
                                        failureMessage =
                                            'Could not add a student to ' +
                                            plan.teamName + ': ' +
                                            (inner && inner.message
                                                ? inner.message
                                                : 'unknown error');
                                        console.warn(
                                            '[AcademyView] addMember rejected:',
                                            inner && inner.message
                                        );
                                    }
                                });
                            });
                        });
                        return memberChain;
                    });
                });
            });
        });

        return chain.then(function() {
            if (failed) {
                notify(failureMessage || 'Auto-Distribute failed.', 'error');
                return {
                    success: false,
                    message: failureMessage
                };
            }

            var existingCount = existingPlans.filter(function(en) {
                return en.charIds.length > 0;
            }).length;
            var newCount = newPlans.length;
            var totalStudents = addedToExisting;
            for (var n = 0; n < newPlans.length; n++) {
                totalStudents += newPlans[n].charIds.length;
            }

            var parts = [];
            parts.push('Placed ' + totalStudents +
                ' student' + (totalStudents === 1 ? '' : 's'));
            if (existingCount > 0) {
                parts.push('into ' + existingCount +
                    ' existing team' + (existingCount === 1 ? '' : 's'));
            }
            if (newCount > 0) {
                parts.push('and ' + newCount +
                    ' new team' + (newCount === 1 ? '' : 's'));
            }
            notify(parts.join(' ') + '.', 'success');

            return {
                success: true,
                data: {
                    existingTeamsFilled: existingCount,
                    newTeamsCreated: newCount,
                    studentsPlaced: totalStudents
                }
            };
        });
    }

    function findHighestTeamNumber(teams, prefix) {
        var highest = 0;
        if (!Array.isArray(teams) || !isNonEmptyString(prefix)) {
            return highest;
        }

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !isNonEmptyString(team.name)) { continue; }
            var name = team.name;
            if (name.indexOf(prefix) !== 0) { continue; }
            var suffix = name.substring(prefix.length).trim();
            if (!/^\d+$/.test(suffix)) { continue; }
            var num = parseInt(suffix, 10);
            if (!isNaN(num) && num > highest) {
                highest = num;
            }
        }

        return highest;
    }

    // ============================================================
    // DISPATCHERS - delete / edit / view
    // ============================================================

    function handleDeleteDispatcher(action, el) {
        if (action === 'delete-class') {
            handleClassAction('delete-class', el.dataset.classId);
            return;
        }
        if (action === 'delete-discipline') {
            handleDisciplineDelete(el.dataset.disciplineId);
            return;
        }
        if (action === 'delete-location') {
            handleLocationAction('location-delete', el);
            return;
        }
    }

    function handleEditDispatcher(action, el) {
        if (action === 'edit-class-add-character') {
            handleClassAction('add-character', el.dataset.classId);
            return;
        }
        if (action === 'edit-class') {
            handleClassAction('edit-class', el.dataset.classId);
            return;
        }
        if (action === 'edit-social-score') {
            var CRUD = getAcademyCRUDModals();
            if (CRUD && typeof CRUD.openSocialScoreForm === 'function') {
                CRUD.openSocialScoreForm(
                    el.dataset.characterId,
                    AcademyUI.getSelectedClassId(),
                    AcademyUI.getDisplayWeek()
                );
            }
            return;
        }
        if (action === 'edit-location') {
            handleLocationAction('location-edit', el);
            return;
        }
    }

    function handleViewDispatcher(action, el) {
        if (action === 'view-full-character') {
            // Removed: the character detail panel is the full view.
        }
    }

    // ============================================================
    // DELEGATED CHANGE
    // ============================================================

    function onDelegatedChange(e) {
        var target = e.target;

        if (target.id === 'academy-character-mode-checkbox') {
            var charId = AcademyUI.getSelectedCharacterId();
            if (charId) {
                var newMode = target.checked ? 'instructor' : 'student';
                AcademyUI.setCharacterMode(charId, newMode);
                if (newMode === 'instructor' &&
                    (_activeCharacterTab === 'grades' ||
                        _activeCharacterTab === 'teams')) {
                    _activeCharacterTab = 'main';
                }
                refreshView();
            }
            return;
        }

        if (target.dataset && target.dataset.disciplineField) {
            handleDisciplineFieldChange(target);
            return;
        }

        if (target.dataset && target.dataset.bandIndex !== undefined &&
            target.dataset.bandField === 'label') {
            handleBandFieldChange(target);
            return;
        }

        if (target.id === 'academy-class-select') {
            handleClassSelect(target.value);
            return;
        }

        if (target.id === 'academy-week-input' ||
            target.id === 'at-week-input' ||
            target.id === 'academy-ranking-week-input' ||
            target.id === 'academy-weekly-teams-week-input') {
            commitDisplayWeek(target.value);
            return;
        }

        if (target.id === 'academy-people-role') {
            AcademyUI.setPeopleRole(target.value);
            refreshView();
            return;
        }
        if (target.id === 'academy-people-status') {
            AcademyUI.setPeopleStatus(target.value);
            refreshView();
            return;
        }

        if (target.id === 'at-class-select') {
            _selectedExamClassId = target.value || null;
            refreshView();
            return;
        }

        if (target.id === 'academy-ranking-class-select') {
            _selectedRankingClassId = target.value || null;
            refreshView();
            return;
        }

        if (target.id === 'academy-weekly-teams-class-select') {
            _selectedWeeklyTeamsClassId = target.value || null;
            _selectedWeeklyTeamId = null;
            refreshView();
            return;
        }

        if (target.id === 'academy-discipline-type-filter') {
            _disciplineFilters.type = target.value;
            refreshView();
            return;
        }

        if (target.id === 'academy-location-type-filter') {
            _locationFilters.type = target.value;
            refreshView();
            return;
        }
    }

    // ============================================================
    // DELEGATED INPUT
    // ============================================================

    function onDelegatedInput(e) {
        var target = e.target;

        if (target.dataset && target.dataset.assessmentWeightType) {
            handleAssessmentWeightChange(target);
            return;
        }

        if (target.dataset && target.dataset.disciplineField) {
            handleDisciplineFieldChange(target);
            return;
        }

        if (target.dataset && target.dataset.bandIndex !== undefined &&
            target.dataset.bandField) {
            handleBandFieldChange(target);
            return;
        }

        if (target.id === 'academy-people-search') {
            debouncePeopleSearch(target.value);
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

    function onDelegatedKeydown(e) {
        var target = e.target;
        if (e.key !== 'Enter') { return; }

        if (target.id === 'academy-week-input' ||
            target.id === 'at-week-input' ||
            target.id === 'academy-ranking-week-input' ||
            target.id === 'academy-weekly-teams-week-input') {
            e.preventDefault();
            commitDisplayWeek(target.value);
            return;
        }
    }

    // ============================================================
    // VIEW SWITCHER
    // ============================================================

    function handleViewSwitch(viewId) {
        if (!viewId) { return; }
        if (VALID_VIEW_IDS.indexOf(viewId) === -1) { return; }
        if (viewId !== 'disciplines') {
            clearDraft();
        }
        if (AcademyUI.setSelectedView(viewId)) {
            refreshView();
        }
    }

    // ============================================================
    // CLASS SELECTION
    // ============================================================

    function handleClassSelect(classId) {
        if (!classId) {
            AcademyUI.selectClass(null);
            refreshView();
            return;
        }

        var prevCharId = AcademyUI.getSelectedCharacterId();
        AcademyUI.selectClass(classId);

        if (prevCharId) {
            var week = AcademyUI.getDisplayWeek();
            var classVM = AcademyAggregator.getClassViewModel(
                classId, week
            );
            if (classVM && isCharacterInClassVM(prevCharId, classVM)) {
                AcademyUI.selectCharacter(prevCharId);
            }
        }

        refreshView();
    }

    function isCharacterInClassVM(charId, classVM) {
        if (!charId || !classVM) { return false; }
        var target = String(charId);

        if (classVM.instructorId &&
            String(classVM.instructorId) === target) {
            return true;
        }

        var week = AcademyUI.getDisplayWeek();
        var students = AcademyAggregator.getClassStudentsViewModel(
            classVM.id,
            week
        ) || [];
        for (var i = 0; i < students.length; i++) {
            if (students[i] && String(students[i].id) === target) {
                return true;
            }
        }
        return false;
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

    function handleAddClass() {
        var CRUD = getAcademyCRUDModals();
        if (CRUD && typeof CRUD.openClassForm === 'function') {
            CRUD.openClassForm(null);
        } else {
            notify('CRUD module not available.', 'error');
        }
    }

    function handleClassAction(action, classId) {
        var CRUD = getAcademyCRUDModals();
        if (!CRUD) {
            notify('CRUD module not available.', 'error');
            return;
        }
        switch (action) {
            case 'add-character':
                if (typeof CRUD.openAddCharacterToClass === 'function') {
                    CRUD.openAddCharacterToClass(classId);
                }
                return;
            case 'edit-class':
                if (typeof CRUD.openClassForm === 'function') {
                    CRUD.openClassForm(classId);
                }
                return;
            case 'delete-class':
                if (typeof CRUD.openClassDelete === 'function') {
                    CRUD.openClassDelete(classId);
                }
                return;
            default:
                return;
        }
    }

    // ============================================================
    // WEEK COMMIT
    // ============================================================

    function commitDisplayWeek(value) {
        var accepted = AcademyUI.setDisplayWeek(value);
        if (accepted) {
            refreshView();
        }
    }

    // ============================================================
    // DISCIPLINE EDITOR - field changes
    // ============================================================

    function handleDisciplineFieldChange(inputEl) {
        if (!_disciplineDraft) { return; }

        var field = inputEl.dataset.disciplineField;
        if (!field) { return; }

        switch (field) {
            case 'name':
                _disciplineDraft.name = inputEl.value;
                return;
            case 'type':
                _disciplineDraft.type = inputEl.value;
                return;
            case 'startWeek':
                _disciplineDraft.startWeek = inputEl.value;
                return;
            case 'endWeek':
                _disciplineDraft.endWeek = inputEl.value;
                return;
            case 'weeklyHours':
                _disciplineDraft.weeklyHours = inputEl.value;
                return;
            case 'weight':
                _disciplineDraft.weight = inputEl.value;
                return;
            case 'instructors': {
                var selected = [];
                for (var i = 0; i < inputEl.options.length; i++) {
                    if (inputEl.options[i].selected &&
                        inputEl.options[i].value) {
                        selected.push(inputEl.options[i].value);
                    }
                }
                _disciplineDraft.instructorIds = selected;
                return;
            }
            case 'schemeLabel':
                _disciplineDraft.gradeScheme.label = inputEl.value;
                return;
            case 'schemePresetId':
                return;
            default:
                return;
        }
    }

    function handleBandFieldChange(inputEl) {
        if (!_disciplineDraft) { return; }

        var idx = parseInt(inputEl.dataset.bandIndex, 10);
        var field = inputEl.dataset.bandField;
        if (isNaN(idx) || !field) { return; }

        var bands = _disciplineDraft.gradeScheme.bands;
        if (!bands || idx < 0 || idx >= bands.length) { return; }

        if (field === 'label') {
            bands[idx].label = inputEl.value;
        } else if (field === 'minPercent') {
            bands[idx].minPercent = inputEl.value;
        }

        updateDisciplinePreviewInPlace();
    }

    function handleAssessmentWeightChange(inputEl) {
        if (!_disciplineDraft) { return; }

        var type = inputEl.dataset.assessmentWeightType;
        if (!type) { return; }

        if (!_disciplineDraft.assessmentWeights ||
            typeof _disciplineDraft.assessmentWeights !== 'object') {
            _disciplineDraft.assessmentWeights = {};
        }

        _disciplineDraft.assessmentWeights[type] = inputEl.value;
    }

    function updateDisciplinePreviewInPlace() {
        var GradeSchemes = window.AcademyGradeSchemes;
        if (!GradeSchemes || !_disciplineDraft) { return; }

        var previewEl = document.querySelector(
            '.academy-discipline-scheme-preview-text'
        );
        if (!previewEl) { return; }

        try {
            previewEl.textContent =
                GradeSchemes.getRangeLabel(_disciplineDraft.gradeScheme) || '';
        } catch (e) {
            // Ignore preview failures mid-edit.
        }
    }

    // ============================================================
    // DISCIPLINE EDITOR - actions
    // ============================================================

    function handleApplySchemePreset(el) {
        var GradeSchemes = window.AcademyGradeSchemes;
        if (!_disciplineDraft || !GradeSchemes) { return; }

        var presetSelect = document.querySelector(
            '[data-discipline-field="schemePresetId"]'
        );
        var presetId = presetSelect ? presetSelect.value : 'numeric';

        if (presetId === 'custom') {
            _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme({
                id: 'custom',
                label: _disciplineDraft.gradeScheme.label ||
                    'Custom Scheme',
                bands: _disciplineDraft.gradeScheme.bands || []
            });
        } else {
            var preset = GradeSchemes.getPreset(presetId);
            if (preset) {
                _disciplineDraft.gradeScheme =
                    GradeSchemes.normalizeScheme(preset);
            }
        }

        refreshView();
    }

    function handleAddBand() {
        if (!_disciplineDraft) { return; }
        var GradeSchemes = window.AcademyGradeSchemes;
        var bands = _disciplineDraft.gradeScheme.bands || [];
        var maxBands = (GradeSchemes && GradeSchemes.MAX_BANDS)
            ? GradeSchemes.MAX_BANDS
            : 26;
        if (bands.length >= maxBands) {
            notify('Too many bands.', 'error');
            return;
        }
        bands.push({ label: '', minPercent: 0 });
        if (GradeSchemes) {
            _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme({
                id: _disciplineDraft.gradeScheme.id,
                label: _disciplineDraft.gradeScheme.label,
                bands: bands
            });
        }
        refreshView();
    }

    function handleRemoveBand(el) {
        if (!_disciplineDraft) { return; }
        var GradeSchemes = window.AcademyGradeSchemes;
        var idx = parseInt(el.dataset.bandIndex, 10);
        if (isNaN(idx)) { return; }

        var currentBands = _disciplineDraft.gradeScheme.bands || [];
        if (currentBands.length <= 1) {
            notify('A scheme must have at least one band.', 'error');
            return;
        }
        currentBands.splice(idx, 1);
        if (GradeSchemes) {
            _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme({
                id: _disciplineDraft.gradeScheme.id,
                label: _disciplineDraft.gradeScheme.label,
                bands: currentBands
            });
        }
        refreshView();
    }

    function handleResetAssessmentWeights() {
        if (!_disciplineDraft) { return; }
        var AD = getAcademyDisciplines();
        _disciplineDraft.assessmentWeights =
            (AD && typeof AD.getDefaultAssessmentWeights === 'function')
                ? AD.getDefaultAssessmentWeights()
                : {};
        refreshView();
    }

    function handleCancelDiscipline() {
        if (_disciplineDraftMode === 'edit' && _selectedDisciplineId) {
            initializeDraftFromDiscipline(_selectedDisciplineId);
        } else {
            clearDraft();
        }
        refreshView();
    }

    function handleDisciplineDelete(disciplineId) {
        var CRUD = getAcademyCRUDModals();
        if (disciplineId && CRUD &&
            typeof CRUD.openDisciplineDelete === 'function') {
            CRUD.openDisciplineDelete(disciplineId);
        }
    }

    function buildDisciplinePayload(draft) {
        var GradeSchemes = window.AcademyGradeSchemes;
        var scheme = draft.gradeScheme;
        if (GradeSchemes &&
            typeof GradeSchemes.normalizeScheme === 'function') {
            scheme = GradeSchemes.normalizeScheme(scheme);
        }

        return {
            name: (draft.name || '').trim(),
            type: draft.type,
            startWeek: draft.startWeek,
            endWeek: draft.endWeek,
            weeklyHours: draft.weeklyHours,
            weight: draft.weight,
            instructorIds: Array.isArray(draft.instructorIds)
                ? draft.instructorIds.slice()
                : [],
            gradeScheme: scheme,
            assessmentWeights: draft.assessmentWeights || {}
        };
    }

    function saveDisciplineDraft() {
        if (!_disciplineDraft) { return; }

        var AD = getAcademyDisciplines();
        if (!AD) {
            notify('Discipline module not available.', 'error');
            return;
        }

        _disciplineDraftErrors = {};

        var payload = buildDisciplinePayload(_disciplineDraft);
        var isNew = _disciplineDraftMode === 'create';
        var targetId = _disciplineDraft.id;

        var promise = isNew
            ? AD.create(payload)
            : AD.update(targetId, payload);

        promise.then(function(result) {
            if (!result || !result.success) {
                return;
            }

            var savedId = null;
            if (result.data && result.data.id) {
                savedId = result.data.id;
            } else if (result.data && result.data.discipline &&
                result.data.discipline.id) {
                savedId = result.data.discipline.id;
            } else if (targetId) {
                savedId = targetId;
            }

            if (savedId) {
                initializeDraftFromDiscipline(savedId);
            } else {
                clearDraft();
            }
            refreshView();
        }).catch(function(err) {
            console.warn('[AcademyView] saveDisciplineDraft failed:', err);
            notify('Failed to save discipline.', 'error');
        });
    }

    // ============================================================
    // SEARCH DEBOUNCE
    // ============================================================

    function debouncePeopleSearch(value) {
        if (_searchTimer) { clearTimeout(_searchTimer); }
        _searchTimer = setTimeout(function() {
            _searchTimer = null;
            AcademyUI.setPeopleSearch(value);
            refreshView();
        }, 150);
    }

    function debounceDisciplineSearch(value) {
        if (_disciplineSearchTimer) { clearTimeout(_disciplineSearchTimer); }
        _disciplineSearchTimer = setTimeout(function() {
            _disciplineSearchTimer = null;
            _disciplineFilters.search = value;
            refreshView();
        }, 150);
    }

    function debounceLocationSearch(value) {
        if (_locationSearchTimer) { clearTimeout(_locationSearchTimer); }
        _locationSearchTimer = setTimeout(function() {
            _locationSearchTimer = null;
            _locationFilters.search = value;
            refreshView();
        }, 150);
    }

    // ============================================================
    // CHARACTER DETAIL - STATE HELPERS
    // ============================================================

    function resetCharacterTabIfChanged(charId) {
        var normalised = charId ? String(charId) : null;
        if (_lastCharacterIdForTab !== normalised) {
            _lastCharacterIdForTab = normalised;
            _activeCharacterTab = 'main';
        }
    }

    // ============================================================
    // CHARACTER DETAIL - ACTIONS
    // ============================================================

    function handleDropOut(charId) {
        if (!charId) { return; }

        var CQ = getCharacterQueries();
        if (!CQ) {
            notify('Character queries not available.', 'error');
            return;
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        var name = CQ.getDisplayName(char);
        if (!confirm('Drop out "' + name +
            '" from the Academy? They will remain on the class roster ' +
            'as an eliminated character.')) {
            return;
        }

        var CE = window.CharacterEliminations;
        if (!CE || typeof CE.addStandalone !== 'function') {
            notify('Elimination module not available.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        CE.addStandalone(charId, week, 'Dropped out').then(function(result) {
            if (result && result.success) {
                refreshView();
            }
        }).catch(function(err) {
            console.warn('[AcademyView] Drop Out failed:', err);
            notify('Failed to drop out character.', 'error');
        });
    }

    function handleRemoveFromClass(charId, classId) {
        if (!charId || !classId) { return; }

        var CharacterClasses = getCharacterClasses();
        if (!CharacterClasses ||
            typeof CharacterClasses.removeClassById !== 'function') {
            notify('Character classes module not available.', 'error');
            return;
        }

        var className = 'this class';
        var week = AcademyUI.getDisplayWeek();
        var classVM = AcademyAggregator.getClassViewModel(classId, week);
        if (classVM && classVM.name) {
            className = '"' + classVM.name + '"';
        }

        if (!confirm('Remove this character from ' + className + '?')) {
            return;
        }

        CharacterClasses.removeClassById(charId, classId)
            .then(function(result) {
                if (result && result.success) {
                    refreshView();
                }
            })
            .catch(function(err) {
                console.warn('[AcademyView] removeClassById failed:', err);
                notify('Failed to remove character from class.', 'error');
            });
    }

    function handleEnrollDiscipline(charId) {
        if (!charId) { return; }

        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('Select a class before enrolling in disciplines.', 'error');
            return;
        }

        var AE = getAcademyEnrolments();
        if (!AE || typeof AE.enrol !== 'function') {
            notify('Enrollment module not available.', 'error');
            return;
        }

        var AD = getAcademyDisciplines();
        if (!AD || typeof AD.getDisciplines !== 'function') {
            notify('Discipline module not available.', 'error');
            return;
        }

        var allDisciplines = AD.getDisciplines() || [];
        if (allDisciplines.length === 0) {
            notify('No disciplines exist yet.', 'error');
            return;
        }

        var currentIds = AE.getStudentDisciplines(charId, classId) || [];
        var enrolledSet = {};
        for (var i = 0; i < currentIds.length; i++) {
            enrolledSet[String(currentIds[i])] = true;
        }

        var candidates = allDisciplines.filter(function(d) {
            return d && d.id && !enrolledSet[String(d.id)];
        });

        candidates.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        if (candidates.length === 0) {
            notify('Character is enrolled in all disciplines.', 'info');
            return;
        }

        var names = candidates.map(function(d, idx) {
            return (idx + 1) + '. ' + (d.name || d.id);
        }).join('\n');

        var input = prompt(
            'Enroll in which discipline?\n\n' + names +
            '\n\nEnter the number:',
            '1'
        );

        if (input === null) { return; }

        var choice = parseInt(input, 10);
        if (isNaN(choice) || choice < 1 || choice > candidates.length) {
            notify('Invalid selection.', 'error');
            return;
        }

        var picked = candidates[choice - 1];
        var week = AcademyUI.getDisplayWeek();

        AE.enrol(charId, classId, picked.id, week).then(function(result) {
            if (result && result.success) {
                refreshView();
            } else if (result && result.message) {
                notify(result.message, 'error');
            }
        }).catch(function(err) {
            console.warn('[AcademyView] Enroll failed:', err);
            notify('Failed to enroll in discipline.', 'error');
        });
    }

    function handleLeaveDiscipline(charId, disciplineId) {
        if (!charId || !disciplineId) { return; }

        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        var AE = getAcademyEnrolments();
        if (!AE || typeof AE.leave !== 'function') {
            notify('Enrollment module not available.', 'error');
            return;
        }

        var disciplineName = 'this discipline';
        var AD = getAcademyDisciplines();
        if (AD && typeof AD.getDiscipline === 'function') {
            var disc = AD.getDiscipline(disciplineId);
            if (disc && disc.name) {
                disciplineName = '"' + disc.name + '"';
            }
        }

        if (!confirm('Leave ' + disciplineName +
            '? You can re-enroll later.')) {
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        AE.leave(charId, classId, disciplineId, week).then(function(result) {
            if (result && result.success) {
                refreshView();
            } else if (result && result.message) {
                notify(result.message, 'error');
            }
        }).catch(function(err) {
            console.warn('[AcademyView] Leave failed:', err);
            notify('Failed to leave discipline.', 'error');
        });
    }

    function handleAddGroupStudent(groupKey) {
        if (!groupKey) { return; }

        var AG = getAcademyGroups();
        if (!AG || typeof AG.getGroupStudents !== 'function') {
            notify('Auto-groups module not available.', 'error');
            return;
        }

        var CQ = getCharacterQueries();
        if (!CQ) {
            notify('Character queries not available.', 'error');
            return;
        }

        var currentIds = AG.getGroupStudents(groupKey) || [];
        var currentSet = {};
        for (var i = 0; i < currentIds.length; i++) {
            currentSet[String(currentIds[i])] = true;
        }

        var allChars = CQ.getCharacters() || [];
        var candidates = allChars.filter(function(c) {
            if (!c || !c.id) { return false; }
            return !currentSet[String(c.id)];
        });

        candidates.sort(function(a, b) {
            return CQ.getDisplayName(a).localeCompare(CQ.getDisplayName(b));
        });

        if (candidates.length === 0) {
            notify('No eligible students to add.', 'info');
            return;
        }

        var names = candidates.map(function(c, idx) {
            return (idx + 1) + '. ' + CQ.getDisplayName(c);
        }).join('\n');

        var input = prompt(
            'Add which student to this group?\n\n' + names +
            '\n\nEnter the number:',
            '1'
        );

        if (input === null) { return; }

        var choice = parseInt(input, 10);
        if (isNaN(choice) || choice < 1 || choice > candidates.length) {
            notify('Invalid selection.', 'error');
            return;
        }

        var picked = candidates[choice - 1];
        AG.addStudentToGroup(groupKey, picked.id).then(function(result) {
            if (result && result.success) {
                refreshView();
            }
        }).catch(function(err) {
            console.warn('[AcademyView] Add student to group failed:', err);
            notify('Failed to add student.', 'error');
        });
    }

    function handleRemoveGroupStudent(groupKey, charId) {
        if (!groupKey || !charId) { return; }

        var AG = getAcademyGroups();
        if (!AG || typeof AG.removeStudentFromGroup !== 'function') {
            notify('Auto-groups module not available.', 'error');
            return;
        }

        var name = 'this student';
        var CQ = getCharacterQueries();
        if (CQ) {
            var char = CQ.getCharacterById(charId);
            if (char) {
                name = '"' + CQ.getDisplayName(char) + '"';
            }
        }

        if (!confirm('Remove ' + name + ' from this group?')) {
            return;
        }

        AG.removeStudentFromGroup(groupKey, charId).then(function(result) {
            if (result && result.success) {
                refreshView();
            }
        }).catch(function(err) {
            console.warn('[AcademyView] Remove student from group failed:', err);
            notify('Failed to remove student.', 'error');
        });
    }

    // ============================================================
    // GRADES EDITOR MOUNT
    // ============================================================

    function mountGradesEditorIfPresent() {
        if (AcademyUI.getSelectedView() !== 'people') {
            unmountGradesEditor();
            return;
        }

        var charId = AcademyUI.getSelectedCharacterId();
        if (!charId || _activeCharacterTab !== 'grades') {
            unmountGradesEditor();
            return;
        }

        var GE = getAcademyGradesEditor();
        if (!GE || typeof GE.mount !== 'function') {
            return;
        }

        var container = document.getElementById('academy-grades-editor-host');
        if (!container) { return; }

        var classId = AcademyUI.getSelectedClassId();
        var week = AcademyUI.getDisplayWeek();

        try {
            GE.mount(container, charId, classId, week);
        } catch (e) {
            console.warn('[AcademyView] mountGradesEditor failed:', e);
        }
    }

    function unmountGradesEditor() {
        var GE = getAcademyGradesEditor();
        if (GE && typeof GE.unmount === 'function') {
            try { GE.unmount(); } catch (e) { /* ignore */ }
        }
    }

    // ============================================================
    // SCHEDULE GRID MOUNT
    // ============================================================

    function mountScheduleGridIfPresent() {
        if (AcademyUI.getSelectedView() !== 'people') {
            unmountScheduleGrid();
            return;
        }

        var charId = AcademyUI.getSelectedCharacterId();
        if (!charId || _activeCharacterTab !== 'schedule') {
            unmountScheduleGrid();
            return;
        }

        var host = document.getElementById('academy-schedule-host');
        if (!host) { return; }

        var Renderer = getCalendarRenderer();
        if (!Renderer || typeof Renderer.renderGrid !== 'function') {
            host.innerHTML = '<p class="empty-state small">' +
                'Calendar renderer not available.' +
                '</p>';
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var gridVM = null;
        if (typeof AcademyCharacterDetailAggregator.getScheduleGridViewModel === 'function') {
            gridVM = AcademyCharacterDetailAggregator.getScheduleGridViewModel(
                charId, week
            );
        }

        if (!gridVM) {
            host.innerHTML = '<p class="empty-state small">' +
                'Schedule data not available.' +
                '</p>';
            return;
        }

        var renderState = {
            selectedId: charId,
            week: week
        };

        var renderVM = {
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
            console.warn('[AcademyView] renderGrid failed:', e);
            host.innerHTML = '<p class="empty-state small">' +
                'Failed to render schedule grid.' +
                '</p>';
        }
    }

    function unmountScheduleGrid() {
        var host = document.getElementById('academy-schedule-host');
        if (host) {
            host.innerHTML = '';
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyView = {
        render: render,
        refreshView: refreshView,
        unmount: unmount,
        VIEWS: VIEWS
    };

})();
