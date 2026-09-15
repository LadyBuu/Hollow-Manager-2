/**
 * modules/academy/academy-crud-modals.js - Academy CRUD Modals
 * Modal HTML builders + lifecycle helpers for Academy CRUD operations.
 *
 * Path: js/modules/academy/academy-crud-modals.js
 *
 * RESPONSIBILITIES:
 *   - Build modal HTML for Class, Location, and Discipline CRUD
 *   - Build the Social Score editor modal
 *   - Build the Add Character to Class modal
 *   - Open the modal via window.Modal
 *   - Wire form submission to the domain mutation
 *   - Close on success; leave open on failure so the user can retry
 *
 * NOT RESPONSIBILITIES:
 *   - Domain validation. Every mutation goes through its domain module,
 *     which routes through MutationPipeline. The pipeline validates.
 *   - Notifications. The pipeline notifies on success and failure.
 *     This module only notifies when it invokes a caller-supplied
 *     onChange callback.
 *   - Roster derivation. The roster is derived by the aggregator;
 *     this module receives the resulting candidate list.
 *
 * INPUT BOUNDS:
 *   Every enumerated input (statuses, location types, capacity bounds,
 *   social-score bounds) is read from its owning domain module. The
 *   builders do not hardcode any of these. When a caller wants to add
 *   a new status or type, they add it to the domain module and the
 *   modal picks it up.
 *
 * STRICT PARSING:
 *   Integer inputs (class year, location capacity) are parsed via
 *   ValidationUtils.parseStrictPositiveInteger. Inputs like "2026foo",
 *   "3.9", and "-1" are rejected. Blank input is treated as null
 *   (unset) where the field is optional.
 *
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal(className) returns a bare .modal shell. This
 *   module's openModal helper appends a fresh .modal-content wrapper
 *   before setup, matching the contract used by every other Academy
 *   modal module.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.ValidationUtils
 *   - window.AcademyClasses
 *   - window.AcademyDisciplines
 *   - window.AcademyLocations
 *   - window.CharacterQueries
 *   - window.AcademyAggregator
 *
 * DEPENDENCIES (OPTIONAL, lazily accessed):
 *   - window.CharacterClasses   — required for Add Character to Class
 *   - window.AcademySocialScore — required for the Social Score modal
 */

