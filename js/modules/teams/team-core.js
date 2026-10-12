/**
 * modules/teams/team-core.js - Team Core
 * Canonical mutation API for teams.
 *
 * Path: js/modules/teams/team-core.js
 *
 * WHAT THIS OWNS:
 *   - Team CRUD (create, update, delete).
 *   - Member mutations: add interval, end interval, reopen interval,
 *     purge interval, remove member.
 *   - Batch member mutation (batchAddMembers).
 *   - Ranking mutations (add, remove).
 *   - Configuration (characterProvider injection).
 *   - The PERIODS model: validation, canonicalisation, and the
 *     legacy migration from nameHistory + scalars.
 *   - Cross-domain cascades:
 *       stripCharacterRefs      (character deletion)
 *       endStintsForCharacter   (character death, career transition)
 *       deleteTeam's mutate     (fires TournamentCore.stripTeamRefs
 *                                and MissionCascade.stripTeamRefs)
 *
 * WHAT THIS DOES NOT OWN:
 *   - Public read APIs. Team reads go through TeamQueries.
 *   - Rendering, notifications, DOM.
 *   - saveData. The pipeline owns persistence.
 *   - The naming rule. TeamNaming owns the suffix grammar. This
 *     module accepts whatever periods TeamNaming writes; it does
 *     not compute the suffix.
 *   - The specialisation vocabulary. MissionConstants owns the
 *     mission type taxonomy. This module validates that a
 *     specialisation id is a known mission type via
 *     MissionConstants.isValidMissionType.
 *   - The mission cleanup details. MissionCascade.stripTeamRefs
 *     owns the reference model for team → mission.
 *
 * ============================================================
 * THE PERIODS MODEL
 * ============================================================
 *
 * A team carries a `periods` array. Each entry is a self-contained
 * description of what the team was during a range of years:
 *
 *   {
 *     startPeriod: '1900',        // required, positive integer
 *     endPeriod: '1905',          // '' means open-ended; only
 *                                 // allowed on the last entry
 *     name: 'Rapid',              // required, non-empty
 *     tacticalStyle: '',          // free text, may be empty
 *     specialisations: []         // array of mission-type ids
 *   }
 *
 * INVARIANTS (enforced here, trusted by readers):
 *
 *   - At least one entry.
 *   - Entries sorted by startPeriod ascending.
 *   - Each startPeriod is a valid positive integer.
 *   - Only the LAST entry may have endPeriod: ''.
 *   - Each non-last entry's endPeriod is a valid positive integer
 *     >= its startPeriod.
 *   - No two entries overlap when compared as closed ranges
 *     [start, end]. Gaps ARE allowed: a team can go dormant.
 *   - Names are non-empty strings.
 *   - tacticalStyle is a string.
 *   - specialisations is an array of unique known mission-type ids.
 *
 * THE LAST ENTRY IS "CURRENT":
 *   Every reader that wants the team's display name, tactical
 *   style, or specialisations without a period context reads the
 *   last entry. See TeamQueries.getCurrentPeriod and
 *   getCurrentTeamName.
 *
 * `team.name` IS A DENORMALISED CACHE:
 *   Written by this module on every save as periods[last].name.
 *   Every existing reader (TeamQueries.getTeamName's fallback,
 *   TeamAggregator, TeamExport, the mission form's team picker)
 *   keeps working unchanged. Nothing writes to team.name except
 *   this module.
 *
 * WHY PERIODS RATHER THAN PARALLEL HISTORIES:
 *   nameHistory, styleHistory, and specialisationHistory would be
 *   three arrays that have to stay aligned by convention. Any
 *   drift between them is a bug waiting to be discovered. One
 *   array of self-contained entries makes drift structurally
 *   impossible.
 *
 * LEGACY INPUT:
 *   The canonicaliser accepts a record that carries any of:
 *
 *     nameHistory       array of { name, startPeriod, endPeriod }
 *     style             string, an alias for tacticalStyle
 *     specialisations   array of mission-type ids
 *     tacticalStyle     string, the canonical name
 *
 *   and produces the periods shape. Migration rule:
 *
 *     - If nameHistory is present and non-empty: one period per
 *       name-history entry. The scalars (style / specialisations)
 *       are applied to every produced period, because we have no
 *       way to know which historical period carried which values.
 *       The current values are the safest guess.
 *     - Otherwise: one period built from the record's current
 *       scalars (name, style/tacticalStyle, specialisations) and
 *       its top-level startPeriod / endPeriod.
 *
 *   Legacy fields are then dropped from the canonical output,
 *   exactly like the assignedTeamId → assignedTeamIds migration.
 *
 * ============================================================
 * MUTATION CONTRACT
 * ============================================================
 *
 *   Every public mutation returns Promise<{ success, data?, message? }>.
 *   Validation runs twice: pre-flight against window.data, then
 *   snapshot-scoped inside pipeline.validate(). The candidate is
 *   re-derived inside mutate() so applied state never diverges from
 *   what was validated.
 *
 * MEMBER INTERVALS MODEL:
 *   member = {
 *     memberId, characterId, role,
 *     intervals: [ { joinPeriod, leavePeriod }, ... ]
 *   }
 *
 *   Both bounds are inclusive. Blank means unbounded on that side.
 *   Intervals within one member must not overlap.
 *   joinPeriod is IMMUTABLE once set: to move a stint start, purge
 *   and add a new interval.
 *
 * PERIOD SEMANTICS:
 *   Periods are positive integers. Blank ('', null, undefined) is
 *   the "unbounded" sentinel, distinct from a period. All writes go
 *   through canonicalisePeriod.
 *
 * DEATH / CAREER-TRANSITION CASCADE (endStintsForCharacter):
 *   For every open professional-team stint, set leavePeriod to the
 *   death/transition year. Idempotent. Never throws. Runs inside the
 *   caller's pipeline transaction.
 *
 *   Scope: professional teams only.
 *   Granularity: year. deathWeek is not read.
 *   Non-reversible: clearing deathYear does not restore ended stints.
 *
 * ADD-AFTER-DEATH GUARD:
 *   addMember and batchAddMembers reject assignments whose joinPeriod
 *   is strictly after the character's deathYear.
 *
 * TEAM NAMING HOOK:
 *   After any successful member add, this module fires
 *   TeamNaming.applyTeamName(teamId) for each team touched by the
 *   mutation. That call recomputes the team's display name from the
 *   distinct-member count and, when the suffix changes, closes the
 *   current period and opens a new one. See team-naming.js.
 *
 *   The hook is fire-and-forget: it does not block the caller's
 *   promise, and an error inside it does not fail the member
 *   mutation.
 *
 * DELETE CASCADE:
 *   deleteTeam removes the team from the snapshot and cleans up
 *   every cross-domain reference to it inside the same transaction:
 *
 *     TournamentCore.stripTeamRefs     — tournament participants
 *     MissionCascade.stripTeamRefs     — mission.assignedTeamIds
 *                                        and participant rows
 *
 *   Both cleanups run against the same snapshot that will be
 *   committed.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamConstants
 *   - window.IdUtils
 *   - window.MutationPipeline
 *   - window.ObjectUtils
 *   - characterProvider (injected via configure)
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.MissionConstants    (specialisation id validation)
 *   - window.MissionCascade      (deleteTeam mission cleanup)
 *   - window.TournamentCore      (deleteTeam cascade; mandatory at
 *                                 that call, throws if unavailable)
 *   - window.TeamNaming          (post-member-add rename; optional)
 */

