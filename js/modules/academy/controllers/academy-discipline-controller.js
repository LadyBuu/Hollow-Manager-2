/**
 * modules/academy/controllers/academy-discipline-controller.js
 * Academy Discipline Controller
 *
 * Path: js/modules/academy/controllers/academy-discipline-controller.js
 *
 * The Disciplines feature controller. Owns the Disciplines view:
 * its render, its event handlers, its editor draft state, and its
 * search debounce.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Disciplines view into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by the
 *     shell for events that occur inside the host.
 *   - The discipline editor draft (name, type, weeks, weight,
 *     grade scheme, assessment weights) and its mode
 *     ('empty' | 'create' | 'edit').
 *   - Per-field and per-band validation errors on the draft.
 *   - The list filter (type, search) as feature state.
 *   - The search debounce timer.
 *   - The editor's live preview (the "range label" text under the
 *     scheme preset row).
 *   - The editor's save, cancel, apply-preset, add-band, remove-band,
 *     and reset-weights actions.
 *   - The "+ Add Discipline" flow (B4-1).
 *   - The discipline delete confirm modal, via AcademyCRUDModals.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The class, character, or location selections. Disciplines are
 *     global; the controller does not read any selection.
 *   - The display week. Disciplines are not week-scoped at the list
 *     level; the editor's week fields come from the draft.
 *   - Re-rendering the shell. When a mutation or draft change should
 *     re-render, the controller calls context.onChange().
 *   - Discipline domain reads and writes. AcademyDisciplines owns
 *     them; AcademyAggregator produces the VMs.
 *   - Instructor assignment for a discipline. That relationship is
 *     class-scoped and is owned by the class-disciplines picker.
 *     The discipline editor does not offer an instructor picker
 *     (v27).
 *   - The delete-confirm modal's onChange wiring. The shell keeps
 *     that wiring (via AcademyCRUDModals.setOnChangeCallback), and
 *     the controller simply opens the modal. This is the same
 *     arrangement the shell used pre-S1.3.
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
 *   adds a matching case here. The handler calls initializeNewDraft
 *   and fires context.onChange() to render the create form.
 *
 * INSTRUCTOR PICKER REMOVAL (v27):
 *   The editor no longer carries an instructor picker. The retired
 *   `draft.instructorIds` field is gone. The switch case that used
 *   to handle instructor selection has been removed. The
 *   availableInstructors list on the editor VM is now unused by
 *   this view; it remains on the VM for one more pass until the
 *   discipline-editor-draft retirement lands.
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
 *   The context is intentionally minimal. Discipline editing is
 *   self-contained: there is nothing to select outside the view and
 *   nothing to navigate to.
 *
 * EVENT ROUTING:
 *   The controller's handle* methods receive the raw DOM event. The
 *   action names and data attributes emitted by the discipline
 *   renderer are unchanged from pre-S1.3 (with the B4-1 addition of
 *   discipline-add), and the controller handles the same strings
 *   the shell's dispatcher did. No renderer changes are needed
 *   beyond the B4-1 button markup.
 *
 * DEPENDENCIES:
 *   - window.AcademyUI             (for getDisplayWeek, if needed)
 *   - window.AcademyAggregator
 *   - window.AcademyDisciplines
 *   - window.AcademyDisciplineView
 *   - window.AcademyGradeSchemes
 *   - window.AcademyCRUDModals     (lazy; for the delete confirm)
 *   - window.CharacterQueries      (lazy; used by the aggregator)
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

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

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

    var _host = null;
    var _context = null;

    var _selectedDisciplineId = null;
    var _disciplineDraft = null;
    var _disciplineDraftMode = 'empty';
    var _disciplineDraftErrors = {};

    var _disciplineFilters = { type: 'all', search: '' };
    var _disciplineSearchTimer = null;

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

        var html;
        try {
            html = View.renderHTML({
                disciplines: listVM.disciplines,
                selected: editorVM,
                editorMode: _disciplineDraftMode,
                filters: _disciplineFilters,
                total: listVM.total
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

        // NOTE (v27): `instructorIds` is NOT part of the draft.
        // The retired global instructor list has no UI here.
        // Instructor-of-a-discipline-for-a-class is edited through
        // the class-disciplines picker.
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
        // No keyboard shortcuts in the Disciplines view. Reserved.
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
                // The preset select only takes effect when the user
                // clicks Apply Preset. Handled separately.
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

        // Host-scoped query. The pre-S1.3 shell used
        // document.querySelector; scoping to the host is the correct
        // behaviour for a controller that owns its content.
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

        // Host-scoped query. Resolves the preset select inside this
        // controller's rendered content.
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
            // The modal's onChange callback is wired by the shell via
            // AcademyCRUDModals.setOnChangeCallback. The controller
            // does not touch that wiring.
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

        // NOTE (v27): `instructorIds` is NOT part of the payload.
        // The retired global instructor list is not editable here.
        // AcademyDisciplines.create/update silently ignore the field
        // if a caller passes it; this controller does not pass it.
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
        // Clear the draft. Matches pre-S1.3: switching away from
        // Disciplines abandons an in-progress edit.
        clearDraft();

        // Clear the debounce timer. A pending search refresh after
        // the view is gone should not fire.
        if (_disciplineSearchTimer) {
            clearTimeout(_disciplineSearchTimer);
            _disciplineSearchTimer = null;
        }

        // The list filter is deliberately NOT cleared. Matches
        // pre-S1.3: the type and search filter survive a view switch.

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