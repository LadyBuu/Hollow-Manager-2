/**
 * modules/academy/academy-crud-modals.js - Academy CRUD Modals
 * Modal HTML builders + lifecycle helpers for Academy CRUD operations.
 *
 * Path: js/modules/academy/academy-crud-modals.js
 *
 * This module is responsible for:
 *   - Building modal HTML for Class CRUD (add, edit, delete confirm)
 *   - Building modal HTML for Discipline CRUD (add, edit, delete confirm)
 *   - Building modal HTML for Location CRUD (add, edit, delete confirm)
 *   - Building modal HTML for adding a character to a class
 *   - Wiring modal buttons to the corresponding mutation APIs
 *   - Closing the modal on success, notifying on failure
 *
 * IMPORTANT:
 *   - This module ORCHESTRATES mutation calls but does not implement them.
 *   - All mutations go through AcademyClasses / AcademyDisciplines /
 *     AcademyLocations / CharacterClasses, which route through the
 *     MutationPipeline. The pipeline owns persistence and notification.
 *   - This module delegates rendering to pure HTML builders that take
 *     plain data and return strings.
 *   - All modals use window.Modal (createModal / showModal / closeModal).
 *   - All user-controlled content is escaped via DomUtils.
 *
 * MODAL SHAPE:
 *   Every modal has:
 *     - .modal-content wrapper
 *     - .modal-header with title + close button
 *     - .modal-body with form fields
 *     - .form-actions with Cancel + Submit buttons
 *   IDs are stable and unique per modal type, so tests can target them.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.Modal (MANDATORY)
 *   - window.NotificationSystem (MANDATORY)
 *   - window.AcademyClasses (MANDATORY)
 *   - window.AcademyDisciplines (MANDATORY)
 *   - window.AcademyLocations (MANDATORY)
 *   - window.AcademyQueries (MANDATORY)
 *   - window.CharacterQueries (MANDATORY)
 *   - window.CharacterClasses (MANDATORY)
 *
 * USAGE:
 *   var CRUD = window.AcademyCRUDModals;
 *   CRUD.openClassForm(null);         // create
 *   CRUD.openClassForm('class_123');  // edit
 *   CRUD.openClassDelete('class_123');
 *   CRUD.openAddCharacterToClass('class_123');
 *   CRUD.openDisciplineForm(null);
 *   CRUD.openDisciplineDelete('disc_123');
 *   CRUD.openLocationForm(null);
 *   CRUD.openLocationDelete('loc_123');
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

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
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
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // CHANGE NOTIFICATION
    // ============================================================
    //
    // The view registers a callback so it can re-render after a
    // mutation succeeds. This module does not know about the view's
    // container or render function.

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

    function openModal(className, html, onBind) {
        if (!checkDependencies()) {
            return null;
        }

        var modal = Modal.createModal(className);
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return null;
        }

        // Some Modal implementations wrap content in .modal-content.
        // Ours expects a raw shell. We build it here.
        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = html;

        modal.appendChild(contentEl);
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

    /**
     * Bind common modal controls: close button, overlay click,
     * cancel button.
     */
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
                    'and deletes its teams, grades, and rankings.' +
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
        var students = [];

        // Roster derived from character.classIds via AcademyQueries.
        var AcademyQueries = window.AcademyQueries;
        var CharacterQueries = window.CharacterQueries;

        if (AcademyQueries && typeof AcademyQueries.getClassStudents === 'function') {
            students = AcademyQueries.getClassStudents(cls.id) || [];
            for (var i = 0; i < students.length; i++) {
                if (students[i] && students[i].id) {
                    currentIds[String(students[i].id)] = true;
                }
            }
        }

        // Also exclude the instructor so we don't offer them.
        if (cls.instructorId) {
            currentIds[String(cls.instructorId)] = true;
        }

        var candidates = [];
        if (CharacterQueries && typeof CharacterQueries.getCharacters === 'function') {
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
    // DISCIPLINE — FORM HTML
    // ============================================================

    function buildDisciplineFormHTML(disc) {
        var isEdit = !!disc;
        var d = disc || {};

        var Constants = window.AcademyDisciplines || {};
        var minWeek = (window.CalendarConstants && window.CalendarConstants.MIN_WEEK) || 1;
        var maxWeek = (window.CalendarConstants && window.CalendarConstants.MAX_WEEK) || 52;
        var minHours = Constants.MIN_WEEKLY_HOURS || 0.5;
        var maxHours = Constants.MAX_WEEKLY_HOURS || 40;
        var minWeight = Constants.MIN_WEIGHT || 0.1;
        var maxWeight = Constants.MAX_WEIGHT || 10;

        var types = ['mandatory', 'optional'];

        // Instructor candidates
        var instructors = [];
        if (window.CharacterQueries && typeof window.CharacterQueries.getInstructors === 'function') {
            instructors = window.CharacterQueries.getInstructors() || [];
        }
        var selectedInstructors = {};
        if (Array.isArray(d.instructorIds)) {
            for (var i = 0; i < d.instructorIds.length; i++) {
                selectedInstructors[String(d.instructorIds[i])] = true;
            }
        }

        var html = '';
        html += '<form id="academy-discipline-form" class="academy-crud-form" data-edit-id="' +
                    (isEdit ? escapeAttribute(d.id) : '') + '">';

        html += '<div class="modal-header">';
        html += '<h3>' + (isEdit ? 'Edit Discipline' : 'Create Discipline') + '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // Name
        html += '<div class="form-group">';
        html += '<label for="ac-disc-name">Discipline Name *</label>';
        html += '<input type="text" id="ac-disc-name" class="ac-disc-name" ' +
                    'value="' + escapeAttribute(d.name || '') + '" required>';
        html += '</div>';

        // Type
        html += '<div class="form-group">';
        html += '<label for="ac-disc-type">Type</label>';
        html += '<select id="ac-disc-type" class="ac-disc-type">';
        for (var t = 0; t < types.length; t++) {
            var type = types[t];
            var sel = (d.type || 'mandatory') === type ? ' selected' : '';
            html += '<option value="' + escapeAttribute(type) + '"' + sel + '>' +
                        escapeHtml(type.charAt(0).toUpperCase() + type.slice(1)) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Start / End weeks
        html += '<div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        html += '<div class="form-group">';
        html += '<label for="ac-disc-start-week">Start Week</label>';
        html += '<input type="number" id="ac-disc-start-week" class="ac-disc-start-week" ' +
                    'value="' + escapeAttribute(String(d.startWeek !== undefined && d.startWeek !== null ? d.startWeek : minWeek)) + '" ' +
                    'min="' + minWeek + '" max="' + maxWeek + '">';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label for="ac-disc-end-week">End Week</label>';
        html += '<input type="number" id="ac-disc-end-week" class="ac-disc-end-week" ' +
                    'value="' + escapeAttribute(String(d.endWeek !== undefined && d.endWeek !== null ? d.endWeek : maxWeek)) + '" ' +
                    'min="' + minWeek + '" max="' + maxWeek + '">';
        html += '</div>';
        html += '</div>';

        // Weekly hours / weight
        html += '<div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
        html += '<div class="form-group">';
        html += '<label for="ac-disc-weekly-hours">Weekly Hours</label>';
        html += '<input type="number" step="0.5" id="ac-disc-weekly-hours" class="ac-disc-weekly-hours" ' +
                    'value="' + escapeAttribute(String(d.weeklyHours !== undefined && d.weeklyHours !== null ? d.weeklyHours : 1)) + '" ' +
                    'min="' + minHours + '" max="' + maxHours + '">';
        html += '</div>';
        html += '<div class="form-group">';
        html += '<label for="ac-disc-weight">Weight</label>';
        html += '<input type="number" step="0.1" id="ac-disc-weight" class="ac-disc-weight" ' +
                    'value="' + escapeAttribute(String(d.weight !== undefined && d.weight !== null ? d.weight : 1)) + '" ' +
                    'min="' + minWeight + '" max="' + maxWeight + '">';
        html += '</div>';
        html += '</div>';

        // Instructors
        html += '<div class="form-group">';
        html += '<label for="ac-disc-instructors">Instructors</label>';
        html += '<select id="ac-disc-instructors" class="ac-disc-instructors" multiple size="6" ' +
                    'style="width:100%;min-height:120px;">';
        if (instructors.length === 0) {
            html += '<option value="" disabled>No instructors available</option>';
        } else {
            for (var k = 0; k < instructors.length; k++) {
                var inst = instructors[k];
                if (!inst || !inst.id) { continue; }
                var name = window.CharacterQueries.getDisplayName(inst);
                var isSel = selectedInstructors[String(inst.id)] ? ' selected' : '';
                html += '<option value="' + escapeAttribute(inst.id) + '"' + isSel + '>' +
                            escapeHtml(name) +
                        '</option>';
            }
        }
        html += '</select>';
        html += '<p class="field-hint">Ctrl/Cmd-click to select multiple.</p>';
        html += '</div>';

        // Actions
        html += '<div class="form-actions">';
        html += '<button type="button" class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Update' : 'Create') + ' Discipline' +
                '</button>';
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
                    'This removes the discipline, its auto-groups, and any grades and ' +
                    'schedule slots referencing it.' +
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

        var LocationConstants = window.AcademyLocations || {};
        var types = LocationConstants.VALID_LOCATION_TYPES || [
            'classroom', 'lab', 'gym', 'field', 'hall', 'auditorium',
            'library', 'office', 'other'
        ];
        var minCapacity = LocationConstants.MIN_CAPACITY || 1;
        var maxCapacity = LocationConstants.MAX_CAPACITY || 1000;

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
                    'min="' + minCapacity + '" max="' + maxCapacity + '" ' +
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
    // OPEN — CLASS FORM
    // ============================================================

    function openClassForm(classId) {
        var cls = null;
        if (classId && window.AcademyQueries && typeof window.AcademyQueries.getClass === 'function') {
            cls = window.AcademyQueries.getClass(classId);
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

                var AcademyClasses = window.AcademyClasses;
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
        var cls = null;
        if (window.AcademyQueries && typeof window.AcademyQueries.getClass === 'function') {
            cls = window.AcademyQueries.getClass(classId);
        }
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

                var AcademyClasses = window.AcademyClasses;
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
        var cls = null;
        if (window.AcademyQueries && typeof window.AcademyQueries.getClass === 'function') {
            cls = window.AcademyQueries.getClass(classId);
        }
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

                var CharacterClasses = window.CharacterClasses;
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
    // OPEN — DISCIPLINE FORM
    // ============================================================

    function openDisciplineForm(disciplineId) {
        var disc = null;
        if (disciplineId && window.AcademyQueries && typeof window.AcademyQueries.getDiscipline === 'function') {
            disc = window.AcademyQueries.getDiscipline(disciplineId);
        } else if (disciplineId && window.AcademyDisciplines && typeof window.AcademyDisciplines.getDiscipline === 'function') {
            disc = window.AcademyDisciplines.getDiscipline(disciplineId);
        }

        var html = buildDisciplineFormHTML(disc);

        openModal('academy-discipline-form-modal', html, function(modal) {
            bindCommonModalControls(modal);

            var form = modal.querySelector('#academy-discipline-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var nameInput = form.querySelector('.ac-disc-name');
                var typeInput = form.querySelector('.ac-disc-type');
                var startInput = form.querySelector('.ac-disc-start-week');
                var endInput = form.querySelector('.ac-disc-end-week');
                var hoursInput = form.querySelector('.ac-disc-weekly-hours');
                var weightInput = form.querySelector('.ac-disc-weight');
                var instrSelect = form.querySelector('.ac-disc-instructors');

                var name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    notify('Discipline name is required.', 'error');
                    return;
                }

                var instructorIds = [];
                if (instrSelect) {
                    for (var i = 0; i < instrSelect.options.length; i++) {
                        if (instrSelect.options[i].selected && instrSelect.options[i].value) {
                            instructorIds.push(instrSelect.options[i].value);
                        }
                    }
                }

                var payload = {
                    name: name,
                    type: typeInput ? typeInput.value : 'mandatory',
                    startWeek: startInput ? parseInt(startInput.value, 10) : undefined,
                    endWeek: endInput ? parseInt(endInput.value, 10) : undefined,
                    weeklyHours: hoursInput ? parseFloat(hoursInput.value) : undefined,
                    weight: weightInput ? parseFloat(weightInput.value) : undefined,
                    instructorIds: instructorIds
                };

                var AcademyDisciplines = window.AcademyDisciplines;
                if (!AcademyDisciplines) {
                    notify('Discipline module not available.', 'error');
                    return;
                }

                var promise;
                if (disc && disc.id) {
                    promise = AcademyDisciplines.update(disc.id, payload);
                } else {
                    promise = AcademyDisciplines.create(payload);
                }

                promise.then(function(result) {
                    if (result && result.success) {
                        closeModal(modal);
                        notifyChange();
                    }
                }).catch(function(err) {
                    console.warn('[AcademyCRUDModals] Discipline save failed:', err);
                    notify('Failed to save discipline.', 'error');
                });
            });
        });
    }

    // ============================================================
    // OPEN — DISCIPLINE DELETE
    // ============================================================

    function openDisciplineDelete(disciplineId) {
        var disc = null;
        if (window.AcademyQueries && typeof window.AcademyQueries.getDiscipline === 'function') {
            disc = window.AcademyQueries.getDiscipline(disciplineId);
        } else if (window.AcademyDisciplines && typeof window.AcademyDisciplines.getDiscipline === 'function') {
            disc = window.AcademyDisciplines.getDiscipline(disciplineId);
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

                var AcademyDisciplines = window.AcademyDisciplines;
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
        if (locationId && window.AcademyQueries && typeof window.AcademyQueries.getLocation === 'function') {
            loc = window.AcademyQueries.getLocation(locationId);
        } else if (locationId && window.AcademyLocations && typeof window.AcademyLocations.getLocation === 'function') {
            loc = window.AcademyLocations.getLocation(locationId);
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

                var AcademyLocations = window.AcademyLocations;
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
        var loc = null;
        if (window.AcademyQueries && typeof window.AcademyQueries.getLocation === 'function') {
            loc = window.AcademyQueries.getLocation(locationId);
        } else if (window.AcademyLocations && typeof window.AcademyLocations.getLocation === 'function') {
            loc = window.AcademyLocations.getLocation(locationId);
        }
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

                var AcademyLocations = window.AcademyLocations;
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
    // EXPOSE
    // ============================================================

    window.AcademyCRUDModals = {
        // Class
        openClassForm: openClassForm,
        openClassDelete: openClassDelete,
        openAddCharacterToClass: openAddCharacterToClass,

        // Discipline
        openDisciplineForm: openDisciplineForm,
        openDisciplineDelete: openDisciplineDelete,

        // Location
        openLocationForm: openLocationForm,
        openLocationDelete: openLocationDelete,

        // Wiring
        setOnChangeCallback: setOnChangeCallback,

        // HTML builders (exposed for testing)
        buildClassFormHTML: buildClassFormHTML,
        buildClassDeleteHTML: buildClassDeleteHTML,
        buildAddCharacterToClassHTML: buildAddCharacterToClassHTML,
        buildDisciplineFormHTML: buildDisciplineFormHTML,
        buildDisciplineDeleteHTML: buildDisciplineDeleteHTML,
        buildLocationFormHTML: buildLocationFormHTML,
        buildLocationDeleteHTML: buildLocationDeleteHTML
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyCRUDModals;
        var missing = [];

        var required = [
            'openClassForm', 'openClassDelete', 'openAddCharacterToClass',
            'openDisciplineForm', 'openDisciplineDelete',
            'openLocationForm', 'openLocationDelete',
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