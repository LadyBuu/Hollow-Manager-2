'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const TEAM_CORE_PATH = path.join(__dirname, '..', 'js', 'modules', 'teams', 'team-core.js');

function loadTeamCore() {
    const window = {
        TeamConstants: {
            parsePeriod(value) {
                if (value === '' || value === null || value === undefined) return null;
                const parsed = Number(value);
                return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
            },
            normalizeTeamType(value) {
                return value === 'professional' || value === 'temporary' || value === 'internship'
                    ? 'professional' : value;
            }
        },
        IdUtils: { generateId: prefix => prefix + '-test' },
        MutationPipeline: { performMutation: () => Promise.resolve({ success: true }) },
        ObjectUtils: { deepClone: value => structuredClone(value) }
    };
    const context = vm.createContext({
        window,
        structuredClone,
        console: { log() {}, warn() {}, error() {} },
        Date
    });
    const source = fs.readFileSync(TEAM_CORE_PATH, 'utf8');
    vm.runInContext(source, context, { filename: 'js/modules/teams/team-core.js', timeout: 5000 });
    return window.TeamCore;
}

test('career/death cascade does not close a future membership before its join period', function() {
    const TeamCore = loadTeamCore();
    const data = {
        teams: [{
            id: 'professional-team',
            type: 'professional',
            members: [{
                characterId: 'target',
                intervals: [
                    { joinPeriod: '2018', leavePeriod: '' },
                    { joinPeriod: '2022', leavePeriod: '' },
                    { joinPeriod: '2023', leavePeriod: '2024' },
                    { joinPeriod: '2010', leavePeriod: '2019' }
                ]
            }]
        }, {
            id: 'social-team',
            type: 'social',
            members: [{
                characterId: 'target',
                intervals: [{ joinPeriod: '2018', leavePeriod: '' }]
            }]
        }]
    };

    const result = TeamCore.endStintsForCharacter(data, 'target', 2020);

    assert.equal(result.stintsEnded, 1);
    assert.equal(result.teamsTouched, 1);
    assert.equal(result.skippedStartsAfterDeath, 2);
    assert.equal(data.teams[0].members[0].intervals[0].leavePeriod, '2020');
    assert.equal(data.teams[0].members[0].intervals[1].leavePeriod, '');
    assert.equal(data.teams[0].members[0].intervals[2].leavePeriod, '2024');
    assert.equal(data.teams[0].members[0].intervals[3].leavePeriod, '2019');
    assert.equal(data.teams[1].members[0].intervals[0].leavePeriod, '');
});
