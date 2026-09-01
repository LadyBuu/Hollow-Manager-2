/**
 * js/modules/curriculum/curriculum-main.js - Main Curriculum Module
 * Fixed: Removed duplicate lifecycle listeners
 */

(function() {
    'use strict';

    var state = window.curriculumState || {
        currentTab: 'disciplines'
    };

    if (!state.currentTab) {
        state.currentTab = 'disciplines';
    }

    window.curriculumState = state;

    // ============================================================
    // DEPENDENCY CHECKING
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = [
            'ensureCurriculum',
            'getDisciplines',
            'getLocations',
            'createDiscipline',
            'updateDiscipline',
            'deleteDiscipline',
            'createLocation',
            'updateLocation',
            'deleteLocation',
            'renderDisciplinesView',
            'renderLocationsView'
        ];

        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('[Curriculum] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER CURRICULUM
    // ============================================================

    function renderCurriculum(container) {
        console.log('[Curriculum] renderCurriculum START');

        if (!container) {
            container = document.getElementById('tab-curriculum');
        }
        if (!container) {
            console.warn('[Curriculum] Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading curriculum data...</p>';
            return;
        }

        try {
            if (typeof window.ensureCurriculum === 'function') {
                window.ensureCurriculum();
            }
        } catch (e) {
            console.warn('[Curriculum] ensureCurriculum() failed:', e);
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Curriculum dependencies not loaded. Check console for details.</p>';
            return;
        }

        console.log('[Curriculum] Dependencies OK, building UI');

        container.innerHTML = getCurriculumHTML();
        initCurriculumTabs(container, state.currentTab);

        console.log('[Curriculum] Tabs initialised');
    }

    // ============================================================
    // CURRICULUM HTML
    // ============================================================

    function getCurriculumHTML() {
        return `
            <div class="page-header">
                <h2>Curriculum</h2>
                <div style="display:flex;gap:4px;">
                    <button id="curriculum-tab-disciplines" class="small ${state.currentTab === 'disciplines' ? 'primary' : 'secondary'}">Disciplines</button>
                    <button id="curriculum-tab-locations" class="small ${state.currentTab === 'locations' ? 'primary' : 'secondary'}">Locations</button>
                </div>
            </div>
            <div id="curriculum-content-container">
                <div id="curriculum-content-inner"></div>
            </div>
        `;
    }

    // ============================================================
    // TAB INITIALISATION
    // ============================================================

    function initCurriculumTabs(rootContainer, initialTab) {
        renderCurriculumTabContent(initialTab || 'disciplines', rootContainer);

        var disciplinesBtn = rootContainer.querySelector('#curriculum-tab-disciplines');
        var locationsBtn = rootContainer.querySelector('#curriculum-tab-locations');

        if (disciplinesBtn) {
            disciplinesBtn.addEventListener('click', function() {
                state.currentTab = 'disciplines';
                renderCurriculumTabContent('disciplines', rootContainer);
            });
        }

        if (locationsBtn) {
            locationsBtn.addEventListener('click', function() {
                state.currentTab = 'locations';
                renderCurriculumTabContent('locations', rootContainer);
            });
        }
    }

    // ============================================================
    // RENDER TAB CONTENT
    // ============================================================

    function renderCurriculumTabContent(tabName, rootContainer) {
        var innerContainer = rootContainer ? rootContainer.querySelector('#curriculum-content-inner') : document.getElementById('curriculum-content-inner');
        if (!innerContainer) return;

        // Update button states
        var disciplinesBtn = rootContainer ? rootContainer.querySelector('#curriculum-tab-disciplines') : document.getElementById('curriculum-tab-disciplines');
        var locationsBtn = rootContainer ? rootContainer.querySelector('#curriculum-tab-locations') : document.getElementById('curriculum-tab-locations');

        if (disciplinesBtn) {
            disciplinesBtn.className = 'small ' + (tabName === 'disciplines' ? 'primary' : 'secondary');
        }
        if (locationsBtn) {
            locationsBtn.className = 'small ' + (tabName === 'locations' ? 'primary' : 'secondary');
        }

        console.log('[Curriculum] renderTabContent:', tabName);

        if (tabName === 'disciplines') {
            if (typeof window.renderDisciplinesView === 'function') {
                window.renderDisciplinesView(innerContainer);
            } else {
                innerContainer.innerHTML = '<p class="empty-state">Disciplines module not loaded.</p>';
            }
        } else if (tabName === 'locations') {
            if (typeof window.renderLocationsView === 'function') {
                window.renderLocationsView(innerContainer);
            } else {
                innerContainer.innerHTML = '<p class="empty-state">Locations module not loaded.</p>';
            }
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - ONLY ONCE
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('curriculum', renderCurriculum);
    }

    // ============================================================
    // EXPOSE - Minimal global footprint
    // ============================================================

    window.renderCurriculum = renderCurriculum;
    window.curriculumState = state;

})();
