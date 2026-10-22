/**
 * modules/teams/member-adapter-teams.js
 * Teams Member Manager Adapter.
 *
 * Path: js/modules/teams/member-adapter-teams.js
 *
 * Binds the shared MemberManager to the Team domain. The other
 * adapter (member-adapter-academy.js) implements the same six-method
 * contract for Academy Weekly Teams.
 *
 * ADAPTER CONTRACT:
 *   fetchVM(teamId, period)
 *   addMember(teamId, period, { charId, role, join, leave })
 *   updateMembers(teamId, period, changes)
 *   removeStint(teamId, period, identifier)
 *   rejoinStint(teamId, period, identifier)
 *   removeMember(teamId, period, charId)
 *
 * IDENTIFIER FORMS:
 *   - composite { characterId, joinPeriod }
 *   - memberId (used for member-level operations, not stint-level)
 *
 * STINT IDENTITY:
 *   A stint is identified by (characterId, joinPeriod). A bare
 *   memberId names a member entry, not a stint. Stint-level
 *   operations require the composite form; a bare memberId is
 *   rejected.
 *
 * JOIN IS IMMUTABLE:
 *   Changing a join is a replace (purge-and-add) operation. It
 *   runs inside ONE transaction via TeamCore.replaceMemberInterval,
 *   so a failure at any point leaves the original stint in place.
 *   The replacement requires its leave period up front; replacing
 *   the start without knowing the end would silently discard the
 *   existing leave period.
 *
 * ROLE IS PER-MEMBER:
 *   TeamCore stores role on the member entry. A role change routes
 *   to TeamCore.updateMember regardless of which row it came from.
 *
 * DISPATCH ORDER (updateMembers):
 *   1. Role updates (deduplicated by characterId) — only for
 *      changes that do NOT also touch the join. A change that
 *      touches the join routes the role through
 *      replaceMemberInterval, so the role survives the purge.
 *   2. Join replacements (atomic via replaceMemberInterval).
 *   3. Leave-only edits (atomic via replaceMemberLeave; handles
 *      both shorten AND extend of an already-closed stint).
 *
 * ATOMICITY:
 *   Every stage is now a single TeamCore transaction:
 *   - role only     → updateMember (one transaction)
 *   - join replace  → replaceMemberInterval (one transaction)
 *   - leave edit    → replaceMemberLeave (one transaction)
 *
 *   addMember remains a two-transaction compose (addMemberInterval
 *   then updateMember for the role), because TeamCore does not
 *   expose a combined create-with-role primitive and the two
 *   transactions are independent enough that the current
 *   reporting is honest (addMessage says "Member was added, but
 *   the requested role could not be assigned" when the role half
 *   fails, and the user sees the actual state).
 *
 * ACTIVE VS FORMER PARTITION:
 *   buildVM partitions the adapter's active / former lists by
 *   interval bounds, not by TeamQueries.isMemberActive /
 *   isMemberFormer. Those predicates are year-scoped and answer
 *   "is this member active/former at periodNum". The manager
 *   needs "does this member have any stint the user should see
 *   in the active list", which is:
 *
 *     ACTIVE list:  member has at least one interval that is
 *                   open (leavePeriod ''), or whose leavePeriod
 *                   is >= periodNum, or whose joinPeriod is
 *                   > periodNum (a future stint).
 *
 *     FORMER list:  member has intervals but none of them match
 *                   the active condition — i.e. every stint is
 *                   closed at a period < periodNum and none are
 *                   open or future.
 *
 *   The old predicate-based partition dropped members with a
 *   single future stint entirely (neither "active now" nor
 *   "former before now"), so the user could not see or edit
 *   them. The interval-bounds partition includes them in the
 *   active list where they belong.
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
    if (!TeamCore || typeof TeamCore.updateMember !== 'function') {
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
        typeof TeamCore.replaceMemberInterval !== 'function') {
        _missing.push('TeamCore.replaceMemberInterval');
    }
    if (!TeamCore ||
        typeof TeamCore.replaceMemberLeave !== 'function') {
        _missing.push('TeamCore.replaceMemberLeave');
    }
    if (!TeamCore || typeof TeamCore.removeMember !== 'function') {
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
            return {
                characterId: isNonEmptyString(identifier.characterId)
                    ? String(identifier.characterId)
                    : '',
                joinPeriod: (identifier.joinPeriod === undefined ||
                             identifier.joinPeriod === null)
                    ? ''
                    : String(identifier.joinPeriod),
                memberId: isNonEmptyString(identifier.memberId)
                    ? String(identifier.memberId)
                    : ''
            };
        }
        return { characterId: '', joinPeriod: '', memberId: '' };
    }

    /**
     * Does this interval belong in the ACTIVE partition?
     *
     * True when the stint is:
     *   - open (leavePeriod ''), OR
     *   - still running at periodNum (leavePeriod >= periodNum), OR
     *   - starts after periodNum (joinPeriod > periodNum).
     *
     * The third case is what includes a purely-future stint so the
     * user can see and edit it in the manager. Before this
     * classification, a member with one old closed stint and one
     * future stint was classified as "former" by the year-scoped
     * predicates and the future stint was filtered out of both
     * partitions.
     */
    function isIntervalVisibleAt(interval, periodNum) {
        if (!interval || typeof interval !== 'object') {
            return false;
        }

        var leaveStr = (interval.leavePeriod === undefined ||
                        interval.leavePeriod === null)
            ? ''
            : String(interval.leavePeriod).trim();
        var joinStr = (interval.joinPeriod === undefined ||
                       interval.joinPeriod === null)
            ? ''
            : String(interval.joinPeriod).trim();

        if (leaveStr === '') { return true; }

        var leaveNum = parseInt(leaveStr, 10);
        if (!isNaN(leaveNum) && leaveNum >= periodNum) { return true; }

        var joinNum = parseInt(joinStr, 10);
        if (!isNaN(joinNum) && joinNum > periodNum) { return true; }

        return false;
    }

    function hasVisibleInterval(member, periodNum) {
        if (!member || !Array.isArray(member.intervals)) {
            return false;
        }
        for (var i = 0; i < member.intervals.length; i++) {
            if (isIntervalVisibleAt(member.intervals[i], periodNum)) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // VM TRANSLATION
    // ============================================================

    function buildVM(teamId, period) {
        var raw = TeamAggregator.getMemberModalViewModel(
            teamId, period
        );
        if (!raw) { return null; }

        var periodNum = TeamConstants.parsePeriod(period);
        if (periodNum === null) {
            throw new Error(
                '[MemberAdapterTeams] fetchVM requires a valid period.'
            );
        }

        var membersRaw = raw.members;
        if (!Array.isArray(membersRaw)) {
            throw new Error(
                '[MemberAdapterTeams] getMemberModalViewModel ' +
                'returned a malformed members array.'
            );
        }

        var candidatesRaw = raw.candidates;
        if (!Array.isArray(candidatesRaw)) {
            throw new Error(
                '[MemberAdapterTeams] getMemberModalViewModel ' +
                'returned a malformed candidates array.'
            );
        }

        var active = [];
        var former = [];

        for (var i = 0; i < membersRaw.length; i++) {
            var m = membersRaw[i];
            if (!m || !m.characterId) { continue; }

            if (hasVisibleInterval(m, periodNum)) {
                active.push(buildMemberVM(m, periodNum, false));
                continue;
            }
            former.push(buildMemberVM(m, periodNum, true));
        }

        return {
            teamId: raw.teamId,
            teamName: raw.teamName,
            period: raw.period,
            members: active,
            formerMembers: former,
            candidates: candidatesRaw.slice()
        };
    }

    function buildMemberVM(member, periodNum, isFormer) {
        if (typeof member.displayName !== 'string') {
            throw new Error(
                '[MemberAdapterTeams] member VM missing displayName.'
            );
        }
        if (!Array.isArray(member.intervals)) {
            throw new Error(
                '[MemberAdapterTeams] member VM missing intervals ' +
                'array.'
            );
        }

        var intervals = [];
        var rawIntervals = member.intervals;

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
            name: member.displayName,
            role: member.role || '',
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
                    return {
                        success: false,
                        message: 'Member was added, but the ' +
                            'requested role could not be assigned.'
                    };
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
     * A join change requires both `join` and `leave`: replacing
     * the start without knowing the end would silently discard
     * the existing leave period.
     *
     * Every stage is now a single TeamCore transaction (see the
     * file header's ATOMICITY note). The chain stops on the
     * first failure and returns its message; since each stage is
     * atomic, the message describes the actual state.
     */
    function updateMembers(teamId, period, changes) {
        if (!isNonEmptyString(teamId)) {
            return failure('Team ID is required.');
        }
        if (!Array.isArray(changes) || changes.length === 0) {
            return Promise.resolve({ success: true });
        }

        var roleOnlyByChar = Object.create(null);
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
            var hasLeave = c.leave !== undefined &&
                           c.leave !== null;

            if (hasJoin) {
                if (!hasLeave) {
                    return failure(
                        'Changing a join period requires the ' +
                        'replacement leave period.'
                    );
                }
                joinReplacements.push({
                    characterId: charId,
                    oldJoin: originalJoin,
                    newJoin: String(c.join),
                    newLeave: String(c.leave),
                    role: hasRole ? String(c.role) : null
                });
                continue;
            }

            if (hasRole) {
                roleOnlyByChar[charId] = String(c.role);
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

        // ---- Stage 1: role-only updates ----
        //
        // Role updates for changes that did NOT touch the join.
        // A join change routes its role through
        // replaceMemberInterval in stage 2 instead, so the role
        // survives the purge; a separate role update for the same
        // change would be redundant and could conflict with the
        // purge's member-entry churn.
        var roleCharIds = Object.keys(roleOnlyByChar);
        roleCharIds.forEach(function(charId) {
            chain = chain.then(function() {
                if (failureResult) { return; }
                return TeamCore.updateMember(
                    teamId,
                    charId,
                    { role: roleOnlyByChar[charId] }
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

        // ---- Stage 2: join replacements (atomic) ----
        //
        // One transaction per replacement. If the new interval
        // would overlap another stint, or start after the
        // character's death year, replaceMemberInterval rejects
        // it and the original stint is preserved.
        joinReplacements.forEach(function(jr) {
            chain = chain.then(function() {
                if (failureResult) { return; }
                return TeamCore.replaceMemberInterval(
                    teamId,
                    jr.characterId,
                    jr.oldJoin,
                    jr.newJoin,
                    jr.newLeave,
                    jr.role
                ).then(function(result) {
                    if (!result || !result.success) {
                        failureResult = result || {
                            success: false,
                            message: 'Failed to replace the interval.'
                        };
                    }
                });
            });
        });

        // ---- Stage 3: leave-only edits (atomic) ----
        //
        // One transaction per edit. replaceMemberLeave handles
        // both shortening an open stint and extending an already-
        // closed one (the latter is what endMemberInterval would
        // refuse with "already closed at or before"). A blank
        // leave reopens the stint, which is what the manager
        // means when the user clears the leave field.
        leaveEdits.forEach(function(le) {
            chain = chain.then(function() {
                if (failureResult) { return; }
                return TeamCore.replaceMemberLeave(
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
            if (failureResult) { return failureResult; }
            return { success: true };
        });
    }

    function removeStint(teamId, period, identifier) {
        var id = extractIdentifier(identifier);

        if (id.characterId === '' || id.joinPeriod === '') {
            return failure(
                'Cannot identify the stint to remove. ' +
                '(characterId and joinPeriod are required.)'
            );
        }

        return TeamCore.purgeMemberInterval(
            teamId,
            id.characterId,
            id.joinPeriod
        );
    }

    function rejoinStint(teamId, period, identifier) {
        var id = extractIdentifier(identifier);

        if (id.characterId === '' || id.joinPeriod === '') {
            return failure(
                'Cannot identify the stint to rejoin. ' +
                '(characterId and joinPeriod are required.)'
            );
        }

        return TeamCore.reopenMemberInterval(
            teamId,
            id.characterId,
            id.joinPeriod
        );
    }

    function removeMember(teamId, period, charId) {
        if (!isNonEmptyString(charId)) {
            return failure('Character ID is required.');
        }
        return TeamCore.removeMember(teamId, charId);
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
