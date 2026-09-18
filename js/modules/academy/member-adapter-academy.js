/**
 * modules/academy/member-adapter-academy.js
 * Academy Member Manager Adapter
 *
 * Path: js/modules/academy/member-adapter-academy.js
 *
 * Binds the shared MemberManager to the Academy Weekly Teams domain.
 * This is the second of two adapters; the other is
 * member-adapter-teams.js. Both implement the same six-method
 * contract defined in modules/shared/member-manager.js.
 *
 * RESPONSIBILITY:
 *   Translate MemberManager's domain-agnostic requests into
 *   AcademyWeeklyTeams mutations and AcademyAggregator reads.
 *
 * WHAT THIS ADAPTER DOES NOT DO:
 *   - It does not render.
 *   - It does not touch the DOM.
 *   - It does not own any UI state.
 *   - It does not know about the professional Teams tab.
 *
 * ADAPTER CONTRACT (six methods):
 *   fetchVM(teamId, period)  — period is a WEEK here
 *   addMember(teamId, period, { charId, role, join, leave })
 *   updateMembers(teamId, period, changes)
 *   removeStint(teamId, period, identifier)
 *   rejoinStint(teamId, period, identifier)
 *   removeMember(teamId, period, charId)
 *
 * DIFFERENCE FROM THE TEAMS ADAPTER — CLASS ID:
 *   AcademyWeeklyTeams mutations are CLASS-SCOPED. Every mutation
 *   requires (classId, teamId). The shared manager passes only
 *   teamId. This adapter resolves classId from the team record at
 *   the moment of the mutation, via TeamQueries.getTeamById.
 *
 *   It does so lazily, on each mutation call. A team that is
 *   reassigned to a different class between calls is picked up on
 *   the next mutation. There is no cache to invalidate.
 *
 * DIFFERENCE — VM SHAPE:
 *   AcademyAggregator.getWeeklyTeamMemberManagerViewModel already
 *   returns members and formerMembers as separate lists, and its
 *   member VMs already carry the fields the shared manager wants.
 *   No partitioning is necessary.
 *
 * DIFFERENCE — ROLE:
 *   AcademyWeeklyTeams has no role mutation. A member's role is
 *   set at creation time (addMember), and there is no
 *   updateMemberRole. The role stage in updateMembers is
 *   therefore a no-op on this adapter.
 *
 *   Role inputs still render in the manager, and the user can edit
 *   them, but Save does not persist role changes on the Academy
 *   side until AcademyWeeklyTeams grows a role mutation. This is
 *   a documented limitation tracked in the pinboard as SIDE-3.
 *
 * JOIN IS IMMUTABLE ON AcademyWeeklyTeams:
 *   As with the Teams adapter, changing a Join is a purge-and-
 *   replace. The old interval is removed, a new one is added with
 *   the new bounds. Uses purgeMemberRecords and addMemberInterval.
 *
 * IDENTIFIER FORMS ACCEPTED:
 *   - { characterId, joinPeriod }
 *   - memberId string
 *
 *   AcademyWeeklyTeams.purgeMemberRecords accepts either form.
 *   joinPeriod is preferred; memberId is used when joinPeriod is
 *   blank.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyAggregator
 *   - window.AcademyWeeklyTeams
 *   - window.TeamQueries
 *   - window.CalendarConstants
 */

