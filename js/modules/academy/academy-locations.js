/**
 * modules/academy/academy-locations.js - Academy Locations
 * SINGLE SOURCE OF TRUTH for all location data and operations
 * 
 * This module is responsible for:
 *   - Location CRUD operations (create, update, delete)
 *   - Location queries (get by ID, get all)
 *   - Location validation
 *   - Location capacity management
 * 
 * IMPORTANT:
 *   - This module OWNS location data - it does NOT depend on AcademyQueries
 *   - All mutations are candidate-based: VALIDATE → CLONE → MODIFY → COMMIT
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var locations = window.AcademyLocations;
 *   
 *   // Create a location
 *   var result = locations.create({
 *     name: 'Training Hall A',
 *     type: 'classroom',
 *     capacity: 30
 *   });
 *   
 *   // Update a location
 *   var result = locations.update('loc_123', { capacity: 40 });
 *   
 *   // Delete a location
 *   var result = locations.delete('loc_123');
 *   
 *   // Get a location
 *   var location = locations.getLocation('loc_123');
 *   var all = locations.getLocations();
 */

(function() {
    'use strict';

    if (window.__academyLocationsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }

    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyLocations] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyLocationsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_LOCATION_TYPES = [
        'classroom',
        'lab',
        'gym',
        'field',
        'hall',
        'auditorium',
        'library',
        'office',
        'other'
    ];

    var DEFAULT_TYPE = 'other';

    var MIN_CAPACITY = 1;
    var MAX_CAPACITY = 1000;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateId() {
        return IdUtils.generateId('loc');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function ensureLocationStructures() {
        var data = getDataStore();
        if (!data) {
            return null;
        }

        if (!data.locations || typeof data.locations !== 'object') {
            data.locations = [];
        }

        return data;
    }

    // ============================================================
    // INTERNAL LOCATION LOOKUP - PRIVATE
    // ============================================================

    /**
     * Get a location record by ID (internal).
     * 
     * @param {string} id - Location ID
     * @returns {object|null} Location object or null
     */
    function getLocationRecord(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return null;
        }

        var target = String(id);
        for (var i = 0; i < data.locations.length; i++) {
            var loc = data.locations[i];
            if (loc && String(loc.id) === target) {
                return loc;
            }
        }

        return null;
    }

    /**
     * Get all location records (internal).
     * 
     * @returns {array} Array of location objects
     */
    function getLocationRecords() {
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < data.locations.length; i++) {
            var loc = data.locations[i];
            if (loc) {
                result.push(loc);
            }
        }

        return result;
    }

    /**
     * Get location by name (internal, case-insensitive).
     * 
     * @param {string} name - Location name
     * @returns {object|null} Location object or null
     */
    function getLocationByNameRecord(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var target = String(name).toLowerCase().trim();
        var locations = getLocationRecords();

        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            if (loc && loc.name && String(loc.name).toLowerCase().trim() === target) {
                return loc;
            }
        }

        return null;
    }

    // ============================================================
    // LOCATION VALIDATION
    // ============================================================

    function validateLocationData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Location data must be an object.' };
        }

        // Name - required for full creation
        if (!isPartial || data.name !== undefined) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name is required.' };
            }
        }

        // Type - optional, with default
        if (data.type !== undefined) {
            if (VALID_LOCATION_TYPES.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid type. Must be one of: ' + VALID_LOCATION_TYPES.join(', ') };
            }
        }

        // Capacity - optional
        if (data.capacity !== undefined) {
            if (data.capacity !== null && data.capacity !== '') {
                var capacity = Number(data.capacity);
                if (isNaN(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
                    return { valid: false, message: 'Capacity must be between ' + MIN_CAPACITY + ' and ' + MAX_CAPACITY + '.' };
                }
            }
        }

        return { valid: true };
    }

    // ============================================================
    // PUBLIC API - LOCATION CRUD
    // ============================================================

    /**
     * Create a new location.
     * Candidate-based: validates, creates, commits.
     * 
     * @param {object} data - Location data
     * @param {string} data.name - Location name
     * @param {string} data.type - Location type (default: 'other')
     * @param {number} data.capacity - Maximum capacity (optional)
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function create(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var validation = validateLocationData(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 2: GET STORE ----
        var store = ensureLocationStructures();
        if (!store) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 3: CHECK FOR DUPLICATE NAME ----
        var existing = getLocationByNameRecord(data.name);
        if (existing) {
            return failure('A location with this name already exists.');
        }

        // ---- PHASE 4: BUILD LOCATION OBJECT ----
        var now = new Date().toISOString();
        var locationId = generateId();

        var capacity = data.capacity !== undefined && data.capacity !== null && data.capacity !== ''
            ? Number(data.capacity)
            : null;

        var newLocation = {
            id: locationId,
            name: String(data.name).trim(),
            type: data.type || DEFAULT_TYPE,
            capacity: capacity,
            createdAt: now,
            updatedAt: now
        };

        // ---- PHASE 5: COMMIT ----
        store.locations.push(newLocation);

        return success({
            location: newLocation
        });
    }

    /**
     * Update an existing location.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} id - Location ID
     * @param {object} updates - Updates to apply
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function update(id, updates) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return failure('Updates are required.');
        }

        // ---- PHASE 2: GET STORE ----
        var store = ensureLocationStructures();
        if (!store) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(id);
        var existing = null;
        var existingIndex = -1;

        for (var i = 0; i < store.locations.length; i++) {
            if (String(store.locations[i].id) === target) {
                existing = store.locations[i];
                existingIndex = i;
                break;
            }
        }

        if (!existing) {
            return failure('Location not found.');
        }

        // ---- PHASE 4: VALIDATE UPDATES ----
        var validation = validateLocationData(updates, true);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone location data.');
        }

        var hasChanges = false;

        // Name update
        if (updates.name !== undefined) {
            var newName = String(updates.name).trim();
            if (!newName) {
                return failure('Location name cannot be empty.');
            }
            if (newName !== candidate.name) {
                // Check for duplicate name
                var duplicate = getLocationByNameRecord(newName);
                if (duplicate && String(duplicate.id) !== target) {
                    return failure('A location with this name already exists.');
                }
                candidate.name = newName;
                hasChanges = true;
            }
        }

        // Type update
        if (updates.type !== undefined) {
            if (VALID_LOCATION_TYPES.indexOf(updates.type) === -1) {
                return failure('Invalid type. Must be one of: ' + VALID_LOCATION_TYPES.join(', ') );
            }
            if (candidate.type !== updates.type) {
                candidate.type = updates.type;
                hasChanges = true;
            }
        }

        // Capacity update
        if (updates.capacity !== undefined) {
            var newCapacity = updates.capacity !== null && updates.capacity !== ''
                ? Number(updates.capacity)
                : null;

            if (newCapacity !== null && (isNaN(newCapacity) || newCapacity < MIN_CAPACITY || newCapacity > MAX_CAPACITY)) {
                return failure('Capacity must be between ' + MIN_CAPACITY + ' and ' + MAX_CAPACITY + '.');
            }

            if (candidate.capacity !== newCapacity) {
                candidate.capacity = newCapacity;
                hasChanges = true;
            }
        }

        if (!hasChanges) {
            return success({ location: existing, changed: false });
        }

        // ---- PHASE 6: COMMIT ----
        candidate.updatedAt = new Date().toISOString();
        store.locations[existingIndex] = candidate;

        return success({
            location: candidate,
            changed: true
        });
    }

    /**
     * Delete a location permanently.
     * 
     * @param {string} id - Location ID
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function deleteLocation(id) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(id)) {
            return failure('Location ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var store = ensureLocationStructures();
        if (!store) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(id);
        var foundIndex = -1;
        var existing = null;

        for (var i = 0; i < store.locations.length; i++) {
            if (String(store.locations[i].id) === target) {
                foundIndex = i;
                existing = store.locations[i];
                break;
            }
        }

        if (!existing) {
            return failure('Location not found.');
        }

        var locationInfo = {
            id: target,
            name: existing.name
        };

        // ---- PHASE 4: REMOVE ----
        store.locations.splice(foundIndex, 1);

        return success({
            deleted: true,
            location: locationInfo
        });
    }

    // ============================================================
    // QUERY FUNCTIONS - Read-only (internal)
    // ============================================================

    /**
     * Get a location by ID (defensive copy).
     * 
     * @param {string} id - Location ID
     * @returns {object|null} Location object or null
     */
    function getLocation(id) {
        var record = getLocationRecord(id);
        return record ? deepClone(record) : null;
    }

    /**
     * Get all locations (defensive copies).
     * 
     * @returns {array} Array of location objects
     */
    function getLocations() {
        var records = getLocationRecords();
        return records.map(function(r) {
            return deepClone(r);
        });
    }

    /**
     * Get locations by type.
     * 
     * @param {string} type - Location type
     * @returns {array} Array of location objects
     */
    function getLocationsByType(type) {
        if (VALID_LOCATION_TYPES.indexOf(type) === -1) {
            return [];
        }

        var all = getLocationRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            if (all[i].type === type) {
                result.push(deepClone(all[i]));
            }
        }

        return result;
    }

    /**
     * Get location name by ID.
     * 
     * @param {string} id - Location ID
     * @returns {string} Location name or 'Unknown'
     */
    function getLocationName(id) {
        var loc = getLocationRecord(id);
        return loc ? loc.name : 'Unknown';
    }

    /**
     * Check if a location has capacity.
     * 
     * @param {string} id - Location ID
     * @returns {boolean} True if location has capacity defined
     */
    function hasCapacity(id) {
        var loc = getLocationRecord(id);
        return loc ? loc.capacity !== null && loc.capacity > 0 : false;
    }

    /**
     * Get location capacity.
     * 
     * @param {string} id - Location ID
     * @returns {number|null} Capacity or null
     */
    function getLocationCapacity(id) {
        var loc = getLocationRecord(id);
        return loc ? loc.capacity : null;
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    /**
     * Save multiple locations at once.
     * 
     * @param {array} locationsData - Array of location data objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing locations
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function saveLocations(locationsData, options) {
        if (!Array.isArray(locationsData) || locationsData.length === 0) {
            return failure('Location data array is required.');
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var created = 0;
        var updated = 0;
        var skipped = 0;
        var errors = [];

        for (var i = 0; i < locationsData.length; i++) {
            var data = locationsData[i];
            if (!isObject(data)) {
                errors.push({
                    index: i,
                    error: 'Invalid location data.'
                });
                continue;
            }

            // Validate required fields
            if (!data.name) {
                errors.push({
                    index: i,
                    error: 'Missing required field: name'
                });
                continue;
            }

            // Check if location already exists by name
            var existing = getLocationByNameRecord(data.name);

            if (existing && !overwrite) {
                skipped++;
                continue;
            }

            if (existing) {
                // Update existing
                var updateResult = update(existing.id, data);
                if (updateResult.success) {
                    updated++;
                } else {
                    errors.push({
                        index: i,
                        error: updateResult.message
                    });
                }
            } else {
                // Create new
                var createResult = create(data);
                if (createResult.success) {
                    created++;
                } else {
                    errors.push({
                        index: i,
                        error: createResult.message
                    });
                }
            }
        }

        return success({
            total: locationsData.length,
            created: created,
            updated: updated,
            skipped: skipped,
            errors: errors,
            successCount: created + updated
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyLocations = {
        // ---- CRUD ----
        create: create,
        update: update,
        delete: deleteLocation,

        // ---- Queries ----
        getLocation: getLocation,
        getLocations: getLocations,
        getLocationsByType: getLocationsByType,
        getLocationName: getLocationName,
        hasCapacity: hasCapacity,
        getLocationCapacity: getLocationCapacity,

        // ---- Bulk ----
        saveLocations: saveLocations,

        // ---- Internal (for AcademyQueries) ----
        getLocationRecord: getLocationRecord,
        getLocationRecords: getLocationRecords,
        getLocationByNameRecord: getLocationByNameRecord,

        // ---- Constants ----
        VALID_LOCATION_TYPES: VALID_LOCATION_TYPES,
        DEFAULT_TYPE: DEFAULT_TYPE,
        MIN_CAPACITY: MIN_CAPACITY,
        MAX_CAPACITY: MAX_CAPACITY
    };

})();