(function() {
    'use strict';

    if (window.__academyCRUDModalsLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var ValidationUtils = window.ValidationUtils;
    var AcademyClasses = window.AcademyClasses;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyLocations = window.AcademyLocations;
    var CharacterQueries = window.CharacterQueries;
    var AcademyAggregator = window.AcademyAggregator;

    var _missing = [];

    if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
        _missing.push('DomUtils.escapeHtml');
    }
    if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeAttribute');
    }
    if (!Modal || typeof Modal.createModal !== 'function') {
        _missing.push('Modal.createModal');
    }
    if (!Modal || typeof Modal.showModal !== 'function') {
        _missing.push('Modal.showModal');
    }
    if (!Modal || typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal.modalSetup');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!ValidationUtils || typeof ValidationUtils.parseStrictPositiveInteger !== 'function') {
        _missing.push('ValidationUtils.parseStrictPositiveInteger');
    }
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!AcademyClasses || !Array.isArray(AcademyClasses.VALID_STATUSES)) {
        _missing.push('AcademyClasses.VALID_STATUSES');
    }
    if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyLocations || typeof AcademyLocations.getLocation !== 'function') {
        _missing.push('AcademyLocations.getLocation');
    }
    if (!AcademyLocations || typeof AcademyLocations.getValidLocationTypes !== 'function') {
        _missing.push('AcademyLocations.getValidLocationTypes');
    }
    if (!AcademyLocations ||
        typeof AcademyLocations.MIN_CAPACITY !== 'number' ||
        typeof AcademyLocations.MAX_CAPACITY !== 'number') {
        _missing.push('AcademyLocations.MIN_CAPACITY / MAX_CAPACITY');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
        _missing.push('CharacterQueries.getCharacters');
    }
    if (!AcademyAggregator || typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyCRUDModals] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyCRUDModalsLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getCharacterClasses() {
        return window.CharacterClasses || null;
    }

    function getAcademySocialScore() {
        return window.AcademySocialScore || null;
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

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    // ============================================================
    // DOMAIN LOOKUPS
    // ============================================================

    function getClassRecord(classId) {
        if (!isNonEmptyString(classId)) { return null; }
        return AcademyClasses.getClass(classId);
    }

    function getDisciplineRecord(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return null; }
        return AcademyDisciplines.getDiscipline(disciplineId);
    }

    function getLocationRecord(locationId) {
        if (!isNonEmptyString(locationId)) { return null; }
        return AcademyLocations.getLocation(locationId);
    }

    // ============================================================
    // CHANGE NOTIFICATION
    // ============================================================

    var _onChange = null;

    function setOnChangeCallback(fn) {
        _onChange = (typeof fn === 'function') ? fn : null;
    }

    function notifyChange() {
        if (typeof _onChange !== 'function') { return; }
        try {
            _onChange();
        } catch (e) {
            console.warn('[AcademyCRUDModals] onChange callback threw:', e);
        }
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    function openModal(className, html, onBind) {
        var modal = Modal.createModal(className);
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return null;
        }

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = html || '';
        modal.appendChild(contentEl);

        Modal.modalSetup(modal);
        Modal.showModal(modal);

        var close = function() {
            closeModal(modal);
        };

        if (typeof onBind === 'function') {
            onBind(modal, close);
        }

        return modal;
    }

    function closeModal(modal) {
        if (!modal) { return; }

        try {
            if (typeof Modal.hideModal === 'function') {
                Modal.hideModal(modal);
            } else if (typeof Modal.closeModal === 'function') {
                Modal.closeModal(modal);
            }
        } catch (e) {
            console.warn('[AcademyCRUDModals] Modal close failed:', e);
        }

        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    }

    function bindCommonModalControls(modal, close) {
        if (!modal || typeof close !== 'function') { return; }

        var closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', close);
        }

        var cancelBtn = modal.querySelector('.cancel-modal-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', close);
        }

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                close();
            }
        });
    }

    // ============================================================
    // CLASS — FORM HTML
    // ============================================================

    function buildClassFormHTML(cls) {
        var isEdit = !!cls;
        var c = cls || {};

        var statuses = AcademyClasses.VALID_STATUSES;

        var html = '';
        html += '<form id="academy-class-form" class="academy-crud-form" ' +
                    'data-edit-id="' +
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
                    'value="' + escapeAttribute(
                        c.year !== undefined && c.year !== null
                            ? String(c.year)
                            : ''
                    ) + '" ' +
                    'min="1" placeholder="e.g., 2026">';
        html += '<p class="field-hint">' +
                    'Any positive integer, or blank for unspecified.' +
                '</p>';
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
        html += '<textarea id="ac-class-description" ' +
                    'class="ac-class-description" rows="3" ' +
                    'placeholder="Optional description...">' +
                    escapeHtml(c.description || '') +
                '</textarea>';
        html += '</div>';

        // Actions
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
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
        html += '<p>Delete <strong>' +
                    escapeHtml(cls.name || 'this class') +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the class entity, strips its ID from ' +
                    'every character, and deletes its teams, grades, ' +
                    'rankings, and enrollments.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Class</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // CLASS — ADD CHARACTER
    // ============================================================
    //
    // The candidate list is supplied by the caller. The builder does
    // NOT query the roster; the aggregator does that.

    function buildAddCharacterToClassHTML(vm) {
        var candidates = Array.isArray(vm.candidates) ? vm.candidates : [];

        var html = '';
        html += '<form id="academy-add-character-form" ' +
                    'data-class-id="' + escapeAttribute(vm.classId) + '">';

        html += '<div class="modal-header">';
        html += '<h3>Add Character to ' +
                    escapeHtml(vm.className || 'Class') +
                '</h3>';
        html += '<button type="button" class="close-modal">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<div class="form-group">';
        html += '<label for="ac-add-character-select">Character</label>';
        html += '<select id="ac-add-character-select" ' +
                    'class="ac-add-character-select" required>';
        html += '<option value="">Select a character...</option>';
        for (var i = 0; i < candidates.length; i++) {
            var cand = candidates[i];
            if (!cand || !cand.id) { continue; }
            html += '<option value="' + escapeAttribute(cand.id) + '">' +
                        escapeHtml(cand.name) +
                    '</option>';
        }
        html += '</select>';

        if (candidates.length === 0) {
            html += '<p class="field-hint">' +
                        'All characters are already in this class.' +
                    '</p>';
        }

        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="primary"' +
                    (candidates.length === 0 ? ' disabled' : '') +
                    '>Add Character</button>';
        html += '</div>';

        html += '</div>';
        html += '</form>';

        return html;
    }

    /**
     * Build the VM for the "Add Character to Class" modal.
     * Uses the aggregator's roster projection and character list to
     * compute the diff.
     */
    function buildAddCharacterToClassViewModel(classId) {
        var cls = getClassRecord(classId);
        if (!cls) { return null; }

        var currentIds = {};

        var students = AcademyAggregator.getClassStudentsViewModel(classId) || [];
        for (var i = 0; i < students.length; i++) {
            if (students[i] && students[i].id) {
                currentIds[String(students[i].id)] = true;
            }
        }

        if (cls.instructorId) {
            currentIds[String(cls.instructorId)] = true;
        }

        var all = CharacterQueries.getCharacters() || [];
        var candidates = [];
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

        return {
            classId: cls.id,
            className: cls.name || 'Unnamed Class',
            candidates: candidates
        };
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
        html += '<p>Delete <strong>' +
                    escapeHtml(disc.name || 'this discipline') +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the discipline, its auto-groups, ' +
                    'enrollments, and any grades and schedule slots ' +
                    'referencing it.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
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

        var types = AcademyLocations.getValidLocationTypes();
        var minCapacity = AcademyLocations.MIN_CAPACITY;
        var maxCapacity = AcademyLocations.MAX_CAPACITY;

        var html = '';
        html += '<form id="academy-location-form" class="academy-crud-form" ' +
                    'data-edit-id="' +
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
        html += '<input type="number" id="ac-loc-capacity" ' +
                    'class="ac-loc-capacity" ' +
                    'value="' + escapeAttribute(
                        l.capacity !== undefined && l.capacity !== null
                            ? String(l.capacity)
                            : ''
                    ) + '" ' +
                    'min="' + escapeAttribute(String(minCapacity)) + '" ' +
                    'max="' + escapeAttribute(String(maxCapacity)) + '" ' +
                    'placeholder="Optional">';
        html += '</div>';

        // Actions
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
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
        html += '<p>Delete <strong>' +
                    escapeHtml(loc.name || 'this location') +
                '</strong> permanently?</p>';
        html += '<p class="text-dim" style="font-size:0.75rem;">' +
                    'This removes the location, its weekly schedules, and ' +
                    'class-to-location assignments.' +
                '</p>';
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
        html += '<button type="submit" class="danger">Delete Location</button>';
        html += '</div>';
        html += '</div>';
        html += '</form>';
        return html;
    }

    // ============================================================
    // SOCIAL SCORE — FORM HTML
    // ============================================================

    function buildSocialScoreFormHTML(charId, classId, week, currentValue) {
        var ASS = getAcademySocialScore();
        var minScore = (ASS && typeof ASS.MIN_SCORE === 'number')
            ? ASS.MIN_SCORE
            : 0;
        var maxScore = (ASS && typeof ASS.MAX_SCORE === 'number')
            ? ASS.MAX_SCORE
            : 100;

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
                    'Social score contributes to the overall performance ' +
                    'blend for this student in this class for the ' +
                    'selected week.' +
                '</p>';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="cancel-modal-btn secondary">Cancel</button>';
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

        openModal('academy-class-form-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

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

                var yearValue = null;
                if (yearRaw !== '') {
                    yearValue = ValidationUtils.parseStrictPositiveInteger(yearRaw);
                    if (yearValue === null) {
                        notify('Year must be a positive integer.', 'error');
                        return;
                    }
                }

                var payload = {
                    name: name,
                    year: yearValue,
                    status: status,
                    description: description
                };

                var promise = (cls && cls.id)
                    ? AcademyClasses.update(cls.id, payload)
                    : AcademyClasses.create(name, payload);

                promise.then(function(result) {
                    if (result && result.success) {
                        close();
                        notifyChange();
                    }
                    // On failure, the pipeline has already notified.
                    // Modal stays open so the user can retry.
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

        openModal('academy-class-delete-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-class-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                AcademyClasses.delete(cls.id).then(function(result) {
                    if (result && result.success) {
                        close();
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
        var vm = buildAddCharacterToClassViewModel(classId);
        if (!vm) {
            notify('Class not found.', 'error');
            return;
        }

        var CharacterClasses = getCharacterClasses();
        if (!CharacterClasses || typeof CharacterClasses.addToClass !== 'function') {
            notify('Character classes module not available.', 'error');
            return;
        }

        var html = buildAddCharacterToClassHTML(vm);

        openModal('academy-add-character-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

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

                CharacterClasses.addToClass(charId, vm.classId).then(function(result) {
                    if (result && result.success) {
                        close();
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
        var disc = getDisciplineRecord(disciplineId);
        if (!disc) {
            notify('Discipline not found.', 'error');
            return;
        }

        var html = buildDisciplineDeleteHTML(disc);

        openModal('academy-discipline-delete-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-discipline-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                AcademyDisciplines.delete(disc.id).then(function(result) {
                    if (result && result.success) {
                        close();
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
            loc = getLocationRecord(locationId);
        }

        var html = buildLocationFormHTML(loc);

        openModal('academy-location-form-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

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
                var capacity = null;
                if (capRaw !== '') {
                    capacity = ValidationUtils.parseStrictPositiveInteger(capRaw);
                    if (capacity === null) {
                        notify('Capacity must be a positive integer.', 'error');
                        return;
                    }
                }

                var payload = {
                    name: name,
                    type: typeInput ? typeInput.value : 'other',
                    capacity: capacity
                };

                var promise = (loc && loc.id)
                    ? AcademyLocations.update(loc.id, payload)
                    : AcademyLocations.create(payload);

                promise.then(function(result) {
                    if (result && result.success) {
                        close();
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
        var loc = getLocationRecord(locationId);
        if (!loc) {
            notify('Location not found.', 'error');
            return;
        }

        var html = buildLocationDeleteHTML(loc);

        openModal('academy-location-delete-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

            var form = modal.querySelector('#academy-location-delete-form');
            if (!form) { return; }

            form.addEventListener('submit', function(e) {
                e.preventDefault();

                AcademyLocations.delete(loc.id).then(function(result) {
                    if (result && result.success) {
                        close();
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
    // OPEN — SOCIAL SCORE
    // ============================================================

    /**
     * Open the Social Score modal.
     *
     * The class and week are explicit parameters. The caller
     * (AcademyView) resolves them from UI state. This module does not
     * look up UI state.
     *
     * @param {string} charId
     * @param {string} classId
     * @param {number|string} week
     */
    function openSocialScoreForm(charId, classId, week) {
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }
        if (!isNonEmptyString(classId)) {
            notify('Select a class before editing a social score.', 'error');
            return;
        }

        var weekNum = ValidationUtils.parseStrictPositiveInteger(week);
        if (weekNum === null) {
            notify('Valid week is required.', 'error');
            return;
        }

        var ASS = getAcademySocialScore();
        if (!ASS || typeof ASS.setSocialScore !== 'function') {
            notify('Social score module not available.', 'error');
            return;
        }

        var currentValue = null;
        if (typeof ASS.getSocialScore === 'function') {
            try {
                currentValue = ASS.getSocialScore(charId, classId, weekNum);
            } catch (e) {
                console.warn('[AcademyCRUDModals] getSocialScore failed:', e);
                currentValue = null;
            }
        }

        var html = buildSocialScoreFormHTML(charId, classId, weekNum, currentValue);

        openModal('academy-social-score-modal', html, function(modal, close) {
            bindCommonModalControls(modal, close);

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

                ASS.setSocialScore(charId, classId, weekNum, value)
                    .then(function(result) {
                        if (result && result.success) {
                            close();
                            notifyChange();
                        }
                    })
                    .catch(function(err) {
                        console.warn(
                            '[AcademyCRUDModals] Set social score failed:', err
                        );
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

        // Social score
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

})();
