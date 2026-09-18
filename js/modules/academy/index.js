/**
 * modules/academy/index.js - Academy Module Entry Point
 * Single entry point for all academic year functionality.
 *
 * Path: js/modules/academy/index.js
 *
 * RESPONSIBILITIES:
 *   - Register with TabManager
 *   - Register the six Academy controllers with AcademyControllers
 *   - Validate the academy data structure before mount
 *   - Hand the container to AcademyView for rendering
 *   - Handle DataLoader and tabChanged integration
 *   - Expose a small public API on window.Academy
 *
 * ARCHITECTURE:
 *   This file is the LIFECYCLE ENTRY POINT, not a render module.
 *   All rendering and interaction live in academy-view.js.
 *   All domain modules own their own data and validation.
 *
 *   Do not add domain logic here. Do not add render logic here.
 *   Do not add per-feature bootstrapping here. If a feature needs
 *   initialization, its own module handles it.
 *
 * CONTROLLER REGISTRATION:
 *   The six Academy controllers register themselves with
 *   window.AcademyControllers here, NOT in their own files. The
 *   controllers capture their domain dependencies at IIFE time,
 *   so by the time this file runs they are fully constructed.
 *   This file is the single owner of the controller registry
 *   population, matching the load-order contract documented in
 *   index.html.
 *
 *   Registration order matters: AcademyView iterates the registry
 *   in insertion order when building the view switcher. The order
 *   below matches the pinboard's expected list.
 *
 * SCHEDULE PROVIDER (retired):
 *   The old calendar-provider bridge — AcademySchedule.configure,
 *   CalendarQueries reads, ScheduleCore writes — was retired when
 *   the schedule model moved to the teaching projector. There is no
 *   provider to assemble. Schedule data now comes from
 *   AcademyCalendarAggregator, which reads the projector directly.
 *
 * MOUNT IDEMPOTENCY:
 *   mountAcademy() may be invoked from two paths:
 *     - DataLoader.whenReady  → handleDataReady → mountAcademy
 *     - tabChanged            → mountAcademy
 *   Both paths can fire in the same tick during a fresh load. The
 *   _mounted flag plus unmount-before-mount guarantees at most one
 *   live mount.
 *
 * PUBLIC API SHAPE:
 *   window.Academy exposes the lifecycle and a small state facade.
 *   It does NOT re-export the domain modules. If a consumer needs a
 *   domain module, that module is available at its own global
 *   (window.AcademyClasses, window.AcademyGrades, etc.).
 *
 * DATA STRUCTURE VALIDATION:
 *   validateAcademyStructure() checks that window.data.academy has
 *   the shape this module expects. It does NOT repair. If the shape
 *   is wrong, the mount path renders an error state and stops. The
 *   database migration is responsible for producing the correct
 *   shape.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TabManager
 *   - window.AcademyUI
 *   - window.AcademyView
 *
 * DEPENDENCIES (OPTIONAL, feature-scoped):
 *   - window.AcademyControllers — controller registry. When absent,
 *     registration is skipped with a warning; the rest of the
 *     module still functions.
 *   - window.DataLoader — readiness hook is skipped when absent
 *   - window.NotificationSystem — used by error paths when present
 *
 * USAGE:
 *   The module self-registers with TabManager. External callers use:
 *     window.Academy.mount(container)
 *     window.Academy.refresh()
 *     window.Academy.unmount()
 */

