/**
 * js/modules/characters/character-events.js - Character Events
 * Path: js/modules/characters/character-events.js
 *
 * WHAT THIS OWNS:
 *   - Delegated event wiring for the character form, list, and
 *     modals.
 *   - The career-transition inline modal (open, render, apply,
 *     close).
 *   - Save / delete / character-select handlers.
 *   - Character list selection checkboxes.
 *   - JSON import/export buttons (delegates to CharacterJSONIO).
 *   - Professional stint End / Remove buttons on the character
 *     Professional tab (delegates to TeamCore).
 *
 * WHAT THIS DOES NOT OWN:
 *   - Domain logic. All character mutations route through
 *     CharacterCRUD. Team mutations route through TeamCore.
 *   - Rendering. All HTML comes from CharacterForm / CharacterViews
 *     / CharacterClassView / CharacterList.
 *   - The relationship form. Delegates to SocialEvents.
 *   - The JSON import/export mechanics. CharacterJSONIO owns those.
 *
 * PROFESSIONAL STINT ACTIONS (this revision):
 *   The character Professional tab renders one row per
 *   professional stint, each carrying data-team-id and
 *   data-join-period. Open stints also carry End and Remove
 *   buttons. This module dispatches:
 *
 *     end-professional-stint     -> TeamCore.endMemberInterval
 *     remove-professional-stint  -> TeamCore.purgeMemberInterval
 *
 *   After either succeeds, the character form re-renders so the
 *   tab reflects the new state, and TeamEvents.refreshUI() is
 *   called (when available) so a subsequent visit to the Teams
 *   tab shows the same change.
 *
 *   End prompts for a year. There is no inline modal for it; the
 *   prompt is intentional, matching the pattern used by the
 *   mission log and report actions.
 *
 * RELATIONSHIP MODAL OWNERSHIP:
 *   The character-tab relationship form was retired. Opening the
 *   relationship modal from the character tab now delegates to
 *   SocialEvents.handleAddRelationship.
 *
 * MODAL LIFECYCLE:
 *   Reusable modals (relationship, graph) use Modal.hideModal, not
 *   Modal.closeModal.
 *
 * SAVE RE-ENTRANCY:
 *   handleSave() is guarded by _saveInFlight.
 *
 * JSON IMPORT/EXPORT:
 *   #export-character-json-btn  exports the current character's
 *                               full raw record to a JSON file.
 *   #import-character-json-btn  opens a file picker and fills the
 *                               form from the selected JSON.
 *
 *   The import confirms before overwriting when a character is
 *   currently selected, because it will replace whatever the user
 *   has typed into the form. It does NOT save. The user reviews
 *   and clicks Save.
 *
 *   Both buttons live on the character form's action row (see
 *   character-form.js getCharacterFormHTML). They are only
 *   rendered when a character is being edited. The import button
 *   is also rendered on the "New Character" screen, since
 *   importing into an empty form is the primary use case.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterAggregator
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.CharacterForm
 *   - window.CharacterClassView
 *   - window.CharacterGenerator
 *   - window.AcademyClasses
 *   - window.CharacterStats
 *   - window.CharacterMoves
 *   - window.CharacterStatsView
 *   - window.CharacterViews
 *   - window.CharacterConstants
 *   - window.MagicConstants
 *   - window.FormUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (MANDATORY AT CALL TIME, WARN-ONLY AT BOOT):
 *   - window.UI_CONSTANTS.MOBILE_BREAKPOINT
 *   - window.SocialEvents (for relationship modal delegation)
 *   - window.CharacterJSONIO (for JSON import/export buttons)
 *   - window.TeamCore (for professional stint End / Remove)
 *   - window.TeamQueries (for stint resolution)
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.CharacterList
 *   - window.SocialConstants / SocialQueries / SocialCore / SocialGraph
 *   - window.CharacterExport
 *   - window.FillerManagerModal
 *   - window.CharacterRosterExport
 *   - window.CareerStatusWizard
 *   - window.TeamQueries
 *   - window.AcademyEliminations
 *   - window.TeamEvents (refresh after stint mutations)
 */

