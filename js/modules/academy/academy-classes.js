/**
 * js/modules/academy/academy-classes.js - Academy Classes
 * SINGLE SOURCE OF TRUTH for all academy class data and operations
 * Path: js/modules/academy/academy-classes.js
 * 
 * This module is responsible for:
 *   - Class CRUD operations (create, update, delete)
 *   - Student class membership management
 *   - Class lookup (internal and external)
 *   - Class mutation operations
 * 
 * IMPORTANT:
 *   - This module OWNS class data - it does NOT depend on AcademyQueries
 *   - All mutations are candidate-based: VALIDATE → CLONE → MODIFY → COMMIT
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 *   - Internal lookup functions are PRIVATE to this module
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 * 
 * DATA STORE CONTRACT:
 *   - window.data.academy.graduatingClasses is the source of truth for classes
 *   - window.data.academy.classStudents is the source of truth for membership
 *   - If these structures don't exist, they are created
 *   - This module does NOT query AcademyQueries for data it owns
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var classes = window.AcademyClasses;
 *   
 *   // Create a class
 *   var result = classes.create('Class of 2026');
 *   
 *   // Update a class
 *   var result = classes.update('class_123', { name: 'New Name' });
 *   
 *   // Delete a class
 *   var result = classes.delete('class_123');
 *   
 *   // Student membership
 *   var result = classes.addStudent('class_123', 'student_456');
 *   var result = classes.removeStudent('class_123', 'student_456');
 *   var result = classes.removeStudentFromAllClasses('student_456');
 *   
 *   // Internal lookups (used by AcademyQueries)
 *   var cls = classes.getClassInternal('class_123');
 *   var all = classes.getClassesInternal();
 *   var students = classes.getClassStudentsInternal('class_123');
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyClassesLoaded) {
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
        throw new Error('[AcademyClasses] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyClassesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_STATUSES = ['active', 'archived', 'graduated'];
    var DEFAULT_STATUS = 'active';

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
        return ObjectUtils.deepClone(value);
    }

    function generateId() {
        return IdUtils.generateId('class');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL (no AcademyQueries dependency)
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getAcademyStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }

        if (!data.academy || typeof data.academy !== 'object') {
            data.academy = {};
        }

        return data.academy;
    }

    function ensureClassStructures() {
        var academy = getAcademyStore();
        if (!academy) {
            return null;
        }

        // Use 'graduatingClasses' as the canonical class storage
        if (!academy.graduatingClasses || typeof academy.graduatingClasses !== 'object') {
            academy.graduatingClasses = {};
        }

        if (!academy.classStudents || typeof academy.classStudents !== 'object') {
            academy.classStudents = {};
        }

        return academy;
    }

    // ============================================================
    // INTERNAL CLASS LOOKUP - PRIVATE
    // These are the CANONICAL lookup functions for AcademyClasses.
    // AcademyQueries delegates to these, NOT the other way around.
    // ============================================================

    /**
     * Get a class record by ID (internal).
     * Returns a LIVE reference - do not mutate directly.
     * Use the mutation functions (create/update/delete) instead.
     * 
     * @param {string} classId - Class ID
     * @returns {object|null} Class object or null
     */
    function getClassInternal(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var academy = getAcademyStore();
        if (!academy || !academy.graduatingClasses) {
            return null;
        }

        var target = String(classId);
        return academy.graduatingClasses[target] || null;
    }

    /**
     * Get all class records (internal).
     * Returns an array of class objects (shallow copy).
     * 
     * @returns {array} Array of class objects
     */
    function getClassesInternal() {
        var academy = getAcademyStore();
        if (!academy || !academy.graduatingClasses) {
            return [];
        }

        var result = [];
        for (var id in academy.graduatingClasses) {
            if (Object.prototype.hasOwnProperty.call(academy.graduatingClasses, id)) {
                var cls = academy.graduatingClasses[id];
                if (cls) {
                    result.push(cls);
                }
            }
        }

        return result;
    }

    /**
     * Get class records by status (internal).
     * 
     * @param {string} status - Status filter ('active', 'archived', 'graduated')
     * @returns {array} Array of class objects
     */
    function getClassesByStatusInternal(status) {
        if (!isNonEmptyString(status)) {
            return getClassesInternal();
        }

        var all = getClassesInternal();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            if (all[i].status === status) {
                result.push(all[i]);
            }
        }

        return result;
    }

    /**
     * Get active class records (internal).
     * 
     * @returns {array} Array of active class objects
     */
    function getActiveClassesInternal() {
        return getClassesByStatusInternal('active');
    }

    /**
     * Get a class by name (internal, case-insensitive).
     * 
     * @param {string} name - Class name
     * @returns {object|null} Class object or null
     */
    function getClassByNameInternal(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var target = String(name).toLowerCase().trim();
        var classes = getClassesInternal();

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && cls.name && String(cls.name).toLowerCase().trim() === target) {
                return cls;
            }
        }

        return null;
    }

    /**
     * Get students for a class (internal).
     * 
     * @param {string} classId - Class ID
     * @returns {array} Array of student IDs
     */
    function getClassStudentsInternal(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var academy = getAcademyStore();
        if (!academy || !academy.classStudents) {
            return [];
        }

        var target = String(classId);
        var students = academy.classStudents[target];

        if (!Array.isArray(students)) {
            return [];
        }

        return students.slice();
    }

    /**
     * Check if a student is in a class (internal).
     * 
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @returns {boolean} True if the student is in the class
     */
    function isStudentInClassInternal(classId, studentId) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(studentId)) {
            return false;
        }

        var students = getClassStudentsInternal(classId);
        var target = String(studentId);

        for (var i = 0; i < students.length; i++) {
            if (String(students[i]) === target) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get class display name (internal).
     * 
     * @param {string} classId - Class ID
     * @returns {string} Class display name or 'Unknown Class'
     */
    function getClassDisplayNameInternal(classId) {
        if (!isNonEmptyString(classId)) {
            return 'Unknown Class';
        }

        var cls = getClassInternal(classId);
        if (!cls) {
            return 'Unknown Class';
        }

        return cls.name || 'Unnamed Class';
    }

    /**
     * Get character class names (internal).
     * 
     * @param {object} character - Character object with classIds
     * @returns {array} Array of class names
     */
    function getCharacterClassNamesInternal(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }

        var classIds = character.classIds;
        if (!Array.isArray(classIds) || classIds.length === 0) {
            return [];
        }

        var names = [];
        var classes = getClassesInternal();

        for (var i = 0; i < classIds.length; i++) {
            var id = classIds[i];
            for (var j = 0; j < classes.length; j++) {
                if (String(classes[j].id) === String(id)) {
                    names.push(classes[j].name);
                    break;
                }
            }
        }

        return names;
    }

    /**
     * Get character classes (internal).
     * 
     * @param {object} character - Character object with classIds
     * @returns {array} Array of class objects
     */
    function getCharacterClassesInternal(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }

        var classIds = character.classIds;
        if (!Array.isArray(classIds) || classIds.length === 0) {
            return [];
        }

        var result = [];
        var classes = getClassesInternal();

        for (var i = 0; i < classIds.length; i++) {
            var id = classIds[i];
            for (var j = 0; j < classes.length; j++) {
                if (String(classes[j].id) === String(id)) {
                    result.push(classes[j]);
                    break;
                }
            }
        }

        return result;
    }

    /**
     * Get class students with full objects if requested (internal).
     * 
     * @param {string} classId - Class ID
     * @param {boolean} returnObjects - If true, return full character objects
     * @param {function} getCharacterById - Function to get character by ID
     * @returns {array} Array of student IDs or character objects
     */
    function getClassStudentsWithDetailsInternal(classId, returnObjects, getCharacterById) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var studentIds = getClassStudentsInternal(classId);

        if (!returnObjects) {
            return studentIds;
        }

        if (typeof getCharacterById !== 'function') {
            return studentIds;
        }

        var result = [];
        for (var i = 0; i < studentIds.length; i++) {
            var character = getCharacterById(studentIds[i]);
            if (character) {
                result.push(character);
            }
        }

        return result;
    }

    // ============================================================
    // PUBLIC API - MUTATIONS
    // ============================================================

    /**
     * Create a new class.
     * Candidate-based: validates, creates, commits.
     * 
     * @param {string} name - Class name
     * @param {object} options - Optional configuration
     * @param {string} options.status - Status ('active', 'archived', 'graduated')
     * @param {number} options.year - Graduation year
     * @param {string} options.description - Class description
     * @param {string} options.instructorId - Instructor ID
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function create(name, options) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var trimmedName = String(name).trim();

        // Check for duplicate name
        var existing = getClassByNameInternal(trimmedName);
        if (existing) {
            return failure('A class with this name already exists.');
        }

        options = options || {};

        // ---- PHASE 2: GET STORE ----
        var academy = ensureClassStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // Validate status
        var status = options.status || DEFAULT_STATUS;
        if (VALID_STATUSES.indexOf(status) === -1) {
            return failure('Invalid status. Must be one of: ' + VALID_STATUSES.join(', '));
        }

        // ---- PHASE 3: BUILD CLASS OBJECT ----
        var now = new Date().toISOString();
        var classId = generateId();

        var newClass = {
            id: classId,
            name: trimmedName,
            status: status,
            year: options.year || null,
            description: options.description || '',
            instructorId: options.instructorId || null,
            createdAt: now,
            updatedAt: now
        };

        // ---- PHASE 4: COMMIT ----
        academy.graduatingClasses[classId] = newClass;

        // Initialize student list
        if (!academy.classStudents[classId]) {
            academy.classStudents[classId] = [];
        }

        return success({
            class: newClass
        });
    }

    /**
     * Update an existing class.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} classId - Class ID
     * @param {object} updates - Updates to apply
     * @param {string} updates.name - New class name
     * @param {string} updates.status - New status
     * @param {number} updates.year - New graduation year
     * @param {string} updates.description - New description
     * @param {string} updates.instructorId - New instructor ID
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function update(classId, updates) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return failure('Updates are required.');
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureClassStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(classId);
        var existing = academy.graduatingClasses[target];

        if (!existing) {
            return failure('Class not found.');
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone class data.');
        }

        var hasChanges = false;

        // Name update
        if (updates.name !== undefined) {
            if (!isNonEmptyString(updates.name)) {
                return failure('Class name cannot be empty.');
            }
            var newName = String(updates.name).trim();
            if (newName !== existing.name) {
                // Check for duplicate name
                var duplicate = getClassByNameInternal(newName);
                if (duplicate && String(duplicate.id) !== target) {
                    return failure('A class with this name already exists.');
                }
                candidate.name = newName;
                hasChanges = true;
            }
        }

        // Status update
        if (updates.status !== undefined) {
            if (VALID_STATUSES.indexOf(updates.status) === -1) {
                return failure('Invalid status. Must be one of: ' + VALID_STATUSES.join(', '));
            }
            if (candidate.status !== updates.status) {
                candidate.status = updates.status;
                hasChanges = true;
            }
        }

        // Year update
        if (updates.year !== undefined) {
            if (updates.year !== null && (typeof updates.year !== 'number' || updates.year < 1900 || updates.year > 2100)) {
                return failure('Year must be a valid number between 1900 and 2100.');
            }
            if (candidate.year !== updates.year) {
                candidate.year = updates.year;
                hasChanges = true;
            }
        }

        // Description update
        if (updates.description !== undefined) {
            var newDescription = updates.description || '';
            if (candidate.description !== newDescription) {
                candidate.description = newDescription;
                hasChanges = true;
            }
        }

        // Instructor ID update
        if (updates.instructorId !== undefined) {
            var newInstructorId = updates.instructorId || null;
            if (candidate.instructorId !== newInstructorId) {
                candidate.instructorId = newInstructorId;
                hasChanges = true;
            }
        }

        if (!hasChanges) {
            return success({ class: existing, changed: false });
        }

        // ---- PHASE 5: COMMIT ----
        candidate.updatedAt = new Date().toISOString();
        academy.graduatingClasses[target] = candidate;

        return success({
            class: candidate,
            changed: true
        });
    }

    /**
     * Delete a class permanently.
     * Also removes all student memberships.
     * 
     * @param {string} classId - Class ID
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function deleteClass(classId) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureClassStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(classId);
        var existing = academy.graduatingClasses[target];

        if (!existing) {
            return failure('Class not found.');
        }

        var className = existing.name;

        // ---- PHASE 4: REMOVE ----
        delete academy.graduatingClasses[target];
        delete academy.classStudents[target];

        return success({
            deleted: true,
            classId: target,
            className: className
        });
    }

    // ============================================================
    // STUDENT MEMBERSHIP OPERATIONS
    // ============================================================

    /**
     * Add a student to a class.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function addStudent(classId, studentId) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureClassStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: VERIFY CLASS EXISTS ----
        var targetClass = String(classId);
        var existingClass = academy.graduatingClasses[targetClass];

        if (!existingClass) {
            return failure('Class not found.');
        }

        // ---- PHASE 4: CHECK FOR DUPLICATE ----
        if (isStudentInClassInternal(targetClass, studentId)) {
            return failure('Student is already in this class.');
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var targetStudent = String(studentId);
        var students = academy.classStudents[targetClass];

        if (!Array.isArray(students)) {
            students = [];
        }

        var candidateStudents = students.slice();
        candidateStudents.push(targetStudent);

        // ---- PHASE 6: COMMIT ----
        academy.classStudents[targetClass] = candidateStudents;

        return success({
            classId: targetClass,
            studentId: targetStudent,
            added: true
        });
    }

    /**
     * Remove a student from a class.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function removeStudent(classId, studentId) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureClassStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: VERIFY CLASS EXISTS ----
        var targetClass = String(classId);
        var existingClass = academy.graduatingClasses[targetClass];

        if (!existingClass) {
            return failure('Class not found.');
        }

        // ---- PHASE 4: CHECK STUDENT EXISTS IN CLASS ----
        var targetStudent = String(studentId);
        var students = academy.classStudents[targetClass];

        if (!Array.isArray(students) || students.length === 0) {
            return failure('Student is not in this class.');
        }

        var found = false;
        for (var i = 0; i < students.length; i++) {
            if (String(students[i]) === targetStudent) {
                found = true;
                break;
            }
        }

        if (!found) {
            return failure('Student is not in this class.');
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidateStudents = [];
        for (var j = 0; j < students.length; j++) {
            if (String(students[j]) !== targetStudent) {
                candidateStudents.push(students[j]);
            }
        }

        // ---- PHASE 6: COMMIT ----
        academy.classStudents[targetClass] = candidateStudents;

        return success({
            classId: targetClass,
            studentId: targetStudent,
            removed: true
        });
    }

    /**
     * Remove a student from all classes.
     * 
     * @param {string} studentId - Student ID
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function removeStudentFromAllClasses(studentId) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var academy = ensureClassStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        var targetStudent = String(studentId);
        var removedCount = 0;
        var removedFrom = [];

        for (var classId in academy.classStudents) {
            if (Object.prototype.hasOwnProperty.call(academy.classStudents, classId)) {
                var students = academy.classStudents[classId];
                if (!Array.isArray(students)) {
                    continue;
                }

                var found = false;
                var candidateStudents = [];

                for (var i = 0; i < students.length; i++) {
                    if (String(students[i]) === targetStudent) {
                        found = true;
                        removedFrom.push(classId);
                    } else {
                        candidateStudents.push(students[i]);
                    }
                }

                if (found) {
                    academy.classStudents[classId] = candidateStudents;
                    removedCount++;
                }
            }
        }

        return success({
            studentId: targetStudent,
            removedCount: removedCount,
            removedFrom: removedFrom
        });
    }

    // ============================================================
    // PUBLIC INTERNAL LOOKUP (for AcademyQueries)
    // These are exposed so AcademyQueries can delegate to them.
    // ============================================================

    /**
     * Get a class by ID (internal).
     * 
     * @param {string} classId - Class ID
     * @returns {object|null} Class object or null
     */
    function getClass(classId) {
        return getClassInternal(classId);
    }

    /**
     * Get all classes (internal).
     * 
     * @returns {array} Array of class objects
     */
    function getClasses() {
        return getClassesInternal();
    }

    /**
     * Get classes by status (internal).
     * 
     * @param {string} status - Status filter
     * @returns {array} Array of class objects
     */
    function getClassesByStatus(status) {
        return getClassesByStatusInternal(status);
    }

    /**
     * Get class by name (internal).
     * 
     * @param {string} name - Class name
     * @returns {object|null} Class object or null
     */
    function getClassByName(name) {
        return getClassByNameInternal(name);
    }

    /**
     * Get class display name (internal).
     * 
     * @param {string} classId - Class ID
     * @returns {string} Class display name
     */
    function getDisplayName(classId) {
        return getClassDisplayNameInternal(classId);
    }

    /**
     * Get class students (internal).
     * 
     * @param {string} classId - Class ID
     * @returns {array} Array of student IDs
     */
    function getClassStudents(classId) {
        return getClassStudentsInternal(classId);
    }

    /**
     * Check if a student is in a class (internal).
     * 
     * @param {object} character - Character object
     * @param {string} classId - Class ID
     * @returns {boolean} True if in class
     */
    function isCharacterInClass(character, classId) {
        if (!character || typeof character !== 'object') {
            return false;
        }
        var studentId = character.id;
        if (!studentId) {
            return false;
        }
        return isStudentInClassInternal(classId, studentId);
    }

    /**
     * Get character class names (internal).
     * 
     * @param {object} character - Character object
     * @returns {array} Array of class names
     */
    function getCharacterClassNames(character) {
        return getCharacterClassNamesInternal(character);
    }

    /**
     * Get character classes (internal).
     * 
     * @param {object} character - Character object
     * @returns {array} Array of class objects
     */
    function getCharacterClasses(character) {
        return getCharacterClassesInternal(character);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClasses = {
        // ---- Public Mutations ----
        create: create,
        update: update,
        delete: deleteClass,

        // ---- Student Membership ----
        addStudent: addStudent,
        removeStudent: removeStudent,
        removeStudentFromAllClasses: removeStudentFromAllClasses,

        // ---- Internal Lookup (for AcademyQueries) ----
        getClass: getClass,
        getClasses: getClasses,
        getClassesByStatus: getClassesByStatus,
        getClassByName: getClassByName,
        getDisplayName: getDisplayName,
        getClassStudents: getClassStudents,
        isCharacterInClass: isCharacterInClass,
        getCharacterClassNames: getCharacterClassNames,
        getCharacterClasses: getCharacterClasses,

        // ---- Internal (low-level) ----
        getClassInternal: getClassInternal,
        getClassesInternal: getClassesInternal,
        getClassesByStatusInternal: getClassesByStatusInternal,
        getClassByNameInternal: getClassByNameInternal,
        getClassStudentsInternal: getClassStudentsInternal,
        isStudentInClassInternal: isStudentInClassInternal,
        getClassDisplayNameInternal: getClassDisplayNameInternal,
        getCharacterClassNamesInternal: getCharacterClassNamesInternal,
        getCharacterClassesInternal: getCharacterClassesInternal,
        getClassStudentsWithDetailsInternal: getClassStudentsWithDetailsInternal,

        // ---- Constants ----
        VALID_STATUSES: VALID_STATUSES,
        DEFAULT_STATUS: DEFAULT_STATUS
    };

})();
