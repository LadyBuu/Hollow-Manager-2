'use strict';

/**
 * Mutation pipeline regression tests.
 *
 * Run from the repository root with:
 *   node --test tests/mutation-pipeline.test.js
 *
 * Executes the production mutation pipeline in an isolated VM with
 * in-memory persistence and dependency stubs.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const PIPELINE_PATH = path.join(
    __dirname, '..', 'js', 'core', 'mutation-pipeline.js'
);

function createPipelineHarness(options = {}) {
    const state = {
        data: options.data || { counter: 0, records: [] },
        saves: 0,
        logs: [],
        notifications: [],
        save: options.save || function() {
            state.saves++;
            return Promise.resolve(true);
        }
    };

    const window = {
        data: state.data,
        structuredClone: structuredClone,
        ObjectUtils: {
            deepClone: function(value) {
                return structuredClone(value);
            }
        },
        ActivityLog: {
            record: function(message) {
                state.logs.push(message);
            }
        },
        NotificationSystem: {
            notify: function(message, type) {
                state.notifications.push({ message: message, type: type });
            }
        },
        saveData: function() {
            return state.save();
        }
    };

    const context = vm.createContext({
        window,
        Promise,
        console: {
            log: function() {},
            warn: function() {},
            error: function() {}
        }
    });

    vm.runInContext(
        fs.readFileSync(PIPELINE_PATH, 'utf8'),
        context,
        { filename: 'js/core/mutation-pipeline.js', timeout: 5000 }
    );

    return { pipeline: window.MutationPipeline, state: state, window: window };
}

function valid() {
    return { valid: true };
}

test('successful mutation persists once and returns the mutation result', async function() {
    const harness = createPipelineHarness();

    const result = await harness.pipeline.performMutation({
        validate: valid,
        mutate: function(data) {
            data.counter++;
            return { id: 'created-record' };
        },
        logMessage: 'Created record',
        skipNotification: true
    });

    assert.equal(result.success, true);
    assert.deepEqual(
        JSON.parse(JSON.stringify(result.data)),
        { id: 'created-record' }
    );
    assert.equal(harness.state.data.counter, 1);
    assert.equal(harness.state.saves, 1);
    assert.deepEqual(harness.state.logs, ['Created record']);
});

test('validation failure does not mutate, log, or persist', async function() {
    const harness = createPipelineHarness();

    const result = await harness.pipeline.performMutation({
        validate: function() {
            return { valid: false, message: 'Rejected by validation' };
        },
        mutate: function(data) {
            data.counter++;
        },
        skipNotification: true
    });

    assert.equal(result.success, false);
    assert.equal(result.message, 'Rejected by validation');
    assert.equal(harness.state.data.counter, 0);
    assert.equal(harness.state.saves, 0);
    assert.equal(harness.state.logs.length, 0);
});

test('synchronous mutation failure restores the complete snapshot', async function() {
    const harness = createPipelineHarness({
        data: { counter: 4, records: ['original'], nested: { value: 'before' } }
    });

    const result = await harness.pipeline.performMutation({
        validate: valid,
        mutate: function(data) {
            data.counter = 99;
            data.records.push('partial');
            data.nested.value = 'after';
            throw new Error('Mutation exploded');
        },
        skipNotification: true
    });

    assert.equal(result.success, false);
    assert.equal(harness.state.data.counter, 4);
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.state.data)),
        { counter: 4, records: ['original'], nested: { value: 'before' } }
    );
    assert.equal(harness.state.saves, 0);
});

test('asynchronous mutation rejection restores the complete snapshot', async function() {
    const harness = createPipelineHarness({
        data: { counter: 2, records: ['kept'] }
    });

    const result = await harness.pipeline.performMutation({
        validate: valid,
        mutate: async function(data) {
            data.counter = 50;
            data.records.push('temporary');
            await Promise.resolve();
            throw new Error('Async mutation exploded');
        },
        skipNotification: true
    });

    assert.equal(result.success, false);
    assert.equal(harness.state.data.counter, 2);
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.state.data.records)),
        ['kept']
    );
    assert.equal(harness.state.saves, 0);
});

test('persistence failure rolls back data and reports the save stage', async function() {
    const harness = createPipelineHarness({
        data: { counter: 7, records: ['saved'] },
        save: function() {
            harnessState.saves++;
            return Promise.reject(new Error('Disk unavailable'));
        }
    });
    const harnessState = harness.state;
    let failureStage = null;
    let rollbackCalled = false;

    const result = await harness.pipeline.performMutation({
        validate: valid,
        mutate: function(data) {
            data.counter = 8;
            data.records.push('unsaved');
        },
        onFailure: function(error, stage) {
            failureStage = stage;
        },
        onRollback: function() {
            rollbackCalled = true;
        },
        skipNotification: true
    });

    assert.equal(result.success, false);
    assert.match(result.message, /Disk unavailable/);
    assert.equal(failureStage, 'save');
    assert.equal(rollbackCalled, true);
    assert.equal(harness.state.data.counter, 7);
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.state.data.records)),
        ['saved']
    );
});

test('queued mutations execute serially and preserve both updates', async function() {
    const harness = createPipelineHarness();
    const order = [];

    const first = harness.pipeline.performMutation({
        validate: valid,
        mutate: async function(data) {
            order.push('first-start');
            await new Promise(function(resolve) { setTimeout(resolve, 15); });
            data.counter++;
            order.push('first-end');
        },
        skipLog: true,
        skipNotification: true
    });

    const second = harness.pipeline.performMutation({
        validate: valid,
        mutate: function(data) {
            order.push('second');
            data.counter++;
        },
        skipLog: true,
        skipNotification: true
    });

    const results = await Promise.all([first, second]);

    assert.equal(results[0].success, true);
    assert.equal(results[1].success, true);
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);
    assert.equal(harness.state.data.counter, 2);
    assert.equal(harness.state.saves, 2);
});
