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
    // RENDER CLASSES - With brutal debug logging
    // ============================================================

    function renderClasses(container) {
        console.log('========================================');
        console.log('[Classes] renderClasses() CALLED');
        console.log('[Classes] container:', container);
        console.log('[Classes] data exists:', !!window.data);
        console.log('[Classes] TabManager:', typeof window.TabManager);
        console.log('[Classes] renderClassesView:', typeof window.renderClassesView);
        console.log('========================================');

        if (!container) {
            container = document.getElementById('tab-classes');
            console.log('[Classes] Found container by ID:', container);
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
            console.warn('[Classes] No data available');
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
        console.log('[Classes] Container HTML set, length:', container.innerHTML.length);
        
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
    // CLASSES HTML - Tab navigation with sub-tabs
    // ============================================================

    function getClassesHTML() {
        return `
            <div class="tab-container">
                <div class="tab-nav" id="classes-tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">
                    <button class="tab-btn" data-tab="classes" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Classes</button>
                    <button class="tab-btn" data-tab="rankings" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Rankings</button>
                    <button class="tab-btn" data-tab="groups" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Groups</button>
                    <button class="tab-btn" data-tab="tournaments" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Tournaments</button>
                </div>
                <div class="tab-content" id="classes-tab-content">
                    <div id="tab-classes" class="tab-panel">
                        <div id="classes-content"></div>
                    </div>
                    <div id="tab-rankings" class="tab-panel">
                        <div id="rankings-content"></div>
                    </div>
                    <div id="tab-groups" class="tab-panel">
                        <div id="groups-content"></div>
                    </div>
                    <div id="tab-tournaments" class="tab-panel">
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

        var panels = rootContainer.querySelectorAll('.tab-panel');
        var activeTabName = initialTab || 'classes';
        
        // Find active button
        var activeBtn = tabContainer.querySelector('.tab-btn[data-tab="' + activeTabName + '"]');
        if (!activeBtn) {
            activeBtn = tabContainer.querySelector('.tab-btn');
            if (activeBtn) {
                activeTabName = activeBtn.dataset.tab;
            }
        }

        state.currentTab = activeTabName;

        // Apply active styles
        tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
            var isActive = btn.dataset.tab === activeTabName;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });

        showTab(activeTabName, panels, rootContainer);

        // Bind click events
        tabContainer.addEventListener('click', function(e) {
            var tab = e.target.closest('.tab-btn');
            if (!tab) return;
            
            e.preventDefault();
            var tabName = tab.dataset.tab;
            if (!tabName) return;
            
            state.currentTab = tabName;
            
            tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
                var isActive = btn.dataset.tab === tabName;
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
                btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
            });
            
            showTab(tabName, panels, rootContainer);
        });
    }

    function showTab(tabName, panels, rootContainer) {
        panels.forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        var activePanel = rootContainer.querySelector('#tab-' + tabName);
        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
        }

        renderTabContent(tabName, rootContainer);
    }

    function renderTabContent(tabName, rootContainer) {
        console.log('[Classes] renderTabContent:', tabName);
        
        var contentId = tabName + '-content';
        var content = rootContainer.querySelector('#' + contentId);
        
        if (!content) {
            console.warn('[Classes] Content not found:', contentId);
            return;
        }

        // Make content visible
        content.style.display = 'block';

        // Get renderer
        var renderer = null;
        
        if (tabName === 'classes') {
            renderer = window.renderClassesView;
        } else if (tabName === 'rankings') {
            renderer = renderRankingsPlaceholder;
        } else if (tabName === 'groups') {
            renderer = renderGroupsPlaceholder;
        } else if (tabName === 'tournaments') {
            renderer = renderTournamentsPlaceholder;
        }

        if (typeof renderer !== 'function') {
            console.warn('[Classes] No renderer for tab:', tabName);
            content.innerHTML = '<p class="empty-state">Content coming soon...</p>';
            return;
        }

        console.log('[Classes] Calling renderer for', tabName);
        try {
            renderer(content);
        } catch (e) {
            console.error('[Classes] Error rendering tab:', e);
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
