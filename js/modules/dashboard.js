/**
 * js/modules/dashboard.js - Dashboard Module
 * Renders the dashboard with statistics and quick actions
 * Path: js/modules/dashboard.js
 */

(function() {
    'use strict';

    function renderDashboard(container) {
        // Check if container has content already (from index.html)
        // If not, build it
        if (!container.querySelector('.stats-grid')) {
            container.innerHTML = getDashboardHTML();
        }

        updateDashboardStats();
        initDashboardEvents();
    }

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

    function updateDashboardStats() {
        var data = window.data || {};

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
            var activeTeams = data.teams ? data.teams.filter(function(t) { return t.status !== 'deleted'; }).length : 0;
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
            var count = data.curriculum && data.curriculum.disciplines ? data.curriculum.disciplines.length : 0;
            disciplineCount.textContent = count;
        }

        if (missionCount) {
            missionCount.textContent = data.missions ? data.missions.length : 0;
        }

        if (socialCount) {
            socialCount.textContent = data.social && data.social.relationships ? data.social.relationships.length : 0;
        }

        if (yearDisplay) {
            yearDisplay.textContent = data.currentYear || new Date().getFullYear();
        }
    }

    function showYearModal() {
        var data = window.data || {};
        var currentYear = data.currentYear || new Date().getFullYear();
        var newYear = prompt('Enter the current year:', currentYear);

        if (newYear !== null && newYear !== '') {
            var yearNum = parseInt(newYear);
            if (!isNaN(yearNum) && yearNum > 0) {
                data.currentYear = yearNum;
                window.data = data;

                if (typeof window.saveData === 'function') {
                    window.saveData()
                        .then(function() {
                            if (typeof window.logActivity === 'function') {
                                window.logActivity('Set current year to ' + yearNum);
                            }
                            updateDashboardStats();
                        })
                        .catch(function(err) {
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

    function initDashboardEvents() {
        var yearDisplay = document.getElementById('header-current-year');
        if (yearDisplay) {
            // Remove any existing listeners
            var newYearDisplay = yearDisplay.cloneNode(true);
            yearDisplay.parentNode.replaceChild(newYearDisplay, yearDisplay);
            newYearDisplay.addEventListener('click', showYearModal);
        }

        // Quick links - handled by TabManager, but ensure they work
        document.querySelectorAll('.quick-link[data-tab]').forEach(function(link) {
            if (!link._listener) {
                link._listener = true;
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab && typeof window.TabManager !== 'undefined') {
                        window.TabManager.switchTo(tab);
                    }
                });
            }
        });

        document.querySelectorAll('.stat-link[data-tab]').forEach(function(link) {
            if (!link._listener) {
                link._listener = true;
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab && typeof window.TabManager !== 'undefined') {
                        window.TabManager.switchTo(tab);
                    }
                });
            }
        });
    }

    // Register with TabManager
    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('dashboard', renderDashboard);
    }

    // Handle data loading
    document.addEventListener('dataLoaded', function() {
        updateDashboardStats();
    });

    // If data already loaded, update stats
    if (window.data) {
        setTimeout(updateDashboardStats, 100);
    }

    // Export for direct use
    window.renderDashboard = renderDashboard;
    window.updateDashboardStats = updateDashboardStats;
    window.showYearModal = showYearModal;

})();