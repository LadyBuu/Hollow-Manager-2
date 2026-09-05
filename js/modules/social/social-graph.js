/**
 * modules/social/social-graph.js - Social Graph Visualization
 * SVG-based social network graph rendering
 * Path: js/modules/social/social-graph.js
 * 
 * This module provides:
 *   - renderGraph - Main graph render entry
 *   - calculatePositions - Node positioning algorithm
 *   - getGraphLabel - Smart label shortening
 *   - applyGraphTransform - Zoom/pan transform
 *   - getNodeColor - Character color coding
 *   - updateLegend - Relationship type legend
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - No direct window.data access - uses SocialQueries
 *   - Uses SocialConstants for type definitions
 *   - Uses CharacterQueries for character data
 *   - Graph is rendered as SVG
 *   - Click events are delegated to SocialEvents
 *   - Zoom state is managed locally
 * 
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var SG = window.SocialGraph;
 *   SG.renderGraph();
 *   SG.setZoomLevel(1.5);
 *   SG.zoomIn();
 *   SG.zoomOut();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__socialGraphLoaded) {
        return;
    }
    window.__socialGraphLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialQueries = window.SocialQueries;
    var SocialConstants = window.SocialConstants;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SocialQueries || typeof SocialQueries.getAllRelationships !== 'function') {
            missing.push('SocialQueries.getAllRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.getRelationshipTypeColor !== 'function') {
            missing.push('SocialQueries.getRelationshipTypeColor');
        }
        if (!SocialQueries || typeof SocialQueries.getRelationshipTypeLabel !== 'function') {
            missing.push('SocialQueries.getRelationshipTypeLabel');
        }
        if (!SocialQueries || typeof SocialQueries.isRelationshipDirectional !== 'function') {
            missing.push('SocialQueries.isRelationshipDirectional');
        }

        if (!SocialConstants || typeof SocialConstants.getRelationshipTypes !== 'function') {
            missing.push('SocialConstants.getRelationshipTypes');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('[SocialGraph] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // STATE
    // ============================================================

    var _zoomLevel = 1;
    var _isGraphVisible = false;

    // ============================================================
    // ZOOM MANAGEMENT
    // ============================================================

    function setZoomLevel(level) {
        var newLevel = Math.max(0.3, Math.min(3, level));
        _zoomLevel = newLevel;
        updateZoomDisplay();
        renderGraph();
    }

    function getZoomLevel() {
        return _zoomLevel;
    }

    function zoomIn() {
        setZoomLevel(_zoomLevel + 0.1);
    }

    function zoomOut() {
        setZoomLevel(_zoomLevel - 0.1);
    }

    function resetZoom() {
        setZoomLevel(1);
    }

    function updateZoomDisplay() {
        var display = document.getElementById('zoom-display');
        if (display) {
            display.textContent = Math.round(_zoomLevel * 100) + '%';
        }
    }

    // ============================================================
    // VISIBILITY
    // ============================================================

    function setGraphVisible(visible) {
        _isGraphVisible = visible;

        var listView = document.getElementById('social-list-view');
        var graphView = document.getElementById('social-graph-view');

        if (listView) {
            listView.style.display = visible ? 'none' : 'block';
        }
        if (graphView) {
            graphView.style.display = visible ? 'block' : 'none';
        }

        if (visible) {
            updateZoomDisplay();
            setTimeout(renderGraph, 50);
        }
    }

    function isGraphVisible() {
        return _isGraphVisible;
    }

    // ============================================================
    // GRAPH RENDER
    // ============================================================

    function renderGraph() {
        if (!_isGraphVisible) return;

        if (!checkDependencies()) {
            showError('Graph dependencies not loaded.');
            return;
        }

        var svg = document.getElementById('social-svg');
        if (!svg) return;

        var transformGroup = svg.querySelector('#social-graph-transform');
        if (!transformGroup) {
            transformGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            transformGroup.id = 'social-graph-transform';
            svg.appendChild(transformGroup);
        }

        var container = document.getElementById('graph-container');
        if (!container) return;

        var width = container.clientWidth || 800;
        var height = container.clientHeight || 600;

        // Update SVG dimensions
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        var relationships = SocialQueries.getAllRelationships();

        if (relationships.length === 0) {
            transformGroup.innerHTML = '<text x="' + (width/2) + '" y="' + (height/2) + '" text-anchor="middle" fill="var(--text-dim)" font-size="16">No relationships to display</text>';
            return;
        }

        // Build node map
        var nodeMap = buildNodeMap(relationships);

        if (Object.keys(nodeMap).length < 2) {
            transformGroup.innerHTML = '<text x="' + (width/2) + '" y="' + (height/2) + '" text-anchor="middle" fill="var(--text-dim)" font-size="16">Need at least 2 characters with relationships</text>';
            return;
        }

        var nodes = Object.values(nodeMap);
        var positions = calculatePositions(nodes, width, height);

        // Group relationships by pair for parallel edge handling
        var pairGroups = groupRelationshipsByPair(relationships);

        // Build SVG content
        var content = buildGraphSVG(pairGroups, nodeMap, positions, width, height);

        transformGroup.innerHTML = content;

        // Apply zoom transform
        applyGraphTransform(transformGroup, width, height);

        // Update legend
        updateLegend();
    }

    // ============================================================
    // NODE MAP BUILDING
    // ============================================================

    function buildNodeMap(relationships) {
        var nodeMap = Object.create(null);

        relationships.forEach(function(r) {
            if (!r) return;

            var c1 = String(r.character1);
            var c2 = String(r.character2);

            if (!nodeMap[c1]) {
                nodeMap[c1] = { id: c1, connections: 0 };
            }
            if (!nodeMap[c2]) {
                nodeMap[c2] = { id: c2, connections: 0 };
            }

            nodeMap[c1].connections++;
            nodeMap[c2].connections++;
        });

        return nodeMap;
    }

    // ============================================================
    // RELATIONSHIP GROUPING
    // ============================================================

    function groupRelationshipsByPair(relationships) {
        var pairGroups = Object.create(null);

        relationships.forEach(function(r) {
            if (!r) return;

            var key1 = String(r.character1);
            var key2 = String(r.character2);
            var pairKey = key1 < key2 ? key1 + '|' + key2 : key2 + '|' + key1;

            if (!pairGroups[pairKey]) {
                pairGroups[pairKey] = [];
            }
            pairGroups[pairKey].push(r);
        });

        return pairGroups;
    }

    // ============================================================
    // POSITION CALCULATION
    // ============================================================

    function calculatePositions(nodes, width, height) {
        var positions = Object.create(null);
        var centerX = width / 2;
        var centerY = height / 2;

        if (nodes.length === 0) {
            return positions;
        }

        if (nodes.length === 1) {
            positions[nodes[0].id] = { x: centerX, y: centerY };
            return positions;
        }

        // Calculate radius based on number of nodes
        var radius = Math.min(width, height) * 0.35;

        // Special case: 2 nodes
        if (nodes.length === 2) {
            var spacing = radius * 0.6;
            positions[nodes[0].id] = { x: centerX - spacing, y: centerY };
            positions[nodes[1].id] = { x: centerX + spacing, y: centerY };
            return positions;
        }

        // Circular layout with adaptive radius
        var angleStep = (2 * Math.PI) / nodes.length;

        nodes.forEach(function(node, index) {
            var angle = angleStep * index - Math.PI / 2;

            // Adjust radius based on node degree (more connections = closer to center)
            var maxConnections = 1;
            nodes.forEach(function(n) {
                if (n.connections > maxConnections) {
                    maxConnections = n.connections;
                }
            });

            var degreeFactor = 1 - (node.connections / (maxConnections + 5)) * 0.4;
            var dist = radius * (0.6 + 0.4 * degreeFactor);

            positions[node.id] = {
                x: centerX + dist * Math.cos(angle),
                y: centerY + dist * Math.sin(angle)
            };
        });

        return positions;
    }

    // ============================================================
    // GRAPH SVG BUILDER
    // ============================================================

    function buildGraphSVG(pairGroups, nodeMap, positions, width, height) {
        var html = '';

        // Draw relationship lines
        Object.keys(pairGroups).forEach(function(pairKey) {
            var rels = pairGroups[pairKey];
            var firstRel = rels[0];
            var pos1 = positions[firstRel.character1];
            var pos2 = positions[firstRel.character2];

            if (!pos1 || !pos2) return;

            var total = rels.length;

            rels.forEach(function(r, index) {
                var color = SocialQueries.getRelationshipTypeColor(r.typeId);
                var typeLabel = SocialQueries.getRelationshipTypeLabel(r.typeId);
                var isDirectional = SocialQueries.isRelationshipDirectional(r.typeId);
                var clarification = r.clarification ? ' (' + r.clarification + ')' : '';

                // Calculate offset for parallel edges
                var offset = 0;
                if (total > 1) {
                    var offsetAmount = 8;
                    var midIndex = (total - 1) / 2;
                    offset = (index - midIndex) * offsetAmount;
                }

                var dx = pos2.x - pos1.x;
                var dy = pos2.y - pos1.y;
                var dist = Math.sqrt(dx * dx + dy * dy) || 1;

                // Perpendicular unit vector for offset
                var perpX = -dy / dist;
                var perpY = dx / dist;

                var x1 = pos1.x + perpX * offset;
                var y1 = pos1.y + perpY * offset;
                var x2 = pos2.x + perpX * offset;
                var y2 = pos2.y + perpY * offset;

                // Relationship line
                html += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" ';
                html += 'stroke="' + escapeHtml(color) + '" stroke-width="2" opacity="0.6" />';

                // Direction arrow for directional relationships
                if (isDirectional) {
                    html += buildDirectionArrow(x1, y1, x2, y2, pos1, pos2, color);
                }

                // Relationship label
                var midX = (x1 + x2) / 2 + perpX * offset * 1.5;
                var midY = (y1 + y2) / 2 + perpY * offset * 1.5;
                var labelY = midY - 5 - (total > 1 ? (index - (total - 1) / 2) * 6 : 0);

                html += '<text x="' + midX + '" y="' + labelY + '" text-anchor="middle" fill="' + escapeHtml(color) + '" font-size="9" opacity="0.7">' + escapeHtml(typeLabel + clarification) + '</text>';
            });
        });

        // Draw nodes
        var nodeIds = Object.keys(nodeMap);
        nodeIds.forEach(function(nodeId) {
            var node = nodeMap[nodeId];
            var pos = positions[nodeId];
            if (!pos) return;

            var char = CharacterQueries.getCharacterById(nodeId);
            var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
            var status = char ? CharacterQueries.getCurrentStatus(char) : '';
            var radius = Math.max(20, Math.min(35, 20 + node.connections * 3));
            var color = getNodeColor(char);

            // Shadow
            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + radius + '" fill="rgba(0,0,0,0.3)" opacity="0.3" />';

            // Node circle
            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + radius + '" fill="' + escapeHtml(color) + '" stroke="var(--border)" stroke-width="2" cursor="pointer" class="graph-node" data-id="' + escapeHtml(nodeId) + '" />';

            // Node label
            var fontSize = Math.max(9, Math.min(13, radius * 0.6));
            var displayName = getGraphLabel(name);

            html += '<text x="' + pos.x + '" y="' + (pos.y + 4) + '" text-anchor="middle" fill="var(--text)" font-size="' + fontSize + '" font-weight="600" pointer-events="none" class="graph-label">' + escapeHtml(displayName) + '</text>';

            // Status label
            if (status) {
                var statusColor = status === 'Deceased' ? 'var(--danger)' : 'var(--text-dim)';
                html += '<text x="' + pos.x + '" y="' + (pos.y + radius + 14) + '" text-anchor="middle" fill="' + statusColor + '" font-size="8" pointer-events="none">' + escapeHtml(status) + '</text>';
            }
        });

        return html;
    }

    // ============================================================
    // DIRECTION ARROW BUILDER
    // ============================================================

    function buildDirectionArrow(x1, y1, x2, y2, pos1, pos2, color) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;

        // Calculate arrow position (near the target node)
        var angle = Math.atan2(dy, dx);

        // Use pos2 for radius calculation
        var nodeId = Object.keys({}).find(function(key) { return false; }); // We need to find the target node
        // Actually we need to calculate based on the target node's degree
        var radius = 20; // Fallback

        var arrowDist = Math.max(0, dist - radius - 4);
        var ratio = Math.min(1, arrowDist / dist);

        var arrowX = x1 + (x2 - x1) * ratio;
        var arrowY = y1 + (y2 - y1) * ratio;

        var arrowSize = 8;

        return '<polygon points="' +
            (arrowX + arrowSize * Math.cos(angle - 0.4)) + ',' + (arrowY + arrowSize * Math.sin(angle - 0.4)) + ' ' +
            (arrowX + arrowSize * Math.cos(angle + 0.4)) + ',' + (arrowY + arrowSize * Math.sin(angle + 0.4)) + ' ' +
            (arrowX + arrowSize * 1.4 * Math.cos(angle)) + ',' + (arrowY + arrowSize * 1.4 * Math.sin(angle)) +
            '" fill="' + escapeHtml(color) + '" opacity="0.8" />';
    }

    // ============================================================
    // NODE COLOR
    // ============================================================

    function getNodeColor(char) {
        if (!char) return '#7f8c8d';
        if (char.deceased) return '#666666';

        var status = CharacterQueries.getCurrentStatus(char).toLowerCase();

        var colorMap = {
            'instructor': '#9b59b6',
            'teacher': '#9b59b6',
            'professor': '#9b59b6',
            'senior': '#c9a24b',
            'junior': '#4a9bc7',
            'rookie': '#27ae60',
            'trainee': '#8cbb3a',
            'student': '#8cbb3a',
            'support': '#e67e22',
            'civilian': '#7f8c8d'
        };

        return colorMap[status] || '#7f8c8d';
    }

    // ============================================================
    // GRAPH LABEL FORMATTING
    // ============================================================

    function getGraphLabel(name) {
        if (!name) return '?';

        if (name.length <= 12) {
            return name;
        }

        // Try to create a short name with initials
        var parts = name.split(' ');
        if (parts.length >= 2) {
            var first = parts[0];
            var last = parts[parts.length - 1];

            // If first name is long, use initial
            if (first.length > 6) {
                var initial = first.charAt(0);
                return initial + '. ' + last;
            }

            return first + ' ' + last.charAt(0) + '.';
        }

        // Fallback: truncate
        return name.substring(0, 10) + '...';
    }

    // ============================================================
    // TRANSFORM APPLICATION
    // ============================================================

    function applyGraphTransform(transformGroup, width, height) {
        if (!transformGroup) {
            transformGroup = document.querySelector('#social-graph-transform');
            if (!transformGroup) return;
        }

        var centerX = (width || 800) / 2;
        var centerY = (height || 600) / 2;

        transformGroup.setAttribute(
            'transform',
            'translate(' + centerX + ',' + centerY + ') ' +
            'scale(' + _zoomLevel + ') ' +
            'translate(' + (-centerX) + ',' + (-centerY) + ')'
        );
    }

    // ============================================================
    // LEGEND
    // ============================================================

    function updateLegend() {
        var container = document.getElementById('legend-items');
        if (!container) return;

        var types = SocialQueries.getRelationshipTypes();

        container.textContent = '';

        types.forEach(function(t) {
            var color = t.color || '#7f8c8d';

            var span = document.createElement('span');
            span.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:0.7rem;';

            var colorSpan = document.createElement('span');
            colorSpan.style.cssText = 'display:inline-block;width:12px;height:4px;background:' + color + ';border-radius:2px;';
            span.appendChild(colorSpan);

            var labelSpan = document.createElement('span');
            labelSpan.textContent = t.label + (t.directional ? ' →' : '');
            span.appendChild(labelSpan);

            container.appendChild(span);
        });
    }

    // ============================================================
    // RESIZE HANDLING
    // ============================================================

    function handleResize() {
        if (_isGraphVisible) {
            var svg = document.getElementById('social-svg');
            if (svg) {
                var container = document.getElementById('graph-container');
                if (container) {
                    svg.setAttribute('width', container.clientWidth);
                    svg.setAttribute('height', container.clientHeight);
                }
            }
            setTimeout(renderGraph, 100);
        }
    }

    // ============================================================
    // ERROR DISPLAY
    // ============================================================

    function showError(message) {
        var svg = document.getElementById('social-svg');
        if (!svg) return;

        var transformGroup = svg.querySelector('#social-graph-transform');
        if (!transformGroup) return;

        var width = svg.clientWidth || 800;
        var height = svg.clientHeight || 600;

        transformGroup.innerHTML = '<text x="' + (width/2) + '" y="' + (height/2) + '" text-anchor="middle" fill="var(--danger)" font-size="16">' + escapeHtml(message) + '</text>';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialGraph = {
        // Render
        renderGraph: renderGraph,

        // Zoom
        setZoomLevel: setZoomLevel,
        getZoomLevel: getZoomLevel,
        zoomIn: zoomIn,
        zoomOut: zoomOut,
        resetZoom: resetZoom,

        // Visibility
        setGraphVisible: setGraphVisible,
        isGraphVisible: isGraphVisible,

        // Legend
        updateLegend: updateLegend,

        // Resize
        handleResize: handleResize,

        // Helpers
        calculatePositions: calculatePositions,
        getGraphLabel: getGraphLabel,
        getNodeColor: getNodeColor,

        // State
        getZoomLevel: getZoomLevel
    };

})();