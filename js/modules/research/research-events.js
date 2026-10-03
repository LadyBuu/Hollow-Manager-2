/**
 * modules/research/research-events.js - Research Events
 * Modal lifecycle and event wiring for the research feature.
 *
 * Path: js/modules/research/research-events.js
 *
 * WHAT THIS OWNS:
 *   - Modal creation, show, and close.
 *   - The debounced input handler.
 *   - Reading the input value; writing results into the host.
 *   - The clear button.
 *   - Result click: dispatch to CharacterDetail.open().
 *
 * WHAT THIS DOES NOT OWN:
 *   - The search. ResearchQueries owns it.
 *   - The HTML. ResearchView owns it.
 *   - The character detail modal. CharacterDetail owns it.
 *   - Any mutation. This module never writes.
 *
 * LIFECYCLE:
 *   open()
 *     -> create modal shell via Modal.createModal()
 *     -> append .modal-content
 *     -> write ResearchView.renderShell() into it
 *     -> bind input / clear / close / result-click handlers
 *     -> Modal.modalSetup() + Modal.showModal()
 *     -> focus the input
 *
 *   close()
 *     -> Modal.closeModal()
 *     -> drop state
 *
 *   re-open: if the modal already exists and is showing, calling
 *   open() again does nothing. Calling open() while closed
 *   destroys the old modal and rebuilds. This keeps the module
 *   tolerant of double-clicks and of the character detail modal
 *   stealing focus.
 *
 * MODAL SETUP CONTRACT:
 *   Modal.modalSetup(modal, onClose) installs outside-click and
 *   Escape handlers. When onClose is supplied, Modal does NOT
 *   close the modal itself — it calls the callback and expects
 *   the callback to do the full teardown. So the callback here
 *   invokes close(), which is the module's canonical teardown
 *   path (Modal.closeModal + state clear).
 *
 *   If the callback only cleared module state without calling
 *   Modal.closeModal, the modal element would remain in the
 *   DOM and visible, and _modal would be null so close() could
 *   not be called on it afterwards.
 *
 * DEBOUNCE:
 *   200ms on input. Fast enough to feel responsive; slow enough
 *   that a long search over a large character store does not fire
 *   on every keystroke.
 *
 * RESULT CLICK:
 *   Single active-modal policy (Modal.showModal closes any other
 *   active modal). Clicking a result:
 *     1. Reads data-character-id from the closest .research-result-group
 *     2. Closes the research modal
 *     3. Calls CharacterDetail.open(id)
 *   CharacterDetail then becomes the only active modal. When it
 *   closes, the user can reopen research from the Research button.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.Modal
 *   - window.ResearchQueries
 *   - window.ResearchView
 *
 * DEPENDENCIES (LAZY, at click time):
 *   - window.CharacterDetail
 */

