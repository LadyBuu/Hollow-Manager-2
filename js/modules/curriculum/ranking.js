/**
 * js/modules/curriculum/ranking.js - Student Ranking Module
 * Handles student rankings based on grades
 * Path: js/modules/curriculum/ranking.js
 */

(function() {
    'use strict';

    var state = {
        currentWeek: 1
    };

    function renderRankingView(container) {
        if (!container) {
            container = document.getElementById('ranking-content');
        }
        if (!container) return;

        container.innerHTML = getRankingHTML();

        initRankingEvents();
        renderRanking();
    }

    function getRankingHTML() {
        return `
            <div class="page-header">
                <h2>Ranking</h2>
            </div>
            <div class="ranking-controls">
                <div class="week-nav">
                    <button id="prev-rank-week" class="small">\u2190 Prev</button>
                    <span id="rank-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="next-rank-week" class="small">Next \u2192</button>
                </div>
                <button id="auto-rank-btn" class="small primary">Auto-Rank</button>
                <button id="save-rankings-btn" class="small primary">Save Rankings</button>
            </div>
            <div id="ranking-container">
                <p class="empty-state">No ranking data available for this week</p>
            </div>
        `;
    }

    function renderRanking() {
        var container = document.getElementById('ranking-container');
        var weekDisplay = document.getElementById('rank-week-display');
        if (weekDisplay) weekDisplay.textContent = 'Week ' + state.currentWeek;

        if (!container) return;

        var students = window.getStudents();
        if (students.length === 0) {
            container.innerHTML = '<p class="empty-state">No students found</p>';
            return;
        }

        var rankings = [];
        students.forEach(function(student) {
            var data = window.data || {};
            var grades = data.curriculum && data.curriculum.grades && data.curriculum.grades[student.id] && data.curriculum.grades[student.id][state.currentWeek] ?
                data.curriculum.grades[student.id][state.currentWeek] : {};

            var disciplines = window.getAvailableDisciplines(state.currentWeek);
            var totalWeighted = 0;
            var totalWeight = 0;
            var count = 0;
            var mandatoryCount = 0;
            var optionalCount = 0;

            disciplines.forEach(function(d) {
                var score = grades[d.id];
                if (score !== undefined && score !== null && score !== '' && d.weight) {
                    totalWeighted += parseFloat(score) * d.weight;
                    totalWeight += d.weight;
                    count++;
                    if (d.type === 'mandatory') mandatoryCount++;
                    else if (d.type === 'optional') optionalCount++;
                }
            });

            var average = totalWeight > 0 ? totalWeighted / totalWeight : 0;
            rankings.push({
                studentId: student.id,
                firstName: student.firstName,
                lastName: student.lastName || '',
                average: average,
                count: count,
                total: disciplines.length,
                mandatoryCount: mandatoryCount,
                optionalCount: optionalCount
            });
        });

        rankings.sort(function(a, b) {
            if (b.average !== a.average) return b.average - a.average;
            return a.firstName.localeCompare(b.firstName);
        });

        var data = window.data || {};
        if (!data.curriculum) data.curriculum = {};
        if (!data.curriculum.rankings) data.curriculum.rankings = {};
        var existingRankings = data.curriculum.rankings[state.currentWeek] || [];

        if (existingRankings.length === 0) {
            rankings.forEach(function(r, index) {
                existingRankings.push({
                    studentId: r.studentId,
                    rank: index + 1,
                    average: r.average
                });
            });
            data.curriculum.rankings[state.currentWeek] = existingRankings;
            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }
        }

        if (rankings.length === 0) {
            container.innerHTML = '<p class="empty-state">No ranking data available for this week</p>';
            return;
        }

        var previousRankings = data.curriculum.rankings[state.currentWeek - 1] || [];

        var html = '<table class="ranking-table">';
        html += '<thead><tr>';
        html += '<th>Rank</th>';
        html += '<th>Student</th>';
        html += '<th>Average</th>';
        html += '<th>\u25A3 Mandatory</th>';
        html += '<th>\u25A2 Optional</th>';
        html += '<th>Change</th>';
        html += '</tr></thead><tbody>';

        rankings.forEach(function(r) {
            var existing = existingRankings.find(function(e) { return String(e.studentId) === String(r.studentId); });
            var rank = existing ? existing.rank : '-';
            var previous = previousRankings.find(function(e) { return String(e.studentId) === String(r.studentId); });
            var prevRank = previous ? previous.rank : null;

            var change = '';
            var changeClass = '';
            if (prevRank !== null && prevRank !== undefined) {
                var diff = prevRank - rank;
                if (diff > 0) {
                    change = '\u2191' + diff;
                    changeClass = 'up';
                } else if (diff < 0) {
                    change = '\u2193' + Math.abs(diff);
                    changeClass = 'down';
                } else {
                    change = '—';
                    changeClass = 'same';
                }
            }

            var rankDisplay = rank !== '-' && !isNaN(rank) ? rank : '';
            var rankMax = rankings.length > 0 ? rankings.length : 1;

            html += '<tr>';
            html += '<td class="rank-number"><input type="number" class="rank-input" data-student="' + r.studentId + '" value="' + rankDisplay + '" min="1" max="' + rankMax + '"></td>';
            html += '<td>' + r.firstName + (r.lastName ? ' ' + r.lastName : '') + '</td>';
            html += '<td style="font-weight:700;color:var(--accent);">' + (r.average > 0 ? r.average.toFixed(1) : '—') + '</td>';
            html += '<td>' + r.mandatoryCount + '</td>';
            html += '<td>' + r.optionalCount + '</td>';
            html += '<td><span class="rank-change ' + changeClass + '">' + change + '</span></td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;

        container.querySelectorAll('.rank-input').forEach(function(input) {
            input.addEventListener('change', function() {
                var studentId = this.dataset.student;
                var newRank = parseInt(this.value);
                var maxRank = parseInt(this.max);

                if (isNaN(newRank) || newRank < 1 || newRank > maxRank) {
                    alert('Please enter a rank between 1 and ' + maxRank);
                    this.value = this.defaultValue;
                    return;
                }

                var data = window.data || {};
                if (!data.curriculum) data.curriculum = {};
                if (!data.curriculum.rankings) data.curriculum.rankings = {};
                var existingRankings = data.curriculum.rankings[state.currentWeek] || [];

                var existing = existingRankings.find(function(e) { return String(e.studentId) === String(studentId); });
                if (existing) {
                    var oldRank = existing.rank;
                    existing.rank = newRank;

                    existingRankings.forEach(function(e) {
                        if (String(e.studentId) === String(studentId)) return;
                        if (oldRank < newRank && e.rank > oldRank && e.rank <= newRank) {
                            e.rank--;
                        } else if (oldRank > newRank && e.rank >= newRank && e.rank < oldRank) {
                            e.rank++;
                        }
                    });

                    var usedRanks = existingRankings.map(function(e) { return e.rank; });
                    var current = 1;
                    var sorted = existingRankings.slice().sort(function(a, b) { return a.rank - b.rank; });
                    sorted.forEach(function(e) {
                        while (usedRanks.indexOf(current) !== -1 && usedRanks.indexOf(current) !== usedRanks.indexOf(e.rank)) {
                            current++;
                        }
                        e.rank = current;
                        current++;
                    });

                    if (typeof window.saveData === 'function') {
                        window.saveData().catch(function(err) { /* ignore */ });
                    }
                    renderRanking();
                    if (typeof window.logActivity === 'function') {
                        window.logActivity('Updated rankings for week ' + state.currentWeek);
                    }
                }
            });
        });
    }

    function autoRank() {
        var students = window.getStudents();
        var rankings = [];

        students.forEach(function(student) {
            var data = window.data || {};
            var grades = data.curriculum && data.curriculum.grades && data.curriculum.grades[student.id] && data.curriculum.grades[student.id][state.currentWeek] ?
                data.curriculum.grades[student.id][state.currentWeek] : {};

            var disciplines = window.getAvailableDisciplines(state.currentWeek);
            var totalWeighted = 0;
            var totalWeight = 0;

            disciplines.forEach(function(d) {
                var score = grades[d.id];
                if (score !== undefined && score !== null && score !== '' && d.weight) {
                    totalWeighted += parseFloat(score) * d.weight;
                    totalWeight += d.weight;
                }
            });

            var average = totalWeight > 0 ? totalWeighted / totalWeight : 0;
            rankings.push({
                studentId: student.id,
                average: average
            });
        });

        rankings.sort(function(a, b) {
            if (b.average !== a.average) return b.average - a.average;
            var aName = window.getCharacterById(a.studentId);
            var bName = window.getCharacterById(b.studentId);
            var aFirstName = aName ? aName.firstName : '';
            var bFirstName = bName ? bName.firstName : '';
            return aFirstName.localeCompare(bFirstName);
        });

        var newRankings = [];
        rankings.forEach(function(r, index) {
            newRankings.push({
                studentId: r.studentId,
                rank: index + 1,
                average: r.average
            });
        });

        var data = window.data || {};
        if (!data.curriculum) data.curriculum = {};
        if (!data.curriculum.rankings) data.curriculum.rankings = {};
        data.curriculum.rankings[state.currentWeek] = newRankings;

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        renderRanking();
        if (typeof window.logActivity === 'function') {
            window.logActivity('Auto-ranked students for week ' + state.currentWeek);
        }
    }

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

        var saveBtn = document.getElementById('save-rankings-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
                        alert('Rankings saved successfully!');
                    }).catch(function(err) {
                        alert('Failed to save rankings: ' + err.message);
                    });
                } else {
                    alert('Rankings saved!');
                }
            });
        }
    }

    // Register with curriculum main if available
    if (typeof window.curriculumState !== 'undefined') {
        window.curriculumState.ranking = state;
    }

    window.renderRankingView = renderRankingView;
    window.renderRanking = renderRanking;
    window.autoRank = autoRank;
    window.initRankingEvents = initRankingEvents;
    window.rankingState = state;

})();