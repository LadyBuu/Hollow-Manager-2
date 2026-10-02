/**
 * modules/departments/department-core.js - Department Core
 *
 * Path: js/modules/departments/department-core.js
 *
 * Canonical mutation API for departments.
 *
 * WHAT THIS OWNS:
 *   - Department CRUD: create, update, delete.
 *   - Member mutations: add, remove.
 *   - Interval mutations: end, reopen.
 *   - Head assignment (setHead).
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads. DepartmentQueries owns them.
 *   - Structural validation. DepartmentSchema owns it.
 *   - Character-state policy. Whether a character is retired or
 *     deceased is a read-time concern, not a write-time one. The
 *     mutation layer accepts any character that exists.
 *   - Cross-domain cascades. Departments do not cascade on
 *     character death or retirement.
 *
 * MUTATION MODEL:
 *   Every mutation routes through MutationPipeline. Validation
 *   runs twice:
 *     1. Pre-flight against window.data.
 *     2. Snapshot-scoped inside pipeline.validate().
 *   The candidate is re-derived inside mutate() from the same
 *   snapshot, so the applied state never diverges from what was
 *   validated.
 *
 * MEMBERSHIP MODEL:
 *   A department's members array is a list of entries:
 *     {
 *       characterId: string,
 *       intervals: [ { joinPeriod, leavePeriod }, ... ]
 *     }
 *
 *   Intervals within one entry must not overlap, and at most one
 *   interval may be open. Both invariants are enforced by
 *   DepartmentSchema.
 *
 * SETHEAD INVARIANT:
 *   headId must resolve to a member characterId on the department
 *   and to an existing character. Both checks re-run against the
 *   snapshot. setHead does NOT add the character as a member; the
 *   caller must add them first.
 *
 * IDS:
 *   New department IDs are generated via IdUtils with the prefix
 *   from DepartmentConstants. No homemade generation.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.MutationPipeline
 *   - window.ObjectUtils
 *   - window.IdUtils
 *   - window.DepartmentSchema
 *   - window.DepartmentConstants
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.CharacterQueries (character existence checks)
 */

