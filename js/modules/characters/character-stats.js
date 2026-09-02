/**
 * js/modules/characters/character-stats.js - Character Stats & Magic System
 * Handles physical stats, magic proficiencies, class suggestions, special moves
 * 
 * IMPORTANT:
 *   - All MUTATIONS now follow VALIDATE → SNAPSHOT → MUTATE → PERSIST → LOG → UI
 *   - Special moves now use the full mutation pipeline with rollback
 *   - All mutation APIs accept characterId, not live character objects
 *   - Uses CharacterConstants for all definitions (single source of truth)
 *   - Uses MutationUtils for backup and persistence
 */
(function() {
    'use strict';

    if (window.__characterStatsLoaded) return;
    window.__characterStatsLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Core dependencies
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

        // Check for MutationUtils
        if (!window.MutationUtils || typeof window.MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }

        // Check for CharacterConstants
        if (!window.CharacterConstants) {
            missing.push('CharacterConstants');
        }

        if (missing.length > 0) {
            console.warn('CharacterStats: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // CONSTANTS - Use centralised sources
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

        if (typeof window.setSession === 'function') {
            window.setSession('toast', {
                message: message,
                type: type,
                timestamp: Date.now()
            });
            if (typeof window.renderToast === 'function') {
                window.renderToast();
            }
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
    // SAFE RENDER HELPERS
    // ============================================================

    function safeRenderCharacterList() {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            window.CharacterList.render();
        }
    }

    function safeShowCharacterForm(id) {
        if (typeof window.showCharacterForm === 'function') {
            window.showCharacterForm(id);
        }
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
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

    function getStatFromDOM(id) {
        var el = document.getElementById(id);
        if (!el) return 10;
        var val = parseInt(el.value);
        if (isNaN(val)) return 10;
        return Math.max(STAT_MIN, Math.min(STAT_MAX, val));
    }

    function getMagicFromDOM(id) {
        var el = document.getElementById(id);
        if (!el) return 0;
        var val = parseInt(el.value);
        if (isNaN(val)) return 0;
        return Math.max(0, Math.min(MAGIC_MAX, val));
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

    function updateClassSuggestion() {
        var stats = {};
        STAT_KEYS.forEach(function(key) {
            stats[key] = getStatFromDOM('char-' + key);
        });

        var suggested = suggestClass(stats);
        var display = document.getElementById('suggested-class');
        var descDisplay = document.getElementById('class-description-display');

        if (display) {
            if (suggested) {
                display.textContent = (suggested.icon || '') + ' ' + (suggested.label || '');
                display.style.color = 'var(--accent)';
                display.style.background = 'var(--accent-soft)';
                display.style.borderColor = 'var(--accent)';
                if (descDisplay && suggested.description) {
                    descDisplay.textContent = suggested.description;
                    descDisplay.style.borderLeftColor = 'var(--accent)';
                    descDisplay.style.color = 'var(--text)';
                }
            } else {
                display.textContent = '—';
                display.style.color = 'var(--text-dim)';
                display.style.background = 'transparent';
                display.style.borderColor = 'var(--border)';
                if (descDisplay) {
                    descDisplay.textContent = 'No class suggested based on current stats.';
                    descDisplay.style.borderLeftColor = 'var(--border)';
                    descDisplay.style.color = 'var(--text-dim)';
                }
            }
        }
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

    function updateMagicPowerDisplay() {
        var el = document.getElementById('magic-power-display-text');
        if (!el) return;

        var magic = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            magic[key] = getMagicFromDOM('magic-' + key);
        });

        var tempChar = { magic: magic };
        el.textContent = getMagicPowerDisplay(tempChar);
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

    function updateMagicClassSuggestion() {
        var magic = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            magic[key] = getMagicFromDOM('magic-' + key);
        });

        var tempChar = { magic: magic };
        var suggested = suggestMagicClass(tempChar);
        var display = document.getElementById('suggested-magic-class');

        if (display) {
            if (suggested) {
                display.textContent = suggested.name;
                display.style.color = 'var(--info)';
                display.style.background = 'var(--info-soft)';
                display.style.borderColor = 'var(--info)';
            } else {
                display.textContent = '—';
                display.style.color = 'var(--text-dim)';
                display.style.background = 'transparent';
                display.style.borderColor = 'var(--border)';
            }
        }
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
    // SPECIAL MOVES - FIXED: Now use full mutation pipeline with save
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
     * FIXED: Now uses full mutation pipeline with save.
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
        // Re-fetch character from data (in case it was modified)
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

                // UI COMMIT
                renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
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
     * FIXED: Now uses full mutation pipeline with save.
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

                // UI COMMIT
                renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
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
     * FIXED: Now uses full mutation pipeline with save.
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

                // UI COMMIT
                renderSpecialMoves(type + '-moves-list', currentChar.specialMoves[type], type);
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
    // RENDER SPECIAL MOVES
    // ============================================================

    function renderSpecialMoves(containerId, moves, type) {
        var container = document.getElementById(containerId);
        if (!container) return;

        container.textContent = '';

        if (!moves || moves.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'None';
            container.appendChild(empty);
            return;
        }

        var color = type === 'physical' ? 'var(--accent)' : 'var(--info)';

        moves.forEach(function(move, index) {
            move = move || {};
            if (typeof move !== 'object' || Array.isArray(move)) {
                move = { name: 'Invalid Move', description: '' };
            }

            var div = document.createElement('div');
            div.className = 'special-move-entry';
            div.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:4px 6px;border-left:3px solid ' + color + ';background:var(--bg);border-radius:4px;margin-bottom:3px;font-size:0.7rem;';

            var topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;';

            var nameSpan = document.createElement('span');
            nameSpan.className = 'move-name';
            nameSpan.style.cssText = 'font-weight:600;color:var(--text);';
            nameSpan.textContent = move.name || 'Unnamed Move';
            topRow.appendChild(nameSpan);

            var actionsDiv = document.createElement('div');
            actionsDiv.style.cssText = 'display:flex;gap:4px;';

            var editBtn = document.createElement('button');
            editBtn.className = 'edit-special-move small secondary';
            editBtn.style.cssText = 'font-size:0.5rem;padding:1px 6px;';
            editBtn.dataset.type = type;
            editBtn.dataset.index = index;
            editBtn.textContent = '✎';
            editBtn.setAttribute('aria-label', 'Edit move');
            actionsDiv.appendChild(editBtn);

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'remove-special-move small';
            deleteBtn.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 4px;';
            deleteBtn.dataset.type = type;
            deleteBtn.dataset.index = index;
            deleteBtn.textContent = '✕';
            deleteBtn.setAttribute('aria-label', 'Delete move');
            actionsDiv.appendChild(deleteBtn);

            topRow.appendChild(actionsDiv);
            div.appendChild(topRow);

            if (move.description) {
                var descDiv = document.createElement('div');
                descDiv.className = 'move-desc';
                descDiv.style.cssText = 'color:var(--text-dim);font-size:0.6rem;padding-left:4px;';
                descDiv.textContent = move.description;
                div.appendChild(descDiv);
            }

            container.appendChild(div);
        });
    }

    // ============================================================
    // EDIT SPECIAL MOVE - Opens edit modal
    // ============================================================

    function editSpecialMove(charId, type, index) {
        if (!charId) {
            showNotification('Character ID is required.', 'error');
            return;
        }

        if (type !== 'physical' && type !== 'magical') {
            showNotification('Invalid move type.', 'error');
            return;
        }

        var idx = Number(index);
        if (!Number.isInteger(idx) || idx < 0) {
            showNotification('Invalid move index.', 'error');
            return;
        }

        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
        if (!char) {
            showNotification('Character not found.', 'error');
            return;
        }

        if (!char.specialMoves || typeof char.specialMoves !== 'object') {
            showNotification('No special moves found.', 'error');
            return;
        }

        if (!Array.isArray(char.specialMoves.physical) || !Array.isArray(char.specialMoves.magical)) {
            showNotification('Special moves data is corrupted.', 'error');
            return;
        }

        if (!char.specialMoves[type] || !Array.isArray(char.specialMoves[type])) {
            showNotification('No ' + type + ' moves found.', 'error');
            return;
        }

        if (idx < 0 || idx >= char.specialMoves[type].length) {
            showNotification('Move not found.', 'error');
            return;
        }

        var move = char.specialMoves[type][idx];
        var moveName = move && move.name ? move.name : '';
        var moveDesc = move && move.description ? move.description : '';

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';

        var modalContent = document.createElement('div');
        modalContent.className = 'modal-content small';

        var header = document.createElement('div');
        header.className = 'modal-header';

        var title = document.createElement('h3');
        title.textContent = 'Edit ' + type.charAt(0).toUpperCase() + type.slice(1) + ' Move';
        header.appendChild(title);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'close-modal';
        closeBtn.textContent = '×';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'var(--text-dim)';
        closeBtn.style.fontSize = '1.2rem';
        closeBtn.style.cursor = 'pointer';
        header.appendChild(closeBtn);

        var body = document.createElement('div');
        body.className = 'modal-body';

        var nameLabel = document.createElement('label');
        nameLabel.textContent = 'Move Name';
        nameLabel.style.cssText = 'display:block;font-size:0.65rem;color:var(--text-dim);margin-bottom:2px;';
        body.appendChild(nameLabel);

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'edit-move-name';
        nameInput.value = moveName;
        nameInput.style.cssText = 'width:100%;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;margin-bottom:8px;';
        body.appendChild(nameInput);

        var descLabel = document.createElement('label');
        descLabel.textContent = 'Description (optional)';
        descLabel.style.cssText = 'display:block;font-size:0.65rem;color:var(--text-dim);margin-bottom:2px;';
        body.appendChild(descLabel);

        var descInput = document.createElement('textarea');
        descInput.id = 'edit-move-desc';
        descInput.value = moveDesc;
        descInput.rows = 3;
        descInput.style.cssText = 'width:100%;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;font-family:Inter,sans-serif;resize:vertical;min-height:50px;margin-bottom:8px;';
        body.appendChild(descInput);

        var actions = document.createElement('div');
        actions.className = 'form-actions';
        actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:4px 12px;font-size:0.7rem;';
        actions.appendChild(cancelBtn);

        var saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'primary';
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = 'padding:4px 12px;font-size:0.7rem;';
        actions.appendChild(saveBtn);

        body.appendChild(actions);

        modalContent.appendChild(header);
        modalContent.appendChild(body);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        function closeModal() {
            if (modal.parentNode) modal.remove();
        }

        function saveMove() {
            var newName = document.getElementById('edit-move-name').value;
            var newDesc = document.getElementById('edit-move-desc').value;
            
            if (!newName || newName.trim() === '') {
                showNotification('Move name is required.', 'error');
                return;
            }

            // Use the ID-based update API
            updateSpecialMove(charId, type, idx, newName, newDesc)
                .then(function(success) {
                    if (success) {
                        closeModal();
                    }
                })
                .catch(function() {
                    // Error already shown by updateSpecialMove
                });
        }

        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;
        saveBtn.onclick = saveMove;

        modal.addEventListener('click', function(e) {
            if (e.target === modal) closeModal();
        });

        nameInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') saveMove();
        });

        setTimeout(function() {
            nameInput.focus();
            nameInput.select();
        }, 50);
    }

    // ============================================================
    // STATS TAB HTML
    // ============================================================

    function getStatsTabHTML() {
        return `
            <div class="stat-input-group" style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;">
                ${STAT_KEYS.map(function(stat) {
                    return `
                        <div class="form-group">
                            <label style="font-size:0.55rem;text-align:center;display:block;">${stat.toUpperCase()}</label>
                            <input type="number" id="char-${stat}" min="${STAT_MIN}" max="${STAT_MAX}" value="10" 
                                   style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" />
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="stat-actions" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);">
                <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:1;">
                    <label class="stat-label" style="font-size:0.7rem;color:var(--text-dim);">Class:</label>
                    <span id="suggested-class" class="suggested-class empty" style="background:transparent;border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:0.7rem;color:var(--text-dim);font-weight:600;">—</span>
                    <select id="manual-class-select" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">
                        <option value="">Auto-suggest</option>
                    </select>
                    <button type="button" id="apply-class-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">Apply Class</button>
                    <button type="button" id="recalculate-class-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Recalc</button>
                    <button type="button" id="random-stats-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Random</button>
                </div>
            </div>
            <div id="class-description-display" style="margin-top:6px;padding:6px 10px;background:var(--panel-alt);border-radius:4px;font-size:0.7rem;color:var(--text-dim);border-left:3px solid var(--accent);">
                Select a class to see its description here.
            </div>
            ${getMagicTabHTML()}
        `;
    }

    function getMagicTabHTML() {
        var magicHTML = '';
        var categories = ['elemental', 'body', 'aether'];
        var categoryLabels = {
            'elemental': { label: 'Elemental', color: 'var(--accent)' },
            'body': { label: 'Body', color: 'var(--danger)' },
            'aether': { label: 'Aether', color: 'var(--info)' }
        };
        var categoryButtons = {
            'elemental': 'random-elemental-btn',
            'body': 'random-body-btn',
            'aether': 'random-aether-btn'
        };

        magicHTML += '<div class="magic-stats-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:12px;">';

        categories.forEach(function(cat) {
            var types = getMagicCategoryTypes(cat);
            magicHTML += '<div class="form-group" style="grid-column:1/-1;margin:6px 0 2px 0;display:flex;align-items:center;gap:8px;">';
            magicHTML += '<label style="color:' + categoryLabels[cat].color + ';font-weight:600;font-size:0.7rem;">' + categoryLabels[cat].label + '</label>';
            magicHTML += '<button type="button" id="' + categoryButtons[cat] + '" class="small secondary" style="font-size:0.5rem;padding:1px 6px;">Random</button>';
            magicHTML += '</div>';

            types.forEach(function(key) {
                var label = key.charAt(0).toUpperCase() + key.slice(1);
                magicHTML += `
                    <div class="form-group">
                        <label style="font-size:0.55rem;text-align:center;display:block;">${label}</label>
                        <input type="number" id="magic-${key}" min="0" max="${MAGIC_MAX}" value="0" 
                               style="text-align:center;font-size:0.75rem;padding:4px;width:100%;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;" />
                    </div>
                `;
            });
        });

        magicHTML += '</div>';

        magicHTML += `
            <div class="magic-actions" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;padding:8px;background:var(--bg);border-radius:6px;border:1px solid var(--border-soft);">
                <label class="stat-label" style="font-size:0.7rem;color:var(--text-dim);">Magic Class:</label>
                <span id="suggested-magic-class" class="suggested-class empty" style="background:transparent;border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:0.7rem;color:var(--text-dim);font-weight:600;">—</span>
                <select id="manual-magic-class-select" style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:0.7rem;">
                    <option value="">Auto-suggest</option>
                    <optgroup label="Elemental Magic">
                        <option value="elementalist">Elementalist (General)</option>
                        <option value="geomancer">Geomancer (Earth)</option>
                        <option value="hydromancer">Hydromancer (Water)</option>
                        <option value="pyromancer">Pyromancer (Fire)</option>
                        <option value="aeromancer">Aeromancer (Air)</option>
                        <option value="ferromancer">Ferromancer (Metal)</option>
                        <option value="dendromancer">Dendromancer (Wood)</option>
                    </optgroup>
                    <optgroup label="Body Magic">
                        <option value="body_mage">Body Mage (General)</option>
                        <option value="hemomancer">Hemomancer (Blood)</option>
                        <option value="osteomancer">Osteomancer (Bone)</option>
                        <option value="psychomancer">Psychomancer (Mind)</option>
                        <option value="morphomancer">Morphomancer (Morphic)</option>
                        <option value="vitalmancer">Vitalmancer (Life)</option>
                        <option value="necromancer">Necromancer (Death)</option>
                    </optgroup>
                    <optgroup label="Aether Magic">
                        <option value="aether_mage">Aether Mage (General)</option>
                        <option value="spatiomancer">Spatiomancer (Space)</option>
                        <option value="chronomancer">Chronomancer (Time)</option>
                        <option value="dimensionist">Dimensionist (Dimension)</option>
                        <option value="voidmancer">Voidmancer (Void)</option>
                        <option value="reality_weaver">Reality Weaver (Reality)</option>
                        <option value="transference_mage">Transference Mage (Transference)</option>
                    </optgroup>
                </select>
                <button type="button" id="apply-magic-class-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">Apply Class</button>
                <button type="button" id="recalculate-magic-class-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Recalc</button>
            </div>
            <div class="magic-power-display" style="margin-top:6px;font-size:0.7rem;color:var(--text-dim);">
                Magic Power: <span id="magic-power-display-text">☆☆☆☆☆ (0/100) - Untrained</span>
            </div>
            ${getSpecialMovesHTML()}
        `;

        return magicHTML;
    }

    function getSpecialMovesHTML() {
        return `
            <div class="moves-grid" style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                    <label class="move-label physical" style="font-size:0.65rem;font-weight:600;color:var(--accent);">Physical Moves</label>
                    <div id="physical-moves-list" class="moves-list" style="margin-top:2px;max-height:120px;overflow-y:auto;"><p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p></div>
                    <div class="move-input-group" style="margin-top:4px;">
                        <input type="text" id="physical-move-name" placeholder="Move name" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <input type="text" id="physical-move-desc" placeholder="Description (optional)" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <button type="button" id="add-physical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                    </div>
                </div>
                <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                    <label class="move-label magical" style="font-size:0.65rem;font-weight:600;color:var(--info);">Magical Moves</label>
                    <div id="magical-moves-list" class="moves-list" style="margin-top:2px;max-height:120px;overflow-y:auto;"><p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p></div>
                    <div class="move-input-group" style="margin-top:4px;">
                        <input type="text" id="magical-move-name" placeholder="Move name" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <input type="text" id="magical-move-desc" placeholder="Description (optional)" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <button type="button" id="add-magical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                    </div>
                </div>
            </div>
        `;
    }

    function populateClassSelect() {
        var select = document.getElementById('manual-class-select');
        if (!select) return;
        
        var currentValue = select.value || '';
        select.innerHTML = '<option value="">Auto-suggest</option>';
        
        var sorted = CLASS_DEFINITIONS.slice().sort(function(a, b) {
            var priorityDiff = (b.priority || 0) - (a.priority || 0);
            if (priorityDiff !== 0) return priorityDiff;
            return (a.label || '').localeCompare(b.label || '');
        });
        
        sorted.forEach(function(cls) {
            if (cls && cls.id) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = (cls.icon || '') + ' ' + (cls.label || cls.id);
                select.appendChild(option);
            }
        });
        
        if (currentValue) {
            var optionExists = false;
            for (var i = 0; i < select.options.length; i++) {
                if (select.options[i].value === currentValue) {
                    optionExists = true;
                    break;
                }
            }
            if (optionExists) {
                select.value = currentValue;
            }
        }
    }

    // ============================================================
    // APPLY CLASS - Sets stats to match the selected class
    // ============================================================

    function applyPhysicalClass() {
        var select = document.getElementById('manual-class-select');
        if (!select || !select.value) {
            showNotification('Please select a class first.', 'warning');
            return;
        }

        var classId = select.value;
        var cls = CLASS_DEFINITIONS.find(function(c) { return c.id === classId; });
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var stats = {
            str: 10,
            dex: 10,
            con: 10,
            int: 10,
            wis: 10,
            cha: 10
        };

        // Use minStats as source of truth
        for (var stat in cls.minStats) {
            stats[stat] = cls.minStats[stat];
        }

        // Distribute remaining points
        var statKeys = STAT_KEYS.slice();
        var remainingPoints = 6;
        
        // Prioritise primary stats
        var priorityStats = cls.primaryStats.slice();
        if (cls.secondaryStats) {
            cls.secondaryStats.forEach(function(s) {
                if (priorityStats.indexOf(s) === -1) {
                    priorityStats.push(s);
                }
            });
        }
        statKeys.forEach(function(s) {
            if (priorityStats.indexOf(s) === -1) {
                priorityStats.push(s);
            }
        });

        while (remainingPoints > 0) {
            for (var i = 0; i < priorityStats.length && remainingPoints > 0; i++) {
                var stat = priorityStats[i];
                var bonus = Math.min(remainingPoints, Math.floor(Math.random() * 2) + 1);
                stats[stat] += bonus;
                remainingPoints -= bonus;
            }
        }

        document.getElementById('char-str').value = stats.str;
        document.getElementById('char-dex').value = stats.dex;
        document.getElementById('char-con').value = stats.con;
        document.getElementById('char-int').value = stats.int;
        document.getElementById('char-wis').value = stats.wis;
        document.getElementById('char-cha').value = stats.cha;

        updateClassSuggestion();
        showNotification('Applied ' + cls.label + ' class requirements!', 'success');
    }

    function applyMagicClass() {
        var select = document.getElementById('manual-magic-class-select');
        if (!select || !select.value) {
            showNotification('Please select a magic class first.', 'warning');
            return;
        }

        var classType = select.value;
        var magic = {};
        var allKeys = MAGIC_TYPE_KEYS.slice();
        allKeys.forEach(function(key) {
            magic[key] = 0;
        });

        var classMap = {
            'elementalist': { category: 'elemental', primary: null, label: 'Elementalist' },
            'geomancer': { category: 'elemental', primary: 'earth', label: 'Geomancer' },
            'hydromancer': { category: 'elemental', primary: 'water', label: 'Hydromancer' },
            'pyromancer': { category: 'elemental', primary: 'fire', label: 'Pyromancer' },
            'aeromancer': { category: 'elemental', primary: 'air', label: 'Aeromancer' },
            'ferromancer': { category: 'elemental', primary: 'metal', label: 'Ferromancer' },
            'dendromancer': { category: 'elemental', primary: 'wood', label: 'Dendromancer' },
            'body_mage': { category: 'body', primary: null, label: 'Body Mage' },
            'hemomancer': { category: 'body', primary: 'blood', label: 'Hemomancer' },
            'osteomancer': { category: 'body', primary: 'bone', label: 'Osteomancer' },
            'psychomancer': { category: 'body', primary: 'mind', label: 'Psychomancer' },
            'morphomancer': { category: 'body', primary: 'morphic', label: 'Morphomancer' },
            'vitalmancer': { category: 'body', primary: 'life', label: 'Vitalmancer' },
            'necromancer': { category: 'body', primary: 'death', label: 'Necromancer' },
            'aether_mage': { category: 'aether', primary: null, label: 'Aether Mage' },
            'spatiomancer': { category: 'aether', primary: 'space', label: 'Spatiomancer' },
            'chronomancer': { category: 'aether', primary: 'time', label: 'Chronomancer' },
            'dimensionist': { category: 'aether', primary: 'dimension', label: 'Dimensionist' },
            'voidmancer': { category: 'aether', primary: 'void', label: 'Voidmancer' },
            'reality_weaver': { category: 'aether', primary: 'reality', label: 'Reality Weaver' },
            'transference_mage': { category: 'aether', primary: 'transference', label: 'Transference Mage' }
        };

        var config = classMap[classType];
        if (!config) {
            showNotification('Unknown magic class.', 'error');
            return;
        }

        var category = config.category;
        var primary = config.primary;
        var types = getMagicCategoryTypes(category);

        types.forEach(function(key) {
            magic[key] = Math.floor(Math.random() * 3) + 5;
        });

        if (primary && magic[primary] !== undefined) {
            magic[primary] = Math.floor(Math.random() * 3) + 8;
        }

        allKeys.forEach(function(key) {
            if (magic[key] === 0) {
                magic[key] = Math.floor(Math.random() * 3) + 1;
            }
        });

        allKeys.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            if (input) {
                input.value = magic[key];
            }
        });

        updateMagicClassSuggestion();
        updateMagicPowerDisplay();
        showNotification('Applied ' + config.label + ' magic distribution!', 'success');
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
        // Definitions (read-only, from constants)
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
        updateClassSuggestion: updateClassSuggestion,

        // Magic
        getDefaultMagicProficiencies: getDefaultMagicProficiencies,
        getCharacterMagic: getCharacterMagic,
        calculateMagicPower: calculateMagicPower,
        getMagicPowerDisplay: getMagicPowerDisplay,
        updateMagicPowerDisplay: updateMagicPowerDisplay,
        suggestMagicClass: suggestMagicClass,
        updateMagicClassSuggestion: updateMagicClassSuggestion,
        getMagicLevelLabel: getMagicLevelLabel,
        getMagicLevelColor: getMagicLevelColor,
        generateRandomMagicCategory: generateRandomMagicCategory,

        // Special moves - FIXED: ID-based APIs with save
        getSpecialMoves: getSpecialMoves,
        addSpecialMove: addSpecialMove,        // Now accepts charId
        updateSpecialMove: updateSpecialMove,  // Now accepts charId
        removeSpecialMove: removeSpecialMove,  // Now accepts charId
        renderSpecialMoves: renderSpecialMoves,
        editSpecialMove: editSpecialMove,      // Now accepts charId

        // UI
        getStatsTabHTML: getStatsTabHTML,
        getMagicTabHTML: getMagicTabHTML,
        getSpecialMovesHTML: getSpecialMovesHTML,

        // Class application
        populateClassSelect: populateClassSelect,
        applyPhysicalClass: applyPhysicalClass,
        applyMagicClass: applyMagicClass
    };


})();
