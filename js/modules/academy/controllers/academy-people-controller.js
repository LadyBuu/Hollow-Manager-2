/**
 * modules/academy/controllers/academy-people-controller.js
 * Academy People Controller
 *
 * Path: js/modules/academy/controllers/academy-people-controller.js
 *
 * The People feature controller. Owns the People view.
 *
 * WHAT THIS OWNS:
 *   - Rendering the People view into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by the
 *     shell for events inside the host.
 *   - The active character tab.
 *   - The People search debounce timer.
 *   - The class selection flow.
 *   - The character selection flow.
 *   - The class detail panel.
 *   - The character detail panel.
 *   - The character-mode checkbox.
 *   - The Drop Out flow.
 *   - The Remove from Class flow.
 *   - The Enroll Discipline flow.
 *   - The Leave Discipline flow.
 *   - The Edit Social Score modal.
 *   - The class CRUD modals.
 *   - The class-disciplines picker modal.
 *   - The inline grades editor and schedule grid sub-editors.
 *   - The schedule-assign flow (empty cells).
 *   - The schedule-slot-open flow (occupied cells).
 *   - The teaching-groups flow: toggling discipline containers,
 *     opening the inline candidate picker, adding a student, and
 *     removing a student. All writes route to
 *     AcademyTeachingGroups.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The class selection, character selection, display week,
 *     people filter, and character mode.
 *   - Re-rendering the shell.
 *   - Domain reads and writes.
 *   - Cross-view navigation.
 *
 * TEACHING GROUPS FLOW:
 *   The tab is scoped to the currently selected class and the
 *   display week. Writes route to AcademyTeachingGroups:
 *     - add:    AcademyTeachingGroups.addMemberToGroup(groupId,
 *               charId, week)
 *     - remove: AcademyTeachingGroups.removeMemberRecord(groupId,
 *               charId)
 *
 *   Removal is COMPLETE — the member entry is deleted, no interval
 *   is truncated, no history is preserved. Students who need to
 *   change their group do so via a correction, not a schedule
 *   change. The historical path (endMembership, which truncates
 *   the interval at a week) is not exposed in this tab.
 *
 *   The candidate picker state (which group's picker is open, and
 *   the candidate list for it) lives in this controller's module
 *   scope. It is passed to the renderer via VM fields prefixed
 *   with an underscore, so the renderer can render it without
 *   owning it.
 *
 * DEPENDENCY DIRECTION:
 *   Shell → registry → this controller.
 *   This controller never references window.AcademyView.
 *
 * RENDER SIGNATURE:
 *   render(host, context)
 *
 *   host    — the HTMLElement the shell allocates.
 *   context — { onChange: function() }
 *
 * DEPENDENCIES (mandatory):
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyCharacterDetailAggregator
 *   - window.CharacterCRUD
 *   - window.NotificationSystem
 *   - window.DomUtils
 *   - window.AcademyClasses
 *
 * DEPENDENCIES (lazy):
 *   - window.AcademyClassDetail
 *   - window.AcademyCharacterDetail
 *   - window.AcademyGradesEditor
 *   - window.CalendarRenderer
 *   - window.AcademyCRUDModals
 *   - window.AcademyClassDisciplinesPicker
 *   - window.AcademyEnrollmentModal
 *   - window.AcademyScheduleAssignModal
 *   - window.AcademyDisciplines
 *   - window.AcademyEnrolments
 *   - window.AcademyEliminations
 *   - window.AcademyTeachingGroups
 *   - window.AcademyTeachingSessions
 *   - window.CharacterQueries
 */

