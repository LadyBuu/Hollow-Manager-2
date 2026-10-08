/**
 * modules/social/social-core.js - Social Domain Core
 * Relationship CRUD operations with full mutation pipeline
 *
 * This module provides:
 *   - createRelationship / updateRelationship / deleteRelationship
 *   - deleteAllRelationshipsForCharacter
 *   - validateRelationshipData - pure validation
 *   - findRomanticOverlaps / getRomanticOverlaps - exclusive-type
 *     overlap detection
 *   - Cross-domain cascade helpers (stripCharacterRefs,
 *     endRelationshipsForCharacter)
 *   - Transaction-local adders (addRelationshipInTransaction,
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
 *   - A null, empty, or missing year is valid (means "not
 *     specified").
 *   - Years are stored as strings.
 *
 * DUPLICATE DETECTION:
 *   createRelationship rejects a pair + type that already exists.
 *   updateRelationship rejects a pair + type that already exists
 *   EXCEPT when the match is the record being edited.
 *
 * ROMANTIC OVERLAP DETECTION:
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
 */

(function() {
    'use strict';

    if (window.__socialCoreLoaded) {
        return;
    }
    window.__socialCoreLoaded = true;

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

    function findRomanticOverlaps(char1, char2, typeId, startYear, endYear,
                                  excludeId) {
        var result = { overlaps: [] };

        if (!char1 || !char2 || !typeId) { return result; }
        if (!SocialConstants.isExclusiveType(typeId)) { return result; }

        var s1 = parseYearOrNull(startYear);
        var e1 = parseYearOrNull(endYear);

        var aS = (s1 === null) ? -Infinity : s1;
        var aE = (e1 === null) ?  Infinity : e1;

        var relationships = SocialQueries.getAllRelationships();
        var exclude = excludeId ? String(excludeId) : null;

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) { continue; }
            if (rel.typeId !== typeId) { continue; }
            if (exclude && String(rel.id) === exclude) { continue; }

            var samePair =
                (String(rel.character1) === String(char1) &&
                 String(rel.character2) === String(char2)) ||
                (String(rel.character1) === String(char2) &&
                 String(rel.character2) === String(char1));
            if (samePair) { continue; }

            var sharesC1 = String(rel.character1) === String(char1) ||
                           String(rel.character2) === String(char1);
            var sharesC2 = String(rel.character1) === String(char2) ||
                           String(rel.character2) === String(char2);
            if (!sharesC1 && !sharesC2) { continue; }

            var s2 = parseYearOrNull(rel.startYear);
            var e2 = parseYearOrNull(rel.endYear);
            var bS = (s2 === null) ? -Infinity : s2;
            var bE = (e2 === null) ?  Infinity : e2;

            if (aE < bS || bE < aS) { continue; }

            result.overlaps.push({
                id: rel.id,
                character1: rel.character1,
                character2: rel.character2,
                typeId: rel.typeId,
                startYear: rel.startYear || '',
                endYear: rel.endYear || '',
                sharesChar1: sharesC1,
                sharesChar2: sharesC2
            });
        }

        return result;
    }

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
            if (result && result.success && result.data) {
                result.overlaps = result.data.overlaps || [];
            } else if (result && result.success) {
                result.overlaps = detectedOverlaps;
            }
            return result;
        });
    }

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

        stripCharacterRefs: stripCharacterRefs,
        endRelationshipsForCharacter: endRelationshipsForCharacter,

        addRelationshipInTransaction: addRelationshipInTransaction,
        addRelationshipsInTransaction: addRelationshipsInTransaction,

        validateRelationshipData: validateRelationshipData,
        isValidYear: isValidYear,

        normaliseYear: normaliseYear,
        normaliseText: normaliseText,
        normaliseId: normaliseId,

        readClarification: readClarification,

        findRomanticOverlaps: findRomanticOverlaps,
        getRomanticOverlaps: getRomanticOverlaps
    };

})();
