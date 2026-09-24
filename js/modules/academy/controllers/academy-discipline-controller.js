/**
 * modules/academy/controllers/academy-discipline-controller.js
 * Academy Discipline Controller
 *
 * Path: js/modules/academy/controllers/academy-discipline-controller.js
 *
 * The Disciplines feature controller. Owns the Disciplines view:
 * its render, its event handlers, its editor draft state, its
 * schedule-tab state, and its search debounce.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Disciplines view into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by the
 *     shell for events that occur inside the host.
 *   - The discipline editor draft (name, type, weeks, weight,
 *     grade scheme, assessment weights) and its mode
 *     ('empty' | 'create' | 'edit').
 *   - The active detail-panel tab: 'edit' | 'schedule'.
 *   - The Schedule tab's week (defaults to AcademyUI's display week
 *     on first render; the user can change it locally).
 *   - Per-field and per-band validation errors on the draft.
 *   - The list filter (type, search) as feature state.
 *   - The search debounce timer.
 *   - The editor's live preview (the "range label" text under the
 *     scheme preset row).
 *   - The editor's save, cancel, apply-preset, add-band, remove-band,
 *     and reset-weights actions.
 *   - The "+ Add Discipline" flow (B4-1).
 *   - The discipline delete confirm modal, via AcademyCRUDModals.
 *   - Mounting the calendar grid into the Schedule tab host.
 *   - Mounting the enrollment summary panel into the Schedule tab
 *     summary host, below the grid. (BATCH 3)
 *   - Toggling the summary panel open and closed. (BATCH 3)
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The class selection. The Schedule tab uses
 *     AcademyUI.getSelectedClassId(); there is no second class
 *     selector.
 *   - Re-rendering the shell. When a mutation or draft change should
 *     re-render, the controller calls context.onChange().
 *   - Discipline domain reads and writes. AcademyDisciplines owns
 *     them; AcademyAggregator produces the VMs.
 *   - The schedule projection. AcademyCalendarAggregator owns it;
 *     the controller just mounts the grid into the host.
 *   - The enrollment summary content. AcademyCalendarAggregator
 *     produces the summary VM and
 *     AcademyDisciplineScheduleSummary renders it; the controller
 *     only mounts and wires the toggle.
 *   - Instructor assignment for a discipline. That relationship is
 *     class-scoped and is owned by the class-disciplines picker.
 *     The discipline editor does not offer an instructor picker
 *     (v27).
 *   - The delete-confirm modal's onChange wiring. The shell keeps
 *     that wiring (via AcademyCRUDModals.setOnChangeCallback), and
 *     the controller simply opens the modal.
 *
 * SCHEDULE TAB:
 *   The Schedule tab renders a week selector, a grid host, and an
 *   enrollment summary host. The grid is mounted by this controller
 *   via AcademyCalendarAggregator.getDisciplineScheduleViewModel,
 *   which projects Projector.projectForClassDiscipline. One
 *   discipline, one class, one week, every instructor.
 *
 *   The class is AcademyUI.getSelectedClassId(). When no class is
 *   selected, the controller renders an explicit empty state into
 *   each host instead of inventing a class.
 *
 *   Rest days apply (the grid is class-scoped).
 *
 * ENROLLMENT SUMMARY (BATCH 3):
 *   The panel below the grid answers two questions: how many
 *   students are enrolled in this discipline for this class, and
 *   how many of them do not have a group assigned.
 *
 *   Both questions are answered by
 *   AcademyCalendarAggregator.getDisciplineScheduleSummaryViewModel.
 *   The enrollment population is not week-scoped. The assigned
 *   predicate is not week-scoped either: a student is assigned when
 *   their characterId appears in the members[] array of any teaching
 *   group of this discipline for this class. The week is passed
 *   through only for display and for the elimination flag.
 *
 *   The panel's markup and its disclosure come from
 *   AcademyDisciplineScheduleSummary. This controller mounts the
 *   HTML and toggles the disclosure on click.
 *
 * DRAFT LIFECYCLE:
 *   - Draft is created by openEditor('create'), or by selecting a
 *     discipline row (which initializes from the record).
 *   - Draft is cleared by cancel ('empty' mode).
 *   - Draft is cleared by unmount (view switch away from
 *     Disciplines). This matches pre-S1.3 behavior: switching away
 *     abandons an in-progress edit.
 *   - The list filter is NOT cleared by unmount. This also matches
 *     pre-S1.3: the filter survives a view switch.
 *   - The search debounce timer IS cleared by unmount.
 *
 * B4-1 — "+ ADD DISCIPLINE" BUTTON FIX:
 *   The button used to be id-addressed (#academy-add-discipline-btn)
 *   and had no data-action. The shell routes clicks through
 *   [data-action] elements to this controller's dispatch switch.
 *   Without a data-action, the button never reached the controller.
 *   B4-1 changes the button to data-action="discipline-add" and
 *   adds a matching case here.
 *
 * DEPENDENCY DIRECTION:
 *   Shell → registry → this controller.
 *   This controller never references window.AcademyView.
 *
 * RENDER SIGNATURE:
 *   render(host, context)
 *
 *   host    — the HTMLElement the shell allocates for the active
 *             controller.
 *   context — { onChange: function() }
 *
 * DEPENDENCIES:
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyDisciplines
 *   - window.AcademyDisciplineView
 *   - window.AcademyGradeSchemes
 *   - window.AcademyCalendarAggregator  (lazy; for the Schedule tab)
 *   - window.AcademyDisciplineScheduleSummary (lazy; for the summary panel)
 *   - window.CalendarRenderer           (lazy; for the Schedule tab)
 *   - window.AcademyCRUDModals          (lazy; delete confirm)
 *   - window.NotificationSystem
 *   - window.CalendarConstants
 */

