/**
 * js/modules/classes/classes-view.js - Graduating Classes View
 * Handles graduating class CRUD and member management
 * Path: js/modules/classes/classes-view.js
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function validateDependencies(container) {
        var missing = [];

        var required = [
            { name: 'getGraduatingClasses', fn: window.getGraduatingClasses },
            { name: 'getGraduatingClass', fn: window.getGraduatingClass },
            { name: 'createGraduatingClass', fn: window.createGraduatingClass },
            { name: 'updateGraduatingClass', fn: window.updateGraduatingClass },
            { name: 'deleteGraduatingClass', fn: window.deleteGraduatingClass },
            { name: 'getCharactersByGraduatingClass', fn: window.getCharactersByGraduatingClass },
            { name: 'getInstructorsByGraduatingClass', fn: window.getInstructorsByGraduatingClass },
            { name: 'assignCharacterToGraduatingClass', fn: window.assignCharacterToGraduatingClass },
            { name: 'removeCharacterFromGraduatingClass', fn: window.removeCharacterFromGraduatingClass },
            { name: 'getCharacterById', fn: window.getCharacterById },
            { name: 'getDisplayName', fn: window.getDisplayName },
            { name: 'getStudents', fn: window.getStudents },
            { name: 'getInstructors', fn: window.getInstructors },
            { name: 'saveData', fn: window.saveData }
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof required[i].fn !== 'function') {
                missing.push(required[i].name);
            }
        }

        if (missing.length > 0) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Classes dependencies not loaded: ' + missing.join(', ') + '. Please refresh.</p>';
            }
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER CLASSES VIEW
    // ============================================================

    function renderClassesView(container) {
        if (!container) {
            container = document.getElementById('classes-content');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading class data...</p>';
            return;
        }

        if (!validateDependencies(container)) {
            return;
        }

        container.innerHTML = getClassesHTML();
        renderClassList();
        initClassEvents();
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        return (
            '<div class="page-header">' +
                '<h2>Graduating Classes</h2>' +
                '<button id="add-class-btn" class="primary">+ New Class</button>' +
            '</div>' +
            '<div class="classes-layout" style="display:grid;grid-template-columns:1fr 2fr;gap:16px;">' +
                '<div id="class-list-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:500px;overflow-y:auto;">' +
                    '<div id="class-list">' +
                        '<p class="empty-state">No classes created yet.</p>' +
                    '</div>' +
                '</div>' +
                '<div id="class-detail-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">' +
                    '<div id="class-detail">' +
                        '<p class="empty-state">Select a class to view details.</p>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="class-form-modal" class="modal hidden">' +
                '<div class="modal-content" style="max-width:450px;">' +
                    '<div class="modal-header">' +
                        '<h3 id="class-form-title">Add Class</h3>' +
                        '<button class="close-modal" id="close-class-form">&times;</button>' +
                    '</div>' +
                    '<div class="modal-body">' +
                        '<form id="class-form-inner">' +
                            '<div class="form-group">' +
                                '<label>Class Name *</label>' +
                                '<input type="text" id="class-name" placeholder="e.g., Spring 2024, Class of 89" required>' +
                            '</div>' +
                            '<div class="form-actions">' +
                                '<button type="button" id="cancel-class-form" class="secondary">Cancel</button>' +
                                '<button type="submit" id="save-class-btn" class="primary">Save Class</button>' +
                            '</div>' +
                        '</form>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="member-modal" class="modal hidden">' +
                '<div class="modal-content" style="max-width:550px;">' +
                    '<div class="modal-header">' +
                        '<h3 id="member-modal-title">Manage Members</h3>' +
                        '<button class="close-modal" id="close-member-modal">&times;</button>' +
                    '</div>' +
                    '<div class="modal-body">' +
                        '<div id="member-modal-content"></div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // RENDER CLASS LIST
    // ============================================================

    function renderClassList() {
        var listContainer = document.getElementById('class-list');
        if (!listContainer) {
            return;
        }

        var classes = window.getGraduatingClasses();

        if (classes.length === 0) {
            listContainer.innerHTML = '<p class="empty-state">No graduating classes created yet.</p>';
            return;
        }

        var html = '';
        var selectedId = getSelectedClassId();

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var isSelected = String(cls.id) === String(selectedId);
            var safeName = escapeHtml(cls.name);
            var safeId = escapeHtml(cls.id);

            html += '<div class="class-list-item" style="padding:8px 12px;border-bottom:1px solid var(--border-soft);cursor:pointer;' +
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') +
                '" data-id="' + safeId + '">';
            html += '<span style="font-weight:600;">' + safeName + '</span>';
            html += '</div>';
        }

        listContainer.innerHTML = html;

        // Bind click events
        var items = listContainer.querySelectorAll('.class-list-item');
        for (var i = 0; i < items.length; i++) {
            var el = items[i];
            el.addEventListener('click', function() {
                setSelectedClassId(this.dataset.id);
                renderClassList();
                renderClassDetail();
            });
        }
    }

    // ============================================================
    // SELECTION STATE
    // ============================================================

    var selectedClassId = null;

    function getSelectedClassId() {
        return selectedClassId;
    }

    function setSelectedClassId(id) {
        selectedClassId = id;
    }

    // ============================================================
    // RENDER CLASS DETAIL
    // ============================================================

    function renderClassDetail() {
        var detailContainer = document.getElementById('class-detail');
        if (!detailContainer) {
            return;
        }

        if (!selectedClassId) {
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var cls = window.getGraduatingClass(selectedClassId);
        if (!cls) {
            detailContainer.innerHTML = '<p class="empty-state">Class not found.</p>';
            selectedClassId = null;
            renderClassList();
            return;
        }

        var trainees = window.getCharactersByGraduatingClass(selectedClassId);
        var instructors = window.getInstructorsByGraduatingClass(selectedClassId);

        var html = '';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h3 style="color:var(--accent);">' + escapeHtml(cls.name) + '</h3>';
        html += '<div style="display:flex;gap:4px;">';
        html += '<button id="manage-members-btn" class="primary small">Manage Members</button>';
        html += '<button id="edit-class-btn" class="secondary small">Edit</button>';
        html += '<button id="delete-class-btn" class="danger small">Delete</button>';
        html += '</div>';
        html += '</div>';

        // Stats
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">';
        html += '<div style="background:var(--bg);padding:8px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.6rem;color:var(--text-dim);">Total Members</span>';
        html += '<div style="font-size:1.2rem;font-weight:700;color:var(--accent);">' + (trainees.length + instructors.length) + '</div>';
        html += '</div>';
        html += '<div style="background:var(--bg);padding:8px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.6rem;color:var(--text-dim);">Trainees</span>';
        html += '<div style="font-size:1.2rem;font-weight:700;color:var(--accent);">' + trainees.length + '</div>';
        html += '</div>';
        html += '<div style="background:var(--bg);padding:8px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.6rem;color:var(--text-dim);">Instructors</span>';
        html += '<div style="font-size:1.2rem;font-weight:700;color:var(--info);">' + instructors.length + '</div>';
        html += '</div>';
        html += '</div>';

        // Trainees list
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin-bottom:4px;">Trainees (' + trainees.length + ')</h4>';
        if (trainees.length === 0) {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No trainees in this class.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:var(--bg);border-radius:4px;max-height:150px;overflow-y:auto;">';
            for (var i = 0; i < trainees.length; i++) {
                var char = trainees[i];
                var name = window.getDisplayName(char);
                var status = getCurrentStatus(char);
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;">' +
                    escapeHtml(name) + ' <span style="color:var(--text-dim);font-size:0.6rem;">(' + escapeHtml(status) + ')</span></span>';
            }
            html += '</div>';
        }

        // Instructors list
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin:8px 0 4px 0;">Instructors (' + instructors.length + ')</h4>';
        if (instructors.length === 0) {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No instructors in this class.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:var(--bg);border-radius:4px;max-height:150px;overflow-y:auto;">';
            for (var i = 0; i < instructors.length; i++) {
                var char = instructors[i];
                var name = window.getDisplayName(char);
                var status = getCurrentStatus(char);
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;">' +
                    escapeHtml(name) + ' <span style="color:var(--text-dim);font-size:0.6rem;">(' + escapeHtml(status) + ')</span></span>';
            }
            html += '</div>';
        }

        detailContainer.innerHTML = html;

        // Bind buttons
        var manageBtn = detailContainer.querySelector('#manage-members-btn');
        if (manageBtn) {
            manageBtn.addEventListener('click', function() {
                showMemberModal(selectedClassId);
            });
        }

        var editBtn = detailContainer.querySelector('#edit-class-btn');
        if (editBtn) {
            editBtn.addEventListener('click', function() {
                showClassForm(selectedClassId);
            });
        }

        var deleteBtn = detailContainer.querySelector('#delete-class-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                deleteClassHandler(selectedClassId);
            });
        }
    }

    // ============================================================
    // GET CURRENT STATUS HELPER
    // ============================================================

    function getCurrentStatus(char) {
        if (typeof window.getCurrentStatus === 'function') {
            return window.getCurrentStatus(char);
        }
        return '';
    }

    // ============================================================
    // CLASS FORM
    // ============================================================

    function showClassForm(editId) {
        var modal = document.getElementById('class-form-modal');
        var title = document.getElementById('class-form-title');
        var nameInput = document.getElementById('class-name');
        var form = document.getElementById('class-form-inner');

        if (!modal || !title || !nameInput || !form) {
            return;
        }

        modal.classList.remove('hidden');

        if (editId) {
            title.textContent = 'Edit Class';
            var cls = window.getGraduatingClass(editId);
            if (cls) {
                nameInput.value = cls.name;
                form.dataset.editId = editId;
            } else {
                showNotification('Class not found.', 'error');
                modal.classList.add('hidden');
                return;
            }
        } else {
            title.textContent = 'Add Class';
            nameInput.value = '';
            delete form.dataset.editId;
        }

        nameInput.focus();
    }

    function saveClass(e) {
        e.preventDefault();

        var form = e.target;
        var editId = form.dataset.editId;
        var name = document.getElementById('class-name').value.trim();

        if (!name) {
            showNotification('Class name is required.', 'error');
            return;
        }

        var result;
        if (editId) {
            result = window.updateGraduatingClass(editId, name);
        } else {
            result = window.createGraduatingClass(name);
        }

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to save class.', 'error');
            return;
        }

        document.getElementById('class-form-modal').classList.add('hidden');

        if (result.data && result.data.graduatingClass) {
            selectedClassId = result.data.graduatingClass.id;
        }

        renderClassList();
        renderClassDetail();

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(editId ? 'Class updated successfully.' : 'Class created successfully.', 'success');
                })
                .catch(function() {
                    showNotification('Class saved in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(editId ? 'Class updated successfully.' : 'Class created successfully.', 'success');
        }
    }

    function deleteClassHandler(classId) {
        var cls = window.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var trainees = window.getCharactersByGraduatingClass(classId);
        var instructors = window.getInstructorsByGraduatingClass(classId);
        var totalMembers = trainees.length + instructors.length;

        var message = 'Delete "' + cls.name + '" permanently?';
        if (totalMembers > 0) {
            message += '\n\nThis class has ' + totalMembers + ' members (' + trainees.length + ' trainees, ' + instructors.length + ' instructors).';
            message += '\nAll members will be unassigned from this class.';
        }
        message += '\n\nThis action cannot be undone.';

        if (!confirm(message)) {
            return;
        }

        var result = window.deleteGraduatingClass(classId);
        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to delete class.', 'error');
            return;
        }

        selectedClassId = null;
        renderClassList();
        renderClassDetail();

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification('Class deleted successfully.', 'success');
                })
                .catch(function() {
                    showNotification('Class deleted in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification('Class deleted successfully.', 'success');
        }
    }

    // ============================================================
    // MEMBER MANAGEMENT MODAL
    // ============================================================

    function showMemberModal(classId) {
        var modal = document.getElementById('member-modal');
        var content = document.getElementById('member-modal-content');
        var title = document.getElementById('member-modal-title');

        if (!modal || !content || !title) {
            return;
        }

        var cls = window.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        title.textContent = 'Manage Members - ' + cls.name;

        var allCharacters = getAllCharacters();
        var currentTrainees = window.getCharactersByGraduatingClass(classId);
        var currentInstructors = window.getInstructorsByGraduatingClass(classId);

        var traineeIds = {};
        var instructorIds = {};
        for (var i = 0; i < currentTrainees.length; i++) {
            traineeIds[currentTrainees[i].id] = true;
        }
        for (var i = 0; i < currentInstructors.length; i++) {
            instructorIds[currentInstructors[i].id] = true;
        }

        var html = '';
        html += '<p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:12px;">';
        html += 'Add or remove characters from this graduating class. Characters can belong to multiple classes.';
        html += '</p>';

        // Trainees section
        html += '<h4 style="color:var(--accent);margin:12px 0 8px 0;">Trainees</h4>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px;background:var(--bg);border-radius:4px;min-height:40px;">';
        var traineeAdded = false;
        for (var i = 0; i < allCharacters.length; i++) {
            var char = allCharacters[i];
            if (isStudent(char)) {
                var isInClass = !!traineeIds[char.id];
                var name = window.getDisplayName(char);
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;cursor:pointer;' +
                    (isInClass ? 'border:1px solid var(--accent);' : 'border:1px solid var(--border-soft);opacity:0.6;') +
                    '" data-id="' + escapeHtml(char.id) + '" data-role="trainee" class="member-toggle">' +
                    escapeHtml(name) + (isInClass ? ' ✓' : ' +') +
                    '</span>';
                traineeAdded = true;
            }
        }
        if (!traineeAdded) {
            html += '<span style="color:var(--text-dim);font-size:0.7rem;">No trainees available.</span>';
        }
        html += '</div>';

        // Instructors section
        html += '<h4 style="color:var(--info);margin:12px 0 8px 0;">Instructors</h4>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px;background:var(--bg);border-radius:4px;min-height:40px;">';
        var instructorAdded = false;
        for (var i = 0; i < allCharacters.length; i++) {
            var char = allCharacters[i];
            if (isInstructor(char)) {
                var isInClass = !!instructorIds[char.id];
                var name = window.getDisplayName(char);
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;cursor:pointer;' +
                    (isInClass ? 'border:1px solid var(--accent);' : 'border:1px solid var(--border-soft);opacity:0.6;') +
                    '" data-id="' + escapeHtml(char.id) + '" data-role="instructor" class="member-toggle">' +
                    escapeHtml(name) + (isInClass ? ' ✓' : ' +') +
                    '</span>';
                instructorAdded = true;
            }
        }
        if (!instructorAdded) {
            html += '<span style="color:var(--text-dim);font-size:0.7rem;">No instructors available.</span>';
        }
        html += '</div>';

        html += '<div style="margin-top:12px;font-size:0.7rem;color:var(--text-dim);">';
        html += 'Click a name to toggle membership.';
        html += '</div>';

        html += '<div class="form-actions" style="margin-top:16px;">';
        html += '<button type="button" id="close-member-modal-btn" class="secondary">Close</button>';
        html += '</div>';

        content.innerHTML = html;
        modal.classList.remove('hidden');

        // Bind member toggle events
        var toggles = content.querySelectorAll('.member-toggle');
        for (var i = 0; i < toggles.length; i++) {
            var el = toggles[i];
            el.addEventListener('click', function() {
                var charId = this.dataset.id;
                var role = this.dataset.role;
                var isInstructor = role === 'instructor';
                var isInClass = this.textContent.includes('✓');

                if (isInClass) {
                    // Remove from class
                    var result = window.removeCharacterFromGraduatingClass(charId);
                    if (result && result.success) {
                        showMemberModal(classId);
                        renderClassList();
                        renderClassDetail();
                        if (typeof window.saveData === 'function') {
                            window.saveData().catch(function() {
                                showNotification('Membership removed in memory, but persistence failed.', 'error');
                            });
                        }
                    } else {
                        showNotification(result && result.message ? result.message : 'Failed to remove character.', 'error');
                    }
                } else {
                    // Add to class
                    var result = window.assignCharacterToGraduatingClass(charId, classId, isInstructor);
                    if (result && result.success) {
                        showMemberModal(classId);
                        renderClassList();
                        renderClassDetail();
                        if (typeof window.saveData === 'function') {
                            window.saveData().catch(function() {
                                showNotification('Membership added in memory, but persistence failed.', 'error');
                            });
                        }
                    } else {
                        showNotification(result && result.message ? result.message : 'Failed to add character.', 'error');
                    }
                }
            });
        }

        var closeBtn = document.getElementById('close-member-modal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                modal.classList.add('hidden');
            });
        }

        var closeX = document.getElementById('close-member-modal');
        if (closeX) {
            closeX.addEventListener('click', function() {
                modal.classList.add('hidden');
            });
        }

        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.add('hidden');
            }
        });
    }

    // ============================================================
    // CHARACTER ROLE HELPERS
    // ============================================================

    function isStudent(char) {
        var status = getCurrentStatus(char);
        return status === 'trainee' || status === 'rookie' || status === 'junior' || status === 'student';
    }

    function isInstructor(char) {
        var status = getCurrentStatus(char);
        return status === 'instructor' || status === 'teacher' || status === 'professor' || status === 'senior';
    }

    function getAllCharacters() {
        if (typeof window.getCharacters === 'function') {
            return window.getCharacters();
        }
        var data = window.data || {};
        return data.characters || [];
    }

    // ============================================================
    // NOTIFICATION HELPER
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initClassEvents() {
        var addBtn = document.getElementById('add-class-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showClassForm();
            });
        }

        var closeFormBtn = document.getElementById('close-class-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', function() {
                document.getElementById('class-form-modal').classList.add('hidden');
            });
        }

        var cancelFormBtn = document.getElementById('cancel-class-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', function() {
                document.getElementById('class-form-modal').classList.add('hidden');
            });
        }

        var form = document.getElementById('class-form-inner');
        if (form) {
            form.addEventListener('submit', saveClass);
        }

        var formModal = document.getElementById('class-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderClassesView = renderClassesView;

})();
