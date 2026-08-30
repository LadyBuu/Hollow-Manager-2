/**
 * js/core/curriculum/curriculum-locations.js - Location CRUD Operations
 * Path: js/core/curriculum/curriculum-locations.js
 * 
 * This module provides location CRUD operations.
 * 
 * IMPORTANT:
 *   - All MUTATION operations return:
 *     { success: true, changed: boolean, operation: string, data: object, count: number }
 *     or { success: false, message: string }
 *   - Query functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are DEEP CLONED to prevent external mutation
 *   - Malformed existing locations are REJECTED (fail closed)
 *   - Location names must be unique (case-insensitive, trimmed)
 *   - Capacity: null = unlimited, 0 = zero capacity, N = capacity N
 *   - Generated IDs are validated for uniqueness
 *   - All schedule entry validation uses a single canonical function
 *   - Deletion removes ALL schedule keys belonging to the location
 * 
 * SCHEDULE SEMANTICS:
 *   - Keys are canonical: locationId_week (week: 1-52, no leading zeros)
 *   - Deletion removes ALL keys with matching prefix (including malformed)
 *   - Usage queries count only keys matching canonical format
 *   - Malformed schedule entries are ignored for usage-count queries
 *   - Availability checks fail closed when the target slot contains malformed data
 *   - Malformed schedule containers cause usage queries to return 0
 *   - A valid schedule entry is a non-empty string (discipline ID)
 *   - getLocationUsage() works on orphaned/location IDs intentionally (for diagnostics)
 * 
 * MUTATION RESULT CONTRACT:
 *   - createLocation:
 *     { success: true, changed: true, operation: 'created', data: { location: object }, count: 1 }
 *   - updateLocation:
 *     { success: true, changed: boolean, operation: 'updated' or 'unchanged', data: { location: object }, count: 1 or 0 }
 *   - deleteLocation:
 *     { success: true, changed: true, operation: 'deleted', data: {}, count: 1, usageCount: number }
 *   - All failures: { success: false, message: string }
 * 
 * STORED LOCATION VALIDATION:
 *   - All locations retrieved from storage are validated
 *   - Malformed locations are skipped in query results
 *   - Mutations validate the entire collection before proceeding
 *   - createdAt is treated as optional metadata (not validated)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumLocationsLoaded) {
        return;
    }
    window.__curriculumLocationsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_LOCATION_TYPES = [
        'indoor', 'outdoor', 'pool', 'classroom', 'lab', 'field', 'other'
    ];

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
    }

    function generateId(prefix) {
        prefix = prefix || 'loc';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function normaliseLocationName(name) {
        return isNonEmptyString(name) ? name.trim().toLowerCase() : '';
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumLocations: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumLocations: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function isValidLocationType(type) {
        return typeof type === 'string' && VALID_LOCATION_TYPES.indexOf(type) !== -1;
    }

    function isValidCapacity(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        var num = Number(value);
        if (!isSafeInteger(num) || num < 0) {
            return false;
        }
        return true;
    }

    function isValidDescription(value) {
        return value === undefined || typeof value === 'string';
    }

    function validateLocation(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Location data must be an object.' };
        }

        if (isPartial) {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name cannot be empty.' };
            }
            if (data.type !== undefined && !isValidLocationType(data.type)) {
                return { valid: false, message: 'Invalid location type.' };
            }
            if (data.capacity !== undefined && !isValidCapacity(data.capacity)) {
                return { valid: false, message: 'Capacity must be a whole number of 0 or greater.' };
            }
            if (data.description !== undefined && !isValidDescription(data.description)) {
                return { valid: false, message: 'Description must be a string.' };
            }
        } else {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name is required.' };
            }
            if (!isValidCapacity(data.capacity)) {
                return { valid: false, message: 'Capacity must be a whole number of 0 or greater.' };
            }
            if (!isValidDescription(data.description)) {
                return { valid: false, message: 'Description must be a string.' };
            }
        }

        return { valid: true };
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

        if (!isValidDescription(location.description)) {
            return false;
        }

        return true;
    }

    /**
     * Validate a canonical schedule key.
     * Format: locationId_week (week: 1-52, no leading zeros)
     */
    function isValidScheduleKey(key, locationId) {
        if (!isNonEmptyString(key)) {
            return false;
        }

        var prefix = locationId + '_';
        if (key.indexOf(prefix) !== 0) {
            return false;
        }

        var weekPart = key.substring(prefix.length);
        var weekNum = Number(weekPart);

        if (!isSafeInteger(weekNum) || weekNum < 1 || weekNum > 52) {
            return false;
        }

        // Exact format: weekPart must be a decimal integer string without leading zeros
        if (weekPart !== String(weekNum)) {
            return false;
        }

        return true;
    }

    /**
     * Check if a key belongs to a location (prefix match).
     * Used for deletion to remove ALL associated keys.
     */
    function keyBelongsToLocation(key, locationId) {
        if (!isNonEmptyString(key) || !isNonEmptyString(locationId)) {
            return false;
        }
        var prefix = locationId + '_';
        return key.indexOf(prefix) === 0;
    }

    /**
     * Canonical schedule entry validator.
     * A valid schedule entry is a non-empty string (discipline ID).
     * Malformed entries are ignored (not rejected) for usage queries.
     */
    function isValidScheduleEntry(entry) {
        return isNonEmptyString(entry);
    }

    function validateWeek(value) {
        var num = Number(value);
        return isSafeInteger(num) && num >= 1 && num <= 52 ? num : null;
    }

    function validateDay(value) {
        var num = Number(value);
        return isSafeInteger(num) && num >= 1 && num <= 7 ? num : null;
    }

    function validateHour(value) {
        var num = Number(value);
        return isSafeInteger(num) && num >= 0 && num <= 23 ? num : null;
    }

    function getLocationStore() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return null;
        }
        return data;
    }

    function getValidLocationsFromStore() {
        var data = getLocationStore();
        if (!data) {
            return [];
        }

        var result = [];
        for (var i = 0; i < data.locations.length; i++) {
            if (isValidStoredLocation(data.locations[i])) {
                result.push(data.locations[i]);
            }
        }
        return result;
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

    function validateAllLocations(store) {
        for (var i = 0; i < store.locations.length; i++) {
            if (!isValidStoredLocation(store.locations[i])) {
                return { success: false, message: 'Location data is malformed.' };
            }
        }
        return { success: true };
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function successResult(operation, data, changed, count, extra) {
        var safeData = deepClone(data || {});
        if (safeData === null) {
            return failure('Failed to prepare operation result.');
        }

        var result = {
            success: true,
            changed: changed !== undefined ? changed : true,
            operation: operation || 'updated',
            data: safeData,
            count: typeof count === 'number' ? count : 1
        };

        if (extra) {
            for (var key in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, key)) {
                    result[key] = extra[key];
                }
            }
        }

        return result;
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
        var locations = getValidLocationsFromStore();
        var result = [];

        for (var i = 0; i < locations.length; i++) {
            var cloned = deepClone(locations[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }

        return result;
    }

    function getLocationsByType(type) {
        var locations = getLocations();
        if (!type) {
            return locations;
        }
        return locations.filter(function(l) {
            return l.type === type;
        });
    }

    function getLocationByName(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var target = normaliseLocationName(name);
        var locations = getValidLocationsFromStore();

        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            if (normaliseLocationName(loc.name) === target) {
                return deepClone(loc);
            }
        }

        return null;
    }

    function getLocationOptions() {
        var locations = getValidLocationsFromStore();
        var options = [];

        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            if (!isNonEmptyString(loc.name)) {
                continue;
            }
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

        var count = 0;

        for (var key in data.locationSchedules) {
            if (!Object.prototype.hasOwnProperty.call(data.locationSchedules, key)) {
                continue;
            }

            // Only count canonical schedule keys
            if (!isValidScheduleKey(key, locationId)) {
                continue;
            }

            var weekSchedule = data.locationSchedules[key];
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
                    var entry = daySchedule[hour];
                    if (isValidScheduleEntry(entry)) {
                        count++;
                    }
                }
            }
        }

        return count;
    }

    function getLocationUsageByWeek(locationId, week) {
        if (!isNonEmptyString(locationId)) {
            return 0;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
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

        var key = locationId + '_' + weekNum;

        if (!isValidScheduleKey(key, locationId)) {
            return 0;
        }

        var weekSchedule = data.locationSchedules[key];

        if (!isObject(weekSchedule)) {
            return 0;
        }

        var count = 0;
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
                var entry = daySchedule[hour];
                if (isValidScheduleEntry(entry)) {
                    count++;
                }
            }
        }

        return count;
    }

    function getLocationCapacity(locationId) {
        var location = getLocation(locationId);
        if (!location) {
            return null;
        }

        var capacity = location.capacity;

        if (capacity === undefined || capacity === null || capacity === '') {
            return null;
        }

        if (!isValidCapacity(capacity)) {
            return null;
        }

        return Number(capacity);
    }

    function isLocationAvailable(locationId, week, day, hour) {
        // ---- PHASE 1: VALIDATE LOCATION EXISTS ----
        if (!isNonEmptyString(locationId)) {
            return false;
        }

        if (!getLocation(locationId)) {
            return false;
        }

        // ---- PHASE 2: VALIDATE SCHEDULE SLOT ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return false;
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return false;
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return false;
        }

        // ---- PHASE 3: CHECK SCHEDULE STRUCTURE (fail closed) ----
        var data = getDataStore();
        if (!data) {
            return false;
        }

        if (data.locationSchedules === undefined || data.locationSchedules === null) {
            return true;
        }

        if (!isObject(data.locationSchedules)) {
            return false;
        }

        var key = locationId + '_' + weekNum;

        if (!isValidScheduleKey(key, locationId)) {
            return false;
        }

        var weekSchedule = data.locationSchedules[key];

        if (weekSchedule === undefined) {
            return true;
        }

        if (!isObject(weekSchedule)) {
            return false;
        }

        var daySchedule = weekSchedule[dayNum];

        if (daySchedule === undefined) {
            return true;
        }

        if (!isObject(daySchedule)) {
            return false;
        }

        var entry = daySchedule[hourNum];

        if (entry === undefined || entry === null || entry === '') {
            return true;
        }

        if (!isValidScheduleEntry(entry)) {
            return false;
        }

        return false;
    }

    function locationExists(id) {
        return getLocation(id) !== null;
    }

    // ============================================================
    // LOCATION CRUD MUTATIONS
    // ============================================================

    function createLocation(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var validation = validateLocation(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var name = String(data.name).trim();
        var store = getLocationStore();

        if (!store) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 2: VALIDATE EXISTING STORE (fail closed) ----
        var storeValidation = validateAllLocations(store);
        if (!storeValidation.success) {
            return failure(storeValidation.message);
        }

        // ---- PHASE 3: CHECK DUPLICATE ----
        var existing = store.locations.find(function(l) {
            return l && normaliseLocationName(l.name) === normaliseLocationName(name);
        });

        if (existing) {
            return failure('A location with this name already exists.');
        }

        // ---- PHASE 4: GENERATE UNIQUE ID ----
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

        // ---- PHASE 5: BUILD LOCATION ----
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

        // ---- PHASE 6: VALIDATE BUILT OBJECT ----
        if (!isValidStoredLocation(newLocation)) {
            return failure('Failed to build valid location object.');
        }

        // ---- PHASE 7: BUILD CANDIDATE AND COMMIT ----
        var candidate = deepClone(store.locations);
        if (candidate === null) {
            return failure('Failed to prepare location data.');
        }

        candidate.push(newLocation);
        store.locations = candidate;

        logActivity('Created location: ' + newLocation.name);

        return successResult('created', { location: newLocation }, true, 1);
    }

    function updateLocation(id, data) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        // ---- PHASE 2: VALIDATE INPUT ----
        var validation = validateLocation(data, true);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 3: GET STORE ----
        var store = getLocationStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 4: VALIDATE EXISTING STORE (fail closed) ----
        var storeValidation = validateAllLocations(store);
        if (!storeValidation.success) {
            return failure(storeValidation.message);
        }

        // ---- PHASE 5: FIND LOCATION ----
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

        // ---- PHASE 6: BUILD CANDIDATE ----
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

        // ---- PHASE 7: NO CHANGES ----
        if (!hasChanges) {
            return successResult('unchanged', { location: location }, false, 0);
        }

        // ---- PHASE 8: VALIDATE CANDIDATE ----
        if (!isValidStoredLocation(candidate)) {
            return failure('Updated location would be malformed.');
        }

        // ---- PHASE 9: BUILD CANDIDATE ARRAY AND COMMIT ----
        var candidateArray = deepClone(store.locations);
        if (candidateArray === null) {
            return failure('Failed to prepare location data.');
        }

        candidateArray[index] = candidate;
        store.locations = candidateArray;

        logActivity('Updated location: ' + candidate.name);

        return successResult('updated', { location: candidate }, true, 1);
    }

    function deleteLocation(id) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(store.locations)) {
            return failure('No locations found.');
        }

        // ---- PHASE 3: VALIDATE EXISTING STORE (fail closed) ----
        var storeValidation = validateAllLocations(store);
        if (!storeValidation.success) {
            return failure(storeValidation.message);
        }

        // ---- PHASE 4: FIND LOCATION ----
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

        // ---- PHASE 5: CALCULATE USAGE ----
        var usageCount = getLocationUsage(id);

        // ---- PHASE 6: BUILD CANDIDATES ----
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

        // ---- PHASE 7: CLEAN SCHEDULES (remove ALL keys with matching prefix) ----
        for (var key in candidateSchedules) {
            if (!Object.prototype.hasOwnProperty.call(candidateSchedules, key)) {
                continue;
            }
            if (keyBelongsToLocation(key, id)) {
                delete candidateSchedules[key];
            }
        }

        // ---- PHASE 8: REMOVE LOCATION ----
        candidateLocations.splice(index, 1);

        // ---- PHASE 9: COMMIT ----
        store.locations = candidateLocations;
        store.locationSchedules = candidateSchedules;

        logActivity('Deleted location: ' + name + ' (' + usageCount + ' schedule entries removed)');

        return successResult('deleted', {}, true, 1, { usageCount: usageCount });
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
    // EXPOSE
    // ============================================================

    // Queries
    window.getLocation = getLocation;
    window.getLocations = getLocations;
    window.getLocationsByType = getLocationsByType;
    window.getLocationByName = getLocationByName;
    window.getLocationOptions = getLocationOptions;
    window.getLocationUsage = getLocationUsage;
    window.getLocationUsageByWeek = getLocationUsageByWeek;
    window.locationExists = locationExists;
    window.getLocationCapacity = getLocationCapacity;
    window.isLocationAvailable = isLocationAvailable;

    // Mutations
    window.createLocation = createLocation;
    window.updateLocation = updateLocation;
    window.deleteLocation = deleteLocation;

    // Type helpers
    window.getLocationTypeLabel = getLocationTypeLabel;
    window.getLocationTypeColor = getLocationTypeColor;
    window.getLocationTypeIcon = getLocationTypeIcon;
    window.getLocationTypes = getLocationTypes;

    // Constants
    window.VALID_LOCATION_TYPES = VALID_LOCATION_TYPES;

})();
