/**
 * js/modules/shared/academy-constants.js - Academy Constants
 * Shared constants for Academy module
 */

(function() {
    'use strict';

    if (window.__academyConstantsLoaded) return;
    window.__academyConstantsLoaded = true;

    var ACADEMY_SUBTABS = [
        { id: 'class', label: 'Classes' },
        { id: 'student', label: 'Students' },
        { id: 'faculty', label: 'Faculty' }
    ];

    var VALID_SUB_TAB_IDS = ACADEMY_SUBTABS.map(function(tab) {
        return tab.id;
    });

    var SUB_TAB_LABELS = {};
    ACADEMY_SUBTABS.forEach(function(tab) {
        SUB_TAB_LABELS[tab.id] = tab.label;
    });

    window.AcademyConstants = {
        ACADEMY_SUBTABS: ACADEMY_SUBTABS,
        VALID_SUB_TAB_IDS: VALID_SUB_TAB_IDS,
        SUB_TAB_LABELS: SUB_TAB_LABELS,
        MAX_TEAM_SIZE: 20,
        MIN_SCORE: 0,
        MAX_SCORE: 100,
        PASSING_THRESHOLD: 70
    };

})();
