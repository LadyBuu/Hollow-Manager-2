/**
 * modules/academy/index.js - Academy Module Entry Point
 * Single entry point for all academic year functionality.
 *
 * Path: js/modules/academy/index.js
 *
 * RESPONSIBILITIES:
 *   - Register with TabManager
 *   - Validate the academy data structure before mount
 *   - Assemble and inject the calendar provider into AcademySchedule
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
 * MOUNT IDEMPOTENCY:
 *   mountAcademy() may be invoked from two paths:
 *     - DataLoader.whenReady  → handleDataReady → mountAcademy
 *     - tabChanged            → mountAcademy
 *   Both paths can fire in the same tick during a fresh load. The
 *   _mounted flag plus unmount-before-mount guarantees at most one
 *   live mount.
 *
 * PUBLIC API SHAPE:
 *   window.Academy exposes ten methods. It does NOT re-export the
 *   domain modules. If a consumer needs a domain module, that module
 *   is available at its own global (window.AcademyClasses,
 *   window.AcademyGrades, window.AcademyDisciplines, etc.). Nesting
 *   them under window.Academy would invite callers to bypass the
 *   aggregator and read raw storage.
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
 *   - window.AcademySchedule
 *   - window.CalendarQueries
 *   - window.ScheduleCore
 *
 * DEPENDENCIES (OPTIONAL, feature-scoped):
 *   - window.DataLoader — readiness hook is skipped when absent
 *   - window.CharacterQueries — used only by the calendar provider's
 *     character existence check, which is not currently consumed
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
    var AcademySchedule = window.AcademySchedule;
    var CalendarQueries = window.CalendarQueries;
    var ScheduleCore = window.ScheduleCore;

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

    if (!AcademySchedule || typeof AcademySchedule.configure !== 'function') {
        _missing.push('AcademySchedule.configure');
    }

    if (!CalendarQueries || typeof CalendarQueries.getStudentSchedule !== 'function') {
        _missing.push('CalendarQueries.getStudentSchedule');
    }
    if (!CalendarQueries || typeof CalendarQueries.getInstructorSchedule !== 'function') {
        _missing.push('CalendarQueries.getInstructorSchedule');
    }
    if (!CalendarQueries || typeof CalendarQueries.getLocationSchedule !== 'function') {
        _missing.push('CalendarQueries.getLocationSchedule');
    }
    if (!CalendarQueries || typeof CalendarQueries.getStudentRestDays !== 'function') {
        _missing.push('CalendarQueries.getStudentRestDays');
    }
    if (!CalendarQueries || typeof CalendarQueries.getSlotMetadata !== 'function') {
        _missing.push('CalendarQueries.getSlotMetadata');
    }
    if (!CalendarQueries || typeof CalendarQueries.findClassStart !== 'function') {
        _missing.push('CalendarQueries.findClassStart');
    }

    if (!ScheduleCore || typeof ScheduleCore.setStudentSlot !== 'function') {
        _missing.push('ScheduleCore.setStudentSlot');
    }
    if (!ScheduleCore || typeof ScheduleCore.removeStudentSlot !== 'function') {
        _missing.push('ScheduleCore.removeStudentSlot');
    }
    if (!ScheduleCore || typeof ScheduleCore.clearStudentSchedule !== 'function') {
        _missing.push('ScheduleCore.clearStudentSchedule');
    }
    if (!ScheduleCore || typeof ScheduleCore.duplicateStudentSchedule !== 'function') {
        _missing.push('ScheduleCore.duplicateStudentSchedule');
    }
    if (!ScheduleCore || typeof ScheduleCore.setRestDays !== 'function') {
        _missing.push('ScheduleCore.setRestDays');
    }
    if (!ScheduleCore || typeof ScheduleCore.removeRestDays !== 'function') {
        _missing.push('ScheduleCore.removeRestDays');
    }
    if (!ScheduleCore || typeof ScheduleCore.setSlotMetadata !== 'function') {
        _missing.push('ScheduleCore.setSlotMetadata');
    }
    if (!ScheduleCore || typeof ScheduleCore.setInstructorTemplate !== 'function') {
        _missing.push('ScheduleCore.setInstructorTemplate');
    }
    if (!ScheduleCore || typeof ScheduleCore.removeInstructorTemplate !== 'function') {
        _missing.push('ScheduleCore.removeInstructorTemplate');
    }
    if (!ScheduleCore || typeof ScheduleCore.setInstructorBlock !== 'function') {
        _missing.push('ScheduleCore.setInstructorBlock');
    }
    if (!ScheduleCore || typeof ScheduleCore.removeInstructorBlock !== 'function') {
        _missing.push('ScheduleCore.removeInstructorBlock');
    }
    if (!ScheduleCore || typeof ScheduleCore.setLocationClass !== 'function') {
        _missing.push('ScheduleCore.setLocationClass');
    }
    if (!ScheduleCore || typeof ScheduleCore.removeLocationClass !== 'function') {
        _missing.push('ScheduleCore.removeLocationClass');
    }
    if (!ScheduleCore || typeof ScheduleCore.hasConflict !== 'function') {
        _missing.push('ScheduleCore.hasConflict');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyModule] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

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
     *
     * The `classStudents` check is informational: the store was
     * removed in v15 and class membership derives from
     * character.classIds. If the field is present it means a
     * migration did not run, and we log a warning. We do not block
     * the mount on it, because the store being present is harmless.
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
    // CALENDAR PROVIDER ASSEMBLY
    // ============================================================
    //
    // READS  → CalendarQueries (synchronous)
    // WRITES → ScheduleCore    (Promise-based, MutationPipeline)
    //
    // The provider is injected into AcademySchedule once. Subsequent
    // calls are no-ops.

    var _providersInitialized = false;

    function initProviders() {
        if (_providersInitialized) {
            return true;
        }

        var calendarProvider = {
            // ---- READS — CalendarQueries (synchronous) ----
            getStudentSchedule: function(studentId, week) {
                return CalendarQueries.getStudentSchedule(studentId, week);
            },
            getStudentRestDays: function(studentId, week) {
                return CalendarQueries.getStudentRestDays(studentId, week);
            },
            getSlotMetadata: function(studentId, week, day, hour) {
                return CalendarQueries.getSlotMetadata(studentId, week, day, hour);
            },
            findClassStart: function(schedule, metadata, studentId, week, day, hour) {
                return CalendarQueries.findClassStart(
                    schedule, metadata, studentId, week, day, hour
                );
            },
            getInstructorSchedule: function(instructorId, week) {
                return CalendarQueries.getInstructorSchedule(instructorId, week);
            },
            getInstructorTemplates: function(instructorId, week) {
                return CalendarQueries.getInstructorTemplates(instructorId, week);
            },
            getInstructorBlocks: function(instructorId, week) {
                return CalendarQueries.getInstructorBlocks(instructorId, week);
            },
            getLocationSchedule: function(locationId, week) {
                return CalendarQueries.getLocationSchedule(locationId, week);
            },

            // ---- WRITES — ScheduleCore (Promise-based) ----
            setStudentSlot: function(studentId, week, day, hour, disciplineId, duration, metadata) {
                return ScheduleCore.setStudentSlot(
                    studentId, week, day, hour, disciplineId, duration, metadata
                );
            },
            removeStudentSlot: function(studentId, week, day, hour) {
                return ScheduleCore.removeStudentSlot(studentId, week, day, hour);
            },
            clearStudentSchedule: function(studentId, week) {
                return ScheduleCore.clearStudentSchedule(studentId, week);
            },
            duplicateStudentSchedule: function(studentId, fromWeek, toWeek) {
                return ScheduleCore.duplicateStudentSchedule(studentId, fromWeek, toWeek);
            },
            setRestDays: function(studentId, week, days) {
                return ScheduleCore.setRestDays(studentId, week, days);
            },
            removeRestDays: function(studentId, week) {
                return ScheduleCore.removeRestDays(studentId, week);
            },
            setSlotMetadata: function(studentId, week, day, hour, metadata) {
                return ScheduleCore.setSlotMetadata(studentId, week, day, hour, metadata);
            },
            setInstructorTemplate: function(instructorId, week, day, hour, templateData) {
                return ScheduleCore.setInstructorTemplate(
                    instructorId, week, day, hour, templateData
                );
            },
            removeInstructorTemplate: function(instructorId, week, day, hour) {
                return ScheduleCore.removeInstructorTemplate(
                    instructorId, week, day, hour
                );
            },
            setInstructorBlock: function(instructorId, week, day, hour, blockData) {
                return ScheduleCore.setInstructorBlock(
                    instructorId, week, day, hour, blockData
                );
            },
            removeInstructorBlock: function(instructorId, week, day, hour) {
                return ScheduleCore.removeInstructorBlock(
                    instructorId, week, day, hour
                );
            },
            setLocationClass: function(locationId, week, day, hour, disciplineId, metadata) {
                return ScheduleCore.setLocationClass(
                    locationId, week, day, hour, disciplineId, 1, metadata
                );
            },
            removeLocationClass: function(locationId, week, day, hour) {
                return ScheduleCore.removeLocationClass(locationId, week, day, hour);
            },

            // ---- PURE PREDICATE — synchronous ----
            hasConflict: function(schedule, day, hour, duration) {
                return ScheduleCore.hasConflict(schedule, day, hour, duration);
            }
        };

        var ok = AcademySchedule.configure({
            calendarProvider: calendarProvider
        });

        if (!ok) {
            console.error(
                '[AcademyModule] AcademySchedule.configure returned false. ' +
                'The calendarProvider did not satisfy the required method contract.'
            );
            return false;
        }

        _providersInitialized = true;
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

        if (!initProviders()) {
            container.innerHTML =
                '<p class="empty-state">' +
                    'Failed to initialize academy providers. Please refresh the page.' +
                '</p>';
            return;
        }

        if (_mounted) {
            unmountAcademy();
        }

        // Hand the container to AcademyView. AcademyView owns the
        // render and the event delegation. If it throws, we do not
        // mark the module as mounted.
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
    //
    // AcademyView is the authoritative renderer. Refreshing the
    // Academy tab means re-rendering the whole tab.

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
