/**
 * js/modules/characters/character-detail.js - Character Detail View
 * Tabbed interface for viewing all character information.
 *
 * Path: js/modules/characters/character-detail.js
 *
 * SECURITY CONTRACT:
 *   Every dynamic value entering an HTML string must pass through
 *   escapeHtml(), except values originating exclusively from
 *   hard-coded internal constants. This is a strict invariant
 *   enforced throughout this module.
 *
 *   Two narrow exceptions are documented at their call sites:
 *     - renderRow() takes a PRE-ESCAPED valueHtml. Callers must
 *       escape before passing. renderRowEscaped is the safe
 *       wrapper for the common case.
 *     - CSS colour values pass through sanitizeCssValue (or
 *       getSafeColor as a fallback) before being used in a style
 *       attribute, in addition to escapeHtml.
 *
 * MODAL CONTRACT:
 *   Modal.createModal() returns a BARE .modal shell with no
 *   children. This module builds its own .modal-content wrapper.
 *   Click-outside and Escape handling are delegated to
 *   Modal.modalSetup(), which also handles the drag-release
 *   guard. The module does NOT attach its own document-level
 *   handlers.
 *
 * IMPORTANT:
 *   - RENDER ONLY. No mutations, no persistence.
 *   - All cross-domain data comes from CharacterAggregator.
 *   - Stat keys come from CharacterConstants (lazy).
 *   - Magic keys come from MagicConstants (lazy).
 *   - Modal lifecycle comes from Modal.
 *   - Escaping comes from DomUtils.
 *   - Callbacks are dispatched as DOM CustomEvents.
 *
 * DEPENDENCIES:
 *   - window.CharacterAggregator (mandatory)
 *   - window.CharacterQueries (mandatory)
 *   - window.DomUtils (mandatory)
 *   - window.Modal (mandatory)
 *   - window.CharacterConstants (lazy; STAT_KEYS, format labels)
 *   - window.MagicConstants (lazy; type keys, category order)
 *
 * USAGE:
 *   var CD = window.CharacterDetail;
 *   CD.open('char_123');
 *   CD.close();
 *   CD.switchTab('stats');
 */

