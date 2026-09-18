/**
 * modules/academy/controllers/controller-contract.js
 * Academy Controller Contract
 *
 * Path: js/modules/academy/controllers/controller-contract.js
 *
 * The documented interface every Academy feature controller
 * implements, plus a single invocation helper the shell uses to
 * call optional controller methods safely.
 *
 * WHAT THIS MODULE IS:
 *   - A written contract. The interface is documented below; it is
 *     not enforced by a base class, a mixin, or a type system.
 *   - One function: `invoke(controller, methodName, args)`.
 *
 * WHAT THIS MODULE IS NOT:
 *   - A base class. Controllers are plain objects.
 *   - A lifecycle framework. There is no `onMount`, no state machine,
 *     no registration logic.
 *   - A registry. Registration lives in academy-controllers.js.
 *   - A dispatcher. Dispatch lives in the shell.
 *   - A place to put shared feature logic. There is no shared
 *     feature logic; each controller is self-contained.
 *
 * WHY IT EXISTS:
 *   The shell needs to call controller methods that may or may not
 *   be implemented. Every controller implements `render`; the event
 *   handlers are optional, because a controller that has no inputs,
 *   no selects, and no keyboard shortcuts has nothing to do in them.
 *   Rather than sprinkle `if (controller && typeof controller.x ===
 *   'function')` through the shell's four delegated listeners, the
 *   shell calls `ControllerContract.invoke(controller, 'handleClick',
 *   [e])` and gets `undefined` when the method is absent.
 *
 *   That is the whole reason this module exists. If the interface
 *   were fully mandatory, this module would not need a function at
 *   all; it would be a comment block. Because the event handlers are
 *   optional, the shell needs one guard.
 *
 * THE CONTRACT:
 *
 *   Every Academy controller is a plain object. It may implement any
 *   subset of the following methods. None are required by the
 *   contract itself; the registry does not validate shape at
 *   registration time. The shell's expectations define what is
 *   required in practice:
 *
 *     render(host)
 *       Required in practice. Called when the controller's view
 *       becomes active, and again on every shell re-render. The
 *       controller renders its feature into `host`
 *       (an HTMLElement, typically `.academy-view-content`).
 *
 *       The controller OWNS everything inside `host` for the
 *       duration of its active period. It may set innerHTML, append
 *       children, or delegate to a renderer module. It must not
 *       reach outside `host`.
 *
 *       The controller does NOT own `host` itself. It does not
 *       create it, remove it, or re-parent it. The shell provides
 *       it.
 *
 *     handleClick(e)
 *     handleChange(e)
 *     handleInput(e)
 *     handleKeydown(e)
 *       Optional. Called by the shell's single delegated listener
 *       set for events that occurred inside `host` while this
 *       controller was active.
 *
 *       The controller receives the raw DOM event. It is
 *       responsible for finding its own targets (via
 *       `e.target.closest(...)`, dataset reads, etc.). The shell
 *       does no per-feature routing beyond "this event happened
 *       inside the active controller's host; hand it to that
 *       controller."
 *
 *       A controller that does not implement a handler simply does
 *       not care about that event class. The shell must not assume
 *       any handler is present.
 *
 *     unmount()
 *       Optional. Called when the controller is being replaced
 *       (view switch, or shell teardown). The controller cleans up
 *       anything it owns that is not inside `host`: timers,
 *       in-flight state, mounted sub-editors (grades editor,
 *       schedule grid). Anything inside `host` is torn down by the
 *       shell's innerHTML replacement; `unmount` is for everything
 *       else.
 *
 *       A controller that owns nothing outside `host` does not need
 *       `unmount`.
 *
 *   A controller may hold its own transient feature state. It must
 *   not write to `AcademyUI`. `AcademyUI` is the shell's shared
 *   store; the split (S1) does not widen it.
 *
 *   A controller must not import `AcademyView`. The dependency
 *   direction is one-way: shell → registry → controller. A
 *   controller that needs shell-level services (re-render,
 *   navigation) receives them as dependencies at construction, not
 *   by reaching back into the shell module.
 *
 * INVOCATION SEMANTICS:
 *   `invoke(controller, methodName, args)` returns the method's
 *   return value, or `undefined` when:
 *     - the controller is null / undefined
 *     - the controller does not have a function at `methodName`
 *     - the controller has a non-function at `methodName`
 *
 *   It does NOT throw for an absent method. That is the entire
 *   point. It DOES propagate any exception the method itself
 *   throws. Swallowing a controller's exception would hide bugs;
 *   the shell is expected to catch around `invoke` if it wants to
 *   keep a single bad controller from taking down the tab.
 *
 *   `args` is optional. When omitted, the method is called with no
 *   arguments.
 *
 * DEPENDENCIES:
 *   None.
 *
 * USAGE:
 *   var ControllerContract = window.AcademyControllerContract;
 *
 *   // In the shell:
 *   ControllerContract.invoke(activeController, 'render', [host]);
 *   ControllerContract.invoke(activeController, 'handleClick', [e]);
 *   ControllerContract.invoke(activeController, 'unmount', []);
 */

(function() {
    'use strict';

    if (window.__academyControllerContractLoaded) {
        return;
    }
    window.__academyControllerContractLoaded = true;

    /**
     * Invoke a method on a controller, safely.
     *
     * Returns the method's return value when the method exists and is
     * callable. Returns undefined when the controller is missing or
     * the named method is absent.
     *
     * Propagates any exception the method itself throws. The caller
     * is responsible for catching if it wants containment.
     *
     * @param {object|null|undefined} controller
     * @param {string} methodName
     * @param {array} [args]
     * @returns {*}
     */
    function invoke(controller, methodName, args) {
        if (!controller || typeof controller !== 'object') {
            return undefined;
        }
        if (typeof methodName !== 'string' || methodName === '') {
            return undefined;
        }

        var method = controller[methodName];
        if (typeof method !== 'function') {
            return undefined;
        }

        if (args === undefined || args === null) {
            return method.call(controller);
        }
        if (!Array.isArray(args)) {
            return method.call(controller, args);
        }

        // Fast paths for the common arities; falls through to apply
        // for anything else. apply is correct for every arity, but
        // the branches avoid the array spread cost on the hot path.
        switch (args.length) {
            case 0: return method.call(controller);
            case 1: return method.call(controller, args[0]);
            case 2: return method.call(controller, args[0], args[1]);
            case 3: return method.call(controller, args[0], args[1], args[2]);
            default: return method.apply(controller, args);
        }
    }

    window.AcademyControllerContract = Object.freeze({
        invoke: invoke
    });

    (function verify() {
        if (typeof window.AcademyControllerContract.invoke !== 'function') {
            console.warn(
                '[AcademyControllerContract] Verification: invoke is missing.'
            );
        }
    })();

})();
