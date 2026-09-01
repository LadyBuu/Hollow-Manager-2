/**
 * js/modules/classes/classes-main.js - Classes Module Entry Point
 * Path: js/modules/classes/classes-main.js
 * 
 * This module is responsible for:
 *   - Rendering the Classes tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to child modules
 * 
 * TABS:
 *   - Classes: Create/manage graduating classes, add members
 *   - Rankings: Class-based rankings (placeholder)
 *   - Groups: Auto-groups scoped to graduating classes (placeholder)
 *   - Tournaments: Class-based tournaments (placeholder)
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Shared state root with tab persistence
    // ============================================================

    var state = window.classesState || {
        currentTab: 'classes'
    };

    if (!state.currentTab) {
        state.currentTab = 'classes';
    }

    window.classesState = state;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Graduating class core dependencies
        if (typeof window.getGraduatingClasses !== 'function') {
            missing.push('getGraduatingClasses');
        }
        if (typeof window.getGraduatingClass !== 'function') {
            missing.push('getGraduatingClass');
        }
        if (typeof window.createGraduatingClass !== 'function') {
            missing.push('createGraduatingClass');
        }
        if (typeof window.updateGraduatingClass !== 'function') {
            missing.push('updateGraduatingClass');
        }
        if (typeof window.deleteGraduatingClass !== 'function') {
            missing.push('deleteGraduatingClass');
        }
        if (typeof window.getCharactersByGraduatingClass !== 'function') {
            missing.push('getCharactersByGraduatingClass');
        }
        if (typeof window.getInstructorsByGraduatingClass !== 'function') {
            missing.push('getInstructorsByGraduatingClass');
        }
        if (typeof window.assignCharacterToGraduatingClass !== 'function') {
            missing.push('assignCharacterToGraduatingClass');
        }
        if (typeof window.removeCharacterFromGraduatingClass !== 'function') {
            missing.push('removeCharacterFromGraduatingClass');
        }

        // Character dependencies
        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }
        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }
        if (typeof window.getCurrentStatus !== 'function') {
            missing.push('getCurrentStatus');
        }

        // TabManager
        if (typeof window.TabManager === 'undefined') {
            missing.push('TabManager');
        }

        if (missing.length > 0) {
            console.warn('[Classes] Missing dependencies:', missing.join(', '));
            console.warn('[Classes] Ensure graduating-class-core.js is loaded before classes-main.js');
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER CLASSES
    // ============================================================

    function renderClasses(container) {
        if (!container) {
            container = document.getElementById('tab-classes');
        }
        if (!container) {
            console.warn('[Classes] Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading classes data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Classes dependencies not loaded. Please refresh the page.<br><small style="color:var(--text-dim);">Missing: ' + 
                getMissingDependencies().join(', ') + '</small></p>';
            return;
        }

        // Ensure curriculum is initialized for schedule-related features
        if (typeof window.ensureCurriculum === 'function') {
            window.ensureCurriculum();
        }

        container.innerHTML = getClassesHTML();
        initClassesTabs(container, state.currentTab);

        // Dispatch event
        var event = new CustomEvent('classesRendered', {
            detail: { tab: state.currentTab }
        });
        document.dispatchEvent(event);
    }

    function getMissingDependencies() {
        var missing = [];
        var deps = [
            'getGraduatingClasses', 'getGraduatingClass', 'createGraduatingClass',
            'updateGraduatingClass', 'deleteGraduatingClass',
            'getCharactersByGraduatingClass', 'getInstructorsByGraduatingClass',
            'assignCharacterToGraduatingClass', 'removeCharacterFromGraduatingClass'
        ];
        for (var i = 0; i < deps.length; i++) {
            if (typeof window[deps[i]] !== 'function') {
                missing.push(deps[i]);
            }
        }
        return missing;
    }

    // ... rest of the file unchanged ...
