/**
 * core/location-core.js - Location Core Operations
 * Single source of truth for all location-related data mutations
 * Path: js/core/location-core.js
 * 
 * This module handles:
 *   - Location CRUD (create, read, update, delete)
 *   - Location usage tracking
 *   - Location name uniqueness validation
 *   - Location type validation
 *   - Capacity validation
 * 
 * IMPORTANT:
 *   - All MUTATION operations return an object with { success: boolean }.
 *   - Failure results include { message: string }.
 *   - Successful operations may include operation-specific result fields:
 *     - createLocation/updateLocation: { location: object }
 *     - deleteLocation: { usageCount: number, hadUsage: boolean }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are DEEP CLONED to prevent external mutation
 * 
 * MUTATION INVARIANT (CANDIDATE-BASED COMMIT):
 *   - All mutations build candidates BEFORE touching any live state
 *   - 1. Validate inputs
 *   - 2. Validate live state structure exists (read-only)
 *   - 3. Build candidate (deep clone)
 *   - 4. Apply validated changes to candidate
 *   - 5. Pre-clone result data (safe)
 *   - 6. COMMIT candidate to data store
 *   - 7. If any step before commit fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before all validation completes
 *   - This is a candidate-based commit, not a database transaction
 * 
 * LOCATION SEMANTICS:
 *   - Locations are stored as: { id, name, type, capacity, description, createdAt }
 *   - Location schedules are stored separately in locationSchedules
 *   - Location usage counts entries in locationSchedules
 *   - Deleting a location cleans up all associated schedules
 *   - Location names must be unique (case-insensitive, trimmed)
 *   - Capacity: null = unlimited, 0 = zero capacity, N = capacity N
 *   - Usage tracking counts scheduled slots, not occupants
 *   - Capacity validation ensures the capacity value is legal (not enforced on scheduling)
 *   - isLocationAvailable checks if a specific slot is empty
 *   - Schedule keys use the format: <locationId>_<week>
 *   - Missing locationSchedules store is treated as empty
 *   - Malformed locationSchedules (non-object) in mutations = corruption
 *   - Usage queries return 0 for missing or malformed schedules (numeric contract)
 *   - Availability returns true for missing schedules, false for malformed
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__locationCoreLoaded) {
        return;
    }
    window.__locationCoreLoaded = true;

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

    function parsePositiveInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    /**
     * Get the location store. Does NOT mutate live state.
     * Returns null if the location store is invalid.
     */
    function getLocationStore() {
        var data = getDataStore();
        if (!data) return null;

        if (!Array.isArray(data.locations)) {
            return null;
        }

        return data;
    }

    function logActivity(message, type) {
        type = type || 'info';

        if (typeof window.logActivity !== 'function') {
            return;
        }

        try {
            window.logActivity(message, type);
        } catch (e) {
            console.error('LocationCore: activity logging failed:', e);
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
                console.error('LocationCore: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('LocationCore: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    function success(data) {
        return {
            success: true,
            data: data
        };
    }

    function successWithLocation(location) {
        var cloned = deepClone(location);
        if (cloned === null) {
            return failure('Failed to clone location data.');
        }
        return {
            success: true,
            location: cloned
        };
    }

    function successWithDeletion(usageCount) {
        return {
            success: true,
            usageCount: usageCount || 0,
            hadUsage: usageCount > 0
        };
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function isValidLocationType(type) {
        return typeof type === 'string' &&
               VALID_LOCATION_TYPES.indexOf(type) !== -1;
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

    /**
     * Validate location data.
     * Partial mode allows updating only some fields.
     */
    function validateLocation(data, isPartial) {
        if (!isObject(data)) {
            return failure('Location data must be an object.');
        }

        // Name validation
        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return failure('Location name is required.');
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return failure('Location name cannot be empty.');
            }
        }

        // Type validation
        if (!isPartial) {
            if (!isValidLocationType(data.type)) {
                return failure('Valid location type is required.');
            }
        } else {
            if (data.type !== undefined && !isValidLocationType(data.type)) {
                return failure('Invalid location type.');
            }
        }

        // Capacity validation
        if (!isPartial) {
            if (!isValidCapacity(data.capacity)) {
                return failure('Capacity must be a whole number of 0 or greater.');
            }
        } else {
            if (data.capacity !== undefined && !isValidCapacity(data.capacity)) {
                return failure('Capacity must be a whole number of 0 or greater.');
            }
        }

        // Description validation
        if (data.description !== undefined && typeof data.description !== 'string') {
            return failure('Description must be a string.');
        }

        return success(null);
    }

    // ============================================================
    // LOCATION QUERIES (with cloning for safety)
    // ============================================================

    function getLocation(id) {
        if (!isNonEmptyString(id)) return null;

        var data = getLocationStore();
        if (!data) return null;

        var location = data.locations.find(function(l) {
            return l && String(l.id) === String(id);
        });

        return location ? deepClone(location) : null;
    }

    function getLocations() {
        var data = getLocationStore();
        if (!data) return [];

        var result = [];
        for (var i = 0; i < data.locations.length; i++) {
            var cloned = deepClone(data.locations[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function getLocationsByType(type) {
        var locations = getLocations();
        if (!type) return locations;

        return locations.filter(function(l) {
            return l.type === type;
        });
    }

    function getLocationByName(name) {
        if (!isNonEmptyString(name)) return null;

        var data = getLocationStore();
        if (!data) return null;

        var target = normaliseLocationName(name);
        var location = data.locations.find(function(l) {
            return l && normaliseLocationName(l.name) === target;
        });

        return location ? deepClone(location) : null;
    }

    function getLocationOptions() {
        var locations = getLocations();
        var options = [];

        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            if (!loc || typeof loc !== 'object') continue;
            if (!isNonEmptyString(loc.name)) continue;

            var typeLabel = getLocationTypeLabel(loc.type);
            options.push({
                id: loc.id,
                name: loc.name,
                type: loc.type,
                typeLabel: typeLabel,
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

        // Schedule keys use the format: <locationId>_<week>
        var prefix = locationId + '_';
        var count = 0;

        for (var key in data.locationSchedules) {
            if (!Object.prototype.hasOwnProperty.call(data.locationSchedules, key)) continue;
            if (key.indexOf(prefix) === 0) {
                var weekSchedule = data.locationSchedules[key];
                if (isObject(weekSchedule)) {
                    for (var day in weekSchedule) {
                        if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) continue;
                        if (isObject(weekSchedule[day])) {
                            for (var hour in weekSchedule[day]) {
                                if (!Object.prototype.hasOwnProperty.call(weekSchedule[day], hour)) continue;
                                // Any truthy value counts as occupancy
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
        var weekSchedule = data.locationSchedules[key];

        if (!isObject(weekSchedule)) {
            return 0;
        }

        var count = 0;
        for (var day in weekSchedule) {
            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) continue;
            if (isObject(weekSchedule[day])) {
                for (var hour in weekSchedule[day]) {
                    if (!Object.prototype.hasOwnProperty.call(weekSchedule[day], hour)) continue;
                    if (weekSchedule[day][hour]) {
                        count++;
                    }
                }
            }
        }

        return count;
    }

    function getLocationCapacity(locationId) {
        var location = getLocation(locationId);
        if (!location) return null;
        return location.capacity !== undefined && location.capacity !== null && location.capacity !== ''
            ? Number(location.capacity)
            : null;
    }

    function isLocationAvailable(locationId, week, day, hour) {
        if (!isNonEmptyString(locationId)) return false;

        var weekNum = validateWeek(week);
        if (weekNum === null) return false;

        if (!isSafeInteger(day) || day < 1 || day > 7) return false;
        if (!isSafeInteger(hour) || hour < 0 || hour > 23) return false;

        var data = getDataStore();
        if (!data) return false;

        // Missing schedule store = no occupancy
        if (data.locationSchedules === undefined || data.locationSchedules === null) {
            return true;
        }

        // Malformed schedule store = cannot determine availability
        if (!isObject(data.locationSchedules)) {
            return false;
        }

        var key = locationId + '_' + weekNum;
        var weekSchedule = data.locationSchedules[key];

        if (!weekSchedule || !weekSchedule[day] || !weekSchedule[day][hour]) {
            return true;
        }

        return false;
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    // ============================================================
    // LOCATION MUTATIONS (candidate-based, NO live mutation)
    // ============================================================

    function createLocation(data) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var validation = validateLocation(data, false);
        if (!validation.success) {
            return failure(validation.message);
        }

        var name = String(data.name).trim();

        // ---- PHASE 2: CHECK DUPLICATES (read-only) ----
        var store = getLocationStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var existing = store.locations.find(function(l) {
            return l && normaliseLocationName(l.name) === normaliseLocationName(name);
        });

        if (existing) {
            return failure('A location with this name already exists.');
        }

        // ---- PHASE 3: BUILD LOCATION ----
        var capacity = null;
        if (data.capacity !== undefined && data.capacity !== null && data.capacity !== '') {
            capacity = Number(data.capacity);
        }

        var newLocation = {
            id: generateId('loc'),
            name: name,
            type: data.type || 'indoor',
            capacity: capacity,
            description: data.description || '',
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 4: PRE-CLONE RESULT (safe, before commit) ----
        var resultLocation = deepClone(newLocation);
        if (resultLocation === null) {
            return failure('Failed to prepare location data.');
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(store.locations);
        if (candidate === null) {
            return failure('Failed to prepare location data.');
        }

        candidate.push(newLocation);

        // ---- PHASE 6: COMMIT ----
        store.locations = candidate;

        logActivity('Created location: ' + newLocation.name);
        return {
            success: true,
            location: resultLocation
        };
    }

    function updateLocation(id, data) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        // ---- PHASE 2: VALIDATE UPDATES ----
        var validation = validateLocation(data, true);
        if (!validation.success) {
            return failure(validation.message);
        }

        // ---- PHASE 3: RETRIEVE (read-only) ----
        var store = getLocationStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var index = store.locations.findIndex(function(l) {
            return l && String(l.id) === String(id);
        });

        if (index === -1) {
            return failure('Location not found.');
        }

        var location = store.locations[index];

        // ---- PHASE 4: BUILD CANDIDATE ----
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

            candidate.name = newName;
            hasChanges = true;
        }

        if (data.type !== undefined) {
            candidate.type = data.type;
            hasChanges = true;
        }

        if (data.capacity !== undefined) {
            if (data.capacity !== null && data.capacity !== '') {
                candidate.capacity = Number(data.capacity);
            } else {
                candidate.capacity = null;
            }
            hasChanges = true;
        }

        if (data.description !== undefined) {
            candidate.description = data.description || '';
            hasChanges = true;
        }

        // If no changes, return early
        if (!hasChanges) {
            return successWithLocation(location);
        }

        // ---- PHASE 5: PRE-CLONE RESULT (safe, before commit) ----
        var resultLocation = deepClone(candidate);
        if (resultLocation === null) {
            return failure('Failed to prepare location data.');
        }

        // ---- PHASE 6: BUILD FULL CANDIDATE ARRAY ----
        var candidateArray = deepClone(store.locations);
        if (candidateArray === null) {
            return failure('Failed to prepare location data.');
        }

        candidateArray[index] = candidate;

        // ---- PHASE 7: COMMIT ----
        store.locations = candidateArray;

        logActivity('Updated location: ' + candidate.name);
        return {
            success: true,
            location: resultLocation
        };
    }

    function deleteLocation(id) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        // ---- PHASE 2: RETRIEVE AND VALIDATE STRUCTURE (read-only) ----
        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!Array.isArray(store.locations)) {
            return failure('No locations found.');
        }

        var index = store.locations.findIndex(function(l) {
            return l && String(l.id) === String(id);
        });

        if (index === -1) {
            return failure('Location not found.');
        }

        var location = store.locations[index];
        var name = location.name;

        // Calculate usage count before deletion (read-only)
        var usageCount = getLocationUsage(id);

        // ---- PHASE 3: BUILD CANDIDATES (NO LIVE MUTATION) ----
        var candidateLocations = deepClone(store.locations);
        if (candidateLocations === null) {
            return failure('Failed to prepare location data.');
        }

        // Handle schedules: missing = empty, malformed = corruption
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

        // ---- PHASE 4: CLEAN SCHEDULES IN CANDIDATE ----
        var prefix = id + '_';
        for (var key in candidateSchedules) {
            if (!Object.prototype.hasOwnProperty.call(candidateSchedules, key)) continue;
            if (key.indexOf(prefix) === 0) {
                delete candidateSchedules[key];
            }
        }

        // ---- PHASE 5: REMOVE LOCATION FROM CANDIDATE ----
        candidateLocations.splice(index, 1);

        // ---- PHASE 6: COMMIT ALL CANDIDATES ----
        store.locations = candidateLocations;
        store.locationSchedules = candidateSchedules;

        logActivity('Deleted location: ' + name + ' (' + usageCount + ' schedule entries removed)');
        return successWithDeletion(usageCount);
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
    // VALIDATION HELPERS
    // ============================================================

    function isValidLocationName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Location name is required.');
        }

        var trimmed = String(name).trim();

        var data = getLocationStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var existing = data.locations.find(function(l) {
            return l &&
                String(l.id) !== String(excludeId) &&
                normaliseLocationName(l.name) === normaliseLocationName(trimmed);
        });

        if (existing) {
            return failure('A location with this name already exists.');
        }

        return success(null);
    }

    function locationExists(id) {
        return getLocation(id) !== null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.LocationCore = {
        // CRUD
        getLocation: getLocation,
        getLocations: getLocations,
        getLocationsByType: getLocationsByType,
        getLocationByName: getLocationByName,
        getLocationOptions: getLocationOptions,
        createLocation: createLocation,
        updateLocation: updateLocation,
        deleteLocation: deleteLocation,

        // Usage
        getLocationUsage: getLocationUsage,
        getLocationUsageByWeek: getLocationUsageByWeek,
        getLocationCapacity: getLocationCapacity,
        isLocationAvailable: isLocationAvailable,

        // Type helpers
        getLocationTypeLabel: getLocationTypeLabel,
        getLocationTypeColor: getLocationTypeColor,
        getLocationTypeIcon: getLocationTypeIcon,
        getLocationTypes: getLocationTypes,

        // Validation
        isValidLocationType: isValidLocationType,
        isValidCapacity: isValidCapacity,
        validateLocation: validateLocation,
        isValidLocationName: isValidLocationName,
        locationExists: locationExists,

        // Constants
        VALID_LOCATION_TYPES: VALID_LOCATION_TYPES
    };

})();
