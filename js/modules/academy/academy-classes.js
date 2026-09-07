/**
 * js/modules/academy/academy-classes.js - Academy Classes Domain
 * Single source of truth for all class mutations within the Academy
 * Path: js/modules/academy/academy-classes.js
 * 
 * This module handles:
 *   - Class CRUD operations (create, update, delete)
 *   - Character-class assignments (add, remove)
 *   - Bulk operations (add/remove multiple students)
 *   - Class validation
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for class mutations
 *   - All mutations are candidate-based: validate, build candidate, commit
 *   - This module does NOT commit to window.data or call saveData()
 *   - Persistence and logging are owned by MutationPipeline
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - All ID generation uses IdUtils.generateId()
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.IdUtils (from id-utils.js)
 *   - window.MutationPipeline (from mutation-pipeline.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 * 
 * USAGE:
 *   var classes = window.AcademyClasses;
 *   var result = classes.create('Spring 2025');
 *   var result = classes.update('class_123', { name: 'Spring 2025 A' });
 *   var result = classes.delete('class_123');
 *   var result = classes.addStudent('class_123', 'char_456');
 */

(function() {
    'use strict';

    if (window.__academyClassesLoaded) {
        return;
    }

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var MutationPipeline = window.MutationPipeline;
    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;

    function checkDependencies() {
        var missing = [];

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (missing.length > 0) {
            throw new Error('AcademyClasses: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateId(prefix) {
        return IdUtils.generateId(prefix);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function normalizeClassName(name) {
        return String(name).trim();
    }

    function generateClassId() {
        return generateId('class');
    }

    function validateClassName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return { valid: false, message: 'Class name is required.' };
        }

        var trimmed = normalizeClassName(name);
        var classes = AcademyQueries.getClasses();

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') continue;
            if (excludeId && String(cls.id) === String(excludeId)) continue;
            if (normalizeClassName(cls.name || '').toLowerCase() === trimmed.toLowerCase()) {
                return { valid: false, message: 'A class with this name already exists.' };
            }
        }

        return { valid: true };
    }

    function validateClassData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Class data must be an object.' };
        }

        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Class name is required.' };
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Class name cannot be empty.' };
            }
        }

        return { valid: true };
    }

    function buildCreateCandidate(name) {
        var validation = validateClassName(name);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.classes)) {
            return failure('Class data is corrupted.');
        }

        var candidate = deepClone(data.classes);
        if (candidate === null) {
            return failure('Failed to prepare class data.');
        }

        var trimmed = normalizeClassName(name);

        var newClass = {
            id: generateClassId(),
            name: trimmed,
            createdAt: new Date().toISOString()
        };

        candidate.push(newClass);

        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.classes)) {
                throw new Error('Data store is not available.');
            }
            store.classes = candidate;
            return { class: deepClone(newClass) };
        }

        return success({
            mutate: mutate,
            class: newClass
        });
    }

    function create(name) {
        var candidate = buildCreateCandidate(name);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ class: result.class });
        } catch (e) {
            return failure(e.message || 'Failed to create class.');
        }
    }

    function buildUpdateCandidate(id, updates) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        if (!isObject(updates)) {
            return failure('Updates must be an object.');
        }

        var dataValidation = validateClassData(updates, true);
        if (!dataValidation.valid) {
            return failure(dataValidation.message);
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.classes)) {
            return failure('No classes found.');
        }

        var index = -1;
        var cls = null;
        for (var i = 0; i < data.classes.length; i++) {
            if (data.classes[i] && typeof data.classes[i] === 'object' && String(data.classes[i].id) === String(id)) {
                index = i;
                cls = data.classes[i];
                break;
            }
        }

        if (index === -1 || !cls) {
            return failure('Class not found.');
        }

        var candidateClass = deepClone(cls);
        if (candidateClass === null) {
            return failure('Failed to clone class data.');
        }

        var changed = false;

        if (updates.name !== undefined) {
            var nameValidation = validateClassName(updates.name, id);
            if (!nameValidation.valid) {
                return failure(nameValidation.message);
            }
            var newName = normalizeClassName(updates.name);
            if (candidateClass.name !== newName) {
                candidateClass.name = newName;
                changed = true;
            }
        }

        if (!changed) {
            return success({
                mutate: function() { return { class: deepClone(cls), changed: false }; },
                class: cls,
                changed: false
            });
        }

        var candidateArray = deepClone(data.classes);
        if (candidateArray === null) {
            return failure('Failed to prepare class data.');
        }

        candidateArray[index] = candidateClass;

        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.classes)) {
                throw new Error('Data store is not available.');
            }
            store.classes = candidateArray;
            return { class: deepClone(candidateClass), changed: true };
        }

        return success({
            mutate: mutate,
            class: candidateClass,
            changed: true
        });
    }

    function update(id, updates) {
        var candidate = buildUpdateCandidate(id, updates);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ class: result.class, changed: result.changed });
        } catch (e) {
            return failure(e.message || 'Failed to update class.');
        }
    }

    function buildDeleteCandidate(id) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(data.classes)) {
            return failure('No classes found.');
        }

        if (!Array.isArray(data.characters)) {
            return failure('Character data is corrupted.');
        }

        if (!Array.isArray(data.teams)) {
            return failure('Team data is corrupted.');
        }

        var index = -1;
        var cls = null;
        for (var i = 0; i < data.classes.length; i++) {
            if (data.classes[i] && typeof data.classes[i] === 'object' && String(data.classes[i].id) === String(id)) {
                index = i;
                cls = data.classes[i];
                break;
            }
        }

        if (index === -1 || !cls) {
            return failure('Class not found.');
        }

        var className = cls.name;

        var candidateClasses = deepClone(data.classes);
        if (candidateClasses === null) {
            return failure('Failed to prepare class data.');
        }

        var candidateCharacters = deepClone(data.characters);
        if (candidateCharacters === null) {
            return failure('Failed to prepare character data.');
        }

        var candidateTeams = deepClone(data.teams);
        if (candidateTeams === null) {
            return failure('Failed to prepare team data.');
        }

        var affectedCharacters = 0;
        var affectedTeams = 0;

        for (var charIdx = 0; charIdx < candidateCharacters.length; charIdx++) {
            var character = candidateCharacters[charIdx];
            if (!character || typeof character !== 'object' || !Array.isArray(character.classIds)) {
                continue;
            }

            var hadClass = false;
            for (var cidIdx = 0; cidIdx < character.classIds.length; cidIdx++) {
                if (String(character.classIds[cidIdx]) === String(id)) {
                    hadClass = true;
                    break;
                }
            }

            if (hadClass) {
                affectedCharacters++;
                var newClassIds = [];
                for (var cidIdx2 = 0; cidIdx2 < character.classIds.length; cidIdx2++) {
                    if (String(character.classIds[cidIdx2]) !== String(id)) {
                        newClassIds.push(character.classIds[cidIdx2]);
                    }
                }
                character.classIds = newClassIds;
            }
        }

        for (var teamIdx = 0; teamIdx < candidateTeams.length; teamIdx++) {
            var team = candidateTeams[teamIdx];
            if (!team || typeof team !== 'object' || team.type !== 'academic') {
                continue;
            }

            if (String(team.classId) === String(id)) {
                affectedTeams++;
                team.classId = null;
            }
        }

        candidateClasses.splice(index, 1);

        function mutate() {
            var store = getDataStore();
            if (!store) {
                throw new Error('Data store is not available.');
            }
            store.classes = candidateClasses;
            store.characters = candidateCharacters;
            store.teams = candidateTeams;
            return {
                className: className,
                affectedCharacters: affectedCharacters,
                affectedTeams: affectedTeams
            };
        }

        return success({
            mutate: mutate,
            className: className,
            affectedCharacters: affectedCharacters,
            affectedTeams: affectedTeams
        });
    }

    function deleteClass(id) {
        var candidate = buildDeleteCandidate(id);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({
                className: result.className,
                affectedCharacters: result.affectedCharacters,
                affectedTeams: result.affectedTeams
            });
        } catch (e) {
            return failure(e.message || 'Failed to delete class.');
        }
    }

    function buildAddStudentCandidate(classId, studentId) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var cls = AcademyQueries.getClass(classId);
        if (!cls) {
            return failure('Class not found.');
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return failure('No characters found.');
        }

        var charIndex = -1;
        var character = null;

        for (var i = 0; i < data.characters.length; i++) {
            if (data.characters[i] && typeof data.characters[i] === 'object' && String(data.characters[i].id) === String(studentId)) {
                charIndex = i;
                character = data.characters[i];
                break;
            }
        }

        if (!character) {
            return failure('Character not found.');
        }

        var existingClassIds = Array.isArray(character.classIds) ? character.classIds : [];

        for (var cidIdx = 0; cidIdx < existingClassIds.length; cidIdx++) {
            if (String(existingClassIds[cidIdx]) === String(classId)) {
                return failure('Character is already in this class.');
            }
        }

        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return failure('Failed to prepare character data.');
        }

        var candidateChar = candidate[charIndex];
        if (!candidateChar) {
            return failure('Character data corrupted.');
        }

        if (!Array.isArray(candidateChar.classIds)) {
            candidateChar.classIds = [];
        }

        candidateChar.classIds.push(classId);

        var studentName = CharacterQueries.getDisplayName(character);

        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.characters)) {
                throw new Error('Data store is not available.');
            }
            store.characters = candidate;
            return {
                characterId: studentId,
                classId: classId,
                className: cls.name,
                studentName: studentName
            };
        }

        return success({
            mutate: mutate,
            characterId: studentId,
            classId: classId,
            className: cls.name,
            studentName: studentName
        });
    }

    function addStudent(classId, studentId) {
        var candidate = buildAddStudentCandidate(classId, studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            candidate.data.mutate();
            return success({
                characterId: studentId,
                classId: classId,
                className: candidate.data.className
            });
        } catch (e) {
            return failure(e.message || 'Failed to add student to class.');
        }
    }

    function buildRemoveStudentCandidate(classId, studentId) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var cls = AcademyQueries.getClass(classId);
        if (!cls) {
            return failure('Class not found.');
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return failure('No characters found.');
        }

        var charIndex = -1;
        var character = null;

        for (var i = 0; i < data.characters.length; i++) {
            if (data.characters[i] && typeof data.characters[i] === 'object' && String(data.characters[i].id) === String(studentId)) {
                charIndex = i;
                character = data.characters[i];
                break;
            }
        }

        if (!character) {
            return failure('Character not found.');
        }

        var existingClassIds = Array.isArray(character.classIds) ? character.classIds : [];

        var isInClass = false;
        for (var cidIdx = 0; cidIdx < existingClassIds.length; cidIdx++) {
            if (String(existingClassIds[cidIdx]) === String(classId)) {
                isInClass = true;
                break;
            }
        }

        if (!isInClass) {
            return failure('Character is not in this class.');
        }

        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return failure('Failed to prepare character data.');
        }

        var candidateChar = candidate[charIndex];
        if (!candidateChar) {
            return failure('Character data corrupted.');
        }

        if (!Array.isArray(candidateChar.classIds)) {
            candidateChar.classIds = [];
        }

        var newClassIds = [];
        for (var cidIdx2 = 0; cidIdx2 < candidateChar.classIds.length; cidIdx2++) {
            if (String(candidateChar.classIds[cidIdx2]) !== String(classId)) {
                newClassIds.push(candidateChar.classIds[cidIdx2]);
            }
        }
        candidateChar.classIds = newClassIds;

        var studentName = CharacterQueries.getDisplayName(character);

        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.characters)) {
                throw new Error('Data store is not available.');
            }
            store.characters = candidate;
            return {
                characterId: studentId,
                classId: classId,
                className: cls.name,
                studentName: studentName
            };
        }

        return success({
            mutate: mutate,
            characterId: studentId,
            classId: classId,
            className: cls.name,
            studentName: studentName
        });
    }

    function removeStudent(classId, studentId) {
        var candidate = buildRemoveStudentCandidate(classId, studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            candidate.data.mutate();
            return success({
                characterId: studentId,
                classId: classId,
                className: candidate.data.className
            });
        } catch (e) {
            return failure(e.message || 'Failed to remove student from class.');
        }
    }

    function buildRemoveStudentFromAllCandidate(studentId) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return failure('No characters found.');
        }

        var charIndex = -1;
        var character = null;

        for (var i = 0; i < data.characters.length; i++) {
            if (data.characters[i] && typeof data.characters[i] === 'object' && String(data.characters[i].id) === String(studentId)) {
                charIndex = i;
                character = data.characters[i];
                break;
            }
        }

        if (!character) {
            return failure('Character not found.');
        }

        var existingClassIds = Array.isArray(character.classIds) ? character.classIds : [];

        if (existingClassIds.length === 0) {
            return success({
                mutate: function() { return { removedCount: 0 }; },
                removedCount: 0
            });
        }

        var removedCount = existingClassIds.length;

        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return failure('Failed to prepare character data.');
        }

        var candidateChar = candidate[charIndex];
        if (!candidateChar) {
            return failure('Character data corrupted.');
        }

        candidateChar.classIds = [];

        var studentName = CharacterQueries.getDisplayName(character);

        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.characters)) {
                throw new Error('Data store is not available.');
            }
            store.characters = candidate;
            return {
                studentId: studentId,
                studentName: studentName,
                removedCount: removedCount
            };
        }

        return success({
            mutate: mutate,
            studentId: studentId,
            studentName: studentName,
            removedCount: removedCount
        });
    }

    function removeStudentFromAll(studentId) {
        var candidate = buildRemoveStudentFromAllCandidate(studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ removedCount: result.removedCount });
        } catch (e) {
            return failure(e.message || 'Failed to remove student from all classes.');
        }
    }

    function buildAddStudentsCandidate(classId, studentIds) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return failure('At least one student ID is required.');
        }

        var cls = AcademyQueries.getClass(classId);
        if (!cls) {
            return failure('Class not found.');
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return failure('No characters found.');
        }

        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return failure('Failed to prepare character data.');
        }

        var added = 0;
        var failed = [];

        for (var i = 0; i < studentIds.length; i++) {
            var studentId = studentIds[i];
            if (!isNonEmptyString(studentId)) {
                failed.push({ studentId: studentId, reason: 'Invalid student ID' });
                continue;
            }

            var charIndex = -1;
            for (var j = 0; j < candidate.length; j++) {
                if (candidate[j] && typeof candidate[j] === 'object' && String(candidate[j].id) === String(studentId)) {
                    charIndex = j;
                    break;
                }
            }

            if (charIndex === -1) {
                failed.push({ studentId: studentId, reason: 'Student not found' });
                continue;
            }

            var character = candidate[charIndex];
            if (!Array.isArray(character.classIds)) {
                character.classIds = [];
            }

            var alreadyInClass = false;
            for (var k = 0; k < character.classIds.length; k++) {
                if (String(character.classIds[k]) === String(classId)) {
                    alreadyInClass = true;
                    break;
                }
            }

            if (alreadyInClass) {
                failed.push({ studentId: studentId, reason: 'Already in class' });
                continue;
            }

            character.classIds.push(classId);
            added++;
        }

        if (added === 0) {
            return failure('No students were added. ' + failed.length + ' failed.');
        }

        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.characters)) {
                throw new Error('Data store is not available.');
            }
            store.characters = candidate;
            return {
                added: added,
                failed: failed,
                classId: classId,
                className: cls.name
            };
        }

        return success({
            mutate: mutate,
            added: added,
            failed: failed,
            classId: classId,
            className: cls.name
        });
    }

    function addStudents(classId, studentIds) {
        var candidate = buildAddStudentsCandidate(classId, studentIds);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({
                added: result.added,
                failed: result.failed,
                className: result.className
            });
        } catch (e) {
            return failure(e.message || 'Failed to add students to class.');
        }
    }

    function buildRemoveStudentsCandidate(classId, studentIds) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return failure('At least one student ID is required.');
        }

        var cls = AcademyQueries.getClass(classId);
        if (!cls) {
            return failure('Class not found.');
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return failure('No characters found.');
        }

        var candidate = deepClone(data.characters);
        if (candidate === null) {
            return failure('Failed to prepare character data.');
        }

        var removed = 0;
        var failed = [];

        for (var i = 0; i < studentIds.length; i++) {
            var studentId = studentIds[i];
            if (!isNonEmptyString(studentId)) {
                failed.push({ studentId: studentId, reason: 'Invalid student ID' });
                continue;
            }

            var charIndex = -1;
            for (var j = 0; j < candidate.length; j++) {
                if (candidate[j] && typeof candidate[j] === 'object' && String(candidate[j].id) === String(studentId)) {
                    charIndex = j;
                    break;
                }
            }

            if (charIndex === -1) {
                failed.push({ studentId: studentId, reason: 'Student not found' });
                continue;
            }

            var character = candidate[charIndex];
            if (!Array.isArray(character.classIds)) {
                character.classIds = [];
            }

            var isInClass = false;
            for (var k = 0; k < character.classIds.length; k++) {
                if (String(character.classIds[k]) === String(classId)) {
                    isInClass = true;
                    break;
                }
            }

            if (!isInClass) {
                failed.push({ studentId: studentId, reason: 'Not in class' });
                continue;
            }

            var newClassIds = [];
            for (var k2 = 0; k2 < character.classIds.length; k2++) {
                if (String(character.classIds[k2]) !== String(classId)) {
                    newClassIds.push(character.classIds[k2]);
                }
            }
            character.classIds = newClassIds;
            removed++;
        }

        if (removed === 0) {
            return failure('No students were removed. ' + failed.length + ' failed.');
        }

        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.characters)) {
                throw new Error('Data store is not available.');
            }
            store.characters = candidate;
            return {
                removed: removed,
                failed: failed,
                classId: classId,
                className: cls.name
            };
        }

        return success({
            mutate: mutate,
            removed: removed,
            failed: failed,
            classId: classId,
            className: cls.name
        });
    }

    function removeStudents(classId, studentIds) {
        var candidate = buildRemoveStudentsCandidate(classId, studentIds);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({
                removed: result.removed,
                failed: result.failed,
                className: result.className
            });
        } catch (e) {
            return failure(e.message || 'Failed to remove students from class.');
        }
    }

    function validateClassNamePublic(name, excludeId) {
        return validateClassName(name, excludeId);
    }

    function validateClassDataPublic(data, isPartial) {
        return validateClassData(data, isPartial);
    }

    window.AcademyClasses = {
        create: create,
        createCandidate: buildCreateCandidate,
        update: update,
        updateCandidate: buildUpdateCandidate,
        delete: deleteClass,
        deleteCandidate: buildDeleteCandidate,

        addStudent: addStudent,
        addStudentCandidate: buildAddStudentCandidate,
        removeStudent: removeStudent,
        removeStudentCandidate: buildRemoveStudentCandidate,
        removeStudentFromAll: removeStudentFromAll,
        removeStudentFromAllCandidate: buildRemoveStudentFromAllCandidate,

        addStudents: addStudents,
        addStudentsCandidate: buildAddStudentsCandidate,
        removeStudents: removeStudents,
        removeStudentsCandidate: buildRemoveStudentsCandidate,

        validateClassName: validateClassNamePublic,
        validateClassData: validateClassDataPublic
    };

    window.__academyClassesLoaded = true;

})();