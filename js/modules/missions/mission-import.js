/**
 * js/modules/missions/mission-import.js - Mission Import
 *
 * Path: js/modules/missions/mission-import.js
 *
 * Import missions from JSON or CSV.
 *
 * WHAT THIS OWNS:
 *   - Parsing a JSON blob into a mission record via
 *     MissionSchema.canonicaliseMissionShape.
 *   - Parsing a CSV blob into mission records via MissionCSV.
 *   - Deciding whether each parsed record updates an existing
 *     mission or creates a new one.
 *   - Routing each decision through MissionCore.
 *   - Reporting per-record results.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Mission storage. MissionCore owns writes; MissionQueries
 *     owns reads.
 *   - Structural validation. MissionSchema owns that. This module
 *     calls it and reports the errors it produces.
 *   - The CSV schema. MissionCSV owns it.
 *   - File reading. Callers hand this module a string. Reading a
 *     File object is a two-line `FileReader` wrapper that lives in
 *     the UI layer.
 *   - Cross-domain validation. The pipeline runs it at commit
 *     time against the transaction snapshot. If an imported
 *     mission references a team that does not exist, the pipeline
 *     rejects the record and this module surfaces the error.
 *
 * MATCHING RULE (JSON):
 *   A JSON-imported mission is matched by its `id`. When the id
 *   already exists in the store, the record is UPDATED. When the
 *   id is new, the record is CREATED with the incoming id.
 *
 *   The id is the canonical identity. Labels drift; ids do not.
 *
 *   Update preserves:
 *     - id           (the identity, never changed by an import)
 *     - sequence     (allocated once, at creation)
 *     - createdAt    (the record's birthday)
 *     - reports      (appended to by later user actions, not
 *                     replaced by a re-import of the same record)
 *     - log          (same rationale)
 *
 *   Update replaces every other field with the incoming value:
 *   title, description, dates, types, escalation, threat,
 *   environment, location, duration, difficulty, priority, pay
 *   inputs, billing, assignedTeamIds, supportPersonnel,
 *   participants, status, objectives, notes, tags,
 *   graduatingClassId, classFilterEnabled, archivedAt,
 *   completedAt.
 *
 *   reports and log are preserved on update because they are
 *   append-only histories that the user adds to over time. A
 *   JSON file that was exported once, before any reports existed,
 *   must not wipe the reports a user added since.
 *
 *   participants ARE replaced on update. They are not an
 *   append-only history; they are the current state of who took
 *   part. An import is an authoritative rewrite of that state.
 *   The JSON file was exported from the same record, so its
 *   participants array is exactly what the source had.
 *
 * ID PRESERVATION ON CREATE:
 *   MissionCore.createMission accepts an optional `id`. A JSON
 *   import that carries a mission id passes it through and the
 *   created record uses that id directly.
 *
 *   When the incoming record carries no id (an empty string, or
 *   the field is absent entirely), createMission generates one as
 *   it always did. The generated id is reported back in the
 *   result so the caller can see it.
 *
 * MATCHING RULE (CSV):
 *   CSV always CREATES. CSV rows do not carry a canonical id —
 *   MissionCSV's schema has a MissionId column that is the
 *   derived label, not the record's UUID. Labels drift when the
 *   underlying (year, sequence, difficulty) tuple changes. A
 *   label-based update path would be fragile and would
 *   occasionally overwrite the wrong mission.
 *
 *   CSV creation uses the incoming title and fields, and lets
 *   MissionCore.createMission generate a fresh id and allocate
 *   the sequence.
 *
 * PARTICIPANTS IN CSV:
 *   The CSV schema gained a Participants column. Its value is a
 *   JSON array of { characterId, teamId, source } records. The
 *   importer passes the array through to createMission the same
 *   way it passes objectives through.
 *
 *   When the column is absent or empty, the created mission has
 *   no participants.
 *
 *   When the column carries a malformed value (not a JSON array,
 *   or an array whose entries are not well-formed participant
 *   records), createMission's schema check rejects the row and
 *   this module reports the error. Malformed rows are not
 *   silently dropped.
 *
 * RESULT SHAPE:
 *   {
 *     success: boolean,
 *     imported: number,     // count of missions successfully
 *                           // created or updated
 *     created: number,
 *     updated: number,
 *     failed: number,
 *     errors: [ { index, row, id?, message } ],
 *     warnings: [ string ]
 *   }
 *
 *   `success` is true when at least one mission was imported and
 *   no hard failure occurred. Individual record failures are
 *   reported per record; a partial import is a partial success,
 *   not a hard failure.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.MissionQueries
 *   - window.MissionSchema
 *   - window.MissionCore
 *   - window.MissionCSV
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - (none)
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
    if (!MissionCSV ||
        typeof MissionCSV.import !== 'function') {
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

    function normaliseErrorEntry(e) {
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
        r.failed = 0;
        return r;
    }

    /**
     * Normalise a participants array for the create/update
     * payloads. Preserves the shape MissionSchema expects:
     * characterId, teamId (or null), source.
     *
     * Returns null when the input is not an array; the caller
     * decides whether that is a rejection or a default.
     */
    function normaliseParticipants(raw) {
        if (!Array.isArray(raw)) { return null; }
        var result = [];
        for (var i = 0; i < raw.length; i++) {
            var p = raw[i];
            if (!isPlainObject(p)) {
                // Preserve the malformed entry so the schema
                // rejects it with a clear message rather than
                // silently dropping it.
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

    // ============================================================
    // MISSION LOOKUP
    // ============================================================

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
    // SHAPE - MUTABLE FIELDS FOR UPDATE
    // ============================================================
    //
    // The list of fields the update path is allowed to write. This
    // is a whitelist, not a blacklist: the schema guarantees the
    // incoming record is canonical, but the update path is the
    // last place we can refuse to overwrite an identity field.
    //
    // id, sequence, createdAt are absent by design.
    // reports and log are absent by design.
    //
    // participants ARE present: they are current state, not an
    // append-only history. An import replaces them.

    function buildUpdatePayload(canonical) {
        return {
            title:                 canonical.title,
            description:           canonical.description,
            year:                  canonical.year,
            month:                 canonical.month,
            day:                   canonical.day,
            primaryType:           canonical.primaryType,
            subtype:               canonical.subtype,
            secondaryType:         canonical.secondaryType,
            escalation:            canonical.escalation,
            threatType:            canonical.threatType,
            environment:           canonical.environment,
            location:              canonical.location,
            duration:              canonical.duration,
            difficulty:            canonical.difficulty,
            priority:              canonical.priority,
            basePay:               canonical.basePay,
            surchargePay:          canonical.surchargePay,
            billing:               canonical.billing,
            assignedTeamIds:       canonical.assignedTeamIds,
            supportPersonnel:      canonical.supportPersonnel,
            participants:          canonical.participants,
            status:                canonical.status,
            objectives:            canonical.objectives,
            notes:                 canonical.notes,
            tags:                  canonical.tags,
            graduatingClassId:     canonical.graduatingClassId,
            classFilterEnabled:    canonical.classFilterEnabled
        };
    }

    // ============================================================
    // SINGLE RECORD IMPORT - UPDATE
    // ============================================================

    function importAsUpdate(canonical) {
        var payload = buildUpdatePayload(canonical);

        return MissionCore.updateMission(
            String(canonical.id),
            payload
        ).then(function(result) {
            if (result && result.success) {
                return { ok: true };
            }
            return {
                ok: false,
                message: (result && result.message) ||
                    'Update failed.'
            };
        }).catch(function(err) {
            return {
                ok: false,
                message: err && err.message
                    ? err.message
                    : String(err)
            };
        });
    }

    // ============================================================
    // SINGLE RECORD IMPORT - CREATE
    // ============================================================
    //
    // MissionCore.createMission accepts an optional `id`. When the
    // canonical record carries an id (which the schema guarantees
    // to be a valid uuid for a JSON import), pass it through so
    // the created record uses the incoming id.
    //
    // When the id is absent — the CSV path strips it — pass
    // undefined and let createMission generate one.

    function importAsCreate(canonical) {
        var requestedId =
            isNonEmptyString(canonical.id)
                ? String(canonical.id)
                : undefined;

        var createData = {
            id:                 requestedId,
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

        return MissionCore.createMission(createData)
            .then(function(result) {
                if (result && result.success) {
                    var generatedId = result.data &&
                        result.data.id
                        ? String(result.data.id)
                        : null;

                    return {
                        ok: true,
                        requestedId: requestedId || null,
                        generatedId: generatedId
                    };
                }
                return {
                    ok: false,
                    message: (result && result.message) ||
                        'Create failed.'
                };
            })
            .catch(function(err) {
                return {
                    ok: false,
                    message: err && err.message
                        ? err.message
                        : String(err)
                };
            });
    }

    // ============================================================
    // SINGLE RECORD IMPORT
    // ============================================================

    /**
     * Import one canonical mission.
     *
     * Decides between update and create based on whether the
     * mission id already exists in the store.
     */
    function importCanonicalMission(canonical) {
        var id = canonical && canonical.id
            ? String(canonical.id)
            : null;

        if (id && missionExists(id)) {
            return importAsUpdate(canonical).then(function(r) {
                if (r.ok) {
                    return {
                        ok: true,
                        action: 'update',
                        id: id
                    };
                }
                return r;
            });
        }

        return importAsCreate(canonical).then(function(r) {
            if (r.ok) {
                return {
                    ok: true,
                    action: 'create',
                    requestedId: r.requestedId,
                    generatedId: r.generatedId
                };
            }
            return r;
        });
    }

    // ============================================================
    // SEQUENTIAL RECORD PROCESSING
    // ============================================================
    //
    // Records are imported one at a time, in the order they appear
    // in the source. MutationPipeline does not support concurrent
    // transactions, and a per-record failure should leave a state
    // the user can inspect.

    function runSequential(records) {
        var result = emptyResult();
        var chain = Promise.resolve();

        records.forEach(function(record, index) {
            chain = chain.then(function() {
                return importCanonicalMission(record)
                    .then(function(r) {
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
                            message: r.message ||
                                'Unknown import failure.'
                        });
                    })
                    .catch(function(err) {
                        result.failed++;
                        result.errors.push({
                            index: index,
                            row: index + 1,
                            message: err && err.message
                                ? err.message
                                : String(err)
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

    /**
     * Import one or more missions from a JSON string.
     *
     * The string may contain either a single mission object or an
     * array of mission objects. An array is imported in order.
     *
     * Each record is run through
     * MissionSchema.canonicaliseMissionShape before the store is
     * touched. A record that fails canonicalisation is skipped and
     * its errors are reported.
     *
     * The canonicaliser validates participants structurally: each
     * entry must be an object with a valid characterId, a valid
     * (or null) teamId, a known source, and the source/teamId
     * combination must be coherent. Duplicate (characterId,
     * teamId) pairs are rejected. A record with a malformed
     * participants array fails canonicalisation.
     *
     * @param {string} jsonText
     * @returns {Promise<object>} Import result
     */
    function importFromJson(jsonText) {
        if (typeof jsonText !== 'string') {
            return Promise.resolve(failResult(
                'JSON import requires a string.'
            ));
        }

        var trimmed = jsonText.trim();
        if (trimmed === '') {
            return Promise.resolve(failResult(
                'JSON input is empty.'
            ));
        }

        var parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch (e) {
            return Promise.resolve(failResult(
                'Invalid JSON: ' + e.message
            ));
        }

        var records;
        if (Array.isArray(parsed)) {
            records = parsed;
        } else if (isPlainObject(parsed)) {
            records = [parsed];
        } else {
            return Promise.resolve(failResult(
                'JSON root must be an object or an array of ' +
                'objects.'
            ));
        }

        if (records.length === 0) {
            return Promise.resolve(failResult(
                'JSON array is empty.'
            ));
        }

        // Canonicalise each record before touching the store.
        var canonical = [];
        var result = emptyResult();
        for (var i = 0; i < records.length; i++) {
            var raw = records[i];
            if (!isPlainObject(raw)) {
                result.failed++;
                result.errors.push({
                    index: i,
                    row: i + 1,
                    message: 'Record ' + (i + 1) +
                        ' is not an object.'
                });
                continue;
            }

            var check;
            try {
                check = MissionSchema.canonicaliseMissionShape(raw);
            } catch (e) {
                result.failed++;
                result.errors.push({
                    index: i,
                    row: i + 1,
                    message: 'Record ' + (i + 1) +
                        ' threw during canonicalisation: ' +
                        e.message
                });
                continue;
            }

            if (!check.valid || !check.value) {
                result.failed++;
                var errs = Array.isArray(check.errors)
                    ? check.errors.map(normaliseErrorEntry)
                    : ['Unknown canonicalisation failure.'];
                result.errors.push({
                    index: i,
                    row: i + 1,
                    message: 'Record ' + (i + 1) + ': ' +
                        errs.join('; ')
                });
                continue;
            }

            canonical.push(check.value);
        }

        if (canonical.length === 0) {
            result.success = false;
            return Promise.resolve(result);
        }

        return runSequential(canonical).then(function(runResult) {
            result.imported = runResult.imported;
            result.created = runResult.created;
            result.updated = runResult.updated;
            result.failed += runResult.failed;
            result.warnings = result.warnings.concat(
                runResult.warnings
            );
            result.errors = result.errors.concat(
                runResult.errors
            );
            result.success = result.imported > 0;
            return result;
        });
    }

    // ============================================================
    // CSV IMPORT
    // ============================================================
    //
    // CSV always creates. See the file header for the reasoning.
    //
    // The CSV id column is the derived label, not the record's
    // uuid. We deliberately do not pass it to createMission. Fresh
    // uuids are generated, sequence is allocated, and the resulting
    // label is whatever the tuple (year, sequence, difficulty)
    // produces.
    //
    // The Participants column (if present) carries a JSON array
    // of participant records. It is passed straight through to
    // createMission; the schema validates each entry.

    function importFromCsv(csvText) {
        if (typeof csvText !== 'string') {
            return Promise.resolve(failResult(
                'CSV import requires a string.'
            ));
        }

        if (csvText.trim() === '') {
            return Promise.resolve(failResult(
                'CSV input is empty.'
            ));
        }

        var csvResult;
        try {
            csvResult = MissionCSV.import(csvText);
        } catch (e) {
            return Promise.resolve(failResult(
                'CSV parse failed: ' + e.message
            ));
        }

        if (!csvResult) {
            return Promise.resolve(failResult(
                'CSV parser returned no result.'
            ));
        }

        var result = emptyResult();

        // Collect the CSV parser's own errors and warnings.
        if (typeof csvResult.getErrors === 'function') {
            var csvErrors = csvResult.getErrors(true) || [];
            for (var i = 0; i < csvErrors.length; i++) {
                var e = csvErrors[i];
                result.errors.push({
                    index: e.metadata && e.metadata.row
                        ? e.metadata.row - 1
                        : null,
                    row: e.metadata && e.metadata.row
                        ? e.metadata.row
                        : null,
                    message: normaliseErrorEntry(e)
                });
            }
        }

        if (typeof csvResult.getWarnings === 'function') {
            var csvWarnings = csvResult.getWarnings() || [];
            result.warnings = result.warnings.concat(
                csvWarnings.map(normaliseErrorEntry)
            );
        }

        var candidates = [];
        if (typeof csvResult.getValid === 'function') {
            candidates = csvResult.getValid() || [];
        }

        if (candidates.length === 0) {
            result.success = false;
            return Promise.resolve(result);
        }

        // Build the create payloads. Deliberately omit `id` so
        // createMission generates a fresh uuid for each row.
        var createData = [];
        for (var c = 0; c < candidates.length; c++) {
            var candidate = candidates[c];
            if (!isPlainObject(candidate)) {
                result.failed++;
                result.errors.push({
                    index: c,
                    row: c + 1,
                    message: 'Row ' + (c + 1) +
                        ' is not an object.'
                });
                continue;
            }

            var normalisedParticipants =
                normaliseParticipants(candidate.participants);

            createData.push({
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
                basePay:            candidate.basePay || '',
                surchargePay:       candidate.surchargePay || '',
                billing:            candidate.billing,
                assignedTeamIds:    Array.isArray(
                    candidate.assignedTeamIds
                )
                    ? candidate.assignedTeamIds.slice()
                    : [],
                supportPersonnel:   Array.isArray(
                    candidate.supportPersonnel
                )
                    ? candidate.supportPersonnel.slice()
                    : [],
                participants:       normalisedParticipants === null
                    ? []
                    : normalisedParticipants,
                status:             candidate.status,
                objectives:         Array.isArray(candidate.objectives)
                    ? candidate.objectives.slice()
                    : [],
                notes:              candidate.notes || '',
                tags:               Array.isArray(candidate.tags)
                    ? candidate.tags.slice()
                    : [],
                graduatingClassId:  candidate.graduatingClassId,
                classFilterEnabled:
                    candidate.classFilterEnabled === true
            });
        }

        if (createData.length === 0) {
            result.success = false;
            return Promise.resolve(result);
        }

        var chain = Promise.resolve();
        createData.forEach(function(record, index) {
            chain = chain.then(function() {
                return MissionCore.createMission(record)
                    .then(function(createResult) {
                        if (createResult && createResult.success) {
                            result.imported++;
                            result.created++;
                            return;
                        }
                        result.failed++;
                        result.errors.push({
                            index: index,
                            row: index + 1,
                            message: (createResult &&
                                createResult.message) ||
                                'Create failed.'
                        });
                    })
                    .catch(function(err) {
                        result.failed++;
                        result.errors.push({
                            index: index,
                            row: index + 1,
                            message: err && err.message
                                ? err.message
                                : String(err)
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
    // DISPATCH
    // ============================================================

    /**
     * Import from a text blob, choosing the parser based on
     * `format`.
     *
     * @param {string} text
     * @param {object} options - { format: 'json' | 'csv' }
     * @returns {Promise<object>}
     */
    function importText(text, options) {
        options = options || {};
        var format = isNonEmptyString(options.format)
            ? String(options.format).toLowerCase()
            : 'json';

        if (format === 'json') {
            return importFromJson(text);
        }
        if (format === 'csv') {
            return importFromCsv(text);
        }

        return Promise.resolve(failResult(
            'Unknown import format: "' + format + '".'
        ));
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionImport = Object.freeze({
        importText: importText,
        importFromJson: importFromJson,
        importFromCsv: importFromCsv,

        // Exposed for tests
        buildUpdatePayload: buildUpdatePayload
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionImport;
        var missing = [];

        var required = [
            'importText',
            'importFromJson',
            'importFromCsv',
            'buildUpdatePayload'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke test: participants flow through both payload
        // builders.
        try {
            var sampleCanonical = {
                id: 'miss_abc',
                title: 'Operation Test',
                description: '',
                year: 2026,
                month: 9,
                day: 17,
                sequence: 1,
                primaryType: '',
                subtype: '',
                secondaryType: '',
                escalation: 'tier_ii',
                threatType: '',
                environment: '',
                location: '',
                duration: '',
                difficulty: 'medium',
                priority: 'medium',
                basePay: '',
                surchargePay: '',
                pay: '',
                billing: 'original',
                assignedTeamIds: ['team_a'],
                supportPersonnel: ['char_1'],
                participants: [
                    {
                        characterId: 'char_1',
                        teamId: 'team_a',
                        source: 'team'
                    },
                    {
                        characterId: 'char_2',
                        teamId: null,
                        source: 'rookie'
                    }
                ],
                status: 'active',
                objectives: [],
                progress: 0,
                notes: '',
                tags: [],
                createdAt: '2026-09-17T12:00:00.000Z',
                completedAt: null,
                archivedAt: null,
                reports: [],
                log: [],
                graduatingClassId: null,
                classFilterEnabled: false
            };

            var payload = buildUpdatePayload(sampleCanonical);
            if (!Array.isArray(payload.participants) ||
                payload.participants.length !== 2) {
                missing.push(
                    'buildUpdatePayload did not carry participants'
                );
            }
            if ('reports' in payload || 'log' in payload) {
                missing.push(
                    'buildUpdatePayload leaked a preserved field'
                );
            }
            if ('id' in payload ||
                'sequence' in payload ||
                'createdAt' in payload) {
                missing.push(
                    'buildUpdatePayload leaked an identity field'
                );
            }

            // normaliseParticipants keeps teamId null when
            // missing, and passes malformed entries through.
            var normalised = normaliseParticipants([
                { characterId: 'c1', teamId: 't1', source: 'team' },
                { characterId: 'c2', source: 'rookie' },
                'not-an-object'
            ]);
            if (normalised === null || normalised.length !== 3) {
                missing.push(
                    'normaliseParticipants wrong length'
                );
            } else {
                if (normalised[1].teamId !== null) {
                    missing.push(
                        'normaliseParticipants did not default teamId to null'
                    );
                }
                if (normalised[2] !== 'not-an-object') {
                    missing.push(
                        'normaliseParticipants did not preserve malformed entry'
                    );
                }
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionImport] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();