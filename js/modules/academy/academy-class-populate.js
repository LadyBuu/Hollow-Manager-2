/**
 * Academy Class Population
 *
 * Generates a cohort for one existing class. Character records are
 * created through CharacterCRUD, then enrolled through AcademyClasses.
 * A failed batch triggers reverse-order compensating cleanup.
 */
(function() {
    'use strict';

    if (window.__academyClassPopulateLoaded) return;

    var Modal = window.Modal;
    var DomUtils = window.DomUtils;
    var Notifications = window.NotificationSystem;
    var CharacterCRUD = window.CharacterCRUD;
    var AcademyClasses = window.AcademyClasses;
    var CharacterGenerator = window.CharacterGenerator;

    var missing = [];
    if (!Modal || typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') missing.push('Modal');
    if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') missing.push('DomUtils');
    if (!Notifications || typeof Notifications.notify !== 'function') missing.push('NotificationSystem');
    if (!CharacterCRUD || typeof CharacterCRUD.save !== 'function' ||
        typeof CharacterCRUD.delete !== 'function') missing.push('CharacterCRUD');
    if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function' ||
        typeof AcademyClasses.addToClass !== 'function') missing.push('AcademyClasses');
    if (!CharacterGenerator || typeof CharacterGenerator.generatePhysical !== 'function') missing.push('CharacterGenerator');

    if (missing.length) {
        throw new Error('[AcademyClassPopulate] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyClassPopulateLoaded = true;

    var MODAL_ID = 'academy-populate-class-modal';
    var MAX_CHARACTERS = 100;
    var _modal = null;
    var _content = null;
    var _busy = false;
    var _classId = null;
    var _onComplete = null;

    function notify(message, type) {
        Notifications.notify(message, type || 'info');
    }

    function open(classId, options) {
        if (typeof classId !== 'string' || !classId.trim()) {
            notify('Select a class first.', 'error');
            return;
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            notify('The selected class no longer exists.', 'error');
            return;
        }

        if (_modal) close();

        options = options || {};
        _classId = classId;
        _onComplete = typeof options.onComplete === 'function' ? options.onComplete : null;

        var modal = Modal.createModal(MODAL_ID);
        if (!modal) {
            notify('Could not open Populate Class.', 'error');
            return;
        }
        modal.id = MODAL_ID;

        var content = document.createElement('div');
        content.className = 'modal-content academy-populate-class-content';
        content.innerHTML = buildHTML(cls);
        modal.appendChild(content);

        _modal = modal;
        _content = content;
        _busy = false;

        content.addEventListener('click', handleClick);
        Modal.modalSetup(modal, close);
        Modal.showModal(modal);

        var countInput = content.querySelector('#academy-populate-count');
        if (countInput) {
            try { countInput.focus(); countInput.select(); } catch (e) {}
        }
    }

    function buildHTML(cls) {
        var html = '';
        html += '<div class="modal-header">';
        html += '<h3>Populate ' + DomUtils.escapeHtml(cls.name || 'Class') + '</h3>';
        html += '<button type="button" class="close-modal" data-populate-action="close" aria-label="Close">&times;</button>';
        html += '</div>';
        html += '<div class="modal-body academy-populate-class-fields">';
        html += '<p class="academy-populate-class-note">Create students with random names from Word Hoard, random genders, and birth years within the range below. They will be enrolled in this class automatically.</p>';
        html += '<div><label for="academy-populate-count">Number of characters</label>';
        html += '<input id="academy-populate-count" type="number" min="1" max="' + MAX_CHARACTERS + '" step="1" value="20" required></div>';
        html += '<div><label>Birth year range (inclusive)</label>';
        html += '<div class="academy-populate-year-range">';
        html += '<input id="academy-populate-year-from" type="number" min="1" step="1" placeholder="From year" required aria-label="First birth year">';
        html += '<input id="academy-populate-year-to" type="number" min="1" step="1" placeholder="To year" required aria-label="Last birth year">';
        html += '</div></div></div>';
        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" data-populate-action="close">Cancel</button>';
        html += '<button type="button" class="primary" data-populate-action="submit">Populate Class</button>';
        html += '</div>';
        return html;
    }

    function close() {
        if (_busy) return;
        var modal = _modal;
        _modal = null;
        _content = null;
        _classId = null;
        _onComplete = null;
        if (modal) Modal.closeModal(modal);
    }

    function handleClick(event) {
        var target = event.target;
        if (!target || typeof target.closest !== 'function') return;
        var button = target.closest('[data-populate-action]');
        if (!button) return;
        event.preventDefault();

        if (button.dataset.populateAction === 'close') close();
        else if (button.dataset.populateAction === 'submit') submit();
    }

    function readSettings() {
        if (!_content) throw new Error('Populate Class is not open.');
        var count = Number(_content.querySelector('#academy-populate-count').value);
        var from = Number(_content.querySelector('#academy-populate-year-from').value);
        var to = Number(_content.querySelector('#academy-populate-year-to').value);

        if (!Number.isInteger(count) || count < 1 || count > MAX_CHARACTERS) {
            throw new Error('Number of characters must be between 1 and ' + MAX_CHARACTERS + '.');
        }
        if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to) || to < 1) {
            throw new Error('Enter both birth years as positive whole numbers.');
        }
        if (from > to) {
            throw new Error('The first birth year must be earlier than or equal to the last birth year.');
        }
        return { count: count, from: from, to: to };
    }

    function getWords(amount) {
        var Hoard = window.WordHoard;
        if (!Hoard || typeof Hoard.getAll !== 'function') {
            return Promise.reject(new Error('Word Hoard is unavailable. Open Word Hoard once, then try again.'));
        }
        return Hoard.getAll().then(function(entries) {
            var words = (Array.isArray(entries) ? entries : [])
                .map(function(entry) {
                    return entry && typeof entry.word === 'string' ? entry.word.trim() : '';
                })
                .filter(function(word) {
                    return word !== '' && !/\\d/.test(word);
                });
            if (!words.length) {
                throw new Error('Word Hoard is empty. Add words before populating a class.');
            }
            var selected = [];
            for (var i = 0; i < amount; i++) {
                selected.push(words[Math.floor(Math.random() * words.length)]);
            }
            return selected;
        });
    }

    function setBusy(value) {
        _busy = value;
        if (!_content) return;
        var controls = _content.querySelectorAll('input, button');
        for (var i = 0; i < controls.length; i++) controls[i].disabled = value;
        var submitButton = _content.querySelector('[data-populate-action="submit"]');
        if (submitButton) submitButton.textContent = value ? 'Creating…' : 'Populate Class';
    }

    async function submit() {
        if (_busy || !_classId) return;

        var settings;
        try {
            settings = readSettings();
        } catch (error) {
            notify(error.message, 'error');
            return;
        }

        var classId = _classId;
        if (!AcademyClasses.getClass(classId)) {
            notify('The selected class no longer exists.', 'error');
            close();
            return;
        }

        setBusy(true);
        var createdIds = [];

        try {
            var words = await getWords(settings.count * 2);
            var chain = Promise.resolve();

            for (var i = 0; i < settings.count; i++) {
                (function(index) {
                    chain = chain.then(async function() {
                        var physical = CharacterGenerator.generatePhysical();
                        var dto = {
                            _editId: null,
                            firstName: words[index * 2],
                            lastName: words[index * 2 + 1],
                            middleName: '',
                            nickname: '',
                            alias: '',
                            gender: physical.gender,
                            skin: physical.skin,
                            hair: physical.hair,
                            eyes: physical.eyes,
                            height: physical.height,
                            weight: physical.weight,
                            build: physical.build,
                            birthYear: String(settings.from + Math.floor(Math.random() * (settings.to - settings.from + 1))),
                            isFiller: false,
                            personality: {},
                            careerStatus: [],
                            specialMoves: { physical: [], magical: [] }
                        };

                        var saved = await CharacterCRUD.save(dto);
                        if (!saved || !saved.success || !saved.data || !saved.data.id) {
                            throw new Error((saved && saved.message) || ('Could not create character ' + (index + 1) + '.'));
                        }

                        var id = String(saved.data.id);
                        createdIds.push(id);

                        var enrolled = await AcademyClasses.addToClass(id, classId);
                        if (!enrolled || !enrolled.success) {
                            throw new Error((enrolled && enrolled.message) || ('Could not enrol character ' + (index + 1) + '.'));
                        }
                    });
                })(i);
            }
            await chain;
        } catch (error) {
            var rollbackFailures = [];
            for (var r = createdIds.length - 1; r >= 0; r--) {
                try {
                    var removed = await CharacterCRUD.delete(createdIds[r]);
                    if (!removed || !removed.success) rollbackFailures.push(createdIds[r]);
                } catch (rollbackError) {
                    rollbackFailures.push(createdIds[r]);
                }
            }

            var ListAfterRollback = window.CharacterList;
            if (ListAfterRollback && typeof ListAfterRollback.refresh === 'function') {
                try { ListAfterRollback.refresh(); } catch (e) {}
            }
            setBusy(false);
            if (rollbackFailures.length) {
                notify('Population stopped. ' + rollbackFailures.length + ' generated character(s) could not be rolled back. Check the class roster and Character Manager.', 'error');
            } else {
                notify('No characters were kept. ' + (error.message || 'Population failed.'), 'error');
            }
            return;
        }

        var completedCallback = _onComplete;
        var modal = _modal;
        _modal = null;
        _content = null;
        _classId = null;
        _onComplete = null;
        _busy = false;
        if (modal) Modal.closeModal(modal);

        var List = window.CharacterList;
        if (List && typeof List.refresh === 'function') {
            try { List.refresh(); } catch (e) {}
        }
        notify('Created and enrolled ' + createdIds.length + ' student' + (createdIds.length === 1 ? '' : 's') + '.', 'success');
        if (completedCallback) {
            try { completedCallback(createdIds.slice()); } catch (callbackError) {
                console.warn('[AcademyClassPopulate] onComplete failed:', callbackError);
            }
        }
    }

    window.AcademyClassPopulate = Object.freeze({
        open: open,
        close: close,
        isOpen: function() { return _modal !== null; }
    });
})();
