/**
 * modules/social/social-graph.js - Social Graph Visualization
 * SVG-based FOCUSED radial social network graph (top-level Social tab)
 *
 * Path: js/modules/social/social-graph.js
 *
 * WHAT THIS MODULE RENDERS:
 *   A focused radial graph. One character sits at the center; their
 *   direct connections are arranged on a ring around them. Edges run
 *   from the center to each ring node, colored by relationship type
 *   and (when directional) arrowed.
 *
 *   This is NOT a full-network hairball. The previous implementation
 *   laid out every character and every relationship at once; the
 *   result was unreadable and the click model was ambiguous.
 *
 * FOCUS STACK (the drill-down model):
 *   _focusStack is an array of character IDs. The TOP of the stack
 *   is the current center.
 *
 *   - Empty stack: a prompt is rendered. This is the entry state.
 *   - One entry:    that character is centered.
 *   - Two+ entries: the top is centered; the one below it is the
 *                   "back" destination.
 *
 *   Clicking a RING node pushes that node onto the stack. Clicking
 *   the CENTER node pops the stack. The breadcrumb (rendered by
 *   social-views.js) shows the path and provides direct jumps.
 *
 *   Click handling lives in social-events.js, not here. This module
 *   emits data-node-id and data-is-center on each node circle and
 *   exposes pushFocus/popFocus/setFocus/resetFocus as its public
 *   focus API. The events layer calls into those.
 *
 *   The stack is NOT cleared when the graph is hidden. Hiding and
 *   re-showing the graph preserves the user's place. resetFocus()
 *   is the explicit way to clear it.
 *
 *   setGraphVisible(true, charId) seeds the stack with a single
 *   character. setGraphVisible(true) with no charId preserves the
 *   current stack. setGraphVisible(false, ...) hides without
 *   touching the stack.
 *
 * MULTIPLE RELATIONSHIPS BETWEEN THE SAME PAIR:
 *   Two characters can have more than one relationship (e.g. a
 *   friendship and a rivalry). Each is drawn as a separate edge,
 *   offset perpendicular to the line.
 *
 * SELF-EDGES:
 *   A relationship between a character and themselves is rejected by
 *   SocialCore's validator, so a self-edge cannot exist in stored
 *   data. The renderer does not special-case it.
 *
 * RING-NODE BADGE:
 *   Each ring node carries a small badge showing how many total
 *   relationships that character has (across all their relationships,
 *   not just the one to the center). This tells the user how much
 *   is behind a click before they make it.
 *
 * NODE COLORS:
 *   Node fill and stroke are CSS custom property references,
 *   resolved at paint time. Tokens are declared in css/shared.css
 *   with dark and light variants. See --graph-node-status-* in
 *   shared.css.
 *
 *   Do NOT reintroduce hex literals in getNodeColor.
 *
 * DEPENDENCIES:
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.SocialAggregator (from social-aggregator.js) - MANDATORY
 *   - window.SocialConstants (from social-constants.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 */

