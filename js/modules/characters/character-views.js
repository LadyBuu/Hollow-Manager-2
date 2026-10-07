/**
 * js/modules/characters/character-views.js - Character Views
 * Renders the Social tab and the Professional tab inside the
 * Character form.
 *
 * Path: js/modules/characters/character-views.js
 *
 * This module is responsible for:
 *   - Rendering the character's relationships grouped by type
 *   - Collapsible group sections (state kept per render session)
 *   - Ongoing / Ended subsections within each type
 *   - Inline directional arrows for directional relationship types
 *   - The character SVG network graph modal
 *   - Rendering the character's professional team memberships
 *     (Active / Former split), sourced from
 *     TeamQueries.getTeamsForCharacterAllTime
 *   - Rendering the character's department memberships as a
 *     sub-section of the Professional tab
 *
 * IMPORTANT:
 *   - RENDER ONLY - no data mutation
 *   - No direct window.data access - uses SocialQueries,
 *     TeamQueries, and DepartmentQueries
 *   - Uses SocialConstants for type definitions
 *   - Uses CharacterQueries for display names
 *   - Uses DomUtils for safe escaping
 *
 * RELATIONSHIP FORM OWNERSHIP (this revision):
 *   The character-tab relationship form has been RETIRED.
 *   buildRelationshipFormHTML and buildCharacterOptions used to
 *   live here and duplicated the standalone Social tab's form.
 *   That duplication was the source of a data-corruption bug:
 *   the local form called SocialCore.createRelationship with
 *   seven arguments while the core signature takes eight, so
 *   the notes text was landing in clarification2.
 *
 *   The character-tab Social section now opens the SAME modal the
 *   standalone tab opens, via SocialEvents.handleAddRelationship.
 *   See character-events.js openRelationshipModal for the
 *   delegation.
 *
 *   Do NOT reintroduce a relationship-form builder in this file.
 *   One form, one code path, one set of bugs to fix.
 *
 * PROFESSIONAL TEAMS PANEL:
 *   renderCharacterProfessional(char) renders into
 *   #professional-view.
 *
 *   DATA SOURCE:
 *     TeamQueries.getTeamsForCharacterAllTime(char.id, 'professional')
 *     returns every non-deprecated professional team the character
 *     has any member entry on, current or historical.
 *
 *   ACTIVE / FORMER SPLIT:
 *     The current display year (window.data.currentYear) is the
 *     reference point. A member entry is active if any of its
 *     intervals contains that year, and former if no interval
 *     contains it and at least one leavePeriod is strictly before
 *     it.
 *
 * DEPARTMENTS SUB-SECTION:
 *   renderProfessionalDepartmentsSection(char) appends a
 *   "Departments" block below the Professional Teams block on the
 *   same tab. It lists every department the character is an ACTIVE
 *   member of at the current application year, with:
 *     - the department name
 *     - the year they joined (earliest join period across the
 *       intervals that are still within range at the current year)
 *     - "(Head)" when they hold the head role
 *
 * GRAPH NODE COLORS:
 *   The character network graph renders into an SVG. Node colors
 *   are read from --graph-node-* tokens declared in
 *   css/shared.css, so they re-theme with the rest of the app.
 *   Do NOT reintroduce hex literals here.
 */

