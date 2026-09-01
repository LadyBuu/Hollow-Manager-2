/**
 * js/modules/classes/classes-view.js - Graduating Classes View
 * Handles graduating class CRUD and member management
 */

(function() {
    'use strict';

    console.log('[ClassesView] Module loading...');

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        selectedClassId: null,
        selectedCharacterId: null
    };

    // ============================================================
    // RENDER CLASSES VIEW - Public API
    // ============================================================

    function renderClassesView(container) {
        console.log('[ClassesView] renderClassesView called');
        
        if (!container) {
            container = document.getElementById('classes-content');
        }
        
        if (!container) {
            console.warn('[ClassesView] Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading class data...</p>';
            return;
        }

        // Ensure graduating classes exist
        if (!window.data.graduatingClasses) {
            window.data.graduatingClasses = [];
        }

        // Render the view
        container.innerHTML = getClassesHTML();
        renderClassList();
        renderClassDetail();
        initClassEvents();
        
        console.log('[ClassesView] Render complete');
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
            console.warn('[ClassesView] class-list not found');
            return;
        }

        var classes = [];
        if (typeof window.getGraduatingClasses === 'function') {
            classes = window.getGraduatingClasses();
        } else if (window.data && window.data.graduatingClasses) {
            classes = window.data.graduatingClasses;
        }

        if (classes.length === 0) {
            listContainer.innerHTML = '<p class="empty-state">No graduating classes created yet. Click "Add Class" to create one.</p>';
            return;
        }

        var html = '';
        var selectedId = state.selectedClassId;

        // Sort classes by name
        classes.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var isSelected = String(cls.id) === String(selectedId);
            var safeName = escapeHtml(cls.name || 'Unnamed Class');
            var safeId = escapeHtml(cls.id);

            // Count members
            var trainees = [];
            var instructors = [];
            if (typeof window.getCharactersByGraduatingClass === 'function') {
                trainees = window.getCharactersByGraduatingClass(cls.id);
            }
            if (typeof window.getInstructorsByGraduatingClass === 'function') {
                instructors = window.getInstructorsByGraduatingClass(cls.id);
            }
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
            console.warn('[ClassesView] class-detail not found');
            return;
        }

        if (!state.selectedClassId) {
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var cls = null;
        if (typeof window.getGraduatingClass === 'function') {
            cls = window.getGraduatingClass(state.selectedClassId);
        } else if (window.data && window.data.graduatingClasses) {
            for (var i = 0; i < window.data.graduatingClasses.length; i++) {
                if (String(window.data.graduatingClasses[i].id) === String(state.selectedClassId)) {
                    cls = window.data.graduatingClasses[i];
                    break;
                }
            }
        }

        if (!cls) {
            detailContainer.innerHTML = '<p class="empty-state">Class not found.</p>';
            state.selectedClassId = null;
            renderClassList();
            return;
        }

        var trainees = [];
        var instructors = [];
        if (typeof window.getCharactersByGraduatingClass === 'function') {
            trainees = window.getCharactersByGraduatingClass(state.selectedClassId);
        }
        if (typeof window.getInstructorsByGraduatingClass === 'function') {
            instructors = window.getInstructorsByGraduatingClass(state.selectedClassId);
        }

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

        // Character list
        html += '<div style="margin-top:12px;">';
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin-bottom:8px;">Members</h4>';
        html += '<div id="class-members-list" style="max-height:300px;overflow-y:auto;">';
        html += renderMembersList(trainees, instructors);
        html += '</div>';
        html += '</div>';

        detailContainer.innerHTML = html;

        // Bind buttons - Using event delegation to ensure they work
        var manageBtn = detailContainer.querySelector('#manage-members-btn');
        if (manageBtn) {
            // Remove any existing listeners by cloning
            var newManageBtn = manageBtn.cloneNode(true);
            manageBtn.parentNode.replaceChild(newManageBtn, manageBtn);
            newManageBtn.addEventListener('click', function() {
                console.log('[ClassesView] Manage Members button clicked for class:', state.selectedClassId);
                showMemberModal(state.selectedClassId);
            });
        }

        var editBtn = detailContainer.querySelector('#edit-class-btn');
        if (editBtn) {
            var newEditBtn = editBtn.cloneNode(true);
            editBtn.parentNode.replaceChild(newEditBtn, editBtn);
            newEditBtn.addEventListener('click', function() {
                showClassForm(state.selectedClassId);
            });
        }

        var deleteBtn = detailContainer.querySelector('#delete-class-btn');
        if (deleteBtn) {
            var newDeleteBtn = deleteBtn.cloneNode(true);
            deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
            newDeleteBtn.addEventListener('click', function() {
                deleteClassHandler(state.selectedClassId);
            });
        }
    }

    // ============================================================
    // RENDER MEMBERS LIST
    // ============================================================

    function renderMembersList(trainees, instructors) {
        var allMembers = [];

        for (var i = 0; i < trainees.length; i++) {
            allMembers.push({
                char: trainees[i],
                role: 'trainee'
            });
        }

        for (var i = 0; i < instructors.length; i++) {
            allMembers.push({
                char: instructors[i],
                role: 'instructor'
            });
        }

        allMembers.sort(function(a, b) {
            var nameA = typeof window.getDisplayName === 'function' ? window.getDisplayName(a.char) : (a.char.name || 'Unknown');
            var nameB = typeof window.getDisplayName === 'function' ? window.getDisplayName(b.char) : (b.char.name || 'Unknown');
            return nameA.localeCompare(nameB);
        });

        if (allMembers.length === 0) {
            return '<p class="empty-state" style="padding:8px;font-size:0.75rem;">No members in this class.</p>';
        }

        var html = '';

        for (var i = 0; i < allMembers.length; i++) {
            var item = allMembers[i];
            var char = item.char;
            var role = item.role;
            var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : (char.name || 'Unknown');
            var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '';
            var isDeceased = char.deceased || false;

            var roleColor = role === 'instructor' ? 'var(--info)' : 'var(--accent)';
            var roleLabel = role === 'instructor' ? 'Instructor' : 'Trainee';

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-radius:4px;border-bottom:1px solid var(--border-soft);' +
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
    // SHOW MEMBER MODAL - Fixed to ensure it works
    // ============================================================

    function showMemberModal(classId) {
        console.log('[ClassesView] showMemberModal called for class:', classId);
        
        // Get or create the modal
        var modal = document.getElementById('member-modal');
        if (!modal) {
            console.error('[ClassesView] member-modal not found in DOM');
            // Create the modal if it doesn't exist
            modal = createMemberModal();
            if (!modal) {
                alert('Member management modal could not be created. Please refresh the page.');
                return;
            }
        }

        var content = document.getElementById('member-modal-content');
        var title = document.getElementById('member-modal-title');

        if (!content || !title) {
            console.error('[ClassesView] Modal content or title not found');
            // Try to find them inside the modal
            content = modal.querySelector('#member-modal-content');
            title = modal.querySelector('#member-modal-title');
            if (!content || !title) {
                alert('Modal elements not found. Please refresh the page.');
                return;
            }
        }

        var cls = typeof window.getGraduatingClass === 'function' ? window.getGraduatingClass(classId) : null;
        if (!cls) {
            alert('Class not found.');
            return;
        }

        title.textContent = 'Manage Members - ' + cls.name;

        // Get all characters
        var allChars = [];
        if (window.data && window.data.characters) {
            allChars = window.data.characters;
        }

        var currentTrainees = typeof window.getCharactersByGraduatingClass === 'function' ? window.getCharactersByGraduatingClass(classId) : [];
        var currentInstructors = typeof window.getInstructorsByGraduatingClass === 'function' ? window.getInstructorsByGraduatingClass(classId) : [];

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
                var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : (char.name || 'Unknown');
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
                var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : (char.name || 'Unknown');
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

                if (typeof window.assignCharacterToGraduatingClass !== 'function' || 
                    typeof window.removeCharacterFromGraduatingClass !== 'function') {
                    alert('Member management functions not available.');
                    return;
                }

                if (isInClass) {
                    var result = window.removeCharacterFromGraduatingClass(charId);
                    if (result && result.success) {
                        showMemberModal(classId);
                        renderClassList();
                        renderClassDetail();
                        if (typeof window.saveData === 'function') {
                            window.saveData().catch(function() {
                                console.warn('[ClassesView] Persistence failed after removing member');
                            });
                        }
                    } else {
                        alert(result && result.message ? result.message : 'Failed to remove character.');
                    }
                } else {
                    var result = window.assignCharacterToGraduatingClass(charId, classId, isInstructor);
                    if (result && result.success) {
                        showMemberModal(classId);
                        renderClassList();
                        renderClassDetail();
                        if (typeof window.saveData === 'function') {
                            window.saveData().catch(function() {
                                console.warn('[ClassesView] Persistence failed after adding member');
                            });
                        }
                    } else {
                        alert(result && result.message ? result.message : 'Failed to add character.');
                    }
                }
            });
        }

        // Show modal
        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Bind close buttons
        var closeBtn = document.getElementById('close-member-modal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            });
        }

        var closeX = document.getElementById('close-member-modal');
        if (closeX) {
            closeX.addEventListener('click', function() {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            });
        }

        // Close on backdrop click
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.add('hidden');
                this.style.display = 'none';
            }
        });
    }

    // ============================================================
    // CREATE MEMBER MODAL - Fallback if modal doesn't exist
    // ============================================================

    function createMemberModal() {
        console.log('[ClassesView] Creating member modal');
        
        var modal = document.createElement('div');
        modal.id = 'member-modal';
        modal.className = 'modal hidden';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:1000;';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width:650px;max-height:80vh;overflow-y:auto;background:var(--panel);border-radius:var(--radius);padding:20px;position:relative;">
                <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 id="member-modal-title" style="margin:0;">Manage Members</h3>
                    <button class="close-modal" id="close-member-modal" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-dim);">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="member-modal-content"></div>
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="close-member-modal-btn" class="secondary">Close</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        console.log('[ClassesView] Member modal created');
        return modal;
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
            alert('Form elements not found. Please refresh.');
            return;
        }

        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        if (editId) {
            title.textContent = 'Edit Class';
            var cls = typeof window.getGraduatingClass === 'function' ? window.getGraduatingClass(editId) : null;
            if (cls) {
                nameInput.value = cls.name;
                form.dataset.editId = editId;
            } else {
                alert('Class not found.');
                modal.classList.add('hidden');
                modal.style.display = 'none';
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
            alert('Class name is required.');
            return;
        }

        var result;
        if (editId) {
            if (typeof window.updateGraduatingClass === 'function') {
                result = window.updateGraduatingClass(editId, name);
            } else {
                alert('updateGraduatingClass not available.');
                return;
            }
        } else {
            if (typeof window.createGraduatingClass === 'function') {
                result = window.createGraduatingClass(name);
            } else {
                alert('createGraduatingClass not available.');
                return;
            }
        }

        if (!result || !result.success) {
            alert(result && result.message ? result.message : 'Failed to save class.');
            return;
        }

        document.getElementById('class-form-modal').classList.add('hidden');
        document.getElementById('class-form-modal').style.display = 'none';

        if (result.data && result.data.graduatingClass) {
            state.selectedClassId = result.data.graduatingClass.id;
        }

        renderClassList();
        renderClassDetail();

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    console.log(editId ? 'Class updated successfully.' : 'Class created successfully.');
                })
                .catch(function() {
                    console.warn('Class saved in memory, but persistence failed.');
                });
        }
    }

    function deleteClassHandler(classId) {
        var cls = typeof window.getGraduatingClass === 'function' ? window.getGraduatingClass(classId) : null;
        if (!cls) {
            alert('Class not found.');
            return;
        }

        var trainees = typeof window.getCharactersByGraduatingClass === 'function' ? window.getCharactersByGraduatingClass(classId) : [];
        var instructors = typeof window.getInstructorsByGraduatingClass === 'function' ? window.getInstructorsByGraduatingClass(classId) : [];
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

        if (typeof window.deleteGraduatingClass !== 'function') {
            alert('deleteGraduatingClass not available.');
            return;
        }

        var result = window.deleteGraduatingClass(classId);
        if (!result || !result.success) {
            alert(result && result.message ? result.message : 'Failed to delete class.');
            return;
        }

        state.selectedClassId = null;
        renderClassList();
        renderClassDetail();

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    console.log('Class deleted successfully.');
                })
                .catch(function() {
                    console.warn('Class deleted in memory, but persistence failed.');
                });
        }
    }

    // ============================================================
    // CHARACTER ROLE HELPERS
    // ============================================================

    function isStudent(char) {
        var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char).toLowerCase() : '';
        return status === 'trainee' || status === 'rookie' || status === 'junior' || status === 'student';
    }

    function isInstructor(char) {
        var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char).toLowerCase() : '';
        return status === 'instructor' || status === 'teacher' || status === 'professor' || status === 'senior';
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initClassEvents() {
        console.log('[ClassesView] Initializing events...');
        
        var addBtn = document.getElementById('add-class-btn');
        if (addBtn) {
            // Remove existing listeners by cloning
            var newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function() {
                console.log('[ClassesView] Add class button clicked');
                showClassForm();
            });
        }

        var closeFormBtn = document.getElementById('close-class-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', function() {
                var modal = document.getElementById('class-form-modal');
                modal.classList.add('hidden');
                modal.style.display = 'none';
            });
        }

        var cancelFormBtn = document.getElementById('cancel-class-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', function() {
                var modal = document.getElementById('class-form-modal');
                modal.classList.add('hidden');
                modal.style.display = 'none';
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
                    this.style.display = 'none';
                }
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderClassesView = renderClassesView;

    console.log('[ClassesView] Module loaded successfully');

})();
