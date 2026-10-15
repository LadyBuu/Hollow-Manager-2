/**
 * js/modules/characters/character-stats-view.js - Combat View
 * Renders the magical section and special moves section of the
 * Combat tab.
 *
 * Path: js/modules/characters/character-stats-view.js
 *
 * IMPORTANT:
 *   - RENDER ONLY - domain logic is in character-stats.js
 *   - No data mutation
 *   - No persistence calls
 *   - Uses MagicConstants for definitions (lazy)
 *   - Uses CharacterConstants for bounds (lazy)
 *   - Uses CharacterStats for derivation (lazy)
 *   - Uses CharacterQueries for character data (lazy)
 *   - Uses FormUtils for field operations (lazy)
 *   - Uses DomUtils for escaping (lazy)
 *
 * LOAD ORDER:
 *   All dependencies are resolved at call time. The module loads
 *   cleanly regardless of script order. The HTML generators return
 *   safe placeholders when their dependencies are absent.
 *
 * COLOUR SANITISATION:
 *   Magic category colours come from MagicConstants and are
 *   var(--...) references. They are still passed through
 *   escapeAttribute (attribute context) and, when available,
 *   DomUtils.sanitizeCssValue, so a hostile value cannot escape
 *   the style attribute.
 *
 * MOVES DOM CONTRACT:
 *   Each rendered move row carries:
 *
 *     <div class="special-move-entry"
 *          data-move-id="move_...">
 *       <div class="special-move-row-top">
 *         <span class="special-move-name">Move Name</span>
 *         <button class="remove-special-move"
 *                 data-type="physical"
 *                 data-move-id="move_...">✕</button>
 *       </div>
 *       <div class="special-move-description">Description</div>
 *     </div>
 *
 *   collectMovesFromDOM() reads these rows back out. The id, if
 *   present and non-empty, is preserved; a row without an id gets
 *   id: '' and the save path (CharacterCRUD.normaliseCharacterData)
 *   carries it through unchanged.
 *
 *   The name is stored in .special-move-name's textContent and
 *   the description in .special-move-description's textContent.
 *   Whitespace is trimmed. Rows with an empty name are dropped.
 *
 *   This module does NOT persist moves. CharacterMoves owns the
 *   record-store mutations; the form is a direct carrier of the
 *   moves array on save.
 */

