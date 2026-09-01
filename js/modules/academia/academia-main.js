/**
 * js/modules/academia/academia-main.js - Academia Module
 * Fixed: Better dependency checking, no duplicate rendering
 */

(function() {
    'use strict';

    var state = window.academiaState || {
        currentTab: 'schedule'
    };

    if (!state.currentTab) {
        state.currentTab = 'schedule';
    }

    window.academiaState = state;

    // ============================================================
    // DEPENDENCY CHECKING - More explicit with logging
    // ============================================================

    function checkDependencies() {
        var required = [
            'ensureCurriculum',
            'getStudents',
            'getInstructors',
            'getCharacterById',
            'getDisplayName',
            'getStudentSchedule',
            'getAvailableDisciplines',
            'getDiscipline',
            'getClassInstructor',
            'getClassDuration',
            'getStudentDisciplineIds',
            'getGrades',
            'saveGrades',
            'calculateGradeSummary',
            'saveData',
            'renderAcademiaSchedule',
            'renderAcademiaGrades'
        ];

        var missing = [];

        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('[Academia] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER ACADEMIA
    // ============================================================

    function renderAcademia(container) {
        console.log('[Academia] renderAcademia START');

        if (!container) {
            container = document.getElementById('tab-academia');
        }
        if (!container) {
            console.warn('[Academia] Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading academia data...</p>';
            return;
        }

        // Ensure curriculum schema exists
        try {
            if (typeof window.ensureCurriculum === 'function') {
                window.ensureCurriculum();
            }
        } catch (e) {
            console.warn('[Academia] ensureCurriculum() failed:', e);
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Academia dependencies not loaded. Check console for details.</p>';
            return;
        }

        console.log('[Academia] Dependencies OK, building UI');

        container.innerHTML = getAcademiaHTML();
        initAcademiaTabs(container, state.currentTab);

        console.log('[Academia] Tabs initialised');
        console.log('[Academia] schedule renderer:', typeof window.renderAcademiaSchedule);
        console.log('[Academia] grades renderer:', typeof window.renderAcademiaGrades);
    }

    // ============================================================
    // ACADEMIA HTML
    // ============================================================

    function getAcademiaHTML() {
        return `
            <div class="page-header">
                <h2>Academia</h2>
                <div style="display:flex;gap:4px;">
                    <button id="academia-tab-schedule" class="small ${state.currentTab === 'schedule' ? 'primary' : 'secondary'}">Schedule</button>
                    <button id="academia-tab-grades" class="small ${state.currentTab === 'grades' ? 'primary' : 'secondary'}">Grades</button>
                </div>
            </div>
            <div id="academia-content-container">
                <div id="academia-content-inner"></div>
            </div>
        `;
    }

    // ============================================================
    // TAB INITIALISATION
    // ============================================================

    function initAcademiaTabs(rootContainer, initialTab) {
        renderAcademiaTabContent(initialTab || 'schedule', rootContainer);

        var scheduleBtn = rootContainer.querySelector('#academia-tab-schedule');
        var gradesBtn = rootContainer.querySelector('#academia-tab-grades');

        if (scheduleBtn) {
            scheduleBtn.addEventListener('click', function() {
                state.currentTab = 'schedule';
                renderAcademiaTabContent('schedule', rootContainer);
            });
        }

        if (gradesBtn) {
            gradesBtn.addEventListener('click', function() {
                state.currentTab = 'grades';
                renderAcademiaTabContent('grades', rootContainer);
            });
        }
    }

    // ============================================================
    // RENDER TAB CONTENT
    // ============================================================

    function renderAcademiaTabContent(tabName, rootContainer) {
        var innerContainer = rootContainer ? rootContainer.querySelector('#academia-content-inner') : document.getElementById('academia-content-inner');
        if (!innerContainer) return;

        // Update button states
        var scheduleBtn = rootContainer ? rootContainer.querySelector('#academia-tab-schedule') : document.getElementById('academia-tab-schedule');
        var gradesBtn = rootContainer ? rootContainer.querySelector('#academia-tab-grades') : document.getElementById('academia-tab-grades');

        if (scheduleBtn) {
            scheduleBtn.className = 'small ' + (tabName === 'schedule' ? 'primary' : 'secondary');
        }
        if (gradesBtn) {
            gradesBtn.className = 'small ' + (tabName === 'grades' ? 'primary' : 'secondary');
        }

        console.log('[Academia] renderTabContent:', tabName);

        if (tabName === 'schedule') {
            if (typeof window.renderAcademiaSchedule === 'function') {
                window.renderAcademiaSchedule(innerContainer);
            } else {
                innerContainer.innerHTML = '<p class="empty-state">Schedule module not loaded.</p>';
            }
        } else if (tabName === 'grades') {
            if (typeof window.renderAcademiaGrades === 'function') {
                window.renderAcademiaGrades(innerContainer);
            } else {
                innerContainer.innerHTML = '<p class="empty-state">Grades module not loaded.</p>';
            }
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('academia', renderAcademia);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderAcademia = renderAcademia;
    window.academiaState = state;

})();
