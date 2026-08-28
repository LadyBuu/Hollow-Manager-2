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
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 * 
 * PERSISTENCE CONTRACT:
 *   - Mutations are applied to window.data in memory
 *   - Caller is responsible for saveData() persistence
 *   - No rollback is provided after mutation begins
 * 
 * LOCATION SEMANTICS:
 *   - Locations are stored as: { id, name, type, capacity, description, createdAt }
 *   - Location schedules are stored separately in locationSchedules
 *   - Location usage counts entries in locationSchedules
 *   - Deleting a location cleans up all associated schedules
 *   - Location names must be unique (case-insensitive)
 *   - Capacity is optional (null = unlimited)
 */

(function() {
    'use strict';

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

    function ensureLocationStructure() {
        var data = getDataStore();
        if (!data) return null;

        if (!Array.isArray(data.locations)) {
            data.locations = [];
        }

        if (!data.locationSchedules || typeof data.locationSchedules !== 'object') {
            data.locationSchedules = {};
        }

        return data;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    var VALID_LOCATION_TYPES = [
        'indoor', 'outdoor', 'pool', 'classroom', 'lab', 'field', 'other'
    ];

    function isValidLocationType(type) {
        return type && VALID_LOCATION_TYPES.indexOf(type) !== -1;
    }

    function isValidCapacity(value) {
        if (value === undefined || value === null || value === '') {
            return { valid: true };
        }

        var num = Number(value);
        if (!isSafeInteger(num) || num < 0) {
            return { valid: false, message: 'Capacity must be a whole number of 0 or greater.' };
        }

        return { valid: true };
    }

    function validateLocation(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Location data must be an object.' };
        }

        // Name validation
        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name is required.' };
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name cannot be empty.' };
            }
        }

        // Type validation
        if (!isPartial) {
            if (!isValidLocationType(data.type)) {
                return { valid: false, message: 'Valid location type is required.' };
            }
        } else {
            if (data.type !== undefined && !isValidLocationType(data.type)) {
                return { valid: false, message: 'Invalid location type.' };
            }
        }

        // Capacity validation
        if (!isPartial) {
            var capacityResult = isValidCapacity(data.capacity);
            if (!capacityResult.valid) return capacityResult;
        } else {
            if (data.capacity !== undefined) {
                var capacityResult = isValidCapacity(data.capacity);
                if (!capacityResult.valid) return capacityResult;
            }
        }

        // Description validation (just ensure it's a string)
        if (!isPartial) {
            if (data.description !== undefined && typeof data.description !== 'string') {
                return { valid: false, message: 'Description must be a string.' };
            }
        } else {
            if (data.description !== undefined && typeof data.description !== 'string') {
                return { valid: false, message: 'Description must be a string.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // LOCATION QUERIES
    // ============================================================

    function getLocation(id) {
        if (!isNonEmptyString(id)) return null;

        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return null;
        }

        return data.locations.find(function(l) {
            return l && String(l.id) === String(id);
        }) || null;
    }

    function getLocations() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return [];
        }
        return data.locations.slice();
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

        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return null;
        }

        var target = String(name).toLowerCase();
        return data.locations.find(function(l) {
            return l && String(l.name || '').toLowerCase() === target;
        }) || null;
    }

    function getLocationOptions() {
        var locations = getLocations();
        var options = [];

        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            if (!loc || typeof loc !== 'object') continue;

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

        // Sort by name
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
        if (!data || !data.locationSchedules) {
            return 0;
        }

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
        if (!data || !data.locationSchedules) {
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

        var data = getDataStore();
        if (!data || !data.locationSchedules) return true;

        var key = locationId + '_' + weekNum;
        var weekSchedule = data.locationSchedules[key];

        if (!weekSchedule || !weekSchedule[day] || !weekSchedule[day][hour]) {
            return true;
        }

        return false;
    }

    // ============================================================
    // LOCATION MUTATIONS
    // ============================================================

    function createLocation(data) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateLocation(data, false);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        // ---- PHASE 2: CHECK DUPLICATES ----
        var store = ensureLocationStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var name = String(data.name).trim();
        var existing = store.locations.find(function(l) {
            return l && String(l.name || '').toLowerCase() === name.toLowerCase();
        });

        if (existing) {
            return { success: false, message: 'A location with this name already exists.' };
        }

        // ---- PHASE 3: BUILD LOCATION ----
        var capacity = null;
        if (data.capacity !== undefined && data.capacity !== null && data.capacity !== '') {
            capacity = Number(data.capacity);
        }

        var location = {
            id: generateId('loc'),
            name: name,
            type: data.type || 'indoor',
            capacity: capacity,
            description: data.description || '',
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 4: APPLY ----
        store.locations.push(location);

        logActivity('Created location: ' + location.name);
        return { success: true, location: location };
    }

    function updateLocation(id, data) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Location ID is required.' };
        }

        // ---- PHASE 2: VALIDATE UPDATES ----
        var validation = validateLocation(data, true);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        // ---- PHASE 3: RETRIEVE ----
        var store = getDataStore();
        if (!store || !Array.isArray(store.locations)) {
            return { success: false, message: 'No locations found.' };
        }

        var index = store.locations.findIndex(function(l) {
            return l && String(l.id) === String(id);
        });

        if (index === -1) {
            return { success: false, message: 'Location not found.' };
        }

        var location = store.locations[index];

        // ---- PHASE 4: CHECK DUPLICATES (name change) ----
        if (data.name !== undefined) {
            var newName = String(data.name).trim();
            if (!newName) {
                return { success: false, message: 'Location name cannot be empty.' };
            }

            var existing = store.locations.find(function(l) {
                return l && String(l.id) !== String(id) &&
                       String(l.name || '').toLowerCase() === newName.toLowerCase();
            });

            if (existing) {
                return { success: false, message: 'A location with this name already exists.' };
            }

            location.name = newName;
        }

        // ---- PHASE 5: APPLY UPDATES ----
        if (data.type !== undefined) {
            location.type = data.type;
        }

        if (data.capacity !== undefined) {
            if (data.capacity !== null && data.capacity !== '') {
                location.capacity = Number(data.capacity);
            } else {
                location.capacity = null;
            }
        }

        if (data.description !== undefined) {
            location.description = data.description || '';
        }

        logActivity('Updated location: ' + location.name);
        return { success: true, location: location };
    }

    function deleteLocation(id) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Location ID is required.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var store = getDataStore();
        if (!store || !Array.isArray(store.locations)) {
            return { success: false, message: 'No locations found.' };
        }

        var index = store.locations.findIndex(function(l) {
            return l && String(l.id) === String(id);
        });

        if (index === -1) {
            return { success: false, message: 'Location not found.' };
        }

        var location = store.locations[index];
        var name = location.name;

        // ---- PHASE 3: CHECK USAGE ----
        var usageCount = getLocationUsage(id);
        var hasUsage = usageCount > 0;

        // ---- PHASE 4: CLEAN UP SCHEDULES ----
        if (store.locationSchedules && typeof store.locationSchedules === 'object') {
            var prefix = id + '_';
            for (var key in store.locationSchedules) {
                if (!Object.prototype.hasOwnProperty.call(store.locationSchedules, key)) continue;
                if (key.indexOf(prefix) === 0) {
                    delete store.locationSchedules[key];
                }
            }
        }

        // ---- PHASE 5: DELETE ----
        store.locations.splice(index, 1);

        logActivity('Deleted location: ' + name + (hasUsage ? ' (' + usageCount + ' schedule entries removed)' : ''));

        return {
            success: true,
            usageCount: usageCount,
            hadUsage: hasUsage
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
    // VALIDATION HELPERS
    // ============================================================

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function isValidLocationName(name) {
        if (!isNonEmptyString(name)) {
            return { valid: false, message: 'Location name is required.' };
        }

        var trimmed = String(name).trim();

        // Check for existing location with same name
        var existing = getLocationByName(trimmed);
        if (existing) {
            return { valid: false, message: 'A location with this name already exists.' };
        }

        return { valid: true };
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
