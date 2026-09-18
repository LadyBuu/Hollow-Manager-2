/**
 * modules/teams/member-adapter-teams.js
 * Teams Member Manager Adapter
 *
 * Path: js/modules/teams/member-adapter-teams.js
 *
 * Binds the shared MemberManager to the professional Team domain.
 * This is one of two adapters; the other is member-adapter-academy.js.
 * Both implement the same six-method contract defined in
 * modules/shared/member-manager.js.
 *
 * RESPONSIBILITY:
 *   Translate MemberManager's domain-agnostic requests into
 *   TeamCore mutations and TeamAggregator reads.
 *
 * WHAT THIS ADAPTER DOES NOT DO:
 *   - Render.
 *   - Touch the DOM.
 *   - Own UI state.
 *   - Know about Academy Weekly Teams.
 *   - Reimplement the active/former partition. That predicate is
 *     owned by TeamQueries.
 *
 * ADAPTER CONTRACT (six methods):
 *   fetchVM(teamId, period)
 *   addMember(teamId, period, { charId, role, join, leave })
 *   updateMembers(teamId, period, changes)
 *   removeStint(teamId, period, identifier)
 *   rejoinStint(teamId, period, identifier)
 *   removeMember(teamId, period, charId)
 *
 * IDENTIFIER FORMS:
 *   - composite { characterId, joinPeriod }
 *   - memberId string
 *
 *   `extractIdentifier` normalises either form to an object with
 *   characterId, joinPeriod, and memberId fields. Callers check
 *   the fields they need.
 *
 * JOIN IS IMMUTABLE:
 *   Changing a join is a purge-and-replace: remove the interval,
 *   add a new one with the new join and the same leave.
 *
 * ROLE IS PER-MEMBER:
 *   TeamCore stores role on the member entry, not on intervals.
 *   A role change routes to TeamCore.updateMember regardless of
 *   which row it came from.
 *
 * DISPATCH ORDER WITHIN updateMembers:
 *   1. Role updates (deduplicated by characterId).
 *   2. Join replacements (purge + add).
 *   3. Leave-only edits.
 *
 *   If any stage fails, the chain stops and returns the first
 *   failure. Successful steps are already committed.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamAggregator
 *   - window.TeamCore
 *   - window.TeamConstants
 *   - window.TeamQueries
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
    var TeamQueries = window.TeamQueries;

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
    if (!TeamQueries ||
        typeof TeamQueries.isMemberActive !== 'function') {
        _missing.push('TeamQueries.isMemberActive');
    }
    if (!TeamQueries ||
        typeof TeamQueries.isMemberFormer !== 'function') {
        _missing.push('TeamQueries.isMemberFormer');
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

    /**
     * Normalise an identifier to an object with three fields:
     * characterId, joinPeriod, and memberId. Missing fields are ''.
     *
     * Callers check the fields they need. The three-field shape is
     * uniform so callers do not have to switch on the identifier's
     * original form.
     */
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
            var joinPeriod =
                (identifier.joinPeriod === undefined ||
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
    // TeamAggregator.getMemberModalViewModel returns members with
    // `activeAtPeriod` set per interval, but does not partition
    // them. The partition is computed here using TeamQueries
    // predicates, which are the canonical owner of the active and
    // former definitions.
    //
    // The manager expects:
    //   { teamId, teamName, period, members, formerMembers,
    //     candidates }

    function buildVM(teamId, period) {
        var raw = TeamAggregator.getMemberModalViewModel(teamId, period);
        if (!raw) {
            return null;
        }

        var periodNum = TeamConstants.parsePeriod(period);

        var active = [];
        var former = [];

        var membersRaw = Array.isArray(raw.members) ? raw.members : [];
        for (var i = 0; i < membersRaw.length; i++) {
            var m = membersRaw[i];
            if (!m || !m.characterId) {
                continue;
            }

            // The aggregator's member VM carries the same storage
            // shape fields the predicates expect (intervals array,
            // per-interval joinPeriod / leavePeriod). Casting to a
            // member entry is a shape no-op.
            if (periodNum !== null &&
                TeamQueries.isMemberActive(m, periodNum)) {
                active.push(buildMemberVM(m, periodNum, false));
                continue;
            }

            if (periodNum !== null &&
                TeamQueries.isMemberFormer(m, periodNum)) {
                former.push(buildMemberVM(m, periodNum, true));
            }
            // Members with no active interval and no leave before
            // the period (future-only stints) are not shown.
        }

        return {
            teamId: raw.teamId,
            teamName: raw.teamName,
            period: raw.period,
            members: active,
            formerMembers: former,
            candidates: Array.isArray(raw.candidates)
                ? raw.candidates
                : []
        };
    }

    /**
     * Build a manager-shaped member VM.
     *
     * The input is the aggregator's member VM. This function renames
     * `displayName` → `name` and copies the intervals array with
     * their per-interval periodDisplay.
     */
    function buildMemberVM(member, periodNum, isFormer) {
        var intervals = [];
        var rawIntervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

        for (var i = 0; i < rawIntervals.length; i++) {
            var iv = rawIntervals[i];
            if (!iv || typeof iv !== 'object') {
                continue;
            }

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
     *   1. addMemberInterval(teamId, charId, join, leave).
     *   2. If role is non-empty and differs from the default, call
     *      updateMember(teamId, charId, { role }).
     *
     * If step 1 succeeds but step 2 fails, the member exists with
     * the default role. That is the correct outcome — the interval
     * was created, the role assignment is a nicety.
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
            teamId,
            opts.charId,
            join,
            leave
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
                teamId,
                opts.charId,
                { role: role }
            ).then(function(roleResult) {
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
     *   { characterId, joinPeriod, role }
     *   { characterId, joinPeriod, leave }
     *   { characterId, joinPeriod, join, leave }
     *   { characterId, joinPeriod, join, leave, role }
     *
     * Stages run in order. If any stage rejects, the chain stops.
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
            if (!c || !isNonEmptyString(c.characterId)) {
                continue;
            }

            var charId = String(c.characterId);
            var originalJoin = (c.joinPeriod === undefined ||
                                c.joinPeriod === null)
                ? ''
                : String(c.joinPeriod);

            var hasRole = c.role !== undefined && c.role !== null;
            var hasJoin = c.join !== undefined &&
                          c.join !== null &&
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

        var chain = Promise.resolve();
        var failureResult = null;

        // ---- Stage 1: roles ----
        var roleCharIds = Object.keys(roleByChar);
        roleCharIds.forEach(function(charId) {
            chain = chain.then(function() {
                if (failureResult) {
                    return;
                }
                return TeamCore.updateMember(
                    teamId,
                    charId,
                    { role: roleByChar[charId] }
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
                if (failureResult) {
                    return;
                }
                return TeamCore.purgeMemberInterval(
                    teamId,
                    jr.characterId,
                    jr.oldJoin
                ).then(function(purgeResult) {
                    if (!purgeResult || !purgeResult.success) {
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
                if (failureResult) {
                    return;
                }

                if (le.leave === '') {
                    return TeamCore.reopenMemberInterval(
                        teamId,
                        le.characterId,
                        le.joinPeriod
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
                    teamId,
                    le.characterId,
                    le.joinPeriod,
                    le.leave
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
     * Remove one stint.
     */
    function removeStint(teamId, period, identifier) {
        var id = extractIdentifier(identifier);

        if (id.characterId !== '' && id.joinPeriod !== '') {
            return TeamCore.purgeMemberInterval(
                teamId,
                id.characterId,
                id.joinPeriod
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
                return TeamCore.removeMember(
                    teamId,
                    match.characterId
                );
            }
            var firstJoin = match.intervals[0].joinPeriod || '';
            return TeamCore.purgeMemberInterval(
                teamId,
                match.characterId,
                firstJoin
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
        var id = extractIdentifier(identifier);

        if (id.characterId !== '' && id.joinPeriod !== '') {
            return TeamCore.reopenMemberInterval(
                teamId,
                id.characterId,
                id.joinPeriod
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
                teamId,
                match.characterId,
                firstJoin
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

})();