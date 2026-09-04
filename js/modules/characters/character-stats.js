/**
 * modules/characters/character-stats.js - Character Stats & Magic System
 * Domain logic for stats, magic, class suggestions, and special moves
 * Path: js/modules/characters/character-stats.js
 * 
 * This module handles:
 *   - Physical stats calculation and validation
 *   - Magic proficiency calculation and validation
 *   - Class suggestion algorithm
 *   - Magic class suggestion algorithm
 *   - Magic power calculation
 *   - Special moves CRUD (with full mutation pipeline)
 * 
 * IMPORTANT:
 *   - DOMAIN LOGIC ONLY - no rendering (see character-stats-view.js)
 *   - All MUTATIONS follow VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI
 *   - Special moves use the full mutation pipeline with rollback
 *   - All mutation APIs accept characterId, not live character objects
 *   - Uses CharacterConstants for all definitions (single source of truth)
 *   - Uses MutationUtils for backup and persistence
 *   - Uses CharacterQueries for character data and display names
 *   - Uses NotificationSystem for notifications
 *   - Uses ActivityLog for activity logging
 *   - Validation DOES NOT mutate state - snapshot taken BEFORE any repair
 *   - Malformed data is REJECTED, not silently repaired during validation
 *   - Repair operations are explicit and performed AFTER snapshot
 * 
 * MUTATION INVARIANT:
 *   1. Validate inputs and state (READ-ONLY - no mutation)
 *   2. Snapshot (required, abort if fails)
 *   3. Repair/normalise state (ONLY AFTER snapshot)
 *   4. Apply mutation
 *   5. Persist via saveWithPromise()
 *   6. Log activity (failure-safe)
 *   7. On persistence failure, restore backup
 * 
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.MutationUtils (from mutation-utils.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.ActivityLog (from activity-log.js) - MANDATORY
 *   - window.getCurrentEditId (from index.js) - MANDATORY
 *   - window.saveData (from database.js) - MANDATORY
 * 
 * USAGE:
 *   var stats = window.CharacterStats;
 *   var result = stats.addSpecialMove(charId, 'physical', 'Flurry Strike');
 *   var suggestion = stats.suggestClass({ str: 16, dex: 14, ... });
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterStatsLoaded) {
        return;
    }
    window.__characterStatsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CharacterConstants = window.CharacterConstants;
    var CharacterQueries = window.CharacterQueries;
    var MutationUtils = window.MutationUtils;
    var NotificationSystem = window.NotificationSystem;
    var ActivityLog = window.ActivityLog;

    // ============================================================
    // CONSTANTS - From CharacterConstants (MANDATORY)
    // ============================================================

    // Stats
    var STAT_KEYS = CharacterConstants.STAT_KEYS;
    var STAT_MIN = CharacterConstants.STAT_MIN;
    var STAT_MAX = CharacterConstants.STAT_MAX;
    var STAT_DEFAULT = CharacterConstants.STAT_DEFAULT;
    var STAT_DEFINITIONS = CharacterConstants.STAT_DEFINITIONS;

    // Magic
    var MAGIC_MAX = CharacterConstants.MAGIC_MAX;
    var MAGIC_TYPES = CharacterConstants.MAGIC_TYPES;
    var MAGIC_CATEGORIES = CharacterConstants.MAGIC_CATEGORIES;
    var MAGIC_TYPE_KEYS = CharacterConstants.MAGIC_TYPE_KEYS;
    var BALANCED_MAGE_THRESHOLD = CharacterConstants.BALANCED_MAGE_THRESHOLD;
    var MAGIC_CATEGORY_MULTIPLIERS = CharacterConstants.MAGIC_CATEGORY_MULTIPLIERS;
    var MAGIC_CLASS_MAP = CharacterConstants.MAGIC_CLASS_MAP;
    var MAGIC_POWER_THRESHOLDS = CharacterConstants.MAGIC_POWER_THRESHOLDS;

    // Classes
    var CLASS_DEFINITIONS = CharacterConstants.CLASS_DEFINITIONS;

    // Special moves
    var MAX_SPECIAL_MOVES = CharacterConstants.MAX_SPECIAL_MOVES;
    var MAX_MOVE_NAME_LENGTH = CharacterConstants.MAX_MOVE_NAME_LENGTH;
    var MAX_MOVE_DESCRIPTION_LENGTH = CharacterConstants.MAX_MOVE_DESCRIPTION_LENGTH;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // CharacterConstants is MANDATORY
        if (!CharacterConstants) {
            missing.push('CharacterConstants');
        }

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        // MutationUtils is MANDATORY
        if (!MutationUtils || typeof MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }
        if (!MutationUtils || typeof MutationUtils.saveWithPromise !== 'function') {
            missing.push('MutationUtils.saveWithPromise');
        }

        // NotificationSystem is MANDATORY
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        // ActivityLog is MANDATORY
        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // getCurrentEditId is MANDATORY
        if (typeof window.getCurrentEditId !== 'function') {
            missing.push('getCurrentEditId');
        }

        // saveData is MANDATORY
        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (missing.length > 0) {
            console.warn('CharacterStats: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // SAFE BACKUP - Delegates to MutationUtils
    // ============================================================

    function createSafeBackup(data) {
        return MutationUtils.createSafeBackup(data);
    }

    // ============================================================
    // SAFE RENDER HELPERS (minimal, for refresh only)
    // ============================================================

    function safeRenderCharacterList() {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            try { window.CharacterList.render(); } catch (e) { /* Ignore */ }
        }
    }

    function safeShowCharacterForm(id) {
        if (typeof window.showCharacterForm === 'function') {
            try { window.showCharacterForm(id); } catch (e) { /* Ignore */ }
        }
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            try { window.updateDashboardStats(); } catch (e) { /* Ignore */ }
        }
    }

    function getCurrentEditId() {
        return window.getCurrentEditId();
    }

    // ============================================================
    // STAT FUNCTIONS
    // ============================================================

    function getDefaultStats() {
        return { str: STAT_DEFAULT, dex: STAT_DEFAULT, con: STAT_DEFAULT, int: STAT_DEFAULT, wis: STAT_DEFAULT, cha: STAT_DEFAULT };
    }

    function clampStat(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) return STAT_DEFAULT;
        return Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(num)));
    }

    /**
     * Get a character's stats with defaults for missing values.
     * Missing/corrupt values become STAT_DEFAULT.
     */
    function getCharacterStats(char) {
        if (!char) return getDefaultStats();
        if (!char.stats || typeof char.stats !== 'object') {
            return getDefaultStats();
        }
        var stats = char.stats;
        var result = {};
        STAT_KEYS.forEach(function(key) {
            var val = stats[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = clampStat(val);
            } else {
                result[key] = STAT_DEFAULT;
            }
        });
        return result;
    }

    function getAbilityModifier(score) {
        var value = clampStat(score);
        return Math.floor((value - 10) / 2);
    }

    function getModifierDisplay(score) {
        var mod = getAbilityModifier(score);
        return (mod >= 0 ? '+' : '') + mod;
    }

    // ============================================================
    // CLASS SUGGESTION
    // ============================================================

    function suggestClass(stats) {
        if (!stats) return null;

        var scores = {};
        STAT_KEYS.forEach(function(key) {
            scores[key] = clampStat(stats[key]);
        });

        var bestClass = null;
        var bestScore = -Infinity;
        var bestPriority = -Infinity;

        CLASS_DEFINITIONS.forEach(function(cls) {
            var meetsMin = true;
            for (var stat in cls.minStats) {
                if (Object.prototype.hasOwnProperty.call(cls.minStats, stat)) {
                    if ((scores[stat] || 0) < cls.minStats[stat]) {
                        meetsMin = false;
                        break;
                    }
                }
            }

            if (!meetsMin) return;

            var total = 0;
            var totalWeight = 0;
            for (var stat in cls.statWeights) {
                if (Object.prototype.hasOwnProperty.call(cls.statWeights, stat)) {
                    var weight = cls.statWeights[stat] || 0;
                    var score = scores[stat] || STAT_DEFAULT;
                    total += (score - 10) * weight;
                    totalWeight += weight;
                }
            }

            var normalized = totalWeight > 0 ? total / totalWeight : 0;

            var primaryBonus = 0;
            cls.primaryStats.forEach(function(stat) {
                primaryBonus += (scores[stat] - 10) * 0.1;
            });

            var finalScore = normalized + primaryBonus;
            var priority = cls.priority || 0;

            if (finalScore > bestScore ||
                (finalScore === bestScore && priority > bestPriority)) {
                bestScore = finalScore;
                bestPriority = priority;
                bestClass = cls;
            }
        });

        return bestClass;
    }

    // ============================================================
    // MAGIC FUNCTIONS
    // ============================================================

    function getDefaultMagicProficiencies() {
        var proficiencies = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            proficiencies[key] = 0;
        });
        return proficiencies;
    }

    function clampMagic(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) return 0;
        return Math.max(0, Math.min(MAGIC_MAX, Math.round(num)));
    }

    function getCharacterMagic(char) {
        if (!char) return getDefaultMagicProficiencies();
        if (!char.magic || typeof char.magic !== 'object') {
            return getDefaultMagicProficiencies();
        }
        var magic = char.magic;
        var result = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            var val = magic[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = clampMagic(val);
            } else {
                result[key] = 0;
            }
        });
        return result;
    }

    // ============================================================
    // MAGIC POWER CALCULATION
    // ============================================================

    function calculateMagicPower(char) {
        var magic = getCharacterMagic(char);
        if (!magic) return 0;

        var categoryStats = {
            'elemental': { total: 0, max: 0, count: 0, types: [] },
            'body': { total: 0, max: 0, count: 0, types: [] },
            'aether': { total: 0, max: 0, count: 0, types: [] }
        };

        MAGIC_TYPE_KEYS.forEach(function(key) {
            var typeInfo = MAGIC_TYPES[key];
            if (!typeInfo) return;
            var category = typeInfo.category;
            var value = magic[key] || 0;

            if (categoryStats[category]) {
                categoryStats[category].total += value;
                categoryStats[category].max = Math.max(categoryStats[category].max, value);
                categoryStats[category].count++;
                categoryStats[category].types.push({ key: key, value: value });
            }
        });

        var totalScore = 0;
        var totalWeight = 0;

        for (var cat in categoryStats) {
            if (!Object.prototype.hasOwnProperty.call(categoryStats, cat)) continue;
            var stats = categoryStats[cat];
            if (stats.count === 0) continue;

            var multiplier = MAGIC_CATEGORY_MULTIPLIERS[cat] || 1.0;
            var avg = stats.total / stats.count;
            var maxVal = stats.max;

            // Specialisation bonus
            var specializationBonus = 0;
            if (maxVal >= 8) {
                specializationBonus = (maxVal - 7) * 2.5;
            } else if (maxVal >= 5) {
                specializationBonus = (maxVal - 4) * 1.5;
            } else if (maxVal >= 3) {
                specializationBonus = (maxVal - 2) * 0.8;
            }

            // Balanced mage bonus
            var balancedBonus = 0;
            var allAboveThreshold = true;
            stats.types.forEach(function(t) {
                if (t.value < BALANCED_MAGE_THRESHOLD) allAboveThreshold = false;
            });
            if (allAboveThreshold && stats.count >= 3) {
                balancedBonus = avg * 0.3;
            }

            var categoryScore = (avg * multiplier) + specializationBonus + balancedBonus;
            var weight = 1 + (stats.total / 20);

            totalScore += categoryScore * weight;
            totalWeight += weight;
        }

        var rawScore = totalWeight > 0 ? totalScore / totalWeight : 0;
        var scaledScore = Math.min(100, Math.round(rawScore * 5));

        // Master bonus
        var hasMaster = false;
        MAGIC_TYPE_KEYS.forEach(function(key) {
            if ((magic[key] || 0) >= 9) hasMaster = true;
        });
        if (hasMaster) {
            scaledScore = Math.min(100, scaledScore + 10);
        }

        return Math.max(0, scaledScore);
    }

    /**
     * Get magic rank based on power score.
     * Returns: 'Archmage', 'Master', 'Adept', 'Apprentice', 'Novice', 'Untrained'
     */
    function getMagicRank(power) {
        var thresholds = MAGIC_POWER_THRESHOLDS;
        if (power >= thresholds.ARCHMAGE) return 'Archmage';
        if (power >= thresholds.MASTER) return 'Master';
        if (power >= thresholds.ADEPT) return 'Adept';
        if (power >= thresholds.APPRENTICE) return 'Apprentice';
        if (power >= thresholds.NOVICE) return 'Novice';
        return 'Untrained';
    }

    /**
     * Get magic level label (presentation helper).
     * Returns a human-readable label for the power score.
     */
    function getMagicLevelLabel(score) {
        if (score >= 9) return 'Master';
        if (score >= 7) return 'Expert';
        if (score >= 5) return 'Adept';
        if (score >= 3) return 'Apprentice';
        if (score >= 1) return 'Novice';
        return 'Untrained';
    }

    /**
     * Get magic level color (presentation helper).
     * Returns a CSS color variable.
     * NOTE: This is presentation logic - consider moving to CharacterStatsView
     * if this module becomes too large.
     */
    function getMagicLevelColor(score) {
        if (score >= 9) return 'var(--danger)';
        if (score >= 7) return 'var(--warning)';
        if (score >= 5) return 'var(--accent)';
        if (score >= 3) return 'var(--info)';
        if (score >= 1) return 'var(--text-dim)';
        return 'var(--border)';
    }

    // ============================================================
    // MAGIC CLASS SUGGESTION
    // ============================================================

    function isBalancedCategory(magic, category) {
        var types = getMagicCategoryTypes(category);
        for (var i = 0; i < types.length; i++) {
            if ((magic[types[i]] || 0) < BALANCED_MAGE_THRESHOLD) {
                return false;
            }
        }
        return true;
    }

    function suggestMagicClass(char) {
        var magic = getCharacterMagic(char);
        var totalPower = 0;
        MAGIC_TYPE_KEYS.forEach(function(key) {
            totalPower += magic[key] || 0;
        });

        if (totalPower <= 0) {
            return null;
        }

        var categoryScores = { elemental: 0, body: 0, aether: 0 };

        for (var key in MAGIC_TYPES) {
            if (!Object.prototype.hasOwnProperty.call(MAGIC_TYPES, key)) continue;
            var type = MAGIC_TYPES[key];
            var score = magic[key] || 0;
            if (categoryScores[type.category] !== undefined) {
                categoryScores[type.category] += score;
            }
        }

        var balancedCategories = [];
        for (var cat in MAGIC_CATEGORIES) {
            if (Object.prototype.hasOwnProperty.call(MAGIC_CATEGORIES, cat)) {
                if (isBalancedCategory(magic, cat)) {
                    balancedCategories.push(cat);
                }
            }
        }

        if (balancedCategories.length >= 2) {
            var maxBalancedScore = 0;
            for (var i = 0; i < balancedCategories.length; i++) {
                var score = categoryScores[balancedCategories[i]] || 0;
                if (score > maxBalancedScore) {
                    maxBalancedScore = score;
                }
            }
            return {
                name: 'Balanced Mage',
                category: null,
                categoryLabel: null,
                primaryType: null,
                primaryLabel: null,
                score: maxBalancedScore,
                isBalanced: true
            };
        }

        var highestCategory = 'elemental';
        var highestScore = -1;
        for (var cat in categoryScores) {
            if (Object.prototype.hasOwnProperty.call(categoryScores, cat)) {
                if (categoryScores[cat] > highestScore) {
                    highestScore = categoryScores[cat];
                    highestCategory = cat;
                }
            }
        }

        var highestType = null;
        var highestTypeScore = -1;
        for (var key in magic) {
            if (!Object.prototype.hasOwnProperty.call(magic, key)) continue;
            if (MAGIC_TYPES[key].category !== highestCategory) continue;
            if (magic[key] > highestTypeScore) {
                highestTypeScore = magic[key];
                highestType = key;
            }
        }

        var className = 'Adept Mage';
        if (highestType && MAGIC_CLASS_MAP[highestCategory] && MAGIC_CLASS_MAP[highestCategory][highestType]) {
            className = MAGIC_CLASS_MAP[highestCategory][highestType];
        } else if (highestCategory === 'elemental') {
            className = 'Elementalist';
        } else if (highestCategory === 'body') {
            className = 'Body Mage';
        } else if (highestCategory === 'aether') {
            className = 'Aether Mage';
        }

        return {
            name: className,
            category: highestCategory,
            categoryLabel: MAGIC_CATEGORIES[highestCategory] ? MAGIC_CATEGORIES[highestCategory].label : highestCategory,
            primaryType: highestType,
            primaryLabel: highestType ? MAGIC_TYPES[highestType] ? MAGIC_TYPES[highestType].label : null : null,
            score: highestTypeScore,
            isBalanced: false
        };
    }

    // ============================================================
    // MAGIC TYPE HELPERS (delegate to constants)
    // ============================================================

    function getMagicTypeKeys() {
        if (CharacterConstants && typeof CharacterConstants.getMagicTypeKeys === 'function') {
            return CharacterConstants.getMagicTypeKeys();
        }
        return MAGIC_TYPE_KEYS.slice();
    }

    function getMagicCategoryTypes(category) {
        if (CharacterConstants && typeof CharacterConstants.getMagicCategoryTypes === 'function') {
            return CharacterConstants.getMagicCategoryTypes(category);
        }
        var cat = MAGIC_CATEGORIES[category];
        return cat ? cat.types.slice() : [];
    }

    // ============================================================
    // SPECIAL MOVES - Internal validation helpers
    // ============================================================

    /**
     * Validate that a special moves structure is valid.
     * Returns { valid: boolean, errors: string[] }
     * This is a PURE validation function - does NOT mutate state.
     */
    function validateSpecialMovesStructure(char) {
        var errors = [];

        if (!char) {
            errors.push('Character is required.');
            return { valid: false, errors: errors };
        }

        if (!char.specialMoves || typeof char.specialMoves !== 'object' || Array.isArray(char.specialMoves)) {
            errors.push('Special moves data is missing or malformed.');
            return { valid: false, errors: errors };
        }

        if (!Array.isArray(char.specialMoves.physical)) {
            errors.push('Physical moves must be an array.');
        }

        if (!Array.isArray(char.specialMoves.magical)) {
            errors.push('Magical moves must be an array.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    /**
     * Validate a move index.
     * Returns { valid: boolean, error: string }
     */
    function validateMoveIndex(char, type, index) {
        if (type !== 'physical' && type !== 'magical') {
            return { valid: false, error: 'Invalid move type. Must be "physical" or "magical".' };
        }

        var moves = char.specialMoves && char.specialMoves[type];
        if (!Array.isArray(moves)) {
            return { valid: false, error: 'No ' + type + ' moves found.' };
        }

        var idx = Number(index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= moves.length) {
            return { valid: false, error: 'Move not found at index ' + index + '.' };
        }

        return { valid: true, error: null, moves: moves, move: moves[idx] };
    }

    /**
     * Get a character for mutation (with validation).
     * Returns { ok: boolean, error: string, char: object }
     */
    function getCharacterForMutation(charId) {
        if (!charId) {
            return { ok: false, error: 'Character ID is required.' };
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return { ok: false, error: 'Character not found.' };
        }

        return { ok: true, char: char };
    }

    /**
     * Get the live character for mutation after snapshot.
     * This is used inside the mutation pipeline.
     */
    function getLiveCharacter(charId, data) {
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
        return data.characters.find(function(c) {
            return c && String(c.id) === String(charId);
        });
    }

    // ============================================================
    // SPECIAL MOVES - Full mutation pipeline with save
    // ============================================================

    function getSpecialMoves(char) {
        if (!char) return { physical: [], magical: [] };
        if (!char.specialMoves || typeof char.specialMoves !== 'object') {
            return { physical: [], magical: [] };
        }
        var physical = Array.isArray(char.specialMoves.physical)
            ? char.specialMoves.physical.map(function(move) {
                return {
                    name: move && typeof move.name === 'string' ? move.name : '',
                    description: move && typeof move.description === 'string' ? move.description : ''
                };
            })
            : [];
        var magical = Array.isArray(char.specialMoves.magical)
            ? char.specialMoves.magical.map(function(move) {
                return {
                    name: move && typeof move.name === 'string' ? move.name : '',
                    description: move && typeof move.description === 'string' ? move.description : ''
                };
            })
            : [];
        return { physical: physical, magical: magical };
    }

    /**
     * Add a special move to a character.
     * Uses full mutation pipeline with save.
     * API: accepts characterId, not live object.
     * 
     * MUTATION FLOW:
     *   1. VALIDATE: Validate inputs and character state (READ-ONLY)
     *   2. SNAPSHOT: Create backup (required, abort if fails)
     *   3. MUTATE: Apply changes to live state
     *   4. PERSIST: Save via saveWithPromise()
     *   5. LOG: Record activity (failure-safe)
     *   6. UI COMMIT: Refresh UI
     *   7. ROLLBACK: On failure, restore backup
     */
    function addSpecialMove(charId, type, name, description) {
        // ---- PHASE 1: VALIDATE INPUTS (READ-ONLY - NO MUTATION) ----
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        if (!charId) {
            showNotification('Character ID is required.', 'error');
            return Promise.resolve(false);
        }

        if (type !== 'physical' && type !== 'magical') {
            showNotification('Invalid move type.', 'error');
            return Promise.resolve(false);
        }

        if (!name || typeof name !== 'string' || name.trim() === '') {
            showNotification('Move name is required.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 1a: VALIDATE CHARACTER (READ-ONLY) ----
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 1b: VALIDATE MOVE LIMITS (READ-ONLY) ----
        var structureValidation = validateSpecialMovesStructure(char);
        if (!structureValidation.valid) {
            showNotification('Special moves data is corrupted: ' + structureValidation.errors.join(', '), 'error');
            return Promise.resolve(false);
        }

        var moves = char.specialMoves[type] || [];
        if (moves.length >= MAX_SPECIAL_MOVES) {
            showNotification('Maximum of ' + MAX_SPECIAL_MOVES + ' ' + type + ' moves reached.', 'error');
            return Promise.resolve(false);
        }

        var nameTruncated = name.trim().slice(0, MAX_MOVE_NAME_LENGTH);
        var descTruncated = typeof description === 'string'
            ? description.trim().slice(0, MAX_MOVE_DESCRIPTION_LENGTH)
            : '';

        // ---- PHASE 2: SNAPSHOT (Required, abort if fails) ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely add move. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 3: MUTATE (Live state - after snapshot) ----
        var currentChar = getLiveCharacter(charId, data);
        if (!currentChar) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        // Repair malformed structure (ONLY after snapshot)
        if (!currentChar.specialMoves || typeof currentChar.specialMoves !== 'object' || Array.isArray(currentChar.specialMoves)) {
            currentChar.specialMoves = { physical: [], magical: [] };
        }

        if (!Array.isArray(currentChar.specialMoves.physical)) {
            currentChar.specialMoves.physical = [];
        }

        if (!Array.isArray(currentChar.specialMoves.magical)) {
            currentChar.specialMoves.magical = [];
        }

        // Add the move
        currentChar.specialMoves[type].push({
            name: nameTruncated,
            description: descTruncated
        });

        // ---- PHASE 4: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 5: LOG (failure-safe) ----
                try {
                    if (ActivityLog && typeof ActivityLog.record === 'function') {
                        var charName = CharacterQueries.getDisplayName(currentChar);
                        ActivityLog.record('Added ' + type + ' move "' + nameTruncated + '" to ' + charName);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 6: UI COMMIT ----
                if (window.CharacterStatsView && typeof window.CharacterStatsView.renderSpecialMoves === 'function') {
                    window.CharacterStatsView.renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
                }

                showNotification(type.charAt(0).toUpperCase() + type.slice(1) + ' move added!', 'success');
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 7: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    safeRenderCharacterList();
                    safeShowCharacterForm(charId);
                }
                showNotification('Failed to add move. Please try again.', 'error');
                return false;
            });
    }

    /**
     * Update a special move.
     * Uses full mutation pipeline with save.
     * API: accepts characterId, not live object.
     */
    function updateSpecialMove(charId, type, index, name, description) {
        // ---- PHASE 1: VALIDATE INPUTS (READ-ONLY - NO MUTATION) ----
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        if (!charId) {
            showNotification('Character ID is required.', 'error');
            return Promise.resolve(false);
        }

        if (type !== 'physical' && type !== 'magical') {
            showNotification('Invalid move type.', 'error');
            return Promise.resolve(false);
        }

        var idx = Number(index);
        if (!Number.isInteger(idx) || idx < 0) {
            showNotification('Invalid move index.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 1a: VALIDATE CHARACTER (READ-ONLY) ----
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        var structureValidation = validateSpecialMovesStructure(char);
        if (!structureValidation.valid) {
            showNotification('Special moves data is corrupted: ' + structureValidation.errors.join(', '), 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 1b: VALIDATE MOVE EXISTS (READ-ONLY) ----
        var moves = char.specialMoves[type] || [];
        if (!Array.isArray(moves)) {
            showNotification('No ' + type + ' moves found.', 'error');
            return Promise.resolve(false);
        }

        if (idx < 0 || idx >= moves.length) {
            showNotification('Move not found.', 'error');
            return Promise.resolve(false);
        }

        var move = moves[idx];
        var newName = name !== undefined && name !== null ? String(name).trim() : move.name;
        var newDesc = description !== undefined ? String(description).trim() : move.description;

        if (!newName) {
            showNotification('Move name is required.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: SNAPSHOT (Required, abort if fails) ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely update move. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 3: MUTATE (Live state - after snapshot) ----
        var currentChar = getLiveCharacter(charId, data);
        if (!currentChar) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        if (!currentChar.specialMoves || typeof currentChar.specialMoves !== 'object') {
            currentChar.specialMoves = { physical: [], magical: [] };
        }

        if (!Array.isArray(currentChar.specialMoves.physical)) {
            currentChar.specialMoves.physical = [];
        }

        if (!Array.isArray(currentChar.specialMoves.magical)) {
            currentChar.specialMoves.magical = [];
        }

        if (!currentChar.specialMoves[type] || !Array.isArray(currentChar.specialMoves[type])) {
            showNotification('No ' + type + ' moves found.', 'error');
            return Promise.resolve(false);
        }

        if (idx < 0 || idx >= currentChar.specialMoves[type].length) {
            showNotification('Move not found.', 'error');
            return Promise.resolve(false);
        }

        currentChar.specialMoves[type][idx] = {
            name: newName.slice(0, MAX_MOVE_NAME_LENGTH),
            description: newDesc.slice(0, MAX_MOVE_DESCRIPTION_LENGTH)
        };

        // ---- PHASE 4: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 5: LOG (failure-safe) ----
                try {
                    if (ActivityLog && typeof ActivityLog.record === 'function') {
                        var charName = CharacterQueries.getDisplayName(currentChar);
                        ActivityLog.record('Updated ' + type + ' move on ' + charName);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 6: UI COMMIT ----
                if (window.CharacterStatsView && typeof window.CharacterStatsView.renderSpecialMoves === 'function') {
                    window.CharacterStatsView.renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
                }

                showNotification(type.charAt(0).toUpperCase() + type.slice(1) + ' move updated!', 'success');
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 7: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    safeRenderCharacterList();
                    safeShowCharacterForm(charId);
                }
                showNotification('Failed to update move. Please try again.', 'error');
                return false;
            });
    }

    /**
     * Remove a special move.
     * Uses full mutation pipeline with save.
     * API: accepts characterId, not live object.
     */
    function removeSpecialMove(charId, type, index) {
        // ---- PHASE 1: VALIDATE INPUTS (READ-ONLY - NO MUTATION) ----
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        if (!charId) {
            showNotification('Character ID is required.', 'error');
            return Promise.resolve(false);
        }

        if (type !== 'physical' && type !== 'magical') {
            showNotification('Invalid move type.', 'error');
            return Promise.resolve(false);
        }

        var idx = Number(index);
        if (!Number.isInteger(idx) || idx < 0) {
            showNotification('Invalid move index.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 1a: VALIDATE CHARACTER (READ-ONLY) ----
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        var structureValidation = validateSpecialMovesStructure(char);
        if (!structureValidation.valid) {
            showNotification('Special moves data is corrupted: ' + structureValidation.errors.join(', '), 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 1b: VALIDATE MOVE EXISTS (READ-ONLY) ----
        var moves = char.specialMoves[type] || [];
        if (!Array.isArray(moves)) {
            showNotification('No ' + type + ' moves found.', 'error');
            return Promise.resolve(false);
        }

        if (idx < 0 || idx >= moves.length) {
            showNotification('Move not found.', 'error');
            return Promise.resolve(false);
        }

        var move = moves[idx];
        var moveName = move && move.name ? move.name : 'Unnamed move';

        // NOTE: Confirmation is a UI concern, but this module handles it for now.
        // This will be moved to the UI/controller layer in a future refactor.
        // Do NOT add new confirmation dialogs here - use CharacterEvents instead.
        if (!confirm('Remove "' + moveName + '" from ' + type + ' moves?')) {
            return Promise.resolve(false);
        }

        // ---- PHASE 2: SNAPSHOT (Required, abort if fails) ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely remove move. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 3: MUTATE (Live state - after snapshot) ----
        var currentChar = getLiveCharacter(charId, data);
        if (!currentChar) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        if (!currentChar.specialMoves || typeof currentChar.specialMoves !== 'object') {
            currentChar.specialMoves = { physical: [], magical: [] };
        }

        if (!Array.isArray(currentChar.specialMoves.physical)) {
            currentChar.specialMoves.physical = [];
        }

        if (!Array.isArray(currentChar.specialMoves.magical)) {
            currentChar.specialMoves.magical = [];
        }

        if (!currentChar.specialMoves[type] || !Array.isArray(currentChar.specialMoves[type])) {
            showNotification('No ' + type + ' moves found.', 'error');
            return Promise.resolve(false);
        }

        if (idx < 0 || idx >= currentChar.specialMoves[type].length) {
            showNotification('Move not found.', 'error');
            return Promise.resolve(false);
        }

        currentChar.specialMoves[type].splice(idx, 1);

        // ---- PHASE 4: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 5: LOG (failure-safe) ----
                try {
                    if (ActivityLog && typeof ActivityLog.record === 'function') {
                        var charName = CharacterQueries.getDisplayName(currentChar);
                        ActivityLog.record('Removed ' + type + ' move "' + moveName + '" from ' + charName);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 6: UI COMMIT ----
                if (window.CharacterStatsView && typeof window.CharacterStatsView.renderSpecialMoves === 'function') {
                    window.CharacterStatsView.renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
                }

                showNotification(type.charAt(0).toUpperCase() + type.slice(1) + ' move removed.', 'success');
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 7: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    safeRenderCharacterList();
                    safeShowCharacterForm(charId);
                }
                showNotification('Failed to remove move. Please try again.', 'error');
                return false;
            });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStats = {
        // Constants (read-only, from CharacterConstants)
        MAGIC_TYPES: MAGIC_TYPES,
        MAGIC_CATEGORIES: MAGIC_CATEGORIES,
        MAGIC_MAX: MAGIC_MAX,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        BALANCED_MAGE_THRESHOLD: BALANCED_MAGE_THRESHOLD,
        MAGIC_CATEGORY_MULTIPLIERS: MAGIC_CATEGORY_MULTIPLIERS,
        MAGIC_POWER_THRESHOLDS: MAGIC_POWER_THRESHOLDS,

        // Magic type helpers
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicCategoryTypes: getMagicCategoryTypes,

        // Stats
        getDefaultStats: getDefaultStats,
        getCharacterStats: getCharacterStats,
        getAbilityModifier: getAbilityModifier,
        getModifierDisplay: getModifierDisplay,

        // Class suggestion
        suggestClass: suggestClass,

        // Magic
        getDefaultMagicProficiencies: getDefaultMagicProficiencies,
        getCharacterMagic: getCharacterMagic,
        calculateMagicPower: calculateMagicPower,
        getMagicRank: getMagicRank,
        getMagicLevelLabel: getMagicLevelLabel,
        getMagicLevelColor: getMagicLevelColor,
        suggestMagicClass: suggestMagicClass,

        // Special moves - ID-based APIs with save
        getSpecialMoves: getSpecialMoves,
        addSpecialMove: addSpecialMove,
        updateSpecialMove: updateSpecialMove,
        removeSpecialMove: removeSpecialMove
    };

})();
