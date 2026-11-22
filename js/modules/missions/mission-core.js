/**
 * js/modules/missions/mission-core.js - Mission Core
 *
 * Path: js/modules/missions/mission-core.js
 *
 * Canonical mutation API for missions.
 *
 * OWNS: create, update, archive, unarchive, purge; status commands;
 *   objective / support / participant / report mutations; pipeline
 *   orchestration for all of them.
 * DOES NOT OWN: reads (MissionQueries), structural validation
 *   (MissionSchema), domain rules (MissionRules), the audit trail
 *   (ActivityLog, fed by MutationPipeline's logMessage).
 *
 * MUTATION PATTERN:
 *   Every mutation re-reads the mission from the transaction SNAPSHOT
 *   inside validate(), builds a candidate, recomputes derived fields,
 *   validates, and stages the candidate. mutate() writes the staged
 *   candidate. Staging is PER CALL (closure variable), never module
 *   state, so overlapping calls cannot see each other's candidate.
 *
 * REVISION NOTES (fixes in this version):
 *   - updateMission now:
 *       * refuses edits to archived missions (MissionRules.canEdit);
 *       * judges a status transition against the CANDIDATE's
 *         objectives, so "tick last objective + complete" in one
 *         save (form or import) works;
 *       * only enforces the objective freeze when objectives actually
 *         CHANGED, and not when the edit reactivates the mission;
 *       * runs the candidate through canonicaliseMissionShape, so
 *         legacy `log` / `assignedTeamId` are dropped on write;
 *       * reallocates `sequence` when year or difficulty changes, so
 *         two missions can never share a YEAR-SEQ-DIFFICULTY label.
 *   - createMission treats '' like "absent" for enum fields, so CSV
 *     rows with blank Status / Priority / Difficulty get defaults.
 *   - Staging is per call; wrapMutation and the pointless wrapper on
 *     stripCharacterRefs are gone.
 *   - Sub-mutations share one helper (mutateMission) instead of seven
 *     copies of the same validate/mutate scaffolding.
 *
 * PARTICIPANTS / PRUNE / REPORTS / ARCHIVE:
 *   Unchanged semantics. Removing a team via update prunes that team's
 *   participants (rookies survive). Archive sets archivedAt + status
 *   'completed'; unarchive clears archivedAt only; purge removes.
 *
 * DEPENDENCIES (MANDATORY): MutationPipeline, ObjectUtils, IdUtils,
 *   MissionConstants, MissionId, MissionSchema, MissionRules.
 * DEPENDENCIES (LAZY): MissionCascade (stripCharacterRefs only).
 */

