/**
 * js/modules/social.js - Social Network Manager
 * Manages relationships between characters with types, dates, and notes
 * Includes SVG visualization of the social network
 * Path: js/modules/social.js
 */

(function() {
    'use strict';

    var state = {
        selectedCharacterId: null,
        viewMode: 'list',
        zoomLevel: 1,
        panX: 0,
        panY: 0,
        expandedGroups: {}
    };

    function renderSocialView(container) {
        if (!container) {
            container = document.getElementById('tab-social');
        }
        if (!container) return;

        // Check if data exists
        if (!window.data) {
            console.warn('No data available for social, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading social data...</p>';
            return;
        }

        // Ensure social structure exists
        if (!window.data.social) {
            window.data.social = {
                relationships: [],
                relationshipTypes: [
                    { id: 'familiar', label: 'Familiar', color: '#8cbb3a' },
                    { id: 'professional', label: 'Professional', color: '#c9a24b' },
                    { id: 'romantic', label: 'Romantic', color: '#c1453c' },
                    { id: 'friendship', label: 'Friendship', color: '#4a9bc7' },
                    { id: 'mentor', label: 'Mentor/Mentee', color: '#9b59b6' },
                    { id: 'rivalry', label: 'Rivalry', color: '#e67e22' },
                    { id: 'alliance', label: 'Alliance', color: '#27ae60' },
                    { id: 'other', label: 'Other', color: '#7f8c8d' }
                ],
                nextId: 1
            };
        }
        if (!window.data.social.relationships) {
            window.data.social.relationships = [];
        }
        if (!window.data.social.nextId) {
            window.data.social.nextId = 1;
        }

        container.innerHTML = getSocialHTML();

        populateSocialSelectors();
        renderRelationships();
        initSocialEvents();
    }

    function getSocialHTML() {
        return `
            <div class="page-header">
                <h2>Social Network</h2>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="add-relationship-btn" class="primary">+ Add Relationship</button>
                    <button id="view-graph-btn" class="secondary">◊ View Network</button>
                    <button id="view-list-btn" class="secondary">☰ View List</button>
                </div>
            </div>
            <div id="social-content">
                <div id="social-list-view">
                    <div class="filter-section">
                        <label for="social-character-filter">Character:</label>
                        <select id="social-character-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;min-width:150px;">
                            <option value="all">All Characters</option>
                        </select>
                        <label for="social-type-filter" style="margin-left:8px;">Type:</label>
                        <select id="social-type-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                            <option value="all">All Types</option>
                        </select>
                        <button id="clear-social-filters" class="small secondary">✕ Clear</button>
                        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Relationships: <span id="relationship-count">0</span></span>
                    </div>
                    <div id="relationships-container">
                        <p class="empty-state">No relationships created yet. Add your first relationship!</p>
                    </div>
                </div>
                <div id="social-graph-view" style="display:none;">
                    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                        <span style="font-size:0.75rem;color:var(--text-dim);">Zoom: <span id="zoom-display">100%</span></span>
                        <button id="zoom-in-btn" class="small secondary">+</button>
                        <button id="zoom-out-btn" class="small secondary">-</button>
                        <button id="reset-zoom-btn" class="small secondary">⟲</button>
                        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Click a node to view character details</span>
                    </div>
                    <div id="graph-container" style="width:100%;height:600px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;position:relative;cursor:grab;">
                        <svg id="social-svg" width="100%" height="100%" style="display:block;background:var(--bg);"></svg>
                    </div>
                    <div id="graph-legend" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;padding:8px;background:var(--panel-alt);border-radius:var(--radius);border:1px solid var(--border);">
                        <span style="font-size:0.7rem;color:var(--text-dim);font-weight:600;">Legend:</span>
                        <span id="legend-items"></span>
                    </div>
                </div>
            </div>

            <!-- Relationship Form Modal -->
            <div id="relationship-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h3 id="relationship-form-title">Add Relationship</h3>
                        <button class="close-modal" id="close-relationship-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="relationship-form-inner">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label>Character 1 *</label>
                                    <select id="rel-char1" required style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                        <option value="">Select character...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Character 2 *</label>
                                    <select id="rel-char2" required style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                        <option value="">Select character...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Relationship Type *</label>
                                    <select id="rel-type" required style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                        <option value="">Select type...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Clarification (e.g., aunt, sibling, boss)</label>
                                    <input type="text" id="rel-clarification" placeholder="e.g., aunt, sibling, boss" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                </div>
                                <div class="form-group">
                                    <label>Start Year</label>
                                    <input type="number" id="rel-start-year" placeholder="e.g., 1920" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                </div>
                                <div class="form-group">
                                    <label>End Year (optional)</label>
                                    <input type="number" id="rel-end-year" placeholder="e.g., 1930" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                </div>
                                <div class="form-group full-width">
                                    <label>Notes</label>
                                    <textarea id="rel-notes" rows="3" placeholder="Additional notes about this relationship..." style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;resize:vertical;"></textarea>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-relationship-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-relationship-btn" class="primary">Save Relationship</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Character Detail Modal -->
            <div id="character-detail-modal" class="modal hidden">
                <div class="modal-content" style="max-width:500px;">
                    <div class="modal-header">
                        <h3 id="detail-char-name">Character</h3>
                        <button class="close-modal" id="close-char-detail">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="char-detail-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function populateSocialSelectors() {
        var filterSelect = document.getElementById('social-character-filter');
        if (filterSelect) {
            var data = window.data || {};
            var chars = data.characters || [];
            var currentValue = filterSelect.value;
            filterSelect.innerHTML = '<option value="all">All Characters</option>';
            chars.sort(function(a, b) {
                var nameA = window.getDisplayName(a).toLowerCase();
                var nameB = window.getDisplayName(b).toLowerCase();
                return nameA.localeCompare(nameB);
            });
            chars.forEach(function(c) {
                var name = window.getDisplayName(c);
                var option = document.createElement('option');
                option.value = c.id;
                option.textContent = name;
                filterSelect.appendChild(option);
            });
            if (currentValue) filterSelect.value = currentValue;
        }

        var typeFilter = document.getElementById('social-type-filter');
        if (typeFilter) {
            var types = getRelationshipTypes();
            var currentValue = typeFilter.value;
            typeFilter.innerHTML = '<option value="all">All Types</option>';
            types.forEach(function(t) {
                var option = document.createElement('option');
                option.value = t.id;
                option.textContent = t.label;
                typeFilter.appendChild(option);
            });
            if (currentValue) typeFilter.value = currentValue;
        }

        populateFormSelectors();
        populateTypeSelectors();
    }

    function populateFormSelectors() {
        var select1 = document.getElementById('rel-char1');
        var select2 = document.getElementById('rel-char2');
        if (!select1 || !select2) return;

        var data = window.data || {};
        var chars = data.characters || [];
        var current1 = select1.value;
        var current2 = select2.value;

        select1.innerHTML = '<option value="">Select character...</option>';
        select2.innerHTML = '<option value="">Select character...</option>';

        chars.sort(function(a, b) {
            var nameA = window.getDisplayName(a).toLowerCase();
            var nameB = window.getDisplayName(b).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        chars.forEach(function(c) {
            var name = window.getDisplayName(c);
            var option1 = document.createElement('option');
            option1.value = c.id;
            option1.textContent = name;
            select1.appendChild(option1);

            var option2 = document.createElement('option');
            option2.value = c.id;
            option2.textContent = name;
            select2.appendChild(option2);
        });

        if (current1) select1.value = current1;
        if (current2) select2.value = current2;
    }

    function populateTypeSelectors() {
        var typeSelect = document.getElementById('rel-type');
        if (!typeSelect) return;

        var types = getRelationshipTypes();
        var currentValue = typeSelect.value;
        typeSelect.innerHTML = '<option value="">Select type...</option>';
        types.forEach(function(t) {
            var option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.label;
            typeSelect.appendChild(option);
        });
        if (currentValue) typeSelect.value = currentValue;
    }

    function getRelationshipTypes() {
        var data = window.data || {};
        if (!data.social || !data.social.relationshipTypes) {
            return [
                { id: 'familiar', label: 'Familiar', color: '#8cbb3a' },
                { id: 'professional', label: 'Professional', color: '#c9a24b' },
                { id: 'romantic', label: 'Romantic', color: '#c1453c' },
                { id: 'friendship', label: 'Friendship', color: '#4a9bc7' },
                { id: 'mentor', label: 'Mentor/Mentee', color: '#9b59b6' },
                { id: 'rivalry', label: 'Rivalry', color: '#e67e22' },
                { id: 'alliance', label: 'Alliance', color: '#27ae60' },
                { id: 'other', label: 'Other', color: '#7f8c8d' }
            ];
        }
        return data.social.relationshipTypes;
    }

    function getRelationshipTypeLabel(typeId) {
        var types = getRelationshipTypes();
        var type = types.find(function(t) { return t.id === typeId; });
        return type ? type.label : typeId || 'Other';
    }

    function getRelationshipTypeColor(typeId) {
        var types = getRelationshipTypes();
        var type = types.find(function(t) { return t.id === typeId; });
        return type ? type.color : '#7f8c8d';
    }

    function getCharacterRelationships(charId) {
        var data = window.data || {};
        if (!data.social || !data.social.relationships) return [];
        return data.social.relationships.filter(function(r) {
            return String(r.character1) === String(charId) || String(r.character2) === String(charId);
        });
    }

    function createRelationship(charId1, charId2, typeId, startYear, endYear, clarification, notes) {
        var data = window.data || {};
        if (!data.social) {
            data.social = {
                relationships: [],
                relationshipTypes: getRelationshipTypes(),
                nextId: 1
            };
        }
        if (!data.social.relationships) data.social.relationships = [];
        if (!data.social.nextId) data.social.nextId = 1;

        // Check for existing relationship
        var existing = data.social.relationships.find(function(r) {
            return (String(r.character1) === String(charId1) && String(r.character2) === String(charId2)) ||
                   (String(r.character1) === String(charId2) && String(r.character2) === String(charId1));
        });

        if (existing) {
            return { success: false, message: 'Relationship already exists between these characters.' };
        }

        var relationship = {
            id: data.social.nextId++,
            character1: charId1,
            character2: charId2,
            typeId: typeId || 'other',
            startYear: startYear || '',
            endYear: endYear || '',
            clarification: clarification || '',
            notes: notes || '',
            createdAt: new Date().toISOString()
        };

        data.social.relationships.push(relationship);

        if (typeof window.logActivity === 'function') {
            var char1 = window.getCharacterById(charId1);
            var char2 = window.getCharacterById(charId2);
            var name1 = char1 ? window.getDisplayName(char1) : 'Unknown';
            var name2 = char2 ? window.getDisplayName(char2) : 'Unknown';
            var typeLabel = getRelationshipTypeLabel(typeId);
            window.logActivity('Created ' + typeLabel + ' relationship between ' + name1 + ' and ' + name2);
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return { success: true, relationship: relationship };
    }

    function updateRelationship(id, updates) {
        var data = window.data || {};
        if (!data.social || !data.social.relationships) return null;
        var rel = data.social.relationships.find(function(r) { return String(r.id) === String(id); });
        if (!rel) return null;

        Object.assign(rel, updates);

        if (typeof window.logActivity === 'function') {
            var char1 = window.getCharacterById(rel.character1);
            var char2 = window.getCharacterById(rel.character2);
            var name1 = char1 ? window.getDisplayName(char1) : 'Unknown';
            var name2 = char2 ? window.getDisplayName(char2) : 'Unknown';
            window.logActivity('Updated relationship between ' + name1 + ' and ' + name2);
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return rel;
    }

    function deleteRelationship(id) {
        var data = window.data || {};
        if (!data.social || !data.social.relationships) return false;
        var rel = data.social.relationships.find(function(r) { return String(r.id) === String(id); });
        if (!rel) return false;

        data.social.relationships = data.social.relationships.filter(function(r) { return String(r.id) !== String(id); });

        if (typeof window.logActivity === 'function') {
            var char1 = window.getCharacterById(rel.character1);
            var char2 = window.getCharacterById(rel.character2);
            var name1 = char1 ? window.getDisplayName(char1) : 'Unknown';
            var name2 = char2 ? window.getDisplayName(char2) : 'Unknown';
            window.logActivity('Deleted relationship between ' + name1 + ' and ' + name2);
        }

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }
        return true;
    }

    function getConnectedCharacters(charId) {
        var rels = getCharacterRelationships(charId);
        var connected = [];
        rels.forEach(function(r) {
            var otherId = String(r.character1) === String(charId) ? r.character2 : r.character1;
            var char = window.getCharacterById(otherId);
            if (char) {
                connected.push({
                    character: char,
                    relationship: r
                });
            }
        });
        return connected;
    }

    function renderRelationships() {
        var container = document.getElementById('relationships-container');
        var count = document.getElementById('relationship-count');
        if (!container) return;

        var charFilter = document.getElementById('social-character-filter') ? document.getElementById('social-character-filter').value : 'all';
        var typeFilter = document.getElementById('social-type-filter') ? document.getElementById('social-type-filter').value : 'all';

        var data = window.data || {};
        var relationships = data.social && data.social.relationships ? data.social.relationships.slice() : [];

        if (charFilter !== 'all') {
            relationships = relationships.filter(function(r) {
                return String(r.character1) === String(charFilter) || String(r.character2) === String(charFilter);
            });
        }
        if (typeFilter !== 'all') {
            relationships = relationships.filter(function(r) { return r.typeId === typeFilter; });
        }

        relationships.sort(function(a, b) {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        if (count) count.textContent = relationships.length;

        if (relationships.length === 0) {
            container.innerHTML = '<p class="empty-state">No relationships found. Add your first relationship!</p>';
            return;
        }

        var html = '';
        relationships.forEach(function(rel) {
            var char1 = window.getCharacterById(rel.character1);
            var char2 = window.getCharacterById(rel.character2);
            var name1 = char1 ? window.getDisplayName(char1) : 'Unknown';
            var name2 = char2 ? window.getDisplayName(char2) : 'Unknown';
            var typeLabel = getRelationshipTypeLabel(rel.typeId);
            var typeColor = getRelationshipTypeColor(rel.typeId);
            var period = '';
            if (rel.startYear && rel.endYear) {
                period = rel.startYear + ' - ' + rel.endYear;
            } else if (rel.startYear) {
                period = 'From ' + rel.startYear;
            }
            var clarificationDisplay = rel.clarification ? ' (' + rel.clarification + ')' : '';

            html += '<div class="list-item" style="grid-template-columns:1fr 1fr 0.8fr 1.2fr 1fr;border-left:3px solid ' + typeColor + ';" data-id="' + rel.id + '">';
            html += '<span><strong>' + name1 + '</strong></span>';
            html += '<span><strong>' + name2 + '</strong></span>';
            html += '<span style="color:' + typeColor + ';font-size:0.75rem;font-weight:600;">' + typeLabel + clarificationDisplay + '</span>';
            html += '<span style="font-size:0.75rem;color:var(--text-dim);">' + period + (rel.notes ? ' 📝' : '') + '</span>';
            html += '<span class="actions">' +
                '<button class="small edit-relationship" data-id="' + rel.id + '">Edit</button>' +
                '<button class="small danger delete-relationship" data-id="' + rel.id + '">Delete</button>' +
            '</span>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.edit-relationship').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                showRelationshipForm(this.dataset.id);
            });
        });
        container.querySelectorAll('.delete-relationship').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteRelationshipHandler(this.dataset.id);
            });
        });
    }

    function showRelationshipForm(editId, characterId) {
        var modal = document.getElementById('relationship-form-modal');
        var title = document.getElementById('relationship-form-title');
        var form = document.getElementById('relationship-form-inner');

        populateFormSelectors();
        populateTypeSelectors();

        modal.classList.remove('hidden');

        if (editId) {
            title.textContent = 'Edit Relationship';
            var data = window.data || {};
            var rel = data.social && data.social.relationships ? data.social.relationships.find(function(r) { return String(r.id) === String(editId); }) : null;
            if (rel) {
                document.getElementById('rel-char1').value = rel.character1 || '';
                document.getElementById('rel-char2').value = rel.character2 || '';
                document.getElementById('rel-type').value = rel.typeId || 'other';
                document.getElementById('rel-clarification').value = rel.clarification || '';
                document.getElementById('rel-start-year').value = rel.startYear || '';
                document.getElementById('rel-end-year').value = rel.endYear || '';
                document.getElementById('rel-notes').value = rel.notes || '';
                form.dataset.editId = editId;
            }
        } else {
            title.textContent = 'Add Relationship';
            form.reset();
            document.getElementById('rel-type').value = 'other';
            delete form.dataset.editId;
            
            // If characterId is provided, preselect it
            if (characterId) {
                var char1Select = document.getElementById('rel-char1');
                if (char1Select) {
                    char1Select.value = characterId;
                }
            }
        }
    }

    function saveRelationship(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var char1 = document.getElementById('rel-char1').value;
        var char2 = document.getElementById('rel-char2').value;
        var typeId = document.getElementById('rel-type').value;
        var clarification = document.getElementById('rel-clarification').value.trim();
        var startYear = document.getElementById('rel-start-year').value;
        var endYear = document.getElementById('rel-end-year').value;
        var notes = document.getElementById('rel-notes').value.trim();

        if (!char1 || !char2) {
            alert('Please select both characters.');
            return;
        }
        if (char1 === char2) {
            alert('Cannot create a relationship between the same character.');
            return;
        }
        if (!typeId) {
            alert('Please select a relationship type.');
            return;
        }

        if (editId) {
            var updated = updateRelationship(editId, {
                character1: char1,
                character2: char2,
                typeId: typeId,
                clarification: clarification,
                startYear: startYear,
                endYear: endYear,
                notes: notes
            });
            if (updated) {
                closeRelationshipForm();
                renderRelationships();
                if (document.getElementById('social-graph-view').style.display !== 'none') {
                    renderGraph();
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            }
        } else {
            var result = createRelationship(char1, char2, typeId, startYear, endYear, clarification, notes);
            if (result.success) {
                closeRelationshipForm();
                renderRelationships();
                if (document.getElementById('social-graph-view').style.display !== 'none') {
                    renderGraph();
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            } else {
                alert(result.message);
            }
        }
    }

    function closeRelationshipForm() {
        document.getElementById('relationship-form-modal').classList.add('hidden');
    }

    function deleteRelationshipHandler(id) {
        if (!confirm('Delete this relationship permanently?')) return;
        if (deleteRelationship(id)) {
            renderRelationships();
            if (document.getElementById('social-graph-view').style.display !== 'none') {
                renderGraph();
            }
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
        }
    }

    function renderGraph() {
        var svg = document.getElementById('social-svg');
        if (!svg) return;

        var container = document.getElementById('graph-container');
        var width = container.clientWidth || 800;
        var height = container.clientHeight || 600;

        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

        var data = window.data || {};
        var relationships = data.social && data.social.relationships ? data.social.relationships : [];

        if (relationships.length === 0) {
            svg.innerHTML = '<text x="' + (width/2) + '" y="' + (height/2) + '" text-anchor="middle" fill="var(--text-dim)" font-size="16">No relationships to display</text>';
            return;
        }

        var nodeMap = {};
        var nodes = [];
        relationships.forEach(function(r) {
            if (!nodeMap[r.character1]) {
                nodeMap[r.character1] = { id: r.character1, connections: 0 };
                nodes.push(nodeMap[r.character1]);
            }
            if (!nodeMap[r.character2]) {
                nodeMap[r.character2] = { id: r.character2, connections: 0 };
                nodes.push(nodeMap[r.character2]);
            }
            nodeMap[r.character1].connections++;
            nodeMap[r.character2].connections++;
        });

        if (nodes.length < 2) {
            svg.innerHTML = '<text x="' + (width/2) + '" y="' + (height/2) + '" text-anchor="middle" fill="var(--text-dim)" font-size="16">Need at least 2 characters with relationships</text>';
            return;
        }

        var positions = calculatePositions(nodes, relationships, width, height);

        var html = '';

        relationships.forEach(function(r) {
            var pos1 = positions[r.character1];
            var pos2 = positions[r.character2];
            if (!pos1 || !pos2) return;

            var color = getRelationshipTypeColor(r.typeId);
            var typeLabel = getRelationshipTypeLabel(r.typeId);
            var clarification = r.clarification ? ' (' + r.clarification + ')' : '';

            html += '<line x1="' + pos1.x + '" y1="' + pos1.y + '" x2="' + pos2.x + '" y2="' + pos2.y + '" ';
            html += 'stroke="' + color + '" stroke-width="2" opacity="0.6" />';

            var midX = (pos1.x + pos2.x) / 2;
            var midY = (pos1.y + pos2.y) / 2;
            html += '<text x="' + midX + '" y="' + (midY - 5) + '" text-anchor="middle" fill="' + color + '" font-size="9" opacity="0.7">' + typeLabel + clarification + '</text>';
        });

        nodes.forEach(function(node) {
            var pos = positions[node.id];
            if (!pos) return;

            var char = window.getCharacterById(node.id);
            var name = char ? window.getDisplayName(char) : 'Unknown';
            var status = char ? window.getCurrentStatus(char) : '';
            var radius = Math.max(20, Math.min(35, 20 + node.connections * 3));
            var color = getNodeColor(char);

            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + radius + '" fill="rgba(0,0,0,0.3)" opacity="0.3" />';
            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + radius + '" fill="' + color + '" stroke="var(--border)" stroke-width="2" cursor="pointer" class="graph-node" data-id="' + node.id + '" />';

            var fontSize = Math.max(9, Math.min(13, radius * 0.6));
            var displayName = name.length > 12 ? name.substring(0, 10) + '...' : name;
            html += '<text x="' + pos.x + '" y="' + (pos.y + 4) + '" text-anchor="middle" fill="var(--text)" font-size="' + fontSize + '" font-weight="600" pointer-events="none" class="graph-label">' + displayName + '</text>';

            if (status) {
                var statusColor = status === 'Deceased' ? 'var(--danger)' : 'var(--text-dim)';
                html += '<text x="' + pos.x + '" y="' + (pos.y + radius + 14) + '" text-anchor="middle" fill="' + statusColor + '" font-size="8" pointer-events="none">' + status + '</text>';
            }
        });

        svg.innerHTML = html;

        svg.querySelectorAll('.graph-node').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = this.dataset.id;
                showCharacterDetail(id);
            });
        });

        updateLegend();
    }

    function calculatePositions(nodes, relationships, width, height) {
        var positions = {};
        var padding = 80;
        var centerX = width / 2;
        var centerY = height / 2;
        var radius = Math.min(width, height) * 0.35;

        if (nodes.length === 2) {
            positions[nodes[0].id] = { x: centerX - radius * 0.6, y: centerY };
            positions[nodes[1].id] = { x: centerX + radius * 0.6, y: centerY };
            return positions;
        }

        var angleStep = (2 * Math.PI) / nodes.length;
        nodes.forEach(function(node, index) {
            var angle = angleStep * index - Math.PI / 2;
            var dist = radius * (0.6 + 0.4 * (1 - node.connections / (nodes.length + 5)));
            positions[node.id] = {
                x: centerX + dist * Math.cos(angle),
                y: centerY + dist * Math.sin(angle)
            };
        });

        var iterations = 50;
        var k = 0.1;
        var repulsionForce = 0.05;
        var attractionForce = 0.01;

        for (var iter = 0; iter < iterations; iter++) {
            var forces = {};
            nodes.forEach(function(n) { forces[n.id] = { x: 0, y: 0 }; });

            for (var i = 0; i < nodes.length; i++) {
                for (var j = i + 1; j < nodes.length; j++) {
                    var n1 = nodes[i];
                    var n2 = nodes[j];
                    var p1 = positions[n1.id];
                    var p2 = positions[n2.id];
                    var dx = p1.x - p2.x;
                    var dy = p1.y - p2.y;
                    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    var force = repulsionForce * k / (dist + 1);
                    forces[n1.id].x += force * dx / dist;
                    forces[n1.id].y += force * dy / dist;
                    forces[n2.id].x -= force * dx / dist;
                    forces[n2.id].y -= force * dy / dist;
                }
            }

            relationships.forEach(function(r) {
                var p1 = positions[r.character1];
                var p2 = positions[r.character2];
                if (!p1 || !p2) return;
                var dx = p1.x - p2.x;
                var dy = p1.y - p2.y;
                var dist = Math.sqrt(dx * dx + dy * dy) || 1;
                var force = attractionForce * k * dist;
                forces[r.character1].x -= force * dx / dist;
                forces[r.character1].y -= force * dy / dist;
                forces[r.character2].x += force * dx / dist;
                forces[r.character2].y += force * dy / dist;
            });

            nodes.forEach(function(n) {
                positions[n.id].x += forces[n.id].x * 0.9;
                positions[n.id].y += forces[n.id].y * 0.9;
                positions[n.id].x = Math.max(padding, Math.min(width - padding, positions[n.id].x));
                positions[n.id].y = Math.max(padding, Math.min(height - padding, positions[n.id].y));
            });
        }

        return positions;
    }

    function getNodeColor(char) {
        if (!char) return '#7f8c8d';
        if (char.deceased) return '#666666';

        var status = window.getCurrentStatus(char).toLowerCase();
        var colorMap = {
            'instructor': '#9b59b6',
            'senior': '#c9a24b',
            'junior': '#4a9bc7',
            'rookie': '#27ae60',
            'trainee': '#8cbb3a',
            'support': '#e67e22',
            'civilian': '#7f8c8d'
        };
        return colorMap[status] || '#7f8c8d';
    }

    function updateLegend() {
        var container = document.getElementById('legend-items');
        if (!container) return;

        var types = getRelationshipTypes();
        var html = '';
        types.forEach(function(t) {
            html += '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:0.7rem;">';
            html += '<span style="display:inline-block;width:12px;height:4px;background:' + t.color + ';border-radius:2px;"></span>';
            html += t.label;
            html += '</span>';
        });
        container.innerHTML = html;
    }

    function showCharacterDetail(charId) {
        var char = window.getCharacterById(charId);
        if (!char) return;

        var modal = document.getElementById('character-detail-modal');
        var content = document.getElementById('char-detail-content');
        var title = document.getElementById('detail-char-name');

        var name = window.getDisplayName(char);
        title.textContent = name;

        var status = window.getCurrentStatus(char);
        var age = window.getCharacterAge(char);
        var connections = getConnectedCharacters(charId);

        var html = '<div style="margin-bottom:12px;">';
        html += '<div class="detail-row"><span class="label">Status:</span> <span>' + status + '</span></div>';
        html += '<div class="detail-row"><span class="label">Age:</span> <span>' + age + '</span></div>';
        if (char.deceased) {
            html += '<div class="detail-row"><span class="label">Deceased:</span> <span style="color:var(--danger);">Yes</span></div>';
        }
        html += '</div>';

        if (connections.length > 0) {
            html += '<h4 style="color:var(--accent);font-size:0.9rem;margin-bottom:8px;">Connections (' + connections.length + ')</h4>';
            html += '<div style="display:flex;flex-direction:column;gap:4px;">';
            connections.forEach(function(conn) {
                var rel = conn.relationship;
                var typeLabel = getRelationshipTypeLabel(rel.typeId);
                var typeColor = getRelationshipTypeColor(rel.typeId);
                var charName = window.getDisplayName(conn.character);
                var period = '';
                if (rel.startYear && rel.endYear) {
                    period = rel.startYear + ' - ' + rel.endYear;
                } else if (rel.startYear) {
                    period = 'From ' + rel.startYear;
                }
                var clarification = rel.clarification ? ' (' + rel.clarification + ')' : '';
                var notes = rel.notes ? ' 📝' : '';

                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + typeColor + ';">';
                html += '<span style="font-size:0.8rem;"><strong>' + charName + '</strong> <span style="color:' + typeColor + ';font-size:0.7rem;">' + typeLabel + clarification + '</span></span>';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">' + period + notes + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No connections</p>';
        }

        html += '<div style="margin-top:12px;">';
        html += '<button id="view-char-relationships" class="small primary" data-id="' + charId + '">View All Relationships</button>';
        html += '</div>';

        content.innerHTML = html;
        modal.classList.remove('hidden');

        content.querySelector('#view-char-relationships') ? content.querySelector('#view-char-relationships').addEventListener('click', function() {
            var id = this.dataset.id;
            closeCharacterDetail();
            document.getElementById('social-character-filter').value = id;
            renderRelationships();
        }) : null;
    }

    function closeCharacterDetail() {
        document.getElementById('character-detail-modal').classList.add('hidden');
    }

    function setViewMode(mode) {
        state.viewMode = mode;
        var listView = document.getElementById('social-list-view');
        var graphView = document.getElementById('social-graph-view');

        if (mode === 'list') {
            listView.style.display = 'block';
            graphView.style.display = 'none';
        } else {
            listView.style.display = 'none';
            graphView.style.display = 'block';
            setTimeout(renderGraph, 100);
        }
    }

    function applyZoom() {
        var display = document.getElementById('zoom-display');
        if (display) display.textContent = Math.round(state.zoomLevel * 100) + '%';

        var svg = document.getElementById('social-svg');
        if (!svg) return;

        var container = document.getElementById('graph-container');
        var width = container.clientWidth || 800;
        var height = container.clientHeight || 600;

        var transform = 'scale(' + state.zoomLevel + ')';
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        svg.style.transform = transform;
        svg.style.transformOrigin = 'center center';
    }

    function initSocialEvents() {
        var addBtn = document.getElementById('add-relationship-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() { showRelationshipForm(); });
        }

        var graphBtn = document.getElementById('view-graph-btn');
        if (graphBtn) {
            graphBtn.addEventListener('click', function() { setViewMode('graph'); });
        }
        var listBtn = document.getElementById('view-list-btn');
        if (listBtn) {
            listBtn.addEventListener('click', function() { setViewMode('list'); });
        }

        var closeFormBtn = document.getElementById('close-relationship-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', closeRelationshipForm);
        }
        var cancelFormBtn = document.getElementById('cancel-relationship-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', closeRelationshipForm);
        }
        var formModal = document.getElementById('relationship-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) closeRelationshipForm();
            });
        }

        var form = document.getElementById('relationship-form-inner');
        if (form) {
            form.addEventListener('submit', saveRelationship);
        }

        var charFilter = document.getElementById('social-character-filter');
        if (charFilter) {
            charFilter.addEventListener('change', renderRelationships);
        }
        var typeFilter = document.getElementById('social-type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', renderRelationships);
        }
        var clearFilters = document.getElementById('clear-social-filters');
        if (clearFilters) {
            clearFilters.addEventListener('click', function() {
                document.getElementById('social-character-filter').value = 'all';
                document.getElementById('social-type-filter').value = 'all';
                renderRelationships();
            });
        }

        var zoomInBtn = document.getElementById('zoom-in-btn');
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', function() {
                state.zoomLevel = Math.min(2, state.zoomLevel + 0.1);
                applyZoom();
            });
        }
        var zoomOutBtn = document.getElementById('zoom-out-btn');
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', function() {
                state.zoomLevel = Math.max(0.5, state.zoomLevel - 0.1);
                applyZoom();
            });
        }
        var resetZoomBtn = document.getElementById('reset-zoom-btn');
        if (resetZoomBtn) {
            resetZoomBtn.addEventListener('click', function() {
                state.zoomLevel = 1;
                state.panX = 0;
                state.panY = 0;
                applyZoom();
            });
        }

        var closeDetailBtn = document.getElementById('close-char-detail');
        if (closeDetailBtn) {
            closeDetailBtn.addEventListener('click', closeCharacterDetail);
        }
        var detailModal = document.getElementById('character-detail-modal');
        if (detailModal) {
            detailModal.addEventListener('click', function(e) {
                if (e.target === this) closeCharacterDetail();
            });
        }

        window.addEventListener('resize', function() {
            if (state.viewMode === 'graph') {
                setTimeout(renderGraph, 200);
            }
        });
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('social', renderSocialView);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-social');
        if (container && container.style.display !== 'none') {
            renderSocialView(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'social') {
            var container = document.getElementById('tab-social');
            if (container) {
                renderSocialView(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-social');
            if (container && container.style.display !== 'none') {
                renderSocialView(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderSocialView = renderSocialView;
    window.populateSocialSelectors = populateSocialSelectors;
    window.populateFormSelectors = populateFormSelectors;
    window.populateTypeSelectors = populateTypeSelectors;
    window.getRelationshipTypes = getRelationshipTypes;
    window.getRelationshipTypeLabel = getRelationshipTypeLabel;
    window.getRelationshipTypeColor = getRelationshipTypeColor;
    window.getCharacterRelationships = getCharacterRelationships;
    window.getConnectedCharacters = getConnectedCharacters;
    window.createRelationship = createRelationship;
    window.updateRelationship = updateRelationship;
    window.deleteRelationship = deleteRelationship;
    window.renderRelationships = renderRelationships;
    window.renderGraph = renderGraph;
    window.showCharacterDetail = showCharacterDetail;
    window.closeCharacterDetail = closeCharacterDetail;
    window.setViewMode = setViewMode;
    window.showRelationshipForm = showRelationshipForm;
    window.saveRelationship = saveRelationship;
    window.closeRelationshipForm = closeRelationshipForm;
    window.deleteRelationshipHandler = deleteRelationshipHandler;
    window.initSocialEvents = initSocialEvents;
    window.socialState = state;

    console.log('social.js loaded');

})();
