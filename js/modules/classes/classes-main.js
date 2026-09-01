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
 *   - Rankings: Class-based rankings (placeholder)
 *   - Groups: Auto-groups scoped to graduating classes (placeholder)
 *   - Tournaments: Class-based tournaments (placeholder)
 */

(function() {
    'use strict';

    // ============================================================
    // FALLBACK FUNCTIONS - In case graduating-class-core.js isn't loaded
    // ============================================================

    (function ensureGraduatingClassFunctions() {
        // Only create fallbacks if the core functions don't exist
        if (typeof window.getGraduatingClasses !== 'function') {
            console.warn('[Classes] Graduating class core not loaded, creating fallbacks.');
            
            // Initialize the data structure
            var data = window.data || {};
            if (!data.graduatingClasses) {
                data.graduatingClasses = [];
            }
            
            // Ensure characters have the new fields
            if (data.characters) {
                for (var i = 0; i < data.characters.length; i++) {
                    var char = data.characters[i];
                    if (char.graduatingClassId === undefined) {
                        char.graduatingClassId = null;
                    }
                    if (char.graduatingClassInstructor === undefined) {
                        char.graduatingClassInstructor = false;
                    }
                }
            }
            
            // Create fallback functions
            window.getGraduatingClasses = function() {
                var data = window.data || {};
                if (!data.graduatingClasses) {
                    data.graduatingClasses = [];
                }
                return data.graduatingClasses || [];
            };
            
            window.getGraduatingClass = function(id) {
                var classes = window.getGraduatingClasses();
                for (var i = 0; i < classes.length; i++) {
                    if (String(classes[i].id) === String(id)) {
                        return JSON.parse(JSON.stringify(classes[i]));
                    }
                }
                return null;
            };
            
            window.getGraduatingClassByName = function(name) {
                var classes = window.getGraduatingClasses();
                var target = name.trim().toLowerCase();
                for (var i = 0; i < classes.length; i++) {
                    if (classes[i].name && classes[i].name.trim().toLowerCase() === target) {
                        return JSON.parse(JSON.stringify(classes[i]));
                    }
                }
                return null;
            };
            
            window.createGraduatingClass = function(name) {
                var data = window.data || {};
                if (!data.graduatingClasses) {
                    data.graduatingClasses = [];
                }
                
                // Check duplicate
                var target = name.trim().toLowerCase();
                var existing = data.graduatingClasses.find(function(c) {
                    return c && c.name && c.name.trim().toLowerCase() === target;
                });
                
                if (existing) {
                    return { success: false, message: 'A graduating class with this name already exists.' };
                }
                
                var newClass = {
                    id: 'gradclass_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    name: name.trim(),
                    createdAt: new Date().toISOString()
                };
                data.graduatingClasses.push(newClass);
                
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Created graduating class: ' + newClass.name);
                }
                
                return { success: true, data: { graduatingClass: newClass } };
            };
            
            window.updateGraduatingClass = function(id, name) {
                var data = window.data || {};
                if (!data.graduatingClasses) {
                    return { success: false, message: 'No classes found.' };
                }
                
                var newName = name.trim();
                var index = -1;
                for (var i = 0; i < data.graduatingClasses.length; i++) {
                    if (String(data.graduatingClasses[i].id) === String(id)) {
                        index = i;
                        break;
                    }
                }
                
                if (index === -1) {
                    return { success: false, message: 'Class not found.' };
                }
                
                // Check duplicate
                var existing = data.graduatingClasses.find(function(c) {
                    return c && String(c.id) !== String(id) && 
                           c.name && c.name.trim().toLowerCase() === newName.toLowerCase();
                });
                
                if (existing) {
                    return { success: false, message: 'A class with this name already exists.' };
                }
                
                data.graduatingClasses[index].name = newName;
                
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Updated graduating class: ' + newName);
                }
                
                return { success: true, data: { graduatingClass: data.graduatingClasses[index] } };
            };
            
            window.deleteGraduatingClass = function(id) {
                var data = window.data || {};
                if (!data.graduatingClasses) {
                    return { success: false, message: 'No classes found.' };
                }
                
                var index = -1;
                var name = '';
                for (var i = 0; i < data.graduatingClasses.length; i++) {
                    if (String(data.graduatingClasses[i].id) === String(id)) {
                        index = i;
                        name = data.graduatingClasses[i].name;
                        break;
                    }
                }
                
                if (index === -1) {
                    return { success: false, message: 'Class not found.' };
                }
                
                data.graduatingClasses.splice(index, 1);
                
                // Clean up character references
                var affected = 0;
                if (data.characters) {
                    for (var i = 0; i < data.characters.length; i++) {
                        if (String(data.characters[i].graduatingClassId) === String(id)) {
                            data.characters[i].graduatingClassId = null;
                            data.characters[i].graduatingClassInstructor = false;
                            affected++;
                        }
                    }
                }
                
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Deleted graduating class: ' + name + ' (' + affected + ' characters affected)');
                }
                
                return { success: true, data: { deleted: true, affectedCharacters: affected } };
            };
            
            window.getCharactersByGraduatingClass = function(classId) {
                var data = window.data || {};
                var chars = data.characters || [];
                var result = [];
                for (var i = 0; i < chars.length; i++) {
                    var char = chars[i];
                    if (char && String(char.graduatingClassId) === String(classId) && !char.graduatingClassInstructor) {
                        result.push(JSON.parse(JSON.stringify(char)));
                    }
                }
                return result;
            };
            
            window.getInstructorsByGraduatingClass = function(classId) {
                var data = window.data || {};
                var chars = data.characters || [];
                var result = [];
                for (var i = 0; i < chars.length; i++) {
                    var char = chars[i];
                    if (char && String(char.graduatingClassId) === String(classId) && char.graduatingClassInstructor) {
                        result.push(JSON.parse(JSON.stringify(char)));
                    }
                }
                return result;
            };
            
            window.getGraduatingClassMembers = function(classId, includeInstructors) {
                var data = window.data || {};
                var chars = data.characters || [];
                var result = [];
                for (var i = 0; i < chars.length; i++) {
                    var char = chars[i];
                    if (char && String(char.graduatingClassId) === String(classId)) {
                        if (includeInstructors !== undefined) {
                            if (char.graduatingClassInstructor !== includeInstructors) {
                                continue;
                            }
                        }
                        result.push(JSON.parse(JSON.stringify(char)));
                    }
                }
                return result;
            };
            
            window.assignCharacterToGraduatingClass = function(charId, classId, isInstructor) {
                var data = window.data || {};
                var chars = data.characters || [];
                var charIndex = -1;
                for (var i = 0; i < chars.length; i++) {
                    if (String(chars[i].id) === String(charId)) {
                        charIndex = i;
                        break;
                    }
                }
                
                if (charIndex === -1) {
                    return { success: false, message: 'Character not found.' };
                }
                
                var cls = window.getGraduatingClass(classId);
                if (!cls) {
                    return { success: false, message: 'Graduating class not found.' };
                }
                
                chars[charIndex].graduatingClassId = classId;
                chars[charIndex].graduatingClassInstructor = isInstructor === true;
                
                var roleText = isInstructor ? 'instructor' : 'trainee';
                var charName = typeof window.getDisplayName === 'function' ? 
                    window.getDisplayName(chars[charIndex]) : chars[charIndex].name || 'Unknown';
                
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Assigned ' + charName + ' to graduating class "' + cls.name + '" as ' + roleText);
                }
                
                return { success: true, data: { character: chars[charIndex] } };
            };
            
            window.removeCharacterFromGraduatingClass = function(charId) {
                var data = window.data || {};
                var chars = data.characters || [];
                var charIndex = -1;
                for (var i = 0; i < chars.length; i++) {
                    if (String(chars[i].id) === String(charId)) {
                        charIndex = i;
                        break;
                    }
                }
                
                if (charIndex === -1) {
                    return { success: false, message: 'Character not found.' };
                }
                
                if (!chars[charIndex].graduatingClassId) {
                    return { success: false, message: 'Character is not assigned to any graduating class.' };
                }
                
                var charName = typeof window.getDisplayName === 'function' ? 
                    window.getDisplayName(chars[charIndex]) : chars[charIndex].name || 'Unknown';
                
                chars[charIndex].graduatingClassId = null;
                chars[charIndex].graduatingClassInstructor = false;
                
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Removed ' + charName + ' from graduating class');
                }
                
                return { success: true, data: { character: chars[charIndex] } };
            };
            
            console.log('[Classes] Fallback graduating class functions created.');
        } else {
            console.log('[Classes] Graduating class core already loaded.');
        }
    })();

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

    function getMissingDependencies() {
        var missing = [];
        var deps = [
            'getGraduatingClasses', 'getGraduatingClass', 'createGraduatingClass',
            'updateGraduatingClass', 'deleteGraduatingClass',
            'getCharactersByGraduatingClass', 'getInstructorsByGraduatingClass',
            'assignCharacterToGraduatingClass', 'removeCharacterFromGraduatingClass'
        ];
        for (var i = 0; i < deps.length; i++) {
            if (typeof window[deps[i]] !== 'function') {
                missing.push(deps[i]);
            }
        }
        return missing;
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

        // Ensure characters have graduating class fields
        ensureCharacterFields();

        if (!checkDependencies()) {
            var missing = getMissingDependencies();
            container.innerHTML = '<p class="empty-state">Classes dependencies not loaded. Please refresh the page.<br><small style="color:var(--text-dim);">Missing: ' + 
                missing.join(', ') + '</small></p>';
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

    function ensureCharacterFields() {
        var data = window.data || {};
        if (data.characters) {
            var changed = false;
            for (var i = 0; i < data.characters.length; i++) {
                var char = data.characters[i];
                if (char.graduatingClassId === undefined) {
                    char.graduatingClassId = null;
                    changed = true;
                }
                if (char.graduatingClassInstructor === undefined) {
                    char.graduatingClassInstructor = false;
                    changed = true;
                }
            }
            if (changed && typeof window.saveData === 'function') {
                // Save after ensuring fields exist
                window.saveData().catch(function() {
                    console.warn('[Classes] Failed to save after ensuring character fields.');
                });
            }
        }
        if (!data.graduatingClasses) {
            data.graduatingClasses = [];
        }
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
                renderer: renderRankingsPlaceholder,
                fallback: 'Rankings module not loaded.'
            },
            'groups': {
                contentId: 'groups-content',
                renderer: renderGroupsPlaceholder,
                fallback: 'Groups module not loaded.'
            },
            'tournaments': {
                contentId: 'tournaments-content',
                renderer: renderTournamentsPlaceholder,
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
    // PLACEHOLDER RENDERERS
    // ============================================================

    function renderRankingsPlaceholder(container) {
        if (!container) return;
        
        container.innerHTML = `
            <div class="page-header">
                <h2>Class Rankings</h2>
            </div>
            <div class="ranking-controls" style="margin-bottom:12px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:0.75rem;color:var(--text-dim);">Class:</label>
                    <select id="rankings-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Classes</option>
                    </select>
                    <label style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Week:</label>
                    <select id="rankings-week-select" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        ${getWeekOptions()}
                    </select>
                    <button id="auto-rank-btn" class="primary small">Generate Rankings</button>
                </div>
            </div>
            <div id="rankings-container">
                <p class="empty-state">Select a class to view rankings.</p>
            </div>
        `;

        populateClassFilter('rankings-class-filter');
        
        var classFilter = document.getElementById('rankings-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                renderRankingsTable();
            });
        }

        var weekSelect = document.getElementById('rankings-week-select');
        if (weekSelect) {
            weekSelect.addEventListener('change', function() {
                renderRankingsTable();
            });
        }

        var autoBtn = document.getElementById('auto-rank-btn');
        if (autoBtn) {
            autoBtn.addEventListener('click', function() {
                showNotification('Auto-rank functionality coming soon.', 'info');
            });
        }

        renderRankingsTable();
    }

    function renderRankingsTable() {
        var container = document.getElementById('rankings-container');
        if (!container) return;
        container.innerHTML = '<p class="empty-state">Rankings module coming soon. Select a class to view rankings.</p>';
    }

    function renderGroupsPlaceholder(container) {
        if (!container) return;

        container.innerHTML = `
            <div class="page-header">
                <h2>Auto-Groups</h2>
                <div style="display:flex;gap:4px;">
                    <button id="rebuild-groups-btn" class="primary small">Rebuild Groups</button>
                    <button id="refresh-groups-btn" class="secondary small">Refresh</button>
                </div>
            </div>
            <div class="groups-controls" style="margin-bottom:12px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:0.75rem;color:var(--text-dim);">Class:</label>
                    <select id="groups-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Classes</option>
                    </select>
                    <label style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Discipline:</label>
                    <select id="groups-discipline-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Disciplines</option>
                    </select>
                </div>
            </div>
            <div id="groups-container">
                <p class="empty-state">No auto-groups found. Groups are auto-created when students share the same discipline, instructor, and time slot.</p>
            </div>
        `;

        populateClassFilter('groups-class-filter');
        populateDisciplineFilter();

        var classFilter = document.getElementById('groups-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                renderGroupsList();
            });
        }

        var disciplineFilter = document.getElementById('groups-discipline-filter');
        if (disciplineFilter) {
            disciplineFilter.addEventListener('change', function() {
                renderGroupsList();
            });
        }

        var rebuildBtn = document.getElementById('rebuild-groups-btn');
        if (rebuildBtn) {
            rebuildBtn.addEventListener('click', function() {
                showNotification('Rebuild groups functionality coming soon.', 'info');
            });
        }

        var refreshBtn = document.getElementById('refresh-groups-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                renderGroupsList();
            });
        }

        renderGroupsList();
    }

    function renderGroupsList() {
        var container = document.getElementById('groups-container');
        if (!container) return;
        container.innerHTML = '<p class="empty-state">Groups module coming soon. Groups will auto-generate based on discipline, instructor, and time slot combinations.</p>';
    }

    function renderTournamentsPlaceholder(container) {
        if (!container) return;

        container.innerHTML = `
            <div class="page-header">
                <h2>Tournaments</h2>
                <button id="create-tournament-btn" class="primary">+ New Tournament</button>
            </div>
            <div class="tournaments-controls" style="margin-bottom:12px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:0.75rem;color:var(--text-dim);">Class:</label>
                    <select id="tournaments-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Classes</option>
                    </select>
                </div>
            </div>
            <div id="tournaments-container">
                <p class="empty-state">No tournaments created yet. Create your first tournament!</p>
            </div>
        `;

        populateClassFilter('tournaments-class-filter');

        var classFilter = document.getElementById('tournaments-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                renderTournamentsList();
            });
        }

        var createBtn = document.getElementById('create-tournament-btn');
        if (createBtn) {
            createBtn.addEventListener('click', function() {
                showNotification('Tournament creation coming soon.', 'info');
            });
        }

        renderTournamentsList();
    }

    function renderTournamentsList() {
        var container = document.getElementById('tournaments-container');
        if (!container) return;
        container.innerHTML = '<p class="empty-state">Tournaments module coming soon. Create tournaments for specific graduating classes.</p>';
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getWeekOptions() {
        var html = '';
        var currentWeek = window.data?.currentWeek || 1;
        for (var w = 1; w <= 52; w++) {
            html += '<option value="' + w + '"' + (w === currentWeek ? ' selected' : '') + '>Week ' + w + '</option>';
        }
        return html;
    }

    function populateClassFilter(selectId) {
        var select = document.getElementById(selectId);
        if (!select) return;

        var classes = window.getGraduatingClasses ? window.getGraduatingClasses() : [];
        select.innerHTML = '<option value="all">All Classes</option>';
        
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        }
    }

    function populateDisciplineFilter() {
        var select = document.getElementById('groups-discipline-filter');
        if (!select) return;

        var disciplines = window.getDisciplines ? window.getDisciplines() : [];
        select.innerHTML = '<option value="all">All Disciplines</option>';
        
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var option = document.createElement('option');
            option.value = d.id;
            option.textContent = d.name;
            select.appendChild(option);
        }
    }

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
            console.log('[Classes]', message);
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
