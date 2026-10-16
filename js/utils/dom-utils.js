/**
 * utils/dom-utils.js - DOM Utility Functions
 * Shared helper functions for DOM manipulation and HTML escaping
 * Path: utils/dom-utils.js
 *
 * This module provides:
 *   - HTML escaping for XSS prevention (SINGLE SOURCE OF TRUTH)
 *   - Safe HTML building (safeHtml tag, safeAttr, safeAttrs)
 *   - Safe element creation with textContent
 *   - DOM traversal helpers
 *   - Event delegation helpers
 *   - DOM manipulation helpers
 *   - Class, scroll, visibility, and style helpers
 *
 * IMPORTANT:
 *   - THIS IS THE SINGLE SOURCE OF TRUTH for escapeHtml().
 *   - All user-controlled content must go through escapeHtml(),
 *     textContent, or the safeHtml tag.
 *   - Attribute names and URL schemes are validated: a value
 *     passed to safeAttr/createElement for href/src/on* is
 *     checked against an allowlist. Values that would create a
 *     script URL or an inline handler are dropped.
 *   - Function parameters marked "developer-controlled" are still
 *     the caller's responsibility. The guards catch the common
 *     XSS shapes, not every possible one.
 *
 * ESCAPING CONTEXT:
 *   - escapeHtml           HTML text and quoted attribute values
 *   - escapeAttribute      quoted attribute values (extra
 *                          defensive; escapes backticks)
 *   - encodeUrlComponent   URL component or query parameter
 *                          values. Does NOT validate the scheme
 *                          of a full URL.
 *   - sanitizeCssValue     a CSS declaration value. Accepts hex,
 *                          rgb/rgba, hsl/hsla, var(--token),
 *                          a narrow calc() subset, and safe CSS
 *                          keywords. Rejects url(), expression(),
 *                          attr().
 *
 * SAFE HTML COMPOSITION:
 *   safeHtml returns a SafeHtml instance, not a raw string. When
 *   interpolated into another safeHtml template, SafeHtml values
 *   are inserted raw, so nested composition works:
 *
 *     safeHtml`<ul>${items.map(i => safeHtml`<li>${i}</li>`)}</ul>`
 *
 *   Raw user data is always escaped. To insert a raw HTML string
 *   that was NOT produced by safeHtml, wrap it explicitly in
 *   DomUtils.rawHtml(), which is a deliberate escape hatch.
 *
 * NOT SANITISED:
 *   - Attribute names: developer-controlled by contract. The
 *     guard rejects `on*` names, but any other name is set as
 *     given.
 *   - HTML attribute value semantics beyond URL schemes: e.g.
 *     `srcset`, `style` (a full declaration list), and SVG
 *     specific attributes are not parsed.
 */

