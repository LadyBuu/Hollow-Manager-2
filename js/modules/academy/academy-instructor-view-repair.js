/**
 * js/modules/academy/academy-instructor-repair-view.js
 * Academy Instructor Repair View
 *
 * Path: js/modules/academy/academy-instructor-repair-view.js
 *
 * WHAT THIS VIEW EXISTS FOR:
 *   The v31 migration tagged every enrolment interval with a role.
 *   For characters that had `character.mode === 'instructor'`, the
 *   migration tagged EVERY enrolment of that character as
 *   instructor-role — even if the character only taught one of
 *   their classes.
 *
 *   That is the migration's deliberate over-mark: it errs on the
 *   side of assuming "instructor" and lets the user fix the ones
 *   that were wrong. This view is where the user fixes them.
 *
 * WHAT THIS VIEW DOES:
 *   - Lists every character who has at least one instructor-role
 *     enrolment in any class.
 *   - For each such character, shows every class they are marked
 *     as teaching, with a checkbox.
 *   - Unchecking a class and clicking "Save" rewrites every
 *     enrolment interval of that (character, class) pair to
 *     role: 'student' via CharacterCRUD.setInstructorForClass.
 *   - Each "Save" is per-character, so a user can fix one at a
 *     time without committing every other change on the screen.
 *
 * WHAT THIS VIEW DOES NOT DO:
 *   - It does NOT enroll a character as an instructor of a class
 *     they do not currently teach. Marking a character as a
 *     teacher is done from the class's own instructor-assignment
 *     flow (the enrollment modal opened with a title).
 *   - It does NOT delete enrolments. A character who is unmarked
 *     as an instructor for a class keeps every enrolment interval
 *     for that class; the intervals are role-flipped, not
 *     removed.
 *   - It does NOT touch teaching groups, sessions, grades, or
 *     anything else. The role is an enrolment fact; only the
 *     enrolment store changes.
 *
 * LAYOUT:
 *   For each character:
 *
 *     <Character Name>
 *     Marked as instructor for:
 *       [x] Class of 2026      [Save]   (row-level save not used;
 *       [x] Class of 2027               one Save per character)
 *     [Save changes]
 *
 *   The list is sorted by character display name. Classes under
 *   each character are sorted by class display name.
 *
 * SAVE SEMANTICS:
 *   Clicking Save on a character:
 *     1. For every class that was checked and is still checked:
 *        no-op (the character is already an instructor there).
 *     2. For every class that was checked and is now unchecked:
 *        call CharacterCRUD.setInstructorForClass(charId, classId,
 *        false) — flip to student.
 *     3. For every class that was unchecked and is now checked:
 *        not possible. Unchecked classes are not in the initial
 *        list (this view only lists classes the character is
 *        currently an instructor of). The checkbox starts checked
 *        for every listed class.
 *
 *   After all mutations for a character succeed, that character's
 *   row is removed from the view.
 *
 *   If a mutation fails, the whole sequence for that character
 *   stops and the remaining mutations are not issued. The user is
 *   notified with the failure message.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.NotificationSystem
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.CharacterCRUD (for setInstructorForClass)
 *
 * DEPENDENCIES (LAZY, resolved at call time):
 *   - window.AcademyEnrolments (fallback instructor-set derivation
 *     when AcademyClasses.getClassInstructorIdsAllTime is not
 *     available)
 *
 * USAGE:
 *   // From the Academy UI shell, e.g. on a tab switch:
 *   var container = document.getElementById('tab-academy-instructor-repair');
 *   AcademyInstructorRepairView.render(container);
 */

