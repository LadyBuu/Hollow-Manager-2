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
 *   - DOM manipulation helpers (empty, remove, prepend, insertAfter, etc.)
 *   - Class manipulation helpers
 *   - Scroll helpers
 *   - Visibility helpers
 *   - Style helpers
 * 
 * IMPORTANT:
 *   - THIS IS THE SINGLE SOURCE OF TRUTH for escapeHtml()
 *   - All modules MUST use DomUtils.escapeHtml() - do NOT duplicate
 *   - Functions avoid mutating application/domain state
 *   - DOM mutation is intentional and limited to UI operations
 *   - All user-controlled content must go through escapeHtml()
 *   - Attribute names are NOT sanitised - they must be developer-controlled
 *   - Timing utilities moved to timing-utils.js
 *   - Form utilities moved to form-utils.js
 *   - Modal utilities moved to modal.js
 *   - Notification utilities moved to notification.js
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
     * Check if an element's bounding rectangle intersects the viewport.
     * 
     * NOTE: This checks geometric visibility only. An element can be
     * geometrically visible while being display:none, visibility:hidden,
     * opacity:0, or covered by another element.
     * 
     * @param {HTMLElement} el - Element to check
     * @param {object} options - Options
     * @param {number} options.verticalMargin - Vertical margin in pixels (default: 0)
     * @param {number} options.horizontalMargin - Horizontal margin in pixels (default: 0)
     * @returns {boolean} True if element intersects the viewport
     */
    function isVisible(el, options) {
        if (!el) return false;
        options = options || {};

        var rect = el.getBoundingClientRect();
        var viewHeight = window.innerHeight || document.documentElement.clientHeight;
        var viewWidth = window.innerWidth || document.documentElement.clientWidth;

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
    // LEGACY COMPATIBILITY (Deprecated)
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
        sanitizeCssValue: sanitizeCssValue,

        // Safe HTML
        safeHtml: safeHtml,
        safeAttr: safeAttr,
        safeAttrs: safeAttrs,

        // Element creation
        createElement: createElement,
        createDiv: createDiv,
        createSpan: createSpan,
        createButton: createButton,
        createLabel: createLabel,
        createInput: createInput,
        createSelect: createSelect,
        createOption: createOption,

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
        getStyle: getStyle
    };

})();