/**
 * js/import-export/import-pipeline.js - Import Pipeline
 * All-or-nothing import orchestration for Hollow Manager 2
 * 
 * This module orchestrates the complete import pipeline:
 *   File → Parse → Envelope Validation → Format Migration →
 *   Canonicalisation → Cross-Domain Validation →
 *   Candidate State → MutationPipeline → Commit
 * 
 * IMPORTANT:
 *   - All-or-nothing: if any step fails, nothing is committed
 *   - Candidate state is built from the import, NOT from live state
 *   - Validates against candidate state, not live application
 *   - Uses MutationPipeline for atomic commit
 *   - No UI dependencies - caller handles notifications
 *   - Returns structured results with errors and warnings
 * 
 * PIPELINE STAGES:
 *   1. Read file → text
 *   2. Parse JSON → envelope
 *   3. Validate envelope structure
 *   4. Migrate format (if needed)
 *   5. Extract data → candidate state
 *   6. Cross-domain validation
 *   7. Build complete candidate
 *   8. Atomic commit via MutationPipeline
 *   9. Activity log
 * 
 * DEPENDENCIES:
 *   - window.ExportSchema (from export-schema.js) - MANDATORY
 *   - window.ExportEnvelope (from export-envelope.js) - MANDATORY
 *   - window.FormatMigrations (from format-migrations.js) - MANDATORY
 *   - window.CrossDomainValidator (from cross-domain-validator.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.ActivityLog (from activity-log.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var Pipeline = window.ImportPipeline;
 *   
 *   // From file
 *   var result = await Pipeline.importFromFile(file);
 *   if (result.success) {
 *       // Data imported successfully
 *   } else {
 *       // Handle errors
 *   }
 *   
 *   // From JSON string
 *   var result = await Pipeline.importFromJSON(jsonText);
 *   
 *   // From envelope object
 *   var result = await Pipeline.importFromEnvelope(envelope);
 */

