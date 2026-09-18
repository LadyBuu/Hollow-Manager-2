/**
 * modules/teams/member-adapter-teams.js
 * Teams Member Manager Adapter
 *
 * Path: js/modules/teams/member-adapter-teams.js
 *
 * Binds the shared MemberManager to the professional Team domain.
 * This is one of two adapters; the other is
 * member-adapter-academy.js. Both implement the same six-method
 * contract defined in modules/shared/member-manager.js.
 *
 * RESPONSIBILITY:
 *   Translate MemberManager's domain-agnostic requests into
 *   TeamCore mutations and TeamAggregator reads. Nothing else.
 *
 * WHAT THIS ADAPTER DOES NOT DO:
 *   - It does not render.
 *   - It does not touch the DOM.
 *   - It does not own any UI state.
 *   - It does not validate against team rules beyond what the
 *     domain modules validate.
 *   - It does not know about Academy Weekly Teams.
 *
 * ADAPTER CONTRACT (six methods):
 *   fetchVM(teamId, period)
 *     → VM in the shape MemberManager expects, or null.
 *
 *   addMember(teamId, period, { charId, role, join, leave })
 *     → Promise<{ success, message? }>
 *
 *   updateMembers(teamId, period, changes)
 *     changes = [ { characterId, joinPeriod, role?, join?, leave? } ]
 *     → Promise<{ success, message? }>
 *
 *   removeStint(teamId, period, identifier)
 *     identifier = { characterId, joinPeriod } or memberId string
 *     → Promise<{ success, message? }>
 *
 *   rejoinStint(teamId, period, identifier)
 *     → Promise<{ success, message? }>
 *
 *   removeMember(teamId, period, charId)
 *     → Promise<{ success, message? }>
 *
 * JOIN IS IMMUTABLE ON TeamCore:
 *   TeamCore's interval model treats joinPeriod as the interval's
 *   identity. endMemberInterval and reopenMemberInterval both
 *   address a stint by (characterId, joinPeriod). Changing a join
 *   in place is therefore not a single mutation — it is a
 *   purge-and-replace: remove the old interval, add a new one
 *   with the new join and the same leave.
 *
 *   updateMembers() handles this transparently. If a change entry
 *   carries a `join` that differs from its `joinPeriod`, the
 *   adapter runs purgeMemberInterval followed by addMemberInterval.
 *   Otherwise it runs endMemberInterval or reopenMemberInterval
 *   on the leave field, or updateMember on the role field.
 *
 * ROLE IS PER-MEMBER:
 *   TeamCore stores role on the member entry, not on intervals.
 *   A role change is routed to TeamCore.updateMember regardless of
 *   which row it came from. If multiple changes for the same
 *   characterId carry a role, only the last one is applied.
 *
 * DISPATCH ORDER WITHIN A SINGLE updateMembers CALL:
 *   1. Role updates (TeamCore.updateMember), deduplicated by
 *      characterId.
 *   2. Join replacements (purge + add), in the order received.
 *   3. Leave-only edits (endMemberInterval or reopenMemberInterval),
 *      in the order received.
 *
 *   If any step fails, the adapter stops and returns the first
 *   failure. It does not attempt to roll back successful steps;
 *   the pipeline already committed them. This mirrors how the
 *   pre-shared-manager code behaved.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamAggregator
 *   - window.TeamCore
 *   - window.TeamConstants
 */

