/**
 * modules/social/social-events.js - Social Events
 * Event orchestration for the standalone Social tab, and the
 * single owner of the shared relationship modal.
 *
 * IMPORTANT:
 *   - Orchestrates UI interactions for the STANDALONE Social tab
 *   - Calls SocialCore for mutations
 *   - Calls SocialViews for rendering
 *   - Calls SocialGraph for graph rendering
 *   - Uses Modal for modal lifecycle
 *   - Uses NotificationSystem for notifications
 *   - No direct data mutation
 *
 * SHARED RELATIONSHIP MODAL (this revision):
 *   The relationship form is now a single modal, lazily installed
 *   into document.body by ensureRelationshipModalShell(). Both
 *   entry points use it:
 *
 *     - The standalone Social tab   (via #add-relationship-btn)
 *     - The character form Social   (via #add-char-relationship-btn,
 *                                    which delegates here)
 *
 *   The old character-tab form
 *   (character-views.buildRelationshipFormHTML) has been retired.
 *   Do not reintroduce it. One form, one code path, one set of
 *   bugs to fix.
 *
 *   ensureRelationshipModalShell() is idempotent: it returns true
 *   immediately if #relationship-form-modal is already in the
 *   document. It installs the shell, then rebinds the form's own
 *   handlers, so opening the modal from the character tab works
 *   even if the standalone tab was never mounted.
 *
 * MODAL LIFECYCLE:
 *   Every modal in this file uses Modal.hideModal for teardown,
 *   not Modal.closeModal. closeModal DESTROYS the modal element;
 *   the shells are rendered once and are never re-mounted, so a
 *   destroyed shell means the next open fails.
 *
 *   Do not reintroduce Modal.closeModal anywhere in this file.
 *
 * EDIT STATE:
 *   _editId is set only inside handleAddRelationship and cleared
 *   inside handleCloseRelationshipForm. It is cleared FIRST, at the
 *   top of handleAddRelationship, before any early-return path, so
 *   a previous failed edit cannot leak into the next one.
 *
 * CLARIFICATIONS (two-sided):
 *   The form carries #rel-clarification-1 and
 *   #rel-clarification-2. The labels are refreshed on open and
 *   whenever either character select changes.
 *
 *   When a character select changes, the CORRESPONDING clarification
 *   field is cleared. The field's semantic is "the role of the
 *   character currently selected in slot N".
 *
 * SWAP BUTTON:
 *   For directional types (mentor), the relationship form carries a
 *   swap button (#rel-swap-btn) next to character 2.
 *
 * AGE PREVIEW (new):
 *   refreshRelationshipAgePreview() is called:
 *     - once on modal open, after the form is populated
 *     - on every character-select change
 *     - on every start-year / end-year input
 *   It renders ages at start, end, and today.
 *
 * ELIMINATED CHARACTERS:
 *   The relationship modal carries #rel-include-eliminated. When
 *   unchecked (the default), the character selects hide characters
 *   with any elimination on record. On EDIT mode, the current value
 *   on each side is always preserved.
 *
 * GRAPH DRILL-DOWN:
 *   The graph is FOCUSED. One character is centered; its direct
 *   connections sit on a ring around it. See the graph module for
 *   the focus API.
 *
 * DEPENDENCIES:
 *   - window.SocialCore
 *   - window.SocialViews
 *   - window.SocialQueries
 *   - window.SocialAggregator
 *   - window.SocialGraph
 *   - window.CharacterQueries (for breadcrumb name resolution)
 *   - window.Modal
 *   - window.NotificationSystem
 */

