/**
 * modules/departments/department-events.js - Department Events
 * Event orchestration for the Departments tab.
 *
 * Path: js/modules/departments/department-events.js
 *
 * WHAT THIS OWNS:
 *   - init / destroy: bind and unbind delegated listeners on the
 *     tab container, and mount/unmount the modal host.
 *   - Selected-department state (module-level).
 *   - Modal lifecycle for the department form and the add-staff
 *     form.
 *   - Dispatching user actions to DepartmentCore mutations.
 *   - Requesting fresh VMs from DepartmentAggregator and handing
 *     them to DepartmentRender.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads, mutations, projections, or HTML.
 *
 * MODAL LIFECYCLE:
 *   The modal shells are rendered ONCE per mount into a stable
 *   host (#department-modals-host) appended to document.body.
 *
 * STAFF PICKER (this revision):
 *   Candidates are characters who are not already members of the
 *   department, not eliminated, and not deceased at the current
 *   application year.
 *
 *   ORDERING (three groups, alphabetical within each tier):
 *     Group 0  support or instructor, NOT a member of any
 *              department yet.
 *     Group 1  support or instructor, member of at least one
 *              department. The department names are attached to
 *              the option so the form can render them.
 *     Group 2  everyone else, excluding civilians who have a
 *              tournament elimination on record.
 *
 *   Within groups 0 and 1, support sorts before instructor. Then
 *   alphabetical within each tier.
 *
 *   When a candidate is selected, the join-year input is
 *   pre-filled with the year their current support/instructor
 *   status began. If they have no such status, the current
 *   application year is used. The user can override either.
 *
 * CHARACTER DETAIL HANDOFF:
 *   Clicking a member row or the head name dispatches
 *   `characterEdit` on document.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DepartmentCore
 *   - window.DepartmentQueries
 *   - window.DepartmentAggregator
 *   - window.DepartmentRender
 *   - window.CharacterQueries
 *   - window.NotificationSystem
 *   - window.DomUtils
 *
 * DEPENDENCIES (LAZY, resolved at call time):
 *   - window.EliminationQueries
 *   - window.CharacterConstants
 */

