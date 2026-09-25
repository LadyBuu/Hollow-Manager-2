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
 *   - Mounting the discipline sessions panel into the Schedule tab
 *     sessions host, below the summary. (BATCH 4)
 *   - Toggling the summary panel open and closed. (BATCH 3)
 *   - The inline candidate picker and roster actions inside the
 *     discipline sessions panel. (BATCH 4)
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
 *   - The discipline sessions panel content. AcademyDisciplineSessionsPanel
 *     produces the VM and renders the HTML; the controller mounts it
 *     and handles the inline picker's actions.
 *   - Instructor assignment for a discipline. That relationship is
 *     class-scoped and is owned by the class-disciplines picker.
 *     The discipline editor does not offer an instructor picker
 *     (v27).
 *   - The delete-confirm modal's onChange wiring. The shell keeps
 *     that wiring (via AcademyCRUDModals.setOnChangeCallback), and
 *     the controller simply opens the modal.
 *
 * EDITOR BOUNDS (v31):
 *   The editor VM carries four bounds objects that the view uses
 *   to stamp min/max/step attributes onto its number inputs:
 *
 *     weekBounds          { min, max }
 *     weeklyHoursBounds   { min, max, step }
 *     weightBounds        { min, max, step }
 *     bandPercentBounds   { min, max, step }
 *
 *   These are the single source of truth for those attributes.
 *   The bounds mirror the same limits AcademyDisciplines enforces
 *   at the domain layer (MIN_WEEKLY_HOURS, MAX_WEEKLY_HOURS,
 *   MIN_WEIGHT, MAX_WEIGHT, and the 0-100 band-percent range).
 *   The view asserts that they are present; a missing bound is a
 *   controller bug, not a reason for the view to invent one.
 *
 * SCHEDULE TAB:
 *   The Schedule tab renders a week selector, a grid host, an
 *   enrollment summary host, and a discipline sessions host.
 *
 *   The grid is mounted by this controller via
 *   AcademyCalendarAggregator.getDisciplineScheduleViewModel,
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
 * DISCIPLINE SESSIONS PANEL (BATCH 4):
 *   The panel below the enrollment summary. Lists every teaching
 *   group of the discipline for the week, across every instructor,
 *   with each group's sessions and roster. Supports an inline
 *   candidate picker per group and a per-student remove button.
 *
 *   The panel's markup and its per-group VM builder come from
 *   AcademyDisciplineSessionsPanel. The inline picker markup comes
 *   from that panel's own renderer (structurally identical to the
 *   character detail panel's picker, but with a distinct set of
 *   data-action values).
 *
 *   This controller owns:
 *     - mounting the panel into #academy-discipline-sessions-host
 *     - the module-level picker state (_openDisciplineSessionsGroupId,
 *       _openDisciplineSessionsCandidates)
 *     - the four session-picker actions:
 *         discipline-sessions-add-student
 *         discipline-sessions-add-student-cancel
 *         discipline-sessions-add-student-submit
 *         discipline-sessions-remove-student
 *
 *   The candidates VM is sourced from
 *   AcademyCharacterDetailAggregator.getTeachingGroupCandidateViewModel,
 *   which is the same builder the character detail panel's own picker
 *   uses. That builder is scoped to (instructor, group, week); the
 *   controller resolves the group's instructor internally before
 *   calling it.
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
 *   - The discipline-sessions picker state IS cleared by unmount.
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
 *   - window.AcademyDisciplineSessionsPanel   (lazy; for the sessions panel)
 *   - window.AcademyCharacterDetailAggregator (lazy; for the candidate VM)
 *   - window.AcademyTeachingGroups            (lazy; for group resolution)
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

    function getDisciplineSessionsPanel() {
        return window.AcademyDisciplineSessionsPanel || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var VALID_DETAIL_TABS = ['edit', 'schedule'];

    // ---- Editor bounds ---------------------------------------------------
    //
    // These are the single source of truth for the min/max/step
    // attributes on the editor's number inputs. They mirror the same
    // limits AcademyDisciplines enforces at the domain layer.
    //
    // The values come from AcademyDisciplines' own exported constants
    // where those exist (MIN_WEEKLY_HOURS, MAX_WEEKLY_HOURS,
    // MIN_WEIGHT, MAX_WEIGHT). The band-percent range is a fixed
    // 0-100 and is not exported by the domain module.
    //
    // Do NOT duplicate these numbers in the view. If a bound changes
    // here, the view picks it up automatically on the next render.

    var EDITOR_WEEK_BOUNDS = Object.freeze({
        min: MIN_WEEK,
        max: MAX_WEEK
    });

    var EDITOR_WEEKLY_HOURS_BOUNDS = Object.freeze({
        min: (typeof AcademyDisciplines.MIN_WEEKLY_HOURS === 'number')
            ? AcademyDisciplines.MIN_WEEKLY_HOURS
            : 0.5,
        max: (typeof AcademyDisciplines.MAX_WEEKLY_HOURS === 'number')
            ? AcademyDisciplines.MAX_WEEKLY_HOURS
            : 40,
        step: 0.5
    });

    var EDITOR_WEIGHT_BOUNDS = Object.freeze({
        min: (typeof AcademyDisciplines.MIN_WEIGHT === 'number')
            ? AcademyDisciplines.MIN_WEIGHT
            : 0.1,
        max: (typeof AcademyDisciplines.MAX_WEIGHT === 'number')
            ? AcademyDisciplines.MAX_WEIGHT
            : 10,
        step: 0.1
    });

    var EDITOR_BAND_PERCENT_BOUNDS = Object.freeze({
        min: 0,
        max: 100,
        step: 1
    });

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function cssEscapeLocal(value) {
        if (typeof CSS !== 'undefined' &&
            typeof CSS.escape === 'function') {
            return CSS.escape(String(value));
        }
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
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
    //
    // Discipline-sessions-panel state:
    //   _openDisciplineSessionsGroupId     string | null
    //   _openDisciplineSessionsCandidates  { candidates, blocked } | null
    //
    //   The picker is opened per group. The open group's ID and its
    //   resolved candidate list survive the re-render triggered by
    //   ctx.onChange() so the picker re-opens in place. Cleared on
    //   cancel, on submit, and on unmount.

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

    var _openDisciplineSessionsGroupId = null;
    var _openDisciplineSessionsCandidates = null;

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
            mountDisciplineSessionsPanelIfPresent(
                _disciplineDraft.id,
                scheduleWeek
            );
        }
    }

    /**
     * Build the editor VM.
     *
     * Returns null in 'empty' mode. Otherwise, it takes the
     * aggregator's editor VM and attaches the four bounds objects
     * the view requires. The bounds are the same for every
     * discipline; they describe the input ranges the editor renders,
     * not the discipline's stored values.
     *
     * The bounds are attached here, not in the aggregator, because
     * they are presentation metadata for the editor surface. A
     * different caller of getDisciplineEditorViewModel (if one ever
     * exists) does not need them.
     */
    function buildEditorVM() {
        if (_disciplineDraftMode === 'empty' || !_disciplineDraft) {
            return null;
        }

        var vm = AcademyAggregator.getDisciplineEditorViewModel({
            draft: _disciplineDraft,
            isNew: _disciplineDraftMode === 'create',
            errors: _disciplineDraftErrors
        });

        if (!vm) { return null; }

        vm.weekBounds = EDITOR_WEEK_BOUNDS;
        vm.weeklyHoursBounds = EDITOR_WEEKLY_HOURS_BOUNDS;
        vm.weightBounds = EDITOR_WEIGHT_BOUNDS;
        vm.bandPercentBounds = EDITOR_BAND_PERCENT_BOUNDS;

        return vm;
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
    // DISCIPLINE SESSIONS PANEL MOUNT
    // ============================================================
    //
    // The panel below the enrollment summary. Lists every teaching
    // group of the discipline for the week, across every instructor,
    // with the roster and inline add/remove affordances.
    //
    // Advisory: any failure to build the VM or render the HTML
    // leaves the host empty. The grid and summary are unaffected.
    //
    // The panel's own VM builder (buildSessionViewModel) does not
    // know about the picker state; the controller stamps
    // _openPickerGroupId and _pickerCandidates onto the VM before
    // handing it to the renderer. That mirrors how the character
    // detail panel carries the same two fields.

    function mountDisciplineSessionsPanelIfPresent(disciplineId, week) {
        var host = document.getElementById(
            'academy-discipline-sessions-host'
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

        var Panel = getDisciplineSessionsPanel();
        if (!Panel) { return; }

        var vm = null;
        try {
            if (typeof Panel.buildSessionViewModel === 'function') {
                vm = Panel.buildSessionViewModel(
                    classId,
                    disciplineId,
                    week
                );
            }
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] sessions VM build ' +
                'failed:', e
            );
            return;
        }

        if (!vm) { return; }

        vm._openPickerGroupId = _openDisciplineSessionsGroupId;
        vm._pickerCandidates = _openDisciplineSessionsCandidates;

        var html = '';
        try {
            html = Panel.renderHTML(vm);
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] sessions render failed:',
                e
            );
            return;
        }

        host.innerHTML = html;
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
            case 'discipline-sessions-add-student':
                e.preventDefault();
                handleDisciplineSessionsAddStudent(actionEl);
                return;
            case 'discipline-sessions-add-student-cancel':
                e.preventDefault();
                handleDisciplineSessionsAddStudentCancel(actionEl);
                return;
            case 'discipline-sessions-add-student-submit':
                e.preventDefault();
                handleDisciplineSessionsAddStudentSubmit(actionEl);
                return;
            case 'discipline-sessions-remove-student':
                e.preventDefault();
                handleDisciplineSessionsRemoveStudent(actionEl);
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
    // DISCIPLINE SESSIONS — INLINE PICKER + ROSTER ACTIONS
    // ============================================================
    //
    // The discipline sessions panel uses the same candidate picker
    // and the same mutations as the instructor tab's teaching
    // groups. The only difference is the entry point: the panel is
    // scoped to one discipline, and the picker is opened per group.
    //
    // The controller stashes the open group ID on module state so
    // that a refresh re-opens the picker on the same group. This
    // mirrors _openPickerGroupId in the People controller.

    function handleDisciplineSessionsAddStudent(actionEl) {
        if (!actionEl || !actionEl.dataset) { return; }

        var groupId = actionEl.dataset.groupId;
        if (!isNonEmptyString(groupId)) { return; }

        var Aggregator = window.AcademyCharacterDetailAggregator;
        if (!Aggregator ||
            typeof Aggregator.getTeachingGroupCandidateViewModel !==
                'function') {
            notify('Candidate picker is not available.', 'error');
            return;
        }

        var week = resolveScheduleWeek();
        if (week === null) { return; }

        // The picker is scoped to (instructor, group, week). Resolve
        // the group's instructor first; the aggregator needs it.
        var group = null;
        var TG = window.AcademyTeachingGroups;
        if (TG && typeof TG.getGroup === 'function') {
            try {
                group = TG.getGroup(groupId);
            } catch (e) {
                group = null;
            }
        }
        if (!group || !group.instructorId) {
            notify('Teaching group not found.', 'error');
            return;
        }

        var vm = null;
        try {
            vm = Aggregator.getTeachingGroupCandidateViewModel(
                String(group.instructorId),
                String(groupId),
                { week: week }
            );
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] ' +
                'getTeachingGroupCandidateViewModel threw:', e
            );
            vm = null;
        }

        if (!vm) {
            notify('Could not open the candidate list.', 'error');
            return;
        }

        _openDisciplineSessionsGroupId = String(groupId);
        _openDisciplineSessionsCandidates = {
            candidates: Array.isArray(vm.candidates)
                ? vm.candidates
                : [],
            blocked: Array.isArray(vm.blocked)
                ? vm.blocked
                : []
        };

        var ctx = getContext();
        ctx.onChange();
    }

    function handleDisciplineSessionsAddStudentCancel() {
        _openDisciplineSessionsGroupId = null;
        _openDisciplineSessionsCandidates = null;
        var ctx = getContext();
        ctx.onChange();
    }

    function handleDisciplineSessionsAddStudentSubmit(actionEl) {
        if (!actionEl || !actionEl.dataset) { return; }

        var groupId = actionEl.dataset.groupId;
        if (!isNonEmptyString(groupId)) { return; }

        var TG = window.AcademyTeachingGroups;
        if (!TG || typeof TG.addMemberToGroup !== 'function') {
            notify('Teaching groups module not available.', 'error');
            return;
        }

        var picker = document.querySelector(
            '.academy-teaching-group-candidate-picker' +
            '[data-group-id="' + cssEscapeLocal(groupId) + '"]'
        );
        if (!picker) {
            notify('Could not read the selected students.', 'error');
            return;
        }

        var checkedEls = picker.querySelectorAll(
            '.academy-teaching-group-candidate-checkbox:checked'
        );
        var charIds = [];
        for (var i = 0; i < checkedEls.length; i++) {
            var v = checkedEls[i].value;
            if (isNonEmptyString(v)) { charIds.push(String(v)); }
        }

        if (charIds.length === 0) {
            notify('Select at least one student.', 'error');
            return;
        }

        var submitBtn = picker.querySelector(
            '[data-action="teaching-groups-add-student-submit"]'
        );
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Adding\u2026';
        }

        var week = resolveScheduleWeek();
        if (week === null) { return; }

        var succeeded = 0;
        var failures = [];
        var chain = Promise.resolve();

        charIds.forEach(function (charId) {
            chain = chain.then(function () {
                return TG.addMemberToGroup(groupId, charId, week)
                    .then(function (result) {
                        if (result && result.success) {
                            succeeded++;
                        } else {
                            failures.push({
                                characterId: charId,
                                message: (result && result.message) ||
                                    'Unknown error'
                            });
                        }
                    })
                    .catch(function (err) {
                        failures.push({
                            characterId: charId,
                            message: String(
                                (err && err.message) || err
                            )
                        });
                    });
            });
        });

        chain.then(function () {
            var total = succeeded + failures.length;

            if (failures.length === 0) {
                notify(
                    'Added ' + succeeded + ' student' +
                    (succeeded === 1 ? '' : 's') + ' to the group.',
                    'success'
                );
            } else if (succeeded === 0) {
                notify(
                    'Could not add any of the ' + total +
                    ' selected students. See console for details.',
                    'error'
                );
            } else {
                notify(
                    'Added ' + succeeded + ' of ' + total +
                    ' students. Some failed. See console for details.',
                    'warning'
                );
            }

            for (var f = 0; f < failures.length; f++) {
                console.warn(
                    '[AcademyDisciplineController] candidate add ' +
                    'failed:', failures[f]
                );
            }

            _openDisciplineSessionsGroupId = null;
            _openDisciplineSessionsCandidates = null;
            var ctx = getContext();
            ctx.onChange();
        });
    }

    function handleDisciplineSessionsRemoveStudent(actionEl) {
        if (!actionEl || !actionEl.dataset) { return; }

        var groupId = actionEl.dataset.groupId;
        var charId = actionEl.dataset.characterId;

        if (!isNonEmptyString(groupId) ||
            !isNonEmptyString(charId)) {
            return;
        }

        var TG = window.AcademyTeachingGroups;
        if (!TG || typeof TG.removeMemberRecord !== 'function') {
            notify('Teaching groups module not available.', 'error');
            return;
        }

        var name = 'this student';
        var CQ = window.CharacterQueries;
        if (CQ && typeof CQ.getCharacterById === 'function') {
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
            .then(function (result) {
                if (result && result.success) {
                    if (_openDisciplineSessionsGroupId &&
                        String(_openDisciplineSessionsGroupId) ===
                            String(groupId)) {
                        // Re-resolve the candidates for the open
                        // picker so it reflects the removal.
                        handleDisciplineSessionsAddStudent({
                            dataset: { groupId: groupId }
                        });
                        return;
                    }
                    var ctx = getContext();
                    ctx.onChange();
                } else if (result && result.message) {
                    notify(result.message, 'error');
                }
            })
            .catch(function (err) {
                console.warn(
                    '[AcademyDisciplineController] ' +
                    'removeMemberRecord failed:', err
                );
                notify('Failed to remove student from group.', 'error');
            });
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
        // The discipline-sessions picker state IS cleared: a return
        // visit should not re-open a picker on a group the user has
        // navigated away from.

        _openDisciplineSessionsGroupId = null;
        _openDisciplineSessionsCandidates = null;

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