(function() {
    'use strict';

    if (window.__characterEventsLoaded) {
        return;
    }
    window.__characterEventsLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterAggregator = window.CharacterAggregator;
    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var CharacterForm = window.CharacterForm;
    var CharacterClassView = window.CharacterClassView;
    var CharacterGenerator = window.CharacterGenerator;
    var AcademyClasses = window.AcademyClasses;
    var CharacterStats = window.CharacterStats;
    var CharacterMoves = window.CharacterMoves;
    var CharacterStatsView = window.CharacterStatsView;
    var CharacterViews = window.CharacterViews;
    var CharacterConstants = window.CharacterConstants;
    var MagicConstants = window.MagicConstants;
    var FormUtils = window.FormUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var UI_CONSTANTS = window.UI_CONSTANTS;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];
    var _filterDebounceTimer = null;
    var _socialCoreInitialized = false;
    var _characterEditListenerInstalled = false;
    var _saveInFlight = false;

    var _ctModal = null;
    var _ctContentEl = null;
    var _ctCharId = null;
    var _ctState = { status: 'retired', year: 0 };
    var _ctClickHandler = null;
    var _ctChangeHandler = null;
    var _ctInputHandler = null;

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getAcademyEliminations() { return window.AcademyEliminations || null; }
    function getCharacterExport() { return window.CharacterExport || null; }
    function getFillerManagerModal() { return window.FillerManagerModal || null; }
    function getCharacterRosterExport() { return window.CharacterRosterExport || null; }
    function getCareerStatusWizard() { return window.CareerStatusWizard || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getTeamCore() { return window.TeamCore || null; }
    function getTeamEvents() { return window.TeamEvents || null; }
    function getCharacterList() { return window.CharacterList || null; }
    function getSocialEvents() { return window.SocialEvents || null; }
    function getSocialQueries() { return window.SocialQueries || null; }
    function getCharacterJSONIO() { return window.CharacterJSONIO || null; }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        ['getCurrentEditId', 'setCurrentEditId', 'toggleCharacterList']
            .forEach(function(name) {
                if (typeof window[name] !== 'function') {
                    missing.push(name);
                }
            });

        var required = [
            [CharacterAggregator, 'getCharacterDetail'],
            [CharacterQueries, 'getCharacterById'],
            [CharacterCRUD, 'save'],
            [CharacterForm, 'render'],
            [CharacterForm, 'collect'],
            [CharacterForm, 'addCareerEntryRow'],
            [CharacterForm, 'addWeaponRow'],
            [CharacterClassView, 'renderAcademicTab'],
            [CharacterGenerator, 'generatePhysical'],
            [AcademyClasses, 'addClassByName'],
            [CharacterStats, 'rollPhysicalStats'],
            [CharacterMoves, 'addSpecialMove'],
            [CharacterMoves, 'removeSpecialMove'],
            [CharacterStatsView, 'populateMagicalFields'],
            [CharacterConstants, 'getPhysicalClasses'],
            [MagicConstants, 'getTypeKeys'],
            [FormUtils, 'setField'],
            [NotificationSystem, 'notify']
        ];

        required.forEach(function(pair) {
            if (!pair[0] || typeof pair[0][pair[1]] !== 'function') {
                missing.push(pair[0] ? pair[0].__name || pair[1] : pair[1]);
            }
        });

        if (!UI_CONSTANTS ||
            typeof UI_CONSTANTS.MOBILE_BREAKPOINT !== 'number') {
            console.warn(
                '[CharacterEvents] UI_CONSTANTS.MOBILE_BREAKPOINT ' +
                'is missing; falling back to 768px.'
            );
        }

        if (!window.SocialEvents ||
            typeof window.SocialEvents.handleAddRelationship !== 'function') {
            console.warn(
                '[CharacterEvents] SocialEvents not loaded — ' +
                'Add Relationship from the character tab will fail ' +
                'until the social module is available.'
            );
        }

        if (!window.CharacterJSONIO ||
            typeof window.CharacterJSONIO.handleExportCurrent !== 'function' ||
            typeof window.CharacterJSONIO.handleImportIntoForm !== 'function') {
            console.warn(
                '[CharacterEvents] CharacterJSONIO not loaded — ' +
                'JSON import/export buttons will be inactive.'
            );
        }

        if (!window.TeamCore ||
            typeof window.TeamCore.endMemberInterval !== 'function' ||
            typeof window.TeamCore.purgeMemberInterval !== 'function') {
            console.warn(
                '[CharacterEvents] TeamCore is not loaded — ' +
                'End / Remove buttons on professional stints will ' +
                'not work.'
            );
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterEvents] Missing required dependencies:',
                missing.join(', ')
            );
            return false;
        }
        return true;
    }

    // ============================================================
    // SIDEBAR DRAWER HELPERS
    // ============================================================

    function getSidebar() {
        var container = document.getElementById('tab-characters');
        if (!container) { return null; }
        return container.querySelector('.characters-sidebar');
    }

    function isMobile() {
        var bp = (UI_CONSTANTS &&
                  typeof UI_CONSTANTS.MOBILE_BREAKPOINT === 'number')
            ? UI_CONSTANTS.MOBILE_BREAKPOINT
            : 768;
        return window.innerWidth < bp;
    }

    function openSidebar() {
        if (!isMobile()) { return; }
        var sidebar = getSidebar();
        if (sidebar) { sidebar.classList.add('open'); }
    }

    function closeSidebar() {
        if (!isMobile()) { return; }
        var sidebar = getSidebar();
        if (sidebar) { sidebar.classList.remove('open'); }
    }

    function toggleSidebar() {
        var sidebar = getSidebar();
        if (!sidebar) { return; }
        sidebar.classList.toggle('open');
    }

    // ============================================================
    // SOCIAL CORE INIT
    // ============================================================

    function ensureSocialCoreInitialized() {
        if (_socialCoreInitialized) { return true; }

        if (!window.SocialCore ||
            typeof window.SocialCore.init !== 'function') {
            return false;
        }
        if (!window.CharacterQueries ||
            typeof window.CharacterQueries.getCharacterById !==
            'function') {
            return false;
        }

        var characterProvider = {
            exists: function(id) {
                if (!id) { return false; }
                var char = window.CharacterQueries.getCharacterById(id);
                return char !== null && char !== undefined;
            }
        };

        try {
            var result = window.SocialCore.init({
                characterProvider: characterProvider
            });
            if (result !== false) {
                _socialCoreInitialized = true;
                return true;
            }
            return false;
        } catch (e) {
            console.warn(
                '[CharacterEvents] SocialCore.init failed:', e
            );
            return false;
        }
    }

    // ============================================================
    // NOTIFY
    // ============================================================

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // UI REFRESH (READ-ONLY)
    // ============================================================

    function refreshUI(char) {
        if (window.CharacterList &&
            typeof window.CharacterList.render === 'function') {
            try { window.CharacterList.render(); } catch (e) {}
        }

        var academicContainer =
            document.getElementById('academic-class-view');
        if (academicContainer &&
            CharacterClassView &&
            typeof CharacterClassView.renderAcademicTab === 'function') {
            try {
                CharacterClassView.renderAcademicTab(
                    char, academicContainer
                );
            } catch (e) {
                console.warn(
                    '[CharacterEvents] renderAcademicTab failed:', e
                );
            }
        }

        if (typeof window.updateDashboardStats === 'function') {
            try { window.updateDashboardStats(); } catch (e) {}
        }
    }

    // ============================================================
    // ESCAPE HELPERS
    // ============================================================

    function escapeHtmlSafe(value) {
        if (window.DomUtils &&
            typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (window.DomUtils &&
            typeof window.DomUtils.escapeAttribute === 'function') {
            return window.DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // JSON IMPORT / EXPORT
    // ============================================================

    function bindJsonImportExport() {
        addSafeDelegatedListener(
            '#export-character-json-btn',
            'click',
            function(e) {
                e.preventDefault();
                handleCharacterJsonExport();
            }
        );

        addSafeDelegatedListener(
            '#import-character-json-btn',
            'click',
            function(e) {
                e.preventDefault();
                handleCharacterJsonImport();
            }
        );
    }

    function handleCharacterJsonExport() {
        var JsonIo = getCharacterJSONIO();
        if (!JsonIo ||
            typeof JsonIo.handleExportCurrent !== 'function') {
            notify('JSON export is not available.', 'error');
            return;
        }

        try {
            JsonIo.handleExportCurrent();
        } catch (err) {
            console.warn(
                '[CharacterEvents] JSON export threw:', err
            );
            notify(
                'JSON export failed: ' + err.message,
                'error'
            );
        }
    }

    function handleCharacterJsonImport() {
        var JsonIo = getCharacterJSONIO();
        if (!JsonIo ||
            typeof JsonIo.handleImportIntoForm !== 'function') {
            notify('JSON import is not available.', 'error');
            return;
        }

        // Confirm only when we are overwriting a saved character's
        // form. Importing into the "New Character" screen is the
        // primary use case and does not need a confirm.
        var editId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;

        if (editId) {
            var char = CharacterQueries.getCharacterById(editId);
            var name = char
                ? CharacterQueries.getDisplayName(char)
                : 'this character';

            if (!confirm(
                'Importing will replace the form fields for "' +
                name + '". The stored record will not change until ' +
                'you click Save. Continue?'
            )) {
                return;
            }
        }

        try {
            JsonIo.handleImportIntoForm();
        } catch (err) {
            console.warn(
                '[CharacterEvents] JSON import threw:', err
            );
            notify(
                'JSON import failed: ' + err.message,
                'error'
            );
        }
    }

    // ============================================================
    // CHARACTER REPORT EXPORT
    // ============================================================

    function refreshCharacterReportButton() {
        var btn = document.getElementById(
            'export-character-report-btn'
        );
        if (!btn) { return; }

        var editId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;

        var Ce = getCharacterExport();
        var available = Ce !== null &&
            typeof Ce.exportCharacterText === 'function';

        var enabled = available &&
            editId !== null &&
            editId !== undefined &&
            editId !== '';

        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '1' : '0.5';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }

    function handleCharacterReportExport() {
        var editId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;

        if (!editId) {
            notify('Select a character first.', 'error');
            return;
        }

        var Ce = getCharacterExport();
        if (!Ce ||
            typeof Ce.exportCharacterText !== 'function') {
            notify('Character report export not available.', 'error');
            return;
        }

        var result;
        try {
            result = Ce.exportCharacterText(editId);
        } catch (err) {
            console.warn(
                '[CharacterEvents] exportCharacterText threw:', err
            );
            notify(
                'Character report export failed: ' + err.message,
                'error'
            );
            return;
        }

        if (result && result.exported) {
            notify(
                'Character report exported: ' + result.filename,
                'success'
            );
            return;
        }

        notify(
            'Character report export failed: ' +
                ((result && result.error) || 'Unknown error'),
            'error'
        );
    }

    function bindCharacterReportExport() {
        addSafeDelegatedListener(
            '#export-character-report-btn',
            'click',
            function(e) {
                e.preventDefault();
                handleCharacterReportExport();
            }
        );
    }

    // ============================================================
    // PROFESSIONAL STINT ACTIONS
    // ============================================================
    //
    // The character Professional tab renders one row per
    // professional stint. Each row carries data-team-id and
    // data-join-period. Open stints carry End and Remove.
    //
    // Both handlers read the (teamId, joinPeriod) pair off the
    // button, call the TeamCore mutation, then re-render the
    // character form. TeamEvents.refreshUI is called afterwards
    // when available so a subsequent visit to the Teams tab shows
    // the same change.

    function bindProfessionalStintActions() {
        addSafeDelegatedListener(
            '[data-action="end-professional-stint"]',
            'click',
            function(e, target) {
                e.preventDefault();
                e.stopPropagation();
                handleEndProfessionalStint(target);
            }
        );

        addSafeDelegatedListener(
            '[data-action="remove-professional-stint"]',
            'click',
            function(e, target) {
                e.preventDefault();
                e.stopPropagation();
                handleRemoveProfessionalStint(target);
            }
        );
    }

    function readStintIdentity(buttonEl) {
        if (!buttonEl || !buttonEl.dataset) { return null; }

        var teamId = buttonEl.dataset.teamId;
        var joinPeriod = buttonEl.dataset.joinPeriod;

        if (!teamId || !joinPeriod) { return null; }

        return {
            teamId: String(teamId),
            joinPeriod: String(joinPeriod)
        };
    }

    function resolveCharacterIdForStint() {
        return typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId()
            : null;
    }

    function refreshAfterStintMutation() {
        var charId = resolveCharacterIdForStint();
        if (charId) {
            try {
                CharacterForm.render(charId);
            } catch (err) {
                console.warn(
                    '[CharacterEvents] form re-render after stint ' +
                    'mutation failed:', err
                );
            }

            var char = CharacterQueries.getCharacterById(charId);
            if (char) {
                refreshUI(char);
            }
        }

        var TE = getTeamEvents();
        if (TE && typeof TE.refreshUI === 'function') {
            try { TE.refreshUI(); } catch (e) { /* ignore */ }
        }
    }

    function handleEndProfessionalStint(buttonEl) {
        var identity = readStintIdentity(buttonEl);
        if (!identity) {
            notify('Could not identify the stint to end.', 'error');
            return;
        }

        var charId = resolveCharacterIdForStint();
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        var TeamCore = getTeamCore();
        if (!TeamCore ||
            typeof TeamCore.endMemberInterval !== 'function') {
            notify('Team module is not available.', 'error');
            return;
        }

        var raw = window.prompt(
            'End this stint in which year?\n' +
            '(join year: ' + identity.joinPeriod + ')',
            ''
        );

        if (raw === null) { return; }

        var trimmed = String(raw).trim();
        if (trimmed === '') {
            notify('A year is required.', 'error');
            return;
        }

        var yearNum = parseInt(trimmed, 10);
        if (isNaN(yearNum) || yearNum < 1) {
            notify('Enter a positive year.', 'error');
            return;
        }

        TeamCore.endMemberInterval(
            identity.teamId,
            charId,
            identity.joinPeriod,
            String(yearNum)
        ).then(function(result) {
            if (result && result.success) {
                notify(
                    'Stint ended at ' + yearNum + '.',
                    'success'
                );
                refreshAfterStintMutation();
                return;
            }
            notify(
                'Failed to end stint: ' +
                ((result && result.message) || 'Unknown error'),
                'error'
            );
        }).catch(function(err) {
            console.warn(
                '[CharacterEvents] endMemberInterval threw:', err
            );
            notify(
                'Failed to end stint: ' + err.message,
                'error'
            );
        });
    }

    function handleRemoveProfessionalStint(buttonEl) {
        var identity = readStintIdentity(buttonEl);
        if (!identity) {
            notify('Could not identify the stint to remove.', 'error');
            return;
        }

        var charId = resolveCharacterIdForStint();
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        var TeamCore = getTeamCore();
        if (!TeamCore ||
            typeof TeamCore.purgeMemberInterval !== 'function') {
            notify('Team module is not available.', 'error');
            return;
        }

        if (!confirm(
            'Remove this stint (join year ' +
            identity.joinPeriod + ')? ' +
            'The team will no longer show this membership.'
        )) {
            return;
        }

        TeamCore.purgeMemberInterval(
            identity.teamId,
            charId,
            identity.joinPeriod
        ).then(function(result) {
            if (result && result.success) {
                notify('Stint removed.', 'success');
                refreshAfterStintMutation();
                return;
            }
            notify(
                'Failed to remove stint: ' +
                ((result && result.message) || 'Unknown error'),
                'error'
            );
        }).catch(function(err) {
            console.warn(
                '[CharacterEvents] purgeMemberInterval threw:', err
            );
            notify(
                'Failed to remove stint: ' + err.message,
                'error'
            );
        });
    }

    // ============================================================
    // CAREER WIZARD BUTTON
    // ============================================================

    function bindCareerStatusWizard() {
        addSafeDelegatedListener(
            '#career-wizard-btn',
            'click',
            function(e) {
                e.preventDefault();

                var charId =
                    typeof window.getCurrentEditId === 'function'
                        ? window.getCurrentEditId() : null;

                if (!charId) {
                    notify(
                        'Save the character before using the wizard.',
                        'error'
                    );
                    return;
                }

                var Wizard = getCareerStatusWizard();
                if (!Wizard ||
                    typeof Wizard.openModal !== 'function') {
                    notify('Career wizard is not available.', 'error');
                    return;
                }

                var opened = null;
                try {
                    opened = Wizard.openModal(charId);
                } catch (err) {
                    console.warn(
                        '[CharacterEvents] CareerStatusWizard threw:',
                        err
                    );
                    notify(
                        'Career wizard failed: ' + err.message,
                        'error'
                    );
                    return;
                }

                if (!opened) { return; }

                var modalEl = opened;
                var observer = null;

                try {
                    observer = new MutationObserver(function(mutations) {
                        for (var i = 0; i < mutations.length; i++) {
                            var removed = mutations[i].removedNodes;
                            for (var j = 0; j < removed.length; j++) {
                                if (removed[j] === modalEl) {
                                    if (observer) {
                                        observer.disconnect();
                                        observer = null;
                                    }
                                    var current =
                                        typeof window.getCurrentEditId ===
                                        'function'
                                            ? window.getCurrentEditId()
                                            : null;
                                    if (current) {
                                        try {
                                            CharacterForm.render(current);
                                        } catch (renderErr) {
                                            console.warn(
                                                '[CharacterEvents] ' +
                                                'form re-render after ' +
                                                'wizard close failed:',
                                                renderErr
                                            );
                                        }
                                    }
                                    return;
                                }
                            }
                        }
                    });

                    observer.observe(document.body, {
                        childList: true,
                        subtree: false
                    });
                } catch (observerErr) {
                    var poll = setInterval(function() {
                        if (!document.body.contains(modalEl)) {
                            clearInterval(poll);
                            var currentId =
                                typeof window.getCurrentEditId ===
                                'function'
                                    ? window.getCurrentEditId()
                                    : null;
                            if (currentId) {
                                try {
                                    CharacterForm.render(currentId);
                                } catch (pollErr) {
                                    console.warn(
                                        '[CharacterEvents] form ' +
                                        're-render after wizard ' +
                                        'close failed:', pollErr
                                    );
                                }
                            }
                        }
                    }, 250);
                }
            }
        );
    }

    // ============================================================
    // CAREER TRANSITION MODAL
    // ============================================================

    var TRANSITION_STATUSES = [
        {
            value: 'retired',
            label: 'Retired',
            hint: 'Left the roster. No staff role.'
        },
        {
            value: 'support',
            label: 'Support',
            hint: 'Staff role. No longer competing.'
        },
        {
            value: 'instructor',
            label: 'Instructor',
            hint: 'Teaching role. No longer competing.'
        }
    ];

    function getCurrentApplicationYear() {
        if (window.data &&
            typeof window.data.currentYear === 'number' &&
            isFinite(window.data.currentYear) &&
            window.data.currentYear > 0) {
            return Math.floor(window.data.currentYear);
        }
        return new Date().getFullYear();
    }

    function countOpenProfessionalStints(charId, year) {
        var result = { count: 0, teamsTouched: 0 };
        var TeamQueries = getTeamQueries();
        if (!TeamQueries ||
            typeof TeamQueries.getTeams !== 'function' ||
            typeof TeamQueries.getAllTeamMemberRecords !== 'function') {
            return result;
        }

        var teams = [];
        try {
            teams = TeamQueries.getTeams(
                'professional', null, false
            ) || [];
        } catch (e) {
            return result;
        }

        var teamsTouched = Object.create(null);
        var target = String(charId);
        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum)) { return result; }

        for (var t = 0; t < teams.length; t++) {
            var team = teams[t];
            if (!team || !team.id) { continue; }

            var members = [];
            try {
                members = TeamQueries.getAllTeamMemberRecords(team) || [];
            } catch (e) {
                members = [];
            }

            for (var m = 0; m < members.length; m++) {
                var member = members[m];
                if (!member ||
                    String(member.characterId) !== target) {
                    continue;
                }
                if (!Array.isArray(member.intervals)) { continue; }

                for (var iv = 0; iv < member.intervals.length; iv++) {
                    var interval = member.intervals[iv];
                    if (!interval ||
                        typeof interval !== 'object') {
                        continue;
                    }

                    var leave = interval.leavePeriod === undefined ||
                        interval.leavePeriod === null
                        ? ''
                        : String(interval.leavePeriod).trim();
                    if (leave !== '') { continue; }

                    var join = interval.joinPeriod === undefined ||
                        interval.joinPeriod === null
                        ? ''
                        : String(interval.joinPeriod).trim();
                    if (join !== '') {
                        var joinNum = parseInt(join, 10);
                        if (!isNaN(joinNum) && joinNum > yearNum) {
                            continue;
                        }
                    }

                    result.count++;
                    teamsTouched[String(team.id)] = true;
                }
            }
        }

        result.teamsTouched = Object.keys(teamsTouched).length;
        return result;
    }

    function buildCareerTransitionFormHTML(charName) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Career Transition \u2014 ' +
                    escapeHtmlSafe(charName) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-ct-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body career-wizard-body">';

        html += '<p class="field-hint" ' +
                    'style="font-size:0.75rem;color:var(--text-dim);' +
                    'margin:0;line-height:1.45;">' +
                    'Mark this character as having left the active ' +
                    'roster. Their open professional-team stints will ' +
                    'end at the chosen year.' +
                '</p>';

        html += '<div class="csw-field">';
        html += '<label>Status</label>';

        for (var i = 0; i < TRANSITION_STATUSES.length; i++) {
            var s = TRANSITION_STATUSES[i];
            var checked = _ctState.status === s.value
                ? ' checked' : '';
            html += '<label class="csw-radio-row">';
            html += '<input type="radio" name="ct-status" ' +
                        'value="' + escapeAttribute(s.value) + '"' +
                        checked + '>';
            html += '<span><strong>' + escapeHtmlSafe(s.label) +
                    '</strong> \u2014 ' +
                    escapeHtmlSafe(s.hint) + '</span>';
            html += '</label>';
        }

        html += '</div>';

        html += '<div class="csw-field">';
        html += '<label for="ct-year">Year</label>';
        html += '<input type="number" id="ct-year" ' +
                    'class="ct-year" min="1" ' +
                    'value="' +
                        escapeAttribute(String(_ctState.year)) +
                    '">';
        html += '</div>';

        html += '<div id="ct-preview-region"></div>';

        html += '</div>';

        html += '<div class="modal-footer csw-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-ct-action="close">Cancel</button>';
        html += '<span class="csw-footer-spacer"></span>';
        html += '<button type="button" class="primary" ' +
                    'data-ct-action="apply">' +
                    'Apply' +
                '</button>';
        html += '</div>';

        return html;
    }

    function buildCareerTransitionPreviewHTML() {
        var counts = countOpenProfessionalStints(
            _ctCharId, _ctState.year
        );

        var html = '';
        html += '<div class="csw-preview">';
        html += '<div class="csw-preview-header">Preview</div>';

        if (counts.count === 0) {
            html += '<p class="csw-note">' +
                        'No open professional stints for this ' +
                        'character at year ' +
                        escapeHtmlSafe(String(_ctState.year)) +
                        '. The career status will still be set.' +
                    '</p>';
        } else {
            html += '<div class="csw-warning">';
            html += '<span class="csw-warning-icon">\u26a0</span>';
            html += '<span>This will end <strong>' + counts.count +
                    '</strong> open professional stint' +
                    (counts.count === 1 ? '' : 's') +
                    ' across <strong>' + counts.teamsTouched +
                    '</strong> team' +
                    (counts.teamsTouched === 1 ? '' : 's') +
                    ' at year ' +
                    escapeHtmlSafe(String(_ctState.year)) +
                    '.</span>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderCareerTransitionForm() {
        if (!_ctContentEl) { return; }

        var char = CharacterQueries.getCharacterById(_ctCharId);
        var charName = char
            ? CharacterQueries.getDisplayName(char)
            : 'Unknown';

        _ctContentEl.innerHTML =
            buildCareerTransitionFormHTML(charName);
    }

    function renderCareerTransitionPreview() {
        if (!_ctContentEl) { return; }

        var region = _ctContentEl.querySelector(
            '#ct-preview-region'
        );
        if (!region) { return; }

        region.innerHTML = buildCareerTransitionPreviewHTML();
    }

    function openCareerTransitionModal(charId) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return null;
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            notify('Modal module not available.', 'error');
            return null;
        }

        closeCareerTransitionModal();

        _ctCharId = String(charId);
        _ctState.status = 'retired';
        _ctState.year = getCurrentApplicationYear();

        var shell = Modal.createModal('career-transition-modal');
        if (!shell) {
            notify('Failed to create modal.', 'error');
            _ctCharId = null;
            return null;
        }
        shell.id = 'career-transition-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        shell.appendChild(contentEl);

        _ctModal = shell;
        _ctContentEl = contentEl;

        _ctClickHandler = handleCareerTransitionClick;
        _ctChangeHandler = handleCareerTransitionChange;
        _ctInputHandler = handleCareerTransitionInput;

        contentEl.addEventListener('click', _ctClickHandler);
        contentEl.addEventListener('change', _ctChangeHandler);
        contentEl.addEventListener('input', _ctInputHandler);

        renderCareerTransitionForm();
        renderCareerTransitionPreview();

        Modal.modalSetup(shell, function() {
            closeCareerTransitionModal();
        });
        Modal.showModal(shell);

        setTimeout(function() {
            var yearInput = contentEl.querySelector('#ct-year');
            if (yearInput && typeof yearInput.focus === 'function') {
                try { yearInput.focus(); } catch (e) {}
            }
        }, 50);

        return shell;
    }

    function closeCareerTransitionModal() {
        var modal = _ctModal;
        var contentEl = _ctContentEl;

        if (contentEl && _ctClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _ctClickHandler
                );
            } catch (e) {}
        }
        if (contentEl && _ctChangeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _ctChangeHandler
                );
            } catch (e) {}
        }
        if (contentEl && _ctInputHandler) {
            try {
                contentEl.removeEventListener(
                    'input', _ctInputHandler
                );
            } catch (e) {}
        }

        var charIdAtClose = _ctCharId;

        _ctModal = null;
        _ctContentEl = null;
        _ctCharId = null;
        _ctClickHandler = null;
        _ctChangeHandler = null;
        _ctInputHandler = null;

        if (modal) {
            try { Modal.closeModal(modal); } catch (e) {}
        }

        if (charIdAtClose) {
            var currentId =
                typeof window.getCurrentEditId === 'function'
                    ? window.getCurrentEditId() : null;
            if (currentId &&
                String(currentId) === String(charIdAtClose)) {
                try {
                    CharacterForm.render(currentId);
                } catch (renderErr) {
                    console.warn(
                        '[CharacterEvents] form re-render after ' +
                        'transition close failed:', renderErr
                    );
                }
            }
        }
    }

    function handleCareerTransitionClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var btn = target.closest('[data-ct-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.ctAction;

        if (action === 'close') {
            e.preventDefault();
            closeCareerTransitionModal();
            return;
        }

        if (action === 'apply') {
            e.preventDefault();
            handleCareerTransitionApply();
            return;
        }
    }

    function handleCareerTransitionChange(e) {
        var target = e.target;
        if (!target) { return; }

        if (target.name === 'ct-status') {
            _ctState.status = String(target.value || 'retired');
            renderCareerTransitionPreview();
            return;
        }
    }

    function handleCareerTransitionInput(e) {
        var target = e.target;
        if (!target) { return; }

        if (target.classList &&
            target.classList.contains('ct-year')) {
            var v = parseInt(target.value, 10);
            if (!isNaN(v) && v >= 1) {
                _ctState.year = v;
            }
            renderCareerTransitionPreview();
        }
    }

    function handleCareerTransitionApply() {
        if (!_ctCharId) { return; }

        var charId = _ctCharId;
        var status = _ctState.status;
        var year = _ctState.year;

        if (!status || typeof status !== 'string') {
            notify('Select a status.', 'error');
            return;
        }
        if (typeof year !== 'number' || year < 1) {
            notify('Year must be a positive integer.', 'error');
            return;
        }

        if (!CharacterCRUD ||
            typeof CharacterCRUD.setCareerTransition !== 'function') {
            notify('Career transition is not available.', 'error');
            return;
        }

        CharacterCRUD.setCareerTransition(charId, status, year)
            .then(function(result) {
                if (result && result.success) {
                    closeCareerTransitionModal();
                    return;
                }
                notify(
                    'Career transition failed: ' +
                        ((result && result.message) ||
                            'Unknown error'),
                    'error'
                );
            })
            .catch(function(err) {
                console.warn(
                    '[CharacterEvents] setCareerTransition threw:', err
                );
                notify(
                    'Career transition failed: ' + err.message,
                    'error'
                );
            });
    }

    function bindCareerTransition() {
        addSafeDelegatedListener(
            '#career-transition-btn',
            'click',
            function(e) {
                e.preventDefault();

                var charId =
                    typeof window.getCurrentEditId === 'function'
                        ? window.getCurrentEditId() : null;

                if (!charId) {
                    notify(
                        'Save the character before marking a ' +
                        'transition.',
                        'error'
                    );
                    return;
                }

                try {
                    openCareerTransitionModal(charId);
                } catch (err) {
                    console.warn(
                        '[CharacterEvents] ' +
                        'openCareerTransitionModal threw:', err
                    );
                    notify(
                        'Failed to open career transition: ' +
                            err.message,
                        'error'
                    );
                }
            }
        );
    }

    // ============================================================
    // FILLER MANAGER BUTTON
    // ============================================================

    function bindManageFillers(container) {
        var btn = document.getElementById('manage-fillers-btn');
        if (!btn) { return; }

        addSafeEventListener(btn, 'click', function(e) {
            e.preventDefault();

            var FM = getFillerManagerModal();
            if (!FM || typeof FM.openModal !== 'function') {
                notify(
                    'Filler manager is not available.', 'error'
                );
                return;
            }

            try {
                FM.openModal();
            } catch (err) {
                console.warn(
                    '[CharacterEvents] FillerManagerModal threw:', err
                );
                notify(
                    'Failed to open the filler manager: ' +
                        err.message,
                    'error'
                );
            }
        });
    }

    // ============================================================
    // CHARACTER ROSTER EXPORT BUTTON (legacy — unused)
    // ============================================================

    function bindCharacterRosterExport(container) {
        var btn = document.getElementById(
            'export-character-roster-btn'
        );
        if (!btn) { return; }

        addSafeEventListener(btn, 'click', function(e) {
            e.preventDefault();

            var Exporter = getCharacterRosterExport();
            if (!Exporter ||
                typeof Exporter.exportText !== 'function') {
                notify(
                    'Character roster export is not available.',
                    'error'
                );
                return;
            }

            var result;
            try {
                result = Exporter.exportText();
            } catch (err) {
                console.warn(
                    '[CharacterEvents] CharacterRosterExport threw:',
                    err
                );
                notify(
                    'Character roster export failed: ' + err.message,
                    'error'
                );
                return;
            }

            if (result && result.exported) {
                notify(
                    'Exported ' + result.count + ' character' +
                    (result.count === 1 ? '' : 's') + ': ' +
                    result.filename,
                    'success'
                );
                return;
            }

            notify(
                'Character roster export failed: ' +
                    ((result && result.error) || 'Unknown error'),
                'error'
            );
        });
    }

    // ============================================================
    // LIST-LEVEL EXPORT BUTTON
    // ============================================================

    function bindListExportButton() {
        addSafeDelegatedListener(
            '#export-characters-btn',
            'click',
            function(e) {
                e.preventDefault();

                var Picker = window.CharacterExportPicker || null;
                if (!Picker ||
                    typeof Picker.openModal !== 'function') {
                    notify(
                        'Character export is not available.',
                        'error'
                    );
                    return;
                }

                var CL = getCharacterList();
                var characterIds = null;

                if (CL &&
                    typeof CL.hasSelection === 'function' &&
                    CL.hasSelection() &&
                    typeof CL.getSelectedIds === 'function') {
                    characterIds = CL.getSelectedIds();
                }

                try {
                    Picker.openModal({
                        characterIds: characterIds
                    });
                } catch (err) {
                    console.warn(
                        '[CharacterEvents] ' +
                        'CharacterExportPicker.openModal threw:',
                        err
                    );
                    notify(
                        'Character export failed: ' + err.message,
                        'error'
                    );
                }
            }
        );
    }

    // ============================================================
    // SELECTION: CHECKBOX + CLEAR
    // ============================================================

    function bindListSelection() {
        addSafeDelegatedListener(
            '.char-list-checkbox',
            'change',
            function(e, target) {
                if (e.stopPropagation) {
                    e.stopPropagation();
                }

                var charId = target.dataset
                    ? target.dataset.characterId
                    : null;
                if (!charId) { return; }

                var CL = getCharacterList();
                if (!CL ||
                    typeof CL.toggleSelected !== 'function' ||
                    typeof CL.render !== 'function') {
                    return;
                }

                CL.toggleSelected(charId);
                CL.render();
            }
        );

        addSafeDelegatedListener(
            '.char-list-checkbox-cell',
            'click',
            function(e) {
                if (e.stopPropagation) {
                    e.stopPropagation();
                }
            }
        );

        addSafeDelegatedListener(
            '[data-action="char-clear-selection"]',
            'click',
            function(e) {
                e.preventDefault();
                e.stopPropagation();

                var CL = getCharacterList();
                if (!CL ||
                    typeof CL.clearSelection !== 'function' ||
                    typeof CL.render !== 'function') {
                    return;
                }

                CL.clearSelection();
                CL.render();
            }
        );
    }

    // ============================================================
    // CAREER STATUS FILTER TOGGLE
    // ============================================================

    var _careerStatusCollapsed = null;

    function readCareerStatusCollapsedFromDOM() {
        var group = document.getElementById(
            'career-status-filter-group'
        );
        if (!group) { return false; }
        return group.dataset.collapsed === 'true';
    }

    function applyCareerStatusCollapsed(collapsed) {
        var group = document.getElementById(
            'career-status-filter-group'
        );
        var body = document.getElementById('char-status-filter');
        var toggle = document.getElementById(
            'career-status-filter-toggle'
        );
        if (!group || !body || !toggle) { return; }

        group.dataset.collapsed = collapsed ? 'true' : 'false';
        toggle.setAttribute(
            'aria-expanded', collapsed ? 'false' : 'true'
        );

        body.style.display = collapsed ? 'none' : 'grid';

        var caret = toggle.querySelector('.status-filter-caret');
        if (caret) {
            caret.textContent = collapsed ? '\u25b8' : '\u25be';
        }
    }

    function bindCareerStatusToggle() {
        addSafeDelegatedListener(
            '#career-status-filter-toggle',
            'click',
            function(e) {
                e.preventDefault();

                if (_careerStatusCollapsed === null) {
                    _careerStatusCollapsed =
                        readCareerStatusCollapsedFromDOM();
                }

                _careerStatusCollapsed = !_careerStatusCollapsed;
                applyCareerStatusCollapsed(
                    _careerStatusCollapsed
                );
            }
        );
    }

    // ============================================================
    // SAFE EVENT BINDING
    // ============================================================

    function addSafeEventListener(
        element, eventName, handler, options
    ) {
        if (!element) { return; }
        element.addEventListener(
            eventName, handler, options || false
        );
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function addSafeDelegatedListener(
        selector, eventName, handler
    ) {
        function wrappedHandler(e) {
            var target = e.target.closest
                ? e.target.closest(selector)
                : null;
            if (!target) { return; }
            handler(e, target);
        }

        document.addEventListener(eventName, wrappedHandler);
        _eventListeners.push({
            element: document,
            eventName: eventName,
            handler: wrappedHandler,
            options: false
        });
    }

    function removeAllEventListeners() {
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(
                    item.eventName,
                    item.handler,
                    item.options
                );
            } catch (e) {}
        });
        _eventListeners = [];

        clearTimeout(_filterDebounceTimer);
        _filterDebounceTimer = null;
    }

    // ============================================================
    // CHARACTER EDIT EVENT
    // ============================================================

    function installCharacterEditListener() {
        if (_characterEditListenerInstalled) { return; }
        _characterEditListenerInstalled = true;

        document.addEventListener('characterEdit', function(e) {
            var charId = e && e.detail ? e.detail.characterId : null;
            if (!charId) { return; }

            var char = CharacterQueries.getCharacterById(charId);
            if (!char) {
                notify('Character not found.', 'error');
                return;
            }

            if (typeof window.setCurrentEditId === 'function') {
                window.setCurrentEditId(charId);
            }

            CharacterForm.render(charId);
            refreshUI(char);
            refreshCharacterReportButton();

            var formContainer = document.getElementById(
                'character-form-container'
            );
            if (formContainer) {
                setTimeout(function() {
                    formContainer.scrollIntoView({
                        block: 'nearest',
                        behavior: 'smooth'
                    });
                }, 100);
            }

            closeSidebar();
        });
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (!checkDependencies()) {
            console.warn(
                '[CharacterEvents] Dependencies not met, ' +
                'skipping initialization'
            );
            return;
        }

        if (_initialized) { destroy(); }

        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) {
            console.warn('[CharacterEvents] Container not found');
            return;
        }

        removeAllEventListeners();
        ensureSocialCoreInitialized();
        installCharacterEditListener();

        bindToggleList(container);
        bindAddCharacter(container);
        bindFormSubmit(container);
        bindDeleteButton(container);
        bindFilters(container);
        bindClickOutside(container);
        bindCharacterList(container);
        bindListSelection();
        bindListExportButton();
        bindManageFillers(container);
        bindCharacterRosterExport(container);

        bindTabSwitching();
        bindCancelButton();
        bindDeceasedToggle();
        bindBirthYearListener();
        bindRandomButtons();
        bindFieldRandomButtons();
        bindPreviousNameButtons();
        bindCareerButtons();
        bindCareerStatusWizard();
        bindCareerTransition();
        bindClassDropdown();
        bindClassTagRemoval();
        bindStandaloneElimRemoval();
        bindCharacterReportExport();
        bindCareerStatusToggle();

        bindCombatRollButtons();
        bindCombatClassOverrides();
        bindCombatLiveUpdates();
        bindWeaponButtons();
        bindSpecialMoveButtons();

        bindSocialButtons();

        // JSON import / export buttons on the character form
        // action row.
        bindJsonImportExport();

        // Professional stint End / Remove buttons on the
        // Professional tab.
        bindProfessionalStintActions();

        _initialized = true;

        refreshCharacterReportButton();

        if (_careerStatusCollapsed !== null) {
            applyCareerStatusCollapsed(_careerStatusCollapsed);
        }
    }

    function destroy() {
        closeCareerTransitionModal();
        removeAllEventListeners();
        closeSidebar();
        _initialized = false;
        _saveInFlight = false;
        _careerStatusCollapsed = null;
    }

    // ============================================================
    // STATIC BINDINGS
    // ============================================================

    function bindToggleList(container) {
        var toggleBtn = document.getElementById('toggle-char-list');
        if (toggleBtn) {
            addSafeEventListener(toggleBtn, 'click', function(e) {
                e.stopPropagation();
                toggleSidebar();
            });
        }
    }

    function bindAddCharacter(container) {
        var addBtn = document.getElementById('add-character-btn');
        if (addBtn) {
            addSafeEventListener(addBtn, 'click', function() {
                if (typeof window.setCurrentEditId === 'function') {
                    window.setCurrentEditId(null);
                }
                CharacterForm.render(null);
                refreshCharacterReportButton();
                closeSidebar();
            });
        }
    }

    function bindFormSubmit(container) {
        var form = document.getElementById('character-form');
        if (form) {
            addSafeEventListener(form, 'submit', function(e) {
                e.preventDefault();
                handleSave();
            });
        }
    }

    function bindDeleteButton(container) {
        addSafeDelegatedListener(
            '#delete-char-btn',
            'click',
            function(e) {
                e.preventDefault();
                var id =
                    typeof window.getCurrentEditId === 'function'
                        ? window.getCurrentEditId() : null;
                if (id) { handleDelete(id); }
            }
        );
    }

    function bindFilters(container) {
        var nameFilter = document.getElementById('char-name-filter');
        if (nameFilter) {
            addSafeEventListener(nameFilter, 'input', function() {
                clearTimeout(_filterDebounceTimer);
                _filterDebounceTimer = setTimeout(function() {
                    if (window.CharacterList &&
                        typeof window.CharacterList.render ===
                        'function') {
                        window.CharacterList.render();
                    }
                }, UI_CONSTANTS.DEBOUNCE_DELAY || 300);
            });
        }

        var classFilter = document.getElementById('char-class-filter');
        if (classFilter) {
            addSafeEventListener(classFilter, 'change', function() {
                if (window.CharacterList &&
                    typeof window.CharacterList.render ===
                    'function') {
                    window.CharacterList.render();
                }
            });
        }

        var sortFilter = document.getElementById('char-sort');
        if (sortFilter) {
            addSafeEventListener(sortFilter, 'change', function() {
                if (window.CharacterList &&
                    typeof window.CharacterList.setSort ===
                    'function') {
                    window.CharacterList.setSort(
                        sortFilter.value
                    );
                    return;
                }
                if (window.CharacterList &&
                    typeof window.CharacterList.render ===
                    'function') {
                    window.CharacterList.render();
                }
            });
        }

        var statusFilter = document.getElementById(
            'char-status-filter'
        );
        if (statusFilter) {
            addSafeEventListener(
                statusFilter,
                'change',
                function(e) {
                    var target = e.target;
                    if (!target || !target.dataset) { return; }
                    if (target.dataset.status === undefined) {
                        return;
                    }
                    if (window.CharacterList &&
                        typeof window.CharacterList.render ===
                        'function') {
                        window.CharacterList.render();
                    }
                }
            );
        }

        var hideDeceased = document.getElementById('hide-deceased');
        if (hideDeceased) {
            addSafeEventListener(hideDeceased, 'change', function() {
                if (window.CharacterList &&
                    typeof window.CharacterList.render ===
                    'function') {
                    window.CharacterList.render();
                }
            });
        }

        var hideEliminated = document.getElementById(
            'hide-eliminated'
        );
        if (hideEliminated) {
            addSafeEventListener(
                hideEliminated,
                'change',
                function() {
                    if (window.CharacterList &&
                        typeof window.CharacterList.render ===
                        'function') {
                        window.CharacterList.render();
                    }
                }
            );
        }

        var hideFiller = document.getElementById('hide-filler');
        if (hideFiller) {
            addSafeEventListener(hideFiller, 'change', function() {
                if (window.CharacterList &&
                    typeof window.CharacterList.setHideFiller ===
                    'function') {
                    window.CharacterList.setHideFiller(
                        hideFiller.checked
                    );
                    return;
                }
                if (window.CharacterList &&
                    typeof window.CharacterList.render ===
                    'function') {
                    window.CharacterList.render();
                }
            });
        }

        var clearFilter = document.getElementById('clear-char-filter');
        if (clearFilter) {
            addSafeEventListener(clearFilter, 'click', function() {
                var nameEl =
                    document.getElementById('char-name-filter');
                var classEl =
                    document.getElementById('char-class-filter');
                var hideDeadEl =
                    document.getElementById('hide-deceased');
                var hideElimEl =
                    document.getElementById('hide-eliminated');

                if (nameEl) { nameEl.value = ''; }
                if (classEl) { classEl.value = 'all'; }
                if (hideDeadEl) { hideDeadEl.checked = true; }
                if (hideElimEl) { hideElimEl.checked = true; }

                if (window.CharacterList &&
                    typeof window.CharacterList.setHideFiller ===
                    'function') {
                    window.CharacterList.setHideFiller(true);
                }

                var statusBoxes = document.querySelectorAll(
                    '#char-status-filter ' +
                    'input[type="checkbox"][data-status]'
                );
                for (var i = 0; i < statusBoxes.length; i++) {
                    statusBoxes[i].checked = false;
                }

                if (window.CharacterList &&
                    typeof window.CharacterList.render ===
                    'function') {
                    window.CharacterList.render();
                }
            });
        }
    }

    function bindClickOutside(container) {
        addSafeEventListener(document, 'click', function(e) {
            if (!isMobile()) { return; }

            var sidebar = getSidebar();
            if (!sidebar) { return; }
            if (!sidebar.classList.contains('open')) { return; }

            var toggle = document.getElementById(
                'toggle-char-list'
            );

            var clickedOutsideSidebar =
                !sidebar.contains(e.target);
            var clickedToggle =
                toggle && toggle.contains(e.target);

            if (clickedOutsideSidebar && !clickedToggle) {
                sidebar.classList.remove('open');
            }
        });
    }

    function bindCharacterList(container) {
        addSafeDelegatedListener(
            '.char-list-item',
            'click',
            function(e, target) {
                var t = e.target;
                if (t && typeof t.closest === 'function' &&
                    t.closest('.char-list-checkbox-cell')) {
                    return;
                }

                var id = target.dataset.id;
                if (id) { handleCharacterSelect(id); }
            }
        );
    }

    // ============================================================
    // DELEGATED BINDINGS
    // ============================================================

    function bindTabSwitching() {
        addSafeDelegatedListener(
            '.form-tab-btn',
            'click',
            function(e, target) {
                var tab = target.dataset.tab;
                if (tab) { CharacterForm.switchTab(tab); }
            }
        );
    }

    function bindCancelButton() {
        addSafeDelegatedListener(
            '#cancel-character-form',
            'click',
            function() {
                var editId =
                    typeof window.getCurrentEditId === 'function'
                        ? window.getCurrentEditId() : null;
                if (editId) {
                    CharacterForm.render(editId);
                } else {
                    CharacterForm.hide();
                    if (typeof window.setCurrentEditId ===
                        'function') {
                        window.setCurrentEditId(null);
                    }
                    refreshCharacterReportButton();
                }
            }
        );
    }

    function bindDeceasedToggle() {
        addSafeDelegatedListener(
            '#char-deceased',
            'change',
            function(e, target) {
                var deathFields =
                    document.getElementById('death-fields');
                if (deathFields) {
                    deathFields.style.display = target.checked
                        ? 'block' : 'none';
                }
                if (CharacterForm &&
                    typeof CharacterForm.applyDeceasedState ===
                    'function') {
                    CharacterForm.applyDeceasedState(
                        target.checked
                    );
                }
            }
        );
    }

    function bindBirthYearListener() {
        addSafeDelegatedListener(
            '#char-birthYear',
            'input',
            function(e, target) {
                var ageField = document.getElementById('char-age');
                if (!ageField) { return; }

                var by = parseInt(target.value, 10);
                if (isNaN(by)) {
                    ageField.value = '';
                    return;
                }

                var currentYear =
                    (window.data &&
                     typeof window.data.currentYear === 'number')
                        ? window.data.currentYear
                        : new Date().getFullYear();

                ageField.value = String(currentYear - by);
            }
        );
    }

    function bindRandomButtons() {
        addSafeDelegatedListener(
            '#random-physical-btn',
            'click',
            function(e) {
                e.preventDefault();
                fillRandomPhysical();
            }
        );
        addSafeDelegatedListener(
            '#random-personality-btn',
            'click',
            function(e) {
                e.preventDefault();
                fillRandomPersonality();
            }
        );
    }

    // ============================================================
    // PER-FIELD RANDOM
    // ============================================================

    var PHYSICAL_FIELDS = {
        gender: 'char-gender',
        eyes:   'char-eyes',
        hair:   'char-hair',
        skin:   'char-skin',
        height: 'char-height',
        weight: 'char-weight',
        build:  'char-build'
    };

    var PERSONALITY_FIELDS = {
        traits:        'char-personality-traits',
        ideals:        'char-personality-ideals',
        bonds:         'char-personality-bonds',
        flaws:         'char-personality-flaws',
        alignment:     'char-personality-alignment',
        likes:         'char-personality-likes',
        dislikes:      'char-personality-dislikes',
        habits:        'char-personality-habits',
        fears:         'char-personality-fears',
        goals:         'char-personality-goals',
        authority:     'char-personality-authority',
        conflictStyle: 'char-personality-conflictStyle',
        socialStyle:   'char-personality-socialStyle',
        quirks:        'char-personality-quirks'
    };

    function readCurrentPhysicalFromForm() {
        var FormUtils = window.FormUtils;
        if (!FormUtils ||
            typeof FormUtils.getField !== 'function') {
            return {};
        }
        var physical = {};
        var keys = Object.keys(PHYSICAL_FIELDS);
        for (var i = 0; i < keys.length; i++) {
            var field = keys[i];
            var formId = PHYSICAL_FIELDS[field];
            physical[field] = FormUtils.getField(formId) || '';
        }
        return physical;
    }

    function bindFieldRandomButtons() {
        addSafeDelegatedListener(
            '.field-random-btn',
            'click',
            function(e, target) {
                e.preventDefault();
                e.stopPropagation();

                var field = target.dataset                    ? target.dataset.field : null;
                if (!field) { return; }

                var Generator = window.CharacterGenerator;
                var FormUtils = window.FormUtils;
                if (!Generator || !FormUtils) {
                    notify('Generator not available.', 'error');
                    return;
                }

                if (PHYSICAL_FIELDS[field]) {
                    if (typeof Generator.generatePhysicalField !==
                        'function') {
                        notify(
                            'Generator does not support field ' +
                            'reroll.', 'error'
                        );
                        return;
                    }

                    var current = readCurrentPhysicalFromForm();
                    var newValue = Generator.generatePhysicalField(
                        field, current
                    );

                    if (newValue === null ||
                        newValue === undefined) {
                        return;
                    }

                    FormUtils.setField(
                        PHYSICAL_FIELDS[field], newValue
                    );
                    return;
                }

                if (PERSONALITY_FIELDS[field]) {
                    if (typeof Generator.generatePersonalityField !==
                        'function') {
                        notify(
                            'Generator does not support field ' +
                            'reroll.', 'error'
                        );
                        return;
                    }

                    var newPersonalityValue =
                        Generator.generatePersonalityField(field);
                    if (newPersonalityValue === null ||
                        newPersonalityValue === undefined) {
                        return;
                    }

                    FormUtils.setField(
                        PERSONALITY_FIELDS[field],
                        newPersonalityValue
                    );
                    return;
                }
            }
        );
    }

    function bindPreviousNameButtons() {
        addSafeDelegatedListener(
            '#add-previous-name-btn',
            'click',
            function() {
                var containerEl = document.getElementById(
                    'previous-names-container'
                );
                if (!containerEl) { return; }

                if (CharacterForm &&
                    typeof CharacterForm.addPreviousNameRow ===
                    'function') {
                    CharacterForm.addPreviousNameRow(
                        containerEl, ''
                    );
                }

                var lastRow = containerEl.querySelector(
                    '.previous-name-row:last-child'
                );
                if (lastRow) {
                    var input = lastRow.querySelector(
                        '.previous-name-input'
                    );
                    if (input) { input.focus(); }
                }
            }
        );

        addSafeDelegatedListener(
            '.remove-previous-name',
            'click',
            function(e, target) {
                e.preventDefault();
                var row = target.closest('.previous-name-row');
                if (!row) { return; }

                var parent = row.parentElement;
                if (!parent) { return; }

                if (parent.querySelectorAll(
                    '.previous-name-row'
                ).length <= 1) {
                    var input = row.querySelector(
                        '.previous-name-input'
                    );
                    if (input) { input.value = ''; }
                    return;
                }

                row.remove();
            }
        );

        addSafeDelegatedListener(
            '.previous-name-input',
            'keydown',
            function(e, target) {
                if (e.key !== 'Enter') { return; }
                e.preventDefault();

                var parent = target.closest(
                    '#previous-names-container'
                );
                if (!parent) { return; }

                if (CharacterForm &&
                    typeof CharacterForm.addPreviousNameRow ===
                    'function') {
                    CharacterForm.addPreviousNameRow(parent, '');
                }

                var newRow = parent.querySelector(
                    '.previous-name-row:last-child'
                );
                var currentRow = target.closest(
                    '.previous-name-row'
                );
                if (newRow &&
                    currentRow &&
                    currentRow.parentElement === parent) {
                    currentRow.parentElement.insertBefore(
                        newRow, currentRow.nextSibling
                    );
                }

                if (newRow) {
                    var input = newRow.querySelector(
                        '.previous-name-input'
                    );
                    if (input) { input.focus(); }
                }
            }
        );
    }

    function bindCareerButtons() {
        addSafeDelegatedListener(
            '#add-career-entry-btn',
            'click',
            function(e) {
                e.preventDefault();
                var container = document.getElementById(
                    'career-status-container'
                );
                if (!container) { return; }

                if (CharacterForm &&
                    typeof CharacterForm.addCareerEntryRow ===
                    'function') {
                    CharacterForm.addCareerEntryRow(container);
                }

                var lastRow = container.querySelector(
                    '.career-status-entry:last-child'
                );
                if (lastRow) {
                    var select = lastRow.querySelector(
                        '.career-status-select'
                    );
                    if (select) { select.focus(); }
                }
            }
        );

        addSafeDelegatedListener(
            '.remove-career-entry',
            'click',
            function(e, target) {
                e.preventDefault();
                var row = target.closest('.career-status-entry');
                if (!row) { return; }

                var parent = row.parentElement;
                if (!parent) { return; }

                if (parent.querySelectorAll(
                    '.career-status-entry'
                ).length <= 1) {
                    var select = row.querySelector(
                        '.career-status-select'
                    );
                    var startEl = row.querySelector(
                        '.career-start-year'
                    );
                    var endEl = row.querySelector(
                        '.career-end-year'
                    );
                    var titleEl = row.querySelector('.career-title');
                    if (select) { select.value = ''; }
                    if (startEl) { startEl.value = ''; }
                    if (endEl) { endEl.value = ''; }
                    if (titleEl) { titleEl.value = ''; }
                    return;
                }

                row.remove();
            }
        );
    }

    // ============================================================
    // ACADEMIC TAB
    // ============================================================

    function bindClassDropdown() {
        addSafeDelegatedListener(
            '#academic-class-add-btn',
            'click',
            function(e) {
                e.preventDefault();

                var select = document.getElementById(
                    'academic-class-select'
                );
                if (!select) {
                    notify('Class dropdown not found.', 'error');
                    return;
                }

                var classId = select.value;
                if (!classId) {
                    notify('Please select a class.', 'error');
                    return;
                }

                handleAddClassById(classId);
            }
        );
    }

    function bindClassTagRemoval() {
        addSafeDelegatedListener(
            '.remove-class-tag',
            'click',
            function(e, target) {
                e.stopPropagation();
                var classId = target.dataset.id;
                if (classId) { handleRemoveClass(classId); }
            }
        );
    }

    function bindStandaloneElimRemoval() {
        addSafeDelegatedListener(
            '[data-action="remove-standalone-elim"]',
            'click',
            function(e, target) {
                e.preventDefault();
                e.stopPropagation();
                handleRemoveStandaloneElim(target);
            }
        );
    }

    function handleRemoveStandaloneElim(buttonEl) {
        if (!buttonEl || !buttonEl.dataset) { return; }

        var eliminationId = buttonEl.dataset.eliminationId;
        var charId = buttonEl.dataset.characterId;

        if (!eliminationId) {
            notify('Elimination ID missing.', 'error');
            return;
        }
        if (!charId) {
            charId = typeof window.getCurrentEditId === 'function'
                ? window.getCurrentEditId() : null;
        }
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        var AcademyEliminations = getAcademyEliminations();
        if (!AcademyEliminations ||
            typeof AcademyEliminations.removeStandalone !==
            'function') {
            notify('Elimination module not available.', 'error');
            return;
        }

        if (!confirm('Remove this elimination record? The ' +
            'character will be eligible for future exams again.')) {
            return;
        }

        AcademyEliminations.removeStandalone(charId, eliminationId)
            .then(function(result) {
                if (result && result.success) {
                    var refreshed =
                        CharacterQueries.getCharacterById(charId);
                    refreshUI(refreshed || null);
                } else if (result && result.message) {
                    notify(result.message, 'error');
                }
            })
            .catch(function(err) {
                console.warn(
                    '[CharacterEvents] removeStandalone failed:', err
                );
                notify('Failed to remove elimination.', 'error');
            });
    }

    // ============================================================
    // COMBAT
    // ============================================================

    function bindCombatRollButtons() {
        addSafeDelegatedListener(
            '#roll-stats-btn', 'click', function(e) {
                e.preventDefault();
                handleRollStats();
            }
        );
        addSafeDelegatedListener(
            '#roll-magic-btn', 'click', function(e) {
                e.preventDefault();
                handleRollMagic();
            }
        );
        addSafeDelegatedListener(
            '#roll-hp-btn', 'click', function(e) {
                e.preventDefault();
                handleRollHP();
            }
        );
        addSafeDelegatedListener(
            '#roll-mp-btn', 'click', function(e) {
                e.preventDefault();
                handleRollMP();
            }
        );
    }

    function handleRollStats() {
        if (!CharacterStats ||
            typeof CharacterStats.rollPhysicalStats !== 'function') {
            notify('Stats module not available.', 'error');
            return;
        }

        var rolled = CharacterStats.rollPhysicalStats();
        var statKeys = CharacterStats.STAT_KEYS ||
            ['str', 'dex', 'con', 'int', 'wis', 'cha'];

        statKeys.forEach(function(key) {
            FormUtils.setField('char-stat-' + key, rolled[key]);
            updateStatModifierDisplay(key, rolled[key]);
        });

        updatePhysicalClassDisplayFromInputs();
        notify('Random stats generated!', 'info');
    }

    function handleRollMagic() {
        if (!CharacterStats ||
            typeof CharacterStats.rollMagicalProficiencies !==
            'function') {
            notify('Magic module not available.', 'error');
            return;
        }

        var rolled = CharacterStats.rollMagicalProficiencies();

        if (MagicConstants) {
            MagicConstants.getTypeKeys().forEach(function(type) {
                FormUtils.setField(
                    'char-magic-' + type, rolled[type]
                );
                updateMagicLevelDisplay(type, rolled[type]);
            });
            updateMagicCategoryTotals(rolled);
        }

        updateMagicalClassDisplayFromInputs();
        notify('Random magic generated!', 'info');
    }

    function handleRollHP() {
        if (!CharacterStats ||
            typeof CharacterStats.rollHP !== 'function') {
            notify('Stats module not available.', 'error');
            return;
        }

        var stats = readStatsFromInputs();
        var hp = CharacterStats.rollHP(stats);
        FormUtils.setField('char-hp', hp);
        notify('HP rolled: ' + hp, 'info');
    }

    function handleRollMP() {
        if (!CharacterStats ||
            typeof CharacterStats.rollMP !== 'function') {
            notify('Stats module not available.', 'error');
            return;
        }

        var magic = readMagicFromInputs();
        var mp = CharacterStats.rollMP(magic);
        FormUtils.setField('char-mp', mp);
        notify('MP rolled: ' + mp, 'info');
    }

    function bindCombatClassOverrides() {
        addSafeDelegatedListener(
            '#physical-class-override',
            'change',
            function(e, target) {
                var classId = target.value;
                if (!classId) { return; }

                if (!CharacterStats ||
                    typeof CharacterStats.applyPhysicalClass !==
                    'function') {
                    notify('Stats module not available.', 'error');
                    return;
                }

                var newStats =
                    CharacterStats.applyPhysicalClass(classId);
                if (!newStats) {
                    notify('Could not apply class.', 'error');
                    return;
                }

                var statKeys = CharacterStats.STAT_KEYS ||
                    ['str', 'dex', 'con', 'int', 'wis', 'cha'];
                statKeys.forEach(function(key) {
                    FormUtils.setField(
                        'char-stat-' + key, newStats[key]
                    );
                    updateStatModifierDisplay(key, newStats[key]);
                });

                var displayEl = document.getElementById(
                    'derived-physical-class'
                );
                if (displayEl) {
                    displayEl.textContent =
                        CharacterStats.getPhysicalClassLabel(classId);
                }

                target.value = '';
                notify('Stats rewritten to match class.', 'info');
            }
        );

        addSafeDelegatedListener(
            '#broad-class-override',
            'change',
            function(e, target) {
                var classId = target.value;
                var displayEl = document.getElementById(
                    'derived-broad-class'
                );
                if (!displayEl) { return; }

                if (!classId) {
                    updateMagicalClassDisplayFromInputs();
                    return;
                }

                if (MagicConstants) {
                    var cls = MagicConstants.getBroadClass(classId);
                    if (cls) {
                        displayEl.textContent = cls.label;
                    }
                }
            }
        );

        addSafeDelegatedListener(
            '#fine-class-override',
            'change',
            function(e, target) {
                var classId = target.value;
                if (!classId) { return; }

                if (!CharacterStats ||
                    typeof CharacterStats.applyFineMagicalClass !==
                    'function') {
                    notify('Stats module not available.', 'error');
                    return;
                }

                var currentMagic = readMagicFromInputs();
                var newMagic =
                    CharacterStats.applyFineMagicalClass(
                        classId, currentMagic
                    );
                if (!newMagic) {
                    notify('Could not apply fine class.', 'error');
                    return;
                }

                if (MagicConstants) {
                    MagicConstants.getTypeKeys().forEach(
                        function(type) {
                            FormUtils.setField(
                                'char-magic-' + type,
                                newMagic[type]
                            );
                            updateMagicLevelDisplay(
                                type, newMagic[type]
                            );
                        }
                    );
                    updateMagicCategoryTotals(newMagic);
                }

                updateMagicalClassDisplayFromInputs();
                target.value = '';
                notify(
                    'Proficiency raised to Expert.', 'info'
                );
            }
        );
    }

    function bindCombatLiveUpdates() {
        addSafeDelegatedListener(
            '.stat-input',
            'input',
            function(e, target) {
                var key = target.dataset.statKey;
                if (!key) { return; }
                var value = parseInt(target.value, 10);
                if (isNaN(value)) { return; }
                updateStatModifierDisplay(key, value);
                updatePhysicalClassDisplayFromInputs();
            }
        );

        addSafeDelegatedListener(
            '.magic-input',
            'input',
            function(e, target) {
                var type = target.dataset.magicKey;
                if (!type) { return; }
                var value = parseInt(target.value, 10);
                if (isNaN(value)) { return; }
                updateMagicLevelDisplay(type, value);
                var magic = readMagicFromInputs();
                updateMagicCategoryTotals(magic);
                updateMagicalClassDisplayFromInputs();
            }
        );
    }

    function updateStatModifierDisplay(key, value) {
        var el = document.querySelector(
            '[data-modifier-key="' + key + '"]'
        );
        if (!el) { return; }

        var num = parseInt(value, 10);
        if (isNaN(num)) { num = 10; }

        var modifier = Math.floor((num - 10) / 2);
        var display = (modifier >= 0 ? '+' : '') + modifier;
        el.textContent = display;

        if (modifier > 0) {
            el.style.color = 'var(--accent)';
        } else if (modifier < 0) {
            el.style.color = 'var(--danger)';
        } else {
            el.style.color = 'var(--text-dim)';
        }
    }

    function updateMagicLevelDisplay(type, value) {
        var el = document.querySelector(
            '[data-magic-level="' + type + '"]'
        );
        if (!el) { return; }
        if (!MagicConstants ||
            typeof MagicConstants.getProficiencyLevelLabel !==
            'function') {
            return;
        }
        el.textContent =
            MagicConstants.getProficiencyLevelLabel(value);
    }

    function updateMagicCategoryTotals(magic) {
        if (!MagicConstants) { return; }
        var order = MagicConstants.getCategoryOrder
            ? MagicConstants.getCategoryOrder()
            : ['elemental', 'body', 'aether'];

        order.forEach(function(catId) {
            var types = MagicConstants.getCategoryTypes(catId);
            var total = 0;
            types.forEach(function(t) {
                total += Number(magic[t]) || 0;
            });
            var totalEl = document.querySelector(
                '[data-magic-total="' + catId + '"]'
            );
            if (totalEl) {
                totalEl.textContent = String(total);
            }
        });
    }

    function readStatsFromInputs() {
        var result = {};
        var statKeys = CharacterStats && CharacterStats.STAT_KEYS
            ? CharacterStats.STAT_KEYS
            : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        statKeys.forEach(function(key) {
            var value = parseInt(
                FormUtils.getField('char-stat-' + key), 10
            );
            result[key] = isNaN(value) ? 10 : value;
        });
        return result;
    }

    function readMagicFromInputs() {
        var result = {};
        if (!MagicConstants) { return result; }
        MagicConstants.getTypeKeys().forEach(function(type) {
            var value = parseInt(
                FormUtils.getField('char-magic-' + type), 10
            );
            result[type] = isNaN(value) ? 0 : value;
        });
        return result;
    }

    function updatePhysicalClassDisplayFromInputs() {
        if (!CharacterStats ||
            typeof CharacterStats.derivePhysicalClass !==
            'function') {
            return;
        }

        var stats = readStatsFromInputs();
        var result = CharacterStats.derivePhysicalClass(stats);

        var el = document.getElementById('derived-physical-class');
        if (!el) { return; }

        el.textContent = (result && result.class)
            ? result.class.label : '\u2014';
    }

    function updateMagicalClassDisplayFromInputs() {
        if (!CharacterStats ||
            typeof CharacterStats.deriveMagicalClasses !==
            'function') {
            return;
        }

        var magic = readMagicFromInputs();
        var result = CharacterStats.deriveMagicalClasses(magic);

        var broadEl = document.getElementById('derived-broad-class');
        var fineEl = document.getElementById('derived-fine-class');

        if (broadEl) {
            broadEl.textContent = result.broad
                ? result.broad.label : '\u2014';
        }
        if (fineEl) {
            fineEl.textContent = result.fine
                ? result.fine.label : '\u2014';
        }
    }

    function bindWeaponButtons() {
        addSafeDelegatedListener(
            '#add-weapon-btn',
            'click',
            function(e) {
                e.preventDefault();
                var container = document.getElementById(
                    'weapons-container'
                );
                if (!container) { return; }

                if (CharacterForm &&
                    typeof CharacterForm.addWeaponRow ===
                    'function') {
                    CharacterForm.addWeaponRow(container);
                }

                var lastRow = container.querySelector(
                    '.weapon-entry:last-child'
                );
                if (lastRow) {
                    var nameInput = lastRow.querySelector(
                        '.weapon-name'
                    );
                    if (nameInput) { nameInput.focus(); }
                }
            }
        );

        addSafeDelegatedListener(
            '.remove-weapon',
            'click',
            function(e, target) {
                e.preventDefault();
                var row = target.closest('.weapon-entry');
                if (!row) { return; }
                row.remove();
            }
        );
    }

    function bindSpecialMoveButtons() {
        addSafeDelegatedListener(
            '#add-physical-move-btn',
            'click',
            function(e) {
                e.preventDefault();
                handleAddMove('physical');
            }
        );

        addSafeDelegatedListener(
            '#add-magical-move-btn',
            'click',
            function(e) {
                e.preventDefault();
                handleAddMove('magical');
            }
        );

        addSafeDelegatedListener(
            '.remove-special-move',
            'click',
            function(e, target) {
                e.preventDefault();
                var type = target.dataset.type;
                var moveId = target.dataset.moveId;
                if (!type || !moveId) { return; }
                handleRemoveMove(type, moveId);
            }
        );
    }

    function handleAddMove(type) {
        var charId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        var nameEl = document.getElementById(type + '-move-name');
        var descEl = document.getElementById(type + '-move-desc');

        var name = nameEl ? String(nameEl.value || '').trim() : '';
        var desc = descEl ? String(descEl.value || '').trim() : '';

        if (!name) {
            notify('Move name is required.', 'error');
            return;
        }

        if (!CharacterMoves ||
            typeof CharacterMoves.addSpecialMove !== 'function') {
            notify('Moves module not available.', 'error');
            return;
        }

        CharacterMoves.addSpecialMove(charId, type, name, desc)
            .then(function(result) {
                if (result && result.success) {
                    if (nameEl) { nameEl.value = ''; }
                    if (descEl) { descEl.value = ''; }

                    var char =
                        CharacterQueries.getCharacterById(charId);
                    if (char &&
                        CharacterStatsView &&
                        typeof CharacterStatsView.renderMovesSection ===
                        'function') {
                        CharacterStatsView.renderMovesSection(char);
                    }
                }
            })
            .catch(function() {
                notify('Failed to add move.', 'error');
            });
    }

    function handleRemoveMove(type, moveId) {
        var charId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        if (!confirm('Remove this move?')) { return; }

        if (!CharacterMoves ||
            typeof CharacterMoves.removeSpecialMove !== 'function') {
            notify('Moves module not available.', 'error');
            return;
        }

        CharacterMoves.removeSpecialMove(charId, type, moveId)
            .then(function(result) {
                if (result && result.success) {
                    var char =
                        CharacterQueries.getCharacterById(charId);
                    if (char &&
                        CharacterStatsView &&
                        typeof CharacterStatsView.renderMovesSection ===
                        'function') {
                        CharacterStatsView.renderMovesSection(char);
                    }
                }
            })
            .catch(function() {
                notify('Failed to remove move.', 'error');
            });
    }

    // ============================================================
    // SOCIAL TAB
    // ============================================================

    function bindSocialButtons() {
        addSafeDelegatedListener(
            '#add-char-relationship-btn',
            'click',
            function(e) {
                e.preventDefault();
                openRelationshipModal(null);
            }
        );

        addSafeDelegatedListener(
            '#view-char-social-graph',
            'click',
            function(e) {
                e.preventDefault();
                openCharacterGraphModal();
            }
        );

        addSafeDelegatedListener(
            '.relationship-group-header',
            'click',
            function(e, target) {
                e.preventDefault();
                var group = target.closest('.relationship-group');
                if (!group) { return; }
                var body = group.querySelector(
                    '.relationship-group-body'
                );
                var caret = group.querySelector(
                    '.relationship-group-caret'
                );
                if (!body) { return; }

                var isHidden = body.style.display === 'none';
                body.style.display = isHidden ? 'block' : 'none';
                if (caret) {
                    caret.textContent = isHidden ? '\u25be' : '\u25b8';
                }
            }
        );

        addSafeDelegatedListener(
            '.edit-char-relationship',
            'click',
            function(e, target) {
                e.preventDefault();
                e.stopPropagation();
                var relId = target.dataset.relId;
                if (relId) { openRelationshipModal(relId); }
            }
        );

        addSafeDelegatedListener(
            '.delete-char-relationship',
            'click',
            function(e, target) {
                e.preventDefault();
                e.stopPropagation();
                var relId = target.dataset.relId;
                if (relId) { handleDeleteRelationship(relId); }
            }
        );

        addSafeDelegatedListener(
            '#close-char-graph-modal',
            'click',
            function(e) {
                e.preventDefault();
                closeCharacterGraphModal();
            }
        );

        addSafeDelegatedListener(
            '#character-graph-modal',
            'click',
            function(e, target) {
                if (e.target === target) {
                    closeCharacterGraphModal();
                }
            }
        );
    }

    function openRelationshipModal(relId) {
        var charId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        ensureSocialCoreInitialized();

        var SE = getSocialEvents();
        if (!SE ||
            typeof SE.handleAddRelationship !== 'function') {
            notify('Social module not available.', 'error');
            return;
        }

        try {
            SE.handleAddRelationship(relId || null);
        } catch (err) {
            console.warn(
                '[CharacterEvents] handleAddRelationship threw:', err
            );
            notify(
                'Failed to open relationship form: ' + err.message,
                'error'
            );
            return;
        }

        if (!relId) {
            var c1 = document.getElementById('rel-char1');
            if (c1) {
                c1.value = String(charId);
            }
            if (window.SocialViews &&
                typeof window.SocialViews.refreshClarificationLabels ===
                'function') {
                window.SocialViews.refreshClarificationLabels();
            }
            if (window.SocialViews &&
                typeof window.SocialViews.refreshRelationshipAgePreview ===
                'function') {
                window.SocialViews.refreshRelationshipAgePreview();
            }
            if (window.SocialViews &&
                typeof window.SocialViews.refreshRomanticOverlapWarning ===
                'function') {
                try {
                    window.SocialViews.refreshRomanticOverlapWarning();
                } catch (e) {
                    console.warn(
                        '[CharacterEvents] overlap warning threw:', e
                    );
                }
            }
        }
    }

    function handleDeleteRelationship(relId) {
        if (!relId) { return; }

        var SocialCore = window.SocialCore;
        var SocialQueries = getSocialQueries();
        if (!SocialCore || !SocialQueries) {
            notify('Social module not available.', 'error');
            return;
        }

        var rel = SocialQueries.getRelationshipById(relId);
        if (!rel) {
            notify('Relationship not found.', 'error');
            return;
        }

        var name1 = 'Unknown';
        var name2 = 'Unknown';
        var label = 'relationship';

        var SocialConstants = window.SocialConstants;
        if (SocialConstants &&
            typeof SocialConstants.getLabel === 'function') {
            label = SocialConstants.getLabel(rel.typeId);
        }

        if (CharacterQueries) {
            var c1 = CharacterQueries.getCharacterById(
                rel.character1
            );
            var c2 = CharacterQueries.getCharacterById(
                rel.character2
            );
            if (c1) {
                name1 = CharacterQueries.getDisplayName(c1);
            }
            if (c2) {
                name2 = CharacterQueries.getDisplayName(c2);
            }
        }

        if (!confirm(
            'Delete the ' + label + ' relationship between ' +
            name1 + ' and ' + name2 + '?'
        )) {
            return;
        }

        SocialCore.deleteRelationship(relId)
            .then(function(result) {
                if (result && result.success) {
                    refreshCharacterSocialSection();

                    var SE = getSocialEvents();
                    if (SE && typeof SE.refreshUI === 'function') {
                        try { SE.refreshUI(); } catch (e) {}
                    }
                } else {
                    notify(
                        (result && result.message) ||
                        'Failed to delete relationship.',
                        'error'
                    );
                }
            })
            .catch(function(err) {
                console.warn(
                    '[CharacterEvents] delete relationship threw:', err
                );
                notify('Failed to delete relationship.', 'error');
            });
    }

    function refreshCharacterSocialSection() {
        var charId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        if (!charId) { return; }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return; }

        if (CharacterViews &&
            typeof CharacterViews.renderCharacterSocial === 'function') {
            try {
                CharacterViews.renderCharacterSocial(char);
            } catch (e) {
                console.warn(
                    '[CharacterEvents] renderCharacterSocial failed:', e
                );
            }
        }
    }

    function openCharacterGraphModal() {
        var charId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        var SocialGraph = window.SocialGraph;
        if (!SocialGraph ||
            typeof SocialGraph.renderGraph !== 'function') {
            notify('Graph module not available.', 'error');
            return;
        }

        if (!CharacterViews ||
            typeof CharacterViews.buildGraphModalHTML !==
            'function') {
            notify('Character views module not available.', 'error');
            return;
        }

        var existing = document.getElementById(
            'character-graph-modal'
        );
        if (!existing) {
            var wrapper = document.createElement('div');
            wrapper.innerHTML =
                CharacterViews.buildGraphModalHTML();
            document.body.appendChild(wrapper.firstElementChild);
        }

        var modal = document.getElementById('character-graph-modal');
        if (modal &&
            Modal &&
            typeof Modal.showModal === 'function') {
            Modal.showModal(modal);
        } else if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
        }

        setTimeout(function() {
            if (CharacterViews &&
                typeof CharacterViews.renderCharacterGraph ===
                'function') {
                CharacterViews.renderCharacterGraph(charId);
            }
        }, 50);
    }

    function closeCharacterGraphModal() {
        var modal = document.getElementById('character-graph-modal');
        if (!modal) { return; }

        if (Modal && typeof Modal.hideModal === 'function') {
            Modal.hideModal(modal);
        } else {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }
    }

    // ============================================================
    // SAVE / DELETE / SELECT
    // ============================================================

    function handleSave() {
        if (_saveInFlight) { return; }

        var dto = CharacterForm.collect();
        if (!dto) {
            notify('Failed to collect form data.', 'error');
            return;
        }

        var editId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        dto._editId = editId;

        var wasEditing = editId !== null &&
            editId !== undefined &&
            editId !== '';

        _saveInFlight = true;

        CharacterCRUD.save(dto)
            .then(function(result) {
                if (result && result.success) {
                    var savedId = result.data
                        ? result.data.id : editId;
                    if (savedId) {
                        if (typeof window.setCurrentEditId ===
                            'function') {
                            window.setCurrentEditId(savedId);
                        }

                        if (!wasEditing) {
                            CharacterForm.render(savedId);
                        }

                        var char =
                            CharacterQueries.getCharacterById(
                                savedId
                            );
                        refreshUI(char);
                        refreshCharacterReportButton();
                    }
                }
            })
            .catch(function() {
                notify(
                    'An error occurred while saving.', 'error'
                );
            })
            .then(function() {
                _saveInFlight = false;
            });
    }

    function handleDelete(id) {
        if (!id) { return; }

        var char = CharacterQueries.getCharacterById(id);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        var name = CharacterQueries.getDisplayName(char);
        if (!confirm('Delete "' + name + '" permanently?')) {
            return;
        }

        CharacterCRUD.delete(id)
            .then(function(result) {
                if (result && result.success) {
                    var CL = getCharacterList();
                    if (CL &&
                        typeof CL.isSelected === 'function' &&
                        CL.isSelected(id) &&
                        typeof CL.toggleSelected === 'function') {
                        CL.toggleSelected(id);
                    }

                    if (typeof window.setCurrentEditId ===
                        'function') {
                        window.setCurrentEditId(null);
                    }
                    CharacterForm.hide();
                    refreshUI(null);
                    refreshCharacterReportButton();
                    notify(
                        'Character deleted successfully!', 'success'
                    );
                }
            })
            .catch(function() {
                notify(
                    'An error occurred while deleting.', 'error'
                );
            });
    }

    function handleCharacterSelect(id) {
        if (!id) { return; }

        var char = CharacterQueries.getCharacterById(id);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        if (typeof window.setCurrentEditId === 'function') {
            window.setCurrentEditId(id);
        }

        CharacterForm.render(id);
        refreshUI(char);
        refreshCharacterReportButton();

        var formContainer = document.getElementById(
            'character-form-container'
        );
        if (formContainer) {
            setTimeout(function() {
                formContainer.scrollIntoView({
                    block: 'nearest',
                    behavior: 'smooth'
                });
            }, 100);
        }

        closeSidebar();
    }

    function handleAddClassById(classId) {
        var charId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        if (!classId) {
            notify('Please select a class.', 'error');
            return;
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        if (!AcademyClasses ||
            typeof AcademyClasses.addToClass !== 'function') {
            notify('Academy classes module not available.', 'error');
            return;
        }

        AcademyClasses.addToClass(charId, classId)
            .then(function(result) {
                if (result && result.success) {
                    CharacterForm.render(charId);
                    var refreshedChar =
                        CharacterQueries.getCharacterById(charId);
                    refreshUI(refreshedChar);
                }
            })
            .catch(function(err) {
                notify('Failed to add class.', 'error');
                console.error(
                    '[CharacterEvents] handleAddClassById error:', err
                );
            });
    }

    function handleAddClassByName(name) {
        var charId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('Please save the character first.', 'error');
            return;
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        if (!AcademyClasses ||
            typeof AcademyClasses.addClassByName !== 'function') {
            notify('Academy classes module not available.', 'error');
            return;
        }

        AcademyClasses.addClassByName(charId, name)
            .then(function(result) {
                if (result && result.success) {
                    CharacterForm.render(charId);
                    var refreshedChar =
                        CharacterQueries.getCharacterById(charId);
                    refreshUI(refreshedChar);
                }
            })
            .catch(function() {
                notify('Failed to add class.', 'error');
            });
    }

    function handleRemoveClass(classId) {
        var charId = typeof window.getCurrentEditId === 'function'
            ? window.getCurrentEditId() : null;
        if (!charId) {
            notify('No character selected.', 'error');
            return;
        }

        if (!AcademyClasses ||
            typeof AcademyClasses.removeClassById !== 'function') {
            notify('Academy classes module not available.', 'error');
            return;
        }

        AcademyClasses.removeClassById(charId, classId)
            .then(function(result) {
                if (result && result.success) {
                    CharacterForm.render(charId);
                    var refreshedChar =
                        CharacterQueries.getCharacterById(charId);
                    refreshUI(refreshedChar);
                }
            })
            .catch(function(err) {
                notify('Failed to remove class.', 'error');
                console.error(
                    '[CharacterEvents] handleRemoveClass error:', err
                );
            });
    }

    // ============================================================
    // RANDOM FILL
    // ============================================================

    function fillRandomPhysical() {
        var physical = CharacterGenerator.generatePhysical();
        FormUtils.setField('char-eyes', physical.eyes);
        FormUtils.setField('char-hair', physical.hair);
        FormUtils.setField('char-skin', physical.skin);
        FormUtils.setField('char-height', physical.height);
        FormUtils.setField('char-weight', physical.weight);
        FormUtils.setField('char-build', physical.build);
        notify(
            'Random physical appearance generated!', 'info'
        );
    }

    function fillRandomPersonality() {
        var personality = CharacterGenerator.generatePersonality();

        FormUtils.setField(
            'char-personality-traits', personality.traits
        );
        FormUtils.setField(
            'char-personality-ideals', personality.ideals
        );
        FormUtils.setField(
            'char-personality-bonds', personality.bonds
        );
        FormUtils.setField(
            'char-personality-flaws', personality.flaws
        );
        FormUtils.setField(
            'char-personality-alignment', personality.alignment
        );
        FormUtils.setField(
            'char-personality-likes', personality.likes
        );
        FormUtils.setField(
            'char-personality-dislikes', personality.dislikes
        );
        FormUtils.setField(
            'char-personality-habits', personality.habits
        );
        FormUtils.setField(
            'char-personality-fears', personality.fears
        );
        FormUtils.setField(
            'char-personality-goals', personality.goals
        );

        FormUtils.setField(
            'char-personality-authority', personality.authority
        );
        FormUtils.setField(
            'char-personality-conflictStyle',
            personality.conflictStyle
        );
        FormUtils.setField(
            'char-personality-socialStyle',
            personality.socialStyle
        );
        FormUtils.setField(
            'char-personality-quirks', personality.quirks
        );

        notify('Random personality generated!', 'info');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterEvents = {
        init: init,
        destroy: destroy,
        removeAllEventListeners: removeAllEventListeners,
        refreshUI: refreshUI,
        handleAddClassById: handleAddClassById,
        handleAddClassByName: handleAddClassByName,
        handleRemoveClass: handleRemoveClass,
        refreshCharacterReportButton: refreshCharacterReportButton
    };

})();
