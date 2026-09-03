/**
 * modules/classes/classes-view.js - Classes View
 * Fixed: Member modal content includes search elements
 */

(function() {
    'use strict';

    if (window.__classesViewLoaded) {
        return;
    }
    window.__classesViewLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        selectedClassId: null,
        isMobile: window.innerWidth < 768,
        minBirthYear: null,
        maxBirthYear: null
    };

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!window.ClassesCore) {
            missing.push('ClassesCore');
        }

        if (!window.CoreUtils || typeof window.CoreUtils.getDisplayName !== 'function') {
            missing.push('CoreUtils.getDisplayName');
        }

        if (missing.length > 0) {
            console.warn('ClassesView: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) return '';
        var str = String(value);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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
    // RENDER CLASSES VIEW
    // ============================================================

    function renderClassesView(container) {
        if (!container) {
            container = document.getElementById('classes-content');
        }

        if (!container) {
            console.warn('ClassesView: Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading class data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Class view dependencies not loaded.</p>';
            return;
        }

        if (!window.data.graduatingClasses) {
            window.data.graduatingClasses = [];
        }

        state.isMobile = window.innerWidth < 768;

        container.innerHTML = getClassesHTML();
        renderClassList();
        renderClassDetail();

        updateMobileSelector();
    }

    // ============================================================
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        return `
            <div class="classes-view">
                <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                    <h2 style="margin:0;font-size:1.1rem;">Graduating Classes</h2>
                    <button id="add-class-btn" class="primary" style="font-size:0.75rem;padding:4px 12px;">+ New Class</button>
                </div>
                
                <div id="mobile-class-selector" style="display:${state.isMobile ? 'block' : 'none'};margin-bottom:12px;">
                    <select id="mobile-class-select" style="width:100%;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.8rem;">
                        <option value="">Select a class...</option>
                    </select>
                </div>

                <div class="classes-layout" style="display:flex;flex-direction:column;gap:16px;">
                    <div id="class-list-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:${state.isMobile ? '200px' : '500px'};overflow-y:auto;">
                        <div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:6px;">Classes</div>
                        <div id="class-list">
                            <p class="empty-state" style="font-size:0.75rem;padding:10px;">No classes created yet.</p>
                        </div>
                    </div>
                    
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
                                <div class="form-group">
                                    <label>Graduation Year (optional)</label>
                                    <input type="number" id="class-year" placeholder="e.g., 2028" min="1900" max="2100">
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
        if (!listContainer) return;

        var classes = window.ClassesCore.getGraduatingClasses();
        updateMobileSelectorOptions(classes);

        if (classes.length === 0) {
            listContainer.innerHTML = '<p class="empty-state" style="font-size:0.75rem;padding:10px;">No graduating classes created yet.</p>';
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

            var total = window.ClassesCore.getTotalCount(cls.id);
            var yearDisplay = cls.graduationYear ? ' (' + cls.graduationYear + ')' : '';

            html += '<div class="class-list-item" style="padding:6px 10px;border-bottom:1px solid var(--border-soft);cursor:pointer;' +
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') +
                '" data-id="' + safeId + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="font-weight:600;font-size:0.75rem;">' + safeName + yearDisplay + '</span>';
            html += '<span style="font-size:0.55rem;color:var(--text-dim);">' + total + ' members</span>';
            html += '</div>';
            html += '</div>';
        }

        listContainer.innerHTML = html;
    }

    // ============================================================
    // MOBILE SELECTOR
    // ============================================================

    function updateMobileSelector() {
        var container = document.getElementById('mobile-class-selector');
        var classes = window.ClassesCore.getGraduatingClasses();

        if (!container) return;

        state.isMobile = window.innerWidth < 768;
        container.style.display = state.isMobile ? 'block' : 'none';

        updateMobileSelectorOptions(classes);
    }

    function updateMobileSelectorOptions(classes) {
        var select = document.getElementById('mobile-class-select');
        if (!select) return;

        var currentValue = select.value || state.selectedClassId || '';

        select.innerHTML = '<option value="">Select a class...</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name + (cls.graduationYear ? ' (' + cls.graduationYear + ')' : '');
            if (String(cls.id) === String(currentValue)) {
                option.selected = true;
            }
            select.appendChild(option);
        }
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
        if (!detailContainer) return;

        if (!state.selectedClassId) {
            detailContainer.innerHTML = '<p class="empty-state" style="font-size:0.75rem;padding:10px;">Select a class to view details.</p>';
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(state.selectedClassId);
        if (!cls) {
            detailContainer.innerHTML = '<p class="empty-state">Class not found.</p>';
            state.selectedClassId = null;
            renderClassList();
            return;
        }

        var trainees = window.ClassesCore.getTraineesWithCharacters(state.selectedClassId);
        var instructors = window.ClassesCore.getInstructorsWithCharacters(state.selectedClassId);
        var total = trainees.length + instructors.length;

        var html = '';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
        html += '<h3 style="color:var(--accent);margin:0;font-size:1rem;">' + escapeHtml(cls.name) + '</h3>';
        if (cls.graduationYear) {
            html += '<span style="font-size:0.65rem;color:var(--text-dim);background:var(--panel-alt);padding:2px 8px;border-radius:4px;">Class of ' + escapeHtml(cls.graduationYear) + '</span>';
        }
        html += '</div>';
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
        html += '<button id="manage-members-btn" class="primary small" style="font-size:0.7rem;padding:3px 8px;" data-class-id="' + escapeHtml(state.selectedClassId) + '">Manage Members</button>';
        html += '<button id="edit-class-btn" class="secondary small" style="font-size:0.7rem;padding:3px 8px;" data-class-id="' + escapeHtml(state.selectedClassId) + '">Edit</button>';
        html += '<button id="delete-class-btn" class="danger small" style="font-size:0.7rem;padding:3px 8px;" data-class-id="' + escapeHtml(state.selectedClassId) + '">Delete</button>';
        html += '</div>';
        html += '</div>';

        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;">';
        html += '<div style="background:var(--bg);padding:6px;border-radius:4px;text-align:center;"><span style="font-size:0.55rem;color:var(--text-dim);">Total</span><div style="font-size:1rem;font-weight:700;color:var(--accent);">' + total + '</div></div>';
        html += '<div style="background:var(--bg);padding:6px;border-radius:4px;text-align:center;"><span style="font-size:0.55rem;color:var(--text-dim);">Trainees</span><div style="font-size:1rem;font-weight:700;color:var(--accent);">' + trainees.length + '</div></div>';
        html += '<div style="background:var(--bg);padding:6px;border-radius:4px;text-align:center;"><span style="font-size:0.55rem;color:var(--text-dim);">Instructors</span><div style="font-size:1rem;font-weight:700;color:var(--info);">' + instructors.length + '</div></div>';
        html += '</div>';

        html += '<div style="margin-top:12px;">';
        html += '<h4 style="color:var(--text-dim);font-size:0.75rem;margin-bottom:6px;">Members</h4>';
        html += '<div id="class-members-list" style="max-height:250px;overflow-y:auto;">';
        html += renderMembersList(trainees, instructors);
        html += '</div>';
        html += '</div>';

        detailContainer.innerHTML = html;
    }

    // ============================================================
    // RENDER MEMBERS LIST
    // ============================================================

    function renderMembersList(trainees, instructors) {
        var allMembers = [];

        for (var i = 0; i < trainees.length; i++) {
            allMembers.push({
                char: trainees[i].character,
                role: 'trainee',
                characterId: trainees[i].characterId
            });
        }

        for (var i = 0; i < instructors.length; i++) {
            allMembers.push({
                char: instructors[i].character,
                role: 'instructor',
                characterId: instructors[i].characterId
            });
        }

        allMembers.sort(function(a, b) {
            if (!a.char && !b.char) return 0;
            if (!a.char) return 1;
            if (!b.char) return -1;
            return window.CoreUtils.getDisplayName(a.char).localeCompare(window.CoreUtils.getDisplayName(b.char));
        });

        if (allMembers.length === 0) {
            return '<p class="empty-state" style="padding:6px;font-size:0.7rem;">No members in this class.</p>';
        }

        var html = '';

        for (var i = 0; i < allMembers.length; i++) {
            var item = allMembers[i];
            var char = item.char;
            var role = item.role;
            var roleColor = role === 'instructor' ? 'var(--info)' : 'var(--accent)';
            var roleLabel = role === 'instructor' ? 'Instructor' : 'Trainee';

            if (!char) {
                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-radius:4px;border-bottom:1px solid var(--border-soft);opacity:0.5;">';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">Unknown Character</span>';
                html += '<span style="font-size:0.5rem;color:' + roleColor + ';">[' + roleLabel + ']</span>';
                html += '</div>';
                continue;
            }

            var name = window.CoreUtils.getDisplayName(char);
            var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '';
            var isDeceased = char.deceased || false;
            var age = calculateAge(char);
            var ageDisplay = age !== null ? ' (' + age + 'y)' : '';

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
    // MEMBER MODAL CONTENT - FIXED: Includes search elements
    // ============================================================

    function renderMemberModalContent(classId) {
        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            return '<p class="empty-state">Class not found.</p>';
        }

        var trainees = window.ClassesCore.getTraineesWithCharacters(classId);
        var instructors = window.ClassesCore.getInstructorsWithCharacters(classId);

        var html = '';
        html += '<p style="color:var(--text-dim);font-size:0.8rem;margin-bottom:12px;">';
        html += 'Manage members of <strong>' + escapeHtml(cls.name) + '</strong>';
        if (cls.graduationYear) {
            html += ' (Class of ' + escapeHtml(cls.graduationYear) + ')';
        }
        html += '</p>';

        // ---- ADD MEMBER SECTION - WITH SEARCH ELEMENTS ----
        html += '<div style="background:var(--bg);padding:12px;border-radius:6px;margin-bottom:12px;border:1px solid var(--border-soft);">';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
        html += '<span style="font-size:0.75rem;color:var(--text-dim);">Add member:</span>';

        // SEARCH INPUT - THIS IS WHAT WAS MISSING
        html += '<input type="text" id="member-search" placeholder="Search by name..." style="flex:1;min-width:120px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">';

        // Role selector
        html += '<select id="member-role-select" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;width:110px;">';
        html += '<option value="trainee">Trainee</option>';
        html += '<option value="instructor">Instructor</option>';
        html += '</select>';

        html += '</div>';

        // RESULTS CONTAINER - THIS WAS ALSO MISSING
        html += '<div id="member-search-results" style="margin-top:4px;max-height:100px;overflow-y:auto;">';
        html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">Type to search for characters.</p>';
        html += '</div>';
        html += '</div>';

        // ---- CURRENT MEMBERS SECTION ----
        html += '<div style="max-height:250px;overflow-y:auto;">';

        // Trainees
        html += '<h4 style="color:var(--accent);font-size:0.75rem;margin:8px 0 4px 0;">Trainees</h4>';
        if (trainees.length === 0) {
            html += '<p style="color:var(--text-dim);font-size:0.7rem;margin:4px 0;">No trainees.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
            trainees.forEach(function(m) {
                html += renderMemberChip(m.character, m.characterId, 'trainee', classId);
            });
            html += '</div>';
        }

        // Instructors
        html += '<h4 style="color:var(--info);font-size:0.75rem;margin:8px 0 4px 0;">Instructors</h4>';
        if (instructors.length === 0) {
            html += '<p style="color:var(--text-dim);font-size:0.7rem;margin:4px 0;">No instructors.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
            instructors.forEach(function(m) {
                html += renderMemberChip(m.character, m.characterId, 'instructor', classId);
            });
            html += '</div>';
        }

        html += '</div>';

        html += '<div class="form-actions" style="margin-top:12px;">';
        html += '<button type="button" id="close-member-modal-btn" class="secondary" style="font-size:0.75rem;">Close</button>';
        html += '</div>';

        return html;
    }

    function renderMemberChip(char, characterId, role, classId) {
        if (!char) {
            return '<span class="member-chip" style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border-soft);opacity:0.5;">' +
                'Unknown Character' +
                ' <button class="remove-member-btn" data-class-id="' + escapeHtml(classId) + '" data-char-id="' + escapeHtml(characterId) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button>' +
                '</span>';
        }

        var name = window.CoreUtils.getDisplayName(char);
        var birthYear = char.birthYear ? ' (' + char.birthYear + ')' : '';
        var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '';

        var html = '<span class="member-chip" style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border-soft);">';
        html += escapeHtml(name) + birthYear + ' ' + escapeHtml(status);
        html += ' <button class="remove-member-btn" data-class-id="' + escapeHtml(classId) + '" data-char-id="' + escapeHtml(characterId) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button>';
        html += '</span>';

        return html;
    }

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    function selectClass(classId) {
        state.selectedClassId = classId;
        updateMobileSelectorValue(classId);
    }

    function getSelectedClassId() {
        return state.selectedClassId;
    }

    function clearSelection() {
        state.selectedClassId = null;
        updateMobileSelectorValue(null);
    }

    function setFilter(minYear, maxYear) {
        state.minBirthYear = minYear;
        state.maxBirthYear = maxYear;
    }

    function getFilter() {
        return {
            minYear: state.minBirthYear,
            maxYear: state.maxBirthYear
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesView = {
        renderClassesView: renderClassesView,
        renderClassList: renderClassList,
        renderClassDetail: renderClassDetail,
        renderMembersList: renderMembersList,
        renderMemberModalContent: renderMemberModalContent,
        updateMobileSelector: updateMobileSelector,
        selectClass: selectClass,
        getSelectedClassId: getSelectedClassId,
        clearSelection: clearSelection,
        setFilter: setFilter,
        getFilter: getFilter
    };

})();
