/**
 * modules/academy/controllers/academy-ranking-controller.js
 * Academy Ranking Controller
 *
 * Path: js/modules/academy/controllers/academy-ranking-controller.js
 *
 * The Rankings feature controller. Owns the Rankings view: its
 * render, and its row-click navigation to the People view.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Rankings view into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by the
 *     shell for events that occur inside the host.
 *   - Row-click navigation to People, delegated to the shell via
 *     context.onOpenCharacterInPeople.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The week. The shell owns it; the controller reads it from
 *     AcademyUI on each render via context.week, falling back to
 *     AcademyUI.getDisplayWeek() if context does not carry one.
 *   - The class selection. That is SHARED Academy state, owned by
 *     AcademyUI. This controller reads AcademyUI.getSelectedClassId()
 *     on every render and routes class changes through
 *     AcademyUI.selectClass(). It holds no local class field, so a
 *     class chosen in any other Academy view is honoured here, and a
 *     class chosen here is honoured by every other view.
 *   - Re-rendering the shell. When a state change should re-render,
 *     the controller calls context.onChange().
 *   - Ranking reads. AcademyAggregator.getRankingViewModel produces
 *     the VM.
 *   - Cross-view navigation. The controller asks the shell to
 *     navigate; it does not call AcademyUI.setSelectedView itself.
 *
 * DEPENDENCY DIRECTION:
 *   Shell → registry → this controller.
 *   This controller never references window.AcademyView.
 *
 * RENDER SIGNATURE:
 *   render(host, context)
 *
 *   host    — the HTMLElement the shell allocates for the active
 *             controller.
 *   context — {
 *               week: number,
 *               onChange: function(),
 *               onOpenCharacterInPeople: function(charId)
 *             }
 *
 * EVENT ROUTING:
 *   The controller's handleClick handles row clicks (delegating to
 *   context.onOpenCharacterInPeople). handleChange handles the
 *   class select and the week input. handleKeydown handles Enter on
 *   the week input. The renderer's ids and data attributes are
 *   unchanged from pre-S1.7.
 *
 * DEPENDENCIES:
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyRankingView
 */

(function() {
    'use strict';

    if (window.__academyRankingControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var View = window.AcademyRankingView;

    var _missing = [];

    if (!AcademyUI ||
        typeof AcademyUI.getDisplayWeek !== 'function' ||
        typeof AcademyUI.setDisplayWeek !== 'function' ||
        typeof AcademyUI.getSelectedClassId !== 'function' ||
        typeof AcademyUI.selectClass !== 'function') {
        _missing.push('AcademyUI week/class accessors');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getRankingViewModel !== 'function') {
        _missing.push('AcademyAggregator.getRankingViewModel');
    }
    if (!View || typeof View.renderHTML !== 'function') {
        _missing.push('AcademyRankingView.renderHTML');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyRankingController] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyRankingControllerLoaded = true;

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // The class selection is NOT held here. It is shared Academy
    // state owned by AcademyUI. This controller reads it on every
    // render and writes it only through AcademyUI.selectClass().

    var _host = null;
    var _context = null;

    // ============================================================
    // CONTEXT NORMALISATION
    // ============================================================

    function normaliseContext(rawContext) {
        var ctx = rawContext && typeof rawContext === 'object'
            ? rawContext
            : {};

        var week = typeof ctx.week === 'number' && isFinite(ctx.week)
            ? ctx.week
            : AcademyUI.getDisplayWeek();

        var onChange = typeof ctx.onChange === 'function'
            ? ctx.onChange
            : function() {};

        var onOpenCharacterInPeople =
            typeof ctx.onOpenCharacterInPeople === 'function'
                ? ctx.onOpenCharacterInPeople
                : function() {};

        return {
            week: week,
            onChange: onChange,
            onOpenCharacterInPeople: onOpenCharacterInPeople
        };
    }

    function getContext() {
        if (_context) { return _context; }
        return normaliseContext(null);
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

        // Class selection is shared Academy state. Read it fresh
        // each render; never cache it locally.
        var selectedClassId = AcademyUI.getSelectedClassId();

        var vm;
        try {
            vm = AcademyAggregator.getRankingViewModel(
                selectedClassId,
                _context.week
            );
        } catch (e) {
            console.warn(
                '[AcademyRankingController] getRankingViewModel threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to load rankings.' +
                    '</p>' +
                '</div>';
            return;
        }

        var html;
        try {
            html = View.renderHTML(vm);
        } catch (e) {
            console.warn(
                '[AcademyRankingController] renderHTML threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to render rankings.' +
                    '</p>' +
                '</div>';
            return;
        }

        host.innerHTML = html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        // ---- Ranking row: navigate to People with character ----
        var row = target.closest('.academy-ranking-row');
        if (row && row.dataset && row.dataset.characterId) {
            e.preventDefault();
            var ctx = getContext();
            ctx.onOpenCharacterInPeople(row.dataset.characterId);
            return;
        }
    }

    function handleChange(e) {
        var target = e.target;
        if (!target || !target.id) { return; }

        if (target.id === 'academy-ranking-class-select') {
            // Route class changes through the shared Academy state.
            AcademyUI.selectClass(target.value || null);
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        if (target.id === 'academy-ranking-week-input') {
            var accepted = AcademyUI.setDisplayWeek(target.value);
            if (accepted) {
                var c = getContext();
                c.onChange();
            }
            return;
        }
    }

    function handleInput(e) {
        // The Rankings view has no live text inputs. Reserved.
    }

    function handleKeydown(e) {
        var target = e.target;
        if (!target || e.key !== 'Enter') { return; }

        if (target.id === 'academy-ranking-week-input') {
            e.preventDefault();
            var accepted = AcademyUI.setDisplayWeek(target.value);
            if (accepted) {
                var ctx = getContext();
                ctx.onChange();
            }
        }
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        // Class selection is shared state owned by AcademyUI; this
        // controller holds no copy of it, so there is nothing to
        // persist or clear here.

        _host = null;
        _context = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRankingController = Object.freeze({
        render: render,
        handleClick: handleClick,
        handleChange: handleChange,
        handleInput: handleInput,
        handleKeydown: handleKeydown,
        unmount: unmount
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyRankingController;
        var missing = [];

        var required = [
            'render',
            'handleClick',
            'handleChange',
            'handleInput',
            'handleKeydown',
            'unmount'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyRankingController] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
