/**
 * js/import-export/cross-domain-validator.js - Cross-Domain Validator
 * Validates reference integrity within a candidate application state.
 * 
 * This module checks that all cross-domain references in the candidate state
 * resolve to existing entities within the same candidate state.
 * 
 * IMPORTANT:
 *   - Validates AGAINST THE CANDIDATE STATE, not the live application
 *   - Checks reference integrity, NOT business rules
 *   - Business rules belong in domain modules (MissionRules, TournamentRules, etc.)
 *   - PURE functions - no side effects, no mutations
 *   - No persistence, no DOM, no state
 *   - Returns structured validation results with errors and warnings
 * 
 * WHAT IT VALIDATES:
 *   - Missions → Teams (assignedTeamId)
 *   - Missions → Characters (supportPersonnel)
 *   - Missions → Classes (graduatingClassId)
 *   - Teams → Characters (members.characterId)
 *   - Teams → Classes (classId for academic teams)
 *   - Tournaments → Characters/Teams (participants)
 *   - Tournaments → Classes (graduatingClassId)
 *   - Academy → Characters (classStudents)
 *   - Academy → Classes (grades, rankings)
 *   - Characters → Classes (classIds)
 *   - Curriculum → Characters (schedules, restDays, instructor references)
 *   - Social → Characters (relationships)
 * 
 * WHAT IT DOES NOT VALIDATE:
 *   - Domain business rules (e.g., "Can this character be in this class?")
 *   - Data format validity (handled by domain schemas)
 *   - Enum value validity (handled by domain schemas)
 *   - Required field presence (handled by domain schemas)
 * 
 * DEPENDENCIES:
 *   - window.IdUtils (for ID normalisation) - MANDATORY
 *   - window.ExportSchema (for section definitions) - MANDATORY
 * 
 * USAGE:
 *   var Validator = window.CrossDomainValidator;
 *   
 *   var candidate = buildCandidateState(importedData);
 *   var result = Validator.validate(candidate);
 *   if (!result.valid) {
 *       // Handle errors
 *   }
 * 
 *   // Validate specific references
 *   var errors = Validator.validateMissionReferences(candidate);
 *   var errors = Validator.validateTeamReferences(candidate);
 */

