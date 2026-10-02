/**
 * modules/departments/department-schema.js - Department Schema
 *
 * Path: js/modules/departments/department-schema.js
 *
 * Structural validation and canonicalisation for departments.
 *
 * WHAT THIS OWNS:
 *   - The canonical department shape.
 *   - Structural validation of a department record.
 *   - Structural validation of nested records (member entries,
 *     intervals).
 *   - Conservative canonicalisation: given a structurally valid
 *     input, produce the canonical representation.
 *   - Year parsing for interval bounds.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Cross-domain existence checks. Whether the `headId`
 *     character exists, whether a member's character ID exists,
 *     whether those are stored in window.data.characters — none
 *     of that is here. The mutation layer re-checks against the
 *     transaction snapshot.
 *   - Storage or queries. Departments live at
 *     window.data.departments; the schema never touches it.
 *   - Vocabularies. There are no enums in a department. The ID
 *     prefix comes from DepartmentConstants.
 *
 * CANONICAL DEPARTMENT SHAPE:
 *
 *   {
 *     id:          string,           // IdUtils-generated; not
 *                                    // generated here
 *     name:        string,           // required, non-empty
 *     description: string,
 *     headId:      string | null,    // character ID; must equal
 *                                    // one of the member
 *                                    // characterIds
 *     createdAt:   string,           // ISO 8601 timestamp
 *     members: [
 *       {
 *         characterId: string,
 *         intervals:   [
 *           { joinPeriod, leavePeriod }
 *         ]
 *       }
 *     ]
 *   }
 *
 *   Both interval bounds are year STRINGS. Blank ('') means
 *   unbounded on that side.
 *
 * MEMBERSHIP INVARIANTS:
 *   - Each member entry has a distinct characterId.
 *   - Each member entry has at least one interval.
 *   - Within one member entry, intervals do not overlap.
 *   - Within one member entry, at most one interval is open
 *     (leavePeriod === '').
 *   - Every interval has a valid joinPeriod (blank is not
 *     permitted on the join side; a stint must have a start).
 *   - Every interval's leavePeriod, when set, is >= its
 *     joinPeriod.
 *   - headId, when set, matches one of the member characterIds.
 *     It does NOT need to be an active member (a head can be
 *     historical, since the character may have left the
 *     department).
 *
 * YEAR PARSING:
 *   Years are unbounded positive integers. The parser accepts
 *   integers and pure-digit strings, rejects everything else. It
 *   is exposed here as `parseYear` so the mutation layer, the
 *   aggregator, and any other consumer share one implementation.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.IdUtils
 *   - window.ObjectUtils
 *   - window.DepartmentConstants
 */