(function() {
    'use strict';

    if (window.__socialGraphLoaded) {
        return;
    }
    window.__socialGraphLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var SocialQueries = window.SocialQueries;
    var SocialAggregator = window.SocialAggregator;
    var SocialConstants = window.SocialConstants;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!SocialQueries || typeof SocialQueries.getAllRelationships !== 'function') {
            missing.push('SocialQueries.getAllRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.getCharacterRelationships !== 'function') {
            missing.push('SocialQueries.getCharacterRelationships');
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

        if (!SocialAggregator || typeof SocialAggregator.getConnectedCharactersViewModel !== 'function') {
            missing.push('SocialAggregator.getConnectedCharactersViewModel');
        }

        if (!SocialConstants || typeof SocialConstants.getRelationshipTypes !== 'function') {
            missing.push('SocialConstants.getRelationshipTypes');
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
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // STATE
    // ============================================================

    var _zoomLevel = 1;
    var _isGraphVisible = false;

    /**
     * Focus stack. Top of stack is the current center.
     * Empty = entry prompt.
     */
    var _focusStack = [];

    // ============================================================
    // FOCUS API (public - used by social-views and social-events)
    // ============================================================

    /**
     * Return a copy of the current focus stack (bottom to top).
     * The breadcrumb renderer walks this.
     */
    function getFocusPath() {
        return _focusStack.slice();
    }

    /**
     * Return the currently focused character id, or null when the
     * stack is empty.
     */
    function getFocusedCharacterId() {
        if (_focusStack.length === 0) { return null; }
        return _focusStack[_focusStack.length - 1];
    }

    /**
     * Replace the entire focus stack with a single-entry path.
     * Passing null or an empty string clears the focus entirely
     * (back to the entry prompt).
     *
     * Re-renders the graph if it is visible.
     */
    function setFocus(charId) {
        if (!charId) {
            _focusStack = [];
        } else {
            _focusStack = [String(charId)];
        }
        if (_isGraphVisible) {
            renderGraph();
        }
    }

    /**
     * Push a character onto the focus stack (drill down).
     * No-op if the id is already the top of the stack.
     *
     * Re-renders the graph if it is visible.
     */
    function pushFocus(charId) {
        if (!charId) { return; }
        var id = String(charId);

        if (_focusStack.length > 0 &&
            _focusStack[_focusStack.length - 1] === id) {
            return;
        }

        // Guard against a cycle: if the id is already somewhere
        // below the top, truncate the stack to that position instead
        // of duplicating it. This lets the user click "back" through
        // a relationship loop without growing an unbounded stack.
        var existingIndex = _focusStack.indexOf(id);
        if (existingIndex !== -1) {
            _focusStack = _focusStack.slice(0, existingIndex + 1);
        } else {
            _focusStack.push(id);
        }

        if (_isGraphVisible) {
            renderGraph();
        }
    }

    /**
     * Pop the focus stack (navigate back).
     * Popping the last entry returns to the entry prompt.
     *
     * Re-renders the graph if it is visible.
     */
    function popFocus() {
        if (_focusStack.length === 0) { return; }
        _focusStack.pop();
        if (_isGraphVisible) {
            renderGraph();
        }
    }

    /**
     * Clear the focus stack entirely.
     * Re-renders the graph if it is visible.
     */
    function resetFocus() {
        _focusStack = [];
        if (_isGraphVisible) {
            renderGraph();
        }
    }

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
    //
    // setGraphVisible(true, charId):
    //   Seed the focus stack with that character, then show.
    //
    // setGraphVisible(true):
    //   Show. Preserve whatever focus was already set.
    //
    // setGraphVisible(false):
    //   Hide. Do NOT clear the focus stack. Re-showing later
    //   restores the user's place.

    function setGraphVisible(visible, charId) {
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
            if (charId) {
                _focusStack = [String(charId)];
            }
            updateZoomDisplay();
            // Defer the render by one frame so the container has
            // non-zero clientWidth/clientHeight by the time we read
            // them. Without this, a graph shown by unhiding a
            // display:none ancestor measures 0x0 and lays out wrong.
            setTimeout(function() { renderGraph(); }, 50);
        }
    }

    function isGraphVisible() {
        return _isGraphVisible;
    }

    // ============================================================
    // GRAPH RENDER
    // ============================================================

    /**
     * Render the focused graph. Entry point is the public focus API;
     * callers do not pass a charId here. The current center comes
     * from the top of _focusStack.
     *
     * This function is idempotent and cheap to call: it always
     * re-reads the focus stack, re-reads the relationship store,
     * and rebuilds the SVG.
     */
    function renderGraph() {
        if (!_isGraphVisible) {
            return;
        }

        if (!checkDependencies()) {
            showError('Graph dependencies not loaded.');
            return;
        }

        var svg = document.getElementById('social-svg');
        if (!svg) { return; }

        var transformGroup = svg.querySelector('#social-graph-transform');
        if (!transformGroup) {
            transformGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            transformGroup.id = 'social-graph-transform';
            svg.appendChild(transformGroup);
        }

        var container = document.getElementById('graph-container');
        if (!container) { return; }

        var width = container.clientWidth || 800;
        var height = container.clientHeight || 600;

        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        var focusedId = getFocusedCharacterId();

        // ---- Entry prompt ----
        if (!focusedId) {
            renderEntryPrompt(width, height, transformGroup);
            updateLegend();
            return;
        }

        // ---- Gather relationships involving the focused character ----
        var relationships = SocialQueries.getCharacterRelationships(focusedId) || [];

        // ---- Build the ring: one entry per distinct OTHER character ----
        var ringIds = [];
        var ringSeen = Object.create(null);

        for (var i = 0; i < relationships.length; i++) {
            var r = relationships[i];
            if (!r) { continue; }
            var otherId = String(r.character1) === focusedId
                ? String(r.character2)
                : String(r.character1);
            if (otherId === focusedId) { continue; }
            if (ringSeen[otherId]) { continue; }
            ringSeen[otherId] = true;
            ringIds.push(otherId);
        }

        // ---- Focused character display data ----
        var focusedVm = SocialAggregator.getConnectedCharactersViewModel(focusedId);
        var focusedName = (focusedVm && focusedVm.characterName) || 'Unknown';
        var focusedStatus = (focusedVm && focusedVm.characterStatus) || '';
        var focusedDeceased = (focusedVm && focusedVm.characterDeceased) || false;

        // ---- Positions ----
        var positions = computePositions(focusedId, ringIds, width, height);

        // ---- Build SVG ----
        var content = buildFocusedGraphSVG(
            focusedId,
            focusedName,
            focusedStatus,
            focusedDeceased,
            ringIds,
            relationships,
            positions
        );

        transformGroup.innerHTML = content;

        applyGraphTransform(transformGroup, width, height);
        updateLegend();
    }

    function renderEntryPrompt(width, height, transformGroup) {
        var html = '';
        html += '<text x="' + (width / 2) + '" y="' + (height / 2 - 10) + '" ' +
                'text-anchor="middle" fill="var(--text-dim)" ' +
                'font-size="16" font-weight="600">' +
                'Select a character to focus' +
                '</text>';
        html += '<text x="' + (width / 2) + '" y="' + (height / 2 + 16) + '" ' +
                'text-anchor="middle" fill="var(--text-dim)" ' +
                'font-size="12">' +
                'Click any node in a focused view to drill into that character.' +
                '</text>';
        transformGroup.innerHTML = html;
    }

    // ============================================================
    // POSITIONING
    // ============================================================
    //
    // The focused character sits at the exact center. Ring nodes are
    // distributed evenly on a circle around it.
    //
    // The radius scales with the ring size so that many connections
    // do not crowd the center or each other. It is expressed as a
    // fraction of the smaller container dimension, capped at 45%,
    // with a small linear growth for rings above 8 nodes.

    function computePositions(focusedId, ringIds, width, height) {
        var positions = Object.create(null);
        var centerX = width / 2;
        var centerY = height / 2;

        positions[focusedId] = { x: centerX, y: centerY };

        if (ringIds.length === 0) { return positions; }

        var base = Math.min(width, height);
        var radius = base * 0.35;
        if (ringIds.length > 8) {
            radius = Math.min(base * 0.45, radius + (ringIds.length - 8) * 6);
        }

        var angleStep = (2 * Math.PI) / ringIds.length;

        for (var i = 0; i < ringIds.length; i++) {
            var angle = angleStep * i - Math.PI / 2;
            positions[ringIds[i]] = {
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle)
            };
        }

        return positions;
    }

    // ============================================================
    // GRAPH SVG BUILDER
    // ============================================================

    function buildFocusedGraphSVG(
        focusedId,
        focusedName,
        focusedStatus,
        focusedDeceased,
        ringIds,
        relationships,
        positions
    ) {
        var html = '';

        // ---- Group relationships by the OTHER character, so we can
        //      offset parallel edges between the same pair. ----
        var byOther = Object.create(null);

        for (var i = 0; i < relationships.length; i++) {
            var rel = relationships[i];
            if (!rel) { continue; }

            var other = String(rel.character1) === focusedId
                ? String(rel.character2)
                : String(rel.character1);
            if (other === focusedId) { continue; }

            if (!byOther[other]) { byOther[other] = []; }
            byOther[other].push(rel);
        }

        // ---- Edges ----
        Object.keys(byOther).forEach(function(otherId) {
            var rels = byOther[otherId];
            var p1 = positions[focusedId];
            var p2 = positions[otherId];
            if (!p1 || !p2) { return; }

            var total = rels.length;
            var midIndex = (total - 1) / 2;

            rels.forEach(function(rel, index) {
                var color = SocialQueries.getRelationshipTypeColor(rel.typeId);
                var typeLabel = SocialQueries.getRelationshipTypeLabel(rel.typeId);
                var isDirectional = SocialQueries.isRelationshipDirectional(rel.typeId);

                // Perpendicular offset for parallel edges.
                var offset = 0;
                if (total > 1) {
                    offset = (index - midIndex) * 8;
                }

                var dx = p2.x - p1.x;
                var dy = p2.y - p1.y;
                var dist = Math.sqrt(dx * dx + dy * dy) || 1;
                var perpX = -dy / dist;
                var perpY = dx / dist;

                var x1 = p1.x + perpX * offset;
                var y1 = p1.y + perpY * offset;
                var x2 = p2.x + perpX * offset;
                var y2 = p2.y + perpY * offset;

                html += '<line x1="' + x1 + '" y1="' + y1 + '" ' +
                        'x2="' + x2 + '" y2="' + y2 + '" ' +
                        'stroke="' + escapeAttribute(color) + '" ' +
                        'stroke-width="2" opacity="0.65" />';

                // Arrowhead, respecting direction. If focused is
                // character1, the arrow points from focused to other.
                // Otherwise it points from other to focused.
                if (isDirectional) {
                    var fromX, fromY, toX, toY;
                    if (String(rel.character1) === focusedId) {
                        fromX = x1; fromY = y1;
                        toX = x2; toY = y2;
                    } else {
                        fromX = x2; fromY = y2;
                        toX = x1; toY = y1;
                    }
                    html += buildDirectionArrow(fromX, fromY, toX, toY, color);
                }

                // Edge label, shifted toward the center so it does
                // not collide with the ring node's own label.
                var midX = (x1 + x2) / 2 + perpX * offset * 1.5;
                var midY = (y1 + y2) / 2 + perpY * offset * 1.5;

                var shift = 0.35;
                midX = midX * (1 - shift) + p1.x * shift;
                midY = midY * (1 - shift) + p1.y * shift;

                html += '<text x="' + midX + '" y="' + midY + '" ' +
                        'text-anchor="middle" ' +
                        'fill="' + escapeAttribute(color) + '" ' +
                        'font-size="9" opacity="0.85" ' +
                        'pointer-events="none">' +
                        escapeHtml(typeLabel) +
                        '</text>';
            });
        });

        // ---- Center node ----
        html += buildNode(
            focusedId,
            focusedName,
            focusedStatus,
            focusedDeceased,
            positions[focusedId],
            true,                       // isCenter
            _focusStack.length > 1,     // canGoBack
            0                           // connectionCount (unused for center)
        );

        // ---- Ring nodes ----
        for (var r = 0; r < ringIds.length; r++) {
            var ringId = ringIds[r];
            var ringPos = positions[ringId];
            if (!ringPos) { continue; }

            var vm = SocialAggregator.getConnectedCharactersViewModel(ringId);
            var ringName = (vm && vm.characterName) || 'Unknown';
            var ringStatus = (vm && vm.characterStatus) || '';
            var ringDeceased = (vm && vm.characterDeceased) || false;

            // Total relationship count for this ring node. Used as a
            // "how much is behind this click" badge.
            var ringRelCount = 0;
            if (vm && Array.isArray(vm.connections)) {
                for (var c = 0; c < vm.connections.length; c++) {
                    var conn = vm.connections[c];
                    if (conn && Array.isArray(conn.relationships)) {
                        ringRelCount += conn.relationships.length;
                    }
                }
            }

            html += buildNode(
                ringId,
                ringName,
                ringStatus,
                ringDeceased,
                ringPos,
                false,       // isCenter
                false,       // canGoBack
                ringRelCount
            );
        }

        return html;
    }

    /**
     * Build one node: shadow + circle + label + status + badge.
     *
     * Click handling: the circle carries class="social-graph-node"
     * and data-node-id / data-is-center. The delegated click handler
     * lives in social-events.js.
     */
    function buildNode(
        nodeId,
        name,
        status,
        deceased,
        pos,
        isCenter,
        canGoBack,
        connectionCount
    ) {
        if (!pos) { return ''; }

        var radius = isCenter ? 42 : 26;
        var color = getNodeColor(deceased, status);

        var html = '';

        // Shadow.
        html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" ' +
                'r="' + (radius + 3) + '" ' +
                'fill="rgba(0,0,0,0.35)" pointer-events="none" />';

        // Node circle. Clickable.
        html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" ' +
                'r="' + radius + '" ' +
                'fill="' + escapeAttribute(color) + '" ' +
                'stroke="var(--border)" stroke-width="2" ' +
                'cursor="pointer" ' +
                'class="social-graph-node" ' +
                'data-node-id="' + escapeAttribute(nodeId) + '" ' +
                'data-is-center="' + (isCenter ? 'true' : 'false') + '" ' +
                '/>';

        // Label.
        var fontSize = isCenter
            ? 13
            : Math.max(9, Math.min(12, radius * 0.5));
        var displayName = getGraphLabel(name);

        html += '<text x="' + pos.x + '" y="' + (pos.y + 4) + '" ' +
                'text-anchor="middle" fill="var(--text)" ' +
                'font-size="' + fontSize + '" font-weight="600" ' +
                'pointer-events="none">' +
                escapeHtml(displayName) +
                '</text>';

        // Status line below the node.
        if (status) {
            var statusColor = deceased ? 'var(--danger)' : 'var(--text-dim)';
            html += '<text x="' + pos.x + '" y="' + (pos.y + radius + 14) + '" ' +
                    'text-anchor="middle" fill="' + statusColor + '" ' +
                    'font-size="8" pointer-events="none">' +
                    escapeHtml(status) +
                    '</text>';
        }

        // Connection-count badge on ring nodes.
        if (!isCenter && typeof connectionCount === 'number' && connectionCount > 0) {
            var bx = pos.x + radius * 0.75;
            var by = pos.y - radius * 0.75;

            html += '<circle cx="' + bx + '" cy="' + by + '" r="9" ' +
                    'fill="var(--accent)" opacity="0.9" ' +
                    'pointer-events="none" />';

            html += '<text x="' + bx + '" y="' + (by + 3) + '" ' +
                    'text-anchor="middle" fill="var(--bg)" ' +
                    'font-size="9" font-weight="700" ' +
                    'pointer-events="none">' +
                    connectionCount +
                    '</text>';
        }

        // "back" hint above the center node when a pop is available.
        if (isCenter && canGoBack) {
            html += '<text x="' + pos.x + '" y="' + (pos.y - radius - 8) + '" ' +
                    'text-anchor="middle" fill="var(--accent)" ' +
                    'font-size="9" font-weight="600" ' +
                    'pointer-events="none">' +
                    '\u21a9 back' +
                    '</text>';
        }

        return html;
    }

    // ============================================================
    // DIRECTION ARROW
    // ============================================================

    function buildDirectionArrow(x1, y1, x2, y2, color) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;

        var angle = Math.atan2(dy, dx);

        // Stop short of the target node.
        var targetRadius = 26;
        var arrowDist = Math.max(0, dist - targetRadius - 4);
        var ratio = Math.min(1, arrowDist / dist);

        var arrowX = x1 + (x2 - x1) * ratio;
        var arrowY = y1 + (y2 - y1) * ratio;

        var arrowSize = 8;

        return '<polygon points="' +
            (arrowX + arrowSize * Math.cos(angle - 0.4)) + ',' +
            (arrowY + arrowSize * Math.sin(angle - 0.4)) + ' ' +
            (arrowX + arrowSize * Math.cos(angle + 0.4)) + ',' +
            (arrowY + arrowSize * Math.sin(angle + 0.4)) + ' ' +
            (arrowX + arrowSize * 1.4 * Math.cos(angle)) + ',' +
            (arrowY + arrowSize * 1.4 * Math.sin(angle)) +
            '" fill="' + escapeAttribute(color) + '" opacity="0.85" ' +
            'pointer-events="none" />';
    }

    // ============================================================
    // NODE COLOR
    // ============================================================
    //
    // Node fills are CSS custom property references, resolved at
    // paint time. The tokens are declared in css/shared.css under
    // --graph-node-status-* with dark and light variants.
    //
    // Do NOT reintroduce hex literals here. If a new status needs
    // its own node color, add a token to shared.css in both
    // :root and [data-theme="light"] and reference it by name.

    function getNodeColor(deceased, status) {
        if (deceased) {
            return 'var(--graph-node-status-deceased)';
        }

        var statusLower = String(status).toLowerCase();

        switch (statusLower) {
            case 'instructor':
            case 'teacher':
            case 'professor':
                return 'var(--graph-node-status-instructor)';
            case 'senior':
                return 'var(--graph-node-status-senior)';
            case 'junior':
                return 'var(--graph-node-status-junior)';
            case 'rookie':
                return 'var(--graph-node-status-rookie)';
            case 'trainee':
            case 'student':
                return 'var(--graph-node-status-student)';
            case 'support':
                return 'var(--graph-node-status-support)';
            case 'civilian':
                return 'var(--graph-node-status-civilian)';
            default:
                return 'var(--graph-node-status-other)';
        }
    }

    // ============================================================
    // GRAPH LABEL FORMATTING
    // ============================================================

    function getGraphLabel(name) {
        if (!name) {
            return '?';
        }

        if (name.length <= 12) {
            return name;
        }

        var parts = name.split(' ');
        if (parts.length >= 2) {
            var first = parts[0];
            var last = parts[parts.length - 1];

            if (first.length > 6) {
                return first.charAt(0) + '. ' + last;
            }

            return first + ' ' + last.charAt(0) + '.';
        }

        return name.substring(0, 10) + '...';
    }

    // ============================================================
    // TRANSFORM APPLICATION
    // ============================================================

    function applyGraphTransform(transformGroup, width, height) {
        if (!transformGroup) {
            transformGroup = document.querySelector('#social-graph-transform');
            if (!transformGroup) { return; }
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
        if (!container) {
            return;
        }

        var types = SocialQueries.getRelationshipTypes();

        container.textContent = '';

        types.forEach(function(t) {
            var color = t.color || 'var(--relationship-other)';

            var span = document.createElement('span');
            span.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:0.7rem;';

            var colorSpan = document.createElement('span');
            colorSpan.style.cssText = 'display:inline-block;width:12px;height:4px;background:' + color + ';border-radius:2px;';
            span.appendChild(colorSpan);

            var labelSpan = document.createElement('span');
            labelSpan.textContent = t.label + (t.directional ? ' \u2192' : '');
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
            setTimeout(function() { renderGraph(); }, 100);
        }
    }

    // ============================================================
    // ERROR DISPLAY
    // ============================================================

    function showError(message) {
        var svg = document.getElementById('social-svg');
        if (!svg) { return; }

        var transformGroup = svg.querySelector('#social-graph-transform');
        if (!transformGroup) { return; }

        var width = svg.clientWidth || 800;
        var height = svg.clientHeight || 600;

        transformGroup.innerHTML = '<text x="' + (width / 2) + '" y="' + (height / 2) + '" text-anchor="middle" fill="var(--danger)" font-size="16">' + escapeHtml(message) + '</text>';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialGraph = {
        // Render
        renderGraph: renderGraph,

        // Focus API
        getFocusPath: getFocusPath,
        getFocusedCharacterId: getFocusedCharacterId,
        setFocus: setFocus,
        pushFocus: pushFocus,
        popFocus: popFocus,
        resetFocus: resetFocus,

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

        // Helpers (exposed for testing)
        getGraphLabel: getGraphLabel,
        getNodeColor: getNodeColor
    };

})();
