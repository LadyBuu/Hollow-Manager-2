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
 *   - classIds, disciplineIds, parentIds. Preserved by save, but
 *     not originated here.
 *   - Death cascade implementation. Delegates to
 *     TeamCore.endStintsForCharacter.
 *   - Career-transition cascade implementation. Same.
 *   - UI. No notifications, no rendering, no DOM.
 *
 * MUTATION MODEL:
 *   Every mutation routes through MutationPipeline. Validation runs
 *   twice: pre-flight against window.data, then snapshot-scoped
 *   inside pipeline.validate(). The candidate is re-derived inside
 *   mutate() from the same snapshot, so the applied state never
 *   diverges from what was validated.
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
 * CAREER STATUS CLOSING (this revision):
 *   Career-status entries never carry gaps. When a new entry starts
 *   at year Y, every other entry that would otherwise be open (or
 *   that ends before Y) is closed or extended to Y.
 *
 *   Two mutation paths, one rule:
 *     - setCareerTransition(id, status, Y)
 *         Extends or closes the previously-current entry to Y,
 *         then appends the new terminal entry at Y.
 *     - applyCareerStatusTimeline(id, stages)
 *         After validation, walks the incoming stages in
 *         chronological order and fills in each stage's endYear
 *         from the next stage's startYear. The final stage keeps
 *         whatever endYear the caller supplied (usually blank).
 *
 *   The reconciliation is strict-in-order: a stage whose startYear
 *   is greater than the next stage's startYear is a validation
 *   error, not a reconciliation opportunity.
 *
 * DEATH CASCADE:
 *   Fires on every save of a character with a parseable deathYear.
 *   Closes any open professional-team stint at that year. Idempotent.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.MutationPipeline
 *   - window.IdUtils
 *   - window.CharacterConstants
 *
 * DEPENDENCIES (LAZY):
 *   - window.TeamCore       (cascades; absent = cascade skipped)
 *   - window.AcademyCascade (deleteCharacter)
 *   - window.AcademyEnrolments (setInstructorForClass)
 *   - window.SocialCore     (createChild)
 *   - window.SocialChildFactory (createChild)
 *   - window.CharacterStrip (filler flag)
 */

