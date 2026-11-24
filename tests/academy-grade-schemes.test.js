const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'js/modules/academy/academy-grade-schemes.js'),
    'utf8'
);
const context = { window: {}, console: { warn() {} } };
vm.runInNewContext(source, context);

const schemes = context.window.AcademyGradeSchemes;

test('built-in grading presets are available and valid', () => {
    const ids = schemes.getValidPresetIds();
    for (const id of ['letter', 'pass_fail', 'numeric', 'scale_5', 'scale_10', 'scale_20', 'descriptive', 'custom']) {
        assert.ok(ids.includes(id), 'missing preset id: ' + id);
    }

    for (const preset of schemes.getPresets()) {
        assert.equal(schemes.validateScheme(preset).valid, true, preset.id);
    }
});

test('five-, ten-, and twenty-point presets convert percentages', () => {
    assert.equal(schemes.getGradeBand(82, schemes.getPreset('scale_5')).label, '4');
    assert.equal(schemes.getGradeBand(82, schemes.getPreset('scale_10')).label, '8');
    assert.equal(schemes.getGradeBand(52, schemes.getPreset('scale_20')).label, '11');
});

test('numeric scale presets carry explicit passing thresholds', () => {
    assert.equal(schemes.isPassing(60, schemes.getPreset('scale_5')), true);
    assert.equal(schemes.isPassing(59, schemes.getPreset('scale_5')), false);
    assert.equal(schemes.isPassing(48, schemes.getPreset('scale_20')), true);
    assert.equal(schemes.isPassing(47, schemes.getPreset('scale_20')), false);
});

test('descriptive preset distinguishes satisfactory from insufficient work', () => {
    const preset = schemes.getPreset('descriptive');
    assert.equal(schemes.getGradeBand(65, preset).label, 'Satisfactory');
    assert.equal(schemes.isPassing(65, preset), true);
    assert.equal(schemes.getGradeBand(49, preset).label, 'Insufficient');
    assert.equal(schemes.isPassing(49, preset), false);
});
