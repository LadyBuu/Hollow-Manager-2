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
        '    window.__testGetEmptyData = getEmptyData;\n' +
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
