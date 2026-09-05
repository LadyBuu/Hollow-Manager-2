/**
 * modules/social/index.js - Social Module Entry Point
 * Single entry point for all social functionality
 * Path: js/modules/social/index.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the social container
 *   - Initializing all social sub-modules
 *   - Managing social feature lifecycle
 *   - Exposing public API
 * 
 * LIFECYCLE:
 *   TabManager registers 'social' → mountSocial() → 
 *   SocialEvents.init() → SocialViews.renderSocialView()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for social
 *   - All social logic lives in the sub-modules
 *   - This module does NOT implement social logic directly
 *   - It delegates to sub-modules for all operations
 *   - mountSocial() is the ONLY function that constructs the full HTML
 *   - TabManager is the single source of truth for lifecycle
 *   - No dataReady/tabChanged listeners - TabManager handles lifecycle
 * 
 * STATE SOURCE OF TRUTH:
 *   - window.data.social.relationships is the source of truth for relationships
 *   - UI state (view mode, zoom) is managed locally by SocialViews/SocialGraph
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js)
 *   - window.SocialEvents (from social-events.js)
 *   - window.SocialViews (from social-views.js)
 *   - window.SocialGraph (from social-graph.js)
 *   - window.DataLoader (from loader.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.Modal (from modal.js)
 *   - window.NotificationSystem (from notification.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__socialModuleLoaded) {
        return;
    }
    window.__socialModuleLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TabManager = window.TabManager;
    var SocialEvents = window.SocialEvents;
    var SocialViews = window.SocialViews;
    var SocialGraph = window.SocialGraph;
    var DataLoader = window.DataLoader;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!SocialEvents || typeof SocialEvents.init !== 'function') {
            missing.push('SocialEvents.init');
        }
        if (!SocialEvents || typeof SocialEvents.destroy !== 'function') {
            missing.push('SocialEvents.destroy');
        }

        if (!SocialViews || typeof SocialViews.renderSocialView !== 'function') {
            missing.push('SocialViews.renderSocialView');
        }

        if (!SocialGraph || typeof SocialGraph.setGraphVisible !== 'function') {
            missing.push('SocialGraph.setGraphVisible');
        }
        if (!SocialGraph || typeof SocialGraph.renderGraph !== 'function') {
            missing.push('SocialGraph.renderGraph');
        }

        if (missing.length > 0) {
            console.warn('[SocialModule] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _mounted = false;

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
    // ============================================================

    /**
     * Mount the social feature in the given container.
     * This is the callback registered with TabManager.
     * 
     * @param {HTMLElement} container - Container element
     */
    function mountSocial(container) {
        if (!container) {
            container = document.getElementById('tab-social');
        }

        if (!container) {
            console.warn('[SocialModule] Container not found');
            return;
        }

        if (!window.data || !window.data.social) {
            container.innerHTML = '<p class="empty-state">Loading social data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Social dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // If already mounted, clean up first
        if (_mounted) {
            unmountSocial();
        }

        // Render the social view
        SocialViews.renderSocialView(container);

        // Initialize events (this also binds all listeners)
        SocialEvents.init(container);

        // Ensure graph is hidden by default
        SocialGraph.setGraphVisible(false);

        _mounted = true;
        _initialized = true;

        // Dispatch ready event
        dispatchReady();
    }

    /**
     * Unmount the social feature.
     * Cleans up all event listeners and state.
     */
    function unmountSocial() {
        if (!_mounted) return;

        SocialEvents.destroy();
        _mounted = false;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    /**
     * Refresh the social UI.
     * Useful after external mutations.
     */
    function refresh() {
        if (!_mounted) return;

        SocialEvents.refreshUI();
    }

    /**
     * Switch to the social tab.
     * Convenience method for navigation.
     */
    function goToTab() {
        if (TabManager && typeof TabManager.switchTo === 'function') {
            TabManager.switchTo('social', true);
        }
    }

    /**
     * Get the current relationship count.
     * 
     * @returns {number} Number of relationships
     */
    function getRelationshipCount() {
        var social = window.data && window.data.social;
        if (!social || !Array.isArray(social.relationships)) {
            return 0;
        }
        return social.relationships.length;
    }

    /**
     * Check if the social feature is mounted.
     * 
     * @returns {boolean} True if mounted
     */
    function isMounted() {
        return _mounted;
    }

    /**
     * Check if the social feature is initialized.
     * 
     * @returns {boolean} True if initialized
     */
    function isInitialized() {
        return _initialized;
    }

    /**
     * Get the current state.
     * 
     * @returns {object} Current state
     */
    function getState() {
        return {
            mounted: _mounted,
            initialized: _initialized,
            relationshipCount: getRelationshipCount()
        };
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function dispatchReady() {
        try {
            var event = new CustomEvent('socialReady', {
                detail: {
                    mounted: _mounted,
                    initialized: _initialized,
                    timestamp: Date.now()
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            // Ignore event dispatch errors
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('social', mountSocial);
            return true;
        }
        return false;
    }

    // Register immediately if TabManager is available
    if (!registerWithTabManager()) {
        // TabManager not ready - wait for it via event
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // DATA READY HANDLING
    // ============================================================

    function handleDataReady() {
        // If the social tab is currently visible, mount it
        if (TabManager && TabManager.getCurrentTab() === 'social') {
            var container = document.getElementById('tab-social');
            if (container && !_mounted) {
                mountSocial(container);
            }
        }
    }

    // Listen for data ready if DataLoader is available
    if (DataLoader && typeof DataLoader.whenReady === 'function') {
        DataLoader.whenReady(function(data) {
            if (data) {
                handleDataReady();
            }
        });
    }

    // Also listen for tab changes to mount when switching to social
    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'social') {
            var container = document.getElementById('tab-social');
            if (container && !_mounted) {
                mountSocial(container);
            }
        }
    });

    // ============================================================
    // EXPOSE - Controlled public API
    // ============================================================

    window.Social = {
        // Mount
        mount: mountSocial,
        unmount: unmountSocial,

        // Refresh
        refresh: refresh,

        // Navigation
        goToTab: goToTab,

        // Queries
        getRelationshipCount: getRelationshipCount,

        // State
        isMounted: isMounted,
        isInitialized: isInitialized,
        getState: getState
    };

    // Legacy compatibility
    window.renderSocialView = SocialViews.renderSocialView;

})();