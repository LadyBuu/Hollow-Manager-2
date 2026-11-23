/**
 * modules/academy/controllers/academy-ranking-controller.js
 * Academy Ranking Controller
 *
 * Path: js/modules/academy/controllers/academy-ranking-controller.js
 *
 * The Rankings feature controller. Owns the Rankings view: its
 * render, its click/change/keydown handlers, its drag-and-drop
 * reorder flow, and its insert/clear write actions.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Rankings view into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by
 *     the shell for events that occur inside the host.
 *   - Handling dragstart / dragover / dragleave / drop / dragend
 *     routed by the shell. The controller owns the drag state
 *     machine; the shell only forwards raw DOM events.
 *   - Inserting a student into the ranking (insert strip).
 *   - Removing a student from the ranking (per-row clear button).
 *   - Reordering by drag (drag handle).
 *   - Row-click navigation to People, delegated to the shell via
 *     context.onOpenCharacterInPeople.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The week. The shell owns it; the controller reads it from
 *     AcademyUI on each render via context.week, falling back to
 *     AcademyUI.getDisplayWeek() if context does not carry one.
 *   - The class selection. That is SHARED Academy state, owned by
 *     AcademyUI. This controller reads AcademyUI.getSelectedClassId()
 *     on every render and routes class changes through
 *     AcademyUI.selectClass(). It holds no local class field, so a
 *     class chosen in any other Academy view is honoured here, and a
 *     class chosen here is honoured by every other view.
 *   - Re-rendering the shell. When a state change should re-render,
 *     the controller calls context.onChange().
 *   - Ranking reads. AcademyAggregator.getRankingViewModel produces
 *     the VM.
 *   - Ranking writes. AcademyRanking.setRanking /
 *     insertRankingAt / removeRankingAt own them. This controller
 *     is the caller; it does not mutate state directly.
 *   - Cross-view navigation. The controller asks the shell to
 *     navigate; it does not call AcademyUI.setSelectedView itself.
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
 *   context — {
 *               week: number,
 *               onChange: function(),
 *               onOpenCharacterInPeople: function(charId)
 *             }
 *
 * EVENT ROUTING:
 *   handleClick       — row navigation, name button, clear button,
 *                       insert button.
 *   handleChange      — class select, week input, insert student
 *                       select.
 *   handleInput       — reserved (no live text inputs).
 *   handleKeydown     — Enter on the week input.
 *   handleDragStart   — start a row drag; stash the dragged ID.
 *   handleDragOver    — position the drop indicator on the row
 *                       under the pointer; allow the drop.
 *   handleDragLeave   — clear the drop indicator when the pointer
 *                       leaves a row.
 *   handleDrop        — compute the new order and call
 *                       AcademyRanking.setRanking. The pipeline
 *                       mutation is async; the controller refreshes
 *                       on resolve.
 *   handleDragEnd     — clear the drag state and any drop classes.
 *
 * DRAG STATE:
 *   The controller holds three module-level pieces of transient
 *   drag state (not persisted, not shared across views):
 *
 *     _dragCharId      the character being dragged, or null
 *     _dragDropTarget  the row currently showing the drop indicator,
 *                      or null
 *     _dragDropAfter   true if the indicator is below the target
 *                      row, false if above
 *
 *   This state is cleared by handleDrop and handleDragEnd. The
 *   VM's `rankedCharIds` is re-read on every drop from the live
 *   aggregator, so the controller never has to hold a stale
 *   ordered list between refreshes.
 *
 * INSERT:
 *   The insert strip posts:
 *     #academy-ranking-insert-student  selected character ID
 *     #academy-ranking-insert-position optional position (1..N+1);
 *                                       blank means "append"
 *     #academy-ranking-insert-btn      data-class-id, data-week,
 *                                       data-current-rows
 *
 *   The controller calls
 *   AcademyRanking.insertRankingAt(classId, week, charId, position)
 *   and refreshes on resolve.
 *
 * CLEAR:
 *   The per-row clear button carries data-character-id,
 *   data-class-id, data-week. The controller calls
 *   AcademyRanking.removeRankingAt(classId, week, charId) and
 *   refreshes on resolve.
 *
 * FAILURE POLICY:
 *   If AcademyRanking is missing at write time (load order bug),
 *   the write functions throw inside the click/drop handler; the
 *   controller catches, logs, and leaves the UI unchanged. A write
 *   that resolves with { success: false } is logged and the UI is
 *   refreshed anyway (the backend may have partially mutated; the
 *   refresh makes the truth visible).
 *
 * DEPENDENCIES:
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyRankingView
 *   - window.AcademyRanking        (lazy, mandatory at write time)
 */

