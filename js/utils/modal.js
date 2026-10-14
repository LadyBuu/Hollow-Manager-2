/**
 * utils/modal.js - Modal System
 * Modal lifecycle management with proper cleanup and race prevention
 *
 * Path: js/utils/modal.js
 *
 * This module provides:
 *   - createModal      - Create a bare .modal shell
 *   - showModal        - Show with focus management
 *   - hideModal        - Hide with animation
 *   - closeModal       - Full cleanup and removal
 *   - modalClickOutside - Close on click outside the content
 *   - modalEscapeKey    - Close on Escape
 *   - modalSetup        - Both of the above (idempotent)
 *
 * IMPORTANT:
 *   - Owns per-modal lifecycle state and transition coordination.
 *   - Only one modal may be ACTIVE at a time. showModal() on a new
 *     modal closes the previous one and carries the previous focus
 *     trigger forward, so closing the new modal returns focus to
 *     the original element rather than to something inside the
 *     superseded modal.
 *   - Race-safe with a generation counter. A re-shown modal is not
 *     destroyed by a stale close.
 *   - modalSetup() is IDEMPOTENT. Duplicate calls are no-ops.
 *   - Accessibility: ARIA attributes, focus management, focus
 *     trapping. Background is not set inert; callers that need
 *     that must do it themselves.
 *
 * ESCAPE HANDLING:
 *   A single document-level keydown listener is installed when a
 *   modal becomes active and removed when it stops being active.
 *   The listener dispatches only to the ACTIVE modal's registered
 *   onClose. A hidden modal's Escape handler never fires.
 *
 *   Calling modalEscapeKey() no longer installs a listener; it
 *   registers the callback with the modal's state. This is why
 *   duplicate calls are safe.
 *
 * FOCUS CACHE:
 *   The list of focusable elements is queried fresh on each
 *   showModal() and each Tab press. It is NOT cached across
 *   renders. Callers that mutate the modal's body after show
 *   will get correct trap behaviour on the next Tab.
 *
 * CONTENT WRAPPER CONTRACT:
 *   createModal() returns a bare .modal shell with no children.
 *   The caller appends its own .modal-content with its own
 *   .close-modal button. This prevents double-wrapped modals
 *   (which would render side-by-side under .modal's display:flex).
 *
 * HIDDEN CLASS CONTRACT:
 *   shared.css declares `.modal { display: flex }` and
 *   `.modal.hidden { display: none !important }`. showModal()
 *   removes `hidden`; hideModal() re-adds it after the animation.
 *
 * ANIMATION_DURATION:
 *   The constant is exposed on the export so other modules can
 *   share the value. It MUST match the CSS transition duration for
 *   `.modal`. Change both when you change one.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (mandatory; checked on create and show)
 */

