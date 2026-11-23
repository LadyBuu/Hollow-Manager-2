/**
 * js/modules/missions/mission-import.js - Mission Import
 *
 * Path: js/modules/missions/mission-import.js
 *
 * Import missions from JSON or CSV.
 *
 * OWNS: parsing JSON (via MissionSchema.canonicaliseMissionShape) and
 *   CSV (via MissionCSV); deciding update vs create; routing each
 *   record through MissionCore; per-record reporting.
 * DOES NOT OWN: storage, structural validation, the CSV schema, file
 *   reading, cross-domain validation (the pipeline reports it).
 *
 * MATCHING (JSON): by `id`. Existing id => UPDATE; new id => CREATE
 *   with that id (MissionCore.createMission accepts an optional id).
 *   An update preserves id, sequence (unless year / difficulty change,
 *   in which case MissionCore reallocates it), createdAt, reports,
 *   completedAt and archivedAt (the last two are derived / archive
 *   state and are NOT in the update payload). Every other field,
 *   including participants, is replaced. Archived missions cannot be
 *   updated (MissionCore rejects it); unarchive first.
 *
 * MATCHING (CSV): always CREATE. The CSV id column is the derived
 *   label, not the record uuid, so a label-based update path would be
 *   fragile.
 *
 * REVISION NOTES (fixes in this version):
 *   - CSV rows carry the legacy singular `assignedTeamId`; it is now
 *     mapped to a one-element `assignedTeamIds` (an `assignedTeamIds`
 *     array wins when present). Before, teams were silently dropped.
 *   - CSV rows carry a single `pay` string; it is now mapped to
 *     `basePay` (a trailing " credits" suffix is stripped so a value
 *     exported from a stored pay round-trips). Before, pay was lost.
 *   - Blank enum cells (status / priority / difficulty ...) are passed
 *     as-is; MissionCore.createMission now treats '' as "use default".
 *   - The header no longer claims completedAt / archivedAt are replaced
 *     on update.
 *
 * RESULT SHAPE:
 *   { success, imported, created, updated, failed,
 *     errors: [{ index, row, id?, message }], warnings: [string] }
 *   `success` is true when at least one mission was imported; partial
 *   success is not a hard failure.
 *
 * DEPENDENCIES (MANDATORY): MissionQueries, MissionSchema, MissionCore,
 *   MissionCSV.
 */

