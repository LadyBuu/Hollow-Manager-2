/**
 * modules/academy/controllers/academy-controllers.js
 * Academy Controller Registry
 *
 * Path: js/modules/academy/controllers/academy-controllers.js
 *
 * The registry the shell consults to resolve the active controller
 * for a view. Registration is explicit: a controller is registered
 * by the module that defines it (or by the shell, before first use)
 * under the view id it serves.
 *
 * WHAT THIS MODULE IS:
 *   - A map from view id to controller object.
 *   - Five operations: register, get, has, list, clear.
 *
 * WHAT THIS MODULE IS NOT:
 *   - A dispatcher. The shell reads the active controller from here
 *     and invokes its methods itself.
 *   - A lifecycle manager. Controllers are plain objects; the
 *     registry does not call their methods.
 *   - A validator. The registry does not check that a controller
 *     has a `render` method, or that its method names match the
 *     contract. The contract is documented, not enforced.
 *   - A dependency injector. Controllers are constructed elsewhere
 *     and passed in ready to use.
 *
 * VIEW IDS:
 *   The keys are the canonical Academy view ids, the same strings
 *   AcademyUI uses for `selectedView` and the same strings the
 *   shell's view nav emits in `data-view`:
 *
 *     'people'
 *     'tournaments'      (rendered as "Exams" in the UI)
 *     'weeklyTeams'
 *     'rankings'
 *     'disciplines'
 *     'locations'
 *
 *   The registry does not enforce that a key is one of those. It
 *   accepts any non-empty string. That keeps the registry
 *   independent of the view list, which lives in the shell. A typo
 *   in a key produces a controller that never gets looked up; the
 *   shell's own `get(activeViewId)` returning null is the signal.
 *
 * REGISTRATION SEMANTICS:
 *   register(viewId, controller)
 *     Overwrites any existing entry for `viewId`. This is
 *     deliberate: hot-reload during development replaces a
 *     controller in place, and re-registration in tests is
 *     expected. There is no "first-wins" semantics because there is
 *     no scenario in which silently keeping a stale controller
 *     would be correct.
 *
 *     Rejects when:
 *       - viewId is not a non-empty string
 *       - controller is not a non-null object
 *       - controller is an array
 *     Returns true on success, false on rejection. Does not throw.
 *
 *   get(viewId)
 *     Returns the registered controller, or null. Never throws.
 *
 *   has(viewId)
 *     Returns true when a controller is registered under `viewId`.
 *
 *   list()
 *     Returns the registered view ids as a fresh array, in
 *     registration order (insertion order of the backing map). The
 *     caller can sort if it wants. The array is a snapshot; later
 *     registrations do not appear in a previously returned list.
 *
 *   clear()
 *     Removes every registration. Exists for tests. Not called by
 *     the shell during normal operation; the shell never tears
 *     down the registry.
 *
 * NO RENDER OR DISPATCH:
 *   The registry has no opinion about how the shell uses a resolved
 *   controller. It does not call `render`, does not route events,
 *   does not know about `host`. Those concerns live in the shell.
 *   Keeping the registry this small is what lets S1.2–S1.7 be
 *   per-controller changes with no registry churn.
 *
 * DEPENDENCIES:
 *   None.
 *
 * USAGE:
 *   var Registry = window.AcademyControllers;
 *
 *   Registry.register('weeklyTeams', weeklyTeamsController);
 *   var controller = Registry.get('weeklyTeams');
 *   if (controller) {
 *       // Shell invokes controller methods.
 *   }
 */

(function() {
    'use strict';

    if (window.__academyControllersLoaded) {
        return;
    }
    window.__academyControllersLoaded = true;

    // ============================================================
    // STATE
    // ============================================================
    //
    // Plain object. Keys are view ids; values are controller objects.
    // Insertion order is preserved by JS object key ordering, so
    // `list()` returns registrations in the order they arrived.

    var _controllers = Object.create(null);

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isController(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Register a controller for a view id.
     *
     * Overwrites an existing registration for the same view id.
     *
     * @param {string} viewId - non-empty
     * @param {object} controller - non-null, non-array
     * @returns {boolean} true on success, false on rejection
     */
    function register(viewId, controller) {
        if (!isNonEmptyString(viewId)) {
            return false;
        }
        if (!isController(controller)) {
            return false;
        }
        _controllers[String(viewId)] = controller;
        return true;
    }

    /**
     * Get the controller registered for a view id.
     *
     * @param {string} viewId
     * @returns {object|null}
     */
    function get(viewId) {
        if (!isNonEmptyString(viewId)) {
            return null;
        }
        var key = String(viewId);
        if (!Object.prototype.hasOwnProperty.call(_controllers, key)) {
            return null;
        }
        return _controllers[key] || null;
    }

    /**
     * Is a controller registered for a view id?
     *
     * @param {string} viewId
     * @returns {boolean}
     */
    function has(viewId) {
        if (!isNonEmptyString(viewId)) {
            return false;
        }
        return Object.prototype.hasOwnProperty.call(
            _controllers,
            String(viewId)
        );
    }

    /**
     * List the registered view ids, in registration order.
     *
     * @returns {array} fresh array of strings
     */
    function list() {
        return Object.keys(_controllers);
    }

    /**
     * Remove every registration. For tests.
     *
     * @returns {void}
     */
    function clear() {
        _controllers = Object.create(null);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyControllers = Object.freeze({
        register: register,
        get: get,
        has: has,
        list: list,
        clear: clear
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyControllers;
        var missing = [];

        var required = ['register', 'get', 'has', 'list', 'clear'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyControllers] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();
