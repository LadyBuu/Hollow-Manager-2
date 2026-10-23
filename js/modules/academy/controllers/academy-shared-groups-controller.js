/**
 * modules/academy/controllers/academy-shared-groups-controller.js
 * Academy Shared Groups Controller
 *
 * Path: js/modules/academy/academy-shared-groups-controller.js
 *
 * Controller for the Shared Groups view and for the launcher
 * button on the character detail Schedule tab.
 *
 * RESPONSIBILITIES:
 *   - Own the picker state (selection, filter, class filter).
 *   - Read the character list and class list, once per render.
 *   - Call AcademyAggregator.getSharedGroupsViewModel to build
 *     the result.
 *   - Render via AcademySharedGroupsView.renderHTML.
 *   - Route the view's data-* events back to state changes.
 *   - Provide openForCharacter(charId, options) so the character
 *     detail Schedule tab can jump to the Shared Groups view
 *     pre-seeded with that character.
 *
 * STATE:
 *   The controller's state is per-view: it is reset when the
 *   view is unmounted. It is NOT persisted in AcademyUI. The
 *   selection is not a cross-view concept.
 *
 *   When the shell routes the user away from Shared Groups and
 *   back, the previous selection is gone. That is deliberate: a
 *   stale multi-character selection that happens to include a
 *   character who was just deleted or reassigned would be
 *   confusing to return to.
 *
 *   openForCharacter seeds the state and switches the shell to
 *   this view. Because the state lives here (not in AcademyUI),
 *   the seeding must happen in the same call before the shell
 *   renders.
 *
 * ANCHOR CHARACTER:
 *   When the view is opened from a character's Schedule tab,
 *   the launched character is placed into `selectedCharIds`
 *   (if not already there) and recorded as `anchorCharId`. The
 *   anchor is purely informational in the view layer: the
 *   renderer does not distinguish it. It exists so a future
 *   iteration can highlight the anchor's row or its chip
 *   without re-plumbing state.
 *
 *   The anchor is cleared when the user removes that character
 *   from the selection.
 *
 * CONTEXT:
 *   The shell passes a context object to render(host, context):
 *     {
 *       onChange: function()   // shell-provided refresh hook
 *     }
 *
 *   This controller does NOT use onChange — the view's state
 *   changes are local and re-render the controller's own host
 *   without round-tripping through the shell's refresh path.
 *   Calling onChange would replace the shell's innerHTML and
 *   lose the picker's scroll position, which is worse than the
 *   local re-render.
 *
 *   The context is captured anyway so a future iteration that
 *   does need onChange can use it without a signature change.
 *
 * EVENTS (from the view's data-* markers):
 *   - .academy-shared-groups-class-select   (change)
 *   - .academy-shared-groups-search         (input)
 *   - .academy-shared-groups-char-checkbox  (change)
 *   - [data-action="shared-groups-clear-selection"]     (click)
 *   - [data-action="shared-groups-remove-character"]    (click)
 *
 *   Anything else is ignored. The controller does not bubble
 *   unknown actions to the shell; the shell's dispatcher already
 *   handles cross-view navigation.
 *
 * RE-RENDER:
 *   Every state change triggers a local re-render of the
 *   controller's own host. The shell is not notified. This is
 *   how the picker's scroll position and search cursor survive
 *   a checkbox toggle.
 *
 * DEPENDENCIES:
 *   - window.AcademyAggregator
 *   - window.AcademySharedGroupsView
 *   - window.CharacterQueries
 *   - window.AcademyUI  (for switching views in openForCharacter)
 *   - window.AcademyView (for triggering the shell's re-render
 *                         after a view switch)
 */

