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
 * READ SAFETY:
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
 * NAME UNIQUENESS (the module's strongest invariant):
 *   Two locations may not share a name under normaliseLocationName().
 *   This is enforced:
 *     - on create: preflight and pipeline validator
 *     - on update: preflight and pipeline validator (when name changes)
 *     - on saveLocations bulk: preflight (within-batch duplicates and
 *       existing collisions) and pipeline validator (post-mutation
 *       uniqueness across the whole store)
 *
 *   The pipeline validator is the authoritative check. The preflight
 *   checks exist for better error messages, not for correctness.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the `appData` argument it is handed. It does not read
 *   window.data. Preflight reads against window.data are for early
 *   UX feedback; the pipeline re-checks against the snapshot.
 *
 * CAPACITY:
 *   Capacity is null (unspecified) or an integer in
 *   [MIN_CAPACITY, MAX_CAPACITY]. Fractional capacities are rejected.
 *   A room's capacity is 30, not 30.5.
 *
 * DELETE CASCADE:
 *   Deleting a location is a CASCADE. In a single MutationPipeline
 *   transaction it:
 *     1. Deletes the location from window.data.locations.
 *     2. Cross-domain cleanup via AcademyCascade.locationDeleted,
 *        which nulls the locationId on every teaching session and
 *        every instructor commitment that referenced it.
 *
 *   AcademyCascade.locationDeleted is MANDATORY at deletion time.
 *   Lazy lookup solves load order; it does not make the dependency
 *   optional. A missing cascade fails the transaction.
 *
 *   Sessions and commitments are NOT deleted when their location is
 *   deleted. The room was a property of the record, not its
 *   identity. A decommissioned room does not end the class or the
 *   commitment; the record survives with locationId set to null.
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
     *
     * This is the SINGLE authority for name comparison in this
     * module. Every uniqueness check goes through it. Do not
     * inline `String(x).toLowerCase().trim()` anywhere; use this.
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
    // SNAPSHOT-AWARE LOOKUPS - for pipeline validate() callbacks
    // ============================================================
    //
    // These read from an appData snapshot, not window.data. They
    // are the ones pipeline validators must use.

    function findLocationInSnapshot(appData, id) {
        if (!appData || !Array.isArray(appData.locations)) {
            return null;
        }
        var target = String(id);
        for (var i = 0; i < appData.locations.length; i++) {
            var loc = appData.locations[i];
            if (loc && String(loc.id) === target) {
                return loc;
            }
        }
        return null;
    }

    /**
     * Does any location OTHER than `excludeId` carry the given
     * normalised name in the snapshot?
     *
     * Returns the conflicting record or null.
     */
    function findNameConflictInSnapshot(appData, normalisedName, excludeId) {
        if (!appData || !Array.isArray(appData.locations)) {
            return null;
        }
        if (normalisedName === '') {
            return null;
        }
        var exclude = (excludeId === undefined || excludeId === null)
            ? null
            : String(excludeId);

        for (var i = 0; i < appData.locations.length; i++) {
            var loc = appData.locations[i];
            if (!loc) { continue; }
            if (exclude !== null && String(loc.id) === exclude) {
                continue;
            }
            if (normaliseLocationName(loc.name) === normalisedName) {
                return loc;
            }
        }
        return null;
    }

    // ============================================================
    // LOCATION VALIDATION
    // ============================================================
    //
    // Validates INPUT data. For the complete stored-record shape,
    // see the candidate passed through the pipeline validator.
    //
    // Capacity rule: null OR integer in [MIN_CAPACITY, MAX_CAPACITY].
    // A float is rejected. "30" is accepted and coerced to 30,
    // because form inputs come through as strings; "30.5" is not.

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
                if (isNaN(capacity) || !Number.isInteger(capacity)) {
                    return {
                        valid: false,
                        message: 'Capacity must be an integer between ' +
                            MIN_CAPACITY + ' and ' + MAX_CAPACITY + '.'
                    };
                }
                if (capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
                    return {
                        valid: false,
                        message: 'Capacity must be between ' +
                            MIN_CAPACITY + ' and ' + MAX_CAPACITY + '.'
                    };
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
     *
     * Uniqueness is enforced by the pipeline validator against
     * appData.locations. The preflight check against window.data is
     * for early UX feedback only.
     */
    function create(data) {
        var validation = validateLocationData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        // Preflight: is there already a location with this name?
        // This is UX; the pipeline re-checks.
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

                // Name uniqueness against the transaction snapshot.
                var conflict = findNameConflictInSnapshot(
                    appData, normalisedNewName, targetId
                );
                if (conflict) {
                    return {
                        valid: false,
                        message: 'A location with this name already exists.'
                    };
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
     * NAME UNIQUENESS:
     *   When the candidate's name changes, the pipeline validator
     *   checks the new name against every other location in
     *   appData.locations. The preflight check against window.data
     *   is for early UX feedback only. This closes the TOCTOU
     *   window where a rename that was unique at preflight could
     *   collide at commit.
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
                // Preflight duplicate check against window.data.
                // UX; the pipeline re-checks against the snapshot.
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

            if (newCapacity !== null) {
                if (!Number.isInteger(newCapacity) ||
                    newCapacity < MIN_CAPACITY ||
                    newCapacity > MAX_CAPACITY) {
                    return Promise.resolve(failure(
                        'Capacity must be an integer between ' +
                        MIN_CAPACITY + ' and ' + MAX_CAPACITY + '.'
                    ));
                }
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
        var normalisedCandidateName = normaliseLocationName(candidate.name);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !Array.isArray(appData.locations)) {
                    return { valid: false, message: 'Location no longer exists.' };
                }

                // The target must still exist in the snapshot.
                if (!findLocationInSnapshot(appData, targetId)) {
                    return { valid: false, message: 'Location no longer exists.' };
                }

                // Name uniqueness against the snapshot. This is
                // the authoritative check; the preflight against
                // window.data is UX.
                var conflict = findNameConflictInSnapshot(
                    appData, normalisedCandidateName, targetId
                );
                if (conflict) {
                    return {
                        valid: false,
                        message: 'A location with this name already exists.'
                    };
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
     * CASCADE:
     *   AcademyCascade.locationDeleted is MANDATORY at deletion
     *   time. Lazy lookup solves load order; it does not make the
     *   dependency optional. A missing cascade fails the
     *   transaction, because a successful deletion that leaves
     *   stale locationId references is worse than a failed one.
     *
     * WHAT THE CASCADE DOES:
     *   Nulls the locationId on every teaching session and every
     *   instructor commitment that referenced this location. Those
     *   records survive; the reference is cleared.
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
                if (!findLocationInSnapshot(appData, target)) {
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
                // The cascade helper is mandatory at this point. A
                // missing module or missing helper fails the
                // transaction.
                var Cascade = getAcademyCascade();
                if (!Cascade ||
                    typeof Cascade.locationDeleted !== 'function') {
                    throw new Error(
                        '[AcademyLocations] AcademyCascade.locationDeleted ' +
                        'is required for location deletion. Check the ' +
                        'script load order in index.html.'
                    );
                }

                var cascade = Cascade.locationDeleted(appData, target);

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

    /**
     * PRESENTATION HELPER. Returns the location's name, or
     * 'Unknown' when the ID is empty or the location does not
     * exist.
     *
     * The two missing cases are deliberately collapsed:
     *   - no location assigned (null/empty ID)
     *   - location assigned but not found
     *
     * Callers that need to distinguish them (e.g. an authoritative
     * schedule decision) should use getLocation() and inspect the
     * returned record directly. This function is for display text.
     */
    function getLocationName(id) {
        var loc = getLocationRecord(id);
        return loc ? loc.name : 'Unknown';
    }

    /**
     * PRESENTATION HELPER. Returns true when the location exists
     * AND has a positive capacity.
     *
     * Returns false when:
     *   - the location does not exist
     *   - the location exists with capacity null
     *   - the location exists with capacity 0 (which the schema
     *     disallows, but stored records could theoretically carry)
     *
     * Callers that need to distinguish "doesn't exist" from
     * "exists with no capacity" should use getLocation() and read
     * the record's capacity directly.
     */
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
    //
    // Save multiple locations at once.
    //
    // PHASES:
    //   1. Preflight. Validate each entry. Detect within-batch
    //      duplicates. Detect collisions with existing locations.
    //      Build a plan of { action: 'create' | 'update' | 'skip',
    //      record, matchId? }.
    //
    //   2. Pipeline validate. Verify the plan against the snapshot:
    //        - every update target still exists
    //        - every create ID is still free
    //        - the POST-MUTATION name set is unique
    //
    //   3. Pipeline mutate. Apply the plan.
    //
    // THE POST-MUTATION UNIQUENESS INVARIANT:
    //   After the bulk operation completes, no two locations in
    //   appData.locations may share a normalised name. This is the
    //   same invariant normal create/update enforce. The pipeline
    //   validator checks it explicitly by simulating the resulting
    //   name set and looking for duplicates.

    function saveLocations(locationsData, options) {
        if (!Array.isArray(locationsData) || locationsData.length === 0) {
            return Promise.resolve(failure('Location data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var planned = [];
        var errors = [];

        // ---- Within-batch duplicate detection ----
        // Two entries in the same batch that normalise to the same
        // name are a preflight failure. The message identifies the
        // second offending row.
        var batchNames = Object.create(null);

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

            var normalised = normaliseLocationName(data.name);
            if (batchNames[normalised]) {
                errors.push({
                    index: i,
                    error: 'Duplicate name within batch: "' +
                        data.name + '" (first seen at index ' +
                        batchNames[normalised].index + ').'
                });
                continue;
            }
            batchNames[normalised] = { index: i };

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

                var snapshotLocations = Array.isArray(appData.locations)
                    ? appData.locations
                    : [];

                // ---- 1. Update targets must exist ----
                for (var u = 0; u < updates.length; u++) {
                    var updateItem = updates[u];
                    if (!findLocationInSnapshot(appData, updateItem.matchId)) {
                        return {
                            valid: false,
                            message: 'Location no longer exists: ' +
                                updateItem.matchId
                        };
                    }
                }

                // ---- 2. Create IDs must not collide ----
                for (var c = 0; c < creates.length; c++) {
                    if (findLocationInSnapshot(appData, creates[c].record.id)) {
                        return {
                            valid: false,
                            message: 'Location ID collision: ' +
                                creates[c].record.id
                        };
                    }
                }

                // ---- 3. Post-mutation name set must be unique ----
                //
                // Simulate the result: every snapshot location that
                // is NOT being updated, plus every updated and
                // created candidate. Then check for duplicate
                // normalised names.
                var updateIds = Object.create(null);
                for (var ui = 0; ui < updates.length; ui++) {
                    updateIds[String(updates[ui].matchId)] = true;
                }

                var seenNames = Object.create(null);

                for (var s = 0; s < snapshotLocations.length; s++) {
                    var loc = snapshotLocations[s];
                    if (!loc) { continue; }
                    if (updateIds[String(loc.id)]) { continue; }

                    var key = normaliseLocationName(loc.name);
                    if (key === '') { continue; }
                    if (seenNames[key]) {
                        return {
                            valid: false,
                            message: 'Duplicate location name in ' +
                                'resulting store: "' + loc.name + '".'
                        };
                    }
                    seenNames[key] = true;
                }

                for (var ui2 = 0; ui2 < updates.length; ui2++) {
                    var uRec = updates[ui2].record;
                    var uKey = normaliseLocationName(uRec.name);
                    if (uKey === '') { continue; }
                    if (seenNames[uKey]) {
                        return {
                            valid: false,
                            message: 'Duplicate location name in ' +
                                'resulting store: "' + uRec.name + '".'
                        };
                    }
                    seenNames[uKey] = true;
                }

                for (var ci = 0; ci < creates.length; ci++) {
                    var cRec = creates[ci].record;
                    var cKey = normaliseLocationName(cRec.name);
                    if (cKey === '') { continue; }
                    if (seenNames[cKey]) {
                        return {
                            valid: false,
                            message: 'Duplicate location name in ' +
                                'resulting store: "' + cRec.name + '".'
                        };
                    }
                    seenNames[cKey] = true;
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