(function() {
    'use strict';

    if (window.__memberAdapterAcademyLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var AcademyAggregator = window.AcademyAggregator;
    var AcademyWeeklyTeams = window.AcademyWeeklyTeams;
    var TeamQueries = window.TeamQueries;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!AcademyAggregator ||
        typeof AcademyAggregator.getWeeklyTeamMemberManagerViewModel !== 'function') {
        _missing.push(
            'AcademyAggregator.getWeeklyTeamMemberManagerViewModel'
        );
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.addMemberInterval !== 'function') {
        _missing.push('AcademyWeeklyTeams.addMemberInterval');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.updateMemberWindows !== 'function') {
        _missing.push('AcademyWeeklyTeams.updateMemberWindows');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.purgeMemberRecords !== 'function') {
        _missing.push('AcademyWeeklyTeams.purgeMemberRecords');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.removeMemberEntry !== 'function') {
        _missing.push('AcademyWeeklyTeams.removeMemberEntry');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.setLeaveAtWeek !== 'function') {
        _missing.push('AcademyWeeklyTeams.setLeaveAtWeek');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MemberAdapterAcademy] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__memberAdapterAcademyLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(v) {
        return typeof v === 'string' && v.trim() !== '';
    }

    function failure(message) {
        return Promise.resolve({ success: false, message: message });
    }

    function extractIdentifier(identifier) {
        if (identifier === null || identifier === undefined) {
            return { characterId: '', joinPeriod: '', memberId: '' };
        }
        if (typeof identifier === 'string') {
            return {
                characterId: '',
                joinPeriod: '',
                memberId: identifier
            };
        }
        if (typeof identifier === 'object') {
            var charId = isNonEmptyString(identifier.characterId)
                ? String(identifier.characterId)
                : '';
            var joinPeriod = (identifier.joinPeriod === undefined ||
                              identifier.joinPeriod === null)
                ? ''
                : String(identifier.joinPeriod);
            var memberId = isNonEmptyString(identifier.memberId)
                ? String(identifier.memberId)
                : '';
            return {
                characterId: charId,
                joinPeriod: joinPeriod,
                memberId: memberId
            };
        }
        return { characterId: '', joinPeriod: '', memberId: '' };
    }

    /**
     * Resolve the class ID for a team. AcademyWeeklyTeams mutations
     * are class-scoped. The shared manager passes only a teamId.
     */
    function resolveClassId(teamId) {
        if (!isNonEmptyString(teamId)) { return null; }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) { return null; }
        if (team.classId === null ||
            team.classId === undefined ||
            team.classId === '') {
            return null;
        }
        return String(team.classId);
    }

    // ============================================================
    // VM TRANSLATION
    // ============================================================
    //
    // AcademyAggregator.getWeeklyTeamMemberManagerViewModel returns
    // the shape MemberManager expects, modulo a couple of renames
    // on the member VMs (the aggregator's member VM carries `name`
    // already, but uses `statusLabel` for status). The manager
    // reads `name`, `role`, `deceased`, `intervals`, and
    // `isFormer`, so a light pass-through is enough.

    function buildVM(teamId, period) {
        var classId = resolveClassId(teamId);
        if (!classId) { return null; }

        var weekNum = parseWeekStrict(period);
        if (weekNum === null) { return null; }

        var raw;
        try {
            raw = AcademyAggregator.getWeeklyTeamMemberManagerViewModel({
                classId: classId,
                teamId: teamId,
                week: weekNum
            });
        } catch (e) {
            console.warn(
                '[MemberAdapterAcademy] aggregator threw while building ' +
                'the member-manager VM:', e
            );
            return null;
        }

        if (!raw) { return null; }

        var members = normalizeList(raw.members, false);
        var formerMembers = normalizeList(raw.formerMembers, true);

        return {
            teamId: raw.teamId,
            teamName: raw.teamName,
            period: raw.week,
            members: members,
            formerMembers: formerMembers,
            candidates: Array.isArray(raw.candidates) ? raw.candidates : []
        };
    }

    function normalizeList(list, isFormer) {
        if (!Array.isArray(list)) { return []; }
        var result = [];
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (!m || !m.characterId) { continue; }

            var intervals = [];
            var rawIntervals = Array.isArray(m.intervals)
                ? m.intervals
                : [];
            for (var j = 0; j < rawIntervals.length; j++) {
                var iv = rawIntervals[j];
                if (!iv || typeof iv !== 'object') { continue; }
                var joinStr = (iv.joinPeriod === undefined ||
                               iv.joinPeriod === null)
                    ? ''
                    : String(iv.joinPeriod);
                var leaveStr = (iv.leavePeriod === undefined ||
                                iv.leavePeriod === null)
                    ? ''
                    : String(iv.leavePeriod);
                intervals.push({
                    joinPeriod: joinStr,
                    leavePeriod: leaveStr,
                    periodDisplay: iv.periodDisplay ||
                        ((joinStr || '\u2014') + ' \u2013 ' +
                         (leaveStr || '\u2014')),
                    activeAtPeriod: iv.activeAtPeriod === true
                });
            }

            result.push({
                characterId: m.characterId,
                memberId: m.memberId || '',
                name: m.name || 'Unknown',
                role: m.role || 'Member',
                deceased: m.deceased === true,
                status: m.statusLabel || '',
                statusLabel: m.statusLabel || '',
                isFormer: isFormer === true,
                intervals: intervals
            });
        }
        return result;
    }

    function parseWeekStrict(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        if (typeof value === 'number') {
            if (!Number.isInteger(value)) { return null; }
            if (value < CalendarConstants.MIN_WEEK ||
                value > CalendarConstants.MAX_WEEK) {
                return null;
            }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) { return null; }
            var n = Number(trimmed);
            if (!Number.isInteger(n)) { return null; }
            if (n < CalendarConstants.MIN_WEEK ||
                n > CalendarConstants.MAX_WEEK) {
                return null;
            }
            return n;
        }
        return null;
    }

    // ============================================================
    // ADAPTER METHODS
    // ============================================================

    function fetchVM(teamId, period) {
        return buildVM(teamId, period);
    }

    /**
     * Add a member.
     *
     * Flow:
     *   1. addMemberInterval(classId, teamId, charId, join, leave)
     *   2. If role is non-empty and not the default, no follow-up
     *      is possible — AcademyWeeklyTeams has no role mutation.
     *      The role is silently dropped. Documented limitation.
     */
    function addMember(teamId, period, opts) {
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }
        if (!opts || !isNonEmptyString(opts.charId)) {
            return failure('Character ID is required.');
        }

        var classId = resolveClassId(teamId);
        if (!classId) {
            return failure(
                'Team is not assigned to a class. Assign a class first.'
            );
        }

        var join = (opts.join === undefined || opts.join === null)
            ? ''
            : String(opts.join);
        var leave = (opts.leave === undefined || opts.leave === null)
            ? ''
            : String(opts.leave);

        if (join === '') {
            return failure('Join week is required.');
        }

        return AcademyWeeklyTeams.addMemberInterval(
            classId, teamId, opts.charId, join, leave
        );
    }

    /**
     * Apply a list of edits. Each change entry is one of:
     *   { characterId, joinPeriod, leave }              → leave edit
     *   { characterId, joinPeriod, join, leave }        → join replace
     *   { characterId, joinPeriod, role }               → role (dropped)
     *   { characterId, joinPeriod, join, leave, role }  → mixed
     *
     * Roles are dropped silently — AcademyWeeklyTeams has no role
     * mutation. Log a warning once per call so the developer knows.
     *
     * Stages:
     *   1. Join replacements (purge + add).
     *   2. Leave-only edits (updateMemberWindows).
     *
     * If any stage rejects, the chain stops.
     */
    function updateMembers(teamId, period, changes) {
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }
        if (!Array.isArray(changes) || changes.length === 0) {
            return Promise.resolve({ success: true });
        }

        var classId = resolveClassId(teamId);
        if (!classId) {
            return failure(
                'Team is not assigned to a class. Assign a class first.'
            );
        }

        var hasRoleEdits = false;

        var joinReplacements = [];
        var leaveEdits = [];

        for (var i = 0; i < changes.length; i++) {
            var c = changes[i];
            if (!c || !isNonEmptyString(c.characterId)) { continue; }

            var charId = String(c.characterId);
            var originalJoin = (c.joinPeriod === undefined ||
                                c.joinPeriod === null)
                ? ''
                : String(c.joinPeriod);

            var hasRole = c.role !== undefined && c.role !== null;
            var hasJoin = c.join !== undefined && c.join !== null &&
                          String(c.join) !== originalJoin;
            var hasLeave = c.leave !== undefined && c.leave !== null;

            if (hasRole) { hasRoleEdits = true; }

            if (hasJoin) {
                if (String(c.join) === '') {
                    // Join cannot be blank; skip the replacement.
                    // The manager refuses to save blank joins, so
                    // this is a defensive guard.
                    continue;
                }
                joinReplacements.push({
                    characterId: charId,
                    oldJoin: originalJoin,
                    newJoin: String(c.join),
                    newLeave: hasLeave ? String(c.leave) : ''
                });
                continue;
            }

            if (hasLeave) {
                leaveEdits.push({
                    characterId: charId,
                    joinPeriod: originalJoin,
                    leave: String(c.leave)
                });
            }
        }

        if (hasRoleEdits) {
            console.warn(
                '[MemberAdapterAcademy] updateMembers received role ' +
                'changes. AcademyWeeklyTeams has no role mutation; ' +
                'role edits are not persisted on this side.'
            );
        }

        var chain = Promise.resolve();
        var failureResult = null;

        // ---- Stage 1: join replacements ----
        joinReplacements.forEach(function(jr) {
            chain = chain.then(function() {
                if (failureResult) { return; }

                // Purge the old interval first. When oldJoin is
                // empty, pass the composite form; the aggregator
                // and the mutation layer accept either shape.
                var purgeIdentifier = jr.oldJoin !== ''
                    ? { characterId: jr.characterId,
                        joinPeriod: jr.oldJoin }
                    : { characterId: jr.characterId,
                        joinPeriod: '' };

                return AcademyWeeklyTeams.purgeMemberRecords(
                    classId, teamId, purgeIdentifier
                ).then(function(purgeResult) {
                    if (purgeResult && purgeResult.success === false) {
                        // Purge failed. Add anyway. The user's
                        // intent is "this stint now has these
                        // dates."
                        console.warn(
                            '[MemberAdapterAcademy] purge before ' +
                            'join replacement did not succeed; ' +
                            'attempting add.'
                        );
                    }
                    return AcademyWeeklyTeams.addMemberInterval(
                        classId,
                        teamId,
                        jr.characterId,
                        jr.newJoin,
                        jr.newLeave
                    ).then(function(addResult) {
                        if (!addResult || !addResult.success) {
                            failureResult = addResult || {
                                success: false,
                                message: 'Failed to replace join.'
                            };
                        }
                    });
                });
            });
        });

        // ---- Stage 2: leave-only edits ----
        if (leaveEdits.length > 0) {
            chain = chain.then(function() {
                if (failureResult) { return; }

                var windows = leaveEdits.map(function(le) {
                    return {
                        identifier: {
                            characterId: le.characterId,
                            joinPeriod: le.joinPeriod
                        },
                        leavePeriod: le.leave
                    };
                });

                return AcademyWeeklyTeams.updateMemberWindows(
                    classId, teamId, windows
                ).then(function(result) {
                    if (!result || !result.success) {
                        failureResult = result || {
                            success: false,
                            message: 'Failed to update periods.'
                        };
                    }
                });
            });
        }

        return chain.then(function() {
            if (failureResult) {
                return failureResult;
            }
            return { success: true };
        });
    }

    /**
     * Remove one stint. identifier is either a composite or a
     * memberId string. AcademyWeeklyTeams.purgeMemberRecords
     * accepts both.
     */
    function removeStint(teamId, period, identifier) {
        var classId = resolveClassId(teamId);
        if (!classId) {
            return failure(
                'Team is not assigned to a class. Assign a class first.'
            );
        }

        var id = extractIdentifier(identifier);

        if (id.characterId !== '') {
            return AcademyWeeklyTeams.purgeMemberRecords(
                classId,
                teamId,
                {
                    characterId: id.characterId,
                    joinPeriod: id.joinPeriod
                }
            );
        }

        if (id.memberId !== '') {
            return AcademyWeeklyTeams.purgeMemberRecords(
                classId, teamId, id.memberId
            );
        }

        return failure(
            'This stint does not carry enough identity to remove.'
        );
    }

    /**
     * Rejoin: clear the leave on the identified stint.
     */
    function rejoinStint(teamId, period, identifier) {
        var classId = resolveClassId(teamId);
        if (!classId) {
            return failure(
                'Team is not assigned to a class. Assign a class first.'
            );
        }

        var id = extractIdentifier(identifier);

        if (id.characterId !== '' && id.joinPeriod !== '') {
            return AcademyWeeklyTeams.updateMemberWindows(
                classId,
                teamId,
                [{
                    identifier: {
                        characterId: id.characterId,
                        joinPeriod: id.joinPeriod
                    },
                    leavePeriod: ''
                }]
            );
        }

        // No joinPeriod: resolve it from the member VM, then use
        // the same update path.
        if (id.memberId !== '' || id.characterId !== '') {
            var vm = fetchVM(teamId, period);
            if (!vm) {
                return failure('Team not found.');
            }

            var match = null;
            if (id.characterId !== '') {
                match = findMemberByCharId(vm, id.characterId);
            } else {
                match = findMemberByMemberId(vm, id.memberId);
            }

            if (!match) {
                return failure('Member not found.');
            }
            if (!Array.isArray(match.intervals) ||
                match.intervals.length === 0) {
                return failure('Member has no stints to rejoin.');
            }

            // Prefer the interval with a leave set; that is the
            // one the user is trying to reopen.
            var target = pickFormerInterval(match);
            if (!target) {
                return failure('No former stint to rejoin.');
            }

            return AcademyWeeklyTeams.updateMemberWindows(
                classId,
                teamId,
                [{
                    identifier: {
                        characterId: match.characterId,
                        joinPeriod: target.joinPeriod
                    },
                    leavePeriod: ''
                }]
            );
        }

        return failure('Cannot identify the stint to rejoin.');
    }

    /**
     * Remove the whole member entry (all stints).
     */
    function removeMember(teamId, period, charId) {
        if (!isNonEmptyString(charId)) {
            return failure('Character ID is required.');
        }

        var classId = resolveClassId(teamId);
        if (!classId) {
            return failure(
                'Team is not assigned to a class. Assign a class first.'
            );
        }

        return AcademyWeeklyTeams.removeMemberEntry(
            classId, teamId, charId
        );
    }

    // ============================================================
    // INTERNAL LOOKUPS
    // ============================================================

    function findMemberByCharId(vm, charId) {
        var target = String(charId);
        var pools = [vm.members, vm.formerMembers];
        for (var p = 0; p < pools.length; p++) {
            var list = pools[p] || [];
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (m && String(m.characterId) === target) {
                    return m;
                }
            }
        }
        return null;
    }

    function findMemberByMemberId(vm, memberId) {
        var target = String(memberId);
        var pools = [vm.members, vm.formerMembers];
        for (var p = 0; p < pools.length; p++) {
            var list = pools[p] || [];
            for (var i = 0; i < list.length; i++) {
                var m = list[i];
                if (m && String(m.memberId || '') === target) {
                    return m;
                }
            }
        }
        return null;
    }

    function pickFormerInterval(member) {
        if (!member || !Array.isArray(member.intervals)) {
            return null;
        }
        // Prefer an interval that has a leave period set.
        for (var i = 0; i < member.intervals.length; i++) {
            var iv = member.intervals[i];
            if (iv && isNonEmptyString(iv.leavePeriod)) {
                return iv;
            }
        }
        return null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MemberAdapterAcademy = Object.freeze({
        fetchVM: fetchVM,
        addMember: addMember,
        updateMembers: updateMembers,
        removeStint: removeStint,
        rejoinStint: rejoinStint,
        removeMember: removeMember
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MemberAdapterAcademy;
        var missing = [];

        var required = [
            'fetchVM',
            'addMember',
            'updateMembers',
            'removeStint',
            'rejoinStint',
            'removeMember'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[MemberAdapterAcademy] Verification - some exports may ' +
                'be missing:', missing.join(', ')
            );
        }
    })();

})();