(function() {
    'use strict';

    if (window.__departmentEventsLoaded) {
        return;
    }
    window.__departmentEventsLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var DepartmentCore = window.DepartmentCore;
    var DepartmentQueries = window.DepartmentQueries;
    var DepartmentAggregator = window.DepartmentAggregator;
    var DepartmentRender = window.DepartmentRender;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    var _missing = [];

    if (!DepartmentCore) {
        _missing.push('DepartmentCore (module)');
    } else {
        var coreRequired = [
            'createDepartment',
            'updateDepartment',
            'deleteDepartment',
            'addMember',
            'removeMember',
            'setHead'
        ];
        for (var c = 0; c < coreRequired.length; c++) {
            if (typeof DepartmentCore[coreRequired[c]] !== 'function') {
                _missing.push('DepartmentCore.' + coreRequired[c]);
            }
        }
    }

    if (!DepartmentQueries) {
        _missing.push('DepartmentQueries (module)');
    } else {
        if (typeof DepartmentQueries.getDepartments !== 'function') {
            _missing.push('DepartmentQueries.getDepartments');
        }
        if (typeof DepartmentQueries.getActiveMembers !== 'function') {
            _missing.push('DepartmentQueries.getActiveMembers');
        }
    }

    if (!DepartmentAggregator) {
        _missing.push('DepartmentAggregator (module)');
    } else {
        if (typeof DepartmentAggregator.getDepartmentPageViewModel !==
            'function') {
            _missing.push(
                'DepartmentAggregator.getDepartmentPageViewModel'
            );
        }
    }

    if (!DepartmentRender) {
        _missing.push('DepartmentRender (module)');
    } else {
        var renderRequired = [
            'renderContainer',
            'renderModals',
            'renderDepartmentForm',
            'renderStaffForm'
        ];
        for (var r = 0; r < renderRequired.length; r++) {
            if (typeof DepartmentRender[renderRequired[r]] !==
                'function') {
                _missing.push('DepartmentRender.' +
                    renderRequired[r]);
            }
        }
    }

    if (!CharacterQueries) {
        _missing.push('CharacterQueries (module)');
    } else {
        if (typeof CharacterQueries.getCharacters !== 'function') {
            _missing.push('CharacterQueries.getCharacters');
        }
        if (typeof CharacterQueries.getDisplayName !== 'function') {
            _missing.push('CharacterQueries.getDisplayName');
        }
        if (typeof CharacterQueries.getStatusAtYear !== 'function') {
            _missing.push('CharacterQueries.getStatusAtYear');
        }
    }

    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[DepartmentEvents] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _container = null;
    var _modalHost = null;
    var _eventListeners = [];
    var _selectedDeptId = null;
    var _editingDeptId = null;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getCurrentYear() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }
        return new Date().getFullYear();
    }

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    function normaliseCareerStatusKey(raw) {
        if (raw === undefined || raw === null) { return ''; }
        var s = String(raw).trim().toLowerCase();
        if (s === '') { return ''; }
        var idx = s.indexOf(' (former)');
        if (idx !== -1) { s = s.substring(0, idx).trim(); }
        return s;
    }

    /**
     * Classify a character's status at the given year.
     *
     * Returns one of: 'support', 'instructor', 'civilian', 'other'.
     *
     * Delegates to CharacterConstants.classifyStatus so the
     * vocabulary stays in one place. Tiers the constants module
     * does not recognise report as 'other'.
     *
     * @param {object} char
     * @param {number} year
     * @returns {string}
     */
    function getStatusClassification(char, year) {
        var CC = getCharacterConstants();
        if (!CC || typeof CC.classifyStatus !== 'function') {
            return 'other';
        }
        if (!char) { return 'other'; }

        var status = '';
        try {
            status = CharacterQueries.getStatusAtYear(char, year);
        } catch (e) {
            return 'other';
        }
        if (typeof status !== 'string' || status.trim() === '') {
            return 'other';
        }

        var tier = null;
        try {
            tier = CC.classifyStatus(status);
        } catch (e) {
            return 'other';
        }

        if (tier === 'support' ||
            tier === 'instructor' ||
            tier === 'civilian') {
            return tier;
        }
        return 'other';
    }

    /**
     * Start year of the character's latest support or instructor
     * entry, or null when they have none. Only entries whose
     * normalised key is exactly the requested tier are considered.
     */
    function getStatusStartYear(char, tier) {
        if (!char || !Array.isArray(char.careerStatus)) {
            return null;
        }
        if (tier !== 'support' && tier !== 'instructor') {
            return null;
        }

        var latestStart = null;

        for (var i = 0; i < char.careerStatus.length; i++) {
            var entry = char.careerStatus[i];
            if (!entry || typeof entry !== 'object') { continue; }

            var key = normaliseCareerStatusKey(entry.status);
            if (key !== tier) { continue; }

            var start = parseInt(entry.startYear, 10);
            if (isNaN(start) || start < 1) { continue; }

            if (latestStart === null || start > latestStart) {
                latestStart = start;
            }
        }

        return latestStart;
    }

    /**
     * Does the character have any tournament (non-standalone)
     * elimination on record?
     *
     * Prefers EliminationQueries.getEliminationWeek when available:
     * it returns null when there is no elimination, an integer week
     * when there is one. Both standalone and tournament
     * eliminations are stored in char.eliminations, so the query's
     * answer covers both. We then confirm the record is
     * tournament-sourced by inspecting the eliminations array.
     *
     * Falls back to an inline walk when the query module is absent.
     */
    function hasTournamentElimination(char) {
        if (!char || typeof char !== 'object') { return false; }

        var EQ = getEliminationQueries();
        var charId = char.id ? String(char.id) : null;

        // Fast path: ask the canonical query whether ANY
        // elimination exists. A null answer means no eliminations
        // at all, which means no tournament elimination either.
        if (EQ &&
            typeof EQ.getEliminationWeek === 'function' &&
            charId) {
            var anyWeek = null;
            try {
                anyWeek = EQ.getEliminationWeek(charId);
            } catch (e) {
                anyWeek = null;
            }
            if (anyWeek === null || anyWeek === undefined) {
                return false;
            }
        }

        if (!Array.isArray(char.eliminations)) {
            return false;
        }

        for (var i = 0; i < char.eliminations.length; i++) {
            var e = char.eliminations[i];
            if (e && e.standalone !== true) {
                return true;
            }
        }
        return false;
    }

    function getEliminationYear() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }
        return null;
    }

    // ============================================================
    // LISTENER BOOKKEEPING
    // ============================================================

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(
                    item.eventName, item.handler
                );
            } catch (e) {
                // Ignore.
            }
        }
        _eventListeners = [];
    }

    function delegateOn(element, selector, eventName, handler) {
        if (!element) { return; }

        function wrapped(e) {
            if (!element.contains(e.target)) { return; }

            var target = e.target.closest
                ? e.target.closest(selector)
                : null;
            if (!target) { return; }
            if (!element.contains(target)) { return; }

            handler(e, target);
        }

        element.addEventListener(eventName, wrapped);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: wrapped
        });
    }

    function delegate(selector, eventName, handler) {
        delegateOn(_container, selector, eventName, handler);
    }

    // ============================================================
    // MODAL HOST
    // ============================================================

    var MODAL_HOST_ID = 'department-modals-host';

    function mountModalHost() {
        if (_modalHost && _modalHost.parentNode) { return; }

        _modalHost = document.createElement('div');
        _modalHost.id = MODAL_HOST_ID;
        _modalHost.innerHTML = DepartmentRender.renderModals();
        document.body.appendChild(_modalHost);
    }

    function unmountModalHost() {
        if (_modalHost && _modalHost.parentNode) {
            _modalHost.parentNode.removeChild(_modalHost);
        }
        _modalHost = null;
    }

    function queryModalHost(selector) {
        if (!_modalHost) { return null; }
        return _modalHost.querySelector(selector);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function refreshUI() {
        if (!_container) { return; }

        var pageVM =
            DepartmentAggregator.getDepartmentPageViewModel({
                year: getCurrentYear(),
                selectedDeptId: _selectedDeptId
            });

        _selectedDeptId = pageVM.selectedDeptId;

        _container.innerHTML =
            DepartmentRender.renderContainer(pageVM);
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (_initialized) { destroy(); }

        if (!container) {
            container = document.getElementById('tab-departments');
        }
        if (!container) {
            console.warn('[DepartmentEvents] Container not found');
            return;
        }

        _container = container;
        removeAllEventListeners();

        _selectedDeptId = null;
        _editingDeptId = null;

        mountModalHost();

        bindPageActions();
        bindSelectDepartment();
        bindDetailActions();
        bindMemberActions();
        bindHeadActions();
        bindCharacterOpeners();
        bindFormModal();
        bindStaffModal();

        _initialized = true;

        refreshUI();
    }

    function destroy() {
        closeDepartmentFormModal();
        closeStaffModal();

        removeAllEventListeners();
        unmountModalHost();

        _initialized = false;
        _container = null;
        _selectedDeptId = null;
        _editingDeptId = null;
    }

    // ============================================================
    // PAGE ACTIONS
    // ============================================================

    function bindPageActions() {
        delegate('#add-department-btn', 'click', function(e) {
            e.preventDefault();
            openDepartmentFormModal(null);
        });
    }

    // ============================================================
    // SELECT
    // ============================================================

    function bindSelectDepartment() {
        delegate('[data-action="department-select"]', 'click',
            function(e, target) {
                e.preventDefault();
                var deptId = target.dataset.departmentId;
                if (!deptId) { return; }
                _selectedDeptId = deptId;
                refreshUI();
            }
        );
    }

    // ============================================================
    // DETAIL ACTIONS
    // ============================================================

    function bindDetailActions() {
        delegate('[data-action="department-edit"]', 'click',
            function(e, target) {
                e.preventDefault();
                var deptId = target.dataset.departmentId;
                if (deptId) { openDepartmentFormModal(deptId); }
            }
        );

        delegate('[data-action="department-add-staff"]', 'click',
            function(e, target) {
                e.preventDefault();
                var deptId = target.dataset.departmentId;
                if (deptId) { openStaffModal(deptId); }
            }
        );

        delegate('[data-action="department-delete"]', 'click',
            function(e, target) {
                e.preventDefault();
                var deptId = target.dataset.departmentId;
                if (deptId) { handleDeleteDepartment(deptId); }
            }
        );
    }

    function handleDeleteDepartment(deptId) {
        var dept = DepartmentQueries.getDepartmentById(deptId);
        if (!dept) {
            notify('Department not found.', 'error');
            return;
        }

        var name = dept.name || 'this department';
        if (!window.confirm(
            'Delete "' + name + '"? This cannot be undone.'
        )) {
            return;
        }

        DepartmentCore.deleteDepartment(deptId)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        (result && result.message) ||
                            'Failed to delete department.',
                        'error'
                    );
                    return;
                }

                if (String(_selectedDeptId) === String(deptId)) {
                    _selectedDeptId = null;
                }

                refreshUI();
                notify('Department deleted.', 'success');
            })
            .catch(function(err) {
                console.warn(
                    '[DepartmentEvents] deleteDepartment threw:', err
                );
                notify('Failed to delete department.', 'error');
            });
    }

    // ============================================================
    // MEMBER ACTIONS
    // ============================================================

    function bindMemberActions() {
        delegate('[data-action="department-remove-member"]', 'click',
            function(e, target) {
                e.preventDefault();
                var deptId = target.dataset.departmentId;
                var charId = target.dataset.characterId;
                if (!deptId || !charId) { return; }
                handleRemoveMember(deptId, charId);
            }
        );
    }

    function handleRemoveMember(deptId, charId) {
        var char = CharacterQueries.getCharacterById(charId);
        var name = char
            ? CharacterQueries.getDisplayName(char)
            : charId;

        if (!window.confirm(
            'Remove ' + name + ' from this department?'
        )) {
            return;
        }

        DepartmentCore.removeMember(deptId, charId)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        (result && result.message) ||
                            'Failed to remove member.',
                        'error'
                    );
                    return;
                }
                refreshUI();
            })
            .catch(function(err) {
                console.warn(
                    '[DepartmentEvents] removeMember threw:', err
                );
                notify('Failed to remove member.', 'error');
            });
    }

    // ============================================================
    // HEAD ACTIONS
    // ============================================================

    function bindHeadActions() {
        delegate('[data-action="department-set-head"]', 'click',
            function(e, target) {
                e.preventDefault();
                var deptId = target.dataset.departmentId;
                var charId = target.dataset.characterId;
                if (!deptId || !charId) { return; }
                handleSetHead(deptId, charId);
            }
        );

        delegate('[data-action="department-clear-head"]', 'click',
            function(e, target) {
                e.preventDefault();
                var deptId = target.dataset.departmentId;
                if (!deptId) { return; }
                handleSetHead(deptId, null);
            }
        );
    }

    function handleSetHead(deptId, charId) {
        DepartmentCore.setHead(deptId, charId)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        (result && result.message) ||
                            'Failed to set head.',
                        'error'
                    );
                    return;
                }
                refreshUI();
            })
            .catch(function(err) {
                console.warn(
                    '[DepartmentEvents] setHead threw:', err
                );
                notify('Failed to set head.', 'error');
            });
    }

    // ============================================================
    // CHARACTER-OPEN HANDOFF
    // ============================================================

    function bindCharacterOpeners() {
        delegate('[data-action="department-open-member"]', 'click',
            function(e, target) {
                e.preventDefault();
                e.stopPropagation();
                var charId = target.dataset.characterId;
                if (!charId) { return; }
                dispatchCharacterOpen(charId);
            }
        );

        delegate('[data-action="department-open-head"]', 'click',
            function(e, target) {
                e.preventDefault();
                var charId = target.dataset.characterId;
                if (!charId) { return; }
                dispatchCharacterOpen(charId);
            }
        );
    }

    function dispatchCharacterOpen(charId) {
        try {
            var event = new CustomEvent('characterEdit', {
                detail: { characterId: String(charId) },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            console.warn(
                '[DepartmentEvents] characterEdit dispatch failed:',
                e
            );
        }
    }

    // ============================================================
    // DEPARTMENT FORM MODAL
    // ============================================================

    function bindFormModal() {
        delegateOn(_modalHost,
            '[data-action="department-form-close"]', 'click',
            function(e) {
                e.preventDefault();
                closeDepartmentFormModal();
            }
        );
    }

    function openDepartmentFormModal(deptId) {
        _editingDeptId = deptId ? String(deptId) : null;

        var dept = _editingDeptId
            ? DepartmentQueries.getDepartmentById(_editingDeptId)
            : null;

        if (_editingDeptId && !dept) {
            notify('Department not found.', 'error');
            _editingDeptId = null;
            return;
        }

        var formVM = buildDepartmentFormVM(dept);

        var modalEl = queryModalHost('#department-form-modal');
        var titleEl = queryModalHost('#department-form-title');
        var contentEl = queryModalHost('#department-form-content');
        if (!modalEl || !contentEl) {
            console.warn(
                '[DepartmentEvents] form modal shell not found.'
            );
            return;
        }

        if (titleEl) {
            titleEl.textContent = dept
                ? 'Edit Department'
                : 'New Department';
        }

        contentEl.innerHTML =
            DepartmentRender.renderDepartmentForm(formVM);

        modalEl.classList.remove('hidden');

        var form = contentEl.querySelector(
            '#department-form-inner'
        );
        if (form) {
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                handleSaveDepartment(form);
            });
        }

        setTimeout(function() {
            var nameInput = contentEl.querySelector(
                '#department-name'
            );
            if (nameInput && typeof nameInput.focus === 'function') {
                try { nameInput.focus(); } catch (e) {}
            }
        }, 50);
    }

    function buildDepartmentFormVM(dept) {
        if (!dept) {
            return {
                isEdit: false,
                departmentId: '',
                name: '',
                description: '',
                headId: '',
                memberOptions: []
            };
        }

        var members = Array.isArray(dept.members)
            ? dept.members
            : [];

        var options = [];
        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            if (!m || !m.characterId) { continue; }
            var char = CharacterQueries.getCharacterById(
                m.characterId
            );
            var name = char
                ? CharacterQueries.getDisplayName(char)
                : m.characterId;
            options.push({
                id: String(m.characterId),
                name: name
            });
        }
        options.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return {
            isEdit: true,
            departmentId: String(dept.id),
            name: dept.name || '',
            description: dept.description || '',
            headId: dept.headId ? String(dept.headId) : '',
            memberOptions: options
        };
    }

    function closeDepartmentFormModal() {
        if (!_modalHost) {
            _editingDeptId = null;
            return;
        }

        var modalEl = queryModalHost('#department-form-modal');
        var contentEl = queryModalHost('#department-form-content');

        if (modalEl) { modalEl.classList.add('hidden'); }
        if (contentEl) { contentEl.innerHTML = ''; }
        _editingDeptId = null;
    }

    function handleSaveDepartment(form) {
        var deptId = form.dataset.editId || null;

        var nameEl = form.querySelector('#department-name');
        var descriptionEl = form.querySelector(
            '#department-description'
        );
        var headEl = form.querySelector('#department-head');

        var name = nameEl
            ? String(nameEl.value || '').trim()
            : '';
        if (!name) {
            notify('Department name is required.', 'error');
            return;
        }

        var description = descriptionEl
            ? String(descriptionEl.value || '')
            : '';

        var headId = headEl && !headEl.disabled &&
            headEl.value
            ? String(headEl.value)
            : null;

        var promise;
        if (deptId) {
            promise = DepartmentCore.updateDepartment(deptId, {
                name: name,
                description: description,
                headId: headId
            });
        } else {
            promise = DepartmentCore.createDepartment({
                name: name,
                description: description,
                headId: headId,
                initialHead: false
            });
        }

        promise
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        (result && result.message) ||
                            'Failed to save department.',
                        'error'
                    );
                    return;
                }

                if (!deptId && result.data &&
                    result.data.department) {
                    _selectedDeptId =
                        result.data.department.id;
                }

                closeDepartmentFormModal();
                refreshUI();
                notify('Department saved.', 'success');
            })
            .catch(function(err) {
                console.warn(
                    '[DepartmentEvents] saveDepartment threw:', err
                );
                notify('Failed to save department.', 'error');
            });
    }

    // ============================================================
    // STAFF MODAL
    // ============================================================

    function bindStaffModal() {
        delegateOn(_modalHost,
            '[data-action="department-staff-close"]', 'click',
            function(e) {
                e.preventDefault();
                closeStaffModal();
            }
        );
    }

    function openStaffModal(deptId) {
        var dept = DepartmentQueries.getDepartmentById(deptId);
        if (!dept) {
            notify('Department not found.', 'error');
            return;
        }

        var formVM = buildStaffFormVM(dept);

        var modalEl = queryModalHost('#department-staff-modal');
        var titleEl = queryModalHost('#department-staff-title');
        var contentEl = queryModalHost('#department-staff-content');
        if (!modalEl || !contentEl) {
            console.warn(
                '[DepartmentEvents] staff modal shell not found.'
            );
            return;
        }

        if (titleEl) {
            titleEl.textContent = 'Add Staff \u2014 ' +
                (dept.name || 'Department');
        }

        contentEl.innerHTML =
            DepartmentRender.renderStaffForm(formVM);

        modalEl.classList.remove('hidden');

        var form = contentEl.querySelector(
            '#department-staff-form-inner'
        );
        if (form) {
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                handleAddStaff(form);
            });
        }

        bindStaffPickerEvents(contentEl);

        setTimeout(function() {
            var charSelect = contentEl.querySelector(
                '#department-staff-character'
            );
            if (charSelect &&
                typeof charSelect.focus === 'function') {
                try { charSelect.focus(); } catch (e) {}
            }
        }, 50);
    }

    /**
     * Wire the character select to update the join-year input.
     * When the selected option carries data-status-start-year,
     * that becomes the new value. Otherwise, fall back to the
     * current application year.
     */
    function bindStaffPickerEvents(contentEl) {
        var select = contentEl.querySelector(
            '#department-staff-character'
        );
        var yearInput = contentEl.querySelector(
            '#department-staff-join-year'
        );
        if (!select || !yearInput) { return; }

        select.addEventListener('change', function() {
            var option = select.options[select.selectedIndex];
            if (!option) { return; }

            var startYear = option.getAttribute(
                'data-status-start-year'
            );
            if (startYear && startYear.trim() !== '') {
                yearInput.value = startYear;
                return;
            }

            yearInput.value = String(getCurrentYear());
        });
    }

    /**
     * Build the add-staff form view model.
     *
     * EXCLUSIONS (apply to every candidate):
     *   - already a member of the department being edited
     *   - deceased
     *   - eliminated at the current application year
     *   - civilian WITH a tournament elimination on record
     *
     * ORDERING (three groups, alphabetical within each tier):
     *   Group 0  support or instructor, not a member of any
     *            department yet. Support before instructor.
     *   Group 1  support or instructor, member of at least one
     *            department. Support before instructor.
     *   Group 2  everyone else, alphabetical.
     *
     * Each option carries:
     *   statusTier         'support' | 'instructor' | 'civilian' | 'other'
     *   statusStartYear    start year of the character's current
     *                      support or instructor entry, or null
     *   departmentNames    array of department names (may be empty;
     *                      a character may belong to several)
     *   sortGroup          0 | 1 | 2, as above
     */
    function buildStaffFormVM(dept) {
        var existingIds = Object.create(null);
        if (Array.isArray(dept.members)) {
            for (var i = 0; i < dept.members.length; i++) {
                var m = dept.members[i];
                if (m && m.characterId) {
                    existingIds[String(m.characterId)] = true;
                }
            }
        }

        var currentYear = getCurrentYear();
        var eliminationYear = getEliminationYear();
        var EQ = getEliminationQueries();
        var canCheckElimination = EQ &&
            typeof EQ.isCharacterEliminatedByYear === 'function' &&
            eliminationYear !== null;

        var DQ = window.DepartmentQueries || null;
        var canListDepartments = DQ &&
            typeof DQ.getDepartmentsForCharacter === 'function';

        var allChars = CharacterQueries.getCharacters() || [];
        var options = [];

        for (var c = 0; c < allChars.length; c++) {
            var char = allChars[c];
            if (!char || !char.id) { continue; }

            var charId = String(char.id);

            // Already a member of THIS department.
            if (existingIds[charId]) { continue; }

            // Deceased.
            if (char.deceased === true) { continue; }

            // Eliminated at the current application year.
            if (canCheckElimination) {
                var eliminated = false;
                try {
                    eliminated = EQ.isCharacterEliminatedByYear(
                        charId, eliminationYear
                    ) === true;
                } catch (e) {
                    eliminated = false;
                }
                if (eliminated) { continue; }
            }

            // ---- Tier classification ----
            var tier = getStatusClassification(char, currentYear);
            var isSupportOrInstructor =
                (tier === 'support' || tier === 'instructor');
            var isCivilian = (tier === 'civilian');

            // ---- Civilian with tournament elimination: excluded ----
            if (isCivilian && hasTournamentElimination(char)) {
                continue;
            }

            // ---- All-time department memberships ----
            //
            // getDepartmentsForCharacter with no year argument
            // returns every department where the character has a
            // member entry on any interval (active or former).
            // That is what the picker's "already in a department"
            // grouping needs.
            var departmentNames = [];
            if (canListDepartments) {
                var depts = [];
                try {
                    depts = DQ.getDepartmentsForCharacter(
                        charId
                    ) || [];
                } catch (e) {
                    depts = [];
                }
                for (var d = 0; d < depts.length; d++) {
                    if (depts[d] &&
                        isNonEmptyString(depts[d].name)) {
                        departmentNames.push(
                            String(depts[d].name)
                        );
                    }
                }
                departmentNames.sort();
            }

            var hasDepartment = departmentNames.length > 0;

            // ---- Group assignment ----
            var sortGroup;
            if (isSupportOrInstructor) {
                sortGroup = hasDepartment ? 1 : 0;
            } else {
                sortGroup = 2;
            }

            var startYear = null;
            if (isSupportOrInstructor) {
                startYear = getStatusStartYear(char, tier);
            }

            options.push({
                id: charId,
                name: CharacterQueries.getDisplayName(char),
                statusTier: tier,
                statusStartYear: startYear,
                departmentNames: departmentNames,
                sortGroup: sortGroup
            });
        }

        options.sort(function(a, b) {
            if (a.sortGroup !== b.sortGroup) {
                return a.sortGroup - b.sortGroup;
            }
            // Within the two support/instructor groups, sort by
            // tier: support before instructor, then name.
            if (a.sortGroup !== 2 &&
                a.statusTier !== b.statusTier) {
                return tierSortRank(a.statusTier) -
                    tierSortRank(b.statusTier);
            }
            return a.name.localeCompare(b.name);
        });

        var defaultJoinYear = currentYear;
        if (options.length > 0) {
            var first = options[0];
            if ((first.statusTier === 'support' ||
                 first.statusTier === 'instructor') &&
                first.statusStartYear !== null) {
                defaultJoinYear = first.statusStartYear;
            }
        }

        return {
            departmentId: String(dept.id),
            departmentName: dept.name || 'Department',
            characterOptions: options,
            defaultJoinYear: defaultJoinYear
        };
    }

    function tierSortRank(tier) {
        if (tier === 'support') { return 0; }
        if (tier === 'instructor') { return 1; }
        return 2;
    }

    function closeStaffModal() {
        if (!_modalHost) { return; }

        var modalEl = queryModalHost('#department-staff-modal');
        var contentEl = queryModalHost('#department-staff-content');

        if (modalEl) { modalEl.classList.add('hidden'); }
        if (contentEl) { contentEl.innerHTML = ''; }
    }

    function handleAddStaff(form) {
        var deptId = form.dataset.departmentId;
        if (!deptId) {
            notify('Department ID is missing.', 'error');
            return;
        }

        var charEl = form.querySelector(
            '#department-staff-character'
        );
        var yearEl = form.querySelector(
            '#department-staff-join-year'
        );

        var charId = charEl ? String(charEl.value || '') : '';
        if (!charId) {
            notify('Select a character.', 'error');
            return;
        }

        var joinYear = yearEl
            ? parseInt(yearEl.value, 10)
            : NaN;
        if (isNaN(joinYear) || joinYear < 1) {
            notify('A valid join year is required.', 'error');
            return;
        }

        DepartmentCore.addMember(deptId, charId, joinYear)
            .then(function(result) {
                if (!result || !result.success) {
                    notify(
                        (result && result.message) ||
                            'Failed to add staff.',
                        'error'
                    );
                    return;
                }

                closeStaffModal();
                refreshUI();
                notify('Staff added.', 'success');
            })
            .catch(function(err) {
                console.warn(
                    '[DepartmentEvents] addMember threw:', err
                );
                notify('Failed to add staff.', 'error');
            });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DepartmentEvents = Object.freeze({
        init: init,
        destroy: destroy,
        refreshUI: refreshUI
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.DepartmentEvents;
        var missing = [];

        var required = ['init', 'destroy', 'refreshUI'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[DepartmentEvents] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
