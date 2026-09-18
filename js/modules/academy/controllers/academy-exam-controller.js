/**
 * modules/academy/controllers/academy-exam-controller.js
 * Academy Exam Controller
 *
 * Path: js/modules/academy/controllers/academy-exam-controller.js
 *
 * The Exams feature controller. Owns the Exams view: its render, its
 * event handlers, the exam class selection, and the pair-picker DOM
 * interactions.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Exams view into the shell's content host, via
 *     AcademyTournamentAggregator.getExamViewModel and
 *     AcademyTournamentView.renderHTML.
 *   - Handling clicks, changes, inputs, and keydowns routed by the
 *     shell for events that occur inside the host.
 *   - The exam class selection (_selectedExamClassId). This is
 *     feature state: which class's exam the user is looking at.
 *     Defaults to the shell's People-view class selection when no
 *     exam class has been chosen yet.
 *   - Routing exam-* actions to AcademyTournamentEvents (create,
 *     edit, delete, reopen, add round, remove round, reopen round,
 *     auto-generate, add match, edit match, complete match, reopen
 *     match, remove match, toggle pool member, restore eliminated,
 *     complete exam, toggle round collapse).
 *   - The pair-picker DOM mutations (exam-pair-add, exam-pair-remove).
 *     These are pure UI: adding a row to a list, removing a row from
 *     a list. They do not touch the domain.
 *   - Wiring AcademyTournamentEvents.setOnChangeCallback to
 *     context.onChange on every render. The events module stores the
 *     callback; re-registering it each render is idempotent and
 *     ensures the closure captures the current context.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The week. The shell owns it; the controller reads it from
 *     AcademyUI on each render via context.week, falling back to
 *     AcademyUI.getDisplayWeek() if context does not carry one.
 *   - Re-rendering the shell. When a mutation succeeds, the
 *     controller calls context.onChange().
 *   - Tournament reads and writes. AcademyTournamentAggregator
 *     produces the VM; AcademyTournamentEvents drives the mutations;
 *     the tournament domain modules do the work.
 *   - Any navigation to another view. The Exams view has no
 *     cross-view navigation.
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
 *               onChange: function()
 *             }
 *
 *   The week is passed in for convenience, but the controller also
 *   reads AcademyUI.getDisplayWeek() directly (a shared read, not a
 *   shell write). If context.week is absent or malformed, the
 *   controller falls back to the AcademyUI read. Either path produces
 *   the same value.
 *
 * EVENT ROUTING:
 *   The controller's handleClick dispatches exam-* actions to
 *   AcademyTournamentEvents, exactly as the shell's handleExamAction
 *   did. It also handles exam-pair-add and exam-pair-remove locally,
 *   because those are DOM mutations rather than domain mutations.
 *
 *   The renderer and event-layer action strings and data attributes
 *   are unchanged from pre-S1.4.
 *
 * ONCHANGE WIRING:
 *   AcademyTournamentEvents.setOnChangeCallback is called once per
 *   controller render. The events module stores the callback and
 *   invokes it when a mutation completes. Re-registering on every
 *   render is idempotent and means the callback always closes over
 *   the current render's context.
 *
 * DEPENDENCIES:
 *   - window.AcademyUI
 *   - window.AcademyTournamentAggregator
 *   - window.AcademyTournamentEvents
 *   - window.AcademyTournamentView
 *   - window.CharacterQueries      (for the pair-picker label)
 *   - window.NotificationSystem
 *   - window.DomUtils              (for escaping in the pair picker)
 */

