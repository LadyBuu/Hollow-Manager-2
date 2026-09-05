/**
 * js/modules/academy/index.js - Academy Module Entry Point
 * Single entry point for all academic year functionality
 * Path: js/modules/academy/index.js
 * 
 * This module consolidates:
 *   - Year module (grades, rankings, schedules)
 *   - Classes module (class management, rosters, distribution)
 *   - Academic teams (from Teams module)
 *   - Tournaments (interschool team competitions)
 * 
 * LIFECYCLE:
 *   TabManager registers 'academy' -> mountAcademy() ->
 *   AcademyTabs.init() -> render class/student/faculty views
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for academy
 *   - All academy logic lives in the sub-modules
 *   - CharacterList is REUSED (not duplicated)
 *   - Academic teams are managed here (not in Teams tab)
 *   - Professional/Temporary/Civilian teams remain in Teams tab
 *   - TabManager is the single source of truth for lifecycle
 *   - All mutations use MutationUtils.performMutation()
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.CharacterList (from character-list.js)
 *   - window.CalendarUI (from calendar-ui.js)
 *   - window.CalendarModes (from calendar-modes/index.js)
 *   - window.ClassesCore (from classes-core.js)
 *   - window.TeamCore (from team-core.js)
 *   - window.TournamentCore (from tournament-core.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyModuleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var TabManager = window.TabManager;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var MutationUtils = window.MutationUtils;
    var CharacterList = window.CharacterList;
    var CalendarUI = window.CalendarUI;
    var CalendarModes = window.CalendarModes;
    var ClassesCore = window.ClassesCore;
    var TeamCore = window.TeamCore;
    var TournamentCore = window.TournamentCore;
    var AcademyCore = window.AcademyCore;
    var AcademyQueries = window.AcademyQueries;
    var AcademyViews = window.AcademyViews;
    var AcademyEvents = window.AcademyEvents;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!MutationUtils || typeof MutationUtils.performMutation !== 'function') {
            missing.push('MutationUtils.performMutation');
        }

        if (!CharacterList || typeof CharacterList.render !== 'function') {
            missing.push('CharacterList.render');
        }

        if (!AcademyCore || typeof AcademyCore.getClass !== 'function') {
            missing.push('AcademyCore.getClass');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }

        if (!AcademyViews || typeof AcademyViews.renderAcademy !== 'function') {
            missing.push('AcademyViews.renderAcademy');
        }

        if (!AcademyEvents || typeof AcademyEvents.init !== 'function') {
            missing.push('AcademyEvents.init');
        }

        if (missing.length > 0) {
            console.warn('AcademyModule: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE - Single source of truth for academy UI state
    // ============================================================

    var _state = {
        selectedClassId: null,
        selectedWeek: 1,
        selectedStudentId: null,
        selectedInstructorId: null,
        activeSubTab: 'class' // 'class' | 'student' | 'faculty'
    };

    // ============================================================
    // STATE MANAGEMENT - Exposed via controlled API
    // ============================================================

    function getState() {
        return {
            selectedClassId: _state.selectedClassId,
            selectedWeek: _state.selectedWeek,
            selectedStudentId: _state.selectedStudentId,
            selectedInstructorId: _state.selectedInstructorId,
            activeSubTab: _state.activeSubTab
        };
    }

    function setState(newState) {
        if (!newState || typeof newState !== 'object') {
            return;
        }

        var changed = false;

        if (newState.selectedClassId !== undefined && newState.selectedClassId !== _state.selectedClassId) {
            _state.selectedClassId = newState.selectedClassId;
            changed = true;
        }

        if (newState.selectedWeek !== undefined) {
            var week = parseInt(newState.selectedWeek, 10);
            if (!isNaN(week) && week >= 1 && week <= 52) {
                if (week !== _state.selectedWeek) {
                    _state.selectedWeek = week;
                    changed = true;
                }
            }
        }

        if (newState.selectedStudentId !== undefined && newState.selectedStudentId !== _state.selectedStudentId) {
            _state.selectedStudentId = newState.selectedStudentId;
            changed = true;
        }

        if (newState.selectedInstructorId !== undefined && newState.selectedInstructorId !== _state.selectedInstructorId) {
            _state.selectedInstructorId = newState.selectedInstructorId;
            changed = true;
        }

        if (newState.activeSubTab !== undefined && newState.activeSubTab !== _state.activeSubTab) {
            if (['class', 'student', 'faculty'].indexOf(newState.activeSubTab) !== -1) {
                _state.activeSubTab = newState.activeSubTab;
                changed = true;
            }
        }

        return changed;
    }

    function selectClass(classId) {
        if (classId && !AcademyQueries.getClass(classId)) {
            return;
        }

        _state.selectedClassId = classId || null;
        _state.selectedStudentId = null;
        _state.selectedInstructorId = null;
    }

    function getSelectedClassId() {
        return _state.selectedClassId;
    }

    function selectWeek(week) {
        var weekNum = parseInt(week, 10);
        if (!isNaN(weekNum) && weekNum >= 1 && weekNum <= 52) {
            _state.selectedWeek = weekNum;
        }
    }

    function getSelectedWeek() {
        return _state.selectedWeek;
    }

    function selectStudent(studentId) {
        if (studentId && !AcademyQueries.getCharacterById(studentId)) {
            return;
        }
        _state.selectedStudentId = studentId || null;
    }

    function getSelectedStudentId() {
        return _state.selectedStudentId;
    }

    function selectInstructor(instructorId) {
        if (instructorId && !AcademyQueries.getCharacterById(instructorId)) {
            return;
        }
        _state.selectedInstructorId = instructorId || null;
    }

    function getSelectedInstructorId() {
        return _state.selectedInstructorId;
    }

    function switchSubTab(subTab) {
        if (['class', 'student', 'faculty'].indexOf(subTab) === -1) {
            return;
        }
        _state.activeSubTab = subTab;
    }

    function getActiveSubTab() {
        return _state.activeSubTab;
    }

    function clearSelections() {
        _state.selectedClassId = null;
        _state.selectedStudentId = null;
        _state.selectedInstructorId = null;
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
    // ============================================================

    function mountAcademy(container) {
        if (!container) {
            container = document.getElementById('tab-academy');
        }

        if (!container) {
            console.warn('AcademyModule: Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading academy data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Academy dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Ensure curriculum is initialised
        if (typeof window.ensureCurriculum === 'function') {
            try {
                window.ensureCurriculum();
            } catch (e) {
                // Ignore - ensureCurriculum is non-critical
            }
        }

        // Ensure default class exists if none
        if (AcademyQueries.getClasses().length === 0) {
            createDefaultClassIfNeeded();
        }

        // Render the academy container
        var html = AcademyViews.renderAcademy(_state);
        container.innerHTML = html;

        // Initialize events
        AcademyEvents.init(container);

        // Render the initial sub-tab content
        renderSubTab(_state.activeSubTab, container);

        // Render character list (reused from CharacterList module)
        if (CharacterList && typeof CharacterList.render === 'function') {
            try {
                CharacterList.render();
            } catch (e) {
                // Ignore - CharacterList is non-critical for initial render
            }
        }

        // Populate class filter for CharacterList
        if (CharacterList && typeof CharacterList.populateClassFilter === 'function') {
            try {
                CharacterList.populateClassFilter();
            } catch (e) {
                // Ignore
            }
        }

        // Trigger initial data load
        refreshAcademy();
    }

    // ============================================================
    // SUB-TAB RENDERING
    // ============================================================

    function renderSubTab(subTab, container) {
        if (!container) {
            container = document.getElementById('tab-academy');
        }
        if (!container) {
            return;
        }

        var contentContainer = container.querySelector('#academy-subtab-content');
        if (!contentContainer) {
            return;
        }

        switch (subTab) {
            case 'class':
                contentContainer.innerHTML = AcademyViews.renderClassTab(_state);
                AcademyEvents.bindClassTabEvents(contentContainer);
                break;
            case 'student':
                contentContainer.innerHTML = AcademyViews.renderStudentTab(_state);
                AcademyEvents.bindStudentTabEvents(contentContainer);
                // Re-render character list with class filter
                if (CharacterList && typeof CharacterList.render === 'function') {
                    CharacterList.render();
                }
                break;
            case 'faculty':
                contentContainer.innerHTML = AcademyViews.renderFacultyTab(_state);
                AcademyEvents.bindFacultyTabEvents(contentContainer);
                break;
            default:
                contentContainer.innerHTML = '<p class="empty-state">Unknown sub-tab.</p>';
        }
    }

    // ============================================================
    // REFRESH FUNCTIONS
    // ============================================================

    function refreshAcademy() {
        var container = document.getElementById('tab-academy');
        if (!container) {
            return;
        }

        renderSubTab(_state.activeSubTab, container);

        if (_state.activeSubTab === 'student') {
            if (CharacterList && typeof CharacterList.render === 'function') {
                CharacterList.render();
            }
        }

        if (_state.activeSubTab === 'class') {
            var classListContainer = container.querySelector('#academy-class-list');
            if (classListContainer) {
                classListContainer.innerHTML = AcademyViews.renderClassList(_state);
            }
        }
    }

    function refreshSubTab(subTab) {
        var container = document.getElementById('tab-academy');
        if (!container) {
            return;
        }

        if (subTab) {
            _state.activeSubTab = subTab;
        }

        renderSubTab(_state.activeSubTab, container);
    }

    function refreshClassList() {
        var container = document.getElementById('tab-academy');
        if (!container) {
            return;
        }

        var classListContainer = container.querySelector('#academy-class-list');
        if (classListContainer) {
            classListContainer.innerHTML = AcademyViews.renderClassList(_state);
        }
    }

    function refreshStudentList() {
        if (CharacterList && typeof CharacterList.render === 'function') {
            CharacterList.render();
        }
    }

    function refreshStudentDetail() {
        var container = document.getElementById('tab-academy');
        if (!container) {
            return;
        }

        if (_state.selectedStudentId) {
            var detailContainer = container.querySelector('#academy-student-detail');
            if (detailContainer) {
                detailContainer.innerHTML = AcademyViews.renderStudentDetail(_state);
            }
        }
    }

    function refreshFacultyDetail() {
        var container = document.getElementById('tab-academy');
        if (!container) {
            return;
        }

        if (_state.selectedInstructorId) {
            var detailContainer = container.querySelector('#academy-faculty-detail');
            if (detailContainer) {
                detailContainer.innerHTML = AcademyViews.renderInstructorDetail(_state);
            }
        }
    }

    // ============================================================
    // DEFAULT CLASS CREATION
    // ============================================================

    function createDefaultClassIfNeeded() {
        try {
            var classes = AcademyQueries.getClasses();
            if (classes.length === 0) {
                var result = AcademyCore.createClass('Default Class');
                if (result && result.success) {
                    // Created default class
                }
            }
        } catch (e) {
            // Ignore - default class creation is non-critical
        }
    }

    // ============================================================
    // DESTROY - Clean up
    // ============================================================

    function destroyAcademy() {
        if (AcademyEvents && typeof AcademyEvents.destroy === 'function') {
            AcademyEvents.destroy();
        }
        clearSelections();
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            // Replace both 'year' and 'classes' tabs with 'academy'
            TabManager.register('academy', mountAcademy);
            return true;
        }
        return false;
    }

    // Register immediately if TabManager is available
    if (!registerWithTabManager()) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // EXPOSE - Controlled public API only
    // ============================================================

    // Main mount function
    window.mountAcademy = mountAcademy;
    window.renderAcademy = mountAcademy;

    // State management
    window.academyState = {
        getState: getState,
        setState: setState,
        selectClass: selectClass,
        getSelectedClassId: getSelectedClassId,
        selectWeek: selectWeek,
        getSelectedWeek: getSelectedWeek,
        selectStudent: selectStudent,
        getSelectedStudentId: getSelectedStudentId,
        selectInstructor: selectInstructor,
        getSelectedInstructorId: getSelectedInstructorId,
        switchSubTab: switchSubTab,
        getActiveSubTab: getActiveSubTab,
        clearSelections: clearSelections
    };

    // Refresh functions
    window.refreshAcademy = refreshAcademy;
    window.refreshSubTab = refreshSubTab;
    window.refreshClassList = refreshClassList;
    window.refreshStudentList = refreshStudentList;
    window.refreshStudentDetail = refreshStudentDetail;
    window.refreshFacultyDetail = refreshFacultyDetail;

    // Lifecycle
    window.destroyAcademy = destroyAcademy;

    // ============================================================
    // LEGACY COMPATIBILITY (during migration)
    // ============================================================

    // These aliases allow old code to continue working during the transition
    window.getSelectedClass = getSelectedClassId;
    window.selectClass = selectClass;
    window.getSelectedWeek = getSelectedWeek;
    window.selectWeek = selectWeek;
    window.refreshAcademyView = refreshAcademy;

})();