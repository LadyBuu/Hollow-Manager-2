/**
 * modules/academy/member-adapter-academy.js
 * Academy Member Manager Adapter
 *
 * Path: js/modules/academy/member-adapter-academy.js
 *
 * Binds the shared MemberManager to the Academy Weekly Teams domain.
 * The other adapter is member-adapter-teams.js. Both implement the
 * six-method contract defined in modules/shared/member-manager.js.
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
 * CAPABILITIES:
 *   The adapter publishes a `capabilities` object so the shared
 *   MemberManager can decide which controls to render.
 *
 *     {
 *       updateRole: false
 *     }
 *
 *   AcademyWeeklyTeams has no role mutation. A member's role is set
 *   at creation time; there is no updateMemberRole. Setting
 *   updateRole to false tells the manager to render the role input
 *   as read-only.
 *
 *   Before this flag existed, the manager rendered an editable role
 *   input, accepted a new value, called updateMembers, and the
 *   adapter silently dropped the role. The user saw "saved" and the
 *   role had not changed. The flag closes that gap at the source:
 *   if the manager honours it, the input never becomes editable.
 *
 *   As a defensive measure, updateMembers REJECTS a change entry
 *   that carries only a role (no join, no leave). That path exists
 *   so a caller that ignores capabilities still learns something
 *   went wrong, instead of silently saving nothing.
 *
 * CLASS ID:
 *   AcademyWeeklyTeams mutations are CLASS-SCOPED. Every mutation
 *   requires (classId, teamId). The shared manager passes only
 *   teamId. This adapter resolves classId from the team record at
 *   the moment of the mutation, via TeamQueries.getTeamById.
 *
 *   The adapter resolves the class ID ONCE at the start of each
 *   public call. For a multi-change updateMembers, one resolution
 *   serves the entire batch. This is deliberate: the batch is one
 *   logical operation and should be scoped to one class.
 *
 * JOIN REPLACEMENT:
 *   Changing a join is a COMPLETE INTERVAL REPLACEMENT: the old
 *   interval is purged, a new one is added with the new bounds.
 *
 *   A change entry that supplies `join` MUST also supply `leave`.
 *   A join replacement that omits `leave` is rejected, because the
 *   adapter will not silently inherit the old interval's leave
 *   value. If the caller wants the new interval to be open-ended,
 *   it sends `leave: ''`.
 *
 *   Purge failure aborts the replacement. If the old interval
 *   cannot be removed, the new one is not added. That preserves
 *   the user's intent ("this stint now has these dates") without
 *   manufacturing overlapping membership history.
 *
 * REJOIN AMBIGUITY:
 *   rejoinStint can be called with a composite identifier
 *   ({ characterId, joinPeriod }) or a bare memberId.
 *
 *   With a composite, the target stint is unambiguous.
 *
 *   With a bare memberId, and a member who has multiple former
 *   stints, "rejoin" has no single obvious meaning. The adapter
 *   picks the EARLIEST former stint (the one with the earliest
 *   joinPeriod) and logs a warning. Callers that want deterministic
 *   behaviour should always send a composite.
 *
 *   This is an API limitation, not an adapter bug. A rejoin
 *   operation fundamentally needs to identify the stint when more
 *   than one former stint exists.
 *
 * IDENTIFIER FORMS ACCEPTED:
 *   - { characterId, joinPeriod }
 *   - memberId string
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
     * Resolve the class ID for a team.
     *
     * Called once at the start of each public method. For a batch
     * update, one resolution serves the whole batch.
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

        var members = normalizeMemberList(raw.members, false);
        var formerMembers = normalizeMemberList(raw.formerMembers, true);
        var candidates = normalizeCandidateList(raw.candidates);

        return {
            teamId: raw.teamId,
            teamName: raw.teamName,
            period: raw.week,
            members: members,
            formerMembers: formerMembers,
            candidates: candidates
        };
    }

    function normalizeMemberList(list, isFormer) {
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

    /**
     * Normalize the candidate list into the shape MemberManager
     * expects. The aggregator already returns { id, name, status },
     * but the adapter does not pass raw aggregator objects through;
     * it produces exactly the fields the manager reads so a future
     * change to the aggregator's VM does not silently reshape what
     * the manager sees.
     */
    function normalizeCandidateList(list) {
        if (!Array.isArray(list)) { return []; }
        var result = [];
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            if (!c || !c.id) { continue; }
            result.push({
                id: String(c.id),
                name: isNonEmptyString(c.name) ? String(c.name) : 'Unknown',
                status: isNonEmptyString(c.status) ? String(c.status) : ''
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
     * Role is set at creation time only. AcademyWeeklyTeams has no
     * role mutation.
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
     * Apply a list of edits.
     *
     * Each change entry is one of:
     *
     *   { characterId, joinPeriod, leave }
     *     Leave edit. The interval identified by (characterId,
     *     joinPeriod) has its leavePeriod set.
     *
     *   { characterId, joinPeriod, join, leave }
     *     Join replacement. The old interval is purged, a new one
     *     with the new [join, leave] bounds is added. Both join and
     *     leave are required; either may be the empty string, but
     *     both must be present in the entry.
     *
     * A change entry that supplies `join` but not `leave` is
     * REJECTED. The adapter does not inherit the old interval's
     * leave value; the caller must specify the complete replacement
     * interval.
     *
     * A change entry that supplies only a `role` (no join, no
     * leave) is REJECTED. The adapter has no role mutation. This
     * exists so a caller that ignores `capabilities.updateRole`
     * still learns the change went nowhere.
     *
     * Class resolution: one resolveClassId call serves the whole
     * batch.
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

        var joinReplacements = [];
        var leaveEdits = [];
        var rejectedRoleOnly = 0;
        var rejectedIncompleteJoin = 0;

        for (var i = 0; i < changes.length; i++) {
            var c = changes[i];
            if (!c || !isNonEmptyString(c.characterId)) { continue; }

            var charId = String(c.characterId);
            var originalJoin = (c.joinPeriod === undefined ||
                                c.joinPeriod === null)
                ? ''
                : String(c.joinPeriod);

            var hasJoin = c.join !== undefined && c.join !== null;
            var hasLeave = c.leave !== undefined && c.leave !== null;
            var hasRole = c.role !== undefined && c.role !== null;

            if (hasJoin) {
                // Join replacement. Both join and leave must be
                // present. The leave value may be '' (open-ended),
                // but the field must be on the entry.
                if (!hasLeave) {
                    rejectedIncompleteJoin++;
                    continue;
                }
                if (String(c.join) === '') {
                    // A join cannot be blank. The manager refuses to
                    // save blank joins, so this is defensive.
                    rejectedIncompleteJoin++;
                    continue;
                }
                joinReplacements.push({
                    characterId: charId,
                    oldJoin: originalJoin,
                    newJoin: String(c.join),
                    newLeave: String(c.leave)
                });
                continue;
            }

            if (hasLeave) {
                leaveEdits.push({
                    characterId: charId,
                    joinPeriod: originalJoin,
                    leave: String(c.leave)
                });
                continue;
            }

            if (hasRole) {
                // Role-only change. No other field to act on. The
                // adapter has no role mutation. Reject.
                rejectedRoleOnly++;
            }
        }

        if (rejectedIncompleteJoin > 0) {
            return failure(
                'Join replacement requires both join and leave. ' +
                rejectedIncompleteJoin + ' change(s) were rejected. ' +
                'Send leave: "" for an open-ended interval.'
            );
        }

        if (rejectedRoleOnly > 0) {
            return failure(
                'Role changes are not supported for Academy weekly ' +
                'teams. ' + rejectedRoleOnly + ' role-only change(s) ' +
                'were rejected.'
            );
        }

        var chain = Promise.resolve();
        var failureResult = null;

        // ---- Stage 1: join replacements ----
        joinReplacements.forEach(function(jr) {
            chain = chain.then(function() {
                if (failureResult) { return; }

                var purgeIdentifier = jr.oldJoin !== ''
                    ? { characterId: jr.characterId,
                        joinPeriod: jr.oldJoin }
                    : { characterId: jr.characterId,
                        joinPeriod: '' };

                return AcademyWeeklyTeams.purgeMemberRecords(
                    classId, teamId, purgeIdentifier
                ).then(function(purgeResult) {
                    // Purge failed → abort the replacement. Do NOT
                    // add a new interval on top of an interval that
                    // we could not remove.
                    if (!purgeResult || purgeResult.success !== true) {
                        failureResult = purgeResult || {
                            success: false,
                            message: 'Failed to remove the existing ' +
                                'stint before replacement.'
                        };
                        return;
                    }

                    return AcademyWeeklyTeams.addMemberInterval(
                        classId,
                        teamId,
                        jr.characterId,
                        jr.newJoin,
                        jr.newLeave
                    ).then(function(addResult) {
                        if (!addResult || addResult.success !== true) {
                            failureResult = addResult || {
                                success: false,
                                message: 'Failed to add the replacement ' +
                                    'stint.'
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
                    if (!result || result.success !== true) {
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
     *
     * Prefers a composite identifier. When only a memberId is
     * available and the member has multiple former stints, the
     * adapter picks the earliest former stint and logs a warning.
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

            var formerStints = pickFormerIntervals(match);
            if (formerStints.length === 0) {
                return failure('No former stint to rejoin.');
            }

            var target = formerStints[0];
            if (formerStints.length > 1) {
                console.warn(
                    '[MemberAdapterAcademy] rejoinStint called with a ' +
                    'bare memberId; member has ' + formerStints.length +
                    ' former stints. Picking the earliest (join period ' +
                    target.joinPeriod + '). Send a composite ' +
                    '{ characterId, joinPeriod } to disambiguate.'
                );
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

    /**
     * Return every interval of the member that has a leave period
     * set, sorted by joinPeriod (ascending). Intervals with a blank
     * joinPeriod sort to the end.
     */
    function pickFormerIntervals(member) {
        if (!member || !Array.isArray(member.intervals)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < member.intervals.length; i++) {
            var iv = member.intervals[i];
            if (iv && isNonEmptyString(iv.leavePeriod)) {
                result.push(iv);
            }
        }
        result.sort(function(a, b) {
            var aj = isNonEmptyString(a.joinPeriod)
                ? parseInt(a.joinPeriod, 10)
                : Infinity;
            var bj = isNonEmptyString(b.joinPeriod)
                ? parseInt(b.joinPeriod, 10)
                : Infinity;
            if (aj !== bj) { return aj - bj; }
            return 0;
        });
        return result;
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
        removeMember: removeMember,

        capabilities: Object.freeze({
            updateRole: false
        })
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

        if (!exports.capabilities ||
            exports.capabilities.updateRole !== false) {
            missing.push('capabilities.updateRole');
        }

        if (missing.length > 0) {
            console.warn(
                '[MemberAdapterAcademy] Verification - some exports may ' +
                'be missing:', missing.join(', ')
            );
        }
    })();

})();
