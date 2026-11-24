'use strict';

/**
 * Database migration regression tests.
 *
 * Run from the repository root with:
 *   node --test tests/database-migrations.test.js
 *
 * The database module is browser-oriented and keeps migrateData private.
 * This harness evaluates the real source in an isolated VM, suppressing
 * only its automatic IndexedDB startup and exposing the migration function
 * to this test file. No production test hook is added.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const DATABASE_PATH = path.join(
    __dirname, '..', 'js', 'core', 'database.js'
);

function createDatabaseHarness(options = {}) {
    let source = fs.readFileSync(DATABASE_PATH, 'utf8');

    if (options.dataVersion !== undefined) {
        source = source.replace(
            /var DATA_VERSION = 35;/,
            'var DATA_VERSION = ' + options.dataVersion + ';'
        );
    }

    const startup = [
        '    ensureDatabaseReady()',
        '        .then(function() { return autoLoadData(); })',
        '        .catch(function(err) {',
        '            _loadError = err;',
        '            _dispatchDataFailure(err);',
        '        });'
    ].join('\n');

    assert.ok(
        source.includes(startup),
        'Database startup block changed; update the test harness deliberately.'
    );

    source = source.replace(
        startup,
        '    // Automatic IndexedDB startup is suppressed by the test harness.'
    );

    const close = source.lastIndexOf('})();');
    assert.notEqual(close, -1, 'Database IIFE closing marker not found.');

    source = source.slice(0, close) +
        '    window.__testMigrateData = migrateData;\n' +
        '    window.__testMigrateImportedData = migrateImportedData;\n' +
        '    window.__testGetEmptyData = getEmptyData;\n' +
        '    window.__testWritePreMigrationBackup = writePreMigrationBackup;\n' +
        '    window.__testSetDatabaseState = function(db, status) { _indexedDB = db; _dbStatus = status; };\n' +
        source.slice(close);

    let nextId = 0;
    const window = {
        TournamentSchema: {
            normaliseTournament: function(value) { return value; },
            generateRoundId: function() { return 'round-' + (++nextId); },
            generateMatchId: function() { return 'match-' + (++nextId); }
        },
        IdUtils: {
            generateId: function(prefix) {
                return String(prefix || 'id') + '-' + (++nextId);
            }
        },
        TeamConstants: {
            parsePeriod: function() { return null; },
            normalizeTeamType: function(value) { return value; }
        },
        CalendarValidation: {
            parseWeek: function(value) {
                const parsed = Number(value);
                return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
            }
        }
    };

    const context = vm.createContext({
        window,
        console: {
            log: function() {},
            warn: function() {},
            error: function() {}
        },
        structuredClone,
        setTimeout,
        clearTimeout
    });

    vm.runInContext(source, context, {
        filename: 'js/core/database.js',
        timeout: 5000
    });

    return window;
}

test('every supported starting version migrates to the current version', function() {
    const db = createDatabaseHarness();

    for (let version = 1; version <= 35; version++) {
        const data = db.__testGetEmptyData();
        data._dataVersion = version;

        const originalVersion = db.__testMigrateData(data);

        assert.equal(originalVersion, version, 'original version ' + version);
        assert.equal(data._dataVersion, 35, 'final version from ' + version);
    }
});

test('a missing migration fails instead of silently advancing the version', function() {
    const db = createDatabaseHarness({ dataVersion: 36 });
    const data = db.__testGetEmptyData();
    data._dataVersion = 35;

    assert.throws(
        function() {
            db.__testMigrateData(data);
        },
        /No migration is registered for data version 35/
    );

    assert.equal(
        data._dataVersion,
        35,
        'failed migration must not mark the record as current'
    );
});

test('a database newer than the running application is rejected', function() {
    const db = createDatabaseHarness({ dataVersion: 35 });
    const data = db.__testGetEmptyData();
    data._dataVersion = 36;

    assert.throws(
        function() {
            db.__testMigrateData(data);
        },
        /newer than supported version 35/
    );
});

test('migration registration is contiguous and targets the next version', function() {
    const source = fs.readFileSync(DATABASE_PATH, 'utf8');
    const registrations = new Map();

    for (const match of source.matchAll(
        /case\s+(\d+):\s*migrateToVersion(\d+)\(data\);\s*break;/g
    )) {
        registrations.set(Number(match[1]), Number(match[2]));
    }

    for (let version = 1; version < 35; version++) {
        assert.equal(
            registrations.get(version),
            version + 1,
            'migration ' + version + ' must target ' + (version + 1)
        );
    }

    assert.equal(registrations.size, 34, 'exactly 34 migration steps expected');
});


function createBackupDatabase(options = {}) {
    const transaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: function() {
            return {
                get: function() {
                    const request = { result: options.existing ? { id: 'backup-1' } : null };
                    setImmediate(function() {
                        if (options.getFails) {
                            if (request.onerror) request.onerror();
                            if (transaction.onabort) transaction.onabort();
                            return;
                        }
                        if (request.onsuccess) request.onsuccess();
                        if (options.existing) {
                            if (transaction.oncomplete) transaction.oncomplete();
                            return;
                        }
                        const putRequest = { onerror: null };
                        const originalPut = this.put;
                        if (options.putFails) {
                            if (putRequest.onerror) putRequest.onerror();
                            if (transaction.onabort) transaction.onabort();
                        } else if (options.abort) {
                            if (transaction.onabort) transaction.onabort();
                        } else if (transaction.oncomplete) {
                            transaction.oncomplete();
                        }
                    });
                    return request;
                },
                put: function() { return { onerror: null }; }
            };
        }
    };
    return { transaction: function() { return transaction; } };
}

test('pre-migration backup resolves only after transaction completion', async function() {
    const db = createDatabaseHarness();
    db.__testSetDatabaseState(createBackupDatabase(), 'ready');

    const result = await db.__testWritePreMigrationBackup(12, { characters: [] });
    assert.equal(result, true);
});

test('pre-migration backup failure is reported when its transaction aborts', async function() {
    const db = createDatabaseHarness();
    db.__testSetDatabaseState(createBackupDatabase({ abort: true }), 'ready');

    const result = await db.__testWritePreMigrationBackup(12, { characters: [] });
    assert.equal(result, false);
});

test('an existing pre-migration backup is accepted after the read transaction completes', async function() {
    const db = createDatabaseHarness();
    db.__testSetDatabaseState(createBackupDatabase({ existing: true }), 'ready');

    const result = await db.__testWritePreMigrationBackup(12, { characters: [] });
    assert.equal(result, true);
});


test('imported data migrates from its recorded internal version without mutating the source', function() {
    const db = createDatabaseHarness();
    const source = {
        _dataVersion: 1,
        characters: [{ id: 'legacy-character' }],
        teams: [],
        tournaments: [],
        missions: [],
        departments: [],
        activities: [],
        currentYear: 1920,
        currentWeek: 1
    };

    const migrated = db.__testMigrateImportedData(source, 1);

    assert.equal(migrated._dataVersion, 35);
    assert.equal(source._dataVersion, 1, 'source object must remain unchanged');
    assert.equal(migrated.characters[0].id, 'legacy-character');
    assert.ok(Array.isArray(migrated.departments));
});

test('imported data refuses an unknown internal version instead of guessing', function() {
    const db = createDatabaseHarness();
    assert.throws(
        function() {
            db.__testMigrateImportedData({ characters: [], teams: [] }, undefined);
        },
        /does not contain a valid internal data version/
    );
});

test('imported data refuses a future internal version', function() {
    const db = createDatabaseHarness();
    assert.throws(
        function() {
            db.__testMigrateImportedData({ characters: [], teams: [] }, 36);
        },
        /newer than this application supports/
    );
});


function createStoredBackupHarness(initialRecords) {
    const records = new Map(initialRecords.map(function(record) {
        return [record.id, record];
    }));

    function transaction() {
        const tx = { oncomplete: null, onerror: null, onabort: null };
        const store = {
            get: function(id) {
                const request = { result: undefined, onsuccess: null, onerror: null };
                setImmediate(function() {
                    request.result = records.get(id);
                    if (request.onsuccess) request.onsuccess();
                    if (pendingGets > 0) pendingGets--;
                    if (pendingGets === 0) {
                        setImmediate(function() {
                            if (tx.oncomplete) tx.oncomplete();
                        });
                    }
                });
                pendingGets++;
                return request;
            },
            put: function(record) {
                records.set(record.id, record);
                return { onerror: null };
            },
            openCursor: function() {
                const request = { result: null, onsuccess: null, onerror: null };
                const entries = Array.from(records.values());
                let index = 0;
                function advance() {
                    setImmediate(function() {
                        const value = entries[index++];
                        request.result = value
                            ? { value, continue: advance }
                            : null;
                        if (request.onsuccess) request.onsuccess();
                        if (!value && tx.oncomplete) tx.oncomplete();
                    });
                }
                advance();
                return request;
            }
        };
        let pendingGets = 0;
        tx.objectStore = function() { return store; };
        tx.abort = function() {
            if (tx.onabort) tx.onabort();
        };
        return tx;
    }

    return {
        records,
        database: { transaction }
    };
}

test('backup listing returns metadata only for stored backup records', async function() {
    const db = createDatabaseHarness();
    const stored = createStoredBackupHarness([
        { id: 'mainData', data: { _dataVersion: 35 } },
        { id: 'mainData_backup_pre_v12', data: { _dataVersion: 12 }, createdAt: '2026-01-01T00:00:00Z', dataVersion: 12 },
        { id: 'mainData_backup_pre_restore_123', data: { _dataVersion: 35 }, createdAt: '2026-02-01T00:00:00Z', dataVersion: 35 },
        { id: 'unrelated', data: {} }
    ]);
    db.__testSetDatabaseState(stored.database, 'ready');

    const backups = await db.db.listBackups();

    assert.equal(backups.length, 2);
    assert.equal(backups[0].id, 'mainData_backup_pre_restore_123');
    assert.equal(backups[1].id, 'mainData_backup_pre_v12');
    assert.equal(Object.prototype.hasOwnProperty.call(backups[0], 'data'), false);
});

test('backup restore atomically preserves the current database as a pre-restore snapshot', async function() {
    const db = createDatabaseHarness();
    const current = {
        id: 'mainData',
        data: {
            _dataVersion: 35,
            characters: [{ id: 'current-character' }],
            teams: [], tournaments: [], missions: [], departments: [],
            activities: [], currentYear: 1924, currentWeek: 2
        }
    };
    const backup = {
        id: 'mainData_backup_pre_v12',
        data: {
            _dataVersion: 35,
            characters: [{ id: 'restored-character' }],
            teams: [], tournaments: [], missions: [], departments: [],
            activities: [], currentYear: 1920, currentWeek: 1
        },
        createdAt: '2026-01-01T00:00:00Z',
        dataVersion: 35
    };
    const stored = createStoredBackupHarness([current, backup]);
    db.__testSetDatabaseState(stored.database, 'ready');

    const restored = await db.db.restoreBackup(backup.id);

    assert.equal(restored.characters[0].id, 'restored-character');
    assert.equal(restored._dataVersion, 35);
    assert.equal(stored.records.get('mainData').data.characters[0].id, 'restored-character');
    const rollback = Array.from(stored.records.values()).find(function(record) {
        return record.id.indexOf('mainData_backup_pre_vrestore_') === 0;
    });
    assert.ok(rollback, 'the pre-restore database snapshot must be retained');
    assert.equal(rollback.data.characters[0].id, 'current-character');
});

test('backup restore rejects invalid identifiers without touching the database', async function() {
    const db = createDatabaseHarness();
    const stored = createStoredBackupHarness([
        { id: 'mainData', data: { _dataVersion: 35, characters: [] } }
    ]);
    db.__testSetDatabaseState(stored.database, 'ready');

    await assert.rejects(db.db.restoreBackup('mainData'), /Invalid backup identifier/);
    assert.equal(stored.records.size, 1);
});
