/**
 * js/modules/classes/classes-view.js - Graduating Classes View
 * Handles graduating class CRUD and member management
 * Mobile-responsive with birth year filters
 */

(function() {
    'use strict';

    console.log('[ClassesView] Module loading...');

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        selectedClassId: null,
        selectedCharacterId: null,
        isMobile: window.innerWidth < 768,
        minBirthYear: null,
        maxBirthYear: null
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

        // Check mobile state
        state.isMobile = window.innerWidth < 768;

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
    // AGE CALCULATION
    // ============================================================

    function calculateAge(char) {
        if (!char || !char.birthYear) {
            return null;
        }
        var birthYear = parseInt(char.birthYear, 10);
        if (isNaN(birthYear)) {
            return null;
        }
        var currentYear = new Date().getFullYear();
        var age = currentYear - birthYear;
        return age;
    }

    // ============================================================
    // CLASSES HTML - Mobile-first vertical layout
    // ============================================================

    function getClassesHTML() {
        return `
            <div class="classes-view">
                <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                    <h2 style="margin:0;font-size:1.1rem;">Graduating Classes</h2>
                    <button id="add-class-btn" class="primary" style="font-size:0.75rem;padding:4px 12px;">+ New Class</button>
                </div>
                
                <!-- Mobile: Class selector dropdown -->
                <div id="mobile-class-selector" style="display:none;margin-bottom:12px;">
                    <select id="mobile-class-select" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.8rem;">
                        <option value="">Select a class...</option>
                    </select>
                </div>

                <!-- Layout: Vertical on mobile, horizontal on desktop -->
                <div class="classes-layout" style="display:flex;flex-direction:column;gap:16px;">
                    <!-- Class List -->
                    <div id="class-list-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:${state.isMobile ? '200px' : '500px'};overflow-y:auto;">
                        <div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:6px;">Classes</div>
                        <div id="class-list">
                            <p class="empty-state" style="font-size:0.75rem;padding:10px;">No classes created yet.</p>
                        </div>
                    </div>
                    
                    <!-- Class Detail -->
                    <div id="class-detail-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;overflow-y:auto;max-height:${state.isMobile ? '400px' : '500px'};">
                        <div id="class-detail">
                            <p class="empty-state" style="font-size:0.75rem;padding:10px;">Select a class to view details.</p>
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
                    <div class="modal-content" style="max-width:600px;max-height:80vh;overflow-y:auto;">
                        <div class="modal-header">
                            <h3 id="member-modal-title">Manage Members</h3>
                            <button class="close-modal" id="close-member-modal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div id="member-modal-content"></div>
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

        updateMobileSelector(classes);

        if (classes.length === 0) {
            listContainer.innerHTML = '<p class="empty-state" style="font-size:0.75rem;padding:10px;">No graduating classes created yet. Click "Add Class" to create one.</p>';
            return;
        }

        var html = '';
        var selectedId = state.selectedClassId;

        classes.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var isSelected = String(cls.id) === String(selectedId);
            var safeName = escapeHtml(cls.name || 'Unnamed Class');
            var safeId = escapeHtml(cls.id);

            var trainees = [];
            var instructors = [];
            if (typeof window.getCharactersByGraduatingClass === 'function') {
                trainees = window.getCharactersByGraduatingClass(cls.id);
            }
            if (typeof window.getInstructorsByGraduatingClass === 'function') {
                instructors = window.getInstructorsByGraduatingClass(cls.id);
            }
            var total = trainees.length + instructors.length;

            html += '<div class="class-list-item" style="padding:6px 10px;border-bottom:1px solid var(--border-soft);cursor:pointer;' +
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') +
                '" data-id="' + safeId + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="font-weight:600;font-size:0.75rem;">' + safeName + '</span>';
            html += '<span style="font-size:0.55rem;color:var(--text-dim);">' + total + ' members</span>';
            html += '</div>';
            html += '</div>';
        }

        listContainer.innerHTML = html;

        // Event delegation for class list items
        listContainer.querySelectorAll('.class-list-item').forEach(function(item) {
            item.addEventListener('click', function() {
                state.selectedClassId = this.dataset.id;
                state.selectedCharacterId = null;
                renderClassList();
                renderClassDetail();
                updateMobileSelectorValue(state.selectedClassId);
            });
        });
    }

    // ============================================================
    // MOBILE SELECTOR
    // ============================================================

    function updateMobileSelector(classes) {
        var container = document.getElementById('mobile-class-selector');
        var select = document.getElementById('mobile-class-select');
        
        if (!container || !select) return;

        if (state.isMobile) {
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }

        select.innerHTML = '<option value="">Select a class...</option>';
        
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        }

        select.addEventListener('change', function() {
            if (this.value) {
                state.selectedClassId = this.value;
                state.selectedCharacterId = null;
                renderClassList();
                renderClassDetail();
            }
        });
    }

    function updateMobileSelectorValue(classId) {
        var select = document.getElementById('mobile-class-select');
        if (select) {
            select.value = classId || '';
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
            detailContainer.innerHTML = '<p class="empty-state" style="font-size:0.75rem;padding:10px;">Select a class to view details.</p>';
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
        html += '<h3 style="color:var(--accent);margin:0;font-size:1rem;">' + escapeHtml(cls.name) + '</h3>';
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
        html += '<button id="manage-members-btn" class="primary small" style="font-size:0.7rem;padding:3px 8px;">Manage Members</button>';
        html += '<button id="edit-class-btn" class="secondary small" style="font-size:0.7rem;padding:3px 8px;">Edit</button>';
        html += '<button id="delete-class-btn" class="danger small" style="font-size:0.7rem;padding:3px 8px;">Delete</button>';
        html += '</div>';
        html += '</div>';

        // Stats (removed average age)
        var totalMembers = trainees.length + instructors.length;
        
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;">';
        html += '<div style="background:var(--bg);padding:6px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.55rem;color:var(--text-dim);">Total</span>';
        html += '<div style="font-size:1rem;font-weight:700;color:var(--accent);">' + totalMembers + '</div>';
        html += '</div>';
        html += '<div style="background:var(--bg);padding:6px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.55rem;color:var(--text-dim);">Trainees</span>';
        html += '<div style="font-size:1rem;font-weight:700;color:var(--accent);">' + trainees.length + '</div>';
        html += '</div>';
        html += '<div style="background:var(--bg);padding:6px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.55rem;color:var(--text-dim);">Instructors</span>';
        html += '<div style="font-size:1rem;font-weight:700;color:var(--info);">' + instructors.length + '</div>';
        html += '</div>';
        html += '</div>';

        // Character list with age
        html += '<div style="margin-top:12px;">';
        html += '<h4 style="color:var(--text-dim);font-size:0.75rem;margin-bottom:6px;">Members</h4>';
        html += '<div id="class-members-list" style="max-height:250px;overflow-y:auto;">';
        html += renderMembersList(trainees, instructors);
        html += '</div>';
        html += '</div>';

        detailContainer.innerHTML = html;

        // Bind buttons using simple direct event binding after a small delay
        // This ensures the DOM is fully updated
        setTimeout(function() {
            var manageBtn = document.getElementById('manage-members-btn');
            if (manageBtn) {
                // Remove all listeners by cloning
                var newBtn = manageBtn.cloneNode(true);
                manageBtn.parentNode.replaceChild(newBtn, manageBtn);
                newBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[ClassesView] Manage Members clicked for class:', state.selectedClassId);
                    showMemberModal(state.selectedClassId);
                });
            }

            var editBtn = document.getElementById('edit-class-btn');
            if (editBtn) {
                var newEditBtn = editBtn.cloneNode(true);
                editBtn.parentNode.replaceChild(newEditBtn, editBtn);
                newEditBtn.addEventListener('click', function() {
                    showClassForm(state.selectedClassId);
                });
            }

            var deleteBtn = document.getElementById('delete-class-btn');
            if (deleteBtn) {
                var newDeleteBtn = deleteBtn.cloneNode(true);
                deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
                newDeleteBtn.addEventListener('click', function() {
                    deleteClassHandler(state.selectedClassId);
                });
            }
        }, 50);
    }

    // ============================================================
    // RENDER MEMBERS LIST - With age display
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
            return '<p class="empty-state" style="padding:6px;font-size:0.7rem;">No members in this class.</p>';
        }

        var html = '';

        for (var i = 0; i < allMembers.length; i++) {
            var item = allMembers[i];
            var char = item.char;
            var role = item.role;
            var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : (char.name || 'Unknown');
            var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '';
            var isDeceased = char.deceased || false;
            var age = calculateAge(char);
            var ageDisplay = age !== null ? ' (' + age + 'y)' : '';

            var roleColor = role === 'instructor' ? 'var(--info)' : 'var(--accent)';
            var roleLabel = role === 'instructor' ? 'Instructor' : 'Trainee';

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-radius:4px;border-bottom:1px solid var(--border-soft);' +
                (isDeceased ? 'opacity:0.4;' : '') + '">';
            html += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
            html += '<span style="font-size:0.7rem;">' + escapeHtml(name) + '</span>';
            html += '<span style="font-size:0.5rem;color:' + roleColor + ';">[' + roleLabel + ']</span>';
            if (age !== null) {
                html += '<span style="font-size:0.5rem;color:var(--text-dim);">' + ageDisplay + '</span>';
            }
            if (isDeceased) {
                html += '<span style="font-size:0.5rem;color:var(--danger);">[Deceased]</span>';
            }
            html += '</div>';
            html += '<span style="font-size:0.55rem;color:var(--text-dim);">' + escapeHtml(status) + '</span>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // SHOW MEMBER MODAL - Completely rewritten for reliability
    // ============================================================

    function showMemberModal(classId) {
        console.log('[ClassesView] showMemberModal called for class:', classId);
        
        // Get or create modal
        var modal = document.getElementById('member-modal');
        if (!modal) {
            modal = createMemberModal();
            if (!modal) {
                alert('Member management modal could not be created. Please refresh the page.');
                return;
            }
        }

        var content = document.getElementById('member-modal-content');
        var title = document.getElementById('member-modal-title');

        if (!content || !title) {
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

        // Get data
        var allChars = [];
        if (window.data && window.data.characters) {
            allChars = window.data.characters;
        }

        var currentTrainees = typeof window.getCharactersByGraduatingClass === 'function' ? window.getCharactersByGraduatingClass(classId) : [];
        var currentInstructors = typeof window.getInstructorsByGraduatingClass === 'function' ? window.getInstructorsByGraduatingClass(classId) : [];

        var traineeIds = {};
        var instructorIds = {};
        for (var i = 0; i < currentTrainees.length; i++) {
            traineeIds[currentTrainees[i].id] = true;
        }
        for (var i = 0; i < currentInstructors.length; i++) {
            instructorIds[currentInstructors[i].id] = true;
        }

        // Build content
        content.innerHTML = buildModalContent(classId, allChars, traineeIds, instructorIds);

        // Show modal
        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Bind close buttons
        var closeBtn = document.getElementById('close-member-modal-btn');
        if (closeBtn) {
            closeBtn.onclick = function() {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            };
        }

        var closeX = document.getElementById('close-member-modal');
        if (closeX) {
            closeX.onclick = function() {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            };
        }

        modal.onclick = function(e) {
            if (e.target === this) {
                this.classList.add('hidden');
                this.style.display = 'none';
            }
        };

        // Bind filter buttons
        bindFilterButtons(classId, allChars, traineeIds, instructorIds);

        // Bind add member
        bindAddMember(classId, allChars, traineeIds, instructorIds);

        // Bind remove members using event delegation on the content
        content.onclick = function(e) {
            var removeBtn = e.target.closest('.remove-member-btn');
            if (removeBtn) {
                var charId = removeBtn.dataset.id;
                if (!charId) return;

                if (!confirm('Remove this member from the class?')) return;

                if (typeof window.removeCharacterFromGraduatingClass !== 'function') {
                    alert('Member management functions not available.');
                    return;
                }

                var result = window.removeCharacterFromGraduatingClass(charId);
                if (result && result.success) {
                    // Refresh the modal
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
            }
        };

        // Populate dropdown
        populateDropdown(classId, allChars, traineeIds, instructorIds);
    }

    // ============================================================
    // BUILD MODAL CONTENT
    // ============================================================

    function buildModalContent(classId, allChars, traineeIds, instructorIds) {
        var currentTrainees = typeof window.getCharactersByGraduatingClass === 'function' ? window.getCharactersByGraduatingClass(classId) : [];
        var currentInstructors = typeof window.getInstructorsByGraduatingClass === 'function' ? window.getInstructorsByGraduatingClass(classId) : [];

        var html = '';
        html += '<p style="color:var(--text-dim);font-size:0.8rem;margin-bottom:12px;">Add or remove members from this graduating class.</p>';

        // Add member section
        html += '<div style="background:var(--bg);padding:12px;border-radius:6px;margin-bottom:12px;border:1px solid var(--border-soft);">';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
        html += '<span style="font-size:0.75rem;color:var(--text-dim);">Add member:</span>';
        
        // Birth year filters
        html += '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">Birth Year:</span>';
        html += '<input type="number" id="filter-min-year" placeholder="Min" style="width:60px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">-</span>';
        html += '<input type="number" id="filter-max-year" placeholder="Max" style="width:60px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<button id="apply-year-filter" class="small" style="font-size:0.6rem;padding:2px 8px;">Apply</button>';
        html += '<button id="clear-year-filter" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Clear</button>';
        html += '</div>';
        
        // Character dropdown
        html += '<select id="add-member-select" style="flex:1;min-width:150px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">';
        html += '<option value="">Select a character...</option>';
        html += '</select>';
        
        // Role selector
        html += '<select id="add-member-role" style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;width:120px;">';
        html += '<option value="trainee">Trainee</option>';
        html += '<option value="instructor">Instructor</option>';
        html += '</select>';
        
        html += '<button id="add-member-btn" class="primary small" style="font-size:0.7rem;padding:4px 12px;">Add</button>';
        html += '</div>';
        
        html += '<div style="margin-top:6px;font-size:0.65rem;color:var(--text-dim);">';
        html += currentTrainees.length + ' trainees, ' + currentInstructors.length + ' instructors';
        html += '</div>';
        html += '</div>';

        // Current members
        html += '<div style="max-height:300px;overflow-y:auto;">';
        
        // Trainees
        html += '<h4 style="color:var(--accent);font-size:0.75rem;margin:8px 0 4px 0;">Trainees</h4>';
        if (currentTrainees.length === 0) {
            html += '<p style="color:var(--text-dim);font-size:0.7rem;margin:4px 0;">No trainees.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
            for (var i = 0; i < currentTrainees.length; i++) {
                var char = currentTrainees[i];
                var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : (char.name || 'Unknown');
                var age = calculateAge(char);
                var ageDisplay = age !== null ? ' (' + age + 'y)' : '';
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border-soft);">';
                html += escapeHtml(name) + ageDisplay;
                html += ' <button class="remove-member-btn" data-id="' + escapeHtml(char.id) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button>';
                html += '</span>';
            }
            html += '</div>';
        }

        // Instructors
        html += '<h4 style="color:var(--info);font-size:0.75rem;margin:8px 0 4px 0;">Instructors</h4>';
        if (currentInstructors.length === 0) {
            html += '<p style="color:var(--text-dim);font-size:0.7rem;margin:4px 0;">No instructors.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
            for (var i = 0; i < currentInstructors.length; i++) {
                var char = currentInstructors[i];
                var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : (char.name || 'Unknown');
                var age = calculateAge(char);
                var ageDisplay = age !== null ? ' (' + age + 'y)' : '';
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border-soft);">';
                html += escapeHtml(name) + ageDisplay;
                html += ' <button class="remove-member-btn" data-id="' + escapeHtml(char.id) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button>';
                html += '</span>';
            }
            html += '</div>';
        }
        
        html += '</div>';

        html += '<div class="form-actions" style="margin-top:12px;">';
        html += '<button type="button" id="close-member-modal-btn" class="secondary" style="font-size:0.75rem;">Close</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // BIND FILTER BUTTONS
    // ============================================================

    function bindFilterButtons(classId, allChars, traineeIds, instructorIds) {
        var applyBtn = document.getElementById('apply-year-filter');
        var clearBtn = document.getElementById('clear-year-filter');
        var minInput = document.getElementById('filter-min-year');
        var maxInput = document.getElementById('filter-max-year');

        if (applyBtn) {
            applyBtn.onclick = function() {
                var minYear = parseInt(minInput.value, 10);
                var maxYear = parseInt(maxInput.value, 10);
                state.minBirthYear = !isNaN(minYear) ? minYear : null;
                state.maxBirthYear = !isNaN(maxYear) ? maxYear : null;
                populateDropdown(classId, allChars, traineeIds, instructorIds);
            };
        }

        if (clearBtn) {
            clearBtn.onclick = function() {
                minInput.value = '';
                maxInput.value = '';
                state.minBirthYear = null;
                state.maxBirthYear = null;
                populateDropdown(classId, allChars, traineeIds, instructorIds);
            };
        }
    }

    // ============================================================
    // BIND ADD MEMBER
    // ============================================================

    function bindAddMember(classId, allChars, traineeIds, instructorIds) {
        var addBtn = document.getElementById('add-member-btn');
        var select = document.getElementById('add-member-select');
        var roleSelect = document.getElementById('add-member-role');

        if (addBtn) {
            addBtn.onclick = function() {
                var charId = select ? select.value : null;
                var role = roleSelect ? roleSelect.value : 'trainee';
                var isInstructor = role === 'instructor';

                if (!charId) {
                    alert('Please select a character.');
                    return;
                }

                if (typeof window.assignCharacterToGraduatingClass !== 'function') {
                    alert('Member management functions not available.');
                    return;
                }

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
            };
        }
    }

    // ============================================================
    // POPULATE DROPDOWN
    // ============================================================

    function populateDropdown(classId, allChars, traineeIds, instructorIds) {
        var select = document.getElementById('add-member-select');
        if (!select) return;

        var availableChars = allChars.filter(function(char) {
            return !traineeIds[char.id] && !instructorIds[char.id];
        });

        // Apply birth year filters
        if (state.minBirthYear !== null || state.maxBirthYear !== null) {
            availableChars = availableChars.filter(function(char) {
                var birthYear = parseInt(char.birthYear, 10);
                if (isNaN(birthYear)) {
                    return false;
                }
                if (state.minBirthYear !== null && birthYear < state.minBirthYear) {
                    return false;
                }
                if (state.maxBirthYear !== null && birthYear > state.maxBirthYear) {
                    return false;
                }
                return true;
            });
        }

        availableChars.sort(function(a, b) {
            var nameA = typeof window.getDisplayName === 'function' ? window.getDisplayName(a) : (a.name || 'Unknown');
            var nameB = typeof window.getDisplayName === 'function' ? window.getDisplayName(b) : (b.name || 'Unknown');
            return nameA.localeCompare(nameB);
        });

        select.innerHTML = '<option value="">Select a character...</option>';
        
        for (var i = 0; i < availableChars.length; i++) {
            var char = availableChars[i];
            var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : (char.name || 'Unknown');
            var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '';
            var age = calculateAge(char);
            var ageDisplay = age !== null ? ' (' + age + 'y)' : '';
            var birthYear = char.birthYear ? ' (' + char.birthYear + ')' : '';
            
            var option = document.createElement('option');
            option.value = char.id;
            option.textContent = name + ' - ' + status + ageDisplay + birthYear;
            select.appendChild(option);
        }

        // Update filter status
        var statusEl = document.getElementById('filter-status');
        if (!statusEl) {
            var statusDiv = document.createElement('div');
            statusDiv.id = 'filter-status';
            statusDiv.style.cssText = 'font-size:0.6rem;color:var(--text-dim);margin-top:4px;';
            select.parentNode.appendChild(statusDiv);
            statusEl = statusDiv;
        }
        
        if (state.minBirthYear !== null || state.maxBirthYear !== null) {
            var minText = state.minBirthYear !== null ? '≥' + state.minBirthYear : '';
            var maxText = state.maxBirthYear !== null ? '≤' + state.maxBirthYear : '';
            statusEl.textContent = 'Filter: ' + (minText + ' ' + maxText).trim() + ' (' + availableChars.length + ' characters)';
            statusEl.style.color = 'var(--accent)';
        } else {
            statusEl.textContent = 'No filter applied (' + availableChars.length + ' characters available)';
            statusEl.style.color = 'var(--text-dim)';
        }
    }

    // ============================================================
    // CREATE MEMBER MODAL
    // ============================================================

    function createMemberModal() {
        console.log('[ClassesView] Creating member modal');
        
        var modal = document.createElement('div');
        modal.id = 'member-modal';
        modal.className = 'modal hidden';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:1000;';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width:600px;max-height:80vh;overflow-y:auto;background:var(--panel);border-radius:var(--radius);padding:20px;position:relative;">
                <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3 id="member-modal-title" style="margin:0;font-size:1rem;">Manage Members</h3>
                    <button class="close-modal" id="close-member-modal" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-dim);">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="member-modal-content"></div>
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
            addBtn.onclick = function() {
                console.log('[ClassesView] Add class button clicked');
                showClassForm();
            };
        }

        var closeFormBtn = document.getElementById('close-class-form');
        if (closeFormBtn) {
            closeFormBtn.onclick = function() {
                var modal = document.getElementById('class-form-modal');
                modal.classList.add('hidden');
                modal.style.display = 'none';
            };
        }

        var cancelFormBtn = document.getElementById('cancel-class-form');
        if (cancelFormBtn) {
            cancelFormBtn.onclick = function() {
                var modal = document.getElementById('class-form-modal');
                modal.classList.add('hidden');
                modal.style.display = 'none';
            };
        }

        var form = document.getElementById('class-form-inner');
        if (form) {
            form.onsubmit = saveClass;
        }

        var formModal = document.getElementById('class-form-modal');
        if (formModal) {
            formModal.onclick = function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                    this.style.display = 'none';
                }
            };
        }

        window.addEventListener('resize', function() {
            var wasMobile = state.isMobile;
            state.isMobile = window.innerWidth < 768;
            if (wasMobile !== state.isMobile) {
                var container = document.getElementById('classes-content');
                if (container) {
                    renderClassesView(container);
                }
            }
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderClassesView = renderClassesView;

    console.log('[ClassesView] Module loaded successfully');

})();