(function() {
    'use strict';

    if (window.__crossDomainValidatorLoaded) return;
    window.__crossDomainValidatorLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.IdUtils || typeof window.IdUtils.normaliseId !== 'function') {
        throw new Error('[CrossDomainValidator] IdUtils.normaliseId is required.');
    }

    if (!window.ExportSchema) {
        throw new Error('[CrossDomainValidator] ExportSchema is required.');
    }

    var IdUtils = window.IdUtils;
    var Schema = window.ExportSchema;

    // ============================================================
    // HELPERS
    // ============================================================

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isArray(value) {
        return Array.isArray(value);
    }

    function findById(collection, id) {
        if (!isArray(collection)) return null;
        var target = normaliseId(id);
        if (target === '') return null;
        for (var i = 0; i < collection.length; i++) {
            var item = collection[i];
            if (item && normaliseId(item.id) === target) {
                return item;
            }
        }
        return null;
    }

    function existsInCollection(collection, id) {
        return findById(collection, id) !== null;
    }

    function getIds(collection) {
        if (!isArray(collection)) return {};
        var ids = {};
        for (var i = 0; i < collection.length; i++) {
            var item = collection[i];
            if (item && item.id) {
                ids[normaliseId(item.id)] = true;
            }
        }
        return ids;
    }

    function createError(section, entityId, field, targetId, message) {
        return {
            section: section,
            entityId: entityId,
            field: field,
            targetId: targetId,
            message: message
        };
    }

    function createWarning(section, entityId, field, targetId, message) {
        return {
            section: section,
            entityId: entityId,
            field: field,
            targetId: targetId,
            message: message
        };
    }

    // ============================================================
    // MISSION REFERENCE VALIDATION
    // ============================================================

    /**
     * Validate mission references against candidate state.
     * 
     * Checks:
     *   - assignedTeamId → teams
     *   - supportPersonnel → characters
     *   - graduatingClassId → academy.graduatingClasses
     * 
     * @param {object} candidate - Candidate application state
     * @returns {object} { errors: array, warnings: array }
     */
    function validateMissionReferences(candidate) {
        var errors = [];
        var warnings = [];

        var missions = candidate.missions || [];
        var teams = candidate.teams || [];
        var characters = candidate.characters || [];
        var graduatingClasses = candidate.academy?.graduatingClasses || {};

        var teamIds = getIds(teams);
        var characterIds = getIds(characters);
        var classIds = {};
        for (var clsId in graduatingClasses) {
            if (Object.prototype.hasOwnProperty.call(graduatingClasses, clsId)) {
                classIds[normaliseId(clsId)] = true;
            }
        }

        for (var i = 0; i < missions.length; i++) {
            var mission = missions[i];
            if (!mission || typeof mission !== 'object') continue;

            var missionId = mission.id || 'unknown';

            // Check assignedTeamId
            if (mission.assignedTeamId) {
                var teamId = normaliseId(mission.assignedTeamId);
                if (teamId && !teamIds[teamId]) {
                    errors.push(createError(
                        'missions',
                        missionId,
                        'assignedTeamId',
                        mission.assignedTeamId,
                        'Mission references non-existent team: ' + mission.assignedTeamId
                    ));
                }
            }

            // Check supportPersonnel
            if (Array.isArray(mission.supportPersonnel)) {
                for (var j = 0; j < mission.supportPersonnel.length; j++) {
                    var charId = normaliseId(mission.supportPersonnel[j]);
                    if (charId && !characterIds[charId]) {
                        errors.push(createError(
                            'missions',
                            missionId,
                            'supportPersonnel',
                            mission.supportPersonnel[j],
                            'Mission references non-existent character: ' + mission.supportPersonnel[j]
                        ));
                    }
                }
            }

            // Check graduatingClassId
            if (mission.graduatingClassId) {
                var classId = normaliseId(mission.graduatingClassId);
                if (classId && !classIds[classId]) {
                    errors.push(createError(
                        'missions',
                        missionId,
                        'graduatingClassId',
                        mission.graduatingClassId,
                        'Mission references non-existent graduating class: ' + mission.graduatingClassId
                    ));
                }
            }
        }

        return { errors: errors, warnings: warnings };
    }

    // ============================================================
    // TEAM REFERENCE VALIDATION
    // ============================================================

    /**
     * Validate team references against candidate state.
     * 
     * Checks:
     *   - members.characterId → characters
     *   - classId → academy.graduatingClasses (for academic teams)
     * 
     * @param {object} candidate - Candidate application state
     * @returns {object} { errors: array, warnings: array }
     */
    function validateTeamReferences(candidate) {
        var errors = [];
        var warnings = [];

        var teams = candidate.teams || [];
        var characters = candidate.characters || [];
        var graduatingClasses = candidate.academy?.graduatingClasses || {};

        var characterIds = getIds(characters);
        var classIds = {};
        for (var clsId in graduatingClasses) {
            if (Object.prototype.hasOwnProperty.call(graduatingClasses, clsId)) {
                classIds[normaliseId(clsId)] = true;
            }
        }

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') continue;

            var teamId = team.id || 'unknown';

            // Check members
            if (Array.isArray(team.members)) {
                for (var j = 0; j < team.members.length; j++) {
                    var member = team.members[j];
                    if (!member || typeof member !== 'object') continue;

                    var charId = normaliseId(member.characterId);
                    if (charId && !characterIds[charId]) {
                        errors.push(createError(
                            'teams',
                            teamId,
                            'members.characterId',
                            member.characterId,
                            'Team member references non-existent character: ' + member.characterId
                        ));
                    }
                }
            }

            // Check classId for academic teams
            if (team.type === 'academic' && team.classId) {
                var classId = normaliseId(team.classId);
                if (classId && !classIds[classId]) {
                    errors.push(createError(
                        'teams',
                        teamId,
                        'classId',
                        team.classId,
                        'Academic team references non-existent class: ' + team.classId
                    ));
                }
            }
        }

        return { errors: errors, warnings: warnings };
    }

    // ============================================================
    // TOURNAMENT REFERENCE VALIDATION
    // ============================================================

    /**
     * Validate tournament references against candidate state.
     * 
     * Checks:
     *   - participants → characters/teams
     *   - graduatingClassId → academy.graduatingClasses
     *   - winner → characters/teams
     *   - match participants → tournament participants
     * 
     * @param {object} candidate - Candidate application state
     * @returns {object} { errors: array, warnings: array }
     */
    function validateTournamentReferences(candidate) {
        var errors = [];
        var warnings = [];

        var tournaments = candidate.tournaments || [];
        var characters = candidate.characters || [];
        var teams = candidate.teams || [];
        var graduatingClasses = candidate.academy?.graduatingClasses || {};

        var characterIds = getIds(characters);
        var teamIds = getIds(teams);
        var classIds = {};
        for (var clsId in graduatingClasses) {
            if (Object.prototype.hasOwnProperty.call(graduatingClasses, clsId)) {
                classIds[normaliseId(clsId)] = true;
            }
        }

        for (var i = 0; i < tournaments.length; i++) {
            var tournament = tournaments[i];
            if (!tournament || typeof tournament !== 'object') continue;

            var tournamentId = tournament.id || 'unknown';

            // Get participant IDs for this tournament
            var participantIds = {};
            if (Array.isArray(tournament.participants)) {
                for (var j = 0; j < tournament.participants.length; j++) {
                    var p = tournament.participants[j];
                    if (p && p.id) {
                        var pId = normaliseId(p.id);
                        if (pId) {
                            participantIds[pId] = true;
                            participantIds[pId + '_type'] = p.type || 'unknown';
                        }
                    }
                }
            }

            // Check participants exist
            if (Array.isArray(tournament.participants)) {
                for (var k = 0; k < tournament.participants.length; k++) {
                    var participant = tournament.participants[k];
                    if (!participant || typeof participant !== 'object') continue;

                    var pId = normaliseId(participant.id);
                    if (!pId) continue;

                    var pType = participant.type || 'unknown';

                    if (pType === 'character' && !characterIds[pId]) {
                        errors.push(createError(
                            'tournaments',
                            tournamentId,
                            'participants',
                            participant.id,
                            'Tournament participant references non-existent character: ' + participant.id
                        ));
                    } else if (pType === 'team' && !teamIds[pId]) {
                        errors.push(createError(
                            'tournaments',
                            tournamentId,
                            'participants',
                            participant.id,
                            'Tournament participant references non-existent team: ' + participant.id
                        ));
                    } else if (pType !== 'character' && pType !== 'team') {
                        warnings.push(createWarning(
                            'tournaments',
                            tournamentId,
                            'participants',
                            participant.id,
                            'Tournament participant has unknown type "' + pType + '"'
                        ));
                    }
                }
            }

            // Check winner
            if (tournament.winner && typeof tournament.winner === 'object') {
                var winnerId = normaliseId(tournament.winner.id);
                var winnerType = tournament.winner.type || 'unknown';

                if (winnerId) {
                    if (winnerType === 'character' && !characterIds[winnerId]) {
                        errors.push(createError(
                            'tournaments',
                            tournamentId,
                            'winner',
                            tournament.winner.id,
                            'Tournament winner references non-existent character: ' + tournament.winner.id
                        ));
                    } else if (winnerType === 'team' && !teamIds[winnerId]) {
                        errors.push(createError(
                            'tournaments',
                            tournamentId,
                            'winner',
                            tournament.winner.id,
                            'Tournament winner references non-existent team: ' + tournament.winner.id
                        ));
                    } else if (winnerType !== 'character' && winnerType !== 'team') {
                        warnings.push(createWarning(
                            'tournaments',
                            tournamentId,
                            'winner',
                            tournament.winner.id,
                            'Tournament winner has unknown type "' + winnerType + '"'
                        ));
                    }

                    // Check winner is in participants
                    if (winnerId && !participantIds[winnerId]) {
                        warnings.push(createWarning(
                            'tournaments',
                            tournamentId,
                            'winner',
                            tournament.winner.id,
                            'Tournament winner is not in participants list'
                        ));
                    }
                }
            }

            // Check graduatingClassId
            if (tournament.graduatingClassId) {
                var classId = normaliseId(tournament.graduatingClassId);
                if (classId && !classIds[classId]) {
                    errors.push(createError(
                        'tournaments',
                        tournamentId,
                        'graduatingClassId',
                        tournament.graduatingClassId,
                        'Tournament references non-existent graduating class: ' + tournament.graduatingClassId
                    ));
                }
            }

            // Check matches participants
            if (Array.isArray(tournament.rounds)) {
                for (var r = 0; r < tournament.rounds.length; r++) {
                    var round = tournament.rounds[r];
                    if (!round || typeof round !== 'object') continue;

                    if (Array.isArray(round.matches)) {
                        for (var m = 0; m < round.matches.length; m++) {
                            var match = round.matches[m];
                            if (!match || typeof match !== 'object') continue;

                            // Check match participants
                            if (Array.isArray(match.participants)) {
                                for (var mp = 0; mp < match.participants.length; mp++) {
                                    var mpId = normaliseId(match.participants[mp]);
                                    if (mpId && !participantIds[mpId]) {
                                        warnings.push(createWarning(
                                            'tournaments',
                                            tournamentId,
                                            'rounds.' + r + '.matches.' + m + '.participants',
                                            match.participants[mp],
                                            'Match participant is not in tournament participants list'
                                        ));
                                    }
                                }
                            }

                            // Check winner
                            if (match.winner) {
                                var matchWinnerId = normaliseId(match.winner);
                                if (matchWinnerId && !participantIds[matchWinnerId]) {
                                    warnings.push(createWarning(
                                        'tournaments',
                                        tournamentId,
                                        'rounds.' + r + '.matches.' + m + '.winner',
                                        match.winner,
                                        'Match winner is not in tournament participants list'
                                    ));
                                }
                            }

                            // Check loser
                            if (match.loser) {
                                var matchLoserId = normaliseId(match.loser);
                                if (matchLoserId && !participantIds[matchLoserId]) {
                                    warnings.push(createWarning(
                                        'tournaments',
                                        tournamentId,
                                        'rounds.' + r + '.matches.' + m + '.loser',
                                        match.loser,
                                        'Match loser is not in tournament participants list'
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        return { errors: errors, warnings: warnings };
    }

    // ============================================================
    // ACADEMY REFERENCE VALIDATION
    // ============================================================

    /**
     * Validate academy references against candidate state.
     * 
     * Checks:
     *   - classStudents → characters
     *   - grades.studentId → characters
     *   - grades.classId → graduatingClasses
     *   - rankings.studentId → characters
     *   - rankings.classId → graduatingClasses
     * 
     * @param {object} candidate - Candidate application state
     * @returns {object} { errors: array, warnings: array }
     */
    function validateAcademyReferences(candidate) {
        var errors = [];
        var warnings = [];

        var academy = candidate.academy || {};
        var characters = candidate.characters || [];
        var classes = candidate.classes || [];

        var characterIds = getIds(characters);
        var classIds = {};
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && cls.id) {
                classIds[normaliseId(cls.id)] = true;
            }
        }

        // Also include graduating classes from academy
        var graduatingClasses = academy.graduatingClasses || {};
        for (var clsId in graduatingClasses) {
            if (Object.prototype.hasOwnProperty.call(graduatingClasses, clsId)) {
                classIds[normaliseId(clsId)] = true;
            }
        }

        // ---- Check classStudents ----
        var classStudents = academy.classStudents || {};
        for (var classId in classStudents) {
            if (Object.prototype.hasOwnProperty.call(classStudents, classId)) {
                var students = classStudents[classId];
                if (!Array.isArray(students)) continue;

                var classIdNorm = normaliseId(classId);
                if (classIdNorm && !classIds[classIdNorm]) {
                    // This could be a graduating class that only exists in classStudents
                    // We'll check if it exists in graduatingClasses
                    if (!graduatingClasses[classId]) {
                        warnings.push(createWarning(
                            'academy.classStudents',
                            classId,
                            'classId',
                            classId,
                            'Class referenced in classStudents does not exist in graduatingClasses'
                        ));
                    }
                }

                for (var s = 0; s < students.length; s++) {
                    var studentId = normaliseId(students[s]);
                    if (studentId && !characterIds[studentId]) {
                        errors.push(createError(
                            'academy.classStudents',
                            classId,
                            'students',
                            students[s],
                            'Class student references non-existent character: ' + students[s]
                        ));
                    }
                }
            }
        }

        // ---- Check grades ----
        var grades = academy.grades || {};
        for (var gradeId in grades) {
            if (Object.prototype.hasOwnProperty.call(grades, gradeId)) {
                var grade = grades[gradeId];
                if (!grade || typeof grade !== 'object') continue;

                if (grade.studentId) {
                    var gStudentId = normaliseId(grade.studentId);
                    if (gStudentId && !characterIds[gStudentId]) {
                        errors.push(createError(
                            'academy.grades',
                            gradeId,
                            'studentId',
                            grade.studentId,
                            'Grade references non-existent student: ' + grade.studentId
                        ));
                    }
                }

                if (grade.classId) {
                    var gClassId = normaliseId(grade.classId);
                    if (gClassId && !classIds[gClassId]) {
                        warnings.push(createWarning(
                            'academy.grades',
                            gradeId,
                            'classId',
                            grade.classId,
                            'Grade references non-existent class: ' + grade.classId
                        ));
                    }
                }
            }
        }

        // ---- Check rankings ----
        var rankings = academy.rankings || {};
        for (var rankId in rankings) {
            if (Object.prototype.hasOwnProperty.call(rankings, rankId)) {
                var ranking = rankings[rankId];
                if (!ranking || typeof ranking !== 'object') continue;

                if (ranking.studentId) {
                    var rStudentId = normaliseId(ranking.studentId);
                    if (rStudentId && !characterIds[rStudentId]) {
                        errors.push(createError(
                            'academy.rankings',
                            rankId,
                            'studentId',
                            ranking.studentId,
                            'Ranking references non-existent student: ' + ranking.studentId
                        ));
                    }
                }

                if (ranking.classId) {
                    var rClassId = normaliseId(ranking.classId);
                    if (rClassId && !classIds[rClassId]) {
                        warnings.push(createWarning(
                            'academy.rankings',
                            rankId,
                            'classId',
                            ranking.classId,
                            'Ranking references non-existent class: ' + ranking.classId
                        ));
                    }
                }
            }
        }

        return { errors: errors, warnings: warnings };
    }

    // ============================================================
    // CHARACTER REFERENCE VALIDATION
    // ============================================================

    /**
     * Validate character references against candidate state.
     * 
     * Checks:
     *   - classIds → academy.graduatingClasses / classes
     * 
     * @param {object} candidate - Candidate application state
     * @returns {object} { errors: array, warnings: array }
     */
    function validateCharacterReferences(candidate) {
        var errors = [];
        var warnings = [];

        var characters = candidate.characters || [];
        var classes = candidate.classes || [];
        var graduatingClasses = candidate.academy?.graduatingClasses || {};

        var classIds = {};
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && cls.id) {
                classIds[normaliseId(cls.id)] = true;
            }
        }
        for (var clsId in graduatingClasses) {
            if (Object.prototype.hasOwnProperty.call(graduatingClasses, clsId)) {
                classIds[normaliseId(clsId)] = true;
            }
        }

        for (var j = 0; j < characters.length; j++) {
            var character = characters[j];
            if (!character || typeof character !== 'object') continue;

            var charId = character.id || 'unknown';

            if (Array.isArray(character.classIds)) {
                for (var k = 0; k < character.classIds.length; k++) {
                    var classId = normaliseId(character.classIds[k]);
                    if (classId && !classIds[classId]) {
                        warnings.push(createWarning(
                            'characters',
                            charId,
                            'classIds',
                            character.classIds[k],
                            'Character references non-existent class: ' + character.classIds[k]
                        ));
                    }
                }
            }
        }

        return { errors: errors, warnings: warnings };
    }

    // ============================================================
    // CURRICULUM REFERENCE VALIDATION
    // ============================================================

    /**
     * Validate curriculum references against candidate state.
     * 
     * Checks:
     *   - schedules → characters
     *   - restDays → characters
     *   - instructorTemplates → characters
     *   - instructorBlocks → characters
     *   - instructorClasses → characters
     * 
     * @param {object} candidate - Candidate application state
     * @returns {object} { errors: array, warnings: array }
     */
    function validateCurriculumReferences(candidate) {
        var errors = [];
        var warnings = [];

        var curriculum = candidate.curriculum || {};
        var characters = candidate.characters || [];

        var characterIds = getIds(characters);

        // ---- Check schedules ----
        var schedules = curriculum.schedules || {};
        for (var scheduleKey in schedules) {
            if (Object.prototype.hasOwnProperty.call(schedules, scheduleKey)) {
                // The key is the character ID
                var charId = normaliseId(scheduleKey);
                if (charId && !characterIds[charId]) {
                    warnings.push(createWarning(
                        'curriculum.schedules',
                        scheduleKey,
                        'characterId',
                        scheduleKey,
                        'Schedule references non-existent character: ' + scheduleKey
                    ));
                }
            }
        }

        // ---- Check restDays ----
        var restDays = curriculum.restDays || {};
        for (var restKey in restDays) {
            if (Object.prototype.hasOwnProperty.call(restDays, restKey)) {
                var charId = normaliseId(restKey);
                if (charId && !characterIds[charId]) {
                    warnings.push(createWarning(
                        'curriculum.restDays',
                        restKey,
                        'characterId',
                        restKey,
                        'Rest days references non-existent character: ' + restKey
                    ));
                }
            }
        }

        // ---- Check instructorTemplates ----
        var instructorTemplates = curriculum.instructorTemplates || {};
        for (var instKey in instructorTemplates) {
            if (Object.prototype.hasOwnProperty.call(instructorTemplates, instKey)) {
                // Key format: instructorId_week
                // Try to extract instructor ID
                var parts = instKey.split('_');
                if (parts.length >= 2) {
                    var instId = normaliseId(parts[0]);
                    if (instId && !characterIds[instId]) {
                        warnings.push(createWarning(
                            'curriculum.instructorTemplates',
                            instKey,
                            'instructorId',
                            parts[0],
                            'Instructor template references non-existent instructor: ' + parts[0]
                        ));
                    }
                }
            }
        }

        // ---- Check instructorBlocks ----
        var instructorBlocks = curriculum.instructorBlocks || {};
        for (var blockKey in instructorBlocks) {
            if (Object.prototype.hasOwnProperty.call(instructorBlocks, blockKey)) {
                var parts = blockKey.split('_');
                if (parts.length >= 2) {
                    var instId = normaliseId(parts[0]);
                    if (instId && !characterIds[instId]) {
                        warnings.push(createWarning(
                            'curriculum.instructorBlocks',
                            blockKey,
                            'instructorId',
                            parts[0],
                            'Instructor block references non-existent instructor: ' + parts[0]
                        ));
                    }
                }
            }
        }

        // ---- Check instructorClasses ----
        var instructorClasses = curriculum.instructorClasses || {};
        for (var icKey in instructorClasses) {
            if (Object.prototype.hasOwnProperty.call(instructorClasses, icKey)) {
                var parts = icKey.split('_');
                if (parts.length >= 2) {
                    var instId = normaliseId(parts[0]);
                    if (instId && !characterIds[instId]) {
                        warnings.push(createWarning(
                            'curriculum.instructorClasses',
                            icKey,
                            'instructorId',
                            parts[0],
                            'Instructor class references non-existent instructor: ' + parts[0]
                        ));
                    }
                }
            }
        }

        return { errors: errors, warnings: warnings };
    }

    // ============================================================
    // SOCIAL REFERENCE VALIDATION
    // ============================================================

    /**
     * Validate social references against candidate state.
     * 
     * Checks:
     *   - relationships.character1 → characters
     *   - relationships.character2 → characters
     * 
     * @param {object} candidate - Candidate application state
     * @returns {object} { errors: array, warnings: array }
     */
    function validateSocialReferences(candidate) {
        var errors = [];
        var warnings = [];

        var social = candidate.social || {};
        var characters = candidate.characters || [];

        var characterIds = getIds(characters);

        if (Array.isArray(social.relationships)) {
            for (var i = 0; i < social.relationships.length; i++) {
                var rel = social.relationships[i];
                if (!rel || typeof rel !== 'object') continue;

                var relId = rel.id || 'unknown';

                if (rel.character1) {
                    var c1 = normaliseId(rel.character1);
                    if (c1 && !characterIds[c1]) {
                        errors.push(createError(
                            'social.relationships',
                            relId,
                            'character1',
                            rel.character1,
                            'Relationship references non-existent character: ' + rel.character1
                        ));
                    }
                }

                if (rel.character2) {
                    var c2 = normaliseId(rel.character2);
                    if (c2 && !characterIds[c2]) {
                        errors.push(createError(
                            'social.relationships',
                            relId,
                            'character2',
                            rel.character2,
                            'Relationship references non-existent character: ' + rel.character2
                        ));
                    }
                }
            }
        }

        return { errors: errors, warnings: warnings };
    }

    // ============================================================
    // LOCATION SCHEDULE REFERENCE VALIDATION
    // ============================================================

    /**
     * Validate location schedule references.
     * 
     * Checks:
     *   - locationSchedules → locations
     * 
     * @param {object} candidate - Candidate application state
     * @returns {object} { errors: array, warnings: array }
     */
    function validateLocationScheduleReferences(candidate) {
        var errors = [];
        var warnings = [];

        var locationSchedules = candidate.locationSchedules || {};
        var locations = candidate.locations || [];

        var locationIds = getIds(locations);

        for (var key in locationSchedules) {
            if (Object.prototype.hasOwnProperty.call(locationSchedules, key)) {
                var locId = normaliseId(key);
                if (locId && !locationIds[locId]) {
                    warnings.push(createWarning(
                        'locationSchedules',
                        key,
                        'locationId',
                        key,
                        'Location schedule references non-existent location: ' + key
                    ));
                }
            }
        }

        return { errors: errors, warnings: warnings };
    }

    // ============================================================
    // COMPLETE VALIDATION
    // ============================================================

    /**
     * Validate all cross-domain references in a candidate state.
     * 
     * @param {object} candidate - Candidate application state
     * @param {object} options - Validation options
     * @param {boolean} options.includeWarnings - Include warnings (default: true)
     * @param {array} options.sections - Sections to validate (default: all)
     * @returns {object} { valid: boolean, errors: array, warnings: array, summary: object }
     */
    function validate(candidate, options) {
        options = options || {};
        var includeWarnings = options.includeWarnings !== false;

        if (!candidate || typeof candidate !== 'object') {
            return {
                valid: false,
                errors: ['Candidate state must be an object.'],
                warnings: [],
                summary: { totalErrors: 1, totalWarnings: 0, valid: false }
            };
        }

        var allErrors = [];
        var allWarnings = [];

        var sections = options.sections || [
            'missions',
            'teams',
            'tournaments',
            'academy',
            'characters',
            'curriculum',
            'social',
            'locationSchedules'
        ];

        var hasSection = function(name) {
            return sections.indexOf(name) !== -1;
        };

        // ---- Run validations ----
        if (hasSection('missions') && candidate.missions) {
            var missionResult = validateMissionReferences(candidate);
            allErrors = allErrors.concat(missionResult.errors);
            if (includeWarnings) {
                allWarnings = allWarnings.concat(missionResult.warnings);
            }
        }

        if (hasSection('teams') && candidate.teams) {
            var teamResult = validateTeamReferences(candidate);
            allErrors = allErrors.concat(teamResult.errors);
            if (includeWarnings) {
                allWarnings = allWarnings.concat(teamResult.warnings);
            }
        }

        if (hasSection('tournaments') && candidate.tournaments) {
            var tournamentResult = validateTournamentReferences(candidate);
            allErrors = allErrors.concat(tournamentResult.errors);
            if (includeWarnings) {
                allWarnings = allWarnings.concat(tournamentResult.warnings);
            }
        }

        if (hasSection('academy') && candidate.academy) {
            var academyResult = validateAcademyReferences(candidate);
            allErrors = allErrors.concat(academyResult.errors);
            if (includeWarnings) {
                allWarnings = allWarnings.concat(academyResult.warnings);
            }
        }

        if (hasSection('characters') && candidate.characters) {
            var characterResult = validateCharacterReferences(candidate);
            allErrors = allErrors.concat(characterResult.errors);
            if (includeWarnings) {
                allWarnings = allWarnings.concat(characterResult.warnings);
            }
        }

        if (hasSection('curriculum') && candidate.curriculum) {
            var curriculumResult = validateCurriculumReferences(candidate);
            allErrors = allErrors.concat(curriculumResult.errors);
            if (includeWarnings) {
                allWarnings = allWarnings.concat(curriculumResult.warnings);
            }
        }

        if (hasSection('social') && candidate.social) {
            var socialResult = validateSocialReferences(candidate);
            allErrors = allErrors.concat(socialResult.errors);
            if (includeWarnings) {
                allWarnings = allWarnings.concat(socialResult.warnings);
            }
        }

        if (hasSection('locationSchedules') && candidate.locationSchedules) {
            var locationResult = validateLocationScheduleReferences(candidate);
            allErrors = allErrors.concat(locationResult.errors);
            if (includeWarnings) {
                allWarnings = allWarnings.concat(locationResult.warnings);
            }
        }

        // ---- Check for duplicate IDs within collections ----
        var duplicateErrors = validateUniqueIds(candidate);
        allErrors = allErrors.concat(duplicateErrors);

        return {
            valid: allErrors.length === 0,
            errors: allErrors,
            warnings: allWarnings,
            summary: {
                totalErrors: allErrors.length,
                totalWarnings: allWarnings.length,
                valid: allErrors.length === 0
            }
        };
    }

    // ============================================================
    // DUPLICATE ID VALIDATION
    // ============================================================

    /**
     * Check for duplicate IDs within collections.
     * 
     * @param {object} candidate - Candidate application state
     * @returns {array} Array of error objects
     */
    function validateUniqueIds(candidate) {
        var errors = [];

        var collections = [
            { name: 'characters', data: candidate.characters },
            { name: 'teams', data: candidate.teams },
            { name: 'tournaments', data: candidate.tournaments },
            { name: 'missions', data: candidate.missions },
            { name: 'classes', data: candidate.classes },
            { name: 'locations', data: candidate.locations }
        ];

        for (var i = 0; i < collections.length; i++) {
            var collection = collections[i];
            if (!Array.isArray(collection.data)) continue;

            var seenIds = {};
            for (var j = 0; j < collection.data.length; j++) {
                var item = collection.data[j];
                if (!item || typeof item !== 'object') continue;

                var id = normaliseId(item.id);
                if (id === '') continue;

                if (seenIds[id]) {
                    errors.push(createError(
                        collection.name,
                        id,
                        'id',
                        id,
                        'Duplicate ID "' + id + '" found in ' + collection.name
                    ));
                } else {
                    seenIds[id] = true;
                }
            }
        }

        return errors;
    }

    // ============================================================
    // SECTION-SPECIFIC VALIDATION (public exports)
    // ============================================================

    /**
     * Validate only mission references.
     */
    function validateMissions(candidate) {
        return validateMissionReferences(candidate);
    }

    /**
     * Validate only team references.
     */
    function validateTeams(candidate) {
        return validateTeamReferences(candidate);
    }

    /**
     * Validate only tournament references.
     */
    function validateTournaments(candidate) {
        return validateTournamentReferences(candidate);
    }

    /**
     * Validate only academy references.
     */
    function validateAcademy(candidate) {
        return validateAcademyReferences(candidate);
    }

    /**
     * Validate only character references.
     */
    function validateCharacters(candidate) {
        return validateCharacterReferences(candidate);
    }

    /**
     * Validate only curriculum references.
     */
    function validateCurriculum(candidate) {
        return validateCurriculumReferences(candidate);
    }

    /**
     * Validate only social references.
     */
    function validateSocial(candidate) {
        return validateSocialReferences(candidate);
    }

    /**
     * Validate only location schedule references.
     */
    function validateLocationSchedules(candidate) {
        return validateLocationScheduleReferences(candidate);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CrossDomainValidator = {
        // ---- Full validation ----
        validate: validate,
        validateUniqueIds: validateUniqueIds,

        // ---- Section-specific validation ----
        validateMissions: validateMissions,
        validateTeams: validateTeams,
        validateTournaments: validateTournaments,
        validateAcademy: validateAcademy,
        validateCharacters: validateCharacters,
        validateCurriculum: validateCurriculum,
        validateSocial: validateSocial,
        validateLocationSchedules: validateLocationSchedules,

        // ---- Individual reference validators (for composition) ----
        validateMissionReferences: validateMissionReferences,
        validateTeamReferences: validateTeamReferences,
        validateTournamentReferences: validateTournamentReferences,
        validateAcademyReferences: validateAcademyReferences,
        validateCharacterReferences: validateCharacterReferences,
        validateCurriculumReferences: validateCurriculumReferences,
        validateSocialReferences: validateSocialReferences,
        validateLocationScheduleReferences: validateLocationScheduleReferences
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CrossDomainValidator;
        var missing = [];

        var required = [
            'validate',
            'validateUniqueIds',
            'validateMissions',
            'validateTeams',
            'validateTournaments',
            'validateAcademy',
            'validateCharacters',
            'validateCurriculum',
            'validateSocial',
            'validateLocationSchedules',
            'validateMissionReferences',
            'validateTeamReferences',
            'validateTournamentReferences',
            'validateAcademyReferences',
            'validateCharacterReferences',
            'validateCurriculumReferences',
            'validateSocialReferences',
            'validateLocationScheduleReferences'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[CrossDomainValidator] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[CrossDomainValidator] All exports verified successfully.');
            console.log('[CrossDomainValidator] Validates: missions, teams, tournaments, academy, characters, curriculum, social, locationSchedules');
        }
    })();

})();
