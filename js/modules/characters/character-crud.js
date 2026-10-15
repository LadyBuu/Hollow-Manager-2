/**
 * js/modules/characters/character-crud.js - Character CRUD Operations
 * Path: js/modules/characters/character-crud.js
 *
 * WHAT THIS OWNS:
 *   - Character save (create + update).
 *   - Character delete, deleteAll.
 *   - Child creation via SocialChildFactory.
 *   - Filler flag mutation.
 *   - Class-scoped role mutation (setInstructorForClass).
 *   - Career-status mutations (applyCareerStatusTimeline,
 *     setCareerTransition).
 *   - Death cascade into professional teams.
 *   - Career-transition cascade into professional teams.
 *
 * WHAT THIS DOES NOT OWN:
 *   - classIds, disciplineIds, parentIds, eliminations,
 *     eliminatedWeeks. Preserved by save, but not originated here.
 *   - Death cascade implementation. Delegates to
 *     TeamCore.endStintsForCharacter.
 *   - Career-transition cascade implementation. Same.
 *   - UI. No notifications, no rendering, no DOM.
 *
 * LOAD ORDER:
 *   This module loads cleanly regardless of script order. All
 *   dependencies, including CharacterConstants, are resolved at
 *   call time. A missing module is reported the first time a
 *   mutation runs.
 *
 * MUTATION MODEL:
 *   Every mutation routes through MutationPipeline. Validation runs
 *   twice: pre-flight against window.data, then snapshot-scoped
 *   inside pipeline.validate(). The candidate is re-derived inside
 *   mutate() from the same snapshot, so the applied state never
 *   diverges from what was validated.
 *
 * PARTIAL DTO SEMANTICS:
 *   normaliseCharacterData only includes a field in its output
 *   when the field is present (not undefined) in the input DTO.
 *   Fields absent from the DTO are left unchanged in the merge
 *   performed by updateExistingCharacter.
 *
 *   A quick-edit that sends only {firstName, lastName, _editId}
 *   leaves weapons, stats, magic, personality, specialMoves,
 *   careerStatus, hp, mp, deathYear, and isFiller untouched.
 *
 *   This is the fix for a class of bugs where any absent field
 *   defaulted to empty or zero and then overwrote the stored value
 *   through Object.assign.
 *
 * CAREER TRANSITION CASCADE:
 *   Fires when the latest careerStatus entry transitions from a
 *   non-terminal status to a terminal one (retired / support /
 *   instructor). Terminal statuses end every open professional-team
 *   stint at the new entry's startYear.
 *
 *   Fired from two paths:
 *     - save()                 compares pre-save vs. post-save
 *                              latest status.
 *     - setCareerTransition()  builds the terminal entry directly
 *                              and runs the cascade.
 *
 *   Both paths converge on applyCareerTransitionCascade. Idempotent
 *   across repeated saves.
 *
 *   The previous-latest-status capture is taken inside mutate()
 *   against the snapshot, not from a pre-queue record. This is what
 *   keeps the cascade correct when an earlier queued mutation
 *   changed careerStatus.
 *
 * CAREER STATUS CLOSING:
 *   Career-status entries never carry gaps. When a new entry starts
 *   at year Y, every other entry that would otherwise be open (or
 *   that ends before Y) is closed or extended to Y.
 *
 *   Three mutation paths, one rule (closeOpenCareerEntries):
 *     - save()                        reconcile the merged
 *                                     careerStatus array before
 *                                     persisting.
 *     - setCareerTransition(id, s, Y) extend or close the
 *                                     previously-current entry to
 *                                     Y, then append the new
 *                                     terminal entry at Y.
 *     - applyCareerStatusTimeline(id, stages)
 *                                     forward-walk the incoming
 *                                     stages and fill each stage's
 *                                     endYear from the next stage's
 *                                     startYear.
 *
 *   closeOpenCareerEntries and getLatestCareerStatus agree on
 *   entries with a missing startYear: both treat the entry as
 *   having the earliest possible start, so it is "not current"
 *   relative to any other entry.
 *
 * TERMINAL STATUSES:
 *   The set of statuses that terminate a career (retired, support,
 *   instructor) comes from CharacterConstants.TERMINAL_STATUSES.
 *   Do not add statuses here; add them to the constants module.
 *
 * DELETE CASCADE:
 *   deleteCharacter removes the character from:
 *     - teams (members arrays)
 *     - every other character's parentIds
 *     - departments[].members
 *     - departments[].headId (cleared to null if the character was
 *       the head)
 *     - social.relationships (both sides)
 *     - tournaments[].participants (by characterId)
 *     - Academy stores (via AcademyCascade.characterDeleted)
 *
 *   deleteAllCharacters runs the same cascade for the whole
 *   character set, in a single mutation.
 *
 * FILLER AUTO-UNFLAG:
 *   When a filler character is saved and the merged record now
 *   contains authored content — anything
 *   CharacterStrip.hasAuthoredContent recognises as a real field —
 *   the filler flag is cleared before the strip runs.
 *
 *   The authored-content predicate is the one defined in
 *   CharacterStrip. setFillerFlag runs the same check, so a bulk
 *   flag from the modal cannot override an authored-content record.
 *
 * UPDATED AT:
 *   Every save stamps updatedAt. The stamp is applied in mutate so
 *   it is part of the atomic write.
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterQueries
 *   - window.MutationPipeline
 *   - window.IdUtils
 *   - window.CharacterConstants
 *   - window.TeamCore       (cascades; absent = cascade skipped)
 *   - window.AcademyCascade (deleteCharacter)
 *   - window.AcademyEnrolments (setInstructorForClass)
 *   - window.SocialCore     (createChild)
 *   - window.SocialChildFactory (createChild)
 *   - window.CharacterStrip (filler flag, hasAuthoredContent)
 *   - window.ValidationUtils (strict parsing; local fallback)
 */

