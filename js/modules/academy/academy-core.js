/**
 * js/modules/academy/academy-core.js - Academy Core Domain
 * Single source of truth for Academy domain operations
 * Path: js/modules/academy/academy-core.js
 * 
 * This module handles:
 *   - Class CRUD operations
 *   - Discipline operations
 *   - Location operations
 *   - Academy-level domain queries
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for Academy domain data
 *   - All mutations are candidate-based: validate, clone, modify, return candidate
 *   - This module does NOT commit to window.data or call saveData()
 *   - Persistence and logging are owned by MutationPipeline
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - All ID generation uses IdUtils.generateId()
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.IdUtils (from id-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.ClassesCore (from classes-core.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 * 
 * USAGE:
 *   var core = window.AcademyCore;
 *   var result = core.createClass('Spring 2025');
 *   var classData = core.getClass('class_123');
 *   var disciplines = core.getDisciplines();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var ClassesCore = window.ClassesCore;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }

        if (!ClassesCore || typeof ClassesCore.createClass !== 'function') {
            missing.push('ClassesCore.createClass');
        }
        if (!ClassesCore || typeof ClassesCore.updateClass !== 'function') {
            missing.push('ClassesCore.updateClass');
        }
        if (!ClassesCore || typeof ClassesCore.deleteClass !== 'function') {
            missing.push('ClassesCore.deleteClass');
        }
        if (!ClassesCore || typeof ClassesCore.getClass !== 'function') {
            missing.push('ClassesCore.getClass');
        }
        if (!ClassesCore || typeof ClassesCore.getClasses !== 'function') {
            missing.push('ClassesCore.getClasses');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (missing.length > 0) {
            throw new Error('AcademyCore: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPER ALIASES
    // ============================================================

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

    // ============================================================
    // DATA STORE ACCESS - Read-only
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getCurriculum() {
        var data = getDataStore();
        if (!data || !data.curriculum || typeof data.curriculum !== 'object') {
            return null;
        }
        return data.curriculum;
    }

    // ============================================================
    // CLASS OPERATIONS - Delegates to ClassesCore
    // ============================================================

    /**
     * Get all classes.
     * @returns {Array} Array of class objects
     */
    function getClasses() {
        return ClassesCore.getClasses();
    }

    /**
     * Get a class by ID.
     * @param {string} id - Class ID
     * @returns {object|null} Class object or null
     */
    function getClass(id) {
        return ClassesCore.getClass(id);
    }

    /**
     * Create a new class.
     * @param {string} name - Class name
     * @returns {object} Result with success flag and class data
     */
    function createClass(name) {
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var result = ClassesCore.createClass(name.trim());
        if (result && result.success) {
            return success({ class: result.class });
        }

        return failure(result ? result.message : 'Failed to create class.');
    }

    /**
     * Update an existing class.
     * @param {string} id - Class ID
     * @param {object} updates - Updates to apply
     * @returns {object} Result with success flag
     */
    function updateClass(id, updates) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        var result = ClassesCore.updateClass(id, updates);
        if (result && result.success) {
            return success({ class: result.class });
        }

        return failure(result ? result.message : 'Failed to update class.');
    }

    /**
     * Delete a class.
     * @param {string} id - Class ID
     * @returns {object} Result with success flag
     */
    function deleteClass(id) {
        if (!isNonEmptyString(id)) {
            return failure('Class ID is required.');
        }

        var result = ClassesCore.deleteClass(id);
        if (result && result.success) {
            return success({ deleted: true });
        }

        return failure(result ? result.message : 'Failed to delete class.');
    }

    /**
     * Add a character to a class.
     * @param {string} characterId - Character ID
     * @param {string} classId - Class ID
     * @returns {object} Result with success flag
     */
    function addCharacterToClass(characterId, classId) {
        if (!isNonEmptyString(characterId)) {
            return failure('Character ID is required.');
        }
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var result = ClassesCore.addCharacterToClass(characterId, classId);
        if (result && result.success) {
            return success({ added: true });
        }

        return failure(result ? result.message : 'Failed to add character to class.');
    }

    /**
     * Remove a character from a class.
     * @param {string} characterId - Character ID
     * @param {string} classId - Class ID
     * @returns {object} Result with success flag
     */
    function removeCharacterFromClass(characterId, classId) {
        if (!isNonEmptyString(characterId)) {
            return failure('Character ID is required.');
        }
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var result = ClassesCore.removeCharacterFromClass(characterId, classId);
        if (result && result.success) {
            return success({ removed: true });
        }

        return failure(result ? result.message : 'Failed to remove character from class.');
    }

    // ============================================================
    // DISCIPLINE OPERATIONS
    // ============================================================

    /**
     * Get all disciplines.
     * @returns {Array} Array of discipline objects
     */
    function getDisciplines() {
        var curriculum = getCurriculum();
        if (!curriculum) {
            return [];
        }

        var disciplines = curriculum.disciplines;
        if (!Array.isArray(disciplines)) {
            return [];
        }

        return deepClone(disciplines) || [];
    }

    /**
     * Get a discipline by ID.
     * @param {string} id - Discipline ID
     * @returns {object|null} Discipline object or null
     */
    function getDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var disciplines = getDisciplines();
        for (var i = 0; i < disciplines.length; i++) {
            if (String(disciplines[i].id) === String(id)) {
                return disciplines[i];
            }
        }

        return null;
    }

    /**
     * Get available disciplines for a given week.
     * @param {number|string} week - Week number
     * @returns {Array} Array of discipline objects available in that week
     */
    function getAvailableDisciplines(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var disciplines = getDisciplines();
        var result = [];

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var startWeek = parseInt(d.startWeek, 10) || CalendarConstants.MIN_WEEK;
            var endWeek = parseInt(d.endWeek, 10) || CalendarConstants.MAX_WEEK;

            if (weekNum >= startWeek && weekNum <= endWeek) {
                result.push(d);
            }
        }

        // Sort by name
        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    /**
     * Create a new discipline.
     * @param {object} data - Discipline data
     * @returns {object} Result with success flag and discipline data
     */
    function createDiscipline(data) {
        // ---- PHASE 1: VALIDATE ----
        if (!data || typeof data !== 'object') {
            return failure('Discipline data is required.');
        }

        if (!isNonEmptyString(data.name)) {
            return failure('Discipline name is required.');
        }

        var startWeek = CalendarValidation.parseWeek(data.startWeek);
        if (startWeek === null) {
            startWeek = CalendarConstants.MIN_WEEK;
        }

        var endWeek = CalendarValidation.parseWeek(data.endWeek);
        if (endWeek === null) {
            endWeek = CalendarConstants.MAX_WEEK;
        }

        if (startWeek > endWeek) {
            return failure('Start week cannot be after end week.');
        }

        var weeklyHours = Number(data.weeklyHours) || 1;
        if (weeklyHours < 0.5 || weeklyHours > 40) {
            return failure('Weekly hours must be between 0.5 and 40.');
        }

        var weight = Number(data.weight) || 1;
        if (weight < 0.1 || weight > 10) {
            return failure('Weight must be between 0.1 and 10.');
        }

        var type = data.type || 'mandatory';
        if (type !== 'mandatory' && type !== 'optional') {
            return failure('Type must be "mandatory" or "optional".');
        }

        var instructorIds = [];
        if (Array.isArray(data.instructorIds)) {
            for (var i = 0; i < data.instructorIds.length; i++) {
                var id = data.instructorIds[i];
                if (isNonEmptyString(id)) {
                    instructorIds.push(id.trim());
                }
            }
        }

        // ---- PHASE 2: GET CURRICULUM ----
        var curriculum = getCurriculum();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        if (!Array.isArray(curriculum.disciplines)) {
            curriculum.disciplines = [];
        }

        // Check for duplicate name
        var existing = curriculum.disciplines;
        for (var i = 0; i < existing.length; i++) {
            if (String(existing[i].name).toLowerCase() === String(data.name).toLowerCase().trim()) {
                return failure('A discipline with this name already exists.');
            }
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var newDiscipline = {
            id: generateId('disc'),
            name: data.name.trim(),
            type: type,
            instructorIds: instructorIds,
            startWeek: startWeek,
            endWeek: endWeek,
            weeklyHours: weeklyHours,
            weight: weight,
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 4: BUILD MUTATION FUNCTION ----
        function mutate() {
            var curriculumData = getCurriculum();
            if (!curriculumData) {
                throw new Error('Curriculum data is not available.');
            }
            if (!Array.isArray(curriculumData.disciplines)) {
                curriculumData.disciplines = [];
            }
            curriculumData.disciplines.push(deepClone(newDiscipline));
            return { discipline: newDiscipline };
        }

        return success({
            mutate: mutate,
            discipline: newDiscipline
        });
    }

    /**
     * Update an existing discipline.
     * @param {string} id - Discipline ID
     * @param {object} updates - Updates to apply
     * @returns {object} Result with success flag
     */
    function updateDiscipline(id, updates) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(id);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidate = deepClone(discipline);
        if (candidate === null) {
            return failure('Failed to prepare discipline data.');
        }

        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                return failure('Discipline name is required.');
            }
            candidate.name = updates.name.trim();
        }

        if (updates.type !== undefined) {
            var type = updates.type;
            if (type !== 'mandatory' && type !== 'optional') {
                return failure('Type must be "mandatory" or "optional".');
            }
            candidate.type = type;
        }

        if (updates.startWeek !== undefined) {
            var startWeek = CalendarValidation.parseWeek(updates.startWeek);
            if (startWeek === null) {
                return failure('Valid start week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
            }
            candidate.startWeek = startWeek;
        }

        if (updates.endWeek !== undefined) {
            var endWeek = CalendarValidation.parseWeek(updates.endWeek);
            if (endWeek === null) {
                return failure('Valid end week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
            }
            candidate.endWeek = endWeek;
        }

        if (candidate.startWeek > candidate.endWeek) {
            return failure('Start week cannot be after end week.');
        }

        if (updates.weeklyHours !== undefined) {
            var weeklyHours = Number(updates.weeklyHours) || 1;
            if (weeklyHours < 0.5 || weeklyHours > 40) {
                return failure('Weekly hours must be between 0.5 and 40.');
            }
            candidate.weeklyHours = weeklyHours;
        }

        if (updates.weight !== undefined) {
            var weight = Number(updates.weight) || 1;
            if (weight < 0.1 || weight > 10) {
                return failure('Weight must be between 0.1 and 10.');
            }
            candidate.weight = weight;
        }

        if (updates.instructorIds !== undefined) {
            var instructorIds = [];
            if (Array.isArray(updates.instructorIds)) {
                for (var i = 0; i < updates.instructorIds.length; i++) {
                    var id2 = updates.instructorIds[i];
                    if (isNonEmptyString(id2)) {
                        instructorIds.push(id2.trim());
                    }
                }
            }
            candidate.instructorIds = instructorIds;
        }

        // ---- PHASE 3: BUILD MUTATION FUNCTION ----
        function mutate() {
            var curriculumData = getCurriculum();
            if (!curriculumData || !Array.isArray(curriculumData.disciplines)) {
                throw new Error('Curriculum data is not available.');
            }

            var found = false;
            for (var i = 0; i < curriculumData.disciplines.length; i++) {
                if (String(curriculumData.disciplines[i].id) === String(id)) {
                    curriculumData.disciplines[i] = deepClone(candidate);
                    found = true;
                    break;
                }
            }

            if (!found) {
                throw new Error('Discipline not found during update.');
            }

            return { discipline: candidate };
        }

        return success({
            mutate: mutate,
            discipline: candidate
        });
    }

    /**
     * Delete a discipline.
     * @param {string} id - Discipline ID
     * @returns {object} Result with success flag
     */
    function deleteDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(id);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        // ---- PHASE 1: BUILD MUTATION FUNCTION ----
        function mutate() {
            var curriculumData = getCurriculum();
            if (!curriculumData || !Array.isArray(curriculumData.disciplines)) {
                throw new Error('Curriculum data is not available.');
            }

            var foundIndex = -1;
            for (var i = 0; i < curriculumData.disciplines.length; i++) {
                if (String(curriculumData.disciplines[i].id) === String(id)) {
                    foundIndex = i;
                    break;
                }
            }

            if (foundIndex === -1) {
                throw new Error('Discipline not found during deletion.');
            }

            curriculumData.disciplines.splice(foundIndex, 1);
            return { deleted: true };
        }

        return success({
            mutate: mutate,
            deleted: true
        });
    }

    // ============================================================
    // LOCATION OPERATIONS
    // ============================================================

    /**
     * Get all locations.
     * @returns {Array} Array of location objects
     */
    function getLocations() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return [];
        }

        return deepClone(data.locations) || [];
    }

    /**
     * Get a location by ID.
     * @param {string} id - Location ID
     * @returns {object|null} Location object or null
     */
    function getLocation(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var locations = getLocations();
        for (var i = 0; i < locations.length; i++) {
            if (String(locations[i].id) === String(id)) {
                return locations[i];
            }
        }

        return null;
    }

    /**
     * Create a new location.
     * @param {object} data - Location data
     * @returns {object} Result with success flag and location data
     */
    function createLocation(data) {
        // ---- PHASE 1: VALIDATE ----
        if (!data || typeof data !== 'object') {
            return failure('Location data is required.');
        }

        if (!isNonEmptyString(data.name)) {
            return failure('Location name is required.');
        }

        var type = data.type || 'other';
        var capacity = Number(data.capacity) || null;
        if (capacity !== null && (capacity < 1 || capacity > 1000)) {
            return failure('Capacity must be between 1 and 1000.');
        }

        // ---- PHASE 2: GET DATA STORE ----
        var dataStore = getDataStore();
        if (!dataStore) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(dataStore.locations)) {
            dataStore.locations = [];
        }

        // Check for duplicate name
        var existing = dataStore.locations;
        for (var i = 0; i < existing.length; i++) {
            if (String(existing[i].name).toLowerCase() === String(data.name).toLowerCase().trim()) {
                return failure('A location with this name already exists.');
            }
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var newLocation = {
            id: generateId('loc'),
            name: data.name.trim(),
            type: type,
            capacity: capacity,
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 4: BUILD MUTATION FUNCTION ----
        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.locations)) {
                throw new Error('Data store is not available.');
            }
            store.locations.push(deepClone(newLocation));
            return { location: newLocation };
        }

        return success({
            mutate: mutate,
            location: newLocation
        });
    }

    /**
     * Update an existing location.
     * @param {string} id - Location ID
     * @param {object} updates - Updates to apply
     * @returns {object} Result with success flag
     */
    function updateLocation(id, updates) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        var location = getLocation(id);
        if (!location) {
            return failure('Location not found.');
        }

        // ---- PHASE 2: BUILD CANDIDATE ----
        var candidate = deepClone(location);
        if (candidate === null) {
            return failure('Failed to prepare location data.');
        }

        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                return failure('Location name is required.');
            }
            candidate.name = updates.name.trim();
        }

        if (updates.type !== undefined) {
            candidate.type = updates.type || 'other';
        }

        if (updates.capacity !== undefined) {
            var capacity = updates.capacity !== null ? Number(updates.capacity) : null;
            if (capacity !== null && (capacity < 1 || capacity > 1000)) {
                return failure('Capacity must be between 1 and 1000.');
            }
            candidate.capacity = capacity;
        }

        // ---- PHASE 3: BUILD MUTATION FUNCTION ----
        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.locations)) {
                throw new Error('Data store is not available.');
            }

            var found = false;
            for (var i = 0; i < store.locations.length; i++) {
                if (String(store.locations[i].id) === String(id)) {
                    store.locations[i] = deepClone(candidate);
                    found = true;
                    break;
                }
            }

            if (!found) {
                throw new Error('Location not found during update.');
            }

            return { location: candidate };
        }

        return success({
            mutate: mutate,
            location: candidate
        });
    }

    /**
     * Delete a location.
     * @param {string} id - Location ID
     * @returns {object} Result with success flag
     */
    function deleteLocation(id) {
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        var location = getLocation(id);
        if (!location) {
            return failure('Location not found.');
        }

        // ---- PHASE 1: BUILD MUTATION FUNCTION ----
        function mutate() {
            var store = getDataStore();
            if (!store || !Array.isArray(store.locations)) {
                throw new Error('Data store is not available.');
            }

            var foundIndex = -1;
            for (var i = 0; i < store.locations.length; i++) {
                if (String(store.locations[i].id) === String(id)) {
                    foundIndex = i;
                    break;
                }
            }

            if (foundIndex === -1) {
                throw new Error('Location not found during deletion.');
            }

            store.locations.splice(foundIndex, 1);
            return { deleted: true };
        }

        return success({
            mutate: mutate,
            deleted: true
        });
    }

    // ============================================================
    // ACADEMY STATE QUERIES
    // ============================================================

    /**
     * Get the current academic week.
     * @returns {number} Current week number
     */
    function getCurrentWeek() {
        var data = getDataStore();
        if (data && typeof data.currentWeek === 'number') {
            return data.currentWeek;
        }
        return CalendarConstants.MIN_WEEK;
    }

    /**
     * Set the current academic week.
     * @param {number|string} week - Week number
     * @returns {object} Result with success flag
     */
    function setCurrentWeek(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        function mutate() {
            var store = getDataStore();
            if (!store) {
                throw new Error('Data store is not available.');
            }
            store.currentWeek = weekNum;
            return { week: weekNum };
        }

        return success({
            mutate: mutate,
            week: weekNum
        });
    }

    // ============================================================
    // LEGACY WRAPPER FUNCTIONS - For backward compatibility
    // These perform the mutation and commit directly.
    // DEPRECATED: Use build*Candidate functions with MutationPipeline.
    // ============================================================

    /**
     * @deprecated Use createDiscipline().mutate() with MutationPipeline
     */
    function createDisciplineDirect(data) {
        var candidate = createDiscipline(data);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ discipline: result.discipline });
        } catch (e) {
            return failure(e.message || 'Failed to create discipline.');
        }
    }

    /**
     * @deprecated Use updateDiscipline().mutate() with MutationPipeline
     */
    function updateDisciplineDirect(id, updates) {
        var candidate = updateDiscipline(id, updates);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ discipline: result.discipline });
        } catch (e) {
            return failure(e.message || 'Failed to update discipline.');
        }
    }

    /**
     * @deprecated Use deleteDiscipline().mutate() with MutationPipeline
     */
    function deleteDisciplineDirect(id) {
        var candidate = deleteDiscipline(id);
        if (!candidate.success) {
            return candidate;
        }

        try {
            candidate.data.mutate();
            return success({ deleted: true });
        } catch (e) {
            return failure(e.message || 'Failed to delete discipline.');
        }
    }

    /**
     * @deprecated Use createLocation().mutate() with MutationPipeline
     */
    function createLocationDirect(data) {
        var candidate = createLocation(data);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ location: result.location });
        } catch (e) {
            return failure(e.message || 'Failed to create location.');
        }
    }

    /**
     * @deprecated Use updateLocation().mutate() with MutationPipeline
     */
    function updateLocationDirect(id, updates) {
        var candidate = updateLocation(id, updates);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ location: result.location });
        } catch (e) {
            return failure(e.message || 'Failed to update location.');
        }
    }

    /**
     * @deprecated Use deleteLocation().mutate() with MutationPipeline
     */
    function deleteLocationDirect(id) {
        var candidate = deleteLocation(id);
        if (!candidate.success) {
            return candidate;
        }

        try {
            candidate.data.mutate();
            return success({ deleted: true });
        } catch (e) {
            return failure(e.message || 'Failed to delete location.');
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCore = {
        // Class operations (delegated to ClassesCore)
        getClasses: getClasses,
        getClass: getClass,
        createClass: createClass,
        updateClass: updateClass,
        deleteClass: deleteClass,
        addCharacterToClass: addCharacterToClass,
        removeCharacterFromClass: removeCharacterFromClass,

        // Discipline operations
        getDisciplines: getDisciplines,
        getDiscipline: getDiscipline,
        getAvailableDisciplines: getAvailableDisciplines,

        // Discipline mutations (candidate builders)
        createDiscipline: createDiscipline,
        updateDiscipline: updateDiscipline,
        deleteDiscipline: deleteDiscipline,

        // Legacy discipline mutations (direct commit - deprecated)
        createDisciplineDirect: createDisciplineDirect,
        updateDisciplineDirect: updateDisciplineDirect,
        deleteDisciplineDirect: deleteDisciplineDirect,

        // Location operations
        getLocations: getLocations,
        getLocation: getLocation,

        // Location mutations (candidate builders)
        createLocation: createLocation,
        updateLocation: updateLocation,
        deleteLocation: deleteLocation,

        // Legacy location mutations (direct commit - deprecated)
        createLocationDirect: createLocationDirect,
        updateLocationDirect: updateLocationDirect,
        deleteLocationDirect: deleteLocationDirect,

        // Academy state
        getCurrentWeek: getCurrentWeek,
        setCurrentWeek: setCurrentWeek,

        // Constants
        MIN_WEEK: CalendarConstants.MIN_WEEK,
        MAX_WEEK: CalendarConstants.MAX_WEEK
    };

})();