/**
 * js/modules/missions/mission-core.js - Mission Core
 *
 * Path: js/modules/missions/mission-core.js
 *
 * Canonical mutation API for missions.
 *
 * WHAT THIS MODULE OWNS:
 *   - Mission creation, update, archive, unarchive, purge.
 *   - Status transitions: complete, cancel, reactivate.
 *   - Objective mutations: add, remove, toggle.
 *   - Support personnel mutations: add, remove.
 *   - Log entry mutations: append.
 *   - Report mutations: add, update, remove.
 *   - MutationPipeline orchestration for all of the above.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Reads. Callers use MissionQueries directly.
 *   - Structural validation. MissionSchema owns it.
 *   - Domain rules and derivations. MissionRules owns them.
 *   - ID grammar. MissionId owns it.
 *   - Cross-domain cascades. MissionCascade owns them.
 *   - Presentation. MissionAggregator and MissionRender own it.
 *
 * MUTATION PATTERN:
 *   Every mutation follows the same shape:
 *
 *     1. Cheap preflight on the operation's inputs (title present,
 *        updates is an object, etc). Fast UX-level rejection.
 *
 *     2. MutationPipeline.performMutation with:
 *
 *        validate(appData):
 *          - Re-read the mission from the SNAPSHOT, not from a
 *            preflight read.
 *          - Build the candidate by applying the requested changes
 *            to that snapshot mission.
 *          - Recompute derived fields from the candidate's own
 *            objectives and pay inputs.
 *          - Run MissionSchema.validateMission on the candidate.
 *          - Run the operation's MissionRules checks against the
 *            snapshot mission and the candidate.
 *          - Return { valid, message? }.
 *
 *        mutate(appData):
 *          - Locate the mission again in the snapshot (or append for
 *            create).
 *          - Write the validated candidate.
 *          - Return a summary for the log.
 *
 *   Nothing is computed once from a preflight read and then
 *   blind-written. Every invariant is checked against the
 *   transaction snapshot. This is what makes the mutations actually
 *   atomic.
 *
 * ARCHIVE VS PURGE:
 *   Missions follow the historical-preservation model.
 *
 *     archiveMission(id)
 *       Sets archivedAt and status 'completed'. History preserved.
 *       Archived missions are hidden from default queries but stay
 *       queryable. This is the ordinary UI delete.
 *
 *     unarchiveMission(id)
 *       Clears archivedAt. Status is left as-is. The caller decides
 *       whether to also update status.
 *
 *     purgeMission(id)
 *       Permanently removes the mission. Administrative, not wired
 *       to any ordinary UI button.
 *
 * REPORTS:
 *   Reports are historical notes attached to a mission. They can be
 *   added, edited, and (soft) removed at any time, independent of
 *   mission status. An edited report carries `updatedAt`; a fresh
 *   report leaves `updatedAt` null until first edit. Removed
 *   reports are dropped from the array entirely — see the note in
 *   removeReport below for the trade-off.
 *
 * DERIVED FIELDS:
 *   progress and pay are recomputed from the candidate inside
 *   validate, via MissionRules.recalculateDerivedFields. The stored
 *   values the user supplied for those fields are ignored; they are
 *   always derived. completedAt is set by the transition rule for
 *   status changes that enter or leave 'completed'.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.MutationPipeline
 *   - window.ObjectUtils
 *   - window.IdUtils
 *   - window.MissionConstants
 *   - window.MissionId
 *   - window.MissionSchema
 *   - window.MissionRules
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
        if (typeof MissionSchema.canonicaliseMissionShape !== 'function') {
            _missing.push('MissionSchema.canonicaliseMissionShape');
        }
    }

    if (!MissionRules) {
        _missing.push('MissionRules (module)');
    } else {
        if (typeof MissionRules.recalculateDerivedFields !== 'function') {
            _missing.push('MissionRules.recalculateDerivedFields');
        }
        if (typeof MissionRules.validateStatusChange !== 'function') {
            _missing.push('MissionRules.validateStatusChange');
        }
        if (typeof MissionRules.validateObjectivesEditable !== 'function') {
            _missing.push('MissionRules.validateObjectivesEditable');
        }
        if (typeof MissionRules.deriveCompletedAt !== 'function') {
            _missing.push('MissionRules.deriveCompletedAt');
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

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // SNAPSHOT ACCESS
    // ============================================================
    //
    // These helpers read from the appData snapshot the pipeline
    // hands in. They never touch window.data.

    function ensureMissionArray(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!Array.isArray(appData.missions)) {
            appData.missions = [];
        }
        return appData.missions;
    }

    function findMissionInSnapshot(appData, missionId) {
        if (!appData || !Array.isArray(appData.missions)) {
            return null;
        }
        var target = normaliseId(missionId);
        if (target === null) { return null; }
        var missions = appData.missions;
        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (isPlainObject(m) && normaliseId(m.id) === target) {
                return m;
            }
        }
        return null;
    }

    function findMissionIndexInSnapshot(appData, missionId) {
        if (!appData || !Array.isArray(appData.missions)) {
            return -1;
        }
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

    // ============================================================
    // CANDIDATE BUILDING
    // ============================================================

    /**
     * After applying any updates to a mission candidate, recompute
     * derived fields from the candidate's own facts and, when a
     * status transition is requested, update completedAt.
     *
     * Pure with respect to the input: returns a new object.
     */
    function finaliseCandidate(candidate, nowIso) {
        var recalculated = MissionRules.recalculateDerivedFields(candidate);
        recalculated.completedAt = candidate.completedAt;
        return recalculated;
    }

    // ============================================================
    // CREATE
    // ============================================================

    /**
     * Create a new mission.
     *
     * @param {object} data - Mission fields. Required: title.
     *   Optional: everything else. Missing fields fall back to
     *   MissionConstants.getDefaults() for enum fields and to ''
     *   / [] / null for text, arrays, and IDs.
     * @returns {Promise<{success, data?, message?}>}
     */
    function createMission(data) {
        if (!isPlainObject(data)) {
            return Promise.resolve(
                failure('Mission data is required.')
            );
        }
        if (!isNonEmptyString(data.title)) {
            return Promise.resolve(
                failure('Mission title is required.')
            );
        }

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

                var defaults = MissionConstants.getDefaults();
                var nowIso = new Date().toISOString();

                // ---- Assemble the raw candidate input ----
                // Defaults are applied here, at creation time, from
                // MissionConstants. Schema does not fill defaults.
                var raw = {
                    id: generateId('miss'),

                    title: typeof data.title === 'string'
                        ? data.title.trim()
                        : '',

                    description: typeof data.description === 'string'
                        ? data.description
                        : '',

                    year: data.year !== undefined && data.year !== null
                        ? data.year
                        : new Date().getFullYear(),

                    month: data.month !== undefined && data.month !== null
                        ? data.month
                        : new Date().getMonth() + 1,

                    day: data.day !== undefined && data.day !== null
                        ? data.day
                        : new Date().getDate(),

                    primaryType: typeof data.primaryType === 'string'
                        ? data.primaryType
                        : '',

                    subtype: typeof data.subtype === 'string'
                        ? data.subtype
                        : '',

                    secondaryType: typeof data.secondaryType === 'string'
                        ? data.secondaryType
                        : '',

                    escalation: data.escalation !== undefined &&
                                data.escalation !== null
                        ? data.escalation
                        : defaults.escalation,

                    threatType: typeof data.threatType === 'string'
                        ? data.threatType
                        : '',

                    environment: typeof data.environment === 'string'
                        ? data.environment
                        : '',

                    location: typeof data.location === 'string'
                        ? data.location
                        : '',

                    duration: typeof data.duration === 'string'
                        ? data.duration
                        : '',

                    difficulty: data.difficulty !== undefined &&
                                data.difficulty !== null
                        ? data.difficulty
                        : defaults.difficulty,

                    priority: data.priority !== undefined &&
                              data.priority !== null
                        ? data.priority
                        : defaults.priority,

                    basePay: typeof data.basePay === 'string'
                        ? data.basePay
                        : '',

                    surchargePay: typeof data.surchargePay === 'string'
                        ? data.surchargePay
                        : '',

                    pay: '',

                    billing: data.billing !== undefined &&
                             data.billing !== null
                        ? data.billing
                        : defaults.billing,

                    assignedTeamId: data.assignedTeamId !== undefined
                        ? data.assignedTeamId
                        : null,

                    supportPersonnel: Array.isArray(data.supportPersonnel)
                        ? data.supportPersonnel.slice()
                        : [],

                    status: data.status !== undefined &&
                            data.status !== null
                        ? data.status
                        : defaults.status,

                    objectives: Array.isArray(data.objectives)
                        ? data.objectives.map(function(obj) {
                            return {
                                text: obj && typeof obj.text === 'string'
                                    ? obj.text
                                    : '',
                                done: obj && obj.done === true
                            };
                        })
                        : [],

                    progress: 0,

                    notes: typeof data.notes === 'string'
                        ? data.notes
                        : '',

                    tags: Array.isArray(data.tags)
                        ? data.tags.slice()
                        : [],

                    createdAt: nowIso,
                    completedAt: null,
                    archivedAt: null,

                    reports: [],

                    log: [],

                    graduatingClassId: data.graduatingClassId !== undefined
                        ? data.graduatingClassId
                        : null,

                    classFilterEnabled:
                        data.classFilterEnabled === true
                };

                // ---- Sequence allocation against the snapshot ----
                // The sequence is scoped to (year, difficulty).
                // MissionId.generate walks the snapshot missions and
                // returns max(sequence) + 1 for that scope.
                var sequenceResult = MissionId.generate(
                    raw.year,
                    raw.difficulty,
                    missions
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

                // ---- Canonicalise structurally ----
                var canonical = MissionSchema.canonicaliseMissionShape(raw);
                if (!canonical.valid || !canonical.value) {
                    return {
                        valid: false,
                        message: canonical.errors.join('; ')
                    };
                }

                // ---- Recompute derived fields ----
                var candidate = finaliseCandidate(
                    canonical.value,
                    nowIso
                );

                // ---- Re-validate the final candidate ----
                var validated = MissionSchema.validateMission(candidate);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                // Stash for mutate.
                stagedCandidate = candidate;

                return { valid: true };
            },

            mutate: function(appData) {
                var missions = ensureMissionArray(appData);
                if (!missions) {
                    throw new Error(
                        'Mission store is not available.'
                    );
                }

                if (!stagedCandidate) {
                    throw new Error(
                        'Mission candidate was not built during validate.'
                    );
                }

                missions.push(deepClone(stagedCandidate));

                return {
                    mission: stagedCandidate,
                    id: stagedCandidate.id
                };
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

    /**
     * Update an existing mission.
     *
     * Updatable fields: every non-derived, non-timestamp field.
     * id, sequence, createdAt, and missionId (which is not stored)
     * are never changed by this function. Status changes go through
     * the status-transition rules.
     *
     * @param {string} missionId - Mission UUID
     * @param {object} updates
     * @returns {Promise<{success, data?, message?}>}
     */
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
                var candidate = deepClone(current);

                // ---- Apply status change separately so the
                // transition rule runs against the CURRENT status.
                if (updates.status !== undefined &&
                    updates.status !== current.status) {
                    var statusCheck = MissionRules.validateStatusChange(
                        current,
                        updates.status
                    );
                    if (!statusCheck.valid) {
                        return statusCheck;
                    }
                    candidate.status = updates.status;
                    candidate.completedAt = MissionRules.deriveCompletedAt(
                        current.status,
                        updates.status,
                        current.completedAt,
                        nowIso
                    );
                }

                // ---- Objectives ----
                if (updates.objectives !== undefined) {
                    if (!Array.isArray(updates.objectives)) {
                        return {
                            valid: false,
                            message: 'Objectives must be an array.'
                        };
                    }
                    var objCheck = MissionRules.validateObjectivesEditable(
                        current
                    );
                    if (!objCheck.valid) {
                        return objCheck;
                    }
                    candidate.objectives = updates.objectives.map(
                        function(obj) {
                            return {
                                text: obj && typeof obj.text === 'string'
                                    ? obj.text
                                    : '',
                                done: obj && obj.done === true
                            };
                        }
                    );
                }

                // ---- Support personnel ----
                if (updates.supportPersonnel !== undefined) {
                    if (!Array.isArray(updates.supportPersonnel)) {
                        return {
                            valid: false,
                            message: 'Support personnel must be an array.'
                        };
                    }
                    candidate.supportPersonnel =
                        updates.supportPersonnel.slice();
                }

                // ---- Text and enum fields (validated by Schema) ----
                copyIfProvided(
                    candidate, updates, 'title',
                    function(v) {
                        return typeof v === 'string' ? v.trim() : v;
                    }
                );
                copyIfProvided(candidate, updates, 'description');
                copyIfProvided(candidate, updates, 'primaryType');
                copyIfProvided(candidate, updates, 'subtype');
                copyIfProvided(candidate, updates, 'secondaryType');
                copyIfProvided(candidate, updates, 'escalation');
                copyIfProvided(candidate, updates, 'threatType');
                copyIfProvided(candidate, updates, 'environment');
                copyIfProvided(candidate, updates, 'location');
                copyIfProvided(candidate, updates, 'duration');
                copyIfProvided(candidate, updates, 'difficulty');
                copyIfProvided(candidate, updates, 'priority');
                copyIfProvided(candidate, updates, 'basePay');
                copyIfProvided(candidate, updates, 'surchargePay');
                copyIfProvided(candidate, updates, 'billing');
                copyIfProvided(candidate, updates, 'notes');
                copyIfProvided(candidate, updates, 'tags');
                copyIfProvided(candidate, updates, 'assignedTeamId');
                copyIfProvided(candidate, updates, 'graduatingClassId');
                copyIfProvided(candidate, updates, 'classFilterEnabled');
                copyIfProvided(candidate, updates, 'year');
                copyIfProvided(candidate, updates, 'month');
                copyIfProvided(candidate, updates, 'day');

                // ---- Recompute derived fields ----
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                // ---- Structural validation on the final candidate ----
                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },

            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error(
                        'Mission disappeared between validate and mutate.'
                    );
                }

                if (!stagedCandidate) {
                    throw new Error(
                        'Mission candidate was not built during validate.'
                    );
                }

                appData.missions[idx] = deepClone(stagedCandidate);

                return {
                    mission: stagedCandidate,
                    id: target
                };
            },

            logMessage: function(result) {
                return 'Updated mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Mission updated.',
            failureMessage: 'Failed to update mission.'
        });
    }

    // ============================================================
    // ARCHIVE / UNARCHIVE / PURGE
    // ============================================================

    /**
     * Archive a mission. Sets archivedAt and status 'completed'.
     * History preserved.
     */
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
                if (!m.completedAt) {
                    m.completedAt = m.archivedAt;
                }
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

    /**
     * Unarchive a mission. Clears archivedAt. Status is left as-is;
     * the caller decides whether to transition status separately.
     */
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

    /**
     * Permanently remove a mission from the snapshot. Administrative.
     * Not wired to any ordinary UI action.
     */
    function purgeMission(missionId) {
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
    // OBJECTIVE COMMANDS
    // ============================================================

    /**
     * Set an objective's done flag to a specific value.
     *
     * Uses "set" semantics rather than "toggle": the caller
     * expresses the intended state. This avoids lost updates when
     * the UI is stale — an old checkbox checked against an old
     * record will set the intended value, not flip whatever the
     * current value happens to be.
     */
    function setObjectiveDone(missionId, index, done) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        if (typeof index !== 'number' ||
            !Number.isInteger(index) ||
            index < 0) {
            return Promise.resolve(
                failure('Objective index must be a non-negative integer.')
            );
        }

        if (typeof done !== 'boolean') {
            return Promise.resolve(
                failure('Objective done must be a boolean.')
            );
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

                var objCheck = MissionRules.validateObjectivesEditable(
                    current
                );
                if (!objCheck.valid) {
                    return objCheck;
                }

                if (!Array.isArray(current.objectives) ||
                    index >= current.objectives.length) {
                    return {
                        valid: false,
                        message: 'Objective index is out of range.'
                    };
                }

                var nowIso = new Date().toISOString();
                var candidate = deepClone(current);
                candidate.objectives[index] = {
                    text: candidate.objectives[index].text,
                    done: done
                };
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return { id: target, mission: stagedCandidate };
            },
            logMessage: function(result) {
                return 'Set objective ' + index + ' on mission ' +
                    (result.mission.title || target) +
                    ' to ' + done;
            },
            successMessage: 'Objective updated.',
            failureMessage: 'Failed to update objective.'
        });
    }

    /**
     * Add an objective to a mission.
     */
    function addObjective(missionId, text) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (!isNonEmptyString(text)) {
            return Promise.resolve(
                failure('Objective text is required.')
            );
        }
        var trimmed = text.trim();

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }
                var objCheck = MissionRules.validateObjectivesEditable(
                    current
                );
                if (!objCheck.valid) {
                    return objCheck;
                }

                var nowIso = new Date().toISOString();
                var candidate = deepClone(current);
                if (!Array.isArray(candidate.objectives)) {
                    candidate.objectives = [];
                }
                candidate.objectives.push({ text: trimmed, done: false });
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return { id: target, mission: stagedCandidate };
            },
            logMessage: function(result) {
                return 'Added objective to mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Objective added.',
            failureMessage: 'Failed to add objective.'
        });
    }

    /**
     * Remove an objective by index.
     */
    function removeObjective(missionId, index) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (typeof index !== 'number' ||
            !Number.isInteger(index) ||
            index < 0) {
            return Promise.resolve(
                failure('Objective index must be a non-negative integer.')
            );
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
                var objCheck = MissionRules.validateObjectivesEditable(
                    current
                );
                if (!objCheck.valid) {
                    return objCheck;
                }
                if (!Array.isArray(current.objectives) ||
                    index >= current.objectives.length) {
                    return {
                        valid: false,
                        message: 'Objective index is out of range.'
                    };
                }

                var nowIso = new Date().toISOString();
                var candidate = deepClone(current);
                candidate.objectives.splice(index, 1);
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return { id: target, mission: stagedCandidate };
            },
            logMessage: function(result) {
                return 'Removed objective from mission: ' +
                    (result.mission.title || target);
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

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }

                var support = Array.isArray(current.supportPersonnel)
                    ? current.supportPersonnel
                    : [];
                for (var i = 0; i < support.length; i++) {
                    if (normaliseId(support[i]) === charTarget) {
                        return {
                            valid: false,
                            message:
                                'Character is already assigned as support.'
                        };
                    }
                }

                var nowIso = new Date().toISOString();
                var candidate = deepClone(current);
                candidate.supportPersonnel = support.concat([charTarget]);
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return { id: target, mission: stagedCandidate };
            },
            logMessage: function(result) {
                return 'Added support to mission: ' +
                    (result.mission.title || target);
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

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }

                var support = Array.isArray(current.supportPersonnel)
                    ? current.supportPersonnel
                    : [];
                var found = false;
                for (var i = 0; i < support.length; i++) {
                    if (normaliseId(support[i]) === charTarget) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message:
                            'Character is not assigned as support.'
                    };
                }

                var nowIso = new Date().toISOString();
                var candidate = deepClone(current);
                candidate.supportPersonnel = support.filter(function(id) {
                    return normaliseId(id) !== charTarget;
                });
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return { id: target, mission: stagedCandidate };
            },
            logMessage: function(result) {
                return 'Removed support from mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Support personnel removed.',
            failureMessage: 'Failed to remove support personnel.'
        });
    }

    // ============================================================
    // LOG COMMAND
    // ============================================================

    /**
     * Append a log entry.
     *
     * Logs are historical events. They are appended, never edited
     * or removed through this API. A caller that wants to redact a
     * log entry would need a dedicated operation that does not
     * exist here.
     */
    function addLog(missionId, message) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (!isNonEmptyString(message)) {
            return Promise.resolve(
                failure('Log message is required.')
            );
        }
        var trimmed = message.trim();

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }

                var nowIso = new Date().toISOString();
                var candidate = deepClone(current);
                if (!Array.isArray(candidate.log)) {
                    candidate.log = [];
                }
                candidate.log.push({
                    timestamp: nowIso,
                    message: trimmed
                });
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return { id: target, mission: stagedCandidate };
            },
            logMessage: function(result) {
                return 'Added log entry to mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Log entry added.',
            failureMessage: 'Failed to add log entry.'
        });
    }

    // ============================================================
    // REPORT COMMANDS
    // ============================================================
    //
    // Reports are historical notes. Author may be null (redacted).
    // Editing a report updates its text and sets updatedAt.

    function addReport(missionId, authorId, text) {
        var target = normaliseId(missionId);
        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }

        var author = null;
        var authorRedacted = false;
        if (authorId !== undefined && authorId !== null && authorId !== '') {
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
            return Promise.resolve(
                failure('Report text is required.')
            );
        }
        var trimmedText = text.trim();

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }

                var nowIso = new Date().toISOString();
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

                candidate.reports.push(newReport);
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                stagedReportId = newReport.id;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return {
                    id: target,
                    mission: stagedCandidate,
                    reportId: stagedReportId
                };
            },
            logMessage: function(result) {
                return 'Added report to mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Report added.',
            failureMessage: 'Failed to add report.'
        });
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

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findMissionInSnapshot(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Mission no longer exists.'
                    };
                }

                if (!Array.isArray(current.reports)) {
                    return {
                        valid: false,
                        message: 'Report not found.'
                    };
                }

                var foundIndex = -1;
                for (var i = 0; i < current.reports.length; i++) {
                    if (normaliseId(current.reports[i].id) === reportTarget) {
                        foundIndex = i;
                        break;
                    }
                }
                if (foundIndex === -1) {
                    return {
                        valid: false,
                        message: 'Report not found.'
                    };
                }

                var nowIso = new Date().toISOString();
                var candidate = deepClone(current);
                var report = candidate.reports[foundIndex];
                report.text = trimmedText;
                report.updatedAt = nowIso;

                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return { id: target, mission: stagedCandidate };
            },
            logMessage: function(result) {
                return 'Updated report on mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Report updated.',
            failureMessage: 'Failed to update report.'
        });
    }

    /**
     * Remove a report.
     *
     * This is a HARD removal from the reports array. Reports are
     * the mission's notes, not the mission's history log — the log
     * is append-only. A user who writes a report in error should be
     * able to remove it. Historical preservation applies to the
     * mission itself, not to individual annotations about it.
     *
     * If you later decide that report removals should be soft (a
     * `removedAt` flag), change this function and update
     * MissionSchema to match. Nothing else depends on the removal
     * being hard.
     */
    function removeReport(missionId, reportId) {
        var target = normaliseId(missionId);
        var reportTarget = normaliseId(reportId);

        if (target === null) {
            return Promise.resolve(failure('Mission ID is required.'));
        }
        if (reportTarget === null) {
            return Promise.resolve(failure('Report ID is required.'));
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

                if (!Array.isArray(current.reports)) {
                    return {
                        valid: false,
                        message: 'Report not found.'
                    };
                }

                var found = false;
                for (var i = 0; i < current.reports.length; i++) {
                    if (normaliseId(current.reports[i].id) === reportTarget) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message: 'Report not found.'
                    };
                }

                var nowIso = new Date().toISOString();
                var candidate = deepClone(current);
                candidate.reports = candidate.reports.filter(
                    function(r) {
                        return normaliseId(r.id) !== reportTarget;
                    }
                );
                var final = finaliseCandidate(candidate, nowIso);
                final.completedAt = candidate.completedAt;

                var validated = MissionSchema.validateMission(final);
                if (!validated.valid) {
                    return {
                        valid: false,
                        message: validated.errors.join('; ')
                    };
                }

                stagedCandidate = final;
                return { valid: true };
            },
            mutate: function(appData) {
                var idx = findMissionIndexInSnapshot(appData, target);
                if (idx === -1) {
                    throw new Error('Mission no longer exists.');
                }
                appData.missions[idx] = deepClone(stagedCandidate);
                return { id: target, mission: stagedCandidate };
            },
            logMessage: function(result) {
                return 'Removed report from mission: ' +
                    (result.mission.title || target);
            },
            successMessage: 'Report removed.',
            failureMessage: 'Failed to remove report.'
        });
    }

    // ============================================================
    // INTERNAL UTILITIES
    // ============================================================

    /**
     * If `updates[field]` is present (not undefined), copy it onto
     * `candidate`, optionally transforming it first.
     */
    function copyIfProvided(candidate, updates, field, transform) {
        if (updates[field] === undefined) {
            return;
        }
        var value = updates[field];
        if (typeof transform === 'function') {
            value = transform(value);
        }
        candidate[field] = value;
    }

    // ============================================================
    // STAGING
    // ============================================================
    //
    // The pipeline gives validate and mutate separate callbacks that
    // share no arguments. Each performMutation call is synchronous
    // within a single mutation, so a module-level staging slot is
    // safe here: only one mutation can be inside the pipeline at
    // once for this module. The slot is cleared at the start of each
    // mutation's validate, and overwritten before mutate runs.
    //
    // This is deliberately not reentrant. If you ever add a mutation
    // that calls another mission mutation from inside its own
    // validate callback, the outer slot will be overwritten. Don't
    // do that.

    var stagedCandidate = null;
    var stagedReportId = null;

    function beginStaging() {
        stagedCandidate = null;
        stagedReportId = null;
    }

    // Wrap each public mutation to clear staging at entry.
    function wrapMutation(fn) {
        return function() {
            beginStaging();
            return fn.apply(null, arguments);
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionCore = Object.freeze({
        // Lifecycle
        createMission: wrapMutation(createMission),
        updateMission: wrapMutation(updateMission),
        archiveMission: wrapMutation(archiveMission),
        unarchiveMission: wrapMutation(unarchiveMission),
        purgeMission: wrapMutation(purgeMission),

        // Status
        completeMission: wrapMutation(completeMission),
        cancelMission: wrapMutation(cancelMission),
        reactivateMission: wrapMutation(reactivateMission),

        // Objectives
        setObjectiveDone: wrapMutation(setObjectiveDone),
        addObjective: wrapMutation(addObjective),
        removeObjective: wrapMutation(removeObjective),

        // Support personnel
        addSupportPersonnel: wrapMutation(addSupportPersonnel),
        removeSupportPersonnel: wrapMutation(removeSupportPersonnel),

        // Log
        addLog: wrapMutation(addLog),

        // Reports
        addReport: wrapMutation(addReport),
        updateReport: wrapMutation(updateReport),
        removeReport: wrapMutation(removeReport)
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionCore;
        var missing = [];

        var required = [
            'createMission',
            'updateMission',
            'archiveMission',
            'unarchiveMission',
            'purgeMission',
            'completeMission',
            'cancelMission',
            'reactivateMission',
            'setObjectiveDone',
            'addObjective',
            'removeObjective',
            'addSupportPersonnel',
            'removeSupportPersonnel',
            'addLog',
            'addReport',
            'updateReport',
            'removeReport'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionCore] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
