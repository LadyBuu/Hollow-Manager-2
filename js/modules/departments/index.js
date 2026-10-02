/**
 * modules/departments/index.js - Departments Module Entry Point
 * Single entry point for the Departments tab.
 *
 * Path: js/modules/departments/index.js
 *
 * WHAT THIS OWNS:
 *   - TabManager registration.
 *   - Mount / unmount lifecycle for the departments tab.
 *   - Data readiness handling.
 *   - A minimal public API on window.Departments.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Any domain logic. DepartmentCore owns mutations;
 *     DepartmentQueries owns reads; DepartmentAggregator owns
 *     projections; DepartmentEvents owns interaction;
 *     DepartmentRender owns HTML.
 *   - Feature wiring. Do not add handlers here.
 *
 * LIFECYCLE:
 *   TabManager.register('departments', mountDepartments)
 *     -> mountDepartments(container)
 *       -> check window.data
 *       -> DepartmentEvents.init(container)
 *       -> refreshUI (internal to DepartmentEvents.init)
 *       -> dispatchReady
 *
 * DATA READINESS:
 *   window.data.departments is expected to be an array. If it is
 *   missing, mount renders a loading message. If it exists and is
 *   not an array, mount renders a data-malformed message. The
 *   migration that adds departments: [] runs at database load, so
 *   the second case only fires if that migration is skipped.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DepartmentEvents
 *   - window.DepartmentAggregator
 *
 * DEPENDENCIES (LAZY, at call time):
 *   - window.TabManager
 *   - window.DataLoader
 */

(function() {
    'use strict';

    if (window.__departmentsModuleLoaded) {
        return;
    }
    window.__departmentsModuleLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var DepartmentEvents = window.DepartmentEvents;
    var DepartmentAggregator = window.DepartmentAggregator;

    var _missing = [];

    if (!DepartmentEvents ||
        typeof DepartmentEvents.init !== 'function') {
        _missing.push('DepartmentEvents.init');
    }
    if (!DepartmentEvents ||
        typeof DepartmentEvents.destroy !== 'function') {
        _missing.push('DepartmentEvents.destroy');
    }
    if (!DepartmentEvents ||
        typeof DepartmentEvents.refreshUI !== 'function') {
        _missing.push('DepartmentEvents.refreshUI');
    }
    if (!DepartmentAggregator ||
        typeof DepartmentAggregator.getDepartmentPageViewModel !==
        'function') {
        _missing.push(
            'DepartmentAggregator.getDepartmentPageViewModel'
        );
    }

    if (_missing.length > 0) {
        throw new Error(
            '[DepartmentsModule] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getTabManager() {
        return window.TabManager || null;
    }

    function getDataLoader() {
        return window.DataLoader || null;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _mounted = false;
    var _hasMountedOnce = false;

    // ============================================================
    // MOUNT / UNMOUNT
    // ============================================================

    function mountDepartments(container) {
        if (!container) {
            container = document.getElementById('tab-departments');
        }
        if (!container) {
            console.warn('[DepartmentsModule] Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Loading department data...' +
                '</p>';
            return;
        }

        if (!Array.isArray(window.data.departments)) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Department data store is malformed. ' +
                    'Please refresh.' +
                '</p>';
            return;
        }

        if (_mounted) {
            unmountDepartments();
        }

        try {
            DepartmentEvents.init(container);
        } catch (error) {
            try { DepartmentEvents.destroy(); } catch (e) {}
            throw error;
        }

        _mounted = true;
        _hasMountedOnce = true;

        dispatchReady();
    }

    function unmountDepartments() {
        if (!_mounted) { return; }

        DepartmentEvents.destroy();

        _mounted = false;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function refresh() {
        if (!_mounted) { return; }
        DepartmentEvents.refreshUI();
    }

    function goToTab() {
        var TabManager = getTabManager();
        if (!TabManager ||
            typeof TabManager.switchTo !== 'function') {
            return false;
        }
        TabManager.switchTo('departments', true);
        return true;
    }

    function isMounted() {
        return _mounted;
    }

    function hasMountedOnce() {
        return _hasMountedOnce;
    }

    function getState() {
        return {
            mounted: _mounted,
            hasMountedOnce: _hasMountedOnce
        };
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function dispatchReady() {
        try {
            var event = new CustomEvent('departmentsReady', {
                detail: {
                    mounted: _mounted,
                    hasMountedOnce: _hasMountedOnce,
                    timestamp: Date.now()
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            // Ignore event dispatch errors.
        }
    }

    // ============================================================
    // TABMANAGER REGISTRATION
    // ============================================================

    function registerWithTabManager() {
        var TabManager = getTabManager();
        if (!TabManager ||
            typeof TabManager.register !== 'function') {
            return false;
        }
        TabManager.register('departments', mountDepartments);
        return true;
    }

    if (!registerWithTabManager()) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // DATA READY HANDLING
    // ============================================================

    function handleDataReady() {
        var TabManager = getTabManager();
        if (!TabManager ||
            typeof TabManager.getCurrentTab !== 'function') {
            return;
        }
        if (TabManager.getCurrentTab() !== 'departments') {
            return;
        }

        var container = document.getElementById('tab-departments');
        if (container && !_mounted) {
            mountDepartments(container);
        }
    }

    var DataLoader = getDataLoader();
    if (DataLoader &&
        typeof DataLoader.whenReady === 'function') {
        DataLoader.whenReady(function(data) {
            if (data) { handleDataReady(); }
        });
    }

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'departments') {
            var container =
                document.getElementById('tab-departments');
            if (container && !_mounted) {
                mountDepartments(container);
            }
        }
    });

    // ============================================================
    // EXPOSE
    // ============================================================

    window.Departments = Object.freeze({
        mount: mountDepartments,
        unmount: unmountDepartments,
        refresh: refresh,
        goToTab: goToTab,
        isMounted: isMounted,
        hasMountedOnce: hasMountedOnce,
        getState: getState
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.Departments;
        var missing = [];

        var required = [
            'mount',
            'unmount',
            'refresh',
            'goToTab',
            'isMounted',
            'hasMountedOnce',
            'getState'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[DepartmentsModule] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