(function() {
    'use strict';

    if (window.__characterDetailLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY ACCESS - LAZY
    // ============================================================

    function getCharacterAggregator() { return window.CharacterAggregator || null; }
    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getDomUtils() { return window.DomUtils || null; }
    function getModal() { return window.Modal || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getMagicConstants() { return window.MagicConstants || null; }

    function getStatKeys() {
        var CC = getCharacterConstants();
        if (CC && Array.isArray(CC.STAT_KEYS)) {
            return CC.STAT_KEYS;
        }
        return ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    }

    function getNameFormatLabels() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.getNameFormatLabels === 'function') {
            return CC.getNameFormatLabels();
        }
        return {
            'firstlast': 'First + Last',
            'lastfirst': 'Last, First',
            'nicklast':  'Nickname + Last',
            'firstnick': 'First "Nickname"',
            'alias':     'Alias'
        };
    }

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        characterId: null,
        activeTab: 'name'
    };

    var VALID_TABS = {
        name: true,
        physical: true,
        personality: true,
        career: true,
        academic: true,
        stats: true,
        social: true,
        notes: true
    };

    var TAB_ORDER = [
        'name', 'physical', 'personality', 'career',
        'academic', 'stats', 'social', 'notes'
    ];

    // ============================================================
    // CONSTANTS
    // ============================================================

    var ALLOWED_COLORS = {
        '#8cbb3a': true,
        '#c9a24b': true,
        '#c1453c': true,
        '#4a9bc7': true,
        '#9b59b6': true,
        '#e67e22': true,
        '#27ae60': true,
        '#7f8c8d': true
    };

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var Agg = getCharacterAggregator();
        if (!Agg || typeof Agg.getCharacterDetail !== 'function') {
            missing.push('CharacterAggregator.getCharacterDetail');
        }

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CQ || typeof CQ.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        var DU = getDomUtils();
        if (!DU || typeof DU.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        var M = getModal();
        if (!M || typeof M.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterDetail] Missing dependencies:',
                missing.join(', ')
            );
            return false;
        }

        return true;
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeHtml === 'function') {
            return DU.escapeHtml(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
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
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // COLOR SAFETY
    // ============================================================

    /**
     * Sanitise a CSS colour value for use in a style attribute.
     *
     * Prefers DomUtils.sanitizeCssValue, which uses a strict
     * allowlist (hex, rgb/rgba, hsl/hsla, safe keywords). Falls back
     * to the local relationship-colour allowlist when sanitizeCssValue
     * is unavailable. Returns a safe default when neither applies.
     */
    function getSafeColor(color) {
        var DU = getDomUtils();
        if (DU && typeof DU.sanitizeCssValue === 'function') {
            var sanitised = DU.sanitizeCssValue(color);
            if (sanitised !== '') {
                return sanitised;
            }
            return '#7f8c8d';
        }

        // Fallback: allowlist-only.
        if (!color || typeof color !== 'string') {
            return '#7f8c8d';
        }
        var normalized = color.toLowerCase();
        if (ALLOWED_COLORS[normalized]) {
            return normalized;
        }
        return '#7f8c8d';
    }

    // ============================================================
    // OPEN / CLOSE
    // ============================================================

    function open(charId) {
        if (!checkDependencies()) {
            return;
        }

        if (!charId) {
            console.warn('[CharacterDetail] charId is required');
            return;
        }

        var Agg = getCharacterAggregator();
        var detail = Agg.getCharacterDetail(charId);
        if (!detail) {
            console.warn('[CharacterDetail] Character not found:', charId);
            return;
        }

        state.characterId = charId;
        state.activeTab = 'name';

        var modal = document.getElementById('character-detail-modal');
        if (!modal) {
            createModal();
            modal = document.getElementById('character-detail-modal');
        }

        render(detail);
        switchTab('name');
        getModal().showModal(modal);
    }

    function close() {
        var modal = document.getElementById('character-detail-modal');
        if (modal) {
            getModal().closeModal(modal);
        }
        state.characterId = null;
    }

    // ============================================================
    // MODAL CREATION
    // ============================================================

    function createModal() {
        if (!checkDependencies()) {
            return;
        }

        var Modal = getModal();
        var modal = Modal.createModal('character-detail-modal');
        modal.id = 'character-detail-modal';

        // Accessible name for the dialog comes from the title
        // element rendered below.
        modal.setAttribute('aria-labelledby', 'detail-character-name');

        // Modal.createModal returns a BARE .modal shell. We build
        // our own .modal-content wrapper here.
        var content = document.createElement('div');
        content.className = 'modal-content wide';
        modal.appendChild(content);

        // ---- Header ----
        var header = document.createElement('div');
        header.className = 'modal-header';

        var title = document.createElement('h3');
        title.id = 'detail-character-name';
        title.textContent = 'Character';
        header.appendChild(title);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'close-modal';
        closeBtn.id = 'close-character-detail';
        closeBtn.textContent = '\u00d7';
        closeBtn.setAttribute('aria-label', 'Close');
        header.appendChild(closeBtn);

        content.appendChild(header);

        // ---- Body ----
        var body = document.createElement('div');
        body.className = 'modal-body';

        // Tabs
        var tabs = document.createElement('div');
        tabs.className = 'detail-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;' +
            'margin-bottom:12px;border-bottom:1px solid var(--border);' +
            'padding-bottom:8px;';

        var tabNames = {
            name: 'Name',
            physical: 'Physical',
            personality: 'Personality',
            career: 'Career',
            academic: 'Academic',
            stats: 'Stats',
            social: 'Social',
            notes: 'Notes'
        };

        for (var ti = 0; ti < TAB_ORDER.length; ti++) {
            var tab = TAB_ORDER[ti];
            var btn = document.createElement('button');
            btn.className = 'detail-tab-btn' +
                (tab === state.activeTab ? ' active' : '');
            btn.dataset.tab = tab;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected',
                tab === state.activeTab ? 'true' : 'false');
            btn.setAttribute('aria-controls', 'detail-' + tab);
            btn.setAttribute('tabindex',
                tab === state.activeTab ? '0' : '-1');
            btn.textContent = tabNames[tab];
            btn.style.cssText =
                'background:transparent;border:none;' +
                'padding:4px 12px;cursor:pointer;font-size:0.7rem;' +
                'color:' +
                    (tab === state.activeTab
                        ? 'var(--accent)' : 'var(--text-dim)') +
                ';border-bottom:2px solid ' +
                    (tab === state.activeTab
                        ? 'var(--accent)' : 'transparent') + ';';
            tabs.appendChild(btn);
        }

        body.appendChild(tabs);

        // Tab content container
        var tabContent = document.createElement('div');
        tabContent.id = 'detail-tab-content';

        var panels = document.createElement('div');
        panels.id = 'detail-tab-panels';

        for (var pi = 0; pi < TAB_ORDER.length; pi++) {
            var tabName = TAB_ORDER[pi];
            var panel = document.createElement('div');
            panel.id = 'detail-' + tabName;
            panel.className = 'detail-tab-panel' +
                (tabName === state.activeTab ? ' active' : '');
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby',
                'detail-tab-btn-' + tabName);
            panel.style.cssText = 'display:' +
                (tabName === state.activeTab ? 'block' : 'none') + ';';
            panels.appendChild(panel);
        }

        tabContent.appendChild(panels);
        body.appendChild(tabContent);

        // Actions
        var actions = document.createElement('div');
        actions.className = 'form-actions';
        actions.style.cssText = 'display:flex;gap:8px;' +
            'justify-content:flex-end;margin-top:12px;' +
            'padding-top:12px;border-top:1px solid var(--border);';

        var editBtn = document.createElement('button');
        editBtn.id = 'edit-character-from-detail';
        editBtn.className = 'primary';
        editBtn.textContent = 'Edit Character';
        editBtn.style.cssText = 'padding:4px 12px;font-size:0.75rem;';
        actions.appendChild(editBtn);

        var closeBtn2 = document.createElement('button');
        closeBtn2.id = 'close-character-detail-btn';
        closeBtn2.className = 'secondary';
        closeBtn2.textContent = 'Close';
        closeBtn2.style.cssText = 'padding:4px 12px;font-size:0.75rem;';
        actions.appendChild(closeBtn2);

        body.appendChild(actions);

        content.appendChild(body);

        document.body.appendChild(modal);

        // ---- Event listeners ----
        document.getElementById('close-character-detail')
            .addEventListener('click', close);
        document.getElementById('close-character-detail-btn')
            .addEventListener('click', close);

        // Tab switching: click.
        var tabButtons = tabs.querySelectorAll('.detail-tab-btn');
        for (var bi = 0; bi < tabButtons.length; bi++) {
            (function(btn) {
                btn.addEventListener('click', function() {
                    var tab = btn.dataset.tab;
                    if (tab) { switchTab(tab); }
                });
            })(tabButtons[bi]);
        }

        // Tab switching: keyboard (Left, Right, Home, End).
        tabs.addEventListener('keydown', function(e) {
            var idx = TAB_ORDER.indexOf(state.activeTab);
            if (idx === -1) { idx = 0; }
            var next = idx;

            if (e.key === 'ArrowRight') {
                next = (idx + 1) % TAB_ORDER.length;
            } else if (e.key === 'ArrowLeft') {
                next = (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
            } else if (e.key === 'Home') {
                next = 0;
            } else if (e.key === 'End') {
                next = TAB_ORDER.length - 1;
            } else {
                return;
            }

            e.preventDefault();
            switchTab(TAB_ORDER[next]);
            var newBtn = tabs.querySelector(
                '.detail-tab-btn[data-tab="' + TAB_ORDER[next] + '"]'
            );
            if (newBtn && typeof newBtn.focus === 'function') {
                try { newBtn.focus(); } catch (err) {}
            }
        });

        // Edit button dispatches a CustomEvent.
        document.getElementById('edit-character-from-detail')
            .addEventListener('click', function() {
                var id = state.characterId;
                if (id) {
                    close();
                    var event = new CustomEvent('characterEdit', {
                        detail: { characterId: id },
                        bubbles: true,
                        cancelable: false
                    });
                    document.dispatchEvent(event);
                }
            });

        // Click-outside and Escape are delegated to Modal.modalSetup.
        // The shell element itself is passed so Modal's cleanup
        // installs on this modal, not on a parent.
        getModal().modalSetup(modal, close);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(detail) {
        if (!detail) {
            return;
        }

        var name = detail.name || 'Character';
        var nameEl = document.getElementById('detail-character-name');
        if (nameEl) {
            nameEl.textContent = name;
        }

        var tab = state.activeTab;
        var panel = document.getElementById('detail-' + tab);
        if (!panel) {
            console.warn(
                '[CharacterDetail] render: no panel for tab "' + tab + '"'
            );
            return;
        }

        panel.innerHTML = renderTabContent(tab, detail);
    }

    function refresh() {
        if (!state.characterId) {
            return;
        }

        var Agg = getCharacterAggregator();
        var detail = Agg.getCharacterDetail(state.characterId);
        if (detail) {
            render(detail);
        }
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function switchTab(tab) {
        if (!tab || !VALID_TABS[tab]) {
            return;
        }

        state.activeTab = tab;

        var modal = document.getElementById('character-detail-modal');
        if (!modal) {
            return;
        }

        // Update tab buttons.
        var tabButtons = modal.querySelectorAll('.detail-tab-btn');
        for (var i = 0; i < tabButtons.length; i++) {
            var btn = tabButtons[i];
            var isActive = btn.dataset.tab === tab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.setAttribute('tabindex', isActive ? '0' : '-1');
            btn.style.color = isActive
                ? 'var(--accent)'
                : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive
                ? 'var(--accent)'
                : 'transparent';
        }

        // Update panels.
        var panels = modal.querySelectorAll('.detail-tab-panel');
        for (var j = 0; j < panels.length; j++) {
            var panel = panels[j];
            var panelId = panel.id.replace('detail-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        }

        // Render content.
        var Agg = getCharacterAggregator();
        var detail = Agg.getCharacterDetail(state.characterId);
        if (!detail) { return; }

        var panel = document.getElementById('detail-' + tab);
        if (panel) {
            panel.innerHTML = renderTabContent(tab, detail);
        }
    }

    // ============================================================
    // TAB DISPATCH
    // ============================================================

    function renderTabContent(tab, detail) {
        switch (tab) {
            case 'name':        return renderNameTab(detail);
            case 'physical':    return renderPhysicalTab(detail);
            case 'personality': return renderPersonalityTab(detail);
            case 'career':      return renderCareerTab(detail);
            case 'academic':    return renderAcademicTab(detail);
            case 'stats':       return renderStatsTab(detail);
            case 'social':      return renderSocialTab(detail);
            case 'notes':       return renderNotesTab(detail);
            default:            return '';
        }
    }

    // ============================================================
    // TAB RENDERERS
    // ============================================================
    //
    // Every dynamic value entering these strings passes through
    // escapeHtml. See the file header's SECURITY CONTRACT.

    var ROW_STYLE =
        'display:flex;justify-content:space-between;' +
        'padding:4px 0;border-bottom:1px solid var(--border-soft);';

    var LABEL_STYLE =
        'color:var(--text-dim);font-size:0.8rem;';

    var SECTION_STYLE =
        'display:flex;flex-direction:column;gap:4px;';

    /**
     * Build a row with a pre-escaped valueHtml.
     *
     * CONTRACT: valueHtml MUST already be escaped. Use
     * renderRowEscaped for the common case where the value is a
     * plain string.
     */
    function renderRow(label, valueHtml) {
        return '<div class="detail-row" style="' + ROW_STYLE + '">' +
                    '<span class="label" style="' + LABEL_STYLE + '">' +
                        escapeHtml(label) + ':' +
                    '</span>' +
                    '<span>' + valueHtml + '</span>' +
                '</div>';
    }

    function renderRowEscaped(label, value) {
        var display = (value === undefined || value === null || value === '')
            ? '-'
            : value;
        return renderRow(label, escapeHtml(display));
    }

    // ---- Name tab ----

    function renderNameTab(detail) {
        var formatLabels = getNameFormatLabels();

        var char = detail.character || {};
        var nameFormat = char.nameFormat || 'firstlast';

        var html = '<div class="detail-section" style="' +
            SECTION_STYLE + '">';

        html += renderRow(
            'Display Name',
            '<span style="font-weight:600;font-size:1.1rem;' +
                'color:var(--accent);">' +
                escapeHtml(detail.name) +
            '</span>'
        );
        html += renderRowEscaped('First Name',   char.firstName || '-');
        html += renderRowEscaped('Middle Name',  char.middleName || '-');
        html += renderRowEscaped('Last Name',    char.lastName || '-');
        html += renderRowEscaped('Nickname',     char.nickname || '-');
        html += renderRowEscaped('Alias',        char.alias || '-');

        var previousNames = Array.isArray(char.previousNames)
            ? char.previousNames.join(', ')
            : '-';
        html += renderRowEscaped('Previous Names', previousNames);

        html += renderRowEscaped(
            'Display Format',
            formatLabels[nameFormat] || 'First + Last'
        );
        html += renderRowEscaped('Age',          detail.age);
        html += renderRowEscaped('Year of Birth', char.birthYear || '-');
        html += renderRowEscaped('Gender',       char.gender || '-');
        html += renderRowEscaped('Attraction',   char.attraction || '-');
        html += renderRowEscaped('Sexuality',    char.sexuality || '-');
        html += renderRowEscaped('Status',       detail.status);

        if (detail.deceased) {
            html += renderRow(
                'Deceased',
                '<span style="color:var(--danger);font-weight:600;">' +
                    'Yes' +
                '</span>'
            );
            if (detail.deathYear) {
                html += renderRowEscaped('Year of Death', detail.deathYear);
            }
            if (detail.deathAge) {
                html += renderRowEscaped('Death Age', detail.deathAge);
            }
            if (detail.deathCause) {
                html += renderRowEscaped('Cause of Death', detail.deathCause);
            }
            if (detail.deathWeek) {
                html += renderRowEscaped('Death Week', detail.deathWeek);
            }
        }

        html += '</div>';
        return html;
    }

    // ---- Physical tab ----

    function renderPhysicalTab(detail) {
        var char = detail.character || {};
        var html = '<div class="detail-section" style="' +
            SECTION_STYLE + '">';

        html += renderRowEscaped('Eye Color',          char.eyes || '-');
        html += renderRowEscaped('Hair Color',         char.hair || '-');
        html += renderRowEscaped('Skin Color/Tone',    char.skin || '-');
        html += renderRowEscaped('Height',             char.height || '-');
        html += renderRowEscaped('Weight',             char.weight || '-');
        html += renderRowEscaped('Build',              char.build || '-');

        html += renderRow(
            'Appearance Notes',
            '<span style="white-space:pre-wrap;">' +
                escapeHtml(char.appearanceNotes || '-') +
            '</span>'
        );

        html += '</div>';
        return html;
    }

    // ---- Personality tab ----

    function renderPersonalityTab(detail) {
        var p = detail.personality || {};
        var html = '<div class="detail-section" style="' +
            SECTION_STYLE + '">';

        html += renderRowEscaped('Traits',    p.traits || '-');
        html += renderRowEscaped('Ideals',    p.ideals || '-');
        html += renderRowEscaped('Bonds',     p.bonds || '-');
        html += renderRowEscaped('Flaws',     p.flaws || '-');
        html += renderRowEscaped('Alignment', p.alignment || '-');
        html += renderRowEscaped('Likes',     p.likes || '-');
        html += renderRowEscaped('Dislikes',  p.dislikes || '-');
        html += renderRowEscaped('Habits',    p.habits || '-');
        html += renderRowEscaped('Fears',     p.fears || '-');
        html += renderRowEscaped('Goals',     p.goals || '-');

        html += '</div>';
        return html;
    }

    // ---- Career tab ----

    function renderCareerTab(detail) {
        var html = '<div class="detail-section" style="' +
            SECTION_STYLE + '">';

        // Career status history.
        html += '<h4 style="color:var(--accent);font-size:0.85rem;' +
            'margin:4px 0 8px 0;">Career Status History</h4>';

        if (detail.careerHistory && detail.careerHistory.length > 0) {
            for (var ci = 0; ci < detail.careerHistory.length; ci++) {
                var status = detail.careerHistory[ci];
                var label = status.status
                    ? status.status.charAt(0).toUpperCase() +
                        status.status.slice(1)
                    : '';
                html += '<div style="padding:4px 8px;' +
                    'background:var(--bg);border-radius:4px;' +
                    'border-left:3px solid var(--accent);' +
                    'margin-bottom:4px;font-size:0.75rem;">' +
                        '<span style="font-weight:600;">' +
                            escapeHtml(label) +
                        '</span>' +
                        ' <span style="color:var(--text-dim);' +
                            'font-size:0.7rem;">(' +
                            escapeHtml(status.period) +
                        ')</span>' +
                    '</div>';
            }
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No career history</p>';
        }

        // Specialty.
        html += '<h4 style="color:var(--info);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Specialty</h4>';
        html += '<div style="padding:4px 8px;background:var(--bg);' +
            'border-radius:4px;font-size:0.75rem;">' +
            escapeHtml(detail.specialty || 'None specified') +
            '</div>';

        // Three team sections.
        html += renderTeamSection(
            'Professional Teams',
            detail.professionalTeams,
            'var(--info)'
        );
        html += renderTeamSection(
            'Temporary Teams',
            detail.temporaryTeams,
            'var(--warning)'
        );
        html += renderTeamSection(
            'Civilian Teams',
            detail.civilianTeams,
            'var(--text-dim)'
        );

        // Missions.
        html += '<h4 style="color:var(--warning);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Missions</h4>';

        if (detail.missions && detail.missions.length > 0) {
            for (var mi = 0; mi < detail.missions.length; mi++) {
                var m = detail.missions[mi];
                var statusColor =
                    m.status === 'completed' ? 'var(--accent)' :
                    m.status === 'cancelled' ? 'var(--danger)' :
                                               'var(--warning)';

                var row = '<div style="padding:4px 8px;' +
                    'background:var(--bg);border-radius:4px;' +
                    'border-left:3px solid ' + statusColor + ';' +
                    'margin-bottom:4px;font-size:0.75rem;">' +
                        '<span><strong>' +
                            escapeHtml(m.title) +
                        '</strong> <span style="color:' + statusColor +
                            ';font-size:0.65rem;">' +
                            escapeHtml(m.status) +
                        '</span>' +
                        ' <span style="color:var(--text-dim);' +
                            'font-size:0.65rem;">[' +
                            escapeHtml(m.teamName) +
                        ']</span>';

                if (m.location) {
                    row += ' <span style="color:var(--text-dim);' +
                        'font-size:0.65rem;">(' +
                        escapeHtml(m.location) +
                        ')</span>';
                }

                row += '</div>';
                html += row;
            }
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No missions assigned</p>';
        }

        html += '</div>';
        return html;
    }

    function renderTeamSection(heading, teams, accentColor) {
        var html = '<h4 style="color:' + accentColor +
            ';font-size:0.85rem;margin:8px 0 4px 0;">' +
            escapeHtml(heading) +
            '</h4>';

        if (!teams || teams.length === 0) {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No ' +
                escapeHtml(heading.toLowerCase()) +
                '</p>';
            return html;
        }

        for (var ti = 0; ti < teams.length; ti++) {
            var team = teams[ti];
            var row = '<div style="padding:4px 8px;' +
                'background:var(--bg);border-radius:4px;' +
                'border-left:3px solid ' + accentColor + ';' +
                'margin-bottom:4px;font-size:0.75rem;">' +
                    '<span><strong>' +
                        escapeHtml(team.name) +
                    '</strong> <span style="color:var(--text-dim);' +
                        'font-size:0.7rem;">(' +
                        escapeHtml(team.periodDisplay) +
                    ')</span></span>';

            if (team.role) {
                row += ' <span style="color:var(--text-dim);' +
                    'font-size:0.65rem;">[' +
                    escapeHtml(team.role) +
                    ']</span>';
            }

            row += '</div>';
            html += row;
        }

        return html;
    }

    // ---- Academic tab ----

    function renderAcademicTab(detail) {
        var html = '<div class="detail-section" style="' +
            SECTION_STYLE + '">';

        // Academic teams.
        html += '<h4 style="color:var(--accent);font-size:0.85rem;' +
            'margin:4px 0 8px 0;">Academic Teams</h4>';

        if (detail.academicTeams && detail.academicTeams.length > 0) {
            for (var ti = 0; ti < detail.academicTeams.length; ti++) {
                var team = detail.academicTeams[ti];
                var row = '<div style="padding:4px 8px;' +
                    'background:var(--bg);border-radius:4px;' +
                    'border-left:3px solid var(--accent);' +
                    'margin-bottom:4px;font-size:0.75rem;">' +
                        '<span><strong>' +
                            escapeHtml(team.name) +
                        '</strong>' +
                        escapeHtml(team.classDisplay) +
                        ' <span style="color:var(--text-dim);' +
                            'font-size:0.7rem;">(' +
                            escapeHtml(team.periodDisplay) +
                        ')</span></span>';

                if (team.role) {
                    row += ' <span style="color:var(--text-dim);' +
                        'font-size:0.65rem;">[' +
                        escapeHtml(team.role) +
                        ']</span>';
                }

                row += '</div>';
                html += row;
            }
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No academic teams</p>';
        }

        // Classes.
        html += '<h4 style="color:var(--info);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Classes</h4>';

        if (detail.classNames && detail.classNames.length > 0) {
            var classList = detail.classNames
                .map(function(name) { return escapeHtml(name); })
                .join(', ');
            html += '<div style="padding:4px 8px;background:var(--bg);' +
                'border-radius:4px;font-size:0.75rem;">' +
                classList +
                '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No classes</p>';
        }

        // Grades.
        html += '<h4 style="color:var(--info);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Grades</h4>';

        if (detail.grades && detail.grades.length > 0) {
            html += '<div style="max-height:120px;overflow-y:auto;' +
                'font-size:0.7rem;">';
            for (var gi = 0; gi < detail.grades.length; gi++) {
                var g = detail.grades[gi];
                var statusColor = g.passing
                    ? 'var(--accent)'
                    : 'var(--danger)';
                html += '<div style="padding:3px 8px;' +
                    'background:var(--bg);border-radius:3px;' +
                    'margin-bottom:2px;display:flex;' +
                    'justify-content:space-between;">' +
                        '<span>' +
                            escapeHtml(g.disciplineName) +
                            ' (Wk ' + escapeHtml(String(g.week)) + ')' +
                        '</span>' +
                        '<span style="color:' + statusColor +
                            ';font-weight:600;">' +
                            escapeHtml(g.scoreDisplay) +
                        '</span>' +
                    '</div>';
            }
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No grades recorded</p>';
        }

        // Tournament eliminations.
        html += '<h4 style="color:var(--danger);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Tournament Eliminations</h4>';

        if (detail.tournamentEliminations &&
            detail.tournamentEliminations.length > 0) {
            for (var tei = 0; tei < detail.tournamentEliminations.length; tei++) {
                var elim = detail.tournamentEliminations[tei];
                var rowE = '<div style="padding:3px 8px;' +
                    'background:var(--bg);border-radius:4px;' +
                    'border-left:3px solid var(--danger);' +
                    'margin-bottom:3px;font-size:0.7rem;">' +
                        '<span><strong>' +
                            escapeHtml(elim.tournamentName) +
                        '</strong> - Week ' +
                        escapeHtml(String(elim.week));

                if (elim.reason) {
                    rowE += ' (' + escapeHtml(elim.reason) + ')';
                }

                rowE += '</span></div>';
                html += rowE;
            }
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No tournament eliminations</p>';
        }

        // Standalone eliminations.
        html += '<h4 style="color:var(--warning);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Standalone Eliminations</h4>';

        if (detail.standaloneEliminations &&
            detail.standaloneEliminations.length > 0) {
            for (var sei = 0; sei < detail.standaloneEliminations.length; sei++) {
                var elimS = detail.standaloneEliminations[sei];
                var rowS = '<div style="padding:3px 8px;' +
                    'background:var(--bg);border-radius:4px;' +
                    'border-left:3px solid var(--warning);' +
                    'margin-bottom:3px;font-size:0.7rem;">' +
                        '<span>Week ' + escapeHtml(String(elimS.week));

                if (elimS.reason) {
                    rowS += ' - ' + escapeHtml(elimS.reason);
                }

                rowS += '</span></div>';
                html += rowS;
            }
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No standalone eliminations</p>';
        }

        // Elimination status.
        html += '<h4 style="color:var(--danger);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Elimination Status</h4>';

        var statusColor = detail.isEliminated
            ? 'var(--danger)'
            : 'var(--accent)';

        var statusText = detail.isEliminated
            ? '\u2715 Eliminated'
            : '\u2713 Not eliminated';

        if (detail.isEliminated && detail.eliminationWeek) {
            statusText += ' (Week ' + detail.eliminationWeek + ')';
        }
        if (detail.isEliminated &&
            detail.eliminationReason &&
            detail.eliminationReason !== 'Unknown') {
            statusText += ' - ' + detail.eliminationReason;
        }

        html += '<div style="padding:4px 8px;background:var(--bg);' +
            'border-radius:4px;border-left:3px solid ' + statusColor +
            ';font-size:0.75rem;">' +
            escapeHtml(statusText) +
            '</div>';

        // Schedule summary.
        html += '<h4 style="color:var(--warning);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Schedule Summary</h4>';
        html += '<div style="padding:4px 8px;background:var(--bg);' +
            'border-radius:4px;font-size:0.75rem;">' +
            'Total classes scheduled: <strong>' +
            escapeHtml(String(detail.scheduleCount || 0)) +
            '</strong></div>';

        html += '</div>';
        return html;
    }

    // ---- Stats tab ----

    function renderStatsTab(detail) {
        var html = '<div class="detail-section" style="' +
            SECTION_STYLE + '">';

        // Physical stats.
        html += '<h4 style="color:var(--accent);font-size:0.85rem;' +
            'margin:4px 0 8px 0;">Physical Stats</h4>';
        html += '<div style="display:grid;' +
            'grid-template-columns:repeat(6,1fr);gap:8px;' +
            'margin-bottom:12px;">';

        var statLabels = {
            str: { label: 'STR', color: 'var(--accent)' },
            dex: { label: 'DEX', color: 'var(--accent)' },
            con: { label: 'CON', color: 'var(--accent)' },
            int: { label: 'INT', color: 'var(--info)' },
            wis: { label: 'WIS', color: 'var(--info)' },
            cha: { label: 'CHA', color: 'var(--info)' }
        };

        var stats = detail.stats || {};
        var statKeys = getStatKeys();

        for (var si = 0; si < statKeys.length; si++) {
            var key = statKeys[si];
            var labelDef = statLabels[key] || {
                label: key.toUpperCase(),
                color: 'var(--accent)'
            };
            var s = stats[key] || {
                value: 10,
                modifier: 0,
                modifierDisplay: '+0'
            };
            var modColor = s.modifier > 0
                ? 'var(--accent)'
                : (s.modifier < 0
                    ? 'var(--danger)'
                    : 'var(--text-dim)');

            html += '<div style="background:var(--bg);' +
                'padding:6px 10px;border-radius:4px;' +
                'border:1px solid var(--border-soft);' +
                'text-align:center;">' +
                    '<div style="font-size:0.6rem;color:' +
                        labelDef.color + ';">' +
                        labelDef.label +
                    '</div>' +
                    '<div style="font-size:1.2rem;font-weight:700;' +
                        'color:var(--accent);">' +
                        escapeHtml(s.value) +
                    '</div>' +
                    '<div style="font-size:0.65rem;color:' +
                        modColor + ';">' +
                        escapeHtml(s.modifierDisplay) +
                    '</div>' +
                '</div>';
        }

        html += '</div>';

        // Magic stats. Iterate in the canonical category order.
        html += '<h4 style="color:var(--info);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Magic Stats</h4>';
        html += '<div style="display:grid;' +
            'grid-template-columns:repeat(6,1fr);gap:4px;' +
            'margin-bottom:12px;">';

        var magic = detail.magic || {};
        var MC = getMagicConstants();
        var magicKeys;

        if (MC && typeof MC.getTypeKeys === 'function') {
            var ordered = [];
            if (typeof MC.getCategoryOrder === 'function') {
                var catOrder = MC.getCategoryOrder();
                for (var co = 0; co < catOrder.length; co++) {
                    var catTypes = MC.getCategoryTypes
                        ? MC.getCategoryTypes(catOrder[co])
                        : [];
                    for (var ct = 0; ct < catTypes.length; ct++) {
                        ordered.push(catTypes[ct]);
                    }
                }
            } else {
                ordered = MC.getTypeKeys();
            }
            magicKeys = ordered;
        } else {
            magicKeys = Object.keys(magic);
        }

        if (magicKeys.length === 0) {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No magic data</p>';
        } else {
            for (var mki = 0; mki < magicKeys.length; mki++) {
                var mk = magicKeys[mki];
                var m = magic[mk];
                if (!m) { continue; }

                var safeColor = getSafeColor(m.color);

                html += '<div style="background:var(--bg);' +
                    'padding:2px 4px;border-radius:3px;' +
                    'border:1px solid var(--border-soft);' +
                    'text-align:center;">' +
                        '<div style="font-size:0.45rem;' +
                            'color:var(--text-dim);">' +
                            escapeHtml(m.label || mk) +
                        '</div>' +
                        '<div style="font-size:0.85rem;' +
                            'font-weight:700;color:' +
                            escapeHtml(safeColor) + ';">' +
                            escapeHtml(m.value) +
                        '</div>' +
                    '</div>';
            }
        }

        html += '</div>';

        // Special moves.
        html += '<h4 style="color:var(--accent);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Special Moves</h4>';

        var moves = detail.specialMoves || {
            physical: [],
            magical: []
        };

        html += renderMoveList(
            'Physical:',
            'var(--accent)',
            moves.physical,
            'No physical moves'
        );
        html += renderMoveList(
            'Magical:',
            'var(--info)',
            moves.magical,
            'No magical moves'
        );

        html += '</div>';
        return html;
    }

    function renderMoveList(heading, accentColor, moves, emptyMessage) {
        var html = '<div style="margin-bottom:4px;">';
        html += '<span style="font-size:0.75rem;color:' + accentColor +
            ';font-weight:600;">' + escapeHtml(heading) + '</span>';

        if (moves && moves.length > 0) {
            html += '<div style="margin-top:4px;">';
            for (var i = 0; i < moves.length; i++) {
                var m = moves[i];
                var row = '<div style="padding:2px 8px;' +
                    'background:var(--bg);border-radius:3px;' +
                    'margin-bottom:2px;border-left:2px solid ' +
                    accentColor + ';font-size:0.7rem;">' +
                        '<span style="font-weight:600;">' +
                            escapeHtml(m.name) +
                        '</span>';

                if (m.description) {
                    row += ' <span style="color:var(--text-dim);' +
                        'font-size:0.65rem;">- ' +
                        escapeHtml(m.description) +
                        '</span>';
                }

                row += '</div>';
                html += row;
            }
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">' +
                escapeHtml(emptyMessage) +
                '</p>';
        }

        html += '</div>';
        return html;
    }

    // ---- Social tab ----

    function renderSocialTab(detail) {
        var html = '<div class="detail-section" style="' +
            SECTION_STYLE + '">';

        html += '<h4 style="color:var(--accent);font-size:0.85rem;' +
            'margin:4px 0 8px 0;">Social Connections</h4>';

        var relationships = detail.relationships || [];

        if (relationships.length === 0) {
            html += '<p class="empty-state" style="padding:8px;' +
                'font-size:0.8rem;">No social connections</p>';
        } else {
            for (var ri = 0; ri < relationships.length; ri++) {
                var rel = relationships[ri];
                var safeColor = getSafeColor(rel.typeColor);

                var row = '<div style="padding:4px 8px;' +
                    'background:var(--bg);border-radius:4px;' +
                    'border-left:3px solid ' + escapeHtml(safeColor) +
                    ';margin-bottom:4px;font-size:0.75rem;">' +
                        '<span><strong>' +
                            escapeHtml(rel.otherName) +
                        '</strong> <span style="color:' +
                            escapeHtml(safeColor) + ';' +
                            'font-size:0.75rem;">' +
                            escapeHtml(rel.typeLabel);

                if (rel.clarification) {
                    row += ' (' + escapeHtml(rel.clarification) + ')';
                }

                row += '</span></span>';

                if (rel.period) {
                    row += ' <span style="color:var(--text-dim);' +
                        'font-size:0.65rem;">' +
                        escapeHtml(rel.period) +
                        '</span>';
                }

                if (rel.notes) {
                    // Monochrome "has notes" marker.
                    row += ' <span style="color:var(--text-dim);' +
                        'font-size:0.65rem;" ' +
                        'title="Has notes">' +
                        '\u25aa' +
                        '</span>';
                }

                row += '</div>';
                html += row;
            }
        }

        html += '</div>';
        return html;
    }

    // ---- Notes tab ----

    function renderNotesTab(detail) {
        var char = detail.character || {};
        var html = '<div class="detail-section">';
        html += '<div style="background:var(--bg);padding:12px;' +
            'border-radius:6px;border:1px solid var(--border-soft);' +
            'min-height:100px;">' +
                '<p style="white-space:pre-wrap;margin:0;' +
                    'font-size:0.8rem;">' +
                    escapeHtml(char.notes || 'No notes') +
                '</p>' +
            '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterDetail = {
        open: open,
        close: close,
        switchTab: switchTab,
        render: render,
        refresh: refresh
    };

    window.__characterDetailLoaded = true;

})();
