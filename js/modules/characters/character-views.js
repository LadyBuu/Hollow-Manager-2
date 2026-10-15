/**
 * js/modules/characters/character-views.js - Character Views
 * Renders the Social tab and the Professional tab inside the
 * Character form.
 *
 * Path: js/modules/characters/character-views.js
 *
 * This module is responsible for:
 *   - Rendering the character's relationships grouped by type
 *   - Collapsible group sections
 *   - Ongoing / Ended subsections within each type
 *   - Inline directional arrows for directional relationship types
 *   - The character SVG network graph modal
 *   - Rendering the character's professional team memberships
 *   - Rendering the character's department memberships
 *
 * IMPORTANT:
 *   - RENDER ONLY - no data mutation
 *   - Data access is via CharacterQueries / SocialQueries /
 *     TeamQueries / DepartmentQueries, not raw window.data. The
 *     single exception is the current-year fallback in
 *     renderCharacterProfessional / renderProfessionalDepartmentsSection,
 *     which reads window.data.currentYear when CharacterQueries is
 *     unavailable.
 *   - Uses SocialConstants for type definitions
 *   - Uses CharacterQueries for display names
 *   - Uses DomUtils for safe escaping
 *
 * GROUP COLLAPSE STATE:
 *   The collapsed state for a relationship group is keyed by
 *   `charId|typeId` and persisted in sessionStorage under
 *   `characters_relationship_collapsed_v1`. A re-render reads
 *   the current state from storage, so groups stay as the user
 *   left them.
 *
 *   A module-level click listener on document watches for
 *   `.relationship-group-header` clicks. It runs alongside the
 *   delegated handler in character-events.js. That handler toggles
 *   the DOM; this listener reads the DOM after the toggle and
 *   persists the state. Storage and DOM stay in sync without
 *   character-events.js needing to know about this module.
 *
 * PROFESSIONAL TAB BUCKETS:
 *   When the current year is known and the TeamQueries helpers are
 *   available, stints are split into:
 *     Active    - the current year falls within the stint
 *     Upcoming  - the stint starts after the current year
 *     Former    - the stint ended before the current year
 *
 *   A stint that fits none of these (corrupt window, missing
 *   bounds) lands in the Membership list so the row is visible
 *   and editable. When the split is unavailable, all stints land
 *   in Membership.
 *
 * STINT ACTIONS:
 *   End and Remove buttons are rendered only when a stint has a
 *   non-empty joinPeriod. A row without a join period cannot be
 *   addressed by TeamCore.endMemberInterval /
 *   purgeMemberInterval, and the event layer rejects it. Hiding
 *   the buttons avoids dead actions.
 *
 * RELATIONSHIP FORM OWNERSHIP:
 *   The character-tab relationship form has been RETIRED. Opening
 *   the relationship modal from the character tab goes through
 *   SocialEvents.handleAddRelationship. Do NOT reintroduce a
 *   relationship-form builder in this file.
 *
 * GRAPH NODE COLORS:
 *   Node colours come from --graph-node-* tokens declared in
 *   css/shared.css:
 *
 *     --graph-node-accent-fill
 *     --graph-node-info-fill
 *     --graph-node-accent-stroke
 *     --graph-node-info-stroke
 *
 *   These must exist in every theme this app supports.
 *
 * GRAPH MODAL:
 *   The graph modal is built as a plain DOM subtree with its own
 *   close-button id and inline styles. character-events.js binds
 *   the overlay-click handler separately. Migrating it to
 *   Modal.modalSetup is a future improvement; the current shape is
 *   documented here.
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterQueries
 *   - window.SocialQueries
 *   - window.SocialConstants
 *   - window.TeamQueries
 *   - window.DepartmentQueries
 *   - window.DomUtils
 */

