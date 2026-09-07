/**
 * js/modules/academy/academy-core.js - Academy Core Domain
 * Single source of truth for Academy domain operations (non-class)
 * Path: js/modules/academy/academy-core.js
 * 
 * This module handles:
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
 *   - Class operations have been moved to AcademyClasses
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.IdUtils (from id-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 * 
 * USAGE:
 *   var core = window.AcademyCore;
 *   var disciplines = core.getDisciplines();
 *   var result = core.createDiscipline({ name: 'Combat' });
 *   var locations = core.getLocations();
 */

(function() {
    'use strict';

    if (window.__academyCoreLoaded) {
        return;
    }

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var CharacterQueries = window.CharacterQueries;
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

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
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

    function getCurriculum() {
        var data = getDataStore();
        if (!data || !data.curriculum || typeof data.curriculum !== 'object') {
            return null;
        }
        return data.curriculum;
    }

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

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    function buildCreateDisciplineCandidate(data) {
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

        var curriculum = getCurriculum();
        if (!curriculum) {
            return failure('Curriculum data is not available.');
        }

        if (!Array.isArray(curriculum.disciplines)) {
            curriculum.disciplines = [];
        }

        var existing = curriculum.disciplines;
        for (var i = 0; i < existing.length; i++) {
            if (String(existing[i].name).toLowerCase() === String(data.name).toLowerCase().trim()) {
                return failure('A discipline with this name already exists.');
            }
        }

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

    function createDiscipline(data) {
        var candidate = buildCreateDisciplineCandidate(data);
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

    function buildUpdateDisciplineCandidate(id, updates) {
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(id);
        if (!discipline) {
            return failure('Discipline not found.');
        }

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

    function updateDiscipline(id, updates) {
        var candidate = buildUpdateDisciplineCandidate(id, updates);
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

    function buildDeleteDisciplineCandidate(id) {
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(id);
        if (!discipline) {
            return failure('Discipline not found.');
        }

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

    function deleteDiscipline(id) {
        var candidate = buildDeleteDisciplineCandidate(id);
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

    function getLocations() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return [];
        }

        return deepClone(data.locations) || [];
    }

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

    function buildCreateLocationCandidate(data) {
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

        var dataStore = getDataStore();
        if (!dataStore) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(dataStore.locations)) {
            dataStore.locations = [];
        }

        var existing = dataStore.locations;
        for (var i = 0; i < existing.length; i++) {
            if (String(existing[i].name).toLowerCase() === String(data.name).toLowerCase().trim()) {
                return failure('A location with this name already exists.');
            }
        }

        var newLocation = {
            id: generateId('loc'),
            name: data.name.trim(),
            type: type,
            capacity: capacity,
            createdAt: new Date().toISOString()
        };

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

    function createLocation(data) {
        var candidate = buildCreateLocationCandidate(data);
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

    function buildUpdateLocationCandidate(id, updates) {
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        var location = getLocation(id);
        if (!location) {
            return failure('Location not found.');
        }

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

    function updateLocation(id, updates) {
        var candidate = buildUpdateLocationCandidate(id, updates);
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

    function buildDeleteLocationCandidate(id) {
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        var location = getLocation(id);
        if (!location) {
            return failure('Location not found.');
        }

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

    function deleteLocation(id) {
        var candidate = buildDeleteLocationCandidate(id);
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

    function getCurrentWeek() {
        var data = getDataStore();
        if (data && typeof data.currentWeek === 'number') {
            return data.currentWeek;
        }
        return CalendarConstants.MIN_WEEK;
    }

    function buildSetCurrentWeekCandidate(week) {
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

    function setCurrentWeek(week) {
        var candidate = buildSetCurrentWeekCandidate(week);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var result = candidate.data.mutate();
            return success({ week: result.week });
        } catch (e) {
            return failure(e.message || 'Failed to set current week.');
        }
    }

    window.AcademyCore = {
        getDisciplines: getDisciplines,
        getDiscipline: getDiscipline,
        getAvailableDisciplines: getAvailableDisciplines,

        createDiscipline: createDiscipline,
        createDisciplineCandidate: buildCreateDisciplineCandidate,
        updateDiscipline: updateDiscipline,
        updateDisciplineCandidate: buildUpdateDisciplineCandidate,
        deleteDiscipline: deleteDiscipline,
        deleteDisciplineCandidate: buildDeleteDisciplineCandidate,

        getLocations: getLocations,
        getLocation: getLocation,

        createLocation: createLocation,
        createLocationCandidate: buildCreateLocationCandidate,
        updateLocation: updateLocation,
        updateLocationCandidate: buildUpdateLocationCandidate,
        deleteLocation: deleteLocation,
        deleteLocationCandidate: buildDeleteLocationCandidate,

        getCurrentWeek: getCurrentWeek,
        setCurrentWeek: setCurrentWeek,
        setCurrentWeekCandidate: buildSetCurrentWeekCandidate,

        MIN_WEEK: CalendarConstants.MIN_WEEK,
        MAX_WEEK: CalendarConstants.MAX_WEEK
    };

    window.__academyCoreLoaded = true;

})();