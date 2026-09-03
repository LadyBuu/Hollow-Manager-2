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
 *   - Moved from dom-utils.js
 *   - Has its own state machine and lifecycle
 *   - Uses DomUtils for DOM operations
 *   - Race-condition safe with generation tracking
 */

(function() {
    'use strict';

    if (window.__modalLoaded) return;
    window.__modalLoaded = true;

    var DomUtils = window.DomUtils || window;

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
                hideResolvers: []
            };
            _modalState.set(modal, state);
        }
        return state;
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================

    function createModal(className) {
        var overlay = DomUtils.createDiv('modal' + (className ? ' ' + className : ''));
        overlay.style.display = 'none';
        var content = DomUtils.createDiv('modal-content');
        overlay.appendChild(content);
        return overlay;
    }

    function showModal(modal) {
        if (!modal) return;

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
                try { resolve(); } catch (e) { /* Ignore */ }
            });
        }

        modal.style.display = 'flex';
        document.body.appendChild(modal);

        state.isShowing = true;
        state.animationFrame = requestAnimationFrame(function() {
            state.animationFrame = null;
            if (state.isShowing) {
                modal.classList.add('visible');
            }
        });
    }

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
            modal.classList.remove('visible');

            state.hideTimer = setTimeout(function() {
                state.hideTimer = null;
                modal.style.display = 'none';

                var resolvers = state.hideResolvers;
                state.hideResolvers = [];
                resolvers.forEach(function(r) {
                    try { r(); } catch (e) { /* Ignore */ }
                });
            }, 300);
        });
    }

    function closeModal(modal) {
        if (!modal) return Promise.resolve();

        var state = _getModalState(modal);
        var generation = state.generation;

        return hideModal(modal).then(function() {
            if (state.generation !== generation) {
                return;
            }

            if (state.cleanups) {
                state.cleanups.forEach(function(fn) {
                    try { fn(); } catch (e) { console.error('Modal cleanup error:', e); }
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

            _modalState.delete(modal);

            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        });
    }

    function _registerCleanup(modal, fn) {
        if (!modal) return;
        var state = _getModalState(modal);
        state.cleanups.push(fn);
    }

    function modalClickOutside(modal, onClose) {
        if (!modal) return function() {};

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

    function modalEscapeKey(modal, onClose) {
        if (!modal) return function() {};

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

    function modalSetup(modal, onClose) {
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
