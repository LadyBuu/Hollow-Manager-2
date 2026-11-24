'use strict';

/**
 * Character deletion cascade regression tests.
 * Run with: node --test tests/character-deletion.test.js
 *
 * Loads the production CharacterCRUD and MutationPipeline modules
 * into an isolated VM. Domain cascade dependencies are explicit stubs.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function createHarness(options = {}) {
    const data = structuredClone(options.data || {
        characters: [
            { id: 'delete-me', firstName: 'Ada', lastName: 'Example', parentIds: [] },
            { id: 'keep-me', firstName: 'Bea', lastName: 'Example', parentIds: ['delete-me'] }
        ],
        teams: [{ id: 'team-1', members: [{ characterId: 'delete-me' }, { characterId: 'keep-me' }] }],
        departments: [{ id: 'dept-1', headId: 'delete-me', members: ['delete-me', 'keep-me'] }],
        social: { relationships: [
            { id: 'rel-1', character1: 'delete-me', character2: 'keep-me' },
            { id: 'rel-2', character1: 'keep-me', character2: 'other' }
        ] },
        tournaments: [{ id: 'tournament-1', participants: [
            { characterId: 'delete-me' }, { characterId: 'keep-me' }
        ] }],
        missions: []
    });

    let cascadeCalls = 0;
    const state = { saves: 0, notifications: [], logs: [] };

    const window = {
        data,
        structuredClone,
        ObjectUtils: { deepClone: value => structuredClone(value) },
        ActivityLog: { record: message => state.logs.push(message) },
        NotificationSystem: { notify: (message, type) => state.notifications.push({ message, type }) },
        saveData: () => {
            state.saves++;
            return options.save ? options.save() : Promise.resolve(true);
        },
        IdUtils: { generateId: prefix => prefix + '_test' },
        CharacterConstants: {},
        CharacterQueries: {
            getCharacterById: id => data.characters.find(char => String(char.id) === String(id)) || null,
            getDisplayName: char => [char.firstName, char.lastName].filter(Boolean).join(' '),
            invalidateCharacterIndex: () => {}
        }
    };

    if (options.academyCascade !== 'missing') {
        window.AcademyCascade = {
            characterDeleted: function(appData, id) {
                cascadeCalls++;
                if (options.academyCascade === 'throw') {
                    throw new Error('Academy cleanup failed');
                }
                appData.academy = appData.academy || {};
                appData.academy.deletedCharacterIds = appData.academy.deletedCharacterIds || [];
                appData.academy.deletedCharacterIds.push(id);
                return { modules: ['academy', 'missions', 'tournaments'], details: {} };
            }
        };
    }

    const context = vm.createContext({
        window,
        Promise,
        Date,
        Object,
        Array,
        String,
        Number,
        Math,
        console: { log() {}, warn() {}, error() {} }
    });

    for (const file of [
        'js/core/mutation-pipeline.js',
        'js/modules/characters/character-crud.js'
    ]) {
        vm.runInContext(
            fs.readFileSync(path.join(ROOT, file), 'utf8'),
            context,
            { filename: file, timeout: 5000 }
        );
    }

    return { window, state, cascadeCalls: () => cascadeCalls };
}

test('character deletion removes direct references and invokes academy cascade in one save', async function() {
    const h = createHarness();

    const result = await h.window.CharacterCRUD.delete('delete-me');

    assert.equal(result.success, true);
    assert.deepEqual(h.window.data.characters.map(c => c.id), ['keep-me']);
    assert.deepEqual(h.window.data.teams[0].members, [{ characterId: 'keep-me' }]);
    assert.deepEqual(h.window.data.characters[0].parentIds, []);
    assert.equal(h.window.data.departments[0].headId, null);
    assert.deepEqual(h.window.data.departments[0].members, ['keep-me']);
    assert.deepEqual(h.window.data.social.relationships.map(r => r.id), ['rel-2']);
    assert.deepEqual(h.window.data.tournaments[0].participants, [{ characterId: 'keep-me' }]);
    assert.deepEqual(h.window.data.academy.deletedCharacterIds, ['delete-me']);
    assert.equal(h.cascadeCalls(), 1);
    assert.equal(h.state.saves, 1);
});

test('missing academy cascade aborts deletion instead of committing orphan references', async function() {
    const h = createHarness({ academyCascade: 'missing' });

    const result = await h.window.CharacterCRUD.delete('delete-me');

    assert.equal(result.success, false);
    assert.match(result.message, /AcademyCascade\.characterDeleted/);
    assert.equal(h.window.data.characters.length, 2);
    assert.equal(h.window.data.teams[0].members.length, 2);
    assert.equal(h.window.data.departments[0].headId, 'delete-me');
    assert.equal(h.window.data.social.relationships.length, 2);
    assert.equal(h.window.data.tournaments[0].participants.length, 2);
    assert.equal(h.state.saves, 0);
});

test('academy cascade failure rolls back all earlier domain cleanup', async function() {
    const h = createHarness({ academyCascade: 'throw' });

    const result = await h.window.CharacterCRUD.delete('delete-me');

    assert.equal(result.success, false);
    assert.match(result.message, /Academy cleanup failed/);
    assert.equal(h.window.data.characters.length, 2);
    assert.equal(h.window.data.teams[0].members.length, 2);
    assert.equal(h.window.data.departments[0].headId, 'delete-me');
    assert.equal(h.window.data.social.relationships.length, 2);
    assert.equal(h.window.data.tournaments[0].participants.length, 2);
    assert.equal(h.state.saves, 0);
});
