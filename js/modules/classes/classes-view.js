/**
 * js/modules/classes/classes-view.js - Graduating Classes View
 * Handles graduating class CRUD and member management
 * Path: js/modules/classes/classes-view.js
 * 
 * This module reuses the existing character list component
 */

(function() {
    'use strict';

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        selectedClassId: null,
        selectedCharacterId: null
    };

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
            { name: 'getCurrentStatus', fn: window.getCurrentStatus },
            { name: 'getAllCharacters', fn: window.getAllCharacters || function() { return window.data?.characters || []; } },
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
        renderClassDetail();
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
        return `
            <div class="page-header">
                <h2>Graduating Classes</h2>
                <button id="add-class-btn" class="primary">+ New Class</button>
            </div>
            <div class="classes-layout" style="display:grid;grid-template-columns:280px 1fr;gap:16px;">
                <div id="class-list-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:500px;overflow-y:auto;">
                    <div id="class-list">
                        <p class="empty-state">No classes created yet.</p>
                    </div>
                </div>
                <div id="class-detail-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;overflow-y:auto;max-height:500px;">
                    <div id="class-detail">
                        <p class="empty-state">Select a class to view details.</p>
                    </div>
                </div>
            </div>

            <!-- Class Form Modal -->
            <div id="class-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:450px;">
                    <div class="modal-header">
                        <h3 id="class-form-title">Add Class</h3>
                        <button class="close-modal" id="close-class-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="class-form-inner">
                            <div class="form-group">
                                <label>Class Name *</label>
                                <input type="text" id="class-name" placeholder="e.g., Spring 2024, Class of 89" required>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-class-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-class-btn" class="primary">Save Class</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Member Management Modal -->
            <div id="member-modal" class="modal hidden">
                <div class="modal-content" style="max-width:650px;max-height:80vh;overflow-y:auto;">
                    <div class="modal-header">
                        <h3 id="member-modal-title">Manage Members</h3>
                        <button class="close-modal" id="close-member-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="member-modal-content"></div>
                        <div class="form-actions" style="margin-top:16px;">
                            <button type="button" id="close-member-modal-btn" class="secondary">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
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
        var selectedId = state.selectedClassId;

        // Sort classes by name
        classes.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var isSelected = String(cls.id) === String(selectedId);
            var safeName = escapeHtml(cls.name);
            var safeId = escapeHtml(cls.id);

            // Count members
            var trainees = window.getCharactersByGraduatingClass(cls.id);
            var instructors = window.getInstructorsByGraduatingClass(cls.id);
            var total = trainees.length + instructors.length;

            html += '<div class="class-list-item" style="padding:8px 12px;border-bottom:1px solid var(--border-soft);cursor:pointer;' +
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') +
                '" data-id="' + safeId + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="font-weight:600;font-size:0.8rem;">' + safeName + '</span>';
            html += '<span style="font-size:0.6rem;color:var(--text-dim);">' + total + ' members</span>';
            html += '</div>';
            html += '</div>';
        }

        listContainer.innerHTML = html;

        // Bind click events
        var items = listContainer.querySelectorAll('.class-list-item');
        for (var i = 0; i < items.length; i++) {
            var el = items[i];
            el.addEventListener('click', function() {
                state.selectedClassId = this.dataset.id;
                state.selectedCharacterId = null;
                renderClassList();
                renderClassDetail();
            });
        }
    }

    // ============================================================
    // RENDER CLASS DETAIL
    // ============================================================

    function renderClassDetail() {
        var detailContainer = document.getElementById('class-detail');
        if (!detailContainer) {
            return;
        }

        if (!state.selectedClassId) {
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var cls = window.getGraduatingClass(state.selectedClassId);
        if (!cls) {
            detailContainer.innerHTML = '<p class="empty-state">Class not found.</p>';
            state.selectedClassId = null;
            renderClassList();
            return;
        }

        var trainees = window.getCharactersByGraduatingClass(state.selectedClassId);
        var instructors = window.getInstructorsByGraduatingClass(state.selectedClassId);

        var html = '';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h3 style="color:var(--accent);margin:0;">' + escapeHtml(cls.name) + '</h3>';
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

        // Character list using existing component
        html += '<div style="margin-top:12px;">';
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin-bottom:8px;">Members</h4>';
        html += '<div id="class-members-list" style="max-height:300px;overflow-y:auto;">';
        html += renderMembersList(trainees, instructors);
        html += '</div>';
        html += '</div>';

        detailContainer.innerHTML = html;

        // Bind buttons
        var manageBtn = detailContainer.querySelector('#manage-members-btn');
        if (manageBtn) {
            manageBtn.addEventListener('click', function() {
                showMemberModal(state.selectedClassId);
            });
        }

        var editBtn = detailContainer.querySelector('#edit-class-btn');
        if (editBtn) {
            editBtn.addEventListener('click', function() {
                showClassForm(state.selectedClassId);
            });
        }

        var deleteBtn = detailContainer.querySelector('#delete-class-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                deleteClassHandler(state.selectedClassId);
            });
        }

        // Bind member click events
        var memberItems = detailContainer.querySelectorAll('.member-item');
        for (var i = 0; i < memberItems.length; i++) {
            var el = memberItems[i];
            el.addEventListener('click', function() {
                state.selectedCharacterId = this.dataset.id;
                // Could navigate to character detail here
                renderClassDetail();
            });
        }
    }

    // ============================================================
    // RENDER MEMBERS LIST
    // ============================================================

    function renderMembersList(trainees, instructors) {
        var allMembers = [];

        // Add trainees
        for (var i = 0; i < trainees.length; i++) {
            allMembers.push({
                char: trainees[i],
                role: 'trainee'
            });
        }

        // Add instructors
        for (var i = 0; i < instructors.length; i++) {
            allMembers.push({
                char: instructors[i],
                role: 'instructor'
            });
        }

        // Sort by name
        allMembers.sort(function(a, b) {
            return window.getDisplayName(a.char).localeCompare(window.getDisplayName(b.char));
        });

        if (allMembers.length === 0) {
            return '<p class="empty-state" style="padding:8px;font-size:0.75rem;">No members in this class.</p>';
        }

        var html = '';
        var selectedId = state.selectedCharacterId;

        for (var i = 0; i < allMembers.length; i++) {
            var item = allMembers[i];
            var char = item.char;
            var role = item.role;
            var name = window.getDisplayName(char);
            var status = window.getCurrentStatus(char);
            var isSelected = String(char.id) === String(selectedId);
            var isDeceased = char.deceased || false;

            var roleColor = role === 'instructor' ? 'var(--info)' : 'var(--accent)';
            var roleLabel = role === 'instructor' ? 'Instructor' : 'Trainee';

            html += '<div class="member-item" data-id="' + escapeHtml(char.id) + '" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-radius:4px;cursor:pointer;transition:0.15s;border-bottom:1px solid var(--border-soft);' +
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') +
                (isDeceased ? 'opacity:0.4;' : '') + '">';
            html += '<span style="font-size:0.75rem;">' + escapeHtml(name) + 
                ' <span style="font-size:0.55rem;color:' + roleColor + ';">[' + roleLabel + ']</span>' +
                (isDeceased ? ' <span style="font-size:0.55rem;color:var(--danger);">[Deceased]</span>' : '') +
                '</span>';
            html += '<span style="font-size:0.55rem;color:var(--text-dim);">' + escapeHtml(status) + '</span>';
            html += '</div>';
        }

        return html;
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
            state.selectedClassId = result.data.graduatingClass.id;
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

        state.selectedClassId = null;
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

        // Get all characters
        var allChars = getAllCharacters();
        var currentTrainees = window.getCharactersByGraduatingClass(classId);
        var currentInstructors = window.getInstructorsByGraduatingClass(classId);

        // Build lookup maps
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
        html += 'Add or remove characters from this graduating class. Click a name to toggle membership.';
        html += '</p>';

        // Trainees section
        html += '<h4 style="color:var(--accent);margin:12px 0 8px 0;">Trainees</h4>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px;background:var(--bg);border-radius:4px;min-height:40px;max-height:150px;overflow-y:auto;">';
        var traineeAdded = false;
        for (var i = 0; i < allChars.length; i++) {
            var char = allChars[i];
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
        html += '<div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px;background:var(--bg);border-radius:4px;min-height:40px;max-height:150px;overflow-y:auto;">';
        var instructorAdded = false;
        for (var i = 0; i < allChars.length; i++) {
            var char = allChars[i];
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

        content.innerHTML = html;

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

        // Bind close buttons
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
        var status = window.getCurrentStatus(char).toLowerCase();
        return status === 'trainee' || status === 'rookie' || status === 'junior' || status === 'student';
    }

    function isInstructor(char) {
        var status = window.getCurrentStatus(char).toLowerCase();
        return status === 'instructor' || status === 'teacher' || status === 'professor' || status === 'senior';
    }

    function getAllCharacters() {
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
