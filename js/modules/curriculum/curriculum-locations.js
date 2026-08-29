/**
 * js/core/curriculum/curriculum-locations.js - Location CRUD Operations
 * Path: js/core/curriculum/curriculum-locations.js
 * 
 * This module provides location CRUD operations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Location names must be unique (case-insensitive, trimmed)
 *   - Capacity: null = unlimited, 0 = zero capacity, N = capacity N
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
        } else {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name is required.' };
            }
            if (!isValidCapacity(data.capacity)) {
                return { valid: false, message: 'Capacity must be a whole number of 0 or greater.' };
            }
        }

        return { valid: true };
    }

    function getLocationStore() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return null;
        }
        return data;
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function successWithLocation(location) {
        var cloned = deepClone(location);
        if (cloned === null) {
            return failure('Failed to clone location data.');
        }
        return { success: true, location: cloned };
    }

    function successWithDeletion(usageCount) {
        return {
            success: true,
            usageCount: usageCount || 0,
            hadUsage: usageCount > 0
        };
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
        var location = data.locations.find(function(l) {
            return l && String(l.id) === String(id);
        });
        return location ? deepClone(location) : null;
    }

    function getLocations() {
        var data = getLocationStore();
        if (!data) {
            return [];
        }
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
        var data = getLocationStore();
        if (!data) {
            return null;
        }
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
            if (!loc || typeof loc !== 'object' || !isNonEmptyString(loc.name)) {
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

    function getLocationCapacity(locationId) {
        var location = getLocation(locationId);
        if (!location) {
            return null;
        }
        return location.capacity !== undefined && location.capacity !== null && location.capacity !== ''
            ? Number(location.capacity)
            : null;
    }

    // ============================================================
    // LOCATION CRUD MUTATIONS
    // ============================================================

    function createLocation(data) {
        var validation = validateLocation(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var name = String(data.name).trim();
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

        var resultLocation = deepClone(newLocation);
        if (resultLocation === null) {
            return failure('Failed to prepare location data.');
        }

        var candidate = deepClone(store.locations);
        if (candidate === null) {
            return failure('Failed to prepare location data.');
        }

        candidate.push(newLocation);
        store.locations = candidate;

        logActivity('Created location: ' + newLocation.name);
        return { success: true, location: resultLocation };
    }

    function updateLocation(id, data) {
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        var validation = validateLocation(data, true);
        if (!validation.valid) {
            return failure(validation.message);
        }

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

        if (!hasChanges) {
            return successWithLocation(location);
        }

        var resultLocation = deepClone(candidate);
        if (resultLocation === null) {
            return failure('Failed to prepare location data.');
        }

        var candidateArray = deepClone(store.locations);
        if (candidateArray === null) {
            return failure('Failed to prepare location data.');
        }

        candidateArray[index] = candidate;
        store.locations = candidateArray;

        logActivity('Updated location: ' + candidate.name);
        return { success: true, location: resultLocation };
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

        var index = store.locations.findIndex(function(l) {
            return l && String(l.id) === String(id);
        });

        if (index === -1) {
            return failure('Location not found.');
        }

        var location = store.locations[index];
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
    // EXPOSE
    // ============================================================

    // Queries
    window.getLocation = getLocation;
    window.getLocations = getLocations;
    window.getLocationsByType = getLocationsByType;
    window.getLocationByName = getLocationByName;
    window.getLocationOptions = getLocationOptions;
    window.getLocationUsage = getLocationUsage;
    window.locationExists = locationExists;
    window.getLocationCapacity = getLocationCapacity;

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
