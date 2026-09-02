/**
 * utils/dom-utils.js - DOM Utility Functions
 * Shared helper functions for DOM manipulation and HTML escaping
 * Path: utils/dom-utils.js
 * 
 * This module provides:
 *   - HTML escaping for XSS prevention (SINGLE SOURCE OF TRUTH)
 *   - Safe element creation with textContent
 *   - DOM traversal helpers
 *   - Event delegation helpers
 *   - Modal lifecycle management (with proper cleanup and race prevention)
 *   - Notification helpers
 *   - Form helpers with consistent checkbox/radio semantics
 *   - Throttle utility
 *   - Scroll helpers
 *   - Visibility helpers
 * 
 * IMPORTANT:
 *   - THIS IS THE SINGLE SOURCE OF TRUTH for escapeHtml()
 *   - All modules MUST use DomUtils.escapeHtml() - do NOT duplicate
 *   - Functions avoid mutating application/domain state
 *   - DOM mutation is intentional and limited to UI operations
 *   - All user-controlled content must go through escapeHtml()
 *   - Attribute names are NOT sanitised - they must be developer-controlled
 *   - debounce() is NOT provided here (use CoreUtils.debounce if needed)
 *   - This module is UI-focused, domain utilities belong in core-utils.js
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__domUtilsLoaded) {
        return;
    }
    window.__domUtilsLoaded = true;

    // ============================================================
    // HTML ESCAPING - XSS PREVENTION (SINGLE SOURCE OF TRUTH)
    // ============================================================

    /**
     * Escape HTML special characters to prevent XSS.
     * Use for ALL user-controlled content before inserting into HTML.
     * 
     * @param {*} value - Value to escape
     * @returns {string} Escaped string
     * 
     * USAGE:
     *   var safe = DomUtils.escapeHtml(userInput);
     *   element.innerHTML = '<div>' + safe + '</div>';
     *   // OR use textContent for even safer insertion:
     *   element.textContent = userInput; // No escaping needed
     */
    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }

        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    /**
     * Escape HTML for use in attribute values.
     * More restrictive than escapeHtml for attribute contexts.
     * 
     * @param {*} value - Value to escape
     * @returns {string} Escaped string safe for attribute values
     */
    function escapeAttribute(value) {
        if (value === undefined || value === null) {
            return '';
        }

        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;')
            .replace(/\//g, '&#x2F;');
    }

    /**
     * Encode a value for use as a URL component or query parameter.
     * This does not validate URL schemes or make an entire URL safe.
     * For complete URLs from users, validate the scheme separately.
     * 
     * @param {*} value - Value to encode
     * @returns {string} URL-encoded string
     */
    function encodeUrlComponent(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return encodeURIComponent(String(value));
    }

    /**
     * Alias for encodeUrlComponent for backward compatibility.
     * @deprecated Use encodeUrlComponent instead.
     */
    function escapeUrl(value) {
        return encodeUrlComponent(value);
    }

    /**
     * Validate that a value is safe for use in CSS.
     * This is a validator for CSS VALUES, not a general-purpose CSS escaper.
     * Allows: hex colors, rgb/rgba, hsl/hsla, safe CSS identifiers.
     * Returns empty string for unsafe values.
     * 
     * @param {*} value - CSS value to sanitise
     * @returns {string} Sanitised value or empty string if unsafe
     */
    function sanitizeCssValue(value) {
        if (value === undefined || value === null) {
            return '';
        }

        var str = String(value);

        // Hex colors: #fff, #ffffff, #ffffffff
        if (/^#[0-9a-fA-F]{3,8}$/.test(str)) {
            return str;
        }

        // rgb() and rgba()
        if (/^rgb(a)?\([\d\s.,%]+\)$/.test(str)) {
            return str;
        }

        // hsl() and hsla()
        if (/^hsl(a)?\([\d\s.,%]+\)$/.test(str)) {
            return str;
        }

        // Safe CSS identifiers (letters, numbers, hyphens, underscores)
        if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(str)) {
            return str;
        }

        return '';
    }

    // ============================================================
    // SAFE ELEMENT CREATION
    // ============================================================

    /**
     * Create a DOM element with text content (safe).
     * Use this instead of innerHTML for user-controlled content.
     * 
     * NOTE: 
     * - text is treated as textContent (safe, automatically escaped)
     * - className and attribute names must be developer-controlled
     * - attribute values are assigned through setAttribute (safe)
     * - Do not pass untrusted attribute names
     * 
     * @param {string} tag - HTML tag name
     * @param {string|string[]} className - CSS class name(s)
     * @param {*} text - Text content (safe, escapes automatically)
     * @param {object} attributes - Key-value pairs of attributes
     * @returns {HTMLElement}
     */
    function createElement(tag, className, text, attributes) {
        var el = document.createElement(tag);
        if (className) {
            if (Array.isArray(className)) {
                el.className = className.join(' ');
            } else {
                el.className = className;
            }
        }
        if (text !== undefined && text !== null) {
            el.textContent = text;
        }
        if (attributes) {
            for (var key in attributes) {
                if (Object.prototype.hasOwnProperty.call(attributes, key)) {
                    // Attribute names must be developer-controlled
                    el.setAttribute(key, attributes[key]);
                }
            }
        }
        return el;
    }

    /**
     * Create a span element.
     */
    function createSpan(className, text, attributes) {
        return createElement('span', className, text, attributes);
    }

    /**
     * Create a div element.
     */
    function createDiv(className, text, attributes) {
        return createElement('div', className, text, attributes);
    }

    /**
     * Create a button element.
     */
    function createButton(className, text, attributes) {
        var el = createElement('button', className, text, attributes);
        el.type = (attributes && attributes.type) || 'button';
        return el;
    }

    /**
     * Create a label element.
     */
    function createLabel(className, text, attributes) {
        return createElement('label', className, text, attributes);
    }

    /**
     * Create an input element.
     */
    function createInput(type, className, value, attributes) {
        var el = document.createElement('input');
        el.type = type || 'text';
        if (className) {
            if (Array.isArray(className)) {
                el.className = className.join(' ');
            } else {
                el.className = className;
            }
        }
        if (value !== undefined && value !== null) {
            el.value = value;
        }
        if (attributes) {
            for (var key in attributes) {
                if (Object.prototype.hasOwnProperty.call(attributes, key)) {
                    el.setAttribute(key, attributes[key]);
                }
            }
        }
        return el;
    }

    /**
     * Create a select element with options.
     */
    function createSelect(className, options, selectedValue, attributes) {
        var el = document.createElement('select');
        if (className) {
            if (Array.isArray(className)) {
                el.className = className.join(' ');
            } else {
                el.className = className;
            }
        }
        if (attributes) {
            for (var key in attributes) {
                if (Object.prototype.hasOwnProperty.call(attributes, key)) {
                    el.setAttribute(key, attributes[key]);
                }
            }
        }

        if (Array.isArray(options)) {
            options.forEach(function(opt) {
                var option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label || opt.text || opt.value;
                if (selectedValue !== undefined && String(opt.value) === String(selectedValue)) {
                    option.selected = true;
                }
                el.appendChild(option);
            });
        }

        return el;
    }

    /**
     * Create an option element.
     */
    function createOption(value, label, selected) {
        var el = document.createElement('option');
        el.value = value;
        el.textContent = label || value;
        if (selected) {
            el.selected = true;
        }
        return el;
    }

    // ============================================================
    // SAFE HTML BUILDING
    // ============================================================

    /**
     * Build HTML with escaped content.
     * Use this for building HTML strings with user-controlled content.
     * 
     * NOTE: All interpolated values are escaped. Static markup belongs
     * in the template literal itself, not in interpolated positions.
     * There is no way to intentionally interpolate raw HTML through
     * this function - that is intentional for security.
     * 
     * @param {TemplateStringsArray} strings - Template strings
     * @param {...*} args - Values to interpolate (auto-escaped)
     * @returns {string} Safe HTML string
     * 
     * USAGE:
     *   var html = DomUtils.safeHtml`<div>${userName}</div>`;
     */
    function safeHtml(strings) {
        var args = Array.prototype.slice.call(arguments, 1);
        var result = '';

        for (var i = 0; i < strings.length; i++) {
            result += strings[i];
            if (i < args.length) {
                result += escapeHtml(args[i]);
            }
        }

        return result;
    }

    /**
     * Build an HTML attribute string with escaped values.
     * NOTE: Attribute name must be developer-controlled.
     * 
     * @param {string} name - Attribute name (developer-controlled)
     * @param {*} value - Attribute value (auto-escaped)
     * @returns {string} Safe attribute string
     */
    function safeAttr(name, value) {
        if (value === undefined || value === null) {
            return '';
        }
        return ' ' + name + '="' + escapeAttribute(value) + '"';
    }

    /**
     * Build multiple HTML attributes with escaped values.
     * NOTE: Attribute names must be developer-controlled.
     * 
     * @param {object} attrs - Key-value pairs of attributes
     * @returns {string} Safe attribute string
     */
    function safeAttrs(attrs) {
        var result = '';
        for (var key in attrs) {
            if (Object.prototype.hasOwnProperty.call(attrs, key)) {
                var value = attrs[key];
                if (value !== undefined && value !== null) {
                    result += ' ' + key + '="' + escapeAttribute(value) + '"';
                }
            }
        }
        return result;
    }

    // ============================================================
    // DOM TRAVERSAL
    // ============================================================

    /**
     * Find the closest ancestor matching a selector.
     * Defensively handles non-Element event targets.
     * 
     * @param {HTMLElement} el - Starting element
     * @param {string} selector - CSS selector
     * @returns {HTMLElement|null} Closest ancestor or null
     */
    function closest(el, selector) {
        if (!el) return null;
        if (typeof el.closest === 'function') {
            return el.closest(selector);
        }

        // Fallback for older browsers
        var current = el;
        while (current) {
            if (current.matches && current.matches(selector)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    /**
     * Find all descendants matching a selector.
     * 
     * @param {HTMLElement} el - Parent element
     * @param {string} selector - CSS selector
     * @returns {HTMLElement[]} Array of matching elements
     */
    function findAll(el, selector) {
        if (!el) return [];
        return Array.from(el.querySelectorAll(selector));
    }

    /**
     * Find the first descendant matching a selector.
     * 
     * @param {HTMLElement} el - Parent element
     * @param {string} selector - CSS selector
     * @returns {HTMLElement|null} First matching element or null
     */
    function findOne(el, selector) {
        if (!el) return null;
        return el.querySelector(selector);
    }

    /**
     * Get the data attribute value from an element.
     * 
     * @param {HTMLElement} el - Element
     * @param {string} key - Data attribute key (without 'data-')
     * @returns {string|null} Attribute value or null
     */
    function getData(el, key) {
        if (!el) return null;
        return el.dataset ? el.dataset[key] : null;
    }

    /**
     * Set the data attribute value on an element.
     * 
     * @param {HTMLElement} el - Element
     * @param {string} key - Data attribute key (without 'data-')
     * @param {*} value - Value to set
     */
    function setData(el, key, value) {
        if (!el) return;
        if (el.dataset) {
            el.dataset[key] = value;
        }
    }

    /**
     * Remove a data attribute from an element.
     * 
     * @param {HTMLElement} el - Element
     * @param {string} key - Data attribute key (without 'data-')
     */
    function removeData(el, key) {
        if (!el) return;
        if (el.dataset) {
            delete el.dataset[key];
        }
    }

    /**
     * Check if an element matches a selector.
     * 
     * @param {HTMLElement} el - Element
     * @param {string} selector - CSS selector
     * @returns {boolean} True if matches
     */
    function matches(el, selector) {
        if (!el) return false;
        if (typeof el.matches === 'function') {
            return el.matches(selector);
        }
        return false;
    }

    // ============================================================
    // EVENT HELPERS
    // ============================================================

    /**
     * Delegate events to a parent element.
     * Defensively handles non-Element event targets.
     * 
     * @param {HTMLElement} parent - Parent element for delegation
     * @param {string} selector - CSS selector for target elements
     * @param {string} eventName - Event name (e.g., 'click')
     * @param {Function} handler - Event handler (receives event and matched element)
     * @returns {Function} Cleanup function to remove listener
     */
    function delegate(parent, selector, eventName, handler) {
        if (!parent || !selector || !eventName || typeof handler !== 'function') {
            return function() {};
        }

        function wrappedHandler(e) {
            var target = e.target;

            // Defensive: event target might not be an Element
            if (target && target.nodeType !== 1) {
                target = target.parentElement;
            }

            if (!target) return;

            var matched = target.closest ? target.closest(selector) : closest(target, selector);
            if (matched && parent.contains(matched)) {
                handler(e, matched);
            }
        }

        parent.addEventListener(eventName, wrappedHandler);

        // Return cleanup function
        return function() {
            parent.removeEventListener(eventName, wrappedHandler);
        };
    }

    /**
     * Create a throttled function (leading-edge).
     * Calls made during the cooldown are discarded.
     * 
     * @param {Function} fn - Function to throttle
     * @param {number} limit - Throttle limit in milliseconds
     * @returns {Function} Throttled function
     */
    function throttle(fn, limit) {
        var inThrottle = false;
        var lastResult = null;

        return function() {
            var context = this;
            var args = arguments;

            if (!inThrottle) {
                inThrottle = true;
                lastResult = fn.apply(context, args);
                setTimeout(function() {
                    inThrottle = false;
                }, limit);
            }

            return lastResult;
        };
    }

    /**
     * Create a debounced function.
     * Calls made during the wait period reset the timer.
     * 
     * @param {Function} fn - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Debounced function
     */
    function debounce(fn, wait) {
        var timer = null;

        return function() {
            var context = this;
            var args = arguments;

            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            timer = setTimeout(function() {
                timer = null;
                fn.apply(context, args);
            }, wait);
        };
    }

    /**
     * Run a function once.
     * 
     * @param {Function} fn - Function to run once
     * @returns {Function} Function that runs only once
     */
    function once(fn) {
        var called = false;
        var result = null;

        return function() {
            if (!called) {
                called = true;
                result = fn.apply(this, arguments);
            }
            return result;
        };
    }

    // ============================================================
    // DOM MANIPULATION
    // ============================================================

    /**
     * Remove all children from an element.
     * 
     * @param {HTMLElement} el - Element to empty
     */
    function empty(el) {
        if (!el) return;
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    /**
     * Remove an element from the DOM.
     * 
     * @param {HTMLElement} el - Element to remove
     */
    function remove(el) {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    /**
     * Insert an element as the first child.
     * 
     * @param {HTMLElement} parent - Parent element
     * @param {HTMLElement} child - Child element to prepend
     */
    function prepend(parent, child) {
        if (!parent || !child) return;
        parent.insertBefore(child, parent.firstChild);
    }

    /**
     * Insert an element after another.
     * 
     * @param {HTMLElement} reference - Reference element
     * @param {HTMLElement} child - Child element to insert
     */
    function insertAfter(reference, child) {
        if (!reference || !child) return;
        var parent = reference.parentNode;
        if (parent) {
            parent.insertBefore(child, reference.nextSibling);
        }
    }

    /**
     * Insert an element before another.
     * 
     * @param {HTMLElement} reference - Reference element
     * @param {HTMLElement} child - Child element to insert
     */
    function insertBefore(reference, child) {
        if (!reference || !child) return;
        var parent = reference.parentNode;
        if (parent) {
            parent.insertBefore(child, reference);
        }
    }

    /**
     * Replace an element with another.
     * 
     * @param {HTMLElement} oldEl - Element to replace
     * @param {HTMLElement} newEl - Replacement element
     */
    function replace(oldEl, newEl) {
        if (!oldEl || !newEl) return;
        var parent = oldEl.parentNode;
        if (parent) {
            parent.replaceChild(newEl, oldEl);
        }
    }

    /**
     * Toggle a class on an element.
     * 
     * @param {HTMLElement} el - Element
     * @param {string} className - CSS class name
     * @param {boolean} force - Optional force state
     */
    function toggleClass(el, className, force) {
        if (!el) return;
        if (force !== undefined) {
            el.classList.toggle(className, force);
        } else {
            el.classList.toggle(className);
        }
    }

    /**
     * Add a class to an element.
     * 
     * @param {HTMLElement} el - Element
     * @param {string|string[]} className - CSS class name(s)
     */
    function addClass(el, className) {
        if (!el) return;
        if (Array.isArray(className)) {
            className.forEach(function(c) { el.classList.add(c); });
        } else {
            el.classList.add(className);
        }
    }

    /**
     * Remove a class from an element.
     * 
     * @param {HTMLElement} el - Element
     * @param {string|string[]} className - CSS class name(s)
     */
    function removeClass(el, className) {
        if (!el) return;
        if (Array.isArray(className)) {
            className.forEach(function(c) { el.classList.remove(c); });
        } else {
            el.classList.remove(className);
        }
    }

    /**
     * Check if an element has a class.
     * 
     * @param {HTMLElement} el - Element
     * @param {string} className - CSS class name
     * @returns {boolean} True if has class
     */
    function hasClass(el, className) {
        if (!el) return false;
        return el.classList.contains(className);
    }

    // ============================================================
    // SCROLL HELPERS
    // ============================================================

    /**
     * Scroll an element into view smoothly.
     * 
     * @param {HTMLElement} el - Element to scroll to
     * @param {object} options - Scroll options (block, behavior, etc.)
     */
    function scrollIntoView(el, options) {
        if (!el) return;
        options = options || { block: 'nearest', behavior: 'smooth' };
        try {
            el.scrollIntoView(options);
        } catch (e) {
            // Fallback for older browsers
            el.scrollIntoView(false);
        }
    }

    /**
     * Scroll to the top of the page.
     * 
     * @param {object} options - Scroll options
     */
    function scrollToTop(options) {
        options = options || { behavior: 'smooth' };
        try {
            window.scrollTo({ top: 0, left: 0, behavior: options.behavior });
        } catch (e) {
            window.scrollTo(0, 0);
        }
    }

    // ============================================================
    // VISIBILITY HELPERS
    // ============================================================

    /**
     * Check if an element is visible in the viewport.
     * 
     * @param {HTMLElement} el - Element to check
     * @param {object} options - IntersectionObserver options
     * @returns {boolean} True if visible
     */
    function isVisible(el, options) {
        if (!el) return false;
        options = options || {};

        var rect = el.getBoundingClientRect();
        var viewHeight = window.innerHeight || document.documentElement.clientHeight;
        var viewWidth = window.innerWidth || document.documentElement.clientWidth;

        var threshold = options.threshold || 0;
        var verticalMargin = options.verticalMargin || 0;
        var horizontalMargin = options.horizontalMargin || 0;

        var top = rect.top + verticalMargin;
        var bottom = rect.bottom - verticalMargin;
        var left = rect.left + horizontalMargin;
        var right = rect.right - horizontalMargin;

        return top < viewHeight && bottom > 0 && left < viewWidth && right > 0;
    }

    /**
     * Check if an element is fully visible in the viewport.
     * 
     * @param {HTMLElement} el - Element to check
     * @returns {boolean} True if fully visible
     */
    function isFullyVisible(el) {
        if (!el) return false;

        var rect = el.getBoundingClientRect();
        var viewHeight = window.innerHeight || document.documentElement.clientHeight;
        var viewWidth = window.innerWidth || document.documentElement.clientWidth;

        return rect.top >= 0 && rect.bottom <= viewHeight &&
               rect.left >= 0 && rect.right <= viewWidth;
    }

    // ============================================================
    // STYLE HELPERS
    // ============================================================

    /**
     * Safely set inline styles on an element.
     * 
     * @param {HTMLElement} el - Element
     * @param {object} styles - Key-value pairs of CSS properties
     */
    function setStyles(el, styles) {
        if (!el || !styles) return;
        for (var key in styles) {
            if (Object.prototype.hasOwnProperty.call(styles, key)) {
                el.style[key] = styles[key];
            }
        }
    }

    /**
     * Get computed style value.
     * 
     * @param {HTMLElement} el - Element
     * @param {string} property - CSS property name
     * @returns {string} Computed style value
     */
    function getStyle(el, property) {
        if (!el) return '';
        try {
            return window.getComputedStyle(el).getPropertyValue(property);
        } catch (e) {
            return '';
        }
    }

    // ============================================================
    // MODAL HELPERS - With proper lifecycle management
    // ============================================================

    // Internal store for modal state
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

    /**
     * Create a modal overlay.
     * 
     * @param {string} className - Additional CSS class
     * @returns {HTMLElement} Modal element
     */
    function createModal(className) {
        var overlay = createDiv('modal' + (className ? ' ' + className : ''));
        overlay.style.display = 'none';

        var content = createDiv('modal-content');
        overlay.appendChild(content);

        return overlay;
    }

    /**
     * Show a modal.
     * Clears any pending hide timer for this modal.
     * Increments generation to invalidate stale operations.
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

        modal.style.display = 'flex';
        document.body.appendChild(modal);

        // Use animation frame with state tracking
        state.isShowing = true;
        state.animationFrame = requestAnimationFrame(function() {
            state.animationFrame = null;
            if (state.isShowing) {
                modal.classList.add('visible');
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
     * 
     * @param {HTMLElement} modal - Modal element
     * @param {Function} onClose - Optional callback when closed
     */
    function modalSetup(modal, onClose) {
        modalClickOutside(modal, onClose);
        modalEscapeKey(modal, onClose);
    }

    // ============================================================
    // NOTIFICATION HELPERS
    // ============================================================

    /**
     * Create a notification toast.
     * 
     * @param {string} message - Notification message
     * @param {string} type - 'success' | 'error' | 'warning' | 'info'
     * @param {number} duration - Duration in ms (0 = persistent)
     * @returns {HTMLElement} Toast element (for manual dismissal)
     */
    function createToast(message, type, duration) {
        type = type || 'info';
        duration = duration || 3000;

        var toast = createDiv('toast ' + type);
        toast.textContent = message;

        document.body.appendChild(toast);

        // Show with animation
        requestAnimationFrame(function() {
            toast.classList.add('visible');
        });

        // Auto-hide
        if (duration > 0) {
            var timer = setTimeout(function() {
                toast.classList.remove('visible');
                setTimeout(function() {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }, duration);

            // Store timer for potential cancellation
            toast._hideTimer = timer;
        }

        return toast;
    }

    /**
     * Show a success notification.
     */
    function showSuccess(message, duration) {
        return createToast(message, 'success', duration);
    }

    /**
     * Show an error notification.
     */
    function showError(message, duration) {
        return createToast(message, 'error', duration);
    }

    /**
     * Show a warning notification.
     */
    function showWarning(message, duration) {
        return createToast(message, 'warning', duration);
    }

    /**
     * Show an info notification.
     */
    function showInfo(message, duration) {
        return createToast(message, 'info', duration);
    }

    // ============================================================
    // FORM HELPERS - With consistent checkbox/radio semantics
    // ============================================================

    /**
     * Get a form field value safely.
     * - Single checkbox → boolean
     * - Radio → boolean for this specific input (use getFormData for group value)
     * - Multi-select → array of selected values
     * - Other inputs → string value
     * 
     * @param {string} id - Element ID
     * @returns {*} Field value
     */
    function getField(id) {
        var el = document.getElementById(id);
        if (!el) return null;

        // Checkbox: return boolean
        if (el.type === 'checkbox') {
            return el.checked;
        }

        // Radio: return boolean for this specific input
        if (el.type === 'radio') {
            return el.checked;
        }

        // Multi-select: return array of selected values
        if (el.tagName === 'SELECT' && el.multiple) {
            var values = [];
            for (var i = 0; i < el.options.length; i++) {
                if (el.options[i].selected) {
                    values.push(el.options[i].value);
                }
            }
            return values;
        }

        return el.value;
    }

    /**
     * Set a form field value safely.
     * 
     * @param {string} id - Element ID
     * @param {*} value - Value to set
     */
    function setField(id, value) {
        var el = document.getElementById(id);
        if (!el) return;

        // Checkbox: treat as boolean
        if (el.type === 'checkbox') {
            el.checked = !!value;
            return;
        }

        // Radio: set checked if value matches
        if (el.type === 'radio') {
            el.checked = String(el.value) === String(value);
            return;
        }

        // Multi-select: treat as array
        if (el.tagName === 'SELECT' && el.multiple) {
            if (Array.isArray(value)) {
                for (var i = 0; i < el.options.length; i++) {
                    el.options[i].selected = value.indexOf(el.options[i].value) !== -1;
                }
            }
            return;
        }

        el.value = value !== undefined && value !== null ? value : '';
    }

    /**
     * Get all form data as an object.
     * Semantics:
     * - Radio groups: returns the selected value (string), or null if none selected
     * - Single checkbox: returns boolean (true/false)
     * - Multiple checkboxes with same name: returns array of selected values (empty array if none)
     * - Multi-select: returns array of selected values (empty array if none)
     * - Other inputs: returns string value
     * 
     * @param {HTMLFormElement} form - Form element
     * @returns {object} Form data object
     */
    function getFormData(form) {
        if (!form) return {};

        var data = {};
        var elements = form.elements;
        var radioGroups = Object.create(null);
        var checkboxGroups = Object.create(null);

        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (!el.name) continue;

            // Radio: collect by name, track selected value
            if (el.type === 'radio') {
                if (!radioGroups[el.name]) {
                    radioGroups[el.name] = { selected: null, found: false };
                }
                if (el.checked) {
                    radioGroups[el.name].selected = el.value;
                    radioGroups[el.name].found = true;
                }
                continue;
            }

            // Checkbox: collect by name with count and values
            if (el.type === 'checkbox') {
                if (!checkboxGroups[el.name]) {
                    checkboxGroups[el.name] = {
                        count: 0,
                        values: []
                    };
                }
                checkboxGroups[el.name].count++;
                if (el.checked) {
                    checkboxGroups[el.name].values.push(el.value);
                }
                continue;
            }

            // Multi-select: array of selected values
            if (el.tagName === 'SELECT' && el.multiple) {
                var values = [];
                for (var j = 0; j < el.options.length; j++) {
                    if (el.options[j].selected) {
                        values.push(el.options[j].value);
                    }
                }
                data[el.name] = values;
                continue;
            }

            // Regular input: string value
            data[el.name] = el.value;
        }

        // Merge radio groups
        for (var name in radioGroups) {
            if (Object.prototype.hasOwnProperty.call(radioGroups, name)) {
                data[name] = radioGroups[name].selected;
            }
        }

        // Merge checkbox groups with correct semantics
        for (var name in checkboxGroups) {
            if (Object.prototype.hasOwnProperty.call(checkboxGroups, name)) {
                var group = checkboxGroups[name];

                if (group.count === 1) {
                    // Single checkbox → boolean
                    data[name] = group.values.length > 0;
                } else {
                    // Multiple checkboxes → array of selected values
                    data[name] = group.values;
                }
            }
        }

        return data;
    }

    /**
     * Set form data from an object.
     * Semantics mirror getFormData:
     * - Radio groups: set the radio with matching value
     * - Single checkbox: boolean → checked state
     * - Multiple checkboxes: array → check matching values
     * - Multi-select: array → select matching values
     * 
     * @param {HTMLFormElement} form - Form element
     * @param {object} data - Data object
     */
    function setFormData(form, data) {
        if (!form || !data) return;

        var elements = form.elements;

        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (!el.name) continue;
            if (!(el.name in data)) continue;

            var value = data[el.name];

            // Radio: set checked if value matches
            if (el.type === 'radio') {
                el.checked = String(el.value) === String(value);
                continue;
            }

            // Checkbox: set checked based on value
            if (el.type === 'checkbox') {
                if (Array.isArray(value)) {
                    // Array → check if this value is in the array
                    el.checked = value.indexOf(el.value) !== -1;
                } else {
                    // Boolean → direct checked state
                    el.checked = !!value;
                }
                continue;
            }

            // Multi-select: treat as array
            if (el.tagName === 'SELECT' && el.multiple) {
                if (Array.isArray(value)) {
                    for (var j = 0; j < el.options.length; j++) {
                        el.options[j].selected = value.indexOf(el.options[j].value) !== -1;
                    }
                }
                continue;
            }

            el.value = value !== undefined && value !== null ? value : '';
        }
    }

    /**
     * Reset a form.
     * 
     * @param {HTMLFormElement} form - Form element
     */
    function resetForm(form) {
        if (!form) return;
        form.reset();
    }

    /**
     * Validate that a field has a value.
     * Semantics:
     * - String: non-empty
     * - Boolean: true (for checkboxes)
     * - Array: at least one element selected
     * - Number: not NaN
     * 
     * @param {string} id - Element ID
     * @returns {boolean} True if field has value
     */
    function validateRequired(id) {
        var value = getField(id);

        if (value === null || value === undefined) {
            return false;
        }

        if (typeof value === 'boolean') {
            return value;
        }

        if (Array.isArray(value)) {
            return value.length > 0;
        }

        return String(value).trim() !== '';
    }

    /**
     * Validate that a field is a number.
     * 
     * @param {string} id - Element ID
     * @returns {boolean} True if field is a number
     */
    function validateNumber(id) {
        var value = getField(id);
        if (value === null || value === undefined || value === '') return false;
        return !isNaN(Number(value));
    }

    /**
     * Validate that a field is an integer.
     * 
     * @param {string} id - Element ID
     * @returns {boolean} True if field is an integer
     */
    function validateInteger(id) {
        var value = getField(id);
        if (value === null || value === undefined || value === '') return false;
        return Number.isInteger(Number(value));
    }

    /**
     * Validate that a field is in a range.
     * 
     * @param {string} id - Element ID
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {boolean} True if field is in range
     */
    function validateRange(id, min, max) {
        var value = getField(id);
        if (value === null || value === undefined || value === '') return false;
        var num = Number(value);
        return !isNaN(num) && num >= min && num <= max;
    }

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    /**
     * Legacy alias for escapeHtml.
     * @deprecated Use DomUtils.escapeHtml() instead.
     */
    window.escapeHtml = escapeHtml;

    /**
     * Legacy alias for escapeAttribute.
     * @deprecated Use DomUtils.escapeAttribute() instead.
     */
    window.escapeAttribute = escapeAttribute;

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DomUtils = {
        // Escaping (SINGLE SOURCE OF TRUTH)
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute,
        encodeUrlComponent: encodeUrlComponent,
        escapeUrl: escapeUrl, // Deprecated alias
        sanitizeCssValue: sanitizeCssValue,

        // Element creation
        createElement: createElement,
        createDiv: createDiv,
        createSpan: createSpan,
        createButton: createButton,
        createLabel: createLabel,
        createInput: createInput,
        createSelect: createSelect,
        createOption: createOption,

        // Safe HTML
        safeHtml: safeHtml,
        safeAttr: safeAttr,
        safeAttrs: safeAttrs,

        // Traversal
        closest: closest,
        findAll: findAll,
        findOne: findOne,
        getData: getData,
        setData: setData,
        removeData: removeData,
        matches: matches,

        // Events
        delegate: delegate,
        throttle: throttle,
        debounce: debounce,
        once: once,

        // Manipulation
        empty: empty,
        remove: remove,
        prepend: prepend,
        insertAfter: insertAfter,
        insertBefore: insertBefore,
        replace: replace,
        toggleClass: toggleClass,
        addClass: addClass,
        removeClass: removeClass,
        hasClass: hasClass,

        // Scroll
        scrollIntoView: scrollIntoView,
        scrollToTop: scrollToTop,

        // Visibility
        isVisible: isVisible,
        isFullyVisible: isFullyVisible,

        // Style
        setStyles: setStyles,
        getStyle: getStyle,

        // Modal helpers
        createModal: createModal,
        showModal: showModal,
        hideModal: hideModal,
        closeModal: closeModal,
        modalClickOutside: modalClickOutside,
        modalEscapeKey: modalEscapeKey,
        modalSetup: modalSetup,

        // Notification helpers
        createToast: createToast,
        showSuccess: showSuccess,
        showError: showError,
        showWarning: showWarning,
        showInfo: showInfo,

        // Form helpers
        getField: getField,
        setField: setField,
        getFormData: getFormData,
        setFormData: setFormData,
        resetForm: resetForm,
        validateRequired: validateRequired,
        validateNumber: validateNumber,
        validateInteger: validateInteger,
        validateRange: validateRange
    };


})();