(function() {
    'use strict';

    if (window.__academyPeopleControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyCharacterDetailAggregator = window.AcademyCharacterDetailAggregator;
    var CharacterCRUD = window.CharacterCRUD;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var AcademyClasses = window.AcademyClasses;

    var _missing = [];

    if (!AcademyUI ||
        typeof AcademyUI.getSelectedClassId !== 'function' ||
        typeof AcademyUI.getSelectedCharacterId !== 'function' ||
        typeof AcademyUI.getDisplayWeek !== 'function' ||
        typeof AcademyUI.selectClass !== 'function' ||
        typeof AcademyUI.selectCharacter !== 'function' ||
        typeof AcademyUI.getCharacterMode !== 'function' ||
        typeof AcademyUI.getPeopleFilter !== 'function' ||
        typeof AcademyUI.setPeopleFilter !== 'function' ||
        typeof AcademyUI.setPeopleSearch !== 'function') {
        _missing.push('AcademyUI typed API');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassListViewModel !== 'function' ||
        typeof AcademyAggregator.getClassViewModel !== 'function' ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function' ||
        typeof AcademyAggregator.getPeopleViewModel !== 'function') {
        _missing.push('AcademyAggregator People VMs');
    }
    if (!AcademyCharacterDetailAggregator ||
        typeof AcademyCharacterDetailAggregator.getViewModel !== 'function' ||
        typeof AcademyCharacterDetailAggregator.getScheduleGridViewModel !== 'function' ||
        typeof AcademyCharacterDetailAggregator.getTeachingGroupCandidateViewModel !== 'function') {
        _missing.push('AcademyCharacterDetailAggregator API');
    }
    if (!CharacterCRUD ||
        typeof CharacterCRUD.setMode !== 'function') {
        _missing.push('CharacterCRUD.setMode');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClassInstructorIds !== 'function') {
        _missing.push('AcademyClasses.getClassInstructorIds');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyPeopleController] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyPeopleControllerLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getClassDetailModule() {
        return window.AcademyClassDetail || null;
    }

    function getCharacterDetailModule() {
        return window.AcademyCharacterDetail || null;
    }

    function getGradesEditor() {
        return window.AcademyGradesEditor || null;
    }

    function getCalendarRenderer() {
        return window.CalendarRenderer || null;
    }

    function getCRUDModals() {
        return window.AcademyCRUDModals || null;
    }

    function getDisciplines() {
        return window.AcademyDisciplines || null;
    }

    function getEnrolments() {
        return window.AcademyEnrolments || null;
    }

    function getAcademyEliminations() {
        return window.AcademyEliminations || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getCharacterClasses() {
        return window.AcademyClasses || null;
    }

    function getClassDisciplinesPicker() {
        return window.AcademyClassDisciplinesPicker || null;
    }

    function getEnrollmentModal() {
        return window.AcademyEnrollmentModal || null;
    }

    function getScheduleAssignModal() {
        return window.AcademyScheduleAssignModal || null;
    }

    function getTeachingGroups() {
        return window.AcademyTeachingGroups || null;
    }

    function getTeachingSessions() {
        return window.AcademyTeachingSessions || null;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _host = null;
    var _context = null;

    // Feature state.
    var _activeCharacterTab = 'main';
    var _lastCharacterIdForTab = null;
    var _searchTimer = null;

    // Teaching-groups picker state.
    //
    // _openPickerGroupId      the group whose inline candidate
    //                         picker is open, or null.
    // _pickerCandidates       the candidate list for that picker,
    //                         or null while loading.
    var _openPickerGroupId = null;
    var _pickerCandidates = null;

    // ============================================================
    // CONTEXT NORMALISATION
    // ============================================================

    function normaliseContext(rawContext) {
        var ctx = rawContext && typeof rawContext === 'object'
            ? rawContext
            : {};

        var onChange = typeof ctx.onChange === 'function'
            ? ctx.onChange
            : function() {};

        return { onChange: onChange };
    }

    function getContext() {
        if (_context) { return _context; }
        return normaliseContext(null);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(host, rawContext) {
        if (!host || typeof host !== 'object') {
            return;
        }

        _host = host;
        _context = normaliseContext(rawContext);

        var classId = AcademyUI.getSelectedClassId();
        var charId = AcademyUI.getSelectedCharacterId();
        var week = AcademyUI.getDisplayWeek();

        var html = '';

        try {
            html += renderTopBar(classId, week);
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] renderTopBar threw:', e
            );
            host.innerHTML =
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">' +
                        'Failed to render People view.' +
                    '</p>' +
                '</div>';
            return;
        }

        if (!classId) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">' +
                            'Select a class to view its members.' +
                        '</p>' +
                    '</div>';

            host.innerHTML = html;
            unmountSubEditors();
            return;
        }

        var classVM = null;
        try {
            classVM = AcademyAggregator.getClassViewModel(classId, week);
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] getClassViewModel threw:', e
            );
        }

        if (!classVM) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">Class not found.</p>' +
                    '</div>';
            host.innerHTML = html;
            unmountSubEditors();
            return;
        }

        var peopleVM = null;
        try {
            peopleVM = AcademyAggregator.getPeopleViewModel(classId, {
                filters: AcademyUI.getPeopleFilter(),
                selectedCharacterId: charId,
                week: week
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] getPeopleViewModel threw:', e
            );
            peopleVM = {
                classList: [],
                classId: classId,
                className: classVM.name,
                week: week,
                filters: AcademyUI.getPeopleFilter(),
                people: [],
                totalCount: 0,
                filteredCount: 0
            };
        }

        html += '<div class="academy-body academy-people-layout">';
        html += renderSidebar(peopleVM);
        html += '<div class="academy-people-detail" ' +
                    'id="academy-people-detail">';

        if (charId) {
            resetCharacterTabIfChanged(charId);
            html += renderCharacterDetailContent(classVM, charId);
        } else {
            _lastCharacterIdForTab = null;
            _activeCharacterTab = 'main';
            // Leaving the character detail panel clears any
            // picker state that was scoped to the character.
            clearPickerState();
            html += renderClassDetailContent(classVM);
        }

        html += '</div>';
        html += '</div>';

        host.innerHTML = html;

        unmountSubEditors();
        if (charId) {
            if (_activeCharacterTab === 'grades') {
                mountGradesEditorIfPresent(charId, classId, week);
            } else if (_activeCharacterTab === 'schedule') {
                mountScheduleGridIfPresent(charId, week);
            }
        }
    }

    // ============================================================
    // TOP BAR
    // ============================================================

    function renderTopBar(selectedClassId, week) {
        var classes = AcademyAggregator.getClassListViewModel() || [];

        var html = '';
        html += '<div class="academy-top-bar">';

        html += '<div class="academy-top-left">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-class-select">Class:</label>';
        html += '<select id="academy-class-select" ' +
                    'class="academy-class-select">';
        html += '<option value="">Select a class...</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var isSelected = selectedClassId &&
                String(selectedClassId) === String(cls.id);
            html += '<option value="' +
                        DomUtils.escapeAttribute(cls.id) + '"' +
                        (isSelected ? ' selected' : '') + '>' +
                        DomUtils.escapeHtml(cls.name) +
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
                    'value="' +
                        DomUtils.escapeAttribute(String(week)) +
                    '" ' +
                    'min="1" max="52">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // SIDEBAR
    // ============================================================

    function renderSidebar(vm) {
        var filters = vm.filters || {
            search: '',
            role: 'all',
            status: 'active'
        };

        var html = '<div class="academy-people-sidebar">';

        html += '<div class="academy-character-filters">';

        html += '<input type="text" id="academy-people-search" ' +
                    'class="academy-people-search" ' +
                    'placeholder="Search..." ' +
                    'value="' +
                        DomUtils.escapeAttribute(filters.search || '') +
                    '">';

        html += '<label class="academy-filter-label" ' +
                    'for="academy-people-role">Role:</label>';
        html += '<select id="academy-people-role" ' +
                    'class="academy-people-role">';
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
        html += '<select id="academy-people-status" ' +
                    'class="academy-people-status">';
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
        if (!person || !person.id) { return ''; }

        var classes = 'academy-character-row';
        if (person.isSelected) { classes += ' selected'; }
        if (person.deceased) { classes += ' deceased'; }
        if (person.eliminated) { classes += ' eliminated'; }

        var html = '';
        html += '<div class="' + classes + '" ' +
                    'data-character-id="' +
                        DomUtils.escapeAttribute(person.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-character-row-main">';
        html += '<span class="academy-character-name">' +
                    DomUtils.escapeHtml(person.name || 'Unknown') +
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
                        '\u26a0 Eliminated' +
                        DomUtils.escapeHtml(weekText) +
                    '</div>';
        }

        if (person.status && !person.eliminated) {
            html += '<div class="academy-character-row-status">' +
                        DomUtils.escapeHtml(person.status) +
                    '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL PANELS
    // ============================================================

    function renderClassDetailContent(classVM) {
        var ClassDetail = getClassDetailModule();
        if (ClassDetail && typeof ClassDetail.renderHTML === 'function') {
            try {
                return ClassDetail.renderHTML(classVM);
            } catch (e) {
                console.warn(
                    '[AcademyPeopleController] AcademyClassDetail.' +
                    'renderHTML threw:', e
                );
            }
        }
        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' +
                    DomUtils.escapeHtml(classVM.name || 'Class') +
                '</h3>' +
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

        var vm = null;
        try {
            vm = AcademyCharacterDetailAggregator.getViewModel(charId, {
                classId: classId,
                week: week,
                mode: mode,
                tab: _activeCharacterTab
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] character detail ' +
                'getViewModel threw:', e
            );
        }

        if (!vm) {
            return '<p class="empty-state">Character not found.</p>';
        }

        // Attach teaching-groups picker state to the VM. Underscore
        // prefix marks these as controller-owned feature state; the
        // renderer reads them but does not mutate them. Only
        // meaningful when the active tab is teachingGroups; setting
        // them on every render is harmless.
        vm._openPickerGroupId = _openPickerGroupId;
        vm._pickerCandidates = _pickerCandidates;

        var CharacterDetail = getCharacterDetailModule();
        if (CharacterDetail &&
            typeof CharacterDetail.renderHTML === 'function') {
            try {
                return CharacterDetail.renderHTML(vm);
            } catch (e) {
                console.warn(
                    '[AcademyPeopleController] AcademyCharacterDetail.' +
                    'renderHTML threw:', e
                );
            }
        }

        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' +
                    DomUtils.escapeHtml(vm.character.name) +
                '</h3>' +
                '<p class="empty-state small">' +
                    'Character detail view not available.' +
                '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // CHARACTER TAB STATE
    // ============================================================

    function resetCharacterTabIfChanged(charId) {
        var normalised = charId ? String(charId) : null;
        if (_lastCharacterIdForTab !== normalised) {
            _lastCharacterIdForTab = normalised;
            _activeCharacterTab = 'main';
            clearPickerState();
        }
    }

    function clearPickerState() {
        _openPickerGroupId = null;
        _pickerCandidates = null;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        // ---- Character row selection ----
        var charRow = target.closest(
            '.academy-character-row, .academy-student-row'
        );
        if (charRow && charRow.dataset && charRow.dataset.characterId) {
            e.preventDefault();
            handleCharacterSelect(charRow.dataset.characterId);
            return;
        }

        // ---- Add Class button ----
        if (target.closest('#academy-add-class-btn')) {
            e.preventDefault();
            handleAddClass();
            return;
        }

        // ---- Character tab buttons ----
        var tabBtn = target.closest('.academy-character-tab-btn');
        if (tabBtn && tabBtn.dataset && tabBtn.dataset.tab) {
            e.preventDefault();
            _activeCharacterTab = tabBtn.dataset.tab;
            // Any pending picker is scoped to the tab that opened
            // it; leaving the tab abandons the picker.
            clearPickerState();
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        // ---- Delegated action dispatch ----
        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;
        if (!isNonEmptyString(action)) { return; }

        e.preventDefault();
        dispatchAction(action, actionEl);
    }

    function handleChange(e) {
        var target = e.target;
        if (!target) { return; }

        if (target.id === 'academy-character-mode-checkbox') {
            handleCharacterModeToggle(target.checked);
            return;
        }

        if (target.id === 'academy-class-select') {
            handleClassSelect(target.value);
            return;
        }

        if (target.id === 'academy-week-input') {
            commitDisplayWeek(target.value);
            return;
        }

        if (target.id === 'academy-people-role') {
            AcademyUI.setPeopleRole(target.value);
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        if (target.id === 'academy-people-status') {
            AcademyUI.setPeopleStatus(target.value);
            var c = getContext();
            c.onChange();
            return;
        }
    }

    function handleInput(e) {
        var target = e.target;
        if (!target || !target.id) { return; }

        if (target.id === 'academy-people-search') {
            debouncePeopleSearch(target.value);
            return;
        }
    }

    function handleKeydown(e) {
        var target = e.target;
        if (!target || e.key !== 'Enter') { return; }

        if (target.id === 'academy-week-input') {
            e.preventDefault();
            commitDisplayWeek(target.value);
            return;
        }
    }

    // ============================================================
    // ACTION DISPATCH
    // ============================================================

    function dispatchAction(action, el) {
        switch (action) {
            // ---- Character-scoped ----
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

            // ---- Score card ----
            case 'edit-social-score':
                handleEditSocialScore(el.dataset.characterId);
                return;

            // ---- Class-scoped ----
            case 'edit-class-add-character':
                handleClassAction('add-character', el.dataset.classId);
                return;
            case 'edit-class-disciplines':
                handleClassAction('disciplines', el.dataset.classId);
                return;
            case 'edit-class':
                handleClassAction('edit-class', el.dataset.classId);
                return;
            case 'delete-class':
                handleClassAction('delete-class', el.dataset.classId);
                return;

            // ---- Schedule grid ----
            case 'schedule-assign':
                handleScheduleAssign(el.dataset.day, el.dataset.hour);
                return;
            case 'schedule-slot-open':
                handleScheduleSlotOpen(el);
                return;

            // ---- Teaching groups ----
            case 'teaching-groups-toggle-discipline':
                handleToggleTeachingGroupDiscipline(el.dataset.disciplineId);
                return;
            case 'teaching-groups-add-student':
                handleOpenTeachingGroupPicker(el.dataset.groupId);
                return;
            case 'teaching-groups-add-student-cancel':
                handleCloseTeachingGroupPicker();
                return;
            case 'teaching-groups-add-student-submit':
                handleSubmitTeachingGroupAdd(el.dataset.groupId);
                return;
            case 'teaching-groups-remove-student':
                handleRemoveTeachingGroupStudent(
                    el.dataset.groupId,
                    el.dataset.characterId
                );
                return;

            default:
                return;
        }
    }

    // ============================================================
    // CLASS SELECTION
    // ============================================================

    function handleClassSelect(classId) {
        if (!classId) {
            AcademyUI.selectClass(null);
            var ctx = getContext();
            ctx.onChange();
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

        var c = getContext();
        c.onChange();
    }

    function isCharacterInClassVM(charId, classVM) {
        if (!charId || !classVM || !classVM.id) { return false; }
        var target = String(charId);

        var week = AcademyUI.getDisplayWeek();
        var instructorIds = [];
        try {
            instructorIds = AcademyClasses.getClassInstructorIds(
                classVM.id, week
            );
        } catch (e) {
            instructorIds = [];
        }
        if (Array.isArray(instructorIds)) {
            for (var ii = 0; ii < instructorIds.length; ii++) {
                if (String(instructorIds[ii]) === target) {
                    return true;
                }
            }
        }

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
        var ctx = getContext();
        ctx.onChange();
    }

    function handleAddClass() {
        var CRUD = getCRUDModals();
        if (CRUD && typeof CRUD.openClassForm === 'function') {
            CRUD.openClassForm(null);
        } else {
            notify('CRUD module not available.', 'error');
        }
    }

    function handleClassAction(action, classId) {
        switch (action) {
            case 'disciplines':
                handleOpenDisciplinesPicker(classId);
                return;
            default:
                break;
        }

        var CRUD = getCRUDModals();
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

    function handleOpenDisciplinesPicker(classId) {
        if (!isNonEmptyString(classId)) {
            notify('Class ID is required.', 'error');
            return;
        }

        var Picker = getClassDisciplinesPicker();
        if (!Picker || typeof Picker.openModal !== 'function') {
            notify(
                'Class-disciplines picker is not available.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        try {
            Picker.openModal(classId, {
                week: week,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] picker openModal threw:', e
            );
            notify('Failed to open the disciplines picker.', 'error');
        }
    }

    // ============================================================
    // WEEK COMMIT
    // ============================================================

    function commitDisplayWeek(value) {
        var accepted = AcademyUI.setDisplayWeek(value);
        if (accepted) {
            var ctx = getContext();
            ctx.onChange();
        }
    }

    // ============================================================
    // CHARACTER MODE
    // ============================================================

    function handleCharacterModeToggle(checked) {
        var charId = AcademyUI.getSelectedCharacterId();
        if (!charId) { return; }

        var newMode = checked ? 'instructor' : 'student';

        if (newMode === 'instructor' &&
            (_activeCharacterTab === 'grades' ||
                _activeCharacterTab === 'teams')) {
            _activeCharacterTab = 'main';
        }
        if (newMode === 'student' &&
            _activeCharacterTab === 'teachingGroups') {
            _activeCharacterTab = 'main';
        }

        // A mode change invalidates the picker state.
        clearPickerState();

        CharacterCRUD.setMode(charId, newMode)
            .then(function(result) {
                if (result && result.success) {
                    var ctx = getContext();
                    ctx.onChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] setMode failed:', err
                );
                notify('Failed to change character mode.', 'error');
            });
    }

    // ============================================================
    // CHARACTER FLOWS
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

        var AE = getAcademyEliminations();
        if (!AE || typeof AE.addStandalone !== 'function') {
            notify('Elimination module not available.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        AE.addStandalone(charId, week, 'Dropped out').then(function(result) {
            if (result && result.success) {
                var ctx = getContext();
                ctx.onChange();
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] Drop Out failed:', err
            );
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
                    var ctx = getContext();
                    ctx.onChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] removeClassById failed:', err
                );
                notify(
                    'Failed to remove character from class.', 'error'
                );
            });
    }

    function handleEditSocialScore(charId) {
        var CRUD = getCRUDModals();
        if (CRUD && typeof CRUD.openSocialScoreForm === 'function') {
            CRUD.openSocialScoreForm(
                charId,
                AcademyUI.getSelectedClassId(),
                AcademyUI.getDisplayWeek()
            );
        }
    }

    // ============================================================
    // DISCIPLINE ENROLMENT FLOWS
    // ============================================================

    function handleEnrollDiscipline(charId) {
        if (!isNonEmptyString(charId)) {
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify(
                'Select a class before enrolling in disciplines.',
                'error'
            );
            return;
        }

        var Modal = getEnrollmentModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Enrollment modal is not available.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var mode = AcademyUI.getCharacterMode(charId);
        var title = mode === 'instructor'
            ? 'Assign to teach a discipline'
            : null;

        try {
            Modal.openModal(charId, {
                classId: classId,
                week: week,
                title: title,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] enrollment modal ' +
                'openModal threw:', e
            );
            notify('Failed to open the enrollment modal.', 'error');
        }
    }

    function handleLeaveDiscipline(charId, disciplineId) {
        if (!charId || !disciplineId) { return; }

        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        var AE = getEnrolments();
        if (!AE || typeof AE.leave !== 'function') {
            notify('Enrollment module not available.', 'error');
            return;
        }

        var disciplineName = 'this discipline';
        var AD = getDisciplines();
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
                var ctx = getContext();
                ctx.onChange();
            } else if (result && result.message) {
                notify(result.message, 'error');
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] Leave failed:', err
            );
            notify('Failed to leave discipline.', 'error');
        });
    }

    // ============================================================
    // GRADES EDITOR SUB-EDITOR
    // ============================================================

    function mountGradesEditorIfPresent(charId, classId, week) {
        var GE = getGradesEditor();
        if (!GE || typeof GE.mount !== 'function') {
            return;
        }

        var container = document.getElementById(
            'academy-grades-editor-host'
        );
        if (!container) { return; }

        try {
            GE.mount(container, charId, classId, week);
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] mountGradesEditor failed:', e
            );
        }
    }

    function unmountGradesEditor() {
        var GE = getGradesEditor();
        if (GE && typeof GE.unmount === 'function') {
            try {
                GE.unmount();
            } catch (e) {
                // Ignore.
            }
        }
    }

    // ============================================================
    // SCHEDULE GRID SUB-EDITOR
    // ============================================================

    function mountScheduleGridIfPresent(charId, week) {
        var host = document.getElementById('academy-schedule-host');
        if (!host) { return; }

        var Renderer = getCalendarRenderer();
        if (!Renderer || typeof Renderer.renderGrid !== 'function') {
            host.innerHTML = '<p class="empty-state small">' +
                'Calendar renderer not available.' +
                '</p>';
            return;
        }

        var mode = AcademyUI.getCharacterMode(charId);

        var gridVM = null;
        if (typeof AcademyCharacterDetailAggregator
                .getScheduleGridViewModel === 'function') {
            try {
                gridVM = AcademyCharacterDetailAggregator
                    .getScheduleGridViewModel(charId, {
                        week: week,
                        mode: mode
                    });
            } catch (e) {
                console.warn(
                    '[AcademyPeopleController] ' +
                    'getScheduleGridViewModel threw:', e
                );
            }
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
            mode: gridVM.mode,
            canEdit: gridVM.canEdit,
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
            console.warn(
                '[AcademyPeopleController] renderGrid failed:', e
            );
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

    function unmountSubEditors() {
        unmountGradesEditor();
        unmountScheduleGrid();
    }

    // ============================================================
    // SCHEDULE ASSIGN FLOW
    // ============================================================

    function handleScheduleAssign(dayRaw, hourRaw) {
        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify(
                'Select a class before assigning a slot.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var day = parseInt(dayRaw, 10);
        if (isNaN(day)) {
            notify('Invalid day.', 'error');
            return;
        }

        var hour = parseInt(hourRaw, 10);
        if (isNaN(hour)) {
            notify('Invalid hour.', 'error');
            return;
        }

        var Modal = getScheduleAssignModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Schedule assign modal is not available.',
                'error'
            );
            return;
        }

        try {
            Modal.openModal({
                charId: String(charId),
                classId: String(classId),
                week: week,
                day: day,
                startHour: hour,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] schedule assign modal ' +
                'openModal threw:', e
            );
            notify('Failed to open the assign modal.', 'error');
        }
    }

    // ============================================================
    // SCHEDULE SLOT OPEN FLOW
    // ============================================================

    function handleScheduleSlotOpen(el) {
        if (!el || !el.dataset) { return; }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify(
                'Select a class before editing a slot.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var day = parseInt(el.dataset.day, 10);
        if (isNaN(day)) {
            notify('Invalid day.', 'error');
            return;
        }

        var hour = parseInt(el.dataset.hour, 10);
        if (isNaN(hour)) {
            notify('Invalid hour.', 'error');
            return;
        }

        var mode = isNonEmptyString(el.dataset.mode)
            ? String(el.dataset.mode)
            : 'remove-student';

        var groupId = isNonEmptyString(el.dataset.groupId)
            ? String(el.dataset.groupId)
            : null;

        var sessionId = isNonEmptyString(el.dataset.sessionId)
            ? String(el.dataset.sessionId)
            : null;

        if (!groupId) {
            notify(
                'Cannot open this slot: group ID is missing.',
                'error'
            );
            return;
        }

        var charId = AcademyUI.getSelectedCharacterId();
        if (mode === 'remove-student' && !isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        // ---- Resolve display context ----
        var disciplineName = '';
        var duration = null;
        var memberCount = null;
        var sessionCount = null;

        var TG = getTeachingGroups();
        if (TG && typeof TG.getGroup === 'function') {
            var group = null;
            try {
                group = TG.getGroup(groupId);
            } catch (e) {
                group = null;
            }

            if (group) {
                var AD = getDisciplines();
                if (AD && typeof AD.getDiscipline === 'function') {
                    var disc = AD.getDiscipline(group.disciplineId);
                    if (disc && isNonEmptyString(disc.name)) {
                        disciplineName = disc.name;
                    }
                }

                if (typeof TG.getActiveMembers === 'function') {
                    try {
                        var members = TG.getActiveMembers(groupId, week);
                        if (Array.isArray(members)) {
                            memberCount = members.length;
                        }
                    } catch (e) {
                        memberCount = null;
                    }
                }
            }
        }

        var TS = getTeachingSessions();
        if (TS && groupId) {
            var sessions = [];
            if (typeof TS.getSessionsForGroup === 'function') {
                try {
                    sessions = TS.getSessionsForGroup(groupId) || [];
                } catch (e) {
                    sessions = [];
                }
            }

            if (Array.isArray(sessions)) {
                sessionCount = sessions.length;

                var targetSession = null;
                for (var i = 0; i < sessions.length; i++) {
                    var s = sessions[i];
                    if (!s) { continue; }
                    if (sessionId && String(s.id) === sessionId) {
                        targetSession = s;
                        break;
                    }
                    if (!targetSession &&
                        s.day === day &&
                        s.startTime === hour) {
                        targetSession = s;
                    }
                }

                if (targetSession && typeof targetSession.duration === 'number') {
                    duration = targetSession.duration;
                }
            }
        }

        var Modal = getScheduleAssignModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Schedule assign modal is not available.',
                'error'
            );
            return;
        }

        try {
            Modal.openModal({
                mode: mode,
                charId: mode === 'remove-student' ? String(charId) : null,
                classId: String(classId),
                week: week,
                day: day,
                startHour: hour,
                groupId: groupId,
                sessionId: sessionId,
                disciplineName: disciplineName,
                duration: duration,
                memberCount: memberCount,
                sessionCount: sessionCount,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] schedule slot-open modal ' +
                'openModal threw:', e
            );
            notify('Failed to open the slot editor.', 'error');
        }
    }

    // ============================================================
    // TEACHING GROUPS FLOW
    // ============================================================

    function handleToggleTeachingGroupDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return; }

        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) { return; }

        // The collapse key is (charId, disciplineId). Character is
        // included so two instructors in the same session do not
        // share collapse state.
        if (typeof AcademyUI.toggleExpanded !== 'function') {
            // AcademyUI lacks the API; the renderer will fall back
            // to expanded. Nothing to do.
            return;
        }

        var key = 'teachingGroup:' + String(charId) + ':' + String(disciplineId);
        AcademyUI.toggleExpanded(key);

        var ctx = getContext();
        ctx.onChange();
    }

    function handleOpenTeachingGroupPicker(groupId) {
        if (!isNonEmptyString(groupId)) { return; }

        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var vm = null;
        try {
            vm = AcademyCharacterDetailAggregator
                .getTeachingGroupCandidateViewModel(charId, groupId, {
                    week: week
                });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] ' +
                'getTeachingGroupCandidateViewModel threw:', e
            );
            vm = null;
        }

        if (!vm) {
            notify('Could not open the candidate list.', 'error');
            return;
        }

        _openPickerGroupId = String(groupId);
        _pickerCandidates = vm.candidates;

        var ctx = getContext();
        ctx.onChange();
    }

    function handleCloseTeachingGroupPicker() {
        if (_openPickerGroupId === null && _pickerCandidates === null) {
            return;
        }
        clearPickerState();
        var ctx = getContext();
        ctx.onChange();
    }

    function handleSubmitTeachingGroupAdd(groupId) {
        if (!isNonEmptyString(groupId)) { return; }

        // Read the selected candidate from the DOM. The picker
        // rendered a select element inside the tab body.
        var selectEl = document.querySelector(
            '.academy-teaching-group-candidate-picker' +
            '[data-group-id="' + cssEscape(groupId) + '"] ' +
            '.academy-teaching-group-candidate-select'
        );
        if (!selectEl) {
            notify('Could not read the selected student.', 'error');
            return;
        }

        var charId = selectEl.value;
        if (!isNonEmptyString(charId)) {
            notify('Select a student first.', 'error');
            return;
        }

        var TG = getTeachingGroups();
        if (!TG || typeof TG.addMemberToGroup !== 'function') {
            notify('Teaching groups module not available.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        TG.addMemberToGroup(groupId, charId, week)
            .then(function(result) {
                if (result && result.success) {
                    clearPickerState();
                    var ctx = getContext();
                    ctx.onChange();
                } else if (result && result.message) {
                    notify(result.message, 'error');
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] addMemberToGroup failed:',
                    err
                );
                notify('Failed to add student to group.', 'error');
            });
    }

    function handleRemoveTeachingGroupStudent(groupId, charId) {
        if (!isNonEmptyString(groupId) || !isNonEmptyString(charId)) {
            return;
        }

        var TG = getTeachingGroups();
        if (!TG || typeof TG.removeMemberRecord !== 'function') {
            notify('Teaching groups module not available.', 'error');
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

        if (!confirm(
            'Remove ' + name + ' from this group?\n\n' +
            'This is a correction. The student is completely removed ' +
            'from the group; there is no record of them having been in ' +
            'it. To change a group, remove here and re-assign from the ' +
            'schedule grid.'
        )) {
            return;
        }

        TG.removeMemberRecord(groupId, charId)
            .then(function(result) {
                if (result && result.success) {
                    // If the picker was open on this group, refresh
                    // its candidates too — the removed student is
                    // now eligible.
                    if (_openPickerGroupId &&
                        String(_openPickerGroupId) === String(groupId)) {
                        handleOpenTeachingGroupPicker(groupId);
                        return;
                    }
                    var ctx = getContext();
                    ctx.onChange();
                } else if (result && result.message) {
                    notify(result.message, 'error');
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] removeMemberRecord failed:',
                    err
                );
                notify('Failed to remove student from group.', 'error');
            });
    }

    /**
     * Minimal CSS.escape shim. Used to build a selector for a
     * groupId, which is a generated string but could in principle
     * contain characters that need escaping.
     */
    function cssEscape(value) {
        if (typeof CSS !== 'undefined' &&
            typeof CSS.escape === 'function') {
            return CSS.escape(String(value));
        }
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    // ============================================================
    // SEARCH DEBOUNCE
    // ============================================================

    function debouncePeopleSearch(value) {
        if (_searchTimer) {
            clearTimeout(_searchTimer);
        }
        _searchTimer = setTimeout(function() {
            _searchTimer = null;
            AcademyUI.setPeopleSearch(value);
            var ctx = getContext();
            ctx.onChange();
        }, 150);
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        unmountSubEditors();

        if (_searchTimer) {
            clearTimeout(_searchTimer);
            _searchTimer = null;
        }

        _activeCharacterTab = 'main';
        _lastCharacterIdForTab = null;
        clearPickerState();

        _host = null;
        _context = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyPeopleController = Object.freeze({
        render: render,
        handleClick: handleClick,
        handleChange: handleChange,
        handleInput: handleInput,
        handleKeydown: handleKeydown,
        unmount: unmount
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyPeopleController;
        var missing = [];

        var required = [
            'render',
            'handleClick',
            'handleChange',
            'handleInput',
            'handleKeydown',
            'unmount'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyPeopleController] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();