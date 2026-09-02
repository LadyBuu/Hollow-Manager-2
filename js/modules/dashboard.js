/**
 * js/modules/dashboard.js - Dashboard Module
 * Path: js/modules/dashboard.js
 * 
 * This module is responsible for:
 *   - Rendering the dashboard with key statistics
 *   - Quick links to other modules
 *   - Current year management
 */

(function() {
    'use strict';

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        currentYear: new Date().getFullYear()
    };

    // ============================================================
    // RENDER DASHBOARD
    // ============================================================

    function renderDashboard(container) {
        if (!container) {
            container = document.getElementById('tab-dashboard');
        }
        
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading dashboard data...</p>';
            return;
        }

        // Load current year from data if available
        if (window.data && window.data.currentYear) {
            state.currentYear = window.data.currentYear;
        }

        container.innerHTML = getDashboardHTML();
        bindEvents();
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // GET STATS
    // ============================================================

    function getStats() {
        var data = window.data || {};
        var characters = data.characters || [];
        var teams = data.teams || [];
        var tournaments = data.tournaments || [];
        var missions = data.missions || [];
        var graduatingClasses = data.graduatingClasses || [];

        var activeChars = 0;
        var deceasedChars = 0;
        var trainees = 0;
        var instructors = 0;

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (char.deceased) {
                deceasedChars++;
            } else {
                activeChars++;
            }
            
            if (char.careerStatus && Array.isArray(char.careerStatus)) {
                for (var j = 0; j < char.careerStatus.length; j++) {
                    var status = char.careerStatus[j];
                    if (status && status.status) {
                        var s = status.status.toLowerCase();
                        if (s === 'trainee' || s === 'rookie' || s === 'junior') {
                            trainees++;
                            break;
                        }
                        if (s === 'instructor' || s === 'teacher' || s === 'professor' || s === 'senior') {
                            instructors++;
                            break;
                        }
                    }
                }
            }
        }

        var activeTeams = 0;
        for (var i = 0; i < teams.length; i++) {
            if (teams[i].status === 'active') {
                activeTeams++;
            }
        }

        var activeMissions = 0;
        for (var i = 0; i < missions.length; i++) {
            if (missions[i].status === 'active') {
                activeMissions++;
            }
        }

        return {
            totalCharacters: characters.length,
            activeCharacters: activeChars,
            deceasedCharacters: deceasedChars,
            trainees: trainees,
            instructors: instructors,
            totalTeams: teams.length,
            activeTeams: activeTeams,
            totalTournaments: tournaments.length,
            totalMissions: missions.length,
            activeMissions: activeMissions,
            totalGraduatingClasses: graduatingClasses.length
        };
    }

    // ============================================================
    // DASHBOARD HTML
    // ============================================================

    function getDashboardHTML() {
        var stats = getStats();

        return `
            <div class="dashboard">
                <div class="dashboard-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border-soft);">
                    <h2 style="margin:0;font-size:1.2rem;">Dashboard</h2>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <label style="font-size:0.75rem;color:var(--text-dim);">Current Year:</label>
                        <input type="number" id="dashboard-year-input" value="${state.currentYear}" 
                               style="width:80px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;text-align:center;">
                        <button id="dashboard-update-year-btn" class="small primary" style="font-size:0.65rem;padding:3px 10px;">Update</button>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:12px;margin-bottom:20px;">
                    <div class="stat-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
                        <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">${stats.totalCharacters}</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Total Characters</div>
                        <div style="font-size:0.55rem;color:var(--text-dim);margin-top:2px;">${stats.activeCharacters} active, ${stats.deceasedCharacters} deceased</div>
                    </div>
                    <div class="stat-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
                        <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">${stats.trainees}</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Trainees</div>
                    </div>
                    <div class="stat-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
                        <div style="font-size:1.5rem;font-weight:700;color:var(--info);">${stats.instructors}</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Instructors</div>
                    </div>
                    <div class="stat-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
                        <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">${stats.totalTeams}</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Teams</div>
                        <div style="font-size:0.55rem;color:var(--text-dim);margin-top:2px;">${stats.activeTeams} active</div>
                    </div>
                    <div class="stat-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
                        <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">${stats.totalTournaments}</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Tournaments</div>
                    </div>
                    <div class="stat-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
                        <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">${stats.totalMissions}</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Missions</div>
                        <div style="font-size:0.55rem;color:var(--text-dim);margin-top:2px;">${stats.activeMissions} active</div>
                    </div>
                    <div class="stat-card" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
                        <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">${stats.totalGraduatingClasses}</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Graduating Classes</div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;">
                    <a href="#" data-tab="characters" class="quick-link" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-decoration:none;color:var(--text);cursor:pointer;transition:0.15s;text-align:center;">
                        <div style="font-size:0.9rem;">👤 Characters</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Manage all characters</div>
                    </a>
                    <a href="#" data-tab="classes" class="quick-link" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-decoration:none;color:var(--text);cursor:pointer;transition:0.15s;text-align:center;">
                        <div style="font-size:0.9rem;">🎓 Classes</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Manage graduating classes</div>
                    </a>
                    <a href="#" data-tab="teams" class="quick-link" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-decoration:none;color:var(--text);cursor:pointer;transition:0.15s;text-align:center;">
                        <div style="font-size:0.9rem;">🏛️ Teams</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Manage teams</div>
                    </a>
                    <a href="#" data-tab="curriculum" class="quick-link" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-decoration:none;color:var(--text);cursor:pointer;transition:0.15s;text-align:center;">
                        <div style="font-size:0.9rem;">📚 Curriculum</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Disciplines & locations</div>
                    </a>
                    <a href="#" data-tab="calendar" class="quick-link" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-decoration:none;color:var(--text);cursor:pointer;transition:0.15s;text-align:center;">
                        <div style="font-size:0.9rem;">📅 Calendar</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Schedules & timetables</div>
                    </a>
                    <a href="#" data-tab="missions" class="quick-link" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-decoration:none;color:var(--text);cursor:pointer;transition:0.15s;text-align:center;">
                        <div style="font-size:0.9rem;">⚔️ Missions</div>
                        <div style="font-size:0.65rem;color:var(--text-dim);">Manage missions</div>
                    </a>
                </div>
            </div>
        `;
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindEvents() {
        var updateBtn = document.getElementById('dashboard-update-year-btn');
        var yearInput = document.getElementById('dashboard-year-input');

        if (updateBtn) {
            updateBtn.onclick = function() {
                var year = parseInt(yearInput.value, 10);
                if (isNaN(year) || year < 1900 || year > 2100) {
                    alert('Please enter a valid year (1900-2100).');
                    return;
                }
                
                state.currentYear = year;
                
                if (window.data) {
                    window.data.currentYear = year;
                    if (typeof window.saveData === 'function') {
                        window.saveData().catch(function() {
                            // Silent fail
                        });
                    }
                }
                
                var container = document.getElementById('tab-dashboard');
                if (container) {
                    renderDashboard(container);
                }
                
                var classesContainer = document.getElementById('classes-content');
                if (classesContainer && typeof window.renderClassesView === 'function') {
                    window.renderClassesView(classesContainer);
                }
            };
        }

        if (yearInput) {
            yearInput.onkeydown = function(e) {
                if (e.key === 'Enter') {
                    if (updateBtn) updateBtn.click();
                }
            };
        }

        var quickLinks = document.querySelectorAll('.quick-link[data-tab]');
        quickLinks.forEach(function(link) {
            link.onclick = function(e) {
                e.preventDefault();
                var tab = this.dataset.tab;
                if (tab && typeof window.TabManager !== 'undefined') {
                    window.TabManager.switchTo(tab, true);
                }
            };
        });
    }

    // ============================================================
    // UPDATE DASHBOARD STATS
    // ============================================================

    function updateDashboardStats() {
        var container = document.getElementById('tab-dashboard');
        if (container) {
            renderDashboard(container);
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('dashboard', renderDashboard);
    }

    // ============================================================
    // LIFECYCLE EVENTS
    // ============================================================

    document.addEventListener('dataReady', function() {
        setTimeout(function() {
            var container = document.getElementById('tab-dashboard');
            if (container && container.style.display !== 'none') {
                renderDashboard(container);
            }
        }, 100);
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'dashboard') {
            var container = document.getElementById('tab-dashboard');
            if (container) {
                renderDashboard(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-dashboard');
            if (container && container.style.display !== 'none') {
                renderDashboard(container);
            }
        }, 200);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderDashboard = renderDashboard;
    window.updateDashboardStats = updateDashboardStats;

})();
