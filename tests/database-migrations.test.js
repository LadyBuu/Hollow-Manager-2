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