(function() {
    'use strict';

    if (window.__memberAdapterTeamsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamAggregator = window.TeamAggregator;
    var TeamCore = window.TeamCore;
    var TeamConstants = window.TeamConstants;

    var _missing = [];

    if (!TeamAggregator ||
        typeof TeamAggregator.getMemberModalViewModel !== 'function') {
        _missing.push('TeamAggregator.getMemberModalViewModel');
    }
    if (!TeamCore ||
        typeof TeamCore.addMemberInterval !== 'function') {
        _missing.push('TeamCore.addMemberInterval');
    }
    if (!TeamCore ||
        typeof TeamCore.updateMember !== 'function') {
        _missing.push('TeamCore.updateMember');
    }
    if (!TeamCore ||
        typeof TeamCore.endMemberInterval !== 'function') {
        _missing.push('TeamCore.endMemberInterval');
    }
    if (!TeamCore ||
        typeof TeamCore.reopenMemberInterval !== 'function') {
        _missing.push('TeamCore.reopenMemberInterval');
    }
    if (!TeamCore ||
        typeof TeamCore.purgeMemberInterval !== 'function') {
        _missing.push('TeamCore.purgeMemberInterval');
    }
    if (!TeamCore ||
        typeof TeamCore.removeMember !== 'function') {
        _missing.push('TeamCore.removeMember');
    }
    if (!TeamConstants ||
        typeof TeamConstants.parsePeriod !== 'function') {
        _missing.push('TeamConstants.parsePeriod');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MemberAdapterTeams] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__memberAdapterTeamsLoaded = true;

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

    // ============================================================
    // VM TRANSLATION
    // ============================================================
    //
    // TeamAggregator.getMemberModalViewModel returns:
    //   { teamId, teamName, teamClassId, period, members, candidates }
    //
    // It does NOT partition members into active vs former. That
    // partitioning happens here, using TeamQueries' authoritative
    // active-members read. The manager expects:
    //   { teamId, teamName, period, members, formerMembers, candidates }

    function buildVM(teamId, period) {
        var raw = TeamAggregator.getMemberModalViewModel(teamId, period);
        if (!raw) { return null; }

        var periodNum = TeamConstants.parsePeriod(period);

        var active = [];
        var former = [];

        var membersRaw = Array.isArray(raw.members) ? raw.members : [];
        for (var i = 0; i < membersRaw.length; i++) {
            var m = membersRaw[i];
            if (!m || !m.characterId) { continue; }

            var vm = buildMemberVM(m, periodNum, false);

            // A member is "former" for the display period when none
            // of their intervals is active at that period AND at
            // least one interval has a leave before the period.
            // The aggregator's `activeAtPeriod` flag reflects the
            // authoritative query.
            if (m.activeAtPeriod === true) {
                active.push(vm);
            } else if (hasAnyLeaveBefore(m, periodNum)) {
                vm.isFormer = true;
                former.push(vm);
            }
            // Members with no active interval and no leave before
            // the period (future-only stints) are not shown. Same
            // behavior as before the shared manager.
        }

        return {
            teamId: raw.teamId,
            teamName: raw.teamName,
            period: raw.period,
            members: active,
            formerMembers: former,
            candidates: Array.isArray(raw.candidates) ? raw.candidates : []
        };
    }

    function buildMemberVM(member, periodNum, isFormer) {
        var intervals = [];
        var rawIntervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

        for (var i = 0; i < rawIntervals.length; i++) {
            var iv = rawIntervals[i];
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
                periodDisplay: (joinStr || '\u2014') +
                    ' \u2013 ' + (leaveStr || '\u2014'),
                activeAtPeriod: iv.activeAtPeriod === true
            });
        }

        return {
            characterId: member.characterId,
            memberId: member.memberId || '',
            name: member.displayName || 'Unknown',
            role: member.role || 'Member',
            deceased: member.deceased === true,
            status: member.status || '',
            statusLabel: member.statusLabel || '',
            isFormer: isFormer === true,
            intervals: intervals
        };
    }

    function hasAnyLeaveBefore(member, periodNum) {
        if (periodNum === null) { return false; }
        var raw = Array.isArray(member.intervals) ? member.intervals : [];
        for (var i = 0; i < raw.length; i++) {
            var iv = raw[i];
            if (!iv) { continue; }
            var lv = parseInt(iv.leavePeriod, 10);
            if (!isNaN(lv) && lv < periodNum) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // ADAPTER METHODS
    // ============================================================

    function fetchVM(teamId, period) {
        return buildVM(teamId, period);
    }

    /**
     * Add a member. Join is required by the manager and arrives as
     * a canonical string.
     *
     * Flow:
     *   1. addMemberInterval(teamId, charId, join, leave).
     *   2. If role is non-empty and differs from the default, call
     *      updateMember(teamId, charId, { role }).
     *
     * If step 1 succeeds but step 2 fails, the member exists with
     * the default role. That is the correct outcome — the interval
     * was created, the role assignment is a nicety. The adapter
     * reports the partial success as success.
     */
    function addMember(teamId, period, opts) {
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }
        if (!opts || !isNonEmptyString(opts.charId)) {
            return failure('Character ID is required.');
        }

        var join = (opts.join === undefined || opts.join === null)
            ? ''
            : String(opts.join);
        var leave = (opts.leave === undefined || opts.leave === null)
            ? ''
            : String(opts.leave);
        var role = (opts.role === undefined || opts.role === null)
            ? ''
            : String(opts.role).trim();

        return TeamCore.addMemberInterval(
            teamId, opts.charId, join, leave
        ).then(function(result) {
            if (!result || !result.success) {
                return result || {
                    success: false,
                    message: 'Failed to add member.'
                };
            }
            if (role === '') {
                return result;
            }
            return TeamCore.updateMember(
                teamId, opts.charId, { role: role }
            ).then(function(roleResult) {
                // If the role update fails, the member still exists.
                // Report the overall result as success; the interval
                // was created, which is what the user asked for.
                if (!roleResult || !roleResult.success) {
                    console.warn(
                        '[MemberAdapterTeams] addMember: interval ' +
                        'created but role update failed.'
                    );
                }
                return result;
            });
        });
    }

    /**
     * Apply a list of edits. Each change entry is one of:
     *   { characterId, joinPeriod, role }    → role-only edit
     *   { characterId, joinPeriod, leave }   → leave-only edit
     *   { characterId, joinPeriod, join, leave } → join replacement
     *     (joinPeriod is the ORIGINAL join; join is the NEW join)
     *   { characterId, joinPeriod, join, leave, role } → mixed
     *
     * The three stages run in this order:
     *   1. Roles (deduplicated by characterId).
     *   2. Join replacements.
     *   3. Leave-only edits.
     *
     * If any stage rejects, the chain stops. Later edits are not
     * attempted. The caller (MemberManager) shows the failure and
     * leaves the manager open, so the user can see the state.
     */
    function updateMembers(teamId, period, changes) {
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }
        if (!Array.isArray(changes) || changes.length === 0) {
            return Promise.resolve({ success: true });
        }

        var roleByChar = Object.create(null);
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

            if (hasRole) {
                roleByChar[charId] = String(c.role);
            }

            if (hasJoin) {
                joinReplacements.push({
                    characterId: charId,
                    oldJoin: originalJoin,
                    newJoin: String(c.join),
                    newLeave: hasLeave
                        ? String(c.leave)
                        : ''
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

        var chain = Promise.resolve();
        var failureResult = null;

        // ---- Stage 1: roles ----
        var roleCharIds = Object.keys(roleByChar);
        roleCharIds.forEach(function(charId) {
            chain = chain.then(function() {
                if (failureResult) { return; }
                return TeamCore.updateMember(
                    teamId, charId, { role: roleByChar[charId] }
                ).then(function(result) {
                    if (!result || !result.success) {
                        failureResult = result || {
                            success: false,
                            message: 'Failed to update role.'
                        };
                    }
                });
            });
        });

        // ---- Stage 2: join replacements ----
        joinReplacements.forEach(function(jr) {
            chain = chain.then(function() {
                if (failureResult) { return; }
                return TeamCore.purgeMemberInterval(
                    teamId, jr.characterId, jr.oldJoin
                ).then(function(purgeResult) {
                    if (!purgeResult || !purgeResult.success) {
                        // Purge may fail when oldJoin was empty and
                        // no other interval matched. Fall through
                        // and try the add anyway — the user's
                        // intent is "this stint now has this join
                        // and leave." The add creates the interval.
                        console.warn(
                            '[MemberAdapterTeams] purge before join ' +
                            'replacement did not succeed; ' +
                            'attempting add.'
                        );
                    }
                    return TeamCore.addMemberInterval(
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

        // ---- Stage 3: leave-only edits ----
        leaveEdits.forEach(function(le) {
            chain = chain.then(function() {
                if (failureResult) { return; }

                if (le.leave === '') {
                    // Reopen: clear the leave.
                    return TeamCore.reopenMemberInterval(
                        teamId, le.characterId, le.joinPeriod
                    ).then(function(result) {
                        if (!result || !result.success) {
                            failureResult = result || {
                                success: false,
                                message: 'Failed to clear leave.'
                            };
                        }
                    });
                }

                return TeamCore.endMemberInterval(
                    teamId, le.characterId, le.joinPeriod, le.leave
                ).then(function(result) {
                    if (!result || !result.success) {
                        failureResult = result || {
                            success: false,
                            message: 'Failed to set leave.'
                        };
                    }
                });
            });
        });

        return chain.then(function() {
            if (failureResult) {
                return failureResult;
            }
            return { success: true };
        });
    }

    /**
     * Remove one stint. identifier is either a composite or a
     * memberId string. TeamCore.purgeMemberInterval addresses by
     * (characterId, joinPeriod); memberId is not used by TeamCore,
     * so when only a memberId is available we fall back to reading
     * the team and matching by memberId.
     */
    function removeStint(teamId, period, identifier) {
        var id = extractIdentifier(identifier);

        if (id.characterId !== '' && id.joinPeriod !== '') {
            return TeamCore.purgeMemberInterval(
                teamId, id.characterId, id.joinPeriod
            );
        }

        // MemberId-only path. Look up the member, take their first
        // interval's join, and purge by that. If the member has no
        // intervals, remove the whole entry.
        if (id.memberId !== '') {
            var vm = fetchVM(teamId, period);
            if (!vm) {
                return failure('Team not found.');
            }
            var match = findMemberByMemberId(vm, id.memberId);
            if (!match) {
                return failure('Member not found.');
            }
            if (!Array.isArray(match.intervals) ||
                match.intervals.length === 0) {
                return TeamCore.removeMember(
                    teamId, match.characterId
                );
            }
            var firstJoin = match.intervals[0].joinPeriod || '';
            return TeamCore.purgeMemberInterval(
                teamId, match.characterId, firstJoin
            );
        }

        // Last resort: no addressable identity. Fail loudly.
        return failure(
            'This stint does not carry enough identity to remove.'
        );
    }

    /**
     * Rejoin: clear the leave on the identified stint.
     */
    function rejoinStint(teamId, period, identifier) {
        var id = extractIdentifier(identifier);

        if (id.characterId !== '' && id.joinPeriod !== '') {
            return TeamCore.reopenMemberInterval(
                teamId, id.characterId, id.joinPeriod
            );
        }

        if (id.memberId !== '') {
            var vm = fetchVM(teamId, period);
            if (!vm) {
                return failure('Team not found.');
            }
            var match = findMemberByMemberId(vm, id.memberId);
            if (!match) {
                return failure('Member not found.');
            }
            if (!Array.isArray(match.intervals) ||
                match.intervals.length === 0) {
                return failure('Member has no stints to rejoin.');
            }
            var firstJoin = match.intervals[0].joinPeriod || '';
            return TeamCore.reopenMemberInterval(
                teamId, match.characterId, firstJoin
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
        return TeamCore.removeMember(teamId, charId);
    }

    // ============================================================
    // INTERNAL LOOKUPS
    // ============================================================

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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MemberAdapterTeams = Object.freeze({
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
        var exports = window.MemberAdapterTeams;
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
                '[MemberAdapterTeams] Verification - some exports may ' +
                'be missing:', missing.join(', ')
            );
        }
    })();

})();