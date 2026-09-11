/**
 * utils/modal.js - Modal System
 * Modal lifecycle management with proper cleanup and race prevention
 * 
 * Path: js/utils/modal.js
 * 
 * This module provides:
 *   - createModal - Create modal overlay with accessibility attributes
 *   - showModal / hideModal - Show/hide with animations
 *   - closeModal - Full cleanup and removal
 *   - modalClickOutside / modalEscapeKey - Event setup
 *   - modalSetup - Convenience for both
 * 
 * IMPORTANT:
 *   - Owns per-modal lifecycle state and transition coordination
 *   - Uses DomUtils for DOM operations (mandatory dependency)
 *   - Race-condition safe with generation tracking
 *   - Only one modal may be active at a time (application invariant)
 *   - modalSetup() is IDEMPOTENT — safe to call multiple times per modal
 *   - Accessibility: ARIA attributes, focus management, focus trapping
 *   - Focus management: saves previous focus, restores on close
 * 
 * HIDDEN CLASS CONTRACT:
 *   - The CSS class `.hidden` has `display: none !important` in style.css
 *   - Modals are often declared with `<div class="modal hidden">`
 *   - showModal() REMOVES the `hidden` class so the modal can be shown
 *   - hideModal() RE-ADDS the `hidden` class after the animation completes
 *   - This keeps the CSS state and JS state in sync
 * 
 * IDEMPOTENCY:
 *   - Each setup function (modalClickOutside, modalEscapeKey) tracks its
 *     own installation flag
 *   - modalSetup() calls both, each of which no-ops if already installed
 *   - Duplicate calls are silent and safe
 * 
 * DEPENDENCIES:
 *   - window.DomUtils (for DOM operations) - MANDATORY
 * 
 * USAGE:
 *   var modal = Modal.createModal('my-modal');
 *   Modal.modalSetup(modal, function() { console.log('Closed'); });
 *   Modal.showModal(modal);
 *   // Later:
 *   Modal.closeModal(modal);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__modalLoaded) return;
    window.__modalLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
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
            console.error('[Modal] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
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
    var _focusableElementsCache = new WeakMap();

    // ============================================================
    // FOCUS MANAGEMENT
    // ============================================================

    /**
     * Get all focusable elements within a container.
     */
    function getFocusableElements(container) {
        if (!container) return [];

        if (_focusableElementsCache.has(container)) {
            return _focusableElementsCache.get(container);
        }

        var selector = [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(',');

        var elements = Array.from(container.querySelectorAll(selector));

        elements = elements.filter(function(el) {
            return el.offsetParent !== null ||
                   el === container ||
                   el.getAttribute('tabindex') !== null;
        });

        _focusableElementsCache.set(container, elements);

        return elements;
    }

    function _saveFocus(modal) {
        var state = _getModalState(modal);
        state.previousFocus = document.activeElement;
    }

    function _restoreFocus(modal) {
        var state = _getModalState(modal);
        if (state.previousFocus && state.previousFocus.focus) {
            try {
                state.previousFocus.focus();
            } catch (e) {
                // Ignore focus errors
            }
        }
        state.previousFocus = null;
    }

    function _focusModal(modal) {
        if (!modal) return;

        var focusTarget = modal.querySelector('.modal-content');
        if (!focusTarget) {
            focusTarget = modal;
        }

        try {
            if (focusTarget.getAttribute('tabindex') === null) {
                focusTarget.setAttribute('tabindex', '-1');
            }
            focusTarget.focus();
        } catch (e) {
            // Ignore focus errors
        }

        var focusable = getFocusableElements(modal);
        var state = _getModalState(modal);
        state.focusableElements = focusable;

        if (focusable.length > 0) {
            try {
                focusable[0].focus();
            } catch (e) {
                // Ignore focus errors
            }
        }
    }

    function _trapFocus(e) {
        var modal = _activeModal;
        if (!modal) return;

        if (e.key !== 'Tab') return;

        var state = _getModalState(modal);
        var focusable = state.focusableElements || getFocusableElements(modal);

        if (focusable.length === 0) return;

        var firstElement = focusable[0];
        var lastElement = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            try {
                lastElement.focus();
            } catch (err) {
                // Ignore focus errors
            }
        } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            try {
                firstElement.focus();
            } catch (err) {
                // Ignore focus errors
            }
        }
    }

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    function _getModalState(modal) {
        var state = _modalState.get(modal);
        if (!state) {
            state = {
                hideTimer: null,
                animationFrame: null,
                cleanups: [],
                isShowing: false,
                generation: 0,
                hideResolvers: [],
                previousFocus: null,
                focusableElements: [],
                isSetup: false,              // legacy aggregate flag (unused)
                outsideClickSetup: false,    // per-listener idempotency
                escapeKeySetup: false        // per-listener idempotency
            };
            _modalState.set(modal, state);
        }
        return state;
    }

    // ============================================================
    // HIDDEN CLASS MANAGEMENT
    // ============================================================

    /**
     * Remove the `hidden` CSS class from a modal.
     * Called by showModal() so the modal can actually be displayed.
     */
    function _clearHiddenClass(modal) {
        if (!modal || !modal.classList) return;
        if (modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
        }
    }

    /**
     * Re-add the `hidden` CSS class to a modal.
     * Called by hideModal() after the hide animation finishes,
     * so the modal's state stays consistent with the CSS contract.
     */
    function _restoreHiddenClass(modal) {
        if (!modal || !modal.classList) return;
        if (!modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
        }
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================

    function createModal(className) {
        if (!checkDependencies()) {
            throw new Error('[Modal] Dependencies not available. Cannot create modal.');
        }

        var overlay = DomUtils.createDiv('modal' + (className ? ' ' + className : ''));
        overlay.style.display = 'none';
        overlay.classList.add('hidden');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        var content = DomUtils.createDiv('modal-content');
        content.setAttribute('tabindex', '-1');
        overlay.appendChild(content);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn';
        closeBtn.setAttribute('aria-label', 'Close modal');
        closeBtn.textContent = '×';
        content.appendChild(closeBtn);

        closeBtn.addEventListener('click', function() {
            var state = _getModalState(overlay);
            if (state.isShowing) {
                closeModal(overlay);
            }
        });

        return overlay;
    }

    /**
     * Show a modal.
     * 
     * STEPS:
     *   1. Removes the `hidden` class (so the modal can be visible)
     *   2. Clears any pending hide timer
     *   3. Increments generation to invalidate stale operations
     *   4. Saves current focus and sets focus to modal
     *   5. Sets style.display = 'flex' and appends to body if needed
     *   6. Adds the `visible` class after an animation frame
     */
    function showModal(modal) {
        if (!modal) return;

        if (_activeModal && _activeModal !== modal) {
            var oldState = _getModalState(_activeModal);
            if (oldState.isShowing) {
                closeModal(_activeModal);
            }
        }

        var state = _getModalState(modal);

        state.generation++;

        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
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

        _saveFocus(modal);

        // Remove the `hidden` class so the modal can be displayed
        _clearHiddenClass(modal);

        modal.style.display = 'flex';

        if (!document.body.contains(modal)) {
            document.body.appendChild(modal);
        }

        _activeModal = modal;

        document.addEventListener('keydown', _trapFocus);

        state.isShowing = true;
        state.animationFrame = requestAnimationFrame(function() {
            state.animationFrame = null;
            if (state.isShowing) {
                DomUtils.addClass(modal, 'visible');
                setTimeout(function() {
                    _focusModal(modal);
                }, 50);
            }
        });
    }

    /**
     * Hide a modal.
     * Returns a promise that resolves when the animation completes.
     * Re-adds the `hidden` class after hiding.
     */
    function hideModal(modal) {
        if (!modal) return Promise.resolve();

        var state = _getModalState(modal);

        state.isShowing = false;

        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }

        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
        }

        return new Promise(function(resolve) {
            state.hideResolvers.push(resolve);

            DomUtils.removeClass(modal, 'visible');

            state.hideTimer = setTimeout(function() {
                state.hideTimer = null;
                modal.style.display = 'none';

                _restoreHiddenClass(modal);
                _restoreFocus(modal);

                if (_activeModal === modal) {
                    _activeModal = null;
                    document.removeEventListener('keydown', _trapFocus);
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
     * Close a modal (remove from DOM after hide).
     */
    function closeModal(modal) {
        if (!modal) return Promise.resolve();

        var state = _getModalState(modal);
        var generation = state.generation;

        return hideModal(modal).then(function() {
            if (state.generation !== generation) {
                return;  // re-shown, don't destroy
            }

            if (state.cleanups) {
                state.cleanups.forEach(function(fn) {
                    try { fn(); } catch (e) {
                        console.error('[Modal] Cleanup error:', e);
                    }
                });
                state.cleanups = [];
            }

            if (state.hideTimer) {
                clearTimeout(state.hideTimer);
                state.hideTimer = null;
            }

            if (state.animationFrame) {
                cancelAnimationFrame(state.animationFrame);
                state.animationFrame = null;
            }

            _focusableElementsCache.delete(modal);
            _modalState.delete(modal);

            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }

            if (_activeModal === modal) {
                _activeModal = null;
                document.removeEventListener('keydown', _trapFocus);
            }
        });
    }

    function _registerCleanup(modal, fn) {
        if (!modal) return;
        var state = _getModalState(modal);
        state.cleanups.push(fn);
    }

    // ============================================================
    // SETUP FUNCTIONS — individually idempotent
    // ============================================================

    /**
     * Setup click-outside to close a modal.
     * 
     * IDEMPOTENT: calling multiple times on the same modal is safe.
     * The listener is installed only once; subsequent calls are no-ops.
     * 
     * @param {HTMLElement} modal - Modal element
     * @param {Function} onClose - Optional callback when closed
     * @returns {Function} Cleanup function
     */
    function modalClickOutside(modal, onClose) {
        if (!modal) return function() {};

        var state = _getModalState(modal);

        // Idempotent — no-op if already installed
        if (state.outsideClickSetup) {
            return function() {};
        }
        state.outsideClickSetup = true;

        var handler = function(e) {
            if (e.target === modal) {
                if (typeof onClose === 'function') {
                    onClose();
                } else {
                    closeModal(modal);
                }
            }
        };

        modal.addEventListener('click', handler);

        var cleanup = function() {
            modal.removeEventListener('click', handler);
            state.outsideClickSetup = false;
        };

        _registerCleanup(modal, cleanup);

        return cleanup;
    }

    /**
     * Setup escape key to close a modal.
     * 
     * IDEMPOTENT: calling multiple times on the same modal is safe.
     * The listener is installed only once; subsequent calls are no-ops.
     * 
     * @param {HTMLElement} modal - Modal element
     * @param {Function} onClose - Optional callback when closed
     * @returns {Function} Cleanup function
     */
    function modalEscapeKey(modal, onClose) {
        if (!modal) return function() {};

        var state = _getModalState(modal);

        // Idempotent — no-op if already installed
        if (state.escapeKeySetup) {
            return function() {};
        }
        state.escapeKeySetup = true;

        var handler = function(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (typeof onClose === 'function') {
                    onClose();
                } else {
                    closeModal(modal);
                }
            }
        };

        document.addEventListener('keydown', handler);

        var cleanup = function() {
            document.removeEventListener('keydown', handler);
            state.escapeKeySetup = false;
        };

        _registerCleanup(modal, cleanup);

        return cleanup;
    }

    /**
     * Setup both click-outside and escape-key for a modal.
     * 
     * IDEMPOTENT: safe to call multiple times on the same modal.
     * Each sub-function is individually idempotent, so this is a
     * silent no-op when called on an already-setup modal.
     * 
     * @param {HTMLElement} modal - Modal element
     * @param {Function} onClose - Optional callback when closed
     */
    function modalSetup(modal, onClose) {
        if (!modal) return;

        // Each sub-function handles its own idempotency
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

    function closeAllModals() {
        if (!_activeModal) {
            return Promise.resolve();
        }
        return closeModal(_activeModal);
    }

    // ============================================================
    // CSS (injected for self-containment)
    // ============================================================

    function injectStyles() {
        var style = document.getElementById('modal-styles');
        if (style) return;

        style = document.createElement('style');
        style.id = 'modal-styles';
        style.textContent = `
            .modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                display: none;
                justify-content: center;
                align-items: center;
                z-index: 9999;
                padding: 20px;
                box-sizing: border-box;
                animation: modalFadeIn 0.3s ease;
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
            }

            .modal.visible {
                display: flex;
            }

            .modal .modal-content {
                background: var(--panel, #2d2d2d);
                border-radius: 12px;
                max-width: 600px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                padding: 24px;
                position: relative;
                border: 1px solid var(--border, #444);
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                animation: modalSlideIn 0.3s ease;
                box-sizing: border-box;
            }

            .modal .modal-content.wide {
                max-width: 800px;
            }

            .modal .modal-content.small {
                max-width: 400px;
            }

            .modal .modal-content .modal-close-btn {
                position: absolute;
                top: 12px;
                right: 16px;
                background: none;
                border: none;
                color: var(--text-dim, #888);
                font-size: 24px;
                cursor: pointer;
                padding: 0 4px;
                line-height: 1;
                transition: color 0.2s;
                z-index: 10;
            }

            .modal .modal-content .modal-close-btn:hover {
                color: var(--text, #e0e0e0);
            }

            .modal .modal-content .modal-header {
                margin-bottom: 16px;
                padding-right: 32px;
            }

            .modal .modal-content .modal-header h3 {
                margin: 0;
                font-size: 1.1rem;
                font-weight: 600;
            }

            .modal .modal-content .modal-body {
                margin-bottom: 16px;
            }

            .modal .modal-content .form-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                margin-top: 16px;
                padding-top: 16px;
                border-top: 1px solid var(--border, #444);
            }

            .modal .modal-content .modal-body .detail-row {
                display: flex;
                justify-content: space-between;
                padding: 4px 0;
                border-bottom: 1px solid var(--border-soft, #333);
            }

            .modal .modal-content .modal-body .detail-row .label {
                color: var(--text-dim, #888);
                font-size: 0.8rem;
            }

            .modal .modal-content .modal-body .empty-state {
                color: var(--text-dim, #888);
                text-align: center;
                padding: 20px;
                font-style: italic;
            }

            @keyframes modalFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @keyframes modalSlideIn {
                from {
                    transform: translateY(20px) scale(0.95);
                    opacity: 0;
                }
                to {
                    transform: translateY(0) scale(1);
                    opacity: 1;
                }
            }

            @media (max-width: 600px) {
                .modal {
                    padding: 10px;
                }

                .modal .modal-content {
                    padding: 16px;
                    max-height: 95vh;
                }

                .modal .modal-content .modal-close-btn {
                    top: 8px;
                    right: 12px;
                    font-size: 20px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        injectStyles();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.Modal = {
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
        init: init,
        ANIMATION_DURATION: ANIMATION_DURATION
    };

})();
