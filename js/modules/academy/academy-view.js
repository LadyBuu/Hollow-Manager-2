/**
 * modules/academy/academy-view.js - Academy Unified Shell
 * Top-level renderer for the Academy tab
 *
 * Path: js/modules/academy/academy-view.js
 *
 * This module provides:
 *   - The unified Academy shell (view switcher)
 *   - Six views: People, Exams, Weekly Teams, Rankings, Disciplines, Locations
 *   - Delegation to AcademyClassDetail / AcademyCharacterDetail for the
 *     People view's right panel
 *   - Delegation to AcademyDisciplineView / AcademyLocationView /
 *     AcademyRankingView / AcademyWeeklyTeamsView / AcademyTournamentView
 *     for the other views
 *   - Container-level event delegation for all views
 *   - Mount/unmount of the inline grades editor after each render
 *   - Discipline inline editor: draft state, live preview, save/cancel
 *   - Character detail tabs: Student / Instructor modes
 *
 * IMPORTANT:
 *   - RENDER + WIRE - no domain mutations, no business logic
 *   - Reads state from AcademyUI
 *   - Reads projections from AcademyAggregator / AcademyTournamentAggregator
 *   - Delegates rendering to per-view renderers where they exist
 *   - Delegates exam mutations to AcademyTournamentEvents
 *   - Delegates discipline mutations to AcademyDisciplines
 *   - Delegates enrollment mutations to AcademyEnrolments
 *   - Delegates social score mutations to AcademySocialScore
 *   - Uses container-level event delegation (survives innerHTML replacement)
 *   - Uses DomUtils for escaping (mandatory, no fallbacks)
 *
 * DEPENDENCY MODEL:
 *   Mandatory:
 *     - AcademyUI
 *     - AcademyAggregator
 *     - AcademyTournamentAggregator
 *     - DomUtils
 *     - CalendarConstants
 *
 *   Degraded / lazy:
 *     - CharacterQueries  (character identity in a few confirmation prompts)
 *     - AcademyEnrolments (preferred path for enrollment mutations)
 *     - AcademySocialScore (set-social-score action)
 *     - AcademyCRUDModals / AcademyTournamentEvents / AcademyGradesEditor
 *     - AcademyClassDetail / AcademyCharacterDetail / per-view renderers
 *
 * ENROLLMENT MODEL (Phase 4):
 *   - Enrollment is class-scoped. Source of truth is
 *     AcademyEnrolments.getStudentDisciplines(charId, classId).
 *   - character.disciplineIds is NOT read by this module.
 *   - Enroll and leave actions call AcademyEnrolments.enrol / .leave.
 *
 * SOCIAL SCORE MODEL (Phase 5):
 *   - Social score is class + week scoped. Source of truth is
 *     AcademySocialScore.
 *   - The set-social-score action routes to AcademySocialScore.
 *
 * ROLE VOCABULARY (FROZEN):
 *   The People view filter uses three values: 'all', 'trainee',
 *   'instructor'. The class VM's `students` array uses 'trainee' and
 *   'instructor' for its display roles. This module normalises the
 *   comparison at the filter layer: any student-role entry whose
 *   role is 'trainee' matches the 'trainee' filter. The class VM
 *   keeps the 'trainee' spelling for its own consumers
 *   (academy-class-detail.js). Do not rename the vocabulary here —
 *   that would ripple into the class VM and its other consumer.
 *
 * CLASS SELECTION SEMANTICS:
 *   - AcademyUI.selectClass(classId) is a pure setter: it clears the
 *     character selection on every class change.
 *   - This module preserves the character selection when the
 *     character is still a member (or the instructor) of the newly
 *     selected class. The check lives here because the roster VM
 *     is available here and nowhere in the UI-state layer.
 *
 * DISCIPLINE EDITOR STATE MACHINE:
 *   - The inline editor draft is owned by this module.
 *   - Draft includes assessmentWeights (Phase 3).
 *   - Save sends assessmentWeights to AcademyDisciplines.
 *
 * CHARACTER DETAIL STATE:
 *   - _activeCharacterTab is module-scoped. Reset to 'main' whenever
 *     the selected character changes.
 *   - Mode (student / instructor) is persisted in AcademyUI.
 *
 * USAGE:
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
    var AcademyTournamentAggregator = window.AcademyTournamentAggregator;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    // Lazy / degraded accessors.
    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getAcademyEnrolments() { return window.AcademyEnrolments || null; }
    function getAcademySocialScore() { return window.AcademySocialScore || null; }

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
        if (!AcademyUI || typeof AcademyUI.getCharacterMode !== 'function') {
            missing.push('AcademyUI.getCharacterMode');
        }
        if (!AcademyUI || typeof AcademyUI.setCharacterMode !== 'function') {
            missing.push('AcademyUI.setCharacterMode');
        }

        if (!AcademyAggregator ||
            typeof AcademyAggregator.getClassListViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassListViewModel');
        }
        if (!AcademyAggregator ||
            typeof AcademyAggregator.getClassViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassViewModel');
        }
        if (!AcademyAggregator ||
            typeof AcademyAggregator.getWeeklyTeamsViewViewModel !== 'function') {
            missing.push('AcademyAggregator.getWeeklyTeamsViewViewModel');
        }
        if (!AcademyAggregator ||
            typeof AcademyAggregator.getLocationViewViewModel !== 'function') {
            missing.push('AcademyAggregator.getLocationViewViewModel');
        }
        if (!AcademyAggregator ||
            typeof AcademyAggregator.getRankingViewViewModel !== 'function') {
            missing.push('AcademyAggregator.getRankingViewViewModel');
        }
        if (!AcademyAggregator ||
            typeof AcademyAggregator.getDisciplineListViewModel !== 'function') {
            missing.push('AcademyAggregator.getDisciplineListViewModel');
        }

        if (!AcademyTournamentAggregator ||
            typeof AcademyTournamentAggregator.getExamViewModel !== 'function') {
            missing.push('AcademyTournamentAggregator.getExamViewModel');
        }

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
        return DomUtils.escapeAttribute(value);
    }

    function getMinWeek() {
        return CalendarConstants.MIN_WEEK;
    }

    function getMaxWeek() {
        return CalendarConstants.MAX_WEEK;
    }

    function getClassDetailModule() {
        return window.AcademyClassDetail || window.ClassDetail || null;
    }

    function getCharacterDetailModule() {
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

    function getTournamentViewModule() {
        return window.AcademyTournamentView || null;
    }

    function getTournamentEventsModule() {
        return window.AcademyTournamentEvents || null;
    }

    function getGradesEditorModule() {
        return window.AcademyGradesEditor || null;
    }

    function notify(message, type) {
        if (window.NotificationSystem &&
            typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type || 'info');
        }
    }

    // ============================================================
    // CLASS VM MEMBERSHIP CHECK
    // ============================================================
    //
    // Does the character appear in the class VM's roster?
    //
    // The class VM stitches the instructor into the roster with
    // role: 'instructor'. Students come in with role: 'trainee'.
    // Membership therefore covers both the roster and the instructor
    // relationship, which is the correct answer to "should the
    // character selection survive a class switch".

    function isCharacterInClassVM(charId, classVM) {
        if (!charId || !classVM) {
            return false;
        }
        var target = String(charId);

        if (classVM.instructorId &&
            String(classVM.instructorId) === target) {
            return true;
        }

        if (Array.isArray(classVM.students)) {
            for (var i = 0; i < classVM.students.length; i++) {
                var s = classVM.students[i];
                if (s && String(s.id) === target) {
                    return true;
                }
            }
        }

        return false;
    }

    // ============================================================
    // VIEW DEFINITIONS
    // ============================================================

    var VIEWS = [
        { id: 'people',       label: 'People' },
        { id: 'tournaments',  label: 'Exams' },
        { id: 'weeklyTeams',  label: 'Weekly Teams' },
        { id: 'rankings',     label: 'Rankings' },
        { id: 'disciplines',  label: 'Disciplines' },
        { id: 'locations',    label: 'Locations' }
    ];

    // ============================================================
    // CHARACTER DETAIL — MODULE STATE
    // ============================================================

    var _activeCharacterTab = 'main';
    var _lastCharacterId = null;

    function getActiveCharacterTab() {
        return _activeCharacterTab;
    }

    function setActiveCharacterTab(tab) {
        _activeCharacterTab = tab || 'main';
    }

    function resetCharacterTabIfChanged(charId) {
        var normalised = charId ? String(charId) : null;
        if (_lastCharacterId !== normalised) {
            _lastCharacterId = normalised;
            _activeCharacterTab = 'main';
        }
    }

    // ============================================================
    // VIEW-SCOPED SELECTION STATE
    // ============================================================

    var _selectedExamClassId = null;
    var _selectedRankingClassId = null;
    var _selectedWeeklyTeamsClassId = null;
    var _selectedWeeklyTeamId = null;
    var _selectedLocationId = null;

    // ============================================================
    // DISCIPLINE EDITOR — MODULE STATE
    // ============================================================

    var _selectedDisciplineId = null;
    var _disciplineDraft = null;
    var _disciplineDraftMode = 'empty';
    var _disciplineDraftErrors = {};

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
            container.innerHTML =
                '<p class="empty-state">Academy view dependencies not loaded.</p>';
            return;
        }

        var view = AcademyUI.getSelectedView();

        container.innerHTML =
            renderViewNav(view) +
            renderBody(view);

        bindEvents(container);

        if (window.AcademyCRUDModals &&
            typeof window.AcademyCRUDModals.setOnChangeCallback === 'function') {
            window.AcademyCRUDModals.setOnChangeCallback(refreshView);
        }
        if (window.AcademyTournamentEvents &&
            typeof window.AcademyTournamentEvents.setOnChangeCallback === 'function') {
            window.AcademyTournamentEvents.setOnChangeCallback(refreshView);
        }

        mountGradesEditorIfPresent();
    }

    // ============================================================
    // VIEW NAV
    // ============================================================

    function renderViewNav(activeView) {
        var html = '<div class="academy-view-nav">';

        for (var i = 0; i < VIEWS.length; i++) {
            var v = VIEWS[i];
            var isActive = v.id === activeView;
            html += '<button class="academy-view-btn' +
                        (isActive ? ' active' : '') + '" ' +
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
            case 'tournaments':
                return renderTournamentView();
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
                '<p class="empty-state">' + escapeHtml(label) +
                    ' view coming soon.</p>' +
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
                        '<p class="empty-state">' +
                            'Select a class to view its members.' +
                        '</p>' +
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

        var classes = AcademyAggregator.getClassListViewModel() || [];

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var isSelected = classId && String(classId) === String(cls.id);
            html += '<option value="' + escapeAttribute(cls.id) + '" ' +
                (isSelected ? 'selected' : '') + '>' +
                escapeHtml(cls.name) +
                '</option>';
        }

        html += '</select>';
        html += '<button id="academy-add-class-btn" class="primary small" ' +
                    'type="button">+ Add Class</button>';
        html += '</div>';

        html += '<div class="academy-top-right">';
        html += '<label class="academy-top-label">Week:</label>';
        html += '<input type="number" id="academy-week-input" ' +
                    'class="academy-week-input" ' +
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

        html += '<input type="text" id="academy-people-search" ' +
                    'class="academy-people-search" ' +
                    'placeholder="Search..." ' +
                    'value="' + escapeAttribute(search) + '">';

        html += '<label class="academy-filter-label">Role:</label>';
        html += '<select id="academy-people-role" class="academy-people-role">';
        html += '<option value="all" ' +
                    (role === 'all' ? 'selected' : '') + '>All</option>';
        html += '<option value="trainee" ' +
                    (role === 'trainee' ? 'selected' : '') + '>Trainees</option>';
        html += '<option value="instructor" ' +
                    (role === 'instructor' ? 'selected' : '') + '>Instructors</option>';
        html += '</select>';

        html += '<label class="academy-filter-label">Status:</label>';
        html += '<select id="academy-people-status" class="academy-people-status">';
        html += '<option value="active" ' +
                    (status === 'active' ? 'selected' : '') + '>Active</option>';
        html += '<option value="eliminated" ' +
                    (status === 'eliminated' ? 'selected' : '') + '>Eliminated</option>';
        html += '<option value="deceased" ' +
                    (status === 'deceased' ? 'selected' : '') + '>Deceased</option>';
        html += '<option value="all" ' +
                    (status === 'all' ? 'selected' : '') + '>All</option>';
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
                if (statusFilter === 'deceased' && !isDeceased) { return false; }
                if (statusFilter === 'active' && isDeceased) { return false; }
            }
            return true;
        });

        if (filtered.length === 0) {
            return '<p class="empty-state small">' +
                        'No characters match the current filters.' +
                    '</p>';
        }

        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var s = filtered[i];
            var isSelected = selectedCharId &&
                String(selectedCharId) === String(s.id);

            var classes = 'academy-character-row';
            if (isSelected) { classes += ' selected'; }
            if (s.deceased) { classes += ' deceased'; }

            html += '<div class="' + classes + '" ' +
                        'data-character-id="' + escapeAttribute(s.id) + '">';

            html += '<div class="academy-character-row-main">';
            html += '<span class="academy-character-name">' +
                        escapeHtml(s.name) +
                    '</span>';
            if (s.role === 'instructor') {
                html += '<span class="academy-character-role-badge">' +
                            'Instructor</span>';
            }
            html += '</div>';

            if (s.status) {
                html += '<div class="academy-character-row-status">' +
                            escapeHtml(s.status) +
                        '</div>';
            }

            html += '</div>';
        }

        return html;
    }

    function renderDetailPanel(classVM, charId) {
        var html = '<div class="academy-people-detail" id="academy-people-detail">';

        if (charId) {
            resetCharacterTabIfChanged(charId);
            html += renderCharacterDetailContent(classVM, charId);
        } else {
            _lastCharacterId = null;
            _activeCharacterTab = 'main';
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
        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return '<p class="empty-state">Character queries not available.</p>';
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            return '<p class="empty-state">Character not found.</p>';
        }

        var CharacterDetail = getCharacterDetailModule();
        if (CharacterDetail && typeof CharacterDetail.renderHTML === 'function') {
            try {
                return CharacterDetail.renderHTML(char, classVM, {
                    week: AcademyUI.getDisplayWeek(),
                    mode: AcademyUI.getCharacterMode(charId),
                    tab: _activeCharacterTab,
                    classId: AcademyUI.getSelectedClassId()
                });
            } catch (e) {
                console.warn('[AcademyView] CharacterDetail.renderHTML failed:', e);
            }
        }

        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' + escapeHtml(CQ.getDisplayName(char)) +
                '</h3>' +
                '<p class="empty-state small">' +
                    'Character detail view coming soon.' +
                '</p>' +
            '</div>'
        );
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
        if (!charId) {
            unmountGradesEditor();
            return;
        }

        if (_activeCharacterTab !== 'grades') {
            unmountGradesEditor();
            return;
        }

        var CQ = getCharacterQueries();
        if (!CQ || !CQ.getCharacterById(charId)) {
            unmountGradesEditor();
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        var classVM = classId
            ? AcademyAggregator.getClassViewModel(classId)
            : null;

        var CharacterDetail = getCharacterDetailModule();
        if (!CharacterDetail ||
            typeof CharacterDetail.mountGradesEditor !== 'function') {
            return;
        }

        try {
            CharacterDetail.mountGradesEditor(charId, classVM, {
                week: AcademyUI.getDisplayWeek(),
                tab: _activeCharacterTab,
                classId: classId
            });
        } catch (e) {
            console.warn('[AcademyView] mountGradesEditor failed:', e);
        }
    }

    function unmountGradesEditor() {
        var GE = getGradesEditorModule();
        if (GE && typeof GE.unmount === 'function') {
            try { GE.unmount(); } catch (e) { /* ignore */ }
        }
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

        _selectedExamClassId = vm.classId;

        return Renderer.renderHTML(vm);
    }

    // ============================================================
    // DISCIPLINE VIEW + INLINE EDITOR
    // ============================================================

    function renderDisciplineView() {
        var Renderer = getDisciplineViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Disciplines');
        }

        var filters = AcademyUI.getFilter('disciplines') || {};

        var listVM = AcademyAggregator.getDisciplineListViewModel(filters);
        var editorVM = buildDisciplineEditorVM();

        return Renderer.renderHTML({
            disciplines: listVM.disciplines,
            selected: editorVM,
            editorMode: _disciplineDraftMode,
            filters: filters,
            total: listVM.total
        });
    }

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
            availableInstructors = instructors.map(function(c) {
                return {
                    id: c.id,
                    name: CQ.getDisplayName(c)
                };
            });
        }

        var schemePreview = '';
        var GradeSchemes = window.AcademyGradeSchemes;
        if (GradeSchemes && typeof GradeSchemes.getRangeLabel === 'function') {
            schemePreview = GradeSchemes.getRangeLabel(draft.gradeScheme);
        }

        var schemePresetId = (draft.gradeScheme && draft.gradeScheme.id) || 'numeric';

        var instructorNames = AcademyAggregator.getInstructorNamesForDiscipline
            ? AcademyAggregator.getInstructorNamesForDiscipline({
                instructorIds: draft.instructorIds || []
            })
            : [];

        // Phase 3: expose assessment types and weights.
        var assessmentTypes = [];
        var AD = window.AcademyDisciplines;
        if (AD && typeof AD.getValidAssessmentTypes === 'function') {
            assessmentTypes = AD.getValidAssessmentTypes();
        }

        var assessmentWeights = draft.assessmentWeights || {};

        return {
            id: isNew ? null : draft.id,
            name: draft.name,
            type: draft.type,
            startWeek: draft.startWeek,
            endWeek: draft.endWeek,
            weeklyHours: draft.weeklyHours,
            weight: draft.weight,
            instructorIds: draft.instructorIds || [],
            instructorNames: instructorNames,
            availableInstructors: availableInstructors,
            gradeScheme: draft.gradeScheme,
            schemePresetId: schemePresetId,
            schemePreview: schemePreview,
            assessmentTypes: assessmentTypes,
            assessmentWeights: assessmentWeights,
            fieldErrors: _disciplineDraftErrors || {},
            isNew: isNew
        };
    }

    /**
     * Get a fresh copy of the domain default assessment weights.
     */
    function getDefaultAssessmentWeights() {
        var AD = window.AcademyDisciplines;
        if (AD && typeof AD.getDefaultAssessmentWeights === 'function') {
            return AD.getDefaultAssessmentWeights();
        }
        return {};
    }

    function initializeDraftFromDiscipline(disciplineId) {
        var AD = window.AcademyDisciplines;
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

        var weights;
        if (typeof AD.getAssessmentWeights === 'function') {
            weights = AD.getAssessmentWeights(record.id);
        } else {
            weights = getDefaultAssessmentWeights();
        }

        _disciplineDraft = {
            id: record.id,
            name: record.name || '',
            type: record.type || 'mandatory',
            startWeek: typeof record.startWeek === 'number' ? record.startWeek : 1,
            endWeek: typeof record.endWeek === 'number' ? record.endWeek : 52,
            weeklyHours: typeof record.weeklyHours === 'number' ? record.weeklyHours : 1,
            weight: typeof record.weight === 'number' ? record.weight : 1,
            instructorIds: Array.isArray(record.instructorIds) ? record.instructorIds.slice() : [],
            gradeScheme: GradeSchemes.normalizeScheme(record.gradeScheme),
            assessmentWeights: weights
        };
    }

    function initializeNewDraft() {
        var GradeSchemes = window.AcademyGradeSchemes;
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
            startWeek: 1,
            endWeek: 52,
            weeklyHours: 1,
            weight: 1,
            instructorIds: [],
            gradeScheme: GradeSchemes.getDefaultScheme(),
            assessmentWeights: getDefaultAssessmentWeights()
        };
    }

    function clearDraft() {
        _selectedDisciplineId = null;
        _disciplineDraft = null;
        _disciplineDraftMode = 'empty';
        _disciplineDraftErrors = {};
    }

    function updateDisciplinePreviewInPlace() {
        var GradeSchemes = window.AcademyGradeSchemes;
        if (!GradeSchemes || !_disciplineDraft) { return; }

        var previewEl = document.querySelector('.academy-discipline-scheme-preview-text');
        if (!previewEl) { return; }

        previewEl.textContent = GradeSchemes.getRangeLabel(_disciplineDraft.gradeScheme) || '';
    }

    function applySchemePreset(presetId) {
        var GradeSchemes = window.AcademyGradeSchemes;
        if (!GradeSchemes || !_disciplineDraft) { return; }

        if (presetId === 'custom') {
            _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme({
                id: 'custom',
                label: _disciplineDraft.gradeScheme.label || 'Custom Scheme',
                bands: _disciplineDraft.gradeScheme.bands || []
            });
            return;
        }

        var preset = GradeSchemes.getPreset(presetId);
        if (!preset) { return; }

        _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme(preset);
    }

    // ============================================================
    // LOCATION VIEW
    // ============================================================

    function renderLocationView() {
        var Renderer = getLocationViewModule();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return renderPlaceholder('Locations');
        }

        var filters = AcademyUI.getFilter('locations') || {};
        var week = AcademyUI.getDisplayWeek();

        var vm = AcademyAggregator.getLocationViewViewModel(
            filters,
            week,
            _selectedLocationId
        );

        if (!vm.selected) {
            _selectedLocationId = null;
        }

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

        var vm = AcademyAggregator.getRankingViewViewModel(
            _selectedRankingClassId,
            week
        );

        _selectedRankingClassId = vm.classId;

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

        var vm = AcademyAggregator.getWeeklyTeamsViewViewModel(
            _selectedWeeklyTeamsClassId,
            week,
            _selectedWeeklyTeamId
        );

        _selectedWeeklyTeamsClassId = vm.classId;
        _selectedWeeklyTeamId = vm.selectedTeamId;

        return Renderer.renderHTML(vm);
    }

    // ============================================================
    // EVENT WIRING
    // ============================================================

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
    // DELEGATED CLICK - TOP-LEVEL DISPATCHER
    // ============================================================

    function handleDelegatedClick(e) {
        var target = e.target;

        var viewBtn = target.closest('.academy-view-btn');
        if (viewBtn) {
            e.preventDefault();
            handleViewSwitch(viewBtn.dataset.view);
            return;
        }

        if (target.closest('#academy-add-class-btn')) {
            e.preventDefault();
            handleAddClass();
            return;
        }

        if (target.closest('#academy-add-location-btn')) {
            e.preventDefault();
            if (window.AcademyCRUDModals) {
                window.AcademyCRUDModals.openLocationForm(null);
            }
            return;
        }

        if (handleExamClick(e, target)) { return; }
        if (handleWeeklyTeamsClick(e, target)) { return; }
        if (handleRankingClick(e, target)) { return; }
        if (handleSocialScoreClick(e, target)) { return; }
        if (handleDisciplineClick(e, target)) { return; }
        if (handleLocationClick(e, target)) { return; }
        if (handlePeopleClick(e, target)) { return; }
        if (handleCharacterDetailClick(e, target)) { return; }
    }

    // ============================================================
    // DELEGATED CLICK - EXAMS VIEW
    // ============================================================

    function handleExamClick(e, target) {
        var actionEl = target.closest('[data-action]');
        if (!actionEl) { return false; }

        var action = actionEl.dataset.action;
        var Events = getTournamentEventsModule();
        if (!Events) { return false; }

        var examActions = [
            'create-exam', 'delete-exam', 'toggle-pool-member',
            'add-round', 'remove-round', 'auto-generate-round',
            'add-match', 'edit-match', 'complete-match', 'remove-match',
            'complete-exam'
        ];
        if (examActions.indexOf(action) === -1) {
            return false;
        }

        e.preventDefault();

        var currentExamId = _getCurrentExamId();

        switch (action) {
            case 'create-exam':
                Events.createExam(
                    _selectedExamClassId,
                    AcademyUI.getDisplayWeek()
                );
                return true;

            case 'delete-exam':
                if (currentExamId) { Events.deleteExam(currentExamId); }
                return true;

            case 'toggle-pool-member':
                if (currentExamId) {
                    Events.togglePoolMember(
                        currentExamId, actionEl.dataset.poolId
                    );
                }
                return true;

            case 'add-round':
                if (currentExamId) { Events.addRound(currentExamId); }
                return true;

            case 'remove-round':
                if (currentExamId) {
                    Events.removeRound(
                        currentExamId,
                        parseInt(actionEl.dataset.roundIndex, 10)
                    );
                }
                return true;

            case 'auto-generate-round':
                if (currentExamId) {
                    Events.autoGenerateRound(
                        currentExamId,
                        parseInt(actionEl.dataset.roundIndex, 10)
                    );
                }
                return true;

            case 'add-match':
                if (currentExamId) {
                    Events.addMatchManual(
                        currentExamId,
                        parseInt(actionEl.dataset.roundIndex, 10)
                    );
                }
                return true;

            case 'edit-match':
                if (currentExamId) {
                    Events.editMatch(
                        currentExamId,
                        parseInt(actionEl.dataset.roundIndex, 10),
                        parseInt(actionEl.dataset.matchIndex, 10)
                    );
                }
                return true;

            case 'complete-match':
                if (currentExamId) {
                    Events.completeMatch(
                        currentExamId,
                        parseInt(actionEl.dataset.roundIndex, 10),
                        parseInt(actionEl.dataset.matchIndex, 10)
                    );
                }
                return true;

            case 'remove-match':
                if (currentExamId) {
                    Events.removeMatch(
                        currentExamId,
                        parseInt(actionEl.dataset.roundIndex, 10),
                        parseInt(actionEl.dataset.matchIndex, 10)
                    );
                }
                return true;

            case 'complete-exam':
                if (currentExamId) { Events.completeExam(currentExamId); }
                return true;
        }

        return false;
    }

    function _getCurrentExamId() {
        if (!_selectedExamClassId) { return null; }
        var TQ = window.TournamentQueries;
        if (!TQ || typeof TQ.getExamForClassAndWeek !== 'function') {
            return null;
        }
        var exam = TQ.getExamForClassAndWeek(
            _selectedExamClassId, AcademyUI.getDisplayWeek()
        );
        return exam ? exam.id : null;
    }

    // ============================================================
    // DELEGATED CLICK - WEEKLY TEAMS VIEW
    // ============================================================

    function handleWeeklyTeamsClick(e, target) {
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
            return true;
        }

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
            return true;
        }

        return false;
    }

    // ============================================================
    // DELEGATED CLICK - RANKINGS VIEW
    // ============================================================

    function handleRankingClick(e, target) {
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
            return true;
        }

        return false;
    }

    // ============================================================
    // DELEGATED CLICK - SOCIAL SCORE (Phase 5)
    // ============================================================

    function handleSocialScoreClick(e, target) {
        var editBtn = target.closest('[data-action="edit-social-score"]');
        if (editBtn) {
            e.preventDefault();
            var charId = editBtn.dataset.characterId;
            if (charId && window.AcademyCRUDModals &&
                typeof window.AcademyCRUDModals.openSocialScoreForm === 'function') {
                window.AcademyCRUDModals.openSocialScoreForm(charId);
            }
            return true;
        }

        return false;
    }

    // ============================================================
    // DELEGATED CLICK - DISCIPLINES VIEW
    // ============================================================

    function handleDisciplineClick(e, target) {
        if (target.closest('#academy-add-discipline-btn')) {
            e.preventDefault();
            initializeNewDraft();
            refreshView();
            return true;
        }

        var disciplineAction = target.closest(
            '[data-action="apply-scheme-preset"], ' +
            '[data-action="add-band"], ' +
            '[data-action="remove-band"], ' +
            '[data-action="reset-assessment-weights"], ' +
            '[data-action="save-discipline"], ' +
            '[data-action="cancel-discipline"], ' +
            '[data-action="delete-discipline"]'
        );
        if (disciplineAction) {
            e.preventDefault();
            handleDisciplineEditorAction(disciplineAction);
            return true;
        }

        var disciplineRow = target.closest('.academy-discipline-row');
        if (disciplineRow) {
            e.preventDefault();
            var disciplineId = disciplineRow.dataset.disciplineId;
            if (disciplineId) {
                initializeDraftFromDiscipline(disciplineId);
                refreshView();
            }
            return true;
        }

        return false;
    }

    function handleDisciplineEditorAction(actionEl) {
        var action = actionEl.dataset.action;
        var GradeSchemes = window.AcademyGradeSchemes;

        switch (action) {
            case 'apply-scheme-preset': {
                if (!_disciplineDraft || !GradeSchemes) { return; }
                var presetSelect = document.querySelector(
                    '[data-discipline-field="schemePresetId"]'
                );
                var presetId = presetSelect ? presetSelect.value : 'numeric';
                applySchemePreset(presetId);
                refreshView();
                return;
            }

            case 'add-band': {
                if (!_disciplineDraft) { return; }
                var bands = _disciplineDraft.gradeScheme.bands || [];
                if (bands.length >= (GradeSchemes.MAX_BANDS || 26)) {
                    notify('Too many bands.', 'error');
                    return;
                }
                bands.push({ label: '', minPercent: 0 });
                _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme({
                    id: _disciplineDraft.gradeScheme.id,
                    label: _disciplineDraft.gradeScheme.label,
                    bands: bands
                });
                refreshView();
                return;
            }

            case 'remove-band': {
                if (!_disciplineDraft) { return; }
                var idx = parseInt(actionEl.dataset.bandIndex, 10);
                if (isNaN(idx)) { return; }
                var currentBands = _disciplineDraft.gradeScheme.bands || [];
                if (currentBands.length <= 1) {
                    notify('A scheme must have at least one band.', 'error');
                    return;
                }
                currentBands.splice(idx, 1);
                _disciplineDraft.gradeScheme = GradeSchemes.normalizeScheme({
                    id: _disciplineDraft.gradeScheme.id,
                    label: _disciplineDraft.gradeScheme.label,
                    bands: currentBands
                });
                refreshView();
                return;
            }

            case 'reset-assessment-weights': {
                if (!_disciplineDraft) { return; }
                _disciplineDraft.assessmentWeights = getDefaultAssessmentWeights();
                refreshView();
                return;
            }

            case 'save-discipline':
                saveDisciplineDraft();
                return;

            case 'cancel-discipline':
                if (_disciplineDraftMode === 'edit' && _selectedDisciplineId) {
                    initializeDraftFromDiscipline(_selectedDisciplineId);
                } else {
                    clearDraft();
                }
                refreshView();
                return;

            case 'delete-discipline': {
                var discId = actionEl.dataset.disciplineId;
                if (discId && window.AcademyCRUDModals &&
                    typeof window.AcademyCRUDModals.openDisciplineDelete === 'function') {
                    window.AcademyCRUDModals.openDisciplineDelete(discId);
                }
                return;
            }

            default:
                return;
        }
    }

    // ============================================================
    // DELEGATED CLICK - LOCATIONS VIEW
    // ============================================================

    function handleLocationClick(e, target) {
        // Add Location — emitted by academy-location-view.js.
        var addBtn = target.closest('[data-action="add-location"]');
        if (addBtn) {
            e.preventDefault();
            if (window.AcademyCRUDModals &&
                typeof window.AcademyCRUDModals.openLocationForm === 'function') {
                window.AcademyCRUDModals.openLocationForm(null);
            }
            return true;
        }

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
            return true;
        }

        var actionEl = target.closest('[data-action]');
        if (actionEl) {
            var action = actionEl.dataset.action;
            var lid = actionEl.dataset.locationId;
            if (lid && (action === 'edit-location' || action === 'delete-location')) {
                e.preventDefault();
                handleLocationAction(action, lid);
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // DELEGATED CLICK - PEOPLE VIEW
    // ============================================================

    function handlePeopleClick(e, target) {
        var charRow = target.closest(
            '.academy-character-row, .academy-student-row'
        );
        if (charRow) {
            e.preventDefault();
            handleCharacterSelect(charRow.dataset.characterId);
            return true;
        }

        var actionEl = target.closest('[data-action]');
        if (actionEl) {
            var action = actionEl.dataset.action;
            var classId = actionEl.dataset.classId;
            var disciplineId = actionEl.dataset.disciplineId;

            if (classId && (
                action === 'add-character' ||
                action === 'edit-class' ||
                action === 'delete-class'
            )) {
                e.preventDefault();
                handleClassAction(action, classId);
                return true;
            }

            if (disciplineId && action === 'delete-discipline') {
                e.preventDefault();
                handleDisciplineAction(action, disciplineId);
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // DELEGATED CLICK - CHARACTER DETAIL (shared)
    // ============================================================

    function handleCharacterDetailClick(e, target) {
        var tabBtn = target.closest('.academy-character-tab-btn');
        if (tabBtn) {
            e.preventDefault();
            var tabId = tabBtn.dataset.tab;
            if (tabId) {
                setActiveCharacterTab(tabId);
                refreshView();
            }
            return true;
        }

        var dropOutBtn = target.closest('[data-action="drop-out-character"]');
        if (dropOutBtn) {
            e.preventDefault();
            handleDropOut(dropOutBtn.dataset.characterId);
            return true;
        }

        var enrollBtn = target.closest('[data-action="enroll-discipline"]');
        if (enrollBtn) {
            e.preventDefault();
            handleEnrollDiscipline(enrollBtn.dataset.characterId);
            return true;
        }

        var leaveBtn = target.closest('[data-action="leave-discipline"]');
        if (leaveBtn) {
            e.preventDefault();
            handleLeaveDiscipline(
                leaveBtn.dataset.characterId,
                leaveBtn.dataset.disciplineId
            );
            return true;
        }

        var instructorDiscRow = target.closest('.academy-instructor-discipline-row');
        if (instructorDiscRow) {
            e.preventDefault();
            var discId = instructorDiscRow.dataset.disciplineId;
            if (discId) {
                initializeDraftFromDiscipline(discId);
                AcademyUI.setSelectedView('disciplines');
                refreshView();
            }
            return true;
        }

        var addGroupStudentBtn = target.closest('[data-action="add-group-student"]');
        if (addGroupStudentBtn) {
            e.preventDefault();
            handleAddGroupStudent(addGroupStudentBtn.dataset.groupKey);
            return true;
        }

        var removeGroupStudentBtn = target.closest('[data-action="remove-group-student"]');
        if (removeGroupStudentBtn) {
            e.preventDefault();
            handleRemoveGroupStudent(
                removeGroupStudentBtn.dataset.groupKey,
                removeGroupStudentBtn.dataset.characterId
            );
            return true;
        }

        var actionEl = target.closest('[data-action]');
        if (actionEl) {
            var action = actionEl.dataset.action;
            var charId = actionEl.dataset.characterId;

            if (action === 'view-full-character' && charId) {
                e.preventDefault();
                handleViewFullCharacter(charId);
                return true;
            }

            if (action === 'edit-character' && charId) {
                e.preventDefault();
                handleEditCharacter(charId);
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // DELEGATED CHANGE
    // ============================================================

    function handleDelegatedChange(e) {
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
            AcademyUI.setFilter('people', 'role', target.value);
            refreshView();
            return;
        }
        if (target.id === 'academy-people-status') {
            AcademyUI.setFilter('people', 'status', target.value);
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
            AcademyUI.setFilter('disciplines', 'type', target.value);
            refreshView();
            return;
        }

        if (target.id === 'academy-location-type-filter') {
            AcademyUI.setFilter('locations', 'type', target.value);
            refreshView();
            return;
        }
    }

    function commitDisplayWeek(value) {
        var week = parseInt(value, 10);
        if (isNaN(week) || week < getMinWeek() || week > getMaxWeek()) {
            return false;
        }
        AcademyUI.setDisplayWeek(week);
        refreshView();
        return true;
    }

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

            case 'startWeek': {
                var sw = parseInt(inputEl.value, 10);
                _disciplineDraft.startWeek = isNaN(sw) ? 1 : sw;
                return;
            }

            case 'endWeek': {
                var ew = parseInt(inputEl.value, 10);
                _disciplineDraft.endWeek = isNaN(ew) ? 52 : ew;
                return;
            }

            case 'weeklyHours': {
                var wh = parseFloat(inputEl.value);
                _disciplineDraft.weeklyHours = isNaN(wh) ? 1 : wh;
                return;
            }

            case 'weight': {
                var wt = parseFloat(inputEl.value);
                _disciplineDraft.weight = isNaN(wt) ? 1 : wt;
                return;
            }

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

            case 'schemeLabel': {
                _disciplineDraft.gradeScheme.label = inputEl.value;
                return;
            }

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
            var mp = parseInt(inputEl.value, 10);
            bands[idx].minPercent = isNaN(mp) ? 0 : mp;
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

        var raw = inputEl.value;
        if (raw === '' || raw === null || raw === undefined) {
            _disciplineDraft.assessmentWeights[type] = null;
            return;
        }

        var num = parseFloat(raw);
        if (isNaN(num)) {
            _disciplineDraft.assessmentWeights[type] = null;
            return;
        }

        _disciplineDraft.assessmentWeights[type] = num;
    }

    // ============================================================
    // DELEGATED INPUT
    // ============================================================

    function handleDelegatedInput(e) {
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
    // EVENT HANDLERS
    // ============================================================

    function handleViewSwitch(viewId) {
        if (!viewId) { return; }
        if (viewId !== 'disciplines') {
            clearDraft();
        }
        if (AcademyUI.setSelectedView(viewId)) {
            refreshView();
        }
    }

    /**
     * Handle a class selection from the top bar.
     *
     * SEMANTICS:
     *   - AcademyUI.selectClass is a pure setter: it clears the
     *     character selection on every class change.
     *   - This handler preserves the character selection when the
     *     character is still a member of (or the instructor for) the
     *     newly selected class.
     *   - The check uses the class VM, which is the same projection
     *     the People view uses to render the roster. So "member" here
     *     means exactly what the roster shows.
     */
    function handleClassSelect(classId) {
        if (!classId) {
            AcademyUI.selectClass(null);
            refreshView();
            return;
        }

        // Remember the previously selected character.
        var prevCharId = AcademyUI.getSelectedCharacterId();

        // Apply the class change. This clears the character selection.
        AcademyUI.selectClass(classId);

        // Restore the character selection if the character is still
        // a member of the new class.
        if (prevCharId) {
            var classVM = AcademyAggregator.getClassViewModel(classId);
            if (classVM && isCharacterInClassVM(prevCharId, classVM)) {
                AcademyUI.selectCharacter(prevCharId);
            }
        }

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

    function handleViewFullCharacter(charId) {
        if (window.CharacterDetail &&
            typeof window.CharacterDetail.open === 'function') {
            window.CharacterDetail.open(charId);
        } else {
            notify('Character detail view not available.', 'error');
        }
    }

    function handleEditCharacter(charId) {
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
        var CRUD = window.AcademyCRUDModals;
        if (!CRUD) {
            notify('CRUD module not available.', 'error');
            return;
        }
        switch (action) {
            case 'add-character':
                CRUD.openAddCharacterToClass(classId);
                break;
            case 'edit-class':
                CRUD.openClassForm(classId);
                break;
            case 'delete-class':
                CRUD.openClassDelete(classId);
                break;
            default:
                break;
        }
    }

    function handleDisciplineAction(action, disciplineId) {
        var CRUD = window.AcademyCRUDModals;
        if (!CRUD) {
            notify('CRUD module not available.', 'error');
            return;
        }
        switch (action) {
            case 'delete-discipline':
                CRUD.openDisciplineDelete(disciplineId);
                break;
            default:
                break;
        }
    }

    function handleLocationAction(action, locationId) {
        var CRUD = window.AcademyCRUDModals;
        if (!CRUD) {
            notify('CRUD module not available.', 'error');
            return;
        }
        switch (action) {
            case 'edit-location':
                CRUD.openLocationForm(locationId);
                break;
            case 'delete-location':
                CRUD.openLocationDelete(locationId);
                break;
            default:
                break;
        }
    }

    function handleAddClass() {
        if (window.AcademyCRUDModals &&
            typeof window.AcademyCRUDModals.openClassForm === 'function') {
            window.AcademyCRUDModals.openClassForm(null);
        } else {
            notify('CRUD module not available.', 'error');
        }
    }

    // ============================================================
    // CHARACTER DETAIL — HANDLERS
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

        var allDisciplines = window.AcademyDisciplines &&
            typeof window.AcademyDisciplines.getDisciplines === 'function'
            ? (window.AcademyDisciplines.getDisciplines() || [])
            : [];

        if (allDisciplines.length === 0) {
            notify('No disciplines exist yet.', 'error');
            return;
        }

        var enrolledIds = {};
        var current = AE.getStudentDisciplines(charId, classId);
        for (var i = 0; i < current.length; i++) {
            enrolledIds[String(current[i])] = true;
        }

        var candidates = allDisciplines.filter(function(d) {
            if (!d || !d.id) { return false; }
            return !enrolledIds[String(d.id)];
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
        var discipline = window.AcademyDisciplines &&
            typeof window.AcademyDisciplines.getDiscipline === 'function'
            ? window.AcademyDisciplines.getDiscipline(disciplineId)
            : null;
        if (discipline && discipline.name) {
            disciplineName = '"' + discipline.name + '"';
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

        var AG = window.AcademyGroups;
        if (!AG || typeof AG.getGroupStudents !== 'function') {
            notify('Auto-groups module not available.', 'error');
            return;
        }

        var currentIds = AG.getGroupStudents(groupKey) || [];
        var currentSet = {};
        for (var i = 0; i < currentIds.length; i++) {
            currentSet[String(currentIds[i])] = true;
        }

        var CQ = getCharacterQueries();
        if (!CQ) {
            notify('Character queries not available.', 'error');
            return;
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

        var AG = window.AcademyGroups;
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
    // DISCIPLINE DRAFT SAVE
    // ============================================================

    function saveDisciplineDraft() {
        if (!_disciplineDraft) { return; }

        var AcademyDisciplines = window.AcademyDisciplines;
        var GradeSchemes = window.AcademyGradeSchemes;
        if (!AcademyDisciplines || !GradeSchemes) {
            notify('Discipline module not available.', 'error');
            return;
        }

        var scheme = GradeSchemes.normalizeScheme(_disciplineDraft.gradeScheme);

        var errors = {};

        if (!_disciplineDraft.name || !_disciplineDraft.name.trim()) {
            errors.name = 'Name is required.';
        }

        var sw = parseInt(_disciplineDraft.startWeek, 10);
        var ew = parseInt(_disciplineDraft.endWeek, 10);
        if (isNaN(sw) || sw < getMinWeek() || sw > getMaxWeek()) {
            errors.startWeek = 'Start week must be ' + getMinWeek() + '\u2013' + getMaxWeek() + '.';
        }
        if (isNaN(ew) || ew < getMinWeek() || ew > getMaxWeek()) {
            errors.endWeek = 'End week must be ' + getMinWeek() + '\u2013' + getMaxWeek() + '.';
        }
        if (!isNaN(sw) && !isNaN(ew) && sw > ew) {
            errors.endWeek = 'End week cannot be before start week.';
        }

        var wh = parseFloat(_disciplineDraft.weeklyHours);
        if (isNaN(wh) || wh < AcademyDisciplines.MIN_WEEKLY_HOURS || wh > AcademyDisciplines.MAX_WEEKLY_HOURS) {
            errors.weeklyHours = 'Weekly hours must be ' +
                AcademyDisciplines.MIN_WEEKLY_HOURS + '\u2013' +
                AcademyDisciplines.MAX_WEEKLY_HOURS + '.';
        }

        var wt = parseFloat(_disciplineDraft.weight);
        if (isNaN(wt) || wt < AcademyDisciplines.MIN_WEIGHT || wt > AcademyDisciplines.MAX_WEIGHT) {
            errors.weight = 'Weight must be ' +
                AcademyDisciplines.MIN_WEIGHT + '\u2013' +
                AcademyDisciplines.MAX_WEIGHT + '.';
        }

        var schemeCheck = GradeSchemes.validateScheme(scheme);
        if (!schemeCheck.valid) {
            errors.bands = schemeCheck.errors.length > 0
                ? schemeCheck.errors.map(function(err) { return err.message; }).join(' ')
                : 'Grade scheme is invalid.';
        }

        // ---- Assessment weights validation ----
        var weights = _disciplineDraft.assessmentWeights || {};
        var weightKeys = Object.keys(weights);
        var weightError = null;
        for (var wi = 0; wi < weightKeys.length; wi++) {
            var wv = weights[weightKeys[wi]];
            if (wv === null || wv === undefined) { continue; }
            if (typeof wv !== 'number' || !isFinite(wv) ||
                wv < AcademyDisciplines.MIN_ASSESSMENT_WEIGHT ||
                wv > AcademyDisciplines.MAX_ASSESSMENT_WEIGHT) {
                weightError = 'All assessment weights must be numbers between ' +
                    AcademyDisciplines.MIN_ASSESSMENT_WEIGHT + ' and ' +
                    AcademyDisciplines.MAX_ASSESSMENT_WEIGHT + '.';
                break;
            }
        }
        if (weightError) {
            errors.assessmentWeights = weightError;
        }

        if (Object.keys(errors).length > 0) {
            _disciplineDraftErrors = errors;
            refreshView();
            return;
        }

        _disciplineDraftErrors = {};

        var payload = {
            name: _disciplineDraft.name.trim(),
            type: _disciplineDraft.type,
            startWeek: sw,
            endWeek: ew,
            weeklyHours: wh,
            weight: wt,
            instructorIds: (_disciplineDraft.instructorIds || []).slice(),
            gradeScheme: scheme,
            assessmentWeights: _disciplineDraft.assessmentWeights || null
        };

        var isNew = _disciplineDraftMode === 'create';
        var targetId = _disciplineDraft.id;

        var promise;
        if (isNew) {
            promise = AcademyDisciplines.create(payload);
        } else {
            promise = AcademyDisciplines.update(targetId, payload);
        }

        promise.then(function(result) {
            if (result && result.success) {
                var savedId = result.data && result.data.id
                    ? result.data.id
                    : (result.data && result.data.discipline && result.data.discipline.id
                        ? result.data.discipline.id
                        : targetId);

                if (savedId) {
                    initializeDraftFromDiscipline(savedId);
                } else {
                    clearDraft();
                }
                refreshView();
            }
        }).catch(function(err) {
            console.warn('[AcademyView] Discipline save failed:', err);
            notify('Failed to save discipline.', 'error');
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
