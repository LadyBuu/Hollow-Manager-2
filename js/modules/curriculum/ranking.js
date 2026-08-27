/**
 * js/modules/curriculum/ranking.js - Student Ranking Module
 * Handles student rankings based on grades with manual override support
 * Path: js/modules/curriculum/ranking.js
 * 
 * This module is responsible for:
 *   - Rendering the rankings UI
 *   - Displaying rankings with manual reordering
 *   - Auto-generating rankings from grade data (delegates to core)
 *   - Manual rank editing (delegates to core)
 *   - Displaying rank changes from previous weeks
 * 
 * IMPORTANT:
 *   - All application-data mutations are delegated to core functions.
 *   - This module does NOT mutate window.data directly.
 *   - UI state is managed locally through shared curriculum state.
 *   - Persistence is handled through the central saveData() function.
 *   - This module does not implement persistence itself.
 *   - Rankings are read via getRankingsForWeek() (uses core accessor).
 *   - All core accessors are validated at render time.
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 * 
 * ARCHITECTURAL NOTE:
 *   - Rankings are stored as { studentId, rank } per week in the core.
 *   - Average is calculated on display from grades, not stored.
 *   - Auto-rank generates rankings from grade averages via core.
 *   - Manual rank edits use window.updateStudentRank() which handles
 *     shifting and normalisation atomically.
 *   - The ranking table is sorted by rank (manual order), not by average.
 *   - All core mutation functions return { success: boolean, message?: string, ... }
 *   - Ungraded students are displayed with '—' and placed at the bottom.
 *   - When no rankings exist, the table shows a preview (read-only) until Auto-Rank.
 *   - Preview mode only shows projected ranks for graded students; ungraded students
 *     are displayed with '—' at the bottom.
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Ranking UI state, stored in shared curriculum state
    // ============================================================

    if (!window.curriculumState) {
        window.curriculumState = {};
    }
    
    if (!window.curriculumState.ranking) {
        window.curriculumState.ranking = {
            currentWeek: 1
        };
    }

    var state = window.curriculumState.ranking;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function validateDependencies(container) {
        var required = [
            { name: 'getRankings', fn: window.getRankings },
            { name: 'updateStudentRank', fn: window.updateStudentRank },
            { name: 'autoGenerateRankings', fn: window.autoGenerateRankings },
            { name: 'calculateGradeSummary', fn: window.calculateGradeSummary }
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof required[i].fn !== 'function') {
                console.error('[Ranking] ' + required[i].name + '() is not available.');
                if (container) {
                    container.innerHTML = '<p class="empty-state">Ranking core module not loaded. Please refresh the page.</p>';
                }
                return false;
            }
        }

        // getStudents is a global application dependency
        if (typeof window.getStudents !== 'function') {
            console.error('[Ranking] getStudents() is not available.');
            if (container) {
                container.innerHTML = '<p class="empty-state">Student data not available. Please refresh the page.</p>';
            }
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER RANKING VIEW - Public API (only this is exposed)
    // ============================================================

    function renderRankingView(container) {
        if (!container) {
            container = document.getElementById('ranking-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading ranking data...</p>';
            return;
        }

        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[Ranking] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        // Validate all core dependencies
        if (!validateDependencies(container)) {
            return;
        }

        container.innerHTML = getRankingHTML();
        renderRanking();
        initRankingEvents();
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // RANKING HTML
    // ============================================================

    function getRankingHTML() {
        return `
            <div class="page-header">
                <h2>Ranking</h2>
            </div>
            <div class="ranking-controls">
                <div class="week-nav">
                    <button id="prev-rank-week" class="small">← Prev</button>
                    <span id="rank-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-rank-week" class="small">Next →</button>
                </div>
                <button id="auto-rank-btn" class="small primary">Auto-Rank</button>
            </div>
            <div id="ranking-container">
                <p class="empty-state">No ranking data available for this week</p>
            </div>
        `;
    }

    // ============================================================
    // GET RANKINGS FOR WEEK - READ-ONLY (uses core accessor)
    // ============================================================

    function getRankingsForWeek(week) {
        if (typeof window.getRankings !== 'function') {
            return [];
        }
        return window.getRankings(week) || [];
    }

    // ============================================================
    // RENDER RANKING - Read-only rendering
    // ============================================================

    function renderRanking() {
        var container = document.getElementById('ranking-container');
        if (!container) return;

        // Re-validate dependencies (they should exist from renderRankingView)
        if (typeof window.getStudents !== 'function') {
            container.innerHTML = '<p class="empty-state">Student data not available.</p>';
            return;
        }

        var weekDisplay = document.getElementById('rank-week-display');
        if (weekDisplay) weekDisplay.textContent = 'Week ' + state.currentWeek;

        var students = window.getStudents();
        if (students.length === 0) {
            container.innerHTML = '<p class="empty-state">No students found</p>';
            return;
        }

        // Calculate grade summaries for all students (using core)
        var studentSummaries = [];
        var hasSummaryErrors = false;

        students.forEach(function(student) {
            var summary = window.calculateGradeSummary(student.id, state.currentWeek);
            if (summary === null) {
                hasSummaryErrors = true;
                return;
            }
            studentSummaries.push({
                studentId: student.id,
                firstName: student.firstName,
                lastName: student.lastName || '',
                summary: summary
            });
        });

        if (hasSummaryErrors) {
            container.innerHTML = '<p class="empty-state">Error calculating grades. Please check the console.</p>';
            return;
        }

        // Sort by average (descending) for projected ranking order
        studentSummaries.sort(function(a, b) {
            // Students with no grades go to the bottom
            if (!a.summary.hasGrades && !b.summary.hasGrades) {
                var nameCompare = (a.lastName || '').localeCompare(b.lastName || '');
                if (nameCompare !== 0) return nameCompare;
                return a.firstName.localeCompare(b.firstName);
            }
            if (!a.summary.hasGrades) return 1;
            if (!b.summary.hasGrades) return -1;
            
            if (b.summary.average !== a.summary.average) {
                return b.summary.average - a.summary.average;
            }
            var nameCompare = (a.lastName || '').localeCompare(b.lastName || '');
            if (nameCompare !== 0) return nameCompare;
            return a.firstName.localeCompare(b.firstName);
        });

        // READ-ONLY: Get existing rankings without mutating
        var existingRankings = getRankingsForWeek(state.currentWeek);
        var hasExistingRankings = existingRankings.length > 0;

        // Build display rankings
        var displayRankings = [];
        var isPreview = !hasExistingRankings;

        if (hasExistingRankings) {
            displayRankings = existingRankings;
        } else {
            // Preview mode: only graded students get projected ranks
            var gradedStudents = studentSummaries.filter(function(s) {
                return s.summary.hasGrades;
            });
            displayRankings = gradedStudents.map(function(s, index) {
                return {
                    studentId: s.studentId,
                    rank: index + 1,
                    _preview: true
                };
            });
        }

        // Get previous week's rankings for change tracking
        var previousRankings = getRankingsForWeek(state.currentWeek - 1);

        // Build table - sort by rank (manual order)
        var rankedStudents = [];

        // First, add ranked students
        displayRankings.forEach(function(r) {
            var student = studentSummaries.find(function(s) {
                return String(s.studentId) === String(r.studentId);
            });
            if (student) {
                rankedStudents.push({
                    studentId: r.studentId,
                    firstName: student.firstName,
                    lastName: student.lastName || '',
                    summary: student.summary,
                    rank: r.rank,
                    average: student.summary.hasGrades ? student.summary.average : null,
                    isPreview: r._preview || false
                });
            }
        });

        // Then, add any unranked students to the bottom
        studentSummaries.forEach(function(s) {
            if (!rankedStudents.some(function(r) { return String(r.studentId) === String(s.studentId); })) {
                rankedStudents.push({
                    studentId: s.studentId,
                    firstName: s.firstName,
                    lastName: s.lastName || '',
                    summary: s.summary,
                    rank: null,
                    average: s.summary.hasGrades ? s.summary.average : null,
                    isPreview: false
                });
            }
        });

        // Sort by rank (null ranks go to bottom)
        rankedStudents.sort(function(a, b) {
            if (a.rank === null && b.rank === null) return 0;
            if (a.rank === null) return 1;
            if (b.rank === null) return -1;
            return a.rank - b.rank;
        });

        if (rankedStudents.length === 0) {
            container.innerHTML = '<p class="empty-state">No ranking data available for this week</p>';
            return;
        }

        var html = '<table class="ranking-table">';
        html += '<thead><tr>';
        html += '<th>Rank</th>';
        html += '<th>Student</th>';
        html += '<th>Average</th>';
        html += '<th>■ Mandatory</th>';
        html += '<th>□ Optional</th>';
        html += '<th>Change</th>';
        html += '</tr></thead><tbody>';

        var maxRank = rankedStudents.filter(function(r) { return r.rank !== null; }).length;

        rankedStudents.forEach(function(r, index) {
            var rank = r.rank || (index + 1);
            var previous = previousRankings.find(function(e) {
                return String(e.studentId) === String(r.studentId);
            });
            var prevRank = previous ? previous.rank : null;

            var change = '';
            var changeClass = '';
            if (prevRank !== null && prevRank !== undefined && r.rank !== null) {
                var diff = prevRank - r.rank;
                if (diff > 0) {
                    change = '↑' + diff;
                    changeClass = 'up';
                } else if (diff < 0) {
                    change = '↓' + Math.abs(diff);
                    changeClass = 'down';
                } else {
                    change = '—';
                    changeClass = 'same';
                }
            }

            var rankDisplay = r.rank !== null && !isNaN(r.rank) ? r.rank : '—';
            var averageDisplay = r.average !== null ? r.average.toFixed(1) : '—';
            var safeFirstName = escapeHtml(r.firstName);
            var safeLastName = escapeHtml(r.lastName || '');
            var gradedText = r.summary.hasGrades ? '' : ' (no grades)';
            var previewText = r.isPreview ? ' ⚡ preview' : '';

            var isEditable = !r.isPreview && r.rank !== null;

            html += '<tr' + ((r.rank === null || r.isPreview) ? ' style="opacity:0.6;"' : '') + '>';
            html += '<td class="rank-number">';
            if (isEditable) {
                html += '<input type="number" class="rank-input" data-student="' + escapeHtml(r.studentId) + '" value="' + rankDisplay + '" min="1" max="' + maxRank + '">';
            } else if (r.isPreview) {
                html += '<span style="color:var(--text-dim);font-style:italic;">' + rankDisplay + '</span>';
            } else {
                html += '—';
            }
            html += '</td>';
            html += '<td>' + safeFirstName + (safeLastName ? ' ' + safeLastName : '') + gradedText + previewText + '</td>';
            html += '<td style="font-weight:700;color:' + (r.average !== null ? 'var(--accent)' : 'var(--text-dim)') + ';">' + averageDisplay + '</td>';
            html += '<td>' + r.summary.mandatoryCount + '</td>';
            html += '<td>' + r.summary.optionalCount + '</td>';
            html += '<td><span class="rank-change ' + changeClass + '">' + change + '</span></td>';
            html += '</tr>';
        });

        html += '</tbody></table>';

        // Show preview notice if no rankings exist
        if (isPreview) {
            html += '<div style="margin-top:12px;padding:8px 12px;background:var(--warning-soft);border-radius:4px;border:1px solid var(--warning);font-size:0.75rem;color:var(--text-dim);">';
            html += '⚠ Preview mode: No rankings saved for this week. ';
            html += 'Click <strong>Auto-Rank</strong> to generate and save rankings.';
            html += '</div>';
        }

        container.innerHTML = html;

        // Bind rank input change events (only for editable inputs)
        container.querySelectorAll('.rank-input').forEach(function(input) {
            input.addEventListener('change', function() {
                var studentId = this.dataset.student;
                var newRank = parseInt(this.value, 10);
                var maxRank = parseInt(this.max, 10);

                if (isNaN(newRank) || newRank < 1 || newRank > maxRank) {
                    showNotification('Please enter a rank between 1 and ' + maxRank, 'error');
                    this.value = this.defaultValue;
                    return;
                }

                // DELEGATE: Use core function for mutation
                updateRank(studentId, newRank);
            });
        });
    }

    // ============================================================
    // UPDATE RANK - MUTATION (delegated to core)
    // ============================================================

    function updateRank(studentId, newRank) {
        if (typeof window.updateStudentRank !== 'function') {
            console.error('[Ranking] updateStudentRank() is not available.');
            showNotification('Ranking system is not available. Please refresh the page.', 'error');
            return;
        }

        var result = window.updateStudentRank(state.currentWeek, studentId, newRank);
        
        if (!result || !result.success) {
            showNotification(
                result && result.message ? result.message : 'Failed to update ranking.',
                'error'
            );
            return;
        }

        renderRanking();

        if (typeof window.logActivity === 'function') {
            window.logActivity('Updated rankings for week ' + state.currentWeek);
        }

        showNotification('Rankings updated successfully!', 'success');
    }

    // ============================================================
    // AUTO-RANK - Generate rankings from grades (delegated to core)
    // ============================================================

    function autoRank() {
        var students = window.getStudents();
        if (students.length === 0) {
            showNotification('No students to rank.', 'error');
            return;
        }

        if (typeof window.autoGenerateRankings !== 'function') {
            console.error('[Ranking] autoGenerateRankings() is not available.');
            showNotification('Ranking system is not available. Please refresh the page.', 'error');
            return;
        }

        var result = window.autoGenerateRankings(state.currentWeek);
        
        if (!result || !result.success) {
            showNotification(
                result && result.message ? result.message : 'Failed to auto-rank.',
                'error'
            );
            return;
        }

        renderRanking();

        if (typeof window.logActivity === 'function') {
            window.logActivity('Auto-ranked students for week ' + state.currentWeek);
        }

        // Use the count from the core result if available, otherwise count after render
        var gradedCount = result.count || 0;
        var totalStudents = students.length;
        var message = 'Auto-ranking completed! ' + gradedCount + ' student(s) ranked.';
        if (gradedCount < totalStudents) {
            message += ' ' + (totalStudents - gradedCount) + ' student(s) had no grades and were not ranked.';
        }
        showNotification(message, 'success');
    }

    // ============================================================
    // NOTIFICATION HELPER
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        
        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
        } else {
            console.log('[Ranking]', message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initRankingEvents() {
        var prevBtn = document.getElementById('prev-rank-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (state.currentWeek > 1) {
                    state.currentWeek--;
                    renderRanking();
                }
            });
        }

        var nextBtn = document.getElementById('next-rank-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (state.currentWeek < 52) {
                    state.currentWeek++;
                    renderRanking();
                }
            });
        }

        var autoBtn = document.getElementById('auto-rank-btn');
        if (autoBtn) {
            autoBtn.addEventListener('click', autoRank);
        }
    }

    // ============================================================
    // REGISTER WITH CURRICULUM MAIN
    // ============================================================

    if (typeof window.curriculumState !== 'undefined') {
        window.curriculumState.ranking = state;
    }

    // ============================================================
    // EXPOSE FUNCTIONS - Minimal public API
    // ============================================================

    window.renderRankingView = renderRankingView;
    window.rankingState = state;

})();
