/**
 * js/modules/missions/index.js - Missions Module Entry Point
 * Single entry point for all mission functionality.
 * Registers with TabManager and delegates to sub-modules.
 */

(function() {
    'use strict';

    if (window.__missionsModuleLoaded) return;
    window.__missionsModuleLoaded = true;

    // Dependencies are loaded by the module files themselves

    // The render function is already exposed by missions-ui.js
    // TabManager registration is handled in missions-ui.js

    console.log('Missions module loaded.');

})();
