/**
 * js/modules/characters/character-detail.js - Character Detail View
 * Tabbed interface for viewing all character information
 * Path: js/modules/characters/character-detail.js
 * 
 * This module is responsible for:
 *   - Displaying character details in a modal
 *   - Tabbed navigation between detail sections
 *   - Pure read-only rendering (no mutations)
 *   - HTML escaping for XSS prevention
 * 
 * SECURITY CONTRACT:
 *   Every dynamic value entering an HTML string must pass through escapeHtml(),
 *   except values originating exclusively from hard-coded internal constants.
 *   This is a strict invariant enforced throughout this module.
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses CharacterDetailQueries
 *   - Uses CharacterQueries for character data
 *   - Uses CharacterStats for stat calculations
 *   - Uses MagicConstants for magic definitions
 *   - Uses Modal for modal lifecycle
 *   - Uses DomUtils for safe DOM operations
 *   - All callbacks are delegated to CharacterEvents
 * 
 * DEPENDENCIES:
 *   - window.CharacterDetailQueries (from character-detail-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.CharacterStats (from character-stats.js) - MANDATORY
 *   - window.MagicConstants (from magic-constants.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.Modal (from modal.js) - MANDATORY
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 * 
 * USAGE:
 *   var CD = window.CharacterDetail;
 *   CD.open('char_123');
 *   CD.close();
 *   CD.switchTab('stats');
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterDetailLoaded) {
        return;
    }
    window.__characterDetailLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterDetailQueries = window.CharacterDetailQueries;
    var CharacterQueries = window.CharacterQueries;
    var CharacterStats = window.CharacterStats;
    var MagicConstants = window.MagicConstants;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var SocialQueries = window.SocialQueries;

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
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterDetailQueries || typeof CharacterDetailQueries.getCharacterDetail !== 'function') {
            missing.push('CharacterDetailQueries.getCharacterDetail');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (!SocialQueries || typeof SocialQueries.getRelationshipTypes !== 'function') {
            missing.push('SocialQueries.getRelationshipTypes');
        }

        if (missing.length > 0) {
            console.warn('CharacterDetail: Missing dependencies:', missing.join(', '));
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
        // Emergency fallback (should never be reached)
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
    // OPEN / CLOSE
    // ============================================================

    function open(charId) {
        if (!checkDependencies()) {
            return;
        }

        if (!charId) {
            console.warn('CharacterDetail: charId is required');
            return;
        }

        var detail = CharacterDetailQueries.getCharacterDetail(charId);
        if (!detail) {
            return;
        }

        state.characterId = charId;
        state.activeTab = 'name';

        // Create modal if it doesn't exist
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
        if (!checkDependencies()) return;

        var modal = Modal.createModal('character-detail-modal');
        modal.id = 'character-detail-modal';

        var content = modal.querySelector('.modal-content');
        content.className = 'modal-content wide';

        // Header
        var header = document.createElement('div');
        header.className = 'modal-header';

        var title = document.createElement('h3');
        title.id = 'detail-character-name';
        title.textContent = 'Character';
        header.appendChild(title);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'close-modal';
        closeBtn.id = 'close-character-detail';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Close');
        header.appendChild(closeBtn);

        content.appendChild(header);

        // Body
        var body = document.createElement('div');
        body.className = 'modal-body';

        // Tabs
        var tabs = document.createElement('div');
        tabs.className = 'detail-tabs';
        tabs.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--border);padding-bottom:8px;';

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
            if (!Object.prototype.hasOwnProperty.call(tabNames, tab)) continue;
            var btn = document.createElement('button');
            btn.className = 'detail-tab-btn' + (tab === state.activeTab ? ' active' : '');
            btn.dataset.tab = tab;
            btn.textContent = tabNames[tab];
            btn.style.cssText = 'background:transparent;border:none;padding:4px 12px;cursor:pointer;font-size:0.7rem;color:' + (tab === state.activeTab ? 'var(--accent)' : 'var(--text-dim)') + ';border-bottom:2px solid ' + (tab === state.activeTab ? 'var(--accent)' : 'transparent') + ';';
            tabs.appendChild(btn);
        }

        body.appendChild(tabs);

        // Tab content container
        var tabContent = document.createElement('div');
        tabContent.id = 'detail-tab-content';

        var panels = document.createElement('div');
        panels.id = 'detail-tab-panels';

        for (var tab in tabNames) {
            if (!Object.prototype.hasOwnProperty.call(tabNames, tab)) continue;
            var panel = document.createElement('div');
            panel.id = 'detail-' + tab;
            panel.className = 'detail-tab-panel' + (tab === state.activeTab ? ' active' : '');
            panel.style.cssText = 'display:' + (tab === state.activeTab ? 'block' : 'none') + ';';
            panels.appendChild(panel);
        }

        tabContent.appendChild(panels);
        body.appendChild(tabContent);

        // Actions
        var actions = document.createElement('div');
        actions.className = 'form-actions';
        actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);';

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

        // ---- Event Listeners ----
        document.getElementById('close-character-detail').addEventListener('click', close);
        document.getElementById('close-character-detail-btn').addEventListener('click', close);

        // Tab switching
        tabs.querySelectorAll('.detail-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    switchTab(tab);
                }
            });
        });

        // Edit button
        document.getElementById('edit-character-from-detail').addEventListener('click', function() {
            var id = state.characterId;
            if (id) {
                close();
                // Dispatch event for CharacterEvents to handle
                var event = new CustomEvent('characterEdit', {
                    detail: { characterId: id },
                    bubbles: true,
                    cancelable: false
                });
                document.dispatchEvent(event);
            }
        });

        // Modal close on outside click
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                close();
            }
        });

        // Escape key handled by Modal
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(detail) {
        if (!detail) return;

        var name = detail.name || 'Character';
        var nameEl = document.getElementById('detail-character-name');
        if (nameEl) {
            nameEl.textContent = name;
        }

        var tab = state.activeTab;
        var panel = document.getElementById('detail-' + tab);
        if (!panel) return;

        var html = '';

        switch(tab) {
            case 'name':
                html = renderNameTab(detail);
                break;
            case 'physical':
                html = renderPhysicalTab(detail);
                break;
            case 'personality':
                html = renderPersonalityTab(detail);
                break;
            case 'career':
                html = renderCareerTab(detail);
                break;
            case 'academic':
                html = renderAcademicTab(detail);
                break;
            case 'stats':
                html = renderStatsTab(detail);
                break;
            case 'social':
                html = renderSocialTab(detail);
                break;
            case 'notes':
                html = renderNotesTab(detail);
                break;
        }

        panel.innerHTML = html;
    }

    function refresh() {
        if (!state.characterId) return;

        var detail = CharacterDetailQueries.getCharacterDetail(state.characterId);
        if (detail) {
            render(detail);
        }
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function switchTab(tab) {
        if (!tab || !VALID_TABS[tab]) return;

        state.activeTab = tab;

        var modal = document.getElementById('character-detail-modal');
        if (!modal) return;

        // Update tab buttons
        modal.querySelectorAll('.detail-tab-btn').forEach(function(btn) {
            var isActive = btn.dataset.tab === tab;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });

        // Update panels
        modal.querySelectorAll('.detail-tab-panel').forEach(function(panel) {
            var panelId = panel.id.replace('detail-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        });

        // Render content if needed
        var detail = CharacterDetailQueries.getCharacterDetail(state.characterId);
        if (detail) {
            var panel = document.getElementById('detail-' + tab);
            if (panel) {
                var html = '';
                switch(tab) {
                    case 'name': html = renderNameTab(detail); break;
                    case 'physical': html = renderPhysicalTab(detail); break;
                    case 'personality': html = renderPersonalityTab(detail); break;
                    case 'career': html = renderCareerTab(detail); break;
                    case 'academic': html = renderAcademicTab(detail); break;
                    case 'stats': html = renderStatsTab(detail); break;
                    case 'social': html = renderSocialTab(detail); break;
                    case 'notes': html = renderNotesTab(detail); break;
                }
                panel.innerHTML = html;
            }
        }
    }

    // ============================================================
    // TAB RENDERERS - WITH HTML ESCAPING
    // ============================================================

    function renderNameTab(detail) {
        var html = '<div class="detail-section" style="display:flex;flex-direction:column;gap:4px;">';

        var formatLabels = {
            'firstlast': 'First + Last',
            'lastfirst': 'Last, First',
            'nicklast': 'Nickname + Last',
            'firstnick': 'First "Nickname"',
            'alias': 'Alias'
        };

        var nameFormat = detail.character.nameFormat || 'firstlast';

        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Display Name:</span> <span style="font-weight:600;font-size:1.1rem;color:var(--accent);">' + escapeHtml(detail.name) + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">First Name:</span> <span>' + escapeHtml(detail.character.firstName || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Middle Name:</span> <span>' + escapeHtml(detail.character.middleName || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Last Name:</span> <span>' + escapeHtml(detail.character.lastName || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Nickname:</span> <span>' + escapeHtml(detail.character.nickname || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Alias:</span> <span>' + escapeHtml(detail.character.alias || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Previous Names:</span> <span>' + escapeHtml((Array.isArray(detail.character.previousNames) ? detail.character.previousNames : []).join(', ') || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Display Format:</span> <span>' + escapeHtml(formatLabels[nameFormat] || 'First + Last') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Age:</span> <span>' + escapeHtml(detail.age) + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Year of Birth:</span> <span>' + escapeHtml(detail.character.birthYear || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Gender:</span> <span>' + escapeHtml(detail.character.gender || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Attraction:</span> <span>' + escapeHtml(detail.character.attraction || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Sexuality:</span> <span>' + escapeHtml(detail.character.sexuality || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Status:</span> <span>' + escapeHtml(detail.status) + '</span></div>';

        if (detail.deceased) {
            html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Deceased:</span> <span style="color:var(--danger);font-weight:600;">Yes</span></div>';
            if (detail.deathYear) {
                html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Year of Death:</span> <span>' + escapeHtml(detail.deathYear) + '</span></div>';
            }
            if (detail.deathAge) {
                html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Death Age:</span> <span>' + escapeHtml(detail.deathAge) + '</span></div>';
            }
            if (detail.deathCause) {
                html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Cause of Death:</span> <span>' + escapeHtml(detail.deathCause) + '</span></div>';
            }
            if (detail.deathWeek) {
                html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Death Week:</span> <span>' + escapeHtml(detail.deathWeek) + '</span></div>';
            }
        }

        html += '</div>';
        return html;
    }

    function renderPhysicalTab(detail) {
        var html = '<div class="detail-section" style="display:flex;flex-direction:column;gap:4px;">';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Eye Color:</span> <span>' + escapeHtml(detail.character.eyes || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Hair Color:</span> <span>' + escapeHtml(detail.character.hair || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Skin Color/Tone:</span> <span>' + escapeHtml(detail.character.skin || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Height:</span> <span>' + escapeHtml(detail.character.height || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Weight:</span> <span>' + escapeHtml(detail.character.weight || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Build:</span> <span>' + escapeHtml(detail.character.build || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Appearance Notes:</span> <span style="white-space:pre-wrap;">' + escapeHtml(detail.character.appearanceNotes || '-') + '</span></div>';
        html += '</div>';
        return html;
    }

    function renderPersonalityTab(detail) {
        var p = detail.character.personality || {};
        var html = '<div class="detail-section" style="display:flex;flex-direction:column;gap:4px;">';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Traits:</span> <span>' + escapeHtml(p.traits || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Ideals:</span> <span>' + escapeHtml(p.ideals || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Bonds:</span> <span>' + escapeHtml(p.bonds || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Flaws:</span> <span>' + escapeHtml(p.flaws || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Alignment:</span> <span>' + escapeHtml(p.alignment || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Likes:</span> <span>' + escapeHtml(p.likes || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Dislikes:</span> <span>' + escapeHtml(p.dislikes || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Habits:</span> <span>' + escapeHtml(p.habits || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Fears:</span> <span>' + escapeHtml(p.fears || '-') + '</span></div>';
        html += '<div class="detail-row" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft);"><span class="label" style="color:var(--text-dim);font-size:0.8rem;">Goals:</span> <span>' + escapeHtml(p.goals || '-') + '</span></div>';
        html += '</div>';
        return html;
    }

    function renderCareerTab(detail) {
        var html = '<div class="detail-section" style="display:flex;flex-direction:column;gap:4px;">';

        // Career Status History
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin:4px 0 8px 0;">Career Status History</h4>';

        if (detail.career && detail.career.history && detail.career.history.length > 0) {
            detail.career.history.forEach(function(status) {
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:4px;font-size:0.75rem;">';
                html += '<span style="font-weight:600;">' + escapeHtml(status.status.charAt(0).toUpperCase() + status.status.slice(1)) + '</span>';
                html += ' <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(status.period) + ')</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No career history</p>';
        }

        // Specialty
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin:8px 0 4px 0;">Specialty</h4>';
        html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;font-size:0.75rem;">' + escapeHtml(detail.character.specialty || 'None specified') + '</div>';

        // Professional Teams
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin:8px 0 4px 0;">Professional Teams</h4>';
        if (detail.professionalTeams && detail.professionalTeams.length > 0) {
            detail.professionalTeams.forEach(function(team) {
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--info);margin-bottom:4px;font-size:0.75rem;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(team.periodDisplay) + ')</span></span>';
                if (team.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(team.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No professional teams</p>';
        }

        // Temporary Teams
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin:8px 0 4px 0;">Temporary Teams</h4>';
        if (detail.temporaryTeams && detail.temporaryTeams.length > 0) {
            detail.temporaryTeams.forEach(function(team) {
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--warning);margin-bottom:4px;font-size:0.75rem;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(team.periodDisplay) + ')</span></span>';
                if (team.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(team.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No temporary teams</p>';
        }

        // Civilian Teams
        html += '<h4 style="color:var(--text-dim);font-size:0.85rem;margin:8px 0 4px 0;">Civilian Teams</h4>';
        if (detail.civilianTeams && detail.civilianTeams.length > 0) {
            detail.civilianTeams.forEach(function(team) {
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--text-dim);margin-bottom:4px;font-size:0.75rem;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(team.periodDisplay) + ')</span></span>';
                if (team.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(team.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No civilian teams</p>';
        }

        // Missions
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin:8px 0 4px 0;">Missions</h4>';
        if (detail.missions && detail.missions.length > 0) {
            detail.missions.forEach(function(m) {
                var statusColor = m.status === 'completed' ? 'var(--accent)' : 
                                 m.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)';
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + statusColor + ';margin-bottom:4px;font-size:0.75rem;">';
                html += '<span><strong>' + escapeHtml(m.title) + '</strong> <span style="color:' + statusColor + ';font-size:0.65rem;">' + escapeHtml(m.status) + '</span>';
                html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(m.teamName) + ']</span>';
                if (m.location) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">(' + escapeHtml(m.location) + ')</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No missions assigned</p>';
        }

        html += '</div>';
        return html;
    }

    function renderAcademicTab(detail) {
        var html = '<div class="detail-section" style="display:flex;flex-direction:column;gap:4px;">';

        // Academic Teams
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin:4px 0 8px 0;">Academic Teams</h4>';
        if (detail.academicTeams && detail.academicTeams.length > 0) {
            detail.academicTeams.forEach(function(team) {
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:4px;font-size:0.75rem;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong>' + escapeHtml(team.classDisplay) + ' <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(team.periodDisplay) + ')</span></span>';
                if (team.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(team.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No academic teams</p>';
        }

        // Class Names
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin:8px 0 4px 0;">Classes</h4>';
        if (detail.classNames && detail.classNames.length > 0) {
            html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;font-size:0.75rem;">' + detail.classNames.map(function(name) { return escapeHtml(name); }).join(', ') + '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No classes</p>';
        }

        // Grades
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin:8px 0 4px 0;">Grades</h4>';
        if (detail.grades && detail.grades.length > 0) {
            html += '<div style="max-height:120px;overflow-y:auto;font-size:0.7rem;">';
            detail.grades.forEach(function(g) {
                var statusColor = g.passing ? 'var(--accent)' : 'var(--danger)';
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;">';
                html += '<span>' + escapeHtml(g.disciplineName) + ' (Wk ' + escapeHtml(g.week) + ')</span>';
                html += '<span style="color:' + statusColor + ';font-weight:600;">' + escapeHtml(g.scoreDisplay) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No grades recorded</p>';
        }

        // Tournament Eliminations
        html += '<h4 style="color:var(--danger);font-size:0.85rem;margin:8px 0 4px 0;">Tournament Eliminations</h4>';
        if (detail.tournamentEliminations && detail.tournamentEliminations.length > 0) {
            detail.tournamentEliminations.forEach(function(elim) {
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--danger);margin-bottom:3px;font-size:0.7rem;">';
                html += '<span><strong>' + escapeHtml(elim.tournamentName) + '</strong> - Week ' + escapeHtml(elim.week);
                if (elim.reason) html += ' (' + escapeHtml(elim.reason) + ')';
                html += '</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No tournament eliminations</p>';
        }

        // Standalone Eliminations
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin:8px 0 4px 0;">Standalone Eliminations</h4>';
        if (detail.standaloneEliminations && detail.standaloneEliminations.length > 0) {
            detail.standaloneEliminations.forEach(function(elim) {
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--warning);margin-bottom:3px;font-size:0.7rem;">';
                html += '<span>Week ' + escapeHtml(elim.week);
                if (elim.reason) html += ' - ' + escapeHtml(elim.reason);
                html += '</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No standalone eliminations</p>';
        }

        // Elimination Status
        html += '<h4 style="color:var(--danger);font-size:0.85rem;margin:8px 0 4px 0;">Elimination Status</h4>';
        var statusColor = detail.isEliminated ? 'var(--danger)' : 'var(--accent)';
        var statusText = detail.isEliminated ? '⚠ Eliminated' : '✓ Not eliminated';
        if (detail.isEliminated && detail.eliminationWeek) {
            statusText += ' (Week ' + detail.eliminationWeek + ')';
        }
        if (detail.isEliminated && detail.eliminationReason && detail.eliminationReason !== 'Unknown') {
            statusText += ' - ' + detail.eliminationReason;
        }
        html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + statusColor + ';font-size:0.75rem;">' + escapeHtml(statusText) + '</div>';

        // Schedule Summary
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin:8px 0 4px 0;">Schedule Summary</h4>';
        html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;font-size:0.75rem;">Total classes scheduled: <strong>' + (detail.scheduleCount || 0) + '</strong></div>';

        html += '</div>';
        return html;
    }

    function renderStatsTab(detail) {
        var html = '<div class="detail-section" style="display:flex;flex-direction:column;gap:4px;">';

        // Physical Stats
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin:4px 0 8px 0;">Physical Stats</h4>';
        html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:12px;">';

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
            if (!Object.prototype.hasOwnProperty.call(statLabels, key)) continue;
            var s = stats[key] || { value: 10, modifier: 0, modifierDisplay: '+0' };
            var modColor = s.modifier > 0 ? 'var(--accent)' : (s.modifier < 0 ? 'var(--danger)' : 'var(--text-dim)');
            html += '<div style="background:var(--bg);padding:6px 10px;border-radius:4px;border:1px solid var(--border-soft);text-align:center;">';
            html += '<div style="font-size:0.6rem;color:' + statLabels[key].color + ';">' + statLabels[key].label + '</div>';
            html += '<div style="font-size:1.2rem;font-weight:700;color:var(--accent);">' + escapeHtml(s.value) + '</div>';
            html += '<div style="font-size:0.65rem;color:' + modColor + ';">' + escapeHtml(s.modifierDisplay) + '</div>';
            html += '</div>';
        }

        html += '</div>';

        // Magic Stats
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin:8px 0 4px 0;">Magic Stats</h4>';
        html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:12px;">';

        var magic = detail.magic || {};
        var magicKeys = MagicConstants.getTypeKeys ? MagicConstants.getTypeKeys() : Object.keys(magic);

        magicKeys.forEach(function(key) {
            var m = magic[key] || { value: 0, label: key, level: 'Untrained', color: 'var(--border)' };
            html += '<div style="background:var(--bg);padding:2px 4px;border-radius:3px;border:1px solid var(--border-soft);text-align:center;">';
            html += '<div style="font-size:0.45rem;color:var(--text-dim);">' + escapeHtml(m.label || key) + '</div>';
            html += '<div style="font-size:0.85rem;font-weight:700;color:' + escapeHtml(m.color) + ';">' + escapeHtml(m.value) + '</div>';
            html += '</div>';
        });

        html += '</div>';

        // Magic Power
        var power = 0;
        var rank = 'Untrained';
        if (CharacterStats && typeof CharacterStats.calculateMagicPower === 'function') {
            power = CharacterStats.calculateMagicPower(detail.character);
            rank = CharacterStats.getMagicRank(power);
        }
        html += '<div style="font-size:0.75rem;color:var(--text-dim);padding:4px 8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">';
        html += 'Magic Power: <span style="font-weight:600;color:var(--info);">' + Math.round(power) + '/100</span> - ' + escapeHtml(rank);
        html += '</div>';

        // Special Moves
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin:8px 0 4px 0;">Special Moves</h4>';

        var moves = detail.specialMoves || { physical: [], magical: [] };

        html += '<div style="margin-bottom:4px;">';
        html += '<span style="font-size:0.75rem;color:var(--accent);font-weight:600;">Physical:</span>';
        if (moves.physical && moves.physical.length > 0) {
            html += '<div style="margin-top:4px;">';
            moves.physical.forEach(function(m) {
                html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;border-left:2px solid var(--accent);font-size:0.7rem;">';
                html += '<span style="font-weight:600;">' + escapeHtml(m.name) + '</span>';
                if (m.description) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">- ' + escapeHtml(m.description) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No physical moves</p>';
        }
        html += '</div>';

        html += '<div>';
        html += '<span style="font-size:0.75rem;color:var(--info);font-weight:600;">Magical:</span>';
        if (moves.magical && moves.magical.length > 0) {
            html += '<div style="margin-top:4px;">';
            moves.magical.forEach(function(m) {
                html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;border-left:2px solid var(--info);font-size:0.7rem;">';
                html += '<span style="font-weight:600;">' + escapeHtml(m.name) + '</span>';
                if (m.description) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">- ' + escapeHtml(m.description) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No magical moves</p>';
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderSocialTab(detail) {
        var html = '<div class="detail-section" style="display:flex;flex-direction:column;gap:4px;">';

        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin:4px 0 8px 0;">Social Connections</h4>';

        var relationships = detail.relationships || [];
        if (relationships.length === 0) {
            html += '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No social connections</p>';
        } else {
            relationships.forEach(function(rel) {
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + escapeHtml(rel.typeColor) + ';margin-bottom:4px;font-size:0.75rem;">';
                html += '<span><strong>' + escapeHtml(rel.otherName) + '</strong> <span style="color:' + escapeHtml(rel.typeColor) + ';font-size:0.75rem;">' + escapeHtml(rel.typeLabel) + escapeHtml(rel.directionText);
                if (rel.clarification) html += ' (' + escapeHtml(rel.clarification) + ')';
                html += '</span></span>';
                if (rel.period) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">' + escapeHtml(rel.period) + '</span>';
                if (rel.notes) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">📝</span>';
                html += '</div>';
            });
        }

        html += '</div>';
        return html;
    }

    function renderNotesTab(detail) {
        var html = '<div class="detail-section">';
        html += '<div style="background:var(--bg);padding:12px;border-radius:6px;border:1px solid var(--border-soft);min-height:100px;">';
        html += '<p style="white-space:pre-wrap;margin:0;font-size:0.8rem;">' + escapeHtml(detail.character.notes || 'No notes') + '</p>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE - Namespaced API
    // ============================================================

    window.CharacterDetail = {
        open: open,
        close: close,
        switchTab: switchTab,
        render: render,
        refresh: refresh
    };

    // Legacy compatibility
    window.openCharacterDetail = open;
    window.closeCharacterDetail = close;
    window.switchDetailTab = switchTab;
    window.renderCharacterDetail = render;

    // Mark as loaded
    window.__characterDetailLoaded = true;

})();