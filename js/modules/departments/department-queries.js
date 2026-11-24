/**
 * modules/departments/department-queries.js - Department Queries
 * Read-only department domain queries.
 *
 * Path: js/modules/departments/department-queries.js
 *
 * WHAT THIS OWNS:
 *   - Department lookup (by ID, by name, all).
 *   - Member reads (active, former, entry, intervals).
 *   - Membership predicates.
 *   - Head resolution.
 *   - Departments-for-character, year-scoped.
 *   - Mentorship reads (both parties members, read via
 *     SocialQueries).
 *
 * WHAT THIS DOES NOT OWN:
 *   - Mutations. DepartmentCore owns them.
 *   - Rendering. DepartmentRender owns it.
 *   - The schema. DepartmentSchema owns structural validation.
 *
 * MEMBERSHIP SEMANTICS:
 *   A member is ACTIVE at year Y when:
 *     - their interval containing Y has a blank leavePeriod, AND
 *     - the character is not deceased as of Y, AND
 *     - the character's status at Y is not retired.
 *
 *   A member is FORMER at year Y when:
 *     - their interval containing Y has a non-blank leavePeriod
 *       that is strictly before Y, OR
 *     - the character is deceased as of Y, OR
 *     - the character's status at Y is retired.
 *
 *   "Former" means NOT currently active. It does not imply the
 *   stored interval was administratively closed. A character who
 *   died while holding an open interval is former at every year
 *   after their death, even though their interval remains open in
 *   the record.
 *
 * ACTIVE AND FORMER ARE NOT COMPLEMENTS:
 *   A member whose only interval starts AFTER the query year is
 *   neither active nor former at that year. It is a future
 *   member. Both predicates return false.
 *
 * DATA SOURCE:
 *   window.data.departments is the canonical store. Every read
 *   goes through it.
 *
 * CROSS-DOMAIN READS:
 *   Character death and retirement status route through
 *   CharacterQueries and CharacterConstants. Mentorships route
 *   through SocialQueries. Both are MANDATORY at call time for
 *   the functions that use them; the query throws when they are
 *   missing rather than silently skipping the check.
 *
 * PERIOD PARSING:
 *   Years are unbounded positive integers. This module imports
 *   DepartmentSchema.parseYear for consistency with the write
 *   path.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.DepartmentSchema
 *   - window.DepartmentConstants
 *
 * DEPENDENCIES (MANDATORY AT CALL TIME):
 *   - window.CharacterQueries   (death / retirement checks)
 *   - window.CharacterConstants (retirement tier)
 *   - window.SocialQueries      (mentorship reads)
 */