(function() {
    'use strict';

    if (window.__characterViewsLoaded) {
        return;
    }
    window.__characterViewsLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getSocialQueries() { return window.SocialQueries || null; }
    function getSocialConstants() { return window.SocialConstants || null; }
    function getSocialGraph() { return window.SocialGraph || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getDepartmentQueries() { return window.DepartmentQueries || null; }
    function getDomUtils() { return window.DomUtils || null; }

    // ============================================================
    // STATE - collapse state per (charId, typeId)
    // ============================================================

    var _collapsedGroups = Object.create(null);  // key = charId + '|' + typeId

    function getGroupKey(charId, typeId) {
        return String(charId) + '|' + String(typeId);
    }

    function isGroupCollapsed(charId, typeId) {
        return _collapsedGroups[getGroupKey(charId, typeId)] === true;
    }

    function setGroupCollapsed(charId, typeId, collapsed) {
        var key = getGroupKey(charId, typeId);
        if (collapsed) {
            _collapsedGroups[key] = true;
        } else {
            delete _collapsedGroups[key];
        }
    }

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
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
        var DomUtils = getDomUtils();
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
    // HELPERS - Relationship display
    // ============================================================

    function getCharacterName(charId) {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || !charId) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(charId);
        return char ? CharacterQueries.getDisplayName(char) : 'Unknown';
    }

    /**
     * Determine the "other" character in a relationship relative to the context char.
     */
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

    /**
     * Determine the direction glyph to show next to the other character.
     * - Undirected: ↔
     * - Directional: → if the context character is the source
     *                ← if the context character is the target
     */
    function getDirectionGlyph(relationship, charId) {
        var SocialConstants = getSocialConstants();
        if (!SocialConstants || typeof SocialConstants.isDirectional !== 'function') {
            return '↔';
        }
        if (!SocialConstants.isDirectional(relationship.typeId)) {
            return '↔';
        }
        if (String(relationship.character1) === String(charId)) {
            return '→';
        }
        return '←';
    }

    // ============================================================
    // RENDER - Social tab (main entry point for the Social tab)
    // ============================================================

    /**
     * Render the character's social relationships into #character-social-view.
     *
     * @param {object|null} char - Character object, or null for empty state
     */
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

        // ---- Group by type ----
        var byType = Object.create(null);
        relationships.forEach(function(rel) {
            if (!rel || !rel.typeId) { return; }
            if (!byType[rel.typeId]) {
                byType[rel.typeId] = [];
            }
            byType[rel.typeId].push(rel);
        });

        // ---- Sort types alphabetically by label ----
        var typeIds = Object.keys(byType).sort(function(a, b) {
            var la = SocialConstants.getLabel(a) || a;
            var lb = SocialConstants.getLabel(b) || b;
            return la.localeCompare(lb);
        });

        // ---- Build HTML ----
        var html = '<div class="relationship-groups" style="display:flex;flex-direction:column;gap:8px;">';

        typeIds.forEach(function(typeId) {
            html += renderTypeGroup(char.id, typeId, byType[typeId]);
        });

        html += '</div>';

        container.innerHTML = html;
    }

    /**
     * Render one relationship type group (collapsible).
     */
    function renderTypeGroup(charId, typeId, relationships) {
        var SocialConstants = getSocialConstants();
        var label = SocialConstants && typeof SocialConstants.getLabel === 'function'
            ? SocialConstants.getLabel(typeId)
            : typeId;
        var color = SocialConstants && typeof SocialConstants.getColor === 'function'
            ? SocialConstants.getColor(typeId)
            : '#7f8c8d';

        // Split into ongoing and ended
        var ongoing = [];
        var ended = [];
        relationships.forEach(function(rel) {
            if (rel && rel.endYear !== undefined && rel.endYear !== null && String(rel.endYear).trim() !== '') {
                ended.push(rel);
            } else {
                ongoing.push(rel);
            }
        });

        var isCollapsed = isGroupCollapsed(charId, typeId);
        var caret = isCollapsed ? '▸' : '▾';
        var bodyDisplay = isCollapsed ? 'none' : 'block';

        var count = relationships.length;

        var html = '';
        html += '<div class="relationship-group" data-type="' + escapeAttribute(typeId) + '" style="background:var(--panel-alt);border:1px solid var(--border-soft);border-radius:6px;overflow:hidden;">';

        // Header
        html += '<div class="relationship-group-header" style="display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;background:var(--panel);border-left:3px solid ' + escapeAttribute(color) + ';">';
        html += '<span class="relationship-group-caret" style="font-size:0.7rem;color:var(--text-dim);width:12px;display:inline-block;">' + caret + '</span>';
        html += '<span style="font-size:0.75rem;font-weight:600;color:' + escapeAttribute(color) + ';">' + escapeHtml(label) + '</span>';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">(' + count + ')</span>';
        html += '</div>';

        // Body
        html += '<div class="relationship-group-body" style="display:' + bodyDisplay + ';padding:6px 10px;">';

        if (ongoing.length > 0) {
            html += '<div class="relationship-subheader" style="font-size:0.6rem;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;padding:4px 0;border-bottom:1px solid var(--border-soft);margin-bottom:4px;">Ongoing</div>';
            ongoing.forEach(function(rel) {
                html += renderRelationshipRow(charId, rel, color);
            });
        }

        if (ended.length > 0) {
            html += '<div class="relationship-subheader" style="font-size:0.6rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;padding:4px 0 4px 0;border-bottom:1px solid var(--border-soft);margin-bottom:4px;margin-top:6px;">Ended</div>';
            ended.forEach(function(rel) {
                html += renderRelationshipRow(charId, rel, color);
            });
        }

        html += '</div>';  // body
        html += '</div>';  // group

        return html;
    }

    /**
     * Render a single relationship row.
     *
     * The row shows the OTHER character's name, a direction glyph
     * relative to the CURRENT character (the viewer), and the
     * clarification text.
     *
     * CLARIFICATION DISPLAY:
     *   Uses the same two-sided shape as the standalone tab, but
     *   oriented to this character. When the two clarifications
     *   differ, the row shows the CURRENT character's role toward
     *   the other side. That is the value the user cares about
     *   when viewing from one side.
     */
    function renderRelationshipRow(charId, rel, color) {
        var otherId = getOtherCharacterId(rel, charId);
        var otherName = getCharacterName(otherId);
        var arrow = getDirectionGlyph(rel, charId);

        // Pick the clarification text that describes THIS character's
        // role toward the other side.
        var clar1 = rel.clarification1 !== undefined && rel.clarification1 !== null
            ? String(rel.clarification1) : '';
        var clar2 = rel.clarification2 !== undefined && rel.clarification2 !== null
            ? String(rel.clarification2) : '';
        // Legacy fallback for old records that carry only `clarification`.
        if (!clar1 && !clar2 && rel.clarification) {
            clar1 = String(rel.clarification);
        }

        var viewerIsChar1 = String(rel.character1) === String(charId);
        var viewerClar = viewerIsChar1 ? clar1 : clar2;
        var otherClar = viewerIsChar1 ? clar2 : clar1;

        var clarDisplay = '';
        if (viewerClar && otherClar && viewerClar.toLowerCase() !== otherClar.toLowerCase()) {
            clarDisplay = viewerClar + ' / ' + otherClar;
        } else if (viewerClar) {
            clarDisplay = viewerClar;
        } else if (otherClar) {
            clarDisplay = otherClar;
        }

        // Period display
        var startYear = rel.startYear ? String(rel.startYear) : '';
        var endYear = rel.endYear ? String(rel.endYear) : '';
        var periodDisplay = '';
        if (startYear && endYear) {
            periodDisplay = startYear + ' – ' + endYear;
        } else if (startYear) {
            periodDisplay = 'from ' + startYear;
        } else if (endYear) {
            periodDisplay = 'until ' + endYear;
        }

        var html = '';
        html += '<div class="relationship-row" style="display:flex;align-items:center;gap:6px;padding:4px 0 4px 18px;font-size:0.72rem;">';

        // Other character + arrow + clarification
        html += '<span style="flex:1;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">';
        html += '<span style="font-weight:600;">' + escapeHtml(otherName) + '</span>';
        html += '<span style="color:var(--text-dim);font-size:0.9rem;">' + arrow + '</span>';
        if (clarDisplay) {
            html += '<span style="color:' + escapeAttribute(color) + ';font-size:0.7rem;">' + escapeHtml(clarDisplay) + '</span>';
        }
        html += '</span>';

        // Period
        if (periodDisplay) {
            html += '<span style="color:var(--text-dim);font-size:0.65rem;">' + escapeHtml(periodDisplay) + '</span>';
        }

        // Actions
        html += '<span style="display:flex;gap:4px;">';
        html += '<button type="button" class="edit-char-relationship small" data-rel-id="' + escapeAttribute(rel.id) + '" style="font-size:0.55rem;padding:1px 6px;" title="Edit">✎</button>';
        html += '<button type="button" class="delete-char-relationship small danger" data-rel-id="' + escapeAttribute(rel.id) + '" style="font-size:0.55rem;padding:1px 6px;" title="Delete">✕</button>';
        html += '</span>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER - Professional tab
    // ============================================================

    /**
     * Render the character's professional team memberships into
     * #professional-view.
     */
    function renderCharacterProfessional(char) {
        var container = document.getElementById('professional-view');
        if (!container) { return; }

        container.textContent = '';

        if (!char || !char.id) {
            return;
        }

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
                char.id,
                'professional'
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

        // ---- Resolve the reference year for the Active/Former split. ----
        var currentYear = null;
        if (window.data &&
            typeof window.data.currentYear === 'number' &&
            isFinite(window.data.currentYear) &&
            window.data.currentYear > 0) {
            currentYear = Math.floor(window.data.currentYear);
        }

        var canSplit = currentYear !== null &&
            typeof TeamQueries.isMemberActive === 'function' &&
            typeof TeamQueries.isMemberFormer === 'function';

        var activeRows = [];
        var formerRows = [];

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }

            var member = null;
            try {
                member = TeamQueries.getTeamMember(team, char.id);
            } catch (e) {
                member = null;
            }
            if (!member) { continue; }

            var row = buildProfessionalTeamRow(team, member);

            if (canSplit) {
                var isActive = false;
                var isFormer = false;
                try {
                    isActive = TeamQueries.isMemberActive(
                        member, currentYear
                    ) === true;
                } catch (e) {
                    isActive = false;
                }
                try {
                    isFormer = TeamQueries.isMemberFormer(
                        member, currentYear
                    ) === true;
                } catch (e) {
                    isFormer = false;
                }

                if (isActive) {
                    activeRows.push(row);
                } else if (isFormer) {
                    formerRows.push(row);
                }
            } else {
                activeRows.push(row);
            }
        }

        activeRows.sort(compareProfessionalRows);
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
            if (formerRows.length > 0) {
                html += renderProfessionalSubsection(
                    'Former', formerRows
                );
            }
            if (activeRows.length === 0 && formerRows.length === 0) {
                html += '<p class="empty-state" ' +
                            'style="padding:4px;font-size:0.7rem;' +
                            'color:var(--text-dim);">' +
                            'No current or former professional team ' +
                            'memberships.' +
                        '</p>';
            }
        } else {
            html += renderProfessionalSubsection(
                'Membership', activeRows
            );
        }

        html += '</div>';

        // ---- Departments sub-section ----
        html += renderProfessionalDepartmentsSection(char);

        container.innerHTML = html;
    }

    // ============================================================
    // RENDER - Professional tab, departments sub-section
    // ============================================================

    function renderProfessionalDepartmentsSection(char) {
        var DQ = getDepartmentQueries();
        if (!DQ ||
            typeof DQ.getDepartmentsForCharacter !== 'function' ||
            typeof DQ.getMemberEntry !== 'function') {
            return '';
        }

        var currentYear = null;
        if (window.data &&
            typeof window.data.currentYear === 'number' &&
            isFinite(window.data.currentYear) &&
            window.data.currentYear > 0) {
            currentYear = Math.floor(window.data.currentYear);
        }
        if (currentYear === null) { return ''; }

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

    function buildProfessionalTeamRow(team, member) {
        var teamName = team.name || 'Unnamed Team';
        var role = member.role || 'Member';
        var periodDisplay = buildMemberPeriodDisplay(member);

        var html = '';
        html += '<div class="character-professional-team-row" ' +
                    'data-team-id="' + escapeAttribute(team.id) + '" ' +
                    'style="padding:4px 8px;background:var(--bg);' +
                    'border-radius:4px;border-left:3px solid ' +
                    'var(--accent);margin-bottom:4px;' +
                    'font-size:0.72rem;display:flex;' +
                    'align-items:baseline;gap:6px;flex-wrap:wrap;">';

        html += '<span style="font-weight:600;">' +
                    escapeHtml(teamName) +
                '</span>';

        if (isNonEmptyString(role) && role !== 'Member') {
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

        html += '</div>';

        return {
            sortKey: teamName,
            html: html
        };
    }

    function compareProfessionalRows(a, b) {
        return a.sortKey.localeCompare(b.sortKey);
    }

    function buildMemberPeriodDisplay(member) {
        if (!member || !Array.isArray(member.intervals) ||
            member.intervals.length === 0) {
            return '';
        }

        var parts = [];
        for (var i = 0; i < member.intervals.length; i++) {
            var iv = member.intervals[i];
            if (!iv || typeof iv !== 'object') { continue; }

            var join = isNonEmptyString(iv.joinPeriod)
                ? String(iv.joinPeriod).trim()
                : '';
            var leave = isNonEmptyString(iv.leavePeriod)
                ? String(iv.leavePeriod).trim()
                : '';

            if (join && leave) {
                parts.push(join + ' \u2013 ' + leave);
            } else if (join) {
                parts.push('From ' + join);
            } else if (leave) {
                parts.push('Until ' + leave);
            }
        }

        return parts.join('; ');
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // GRAPH MODAL
    // ============================================================

    /**
     * Build the graph modal shell HTML.
     * Returned as a single root element string.
     */
    function buildGraphModalHTML() {
        var html = '';
        html += '<div id="character-graph-modal" class="modal hidden" style="display:none;">';
        html += '<div class="modal-content wide" style="max-width:900px;">';
        html += '<div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html += '<h3 style="margin:0;color:var(--accent);font-size:0.95rem;">Character Network</h3>';
        html += '<button type="button" id="close-char-graph-modal" class="close-modal" style="background:none;border:none;color:var(--text-dim);font-size:1.2rem;cursor:pointer;">×</button>';
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

    /**
     * Render the character's network graph.
     *
     * NODE COLORS:
     *   Node fill and stroke are read from the --graph-node-* tokens
     *   declared in css/shared.css. Those tokens have dark and light
     *   variants. Do NOT inline hex literals here.
     */
    function renderCharacterGraph(charId) {
        var svg = document.getElementById('character-graph-svg');
        var transformGroup = document.getElementById('character-graph-transform');
        var container = document.getElementById('character-graph-container');
        if (!svg || !transformGroup || !container) { return; }

        var SocialQueries = getSocialQueries();
        var SocialConstants = getSocialConstants();
        var CharacterQueries = getCharacterQueries();
        if (!SocialQueries || !SocialConstants || !CharacterQueries) {
            transformGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-dim)" font-size="14">Dependencies not loaded</text>';
            return;
        }

        var relationships = SocialQueries.getCharacterRelationships(charId) || [];
        if (relationships.length === 0) {
            transformGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-dim)" font-size="14">No relationships to display</text>';
            renderGraphLegend([], null);
            return;
        }

        // ---- Build node set (this char + everyone connected to them) ----
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

        // ---- Compute positions on a circle ----
        var width = container.clientWidth || 800;
        var height = container.clientHeight || 500;
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);

        var centerX = width / 2;
        var centerY = height / 2;

        var others = nodeIds.filter(function(id) { return id !== String(charId); });
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

        // ---- Build SVG content ----
        var html = '';

        // Edges
        relationships.forEach(function(rel) {
            if (!rel) { return; }
            var p1 = positions[String(rel.character1)];
            var p2 = positions[String(rel.character2)];
            if (!p1 || !p2) { return; }

            var color = SocialConstants.getColor(rel.typeId) || '#7f8c8d';
            var isDir = SocialConstants.isDirectional(rel.typeId);

            html += '<line x1="' + p1.x + '" y1="' + p1.y + '" x2="' + p2.x + '" y2="' + p2.y + '" stroke="' + escapeAttribute(color) + '" stroke-width="2" opacity="0.6" />';

            // Directional arrowhead
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
                    (ax + arrowSize * Math.cos(angle - 0.4)) + ',' + (ay + arrowSize * Math.sin(angle - 0.4)) + ' ' +
                    (ax + arrowSize * Math.cos(angle + 0.4)) + ',' + (ay + arrowSize * Math.sin(angle + 0.4)) + ' ' +
                    (ax + arrowSize * 1.4 * Math.cos(angle)) + ',' + (ay + arrowSize * 1.4 * Math.sin(angle)) +
                    '" fill="' + escapeAttribute(color) + '" opacity="0.8" />';
            }
        });

        // Nodes
        nodeIds.forEach(function(id) {
            var pos = positions[id];
            if (!pos) { return; }
            var char = CharacterQueries.getCharacterById(id);
            var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
            var isCenter = String(id) === String(charId);

            // Count connections
            var connCount = 0;
            relationships.forEach(function(rel) {
                if (!rel) { return; }
                if (String(rel.character1) === id || String(rel.character2) === id) {
                    connCount++;
                }
            });

            var r = isCenter
                ? Math.max(28, Math.min(40, 28 + connCount * 2))
                : Math.max(20, Math.min(32, 20 + connCount * 2));

            // Node colors come from theme tokens.
            var fill = isCenter
                ? 'var(--graph-node-accent-fill)'
                : 'var(--graph-node-info-fill)';
            var stroke = isCenter
                ? 'var(--graph-node-accent-stroke)'
                : 'var(--graph-node-info-stroke)';

            // Short label
            var label = name;
            if (label.length > 12) {
                var parts = label.split(' ');
                if (parts.length >= 2) {
                    var first = parts[0];
                    var last = parts[parts.length - 1];
                    label = (first.length > 6 ? first.charAt(0) + '. ' + last : first + ' ' + last.charAt(0) + '.');
                } else {
                    label = label.substring(0, 10) + '...';
                }
            }

            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + (r + 3) + '" fill="rgba(0,0,0,0.3)" />';
            html += '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="' + r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2" />';
            html += '<text x="' + pos.x + '" y="' + (pos.y + 4) + '" text-anchor="middle" fill="var(--text)" font-size="' + Math.max(9, r * 0.5) + '" font-weight="600" pointer-events="none">' + escapeHtml(label) + '</text>';
        });

        transformGroup.innerHTML = html;

        // ---- Legend ----
        var usedTypeIds = Object.create(null);
        relationships.forEach(function(rel) {
            if (rel && rel.typeId) { usedTypeIds[rel.typeId] = true; }
        });
        renderGraphLegend(Object.keys(usedTypeIds), charId);
    }

    function renderGraphLegend(typeIds, charId) {
        var legendItems = document.getElementById('character-graph-legend-items');
        if (!legendItems) { return; }
        legendItems.textContent = '';

        var SocialConstants = getSocialConstants();
        if (!SocialConstants) { return; }

        typeIds.forEach(function(typeId) {
            var label = SocialConstants.getLabel(typeId);
            var color = SocialConstants.getColor(typeId);
            var isDir = SocialConstants.isDirectional(typeId);

            var span = document.createElement('span');
            span.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:0.7rem;';

            var swatch = document.createElement('span');
            swatch.style.cssText = 'display:inline-block;width:12px;height:4px;background:' + color + ';border-radius:2px;';
            span.appendChild(swatch);

            var text = document.createElement('span');
            text.textContent = label + (isDir ? ' →' : '');
            span.appendChild(text);

            legendItems.appendChild(span);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterViews = {
        // Social tab
        renderCharacterSocial: renderCharacterSocial,

        // Professional tab
        renderCharacterProfessional: renderCharacterProfessional,

        // Graph modal
        buildGraphModalHTML: buildGraphModalHTML,
        renderCharacterGraph: renderCharacterGraph,

        // Utilities (exposed for testing)
        clearCollapseState: function() {
            _collapsedGroups = Object.create(null);
        }
    };

})();
