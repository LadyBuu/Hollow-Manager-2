/**
 * shared/queries/mission-queries.js - Mission Queries
 *
 * Path: js/shared/queries/mission-queries.js
 *
 * Read-only access to mission data.
 *
 * WHAT THIS MODULE OWNS:
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
 *   - Cross-domain reads. This module does NOT query teams,
 *     characters, or any other domain. Callers that need mission
 *     data enriched with team or character information use
 *     MissionAggregator.
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
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.IdUtils
 *   - window.MissionConstants
 *   - window.MissionId            (MissionId.derive)
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
            if (normaliseId(m.assignedTeamId) === target) {
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
        isArchived: isArchived
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionQueries;
        var missing = [];

        var required = [
            'getMission',
            'getMissions',
            'getActiveMissions',
            'getCompletedMissions',
            'getCancelledMissions',
            'getArchivedMissions',
            'getMissionsByTeam',
            'getMissionsBySupportPersonnel',
            'getMissionsByType',
            'getMissionsByTag',
            'searchMissions',
            'getStatistics',
            'getUniqueTags',
            'isArchived'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionQueries] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();