'use strict';

/**
 * Integration tests using a real IndexedDB implementation (fake-indexeddb).
 * These exercise the production database module and actual IndexedDB
 * transactions rather than a hand-written transaction mock.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');

const SOURCE_PATH = path.join(__dirname, '..', 'js', 'core', 'database.js');

function createIndexedDatabase() {
    let source = fs.readFileSync(SOURCE_PATH, 'utf8');
    const startup = [
        '    ensureDatabaseReady()',
        '        .then(function() { return autoLoadData(); })',
        '        .catch(function(err) {',
        '            _loadError = err;',
        '            _dispatchDataFailure(err);',
        '        });'
    ].join('\n');

    assert.ok(source.includes(startup), 'Database startup block changed; review the harness.');
    source = source.replace(startup, '    // Startup is controlled by this integration test.');

    const close = source.lastIndexOf('})();');
    assert.notEqual(close, -1);
    source = source.slice(0, close) +
        '    window.__testSetData = function(value) { _data = value; window.data = value; };\n' +
        source.slice(close);

    let id = 0;
    const window = {
        TournamentSchema: {
            normaliseTournament: value => value,
            generateRoundId: () => 'round-' + (++id),
            generateMatchId: () => 'match-' + (++id)
        },
        IdUtils: { generateId: prefix => String(prefix || 'id') + '-' + (++id) },
        TeamConstants: {
            parsePeriod: () => null,
            normalizeTeamType: value => value
        },
        CalendarValidation: {
            parseWeek: value => {
                const parsed = Number(value);
                return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
            }
        }
    };
    const context = vm.createContext({
        window,
        indexedDB: new IDBFactory(),
        structuredClone,
        setTimeout,
        clearTimeout,
        console: { log() {}, warn() {}, error() {} }
    });
    vm.runInContext(source, context, { filename: 'js/core/database.js', timeout: 5000 });
    return { window, indexedDBFactory: context.indexedDB };
}

function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = event => reject(event.target.error || new Error('IndexedDB transaction failed'));
        tx.onabort = event => reject(event.target.error || new Error('IndexedDB transaction aborted'));
    });
}

test('real IndexedDB: manual backup, listing and restore survive persisted writes', async function() {
    const app = createIndexedDatabase();
    await app.window.db.ensureDatabaseReady();
    app.database = await app.window.db.openDatabase();

    const original = app.window.db.getEmptyData();
    original.currentYear = 1924;
    original.characters.push({ id: 'original-character', name: 'Original' });
    app.window.__testSetData(original);
    await app.window.db.saveData();

    const backup = await app.window.db.createBackup();
    assert.match(backup.id, /^mainData_backup_manual_/);

    app.window.data.characters[0].name = 'Changed after backup';
    app.window.data.characters.push({ id: 'new-character', name: 'New' });
    await app.window.db.saveData();

    const listed = await app.window.db.listBackups();
    assert.ok(listed.some(item => item.id === backup.id));
    assert.equal(Object.prototype.hasOwnProperty.call(listed.find(item => item.id === backup.id), 'data'), false);

    const restored = await app.window.db.restoreBackup(backup.id);
    assert.equal(restored.characters.length, 1);
    assert.equal(restored.characters[0].name, 'Original');
    assert.equal(app.window.data.characters[0].name, 'Original');

    // Read the persisted mainData record through a separate real transaction.
    const tx = app.database.transaction(['appData'], 'readonly');
    const request = tx.objectStore('appData').get('mainData');
    const persisted = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = event => reject(event.target.error);
    });
    await transactionDone(tx);
    assert.equal(persisted.data.characters[0].name, 'Original');

    const recordsTx = app.database.transaction(['appData'], 'readonly');
    const recordsRequest = recordsTx.objectStore('appData').getAll();
    const records = await new Promise((resolve, reject) => {
        recordsRequest.onsuccess = () => resolve(recordsRequest.result);
        recordsRequest.onerror = event => reject(event.target.error);
    });
    await transactionDone(recordsTx);
    const preRestore = records.find(record => record.id.indexOf('mainData_backup_pre_vrestore_') === 0);
    assert.ok(preRestore, 'current state must be preserved before restoration');
    assert.equal(preRestore.data.characters[0].name, 'Changed after backup');
});

test('real IndexedDB: malformed backup aborts without replacing mainData', async function() {
    const app = createIndexedDatabase();
    await app.window.db.ensureDatabaseReady();
    app.database = await app.window.db.openDatabase();

    const current = app.window.db.getEmptyData();
    current.characters.push({ id: 'keep-me', name: 'Keep me' });
    app.window.__testSetData(current);
    await app.window.db.saveData();

    const writeTx = app.database.transaction(['appData'], 'readwrite');
    writeTx.objectStore('appData').put({
        id: 'mainData_backup_manual_broken',
        data: ['not', 'an', 'object'],
        createdAt: new Date().toISOString(),
        dataVersion: 35
    });
    await transactionDone(writeTx);

    await assert.rejects(
        app.window.db.restoreBackup('mainData_backup_manual_broken'),
        /missing or contains invalid data/
    );

    const readTx = app.database.transaction(['appData'], 'readonly');
    const request = readTx.objectStore('appData').get('mainData');
    const persisted = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = event => reject(event.target.error);
    });
    await transactionDone(readTx);
    assert.equal(persisted.data.characters[0].id, 'keep-me');
});
