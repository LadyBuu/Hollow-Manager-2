/**
 * modules/academy/academy-crud-modals.js - Academy CRUD Modals
 * Modal HTML builders + lifecycle helpers for Academy CRUD operations.
 *
 * Path: js/modules/academy/academy-crud-modals.js
 *
 * This module is responsible for:
 *   - Building modal HTML for Class CRUD (add, edit, delete confirm)
 *   - Building modal HTML for Location CRUD (add, edit, delete confirm)
 *   - Building modal HTML for adding a character to a class
 *   - Building the Discipline delete-confirm modal
 *   - Building the Social Score edit modal
 *   - Wiring modal buttons to the corresponding mutation APIs
 *   - Closing the modal on success, notifying on failure
 *
 * IMPORTANT:
 *   - This module ORCHESTRATES mutation calls but does not implement them.
 *   - All mutations go through AcademyClasses / AcademyDisciplines /
 *     AcademyLocations / AcademySocialScore / CharacterClasses, which
 *     route through MutationPipeline. The pipeline owns persistence and
 *     notification.
 *   - This module delegates rendering to pure HTML builders that take
 *     plain data and return strings.
 *   - All modals use window.Modal (createModal / showModal / closeModal).
 *   - All user-controlled content is escaped via DomUtils.
 *
 * ACADEMY READS:
 *   This module used to route class, discipline, and location reads
 *   through AcademyQueries. That facade is gone. Reads now go to the
 *   domain owners directly:
 *     - AcademyClasses       (class entities)
 *     - AcademyDisciplines   (discipline entities)
 *     - AcademyLocations     (location entities)
 *   CharacterQueries is used for roster display names.
 *
 * DISCIPLINE FORM: NOT HERE
 *   Discipline create/edit is handled inline in AcademyDisciplineView.
 *   The only discipline modal retained here is the delete-confirm.
 *
 * SOCIAL SCORE MODAL (Phase 5):
 *   A small modal with a single numeric input, the current value
 *   pre-filled (when one exists for the class + week), and a Save
 *   button. The save routes through AcademySocialScore.setSocialScore.
 *   The class + week context comes from AcademyUI (the caller passes
 *   classId and week explicitly).
 *
 * MODAL SHAPE:
 *   Every modal has:
 *     - .modal-content wrapper
 *     - .modal-header with title + close button
 *     - .modal-body with form fields
 *     - .form-actions with Cancel + Submit buttons
 *   IDs are stable and unique per modal type.
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal() returns a BARE `.modal` shell. The openModal
 *   helper below reuses an existing `.modal-content` if present, and
 *   appends one otherwise. That way this file works under either
 *   version of the Modal utility.
 *
 * DEPENDENCIES:
 *   - window.DomUtils            (MANDATORY)
 *   - window.Modal               (MANDATORY)
 *   - window.NotificationSystem  (MANDATORY)
 *   - window.AcademyClasses      (MANDATORY)
 *   - window.AcademyDisciplines  (MANDATORY - for delete confirm)
 *   - window.AcademyLocations    (MANDATORY)
 *   - window.CharacterQueries    (MANDATORY)
 *   - window.CharacterClasses    (MANDATORY)
 *   - window.AcademySocialScore  (LAZY - for social score modal)
 *   - window.AcademyUI           (LAZY - for class + week context)
 *
 * USAGE:
 *   var CRUD = window.AcademyCRUDModals;
 *   CRUD.openClassForm(null);         // create
 *   CRUD.openClassForm('class_123');  // edit
 *   CRUD.openClassDelete('class_123');
 *   CRUD.openAddCharacterToClass('class_123');
 *   CRUD.openLocationForm(null);
 *   CRUD.openLocationDelete('loc_123');
 *   CRUD.openDisciplineDelete('disc_123');
 *   CRUD.openSocialScoreForm('char_123');
 *
 *   // Called when the modal successfully submits/closes so that the
 *   // view can re-render.
 *   CRUD.setOnChangeCallback(fn);
 */

