/**
 * js/modules/characters/character-crud.js - Character CRUD Operations
 * Path: js/modules/characters/character-crud.js
 *
 * [unchanged header — see previous version]
 *
 * CHILD RELATIONSHIPS:
 *   createChild writes familial relationships with the two-sided
 *   clarification shape:
 *     { character1: parent, character2: child,
 *       clarification1: 'Mother' | 'Father' | 'Parent',
 *       clarification2: 'Son' | 'Daughter' }
 *   and sibling relationships with
 *     { character1: child, character2: sibling,
 *       clarification1: 'Sister' | 'Brother',
 *       clarification2: 'Sister' | 'Brother' }
 *   The `clarification` (legacy) field is not written.
 */

(function() {
    'use strict';

    if (window.__characterCrudLoaded) {
        return;
    }
    window.__characterCrudLoaded = true;

    var CharacterQueries = window.CharacterQueries;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;
    var CharacterConstants = window.CharacterConstants;

    var STAT_KEYS = CharacterConstants.STAT_KEYS;
    var STAT_MIN = CharacterConstants.STAT_MIN;
    var STAT_MAX = CharacterConstants.STAT_MAX;
    var STAT_DEFAULT = CharacterConstants.STAT_DEFAULT;
    var MAX_SPECIAL_MOVES = CharacterConstants.MAX_SPECIAL_MOVES;
    var MAX_MOVE_NAME_LENGTH = CharacterConstants.MAX_MOVE_NAME_LENGTH;
    var MAX_MOVE_DESCRIPTION_LENGTH = CharacterConstants.MAX_MOVE_DESCRIPTION_LENGTH;

    var HP_HARD_CAP = 999;
    var MP_HARD_CAP = 999;

    var MAX_WEAPONS = CharacterConstants.MAX_WEAPONS;
    var MAX_WEAPON_NAME_LENGTH = CharacterConstants.MAX_WEAPON_NAME_LENGTH;
    var MAX_WEAPON_NOTES_LENGTH = CharacterConstants.MAX_WEAPON_NOTES_LENGTH;
    var DEFAULT_WEAPON_TYPE = CharacterConstants.DEFAULT_WEAPON_TYPE;

    var VALID_MODES = ['student', 'instructor'];
    var DEFAULT_MODE = 'student';

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }
        if (!CharacterConstants) { missing.push('CharacterConstants'); }

        if (missing.length > 0) {
            console.warn('CharacterCRUD: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

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

    function getAcademyCascade() {
        return window.AcademyCascade || null;
    }

    function getTeamCore() {
        return window.TeamCore || null;
    }

    function getSocialCore() {
        return window.SocialCore || null;
    }

    function getSocialChildFactory() {
        return window.SocialChildFactory || null;
    }

    function isValidMode(mode) {
        return mode === 'student' || mode === 'instructor';
    }

    function parseDeathYear(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    function runDeathCascade(data, charId, deathYear, contextLabel) {
        var TeamCore = getTeamCore();
        if (!TeamCore ||
            typeof TeamCore.endStintsForCharacter !== 'function') {
            console.warn(
                '[CharacterCRUD] Death cascade skipped (' +
                contextLabel + ') for character ' + charId +
                ': TeamCore.endStintsForCharacter is unavailable. ' +
                'Open professional stints, if any, were not ended.'
            );
            return null;
        }
        return TeamCore.endStintsForCharacter(data, charId, deathYear);
    }

    // ============================================================
    // WEAPON NORMALISATION
    // ============================================================

    function normaliseWeapon(weapon) {
        if (!weapon || typeof weapon !== 'object' || Array.isArray(weapon)) {
            return null;
        }

        var id = (typeof weapon.id === 'string' && weapon.id)
            ? weapon.id
            : (IdUtils && typeof IdUtils.generateId === 'function'
                ? IdUtils.generateId('weapon')
                : 'weapon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));

        var name = typeof weapon.name === 'string' ? weapon.name.trim() : '';
        if (name.length > MAX_WEAPON_NAME_LENGTH) {
            name = name.slice(0, MAX_WEAPON_NAME_LENGTH);
        }

        var type = typeof weapon.type === 'string' && weapon.type
            ? weapon.type
            : DEFAULT_WEAPON_TYPE;
        if (CharacterConstants && typeof CharacterConstants.isValidWeaponType === 'function') {
            if (!CharacterConstants.isValidWeaponType(type)) {
                type = DEFAULT_WEAPON_TYPE;
            }
        }

        var notes = typeof weapon.notes === 'string' ? weapon.notes.trim() : '';
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
                    : 'weapon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
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
            return { valid: false, message: 'First name is required.' };
        }
        if (!charData.lastName || charData.lastName.trim() === '') {
            return { valid: false, message: 'Last name is required.' };
        }

        var hasDeathYear = charData.deathYear !== undefined &&
                           charData.deathYear !== null &&
                           String(charData.deathYear).trim() !== '';
        if (hasDeathYear) {
            var year = parseInt(charData.deathYear, 10);
            if (isNaN(year) || year < 1) {
                return { valid: false, message: 'Death Year must be a positive number.' };
            }
        }

        if (charData.deathAge !== undefined && charData.deathAge !== null &&
            String(charData.deathAge).trim() !== '') {
            var age = parseInt(charData.deathAge, 10);
            if (isNaN(age) || age < 0 || age > 999) {
                return { valid: false, message: 'Death Age must be a valid age.' };
            }
        }

        if (charData.deathWeek !== undefined && charData.deathWeek !== null &&
            String(charData.deathWeek).trim() !== '') {
            var week = parseInt(charData.deathWeek, 10);
            if (isNaN(week) || week < 1 || week > 52) {
                return { valid: false, message: 'Death Week must be between 1 and 52.' };
            }
        }

        if (charData.hp !== undefined && charData.hp !== null && charData.hp !== '') {
            var hp = Number(charData.hp);
            if (isNaN(hp) || hp < 0 || hp > HP_HARD_CAP) {
                return { valid: false, message: 'HP must be a number between 0 and ' + HP_HARD_CAP + '.' };
            }
        }
        if (charData.mp !== undefined && charData.mp !== null && charData.mp !== '') {
            var mp = Number(charData.mp);
            if (isNaN(mp) || mp < 0 || mp > MP_HARD_CAP) {
                return { valid: false, message: 'MP must be a number between 0 and ' + MP_HARD_CAP + '.' };
            }
        }

        if (charData.weapons !== undefined) {
            if (!Array.isArray(charData.weapons)) {
                return { valid: false, message: 'Weapons must be an array.' };
            }
            if (charData.weapons.length > MAX_WEAPONS) {
                return { valid: false, message: 'Too many weapons. Maximum is ' + MAX_WEAPONS + '.' };
            }
            for (var i = 0; i < charData.weapons.length; i++) {
                var w = charData.weapons[i];
                if (!w || typeof w !== 'object' || Array.isArray(w)) {
                    return { valid: false, message: 'Weapon entry at index ' + i + ' is invalid.' };
                }
                if (w.name && w.name.length > MAX_WEAPON_NAME_LENGTH) {
                    return { valid: false, message: 'Weapon name exceeds maximum length of ' + MAX_WEAPON_NAME_LENGTH + '.' };
                }
                if (w.notes && w.notes.length > MAX_WEAPON_NOTES_LENGTH) {
                    return { valid: false, message: 'Weapon notes exceed maximum length of ' + MAX_WEAPON_NOTES_LENGTH + '.' };
                }
                if (w.type && CharacterConstants && typeof CharacterConstants.isValidWeaponType === 'function') {
                    if (!CharacterConstants.isValidWeaponType(w.type)) {
                        return { valid: false, message: 'Weapon type "' + w.type + '" is not recognised.' };
                    }
                }
            }
        }

        var physicalMoves = charData.specialMoves && charData.specialMoves.physical ? charData.specialMoves.physical : [];
        var magicalMoves = charData.specialMoves && charData.specialMoves.magical ? charData.specialMoves.magical : [];

        if (physicalMoves.length > MAX_SPECIAL_MOVES) {
            return { valid: false, message: 'Too many physical special moves. Maximum is ' + MAX_SPECIAL_MOVES + '.' };
        }
        if (magicalMoves.length > MAX_SPECIAL_MOVES) {
            return { valid: false, message: 'Too many magical special moves. Maximum is ' + MAX_SPECIAL_MOVES + '.' };
        }

        var allMoves = physicalMoves.concat(magicalMoves);
        for (var j = 0; j < allMoves.length; j++) {
            var move = allMoves[j];
            if (move.name && move.name.length > MAX_MOVE_NAME_LENGTH) {
                return { valid: false, message: 'Move name exceeds maximum length of ' + MAX_MOVE_NAME_LENGTH + ' characters.' };
            }
            if (move.description && move.description.length > MAX_MOVE_DESCRIPTION_LENGTH) {
                return { valid: false, message: 'Move description exceeds maximum length of ' + MAX_MOVE_DESCRIPTION_LENGTH + ' characters.' };
            }
        }

        var stats = charData.stats || {};
        for (var k = 0; k < STAT_KEYS.length; k++) {
            var key = STAT_KEYS[k];
            var val = stats[key];
            if (val === undefined || val === null) { continue; }
            if (typeof val !== 'number' || isNaN(val) || val < STAT_MIN || val > STAT_MAX) {
                return { valid: false, message: 'Stat "' + key + '" must be between ' + STAT_MIN + ' and ' + STAT_MAX + '.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // NORMALISATION
    // ============================================================

    function normaliseCharacterData(charData) {
        var data = {};

        data.firstName = charData.firstName ? charData.firstName.trim() : '';
        data.lastName = charData.lastName ? charData.lastName.trim() : '';
        data.middleName = charData.middleName ? charData.middleName.trim() : '';
        data.nickname = charData.nickname ? charData.nickname.trim() : '';
        data.alias = charData.alias ? charData.alias.trim() : '';

        data.previousNames = Array.isArray(charData.previousNames)
            ? charData.previousNames
                .map(function(n) { return String(n || '').trim(); })
                .filter(function(n) { return n !== ''; })
            : [];

        var incomingDp = charData.displayParts && typeof charData.displayParts === 'object'
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
        data.birthYear = charData.birthYear ? String(charData.birthYear).trim() : '';
        data.eyes = charData.eyes ? charData.eyes.trim() : '';
        data.hair = charData.hair ? charData.hair.trim() : '';
        data.skin = charData.skin ? charData.skin.trim() : '';
        data.height = charData.height ? charData.height.trim() : '';
        data.weight = charData.weight ? charData.weight.trim() : '';
        data.build = charData.build ? charData.build.trim() : '';
        data.appearanceNotes = charData.appearanceNotes ? charData.appearanceNotes.trim() : '';

        data.specialty = charData.specialty ? charData.specialty.trim() : '';
        data.attraction = charData.attraction ? charData.attraction.trim() : '';
        data.sexuality = charData.sexuality ? charData.sexuality.trim() : '';
        data.notes = charData.notes ? charData.notes.trim() : '';
        data.combatNotes = charData.combatNotes ? charData.combatNotes.trim() : '';

        if (charData.graduatingClassId !== undefined) {
            data.graduatingClassId = charData.graduatingClassId || null;
        }
        if (charData.graduatingClassInstructor !== undefined) {
            data.graduatingClassInstructor = charData.graduatingClassInstructor === true;
        }

        data.stats = {};
        for (var i = 0; i < STAT_KEYS.length; i++) {
            var key = STAT_KEYS[i];
            var val = charData.stats && charData.stats[key] !== undefined
                ? charData.stats[key]
                : STAT_DEFAULT;
            var numeric = Number(val);
            if (isNaN(numeric)) { numeric = STAT_DEFAULT; }
            data.stats[key] = Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(numeric)));
        }

        if (charData.magic !== undefined) {
            data.magic = {};
            var MagicConstants = window.MagicConstants;
            var magicKeys = MagicConstants && MagicConstants.getTypeKeys
                ? MagicConstants.getTypeKeys()
                : Object.keys(charData.magic || {});
            var magicMax = MagicConstants && typeof MagicConstants.MAGIC_MAX === 'number'
                ? MagicConstants.MAGIC_MAX : 10;
            for (var m = 0; m < magicKeys.length; m++) {
                var mKey = magicKeys[m];
                var rawMagic = charData.magic && charData.magic[mKey] !== undefined
                    ? Number(charData.magic[mKey]) : 0;
                if (isNaN(rawMagic)) { rawMagic = 0; }
                data.magic[mKey] = Math.max(0, Math.min(magicMax, Math.round(rawMagic)));
            }
        }

        var rawHP = charData.hp !== undefined && charData.hp !== null && charData.hp !== ''
            ? Number(charData.hp) : 0;
        if (isNaN(rawHP) || rawHP < 0) { rawHP = 0; }
        if (rawHP > HP_HARD_CAP) { rawHP = HP_HARD_CAP; }
        data.hp = Math.round(rawHP);

        var rawMP = charData.mp !== undefined && charData.mp !== null && charData.mp !== ''
            ? Number(charData.mp) : 0;
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
                physical: Array.isArray(charData.specialMoves && charData.specialMoves.physical)
                    ? charData.specialMoves.physical.slice() : [],
                magical: Array.isArray(charData.specialMoves && charData.specialMoves.magical)
                    ? charData.specialMoves.magical.slice() : []
            };
        }

        if (charData.careerStatus !== undefined) {
            data.careerStatus = Array.isArray(charData.careerStatus)
                ? charData.careerStatus.slice() : [];
        }

        if (charData.personality !== undefined) {
            data.personality = charData.personality ? Object.assign({}, charData.personality) : {};
        }

        data.deathYear = charData.deathYear ? String(charData.deathYear).trim() : '';
        data.deathCause = charData.deathCause ? charData.deathCause.trim() : '';

        if (charData.deathWeek !== undefined) {
            data.deathWeek = charData.deathWeek ? String(charData.deathWeek).trim() : '';
        }

        if (charData.deathAge !== undefined && charData.deathAge !== null &&
            String(charData.deathAge).trim() !== '') {
            data.deathAge = String(charData.deathAge).trim();
        } else if (data.deathYear && data.birthYear) {
            var birthY = parseInt(data.birthYear, 10);
            var deathY = parseInt(data.deathYear, 10);
            if (!isNaN(birthY) && !isNaN(deathY) && deathY >= birthY) {
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
                message: 'Dependencies not loaded. Please refresh the page.'
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
        var isEditing = editId !== null && editId !== undefined && editId !== '';

        var existingChar = null;
        var name = normalised.firstName + ' ' + normalised.lastName;

        if (isEditing) {
            existingChar = CharacterQueries.getCharacterById(editId);
            if (!existingChar) {
                return Promise.resolve({
                    success: false,
                    message: 'Character not found.'
                });
            }
            name = CharacterQueries.getDisplayName(existingChar);
        }

        return MutationPipeline.performMutation({
            validate: function() {
                var reValidation = validateCharacter(normalised);
                if (!reValidation.valid) {
                    return { valid: false, message: reValidation.message };
                }
                if (isEditing) {
                    var currentChar = CharacterQueries.getCharacterById(editId);
                    if (!currentChar) {
                        return { valid: false, message: 'Character no longer exists.' };
                    }
                }
                return { valid: true };
            },
            mutate: function(data) {
                var result;
                if (isEditing) {
                    result = updateExistingCharacter(existingChar, normalised, data);
                } else {
                    result = createNewCharacter(normalised, data);
                }
                if (!result.success) {
                    throw new Error(result.error || 'Failed to save character.');
                }
                return {
                    id: result.id,
                    character: result.character,
                    isNew: !isEditing
                };
            },
            logMessage: function() {
                return isEditing
                    ? 'Updated character: ' + name
                    : 'Created character: ' + name;
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

    function updateExistingCharacter(existing, normalised, data) {
        var index = data.characters.findIndex(function(c) {
            return c && String(c.id) === String(existing.id);
        });
        if (index === -1) {
            return { success: false, error: 'Character not found in data store.' };
        }

        var current = data.characters[index];

        var preserved = {
            id: current.id,
            createdAt: current.createdAt,
            classIds: Array.isArray(current.classIds) ? current.classIds.slice() : [],
            parentIds: Array.isArray(current.parentIds) ? current.parentIds.slice() : [],
            mode: (current.mode === 'student' || current.mode === 'instructor')
                ? current.mode : DEFAULT_MODE,
            eliminations: Array.isArray(current.eliminations) ? current.eliminations.slice() : [],
            eliminatedWeeks: Array.isArray(current.eliminatedWeeks) ? current.eliminatedWeeks.slice() : []
        };

        if (Array.isArray(current.disciplineIds)) {
            preserved.disciplineIds = current.disciplineIds.slice();
        }

        var updated = Object.assign({}, current, normalised, preserved);
        data.characters[index] = updated;

        var nextDeathYear = parseDeathYear(updated.deathYear);
        if (nextDeathYear !== null) {
            runDeathCascade(data, updated.id, nextDeathYear, 'save');
        }

        return { success: true, id: updated.id, character: updated };
    }

    function createNewCharacter(normalised, data) {
        var id = IdUtils.generateId('char');

        var newChar = Object.assign({}, normalised, {
            id: id,
            classIds: [],
            parentIds: [],
            mode: DEFAULT_MODE,
            hp: normalised.hp || 0,
            mp: normalised.mp || 0,
            weapons: Array.isArray(normalised.weapons) ? normalised.weapons : [],
            combatNotes: normalised.combatNotes || '',
            eliminations: [],
            eliminatedWeeks: [],
            createdAt: new Date().toISOString()
        });

        data.characters.push(newChar);

        var nextDeathYear = parseDeathYear(newChar.deathYear);
        if (nextDeathYear !== null) {
            runDeathCascade(data, id, nextDeathYear, 'create');
        }

        return { success: true, id: id, character: newChar };
    }

    // ============================================================
    // CREATE CHILD
    // ============================================================

    function createChild(parentAId, parentBId, options) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
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
            childDto = SocialChildFactory.buildChildDto(parentA, parentB, options);
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
                message: 'Generated child is invalid: ' + validation.message
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
            mode: DEFAULT_MODE,
            hp: normalised.hp || 0,
            mp: normalised.mp || 0,
            weapons: Array.isArray(normalised.weapons) ? normalised.weapons : [],
            combatNotes: normalised.combatNotes || '',
            eliminations: [],
            eliminatedWeeks: [],
            createdAt: now
        });

        return MutationPipeline.performMutation({
            validate: function() {
                var a = CharacterQueries.getCharacterById(parentAIdStr);
                var b = CharacterQueries.getCharacterById(parentBIdStr);
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

                var SocialCore = getSocialCore();
                if (SocialCore &&
                    typeof SocialCore.addRelationshipsInTransaction === 'function') {
                    var relationships = buildChildRelationships(
                        data,
                        childRecord,
                        parentA,
                        parentB
                    );
                    SocialCore.addRelationshipsInTransaction(data, relationships);
                } else {
                    console.warn(
                        '[CharacterCRUD] SocialCore.' +
                        'addRelationshipsInTransaction is unavailable; ' +
                        'child was created without social links.'
                    );
                }

                return { child: childRecord, childId: childId };
            },
            logMessage: function() {
                return 'Created child of ' + parentAName +
                    ' and ' + parentBName + ': ' +
                    childRecord.firstName + ' ' + childRecord.lastName;
            },
            successMessage: 'Child created successfully!',
            failureMessage: 'Failed to create child.'
        });
    }

    /**
     * Build the list of social relationships the child gets on
     * creation. Two-sided clarifications:
     *
     *   parentA (side 1) -> child (side 2):
     *     clarification1 = parent's role toward child
     *                     ('Mother' | 'Father' | 'Parent')
     *     clarification2 = child's role toward parent
     *                     ('Son' | 'Daughter')
     *
     *   Same for parentB.
     *
     *   sibling <-> child:
     *     clarification1 and clarification2 = the role each side
     *     plays toward the other, based on that side's own gender.
     */
    function buildChildRelationships(data, childRecord, parentA, parentB) {
        var list = [];

        function normalisedSexOf(char) {
            if (!char) { return null; }
            var g = String(char.gender || '').trim().toLowerCase();
            if (g === 'female' || g === 'f' || g === 'woman' || g === 'girl') {
                return 'female';
            }
            if (g === 'male' || g === 'm' || g === 'man' || g === 'boy') {
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

        // Parent A -> child
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
        // Child -> parent A
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

        // Parent B -> child
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
        // Child -> parent B
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

        // Siblings: any existing character sharing at least one
        // parent with the new child.
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

            // child -> sibling
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

            // sibling -> child
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
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        var TeamCore = getTeamCore();
        if (!TeamCore ||
            typeof TeamCore.endStintsForCharacter !== 'function') {
            return Promise.resolve({
                success: false,
                message: 'TeamCore.endStintsForCharacter is unavailable; ' +
                    'cannot backfill death cascades.'
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
                var teamsTouchedSet = Object.create(null);

                for (var i = 0; i < data.characters.length; i++) {
                    var char = data.characters[i];
                    if (!char || typeof char !== 'object') { continue; }
                    if (!char.id) { continue; }

                    var deathYear = parseDeathYear(char.deathYear);
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
                        for (var t = 0; t < data.teams.length; t++) {
                            var team = data.teams[t];
                            if (!team || typeof team !== 'object') { continue; }
                            if (team.type !== 'professional') { continue; }
                            if (!Array.isArray(team.members)) { continue; }
                            if (!team.id) { continue; }

                            var targetId = String(char.id);
                            var deathStr = String(deathYear);

                            for (var m = 0; m < team.members.length; m++) {
                                var member = team.members[m];
                                if (!member || typeof member !== 'object') { continue; }
                                if (String(member.characterId) !== targetId) { continue; }
                                if (!Array.isArray(member.intervals)) { continue; }

                                for (var iv = 0; iv < member.intervals.length; iv++) {
                                    var interval = member.intervals[iv];
                                    if (!interval || typeof interval !== 'object') { continue; }
                                    if (String(interval.leavePeriod) === deathStr) {
                                        teamsTouchedSet[String(team.id)] = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                return {
                    charactersScanned: charactersScanned,
                    charactersWithStintsEnded: charactersWithStintsEnded,
                    stintsEnded: stintsEndedTotal,
                    teamsTouched: Object.keys(teamsTouchedSet).length
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
    // SET MODE
    // ============================================================

    function setMode(charId, mode) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (!isValidMode(mode)) {
            return Promise.resolve({
                success: false,
                message: 'Invalid mode. Must be one of: ' + VALID_MODES.join(', ') + '.'
            });
        }

        var targetId = String(charId);
        var char = CharacterQueries.getCharacterById(targetId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var currentMode = (char.mode === 'student' || char.mode === 'instructor')
            ? char.mode : DEFAULT_MODE;

        if (currentMode === mode) {
            return Promise.resolve({
                success: true,
                data: { characterId: targetId, mode: mode, changed: false }
            });
        }

        var name = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function() {
                var currentChar = CharacterQueries.getCharacterById(targetId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is not available.');
                }

                var found = null;
                for (var i = 0; i < data.characters.length; i++) {
                    var c = data.characters[i];
                    if (c && String(c.id) === targetId) {
                        found = c;
                        break;
                    }
                }
                if (!found) {
                    throw new Error('Character not found in data store.');
                }

                found.mode = mode;
                found.updatedAt = new Date().toISOString();

                return { characterId: targetId, mode: mode, changed: true };
            },
            logMessage: function() {
                var label = mode === 'instructor' ? 'instructor' : 'student';
                return 'Set ' + name + ' to ' + label + ' mode';
            },
            successMessage: function() {
                var label = mode === 'instructor' ? 'Instructor' : 'Student';
                return label + ' mode enabled.';
            },
            failureMessage: 'Failed to set character mode.'
        });
    }

    // ============================================================
    // DELETE CHARACTER
    // ============================================================

    function deleteCharacter(id) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
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
                var currentChar = CharacterQueries.getCharacterById(targetId);
                if (!currentChar) {
                    return { valid: false, message: 'Character no longer exists.' };
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
                        if (!team || !Array.isArray(team.members)) { return; }
                        var before = team.members.length;
                        team.members = team.members.filter(function(m) {
                            return !m || String(m.characterId) !== targetId;
                        });
                        cascade.teamMembershipsRemoved += before - team.members.length;
                    });
                }

                if (Array.isArray(data.characters)) {
                    for (var ci = 0; ci < data.characters.length; ci++) {
                        var c = data.characters[ci];
                        if (!c || !Array.isArray(c.parentIds)) { continue; }
                        var before2 = c.parentIds.length;
                        c.parentIds = c.parentIds.filter(function(pid) {
                            return String(pid) !== targetId;
                        });
                        cascade.parentRefsStripped += before2 - c.parentIds.length;
                    }
                }

                var Cascade = getAcademyCascade();
                if (Cascade && typeof Cascade.characterDeleted === 'function') {
                    cascade.academyCascade = Cascade.characterDeleted(data, targetId);
                }

                var found = false;
                data.characters = data.characters.filter(function(c) {
                    if (c && String(c.id) === targetId) {
                        found = true;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Character not found in data store.');
                }

                return { deleted: true, cascade: cascade };
            },
            logMessage: function(result) {
                var c = result.cascade || {};
                var details = [];

                if (c.teamMembershipsRemoved > 0) {
                    details.push(c.teamMembershipsRemoved + ' team membership(s)');
                }
                if (c.parentRefsStripped > 0) {
                    details.push(c.parentRefsStripped + ' parent reference(s)');
                }

                if (c.academyCascade) {
                    var Cascade = getAcademyCascade();
                    if (Cascade && typeof Cascade.formatSummary === 'function') {
                        var summary = Cascade.formatSummary(c.academyCascade);
                        if (summary) {
                            details.push(summary.replace(/^\(|\)$/g, ''));
                        }
                    }
                }

                var suffix = details.length > 0 ? ' (' + details.join(', ') + ')' : '';
                return 'Deleted character: ' + name + suffix;
            },
            successMessage: 'Character deleted successfully!',
            failureMessage: 'Failed to delete character.'
        });
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    function deleteAllCharacters() {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }
        if (!confirm('Delete ALL characters permanently? This cannot be undone.')) {
            return Promise.resolve({
                success: false,
                message: 'Operation cancelled.'
            });
        }

        return MutationPipeline.performMutation({
            validate: function(data) {
                var count = Array.isArray(data.characters) ? data.characters.length : 0;
                if (count === 0) {
                    return { valid: false, message: 'No characters to delete.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var count = Array.isArray(data.characters) ? data.characters.length : 0;

                if (Array.isArray(data.teams)) {
                    data.teams.forEach(function(team) {
                        if (Array.isArray(team.members)) { team.members = []; }
                    });
                }
                data.characters = [];

                return { deletedCount: count };
            },
            logMessage: function(result) {
                return 'Deleted all characters (' + result.deletedCount + ')';
            },
            successMessage: function(result) {
                return 'Deleted ' + result.deletedCount + ' characters.';
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

        setMode: setMode,
        createChild: createChild,
        backfillDeathCascades: backfillDeathCascades,

        validateCharacter: validateCharacter,
        normaliseCharacterData: normaliseCharacterData,

        VALID_MODES: Object.freeze(VALID_MODES.slice()),
        DEFAULT_MODE: DEFAULT_MODE
    });

})();