(function() {
    'use strict';

    if (window.__missionCoreLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var MutationPipeline = window.MutationPipeline;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var MissionConstants = window.MissionConstants;
    var MissionId = window.MissionId;
    var MissionSchema = window.MissionSchema;
    var MissionRules = window.MissionRules;

    var _missing = [];

    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!IdUtils || typeof IdUtils.normaliseId !== 'function') {
        _missing.push('IdUtils.normaliseId');
    }
    if (!MissionConstants) {
        _missing.push('MissionConstants (module)');
    } else {
        if (!Array.isArray(MissionConstants.VALID_STATUSES)) {
            _missing.push('MissionConstants.VALID_STATUSES');
        }
        if (typeof MissionConstants.getDefaults !== 'function') {
            _missing.push('MissionConstants.getDefaults');
        }
    }
    if (!MissionId || typeof MissionId.generate !== 'function') {
        _missing.push('MissionId.generate');
    }
    if (!MissionSchema) {
        _missing.push('MissionSchema (module)');
    } else {
        if (typeof MissionSchema.validateMission !== 'function') {
            _missing.push('MissionSchema.validateMission');
        }
        if (typeof MissionSchema.validateReport !== 'function') {
            _missing.push('MissionSchema.validateReport');
        }
        if (typeof MissionSchema.validateParticipant !== 'function') {
            _missing.push('MissionSchema.validateParticipant');
        }
        if (typeof MissionSchema.canonicaliseMissionShape !== 'function') {
            _missing.push('MissionSchema.canonicaliseMissionShape');
        }
    }
    if (!MissionRules) {
        _missing.push('MissionRules (module)');
    } else {
        var rulesRequired = [
            'recalculateDerivedFields',
            'validateStatusChange',
            'deriveCompletedAt',
            'resolveParticipantSource',
            'hasParticipant',
            'canEdit'
        ];
        for (var rr = 0; rr < rulesRequired.length; rr++) {
            if (typeof MissionRules[rulesRequired[rr]] !== 'function') {
                _missing.push('MissionRules.' + rulesRequired[rr]);
            }
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionCore] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionCoreLoaded = true;

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

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function generateId(prefix) {
        return IdUtils.generateId(prefix);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value &&
            value !== null &&
            typeof value === 'object') {
            throw new Error(
                '[MissionCore] deepClone returned the original reference.'
            );
        }
        return result;
    }

    function failure(message) {
        return { success: false, message: message };
    }

    /** undefined, null and '' all mean "not supplied". */
    function isAbsent(value) {
        return value === undefined || value === null || value === '';
    }

    function pick(value, fallback) {
        return isAbsent(value) ? fallback : value;
    }

    function str(value) {
        return typeof value === 'string' ? value : '';
    }

    // ============================================================
    // SNAPSHOT ACCESS
    // ============================================================

    function ensureMissionArray(appData) {
        if (!appData || typeof appData !== 'object') { return null; }
        if (!Array.isArray(appData.missions)) { appData.missions = []; }
        return appData.missions;
    }

    function findMissionIndexInSnapshot(appData, missionId) {
        if (!appData || !Array.isArray(appData.missions)) { return -1; }
        var target = normaliseId(missionId);
        if (target === null) { return -1; }
        var missions = appData.missions;
        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (isPlainObject(m) && normaliseId(m.id) === target) {
                return i;
            }
        }
        return -1;
    }

    function findMissionInSnapshot(appData, missionId) {
        var idx = findMissionIndexInSnapshot(appData, missionId);
        return idx === -1 ? null : appData.missions[idx];
    }

    // ============================================================
    // CANDIDATE HELPERS
    // ============================================================

    function finaliseCandidate(candidate) {
        var recalculated = MissionRules.recalculateDerivedFields(candidate);
        recalculated.completedAt = candidate.completedAt;
        return recalculated;
    }

    function pruneOrphanedParticipants(candidate) {
        if (!Array.isArray(candidate.participants)) { return; }
        if (!Array.isArray(candidate.assignedTeamIds)) { return; }

        var assignedSet = Object.create(null);
        for (var i = 0; i < candidate.assignedTeamIds.length; i++) {
            var norm = normaliseId(candidate.assignedTeamIds[i]);
            if (norm !== null) { assignedSet[norm] = true; }
        }

        candidate.participants = candidate.participants.filter(
            function(p) {
                if (!isPlainObject(p)) { return true; }
                if (p.teamId === null || p.teamId === undefined) {
                    return true; // rookies are not attached to a team
                }
                var tid = normaliseId(p.teamId);
                return tid !== null && assignedSet[tid] === true;
            }
        );
    }

    function normaliseObjectives(list) {
        return list.map(function(obj) {
            return {
                text: obj && typeof obj.text === 'string' ? obj.text : '',
                done: !!obj && obj.done === true
            };
        });
    }

    function normaliseParticipantList(list) {
        return list.map(function(p) {
            if (!isPlainObject(p)) { return p; }
            return {
                characterId: p.characterId,
                teamId: p.teamId !== undefined ? p.teamId : null,
                source: p.source
            };
        });
    }

    function sameObjectives(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) { return false; }
        if (a.length !== b.length) { return false; }
        for (var i = 0; i < a.length; i++) {
            if (!a[i] || !b[i]) { return false; }
            if (a[i].text !== b[i].text) { return false; }
            if ((a[i].done === true) !== (b[i].done === true)) {
                return false;
            }
        }
        return true;
    }

    function copyIfProvided(candidate, updates, field, transform) {
        if (updates[field] === undefined) { return; }
        var value = updates[field];
        if (typeof transform === 'function') { value = transform(value); }
        candidate[field] = value;
    }

    function validateSingleReport(report) {
        var errors = [];
        MissionSchema.validateReport(report, 0, errors);
        return { valid: errors.length === 0, message: errors.join('; ') };
    }

    function validateSingleParticipant(participant) {
        var errors = [];
        MissionSchema.validateParticipant(participant, 0, errors);
        return { valid: errors.length === 0, message: errors.join('; ') };
    }

    // ============================================================
    // SHARED SUB-MUTATION RUNNER
    // ============================================================
    //
    // config = {
    //   build(current, appData, nowIso) -> { error } | { candidate, extra? }
    //   fullValidate: boolean   // canonicalise + validateMission
    //   log(title) -> string
    //   successMessage, failureMessage
    // }
    //
    // `current` is the snapshot record (do NOT mutate it; build clones).

    function mutateMission(target, config) {
        var staged = null;
        var extra = null;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }

                var nowIso = new Date().toISOString();
                var built = config.build(current, appData, nowIso);
                if (!built || built.error) {
                    return {
                        valid: false,
                        message: (built && built.error) ||
                            'Could not build the change.'
                    };
                }

                var final = finaliseCandidate(built.candidate);

                if (config.fullValidate) {
                    var canonical =
                        MissionSchema.canonicaliseMissionShape(final);
                    if (!canonical.valid || !canonical.value) {
                        return {
                            valid: false,
                            message: canonical.errors.join('; ')
                        };
                    }
                    final = canonical.value;

                    var validated = MissionSchema.validateMission(final);
                    if (!validated.valid) {
                        return {
                            valid: false,
                            message: validated.errors.join('; ')
                        };
                    }
                }

                staged = final;
                extra = built.extra || null;
                return { valid: true };
            },

            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                if (!staged) {
                    throw new Error(
                        'Mission candidate was not built during validate.'
                    );
                }
                appData.missions[idx] = deepClone(staged);
                return {
                    id: target,
                    mission: staged,
                    reportId: extra && extra.reportId
                        ? extra.reportId
                        : undefined
                };
            },

            logMessage: function(result) {
                return config.log(result.mission.title || target);
            },
            successMessage: config.successMessage,
            failureMessage: config.failureMessage
        });
    }

    // ============================================================
    // CREATE
    // ============================================================

    /**
     * Create a mission. Required: title. Optional: id (must be valid;
     * collision rejected). Enum fields that are undefined, null or ''
     * fall back to MissionConstants.getDefaults().
     */
    function createMission(data) {
        if (!isPlainObject(data)) {
            return Promise.resolve(failure('Mission data is required.'));
        }
        if (!isNonEmptyString(data.title)) {
            return Promise.resolve(failure('Mission title is required.'));
        }

        var requestedId = null;
        if (!isAbsent(data.id)) {
            requestedId = normaliseId(data.id);
            if (requestedId === null) {
                return Promise.resolve(failure(
                    'Supplied id is not a valid identifier.'
                ));
            }
        }

        var staged = null;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                var missions = ensureMissionArray(appData);
                if (!missions) {
                    return {
                        valid: false,
                        message: 'Mission store is not available.'
                    };
                }

                var candidateId;
                if (requestedId !== null) {
                    if (findMissionInSnapshot(appData, requestedId)) {
                        return {
                            valid: false,
                            message: 'A mission with id "' +
                                requestedId + '" already exists.'
                        };
                    }
                    candidateId = requestedId;
                } else {
                    candidateId = generateId('miss');
                }

                var defaults = MissionConstants.getDefaults();
                var nowIso = new Date().toISOString();

                var raw = {
                    id: candidateId,
                    title: data.title.trim(),
                    description: str(data.description),

                    year: pick(data.year, new Date().getFullYear()),
                    month: pick(data.month, 1),
                    day: pick(data.day, 1),

                    primaryType: str(data.primaryType),
                    subtype: str(data.subtype),
                    secondaryType: str(data.secondaryType),

                    escalation: pick(data.escalation, defaults.escalation),
                    threatType: str(data.threatType),
                    environment: str(data.environment),
                    location: str(data.location),
                    duration: str(data.duration),

                    difficulty: pick(data.difficulty, defaults.difficulty),
                    priority: pick(data.priority, defaults.priority),

                    basePay: str(data.basePay),
                    surchargePay: str(data.surchargePay),
                    pay: '',
                    billing: pick(data.billing, defaults.billing),

                    assignedTeamIds: Array.isArray(data.assignedTeamIds)
                        ? data.assignedTeamIds.slice()
                        : [],
                    supportPersonnel: Array.isArray(data.supportPersonnel)
                        ? data.supportPersonnel.slice()
                        : [],
                    participants: Array.isArray(data.participants)
                        ? normaliseParticipantList(data.participants)
                        : [],

                    status: pick(data.status, defaults.status),
                    objectives: Array.isArray(data.objectives)
                        ? normaliseObjectives(data.objectives)
                        : [],
                    progress: 0,

                    notes: str(data.notes),
                    tags: Array.isArray(data.tags) ? data.tags.slice() : [],

                    createdAt: nowIso,
                    completedAt: null,
                    archivedAt: null,

                    reports: [],

                    graduatingClassId: data.graduatingClassId !== undefined
                        ? data.graduatingClassId
                        : null,
                    classFilterEnabled: data.classFilterEnabled === true
                };

                var sequenceResult = MissionId.generate(
                    raw.year, raw.difficulty, missions
                );
                if (!sequenceResult) {
                    return {
                        valid: false,
                        message:
                            'Could not allocate a mission sequence for ' +
                            'the given year and difficulty.'
                    };
                }
                raw.sequence = sequenceResult.sequence;

                var canonical = MissionSchema.canonicaliseMissionShape(raw);
                if (!canonical.valid || !canonical.value) {
                    return {
                        valid: false,
                        message: canonical.errors.join('; ')
                    };
                }

                var candidate = finaliseCandidate(canonical.value);

                var validated = MissionSchema.validateMission(candidate);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                staged = candidate;
                return { valid: true };
            },

            mutate: function(appData) {
                var missions = ensureMissionArray(appData);
                if (!missions) {
                    throw new Error('Mission store is not available.');
                }
                if (!staged) {
                    throw new Error(
                        'Mission candidate was not built during validate.'
                    );
                }
                missions.push(deepClone(staged));
                return { mission: staged, id: staged.id };
            },

            logMessage: function(result) {
                return 'Created mission: ' + result.mission.title;
            },
            successMessage: 'Mission created.',
            failureMessage: 'Failed to create mission.'
        });
    }

    // ============================================================
    // UPDATE
    // ============================================================

    function updateMission(missionId, updates) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (!isPlainObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(
                failure('Updates must be a non-empty object.')
            );
        }

        return mutateMission(target, {
            fullValidate: true,

            build: function(current, appData, nowIso) {
                // ---- Archived missions are immutable here. ----
                if (!MissionRules.canEdit(current)) {
                    return {
                        error: 'Archived missions cannot be edited. ' +
                            'Unarchive the mission first.'
                    };
                }

                var candidate = deepClone(current);

                // ---- Objectives (applied BEFORE the status check so
                //      the transition sees the candidate's progress) ----
                var objectivesChanged = false;
                if (updates.objectives !== undefined) {
                    if (!Array.isArray(updates.objectives)) {
                        return { error: 'Objectives must be an array.' };
                    }
                    var nextObjectives =
                        normaliseObjectives(updates.objectives);
                    objectivesChanged = !sameObjectives(
                        current.objectives, nextObjectives
                    );
                    candidate.objectives = nextObjectives;
                }

                // ---- Support personnel ----
                if (updates.supportPersonnel !== undefined) {
                    if (!Array.isArray(updates.supportPersonnel)) {
                        return {
                            error: 'Support personnel must be an array.'
                        };
                    }
                    candidate.supportPersonnel =
                        updates.supportPersonnel.slice();
                }

                // ---- Participants ----
                if (updates.participants !== undefined) {
                    if (!Array.isArray(updates.participants)) {
                        return { error: 'Participants must be an array.' };
                    }
                    candidate.participants =
                        normaliseParticipantList(updates.participants);
                }

                // ---- Assigned teams (+ orphan prune) ----
                if (updates.assignedTeamIds !== undefined) {
                    if (!Array.isArray(updates.assignedTeamIds)) {
                        return { error: 'Assigned teams must be an array.' };
                    }
                    candidate.assignedTeamIds =
                        updates.assignedTeamIds.slice();
                    pruneOrphanedParticipants(candidate);
                }

                // ---- Plain fields ----
                copyIfProvided(candidate, updates, 'title', function(v) {
                    return typeof v === 'string' ? v.trim() : v;
                });
                var plain = [
                    'description', 'primaryType', 'subtype',
                    'secondaryType', 'escalation', 'threatType',
                    'environment', 'location', 'duration', 'difficulty',
                    'priority', 'basePay', 'surchargePay', 'billing',
                    'notes', 'tags', 'graduatingClassId',
                    'classFilterEnabled', 'year', 'month', 'day'
                ];
                for (var f = 0; f < plain.length; f++) {
                    copyIfProvided(candidate, updates, plain[f]);
                }

                // ---- Status transition (judged on the candidate) ----
                if (updates.status !== undefined &&
                    updates.status !== current.status) {
                    var preview = deepClone(candidate);
                    preview.status = current.status;

                    var statusCheck = MissionRules.validateStatusChange(
                        preview, updates.status
                    );
                    if (!statusCheck.valid) {
                        return { error: statusCheck.message };
                    }

                    candidate.status = updates.status;
                    candidate.completedAt = MissionRules.deriveCompletedAt(
                        current.status,
                        updates.status,
                        current.completedAt,
                        nowIso
                    );
                }

                // ---- Objective freeze: only when objectives changed,
                //      and not when the mission is active before or
                //      after this edit (covers reactivate + edit). ----
                if (objectivesChanged &&
                    current.status !== 'active' &&
                    candidate.status !== 'active') {
                    return {
                        error: 'Objectives cannot be modified for a ' +
                            current.status + ' mission.'
                    };
                }

                // ---- Label uniqueness: reallocate sequence when the
                //      (year, difficulty) scope changes. ----
                var scopeChanged =
                    String(candidate.year) !== String(current.year) ||
                    candidate.difficulty !== current.difficulty;
                if (scopeChanged) {
                    var others = (appData.missions || []).filter(
                        function(m) {
                            return isPlainObject(m) &&
                                normaliseId(m.id) !== target;
                        }
                    );
                    var seq = MissionId.generate(
                        candidate.year, candidate.difficulty, others
                    );
                    if (!seq) {
                        return {
                            error: 'Could not allocate a mission ' +
                                'sequence for the given year and ' +
                                'difficulty.'
                        };
                    }
                    candidate.sequence = seq.sequence;
                }

                return { candidate: candidate };
            },

            log: function(title) { return 'Updated mission: ' + title; },
            successMessage: 'Mission updated.',
            failureMessage: 'Failed to update mission.'
        });
    }

    // ============================================================
    // ARCHIVE / UNARCHIVE / PURGE
    // ============================================================

    function archiveMission(missionId) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }
                if (current.archivedAt !== undefined &&
                    current.archivedAt !== null) {
                    return {
                        valid: false,
                        message: 'Mission is already archived.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                var m = appData.missions[idx];
                m.archivedAt = new Date().toISOString();
                m.status = 'completed';
                if (!m.completedAt) { m.completedAt = m.archivedAt; }
                return { id: target, mission: deepClone(m) };
            },
            logMessage: function(result) {
                return 'Archived mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Mission archived.',
            failureMessage: 'Failed to archive mission.'
        });
    }

    function unarchiveMission(missionId) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }
                if (current.archivedAt === undefined ||
                    current.archivedAt === null) {
                    return {
                        valid: false,
                        message: 'Mission is not archived.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx].archivedAt = null;
                return {
                    id: target,
                    mission: deepClone(appData.missions[idx])
                };
            },
            logMessage: function(result) {
                return 'Unarchived mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Mission unarchived.',
            failureMessage: 'Failed to unarchive mission.'
        });
    }

    function purgeMission(missionId) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!findMissionInSnapshot(appData, target)) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                var m = appData.missions[idx];
                var title = m && typeof m.title === 'string'
                    ? m.title
                    : target;
                appData.missions.splice(idx, 1);
                return { id: target, title: title };
            },
            logMessage: function(result) {
                return 'Purged mission: ' + result.title;
            },
            successMessage: 'Mission purged.',
            failureMessage: 'Failed to purge mission.'
        });
    }

    // ============================================================
    // STATUS COMMANDS
    // ============================================================

    function completeMission(missionId) {
        return updateMission(missionId, { status: 'completed' });
    }

    function cancelMission(missionId) {
        return updateMission(missionId, { status: 'cancelled' });
    }

    function reactivateMission(missionId) {
        return updateMission(missionId, { status: 'active' });
    }

    // ============================================================
    // OBJECTIVE COMMANDS (sub-mutations; no whole-record validation)
    // ============================================================

    function requireActiveForObjectives(current) {
        var check = MissionRules.validateObjectivesEditable(current);
        return check.valid ? null : check.message;
    }

    function setObjectiveDone(missionId, index, done) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (typeof index !== 'number' || !Number.isInteger(index) ||
            index < 0) {
            return Promise.resolve(failure(
                'Objective index must be a non-negative integer.'
            ));
        }
        if (typeof done !== 'boolean') {
            return Promise.resolve(
                failure('Objective done must be a boolean.')
            );
        }

        return mutateMission(target, {
            build: function(current) {
                var err = requireActiveForObjectives(current);
                if (err) { return { error: err }; }
                if (!Array.isArray(current.objectives) ||
                    index >= current.objectives.length) {
                    return { error: 'Objective index is out of range.' };
                }
                var candidate = deepClone(current);
                candidate.objectives[index] = {
                    text: candidate.objectives[index].text,
                    done: done
                };
                return { candidate: candidate };
            },
            log: function(title) {
                return 'Set objective ' + index + ' on mission ' +
                    title + ' to ' + done;
            },
            successMessage: 'Objective updated.',
            failureMessage: 'Failed to update objective.'
        });
    }

    function addObjective(missionId, text) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (!isNonEmptyString(text)) {
            return Promise.resolve(failure('Objective text is required.'));
        }
        var trimmed = text.trim();

        return mutateMission(target, {
            build: function(current) {
                var err = requireActiveForObjectives(current);
                if (err) { return { error: err }; }
                var candidate = deepClone(current);
                if (!Array.isArray(candidate.objectives)) {
                    candidate.objectives = [];
                }
                candidate.objectives.push({ text: trimmed, done: false });
                return { candidate: candidate };
            },
            log: function(title) {
                return 'Added objective to mission: ' + title;
            },
            successMessage: 'Objective added.',
            failureMessage: 'Failed to add objective.'
        });
    }

    function removeObjective(missionId, index) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (typeof index !== 'number' || !Number.isInteger(index) ||
            index < 0) {
            return Promise.resolve(failure(
                'Objective index must be a non-negative integer.'
            ));
        }

        return mutateMission(target, {
            build: function(current) {
                var err = requireActiveForObjectives(current);
                if (err) { return { error: err }; }
                if (!Array.isArray(current.objectives) ||
                    index >= current.objectives.length) {
                    return { error: 'Objective index is out of range.' };
                }
                var candidate = deepClone(current);
                candidate.objectives.splice(index, 1);
                return { candidate: candidate };
            },
            log: function(title) {
                return 'Removed objective from mission: ' + title;
            },
            successMessage: 'Objective removed.',
            failureMessage: 'Failed to remove objective.'
        });
    }

    // ============================================================
    // SUPPORT PERSONNEL COMMANDS
    // ============================================================

    function addSupportPersonnel(missionId, characterId) {
        var target = normaliseId(missionId);
        var charTarget = normaliseId(characterId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (charTarget === null) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        return mutateMission(target, {
            build: function(current) {
                var support = Array.isArray(current.supportPersonnel)
                    ? current.supportPersonnel
                    : [];
                for (var i = 0; i < support.length; i++) {
                    if (normaliseId(support[i]) === charTarget) {
                        return {
                            error: 'Character is already assigned as ' +
                                'support.'
                        };
                    }
                }
                var candidate = deepClone(current);
                candidate.supportPersonnel = support.concat([charTarget]);
                return { candidate: candidate };
            },
            log: function(title) {
                return 'Added support to mission: ' + title;
            },
            successMessage: 'Support personnel added.',
            failureMessage: 'Failed to add support personnel.'
        });
    }

    function removeSupportPersonnel(missionId, characterId) {
        var target = normaliseId(missionId);
        var charTarget = normaliseId(characterId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (charTarget === null) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        return mutateMission(target, {
            build: function(current) {
                var support = Array.isArray(current.supportPersonnel)
                    ? current.supportPersonnel
                    : [];
                var found = support.some(function(id) {
                    return normaliseId(id) === charTarget;
                });
                if (!found) {
                    return {
                        error: 'Character is not assigned as support.'
                    };
                }
                var candidate = deepClone(current);
                candidate.supportPersonnel = support.filter(function(id) {
                    return normaliseId(id) !== charTarget;
                });
                return { candidate: candidate };
            },
            log: function(title) {
                return 'Removed support from mission: ' + title;
            },
            successMessage: 'Support personnel removed.',
            failureMessage: 'Failed to remove support personnel.'
        });
    }

    // ============================================================
    // PARTICIPANT COMMANDS
    // ============================================================
    //
    // teamId null / undefined / '' => 'rookie'. Cross-domain checks
    // (character / team existence, membership) are the caller's job.

    function normaliseOptionalTeamId(teamId) {
        if (isAbsent(teamId)) { return { ok: true, value: null }; }
        var t = normaliseId(teamId);
        if (t === null) { return { ok: false }; }
        return { ok: true, value: t };
    }

    function addParticipant(missionId, characterId, teamId) {
        var target = normaliseId(missionId);
        var charTarget = normaliseId(characterId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (charTarget === null) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var team = normaliseOptionalTeamId(teamId);
        if (!team.ok) {
            return Promise.resolve(failure(
                'Team ID must be a valid identifier or null.'
            ));
        }
        var teamTarget = team.value;
        var source = MissionRules.resolveParticipantSource(teamTarget);

        return mutateMission(target, {
            build: function(current) {
                if (MissionRules.hasParticipant(
                    current, charTarget, teamTarget
                )) {
                    return {
                        error: 'Character is already a participant for ' +
                            'this ' +
                            (source === 'team' ? 'team.' : 'rookie slot.')
                    };
                }

                var newParticipant = {
                    characterId: charTarget,
                    teamId: teamTarget,
                    source: source
                };
                var pCheck = validateSingleParticipant(newParticipant);
                if (!pCheck.valid) { return { error: pCheck.message }; }

                var candidate = deepClone(current);
                var participants = Array.isArray(candidate.participants)
                    ? candidate.participants
                    : [];
                candidate.participants =
                    participants.concat([newParticipant]);
                return { candidate: candidate };
            },
            log: function(title) {
                return 'Added ' + source +
                    ' participant to mission: ' + title;
            },
            successMessage: 'Participant added.',
            failureMessage: 'Failed to add participant.'
        });
    }

    function removeParticipant(missionId, characterId, teamId) {
        var target = normaliseId(missionId);
        var charTarget = normaliseId(characterId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (charTarget === null) {
            return Promise.resolve(failure('Character ID is required.'));
        }

        var team = normaliseOptionalTeamId(teamId);
        if (!team.ok) {
            return Promise.resolve(failure(
                'Team ID must be a valid identifier or null.'
            ));
        }
        var teamTarget = team.value;

        return mutateMission(target, {
            build: function(current) {
                if (!MissionRules.hasParticipant(
                    current, charTarget, teamTarget
                )) {
                    return {
                        error: 'Character is not a participant for this ' +
                            (teamTarget === null ? 'rookie slot.' : 'team.')
                    };
                }

                var candidate = deepClone(current);
                var participants = Array.isArray(candidate.participants)
                    ? candidate.participants
                    : [];

                candidate.participants = participants.filter(function(p) {
                    if (!isPlainObject(p)) { return true; }
                    if (normaliseId(p.characterId) !== charTarget) {
                        return true;
                    }
                    var ptid = (p.teamId === undefined || p.teamId === null)
                        ? null
                        : normaliseId(p.teamId);
                    return ptid !== teamTarget;
                });
                return { candidate: candidate };
            },
            log: function(title) {
                return 'Removed participant from mission: ' + title;
            },
            successMessage: 'Participant removed.',
            failureMessage: 'Failed to remove participant.'
        });
    }

    // ============================================================
    // REPORT COMMANDS
    // ============================================================

    function addReport(missionId, authorId, text) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        var author = null;
        var authorRedacted = false;
        if (!isAbsent(authorId)) {
            author = normaliseId(authorId);
            if (author === null) {
                return Promise.resolve(
                    failure('Author ID must be a valid id or empty.')
                );
            }
        } else {
            authorRedacted = true;
        }

        if (!isNonEmptyString(text)) {
            return Promise.resolve(failure('Report text is required.'));
        }
        var trimmedText = text.trim();

        return mutateMission(target, {
            build: function(current, appData, nowIso) {
                var candidate = deepClone(current);
                if (!Array.isArray(candidate.reports)) {
                    candidate.reports = [];
                }

                var newReport = {
                    id: generateId('mrep'),
                    authorId: author,
                    authorRedacted: authorRedacted,
                    text: trimmedText,
                    createdAt: nowIso,
                    updatedAt: null
                };

                var check = validateSingleReport(newReport);
                if (!check.valid) { return { error: check.message }; }

                candidate.reports.push(newReport);
                return {
                    candidate: candidate,
                    extra: { reportId: newReport.id }
                };
            },
            log: function(title) {
                return 'Added report to mission: ' + title;
            },
            successMessage: 'Report added.',
            failureMessage: 'Failed to add report.'
        });
    }

    function findReportIndex(mission, reportTarget) {
        if (!Array.isArray(mission.reports)) { return -1; }
        for (var i = 0; i < mission.reports.length; i++) {
            if (normaliseId(mission.reports[i].id) === reportTarget) {
                return i;
            }
        }
        return -1;
    }

    function updateReport(missionId, reportId, text) {
        var target = normaliseId(missionId);
        var reportTarget = normaliseId(reportId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (reportTarget === null) {
            return Promise.resolve(failure('Report ID is required.'));
        }
        if (!isNonEmptyString(text)) {
            return Promise.resolve(failure('Report text is required.'));
        }
        var trimmedText = text.trim();

        return mutateMission(target, {
            build: function(current, appData, nowIso) {
                var idx = findReportIndex(current, reportTarget);
                if (idx === -1) { return { error: 'Report not found.' }; }

                var candidate = deepClone(current);
                var report = candidate.reports[idx];
                report.text = trimmedText;
                report.updatedAt = nowIso;

                var check = validateSingleReport(report);
                if (!check.valid) { return { error: check.message }; }

                return { candidate: candidate };
            },
            log: function(title) {
                return 'Updated report on mission: ' + title;
            },
            successMessage: 'Report updated.',
            failureMessage: 'Failed to update report.'
        });
    }

    function removeReport(missionId, reportId) {
        var target = normaliseId(missionId);
        var reportTarget = normaliseId(reportId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (reportTarget === null) {
            return Promise.resolve(failure('Report ID is required.'));
        }

        return mutateMission(target, {
            build: function(current) {
                if (findReportIndex(current, reportTarget) === -1) {
                    return { error: 'Report not found.' };
                }
                var candidate = deepClone(current);
                candidate.reports = candidate.reports.filter(function(r) {
                    return normaliseId(r.id) !== reportTarget;
                });
                return { candidate: candidate };
            },
            log: function(title) {
                return 'Removed report from mission: ' + title;
            },
            successMessage: 'Report removed.',
            failureMessage: 'Failed to remove report.'
        });
    }

    // ============================================================
    // CASCADE HELPER
    // ============================================================
    //
    // Transaction-local; runs inside a caller's pipeline entry, so it
    // is deliberately NOT wrapped or staged here.

    function stripCharacterRefs(appData, charId) {
        var MissionCascade = window.MissionCascade;
        if (!MissionCascade ||
            typeof MissionCascade.stripCharacterRefs !== 'function') {
            return {
                supportEntriesRemoved: 0,
                reportsRedacted: 0,
                participantEntriesRemoved: 0
            };
        }
        return MissionCascade.stripCharacterRefs(appData, charId);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionCore = Object.freeze({
        createMission: createMission,
        updateMission: updateMission,
        archiveMission: archiveMission,
        unarchiveMission: unarchiveMission,
        purgeMission: purgeMission,

        completeMission: completeMission,
        cancelMission: cancelMission,
        reactivateMission: reactivateMission,

        setObjectiveDone: setObjectiveDone,
        addObjective: addObjective,
        removeObjective: removeObjective,

        addSupportPersonnel: addSupportPersonnel,
        removeSupportPersonnel: removeSupportPersonnel,

        addParticipant: addParticipant,
        removeParticipant: removeParticipant,

        addReport: addReport,
        updateReport: updateReport,
        removeReport: removeReport,

        stripCharacterRefs: stripCharacterRefs
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionCore;
        var missing = [];

        var required = [
            'createMission', 'updateMission', 'archiveMission',
            'unarchiveMission', 'purgeMission', 'completeMission',
            'cancelMission', 'reactivateMission', 'setObjectiveDone',
            'addObjective', 'removeObjective', 'addSupportPersonnel',
            'removeSupportPersonnel', 'addParticipant',
            'removeParticipant', 'addReport', 'updateReport',
            'removeReport', 'stripCharacterRefs'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (!isAbsent('') || !isAbsent(null) || !isAbsent(undefined) ||
                isAbsent('x') || isAbsent(0)) {
                missing.push('isAbsent behaves incorrectly');
            }
            if (pick('', 'd') !== 'd' || pick('v', 'd') !== 'v') {
                missing.push('pick behaves incorrectly');
            }
            if (!sameObjectives(
                [{ text: 'a', done: false }],
                [{ text: 'a' }]
            )) {
                missing.push('sameObjectives treated missing done as true');
            }
            if (sameObjectives(
                [{ text: 'a', done: true }],
                [{ text: 'a', done: false }]
            )) {
                missing.push('sameObjectives ignored a done change');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionCore] Verification failed:', missing.join(', ')
            );
        }
    })();

})();