(function() {
    'use strict';

    if (window.__socialEventsLoaded) {
        return;
    }
    window.__socialEventsLoaded = true;

    var SocialCore = window.SocialCore;
    var SocialViews = window.SocialViews;
    var SocialQueries = window.SocialQueries;
    var SocialAggregator = window.SocialAggregator;
    var SocialGraph = window.SocialGraph;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    function checkDependencies() {
        var missing = [];

        if (!SocialCore || typeof SocialCore.createRelationship !== 'function') {
            missing.push('SocialCore.createRelationship');
        }
        if (!SocialCore || typeof SocialCore.updateRelationship !== 'function') {
            missing.push('SocialCore.updateRelationship');
        }
        if (!SocialCore || typeof SocialCore.deleteRelationship !== 'function') {
            missing.push('SocialCore.deleteRelationship');
        }

        if (!SocialViews || typeof SocialViews.renderSocialView !== 'function') {
            missing.push('SocialViews.renderSocialView');
        }
        if (!SocialViews || typeof SocialViews.renderRelationships !== 'function') {
            missing.push('SocialViews.renderRelationships');
        }
        if (!SocialViews || typeof SocialViews.renderCharacterDetailContent !== 'function') {
            missing.push('SocialViews.renderCharacterDetailContent');
        }
        if (!SocialViews || typeof SocialViews.populateFormSelectors !== 'function') {
            missing.push('SocialViews.populateFormSelectors');
        }
        if (!SocialViews || typeof SocialViews.getRelationshipModalHTML !== 'function') {
            missing.push('SocialViews.getRelationshipModalHTML');
        }

        if (!SocialQueries || typeof SocialQueries.getRelationshipById !== 'function') {
            missing.push('SocialQueries.getRelationshipById');
        }

        if (!SocialAggregator || typeof SocialAggregator.getConnectedCharactersViewModel !== 'function') {
            missing.push('SocialAggregator.getConnectedCharactersViewModel');
        }

        if (!SocialGraph || typeof SocialGraph.setGraphVisible !== 'function') {
            missing.push('SocialGraph.setGraphVisible');
        }
        if (!SocialGraph || typeof SocialGraph.renderGraph !== 'function') {
            missing.push('SocialGraph.renderGraph');
        }
        if (!SocialGraph || typeof SocialGraph.pushFocus !== 'function') {
            missing.push('SocialGraph.pushFocus');
        }
        if (!SocialGraph || typeof SocialGraph.popFocus !== 'function') {
            missing.push('SocialGraph.popFocus');
        }
        if (!SocialGraph || typeof SocialGraph.getFocusPath !== 'function') {
            missing.push('SocialGraph.getFocusPath');
        }

        if (!Modal || typeof Modal.showModal !== 'function') {
            missing.push('Modal.showModal');
        }
        if (!Modal || typeof Modal.hideModal !== 'function') {
            missing.push('Modal.hideModal');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            console.warn('[SocialEvents] Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    /**
     * Hide a modal safely.
     *
     * Every teardown in this file funnels through here. Uses
     * hideModal, not closeModal — see the MODAL LIFECYCLE note in
     * the file header.
     */
    function hideModal(modal) {
        if (!modal) { return; }
        try {
            Modal.hideModal(modal);
        } catch (e) {
            console.warn('[SocialEvents] hideModal threw:', e);
        }
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];
    var _editId = null;

    // Populating guard. Set true while populateFormSelectors and the
    // initial value assignments run, so a future refactor that
    // triggers a programmatic `change` event cannot be mistaken for
    // a user edit.
    var _populatingRelationshipForm = false;

    // Tracks whether the relationship form's internal handlers
    // have been bound. The modal can be installed lazily (when the
    // character tab needs it and the standalone tab was never
    // mounted), in which case bindRelationshipForm must run once
    // after install. Subsequent calls are no-ops.
    var _relationshipFormBound = false;

    // ============================================================
    // EVENT BINDING HELPERS
    // ============================================================

    function addEventListener(element, eventName, handler, options) {
        if (!element) { return; }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) { /* ignore */ }
        });
        _eventListeners = [];
    }

    function delegate(selector, eventName, handler) {
        function wrappedHandler(e) {
            var target = e.target.closest ? e.target.closest(selector) : null;
            if (!target) { return; }
            handler(e, target);
        }

        document.addEventListener(eventName, wrappedHandler);

        _eventListeners.push({
            element: document,
            eventName: eventName,
            handler: wrappedHandler,
            options: false
        });

        return wrappedHandler;
    }

    // ============================================================
    // SHARED RELATIONSHIP MODAL SHELL
    // ============================================================
    //
    // The relationship modal is a single shell, rendered once, and
    // shared by the standalone Social tab and the character form's
    // Social section.
    //
    // It lives in whichever container rendered it first:
    //   - the standalone tab renders it inline via getSocialHTML()
    //   - this function installs it into document.body if the
    //     standalone tab has never been mounted
    //
    // Either way, #relationship-form-modal exists exactly once.
    // ensureRelationshipModalShell() is the entry point that
    // guarantees it.

    /**
     * Ensure #relationship-form-modal exists in the document.
     * Returns true when the shell is present (whether it was
     * already there or was just installed), false on failure.
     *
     * Idempotent. Safe to call before every modal open.
     */
    function ensureRelationshipModalShell() {
        if (document.getElementById('relationship-form-modal')) {
            return true;
        }

        if (!SocialViews ||
            typeof SocialViews.getRelationshipModalHTML !== 'function') {
            return false;
        }

        var host = document.createElement('div');
        host.innerHTML = SocialViews.getRelationshipModalHTML();
        var node = host.firstElementChild;
        if (!node) { return false; }

        document.body.appendChild(node);

        // The shell was just installed, so its internal handlers
        // (close, cancel, submit, outside-click, character-change,
        // type-change, include-eliminated) are not yet bound.
        // Bind them now. Idempotence is handled inside
        // bindRelationshipForm via _relationshipFormBound.
        bindRelationshipForm();

        return true;
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (_initialized) { destroy(); }

        if (!checkDependencies()) {
            console.warn('[SocialEvents] Dependencies not met, skipping initialization');
            return;
        }

        if (!container) {
            container = document.getElementById('tab-social');
        }
        if (!container) {
            console.warn('[SocialEvents] Container not found');
            return;
        }

        // Wipe state a previous init may have left behind.
        _editId = null;
        _populatingRelationshipForm = false;
        _relationshipFormBound = false;

        SocialViews.renderSocialView(container);

        bindAddRelationship();
        bindViewModeButtons();
        bindRelationshipForm();
        bindFilters();
        bindZoomControls();
        bindCharacterDetail();

        bindDeleteRelationship();
        bindEditRelationship();
        bindGroupToggle();

        bindSuggestPairs();
        bindCreateChild();

        // Graph drill-down (focus stack, breadcrumb, back button).
        bindGraphDrilldown();

        _initialized = true;
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
        _editId = null;
        _populatingRelationshipForm = false;
        _relationshipFormBound = false;
    }

    // ============================================================
    // ADD / EDIT RELATIONSHIP
    // ============================================================

    function bindAddRelationship() {
        var addBtn = document.getElementById('add-relationship-btn');
        if (addBtn) {
            addEventListener(addBtn, 'click', function() {
                handleAddRelationship();
            });
        }
    }

    /**
     * Open the relationship modal.
     *
     * _editId is cleared first, unconditionally, before any early
     * return. This prevents a failed previous edit from leaking its
     * state into a subsequent open.
     *
     * When editing, the two current character ids are read off the
     * existing relationship and passed to populateFormSelectors as
     * preserve1 / preserve2, so a filtered-out (eliminated) value on
     * either side survives the initial population.
     *
     * POPULATION GUARD:
     *   _populatingRelationshipForm is set true at the top of the
     *   body and false at the end, around the populate + initial
     *   value assignments.
     *
     * SWAP BUTTON VISIBILITY:
     *   updateSwapButtonVisibility() is called at the end, after the
     *   type select has been set.
     *
     * AGE PREVIEW:
     *   refreshRelationshipAgePreview() is called at the end, so the
     *   preview reflects the freshly-populated form.
     *
     * PUBLIC. Can be called from any module that wants to open the
     * shared relationship modal. The character tab's Social section
     * uses this entry point directly.
     */
    function handleAddRelationship(editId) {
        _editId = editId ? String(editId) : null;

        if (!ensureRelationshipModalShell()) {
            _editId = null;
            notify('Relationship form is not available.', 'error');
            return;
        }

        var title = document.getElementById('relationship-form-title');
        var form = document.getElementById('relationship-form-inner');
        var modal = document.getElementById('relationship-form-modal');

        if (!title || !form || !modal) {
            _editId = null;
            notify('Relationship form is not available.', 'error');
            return;
        }

        // Look up the record being edited first, so its current
        // values are available to the populate call below.
        var editing = null;
        if (_editId) {
            editing = SocialQueries.getRelationshipById(_editId);
            if (!editing) {
                _editId = null;
                notify('Relationship not found.', 'error');
                return;
            }
        }

        // ---- Begin population guard ----
        _populatingRelationshipForm = true;

        try {
            // Reset the checkbox BEFORE populating. Default is
            // unchecked (hide eliminated characters).
            var includeCb = document.getElementById('rel-include-eliminated');
            if (includeCb) { includeCb.checked = false; }

            // Repopulate the character selects with the filter applied.
            // The editing values, if any, are preserved even when they
            // are eliminated, so an edit does not lose a side.
            SocialViews.populateFormSelectors({
                includeEliminated: false,
                preserve1: editing ? editing.character1 : null,
                preserve2: editing ? editing.character2 : null
            });

            SocialViews.populateTypeSelectors();

            form.reset();

            var c1El = document.getElementById('rel-char1');
            var c2El = document.getElementById('rel-char2');
            var typeEl = document.getElementById('rel-type');
            var clar1El = document.getElementById('rel-clarification-1');
            var clar2El = document.getElementById('rel-clarification-2');
            var startEl = document.getElementById('rel-start-year');
            var endEl = document.getElementById('rel-end-year');
            var notesEl = document.getElementById('rel-notes');

            if (editing) {
                title.textContent = 'Edit Relationship';

                if (c1El) { c1El.value = editing.character1 || ''; }
                if (c2El) { c2El.value = editing.character2 || ''; }
                if (typeEl) { typeEl.value = editing.typeId || ''; }
                if (startEl) { startEl.value = editing.startYear || ''; }
                if (endEl) { endEl.value = editing.endYear || ''; }
                if (notesEl) { notesEl.value = editing.notes || ''; }

                if (clar1El) {
                    clar1El.value = SocialQueries.readClarification(editing, 1);
                }
                if (clar2El) {
                    clar2El.value = SocialQueries.readClarification(editing, 2);
                }
            } else {
                title.textContent = 'Add Relationship';
            }
        } finally {
            // ---- End population guard ----
            _populatingRelationshipForm = false;
        }

        updateSwapButtonVisibility();
        SocialViews.refreshClarificationLabels();
        SocialViews.refreshRelationshipAgePreview();
        Modal.showModal(modal);
    }

    // ============================================================
    // RELATIONSHIP FORM
    // ============================================================

    /**
     * Bind the relationship form's internal handlers.
     *
     * Idempotent. The form shell can be installed lazily by
     * ensureRelationshipModalShell(), which calls this function
     * once after install. init() also calls this function; the
     * bound flag prevents double-binding.
     */
    function bindRelationshipForm() {
        if (_relationshipFormBound) { return; }

        var form = document.getElementById('relationship-form-inner');
        var closeBtn = document.getElementById('close-relationship-form');
        var cancelBtn = document.getElementById('cancel-relationship-form');
        var swapBtn = document.getElementById('rel-swap-btn');
        var modal = document.getElementById('relationship-form-modal');
        var c1 = document.getElementById('rel-char1');
        var c2 = document.getElementById('rel-char2');
        var typeEl = document.getElementById('rel-type');
        var includeCb = document.getElementById('rel-include-eliminated');
        var startEl = document.getElementById('rel-start-year');
        var endEl = document.getElementById('rel-end-year');

        // The shell may not exist yet (init ran before any modal
        // install, and the standalone tab has not rendered). Leave
        // _relationshipFormBound false so a later call binds once
        // the shell is present.
        if (!form) { return; }

        if (form) {
            addEventListener(form, 'submit', function(e) {
                e.preventDefault();
                handleSaveRelationship();
            });
        }

        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCloseRelationshipForm();
            });
        }

        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                handleCloseRelationshipForm();
            });
        }

        if (modal) {
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    handleCloseRelationshipForm();
                }
            });
        }

        // ---- Swap button ----
        //
        // Exchanges character 1 and character 2 and leaves the two
        // clarification fields where they are. The labels above the
        // fields refresh, so the user sees the new binding
        // immediately. The age preview refreshes too.
        if (swapBtn) {
            addEventListener(swapBtn, 'click', function(e) {
                e.preventDefault();
                handleSwapCharacters();
            });
        }

        // ---- Character 1 change handler ----
        //
        // When the user picks a different character for slot 1,
        // the clarification field for slot 1 is cleared.
        if (c1) {
            addEventListener(c1, 'change', function() {
                if (!_populatingRelationshipForm) {
                    var clar1El = document.getElementById('rel-clarification-1');
                    if (clar1El) { clar1El.value = ''; }
                }
                SocialViews.refreshClarificationLabels();
                SocialViews.refreshRelationshipAgePreview();
            });
        }

        if (c2) {
            addEventListener(c2, 'change', function() {
                if (!_populatingRelationshipForm) {
                    var clar2El = document.getElementById('rel-clarification-2');
                    if (clar2El) { clar2El.value = ''; }
                }
                SocialViews.refreshClarificationLabels();
                SocialViews.refreshRelationshipAgePreview();
            });
        }

        // ---- Type change handler ----
        //
        // The swap button is only meaningful for directional types.
        if (typeEl) {
            addEventListener(typeEl, 'change', function() {
                updateSwapButtonVisibility();
            });
        }

        // ---- Year inputs ----
        //
        // Every keystroke refreshes the age preview. The year input
        // elements are never replaced, so focus and caret position
        // survive.
        if (startEl) {
            addEventListener(startEl, 'input', function() {
                SocialViews.refreshRelationshipAgePreview();
            });
        }
        if (endEl) {
            addEventListener(endEl, 'input', function() {
                SocialViews.refreshRelationshipAgePreview();
            });
        }

        // ---- "Include eliminated characters" checkbox ----
        //
        // When toggled, repopulate the character selects, preserving
        // whatever is currently selected on each side.
        if (includeCb) {
            addEventListener(includeCb, 'change', function() {
                var c1El = document.getElementById('rel-char1');
                var c2El = document.getElementById('rel-char2');
                var preserve1 = c1El ? String(c1El.value || '') : '';
                var preserve2 = c2El ? String(c2El.value || '') : '';

                _populatingRelationshipForm = true;
                try {
                    SocialViews.populateFormSelectors({
                        includeEliminated: includeCb.checked === true,
                        preserve1: preserve1,
                        preserve2: preserve2
                    });
                } finally {
                    _populatingRelationshipForm = false;
                }

                SocialViews.refreshClarificationLabels();
                SocialViews.refreshRelationshipAgePreview();
            });
        }

        _relationshipFormBound = true;
    }

    /**
     * Flip the direction of a directional relationship.
     *
     * Exchanges character 1 and character 2. Does NOT touch the
     * clarification fields — see the file header for the reasoning.
     *
     * The age preview refreshes because the swap does not change
     * who is in the pair, only which slot each occupies, and the
     * preview shows both sides regardless of order.
     */
    function handleSwapCharacters() {
        var c1 = document.getElementById('rel-char1');
        var c2 = document.getElementById('rel-char2');
        if (!c1 || !c2) { return; }

        _populatingRelationshipForm = true;
        try {
            var tmpChar = c1.value;
            c1.value = c2.value;
            c2.value = tmpChar;
        } finally {
            _populatingRelationshipForm = false;
        }

        SocialViews.refreshClarificationLabels();
        SocialViews.refreshRelationshipAgePreview();
    }

    /**
     * Show the swap button only when the current type is directional.
     */
    function updateSwapButtonVisibility() {
        var swapBtn = document.getElementById('rel-swap-btn');
        var typeEl = document.getElementById('rel-type');
        if (!swapBtn || !typeEl) { return; }

        var SocialConstants = window.SocialConstants;
        var isDirectional = SocialConstants &&
            typeof SocialConstants.isDirectional === 'function' &&
            SocialConstants.isDirectional(typeEl.value);

        swapBtn.style.display = isDirectional ? 'inline-block' : 'none';
    }

    function handleSaveRelationship() {
        var char1 = document.getElementById('rel-char1').value;
        var char2 = document.getElementById('rel-char2').value;
        var typeId = document.getElementById('rel-type').value;
        var clar1 = document.getElementById('rel-clarification-1').value.trim();
        var clar2 = document.getElementById('rel-clarification-2').value.trim();
        var startYear = document.getElementById('rel-start-year').value;
        var endYear = document.getElementById('rel-end-year').value;
        var notes = document.getElementById('rel-notes').value.trim();

        if (!char1 || !char2 || !typeId) {
            notify('Please fill in all required fields.', 'error');
            return;
        }

        if (char1 === char2) {
            notify('Cannot create a relationship between the same character.', 'error');
            return;
        }

        var promise;

        if (_editId) {
            promise = SocialCore.updateRelationship(_editId, {
                character1: char1,
                character2: char2,
                typeId: typeId,
                clarification1: clar1,
                clarification2: clar2,
                startYear: startYear,
                endYear: endYear,
                notes: notes
            });
        } else {
            promise = SocialCore.createRelationship(
                char1, char2, typeId,
                startYear, endYear,
                clar1, clar2,
                notes
            );
        }

        promise.then(function(result) {
            if (result.success) {
                handleCloseRelationshipForm();
                refreshUI();
            } else {
                notify(result.message || 'Failed to save relationship.', 'error');
            }
        }).catch(function(err) {
            console.warn('[SocialEvents] save relationship threw:', err);
            notify('An error occurred while saving.', 'error');
        });
    }

    function handleCloseRelationshipForm() {
        var modal = document.getElementById('relationship-form-modal');
        hideModal(modal);
        _editId = null;
        _populatingRelationshipForm = false;
    }

    // ============================================================
    // DELETE / EDIT ROW BINDINGS
    // ============================================================

    function bindDeleteRelationship() {
        delegate('.delete-relationship', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) { handleDeleteRelationship(id); }
        });
    }

    function handleDeleteRelationship(id) {
        if (!id) { return; }

        var rel = SocialQueries.getRelationshipById(id);
        if (!rel) {
            notify('Relationship not found.', 'error');
            return;
        }

        var vm = SocialAggregator.getRelationshipViewModel(rel);
        var name1 = vm ? vm.name1 : 'Unknown';
        var name2 = vm ? vm.name2 : 'Unknown';
        var label = SocialQueries.getRelationshipTypeLabel(rel.typeId);

        if (!confirm('Delete the ' + label + ' relationship between ' + name1 + ' and ' + name2 + '?')) {
            return;
        }

        SocialCore.deleteRelationship(id).then(function(result) {
            if (result.success) {
                refreshUI();
                notify('Relationship deleted successfully!', 'success');
            } else {
                notify(result.message || 'Failed to delete relationship.', 'error');
            }
        }).catch(function(err) {
            console.warn('[SocialEvents] delete relationship threw:', err);
            notify('An error occurred while deleting.', 'error');
        });
    }

    function bindEditRelationship() {
        delegate('.edit-relationship', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();
            var id = target.dataset.id;
            if (id) { handleEditRelationship(id); }
        });
    }

    function handleEditRelationship(id) {
        if (!id) { return; }

        var rel = SocialQueries.getRelationshipById(id);
        if (!rel) {
            notify('Relationship not found.', 'error');
            return;
        }

        handleAddRelationship(id);
    }

    // ============================================================
    // GROUP COLLAPSE
    // ============================================================

    function bindGroupToggle() {
        delegate('.relationship-group-header', 'click', function(e, target) {
            var group = target.closest('.relationship-group');
            if (!group) { return; }

            var body = group.querySelector('.relationship-group-body');
            var caret = group.querySelector('.relationship-group-caret');
            if (!body) { return; }

            var isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            if (caret) { caret.textContent = isHidden ? '\u25be' : '\u25b8'; }
        });
    }

    // ============================================================
    // VIEW MODE
    // ============================================================

    function bindViewModeButtons() {
        var graphBtn = document.getElementById('view-graph-btn');
        if (graphBtn) {
            addEventListener(graphBtn, 'click', function() {
                handleViewModeChange('graph');
            });
        }
        var listBtn = document.getElementById('view-list-btn');
        if (listBtn) {
            addEventListener(listBtn, 'click', function() {
                handleViewModeChange('list');
            });
        }
    }

    /**
     * Switch between list and graph views.
     */
    function handleViewModeChange(mode) {
        if (mode === 'graph') {
            SocialGraph.setGraphVisible(true);
            SocialGraph.renderGraph();
            renderGraphBreadcrumb();
        } else {
            SocialGraph.setGraphVisible(false);
            SocialViews.renderRelationships();
        }
    }

    // ============================================================
    // FILTERS
    // ============================================================

    function bindFilters() {
        var charFilter = document.getElementById('social-character-filter');
        if (charFilter) {
            addEventListener(charFilter, 'change', function() {
                SocialViews.renderRelationships();
                if (SocialGraph.isGraphVisible()) {
                    SocialGraph.renderGraph();
                }
            });
        }

        var typeFilter = document.getElementById('social-type-filter');
        if (typeFilter) {
            addEventListener(typeFilter, 'change', function() {
                SocialViews.renderRelationships();
                if (SocialGraph.isGraphVisible()) {
                    SocialGraph.renderGraph();
                }
            });
        }

        var clearBtn = document.getElementById('clear-social-filters');
        if (clearBtn) {
            addEventListener(clearBtn, 'click', function() {
                var charFilterEl = document.getElementById('social-character-filter');
                var typeFilterEl = document.getElementById('social-type-filter');
                if (charFilterEl) { charFilterEl.value = 'all'; }
                if (typeFilterEl) { typeFilterEl.value = 'all'; }
                SocialViews.renderRelationships();
                if (SocialGraph.isGraphVisible()) {
                    SocialGraph.renderGraph();
                }
            });
        }
    }

    // ============================================================
    // ZOOM CONTROLS
    // ============================================================

    function bindZoomControls() {
        var zoomInBtn = document.getElementById('zoom-in-btn');
        if (zoomInBtn) {
            addEventListener(zoomInBtn, 'click', function() {
                SocialGraph.zoomIn();
            });
        }
        var zoomOutBtn = document.getElementById('zoom-out-btn');
        if (zoomOutBtn) {
            addEventListener(zoomOutBtn, 'click', function() {
                SocialGraph.zoomOut();
            });
        }
        var resetZoomBtn = document.getElementById('reset-zoom-btn');
        if (resetZoomBtn) {
            addEventListener(resetZoomBtn, 'click', function() {
                SocialGraph.resetZoom();
            });
        }
    }

    // ============================================================
    // GRAPH DRILL-DOWN
    // ============================================================

    function bindGraphDrilldown() {
        delegate('.social-graph-node', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();

            var nodeId = target.dataset ? target.dataset.nodeId : null;
            var isCenter = target.dataset && target.dataset.isCenter === 'true';

            if (!nodeId) { return; }

            if (isCenter) {
                SocialGraph.popFocus();
            } else {
                SocialGraph.pushFocus(nodeId);
            }

            renderGraphBreadcrumb();
        });

        var backBtn = document.getElementById('graph-back-btn');
        if (backBtn) {
            addEventListener(backBtn, 'click', function(e) {
                e.preventDefault();
                SocialGraph.popFocus();
                renderGraphBreadcrumb();
            });
        }

        delegate('.social-graph-breadcrumb-jump', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();

            var charId = target.dataset ? target.dataset.charId : null;
            if (!charId) { return; }

            jumpFocusTo(charId);
            renderGraphBreadcrumb();
        });
    }

    /**
     * Truncate the graph's focus stack so that charId is the top.
     */
    function jumpFocusTo(charId) {
        var target = String(charId);
        var path = SocialGraph.getFocusPath();

        var lastIndex = -1;
        for (var i = 0; i < path.length; i++) {
            if (String(path[i]) === target) {
                lastIndex = i;
            }
        }

        if (lastIndex === -1) {
            SocialGraph.setFocus(target);
            return;
        }

        var truncated = path.slice(0, lastIndex + 1);
        SocialGraph.resetFocus();
        for (var j = 0; j < truncated.length; j++) {
            SocialGraph.pushFocus(truncated[j]);
        }
    }

    /**
     * Render the focus breadcrumb above the graph.
     */
    function renderGraphBreadcrumb() {
        var container = document.getElementById('social-graph-breadcrumb');
        var backBtn = document.getElementById('graph-back-btn');
        if (!container) { return; }

        var path = SocialGraph.getFocusPath();

        if (backBtn) {
            backBtn.style.display = path.length > 1 ? 'inline-block' : 'none';
        }

        container.textContent = '';

        if (path.length === 0) {
            return;
        }

        var CharacterQueries = window.CharacterQueries;

        for (var i = 0; i < path.length; i++) {
            if (i > 0) {
                var sep = document.createElement('span');
                sep.textContent = '\u203a';
                sep.style.color = 'var(--text-dim)';
                sep.style.fontSize = '0.75rem';
                container.appendChild(sep);
            }

            var id = String(path[i]);
            var name = 'Unknown';
            if (CharacterQueries &&
                typeof CharacterQueries.getCharacterById === 'function') {
                var c = CharacterQueries.getCharacterById(id);
                if (c) {
                    name = CharacterQueries.getDisplayName(c) || 'Unknown';
                }
            }

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'social-graph-breadcrumb-jump';
            btn.dataset.charId = id;
            btn.textContent = name;
            btn.style.cssText =
                'background:none;border:none;color:var(--accent);' +
                'cursor:pointer;padding:0;font-size:0.75rem;' +
                'text-decoration:underline;';

            if (i === path.length - 1) {
                btn.disabled = true;
                btn.style.color = 'var(--text)';
                btn.style.textDecoration = 'none';
                btn.style.cursor = 'default';
            }

            container.appendChild(btn);
        }
    }

    // ============================================================
    // CHARACTER DETAIL
    // ============================================================

    function bindCharacterDetail() {
        var closeBtn = document.getElementById('close-char-detail');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                handleCharacterDetailClose();
            });
        }

        var modal = document.getElementById('character-detail-modal');
        if (modal) {
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    handleCharacterDetailClose();
                }
            });
        }

        delegate('#view-char-relationships', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) { handleViewCharacterRelationships(id); }
        });
    }

    /**
     * Open the character-detail modal for a specific character.
     *
     * Public method. Any caller (a graph double-click, a relationship
     * row's character name, etc.) can invoke it. The graph module
     * itself does NOT call it.
     */
    function handleGraphNodeClick(charId) {
        if (!charId) { return; }

        var vm = SocialAggregator.getConnectedCharactersViewModel(charId);
        if (!vm || !vm.characterName) {
            notify('Character not found.', 'error');
            return;
        }

        var modal = document.getElementById('character-detail-modal');
        if (!modal) { return; }

        var content = document.getElementById('char-detail-content');
        if (!content) { return; }

        SocialViews.renderCharacterDetailContent(charId, content);
        Modal.showModal(modal);
    }

    function handleCharacterDetailClose() {
        var modal = document.getElementById('character-detail-modal');
        hideModal(modal);
    }

    function handleViewCharacterRelationships(charId) {
        if (!charId) { return; }

        handleCharacterDetailClose();

        handleViewModeChange('list');

        var filter = document.getElementById('social-character-filter');
        if (filter) {
            filter.value = charId;
            SocialViews.renderRelationships();
        }
    }

    // ============================================================
    // SUGGEST PAIRS
    // ============================================================

    function bindSuggestPairs() {
        var openBtn = document.getElementById('suggest-pairs-btn');
        if (openBtn) {
            addEventListener(openBtn, 'click', function() {
                handleOpenSuggestPairs();
            });
        }

        var modal = document.getElementById('suggest-pairs-modal');
        if (modal) {
            var closeBtn = document.getElementById('close-suggest-pairs');
            if (closeBtn) {
                addEventListener(closeBtn, 'click', function() {
                    hideModal(modal);
                });
            }
            addEventListener(modal, 'click', function(e) {
                if (e.target === modal) {
                    hideModal(modal);
                }
            });
        }

        var yearInput = document.getElementById('suggest-pairs-year');
        if (yearInput) {
            addEventListener(yearInput, 'input', function() {
                renderSuggestionsFromControls();
            });
        }

        var modeSelect = document.getElementById('suggest-pairs-mode');
        if (modeSelect) {
            addEventListener(modeSelect, 'change', function() {
                handleSuggestModeChange();
                renderSuggestionsFromControls();
            });
        }

        var seedSelect = document.getElementById('suggest-pairs-seed');
        if (seedSelect) {
            addEventListener(seedSelect, 'change', function() {
                renderSuggestionsFromControls();
            });
        }

        var includeCb = document.getElementById('suggest-pairs-include-eliminated');
        if (includeCb) {
            addEventListener(includeCb, 'change', function() {
                populateSuggestPairsSeedList();
                renderSuggestionsFromControls();
            });
        }

        delegate('.pair-suggest-btn', 'click', function(e, target) {
            e.preventDefault();
            var char1 = target.dataset.char1;
            var char2 = target.dataset.char2;
            if (char1 && char2) {
                handlePairSuggestion(char1, char2);
            }
        });
    }

    function handleOpenSuggestPairs() {
        var modal = document.getElementById('suggest-pairs-modal');
        if (!modal) {
            notify('Suggest Pairs modal is not available.', 'error');
            return;
        }

        var yearInput = document.getElementById('suggest-pairs-year');
        var currentYear = (window.data && typeof window.data.currentYear === 'number')
            ? window.data.currentYear
            : new Date().getFullYear();

        if (yearInput && (!yearInput.value || yearInput.value === '')) {
            yearInput.value = String(currentYear);
        }

        var includeCb = document.getElementById('suggest-pairs-include-eliminated');
        if (includeCb) { includeCb.checked = false; }

        populateSuggestPairsSeedList();
        handleSuggestModeChange();
        renderSuggestionsFromControls();
        Modal.showModal(modal);
    }

    function populateSuggestPairsSeedList() {
        var seedSelect = document.getElementById('suggest-pairs-seed');
        if (!seedSelect) { return; }

        var CharacterQueries = window.CharacterQueries;
        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacters !== 'function') {
            seedSelect.innerHTML = '<option value="">Select character...</option>';
            return;
        }

        var includeEliminated = false;
        var cb = document.getElementById('suggest-pairs-include-eliminated');
        if (cb && cb.checked === true) {
            includeEliminated = true;
        }

        var previous = String(seedSelect.value || '');

        seedSelect.innerHTML = '<option value="">Select character...</option>';

        var all = CharacterQueries.getCharacters() || [];
        var filtered = [];

        for (var i = 0; i < all.length; i++) {
            var c = all[i];
            if (!c || !c.id) { continue; }
            if (!includeEliminated) {
                if (SocialViews.hasAnyElimination &&
                    SocialViews.hasAnyElimination(c.id)) {
                    continue;
                }
            }
            filtered.push(c);
        }

        var sorted = filtered.slice().sort(function(a, b) {
            var na = CharacterQueries.getDisplayName(a) || '';
            var nb = CharacterQueries.getDisplayName(b) || '';
            return na.localeCompare(nb);
        });

        for (var j = 0; j < sorted.length; j++) {
            var c2 = sorted[j];
            var opt = document.createElement('option');
            opt.value = c2.id;
            opt.textContent = CharacterQueries.getDisplayName(c2) || 'Unknown';
            seedSelect.appendChild(opt);
        }

        if (previous) { seedSelect.value = previous; }
    }

    function handleSuggestModeChange() {
        var modeSelect = document.getElementById('suggest-pairs-mode');
        var seedGroup = document.getElementById('suggest-pairs-seed-group');
        if (!modeSelect || !seedGroup) { return; }
        seedGroup.style.display = modeSelect.value === 'seed' ? 'block' : 'none';
    }

    function renderSuggestionsFromControls() {
        var yearInput = document.getElementById('suggest-pairs-year');
        var modeSelect = document.getElementById('suggest-pairs-mode');
        var seedSelect = document.getElementById('suggest-pairs-seed');
        var includeCb = document.getElementById('suggest-pairs-include-eliminated');
        var results = document.getElementById('suggest-pairs-results');

        if (!results) { return; }

        var options = {
            year: yearInput ? yearInput.value : '',
            mode: modeSelect ? modeSelect.value : 'top',
            seedCharId: seedSelect ? seedSelect.value : '',
            includeEliminated: includeCb ? includeCb.checked === true : false
        };

        if (options.mode === 'seed' && !options.seedCharId) {
            results.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Select a character to see suggestions.</p>';
            return;
        }

        SocialViews.renderSuggestPairsContent(results, options);
    }

    function handlePairSuggestion(char1, char2) {
        var suggestModal = document.getElementById('suggest-pairs-modal');
        hideModal(suggestModal);

        handleAddRelationship();

        var c1 = document.getElementById('rel-char1');
        var c2 = document.getElementById('rel-char2');
        if (c1) { c1.value = char1; }
        if (c2) { c2.value = char2; }

        SocialViews.refreshClarificationLabels();
        SocialViews.refreshRelationshipAgePreview();
    }

    // ============================================================
    // CREATE CHILD
    // ============================================================

    function bindCreateChild() {
        var modal = document.getElementById('create-child-modal');
        if (!modal) { return; }

        var closeBtn = document.getElementById('close-create-child');
        if (closeBtn) {
            addEventListener(closeBtn, 'click', function() {
                hideModal(modal);
            });
        }
        var cancelBtn = document.getElementById('cancel-create-child');
        if (cancelBtn) {
            addEventListener(cancelBtn, 'click', function() {
                hideModal(modal);
            });
        }
        addEventListener(modal, 'click', function(e) {
            if (e.target === modal) {
                hideModal(modal);
            }
        });

        ['child-birth-year', 'child-sex', 'child-first-name', 'child-last-name'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                addEventListener(el, 'input', function() {
                    SocialViews.refreshChildPreview(modal);
                });
                addEventListener(el, 'change', function() {
                    SocialViews.refreshChildPreview(modal);
                });
            }
        });

        var confirmBtn = document.getElementById('confirm-create-child');
        if (confirmBtn) {
            addEventListener(confirmBtn, 'click', function() {
                handleConfirmCreateChild();
            });
        }

        delegate('.create-child-btn', 'click', function(e, target) {
            e.preventDefault();
            e.stopPropagation();
            var aId = target.dataset.char1;
            var bId = target.dataset.char2;
            if (aId && bId) {
                handleOpenCreateChild(aId, bId);
            }
        });
    }

    function handleOpenCreateChild(parentAId, parentBId) {
        var modal = document.getElementById('create-child-modal');
        if (!modal) {
            notify('Create Child modal is not available.', 'error');
            return;
        }

        SocialViews.renderChildModalContent(modal, parentAId, parentBId);
        Modal.showModal(modal);
    }

    function handleConfirmCreateChild() {
        var modal = document.getElementById('create-child-modal');
        if (!modal) { return; }

        var aId = modal.dataset.parentAId;
        var bId = modal.dataset.parentBId;
        if (!aId || !bId) {
            notify('Parent IDs missing.', 'error');
            return;
        }

        var yearInput = modal.querySelector('#child-birth-year');
        var sexSelect = modal.querySelector('#child-sex');
        var firstInput = modal.querySelector('#child-first-name');
        var lastInput = modal.querySelector('#child-last-name');

        var options = {
            birthYear: yearInput ? yearInput.value : '',
            gender: sexSelect ? sexSelect.value : '',
            firstName: firstInput ? firstInput.value : '',
            lastName: lastInput ? lastInput.value : ''
        };

        if (!options.birthYear) {
            notify('Birth year is required.', 'error');
            return;
        }

        if (!window.CharacterCRUD ||
            typeof window.CharacterCRUD.createChild !== 'function') {
            notify('CharacterCRUD.createChild is not available.', 'error');
            return;
        }

        window.CharacterCRUD.createChild(aId, bId, options)
            .then(function(result) {
                if (result && result.success) {
                    hideModal(modal);
                    refreshUI();
                    notify('Child created successfully!', 'success');
                } else {
                    notify((result && result.message) || 'Failed to create child.', 'error');
                }
            })
            .catch(function(err) {
                console.warn('[SocialEvents] createChild threw:', err);
                notify('Failed to create child: ' + err.message, 'error');
            });
    }

    // ============================================================
    // UI REFRESH
    // ============================================================

    function refreshUI() {
        SocialViews.renderRelationships();
        if (SocialGraph.isGraphVisible()) {
            SocialGraph.renderGraph();
            renderGraphBreadcrumb();
        }
        SocialGraph.updateLegend();
    }

    // ============================================================
    // RESIZE
    // ============================================================

    function bindResize() {
        var timeoutId = null;
        var debouncedHandler = function() {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            timeoutId = setTimeout(function() {
                if (SocialGraph.isGraphVisible()) {
                    SocialGraph.handleResize();
                }
            }, 200);
        };
        addEventListener(window, 'resize', debouncedHandler);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialEvents = {
        init: init,
        destroy: destroy,

        // Public: opens the shared relationship modal. The
        // character tab's Social section calls this directly.
        // ensureRelationshipModalShell guarantees the shell exists
        // before opening, so callers do not need to render the
        // standalone tab first.
        handleAddRelationship: handleAddRelationship,
        handleSaveRelationship: handleSaveRelationship,
        handleDeleteRelationship: handleDeleteRelationship,
        handleEditRelationship: handleEditRelationship,
        handleViewModeChange: handleViewModeChange,
        handleGraphNodeClick: handleGraphNodeClick,
        handleCharacterDetailClose: handleCharacterDetailClose,

        handleOpenSuggestPairs: handleOpenSuggestPairs,
        handlePairSuggestion: handlePairSuggestion,
        handleOpenCreateChild: handleOpenCreateChild,
        handleConfirmCreateChild: handleConfirmCreateChild,

        refreshUI: refreshUI,

        // Graph drill-down helpers
        renderGraphBreadcrumb: renderGraphBreadcrumb,
        jumpFocusTo: jumpFocusTo,

        // Swap button (exposed for testing)
        handleSwapCharacters: handleSwapCharacters,
        updateSwapButtonVisibility: updateSwapButtonVisibility,

        // Shell installer, exposed so a caller can force-install the
        // modal without opening it (rare, used by tests)
        ensureRelationshipModalShell: ensureRelationshipModalShell
    };

    // ============================================================
    // AUTO-INIT
    // ============================================================

    function autoInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            var container = document.getElementById('tab-social');
            if (container) { init(container); }
        } else {
            document.addEventListener('DOMContentLoaded', function() {
                var container = document.getElementById('tab-social');
                if (container) { init(container); }
            });
        }
    }

    autoInit();

})();
