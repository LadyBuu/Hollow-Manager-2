/**
 * Regression tests for explicit theme selection and Dark/Light quick switching.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness(options = {}) {
    const storage = {};
    if (options.storedTheme) storage['hollow-manager-theme'] = options.storedTheme;

    const attributes = {};
    const listeners = {};
    const meta = {
        content: '',
        setAttribute: function(name, value) {
            if (name === 'content') this.content = value;
        }
    };
    const root = {
        setAttribute: function(name, value) { attributes[name] = value; },
        removeAttribute: function(name) { delete attributes[name]; }
    };
    const select = {
        value: '',
        addEventListener: function(name, handler) { listeners['select:' + name] = handler; },
        removeEventListener: function(name) { delete listeners['select:' + name]; }
    };
    const button = {
        textContent: '',
        title: '',
        attributes: {},
        addEventListener: function(name, handler) { listeners['button:' + name] = handler; },
        removeEventListener: function(name) { delete listeners['button:' + name]; },
        setAttribute: function(name, value) { this.attributes[name] = value; }
    };
    const document = {
        readyState: 'complete',
        documentElement: root,
        getElementById: function(id) {
            if (id === 'theme-select') return select;
            if (id === 'theme-toggle-btn') return button;
            return null;
        },
        querySelector: function() { return meta; },
        dispatchEvent: function(event) { listeners['document:' + event.type] = event.detail; },
        addEventListener: function() {}
    };
    const mediaQuery = {
        matches: !!options.prefersLight,
        addEventListener: function(name, handler) { listeners['media:' + name] = handler; },
        removeEventListener: function(name) { delete listeners['media:' + name]; }
    };
    const window = {
        matchMedia: function() { return mediaQuery; }
    };
    const localStorage = {
        getItem: function(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
        setItem: function(key, value) { storage[key] = value; },
        removeItem: function(key) { delete storage[key]; }
    };
    function CustomEvent(type, options) {
        this.type = type;
        this.detail = options && options.detail;
    }

    const context = { window, document, localStorage, CustomEvent, console };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', 'js', 'utils', 'theme-manager.js'), 'utf8'),
        context,
        { filename: 'theme-manager.js' }
    );

    return { manager: window.ThemeManager, storage, attributes, listeners, meta, select, button };
}

test('system preference is used when no saved theme exists', function() {
    const { manager, select, attributes } = createHarness({ prefersLight: true });
    assert.equal(manager.getTheme(), 'light');
    assert.equal(select.value, 'light');
    assert.equal(attributes['data-theme'], 'light');
});

test('saved theme takes priority over system preference', function() {
    const { manager, select, attributes } = createHarness({
        storedTheme: 'ukiyo-e',
        prefersLight: false
    });
    assert.equal(manager.getTheme(), 'ukiyo-e');
    assert.equal(select.value, 'ukiyo-e');
    assert.equal(attributes['data-theme'], 'ukiyo-e');
});

test('explicit selection persists and synchronises the document and picker', function() {
    const { manager, storage, select, attributes, meta } = createHarness();
    assert.equal(manager.setTheme('gits'), true);
    assert.equal(manager.getTheme(), 'gits');
    assert.equal(storage['hollow-manager-theme'], 'gits');
    assert.equal(select.value, 'gits');
    assert.equal(attributes['data-theme'], 'gits');
    assert.equal(meta.content, '#07080c');
});

test('quick toggle only switches Dark and Light, including from an art theme', function() {
    const { manager, select, attributes } = createHarness();
    manager.setTheme('vaporwave');

    manager.toggle();
    assert.equal(manager.getTheme(), 'dark');
    assert.equal(select.value, 'dark');
    assert.equal(Object.prototype.hasOwnProperty.call(attributes, 'data-theme'), false);

    manager.toggle();
    assert.equal(manager.getTheme(), 'light');
    assert.equal(select.value, 'light');
    assert.equal(attributes['data-theme'], 'light');
});

test('invalid themes are rejected without changing the current theme', function() {
    const { manager, storage } = createHarness();
    assert.equal(manager.setTheme('not-a-theme'), false);
    assert.equal(manager.getTheme(), 'dark');
    assert.equal(storage['hollow-manager-theme'], undefined);
});

test('clearing the saved preference returns to the system theme', function() {
    const { manager, storage, select } = createHarness({
        storedTheme: 'dada',
        prefersLight: true
    });
    manager.clearPreference();
    assert.equal(manager.getTheme(), 'light');
    assert.equal(select.value, 'light');
    assert.equal(storage['hollow-manager-theme'], undefined);
});

test('picker exposes all twenty supported themes', function() {
    const { manager } = createHarness();
    assert.equal(manager.getThemes().length, 20);
    assert.equal(new Set(manager.getThemes().map(function(theme) { return theme.value; })).size, 20);
});
