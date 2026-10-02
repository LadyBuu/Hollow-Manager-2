/**
 * modules/departments/department-render.js - Department Rendering
 * Pure HTML rendering for the Departments tab.
 *
 * Path: js/modules/departments/department-render.js
 *
 * WHAT THIS OWNS:
 *   - The tab shell: sidebar, detail panel, action row.
 *   - The department detail panel: header, members, mentoring.
 *   - Member rows (active and former).
 *   - Mentorship rows (active and former).
 *   - Modals: new/edit department, add staff.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads, projections, or mutations. Every input is a VM.
 *   - Event binding. DepartmentEvents owns it.
 *
 * VM CONTRACT:
 *   The renderer trusts the VM shape from DepartmentAggregator.
 *   It does not default missing required fields, and it does not
 *   silently skip malformed rows.
 *
 * DATA-ACTION CONVENTION:
 *   Every interactive element carries data-action. The events
 *   layer reads the attribute and dispatches.
 *
 * DEPENDENCIES:
 *   - window.DomUtils
 */

(function() {
    'use strict';

    if (window.__departmentRenderLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[DepartmentRender] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__departmentRenderLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    // ============================================================
    // TAB SHELL
    // ============================================================

    /**
     * Render the entire Departments tab.
     *
     * @param {object} pageVM - from
     *   DepartmentAggregator.getDepartmentPageViewModel
     * @returns {string} HTML
     */
    function renderContainer(pageVM) {
        if (!pageVM) {
            throw new Error(
                '[DepartmentRender] renderContainer requires a ' +
                'page VM.'
            );
        }

        var html = '';

        html += '<div class="page-header">';
        html += '<h2>Departments</h2>';
        html += '<div class="page-header-actions">';
        html += '<button type="button" id="add-department-btn" ' +
                    'class="primary">+ New Department</button>';
        html += '</div>';
        html += '</div>';

        html += '<div class="departments-layout">';

        html += renderSidebar(pageVM);
        html += renderDetailColumn(pageVM);

        html += '</div>';

        html += renderModals();

        return html;
    }

    // ============================================================
    // SIDEBAR
    // ============================================================

    function renderSidebar(pageVM) {
        var html = '';

        html += '<div class="departments-sidebar">';

        if (pageVM.summaries.length === 0) {
            html += '<p class="empty-state small">' +
                        'No departments yet.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="departments-sidebar-list">';

        for (var i = 0; i < pageVM.summaries.length; i++) {
            html += renderSidebarRow(
                pageVM.summaries[i],
                pageVM.selectedDeptId
            );
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderSidebarRow(summary, selectedDeptId) {
        var isSelected = selectedDeptId &&
            String(selectedDeptId) === String(summary.id);

        var rowClass = 'department-sidebar-row';
        if (isSelected) {
            rowClass += ' department-sidebar-row-selected';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-action="department-select" ' +
                    'data-department-id="' +
                        escapeAttribute(summary.id) + '">';

        html += '<div class="department-sidebar-name">' +
                    escapeHtml(summary.name) +
                '</div>';

        html += '<div class="department-sidebar-meta">';
        if (isNonEmptyString(summary.headDisplay)) {
            html += escapeHtml(summary.headDisplay);
        } else {
            html += '<span class="department-sidebar-no-head">' +
                        '(no head)' +
                    '</span>';
        }
        html += ' \u00b7 ' + summary.activeCount +
            ' active';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL COLUMN
    // ============================================================

    function renderDetailColumn(pageVM) {
        var html = '';

        html += '<div class="departments-detail">';

        if (!pageVM.detail) {
            html += '<p class="empty-state">' +
                        'Select a department, or create a new one.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += renderDetail(pageVM.detail);

        html += '</div>';
        return html;
    }

    function renderDetail(detail) {
        var dept = detail.department;

        var html = '';

        // ---- Header ----
        html += '<div class="department-detail-header">';

        html += '<div class="department-detail-title-row">';
        html += '<h3 class="department-detail-name">' +
                    escapeHtml(dept.name) +
                '</h3>';
        html += '</div>';

        html += '<div class="department-detail-meta">';
        if (detail.head) {
            html += 'Head: ' +
                '<span class="department-head-name" ' +
                    'data-action="department-open-head" ' +
                    'data-character-id="' +
                        escapeAttribute(detail.head.characterId) + '">' +
                    escapeHtml(detail.head.displayName) +
                '</span>';
        } else {
            html += '<span class="department-no-head">' +
                        'No head assigned' +
                    '</span>';
        }
        html += ' \u00b7 As of year ' +
            escapeHtml(String(detail.year));
        html += '</div>';

        if (isNonEmptyString(dept.description)) {
            html += '<p class="department-detail-description">' +
                        escapeHtml(dept.description) +
                    '</p>';
        }

        html += '</div>';

        // ---- Members ----
        html += renderMembersSection(detail);

        // ---- Mentoring ----
        html += renderMentorshipSection(detail);

        // ---- Action row ----
        html += renderDetailActions(detail);

        return html;
    }

    function renderDetailActions(detail) {
        var idAttr = escapeAttribute(detail.department.id);

        var html = '';
        html += '<div class="department-detail-actions">';

        html += '<button type="button" class="secondary small" ' +
                    'data-action="department-edit" ' +
                    'data-department-id="' + idAttr + '">' +
                    'Edit' +
                '</button>';

        html += '<button type="button" class="primary small" ' +
                    'data-action="department-add-staff" ' +
                    'data-department-id="' + idAttr + '">' +
                    '+ Add Staff' +
                '</button>';

        html += '<button type="button" class="danger small" ' +
                    'data-action="department-delete" ' +
                    'data-department-id="' + idAttr + '">' +
                    'Delete' +
                '</button>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // MEMBERS SECTION
    // ============================================================

    function renderMembersSection(detail) {
        var active = detail.members.active;
        var former = detail.members.former;

        var html = '';
        html += '<div class="department-section department-members">';

        html += '<div class="department-section-header">';
        html += '<strong>Staff</strong>';
        html += '<span class="department-section-count">' +
                    active.length + ' active' +
                    (former.length > 0
                        ? ', ' + former.length + ' former'
                        : '') +
                '</span>';
        html += '</div>';

        if (active.length === 0 && former.length === 0) {
            html += '<p class="empty-state small">' +
                        'No staff members.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="list-header department-members-header">';
        html += '<span>Name</span>';
        html += '<span>Joined</span>';
        html += '<span>Status</span>';
        html += '<span></span>';
        html += '</div>';

        for (var i = 0; i < active.length; i++) {
            html += renderMemberRow(active[i], detail);
        }

        if (former.length > 0) {
            html += '<div class="department-members-divider">' +
                        'Former staff' +
                    '</div>';
            for (var j = 0; j < former.length; j++) {
                html += renderMemberRow(former[j], detail);
            }
        }

        html += '</div>';
        return html;
    }

    function renderMemberRow(row, detail) {
        var deptId = detail.department.id;

        var rowClass = 'list-item department-member-row';
        if (row.isHead) {
            rowClass += ' department-member-is-head';
        }
        if (!row.isActive) {
            rowClass += ' department-member-inactive';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(row.characterId) + '">';

        html += '<span class="department-member-name">';
        html += '<span class="department-member-name-text" ' +
                    'data-action="department-open-member" ' +
                    'data-character-id="' +
                        escapeAttribute(row.characterId) + '">' +
                    escapeHtml(row.displayName) +
                '</span>';
        if (row.isHead) {
            html += ' <span class="department-head-badge">' +
                        'Head' +
                    '</span>';
        }
        html += '</span>';

        html += '<span class="department-member-join">' +
                    escapeHtml(row.joinDisplay) +
                '</span>';

        html += '<span class="department-member-status ' +
                    escapeAttribute(row.statusClass) + '">' +
                    escapeHtml(row.statusLabel || '') +
                '</span>';

        html += '<span class="department-member-actions">';
        if (!row.isHead) {
            html += '<button type="button" class="small secondary" ' +
                        'data-action="department-set-head" ' +
                        'data-department-id="' +
                            escapeAttribute(deptId) + '" ' +
                        'data-character-id="' +
                            escapeAttribute(row.characterId) + '">' +
                        'Make head' +
                    '</button>';
        } else {
            html += '<button type="button" class="small secondary" ' +
                        'data-action="department-clear-head" ' +
                        'data-department-id="' +
                            escapeAttribute(deptId) + '">' +
                        'Clear head' +
                    '</button>';
        }
        html += '<button type="button" class="small danger" ' +
                    'data-action="department-remove-member" ' +
                    'data-department-id="' +
                        escapeAttribute(deptId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(row.characterId) + '">' +
                    '\u2715' +
                '</button>';
        html += '</span>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // MENTORSHIP SECTION
    // ============================================================

    function renderMentorshipSection(detail) {
        var active = detail.mentorships.active;
        var former = detail.mentorships.former;

        var html = '';
        html += '<div class="department-section department-mentorships">';

        html += '<div class="department-section-header">';
        html += '<strong>Mentoring</strong>';
        html += '<span class="department-section-count">' +
                    active.length + ' active' +
                    (former.length > 0
                        ? ', ' + former.length + ' former'
                        : '') +
                '</span>';
        html += '</div>';

        if (active.length === 0 && former.length === 0) {
            html += '<p class="empty-state small">' +
                        'No mentorships recorded within this ' +
                        'department at the selected year.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        if (active.length > 0) {
            html += '<div class="department-mentorship-subheader">' +
                        'Active' +
                    '</div>';
            for (var i = 0; i < active.length; i++) {
                html += renderMentorshipRow(active[i]);
            }
        }

        if (former.length > 0) {
            html += '<div class="department-mentorship-subheader ' +
                        'department-mentorship-former-header">' +
                        'Former' +
                    '</div>';
            for (var j = 0; j < former.length; j++) {
                html += renderMentorshipRow(former[j]);
            }
        }

        html += '</div>';
        return html;
    }

    function renderMentorshipRow(row) {
        var html = '';
        html += '<div class="department-mentorship-row" ' +
                    'data-relationship-id="' +
                        escapeAttribute(row.id) + '">';

        html += '<span class="department-mentorship-line">';
        html += '<span class="department-mentorship-mentor">' +
                    escapeHtml(row.mentorName) +
                '</span>';
        html += '<span class="department-mentorship-arrow">' +
                    '\u2192' +
                '</span>';
        html += '<span class="department-mentorship-apprentice">' +
                    escapeHtml(row.apprenticeName) +
                '</span>';
        html += '</span>';

        if (isNonEmptyString(row.periodDisplay)) {
            html += '<span class="department-mentorship-period">' +
                        escapeHtml(row.periodDisplay) +
                    '</span>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // MODALS
    // ============================================================

    function renderModals() {
        var html = '';

        // ---- Department form modal ----
        html += '<div id="department-form-modal" ' +
                    'class="modal hidden">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<h3 id="department-form-title">' +
                                'New Department' +
                            '</h3>' +
                            '<button type="button" class="close-modal" ' +
                                    'data-action="department-form-close"' +
                                    '>&times;</button>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="department-form-content"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';

        // ---- Add staff modal ----
        html += '<div id="department-staff-modal" ' +
                    'class="modal hidden">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<h3 id="department-staff-title">' +
                                'Add Staff' +
                            '</h3>' +
                            '<button type="button" class="close-modal" ' +
                                    'data-action="department-staff-close"' +
                                    '>&times;</button>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="department-staff-content"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';

        return html;
    }

    // ============================================================
    // DEPARTMENT FORM
    // ============================================================

    /**
     * Render the department form.
     *
     * @param {object} formVM - { isEdit, departmentId, name,
     *   description, headId, memberOptions }
     * @returns {string} HTML
     */
    function renderDepartmentForm(formVM) {
        if (!formVM) {
            throw new Error(
                '[DepartmentRender] renderDepartmentForm requires ' +
                'a form VM.'
            );
        }

        var isEdit = formVM.isEdit === true;
        var deptId = formVM.departmentId || '';

        var headOptions = '';
        var members = Array.isArray(formVM.memberOptions)
            ? formVM.memberOptions
            : [];
        for (var i = 0; i < members.length; i++) {
            var opt = members[i];
            if (!opt || !opt.id) { continue; }
            var selected = String(formVM.headId || '') ===
                String(opt.id)
                ? ' selected'
                : '';
            headOptions += '<option value="' +
                                escapeAttribute(opt.id) + '"' +
                                selected + '>' +
                                escapeHtml(opt.name) +
                            '</option>';
        }

        var html = '';
        html += '<form id="department-form-inner" ' +
                    'data-edit-id="' +
                        escapeAttribute(deptId) + '">';

        html += '<div class="form-group">';
        html += '<label for="department-name">Name *</label>';
        html += '<input type="text" id="department-name" ' +
                    'required value="' +
                        escapeAttribute(formVM.name || '') + '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="department-description">' +
                    'Description' +
                '</label>';
        html += '<textarea id="department-description" rows="3">' +
                    escapeHtml(formVM.description || '') +
                '</textarea>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="department-head">Head</label>';
        if (isEdit && members.length === 0) {
            html += '<p class="field-hint">' +
                        'Add members before assigning a head.' +
                    '</p>';
            html += '<select id="department-head" disabled>' +
                        '<option value="">(no members yet)</option>' +
                    '</select>';
        } else if (!isEdit) {
            html += '<p class="field-hint">' +
                        'The head is assigned after creation.' +
                    '</p>';
            html += '<select id="department-head" disabled>' +
                        '<option value="">(assign after creation)' +
                        '</option>' +
                    '</select>';
        } else {
            html += '<select id="department-head">';
            html += '<option value="">(no head)</option>';
            html += headOptions;
            html += '</select>';
        }
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="department-form-close">' +
                    'Cancel' +
                '</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Save' : 'Create') +
                '</button>';
        html += '</div>';

        html += '</form>';
        return html;
    }

    // ============================================================
    // ADD STAFF FORM
    // ============================================================

    /**
     * Render the add-staff form.
     *
     * @param {object} formVM - { departmentId, departmentName,
     *   characterOptions, defaultJoinYear }
     * @returns {string} HTML
     */
    function renderStaffForm(formVM) {
        if (!formVM) {
            throw new Error(
                '[DepartmentRender] renderStaffForm requires a ' +
                'form VM.'
            );
        }

        var deptId = escapeAttribute(formVM.departmentId || '');

        var characterOptions = '';
        var characters = Array.isArray(formVM.characterOptions)
            ? formVM.characterOptions
            : [];
        for (var i = 0; i < characters.length; i++) {
            var opt = characters[i];
            if (!opt || !opt.id) { continue; }
            characterOptions += '<option value="' +
                                    escapeAttribute(opt.id) + '">' +
                                    escapeHtml(opt.name) +
                                '</option>';
        }

        var html = '';
        html += '<form id="department-staff-form-inner" ' +
                    'data-department-id="' + deptId + '">';

        html += '<p class="field-hint">' +
                    'Add a character as staff of ' +
                    escapeHtml(formVM.departmentName || 'the department') +
                    ' starting at a chosen year.' +
                '</p>';

        html += '<div class="form-group">';
        html += '<label for="department-staff-character">' +
                    'Character *' +
                '</label>';
        html += '<select id="department-staff-character" required>';
        html += '<option value="">Select character...</option>';
        html += characterOptions;
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="department-staff-join-year">' +
                    'Join Year *' +
                '</label>';
        html += '<input type="number" id="department-staff-join-year" ' +
                    'min="1" required value="' +
                        escapeAttribute(
                            safeString(formVM.defaultJoinYear)
                        ) + '">';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="department-staff-close">' +
                    'Cancel' +
                '</button>';
        html += '<button type="submit" class="primary">' +
                    'Add Staff' +
                '</button>';
        html += '</div>';

        html += '</form>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DepartmentRender = Object.freeze({
        renderContainer: renderContainer,
        renderModals: renderModals,
        renderDepartmentForm: renderDepartmentForm,
        renderStaffForm: renderStaffForm
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.DepartmentRender;
        var missing = [];

        var required = [
            'renderContainer',
            'renderModals',
            'renderDepartmentForm',
            'renderStaffForm'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[DepartmentRender] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
