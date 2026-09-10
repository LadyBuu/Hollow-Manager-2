/**
 * modules/academy/index.js - Academy Module Entry Point
 * Single entry point for all academic year functionality
 * 
 * This module consolidates:
 *   - Academy lifecycle management (mount/destroy)
 *   - Academy UI state coordination
 *   - Academy view rendering orchestration
 *   - Academy event lifecycle
 *   - Provider assembly and injection
 * 
 * LIFECYCLE:
 *   TabManager registers 'academy' -> mountAcademy() ->
 *   AcademyUI.init() -> render shell -> render active sub-tab -> bind events
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for academy
 *   - All academy logic lives in the sub-modules
 *   - TabManager is the single source of truth for lifecycle
 *   - No data mutations - all mutations delegate to domain cores
 *   - No direct window.data access - rely on bootstrap
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 *   - Assembles and injects external providers
 * 
 * NOTE ON ACADEMYCORE:
 *   - AcademyCore does not exist. The Academy domain was refactored
 *   - to use AcademyDisciplines and AcademyLocations directly.
 *   - Earlier versions of this file referenced AcademyCore; those
 *   - references have been removed.
 * 
 * EXTERNAL PROVIDERS:
 *   - CharacterQueries (for character data)
 *   - TeamQueries (for team data)
 *   - CalendarProvider (for schedule operations)
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.CalendarQueries (from calendar-queries.js)
 *   - window.ScheduleCore (from schedule-core.js)
 *   - window.AcademyUI (from academy-ui.js)
 *   - window.AcademyEvents (from academy-events.js)
 *   - window.AcademyClasses (from academy-classes.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.AcademyGrades (from academy-grades.js)
 *   - window.AcademyGroups (from academy-groups.js)
 *   - window.AcademyRanking (from academy-ranking.js)
 *   - window.AcademyDistribute (from academy-distribute.js)
 *   - window.AcademySchedule (from academy-schedule.js)
 *   - window.AcademyDisciplines (from academy-disciplines.js)
 *   - window.AcademyLocations (from academy-locations.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DataLoader (from loader.js)
 */

