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
 *   Changing a join is a purge-and-add, which is a destructive
 *   sequence. The adapter requires the replacement's leave period
 *   up front, and stops on purge failure rather than attempting
 *   the add on top of a failed purge.
 *
 * ROLE IS PER-MEMBER:
 *   TeamCore stores role on the member entry. A role change routes
 *   to TeamCore.updateMember regardless of which row it came from.
 *
 * DISPATCH ORDER (updateMembers):
 *   1. Role updates (deduplicated by characterId).
 *   2. Join replacements (purge + add).
 *   3. Leave-only edits.
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

    /**
     * Normalise an identifier to an object with three fields.
     * Missing fields are ''. Callers check the fields they need.
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

    // ============================================================
    // VM TRANSLATION
    // ============================================================
    //
    // TeamAggregator.getMemberModalViewModel returns member VMs with
    // per-interval activeAtPeriod flags. This adapter partitions
    // them into active/former using the TeamQueries predicates,
    // which are the canonical owner of those definitions.

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

            if (TeamQueries.isMemberActive(m, periodNum)) {
                active.push(buildMemberVM(m, periodNum, false));
                continue;
            }
            if (TeamQueries.isMemberFormer(m, periodNum)) {
                former.push(buildMemberVM(m, periodNum, true));
            }
            // Neither: only-future stints. Not shown.
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

    /**
     * Add a member.
     *
     * Role failure surfaces as a failure of the whole operation.
     * TeamCore.addMemberInterval and TeamCore.updateMember are two
     * separate pipeline transactions; the adapter cannot roll back
     * the interval after a role failure. It reports the failure
     * honestly so the caller knows the resulting state.
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
     * Join replacement requires both `join` and `leave`: replacing
     * the start without knowing the end would silently discard the
     * existing leave period. The adapter enforces this.
     *
     * Stages run in order. The chain stops on the first failure.
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
            var hasLeave = c.leave !== undefined &&
                           c.leave !== null;

            if (hasRole) {
                roleByChar[charId] = String(c.role);
            }

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
        //
        // Purge failure stops the replacement. Attempting the add
        // on top of a failed purge would produce two intervals.
        joinReplacements.forEach(function(jr) {
            chain = chain.then(function() {
                if (failureResult) { return; }
                return TeamCore.purgeMemberInterval(
                    teamId,
                    jr.characterId,
                    jr.oldJoin
                ).then(function(purgeResult) {
                    if (!purgeResult || !purgeResult.success) {
                        failureResult = purgeResult || {
                            success: false,
                            message: 'Failed to remove the old ' +
                                'interval before replacement.'
                        };
                        return;
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
                                message: 'Failed to add the ' +
                                    'replacement interval.'
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
            if (failureResult) { return failureResult; }
            return { success: true };
        });
    }

    /**
     * Remove one stint.
     *
     * Stint identity is (characterId, joinPeriod). A bare memberId
     * is not sufficient: a member entry can carry multiple stints,
     * and picking one arbitrarily is not a substitute for naming
     * the one the user asked for.
     */
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

    /**
     * Rejoin: clear the leave on the identified stint.
     */
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