(function() {
    'use strict';

    if (window.__academyExamControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyTournamentAggregator = window.AcademyTournamentAggregator;
    var Events = window.AcademyTournamentEvents;
    var View = window.AcademyTournamentView;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    var _missing = [];

    if (!AcademyUI ||
        typeof AcademyUI.getDisplayWeek !== 'function' ||
        typeof AcademyUI.getSelectedClassId !== 'function') {
        _missing.push('AcademyUI week/class accessors');
    }
    if (!AcademyTournamentAggregator ||
        typeof AcademyTournamentAggregator.getExamViewModel !== 'function') {
        _missing.push('AcademyTournamentAggregator.getExamViewModel');
    }
    if (!Events ||
        typeof Events.createExam !== 'function' ||
        typeof Events.editExam !== 'function' ||
        typeof Events.deleteExam !== 'function' ||
        typeof Events.reopenExam !== 'function' ||
        typeof Events.togglePoolMember !== 'function' ||
        typeof Events.addRound !== 'function' ||
        typeof Events.removeRound !== 'function' ||
        typeof Events.reopenRound !== 'function' ||
        typeof Events.toggleRoundCollapse !== 'function' ||
        typeof Events.autoGenerateRound !== 'function' ||
        typeof Events.addMatchManual !== 'function' ||
        typeof Events.editMatch !== 'function' ||
        typeof Events.completeMatch !== 'function' ||
        typeof Events.reopenMatch !== 'function' ||
        typeof Events.removeMatch !== 'function' ||
        typeof Events.restoreEliminatedParticipant !== 'function' ||
        typeof Events.completeExam !== 'function' ||
        typeof Events.setOnChangeCallback !== 'function') {
        _missing.push('AcademyTournamentEvents API');
    }
    if (!View || typeof View.renderHTML !== 'function') {
        _missing.push('AcademyTournamentView.renderHTML');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function' ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getCharacterById/getDisplayName');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyExamController] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyExamControllerLoaded = true;

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _host = null;
    var _context = null;

    // Feature state: which class's exam the user is viewing. Owned by
    // the controller. Defaults to the shell's People-view class
    // selection on first render if the user has not yet chosen an
    // exam class.
    var _selectedExamClassId = null;

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

        return {
            week: week,
            onChange: onChange
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

        // Re-register the events module's onChange callback so it
        // closes over the current context. Idempotent.
        try {
            Events.setOnChangeCallback(_context.onChange);
        } catch (e) {
            console.warn(
                '[AcademyExamController] setOnChangeCallback threw:', e
            );
        }

        // Sync the exam class selection: default to the shell's
        // People-view class if no exam class has been chosen yet.
        if (!_selectedExamClassId) {
            var peopleClassId = AcademyUI.getSelectedClassId();
            if (peopleClassId) {
                _selectedExamClassId = peopleClassId;
            }
        }

        var vm;
        try {
            vm = AcademyTournamentAggregator.getExamViewModel(
                _selectedExamClassId,
                _context.week
            );
        } catch (e) {
            console.warn(
                '[AcademyExamController] getExamViewModel threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to load exams.' +
                    '</p>' +
                '</div>';
            return;
        }

        // Adopt the VM's resolved classId if the aggregator resolved
        // one (it does so when the shell-supplied id no longer names
        // a real class, or when the VM resolved from state).
        if (vm && vm.classId) {
            _selectedExamClassId = vm.classId;
        }

        var html;
        try {
            html = View.renderHTML(vm);
        } catch (e) {
            console.warn(
                '[AcademyExamController] renderHTML threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to render exams.' +
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

        // ---- Class selector ----
        // The class select is a native <select>; its change event is
        // handled in handleChange. Clicks that land on it do nothing.
        if (target.id === 'at-class-select') {
            return;
        }

        // ---- Delegated action dispatch ----
        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;
        if (!isNonEmptyString(action)) { return; }

        // ---- Pair-picker local actions (DOM mutations) ----
        if (action === 'exam-pair-add') {
            e.preventDefault();
            handlePairAdd(actionEl);
            return;
        }
        if (action === 'exam-pair-remove') {
            e.preventDefault();
            handlePairRemove(actionEl);
            return;
        }

        // ---- Round collapse (UI-only; delegates to events module) ----
        if (action === 'exam-toggle-round-collapse') {
            e.preventDefault();
            Events.toggleRoundCollapse(
                actionEl.dataset.examId,
                actionEl.dataset.roundId
            );
            return;
        }

        // ---- Edit exam (opens a modal) ----
        if (action === 'exam-edit') {
            e.preventDefault();
            Events.editExam(actionEl.dataset.examId);
            return;
        }

        // ---- All other exam-* actions ----
        var examId = actionEl.dataset.examId || null;

        switch (action) {
            case 'exam-create':
                e.preventDefault();
                Events.createExam(
                    _selectedExamClassId,
                    getContext().week
                );
                return;
            case 'exam-delete':
                e.preventDefault();
                if (examId) { Events.deleteExam(examId); }
                return;
            case 'exam-reopen-exam':
                e.preventDefault();
                if (examId) { Events.reopenExam(examId); }
                return;
            case 'exam-toggle-pool-member':
                e.preventDefault();
                if (examId) {
                    Events.togglePoolMember(
                        examId, actionEl.dataset.poolId
                    );
                }
                return;
            case 'exam-add-round':
                e.preventDefault();
                if (examId) { Events.addRound(examId); }
                return;
            case 'exam-remove-round':
                e.preventDefault();
                if (examId) {
                    Events.removeRound(examId, actionEl.dataset.roundId);
                }
                return;
            case 'exam-reopen-round':
                e.preventDefault();
                if (examId) {
                    Events.reopenRound(examId, actionEl.dataset.roundId);
                }
                return;
            case 'exam-auto-generate-round':
                e.preventDefault();
                if (examId) {
                    Events.autoGenerateRound(
                        examId, actionEl.dataset.roundId
                    );
                }
                return;
            case 'exam-add-match':
                e.preventDefault();
                if (examId) {
                    Events.addMatchManual(
                        examId, actionEl.dataset.roundId
                    );
                }
                return;
            case 'exam-edit-match':
                e.preventDefault();
                if (examId) {
                    Events.editMatch(
                        examId,
                        actionEl.dataset.roundId,
                        actionEl.dataset.matchId
                    );
                }
                return;
            case 'exam-complete-match':
                e.preventDefault();
                if (examId) {
                    Events.completeMatch(
                        examId,
                        actionEl.dataset.roundId,
                        actionEl.dataset.matchId
                    );
                }
                return;
            case 'exam-reopen-match':
                e.preventDefault();
                if (examId) {
                    Events.reopenMatch(
                        examId,
                        actionEl.dataset.roundId,
                        actionEl.dataset.matchId
                    );
                }
                return;
            case 'exam-remove-match':
                e.preventDefault();
                if (examId) {
                    Events.removeMatch(
                        examId,
                        actionEl.dataset.roundId,
                        actionEl.dataset.matchId
                    );
                }
                return;
            case 'exam-restore-eliminated':
                e.preventDefault();
                if (examId) {
                    Events.restoreEliminatedParticipant(
                        examId,
                        actionEl.dataset.characterId
                    );
                }
                return;
            case 'exam-complete':
                e.preventDefault();
                if (examId) { Events.completeExam(examId); }
                return;
            default:
                return;
        }
    }

    function handleChange(e) {
        var target = e.target;
        if (!target || !target.id) { return; }

        if (target.id === 'at-class-select') {
            _selectedExamClassId = target.value || null;
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        if (target.id === 'at-week-input') {
            var accepted = AcademyUI.setDisplayWeek(target.value);
            if (accepted) {
                var c = getContext();
                c.onChange();
            }
            return;
        }
    }

    function handleInput(e) {
        // The Exams view has no live text inputs. Reserved.
    }

    function handleKeydown(e) {
        var target = e.target;
        if (!target || e.key !== 'Enter') { return; }

        if (target.id === 'at-week-input') {
            e.preventDefault();
            var accepted = AcademyUI.setDisplayWeek(target.value);
            if (accepted) {
                var ctx = getContext();
                ctx.onChange();
            }
        }
    }

    // ============================================================
    // PAIR PICKER — DOM MUTATIONS
    // ============================================================
    //
    // The pair picker is a small form inside the Add Match / Edit
    // Match modals. It has three select elements (slot 1, slot 2,
    // optional slot 3) and an "+ Add" button. Clicking "+ Add"
    // appends a row to the pair list, showing the chosen participants
    // by name. Each row has a remove button.
    //
    // The form's collector reads the rows and returns the pairings
    // array. The controller's job here is only to maintain the DOM:
    // add a row, remove a row.
    //
    // The list of rows is stored in the DOM itself, not in JS state.
    // The collector reads it. This is the same shape the shell used
    // pre-S1.4.

    function handlePairAdd(btn) {
        var form = btn.closest('form');
        if (!form) { return; }

        var slot1 = form.querySelector('[data-pair-slot="1"]');
        var slot2 = form.querySelector('[data-pair-slot="2"]');
        var slot3 = form.querySelector('[data-pair-slot="3"]');

        var v1 = slot1 ? slot1.value : '';
        var v2 = slot2 ? slot2.value : '';
        var v3 = slot3 ? slot3.value : '';

        if (!v1 || !v2) {
            notify(
                'Please select at least 2 participants for the pair.',
                'error'
            );
            return;
        }

        if (v1 === v2 || (v3 && (v3 === v1 || v3 === v2))) {
            notify(
                'Participants in a pair must be distinct.',
                'error'
            );
            return;
        }

        var group = [v1, v2];
        if (v3) { group.push(v3); }

        var list = form.querySelector('.at-pair-list');
        if (!list) { return; }

        var names = group.map(function(id) {
            if (CharacterQueries &&
                typeof CharacterQueries.getCharacterById === 'function' &&
                typeof CharacterQueries.getDisplayName === 'function') {
                var c = CharacterQueries.getCharacterById(id);
                if (c) { return CharacterQueries.getDisplayName(c); }
            }
            return id;
        }).join(' + ');

        var row = document.createElement('div');
        row.className = 'at-pair-row';
        row.dataset.pair = JSON.stringify(group);
        row.innerHTML =
            '<span class="at-pair-row-text">' +
                DomUtils.escapeHtml(names) +
            '</span>' +
            '<button type="button" ' +
                'class="small danger at-pair-remove" ' +
                'data-action="exam-pair-remove">' +
                '\u2715' +
            '</button>';

        list.appendChild(row);

        if (slot1) { slot1.value = ''; }
        if (slot2) { slot2.value = ''; }
        if (slot3) { slot3.value = ''; }
    }

    function handlePairRemove(btn) {
        var row = btn.closest('.at-pair-row');
        if (!row) { return; }
        if (row.parentNode) {
            row.parentNode.removeChild(row);
        }
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        // The exam class selection is feature state. It is
        // deliberately NOT cleared on unmount: the user's chosen exam
        // class should survive a switch to another view and back.
        // This is consistent with the discipline filter, which also
        // survives. State the user explicitly set persists; transient
        // edit state (like the discipline draft) does not.

        _host = null;
        _context = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyExamController = Object.freeze({
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
        var exports = window.AcademyExamController;
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
                '[AcademyExamController] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