(function() {
    'use strict';

    if (window.__academyDisciplineControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyDisciplines = window.AcademyDisciplines;
    var View = window.AcademyDisciplineView;
    var GradeSchemes = window.AcademyGradeSchemes;
    var NotificationSystem = window.NotificationSystem;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
    }
    if (!AcademyUI ||
        typeof AcademyUI.getSelectedClassId !== 'function') {
        _missing.push('AcademyUI.getSelectedClassId');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getDisciplineListViewModel !== 'function' ||
        typeof AcademyAggregator.getDisciplineEditorViewModel !== 'function') {
        _missing.push('AcademyAggregator discipline VMs');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function' ||
        typeof AcademyDisciplines.create !== 'function' ||
        typeof AcademyDisciplines.update !== 'function' ||
        typeof AcademyDisciplines.getAssessmentWeights !== 'function' ||
        typeof AcademyDisciplines.getDefaultAssessmentWeights !== 'function') {
        _missing.push('AcademyDisciplines API');
    }
    if (!View || typeof View.renderHTML !== 'function') {
        _missing.push('AcademyDisciplineView.renderHTML');
    }
    if (!GradeSchemes ||
        typeof GradeSchemes.normalizeScheme !== 'function' ||
        typeof GradeSchemes.getPreset !== 'function' ||
        typeof GradeSchemes.getDefaultScheme !== 'function') {
        _missing.push('AcademyGradeSchemes API');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyDisciplineController] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyDisciplineControllerLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getCRUDModals() {
        return window.AcademyCRUDModals || null;
    }

    function getCalendarAggregator() {
        return window.AcademyCalendarAggregator || null;
    }

    function getCalendarRenderer() {
        return window.CalendarRenderer || null;
    }

    function getDisciplineScheduleSummary() {
        return window.AcademyDisciplineScheduleSummary || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var VALID_DETAIL_TABS = ['edit', 'schedule'];

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
    //
    // Feature state. The host and context are stashed on each render
    // so event handlers can find them. The draft and filter are the
    // feature's own state; the draft is cleared on unmount, the
    // filter is not.
    //
    // Schedule-tab state:
    //   _activeDisciplineTab   'edit' | 'schedule'
    //   _scheduleWeek          number | null (null = unset; falls
    //                          back to AcademyUI's display week)

    var _host = null;
    var _context = null;

    var _selectedDisciplineId = null;
    var _disciplineDraft = null;
    var _disciplineDraftMode = 'empty';
    var _disciplineDraftErrors = {};

    var _disciplineFilters = { type: 'all', search: '' };
    var _disciplineSearchTimer = null;

    var _activeDisciplineTab = 'edit';
    var _scheduleWeek = null;

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

    // ============================================================
    // SCHEDULE WEEK RESOLUTION
    // ============================================================

    /**
     * Resolve the effective week for the Schedule tab.
     * Priority: explicit `_scheduleWeek`, then AcademyUI's display
     * week. Returns a bounded integer, or null when neither source
     * yields one.
     */
    function resolveScheduleWeek() {
        if (typeof _scheduleWeek === 'number' &&
            _scheduleWeek >= MIN_WEEK &&
            _scheduleWeek <= MAX_WEEK) {
            return _scheduleWeek;
        }

        var display = AcademyUI.getDisplayWeek();
        if (typeof display === 'number' &&
            display >= MIN_WEEK &&
            display <= MAX_WEEK) {
            return display;
        }

        return null;
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

        var listVM = AcademyAggregator.getDisciplineListViewModel(
            _disciplineFilters
        );
        var editorVM = buildEditorVM();
        var scheduleWeek = resolveScheduleWeek();

        var html;
        try {
            html = View.renderHTML({
                disciplines: listVM.disciplines,
                selected: editorVM,
                editorMode: _disciplineDraftMode,
                filters: _disciplineFilters,
                total: listVM.total,
                activeTab: _activeDisciplineTab,
                scheduleWeek: scheduleWeek
            });
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] renderHTML threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to render disciplines.' +
                    '</p>' +
                '</div>';
            return;
        }

        host.innerHTML = html;

        if (_activeDisciplineTab === 'schedule' &&
            _disciplineDraftMode !== 'empty' &&
            _disciplineDraft) {
            mountDisciplineScheduleGridIfPresent(
                _disciplineDraft.id,
                scheduleWeek
            );
        }
    }

    function buildEditorVM() {
        if (_disciplineDraftMode === 'empty' || !_disciplineDraft) {
            return null;
        }
        return AcademyAggregator.getDisciplineEditorViewModel({
            draft: _disciplineDraft,
            isNew: _disciplineDraftMode === 'create',
            errors: _disciplineDraftErrors
        });
    }

    function getContext() {
        if (_context) { return _context; }
        return normaliseContext(null);
    }

    // ============================================================
    // SCHEDULE GRID MOUNT
    // ============================================================

    /**
     * Mount the discipline schedule grid into its host.
     *
     * On every code path where the summary is still meaningful,
     * mountDisciplineScheduleSummaryIfPresent is called. It is a
     * separate host and a separate renderer; its success is
     * independent of the grid's.
     *
     * Skips the grid when:
     *   - the host is absent (the tab body was not rendered)
     *   - the CalendarRenderer is missing
     *   - no disciplineId is available (draft is new; grid needs
     *     a persisted discipline to scope to)
     *   - no class is selected (renders an empty state instead)
     *   - the week is invalid
     *   - the CalendarAggregator is missing
     */
    function mountDisciplineScheduleGridIfPresent(disciplineId, week) {
        var host = document.getElementById(
            'academy-discipline-schedule-host'
        );

        if (!host) {
            // No host: the tab body was not rendered. Skip both.
            return;
        }

        var Renderer = getCalendarRenderer();
        if (!Renderer || typeof Renderer.renderGrid !== 'function') {
            host.innerHTML =
                '<p class="empty-state small">' +
                    'Calendar renderer is not available.' +
                '</p>';
            mountDisciplineScheduleSummaryIfPresent(disciplineId, week);
            return;
        }

        // A brand-new draft has no persisted discipline yet. The
        // grid needs a real discipline to scope to, and so does the
        // summary.
        if (!isNonEmptyString(disciplineId)) {
            host.innerHTML =
                '<p class="empty-state small">' +
                    'Save the discipline first to view its schedule.' +
                '</p>';
            clearDisciplineScheduleSummaryHost();
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            host.innerHTML =
                '<p class="empty-state small">' +
                    'Select a class from People or Weekly Teams to ' +
                    'view this discipline\'s schedule.' +
                '</p>';
            clearDisciplineScheduleSummaryHost();
            return;
        }

        if (typeof week !== 'number' ||
            week < MIN_WEEK ||
            week > MAX_WEEK) {
            host.innerHTML =
                '<p class="empty-state small">' +
                    'Select a valid week.' +
                '</p>';
            clearDisciplineScheduleSummaryHost();
            return;
        }

        var ACA = getCalendarAggregator();
        if (!ACA ||
            typeof ACA.getDisciplineScheduleViewModel !== 'function') {
            host.innerHTML =
                '<p class="empty-state small">' +
                    'Calendar aggregator is not available.' +
                '</p>';
            mountDisciplineScheduleSummaryIfPresent(disciplineId, week);
            return;
        }

        var gridVM = null;
        try {
            gridVM = ACA.getDisciplineScheduleViewModel(
                classId,
                disciplineId,
                week
            );
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] ' +
                'getDisciplineScheduleViewModel threw:', e
            );
            gridVM = null;
        }

        if (!gridVM) {
            host.innerHTML =
                '<p class="empty-state small">' +
                    'Schedule data is not available for this ' +
                    'discipline and class.' +
                '</p>';
            mountDisciplineScheduleSummaryIfPresent(disciplineId, week);
            return;
        }

        var renderState = {
            selectedId: disciplineId,
            week: week
        };

        var renderVM = {
            mode: 'discipline',
            canEdit: false,
            canEditInstructorSlot: false,
            schedule: gridVM.schedule,
            restDays: gridVM.restDays,
            entityName: gridVM.entityName,
            modeLabel: gridVM.modeLabel,
            showEmptySlots: false,
            showRestDays: true,
            hours: gridVM.hours,
            disciplineHours: []
        };

        try {
            host.innerHTML = Renderer.renderGrid(renderState, renderVM);
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] renderGrid failed:', e
            );
            host.innerHTML =
                '<p class="empty-state small">' +
                    'Failed to render the discipline schedule.' +
                '</p>';
        }

        mountDisciplineScheduleSummaryIfPresent(disciplineId, week);
    }

    // ============================================================
    // ENROLLMENT SUMMARY MOUNT
    // ============================================================
    //
    // The panel below the grid. Advisory: any failure to build the
    // VM or render the HTML leaves its host empty. The grid is
    // unaffected.
    //
    // The VM's enrollment population and its assigned predicate are
    // both not week-scoped. The week parameter flows through only
    // for display and the elimination flag. See the aggregator's
    // header for the full rationale.

    function mountDisciplineScheduleSummaryIfPresent(disciplineId, week) {
        var host = document.getElementById(
            'academy-discipline-schedule-summary-host'
        );
        if (!host) { return; }

        host.innerHTML = '';

        if (!isNonEmptyString(disciplineId)) { return; }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) { return; }

        if (typeof week !== 'number' ||
            week < MIN_WEEK ||
            week > MAX_WEEK) {
            return;
        }

        var ACA = getCalendarAggregator();
        if (!ACA ||
            typeof ACA.getDisciplineScheduleSummaryViewModel !==
                'function') {
            return;
        }

        var summaryVM = null;
        try {
            summaryVM = ACA.getDisciplineScheduleSummaryViewModel(
                classId,
                disciplineId,
                week
            );
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] summary VM fetch failed:',
                e
            );
            return;
        }

        if (!summaryVM) { return; }

        var Renderer = getDisciplineScheduleSummary();
        if (!Renderer || typeof Renderer.renderHTML !== 'function') {
            return;
        }

        var html = '';
        try {
            html = Renderer.renderHTML(summaryVM);
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] summary render failed:',
                e
            );
            return;
        }

        host.innerHTML = html;
    }

    function clearDisciplineScheduleSummaryHost() {
        var host = document.getElementById(
            'academy-discipline-schedule-summary-host'
        );
        if (host) {
            host.innerHTML = '';
        }
    }

    // ============================================================
    // DRAFT LIFECYCLE
    // ============================================================

    function initializeDraftFromDiscipline(disciplineId) {
        if (!AcademyDisciplines || !GradeSchemes) {
            notify('Discipline module not loaded.', 'error');
            return;
        }

        var record = AcademyDisciplines.getDiscipline(disciplineId);
        if (!record) {
            notify('Discipline not found.', 'error');
            return;
        }

        _selectedDisciplineId = String(disciplineId);
        _disciplineDraftMode = 'edit';
        _disciplineDraftErrors = {};

        var weights = (typeof AcademyDisciplines.getAssessmentWeights === 'function')
            ? AcademyDisciplines.getAssessmentWeights(record.id)
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
            gradeScheme: GradeSchemes.normalizeScheme(record.gradeScheme),
            assessmentWeights: weights || {}
        };
    }

    function initializeNewDraft() {
        if (!GradeSchemes) {
            notify('Grade schemes module not loaded.', 'error');
            return;
        }

        _selectedDisciplineId = null;
        _disciplineDraftMode = 'create';
        _disciplineDraftErrors = {};
        _activeDisciplineTab = 'edit';

        _disciplineDraft = {
            id: null,
            name: '',
            type: 'mandatory',
            startWeek: MIN_WEEK,
            endWeek: MAX_WEEK,
            weeklyHours: 1,
            weight: 1,
            gradeScheme: GradeSchemes.getDefaultScheme(),
            assessmentWeights: (AcademyDisciplines &&
                typeof AcademyDisciplines.getDefaultAssessmentWeights === 'function')
                ? AcademyDisciplines.getDefaultAssessmentWeights()
                : {}
        };
    }

    function clearDraft() {
        _selectedDisciplineId = null;
        _disciplineDraft = null;
        _disciplineDraftMode = 'empty';
        _disciplineDraftErrors = {};
        _activeDisciplineTab = 'edit';
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        // ---- Discipline row selection ----
        var discRow = target.closest('.academy-discipline-row');
        if (discRow && discRow.dataset && discRow.dataset.disciplineId) {
            e.preventDefault();
            initializeDraftFromDiscipline(discRow.dataset.disciplineId);
            _activeDisciplineTab = 'edit';
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        // ---- Delegated action dispatch ----
        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;
        if (!isNonEmptyString(action)) { return; }

        switch (action) {
            case 'discipline-add':
                e.preventDefault();
                initializeNewDraft();
                var addCtx = getContext();
                addCtx.onChange();
                return;
            case 'discipline-tab-select':
                e.preventDefault();
                handleDisciplineTabSelect(actionEl.dataset.tab);
                return;
            case 'discipline-summary-toggle':
                e.preventDefault();
                handleDisciplineSummaryToggle(actionEl);
                return;
            case 'discipline-apply-scheme-preset':
                e.preventDefault();
                handleApplySchemePreset(actionEl);
                return;
            case 'discipline-add-band':
                e.preventDefault();
                handleAddBand();
                return;
            case 'discipline-remove-band':
                e.preventDefault();
                handleRemoveBand(actionEl);
                return;
            case 'discipline-reset-assessment-weights':
                e.preventDefault();
                handleResetAssessmentWeights();
                return;
            case 'discipline-save':
                e.preventDefault();
                saveDisciplineDraft();
                return;
            case 'discipline-cancel':
                e.preventDefault();
                handleCancelDiscipline();
                return;
            case 'discipline-delete':
                e.preventDefault();
                handleDisciplineDelete(actionEl.dataset.disciplineId);
                return;
            default:
                return;
        }
    }

    function handleChange(e) {
        var target = e.target;
        if (!target) { return; }

        // ---- Schedule tab week input ----
        if (target.id === 'academy-discipline-schedule-week') {
            handleScheduleWeekChange(target.value);
            return;
        }

        // ---- Editor field changes ----
        if (target.dataset && target.dataset.disciplineField) {
            handleDisciplineFieldChange(target);
            return;
        }

        // ---- Band label changes ----
        if (target.dataset &&
            target.dataset.bandIndex !== undefined &&
            target.dataset.bandField === 'label') {
            handleBandFieldChange(target);
            return;
        }

        // ---- List filter ----
        if (target.id === 'academy-discipline-type-filter') {
            _disciplineFilters.type = target.value;
            var ctx = getContext();
            ctx.onChange();
            return;
        }
    }

    function handleInput(e) {
        var target = e.target;
        if (!target) { return; }

        // ---- Assessment weight inputs ----
        if (target.dataset && target.dataset.assessmentWeightType) {
            handleAssessmentWeightChange(target);
            return;
        }

        // ---- Editor field changes (inputs) ----
        if (target.dataset && target.dataset.disciplineField) {
            handleDisciplineFieldChange(target);
            return;
        }

        // ---- Band field changes (inputs) ----
        if (target.dataset &&
            target.dataset.bandIndex !== undefined &&
            target.dataset.bandField) {
            handleBandFieldChange(target);
            return;
        }

        // ---- Search debounce ----
        if (target.id === 'academy-discipline-search') {
            debounceDisciplineSearch(target.value);
            return;
        }
    }

    function handleKeydown(e) {
        var target = e.target;
        if (!target || e.key !== 'Enter') { return; }

        if (target.id === 'academy-discipline-schedule-week') {
            e.preventDefault();
            handleScheduleWeekChange(target.value);
            return;
        }
    }

    // ============================================================
    // TAB HANDLING
    // ============================================================

    function handleDisciplineTabSelect(tabId) {
        if (!isNonEmptyString(tabId)) { return; }
        if (VALID_DETAIL_TABS.indexOf(tabId) === -1) { return; }
        if (tabId === _activeDisciplineTab) { return; }

        _activeDisciplineTab = tabId;
        var ctx = getContext();
        ctx.onChange();
    }

    function handleScheduleWeekChange(rawValue) {
        var parsed = parseInt(rawValue, 10);
        if (isNaN(parsed) || parsed < MIN_WEEK || parsed > MAX_WEEK) {
            notify(
                'Week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.',
                'error'
            );
            return;
        }
        if (parsed === _scheduleWeek) {
            return;
        }
        _scheduleWeek = parsed;
        var ctx = getContext();
        ctx.onChange();
    }

    // ============================================================
    // SUMMARY PANEL TOGGLE
    // ============================================================
    //
    // The panel's markup lives in
    // AcademyDisciplineScheduleSummary. Its disclosure behaviour
    // lives here: flip data-expanded, rotate the caret, show or
    // hide the body.
    //
    // The disclosure pattern matches the orphan-teams section in
    // academy-weekly-teams-view.js. The state is held in the DOM
    // only; it is not persisted, and it resets on any re-render
    // because the shell replaces the host's innerHTML.

    function handleDisciplineSummaryToggle(buttonEl) {
        if (!buttonEl || typeof buttonEl.closest !== 'function') {
            return;
        }

        var block = buttonEl.closest('.academy-discipline-summary-block');
        if (!block) { return; }

        var currentlyExpanded = block.getAttribute('data-expanded') === 'true';
        var next = !currentlyExpanded;

        block.setAttribute('data-expanded', next ? 'true' : 'false');
        buttonEl.setAttribute('aria-expanded', next ? 'true' : 'false');

        var caret = buttonEl.querySelector(
            '.academy-discipline-summary-caret'
        );
        if (caret) {
            caret.textContent = next ? '\u25be' : '\u25b8';
        }

        var body = block.querySelector(
            '.academy-discipline-summary-body'
        );
        if (body) {
            body.style.display = next ? 'block' : 'none';
        }
    }

    // ============================================================
    // FIELD HANDLERS
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
        if (!GradeSchemes || !_disciplineDraft) { return; }
        if (!_host || typeof _host.querySelector !== 'function') { return; }

        var previewEl = _host.querySelector(
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
    // EDITOR ACTIONS
    // ============================================================

    function handleApplySchemePreset(buttonEl) {
        if (!_disciplineDraft || !GradeSchemes) { return; }
        if (!_host || typeof _host.querySelector !== 'function') { return; }

        var presetSelect = _host.querySelector(
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

        var ctx = getContext();
        ctx.onChange();
    }

    function handleAddBand() {
        if (!_disciplineDraft) { return; }

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

        var ctx = getContext();
        ctx.onChange();
    }

    function handleRemoveBand(buttonEl) {
        if (!_disciplineDraft) { return; }

        var idx = parseInt(buttonEl.dataset.bandIndex, 10);
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

        var ctx = getContext();
        ctx.onChange();
    }

    function handleResetAssessmentWeights() {
        if (!_disciplineDraft) { return; }

        _disciplineDraft.assessmentWeights =
            (AcademyDisciplines &&
                typeof AcademyDisciplines.getDefaultAssessmentWeights === 'function')
                ? AcademyDisciplines.getDefaultAssessmentWeights()
                : {};

        var ctx = getContext();
        ctx.onChange();
    }

    function handleCancelDiscipline() {
        if (_disciplineDraftMode === 'edit' && _selectedDisciplineId) {
            initializeDraftFromDiscipline(_selectedDisciplineId);
            _activeDisciplineTab = 'edit';
        } else {
            clearDraft();
        }

        var ctx = getContext();
        ctx.onChange();
    }

    function handleDisciplineDelete(disciplineId) {
        var CRUD = getCRUDModals();
        if (disciplineId && CRUD &&
            typeof CRUD.openDisciplineDelete === 'function') {
            CRUD.openDisciplineDelete(disciplineId);
        }
    }

    // ============================================================
    // SAVE
    // ============================================================

    function buildDisciplinePayload(draft) {
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
            gradeScheme: scheme,
            assessmentWeights: draft.assessmentWeights || {}
        };
    }

    function saveDisciplineDraft() {
        if (!_disciplineDraft) { return; }

        if (!AcademyDisciplines) {
            notify('Discipline module not available.', 'error');
            return;
        }

        _disciplineDraftErrors = {};

        var payload = buildDisciplinePayload(_disciplineDraft);
        var isNew = _disciplineDraftMode === 'create';
        var targetId = _disciplineDraft.id;

        var promise = isNew
            ? AcademyDisciplines.create(payload)
            : AcademyDisciplines.update(targetId, payload);

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

            var ctx = getContext();
            ctx.onChange();
        }).catch(function(err) {
            console.warn(
                '[AcademyDisciplineController] saveDisciplineDraft ' +
                'failed:', err
            );
            notify('Failed to save discipline.', 'error');
        });
    }

    // ============================================================
    // SEARCH DEBOUNCE
    // ============================================================

    function debounceDisciplineSearch(value) {
        if (_disciplineSearchTimer) {
            clearTimeout(_disciplineSearchTimer);
        }
        _disciplineSearchTimer = setTimeout(function() {
            _disciplineSearchTimer = null;
            _disciplineFilters.search = value;
            var ctx = getContext();
            ctx.onChange();
        }, 150);
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        clearDraft();

        if (_disciplineSearchTimer) {
            clearTimeout(_disciplineSearchTimer);
            _disciplineSearchTimer = null;
        }

        // The list filter is deliberately NOT cleared.
        // The schedule week is deliberately NOT cleared; a return
        // visit lands on the same week the user was last looking at.

        _host = null;
        _context = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplineController = Object.freeze({
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
        var exports = window.AcademyDisciplineController;
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
                '[AcademyDisciplineController] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
