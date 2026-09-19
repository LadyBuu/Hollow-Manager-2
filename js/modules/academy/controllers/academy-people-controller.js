/**
 * modules/academy/controllers/academy-people-controller.js
 * Academy People Controller
 *
 * Path: js/modules/academy/controllers/academy-people-controller.js
 *
 * The People feature controller. Owns the People view: its render,
 * its character-class and character-instructor flows, the class and
 * character detail panels, and the mounting of the grades editor
 * and schedule grid sub-editors.
 *
 * WHAT THIS OWNS:
 *   - Rendering the People view (top bar, sidebar, detail panel)
 *     into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by the
 *     shell for events inside the host.
 *   - The active character tab (_activeCharacterTab) and the
 *     character-tab reset-on-change bookkeeping
 *     (_lastCharacterIdForTab). Both are feature state.
 *   - The People search debounce timer.
 *   - The class selection flow (select, resolve which character to
 *     preserve, call AcademyUI.selectClass).
 *   - The character selection flow (toggle, call
 *     AcademyUI.selectCharacter).
 *   - The class detail panel (when no character is selected).
 *   - The character detail panel (when a character is selected), and
 *     the tabs within it.
 *   - The character-mode checkbox (student / instructor toggle).
 *     The write routes through CharacterCRUD.setMode.
 *   - The Drop Out flow (AcademyEliminations.addStandalone).
 *   - The Remove from Class flow (AcademyClasses.removeClassById).
 *   - The Enroll / Leave Discipline flows
 *     (AcademyEnrolments.enrol / leave).
 *   - The instructor auto-group Add Student / Remove Student flows
 *     (AcademyGroups.addStudentToGroup / removeStudentFromGroup).
 *   - The Edit Social Score modal (via AcademyCRUDModals).
 *   - The class CRUD modals (add character to class, edit class,
 *     delete class) via AcademyCRUDModals.
 *   - The class-disciplines picker modal
 *     (AcademyClassDisciplinesPicker.openModal).
 *   - The inline grades editor and schedule grid sub-editor
 *     lifecycles.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The class selection, character selection, display week, people
 *     filter, and character mode.
 *   - Re-rendering the shell. When state changes, the controller
 *     calls context.onChange().
 *   - Domain reads and writes. The aggregators produce VMs; the
 *     domain modules perform mutations.
 *   - The class-disciplines picker's modal shell.
 *   - Cross-view navigation.
 *
 * CHARACTER MODE (v27):
 *   The mode is a DOMAIN FACT. It lives on the character record as
 *   `character.mode`. The controller:
 *     - Reads it via AcademyUI.getCharacterMode(charId).
 *     - Writes it via CharacterCRUD.setMode(charId, mode).
 *
 *   The write is a Promise. On success, the controller re-renders
 *   the shell by calling context.onChange().
 *
 * CLASS-DISCIPLINES PICKER (v27):
 *   The "+ Disciplines" button on the class detail panel emits
 *   data-action="edit-class-disciplines" with data-class-id. The
 *   controller opens the picker modal, passing the current display
 *   week and an onClose callback that calls context.onChange().
 *
 * ENROLMENT (BUG-E1):
 *   The "Enroll Discipline" flow sources its candidate list from
 *   AcademyClassDisciplines.getClassDisciplinesForClass(classId),
 *   filtered to offerings active in the display week. It uses
 *   AcademyEnrolments.getStudentDisciplineIds — NOT
 *   getStudentDisciplines — to determine which disciplines the
 *   student is already enrolled in. The two functions have similar
 *   names but different shapes: getStudentDisciplineIds returns
 *   distinct ID strings, getStudentDisciplines returns interval
 *   records.
 *
 *   The picker is still a prompt(). Replacing it with a proper modal
 *   is logged as follow-up E1-ui.
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
 * DEPENDENCIES:
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyCharacterDetailAggregator
 *   - window.AcademyClassDetail
 *   - window.AcademyCharacterDetail
 *   - window.AcademyClassDisciplines         (BUG-E1 — for offerings)
 *   - window.CharacterCRUD                   (v27 — for setMode)
 *   - window.AcademyGradesEditor             (lazy)
 *   - window.CalendarRenderer                (lazy)
 *   - window.AcademyCRUDModals               (lazy)
 *   - window.AcademyClassDisciplinesPicker   (lazy)
 *   - window.AcademyDisciplines              (lazy)
 *   - window.AcademyEnrolments               (lazy)
 *   - window.AcademyEliminations             (lazy)
 *   - window.AcademyGroups                   (lazy)
 *   - window.CharacterQueries                (lazy)
 *   - window.AcademyClasses                  (lazy)
 *   - window.NotificationSystem
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
        typeof AcademyCharacterDetailAggregator.getViewModel !== 'function') {
        _missing.push('AcademyCharacterDetailAggregator.getViewModel');
    }
    if (!CharacterCRUD ||
        typeof CharacterCRUD.setMode !== 'function') {
        _missing.push('CharacterCRUD.setMode');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
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

    function getClassDisciplines() {
        return window.AcademyClassDisciplines || null;
    }

    function getEnrolments() {
        return window.AcademyEnrolments || null;
    }

    function getAcademyEliminations() {
        return window.AcademyEliminations || null;
    }

    function getGroups() {
        return window.AcademyGroups || null;
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
                        window.DomUtils.escapeAttribute(cls.id) + '"' +
                        (isSelected ? ' selected' : '') + '>' +
                        window.DomUtils.escapeHtml(cls.name) +
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
                        window.DomUtils.escapeAttribute(String(week)) +
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
                        window.DomUtils.escapeAttribute(filters.search || '') +
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
                        window.DomUtils.escapeAttribute(person.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-character-row-main">';
        html += '<span class="academy-character-name">' +
                    window.DomUtils.escapeHtml(person.name || 'Unknown') +
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
                        window.DomUtils.escapeHtml(weekText) +
                    '</div>';
        }

        if (person.status && !person.eliminated) {
            html += '<div class="academy-character-row-status">' +
                        window.DomUtils.escapeHtml(person.status) +
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
                    window.DomUtils.escapeHtml(classVM.name || 'Class') +
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
                    window.DomUtils.escapeHtml(vm.character.name) +
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
        }
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
            case 'character-add-group-student':
                handleAddGroupStudent(el.dataset.groupKey);
                return;
            case 'character-remove-group-student':
                handleRemoveGroupStudent(
                    el.dataset.groupKey,
                    el.dataset.characterId
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
    // CHARACTER MODE (v27)
    // ============================================================

    function handleCharacterModeToggle(checked) {
        var charId = AcademyUI.getSelectedCharacterId();
        if (!charId) { return; }

        var newMode = checked ? 'instructor' : 'student';

        // Adjust the active tab BEFORE the write resolves, so that
        // if the write succeeds the re-render immediately shows a
        // valid tab for the new mode.
        if (newMode === 'instructor' &&
            (_activeCharacterTab === 'grades' ||
                _activeCharacterTab === 'teams')) {
            _activeCharacterTab = 'main';
        }
        if (newMode === 'student' &&
            _activeCharacterTab === 'autoGroups') {
            _activeCharacterTab = 'main';
        }

        CharacterCRUD.setMode(charId, newMode)
            .then(function(result) {
                if (result && result.success) {
                    var ctx = getContext();
                    ctx.onChange();
                }
                // On failure, the pipeline has already notified.
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
    // DISCIPLINE ENROLMENT FLOWS (BUG-E1)
    // ============================================================
    //
    // The candidate list is sourced from the CLASS'S OFFERINGS, not
    // the global discipline list.
    //
    // The exclusion of already-enrolled disciplines uses
    // AcademyEnrolments.getStudentDisciplineIds, which returns
    // DISTINCT discipline ID strings. It does NOT use
    // getStudentDisciplines, which returns interval records
    // ({ disciplineId, startWeek, endWeek }[]). The two functions
    // have similar names but different shapes; the ID list is what
    // the exclusion check wants.

    function handleEnrollDiscipline(charId) {
        if (!charId) { return; }

        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify(
                'Select a class before enrolling in disciplines.',
                'error'
            );
            return;
        }

        var AE = getEnrolments();
        if (!AE || typeof AE.enrol !== 'function') {
            notify('Enrollment module not available.', 'error');
            return;
        }

        var ACD = getClassDisciplines();
        if (!ACD ||
            typeof ACD.getClassDisciplinesForClass !== 'function' ||
            typeof ACD.isActiveInWeek !== 'function') {
            notify(
                'Class-discipline module not available.', 'error'
            );
            return;
        }

        var AD = getDisciplines();
        if (!AD || typeof AD.getDiscipline !== 'function') {
            notify('Discipline module not available.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        // ---- Offerings active in the display week ----
        var offerings = ACD.getClassDisciplinesForClass(classId) || [];
        var activeOfferings = [];
        for (var o = 0; o < offerings.length; o++) {
            var rec = offerings[o];
            if (!rec || !rec.disciplineId) { continue; }
            if (!ACD.isActiveInWeek(classId, rec.disciplineId, week)) {
                continue;
            }
            activeOfferings.push(rec);
        }

        if (activeOfferings.length === 0) {
            notify(
                'This class has no discipline offerings active in ' +
                'week ' + week + '.',
                'info'
            );
            return;
        }

        // ---- Exclude already-enrolled ----
        // getStudentDisciplineIds returns an array of distinct
        // discipline ID strings. If the module is older and does not
        // expose it, fall back to no exclusion rather than crashing.
        var currentIds = [];
        if (typeof AE.getStudentDisciplineIds === 'function') {
            try {
                currentIds = AE.getStudentDisciplineIds(charId, classId) || [];
            } catch (e) {
                currentIds = [];
            }
        }
        var enrolledSet = {};
        for (var i = 0; i < currentIds.length; i++) {
            enrolledSet[String(currentIds[i])] = true;
        }

        // ---- Build candidates ----
        var candidates = [];
        for (var c = 0; c < activeOfferings.length; c++) {
            var did = String(activeOfferings[c].disciplineId);
            if (enrolledSet[did]) { continue; }

            var disc = AD.getDiscipline(did);
            if (!disc) { continue; }

            candidates.push({
                id: did,
                name: disc.name || 'Unnamed Discipline'
            });
        }

        candidates.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        if (candidates.length === 0) {
            notify(
                'Character is already enrolled in every active ' +
                'discipline for this class.',
                'info'
            );
            return;
        }

        // ---- Prompt for the choice ----
        var names = candidates.map(function(d, idx) {
            return (idx + 1) + '. ' + d.name;
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

        AE.enrol(charId, classId, picked.id, week).then(function(result) {
            if (result && result.success) {
                var ctx = getContext();
                ctx.onChange();
            } else if (result && result.message) {
                notify(result.message, 'error');
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] Enroll failed:', err
            );
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
    // INSTRUCTOR GROUP FLOWS
    // ============================================================

    function handleAddGroupStudent(groupKey) {
        if (!groupKey) { return; }

        var AG = getGroups();
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
            return CQ.getDisplayName(a).localeCompare(
                CQ.getDisplayName(b)
            );
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
                var ctx = getContext();
                ctx.onChange();
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] Add student to group failed:',
                err
            );
            notify('Failed to add student.', 'error');
        });
    }

    function handleRemoveGroupStudent(groupKey, charId) {
        if (!groupKey || !charId) { return; }

        var AG = getGroups();
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
                var ctx = getContext();
                ctx.onChange();
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] Remove student from group ' +
                'failed:', err
            );
            notify('Failed to remove student.', 'error');
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

        var gridVM = null;
        if (typeof AcademyCharacterDetailAggregator
                .getScheduleGridViewModel === 'function') {
            try {
                gridVM = AcademyCharacterDetailAggregator
                    .getScheduleGridViewModel(charId, week);
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