(function() {
    'use strict';

    if (window.__researchEventsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var Modal = window.Modal;
    var ResearchQueries = window.ResearchQueries;
    var ResearchView = window.ResearchView;

    var _missing = [];

    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }
    if (!ResearchQueries ||
        typeof ResearchQueries.search !== 'function') {
        _missing.push('ResearchQueries.search');
    }
    if (!ResearchView ||
        typeof ResearchView.renderShell !== 'function') {
        _missing.push('ResearchView.renderShell');
    }
    if (!ResearchView ||
        typeof ResearchView.renderResults !== 'function') {
        _missing.push('ResearchView.renderResults');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[ResearchEvents] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__researchEventsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MODAL_ID = 'research-modal';
    var DEBOUNCE_MS = 200;

    // ============================================================
    // STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _inputEl = null;
    var _resultsEl = null;
    var _debounceTimer = null;
    var _lastQuery = null;

    // ============================================================
    // LAZY DEPENDENCY ACCESS
    // ============================================================

    function getCharacterDetail() {
        return window.CharacterDetail || null;
    }

    // ============================================================
    // OPEN / CLOSE
    // ============================================================

    function open() {
        // Already open: focus the input and bail. This makes the
        // Research button idempotent even if it fires twice.
        if (_modal && _inputEl) {
            focusInput();
            return;
        }

        // Stale modal from a previous mount: tear it down.
        if (_modal) {
            try { Modal.closeModal(_modal); } catch (e) {}
            _modal = null;
            _contentEl = null;
            _inputEl = null;
            _resultsEl = null;
        }

        var modal = Modal.createModal(MODAL_ID);
        if (!modal) {
            console.warn(
                '[ResearchEvents] Modal.createModal returned null.'
            );
            return;
        }
        modal.id = MODAL_ID;

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide research-content';
        contentEl.innerHTML = ResearchView.renderShell();
        modal.appendChild(contentEl);

        _modal = modal;
        _contentEl = contentEl;
        _inputEl = contentEl.querySelector('#research-input');
        _resultsEl = contentEl.querySelector('#research-results');

        if (!_inputEl || !_resultsEl) {
            console.warn(
                '[ResearchEvents] Research shell is missing ' +
                '#research-input or #research-results.'
            );
            try { Modal.closeModal(modal); } catch (e) {}
            _modal = null;
            _contentEl = null;
            return;
        }

        _lastQuery = null;

        bindEvents();

        Modal.modalSetup(modal, function() {
            // Modal.modalSetup calls this when the user clicks
            // outside the modal or presses Escape. Modal does
            // NOT close the modal itself when onClose is
            // supplied; the callback is responsible for the
            // full teardown.
            //
            // close() is that teardown: it calls
            // Modal.closeModal (which hides and removes the
            // element) and clears module state.
            close();
        });

        Modal.showModal(modal);

        // Focus after the show animation has begun.
        setTimeout(focusInput, 50);
    }

    function close() {
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }

        var modal = _modal;
        _modal = null;
        _contentEl = null;
        _inputEl = null;
        _resultsEl = null;
        _lastQuery = null;

        if (modal) {
            try { Modal.closeModal(modal); } catch (e) {}
        }
    }

    function isOpen() {
        return _modal !== null && _inputEl !== null;
    }

    // ============================================================
    // FOCUS
    // ============================================================

    function focusInput() {
        if (!_inputEl) { return; }
        try { _inputEl.focus(); } catch (e) {}
        // Place the caret at the end of any pre-existing value.
        var len = _inputEl.value ? _inputEl.value.length : 0;
        try { _inputEl.setSelectionRange(len, len); } catch (e) {}
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

    function bindEvents() {
        if (!_contentEl) { return; }

        // Input: debounced search.
        _inputEl.addEventListener('input', handleInput);
        _inputEl.addEventListener('keydown', handleInputKeydown);

        // Delegated clicks: close, clear, result rows.
        _contentEl.addEventListener('click', handleContentClick);
    }

    function handleInput() {
        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
        }
        _debounceTimer = setTimeout(function() {
            _debounceTimer = null;
            runSearch();
        }, DEBOUNCE_MS);
    }

    function handleInputKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (_debounceTimer) {
                clearTimeout(_debounceTimer);
                _debounceTimer = null;
            }
            runSearch();
            return;
        }

        // Let Escape through to Modal's own handler (it closes the
        // modal). No action needed here.
    }

    function handleContentClick(e) {
        var target = e.target.closest
            ? e.target.closest('[data-action]')
            : null;

        if (target && target.dataset) {
            var action = target.dataset.action;

            if (action === 'research-close') {
                e.preventDefault();
                close();
                return;
            }

            if (action === 'research-clear') {
                e.preventDefault();
                clearInput();
                return;
            }
        }

        // Result row click: find the closest group and open the
        // character detail modal.
        var group = e.target.closest
            ? e.target.closest('.research-result-group')
            : null;
        if (!group) { return; }

        var charId = group.getAttribute('data-character-id');
        if (!charId) { return; }

        e.preventDefault();
        openCharacterDetail(charId);
    }

    // ============================================================
    // SEARCH EXECUTION
    // ============================================================

    function runSearch() {
        if (!_inputEl || !_resultsEl) { return; }

        var raw = _inputEl.value || '';

        // Avoid re-rendering if the query has not changed since
        // the last search.
        if (_lastQuery === raw) { return; }
        _lastQuery = raw;

        var vm;
        try {
            vm = ResearchQueries.search(raw);
        } catch (err) {
            console.warn(
                '[ResearchEvents] ResearchQueries.search threw:', err
            );
            _resultsEl.innerHTML =
                '<p class="empty-state research-empty">' +
                    'Search failed. Please try again.' +
                '</p>';
            return;
        }

        _resultsEl.innerHTML = ResearchView.renderResults(vm);

        // Scroll the results pane back to the top on a new query.
        try {
            _resultsEl.scrollTop = 0;
        } catch (e) {
            // Non-fatal.
        }
    }

    function clearInput() {
        if (!_inputEl) { return; }

        _inputEl.value = '';
        _lastQuery = null;

        if (_debounceTimer) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }

        if (_resultsEl) {
            _resultsEl.innerHTML =
                ResearchView.renderInitialState();
        }

        focusInput();
    }

    // ============================================================
    // RESULT HANDLING
    // ============================================================

    function openCharacterDetail(charId) {
        var Detail = getCharacterDetail();
        if (!Detail || typeof Detail.open !== 'function') {
            console.warn(
                '[ResearchEvents] CharacterDetail.open is not ' +
                'available; cannot open character ' + charId + '.'
            );
            return;
        }

        // Close research first. Modal is single-active, so
        // CharacterDetail.open would otherwise replace it anyway;
        // doing this explicitly keeps the state clean and makes
        // the dependency on the single-modal policy obvious.
        close();

        try {
            Detail.open(String(charId));
        } catch (err) {
            console.warn(
                '[ResearchEvents] CharacterDetail.open threw:', err
            );
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.Research = Object.freeze({
        open: open,
        close: close,
        isOpen: isOpen
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.Research;
        var missing = [];

        var required = ['open', 'close', 'isOpen'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (isOpen() !== false) {
                missing.push('isOpen() should be false before open()');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[ResearchEvents] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
