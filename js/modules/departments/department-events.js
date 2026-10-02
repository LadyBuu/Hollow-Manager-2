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
 *   - Emitting CustomEvents on document for cross-domain actions
 *     (opening a character's detail modal) that the Departments
 *     tab does not own.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Reads, mutations, projections, or HTML. Those live in
 *     DepartmentQueries, DepartmentCore, DepartmentAggregator,
 *     and DepartmentRender.
 *
 * MODAL LIFECYCLE:
 *   The modal shells are rendered ONCE per mount into a stable
 *   host (#department-modals-host) appended to document.body.
 *   They are NOT part of the tab subtree, so refreshUI() cannot
 *   destroy them. Visibility is toggled via the `hidden` class.
 *   Content is written into the stable hosts
 *   #department-form-content and #department-staff-content, and
 *   cleared on close.
 *
 * SELECTED DEPARTMENT:
 *   Module-level state. Reset on init / destroy. When the
 *   selected department disappears (deleted elsewhere, or the
 *   list is replaced), the page VM resolves the fallback
 *   internally — see DepartmentAggregator.
 *
 * CHARACTER DETAIL HANDOFF:
 *   The Departments tab does not own a character detail modal.
 *   When the user clicks a member row or the head name, the
 *   events layer dispatches a `characterEdit` CustomEvent on
 *   document, matching the contract used by CharacterDetail.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DepartmentCore
 *   - window.DepartmentQueries
 *   - window.DepartmentAggregator
 *   - window.DepartmentRender
 *   - window.CharacterQueries
 *   - window.NotificationSystem
 *   - window.DomUtils
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

    /**
     * Delegate an event on a fixed element (usually _container).
     * The element is captured at bind time so we never hold onto
     * a stale reference.
     */
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
    //
    // The modal shells are rendered once per mount and appended to
    // document.body. They live outside the tab subtree so that
    // refreshUI() (which replaces _container.innerHTML) cannot
    // destroy them.

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
        // Close buttons live inside the modal host, not the tab
        // subtree. Delegate on the host directly.
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

        var allChars = CharacterQueries.getCharacters() || [];
        var options = [];
        for (var c = 0; c < allChars.length; c++) {
            var char = allChars[c];
            if (!char || !char.id) { continue; }
            if (existingIds[String(char.id)]) { continue; }
            options.push({
                id: String(char.id),
                name: CharacterQueries.getDisplayName(char)
            });
        }
        options.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return {
            departmentId: String(dept.id),
            departmentName: dept.name || 'Department',
            characterOptions: options,
            defaultJoinYear: getCurrentYear()
        };
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
            '#department-staff-year'
        ) || form.querySelector(
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