(function() {
    'use strict';

    if (window.__teamCoreLoaded) {
        return;
    }
    window.__teamCoreLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamConstants = window.TeamConstants;
    var IdUtils = window.IdUtils;
    var MutationPipeline = window.MutationPipeline;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getMissionConstants() {
        return window.MissionConstants || null;
    }

    function getMissionCascade() {
        return window.MissionCascade || null;
    }

    // ============================================================
    // INJECTED DEPENDENCIES
    // ============================================================

    var _characterProvider = null;
    var _characterProviderConfigured = false;

    function configure(deps) {
        deps = deps || {};

        if (!deps.characterProvider) {
            return _characterProviderConfigured;
        }

        if (typeof deps.characterProvider.exists !== 'function') {
            console.warn(
                '[TeamCore] characterProvider must have an exists() ' +
                'method.'
            );
            return false;
        }

        if (_characterProviderConfigured) {
            return true;
        }

        _characterProvider = deps.characterProvider;
        _characterProviderConfigured = true;
        return true;
    }

    // ============================================================
    // DEPENDENCY CHECKS
    // ============================================================

    function checkBaseDependencies() {
        var missing = [];

        if (!TeamConstants) { missing.push('TeamConstants'); }
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }
        if (!MutationPipeline ||
            typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }
        if (!ObjectUtils ||
            typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        return missing;
    }

    function checkMemberDependencies() {
        var missing = checkBaseDependencies();
        if (!_characterProvider ||
            typeof _characterProvider.exists !== 'function') {
            missing.push(
                'characterProvider.exists ' +
                '(call TeamCore.configure() first)'
            );
        }
        return missing;
    }

    function failIfMissing(missing, operationName) {
        if (missing.length > 0) {
            console.warn(
                '[TeamCore] ' + operationName +
                ' missing dependencies:', missing.join(', ')
            );
            return true;
        }
        return false;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateTeamId() {
        return IdUtils.generateId('team');
    }

    function generateMemberId() {
        return IdUtils.generateId('team-member');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DESCRIPTIVE FIELD CANONICALISATION
    // ============================================================

    /**
     * Canonicalise a tactical style string.
     *
     *   missing / null / undefined  -> { valid: true, value: '' }
     *   string                      -> { valid: true, value: trimmed }
     *   anything else               -> { valid: false }
     */
    function canonicaliseTacticalStyle(raw) {
        if (raw === undefined || raw === null) {
            return { valid: true, value: '' };
        }
        if (typeof raw !== 'string') {
            return {
                valid: false,
                message: 'Tactical style must be a string.'
            };
        }
        return { valid: true, value: raw.trim() };
    }

    /**
     * Canonicalise a specialisations array.
     *
     *   missing / null / undefined  -> { valid: true, value: [] }
     *   array                       -> { valid: true, value: [...deduped] }
     *   anything else               -> { valid: false }
     *
     * Each entry must be a known mission type id. Duplicates are
     * dropped, order preserved. Blank entries are dropped without
     * error.
     *
     * When MissionConstants is not loaded, the isValidMissionType
     * check is skipped and every non-empty id passes.
     */
    function canonicaliseSpecialisations(raw) {
        if (raw === undefined || raw === null) {
            return { valid: true, value: [] };
        }
        if (!Array.isArray(raw)) {
            return {
                valid: false,
                message: 'Specialisations must be an array.'
            };
        }

        var MC = getMissionConstants();
        var canValidate = MC &&
            typeof MC.isValidMissionType === 'function';

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < raw.length; i++) {
            var entry = raw[i];
            if (entry === undefined || entry === null) { continue; }

            if (typeof entry !== 'string') {
                return {
                    valid: false,
                    message:
                        'Specialisation at index ' + i +
                        ' must be a string.'
                };
            }

            var id = entry.trim();
            if (id === '') { continue; }

            if (canValidate && !MC.isValidMissionType(id)) {
                return {
                    valid: false,
                    message:
                        'Unknown specialisation: "' + id + '".'
                };
            }

            if (seen[id] === true) { continue; }
            seen[id] = true;
            result.push(id);
        }

        return { valid: true, value: result };
    }

    // ============================================================
    // PERIODS CANONICALISATION
    // ============================================================
    //
    // The canonicaliser for the periods array. Also hosts the
    // legacy migration from nameHistory + scalars.

    /**
     * Read the tactical style off a raw input, accepting either
     * the canonical `tacticalStyle` or the legacy `style` alias.
     * `tacticalStyle` wins when both are present.
     */
    function readRawTacticalStyle(input) {
        if (!input || typeof input !== 'object') { return undefined; }
        if (input.tacticalStyle !== undefined) {
            return input.tacticalStyle;
        }
        return input.style;
    }

    /**
     * Canonicalise a single period entry.
     *
     * Returns { valid, value?, message? }. The caller aggregates
     * errors; this function does not append to a shared list.
     */
    function canonicalisePeriodEntry(raw, index, isLast) {
        if (!isObject(raw)) {
            return {
                valid: false,
                message: 'Period ' + (index + 1) +
                    ' must be an object.'
            };
        }

        // ---- startPeriod ----
        if (raw.startPeriod === undefined ||
            raw.startPeriod === null ||
            raw.startPeriod === '') {
            return {
                valid: false,
                message: 'Period ' + (index + 1) +
                    ' requires a start period.'
            };
        }
        var startCanon = canonicalisePeriod(raw.startPeriod);
        if (startCanon === null || startCanon === '') {
            return {
                valid: false,
                message: 'Period ' + (index + 1) +
                    ' has an invalid start period.'
            };
        }

        // ---- endPeriod ----
        var endCanon = '';
        if (raw.endPeriod !== undefined && raw.endPeriod !== null) {
            endCanon = canonicalisePeriod(raw.endPeriod);
            if (endCanon === null) {
                return {
                    valid: false,
                    message: 'Period ' + (index + 1) +
                        ' has an invalid end period.'
                };
            }
        }

        if (endCanon === '' && !isLast) {
            return {
                valid: false,
                message: 'Only the last period may be open-ended.'
            };
        }

        if (endCanon !== '' &&
            parseInt(endCanon, 10) < parseInt(startCanon, 10)) {
            return {
                valid: false,
                message: 'Period ' + (index + 1) +
                    ' ends before it starts.'
            };
        }

        // ---- name ----
        if (!isNonEmptyString(raw.name)) {
            return {
                valid: false,
                message: 'Period ' + (index + 1) +
                    ' requires a name.'
            };
        }
        var name = String(raw.name).trim();

        // ---- tacticalStyle ----
        var styleCheck = canonicaliseTacticalStyle(raw.tacticalStyle);
        if (!styleCheck.valid) {
            return {
                valid: false,
                message: 'Period ' + (index + 1) + ': ' +
                    styleCheck.message
            };
        }

        // ---- specialisations ----
        var specCheck = canonicaliseSpecialisations(
            raw.specialisations
        );
        if (!specCheck.valid) {
            return {
                valid: false,
                message: 'Period ' + (index + 1) + ': ' +
                    specCheck.message
            };
        }

        return {
            valid: true,
            value: {
                startPeriod: startCanon,
                endPeriod: endCanon,
                name: name,
                tacticalStyle: styleCheck.value,
                specialisations: specCheck.value
            }
        };
    }

    /**
     * Canonicalise the periods array.
     *
     * Accepts:
     *   - a raw `periods` array
     *   - a legacy record with `nameHistory` and scalars
     *   - a record with neither, which produces a single period
     *     from the current scalars
     *
     * The `fallback` argument carries the record's top-level
     * scalars (name, tacticalStyle, specialisations, startPeriod,
     * endPeriod) that build the single-entry default when
     * nameHistory is absent.
     *
     * Returns { valid, value?, message? }.
     */
    function canonicalisePeriods(raw, fallback) {
        fallback = fallback || {};

        // ---- Case 1: raw.periods is already an array. ----
        if (Array.isArray(raw)) {
            return canonicalisePeriodsArray(raw);
        }

        // ---- Case 2: legacy nameHistory. ----
        var history = fallback.nameHistory;
        if (Array.isArray(history) && history.length > 0) {
            return canonicaliseFromNameHistory(history, fallback);
        }

        // ---- Case 3: no periods, no nameHistory. One period. ----
        return canonicaliseSinglePeriod(fallback);
    }

    function canonicalisePeriodsArray(rawArray) {
        if (rawArray.length === 0) {
            return {
                valid: false,
                message: 'A team must have at least one period.'
            };
        }

        var cleaned = [];
        for (var i = 0; i < rawArray.length; i++) {
            var isLast = (i === rawArray.length - 1);
            var check = canonicalisePeriodEntry(
                rawArray[i], i, isLast
            );
            if (!check.valid) {
                return { valid: false, message: check.message };
            }
            cleaned.push(check.value);
        }

        // ---- Sort by startPeriod ascending. ----
        cleaned.sort(function(a, b) {
            return parseInt(a.startPeriod, 10) -
                   parseInt(b.startPeriod, 10);
        });

        // ---- Re-check "only last is open-ended" after sorting. ----
        //
        // A caller that supplied the entries out of order, with
        // the open-ended one first, would pass the per-entry check
        // but produce an array whose first entry is open. Sorting
        // first, then re-checking, catches that.
        for (var j = 0; j < cleaned.length; j++) {
            var isLastAfterSort = (j === cleaned.length - 1);
            if (cleaned[j].endPeriod === '' && !isLastAfterSort) {
                return {
                    valid: false,
                    message: 'Only the last period may be open-ended. ' +
                        'After sorting, entry ' + (j + 1) +
                        ' (' + cleaned[j].name + ') has a blank ' +
                        'end period but is not last.'
                };
            }
        }

        // ---- Overlap check. ----
        for (var a = 0; a < cleaned.length; a++) {
            for (var b = a + 1; b < cleaned.length; b++) {
                if (periodsOverlap(cleaned[a], cleaned[b])) {
                    return {
                        valid: false,
                        message: 'Periods "' + cleaned[a].name +
                            '" and "' + cleaned[b].name +
                            '" overlap.'
                    };
                }
            }
        }

        return { valid: true, value: cleaned };
    }

    function periodsOverlap(p, q) {
        var pStart = parseInt(p.startPeriod, 10);
        var pEnd = p.endPeriod === ''
            ? Infinity
            : parseInt(p.endPeriod, 10);
        var qStart = parseInt(q.startPeriod, 10);
        var qEnd = q.endPeriod === ''
            ? Infinity
            : parseInt(q.endPeriod, 10);

        return pStart <= qEnd && qStart <= pEnd;
    }

    /**
     * Build periods from a legacy nameHistory array.
     *
     * Every produced period carries the fallback's tactical style
     * and specialisations. We have no way to know which historical
     * period carried which values; the current values are the
     * safest guess, and the user can edit individual periods after
     * the migration.
     */
    function canonicaliseFromNameHistory(history, fallback) {
        var styleCheck = canonicaliseTacticalStyle(
            fallback.tacticalStyle
        );
        var styleValue = styleCheck.valid ? styleCheck.value : '';

        var specCheck = canonicaliseSpecialisations(
            fallback.specialisations
        );
        var specValue = specCheck.valid ? specCheck.value : [];

        var periods = [];
        for (var i = 0; i < history.length; i++) {
            var entry = history[i];
            if (!isObject(entry)) {
                return {
                    valid: false,
                    message: 'Name history entry ' + (i + 1) +
                        ' is malformed.'
                };
            }
            if (!isNonEmptyString(entry.name)) {
                return {
                    valid: false,
                    message: 'Name history entry ' + (i + 1) +
                        ' has no name.'
                };
            }

            var startCanon = canonicalisePeriod(entry.startPeriod);
            if (startCanon === null || startCanon === '') {
                return {
                    valid: false,
                    message: 'Name history entry ' + (i + 1) +
                        ' has an invalid start period.'
                };
            }

            var endCanon = canonicalisePeriod(entry.endPeriod);
            if (endCanon === null) {
                return {
                    valid: false,
                    message: 'Name history entry ' + (i + 1) +
                        ' has an invalid end period.'
                };
            }

            periods.push({
                startPeriod: startCanon,
                endPeriod: endCanon,
                name: String(entry.name).trim(),
                tacticalStyle: styleValue,
                specialisations: specValue.slice()
            });
        }

        // Reuse the array canonicaliser for the invariants (sort,
        // open-ended position, overlap).
        return canonicalisePeriodsArray(periods);
    }

    /**
     * Build a single period from the record's top-level scalars.
     *
     * `name` is required. `startPeriod` is required when the
     * top-level value is set; a blank startPeriod is accepted and
     * normalised to the current application year, so a fresh
     * create that omits start still produces a well-formed
     * period.
     */
    function canonicaliseSinglePeriod(fallback) {
        if (!isNonEmptyString(fallback.name)) {
            return {
                valid: false,
                message: 'Team name is required.'
            };
        }

        var startCanon = canonicalisePeriod(fallback.startPeriod);
        if (startCanon === null) {
            return {
                valid: false,
                message: 'Invalid start period.'
            };
        }

        if (startCanon === '') {
            // Absent start. Use the current calendar year as a
            // well-formed default so a create that did not supply
            // a start still produces a valid period.
            startCanon = String(new Date().getFullYear());
        }

        var endCanon = canonicalisePeriod(fallback.endPeriod);
        if (endCanon === null) {
            return {
                valid: false,
                message: 'Invalid end period.'
            };
        }

        var styleCheck = canonicaliseTacticalStyle(
            fallback.tacticalStyle
        );
        if (!styleCheck.valid) {
            return { valid: false, message: styleCheck.message };
        }

        var specCheck = canonicaliseSpecialisations(
            fallback.specialisations
        );
        if (!specCheck.valid) {
            return { valid: false, message: specCheck.message };
        }

        var single = {
            startPeriod: startCanon,
            endPeriod: endCanon,
            name: String(fallback.name).trim(),
            tacticalStyle: styleCheck.value,
            specialisations: specCheck.value
        };

        return { valid: true, value: [single] };
    }

    // ============================================================
    // TEAM NAMING HOOK
    // ============================================================

    var _namingUnavailableWarned = false;

    function fireNamingHook(teamId) {
        var Naming = window.TeamNaming || null;

        if (!Naming ||
            typeof Naming.applyTeamName !== 'function') {
            if (!_namingUnavailableWarned) {
                _namingUnavailableWarned = true;
                console.warn(
                    '[TeamCore] TeamNaming module is not loaded. ' +
                    'Team names will not be renumbered after member ' +
                    'changes.'
                );
            }
            return;
        }

        try {
            var p = Naming.applyTeamName(teamId);
            if (p && typeof p.then === 'function') {
                p.catch(function(err) {
                    console.warn(
                        '[TeamCore] TeamNaming.applyTeamName ' +
                        'rejected for team ' + teamId + ':',
                        err
                    );
                });
            }
        } catch (err) {
            console.warn(
                '[TeamCore] TeamNaming.applyTeamName threw for ' +
                'team ' + teamId + ':',
                err
            );
        }
    }

    // ============================================================
    // MISSION CASCADE HOOK
    // ============================================================

    var _missionCascadeUnavailableWarned = false;

    function fireMissionCascade(snapshot, teamId) {
        var Cascade = getMissionCascade();

        if (!Cascade ||
            typeof Cascade.stripTeamRefs !== 'function') {
            if (!_missionCascadeUnavailableWarned) {
                _missionCascadeUnavailableWarned = true;
                console.warn(
                    '[TeamCore] MissionCascade module is not ' +
                    'loaded. Deleting a team will leave dangling ' +
                    'team references in every mission that had ' +
                    'assigned it. Load mission-cascade.js before ' +
                    'team-core.js to enable the cleanup.'
                );
            }
            return {
                assignedTeamEntriesRemoved: 0,
                participantEntriesRemoved: 0
            };
        }

        try {
            return Cascade.stripTeamRefs(snapshot, teamId) || {
                assignedTeamEntriesRemoved: 0,
                participantEntriesRemoved: 0
            };
        } catch (err) {
            console.warn(
                '[TeamCore] MissionCascade.stripTeamRefs threw ' +
                'for team ' + teamId + ':',
                err
            );
            return {
                assignedTeamEntriesRemoved: 0,
                participantEntriesRemoved: 0
            };
        }
    }

    // ============================================================
    // PERIOD CANONICALISATION
    // ============================================================

    function parsePeriod(value) {
        if (!TeamConstants ||
            typeof TeamConstants.parsePeriod !== 'function') {
            return null;
        }
        return TeamConstants.parsePeriod(value);
    }

    function canonicalisePeriod(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var parsed = parsePeriod(value);
        if (parsed === null) { return null; }
        return String(parsed);
    }

    // ============================================================
    // STORE ACCESS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!Array.isArray(window.data.teams)) {
            return null;
        }
        return window.data;
    }

    function findTeamInData(data, id) {
        if (!data || !Array.isArray(data.teams) ||
            !isNonEmptyString(id)) {
            return null;
        }
        var target = String(id);
        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (team && typeof team === 'object' &&
                String(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    function findCharacterInData(data, id) {
        if (!data || !Array.isArray(data.characters) ||
            !isNonEmptyString(id)) {
            return null;
        }
        var target = String(id);
        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (c && typeof c === 'object' &&
                String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    function parseDeathYear(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    // ============================================================
    // INTERVAL HELPERS
    // ============================================================

    function intervalStart(interval) {
        var join = canonicalisePeriod(interval.joinPeriod);
        if (join === null) {
            throw new Error(
                'Malformed joinPeriod in interval.'
            );
        }
        return join === '' ? 0 : parseInt(join, 10);
    }

    function intervalEnd(interval) {
        var leave = canonicalisePeriod(interval.leavePeriod);
        if (leave === null) {
            throw new Error(
                'Malformed leavePeriod in interval.'
            );
        }
        return leave === '' ? Infinity : parseInt(leave, 10);
    }

    function intervalsOverlap(a, b) {
        var aStart = intervalStart(a);
        var aEnd = intervalEnd(a);
        var bStart = intervalStart(b);
        var bEnd = intervalEnd(b);
        return aStart <= bEnd && bStart <= aEnd;
    }

    function validateIntervalShape(raw) {
        if (!isObject(raw)) {
            return {
                valid: false,
                message: 'Interval must be an object.'
            };
        }

        var joinCanon = canonicalisePeriod(raw.joinPeriod);
        if (joinCanon === null) {
            return {
                valid: false,
                message: 'Invalid join period format.'
            };
        }

        var leaveCanon = canonicalisePeriod(raw.leavePeriod);
        if (leaveCanon === null) {
            return {
                valid: false,
                message: 'Invalid leave period format.'
            };
        }

        if (joinCanon !== '' && leaveCanon !== '') {
            var j = parseInt(joinCanon, 10);
            var l = parseInt(leaveCanon, 10);
            if (l < j) {
                return {
                    valid: false,
                    message: 'Leave period cannot be before join ' +
                        'period.'
                };
            }
        }

        return {
            valid: true,
            interval: {
                joinPeriod: joinCanon,
                leavePeriod: leaveCanon
            }
        };
    }

    function validateMemberIntervals(rawIntervals, teamType, allowEmpty) {
        if (!Array.isArray(rawIntervals)) {
            return {
                valid: false,
                message: 'Intervals must be an array.'
            };
        }

        if (rawIntervals.length === 0) {
            if (allowEmpty) {
                return { valid: true, intervals: [] };
            }
            return {
                valid: false,
                message: 'A member entry must contain at least one ' +
                    'interval.'
            };
        }

        var cleaned = [];
        for (var i = 0; i < rawIntervals.length; i++) {
            var check = validateIntervalShape(rawIntervals[i]);
            if (!check.valid) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) + ': ' +
                        check.message
                };
            }

            if (check.interval.joinPeriod !== '' &&
                !TeamConstants.isValidPeriod(
                    check.interval.joinPeriod, teamType
                )) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) +
                        ': join period is out of bounds for team ' +
                        'type.'
                };
            }
            if (check.interval.leavePeriod !== '' &&
                !TeamConstants.isValidPeriod(
                    check.interval.leavePeriod, teamType
                )) {
                return {
                    valid: false,
                    message: 'Interval ' + (i + 1) +
                        ': leave period is out of bounds for team ' +
                        'type.'
                };
            }

            cleaned.push(check.interval);
        }

        for (var a = 0; a < cleaned.length; a++) {
            for (var b = a + 1; b < cleaned.length; b++) {
                if (intervalsOverlap(cleaned[a], cleaned[b])) {
                    return {
                        valid: false,
                        message: 'Intervals ' + (a + 1) +
                            ' and ' + (b + 1) + ' overlap.'
                    };
                }
            }
        }

        return { valid: true, intervals: cleaned };
    }

    function buildCanonicalMember(characterId, role, intervals) {
        return {
            memberId: generateMemberId(),
            characterId: String(characterId).trim(),
            role: role,
            intervals: intervals
        };
    }

    // ============================================================
    // MEMBER INPUT HELPERS
    // ============================================================

    function extractIntervalsFromMemberInput(memberData) {
        if (!isObject(memberData)) { return null; }

        if (Array.isArray(memberData.intervals)) {
            return memberData.intervals;
        }

        var hasJoin = memberData.joinPeriod !== undefined &&
                      memberData.joinPeriod !== null;
        var hasLeave = memberData.leavePeriod !== undefined &&
                       memberData.leavePeriod !== null;

        if (hasJoin || hasLeave) {
            return [{
                joinPeriod: memberData.joinPeriod,
                leavePeriod: memberData.leavePeriod
            }];
        }

        return [{ joinPeriod: '', leavePeriod: '' }];
    }

    function resolveRole(memberData) {
        if (!isObject(memberData)) {
            return {
                valid: false,
                message: 'Member data must be an object.'
            };
        }

        if (memberData.role === undefined ||
            memberData.role === null) {
            return { valid: true, role: TeamConstants.DEFAULT_ROLE };
        }

        if (typeof memberData.role !== 'string') {
            return {
                valid: false,
                message: 'Member role must be a string.'
            };
        }

        var trimmed = memberData.role.trim();
        if (trimmed === '') {
            return { valid: true, role: TeamConstants.DEFAULT_ROLE };
        }

        return { valid: true, role: trimmed };
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateRankingEntry(entry, teamType) {
        if (!isObject(entry)) {
            return {
                valid: false,
                message: 'Invalid ranking entry.'
            };
        }

        var period = parsePeriod(entry.period);
        if (period === null) {
            return {
                valid: false,
                message: 'Invalid period format.'
            };
        }

        if (!TeamConstants.isValidPeriod(period, teamType)) {
            return {
                valid: false,
                message: 'Period is out of bounds for team type.'
            };
        }

        var rank = parsePeriod(entry.rank);
        if (rank === null) {
            return {
                valid: false,
                message: 'Invalid rank format.'
            };
        }

        return { valid: true, period: period, rank: rank };
    }

    function validateMemberRole(member) {
        if (!member || member.role === undefined) {
            return { valid: true };
        }
        if (typeof member.role !== 'string') {
            return {
                valid: false,
                message: 'Member role must be a string.'
            };
        }
        return { valid: true };
    }

    /**
     * Validate a fully-built team record.
     *
     * Checks structure. The periods array is validated for shape:
     * non-empty, sorted, at least one entry, only the last
     * open-ended, no overlaps. Every per-period check lives in
     * canonicalisePeriodEntry, and validatePeriods delegates to
     * it so the invariants are stated once.
     */
    function validateCompleteTeam(team) {
        if (!isObject(team)) {
            return {
                valid: false,
                message: 'Team must be an object.'
            };
        }

        if (!isNonEmptyString(team.name)) {
            return {
                valid: false,
                message: 'Team name is required.'
            };
        }

        if (!TeamConstants.isValidTeamType(team.type)) {
            return {
                valid: false,
                message: 'Invalid team type.'
            };
        }

        if (!TeamConstants.isValidTeamStatus(team.status)) {
            return {
                valid: false,
                message: 'Invalid team status.'
            };
        }

        if (!Array.isArray(team.members)) {
            return {
                valid: false,
                message: 'members must be an array.'
            };
        }
        if (!Array.isArray(team.rankingHistory)) {
            return {
                valid: false,
                message: 'rankingHistory must be an array.'
            };
        }

        // ---- periods ----
        if (!Array.isArray(team.periods)) {
            return {
                valid: false,
                message: 'periods must be an array.'
            };
        }
        if (team.periods.length === 0) {
            return {
                valid: false,
                message: 'A team must have at least one period.'
            };
        }
        for (var p = 0; p < team.periods.length; p++) {
            var entry = team.periods[p];
            var isLast = (p === team.periods.length - 1);
            var entryCheck = canonicalisePeriodEntry(
                entry, p, isLast
            );
            if (!entryCheck.valid) {
                return {
                    valid: false,
                    message: entryCheck.message
                };
            }
        }
        for (var a = 0; a < team.periods.length; a++) {
            for (var b = a + 1; b < team.periods.length; b++) {
                if (periodsOverlap(team.periods[a], team.periods[b])) {
                    return {
                        valid: false,
                        message: 'Periods "' +
                            team.periods[a].name + '" and "' +
                            team.periods[b].name + '" overlap.'
                    };
                }
            }
        }

        // ---- top-level startPeriod / endPeriod mirror the periods.
        //
        // The scalar fields remain on the record because some
        // readers (the timeline, the export header) still use
        // them. They must be consistent with periods[0].start and
        // periods[last].end respectively.
        var expectedStart = team.periods[0].startPeriod;
        var expectedEnd = team.periods[team.periods.length - 1].endPeriod;

        var actualStart = canonicalisePeriod(team.startPeriod);
        var actualEnd = canonicalisePeriod(team.endPeriod);

        if (actualStart === null) {
            return {
                valid: false,
                message: 'Invalid start period for team type.'
            };
        }
        if (actualEnd === null) {
            return {
                valid: false,
                message: 'Invalid end period for team type.'
            };
        }

        if (actualStart !== expectedStart) {
            return {
                valid: false,
                message: 'Top-level startPeriod "' + actualStart +
                    '" does not match periods[0].startPeriod "' +
                    expectedStart + '".'
            };
        }
        if (actualEnd !== expectedEnd) {
            return {
                valid: false,
                message: 'Top-level endPeriod "' + actualEnd +
                    '" does not match the last period\'s endPeriod "' +
                    expectedEnd + '".'
            };
        }

        // ---- members ----
        var seenMemberIds = Object.create(null);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!isObject(member)) {
                return {
                    valid: false,
                    message: 'Invalid member record at index ' + i + '.'
                };
            }
            if (!isNonEmptyString(member.characterId)) {
                return {
                    valid: false,
                    message: 'Member at index ' + i +
                        ' missing characterId.'
                };
            }
            if (!isNonEmptyString(member.memberId)) {
                return {
                    valid: false,
                    message: 'Member at index ' + i +
                        ' missing memberId.'
                };
            }
            var memberIdKey = String(member.memberId);
            if (seenMemberIds[memberIdKey]) {
                return {
                    valid: false,
                    message: 'Duplicate memberId: ' + memberIdKey
                };
            }
            seenMemberIds[memberIdKey] = true;

            var roleCheck = validateMemberRole(member);
            if (!roleCheck.valid) { return roleCheck; }

            var intervalCheck = validateMemberIntervals(
                member.intervals, team.type, true
            );
            if (!intervalCheck.valid) { return intervalCheck; }
        }

        var seenPeriods = Object.create(null);
        for (var j = 0; j < team.rankingHistory.length; j++) {
            var rankEntry = team.rankingHistory[j];
            var rankCheck = validateRankingEntry(rankEntry, team.type);
            if (!rankCheck.valid) { return rankCheck; }
            var periodKey = String(rankCheck.period);
            if (seenPeriods[periodKey]) {
                return {
                    valid: false,
                    message: 'Duplicate ranking entry for period ' +
                        periodKey + '.'
                };
            }
            seenPeriods[periodKey] = true;
        }

        return { valid: true };
    }

    // ============================================================
    // CANDIDATE BUILDERS
    // ============================================================

    /**
     * Project the periods array onto the scalar fields that some
     * readers still expect:
     *
     *   name        = periods[last].name
     *   startPeriod = periods[0].startPeriod
     *   endPeriod   = periods[last].endPeriod
     *
     * The denormalised `name` is the only one of these that
     * nothing else writes; the two period scalars are legacy
     * mirrors of the periods array's first and last entries.
     */
    function projectPeriodScalars(candidate) {
        if (!Array.isArray(candidate.periods) ||
            candidate.periods.length === 0) {
            return;
        }
        var first = candidate.periods[0];
        var last = candidate.periods[candidate.periods.length - 1];

        candidate.name = last.name;
        candidate.startPeriod = first.startPeriod;
        candidate.endPeriod = last.endPeriod;
    }

    function buildNewTeam(teamData) {
        // The periods array is built from teamData.periods when
        // supplied, otherwise from the legacy inputs
        // (nameHistory / style / specialisations) or from the
        // top-level scalars.
        var periodsInput = teamData.periods;
        var fallback = {
            nameHistory: teamData.nameHistory,
            name: teamData.name,
            startPeriod: teamData.startPeriod,
            endPeriod: teamData.endPeriod,
            tacticalStyle: readRawTacticalStyle(teamData),
            specialisations: teamData.specialisations
        };

        var periodsCheck = canonicalisePeriods(
            periodsInput, fallback
        );
        // A caller that reaches this function with invalid
        // periods has already been rejected by createTeam's
        // pre-flight. The defensive check here is a belt-and-
        // braces guarantee; if it fails, an empty periods array
        // is produced and validateCompleteTeam rejects the
        // candidate immediately after.
        var periods = periodsCheck.valid
            ? periodsCheck.value
            : [];

        var candidate = {
            id: generateTeamId(),
            type: teamData.type,
            status: teamData.status,
            members: [],
            rankingHistory: [],
            periods: periods,
            temporaryMission: teamData.temporaryMission !== undefined &&
                teamData.temporaryMission !== null &&
                teamData.temporaryMission !== ''
                ? String(teamData.temporaryMission).trim()
                : null,
            classId: teamData.classId !== undefined &&
                teamData.classId !== null &&
                teamData.classId !== ''
                ? String(teamData.classId).trim()
                : null,
            teamNumber: teamData.teamNumber !== undefined &&
                teamData.teamNumber !== null
                ? String(teamData.teamNumber).trim()
                : '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        projectPeriodScalars(candidate);

        return candidate;
    }

    function buildUpdatedTeam(existing, updates) {
        var candidate = deepClone(existing);

        if (updates.type !== undefined) {
            var normalized =
                TeamConstants.normalizeTeamType(updates.type);
            if (normalized === null) {
                return {
                    valid: false,
                    message: 'Invalid team type: ' + updates.type
                };
            }
            candidate.type = normalized;
        }

        if (updates.status !== undefined) {
            if (!TeamConstants.isValidTeamStatus(updates.status)) {
                return {
                    valid: false,
                    message: 'Invalid team status: ' + updates.status
                };
            }
            candidate.status = updates.status;
        }

        // ---- periods ----
        //
        // Three shapes are accepted:
        //
        //   updates.periods       a canonical periods array;
        //                         replaces the existing one
        //   updates.nameHistory   a legacy name history plus
        //                         scalar style / specialisations;
        //                         rebuilt into periods
        //   neither               the existing periods are kept
        //
        // The legacy path also reads updates.style and
        // updates.specialisations, if present, so an old caller
        // that writes those scalars still works.
        if (updates.periods !== undefined) {
            var periodsCheck = canonicalisePeriods(
                updates.periods, null
            );
            if (!periodsCheck.valid) {
                return {
                    valid: false,
                    message: periodsCheck.message
                };
            }
            candidate.periods = periodsCheck.value;
        } else if (updates.nameHistory !== undefined) {
            var fallback = {
                nameHistory: updates.nameHistory,
                name: isNonEmptyString(candidate.name)
                    ? candidate.name
                    : '',
                startPeriod: candidate.startPeriod,
                endPeriod: candidate.endPeriod,
                tacticalStyle: updates.tacticalStyle !== undefined
                    ? updates.tacticalStyle
                    : updates.style,
                specialisations: updates.specialisations
            };

            var historyCheck = canonicalisePeriods(
                null, fallback
            );
            if (!historyCheck.valid) {
                return {
                    valid: false,
                    message: historyCheck.message
                };
            }
            candidate.periods = historyCheck.value;
        }

        // ---- Direct scalar-style updates ----
        //
        // A caller that sends only `name` or only `tacticalStyle`
        // or only `specialisations` is updating the CURRENT (last)
        // period in place. This is the shape the team form uses
        // when the user edits the top of the form without
        // touching the period history below.
        var touchedLastPeriod = false;
        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                return {
                    valid: false,
                    message: 'Team name cannot be empty.'
                };
            }
            if (Array.isArray(candidate.periods) &&
                candidate.periods.length > 0) {
                var lastForName =
                    candidate.periods[candidate.periods.length - 1];
                lastForName.name = String(updates.name).trim();
                touchedLastPeriod = true;
            }
        }

        if (updates.tacticalStyle !== undefined) {
            var styleCheck = canonicaliseTacticalStyle(
                updates.tacticalStyle
            );
            if (!styleCheck.valid) {
                return styleCheck;
            }
            if (Array.isArray(candidate.periods) &&
                candidate.periods.length > 0) {
                var lastForStyle =
                    candidate.periods[candidate.periods.length - 1];
                lastForStyle.tacticalStyle = styleCheck.value;
                touchedLastPeriod = true;
            }
        }

        // Legacy alias: updates.style.
        if (updates.style !== undefined &&
            updates.tacticalStyle === undefined) {
            var styleAliasCheck = canonicaliseTacticalStyle(
                updates.style
            );
            if (!styleAliasCheck.valid) {
                return styleAliasCheck;
            }
            if (Array.isArray(candidate.periods) &&
                candidate.periods.length > 0) {
                var lastForStyleAlias =
                    candidate.periods[candidate.periods.length - 1];
                lastForStyleAlias.tacticalStyle =
                    styleAliasCheck.value;
                touchedLastPeriod = true;
            }
        }

        if (updates.specialisations !== undefined) {
            var specCheck = canonicaliseSpecialisations(
                updates.specialisations
            );
            if (!specCheck.valid) {
                return specCheck;
            }
            if (Array.isArray(candidate.periods) &&
                candidate.periods.length > 0) {
                var lastForSpec =
                    candidate.periods[candidate.periods.length - 1];
                lastForSpec.specialisations = specCheck.value;
                touchedLastPeriod = true;
            }
        }

        if (touchedLastPeriod) {
            // Re-run the periods invariants, because in-place
            // edits to the last entry can break ordering if the
            // caller set an unexpected name... but names do not
            // affect ordering. The checks that matter (open-
            // ended only on last, no overlaps) are unaffected by
            // name / style / specialisations edits, so a full
            // re-canonicalisation is unnecessary. Skip.
        }

        if (updates.temporaryMission !== undefined) {
            candidate.temporaryMission =
                updates.temporaryMission !== null &&
                updates.temporaryMission !== ''
                ? String(updates.temporaryMission).trim()
                : null;
        }

        if (updates.classId !== undefined) {
            candidate.classId =
                updates.classId !== null && updates.classId !== ''
                ? String(updates.classId).trim()
                : null;
        }

        if (updates.teamNumber !== undefined) {
            var numStr = updates.teamNumber !== null &&
                         updates.teamNumber !== ''
                ? String(updates.teamNumber).trim()
                : '';
            if (numStr &&
                !/^[a-zA-Z0-9\-_ ]+$/.test(numStr)) {
                return {
                    valid: false,
                    message: 'Team identifier contains invalid ' +
                        'characters.'
                };
            }
            candidate.teamNumber = numStr;
        }

        if (Array.isArray(candidate.members)) {
            for (var m = 0; m < candidate.members.length; m++) {
                var member = candidate.members[m];
                if (!member || !Array.isArray(member.intervals)) {
                    continue;
                }
                var intervalCheck = validateMemberIntervals(
                    member.intervals, candidate.type, true
                );
                if (!intervalCheck.valid) {
                    return {
                        valid: false,
                        message: 'Type change would invalidate ' +
                            'existing member intervals: ' +
                            intervalCheck.message
                    };
                }
            }
        }

        if (Array.isArray(candidate.rankingHistory)) {
            for (var r = 0; r < candidate.rankingHistory.length; r++) {
                var rankCheck = validateRankingEntry(
                    candidate.rankingHistory[r], candidate.type
                );
                if (!rankCheck.valid) {
                    return {
                        valid: false,
                        message: 'Type change would invalidate ' +
                            'existing ranking periods: ' +
                            rankCheck.message
                    };
                }
            }
        }

        candidate.updatedAt = new Date().toISOString();

        // Project the derived scalars from the periods array.
        projectPeriodScalars(candidate);

        return { valid: true, candidate: candidate };
    }

    // ============================================================
    // MUTATION WRAPPER
    // ============================================================

    function runMutation(config) {
        if (!MutationPipeline ||
            typeof MutationPipeline.performMutation !== 'function') {
            return Promise.resolve(
                failure('MutationPipeline is not available.')
            );
        }

        return MutationPipeline.performMutation({
            validate: config.validate ||
                function() { return { valid: true }; },
            mutate: config.mutate,
            logMessage: config.logMessage,
            successMessage: config.successMessage ||
                'Team updated.',
            failureMessage: config.failureMessage ||
                'Failed to update team.'
        });
    }

    // ============================================================
    // TEAM CRUD
    // ============================================================

    function createTeam(teamData) {
        if (failIfMissing(checkBaseDependencies(), 'createTeam')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isObject(teamData)) {
            return Promise.resolve(
                failure('Team data must be an object.')
            );
        }

        if (!isNonEmptyString(teamData.name)) {
            return Promise.resolve(failure('Team name is required.'));
        }

        var normalizedType =
            TeamConstants.normalizeTeamType(teamData.type);
        if (normalizedType === null) {
            return Promise.resolve(
                failure('Invalid team type: ' + teamData.type)
            );
        }

        var status = teamData.status ||
            TeamConstants.DEFAULT_TEAM_STATUS;
        if (!TeamConstants.isValidTeamStatus(status)) {
            return Promise.resolve(
                failure('Invalid team status: ' + status)
            );
        }

        // Pre-flight the periods array (or its legacy sources).
        var fallback = {
            nameHistory: teamData.nameHistory,
            name: teamData.name,
            startPeriod: teamData.startPeriod,
            endPeriod: teamData.endPeriod,
            tacticalStyle: readRawTacticalStyle(teamData),
            specialisations: teamData.specialisations
        };
        var periodsCheck = canonicalisePeriods(
            teamData.periods, fallback
        );
        if (!periodsCheck.valid) {
            return Promise.resolve(
                failure(periodsCheck.message)
            );
        }

        var candidate = buildNewTeam({
            name: teamData.name,
            type: normalizedType,
            status: status,
            periods: periodsCheck.value,
            temporaryMission: teamData.temporaryMission,
            classId: teamData.classId,
            teamNumber: teamData.teamNumber
        });

        var completeCheck = validateCompleteTeam(candidate);
        if (!completeCheck.valid) {
            return Promise.resolve(failure(completeCheck.message));
        }

        var targetId = candidate.id;

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return {
                        valid: false,
                        message: 'Team data store is not available.'
                    };
                }
                if (findTeamInData(snapshot, targetId)) {
                    return {
                        valid: false,
                        message: 'Team ID collision.'
                    };
                }
                return { valid: true };
            },

            mutate: function(snapshot) {
                if (!Array.isArray(snapshot.teams)) {
                    snapshot.teams = [];
                }
                snapshot.teams.push(deepClone(candidate));
                return { team: candidate, id: targetId };
            },

            logMessage: 'Created team: ' + candidate.name,
            successMessage: 'Team created successfully!',
            failureMessage: 'Failed to create team.'
        });
    }

    function updateTeam(id, updates) {
        if (failIfMissing(checkBaseDependencies(), 'updateTeam')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        if (!isObject(updates)) {
            return Promise.resolve(
                failure('Updates must be an object.')
            );
        }

        if (Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var targetId = String(id).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        var preflight = buildUpdatedTeam(current, updates);
        if (!preflight.valid) {
            return Promise.resolve(failure(preflight.message));
        }
        var preflightCheck =
            validateCompleteTeam(preflight.candidate);
        if (!preflightCheck.valid) {
            return Promise.resolve(
                failure(preflightCheck.message)
            );
        }

        var updatesCopy = deepClone(updates);

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return {
                        valid: false,
                        message: 'Team data store is not available.'
                    };
                }
                var currentInSnapshot =
                    findTeamInData(snapshot, targetId);
                if (!currentInSnapshot) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }

                var snapshotBuild = buildUpdatedTeam(
                    currentInSnapshot, updatesCopy
                );
                if (!snapshotBuild.valid) {
                    return {
                        valid: false,
                        message: snapshotBuild.message
                    };
                }
                var snapshotCheck = validateCompleteTeam(
                    snapshotBuild.candidate
                );
                if (!snapshotCheck.valid) {
                    return {
                        valid: false,
                        message: snapshotCheck.message
                    };
                }

                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }

                var snapshotBuild = buildUpdatedTeam(
                    target, updatesCopy
                );
                if (!snapshotBuild.valid) {
                    throw new Error(snapshotBuild.message);
                }
                var snapshotCheck = validateCompleteTeam(
                    snapshotBuild.candidate
                );
                if (!snapshotCheck.valid) {
                    throw new Error(snapshotCheck.message);
                }

                var candidate = snapshotBuild.candidate;

                var updateableProps = [
                    'name', 'type', 'startPeriod', 'endPeriod',
                    'status', 'classId', 'teamNumber',
                    'temporaryMission',
                    'periods',
                    'updatedAt'
                ];
                for (var i = 0; i < updateableProps.length; i++) {
                    var key = updateableProps[i];
                    if (candidate[key] !== undefined) {
                        target[key] = candidate[key];
                    }
                }

                // The scalar mirrors of the periods array are
                // written explicitly, because they are not in the
                // updateable list above (they are derived).
                target.name = candidate.name;
                target.startPeriod = candidate.startPeriod;
                target.endPeriod = candidate.endPeriod;

                // Drop legacy fields that a canonicalised record
                // no longer carries. This is what makes the
                // migration persistent on any update.
                if (target.nameHistory !== undefined) {
                    delete target.nameHistory;
                }
                if (target.style !== undefined) {
                    delete target.style;
                }
                if (target.specialisations !== undefined) {
                    delete target.specialisations;
                }

                return { team: target, id: targetId };
            },

            logMessage: 'Updated team: ' + preflight.candidate.name,
            successMessage: 'Team updated successfully!',
            failureMessage: 'Failed to update team.'
        });
    }

    function deleteTeam(id) {
        if (failIfMissing(checkBaseDependencies(), 'deleteTeam')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var targetId = String(id).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        var teamName = current.name || 'Unknown Team';

        var TournamentCore = window.TournamentCore;
        if (!TournamentCore ||
            typeof TournamentCore.stripTeamRefs !== 'function') {
            return Promise.resolve(failure(
                'TournamentCore.stripTeamRefs is required to delete ' +
                'a team. It is not available.'
            ));
        }

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return {
                        valid: false,
                        message: 'Team data store is not available.'
                    };
                }
                if (!findTeamInData(snapshot, targetId)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                return { valid: true };
            },

            mutate: function(snapshot) {
                var idx = -1;
                for (var i = 0; i < snapshot.teams.length; i++) {
                    if (snapshot.teams[i] &&
                        String(snapshot.teams[i].id) === targetId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }

                TournamentCore.stripTeamRefs(snapshot, targetId);
                fireMissionCascade(snapshot, targetId);

                snapshot.teams.splice(idx, 1);
                return { id: targetId };
            },

            logMessage: 'Deleted team: ' + teamName,
            successMessage: 'Team deleted successfully!',
            failureMessage: 'Failed to delete team.'
        });
    }

    // ============================================================
    // MEMBER MUTATIONS
    // ============================================================

    function addMember(teamId, memberData) {
        if (failIfMissing(checkMemberDependencies(), 'addMember')) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isObject(memberData)) {
            return Promise.resolve(
                failure('Member data must be an object.')
            );
        }
        if (!isNonEmptyString(memberData.characterId)) {
            return Promise.resolve(
                failure('Character ID is required.')
            );
        }

        var roleRes = resolveRole(memberData);
        if (!roleRes.valid) {
            return Promise.resolve(failure(roleRes.message));
        }

        var rawIntervals =
            extractIntervalsFromMemberInput(memberData);
        if (rawIntervals === null) {
            return Promise.resolve(failure(
                'Could not read intervals from member data.'
            ));
        }

        var targetId = String(teamId).trim();
        var targetChar = String(memberData.characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        var incomingCheck = validateMemberIntervals(
            rawIntervals, current.type, false
        );
        if (!incomingCheck.valid) {
            return Promise.resolve(failure(incomingCheck.message));
        }

        var existingEntry = null;
        if (Array.isArray(current.members)) {
            for (var i = 0; i < current.members.length; i++) {
                var m = current.members[i];
                if (m && String(m.characterId) === targetChar) {
                    existingEntry = m;
                    break;
                }
            }
        }

        if (existingEntry &&
            Array.isArray(existingEntry.intervals)) {
            for (var a = 0; a < incomingCheck.intervals.length; a++) {
                for (var b = 0;
                     b < existingEntry.intervals.length;
                     b++) {
                    if (intervalsOverlap(
                        incomingCheck.intervals[a],
                        existingEntry.intervals[b]
                    )) {
                        return Promise.resolve(failure(
                            'The new interval overlaps an existing ' +
                            'one for this character on this team.'
                        ));
                    }
                }
            }
        }

        var preflightChar = findCharacterInData(
            getDataStore(), targetChar
        );
        if (preflightChar) {
            var preflightDeathYear =
                parseDeathYear(preflightChar.deathYear);
            if (preflightDeathYear !== null) {
                for (var pi = 0;
                     pi < incomingCheck.intervals.length; pi++) {
                    var pJoin = parsePeriod(
                        incomingCheck.intervals[pi].joinPeriod
                    );
                    if (pJoin !== null &&
                        pJoin > preflightDeathYear) {
                        return Promise.resolve(failure(
                            'Cannot assign a stint that starts ' +
                            'after the character\'s death year (' +
                            preflightDeathYear + ').'
                        ));
                    }
                }
            }
        }

        var roleCopy = roleRes.role;
        var intervalsCopy = incomingCheck.intervals.map(
            function(iv) {
                return {
                    joinPeriod: iv.joinPeriod,
                    leavePeriod: iv.leavePeriod
                };
            }
        );

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                if (!Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team members are malformed.'
                    };
                }

                if (!_characterProvider.exists(
                    snapshot, targetChar
                )) {
                    return {
                        valid: false,
                        message: 'Character not found.'
                    };
                }

                var snapshotChar = findCharacterInData(
                    snapshot, targetChar
                );
                if (snapshotChar) {
                    var snapshotDeathYear = parseDeathYear(
                        snapshotChar.deathYear
                    );
                    if (snapshotDeathYear !== null) {
                        for (var di = 0;
                             di < intervalsCopy.length; di++) {
                            var dJoin = parsePeriod(
                                intervalsCopy[di].joinPeriod
                            );
                            if (dJoin !== null &&
                                dJoin > snapshotDeathYear) {
                                return {
                                    valid: false,
                                    message: 'Cannot assign a ' +
                                        'stint that starts after ' +
                                        'the character\'s death ' +
                                        'year (' +
                                        snapshotDeathYear + ').'
                                };
                            }
                        }
                    }
                }

                for (var i = 0; i < target.members.length; i++) {
                    var m = target.members[i];
                    if (!m ||
                        String(m.characterId) !== targetChar) {
                        continue;
                    }
                    if (!Array.isArray(m.intervals)) { continue; }

                    for (var a = 0;
                         a < intervalsCopy.length;
                         a++) {
                        for (var b = 0;
                             b < m.intervals.length;
                             b++) {
                            if (intervalsOverlap(
                                intervalsCopy[a],
                                m.intervals[b]
                            )) {
                                return {
                                    valid: false,
                                    message: 'The new interval ' +
                                        'overlaps an existing one ' +
                                        'for this character on ' +
                                        'this team.'
                                };
                            }
                        }
                    }
                }

                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }
                if (!Array.isArray(target.members)) {
                    target.members = [];
                }

                var entry = null;
                for (var i = 0; i < target.members.length; i++) {
                    var m = target.members[i];
                    if (m && String(m.characterId) === targetChar) {
                        entry = m;
                        break;
                    }
                }

                if (entry) {
                    if (!Array.isArray(entry.intervals)) {
                        entry.intervals = [];
                    }
                    for (var a = 0;
                         a < intervalsCopy.length;
                         a++) {
                        entry.intervals.push({
                            joinPeriod:
                                intervalsCopy[a].joinPeriod,
                            leavePeriod:
                                intervalsCopy[a].leavePeriod
                        });
                    }
                } else {
                    entry = buildCanonicalMember(
                        targetChar, roleCopy, intervalsCopy
                    );
                    target.members.push(entry);
                }

                target.updatedAt = new Date().toISOString();

                var character = findCharacterInData(
                    snapshot, targetChar
                );
                if (character) {
                    var deathYear = parseDeathYear(
                        character.deathYear
                    );
                    if (deathYear !== null) {
                        endStintsForCharacter(
                            snapshot, targetChar, deathYear
                        );
                    }
                }

                return {
                    memberId: entry.memberId,
                    characterId: targetChar,
                    teamId: targetId
                };
            },

            logMessage: 'Added member interval to team: ' +
                (current.name || targetId),
            successMessage: 'Member added successfully!',
            failureMessage: 'Failed to add member.'
        }).then(function(result) {
            if (result && result.success) {
                fireNamingHook(targetId);
            }
            return result;
        });
    }

    function addMemberInterval(
        teamId,
        characterId,
        joinPeriod,
        leavePeriod
    ) {
        return addMember(teamId, {
            characterId: characterId,
            intervals: [{
                joinPeriod: joinPeriod,
                leavePeriod: leavePeriod
            }]
        });
    }

    function batchAddMembers(assignments) {
        if (failIfMissing(
            checkMemberDependencies(), 'batchAddMembers'
        )) {
            return Promise.resolve(failure(
                'Dependencies not loaded. Please refresh.'
            ));
        }

        if (!Array.isArray(assignments)) {
            return Promise.resolve(
                failure('Assignments must be an array.')
            );
        }

        if (assignments.length === 0) {
            return Promise.resolve(success({
                added: 0,
                teamsTouched: 0
            }));
        }

        var cleanRows = [];

        for (var i = 0; i < assignments.length; i++) {
            var row = assignments[i];
            var rowLabel = 'Assignment ' + (i + 1);

            if (!isObject(row)) {
                return Promise.resolve(
                    failure(rowLabel + ': must be an object.')
                );
            }
            if (!isNonEmptyString(row.teamId)) {
                return Promise.resolve(
                    failure(rowLabel + ': teamId is required.')
                );
            }
            if (!isNonEmptyString(row.charId)) {
                return Promise.resolve(
                    failure(rowLabel + ': charId is required.')
                );
            }

            var joinCanon = canonicalisePeriod(row.joinPeriod);
            if (joinCanon === null) {
                return Promise.resolve(failure(
                    rowLabel + ': invalid join period.'
                ));
            }
            var leaveCanon = canonicalisePeriod(row.leavePeriod);
            if (leaveCanon === null) {
                return Promise.resolve(failure(
                    rowLabel + ': invalid leave period.'
                ));
            }

            var role = TeamConstants.DEFAULT_ROLE;
            if (row.role !== undefined && row.role !== null) {
                if (typeof row.role !== 'string') {
                    return Promise.resolve(failure(
                        rowLabel + ': role must be a string.'
                    ));
                }
                var trimmedRole = row.role.trim();
                if (trimmedRole !== '') { role = trimmedRole; }
            }

            cleanRows.push({
                index: i,
                teamId: String(row.teamId).trim(),
                charId: String(row.charId).trim(),
                joinPeriod: joinCanon,
                leavePeriod: leaveCanon,
                role: role
            });
        }

        var preflightStore = getDataStore();
        if (!preflightStore) {
            return Promise.resolve(failure(
                'Team data store is not available.'
            ));
        }

        for (var p = 0; p < cleanRows.length; p++) {
            var pr = cleanRows[p];
            var preflightTeam = findTeamInData(
                preflightStore, pr.teamId
            );
            if (!preflightTeam) {
                return Promise.resolve(failure(
                    'Assignment ' + (pr.index + 1) +
                    ': team no longer exists.'
                ));
            }

            var preflightChar = findCharacterInData(
                preflightStore, pr.charId
            );
            if (preflightChar) {
                var preflightDeath = parseDeathYear(
                    preflightChar.deathYear
                );
                if (preflightDeath !== null) {
                    var preflightJoin = parsePeriod(
                        pr.joinPeriod
                    );
                    if (preflightJoin !== null &&
                        preflightJoin > preflightDeath) {
                        return Promise.resolve(failure(
                            'Assignment ' + (pr.index + 1) +
                            ': join period is after the character\'s ' +
                            'death year (' + preflightDeath + ').'
                        ));
                    }
                }
            }
        }

        var rowsCopy = deepClone(cleanRows);

        return runMutation({
            validate: function(snapshot) {
                if (!snapshot || !Array.isArray(snapshot.teams)) {
                    return {
                        valid: false,
                        message: 'Team data store is not available.'
                    };
                }

                var pendingByPair = Object.create(null);

                for (var v = 0; v < rowsCopy.length; v++) {
                    var row = rowsCopy[v];
                    var rowLabel = 'Assignment ' + (row.index + 1);

                    var team = findTeamInData(snapshot, row.teamId);
                    if (!team) {
                        return {
                            valid: false,
                            message: rowLabel +
                                ': team no longer exists.'
                        };
                    }

                    if (!_characterProvider.exists(
                        snapshot, row.charId
                    )) {
                        return {
                            valid: false,
                            message: rowLabel +
                                ': character not found.'
                        };
                    }

                    var snapshotChar = findCharacterInData(
                        snapshot, row.charId
                    );
                    if (snapshotChar) {
                        var snapshotDeath = parseDeathYear(
                            snapshotChar.deathYear
                        );
                        if (snapshotDeath !== null) {
                            var snapshotJoin = parsePeriod(
                                row.joinPeriod
                            );
                            if (snapshotJoin !== null &&
                                snapshotJoin > snapshotDeath) {
                                return {
                                    valid: false,
                                    message: rowLabel +
                                        ': join period is after ' +
                                        'the character\'s death ' +
                                        'year (' + snapshotDeath +
                                        ').'
                                };
                            }
                        }
                    }

                    var incoming = {
                        joinPeriod: row.joinPeriod,
                        leavePeriod: row.leavePeriod
                    };

                    if (Array.isArray(team.members)) {
                        for (var m = 0;
                             m < team.members.length;
                             m++) {
                            var member = team.members[m];
                            if (!member) { continue; }
                            if (String(member.characterId) !==
                                row.charId) {
                                continue;
                            }
                            if (!Array.isArray(member.intervals)) {
                                continue;
                            }
                            for (var iv = 0;
                                 iv < member.intervals.length;
                                 iv++) {
                                if (intervalsOverlap(
                                    incoming,
                                    member.intervals[iv]
                                )) {
                                    return {
                                        valid: false,
                                        message: rowLabel +
                                            ': interval overlaps ' +
                                            'an existing one for ' +
                                            'this character on this ' +
                                            'team.'
                                    };
                                }
                            }
                        }
                    }

                    var pairKey = row.teamId + '::' + row.charId;
                    var prior = pendingByPair[pairKey];
                    if (prior) {
                        for (var q = 0; q < prior.length; q++) {
                            if (intervalsOverlap(
                                incoming, prior[q]
                            )) {
                                return {
                                    valid: false,
                                    message: rowLabel +
                                        ': interval overlaps ' +
                                        'another assignment in ' +
                                        'this batch for the same ' +
                                        '(team, character) pair.'
                                };
                            }
                        }
                        prior.push(incoming);
                    } else {
                        pendingByPair[pairKey] = [incoming];
                    }
                }

                return { valid: true };
            },

            mutate: function(snapshot) {
                if (!Array.isArray(snapshot.teams)) {
                    throw new Error('Team store is malformed.');
                }

                var teamsTouched = Object.create(null);
                var charactersTouched = Object.create(null);
                var added = 0;

                for (var i = 0; i < rowsCopy.length; i++) {
                    var row = rowsCopy[i];

                    var team = findTeamInData(snapshot, row.teamId);
                    if (!team) {
                        throw new Error(
                            'Team not found in data store: ' +
                            row.teamId
                        );
                    }

                    if (!Array.isArray(team.members)) {
                        team.members = [];
                    }

                    var entry = null;
                    for (var m = 0; m < team.members.length; m++) {
                        var candidateEntry = team.members[m];
                        if (!candidateEntry) { continue; }
                        if (String(candidateEntry.characterId) ===
                            row.charId) {
                            entry = candidateEntry;
                            break;
                        }
                    }

                    if (entry) {
                        if (!Array.isArray(entry.intervals)) {
                            entry.intervals = [];
                        }
                        entry.intervals.push({
                            joinPeriod: row.joinPeriod,
                            leavePeriod: row.leavePeriod
                        });
                    } else {
                        entry = buildCanonicalMember(
                            row.charId,
                            row.role,
                            [{
                                joinPeriod: row.joinPeriod,
                                leavePeriod: row.leavePeriod
                            }]
                        );
                        team.members.push(entry);
                    }

                    team.updatedAt = new Date().toISOString();
                    teamsTouched[row.teamId] = true;
                    charactersTouched[row.charId] = true;
                    added++;
                }

                var charIdsTouched = Object.keys(charactersTouched);
                for (var c = 0; c < charIdsTouched.length; c++) {
                    var charId = charIdsTouched[c];
                    var character = findCharacterInData(
                        snapshot, charId
                    );
                    if (!character) { continue; }

                    var deathYear = parseDeathYear(
                        character.deathYear
                    );
                    if (deathYear === null) { continue; }

                    endStintsForCharacter(
                        snapshot, charId, deathYear
                    );
                }

                return {
                    added: added,
                    teamsTouched: Object.keys(teamsTouched).length,
                    touchedTeamIds: Object.keys(teamsTouched)
                };
            },

            logMessage: function(result) {
                var n = result &&
                    typeof result.added === 'number'
                    ? result.added
                    : rowsCopy.length;
                var t = result &&
                    typeof result.teamsTouched === 'number'
                    ? result.teamsTouched
                    : 0;
                return 'Added ' + n + ' member interval' +
                    (n === 1 ? '' : 's') +
                    ' across ' + t + ' team' +
                    (t === 1 ? '' : 's') + ' (batch).';
            },

            successMessage: function(result) {
                var n = result &&
                    typeof result.added === 'number'
                    ? result.added
                    : rowsCopy.length;
                var t = result &&
                    typeof result.teamsTouched === 'number'
                    ? result.teamsTouched
                    : 0;
                return 'Added ' + n + ' member' +
                    (n === 1 ? '' : 's') + ' to ' + t + ' team' +
                    (t === 1 ? '' : 's') + '.';
            },

            failureMessage: 'Failed to add members.'
        }).then(function(result) {
            if (result && result.success && result.data) {
                var touched = Array.isArray(
                    result.data.touchedTeamIds
                )
                    ? result.data.touchedTeamIds
                    : [];
                for (var t = 0; t < touched.length; t++) {
                    fireNamingHook(touched[t]);
                }
            }
            return result;
        });
    }

    function updateMember(teamId, charId, updates) {
        if (failIfMissing(
            checkBaseDependencies(), 'updateMember'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(
                failure('Character ID is required.')
            );
        }
        if (!isObject(updates)) {
            return Promise.resolve(
                failure('Updates must be an object.')
            );
        }

        if (updates.joinPeriod !== undefined ||
            updates.leavePeriod !== undefined ||
            updates.intervals !== undefined) {
            return Promise.resolve(failure(
                'updateMember does not accept interval edits. Use ' +
                'endMemberInterval, reopenMemberInterval, or ' +
                'addMemberInterval instead.'
            ));
        }

        var targetId = String(teamId).trim();
        var targetChar = String(charId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var proposedRole;
        if (updates.role !== undefined) {
            if (updates.role !== null &&
                typeof updates.role !== 'string') {
                return Promise.resolve(
                    failure('Member role must be a string.')
                );
            }
            if (updates.role === null ||
                updates.role.trim() === '') {
                proposedRole = TeamConstants.DEFAULT_ROLE;
            } else {
                proposedRole = updates.role.trim();
            }
        } else {
            return Promise.resolve(
                failure('No fields to update.')
            );
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var liveMember = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveMember = target.members[i];
                        break;
                    }
                }
                if (!liveMember) {
                    return {
                        valid: false,
                        message: 'Character is not a member of ' +
                            'this team.'
                    };
                }
                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }

                var liveMember = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveMember = target.members[i];
                        break;
                    }
                }
                if (!liveMember) {
                    throw new Error(
                        'Member not found in data store.'
                    );
                }

                liveMember.role = proposedRole;
                target.updatedAt = new Date().toISOString();

                return { member: liveMember, teamId: targetId };
            },

            logMessage: 'Updated member role on team: ' +
                (current.name || targetId),
            successMessage: 'Member updated successfully!',
            failureMessage: 'Failed to update member.'
        });
    }

    function removeMember(teamId, charId) {
        if (failIfMissing(
            checkBaseDependencies(), 'removeMember'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(charId)) {
            return Promise.resolve(
                failure('Character ID is required.')
            );
        }

        var targetId = String(teamId).trim();
        var targetChar = String(charId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var found = false;
        for (var i = 0; i < current.members.length; i++) {
            if (String(current.members[i].characterId) ===
                targetChar) {
                found = true;
                break;
            }
        }
        if (!found) {
            return Promise.resolve(failure(
                'Character is not a member of this team.'
            ));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var present = target.members.some(function(m) {
                    return m &&
                        String(m.characterId) === targetChar;
                });
                if (!present) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member ' +
                            'of this team.'
                    };
                }
                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }
                target.members = target.members.filter(
                    function(m) {
                        return !m ||
                            String(m.characterId) !== targetChar;
                    }
                );
                target.updatedAt = new Date().toISOString();
                return {
                    characterId: targetChar,
                    teamId: targetId
                };
            },

            logMessage: 'Removed member from team: ' +
                (current.name || targetId),
            successMessage: 'Member removed successfully!',
            failureMessage: 'Failed to remove member.'
        });
    }

    function endMemberInterval(
        teamId,
        characterId,
        joinPeriod,
        leaveWeek
    ) {
        if (failIfMissing(
            checkBaseDependencies(), 'endMemberInterval'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(
                failure('Character ID is required.')
            );
        }

        var targetJoin = canonicalisePeriod(joinPeriod);
        if (targetJoin === null) {
            return Promise.resolve(
                failure('Invalid join period.')
            );
        }

        var leaveCanon = canonicalisePeriod(leaveWeek);
        if (leaveCanon === null || leaveCanon === '') {
            return Promise.resolve(
                failure('Valid leave week is required.')
            );
        }

        var targetId = String(teamId).trim();
        var targetChar = String(characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        var entry = null;
        for (var i = 0; i < current.members.length; i++) {
            if (String(current.members[i].characterId) ===
                targetChar) {
                entry = current.members[i];
                break;
            }
        }
        if (!entry || !Array.isArray(entry.intervals)) {
            return Promise.resolve(failure(
                'Character is not a member of this team.'
            ));
        }

        var targetInterval = null;
        for (var j = 0; j < entry.intervals.length; j++) {
            var iv = entry.intervals[j];
            if (!iv) { continue; }
            var ivJoin = canonicalisePeriod(iv.joinPeriod);
            if (ivJoin === targetJoin) {
                targetInterval = iv;
                break;
            }
        }
        if (!targetInterval) {
            return Promise.resolve(failure('Interval not found.'));
        }

        var currentLeaveCanon = canonicalisePeriod(
            targetInterval.leavePeriod
        );
        if (currentLeaveCanon !== '' &&
            currentLeaveCanon !== null) {
            var currentLeaveNum = parseInt(currentLeaveCanon, 10);
            var newLeaveNum = parseInt(leaveCanon, 10);
            if (currentLeaveNum <= newLeaveNum) {
                return Promise.resolve(failure(
                    'Interval is already closed at or before ' +
                    'week ' + leaveCanon + '.'
                ));
            }
        }

        var joinCanon = canonicalisePeriod(
            targetInterval.joinPeriod
        );
        if (joinCanon !== '' && joinCanon !== null) {
            var joinNum = parseInt(joinCanon, 10);
            var leaveNumCheck = parseInt(leaveCanon, 10);
            if (leaveNumCheck < joinNum) {
                return Promise.resolve(failure(
                    'Leave week cannot be before the interval\'s ' +
                    'join week.'
                ));
            }
        }

        var leaveCanonCopy = leaveCanon;

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member ' +
                            'of this team.'
                    };
                }
                var liveIv = null;
                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = canonicalisePeriod(
                        iv.joinPeriod
                    );
                    if (ivJoin === targetJoin) {
                        liveIv = iv;
                        break;
                    }
                }
                if (!liveIv) {
                    return {
                        valid: false,
                        message: 'Interval no longer exists.'
                    };
                }
                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }

                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    throw new Error('Member not found.');
                }

                var liveIv = null;
                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = canonicalisePeriod(
                        iv.joinPeriod
                    );
                    if (ivJoin === targetJoin) {
                        liveIv = iv;
                        break;
                    }
                }
                if (!liveIv) {
                    throw new Error('Interval not found.');
                }

                liveIv.leavePeriod = leaveCanonCopy;
                target.updatedAt = new Date().toISOString();

                return {
                    teamId: targetId,
                    characterId: targetChar,
                    joinPeriod: targetJoin,
                    leavePeriod: leaveCanonCopy
                };
            },

            logMessage: 'Ended member interval on team: ' +
                (current.name || targetId),
            successMessage: 'Member left successfully.',
            failureMessage: 'Failed to end member interval.'
        });
    }

    function reopenMemberInterval(teamId, characterId, joinPeriod) {
        if (failIfMissing(
            checkBaseDependencies(), 'reopenMemberInterval'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(
                failure('Character ID is required.')
            );
        }

        var targetJoin = canonicalisePeriod(joinPeriod);
        if (targetJoin === null) {
            return Promise.resolve(
                failure('Invalid join period.')
            );
        }

        var targetId = String(teamId).trim();
        var targetChar = String(characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member ' +
                            'of this team.'
                    };
                }

                var liveIv = null;
                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = canonicalisePeriod(
                        iv.joinPeriod
                    );
                    if (ivJoin === targetJoin) {
                        liveIv = iv;
                        break;
                    }
                }
                if (!liveIv) {
                    return {
                        valid: false,
                        message: 'Interval no longer exists.'
                    };
                }

                var lv = canonicalisePeriod(liveIv.leavePeriod);
                if (lv === '') {
                    return {
                        valid: false,
                        message: 'Interval is already open.'
                    };
                }

                var reopened = {
                    joinPeriod: canonicalisePeriod(
                        liveIv.joinPeriod
                    ),
                    leavePeriod: ''
                };

                for (var k = 0;
                     k < liveEntry.intervals.length;
                     k++) {
                    var other = liveEntry.intervals[k];
                    if (!other || other === liveIv) { continue; }

                    if (intervalsOverlap(reopened, other)) {
                        return {
                            valid: false,
                            message: 'Reopening this interval ' +
                                'would overlap a later interval.'
                        };
                    }
                }

                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }

                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    throw new Error('Member not found.');
                }

                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv) { continue; }
                    var ivJoin = canonicalisePeriod(
                        iv.joinPeriod
                    );
                    if (ivJoin === targetJoin) {
                        iv.leavePeriod = '';
                        target.updatedAt =
                            new Date().toISOString();
                        return {
                            teamId: targetId,
                            characterId: targetChar,
                            joinPeriod: targetJoin
                        };
                    }
                }

                throw new Error('Interval not found.');
            },

            logMessage: 'Reopened member interval on team: ' +
                (current.name || targetId),
            successMessage: 'Interval reopened.',
            failureMessage: 'Failed to reopen interval.'
        });
    }

    function purgeMemberInterval(teamId, characterId, joinPeriod) {
        if (failIfMissing(
            checkBaseDependencies(), 'purgeMemberInterval'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }
        if (!isNonEmptyString(characterId)) {
            return Promise.resolve(
                failure('Character ID is required.')
            );
        }

        var targetJoin = canonicalisePeriod(joinPeriod);
        if (targetJoin === null) {
            return Promise.resolve(
                failure('Invalid join period.')
            );
        }

        var targetId = String(teamId).trim();
        var targetChar = String(characterId).trim();

        var current = findTeamInData(getDataStore(), targetId);
        if (!current || !Array.isArray(current.members)) {
            return Promise.resolve(failure('Team not found.'));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var liveEntry = null;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        liveEntry = target.members[i];
                        break;
                    }
                }
                if (!liveEntry ||
                    !Array.isArray(liveEntry.intervals)) {
                    return {
                        valid: false,
                        message: 'Character is no longer a member ' +
                            'of this team.'
                    };
                }
                var found = false;
                for (var j = 0;
                     j < liveEntry.intervals.length;
                     j++) {
                    var iv = liveEntry.intervals[j];
                    if (!iv || typeof iv !== 'object') {
                        return {
                            valid: false,
                            message: 'Team member contains a ' +
                                'malformed interval.'
                        };
                    }
                    var ivJoin = canonicalisePeriod(
                        iv.joinPeriod
                    );
                    if (ivJoin === targetJoin) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return {
                        valid: false,
                        message: 'Interval not found.'
                    };
                }
                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target || !Array.isArray(target.members)) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }

                var idx = -1;
                for (var i = 0; i < target.members.length; i++) {
                    if (String(target.members[i].characterId) ===
                        targetChar) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Member not found.');
                }

                var liveEntry = target.members[idx];
                if (!Array.isArray(liveEntry.intervals)) {
                    throw new Error(
                        'Member has no intervals array.'
                    );
                }

                var found = false;

                liveEntry.intervals = liveEntry.intervals.filter(
                    function(iv) {
                        if (!iv || typeof iv !== 'object') {
                            return true;
                        }
                        var ivJoin = canonicalisePeriod(
                            iv.joinPeriod
                        );
                        if (ivJoin === targetJoin) {
                            found = true;
                            return false;
                        }
                        return true;
                    }
                );

                if (!found) {
                    throw new Error('Interval not found.');
                }

                if (liveEntry.intervals.length === 0) {
                    target.members.splice(idx, 1);
                }

                target.updatedAt = new Date().toISOString();
                return {
                    teamId: targetId,
                    characterId: targetChar,
                    joinPeriod: targetJoin,
                    memberRemoved:
                        liveEntry.intervals.length === 0
                };
            },

            logMessage: 'Purged member interval on team: ' +
                (current.name || targetId),
            successMessage: 'Interval removed.',
            failureMessage: 'Failed to remove interval.'
        });
    }

    // ============================================================
    // RANKING MUTATIONS
    // ============================================================

    function addRanking(teamId, period, rank) {
        if (failIfMissing(
            checkBaseDependencies(), 'addRanking'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return Promise.resolve(
                failure('Period must be a positive integer.')
            );
        }

        var rankNum = parsePeriod(rank);
        if (rankNum === null) {
            return Promise.resolve(
                failure('Rank must be a positive integer.')
            );
        }

        var targetId = String(teamId).trim();
        var periodStr = String(periodNum);

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        var entryCheck = validateRankingEntry(
            { period: periodNum, rank: rankNum },
            current.type
        );
        if (!entryCheck.valid) {
            return Promise.resolve(failure(entryCheck.message));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                var check = validateRankingEntry(
                    { period: periodNum, rank: rankNum },
                    target.type
                );
                if (!check.valid) {
                    return {
                        valid: false,
                        message: check.message
                    };
                }
                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }
                if (!Array.isArray(target.rankingHistory)) {
                    target.rankingHistory = [];
                }

                var existingIndex = -1;
                for (var i = 0;
                     i < target.rankingHistory.length;
                     i++) {
                    var entryPeriod = parsePeriod(
                        target.rankingHistory[i].period
                    );
                    if (entryPeriod !== null &&
                        String(entryPeriod) === periodStr) {
                        existingIndex = i;
                        break;
                    }
                }

                var newEntry = {
                    period: periodStr,
                    rank: rankNum
                };
                if (existingIndex !== -1) {
                    target.rankingHistory[existingIndex] =
                        newEntry;
                } else {
                    target.rankingHistory.push(newEntry);
                }

                target.rankingHistory.sort(function(a, b) {
                    var ap = parsePeriod(a.period);
                    var bp = parsePeriod(b.period);
                    if (ap === null && bp === null) { return 0; }
                    if (ap === null) { return 1; }
                    if (bp === null) { return -1; }
                    return ap - bp;
                });

                target.updatedAt = new Date().toISOString();

                return {
                    period: periodStr,
                    rank: rankNum,
                    teamId: targetId
                };
            },

            logMessage: 'Added ranking to team: ' +
                (current.name || targetId),
            successMessage: 'Ranking added successfully!',
            failureMessage: 'Failed to add ranking.'
        });
    }

    function removeRanking(teamId, period) {
        if (failIfMissing(
            checkBaseDependencies(), 'removeRanking'
        )) {
            return Promise.resolve(
                failure('Dependencies not loaded. Please refresh.')
            );
        }

        if (!isNonEmptyString(teamId)) {
            return Promise.resolve(failure('Team ID is required.'));
        }

        var periodNum = parsePeriod(period);
        if (periodNum === null) {
            return Promise.resolve(
                failure('Period must be a positive integer.')
            );
        }

        var targetId = String(teamId).trim();
        var periodStr = String(periodNum);

        var current = findTeamInData(getDataStore(), targetId);
        if (!current) {
            return Promise.resolve(failure('Team not found.'));
        }

        return runMutation({
            validate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target ||
                    !Array.isArray(target.rankingHistory)) {
                    return {
                        valid: false,
                        message: 'Team no longer exists.'
                    };
                }
                return { valid: true };
            },

            mutate: function(snapshot) {
                var target = findTeamInData(snapshot, targetId);
                if (!target ||
                    !Array.isArray(target.rankingHistory)) {
                    throw new Error(
                        'Team not found in data store.'
                    );
                }

                var found = false;
                target.rankingHistory =
                    target.rankingHistory.filter(function(entry) {
                        if (!entry) { return true; }
                        var entryPeriod =
                            parsePeriod(entry.period);
                        if (entryPeriod !== null &&
                            String(entryPeriod) === periodStr) {
                            found = true;
                            return false;
                        }
                        return true;
                    });

                if (!found) {
                    throw new Error('Ranking entry not found.');
                }

                target.updatedAt = new Date().toISOString();
                return { period: periodStr, teamId: targetId };
            },

            logMessage: 'Removed ranking from team: ' +
                (current.name || targetId),
            successMessage: 'Ranking removed successfully!',
            failureMessage: 'Failed to remove ranking.'
        });
    }

    // ============================================================
    // CROSS-DOMAIN CASCADES
    // ============================================================

    function endStintsForCharacter(appData, charId, deathYear) {
        var result = {
            stintsEnded: 0,
            teamsTouched: 0,
            skippedAlreadyEnded: 0,
            skippedStartsAfterDeath: 0
        };

        if (!appData || !isNonEmptyString(charId)) {
            return result;
        }
        if (!Array.isArray(appData.teams)) {
            return result;
        }

        var deathNum = parsePeriod(deathYear);
        if (deathNum === null) { return result; }

        var target = String(charId);
        var deathStr = String(deathNum);

        var teamsTouchedSet = Object.create(null);

        for (var t = 0; t < appData.teams.length; t++) {
            var team = appData.teams[t];
            if (!team || typeof team !== 'object') { continue; }
            if (team.type !== 'professional') { continue; }
            if (!Array.isArray(team.members)) { continue; }

            var teamIdStr = String(team.id);
            var touchedThisTeam = false;

            for (var m = 0; m < team.members.length; m++) {
                var member = team.members[m];
                if (!member || typeof member !== 'object') {
                    continue;
                }
                if (String(member.characterId) !== target) {
                    continue;
                }
                if (!Array.isArray(member.intervals)) { continue; }

                for (var i = 0; i < member.intervals.length; i++) {
                    var iv = member.intervals[i];
                    if (!iv || typeof iv !== 'object') {
                        continue;
                    }

                    var leaveRaw = (iv.leavePeriod === undefined ||
                                    iv.leavePeriod === null)
                        ? ''
                        : String(iv.leavePeriod);
                    var leaveNum = parsePeriod(leaveRaw);

                    if (leaveNum !== null &&
                        leaveNum <= deathNum) {
                        result.skippedAlreadyEnded++;
                        continue;
                    }

                    var joinRaw = (iv.joinPeriod === undefined ||
                                   iv.joinPeriod === null)
                        ? ''
                        : String(iv.joinPeriod);
                    var joinNum = parsePeriod(joinRaw);

                    if (joinNum !== null && joinNum > deathNum) {
                        result.skippedStartsAfterDeath++;
                        continue;
                    }

                    iv.leavePeriod = deathStr;
                    result.stintsEnded++;
                    touchedThisTeam = true;
                }
            }

            if (touchedThisTeam) {
                team.updatedAt = new Date().toISOString();
                teamsTouchedSet[teamIdStr] = true;
            }
        }

        result.teamsTouched = Object.keys(teamsTouchedSet).length;
        return result;
    }

    function stripCharacterRefs(appData, charId) {
        var result = { membershipsRemoved: 0 };

        if (!appData || !charId) { return result; }
        if (!Array.isArray(appData.teams)) { return result; }

        var target = String(charId);

        for (var i = 0; i < appData.teams.length; i++) {
            var team = appData.teams[i];
            if (!team || !Array.isArray(team.members)) {
                continue;
            }
            var before = team.members.length;
            team.members = team.members.filter(function(m) {
                return !m ||
                    String(m.characterId) !== target;
            });
            result.membershipsRemoved +=
                before - team.members.length;
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamCore = {
        configure: configure,

        createTeam: createTeam,
        updateTeam: updateTeam,
        deleteTeam: deleteTeam,

        addMember: addMember,
        addMemberInterval: addMemberInterval,
        batchAddMembers: batchAddMembers,
        updateMember: updateMember,
        removeMember: removeMember,
        endMemberInterval: endMemberInterval,
        reopenMemberInterval: reopenMemberInterval,
        purgeMemberInterval: purgeMemberInterval,

        addRanking: addRanking,
        removeRanking: removeRanking,

        stripCharacterRefs: stripCharacterRefs,
        endStintsForCharacter: endStintsForCharacter
    };

})();
