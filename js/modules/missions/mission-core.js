/**
js/modules/missions/mission-core.js - Mission Core
Path: js/modules/missions/mission-core.js
[Header comments omitted for brevity - see original]
*/
(function() {
'use strict';
if (window.__missionCoreLoaded) { return; }

 // ============================================================
 // MANDATORY DEPENDENCIES
 // ============================================================
 var MutationPipeline = window.MutationPipeline;
 var ObjectUtils = window.ObjectUtils;
 var IdUtils = window.IdUtils;
 var MissionConstants = window.MissionConstants;
 var MissionId = window.MissionId;
 var MissionSchema = window.MissionSchema;
 var MissionRules = window.MissionRules;
 var _missing = [];
 
 if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') _missing.push('MutationPipeline.performMutation');
 if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') _missing.push('ObjectUtils.deepClone');
 if (!IdUtils || typeof IdUtils.generateId !== 'function') _missing.push('IdUtils.generateId');
 if (!IdUtils || typeof IdUtils.normaliseId !== 'function') _missing.push('IdUtils.normaliseId');
 if (!MissionConstants) {
     _missing.push('MissionConstants (module)');
 } else {
     if (!Array.isArray(MissionConstants.VALID_STATUSES)) _missing.push('MissionConstants.VALID_STATUSES');
     if (typeof MissionConstants.getDefaults !== 'function') _missing.push('MissionConstants.getDefaults');
 }
 if (!MissionId || typeof MissionId.generate !== 'function') _missing.push('MissionId.generate');
 if (!MissionSchema) {
     _missing.push('MissionSchema (module)');
 } else {
     if (typeof MissionSchema.validateMission !== 'function') _missing.push('MissionSchema.validateMission');
     if (typeof MissionSchema.validateObjective !== 'function') _missing.push('MissionSchema.validateObjective');
     if (typeof MissionSchema.validateReport !== 'function') _missing.push('MissionSchema.validateReport');
     if (typeof MissionSchema.validateParticipant !== 'function') _missing.push('MissionSchema.validateParticipant');
     if (typeof MissionSchema.canonicaliseMissionShape !== 'function') _missing.push('MissionSchema.canonicaliseMissionShape');
 }
 if (!MissionRules) {
     _missing.push('MissionRules (module)');
 } else {
     if (typeof MissionRules.recalculateDerivedFields !== 'function') _missing.push('MissionRules.recalculateDerivedFields');
     if (typeof MissionRules.validateStatusChange !== 'function') _missing.push('MissionRules.validateStatusChange');
     if (typeof MissionRules.validateObjectivesEditable !== 'function') _missing.push('MissionRules.validateObjectivesEditable');
     if (typeof MissionRules.deriveCompletedAt !== 'function') _missing.push('MissionRules.deriveCompletedAt');
     if (typeof MissionRules.resolveParticipantSource !== 'function') _missing.push('MissionRules.resolveParticipantSource');
     if (typeof MissionRules.hasParticipant !== 'function') _missing.push('MissionRules.hasParticipant');
 }
 if (_missing.length > 0) {
     throw new Error('[MissionCore] Missing mandatory dependencies: ' + _missing.join(', '));
 }
 window.__missionCoreLoaded = true;

 // ============================================================
 // HELPERS
 // ============================================================
 function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
 function isNonEmptyString(value) { return typeof value === 'string' && value.trim() !== ''; }
 function normaliseId(value) { return IdUtils.normaliseId(value); }
 function generateId(prefix) { return IdUtils.generateId(prefix); }
 function deepClone(value) {
     var result = ObjectUtils.deepClone(value);
     if (result === value && value !== null && typeof value === 'object') {
         throw new Error('[MissionCore] deepClone returned the original reference.');
     }
     return result;
 }
 function failure(message) { return { success: false, message: message }; }
 function success(data) { return { success: true, data: data }; }

 // ============================================================
 // SNAPSHOT ACCESS
 // ============================================================
 function ensureMissionArray(appData) {
     if (!appData || typeof appData !== 'object') return null;
     if (!Array.isArray(appData.missions)) appData.missions = [];
     return appData.missions;
 }
 function findMissionInSnapshot(appData, missionId) {
     if (!appData || !Array.isArray(appData.missions)) return null;
     var target = normaliseId(missionId);
     if (target === null) return null;
     var missions = appData.missions;
     for (var i = 0; i < missions.length; i++) {
         var m = missions[i];
         if (isPlainObject(m) && normaliseId(m.id) === target) return m;
     }
     return null;
 }
 function findMissionIndexInSnapshot(appData, missionId) {
     if (!appData || !Array.isArray(appData.missions)) return -1;
     var target = normaliseId(missionId);
     if (target === null) return -1;
     var missions = appData.missions;
     for (var i = 0; i < missions.length; i++) {
         var m = missions[i];
         if (isPlainObject(m) && normaliseId(m.id) === target) return i;
     }
     return -1;
 }

 // ============================================================
 // CANDIDATE FINALISATION & PRUNING
 // ============================================================
 function finaliseCandidate(candidate, nowIso) {
     var recalculated = MissionRules.recalculateDerivedFields(candidate);
     recalculated.completedAt = candidate.completedAt;
     return recalculated;
 }
 function pruneOrphanedParticipants(candidate) {
     if (!Array.isArray(candidate.participants) || !Array.isArray(candidate.assignedTeamIds)) return;
     var assignedSet = Object.create(null);
     for (var i = 0; i < candidate.assignedTeamIds.length; i++) {
         var norm = normaliseId(candidate.assignedTeamIds[i]);
         if (norm !== null) assignedSet[norm] = true;
     }
     candidate.participants = candidate.participants.filter(function(p) {
         if (!isPlainObject(p)) return true;
         if (p.teamId === null || p.teamId === undefined) return true;
         var tid = normaliseId(p.teamId);
         return tid !== null && assignedSet[tid] === true;
     });
 }

 // ============================================================
 // NESTED VALIDATION HELPERS
 // ============================================================
 function validateSingleReport(report) {
     var errors = [];
     MissionSchema.validateReport(report, 0, errors);
     return { valid: errors.length === 0, message: errors.join('; ') };
 }
 function validateSingleParticipant(participant) {
     var errors = [];
     MissionSchema.validateParticipant(participant, 0, errors);
     return { valid: errors.length === 0, message: errors.join('; ') };
 }

 // ============================================================
 // CREATE
 // ============================================================
 function createMission(data) {
     if (!isPlainObject(data)) return Promise.resolve(failure('Mission data is required.'));
     if (!isNonEmptyString(data.title)) return Promise.resolve(failure('Mission title is required.'));
     
     var requestedId = null;
     var hasRequestedId = data.id !== undefined && data.id !== null && data.id !== '';
     if (hasRequestedId) {
         requestedId = normaliseId(data.id);
         if (requestedId === null) return Promise.resolve(failure('Supplied id is not a valid identifier.'));
     }

     return MutationPipeline.performMutation({
         validate: function(appData) {
             if (!appData || typeof appData !== 'object') return { valid: false, message: 'Application data is not available.' };
             var missions = ensureMissionArray(appData);
             if (!missions) return { valid: false, message: 'Mission store is not available.' };
             
             var candidateId;
             if (requestedId !== null) {
                 if (findMissionInSnapshot(appData, requestedId)) return { valid: false, message: 'A mission with id "' + requestedId + '" already exists.' };
                 candidateId = requestedId;
             } else {
                 candidateId = generateId('miss');
             }
             
             var defaults = MissionConstants.getDefaults();
             var nowIso = new Date().toISOString();
             var now = new Date();
             var raw = {
                 id: candidateId,
                 title: typeof data.title === 'string' ? data.title.trim() : '',
                 description: typeof data.description === 'string' ? data.description : '',
                 year: data.year !== undefined && data.year !== null ? data.year : now.getFullYear(),
                 month: data.month !== undefined && data.month !== null ? data.month : 1,
                 day: data.day !== undefined && data.day !== null ? data.day : 1,
                 primaryType: typeof data.primaryType === 'string' ? data.primaryType : '',
                 subtype: typeof data.subtype === 'string' ? data.subtype : '',
                 secondaryType: typeof data.secondaryType === 'string' ? data.secondaryType : '',
                 escalation: data.escalation !== undefined && data.escalation !== null ? data.escalation : defaults.escalation,
                 threatType: typeof data.threatType === 'string' ? data.threatType : '',
                 environment: typeof data.environment === 'string' ? data.environment : '',
                 location: typeof data.location === 'string' ? data.location : '',
                 duration: typeof data.duration === 'string' ? data.duration : '',
                 difficulty: data.difficulty !== undefined && data.difficulty !== null ? data.difficulty : defaults.difficulty,
                 priority: data.priority !== undefined && data.priority !== null ? data.priority : defaults.priority,
                 basePay: typeof data.basePay === 'string' ? data.basePay : '',
                 surchargePay: typeof data.surchargePay === 'string' ? data.surchargePay : '',
                 pay: '',
                 billing: data.billing !== undefined && data.billing !== null ? data.billing : defaults.billing,
                 assignedTeamIds: Array.isArray(data.assignedTeamIds) ? data.assignedTeamIds.slice() : [],
                 supportPersonnel: Array.isArray(data.supportPersonnel) ? data.supportPersonnel.slice() : [],
                 participants: Array.isArray(data.participants) ? data.participants.map(function(p) {
                     if (!isPlainObject(p)) return p;
                     return { characterId: p.characterId, teamId: p.teamId !== undefined ? p.teamId : null, source: p.source };
                 }) : [],
                 status: data.status !== undefined && data.status !== null ? data.status : defaults.status,
                 objectives: Array.isArray(data.objectives) ? data.objectives.map(function(obj) {
                     return { text: obj && typeof obj.text === 'string' ? obj.text : '', done: obj && obj.done === true };
                 }) : [],
                 progress: 0,
                 notes: typeof data.notes === 'string' ? data.notes : '',
                 tags: Array.isArray(data.tags) ? data.tags.slice() : [],
                 createdAt: nowIso,
                 completedAt: null,
                 archivedAt: null,
                 reports: [],
                 graduatingClassId: data.graduatingClassId !== undefined ? data.graduatingClassId : null,
                 classFilterEnabled: data.classFilterEnabled === true
             };
             
             var sequenceResult = MissionId.generate(raw.year, raw.difficulty, missions);
             if (!sequenceResult) return { valid: false, message: 'Could not allocate a mission sequence.' };
             raw.sequence = sequenceResult.sequence;
             
             var canonical = MissionSchema.canonicaliseMissionShape(raw);
             if (!canonical.valid || !canonical.value) return { valid: false, message: canonical.errors.join('; ') };
             
             var candidate = finaliseCandidate(canonical.value, nowIso);
             var validated = MissionSchema.validateMission(candidate);
             if (!validated.valid) return { valid: false, message: validated.errors.join('; ') };
             
             stagedCandidate = candidate;
             return { valid: true };
         },
         mutate: function(appData) {
             var missions = ensureMissionArray(appData);
             if (!missions) throw new Error('Mission store is not available.');
             if (!stagedCandidate) throw new Error('Mission candidate was not built during validate.');
             missions.push(deepClone(stagedCandidate));
             return { mission: stagedCandidate, id: stagedCandidate.id };
         },
         logMessage: function(result) { return 'Created mission: ' + result.mission.title; },
         successMessage: 'Mission created.',
         failureMessage: 'Failed to create mission.'
     });
 }

 // ============================================================
 // UPDATE
 // ============================================================
 function updateMission(missionId, updates) {
     var target = normaliseId(missionId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (!isPlainObject(updates) || Object.keys(updates).length === 0) return Promise.resolve(failure('Updates must be a non-empty object.'));

     return MutationPipeline.performMutation({
         validate: function(appData) {
             if (!appData || typeof appData !== 'object') return { valid: false, message: 'Application data is not available.' };
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             
             // P0 FIX: Block edits on archived missions
             if (current.archivedAt) {
                 return { valid: false, message: 'Cannot update an archived mission.' };
             }

             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             
             if (updates.status !== undefined && updates.status !== current.status) {
                 var statusCheck = MissionRules.validateStatusChange(current, updates.status);
                 if (!statusCheck.valid) return statusCheck;
                 candidate.status = updates.status;
                 candidate.completedAt = MissionRules.deriveCompletedAt(current.status, updates.status, current.completedAt, nowIso);
             }
             
             if (updates.objectives !== undefined) {
                 if (!Array.isArray(updates.objectives)) return { valid: false, message: 'Objectives must be an array.' };
                 // P0 FIX: Validate editability against the CANDIDATE status, not current
                 var objCheck = MissionRules.validateObjectivesEditable(candidate);
                 if (!objCheck.valid) return objCheck;
                 candidate.objectives = updates.objectives.map(function(obj) {
                     return { text: obj && typeof obj.text === 'string' ? obj.text : '', done: obj && obj.done === true };
                 });
             }
             if (updates.supportPersonnel !== undefined) {
                 if (!Array.isArray(updates.supportPersonnel)) return { valid: false, message: 'Support personnel must be an array.' };
                 candidate.supportPersonnel = updates.supportPersonnel.slice();
             }
             if (updates.participants !== undefined) {
                 if (!Array.isArray(updates.participants)) return { valid: false, message: 'Participants must be an array.' };
                 candidate.participants = updates.participants.map(function(p) {
                     if (!isPlainObject(p)) return p;
                     return { characterId: p.characterId, teamId: p.teamId !== undefined ? p.teamId : null, source: p.source };
                 });
             }
             if (updates.assignedTeamIds !== undefined) {
                 if (!Array.isArray(updates.assignedTeamIds)) return { valid: false, message: 'Assigned teams must be an array.' };
                 candidate.assignedTeamIds = updates.assignedTeamIds.slice();
                 pruneOrphanedParticipants(candidate);
             }
             
             copyIfProvided(candidate, updates, 'title', function(v) { return typeof v === 'string' ? v.trim() : v; });
             copyIfProvided(candidate, updates, 'description');
             copyIfProvided(candidate, updates, 'primaryType');
             copyIfProvided(candidate, updates, 'subtype');
             copyIfProvided(candidate, updates, 'secondaryType');
             copyIfProvided(candidate, updates, 'escalation');
             copyIfProvided(candidate, updates, 'threatType');
             copyIfProvided(candidate, updates, 'environment');
             copyIfProvided(candidate, updates, 'location');
             copyIfProvided(candidate, updates, 'duration');
             copyIfProvided(candidate, updates, 'difficulty');
             copyIfProvided(candidate, updates, 'priority');
             copyIfProvided(candidate, updates, 'basePay');
             copyIfProvided(candidate, updates, 'surchargePay');
             copyIfProvided(candidate, updates, 'billing');
             copyIfProvided(candidate, updates, 'notes');
             copyIfProvided(candidate, updates, 'tags');
             copyIfProvided(candidate, updates, 'graduatingClassId');
             copyIfProvided(candidate, updates, 'classFilterEnabled');
             copyIfProvided(candidate, updates, 'year');
             copyIfProvided(candidate, updates, 'month');
             copyIfProvided(candidate, updates, 'day');

             // P1 FIX: Reallocate sequence if year or difficulty changed to prevent label collisions
             var yearChanged = updates.year !== undefined && updates.year !== current.year;
             var diffChanged = updates.difficulty !== undefined && updates.difficulty !== current.difficulty;
             if (yearChanged || diffChanged) {
                 var newYear = yearChanged ? updates.year : candidate.year;
                 var newDiff = diffChanged ? updates.difficulty : candidate.difficulty;
                 var seqResult = MissionId.generate(newYear, newDiff, appData.missions);
                 if (seqResult) {
                     candidate.sequence = seqResult.sequence;
                 }
             }

             // P0 FIX: Canonicalise to strip legacy fields (log, assignedTeamId)
             var canonical = MissionSchema.canonicaliseMissionShape(candidate);
             if (!canonical.valid || !canonical.value) {
                 return { valid: false, message: canonical.errors.join('; ') };
             }
             candidate = canonical.value;

             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             var validated = MissionSchema.validateMission(final);
             if (!validated.valid) return { valid: false, message: validated.errors.join('; ') };
             
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission disappeared between validate and mutate.');
             if (!stagedCandidate) throw new Error('Mission candidate was not built during validate.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { mission: stagedCandidate, id: target };
         },
         logMessage: function(result) { return 'Updated mission: ' + (result.mission.title || target); },
         successMessage: 'Mission updated.',
         failureMessage: 'Failed to update mission.'
     });
 }

 // ============================================================
 // ARCHIVE / UNARCHIVE / PURGE / STATUS
 // ============================================================
 function archiveMission(missionId) {
     var target = normaliseId(missionId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             if (current.archivedAt) return { valid: false, message: 'Mission is already archived.' };
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             var m = appData.missions[idx];
             m.archivedAt = new Date().toISOString();
             m.status = 'completed';
             if (!m.completedAt) m.completedAt = m.archivedAt;
             return { id: target, mission: deepClone(m) };
         },
         logMessage: function(result) { return 'Archived mission: ' + (result.mission.title || target); },
         successMessage: 'Mission archived.', failureMessage: 'Failed to archive mission.'
     });
 }
 function unarchiveMission(missionId) {
     var target = normaliseId(missionId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             if (!current.archivedAt) return { valid: false, message: 'Mission is not archived.' };
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx].archivedAt = null;
             return { id: target, mission: deepClone(appData.missions[idx]) };
         },
         logMessage: function(result) { return 'Unarchived mission: ' + (result.mission.title || target); },
         successMessage: 'Mission unarchived.', failureMessage: 'Failed to unarchive mission.'
     });
 }
 function purgeMission(missionId) {
     var target = normaliseId(missionId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             var m = appData.missions[idx];
             var title = m && typeof m.title === 'string' ? m.title : target;
             appData.missions.splice(idx, 1);
             return { id: target, title: title };
         },
         logMessage: function(result) { return 'Purged mission: ' + result.title; },
         successMessage: 'Mission purged.', failureMessage: 'Failed to purge mission.'
     });
 }
 function completeMission(missionId) { return updateMission(missionId, { status: 'completed' }); }
 function cancelMission(missionId) { return updateMission(missionId, { status: 'cancelled' }); }
 function reactivateMission(missionId) { return updateMission(missionId, { status: 'active' }); }

 // ============================================================
 // OBJECTIVE / SUPPORT / PARTICIPANT / REPORT COMMANDS
 // ============================================================
 // [Sub-mutations remain identical to the original, using the global stagedCandidate pattern]
 function setObjectiveDone(missionId, index, done) {
     var target = normaliseId(missionId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return Promise.resolve(failure('Objective index must be a non-negative integer.'));
     if (typeof done !== 'boolean') return Promise.resolve(failure('Objective done must be a boolean.'));
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             var objCheck = MissionRules.validateObjectivesEditable(current);
             if (!objCheck.valid) return objCheck;
             if (!Array.isArray(current.objectives) || index >= current.objectives.length) return { valid: false, message: 'Objective index is out of range.' };
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             candidate.objectives[index] = { text: candidate.objectives[index].text, done: done };
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Set objective ' + index + ' on mission ' + (result.mission.title || target) + ' to ' + done; },
         successMessage: 'Objective updated.', failureMessage: 'Failed to update objective.'
     });
 }
 function addObjective(missionId, text) {
     var target = normaliseId(missionId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (!isNonEmptyString(text)) return Promise.resolve(failure('Objective text is required.'));
     var trimmed = text.trim();
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             var objCheck = MissionRules.validateObjectivesEditable(current);
             if (!objCheck.valid) return objCheck;
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             if (!Array.isArray(candidate.objectives)) candidate.objectives = [];
             candidate.objectives.push({ text: trimmed, done: false });
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Added objective to mission: ' + (result.mission.title || target); },
         successMessage: 'Objective added.', failureMessage: 'Failed to add objective.'
     });
 }
 function removeObjective(missionId, index) {
     var target = normaliseId(missionId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return Promise.resolve(failure('Objective index must be a non-negative integer.'));
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             var objCheck = MissionRules.validateObjectivesEditable(current);
             if (!objCheck.valid) return objCheck;
             if (!Array.isArray(current.objectives) || index >= current.objectives.length) return { valid: false, message: 'Objective index is out of range.' };
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             candidate.objectives.splice(index, 1);
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Removed objective from mission: ' + (result.mission.title || target); },
         successMessage: 'Objective removed.', failureMessage: 'Failed to remove objective.'
     });
 }
 function addSupportPersonnel(missionId, characterId) {
     var target = normaliseId(missionId);
     var charTarget = normaliseId(characterId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (charTarget === null) return Promise.resolve(failure('Character ID is required.'));
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             var support = Array.isArray(current.supportPersonnel) ? current.supportPersonnel : [];
             for (var i = 0; i < support.length; i++) { if (normaliseId(support[i]) === charTarget) return { valid: false, message: 'Character is already assigned as support.' }; }
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             candidate.supportPersonnel = support.concat([charTarget]);
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Added support to mission: ' + (result.mission.title || target); },
         successMessage: 'Support personnel added.', failureMessage: 'Failed to add support personnel.'
     });
 }
 function removeSupportPersonnel(missionId, characterId) {
     var target = normaliseId(missionId);
     var charTarget = normaliseId(characterId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (charTarget === null) return Promise.resolve(failure('Character ID is required.'));
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             var support = Array.isArray(current.supportPersonnel) ? current.supportPersonnel : [];
             var found = false;
             for (var i = 0; i < support.length; i++) { if (normaliseId(support[i]) === charTarget) { found = true; break; } }
             if (!found) return { valid: false, message: 'Character is not assigned as support.' };
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             candidate.supportPersonnel = support.filter(function(id) { return normaliseId(id) !== charTarget; });
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Removed support from mission: ' + (result.mission.title || target); },
         successMessage: 'Support personnel removed.', failureMessage: 'Failed to remove support personnel.'
     });
 }
 function addParticipant(missionId, characterId, teamId) {
     var target = normaliseId(missionId);
     var charTarget = normaliseId(characterId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (charTarget === null) return Promise.resolve(failure('Character ID is required.'));
     var teamTarget = null;
     var hasTeam = teamId !== undefined && teamId !== null && teamId !== '';
     if (hasTeam) {
         teamTarget = normaliseId(teamId);
         if (teamTarget === null) return Promise.resolve(failure('Team ID must be a valid identifier or null.'));
     }
     var source = MissionRules.resolveParticipantSource(teamTarget);
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             var participants = Array.isArray(current.participants) ? current.participants : [];
             if (MissionRules.hasParticipant(current, charTarget, teamTarget)) return { valid: false, message: 'Character is already a participant for this ' + (source === 'team' ? 'team.' : 'rookie slot.') };
             var newParticipant = { characterId: charTarget, teamId: teamTarget, source: source };
             var pCheck = validateSingleParticipant(newParticipant);
             if (!pCheck.valid) return { valid: false, message: pCheck.message };
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             candidate.participants = participants.concat([newParticipant]);
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Added ' + source + ' participant to mission: ' + (result.mission.title || target); },
         successMessage: 'Participant added.', failureMessage: 'Failed to add participant.'
     });
 }
 function removeParticipant(missionId, characterId, teamId) {
     var target = normaliseId(missionId);
     var charTarget = normaliseId(characterId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (charTarget === null) return Promise.resolve(failure('Character ID is required.'));
     var teamTarget = null;
     var hasTeam = teamId !== undefined && teamId !== null && teamId !== '';
     if (hasTeam) {
         teamTarget = normaliseId(teamId);
         if (teamTarget === null) return Promise.resolve(failure('Team ID must be a valid identifier or null.'));
     }
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             if (!MissionRules.hasParticipant(current, charTarget, teamTarget)) return { valid: false, message: 'Character is not a participant for this ' + (teamTarget === null ? 'rookie slot.' : 'team.') };
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             var participants = Array.isArray(candidate.participants) ? candidate.participants : [];
             candidate.participants = participants.filter(function(p) {
                 if (!isPlainObject(p)) return true;
                 var pcid = normaliseId(p.characterId);
                 if (pcid !== charTarget) return true;
                 var ptid = (p.teamId === undefined || p.teamId === null) ? null : normaliseId(p.teamId);
                 return !(ptid === teamTarget);
             });
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Removed participant from mission: ' + (result.mission.title || target); },
         successMessage: 'Participant removed.', failureMessage: 'Failed to remove participant.'
     });
 }
 function addReport(missionId, authorId, text) {
     var target = normaliseId(missionId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     var author = null; var authorRedacted = false;
     if (authorId !== undefined && authorId !== null && authorId !== '') {
         author = normaliseId(authorId);
         if (author === null) return Promise.resolve(failure('Author ID must be a valid id or empty.'));
     } else { authorRedacted = true; }
     if (!isNonEmptyString(text)) return Promise.resolve(failure('Report text is required.'));
     var trimmedText = text.trim();
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             if (!Array.isArray(candidate.reports)) candidate.reports = [];
             var newReport = { id: generateId('mrep'), authorId: author, authorRedacted: authorRedacted, text: trimmedText, createdAt: nowIso, updatedAt: null };
             var check = validateSingleReport(newReport);
             if (!check.valid) return { valid: false, message: check.message };
             candidate.reports.push(newReport);
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             stagedReportId = newReport.id;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate, reportId: stagedReportId };
         },
         logMessage: function(result) { return 'Added report to mission: ' + (result.mission.title || target); },
         successMessage: 'Report added.', failureMessage: 'Failed to add report.'
     });
 }
 function updateReport(missionId, reportId, text) {
     var target = normaliseId(missionId);
     var reportTarget = normaliseId(reportId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (reportTarget === null) return Promise.resolve(failure('Report ID is required.'));
     if (!isNonEmptyString(text)) return Promise.resolve(failure('Report text is required.'));
     var trimmedText = text.trim();
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             if (!Array.isArray(current.reports)) return { valid: false, message: 'Report not found.' };
             var foundIndex = -1;
             for (var i = 0; i < current.reports.length; i++) { if (normaliseId(current.reports[i].id) === reportTarget) { foundIndex = i; break; } }
             if (foundIndex === -1) return { valid: false, message: 'Report not found.' };
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             var report = candidate.reports[foundIndex];
             report.text = trimmedText;
             report.updatedAt = nowIso;
             var check = validateSingleReport(report);
             if (!check.valid) return { valid: false, message: check.message };
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Updated report on mission: ' + (result.mission.title || target); },
         successMessage: 'Report updated.', failureMessage: 'Failed to update report.'
     });
 }
 function removeReport(missionId, reportId) {
     var target = normaliseId(missionId);
     var reportTarget = normaliseId(reportId);
     if (target === null) return Promise.resolve(failure('Mission ID is required.'));
     if (reportTarget === null) return Promise.resolve(failure('Report ID is required.'));
     return MutationPipeline.performMutation({
         validate: function(appData) {
             var current = findMissionInSnapshot(appData, target);
             if (!current) return { valid: false, message: 'Mission no longer exists.' };
             if (!Array.isArray(current.reports)) return { valid: false, message: 'Report not found.' };
             var found = false;
             for (var i = 0; i < current.reports.length; i++) { if (normaliseId(current.reports[i].id) === reportTarget) { found = true; break; } }
             if (!found) return { valid: false, message: 'Report not found.' };
             var nowIso = new Date().toISOString();
             var candidate = deepClone(current);
             candidate.reports = candidate.reports.filter(function(r) { return normaliseId(r.id) !== reportTarget; });
             var final = finaliseCandidate(candidate, nowIso);
             final.completedAt = candidate.completedAt;
             stagedCandidate = final;
             return { valid: true };
         },
         mutate: function(appData) {
             var idx = findMissionIndexInSnapshot(appData, target);
             if (idx === -1) throw new Error('Mission no longer exists.');
             appData.missions[idx] = deepClone(stagedCandidate);
             return { id: target, mission: stagedCandidate };
         },
         logMessage: function(result) { return 'Removed report from mission: ' + (result.mission.title || target); },
         successMessage: 'Report removed.', failureMessage: 'Failed to remove report.'
     });
 }

 // ============================================================
 // INTERNAL UTILITIES & STAGING
 // ============================================================
 function copyIfProvided(candidate, updates, field, transform) {
     if (updates[field] === undefined) return;
     var value = updates[field];
     if (typeof transform === 'function') value = transform(value);
     candidate[field] = value;
 }
 
 var stagedCandidate = null;
 var stagedReportId = null;
 function beginStaging() { stagedCandidate = null; stagedReportId = null; }
 function wrapMutation(fn) {
     return function() {
         beginStaging();
         return fn.apply(null, arguments);
     };
 }

 // ============================================================
 // CASCADE HELPER & EXPOSE
 // ============================================================
 function stripCharacterRefs(appData, charId) {
     var MissionCascade = window.MissionCascade;
     if (!MissionCascade || typeof MissionCascade.stripCharacterRefs !== 'function') {
         return { supportEntriesRemoved: 0, reportsRedacted: 0, participantEntriesRemoved: 0 };
     }
     return MissionCascade.stripCharacterRefs(appData, charId);
 }

 window.MissionCore = Object.freeze({
     createMission: wrapMutation(createMission),
     updateMission: wrapMutation(updateMission),
     archiveMission: wrapMutation(archiveMission),
     unarchiveMission: wrapMutation(unarchiveMission),
     purgeMission: wrapMutation(purgeMission),
     completeMission: wrapMutation(completeMission),
     cancelMission: wrapMutation(cancelMission),
     reactivateMission: wrapMutation(reactivateMission),
     setObjectiveDone: wrapMutation(setObjectiveDone),
     addObjective: wrapMutation(addObjective),
     removeObjective: wrapMutation(removeObjective),
     addSupportPersonnel: wrapMutation(addSupportPersonnel),
     removeSupportPersonnel: wrapMutation(removeSupportPersonnel),
     addParticipant: wrapMutation(addParticipant),
     removeParticipant: wrapMutation(removeParticipant),
     addReport: wrapMutation(addReport),
     updateReport: wrapMutation(updateReport),
     removeReport: wrapMutation(removeReport),
     stripCharacterRefs: stripCharacterRefs
 });
})();