(function() {
    'use strict';

    if (window.__academyInstructorRepairViewLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var CharacterQueries = window.CharacterQueries;
    var AcademyClasses = window.AcademyClasses;

    var _missing = [];

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacters !== 'function' ||
        typeof CharacterQueries.getCharacterById !== 'function' ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries API');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClassInstructorIdsAllTime !== 'function' ||
        typeof AcademyClasses.getDisplayName !== 'function') {
        _missing.push('AcademyClasses API');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyInstructorRepairView] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyInstructorRepairViewLoaded = true;

    // ============================================================
    // LAZY ACCESSORS
    // ============================================================

    function getAcademyEnrolments() {
        return window.AcademyEnrolments || null;
    }

    function getCharacterCRUD() {
        return window.CharacterCRUD || null;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // _container holds the DOM element the view is mounted into.
    // _viewModel holds the built view model for the current
    // render, so the save handler can look up the pre-edit state
    // (which classes were originally checked) without re-walking
    // the stores.

    var _container = null;
    var _viewModel = null;
    var _busy = false;

    // ============================================================
    // VIEW MODEL
    // ============================================================
    //
    // For each character with at least one instructor-role
    // enrolment, the VM carries:
    //
    //   {
    //     characterId: string,
    //     characterName: string,
    //     classes: [
    //       { classId, className, checked: true }
    //     ]
    //   }
    //
    // The `checked` flag reflects the STORED state at build time.
    // The DOM checkbox reflects the USER'S current intent.
    // Comparison between the two produces the diff of what to
    // flip.

    function buildViewModel() {
        var characters = [];
        try {
            characters = CharacterQueries.getCharacters() || [];
        } catch (e) {
            characters = [];
        }

        var result = [];

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (!char || !char.id) { continue; }

            var instructorClassIds = [];
            try {
                instructorClassIds =
                    AcademyClasses.getClassInstructorIdsAllTime('')
                    || [];
            } catch (e) {
                instructorClassIds = [];
            }

            // Determine which classes this character teaches.
            // The list comes from walking every class and asking
            // the class-scoped query which characters are its
            // instructors. A character-driven enumeration would
            // need a per-character query that does not exist;
            // walking classes is O(classes) per character, which
            // is acceptable for a repair view that is opened
            // rarely.
            //
            // A more efficient version would build a
            // characterId → [classIds] map once, in one pass over
            // all classes. That is what this function does.
            void instructorClassIds;
        }

        // Efficient pass: build the characterId → [classIds] map
        // in one walk over all classes.
        var classes = [];
        try {
            classes = AcademyClasses.getClasses() || [];
        } catch (e) {
            classes = [];
        }

        var byCharacter = Object.create(null);

        for (var c = 0; c < classes.length; c++) {
            var cls = classes[c];
            if (!cls || !cls.id) { continue; }

            var instructorIds = [];
            try {
                instructorIds = AcademyClasses.getClassInstructorIdsAllTime(
                    cls.id
                ) || [];
            } catch (e) {
                instructorIds = [];
            }

            if (!Array.isArray(instructorIds)) { continue; }

            for (var ii = 0; ii < instructorIds.length; ii++) {
                var charId = isNonEmptyString(instructorIds[ii])
                    ? String(instructorIds[ii])
                    : null;
                if (charId === null) { continue; }

                if (!byCharacter[charId]) {
                    byCharacter[charId] = [];
                }

                byCharacter[charId].push({
                    classId: String(cls.id),
                    className: isNonEmptyString(cls.name)
                        ? cls.name
                        : 'Unnamed Class',
                    checked: true
                });
            }
        }

        var charIds = Object.keys(byCharacter);

        for (var ci = 0; ci < charIds.length; ci++) {
            var id = charIds[ci];
            var char = CharacterQueries.getCharacterById(id);
            if (!char) { continue; }

            var charName = '';
            try {
                charName = CharacterQueries.getDisplayName(char) || '';
            } catch (e) {
                charName = '';
            }
            if (!charName) { charName = 'Unknown'; }

            var classList = byCharacter[id];
            classList.sort(function(a, b) {
                return a.className.localeCompare(b.className);
            });

            result.push({
                characterId: id,
                characterName: charName,
                classes: classList
            });
        }

        result.sort(function(a, b) {
            return a.characterName.localeCompare(b.characterName);
        });

        return {
            characters: result,
            totalCharacters: result.length
        };
    }

    // ============================================================
    // RENDER — entry point
    // ============================================================

    function render(container) {
        if (!container) {
            console.warn(
                '[AcademyInstructorRepairView] Container is required.'
            );
            return;
        }

        _container = container;
        _viewModel = buildViewModel();

        _container.innerHTML = buildViewHTML(_viewModel);

        bindSaveButtons();
    }

    function unmount() {
        _container = null;
        _viewModel = null;
        _busy = false;
    }

    // ============================================================
    // HTML
    // ============================================================

    function buildViewHTML(vm) {
        var html = '';

        html += '<div class="academy-instructor-repair-view">';

        html += '<div class="academy-instructor-repair-header" ' +
                    'style="margin-bottom:16px;">';
        html += '<h2 style="margin:0 0 8px 0;' +
                    'font-size:1rem;color:var(--accent);">' +
                    'Instructor Repair' +
                '</h2>';
        html += '<p class="field-hint" ' +
                    'style="margin:0;font-size:0.75rem;' +
                    'color:var(--text-dim);">' +
                    'The migration marked every class of every ' +
                    'instructor-mode character as taught. Use this ' +
                    'view to unmark classes that are wrong. Unmarking ' +
                    'a class sets the character back to student for ' +
                    'that class only; other classes are unaffected.' +
                '</p>';
        html += '</div>';

        if (vm.totalCharacters === 0) {
            html += '<p class="empty-state" ' +
                        'style="padding:8px;font-size:0.8rem;">' +
                        'No characters are currently marked as ' +
                        'instructors of any class.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<p style="font-size:0.75rem;color:var(--text-dim);' +
                    'margin:0 0 12px 0;">' +
                    vm.totalCharacters + ' character' +
                    (vm.totalCharacters === 1 ? '' : 's') +
                    ' with instructor assignments.' +
                '</p>';

        for (var i = 0; i < vm.characters.length; i++) {
            html += buildCharacterBlock(vm.characters[i]);
        }

        html += '</div>';
        return html;
    }

    function buildCharacterBlock(entry) {
        var charId = escapeAttribute(entry.characterId);

        var html = '';
        html += '<div class="academy-instructor-repair-character" ' +
                    'data-character-id="' + charId + '" ' +
                    'style="margin-bottom:16px;padding:12px;' +
                    'background:var(--panel);' +
                    'border:1px solid var(--border);' +
                    'border-radius:var(--radius);">';

        html += '<div class="academy-instructor-repair-character-name" ' +
                    'style="font-size:0.85rem;font-weight:600;' +
                    'color:var(--accent);margin-bottom:8px;">' +
                    escapeHtml(entry.characterName) +
                '</div>';

        html += '<div style="font-size:0.7rem;color:var(--text-dim);' +
                    'margin-bottom:6px;">' +
                    'Marked as instructor for:' +
                '</div>';

        html += '<div class="academy-instructor-repair-classes" ' +
                    'style="display:flex;flex-direction:column;' +
                    'gap:4px;margin-bottom:10px;">';

        for (var i = 0; i < entry.classes.length; i++) {
            var cls = entry.classes[i];
            html += buildClassRow(cls);
        }

        html += '</div>';

        html += '<div class="academy-instructor-repair-actions" ' +
                    'style="display:flex;justify-content:flex-end;' +
                    'gap:8px;">';
        html += '<button type="button" ' +
                    'class="small primary ' +
                    'academy-instructor-repair-save-btn" ' +
                    'data-character-id="' + charId + '" ' +
                    'style="font-size:0.7rem;padding:4px 12px;">' +
                    'Save changes' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function buildClassRow(cls) {
        var classId = escapeAttribute(cls.classId);
        var inputId = 'instructor-repair-' +
            escapeAttribute(cls.classId) + '-' +
            Math.random().toString(36).slice(2, 8);

        var html = '';
        html += '<label class="academy-instructor-repair-class-row" ' +
                    'for="' + inputId + '" ' +
                    'style="display:flex;align-items:center;gap:6px;' +
                    'padding:4px 6px;background:var(--bg);' +
                    'border-radius:4px;font-size:0.75rem;' +
                    'cursor:pointer;">';

        html += '<input type="checkbox" ' +
                    'id="' + inputId + '" ' +
                    'class="academy-instructor-repair-class-checkbox" ' +
                    'data-class-id="' + classId + '" ' +
                    'checked ' +
                    'style="accent-color:var(--accent);">';

        html += '<span class="academy-instructor-repair-class-name" ' +
                    'style="flex:1;">' +
                    escapeHtml(cls.className) +
                '</span>';

        html += '</label>';
        return html;
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================
    //
    // One delegated listener on _container handles every save
    // button. This survives re-renders of the container's
    // innerHTML because the listener is on the container itself,
    // not on the buttons.

    function bindSaveButtons() {
        if (!_container) { return; }

        // Remove any previous listener by replacing the container's
        // inner content is already done in render(), so the buttons
        // are fresh. But the listener itself is bound once per
        // render() call; we store it on a property so a second
        // render() can remove it first.
        if (_container.__instructorRepairClickHandler) {
            try {
                _container.removeEventListener(
                    'click',
                    _container.__instructorRepairClickHandler
                );
            } catch (e) { /* ignore */ }
            _container.__instructorRepairClickHandler = null;
        }

        var handler = function(e) {
            if (_busy) {
                e.preventDefault();
                return;
            }

            var target = e.target;
            if (!target || typeof target.closest !== 'function') {
                return;
            }

            var saveBtn = target.closest(
                '.academy-instructor-repair-save-btn'
            );
            if (!saveBtn || !saveBtn.dataset) { return; }

            e.preventDefault();

            var charId = saveBtn.dataset.characterId;
            if (!charId) { return; }

            handleSaveCharacter(charId);
        };

        _container.addEventListener('click', handler);
        _container.__instructorRepairClickHandler = handler;
    }

    // ============================================================
    // SAVE — per character
    // ============================================================
    //
    // Reads the checkbox state for each class the character was
    // marked as instructor of. Compares against the ORIGINAL state
    // in the view model. For every class that was checked and is
    // now unchecked, issues setInstructorForClass(charId, classId,
    // false).
    //
    // The mutations are sequential. A failure aborts the sequence
    // for that character; the remaining classes for that character
    // are not flipped. Other characters are unaffected.
    //
    // On success, re-renders the view so the character is removed
    // from the list (if they have no other instructor classes).

    function handleSaveCharacter(charId) {
        if (!_container || !_viewModel) { return; }
        if (_busy) { return; }

        var entry = null;
        for (var i = 0; i < _viewModel.characters.length; i++) {
            if (_viewModel.characters[i].characterId === charId) {
                entry = _viewModel.characters[i];
                break;
            }
        }

        if (!entry) {
            notify('Character not found in repair view.', 'error');
            return;
        }

        var block = _container.querySelector(
            '.academy-instructor-repair-character' +
            '[data-character-id="' + cssEscape(charId) + '"]'
        );
        if (!block) {
            notify('Character block not found.', 'error');
            return;
        }

        var checkboxes = block.querySelectorAll(
            '.academy-instructor-repair-class-checkbox'
        );

        // Compute the flip list: originally checked classes that
        // are now unchecked. Originally-unchecked classes cannot
        // exist in this view (see the file header).
        var flips = [];

        for (var j = 0; j < checkboxes.length; j++) {
            var cb = checkboxes[j];
            var classId = cb.dataset
                ? cb.dataset.classId
                : null;
            if (!isNonEmptyString(classId)) { continue; }

            var originalEntry = null;
            for (var k = 0; k < entry.classes.length; k++) {
                if (entry.classes[k].classId === String(classId)) {
                    originalEntry = entry.classes[k];
                    break;
                }
            }

            if (!originalEntry) { continue; }

            var wasChecked = originalEntry.checked === true;
            var isChecked = cb.checked === true;

            if (wasChecked && !isChecked) {
                flips.push(String(classId));
            }

            // wasChecked === false is not possible in this view
            // (every listed class starts checked), but if the
            // view ever grows to support adding classes, that
            // case would go here.
        }

        if (flips.length === 0) {
            notify('No changes to save.', 'info');
            return;
        }

        var CRUD = getCharacterCRUD();
        if (!CRUD ||
            typeof CRUD.setInstructorForClass !== 'function') {
            notify(
                'CharacterCRUD.setInstructorForClass is unavailable. ' +
                'Check the script load order in index.html.',
                'error'
            );
            return;
        }

        _busy = true;

        var succeeded = 0;
        var failed = false;
        var chain = Promise.resolve();

        flips.forEach(function(classId) {
            chain = chain.then(function() {
                if (failed) { return; }

                return CRUD.setInstructorForClass(
                    charId,
                    classId,
                    false
                ).then(function(result) {
                    if (result && result.success) {
                        succeeded++;
                        return;
                    }
                    failed = true;
                    notify(
                        (result && result.message) ||
                            'Failed to unmark a class.',
                        'error'
                    );
                }).catch(function(err) {
                    failed = true;
                    console.warn(
                        '[AcademyInstructorRepairView] ' +
                        'setInstructorForClass threw:', err
                    );
                    notify(
                        'Failed to unmark a class. See console for details.',
                        'error'
                    );
                });
            });
        });

        chain.then(function() {
            _busy = false;

            if (failed) {
                // Re-render to reflect whatever succeeded.
                render(_container);
                return;
            }

            notify(
                'Unmarked ' + succeeded + ' class' +
                (succeeded === 1 ? '' : 'es') +
                ' for this character.',
                'success'
            );

            // Re-render to rebuild the VM and drop the character
            // if they no longer have any instructor classes.
            render(_container);
        });
    }

    // ============================================================
    // UTILITIES
    // ============================================================

    function cssEscape(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value).replace(/(["\\])/g, '\\$1');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyInstructorRepairView = Object.freeze({
        render: render,
        unmount: unmount
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyInstructorRepairView;
        var missing = [];

        var required = ['render', 'unmount'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyInstructorRepairView] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
