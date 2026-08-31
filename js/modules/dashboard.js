/**
 * js/modules/dashboard.js - Dashboard Module
 * Path: js/modules/dashboard.js
 * 
 * This module renders the dashboard and registers with TabManager.
 * IMPORTANT: This must be loaded BEFORE tab-manager.js initializes.
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__dashboardLoaded) {
        return;
    }
    window.__dashboardLoaded = true;

    function renderDashboard(container) {
        if (!container) {
            container = document.getElementById('tab-dashboard');
        }

        if (!container) {
            console.warn('Dashboard: Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        var data = window.data;
        var charCount = Array.isArray(data.characters) ? data.characters.length : 0;
        var teamCount = Array.isArray(data.teams) ? data.teams.length : 0;
        var tournamentCount = Array.isArray(data.tournaments) ? data.tournaments.length : 0;
        var missionCount = Array.isArray(data.missions) ? data.missions.length : 0;

        container.innerHTML = `
            <div class="dashboard-grid">
                <div class="stat-card" data-tab="characters">
                    <h3>Characters</h3>
                    <p class="stat-number">${charCount}</p>
                    <span class="stat-link">View →</span>
                </div>
                <div class="stat-card" data-tab="teams">
                    <h3>Teams</h3>
                    <p class="stat-number">${teamCount}</p>
                    <span class="stat-link">View →</span>
                </div>
                <div class="stat-card" data-tab="tournaments">
                    <h3>Tournaments</h3>
                    <p class="stat-number">${tournamentCount}</p>
                    <span class="stat-link">View →</span>
                </div>
                <div class="stat-card" data-tab="missions">
                    <h3>Missions</h3>
                    <p class="stat-number">${missionCount}</p>
                    <span class="stat-link">View →</span>
                </div>
            </div>
            <div class="dashboard-quick-links">
                <button class="quick-link" data-tab="characters">Manage Characters</button>
                <button class="quick-link" data-tab="teams">Manage Teams</button>
                <button class="quick-link" data-tab="tournaments">View Tournaments</button>
                <button class="quick-link" data-tab="curriculum">View Curriculum</button>
            </div>
        `;
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - THIS IS CRITICAL
    // ============================================================
    
    // Register immediately - TabManager may already be initialized
    if (window.TabManager && typeof window.TabManager.register === 'function') {
        window.TabManager.register('dashboard', renderDashboard);
        console.log('Dashboard registered with TabManager');
    } else {
        // TabManager not ready yet - wait for it
        console.log('Dashboard: TabManager not ready, waiting...');
        document.addEventListener('DOMContentLoaded', function() {
            if (window.TabManager && typeof window.TabManager.register === 'function') {
                window.TabManager.register('dashboard', renderDashboard);
                console.log('Dashboard registered with TabManager (delayed)');
            }
        });
    }

    // Expose for manual calls
    window.renderDashboard = renderDashboard;

    // If data is already ready, render immediately
    if (window.data) {
        var container = document.getElementById('tab-dashboard');
        if (container) {
            renderDashboard(container);
        }
    }

    // Also render when data becomes ready
    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-dashboard');
        if (container) {
            renderDashboard(container);
        }
    });

})();