(function() {
    'use strict';

    if (window.__academyModuleLoaded) {
        return;
    }
    window.__academyModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TabManager = window.TabManager;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var CalendarQueries = window.CalendarQueries;
    var ScheduleCore = window.ScheduleCore;
    var AcademyUI = window.AcademyUI;
    var AcademyEvents = window.AcademyEvents;
    var AcademyClasses = window.AcademyClasses;
    var AcademyQueries = window.AcademyQueries;
    var AcademyGrades = window.AcademyGrades;
    var AcademyGroups = window.AcademyGroups;
    var AcademyRanking = window.AcademyRanking;
    var AcademyDistribute = window.AcademyDistribute;
    var AcademySchedule = window.AcademySchedule;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyLocations = window.AcademyLocations;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var DataLoader = window.DataLoader;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getStudents !== 'function') {
            missing.push('CharacterQueries.getStudents');
        }
        if (!CharacterQueries || typeof CharacterQueries.getInstructors !== 'function') {
            missing.push('CharacterQueries.getInstructors');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsByClass !== 'function') {
            missing.push('TeamQueries.getTeamsByClass');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }

        if (!CalendarQueries || typeof CalendarQueries.getStudentSchedule !== 'function') {
            missing.push('CalendarQueries.getStudentSchedule');
        }
        if (!CalendarQueries || typeof CalendarQueries.getInstructorSchedule !== 'function') {
            missing.push('CalendarQueries.getInstructorSchedule');
        }
        if (!CalendarQueries || typeof CalendarQueries.getLocationSchedule !== 'function') {
            missing.push('CalendarQueries.getLocationSchedule');
        }

        if (!ScheduleCore || typeof ScheduleCore.setStudentSlot !== 'function') {
            missing.push('ScheduleCore.setStudentSlot');
        }
        if (!ScheduleCore || typeof ScheduleCore.removeStudentSlot !== 'function') {
            missing.push('ScheduleCore.removeStudentSlot');
        }

        if (!AcademyUI || typeof AcademyUI.init !== 'function') {
            missing.push('AcademyUI.init');
        }
        if (!AcademyUI || typeof AcademyUI.getState !== 'function') {
            missing.push('AcademyUI.getState');
        }

        if (!AcademyEvents || typeof AcademyEvents.init !== 'function') {
            missing.push('AcademyEvents.init');
        }
        if (!AcademyEvents || typeof AcademyEvents.destroy !== 'function') {
            missing.push('AcademyEvents.destroy');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }

        if (!AcademyClasses || typeof AcademyClasses.create !== 'function') {
            missing.push('AcademyClasses.create');
        }

        // AcademyCore does not exist. Discipline and location operations
        // live in AcademyDisciplines and AcademyLocations respectively.
        if (!AcademyDisciplines || typeof AcademyDisciplines.create !== 'function') {
            missing.push('AcademyDisciplines.create');
        }
        if (!AcademyLocations || typeof AcademyLocations.create !== 'function') {
            missing.push('AcademyLocations.create');
        }

        if (!AcademySchedule || typeof AcademySchedule.configure !== 'function') {
            missing.push('AcademySchedule.configure');
        }
        if (!AcademySchedule || typeof AcademySchedule.getStudentSchedule !== 'function') {
            missing.push('AcademySchedule.getStudentSchedule');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            console.warn('[AcademyModule] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // PROVIDER ASSEMBLY
    // ============================================================

    var _providersInitialized = false;

    /**
     * Initialize providers and inject dependencies into Academy modules.
     * Must be called before mounting.
     */
    function initProviders() {
        if (_providersInitialized) {
            return true;
        }

        // ---- Character Provider ----
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

        // ---- Calendar Provider ----
        var calendarProvider = {
            getStudentSchedule: function(studentId, week) {
                return CalendarQueries.getStudentSchedule(studentId, week);
            },
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
            getStudentRestDays: function(studentId, week) {
                return ScheduleCore.getStudentRestDays(studentId, week);
            },
            setRestDays: function(studentId, week, days) {
                return ScheduleCore.setRestDays(studentId, week, days);
            },
            removeRestDays: function(studentId, week) {
                return ScheduleCore.removeRestDays(studentId, week);
            },
            hasConflict: function(schedule, day, hour, duration) {
                return ScheduleCore.hasConflict(schedule, day, hour, duration);
            },
            getSlotMetadata: function(studentId, week, day, hour) {
                return ScheduleCore.getSlotMetadata(studentId, week, day, hour);
            },
            setSlotMetadata: function(studentId, week, day, hour, metadata) {
                return ScheduleCore.setSlotMetadata(studentId, week, day, hour, metadata);
            },
            findClassStart: function(schedule, metadata, studentId, week, day, hour) {
                return ScheduleCore.findClassStart(schedule, metadata, studentId, week, day, hour);
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
            }
        };

        // ---- Inject into AcademySchedule ----
        var scheduleConfigured = AcademySchedule.configure({
            calendarProvider: calendarProvider
        });

        if (!scheduleConfigured) {
            console.warn('[AcademyModule] Failed to configure AcademySchedule.');
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
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderAcademy(container) {
        if (!container) {
            return;
        }

        var activeTab = AcademyUI.getActiveTab();
        var displayWeek = AcademyUI.getDisplayWeek();

        // Get sub-tab labels from AcademyConstants
        var subTabs = [];
        if (window.AcademyConstants && window.AcademyConstants.ACADEMY_SUBTABS) {
            subTabs = window.AcademyConstants.ACADEMY_SUBTABS;
        } else {
            subTabs = [
                { id: 'class', label: 'Classes' },
                { id: 'student', label: 'Students' },
                { id: 'faculty', label: 'Faculty' }
            ];
        }

        var html = '';

        // Sub-tab navigation
        html += '<div class="academy-subtab-nav">';
        for (var i = 0; i < subTabs.length; i++) {
            var tab = subTabs[i];
            var isActive = tab.id === activeTab;
            html += '<button class="academy-subtab-btn' + (isActive ? ' active' : '') + '" data-tab="' + escapeAttribute(tab.id) + '">';
            html += escapeHtml(tab.label);
            html += '</button>';
        }
        html += '</div>';

        // Week selector
        html += '<div class="academy-week-selector">';
        html += '<label>Week:</label>';
        html += '<input type="number" class="academy-week-input" value="' + displayWeek + '" min="' + CalendarConstants.MIN_WEEK + '" max="' + CalendarConstants.MAX_WEEK + '">';
        html += '<button class="academy-week-apply small secondary">Apply</button>';
        html += '</div>';

        // Content
        html += '<div id="academy-subtab-content" class="academy-subtab-content"></div>';

        container.innerHTML = html;

        // Initial render of content
        refreshUI();
    }

    function refreshUI() {
        if (!_container) {
            return;
        }

        var activeTab = AcademyUI.getActiveTab();
        var selectedClassId = AcademyUI.getSelectedClassId();
        var selectedStudentId = AcademyUI.getSelectedStudentId();
        var selectedInstructorId = AcademyUI.getSelectedInstructorId();
        var displayWeek = AcademyUI.getDisplayWeek();

        var tabContent = _container.querySelector('#academy-subtab-content');
        if (!tabContent) {
            return;
        }

        var html = '';

        // Use the appropriate tab renderer
        switch (activeTab) {
            case 'class':
                if (window.ClassTab && typeof window.ClassTab.render === 'function') {
                    html = window.ClassTab.render({
                        selectedClassId: selectedClassId,
                        displayWeek: displayWeek
                    });
                } else {
                    html = '<p class="empty-state">Class tab not available.</p>';
                }
                break;

            case 'student':
                if (window.StudentTab && typeof window.StudentTab.render === 'function') {
                    html = window.StudentTab.render({
                        selectedClassId: selectedClassId,
                        selectedStudentId: selectedStudentId,
                        displayWeek: displayWeek
                    });
                } else {
                    html = '<p class="empty-state">Student tab not available.</p>';
                }
                break;

            case 'faculty':
                if (window.FacultyTab && typeof window.FacultyTab.render === 'function') {
                    html = window.FacultyTab.render({
                        selectedClassId: selectedClassId,
                        selectedInstructorId: selectedInstructorId,
                        displayWeek: displayWeek
                    });
                } else {
                    html = '<p class="empty-state">Faculty tab not available.</p>';
                }
                break;

            default:
                html = '<p class="empty-state">Unknown tab: ' + escapeHtml(activeTab) + '</p>';
        }

        tabContent.innerHTML = html;

        // Bind events for the new content
        bindTabContentEvents(tabContent);
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // BIND TAB CONTENT EVENTS
    // ============================================================

    function bindTabContentEvents(container) {
        if (!container) {
            return;
        }

        // ---- Sub-tab switching ----
        var tabBtns = container.querySelectorAll('.academy-subtab-btn');
        for (var i = 0; i < tabBtns.length; i++) {
            var btn = tabBtns[i];
            btn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    handleTabSwitch(tab);
                }
            });
        }

        // ---- Week selector ----
        var weekApply = container.querySelector('.academy-week-apply');
        var weekInput = container.querySelector('.academy-week-input');
        if (weekApply && weekInput) {
            weekApply.addEventListener('click', function() {
                var week = parseInt(weekInput.value, 10);
                if (!isNaN(week) && week >= CalendarConstants.MIN_WEEK && week <= CalendarConstants.MAX_WEEK) {
                    AcademyUI.setDisplayWeek(week);
                    refreshUI();
                } else {
                    showNotification('Please enter a valid week (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').', 'error');
                }
            });
            weekInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    weekApply.click();
                }
            });
        }

        // ---- Delegate to tab-specific event binding ----
        var activeTab = AcademyUI.getActiveTab();

        switch (activeTab) {
            case 'class':
                if (window.ClassTab && typeof window.ClassTab.bindEvents === 'function') {
                    window.ClassTab.bindEvents(container);
                }
                break;

            case 'student':
                if (window.StudentTab && typeof window.StudentTab.bindEvents === 'function') {
                    window.StudentTab.bindEvents(container);
                }
                break;

            case 'faculty':
                if (window.FacultyTab && typeof window.FacultyTab.bindEvents === 'function') {
                    window.FacultyTab.bindEvents(container);
                }
                break;
        }
    }

    // ============================================================
    // HANDLERS
    // ============================================================

    function handleTabSwitch(tab) {
        if (AcademyUI.setActiveTab(tab)) {
            refreshUI();
        }
    }

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

        if (!window.data || !window.data.academy) {
            container.innerHTML = '<p class="empty-state">Loading academy data...</p>';
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

        // Initialize UI state
        AcademyUI.init();

        // Render the container
        renderAcademy(container);

        // Bind top-level events
        bindTopLevelEvents(container);

        // Bind tab content events
        bindTabContentEvents(container.querySelector('#academy-subtab-content'));

        dispatchReady();
    }

    function unmountAcademy() {
        if (!_mounted) {
            return;
        }

        if (AcademyEvents && typeof AcademyEvents.destroy === 'function') {
            AcademyEvents.destroy();
        }

        if (_container) {
            _container.innerHTML = '';
        }

        _mounted = false;
        _container = null;
    }

    // ============================================================
    // BIND TOP LEVEL EVENTS
    // ============================================================

    function bindTopLevelEvents(container) {
        if (!container) {
            return;
        }

        // ---- State change listeners ----
        document.removeEventListener('academy:subtabchange', handleSubTabChange);
        document.addEventListener('academy:subtabchange', handleSubTabChange);

        document.removeEventListener('academy:refresh', handleRefresh);
        document.addEventListener('academy:refresh', handleRefresh);
    }

    function handleSubTabChange(e) {
        var subTab = e.detail && e.detail.subTab;
        if (subTab) {
            AcademyUI.setActiveTab(subTab);
            refreshUI();
        }
    }

    function handleRefresh() {
        refreshUI();
        showNotification('Refreshed', 'info');
    }

    // ============================================================
    // DISPATCH EVENTS
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

        // Refresh
        refresh: function() {
            if (_container) {
                refreshUI();
            }
        },

        // State
        getState: function() {
            return AcademyUI.getState();
        },

        // Selections
        selectClass: function(classId) {
            AcademyUI.selectClass(classId);
            refreshUI();
        },
        selectStudent: function(studentId) {
            AcademyUI.selectStudent(studentId);
            refreshUI();
        },
        selectInstructor: function(instructorId) {
            AcademyUI.selectInstructor(instructorId);
            refreshUI();
        },
        switchSubTab: function(subTab) {
            if (AcademyUI.setActiveTab(subTab)) {
                refreshUI();
            }
        },
        clearSelections: function() {
            AcademyUI.clearSelections();
            refreshUI();
        },
        setWeek: function(week) {
            var num = parseInt(week, 10);
            if (!isNaN(num) && num >= 1) {
                AcademyUI.setDisplayWeek(num);
                refreshUI();
            }
        },

        // Check
        isMounted: function() {
            return _mounted;
        },

        // Module references (for advanced use)
        AcademyClasses: AcademyClasses,
        AcademyQueries: AcademyQueries,
        AcademyGrades: AcademyGrades,
        AcademyGroups: AcademyGroups,
        AcademyRanking: AcademyRanking,
        AcademyDistribute: AcademyDistribute,
        AcademySchedule: AcademySchedule,
        AcademyDisciplines: AcademyDisciplines,
        AcademyLocations: AcademyLocations
    };

    window.renderAcademy = mountAcademy;
    window.destroyAcademy = unmountAcademy;

    window.__academyModuleLoaded = true;

})();
