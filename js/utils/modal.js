/**
 * utils/modal.js - Modal System
 * Modal lifecycle management with proper cleanup and race prevention
 * 
 * Path: js/utils/modal.js
 * 
 * This module provides:
 *   - createModal - Create modal overlay
 *   - showModal / hideModal - Show/hide with animations
 *   - closeModal - Full cleanup and removal
 *   - modalClickOutside / modalEscapeKey - Event setup
 *   - modalSetup - Convenience for both
 * 
 * IMPORTANT:
 *   - Owns per-modal lifecycle state and transition coordination
 *   - Uses DomUtils for DOM operations (dependency)
 *   - Race-condition safe with generation tracking
 *   - Only one modal may be active at a time (application invariant)
 *   - modalSetup() must be called only once per modal
 *   - Accessibility focus management is included
 * 
 * DEPENDENCIES:
 *   - window.DomUtils (for DOM operations)
 * 
 * USAGE:
 *   var modal = Modal.createModal('my-modal');
 *   document.body.appendChild(modal);
 *   Modal.modalSetup(modal, function() { console.log('Closed'); });
 *   Modal.showModal(modal);
 *   // Later:
 *   Modal.closeModal(modal);
 */

(function() {
    'use strict';

    if (window.__modalLoaded) return;
    window.__modalLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;

    if (!DomUtils || typeof DomUtils.createDiv !== 'function') {
        throw new Error('Modal: DomUtils is required but not available.');
    }

    // ============================================================
    // STATE
    // ============================================================

    var _modalState = new WeakMap();

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
                isSetup: false
            };
            _modalState.set(modal, state);
        }
        return state;
    }

    // ============================================================
    // FOCUS MANAGEMENT
    // ============================================================

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

        // Focus the modal content or the modal itself
        var focusTarget = modal.querySelector('.modal-content') || modal;
        try {
            focusTarget.focus();
        } catch (e) {
            // Ignore focus errors
        }
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================

    /**
     * Create a modal overlay.
     * 
     * @param {string} className - Additional CSS class
     * @returns {HTMLElement} Modal element
     */
    function createModal(className) {
        var overlay = DomUtils.createDiv('modal' + (className ? ' ' + className : ''));
        overlay.style.display = 'none';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        
        var content = DomUtils.createDiv('modal-content');
        content.setAttribute('tabindex', '-1');
        overlay.appendChild(content);

        return overlay;
    }

    /**
     * Show a modal.
     * Clears any pending hide timer for this modal.
     * Increments generation to invalidate stale operations.
     * Saves current focus and sets focus to modal.
     * 
     * @param {HTMLElement} modal - Modal element
     */
    function showModal(modal) {
        if (!modal) return;

        var state = _getModalState(modal);

        // Bump generation to invalidate any stale close/hide operations
        state.generation++;

        // Clear any pending hide timer
        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
        }

        // Cancel any pending animation frame
        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }

        // Resolve any pending hide promises (they are superseded)
        if (state.hideResolvers.length > 0) {
            var resolvers = state.hideResolvers;
            state.hideResolvers = [];
            resolvers.forEach(function(resolve) {
                try {
                    resolve();
                } catch (e) {
                    // Ignore resolver errors
                }
            });
        }

        // Save current focus before showing
        _saveFocus(modal);

        modal.style.display = 'flex';
        document.body.appendChild(modal);

        // Use animation frame with state tracking
        state.isShowing = true;
        state.animationFrame = requestAnimationFrame(function() {
            state.animationFrame = null;
            if (state.isShowing) {
                modal.classList.add('visible');
                // Focus the modal after animation
                setTimeout(function() {
                    _focusModal(modal);
                }, 50);
            }
        });
    }

    /**
     * Hide a modal.
     * Returns a promise that resolves when the animation completes.
     * The modal remains alive (listeners intact) for potential re-showing.
     * Multiple calls to hideModal() on the same modal will chain correctly.
     * 
     * @param {HTMLElement} modal - Modal element
     * @returns {Promise<void>}
     */
    function hideModal(modal) {
        if (!modal) return Promise.resolve();

        var state = _getModalState(modal);

        // Mark as not showing so animation frame won't add .visible
        state.isShowing = false;

        // Cancel any pending animation frame
        if (state.animationFrame) {
            cancelAnimationFrame(state.animationFrame);
            state.animationFrame = null;
        }

        // Clear any existing hide timer
        if (state.hideTimer) {
            clearTimeout(state.hideTimer);
            state.hideTimer = null;
        }

        return new Promise(function(resolve) {
            // Store resolver for potential superseding
            state.hideResolvers.push(resolve);

            modal.classList.remove('visible');

            state.hideTimer = setTimeout(function() {
                state.hideTimer = null;
                modal.style.display = 'none';

                // Restore focus after hiding
                _restoreFocus(modal);

                // Resolve all pending hide promises
                var resolvers = state.hideResolvers;
                state.hideResolvers = [];
                resolvers.forEach(function(r) {
                    try {
                        r();
                    } catch (e) {
                        // Ignore resolver errors
                    }
                });
            }, 300);
        });
    }

    /**
     * Close a modal (remove from DOM).
     * Executes all cleanup functions associated with the modal.
     * After close, the modal is fully destroyed and cannot be re-shown.
     * Uses generation tracking to prevent stale operations from destroying
     * a modal that was re-shown between close and its animation completion.
     * 
     * @param {HTMLElement} modal - Modal element
     * @returns {Promise<void>}
     */
    function closeModal(modal) {
        if (!modal) return Promise.resolve();

        var state = _getModalState(modal);
        var generation = state.generation;

        return hideModal(modal).then(function() {
            // Check if a new show operation happened during the hide animation
            if (state.generation !== generation) {
                // Modal was re-shown - do not destroy it
                return;
            }

            // Execute all cleanup functions for this modal
            if (state.cleanups) {
                state.cleanups.forEach(function(fn) {
                    try {
                        fn();
                    } catch (e) {
                        console.error('Modal cleanup error:', e);
                    }
                });
                state.cleanups = [];
            }

            // Cancel any remaining timer
            if (state.hideTimer) {
                clearTimeout(state.hideTimer);
                state.hideTimer = null;
            }

            // Cancel any remaining animation frame
            if (state.animationFrame) {
                cancelAnimationFrame(state.animationFrame);
                state.animationFrame = null;
            }

            _modalState.delete(modal);

            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        });
    }

    /**
     * Register a cleanup function for a modal.
     * Internal use only - used by modal event setup functions.
     */
    function _registerCleanup(modal, fn) {
        if (!modal) return;
        var state = _getModalState(modal);
        state.cleanups.push(fn);
    }

    /**
     * Setup click-outside to close a modal.
     * Does not prevent the modal from being hidden and re-shown.
     * 
     * @param {HTMLElement} modal - Modal element
     * @param {Function} onClose - Optional callback when closed
     * @returns {Function} Cleanup function
     */
    function modalClickOutside(modal, onClose) {
        if (!modal) return function() {};

        var state = _getModalState(modal);
        
        // Prevent duplicate setup
        if (state.isSetup) {
            console.warn('Modal: modalClickOutside called multiple times on the same modal.');
            return function() {};
        }
        state.isSetup = true;

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
        };

        _registerCleanup(modal, cleanup);

        return cleanup;
    }

    /**
     * Setup escape key to close a modal.
     * 
     * @param {HTMLElement} modal - Modal element
     * @param {Function} onClose - Optional callback when closed
     * @returns {Function} Cleanup function
     */
    function modalEscapeKey(modal, onClose) {
        if (!modal) return function() {};

        var state = _getModalState(modal);
        
        // Prevent duplicate setup
        if (state.isSetup) {
            console.warn('Modal: modalEscapeKey called multiple times on the same modal.');
            return function() {};
        }
        state.isSetup = true;

        var handler = function(e) {
            if (e.key === 'Escape') {
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
        };

        _registerCleanup(modal, cleanup);

        return cleanup;
    }

    /**
     * Setup both click-outside and escape-key for a modal.
     * Convenience function for common case.
     * Must be called only once per modal.
     * 
     * @param {HTMLElement} modal - Modal element
     * @param {Function} onClose - Optional callback when closed
     */
    function modalSetup(modal, onClose) {
        if (!modal) return;

        var state = _getModalState(modal);
        
        // Prevent duplicate setup
        if (state.isSetup) {
            console.warn('Modal: modalSetup called multiple times on the same modal.');
            return;
        }
        state.isSetup = true;

        modalClickOutside(modal, onClose);
        modalEscapeKey(modal, onClose);
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
        modalSetup: modalSetup
    };

})();