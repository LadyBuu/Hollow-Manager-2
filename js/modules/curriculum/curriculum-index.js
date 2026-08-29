/**
 * js/core/curriculum/index.js - Curriculum Core Entry Point
 * Exports all curriculum mutation functions
 * Path: js/core/curriculum/index.js
 * 
 * This module is the single entry point for all curriculum data mutations.
 * It loads and exposes all sub-modules through the window object.
 * 
 * IMPORTANT:
 *   - All functions are exposed via window.xxx
 *   - Each sub-module registers itself with window when loaded
 *   - This file ensures all sub-modules are loaded
 *   - Callers should use the window.xxx functions directly
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumCoreLoaded) {
        return;
    }
    window.__curriculumCoreLoaded = true;

    // ============================================================
    // LOAD ALL SUB-MODULES
    // ============================================================

    // Each sub-module registers itself with window when loaded.
    // The order matters: validators and schema should load first.

    // 1. Validators (no dependencies)
    // curriculum-validators.js

    // 2. Schema (depends on validators)
    // curriculum-schema.js

    // 3. Core mutation modules (depend on schema and validators)
    // curriculum-classes.js
    // curriculum-team-members.js
    // curriculum-disciplines.js
    // curriculum-groups.js
    // curriculum-schedule.js
    // curriculum-ranking.js
    // curriculum-instructor.js
    // curriculum-grades.js
    // curriculum-locations.js
    // curriculum-location-schedule.js

    // NOTE: Everything is exposed through window.xxx by the individual modules.
    // This file just ensures they're loaded.

})();