(function() {
    'use strict';

    if (window.__departmentSchemaLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var IdUtils = window.IdUtils;
    var ObjectUtils = window.ObjectUtils;
    var DepartmentConstants = window.DepartmentConstants;

    var _missing = [];

    if (!IdUtils || typeof IdUtils.normaliseId !== 'function') {
        _missing.push('IdUtils.normaliseId');
    }
    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!DepartmentConstants) {
        _missing.push('DepartmentConstants (module)');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[DepartmentSchema] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__departmentSchemaLoaded = true;

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

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value &&
            value !== null &&
            typeof value === 'object') {
            throw new Error(
                '[DepartmentSchema] deepClone returned the original ' +
                'reference.'
            );
        }
        return result;
    }

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function isStrictIsoTimestamp(value) {
        if (typeof value !== 'string' || value === '') {
            return false;
        }
        var parsed = new Date(value);
        if (isNaN(parsed.getTime())) { return false; }
        return parsed.toISOString() === value;
    }

    // ============================================================
    // YEAR PARSING
    // ============================================================
    //
    // Years are unbounded positive integers. Accepts integers and
    // pure-digit strings. Rejects everything else. Never coerces.

    function parseYear(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) {
                return null;
            }
            if (!Number.isSafeInteger(value)) { return null; }
            return value;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var num = Number(trimmed);
            if (!Number.isSafeInteger(num) || num < 1) {
                return null;
            }
            return num;
        }

        return null;
    }

    // ============================================================
    // INTERVAL VALIDATION
    // ============================================================

    function validateIntervalShape(raw) {
        if (!isPlainObject(raw)) {
            return {
                valid: false,
                message: 'Interval must be an object.'
            };
        }

        // Join is required. A stint must have a start.
        var join = parseYear(raw.joinPeriod);
        if (join === null) {
            return {
                valid: false,
                message: 'Interval joinPeriod must be a positive ' +
                    'integer.'
            };
        }

        // Leave is optional. Blank means open-ended.
        var leaveRaw = raw.leavePeriod;
        var leave = null;
        if (leaveRaw !== undefined &&
            leaveRaw !== null &&
            String(leaveRaw).trim() !== '') {
            leave = parseYear(leaveRaw);
            if (leave === null) {
                return {
                    valid: false,
                    message: 'Interval leavePeriod must be a positive ' +
                        'integer or blank.'
                };
            }
            if (leave < join) {
                return {
                    valid: false,
                    message: 'Interval leavePeriod cannot be before ' +
                        'joinPeriod.'
                };
            }
        }

        return {
            valid: true,
            interval: {
                joinPeriod: String(join),
                leavePeriod: leave === null ? '' : String(leave)
            }
        };
    }

    function intervalsOverlap(a, b) {
        var aJoin = parseYear(a.joinPeriod);
        var aLeave = parseYear(a.leavePeriod);
        var bJoin = parseYear(b.joinPeriod);
        var bLeave = parseYear(b.leavePeriod);

        if (aJoin === null || bJoin === null) {
            // Should be unreachable; callers validate first.
            return true;
        }

        // Blank leave = open-ended = Infinity for comparison.
        var aEnd = (aLeave === null) ? Infinity : aLeave;
        var bEnd = (bLeave === null) ? Infinity : bLeave;

        return aJoin <= bEnd && bJoin <= aEnd;
    }

    function validateMemberIntervals(rawIntervals) {
        if (!Array.isArray(rawIntervals)) {
            return {
                valid: false,
                message: 'Intervals must be an array.'
            };
        }

        if (rawIntervals.length === 0) {
            return {
                valid: false,
                message: 'A member entry must contain at least one ' +
                    'interval.'
            };
        }

        var cleaned = [];
        for (var i = 0; i < rawIntervals.length; i++) {
            var check = validateIntervalShape(rawIntervals[i]);
            if (!check.valid) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) + ': ' +
                        check.message
                };
            }
            cleaned.push(check.interval);
        }

        // Overlap: no two intervals in the same member entry may
        // overlap.
        for (var a = 0; a < cleaned.length; a++) {
            for (var b = a + 1; b < cleaned.length; b++) {
                if (intervalsOverlap(cleaned[a], cleaned[b])) {
                    return {
                        valid: false,
                        message: 'Intervals ' + (a + 1) + ' and ' +
                            (b + 1) + ' overlap.'
                    };
                }
            }
        }

        // Single open interval: at most one interval may have a
        // blank leave.
        var openCount = 0;
        for (var k = 0; k < cleaned.length; k++) {
            if (cleaned[k].leavePeriod === '') { openCount++; }
        }
        if (openCount > 1) {
            return {
                valid: false,
                message: 'A member entry may have at most one open ' +
                    'interval.'
            };
        }

        return { valid: true, intervals: cleaned };
    }

    // ============================================================
    // MEMBER VALIDATION
    // ============================================================

    function validateMemberEntry(raw) {
        if (!isPlainObject(raw)) {
            return {
                valid: false,
                message: 'Member entry must be an object.'
            };
        }

        var charId = normaliseId(raw.characterId);
        if (charId === null) {
            return {
                valid: false,
                message: 'Member entry requires a characterId.'
            };
        }

        var intervalsCheck = validateMemberIntervals(raw.intervals);
        if (!intervalsCheck.valid) { return intervalsCheck; }

        return {
            valid: true,
            member: {
                characterId: charId,
                intervals: intervalsCheck.intervals
            }
        };
    }

    function validateMembersUnique(members) {
        var seen = Object.create(null);
        for (var i = 0; i < members.length; i++) {
            var id = members[i].characterId;
            if (seen[id]) {
                return {
                    valid: false,
                    message: 'Duplicate member characterId: ' + id + '.'
                };
            }
            seen[id] = true;
        }
        return { valid: true };
    }

    // ============================================================
    // DEPARTMENT VALIDATION
    // ============================================================

    function validateDepartment(department) {
        var errors = [];

        if (!isPlainObject(department)) {
            return {
                valid: false,
                errors: ['Department must be an object.']
            };
        }

        if (normaliseId(department.id) === null) {
            errors.push('Department id is required.');
        }

        if (!isNonEmptyString(department.name)) {
            errors.push('Department name is required.');
        }

        if (department.description !== undefined &&
            department.description !== null &&
            typeof department.description !== 'string') {
            errors.push('Department description must be a string.');
        }

        if (!isStrictIsoTimestamp(department.createdAt)) {
            errors.push('Department createdAt must be an ISO 8601 ' +
                'string.');
        }

        if (!Array.isArray(department.members)) {
            errors.push('Department members must be an array.');
            return { valid: false, errors: errors };
        }

        // Validate each member entry.
        var validMemberIds = Object.create(null);
        for (var i = 0; i < department.members.length; i++) {
            var check = validateMemberEntry(department.members[i]);
            if (!check.valid) {
                errors.push('Member ' + (i + 1) + ': ' +
                    check.message);
                continue;
            }
            validMemberIds[check.member.characterId] = true;
        }

        // Uniqueness across members.
        var uniqueCheck = validateMembersUnique(
            department.members.filter(function(m) {
                return isPlainObject(m);
            }).map(function(m) {
                return { characterId: normaliseId(m.characterId) };
            }).filter(function(m) {
                return m.characterId !== null;
            })
        );
        if (!uniqueCheck.valid) {
            errors.push(uniqueCheck.message);
        }

        // headId: null, or a member characterId.
        if (department.headId !== undefined &&
            department.headId !== null) {
            var head = normaliseId(department.headId);
            if (head === null) {
                errors.push('Department headId must be a valid id or ' +
                    'null.');
            } else if (!validMemberIds[head]) {
                errors.push('Department headId must reference a ' +
                    'member of the department.');
            }
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // CANONICALISATION
    // ============================================================

    function canonicaliseInterval(raw, index, errors) {
        var check = validateIntervalShape(raw);
        if (!check.valid) {
            errors.push('Interval ' + (index + 1) + ': ' +
                check.message);
            return null;
        }
        return check.interval;
    }

    function canonicaliseMemberEntry(raw, index, errors) {
        if (!isPlainObject(raw)) {
            errors.push('Member ' + (index + 1) +
                ' must be an object.');
            return null;
        }

        var charId = normaliseId(raw.characterId);
        if (charId === null) {
            errors.push('Member ' + (index + 1) +
                ' requires a valid characterId.');
            return null;
        }

        if (!Array.isArray(raw.intervals)) {
            errors.push('Member ' + (index + 1) +
                ' intervals must be an array.');
            return null;
        }

        if (raw.intervals.length === 0) {
            errors.push('Member ' + (index + 1) +
                ' must contain at least one interval.');
            return null;
        }

        var intervals = [];
        for (var i = 0; i < raw.intervals.length; i++) {
            var iv = canonicaliseInterval(
                raw.intervals[i], i, errors
            );
            if (iv !== null) {
                intervals.push(iv);
            }
        }

        if (intervals.length !== raw.intervals.length) {
            return null;
        }

        // Re-check invariants on the canonicalised set.
        for (var a = 0; a < intervals.length; a++) {
            for (var b = a + 1; b < intervals.length; b++) {
                if (intervalsOverlap(intervals[a], intervals[b])) {
                    errors.push('Member ' + (index + 1) +
                        ': intervals ' + (a + 1) + ' and ' +
                        (b + 1) + ' overlap.');
                    return null;
                }
            }
        }

        var openCount = 0;
        for (var k = 0; k < intervals.length; k++) {
            if (intervals[k].leavePeriod === '') { openCount++; }
        }
        if (openCount > 1) {
            errors.push('Member ' + (index + 1) +
                ' has more than one open interval.');
            return null;
        }

        return {
            characterId: charId,
            intervals: intervals
        };
    }

    function canonicaliseDepartmentShape(input) {
        var errors = [];

        if (!isPlainObject(input)) {
            return {
                valid: false,
                errors: ['Department data must be an object.'],
                value: null
            };
        }

        // ---- id ----
        var id = normaliseId(input.id);
        if (id === null) {
            errors.push('Department id is required.');
        }

        // ---- name ----
        var name = typeof input.name === 'string'
            ? input.name.trim()
            : '';
        if (name === '') {
            errors.push('Department name is required.');
        }

        // ---- description ----
        var description = '';
        if (input.description !== undefined &&
            input.description !== null) {
            if (typeof input.description !== 'string') {
                errors.push('Department description must be a string.');
            } else {
                description = input.description;
            }
        }

        // ---- createdAt ----
        var createdAt = input.createdAt;
        if (!isStrictIsoTimestamp(createdAt)) {
            errors.push('Department createdAt must be an ISO 8601 ' +
                'string.');
        }

        // ---- members ----
        var members = [];
        var seenIds = Object.create(null);
        if (input.members !== undefined && input.members !== null) {
            if (!Array.isArray(input.members)) {
                errors.push('Department members must be an array.');
            } else {
                for (var i = 0; i < input.members.length; i++) {
                    var member = canonicaliseMemberEntry(
                        input.members[i], i, errors
                    );
                    if (member === null) { continue; }
                    if (seenIds[member.characterId]) {
                        errors.push('Duplicate member characterId: ' +
                            member.characterId + '.');
                        continue;
                    }
                    seenIds[member.characterId] = true;
                    members.push(member);
                }
            }
        }

        // ---- headId ----
        var headId = null;
        if (input.headId !== undefined && input.headId !== null) {
            headId = normaliseId(input.headId);
            if (headId === null) {
                errors.push('Department headId must be a valid id or ' +
                    'null.');
            } else if (!seenIds[headId]) {
                errors.push('Department headId must reference a ' +
                    'member of the department.');
            }
        }

        if (errors.length > 0) {
            return { valid: false, errors: errors, value: null };
        }

        var result = {
            id: id,
            name: name,
            description: description,
            headId: headId,
            createdAt: createdAt,
            members: members
        };

        // Preserve unknown top-level fields.
        var knownKeys = [
            'id',
            'name',
            'description',
            'headId',
            'createdAt',
            'members'
        ];

        Object.keys(input).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = deepClone(input[key]);
            }
        });

        return { valid: true, errors: [], value: result };
    }

    // ============================================================
    // NAME VALIDATION
    // ============================================================

    function validateDepartmentName(name) {
        if (!isNonEmptyString(name)) {
            return {
                valid: false,
                message: 'Department name is required.'
            };
        }
        return { valid: true, value: name.trim() };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DepartmentSchema = Object.freeze({
        // Year parsing (shared by the mutation layer)
        parseYear: parseYear,

        // Nested validators (used by DepartmentCore, tests)
        validateIntervalShape: validateIntervalShape,
        validateMemberIntervals: validateMemberIntervals,
        validateMemberEntry: validateMemberEntry,

        // Full validation
        validateDepartment: validateDepartment,
        validateDepartmentName: validateDepartmentName,

        // Canonicalisation
        canonicaliseDepartmentShape: canonicaliseDepartmentShape,

        // Overlap helper (used by the mutation layer for pre-flight
        // overlap checks)
        intervalsOverlap: intervalsOverlap
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.DepartmentSchema;
        var missing = [];

        var required = [
            'parseYear',
            'validateIntervalShape',
            'validateMemberIntervals',
            'validateMemberEntry',
            'validateDepartment',
            'validateDepartmentName',
            'canonicaliseDepartmentShape',
            'intervalsOverlap'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            // parseYear
            if (parseYear('1902') !== 1902) {
                missing.push("parseYear('1902') !== 1902");
            }
            if (parseYear(1902) !== 1902) {
                missing.push('parseYear(1902) !== 1902');
            }
            if (parseYear('1902garbage') !== null) {
                missing.push("parseYear('1902garbage') !== null");
            }
            if (parseYear('') !== null) {
                missing.push("parseYear('') !== null");
            }
            if (parseYear(-1) !== null) {
                missing.push('parseYear(-1) !== null');
            }
            if (parseYear(1.5) !== null) {
                missing.push('parseYear(1.5) !== null');
            }

            // interval shape
            var iv = validateIntervalShape({
                joinPeriod: '1900',
                leavePeriod: '1905'
            });
            if (!iv.valid ||
                iv.interval.joinPeriod !== '1900' ||
                iv.interval.leavePeriod !== '1905') {
                missing.push('valid interval rejected or altered');
            }

            var ivOpen = validateIntervalShape({
                joinPeriod: '1900',
                leavePeriod: ''
            });
            if (!ivOpen.valid ||
                ivOpen.interval.leavePeriod !== '') {
                missing.push('open-ended interval rejected');
            }

            var ivNoJoin = validateIntervalShape({
                joinPeriod: '',
                leavePeriod: '1905'
            });
            if (ivNoJoin.valid) {
                missing.push('interval without join accepted');
            }

            var ivInverted = validateIntervalShape({
                joinPeriod: '1905',
                leavePeriod: '1900'
            });
            if (ivInverted.valid) {
                missing.push('inverted interval accepted');
            }

            // overlap
            if (!intervalsOverlap(
                { joinPeriod: '1900', leavePeriod: '1905' },
                { joinPeriod: '1904', leavePeriod: '' }
            )) {
                missing.push('overlap not detected');
            }
            if (intervalsOverlap(
                { joinPeriod: '1900', leavePeriod: '1905' },
                { joinPeriod: '1906', leavePeriod: '' }
            )) {
                missing.push('non-overlapping intervals reported as ' +
                    'overlapping');
            }

            // member intervals
            var mi = validateMemberIntervals([
                { joinPeriod: '1900', leavePeriod: '1905' },
                { joinPeriod: '1906', leavePeriod: '' }
            ]);
            if (!mi.valid) {
                missing.push('two non-overlapping intervals rejected');
            }

            var miOpen = validateMemberIntervals([
                { joinPeriod: '1900', leavePeriod: '' },
                { joinPeriod: '1910', leavePeriod: '' }
            ]);
            if (miOpen.valid) {
                missing.push('two open intervals accepted');
            }

            var miOverlap = validateMemberIntervals([
                { joinPeriod: '1900', leavePeriod: '1905' },
                { joinPeriod: '1904', leavePeriod: '' }
            ]);
            if (miOverlap.valid) {
                missing.push('overlapping intervals accepted');
            }

            // canonicalisation
            var canon = canonicaliseDepartmentShape({
                id: 'dept_a',
                name: 'Healing',
                description: '',
                headId: 'char_a',
                createdAt: '2026-09-17T12:00:00.000Z',
                members: [
                    {
                        characterId: 'char_a',
                        intervals: [
                            {
                                joinPeriod: '1900',
                                leavePeriod: ''
                            }
                        ]
                    }
                ]
            });
            if (!canon.valid) {
                missing.push('valid department failed ' +
                    'canonicalisation: ' + canon.errors.join('; '));
            }

            // head not a member
            var canonBadHead = canonicaliseDepartmentShape({
                id: 'dept_a',
                name: 'Healing',
                description: '',
                headId: 'char_z',
                createdAt: '2026-09-17T12:00:00.000Z',
                members: [
                    {
                        characterId: 'char_a',
                        intervals: [
                            {
                                joinPeriod: '1900',
                                leavePeriod: ''
                            }
                        ]
                    }
                ]
            });
            if (canonBadHead.valid) {
                missing.push('head that is not a member accepted');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[DepartmentSchema] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