(function() {
    'use strict';

    if (window.__missionImportLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var MissionQueries = window.MissionQueries;
    var MissionSchema = window.MissionSchema;
    var MissionCore = window.MissionCore;
    var MissionCSV = window.MissionCSV;

    var _missing = [];

    if (!MissionQueries ||
        typeof MissionQueries.getMission !== 'function') {
        _missing.push('MissionQueries.getMission');
    }
    if (!MissionSchema ||
        typeof MissionSchema.canonicaliseMissionShape !== 'function') {
        _missing.push('MissionSchema.canonicaliseMissionShape');
    }
    if (!MissionCore ||
        typeof MissionCore.createMission !== 'function') {
        _missing.push('MissionCore.createMission');
    }
    if (!MissionCore ||
        typeof MissionCore.updateMission !== 'function') {
        _missing.push('MissionCore.updateMission');
    }
    if (!MissionCSV || typeof MissionCSV.import !== 'function') {
        _missing.push('MissionCSV.import');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionImport] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionImportLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function messageOf(e) {
        if (typeof e === 'string') { return e; }
        if (e && typeof e === 'object' && e.message) {
            return String(e.message);
        }
        return String(e);
    }

    function emptyResult() {
        return {
            success: false,
            imported: 0,
            created: 0,
            updated: 0,
            failed: 0,
            errors: [],
            warnings: []
        };
    }

    function failResult(message) {
        var r = emptyResult();
        r.errors.push({ index: null, row: null, message: message });
        return r;
    }

    /**
     * Normalise a participants array. Preserves the schema shape
     * (characterId, teamId or null, source). Returns null when the
     * input is not an array. Malformed entries are passed through so
     * the schema rejects them with a clear message.
     */
    function normaliseParticipants(raw) {
        if (!Array.isArray(raw)) { return null; }
        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var p = raw[i];
            if (!isPlainObject(p)) {
                result.push(p);
                continue;
            }
            result.push({
                characterId: p.characterId,
                teamId: (p.teamId !== undefined) ? p.teamId : null,
                source: p.source
            });
        }
        return result;
    }

    /**
     * Resolve the team list of a CSV candidate. `assignedTeamIds`
     * (array) wins; otherwise the legacy singular `assignedTeamId`
     * becomes a one-element array; otherwise [].
     */
    function resolveCsvTeamIds(candidate) {
        if (Array.isArray(candidate.assignedTeamIds)) {
            return candidate.assignedTeamIds.slice();
        }
        if (isNonEmptyString(candidate.assignedTeamId)) {
            return [String(candidate.assignedTeamId).trim()];
        }
        return [];
    }

    /**
     * Resolve the base pay of a CSV candidate. `basePay` wins; else the
     * single `pay` column. A trailing " credits" is stripped.
     */
    function resolveCsvBasePay(candidate) {
        if (typeof candidate.basePay === 'string' &&
            candidate.basePay.trim() !== '') {
            return candidate.basePay;
        }
        if (typeof candidate.pay === 'string') {
            return candidate.pay.replace(/\s*credits\s*$/i, '').trim();
        }
        if (typeof candidate.pay === 'number' && isFinite(candidate.pay)) {
            return String(candidate.pay);
        }
        return '';
    }

    function missionExists(missionId) {
        if (!isNonEmptyString(missionId)) { return false; }
        try {
            var found = MissionQueries.getMission(String(missionId));
            return found !== null && found !== undefined;
        } catch (e) {
            return false;
        }
    }

    // ============================================================
    // PAYLOAD BUILDERS
    // ============================================================
    //
    // UPDATE whitelist. id, sequence, createdAt, reports, completedAt
    // and archivedAt are absent by design. participants ARE present:
    // they are current state, not an append-only history.

    function buildUpdatePayload(canonical) {
        return {
            title:              canonical.title,
            description:        canonical.description,
            year:               canonical.year,
            month:              canonical.month,
            day:                canonical.day,
            primaryType:        canonical.primaryType,
            subtype:            canonical.subtype,
            secondaryType:      canonical.secondaryType,
            escalation:         canonical.escalation,
            threatType:         canonical.threatType,
            environment:        canonical.environment,
            location:           canonical.location,
            duration:           canonical.duration,
            difficulty:         canonical.difficulty,
            priority:           canonical.priority,
            basePay:            canonical.basePay,
            surchargePay:       canonical.surchargePay,
            billing:            canonical.billing,
            assignedTeamIds:    canonical.assignedTeamIds,
            supportPersonnel:   canonical.supportPersonnel,
            participants:       canonical.participants,
            status:             canonical.status,
            objectives:         canonical.objectives,
            notes:              canonical.notes,
            tags:               canonical.tags,
            graduatingClassId:  canonical.graduatingClassId,
            classFilterEnabled: canonical.classFilterEnabled
        };
    }

    function buildCreatePayload(canonical) {
        var payload = buildUpdatePayload(canonical);
        payload.id = isNonEmptyString(canonical.id)
            ? String(canonical.id)
            : undefined;
        return payload;
    }

    /**
     * CSV candidate -> createMission payload. No `id` (a fresh uuid is
     * generated). Blank enums pass through as '' / undefined and are
     * defaulted by MissionCore.
     */
    function buildCsvCreatePayload(candidate) {
        var participants = normaliseParticipants(candidate.participants);

        return {
            title:              candidate.title || '',
            description:        candidate.description || '',
            year:               candidate.year,
            month:              candidate.month,
            day:                candidate.day,
            primaryType:        candidate.primaryType || '',
            subtype:            candidate.subtype || '',
            secondaryType:      candidate.secondaryType || '',
            escalation:         candidate.escalation,
            threatType:         candidate.threatType || '',
            environment:        candidate.environment || '',
            location:           candidate.location || '',
            duration:           candidate.duration || '',
            difficulty:         candidate.difficulty,
            priority:           candidate.priority,
            basePay:            resolveCsvBasePay(candidate),
            surchargePay:       candidate.surchargePay || '',
            billing:            candidate.billing,
            assignedTeamIds:    resolveCsvTeamIds(candidate),
            supportPersonnel:   Array.isArray(candidate.supportPersonnel)
                ? candidate.supportPersonnel.slice()
                : [],
            participants:       participants === null ? [] : participants,
            status:             candidate.status,
            objectives:         Array.isArray(candidate.objectives)
                ? candidate.objectives.slice()
                : [],
            notes:              candidate.notes || '',
            tags:               Array.isArray(candidate.tags)
                ? candidate.tags.slice()
                : [],
            graduatingClassId:  candidate.graduatingClassId,
            classFilterEnabled: candidate.classFilterEnabled === true
        };
    }

    // ============================================================
    // SINGLE RECORD IMPORT
    // ============================================================

    function toOutcome(promise, okExtra) {
        return promise.then(function(result) {
            if (result && result.success) {
                var out = { ok: true };
                if (okExtra) {
                    for (var k in okExtra) {
                        if (Object.prototype.hasOwnProperty.call(
                            okExtra, k
                        )) {
                            out[k] = okExtra[k];
                        }
                    }
                }
                return out;
            }
            return {
                ok: false,
                message: (result && result.message) || 'Import failed.'
            };
        }).catch(function(err) {
            return { ok: false, message: messageOf(err) };
        });
    }

    function importAsUpdate(canonical) {
        return toOutcome(
            MissionCore.updateMission(
                String(canonical.id),
                buildUpdatePayload(canonical)
            ),
            { action: 'update', id: String(canonical.id) }
        );
    }

    function importAsCreate(payload) {
        return MissionCore.createMission(payload)
            .then(function(result) {
                if (result && result.success) {
                    return {
                        ok: true,
                        action: 'create',
                        generatedId: result.data && result.data.id
                            ? String(result.data.id)
                            : null
                    };
                }
                return {
                    ok: false,
                    message: (result && result.message) ||
                        'Create failed.'
                };
            })
            .catch(function(err) {
                return { ok: false, message: messageOf(err) };
            });
    }

    function importCanonicalMission(canonical) {
        var id = canonical && canonical.id ? String(canonical.id) : null;

        if (id && missionExists(id)) {
            return importAsUpdate(canonical);
        }
        return importAsCreate(buildCreatePayload(canonical));
    }

    // ============================================================
    // SEQUENTIAL PROCESSING
    // ============================================================
    //
    // `worker(item)` returns a Promise<{ ok, action?, message? }>.
    // Items run one at a time, in source order (the pipeline does not
    // support concurrent transactions).

    function runSequential(items, worker) {
        var result = emptyResult();
        var chain = Promise.resolve();

        items.forEach(function(item, index) {
            chain = chain.then(function() {
                return worker(item).then(function(r) {
                    if (r.ok) {
                        result.imported++;
                        if (r.action === 'update') {
                            result.updated++;
                        } else {
                            result.created++;
                        }
                        return;
                    }
                    result.failed++;
                    result.errors.push({
                        index: index,
                        row: index + 1,
                        message: r.message || 'Unknown import failure.'
                    });
                }).catch(function(err) {
                    result.failed++;
                    result.errors.push({
                        index: index,
                        row: index + 1,
                        message: messageOf(err)
                    });
                });
            });
        });

        return chain.then(function() {
            result.success = result.imported > 0;
            return result;
        });
    }

    // ============================================================
    // JSON IMPORT
    // ============================================================

    function importFromJson(jsonText) {
        if (typeof jsonText !== 'string') {
            return Promise.resolve(
                failResult('JSON import requires a string.')
            );
        }

        var trimmed = jsonText.trim();
        if (trimmed === '') {
            return Promise.resolve(failResult('JSON input is empty.'));
        }

        var parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch (e) {
            return Promise.resolve(
                failResult('Invalid JSON: ' + e.message)
            );
        }

        var records;
        if (Array.isArray(parsed)) {
            records = parsed;
        } else if (isPlainObject(parsed)) {
            records = [parsed];
        } else {
            return Promise.resolve(failResult(
                'JSON root must be an object or an array of objects.'
            ));
        }

        if (records.length === 0) {
            return Promise.resolve(failResult('JSON array is empty.'));
        }

        // Canonicalise every record before touching the store.
        var canonical = [];
        var pre = emptyResult();

        for (var i = 0; i < records.length; i++) {
            var raw = records[i];
            if (!isPlainObject(raw)) {
                pre.failed++;
                pre.errors.push({
                    index: i,
                    row: i + 1,
                    message: 'Record ' + (i + 1) + ' is not an object.'
                });
                continue;
            }

            var check;
            try {
                check = MissionSchema.canonicaliseMissionShape(raw);
            } catch (e2) {
                pre.failed++;
                pre.errors.push({
                    index: i,
                    row: i + 1,
                    message: 'Record ' + (i + 1) +
                        ' threw during canonicalisation: ' + e2.message
                });
                continue;
            }

            if (!check.valid || !check.value) {
                pre.failed++;
                var errs = Array.isArray(check.errors)
                    ? check.errors.map(messageOf)
                    : ['Unknown canonicalisation failure.'];
                pre.errors.push({
                    index: i,
                    row: i + 1,
                    message: 'Record ' + (i + 1) + ': ' + errs.join('; ')
                });
                continue;
            }

            canonical.push(check.value);
        }

        if (canonical.length === 0) {
            pre.success = false;
            return Promise.resolve(pre);
        }

        return runSequential(canonical, importCanonicalMission)
            .then(function(run) {
                run.failed += pre.failed;
                run.errors = pre.errors.concat(run.errors);
                run.success = run.imported > 0;
                return run;
            });
    }

    // ============================================================
    // CSV IMPORT
    // ============================================================

    function importFromCsv(csvText) {
        if (typeof csvText !== 'string') {
            return Promise.resolve(
                failResult('CSV import requires a string.')
            );
        }
        if (csvText.trim() === '') {
            return Promise.resolve(failResult('CSV input is empty.'));
        }

        var csvResult;
        try {
            csvResult = MissionCSV.import(csvText);
        } catch (e) {
            return Promise.resolve(
                failResult('CSV parse failed: ' + e.message)
            );
        }
        if (!csvResult) {
            return Promise.resolve(
                failResult('CSV parser returned no result.')
            );
        }

        var pre = emptyResult();

        if (typeof csvResult.getErrors === 'function') {
            var csvErrors = csvResult.getErrors(true) || [];
            for (var i = 0; i < csvErrors.length; i++) {
                var err = csvErrors[i];
                var row = err.metadata && err.metadata.row
                    ? err.metadata.row
                    : null;
                pre.errors.push({
                    index: row !== null ? row - 1 : null,
                    row: row,
                    message: messageOf(err)
                });
            }
        }

        if (typeof csvResult.getWarnings === 'function') {
            pre.warnings = (csvResult.getWarnings() || []).map(messageOf);
        }

        var candidates = typeof csvResult.getValid === 'function'
            ? (csvResult.getValid() || [])
            : [];

        var payloads = [];
        for (var c = 0; c < candidates.length; c++) {
            if (!isPlainObject(candidates[c])) {
                pre.failed++;
                pre.errors.push({
                    index: c,
                    row: c + 1,
                    message: 'Row ' + (c + 1) + ' is not an object.'
                });
                continue;
            }
            payloads.push(buildCsvCreatePayload(candidates[c]));
        }

        if (payloads.length === 0) {
            pre.success = false;
            return Promise.resolve(pre);
        }

        return runSequential(payloads, importAsCreate)
            .then(function(run) {
                run.failed += pre.failed;
                run.errors = pre.errors.concat(run.errors);
                run.warnings = pre.warnings;
                run.success = run.imported > 0;
                return run;
            });
    }

    // ============================================================
    // DISPATCH
    // ============================================================

    function importText(text, options) {
        options = options || {};
        var format = isNonEmptyString(options.format)
            ? String(options.format).toLowerCase()
            : 'json';

        if (format === 'json') { return importFromJson(text); }
        if (format === 'csv') { return importFromCsv(text); }

        return Promise.resolve(
            failResult('Unknown import format: "' + format + '".')
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionImport = Object.freeze({
        importText: importText,
        importFromJson: importFromJson,
        importFromCsv: importFromCsv,

        // Exposed for tests
        buildUpdatePayload: buildUpdatePayload,
        buildCsvCreatePayload: buildCsvCreatePayload
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionImport;
        var missing = [];

        var required = [
            'importText', 'importFromJson', 'importFromCsv',
            'buildUpdatePayload', 'buildCsvCreatePayload'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        function check(cond, label) {
            if (!cond) { missing.push(label); }
        }

        try {
            var sample = {
                id: 'miss_abc', title: 'Operation Test', description: '',
                year: 2026, month: 9, day: 17, sequence: 1,
                primaryType: '', subtype: '', secondaryType: '',
                escalation: 'tier_ii', threatType: '', environment: '',
                location: '', duration: '', difficulty: 'medium',
                priority: 'medium', basePay: '', surchargePay: '',
                pay: '', billing: 'original',
                assignedTeamIds: ['team_a'],
                supportPersonnel: ['char_1'],
                participants: [
                    { characterId: 'char_1', teamId: 'team_a',
                      source: 'team' },
                    { characterId: 'char_2', teamId: null,
                      source: 'rookie' }
                ],
                status: 'active', objectives: [], progress: 0,
                notes: '', tags: [],
                createdAt: '2026-09-17T12:00:00.000Z',
                completedAt: '2026-09-18T12:00:00.000Z',
                archivedAt: null, reports: [],
                graduatingClassId: null, classFilterEnabled: false
            };

            var payload = buildUpdatePayload(sample);
            check(Array.isArray(payload.participants) &&
                payload.participants.length === 2,
                'update payload lost participants');
            check(!('reports' in payload) && !('log' in payload),
                'update payload leaked a preserved field');
            check(!('id' in payload) && !('sequence' in payload) &&
                !('createdAt' in payload),
                'update payload leaked an identity field');
            check(!('completedAt' in payload) && !('archivedAt' in payload),
                'update payload leaked completedAt / archivedAt');

            var createPayload = buildCreatePayload(sample);
            check(createPayload.id === 'miss_abc',
                'create payload dropped the id');

            // CSV mapping.
            var csv = buildCsvCreatePayload({
                title: 'T', status: '', priority: '', difficulty: '',
                assignedTeamId: 'team_z', pay: '500.00 credits',
                objectives: [], participants: []
            });
            check(csv.assignedTeamIds.length === 1 &&
                csv.assignedTeamIds[0] === 'team_z',
                'CSV assignedTeamId was not mapped to assignedTeamIds');
            check(csv.basePay === '500.00',
                'CSV pay was not mapped to basePay (got "' +
                csv.basePay + '")');
            check(!('id' in csv), 'CSV payload carried an id');

            var csvArr = buildCsvCreatePayload({
                title: 'T', assignedTeamIds: ['a', 'b'],
                assignedTeamId: 'ignored'
            });
            check(csvArr.assignedTeamIds.length === 2,
                'CSV assignedTeamIds array did not win');

            var csvNoTeam = buildCsvCreatePayload({
                title: 'T', assignedTeamId: null
            });
            check(csvNoTeam.assignedTeamIds.length === 0,
                'CSV blank team should map to []');

            var norm = normaliseParticipants([
                { characterId: 'c1', teamId: 't1', source: 'team' },
                { characterId: 'c2', source: 'rookie' },
                'not-an-object'
            ]);
            check(norm && norm.length === 3, 'normaliseParticipants length');
            check(norm && norm[1].teamId === null,
                'normaliseParticipants did not default teamId to null');
            check(norm && norm[2] === 'not-an-object',
                'normaliseParticipants dropped a malformed entry');
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionImport] Verification failed:', missing.join(', ')
            );
        }
    })();

})();