(function() {
    'use strict';

    if (window.__academyModuleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY
    // ============================================================

    var TabManager = window.TabManager;
    var AcademyUI = window.AcademyUI;
    var AcademyView = window.AcademyView;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================
    //
    // Only checks what THIS module invokes. Sub-modules validate their
    // own dependencies at their own load time and throw on failure,
    // so a missing mandatory dependency elsewhere in the Academy
    // graph has already stopped the page before this check runs.

    var _missing = [];

    if (!TabManager || typeof TabManager.register !== 'function') {
        _missing.push('TabManager.register');
    }
    if (!TabManager || typeof TabManager.getCurrentTab !== 'function') {
        _missing.push('TabManager.getCurrentTab');
    }

    if (!AcademyUI || typeof AcademyUI.getSelectedView !== 'function') {
        _missing.push('AcademyUI.getSelectedView');
    }
    if (!AcademyUI || typeof AcademyUI.getState !== 'function') {
        _missing.push('AcademyUI.getState');
    }
    if (!AcademyUI || typeof AcademyUI.setDisplayWeek !== 'function') {
        _missing.push('AcademyUI.setDisplayWeek');
    }

    if (!AcademyView || typeof AcademyView.render !== 'function') {
        _missing.push('AcademyView.render');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyModule] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    // ============================================================
    // CONTROLLER REGISTRATION
    // ============================================================
    //
    // The six controllers are loaded as separate script tags in
    // index.html. They expose themselves on window and capture their
    // domain dependencies at IIFE time. This block is the single
    // owner of the registration step.
    //
    // Registration order is significant: AcademyView builds the view
    // switcher by iterating the registry in insertion order. The
    // order below matches the pinboard's expected list:
    //   ['weeklyTeams','disciplines','tournaments','people',
    //    'locations','rankings']
    //
    // AcademyControllers is treated as an optional dependency. When
    // it is missing (e.g. a test harness that loads index.js without
    // the controllers), registration is skipped with a warning. The
    // rest of the module still works; AcademyView will surface an
    // empty view switcher rather than crashing.

    function registerAcademyControllers() {
        var AcademyControllers = window.AcademyControllers;

        if (!AcademyControllers || typeof AcademyControllers.register !== 'function') {
            console.warn(
                '[AcademyModule] AcademyControllers registry not available. ' +
                'Academy controllers will not be registered. ' +
                'Check that controller-contract.js and academy-controllers.js ' +
                'are loaded before this module in index.html.'
            );
            return;
        }

        var registry = {
            weeklyTeams: window.AcademyWeeklyTeamsController,
            disciplines: window.AcademyDisciplineController,
            tournaments: window.AcademyExamController,
            people:      window.AcademyPeopleController,
            locations:   window.AcademyLocationController,
            rankings:    window.AcademyRankingController
        };

        var registered = [];
        var missing = [];

        Object.keys(registry).forEach(function(id) {
            var controller = registry[id];
            if (!controller || typeof controller !== 'object') {
                missing.push(id);
                return;
            }
            try {
                AcademyControllers.register(id, controller);
                registered.push(id);
            } catch (e) {
                console.error(
                    '[AcademyModule] Failed to register controller "' + id + '":',
                    e
                );
                missing.push(id);
            }
        });

        if (missing.length > 0) {
            console.warn(
                '[AcademyModule] Some Academy controllers were not registered: ' +
                missing.join(', ') + '. ' +
                'Check that their script tags are present in index.html.'
            );
        }

        if (registered.length > 0) {
            console.log(
                '[AcademyModule] Registered ' + registered.length +
                ' Academy controller(s): ' + registered.join(', ')
            );
        }
    }

    registerAcademyControllers();

    window.__academyModuleLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getNotificationSystem() {
        return window.NotificationSystem || null;
    }

    function notify(message, type) {
        var NS = getNotificationSystem();
        if (NS && typeof NS.notify === 'function') {
            NS.notify(message, type || 'info');
        }
    }

    // ============================================================
    // ACADEMY DATA STRUCTURE VALIDATION
    // ============================================================

    /**
     * Validate that window.data.academy has the shape this module
     * expects. Returns true when valid, false when not.
     *
     * Does NOT repair. The database migration is responsible for
     * producing the correct shape. If it is wrong, the mount path
     * renders an error state.
     */
    function validateAcademyStructure() {
        if (!window.data || typeof window.data !== 'object') {
            console.error('[AcademyModule] window.data is missing.');
            return false;
        }

        if (!window.data.academy || typeof window.data.academy !== 'object') {
            console.error(
                '[AcademyModule] window.data.academy is missing. ' +
                'database.js should have created it in getEmptyData() or a migration.'
            );
            return false;
        }

        var academy = window.data.academy;

        if (!academy.graduatingClasses || typeof academy.graduatingClasses !== 'object') {
            console.error('[AcademyModule] academy.graduatingClasses is missing.');
            return false;
        }
        if (!academy.grades || typeof academy.grades !== 'object') {
            console.error('[AcademyModule] academy.grades is missing.');
            return false;
        }
        if (!academy.rankings || typeof academy.rankings !== 'object') {
            console.error('[AcademyModule] academy.rankings is missing.');
            return false;
        }
        if (!academy.weeklyTeams || typeof academy.weeklyTeams !== 'object') {
            console.error('[AcademyModule] academy.weeklyTeams is missing.');
            return false;
        }
        if (!academy.enrolments || typeof academy.enrolments !== 'object') {
            console.error('[AcademyModule] academy.enrolments is missing.');
            return false;
        }
        if (!academy.socialScores || typeof academy.socialScores !== 'object') {
            console.error('[AcademyModule] academy.socialScores is missing.');
            return false;
        }
        if (!academy.settings || typeof academy.settings !== 'object') {
            console.error('[AcademyModule] academy.settings is missing.');
            return false;
        }
        if (!academy.classDisciplines || typeof academy.classDisciplines !== 'object') {
            console.error('[AcademyModule] academy.classDisciplines is missing.');
            return false;
        }
        if (!academy.teachingGroups || typeof academy.teachingGroups !== 'object') {
            console.error('[AcademyModule] academy.teachingGroups is missing.');
            return false;
        }
        if (!academy.teachingGroupSequences || typeof academy.teachingGroupSequences !== 'object') {
            console.error('[AcademyModule] academy.teachingGroupSequences is missing.');
            return false;
        }
        if (!academy.teachingSessions || typeof academy.teachingSessions !== 'object') {
            console.error('[AcademyModule] academy.teachingSessions is missing.');
            return false;
        }

        if (Object.prototype.hasOwnProperty.call(academy, 'classStudents')) {
            console.warn(
                '[AcademyModule] academy.classStudents exists. ' +
                'This store was removed in v15. Class membership is derived ' +
                'from character.classIds. The migration that removed it did ' +
                'not run; check database.js.'
            );
        }

        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _mounted = false;
    var _container = null;

    // ============================================================
    // MOUNT / UNMOUNT
    // ============================================================

    function mountAcademy(container) {
        if (!container) {
            container = document.getElementById('tab-academy');
        }

        if (!container) {
            console.warn('[AcademyModule] Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading academy data...</p>';
            return;
        }

        if (!validateAcademyStructure()) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Academy data structure is invalid. Please refresh the page.' +
                '</p>';
            return;
        }

        if (_mounted) {
            unmountAcademy();
        }

        try {
            AcademyView.render(container);
        } catch (e) {
            console.error('[AcademyModule] AcademyView.render failed:', e);
            container.innerHTML =
                '<p class="empty-state">' +
                    'Failed to render the Academy view. Please refresh the page.' +
                '</p>';
            return;
        }

        _container = container;
        _mounted = true;
    }

    function unmountAcademy() {
        if (!_mounted) {
            return;
        }

        if (AcademyView && typeof AcademyView.unmount === 'function') {
            try { AcademyView.unmount(); } catch (e) { /* ignore */ }
        }

        if (_container) {
            _container.innerHTML = '';
        }

        _mounted = false;
        _container = null;
    }

    // ============================================================
    // REFRESH
    // ============================================================

    function refreshAcademy() {
        if (!_mounted || !_container) {
            return;
        }
        try {
            AcademyView.render(_container);
        } catch (e) {
            console.error('[AcademyModule] Refresh failed:', e);
        }
    }

    // ============================================================
    // TABMANAGER REGISTRATION
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('academy', mountAcademy);
            return true;
        }
        return false;
    }

    if (!registerWithTabManager()) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // DATA READY HANDLING
    // ============================================================

    var DataLoader = window.DataLoader;

    function handleDataReady() {
        if (TabManager && TabManager.getCurrentTab() === 'academy') {
            var container = document.getElementById('tab-academy');
            if (container && !_mounted) {
                mountAcademy(container);
            }
        }
    }

    if (DataLoader && typeof DataLoader.whenReady === 'function') {
        DataLoader.whenReady(function(data) {
            if (data) {
                handleDataReady();
            }
        });
    }

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'academy') {
            var container = document.getElementById('tab-academy');
            if (container && !_mounted) {
                mountAcademy(container);
            }
        }
    });

    // ============================================================
    // PUBLIC API
    // ============================================================

    window.Academy = {
        // Lifecycle
        mount: mountAcademy,
        unmount: unmountAcademy,
        refresh: refreshAcademy,
        isMounted: function() { return _mounted; },

        // State (delegates to AcademyUI)
        getState: function() {
            return AcademyUI.getState();
        },

        // Selections (delegate to AcademyUI, then refresh)
        selectClass: function(classId) {
            AcademyUI.selectClass(classId);
            refreshAcademy();
        },
        selectCharacter: function(characterId) {
            AcademyUI.selectCharacter(characterId);
            refreshAcademy();
        },
        switchView: function(viewId) {
            if (AcademyUI.setSelectedView(viewId)) {
                refreshAcademy();
            }
        },
        clearSelections: function() {
            AcademyUI.clearSelections();
            refreshAcademy();
        },

        // Week — accepts integers or pure-digit strings, rejects
        // everything else. Delegates the parse to AcademyUI.
        setWeek: function(week) {
            if (AcademyUI.setDisplayWeek(week)) {
                refreshAcademy();
                return true;
            }
            return false;
        },

        // View reference — for tests and advanced tooling. Not part
        // of the everyday API.
        AcademyView: AcademyView
    };

})();
