/**
 * modules/departments/department-constants.js - Department Constants
 * Single source of truth for department-related constants.
 *
 * Path: js/modules/departments/department-constants.js
 *
 * PROVIDES:
 *   - ID prefix for department records.
 *   - Membership sort keys (name-asc, name-desc).
 *   - Defaults for a new department.
 *   - Read-only lookup helpers used by the schema and the views.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Vocabulary for department types. Departments do not have a
 *     type field; the name carries the identity.
 *   - Status values. A department has no status; it exists or it
 *     was deleted.
 *   - Member roles. Department membership carries no role; a head
 *     is a scalar on the department, not a role on a member.
 *   - Year parsing. Years are unbounded positive integers, and the
 *     canonical parser lives in TeamConstants and CalendarConstants
 *     depending on the domain. Department membership uses year
 *     strings; the schema validates them with a local strict
 *     parser (see department-schema.js).
 *
 * DEPENDENCIES:
 *   None (self-contained).
 */

(function() {
    'use strict';

    if (window.__departmentConstantsLoaded) { return; }
    window.__departmentConstantsLoaded = true;

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }
        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var value = obj[keys[i]];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }
        return Object.freeze(obj);
    }

    // ============================================================
    // ID PREFIX
    // ============================================================

    var DEPARTMENT_ID_PREFIX = 'dept';

    // ============================================================
    // MEMBERSHIP SORT KEYS
    // ============================================================

    var MEMBER_SORT_KEYS = [
        {
            id: 'name-asc',
            label: 'Name (A\u2013Z)'
        },
        {
            id: 'name-desc',
            label: 'Name (Z\u2013A)'
        },
        {
            id: 'join-asc',
            label: 'Joined (oldest first)'
        },
        {
            id: 'join-desc',
            label: 'Joined (newest first)'
        }
    ];

    var DEFAULT_MEMBER_SORT = 'name-asc';

    var VALID_MEMBER_SORT_KEYS = (function() {
        var result = Object.create(null);
        for (var i = 0; i < MEMBER_SORT_KEYS.length; i++) {
            result[MEMBER_SORT_KEYS[i].id] = true;
        }
        return result;
    })();

    // ============================================================
    // DEFAULTS
    // ============================================================

    var DEFAULT_DESCRIPTION = '';

    // ============================================================
    // READ-ONLY ACCESSORS
    // ============================================================

    function getDepartmentIdPrefix() {
        return DEPARTMENT_ID_PREFIX;
    }

    function getMemberSortKeys() {
        return MEMBER_SORT_KEYS.slice();
    }

    function getDefaultMemberSort() {
        return DEFAULT_MEMBER_SORT;
    }

    function isValidMemberSort(key) {
        if (typeof key !== 'string') { return false; }
        return VALID_MEMBER_SORT_KEYS[key] === true;
    }

    function getDefaultDescription() {
        return DEFAULT_DESCRIPTION;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        if (typeof DEPARTMENT_ID_PREFIX !== 'string' ||
            DEPARTMENT_ID_PREFIX.trim() === '') {
            errors.push('DEPARTMENT_ID_PREFIX must be a non-empty ' +
                'string.');
        }

        if (!Array.isArray(MEMBER_SORT_KEYS) ||
            MEMBER_SORT_KEYS.length === 0) {
            errors.push('MEMBER_SORT_KEYS must be a non-empty array.');
        } else {
            var seen = Object.create(null);
            for (var i = 0; i < MEMBER_SORT_KEYS.length; i++) {
                var entry = MEMBER_SORT_KEYS[i];
                if (!entry || typeof entry !== 'object') {
                    errors.push('MEMBER_SORT_KEYS[' + i +
                        '] must be an object.');
                    continue;
                }
                if (typeof entry.id !== 'string' ||
                    entry.id.trim() === '') {
                    errors.push('MEMBER_SORT_KEYS[' + i +
                        '] requires a non-empty id.');
                    continue;
                }
                if (seen[entry.id]) {
                    errors.push('Duplicate MEMBER_SORT_KEYS id "' +
                        entry.id + '".');
                }
                seen[entry.id] = true;

                if (typeof entry.label !== 'string' ||
                    entry.label.trim() === '') {
                    errors.push('MEMBER_SORT_KEYS["' + entry.id +
                        '"] requires a non-empty label.');
                }
            }

            if (!seen[DEFAULT_MEMBER_SORT]) {
                errors.push('DEFAULT_MEMBER_SORT "' +
                    DEFAULT_MEMBER_SORT +
                    '" is not a valid sort key.');
            }
        }

        if (typeof DEFAULT_DESCRIPTION !== 'string') {
            errors.push('DEFAULT_DESCRIPTION must be a string.');
        }

        if (errors.length > 0) {
            throw new Error(
                '[DepartmentConstants] Validation failed:\n  ' +
                errors.join('\n  ')
            );
        }
    }

    validateConstants();

    // ============================================================
    // FREEZE
    // ============================================================

    deepFreeze(MEMBER_SORT_KEYS);
    deepFreeze(VALID_MEMBER_SORT_KEYS);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DepartmentConstants = Object.freeze({
        DEPARTMENT_ID_PREFIX: DEPARTMENT_ID_PREFIX,
        MEMBER_SORT_KEYS: MEMBER_SORT_KEYS,
        DEFAULT_MEMBER_SORT: DEFAULT_MEMBER_SORT,
        DEFAULT_DESCRIPTION: DEFAULT_DESCRIPTION,

        getDepartmentIdPrefix: getDepartmentIdPrefix,
        getMemberSortKeys: getMemberSortKeys,
        getDefaultMemberSort: getDefaultMemberSort,
        isValidMemberSort: isValidMemberSort,
        getDefaultDescription: getDefaultDescription,

        validateConstants: validateConstants
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.DepartmentConstants;
        var missing = [];

        var required = [
            'getDepartmentIdPrefix',
            'getMemberSortKeys',
            'getDefaultMemberSort',
            'isValidMemberSort',
            'getDefaultDescription'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (exports.getDepartmentIdPrefix() !== 'dept') {
                missing.push('DEPARTMENT_ID_PREFIX is not "dept"');
            }

            if (!exports.isValidMemberSort('name-asc')) {
                missing.push('isValidMemberSort rejects "name-asc"');
            }
            if (exports.isValidMemberSort('banana')) {
                missing.push('isValidMemberSort accepts "banana"');
            }
            if (exports.isValidMemberSort(null)) {
                missing.push('isValidMemberSort accepts null');
            }

            var keys = exports.getMemberSortKeys();
            if (!Array.isArray(keys) || keys.length !== 4) {
                missing.push('getMemberSortKeys did not return 4 keys');
            }

            // Confirm the array is a copy; mutating it must not
            // affect the internal constant.
            keys.push({ id: 'bogus', label: 'bogus' });
            if (exports.getMemberSortKeys().length !== 4) {
                missing.push(
                    'getMemberSortKeys leaked a reference to the ' +
                    'internal array'
                );
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[DepartmentConstants] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