(function() {
    'use strict';

    if (window.__characterViewsLoaded) {
        return;
    }
    window.__characterViewsLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY ACCESS
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getSocialQueries() { return window.SocialQueries || null; }
    function getSocialConstants() { return window.SocialConstants || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getDepartmentQueries() { return window.DepartmentQueries || null; }
    function getDomUtils() { return window.DomUtils || null; }

    var _warnedAboutCurrentYear = false;
    function getCurrentYear() {
        var CQ = getCharacterQueries();
        if (CQ && typeof CQ.getCurrentYear === 'function') {
            return CQ.getCurrentYear();
        }
        if (window.data &&
            typeof window.data.currentYear === 'number' &&
            isFinite(window.data.currentYear) &&
            window.data.currentYear > 0) {
            return Math.floor(window.data.currentYear);
        }
        if (!_warnedAboutCurrentYear && typeof console !== 'undefined' &&
            console.warn) {
            _warnedAboutCurrentYear = true;
            console.warn(
                '[CharacterViews] CharacterQueries.getCurrentYear ' +
                'is not available. Falling back to window.data.currentYear.'
            );
        }
        return new Date().getFullYear();
    }

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeHtml === 'function') {
            return DU.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeAttribute === 'function') {
            return DU.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // COLLAPSE STATE - sessionStorage-backed
    // ============================================================

    var COLLAPSE_STORAGE_KEY = 'characters_relationship_collapsed_v1';

    function readCollapseMap() {
        try {
            var raw = sessionStorage.getItem(COLLAPSE_STORAGE_KEY);
            if (!raw) { return {}; }
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch (e) {
            // Ignore.
        }
        return {};
    }

    function writeCollapseMap(map) {
        try {
            sessionStorage.setItem(
                COLLAPSE_STORAGE_KEY, JSON.stringify(map)
            );
        } catch (e) {
            // Ignore.
        }
    }

    function getGroupKey(charId, typeId) {
        return String(charId) + '|' + String(typeId);
    }

    function isGroupCollapsed(charId, typeId) {
        var map = readCollapseMap();
        return map[getGroupKey(charId, typeId)] === true;
    }

    function setGroupCollapsed(charId, typeId, collapsed) {
        var map = readCollapseMap();
        var key = getGroupKey(charId, typeId);
        if (collapsed) {
            map[key] = true;
        } else {
            delete map[key];
        }
        writeCollapseMap(map);
    }

    function toggleGroupCollapsed(charId, typeId) {
        var next = !isGroupCollapsed(charId, typeId);
        setGroupCollapsed(charId, typeId, next);
        return next;
    }

    function clearCollapseState() {
        try {
            sessionStorage.removeItem(COLLAPSE_STORAGE_KEY);
        } catch (e) {
            // Ignore.
        }
    }

    /**
     * Module-level listener: after a click on a group header, read
     * the resulting DOM state and persist it. Runs alongside the
     * delegated handler in character-events.js (which performs the
     * toggle). Installed once; idempotent.
     */
    function installCollapsePersistenceListener() {
        if (window.__characterViewsCollapseListener) { return; }
        window.__characterViewsCollapseListener = true;

        document.addEventListener('click', function(e) {
            var target = e.target;
            if (!target || typeof target.closest !== 'function') {
                return;
            }
            var header = target.closest('.relationship-group-header');
            if (!header) { return; }

            var group = header.closest('.relationship-group');
            if (!group) { return; }

            // The delegated handler in character-events.js runs
            // first (the container-level listener bubbles before
            // this document-level one). Read the resulting DOM
            // state on a microtask boundary so the toggle has
            // applied.
            setTimeout(function() {
                var body = group.querySelector(
                    '.relationship-group-body'
                );
                if (!body) { return; }

                var isCollapsed = body.style.display === 'none';

                var charId = group.dataset.charId || '';
                var typeId = group.dataset.type || '';

                if (charId && typeId) {
                    setGroupCollapsed(charId, typeId, isCollapsed);
                }
            }, 0);
        });
    }

    installCollapsePersistenceListener();

    // ============================================================
    // HELPERS - Relationship display
    // ============================================================

    function getCharacterName(charId) {
        var CQ = getCharacterQueries();
        if (!CQ || !charId) { return 'Unknown'; }
        var char = CQ.getCharacterById(charId);
        return char ? CQ.getDisplayName(char) : 'Unknown';
    }

    function getOtherCharacterId(relationship, charId) {
        if (!relationship || !charId) { return null; }
        var target = String(charId);
        if (String(relationship.character1) === target) {
            return relationship.character2;
        }
        if (String(relationship.character2) === target) {
            return relationship.character1;
        }
        return null;
    }

    function getDirectionGlyph(relationship, charId) {
        var SocialConstants = getSocialConstants();
        if (!SocialConstants ||
            typeof SocialConstants.isDirectional !== 'function') {
            return '\u2194\uFE0E';
        }
        if (!SocialConstants.isDirectional(relationship.typeId)) {
            return '\u2194\uFE0E';
        }
        if (String(relationship.character1) === String(charId)) {
            return '\u2192\uFE0E';
        }
        return '\u2190\uFE0E';
    }

    // ============================================================
    // RENDER - Social tab
    // ============================================================

    function renderCharacterSocial(char) {
        var container = document.getElementById('character-social-view');
        if (!container) { return; }

        container.textContent = '';

        if (!char || !char.id) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Select a character to view relationships.</p>';
            return;
        }

        var SocialQueries = getSocialQueries();
        var SocialConstants = getSocialConstants();

        if (!SocialQueries || !SocialConstants) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Social module not loaded.</p>';
            return;
        }

        var relationships = SocialQueries.getCharacterRelationships(char.id) || [];

        if (relationships.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No relationships recorded yet. Use <strong>+ Add Relationship</strong> to create one.</p>';
            return;
        }

        var byType = Object.create(null);
        relationships.forEach(function(rel) {
            if (!rel || !rel.typeId) { return; }
            if (!byType[rel.typeId]) {
                byType[rel.typeId] = [];
            }
            byType[rel.typeId].push(rel);
        });

        var typeIds = Object.keys(byType).sort(function(a, b) {
            var la = SocialConstants.getLabel(a) || a;
            var lb = SocialConstants.getLabel(b) || b;
            return la.localeCompare(lb);
        });

        var html = '<div class="relationship-groups" style="display:flex;flex-direction:column;gap:8px;">';

        typeIds.forEach(function(typeId) {
            html += renderTypeGroup(char.id, typeId, byType[typeId]);
        });

        html += '</div>';

        container.innerHTML = html;
    }

    function renderTypeGroup(charId, typeId, relationships) {
        var SocialConstants = getSocialConstants();
        var label = SocialConstants &&
            typeof SocialConstants.getLabel === 'function'
            ? SocialConstants.getLabel(typeId)
            : typeId;
        var color = SocialConstants &&
            typeof SocialConstants.getColor === 'function'
            ? SocialConstants.getColor(typeId)
            : 'var(--relationship-other)';

        var ongoing = [];
        var ended = [];
        relationships.forEach(function(rel) {
            if (rel &&
                rel.endYear !== undefined &&
                rel.endYear !== null &&
                String(rel.endYear).trim() !== '') {
                ended.push(rel);
            } else {
                ongoing.push(rel);
            }
        });

        var isCollapsed = isGroupCollapsed(charId, typeId);
        var caret = isCollapsed ? '\u25b8' : '\u25be';
        var bodyDisplay = isCollapsed ? 'none' : 'block';

        var count = relationships.length;

        var html = '';
        html += '<div class="relationship-group" ' +
                    'data-type="' + escapeAttribute(typeId) + '" ' +
                    'data-char-id="' + escapeAttribute(charId) + '" ' +
                    'style="background:var(--panel-alt);' +
                    'border:1px solid var(--border-soft);' +
                    'border-radius:6px;overflow:hidden;">';

        html += '<div class="relationship-group-header" ' +
                    'style="display:flex;align-items:center;gap:6px;' +
                    'padding:6px 10px;cursor:pointer;' +
                    'background:var(--panel);border-left:3px solid ' +
                    escapeAttribute(color) + ';">';
        html += '<span class="relationship-group-caret" ' +
                    'style="font-size:0.7rem;color:var(--text-dim);' +
                    'width:12px;display:inline-block;">' +
                    caret +
                '</span>';
        html += '<span style="font-size:0.75rem;font-weight:600;color:' +
                    escapeAttribute(color) + ';">' +
                    escapeHtml(label) +
                '</span>';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">(' +
                    count +
                ')</span>';
        html += '</div>';

        html += '<div class="relationship-group-body" ' +
                    'style="display:' + bodyDisplay + ';' +
                    'padding:6px 10px;">';

        if (ongoing.length > 0) {
            html += '<div class="relationship-subheader" ' +
                        'style="font-size:0.6rem;font-weight:600;' +
                        'color:var(--accent);text-transform:uppercase;' +
                        'letter-spacing:0.05em;padding:4px 0;' +
                        'border-bottom:1px solid var(--border-soft);' +
                        'margin-bottom:4px;">Ongoing</div>';
            ongoing.forEach(function(rel) {
                html += renderRelationshipRow(charId, rel, color);
            });
        }

        if (ended.length > 0) {
            html += '<div class="relationship-subheader" ' +
                        'style="font-size:0.6rem;font-weight:600;' +
                        'color:var(--text-dim);text-transform:uppercase;' +
                        'letter-spacing:0.05em;padding:4px 0 4px 0;' +
                        'border-bottom:1px solid var(--border-soft);' +
                        'margin-bottom:4px;margin-top:6px;">Ended</div>';
            ended.forEach(function(rel) {
                html += renderRelationshipRow(charId, rel, color);
            });
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderRelationshipRow(charId, rel, color) {
        var otherId = getOtherCharacterId(rel, charId);
        var otherName = getCharacterName(otherId);
        var arrow = getDirectionGlyph(rel, charId);

        var clar1 = rel.clarification1 !== undefined &&
            rel.clarification1 !== null
            ? String(rel.clarification1) : '';
        var clar2 = rel.clarification2 !== undefined &&
            rel.clarification2 !== null
            ? String(rel.clarification2) : '';
        if (!clar1 && !clar2 && rel.clarification) {
            clar1 = String(rel.clarification);
        }

        var viewerIsChar1 = String(rel.character1) === String(charId);
        var viewerClar = viewerIsChar1 ? clar1 : clar2;
        var otherClar = viewerIsChar1 ? clar2 : clar1;

        var clarDisplay = '';
        if (viewerClar && otherClar &&
            viewerClar.toLowerCase() !== otherClar.toLowerCase()) {
            clarDisplay = viewerClar + ' / ' + otherClar;
        } else if (viewerClar) {
            clarDisplay = viewerClar;
        } else if (otherClar) {
            clarDisplay = otherClar;
        }

        var startYear = rel.startYear ? String(rel.startYear) : '';
        var endYear = rel.endYear ? String(rel.endYear) : '';
        var periodDisplay = '';
        if (startYear && endYear) {
            periodDisplay = startYear + ' \u2013 ' + endYear;
        } else if (startYear) {
            periodDisplay = 'from ' + startYear;
        } else if (endYear) {
            periodDisplay = 'until ' + endYear;
        }

        var html = '';
        html += '<div class="relationship-row" ' +
                    'style="display:flex;align-items:center;gap:6px;' +
                    'padding:4px 0 4px 18px;font-size:0.72rem;">';

        html += '<span style="flex:1;display:flex;align-items:center;' +
                    'gap:6px;flex-wrap:wrap;">';
        html += '<span style="font-weight:600;">' +
                    escapeHtml(otherName) +
                '</span>';
        html += '<span style="color:var(--text-dim);font-size:0.9rem;">' +
                    arrow +
                '</span>';
        if (clarDisplay) {
            html += '<span style="color:' +
                        escapeAttribute(color) +
                        ';font-size:0.7rem;">' +
                        escapeHtml(clarDisplay) +
                    '</span>';
        }
        html += '</span>';

        if (periodDisplay) {
            html += '<span style="color:var(--text-dim);font-size:0.65rem;">' +
                        escapeHtml(periodDisplay) +
                    '</span>';
        }

        html += '<span style="display:flex;gap:4px;">';
        html += '<button type="button" ' +
                    'class="edit-char-relationship small" ' +
                    'data-rel-id="' + escapeAttribute(rel.id) + '" ' +
                    'style="font-size:0.55rem;padding:1px 6px;" ' +
                    'title="Edit">\u270e</button>';
        html += '<button type="button" ' +
                    'class="delete-char-relationship small danger" ' +
                    'data-rel-id="' + escapeAttribute(rel.id) + '" ' +
                    'style="font-size:0.55rem;padding:1px 6px;" ' +
                    'title="Delete">\u2715</button>';
        html += '</span>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER - Professional tab
    // ============================================================

    function renderCharacterProfessional(char) {
        var container = document.getElementById('professional-view');
        if (!container) { return; }

        container.textContent = '';

        if (!char || !char.id) { return; }

        var TeamQueries = getTeamQueries();
        if (!TeamQueries ||
            typeof TeamQueries.getTeamsForCharacterAllTime !== 'function') {
            container.innerHTML =
                '<p class="empty-state" ' +
                    'style="padding:8px;font-size:0.8rem;">' +
                    'Team module not loaded.' +
                '</p>' +
                renderProfessionalDepartmentsSection(char);
            return;
        }

        var teams = [];
        try {
            teams = TeamQueries.getTeamsForCharacterAllTime(
                char.id, 'professional'
            ) || [];
        } catch (e) {
            console.warn(
                '[CharacterViews] getTeamsForCharacterAllTime failed:',
                e
            );
            teams = [];
        }

        if (teams.length === 0) {
            container.innerHTML =
                '<div class="character-professional-teams">' +
                    '<div class="character-professional-teams-header" ' +
                            'style="font-size:0.75rem;color:var(--accent);' +
                            'font-weight:600;margin-bottom:6px;">' +
                        'Professional Teams' +
                    '</div>' +
                    '<p class="empty-state" ' +
                        'style="padding:4px;font-size:0.7rem;' +
                        'color:var(--text-dim);">' +
                        'Not a member of any professional team.' +
                    '</p>' +
                '</div>' +
                renderProfessionalDepartmentsSection(char);
            return;
        }

        var currentYear = null;
        var CQ = getCharacterQueries();
        if (CQ && typeof CQ.getCurrentYear === 'function') {
            var y = CQ.getCurrentYear();
            if (typeof y === 'number' && isFinite(y) && y > 0) {
                currentYear = Math.floor(y);
            }
        } else {
            var rawYear = getCurrentYear();
            if (typeof rawYear === 'number' && isFinite(rawYear) &&
                rawYear > 0) {
                currentYear = Math.floor(rawYear);
            }
        }

        var canSplit = currentYear !== null &&
            typeof TeamQueries.intervalContains === 'function';

        var activeRows = [];
        var upcomingRows = [];
        var formerRows = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }

            var member = null;
            try {
                member = TeamQueries.getCharacterTeamMembership(
                    team.id, char.id
                );
            } catch (e) {
                member = null;
            }
            if (!member) { continue; }

            var intervals = Array.isArray(member.intervals)
                ? member.intervals
                : [];

            if (intervals.length === 0) { continue; }

            for (var s = 0; s < intervals.length; s++) {
                var interval = intervals[s];
                if (!interval || typeof interval !== 'object') {
                    continue;
                }

                var row = buildProfessionalStintRow(
                    team, member, interval
                );

                var bucket = classifyStintBucket(
                    interval, currentYear, canSplit, TeamQueries
                );

                if (bucket === 'active') {
                    activeRows.push(row);
                } else if (bucket === 'upcoming') {
                    upcomingRows.push(row);
                } else if (bucket === 'former') {
                    formerRows.push(row);
                } else {
                    // Neither active, upcoming, nor former, OR the
                    // classification is unavailable. Fall into the
                    // Membership list so the row remains editable.
                    activeRows.push(row);
                }
            }
        }

        activeRows.sort(compareProfessionalRows);
        upcomingRows.sort(compareProfessionalRows);
        formerRows.sort(compareProfessionalRows);

        var html = '';
        html += '<div class="character-professional-teams">';

        html += '<div class="character-professional-teams-header" ' +
                    'style="font-size:0.75rem;color:var(--accent);' +
                    'font-weight:600;margin-bottom:6px;">' +
                    'Professional Teams' +
                '</div>';

        if (canSplit) {
            if (activeRows.length > 0) {
                html += renderProfessionalSubsection(
                    'Active', activeRows
                );
            }
            if (upcomingRows.length > 0) {
                html += renderProfessionalSubsection(
                    'Upcoming', upcomingRows
                );
            }
            if (formerRows.length > 0) {
                html += renderProfessionalSubsection(
                    'Former', formerRows
                );
            }
            if (activeRows.length === 0 &&
                upcomingRows.length === 0 &&
                formerRows.length === 0) {
                html += '<p class="empty-state" ' +
                            'style="padding:4px;font-size:0.7rem;' +
                            'color:var(--text-dim);">' +
                            'No current, upcoming, or former ' +
                            'professional team memberships.' +
                        '</p>';
            }
        } else {
            html += renderProfessionalSubsection(
                'Membership', activeRows
            );
        }

        html += '</div>';

        html += renderProfessionalDepartmentsSection(char);

        container.innerHTML = html;
    }

    /**
     * Classify a stint into 'active' | 'upcoming' | 'former' | null.
     * A null return means "not classifiable"; the caller falls into
     * the Membership list so the row remains visible.
     */
    function classifyStintBucket(
        interval, currentYear, canSplit, TeamQueries
    ) {
        if (!canSplit || currentYear === null) { return null; }

        var join = interval.joinPeriod === undefined ||
            interval.joinPeriod === null
            ? '' : String(interval.joinPeriod).trim();
        var leave = interval.leavePeriod === undefined ||
            interval.leavePeriod === null
            ? '' : String(interval.leavePeriod).trim();

        var joinNum = parseInt(join, 10);
        var leaveNum = parseInt(leave, 10);
        var hasJoin = join !== '' && !isNaN(joinNum);
        var hasLeave = leave !== '' && !isNaN(leaveNum);

        // Upcoming: starts strictly after the current year.
        if (hasJoin && joinNum > currentYear) {
            return 'upcoming';
        }

        // Former: ended strictly before the current year.
        if (hasLeave && leaveNum < currentYear) {
            return 'former';
        }

        // Active: current year within the window.
        if (hasJoin && joinNum <= currentYear) {
            if (!hasLeave || leaveNum >= currentYear) {
                return 'active';
            }
        }

        // Corrupt window (join > leave, malformed bounds): null.
        return null;
    }

    // ============================================================
    // RENDER - Departments sub-section
    // ============================================================

    function renderProfessionalDepartmentsSection(char) {
        var DQ = getDepartmentQueries();
        if (!DQ ||
            typeof DQ.getDepartmentsForCharacter !== 'function' ||
            typeof DQ.getMemberEntry !== 'function') {
            return '';
        }

        var currentYear = getCurrentYear();
        if (typeof currentYear !== 'number' ||
            !isFinite(currentYear) || currentYear < 1) {
            return '';
        }
        currentYear = Math.floor(currentYear);

        var departments = [];
        try {
            departments = DQ.getDepartmentsForCharacter(
                char.id, currentYear
            ) || [];
        } catch (e) {
            console.warn(
                '[CharacterViews] getDepartmentsForCharacter ' +
                'threw:', e
            );
            departments = [];
        }

        if (!Array.isArray(departments) ||
            departments.length === 0) {
            return '';
        }

        var rows = [];
        for (var i = 0; i < departments.length; i++) {
            var dept = departments[i];
            if (!dept || !dept.id) { continue; }

            var entry = null;
            try {
                entry = DQ.getMemberEntry(dept, char.id);
            } catch (e) {
                entry = null;
            }

            var joinYear = null;
            if (entry && Array.isArray(entry.intervals)) {
                for (var j = 0; j < entry.intervals.length; j++) {
                    var iv = entry.intervals[j];
                    if (!iv || typeof iv !== 'object') { continue; }
                    var y = parseInt(iv.joinPeriod, 10);
                    if (isNaN(y)) { continue; }
                    if (joinYear === null || y < joinYear) {
                        joinYear = y;
                    }
                }
            }

            var isHead = dept.headId &&
                String(dept.headId) === String(char.id);

            rows.push({
                name: isNonEmptyString(dept.name)
                    ? dept.name
                    : 'Unnamed Department',
                joinYear: joinYear,
                isHead: isHead
            });
        }

        if (rows.length === 0) { return ''; }

        rows.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        var html = '';
        html += '<div class="character-professional-departments" ' +
                    'style="margin-top:12px;">';

        html += '<div class="character-professional-departments-header" ' +
                    'style="font-size:0.75rem;color:var(--accent);' +
                    'font-weight:600;margin-bottom:6px;">' +
                    'Departments' +
                '</div>';

        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];

            html += '<div class="character-professional-department-row" ' +
                        'style="padding:4px 8px;background:var(--bg);' +
                        'border-radius:4px;border-left:3px solid ' +
                        'var(--info);margin-bottom:4px;' +
                        'font-size:0.72rem;display:flex;' +
                        'align-items:baseline;gap:6px;flex-wrap:wrap;">';

            html += '<span style="font-weight:600;">' +
                        escapeHtml(row.name) +
                    '</span>';

            if (row.isHead) {
                html += '<span style="color:var(--warning);' +
                            'font-size:0.65rem;font-style:italic;">' +
                            '(Head)' +
                        '</span>';
            }

            if (row.joinYear !== null) {
                html += '<span style="color:var(--text-dim);' +
                            'font-size:0.65rem;">Since ' +
                            escapeHtml(String(row.joinYear)) +
                        '</span>';
            }

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderProfessionalSubsection(heading, rows) {
        var html = '';
        html += '<div class="character-professional-teams-subsection" ' +
                    'style="margin-bottom:8px;">';
        html += '<div class="character-professional-teams-subheader" ' +
                    'style="font-size:0.6rem;font-weight:600;' +
                    'color:var(--text-dim);text-transform:uppercase;' +
                    'letter-spacing:0.05em;padding:4px 0;' +
                    'border-bottom:1px solid var(--border-soft);' +
                    'margin-bottom:4px;">' +
                    escapeHtml(heading) +
                '</div>';

        for (var i = 0; i < rows.length; i++) {
            html += rows[i].html;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // PROFESSIONAL STINT ROW
    // ============================================================

    function buildProfessionalStintRow(team, member, interval) {
        var teamName = isNonEmptyString(team.name)
            ? team.name
            : 'Unnamed Team';

        var role = isNonEmptyString(member && member.role)
            ? String(member.role).trim()
            : 'Member';

        var join = isNonEmptyString(interval.joinPeriod)
            ? String(interval.joinPeriod).trim()
            : '';
        var leave = isNonEmptyString(interval.leavePeriod)
            ? String(interval.leavePeriod).trim()
            : '';

        var periodDisplay = buildStintPeriodDisplay(join, leave);
        var isOpen = leave === '' && join !== '';

        var html = '';
        html += '<div class="character-professional-team-row" ' +
                    'data-team-id="' + escapeAttribute(team.id) + '" ' +
                    'data-join-period="' + escapeAttribute(join) + '" ' +
                    'data-leave-period="' + escapeAttribute(leave) + '" ' +
                    'style="padding:4px 8px;background:var(--bg);' +
                    'border-radius:4px;border-left:3px solid ' +
                    'var(--accent);margin-bottom:4px;' +
                    'font-size:0.72rem;display:flex;' +
                    'align-items:baseline;gap:6px;flex-wrap:wrap;">';

        html += '<span style="font-weight:600;">' +
                    escapeHtml(teamName) +
                '</span>';

        if (role && role !== 'Member') {
            html += '<span style="color:var(--info);font-size:0.65rem;' +
                        'font-style:italic;">(' +
                        escapeHtml(role) +
                    ')</span>';
        }

        if (periodDisplay) {
            html += '<span style="color:var(--text-dim);' +
                        'font-size:0.65rem;">' +
                        escapeHtml(periodDisplay) +
                    '</span>';
        }

        html += '<span style="flex:1;"></span>';

        html += buildStintActions(team, join, leave, isOpen);

        html += '</div>';

        return {
            sortKey: teamName + '|' + padYear(join),
            html: html
        };
    }

    function padYear(yearStr) {
        var n = parseInt(yearStr, 10);
        if (isNaN(n)) { return '0000'; }
        var s = String(n);
        while (s.length < 4) { s = '0' + s; }
        return s;
    }

    function buildStintActions(team, join, leave, isOpen) {
        var html = '';
        html += '<span class="stint-actions" ' +
                    'style="display:flex;gap:4px;align-items:center;">';

        // Actions require a join period. A row without one cannot
        // be addressed by TeamCore.endMemberInterval /
        // purgeMemberInterval, so the buttons are hidden.
        if (join === '') {
            html += '</span>';
            return html;
        }

        if (isOpen) {
            html += '<button type="button" ' +
                        'class="small secondary stint-end-btn" ' +
                        'data-action="end-professional-stint" ' +
                        'data-team-id="' + escapeAttribute(team.id) + '" ' +
                        'data-join-period="' +
                            escapeAttribute(join) + '" ' +
                        'title="Set a leave year for this stint">' +
                        'End' +
                    '</button>';
        }

        html += '<button type="button" ' +
                    'class="small danger stint-remove-btn" ' +
                    'data-action="remove-professional-stint" ' +
                    'data-team-id="' + escapeAttribute(team.id) + '" ' +
                    'data-join-period="' + escapeAttribute(join) + '" ' +
                    'title="Remove this stint">' +
                    '\u2715' +
                '</button>';

        html += '</span>';
        return html;
    }

    function buildStintPeriodDisplay(join, leave) {
        if (join && leave) {
            return join + ' \u2013 ' + leave;
        }
        if (join) {
            return 'From ' + join;
        }
        if (leave) {
            return 'Until ' + leave;
        }
        return '';
    }

    function compareProfessionalRows(a, b) {
        return a.sortKey.localeCompare(b.sortKey);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // GRAPH MODAL
    // ============================================================

    function buildGraphModalHTML() {
        var html = '';
        html += '<div id="character-graph-modal" class="modal hidden" style="display:none;">';
        html += '<div class="modal-content wide" style="max-width:900px;">';
        html += '<div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html += '<h3 style="margin:0;color:var(--accent);font-size:0.95rem;">Character Network</h3>';
        html += '<button type="button" id="close-char-graph-modal" class="close-modal" style="background:none;border:none;color:var(--text-dim);font-size:1.2rem;cursor:pointer;">\u00d7</button>';
        html += '</div>';
        html += '<div class="modal-body">';
        html += '<div id="character-graph-container" style="width:100%;height:500px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;position:relative;">';
        html += '<svg id="character-graph-svg" width="100%" height="100%" style="display:block;background:var(--bg);">';
        html += '<g id="character-graph-transform"></g>';
        html += '</svg>';
        html += '</div>';
        html += '<div id="character-graph-legend" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;padding:8px;background:var(--panel-alt);border-radius:var(--radius);border:1px solid var(--border);">';
        html += '<span style="font-size:0.7rem;color:var(--text-dim);font-weight:600;">Legend:</span>';
        html += '<span id="character-graph-legend-items"></span>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderCharacterGraph(charId) {
        var svg = document.getElementById('character-graph-svg');
        var transformGroup = document.getElementById('character-graph-transform');
        var container = document.getElementById('character-graph-container');
        if (!svg || !transformGroup || !container) { return; }

        var SocialQueries = getSocialQueries();
        var SocialConstants = getSocialConstants();
        var CQ = getCharacterQueries();
        if (!SocialQueries || !SocialConstants || !CQ) {
            transformGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-dim)" font-size="14">Dependencies not loaded</text>';
            return;
        }

        var relationships = SocialQueries.getCharacterRelationships(charId) || [];
        if (relationships.length === 0) {
            transformGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-dim)" font-size="14">No relationships to display</text>';
            renderGraphLegend([], null);
            return;
        }

        var nodeSet = Object.create(null);
        nodeSet[String(charId)] = true;
        relationships.forEach(function(rel) {
            if (!rel) { return; }
            nodeSet[String(rel.character1)] = true;
            nodeSet[String(rel.character2)] = true;
        });

        var nodeIds = Object.keys(nodeSet);
        if (nodeIds.length < 2) {
            transformGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-dim)" font-size="14">No connections yet</text>';
            renderGraphLegend([], charId);
            return;
        }

        var width = container.clientWidth || 800;
        var height = container.clientHeight || 500;
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        var centerX = width / 2;
        var centerY = height / 2;

        var others = nodeIds.filter(function(id) {
            return id !== String(charId);
        });
        var radius = Math.min(width, height) * 0.35;

        var positions = Object.create(null);
        positions[String(charId)] = { x: centerX, y: centerY };

        others.forEach(function(id, i) {
            var angle = (2 * Math.PI * i) / others.length - Math.PI / 2;
            positions[id] = {
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle)
            };
        });

        var html = '';

        relationships.forEach(function(rel) {
            if (!rel) { return; }
            var p1 = positions[String(rel.character1)];
            var p2 = positions[String(rel.character2)];
            if (!p1 || !p2) { return; }

            var color = SocialConstants.getColor(rel.typeId) ||
                'var(--relationship-other)';
            var isDir = SocialConstants.isDirectional(rel.typeId);

            html += '<line x1="' + p1.x + '" y1="' + p1.y + '" x2="' +
                p2.x + '" y2="' + p2.y + '" stroke="' +
                escapeAttribute(color) + '" stroke-width="2" ' +
                'opacity="0.6" />';

            if (isDir) {
                var dx = p2.x - p1.x;
                var dy = p2.y - p1.y;
                var dist = Math.sqrt(dx * dx + dy * dy) || 1;
                var angle = Math.atan2(dy, dx);
                var arrowSize = 9;
                var arrowDist = Math.max(0, dist - 22);
                var ratio = Math.min(1, arrowDist / dist);
                var ax = p1.x + (p2.x - p1.x) * ratio;
                var ay = p1.y + (p2.y - p1.y) * ratio;

                html += '<polygon points="' +
                    (ax + arrowSize * Math.cos(angle - 0.4)) + ',' +
                    (ay + arrowSize * Math.sin(angle - 0.4)) + ' ' +
                    (ax + arrowSize * Math.cos(angle + 0.4)) + ',' +
                    (ay + arrowSize * Math.sin(angle + 0.4)) + ' ' +
                    (ax + arrowSize * 1.4 * Math.cos(angle)) + ',' +
                    (ay + arrowSize * 1.4 * Math.sin(angle)) +
                    '" fill="' + escapeAttribute(color) +
                    '" opacity="0.8" />';
            }
        });

        nodeIds.forEach(function(id) {
            var pos = positions[id];
            if (!pos) { return; }
            var char = CQ.getCharacterById(id);
            var name = char ? CQ.getDisplayName(char) : 'Unknown';
            var isCenter = String(id) === String(charId);

            var connCount = 0;
            relationships.forEach(function(rel) {
                if (!rel) { return; }
                if (String(rel.character1) === id ||
                    String(rel.character2) === id) {
                    connCount++;
                }
            });

            var r = isCenter
                ? Math.max(28, Math.min(40, 28 + connCount * 2))
                : Math.max(20, Math.min(32, 20 + connCount * 2));

            var fill = isCenter
                ? 'var(--graph-node-accent-fill)'
                : 'var(--graph-node-info-fill)';
            var stroke = isCenter
                ? 'var(--graph-node-accent-stroke)'
                : 'var(--graph-node-info-stroke)';

            var label = name;
            if (label.length > 12) {
                var parts = label.split(' ');
                if (parts.length >= 2) {
                    var first = parts[0];
                    var last = parts[parts.length - 1];
                    label = (first.length > 6
                        ? first.charAt(0) + '. ' + last
                        : first + ' ' + last.charAt(0) + '.');
                } else {
                    label = label.substring(0, 10) + '...';
                }
            }

            html += '<circle cx="' + pos.x + '" cy="' + pos.y +
                '" r="' + (r + 3) + '" fill="rgba(0,0,0,0.3)" />';
            html += '<circle cx="' + pos.x + '" cy="' + pos.y +
                '" r="' + r + '" fill="' + fill + '" stroke="' +
                stroke + '" stroke-width="2" />';
            html += '<text x="' + pos.x + '" y="' + (pos.y + 4) +
                '" text-anchor="middle" fill="var(--text)" font-size="' +
                Math.max(9, r * 0.5) + '" font-weight="600" ' +
                'pointer-events="none">' + escapeHtml(label) +
                '</text>';
        });

        transformGroup.innerHTML = html;

        var usedTypeIds = Object.create(null);
        relationships.forEach(function(rel) {
            if (rel && rel.typeId) { usedTypeIds[rel.typeId] = true; }
        });
        renderGraphLegend(Object.keys(usedTypeIds), charId);
    }

    function renderGraphLegend(typeIds, charId) {
        var legendItems = document.getElementById(
            'character-graph-legend-items'
        );
        if (!legendItems) { return; }
        legendItems.textContent = '';

        var SocialConstants = getSocialConstants();
        if (!SocialConstants) { return; }

        typeIds.forEach(function(typeId) {
            var label = SocialConstants.getLabel(typeId);
            var color = SocialConstants.getColor(typeId);
            var isDir = SocialConstants.isDirectional(typeId);

            var span = document.createElement('span');
            span.style.cssText =
                'display:inline-flex;align-items:center;gap:4px;' +
                'margin-right:8px;font-size:0.7rem;';

            var swatch = document.createElement('span');
            swatch.style.cssText =
                'display:inline-block;width:12px;height:4px;' +
                'background:' + escapeAttribute(color) + ';' +
                'border-radius:2px;';
            span.appendChild(swatch);

            var text = document.createElement('span');
            text.textContent = label + (isDir ? ' \u2192\uFE0E' : '');
            span.appendChild(text);

            legendItems.appendChild(span);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterViews = Object.freeze({
        renderCharacterSocial: renderCharacterSocial,
        renderCharacterProfessional: renderCharacterProfessional,

        buildGraphModalHTML: buildGraphModalHTML,
        renderCharacterGraph: renderCharacterGraph,

        // Collapse state
        isGroupCollapsed: isGroupCollapsed,
        setGroupCollapsed: setGroupCollapsed,
        toggleGroupCollapsed: toggleGroupCollapsed,
        clearCollapseState: clearCollapseState
    });

})();
