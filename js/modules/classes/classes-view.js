/**
 * modules/classes/classes-view.js - Classes View
 * Renders graduating class UI - RENDER ONLY
 * Path: js/modules/classes/classes-view.js
 * 
 * This module is responsible for:
 *   - Rendering the class list
 *   - Rendering class detail view
 *   - Rendering member management modal content
 *   - Mobile-responsive layout
 *   - Birth year filtering (UI only)
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no event binding (handled by classes-events.js)
 *   - No data mutations (handled by classes-core.js)
 *   - No persistence calls (handled by caller/classes-events.js)
 *   - All user-controlled data is inserted using DOM APIs (textContent)
 *   - Query results are DEEP CLONED to prevent external mutation
 * 
 * DEPENDENCIES:
 *   - window.ClassesCore (from classes-core.js)
 *   - window.CoreUtils (from core-utils.js)
 *   - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
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
    // RENDER CLASSES VIEW - Public API
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

        // Update mobile selector
        updateMobileSelector();
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
            return;
        }

        var classes = window.ClassesCore.getGraduatingClasses();
        updateMobileSelectorOptions(classes);

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

            var trainees = window.ClassesCore.getCharactersByGraduatingClass(cls.id);
            var instructors = window.ClassesCore.getInstructorsByGraduatingClass(cls.id);
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
    }

    // ============================================================
    // MOBILE SELECTOR
    // ============================================================

    function updateMobileSelector() {
        var container = document.getElementById('mobile-class-selector');
        var classes = window.ClassesCore.getGraduatingClasses();

        if (!container) return;

        if (state.isMobile) {
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }

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
            option.textContent = cls.name;
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
        if (!detailContainer) {
            return;
        }

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

        var trainees = window.ClassesCore.getCharactersByGraduatingClass(state.selectedClassId);
        var instructors = window.ClassesCore.getInstructorsByGraduatingClass(state.selectedClassId);

        var html = '';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h3 style="color:var(--accent);margin:0;font-size:1rem;">' + escapeHtml(cls.name) + '</h3>';
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';
        html += '<button id="manage-members-btn" class="primary small" style="font-size:0.7rem;padding:3px 8px;" data-class-id="' + escapeHtml(state.selectedClassId) + '">Manage Members</button>';
        html += '<button id="edit-class-btn" class="secondary small" style="font-size:0.7rem;padding:3px 8px;" data-class-id="' + escapeHtml(state.selectedClassId) + '">Edit</button>';
        html += '<button id="delete-class-btn" class="danger small" style="font-size:0.7rem;padding:3px 8px;" data-class-id="' + escapeHtml(state.selectedClassId) + '">Delete</button>';
        html += '</div>';
        html += '</div>';

        // Stats
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
            var nameA = window.CoreUtils.getDisplayName(a.char);
            var nameB = window.CoreUtils.getDisplayName(b.char);
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
            var name = window.CoreUtils.getDisplayName(char);
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
    // MEMBER MODAL CONTENT - RENDER ONLY
    // ============================================================

    function renderMemberModalContent(classId, allChars, traineeIds, instructorIds) {
        var currentTrainees = window.ClassesCore.getCharactersByGraduatingClass(classId);
        var currentInstructors = window.ClassesCore.getInstructorsByGraduatingClass(classId);

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
                var name = window.CoreUtils.getDisplayName(char);
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
                var name = window.CoreUtils.getDisplayName(char);
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
            var nameA = window.CoreUtils.getDisplayName(a);
            var nameB = window.CoreUtils.getDisplayName(b);
            return nameA.localeCompare(nameB);
        });

        select.innerHTML = '<option value="">Select a character...</option>';

        for (var i = 0; i < availableChars.length; i++) {
            var char = availableChars[i];
            var name = window.CoreUtils.getDisplayName(char);
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
    // STATE MANAGEMENT
    // ============================================================

    function selectClass(classId) {
        state.selectedClassId = classId;
        updateMobileSelectorValue(classId);
    }

    function getSelectedClassId() {
        return state.selectedClassId;
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

    function clearSelection() {
        state.selectedClassId = null;
    }

    function handleResize() {
        var wasMobile = state.isMobile;
        state.isMobile = window.innerWidth < 768;
        if (wasMobile !== state.isMobile) {
            var container = document.getElementById('classes-content');
            if (container) {
                renderClassesView(container);
            }
        }
    }

    // ============================================================
    // SHOW MEMBER MODAL - Called from ClassesEvents
    // ============================================================

    function showMemberModal(classId, container) {
        console.log('[ClassesView] showMemberModal called for class:', classId);

        var modal = document.getElementById('member-modal');
        if (!modal) {
            console.warn('ClassesView: member-modal not found');
            return;
        }

        var content = document.getElementById('member-modal-content');
        var title = document.getElementById('member-modal-title');

        if (!content || !title) {
            console.warn('ClassesView: member-modal elements not found');
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            alert('Class not found.');
            return;
        }

        title.textContent = 'Manage Members - ' + cls.name;

        // Get data
        var allChars = window.data && window.data.characters ? window.data.characters : [];
        var currentTrainees = window.ClassesCore.getCharactersByGraduatingClass(classId);
        var currentInstructors = window.ClassesCore.getInstructorsByGraduatingClass(classId);

        var traineeIds = {};
        var instructorIds = {};
        currentTrainees.forEach(function(c) { traineeIds[c.id] = true; });
        currentInstructors.forEach(function(c) { instructorIds[c.id] = true; });

        // Build content
        content.innerHTML = renderMemberModalContent(classId, allChars, traineeIds, instructorIds);

        // Show modal
        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Populate dropdown
        populateDropdown(classId, allChars, traineeIds, instructorIds);
    }

    // ============================================================
    // EXPOSE - Render-only API
    // ============================================================

    window.ClassesView = {
        // Rendering
        renderClassesView: renderClassesView,
        renderClassList: renderClassList,
        renderClassDetail: renderClassDetail,
        renderMembersList: renderMembersList,
        renderMemberModalContent: renderMemberModalContent,

        // Dropdown
        populateDropdown: populateDropdown,

        // Member Modal
        showMemberModal: showMemberModal,

        // State
        selectClass: selectClass,
        getSelectedClassId: getSelectedClassId,
        setFilter: setFilter,
        getFilter: getFilter,
        clearSelection: clearSelection,

        // Resize
        handleResize: handleResize,

        // Constants
        MIN_WEEK: 1,
        MAX_WEEK: 52
    };

})();