(function() {
    'use strict';

    if (window.__importPipelineLoaded) return;
    window.__importPipelineLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var deps = {
        ExportSchema: window.ExportSchema,
        ExportEnvelope: window.ExportEnvelope,
        FormatMigrations: window.FormatMigrations,
        CrossDomainValidator: window.CrossDomainValidator,
        MutationPipeline: window.MutationPipeline,
        ActivityLog: window.ActivityLog,
        ObjectUtils: window.ObjectUtils,
        IdUtils: window.IdUtils
    };

    var missing = [];
    for (var name in deps) {
        if (!deps[name]) {
            missing.push(name);
        }
    }

    if (missing.length > 0) {
        throw new Error('[ImportPipeline] Missing dependencies: ' + missing.join(', '));
    }

    var Schema = deps.ExportSchema;
    var Envelope = deps.ExportEnvelope;
    var Migrations = deps.FormatMigrations;
    var Validator = deps.CrossDomainValidator;
    var MutationPipeline = deps.MutationPipeline;
    var ActivityLog = deps.ActivityLog;
    var ObjectUtils = deps.ObjectUtils;
    var IdUtils = deps.IdUtils;

    // ============================================================
    // HELPERS
    // ============================================================

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isArray(value) {
        return Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function generateId() {
        return IdUtils.generateId('import');
    }

    function getCurrentTimestamp() {
        return new Date().toISOString();
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function createSuccessResult(message, details) {
        return {
            success: true,
            message: message || 'Import completed successfully.',
            errors: [],
            warnings: [],
            details: details || null,
            committed: true
        };
    }

    function createFailureResult(errors, warnings, message) {
        if (!Array.isArray(errors)) {
            errors = [String(errors)];
        }
        return {
            success: false,
            message: message || 'Import failed.',
            errors: errors,
            warnings: warnings || [],
            details: null,
            committed: false
        };
    }

    function createValidationFailureResult(validation) {
        return {
            success: false,
            message: 'Validation failed: ' + validation.errors.length + ' error(s) found.',
            errors: validation.errors,
            warnings: validation.warnings || [],
            details: validation,
            committed: false
        };
    }

    function combineWarnings(results) {
        var allWarnings = [];
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            if (r && Array.isArray(r.warnings)) {
                allWarnings = allWarnings.concat(r.warnings);
            }
        }
        return allWarnings;
    }

    // ============================================================
    // FILE READING
    // ============================================================

    /**
     * Read a file as text.
     * 
     * @param {File} file - File to read
     * @returns {Promise<string>} File contents
     */
    function readFileAsText(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                resolve(e.target.result);
            };
            reader.onerror = function() {
                reject(new Error('Failed to read file: ' + (reader.error ? reader.error.message : 'Unknown error')));
            };
            reader.readAsText(file);
        });
    }

    // ============================================================
    // CANDIDATE STATE BUILDING
    // ============================================================

    /**
     * Build a complete candidate state from extracted data.
     * Ensures all required sections exist with defaults.
     * 
     * @param {object} data - Extracted data from envelope
     * @returns {object} Complete candidate state
     */
    function buildCandidateState(data) {
        if (!data || typeof data !== 'object') {
            return {};
        }

        var candidate = deepClone(data);

        // Ensure all sections exist
        var sections = Schema.getSections();
        for (var i = 0; i < sections.length; i++) {
            var section = sections[i];
            if (!(section in candidate)) {
                candidate[section] = Schema.getDefaultSection(section);
            }
        }

        // Ensure required sections are arrays
        var requiredSections = Schema.getRequiredSections();
        for (var j = 0; j < requiredSections.length; j++) {
            var reqSection = requiredSections[j];
            if (!Array.isArray(candidate[reqSection])) {
                candidate[reqSection] = [];
            }
        }

        // Ensure application settings exist
        if (candidate.currentYear === undefined || candidate.currentYear === null) {
            candidate.currentYear = new Date().getFullYear();
        }
        if (candidate.currentWeek === undefined || candidate.currentWeek === null) {
            candidate.currentWeek = 1;
        }

        return candidate;
    }

    // ============================================================
    // ENSURE UNIQUE IDS
    // ============================================================

    /**
     * Ensure all entities have unique IDs.
     * Assigns new IDs to entities that have null/empty IDs or duplicates.
     * 
     * @param {object} candidate - Candidate state
     * @param {object} options - Options
     * @param {boolean} options.preserveExistingIds - Preserve existing IDs (default: true)
     * @param {array} options.collections - Collections to process (default: all)
     * @returns {object} { candidate: object, changes: array }
     */
    function ensureUniqueIds(candidate, options) {
        options = options || {};
        var preserveExistingIds = options.preserveExistingIds !== false;

        var result = deepClone(candidate);
        var changes = [];

        var collections = options.collections || [
            { name: 'characters', idPrefix: 'char' },
            { name: 'teams', idPrefix: 'team' },
            { name: 'tournaments', idPrefix: 'tourn' },
            { name: 'missions', idPrefix: 'miss' },
            { name: 'classes', idPrefix: 'class' },
            { name: 'locations', idPrefix: 'loc' }
        ];

        for (var c = 0; c < collections.length; c++) {
            var collection = collections[c];
            var data = result[collection.name];
            if (!Array.isArray(data)) continue;

            var seenIds = {};
            var prefix = collection.idPrefix || collection.name.slice(0, 4);

            for (var i = 0; i < data.length; i++) {
                var item = data[i];
                if (!item || typeof item !== 'object') continue;

                var currentId = normaliseId(item.id);
                var shouldRegenerate = false;
                var oldId = currentId;

                if (!currentId) {
                    // Empty ID - generate new
                    shouldRegenerate = true;
                } else if (seenIds[currentId]) {
                    // Duplicate ID - generate new
                    shouldRegenerate = true;
                } else if (!preserveExistingIds) {
                    // Not preserving existing IDs
                    shouldRegenerate = true;
                } else {
                    // ID is valid and unique
                    seenIds[currentId] = true;
                }

                if (shouldRegenerate) {
                    var newId = IdUtils.generateId(prefix);
                    item.id = newId;
                    changes.push({
                        collection: collection.name,
                        index: i,
                        oldId: oldId || null,
                        newId: newId,
                        reason: oldId ? 'Duplicate ID' : 'Missing ID'
                    });
                    seenIds[newId] = true;
                }
            }
        }

        return {
            candidate: result,
            changes: changes
        };
    }

    // ============================================================
    // UPDATE REFERENCES AFTER ID CHANGES
    // ============================================================

    /**
     * Update references in the candidate state after ID changes.
     * This ensures cross-domain references remain valid after ID reassignment.
     * 
     * NOTE: This is a best-effort update. If a reference points to an ID
     * that was changed, we update it. If a reference points to an ID
     * that doesn't exist in the changes map, we leave it (it will be
     * caught by cross-domain validation).
     * 
     * @param {object} candidate - Candidate state
     * @param {array} changes - Array of ID changes from ensureUniqueIds
     * @returns {object} Updated candidate state
     */
    function updateReferences(candidate, changes) {
        if (!changes || changes.length === 0) {
            return candidate;
        }

        var result = deepClone(candidate);

        // Build ID map: oldId → newId
        var idMap = {};
        for (var i = 0; i < changes.length; i++) {
            var change = changes[i];
            if (change.oldId) {
                idMap[change.oldId] = change.newId;
            }
        }

        // Helper to update a single reference
        function updateRef(value) {
            if (value === null || value === undefined) return value;
            if (typeof value === 'string') {
                var norm = normaliseId(value);
                if (norm && idMap[norm]) {
                    return idMap[norm];
                }
                return value;
            }
            return value;
        }

        // Helper to update references in an array
        function updateArrayRefs(arr) {
            if (!Array.isArray(arr)) return arr;
            var result = [];
            for (var i = 0; i < arr.length; i++) {
                result.push(updateRef(arr[i]));
            }
            return result;
        }

        // ---- Update missions ----
        if (Array.isArray(result.missions)) {
            for (var m = 0; m < result.missions.length; m++) {
                var mission = result.missions[m];
                if (!mission) continue;

                if (mission.assignedTeamId) {
                    mission.assignedTeamId = updateRef(mission.assignedTeamId);
                }
                if (mission.graduatingClassId) {
                    mission.graduatingClassId = updateRef(mission.graduatingClassId);
                }
                if (Array.isArray(mission.supportPersonnel)) {
                    mission.supportPersonnel = updateArrayRefs(mission.supportPersonnel);
                }
            }
        }

        // ---- Update teams ----
        if (Array.isArray(result.teams)) {
            for (var t = 0; t < result.teams.length; t++) {
                var team = result.teams[t];
                if (!team) continue;

                if (team.classId) {
                    team.classId = updateRef(team.classId);
                }
                if (Array.isArray(team.members)) {
                    for (var mem = 0; mem < team.members.length; mem++) {
                        var member = team.members[mem];
                        if (member && member.characterId) {
                            member.characterId = updateRef(member.characterId);
                        }
                    }
                }
            }
        }

        // ---- Update tournaments ----
        if (Array.isArray(result.tournaments)) {
            for (var tourn = 0; tourn < result.tournaments.length; tourn++) {
                var tournament = result.tournaments[tourn];
                if (!tournament) continue;

                if (tournament.graduatingClassId) {
                    tournament.graduatingClassId = updateRef(tournament.graduatingClassId);
                }
                if (Array.isArray(tournament.participants)) {
                    for (var p = 0; p < tournament.participants.length; p++) {
                        var participant = tournament.participants[p];
                        if (participant && participant.id) {
                            participant.id = updateRef(participant.id);
                        }
                    }
                }
                if (tournament.winner && tournament.winner.id) {
                    tournament.winner.id = updateRef(tournament.winner.id);
                }
            }
        }

        // ---- Update characters ----
        if (Array.isArray(result.characters)) {
            for (var ch = 0; ch < result.characters.length; ch++) {
                var character = result.characters[ch];
                if (!character) continue;

                if (Array.isArray(character.classIds)) {
                    character.classIds = updateArrayRefs(character.classIds);
                }
            }
        }

        // ---- Update academy ----
        if (result.academy && typeof result.academy === 'object') {
            // classStudents: classId → [studentIds]
            if (result.academy.classStudents && typeof result.academy.classStudents === 'object') {
                var updatedClassStudents = {};
                for (var clsId in result.academy.classStudents) {
                    if (Object.prototype.hasOwnProperty.call(result.academy.classStudents, clsId)) {
                        var newClsId = updateRef(clsId);
                        var students = result.academy.classStudents[clsId];
                        if (Array.isArray(students)) {
                            updatedClassStudents[newClsId] = updateArrayRefs(students);
                        } else {
                            updatedClassStudents[newClsId] = students;
                        }
                    }
                }
                result.academy.classStudents = updatedClassStudents;
            }

            // grades: gradeId → { studentId, classId, ... }
            if (result.academy.grades && typeof result.academy.grades === 'object') {
                var updatedGrades = {};
                for (var gradeId in result.academy.grades) {
                    if (Object.prototype.hasOwnProperty.call(result.academy.grades, gradeId)) {
                        var grade = result.academy.grades[gradeId];
                        if (grade && typeof grade === 'object') {
                            var newGrade = deepClone(grade);
                            if (newGrade.studentId) {
                                newGrade.studentId = updateRef(newGrade.studentId);
                            }
                            if (newGrade.classId) {
                                newGrade.classId = updateRef(newGrade.classId);
                            }
                            updatedGrades[gradeId] = newGrade;
                        } else {
                            updatedGrades[gradeId] = grade;
                        }
                    }
                }
                result.academy.grades = updatedGrades;
            }

            // rankings: rankId → { studentId, classId, ... }
            if (result.academy.rankings && typeof result.academy.rankings === 'object') {
                var updatedRankings = {};
                for (var rankId in result.academy.rankings) {
                    if (Object.prototype.hasOwnProperty.call(result.academy.rankings, rankId)) {
                        var ranking = result.academy.rankings[rankId];
                        if (ranking && typeof ranking === 'object') {
                            var newRanking = deepClone(ranking);
                            if (newRanking.studentId) {
                                newRanking.studentId = updateRef(newRanking.studentId);
                            }
                            if (newRanking.classId) {
                                newRanking.classId = updateRef(newRanking.classId);
                            }
                            updatedRankings[rankId] = newRanking;
                        } else {
                            updatedRankings[rankId] = ranking;
                        }
                    }
                }
                result.academy.rankings = updatedRankings;
            }
        }

        // ---- Update curriculum ----
        if (result.curriculum && typeof result.curriculum === 'object') {
            // schedules: characterId → schedule
            if (result.curriculum.schedules && typeof result.curriculum.schedules === 'object') {
                var updatedSchedules = {};
                for (var schKey in result.curriculum.schedules) {
                    if (Object.prototype.hasOwnProperty.call(result.curriculum.schedules, schKey)) {
                        var newKey = updateRef(schKey);
                        updatedSchedules[newKey] = result.curriculum.schedules[schKey];
                    }
                }
                result.curriculum.schedules = updatedSchedules;
            }

            // restDays: characterId → restDays
            if (result.curriculum.restDays && typeof result.curriculum.restDays === 'object') {
                var updatedRestDays = {};
                for (var restKey in result.curriculum.restDays) {
                    if (Object.prototype.hasOwnProperty.call(result.curriculum.restDays, restKey)) {
                        var newKey = updateRef(restKey);
                        updatedRestDays[newKey] = result.curriculum.restDays[restKey];
                    }
                }
                result.curriculum.restDays = updatedRestDays;
            }

            // instructorTemplates: instructorId_week → template
            if (result.curriculum.instructorTemplates && typeof result.curriculum.instructorTemplates === 'object') {
                var updatedTemplates = {};
                for (var templKey in result.curriculum.instructorTemplates) {
                    if (Object.prototype.hasOwnProperty.call(result.curriculum.instructorTemplates, templKey)) {
                        var parts = templKey.split('_');
                        if (parts.length >= 2) {
                            var newInstId = updateRef(parts[0]);
                            var newKey = newInstId + '_' + parts.slice(1).join('_');
                            updatedTemplates[newKey] = result.curriculum.instructorTemplates[templKey];
                        } else {
                            updatedTemplates[templKey] = result.curriculum.instructorTemplates[templKey];
                        }
                    }
                }
                result.curriculum.instructorTemplates = updatedTemplates;
            }

            // instructorBlocks: instructorId_week_day_hour → block
            if (result.curriculum.instructorBlocks && typeof result.curriculum.instructorBlocks === 'object') {
                var updatedBlocks = {};
                for (var blockKey in result.curriculum.instructorBlocks) {
                    if (Object.prototype.hasOwnProperty.call(result.curriculum.instructorBlocks, blockKey)) {
                        var parts = blockKey.split('_');
                        if (parts.length >= 2) {
                            var newInstId = updateRef(parts[0]);
                            var newKey = newInstId + '_' + parts.slice(1).join('_');
                            updatedBlocks[newKey] = result.curriculum.instructorBlocks[blockKey];
                        } else {
                            updatedBlocks[blockKey] = result.curriculum.instructorBlocks[blockKey];
                        }
                    }
                }
                result.curriculum.instructorBlocks = updatedBlocks;
            }
        }

        // ---- Update social ----
        if (result.social && typeof result.social === 'object') {
            if (Array.isArray(result.social.relationships)) {
                for (var rel = 0; rel < result.social.relationships.length; rel++) {
                    var relationship = result.social.relationships[rel];
                    if (!relationship) continue;

                    if (relationship.character1) {
                        relationship.character1 = updateRef(relationship.character1);
                    }
                    if (relationship.character2) {
                        relationship.character2 = updateRef(relationship.character2);
                    }
                }
            }
        }

        return result;
    }

    // ============================================================
    // MAIN IMPORT FUNCTIONS
    // ============================================================

    /**
     * Import data from a File object.
     * 
     * @param {File} file - JSON file to import
     * @param {object} options - Import options
     * @param {boolean} options.preserveExistingIds - Preserve existing IDs (default: true)
     * @param {boolean} options.autoFixIds - Automatically fix duplicate/missing IDs (default: true)
     * @param {boolean} options.skipValidation - Skip validation (default: false - NOT RECOMMENDED)
     * @param {string} options.sourceName - Source name for logging (default: 'file')
     * @returns {Promise<object>} Import result
     */
    function importFromFile(file, options) {
        options = options || {};

        if (!file || typeof file !== 'object') {
            return Promise.resolve(createFailureResult(
                ['Invalid file: file must be a File object.'],
                [],
                'Import failed: invalid file'
            ));
        }

        var sourceName = options.sourceName || file.name || 'file';

        return readFileAsText(file)
            .then(function(text) {
                return importFromJSON(text, options);
            })
            .then(function(result) {
                // Add file info to result
                result.details = result.details || {};
                result.details.filename = file.name;
                result.details.fileSize = file.size;
                return result;
            })
            .catch(function(err) {
                return createFailureResult(
                    [err.message || 'Failed to read file.'],
                    [],
                    'Import failed: ' + (err.message || 'Unknown error')
                );
            });
    }

    /**
     * Import data from a JSON string.
     * 
     * @param {string} jsonText - JSON text to import
     * @param {object} options - Import options
     * @returns {Promise<object>} Import result
     */
    function importFromJSON(jsonText, options) {
        options = options || {};

        if (typeof jsonText !== 'string') {
            return Promise.resolve(createFailureResult(
                ['Invalid JSON: must be a string.'],
                [],
                'Import failed: invalid input'
            ));
        }

        try {
            // Parse JSON
            var data = JSON.parse(jsonText);

            // If the parsed data is an envelope, use it directly
            if (data.format && data.format === Schema.FORMAT_NAME) {
                return importFromEnvelope(data, options);
            }

            // Otherwise, treat it as raw data and wrap in an envelope
            var envelope = Envelope.create(data, {
                applicationName: options.applicationName || 'Hollow Manager 2',
                applicationVersion: options.applicationVersion || '2.0.0',
                dataVersion: data._dataVersion || 0,
                exportedBy: options.exportedBy || 'Unknown'
            });

            return importFromEnvelope(envelope, options);

        } catch (err) {
            return Promise.resolve(createFailureResult(
                ['Invalid JSON: ' + (err.message || 'Parse error.')],
                [],
                'Import failed: invalid JSON'
            ));
        }
    }

    /**
     * Import data from an envelope object.
     * 
     * @param {object} envelope - Export envelope to import
     * @param {object} options - Import options
     * @param {boolean} options.preserveExistingIds - Preserve existing IDs (default: true)
     * @param {boolean} options.autoFixIds - Automatically fix duplicate/missing IDs (default: true)
     * @param {boolean} options.skipValidation - Skip validation (default: false - NOT RECOMMENDED)
     * @param {string} options.sourceName - Source name for logging (default: 'envelope')
     * @returns {Promise<object>} Import result
     */
    function importFromEnvelope(envelope, options) {
        options = options || {};
        var preserveExistingIds = options.preserveExistingIds !== false;
        var autoFixIds = options.autoFixIds !== false;
        var skipValidation = options.skipValidation === true;
        var sourceName = options.sourceName || 'envelope';
        var allWarnings = [];

        // ---- STAGE 1: Validate envelope structure ----
        var validation = Envelope.validate(envelope);
        if (!validation.valid) {
            return Promise.resolve(createValidationFailureResult(validation));
        }
        allWarnings = allWarnings.concat(validation.warnings);

        // ---- STAGE 2: Check if migration is needed ----
        var envelopeToImport = envelope;
        if (Migrations.needsMigration(envelope)) {
            try {
                envelopeToImport = Migrations.apply(envelope);
                allWarnings.push('Format migrated from version ' + envelope.formatVersion + ' to ' + Schema.FORMAT_VERSION);
            } catch (err) {
                return Promise.resolve(createFailureResult(
                    ['Migration failed: ' + err.message],
                    [],
                    'Import failed: cannot migrate from version ' + envelope.formatVersion
                ));
            }
        }

        // ---- STAGE 3: Extract data ----
        var extractedData = Envelope.extract(envelopeToImport);

        // ---- STAGE 4: Build candidate state ----
        var candidate = buildCandidateState(extractedData);

        // ---- STAGE 5: Ensure unique IDs ----
        var idResult = ensureUniqueIds(candidate, {
            preserveExistingIds: preserveExistingIds
        });
        candidate = idResult.candidate;
        if (idResult.changes.length > 0) {
            var changeMessages = [];
            for (var i = 0; i < Math.min(idResult.changes.length, 5); i++) {
                var ch = idResult.changes[i];
                changeMessages.push(ch.collection + '[' + ch.index + ']: ' + (ch.oldId || 'null') + ' → ' + ch.newId);
            }
            if (idResult.changes.length > 5) {
                changeMessages.push('... and ' + (idResult.changes.length - 5) + ' more changes');
            }
            allWarnings.push('ID changes applied: ' + changeMessages.join('; '));

            // Update references to reflect ID changes
            candidate = updateReferences(candidate, idResult.changes);
        }

        // ---- STAGE 6: Cross-domain validation ----
        if (!skipValidation) {
            var validatorResult = Validator.validate(candidate);
            allWarnings = allWarnings.concat(validatorResult.warnings);

            if (!validatorResult.valid) {
                return Promise.resolve(createValidationFailureResult(validatorResult));
            }

            // Also check for duplicate IDs (Validator already does this via validateUniqueIds)
        }

        // ---- STAGE 7: Validate required sections have data ----
        var requiredSections = Schema.getRequiredSections();
        var missingSections = [];
        for (var s = 0; s < requiredSections.length; s++) {
            var section = requiredSections[s];
            var data = candidate[section];
            if (!Array.isArray(data) || data.length === 0) {
                missingSections.push(section);
            }
        }
        if (missingSections.length > 0 && missingSections.length < requiredSections.length) {
            allWarnings.push('Missing data in sections: ' + missingSections.join(', '));
        }

        // ---- STAGE 8: Prepare for commit ----
        var finalCandidate = candidate;

        // Get summary
        var summary = getImportSummary(finalCandidate);

        var logMessage = 'Imported data from ' + sourceName + ' (' + summary.totalRecords + ' records)';
        var successMessage = 'Import completed: ' + summary.totalRecords + ' records imported';

        // ---- STAGE 9: Atomic commit via MutationPipeline ----
        return new Promise(function(resolve) {
            MutationPipeline.performMutation({
                validate: function() {
                    // Final validation before commit
                    if (!skipValidation) {
                        var finalValidation = Validator.validate(finalCandidate);
                        if (!finalValidation.valid) {
                            return {
                                valid: false,
                                message: 'Validation failed before commit: ' + finalValidation.errors.length + ' error(s).'
                            };
                        }
                    }
                    return { valid: true };
                },
                mutate: function(data) {
                    // Root-preserving replacement
                    var keys = Object.keys(data);
                    for (var i = 0; i < keys.length; i++) {
                        delete data[keys[i]];
                    }

                    var candidateKeys = Object.keys(finalCandidate);
                    for (var j = 0; j < candidateKeys.length; j++) {
                        data[candidateKeys[j]] = finalCandidate[candidateKeys[j]];
                    }
                },
                logMessage: logMessage,
                successMessage: successMessage,
                failureMessage: 'Import failed during persistence.',
                skipNotification: options.skipNotification === true
            }).then(function(result) {
                if (result.success) {
                    // Log the import via ActivityLog
                    try {
                        ActivityLog.record(logMessage, 'import');
                    } catch (logErr) {
                        // Non-fatal
                    }

                    resolve(createSuccessResult(
                        successMessage,
                        {
                            summary: summary,
                            warnings: allWarnings,
                            idChanges: idResult.changes,
                            originalVersion: envelope.formatVersion,
                            migratedVersion: envelopeToImport.formatVersion
                        }
                    ));
                } else {
                    resolve(createFailureResult(
                        [result.message || 'Unknown error during commit.'],
                        allWarnings,
                        'Import failed: ' + (result.message || 'Unknown error')
                    ));
                }
            });
        });
    }

    // ============================================================
    // IMPORT SUMMARY
    // ============================================================

    /**
     * Get a summary of the imported data.
     * 
     * @param {object} candidate - Candidate state
     * @returns {object} Summary information
     */
    function getImportSummary(candidate) {
        if (!candidate || typeof candidate !== 'object') {
            return {
                totalRecords: 0,
                sections: {}
            };
        }

        var sections = {};
        var total = 0;

        var allSections = Schema.getSections();
        for (var i = 0; i < allSections.length; i++) {
            var section = allSections[i];
            var data = candidate[section];
            if (Array.isArray(data)) {
                sections[section] = data.length;
                total += data.length;
            } else if (data && typeof data === 'object') {
                var count = 0;
                for (var key in data) {
                    if (Object.prototype.hasOwnProperty.call(data, key)) {
                        count++;
                    }
                }
                sections[section] = count;
                total += count;
            } else {
                sections[section] = 'present';
            }
        }

        return {
            totalRecords: total,
            sections: sections,
            hasData: total > 0,
            currentYear: candidate.currentYear,
            currentWeek: candidate.currentWeek
        };
    }

    /**
     * Get a display summary for the import result.
     * 
     * @param {object} result - Import result
     * @returns {string} Human-readable summary
     */
    function getDisplaySummary(result) {
        if (!result || typeof result !== 'object') {
            return 'Invalid result';
        }

        if (!result.success) {
            var errorMsg = result.message || 'Import failed';
            if (result.errors && result.errors.length > 0) {
                errorMsg += ': ' + result.errors.slice(0, 3).join('; ');
                if (result.errors.length > 3) {
                    errorMsg += ' (+ ' + (result.errors.length - 3) + ' more)';
                }
            }
            return errorMsg;
        }

        var details = result.details || {};
        var summary = details.summary || {};

        var parts = [];
        if (summary.totalRecords !== undefined) {
            parts.push(summary.totalRecords + ' records');
        }
        if (summary.sections) {
            var sectionParts = [];
            for (var key in summary.sections) {
                if (Object.prototype.hasOwnProperty.call(summary.sections, key)) {
                    var count = summary.sections[key];
                    if (typeof count === 'number') {
                        sectionParts.push(key + ': ' + count);
                    }
                }
            }
            if (sectionParts.length > 0) {
                parts.push('(' + sectionParts.join(', ') + ')');
            }
        }

        var warnings = result.warnings || [];
        if (warnings.length > 0) {
            parts.push(warnings.length + ' warnings');
        }

        return 'Import completed: ' + parts.join(' ');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ImportPipeline = {
        // ---- Main import functions ----
        importFromFile: importFromFile,
        importFromJSON: importFromJSON,
        importFromEnvelope: importFromEnvelope,

        // ---- Candidate state building ----
        buildCandidateState: buildCandidateState,
        ensureUniqueIds: ensureUniqueIds,
        updateReferences: updateReferences,

        // ---- Summaries ----
        getImportSummary: getImportSummary,
        getDisplaySummary: getDisplaySummary,

        // ---- Utilities ----
        readFileAsText: readFileAsText
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.ImportPipeline;
        var missing = [];

        var required = [
            'importFromFile',
            'importFromJSON',
            'importFromEnvelope',
            'buildCandidateState',
            'ensureUniqueIds',
            'updateReferences',
            'getImportSummary',
            'getDisplaySummary'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[ImportPipeline] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[ImportPipeline] All exports verified successfully.');
        }
    })();

})();
