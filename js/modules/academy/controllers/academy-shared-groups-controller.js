/**
 * modules/academy/controllers/academy-shared-groups-controller.js
 * Academy Shared Groups Controller
 *
 * Path: js/modules/academy/controllers/academy-shared-groups-controller.js
 *
 * Controller for the Shared Groups view and for the launcher
 * button on the character detail Schedule tab.
 *
 * RESPONSIBILITIES:
 *   - Own the picker state (selection, filter, class filter).
 *   - Build the character list — class-scoped when a class is
 *     selected, full character list otherwise.
 *   - Build the result via AcademyAggregator.getSharedGroupsViewModel.
 *   - Render via AcademySharedGroupsView.renderHTML.
 *   - Route the view's data-* events back to state changes.
 *   - Provide openForCharacter(charId, options) so the character
 *     detail Schedule tab can jump to the Shared Groups view
 *     pre-seeded with that character.
 *
 * CLASS SCOPING:
 *   When a class is selected, the picker list is built from that
 *   class's roster:
 *     - every student in the class (from
 *       AcademyAggregator.getClassStudentsViewModel)
 *     - every instructor of the class, all-time (from
 *       AcademyClasses.getClassInstructorIdsAllTime)
 *   The two are unioned and deduplicated.
 *
 *   When "All classes" is selected, the picker list is every
 *   character in the database (from CharacterQueries.getCharacters).
 *
 *   Changing the class filter prunes the current selection: any
 *   selected character who is not in the new class's roster is
 *   dropped. The user is not left with a selection they cannot
 *   see.
 *
 * CLIENT-SIDE SEARCH:
 *   Typing in the search box does NOT re-render the picker. The
 *   controller toggles row visibility on the existing DOM. Focus
 *   and caret position in the search input survive; the picker
 *   scroll position survives; the character list is not rebuilt.
 *
 *   See AcademySharedGroupsView's PICKER FILTER note. The view
 *   renders every row with a data-search-key attribute; this
 *   controller's applyPickerFilterInPlace() shows and hides them.
 *
 * STATE:
 *   Per-view. Reset on unmount. openForCharacter seeds the state
 *   and switches the shell view, which triggers a shell-level
 *   mount that calls render() with the seeded state.
 *
 * ANCHOR CHARACTER:
 *   When opened from a character's Schedule tab, the launched
 *   character is placed into selectedCharIds (if not already
 *   there) and recorded as anchorCharId. The anchor is purely
 *   informational; the renderer does not distinguish it.
 *
 * CONTEXT:
 *   The shell passes { onChange } to render(host, context). This
 *   controller does NOT call onChange for local state changes —
 *   the local re-render is enough. onChange is captured for
 *   callers that later need it.
 *
 * EVENTS (from the view's data-* markers):
 *   - .academy-shared-groups-class-select   (change)
 *   - .academy-shared-groups-search         (input)
 *   - .academy-shared-groups-char-checkbox  (change)
 *   - [data-action="shared-groups-clear-selection"]     (click)
 *   - [data-action="shared-groups-remove-character"]    (click)
 *
 * RE-RENDER:
 *   State changes that affect the result (character checkbox
 *   toggle, clear-selection, remove-character chip, class
 *   filter) re-render the controller's own host. Class filter
 *   changes also prune the selection first.
 *
 *   The search input does NOT re-render; it only applies the
 *   filter in place.
 *
 * DEPENDENCIES:
 *   - window.AcademyAggregator
 *   - window.AcademySharedGroupsView
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyUI
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
    var AcademyClasses = window.AcademyClasses;
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
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
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
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClassInstructorIdsAllTime !== 'function') {
        _missing.push('AcademyClasses.getClassInstructorIdsAllTime');
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

    function sortByNameThenId(list) {
        list.sort(function(a, b) {
            if (a.name !== b.name) {
                return a.name.localeCompare(b.name);
            }
            return a.id.localeCompare(b.id);
        });
    }

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // Per-view state. Reset on unmount. See the STATE note in the
    // file header.

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
    // CLASS-SCOPED PICKER LIST
    // ============================================================
    //
    // See the CLASS SCOPING note in the file header.

    function buildCharacterList() {
        if (isNonEmptyString(_selectedClassId)) {
            return buildClassScopedCharacterList(_selectedClassId);
        }
        return buildAllCharacterList();
    }

    function buildAllCharacterList() {
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

        sortByNameThenId(result);
        return result;
    }

    function buildClassScopedCharacterList(classId) {
        var targetClass = String(classId);
        var byId = Object.create(null);

        // ---- Students in the class ----
        var students = [];
        try {
            students = AcademyAggregator.getClassStudentsViewModel(
                targetClass
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademySharedGroupsController] ' +
                'getClassStudentsViewModel threw:', e
            );
            students = [];
        }
        if (Array.isArray(students)) {
            for (var i = 0; i < students.length; i++) {
                var s = students[i];
                if (!s || !s.id) { continue; }
                byId[String(s.id)] = true;
            }
        }

        // ---- Instructors of this class (all-time) ----
        var instructorIds = [];
        try {
            instructorIds =
                AcademyClasses.getClassInstructorIdsAllTime(
                    targetClass
                ) || [];
        } catch (e) {
            console.warn(
                '[AcademySharedGroupsController] ' +
                'getClassInstructorIdsAllTime threw:', e
            );
            instructorIds = [];
        }
        if (Array.isArray(instructorIds)) {
            for (var j = 0; j < instructorIds.length; j++) {
                if (!isNonEmptyString(instructorIds[j])) { continue; }
                byId[String(instructorIds[j])] = true;
            }
        }

        // ---- Resolve names for everyone in the class ----
        var result = [];
        var keys = Object.keys(byId);
        for (var k = 0; k < keys.length; k++) {
            var cid = keys[k];
            var char = null;
            try {
                char = CharacterQueries.getCharacterById(cid);
            } catch (e) {
                char = null;
            }
            if (!char) { continue; }

            var name = '';
            try {
                name = CharacterQueries.getDisplayName(char) || '';
            } catch (e) {
                name = '';
            }
            if (name === '') { name = 'Unknown'; }

            result.push({
                id: cid,
                name: name
            });
        }

        sortByNameThenId(result);
        return result;
    }

    // ============================================================
    // SELECTION PRUNING
    // ============================================================
    //
    // Called after _selectedClassId changes. Drops any selected
    // character who is no longer in the current class's roster.

    function pruneSelectionToCurrentPicker() {
        if (!isNonEmptyString(_selectedClassId)) {
            // All-classes mode: nothing to prune against.
            return;
        }

        var picker = buildClassScopedCharacterList(_selectedClassId);
        var allowed = Object.create(null);
        for (var i = 0; i < picker.length; i++) {
            allowed[picker[i].id] = true;
        }

        var next = [];
        for (var j = 0; j < _selectedCharIds.length; j++) {
            var id = String(_selectedCharIds[j]);
            if (allowed[id]) {
                next.push(id);
            }
        }
        _selectedCharIds = next;

        if (_anchorCharId !== null && !allowed[_anchorCharId]) {
            _anchorCharId = null;
        }
    }

    // ============================================================
    // CLASS LIST
    // ============================================================

    function buildClassList() {
        try {
            var classes =
                AcademyAggregator.getClassListViewModel() || [];
            return Array.isArray(classes) ? classes : [];
        } catch (e) {
            console.warn(
                '[AcademySharedGroupsController] ' +
                'getClassListViewModel threw:', e
            );
            return [];
        }
    }

    // ============================================================
    // RESULT
    // ============================================================

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

        applyPickerFilterInPlace();
    }

    /**
     * Re-render the controller's own host without going through
     * the shell. Used on state changes that affect the result
     * (checkbox toggle, chip removal, clear selection, class
     * filter change). NOT used for the search box.
     */
    function rerender() {
        if (!_host) { return; }
        var vm = buildViewModel();
        _host.innerHTML = AcademySharedGroupsView.renderHTML(vm);
        applyPickerFilterInPlace();
    }

    // ============================================================
    // CLIENT-SIDE PICKER FILTER
    // ============================================================
    //
    // Shows and hides the picker rows in place, based on the
    // current filter term. See the CLIENT-SIDE SEARCH note in the
    // file header.
    //
    // A selected row is ALWAYS visible even when the search term
    // excludes it, so the user cannot accidentally lose sight of
    // a character they are actively working with.

    function applyPickerFilterInPlace() {
        if (!_host) { return; }

        var term = _filter.toLowerCase().trim();

        var rows = _host.querySelectorAll(
            '.academy-shared-groups-char-row'
        );
        var anyVisible = false;

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var key = row.dataset
                ? (row.dataset.searchKey || '')
                : '';
            var isRowSelected = row.classList.contains('is-selected');
            var matches = term === '' ||
                          key.indexOf(term) !== -1 ||
                          isRowSelected;

            if (matches) {
                row.style.display = '';
                anyVisible = true;
            } else {
                row.style.display = 'none';
            }
        }

        // Toggle the "no matches" element.
        var noMatch = _host.querySelector(
            '.academy-shared-groups-no-matches'
        );
        if (noMatch) {
            if (!anyVisible && rows.length > 0) {
                noMatch.style.display = '';
            } else {
                noMatch.style.display = 'none';
            }
        }
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
            pruneSelectionToCurrentPicker();
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
            applyPickerFilterInPlace();
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
    // Seeds the selection, switches the shell's active view, and
    // returns whether the switch succeeded. The caller (the People
    // controller) is responsible for triggering the shell's
    // re-render after a successful switch.
    //
    // If the character is not found, this is a no-op that returns
    // false. The caller decides whether to notify the user.

    function openForCharacter(charId, options) {
        if (!isNonEmptyString(charId)) { return false; }

        var char = null;
        try {
            char = CharacterQueries.getCharacterById(charId);
        } catch (e) {
            char = null;
        }
        if (!char) { return false; }

        // Reset the per-view state so opening from a character's
        // schedule does not inherit a previous multi-character
        // selection.
        _selectedCharIds = [];
        _filter = '';
        _anchorCharId = null;

        // The class filter defaults to the class the AcademyUI has
        // selected, when one is selected. This narrows the picker
        // and the search to what the user was just looking at.
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
