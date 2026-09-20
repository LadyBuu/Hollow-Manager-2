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
 * MODAL CONTENT CONTRACT:
 *   Modal.createModal() returns a BARE `.modal` shell with no
 *   children. This module builds its own `.modal-content` wrapper.
 *   See createModal() below.
 *
 * IMPORTANT:
 *   - RENDER ONLY. No mutations, no persistence.
 *   - All cross-domain data comes from CharacterAggregator.
 *   - All character-record data comes from CharacterQueries.
 *   - Stat calculations come from CharacterStats, via the
 *     aggregator.
 *   - Modal lifecycle comes from Modal.
 *   - Escaping comes from DomUtils.
 *   - Callbacks are dispatched as DOM CustomEvents; the character
 *     event layer listens.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterAggregator
 *   - window.CharacterQueries
 *   - window.DomUtils
 *   - window.Modal
 *   - window.CharacterConstants
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
    // DEPENDENCY IMPORTS - MANDATORY
    // ============================================================

    var CharacterAggregator = window.CharacterAggregator;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var CharacterConstants = window.CharacterConstants;

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

    // ============================================================
    // CONSTANTS
    // ============================================================

    var STAT_KEYS = CharacterConstants
        ? CharacterConstants.STAT_KEYS
        : ['str', 'dex', 'con', 'int', 'wis', 'cha'];

    var MAGIC_TYPE_KEYS = CharacterConstants
        ? CharacterConstants.MAGIC_TYPE_KEYS
        : [];

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

        if (!CharacterAggregator ||
            typeof CharacterAggregator.getCharacterDetail !== 'function') {
            missing.push('CharacterAggregator.getCharacterDetail');
        }

        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
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
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Emergency fallback (should never be reached).
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    // ============================================================
    // RELATIONSHIP HELPERS
    // ============================================================

    function getSafeColor(color) {
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

        var detail = CharacterAggregator.getCharacterDetail(charId);
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
        Modal.showModal(modal);
    }

    function close() {
        var modal = document.getElementById('character-detail-modal');
        if (modal) {
            Modal.closeModal(modal);
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

        var modal = Modal.createModal('character-detail-modal');
        modal.id = 'character-detail-modal';

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

        for (var tab in tabNames) {
            if (!Object.prototype.hasOwnProperty.call(tabNames, tab)) {
                continue;
            }
            var btn = document.createElement('button');
            btn.className = 'detail-tab-btn' +
                (tab === state.activeTab ? ' active' : '');
            btn.dataset.tab = tab;
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

        for (var tabName in tabNames) {
            if (!Object.prototype.hasOwnProperty.call(tabNames, tabName)) {
                continue;
            }
            var panel = document.createElement('div');
            panel.id = 'detail-' + tabName;
            panel.className = 'detail-tab-panel' +
                (tabName === state.activeTab ? ' active' : '');
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

        // Tab switching.
        tabs.querySelectorAll('.detail-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    switchTab(tab);
                }
            });
        });

        // Edit button dispatches a CustomEvent. CharacterEvents
        // listens for it.
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

        // Outside click closes.
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                close();
            }
        });
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
            return;
        }

        panel.innerHTML = renderTabContent(tab, detail);
    }

    function refresh() {
        if (!state.characterId) {
            return;
        }

        var detail = CharacterAggregator.getCharacterDetail(
            state.characterId
        );
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
        modal.querySelectorAll('.detail-tab-btn').forEach(function(btn) {
            var isActive = btn.dataset.tab === tab;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive
                ? 'var(--accent)'
                : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive
                ? 'var(--accent)'
                : 'transparent';
        });

        // Update panels.
        modal.querySelectorAll('.detail-tab-panel').forEach(function(panel) {
            var panelId = panel.id.replace('detail-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        });

        // Render content.
        var detail = CharacterAggregator.getCharacterDetail(
            state.characterId
        );
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

    // ---- Shared row styles ----
    //
    // These inline styles are duplicated across every detail row.
    // They are string constants so the renderers read linearly;
    // a future pass can hoist them into a stylesheet.

    var ROW_STYLE =
        'display:flex;justify-content:space-between;' +
        'padding:4px 0;border-bottom:1px solid var(--border-soft);';

    var LABEL_STYLE =
        'color:var(--text-dim);font-size:0.8rem;';

    var SECTION_STYLE =
        'display:flex;flex-direction:column;gap:4px;';

    function renderRow(label, valueHtml) {
        return '<div class="detail-row" style="' + ROW_STYLE + '">' +
                    '<span class="label" style="' + LABEL_STYLE + '">' +
                        escapeHtml(label) + ':' +
                    '</span>' +
                    '<span>' + valueHtml + '</span>' +
                '</div>';
    }

    function renderRowEscaped(label, value) {
        return renderRow(label, escapeHtml(value));
    }

    // ---- Name tab ----

    function renderNameTab(detail) {
        var formatLabels = {
            'firstlast': 'First + Last',
            'lastfirst': 'Last, First',
            'nicklast':  'Nickname + Last',
            'firstnick': 'First "Nickname"',
            'alias':     'Alias'
        };

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
            detail.careerHistory.forEach(function(status) {
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
            });
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

        // Three team sections. Same rendering shape; different
        // heading, accent, and source array.
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
            detail.missions.forEach(function(m) {
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
            });
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

        teams.forEach(function(team) {
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
        });

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
            detail.academicTeams.forEach(function(team) {
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
            });
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
            detail.grades.forEach(function(g) {
                var statusColor = g.passing
                    ? 'var(--accent)'
                    : 'var(--danger)';
                html += '<div style="padding:3px 8px;' +
                    'background:var(--bg);border-radius:3px;' +
                    'margin-bottom:2px;display:flex;' +
                    'justify-content:space-between;">' +
                        '<span>' +
                            escapeHtml(g.disciplineName) +
                            ' (Wk ' + escapeHtml(g.week) + ')' +
                        '</span>' +
                        '<span style="color:' + statusColor +
                            ';font-weight:600;">' +
                            escapeHtml(g.scoreDisplay) +
                        '</span>' +
                    '</div>';
            });
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
            detail.tournamentEliminations.forEach(function(elim) {
                var row = '<div style="padding:3px 8px;' +
                    'background:var(--bg);border-radius:4px;' +
                    'border-left:3px solid var(--danger);' +
                    'margin-bottom:3px;font-size:0.7rem;">' +
                        '<span><strong>' +
                            escapeHtml(elim.tournamentName) +
                        '</strong> - Week ' +
                        escapeHtml(elim.week);

                if (elim.reason) {
                    row += ' (' + escapeHtml(elim.reason) + ')';
                }

                row += '</span></div>';
                html += row;
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No tournament eliminations</p>';
        }

        // Standalone eliminations.
        html += '<h4 style="color:var(--warning);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Standalone Eliminations</h4>';

        if (detail.standaloneEliminations &&
            detail.standaloneEliminations.length > 0) {
            detail.standaloneEliminations.forEach(function(elim) {
                var row = '<div style="padding:3px 8px;' +
                    'background:var(--bg);border-radius:4px;' +
                    'border-left:3px solid var(--warning);' +
                    'margin-bottom:3px;font-size:0.7rem;">' +
                        '<span>Week ' + escapeHtml(elim.week);

                if (elim.reason) {
                    row += ' - ' + escapeHtml(elim.reason);
                }

                row += '</span></div>';
                html += row;
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No standalone eliminations</p>';
        }

        // Elimination status.
        //
        // The status string is built unescaped, then escaped once
        // as a whole. This is XSS-safe because every user-supplied
        // fragment (reason) is concatenated into the composite and
        // the composite is escaped. Do not add values after the
        // escapeHtml call.
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
            (detail.scheduleCount || 0) +
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

        for (var key in statLabels) {
            if (!Object.prototype.hasOwnProperty.call(statLabels, key)) {
                continue;
            }
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
                        statLabels[key].color + ';">' +
                        statLabels[key].label +
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

        // Magic stats.
        html += '<h4 style="color:var(--info);font-size:0.85rem;' +
            'margin:8px 0 4px 0;">Magic Stats</h4>';
        html += '<div style="display:grid;' +
            'grid-template-columns:repeat(6,1fr);gap:4px;' +
            'margin-bottom:12px;">';

        var magic = detail.magic || {};
        var magicKeys = Object.keys(magic);

        if (magicKeys.length === 0) {
            html += '<p class="empty-state" style="padding:4px;' +
                'font-size:0.7rem;">No magic data</p>';
        } else {
            magicKeys.forEach(function(mk) {
                var m = magic[mk] || {
                    value: 0,
                    label: mk,
                    level: 'Untrained',
                    color: 'var(--border)'
                };
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
                            escapeHtml(m.color) + ';">' +
                            escapeHtml(m.value) +
                        '</div>' +
                    '</div>';
            });
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
            moves.forEach(function(m) {
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
            });
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
            relationships.forEach(function(rel) {
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
                    // Monochrome "has notes" marker. Replaces the
                    // previous pictographic emoji.
                    row += ' <span style="color:var(--text-dim);' +
                        'font-size:0.65rem;" ' +
                        'title="Has notes">' +
                        '\u25aa' +
                        '</span>';
                }

                row += '</div>';
                html += row;
            });
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