(function() {
    'use strict';

    if (window.__academyCRUDModalsLoaded) {
        return;
    }
    window.__academyCRUDModalsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyLocations = window.AcademyLocations;
    var CharacterQueries = window.CharacterQueries;
    var CharacterClasses = window.CharacterClasses;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }
        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }
        if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
            missing.push('AcademyClasses.getClass');
        }
        if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
            missing.push('AcademyDisciplines.getDiscipline');
        }
        if (!AcademyLocations || typeof AcademyLocations.getLocation !== 'function') {
            missing.push('AcademyLocations.getLocation');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }
        if (!CharacterClasses || typeof CharacterClasses.addToClass !== 'function') {
            missing.push('CharacterClasses.addToClass');
        }

        if (missing.length > 0) {
            console.warn('[AcademyCRUDModals] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getAcademyUI() {
        return window.AcademyUI || null;
    }

    function getAcademySocialScore() {
        return window.AcademySocialScore || null;
    }

    // ============================================================
    // CLASS LOOKUPS - via AcademyClasses
    // ============================================================

    function getClassRecord(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        return AcademyClasses.getClass(classId);
    }

    /**
     * Derive the class roster at the module boundary.
     *
     * Mirrors the derivation AcademyAggregator.getClassStudentsViewModel
     * uses: characters whose classIds include classId. The class
     * INSTRUCTOR is NOT included (they are a separate relationship).
     *
     * Returned for display only. The caller must not mutate the
     * returned objects — AcademyClasses and CharacterQueries return
     * live references from the store.
     *
     * @param {string} classId
     * @returns {array} Array of character objects
     */
    function getClassRoster(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var target = String(classId);
        var characters = CharacterQueries.getCharacters() || [];
        var result = [];

        for (var i = 0; i < characters.length; i++) {
            var c = characters[i];
            if (!c || !c.id) { continue; }
            if (!Array.isArray(c.classIds)) { continue; }
            for (var j = 0; j < c.classIds.length; j++) {
                if (String(c.classIds[j]) === target) {
                    result.push(c);
                    break;
                }
            }
        }

        return result;
    }

    // ============================================================
    // CHANGE NOTIFICATION
    // ============================================================

    var _onChange = null;

    function setOnChangeCallback(fn) {
        _onChange = (typeof fn === 'function') ? fn : null;
    }

    function notifyChange() {
        if (typeof _onChange === 'function') {
            try {
                _onChange();
            } catch (e) {
                console.warn('[AcademyCRUDModals] onChange callback threw:', e);
            }
        }
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    function appendModalContent(modal, html) {
        if (!modal) return;

        var contentEl = modal.querySelector('.modal-content');
        if (!contentEl) {
            contentEl = document.createElement('div');
            contentEl.className = 'modal-content';
            modal.appendChild(contentEl);
        }
        contentEl.innerHTML = html;
    }

    function openModal(className, html, onBind) {
        if (!checkDependencies()) {
            return null;
        }

        var modal = Modal.createModal(className);
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return null;
        }

        appendModalContent(modal, html);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        if (typeof onBind === 'function') {
            onBind(modal, closeModal);
        }

        return modal;
    }

    function closeModal(modal) {
        if (!modal) {
            return;
        }
        try {
            if (Modal && typeof Modal.closeModal === 'function') {
                Modal.closeModal(modal);
            }
        } catch (e) {
            console.warn('[AcademyCRUDModals] closeModal failed:', e);
        }
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    }

    function bindCommonModalControls(modal, onCancel) {
        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (typeof onCancel === 'function') { onCancel(); }
                closeModal(modal);
            });
        }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                if (typeof onCancel === 'function') { onCancel(); }
                closeModal(modal);
            });
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                if (typeof onCancel === 'function') { onCancel(); }
                closeModal(modal);
            }
        });
    }

    // ============================================================
    // CLASS — FORM HTML
    // ============================================================

    function buildClassFormHTML(cls) {
        var isEdit = !!cls;
        var c = cls || {};

        var statuses = ['active', 'archived', 'graduated'];

        var html = '';
        html += '<form id="academy-class-form" class="academy-crud-form" data-edit-id="' +
                    (isEdit ? escapeAttribute(c.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Class' : 'Create Class') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // Name
        html += '<div class="form-group">';
        html += '<label for="ac-class-name">Class Name *</label>';
        html += '<input type="text" id="ac-class-name" class="ac-class-name" ' +
                    'value="' + escapeAttribute(c.name || '') + '" required>';
        html += '</div>';

        // Year
        html += '<div class="form-group">';
        html += '<label for="ac-class-year">Year</label>';
        html += '<input type="number" id="ac-class-year" class="ac-class-year" ' +
                    'value="' + escapeAttribute(c.year !== undefined && c.year !== null ? String(c.year) : '') + '" ' +
                    'min="1" placeholder="e.g., 2026">';
        html += '<p class="field-hint">Any positive integer, or blank for unspecified.</p>';
        html += '</div>';

        // Status
        html += '<div class="form-group">';
        html += '<label for="ac-class-status">Status</label>';
        html += '<select id="ac-class-status" class="ac-class-status">';
        for (var i = 0; i < statuses.length; i++) {
            var s = statuses[i];
            var sel = (c.status || 'active') === s ? ' selected' : '';
            html += '<option value="' + escapeAttribute(s) + '"' + sel + '>' +
                        escapeHtml(s.charAt(0).toUpperCase() + s.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Description
        html += '<div class="form-group">';
        html += '<label for="ac-class-description">Description</label>';
        html += '<textarea id="ac-class-description" class="ac-class-description" rows="3" ' +
                    'placeholder="Optional description...">' +
                    escapeHtml(c.description || '') +
                '</textarea>';
        html += '</div>';

        // Actions
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Update' : 'Create') + ' Class' +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    // ============================================================
    // CLASS — DELETE CONFIRM HTML
    // ============================================================

    function buildClassDeleteHTML(cls) {
        var html = '';
        html += '<form id="academy-class-delete-form">';
        html += '<div class="modal-header">';
        html += '<h3>Delete Class</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' + escapeHtml(cls.name || 'this class') + '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the class entity, strips its ID from every character, ' +
                    'and deletes its teams, grades, rankings, and enrollments.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Class</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // CLASS — ADD CHARACTER HTML
    // ============================================================

    function buildAddCharacterToClassHTML(cls) {
        var currentIds = {};
        var students = getClassRoster(cls.id);

        for (var i = 0; i < students.length; i++) {
            if (students[i] && students[i].id) {
                currentIds[String(students[i].id)] = true;
            }
        }

        if (cls.instructorId) {
            currentIds[String(cls.instructorId)] = true;
        }

        var candidates = [];
        var all = CharacterQueries.getCharacters() || [];
        for (var j = 0; j < all.length; j++) {
            var c = all[j];
            if (!c || !c.id) { continue; }
            if (currentIds[String(c.id)]) { continue; }
            candidates.push({
                id: c.id,
                name: CharacterQueries.getDisplayName(c)
            });
        }

        candidates.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        var html = '';
        html += '<form id="academy-add-character-form" ' +
                    'data-class-id="' + escapeAttribute(cls.id) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Add Character to ' + escapeHtml(cls.name || 'Class') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="ac-add-character-select">Character</label>';
        html += '<select id="ac-add-character-select" class="ac-add-character-select" required>';
        html += '<option value="">Select a character...</option>';
        for (var k = 0; k < candidates.length; k++) {
            var cand = candidates[k];
            html += '<option value="' + escapeAttribute(cand.id) + '">' +
                        escapeHtml(cand.name) +
                    '</option>';
        }
        html += '</select>';

        if (candidates.length === 0) {
            html += '<p class="field-hint">All characters are already in this class.</p>';
        }

        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary"' +
                    (candidates.length === 0 ? ' disabled' : '') +
                    '>Add Character</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    // ============================================================
    // DISCIPLINE — DELETE CONFIRM HTML
    // ============================================================

    function buildDisciplineDeleteHTML(disc) {
        var html = '';
        html += '<form id="academy-discipline-delete-form">';
        html += '<div class="modal-header">';
        html += '<h3>Delete Discipline</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' + escapeHtml(disc.name || 'this discipline') + '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the discipline, its auto-groups, enrollments, ' +
                    'and any grades and schedule slots referencing it.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Discipline</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // LOCATION — FORM HTML
    // ============================================================

    function buildLocationFormHTML(loc) {
        var isEdit = !!loc;
        var l = loc || {};

        var types = [];
        var minCapacity = 1;
        var maxCapacity = 1000;

        if (AcademyLocations) {
            if (typeof AcademyLocations.getValidLocationTypes === 'function') {
                types = AcademyLocations.getValidLocationTypes() || [];
            } else if (Array.isArray(AcademyLocations.VALID_LOCATION_TYPES)) {
                types = AcademyLocations.VALID_LOCATION_TYPES.slice();
            }
            if (typeof AcademyLocations.MIN_CAPACITY === 'number') {
                minCapacity = AcademyLocations.MIN_CAPACITY;
            }
            if (typeof AcademyLocations.MAX_CAPACITY === 'number') {
                maxCapacity = AcademyLocations.MAX_CAPACITY;
            }
        }

        if (!Array.isArray(types) || types.length === 0) {
            types = ['classroom', 'lab', 'gym', 'field', 'hall', 'auditorium', 'library', 'office', 'other'];
        }

        var html = '';
        html += '<form id="academy-location-form" class="academy-crud-form" data-edit-id="' +
                    (isEdit ? escapeAttribute(l.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Location' : 'Create Location') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // Name
        html += '<div class="form-group">';
        html += '<label for="ac-loc-name">Location Name *</label>';
        html += '<input type="text" id="ac-loc-name" class="ac-loc-name" ' +
                    'value="' + escapeAttribute(l.name || '') + '" required>';
        html += '</div>';

        // Type
        html += '<div class="form-group">';
        html += '<label for="ac-loc-type">Type</label>';
        html += '<select id="ac-loc-type" class="ac-loc-type">';
        for (var i = 0; i < types.length; i++) {
            var t = types[i];
            var sel = (l.type || 'other') === t ? ' selected' : '';
            html += '<option value="' + escapeAttribute(t) + '"' + sel + '>' +
                        escapeHtml(t.charAt(0).toUpperCase() + t.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Capacity
        html += '<div class="form-group">';
        html += '<label for="ac-loc-capacity">Capacity</label>';
        html += '<input type="number" id="ac-loc-capacity" class="ac-loc-capacity" ' +
                    'value="' + escapeAttribute(l.capacity !== undefined && l.capacity !== null ? String(l.capacity) : '') + '" ' +
                    'min="' + escapeAttribute(String(minCapacity)) + '" ' +
                    'max="' + escapeAttribute(String(maxCapacity)) + '" ' +
                    'placeholder="Optional">';
        html += '</div>';

        // Actions
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Update' : 'Create') + ' Location' +
                '</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    // ============================================================
    // LOCATION — DELETE CONFIRM HTML
    // ============================================================

    function buildLocationDeleteHTML(loc) {
        var html = '';
        html += '<form id="academy-location-delete-form">';
        html += '<div class="modal-header">';
        html += '<h3>Delete Location</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<p>Delete <strong>' + escapeHtml(loc.name || 'this location') + '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the location, its weekly schedules, and ' +
                    'class-to-location assignments.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Location</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // SOCIAL SCORE — FORM HTML (Phase 5)
    // ============================================================

    function buildSocialScoreFormHTML(charId, classId, week, currentValue) {
        var minScore = 0;
        var maxScore = 100;

        var ASS = getAcademySocialScore();
        if (ASS) {
            if (typeof ASS.MIN_SCORE === 'number') { minScore = ASS.MIN_SCORE; }
            if (typeof ASS.MAX_SCORE === 'number') { maxScore = ASS.MAX_SCORE; }
        }

        var hasCurrent = typeof currentValue === 'number' && isFinite(currentValue);
        var currentStr = hasCurrent ? String(currentValue) : '';

        var html = '';
        html += '<form id="academy-social-score-form" ' +
                    'data-character-id="' + escapeAttribute(charId) + '" ' +
                    'data-class-id="' + escapeAttribute(classId) + '" ' +
                    'data-week="' + escapeAttribute(String(week)) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Set Social Score</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="ac-social-score-input">Score (' +
                    escapeHtml(String(minScore)) + '\u2013' +
                    escapeHtml(String(maxScore)) +
                ')</label>';
        html += '<input type="number" id="ac-social-score-input" ' +
                    'class="ac-social-score-input" ' +
                    'value="' + escapeAttribute(currentStr) + '" ' +
                    'min="' + escapeAttribute(String(minScore)) + '" ' +
                    'max="' + escapeAttribute(String(maxScore)) + '" ' +
                    'step="1" required>';
        html += '<p class="field-hint">' +
                    'Social score contributes to the overall performance blend ' +
                    'for this student in this class for the selected week.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">Save</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    // ============================================================
    // OPEN — CLASS FORM
    // ============================================================

    function openClassForm(classId) {
        var cls = null;
        if (classId) {
            cls = getClassRecord(classId);
        }

        var html = buildClassFormHTML(cls);

        openModal('academy-class-form-modal', html, function(modal) {
            bindCommonModalControls(modal);

            var form = modal.querySelector('#academy-class-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var nameInput = form.querySelector('.ac-class-name');
                var yearInput = form.querySelector('.ac-class-year');
                var statusInput = form.querySelector('.ac-class-status');
                var descInput = form.querySelector('.ac-class-description');

                var name = nameInput ? nameInput.value.trim() : '';
                var yearRaw = yearInput ? yearInput.value.trim() : '';
                var status = statusInput ? statusInput.value : 'active';
                var description = descInput ? descInput.value.trim() : '';

                if (!name) {
                    notify('Class name is required.', 'error');
                    return;
                }

                var yearValue = yearRaw === '' ? null : parseInt(yearRaw, 10);

                if (!AcademyClasses) {
                    notify('Class module not available.', 'error');
                    return;
                }

                var promise;
                if (cls && cls.id) {
                    promise = AcademyClasses.update(cls.id, {
                        name: name,
                        year: yearValue,
                        status: status,
                        description: description
                    });
                } else {
                    promise = AcademyClasses.create(name, {
                        year: yearValue,
                        status: status,
                        description: description
                    });
                }

                promise.then(function(result) {
                    if (result && result.success) {
                        closeModal(modal);
                        notifyChange();
                    }
                    // On failure, MutationPipeline has already notified.
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Class save failed:', err);
                    notify('Failed to save class.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — CLASS DELETE
    // ============================================================

    function openClassDelete(classId) {
        var cls = getClassRecord(classId);
        if (!cls) {
            notify('Class not found.', 'error');
            return;
        }

        var html = buildClassDeleteHTML(cls);

        openModal('academy-class-delete-modal', html, function(modal) {
            bindCommonModalControls(modal);

            var form = modal.querySelector('#academy-class-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                if (!AcademyClasses || typeof AcademyClasses.delete !== 'function') {
                    notify('Class module not available.', 'error');
                    return;
                }

                AcademyClasses.delete(cls.id).then(function(result) {
                    if (result && result.success) {
                        closeModal(modal);
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Class delete failed:', err);
                    notify('Failed to delete class.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — ADD CHARACTER TO CLASS
    // ============================================================

    function openAddCharacterToClass(classId) {
        var cls = getClassRecord(classId);
        if (!cls) {
            notify('Class not found.', 'error');
            return;
        }

        var html = buildAddCharacterToClassHTML(cls);

        openModal('academy-add-character-modal', html, function(modal) {
            bindCommonModalControls(modal);

            var form = modal.querySelector('#academy-add-character-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var select = form.querySelector('.ac-add-character-select');
                var charId = select ? select.value : '';
                if (!charId) {
                    notify('Please select a character.', 'error');
                    return;
                }

                if (!CharacterClasses || typeof CharacterClasses.addToClass !== 'function') {
                    notify('Character classes module not available.', 'error');
                    return;
                }

                CharacterClasses.addToClass(charId, cls.id).then(function(result) {
                    if (result && result.success) {
                        closeModal(modal);
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Add character failed:', err);
                    notify('Failed to add character.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — DISCIPLINE DELETE
    // ============================================================

    function openDisciplineDelete(disciplineId) {
        var disc = null;
        if (isNonEmptyString(disciplineId)) {
            disc = AcademyDisciplines.getDiscipline(disciplineId);
        }

        if (!disc) {
            notify('Discipline not found.', 'error');
            return;
        }

        var html = buildDisciplineDeleteHTML(disc);

        openModal('academy-discipline-delete-modal', html, function(modal) {
            bindCommonModalControls(modal);

            var form = modal.querySelector('#academy-discipline-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                if (!AcademyDisciplines || typeof AcademyDisciplines.delete !== 'function') {
                    notify('Discipline module not available.', 'error');
                    return;
                }

                AcademyDisciplines.delete(disc.id).then(function(result) {
                    if (result && result.success) {
                        closeModal(modal);
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Discipline delete failed:', err);
                    notify('Failed to delete discipline.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — LOCATION FORM
    // ============================================================

    function openLocationForm(locationId) {
        var loc = null;
        if (locationId) {
            loc = AcademyLocations.getLocation(locationId);
        }

        var html = buildLocationFormHTML(loc);

        openModal('academy-location-form-modal', html, function(modal) {
            bindCommonModalControls(modal);

            var form = modal.querySelector('#academy-location-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var nameInput = form.querySelector('.ac-loc-name');
                var typeInput = form.querySelector('.ac-loc-type');
                var capInput = form.querySelector('.ac-loc-capacity');

                var name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    notify('Location name is required.', 'error');
                    return;
                }

                var capRaw = capInput ? capInput.value.trim() : '';
                var capacity = capRaw === '' ? null : parseInt(capRaw, 10);

                var payload = {
                    name: name,
                    type: typeInput ? typeInput.value : 'other',
                    capacity: capacity
                };

                if (!AcademyLocations) {
                    notify('Location module not available.', 'error');
                    return;
                }

                var promise;
                if (loc && loc.id) {
                    promise = AcademyLocations.update(loc.id, payload);
                } else {
                    promise = AcademyLocations.create(payload);
                }

                promise.then(function(result) {
                    if (result && result.success) {
                        closeModal(modal);
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Location save failed:', err);
                    notify('Failed to save location.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — LOCATION DELETE
    // ============================================================

    function openLocationDelete(locationId) {
        var loc = AcademyLocations.getLocation(locationId);
        if (!loc) {
            notify('Location not found.', 'error');
            return;
        }

        var html = buildLocationDeleteHTML(loc);

        openModal('academy-location-delete-modal', html, function(modal) {
            bindCommonModalControls(modal);

            var form = modal.querySelector('#academy-location-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                if (!AcademyLocations || typeof AcademyLocations.delete !== 'function') {
                    notify('Location module not available.', 'error');
                    return;
                }

                AcademyLocations.delete(loc.id).then(function(result) {
                    if (result && result.success) {
                        closeModal(modal);
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Location delete failed:', err);
                    notify('Failed to delete location.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — SOCIAL SCORE (Phase 5)
    // ============================================================

    function openSocialScoreForm(charId, classId, week) {
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var UI = getAcademyUI();

        // Resolve classId.
        var resolvedClassId = classId;
        if (!isNonEmptyString(resolvedClassId)) {
            if (UI && typeof UI.getSelectedClassId === 'function') {
                resolvedClassId = UI.getSelectedClassId();
            }
        }

        if (!isNonEmptyString(resolvedClassId)) {
            notify('Select a class before editing a social score.', 'error');
            return;
        }

        // Resolve week.
        var resolvedWeek = parseInt(week, 10);
        if (isNaN(resolvedWeek)) {
            if (UI && typeof UI.getDisplayWeek === 'function') {
                resolvedWeek = parseInt(UI.getDisplayWeek(), 10);
            }
        }

        if (isNaN(resolvedWeek)) {
            notify('No week selected.', 'error');
            return;
        }

        // Read current value (may be null).
        var currentValue = null;
        var ASS = getAcademySocialScore();
        if (ASS && typeof ASS.getSocialScore === 'function') {
            try {
                currentValue = ASS.getSocialScore(charId, resolvedClassId, resolvedWeek);
            } catch (e) {
                console.warn('[AcademyCRUDModals] getSocialScore failed:', e);
                currentValue = null;
            }
        }

        var html = buildSocialScoreFormHTML(
            charId,
            resolvedClassId,
            resolvedWeek,
            currentValue
        );

        openModal('academy-social-score-modal', html, function(modal) {
            bindCommonModalControls(modal);

            var form = modal.querySelector('#academy-social-score-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var input = form.querySelector('.ac-social-score-input');
                var raw = input ? input.value.trim() : '';

                if (raw === '') {
                    notify('Score is required.', 'error');
                    return;
                }

                var value = parseFloat(raw);
                if (isNaN(value)) {
                    notify('Score must be a number.', 'error');
                    return;
                }

                var Score = getAcademySocialScore();
                if (!Score || typeof Score.setSocialScore !== 'function') {
                    notify('Social score module not available.', 'error');
                    return;
                }

                Score.setSocialScore(
                    charId,
                    resolvedClassId,
                    resolvedWeek,
                    value
                ).then(function(result) {
                    if (result && result.success) {
                        closeModal(modal);
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Set social score failed:', err);
                    notify('Failed to save social score.', 'error');
                });
            });
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCRUDModals = {
        // Class
        openClassForm: openClassForm,
        openClassDelete: openClassDelete,
        openAddCharacterToClass: openAddCharacterToClass,

        // Discipline — delete only.
        openDisciplineDelete: openDisciplineDelete,

        // Location
        openLocationForm: openLocationForm,
        openLocationDelete: openLocationDelete,

        // Social score (Phase 5)
        openSocialScoreForm: openSocialScoreForm,

        // Wiring
        setOnChangeCallback: setOnChangeCallback,

        // HTML builders (exposed for testing)
        buildClassFormHTML: buildClassFormHTML,
        buildClassDeleteHTML: buildClassDeleteHTML,
        buildAddCharacterToClassHTML: buildAddCharacterToClassHTML,
        buildDisciplineDeleteHTML: buildDisciplineDeleteHTML,
        buildLocationFormHTML: buildLocationFormHTML,
        buildLocationDeleteHTML: buildLocationDeleteHTML,
        buildSocialScoreFormHTML: buildSocialScoreFormHTML
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyCRUDModals;
        var missing = [];

        var required = [
            'openClassForm', 'openClassDelete', 'openAddCharacterToClass',
            'openDisciplineDelete',
            'openLocationForm', 'openLocationDelete',
            'openSocialScoreForm',
            'setOnChangeCallback'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyCRUDModals] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
