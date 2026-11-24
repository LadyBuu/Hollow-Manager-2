/**
 * Regression tests for tab lifecycle recovery.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(tabName) {
    const classes = new Set();
    return {
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name)
        },
        getAttribute: name => name === 'data-tab' ? tabName : null,
        setAttribute: function() {},
        addEventListener: function() {},
        removeEventListener: function() {}
    };
}

function loadTabManager() {
    const containers = {
        first: createElement('first'),
        second: createElement('second')
    };
    const links = [createElement('first'), createElement('second')];
    const nav = {
        querySelectorAll: () => links,
        addEventListener: function() {},
        removeEventListener: function() {}
    };
    const document = {
        readyState: 'loading',
        getElementById: id => id === 'main-nav' ? nav : containers[id.replace('tab-', '')],
        querySelectorAll: selector => selector === '.tab-content' ? Object.values(containers) : [],
        addEventListener: function() {},
        removeEventListener: function() {},
        dispatchEvent: function() {}
    };
    const window = {
        DataLoader: { whenReady: function() {}, getStatus: () => 'loading' },
        location: { hash: '#first' },
        history: {
            replaceState: function(_state, _title, hash) { window.location.hash = hash; },
            pushState: function(_state, _title, hash) { window.location.hash = hash; }
        },
        addEventListener: function() {},
        removeEventListener: function() {}
    };
    const context = {
        window, document,
        CustomEvent: function(type, options) { this.type = type; this.detail = options && options.detail; },
        console: { error: function() {} },
        Array, Object, String
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'tab-manager.js'), 'utf8'),
        context,
        { filename: 'tab-manager.js' }
    );
    return { manager: window.TabManager, containers, links };
}

test('failed destination render leaves the current tab mounted and active', function() {
    const { manager, containers } = loadTabManager();
    let unmountCount = 0;
    let shouldThrow = true;

    manager.register('first', function() {}, function() { unmountCount++; });
    manager.register('second', function() {
        if (shouldThrow) throw new Error('render failed');
    });

    manager.onDataReady({});
    assert.equal(manager.getCurrentTab(), 'first');
    assert.equal(containers.first.classList.contains('active'), true);

    const switched = manager.switchTo('second');

    assert.equal(switched, false);
    assert.equal(manager.getCurrentTab(), 'first');
    assert.equal(containers.first.classList.contains('active'), true);
    assert.equal(containers.second.classList.contains('active'), false);
    assert.equal(unmountCount, 0, 'the active tab must not be unmounted on render failure');

    shouldThrow = false;
    assert.equal(manager.switchTo('second'), true);
    assert.equal(manager.getCurrentTab(), 'second');
    assert.equal(containers.second.classList.contains('active'), true);
    assert.equal(unmountCount, 1);
});
