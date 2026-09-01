/**
 * js/modules/classes/classes-main.js - Classes Module Entry Point
 * Path: js/modules/classes/classes-main.js
 * 
 * This module is responsible for:
 *   - Rendering the Classes tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to child modules
 * 
 * TABS:
 *   - Classes: Create/manage graduating classes, add members
 *   - Rankings: Class-based rankings
 *   - Groups: Auto-groups scoped to graduating classes
 *   - Tournaments: Class-based tournaments
 */

(function() {
    'use strict';

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
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Graduating class core dependencies
        if (typeof window.getGraduatingClasses !== 'function') {
            missing.push('getGraduatingClasses');
        }
        if (typeof window.getGraduatingClass !== 'function') {
            missing.push('getGraduatingClass');
        }
        if (typeof window.createGraduatingClass !== 'function') {
            missing.push('createGraduatingClass');
        }
        if (typeof window.updateGraduatingClass !== 'function') {
            missing.push('updateGraduatingClass');
        }
        if (typeof window.deleteGraduatingClass !== 'function') {
            missing.push('deleteGraduatingClass');
        }
        if (typeof window.getCharactersByGraduatingClass !== 'function') {
            missing.push('getCharactersByGraduatingClass');
        }
        if (typeof window.getInstructorsByGraduatingClass !== 'function') {
            missing.push('getInstructorsByGraduatingClass');
        }
        if (typeof window.assignCharacterToGraduatingClass !== 'function') {
            missing.push('assignCharacterToGraduatingClass');
        }
        if (typeof window.removeCharacterFromGraduatingClass !== 'function') {
            missing.push('removeCharacterFromGraduatingClass');
        }

        // Character dependencies
        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }
        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }
        if (typeof window.getCurrentStatus !== 'function') {
            missing.push('getCurrentStatus');
        }

        // TabManager
        if (typeof window.TabManager === 'undefined') {
            missing.push('TabManager');
        }

        if (missing.length > 0) {
            console.warn('[Classes] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER CLASSES
    // ============================================================

    function renderClasses(container) {
        if (!container) {
            container = document.getElementById('tab-classes');
        }
        if (!container) {
            console.warn('[Classes] Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading classes data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Classes dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Ensure curriculum is initialized for schedule-related features
        if (typeof window.ensureCurriculum === 'function') {
            window.ensureCurriculum();
        }

        container.innerHTML = getClassesHTML();
        initClassesTabs(container, state.currentTab);

        // Dispatch event
        var event = new CustomEvent('classesRendered', {
            detail: { tab: state.currentTab }
        });
        document.dispatchEvent(event);
    }

    // ============================================================
    // CLASSES HTML - Tab navigation with sub-tabs
    // ============================================================

    function getClassesHTML() {
        return `
            <div class="tab-container">
                <!-- Tab navigation -->
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
                        <div id="rankings-content">
                            <p class="empty-state">Rankings module coming soon...</p>
                        </div>
                    </div>
                    <div id="tab-groups" class="tab-panel">
                        <div id="groups-content">
                            <p class="empty-state">Groups module coming soon...</p>
                        </div>
                    </div>
                    <div id="tab-tournaments" class="tab-panel">
                        <div id="tournaments-content">
                            <p class="empty-state">Tournaments module coming soon...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // TAB INITIALISATION
    // ============================================================

    function initClassesTabs(rootContainer, initialTab) {
        var tabContainer = rootContainer ? 
            rootContainer.querySelector('#classes-tab-nav') : 
            document.getElementById('classes-tab-nav');
            
        if (!tabContainer) {
            console.warn('[Classes] Tab nav not found.');
            return;
        }

        var classesRoot = tabContainer.closest('.tab-container');
        if (!classesRoot) {
            classesRoot = rootContainer;
        }

        var panels = classesRoot ? 
            classesRoot.querySelectorAll('.tab-panel') : 
            document.querySelectorAll('.tab-panel');

        var activeTabName = initialTab || 'classes';
        
        var activeBtn = tabContainer.querySelector('.tab-btn[data-tab="' + activeTabName + '"]');
        
        if (!activeBtn) {
            activeBtn = tabContainer.querySelector('.tab-btn');
            if (!activeBtn) {
                console.warn('[Classes] No tab buttons found.');
                return;
            }
            activeTabName = activeBtn.dataset.tab;
        }

        state.currentTab = activeTabName;

        // Apply active styles
        tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
            var isActive = btn.dataset.tab === activeTabName;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });

        showTab(activeTabName, panels, tabContainer, classesRoot);

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
            
            showTab(tabName, panels, tabContainer, classesRoot);
        });
    }

    // ============================================================
    // SHOW TAB
    // ============================================================

    function showTab(tabName, panels, tabContainer, classesRoot) {
        panels.forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        var activePanel = classesRoot ? 
            classesRoot.querySelector('#tab-' + tabName) : 
            document.getElementById('tab-' + tabName);
            
        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
        } else {
            console.warn('[Classes] Panel not found for tab:', tabName);
        }

        if (tabContainer) {
            tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
                var isActive = btn.dataset.tab === tabName;
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
                btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
            });
        }

        renderTabContent(tabName, classesRoot);
    }

    // ============================================================
    // RENDER TAB CONTENT - Centralised renderer registry
    // ============================================================

    function renderTabContent(tabName, classesRoot) {
        var content = null;
        var renderer = null;

        function getContentElement(id) {
            if (classesRoot) {
                return classesRoot.querySelector('#' + id);
            }
            return document.getElementById(id);
        }

        // Renderer registry
        var renderers = {
            'classes': {
                contentId: 'classes-content',
                renderer: window.renderClassesView,
                fallback: 'Classes module not loaded.'
            },
            'rankings': {
                contentId: 'rankings-content',
                renderer: window.renderRankingsView,
                fallback: 'Rankings module not loaded.'
            },
            'groups': {
                contentId: 'groups-content',
                renderer: window.renderGroupsView,
                fallback: 'Groups module not loaded.'
            },
            'tournaments': {
                contentId: 'tournaments-content',
                renderer: window.renderTournamentsView,
                fallback: 'Tournaments module not loaded.'
            }
        };

        var config = renderers[tabName];
        if (!config) {
            content = getContentElement('classes-tab-content');
            if (content) {
                content.innerHTML = '<p class="empty-state">Unknown tab: ' + tabName + '</p>';
            }
            return;
        }

        content = getContentElement(config.contentId);
        if (!content) {
            console.warn('[Classes] Content element not found:', config.contentId);
            return;
        }

        renderer = config.renderer;

        if (typeof renderer !== 'function') {
            content.innerHTML = '<p class="empty-state">' + (config.fallbackMessage || config.fallback || 'Module not loaded. Please refresh the page.') + '</p>';
            return;
        }

        try {
            renderer(content);
        } catch (e) {
            console.error('[Classes] Error rendering tab "' + tabName + '":', e);
            content.innerHTML = '<p class="empty-state">Unable to load this section. Please try again.</p>';
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('classes', renderClasses);
    }

    // ============================================================
    // LIFECYCLE EVENTS
    // ============================================================

    document.addEventListener('dataReady', function() {
        setTimeout(function() {
            var container = document.getElementById('tab-classes');
            if (container && container.style.display !== 'none') {
                renderClasses(container);
            }
        }, 100);
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'classes') {
            var container = document.getElementById('tab-classes');
            if (container) {
                renderClasses(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-classes');
            if (container && container.style.display !== 'none') {
                renderClasses(container);
            }
        }, 200);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderClasses = renderClasses;
    window.initClassesTabs = initClassesTabs;
    window.renderTabContent = renderTabContent;
    window.classesState = state;

})();