(function() {
    'use strict';

    if (window.__characterCrudLoaded) {
        return;
    }
    window.__characterCrudLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESS - LAZY
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getMutationPipeline() { return window.MutationPipeline || null; }
    function getIdUtils() { return window.IdUtils || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getTeamCore() { return window.TeamCore || null; }
    function getAcademyCascade() { return window.AcademyCascade || null; }
    function getAcademyEnrolments() { return window.AcademyEnrolments || null; }
    function getSocialCore() { return window.SocialCore || null; }
    function getSocialChildFactory() { return window.SocialChildFactory || null; }
    function getCharacterStrip() { return window.CharacterStrip || null; }
    function getValidationUtils() { return window.ValidationUtils || null; }

    // ============================================================
    // CONSTANT ACCESSORS - LAZY
    // ============================================================

    function getStatKeys() {
        var CC = getCharacterConstants();
        if (CC && Array.isArray(CC.STAT_KEYS)) { return CC.STAT_KEYS; }
        return ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    }

    function getStatMin() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.STAT_MIN === 'number') { return CC.STAT_MIN; }
        return 1;
    }

    function getStatMax() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.STAT_MAX === 'number') { return CC.STAT_MAX; }
        return 30;
    }

    function getStatDefault() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.STAT_DEFAULT === 'number') {
            return CC.STAT_DEFAULT;
        }
        return 10;
    }

    function getMaxSpecialMoves() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_SPECIAL_MOVES === 'number') {
            return CC.MAX_SPECIAL_MOVES;
        }
        return 20;
    }

    function getMaxMoveNameLength() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_MOVE_NAME_LENGTH === 'number') {
            return CC.MAX_MOVE_NAME_LENGTH;
        }
        return 100;
    }

    function getMaxMoveDescriptionLength() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_MOVE_DESCRIPTION_LENGTH === 'number') {
            return CC.MAX_MOVE_DESCRIPTION_LENGTH;
        }
        return 500;
    }

    function getMaxWeapons() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_WEAPONS === 'number') {
            return CC.MAX_WEAPONS;
        }
        return 50;
    }

    function getMaxWeaponNameLength() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_WEAPON_NAME_LENGTH === 'number') {
            return CC.MAX_WEAPON_NAME_LENGTH;
        }
        return 100;
    }

    function getMaxWeaponNotesLength() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_WEAPON_NOTES_LENGTH === 'number') {
            return CC.MAX_WEAPON_NOTES_LENGTH;
        }
        return 300;
    }

    function getDefaultWeaponType() {
        var CC = getCharacterConstants();
        if (CC && CC.DEFAULT_WEAPON_TYPE) {
            return CC.DEFAULT_WEAPON_TYPE;
        }
        return 'sharp';
    }

    function getHPMax() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.HP_MAX === 'number') { return CC.HP_MAX; }
        return 999;
    }

    function getMPMax() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MP_MAX === 'number') { return CC.MP_MAX; }
        return 200;
    }

    function getTerminalStatuses() {
        var CC = getCharacterConstants();
        if (CC && Array.isArray(CC.TERMINAL_STATUSES)) {
            return CC.TERMINAL_STATUSES;
        }
        return ['retired', 'support', 'instructor'];
    }

    function isTerminalStatus(status) {
        if (!status || typeof status !== 'string') { return false; }
        var normalised = status.toLowerCase().trim();
        var formerIdx = normalised.indexOf(' (former)');
        if (formerIdx !== -1) {
            normalised = normalised.substring(0, formerIdx).trim();
        }
        var terminal = getTerminalStatuses();
        return terminal.indexOf(normalised) !== -1;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CQ || typeof CQ.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        var MP = getMutationPipeline();
        if (!MP || typeof MP.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        var IU = getIdUtils();
        if (!IU || typeof IU.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        var CC = getCharacterConstants();
        if (!CC) {
            missing.push('CharacterConstants');
        }

        if (missing.length > 0) {
            console.warn(
                'CharacterCRUD: Missing dependencies:',
                missing.join(', ')
            );
            return false;
        }
        return true;
    }

    // ============================================================
    // HELPERS - strict parsing
    // ============================================================

    function parseYearInt(value) {
        var VU = getValidationUtils();
        if (VU && typeof VU.parseStrictPositiveInteger === 'function') {
            return VU.parseStrictPositiveInteger(value);
        }
        if (value === undefined || value === null || value === '') {
            return null;
        }
        if (typeof value === 'number') {
            if (Number.isSafeInteger(value) && value >= 1) {
                return value;
            }
            return null;
        }
        var str = String(value).trim();
        if (str === '' || !/^\d+$/.test(str)) {
            return null;
        }
        var n = parseInt(str, 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        if (typeof value === 'string') { return value.trim(); }
        if (typeof value === 'number' && isFinite(value)) {
            return String(value);
        }
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        return '';
    }

    function getCurrentYear() {
        if (window.data && typeof window.data.currentYear === 'number') {
            return window.data.currentYear;
        }
        return new Date().getFullYear();
    }

    function computeCachedDeceased(data) {
        var deathYear = parseYearInt(data.deathYear);
        if (deathYear === null) { return false; }
        return deathYear <= getCurrentYear();
    }

    function invalidateCharacterIndex() {
        var CQ = getCharacterQueries();
        if (!CQ ||
            typeof CQ.invalidateCharacterIndex !== 'function') {
            return;
        }
        try {
            CQ.invalidateCharacterIndex();
        } catch (e) {
            console.warn(
                '[CharacterCRUD] invalidateCharacterIndex threw:', e
            );
        }
    }

    function runDeathCascade(data, charId, deathYear) {
        var TeamCore = getTeamCore();
        if (!TeamCore ||
            typeof TeamCore.endStintsForCharacter !== 'function') {
            console.warn(
                '[CharacterCRUD] Death cascade skipped for character ' +
                charId + ': TeamCore.endStintsForCharacter unavailable.'
            );
            return null;
        }
        return TeamCore.endStintsForCharacter(data, charId, deathYear);
    }

    function applyFillerStripIfSet(normalised, isFiller) {
        if (!isFiller) { return normalised; }

        var Strip = getCharacterStrip();
        if (!Strip ||
            typeof Strip.stripEmptyFields !== 'function') {
            console.warn(
                '[CharacterCRUD] CharacterStrip.stripEmptyFields ' +
                'unavailable; filler saved unstripped.'
            );
            return normalised;
        }

        var stripped = Strip.stripEmptyFields(normalised);
        stripped.isFiller = true;
        return stripped;
    }

    /**
     * Does the merged record contain authored content?
     * Delegates to CharacterStrip.hasAuthoredContent when it is
     * loaded. Falls back to a local conservative check when the
     * module is absent.
     */
    function recordHasAuthoredContent(record) {
        if (!record || typeof record !== 'object') { return false; }

        var Strip = getCharacterStrip();
        if (Strip && typeof Strip.hasAuthoredContent === 'function') {
            try {
                return Strip.hasAuthoredContent(record) === true;
            } catch (e) {
                console.warn(
                    '[CharacterCRUD] hasAuthoredContent threw; ' +
                    'falling back to local check:', e
                );
            }
        }

        // ---- Local fallback ----
        var statDefault = getStatDefault();

        var bioFields = [
            'appearanceNotes', 'notes', 'combatNotes', 'specialty',
            'eyes', 'hair', 'skin', 'height', 'weight', 'build',
            'attraction', 'sexuality', 'gender', 'middleName',
            'nickname', 'alias', 'deathCause'
        ];
        for (var b = 0; b < bioFields.length; b++) {
            var bv = record[bioFields[b]];
            if (typeof bv === 'string' && bv.trim() !== '') {
                return true;
            }
        }

        if (record.personality &&
            typeof record.personality === 'object') {
            var pKeys = Object.keys(record.personality);
            for (var p = 0; p < pKeys.length; p++) {
                var pv = record.personality[pKeys[p]];
                if (typeof pv === 'string' && pv.trim() !== '') {
                    return true;
                }
                if (typeof pv === 'number' && pv !== 0) {
                    return true;
                }
                if (Array.isArray(pv) && pv.length > 0) {
                    return true;
                }
                if (pv && typeof pv === 'object' &&
                    !Array.isArray(pv) &&
                    Object.keys(pv).length > 0) {
                    return true;
                }
            }
        }

        if (record.stats && typeof record.stats === 'object') {
            var sKeys = Object.keys(record.stats);
            for (var s = 0; s < sKeys.length; s++) {
                if (record.stats[sKeys[s]] !== statDefault) {
                    return true;
                }
            }
        }

        if (record.magic && typeof record.magic === 'object') {
            var mKeys = Object.keys(record.magic);
            for (var m = 0; m < mKeys.length; m++) {
                var mv = record.magic[mKeys[m]];
                if (typeof mv === 'number' && mv > 0) {
                    return true;
                }
            }
        }

        if (typeof record.hp === 'number' && record.hp > 0) {
            return true;
        }
        if (typeof record.mp === 'number' && record.mp > 0) {
            return true;
        }

        if (Array.isArray(record.weapons) &&
            record.weapons.length > 0) {
            return true;
        }

        if (record.specialMoves &&
            typeof record.specialMoves === 'object') {
            var phys = record.specialMoves.physical;
            var magi = record.specialMoves.magical;
            if (Array.isArray(phys) && phys.length > 0) {
                return true;
            }
            if (Array.isArray(magi) && magi.length > 0) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // CAREER TRANSITION HELPERS
    // ============================================================

    /**
     * Latest careerStatus entry's normalised status string.
     * Highest startYear wins. Missing startYear is treated as
     * EARLIEST (sorted last), matching closeOpenCareerEntries.
     * Returns '' when the array is empty or all entries are
     * malformed.
     */
    function getLatestCareerStatus(careerStatus) {
        if (!Array.isArray(careerStatus) || careerStatus.length === 0) {
            return '';
        }

        var latest = null;
        var latestYear = -Infinity;
        var latestIndex = -1;

        for (var i = 0; i < careerStatus.length; i++) {
            var entry = careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var rawStatus = entry.status !== undefined &&
                entry.status !== null
                ? String(entry.status).trim().toLowerCase()
                : '';
            if (rawStatus === '') { continue; }

            var formerIdx = rawStatus.indexOf(' (former)');
            if (formerIdx !== -1) {
                rawStatus = rawStatus.substring(0, formerIdx).trim();
            }

            var year = parseYearInt(entry.startYear);
            if (year === null) { year = -Infinity; }

            if (year > latestYear ||
                (year === latestYear && i > latestIndex)) {
                latest = rawStatus;
                latestYear = year;
                latestIndex = i;
            }
        }

        return latest || '';
    }

    function getLatestCareerStatusYear(careerStatus) {
        if (!Array.isArray(careerStatus) || careerStatus.length === 0) {
            return null;
        }

        var latestYear = -Infinity;
        var latestIndex = -1;

        for (var i = 0; i < careerStatus.length; i++) {
            var entry = careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }
            if (entry.status === undefined ||
                entry.status === null ||
                String(entry.status).trim() === '') {
                continue;
            }

            var year = parseYearInt(entry.startYear);
            if (year === null) { year = -Infinity; }

            if (year > latestYear ||
                (year === latestYear && i > latestIndex)) {
                latestYear = year;
                latestIndex = i;
            }
        }

        if (latestYear === -Infinity) { return null; }
        return latestYear;
    }

    function isCareerTransitionStatus(status) {
        return isTerminalStatus(status);
    }

    /**
     * Reconcile a career-status array so no two entries are open and
     * no gaps exist between consecutive entries.
     *
     * RULES:
     *   - Every entry except the one with the latest startYear gets
     *     its endYear set to the next entry's startYear, replacing
     *     any earlier endYear.
     *   - The latest-start entry is left with whatever endYear it
     *     already had.
     *   - Entries with a missing startYear are treated as earliest
     *     and sorted to the front.
     *   - Malformed entries are left untouched in place.
     *   - The array is sorted in place by startYear ascending, ties
     *     broken by original index (stable).
     *
     * MUTATES THE PASSED ARRAY.
     */
    function closeOpenCareerEntries(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return entries;
        }

        var indexed = [];
        for (var i = 0; i < entries.length; i++) {
            indexed.push({ entry: entries[i], idx: i });
        }

        indexed.sort(function(a, b) {
            var ay = parseYearInt(a.entry && a.entry.startYear);
            var by = parseYearInt(b.entry && b.entry.startYear);
            if (ay === null) { ay = -Infinity; }
            if (by === null) { by = -Infinity; }
            if (ay !== by) { return ay - by; }
            return a.idx - b.idx;
        });

        for (var s = 0; s < indexed.length; s++) {
            entries[s] = indexed[s].entry;
        }

        for (var k = 0; k < entries.length - 1; k++) {
            var current = entries[k];
            var next = entries[k + 1];

            if (!current || typeof current !== 'object') { continue; }
            if (!next || typeof next !== 'object') { continue; }

            var nextStart = parseYearInt(next.startYear);
            if (nextStart === null) { continue; }

            var currentEnd = parseYearInt(current.endYear);
            if (currentEnd === null || currentEnd < nextStart) {
                current.endYear = String(nextStart);
            }
        }

        return entries;
    }

    /**
     * Run the career-transition → team cascade when the transition
     * qualifies. The previousLatestStatus is read from the snapshot
     * inside mutate, so this function is called with that value.
     */
    function applyCareerTransitionCascade(
        data,
        charId,
        previousLatestStatus,
        careerStatus
    ) {
        var result = {
            fired: false,
            reason: '',
            year: null,
            stintsEnded: 0,
            teamsTouched: 0
        };

        var newLatest = getLatestCareerStatus(careerStatus);

        if (!isCareerTransitionStatus(newLatest)) {
            result.reason = 'not-a-transition-status';
            return result;
        }

        if (isCareerTransitionStatus(previousLatestStatus)) {
            result.reason = 'already-transitioned';
            return result;
        }

        var year = getLatestCareerStatusYear(careerStatus);
        if (year === null) {
            result.reason = 'no-year';
            return result;
        }

        result.year = year;

        var TeamCore = getTeamCore();
        if (!TeamCore ||
            typeof TeamCore.endStintsForCharacter !== 'function') {
            result.reason = 'no-team-core';
            console.warn(
                '[CharacterCRUD] Career-transition cascade skipped ' +
                'for character ' + charId + ': TeamCore.endStintsForCharacter ' +
                'unavailable.'
            );
            return result;
        }

        var cascadeResult = TeamCore.endStintsForCharacter(
            data, charId, year
        );

        result.fired = true;
        result.reason = 'transitioned';
        if (cascadeResult && typeof cascadeResult === 'object') {
            result.stintsEnded =
                typeof cascadeResult.stintsEnded === 'number'
                    ? cascadeResult.stintsEnded
                    : 0;
            result.teamsTouched =
                typeof cascadeResult.teamsTouched === 'number'
                    ? cascadeResult.teamsTouched
                    : 0;
        }

        return result;
    }

    // ============================================================
    // WEAPON NORMALISATION
    // ============================================================

    function normaliseWeapon(weapon) {
        if (!weapon ||
            typeof weapon !== 'object' ||
            Array.isArray(weapon)) {
            return null;
        }

        var IU = getIdUtils();
        var id = (typeof weapon.id === 'string' && weapon.id)
            ? weapon.id
            : (IU && typeof IU.generateId === 'function'
                ? IU.generateId('weapon')
                : 'weapon_' + Date.now() + '_' +
                    Math.random().toString(36).slice(2, 8));

        var maxName = getMaxWeaponNameLength();
        var maxNotes = getMaxWeaponNotesLength();

        var name = typeof weapon.name === 'string'
            ? weapon.name.trim() : '';
        if (name.length > maxName) {
            name = name.slice(0, maxName);
        }

        var type = typeof weapon.type === 'string' && weapon.type
            ? weapon.type
            : getDefaultWeaponType();

        var CC = getCharacterConstants();
        if (CC &&
            typeof CC.isValidWeaponType === 'function') {
            if (!CC.isValidWeaponType(type)) {
                type = getDefaultWeaponType();
            }
        }

        var notes = typeof weapon.notes === 'string'
            ? weapon.notes.trim() : '';
        if (notes.length > maxNotes) {
            notes = notes.slice(0, maxNotes);
        }

        return { id: id, name: name, type: type, notes: notes };
    }

    function normaliseWeapons(weapons) {
        if (!Array.isArray(weapons)) { return []; }

        var maxWeapons = getMaxWeapons();
        var IU = getIdUtils();

        var result = [];
        var seenIds = Object.create(null);

        for (var i = 0; i < weapons.length; i++) {
            var w = normaliseWeapon(weapons[i]);
            if (!w) { continue; }
            if (!w.name) { continue; }

            if (seenIds[w.id]) {
                w.id = (IU && typeof IU.generateId === 'function')
                    ? IU.generateId('weapon')
                    : 'weapon_' + Date.now() + '_' +
                        Math.random().toString(36).slice(2, 8);
            }
            seenIds[w.id] = true;

            result.push(w);
            if (result.length >= maxWeapons) { break; }
        }

        return result;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateCharacter(charData) {
        if (!charData.firstName || String(charData.firstName).trim() === '') {
            return {
                valid: false,
                message: 'First name is required.'
            };
        }
        if (!charData.lastName || String(charData.lastName).trim() === '') {
            return {
                valid: false,
                message: 'Last name is required.'
            };
        }

        var hasDeathYear = charData.deathYear !== undefined &&
            charData.deathYear !== null &&
            String(charData.deathYear).trim() !== '';

        if (hasDeathYear) {
            var year = parseYearInt(charData.deathYear);
            if (year === null) {
                return {
                    valid: false,
                    message: 'Death Year must be a positive integer.'
                };
            }
        }

        if (charData.deathAge !== undefined &&
            charData.deathAge !== null &&
            String(charData.deathAge).trim() !== '') {
            var age = parseInt(charData.deathAge, 10);
            if (isNaN(age) || age < 0 || age > 999) {
                return {
                    valid: false,
                    message: 'Death Age must be a valid age.'
                };
            }
        }

        if (charData.deathWeek !== undefined &&
            charData.deathWeek !== null &&
            String(charData.deathWeek).trim() !== '') {
            var week = parseInt(charData.deathWeek, 10);
            if (isNaN(week) || week < 1 || week > 52) {
                return {
                    valid: false,
                    message: 'Death Week must be between 1 and 52.'
                };
            }
        }

        var hpMax = getHPMax();
        var mpMax = getMPMax();

        if (charData.hp !== undefined &&
            charData.hp !== null &&
            charData.hp !== '') {
            var hp = Number(charData.hp);
            if (isNaN(hp) || hp < 0 || hp > hpMax) {
                return {
                    valid: false,
                    message: 'HP must be between 0 and ' +
                        hpMax + '.'
                };
            }
        }
        if (charData.mp !== undefined &&
            charData.mp !== null &&
            charData.mp !== '') {
            var mp = Number(charData.mp);
            if (isNaN(mp) || mp < 0 || mp > mpMax) {
                return {
                    valid: false,
                    message: 'MP must be between 0 and ' +
                        mpMax + '.'
                };
            }
        }

        var maxWeapons = getMaxWeapons();
        var maxWeaponName = getMaxWeaponNameLength();
        var maxWeaponNotes = getMaxWeaponNotesLength();

        if (charData.weapons !== undefined) {
            if (!Array.isArray(charData.weapons)) {
                return {
                    valid: false,
                    message: 'Weapons must be an array.'
                };
            }
            if (charData.weapons.length > maxWeapons) {
                return {
                    valid: false,
                    message: 'Too many weapons. Maximum is ' +
                        maxWeapons + '.'
                };
            }
            for (var i = 0; i < charData.weapons.length; i++) {
                var w = charData.weapons[i];
                if (!w ||
                    typeof w !== 'object' ||
                    Array.isArray(w)) {
                    return {
                        valid: false,
                        message: 'Weapon entry at index ' + i +
                            ' is invalid.'
                    };
                }
                if (w.name && String(w.name).length > maxWeaponName) {
                    return {
                        valid: false,
                        message: 'Weapon name exceeds maximum length.'
                    };
                }
                if (w.notes && String(w.notes).length > maxWeaponNotes) {
                    return {
                        valid: false,
                        message: 'Weapon notes exceed maximum length.'
                    };
                }

                var CC = getCharacterConstants();
                if (w.type &&
                    CC &&
                    typeof CC.isValidWeaponType === 'function') {
                    if (!CC.isValidWeaponType(w.type)) {
                        return {
                            valid: false,
                            message: 'Weapon type "' + w.type +
                                '" is not recognised.'
                        };
                    }
                }
            }
        }

        var maxSpecialMoves = getMaxSpecialMoves();
        var maxMoveName = getMaxMoveNameLength();
        var maxMoveDesc = getMaxMoveDescriptionLength();

        var physicalMoves = charData.specialMoves &&
            charData.specialMoves.physical
            ? charData.specialMoves.physical : [];
        var magicalMoves = charData.specialMoves &&
            charData.specialMoves.magical
            ? charData.specialMoves.magical : [];

        if (physicalMoves.length > maxSpecialMoves) {
            return {
                valid: false,
                message: 'Too many physical special moves.'
            };
        }
        if (magicalMoves.length > maxSpecialMoves) {
            return {
                valid: false,
                message: 'Too many magical special moves.'
            };
        }

        var allMoves = physicalMoves.concat(magicalMoves);
        for (var j = 0; j < allMoves.length; j++) {
            var move = allMoves[j];
            if (move.name &&
                String(move.name).length > maxMoveName) {
                return {
                    valid: false,
                    message: 'Move name exceeds maximum length.'
                };
            }
            if (move.description &&
                String(move.description).length > maxMoveDesc) {
                return {
                    valid: false,
                    message: 'Move description exceeds maximum length.'
                };
            }
        }

        var statKeys = getStatKeys();
        var statMin = getStatMin();
        var statMax = getStatMax();
        var stats = charData.stats || {};
        for (var k = 0; k < statKeys.length; k++) {
            var key = statKeys[k];
            var val = stats[key];
            if (val === undefined || val === null) { continue; }
            if (typeof val !== 'number' ||
                isNaN(val) ||
                val < statMin ||
                val > statMax) {
                return {
                    valid: false,
                    message: 'Stat "' + key + '" must be between ' +
                        statMin + ' and ' + statMax + '.'
                };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // NORMALISATION
    // ============================================================
    //
    // PARTIAL DTO RULE: a field is included in the output object
    // only when it is present (not undefined) in the input. Fields
    // absent from the input are NOT defaulted here; the caller's
    // merge in updateExistingCharacter preserves the stored value.
    //
    // The only fields that are unconditionally emitted are:
    //   - firstName, lastName (required by validation)
    //   - deceased (recomputed cache)
    //   - updatedAt (stamped at save time, applied in mutate)

    function normaliseCharacterData(charData) {
        if (!charData || typeof charData !== 'object') {
            throw new Error(
                'normaliseCharacterData: input must be an object.'
            );
        }

        var data = {};

        // ---- Always-included required fields ----
        data.firstName = safeString(charData.firstName);
        data.lastName = safeString(charData.lastName);

        // ---- Optional string fields: only when present ----
        var optionalStrings = [
            'middleName', 'nickname', 'alias',
            'gender', 'birthYear',
            'eyes', 'hair', 'skin', 'height', 'weight', 'build',
            'appearanceNotes', 'specialty',
            'attraction', 'sexuality',
            'notes', 'combatNotes',
            'deathYear', 'deathCause'
        ];

        for (var i = 0; i < optionalStrings.length; i++) {
            var key = optionalStrings[i];
            if (charData[key] !== undefined) {
                data[key] = safeString(charData[key]);
            }
        }

        // ---- previousNames: only when present ----
        if (charData.previousNames !== undefined) {
            if (Array.isArray(charData.previousNames)) {
                data.previousNames = charData.previousNames
                    .map(function(n) { return safeString(n); })
                    .filter(function(n) { return n !== ''; });
            } else {
                data.previousNames = [];
            }
        }

        // ---- displayParts: only when present ----
        if (charData.displayParts !== undefined) {
            var incomingDp = charData.displayParts &&
                typeof charData.displayParts === 'object'
                ? charData.displayParts
                : null;

            data.displayParts = {
                first:    incomingDp ? incomingDp.first    !== false : true,
                middle:   incomingDp ? incomingDp.middle   !== false : true,
                last:     incomingDp ? incomingDp.last     !== false : true,
                nickname: incomingDp ? incomingDp.nickname === true  : false,
                alias:    incomingDp ? incomingDp.alias    === true  : false
            };
        }

        if (charData.nameFormat !== undefined) {
            data.nameFormat = charData.nameFormat || 'firstlast';
        }

        if (charData.graduatingClassId !== undefined) {
            data.graduatingClassId = charData.graduatingClassId || null;
        }
        if (charData.graduatingClassInstructor !== undefined) {
            data.graduatingClassInstructor =
                charData.graduatingClassInstructor === true;
        }

        if (charData.isFiller !== undefined) {
            data.isFiller = charData.isFiller === true;
        }

        // ---- stats: only when present ----
        if (charData.stats !== undefined) {
            var statKeys = getStatKeys();
            var statMin = getStatMin();
            var statMax = getStatMax();
            var statDefault = getStatDefault();

            data.stats = {};
            for (var s = 0; s < statKeys.length; s++) {
                var skey = statKeys[s];
                var val = charData.stats &&
                    charData.stats[skey] !== undefined
                    ? charData.stats[skey]
                    : statDefault;
                var numeric = Number(val);
                if (isNaN(numeric)) { numeric = statDefault; }
                data.stats[skey] = Math.max(
                    statMin,
                    Math.min(statMax, Math.round(numeric))
                );
            }
        }

        // ---- magic: only when present ----
        if (charData.magic !== undefined) {
            data.magic = {};
            var MC = window.MagicConstants;
            var magicKeys = MC && typeof MC.getTypeKeys === 'function'
                ? MC.getTypeKeys()
                : Object.keys(charData.magic || {});
            var magicMax = MC && typeof MC.MAGIC_MAX === 'number'
                ? MC.MAGIC_MAX
                : 10;
            for (var m = 0; m < magicKeys.length; m++) {
                var mKey = magicKeys[m];
                var rawMagic = charData.magic &&
                    charData.magic[mKey] !== undefined
                    ? Number(charData.magic[mKey])
                    : 0;
                if (isNaN(rawMagic)) { rawMagic = 0; }
                data.magic[mKey] = Math.max(
                    0,
                    Math.min(magicMax, Math.round(rawMagic))
                );
            }
        }

        // ---- hp / mp: only when present ----
        var hpMax = getHPMax();
        var mpMax = getMPMax();

        if (charData.hp !== undefined) {
            var rawHP = charData.hp !== null && charData.hp !== ''
                ? Number(charData.hp)
                : 0;
            if (isNaN(rawHP) || rawHP < 0) { rawHP = 0; }
            if (rawHP > hpMax) { rawHP = hpMax; }
            data.hp = Math.round(rawHP);
        }

        if (charData.mp !== undefined) {
            var rawMP = charData.mp !== null && charData.mp !== ''
                ? Number(charData.mp)
                : 0;
            if (isNaN(rawMP) || rawMP < 0) { rawMP = 0; }
            if (rawMP > mpMax) { rawMP = mpMax; }
            data.mp = Math.round(rawMP);
        }

        // ---- weapons: only when present ----
        if (charData.weapons !== undefined) {
            data.weapons = normaliseWeapons(charData.weapons);
        }

        // ---- specialMoves: only when present ----
        if (charData.specialMoves !== undefined) {
            data.specialMoves = {
                physical: Array.isArray(
                    charData.specialMoves &&
                    charData.specialMoves.physical
                )
                    ? charData.specialMoves.physical.slice()
                    : [],
                magical: Array.isArray(
                    charData.specialMoves &&
                    charData.specialMoves.magical
                )
                    ? charData.specialMoves.magical.slice()
                    : []
            };
        }

        // ---- careerStatus: only when present ----
        if (charData.careerStatus !== undefined) {
            data.careerStatus = Array.isArray(charData.careerStatus)
                ? charData.careerStatus.slice()
                : [];
        }

        // ---- personality: only when present ----
        if (charData.personality !== undefined) {
            data.personality = charData.personality
                ? Object.assign({}, charData.personality)
                : {};
        }

        // ---- deathWeek / deathAge: only when present ----
        if (charData.deathWeek !== undefined) {
            data.deathWeek = safeString(charData.deathWeek);
        }

        if (charData.deathAge !== undefined &&
            charData.deathAge !== null &&
            String(charData.deathAge).trim() !== '') {
            data.deathAge = safeString(charData.deathAge);
        } else if (charData.deathAge !== undefined) {
            data.deathAge = '';
        }

        // ---- Always-included cache: deceased ----
        var lookupRecord = charData;
        if (data.deathYear !== undefined) {
            lookupRecord = data;
        }
        data.deceased = computeCachedDeceased(lookupRecord);

        return data;
    }

    // ============================================================
    // SAVE
    // ============================================================

    function save(formData) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        if (!formData || typeof formData !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Form data is required.'
            });
        }

        var normalised;
        try {
            normalised = normaliseCharacterData(formData);
        } catch (e) {
            return Promise.resolve({
                success: false,
                message: 'Failed to normalise character data: ' +
                    (e && e.message ? e.message : String(e))
            });
        }

        var validation = validateCharacter(normalised);
        if (!validation.valid) {
            return Promise.resolve({
                success: false,
                message: validation.message
            });
        }

        var editId = formData._editId || null;
        var isEditing = editId !== null &&
            editId !== undefined &&
            editId !== '';

        var CharacterQueries = getCharacterQueries();
        var name = normalised.firstName + ' ' + normalised.lastName;

        if (isEditing) {
            var existingChar = CharacterQueries.getCharacterById(editId);
            if (!existingChar) {
                return Promise.resolve({
                    success: false,
                    message: 'Character not found.'
                });
            }
            name = CharacterQueries.getDisplayName(existingChar);
        }

        return getMutationPipeline().performMutation({
            validate: function() {
                var reValidation = validateCharacter(normalised);
                if (!reValidation.valid) {
                    return {
                        valid: false,
                        message: reValidation.message
                    };
                }
                if (isEditing) {
                    var currentChar =
                        CharacterQueries.getCharacterById(editId);
                    if (!currentChar) {
                        return {
                            valid: false,
                            message: 'Character no longer exists.'
                        };
                    }
                }
                return { valid: true };
            },

            mutate: function(data) {
                var result;
                if (isEditing) {
                    result = updateExistingCharacter(
                        editId, normalised, data
                    );
                } else {
                    result = createNewCharacter(normalised, data);
                }
                if (!result.success) {
                    throw new Error(
                        result.error || 'Failed to save character.'
                    );
                }

                // The previous-latest-status is read from the
                // snapshot, not from a pre-queue capture. This is
                // what keeps the cascade correct under queued
                // mutations.
                var previousLatestStatus = result.previousLatestStatus || '';

                var cascade = applyCareerTransitionCascade(
                    data,
                    result.id,
                    previousLatestStatus,
                    result.character
                        ? result.character.careerStatus
                        : null
                );

                return {
                    id: result.id,
                    character: result.character,
                    isNew: !isEditing,
                    careerTransition: cascade
                };
            },

            logMessage: function(mutationResult) {
                var base = isEditing
                    ? 'Updated character: ' + name
                    : 'Created character: ' + name;

                var cascade = mutationResult &&
                    mutationResult.careerTransition;
                if (cascade && cascade.fired &&
                    cascade.stintsEnded > 0) {
                    base += ' (career transition; ended ' +
                        cascade.stintsEnded + ' stint' +
                        (cascade.stintsEnded === 1 ? '' : 's') +
                        ' at year ' + cascade.year + ')';
                }
                return base;
            },

            successMessage: function() {
                return isEditing
                    ? 'Character updated successfully!'
                    : 'Character created successfully!';
            },

            failureMessage: 'Failed to save character.'
        });
    }

    // ============================================================
    // UPDATE / CREATE
    // ============================================================

    function updateExistingCharacter(editId, normalised, data) {
        var index = data.characters.findIndex(function(c) {
            return c && String(c.id) === String(editId);
        });

        if (index === -1) {
            return {
                success: false,
                error: 'Character not found in data store.'
            };
        }

        var current = data.characters[index];
        var previousLatestStatus = getLatestCareerStatus(
            current.careerStatus
        );

        var preserved = {
            id: current.id,
            createdAt: current.createdAt,
            classIds: Array.isArray(current.classIds)
                ? current.classIds.slice() : [],
            parentIds: Array.isArray(current.parentIds)
                ? current.parentIds.slice() : [],
            eliminations: Array.isArray(current.eliminations)
                ? current.eliminations.slice() : [],
            eliminatedWeeks: Array.isArray(current.eliminatedWeeks)
                ? current.eliminatedWeeks.slice() : []
        };

        if (Array.isArray(current.disciplineIds)) {
            preserved.disciplineIds = current.disciplineIds.slice();
        }

        if (current.mode !== undefined) {
            preserved.mode = current.mode;
        }

        // Merge: current as base, normalised over it (only the
        // fields the DTO actually provided), preserved over both.
        var merged = Object.assign({}, current, normalised, preserved);

        // ---- Career-status reconciliation ----
        if (Array.isArray(merged.careerStatus)) {
            merged.careerStatus = merged.careerStatus.slice();
            closeOpenCareerEntries(merged.careerStatus);
        }

        // ---- Auto-unflag filler on authored content ----
        var isFiller = merged.isFiller === true;

        if (isFiller && recordHasAuthoredContent(merged)) {
            merged.isFiller = false;
            isFiller = false;
        }

        var finalRecord = applyFillerStripIfSet(merged, isFiller);

        // Apply the final record's keys back onto the live object
        // so any external references to `current` remain valid.
        var existingKeys = Object.keys(current);
        for (var ek = 0; ek < existingKeys.length; ek++) {
            var ekey = existingKeys[ek];
            if (!Object.prototype.hasOwnProperty.call(
                finalRecord, ekey
            )) {
                delete current[ekey];
            }
        }

        var mergedKeys = Object.keys(finalRecord);
        for (var mk = 0; mk < mergedKeys.length; mk++) {
            current[mergedKeys[mk]] = finalRecord[mergedKeys[mk]];
        }

        current.updatedAt = new Date().toISOString();

        invalidateCharacterIndex();

        var nextDeathYear = parseYearInt(current.deathYear);
        if (nextDeathYear !== null) {
            runDeathCascade(data, current.id, nextDeathYear);
        }

        return {
            success: true,
            id: current.id,
            character: current,
            previousLatestStatus: previousLatestStatus
        };
    }

    function createNewCharacter(normalised, data) {
        var IU = getIdUtils();
        var id = IU.generateId('char');

        var newChar = Object.assign({}, normalised, {
            id: id,
            classIds: [],
            parentIds: [],
            hp: typeof normalised.hp === 'number' ? normalised.hp : 0,
            mp: typeof normalised.mp === 'number' ? normalised.mp : 0,
            weapons: Array.isArray(normalised.weapons)
                ? normalised.weapons : [],
            combatNotes: normalised.combatNotes || '',
            eliminations: [],
            eliminatedWeeks: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        // ---- Career-status reconciliation ----
        if (Array.isArray(newChar.careerStatus)) {
            newChar.careerStatus = newChar.careerStatus.slice();
            closeOpenCareerEntries(newChar.careerStatus);
        }

        // ---- Auto-unflag filler on authored content ----
        var isFiller = newChar.isFiller === true;

        if (isFiller && recordHasAuthoredContent(newChar)) {
            newChar.isFiller = false;
            isFiller = false;
        }

        newChar = applyFillerStripIfSet(newChar, isFiller);

        data.characters.push(newChar);
        invalidateCharacterIndex();

        var nextDeathYear = parseYearInt(newChar.deathYear);
        if (nextDeathYear !== null) {
            runDeathCascade(data, id, nextDeathYear);
        }

        return {
            success: true,
            id: id,
            character: newChar,
            previousLatestStatus: ''
        };
    }

    // ============================================================
    // SET FILLER FLAG
    // ============================================================

    function setFillerFlag(ids, value) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        if (!Array.isArray(ids)) {
            return Promise.resolve({
                success: false,
                message: 'IDs must be an array.'
            });
        }

        if (typeof value !== 'boolean') {
            return Promise.resolve({
                success: false,
                message: 'Value must be true or false.'
            });
        }

        var idList = [];
        var seen = Object.create(null);
        for (var i = 0; i < ids.length; i++) {
            if (!ids[i]) { continue; }
            var s = String(ids[i]);
            if (seen[s]) { continue; }
            seen[s] = true;
            idList.push(s);
        }

        if (idList.length === 0) {
            return Promise.resolve({
                success: true,
                data: { updated: 0, stripped: 0, skipped: 0 }
            });
        }

        return getMutationPipeline().performMutation({
            validate: function(data) {
                if (!data || !Array.isArray(data.characters)) {
                    return {
                        valid: false,
                        message: 'Character store is not available.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is malformed.');
                }

                var Strip = getCharacterStrip();
                var now = new Date().toISOString();

                var updated = 0;
                var stripped = 0;
                var skipped = 0;

                for (var i = 0; i < idList.length; i++) {
                    var id = idList[i];
                    var char = null;
                    for (var j = 0; j < data.characters.length; j++) {
                        var c = data.characters[j];
                        if (c && String(c.id) === id) {
                            char = c;
                            break;
                        }
                    }
                    if (!char) { continue; }

                    // When flagging as filler, enforce the same
                    // authored-content check that save runs. A
                    // character with authored content is skipped.
                    if (value === true &&
                        recordHasAuthoredContent(char)) {
                        skipped++;
                        continue;
                    }

                    char.isFiller = value;
                    char.updatedAt = now;
                    updated++;

                    if (value === true &&
                        Strip &&
                        typeof Strip.stripEmptyFields === 'function') {
                        var reduced = Strip.stripEmptyFields(char);
                        reduced.isFiller = true;

                        var existingKeys = Object.keys(char);
                        for (var ek = 0;
                             ek < existingKeys.length; ek++) {
                            var k = existingKeys[ek];
                            if (!Object.prototype.hasOwnProperty.call(
                                reduced, k
                            )) {
                                delete char[k];
                            }
                        }
                        var rKeys = Object.keys(reduced);
                        for (var rk = 0;
                             rk < rKeys.length; rk++) {
                            char[rKeys[rk]] = reduced[rKeys[rk]];
                        }
                        stripped++;
                    }
                }

                invalidateCharacterIndex();

                return {
                    updated: updated,
                    stripped: stripped,
                    skipped: skipped
                };
            },

            logMessage: function(result) {
                var verb = value ? 'Flagged' : 'Unflagged';
                var msg = verb + ' ' + result.updated +
                    ' character' + (result.updated === 1 ? '' : 's') +
                    ' as filler';
                if (value && result.stripped > 0) {
                    msg += ' (' + result.stripped + ' stripped)';
                }
                if (value && result.skipped > 0) {
                    msg += ' (' + result.skipped +
                        ' skipped: authored content)';
                }
                return msg + '.';
            },

            successMessage: function(result) {
                if (value) {
                    var msg = 'Flagged ' + result.updated +
                        ' character' +
                        (result.updated === 1 ? '' : 's') +
                        ' as filler.';
                    if (result.skipped > 0) {
                        msg += ' ' + result.skipped +
                            ' skipped (authored content).';
                    }
                    return msg;
                }
                return 'Cleared filler flag on ' + result.updated +
                    ' character' +
                    (result.updated === 1 ? '' : 's') + '.';
            },

            failureMessage: 'Failed to update filler flag.'
        });
    }

    // ============================================================
    // CREATE CHILD
    // ============================================================

    function createChild(parentAId, parentBId, options) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        options = options || {};

        if (!parentAId || !parentBId) {
            return Promise.resolve({
                success: false,
                message: 'Both parent IDs are required.'
            });
        }

        if (String(parentAId) === String(parentBId)) {
            return Promise.resolve({
                success: false,
                message: 'A character cannot be their own parent.'
            });
        }

        var CharacterQueries = getCharacterQueries();
        var parentA = CharacterQueries.getCharacterById(parentAId);
        var parentB = CharacterQueries.getCharacterById(parentBId);
        if (!parentA || !parentB) {
            return Promise.resolve({
                success: false,
                message: 'One or both parents not found.'
            });
        }

        var SocialChildFactory = getSocialChildFactory();
        if (!SocialChildFactory ||
            typeof SocialChildFactory.buildChildDto !== 'function') {
            return Promise.resolve({
                success: false,
                message: 'SocialChildFactory is not available.'
            });
        }

        var childDto;
        try {
            childDto = SocialChildFactory.buildChildDto(
                parentA, parentB, options
            );
        } catch (e) {
            return Promise.resolve({
                success: false,
                message: 'Failed to build child: ' + e.message
            });
        }

        var normalised;
        try {
            normalised = normaliseCharacterData(childDto);
        } catch (e) {
            return Promise.resolve({
                success: false,
                message: 'Failed to normalise child: ' + e.message
            });
        }

        var validation = validateCharacter(normalised);
        if (!validation.valid) {
            return Promise.resolve({
                success: false,
                message: 'Generated child is invalid: ' +
                    validation.message
            });
        }

        var parentAIdStr = String(parentAId);
        var parentBIdStr = String(parentBId);
        var parentAName = CharacterQueries.getDisplayName(parentA);
        var parentBName = CharacterQueries.getDisplayName(parentB);

        var IU = getIdUtils();
        var childId = IU.generateId('char');
        var now = new Date().toISOString();

        var childRecord = Object.assign({}, normalised, {
            id: childId,
            classIds: [],
            parentIds: [parentAIdStr, parentBIdStr],
            hp: typeof normalised.hp === 'number' ? normalised.hp : 0,
            mp: typeof normalised.mp === 'number' ? normalised.mp : 0,
            weapons: Array.isArray(normalised.weapons)
                ? normalised.weapons : [],
            combatNotes: normalised.combatNotes || '',
            eliminations: [],
            eliminatedWeeks: [],
            createdAt: now,
            updatedAt: now
        });

        return getMutationPipeline().performMutation({
            validate: function() {
                var a = CharacterQueries.getCharacterById(
                    parentAIdStr
                );
                var b = CharacterQueries.getCharacterById(
                    parentBIdStr
                );
                if (!a || !b) {
                    return {
                        valid: false,
                        message: 'One or both parents no longer exist.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is malformed.');
                }

                // Re-validate parents inside the snapshot.
                var snapA = null;
                var snapB = null;
                for (var ai = 0; ai < data.characters.length; ai++) {
                    var ac = data.characters[ai];
                    if (ac && String(ac.id) === parentAIdStr) {
                        snapA = ac;
                    } else if (ac && String(ac.id) === parentBIdStr) {
                        snapB = ac;
                    }
                    if (snapA && snapB) { break; }
                }
                if (!snapA || !snapB) {
                    throw new Error(
                        'One or both parents no longer exist.'
                    );
                }

                data.characters.push(childRecord);
                invalidateCharacterIndex();

                var socialFailure = null;
                var SocialCore = getSocialCore();
                if (SocialCore &&
                    typeof SocialCore.addRelationshipsInTransaction ===
                    'function') {
                    try {
                        var relationships = buildChildRelationships(
                            data, childRecord, snapA, snapB
                        );
                        SocialCore.addRelationshipsInTransaction(
                            data, relationships
                        );
                    } catch (e) {
                        socialFailure =
                            'Social links could not be created: ' +
                            (e && e.message ? e.message : 'unknown error');
                        console.warn(
                            '[CharacterCRUD] createChild social link ' +
                            'failure:', e
                        );
                    }
                } else {
                    socialFailure =
                        'SocialCore unavailable; child created ' +
                        'without social links.';
                    console.warn(
                        '[CharacterCRUD] ' + socialFailure
                    );
                }

                return {
                    child: childRecord,
                    childId: childId,
                    socialFailure: socialFailure
                };
            },

            logMessage: function() {
                return 'Created child of ' + parentAName +
                    ' and ' + parentBName + ': ' +
                    childRecord.firstName + ' ' +
                    childRecord.lastName;
            },

            successMessage: function(result) {
                if (result && result.socialFailure) {
                    return 'Child created. Warning: ' +
                        result.socialFailure;
                }
                return 'Child created successfully!';
            },
            failureMessage: 'Failed to create child.'
        });
    }

    function buildChildRelationships(data, childRecord, parentA, parentB) {
        var list = [];

        function normalisedSexOf(char) {
            if (!char) { return null; }
            var g = String(char.gender || '').trim().toLowerCase();
            if (g === 'female' || g === 'f' ||
                g === 'woman' || g === 'girl') {
                return 'female';
            }
            if (g === 'male' || g === 'm' ||
                g === 'man' || g === 'boy') {
                return 'male';
            }
            return null;
        }

        function parentTermFor(char) {
            var sex = normalisedSexOf(char);
            if (sex === 'female') { return 'Mother'; }
            if (sex === 'male') { return 'Father'; }
            return 'Parent';
        }

        function childTermFor(char) {
            var sex = normalisedSexOf(char);
            if (sex === 'female') { return 'Daughter'; }
            if (sex === 'male') { return 'Son'; }
            return 'Child';
        }

        function siblingTermFor(char, sharedParents) {
            var sex = normalisedSexOf(char);
            var half = sharedParents < 2;
            if (sex === 'female') {
                return half ? 'Half-Sister' : 'Sister';
            }
            if (sex === 'male') {
                return half ? 'Half-Brother' : 'Brother';
            }
            return half ? 'Half-Sibling' : 'Sibling';
        }

        // Parent ↔ child (both directions, both parents).
        list.push({
            character1: String(parentA.id),
            character2: String(childRecord.id),
            typeId: 'familial',
            clarification1: parentTermFor(parentA),
            clarification2: childTermFor(childRecord),
            startYear: '',
            endYear: '',
            notes: ''
        });
        list.push({
            character1: String(childRecord.id),
            character2: String(parentA.id),
            typeId: 'familial',
            clarification1: childTermFor(childRecord),
            clarification2: parentTermFor(parentA),
            startYear: '',
            endYear: '',
            notes: ''
        });
        list.push({
            character1: String(parentB.id),
            character2: String(childRecord.id),
            typeId: 'familial',
            clarification1: parentTermFor(parentB),
            clarification2: childTermFor(childRecord),
            startYear: '',
            endYear: '',
            notes: ''
        });
        list.push({
            character1: String(childRecord.id),
            character2: String(parentB.id),
            typeId: 'familial',
            clarification1: childTermFor(childRecord),
            clarification2: parentTermFor(parentB),
            startYear: '',
            endYear: '',
            notes: ''
        });

        // Siblings: anyone sharing at least one parent with the
        // child. A sibling sharing only one parent is a half-sibling.
        var parentIdSet = Object.create(null);
        parentIdSet[String(parentA.id)] = true;
        parentIdSet[String(parentB.id)] = true;

        var siblings = [];
        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (!c || !c.id) { continue; }
            if (String(c.id) === String(childRecord.id)) { continue; }
            if (!Array.isArray(c.parentIds)) { continue; }

            var shared = 0;
            for (var j = 0; j < c.parentIds.length; j++) {
                if (parentIdSet[String(c.parentIds[j])]) {
                    shared++;
                }
            }
            if (shared > 0) {
                siblings.push({ character: c, sharedParents: shared });
            }
        }

        for (var s = 0; s < siblings.length; s++) {
            var sib = siblings[s].character;
            var sharedCount = siblings[s].sharedParents;

            list.push({
                character1: String(childRecord.id),
                character2: String(sib.id),
                typeId: 'familial',
                clarification1: siblingTermFor(sib, sharedCount),
                clarification2: siblingTermFor(childRecord, sharedCount),
                startYear: '',
                endYear: '',
                notes: ''
            });
            list.push({
                character1: String(sib.id),
                character2: String(childRecord.id),
                typeId: 'familial',
                clarification1: siblingTermFor(childRecord, sharedCount),
                clarification2: siblingTermFor(sib, sharedCount),
                startYear: '',
                endYear: '',
                notes: ''
            });
        }

        return list;
    }

    // ============================================================
    // BACKFILL DEATH CASCADES
    // ============================================================

    function backfillDeathCascades() {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        var TeamCore = getTeamCore();
        if (!TeamCore ||
            typeof TeamCore.endStintsForCharacter !== 'function') {
            return Promise.resolve({
                success: false,
                message: 'TeamCore.endStintsForCharacter is ' +
                    'unavailable; cannot backfill.'
            });
        }

        return getMutationPipeline().performMutation({
            validate: function() {
                if (!Array.isArray(window.data && window.data.characters)) {
                    return {
                        valid: false,
                        message: 'Character store is not available.'
                    };
                }
                if (!Array.isArray(window.data && window.data.teams)) {
                    return {
                        valid: false,
                        message: 'Team store is not available.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is malformed.');
                }
                if (!Array.isArray(data.teams)) {
                    throw new Error('Team store is malformed.');
                }

                var charactersScanned = 0;
                var charactersWithStintsEnded = 0;
                var stintsEndedTotal = 0;
                var teamsTouchedTotal = 0;

                for (var i = 0; i < data.characters.length; i++) {
                    var char = data.characters[i];
                    if (!char || typeof char !== 'object') { continue; }
                    if (!char.id) { continue; }

                    var deathYear = parseYearInt(char.deathYear);
                    if (deathYear === null) { continue; }

                    charactersScanned++;

                    var result = TeamCore.endStintsForCharacter(
                        data, String(char.id), deathYear
                    );
                    if (!result) { continue; }

                    if (typeof result.stintsEnded === 'number' &&
                        result.stintsEnded > 0) {
                        charactersWithStintsEnded++;
                        stintsEndedTotal += result.stintsEnded;
                    }
                    if (typeof result.teamsTouched === 'number' &&
                        result.teamsTouched > 0) {
                        teamsTouchedTotal += result.teamsTouched;
                    }
                }

                return {
                    charactersScanned: charactersScanned,
                    charactersWithStintsEnded: charactersWithStintsEnded,
                    stintsEnded: stintsEndedTotal,
                    teamsTouched: teamsTouchedTotal
                };
            },

            logMessage: function(result) {
                return 'Backfilled death cascades: ' +
                    result.charactersScanned + ' character(s) scanned, ' +
                    result.stintsEnded + ' stint(s) ended across ' +
                    result.teamsTouched + ' team(s).';
            },

            successMessage: function(result) {
                if (result.stintsEnded === 0) {
                    return 'No open stints found for deceased characters.';
                }
                return 'Ended ' + result.stintsEnded +
                    ' professional stint(s) for ' +
                    result.charactersWithStintsEnded +
                    ' deceased character(s).';
            },

            failureMessage: 'Failed to backfill death cascades.'
        });
    }

    // ============================================================
    // SET INSTRUCTOR FOR CLASS
    // ============================================================

    function setInstructorForClass(charId, classId, isInstructor) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (!classId) {
            return Promise.resolve({
                success: false,
                message: 'Class ID is required.'
            });
        }
        if (typeof isInstructor !== 'boolean') {
            return Promise.resolve({
                success: false,
                message: 'isInstructor must be true or false.'
            });
        }

        var CharacterQueries = getCharacterQueries();
        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetRole = isInstructor ? 'instructor' : 'student';

        var char = CharacterQueries.getCharacterById(targetChar);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var Enrolments = getAcademyEnrolments();
        if (!Enrolments ||
            typeof Enrolments.setRoleForClass !== 'function') {
            return Promise.resolve({
                success: false,
                message: 'AcademyEnrolments.setRoleForClass is ' +
                    'unavailable.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return getMutationPipeline().performMutation({
            validate: function(appData) {
                var currentChar = null;
                if (appData && Array.isArray(appData.characters)) {
                    for (var i = 0; i < appData.characters.length; i++) {
                        var c = appData.characters[i];
                        if (c && String(c.id) === targetChar) {
                            currentChar = c;
                            break;
                        }
                    }
                }
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                if (!appData.academy ||
                    !appData.academy.graduatingClasses ||
                    !appData.academy.graduatingClasses[targetClass]) {
                    return {
                        valid: false,
                        message: 'Class no longer exists.'
                    };
                }

                return { valid: true };
            },

            mutate: function(appData) {
                var result = Enrolments.setRoleForClass(
                    appData,
                    targetChar,
                    targetClass,
                    targetRole
                );

                if (!result || typeof result !== 'object') {
                    throw new Error(
                        'AcademyEnrolments.setRoleForClass returned ' +
                        'an invalid result.'
                    );
                }

                return {
                    characterId: targetChar,
                    classId: targetClass,
                    role: targetRole,
                    intervalsChanged:
                        typeof result.intervalsChanged === 'number'
                            ? result.intervalsChanged
                            : 0
                };
            },

            logMessage: function(result) {
                var label = targetRole === 'instructor'
                    ? 'instructor' : 'student';
                return 'Set ' + name + ' as ' + label +
                    ' for class ' + targetClass +
                    (result.intervalsChanged > 0
                        ? ' (' + result.intervalsChanged +
                            ' interval(s))'
                        : ' (no change)');
            },

            successMessage: function(result) {
                var label = targetRole === 'instructor'
                    ? 'Instructor' : 'Student';
                if (result.intervalsChanged === 0) {
                    return label + ' role already set.';
                }
                return label + ' role set.';
            },

            failureMessage: 'Failed to set role for class.'
        });
    }

    // ============================================================
    // SET MODE - RETIRED STUB
    // ============================================================

    function setMode(charId, mode) {
        void charId;
        void mode;

        return Promise.resolve({
            success: false,
            message: 'setMode is retired. The character role is now ' +
                'class-scoped. Use setInstructorForClass(charId, ' +
                'classId, isInstructor) instead.'
        });
    }

    // ============================================================
    // SET CAREER TRANSITION
    // ============================================================
    //
    // Appends a terminal careerStatus entry and runs the
    // professional-team cascade in the same transaction.
    //
    // IDEMPOTENT: repeated calls with the same (statusKey, year)
    // produce the same array; the cascade finds no open stints on
    // the second call.
    //
    // EARLIER SAME-STATUS ENTRIES ARE PRESERVED. A character who
    // was an instructor in 1990 and again in 2010 keeps both
    // entries. closeOpenCareerEntries reconciles the intervals.

    function setCareerTransition(charId, statusKey, year) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        var CharacterQueries = getCharacterQueries();
        var targetChar = String(charId);

        var normalisedStatus =
            (statusKey === undefined || statusKey === null)
                ? ''
                : String(statusKey).trim().toLowerCase();

        if (!isCareerTransitionStatus(normalisedStatus)) {
            return Promise.resolve({
                success: false,
                message: 'Status must be one of: ' +
                    getTerminalStatuses().join(', ') + '.'
            });
        }

        var yearNum = parseYearInt(year);
        if (yearNum === null) {
            return Promise.resolve({
                success: false,
                message: 'Year must be a positive integer.'
            });
        }
        var yearStr = String(yearNum);

        var char = CharacterQueries.getCharacterById(targetChar);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var latestExistingYear = getLatestCareerStatusYear(
            char.careerStatus
        );

        if (latestExistingYear !== null &&
            yearNum < latestExistingYear) {
            return Promise.resolve({
                success: false,
                message: 'The transition year (' + yearNum +
                    ') is earlier than the latest existing entry (' +
                    latestExistingYear + '). A terminal status must ' +
                    'be the most recent entry.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        var statusLabel = normalisedStatus.charAt(0).toUpperCase() +
            normalisedStatus.slice(1);

        return getMutationPipeline().performMutation({
            validate: function() {
                var current =
                    CharacterQueries.getCharacterById(targetChar);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is malformed.');
                }

                var target = null;
                for (var i = 0; i < data.characters.length; i++) {
                    var c = data.characters[i];
                    if (c && String(c.id) === targetChar) {
                        target = c;
                        break;
                    }
                }
                if (!target) {
                    throw new Error(
                        'Character not found in data store.'
                    );
                }

                // Append the terminal entry. Earlier entries with
                // the same status are preserved.
                var existing = Array.isArray(target.careerStatus)
                    ? target.careerStatus.slice() : [];

                existing.push({
                    status: normalisedStatus,
                    startYear: yearStr,
                    endYear: '',
                    title: ''
                });

                closeOpenCareerEntries(existing);

                target.careerStatus = existing;
                target.updatedAt = new Date().toISOString();

                invalidateCharacterIndex();

                // Cascade: this path bypasses the previous/new
                // comparison because the terminal entry is being
                // written here directly.
                var cascade = {
                    fired: false,
                    year: yearNum,
                    stintsEnded: 0,
                    teamsTouched: 0
                };

                var TeamCore = getTeamCore();
                if (TeamCore &&
                    typeof TeamCore.endStintsForCharacter ===
                    'function') {
                    var cascadeResult =
                        TeamCore.endStintsForCharacter(
                            data, targetChar, yearNum
                        );
                    cascade.fired = true;
                    if (cascadeResult &&
                        typeof cascadeResult === 'object') {
                        cascade.stintsEnded =
                            typeof cascadeResult.stintsEnded === 'number'
                                ? cascadeResult.stintsEnded : 0;
                        cascade.teamsTouched =
                            typeof cascadeResult.teamsTouched === 'number'
                                ? cascadeResult.teamsTouched : 0;
                    }
                } else {
                    console.warn(
                        '[CharacterCRUD] Career-transition cascade ' +
                        'skipped for character ' + targetChar +
                        ': TeamCore.endStintsForCharacter unavailable.'
                    );
                }

                return {
                    characterId: targetChar,
                    status: normalisedStatus,
                    year: yearNum,
                    cascade: cascade
                };
            },

            logMessage: function(result) {
                var msg = 'Set ' + name + ' to ' + statusLabel +
                    ' in ' + result.year;
                if (result.cascade && result.cascade.stintsEnded > 0) {
                    msg += ' (ended ' + result.cascade.stintsEnded +
                        ' professional stint' +
                        (result.cascade.stintsEnded === 1
                            ? '' : 's') + ')';
                }
                return msg;
            },

            successMessage: function(result) {
                var parts = [
                    statusLabel + ' set for ' + result.year + '.'
                ];
                if (result.cascade && result.cascade.stintsEnded > 0) {
                    parts.push('Ended ' + result.cascade.stintsEnded +
                        ' professional stint' +
                        (result.cascade.stintsEnded === 1 ? '' : 's') +
                        '.');
                }
                return parts.join(' ');
            },

            failureMessage: 'Failed to set career transition.'
        });
    }

    // ============================================================
    // APPLY CAREER STATUS TIMELINE
    // ============================================================
    //
    // Wholesale replacement of a character's careerStatus array.
    // Used by the CareerStatusWizard to commit a generated timeline.
    // REPLACES, does not merge.
    //
    // If the new latest entry is a terminal status, the professional-
    // team cascade runs against the same snapshot.
    //
    // STAGE ORDER:
    //   Stages must be in ascending startYear order. Out-of-order
    //   input is rejected. The reconciliation loop closes each
    //   stage's endYear at the next stage's startYear, except when
    //   the stage has an explicit endYear that is already later
    //   than the next stage's startYear, in which case it is left
    //   alone (the schema's validator will reject the record and
    //   the caller must fix the input).

    function applyCareerStatusTimeline(charId, stages) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (!Array.isArray(stages)) {
            return Promise.resolve({
                success: false,
                message: 'Stages must be an array.'
            });
        }

        var CharacterQueries = getCharacterQueries();
        var targetChar = String(charId);

        var cleanStages = [];
        for (var i = 0; i < stages.length; i++) {
            var row = stages[i];
            var rowLabel = 'Stage ' + (i + 1);

            if (!row ||
                typeof row !== 'object' ||
                Array.isArray(row)) {
                return Promise.resolve({
                    success: false,
                    message: rowLabel + ': must be an object.'
                });
            }

            var status = row.status !== undefined &&
                row.status !== null
                ? String(row.status).trim().toLowerCase()
                : '';
            if (status === '') {
                return Promise.resolve({
                    success: false,
                    message: rowLabel + ': status is required.'
                });
            }

            var startNum = parseYearInt(row.startYear);
            if (startNum === null) {
                return Promise.resolve({
                    success: false,
                    message: rowLabel +
                        ': startYear must be a positive integer.'
                });
            }

            var endRaw = row.endYear;
            var endStr = (endRaw === undefined || endRaw === null)
                ? '' : String(endRaw).trim();
            var endNum = null;
            if (endStr !== '') {
                endNum = parseYearInt(endStr);
                if (endNum === null) {
                    return Promise.resolve({
                        success: false,
                        message: rowLabel +
                            ': endYear must be a positive integer, ' +
                            'or blank.'
                    });
                }
                if (endNum < startNum) {
                    return Promise.resolve({
                        success: false,
                        message: rowLabel +
                            ': endYear cannot be before startYear.'
                    });
                }
            }

            cleanStages.push({
                status: status,
                startYear: startNum,
                endYear: endNum,
                title: row.title !== undefined &&
                    row.title !== null
                    ? String(row.title).trim()
                    : ''
            });
        }

        // ---- Validate ascending order ----
        for (var oi = 1; oi < cleanStages.length; oi++) {
            if (cleanStages[oi].startYear <
                cleanStages[oi - 1].startYear) {
                return Promise.resolve({
                    success: false,
                    message: 'Stages must be in ascending startYear ' +
                        'order. Stage ' + (oi + 1) + ' starts before ' +
                        'stage ' + oi + '.'
                });
            }
        }

        // ---- Reconcile endYear ----
        for (var s = 0; s < cleanStages.length - 1; s++) {
            var cur = cleanStages[s];
            var nxt = cleanStages[s + 1];

            // Only close the current stage if it does not already
            // have an explicit endYear later than the next start.
            if (cur.endYear === null ||
                cur.endYear < nxt.startYear) {
                cur.endYear = nxt.startYear;
            }
        }

        var char = CharacterQueries.getCharacterById(targetChar);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }
        var name = CharacterQueries.getDisplayName(char);

        return getMutationPipeline().performMutation({
            validate: function() {
                var current =
                    CharacterQueries.getCharacterById(targetChar);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is malformed.');
                }

                var target = null;
                for (var i = 0; i < data.characters.length; i++) {
                    var c = data.characters[i];
                    if (c && String(c.id) === targetChar) {
                        target = c;
                        break;
                    }
                }
                if (!target) {
                    throw new Error(
                        'Character not found in data store.'
                    );
                }

                var previousLatestStatus = getLatestCareerStatus(
                    target.careerStatus
                );

                var finalStages = [];
                for (var j = 0; j < cleanStages.length; j++) {
                    finalStages.push({
                        status: cleanStages[j].status,
                        startYear: String(cleanStages[j].startYear),
                        endYear: cleanStages[j].endYear === null
                            ? ''
                            : String(cleanStages[j].endYear),
                        title: cleanStages[j].title
                    });
                }

                target.careerStatus = finalStages;
                target.updatedAt = new Date().toISOString();

                invalidateCharacterIndex();

                var cascade = applyCareerTransitionCascade(
                    data,
                    targetChar,
                    previousLatestStatus,
                    target.careerStatus
                );

                return {
                    characterId: targetChar,
                    stageCount: finalStages.length,
                    careerTransition: cascade
                };
            },

            logMessage: function(result) {
                var msg = 'Replaced career status for ' + name +
                    ' (' + result.stageCount + ' stage' +
                    (result.stageCount === 1 ? '' : 's') + ')';
                var cascade = result.careerTransition;
                if (cascade && cascade.fired &&
                    cascade.stintsEnded > 0) {
                    msg += '; ended ' + cascade.stintsEnded +
                        ' professional stint' +
                        (cascade.stintsEnded === 1 ? '' : 's') +
                        ' at year ' + cascade.year;
                }
                return msg;
            },

            successMessage: function(result) {
                var msg = 'Career status replaced: ' +
                    result.stageCount + ' stage' +
                    (result.stageCount === 1 ? '' : 's') + '.';
                var cascade = result.careerTransition;
                if (cascade && cascade.fired &&
                    cascade.stintsEnded > 0) {
                    msg += ' Ended ' + cascade.stintsEnded +
                        ' professional stint' +
                        (cascade.stintsEnded === 1 ? '' : 's') + '.';
                }
                return msg;
            },

            failureMessage: 'Failed to replace career status.'
        });
    }

    // ============================================================
    // DELETE CHARACTER
    // ============================================================

    function deleteCharacter(id) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        if (!id) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        var CharacterQueries = getCharacterQueries();
        var targetId = String(id);

        var char = CharacterQueries.getCharacterById(targetId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return getMutationPipeline().performMutation({
            validate: function() {
                var currentChar =
                    CharacterQueries.getCharacterById(targetId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var cascade = {
                    teamMembershipsRemoved: 0,
                    parentRefsStripped: 0,
                    departmentMembershipsRemoved: 0,
                    departmentHeadCleared: 0,
                    socialRelationshipsRemoved: 0,
                    tournamentParticipantsRemoved: 0,
                    academyCascade: null
                };

                // ---- Teams ----
                if (Array.isArray(data.teams)) {
                    for (var ti = 0; ti < data.teams.length; ti++) {
                        var team = data.teams[ti];
                        if (!team || !Array.isArray(team.members)) {
                            continue;
                        }
                        var before = team.members.length;
                        team.members = team.members.filter(
                            function(m) {
                                return !m ||
                                    String(m.characterId) !== targetId;
                            }
                        );
                        cascade.teamMembershipsRemoved +=
                            before - team.members.length;
                    }
                }

                // ---- Parent references on other characters ----
                if (Array.isArray(data.characters)) {
                    for (var ci = 0;
                         ci < data.characters.length; ci++) {
                        var c = data.characters[ci];
                        if (!c || !Array.isArray(c.parentIds)) {
                            continue;
                        }
                        var before2 = c.parentIds.length;
                        c.parentIds = c.parentIds.filter(
                            function(pid) {
                                return String(pid) !== targetId;
                            }
                        );
                        cascade.parentRefsStripped +=
                            before2 - c.parentIds.length;
                    }
                }

                // ---- Departments ----
                if (Array.isArray(data.departments)) {
                    for (var di = 0;
                         di < data.departments.length; di++) {
                        var dept = data.departments[di];
                        if (!dept || typeof dept !== 'object') {
                            continue;
                        }

                        if (dept.headId &&
                            String(dept.headId) === targetId) {
                            dept.headId = null;
                            cascade.departmentHeadCleared++;
                        }

                        if (Array.isArray(dept.members)) {
                            var before3 = dept.members.length;
                            dept.members = dept.members.filter(
                                function(m) {
                                    if (!m) { return false; }
                                    var mid = typeof m === 'string'
                                        ? m
                                        : m.characterId;
                                    return String(mid) !== targetId;
                                }
                            );
                            cascade.departmentMembershipsRemoved +=
                                before3 - dept.members.length;
                        }
                    }
                }

                // ---- Social relationships ----
                if (data.social &&
                    Array.isArray(data.social.relationships)) {
                    var before4 = data.social.relationships.length;
                    data.social.relationships =
                        data.social.relationships.filter(
                            function(rel) {
                                if (!rel) { return false; }
                                return String(rel.character1) !== targetId &&
                                    String(rel.character2) !== targetId;
                            }
                        );
                    cascade.socialRelationshipsRemoved =
                        before4 - data.social.relationships.length;
                }

                // ---- Tournament participants ----
                if (Array.isArray(data.tournaments)) {
                    for (var tri = 0;
                         tri < data.tournaments.length; tri++) {
                        var tourn = data.tournaments[tri];
                        if (!tourn ||
                            !Array.isArray(tourn.participants)) {
                            continue;
                        }
                        var before5 = tourn.participants.length;
                        tourn.participants = tourn.participants.filter(
                            function(p) {
                                if (!p) { return false; }
                                var pid = typeof p === 'string'
                                    ? p
                                    : p.characterId;
                                return String(pid) !== targetId;
                            }
                        );
                        cascade.tournamentParticipantsRemoved +=
                            before5 - tourn.participants.length;
                    }
                }

                // ---- Academy cascade (class membership, enrolments) ----
                var Cascade = getAcademyCascade();
                if (Cascade &&
                    typeof Cascade.characterDeleted === 'function') {
                    cascade.academyCascade = Cascade.characterDeleted(
                        data, targetId
                    );
                }

                // ---- Remove the character record itself ----
                var found = false;
                data.characters = data.characters.filter(
                    function(c) {
                        if (c && String(c.id) === targetId) {
                            found = true;
                            return false;
                        }
                        return true;
                    }
                );

                if (!found) {
                    throw new Error(
                        'Character not found in data store.'
                    );
                }

                invalidateCharacterIndex();

                return { deleted: true, cascade: cascade };
            },

            logMessage: function(result) {
                var c = result.cascade || {};
                var details = [];

                if (c.teamMembershipsRemoved > 0) {
                    details.push(c.teamMembershipsRemoved +
                        ' team membership(s)');
                }
                if (c.parentRefsStripped > 0) {
                    details.push(c.parentRefsStripped +
                        ' parent reference(s)');
                }
                if (c.departmentMembershipsRemoved > 0) {
                    details.push(c.departmentMembershipsRemoved +
                        ' department membership(s)');
                }
                if (c.departmentHeadCleared > 0) {
                    details.push(c.departmentHeadCleared +
                        ' department head role(s) cleared');
                }
                if (c.socialRelationshipsRemoved > 0) {
                    details.push(c.socialRelationshipsRemoved +
                        ' social relationship(s)');
                }
                if (c.tournamentParticipantsRemoved > 0) {
                    details.push(c.tournamentParticipantsRemoved +
                        ' tournament participation(s)');
                }

                if (c.academyCascade) {
                    var Cascade = getAcademyCascade();
                    if (Cascade &&
                        typeof Cascade.formatSummary === 'function') {
                        var summary = Cascade.formatSummary(
                            c.academyCascade
                        );
                        if (summary) {
                            details.push(
                                summary.replace(/^\(|\)$/g, '')
                            );
                        }
                    }
                }

                var suffix = details.length > 0
                    ? ' (' + details.join(', ') + ')'
                    : '';

                return 'Deleted character: ' + name + suffix;
            },

            successMessage: 'Character deleted successfully!',
            failureMessage: 'Failed to delete character.'
        });
    }

    // ============================================================
    // BULK DELETE
    // ============================================================

    function deleteAllCharacters() {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh.'
            });
        }

        // Check emptiness before prompting. A user should not be
        // asked to confirm deleting a store that is already empty.
        var existing = window.data && Array.isArray(window.data.characters)
            ? window.data.characters
            : [];
        if (existing.length === 0) {
            return Promise.resolve({
                success: true,
                message: 'No characters to delete.'
            });
        }

        if (!confirm('Delete ALL characters permanently? ' +
            'This cannot be undone.')) {
            return Promise.resolve({
                success: false,
                message: 'Operation cancelled.'
            });
        }

        return getMutationPipeline().performMutation({
            validate: function(data) {
                var count = Array.isArray(data.characters)
                    ? data.characters.length : 0;
                if (count === 0) {
                    return {
                        valid: false,
                        message: 'No characters to delete.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var count = Array.isArray(data.characters)
                    ? data.characters.length : 0;

                // ---- Teams ----
                if (Array.isArray(data.teams)) {
                    for (var ti = 0; ti < data.teams.length; ti++) {
                        var team = data.teams[ti];
                        if (team && Array.isArray(team.members)) {
                            team.members = [];
                        }
                    }
                }

                // ---- Departments ----
                if (Array.isArray(data.departments)) {
                    for (var di = 0;
                         di < data.departments.length; di++) {
                        var dept = data.departments[di];
                        if (!dept || typeof dept !== 'object') {
                            continue;
                        }
                        dept.headId = null;
                        if (Array.isArray(dept.members)) {
                            dept.members = [];
                        }
                    }
                }

                // ---- Social relationships ----
                if (data.social &&
                    Array.isArray(data.social.relationships)) {
                    data.social.relationships = [];
                }

                // ---- Tournament participants ----
                if (Array.isArray(data.tournaments)) {
                    for (var tri = 0;
                         tri < data.tournaments.length; tri++) {
                        var tourn = data.tournaments[tri];
                        if (tourn && Array.isArray(tourn.participants)) {
                            tourn.participants = [];
                        }
                    }
                }

                // ---- Characters ----
                data.characters = [];
                invalidateCharacterIndex();

                return { deletedCount: count };
            },

            logMessage: function(result) {
                return 'Deleted all characters (' +
                    result.deletedCount + ')';
            },

            successMessage: function(result) {
                return 'Deleted ' + result.deletedCount +
                    ' characters.';
            },

            failureMessage: 'Failed to delete all characters.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterCRUD = Object.freeze({
        save: save,
        delete: deleteCharacter,
        deleteAll: deleteAllCharacters,

        setInstructorForClass: setInstructorForClass,
        setMode: setMode,

        createChild: createChild,
        backfillDeathCascades: backfillDeathCascades,
        setFillerFlag: setFillerFlag,

        applyCareerStatusTimeline: applyCareerStatusTimeline,
        setCareerTransition: setCareerTransition,

        validateCharacter: validateCharacter,
        normaliseCharacterData: normaliseCharacterData
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterCRUD;
        var failures = [];

        var required = [
            'save',
            'delete',
            'deleteAll',
            'setInstructorForClass',
            'setMode',
            'createChild',
            'backfillDeathCascades',
            'setFillerFlag',
            'applyCareerStatusTimeline',
            'setCareerTransition',
            'validateCharacter',
            'normaliseCharacterData'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                failures.push('missing export: ' + required[i]);
            }
        }

        if (failures.length > 0) {
            throw new Error(
                '[CharacterCRUD] Verification failed: ' +
                failures.join('; ')
            );
        }
    })();

})();
