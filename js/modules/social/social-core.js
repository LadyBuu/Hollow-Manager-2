/**
 * modules/social/social-core.js - Social Domain Core
 * Relationship CRUD operations with full mutation pipeline
 *
 * This module provides:
 *   - createRelationship - Create a new relationship
 *   - updateRelationship - Update an existing relationship
 *   - deleteRelationship - Delete a relationship
 *   - deleteAllRelationshipsForCharacter - Delete all relationships for a character
 *   - validateRelationshipData - Pure validation function
 *   - findRomanticOverlaps - Overlap detector for exclusive types
 *   - Cross-domain cascade helpers (stripCharacterRefs, endRelationshipsForCharacter)
 *   - Transaction-local adders for use inside another module's
 *     pipeline mutate callback (addRelationshipInTransaction,
 *     addRelationshipsInTransaction)
 *
 * IMPORTANT:
 *   - All public mutations use MutationPipeline for transactional safety
 *   - No DOM, no UI, no notifications, no rendering
 *   - Uses SocialQueries for read operations (Social data only)
 *   - Uses injected characterProvider for character existence
 *   - Uses SocialConstants for type definitions
 *   - Returns structured results { success, data?, message?, error?, overlaps? }
 *   - No confirm() dialogs - caller handles UI
 *   - No window.data fallbacks - data structure must exist
 *   - characterProvider is INJECTED via init()
 *
 * CLARIFICATION SEMANTICS (two-sided):
 *   Each relationship carries two clarification strings:
 *
 *     clarification1   character1's role toward character2
 *     clarification2   character2's role toward character1
 *
 *   LEGACY FALLBACK:
 *     Older records carry a single `clarification` field. On read,
 *     the value is treated as clarification1 and clarification2 is
 *     empty. On write, the legacy field is removed and the record
 *     carries clarification1 and clarification2.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - A null, empty, or missing year is valid (means "year not
 *     specified").
 *   - Years are stored as strings. When provided, a year is
 *     normalised to its canonical string form.
 *
 * DUPLICATE DETECTION:
 *   createRelationship rejects a pair + type that already exists.
 *   updateRelationship rejects a pair + type that already exists
 *   EXCEPT when the match is the record being edited.
 *
 * ROMANTIC OVERLAP DETECTION (this revision):
 *   An EXCLUSIVE type (see SocialConstants.isExclusiveType) gets a
 *   second check: does either character already have a relationship
 *   of that same type covering an overlapping year range?
 *
 *   Overlap is defined by year range, not by pair. Two records with
 *   the same pair and the same type are caught by the duplicate
 *   check, not the overlap check. An overlap is a DIFFERENT pair
 *   that shares one endpoint and covers overlapping years.
 *
 *   Year range semantics:
 *     null start  -> -Infinity ("from the beginning")
 *     null end    -> +Infinity ("ongoing")
 *   Two ranges overlap when neither ends strictly before the other
 *   begins.
 *
 *   Overlap detection is NON-BLOCKING. It is surfaced in the
 *   validation result (validation.overlaps) and threaded through
 *   the mutation result (result.overlaps), but it does NOT add to
 *   validation.errors. The form shows a warning banner; the caller
 *   may choose to warn further or ignore it. The save succeeds.
 *
 *   Rationale: the tool is for authoring fiction. Some plots
 *   involve overlapping relationships. A hard block would fight
 *   the user's intent. Warnings, not walls.
 *
 * CASCADE SEMANTICS:
 *   stripCharacterRefs(appData, charId)      -- deletion cascade
 *   endRelationshipsForCharacter(...)        -- death cascade
 *
 * CHARACTER PROVIDER INTERFACE:
 *   {
 *       exists: function(characterId) { return true/false }
 *   }
 *
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *
 * USAGE:
 *   SocialCore.init({
 *       characterProvider: {
 *           exists: function(id) { return CharacterQueries.getCharacterById(id) !== null; }
 *       }
 *   });
 *
 *   var result = SocialCore.createRelationship(
 *       'char1', 'char2', 'friendship',
 *       '', '', 'Best friend', 'Best friend', ''
 *   );
 *   if (result.success) {
 *       if (result.overlaps && result.overlaps.length > 0) {
 *           // warn the user; the save still succeeded
 *       }
 *   }
 */

