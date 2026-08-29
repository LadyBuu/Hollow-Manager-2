/**
 * js/core/curriculum/index.js - Curriculum Core Entry Point
 * Exports all curriculum mutation functions
 * Path: js/core/curriculum/index.js
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumCoreLoaded) {
        return;
    }
    window.__curriculumCoreLoaded = true;

    // Load all sub-modules
    var schema = loadModule('curriculum-schema');
    var classes = loadModule('curriculum-classes');
    var disciplines = loadModule('curriculum-disciplines');
    var groups = loadModule('curriculum-groups');
    var schedule = loadModule('curriculum-schedule');
    var ranking = loadModule('curriculum-ranking');
    var instructor = loadModule('curriculum-instructor');
    var grades = loadModule('curriculum-grades');
    var locations = loadModule('curriculum-locations');
    var locationSchedule = loadModule('curriculum-location-schedule');

    // NOTE: Everything is exposed through window.xxx by the individual modules.
    // This file just ensures they're loaded.

})();

function loadModule(name) {
    // Each module registers itself with window when loaded
    // This is just a placeholder for the module loading mechanism
    // In practice, you'll load these via script tags or a module loader
    return true;
}
