/**
 * js/modules/classes/classes-main.js - Classes Module Entry Point
 * Path: js/modules/classes/classes-main.js
 * 
 * This module is responsible for:
 *   - Rendering the Classes tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to child modules
 */

(function() {
    'use strict';

    console.log('[Classes] Module loading...');

    // ============================================================
    // STATE - Shared state root with tab persistence
    // ============================================================

    var state = window.classesState || {
        currentTab: 'classes'
    };

    if (!state.currentTab) {
        state.currentTab = 'classes';
    }

    window.classesState = state;

    // ============================================================
    // DEPENDENCY VALIDATION - Only check what we actually need
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // These are the ONLY functions we actually need
        var required = [
            'getGraduatingClasses',
            'getGraduatingClass',
            'createGraduatingClass',
            'updateGraduatingClass',
            'deleteGraduatingClass',
            'getCharactersByGraduatingClass',
            'getInstructorsByGraduatingClass',
            'assignCharacterToGraduatingClass',
            'removeCharacterFromGraduatingClass',
            'getDisplayName',
            'getCurrentStatus'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof window[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.error('[Classes] Missing dependencies:', missing);
            return false;
        }

        console.log('[Classes] All dependencies OK');
        return true;
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - With retry
    // ============================================================

    function registerWithTabManager() {
        if (typeof window.TabManager !== 'undefined' && 
            typeof window.TabManager.register === 'function') {
            window.TabManager.register('classes', renderClasses);
            console.log('[Classes] Registered with TabManager');
            return true;
        }
        console.warn('[Classes] TabManager not available, will retry');
        return false;
    }

    // Try registration immediately
    var registered = registerWithTabManager();

    // If not registered, listen for TabManager ready
    if (!registered) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
        
        // Also check periodically (safety net)
        var checkInterval = setInterval(function() {
            if (registerWithTabManager()) {
                clearInterval(checkInterval);
            }
        }, 500);
        
        // Stop checking after 5 seconds
        setTimeout(function() {
            clearInterval(checkInterval);
        }, 5000);
    }

    // ============================================================
    // RENDER CLASSES
    // ============================================================

    function renderClasses(container) {
        console.log('[Classes] renderClasses() CALLED');

        if (!container) {
            container = document.getElementById('tab-classes');
        }
        
        if (!container) {
            console.error('[Classes] No container found!');
            return;
        }

        // Force container visible
        container.style.display = 'block';
        container.style.visibility = 'visible';
        container.style.minHeight = '400px';

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading classes data...</p>';
            return;
        }

        // Ensure data structures exist
        ensureDataStructures();

        if (!checkDependencies()) {
            var missing = getMissingDependencies();
            container.innerHTML = '<p class="empty-state" style="color:var(--danger);">' +
                'Classes dependencies not loaded. Please refresh.<br>' +
                '<small style="color:var(--text-dim);">Missing: ' + missing.join(', ') + '</small>' +
                '</p>';
            return;
        }

        // Ensure curriculum is initialized
        if (typeof window.ensureCurriculum === 'function') {
            window.ensureCurriculum();
        }

        // Render the container
        container.innerHTML = getClassesHTML();
        
        // Initialize tabs
        initClassesTabs(container, state.currentTab);
        
        console.log('[Classes] renderClasses() complete');
    }

    function ensureDataStructures() {
        var data = window.data || {};
        if (!data.graduatingClasses) {
            data.graduatingClasses = [];
            console.log('[Classes] Initialized graduatingClasses array');
        }
    }

    function getMissingDependencies() {
        var missing = [];
        var required = [
            'getGraduatingClasses',
            'getGraduatingClass',
            'createGraduatingClass',
            'updateGraduatingClass',
            'deleteGraduatingClass',
            'getCharactersByGraduatingClass',
            'getInstructorsByGraduatingClass',
            'assignCharacterToGraduatingClass',
            'removeCharacterFromGraduatingClass',
            'getDisplayName',
            'getCurrentStatus'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof window[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }
        return missing;
    }

    // ============================================================
    // CLASSES HTML - WITH FIXED CLASS NAMES (no .tab-content conflict)
    // ============================================================

    function getClassesHTML() {
        return `
            <div class="classes-module-container">
                <!-- Tab navigation -->
                <div class="classes-tab-nav" id="classes-tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">
                    <button class="classes-tab-btn active" data-panel="classes-panel" style="background:transparent;border:none;border-bottom:2px solid var(--accent);color:var(--accent);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Classes</button>
                    <button class="classes-tab-btn" data-panel="rankings-panel" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Rankings</button>
                    <button class="classes-tab-btn" data-panel="groups-panel" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Groups</button>
                    <button class="classes-tab-btn" data-panel="tournaments-panel" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Tournaments</button>
                </div>
                
                <!-- Panel container - NOT using .tab-content to avoid global CSS hiding it -->
                <div class="classes-panels" id="classes-panels">
                    <div id="classes-panel" class="classes-panel active" style="display:block;">
                        <div id="classes-content"></div>
                    </div>
                    <div id="rankings-panel" class="classes-panel" style="display:none;">
                        <div id="rankings-content"></div>
                    </div>
                    <div id="groups-panel" class="classes-panel" style="display:none;">
                        <div id="groups-content"></div>
                    </div>
                    <div id="tournaments-panel" class="classes-panel" style="display:none;">
                        <div id="tournaments-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // TAB INITIALISATION
    // ============================================================

    function initClassesTabs(rootContainer, initialTab) {
        console.log('[Classes] initClassesTabs called with:', initialTab);
        
        var tabContainer = rootContainer.querySelector('#classes-tab-nav');
        if (!tabContainer) {
            console.warn('[Classes] Tab nav not found');
            return;
        }

        // Map display names to panel IDs
        var tabMap = {
            'classes': 'classes-panel',
            'rankings': 'rankings-panel',
            'groups': 'groups-panel',
            'tournaments': 'tournaments-panel'
        };

        var activeTabName = initialTab || 'classes';
        var activePanelId = tabMap[activeTabName] || 'classes-panel';

        // Show the active panel
        showPanel(activePanelId, rootContainer);

        // Update button styles
        updateTabButtons(tabContainer, activePanelId);

        // Bind click events
        tabContainer.addEventListener('click', function(e) {
            var tab = e.target.closest('.classes-tab-btn');
            if (!tab) return;
            
            e.preventDefault();
            var panelId = tab.dataset.panel;
            if (!panelId) return;
            
            // Find the base tab name
            var tabName = activeTabName;
            for (var key in tabMap) {
                if (tabMap[key] === panelId) {
                    tabName = key;
                    break;
                }
            }
            
            state.currentTab = tabName;
            
            updateTabButtons(tabContainer, panelId);
            showPanel(panelId, rootContainer);
        });
    }

    function updateTabButtons(tabContainer, activePanelId) {
        var buttons = tabContainer.querySelectorAll('.classes-tab-btn');
        buttons.forEach(function(btn) {
            var isActive = btn.dataset.panel === activePanelId;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });
    }

    function showPanel(panelId, rootContainer) {
        // Hide all panels
        var panels = rootContainer.querySelectorAll('.classes-panel');
        panels.forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        // Show the active panel
        var activePanel = rootContainer.querySelector('#' + panelId);
        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
        }

        // Render the content
        renderPanelContent(panelId, rootContainer);
    }

    function renderPanelContent(panelId, rootContainer) {
        console.log('[Classes] renderPanelContent:', panelId);
        
        // Map panel IDs to content IDs and renderers
        var panelMap = {
            'classes-panel': {
                contentId: 'classes-content',
                renderer: window.renderClassesView,
                fallback: 'Classes module not loaded.'
            },
            'rankings-panel': {
                contentId: 'rankings-content',
                renderer: renderRankingsPlaceholder,
                fallback: 'Rankings module not loaded.'
            },
            'groups-panel': {
                contentId: 'groups-content',
                renderer: renderGroupsPlaceholder,
                fallback: 'Groups module not loaded.'
            },
            'tournaments-panel': {
                contentId: 'tournaments-content',
                renderer: renderTournamentsPlaceholder,
                fallback: 'Tournaments module not loaded.'
            }
        };

        var config = panelMap[panelId];
        if (!config) {
            console.warn('[Classes] Unknown panel:', panelId);
            return;
        }

        var content = rootContainer.querySelector('#' + config.contentId);
        if (!content) {
            console.warn('[Classes] Content not found:', config.contentId);
            return;
        }

        // Make content visible
        content.style.display = 'block';

        var renderer = config.renderer;

        if (typeof renderer !== 'function') {
            content.innerHTML = '<p class="empty-state">' + config.fallback + '</p>';
            return;
        }

        console.log('[Classes] Calling renderer for', panelId);
        try {
            renderer(content);
        } catch (e) {
            console.error('[Classes] Error rendering panel:', e);
            content.innerHTML = '<p class="empty-state">Error loading content. Please refresh.</p>';
        }
    }

    // ============================================================
    // PLACEHOLDER RENDERERS
    // ============================================================

    function renderRankingsPlaceholder(container) {
        container.innerHTML = `
            <div class="page-header"><h2>Class Rankings</h2></div>
            <p class="empty-state">Rankings module coming soon.</p>
        `;
    }

    function renderGroupsPlaceholder(container) {
        container.innerHTML = `
            <div class="page-header"><h2>Auto-Groups</h2></div>
            <p class="empty-state">Groups module coming soon.</p>
        `;
    }

    function renderTournamentsPlaceholder(container) {
        container.innerHTML = `
            <div class="page-header"><h2>Tournaments</h2></div>
            <p class="empty-state">Tournaments module coming soon.</p>
        `;
    }

    // ============================================================
    // LIFECYCLE EVENTS
    // ============================================================

    document.addEventListener('dataReady', function() {
        console.log('[Classes] dataReady event received');
        var container = document.getElementById('tab-classes');
        if (container) {
            renderClasses(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'classes') {
            console.log('[Classes] tabChanged event for classes');
            var container = document.getElementById('tab-classes');
            if (container) {
                renderClasses(container);
            }
        }
    });

    // Initial render if data already loaded
    if (window.data) {
        console.log('[Classes] Data already loaded, rendering');
        setTimeout(function() {
            var container = document.getElementById('tab-classes');
            if (container) {
                renderClasses(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderClasses = renderClasses;
    window.classesState = state;

    console.log('[Classes] Module loaded successfully');

})();
