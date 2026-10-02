/**
 * modules/research/index.js - Research Module Entry Point
 * Loads the research modules and exposes window.Research.
 *
 * Path: js/modules/research/index.js
 *
 * WHAT THIS OWNS:
 *   - Load-order assertion. Confirms that the three research
 *     modules have loaded and that the public API is exposed.
 *   - Nothing else. There is no TabManager registration; the
 *     research feature is a modal, opened from the character
 *     module's page header.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Any logic. The search lives in research-queries.js, the
 *     HTML in research-view.js, the modal lifecycle in
 *     research-events.js.
 *
 * LOAD ORDER:
 *   research-queries.js
 *   research-view.js
 *   research-events.js
 *   index.js   (this file)
 *
 *   If loaded out of order, the missing-dep check in each module
 *   throws at load time. That is intentional: the failure is
 *   loud and points at the file that loaded too early, rather
 *   than producing a silently broken Research button.
 *
 *   This file's only job is to make that dependency graph
 *   visible in one place, and to fail the module as a whole if
 *   any of the three is absent.
 *
 * INTEGRATION:
 *   The character module's page header carries a Research button
 *   (#research-btn). Its click handler calls window.Research.open().
 *   Nothing in this module wires that button; the character
 *   module owns its own header.
 *
 * DEPENDENCIES (MANDATORY, checked at load):
 *   - window.ResearchQueries
 *   - window.ResearchView
 *   - window.Research
 */

(function() {
    'use strict';

    if (window.__researchModuleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    var ResearchQueries = window.ResearchQueries;
    var ResearchView = window.ResearchView;
    var Research = window.Research;

    var _missing = [];

    if (!ResearchQueries ||
        typeof ResearchQueries.search !== 'function') {
        _missing.push('ResearchQueries.search');
    }
    if (!ResearchView ||
        typeof ResearchView.renderShell !== 'function') {
        _missing.push('ResearchView.renderShell');
    }
    if (!ResearchView ||
        typeof ResearchView.renderResults !== 'function') {
        _missing.push('ResearchView.renderResults');
    }
    if (!Research ||
        typeof Research.open !== 'function' ||
        typeof Research.close !== 'function' ||
        typeof Research.isOpen !== 'function') {
        _missing.push('Research API (open/close/isOpen)');
    }

    if (_missing.length > 0) {
        console.warn(
            '[ResearchModule] Not fully loaded. Missing: ' +
            _missing.join(', ') + '. ' +
            'Check script load order: research-queries.js, ' +
            'research-view.js, research-events.js, index.js.'
        );
        return;
    }

    window.__researchModuleLoaded = true;

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var problems = [];

        try {
            // The search module can answer an empty query without
            // throwing, which is the minimum a working install
            // must be able to do.
            var vm = ResearchQueries.search('');
            if (!vm || !Array.isArray(vm.groups)) {
                problems.push(
                    'ResearchQueries.search(\'\') returned an ' +
                    'unexpected shape.'
                );
            }

            // The view can render its initial state without
            // throwing. This exercises the escaping dependency
            // (DomUtils) that the whole module relies on.
            var shell = ResearchView.renderShell();
            if (typeof shell !== 'string' ||
                shell.indexOf('research-input') === -1) {
                problems.push(
                    'ResearchView.renderShell() returned an ' +
                    'unexpected shell.'
                );
            }

            if (Research.isOpen() !== false) {
                problems.push(
                    'Research.isOpen() is not false on a fresh load.'
                );
            }
        } catch (e) {
            problems.push('smoke test threw: ' + e.message);
        }

        if (problems.length > 0) {
            console.warn(
                '[ResearchModule] Verification failed:',
                problems.join(' ')
            );
        }
    })();

})();
