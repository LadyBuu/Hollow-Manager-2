/**
 * Regression tests for import/export safety.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadImportPipeline() {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'import-export', 'import-pipeline.js'),
        'utf8'
    );

    const calls = { migration: 0, mutation: 0, validation: 0 };
    const window = {
        ExportSchema: {
            FORMAT_VERSION: 1,
            getSections: () => [],
            getRequiredSections: () => [],
            getDefaultSection: () => []
        },
        ExportEnvelope: {
            validate: () => ({ valid: true, errors: [], warnings: ['Newer format warning'] }),
            extract: () => ({})
        },
        FormatMigrations: {
            needsMigration: () => { calls.migration++; return false; },
            apply: value => value
        },
        CrossDomainValidator: {
            validate: () => { calls.validation++; return { valid: true, errors: [], warnings: [] }; }
        },
        MutationPipeline: {
            performMutation: () => { calls.mutation++; return Promise.resolve({ success: true }); }
        },
        ActivityLog: { record: () => {} },
        ObjectUtils: { deepClone: value => JSON.parse(JSON.stringify(value)) },
        IdUtils: {
            generateId: () => 'generated-id',
            normaliseId: value => value === null || value === undefined ? '' : String(value)
        },
        data: {
            _dataVersion: 35,
            activities: [{ id: 'local-activity', message: 'Keep this local log' }]
        }
    };

    const context = { window, console, Promise, Date, JSON, Object, Array, String, Number, Math };
    vm.runInNewContext(source, context, { filename: 'import-pipeline.js' });
    return { pipeline: window.ImportPipeline, calls, window };
}

test('future export format is refused before migration, validation, or mutation', async () => {
    const { pipeline, calls } = loadImportPipeline();
    const futureEnvelope = {
        format: 'hollow-blades',
        formatVersion: 2,
        data: {
            characters: [{ id: 'c1' }],
            teams: [],
            tournaments: [],
            missions: [],
            futureSection: [{ data: 'must not be discarded' }]
        }
    };

    const result = await pipeline.importFromEnvelope(futureEnvelope);

    assert.equal(result.success, false);
    assert.equal(result.committed, false);
    assert.match(result.message, /unsupported future export format/i);
    assert.match(result.errors.join(' '), /newer than the supported version 1/i);
    assert.deepEqual(calls, { migration: 0, mutation: 0, validation: 0 });
});



test('duplicate imported IDs do not redirect references away from the first record', function() {
    const { pipeline } = loadImportPipeline();
    const source = {
        characters: [
            { id: 'char-shared', firstName: 'First' },
            { id: 'char-shared', firstName: 'Duplicate' }
        ],
        teams: [
            { id: 'team-1', members: [{ characterId: 'char-shared' }] }
        ],
        departments: [],
        tournaments: [],
        missions: [],
        classes: [],
        locations: []
    };

    const idResult = pipeline.ensureUniqueIds(source);
    assert.equal(idResult.changes.length, 1);
    assert.equal(idResult.changes[0].reason, 'Duplicate ID');

    const updated = pipeline.updateReferences(idResult.candidate, idResult.changes);
    assert.equal(updated.characters[0].id, 'char-shared');
    assert.notEqual(updated.characters[1].id, 'char-shared');
    assert.equal(
        updated.teams[0].members[0].characterId,
        'char-shared',
        'existing references must continue pointing to the first record'
    );
});


test('import candidate preserves the live database version and local activity history', function() {
    const { pipeline, window } = loadImportPipeline();
    const candidate = pipeline.buildCandidateState({
        characters: [{ id: 'char-1' }],
        teams: [],
        tournaments: [],
        missions: [],
        currentYear: 1920,
        currentWeek: 4
    });

    assert.equal(candidate._dataVersion, 35);
    assert.deepEqual(
        JSON.parse(JSON.stringify(candidate.activities)),
        [{ id: 'local-activity', message: 'Keep this local log' }]
    );
    assert.notEqual(candidate.activities, window.data.activities);
});