(function() {
    'use strict';

    if (window.__academyRankingControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var View = window.AcademyRankingView;

    var _missing = [];

    if (!AcademyUI ||
        typeof AcademyUI.getDisplayWeek !== 'function' ||
        typeof AcademyUI.setDisplayWeek !== 'function' ||
        typeof AcademyUI.getSelectedClassId !== 'function' ||
        typeof AcademyUI.selectClass !== 'function') {
        _missing.push('AcademyUI week/class accessors');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getRankingViewModel !== 'function') {
        _missing.push('AcademyAggregator.getRankingViewModel');
    }
    if (!View || typeof View.renderHTML !== 'function') {
        _missing.push('AcademyRankingView.renderHTML');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyRankingController] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyRankingControllerLoaded = true;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    function requireAcademyRanking(contextLabel) {
        var Ranking = getAcademyRanking();
        if (!Ranking) {
            throw new Error(
                '[AcademyRankingController] window.AcademyRanking is ' +
                'required by ' + contextLabel + '. Check the script ' +
                'load order in index.html.'
            );
        }
        return Ranking;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null) { return null; }
        var s = String(value).trim();
        if (s === '') { return null; }
        if (!/^\d+$/.test(s)) { return null; }
        var n = Number(s);
        if (!isFinite(n) || n < 1) { return null; }
        return Math.floor(n);
    }

    function readClassIdFromDataset(el) {
        if (el && el.dataset && isNonEmptyString(el.dataset.classId)) {
            return String(el.dataset.classId);
        }
        return null;
    }

    function readWeekFromDataset(el) {
        if (el && el.dataset && isNonEmptyString(el.dataset.week)) {
            var n = Number(el.dataset.week);
            if (Number.isInteger(n)) { return n; }
        }
        return null;
    }

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // The class selection is NOT held here. It is shared Academy
    // state owned by AcademyUI. This controller reads it on every
    // render and writes it only through AcademyUI.selectClass().
    //
    // Drag state is transient and local to an in-flight drag. It is
    // cleared by handleDrop and handleDragEnd.

    var _host = null;
    var _context = null;

    var _dragCharId = null;
    var _dragDropTarget = null;
    var _dragDropAfter = false;

    // ============================================================
    // CONTEXT NORMALISATION
    // ============================================================

    function normaliseContext(rawContext) {
        var ctx = rawContext && typeof rawContext === 'object'
            ? rawContext
            : {};

        var week = typeof ctx.week === 'number' && isFinite(ctx.week)
            ? ctx.week
            : AcademyUI.getDisplayWeek();

        var onChange = typeof ctx.onChange === 'function'
            ? ctx.onChange
            : function() {};

        var onOpenCharacterInPeople =
            typeof ctx.onOpenCharacterInPeople === 'function'
                ? ctx.onOpenCharacterInPeople
                : function() {};

        return {
            week: week,
            onChange: onChange,
            onOpenCharacterInPeople: onOpenCharacterInPeople
        };
    }

    function getContext() {
        if (_context) { return _context; }
        return normaliseContext(null);
    }

    // ============================================================
    // REFRESH
    // ============================================================
    //
    // All writes funnel through here. A successful mutation asks
    // the shell to re-render (which re-runs this controller's
    // render(), which re-reads the aggregator, which reflects the
    // new state). A failed mutation logs and ALSO refreshes, so
    // the UI shows whatever the pipeline actually committed.

    function refreshAfterWrite(operation, result) {
        if (result && result.success === false) {
            console.warn(
                '[AcademyRankingController] ' + operation +
                ' failed:', result.message || '(no message)'
            );
        }

        var ctx = getContext();
        try {
            ctx.onChange();
        } catch (e) {
            console.warn(
                '[AcademyRankingController] onChange threw after ' +
                operation + ':', e
            );
        }
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

        // A fresh render cancels any in-flight drag state. The
        // dragged row no longer exists in the new DOM.
        _dragCharId = null;
        _dragDropTarget = null;
        _dragDropAfter = false;

        // Class selection is shared Academy state. Read it fresh
        // each render; never cache it locally.
        var selectedClassId = AcademyUI.getSelectedClassId();

        var vm;
        try {
            vm = AcademyAggregator.getRankingViewModel(
                selectedClassId,
                _context.week
            );
        } catch (e) {
            console.warn(
                '[AcademyRankingController] getRankingViewModel threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to load rankings.' +
                    '</p>' +
                '</div>';
            return;
        }

        var html;
        try {
            html = View.renderHTML(vm);
        } catch (e) {
            console.warn(
                '[AcademyRankingController] renderHTML threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to render rankings.' +
                    '</p>' +
                '</div>';
            return;
        }

        host.innerHTML = html;
    }

    // ============================================================
    // CLICK
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        // ---- Clear button (per row) ----
        //
        // The clear button is checked BEFORE the row, so a click
        // on the button does not also trigger row navigation.
        var clearBtn = target.closest('.academy-ranking-clear-btn');
        if (clearBtn) {
            e.preventDefault();
            e.stopPropagation();
            handleClearClick(clearBtn);
            return;
        }

        // ---- Insert button (strip) ----
        var insertBtn = target.closest('#academy-ranking-insert-btn');
        if (insertBtn) {
            e.preventDefault();
            handleInsertClick(insertBtn);
            return;
        }

        // ---- Name button ----
        var nameBtn = target.closest('.academy-ranking-name-btn');
        if (nameBtn && nameBtn.dataset && nameBtn.dataset.characterId) {
            e.preventDefault();
            var ctx = getContext();
            ctx.onOpenCharacterInPeople(nameBtn.dataset.characterId);
            return;
        }

        // ---- Row: navigate to People with character ----
        var row = target.closest('.academy-ranking-row');
        if (row && row.dataset && row.dataset.characterId) {
            e.preventDefault();
            var c = getContext();
            c.onOpenCharacterInPeople(row.dataset.characterId);
            return;
        }
    }

    function handleClearClick(clearBtn) {
        var charId = clearBtn.dataset ? clearBtn.dataset.characterId : null;
        var classId = readClassIdFromDataset(clearBtn);
        var week = readWeekFromDataset(clearBtn);

        if (!isNonEmptyString(charId) || !isNonEmptyString(classId) ||
            week === null) {
            console.warn(
                '[AcademyRankingController] clear clicked with ' +
                'incomplete dataset; ignoring.'
            );
            return;
        }

        var Ranking;
        try {
            Ranking = requireAcademyRanking('handleClearClick');
        } catch (err) {
            console.warn(err.message);
            return;
        }

        if (typeof Ranking.removeRankingAt !== 'function') {
            console.warn(
                '[AcademyRankingController] AcademyRanking.removeRankingAt ' +
                'is not available.'
            );
            return;
        }

        var result;
        try {
            result = Ranking.removeRankingAt(classId, week, charId);
        } catch (err) {
            console.warn(
                '[AcademyRankingController] removeRankingAt threw:', err
            );
            return;
        }

        if (result && typeof result.then === 'function') {
            result.then(function(resolved) {
                refreshAfterWrite('removeRankingAt', resolved);
            });
        } else {
            refreshAfterWrite('removeRankingAt', result);
        }
    }

    function handleInsertClick(insertBtn) {
        var classId = readClassIdFromDataset(insertBtn);
        var week = readWeekFromDataset(insertBtn);

        if (!isNonEmptyString(classId) || week === null) {
            console.warn(
                '[AcademyRankingController] insert clicked with ' +
                'incomplete dataset; ignoring.'
            );
            return;
        }

        var select = document.getElementById(
            'academy-ranking-insert-student'
        );
        if (!select || !isNonEmptyString(select.value)) {
            // Nothing selected: no-op. (The picker starts on an
            // empty placeholder option.)
            return;
        }

        var charId = String(select.value);

        var positionInput = document.getElementById(
            'academy-ranking-insert-position'
        );
        var rawPosition = positionInput ? positionInput.value : '';
        var position = parsePositiveInteger(rawPosition);

        var Ranking;
        try {
            Ranking = requireAcademyRanking('handleInsertClick');
        } catch (err) {
            console.warn(err.message);
            return;
        }

        if (typeof Ranking.insertRankingAt !== 'function') {
            console.warn(
                '[AcademyRankingController] AcademyRanking.insertRankingAt ' +
                'is not available.'
            );
            return;
        }

        var result;
        try {
            result = Ranking.insertRankingAt(
                classId, week, charId, position
            );
        } catch (err) {
            console.warn(
                '[AcademyRankingController] insertRankingAt threw:', err
            );
            return;
        }

        if (result && typeof result.then === 'function') {
            result.then(function(resolved) {
                refreshAfterWrite('insertRankingAt', resolved);
            });
        } else {
            refreshAfterWrite('insertRankingAt', result);
        }
    }

    // ============================================================
    // CHANGE
    // ============================================================

    function handleChange(e) {
        var target = e.target;
        if (!target || !target.id) { return; }

        if (target.id === 'academy-ranking-class-select') {
            // Route class changes through the shared Academy state.
            AcademyUI.selectClass(target.value || null);
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        if (target.id === 'academy-ranking-week-input') {
            var accepted = AcademyUI.setDisplayWeek(target.value);
            if (accepted) {
                var c = getContext();
                c.onChange();
            }
            return;
        }

        // #academy-ranking-insert-student: no action on change; the
        // user picks the student, then clicks Insert.
    }

    function handleInput(e) {
        // The Rankings view has no live text inputs. Reserved.
    }

    function handleKeydown(e) {
        var target = e.target;
        if (!target || e.key !== 'Enter') { return; }

        if (target.id === 'academy-ranking-week-input') {
            e.preventDefault();
            var accepted = AcademyUI.setDisplayWeek(target.value);
            if (accepted) {
                var ctx = getContext();
                ctx.onChange();
            }
        }
    }

    // ============================================================
    // DRAG AND DROP
    // ============================================================
    //
    // The drag state machine is deliberately small:
    //
    //   dragstart  → stash the dragged character ID, mark the
    //                dataTransfer as a move.
    //   dragover   → find the row under the pointer, decide
    //                before/after by midpoint, apply the drop
    //                class, preventDefault to allow the drop.
    //   dragleave  → if leaving a row we had marked, clear it.
    //   drop       → read the ordered list from the VM (re-fetched
    //                live, so it cannot be stale), splice the
    //                dragged ID to the target position, call
    //                setRanking. Refresh on resolve.
    //   dragend    → clear state (fires after a successful drop,
    //                a cancelled drag, or a drop on a non-target).
    //
    // The controller does NOT hold the ordered list between drops.
    // It re-reads it from the aggregator inside handleDrop. This
    // means a drop is always computed against current state, even
    // if another tab/refresh mutated the ranking mid-drag.

    function findRowFromEvent(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return null;
        }
        return target.closest('.academy-ranking-row');
    }

    function clearDropIndicator() {
        if (_dragDropTarget && _dragDropTarget.classList) {
            _dragDropTarget.classList.remove('drop-before');
            _dragDropTarget.classList.remove('drop-after');
        }
        _dragDropTarget = null;
        _dragDropAfter = false;
    }

    function applyDropIndicator(row, after) {
        if (_dragDropTarget && _dragDropTarget !== row &&
            _dragDropTarget.classList) {
            _dragDropTarget.classList.remove('drop-before');
            _dragDropTarget.classList.remove('drop-after');
        }

        if (row && row.classList) {
            row.classList.remove('drop-before');
            row.classList.remove('drop-after');
            row.classList.add(after ? 'drop-after' : 'drop-before');
        }

        _dragDropTarget = row;
        _dragDropAfter = after === true;
    }

    function handleDragStart(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        // Only the drag handle starts a drag. Dragging the row body
        // would conflict with text selection and with row click
        // navigation.
        var handle = target.closest('.rankings-drag-handle');
        if (!handle) {
            // Not a drag-handle drag: cancel the browser's default
            // row drag so it does not start a ghost image.
            if (e.preventDefault) { e.preventDefault(); }
            return;
        }

        var row = findRowFromEvent(e);
        if (!row || !row.dataset || !isNonEmptyString(row.dataset.characterId)) {
            if (e.preventDefault) { e.preventDefault(); }
            return;
        }

        _dragCharId = String(row.dataset.characterId);
        _dragDropTarget = null;
        _dragDropAfter = false;

        if (e.dataTransfer) {
            try {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', _dragCharId);
            } catch (err) {
                // Some browsers reject setData in certain contexts.
                // The drag still works via the stashed _dragCharId.
            }
        }
    }

    function handleDragOver(e) {
        if (!_dragCharId) {
            // Not our drag; let the browser do whatever it would.
            return;
        }

        var row = findRowFromEvent(e);
        if (!row || !row.dataset || !isNonEmptyString(row.dataset.characterId)) {
            // Pointer is over a non-row part of the host.
            clearDropIndicator();
            return;
        }

        // Allow the drop by cancelling the default action.
        if (e.preventDefault) { e.preventDefault(); }
        if (e.dataTransfer) {
            try {
                e.dataTransfer.dropEffect = 'move';
            } catch (err) { /* ignore */ }
        }

        var rect = row.getBoundingClientRect();
        var midpoint = rect.top + rect.height / 2;
        var after = e.clientY > midpoint;
        applyDropIndicator(row, after);
    }

    function handleDragLeave(e) {
        if (!_dragCharId) { return; }

        var row = findRowFromEvent(e);
        if (!row || row !== _dragDropTarget) { return; }

        // The pointer left the row we had marked. If it moved to a
        // child of that row, relatedTarget is still inside the row
        // and we should not clear.
        var related = e.relatedTarget;
        if (related && row.contains && row.contains(related)) {
            return;
        }

        clearDropIndicator();
    }

    function handleDrop(e) {
        if (!_dragCharId) {
            return;
        }

        var row = findRowFromEvent(e);
        var dragged = _dragCharId;

        // Clear the visual state first; the write is async and we
        // want the indicator gone immediately.
        var targetCharId = row && row.dataset && isNonEmptyString(
            row.dataset.characterId
        ) ? String(row.dataset.characterId) : null;
        var dropAfter = _dragDropAfter;

        clearDropIndicator();
        _dragCharId = null;

        if (e.preventDefault) { e.preventDefault(); }

        if (!targetCharId) {
            return;
        }
        if (targetCharId === dragged) {
            return;
        }

        performDrop(dragged, targetCharId, dropAfter);
    }

    function handleDragEnd(e) {
        // Fires after every drag, whether dropped, cancelled, or
        // dropped on a non-target. It is the right place for
        // unconditional cleanup.
        clearDropIndicator();
        _dragCharId = null;
    }

    function performDrop(draggedCharId, targetCharId, after) {
        var classId = AcademyUI.getSelectedClassId();
        var ctx = getContext();
        var week = ctx.week;

        if (!isNonEmptyString(classId) || week === undefined || week === null) {
            console.warn(
                '[AcademyRankingController] drop with no class/week; ' +
                'ignoring.'
            );
            return;
        }

        // Re-read the ordered list live from the aggregator so the
        // splice is against current state, not a cached list.
        var vm;
        try {
            vm = AcademyAggregator.getRankingViewModel(classId, week);
        } catch (err) {
            console.warn(
                '[AcademyRankingController] getRankingViewModel during ' +
                'drop threw:', err
            );
            return;
        }

        if (!vm || !Array.isArray(vm.rankedCharIds)) {
            console.warn(
                '[AcademyRankingController] VM has no rankedCharIds; ' +
                'cannot compute drop order.'
            );
            return;
        }

        var order = vm.rankedCharIds.slice();

        var fromIndex = order.indexOf(draggedCharId);
        if (fromIndex === -1) {
            console.warn(
                '[AcademyRankingController] dragged character not in ' +
                'ranking; ignoring drop.'
            );
            return;
        }
        order.splice(fromIndex, 1);

        var targetIndex = order.indexOf(targetCharId);
        if (targetIndex === -1) {
            // Target vanished (or was the dragged one). Re-insert
            // at the old position so nothing changes.
            order.splice(fromIndex, 0, draggedCharId);
            return;
        }

        var insertAt = after ? targetIndex + 1 : targetIndex;
        if (insertAt < 0) { insertAt = 0; }
        if (insertAt > order.length) { insertAt = order.length; }
        order.splice(insertAt, 0, draggedCharId);

        var Ranking;
        try {
            Ranking = requireAcademyRanking('performDrop');
        } catch (err) {
            console.warn(err.message);
            return;
        }

        if (typeof Ranking.setRanking !== 'function') {
            console.warn(
                '[AcademyRankingController] AcademyRanking.setRanking ' +
                'is not available.'
            );
            return;
        }

        var result;
        try {
            result = Ranking.setRanking(classId, week, order);
        } catch (err) {
            console.warn(
                '[AcademyRankingController] setRanking threw:', err
            );
            return;
        }

        if (result && typeof result.then === 'function') {
            result.then(function(resolved) {
                refreshAfterWrite('setRanking', resolved);
            });
        } else {
            refreshAfterWrite('setRanking', result);
        }
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        // Class selection is shared state owned by AcademyUI; this
        // controller holds no copy of it, so there is nothing to
        // persist or clear here.
        //
        // Drag state is transient; clearing it here prevents a
        // stale drag from being interpreted against a different
        // host on the next render.
        clearDropIndicator();
        _dragCharId = null;

        _host = null;
        _context = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRankingController = Object.freeze({
        render: render,
        handleClick: handleClick,
        handleChange: handleChange,
        handleInput: handleInput,
        handleKeydown: handleKeydown,
        handleDragStart: handleDragStart,
        handleDragOver: handleDragOver,
        handleDragLeave: handleDragLeave,
        handleDrop: handleDrop,
        handleDragEnd: handleDragEnd,
        unmount: unmount
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyRankingController;
        var missing = [];

        var required = [
            'render',
            'handleClick',
            'handleChange',
            'handleInput',
            'handleKeydown',
            'handleDragStart',
            'handleDragOver',
            'handleDragLeave',
            'handleDrop',
            'handleDragEnd',
            'unmount'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyRankingController] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
