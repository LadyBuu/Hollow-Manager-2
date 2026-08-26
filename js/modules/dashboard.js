/**
 * js/modules/dashboard.js - Dashboard Module
 * Renders the dashboard with statistics and quick actions
 * Path: js/modules/dashboard.js
 * 
 * This module is responsible for:
 *   - Rendering the dashboard UI
 *   - Updating statistics
 *   - Managing quick actions
 *   - Year management (with proper persistence ordering)
 * 
 * IMPORTANT: Year changes are logged BEFORE saving so the activity persists.
 * This follows the app.js contract: logActivity() updates memory, saveData() persists.
 */

(function() {
    'use strict';

    // ============================================================
    // RENDER DASHBOARD
    // ============================================================

    function renderDashboard(container) {
        if (!container) {
            container = document.getElementById('tab-dashboard');
        }
        if (!container) return;

        // Check if data exists
        if (!window.data) {
            console.warn('No data available for dashboard, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading dashboard data...</p>';
            return;
        }

        // Check if container has content already (from index.html)
        // If not, build it
        if (!container.querySelector('.stats-grid')) {
            container.innerHTML = getDashboardHTML();
        }

        updateDashboardStats();
        initDashboardEvents();
    }

    // ============================================================
    // DASHBOARD HTML
    // ============================================================

    function getDashboardHTML() {
        return `
            <div class="page-header">
                <h2>Dashboard</h2>
                <span class="text-dim">Year: <span id="header-current-year" style="cursor:pointer;">2024</span></span>
            </div>
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Characters</h3>
                    <p class="stat-number" id="char-count">0</p>
                    <span class="stat-link" data-tab="characters">Manage →</span>
                </div>
                <div class="stat-card">
                    <h3>Teams</h3>
                    <p class="stat-number" id="team-count">0</p>
                    <span class="stat-link" data-tab="teams">Manage →</span>
                </div>
                <div class="stat-card">
                    <h3>Tournaments</h3>
                    <p class="stat-number" id="tournament-count">0</p>
                    <span class="stat-link" data-tab="tournaments">Manage →</span>
                </div>
                <div class="stat-card">
                    <h3>Students</h3>
                    <p class="stat-number" id="student-count">0</p>
                    <span class="stat-link" data-tab="curriculum">Manage →</span>
                </div>
                <div class="stat-card">
                    <h3>Disciplines</h3>
                    <p class="stat-number" id="discipline-count">0</p>
                    <span class="stat-link" data-tab="curriculum">Manage →</span>
                </div>
                <div class="stat-card">
                    <h3>Missions</h3>
                    <p class="stat-number" id="mission-count">0</p>
                    <span class="stat-link" data-tab="missions">Manage →</span>
                </div>
                <div class="stat-card">
                    <h3>Social</h3>
                    <p class="stat-number" id="social-count">0</p>
                    <span class="stat-link" data-tab="social">View Network →</span>
                </div>
            </div>
            <div class="dashboard-grid">
                <div class="dashboard-section">
                    <h3>Quick Actions</h3>
                    <div class="quick-actions">
                        <span class="quick-link" data-tab="characters">Add Character</span>
                        <span class="quick-link" data-tab="teams">Add Team</span>
                        <span class="quick-link" data-tab="missions">Add Mission</span>
                        <span class="quick-link" data-tab="social">Add Relationship</span>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // UPDATE STATISTICS
    // ============================================================

    function updateDashboardStats() {
        // Don't render if data isn't ready
        if (!window.data) {
            return;
        }

        var data = window.data;

        var charCount = document.getElementById('char-count');
        var teamCount = document.getElementById('team-count');
        var tournCount = document.getElementById('tournament-count');
        var studentCount = document.getElementById('student-count');
        var disciplineCount = document.getElementById('discipline-count');
        var missionCount = document.getElementById('mission-count');
        var socialCount = document.getElementById('social-count');
        var yearDisplay = document.getElementById('header-current-year');

        if (charCount) {
            charCount.textContent = data.characters ? data.characters.length : 0;
        }

        if (teamCount) {
            var activeTeams = data.teams 
                ? data.teams.filter(function(t) { 
                    return t.status !== 'deleted'; 
                  }).length 
                : 0;
            teamCount.textContent = activeTeams;
        }

        if (tournCount) {
            tournCount.textContent = data.tournaments ? data.tournaments.length : 0;
        }

        if (studentCount) {
            var students = typeof window.getStudents === 'function' ? window.getStudents() : [];
            studentCount.textContent = students.length;
        }

        if (disciplineCount) {
            var count = data.curriculum && data.curriculum.disciplines 
                ? data.curriculum.disciplines.length 
                : 0;
            disciplineCount.textContent = count;
        }

        if (missionCount) {
            var activeMissions = data.missions 
                ? data.missions.filter(function(m) { 
                    return m.status !== 'deleted'; 
                  }).length 
                : 0;
            missionCount.textContent = activeMissions;
        }

        if (socialCount) {
            socialCount.textContent = data.social && data.social.relationships 
                ? data.social.relationships.length 
                : 0;
        }

        if (yearDisplay) {
            yearDisplay.textContent = data.currentYear || new Date().getFullYear();
        }
    }

    // ============================================================
    // YEAR MODAL
    // ============================================================

    function showYearModal() {
        var data = window.data || {};
        var currentYear = data.currentYear || new Date().getFullYear();
        var newYear = prompt('Enter the current year:', currentYear);

        if (newYear !== null && newYear !== '') {
            // Use Number() for strict parsing - rejects "2026blah"
            var yearNum = Number(newYear);
            
            if (Number.isInteger(yearNum) && yearNum > 0) {
                // Update data
                data.currentYear = yearNum;
                window.data = data;

                // Log activity BEFORE saving so it's included in the persistence
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Set current year to ' + yearNum);
                }

                // Save data (includes the new activity)
                if (typeof window.saveData === 'function') {
                    window.saveData()
                        .then(function() {
                            updateDashboardStats();
                        })
                        .catch(function(err) {
                            console.error('Failed to save current year:', err);
                            alert('Failed to save year. Please try again.');
                        });
                } else {
                    updateDashboardStats();
                }
            } else {
                alert('Please enter a valid year (positive number).');
            }
        }
    }

    // ============================================================
    // EVENT INITIALIZATION
    // ============================================================

    function initDashboardEvents() {
        // Year display - single listener
        var yearDisplay = document.getElementById('header-current-year');
        if (yearDisplay && !yearDisplay._listener) {
            yearDisplay._listener = true;
            yearDisplay.addEventListener('click', showYearModal);
        }

        // All [data-tab] elements - handled by TabManager
        // dashboard.js only needs to ensure the elements exist
        // TabManager handles the actual navigation
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('dashboard', renderDashboard);
    }

    // Dashboard handles its own data updates - no duplicate listeners
    document.addEventListener('dataReady', function() {
        updateDashboardStats();
        var container = document.getElementById('tab-dashboard');
        if (container && container.style.display !== 'none') {
            renderDashboard(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'dashboard') {
            var container = document.getElementById('tab-dashboard');
            if (container) {
                renderDashboard(container);
            }
        }
    });

    // If data already loaded, update stats
    if (window.data) {
        setTimeout(function() {
            updateDashboardStats();
            var container = document.getElementById('tab-dashboard');
            if (container && container.style.display !== 'none') {
                renderDashboard(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderDashboard = renderDashboard;
    window.updateDashboardStats = updateDashboardStats;
    window.showYearModal = showYearModal;

    console.log('dashboard.js loaded');

})();