(function() {
    'use strict';

    if (window.__characterStatsViewLoaded) {
        return;
    }
    window.__characterStatsViewLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESS - LAZY
    // ============================================================

    function getMagicConstants() { return window.MagicConstants || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getCharacterStats() { return window.CharacterStats || null; }
    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getFormUtils() { return window.FormUtils || null; }
    function getDomUtils() { return window.DomUtils || null; }

    function getMagicMax() {
        var MC = getMagicConstants();
        if (MC && typeof MC.MAGIC_MAX === 'number') {
            return MC.MAGIC_MAX;
        }
        return 10;
    }

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeHtml === 'function') {
            return DU.escapeHtml(value);
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
        var DU = getDomUtils();
        if (DU && typeof DU.escapeAttribute === 'function') {
            return DU.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Sanitise a colour for use in a style attribute. Prefers
     * DomUtils.sanitizeCssValue when available; falls back to a
     * narrow allowlist for var() references and simple colour
     * keywords, otherwise returns a safe default.
     */
    function sanitiseColour(value, fallback) {
        fallback = fallback || 'var(--accent)';
        if (value === undefined || value === null || value === '') {
            return fallback;
        }

        var DU = getDomUtils();
        if (DU && typeof DU.sanitizeCssValue === 'function') {
            var sanitised = DU.sanitizeCssValue(value);
            if (sanitised !== '') {
                return sanitised;
            }
            return fallback;
        }

        // Fallback: permit var(--…) and simple hex/keyword values.
        if (typeof value !== 'string') { return fallback; }
        var trimmed = value.trim();
        if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(trimmed)) {
            return trimmed;
        }
        if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
            return trimmed;
        }
        if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(trimmed)) {
            return trimmed;
        }
        return fallback;
    }

    // ============================================================
    // MAGICAL SECTION HTML
    // ============================================================

    function getMagicalSectionHTML(c) {
        var MC = getMagicConstants();
        if (!MC) {
            return '<div class="combat-section" ' +
                'style="margin-bottom:12px;padding:10px;' +
                'background:var(--panel);border:1px solid var(--border);' +
                'border-radius:var(--radius);">' +
                '<p class="empty-state">Magic constants not loaded.</p>' +
                '</div>';
        }

        var magic = c && c.magic ? c.magic : {};
        var categories = (typeof MC.getCategoryOrder === 'function')
            ? MC.getCategoryOrder()
            : ['elemental', 'body', 'aether'];

        var categoriesHTML = '';

        for (var ci = 0; ci < categories.length; ci++) {
            var catId = categories[ci];
            var cat = MC.getCategory(catId);
            if (!cat) { continue; }
            var types = MC.getCategoryTypes(catId);

            var total = 0;
            for (var t = 0; t < types.length; t++) {
                total += Number(magic[types[t]]) || 0;
            }

            var safeCatColour = sanitiseColour(
                cat.color,
                'var(--accent)'
            );

            var typeInputs = '';
            for (var ti = 0; ti < types.length; ti++) {
                var typeKey = types[ti];
                var label = MC.getTypeLabel(typeKey);
                var value = magic[typeKey] !== undefined ? magic[typeKey] : 0;
                var levelLabel = MC.getProficiencyLevelLabel(value);

                typeInputs +=
                    '<div class="magic-type-block" style="display:flex;' +
                        'flex-direction:column;gap:2px;align-items:center;' +
                        'padding:4px;background:var(--bg);' +
                        'border:1px solid var(--border-soft);' +
                        'border-radius:4px;">' +
                        '<label style="font-size:0.55rem;' +
                            'color:var(--text-dim);font-weight:600;">' +
                            escapeHtml(label) +
                        '</label>' +
                        '<input type="number" id="char-magic-' +
                            escapeAttribute(typeKey) + '" ' +
                            'value="' + escapeAttribute(String(value)) + '" ' +
                            'min="0" max="' + escapeAttribute(String(getMagicMax())) + '" ' +
                            'data-magic-key="' + escapeAttribute(typeKey) + '" ' +
                            'class="magic-input" ' +
                            'style="width:100%;padding:3px 4px;' +
                            'background:var(--panel-alt);' +
                            'border:1px solid var(--border);' +
                            'color:var(--text);border-radius:3px;' +
                            'font-size:0.8rem;text-align:center;' +
                            'font-weight:600;">' +
                        '<span class="magic-level" ' +
                            'data-magic-level="' + escapeAttribute(typeKey) + '" ' +
                            'style="font-size:0.5rem;' +
                            'color:var(--text-dim);">' +
                            escapeHtml(levelLabel) +
                        '</span>' +
                    '</div>';
            }

            categoriesHTML +=
                '<div class="magic-category" style="margin-bottom:10px;">' +
                    '<div style="display:flex;justify-content:space-between;' +
                        'align-items:center;margin-bottom:4px;">' +
                        '<label style="font-size:0.7rem;color:' +
                            escapeAttribute(safeCatColour) +
                            ';font-weight:600;">' +
                            escapeHtml(cat.label) +
                        '</label>' +
                        '<span style="font-size:0.6rem;' +
                            'color:var(--text-dim);">Total: ' +
                            '<span data-magic-total="' +
                                escapeAttribute(catId) + '">' +
                                escapeHtml(String(total)) +
                            '</span>' +
                        '</span>' +
                    '</div>' +
                    '<div class="magic-grid" ' +
                        'style="display:grid;' +
                        'grid-template-columns:repeat(6,1fr);' +
                        'gap:4px;">' +
                        typeInputs +
                    '</div>' +
                '</div>';
        }

        // Broad + fine override dropdowns
        var broadOptions = '<option value="">\u2014 Derived \u2014</option>';
        var broadClasses = (typeof MC.getBroadClasses === 'function')
            ? MC.getBroadClasses()
            : [];
        for (var bi = 0; bi < broadClasses.length; bi++) {
            var bc = broadClasses[bi];
            broadOptions += '<option value="' +
                escapeAttribute(bc.id) + '">' +
                escapeHtml(bc.label) +
                '</option>';
        }

        var fineOptions = '<option value="">\u2014 Derived \u2014</option>';
        var fineClasses = (typeof MC.getFineClasses === 'function')
            ? MC.getFineClasses()
            : [];
        for (var fi = 0; fi < fineClasses.length; fi++) {
            var fc = fineClasses[fi];
            fineOptions += '<option value="' +
                escapeAttribute(fc.id) + '">' +
                escapeHtml(fc.label) +
                '</option>';
        }

        return (
            '<div class="combat-section" style="margin-bottom:12px;' +
                'padding:10px;background:var(--panel);' +
                'border:1px solid var(--border);' +
                'border-radius:var(--radius);">' +
                '<div style="display:flex;justify-content:space-between;' +
                    'align-items:center;margin-bottom:8px;' +
                    'flex-wrap:wrap;gap:6px;">' +
                    '<label style="font-size:0.8rem;color:var(--accent);' +
                        'font-weight:600;">Magical</label>' +
                    '<button type="button" id="roll-magic-btn" ' +
                        'class="small secondary" ' +
                        'style="font-size:0.65rem;padding:3px 10px;">' +
                        '\u27f3 Roll Magic' +
                    '</button>' +
                '</div>' +

                categoriesHTML +

                '<div style="display:grid;grid-template-columns:1fr 1fr;' +
                    'gap:8px;margin-top:8px;">' +
                    '<div class="form-group">' +
                        '<label style="font-size:0.7rem;' +
                            'color:var(--text-dim);">' +
                            'Broad Class (derived)' +
                        '</label>' +
                        '<div id="derived-broad-class" ' +
                            'style="padding:5px 8px;background:var(--bg);' +
                            'border:1px solid var(--border);' +
                            'color:var(--info);border-radius:4px;' +
                            'font-size:0.75rem;font-weight:600;">' +
                            '\u2014' +
                        '</div>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label style="font-size:0.7rem;' +
                            'color:var(--text-dim);">' +
                            'Fine Class (derived)' +
                        '</label>' +
                        '<div id="derived-fine-class" ' +
                            'style="padding:5px 8px;background:var(--bg);' +
                            'border:1px solid var(--border);' +
                            'color:var(--warning);border-radius:4px;' +
                            'font-size:0.75rem;font-weight:600;">' +
                            '\u2014' +
                        '</div>' +
                    '</div>' +
                '</div>' +

                '<div style="display:grid;grid-template-columns:1fr 1fr;' +
                    'gap:8px;margin-top:8px;">' +
                    '<div class="form-group">' +
                        '<label style="font-size:0.7rem;' +
                            'color:var(--text-dim);">' +
                            'Override Broad (display only)' +
                        '</label>' +
                        '<select id="broad-class-override" ' +
                            'style="width:100%;padding:5px 8px;' +
                            'background:var(--bg);' +
                            'border:1px solid var(--border);' +
                            'color:var(--text);border-radius:4px;' +
                            'font-size:0.75rem;">' +
                            broadOptions +
                        '</select>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label style="font-size:0.7rem;' +
                            'color:var(--text-dim);">' +
                            'Override Fine (raises proficiency to 8)' +
                        '</label>' +
                        '<select id="fine-class-override" ' +
                            'style="width:100%;padding:5px 8px;' +
                            'background:var(--bg);' +
                            'border:1px solid var(--border);' +
                            'color:var(--text);border-radius:4px;' +
                            'font-size:0.75rem;">' +
                            fineOptions +
                        '</select>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // SPECIAL MOVES SECTION HTML
    // ============================================================

    function getMovesSectionHTML(c) {
        return (
            '<div class="combat-section" style="margin-bottom:12px;' +
                'padding:10px;background:var(--panel);' +
                'border:1px solid var(--border);' +
                'border-radius:var(--radius);">' +
                '<label style="font-size:0.8rem;color:var(--accent);' +
                    'font-weight:600;display:block;margin-bottom:8px;">' +
                    'Special Moves' +
                '</label>' +

                '<div style="display:grid;grid-template-columns:1fr 1fr;' +
                    'gap:8px;">' +
                    '<div class="moves-column" ' +
                        'style="background:var(--panel-alt);padding:6px;' +
                        'border-radius:6px;' +
                        'border:1px solid var(--border-soft);">' +
                        '<label style="font-size:0.65rem;font-weight:600;' +
                            'color:var(--accent);">Physical</label>' +
                        '<div id="physical-moves-list" class="moves-list" ' +
                            'style="margin-top:2px;max-height:120px;' +
                            'overflow-y:auto;">' +
                            '<p class="empty-state" ' +
                                'style="padding:4px;font-size:0.7rem;">' +
                                'None' +
                            '</p>' +
                        '</div>' +
                        '<div class="move-input-group" ' +
                            'style="margin-top:4px;">' +
                            '<input type="text" id="physical-move-name" ' +
                                'placeholder="Move name" ' +
                                'style="width:100%;padding:3px 5px;' +
                                'font-size:0.65rem;background:var(--bg);' +
                                'border:1px solid var(--border);' +
                                'color:var(--text);border-radius:4px;' +
                                'margin-bottom:2px;">' +
                            '<input type="text" id="physical-move-desc" ' +
                                'placeholder="Description (optional)" ' +
                                'style="width:100%;padding:3px 5px;' +
                                'font-size:0.65rem;background:var(--bg);' +
                                'border:1px solid var(--border);' +
                                'color:var(--text);border-radius:4px;' +
                                'margin-bottom:2px;">' +
                            '<button type="button" ' +
                                'id="add-physical-move-btn" ' +
                                'class="small primary" ' +
                                'style="font-size:0.6rem;padding:2px 8px;">' +
                                '+ Add' +
                            '</button>' +
                        '</div>' +
                    '</div>' +

                    '<div class="moves-column" ' +
                        'style="background:var(--panel-alt);padding:6px;' +
                        'border-radius:6px;' +
                        'border:1px solid var(--border-soft);">' +
                        '<label style="font-size:0.65rem;font-weight:600;' +
                            'color:var(--info);">Magical</label>' +
                        '<div id="magical-moves-list" class="moves-list" ' +
                            'style="margin-top:2px;max-height:120px;' +
                            'overflow-y:auto;">' +
                            '<p class="empty-state" ' +
                                'style="padding:4px;font-size:0.7rem;">' +
                                'None' +
                            '</p>' +
                        '</div>' +
                        '<div class="move-input-group" ' +
                            'style="margin-top:4px;">' +
                            '<input type="text" id="magical-move-name" ' +
                                'placeholder="Move name" ' +
                                'style="width:100%;padding:3px 5px;' +
                                'font-size:0.65rem;background:var(--bg);' +
                                'border:1px solid var(--border);' +
                                'color:var(--text);border-radius:4px;' +
                                'margin-bottom:2px;">' +
                            '<input type="text" id="magical-move-desc" ' +
                                'placeholder="Description (optional)" ' +
                                'style="width:100%;padding:3px 5px;' +
                                'font-size:0.65rem;background:var(--bg);' +
                                'border:1px solid var(--border);' +
                                'color:var(--text);border-radius:4px;' +
                                'margin-bottom:2px;">' +
                            '<button type="button" ' +
                                'id="add-magical-move-btn" ' +
                                'class="small primary" ' +
                                'style="font-size:0.6rem;padding:2px 8px;">' +
                                '+ Add' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // POPULATE MAGICAL FIELDS
    // ============================================================

    function populateMagicalFields(char) {
        var MC = getMagicConstants();
        var FormUtils = getFormUtils();
        if (!MC || !FormUtils) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(
                    '[CharacterStatsView] populateMagicalFields ' +
                    'requires MagicConstants and FormUtils.'
                );
            }
            return;
        }

        var magic = char && char.magic ? char.magic : {};
        var types = MC.getTypeKeys();

        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            var value = magic[type] !== undefined ? magic[type] : 0;
            FormUtils.setField('char-magic-' + type, value);

            var levelEl = document.querySelector(
                '[data-magic-level="' + type + '"]'
            );
            if (levelEl) {
                levelEl.textContent = MC.getProficiencyLevelLabel(value);
            }
        }

        var order = (typeof MC.getCategoryOrder === 'function')
            ? MC.getCategoryOrder()
            : ['elemental', 'body', 'aether'];
        for (var ci = 0; ci < order.length; ci++) {
            var catId = order[ci];
            var catTypes = MC.getCategoryTypes(catId);
            var total = 0;
            for (var t = 0; t < catTypes.length; t++) {
                total += Number(magic[catTypes[t]]) || 0;
            }
            var totalEl = document.querySelector(
                '[data-magic-total="' + catId + '"]'
            );
            if (totalEl) {
                totalEl.textContent = String(total);
            }
        }
    }

    // ============================================================
    // COLLECT MAGICAL FIELDS
    // ============================================================

    function collectMagicalFields() {
        var MC = getMagicConstants();
        var FormUtils = getFormUtils();
        if (!MC || !FormUtils) { return {}; }

        var magic = {};
        var types = MC.getTypeKeys();
        var magicMax = getMagicMax();

        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            var raw = FormUtils.getField('char-magic-' + type);
            var value = parseInt(raw, 10);
            if (isNaN(value)) { value = 0; }
            magic[type] = Math.max(0, Math.min(magicMax, value));
        }

        return magic;
    }

    // ============================================================
    // CLASS DISPLAY UPDATES
    // ============================================================

    function updatePhysicalClassDisplay(char) {
        var CS = getCharacterStats();
        if (!CS) { return; }

        var el = document.getElementById('derived-physical-class');
        if (!el) { return; }

        if (!char || !char.stats) {
            el.textContent = '\u2014';
            return;
        }

        var result = CS.derivePhysicalClass(char.stats);
        if (!result || !result.class) {
            el.textContent = '\u2014';
            return;
        }

        el.textContent = result.class.label;
    }

    function updateMagicalClassDisplay(char) {
        var MC = getMagicConstants();
        var CS = getCharacterStats();
        if (!MC || !CS) { return; }

        var broadEl = document.getElementById('derived-broad-class');
        var fineEl = document.getElementById('derived-fine-class');

        if (!char || !char.magic) {
            if (broadEl) { broadEl.textContent = '\u2014'; }
            if (fineEl)  { fineEl.textContent = '\u2014'; }
            return;
        }

        var result = CS.deriveMagicalClasses(char.magic);
        if (broadEl) {
            broadEl.textContent = result.broad ? result.broad.label : '\u2014';
        }
        if (fineEl) {
            fineEl.textContent = result.fine ? result.fine.label : '\u2014';
        }
    }

    // ============================================================
    // MOVES SECTION RENDERING
    // ============================================================
    //
    // Each row carries data-move-id (possibly empty for a move
    // added through the form and not yet persisted), plus
    // .special-move-name and .special-move-description so the
    // moves can be read back out of the DOM by collectMovesFromDOM.

    function renderMovesSection(char) {
        var physicalList = document.getElementById('physical-moves-list');
        var magicalList = document.getElementById('magical-moves-list');
        if (!physicalList || !magicalList) { return; }

        var moves = char && char.specialMoves
            ? char.specialMoves
            : { physical: [], magical: [] };
        var physical = Array.isArray(moves.physical) ? moves.physical : [];
        var magical = Array.isArray(moves.magical) ? moves.magical : [];

        renderMovesInto(physicalList, physical, 'physical');
        renderMovesInto(magicalList, magical, 'magical');
    }

    function renderMovesInto(container, moves, type) {
        container.textContent = '';

        if (!moves || moves.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'None';
            container.appendChild(empty);
            return;
        }

        var color = type === 'physical' ? 'var(--accent)' : 'var(--info)';

        for (var i = 0; i < moves.length; i++) {
            var move = moves[i];
            if (!move || typeof move !== 'object') { continue; }

            var moveId = move.id !== undefined && move.id !== null
                ? String(move.id)
                : '';
            var moveName = move.name !== undefined && move.name !== null
                ? String(move.name)
                : 'Unnamed Move';
            var moveDesc = move.description !== undefined &&
                move.description !== null
                ? String(move.description)
                : '';

            var div = document.createElement('div');
            div.className = 'special-move-entry';
            div.dataset.moveId = moveId;
            div.style.cssText =
                'display:flex;flex-direction:column;gap:2px;' +
                'padding:4px 6px;border-left:3px solid ' + color + ';' +
                'background:var(--bg);border-radius:4px;' +
                'margin-bottom:3px;font-size:0.7rem;';

            var topRow = document.createElement('div');
            topRow.className = 'special-move-row-top';
            topRow.style.cssText =
                'display:flex;justify-content:space-between;' +
                'align-items:center;';

            var nameSpan = document.createElement('span');
            nameSpan.className = 'special-move-name';
            nameSpan.style.cssText =
                'font-weight:600;color:var(--text);';
            nameSpan.textContent = moveName;
            topRow.appendChild(nameSpan);

            var delBtn = document.createElement('button');
            delBtn.className = 'remove-special-move small';
            delBtn.style.cssText =
                'background:none;border:none;color:var(--danger);' +
                'cursor:pointer;font-size:0.6rem;padding:0 4px;';
            delBtn.dataset.type = type;
            delBtn.dataset.moveId = moveId;
            delBtn.textContent = '\u2715';
            delBtn.setAttribute('aria-label', 'Delete move');
            topRow.appendChild(delBtn);

            div.appendChild(topRow);

            if (moveDesc) {
                var desc = document.createElement('div');
                desc.className = 'special-move-description';
                desc.style.cssText =
                    'color:var(--text-dim);font-size:0.6rem;' +
                    'padding-left:4px;';
                desc.textContent = moveDesc;
                div.appendChild(desc);
            }

            container.appendChild(div);
        }
    }

    // ============================================================
    // COLLECT MOVES FROM DOM
    // ============================================================
    //
    // Read the two rendered move lists back into an array of
    // { id, name, description } entries. This is what carries the
    // form's moves through CharacterForm.collect() into
    // CharacterCRUD.save.
    //
    // A row without a data-move-id produces id: '' — the
    // canonicaliser in CharacterCRUD preserves whatever is there,
    // and CharacterMoves is not involved in this path. Only rows
    // with a non-empty name are returned; an empty row is silently
    // dropped.

    function collectMovesFromDOM() {
        function collectOne(listId) {
            var container = document.getElementById(listId);
            if (!container) { return []; }

            var out = [];
            var rows = container.querySelectorAll('.special-move-entry');

            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];

                var nameEl = row.querySelector('.special-move-name');
                var name = nameEl
                    ? String(nameEl.textContent || '').trim()
                    : '';
                if (name === '') { continue; }

                var descEl = row.querySelector(
                    '.special-move-description'
                );
                var desc = descEl
                    ? String(descEl.textContent || '').trim()
                    : '';

                var id = '';
                if (row.dataset && row.dataset.moveId) {
                    id = String(row.dataset.moveId);
                }

                out.push({
                    id: id,
                    name: name,
                    description: desc
                });
            }

            return out;
        }

        return {
            physical: collectOne('physical-moves-list'),
            magical: collectOne('magical-moves-list')
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStatsView = {
        // HTML generators
        getMagicalSectionHTML: getMagicalSectionHTML,
        getMovesSectionHTML: getMovesSectionHTML,

        // Population
        populateMagicalFields: populateMagicalFields,

        // Collection
        collectMagicalFields: collectMagicalFields,
        collectMovesFromDOM: collectMovesFromDOM,

        // Class display updates
        updatePhysicalClassDisplay: updatePhysicalClassDisplay,
        updateMagicalClassDisplay: updateMagicalClassDisplay,

        // Moves
        renderMovesSection: renderMovesSection
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterStatsView;
        var failures = [];

        var required = [
            'getMagicalSectionHTML',
            'getMovesSectionHTML',
            'populateMagicalFields',
            'collectMagicalFields',
            'collectMovesFromDOM',
            'updatePhysicalClassDisplay',
            'updateMagicalClassDisplay',
            'renderMovesSection'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                failures.push('missing export: ' + required[i]);
            }
        }

        try {
            var moves = exports.collectMovesFromDOM();
            if (!moves ||
                !Array.isArray(moves.physical) ||
                !Array.isArray(moves.magical)) {
                failures.push(
                    'collectMovesFromDOM returned a malformed shape'
                );
            }
        } catch (e) {
            failures.push('smoke test threw: ' + e.message);
        }

        if (failures.length > 0) {
            throw new Error(
                '[CharacterStatsView] Verification failed: ' +
                failures.join('; ')
            );
        }
    })();

})();
