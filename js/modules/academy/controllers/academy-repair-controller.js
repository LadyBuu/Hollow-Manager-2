/**
 * modules/academy/controllers/academy-repair-controller.js
 * Academy Instructor Repair Controller
 *
 * Path: js/modules/academy/controllers/academy-repair-controller.js
 *
 * The Instructor Repair feature controller. Owns the Instructor
 * Repair view: it hands the view module's render() a host element
 * and otherwise stays out of the way.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Instructor Repair view into the shell's
 *     content host, via AcademyInstructorRepairView.render.
 *   - Clearing the repair view on unmount.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The repair UI. AcademyInstructorRepairView owns it.
 *   - The repair list, the checkboxes, the Save buttons. The view
 *     module binds its own click handler on the container it
 *     renders into. This controller does not route events.
 *   - Domain reads and writes. The view module reads
 *     AcademyClasses.getClassInstructorIdsAllTime and calls
 *     CharacterCRUD.setInstructorForClass directly.
 *   - Re-rendering the shell. The view module re-renders itself
 *     after a successful save. When the user navigates away, the
 *     shell tears the whole thing down.
 *
 * WHY NO EVENT HANDLERS:
 *   The repair view has exactly one interactive surface: the
 *   per-character Save button. AcademyInstructorRepairView
 *   attaches a delegated click listener to its own container in
 *   its render() call. That listener survives re-renders of the
 *   view's inner HTML because it is on the container, not on the
 *   buttons.
 *
 *   Adding handleClick / handleChange / handleInput / handleKeydown
 *   to this controller would create two paths into the same
 *   buttons, which is the exact failure mode the ONE BINDING PER
 *   CONTROL note in other files warns about.
 *
 * CONTEXT CONTRACT:
 *   The shell supplies a context with `onChange` when it mounts
 *   this controller. The view does not need it (it re-renders
 *   itself after each save), but the contract is honoured: if
 *   onChange is supplied, it is retained and not called. This
 *   keeps the controller interchangeable with every other
 *   Academy controller.
 *
 * DEPENDENCY DIRECTION:
 *   Shell → registry → this controller → AcademyInstructorRepairView.
 *   This controller never references window.AcademyView.
 *
 * RENDER SIGNATURE:
 *   render(host, context)
 *
 *   host    — the HTMLElement the shell allocates for this
 *             controller.
 *   context — { onChange: function() }
 *
 * DEPENDENCIES:
 *   - window.AcademyInstructorRepairView (from
 *     academy-instructor-repair-view.js)
 */

(function() {
    'use strict';

    if (window.__academyRepairControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var View = window.AcademyInstructorRepairView;

    var _missing = [];

    if (!View || typeof View.render !== 'function') {
        _missing.push('AcademyInstructorRepairView.render');
    }
    if (!View || typeof View.unmount !== 'function') {
        _missing.push('AcademyInstructorRepairView.unmount');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyRepairController] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyRepairControllerLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // Only the currently-mounted container is held. The context is
    // retained for contract symmetry but never invoked.

    var _host = null;
    var _context = null;

    // ============================================================
    // CONTEXT NORMALISATION
    // ============================================================

    function normaliseContext(rawContext) {
        var ctx = rawContext && typeof rawContext === 'object'
            ? rawContext
            : {};

        var onChange = typeof ctx.onChange === 'function'
            ? ctx.onChange
            : function() {};

        return { onChange: onChange };
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(host, rawContext) {
        if (!host || typeof host !== 'object') {
            return;
        }

        _host = host;
        _context = normaliseContext(rawContext);

        try {
            View.render(host);
        } catch (e) {
            console.warn(
                '[AcademyRepairController] repair view render threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to render the Instructor Repair view.' +
                    '</p>' +
                '</div>';
        }
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        try {
            View.unmount();
        } catch (e) {
            console.warn(
                '[AcademyRepairController] repair view unmount threw:', e
            );
        }

        _host = null;
        _context = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRepairController = Object.freeze({
        render: render,
        unmount: unmount
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyRepairController;
        var missing = [];

        var required = ['render', 'unmount'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyRepairController] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