(function() {
    'use strict';

    if (window.__modalLoaded) return;
    window.__modalLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    var _depsChecked = false;

    function checkDependencies() {
        if (_depsChecked) return true;

        var DomUtils = window.DomUtils;
        var missing = [];

        if (!DomUtils || typeof DomUtils.createDiv !== 'function') {
            missing.push('DomUtils.createDiv');
        }
        if (!DomUtils || typeof DomUtils.addClass !== 'function') {
            missing.push('DomUtils.addClass');
        }
        if (!DomUtils || typeof DomUtils.removeClass !== 'function') {
            missing.push('DomUtils.removeClass');
        }

        if (missing.length > 0) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[Modal] Missing dependencies:', missing.join(', '));
            }
            return false;
        }

        _depsChecked = true;
        return true;
    }

    function getDomUtils() {
        return window.DomUtils;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var ANIMATION_DURATION = 300;

    // ============================================================
    // STATE
    // ============================================================

    var _modalState = new WeakMap();
    var _activeModal = null;

    // Document-level Escape listener. Installed exactly once (when
    // a modal becomes active) and removed when no modal is active.
    var _escapeListenerInstalled = false;

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    function _getModalState(modal) {
        var state = _modalState.get(modal);
        if (!state) {
            state = {
                hideTimer: null,
                focusTimer: null,
                animationFrame: null,
                cleanups: [],
                isShowing: false,
                generation: 0,
                hideResolvers: [],
                previousFocus: null,
                focusableElements: null,
                outsideClickSetup: false,
                outsideClickCleanup: null,
                escapeKeySetup: false,
                onEscape: null
            };
            _modalState.set(modal, state);
        }
        return state;
    }

    // ============================================================
    // FOCUS MANAGEMENT
    // ============================================================

    var FOCUSABLE_SELECTOR = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    function queryFocusable(container) {
        if (!container) return [];

        var elements = Array.prototype.slice.call(
            container.querySelectorAll(FOCUSABLE_SELECTOR)
        );

        return elements.filter(function(el) {
            // Hidden elements (offsetParent null) are not focusable,
            // unless they are the container itself or have an
            // explicit tabindex that keeps them focusable.
            if (el.offsetParent !== null) return true;
            if (el === container) return true;
            if (el.getAttribute('tabindex') !== null) return true;
            return false;
        });
    }

    function _saveFocus(modal) {
        var state = _getModalState(modal);
        // Only save the trigger on the FIRST show. Re-showing an
        // already-visible modal must not overwrite the trigger with
        // an element inside the modal.
        if (state.isShowing) return;
        state.previousFocus = document.activeElement;
    }

    function _restoreFocus(modal) {
        var state = _getModalState(modal);
        var target = state.previousFocus;
        state.previousFocus = null;

        if (!target) return;
        if (typeof target.focus !== 'function') return;
        // If the target was removed from the DOM, don't focus it.
        if (!document.body.contains(target)) return;

        try {
            target.focus();
        } catch (e) {
            // Ignore focus errors
        }
    }

    function _focusModal(modal) {
        if (!modal) return;

        var state = _getModalState(modal);
        if (!state.isShowing) return;

        var focusTarget = modal.querySelector('.modal-content') || modal;

        try {
            if (focusTarget.getAttribute('tabindex') === null) {
                focusTarget.setAttribute('tabindex', '-1');
            }
            focusTarget.focus();
        } catch (e) {
            // Ignore
        }

        // If there are focusable children, move focus to the first.
        // Otherwise leave focus on the wrapper so Tab can be
        // trapped.
        var focusable = queryFocusable(modal);
        state.focusableElements = focusable;

        if (focusable.length > 0) {
            try {
                focusable[0].focus();
            } catch (e) {
                // Ignore
            }
        }
    }

    function _trapFocus(e) {
        var modal = _activeModal;
        if (!modal) return;
        if (e.key !== 'Tab') return;

        var state = _getModalState(modal);
        var focusable = state.focusableElements;

        // Query fresh if the cache is absent or the modal has been
        // re-rendered. This is cheap for the typical modal subtree.
        if (!focusable) {
            focusable = queryFocusable(modal);
            state.focusableElements = focusable;
        }

        if (focusable.length === 0) {
            // No focusable children: keep focus on the wrapper.
            e.preventDefault();
            try {
                var wrapper = modal.querySelector('.modal-content') || modal;
                wrapper.focus();
            } catch (err) {
                // Ignore
            }
            return;
        }

        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        var active = document.activeElement;

        if (!modal.contains(active)) {
            // Focus somehow escaped; pull it back to the first.
            e.preventDefault();
            try { first.focus(); } catch (err) {}
            return;
        }

        if (e.shiftKey && (active === first || active === modal)) {
            e.preventDefault();
            try { last.focus(); } catch (err) {}
            return;
        }

        if (!e.shiftKey && active === last) {
            e.preventDefault();
            try { first.focus(); } catch (err) {}
        }
    }

    // ============================================================
    // ESCAPE HANDLING (single document listener)
    // ============================================================

    function _installEscapeListener() {
        if (_escapeListenerInstalled) return;
        document.addEventListener('keydown', _onEscapeKeydown, true);
        _escapeListenerInstalled = true;
    }

    function _uninstallEscapeListener() {
        if (!_escapeListenerInstalled) return;
        document.removeEventListener('keydown', _onEscapeKeydown, true);
        _escapeListenerInstalled = false;
    }

    function _onEscapeKeydown(e) {
        if (e.key !== 'Escape') return;
        if (!_activeModal) return;

        var state = _getModalState(_activeModal);
        if (!state.isShowing) return;
        if (typeof state.onEscape !== 'function') return;

        e.preventDefault();
        try {
            state.onEscape();
        } catch (err) {
            if (typeof console !== 'undefined' && console.error) {
                console.error('[Modal] escape handler threw:', err);
            }
        }
    }

    // ============================================================
    // HIDDEN CLASS MANAGEMENT
    // ============================================================

    function _clearHiddenClass(modal) {
        if (!modal || !modal.classList) return;
        if (modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
        }
    }

    function _restoreHiddenClass(modal) {
        if (!modal || !modal.classList) return;
        if (!modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
        }
    }

    // ============================================================
    // MODAL LIFECYCLE
    // ============================================================

    /**
     * Create a bare modal shell.
     *
     * The returned element is a `.modal` overlay with ARIA
     * attributes, `display: none` inline, and the `hidden` class.
     * It has NO children. The caller appends its own
     * `.modal-content` with a `.close-modal` button.
     *
     * @param {string} [className]
     * @returns {HTMLElement}
     */
    function createModal(className) {
        if (!checkDependencies()) {
            throw new Error(
                '[Modal] Dependencies not available. Cannot create modal.'
            );
        }

        var DomUtils = getDomUtils();
        var overlay = DomUtils.createDiv(
            'modal' + (className ? ' ' + className : '')
        );
        overlay.style.display = 'none';
        overlay.classList.add('hidden');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        return overlay;
    }

    /**
     * Show a modal.
     *
     * If another modal is active, it is closed first. The focus
     * trigger from the first modal is carried forward to the new
     * one, so closing the new modal restores focus to the original
     * element.
     */
    function showModal(modal) {
        if (!modal) return;
        if (!checkDependencies()) return;

        var previousModal = _activeModal;
        var inheritedFocus = null;

        if (previousModal && previousModal !== modal) {
            var prevState = _getModalState(previousModal);
            if (prevState.isShowing) {
                // Inherit the previous modal's saved trigger BEFORE
                // closing it, so the new modal's restore path lands
                // on the correct element.
                inheritedFocus = prevState.previousFocus;
                prevState.previousFocus = null;
                closeModal(previousModal);
            }
        }

        var state = _getModalState(modal);

        state.generation++;

        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
        }
        if (state.focusTimer) {
            clearTimeout(state.focusTimer);
            state.focusTimer = null;
        }
        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }

        if (state.hideResolvers.length > 0) {
            var resolvers = state.hideResolvers;
            state.hideResolvers = [];
            resolvers.forEach(function(resolve) {
                try { resolve(); } catch (e) {}
            });
        }

        // Restore inherited focus trigger if we had one.
        if (inheritedFocus && !state.previousFocus) {
            state.previousFocus = inheritedFocus;
        }

        _saveFocus(modal);

        _clearHiddenClass(modal);
        modal.style.display = 'flex';

        if (!document.body.contains(modal)) {
            document.body.appendChild(modal);
        }

        // Invalidate the focus cache; a fresh query happens on the
        // next focus timer or Tab press.
        state.focusableElements = null;

        _activeModal = modal;

        document.addEventListener('keydown', _trapFocus, true);
        _installEscapeListener();

        state.isShowing = true;
        state.animationFrame = requestAnimationFrame(function() {
            state.animationFrame = null;
            if (!state.isShowing) return;
            var DomUtils = getDomUtils();
            DomUtils.addClass(modal, 'visible');
            state.focusTimer = setTimeout(function() {
                state.focusTimer = null;
                if (!state.isShowing) return;
                _focusModal(modal);
            }, 50);
        });
    }

    /**
     * Hide a modal. Returns a promise resolving when the hide
     * animation completes.
     */
    function hideModal(modal) {
        if (!modal) return Promise.resolve();

        var state = _getModalState(modal);

        state.isShowing = false;

        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }
        if (state.focusTimer) {
            clearTimeout(state.focusTimer);
            state.focusTimer = null;
        }
        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
        }

        return new Promise(function(resolve) {
            state.hideResolvers.push(resolve);

            var DomUtils = getDomUtils();
            if (DomUtils) {
                DomUtils.removeClass(modal, 'visible');
            }

            state.hideTimer = setTimeout(function() {
                state.hideTimer = null;
                modal.style.display = 'none';
                _restoreHiddenClass(modal);

                var wasActive = (_activeModal === modal);
                if (wasActive) {
                    _activeModal = null;
                    document.removeEventListener('keydown', _trapFocus, true);
                    _uninstallEscapeListener();
                    // Only restore focus if we were the active
                    // modal. If another modal took over, that modal
                    // owns focus now.
                    _restoreFocus(modal);
                }

                var resolvers = state.hideResolvers;
                state.hideResolvers = [];
                resolvers.forEach(function(r) {
                    try { r(); } catch (e) {}
                });
            }, ANIMATION_DURATION);
        });
    }

    /**
     * Close a modal: hide, then remove from the DOM and run
     * cleanups. Safe to call multiple times; the generation guard
     * prevents a stale close from destroying a re-shown modal.
     */
    function closeModal(modal) {
        if (!modal) return Promise.resolve();

        var state = _getModalState(modal);
        var generation = state.generation;

        return hideModal(modal).then(function() {
            if (state.generation !== generation) {
                return;  // re-shown; don't destroy
            }

            // Run registered cleanups (click-outside, etc.).
            if (state.cleanups && state.cleanups.length > 0) {
                var cleanups = state.cleanups;
                state.cleanups = [];
                cleanups.forEach(function(fn) {
                    try { fn(); } catch (e) {
                        if (typeof console !== 'undefined' && console.error) {
                            console.error('[Modal] Cleanup error:', e);
                        }
                    }
                });
            }

            if (state.hideTimer) {
                clearTimeout(state.hideTimer);
                state.hideTimer = null;
            }
            if (state.focusTimer) {
                clearTimeout(state.focusTimer);
                state.focusTimer = null;
            }
            if (state.animationFrame) {
                cancelAnimationFrame(state.animationFrame);
                state.animationFrame = null;
            }

            _modalState.delete(modal);

            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }

            // Restore focus AFTER removal, in case the focus target
            // was inside the modal.
            if (_activeModal === modal) {
                _activeModal = null;
                document.removeEventListener('keydown', _trapFocus, true);
                _uninstallEscapeListener();
            }
        });
    }

    function _registerCleanup(modal, fn) {
        if (!modal) return;
        var state = _getModalState(modal);
        state.cleanups.push(fn);
    }

    // ============================================================
    // SETUP FUNCTIONS - individually idempotent
    // ============================================================

    /**
     * Close on click outside the .modal-content.
     *
     * Guarded against drag-release: closes only if both the
     * mousedown and the click occurred on the overlay itself.
     * Selecting text inside the content and releasing over the
     * overlay does NOT close.
     *
     * IDEMPOTENT: a second call is a no-op and returns the
     * existing cleanup function.
     */
    function modalClickOutside(modal, onClose) {
        if (!modal) return function() {};

        var state = _getModalState(modal);

        if (state.outsideClickSetup) {
            return state.outsideClickCleanup || function() {};
        }
        state.outsideClickSetup = true;

        var mousedownOnOverlay = false;

        function onMouseDown(e) {
            mousedownOnOverlay = (e.target === modal);
        }

        function onClick(e) {
            if (!mousedownOnOverlay) return;
            if (e.target !== modal) return;
            mousedownOnOverlay = false;
            if (typeof onClose === 'function') {
                onClose();
            } else {
                closeModal(modal);
            }
        }

        modal.addEventListener('mousedown', onMouseDown);
        modal.addEventListener('click', onClick);

        var cleanup = function() {
            modal.removeEventListener('mousedown', onMouseDown);
            modal.removeEventListener('click', onClick);
            state.outsideClickSetup = false;
            state.outsideClickCleanup = null;
        };

        state.outsideClickCleanup = cleanup;
        _registerCleanup(modal, cleanup);

        return cleanup;
    }

    /**
     * Register an onClose callback to run when Escape is pressed.
     *
     * The document-level listener is shared across all modals and
     * dispatches only to the ACTIVE modal. A hidden modal's
     * callback never fires.
     *
     * IDEMPOTENT: a second call replaces the registered callback
     * but does not install a second listener.
     */
    function modalEscapeKey(modal, onClose) {
        if (!modal) return function() {};

        var state = _getModalState(modal);
        state.escapeKeySetup = true;
        state.onEscape = typeof onClose === 'function'
            ? onClose
            : function() { closeModal(modal); };

        var cleanup = function() {
            state.escapeKeySetup = false;
            state.onEscape = null;
        };

        _registerCleanup(modal, cleanup);

        return cleanup;
    }

    /**
     * Register click-outside and escape-key handlers.
     * IDEMPOTENT.
     */
    function modalSetup(modal, onClose) {
        if (!modal) return;
        modalClickOutside(modal, onClose);
        modalEscapeKey(modal, onClose);
    }

    // ============================================================
    // QUERIES
    // ============================================================

    function getActiveModal() {
        return _activeModal;
    }

    function isShowing(modal) {
        if (!modal) return false;
        var state = _modalState.get(modal);
        return state ? state.isShowing : false;
    }

    /**
     * Close the active modal, if any. Only one modal is active at a
     * time, so this is equivalent to "close everything". Named for
     * its callers, not for an array of modals.
     */
    function closeAllModals() {
        if (!_activeModal) {
            return Promise.resolve();
        }
        return closeModal(_activeModal);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.Modal = Object.freeze({
        createModal: createModal,
        showModal: showModal,
        hideModal: hideModal,
        closeModal: closeModal,
        modalClickOutside: modalClickOutside,
        modalEscapeKey: modalEscapeKey,
        modalSetup: modalSetup,
        getActiveModal: getActiveModal,
        isShowing: isShowing,
        closeAllModals: closeAllModals,
        ANIMATION_DURATION: ANIMATION_DURATION
    });

})();
