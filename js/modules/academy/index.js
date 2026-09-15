/**
 * modules/academy/index.js - Academy Module Entry Point
 * Single entry point for all academic year functionality
 *
 * Path: js/modules/academy/index.js
 *
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Verifying schema and dependencies at mount time
 *   - Assembling and injecting external providers
 *   - Handing the container to AcademyView for rendering
 *   - Handling DataLoader integration
 *   - Exposing the public Academy API
 *
 * ARCHITECTURE:
 *   This file is the LIFECYCLE ENTRY POINT, not a render module.
 *   All rendering and interaction live in academy-view.js.
 *   This file's job is to make sure the world is ready and then
 *   hand the container to AcademyView.
 *
 *   Do not add render logic here. Do not add refresh logic here.
 *   Do not add tab-content event binding here. If something needs
 *   to re-render, it goes through AcademyView.render(container).
 *
 * BOOTSTRAP LIST:
 *   The dependency check below lists the modules that MUST be loaded
 *   before this file runs. The list has grown with each phase:
 *
 *     Foundation:  AcademyClasses, AcademyGrades, AcademyDisciplines,
 *                  AcademyLocations, AcademySchedule, AcademyUI,
 *                  AcademyView, AcademyQueries, AcademyDistribute,
 *                  AcademyGroups, AcademyRanking.
 *
 *     Phase 3:     AcademyPerformance.
 *     Phase 4:     AcademyEnrolments.
 *     Phase 5:     AcademySocialScore.
 *     Phase 5b:    AcademyWeeklyTeams (week-scoped assignments).
 *     Phase 8:     AcademyCascade.
 *     Settings:    AcademySettings.
 *     Aggregation: AcademyTournamentAggregator.
 *
 *   Script-tag order in index.html must match. See index.html for
 *   the canonical order.
 *
 * CALENDAR PROVIDER READ/WRITE SPLIT:
 *   The calendar provider is a facade over two modules:
 *     - CalendarQueries owns READS. Synchronous.
 *     - ScheduleCore owns WRITES. Promise-based (MutationPipeline).
 *
 *   The provider maps each method to the correct module. It is
 *   assembled here and injected into AcademySchedule before any
 *   schedule operation runs.
 *
 * MOUNT IDEMPOTENCY:
 *   mountAcademy() may be invoked from two paths:
 *     - DataLoader.whenReady  → handleDataReady → mountAcademy
 *     - tabChanged            → mountAcademy
 *   Both paths can fire in the same tick during a fresh load. The
 *   _mounted flag plus the unmount-before-mount sequence inside
 *   mountAcademy() guarantees at most one live mount.
 *
 * DEPENDENCIES:
 *   - window.TabManager
 *   - window.CharacterQueries
 *   - window.TeamQueries
 *   - window.CalendarQueries
 *   - window.ScheduleCore
 *   - window.AcademyUI
 *   - window.AcademyView
 *   - window.AcademyClasses
 *   - window.AcademyQueries
 *   - window.AcademyGrades
 *   - window.AcademyGroups
 *   - window.AcademyRanking
 *   - window.AcademyDistribute
 *   - window.AcademySchedule
 *   - window.AcademyDisciplines
 *   - window.AcademyLocations
 *   - window.AcademyPerformance
 *   - window.AcademyEnrolments
 *   - window.AcademySocialScore
 *   - window.AcademyWeeklyTeams
 *   - window.AcademySettings
 *   - window.AcademyCascade
 *   - window.AcademyTournamentAggregator
 *   - window.DomUtils
 *   - window.NotificationSystem
 *   - window.DataLoader
 *   - window.CalendarConstants
 */

