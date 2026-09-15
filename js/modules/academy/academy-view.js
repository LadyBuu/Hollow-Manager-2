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
 *   - Delegate domain reads to AcademyAggregator / AcademyTournamentAggregator
 *   - Delegate mutations to the appropriate domain module
 *   - Own Academy-local UI state that is not part of AcademyUI's
 *     typed store (per-view selected IDs, discipline draft, active
 *     character tab)
 *   - Bind container-level event delegation for all views
 *   - Mount / unmount the inline grades editor after each render
 *
 * NOT RESPONSIBILITIES:
 *   - Domain reads. Those happen in the aggregators.
 *   - Domain validation. That happens in the domain modules.
 *   - Domain mutation. Those are delegated to the owning module.
 *   - Filtering the People roster. That is
 *     AcademyAggregator.getPeopleViewModel.
 *
 * ROLE VOCABULARY (CANONICAL):
 *   'student' | 'instructor'. There is no 'trainee'.
 *
 * WEEK SEMANTICS:
 *   Week values are owned by AcademyUI.setDisplayWeek, which enforces
 *   a strict integer parse. This module does not parse weeks itself.
 *
 * ACTION ROUTING:
 *   Actions carry a prefix (people-, character-, discipline-,
 *   location-, ranking-, weekly-teams-, exam-) so dispatch is
 *   deterministic and does not rely on handler chaining.
 *
 * MODULE-LOCAL UI STATE (NOT in AcademyUI):
 *   _selectedExamClassId
 *   _selectedRankingClassId
 *   _selectedWeeklyTeamsClassId
 *   _selectedWeeklyTeamId
 *   _selectedLocationId
 *   _selectedDisciplineId
 *   _disciplineDraft / _disciplineDraftMode / _disciplineDraftErrors
 *   _activeCharacterTab (character detail tab within People)
 *
 * DEPENDENCIES (MANDATORY):
 *   - AcademyUI
 *   - AcademyAggregator
 *   - AcademyTournamentAggregator
 *   - DomUtils
 *   - CalendarConstants
 *
 * DEPENDENCIES (OPTIONAL, feature-scoped):
 *   - CharacterQueries (only for the character edit event payload)
 *   - AcademyDisciplines
 *   - AcademyEnrolments
 *   - AcademyGroups
 *   - CharacterEliminations
 *   - AcademyCRUDModals
 *   - AcademyTournamentEvents
 *   - AcademyGradesEditor
 *   - AcademyCharacterDetail / AcademyClassDetail
 *   - AcademyDisciplineView / AcademyLocationView / AcademyRankingView /
 *     AcademyWeeklyTeamsView / AcademyTournamentView
 */

