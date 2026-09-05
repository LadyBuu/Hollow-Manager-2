/**
 * js/modules/school/school-core.js - School Core Operations
 * Single source of truth for all school structure mutations
 * Path: js/modules/school/school-core.js
 * 
 * This module handles:
 *   - Discipline CRUD (create, read, update, delete)
 *   - Location CRUD (create, read, update, delete)
 *   - Grading system validation and management
 * 
 * IMPORTANT:
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - USES CurriculumHelpers for shared helpers
 *   - USES CurriculumValidators for validation
 * 
 * MUTATION INVARIANT:
 *   - All mutations use candidate-based validation:
 *     1. Validate inputs
 *     2. Build candidate state (deep clone)
 *     3. Apply validated changes to candidate
 *     4. Apply candidate to data store (replace, not mutate)
 *     5. If any step fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before candidate validation completes
 * 
 * DEPENDENCIES:
 *   - window.CurriculumHelpers (from curriculum-helpers.js)
 *   - window.CurriculumValidators (from curriculum-validators.js)
 *   - window.ObjectUtils (from object-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__schoolCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var Helpers = window.CurriculumHelpers;
    var Validators = window.CurriculumValidators;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!Helpers || typeof Helpers.getDataStore !== 'function') {
            missing.push('CurriculumHelpers.getDataStore');
        }
        if (!Helpers || typeof Helpers.deepClone !== 'function') {
            missing.push('CurriculumHelpers.deepClone');
        }
        if (!Helpers || typeof Helpers.logActivity !== 'function') {
            missing.push('CurriculumHelpers.logActivity');
        }
        if (!Helpers || typeof Helpers.generateId !== 'function') {
            missing.push('CurriculumHelpers.generateId');
        }
        if (!Helpers || typeof Helpers.failure !== 'function') {
            missing.push('CurriculumHelpers.failure');
        }
        if (!Helpers || typeof Helpers.successWithEntity !== 'function') {
            missing.push('CurriculumHelpers.successWithEntity');
        }

        if (!Validators || typeof Validators.validateDiscipline !== 'function') {
            missing.push('CurriculumValidators.validateDiscipline');
        }
        if (!Validators || typeof Validators.validateLocation !== 'function') {
            missing.push('CurriculumValidators.validateLocation');
        }
        if (!Validators || typeof Validators.validateGradingSystem !== 'function') {
            missing.push('CurriculumValidators.validateGradingSystem');
        }
        if (!Validators || typeof Validators.validateWeek !== 'function') {
            missing.push('CurriculumValidators.validateWeek');
        }

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (missing.length > 0) {
            console.warn('SchoolCore: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__schoolCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_LOCATION_TYPES = [
        'indoor', 'outdoor', 'pool', 'classroom', 'lab', 'field', 'other'
    ];

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

    function recordActivity(message) {
        try {
            Helpers.logActivity(message);
        } catch (e) {
            // Activity logging failure should not abort the mutation
        }
    }

    function getDataStore() {
        return Helpers.getDataStore();
    }

    function generateId(prefix) {
        return Helpers.generateId(prefix);
    }

    function failure(message) {
        return Helpers.failure(message);
    }

    function successWithEntity(name, data) {
        return Helpers.successWithEntity(name, data);
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // LOCATION HELPERS
    // ============================================================

    function isValidLocationType(type) {
        return typeof type === 'string' && VALID_LOCATION_TYPES.indexOf(type) !== -1;
    }

    function isValidCapacity(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        var num = Number(value);
        return Number.isSafeInteger(num) && num >= 0;
    }

    function getLocationStore() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return null;
        }
        return data;
    }

    function normaliseLocationName(name) {
        return isNonEmptyString(name) ? name.trim().toLowerCase() : '';
    }

    function ensureUniqueGeneratedId(prefix, existingIds) {
        var maxAttempts = 100;
        for (var attempt = 0; attempt < maxAttempts; attempt++) {
            var id = generateId(prefix);
            var collision = false;
            for (var i = 0; i < existingIds.length; i++) {
                if (String(existingIds[i]) === String(id)) {
                    collision = true;
                    break;
                }
            }
            if (!collision) {
                return id;
            }
        }
        return null;
    }

    function isValidStoredLocation(location) {
        if (!isObject(location)) {
            return false;
        }
        if (!isNonEmptyString(location.id)) {
            return false;
        }
        if (!isNonEmptyString(location.name)) {
            return false;
        }
        if (!isValidLocationType(location.type)) {
            return false;
        }
        if (!isValidCapacity(location.capacity)) {
            return false;
        }
        if (location.description !== undefined && typeof location.description !== 'string') {
            return false;
        }
        return true;
    }

    function validateAllLocations(store) {
        for (var i = 0; i < store.locations.length; i++) {
            if (!isValidStoredLocation(store.locations[i])) {
                return failure('Location data is malformed.');
            }
        }
        return success(null);
    }

    // ============================================================
    // LOCATION QUERIES
    // ============================================================

    function getLocation(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var data = getLocationStore();
        if (!data) {
            return null;
        }

        var target = String(id);
        var location = null;

        for (var i = 0; i < data.locations.length; i++) {
            var loc = data.locations[i];
            if (loc && String(loc.id) === target) {
                location = loc;
                break;
            }
        }

        if (!location || !isValidStoredLocation(location)) {
            return null;
        }

        return deepClone(location);
    }

    function getLocations() {
        var data = getLocationStore();
        if (!data) {
            return [];
        }

        var result = [];
        for (var i = 0; i < data.locations.length; i++) {
            var loc = data.locations[i];
            if (isValidStoredLocation(loc)) {
                var cloned = deepClone(loc);
                if (cloned !== null) {
                    result.push(cloned);
                }
            }
        }
        return result;
    }

    function getLocationOptions() {
        var locations = getLocations();
        var options = [];
        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            options.push({
                id: loc.id,
                name: loc.name,
                type: loc.type || 'other',
                capacity: loc.capacity,
                description: loc.description || ''
            });
        }
        options.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });
        return options;
    }

    function getLocationUsage(locationId) {
        if (!isNonEmptyString(locationId)) {
            return 0;
        }

        var data = getDataStore();
        if (!data) {
            return 0;
        }

        if (data.locationSchedules === undefined || data.locationSchedules === null) {
            return 0;
        }

        if (!isObject(data.locationSchedules)) {
            return 0;
        }

        var prefix = locationId + '_';
        var count = 0;

        for (var key in data.locationSchedules) {
            if (!Object.prototype.hasOwnProperty.call(data.locationSchedules, key)) {
                continue;
            }
            if (key.indexOf(prefix) === 0) {
                var weekSchedule = data.locationSchedules[key];
                if (isObject(weekSchedule)) {
                    for (var day in weekSchedule) {
                        if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) {
                            continue;
                        }
                        if (isObject(weekSchedule[day])) {
                            for (var hour in weekSchedule[day]) {
                                if (!Object.prototype.hasOwnProperty.call(weekSchedule[day], hour)) {
                                    continue;
                                }
                                if (weekSchedule[day][hour]) {
                                    count++;
                                }
                            }
                        }
                    }
                }
            }
        }

        return count;
    }

    function locationExists(id) {
        return getLocation(id) !== null;
    }

    // ============================================================
    // LOCATION MUTATIONS
    // ============================================================

    function createLocation(data) {
        if (!isObject(data)) {
            return failure('Location data must be an object.');
        }

        if (!isNonEmptyString(data.name)) {
            return failure('Location name is required.');
        }

        if (!isValidLocationType(data.type)) {
            return failure('Valid location type is required.');
        }

        if (!isValidCapacity(data.capacity)) {
            return failure('Capacity must be a whole number of 0 or greater.');
        }

        if (data.description !== undefined && typeof data.description !== 'string') {
            return failure('Description must be a string.');
        }

        var name = String(data.name).trim();
        var store = getLocationStore();

        if (!store) {
            return failure('Data store is not available.');
        }

        var storeValidation = validateAllLocations(store);
        if (!storeValidation.success) {
            return storeValidation;
        }

        var existing = store.locations.find(function(l) {
            return l && normaliseLocationName(l.name) === normaliseLocationName(name);
        });

        if (existing) {
            return failure('A location with this name already exists.');
        }

        var existingIds = [];
        for (var i = 0; i < store.locations.length; i++) {
            var loc = store.locations[i];
            if (loc && isNonEmptyString(loc.id)) {
                existingIds.push(loc.id);
            }
        }

        var newId = ensureUniqueGeneratedId('loc', existingIds);
        if (newId === null) {
            return failure('Failed to generate a unique location ID.');
        }

        var capacity = null;
        if (data.capacity !== undefined && data.capacity !== null && data.capacity !== '') {
            capacity = Number(data.capacity);
        }

        var newLocation = {
            id: newId,
            name: name,
            type: data.type || 'indoor',
            capacity: capacity,
            description: data.description || '',
            createdAt: new Date().toISOString()
        };

        if (!isValidStoredLocation(newLocation)) {
            return failure('Failed to build valid location object.');
        }

        var candidate = deepClone(store.locations);
        if (candidate === null) {
            return failure('Failed to prepare location data.');
        }

        candidate.push(newLocation);
        store.locations = candidate;

        recordActivity('Created location: ' + newLocation.name);

        return {
            success: true,
            location: deepClone(newLocation)
        };
    }

    function updateLocation(id, data) {
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        if (!isObject(data)) {
            return failure('Location data must be an object.');
        }

        if (data.name !== undefined && !isNonEmptyString(data.name)) {
            return failure('Location name cannot be empty.');
        }

        if (data.type !== undefined && !isValidLocationType(data.type)) {
            return failure('Invalid location type.');
        }

        if (data.capacity !== undefined && !isValidCapacity(data.capacity)) {
            return failure('Capacity must be a whole number of 0 or greater.');
        }

        if (data.description !== undefined && typeof data.description !== 'string') {
            return failure('Description must be a string.');
        }

        var store = getLocationStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var storeValidation = validateAllLocations(store);
        if (!storeValidation.success) {
            return storeValidation;
        }

        var index = -1;
        var location = null;

        for (var i = 0; i < store.locations.length; i++) {
            if (store.locations[i] && String(store.locations[i].id) === String(id)) {
                index = i;
                location = store.locations[i];
                break;
            }
        }

        if (index === -1) {
            return failure('Location not found.');
        }

        var candidate = deepClone(location);
        if (candidate === null) {
            return failure('Failed to clone location data.');
        }

        var hasChanges = false;

        if (data.name !== undefined) {
            var newName = String(data.name).trim();
            if (!newName) {
                return failure('Location name cannot be empty.');
            }

            var existing = store.locations.find(function(l) {
                return l && String(l.id) !== String(id) &&
                    normaliseLocationName(l.name) === normaliseLocationName(newName);
            });

            if (existing) {
                return failure('A location with this name already exists.');
            }

            if (candidate.name !== newName) {
                candidate.name = newName;
                hasChanges = true;
            }
        }

        if (data.type !== undefined) {
            if (!isValidLocationType(data.type)) {
                return failure('Invalid location type.');
            }
            if (candidate.type !== data.type) {
                candidate.type = data.type;
                hasChanges = true;
            }
        }

        if (data.capacity !== undefined) {
            var newCapacity = null;
            if (data.capacity !== null && data.capacity !== '') {
                newCapacity = Number(data.capacity);
            }

            if (candidate.capacity !== newCapacity) {
                candidate.capacity = newCapacity;
                hasChanges = true;
            }
        }

        if (data.description !== undefined) {
            var newDescription = data.description || '';
            if (candidate.description !== newDescription) {
                candidate.description = newDescription;
                hasChanges = true;
            }
        }

        if (!hasChanges) {
            return {
                success: true,
                location: deepClone(location),
                changed: false
            };
        }

        if (!isValidStoredLocation(candidate)) {
            return failure('Updated location would be malformed.');
        }

        var candidateArray = deepClone(store.locations);
        if (candidateArray === null) {
            return failure('Failed to prepare location data.');
        }

        candidateArray[index] = candidate;
        store.locations = candidateArray;

        recordActivity('Updated location: ' + candidate.name);

        return {
            success: true,
            location: deepClone(candidate),
            changed: true
        };
    }

    function deleteLocation(id) {
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(store.locations)) {
            return failure('No locations found.');
        }

        var storeValidation = validateAllLocations(store);
        if (!storeValidation.success) {
            return storeValidation;
        }

        var index = -1;
        var location = null;

        for (var i = 0; i < store.locations.length; i++) {
            if (store.locations[i] && String(store.locations[i].id) === String(id)) {
                index = i;
                location = store.locations[i];
                break;
            }
        }

        if (index === -1) {
            return failure('Location not found.');
        }

        var name = location.name;
        var usageCount = getLocationUsage(id);

        var candidateLocations = deepClone(store.locations);
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        var schedulesSource;
        if (store.locationSchedules === undefined || store.locationSchedules === null) {
            schedulesSource = {};
        } else if (!isObject(store.locationSchedules)) {
            return failure('Location schedule data is corrupted.');
        } else {
            schedulesSource = store.locationSchedules;
        }

        var candidateSchedules = deepClone(schedulesSource);
        if (candidateSchedules === null || !isObject(candidateSchedules)) {
            return failure('Failed to prepare schedule data.');
        }

        var prefix = id + '_';
        for (var key in candidateSchedules) {
            if (!Object.prototype.hasOwnProperty.call(candidateSchedules, key)) {
                continue;
            }
            if (key.indexOf(prefix) === 0) {
                delete candidateSchedules[key];
            }
        }

        candidateLocations.splice(index, 1);

        store.locations = candidateLocations;
        store.locationSchedules = candidateSchedules;

        recordActivity('Deleted location: ' + name + ' (' + usageCount + ' schedule entries removed)');

        return {
            success: true,
            deleted: true,
            usageCount: usageCount,
            hadUsage: usageCount > 0
        };
    }

    // ============================================================
    // LOCATION TYPE HELPERS
    // ============================================================

    function getLocationTypeLabel(type) {
        var labels = {
            'indoor': 'Indoor',
            'outdoor': 'Outdoor',
            'pool': 'Pool',
            'classroom': 'Classroom',
            'lab': 'Lab',
            'field': 'Field',
            'other': 'Other'
        };
        return labels[type] || type || 'Other';
    }

    function getLocationTypeColor(type) {
        var colors = {
            'indoor': 'var(--info)',
            'outdoor': 'var(--accent)',
            'pool': 'var(--info)',
            'classroom': 'var(--warning)',
            'lab': 'var(--danger)',
            'field': 'var(--accent)',
            'other': 'var(--text-dim)'
        };
        return colors[type] || 'var(--text-dim)';
    }

    function getLocationTypeIcon(type) {
        var icons = {
            'indoor': '🏠',
            'outdoor': '🌳',
            'pool': '🏊',
            'classroom': '📚',
            'lab': '🔬',
            'field': '🏟️',
            'other': '📍'
        };
        return icons[type] || '📍';
    }

    function getLocationTypes() {
        return VALID_LOCATION_TYPES.slice();
    }

    // ============================================================
    // DISCIPLINE QUERIES
    // ============================================================

    function getDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }

        var discipline = data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        });

        return discipline ? deepClone(discipline) : null;
    }

    function getDisciplines() {
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < data.curriculum.disciplines.length; i++) {
            var cloned = deepClone(data.curriculum.disciplines[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function getAvailableDisciplines(week) {
        var weekNum = Validators.validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }

        var disciplines = data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') {
                return false;
            }

            var start = Validators.parsePositiveInteger(d.startWeek);
            var end = Validators.parsePositiveInteger(d.endWeek);

            if (start !== null && start > weekNum) {
                return false;
            }
            if (end !== null && end < weekNum) {
                return false;
            }

            return true;
        });

        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var cloned = deepClone(disciplines[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function disciplineExists(id) {
        if (!isNonEmptyString(id)) {
            return false;
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return false;
        }

        var target = String(id);
        for (var i = 0; i < data.curriculum.disciplines.length; i++) {
            var d = data.curriculum.disciplines[i];
            if (d && String(d.id) === target) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // GRADING SYSTEM HELPERS
    // ============================================================

    function validateGradingSystem(system) {
        return Validators.validateGradingSystem(system);
    }

    function getGradeLetter(discipline, score) {
        if (!discipline || !Array.isArray(discipline.gradingSystem) || discipline.gradingSystem.length === 0) {
            return '';
        }

        var numScore = Number(score);
        if (!isFinite(numScore) || numScore < 0 || numScore > 100) {
            return '';
        }

        var sorted = discipline.gradingSystem.slice().sort(function(a, b) {
            return (b.min || 0) - (a.min || 0);
        });

        for (var i = 0; i < sorted.length; i++) {
            var grade = sorted[i];
            var min = Number(grade.min);
            var max = Number(grade.max);

            if (isFinite(min) && isFinite(max) && numScore >= min && numScore <= max) {
                return grade.label || grade.letter || '';
            }
        }

        return '';
    }

    function getDisciplineTypeLabel(type) {
        var labels = {
            'mandatory': 'Mandatory',
            'optional': 'Optional'
        };
        return labels[type] || type || 'Unknown';
    }

    function getDisciplineTypeColor(type) {
        var colors = {
            'mandatory': 'var(--accent)',
            'optional': 'var(--warning)'
        };
        return colors[type] || 'var(--text-dim)';
    }

    function isValidDisciplineType(type) {
        return type === 'mandatory' || type === 'optional';
    }

    // ============================================================
    // DISCIPLINE VALIDATION HELPERS
    // ============================================================

    function validateDisciplineName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Discipline name is required.');
        }

        var trimmed = String(name).trim();

        var data = getDataStore();
        if (data && data.curriculum && Array.isArray(data.curriculum.disciplines)) {
            var existing = data.curriculum.disciplines.find(function(d) {
                return d &&
                    String(d.id) !== String(excludeId) &&
                    String(d.name || '').trim().toLowerCase() === trimmed.toLowerCase();
            });
            if (existing) {
                return failure('A discipline with this name already exists.');
            }
        }

        return success(null);
    }

    // ============================================================
    // DISCIPLINE MUTATIONS
    // ============================================================

    function createDiscipline(data) {
        if (!isObject(data)) {
            return failure('Discipline data must be an object.');
        }

        var validation = Validators.validateDiscipline(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return failure('Data store is not available.');
        }

        var name = String(data.name).trim();
        var existing = store.curriculum.disciplines.find(function(d) {
            return d && String(d.name || '').toLowerCase() === name.toLowerCase();
        });

        if (existing) {
            return failure('A discipline with this name already exists.');
        }

        var startWeek = data.startWeek !== undefined && data.startWeek !== null && data.startWeek !== ''
            ? String(data.startWeek)
            : '';
        var endWeek = data.endWeek !== undefined && data.endWeek !== null && data.endWeek !== ''
            ? String(data.endWeek)
            : '';
        var weeklyHours = data.weeklyHours !== undefined && data.weeklyHours !== null && data.weeklyHours !== ''
            ? Math.round(Number(data.weeklyHours) * 10) / 10
            : '';
        var maxStudents = data.maxStudents !== undefined && data.maxStudents !== null && data.maxStudents !== ''
            ? Number(data.maxStudents)
            : '';
        var weight = data.weight !== undefined && data.weight !== null && data.weight !== ''
            ? Math.round(Number(data.weight) * 100) / 100
            : 1;

        var discipline = {
            id: generateId('disc'),
            name: name,
            type: data.type || 'mandatory',
            instructorIds: Array.isArray(data.instructorIds) ? data.instructorIds.slice() : [],
            curriculum: data.curriculum || '',
            startWeek: startWeek,
            endWeek: endWeek,
            weeklyHours: weeklyHours,
            maxStudents: maxStudents,
            weight: weight,
            gradingSystem: [],
            createdAt: new Date().toISOString()
        };

        if (data.gradingSystem !== undefined && Array.isArray(data.gradingSystem)) {
            var gradingResult = validateGradingSystem(data.gradingSystem);
            if (!gradingResult.valid) {
                return failure(gradingResult.message);
            }
            discipline.gradingSystem = data.gradingSystem.slice();
        }

        var builtValidation = Validators.validateDiscipline(discipline, false);
        if (!builtValidation.valid) {
            return failure('Internal validation failed: ' + builtValidation.message);
        }

        var candidate = deepClone(store.curriculum.disciplines);
        if (candidate === null) {
            return failure('Failed to prepare discipline data.');
        }

        candidate.push(discipline);
        store.curriculum.disciplines = candidate;

        recordActivity('Created discipline: ' + discipline.name);

        return {
            success: true,
            discipline: deepClone(discipline)
        };
    }

    function updateDiscipline(id, data) {
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        if (!isObject(data)) {
            return failure('Updates must be an object.');
        }

        var validation = Validators.validateDiscipline(data, true);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return failure('No disciplines found.');
        }

        var index = store.curriculum.disciplines.findIndex(function(d) {
            return d && String(d.id) === String(id);
        });

        if (index === -1) {
            return failure('Discipline not found.');
        }

        var discipline = store.curriculum.disciplines[index];
        var candidate = deepClone(discipline);
        if (candidate === null) {
            return failure('Failed to clone discipline data.');
        }

        var hasChanges = false;

        if (data.name !== undefined) {
            var newName = String(data.name).trim();
            if (!newName) {
                return failure('Discipline name cannot be empty.');
            }

            var existing = store.curriculum.disciplines.find(function(d) {
                return d && String(d.id) !== String(id) &&
                    String(d.name || '').toLowerCase() === newName.toLowerCase();
            });

            if (existing) {
                return failure('A discipline with this name already exists.');
            }

            candidate.name = newName;
            hasChanges = true;
        }

        if (data.type !== undefined) {
            if (!isValidDisciplineType(data.type)) {
                return failure('Invalid discipline type.');
            }
            candidate.type = data.type;
            hasChanges = true;
        }

        if (data.instructorIds !== undefined) {
            if (!Array.isArray(data.instructorIds)) {
                return failure('Instructor IDs must be an array.');
            }
            candidate.instructorIds = data.instructorIds.slice();
            hasChanges = true;
        }

        if (data.curriculum !== undefined) {
            candidate.curriculum = data.curriculum;
            hasChanges = true;
        }

        if (data.startWeek !== undefined) {
            candidate.startWeek = data.startWeek !== '' ? String(data.startWeek) : '';
            hasChanges = true;
        }

        if (data.endWeek !== undefined) {
            candidate.endWeek = data.endWeek !== '' ? String(data.endWeek) : '';
            hasChanges = true;
        }

        if (data.weeklyHours !== undefined) {
            candidate.weeklyHours = data.weeklyHours !== '' ? Math.round(Number(data.weeklyHours) * 10) / 10 : '';
            hasChanges = true;
        }

        if (data.maxStudents !== undefined) {
            candidate.maxStudents = data.maxStudents !== '' ? Number(data.maxStudents) : '';
            hasChanges = true;
        }

        if (data.weight !== undefined) {
            candidate.weight = data.weight !== '' ? Math.round(Number(data.weight) * 100) / 100 : 1;
            hasChanges = true;
        }

        if (data.gradingSystem !== undefined) {
            if (!Array.isArray(data.gradingSystem)) {
                return failure('Grading system must be an array.');
            }
            var gradingResult = validateGradingSystem(data.gradingSystem);
            if (!gradingResult.valid) {
                return failure(gradingResult.message);
            }
            candidate.gradingSystem = data.gradingSystem.slice();
            hasChanges = true;
        }

        if (!hasChanges) {
            return {
                success: true,
                discipline: deepClone(discipline),
                changed: false
            };
        }

        var builtValidation = Validators.validateDiscipline(candidate, false);
        if (!builtValidation.valid) {
            return failure('Internal validation failed: ' + builtValidation.message);
        }

        var candidateArray = deepClone(store.curriculum.disciplines);
        if (candidateArray === null) {
            return failure('Failed to prepare discipline data.');
        }

        candidateArray[index] = candidate;
        store.curriculum.disciplines = candidateArray;

        recordActivity('Updated discipline: ' + candidate.name);

        return {
            success: true,
            discipline: deepClone(candidate),
            changed: true
        };
    }

    function deleteDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return failure('No disciplines found.');
        }

        var index = store.curriculum.disciplines.findIndex(function(d) {
            return d && String(d.id) === String(id);
        });

        if (index === -1) {
            return failure('Discipline not found.');
        }

        var discipline = store.curriculum.disciplines[index];
        var name = discipline.name;

        var curriculumClone = deepClone(store.curriculum);
        if (curriculumClone === null) {
            return failure('Failed to prepare deletion. Please try again.');
        }

        try {
            // Remove from schedules
            if (curriculumClone.schedules && isObject(curriculumClone.schedules)) {
                for (var studentId in curriculumClone.schedules) {
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.schedules, studentId)) {
                        continue;
                    }
                    var studentSchedule = curriculumClone.schedules[studentId];
                    if (!isObject(studentSchedule)) {
                        continue;
                    }

                    for (var week in studentSchedule) {
                        if (!Object.prototype.hasOwnProperty.call(studentSchedule, week)) {
                            continue;
                        }
                        var weekSchedule = studentSchedule[week];
                        if (!isObject(weekSchedule)) {
                            continue;
                        }

                        for (var day in weekSchedule) {
                            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) {
                                continue;
                            }
                            var daySchedule = weekSchedule[day];
                            if (!isObject(daySchedule)) {
                                continue;
                            }

                            for (var hour in daySchedule) {
                                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                                    continue;
                                }
                                if (String(daySchedule[hour]) === String(id)) {
                                    delete daySchedule[hour];

                                    var key = studentId + '_' + week + '_' + day + '_' + hour;
                                    if (curriculumClone.classInstructors) {
                                        delete curriculumClone.classInstructors[key];
                                    }
                                    if (curriculumClone.classLabels) {
                                        delete curriculumClone.classLabels[key];
                                    }
                                    if (curriculumClone.classGroupLabels) {
                                        delete curriculumClone.classGroupLabels[key];
                                    }
                                    if (curriculumClone.classDurations) {
                                        delete curriculumClone.classDurations[key];
                                    }
                                    if (curriculumClone.classLocations) {
                                        delete curriculumClone.classLocations[key];
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Remove from grades
            if (curriculumClone.grades && isObject(curriculumClone.grades)) {
                for (var studentId in curriculumClone.grades) {
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.grades, studentId)) {
                        continue;
                    }
                    var studentGrades = curriculumClone.grades[studentId];
                    if (!isObject(studentGrades)) {
                        continue;
                    }

                    for (var week in studentGrades) {
                        if (!Object.prototype.hasOwnProperty.call(studentGrades, week)) {
                            continue;
                        }
                        var weekGrades = studentGrades[week];
                        if (isObject(weekGrades)) {
                            delete weekGrades[id];
                        }
                    }
                }
            }

            // Remove from auto-groups
            if (curriculumClone.autoGroups && isObject(curriculumClone.autoGroups)) {
                for (var key in curriculumClone.autoGroups) {
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.autoGroups, key)) {
                        continue;
                    }
                    var group = curriculumClone.autoGroups[key];
                    if (group && String(group.disciplineId) === String(id)) {
                        delete curriculumClone.autoGroups[key];
                    }
                }
            }

            // Remove from discipline groups
            if (curriculumClone.disciplineGroups) {
                delete curriculumClone.disciplineGroups[id];
            }

            // Remove discipline
            if (!Array.isArray(curriculumClone.disciplines)) {
                return failure('Corrupted discipline data structure.');
            }

            var cloneIndex = curriculumClone.disciplines.findIndex(function(d) {
                return d && String(d.id) === String(id);
            });

            if (cloneIndex === -1) {
                return failure('Discipline disappeared during deletion preparation.');
            }

            curriculumClone.disciplines.splice(cloneIndex, 1);

        } catch (e) {
            return failure('Deletion failed during cleanup: ' + e.message);
        }

        var originalCurriculum = store.curriculum;
        var keys = Object.keys(originalCurriculum);

        for (var i = 0; i < keys.length; i++) {
            delete originalCurriculum[keys[i]];
        }

        Object.assign(originalCurriculum, curriculumClone);

        recordActivity('Deleted discipline: ' + name);

        return {
            success: true,
            deleted: true,
            name: name
        };
    }

    // ============================================================
    // INSTRUCTOR HELPERS (for disciplines)
    // ============================================================

    function getDisciplineInstructors(discipline) {
        if (!discipline || !Array.isArray(discipline.instructorIds)) {
            return [];
        }

        var instructors = [];
        for (var i = 0; i < discipline.instructorIds.length; i++) {
            var instructor = window.getCharacterById(discipline.instructorIds[i]);
            if (instructor) {
                instructors.push(instructor);
            }
        }
        return instructors;
    }

    function getDisciplineInstructorNames(discipline) {
        var instructors = getDisciplineInstructors(discipline);
        return instructors.map(function(instructor) {
            if (typeof window.getDisplayName === 'function') {
                return window.getDisplayName(instructor);
            }
            return instructor.name || 'Unknown';
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SchoolCore = {
        // Discipline CRUD
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getAvailableDisciplines: getAvailableDisciplines,
        disciplineExists: disciplineExists,
        createDiscipline: createDiscipline,
        updateDiscipline: updateDiscipline,
        deleteDiscipline: deleteDiscipline,

        // Discipline helpers
        getDisciplineTypeLabel: getDisciplineTypeLabel,
        getDisciplineTypeColor: getDisciplineTypeColor,
        isValidDisciplineType: isValidDisciplineType,
        validateDisciplineName: validateDisciplineName,

        // Discipline instructors
        getDisciplineInstructors: getDisciplineInstructors,
        getDisciplineInstructorNames: getDisciplineInstructorNames,

        // Grading system
        validateGradingSystem: validateGradingSystem,
        getGradeLetter: getGradeLetter,

        // Location CRUD
        getLocation: getLocation,
        getLocations: getLocations,
        getLocationOptions: getLocationOptions,
        getLocationUsage: getLocationUsage,
        locationExists: locationExists,
        createLocation: createLocation,
        updateLocation: updateLocation,
        deleteLocation: deleteLocation,

        // Location type helpers
        getLocationTypeLabel: getLocationTypeLabel,
        getLocationTypeColor: getLocationTypeColor,
        getLocationTypeIcon: getLocationTypeIcon,
        getLocationTypes: getLocationTypes,
        isValidLocationType: isValidLocationType,

        // Constants
        VALID_LOCATION_TYPES: VALID_LOCATION_TYPES
    };

})();
