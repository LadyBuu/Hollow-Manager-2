/**
 * modules/academy/academy-locations.js - Academy Locations
 * SINGLE SOURCE OF TRUTH for all location data and operations
 *
 * Path: js/modules/academy/academy-locations.js
 *
 * This module is responsible for:
 *   - Location CRUD operations (create, update, delete)
 *   - Location queries (get by ID, get all, get by type)
 *   - Location validation
 *   - Location capacity management
 *
 * IMPORTANT:
 *   - This module OWNS location data - it does NOT depend on AcademyQueries.
 *   - All MUTATIONS go through MutationPipeline.
 *   - All READS are synchronous and side-effect free.
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false }).
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored.
 *   - This module does NOT call saveData() directly - the pipeline does.
 *
 * READ SAFETY (Phase 2):
 *   - getDataStore() returns null when window.data is missing.
 *   - Internal readers never create window.data.locations as a side
 *     effect of a read. Structure creation is confined to
 *     ensureLocationStore, which is only called inside pipeline
 *     mutate() callbacks.
 *   - Public queries return DEEP CLONES.
 *   - Internal accessors return LIVE REFERENCES.
 *   - Pipeline validate() callbacks read from the `appData` argument.
 *   - ObjectUtils.deepClone throws if cloning fails or if the clone
 *     aliases the input.
 *
 * NAME NORMALISATION (Phase 2):
 *   - Location name comparison is centralised in
 *     normaliseLocationName: trim + lowercase. Every name lookup
 *     goes through it.
 *
 * VALID_LOCATION_TYPES (Phase 2):
 *   - The list is deep-frozen at load. Callers cannot mutate the
 *     shared array. getValidLocationTypes() returns a copy.
 *
 * DELETE CASCADE (v21):
 *   Deleting a location is a CASCADE. In a single transaction it:
 *     1. Deletes the location from window.data.locations.
 *     2. Cross-domain cleanup via AcademyCascade.locationDeleted,
 *        which nulls the locationId on every teaching session that
 *        referenced it.
 *
 *   The retired stored-schedule maps (curriculum.locationSchedules,
 *   curriculum.classLocations, curriculum.metadata) are no longer
 *   touched. They were removed in database v21.
 *
 *   Sessions are NOT deleted when their location is deleted. The
 *   room was a property of the session, not its identity. A
 *   decommissioned room does not end the class; the session survives
 *   with locationId set to null.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / saveLocations all return
 *     Promise<{ success, data?, message? }>
 *   - getLocation / getLocations / getLocationsByType / getLocationName /
 *     hasCapacity / getLocationCapacity stay synchronous
 *
 * STORAGE:
 *   - Locations live at window.data.locations (top-level array).
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.AcademyCascade (from academy-cascade.js) - LAZY
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
    // LAZY DEPENDENCIES
    // ============================================================

    function getAcademyCascade() {
        return window.AcademyCascade || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_LOCATION_TYPES = Object.freeze([
        'classroom',
        'lab',
        'gym',
        'field',
        'hall',
        'auditorium',
        'library',
        'office',
        'other'
    ]);

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
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyLocations] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
            );
        }
        return result;
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

    /**
     * Normalise a location name for comparison.
     * Trims leading/trailing whitespace and lowercases. Empty or
     * invalid input returns ''.
     */
    function normaliseLocationName(name) {
        if (name === null || name === undefined) {
            return '';
        }
        return String(name).trim().toLowerCase();
    }

    /**
     * Get the valid location types as a fresh array. Callers that
     * need a mutable list can get one without touching the frozen
     * shared array.
     */
    function getValidLocationTypes() {
        return VALID_LOCATION_TYPES.slice();
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

    /**
     * Ensure the location store exists on the given appData snapshot.
     * Only called from inside pipeline mutate() callbacks.
     */
    function ensureLocationStore(appData) {
        if (!Array.isArray(appData.locations)) {
            appData.locations = [];
        }
        return appData.locations;
    }

    // ============================================================
    // INTERNAL LOCATION LOOKUP - PRIVATE (LIVE REFERENCES)
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
        var target = normaliseLocationName(name);
        if (target === '') {
            return null;
        }

        var locations = getLocationRecords();

        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            if (loc && normaliseLocationName(loc.name) === target) {
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
    // PUBLIC API - LOCATION CRUD
    // ============================================================

    /**
     * Create a new location.
     */
    function create(data) {
        var validation = validateLocationData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var existing = getLocationByNameRecord(data.name);
        if (existing) {
            return Promise.resolve(failure('A location with this name already exists.'));
        }

        var newLocation = buildLocationRecord(data, null, null);
        var targetId = newLocation.id;
        var normalisedNewName = normaliseLocationName(newLocation.name);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                if (Array.isArray(appData.locations)) {
                    for (var i = 0; i < appData.locations.length; i++) {
                        var loc = appData.locations[i];
                        if (loc && normaliseLocationName(loc.name) === normalisedNewName) {
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

        var validation = validateLocationData(updates, true);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

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
            return Promise.resolve(success({ location: deepClone(existing), changed: false }));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(id);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !Array.isArray(appData.locations)) {
                    return { valid: false, message: 'Location no longer exists.' };
                }
                var found = false;
                for (var i = 0; i < appData.locations.length; i++) {
                    if (String(appData.locations[i].id) === targetId) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
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
     * CASCADE (v21). In a single transaction it:
     *   1. Deletes the location from window.data.locations.
     *   2. Delegates to AcademyCascade.locationDeleted, which nulls
     *      the locationId on every teaching session that referenced
     *      it. Sessions are NOT deleted; the class still runs.
     *
     * The retired stored-schedule maps (curriculum.locationSchedules,
     * curriculum.classLocations, curriculum.metadata) are no longer
     * touched. They were removed in database v21.
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
            validate: function(appData) {
                if (!appData || !Array.isArray(appData.locations)) {
                    return { valid: false, message: 'Location no longer exists.' };
                }
                var found = false;
                for (var i = 0; i < appData.locations.length; i++) {
                    if (String(appData.locations[i].id) === target) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
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

                // ---- 2. Cross-domain cascade ----
                // AcademyCascade.locationDeleted nulls the locationId
                // on every teaching session that referenced it.
                var cascade = null;
                var Cascade = getAcademyCascade();
                if (Cascade && typeof Cascade.locationDeleted === 'function') {
                    cascade = Cascade.locationDeleted(appData, target);
                }

                return {
                    deleted: true,
                    location: locationInfo,
                    academyCascade: cascade
                };
            },
            logMessage: function(result) {
                var parts = [];

                if (result.academyCascade) {
                    var Cascade = getAcademyCascade();
                    if (Cascade && typeof Cascade.formatSummary === 'function') {
                        var summary = Cascade.formatSummary(result.academyCascade);
                        if (summary) {
                            parts.push(summary.replace(/^\(|\)$/g, ''));
                        }
                    }
                }

                var suffix = parts.length > 0 ? ' (' + parts.join(', ') + ')' : '';
                return 'Deleted location: ' + existing.name + suffix;
            },
            successMessage: 'Location deleted successfully!',
            failureMessage: 'Failed to delete location.'
        });
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================

    function getLocation(id) {
        var record = getLocationRecord(id);
        return record ? deepClone(record) : null;
    }

    function getLocations() {
        var records = getLocationRecords();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
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

    function saveLocations(locationsData, options) {
        if (!Array.isArray(locationsData) || locationsData.length === 0) {
            return Promise.resolve(failure('Location data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

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
                        var normalisedName = normaliseLocationName(item.record.name);
                        var collision = false;
                        for (var c = 0; c < locations.length; c++) {
                            if (normaliseLocationName(locations[c].name) === normalisedName) {
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
        // ---- Mutations ----
        create: create,
        update: update,
        delete: deleteLocation,
        saveLocations: saveLocations,

        // ---- Public queries ----
        getLocation: getLocation,
        getLocations: getLocations,
        getLocationsByType: getLocationsByType,
        getLocationName: getLocationName,
        hasCapacity: hasCapacity,
        getLocationCapacity: getLocationCapacity,

        // ---- Internal ----
        getLocationRecord: getLocationRecord,
        getLocationRecords: getLocationRecords,
        getLocationByNameRecord: getLocationByNameRecord,

        // ---- Helpers ----
        getValidLocationTypes: getValidLocationTypes,
        normaliseLocationName: normaliseLocationName,

        // ---- Constants ----
        VALID_LOCATION_TYPES: VALID_LOCATION_TYPES,
        DEFAULT_TYPE: DEFAULT_TYPE,
        MIN_CAPACITY: MIN_CAPACITY,
        MAX_CAPACITY: MAX_CAPACITY
    };

})();