(function() {
    'use strict';

    if (window.__academyViewLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (throws if missing)
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyTournamentAggregator = window.AcademyTournamentAggregator;
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
    function getAcademyDisciplines() { return window.AcademyDisciplines || null; }
    function getAcademyEnrolments() { return window.AcademyEnrolments || null; }
    function getAcademyGroups() { return window.AcademyGroups || null; }
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

    // Character detail panel tab. Reset when the selected character
    // changes (see resetCharacterTabIfChanged).
    var _activeCharacterTab = 'main';
    var _lastCharacterIdForTab = null;

    // Per-view class/selection state. Not part of AcademyUI because
    // these are view-local; the cross-view selection (People class +
    // character) lives in AcademyUI.
    var _selectedExamClassId = null;
    var _selectedRankingClassId = null;
    var _selectedWeeklyTeamsClassId = null;
    var _selectedWeeklyTeamId = null;
    var _selectedLocationId = null;

    // Discipline editor draft. The editor is inline; the draft is
    // owned by this view and submitted to AcademyDisciplines.
    var _selectedDisciplineId = null;
    var _disciplineDraft = null;
    var _disciplineDraftMode = 'empty';
    var _disciplineDraftErrors = {};

    // Container and listener bookkeeping.
    var _boundContainer = null;
    var _boundHandlers = null;

    // Debounce timers. Cancelled on unbind.
    var _searchTimer = null;
    var _disciplineSearchTimer = null;
    var _locationSearchTimer = null;

    // Academy-UI-local discipline and location filter state. The
    // cross-view People filter lives in AcademyUI; these two filter
    // sets are local because AcademyUI does not model them.
    var _disciplineFilters = { type: 'all', search: '' };
    var _locationFilters = { type: 'all', search: '' };

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
                        'class="academy-view-btn' + (isActive ? ' active' : '') + '" ' +
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

        var html = '';
        html += renderPeopleTopBar(classId);

        if (!classId) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">Select a class to view its members.</p>' +
                    '</div>';
            return html;
        }

        var classVM = AcademyAggregator.getClassViewModel(classId);
        if (!classVM) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">Class not found.</p>' +
                    '</div>';
            return html;
        }

        html += '<div class="academy-body academy-people-layout">';

        // Left: filters + character list, built from the aggregator's
        // People VM. This VM carries the class-list, the class id and
        // name, the filter values that were applied, the filtered
        // people, and total / filtered counts.
        var peopleVM = buildPeopleViewModel(classId, charId);
        html += renderPeopleSidebar(peopleVM);

        // Right: class detail (no character selected) or character detail.
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

    /**
     * Build the People VM. Uses the AcademyAggregator roster projection
     * for the class and applies the People filter from AcademyUI.
     *
     * The roster is AcademyAggregator.getClassStudentsViewModel(classId).
     * This returns students only (no instructor). The instructor is
     * stitched in via the class VM's instructorId when it should appear
     * in the roster list.
     *
     * After this file is fully split, this logic moves into
     * AcademyAggregator.getPeopleViewModel.
     */
    function buildPeopleViewModel(classId, selectedCharacterId) {
        var classVM = AcademyAggregator.getClassViewModel(classId);
        var classList = AcademyAggregator.getClassListViewModel() || [];
        var students = AcademyAggregator.getClassStudentsViewModel(classId) || [];

        // Stitch the instructor into the roster for display. The
        // instructor is a member of the class but is not in
        // character.classIds, so the roster projection excludes them.
        if (classVM && classVM.instructorId) {
            var alreadyPresent = false;
            for (var i = 0; i < students.length; i++) {
                if (String(students[i].id) === String(classVM.instructorId)) {
                    alreadyPresent = true;
                    break;
                }
            }
            if (!alreadyPresent) {
                var instructor = null;
                var CQ = getCharacterQueries();
                if (CQ && typeof CQ.getCharacterById === 'function') {
                    instructor = CQ.getCharacterById(classVM.instructorId);
                }
                if (instructor) {
                    students = students.concat([{
                        id: instructor.id,
                        name: CQ.getDisplayName(instructor),
                        status: CQ.getCurrentStatus(instructor),
                        age: CQ.getCharacterAge(instructor),
                        deceased: instructor.deceased === true,
                        role: 'instructor'
                    }]);
                }
            }
        }

        var filters = AcademyUI.getPeopleFilter();
        var search = (filters.search || '').toLowerCase().trim();
        var roleFilter = filters.role || 'all';
        var statusFilter = filters.status || 'active';

        var filtered = students.filter(function(person) {
            if (search && person.name.toLowerCase().indexOf(search) === -1) {
                return false;
            }
            if (roleFilter !== 'all' && person.role !== roleFilter) {
                return false;
            }
            if (statusFilter !== 'all') {
                var isDeceased = person.deceased === true;
                if (statusFilter === 'deceased' && !isDeceased) { return false; }
                if (statusFilter === 'active' && isDeceased) { return false; }
            }
            return true;
        });

        filtered.sort(function(a, b) {
            if (a.role !== b.role) {
                return a.role === 'student' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        var people = filtered.map(function(person) {
            return {
                id: person.id,
                name: person.name,
                status: person.status,
                role: person.role,
                deceased: person.deceased === true,
                isSelected: selectedCharacterId !== null &&
                    String(person.id) === String(selectedCharacterId)
            };
        });

        return {
            classList: classList,
            classId: classId,
            className: classVM ? classVM.name : null,
            filters: filters,
            people: people,
            totalCount: students.length,
            filteredCount: people.length
        };
    }

    function renderPeopleTopBar(selectedClassId) {
        var week = AcademyUI.getDisplayWeek();
        var classes = AcademyAggregator.getClassListViewModel() || [];

        var html = '';
        html += '<div class="academy-top-bar">';

        html += '<div class="academy-top-left">';
        html += '<label class="academy-top-label" for="academy-class-select">Class:</label>';
        html += '<select id="academy-class-select" class="academy-class-select">';
        html += '<option value="">Select a class...</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var isSelected = selectedClassId && String(selectedClassId) === String(cls.id);
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                        (isSelected ? ' selected' : '') + '>' +
                        escapeHtml(cls.name) +
                    '</option>';
        }
        html += '</select>';
        html += '<button type="button" id="academy-add-class-btn" class="primary small">+ Add Class</button>';
        html += '</div>';

        html += '<div class="academy-top-right">';
        html += '<label class="academy-top-label" for="academy-week-input">Week:</label>';
        html += '<input type="number" id="academy-week-input" class="academy-week-input" ' +
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

        html += '<label class="academy-filter-label" for="academy-people-role">Role:</label>';
        html += '<select id="academy-people-role" class="academy-people-role">';
        html += '<option value="all"' +
                    (filters.role === 'all' ? ' selected' : '') + '>All</option>';
        html += '<option value="student"' +
                    (filters.role === 'student' ? ' selected' : '') + '>Students</option>';
        html += '<option value="instructor"' +
                    (filters.role === 'instructor' ? ' selected' : '') + '>Instructors</option>';
        html += '</select>';

        html += '<label class="academy-filter-label" for="academy-people-status">Status:</label>';
        html += '<select id="academy-people-status" class="academy-people-status">';
        html += '<option value="active"' +
                    (filters.status === 'active' ? ' selected' : '') + '>Active</option>';
        html += '<option value="eliminated"' +
                    (filters.status === 'eliminated' ? ' selected' : '') + '>Eliminated</option>';
        html += '<option value="deceased"' +
                    (filters.status === 'deceased' ? ' selected' : '') + '>Deceased</option>';
        html += '<option value="all"' +
                    (filters.status === 'all' ? ' selected' : '') + '>All</option>';
        html += '</select>';

        html += '</div>';

        html += '<div class="academy-character-list" id="academy-character-list">';

        var people = vm.people || [];
        if (people.length === 0) {
            html += '<p class="empty-state small">No characters match the current filters.</p>';
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

        var html = '';
        html += '<div class="' + classes + '" ' +
                    'data-character-id="' + escapeAttribute(person.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-character-row-main">';
        html += '<span class="academy-character-name">' +
                    escapeHtml(person.name || 'Unknown') +
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

    function renderClassDetailContent(classVM) {
        var ClassDetail = getClassDetailModule();
        if (ClassDetail && typeof ClassDetail.renderHTML === 'function') {
            try {
                return ClassDetail.renderHTML(classVM);
            } catch (e) {
                console.warn('[AcademyView] AcademyClassDetail.renderHTML failed:', e);
            }
        }
        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' + escapeHtml(classVM.name || 'Class') + '</h3>' +
                '<p class="empty-state small">Class detail view not available.</p>' +
            '</div>'
        );
    }

    /**
     * Build the character detail VM. Local for now; will be replaced
     * by AcademyCharacterDetailAggregator.getViewModel when that
     * module lands. The shape is identical to the aggregator's future
     * output.
     */
    function buildCharacterDetailViewModel(classVM, charId) {
        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return null;
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            return null;
        }

        var classId = classVM ? classVM.id : null;
        var week = AcademyUI.getDisplayWeek();
        var mode = AcademyUI.getCharacterMode(charId);

        var header = {
            id: char.id,
            name: CQ.getDisplayName(char),
            status: CQ.getCurrentStatus(char),
            age: CQ.getCharacterAge(char),
            deceased: char.deceased === true
        };

        var classContext = classVM ? { id: classVM.id, name: classVM.name } : null;

        var classes = AcademyAggregator.getClassListViewModel() || [];
        var characterClasses = [];
        if (Array.isArray(char.classIds)) {
            for (var i = 0; i < char.classIds.length; i++) {
                var cid = String(char.classIds[i]);
                for (var j = 0; j < classes.length; j++) {
                    if (String(classes[j].id) === cid) {
                        characterClasses.push({
                            id: classes[j].id,
                            name: classes[j].name
                        });
                        break;
                    }
                }
            }
        }

        var tabs = mode === 'instructor'
            ? [
                { id: 'main',        label: 'Main' },
                { id: 'disciplines', label: 'Disciplines' },
                { id: 'schedule',    label: 'Schedule' },
                { id: 'autoGroups',  label: 'Auto-Groups' }
            ]
            : [
                { id: 'main',        label: 'Main' },
                { id: 'disciplines', label: 'Disciplines' },
                { id: 'grades',      label: 'Grades' },
                { id: 'schedule',    label: 'Schedule' },
                { id: 'teams',       label: 'Teams' }
            ];

        // Validate the requested active tab against the mode.
        var validTabIds = tabs.map(function(t) { return t.id; });
        var activeTab = validTabIds.indexOf(_activeCharacterTab) !== -1
            ? _activeCharacterTab
            : 'main';

        // Student-side disciplines from enrollment (class-scoped).
        var studentDisciplines = null;
        if (mode === 'student' && classId) {
            var AE = getAcademyEnrolments();
            if (AE && typeof AE.getStudentDisciplines === 'function') {
                var ids = AE.getStudentDisciplines(charId, classId) || [];
                studentDisciplines = [];
                var AD = getAcademyDisciplines();
                for (var k = 0; k < ids.length; k++) {
                    var d = null;
                    if (AD && typeof AD.getDiscipline === 'function') {
                        d = AD.getDiscipline(ids[k]);
                    }
                    studentDisciplines.push({
                        id: ids[k],
                        name: d ? d.name : 'Unknown Discipline'
                    });
                }
            }
        }

        // Student-side grades from AcademyGrades via class-scoped read.
        var studentGrades = null;
        if (mode === 'student' && classId) {
            var AG = window.AcademyGrades;
            if (AG && typeof AG.getStudentClassGrades === 'function') {
                var rawGrades = AG.getStudentClassGrades(charId, classId) || [];
                var summary = AG.calculateSummary ? AG.calculateSummary(rawGrades) : null;
                studentGrades = {
                    average: summary && isFinite(summary.average) ? summary.average : null,
                    count: summary && isFinite(summary.count) ? summary.count : 0,
                    hasAny: summary && summary.count > 0
                };
            }
        }

        // Instructor-side disciplines read from discipline.instructorIds.
        var instructorDisciplines = null;
        if (mode === 'instructor') {
            var AD2 = getAcademyDisciplines();
            if (AD2 && typeof AD2.getDisciplinesByInstructor === 'function') {
                var list = AD2.getDisciplinesByInstructor(charId) || [];
                instructorDisciplines = [];
                for (var m = 0; m < list.length; m++) {
                    instructorDisciplines.push({
                        id: list[m].id,
                        name: list[m].name,
                        type: list[m].type || ''
                    });
                }
            }
        }

        // Instructor-side auto-groups.
        var instructorAutoGroups = null;
        if (mode === 'instructor') {
            var AG2 = getAcademyGroups();
            if (AG2 && typeof AG2.getGroupsByInstructor === 'function') {
                var groupsMap = AG2.getGroupsByInstructor(charId) || {};
                instructorAutoGroups = [];
                var groupKeys = Object.keys(groupsMap);
                for (var g = 0; g < groupKeys.length; g++) {
                    var key = groupKeys[g];
                    var group = groupsMap[key];
                    if (!group) { continue; }
                    var students = [];
                    if (Array.isArray(group.students)) {
                        for (var s = 0; s < group.students.length; s++) {
                            var sCQ = getCharacterQueries();
                            var sChar = sCQ ? sCQ.getCharacterById(group.students[s]) : null;
                            if (sChar) {
                                students.push({
                                    id: sChar.id,
                                    name: sCQ.getDisplayName(sChar),
                                    status: sCQ.getCurrentStatus(sChar)
                                });
                            }
                        }
                    }
                    var disciplineName = 'Unknown';
                    var AD3 = getAcademyDisciplines();
                    if (AD3 && typeof AD3.getDiscipline === 'function') {
                        var disc = AD3.getDiscipline(group.disciplineId);
                        if (disc) { disciplineName = disc.name; }
                    }
                    instructorAutoGroups.push({
                        key: key,
                        disciplineId: group.disciplineId || '',
                        disciplineName: disciplineName,
                        studentCount: students.length,
                        students: students
                    });
                }
            }
        }

        // Elimination state from character.eliminations.
        var elimination = null;
        if (week !== null) {
            var eliminationWeek = null;
            var reason = '';
            if (Array.isArray(char.eliminations)) {
                for (var e = 0; e < char.eliminations.length; e++) {
                    var rec = char.eliminations[e];
                    if (!rec) { continue; }
                    var w = parseInt(rec.week, 10);
                    if (isNaN(w)) { continue; }
                    if (eliminationWeek === null || w < eliminationWeek) {
                        eliminationWeek = w;
                        reason = rec.reason || '';
                    }
                }
            }
            if (eliminationWeek !== null && week >= eliminationWeek) {
                elimination = {
                    week: eliminationWeek,
                    reason: reason,
                    state: week === eliminationWeek ? 'current' : 'past'
                };
            }
        }

        // Performance blend. Reads through AcademyPerformance when
        // present; null otherwise.
        var performance = null;
        if (mode === 'student' && classId && week !== null) {
            var AP = window.AcademyPerformance;
            if (AP && typeof AP.calculateOverallScore === 'function') {
                var academic = null;
                var social = null;
                var overall = null;
                if (typeof AP.calculateAcademicAverage === 'function') {
                    var aa = AP.calculateAcademicAverage(charId, classId, week);
                    if (aa && isFinite(aa.average)) { academic = aa.average; }
                }
                var ASS = window.AcademySocialScore;
                if (ASS && typeof ASS.getSocialScore === 'function') {
                    var sScore = ASS.getSocialScore(charId, classId, week);
                    if (isFinite(sScore)) { social = sScore; }
                }
                var oScore = AP.calculateOverallScore(charId, classId, week);
                if (isFinite(oScore)) { overall = oScore; }
                performance = {
                    week: week,
                    academicAverage: academic,
                    socialScore: social,
                    overallScore: overall
                };
            }
        }

        // Teams (persistent, via TeamQueries). Only for student mode.
        var studentTeams = null;
        if (mode === 'student' && week !== null) {
            var TQ = window.TeamQueries;
            if (TQ && typeof TQ.getTeamsForCharacter === 'function') {
                var rawTeams = TQ.getTeamsForCharacter(charId, week) || [];
                studentTeams = [];
                for (var t = 0; t < rawTeams.length; t++) {
                    studentTeams.push({
                        id: rawTeams[t].id,
                        name: rawTeams[t].name || 'Unnamed Team',
                        typeLabel: rawTeams[t].type || 'team'
                    });
                }
            }
        }

        return {
            character: header,
            mode: mode,
            activeTab: activeTab,
            tabs: tabs,
            classContext: classContext,
            classes: characterClasses,
            elimination: elimination,
            performance: performance,
            student: mode === 'student'
                ? {
                    disciplines: studentDisciplines,
                    grades: studentGrades,
                    teams: studentTeams
                }
                : null,
            instructor: mode === 'instructor'
                ? {
                    disciplines: instructorDisciplines,
                    autoGroups: instructorAutoGroups
                }
                : null
        };
    }

    function renderCharacterDetailContent(classVM, charId) {
        var vm = buildCharacterDetailViewModel(classVM, charId);
        if (!vm) {
            return '<p class="empty-state">Character not found.</p>';
        }

        var CharacterDetail = getCharacterDetailModule();
        if (CharacterDetail && typeof CharacterDetail.renderHTML === 'function') {
            try {
                return CharacterDetail.renderHTML(vm);
            } catch (e) {
                console.warn('[AcademyView] AcademyCharacterDetail.renderHTML failed:', e);
            }
        }

        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' + escapeHtml(vm.character.name) + '</h3>' +
                '<p class="empty-state small">Character detail view not available.</p>' +
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

        // Sync back if the aggregator resolved a different class.
        _selectedExamClassId = vm.classId;

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

        _selectedWeeklyTeamsClassId = vm.classId;
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

        _selectedRankingClassId = vm.classId;

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

        var listVM = AcademyAggregator.getDisciplineListViewModel(_disciplineFilters);
        var editorVM = buildDisciplineEditorVM();

        return Renderer.renderHTML({
            disciplines: listVM.disciplines,
            selected: editorVM,
            editorMode: _disciplineDraftMode,
            filters: _disciplineFilters,
            total: listVM.total
        });
    }

    /**
     * Build the discipline editor VM. Local for now; will be replaced
     * by AcademyAggregator.getDisciplineEditorViewModel when that lands.
     * The shape matches that future output.
     */
    function buildDisciplineEditorVM() {
        if (_disciplineDraftMode === 'empty' || !_disciplineDraft) {
            return null;
        }

        var draft = _disciplineDraft;
        var isNew = _disciplineDraftMode === 'create';

        var availableInstructors = [];
        var CQ = getCharacterQueries();
        if (CQ && typeof CQ.getInstructors === 'function') {
            var instructors = CQ.getInstructors() || [];
            for (var i = 0; i < instructors.length; i++) {
                availableInstructors.push({
                    id: instructors[i].id,
                    name: CQ.getDisplayName(instructors[i])
                });
            }
        }

        var schemePreview = '';
        var GradeSchemes = window.AcademyGradeSchemes;
        if (GradeSchemes && typeof GradeSchemes.getRangeLabel === 'function') {
            schemePreview = GradeSchemes.getRangeLabel(draft.gradeScheme) || '';
        }

        var schemePresetId = draft.gradeScheme && draft.gradeScheme.id
            ? draft.gradeScheme.id
            : 'numeric';

        var schemePresets = [];
        if (GradeSchemes && typeof GradeSchemes.getPresets === 'function') {
            var presets = GradeSchemes.getPresets() || [];
            for (var p = 0; p < presets.length; p++) {
                schemePresets.push({ id: presets[p].id, label: presets[p].label });
            }
        }

        var assessmentTypes = [];
        var AD = getAcademyDisciplines();
        if (AD && typeof AD.getValidAssessmentTypes === 'function') {
            assessmentTypes = AD.getValidAssessmentTypes() || [];
        }

        var assessmentWeights = draft.assessmentWeights && typeof draft.assessmentWeights === 'object'
            ? draft.assessmentWeights
            : {};

        var defaultAssessmentWeights = {};
        if (AD && typeof AD.getDefaultAssessmentWeights === 'function') {
            defaultAssessmentWeights = AD.getDefaultAssessmentWeights() || {};
        }

        var instructorNames = [];
        var selectedIds = Array.isArray(draft.instructorIds) ? draft.instructorIds : [];
        for (var n = 0; n < selectedIds.length; n++) {
            var sChar = CQ ? CQ.getCharacterById(selectedIds[n]) : null;
            instructorNames.push(sChar ? CQ.getDisplayName(sChar) : 'Unknown');
        }

        return {
            id: isNew ? null : draft.id,
            name: draft.name || '',
            type: draft.type || 'mandatory',
            startWeek: draft.startWeek,
            endWeek: draft.endWeek,
            weeklyHours: draft.weeklyHours,
            weight: draft.weight,
            instructorIds: selectedIds,
            instructorNames: instructorNames,
            availableInstructors: availableInstructors,
            gradeScheme: draft.gradeScheme || null,
            schemePresetId: schemePresetId,
            schemePreview: schemePreview,
            schemePresets: schemePresets,
            assessmentTypes: assessmentTypes,
            assessmentWeights: assessmentWeights,
            defaultAssessmentWeights: defaultAssessmentWeights,
            weekBounds: { min: MIN_WEEK, max: MAX_WEEK },
            weeklyHoursBounds: { min: 0.5, max: 40, step: 0.5 },
            weightBounds: { min: 0.1, max: 10, step: 0.1 },
            bandPercentBounds: { min: 0, max: 100, step: 1 },
            fieldErrors: _disciplineDraftErrors || {},
            isNew: isNew
        };
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
            startWeek: typeof record.startWeek === 'number' ? record.startWeek : MIN_WEEK,
            endWeek: typeof record.endWeek === 'number' ? record.endWeek : MAX_WEEK,
            weeklyHours: typeof record.weeklyHours === 'number' ? record.weeklyHours : 1,
            weight: typeof record.weight === 'number' ? record.weight : 1,
            instructorIds: Array.isArray(record.instructorIds) ? record.instructorIds.slice() : [],
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
            assessmentWeights: (AD && typeof AD.getDefaultAssessmentWeights === 'function')
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
        if (_disciplineSearchTimer) { clearTimeout(_disciplineSearchTimer); _disciplineSearchTimer = null; }
        if (_locationSearchTimer) { clearTimeout(_locationSearchTimer); _locationSearchTimer = null; }
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

        // View switcher
        var viewBtn = target.closest('.academy-view-btn');
        if (viewBtn) {
            e.preventDefault();
            handleViewSwitch(viewBtn.dataset.view);
            return;
        }

        // Character select / deselect
        var charRow = target.closest('.academy-character-row, .academy-student-row');
        if (charRow) {
            e.preventDefault();
            handleCharacterSelect(charRow.dataset.characterId);
            return;
        }

        // Top-bar add class
        if (target.closest('#academy-add-class-btn')) {
            e.preventDefault();
            handleAddClass();
            return;
        }

        // Discipline row selection (in Discipline view)
        var discRow = target.closest('.academy-discipline-row');
        if (discRow) {
            e.preventDefault();
            if (discRow.dataset.disciplineId) {
                initializeDraftFromDiscipline(discRow.dataset.disciplineId);
                refreshView();
            }
            return;
        }

        // Location row selection
        var locRow = target.closest('.academy-location-row');
        if (locRow) {
            e.preventDefault();
            if (locRow.dataset.locationId) {
                _selectedLocationId = (String(_selectedLocationId) === String(locRow.dataset.locationId))
                    ? null
                    : locRow.dataset.locationId;
                refreshView();
            }
            return;
        }

        // Weekly teams row selection
        var weeklyTeamRow = target.closest('.academy-weekly-team-row');
        if (weeklyTeamRow) {
            e.preventDefault();
            if (weeklyTeamRow.dataset.teamId) {
                _selectedWeeklyTeamId = (String(_selectedWeeklyTeamId) === String(weeklyTeamRow.dataset.teamId))
                    ? null
                    : weeklyTeamRow.dataset.teamId;
                refreshView();
            }
            return;
        }

        // Weekly teams member → jump to People
        var weeklyMemberRow = target.closest('.academy-weekly-team-member-row');
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

        // Ranking row → jump to People
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

        // Character detail tab switch
        var tabBtn = target.closest('.academy-character-tab-btn');
        if (tabBtn) {
            e.preventDefault();
            if (tabBtn.dataset.tab) {
                _activeCharacterTab = tabBtn.dataset.tab;
                refreshView();
            }
            return;
        }

        // Character detail action buttons
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
        // Placeholder for People-scoped actions that later land here.
    }

    function handleCharacterAction(action, el) {
        switch (action) {
            case 'drop-out-character':
                handleDropOut(el.dataset.characterId);
                return;
            case 'enroll-discipline':
                handleEnrollDiscipline(el.dataset.characterId);
                return;
            case 'leave-discipline':
                handleLeaveDiscipline(el.dataset.characterId, el.dataset.disciplineId);
                return;
            case 'character-add-group-student':
                handleAddGroupStudent(el.dataset.groupKey);
                return;
            case 'character-remove-group-student':
                handleRemoveGroupStudent(el.dataset.groupKey, el.dataset.characterId);
                return;
            default:
                return;
        }
    }

    function handleExamAction(action, el) {
        var Events = getAcademyTournamentEvents();
        if (!Events) { return; }

        // The exam id travels on the action element. No direct
        // TournamentQueries read from this view.
        var examId = el.dataset.examId || null;

        switch (action) {
            case 'exam-create':
                Events.createExam(_selectedExamClassId, AcademyUI.getDisplayWeek());
                return;
            case 'exam-delete':
                if (examId) { Events.deleteExam(examId); }
                return;
            case 'exam-toggle-pool-member':
                if (examId) { Events.togglePoolMember(examId, el.dataset.poolId); }
                return;
            case 'exam-add-round':
                if (examId) { Events.addRound(examId); }
                return;
            case 'exam-remove-round':
                if (examId) {
                    Events.removeRound(examId, el.dataset.roundId);
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
                    Events.editMatch(examId, el.dataset.roundId, el.dataset.matchId);
                }
                return;
            case 'exam-complete-match':
                if (examId) {
                    Events.completeMatch(examId, el.dataset.roundId, el.dataset.matchId);
                }
                return;
            case 'exam-remove-match':
                if (examId) {
                    Events.removeMatch(examId, el.dataset.roundId, el.dataset.matchId);
                }
                return;
            case 'exam-complete':
                if (examId) { Events.completeExam(examId); }
                return;
            default:
                return;
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
        // Unprefixed fallback for older markup. Routes into the
        // canonical discipline handler.
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
        // Rankings view has no inline actions yet; ranking generation
        // is domain-owned and exposed through AcademyRanking.autoGenerate.
    }

    function handleWeeklyTeamsAction(action, el) {
        // Weekly Teams view has no mutations yet.
    }

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
        if (action === 'edit-class') {
            handleClassAction('edit-class', el.dataset.classId);
            return;
        }
        if (action === 'edit-social-score') {
            var CRUD = getAcademyCRUDModals();
            if (CRUD && typeof CRUD.openSocialScoreForm === 'function') {
                CRUD.openSocialScoreForm(el.dataset.characterId);
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
                    (_activeCharacterTab === 'grades' || _activeCharacterTab === 'teams')) {
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
            var classVM = AcademyAggregator.getClassViewModel(classId);
            if (classVM && isCharacterInClassVM(prevCharId, classVM)) {
                AcademyUI.selectCharacter(prevCharId);
            }
        }

        refreshView();
    }

    function isCharacterInClassVM(charId, classVM) {
        if (!charId || !classVM) { return false; }
        var target = String(charId);

        if (classVM.instructorId && String(classVM.instructorId) === target) {
            return true;
        }

        var students = AcademyAggregator.getClassStudentsViewModel(classVM.id) || [];
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
        // Delegate to AcademyUI, which enforces the strict integer
        // parse. If it accepts the value, refresh; otherwise, do
        // nothing (the input is left as-is, so the user sees their
        // invalid input and can correct it).
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
                // Store the raw string. The domain validates on save.
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
                    if (inputEl.options[i].selected && inputEl.options[i].value) {
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
            // Store raw; the domain validates on save.
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

        var previewEl = document.querySelector('.academy-discipline-scheme-preview-text');
        if (!previewEl) { return; }

        try {
            previewEl.textContent = GradeSchemes.getRangeLabel(_disciplineDraft.gradeScheme) || '';
        } catch (e) {
            // Ignore preview failures while the draft is mid-edit
        }
    }

    // ============================================================
    // DISCIPLINE EDITOR - actions
    // ============================================================

    function handleApplySchemePreset(el) {
        var GradeSchemes = window.AcademyGradeSchemes;
        if (!_disciplineDraft || !GradeSchemes) { return; }

        var presetSelect = document.querySelector('[data-discipline-field="schemePresetId"]');
        var presetId = presetSelect ? presetSelect.value : 'numeric';

        if (presetId === 'custom') {
            _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme({
                id: 'custom',
                label: _disciplineDraft.gradeScheme.label || 'Custom Scheme',
                bands: _disciplineDraft.gradeScheme.bands || []
            });
        } else {
            var preset = GradeSchemes.getPreset(presetId);
            if (preset) {
                _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme(preset);
            }
        }

        refreshView();
    }

    function handleAddBand() {
        if (!_disciplineDraft) { return; }
        var GradeSchemes = window.AcademyGradeSchemes;
        var bands = _disciplineDraft.gradeScheme.bands || [];
        var maxBands = (GradeSchemes && GradeSchemes.MAX_BANDS) ? GradeSchemes.MAX_BANDS : 26;
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
        _disciplineDraft.assessmentWeights = (AD && typeof AD.getDefaultAssessmentWeights === 'function')
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
        if (disciplineId && CRUD && typeof CRUD.openDisciplineDelete === 'function') {
            CRUD.openDisciplineDelete(disciplineId);
        }
    }

    /**
     * Build the discipline payload. Shape only. No validation. No
     * defaulting. The domain owns validation and normalisation.
     */
    function buildDisciplinePayload(draft) {
        var GradeSchemes = window.AcademyGradeSchemes;
        var scheme = draft.gradeScheme;
        if (GradeSchemes && typeof GradeSchemes.normalizeScheme === 'function') {
            scheme = GradeSchemes.normalizeScheme(scheme);
        }

        return {
            name: (draft.name || '').trim(),
            type: draft.type,
            startWeek: draft.startWeek,
            endWeek: draft.endWeek,
            weeklyHours: draft.weeklyHours,
            weight: draft.weight,
            instructorIds: Array.isArray(draft.instructorIds) ? draft.instructorIds.slice() : [],
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
                // The domain already notified on failure via the
                // pipeline. Nothing more to do here.
                return;
            }

            // Determine the resulting id for re-initialising the
            // draft in edit mode.
            var savedId = null;
            if (result.data && result.data.id) {
                savedId = result.data.id;
            } else if (result.data && result.data.discipline && result.data.discipline.id) {
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
        if (!confirm('Drop out "' + name + '" from the Academy? They will remain on the class roster as an eliminated character.')) {
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

    /**
     * Enroll a character in a discipline for the currently selected class.
     *
     * Candidates come from the student's current enrollment via
     * AcademyEnrolments. The list of ALL disciplines comes from
     * AcademyDisciplines. The candidate set is the difference.
     * This logic runs on the domain modules' own public APIs, not on
     * raw storage.
     */
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
            'Enroll in which discipline?\n\n' + names + '\n\nEnter the number:',
            '1'
        );

        if (input === null) { return; }

        var choice = parseInt(input, 10);
        if (isNaN(choice) || choice < 1 || choice > candidates.length) {
            notify('Invalid selection.', 'error');
            return;
        }

        var picked = candidates[choice - 1];
        AE.enrol(charId, classId, picked.id).then(function(result) {
            if (result && result.success) {
                refreshView();
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

        if (!confirm('Leave ' + disciplineName + '? You can re-enroll later.')) {
            return;
        }

        AE.leave(charId, classId, disciplineId).then(function(result) {
            if (result && result.success) {
                refreshView();
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
            'Add which student to this group?\n\n' + names + '\n\nEnter the number:',
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
    // EXPOSE
    // ============================================================

    window.AcademyView = {
        render: render,
        refreshView: refreshView,
        unmount: unmount,
        VIEWS: VIEWS
    };

})();
