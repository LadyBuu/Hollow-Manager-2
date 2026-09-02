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
 * 
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js)
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.CoreUtils (from core-utils.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterStatsLoaded) {
        return;
    }
    window.__characterStatsLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = [
            'getCharacterById',
            'getDisplayName',
            'getCurrentEditId',
            'saveData'
        ];

        required.forEach(function(name) {
            if (name === 'saveData' && typeof window.saveData !== 'function') {
                missing.push('saveData');
            } else if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (!window.CharacterConstants) {
            missing.push('CharacterConstants');
        }

        if (!window.MutationUtils || typeof window.MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }

        if (!window.CoreUtils || typeof window.CoreUtils.deepClone !== 'function') {
            missing.push('CoreUtils.deepClone');
        }

        if (missing.length > 0) {
            console.warn('CharacterStats: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // CONSTANTS - From CharacterConstants
    // ============================================================

    var MAGIC_MAX = window.CharacterConstants ? window.CharacterConstants.MAGIC_MAX : 10;
    var STAT_MIN = window.CharacterConstants ? window.CharacterConstants.STAT_MIN : 1;
    var STAT_MAX = window.CharacterConstants ? window.CharacterConstants.STAT_MAX : 50;
    var MAX_SPECIAL_MOVES = window.CharacterConstants ? window.CharacterConstants.MAX_SPECIAL_MOVES : 20;
    var MAX_MOVE_NAME_LENGTH = window.CharacterConstants ? window.CharacterConstants.MAX_MOVE_NAME_LENGTH : 100;
    var MAX_MOVE_DESCRIPTION_LENGTH = window.CharacterConstants ? window.CharacterConstants.MAX_MOVE_DESCRIPTION_LENGTH : 500;
    var BALANCED_MAGE_THRESHOLD = window.CharacterConstants ? window.CharacterConstants.BALANCED_MAGE_THRESHOLD : 3;

    var MAGIC_TYPES = window.CharacterConstants ? window.CharacterConstants.MAGIC_TYPES : {};
    var MAGIC_TYPE_KEYS = window.CharacterConstants ? window.CharacterConstants.MAGIC_TYPE_KEYS : [];
    var MAGIC_CATEGORIES = window.CharacterConstants ? window.CharacterConstants.MAGIC_CATEGORIES : {};
    var STAT_DEFINITIONS = window.CharacterConstants ? window.CharacterConstants.STAT_DEFINITIONS : {};
    var STAT_KEYS = window.CharacterConstants ? window.CharacterConstants.STAT_KEYS : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var CLASS_DEFINITIONS = window.CharacterConstants ? window.CharacterConstants.CLASS_DEFINITIONS : [];

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (window.NotificationSystem && typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type);
            return;
        }

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // SAFE BACKUP - Delegate to MutationUtils
    // ============================================================

    function createSafeBackup(data) {
        if (window.MutationUtils && typeof window.MutationUtils.createSafeBackup === 'function') {
            return window.MutationUtils.createSafeBackup(data);
        }

        try {
            if (window.db && typeof window.db.createSafeCopy === 'function') {
                return window.db.createSafeCopy(data);
            }
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
            return JSON.parse(JSON.stringify(data));
        } catch (err) {
            console.warn('CharacterStats: Failed to create backup:', err);
            return null;
        }
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
        if (typeof window.getCurrentEditId === 'function') {
            return window.getCurrentEditId();
        }
        return null;
    }

    // ============================================================
    // STAT FUNCTIONS
    // ============================================================

    function getDefaultStats() {
        return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    }

    function clampStat(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) return 10;
        return Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(num)));
    }

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
                result[key] = 10;
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

    function generateRandomStats() {
        return {
            str: Math.floor(Math.random() * 13) + 6,
            dex: Math.floor(Math.random() * 13) + 6,
            con: Math.floor(Math.random() * 13) + 6,
            int: Math.floor(Math.random() * 13) + 6,
            wis: Math.floor(Math.random() * 13) + 6,
            cha: Math.floor(Math.random() * 13) + 6
        };
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
                if ((scores[stat] || 0) < cls.minStats[stat]) {
                    meetsMin = false;
                    break;
                }
            }

            if (!meetsMin) return;

            var total = 0;
            var totalWeight = 0;
            for (var stat in cls.statWeights) {
                var weight = cls.statWeights[stat] || 0;
                var score = scores[stat] || 10;
                total += (score - 10) * weight;
                totalWeight += weight;
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

        var categoryMultipliers = {
            'elemental': 1.0,
            'body': 1.2,
            'aether': 1.5
        };

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
            var stats = categoryStats[cat];
            if (stats.count === 0) continue;

            var multiplier = categoryMultipliers[cat] || 1.0;
            var avg = stats.total / stats.count;
            var maxVal = stats.max;

            var specializationBonus = 0;
            if (maxVal >= 8) {
                specializationBonus = (maxVal - 7) * 2.5;
            } else if (maxVal >= 5) {
                specializationBonus = (maxVal - 4) * 1.5;
            } else if (maxVal >= 3) {
                specializationBonus = (maxVal - 2) * 0.8;
            }

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

        var hasMaster = false;
        MAGIC_TYPE_KEYS.forEach(function(key) {
            if ((magic[key] || 0) >= 9) hasMaster = true;
        });
        if (hasMaster) {
            scaledScore = Math.min(100, scaledScore + 10);
        }

        return Math.max(0, scaledScore);
    }

    function getMagicPowerDisplay(char) {
        var power = calculateMagicPower(char);
        
        var stars = '';
        var starCount = 0;
        if (power >= 90) starCount = 5;
        else if (power >= 70) starCount = 4;
        else if (power >= 50) starCount = 3;
        else if (power >= 30) starCount = 2;
        else if (power >= 10) starCount = 1;
        else starCount = 0;

        for (var i = 0; i < 5; i++) {
            stars += i < starCount ? '★' : '☆';
        }

        var rank = '';
        if (power >= 90) rank = 'Archmage';
        else if (power >= 70) rank = 'Master';
        else if (power >= 50) rank = 'Adept';
        else if (power >= 30) rank = 'Apprentice';
        else if (power >= 10) rank = 'Novice';
        else rank = 'Untrained';

        return stars + ' (' + power + '/100) - ' + rank;
    }

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
            var type = MAGIC_TYPES[key];
            var score = magic[key] || 0;
            if (categoryScores[type.category] !== undefined) {
                categoryScores[type.category] += score;
            }
        }

        var balancedCategories = [];
        for (var cat in MAGIC_CATEGORIES) {
            if (isBalancedCategory(magic, cat)) {
                balancedCategories.push(cat);
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
            if (categoryScores[cat] > highestScore) {
                highestScore = categoryScores[cat];
                highestCategory = cat;
            }
        }

        var highestType = null;
        var highestTypeScore = -1;
        for (var key in magic) {
            if (MAGIC_TYPES[key].category !== highestCategory) continue;
            if (magic[key] > highestTypeScore) {
                highestTypeScore = magic[key];
                highestType = key;
            }
        }

        var classMap = {
            elemental: {
                earth: 'Geomancer',
                water: 'Hydromancer',
                fire: 'Pyromancer',
                air: 'Aeromancer',
                metal: 'Ferromancer',
                wood: 'Dendromancer'
            },
            body: {
                blood: 'Hemomancer',
                bone: 'Osteomancer',
                mind: 'Psychomancer',
                morphic: 'Morphomancer',
                life: 'Vitalmancer',
                death: 'Necromancer'
            },
            aether: {
                space: 'Spatiomancer',
                time: 'Chronomancer',
                dimension: 'Dimensionist',
                void: 'Voidmancer',
                reality: 'Reality Weaver',
                transference: 'Transference Mage'
            }
        };

        var className = 'Adept Mage';
        if (highestType && classMap[highestCategory] && classMap[highestCategory][highestType]) {
            className = classMap[highestCategory][highestType];
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

    function getMagicLevelLabel(score) {
        if (score >= 9) return 'Master';
        if (score >= 7) return 'Expert';
        if (score >= 5) return 'Adept';
        if (score >= 3) return 'Apprentice';
        if (score >= 1) return 'Novice';
        return 'Untrained';
    }

    function getMagicLevelColor(score) {
        if (score >= 9) return 'var(--danger)';
        if (score >= 7) return 'var(--warning)';
        if (score >= 5) return 'var(--accent)';
        if (score >= 3) return 'var(--info)';
        if (score >= 1) return 'var(--text-dim)';
        return 'var(--border)';
    }

    function generateRandomMagicCategory(category) {
        if (!MAGIC_CATEGORIES[category]) {
            return {};
        }
        var categoryTypes = getMagicCategoryTypes(category);
        var magic = {};
        categoryTypes.forEach(function(key) {
            var roll = Math.random();
            if (roll < 0.3) {
                magic[key] = 0;
            } else if (roll < 0.6) {
                magic[key] = Math.floor(Math.random() * 3) + 1;
            } else if (roll < 0.85) {
                magic[key] = Math.floor(Math.random() * 3) + 4;
            } else {
                magic[key] = Math.floor(Math.random() * 3) + 7;
            }
        });
        return magic;
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
     */
    function addSpecialMove(charId, type, name, description) {
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

        // ---- PHASE 1: VALIDATE CHARACTER ----
        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: VALIDATE MOVE LIMITS ----
        if (!char.specialMoves || typeof char.specialMoves !== 'object' || Array.isArray(char.specialMoves)) {
            char.specialMoves = { physical: [], magical: [] };
        }

        if (!Array.isArray(char.specialMoves.physical)) {
            char.specialMoves.physical = [];
        }

        if (!Array.isArray(char.specialMoves.magical)) {
            char.specialMoves.magical = [];
        }

        if (char.specialMoves[type].length >= MAX_SPECIAL_MOVES) {
            showNotification('Maximum of ' + MAX_SPECIAL_MOVES + ' ' + type + ' moves reached.', 'error');
            return Promise.resolve(false);
        }

        var nameTruncated = name.trim().slice(0, MAX_MOVE_NAME_LENGTH);
        var descTruncated = typeof description === 'string'
            ? description.trim().slice(0, MAX_MOVE_DESCRIPTION_LENGTH)
            : '';

        // ---- PHASE 3: SNAPSHOT ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely add move. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 4: MUTATE ----
        var currentChar = data.characters.find(function(c) {
            return c && String(c.id) === String(charId);
        });

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

        currentChar.specialMoves[type].push({
            name: nameTruncated,
            description: descTruncated
        });

        // ---- PHASE 5: PERSIST ----
        var savePromise;
        if (window.MutationUtils && typeof window.MutationUtils.saveWithPromise === 'function') {
            savePromise = window.MutationUtils.saveWithPromise();
        } else {
            savePromise = Promise.resolve().then(function() { return window.saveData(); });
        }

        return savePromise
            .then(function() {
                // LOG - failure-safe
                try {
                    if (typeof window.logActivity === 'function') {
                        var charName = typeof window.getDisplayName === 'function'
                            ? window.getDisplayName(currentChar)
                            : currentChar.firstName || 'Character';
                        window.logActivity('Added ' + type + ' move "' + nameTruncated + '" to ' + charName);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // UI COMMIT - re-render moves
                if (window.CharacterStatsView && typeof window.CharacterStatsView.renderSpecialMoves === 'function') {
                    window.CharacterStatsView.renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
                }

                showNotification(type.charAt(0).toUpperCase() + type.slice(1) + ' move added!', 'success');
                return true;
            })
            .catch(function(err) {
                // ROLLBACK
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

        // ---- PHASE 1: VALIDATE CHARACTER ----
        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        if (!char.specialMoves || typeof char.specialMoves !== 'object') {
            showNotification('No special moves found.', 'error');
            return Promise.resolve(false);
        }

        if (!Array.isArray(char.specialMoves.physical) || !Array.isArray(char.specialMoves.magical)) {
            showNotification('Special moves data is corrupted.', 'error');
            return Promise.resolve(false);
        }

        if (!char.specialMoves[type] || !Array.isArray(char.specialMoves[type])) {
            showNotification('No ' + type + ' moves found.', 'error');
            return Promise.resolve(false);
        }

        if (idx < 0 || idx >= char.specialMoves[type].length) {
            showNotification('Move not found.', 'error');
            return Promise.resolve(false);
        }

        var move = char.specialMoves[type][idx];
        var newName = name !== undefined && name !== null ? String(name).trim() : move.name;
        var newDesc = description !== undefined ? String(description).trim() : move.description;

        if (!newName) {
            showNotification('Move name is required.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: SNAPSHOT ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely update move. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 3: MUTATE ----
        var currentChar = data.characters.find(function(c) {
            return c && String(c.id) === String(charId);
        });

        if (!currentChar) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        if (!currentChar.specialMoves || typeof currentChar.specialMoves !== 'object') {
            showNotification('Special moves data is corrupted.', 'error');
            return Promise.resolve(false);
        }

        if (!Array.isArray(currentChar.specialMoves.physical) || !Array.isArray(currentChar.specialMoves.magical)) {
            showNotification('Special moves data is corrupted.', 'error');
            return Promise.resolve(false);
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
        var savePromise;
        if (window.MutationUtils && typeof window.MutationUtils.saveWithPromise === 'function') {
            savePromise = window.MutationUtils.saveWithPromise();
        } else {
            savePromise = Promise.resolve().then(function() { return window.saveData(); });
        }

        return savePromise
            .then(function() {
                // LOG - failure-safe
                try {
                    if (typeof window.logActivity === 'function') {
                        var charName = typeof window.getDisplayName === 'function'
                            ? window.getDisplayName(currentChar)
                            : currentChar.firstName || 'Character';
                        window.logActivity('Updated ' + type + ' move on ' + charName);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // UI COMMIT - re-render moves
                if (window.CharacterStatsView && typeof window.CharacterStatsView.renderSpecialMoves === 'function') {
                    window.CharacterStatsView.renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
                }

                showNotification(type.charAt(0).toUpperCase() + type.slice(1) + ' move updated!', 'success');
                return true;
            })
            .catch(function(err) {
                // ROLLBACK
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

        // ---- PHASE 1: VALIDATE CHARACTER ----
        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        if (!char.specialMoves || typeof char.specialMoves !== 'object') {
            showNotification('No special moves found.', 'error');
            return Promise.resolve(false);
        }

        if (!Array.isArray(char.specialMoves.physical) || !Array.isArray(char.specialMoves.magical)) {
            showNotification('Special moves data is corrupted.', 'error');
            return Promise.resolve(false);
        }

        if (!char.specialMoves[type] || !Array.isArray(char.specialMoves[type])) {
            showNotification('No ' + type + ' moves found.', 'error');
            return Promise.resolve(false);
        }

        if (idx < 0 || idx >= char.specialMoves[type].length) {
            showNotification('Move not found.', 'error');
            return Promise.resolve(false);
        }

        var move = char.specialMoves[type][idx];
        var moveName = move && move.name ? move.name : 'Unnamed move';

        if (!confirm('Remove "' + moveName + '" from ' + type + ' moves?')) {
            return Promise.resolve(false);
        }

        // ---- PHASE 2: SNAPSHOT ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely remove move. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 3: MUTATE ----
        var currentChar = data.characters.find(function(c) {
            return c && String(c.id) === String(charId);
        });

        if (!currentChar) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        if (!currentChar.specialMoves || typeof currentChar.specialMoves !== 'object') {
            showNotification('Special moves data is corrupted.', 'error');
            return Promise.resolve(false);
        }

        if (!Array.isArray(currentChar.specialMoves.physical) || !Array.isArray(currentChar.specialMoves.magical)) {
            showNotification('Special moves data is corrupted.', 'error');
            return Promise.resolve(false);
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
        var savePromise;
        if (window.MutationUtils && typeof window.MutationUtils.saveWithPromise === 'function') {
            savePromise = window.MutationUtils.saveWithPromise();
        } else {
            savePromise = Promise.resolve().then(function() { return window.saveData(); });
        }

        return savePromise
            .then(function() {
                // LOG - failure-safe
                try {
                    if (typeof window.logActivity === 'function') {
                        var charName = typeof window.getDisplayName === 'function'
                            ? window.getDisplayName(currentChar)
                            : currentChar.firstName || 'Character';
                        window.logActivity('Removed ' + type + ' move "' + moveName + '" from ' + charName);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // UI COMMIT - re-render moves
                if (window.CharacterStatsView && typeof window.CharacterStatsView.renderSpecialMoves === 'function') {
                    window.CharacterStatsView.renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
                }

                showNotification(type.charAt(0).toUpperCase() + type.slice(1) + ' move removed.', 'success');
                return true;
            })
            .catch(function(err) {
                // ROLLBACK
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
    // MAGIC TYPE HELPERS (delegate to constants if available)
    // ============================================================

    function getMagicTypeKeys() {
        if (window.CharacterConstants && typeof window.CharacterConstants.getMagicTypeKeys === 'function') {
            return window.CharacterConstants.getMagicTypeKeys();
        }
        return MAGIC_TYPE_KEYS.slice();
    }

    function getMagicCategoryTypes(category) {
        if (window.CharacterConstants && typeof window.CharacterConstants.getMagicCategoryTypes === 'function') {
            return window.CharacterConstants.getMagicCategoryTypes(category);
        }
        var cat = MAGIC_CATEGORIES[category];
        return cat ? cat.types.slice() : [];
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

        // Magic type helpers
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicCategoryTypes: getMagicCategoryTypes,

        // Stats
        getDefaultStats: getDefaultStats,
        getCharacterStats: getCharacterStats,
        getAbilityModifier: getAbilityModifier,
        getModifierDisplay: getModifierDisplay,
        generateRandomStats: generateRandomStats,

        // Class suggestion
        suggestClass: suggestClass,

        // Magic
        getDefaultMagicProficiencies: getDefaultMagicProficiencies,
        getCharacterMagic: getCharacterMagic,
        calculateMagicPower: calculateMagicPower,
        getMagicPowerDisplay: getMagicPowerDisplay,
        suggestMagicClass: suggestMagicClass,
        getMagicLevelLabel: getMagicLevelLabel,
        getMagicLevelColor: getMagicLevelColor,
        generateRandomMagicCategory: generateRandomMagicCategory,

        // Special moves - ID-based APIs with save
        getSpecialMoves: getSpecialMoves,
        addSpecialMove: addSpecialMove,
        updateSpecialMove: updateSpecialMove,
        removeSpecialMove: removeSpecialMove
    };

})();
