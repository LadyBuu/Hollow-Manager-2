/**
 * js/modules/missions.js - Mission Manager
 * Handles mission creation, assignment, tracking, and completion
 * Path: js/modules/missions.js
 */

(function() {
    'use strict';

    var state = {
        currentFilter: 'all',
        currentMissionId: null
    };

    function renderMissionsView(container) {
        if (!container) {
            container = document.getElementById('tab-missions');
        }
        if (!container) return;

        container.innerHTML = getMissionsHTML();

        populateTeamSelectors();
        renderMissions();
        initMissionEvents();
    }

    function getMissionsHTML() {
        return `
            <div class="page-header">
                <h2>Mission Manager</h2>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="add-mission-btn" class="primary">+ New Mission</button>
                    <button id="export-missions-csv-btn" class="small">\uD83D\uDCC4 Export CSV</button>
                    <button id="import-missions-csv-btn" class="small">\uD83D\uDCCD Import CSV</button>
                    <button id="template-missions-csv-btn" class="small secondary">Template CSV</button>
                    <input type="file" id="missions-csv-file-input" accept=".csv" style="display:none" />
                </div>
            </div>
            <div class="filter-section">
                <label for="mission-filter">Filter:</label>
                <select id="mission-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                    <option value="all">All Missions</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
                <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Total: <span id="mission-count">0</span></span>
            </div>
            <div id="missions-list">
                <p class="empty-state">No missions created yet. Create your first mission!</p>
            </div>

            <!-- Mission Form Modal -->
            <div id="mission-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h3 id="mission-form-title">Create Mission</h3>
                        <button class="close-modal" id="close-mission-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="mission-form-inner">
                            <div class="form-grid">
                                <div class="form-group full-width">
                                    <label>Mission Title *</label>
                                    <input type="text" id="mission-title" required placeholder="e.g., Operation Nightfall">
                                </div>
                                <div class="form-group full-width">
                                    <label>Description</label>
                                    <textarea id="mission-description" rows="2" placeholder="Brief description of the mission..."></textarea>
                                </div>
                                <div class="form-group">
                                    <label>Location</label>
                                    <input type="text" id="mission-location" placeholder="e.g., Berlin, Germany">
                                </div>
                                <div class="form-group">
                                    <label>Expected Duration</label>
                                    <input type="text" id="mission-duration" placeholder="e.g., 3 days, 2 weeks">
                                </div>
                                <div class="form-group">
                                    <label>Difficulty</label>
                                    <select id="mission-difficulty">
                                        <option value="easy">Easy</option>
                                        <option value="medium" selected>Medium</option>
                                        <option value="hard">Hard</option>
                                        <option value="expert">Expert</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Priority</label>
                                    <select id="mission-priority">
                                        <option value="low">Low</option>
                                        <option value="medium" selected>Medium</option>
                                        <option value="high">High</option>
                                        <option value="critical">Critical</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Pay/Reward</label>
                                    <input type="text" id="mission-pay" placeholder="e.g., 5000 credits">
                                </div>
                                <div class="form-group">
                                    <label>Assign Team</label>
                                    <select id="mission-team">
                                        <option value="">Unassigned</option>
                                    </select>
                                </div>
                                <div class="form-group full-width">
                                    <label>Objective</label>
                                    <input type="text" id="mission-objective" placeholder="Primary objective...">
                                    <button type="button" id="add-objective-btn" class="small primary" style="margin-top:4px;">+ Add Objective</button>
                                    <div id="mission-objectives-list" style="margin-top:8px;"></div>
                                </div>
                                <div class="form-group full-width">
                                    <label>Notes</label>
                                    <textarea id="mission-notes" rows="2" placeholder="Additional notes..."></textarea>
                                </div>
                                <div class="form-group full-width">
                                    <label>Tags (comma separated)</label>
                                    <input type="text" id="mission-tags" placeholder="e.g., covert, rescue, extraction">
                                </div>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-mission-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-mission-btn" class="primary">Save Mission</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Mission Detail Modal -->
            <div id="mission-detail-modal" class="modal hidden">
                <div class="modal-content" style="max-width:700px;">
                    <div class="modal-header">
                        <h3 id="detail-mission-title">Mission Details</h3>
                        <button class="close-modal" id="close-mission-detail">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="mission-detail-content"></div>
                        <div class="form-actions" style="margin-top:16px;">
                            <button type="button" id="edit-mission-from-detail" class="primary">Edit</button>
                            <button type="button" id="delete-mission-from-detail" class="danger">Delete Mission</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderMissions() {
        var container = document.getElementById('missions-list');
        if (!container) return;

        var filter = document.getElementById('mission-filter') ? document.getElementById('mission-filter').value : 'all';
        var missions = getMissions(filter);
        var count = document.getElementById('mission-count');
        if (count) count.textContent = missions.length;

        if (missions.length === 0) {
            var filterLabels = {
                'all': 'missions',
                'active': 'active missions',
                'completed': 'completed missions',
                'cancelled': 'cancelled missions'
            };
            container.innerHTML = '<p class="empty-state">No ' + (filterLabels[filter] || 'missions') + ' found.</p>';
            return;
        }

        var html = '';
        missions.forEach(function(mission) {
            var priorityInfo = getPriorityInfo(mission.priority);
            var statusInfo = getStatusInfo(mission.status);
            var teamName = getTeamName(mission.assignedTeamId);
            var teamType = getTeamTypeLabel(mission.assignedTeamId);
            var teamDisplay = teamName + (teamType ? ' (' + teamType + ')' : '');
            var progressBar = mission.progress || 0;
            var difficultyLabel = getDifficultyLabel(mission.difficulty);

            html += '<div class="list-item" style="grid-template-columns:1.2fr 0.6fr 0.6fr 0.6fr 0.6fr 1fr;cursor:pointer;" data-id="' + mission.id + '">';
            html += '<span><strong>' + mission.title + '</strong>';
            if (mission.status === 'completed') {
                html += ' <span style="color:var(--info);font-size:0.6rem;">\u2713</span>';
            }
            html += '</span>';
            html += '<span style="color:' + priorityInfo.color + ';font-size:0.75rem;">' + priorityInfo.label + '</span>';
            html += '<span style="font-size:0.75rem;">' + difficultyLabel + '</span>';
            html += '<span style="color:' + statusInfo.color + ';font-size:0.75rem;">' + statusInfo.label + '</span>';
            html += '<span style="font-size:0.75rem;">' + teamDisplay + '</span>';
            html += '<span style="display:flex;align-items:center;gap:8px;">';
            html += '<div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden;">';
            html += '<div style="height:100%;width:' + progressBar + '%;background:var(--accent);border-radius:3px;"></div>';
            html += '</div>';
            html += '<span style="font-size:0.7rem;color:var(--text-dim);min-width:35px;">' + progressBar + '%</span>';
            html += '</span>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                showMissionDetail(id);
            });
        });
    }

    function getMissions(filter) {
        var data = window.data || {};
        if (!data.missions) {
            data.missions = [];
            return [];
        }

        var missions = data.missions.slice();

        if (filter === 'active') {
            missions = missions.filter(function(m) { return m.status === 'active'; });
        } else if (filter === 'completed') {
            missions = missions.filter(function(m) { return m.status === 'completed'; });
        } else if (filter === 'cancelled') {
            missions = missions.filter(function(m) { return m.status === 'cancelled'; });
        }

        var priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
        missions.sort(function(a, b) {
            var pa = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 2;
            var pb = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 2;
            if (pa !== pb) return pa - pb;
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        return missions;
    }

    function getMission(id) {
        var data = window.data || {};
        if (!data.missions) return null;
        return data.missions.find(function(m) { return String(m.id) === String(id); });
    }

    function createMission(missionData) {
        var data = window.data || {};
        if (!data.missions) data.missions = [];

        var mission = {
            id: window.generateId('miss'),
            title: missionData.title || 'Untitled Mission',
            description: missionData.description || '',
            location: missionData.location || '',
            objective: missionData.objective || '',
            duration: missionData.duration || '',
            difficulty: missionData.difficulty || 'medium',
            pay: missionData.pay || '',
            assignedTeamId: missionData.assignedTeamId || null,
            status: 'active',
            priority: missionData.priority || 'medium',
            tags: missionData.tags || [],
            objectives: missionData.objectives || [],
            progress: 0,
            notes: missionData.notes || '',
            createdAt: new Date().toISOString(),
            completedAt: null,
            log: []
        };

        data.missions.push(mission);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Created mission: ' + mission.title);
        }
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function updateMission(id, updates) {
        var mission = getMission(id);
        if (!mission) return null;

        var changes = [];
        for (var key in updates) {
            if (updates[key] !== undefined && updates[key] !== null && String(mission[key]) !== String(updates[key])) {
                changes.push(key);
                mission[key] = updates[key];
            }
        }

        if (updates.status === 'completed' && mission.status === 'completed') {
            mission.completedAt = new Date().toISOString();
        }

        if (updates.objectives) {
            var total = mission.objectives.length;
            var completed = mission.objectives.filter(function(o) { return o.done; }).length;
            mission.progress = total > 0 ? Math.round((completed / total) * 100) : 0;
        }

        if (changes.length > 0 && typeof window.logActivity === 'function') {
            window.logActivity('Updated mission: ' + mission.title + ' (' + changes.join(', ') + ')');
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function deleteMission(id) {
        var data = window.data || {};
        var mission = getMission(id);
        if (!mission) return false;

        data.missions = data.missions.filter(function(m) { return String(m.id) !== String(id); });
        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted mission: ' + mission.title);
        }
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return true;
    }

    function toggleObjective(missionId, objectiveIndex) {
        var mission = getMission(missionId);
        if (!mission || !mission.objectives || !mission.objectives[objectiveIndex]) return null;

        mission.objectives[objectiveIndex].done = !mission.objectives[objectiveIndex].done;

        var total = mission.objectives.length;
        var completed = mission.objectives.filter(function(o) { return o.done; }).length;
        mission.progress = total > 0 ? Math.round((completed / total) * 100) : 0;

        if (mission.progress === 100 && mission.status === 'active') {
            mission.status = 'completed';
            mission.completedAt = new Date().toISOString();
            if (typeof window.logActivity === 'function') {
                window.logActivity('Mission completed: ' + mission.title);
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function addObjective(missionId, text) {
        var mission = getMission(missionId);
        if (!mission) return null;

        if (!mission.objectives) mission.objectives = [];
        mission.objectives.push({
            text: text,
            done: false
        });

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function addMissionLog(missionId, message) {
        var mission = getMission(missionId);
        if (!mission) return null;

        if (!mission.log) mission.log = [];
        mission.log.push({
            timestamp: new Date().toISOString(),
            message: message
        });

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return mission;
    }

    function populateTeamSelectors() {
        var select = document.getElementById('mission-team');
        if (!select) return;

        var data = window.data || {};
        var allTeams = data.teams ? data.teams.filter(function(t) {
            return t.status !== 'deleted' && t.status !== 'inactive';
        }) : [];

        var academicTeams = allTeams.filter(function(t) { return t.type === 'academic'; });
        var professionalTeams = allTeams.filter(function(t) { return t.type === 'professional'; });
        var temporaryTeams = allTeams.filter(function(t) { return t.type === 'temporary' || t.type === 'internship'; });

        academicTeams.sort(function(a, b) { return a.name.localeCompare(b.name); });
        professionalTeams.sort(function(a, b) { return a.name.localeCompare(b.name); });
        temporaryTeams.sort(function(a, b) { return a.name.localeCompare(b.name); });

        select.innerHTML = '<option value="">Unassigned</option>';

        if (professionalTeams.length > 0) {
            var optGroup = document.createElement('optgroup');
            optGroup.label = 'Professional Teams';
            professionalTeams.forEach(function(team) {
                var option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name;
                optGroup.appendChild(option);
            });
            select.appendChild(optGroup);
        }

        if (temporaryTeams.length > 0) {
            var optGroup = document.createElement('optgroup');
            optGroup.label = 'Temporary Teams';
            temporaryTeams.forEach(function(team) {
                var option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name;
                optGroup.appendChild(option);
            });
            select.appendChild(optGroup);
        }

        if (academicTeams.length > 0) {
            var optGroup = document.createElement('optgroup');
            optGroup.label = 'Academic Teams';
            academicTeams.forEach(function(team) {
                var option = document.createElement('option');
                option.value = team.id;
                option.textContent = team.name + ' (Academic)';
                optGroup.appendChild(option);
            });
            select.appendChild(optGroup);
        }
    }

    function getTeamName(teamId) {
        if (!teamId) return 'Unassigned';
        var team = window.getTeamById(teamId);
        return team ? team.name : 'Unknown Team';
    }

    function getTeamTypeLabel(teamId) {
        if (!teamId) return '';
        var team = window.getTeamById(teamId);
        if (!team) return '';
        var typeMap = {
            'academic': 'Academic',
            'professional': 'Professional',
            'temporary': 'Temporary',
            'internship': 'Temporary'
        };
        return typeMap[team.type] || '';
    }

    function getPriorityInfo(priority) {
        var map = {
            'critical': { label: 'Critical', color: 'var(--danger)' },
            'high': { label: 'High', color: 'var(--warning)' },
            'medium': { label: 'Medium', color: 'var(--warning)' },
            'low': { label: 'Low', color: 'var(--accent)' }
        };
        return map[priority] || { label: 'Medium', color: 'var(--text-dim)' };
    }

    function getStatusInfo(status) {
        var map = {
            'active': { label: 'Active', color: 'var(--accent)' },
            'completed': { label: 'Completed', color: 'var(--info)' },
            'cancelled': { label: 'Cancelled', color: 'var(--danger)' }
        };
        return map[status] || { label: 'Active', color: 'var(--text-dim)' };
    }

    function getDifficultyLabel(difficulty) {
        var map = {
            'easy': 'Easy',
            'medium': 'Medium',
            'hard': 'Hard',
            'expert': 'Expert'
        };
        return map[difficulty] || difficulty || 'Medium';
    }

    function showMissionDetail(id) {
        var mission = getMission(id);
        if (!mission) return;

        var modal = document.getElementById('mission-detail-modal');
        var content = document.getElementById('mission-detail-content');
        var title = document.getElementById('detail-mission-title');
        title.textContent = mission.title;

        var priorityInfo = getPriorityInfo(mission.priority);
        var statusInfo = getStatusInfo(mission.status);
        var teamName = getTeamName(mission.assignedTeamId);
        var teamType = getTeamTypeLabel(mission.assignedTeamId);
        var teamDisplay = teamName + (teamType ? ' (' + teamType + ')' : '');
        var difficultyLabel = getDifficultyLabel(mission.difficulty);

        var progressBar = mission.progress || 0;
        var createdAt = new Date(mission.createdAt).toLocaleDateString();
        var completedAt = mission.completedAt ? new Date(mission.completedAt).toLocaleDateString() : 'Not completed';

        var objectivesHtml = '';
        if (mission.objectives && mission.objectives.length > 0) {
            objectivesHtml = '<div style="margin-top:8px;"><strong>Objectives:</strong><ul style="list-style:none;padding:0;margin:4px 0;">';
            mission.objectives.forEach(function(obj, index) {
                var doneClass = obj.done ? 'style="text-decoration:line-through;color:var(--text-dim);"' : '';
                objectivesHtml += '<li style="padding:4px 8px;border-bottom:1px solid var(--border-soft);display:flex;align-items:center;gap:8px;" ' + doneClass + '>';
                objectivesHtml += '<input type="checkbox" ' + (obj.done ? 'checked' : '') + ' data-mission="' + mission.id + '" data-index="' + index + '" class="objective-check">';
                objectivesHtml += '<span>' + obj.text + '</span>';
                objectivesHtml += '</li>';
            });
            objectivesHtml += '</ul></div>';
        }

        var logHtml = '';
        if (mission.log && mission.log.length > 0) {
            logHtml = '<div style="margin-top:12px;max-height:150px;overflow-y:auto;font-size:0.75rem;background:var(--bg);border-radius:6px;padding:8px;">';
            logHtml += '<strong>Activity Log:</strong>';
            mission.log.slice().reverse().forEach(function(entry) {
                var date = new Date(entry.timestamp).toLocaleString();
                logHtml += '<div style="padding:2px 0;border-bottom:1px solid var(--border-soft);color:var(--text-dim);">' + date + ' - ' + entry.message + '</div>';
            });
            logHtml += '</div>';
        }

        var tagsHtml = '';
        if (mission.tags && mission.tags.length > 0) {
            tagsHtml = '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">';
            mission.tags.forEach(function(tag) {
                tagsHtml += '<span style="background:var(--panel-alt);padding:2px 8px;border-radius:10px;font-size:0.65rem;color:var(--text-dim);">#' + tag + '</span>';
            });
            tagsHtml += '</div>';
        }

        content.innerHTML = `
            <div class="detail-row"><span class="label">Status:</span> <span style="color:${statusInfo.color};font-weight:600;">${statusInfo.label}</span></div>
            <div class="detail-row"><span class="label">Priority:</span> <span style="color:${priorityInfo.color};font-weight:600;">${priorityInfo.label}</span></div>
            <div class="detail-row"><span class="label">Difficulty:</span> <span>${difficultyLabel}</span></div>
            <div class="detail-row"><span class="label">Team:</span> <span>${teamDisplay}</span></div>
            <div class="detail-row"><span class="label">Location:</span> <span>${mission.location || 'Not specified'}</span></div>
            <div class="detail-row"><span class="label">Duration:</span> <span>${mission.duration || 'Not specified'}</span></div>
            <div class="detail-row"><span class="label">Pay:</span> <span>${mission.pay || 'Not specified'}</span></div>
            <div class="detail-row"><span class="label">Created:</span> <span>${createdAt}</span></div>
            <div class="detail-row"><span class="label">Completed:</span> <span>${completedAt}</span></div>
            ${mission.description ? '<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="label">Description:</span><span style="padding:4px 0;">' + mission.description + '</span></div>' : ''}
            ${mission.notes ? '<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="label">Notes:</span><span style="padding:4px 0;">' + mission.notes + '</span></div>' : ''}
            ${tagsHtml}
            <div style="margin-top:8px;">
                <strong>Progress:</strong>
                <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                    <div style="flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden;">
                        <div style="height:100%;width:${progressBar}%;background:var(--accent);border-radius:4px;"></div>
                    </div>
                    <span style="font-size:0.8rem;color:var(--text-dim);min-width:40px;">${progressBar}%</span>
                </div>
            </div>
            ${objectivesHtml}
            ${logHtml}
        `;

        content.querySelectorAll('.objective-check').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var missionId = this.dataset.mission;
                var index = parseInt(this.dataset.index);
                toggleObjective(missionId, index);
                showMissionDetail(missionId);
                renderMissions();
            });
        });

        modal.dataset.missionId = id;
        modal.classList.remove('hidden');
    }

    function showMissionForm(editId) {
        var modal = document.getElementById('mission-form-modal');
        var title = document.getElementById('mission-form-title');
        var form = document.getElementById('mission-form-inner');

        modal.classList.remove('hidden');
        populateTeamSelectors();

        document.getElementById('mission-objectives-list').innerHTML = '';

        if (editId) {
            title.textContent = 'Edit Mission';
            var mission = getMission(editId);
            if (mission) {
                document.getElementById('mission-title').value = mission.title || '';
                document.getElementById('mission-description').value = mission.description || '';
                document.getElementById('mission-location').value = mission.location || '';
                document.getElementById('mission-duration').value = mission.duration || '';
                document.getElementById('mission-difficulty').value = mission.difficulty || 'medium';
                document.getElementById('mission-priority').value = mission.priority || 'medium';
                document.getElementById('mission-pay').value = mission.pay || '';
                document.getElementById('mission-team').value = mission.assignedTeamId || '';
                document.getElementById('mission-objective').value = '';
                document.getElementById('mission-notes').value = mission.notes || '';
                document.getElementById('mission-tags').value = (mission.tags || []).join(', ');

                if (mission.objectives) {
                    mission.objectives.forEach(function(obj) {
                        addObjectiveToList(obj.text);
                    });
                }
                form.dataset.editId = editId;
            }
        } else {
            title.textContent = 'Create Mission';
            form.reset();
            document.getElementById('mission-difficulty').value = 'medium';
            document.getElementById('mission-priority').value = 'medium';
            document.getElementById('mission-team').value = '';
            delete form.dataset.editId;
        }
    }

    function addObjectiveToList(text) {
        var container = document.getElementById('mission-objectives-list');
        if (!container) return;

        var div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;align-items:center;';
        div.innerHTML = `
            <span style="flex:1;font-size:0.8rem;padding:4px 8px;background:var(--bg);border-radius:4px;">${text}</span>
            <button type="button" class="small danger remove-objective-btn">\u2715</button>
            <input type="hidden" value="${text}">
        `;
        container.appendChild(div);

        div.querySelector('.remove-objective-btn').onclick = function() {
            div.remove();
        };
    }

    function saveMission(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var objectives = [];
        document.querySelectorAll('#mission-objectives-list .remove-objective-btn').forEach(function(btn) {
            var parent = btn.parentElement;
            var text = parent.querySelector('input[type="hidden"]') ? parent.querySelector('input[type="hidden"]').value : parent.querySelector('span').textContent || '';
            if (text.trim()) {
                objectives.push({ text: text.trim(), done: false });
            }
        });

        var objectiveInput = document.getElementById('mission-objective');
        if (objectiveInput.value.trim()) {
            objectives.push({ text: objectiveInput.value.trim(), done: false });
        }

        var tags = document.getElementById('mission-tags').value.split(',').map(function(t) { return t.trim(); }).filter(function(t) { return t; });

        var missionData = {
            title: document.getElementById('mission-title').value.trim(),
            description: document.getElementById('mission-description').value.trim(),
            location: document.getElementById('mission-location').value.trim(),
            duration: document.getElementById('mission-duration').value.trim(),
            difficulty: document.getElementById('mission-difficulty').value,
            priority: document.getElementById('mission-priority').value,
            pay: document.getElementById('mission-pay').value.trim(),
            assignedTeamId: document.getElementById('mission-team').value || null,
            objectives: objectives,
            notes: document.getElementById('mission-notes').value.trim(),
            tags: tags,
            status: 'active',
            progress: 0
        };

        if (!missionData.title) {
            alert('Mission title is required.');
            return;
        }

        if (editId) {
            var updated = updateMission(editId, missionData);
            if (updated) {
                addMissionLog(editId, 'Mission updated');
            }
        } else {
            var newMission = createMission(missionData);
            if (newMission) {
                addMissionLog(newMission.id, 'Mission created');
            }
        }

        closeMissionForm();
        renderMissions();
    }

    function closeMissionForm() {
        document.getElementById('mission-form-modal').classList.add('hidden');
    }

    function closeMissionDetail() {
        document.getElementById('mission-detail-modal').classList.add('hidden');
    }

    function exportMissionsCSV() {
        var missions = getMissions('all');
        if (missions.length === 0) {
            alert('No missions to export.');
            return;
        }

        var lines = [];
        lines.push('Title,Status,Priority,Difficulty,Team,TeamType,Location,Duration,Pay,Progress,Objectives,Notes,Tags,Created At,Completed At');

        missions.forEach(function(m) {
            var teamName = getTeamName(m.assignedTeamId);
            var teamType = getTeamTypeLabel(m.assignedTeamId);
            var objectivesStr = '';
            if (m.objectives) {
                objectivesStr = m.objectives.map(function(o) {
                    return o.text + (o.done ? ' \u2713' : '');
                }).join('; ');
            }
            var tagsStr = (m.tags || []).join('; ');
            var createdAt = m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '';
            var completedAt = m.completedAt ? new Date(m.completedAt).toLocaleDateString() : '';

            var row = [
                csvField(m.title || ''),
                m.status || 'active',
                m.priority || 'medium',
                m.difficulty || 'medium',
                csvField(teamName),
                csvField(teamType),
                csvField(m.location || ''),
                csvField(m.duration || ''),
                csvField(m.pay || ''),
                m.progress || '0',
                csvField(objectivesStr),
                csvField(m.notes || ''),
                csvField(tagsStr),
                createdAt,
                completedAt
            ];
            lines.push(row.join(','));
        });

        var csvContent = lines.join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'missions-export-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported ' + missions.length + ' missions to CSV');
        }
    }

    function exportMissionTemplateCSV() {
        var lines = [
            'Title,Status,Priority,Difficulty,Team,TeamType,Location,Duration,Pay,Progress,Objectives,Notes,Tags,Created At,Completed At',
            'Operation Nightfall,active,high,hard,Shadow Squad,Professional,Berlin,2 weeks,5000 credits,50,Infiltrate base;Retrieve documents \u2713;Extract intel,Use stealth approach,covert;rescue,2024-01-15,',
            'Rescue Mission,active,medium,medium,Team Alpha,Academic,London,3 days,2000 credits,0,Find hostages;Extract safely,Proceed with caution,rescue;hostage,2024-01-20,',
            'Supply Run,completed,low,easy,Logistics Team,Temporary,Outpost 7,1 day,500 credits,100,Deliver supplies \u2713;Check inventory \u2713,All delivered,logistics;supply,2024-01-10,2024-01-11'
        ];

        var csvContent = lines.join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'mission-template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported mission template CSV');
        }
    }

    function importMissionsCSV(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                if (!confirm('This will add missions from the CSV file. Existing missions will be preserved. Continue?')) return;

                var lines = e.target.result.split('\n');
                var headers = [];
                var importedCount = 0;
                var errorCount = 0;

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line) continue;

                    var values = parseCSVLine(line);

                    if (i === 0) {
                        var possibleHeaders = ['Title', 'Status', 'Priority', 'Difficulty', 'Team', 'TeamType', 'Location', 'Duration', 'Pay', 'Progress', 'Objectives', 'Notes', 'Tags', 'Created At', 'Completed At'];
                        var headerMatch = 0;
                        values.forEach(function(v) {
                            if (possibleHeaders.indexOf(v.trim()) !== -1) headerMatch++;
                        });
                        if (headerMatch >= 3) {
                            headers = values.map(function(h) { return h.trim(); });
                            continue;
                        }
                    }

                    var missionData = {
                        title: '',
                        status: 'active',
                        priority: 'medium',
                        difficulty: 'medium',
                        assignedTeamId: null,
                        location: '',
                        duration: '',
                        pay: '',
                        progress: 0,
                        objectives: [],
                        notes: '',
                        tags: []
                    };

                    var headerMap = {
                        'Title': 'title',
                        'Status': 'status',
                        'Priority': 'priority',
                        'Difficulty': 'difficulty',
                        'Team': 'teamName',
                        'Location': 'location',
                        'Duration': 'duration',
                        'Pay': 'pay',
                        'Progress': 'progress',
                        'Objectives': 'objectives',
                        'Notes': 'notes',
                        'Tags': 'tags'
                    };

                    if (headers.length === 0) {
                        headers = ['Title', 'Status', 'Priority', 'Difficulty', 'Team', 'TeamType', 'Location', 'Duration', 'Pay', 'Progress', 'Objectives', 'Notes', 'Tags', 'Created At', 'Completed At'];
                    }

                    headers.forEach(function(header, index) {
                        var value = values[index] ? values[index].trim() : '';
                        var mapped = headerMap[header];

                        if (!mapped) return;

                        if (mapped === 'title') {
                            missionData.title = value;
                        } else if (mapped === 'status') {
                            if (['active', 'completed', 'cancelled'].indexOf(value) !== -1) {
                                missionData.status = value;
                            }
                        } else if (mapped === 'priority') {
                            if (['low', 'medium', 'high', 'critical'].indexOf(value) !== -1) {
                                missionData.priority = value;
                            }
                        } else if (mapped === 'difficulty') {
                            if (['easy', 'medium', 'hard', 'expert'].indexOf(value) !== -1) {
                                missionData.difficulty = value;
                            }
                        } else if (mapped === 'teamName') {
                            if (value) {
                                var data = window.data || {};
                                var team = data.teams ? data.teams.find(function(t) {
                                    return t.name.toLowerCase() === value.toLowerCase() && t.status !== 'deleted';
                                }) : null;
                                if (team) {
                                    missionData.assignedTeamId = team.id;
                                }
                            }
                        } else if (mapped === 'location') {
                            missionData.location = value;
                        } else if (mapped === 'duration') {
                            missionData.duration = value;
                        } else if (mapped === 'pay') {
                            missionData.pay = value;
                        } else if (mapped === 'progress') {
                            var prog = parseInt(value);
                            if (!isNaN(prog)) missionData.progress = prog;
                        } else if (mapped === 'objectives') {
                            if (value) {
                                var objParts = value.split(';');
                                objParts.forEach(function(part) {
                                    part = part.trim();
                                    if (part) {
                                        var done = part.endsWith('\u2713');
                                        var text = part.replace('\u2713', '').trim();
                                        if (text) {
                                            missionData.objectives.push({ text: text, done: done });
                                        }
                                    }
                                });
                            }
                        } else if (mapped === 'notes') {
                            missionData.notes = value;
                        } else if (mapped === 'tags') {
                            if (value) {
                                missionData.tags = value.split(';').map(function(t) { return t.trim(); }).filter(function(t) { return t; });
                            }
                        }
                    });

                    if (!missionData.title) {
                        errorCount++;
                        continue;
                    }

                    var newMission = createMission(missionData);
                    if (newMission) {
                        importedCount++;
                        if (missionData.status === 'completed') {
                            newMission.status = 'completed';
                            newMission.completedAt = new Date().toISOString();
                        }
                        if (missionData.progress > 0) {
                            newMission.progress = missionData.progress;
                        }
                        addMissionLog(newMission.id, 'Imported from CSV');
                    }
                }

                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
                        renderMissions();
                        alert('CSV import completed!\n\n' +
                            'Successfully imported: ' + importedCount + ' missions\n' +
                            'Errors: ' + errorCount);
                    }).catch(function(err) {
                        alert('Failed to save missions: ' + err.message);
                    });
                } else {
                    renderMissions();
                    alert('CSV import completed!\n\n' +
                        'Successfully imported: ' + importedCount + ' missions\n' +
                        'Errors: ' + errorCount);
                }

            } catch (err) {
                alert('Failed to import CSV: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function csvField(value) {
        if (value === null || value === undefined) return '';
        var str = String(value);
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function parseCSVLine(line) {
        var values = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    values.push(current.trim());
                    current = '';
                } else if (ch === '\n' || ch === '\r') {
                    // skip
                } else {
                    current += ch;
                }
            }
        }
        values.push(current.trim());
        return values;
    }

    function initMissionEvents() {
        var addBtn = document.getElementById('add-mission-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() { showMissionForm(); });
        }

        var exportBtn = document.getElementById('export-missions-csv-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportMissionsCSV);
        }

        var importBtn = document.getElementById('import-missions-csv-btn');
        if (importBtn) {
            importBtn.addEventListener('click', function() {
                document.getElementById('missions-csv-file-input').click();
            });
        }
        var fileInput = document.getElementById('missions-csv-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', function(e) {
                if (this.files.length > 0) {
                    importMissionsCSV(this.files[0]);
                    this.value = '';
                }
            });
        }

        var templateBtn = document.getElementById('template-missions-csv-btn');
        if (templateBtn) {
            templateBtn.addEventListener('click', exportMissionTemplateCSV);
        }

        var closeFormBtn = document.getElementById('close-mission-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', closeMissionForm);
        }
        var cancelFormBtn = document.getElementById('cancel-mission-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', closeMissionForm);
        }
        var formModal = document.getElementById('mission-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) closeMissionForm();
            });
        }

        var form = document.getElementById('mission-form-inner');
        if (form) {
            form.addEventListener('submit', saveMission);
        }

        var addObjBtn = document.getElementById('add-objective-btn');
        if (addObjBtn) {
            addObjBtn.addEventListener('click', function() {
                var input = document.getElementById('mission-objective');
                if (input.value.trim()) {
                    addObjectiveToList(input.value.trim());
                    input.value = '';
                }
            });
        }
        var objectiveInput = document.getElementById('mission-objective');
        if (objectiveInput) {
            objectiveInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('add-objective-btn').click();
                }
            });
        }

        var closeDetailBtn = document.getElementById('close-mission-detail');
        if (closeDetailBtn) {
            closeDetailBtn.addEventListener('click', closeMissionDetail);
        }
        var detailModal = document.getElementById('mission-detail-modal');
        if (detailModal) {
            detailModal.addEventListener('click', function(e) {
                if (e.target === this) closeMissionDetail();
            });
        }

        var filterSelect = document.getElementById('mission-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', renderMissions);
        }

        var editDetailBtn = document.getElementById('edit-mission-from-detail');
        if (editDetailBtn) {
            editDetailBtn.addEventListener('click', function() {
                var modal = document.getElementById('mission-detail-modal');
                var id = modal.dataset.missionId;
                if (id) {
                    closeMissionDetail();
                    showMissionForm(id);
                }
            });
        }

        var deleteDetailBtn = document.getElementById('delete-mission-from-detail');
        if (deleteDetailBtn) {
            deleteDetailBtn.addEventListener('click', function() {
                var modal = document.getElementById('mission-detail-modal');
                var id = modal.dataset.missionId;
                if (id && confirm('Delete this mission permanently?')) {
                    deleteMission(id);
                    closeMissionDetail();
                    renderMissions();
                }
            });
        }
    }

    // Register with TabManager
    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('missions', renderMissionsView);
    }

    document.addEventListener('dataLoaded', function() {
        var container = document.getElementById('tab-missions');
        if (container && container.style.display !== 'none') {
            renderMissionsView(container);
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-missions');
            if (container && container.style.display !== 'none') {
                renderMissionsView(container);
            }
        }, 100);
    }

    window.renderMissionsView = renderMissionsView;
    window.renderMissions = renderMissions;
    window.showMissionForm = showMissionForm;
    window.saveMission = saveMission;
    window.deleteMission = deleteMission;
    window.getMission = getMission;
    window.getMissions = getMissions;
    window.createMission = createMission;
    window.updateMission = updateMission;
    window.addMissionLog = addMissionLog;
    window.toggleObjective = toggleObjective;
    window.addObjective = addObjective;
    window.showMissionDetail = showMissionDetail;
    window.closeMissionForm = closeMissionForm;
    window.closeMissionDetail = closeMissionDetail;
    window.initMissionEvents = initMissionEvents;
    window.getTeamName = getTeamName;
    window.getTeamTypeLabel = getTeamTypeLabel;
    window.getPriorityInfo = getPriorityInfo;
    window.getStatusInfo = getStatusInfo;
    window.getDifficultyLabel = getDifficultyLabel;
    window.populateTeamSelectors = populateTeamSelectors;
    window.addObjectiveToList = addObjectiveToList;
    window.exportMissionsCSV = exportMissionsCSV;
    window.exportMissionTemplateCSV = exportMissionTemplateCSV;
    window.importMissionsCSV = importMissionsCSV;
    window.csvField = csvField;
    window.parseCSVLine = parseCSVLine;

})();