(function() {
    'use strict';

    if (window.__departmentCoreLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var MutationPipeline = window.MutationPipeline;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var DepartmentSchema = window.DepartmentSchema;
    var DepartmentConstants = window.DepartmentConstants;

    var _missing = [];

    if (!MutationPipeline ||
        typeof MutationPipeline.performMutation !== 'function') {
        _missing.push('MutationPipeline.performMutation');
    }
    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!IdUtils) {
        _missing.push('IdUtils (module)');
    } else {
        if (typeof IdUtils.generateId !== 'function') {
            _missing.push('IdUtils.generateId');
        }
        if (typeof IdUtils.normaliseId !== 'function') {
            _missing.push('IdUtils.normaliseId');
        }
    }
    if (!DepartmentSchema) {
        _missing.push('DepartmentSchema (module)');
    } else {
        if (typeof DepartmentSchema.parseYear !== 'function') {
            _missing.push('DepartmentSchema.parseYear');
        }
        if (typeof DepartmentSchema.validateDepartment !== 'function') {
            _missing.push('DepartmentSchema.validateDepartment');
        }
        if (typeof DepartmentSchema.canonicaliseDepartmentShape !==
            'function') {
            _missing.push(
                'DepartmentSchema.canonicaliseDepartmentShape'
            );
        }
        if (typeof DepartmentSchema.validateIntervalShape !== 'function') {
            _missing.push(
                'DepartmentSchema.validateIntervalShape'
            );
        }
        if (typeof DepartmentSchema.intervalsOverlap !== 'function') {
            _missing.push(
                'DepartmentSchema.intervalsOverlap'
            );
        }
    }
    if (!DepartmentConstants) {
        _missing.push('DepartmentConstants (module)');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[DepartmentCore] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__departmentCoreLoaded = true;

    // ============================================================
    // LAZY ACCESSORS
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

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

    function generateDepartmentId() {
        var prefix = DepartmentConstants.getDepartmentIdPrefix
            ? DepartmentConstants.getDepartmentIdPrefix()
            : 'dept';
        return IdUtils.generateId(prefix);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value &&
            value !== null &&
            typeof value === 'object') {
            throw new Error(
                '[DepartmentCore] deepClone returned the original ' +
                'reference.'
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

    function parseYear(value) {
        return DepartmentSchema.parseYear(value);
    }

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function ensureDepartmentArray(appData) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!Array.isArray(appData.departments)) {
            appData.departments = [];
        }
        return appData.departments;
    }

    function findDepartmentInData(data, deptId) {
        if (!data || !Array.isArray(data.departments)) {
            return null;
        }
        var target = normaliseId(deptId);
        if (target === null) { return null; }

        var departments = data.departments;
        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (dept && typeof dept === 'object' &&
                String(dept.id) === target) {
                return dept;
            }
        }
        return null;
    }

    function findDepartmentIndexInData(data, deptId) {
        if (!data || !Array.isArray(data.departments)) {
            return -1;
        }
        var target = normaliseId(deptId);
        if (target === null) { return -1; }

        var departments = data.departments;
        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (dept && typeof dept === 'object' &&
                String(dept.id) === target) {
                return i;
            }
        }
        return -1;
    }

    function characterExistsInData(data, charId) {
        var CQ = getCharacterQueries();
        var target = normaliseId(charId);
        if (target === null) { return false; }

        // Snapshot-aware check.
        if (data && Array.isArray(data.characters)) {
            for (var i = 0; i < data.characters.length; i++) {
                var c = data.characters[i];
                if (c && String(c.id) === target) {
                    return true;
                }
            }
            return false;
        }

        // Live fallback.
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return false;
        }
        var char = CQ.getCharacterById(target);
        return char !== null && char !== undefined;
    }

    // ============================================================
    // NAME COLLISION CHECK
    // ============================================================
    //
    // Department names are not required to be unique by the
    // schema, but the create and update paths reject a duplicate
    // to prevent two departments from being indistinguishable in
    // the UI. The check is case-insensitive.

    function hasDuplicateName(data, name, excludeId) {
        if (!data || !Array.isArray(data.departments)) {
            return false;
        }
        var target = String(name).trim().toLowerCase();
        if (target === '') { return false; }
        var exclude = excludeId !== undefined && excludeId !== null
            ? normaliseId(excludeId)
            : null;

        var departments = data.departments;
        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (!dept || typeof dept !== 'object') { continue; }
            if (exclude !== null &&
                String(dept.id) === exclude) {
                continue;
            }
            var deptName = typeof dept.name === 'string'
                ? dept.name.trim().toLowerCase()
                : '';
            if (deptName === target) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // INTERVAL HELPERS
    // ============================================================

    function findIntervalIndex(entry, joinPeriod) {
        if (!entry || !Array.isArray(entry.intervals)) {
            return -1;
        }
        var target = parseYear(joinPeriod);
        if (target === null) { return -1; }

        for (var i = 0; i < entry.intervals.length; i++) {
            var iv = entry.intervals[i];
            if (!iv || typeof iv !== 'object') { continue; }
            var join = parseYear(iv.joinPeriod);
            if (join === target) { return i; }
        }
        return -1;
    }

    function findMemberIndex(dept, characterId) {
        if (!dept || !Array.isArray(dept.members)) { return -1; }
        var target = normaliseId(characterId);
        if (target === null) { return -1; }

        for (var i = 0; i < dept.members.length; i++) {
            var member = dept.members[i];
            if (member && typeof member === 'object' &&
                String(member.characterId) === target) {
                return i;
            }
        }
        return -1;
    }

    // ============================================================
    // CREATE
    // ============================================================

    function createDepartment(data) {
        if (!isPlainObject(data)) {
            return Promise.resolve(
                failure('Department data is required.')
            );
        }

        var nameCheck = DepartmentSchema.validateDepartmentName(
            data.name
        );
        if (!nameCheck.valid) {
            return Promise.resolve(failure(nameCheck.message));
        }

        var name = nameCheck.value;
        var description = typeof data.description === 'string'
            ? data.description
            : '';
        var headId = data.headId !== undefined && data.headId !== null
            ? normaliseId(data.headId)
            : null;

        if (data.headId !== undefined &&
            data.headId !== null &&
            headId === null) {
            return Promise.resolve(failure(
                'Invalid headId.'
            ));
        }

        // Head is a member of a NEW department only when the head
        // is also being added as the first member. When headId is
        // provided on create but no members are provided, the head
        // is not yet a member and the schema rejects the record.
        // Instead of rejecting, the create path accepts an optional
        // initialHead flag which, when true, adds the head as the
        // department's first member. Callers that want a headless
        // department pass headId: null.
        var members = [];
        var initialHead = data.initialHead === true;

        if (headId !== null && initialHead) {
            var joinCanon = parseYear(data.headJoinPeriod);
            if (joinCanon === null) {
                return Promise.resolve(failure(
                    'A head added on create requires a valid ' +
                    'headJoinPeriod.'
                ));
            }
            members.push({
                characterId: headId,
                intervals: [{
                    joinPeriod: String(joinCanon),
                    leavePeriod: ''
                }]
            });
        } else if (headId !== null && !initialHead) {
            // Caller provided headId but did not add them as a
            // member. Drop the headId rather than silently
            // producing an invalid record.
            headId = null;
        }

        var nowIso = new Date().toISOString();

        var raw = {
            id: generateDepartmentId(),
            name: name,
            description: description,
            headId: headId,
            createdAt: nowIso,
            members: members
        };

        var canonical = DepartmentSchema.canonicaliseDepartmentShape(
            raw
        );
        if (!canonical.valid || !canonical.value) {
            return Promise.resolve(failure(
                canonical.errors.join('; ')
            ));
        }

        var candidate = canonical.value;
        var targetId = candidate.id;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }

                var departments = ensureDepartmentArray(appData);
                if (!departments) {
                    return {
                        valid: false,
                        message: 'Department store is not available.'
                    };
                }

                if (findDepartmentInData(appData, targetId)) {
                    return {
                        valid: false,
                        message: 'Department ID collision.'
                    };
                }

                if (hasDuplicateName(appData, candidate.name, null)) {
                    return {
                        valid: false,
                        message: 'A department with that name already ' +
                            'exists.'
                    };
                }

                if (candidate.headId !== null) {
                    if (!characterExistsInData(
                        appData, candidate.headId
                    )) {
                        return {
                            valid: false,
                            message: 'Head character not found.'
                        };
                    }
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var departments = ensureDepartmentArray(appData);
                if (!departments) {
                    throw new Error(
                        'Department store is not available.'
                    );
                }

                departments.push(deepClone(candidate));

                return { department: candidate, id: targetId };
            },

            logMessage: 'Created department: ' + candidate.name,
            successMessage: 'Department created.',
            failureMessage: 'Failed to create department.'
        });
    }

    // ============================================================
    // UPDATE
    // ============================================================

    function updateDepartment(deptId, updates) {
        var target = normaliseId(deptId);
        if (target === null) {
            return Promise.resolve(failure(
                'Department ID is required.'
            ));
        }
        if (!isPlainObject(updates) ||
            Object.keys(updates).length === 0) {
            return Promise.resolve(failure(
                'Updates must be a non-empty object.'
            ));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findDepartmentInData(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Department no longer exists.'
                    };
                }

                var candidate = deepClone(current);

                if (updates.name !== undefined) {
                    var nameCheck =
                        DepartmentSchema.validateDepartmentName(
                            updates.name
                        );
                    if (!nameCheck.valid) {
                        return {
                            valid: false,
                            message: nameCheck.message
                        };
                    }
                    candidate.name = nameCheck.value;

                    if (hasDuplicateName(
                        appData, candidate.name, target
                    )) {
                        return {
                            valid: false,
                            message: 'A department with that name ' +
                                'already exists.'
                        };
                    }
                }

                if (updates.description !== undefined) {
                    if (updates.description !== null &&
                        typeof updates.description !== 'string') {
                        return {
                            valid: false,
                            message: 'Description must be a string.'
                        };
                    }
                    candidate.description =
                        updates.description === null
                            ? ''
                            : updates.description;
                }

                if (updates.headId !== undefined) {
                    if (updates.headId === null) {
                        candidate.headId = null;
                    } else {
                        var head = normaliseId(updates.headId);
                        if (head === null) {
                            return {
                                valid: false,
                                message: 'Invalid headId.'
                            };
                        }
                        if (!characterExistsInData(appData, head)) {
                            return {
                                valid: false,
                                message: 'Head character not found.'
                            };
                        }
                        if (!Array.isArray(candidate.members) ||
                            findMemberIndex(candidate, head) === -1) {
                            return {
                                valid: false,
                                message: 'Head must be a member of ' +
                                    'the department.'
                            };
                        }
                        candidate.headId = head;
                    }
                }

                var check = DepartmentSchema.validateDepartment(
                    candidate
                );
                if (!check.valid) {
                    return {
                        valid: false,
                        message: check.errors.join('; ')
                    };
                }

                return { valid: true, candidate: candidate };
            },

            mutate: function(appData) {
                var idx = findDepartmentIndexInData(appData, target);
                if (idx === -1) {
                    throw new Error(
                        'Department not found in data store.'
                    );
                }

                // Rebuild the candidate from the snapshot to match
                // the validator's decision.
                var current = appData.departments[idx];
                var candidate = deepClone(current);

                if (updates.name !== undefined) {
                    candidate.name =
                        DepartmentSchema
                            .validateDepartmentName(updates.name)
                            .value;
                }
                if (updates.description !== undefined) {
                    candidate.description =
                        updates.description === null
                            ? ''
                            : updates.description;
                }
                if (updates.headId !== undefined) {
                    candidate.headId = updates.headId === null
                        ? null
                        : normaliseId(updates.headId);
                }

                appData.departments[idx] = candidate;

                return { department: candidate, id: target };
            },

            logMessage: function(result) {
                return 'Updated department: ' +
                    (result.department.name || target);
            },
            successMessage: 'Department updated.',
            failureMessage: 'Failed to update department.'
        });
    }

    // ============================================================
    // DELETE
    // ============================================================

    function deleteDepartment(deptId) {
        var target = normaliseId(deptId);
        if (target === null) {
            return Promise.resolve(failure(
                'Department ID is required.'
            ));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findDepartmentInData(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Department no longer exists.'
                    };
                }
                return { valid: true };
            },

            mutate: function(appData) {
                var idx = findDepartmentIndexInData(
                    appData, target
                );
                if (idx === -1) {
                    throw new Error(
                        'Department not found in data store.'
                    );
                }

                var current = appData.departments[idx];
                var name = current && typeof current.name === 'string'
                    ? current.name
                    : target;

                appData.departments.splice(idx, 1);

                return { id: target, name: name };
            },

            logMessage: function(result) {
                return 'Deleted department: ' + result.name;
            },
            successMessage: 'Department deleted.',
            failureMessage: 'Failed to delete department.'
        });
    }

    // ============================================================
    // ADD MEMBER
    // ============================================================

    function addMember(deptId, characterId, joinPeriod) {
        var target = normaliseId(deptId);
        var charTarget = normaliseId(characterId);

        if (target === null) {
            return Promise.resolve(failure(
                'Department ID is required.'
            ));
        }
        if (charTarget === null) {
            return Promise.resolve(failure(
                'Character ID is required.'
            ));
        }

        var joinCanon = parseYear(joinPeriod);
        if (joinCanon === null) {
            return Promise.resolve(failure(
                'A valid join year is required.'
            ));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findDepartmentInData(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Department no longer exists.'
                    };
                }

                if (!characterExistsInData(appData, charTarget)) {
                    return {
                        valid: false,
                        message: 'Character not found.'
                    };
                }

                var candidate = deepClone(current);
                if (!Array.isArray(candidate.members)) {
                    candidate.members = [];
                }

                var existing = null;
                for (var i = 0; i < candidate.members.length; i++) {
                    var m = candidate.members[i];
                    if (m && String(m.characterId) === charTarget) {
                        existing = m;
                        break;
                    }
                }

                if (!existing) {
                    candidate.members.push({
                        characterId: charTarget,
                        intervals: [{
                            joinPeriod: String(joinCanon),
                            leavePeriod: ''
                        }]
                    });
                } else {
                    if (!Array.isArray(existing.intervals)) {
                        existing.intervals = [];
                    }
                    existing.intervals.push({
                        joinPeriod: String(joinCanon),
                        leavePeriod: ''
                    });
                }

                var check = DepartmentSchema.validateDepartment(
                    candidate
                );
                if (!check.valid) {
                    return {
                        valid: false,
                        message: check.errors.join('; ')
                    };
                }

                return { valid: true, candidate: candidate };
            },

            mutate: function(appData) {
                var idx = findDepartmentIndexInData(
                    appData, target
                );
                if (idx === -1) {
                    throw new Error(
                        'Department not found in data store.'
                    );
                }

                var current = appData.departments[idx];
                if (!Array.isArray(current.members)) {
                    current.members = [];
                }

                var member = null;
                for (var i = 0; i < current.members.length; i++) {
                    var m = current.members[i];
                    if (m && String(m.characterId) === charTarget) {
                        member = m;
                        break;
                    }
                }

                if (!member) {
                    member = {
                        characterId: charTarget,
                        intervals: []
                    };
                    current.members.push(member);
                }
                if (!Array.isArray(member.intervals)) {
                    member.intervals = [];
                }
                member.intervals.push({
                    joinPeriod: String(joinCanon),
                    leavePeriod: ''
                });

                return {
                    characterId: charTarget,
                    joinPeriod: String(joinCanon)
                };
            },

            logMessage: function() {
                return 'Added member to department.';
            },
            successMessage: 'Member added.',
            failureMessage: 'Failed to add member.'
        });
    }

    // ============================================================
    // REMOVE MEMBER
    // ============================================================

    function removeMember(deptId, characterId) {
        var target = normaliseId(deptId);
        var charTarget = normaliseId(characterId);

        if (target === null) {
            return Promise.resolve(failure(
                'Department ID is required.'
            ));
        }
        if (charTarget === null) {
            return Promise.resolve(failure(
                'Character ID is required.'
            ));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findDepartmentInData(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Department no longer exists.'
                    };
                }

                if (findMemberIndex(current, charTarget) === -1) {
                    return {
                        valid: false,
                        message: 'Character is not a member of this ' +
                            'department.'
                    };
                }

                // Cannot remove the head. The caller must first
                // clear headId.
                if (current.headId &&
                    String(current.headId) === charTarget) {
                    return {
                        valid: false,
                        message: 'Cannot remove the department head. ' +
                            'Assign a new head first.'
                    };
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var idx = findDepartmentIndexInData(
                    appData, target
                );
                if (idx === -1) {
                    throw new Error(
                        'Department not found in data store.'
                    );
                }

                var current = appData.departments[idx];
                current.members = current.members.filter(
                    function(m) {
                        return !m ||
                            String(m.characterId) !== charTarget;
                    }
                );

                return { characterId: charTarget };
            },

            logMessage: function() {
                return 'Removed member from department.';
            },
            successMessage: 'Member removed.',
            failureMessage: 'Failed to remove member.'
        });
    }

    // ============================================================
    // END MEMBER INTERVAL
    // ============================================================

    function endMemberInterval(
        deptId,
        characterId,
        joinPeriod,
        leavePeriod
    ) {
        var target = normaliseId(deptId);
        var charTarget = normaliseId(characterId);

        if (target === null) {
            return Promise.resolve(failure(
                'Department ID is required.'
            ));
        }
        if (charTarget === null) {
            return Promise.resolve(failure(
                'Character ID is required.'
            ));
        }

        var joinCanon = parseYear(joinPeriod);
        if (joinCanon === null) {
            return Promise.resolve(failure(
                'Invalid join year.'
            ));
        }

        var leaveCanon = parseYear(leavePeriod);
        if (leaveCanon === null) {
            return Promise.resolve(failure(
                'Invalid leave year.'
            ));
        }

        if (leaveCanon < joinCanon) {
            return Promise.resolve(failure(
                'Leave year cannot be before join year.'
            ));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findDepartmentInData(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Department no longer exists.'
                    };
                }

                var memberIdx = findMemberIndex(
                    current, charTarget
                );
                if (memberIdx === -1) {
                    return {
                        valid: false,
                        message: 'Character is not a member.'
                    };
                }

                var member = current.members[memberIdx];
                var ivIdx = findIntervalIndex(member, joinCanon);
                if (ivIdx === -1) {
                    return {
                        valid: false,
                        message: 'Interval not found.'
                    };
                }

                var existing = member.intervals[ivIdx];
                var existingLeave = parseYear(existing.leavePeriod);
                if (existingLeave !== null &&
                    existingLeave <= leaveCanon) {
                    return {
                        valid: false,
                        message: 'Interval is already closed at or ' +
                            'before year ' + leaveCanon + '.'
                    };
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var idx = findDepartmentIndexInData(
                    appData, target
                );
                if (idx === -1) {
                    throw new Error(
                        'Department not found in data store.'
                    );
                }

                var current = appData.departments[idx];
                var memberIdx = findMemberIndex(
                    current, charTarget
                );
                var member = current.members[memberIdx];
                var ivIdx = findIntervalIndex(member, joinCanon);
                member.intervals[ivIdx].leavePeriod =
                    String(leaveCanon);

                return {
                    characterId: charTarget,
                    joinPeriod: String(joinCanon),
                    leavePeriod: String(leaveCanon)
                };
            },

            logMessage: function() {
                return 'Ended member interval.';
            },
            successMessage: 'Interval closed.',
            failureMessage: 'Failed to close interval.'
        });
    }

    // ============================================================
    // REOPEN MEMBER INTERVAL
    // ============================================================

    function reopenMemberInterval(deptId, characterId, joinPeriod) {
        var target = normaliseId(deptId);
        var charTarget = normaliseId(characterId);

        if (target === null) {
            return Promise.resolve(failure(
                'Department ID is required.'
            ));
        }
        if (charTarget === null) {
            return Promise.resolve(failure(
                'Character ID is required.'
            ));
        }

        var joinCanon = parseYear(joinPeriod);
        if (joinCanon === null) {
            return Promise.resolve(failure(
                'Invalid join year.'
            ));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findDepartmentInData(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Department no longer exists.'
                    };
                }

                var memberIdx = findMemberIndex(
                    current, charTarget
                );
                if (memberIdx === -1) {
                    return {
                        valid: false,
                        message: 'Character is not a member.'
                    };
                }

                var member = current.members[memberIdx];
                var ivIdx = findIntervalIndex(member, joinCanon);
                if (ivIdx === -1) {
                    return {
                        valid: false,
                        message: 'Interval not found.'
                    };
                }

                var interval = member.intervals[ivIdx];
                var leave = parseYear(interval.leavePeriod);
                if (leave === null) {
                    return {
                        valid: false,
                        message: 'Interval is already open.'
                    };
                }

                // Reopening makes this interval [join, Infinity].
                // It must not overlap any sibling interval, and it
                // must not be a second open interval in the same
                // member entry.
                for (var k = 0; k < member.intervals.length; k++) {
                    if (k === ivIdx) { continue; }
                    var other = member.intervals[k];
                    if (!other || typeof other !== 'object') {
                        continue;
                    }
                    if (DepartmentSchema.intervalsOverlap(
                        {
                            joinPeriod: interval.joinPeriod,
                            leavePeriod: ''
                        },
                        other
                    )) {
                        return {
                            valid: false,
                            message: 'Reopening this interval would ' +
                                'overlap a sibling interval.'
                        };
                    }
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var idx = findDepartmentIndexInData(
                    appData, target
                );
                if (idx === -1) {
                    throw new Error(
                        'Department not found in data store.'
                    );
                }

                var current = appData.departments[idx];
                var memberIdx = findMemberIndex(
                    current, charTarget
                );
                var member = current.members[memberIdx];
                var ivIdx = findIntervalIndex(member, joinCanon);
                member.intervals[ivIdx].leavePeriod = '';

                return {
                    characterId: charTarget,
                    joinPeriod: String(joinCanon)
                };
            },

            logMessage: function() {
                return 'Reopened member interval.';
            },
            successMessage: 'Interval reopened.',
            failureMessage: 'Failed to reopen interval.'
        });
    }

    // ============================================================
    // SET HEAD
    // ============================================================

    function setHead(deptId, characterId) {
        var target = normaliseId(deptId);
        if (target === null) {
            return Promise.resolve(failure(
                'Department ID is required.'
            ));
        }

        var head = characterId === null || characterId === undefined
            ? null
            : normaliseId(characterId);

        if (characterId !== null &&
            characterId !== undefined &&
            head === null) {
            return Promise.resolve(failure(
                'Invalid character ID.'
            ));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                var current = findDepartmentInData(appData, target);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Department no longer exists.'
                    };
                }

                if (head === null) {
                    return { valid: true };
                }

                if (!characterExistsInData(appData, head)) {
                    return {
                        valid: false,
                        message: 'Character not found.'
                    };
                }

                if (findMemberIndex(current, head) === -1) {
                    return {
                        valid: false,
                        message: 'Head must be a member of the ' +
                            'department.'
                    };
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var idx = findDepartmentIndexInData(
                    appData, target
                );
                if (idx === -1) {
                    throw new Error(
                        'Department not found in data store.'
                    );
                }

                appData.departments[idx].headId = head;

                return {
                    characterId: head,
                    departmentId: target
                };
            },

            logMessage: function(result) {
                if (result.characterId === null) {
                    return 'Cleared department head.';
                }
                return 'Set department head.';
            },
            successMessage: function(result) {
                return result.characterId === null
                    ? 'Head cleared.'
                    : 'Head assigned.';
            },
            failureMessage: 'Failed to set head.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DepartmentCore = Object.freeze({
        createDepartment: createDepartment,
        updateDepartment: updateDepartment,
        deleteDepartment: deleteDepartment,

        addMember: addMember,
        removeMember: removeMember,
        endMemberInterval: endMemberInterval,
        reopenMemberInterval: reopenMemberInterval,

        setHead: setHead
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.DepartmentCore;
        var missing = [];

        var required = [
            'createDepartment',
            'updateDepartment',
            'deleteDepartment',
            'addMember',
            'removeMember',
            'endMemberInterval',
            'reopenMemberInterval',
            'setHead'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[DepartmentCore] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
