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
        IdUtils: { generateId: () => 'generated-id' }
    };

    const context = { window, console, Promise, Date, JSON, Object, Array, String, Number, Math };
    vm.runInNewContext(source, context, { filename: 'import-pipeline.js' });
    return { pipeline: window.ImportPipeline, calls };
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
    assert.match(result.message, /newer export format/i);
    assert.match(result.errors.join(' '), /newer than the supported version 1/i);
    assert.deepEqual(calls, { migration: 0, mutation: 0, validation: 0 });
});

