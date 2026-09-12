/**
 * modules/academy/academy-locations.js - Academy Locations
 * SINGLE SOURCE OF TRUTH for all location data and operations
 *
 * This module is responsible for:
 *   - Location CRUD operations (create, update, delete)
 *   - Location queries (get by ID, get all, get by type)
 *   - Location validation
 *   - Location capacity management
 *
 * IMPORTANT:
 *   - This module OWNS location data - it does NOT depend on AcademyQueries
 *   - All MUTATIONS go through MutationPipeline (persistence, rollback, logging)
 *   - All READS are synchronous and side-effect free
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false })
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored
 *   - This module does NOT call saveData() directly - the pipeline does
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 *
 * CASCADE SEMANTICS (deleteLocation):
 *   Deleting a location is a CASCADE. In a single transaction it:
 *     1. Deletes the location from window.data.locations.
 *     2. Removes curriculum.locationSchedules[locationId] entirely.
 *     3. Removes location references from curriculum.classLocations.
 *     4. Prunes metadata entries prefixed with the location ID.
 *   Rationale: after deletion, any surviving reference would be
 *   unreachable data. Cleaning in the same transaction avoids both
 *   orphaned references and partial-cascade states.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / saveLocations all return
 *     Promise<{ success, data?, message? }>
 *   - getLocation / getLocations / getLocationsByType / getLocationName /
 *     hasCapacity / getLocationCapacity stay synchronous
 *
 * STORAGE:
 *   - Locations live at window.data.locations (top-level array).
 *   - Location schedules live at curriculum.locationSchedules.
 *   - Class→location mappings live at curriculum.classLocations.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *
 * USAGE:
 *   var locations = window.AcademyLocations;
 *
 *   locations.create({ name: 'Training Hall A', type: 'classroom', capacity: 30 })
 *       .then(function(result) { ... });
 *
 *   locations.delete('loc_123').then(function(result) {
 *       // result.data.cascade contains the cascade summary
 *   });
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

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
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
    var MutationPipeline = window.MutationPipeline;

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

    function ensureLocationStore(appData) {
        if (!Array.isArray(appData.locations)) {
            appData.locations = [];
        }
        return appData.locations;
    }

    // ============================================================
    // INTERNAL LOCATION LOOKUP - PRIVATE
    // ============================================================

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

        if (!isPartial || data.name !== undefined) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name is required.' };
            }
        }

        if (data.type !== undefined) {
            if (VALID_LOCATION_TYPES.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid type. Must be one of: ' + VALID_LOCATION_TYPES.join(', ') };
            }
        }

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
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    function buildLocationRecord(data, existingId, existingCreatedAt) {
        var now = new Date().toISOString();

        var capacity = data.capacity !== undefined && data.capacity !== null && data.capacity !== ''
            ? Number(data.capacity)
            : null;

        return {
            id: existingId || generateId(),
            name: String(data.name).trim(),
            type: data.type || DEFAULT_TYPE,
            capacity: capacity,
            createdAt: existingCreatedAt || now,
            updatedAt: now
        };
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a location ID
    // ============================================================

    /**
     * Remove curriculum.locationSchedules[locationId] entirely.
     * All weeks, all slots — the location is gone, so its schedule is
     * unreachable.
     *
     * Returns 1 if a schedule existed and was removed, 0 otherwise.
     */
    function stripLocationSchedules(curriculum, locationId) {
        var schedules = curriculum.locationSchedules;
        if (!schedules || typeof schedules !== 'object') {
            return 0;
        }

        var target = String(locationId);
        if (schedules[target]) {
            delete schedules[target];
            return 1;
        }
        return 0;
    }

    /**
     * Remove references to a location from curriculum.classLocations.
     *
     * Shape: { classId: locationId }. We filter values that match
     * the deleted location. A class whose assigned location is deleted
     * becomes unassigned.
     *
     * Returns the number of class→location mappings removed.
     */
    function stripLocationFromClassLocations(curriculum, locationId) {
        var classLocations = curriculum.classLocations;
        if (!classLocations || typeof classLocations !== 'object') {
            return 0;
        }

        var target = String(locationId);
        var keysToRemove = [];

        Object.keys(classLocations).forEach(function(classId) {
            if (String(classLocations[classId]) === target) {
                keysToRemove.push(classId);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete classLocations[keysToRemove[i]];
        }

        return keysToRemove.length;
    }

    /**
     * Prune metadata entries whose first segment matches the deleted
     * location ID.
     *
     * Metadata keys are composite strings formatted as
     * `${entityId}_${week}_${day}_${hour}`. For locations, the entity
     * is the location ID itself.
     *
     * The parser splits on `_` and reconstructs the entity ID as
     * everything before the final three segments (week, day, hour).
     * That handles location IDs that themselves contain underscores.
     *
     * Returns the number of metadata entries pruned.
     */
    function stripLocationFromMetadata(curriculum, locationId) {
        var metadata = curriculum.metadata;
        if (!metadata || typeof metadata !== 'object') {
            return 0;
        }

        var target = String(locationId);
        var keysToRemove = [];

        Object.keys(metadata).forEach(function(key) {
            var parts = String(key).split('_');
            if (parts.length < 4) {
                // Not a composite key we recognise; leave it alone.
                return;
            }

            var entityId = parts.slice(0, parts.length - 3).join('_');
            if (entityId === target) {
                keysToRemove.push(key);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete metadata[keysToRemove[i]];
        }

        return keysToRemove.length;
    }

    // ============================================================
    // PUBLIC API - LOCATION CRUD (Promise-based)
    // ============================================================

    /**
     * Create a new location.
     *
     * @param {object} data - Location data
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function create(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var validation = validateLocationData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        // ---- PHASE 2: CHECK FOR DUPLICATE NAME (pre-flight) ----
        var existing = getLocationByNameRecord(data.name);
        if (existing) {
            return Promise.resolve(failure('A location with this name already exists.'));
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var newLocation = buildLocationRecord(data, null, null);
        var targetId = newLocation.id;

        // ---- PHASE 4: PIPELINE MUTATION ----
        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                if (Array.isArray(appData.locations)) {
                    var nameLower = newLocation.name.toLowerCase();
                    for (var i = 0; i < appData.locations.length; i++) {
                        var loc = appData.locations[i];
                        if (loc && loc.name && String(loc.name).toLowerCase() === nameLower) {
                            return { valid: false, message: 'A location with this name already exists.' };
                        }
                    }
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var locations = ensureLocationStore(appData);
                locations.push(deepClone(newLocation));
                return { location: newLocation, id: targetId };
            },
            logMessage: 'Created location: ' + newLocation.name,
            successMessage: 'Location created successfully!',
            failureMessage: 'Failed to create location.'
        });
    }

    /**
     * Update an existing location.
     *
     * @param {string} id - Location ID
     * @param {object} updates - Updates to apply
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function update(id, updates) {
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Location ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var existing = getLocationRecord(id);
        if (!existing) {
            return Promise.resolve(failure('Location not found.'));
        }

        // ---- VALIDATE UPDATES ----
        var validation = validateLocationData(updates, true);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        // ---- BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone location data.'));
        }

        var hasChanges = false;

        // Name update
        if (updates.name !== undefined) {
            var newName = String(updates.name).trim();
            if (!newName) {
                return Promise.resolve(failure('Location name cannot be empty.'));
            }
            if (newName !== candidate.name) {
                var duplicate = getLocationByNameRecord(newName);
                if (duplicate && String(duplicate.id) !== String(id)) {
                    return Promise.resolve(failure('A location with this name already exists.'));
                }
                candidate.name = newName;
                hasChanges = true;
            }
        }

        // Type update
        if (updates.type !== undefined) {
            if (VALID_LOCATION_TYPES.indexOf(updates.type) === -1) {
                return Promise.resolve(failure('Invalid type. Must be one of: ' + VALID_LOCATION_TYPES.join(', ')));
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
                return Promise.resolve(failure('Capacity must be between ' + MIN_CAPACITY + ' and ' + MAX_CAPACITY + '.'));
            }

            if (candidate.capacity !== newCapacity) {
                candidate.capacity = newCapacity;
                hasChanges = true;
            }
        }

        if (!hasChanges) {
            return Promise.resolve(success({ location: existing, changed: false }));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(id);

        return MutationPipeline.performMutation({
            validate: function() {
                if (!getLocationRecord(targetId)) {
                    return { valid: false, message: 'Location no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var locations = ensureLocationStore(appData);
                var idx = -1;
                for (var i = 0; i < locations.length; i++) {
                    if (String(locations[i].id) === targetId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Location not found in data store.');
                }
                locations[idx] = deepClone(candidate);
                return { location: candidate, changed: true };
            },
            logMessage: 'Updated location: ' + candidate.name,
            successMessage: 'Location updated successfully!',
            failureMessage: 'Failed to update location.'
        });
    }

    /**
     * Delete a location permanently.
     *
     * CASCADE: removes all references to the location in one transaction.
     * See the CASCADE SEMANTICS block at the top of this file.
     *
     * @param {string} id - Location ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function deleteLocation(id) {
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Location ID is required.'));
        }

        var target = String(id);
        var existing = getLocationRecord(target);
        if (!existing) {
            return Promise.resolve(failure('Location not found.'));
        }

        var locationInfo = {
            id: target,
            name: existing.name
        };

        return MutationPipeline.performMutation({
            validate: function() {
                if (!getLocationRecord(target)) {
                    return { valid: false, message: 'Location no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                // ---- 1. Delete the location entity ----
                var locations = ensureLocationStore(appData);
                var idx = -1;
                for (var i = 0; i < locations.length; i++) {
                    if (String(locations[i].id) === target) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Location not found in data store.');
                }
                locations.splice(idx, 1);

                // ---- 2. Ensure curriculum structure exists for cascade ----
                if (!appData.curriculum || typeof appData.curriculum !== 'object') {
                    appData.curriculum = {};
                }
                var curriculum = appData.curriculum;

                // ---- 3. Cascade: remove the location's schedule ----
                var scheduleRemoved = stripLocationSchedules(curriculum, target);

                // ---- 4. Cascade: strip location from classLocations ----
                var classLocationsRemoved = stripLocationFromClassLocations(curriculum, target);

                // ---- 5. Cascade: prune metadata for this location ----
                var metadataPruned = stripLocationFromMetadata(curriculum, target);

                return {
                    deleted: true,
                    location: locationInfo,
                    cascade: {
                        scheduleRemoved: scheduleRemoved,
                        classLocationsRemoved: classLocationsRemoved,
                        metadataEntriesPruned: metadataPruned
                    }
                };
            },
            logMessage: function(result) {
                var c = result.cascade;
                var extra = [];
                if (c.scheduleRemoved > 0) extra.push('schedule');
                if (c.classLocationsRemoved > 0) extra.push(c.classLocationsRemoved + ' class mapping(s)');
                if (c.metadataEntriesPruned > 0) extra.push(c.metadataEntriesPruned + ' metadata entry/ies');
                var suffix = extra.length > 0 ? ' (' + extra.join(', ') + ')' : '';
                return 'Deleted location: ' + existing.name + suffix;
            },
            successMessage: 'Location deleted successfully!',
            failureMessage: 'Failed to delete location.'
        });
    }

    // ============================================================
    // QUERY FUNCTIONS - Read-only (synchronous)
    // ============================================================

    function getLocation(id) {
        var record = getLocationRecord(id);
        return record ? deepClone(record) : null;
    }

    function getLocations() {
        var records = getLocationRecords();
        return records.map(function(r) {
            return deepClone(r);
        });
    }

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

    function getLocationName(id) {
        var loc = getLocationRecord(id);
        return loc ? loc.name : 'Unknown';
    }

    function hasCapacity(id) {
        var loc = getLocationRecord(id);
        return loc ? loc.capacity !== null && loc.capacity > 0 : false;
    }

    function getLocationCapacity(id) {
        var loc = getLocationRecord(id);
        return loc ? loc.capacity : null;
    }

    // ============================================================
    // BULK OPERATIONS - Via MutationPipeline
    // ============================================================

    /**
     * Save multiple locations at once.
     *
     * PLAN / APPLY: validate each entry, decide create/update/skip,
     * apply all writes in a single transaction.
     *
     * @param {array} locationsData - Array of location data objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing locations (default: true)
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function saveLocations(locationsData, options) {
        if (!Array.isArray(locationsData) || locationsData.length === 0) {
            return Promise.resolve(failure('Location data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        // ---- PLAN ----
        var planned = [];
        var errors = [];

        for (var i = 0; i < locationsData.length; i++) {
            var data = locationsData[i];
            if (!isObject(data)) {
                errors.push({ index: i, error: 'Invalid location data.' });
                continue;
            }

            if (!isNonEmptyString(data.name)) {
                errors.push({ index: i, error: 'Missing required field: name' });
                continue;
            }

            var validation = validateLocationData(data, false);
            if (!validation.valid) {
                errors.push({ index: i, error: validation.message });
                continue;
            }

            var existing = getLocationByNameRecord(data.name);

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = buildLocationRecord(data, existing.id, existing.createdAt);
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord = buildLocationRecord(data, null, null);
                planned.push({ action: 'create', record: newRecord });
            }
        }

        var creates = planned.filter(function(p) { return p.action === 'create'; });
        var updates = planned.filter(function(p) { return p.action === 'update'; });
        var skipped = planned.filter(function(p) { return p.action === 'skip'; }).length;

        if (creates.length === 0 && updates.length === 0) {
            return Promise.resolve(success({
                total: locationsData.length,
                created: 0,
                updated: 0,
                skipped: skipped,
                errors: errors,
                successCount: 0
            }));
        }

        // ---- APPLY ----
        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var locations = ensureLocationStore(appData);
                var created = 0;
                var updated = 0;

                for (var k = 0; k < planned.length; k++) {
                    var item = planned[k];

                    if (item.action === 'create') {
                        var nameLower = item.record.name.toLowerCase();
                        var collision = false;
                        for (var c = 0; c < locations.length; c++) {
                            if (locations[c].name &&
                                String(locations[c].name).toLowerCase() === nameLower) {
                                collision = true;
                                break;
                            }
                        }
                        if (collision) {
                            throw new Error('Location already exists: ' + item.record.name);
                        }
                        locations.push(deepClone(item.record));
                        created++;

                    } else if (item.action === 'update') {
                        var idx = -1;
                        for (var u = 0; u < locations.length; u++) {
                            if (String(locations[u].id) === String(item.matchId)) {
                                idx = u;
                                break;
                            }
                        }
                        if (idx === -1) {
                            throw new Error('Location no longer exists: ' + item.matchId);
                        }
                        locations[idx] = deepClone(item.record);
                        updated++;
                    }
                }

                return {
                    total: locationsData.length,
                    created: created,
                    updated: updated,
                    skipped: skipped,
                    errors: errors,
                    successCount: created + updated
                };
            },
            logMessage: 'Saved ' + (creates.length + updates.length) + ' location(s)',
            successMessage: 'Locations saved successfully!',
            failureMessage: 'Failed to save locations.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyLocations = {
        // ---- Mutations (Promise-based) ----
        create: create,
        update: update,
        delete: deleteLocation,
        saveLocations: saveLocations,

        // ---- Queries (synchronous) ----
        getLocation: getLocation,
        getLocations: getLocations,
        getLocationsByType: getLocationsByType,
        getLocationName: getLocationName,
        hasCapacity: hasCapacity,
        getLocationCapacity: getLocationCapacity,

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