/**
 * modules/shared/queries/mission-queries.js - Mission Queries
 * Read-only facade for mission data.
 *
 * Path: js/modules/missions/mission-queries.js
 *
 * RESPONSIBILITIES:
 *   - Reading missions from window.data.missions.
 *   - Filtering, searching, sorting missions.
 *   - Aggregating statistics over missions.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Mutations. MissionCore owns those.
 *   - Domain rules. MissionRules owns those.
 *   - Structural validation. MissionSchema owns that.
 *   - ID grammar. MissionId owns that. This module composes with
 *     MissionId only for the derived-label materialisation used
 *     by searchMissions.
 *   - Cross-domain reads beyond the two-hop character→team
 *     derivation. This module does NOT query characters or any
 *     other domain directly.
 *
 * ARCHIVED MISSIONS:
 *   A mission with a non-null `archivedAt` is archived. Archived
 *   missions are EXCLUDED by default from every collection read.
 *   Pass { includeArchived: true } to include them.
 *
 *   getMission(id) does NOT filter — it returns the mission if it
 *   exists, archived or not. Callers who need to check archive
 *   state read `mission.archivedAt` or use `isArchived(mission)`.
 *
 * TEAM ASSIGNMENTS:
 *   A mission may be assigned to any number of professional teams,
 *   stored in `assignedTeamIds` (an array of team UUIDs).
 *
 *   Legacy records carry a singular `assignedTeamId`. This module
 *   transparently coerces that scalar into a single-element array
 *   when reading, so a caller never has to know which shape the
 *   stored record has.
 *
 *   The canonical accessor is `getTeamIdsForMission(mission)`. It
 *   returns a fresh array of normalised team ids. Every read in
 *   this module that consults team assignment goes through it.
 *
 * PARTICIPANTS:
 *   A mission carries a `participants` array. Each entry is
 *   { characterId, teamId, source } where source is 'team' or
 *   'rookie'. teamId is a team UUID for a 'team' participant and
 *   null for a 'rookie' participant.
 *
 *   The canonical accessor is `getParticipantsForMission(mission)`.
 *   It returns a fresh array of normalised participant records
 *   (characterId, teamId, source), dropping any malformed entries.
 *
 *   `isParticipantInMission(mission, characterId, teamId)` answers
 *   whether a given (characterId, teamId) pair appears in the
 *   participant list. `teamId === null` is treated as the rookie
 *   case and matches only rookie entries.
 *
 *   `getParticipatingMissionsForCharacter(characterId, options)`
 *   returns every mission the character is a participant in.
 *   Distinct from getMissionsForCharacter, which answers a
 *   different question (see below).
 *
 * getMissionsForCharacter vs getParticipatingMissionsForCharacter:
 *   These are two different questions and both are useful:
 *
 *     getMissionsForCharacter(charId)
 *       "What missions did the teams you were ever on run?"
 *       Derived via character → teams → missions (the two-hop
 *       team-assignment derivation). Includes missions the
 *       character did not personally take part in.
 *
 *     getParticipatingMissionsForCharacter(charId)
 *       "What missions are you listed as a participant in?"
 *       A direct read of the participants array. Precise to the
 *       individual, not the team.
 *
 *   A caller that wants "this character's history on missions"
 *   almost always wants the second. A caller that wants "what was
 *   happening around this character" wants the first.
 *
 * RETURNS:
 *   Every mission-returning function returns a DEEP CLONE. The
 *   caller cannot mutate the live store through the returned
 *   object. If cloning fails, the function throws; it never returns
 *   the live reference as a fallback.
 *
 * SORTING:
 *   Collection reads sort by `createdAt` descending (newest first)
 *   before returning. This is the canonical list ordering for the
 *   mission domain. Callers that need a different order sort the
 *   returned array themselves.
 *
 * DERIVED LABEL:
 *   The human-facing `missionId` label is not stored. When a caller
 *   needs it, use `MissionId.derive(mission)`. This module does not
 *   attach it to returned records; that composition belongs to
 *   MissionAggregator.
 *
 *   The only place the label is materialised inside this module is
 *   searchMissions, which derives it per candidate to include it in
 *   the free-text index. The materialisation is per-candidate and
 *   transient; nothing is stored.
 *
 * TEAM DEPRECATION AND RANKINGS (this revision):
 *   A team deprecates when its last member dies or leaves. The
 *   first year the team has zero active members is its
 *   DEPRECATION YEAR.
 *
 *   From that year onward:
 *     - the team has no effective rank, so it drops out of every
 *       ranked read;
 *     - the surviving teams' positions COMPACT upward to fill the
 *       hole (a team at display position 4 rises to 3 when the
 *       team at 3 deprecates, etc.). There are no gaps in the
 *       lineup;
 *     - the team does NOT appear in the unranked picker either —
 *       it can never be re-ranked, because it is gone;
 *     - its stored rankingHistory is UNTOUCHED for every year
 *       before the deprecation year. Past years keep their
 *       records. Only the stale tail at >= deprecationYear is
 *       inert.
 *
 *   Stored ranks at years >= deprecationYear are left in
 *   rankingHistory (nothing is deleted by a read), but the
 *   effective-rank resolver ignores them. removeRankingAt
 *   additionally prunes them inside its own transaction so the
 *   stored shape and the displayed shape cannot drift after a
 *   manual removal.
 *
 *   The deprecation year is computed structurally, from the team
 *   record, without any new field:
 *
 *     deprecationYear = min(
 *       endPeriod + 1                 // if endPeriod is set
 *       max(leavePeriod) + 1          // if all stints are closed
 *     )
 *
 *   A team with an open-ended endPeriod AND at least one
 *   open-ended stint has no inferable deprecation year and its
 *   inherited rank survives at every year (the user has not
 *   closed anything). A team marked deprecated with a still-open
 *   window and still-live stints is a data inconsistency; leaving
 *   its rank in place is the least destructive behaviour, and the
 *   user can resolve the state through the normal edit flow.
 *
 *   This rule is mirrored in team-core.js's
 *   resolveEffectiveRankForTeam and isTeamInScopeForRanking. The
 *   two layers must agree: the write path builds snapshots from
 *   the same effective-rank set the read path displays, or the
 *   displayed order and the stored order diverge.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.IdUtils
 *   - window.MissionConstants
 *   - window.MissionId            (MissionId.derive)
 *
 * DEPENDENCIES (LAZY, resolved at call time):
 *   - window.TeamQueries
 *     Used by getMissionsForCharacter for the two-hop derivation
 *     character → teams → missions. The mission domain owns the
 *     assignment relationship, but the team lookup itself is
 *     delegated to TeamQueries.
 */