(function() {
    'use strict';

    if (window.__domUtilsLoaded) {
        return;
    }
    window.__domUtilsLoaded = true;

    // ============================================================
    // SAFE HTML WRAPPER
    // ============================================================

    function SafeHtml(html) {
        this._html = html;
    }
    SafeHtml.prototype.toString = function() {
        return this._html;
    };

    function isSafeHtml(value) {
        return value instanceof SafeHtml;
    }

    function rawHtml(html) {
        return new SafeHtml(String(html));
    }

    // ============================================================
    // HTML ESCAPING - XSS PREVENTION
    // ============================================================

    /**
     * Escape HTML special characters for use in text content or
     * quoted attribute values.
     *
     * Escapes: & < > " '
     * Does NOT escape: ` (backtick has no special meaning in HTML)
     *
     * @param {*} value
     * @returns {string}
     */
    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Escape HTML for use in quoted attribute values.
     *
     * Also escapes backtick, in case the attribute value ends up
     * in a template literal or a JS string downstream.
     *
     * @param {*} value
     * @returns {string}
     */
    function escapeAttribute(value) {
        if (value === undefined || value === null) {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    /**
     * Encode a value for use as a URL component or query parameter.
     * Does NOT validate the scheme of a full URL.
     *
     * @param {*} value
     * @returns {string}
     */
    function encodeUrlComponent(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return encodeURIComponent(String(value));
    }

    // ============================================================
    // CSS VALUE SANITISER
    // ============================================================

    /**
     * Validate a value for use in a CSS declaration.
     *
     * Accepted forms:
     *   - hex colours: #fff, #ffffff, #ffffffff
     *   - rgb() / rgba() with numeric / comma / percent content
     *   - hsl() / hsla() with numeric / comma / percent content
     *   - var(--token) with a single CSS custom property name
     *   - a narrow calc() subset: numbers with units and
     *     var(--token) references, combined with + - * /
     *   - a numeric value with a small set of units
     *     (px, em, rem, %, vh, vw, pt, ch, ex, cm, mm, in)
     *   - a safe CSS identifier (letters, digits, hyphens,
     *     underscores)
     *
     * Rejected: url(), expression(), attr(), and anything else.
     *
     * The `var(--token)` acceptance is critical: the app's
     * theme-aware colours are var() references. A function that
     * rejects var() flattens every themed value to a fallback.
     *
     * @param {*} value
     * @returns {string} Safe value, or '' if unsafe
     */
    function sanitizeCssValue(value) {
        if (value === undefined || value === null) {
            return '';
        }

        var str = String(value).trim();
        if (str === '') return '';

        // Hex colours
        if (/^#[0-9a-fA-F]{3,8}$/.test(str)) {
            return str;
        }

        // rgb() / rgba()
        if (/^rgba?\(\s*[\d\s.,%]+\)$/.test(str)) {
            return str;
        }

        // hsl() / hsla()
        if (/^hsla?\(\s*[\d\s.,%]+\)$/.test(str)) {
            return str;
        }

        // var(--token)
        if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(str)) {
            return str;
        }

        // calc() with a narrow operand set. Rejects nested calc,
        // url(), expression(), attr(), and anything with
        // parentheses other than a single var(--token).
        if (/^calc\(\s*[-+*/\d\s.%a-zA-Z()_-]+\s*\)$/.test(str)) {
            // One more check: the interior must contain only
            // numeric values, units, operators, whitespace, and
            // var(--token) references.
            var interior = str.substring(5, str.length - 1);
            // Reject if it contains a bare word that is not a
            // var() reference or a length unit.
            var tokens = interior.split(/\s*[-+*/]\s*/);
            var safeTokens = true;
            for (var i = 0; i < tokens.length; i++) {
                var tok = tokens[i].trim();
                if (tok === '') { continue; }
                if (/^-?\d+(\.\d+)?(px|em|rem|%|vh|vw|pt|ch|ex|cm|mm|in)?$/.test(tok)) {
                    continue;
                }
                if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(tok)) {
                    continue;
                }
                safeTokens = false;
                break;
            }
            if (safeTokens) {
                return str;
            }
        }

        // Numeric with a small set of units
        if (/^-?\d+(\.\d+)?(px|em|rem|%|vh|vw|pt|ch|ex|cm|mm|in)?$/.test(str)) {
            return str;
        }

        // Safe CSS identifier
        if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(str)) {
            return str;
        }

        return '';
    }

    /**
     * Sanitise a whole `style` attribute string. Splits on `;`,
     * validates each declaration's property name and value
     * through sanitizeCssValue.
     */
    function sanitizeStyleString(styleString) {
        var parts = String(styleString).split(';');
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i].trim();
            if (part === '') continue;
            var colon = part.indexOf(':');
            if (colon === -1) continue;
            var prop = part.substring(0, colon).trim();
            var val = part.substring(colon + 1).trim();
            if (!/^[a-zA-Z-]+$/.test(prop)) continue;
            var safe = sanitizeCssValue(val);
            if (safe !== '') {
                out.push(prop + ': ' + safe);
            }
        }
        return out.join('; ');
    }

    // ============================================================
    // URL SCHEME ALLOWLIST
    // ============================================================

    var SAFE_URL_SCHEMES = [
        'http:', 'https:', 'mailto:', 'tel:', 'data:'
    ];

    var URL_ATTRIBUTES = {
        'href': true,
        'src': true,
        'action': true,
        'formaction': true,
        'poster': true,
        'cite': true,
        'xlink:href': true,
        'ping': true
    };

    /**
     * Return true if the given URL value has an allowed scheme.
     * Relative URLs (no colon before the first slash or query)
     * are allowed.
     */
    function isSafeUrlValue(value) {
        if (value === undefined || value === null) {
            return true;
        }

        var str = String(value).trim();
        if (str === '') {
            return true;
        }

        // Normalise whitespace and control characters that
        // browsers ignore when parsing URLs.
        var normalised = str.replace(/[\s\u0000-\u001F]/g, '');

        // Find a scheme: letters, digits, +, -, . followed by ':'
        var schemeMatch = normalised.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);

        if (!schemeMatch) {
            // No scheme before the first slash/query: relative URL.
            return true;
        }

        var scheme = schemeMatch[1].toLowerCase() + ':';

        for (var i = 0; i < SAFE_URL_SCHEMES.length; i++) {
            if (SAFE_URL_SCHEMES[i] === scheme) {
                return true;
            }
        }

        return false;
    }

    function isEventHandlerName(name) {
        if (typeof name !== 'string') {
            return false;
        }
        return /^on/i.test(name);
    }

    // ============================================================
    // SAFE HTML BUILDING
    // ============================================================

    /**
     * Build HTML with escaped content. Must be used as a tagged
     * template. Interpolated values are escaped unless they are
     * SafeHtml instances (see rawHtml).
     *
     * @param {TemplateStringsArray} strings
     * @param {...*} args
     * @returns {SafeHtml}
     */
    function safeHtml(strings) {
        if (!strings || !strings.raw) {
            throw new Error(
                'DomUtils.safeHtml must be used as a tagged template, ' +
                'e.g. safeHtml`<div>${value}</div>`. It cannot be ' +
                'called as a plain function.'
            );
        }

        var args = Array.prototype.slice.call(arguments, 1);
        var result = '';

        for (var i = 0; i < strings.length; i++) {
            result += strings[i];
            if (i < args.length) {
                var arg = args[i];
                if (isSafeHtml(arg)) {
                    result += arg.toString();
                } else if (Array.isArray(arg)) {
                    for (var j = 0; j < arg.length; j++) {
                        if (isSafeHtml(arg[j])) {
                            result += arg[j].toString();
                        } else {
                            result += escapeHtml(arg[j]);
                        }
                    }
                } else {
                    result += escapeHtml(arg);
                }
            }
        }

        return new SafeHtml(result);
    }

    /**
     * Build a single attribute string with a validated name and an
     * escaped value.
     *
     * @param {string} name - Attribute name (developer-controlled)
     * @param {*} value - Attribute value
     * @returns {string} e.g. ' href="https://example.com"' or ''
     */
    function safeAttr(name, value) {
        if (value === undefined || value === null) {
            return '';
        }
        if (typeof name !== 'string' || name === '') {
            return '';
        }
        if (isEventHandlerName(name)) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(
                    '[DomUtils.safeAttr] refusing event-handler ' +
                    'attribute: ' + name
                );
            }
            return '';
        }
        if (URL_ATTRIBUTES[name.toLowerCase()]) {
            if (!isSafeUrlValue(value)) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(
                        '[DomUtils.safeAttr] refusing unsafe URL in ' +
                        name + ': ' + String(value)
                    );
                }
                return '';
            }
        }
        return ' ' + name + '="' + escapeAttribute(value) + '"';
    }

    function safeAttrs(attrs) {
        if (!attrs || typeof attrs !== 'object') {
            return '';
        }
        var result = '';
        for (var key in attrs) {
            if (!Object.prototype.hasOwnProperty.call(attrs, key)) {
                continue;
            }
            result += safeAttr(key, attrs[key]);
        }
        return result;
    }

    // ============================================================
    // SAFE ELEMENT CREATION
    // ============================================================

    function applyAttributes(el, attributes) {
        if (!attributes) return;

        for (var key in attributes) {
            if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
                continue;
            }

            var value = attributes[key];

            if (value === undefined || value === null) {
                continue;
            }

            if (isEventHandlerName(key)) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(
                        '[DomUtils] refusing event-handler attribute: ' +
                        key
                    );
                }
                continue;
            }

            if (URL_ATTRIBUTES[key.toLowerCase()]) {
                if (!isSafeUrlValue(value)) {
                    if (typeof console !== 'undefined' && console.warn) {
                        console.warn(
                            '[DomUtils] refusing unsafe URL in ' +
                            key + ': ' + String(value)
                        );
                    }
                    continue;
                }
            }

            if (key === 'style' && typeof value === 'string') {
                el.setAttribute('style', sanitizeStyleString(value));
                continue;
            }

            el.setAttribute(key, value);
        }
    }

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

        applyAttributes(el, attributes);

        return el;
    }

    function createSpan(className, text, attributes) {
        return createElement('span', className, text, attributes);
    }

    function createDiv(className, text, attributes) {
        return createElement('div', className, text, attributes);
    }

    function createButton(className, text, attributes) {
        var attrs = attributes ? Object.assign({}, attributes) : {};
        if (attrs.type === undefined) {
            attrs.type = 'button';
        }
        return createElement('button', className, text, attrs);
    }

    function createLabel(className, text, attributes) {
        return createElement('label', className, text, attributes);
    }

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
        applyAttributes(el, attributes);
        return el;
    }

    function createSelect(className, options, selectedValue, attributes) {
        var el = document.createElement('select');
        if (className) {
            if (Array.isArray(className)) {
                el.className = className.join(' ');
            } else {
                el.className = className;
            }
        }
        applyAttributes(el, attributes);

        if (Array.isArray(options)) {
            options.forEach(function(opt) {
                var option = document.createElement('option');
                option.value = opt.value !== undefined &&
                    opt.value !== null
                    ? String(opt.value)
                    : '';
                var label = opt.label !== undefined
                    ? opt.label
                    : (opt.text !== undefined ? opt.text : opt.value);
                option.textContent = label !== undefined &&
                    label !== null
                    ? String(label)
                    : '';

                if (selectedValue !== undefined &&
                    selectedValue !== null &&
                    String(opt.value) === String(selectedValue)) {
                    option.selected = true;
                }
                el.appendChild(option);
            });
        }

        return el;
    }

    function createOption(value, label, selected) {
        var el = document.createElement('option');
        el.value = value !== undefined && value !== null
            ? String(value)
            : '';
        el.textContent = label !== undefined && label !== null
            ? String(label)
            : el.value;
        if (selected) {
            el.selected = true;
        }
        return el;
    }

    // ============================================================
    // DOM TRAVERSAL
    // ============================================================

    function closest(el, selector) {
        if (!el) return null;
        if (typeof el.closest === 'function') {
            return el.closest(selector);
        }
        var current = el;
        while (current) {
            if (current.matches && current.matches(selector)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    function findAll(el, selector) {
        if (!el) return [];
        return Array.from(el.querySelectorAll(selector));
    }

    function findOne(el, selector) {
        if (!el) return null;
        return el.querySelector(selector);
    }

    function getData(el, key) {
        if (!el || !el.dataset) return null;
        var value = el.dataset[key];
        return value === undefined ? null : value;
    }

    function setData(el, key, value) {
        if (!el) return;
        if (value === null) {
            removeData(el, key);
            return;
        }
        if (el.dataset) {
            el.dataset[key] = value;
        }
    }

    function removeData(el, key) {
        if (!el) return;
        if (el.dataset) {
            delete el.dataset[key];
        }
    }

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
     *
     * NOTE: Only works with events that bubble. Delegating
     * 'focus', 'blur', 'mouseenter', or 'mouseleave' will
     * silently never fire; attach those directly.
     *
     * @returns {Function} Cleanup function
     */
    function delegate(parent, selector, eventName, handler) {
        if (!parent || !selector || !eventName ||
            typeof handler !== 'function') {
            return function() {};
        }

        function wrappedHandler(e) {
            var target = e.target;
            if (target && target.nodeType !== 1) {
                target = target.parentElement;
            }
            if (!target) return;

            var matched = target.closest
                ? target.closest(selector)
                : closest(target, selector);

            if (matched && matched !== parent &&
                parent.contains(matched)) {
                handler(e, matched);
            }
        }

        parent.addEventListener(eventName, wrappedHandler);

        return function() {
            parent.removeEventListener(eventName, wrappedHandler);
        };
    }

    // ============================================================
    // DOM MANIPULATION
    // ============================================================

    function empty(el) {
        if (!el) return;
        if (typeof el.replaceChildren === 'function') {
            el.replaceChildren();
            return;
        }
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    function remove(el) {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function prepend(parent, child) {
        if (!parent || !child) return;
        parent.insertBefore(child, parent.firstChild);
    }

    function insertAfter(reference, child) {
        if (!reference || !child) return;
        var parent = reference.parentNode;
        if (parent) {
            parent.insertBefore(child, reference.nextSibling);
        }
    }

    function insertBefore(reference, child) {
        if (!reference || !child) return;
        var parent = reference.parentNode;
        if (parent) {
            parent.insertBefore(child, reference);
        }
    }

    function replace(oldEl, newEl) {
        if (!oldEl || !newEl) return;
        var parent = oldEl.parentNode;
        if (parent) {
            parent.replaceChild(newEl, oldEl);
        }
    }

    function toggleClass(el, className, force) {
        if (!el || !el.classList) return;
        if (force !== undefined) {
            el.classList.toggle(className, force);
        } else {
            el.classList.toggle(className);
        }
    }

    function addClass(el, className) {
        if (!el || !el.classList) return;
        if (Array.isArray(className)) {
            className.forEach(function(c) { el.classList.add(c); });
        } else {
            el.classList.add(className);
        }
    }

    function removeClass(el, className) {
        if (!el || !el.classList) return;
        if (Array.isArray(className)) {
            className.forEach(function(c) {
                el.classList.remove(c);
            });
        } else {
            el.classList.remove(className);
        }
    }

    function hasClass(el, className) {
        if (!el || !el.classList) return false;
        return el.classList.contains(className);
    }

    // ============================================================
    // SCROLL HELPERS
    // ============================================================

    function scrollIntoView(el, options) {
        if (!el) return;
        options = options || {
            block: 'nearest', behavior: 'smooth'
        };
        try {
            el.scrollIntoView(options);
        } catch (e) {
            try {
                el.scrollIntoView(false);
            } catch (e2) {
                // Ignore
            }
        }
    }

    function scrollToTop(options) {
        options = options || { behavior: 'smooth' };
        try {
            window.scrollTo({
                top: 0, left: 0, behavior: options.behavior
            });
        } catch (e) {
            try {
                window.scrollTo(0, 0);
            } catch (e2) {
                // Ignore
            }
        }
    }

    // ============================================================
    // VISIBILITY HELPERS
    // ============================================================

    function isVisible(el, options) {
        if (!el) return false;
        options = options || {};

        var rect = el.getBoundingClientRect();
        var viewHeight = window.innerHeight ||
            document.documentElement.clientHeight;
        var viewWidth = window.innerWidth ||
            document.documentElement.clientWidth;

        var verticalMargin = options.verticalMargin || 0;
        var horizontalMargin = options.horizontalMargin || 0;

        var top = rect.top + verticalMargin;
        var bottom = rect.bottom - verticalMargin;
        var left = rect.left + horizontalMargin;
        var right = rect.right - horizontalMargin;

        return top < viewHeight && bottom > 0 &&
               left < viewWidth && right > 0;
    }

    function isFullyVisible(el) {
        if (!el) return false;

        var rect = el.getBoundingClientRect();
        var viewHeight = window.innerHeight ||
            document.documentElement.clientHeight;
        var viewWidth = window.innerWidth ||
            document.documentElement.clientWidth;

        return rect.top >= 0 && rect.bottom <= viewHeight &&
               rect.left >= 0 && rect.right <= viewWidth;
    }

    // ============================================================
    // STYLE HELPERS
    // ============================================================

    /**
     * Set inline styles on an element.
     *
     * Values are NOT sanitised by default, because callers pass
     * developer-controlled styles. Set values from user input via
     * sanitizeCssValue first.
     */
    function setStyles(el, styles) {
        if (!el || !styles) return;
        for (var key in styles) {
            if (Object.prototype.hasOwnProperty.call(styles, key)) {
                el.style[key] = styles[key];
            }
        }
    }

    function getStyle(el, property) {
        if (!el) return '';
        try {
            return window.getComputedStyle(el)
                .getPropertyValue(property);
        } catch (e) {
            return '';
        }
    }

    // ============================================================
    // LEGACY GLOBALS (deprecated)
    // ============================================================

    (function installLegacyGlobals() {
        var warnedEscapeHtml = false;
        var warnedEscapeAttribute = false;

        Object.defineProperty(window, 'escapeHtml', {
            configurable: true,
            get: function() {
                if (!warnedEscapeHtml) {
                    warnedEscapeHtml = true;
                    if (typeof console !== 'undefined' &&
                        console.warn) {
                        console.warn(
                            '[DomUtils] window.escapeHtml is ' +
                            'deprecated. Use DomUtils.escapeHtml ' +
                            'instead.'
                        );
                    }
                }
                return escapeHtml;
            }
        });

        Object.defineProperty(window, 'escapeAttribute', {
            configurable: true,
            get: function() {
                if (!warnedEscapeAttribute) {
                    warnedEscapeAttribute = true;
                    if (typeof console !== 'undefined' &&
                        console.warn) {
                        console.warn(
                            '[DomUtils] window.escapeAttribute is ' +
                            'deprecated. Use ' +
                            'DomUtils.escapeAttribute instead.'
                        );
                    }
                }
                return escapeAttribute;
            }
        });
    })();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DomUtils = Object.freeze({
        // Escaping
        escapeHtml: escapeHtml,
        escapeAttribute: escapeAttribute,
        encodeUrlComponent: encodeUrlComponent,
        sanitizeCssValue: sanitizeCssValue,

        // Safe HTML
        safeHtml: safeHtml,
        rawHtml: rawHtml,
        SafeHtml: SafeHtml,
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
        getStyle: getStyle,

        // URL safety (exposed for callers that build markup
        // themselves)
        isSafeUrlValue: isSafeUrlValue
    });

})();
