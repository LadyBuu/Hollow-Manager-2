/**
 * modules/academy/controllers/academy-discipline-controller.js
 * Academy Discipline Controller
 *
 * Path: js/modules/academy/controllers/academy-discipline-controller.js
 *
 * The Disciplines feature controller. Owns the Disciplines view:
 * its render, its event handlers, its editor draft state, its
 * schedule-tab state, its highlight filter state, and its search
 * debounce.
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
 *   - The Schedule tab's highlight filter: selected instructor,
 *     selected student set, check-weeks count. Cleared on unmount.
 *   - The Schedule tab's highlight filter panel disclosure (open
 *     vs. closed). This is a DOM-only state.
 *   - The Schedule tab's free-slot candidate students. This is a
 *     DOMAIN READ, owned by the controller. It reads
 *     AcademyAggregator.getFreeSlotCandidateStudentsViewModel and
 *     passes the result to the view as `highlightFilterVM`.
 *   - Per-field and per-band validation errors on the draft.
 *   - The list filter (type, search) as feature state.
 *   - The search debounce timer.
 *   - The editor's live preview.
 *   - The editor's save, cancel, apply-preset, add-band, remove-band,
 *     and reset-weights actions.
 *   - The "+ Add Discipline" flow (B4-1).
 *   - The discipline delete confirm modal, via AcademyCRUDModals.
 *   - Mounting the calendar grid into the Schedule tab host.
 *   - Mounting the enrollment summary panel below the grid.
 *   - Mounting the discipline sessions panel below the summary.
 *   - Toggling the summary panel open and closed.
 *   - The inline candidate picker and roster actions inside the
 *     discipline sessions panel.
 *   - The discipline grid's cell actions:
 *       schedule-discipline-assign         — open the instructor
 *                                             modal in picker mode
 *                                             for the clicked empty
 *                                             cell
 *       schedule-discipline-slot-open      — open the session actions
 *                                             modal for the clicked
 *                                             occupied cell
 *   - The Schedule tab's free-slots actions.
 *   - The Schedule tab's group management.
 *
 * GRADE SCHEME DRAFT — MUTABLE, NOT THE FROZEN CANONICAL (this
 * revision):
 *   AcademyGradeSchemes.normalizeScheme returns a DEEP-FROZEN
 *   scheme. That is the correct contract for a canonical value:
 *   the scheme a caller receives cannot be mutated by accident.
 *
 *   The editor draft is NOT that object. The draft is a
 *   work-in-progress that the user edits in place: typing into a
 *   band label, changing a band's minPercent, editing the scheme
 *   label. Every one of those writes needs a MUTABLE target.
 *
 *   An earlier revision assigned the frozen canonical scheme to
 *   `_disciplineDraft.gradeScheme` directly. Every band-field
 *   write then threw `TypeError: "label" is read-only` (or
 *   "minPercent"), the write was silently discarded, the draft
 *   kept its prior value, and the user's edit was lost. The
 *   `[AcademyView] controller handleInput threw...` warnings in
 *   the console were the visible symptom; the invisible symptom
 *   was a grade scheme that reverted to Numeric on save because
 *   one band had an empty label or stale minPercent.
 *
 *   The draft now holds a SHALLOW, MUTABLE CLONE of the
 *   normalized scheme:
 *
 *     {
 *       id:    string,
 *       label: string,
 *       bands: [
 *         { label, minPercent, passing? },
 *         ...
 *       ]
 *     }
 *
 *   The clone is produced by cloneSchemeForDraft(), which flattens
 *   the frozen structure into a fresh object graph with plain
 *   band objects. After that, every write in this controller
 *   operates on mutable data.
 *
 *   WHERE THE CLONE IS APPLIED:
 *     - initializeDraftFromDiscipline: normalize → clone
 *     - initializeNewDraft:            getDefaultScheme → clone
 *     - handleApplySchemePreset:       getPreset/normalize → clone
 *     - handleAddBand:                 replace with cloned scheme
 *     - handleRemoveBand:              replace with cloned scheme
 *
 *   WHERE IT IS NOT APPLIED:
 *     - buildDisciplinePayload: normalizeScheme is called once
 *       more to canonicalise the draft before dispatch. The
 *       frozen result is passed through to the domain layer,
 *       which never mutates it.
 *
 *   This keeps the frozen-canonical contract on the domain side
 *   AND gives the editor a mutable draft. Neither side has to
 *   know about the other's expectations.
 *
 * GRADE SCHEME ROUND-TRIP — OTHER FAILURE PATHS:
 *   Two other paths that could discard a user's custom scheme
 *   remain closed from the previous revision:
 *
 *   PATH A — empty-label band on add:
 *     handleAddBand pushes a labelled band ('Band N') with a
 *     non-colliding minPercent. It never creates a second
 *     minPercent: 0 band.
 *
 *   PATH C — removing the only 0-band:
 *     handleRemoveBand refuses to remove a band whose minPercent
 *     is 0 when it is the only band at 0.
 *
 *   PATH D — silent fallback on save:
 *     saveDisciplineDraft validates the draft's scheme BEFORE
 *     building the payload. On failure it surfaces the specific
 *     validation errors and refuses to save.
 *
 *   PATH B — raw-string minPercent:
 *     handleBandFieldChange parses minPercent strictly, writes
 *     the integer to the (now-mutable) draft, and refuses to
 *     write non-integer input. The draft never carries a
 *     malformed value into save.
 *
 *   With the freeze bug closed, all four paths are closed
 *   end-to-end.
 *
 * CANDIDATE PICKER STATE:
 *   The Add button in the discipline sessions panel's candidate
 *   picker ships disabled. Ticking a checkbox must enable it. The
 *   People view's picker has a checkbox handler (in
 *   academy-people-controller.js) that does this; the discipline
 *   sessions panel's picker was added without one, so the button
 *   stayed disabled and clicking it produced a forbidden cursor.
 *
 *   updateDisciplineCandidateSelectionState() is the counterpart.
 *   It is called from:
 *     - the checkbox-change branch in handleChange
 *     - the bulk select-all / clear branch in handleClick,
 *       after the checkboxes have been flipped
 *
 *   Without both call sites, the button state can fall out of sync
 *   with the checkbox state.
 *
 * ADD-ANOTHER-INSTRUCTOR:
 *   The session actions modal (academy-session-actions-modal.js)
 *   gained a third action, "Add another instructor here." When it
 *   fires, it calls the callback this controller supplies via
 *   `onAddInstructor`. The callback opens the instructor picker
 *   (academy-schedule-instructor-modal.js) in `picker` mode with
 *   the same (class, discipline, week) that the discipline grid is
 *   showing, and the day/hour of the session the user clicked.
 *
 *   The actions modal closes itself before invoking the callback.
 *   The callback therefore opens the picker into an empty modal
 *   slot; there is no stacking.
 *
 *   The picker creates a second session at the same (day, hour) for
 *   a different instructor. The grid then renders two co-occupants
 *   in the cell.
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
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getFreeSlotCandidateStudentsViewModel !==
            'function') {
        _missing.push(
            'AcademyAggregator.getFreeSlotCandidateStudentsViewModel'
        );
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
    if (!GradeSchemes ||
        typeof GradeSchemes.validateScheme !== 'function') {
        _missing.push('AcademyGradeSchemes.validateScheme');
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

    function getScheduleInstructorModal() {
        return window.AcademyScheduleInstructorModal || null;
    }

    function getSessionActionsModal() {
        return window.AcademySessionActionsModal || null;
    }

    function getGroupManagementModal() {
        return window.AcademyGroupManagementModal || null;
    }

    function getRebalanceModal() {
        return window.AcademyRebalanceModal || null;
    }

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var VALID_DETAIL_TABS = ['edit', 'schedule'];

    var DEFAULT_HIGHLIGHT_CHECK_WEEKS = 4;
    var MAX_HIGHLIGHT_CHECK_WEEKS = 12;

    // ---- Editor bounds ---------------------------------------------------

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

    function parseStrictInteger(value) {
        if (value === undefined || value === null) { return null; }
        if (typeof value === 'number') {
            return Number.isInteger(value) ? value : null;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^-?\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            return Number.isInteger(n) ? n : null;
        }
        return null;
    }

    /**
     * Produce a mutable clone of a normalized grade scheme.
     *
     * THE PROBLEM THIS SOLVES:
     *   AcademyGradeSchemes.normalizeScheme returns a DEEP-FROZEN
     *   scheme. Every band in the returned scheme is
     *   Object.freeze'd. Assigning that object to the editor draft
     *   and then typing into a band field throws
     *   `TypeError: "label" is read-only` (or "minPercent"), the
     *   write is silently discarded, and the user's edit is lost.
     *
     *   See the file header's GRADE SCHEME DRAFT section for the
     *   full diagnosis.
     *
     * WHAT THIS RETURNS:
     *   A fresh object graph that is structurally identical to the
     *   input but has no frozen nodes. Bands are plain objects.
     *   The `passing` field is copied when present.
     *
     *   This is a purpose-built clone, not JSON.parse(JSON.stringify
     *   (scheme)) — the scheme shape is small and well-defined, and
     *   a purpose-built clone is clearer about what it preserves.
     *
     * FAILURE MODE:
     *   When the input is missing or malformed, returns a mutable
     *   clone of the numeric default. The caller can rely on the
     *   result being a well-formed, mutable scheme with at least
     *   one band at minPercent 0.
     *
     * @param {object|null} raw
     * @returns {object} mutable scheme
     */
    function cloneSchemeForDraft(raw) {
        // Normalize first, so we always start from a validated
        // canonical shape. The result is frozen.
        var canonical = GradeSchemes.normalizeScheme(raw);

        // Now flatten it into a mutable structure. The canonical
        // has { id, label, bands[] }, and each band has
        // { label, minPercent, passing? }.
        var bands = [];
        if (Array.isArray(canonical.bands)) {
            for (var i = 0; i < canonical.bands.length; i++) {
                var band = canonical.bands[i];
                if (!band || typeof band !== 'object') { continue; }
                var cloneBand = {
                    label: typeof band.label === 'string'
                        ? band.label
                        : '',
                    minPercent: typeof band.minPercent === 'number'
                        ? band.minPercent
                        : 0
                };
                if (typeof band.passing === 'boolean') {
                    cloneBand.passing = band.passing;
                }
                bands.push(cloneBand);
            }
        }

        // A well-formed scheme always has at least one band.
        // Belt-and-braces: if the canonical somehow had none,
        // synthesize a single 0-band so the draft is never empty.
        if (bands.length === 0) {
            bands.push({ label: '%', minPercent: 0 });
        }

        return {
            id: isNonEmptyString(canonical.id) ? canonical.id : 'custom',
            label: isNonEmptyString(canonical.label)
                ? canonical.label
                : 'Custom Scheme',
            bands: bands
        };
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

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

    var _scheduleHighlight = null;

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
    // HIGHLIGHT FILTER VM
    // ============================================================

    function buildHighlightFilterVM() {
        var result = {
            students: [],
            instructors: [],
            unavailable: false
        };

        if (!_disciplineDraft ||
            !isNonEmptyString(_disciplineDraft.id)) {
            result.unavailable = true;
            return result;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            result.unavailable = true;
            return result;
        }

        var week = resolveScheduleWeek();
        if (week === null) {
            result.unavailable = true;
            return result;
        }

        var disciplineId = String(_disciplineDraft.id);
        var targetClass = String(classId);

        try {
            var studentsVM = AcademyAggregator
                .getFreeSlotCandidateStudentsViewModel(
                    targetClass,
                    disciplineId,
                    week
                );

            if (studentsVM && Array.isArray(studentsVM.students)) {
                result.students = studentsVM.students;
            }
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] ' +
                'getFreeSlotCandidateStudentsViewModel threw:', e
            );
            result.students = [];
        }

        result.instructors = buildInstructorOptions(
            targetClass, disciplineId, week
        );

        return result;
    }

    function buildInstructorOptions(classId, disciplineId, week) {
        var AcademyClasses = getAcademyClasses();
        var CQ = getCharacterQueries();

        if (!AcademyClasses ||
            typeof AcademyClasses.getClassInstructorIds !== 'function') {
            return [];
        }
        if (!CQ ||
            typeof CQ.getCharacterById !== 'function' ||
            typeof CQ.getDisplayName !== 'function') {
            return [];
        }

        var ids = [];
        try {
            ids = AcademyClasses.getClassInstructorIds(
                classId,
                week,
                { disciplineId: disciplineId }
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] getClassInstructorIds ' +
                'threw:', e
            );
            return [];
        }

        if (!Array.isArray(ids)) { return []; }

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < ids.length; i++) {
            if (!isNonEmptyString(ids[i])) { continue; }
            var id = String(ids[i]);
            if (seen[id]) { continue; }
            seen[id] = true;

            var char = CQ.getCharacterById(id);
            if (!char) { continue; }

            var name = CQ.getDisplayName(char);
            if (!isNonEmptyString(name)) { name = 'Unknown'; }

            result.push({ id: id, name: name });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
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
        var highlightFilterVM = buildHighlightFilterVM();

        var html;
        try {
            html = View.renderHTML({
                disciplines: listVM.disciplines,
                selected: editorVM,
                editorMode: _disciplineDraftMode,
                filters: _disciplineFilters,
                total: listVM.total,
                activeTab: _activeDisciplineTab,
                scheduleWeek: scheduleWeek,
                scheduleHighlightVM: buildScheduleHighlightVM(),
                highlightFilterVM: highlightFilterVM
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

    function buildScheduleHighlightVM() {
        if (!_scheduleHighlight) { return null; }

        var CQ = getCharacterQueries();
        var instructorName = '';
        if (CQ && typeof CQ.getCharacterById === 'function') {
            var char = CQ.getCharacterById(
                _scheduleHighlight.instructorId
            );
            if (char) {
                instructorName = CQ.getDisplayName(char) || '';
            }
        }

        return {
            instructorId: _scheduleHighlight.instructorId,
            instructorName: instructorName,
            studentCount: _scheduleHighlight.studentIds.length,
            checkWeeks: _scheduleHighlight.checkWeeks
        };
    }

    function getContext() {
        if (_context) { return _context; }
        return normaliseContext(null);
    }

    // ============================================================
    // SCHEDULE GRID MOUNT
    // ============================================================

    function mountDisciplineScheduleGridIfPresent(disciplineId, week) {
        var host = document.getElementById(
            'academy-discipline-schedule-host'
        );

        if (!host) {
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
        if (!ACA) {
            host.innerHTML =
                '<p class="empty-state small">' +
                    'Calendar aggregator is not available.' +
                '</p>';
            mountDisciplineScheduleSummaryIfPresent(disciplineId, week);
            return;
        }

        var gridVM = null;
        try {
            if (_scheduleHighlight !== null &&
                typeof ACA.getDisciplineScheduleHighlightViewModel ===
                    'function') {
                gridVM = ACA.getDisciplineScheduleHighlightViewModel(
                    classId,
                    disciplineId,
                    week,
                    {
                        instructorId: _scheduleHighlight.instructorId,
                        studentIds: _scheduleHighlight.studentIds,
                        checkWeeks: _scheduleHighlight.checkWeeks
                    }
                );
            } else {
                gridVM = ACA.getDisciplineScheduleViewModel(
                    classId,
                    disciplineId,
                    week
                );
            }
        } catch (e) {
            console.warn(
                '[AcademyDisciplineController] ' +
                'discipline schedule VM fetch threw:', e
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
            canEditDisciplineSlot: true,
            schedule: gridVM.schedule,
            restDays: gridVM.restDays,
            entityName: gridVM.entityName,
            modeLabel: gridVM.modeLabel,
            showEmptySlots: false,
            showRestDays: true,
            hours: gridVM.hours,
            disciplineHours: [],
            highlights: gridVM.highlights || null
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

        stampPickerStateOntoMatchingGroup(vm);

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

    function stampPickerStateOntoMatchingGroup(vm) {
        if (!vm || !Array.isArray(vm.groups)) { return; }

        var targetId = isNonEmptyString(_openDisciplineSessionsGroupId)
            ? String(_openDisciplineSessionsGroupId)
            : null;

        for (var i = 0; i < vm.groups.length; i++) {
            var group = vm.groups[i];
            if (!group || !group.groupId) { continue; }

            if (targetId !== null &&
                String(group.groupId) === targetId) {
                group.isPickerOpen = true;
                group.pickerCandidates = _openDisciplineSessionsCandidates;
            } else {
                group.isPickerOpen = false;
                group.pickerCandidates = null;
            }
        }
    }

    // ============================================================
    // DRAFT LIFECYCLE
    // ============================================================
    //
    // DRAFT SCHEME IS MUTABLE (this revision):
    //   Each draft-construction site uses cloneSchemeForDraft,
    //   which normalizes and then flattens the frozen canonical
    //   into a mutable object graph. See the file header's
    //   GRADE SCHEME DRAFT section.

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
            gradeScheme: cloneSchemeForDraft(record.gradeScheme),
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
            gradeScheme: cloneSchemeForDraft(
                GradeSchemes.getDefaultScheme()
            ),
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

        // ---- Bulk actions inside the candidate picker ----
        var bulkBtn = target.closest('[data-bulk-action]');
        if (bulkBtn && bulkBtn.dataset) {
            var bulkAction = bulkBtn.dataset.bulkAction;
            var bulkSection = bulkBtn.dataset.section;

            if (bulkAction === 'select-all' ||
                bulkAction === 'clear') {
                e.preventDefault();

                var picker = bulkBtn.closest(
                    '.academy-teaching-group-candidate-picker'
                );
                if (!picker) { return; }

                if (bulkAction === 'select-all') {
                    selectAllVisibleInDisciplineSection(picker, bulkSection);
                } else {
                    clearDisciplineSection(picker, bulkSection);
                }

                // Keep the Add button's disabled state in sync with
                // the checkbox state.
                updateDisciplineCandidateSelectionState(picker);
                return;
            }
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
            case 'schedule-discipline-assign':
                e.preventDefault();
                handleScheduleDisciplineAssign(actionEl);
                return;
            case 'schedule-discipline-slot-open':
                e.preventDefault();
                handleScheduleDisciplineSlotOpen(actionEl);
                return;
            case 'discipline-manage-groups':
                e.preventDefault();
                handleManageGroups();
                return;
            case 'discipline-rebalance':
                e.preventDefault();
                handleRebalance();
                return;
            case 'discipline-schedule-toggle-filter-panel':
                e.preventDefault();
                handleToggleHighlightFilterPanel(actionEl);
                return;
            case 'discipline-schedule-find-free-slot':
                e.preventDefault();
                handleFindFreeSlotSubmit();
                return;
            case 'discipline-schedule-clear-highlight':
                e.preventDefault();
                handleClearHighlight();
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

        if (target.id === 'academy-discipline-schedule-week') {
            handleScheduleWeekChange(target.value);
            return;
        }

        if (target.dataset && target.dataset.disciplineField) {
            handleDisciplineFieldChange(target);
            return;
        }

        if (target.dataset &&
            target.dataset.bandIndex !== undefined &&
            target.dataset.bandField === 'label') {
            handleBandFieldChange(target);
            return;
        }

        if (target.id === 'academy-discipline-type-filter') {
            _disciplineFilters.type = target.value;
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        // ---- Candidate picker checkbox ----
        //
        // The picker's Add button ships disabled. Ticking a checkbox
        // must enable it. Without this branch, the button stays
        // disabled and the browser shows a forbidden cursor when the
        // user hovers it.
        if (target.classList &&
            target.classList.contains(
                'academy-teaching-group-candidate-checkbox'
            )) {
            var picker = target.closest(
                '.academy-teaching-group-candidate-picker'
            );
            if (picker) {
                updateDisciplineCandidateSelectionState(picker);
            }
            return;
        }
    }

    function handleInput(e) {
        var target = e.target;
        if (!target) { return; }

        if (target.dataset && target.dataset.assessmentWeightType) {
            handleAssessmentWeightChange(target);
            return;
        }

        if (target.dataset && target.dataset.disciplineField) {
            handleDisciplineFieldChange(target);
            return;
        }

        if (target.dataset &&
            target.dataset.bandIndex !== undefined &&
            target.dataset.bandField) {
            handleBandFieldChange(target);
            return;
        }

        if (target.id === 'academy-discipline-search') {
            debounceDisciplineSearch(target.value);
            return;
        }

        // ---- Candidate picker search ----
        if (target.classList &&
            target.classList.contains(
                'academy-teaching-group-candidate-search'
            )) {
            applyDisciplineCandidateSearchFilter(target);
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
    // CANDIDATE PICKER STATE (discipline sessions panel)
    // ============================================================

    function updateDisciplineCandidateSelectionState(picker) {
        if (!picker) { return; }

        var eligibleSection = picker.querySelector(
            '.academy-teaching-group-candidate-section' +
            '[data-section="eligible"]'
        );

        if (eligibleSection) {
            var totalCbs = eligibleSection.querySelectorAll(
                '.academy-teaching-group-candidate-checkbox'
            );
            var checkedCbs = eligibleSection.querySelectorAll(
                '.academy-teaching-group-candidate-checkbox:checked'
            );

            var countEl = eligibleSection.querySelector(
                '[data-section-count="eligible"]'
            );
            if (countEl) {
                countEl.textContent =
                    checkedCbs.length + ' / ' + totalCbs.length;
            }
        }

        var addBtn = picker.querySelector(
            '[data-action="discipline-sessions-add-student-submit"]'
        );
        if (!addBtn) { return; }

        var checked = picker.querySelectorAll(
            '.academy-teaching-group-candidate-checkbox:checked'
        ).length;

        if (checked === 0) {
            addBtn.setAttribute('disabled', 'disabled');
            addBtn.textContent = 'Add';
        } else {
            addBtn.removeAttribute('disabled');
            addBtn.textContent = 'Add (' + checked + ')';
        }
    }

    function selectAllVisibleInDisciplineSection(picker, sectionKey) {
        if (!picker || !sectionKey) { return; }

        var section = picker.querySelector(
            '.academy-teaching-group-candidate-section' +
            '[data-section="' + cssEscapeLocal(sectionKey) + '"]'
        );
        if (!section) { return; }

        var rows = section.querySelectorAll(
            '.academy-teaching-group-candidate-row'
        );
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (row.style.display === 'none') { continue; }
            var cb = row.querySelector(
                '.academy-teaching-group-candidate-checkbox'
            );
            if (cb) { cb.checked = true; }
        }
    }

    function clearDisciplineSection(picker, sectionKey) {
        if (!picker || !sectionKey) { return; }

        var section = picker.querySelector(
            '.academy-teaching-group-candidate-section' +
            '[data-section="' + cssEscapeLocal(sectionKey) + '"]'
        );
        if (!section) { return; }

        var cbs = section.querySelectorAll(
            '.academy-teaching-group-candidate-checkbox'
        );
        for (var i = 0; i < cbs.length; i++) {
            cbs[i].checked = false;
        }
    }

    function applyDisciplineCandidateSearchFilter(inputEl) {
        if (!inputEl) { return; }
        var picker = inputEl.closest(
            '.academy-teaching-group-candidate-picker'
        );
        if (!picker) { return; }

        var term = (inputEl.value || '').toLowerCase().trim();
        var rows = picker.querySelectorAll(
            '.academy-teaching-group-candidate-row'
        );

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var key = row.dataset ? (row.dataset.searchKey || '') : '';
            var matches = term === '' || key.indexOf(term) !== -1;
            row.style.display = matches ? '' : 'none';
        }

        var sections = picker.querySelectorAll(
            '.academy-teaching-group-candidate-section'
        );
        var totalVisible = 0;

        for (var s = 0; s < sections.length; s++) {
            var section = sections[s];
            var sectionRows = section.querySelectorAll(
                '.academy-teaching-group-candidate-row'
            );
            var visibleInSection = 0;
            for (var r = 0; r < sectionRows.length; r++) {
                if (sectionRows[r].style.display !== 'none') {
                    visibleInSection++;
                }
            }
            totalVisible += visibleInSection;
            section.style.display = visibleInSection === 0 ? 'none' : '';
        }

        var noMatches = picker.querySelector('[data-no-matches]');
        if (noMatches) {
            noMatches.style.display = totalVisible === 0 ? '' : 'none';
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
    // GRID CELL ACTIONS
    // ============================================================

    function handleScheduleDisciplineAssign(actionEl) {
        if (!actionEl || !actionEl.dataset) { return; }

        if (!_disciplineDraft || !_disciplineDraft.id) {
            notify('Save the discipline first.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify('Select a class first.', 'error');
            return;
        }

        var week = resolveScheduleWeek();
        if (week === null) {
            notify('Select a valid week.', 'error');
            return;
        }

        var day = parseStrictInteger(actionEl.dataset.day);
        var hour = parseStrictInteger(actionEl.dataset.hour);
        if (day === null || hour === null) {
            return;
        }

        var Modal = getScheduleInstructorModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Instructor scheduler is not available.',
                'error'
            );
            return;
        }

        var ctx = getContext();

        Modal.openModal({
            mode: 'picker',
            classId: String(classId),
            disciplineId: String(_disciplineDraft.id),
            week: week,
            day: day,
            startHour: hour,
            onClose: function() {
                ctx.onChange();
            }
        });
    }

    function handleScheduleDisciplineSlotOpen(actionEl) {
        if (!actionEl || !actionEl.dataset) { return; }

        var sessionId = actionEl.dataset.sessionId;
        var groupId = actionEl.dataset.groupId;
        var classId = AcademyUI.getSelectedClassId();

        if (!isNonEmptyString(sessionId)) {
            console.warn(
                '[AcademyDisciplineController] ' +
                'schedule-discipline-slot-open fired without a ' +
                'sessionId'
            );
            return;
        }

        var Modal = getSessionActionsModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Session actions are not available.',
                'error'
            );
            return;
        }

        var ctx = getContext();

        Modal.openModal({
            sessionId: String(sessionId),
            groupId: isNonEmptyString(groupId)
                ? String(groupId)
                : null,
            classId: isNonEmptyString(classId)
                ? String(classId)
                : null,

            // ---- Add-another-instructor callback ----
            //
            // The actions modal closes itself before invoking this.
            // Our job is to open the instructor picker in `picker`
            // mode, pre-filled with the clicked slot. The picker
            // creates a second session at the same (day, hour) for
            // a different instructor; the grid then renders two
            // co-occupants in the cell.
            onAddInstructor: function(day, hour) {
                var InstructorModal = getScheduleInstructorModal();
                if (!InstructorModal ||
                    typeof InstructorModal.openModal !== 'function') {
                    notify(
                        'Instructor scheduler is not available.',
                        'error'
                    );
                    return;
                }

                if (!_disciplineDraft || !_disciplineDraft.id) {
                    notify('Discipline is not available.', 'error');
                    return;
                }

                var resolvedClassId = AcademyUI.getSelectedClassId();
                if (!isNonEmptyString(resolvedClassId)) {
                    notify('Select a class first.', 'error');
                    return;
                }

                var week = resolveScheduleWeek();
                if (week === null) {
                    notify('Select a valid week.', 'error');
                    return;
                }

                InstructorModal.openModal({
                    mode: 'picker',
                    classId: String(resolvedClassId),
                    disciplineId: String(_disciplineDraft.id),
                    week: week,
                    day: day,
                    startHour: hour,
                    onClose: function() {
                        var c = getContext();
                        c.onChange();
                    }
                });
            },

            onClose: function() {
                ctx.onChange();
            }
        });
    }

    // ============================================================
    // GROUP MANAGEMENT + REBALANCE
    // ============================================================

    function handleManageGroups() {
        if (!_disciplineDraft || !_disciplineDraft.id) {
            notify('Save the discipline first.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify('Select a class first.', 'error');
            return;
        }

        var Modal = getGroupManagementModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify('Group management is not available.', 'error');
            return;
        }

        var ctx = getContext();

        Modal.openModal({
            classId: String(classId),
            disciplineId: String(_disciplineDraft.id),
            onClose: function() {
                ctx.onChange();
            }
        });
    }

    function handleRebalance() {
        if (!_disciplineDraft || !_disciplineDraft.id) {
            notify('Save the discipline first.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify('Select a class first.', 'error');
            return;
        }

        var week = resolveScheduleWeek();
        if (week === null) {
            notify('Select a valid week.', 'error');
            return;
        }

        var Modal = getRebalanceModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify('Rebalance is not available.', 'error');
            return;
        }

        var ctx = getContext();

        Modal.openModal({
            classId: String(classId),
            disciplineId: String(_disciplineDraft.id),
            week: week,
            onClose: function() {
                ctx.onChange();
            }
        });
    }

    // ============================================================
    // HIGHLIGHT FILTER
    // ============================================================

    function handleToggleHighlightFilterPanel(buttonEl) {
        if (!buttonEl || typeof buttonEl.closest !== 'function') {
            return;
        }

        if (_scheduleHighlight !== null) {
            return;
        }

        var wrap = buttonEl.closest('.discipline-highlight-filter');
        if (!wrap) { return; }

        var expanded = wrap.getAttribute('data-expanded') === 'true';
        var next = !expanded;

        wrap.setAttribute('data-expanded', next ? 'true' : 'false');

        var caret = buttonEl.querySelector(
            '.discipline-highlight-launcher-caret'
        );
        if (caret) {
            caret.textContent = next ? '\u25be' : '\u25b8';
        }

        var body = wrap.querySelector('.discipline-highlight-body');
        if (body) {
            body.style.display = next ? 'block' : 'none';
        }
    }

    function handleFindFreeSlotSubmit() {
        if (!_host || typeof _host.querySelector !== 'function') {
            return;
        }

        if (!_disciplineDraft || !_disciplineDraft.id) {
            notify('Save the discipline first.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify('Select a class first.', 'error');
            return;
        }

        var instructorInput = _host.querySelector(
            '.discipline-highlight-instructor-select'
        );
        if (!instructorInput) {
            notify('Instructor field not found.', 'error');
            return;
        }

        var instructorId = isNonEmptyString(instructorInput.value)
            ? String(instructorInput.value)
            : null;
        if (instructorId === null) {
            notify('Select an instructor.', 'error');
            return;
        }

        var studentBoxes = _host.querySelectorAll(
            '.discipline-highlight-student-checkbox:checked'
        );
        var studentIds = [];
        for (var i = 0; i < studentBoxes.length; i++) {
            var v = studentBoxes[i].value;
            if (isNonEmptyString(v)) {
                studentIds.push(String(v));
            }
        }
        if (studentIds.length === 0) {
            notify('Select at least one student.', 'error');
            return;
        }

        var weeksInput = _host.querySelector(
            '.discipline-highlight-check-weeks'
        );
        var checkWeeks = DEFAULT_HIGHLIGHT_CHECK_WEEKS;
        if (weeksInput) {
            var parsedWeeks = parseStrictInteger(weeksInput.value);
            if (parsedWeeks !== null &&
                parsedWeeks >= 1 &&
                parsedWeeks <= MAX_HIGHLIGHT_CHECK_WEEKS) {
                checkWeeks = parsedWeeks;
            }
        }

        _scheduleHighlight = {
            instructorId: instructorId,
            studentIds: studentIds,
            checkWeeks: checkWeeks
        };

        var ctx = getContext();
        ctx.onChange();
    }

    function handleClearHighlight() {
        if (_scheduleHighlight === null) { return; }
        _scheduleHighlight = null;
        var ctx = getContext();
        ctx.onChange();
    }

    // ============================================================
    // SUMMARY PANEL TOGGLE
    // ============================================================

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
            '[data-action="discipline-sessions-add-student-submit"]'
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
        var CQ = getCharacterQueries();
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
                // The draft's scheme is a mutable clone; the write
                // lands.
                _disciplineDraft.gradeScheme.label = inputEl.value;
                return;
            case 'schemePresetId':
                return;
            default:
                return;
        }
    }

    /**
     * Handle a change to a band field.
     *
     * MUTABLE DRAFT (this revision):
     *   The draft's bands array is a plain (unfrozen) array of
     *   plain band objects. Writes to band.label and
     *   band.minPercent succeed. See the file header's GRADE
     *   SCHEME DRAFT section.
     *
     * MIN-PERCENT PARSING:
     *   The input's value is parsed strictly before it is written
     *   to the draft. A non-integer input is NOT written: the
     *   input element is marked with the has-error class and a
     *   per-band error is recorded, but the draft keeps its
     *   previous value so the scheme stays valid until the user
     *   corrects the input.
     *
     * LABEL WRITE:
     *   A label write succeeds even for empty input. Empty labels
     *   are tolerated in the draft but are caught at save time by
     *   saveDisciplineDraft's preflight validation, which surfaces
     *   a specific "Band N label is required" error. This keeps
     *   the per-keystroke behaviour non-disruptive: a user can
     *   clear a field to retype it without an error firing on the
     *   first Backspace.
     */
    function handleBandFieldChange(inputEl) {
        if (!_disciplineDraft) { return; }

        var idx = parseInt(inputEl.dataset.bandIndex, 10);
        var field = inputEl.dataset.bandField;
        if (isNaN(idx) || !field) { return; }

        var bands = _disciplineDraft.gradeScheme.bands;
        if (!bands || idx < 0 || idx >= bands.length) { return; }

        if (field === 'label') {
            bands[idx].label = inputEl.value;
            clearBandFieldError(idx, 'label');
            inputEl.classList.remove('academy-field-has-error');
            updateDisciplinePreviewInPlace();
            return;
        }

        if (field === 'minPercent') {
            var parsed = parseStrictInteger(inputEl.value);

            if (parsed === null ||
                parsed < 0 ||
                parsed > 100) {
                setBandFieldError(
                    idx,
                    'minPercent',
                    'Min percent must be a whole number between 0 and 100.'
                );
                inputEl.classList.add('academy-field-has-error');
                // Draft is NOT updated. Keep the scheme valid.
                return;
            }

            // Reject a duplicate minPercent value within the same
            // scheme. Duplicates make the scheme invalid and trigger
            // normalizeScheme's fallback.
            for (var other = 0; other < bands.length; other++) {
                if (other === idx) { continue; }
                if (parseStrictInteger(bands[other].minPercent) === parsed) {
                    setBandFieldError(
                        idx,
                        'minPercent',
                        'Another band already uses ' + parsed + '%.'
                    );
                    inputEl.classList.add('academy-field-has-error');
                    return;
                }
            }

            bands[idx].minPercent = parsed;
            clearBandFieldError(idx, 'minPercent');
            inputEl.classList.remove('academy-field-has-error');
            updateDisciplinePreviewInPlace();
        }
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

    // ---- Per-band error bookkeeping ----

    function setBandFieldError(idx, field, message) {
        if (!_disciplineDraftErrors) { _disciplineDraftErrors = {}; }
        if (!_disciplineDraftErrors.bandErrors) {
            _disciplineDraftErrors.bandErrors = {};
        }
        var key = String(idx);
        if (!_disciplineDraftErrors.bandErrors[key]) {
            _disciplineDraftErrors.bandErrors[key] = {};
        }
        _disciplineDraftErrors.bandErrors[key][field] = message;
    }

    function clearBandFieldError(idx, field) {
        if (!_disciplineDraftErrors ||
            !_disciplineDraftErrors.bandErrors) {
            return;
        }
        var key = String(idx);
        if (!_disciplineDraftErrors.bandErrors[key]) { return; }
        delete _disciplineDraftErrors.bandErrors[key][field];
        if (Object.keys(_disciplineDraftErrors.bandErrors[key]).length === 0) {
            delete _disciplineDraftErrors.bandErrors[key];
        }
    }

    function clearAllBandFieldErrors() {
        if (_disciplineDraftErrors &&
            _disciplineDraftErrors.bandErrors) {
            delete _disciplineDraftErrors.bandErrors;
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
            _disciplineDraft.gradeScheme = cloneSchemeForDraft({
                id: 'custom',
                label: _disciplineDraft.gradeScheme.label ||
                    'Custom Scheme',
                bands: _disciplineDraft.gradeScheme.bands || []
            });
        } else {
            var preset = GradeSchemes.getPreset(presetId);
            if (preset) {
                _disciplineDraft.gradeScheme =
                    cloneSchemeForDraft(preset);
            }
        }

        clearAllBandFieldErrors();

        var ctx = getContext();
        ctx.onChange();
    }

    /**
     * Add a band to the draft.
     *
     * The new band gets a non-colliding label ('Band N') and a
     * minPercent strictly below the current lowest band's value.
     * The scheme is replaced with a fresh mutable clone so all
     * subsequent writes hit mutable targets.
     */
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

        var newLabel = nextBandLabel(bands);
        var newMinPercent = nextBandMinPercent(bands);

        bands.push({
            label: newLabel,
            minPercent: newMinPercent
        });

        // Replace the draft's scheme with a fresh mutable clone.
        // This canonicalises (sort descending) and ensures every
        // node is unfrozen.
        if (GradeSchemes) {
            _disciplineDraft.gradeScheme = cloneSchemeForDraft({
                id: _disciplineDraft.gradeScheme.id,
                label: _disciplineDraft.gradeScheme.label,
                bands: bands
            });
        }

        clearAllBandFieldErrors();

        var ctx = getContext();
        ctx.onChange();
    }

    function nextBandLabel(bands) {
        var used = Object.create(null);
        for (var i = 0; i < bands.length; i++) {
            if (bands[i] && isNonEmptyString(bands[i].label)) {
                used[String(bands[i].label)] = true;
            }
        }

        var n = bands.length + 1;
        var candidate = 'Band ' + n;
        var safety = 0;
        while (used[candidate] && safety < 100) {
            n++;
            candidate = 'Band ' + n;
            safety++;
        }
        return candidate;
    }

    function nextBandMinPercent(bands) {
        var lowestPositive = null;
        for (var i = 0; i < bands.length; i++) {
            var band = bands[i];
            if (!band) { continue; }
            var v = parseStrictInteger(band.minPercent);
            if (v === null) { continue; }
            if (v <= 0) { continue; }
            if (lowestPositive === null || v < lowestPositive) {
                lowestPositive = v;
            }
        }

        if (lowestPositive === null) {
            return 50;
        }

        if (lowestPositive <= 1) {
            return 0;
        }

        return lowestPositive - 1;
    }

    /**
     * Remove a band from the draft.
     *
     * The scheme is replaced with a fresh mutable clone.
     * Refuses to remove the last minPercent: 0 band.
     */
    function handleRemoveBand(buttonEl) {
        if (!_disciplineDraft) { return; }

        var idx = parseInt(buttonEl.dataset.bandIndex, 10);
        if (isNaN(idx)) { return; }

        var currentBands = _disciplineDraft.gradeScheme.bands || [];
        if (currentBands.length <= 1) {
            notify('A scheme must have at least one band.', 'error');
            return;
        }

        var target = currentBands[idx];
        if (!target) { return; }

        var targetIsZero =
            parseStrictInteger(target.minPercent) === 0;

        if (targetIsZero) {
            var otherZeros = 0;
            for (var i = 0; i < currentBands.length; i++) {
                if (i === idx) { continue; }
                if (parseStrictInteger(
                    currentBands[i].minPercent
                ) === 0) {
                    otherZeros++;
                }
            }
            if (otherZeros === 0) {
                notify(
                    'One band must keep min percent 0, or the scheme ' +
                    'cannot match every score.',
                    'error'
                );
                return;
            }
        }

        currentBands.splice(idx, 1);

        if (GradeSchemes) {
            _disciplineDraft.gradeScheme = cloneSchemeForDraft({
                id: _disciplineDraft.gradeScheme.id,
                label: _disciplineDraft.gradeScheme.label,
                bands: currentBands
            });
        }

        clearAllBandFieldErrors();

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

    /**
     * Build the payload for AcademyDisciplines.create / update.
     *
     * NORMALISATION:
     *   The draft's scheme (already mutable, already valid) is
     *   passed through normalizeScheme once more, which
     *   canonicalises the bands (sorts descending) and returns a
     *   frozen object. That frozen object goes straight into the
     *   payload; the domain layer stores and returns it; no one
     *   mutates it.
     *
     *   saveDisciplineDraft has already validated the scheme
     *   before this runs, so normalizeScheme cannot fall back.
     */
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

    /**
     * Save the discipline draft.
     *
     * PREFLIGHT VALIDATION:
     *   The draft's grade scheme is validated before the payload
     *   is built. When validation fails, the specific errors are
     *   surfaced as a toast and the save is refused. The draft is
     *   unchanged, so the user can fix the problem in place.
     */
    function saveDisciplineDraft() {
        if (!_disciplineDraft) { return; }

        if (!AcademyDisciplines) {
            notify('Discipline module not available.', 'error');
            return;
        }

        // ---- Preflight scheme validation ----
        var schemeCheck = GradeSchemes.validateScheme(
            _disciplineDraft.gradeScheme
        );

        if (!schemeCheck.valid) {
            var messages = [];
            for (var i = 0; i < schemeCheck.errors.length; i++) {
                var err = schemeCheck.errors[i];
                if (!err) { continue; }
                if (isNonEmptyString(err.message)) {
                    messages.push(String(err.message));
                }
            }

            var summary = messages.length > 0
                ? messages.join(' ')
                : 'The grade scheme is invalid.';

            notify(
                'Cannot save: the grade scheme is invalid. ' + summary,
                'error'
            );
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

        _openDisciplineSessionsGroupId = null;
        _openDisciplineSessionsCandidates = null;
        _scheduleHighlight = null;

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