(function() {
    'use strict';

    if (window.__missionQueriesLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var MissionConstants = window.MissionConstants;
    var MissionId = window.MissionId;

    var _missing = [];

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!IdUtils || typeof IdUtils.normaliseId !== 'function') {
        _missing.push('IdUtils.normaliseId');
    }
    if (!MissionConstants || !Array.isArray(MissionConstants.VALID_STATUSES)) {
        _missing.push('MissionConstants.VALID_STATUSES');
    }
    if (!MissionId || typeof MissionId.derive !== 'function') {
        _missing.push('MissionId.derive');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionQueries] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionQueriesLoaded = true;

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

    /**
     * Deep clone via ObjectUtils. Throws if cloning fails or if the
     * clone aliases the input. The query layer must never hand back a
     * live reference.
     */
    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value &&
            value !== null &&
            typeof value === 'object') {
            throw new Error(
                '[MissionQueries] deepClone returned the original reference.'
            );
        }
        return result;
    }

    /**
     * Access the mission store.
     *
     * Returns null when window.data is unavailable or missions is not
     * an array. Reads never create the store.
     */
    function getMissionStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!Array.isArray(window.data.missions)) {
            return null;
        }
        return window.data.missions;
    }

    function isArchived(mission) {
        if (!isPlainObject(mission)) {
            return false;
        }
        return mission.archivedAt !== undefined &&
               mission.archivedAt !== null &&
               mission.archivedAt !== '';
    }

    /**
     * Compare two ISO timestamp strings, newest first. Missing or
     * malformed timestamps sort to the end.
     */
    function compareByCreatedAtDesc(a, b) {
        var ta = isNonEmptyString(a && a.createdAt) ? a.createdAt : '';
        var tb = isNonEmptyString(b && b.createdAt) ? b.createdAt : '';
        if (ta === tb) { return 0; }
        if (ta === '') { return 1; }
        if (tb === '') { return -1; }
        return tb.localeCompare(ta);
    }

    function readIncludeArchived(options) {
        return isPlainObject(options) && options.includeArchived === true;
    }

    // ============================================================
    // TEAM ID RESOLUTION
    // ============================================================
    //
    // A mission carries its assigned teams as `assignedTeamIds` (an
    // array). A record saved by an older version of the app may
    // carry a singular `assignedTeamId` instead.
    //
    // getTeamIdsForMission is the single point through which every
    // read in this module consults team assignment. It normalises
    // every id, deduplicates, and drops blanks. It returns a fresh
    // array; the caller cannot mutate the mission by mutating the
    // result.
    //
    // When both fields are present, the array wins. When neither is
    // present, the result is an empty array.

    function getTeamIdsForMission(mission) {
        if (!isPlainObject(mission)) { return []; }

        var raw = null;

        if (Array.isArray(mission.assignedTeamIds)) {
            raw = mission.assignedTeamIds;
        } else if (mission.assignedTeamId !== undefined &&
                   mission.assignedTeamId !== null &&
                   mission.assignedTeamId !== '') {
            // Legacy singular. Treat as a single-element array.
            raw = [mission.assignedTeamId];
        }

        if (!Array.isArray(raw) || raw.length === 0) {
            return [];
        }

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < raw.length; i++) {
            var id = normaliseId(raw[i]);
            if (id === null) { continue; }
            if (seen[id]) { continue; }
            seen[id] = true;
            result.push(id);
        }

        return result;
    }

    /**
     * Convenience: does the mission have the given team assigned?
     * Uses getTeamIdsForMission, so it works against both shapes.
     */
    function isMissionAssignedToTeam(mission, teamId) {
        if (!isPlainObject(mission)) { return false; }
        var target = normaliseId(teamId);
        if (target === null) { return false; }
        var ids = getTeamIdsForMission(mission);
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] === target) { return true; }
        }
        return false;
    }

    // ============================================================
    // PARTICIPANT RESOLUTION
    // ============================================================
    //
    // getParticipantsForMission normalises each participant record
    // to { characterId, teamId, source }. Malformed entries are
    // dropped from the returned array. Duplicates on
    // (characterId, teamId) are also dropped; the schema forbids
    // them at rest, but the query layer does not trust the store
    // to be schema-clean.
    //
    // The returned array is freshly allocated. The caller cannot
    // mutate the mission by mutating the result.

    function getParticipantsForMission(mission) {
        if (!isPlainObject(mission)) { return []; }
        if (!Array.isArray(mission.participants)) { return []; }

        var raw = mission.participants;
        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < raw.length; i++) {
            var p = raw[i];
            if (!isPlainObject(p)) { continue; }

            var cid = normaliseId(p.characterId);
            if (cid === null) { continue; }

            var tid = null;
            if (p.teamId !== undefined && p.teamId !== null && p.teamId !== '') {
                tid = normaliseId(p.teamId);
                if (tid === null) { continue; }
            }

            var source = p.source;
            if (source !== 'team' && source !== 'rookie') {
                continue;
            }

            // Skip incoherent combinations rather than repairing
            // them. A 'team' participant without a team and a
            // 'rookie' participant with a team are both malformed.
            if (source === 'team' && tid === null) { continue; }
            if (source === 'rookie' && tid !== null) { continue; }

            var key = cid + '::' + (tid === null ? '__null__' : tid);
            if (seen[key]) { continue; }
            seen[key] = true;

            result.push({
                characterId: cid,
                teamId: tid,
                source: source
            });
        }

        return result;
    }

    /**
     * Does the mission list this character as a participant for the
     * given team?
     *
     * teamId === null (or undefined, or '') matches ONLY rookie
     * entries. A non-empty teamId matches only entries on that
     * specific team. A character can be a participant under two
     * teams without either query answering "yes" for the other.
     */
    function isParticipantInMission(mission, characterId, teamId) {
        if (!isPlainObject(mission)) { return false; }
        var cid = normaliseId(characterId);
        if (cid === null) { return false; }

        var tid = null;
        if (teamId !== undefined && teamId !== null && teamId !== '') {
            tid = normaliseId(teamId);
            if (tid === null) { return false; }
        }

        var participants = getParticipantsForMission(mission);
        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            if (p.characterId !== cid) { continue; }
            if (p.teamId !== tid) { continue; }
            return true;
        }
        return false;
    }

    /**
     * Every distinct team id the character is a participant under,
     * across the given mission. Rookie participation (teamId null)
     * does not contribute a team id.
     */
    function getParticipantTeamIdsForCharacter(mission, characterId) {
        if (!isPlainObject(mission)) { return []; }
        var cid = normaliseId(characterId);
        if (cid === null) { return []; }

        var participants = getParticipantsForMission(mission);
        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            if (p.characterId !== cid) { continue; }
            if (p.teamId === null) { continue; }
            if (seen[p.teamId]) { continue; }
            seen[p.teamId] = true;
            result.push(p.teamId);
        }

        return result;
    }

    // ============================================================
    // SINGLE MISSION READ
    // ============================================================

    /**
     * Get a mission by its UUID.
     *
     * This is the ONLY lookup that accepts a UUID. The human-facing
     * label (missionId) is not a lookup key; callers that have a
     * label should search (see searchMissions) or derive the UUID
     * elsewhere.
     *
     * Archived missions are returned. Callers that need to hide
     * archived missions check `mission.archivedAt` or use
     * `isArchived(mission)`.
     *
     * @param {string} missionUuid
     * @returns {object|null} Deep clone, or null when not found
     */
    function getMission(missionUuid) {
        if (!isNonEmptyString(missionUuid)) {
            return null;
        }

        var target = normaliseId(missionUuid);
        if (target === null) {
            return null;
        }

        var store = getMissionStore();
        if (!store) {
            return null;
        }

        for (var i = 0; i < store.length; i++) {
            var m = store[i];
            if (!isPlainObject(m)) { continue; }
            if (normaliseId(m.id) === target) {
                return deepClone(m);
            }
        }

        return null;
    }

    // ============================================================
    // COLLECTION READS
    // ============================================================

    /**
     * Get every mission, optionally filtered by status.
     *
     * @param {string|null} filter - 'active' | 'completed' |
     *   'cancelled' | null/'all' for no status filter.
     * @param {object} [options] - { includeArchived: boolean }
     * @returns {array} Deep clones, sorted by createdAt desc
     */
    function getMissions(filter, options) {
        var includeArchived = readIncludeArchived(options);
        var store = getMissionStore();
        if (!store) {
            return [];
        }

        var wantStatus = null;
        if (isNonEmptyString(filter) && filter !== 'all') {
            wantStatus = filter;
        }

        var result = [];

        for (var i = 0; i < store.length; i++) {
            var m = store[i];
            if (!isPlainObject(m)) { continue; }
            if (!includeArchived && isArchived(m)) { continue; }
            if (wantStatus !== null && m.status !== wantStatus) {
                continue;
            }
            result.push(deepClone(m));
        }

        result.sort(compareByCreatedAtDesc);
        return result;
    }

    function getActiveMissions(options) {
        return getMissions('active', options);
    }

    function getCompletedMissions(options) {
        return getMissions('completed', options);
    }

    function getCancelledMissions(options) {
        return getMissions('cancelled', options);
    }

    /**
     * Get every archived mission, regardless of status.
     *
     * @returns {array} Deep clones, sorted by createdAt desc
     */
    function getArchivedMissions() {
        var store = getMissionStore();
        if (!store) {
            return [];
        }

        var result = [];

        for (var i = 0; i < store.length; i++) {
            var m = store[i];
            if (!isPlainObject(m)) { continue; }
            if (!isArchived(m)) { continue; }
            result.push(deepClone(m));
        }

        result.sort(compareByCreatedAtDesc);
        return result;
    }

    // ============================================================
    // RELATIONSHIP READS
    // ============================================================

    /**
     * Get missions assigned to a specific team.
     *
     * A mission may be assigned to more than one team. This reads
     * `assignedTeamIds` and matches the given team anywhere in that
     * array. Legacy records that still carry a singular
     * `assignedTeamId` are handled transparently.
     *
     * @param {string} teamId
     * @param {object} [options] - { filter, includeArchived }
     * @returns {array} Deep clones
     */
    function getMissionsByTeam(teamId, options) {
        if (!isNonEmptyString(teamId)) {
            return [];
        }

        var target = normaliseId(teamId);
        if (target === null) {
            return [];
        }

        var filter = null;
        if (isPlainObject(options) && isNonEmptyString(options.filter)) {
            filter = options.filter;
        }

        var missions = getMissions(filter, options);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (isMissionAssignedToTeam(m, target)) {
                result.push(m);
            }
        }

        return result;
    }

    /**
     * Get missions that list a specific character as support
     * personnel.
     *
     * @param {string} characterId
     * @param {object} [options] - { filter, includeArchived }
     * @returns {array} Deep clones
     */
    function getMissionsBySupportPersonnel(characterId, options) {
        if (!isNonEmptyString(characterId)) {
            return [];
        }

        var target = normaliseId(characterId);
        if (target === null) {
            return [];
        }

        var filter = null;
        if (isPlainObject(options) && isNonEmptyString(options.filter)) {
            filter = options.filter;
        }

        var missions = getMissions(filter, options);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            var support = Array.isArray(m.supportPersonnel)
                ? m.supportPersonnel
                : [];
            for (var j = 0; j < support.length; j++) {
                if (normaliseId(support[j]) === target) {
                    result.push(m);
                    break;
                }
            }
        }

        return result;
    }

    /**
     * Get missions that list a specific character as a participant.
     *
     * A mission matches when the character's id appears in the
     * participants array at all — regardless of source ('team' or
     * 'rookie') and regardless of which team the character was
     * participating under. The mission is a mission the character
     * took part in.
     *
     * @param {string} characterId
     * @param {object} [options] - { filter, includeArchived }
     * @returns {array} Deep clones
     */
    function getMissionsByParticipant(characterId, options) {
        if (!isNonEmptyString(characterId)) {
            return [];
        }

        var target = normaliseId(characterId);
        if (target === null) {
            return [];
        }

        var filter = null;
        if (isPlainObject(options) && isNonEmptyString(options.filter)) {
            filter = options.filter;
        }

        var missions = getMissions(filter, options);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            var participants = getParticipantsForMission(m);
            for (var j = 0; j < participants.length; j++) {
                if (participants[j].characterId === target) {
                    result.push(m);
                    break;
                }
            }
        }

        return result;
    }

    /**
     * Alias of getMissionsByParticipant. Symmetric with the naming
     * used by MissionAggregator's participant VM builder.
     *
     * @param {string} characterId
     * @param {object} [options]
     * @returns {array}
     */
    function getParticipatingMissionsForCharacter(characterId, options) {
        return getMissionsByParticipant(characterId, options);
    }

    /**
     * Get every mission a character is connected to, via the teams
     * they are or were members of.
     *
     * A mission is assigned to one or more teams (assignedTeamIds).
     * A character is connected to a mission when they are or were a
     * member of any of those teams. This is the "team-derived"
     * connection, distinct from participation (see the file header
     * for the distinction).
     *
     * TWO-HOP DERIVATION:
     *   character → teams (via TeamQueries) → missions (via the
     *   teams' assignedTeamIds).
     *
     * TEAM SET:
     *   Every team the character has ever been a member of,
     *   INCLUDING deprecated teams, via
     *   TeamQueries.getTeamsForCharacterAllTimeIncludingDeprecated.
     *   A deprecated team's missions still happened.
     *
     * MISSION SET:
     *   Archived missions ARE included. A mission that was archived
     *   still happened. The caller decides whether to display
     *   archive state.
     *
     * DEDUPLICATION:
     *   A character on two teams that both ran the same mission
     *   appears once. The first team to claim the mission wins;
     *   the team set is sorted by name, so the choice is
     *   deterministic.
     *
     * RETURNS:
     *   Array of { mission, teamId, teamName }, sorted by team name
     *   ascending, then by mission createdAt descending.
     *
     * DEPENDENCY:
     *   TeamQueries is resolved lazily at call time. When it is
     *   unavailable, returns []. This is a read; an absent
     *   dependency is "no answer", not a failure.
     *
     * @param {string} charId
     * @returns {array}
     */
    function getMissionsForCharacter(charId) {
        if (!isNonEmptyString(charId)) {
            return [];
        }

        var TeamQueries = window.TeamQueries;
        if (!TeamQueries ||
            typeof TeamQueries.getTeamsForCharacterAllTimeIncludingDeprecated !==
                'function') {
            return [];
        }

        var target = String(charId);
        var teams = [];

        try {
            teams = TeamQueries
                .getTeamsForCharacterAllTimeIncludingDeprecated(target) || [];
        } catch (e) {
            console.warn(
                '[MissionQueries] ' +
                'getTeamsForCharacterAllTimeIncludingDeprecated ' +
                'failed:', e
            );
            return [];
        }

        if (!Array.isArray(teams) || teams.length === 0) {
            return [];
        }

        var seenMissionIds = Object.create(null);
        var result = [];

        for (var t = 0; t < teams.length; t++) {
            var team = teams[t];
            if (!team || !team.id) { continue; }

            var teamId = String(team.id);
            var teamName = isNonEmptyString(team.name)
                ? String(team.name)
                : 'Unnamed Team';

            var missions = getMissionsByTeam(teamId, {
                includeArchived: true
            });

            for (var m = 0; m < missions.length; m++) {
                var mission = missions[m];
                if (!mission || !mission.id) { continue; }

                var missionKey = normaliseId(mission.id);
                if (missionKey === null) { continue; }
                if (seenMissionIds[missionKey]) { continue; }
                seenMissionIds[missionKey] = true;

                result.push({
                    mission: mission,
                    teamId: teamId,
                    teamName: teamName
                });
            }
        }

        result.sort(function(a, b) {
            var teamCmp = a.teamName.localeCompare(b.teamName);
            if (teamCmp !== 0) { return teamCmp; }

            var ta = isNonEmptyString(a.mission.createdAt)
                ? a.mission.createdAt
                : '';
            var tb = isNonEmptyString(b.mission.createdAt)
                ? b.mission.createdAt
                : '';
            if (ta !== tb) { return tb.localeCompare(ta); }

            return String(a.mission.id).localeCompare(
                String(b.mission.id)
            );
        });

        return result;
    }

    // ============================================================
    // TYPE AND TAG READS
    // ============================================================

    /**
     * Get missions whose primaryType or secondaryType matches.
     */
    function getMissionsByType(typeId, options) {
        if (!isNonEmptyString(typeId)) {
            return [];
        }

        var filter = null;
        if (isPlainObject(options) && isNonEmptyString(options.filter)) {
            filter = options.filter;
        }

        var missions = getMissions(filter, options);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (m.primaryType === typeId || m.secondaryType === typeId) {
                result.push(m);
            }
        }

        return result;
    }

    /**
     * Get missions that carry a specific tag.
     * Tag comparison is case-insensitive.
     */
    function getMissionsByTag(tag, options) {
        if (!isNonEmptyString(tag)) {
            return [];
        }

        var target = tag.trim().toLowerCase();

        var filter = null;
        if (isPlainObject(options) && isNonEmptyString(options.filter)) {
            filter = options.filter;
        }

        var missions = getMissions(filter, options);
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!Array.isArray(m.tags)) { continue; }
            for (var j = 0; j < m.tags.length; j++) {
                if (typeof m.tags[j] === 'string' &&
                    m.tags[j].trim().toLowerCase() === target) {
                    result.push(m);
                    break;
                }
            }
        }

        return result;
    }

    // ============================================================
    // SEARCH
    // ============================================================

    /**
     * Free-text search over a mission's title, description, notes,
     * location, and derived label.
     *
     * The derived label is computed for each candidate mission via
     * MissionId.derive. This is the only place in the query layer
     * where the label is materialised, and it is per-candidate (not
     * stored). The cost is negligible for realistic mission counts.
     *
     * @param {string} query
     * @param {object} [options] - { filter, includeArchived }
     * @returns {array} Deep clones matching the query
     */
    function searchMissions(query, options) {
        var filter = null;
        if (isPlainObject(options) && isNonEmptyString(options.filter)) {
            filter = options.filter;
        }

        var missions = getMissions(filter, options);

        if (!isNonEmptyString(query)) {
            return missions;
        }

        var term = query.trim().toLowerCase();
        var result = [];

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            var label = MissionId.derive(m) || '';

            var title = typeof m.title === 'string'
                ? m.title.toLowerCase() : '';
            var description = typeof m.description === 'string'
                ? m.description.toLowerCase() : '';
            var notes = typeof m.notes === 'string'
                ? m.notes.toLowerCase() : '';
            var location = typeof m.location === 'string'
                ? m.location.toLowerCase() : '';
            var labelLower = label.toLowerCase();

            if (title.indexOf(term) !== -1 ||
                description.indexOf(term) !== -1 ||
                notes.indexOf(term) !== -1 ||
                location.indexOf(term) !== -1 ||
                labelLower.indexOf(term) !== -1) {
                result.push(m);
            }
        }

        return result;
    }

    // ============================================================
    // STATISTICS
    // ============================================================

    /**
     * Compute statistics across all non-archived missions.
     *
     * @returns {object} {
     *   total, active, completed, cancelled, archived,
     *   byPriority, byDifficulty
     * }
     */
    function getStatistics() {
        var store = getMissionStore();
        var stats = {
            total: 0,
            active: 0,
            completed: 0,
            cancelled: 0,
            archived: 0,
            byPriority: {},
            byDifficulty: {}
        };

        // Initialise the by-* maps with zeroes for every canonical key
        // so callers can read any known key without a missing-key
        // check.
        var priorities = MissionConstants.VALID_PRIORITIES;
        for (var p = 0; p < priorities.length; p++) {
            stats.byPriority[priorities[p]] = 0;
        }
        var difficulties = MissionConstants.VALID_DIFFICULTIES;
        for (var d = 0; d < difficulties.length; d++) {
            stats.byDifficulty[difficulties[d]] = 0;
        }

        if (!store) {
            return stats;
        }

        for (var i = 0; i < store.length; i++) {
            var m = store[i];
            if (!isPlainObject(m)) { continue; }

            if (isArchived(m)) {
                stats.archived++;
                continue;
            }

            stats.total++;

            if (m.status === 'active') { stats.active++; }
            else if (m.status === 'completed') { stats.completed++; }
            else if (m.status === 'cancelled') { stats.cancelled++; }

            if (typeof m.priority === 'string' &&
                Object.prototype.hasOwnProperty.call(
                    stats.byPriority, m.priority
                )) {
                stats.byPriority[m.priority]++;
            }
            if (typeof m.difficulty === 'string' &&
                Object.prototype.hasOwnProperty.call(
                    stats.byDifficulty, m.difficulty
                )) {
                stats.byDifficulty[m.difficulty]++;
            }
        }

        return stats;
    }

    // ============================================================
    // UNIQUE TAGS
    // ============================================================

    /**
     * Get every distinct tag across missions matching the filter.
     * Tags are compared case-insensitively and returned in
     * lowercase, sorted alphabetically.
     */
    function getUniqueTags(options) {
        var filter = null;
        if (isPlainObject(options) && isNonEmptyString(options.filter)) {
            filter = options.filter;
        }

        var missions = getMissions(filter, options);
        var seen = Object.create(null);

        for (var i = 0; i < missions.length; i++) {
            var m = missions[i];
            if (!Array.isArray(m.tags)) { continue; }
            for (var j = 0; j < m.tags.length; j++) {
                var tag = m.tags[j];
                if (typeof tag === 'string' && tag.trim() !== '') {
                    seen[tag.trim().toLowerCase()] = true;
                }
            }
        }

        var result = Object.keys(seen);
        result.sort();
        return result;
    }

    // ============================================================
    // RANKINGS — team deprecation
    // ============================================================
    //
    // A team deprecates when its last member dies or leaves. The
    // first year it has ZERO ACTIVE MEMBERS is its DEPRECATION
    // YEAR. See the file header for the full rule.
    //
    // The deprecation year is computed from the team record alone,
    // with no new field. Two independent signals can close a team:
    //
    //   - the window closes at endPeriod (under the half-open
    //     convention, the team is inactive from endPeriod + 1);
    //   - every stint closes at some leavePeriod (a stint is active
    //     THROUGH leavePeriod inclusive, so it is gone from
    //     leavePeriod + 1).
    //
    // The deprecation year is the EARLIER of the two candidate
    // signals, because the team is empty once EITHER condition
    // holds. An open-ended endPeriod or an open-ended stint
    // eliminates that signal from consideration.
    //
    // Both signals gone (no endPeriod, at least one open stint) is
    // a team marked deprecated with a live roster: a data
    // inconsistency. The function returns null in that case,
    // leaving the inherited rank in place — the least destructive
    // behaviour. The user resolves the state through the normal
    // edit flow.
    //
    // A team that is NOT deprecated returns null and behaves
    // exactly as before this revision.

    function computeDeprecationYear(team) {
        if (!isPlainObject(team)) { return null; }

        var status = MissionConstants.normalizeTeamStatus
            ? MissionConstants.normalizeTeamStatus(team.status)
            : null;
        if (status !== 'deprecated') { return null; }

        var candidates = [];

        // ---- Window close: endPeriod + 1 ----
        var endRaw = team.endPeriod;
        if (endRaw !== undefined && endRaw !== null &&
            String(endRaw).trim() !== '') {
            var endYear = parsePeriodLocal(endRaw);
            if (endYear !== null) {
                candidates.push(endYear + 1);
            }
        }

        // ---- All stints closed: max(leavePeriod) + 1 ----
        var anyOpenLeave = false;
        var latestLeave = null;

        if (Array.isArray(team.members)) {
            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];
                if (!isPlainObject(member)) { continue; }
                if (!Array.isArray(member.intervals)) { continue; }

                for (var i = 0; i < member.intervals.length; i++) {
                    var iv = member.intervals[i];
                    if (!isPlainObject(iv)) { continue; }

                    var leaveRaw = iv.leavePeriod;
                    if (leaveRaw === undefined ||
                        leaveRaw === null ||
                        String(leaveRaw).trim() === '') {
                        anyOpenLeave = true;
                        continue;
                    }

                    var n = parsePeriodLocal(leaveRaw);
                    if (n === null) { continue; }
                    if (latestLeave === null || n > latestLeave) {
                        latestLeave = n;
                    }
                }
            }
        }

        if (!anyOpenLeave && latestLeave !== null) {
            candidates.push(latestLeave + 1);
        }

        if (candidates.length === 0) { return null; }

        var earliest = candidates[0];
        for (var c = 1; c < candidates.length; c++) {
            if (candidates[c] < earliest) {
                earliest = candidates[c];
            }
        }
        return earliest;
    }

    /**
     * Local parse of a period value. Uses the same integer rules
     * as TeamConstants.parsePeriod, but is not lazy-bound to that
     * module here — the query layer's public surface for period
     * parsing is TeamConstants, and this is called only from
     * computeDeprecationYear, which is itself a local helper.
     *
     * Matches TeamConstants.parsePeriod's behaviour:
     *   - positive integer (number or pure-digit string) -> number
     *   - blank, malformed, zero, negative -> null
     */
    function parsePeriodLocal(value) {
        if (value === undefined || value === null) { return null; }
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) { return null; }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var parsed = Number(trimmed);
            if (!Number.isSafeInteger(parsed) || parsed < 1) {
                return null;
            }
            return parsed;
        }
        return null;
    }

    /**
     * Is this team deprecated AND empty at the given year?
     *
     * Returns true when:
     *   - the team is deprecated, AND
     *   - the team has zero active members at `periodNum`.
     *
     * "Active member" is answered by getActiveTeamMemberCount,
     * which already applies the team-window check and the
     * interval bounds. A team marked deprecated with a live roster
     * returns false (its state is inconsistent; leaving it alone
     * is the least destructive behaviour).
     */
    function isTeamDeprecatedAndEmptyAtPeriod(team, periodNum) {
        if (!isPlainObject(team)) { return false; }
        var status = MissionConstants.normalizeTeamStatus
            ? MissionConstants.normalizeTeamStatus(team.status)
            : null;
        if (status !== 'deprecated') { return false; }
        return getActiveTeamMemberCount(team, periodNum) === 0;
    }

    // ============================================================
    // RANKINGS — effective rank resolver
    // ============================================================
    //
    // RANKING MODEL:
    //   A team carries a `rankingHistory` array of EXPLICIT
    //   entries — the values the user actually wrote:
    //
    //     { period: '1905', rank: 3 }
    //
    //   The array describes the years on which the user acted,
    //   not every year.
    //
    // READ-TIME INHERITANCE:
    //   The rank in effect for a team at year Y is the rank of
    //   the most recent explicit entry at or before Y. If no
    //   entry is at or before Y, the rank is null.
    //
    //   A team ranked #3 at 1904 and #5 at 1907 reads:
    //
    //     1903  null      (no entry at or before 1903)
    //     1904  #3        (explicit)
    //     1905  #3        (inherited from 1904)
    //     1906  #3        (inherited from 1904)
    //     1907  #5        (explicit)
    //     1908  #5        (inherited from 1907)
    //
    //   Writing a new entry at 1905 (#4, say) shadows 1904 for
    //   1905–1906 without touching 1907:
    //
    //     1904  #3        (explicit)
    //     1905  #4        (explicit, written)
    //     1906  #4        (inherited from 1905)
    //     1907  #5        (explicit)
    //
    //   That is "change it in time and keep the previous records."
    //   The 1904 entry survives untouched; it just stops governing
    //   1905.
    //
    // DEPRECATION OVERRIDE:
    //   A team that is deprecated at Y has no effective rank at Y,
    //   regardless of what its rankingHistory holds. The
    //   deprecation year (see computeDeprecationYear) is the first
    //   year with zero active members; from that year onward the
    //   team's rank is inert. Stored entries at years BEFORE the
    //   deprecation year still govern those years, which is what
    //   "keep previous records" means.
    //
    //   The read is a shadow, not a deletion: getEffectiveRanking
    //   never mutates the team. removeRankingAt prunes the stale
    //   tail in its own transaction so the stored shape and the
    //   displayed shape cannot drift after a manual removal.

    /**
     * Get the effective ranking at a year, with the provenance
     * of the value.
     *
     * @param {object} team
     * @param {string|number} period
     * @returns {object} {
     *   rank: number|null,
     *   explicit: boolean,
     *   sourcePeriod: string|null
     * }
     */
    function getEffectiveRanking(team, period) {
        var result = {
            rank: null,
            explicit: false,
            sourcePeriod: null
        };

        if (!team || !Array.isArray(team.rankingHistory)) {
            return result;
        }

        var periodNum = parsePeriodLocal(period);
        if (periodNum === null) {
            return result;
        }

        // ---- Deprecation override ----
        //
        // A team deprecated at or before `periodNum` has no
        // effective rank. See the block comment above.
        var deprecationYear = computeDeprecationYear(team);
        if (deprecationYear !== null && periodNum >= deprecationYear) {
            return result;
        }

        var bestYear = -Infinity;
        var bestRank = null;

        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (!isPlainObject(entry)) { continue; }

            var entryPeriod = parsePeriodLocal(entry.period);
            if (entryPeriod === null) { continue; }
            if (entryPeriod > periodNum) { continue; }

            var rank = parsePeriodLocal(entry.rank);
            if (rank === null) { continue; }

            if (entryPeriod > bestYear) {
                bestYear = entryPeriod;
                bestRank = rank;
            }
        }

        if (bestRank === null) {
            return result;
        }

        result.rank = bestRank;
        result.sourcePeriod = String(bestYear);
        result.explicit = (bestYear === periodNum);

        return result;
    }

    /**
     * Get the rank in effect for a team at a given year.
     *
     * Read-time inheritance: returns the most recent entry at
     * or before `year`. Returns null when the team has no entry
     * at or before the year, or when the team is deprecated at or
     * before the year.
     *
     * @param {object} team
     * @param {string|number} period
     * @returns {number|null}
     */
    function getRankAtPeriod(team, period) {
        var effective = getEffectiveRanking(team, period);
        return effective.rank;
    }

    /**
     * Does the team have an explicit entry at exactly this year
     * that is EFFECTIVE?
     *
     * A stored entry at or after the deprecation year is inert
     * (see the deprecation override above), so this returns false
     * for such entries even though they exist in the array.
     *
     * @param {object} team
     * @param {string|number} period
     * @returns {boolean}
     */
    function hasExplicitRankingAt(team, period) {
        return getEffectiveRanking(team, period).explicit === true;
    }

    /**
     * Get the team's explicit ranking entries, each tagged with
     * the range of years it governs.
     *
     * The range of an entry is [entry.period, nextEntry.period).
     * The last entry's range extends to Infinity. This is the
     * same half-open rule the periods model uses.
     *
     * The returned ranges do NOT account for the deprecation
     * override: they describe the STORED record, not the
     * displayed effective rank. Callers that need the effective
     * rank for a given year use getEffectiveRanking.
     *
     * @param {object} team
     * @returns {array} [ { period, rank, governsFrom, governsTo } ]
     */
    function getRankingHistoryWithRanges(team) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }

        var cleaned = [];
        var seenYears = Object.create(null);

        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (!isPlainObject(entry)) { continue; }

            var year = parsePeriodLocal(entry.period);
            if (year === null) { continue; }

            var rank = parsePeriodLocal(entry.rank);
            if (rank === null) { continue; }

            if (seenYears[year]) { continue; }
            seenYears[year] = true;

            cleaned.push({
                period: String(year),
                rank: rank,
                yearNum: year
            });
        }

        cleaned.sort(function(a, b) {
            return a.yearNum - b.yearNum;
        });

        var result = [];
        for (var j = 0; j < cleaned.length; j++) {
            var current = cleaned[j];
            var next = cleaned[j + 1];

            result.push({
                period: current.period,
                rank: current.rank,
                governsFrom: current.yearNum,
                governsTo: next ? next.yearNum : null
            });
        }

        return result;
    }

    /**
     * Get the team's explicit ranking entries, sorted ascending
     * by year. Returns [{ period, rank }, ...].
     */
    function getSortedRankings(team) {
        if (!team || !Array.isArray(team.rankingHistory)) {
            return [];
        }

        var history = [];
        for (var i = 0; i < team.rankingHistory.length; i++) {
            var entry = team.rankingHistory[i];
            if (!isPlainObject(entry)) { continue; }

            var periodNum = parsePeriodLocal(entry.period);
            if (periodNum === null) { continue; }

            var rank = parsePeriodLocal(entry.rank);
            if (rank === null) { continue; }

            history.push({
                period: String(periodNum),
                rank: rank
            });
        }

        history.sort(function(a, b) {
            return Number(a.period) - Number(b.period);
        });

        return history;
    }

    /**
     * Get the most recent explicit entry, or null.
     */
    function getMostRecentRanking(team) {
        var history = getSortedRankings(team);
        return history.length > 0
            ? history[history.length - 1]
            : null;
    }

    /**
     * The most recent explicit rank, as a display string, or ''
     * when the team has no ranking history.
     */
    function getCurrentRank(team) {
        var most = getMostRecentRanking(team);
        return most ? String(most.rank) : '';
    }

    function hasRankings(team) {
        if (!team) { return false; }
        return getSortedRankings(team).length > 0;
    }

    /**
     * A summary of the team's ranking state.
     */
    function getRankingSummary(team) {
        if (!team) {
            return {
                total: 0,
                current: '',
                mostRecent: null,
                history: []
            };
        }

        var history = getSortedRankings(team);
        var total = history.length;
        var current = total > 0
            ? String(history[total - 1].rank)
            : '';
        var mostRecent = total > 0
            ? history[total - 1]
            : null;

        return {
            total: total,
            current: current,
            mostRecent: mostRecent,
            history: history
        };
    }

    // ============================================================
    // RANKINGS — explicit entries at a year
    // ============================================================

    function collectExplicitEntriesAtYearInternal(targetYear) {
        var targetStr = String(parsePeriodLocal(targetYear));
        var teams = getTeamStore();
        var entries = [];

        if (!Array.isArray(teams)) { return entries; }

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!isPlainObject(team)) { continue; }
            if (!Array.isArray(team.rankingHistory)) { continue; }

            for (var j = 0; j < team.rankingHistory.length; j++) {
                var entry = team.rankingHistory[j];
                if (!isPlainObject(entry)) { continue; }

                var entryYear = parsePeriodLocal(entry.period);
                if (entryYear === null) { continue; }
                if (String(entryYear) !== targetStr) { continue; }

                var rank = parsePeriodLocal(entry.rank);
                if (rank === null) { continue; }

                entries.push({
                    teamId: String(team.id),
                    team: team,
                    rank: rank
                });
            }
        }

        entries.sort(function(a, b) {
            return a.rank - b.rank;
        });

        return entries;
    }

    /**
     * The raw ordered list of explicit entries at a year.
     *
     * @param {string|number} year
     * @returns {array} [{ teamId, team, rank }]
     */
    function getExplicitRankingOrderForYear(year) {
        var yearNum = parsePeriodLocal(year);
        if (yearNum === null) { return []; }
        return collectExplicitEntriesAtYearInternal(yearNum);
    }

    // ============================================================
    // RANKINGS — display-facing ordered list (this revision)
    // ============================================================
    //
    // The Rankings tab does not render per-team effective ranks in
    // arbitrary order. It renders a POSITION-ORDERED list per
    // year: position 1, position 2, ..., position N, one team per
    // position, no gaps, no duplicates.
    //
    // Three reads:
    //
    //   getExplicitRankingOrderForYear(year)
    //     Raw ordered list of explicit entries at the year.
    //     Used only by callers that need the stored shape.
    //
    //   getRankedTeamsForYear(year, options)
    //     Display-facing list the Rankings tab consumes. It looks
    //     at the effective rank for every team, filters out anyone
    //     with no rank (including deprecated teams at or after
    //     their deprecation year), sorts by rank, then COMPACTS
    //     the surviving positions to dense 1..N.
    //
    //   getUnrankedTeamsForYear(year, options)
    //     Teams active at the year that have NO explicit entry at
    //     the year and NO inherited effective rank. Deprecated
    //     teams are excluded outright: they cannot be re-ranked.
    //
    // COMPACTION (this revision):
    //   After the deprecated-and-empty teams are dropped from the
    //   effective-rank set, the survivors may have been stored at
    //   non-contiguous ranks (e.g. 1, 2, 4, 5 if a team at 3 was
    //   inherited by the deprecated team). The read compacts them
    //   to 1, 2, 3, 4: the hole left by the deprecated team is
    //   filled, no gaps remain. This is the "no gaps in the
    //   lineup" rule.
    //
    //   The `explicit` and `sourcePeriod` fields on each row still
    //   describe where the value came from; only `position` and
    //   `rank` are compacted, and those two are always equal by
    //   contract.
    //
    // SHOWINACTIVE:
    //   options.showInactive gates whether rows whose team is not
    //   active in that year are returned. Deprecated teams are
    //   excluded regardless of showInactive: they are gone, not
    //   merely inactive. Non-deprecated inactive teams obey the
    //   flag as before.

    /**
     * Display-facing ordered list for the Rankings tab.
     *
     * @param {string|number} year
     * @param {object} [options] - { showInactive: boolean }
     * @returns {array}
     */
    function getRankedTeamsForYear(year, options) {
        options = options || {};
        var showInactive = options.showInactive === true;

        var yearNum = parsePeriodLocal(year);
        if (yearNum === null) { return []; }

        var teams = getTeamStore();
        var effectiveRanks = [];
        var seenRanks = Object.create(null);

        if (!Array.isArray(teams)) { return []; }

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }

            // getEffectiveRanking looks at the explicit entry at
            // this year, or inherits from the most recent explicit
            // entry before it, and returns null when the team is
            // deprecated at or before this year.
            var effective = getEffectiveRanking(team, yearNum);
            if (effective.rank === null) { continue; }

            var activeAtYear = isTeamActiveAtPeriod(team, yearNum);
            if (!showInactive && !activeAtYear) { continue; }

            // Ensure uniqueness (if two teams tie, take the more
            // recent source).
            var rankKey = String(effective.rank);
            if (seenRanks[rankKey]) {
                var existing = seenRanks[rankKey];
                if (effective.sourcePeriod >
                    existing.effective.sourcePeriod) {
                    existing.team = team;
                    existing.effective = effective;
                    existing.activeAtYear = activeAtYear;
                }
            } else {
                seenRanks[rankKey] = {
                    team: team,
                    effective: effective,
                    activeAtYear: activeAtYear
                };
            }
        }

        var result = [];
        var rankKeys = Object.keys(seenRanks);
        for (var k = 0; k < rankKeys.length; k++) {
            var item = seenRanks[rankKeys[k]];
            var t = item.team;
            var e = item.effective;

            var memberCount = 0;
            try {
                memberCount = getActiveTeamMemberCount(t, yearNum);
            } catch (err) {
                memberCount = 0;
            }

            result.push({
                position: e.rank,        // provisional; compacted below
                teamId: String(t.id),
                name: getCurrentTeamName(t),
                rank: e.rank,            // provisional; compacted below
                explicit: e.explicit,
                sourcePeriod: e.sourcePeriod,
                periodDisplay: buildTeamPeriodDisplay(t),
                memberCount: memberCount,
                status: t.status || 'active',
                activeAtYear: item.activeAtYear
            });
        }

        result.sort(function(a, b) {
            return a.position - b.position;
        });

        // ---- Compaction ----
        //
        // After the deprecated-and-empty teams have been filtered
        // out by the effective-rank resolver, the survivors'
        // stored ranks may be non-contiguous (e.g. 1, 2, 4, 5).
        // Renumber them densely to 1..N so there are no gaps in
        // the lineup. This is the "#4 rises to #3 when #3
        // deprecates" rule.
        //
        // The `explicit` and `sourcePeriod` fields are NOT
        // compacted: they describe the stored value's provenance,
        // which callers may want to surface. Only the displayed
        // position and rank are compacted.
        for (var p = 0; p < result.length; p++) {
            result[p].position = p + 1;
            result[p].rank = p + 1;
        }

        return result;
    }

    /**
     * Teams active at `year` that have no explicit entry at the
     * year and no inherited effective rank from an earlier year.
     *
     * These are the candidates a "fill a slot" picker offers, and
     * what a drag-to-empty-position drop would target. A team
     * with an inherited rank is excluded: including them would
     * double-rank them.
     *
     * DEPRECATED TEAMS ARE EXCLUDED OUTRIGHT. A team that has
     * been deprecated cannot be re-ranked, regardless of whether
     * its member count is currently zero. Offering it in the
     * picker would let the user re-rank a team that no longer
     * exists.
     *
     * Only professional teams are considered. Academic and
     * civilian teams never carry a mission-style ranking.
     *
     * SHOWINACTIVE:
     *   The options object is accepted for signature symmetry
     *   with getRankedTeamsForYear, but showInactive has NO
     *   effect here. This list is always active-only. See the
     *   section header comment.
     *
     * @param {string|number} year
     * @param {object} [options] - accepted for symmetry; unused.
     * @returns {array} [{ teamId, name, status, activeAtYear }]
     */
    function getUnrankedTeamsForYear(year, options) {
        // options is intentionally unused. The signature accepts
        // it so the aggregator can pass the same options object
        // to both reads without a special case.
        void options;

        var yearNum = parsePeriodLocal(year);
        if (yearNum === null) { return []; }

        // Which teams already have an explicit entry at the year?
        var explicitSet = Object.create(null);
        var raw = collectExplicitEntriesAtYearInternal(yearNum);
        for (var r = 0; r < raw.length; r++) {
            explicitSet[raw[r].teamId] = true;
        }

        var teams = getTeamStore();
        var result = [];

        if (!Array.isArray(teams)) { return []; }

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!isPlainObject(team)) { continue; }
            if (!team.id) { continue; }
            if (!isProfessionalType(team.type)) { continue; }

            // Deprecated teams cannot be re-ranked.
            var statusNorm = MissionConstants.normalizeTeamStatus
                ? MissionConstants.normalizeTeamStatus(team.status)
                : null;
            if (statusNorm === 'deprecated') { continue; }

            var teamId = String(team.id);
            if (explicitSet[teamId]) { continue; }

            // A team that has an inherited rank at the year is
            // already in the display list implicitly; the user
            // should not be offered it for double-ranking.
            var effective = getEffectiveRanking(team, yearNum);
            if (effective.rank !== null) { continue; }

            // Only include teams that were actually active at the
            // year. A disbanded team cannot take a new position.
            var activeAtYear = false;
            try {
                activeAtYear = isTeamActiveAtPeriod(team, yearNum);
            } catch (e) {
                activeAtYear = false;
            }
            if (!activeAtYear) { continue; }

            result.push({
                teamId: teamId,
                name: getCurrentTeamName(team),
                status: team.status || 'active',
                activeAtYear: true
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // PERIOD DISPLAY (internal helper for the rankings reads)
    // ============================================================
    //
    // Mirrors TeamAggregator.getTeamPeriodDisplay. It lives here
    // because getRankedTeamsForYear needs a period display and it
    // would be wrong for the query layer to depend on the
    // aggregator. The aggregator still owns its own copy; the two
    // are kept in sync by convention. If they ever diverge, this
    // one wins for the rankings tab (it is the one the rankings
    // VM reads from).

    function buildTeamPeriodDisplay(team) {
        if (!team || typeof team !== 'object') { return '-'; }

        var normalizedType = MissionConstants.normalizeTeamStatus
            ? null
            : null;
        // The type normalisation is on TeamConstants, not
        // MissionConstants; this module does not import
        // TeamConstants directly. Read the raw type and rely on
        // the caller having canonicalised it, or on the shape
        // itself being self-describing.
        var t = team.type;
        var isAcademic = (typeof t === 'string' &&
                          t.trim().toLowerCase() === 'academic');

        var start = team.startPeriod || '';
        var end = team.endPeriod || '';

        if (isAcademic) {
            if (start && end) {
                return 'Wk ' + start + ' - Wk ' + end;
            }
            if (start) { return 'From Wk ' + start; }
            if (end) { return 'Until Wk ' + end; }
            return '-';
        }

        if (start && end) { return start + ' - ' + end; }
        if (start) { return 'From ' + start; }
        if (end) { return 'Until ' + end; }
        return '-';
    }

    // ============================================================
    // TEAM STORE ACCESS (internal, for ranking reads)
    // ============================================================

    function getTeamStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!Array.isArray(window.data.teams)) {
            return null;
        }
        return window.data.teams;
    }

    // ============================================================
    // PERIOD PREDICATES (used by the ranking reads above)
    // ============================================================
    //
    // These mirror the corresponding predicates in the team
    // module. The mission module does not import TeamQueries
    // directly (that would couple the mission read layer to the
    // team read layer), but the ranking reads need to know whether
    // a team is active at a year. The duplication is intentional
    // and small; the two implementations are kept in sync by
    // convention, exactly like buildTeamPeriodDisplay.

    function isTeamActiveAtPeriod(team, period) {
        if (!team || typeof team !== 'object') { return false; }

        var periodNum = parsePeriodLocal(period);
        if (periodNum === null) { return false; }

        return teamWindowContainsNum(team, periodNum);
    }

    function teamWindowContainsNum(team, periodNum) {
        if (!team || typeof team !== 'object') { return false; }

        var hasStart = team.startPeriod !== undefined &&
                       team.startPeriod !== null &&
                       team.startPeriod !== '';
        var hasEnd = team.endPeriod !== undefined &&
                     team.endPeriod !== null &&
                     team.endPeriod !== '';

        if (hasStart) {
            var start = parsePeriodLocal(team.startPeriod);
            if (start === null) { return false; }
            if (start > periodNum) { return false; }
        }

        if (hasEnd) {
            var end = parsePeriodLocal(team.endPeriod);
            if (end === null) { return false; }
            if (end < periodNum) { return false; }
        }

        return true;
    }

    function getActiveTeamMemberCount(team, period) {
        if (!team || !Array.isArray(team.members)) { return 0; }

        var periodNum = parsePeriodLocal(period);
        if (periodNum === null) { return 0; }

        if (!teamWindowContainsNum(team, periodNum)) { return 0; }

        var count = 0;
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || !Array.isArray(member.intervals)) { continue; }
            for (var j = 0; j < member.intervals.length; j++) {
                if (intervalContainsNumLocal(member.intervals[j], periodNum)) {
                    count++;
                    break;
                }
            }
        }
        return count;
    }

    function intervalContainsNumLocal(interval, periodNum) {
        if (!interval || typeof interval !== 'object') { return false; }

        var hasJoin = interval.joinPeriod !== undefined &&
                      interval.joinPeriod !== null &&
                      interval.joinPeriod !== '';
        var hasLeave = interval.leavePeriod !== undefined &&
                       interval.leavePeriod !== null &&
                       interval.leavePeriod !== '';

        if (hasJoin) {
            var join = parsePeriodLocal(interval.joinPeriod);
            if (join === null) { return false; }
            if (join > periodNum) { return false; }
        }

        if (hasLeave) {
            var leave = parsePeriodLocal(interval.leavePeriod);
            if (leave === null) { return false; }
            if (leave < periodNum) { return false; }
        }

        return true;
    }

    function isProfessionalType(type) {
        if (typeof type !== 'string') { return false; }
        var normalized = type.trim().toLowerCase();
        if (normalized === 'professional') { return true; }
        // Legacy aliases, matching TeamConstants.normalizeTeamType.
        if (normalized === 'internship') { return true; }
        if (normalized === 'temporary') { return true; }
        return false;
    }

    function getCurrentTeamName(team) {
        if (!team || typeof team !== 'object') {
            return 'Unknown Team';
        }
        var periods = Array.isArray(team.periods) ? team.periods : null;
        if (periods && periods.length > 0) {
            var last = periods[periods.length - 1];
            if (last && isNonEmptyString(last.name)) {
                return String(last.name);
            }
        }
        if (isNonEmptyString(team.name)) {
            return String(team.name);
        }
        return 'Unknown Team';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionQueries = Object.freeze({
        // Single-mission read
        getMission: getMission,

        // Collection reads
        getMissions: getMissions,
        getActiveMissions: getActiveMissions,
        getCompletedMissions: getCompletedMissions,
        getCancelledMissions: getCancelledMissions,
        getArchivedMissions: getArchivedMissions,

        // Relationship reads
        getMissionsByTeam: getMissionsByTeam,
        getMissionsBySupportPersonnel: getMissionsBySupportPersonnel,
        getMissionsByParticipant: getMissionsByParticipant,
        getParticipatingMissionsForCharacter:
            getParticipatingMissionsForCharacter,
        getMissionsForCharacter: getMissionsForCharacter,

        // Type and tag reads
        getMissionsByType: getMissionsByType,
        getMissionsByTag: getMissionsByTag,

        // Search
        searchMissions: searchMissions,

        // Statistics
        getStatistics: getStatistics,

        // Tags
        getUniqueTags: getUniqueTags,

        // Archive-state helper
        isArchived: isArchived,

        // Team-assignment helpers
        getTeamIdsForMission: getTeamIdsForMission,
        isMissionAssignedToTeam: isMissionAssignedToTeam,

        // Participant helpers
        getParticipantsForMission: getParticipantsForMission,
        isParticipantInMission: isParticipantInMission,
        getParticipantTeamIdsForCharacter:
            getParticipantTeamIdsForCharacter,

        // ---- Rankings — ordered-list model ----
        getExplicitRankingOrderForYear:
            getExplicitRankingOrderForYear,
        getRankedTeamsForYear: getRankedTeamsForYear,
        getUnrankedTeamsForYear: getUnrankedTeamsForYear,

        // ---- Rankings — inheritance model ----
        getSortedRankings: getSortedRankings,
        getMostRecentRanking: getMostRecentRanking,
        getCurrentRank: getCurrentRank,
        getRankAtPeriod: getRankAtPeriod,
        hasRankings: hasRankings,
        getRankingSummary: getRankingSummary,

        // Read-time inheritance
        getEffectiveRanking: getEffectiveRanking,
        hasExplicitRankingAt: hasExplicitRankingAt,
        getRankingHistoryWithRanges: getRankingHistoryWithRanges
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionQueries;
        var missing = [];

        var required = [
            'getMission', 'getMissions', 'getActiveMissions',
            'getCompletedMissions', 'getCancelledMissions',
            'getArchivedMissions', 'getMissionsByTeam',
            'getMissionsBySupportPersonnel', 'getMissionsByParticipant',
            'getParticipatingMissionsForCharacter',
            'getMissionsForCharacter', 'getMissionsByType',
            'getMissionsByTag', 'searchMissions', 'getStatistics',
            'getUniqueTags', 'isArchived', 'getTeamIdsForMission',
            'isMissionAssignedToTeam', 'getParticipantsForMission',
            'isParticipantInMission',
            'getParticipantTeamIdsForCharacter',
            'getExplicitRankingOrderForYear', 'getRankedTeamsForYear',
            'getUnrankedTeamsForYear', 'getSortedRankings',
            'getMostRecentRanking', 'getCurrentRank',
            'getRankAtPeriod', 'hasRankings', 'getRankingSummary',
            'getEffectiveRanking', 'hasExplicitRankingAt',
            'getRankingHistoryWithRanges'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke test: participant helpers against an in-memory
        // mission object. Uses no store, so it runs at load.
        try {
            var sample = {
                id: 'm1',
                participants: [
                    { characterId: 'c1', teamId: 't1',  source: 'team' },
                    { characterId: 'c1', teamId: 't2',  source: 'team' },
                    { characterId: 'c1', teamId: null,  source: 'rookie' },
                    { characterId: 'c2', teamId: 't1',  source: 'team' },
                    // Malformed: source/teamId mismatch, should be
                    // dropped by getParticipantsForMission.
                    { characterId: 'c3', teamId: 't1',  source: 'rookie' },
                    // Malformed: missing characterId, dropped.
                    { characterId: '',   teamId: 't1',  source: 'team' }
                ]
            };

            var parsed = getParticipantsForMission(sample);
            if (parsed.length !== 4) {
                missing.push(
                    'getParticipantsForMission: expected 4 valid ' +
                    'entries, got ' + parsed.length
                );
            }

            if (isParticipantInMission(sample, 'c1', 't1') !== true) {
                missing.push(
                    'isParticipantInMission: c1/t1 should be true'
                );
            }
            if (isParticipantInMission(sample, 'c1', 't2') !== true) {
                missing.push(
                    'isParticipantInMission: c1/t2 should be true'
                );
            }
            if (isParticipantInMission(sample, 'c1', null) !== true) {
                missing.push(
                    'isParticipantInMission: c1/rookie should be true'
                );
            }
            if (isParticipantInMission(sample, 'c1', 't3') !== false) {
                missing.push(
                    'isParticipantInMission: c1/t3 should be false'
                );
            }
            if (isParticipantInMission(sample, 'c2', null) !== false) {
                missing.push(
                    'isParticipantInMission: c2/rookie should be false'
                );
            }

            var teams = getParticipantTeamIdsForCharacter(sample, 'c1');
            if (teams.length !== 2 ||
                teams.indexOf('t1') === -1 ||
                teams.indexOf('t2') === -1) {
                missing.push(
                    'getParticipantTeamIdsForCharacter: expected ' +
                    '[t1, t2], got ' + JSON.stringify(teams)
                );
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        // Smoke test: deprecation-year computation.
        try {
            // Team with endPeriod 1920 and all stints closed at 1918.
            // min(1920 + 1, max(1918) + 1) = min(1921, 1919) = 1919.
            var t1 = {
                status: 'deprecated',
                startPeriod: '1900',
                endPeriod: '1920',
                members: [
                    { intervals: [{ joinPeriod: '1900', leavePeriod: '1918' }] }
                ]
            };
            if (computeDeprecationYear(t1) !== 1919) {
                missing.push(
                    'computeDeprecationYear: closed stints should win, ' +
                    'expected 1919, got ' +
                    computeDeprecationYear(t1)
                );
            }

            // Same team but stints open: endPeriod + 1 = 1921.
            var t2 = {
                status: 'deprecated',
                startPeriod: '1900',
                endPeriod: '1920',
                members: [
                    { intervals: [{ joinPeriod: '1900', leavePeriod: '' }] }
                ]
            };
            if (computeDeprecationYear(t2) !== 1921) {
                missing.push(
                    'computeDeprecationYear: open stints + endPeriod ' +
                    'should use endPeriod + 1, expected 1921, got ' +
                    computeDeprecationYear(t2)
                );
            }

            // No endPeriod, all stints closed: max(leave) + 1.
            var t3 = {
                status: 'deprecated',
                startPeriod: '1900',
                endPeriod: '',
                members: [
                    { intervals: [{ joinPeriod: '1900', leavePeriod: '1905' }] },
                    { intervals: [{ joinPeriod: '1906', leavePeriod: '1918' }] }
                ]
            };
            if (computeDeprecationYear(t3) !== 1919) {
                missing.push(
                    'computeDeprecationYear: closed stints only, ' +
                    'expected 1919, got ' +
                    computeDeprecationYear(t3)
                );
            }

            // No endPeriod, one open stint: no inferable year.
            var t4 = {
                status: 'deprecated',
                startPeriod: '1900',
                endPeriod: '',
                members: [
                    { intervals: [{ joinPeriod: '1900', leavePeriod: '' }] }
                ]
            };
            if (computeDeprecationYear(t4) !== null) {
                missing.push(
                    'computeDeprecationYear: open-ended team should ' +
                    'return null, got ' +
                    computeDeprecationYear(t4)
                );
            }

            // Non-deprecated team: null.
            var t5 = {
                status: 'active',
                startPeriod: '1900',
                endPeriod: '1920',
                members: [
                    { intervals: [{ joinPeriod: '1900', leavePeriod: '1918' }] }
                ]
            };
            if (computeDeprecationYear(t5) !== null) {
                missing.push(
                    'computeDeprecationYear: non-deprecated team ' +
                    'should return null'
                );
            }
        } catch (e) {
            missing.push(
                'deprecation-year smoke test threw: ' + e.message
            );
        }

        // Smoke test: effective rank + deprecation override.
        try {
            var rankedTeam = {
                id: 'tr',
                status: 'deprecated',
                startPeriod: '1900',
                endPeriod: '',
                rankingHistory: [
                    { period: '1900', rank: 1 },
                    { period: '1910', rank: 2 }
                ],
                members: [
                    { intervals: [{ joinPeriod: '1900', leavePeriod: '1918' }] }
                ]
            };

            // 1915: not yet deprecated (deprecation is 1919). Rank 2.
            if (getEffectiveRanking(rankedTeam, 1915).rank !== 2) {
                missing.push(
                    'getEffectiveRanking: year before deprecation ' +
                    'should inherit rank 2'
                );
            }

            // 1920: at/after deprecation. Null.
            if (getEffectiveRanking(rankedTeam, 1920).rank !== null) {
                missing.push(
                    'getEffectiveRanking: year after deprecation ' +
                    'should return null'
                );
            }

            // 1918: last active year. Rank 2.
            if (getEffectiveRanking(rankedTeam, 1918).rank !== 2) {
                missing.push(
                    'getEffectiveRanking: final active year ' +
                    'should still inherit rank 2'
                );
            }
        } catch (e) {
            missing.push(
                'effective-rank smoke test threw: ' + e.message
            );
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionQueries] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