(function() {
    'use strict';

    if (window.__academySharedGroupsControllerLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var AcademyAggregator = window.AcademyAggregator;
    var AcademySharedGroupsView = window.AcademySharedGroupsView;
    var CharacterQueries = window.CharacterQueries;
    var AcademyUI = window.AcademyUI;

    var _missing = [];

    if (!AcademyAggregator ||
        typeof AcademyAggregator.getSharedGroupsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getSharedGroupsViewModel');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassListViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassListViewModel');
    }
    if (!AcademySharedGroupsView ||
        typeof AcademySharedGroupsView.renderHTML !== 'function') {
        _missing.push('AcademySharedGroupsView.renderHTML');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!AcademyUI ||
        typeof AcademyUI.setSelectedView !== 'function') {
        _missing.push('AcademyUI.setSelectedView');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademySharedGroupsController] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academySharedGroupsControllerLoaded = true;

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // Per-view state. Reset on unmount. See the header for the
    // rationale.

    var _host = null;
    var _context = null;

    var _selectedCharIds = [];
    var _filter = '';
    var _selectedClassId = '';

    // The anchor character (when opened from a Schedule tab).
    // Informational; the renderer does not consume it today.
    var _anchorCharId = null;

    // ============================================================
    // STATE HELPERS
    // ============================================================

    function isSelected(charId) {
        var target = String(charId);
        for (var i = 0; i < _selectedCharIds.length; i++) {
            if (String(_selectedCharIds[i]) === target) {
                return true;
            }
        }
        return false;
    }

    function addToSelection(charId) {
        if (!isNonEmptyString(charId)) { return; }
        var target = String(charId);
        if (isSelected(target)) { return; }
        _selectedCharIds.push(target);
    }

    function removeFromSelection(charId) {
        if (!isNonEmptyString(charId)) { return; }
        var target = String(charId);
        var next = [];
        for (var i = 0; i < _selectedCharIds.length; i++) {
            if (String(_selectedCharIds[i]) !== target) {
                next.push(_selectedCharIds[i]);
            }
        }
        _selectedCharIds = next;

        // If the removed character was the anchor, clear the anchor.
        // The anchor exists to identify "the character this view was
        // opened for"; once removed, it no longer identifies
        // anything.
        if (_anchorCharId !== null &&
            String(_anchorCharId) === target) {
            _anchorCharId = null;
        }
    }

    function clearSelection() {
        _selectedCharIds = [];
        _anchorCharId = null;
    }

    // ============================================================
    // CHARACTER LIST
    // ============================================================
    //
    // Read fresh on every render. The list is authoritative from
    // CharacterQueries; the controller does not cache. A character
    // created or deleted while this view is open picks up on the
    // next render, which is the correct behavior for a picker.
    //
    // The list is sorted by display name; the picker's renderer
    // preserves that order and does not re-sort.

    function buildCharacterList() {
        var characters = [];
        try {
            characters = CharacterQueries.getCharacters() || [];
        } catch (e) {
            console.warn(
                '[AcademySharedGroupsController] getCharacters threw:',
                e
            );
            return [];
        }

        if (!Array.isArray(characters)) { return []; }

        var result = [];
        for (var i = 0; i < characters.length; i++) {
            var c = characters[i];
            if (!c || !c.id) { continue; }
            var name = '';
            try {
                name = CharacterQueries.getDisplayName(c) || '';
            } catch (e) {
                name = '';
            }
            if (name === '') { name = 'Unknown'; }
            result.push({
                id: String(c.id),
                name: name
            });
        }

        result.sort(function(a, b) {
            if (a.name !== b.name) {
                return a.name.localeCompare(b.name);
            }
            return a.id.localeCompare(b.id);
        });

        return result;
    }

    // ============================================================
    // CLASS LIST
    // ============================================================

    function buildClassList() {
        try {
            var classes = AcademyAggregator.getClassListViewModel() || [];
            return Array.isArray(classes) ? classes : [];
        } catch (e) {
            console.warn(
                '[AcademySharedGroupsController] getClassListViewModel ' +
                'threw:', e
            );
            return [];
        }
    }

    // ============================================================
    // RESULT
    // ============================================================
    //
    // The aggregator is asked with the current selection and the
    // current class filter. If the user has selected fewer than
    // two characters, the aggregator returns an empty result
    // itself; the controller could skip the call but the
    // aggregator's empty VM carries a resolved `characters[]`
    // array that the view does not need. Skipping the call here
    // avoids the (small) cost of resolving names twice.
    //
    // The controller does not catch the aggregator's throws. A
    // throw here means AcademyTeachingGroups or CharacterQueries
    // is unavailable. Letting the shell's controller-invocation
    // wrapper catch and log it (see AcademyView.mountControllerFor
    // View) is the right failure mode: the rest of the tab keeps
    // working, and the error is visible in the console.

    function buildResult() {
        if (_selectedCharIds.length < 2) {
            return {
                charIds: [],
                characters: [],
                rows: [],
                totalRows: 0
            };
        }

        var options = {};
        if (isNonEmptyString(_selectedClassId)) {
            options.classId = String(_selectedClassId);
        }

        return AcademyAggregator.getSharedGroupsViewModel(
            _selectedCharIds.slice(),
            options
        );
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================

    function buildViewModel() {
        return {
            classes: buildClassList(),
            selectedClassId: _selectedClassId,
            characters: buildCharacterList(),
            selectedCharIds: _selectedCharIds.slice(),
            anchorCharId: _anchorCharId,
            filter: _filter,
            result: buildResult()
        };
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(host, context) {
        if (!host) { return; }

        _host = host;
        _context = context || null;

        var vm = buildViewModel();
        host.innerHTML = AcademySharedGroupsView.renderHTML(vm);
    }

    /**
     * Re-render the controller's own host without going through
     * the shell. Used on every state change so the picker's scroll
     * and search cursor survive a checkbox toggle.
     */
    function rerender() {
        if (!_host) { return; }
        var vm = buildViewModel();
        _host.innerHTML = AcademySharedGroupsView.renderHTML(vm);
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        _host = null;
        _context = null;
        _selectedCharIds = [];
        _filter = '';
        _selectedClassId = '';
        _anchorCharId = null;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;

        if (action === 'shared-groups-clear-selection') {
            e.preventDefault();
            clearSelection();
            rerender();
            return;
        }

        if (action === 'shared-groups-remove-character') {
            e.preventDefault();
            var charId = actionEl.dataset.characterId;
            if (!isNonEmptyString(charId)) { return; }
            removeFromSelection(charId);
            rerender();
            return;
        }
    }

    function handleChange(e) {
        var target = e.target;
        if (!target || !target.classList) { return; }

        if (target.classList.contains(
            'academy-shared-groups-class-select'
        )) {
            _selectedClassId = target.value || '';
            rerender();
            return;
        }

        if (target.classList.contains(
            'academy-shared-groups-char-checkbox'
        )) {
            var charId = target.dataset
                ? target.dataset.characterId
                : null;
            if (!isNonEmptyString(charId)) { return; }

            if (target.checked === true) {
                addToSelection(charId);
            } else {
                removeFromSelection(charId);
            }
            rerender();
            return;
        }
    }

    function handleInput(e) {
        var target = e.target;
        if (!target || !target.classList) { return; }

        if (target.classList.contains(
            'academy-shared-groups-search'
        )) {
            _filter = typeof target.value === 'string'
                ? target.value
                : '';
            // The search filter does not affect the aggregator
            // result (which is derived from the selection and the
            // class filter, not the search term), so no rebuild is
            // needed. A local re-render updates the visible rows.
            rerender();
            return;
        }
    }

    function handleKeydown(e) {
        // No keyboard shortcuts beyond what the browser provides
        // for text inputs and checkboxes. Reserved for future use.
    }

    // ============================================================
    // PUBLIC ENTRY — open from a character's Schedule tab
    // ============================================================
    //
    // The character detail Schedule tab emits a click on a button
    // that the People controller routes here.
    //
    // This function seeds the selection, switches the shell's
    // active view, and asks the shell to re-render. The shell's
    // mount path calls back into this controller's render() with
    // the new host, which picks up the seeded state.
    //
    // If the character is not found, this is a no-op that returns
    // false. The caller can decide whether to notify the user.

    function openForCharacter(charId, options) {
        if (!isNonEmptyString(charId)) { return false; }

        var char = null;
        try {
            char = CharacterQueries.getCharacterById(charId);
        } catch (e) {
            char = null;
        }
        if (!char) { return false; }

        // Reset the per-view state so that opening from a
        // character's schedule does not inherit a previous
        // multi-character selection. The anchor is the only thing
        // we want to carry in.
        _selectedCharIds = [];
        _filter = '';
        _anchorCharId = null;

        // The class filter default is the class the AcademyUI has
        // selected, when one is selected. This narrows the search
        // to what the user was just looking at (the character's
        // schedule is class-scoped by the shell) and matches the
        // user's mental context. When no class is selected, the
        // filter is "all classes".
        options = (options && typeof options === 'object')
            ? options
            : {};
        if (isNonEmptyString(options.classId)) {
            _selectedClassId = String(options.classId);
        } else {
            var selectedClass = null;
            try {
                selectedClass = AcademyUI.getSelectedClassId();
            } catch (e) {
                selectedClass = null;
            }
            _selectedClassId = isNonEmptyString(selectedClass)
                ? String(selectedClass)
                : '';
        }

        addToSelection(charId);
        _anchorCharId = String(charId);

        // Switch the shell to this view. The shell will re-render,
        // mount this controller, and call render() — at which
        // point the seeded state is used.
        //
        // We deliberately do NOT call AcademyView.refreshView()
        // directly from here. The launcher's caller (the People
        // controller, in its handler for the Schedule tab's
        // button) is the layer that decides whether to refresh
        // the shell. Doing it here would make this controller
        // depend on the shell in a way that couples two modules
        // that otherwise do not know about each other.
        //
        // Returning true signals to the caller that the state has
        // been seeded and the shell should switch.
        var switched = false;
        try {
            switched = AcademyUI.setSelectedView('sharedGroups');
        } catch (e) {
            switched = false;
        }
        return switched === true;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademySharedGroupsController = Object.freeze({
        render: render,
        handleClick: handleClick,
        handleChange: handleChange,
        handleInput: handleInput,
        handleKeydown: handleKeydown,
        unmount: unmount,

        // Programmatic entry, used by the Schedule tab launcher.
        openForCharacter: openForCharacter,

        // Exposed for tests. Not part of the contract.
        _getState: function() {
            return {
                selectedCharIds: _selectedCharIds.slice(),
                filter: _filter,
                selectedClassId: _selectedClassId,
                anchorCharId: _anchorCharId
            };
        }
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademySharedGroupsController;
        var missing = [];

        var required = [
            'render',
            'handleClick',
            'handleChange',
            'handleInput',
            'handleKeydown',
            'unmount',
            'openForCharacter'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademySharedGroupsController] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
