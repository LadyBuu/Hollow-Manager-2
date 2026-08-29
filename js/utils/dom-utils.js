/**
 * utils/dom-utils.js - DOM Utility Functions
 * Shared helper functions for DOM manipulation and HTML escaping
 * Path: utils/dom-utils.js
 * 
 * This module provides:
 *   - HTML escaping for XSS prevention
 *   - Safe element creation with textContent (safe attribute insertion)
 *   - DOM traversal helpers
 *   - Event delegation helpers
 *   - Modal lifecycle management (with proper cleanup and race prevention)
 *   - Notification helpers
 *   - Form helpers with consistent checkbox/radio semantics
 *   - Throttle utility
 * 
 * IMPORTANT:
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
    // HTML ESCAPING - XSS PREVENTION
    // ============================================================

    /**
     * Escape HTML special characters to prevent XSS.
     * Use for ALL user-controlled content before inserting into HTML.
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
     */
    function findAll(el, selector) {
        if (!el) return [];
        return Array.from(el.querySelectorAll(selector));
    }

    /**
     * Find the first descendant matching a selector.
     */
    function findOne(el, selector) {
        if (!el) return null;
        return el.querySelector(selector);
    }

    /**
     * Get the data attribute value from an element.
     */
    function getData(el, key) {
        if (!el) return null;
        return el.dataset ? el.dataset[key] : null;
    }

    /**
     * Set the data attribute value on an element.
     */
    function setData(el, key, value) {
        if (!el) return;
        if (el.dataset) {
            el.dataset[key] = value;
        }
    }

    /**
     * Remove a data attribute from an element.
     */
    function removeData(el, key) {
        if (!el) return;
        if (el.dataset) {
            delete el.dataset[key];
        }
    }

    // ============================================================
    // EVENT HELPERS
    // ============================================================

    /**
     * Delegate events to a parent element.
     * Defensively handles non-Element event targets.
     */
    function delegate(parent, selector, eventName, handler) {
        if (!parent || !selector || !eventName || typeof handler !== 'function') {
            return;
        }

        parent.addEventListener(eventName, function(e) {
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
        });
    }

    /**
     * Create a throttled function (leading-edge).
     * Calls made during the cooldown are discarded.
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
     * Run a function once.
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
     */
    function empty(el) {
        if (!el) return;
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    /**
     * Remove an element from the DOM.
     */
    function remove(el) {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    /**
     * Insert an element as the first child.
     */
    function prepend(parent, child) {
        if (!parent || !child) return;
        parent.insertBefore(child, parent.firstChild);
    }

    /**
     * Insert an element after another.
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
     */
    function hasClass(el, className) {
        if (!el) return false;
        return el.classList.contains(className);
    }

    // ============================================================
    // MODAL HELPERS - With proper lifecycle management and race prevention
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
     */
    function modalClickOutside(modal, onClose) {
        if (!modal) return;

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

        _registerCleanup(modal, function() {
            modal.removeEventListener('click', handler);
        });
    }

    /**
     * Setup escape key to close a modal.
     * Returns the cleanup function (also registered automatically).
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
     */
    function validateRequired(field) {
        var value = getField(field);

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
     */
    function validateNumber(field) {
        var value = getField(field);
        if (value === null || value === undefined || value === '') return false;
        return !isNaN(Number(value));
    }

    /**
     * Validate that a field is an integer.
     */
    function validateInteger(field) {
        var value = getField(field);
        if (value === null || value === undefined || value === '') return false;
        return Number.isInteger(Number(value));
    }

    /**
     * Validate that a field is in a range.
     */
    function validateRange(field, min, max) {
        var value = getField(field);
        if (value === null || value === undefined || value === '') return false;
        var num = Number(value);
        return !isNaN(num) && num >= min && num <= max;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DomUtils = {
        // Escaping
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute,
        encodeUrlComponent: encodeUrlComponent,
        escapeUrl: escapeUrl, // Deprecated alias for backward compatibility
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

        // Events
        delegate: delegate,
        throttle: throttle,
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