(function() {
    'use strict';

    if (window.__characterCrudLoaded) {
        return;
    }
    window.__characterCrudLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;
    var CharacterConstants = window.CharacterConstants;

    function checkDependencies() {
        var missing = [];

        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!MutationPipeline ||
            typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }
        if (!CharacterConstants) {
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
    // CONSTANTS
    // ============================================================

    var STAT_KEYS = CharacterConstants.STAT_KEYS;
    var STAT_MIN = CharacterConstants.STAT_MIN;
    var STAT_MAX = CharacterConstants.STAT_MAX;
    var STAT_DEFAULT = CharacterConstants.STAT_DEFAULT;

    var MAX_SPECIAL_MOVES = CharacterConstants.MAX_SPECIAL_MOVES;
    var MAX_MOVE_NAME_LENGTH = CharacterConstants.MAX_MOVE_NAME_LENGTH;
    var MAX_MOVE_DESCRIPTION_LENGTH =
        CharacterConstants.MAX_MOVE_DESCRIPTION_LENGTH;

    var HP_HARD_CAP = 999;
    var MP_HARD_CAP = 999;

    var MAX_WEAPONS = CharacterConstants.MAX_WEAPONS;
    var MAX_WEAPON_NAME_LENGTH = CharacterConstants.MAX_WEAPON_NAME_LENGTH;
    var MAX_WEAPON_NOTES_LENGTH =
        CharacterConstants.MAX_WEAPON_NOTES_LENGTH;
    var DEFAULT_WEAPON_TYPE = CharacterConstants.DEFAULT_WEAPON_TYPE;

    var ROLE_STUDENT = 'student';
    var ROLE_INSTRUCTOR = 'instructor';

    // Terminal career statuses. A character whose LATEST career
    // entry has one of these is off the active roster.
    //
    // `civilian` is NOT in this set. It describes a character who
    // has not joined, not one who has left.
    var CAREER_TRANSITION_STATUSES = {
        'retired': true,
        'support': true,
        'instructor': true
    };

    // ============================================================
    // HELPERS
    // ============================================================

    function getCurrentYear() {
        if (window.data && typeof window.data.currentYear === 'number') {
            return window.data.currentYear;
        }
        return new Date().getFullYear();
    }

    function computeCachedDeceased(data) {
        var deathYear = parseInt(data.deathYear, 10);
        if (isNaN(deathYear)) { return false; }
        return deathYear <= getCurrentYear();
    }

    function getTeamCore() { return window.TeamCore || null; }
    function getAcademyCascade() { return window.AcademyCascade || null; }
    function getAcademyEnrolments() { return window.AcademyEnrolments || null; }
    function getSocialCore() { return window.SocialCore || null; }
    function getSocialChildFactory() { return window.SocialChildFactory || null; }
    function getCharacterStrip() { return window.CharacterStrip || null; }

    function parseYearInt(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    function invalidateCharacterIndex() {
        if (!CharacterQueries ||
            typeof CharacterQueries.invalidateCharacterIndex !==
            'function') {
            return;
        }
        try {
            CharacterQueries.invalidateCharacterIndex();
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

    // ============================================================
    // CAREER TRANSITION HELPERS
    // ============================================================

    /**
     * Latest careerStatus entry's normalised status string.
     * Highest startYear wins; ties break on later array index.
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

            var year = parseInt(entry.startYear, 10);
            if (isNaN(year)) { year = -Infinity; }

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

            var year = parseInt(entry.startYear, 10);
            if (isNaN(year)) { year = -Infinity; }

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
        if (!status || typeof status !== 'string') { return false; }
        return CAREER_TRANSITION_STATUSES[status.toLowerCase()] === true;
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
     *     already had (usually blank for still-current statuses, or
     *     set for terminal ones).
     *   - Malformed entries are left untouched.
     *   - The array is sorted in place by startYear ascending, ties
     *     broken by original index (stable).
     *
     * MUTATES THE PASSED ARRAY. The caller owns the array.
     *
     * @param {Array} entries
     * @returns {Array} the same array, sorted and reconciled
     */
    function closeOpenCareerEntries(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return entries;
        }

        // Attach stable index for tie-breaking.
        var indexed = [];
        for (var i = 0; i < entries.length; i++) {
            indexed.push({ entry: entries[i], idx: i });
        }

        indexed.sort(function(a, b) {
            var ay = parseInt(
                a.entry && a.entry.startYear, 10
            );
            var by = parseInt(
                b.entry && b.entry.startYear, 10
            );
            if (isNaN(ay)) { ay = Infinity; }
            if (isNaN(by)) { by = Infinity; }
            if (ay !== by) { return ay - by; }
            return a.idx - b.idx;
        });

        // Rewrite the array in sorted order.
        for (var s = 0; s < indexed.length; s++) {
            entries[s] = indexed[s].entry;
        }

        // Close everything except the last entry.
        for (var k = 0; k < entries.length - 1; k++) {
            var current = entries[k];
            var next = entries[k + 1];

            if (!current || typeof current !== 'object') { continue; }
            if (!next || typeof next !== 'object') { continue; }

            var nextStart = parseInt(next.startYear, 10);
            if (isNaN(nextStart)) { continue; }

            // Extend or set. If the current endYear is later than
            // nextStart (malformed input), leave it alone rather
            // than truncating it silently.
            var currentEnd = parseInt(current.endYear, 10);
            if (isNaN(currentEnd) || currentEnd < nextStart) {
                current.endYear = String(nextStart);
            }
        }

        return entries;
    }

    /**
     * Run the career-transition → team cascade when the transition
     * qualifies.
     *
     * QUALIFIES WHEN:
     *   - previousLatestStatus is NOT a terminal status
     *   - new latest status IS a terminal status
     *   - the new latest entry has a parseable startYear
     *
     * Returns a summary. Never throws. Missing TeamCore returns
     * { fired: false, reason: 'no-team-core' }.
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

        var id = (typeof weapon.id === 'string' && weapon.id)
            ? weapon.id
            : (IdUtils && typeof IdUtils.generateId === 'function'
                ? IdUtils.generateId('weapon')
                : 'weapon_' + Date.now() + '_' +
                    Math.random().toString(36).slice(2, 8));

        var name = typeof weapon.name === 'string'
            ? weapon.name.trim() : '';
        if (name.length > MAX_WEAPON_NAME_LENGTH) {
            name = name.slice(0, MAX_WEAPON_NAME_LENGTH);
        }

        var type = typeof weapon.type === 'string' && weapon.type
            ? weapon.type
            : DEFAULT_WEAPON_TYPE;

        if (CharacterConstants &&
            typeof CharacterConstants.isValidWeaponType === 'function') {
            if (!CharacterConstants.isValidWeaponType(type)) {
                type = DEFAULT_WEAPON_TYPE;
            }
        }

        var notes = typeof weapon.notes === 'string'
            ? weapon.notes.trim() : '';
        if (notes.length > MAX_WEAPON_NOTES_LENGTH) {
            notes = notes.slice(0, MAX_WEAPON_NOTES_LENGTH);
        }

        return { id: id, name: name, type: type, notes: notes };
    }

    function normaliseWeapons(weapons) {
        if (!Array.isArray(weapons)) { return []; }

        var result = [];
        var seenIds = Object.create(null);

        for (var i = 0; i < weapons.length; i++) {
            var w = normaliseWeapon(weapons[i]);
            if (!w) { continue; }
            if (!w.name) { continue; }

            if (seenIds[w.id]) {
                w.id = (IdUtils && typeof IdUtils.generateId === 'function')
                    ? IdUtils.generateId('weapon')
                    : 'weapon_' + Date.now() + '_' +
                        Math.random().toString(36).slice(2, 8);
            }
            seenIds[w.id] = true;

            result.push(w);
            if (result.length >= MAX_WEAPONS) { break; }
        }

        return result;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateCharacter(charData) {
        if (!charData.firstName || charData.firstName.trim() === '') {
            return {
                valid: false,
                message: 'First name is required.'
            };
        }
        if (!charData.lastName || charData.lastName.trim() === '') {
            return {
                valid: false,
                message: 'Last name is required.'
            };
        }

        var hasDeathYear = charData.deathYear !== undefined &&
            charData.deathYear !== null &&
            String(charData.deathYear).trim() !== '';

        if (hasDeathYear) {
            var year = parseInt(charData.deathYear, 10);
            if (isNaN(year) || year < 1) {
                return {
                    valid: false,
                    message: 'Death Year must be a positive number.'
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

        if (charData.hp !== undefined &&
            charData.hp !== null &&
            charData.hp !== '') {
            var hp = Number(charData.hp);
            if (isNaN(hp) || hp < 0 || hp > HP_HARD_CAP) {
                return {
                    valid: false,
                    message: 'HP must be between 0 and ' +
                        HP_HARD_CAP + '.'
                };
            }
        }
        if (charData.mp !== undefined &&
            charData.mp !== null &&
            charData.mp !== '') {
            var mp = Number(charData.mp);
            if (isNaN(mp) || mp < 0 || mp > MP_HARD_CAP) {
                return {
                    valid: false,
                    message: 'MP must be between 0 and ' +
                        MP_HARD_CAP + '.'
                };
            }
        }

        if (charData.weapons !== undefined) {
            if (!Array.isArray(charData.weapons)) {
                return {
                    valid: false,
                    message: 'Weapons must be an array.'
                };
            }
            if (charData.weapons.length > MAX_WEAPONS) {
                return {
                    valid: false,
                    message: 'Too many weapons. Maximum is ' +
                        MAX_WEAPONS + '.'
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
                if (w.name &&
                    w.name.length > MAX_WEAPON_NAME_LENGTH) {
                    return {
                        valid: false,
                        message: 'Weapon name exceeds maximum length.'
                    };
                }
                if (w.notes &&
                    w.notes.length > MAX_WEAPON_NOTES_LENGTH) {
                    return {
                        valid: false,
                        message: 'Weapon notes exceed maximum length.'
                    };
                }
                if (w.type &&
                    CharacterConstants &&
                    typeof CharacterConstants.isValidWeaponType ===
                    'function') {
                    if (!CharacterConstants.isValidWeaponType(w.type)) {
                        return {
                            valid: false,
                            message: 'Weapon type "' + w.type +
                                '" is not recognised.'
                        };
                    }
                }
            }
        }

        var physicalMoves = charData.specialMoves &&
            charData.specialMoves.physical
            ? charData.specialMoves.physical : [];
        var magicalMoves = charData.specialMoves &&
            charData.specialMoves.magical
            ? charData.specialMoves.magical : [];

        if (physicalMoves.length > MAX_SPECIAL_MOVES) {
            return {
                valid: false,
                message: 'Too many physical special moves.'
            };
        }
        if (magicalMoves.length > MAX_SPECIAL_MOVES) {
            return {
                valid: false,
                message: 'Too many magical special moves.'
            };
        }

        var allMoves = physicalMoves.concat(magicalMoves);
        for (var j = 0; j < allMoves.length; j++) {
            var move = allMoves[j];
            if (move.name &&
                move.name.length > MAX_MOVE_NAME_LENGTH) {
                return {
                    valid: false,
                    message: 'Move name exceeds maximum length.'
                };
            }
            if (move.description &&
                move.description.length >
                MAX_MOVE_DESCRIPTION_LENGTH) {
                return {
                    valid: false,
                    message: 'Move description exceeds maximum length.'
                };
            }
        }

        var stats = charData.stats || {};
        for (var k = 0; k < STAT_KEYS.length; k++) {
            var key = STAT_KEYS[k];
            var val = stats[key];
            if (val === undefined || val === null) { continue; }
            if (typeof val !== 'number' ||
                isNaN(val) ||
                val < STAT_MIN ||
                val > STAT_MAX) {
                return {
                    valid: false,
                    message: 'Stat "' + key + '" must be between ' +
                        STAT_MIN + ' and ' + STAT_MAX + '.'
                };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // NORMALISATION
    // ============================================================

    function normaliseCharacterData(charData) {
        var data = {};

        data.firstName = charData.firstName
            ? charData.firstName.trim() : '';
        data.lastName = charData.lastName
            ? charData.lastName.trim() : '';
        data.middleName = charData.middleName
            ? charData.middleName.trim() : '';
        data.nickname = charData.nickname
            ? charData.nickname.trim() : '';
        data.alias = charData.alias
            ? charData.alias.trim() : '';

        data.previousNames = Array.isArray(charData.previousNames)
            ? charData.previousNames
                .map(function(n) { return String(n || '').trim(); })
                .filter(function(n) { return n !== ''; })
            : [];

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

        if (charData.nameFormat !== undefined) {
            data.nameFormat = charData.nameFormat || 'firstlast';
        }

        data.gender = charData.gender ? charData.gender.trim() : '';
        data.birthYear = charData.birthYear
            ? String(charData.birthYear).trim() : '';
        data.eyes = charData.eyes ? charData.eyes.trim() : '';
        data.hair = charData.hair ? charData.hair.trim() : '';
        data.skin = charData.skin ? charData.skin.trim() : '';
        data.height = charData.height ? charData.height.trim() : '';
        data.weight = charData.weight ? charData.weight.trim() : '';
        data.build = charData.build ? charData.build.trim() : '';
        data.appearanceNotes = charData.appearanceNotes
            ? charData.appearanceNotes.trim() : '';

        data.specialty = charData.specialty
            ? charData.specialty.trim() : '';
        data.attraction = charData.attraction
            ? charData.attraction.trim() : '';
        data.sexuality = charData.sexuality
            ? charData.sexuality.trim() : '';
        data.notes = charData.notes ? charData.notes.trim() : '';
        data.combatNotes = charData.combatNotes
            ? charData.combatNotes.trim() : '';

        if (charData.graduatingClassId !== undefined) {
            data.graduatingClassId =
                charData.graduatingClassId || null;
        }
        if (charData.graduatingClassInstructor !== undefined) {
            data.graduatingClassInstructor =
                charData.graduatingClassInstructor === true;
        }

        data.isFiller = charData.isFiller === true;

        // NOTE: disciplineIds, classIds, parentIds, mode are NOT
        // normalised here. They are owned by dedicated mutations.

        data.stats = {};
        for (var i = 0; i < STAT_KEYS.length; i++) {
            var key = STAT_KEYS[i];
            var val = charData.stats &&
                charData.stats[key] !== undefined
                ? charData.stats[key]
                : STAT_DEFAULT;
            var numeric = Number(val);
            if (isNaN(numeric)) { numeric = STAT_DEFAULT; }
            data.stats[key] = Math.max(
                STAT_MIN,
                Math.min(STAT_MAX, Math.round(numeric))
            );
        }

        if (charData.magic !== undefined) {
            data.magic = {};
            var MagicConstants = window.MagicConstants;
            var magicKeys = MagicConstants &&
                MagicConstants.getTypeKeys
                ? MagicConstants.getTypeKeys()
                : Object.keys(charData.magic || {});
            var magicMax = MagicConstants &&
                typeof MagicConstants.MAGIC_MAX === 'number'
                ? MagicConstants.MAGIC_MAX
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

        var rawHP = charData.hp !== undefined &&
            charData.hp !== null &&
            charData.hp !== ''
            ? Number(charData.hp)
            : 0;
        if (isNaN(rawHP) || rawHP < 0) { rawHP = 0; }
        if (rawHP > HP_HARD_CAP) { rawHP = HP_HARD_CAP; }
        data.hp = Math.round(rawHP);

        var rawMP = charData.mp !== undefined &&
            charData.mp !== null &&
            charData.mp !== ''
            ? Number(charData.mp)
            : 0;
        if (isNaN(rawMP) || rawMP < 0) { rawMP = 0; }
        if (rawMP > MP_HARD_CAP) { rawMP = MP_HARD_CAP; }
        data.mp = Math.round(rawMP);

        if (charData.weapons !== undefined) {
            data.weapons = normaliseWeapons(charData.weapons);
        } else {
            data.weapons = [];
        }

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

        if (charData.careerStatus !== undefined) {
            data.careerStatus = Array.isArray(charData.careerStatus)
                ? charData.careerStatus.slice()
                : [];
        }

        if (charData.personality !== undefined) {
            data.personality = charData.personality
                ? Object.assign({}, charData.personality)
                : {};
        }

        data.deathYear = charData.deathYear
            ? String(charData.deathYear).trim() : '';
        data.deathCause = charData.deathCause
            ? charData.deathCause.trim() : '';

        if (charData.deathWeek !== undefined) {
            data.deathWeek = charData.deathWeek
                ? String(charData.deathWeek).trim() : '';
        }

        if (charData.deathAge !== undefined &&
            charData.deathAge !== null &&
            String(charData.deathAge).trim() !== '') {
            data.deathAge = String(charData.deathAge).trim();
        } else if (data.deathYear && data.birthYear) {
            var birthY = parseInt(data.birthYear, 10);
            var deathY = parseInt(data.deathYear, 10);
            if (!isNaN(birthY) &&
                !isNaN(deathY) &&
                deathY >= birthY) {
                data.deathAge = String(deathY - birthY);
            } else {
                data.deathAge = '';
            }
        } else {
            data.deathAge = '';
        }

        data.deceased = computeCachedDeceased(data);

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

        var normalised = normaliseCharacterData(formData);
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

        var existingChar = null;
        var name = normalised.firstName + ' ' + normalised.lastName;

        // Captured BEFORE the mutation. Used to detect a career
        // transition inside mutate().
        var previousLatestStatus = '';

        if (isEditing) {
            existingChar = CharacterQueries.getCharacterById(editId);
            if (!existingChar) {
                return Promise.resolve({
                    success: false,
                    message: 'Character not found.'
                });
            }
            name = CharacterQueries.getDisplayName(existingChar);
            previousLatestStatus = getLatestCareerStatus(
                existingChar.careerStatus
            );
        }

        var isFiller = normalised.isFiller === true;

        return MutationPipeline.performMutation({
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
                        existingChar, normalised, data, isFiller
                    );
                } else {
                    result = createNewCharacter(
                        normalised, data, isFiller
                    );
                }
                if (!result.success) {
                    throw new Error(
                        result.error || 'Failed to save character.'
                    );
                }

                // Career-transition cascade runs AFTER the character
                // is written, against the same snapshot.
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

    function updateExistingCharacter(
        existing,
        normalised,
        data,
        isFiller
    ) {
        var index = data.characters.findIndex(function(c) {
            return c && String(c.id) === String(existing.id);
        });

        if (index === -1) {
            return {
                success: false,
                error: 'Character not found in data store.'
            };
        }

        var current = data.characters[index];

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

        var merged = Object.assign({}, current, normalised, preserved);

        // ---- Career-status reconciliation. ----
        //
        // The form lets the user edit careerStatus rows freely.
        // Before persisting, close any gaps the user introduced:
        // each entry's endYear is rewritten to the next entry's
        // startYear. The latest entry keeps its own endYear.
        if (Array.isArray(merged.careerStatus)) {
            merged.careerStatus = merged.careerStatus.slice();
            closeOpenCareerEntries(merged.careerStatus);
        }

        var finalRecord = applyFillerStripIfSet(merged, isFiller);

        var existingKeys = Object.keys(current);
        for (var ek = 0; ek < existingKeys.length; ek++) {
            var key = existingKeys[ek];
            if (!Object.prototype.hasOwnProperty.call(
                finalRecord, key
            )) {
                delete current[key];
            }
        }

        var mergedKeys = Object.keys(finalRecord);
        for (var mk = 0; mk < mergedKeys.length; mk++) {
            current[mergedKeys[mk]] = finalRecord[mergedKeys[mk]];
        }

        invalidateCharacterIndex();

        var nextDeathYear = parseYearInt(current.deathYear);
        if (nextDeathYear !== null) {
            runDeathCascade(data, current.id, nextDeathYear);
        }

        return {
            success: true,
            id: current.id,
            character: current
        };
    }

    function createNewCharacter(normalised, data, isFiller) {
        var id = IdUtils.generateId('char');

        var newChar = Object.assign({}, normalised, {
            id: id,
            classIds: [],
            parentIds: [],
            hp: normalised.hp || 0,
            mp: normalised.mp || 0,
            weapons: Array.isArray(normalised.weapons)
                ? normalised.weapons : [],
            combatNotes: normalised.combatNotes || '',
            eliminations: [],
            eliminatedWeeks: [],
            createdAt: new Date().toISOString()
        });

        // Same reconciliation as updateExistingCharacter. On create
        // the careerStatus array is whatever the form submitted.
        if (Array.isArray(newChar.careerStatus)) {
            newChar.careerStatus = newChar.careerStatus.slice();
            closeOpenCareerEntries(newChar.careerStatus);
        }

        newChar = applyFillerStripIfSet(newChar, isFiller);

        data.characters.push(newChar);
        invalidateCharacterIndex();

        var nextDeathYear = parseYearInt(newChar.deathYear);
        if (nextDeathYear !== null) {
            runDeathCascade(data, id, nextDeathYear);
        }

        return { success: true, id: id, character: newChar };
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
                data: { updated: 0, stripped: 0 }
            });
        }

        var Strip = getCharacterStrip();

        return MutationPipeline.performMutation({
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

                var updated = 0;
                var stripped = 0;

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

                    char.isFiller = value;
                    char.updatedAt = new Date().toISOString();
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

                return { updated: updated, stripped: stripped };
            },

            logMessage: function(result) {
                var verb = value ? 'Flagged' : 'Unflagged';
                return verb + ' ' + result.updated +
                    ' character' + (result.updated === 1 ? '' : 's') +
                    ' as filler' +
                    (value && result.stripped > 0
                        ? ' (' + result.stripped + ' stripped)'
                        : '') + '.';
            },

            successMessage: function(result) {
                if (value) {
                    return 'Flagged ' + result.updated +
                        ' character' +
                        (result.updated === 1 ? '' : 's') +
                        ' as filler.';
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

        var normalised = normaliseCharacterData(childDto);
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

        var childId = IdUtils.generateId('char');
        var now = new Date().toISOString();

        var childRecord = Object.assign({}, normalised, {
            id: childId,
            classIds: [],
            parentIds: [parentAIdStr, parentBIdStr],
            hp: normalised.hp || 0,
            mp: normalised.mp || 0,
            weapons: Array.isArray(normalised.weapons)
                ? normalised.weapons : [],
            combatNotes: normalised.combatNotes || '',
            eliminations: [],
            eliminatedWeeks: [],
            createdAt: now
        });

        return MutationPipeline.performMutation({
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

                data.characters.push(childRecord);
                invalidateCharacterIndex();

                var SocialCore = getSocialCore();
                if (SocialCore &&
                    typeof SocialCore.addRelationshipsInTransaction ===
                    'function') {
                    var relationships = buildChildRelationships(
                        data, childRecord, parentA, parentB
                    );
                    SocialCore.addRelationshipsInTransaction(
                        data, relationships
                    );
                } else {
                    console.warn(
                        '[CharacterCRUD] SocialCore unavailable; ' +
                        'child created without social links.'
                    );
                }

                return { child: childRecord, childId: childId };
            },

            logMessage: function() {
                return 'Created child of ' + parentAName +
                    ' and ' + parentBName + ': ' +
                    childRecord.firstName + ' ' +
                    childRecord.lastName;
            },

            successMessage: 'Child created successfully!',
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

        function siblingTermFor(char) {
            var sex = normalisedSexOf(char);
            if (sex === 'female') { return 'Sister'; }
            if (sex === 'male') { return 'Brother'; }
            return 'Sibling';
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

        // Siblings.
        var parentIdSet = Object.create(null);
        parentIdSet[String(parentA.id)] = true;
        parentIdSet[String(parentB.id)] = true;

        var siblings = [];
        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (!c || !c.id) { continue; }
            if (String(c.id) === String(childRecord.id)) { continue; }
            if (!Array.isArray(c.parentIds)) { continue; }
            for (var j = 0; j < c.parentIds.length; j++) {
                if (parentIdSet[String(c.parentIds[j])]) {
                    siblings.push(c);
                    break;
                }
            }
        }

        for (var s = 0; s < siblings.length; s++) {
            var sib = siblings[s];

            list.push({
                character1: String(childRecord.id),
                character2: String(sib.id),
                typeId: 'familial',
                clarification1: siblingTermFor(sib),
                clarification2: siblingTermFor(childRecord),
                startYear: '',
                endYear: '',
                notes: ''
            });
            list.push({
                character1: String(sib.id),
                character2: String(childRecord.id),
                typeId: 'familial',
                clarification1: siblingTermFor(childRecord),
                clarification2: siblingTermFor(sib),
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

        return MutationPipeline.performMutation({
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

        var targetChar = String(charId);
        var targetClass = String(classId);
        var targetRole = isInstructor
            ? ROLE_INSTRUCTOR : ROLE_STUDENT;

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

        return MutationPipeline.performMutation({
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
                var label = targetRole === ROLE_INSTRUCTOR
                    ? 'instructor' : 'student';
                return 'Set ' + name + ' as ' + label +
                    ' for class ' + targetClass +
                    (result.intervalsChanged > 0
                        ? ' (' + result.intervalsChanged +
                            ' interval(s))'
                        : ' (no change)');
            },

            successMessage: function(result) {
                var label = targetRole === ROLE_INSTRUCTOR
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
    // Appends (or updates) a terminal careerStatus entry and runs
    // the professional-team cascade in the same transaction.
    //
    // Idempotent: repeated calls with the same (statusKey, year)
    // produce the same array; the cascade finds no open stints on
    // the second call.
    //
    // CLOSES THE PREVIOUS STATUS:
    //   Before appending the new terminal entry, every other entry
    //   that is still open (blank endYear) or that ends before the
    //   new entry's year is extended to end at that year. This
    //   guarantees no gaps and no two simultaneous open entries.

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

        var targetChar = String(charId);

        var normalisedStatus =
            (statusKey === undefined || statusKey === null)
                ? ''
                : String(statusKey).trim().toLowerCase();

        if (!isCareerTransitionStatus(normalisedStatus)) {
            return Promise.resolve({
                success: false,
                message: 'Status must be one of: retired, support, ' +
                    'instructor.'
            });
        }

        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) {
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
        var name = CharacterQueries.getDisplayName(char);

        var statusLabel = normalisedStatus.charAt(0).toUpperCase() +
            normalisedStatus.slice(1);

        return MutationPipeline.performMutation({
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

                // Rebuild careerStatus: drop any existing entry with
                // the same terminal status, then append the fresh
                // one. Repeated calls with the same status + year
                // are no-ops on the array contents.
                var existing = Array.isArray(target.careerStatus)
                    ? target.careerStatus : [];
                var kept = [];
                for (var j = 0; j < existing.length; j++) {
                    var e = existing[j];
                    if (!e || typeof e !== 'object') { continue; }

                    var s = e.status !== undefined &&
                        e.status !== null
                        ? String(e.status).trim().toLowerCase()
                        : '';

                    var formerIdx = s.indexOf(' (former)');
                    if (formerIdx !== -1) {
                        s = s.substring(0, formerIdx).trim();
                    }
                    if (s === normalisedStatus) { continue; }
                    kept.push(e);
                }

                kept.push({
                    status: normalisedStatus,
                    startYear: yearStr,
                    endYear: '',
                    title: ''
                });

                // Close every other entry at yearStr. Entries whose
                // endYear is already earlier are extended; entries
                // that are still open are closed. The new entry is
                // the latest-start entry by construction, so it
                // keeps its blank endYear after reconciliation.
                closeOpenCareerEntries(kept);

                target.careerStatus = kept;
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
    // CLOSES GAPS:
    //   Incoming stages are walked in chronological order. Each
    //   stage's endYear is rewritten to the next stage's startYear.
    //   The final stage keeps whatever endYear the caller supplied
    //   (usually blank for an ongoing status). This guarantees no
    //   gaps and no simultaneous open entries.

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

            var startNum = parseInt(
                String(row.startYear || '').trim(), 10
            );
            if (isNaN(startNum) || startNum < 1) {
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
                endNum = parseInt(endStr, 10);
                if (isNaN(endNum) || endNum < 1) {
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
                startYear: String(startNum),
                endYear: endNum === null ? '' : String(endNum),
                title: row.title !== undefined &&
                    row.title !== null
                    ? String(row.title).trim()
                    : ''
            });
        }

        // ---- Reconcile endYear against the next stage's startYear. ----
        //
        // The wizard produces stages in chronological order, so this
        // is a simple forward walk. Each stage's endYear is set to
        // the next stage's startYear. The last stage keeps its own
        // endYear (blank means ongoing).
        //
        // Any stage whose endYear is explicitly set and later than
        // the next stage's startYear is left alone; the schema's
        // validator would reject it and there is no sensible
        // reconciliation for an internally inconsistent input.
        for (var s = 0; s < cleanStages.length - 1; s++) {
            var cur = cleanStages[s];
            var nxt = cleanStages[s + 1];

            var nextStart = parseInt(nxt.startYear, 10);
            if (isNaN(nextStart)) { continue; }

            cur.endYear = String(nextStart);
        }

        var char = CharacterQueries.getCharacterById(targetChar);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }
        var name = CharacterQueries.getDisplayName(char);

        var previousLatestStatus = getLatestCareerStatus(
            char.careerStatus
        );

        return MutationPipeline.performMutation({
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

                // Deep-copy the reconciled stages before assignment.
                var finalStages = [];
                for (var j = 0; j < cleanStages.length; j++) {
                    finalStages.push({
                        status: cleanStages[j].status,
                        startYear: cleanStages[j].startYear,
                        endYear: cleanStages[j].endYear,
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

        var targetId = String(id);

        var char = CharacterQueries.getCharacterById(targetId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
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
                    academyCascade: null
                };

                if (Array.isArray(data.teams)) {
                    data.teams.forEach(function(team) {
                        if (!team || !Array.isArray(team.members)) {
                            return;
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
                    });
                }

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

                var Cascade = getAcademyCascade();
                if (Cascade &&
                    typeof Cascade.characterDeleted === 'function') {
                    cascade.academyCascade = Cascade.characterDeleted(
                        data, targetId
                    );
                }

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

        if (!confirm('Delete ALL characters permanently? ' +
            'This cannot be undone.')) {
            return Promise.resolve({
                success: false,
                message: 'Operation cancelled.'
            });
        }

        return MutationPipeline.performMutation({
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

                if (Array.isArray(data.teams)) {
                    data.teams.forEach(function(team) {
                        if (Array.isArray(team.members)) {
                            team.members = [];
                        }
                    });
                }

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

})();