(function() {
    'use strict';

    if (window.__academyModuleLoaded) {
        return;
    }
    window.__academyModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TabManager = window.TabManager;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var CalendarQueries = window.CalendarQueries;
    var ScheduleCore = window.ScheduleCore;
    var AcademyUI = window.AcademyUI;
    var AcademyView = window.AcademyView;
    var AcademyClasses = window.AcademyClasses;
    var AcademyQueries = window.AcademyQueries;
    var AcademyGrades = window.AcademyGrades;
    var AcademyGroups = window.AcademyGroups;
    var AcademyRanking = window.AcademyRanking;
    var AcademyDistribute = window.AcademyDistribute;
    var AcademySchedule = window.AcademySchedule;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyLocations = window.AcademyLocations;
    var AcademyPerformance = window.AcademyPerformance;
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademySocialScore = window.AcademySocialScore;
    var AcademyWeeklyTeams = window.AcademyWeeklyTeams;
    var AcademySettings = window.AcademySettings;
    var AcademyCascade = window.AcademyCascade;
    var AcademyTournamentAggregator = window.AcademyTournamentAggregator;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var DataLoader = window.DataLoader;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // ---- TabManager ----
        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        // ---- Character / Team queries (used by provider + views) ----
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
            missing.push('TeamQueries.getTeamsByClass');
        }

        // ---- CalendarQueries (READS) ----
        if (!CalendarQueries || typeof CalendarQueries.getStudentSchedule !== 'function') {
            missing.push('CalendarQueries.getStudentSchedule');
        }
        if (!CalendarQueries || typeof CalendarQueries.getInstructorSchedule !== 'function') {
            missing.push('CalendarQueries.getInstructorSchedule');
        }
        if (!CalendarQueries || typeof CalendarQueries.getLocationSchedule !== 'function') {
            missing.push('CalendarQueries.getLocationSchedule');
        }
        if (!CalendarQueries || typeof CalendarQueries.getStudentRestDays !== 'function') {
            missing.push('CalendarQueries.getStudentRestDays');
        }
        if (!CalendarQueries || typeof CalendarQueries.getSlotMetadata !== 'function') {
            missing.push('CalendarQueries.getSlotMetadata');
        }
        if (!CalendarQueries || typeof CalendarQueries.findClassStart !== 'function') {
            missing.push('CalendarQueries.findClassStart');
        }
        if (!CalendarQueries || typeof CalendarQueries.getInstructorTemplates !== 'function') {
            missing.push('CalendarQueries.getInstructorTemplates');
        }
        if (!CalendarQueries || typeof CalendarQueries.getInstructorBlocks !== 'function') {
            missing.push('CalendarQueries.getInstructorBlocks');
        }

        // ---- ScheduleCore (WRITES) ----
        if (!ScheduleCore || typeof ScheduleCore.setStudentSlot !== 'function') {
            missing.push('ScheduleCore.setStudentSlot');
        }
        if (!ScheduleCore || typeof ScheduleCore.removeStudentSlot !== 'function') {
            missing.push('ScheduleCore.removeStudentSlot');
        }
        if (!ScheduleCore || typeof ScheduleCore.clearStudentSchedule !== 'function') {
            missing.push('ScheduleCore.clearStudentSchedule');
        }
        if (!ScheduleCore || typeof ScheduleCore.duplicateStudentSchedule !== 'function') {
            missing.push('ScheduleCore.duplicateStudentSchedule');
        }
        if (!ScheduleCore || typeof ScheduleCore.setRestDays !== 'function') {
            missing.push('ScheduleCore.setRestDays');
        }
        if (!ScheduleCore || typeof ScheduleCore.removeRestDays !== 'function') {
            missing.push('ScheduleCore.removeRestDays');
        }
        if (!ScheduleCore || typeof ScheduleCore.setSlotMetadata !== 'function') {
            missing.push('ScheduleCore.setSlotMetadata');
        }
        if (!ScheduleCore || typeof ScheduleCore.setInstructorTemplate !== 'function') {
            missing.push('ScheduleCore.setInstructorTemplate');
        }
        if (!ScheduleCore || typeof ScheduleCore.removeInstructorTemplate !== 'function') {
            missing.push('ScheduleCore.removeInstructorTemplate');
        }
        if (!ScheduleCore || typeof ScheduleCore.setInstructorBlock !== 'function') {
            missing.push('ScheduleCore.setInstructorBlock');
        }
        if (!ScheduleCore || typeof ScheduleCore.removeInstructorBlock !== 'function') {
            missing.push('ScheduleCore.removeInstructorBlock');
        }
        if (!ScheduleCore || typeof ScheduleCore.setLocationClass !== 'function') {
            missing.push('ScheduleCore.setLocationClass');
        }
        if (!ScheduleCore || typeof ScheduleCore.removeLocationClass !== 'function') {
            missing.push('ScheduleCore.removeLocationClass');
        }
        if (!ScheduleCore || typeof ScheduleCore.hasConflict !== 'function') {
            missing.push('ScheduleCore.hasConflict');
        }

        // ---- UI / View ----
        if (!AcademyUI || typeof AcademyUI.getSelectedView !== 'function') {
            missing.push('AcademyUI.getSelectedView');
        }
        if (!AcademyUI || typeof AcademyUI.getSelectedClassId !== 'function') {
            missing.push('AcademyUI.getSelectedClassId');
        }
        if (!AcademyView || typeof AcademyView.render !== 'function') {
            missing.push('AcademyView.render');
        }

        // ---- Academy domain: classes ----
        if (!AcademyClasses || typeof AcademyClasses.create !== 'function') {
            missing.push('AcademyClasses.create');
        }

        // ---- AcademyQueries: still consumed by academy-distribute.js ----
        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }

        // ---- Academy domain: disciplines / locations ----
        if (!AcademyDisciplines || typeof AcademyDisciplines.create !== 'function') {
            missing.push('AcademyDisciplines.create');
        }
        if (!AcademyLocations || typeof AcademyLocations.create !== 'function') {
            missing.push('AcademyLocations.create');
        }

        // ---- Schedule orchestration ----
        if (!AcademySchedule || typeof AcademySchedule.configure !== 'function') {
            missing.push('AcademySchedule.configure');
        }

        // ---- Phase 3: performance ----
        if (!AcademyPerformance || typeof AcademyPerformance.calculateAcademicAverage !== 'function') {
            missing.push('AcademyPerformance.calculateAcademicAverage');
        }

        // ---- Phase 4: enrolments ----
        if (!AcademyEnrolments || typeof AcademyEnrolments.getStudentDisciplines !== 'function') {
            missing.push('AcademyEnrolments.getStudentDisciplines');
        }

        // ---- Phase 5: social score ----
        if (!AcademySocialScore || typeof AcademySocialScore.getSocialScore !== 'function') {
            missing.push('AcademySocialScore.getSocialScore');
        }

        // ---- Phase 5b: weekly teams ----
        if (!AcademyWeeklyTeams || typeof AcademyWeeklyTeams.getWeeklyTeams !== 'function') {
            missing.push('AcademyWeeklyTeams.getWeeklyTeams');
        }

        // ---- Settings ----
        if (!AcademySettings || typeof AcademySettings.getRankingWeights !== 'function') {
            missing.push('AcademySettings.getRankingWeights');
        }

        // ---- Phase 8: cascade coordinator ----
        if (!AcademyCascade || typeof AcademyCascade.characterDeleted !== 'function') {
            missing.push('AcademyCascade.characterDeleted');
        }

        // ---- Aggregator (exam VM) ----
        if (!AcademyTournamentAggregator ||
            typeof AcademyTournamentAggregator.getExamViewModel !== 'function') {
            missing.push('AcademyTournamentAggregator.getExamViewModel');
        }

        // ---- Escape / notify / data ----
        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }
        if (!CalendarConstants) {
            missing.push('CalendarConstants');
        }

        if (missing.length > 0) {
            console.warn('[AcademyModule] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // ACADEMY DATA STRUCTURE GUARD - DEFENSIVE ONLY
    // ============================================================

    function ensureAcademyStructure() {
        if (!window.data || typeof window.data !== 'object') {
            return false;
        }

        if (!window.data.academy || typeof window.data.academy !== 'object') {
            console.error(
                '[AcademyModule] window.data.academy is missing. ' +
                'database.js should have created it in getEmptyData() or migrateToVersion15().'
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
            console.error(
                '[AcademyModule] academy.classStudents exists. ' +
                'This store was removed in v15. Class membership is derived ' +
                'from character.classIds.'
            );
        }

        return true;
    }

    // ============================================================
    // PROVIDER ASSEMBLY
    // ============================================================
    //
    // READS → CalendarQueries (synchronous)
    // WRITES → ScheduleCore (Promise-based, MutationPipeline)

    var _providersInitialized = false;

    function initProviders() {
        if (_providersInitialized) {
            return true;
        }

        var characterProvider = {
            exists: function(id) {
                if (!id) { return false; }
                var char = CharacterQueries.getCharacterById(id);
                return char !== null && char !== undefined;
            },
            getCharacterById: function(id) {
                return CharacterQueries.getCharacterById(id);
            },
            getDisplayName: function(id) {
                return CharacterQueries.getCharacterNameById(id);
            },
            getStudents: function() {
                return CharacterQueries.getStudents();
            },
            getInstructors: function() {
                return CharacterQueries.getInstructors();
            },
            getCurrentStatus: function(char) {
                return CharacterQueries.getCurrentStatus(char);
            }
        };

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
                return CalendarQueries.findClassStart(schedule, metadata, studentId, week, day, hour);
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
                return ScheduleCore.setStudentSlot(studentId, week, day, hour, disciplineId, duration, metadata);
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
                return ScheduleCore.setInstructorTemplate(instructorId, week, day, hour, templateData);
            },
            removeInstructorTemplate: function(instructorId, week, day, hour) {
                return ScheduleCore.removeInstructorTemplate(instructorId, week, day, hour);
            },
            setInstructorBlock: function(instructorId, week, day, hour, blockData) {
                return ScheduleCore.setInstructorBlock(instructorId, week, day, hour, blockData);
            },
            removeInstructorBlock: function(instructorId, week, day, hour) {
                return ScheduleCore.removeInstructorBlock(instructorId, week, day, hour);
            },
            setLocationClass: function(locationId, week, day, hour, disciplineId, metadata) {
                return ScheduleCore.setLocationClass(locationId, week, day, hour, disciplineId, 1, metadata);
            },
            removeLocationClass: function(locationId, week, day, hour) {
                return ScheduleCore.removeLocationClass(locationId, week, day, hour);
            },

            // ---- PURE PREDICATE — synchronous ----
            hasConflict: function(schedule, day, hour, duration) {
                return ScheduleCore.hasConflict(schedule, day, hour, duration);
            }
        };

        var scheduleConfigured = AcademySchedule.configure({
            calendarProvider: calendarProvider
        });

        if (!scheduleConfigured) {
            console.error(
                '[AcademyModule] Failed to configure AcademySchedule. ' +
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

        if (!ensureAcademyStructure()) {
            container.innerHTML = '<p class="empty-state">Academy data structure is missing. Please refresh the page.</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Academy dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        if (!initProviders()) {
            container.innerHTML = '<p class="empty-state">Failed to initialize academy providers. Please refresh the page.</p>';
            return;
        }

        if (_mounted) {
            unmountAcademy();
        }

        _container = container;
        _mounted = true;

        // Initialize UI state (loads persisted state from sessionStorage)
        AcademyUI.init();

        // Hand the container to AcademyView.
        AcademyView.render(container);

        dispatchReady();
    }

    function unmountAcademy() {
        if (!_mounted) {
            return;
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
        AcademyView.render(_container);
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function dispatchReady() {
        try {
            var event = new CustomEvent('academyReady', {
                detail: {
                    mounted: _mounted,
                    initialized: true,
                    timestamp: Date.now()
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            // Ignore event dispatch errors
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
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
        // Mount
        mount: mountAcademy,
        unmount: unmountAcademy,

        // Refresh — re-renders the whole Academy tab.
        refresh: refreshAcademy,

        // State
        getState: function() {
            return AcademyUI.getState();
        },

        // Selections
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
        setWeek: function(week) {
            var num = parseInt(week, 10);
            if (!isNaN(num) && num >= 1) {
                AcademyUI.setDisplayWeek(num);
                refreshAcademy();
            }
        },

        // Check
        isMounted: function() {
            return _mounted;
        },

        // Module references (read-only)
        AcademyClasses: AcademyClasses,
        AcademyQueries: AcademyQueries,
        AcademyGrades: AcademyGrades,
        AcademyGroups: AcademyGroups,
        AcademyRanking: AcademyRanking,
        AcademyDistribute: AcademyDistribute,
        AcademySchedule: AcademySchedule,
        AcademyDisciplines: AcademyDisciplines,
        AcademyLocations: AcademyLocations,
        AcademyPerformance: AcademyPerformance,
        AcademyEnrolments: AcademyEnrolments,
        AcademySocialScore: AcademySocialScore,
        AcademyWeeklyTeams: AcademyWeeklyTeams,
        AcademySettings: AcademySettings,
        AcademyCascade: AcademyCascade,

        // View reference
        AcademyView: AcademyView
    };

    window.renderAcademy = mountAcademy;
    window.destroyAcademy = unmountAcademy;

    window.__academyModuleLoaded = true;

})();