(function() {
    'use strict';

    if (window.__departmentQueriesLoaded) { return; }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var DepartmentSchema = window.DepartmentSchema;
    var DepartmentConstants = window.DepartmentConstants;

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!DepartmentSchema ||
        typeof DepartmentSchema.parseYear !== 'function') {
        _missing.push('DepartmentSchema.parseYear');
    }
    if (!DepartmentConstants) {
        _missing.push('DepartmentConstants (module)');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[DepartmentQueries] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__departmentQueriesLoaded = true;

    // ============================================================
    // LAZY ACCESSORS
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    function getSocialQueries() {
        return window.SocialQueries || null;
    }

    function requireCharacterDeps() {
        var CQ = getCharacterQueries();
        var CC = getCharacterConstants();

        var missing = [];
        if (!CQ || typeof CQ.isDeceased !== 'function') {
            missing.push('CharacterQueries.isDeceased');
        }
        if (!CQ || typeof CQ.getStatusAtYear !== 'function') {
            missing.push('CharacterQueries.getStatusAtYear');
        }
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CC || typeof CC.classifyStatus !== 'function') {
            missing.push('CharacterConstants.classifyStatus');
        }

        if (missing.length > 0) {
            throw new Error(
                '[DepartmentQueries] Character-state checks require: ' +
                missing.join(', ')
            );
        }

        return { CharacterQueries: CQ, CharacterConstants: CC };
    }

    function requireSocialDeps() {
        var SQ = getSocialQueries();
        if (!SQ ||
            typeof SQ.getCharacterRelationships !== 'function') {
            throw new Error(
                '[DepartmentQueries] Mentorship reads require ' +
                'SocialQueries.getCharacterRelationships.'
            );
        }
        return SQ;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function clone(value) {
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value !== 'object') {
            return value;
        }
        var result = ObjectUtils.deepClone(value);
        if (result === value) {
            throw new Error(
                '[DepartmentQueries] deepClone returned the original ' +
                'reference. Read safety is broken.'
            );
        }
        return result;
    }

    function parseYear(value) {
        return DepartmentSchema.parseYear(value);
    }

    function getDepartmentArray() {
        var data = window.data || {};
        return Array.isArray(data.departments)
            ? data.departments
            : [];
    }

    // ============================================================
    // DEPARTMENT RESOLUTION
    // ============================================================
    //
    // Every read accepts a department object or a department ID.
    // When given an object, it is used directly. When given an ID,
    // the store is scanned.

    function findDepartmentByIdInternal(deptId) {
        if (!isNonEmptyString(deptId)) { return null; }
        var target = String(deptId);
        var departments = getDepartmentArray();
        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (dept && typeof dept === 'object' &&
                String(dept.id) === target) {
                return dept;
            }
        }
        return null;
    }

    function resolveDept(deptOrId) {
        if (!deptOrId) { return null; }
        if (typeof deptOrId === 'object') {
            return deptOrId;
        }
        return findDepartmentByIdInternal(deptOrId);
    }

    // ============================================================
    // DEPARTMENT LOOKUP
    // ============================================================

    function getDepartments() {
        var departments = getDepartmentArray();
        var result = [];
        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (dept && typeof dept === 'object') {
                result.push(dept);
            }
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var out = [];
        for (var k = 0; k < result.length; k++) {
            out.push(clone(result[k]));
        }
        return out;
    }

    function getDepartmentById(deptId) {
        var dept = findDepartmentByIdInternal(deptId);
        return dept ? clone(dept) : null;
    }

    function getDepartmentByName(name) {
        if (!isNonEmptyString(name)) { return null; }
        var target = String(name).trim().toLowerCase();
        var departments = getDepartmentArray();
        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (!dept || typeof dept !== 'object') { continue; }
            var deptName = typeof dept.name === 'string'
                ? dept.name.trim().toLowerCase()
                : '';
            if (deptName === target) {
                return clone(dept);
            }
        }
        return null;
    }

    function getHead(deptOrId) {
        var dept = resolveDept(deptOrId);
        if (!dept) { return null; }
        if (!dept.headId) { return null; }

        var CQ = getCharacterQueries();
        if (!CQ ||
            typeof CQ.getCharacterById !== 'function') {
            return {
                characterId: String(dept.headId),
                displayName: 'Unknown'
            };
        }

        var char = CQ.getCharacterById(dept.headId);
        if (!char) {
            return {
                characterId: String(dept.headId),
                displayName: 'Unknown'
            };
        }

        var name = typeof CQ.getDisplayName === 'function'
            ? CQ.getDisplayName(char)
            : 'Unknown';

        return {
            characterId: String(dept.headId),
            displayName: name
        };
    }

    // ============================================================
    // MEMBER LOOKUP
    // ============================================================

    function getMemberEntry(deptOrId, characterId) {
        var dept = resolveDept(deptOrId);
        if (!dept) { return null; }
        if (!isNonEmptyString(characterId)) { return null; }
        if (!Array.isArray(dept.members)) { return null; }

        var target = String(characterId);
        for (var i = 0; i < dept.members.length; i++) {
            var member = dept.members[i];
            if (!member || typeof member !== 'object') { continue; }
            if (String(member.characterId) === target) {
                return clone(member);
            }
        }
        return null;
    }

    function getMemberIntervals(deptOrId, characterId) {
        var entry = getMemberEntry(deptOrId, characterId);
        if (!entry || !Array.isArray(entry.intervals)) { return []; }
        return entry.intervals;
    }

    function isMember(deptOrId, characterId) {
        return getMemberEntry(deptOrId, characterId) !== null;
    }

    // ============================================================
    // CHARACTER-STATE CHECKS
    // ============================================================
    //
    // These use CharacterQueries and CharacterConstants. Both are
    // mandatory at call time.

    function isCharacterRetiredAtYear(char, year) {
        var CC = getCharacterConstants();
        if (!CC || typeof CC.classifyStatus !== 'function') {
            return false;
        }

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getStatusAtYear !== 'function') {
            return false;
        }

        var status = CQ.getStatusAtYear(char, year);
        if (typeof status !== 'string' || status === '') {
            return false;
        }

        var tier = CC.classifyStatus(status);
        return tier === 'support' && isRetiredViaCareerStatus(
            char, year
        );
    }

    /**
     * A character is retired at year Y when their CURRENT status at
     * Y classifies as 'support' AND they have a professional-team
     * history. This is the same rule TeamQueries uses; the
     * Departments view reuses it so a character who became support
     * after a professional career is not counted as an active
     * member of a department.
     *
     * When CharacterQueries or TeamQueries cannot answer, the check
     * returns false (conservative: treat as not retired, so a
     * dead-but-unclassified character stays visible in the
     * department view).
     */
    function isRetiredViaCareerStatus(char, year) {
        var latest = getLatestCareerStatusKey(char, year);
        return latest === 'retired';
    }

    function getLatestCareerStatusKey(char, queryYear) {
        if (!char || !Array.isArray(char.careerStatus) ||
            char.careerStatus.length === 0) {
            return '';
        }

        var latestKey = '';
        var latestYear = -Infinity;
        var latestIndex = -1;

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var raw = entry.status !== undefined &&
                entry.status !== null
                ? String(entry.status).trim().toLowerCase()
                : '';
            if (raw === '') { continue; }

            var formerIdx = raw.indexOf(' (former)');
            if (formerIdx !== -1) {
                raw = raw.substring(0, formerIdx).trim();
            }

            var year = parseInt(entry.startYear, 10);
            if (isNaN(year)) { year = -Infinity; }
            if (queryYear !== undefined && queryYear !== null &&
                year > queryYear) {
                continue;
            }

            if (year > latestYear ||
                (year === latestYear && i > latestIndex)) {
                latestKey = raw;
                latestYear = year;
                latestIndex = i;
            }
        }

        return latestKey;
    }

    function isCharacterDeceasedAtYear(char, year) {
        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.isDeceased !== 'function') {
            return false;
        }
        try {
            return CQ.isDeceased(char, year) === true;
        } catch (e) {
            return false;
        }
    }

    // ============================================================
    // INTERVAL MEMBERSHIP AT YEAR
    // ============================================================

    /**
     * Return the latest membership interval that has started by
     * the query year. It may have ended before that year; callers
     * use its leavePeriod to distinguish active from former.
     * A null result means every interval is still in the future.
     */
    function findIntervalAtYear(entry, year) {
        if (!entry || !Array.isArray(entry.intervals)) {
            return null;
        }

        var selected = null;
        var selectedJoin = -Infinity;
        for (var i = 0; i < entry.intervals.length; i++) {
            var iv = entry.intervals[i];
            if (!iv || typeof iv !== 'object') { continue; }

            var join = parseYear(iv.joinPeriod);
            if (join === null || join > year) { continue; }

            if (join >= selectedJoin) {
                selected = iv;
                selectedJoin = join;
            }
        }

        return selected;
    }

    // ============================================================
    // ACTIVE / FORMER
    // ============================================================

    /**
     * Is the character an ACTIVE member of the department at the
     * given year?
     *
     * Active means ALL of:
     *   - their latest interval started by the query year has no
     *     leave year before the query year,
     *   - the character is not deceased as of the year,
     *   - the character is not retired as of the year.
     *
     * Returns false when the year is invalid, the department is
     * missing, or the character has no member entry.
     */
    function isActiveMember(deptOrId, characterId, year) {
        var dept = resolveDept(deptOrId);
        if (!dept) { return false; }

        var yearNum = parseYear(year);
        if (yearNum === null) { return false; }

        var entry = getMemberEntry(dept, characterId);
        if (!entry) { return false; }

        var iv = findIntervalAtYear(entry, yearNum);
        if (!iv) { return false; }

        var leaveRaw = iv.leavePeriod;
        var hasLeave = leaveRaw !== undefined &&
                       leaveRaw !== null &&
                       String(leaveRaw).trim() !== '';
        if (hasLeave) {
            var leaveYear = parseYear(leaveRaw);
            if (leaveYear === null || leaveYear < yearNum) {
                return false;
            }
        }

        // Character-state checks. These route through mandatory
        // dependencies; if either is unavailable, the function
        // throws.
        requireCharacterDeps();

        var CQ = getCharacterQueries();
        var char = CQ.getCharacterById(entry.characterId);
        if (!char) { return false; }

        if (isCharacterDeceasedAtYear(char, yearNum)) {
            return false;
        }
        if (isCharacterRetiredAtYear(char, yearNum)) {
            return false;
        }

        return true;
    }

    /**
     * Is the character a FORMER member of the department at the
     * given year?
     *
     * Former means NOT currently active, for one of three reasons:
     *   - their latest interval started by the query year ended
     *     strictly before that year,
     *   - the character is deceased as of the year,
     *   - the character is retired as of the year.
     *
     * A member whose only interval starts AFTER the year is
     * neither active nor former. Both predicates return false.
     */
    function isFormerMember(deptOrId, characterId, year) {
        var dept = resolveDept(deptOrId);
        if (!dept) { return false; }

        var yearNum = parseYear(year);
        if (yearNum === null) { return false; }

        var entry = getMemberEntry(dept, characterId);
        if (!entry) { return false; }

        requireCharacterDeps();

        var CQ = getCharacterQueries();
        var char = CQ.getCharacterById(entry.characterId);

        if (char) {
            if (isCharacterDeceasedAtYear(char, yearNum)) {
                return true;
            }
            if (isCharacterRetiredAtYear(char, yearNum)) {
                return true;
            }
        }

        var iv = findIntervalAtYear(entry, yearNum);
        if (!iv) {
            return false;
        }

        var leaveRaw = iv.leavePeriod;
        if (leaveRaw === undefined ||
            leaveRaw === null ||
            String(leaveRaw).trim() === '') {
            return false;
        }

        var leave = parseYear(leaveRaw);
        return leave !== null && leave < yearNum;
    }

    // ============================================================
    // MEMBER LISTS
    // ============================================================

    function getActiveMembers(deptOrId, year) {
        var dept = resolveDept(deptOrId);
        if (!dept) { return []; }

        var yearNum = parseYear(year);
        if (yearNum === null) { return []; }

        if (!Array.isArray(dept.members)) { return []; }

        requireCharacterDeps();

        var result = [];
        for (var i = 0; i < dept.members.length; i++) {
            var member = dept.members[i];
            if (!member || typeof member !== 'object') { continue; }
            if (isActiveMember(dept, member.characterId, yearNum)) {
                result.push(clone(member));
            }
        }
        return result;
    }

    function getFormerMembers(deptOrId, year) {
        var dept = resolveDept(deptOrId);
        if (!dept) { return []; }

        var yearNum = parseYear(year);
        if (yearNum === null) { return []; }

        if (!Array.isArray(dept.members)) { return []; }

        requireCharacterDeps();

        var result = [];
        for (var i = 0; i < dept.members.length; i++) {
            var member = dept.members[i];
            if (!member || typeof member !== 'object') { continue; }
            if (isFormerMember(dept, member.characterId, yearNum)) {
                result.push(clone(member));
            }
        }
        return result;
    }

    // ============================================================
    // DEPARTMENTS-FOR-CHARACTER
    // ============================================================

    function getDepartmentsForCharacter(characterId, year) {
        if (!isNonEmptyString(characterId)) { return []; }

        var yearNum = null;
        var hasYearFilter = year !== undefined && year !== null &&
            year !== '';
        if (hasYearFilter) {
            yearNum = parseYear(year);
            if (yearNum === null) { return []; }
        }

        var departments = getDepartmentArray();
        var result = [];

        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (!dept || typeof dept !== 'object') { continue; }

            if (!isMember(dept, characterId)) { continue; }

            if (!hasYearFilter) {
                result.push(dept);
                continue;
            }

            // Year-scoped: include the department when the character
            // is active at that year.
            if (isActiveMember(dept, characterId, yearNum)) {
                result.push(dept);
            }
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var out = [];
        for (var k = 0; k < result.length; k++) {
            out.push(clone(result[k]));
        }
        return out;
    }

    // ============================================================
    // MENTORSHIPS
    // ============================================================
    //
    // Mentorships are owned by the Social domain. They are read via
    // SocialQueries and shown in a department only when BOTH
    // parties are members of that department at the query year.
    //
    // Direction: SocialConstants declares `mentor` as directional
    // with character1 mentoring character2. `getActiveMentorships`
    // and `getFormerMentorships` do not re-verify the direction;
    // the caller reads it off the returned relationship record.

    function isMentorshipRelationship(rel) {
        if (!rel || typeof rel !== 'object') { return false; }
        return rel.typeId === 'mentor';
    }

    function collectMentorshipCandidates(dept, yearNum) {
        if (!Array.isArray(dept.members)) { return []; }

        var result = [];
        var seen = Object.create(null);

        for (var i = 0; i < dept.members.length; i++) {
            var member = dept.members[i];
            if (!member || typeof member !== 'object') { continue; }
            var charId = String(member.characterId);
            if (seen[charId]) { continue; }
            seen[charId] = true;
            result.push(charId);
        }

        return result;
    }

    function readRelationshipsForMemberId(charId) {
        var SQ = requireSocialDeps();
        var list;
        try {
            list = SQ.getCharacterRelationships(charId);
        } catch (e) {
            throw new Error(
                '[DepartmentQueries] Failed to read mentorships for ' +
                String(charId) + ': ' +
                (e && e.message ? e.message : String(e))
            );
        }
        if (!Array.isArray(list)) {
            throw new Error(
                '[DepartmentQueries] SocialQueries returned an invalid ' +
                'relationship list for ' + String(charId) + '.'
            );
        }
        return list;
    }

    /**
     * Mentorships where BOTH parties are members of the department
     * at the year, and the relationship is active (blank endYear).
     */
    function getActiveMentorships(deptOrId, year) {
        return _getMentorships(deptOrId, year, /* active */ true);
    }

    /**
     * Mentorships where BOTH parties are department members at the
     * query year and the relationship ended at or before that year.
     */
    function getFormerMentorships(deptOrId, year) {
        return _getMentorships(deptOrId, year, /* active */ false);
    }

    function _getMentorships(deptOrId, year, active) {
        var dept = resolveDept(deptOrId);
        if (!dept) { return []; }

        var yearNum = parseYear(year);
        if (yearNum === null) { return []; }

        // Department membership scoping is checked at the query
        // year, not just presence in the members array.
        var memberIds = collectMentorshipCandidates(dept, yearNum);
        if (memberIds.length === 0) { return []; }

        var memberSet = Object.create(null);
        for (var i = 0; i < memberIds.length; i++) {
            memberSet[memberIds[i]] = true;
        }

        var seenRelIds = Object.create(null);
        var result = [];

        for (var m = 0; m < memberIds.length; m++) {
            var rels = readRelationshipsForMemberId(memberIds[m]);

            for (var r = 0; r < rels.length; r++) {
                var rel = rels[r];
                if (!isMentorshipRelationship(rel)) { continue; }
                if (seenRelIds[String(rel.id)]) { continue; }

                var c1 = String(rel.character1);
                var c2 = String(rel.character2);

                if (!memberSet[c1] || !memberSet[c2]) { continue; }

                // Both parties must be members AT THE YEAR, not just
                // listed in members[]. A member who has left the
                // department cannot participate in a mentorship
                // attributed to the department.
                if (!isActiveMember(dept, c1, yearNum)) { continue; }
                if (!isActiveMember(dept, c2, yearNum)) { continue; }

                var isOngoing = isOngoingRelationship(rel, yearNum);
                if (active && !isOngoing) { continue; }
                if (!active && isOngoing) { continue; }

                seenRelIds[String(rel.id)] = true;
                result.push(clone(rel));
            }
        }

        result.sort(function(a, b) {
            return String(a.id).localeCompare(String(b.id));
        });

        return result;
    }

    function isOngoingRelationship(rel, queryYear) {
        if (!rel) { return true; }
        var end = rel.endYear;
        if (end === undefined || end === null) { return true; }
        if (typeof end === 'string' && end.trim() === '') {
            return true;
        }

        var endYear = parseYear(end);
        if (endYear === null) { return true; }
        return endYear > queryYear;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DepartmentQueries = Object.freeze({
        // Department lookup
        getDepartments: getDepartments,
        getDepartmentById: getDepartmentById,
        getDepartmentByName: getDepartmentByName,

        // Head
        getHead: getHead,

        // Member lookup
        getMemberEntry: getMemberEntry,
        getMemberIntervals: getMemberIntervals,
        isMember: isMember,

        // Membership predicates
        isActiveMember: isActiveMember,
        isFormerMember: isFormerMember,

        // Member lists
        getActiveMembers: getActiveMembers,
        getFormerMembers: getFormerMembers,

        // Departments for a character
        getDepartmentsForCharacter: getDepartmentsForCharacter,

        // Mentorships (Social-owned; both parties members at year)
        getActiveMentorships: getActiveMentorships,
        getFormerMentorships: getFormerMentorships
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.DepartmentQueries;
        var missing = [];

        var required = [
            'getDepartments',
            'getDepartmentById',
            'getDepartmentByName',
            'getHead',
            'getMemberEntry',
            'getMemberIntervals',
            'isMember',
            'isActiveMember',
            'isFormerMember',
            'getActiveMembers',
            'getFormerMembers',
            'getDepartmentsForCharacter',
            'getActiveMentorships',
            'getFormerMentorships'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[DepartmentQueries] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
