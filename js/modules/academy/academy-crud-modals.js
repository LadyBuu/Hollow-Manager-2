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
 * DISCIPLINE FORM: NOT HERE
 *   Discipline create/edit is handled inline in AcademyDisciplineView.
 *   The only discipline modal retained here is the delete-confirm. If
 *   you ever need a discipline form modal again, add it back explicitly
 *   rather than reviving the removed paths.
 *
 * MODAL SHAPE:
 *   Every modal has:
 *     - .modal-content wrapper
 *     - .modal-header with title + close button
 *     - .modal-body with form fields
 *     - .form-actions with Cancel + Submit buttons
 *   IDs are stable and unique per modal type, so tests can target them.
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal() may return either a bare `.modal` shell or one
 *   that already contains a `.modal-content`. The openModal helper in
 *   this file handles both: it reuses an existing `.modal-content` if
 *   present, and appends one otherwise. That way this file works under
 *   either version of the Modal utility.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.Modal (MANDATORY)
 *   - window.NotificationSystem (MANDATORY)
 *   - window.AcademyClasses (MANDATORY)
 *   - window.AcademyDisciplines (MANDATORY - for delete confirm)
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
 *   CRUD.openLocationForm(null);
 *   CRUD.openLocationDelete('loc_123');
 *   CRUD.openDisciplineDelete('disc_123');
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

    /**
     * Append content to a modal shell.
     *
     * Modal.createModal may return a bare `.modal` shell (new contract)
     * or one that already contains a `.modal-content` (older contract).
     * This helper handles both:
     *   - If the shell already has a `.modal-content`, reuse it.
     *   - Otherwise create one and append it.
     *   - Set innerHTML on the wrapper.
     *
     * The innerHTML assignment is deliberate: it replaces whatever was
     * inside (including any auto-generated close button, if any) with
     * the caller's HTML. Every form this module renders includes its
     * own `.close-modal` button, so we don't lose the ability to close.
     */
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
    // DISCIPLINE — DELETE CONFIRM HTML
    // ============================================================
    //
    // Discipline create/edit is handled inline in AcademyDisciplineView.
    // This delete-confirm modal remains because a confirm dialog is
    // better served by a modal than by a native confirm() call: it
    // matches the class and location delete UX, and it can show the
    // cascade semantics in a way that native confirm() cannot.

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
    // OPEN — DISCIPLINE DELETE
    // ============================================================
    //
    // Discipline create/edit is handled inline in AcademyDisciplineView.
    // This module only owns the delete-confirm modal. The inline editor
    // dispatches [data-action="delete-discipline"] which AcademyView
    // routes to this function.

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

        // Discipline — delete only. Create/edit is inline in the view.
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
            'openDisciplineDelete',
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