(function() {
    'use strict';

    if (window.__socialCoreLoaded) {
        return;
    }
    window.__socialCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialQueries = window.SocialQueries;
    var SocialConstants = window.SocialConstants;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // INJECTED DEPENDENCIES
    // ============================================================

    var _characterProvider = null;

    function init(deps) {
        deps = deps || {};

        if (deps.characterProvider) {
            if (typeof deps.characterProvider.exists !== 'function') {
                console.warn('[SocialCore] characterProvider must have an exists() method.');
            } else {
                _characterProvider = deps.characterProvider;
            }
        }

        return _characterProvider !== null;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SocialQueries || typeof SocialQueries.getRelationshipById !== 'function') {
            missing.push('SocialQueries.getRelationshipById');
        }
        if (!SocialQueries || typeof SocialQueries.getAllRelationships !== 'function') {
            missing.push('SocialQueries.getAllRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.relationshipExists !== 'function') {
            missing.push('SocialQueries.relationshipExists');
        }

        if (!SocialConstants || typeof SocialConstants.isDirectional !== 'function') {
            missing.push('SocialConstants.isDirectional');
        }
        if (!SocialConstants || typeof SocialConstants.isValidType !== 'function') {
            missing.push('SocialConstants.isValidType');
        }
        if (!SocialConstants || typeof SocialConstants.getDefaultTypeId !== 'function') {
            missing.push('SocialConstants.getDefaultTypeId');
        }
        if (!SocialConstants || typeof SocialConstants.isExclusiveType !== 'function') {
            missing.push('SocialConstants.isExclusiveType');
        }

        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        if (!_characterProvider || typeof _characterProvider.exists !== 'function') {
            missing.push('characterProvider.exists (call SocialCore.init() first)');
        }

        if (missing.length > 0) {
            console.warn('[SocialCore] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // CLARIFICATION HELPERS
    // ============================================================

    /**
     * Read a relationship's clarification for one side.
     *
     * side === 1 -> clarification1, falling back to the legacy
     *               `clarification` field.
     * side === 2 -> clarification2 (no legacy fallback).
     */
    function readClarification(rel, side) {
        if (!rel || typeof rel !== 'object') { return ''; }

        if (side === 2) {
            if (rel.clarification2 !== undefined && rel.clarification2 !== null) {
                return String(rel.clarification2);
            }
            return '';
        }

        if (rel.clarification1 !== undefined && rel.clarification1 !== null) {
            return String(rel.clarification1);
        }
        if (rel.clarification !== undefined && rel.clarification !== null) {
            return String(rel.clarification);
        }
        return '';
    }

    /**
     * Write both clarification fields onto a relationship record,
     * and remove the legacy `clarification` field.
     */
    function writeClarifications(rel, clarification1, clarification2) {
        if (!rel) { return; }
        rel.clarification1 = clarification1 || '';
        rel.clarification2 = clarification2 || '';
        if (Object.prototype.hasOwnProperty.call(rel, 'clarification')) {
            delete rel.clarification;
        }
    }

    // ============================================================
    // YEAR HELPERS
    // ============================================================

    function isValidYear(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        var num = Number(value);
        return Number.isInteger(num) && num >= 1;
    }

    function normaliseYear(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var num = Number(value);
        if (Number.isInteger(num) && num >= 1) {
            return String(num);
        }
        return '';
    }

    /**
     * Parse a year value to an integer, or null when unset/malformed.
     * Used by the overlap detector, which treats null as an open
     * bound rather than as an error.
     */
    function parseYearOrNull(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    function normaliseText(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value).trim();
    }

    function normaliseId(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    // ============================================================
    // ID ALLOCATION
    // ============================================================

    function getNextId(data) {
        if (!data.social) { data.social = {}; }
        if (!data.social.relationships) { data.social.relationships = []; }
        if (typeof data.social.nextId !== 'number' || data.social.nextId < 1) {
            data.social.nextId = 1;
        }

        var existingIds = Object.create(null);
        data.social.relationships.forEach(function(rel) {
            if (rel && rel.id !== undefined && rel.id !== null) {
                existingIds[String(rel.id)] = true;
            }
        });

        var nextId = data.social.nextId;
        while (existingIds[String(nextId)]) { nextId++; }

        data.social.nextId = nextId + 1;
        return nextId;
    }

    // ============================================================
    // ROMANTIC OVERLAP DETECTION
    // ============================================================
    //
    // An overlap is a DIFFERENT pair, sharing at least one endpoint
    // with the candidate pair, of the SAME exclusive type, with an
    // overlapping year range.
    //
    // Duplicates (same pair, same type) are caught by the duplicate
    // check, not here. If a candidate matches an existing record by
    // pair AND type, it is skipped here so the two checks do not
    // double-report.
    //
    // Overlap semantics:
    //   null start  -> -Infinity
    //   null end    -> +Infinity
    //   Two ranges overlap when aE >= bS AND bE >= aS.
    //
    // Non-exclusive types are skipped entirely. A character can be
    // in many friendships, rivalries, mentors, and alliances at
    // once; only exclusive types are checked.

    function findRomanticOverlaps(char1, char2, typeId, startYear, endYear,
                                  excludeId) {
        var result = { overlaps: [] };

        if (!char1 || !char2 || !typeId) { return result; }
        if (!SocialConstants.isExclusiveType(typeId)) { return result; }

        var s1 = parseYearOrNull(startYear);
        var e1 = parseYearOrNull(endYear);

        // Range for the candidate. Null bounds become infinities.
        var aS = (s1 === null) ? -Infinity : s1;
        var aE = (e1 === null) ?  Infinity : e1;

        var relationships = SocialQueries.getAllRelationships();
        var exclude = excludeId ? String(excludeId) : null;

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) { continue; }

            // Same type required.
            if (rel.typeId !== typeId) { continue; }

            // Same exclusive-type requirement is implied by the
            // type equality above; no second check needed.

            // Skip the record being edited, if any.
            if (exclude && String(rel.id) === exclude) { continue; }

            // Skip duplicates (same pair, either orientation). The
            // duplicate check reports these; do not double-report.
            var samePair =
                (String(rel.character1) === String(char1) &&
                 String(rel.character2) === String(char2)) ||
                (String(rel.character1) === String(char2) &&
                 String(rel.character2) === String(char1));
            if (samePair) { continue; }

            // Same endpoint requirement. At least one of the candidate
            // pair must appear in this record.
            var sharesC1 = String(rel.character1) === String(char1) ||
                           String(rel.character2) === String(char1);
            var sharesC2 = String(rel.character1) === String(char2) ||
                           String(rel.character2) === String(char2);
            if (!sharesC1 && !sharesC2) { continue; }

            // Year range overlap.
            var s2 = parseYearOrNull(rel.startYear);
            var e2 = parseYearOrNull(rel.endYear);
            var bS = (s2 === null) ? -Infinity : s2;
            var bE = (e2 === null) ?  Infinity : e2;

            if (aE < bS || bE < aS) { continue; }

            // Record which side of the candidate pair collides with
            // this record, so the UI can name the right character.
            var sideC1 = sharesC1;
            var sideC2 = sharesC2;

            result.overlaps.push({
                id: rel.id,
                character1: rel.character1,
                character2: rel.character2,
                typeId: rel.typeId,
                startYear: rel.startYear || '',
                endYear: rel.endYear || '',
                sharesChar1: sideC1,
                sharesChar2: sideC2
            });
        }

        return result;
    }

    /**
     * Public wrapper. Returns just the array (empty when no
     * overlaps or type is not exclusive).
     */
    function getRomanticOverlaps(char1, char2, typeId, startYear, endYear,
                                 excludeId) {
        return findRomanticOverlaps(
            char1, char2, typeId,
            startYear, endYear, excludeId
        ).overlaps;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate relationship data.
     *
     * @param {object} data
     * @param {object} [options]
     * @param {boolean} [options.checkDuplicates=true]
     * @param {string} [options.excludeId] - When set, the duplicate
     *   check ignores this relationship ID. Used by updateRelationship
     *   so a record does not match itself. Also passed to the
     *   overlap detector so the record being edited does not
     *   collide with itself.
     * @param {boolean} [options.checkOverlaps=true]
     *
     * @returns {object} {
     *   valid: boolean,
     *   errors: string[],
     *   overlaps: object[]   // always present; may be empty
     * }
     *
     * NOTE: overlaps never contribute to errors. They are a
     * separate channel for the caller's UI to display as warnings.
     */
    function validateRelationshipData(data, options) {
        options = options || {};
        var checkDuplicates = options.checkDuplicates !== false;
        var checkOverlaps = options.checkOverlaps !== false;
        var excludeId = options.excludeId ? String(options.excludeId) : null;

        var errors = [];
        var overlaps = [];

        var char1 = data.character1;
        var char2 = data.character2;
        var typeId = data.typeId;

        if (!char1 || String(char1).trim() === '') {
            errors.push('Character 1 is required.');
        }
        if (!char2 || String(char2).trim() === '') {
            errors.push('Character 2 is required.');
        }
        if (char1 && char2 && String(char1) === String(char2)) {
            errors.push('Cannot create a relationship between the same character.');
        }

        if (char1 && _characterProvider && typeof _characterProvider.exists === 'function') {
            if (!_characterProvider.exists(char1)) {
                errors.push('Character 1 does not exist.');
            }
        }
        if (char2 && _characterProvider && typeof _characterProvider.exists === 'function') {
            if (!_characterProvider.exists(char2)) {
                errors.push('Character 2 does not exist.');
            }
        }

        if (!typeId) {
            errors.push('Relationship type is required.');
        } else if (!SocialConstants.isValidType(typeId)) {
            errors.push('Invalid relationship type.');
        }

        if (data.startYear !== undefined && data.startYear !== null && data.startYear !== '') {
            if (!isValidYear(data.startYear)) {
                errors.push('Start year must be a positive integer.');
            }
        }
        if (data.endYear !== undefined && data.endYear !== null && data.endYear !== '') {
            if (!isValidYear(data.endYear)) {
                errors.push('End year must be a positive integer.');
            }
        }

        var startNum = Number(data.startYear);
        var endNum = Number(data.endYear);
        if (data.startYear && data.endYear && isValidYear(data.startYear) && isValidYear(data.endYear)) {
            if (endNum < startNum) {
                errors.push('End year must be after start year.');
            }
        }

        if (checkDuplicates && char1 && char2 && typeId) {
            if (duplicateExists(char1, char2, typeId, excludeId)) {
                var label = SocialConstants.getLabel(typeId);
                errors.push('A ' + label + ' relationship already exists between these characters.');
            }
        }

        // ---- Overlap detection (non-blocking) ----
        //
        // Only runs when the data passed the basic structural checks.
        // A missing type or character makes the overlap detector
        // meaningless. Do not run it on malformed input.
        if (checkOverlaps &&
            char1 && char2 && typeId &&
            String(char1) !== String(char2) &&
            SocialConstants.isValidType(typeId)) {
            overlaps = findRomanticOverlaps(
                char1, char2, typeId,
                data.startYear, data.endYear,
                excludeId
            ).overlaps;
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            overlaps: overlaps
        };
    }

    /**
     * Does a relationship already exist between these two characters
     * of this type, excluding a specific ID?
     */
    function duplicateExists(char1, char2, typeId, excludeId) {
        var target1 = String(char1);
        var target2 = String(char2);
        var isDirectional = SocialConstants.isDirectional(typeId);

        var relationships = SocialQueries.getAllRelationships();

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) { continue; }
            if (rel.typeId !== typeId) { continue; }
            if (excludeId && String(rel.id) === excludeId) { continue; }

            var r1 = String(rel.character1);
            var r2 = String(rel.character2);

            if (isDirectional) {
                if (r1 === target1 && r2 === target2) { return true; }
            } else {
                if ((r1 === target1 && r2 === target2) ||
                    (r1 === target2 && r2 === target1)) {
                    return true;
                }
            }
        }

        return false;
    }

    // ============================================================
    // TRANSACTION-LOCAL ADDERS
    // ============================================================
    //
    // These helpers add relationships to appData.social.relationships
    // without entering MutationPipeline. They are designed to be
    // called from inside another module's pipeline mutate() callback,
    // where the enclosing transaction owns validation and rollback.
    //
    // They never touch window.data. They mutate only the appData
    // argument. They never throw on malformed input; they skip
    // malformed records and continue.

    function ensureSocialStructure(appData) {
        if (!appData.social || typeof appData.social !== 'object') {
            appData.social = {};
        }
        if (!Array.isArray(appData.social.relationships)) {
            appData.social.relationships = [];
        }
        if (typeof appData.social.nextId !== 'number' || appData.social.nextId < 1) {
            appData.social.nextId = 1;
        }
    }

    function allocateId(appData) {
        ensureSocialStructure(appData);

        var existingIds = Object.create(null);
        for (var i = 0; i < appData.social.relationships.length; i++) {
            var rel = appData.social.relationships[i];
            if (rel && rel.id !== undefined && rel.id !== null) {
                existingIds[String(rel.id)] = true;
            }
        }

        var id = appData.social.nextId;
        while (existingIds[String(id)]) { id++; }
        appData.social.nextId = id + 1;
        return id;
    }

    function addRelationshipInTransaction(appData, relationship) {
        if (!appData || typeof appData !== 'object') { return null; }
        if (!relationship || typeof relationship !== 'object') { return null; }

        var typeId = String(relationship.typeId || '').trim();
        if (typeId === '') { return null; }

        var character1 = String(relationship.character1 || '').trim();
        var character2 = String(relationship.character2 || '').trim();
        if (character1 === '' || character2 === '') { return null; }
        if (character1 === character2) { return null; }

        ensureSocialStructure(appData);

        var record = {
            id: allocateId(appData),
            character1: character1,
            character2: character2,
            typeId: typeId,
            startYear: (relationship.startYear === undefined || relationship.startYear === null)
                ? '' : String(relationship.startYear),
            endYear: (relationship.endYear === undefined || relationship.endYear === null)
                ? '' : String(relationship.endYear),
            clarification1: (relationship.clarification1 === undefined || relationship.clarification1 === null)
                ? '' : String(relationship.clarification1),
            clarification2: (relationship.clarification2 === undefined || relationship.clarification2 === null)
                ? '' : String(relationship.clarification2),
            notes: (relationship.notes === undefined || relationship.notes === null)
                ? '' : String(relationship.notes),
            createdAt: new Date().toISOString()
        };

        appData.social.relationships.push(record);
        return record;
    }

    function addRelationshipsInTransaction(appData, relationships) {
        var result = { added: 0, records: [] };

        if (!appData || typeof appData !== 'object') { return result; }
        if (!Array.isArray(relationships)) { return result; }

        for (var i = 0; i < relationships.length; i++) {
            var record = addRelationshipInTransaction(appData, relationships[i]);
            if (record) {
                result.added++;
                result.records.push(record);
            }
        }

        return result;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Create a new relationship.
     *
     * On success, the returned result may carry an `overlaps` array
     * listing exclusive-type overlaps that were detected but did
     * not block the save. Callers should surface these as warnings.
     */
    function createRelationship(charId1, charId2, typeId, startYear, endYear, clarification1, clarification2, notes) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        var c1 = normaliseId(charId1);
        var c2 = normaliseId(charId2);
        var type = normaliseText(typeId);
        var start = normaliseYear(startYear);
        var end = normaliseYear(endYear);
        var clar1 = normaliseText(clarification1);
        var clar2 = normaliseText(clarification2);
        var noteText = normaliseText(notes);

        var validation = validateRelationshipData({
            character1: c1,
            character2: c2,
            typeId: type,
            startYear: start,
            endYear: end,
            clarification1: clar1,
            clarification2: clar2,
            notes: noteText
        }, { checkDuplicates: true });

        if (!validation.valid) {
            return Promise.resolve({
                success: false,
                message: validation.errors.join(' '),
                errors: validation.errors
            });
        }

        var detectedOverlaps = validation.overlaps || [];
        var label = SocialConstants.getLabel(type);

        return MutationPipeline.performMutation({
            validate: function() {
                var currentValidation = validateRelationshipData({
                    character1: c1,
                    character2: c2,
                    typeId: type,
                    startYear: start,
                    endYear: end,
                    clarification1: clar1,
                    clarification2: clar2,
                    notes: noteText
                }, { checkDuplicates: true });

                if (!currentValidation.valid) {
                    return {
                        valid: false,
                        message: currentValidation.errors.join(' ')
                    };
                }

                // The overlap set is not blocking, but we take the
                // CURRENT set (not the pre-flight set) so the result
                // reflects what was true at the moment of the write.
                detectedOverlaps = currentValidation.overlaps || [];

                return { valid: true };
            },

            mutate: function(data) {
                if (!data.social) { data.social = {}; }
                if (!Array.isArray(data.social.relationships)) {
                    data.social.relationships = [];
                }

                var id = getNextId(data);

                var relationship = {
                    id: id,
                    character1: c1,
                    character2: c2,
                    typeId: type,
                    startYear: start,
                    endYear: end,
                    clarification1: clar1,
                    clarification2: clar2,
                    notes: noteText,
                    createdAt: new Date().toISOString()
                };

                data.social.relationships.push(relationship);

                return {
                    relationship: relationship,
                    overlaps: detectedOverlaps
                };
            },

            logMessage: function() {
                return 'Created ' + label + ' relationship';
            },
            successMessage: 'Relationship created successfully!',
            failureMessage: 'Failed to create relationship.'
        }).then(function(result) {
            // Thread overlaps through the public result so callers
            // do not have to dig into the pipeline envelope.
            if (result && result.success && result.data) {
                result.overlaps = result.data.overlaps || [];
            } else if (result && result.success) {
                result.overlaps = detectedOverlaps;
            }
            return result;
        });
    }

    /**
     * Update an existing relationship.
     *
     * The duplicate check ignores the record being edited, so saving
     * with the same characters and type succeeds. The overlap
     * detector also ignores it, so a record cannot collide with
     * itself.
     *
     * On success, the returned result may carry an `overlaps` array
     * just like createRelationship.
     */
    function updateRelationship(id, updates) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!id) {
            return Promise.resolve({
                success: false,
                message: 'Relationship ID is required.'
            });
        }

        var relId = String(id);

        var existing = SocialQueries.getRelationshipById(relId);
        if (!existing) {
            return Promise.resolve({
                success: false,
                message: 'Relationship not found.'
            });
        }

        var existingClar1 = readClarification(existing, 1);
        var existingClar2 = readClarification(existing, 2);

        var c1 = updates.character1 !== undefined ? normaliseId(updates.character1) : existing.character1;
        var c2 = updates.character2 !== undefined ? normaliseId(updates.character2) : existing.character2;
        var type = updates.typeId !== undefined ? normaliseText(updates.typeId) : existing.typeId;
        var start = updates.startYear !== undefined ? normaliseYear(updates.startYear) : existing.startYear;
        var end = updates.endYear !== undefined ? normaliseYear(updates.endYear) : existing.endYear;
        var clar1 = updates.clarification1 !== undefined ? normaliseText(updates.clarification1) : existingClar1;
        var clar2 = updates.clarification2 !== undefined ? normaliseText(updates.clarification2) : existingClar2;
        var noteText = updates.notes !== undefined ? normaliseText(updates.notes) : existing.notes;

        var validation = validateRelationshipData({
            character1: c1,
            character2: c2,
            typeId: type,
            startYear: start,
            endYear: end,
            clarification1: clar1,
            clarification2: clar2,
            notes: noteText
        }, { checkDuplicates: true, excludeId: relId });

        if (!validation.valid) {
            return Promise.resolve({
                success: false,
                message: validation.errors.join(' '),
                errors: validation.errors
            });
        }

        var detectedOverlaps = validation.overlaps || [];
        var label = SocialConstants.getLabel(type);

        return MutationPipeline.performMutation({
            validate: function() {
                var currentRel = SocialQueries.getRelationshipById(relId);
                if (!currentRel) {
                    return {
                        valid: false,
                        message: 'Relationship no longer exists.'
                    };
                }

                var currentValidation = validateRelationshipData({
                    character1: c1,
                    character2: c2,
                    typeId: type,
                    startYear: start,
                    endYear: end,
                    clarification1: clar1,
                    clarification2: clar2,
                    notes: noteText
                }, { checkDuplicates: true, excludeId: relId });

                if (!currentValidation.valid) {
                    return {
                        valid: false,
                        message: currentValidation.errors.join(' ')
                    };
                }

                detectedOverlaps = currentValidation.overlaps || [];

                return { valid: true };
            },

            mutate: function(data) {
                var rel = null;

                if (data.social && Array.isArray(data.social.relationships)) {
                    for (var i = 0; i < data.social.relationships.length; i++) {
                        if (data.social.relationships[i] &&
                            String(data.social.relationships[i].id) === relId) {
                            rel = data.social.relationships[i];
                            break;
                        }
                    }
                }

                if (!rel) {
                    throw new Error('Relationship not found in data store.');
                }

                rel.character1 = c1;
                rel.character2 = c2;
                rel.typeId = type;
                rel.startYear = start;
                rel.endYear = end;
                writeClarifications(rel, clar1, clar2);
                rel.notes = noteText;

                return {
                    relationship: rel,
                    overlaps: detectedOverlaps
                };
            },

            logMessage: function() {
                return 'Updated ' + label + ' relationship';
            },
            successMessage: 'Relationship updated successfully!',
            failureMessage: 'Failed to update relationship.'
        }).then(function(result) {
            if (result && result.success && result.data) {
                result.overlaps = result.data.overlaps || [];
            } else if (result && result.success) {
                result.overlaps = detectedOverlaps;
            }
            return result;
        });
    }

    function deleteRelationship(id) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!id) {
            return Promise.resolve({
                success: false,
                message: 'Relationship ID is required.'
            });
        }

        var relId = String(id);

        var existing = SocialQueries.getRelationshipById(relId);
        if (!existing) {
            return Promise.resolve({
                success: false,
                message: 'Relationship not found.'
            });
        }

        var label = SocialConstants.getLabel(existing.typeId);

        return MutationPipeline.performMutation({
            validate: function() {
                var currentRel = SocialQueries.getRelationshipById(relId);
                if (!currentRel) {
                    return {
                        valid: false,
                        message: 'Relationship no longer exists.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!data.social || !Array.isArray(data.social.relationships)) {
                    throw new Error('No relationships found.');
                }

                var found = false;
                data.social.relationships = data.social.relationships.filter(function(rel) {
                    if (rel && String(rel.id) === relId) {
                        found = true;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Relationship not found in data store.');
                }

                return { deleted: true };
            },

            logMessage: function() {
                return 'Deleted ' + label + ' relationship';
            },
            successMessage: 'Relationship deleted successfully!',
            failureMessage: 'Failed to delete relationship.'
        });
    }

    function deleteAllRelationshipsForCharacter(charId) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        var target = String(charId);

        if (_characterProvider && typeof _characterProvider.exists === 'function') {
            if (!_characterProvider.exists(target)) {
                return Promise.resolve({
                    success: false,
                    message: 'Character not found.'
                });
            }
        }

        var rels = SocialQueries.getCharacterRelationships(target);
        if (rels.length === 0) {
            return Promise.resolve({
                success: true,
                count: 0,
                message: 'No relationships to delete.'
            });
        }

        return MutationPipeline.performMutation({
            validate: function() { return { valid: true }; },

            mutate: function(data) {
                if (!data.social || !Array.isArray(data.social.relationships)) {
                    throw new Error('No relationships found.');
                }

                var count = 0;
                data.social.relationships = data.social.relationships.filter(function(rel) {
                    if (!rel) { return true; }
                    var c1 = String(rel.character1);
                    var c2 = String(rel.character2);
                    if (c1 === target || c2 === target) {
                        count++;
                        return false;
                    }
                    return true;
                });

                return { deletedCount: count };
            },

            logMessage: function(result) {
                return 'Deleted ' + result.deletedCount + ' relationships for character';
            },
            successMessage: function(result) {
                return 'Deleted ' + result.deletedCount + ' relationships.';
            },
            failureMessage: 'Failed to delete relationships.'
        });
    }

    // ============================================================
    // CASCADE HELPERS - DELETION
    // ============================================================

    /**
     * Remove every relationship involving a character from appData.
     *
     * DELETION CASCADE. Called by CharacterCRUD.deleteCharacter from
     * inside its pipeline mutate.
     */
    function stripCharacterRefs(appData, charId) {
        var result = { relationshipsRemoved: 0 };

        if (!appData || !charId) { return result; }
        if (!appData.social || typeof appData.social !== 'object') {
            return result;
        }

        var relationships = appData.social.relationships;
        if (!Array.isArray(relationships)) { return result; }

        var target = String(charId);
        var before = relationships.length;

        appData.social.relationships = relationships.filter(function(rel) {
            if (!rel) { return true; }
            return String(rel.character1) !== target &&
                   String(rel.character2) !== target;
        });

        result.relationshipsRemoved = before - appData.social.relationships.length;
        return result;
    }

    // ============================================================
    // CASCADE HELPERS - DEATH
    // ============================================================

    /**
     * End every ONGOING relationship involving a character by
     * stamping the death year onto endYear.
     *
     * DEATH CASCADE. Called by CharacterCRUD from inside its pipeline
     * mutate.
     */
    function endRelationshipsForCharacter(appData, charId, deathYear) {
        var result = { relationshipsEnded: 0 };

        if (!appData || !charId) { return result; }

        var yearNum = parseInt(deathYear, 10);
        if (isNaN(yearNum) || yearNum < 1) { return result; }

        if (!appData.social || typeof appData.social !== 'object') {
            return result;
        }

        var relationships = appData.social.relationships;
        if (!Array.isArray(relationships)) { return result; }

        var target = String(charId);
        var yearStr = String(yearNum);

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) { continue; }

            var c1 = String(rel.character1);
            var c2 = String(rel.character2);
            if (c1 !== target && c2 !== target) { continue; }

            var existingEnd = rel.endYear;
            var isOngoing = existingEnd === undefined ||
                            existingEnd === null ||
                            String(existingEnd).trim() === '';
            if (!isOngoing) { continue; }

            rel.endYear = yearStr;
            result.relationshipsEnded++;
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialCore = {
        init: init,

        createRelationship: createRelationship,
        updateRelationship: updateRelationship,
        deleteRelationship: deleteRelationship,
        deleteAllRelationshipsForCharacter: deleteAllRelationshipsForCharacter,

        // Cascades
        stripCharacterRefs: stripCharacterRefs,
        endRelationshipsForCharacter: endRelationshipsForCharacter,

        // Transaction-local adders
        addRelationshipInTransaction: addRelationshipInTransaction,
        addRelationshipsInTransaction: addRelationshipsInTransaction,

        // Validation and normalisation
        validateRelationshipData: validateRelationshipData,
        isValidYear: isValidYear,

        normaliseYear: normaliseYear,
        normaliseText: normaliseText,
        normaliseId: normaliseId,

        // Clarification reads with legacy fallback
        readClarification: readClarification,

        // Overlap detection
        //
        // findRomanticOverlaps returns { overlaps: [...] }.
        // getRomanticOverlaps returns just the array.
        //
        // Both are pure reads against SocialQueries. Neither
        // mutates. Callers in the UI use getRomanticOverlaps to
        // render warning banners.
        findRomanticOverlaps: findRomanticOverlaps,
        getRomanticOverlaps: getRomanticOverlaps
    };

})();
