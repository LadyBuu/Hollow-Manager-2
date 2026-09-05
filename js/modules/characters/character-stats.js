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
 *   - Special moves CRUD (via MutationPipeline)
 * 
 * IMPORTANT:
 *   - DOMAIN LOGIC ONLY - no rendering (see character-stats-view.js)
 *   - All MUTATIONS use MutationPipeline
 *   - All mutation APIs accept characterId, not live character objects
 *   - Returns structured results for caller handling
 *   - No UI dependencies (no notifications, no confirm, no rendering)
 *   - Uses CharacterConstants for all definitions (single source of truth)
 *   - Uses CharacterQueries for character data and display names
 *   - Uses MutationPipeline for transaction management
 *   - Uses IdUtils for ID generation
 *   - Validation is PURE - no side effects
 * 
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.MagicConstants (from magic-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var CS = window.CharacterStats;
 *   CS.addSpecialMove('char_123', 'physical', 'Flurry Strike')
 *      .then(function(result) { ... });
 *   CS.removeSpecialMove('char_123', 'physical', 'move_456')
 *      .then(function(result) { ... });
 *   var suggestion = CS.suggestClass({ str: 16, dex: 14, ... });
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterStatsLoaded) {
        return;
    }
    window.__characterStatsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterConstants = window.CharacterConstants;
    var CharacterQueries = window.CharacterQueries;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;
    var MagicConstants = window.MagicConstants;

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

        // MutationPipeline is MANDATORY
        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        // IdUtils is MANDATORY
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        // MagicConstants is MANDATORY
        if (!MagicConstants) {
            missing.push('MagicConstants');
        }

        if (missing.length > 0) {
            console.warn('CharacterStats: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // STAT FUNCTIONS - Pure
    // ============================================================

    function getDefaultStats() {
        var stats = {};
        STAT_KEYS.forEach(function(key) {
            stats[key] = STAT_DEFAULT;
        });
        return stats;
    }

    function clampStat(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) return STAT_DEFAULT;
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
    // CLASS SUGGESTION - Pure
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
    // CLASS APPLICATION - Domain operations (pure)
    // ============================================================

    /**
     * Apply class requirements to stats.
     * Returns the required stat changes, does not mutate.
     * 
     * @param {object} stats - Current stats
     * @param {string} classId - Class ID
     * @returns {object} { success: boolean, changes: object, message: string }
     */
    function applyClassRequirements(stats, classId) {
        var classDef = CLASS_DEFINITIONS.find(function(c) {
            return c.id === classId;
        });

        if (!classDef) {
            return {
                success: false,
                message: 'Class definition not found.'
            };
        }

        var changes = {};
        var hasChanges = false;

        var currentStats = {};
        STAT_KEYS.forEach(function(key) {
            currentStats[key] = clampStat(stats[key] || STAT_DEFAULT);
        });

        if (classDef.minStats) {
            for (var stat in classDef.minStats) {
                if (Object.prototype.hasOwnProperty.call(classDef.minStats, stat)) {
                    var min = classDef.minStats[stat];
                    if (currentStats[stat] < min) {
                        changes[stat] = min;
                        hasChanges = true;
                    }
                }
            }
        }

        return {
            success: true,
            changes: changes,
            hasChanges: hasChanges,
            classId: classId,
            className: classDef.label,
            message: hasChanges ? 'Applied ' + classDef.label + ' requirements.' : 'Stats already meet requirements.'
        };
    }

    /**
     * Apply magic class requirements to magic proficiencies.
     * Returns the required proficiency changes, does not mutate.
     * 
     * @param {object} magic - Current magic proficiencies
     * @param {string} magicClass - Magic class ID
     * @returns {object} { success: boolean, changes: object, message: string }
     */
    function applyMagicClassRequirements(magic, magicClass) {
        // Magic class requirements are defined in MAGIC_CLASS_MAP
        var classConfig = null;
        for (var category in MAGIC_CLASS_MAP) {
            if (Object.prototype.hasOwnProperty.call(MAGIC_CLASS_MAP, category)) {
                for (var type in MAGIC_CLASS_MAP[category]) {
                    if (Object.prototype.hasOwnProperty.call(MAGIC_CLASS_MAP[category], type)) {
                        if (MAGIC_CLASS_MAP[category][type] === magicClass) {
                            classConfig = { category: category, type: type };
                            break;
                        }
                    }
                }
                if (classConfig) break;
            }
        }

        if (!classConfig) {
            return {
                success: false,
                message: 'Magic class configuration not found.'
            };
        }

        var changes = {};
        var hasChanges = false;

        // Get the types for this category
        var categoryTypes = MagicConstants.getCategoryTypes(classConfig.category) || [];

        // Minimum proficiency for specialized classes is 7
        var minProficiency = 7;

        // For general classes (e.g., Elementalist), min is 4
        var isGeneral = magicClass.indexOf('General') !== -1 ||
                        magicClass === 'Elementalist' ||
                        magicClass === 'Body Mage' ||
                        magicClass === 'Aether Mage';

        if (isGeneral) {
            minProficiency = 4;
        }

        categoryTypes.forEach(function(type) {
            var current = magic[type] || 0;
            if (current < minProficiency) {
                changes[type] = minProficiency;
                hasChanges = true;
            }
        });

        return {
            success: true,
            changes: changes,
            hasChanges: hasChanges,
            magicClass: magicClass,
            message: hasChanges ? 'Applied ' + magicClass + ' requirements.' : 'Magic proficiencies already meet requirements.'
        };
    }

    // ============================================================
    // MAGIC FUNCTIONS - Pure
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
    // MAGIC POWER CALCULATION - Pure
    // ============================================================

    function calculateMagicPower(char) {
        var magic = getCharacterMagic(char);
        if (!magic) return 0;

        var categoryStats = {
            elemental: { total: 0, max: 0, count: 0, types: [] },
            body: { total: 0, max: 0, count: 0, types: [] },
            aether: { total: 0, max: 0, count: 0, types: [] }
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

    // ============================================================
    // MAGIC CLASS SUGGESTION - Pure
    // ============================================================

    function isBalancedCategory(magic, category) {
        var types = MagicConstants.getCategoryTypes(category) || [];
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
    // SPECIAL MOVES - Internal helpers
    // ============================================================

    /**
     * Validate special moves structure.
     * Pure validation - no side effects.
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

    // ============================================================
    // SPECIAL MOVES - Mutations using MutationPipeline
    // ============================================================

    /**
     * Add a special move to a character.
     * 
     * @param {string} charId - Character ID
     * @param {string} type - 'physical' or 'magical'
     * @param {string} name - Move name
     * @param {string} description - Move description (optional)
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function addSpecialMove(charId, type, name, description) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        if (type !== 'physical' && type !== 'magical') {
            return Promise.resolve({
                success: false,
                message: 'Invalid move type. Must be "physical" or "magical".'
            });
        }

        if (!name || typeof name !== 'string' || name.trim() === '') {
            return Promise.resolve({
                success: false,
                message: 'Move name is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        // Validate move limits (read-only)
        var structureValidation = validateSpecialMovesStructure(char);
        if (!structureValidation.valid) {
            return Promise.resolve({
                success: false,
                message: 'Special moves data is corrupted: ' + structureValidation.errors.join(', ')
            });
        }

        var moves = char.specialMoves[type] || [];
        if (moves.length >= MAX_SPECIAL_MOVES) {
            return Promise.resolve({
                success: false,
                message: 'Maximum of ' + MAX_SPECIAL_MOVES + ' ' + type + ' moves reached.'
            });
        }

        var nameTruncated = name.trim().slice(0, MAX_MOVE_NAME_LENGTH);
        var descTruncated = typeof description === 'string'
            ? description.trim().slice(0, MAX_MOVE_DESCRIPTION_LENGTH)
            : '';

        var displayName = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                var currentValidation = validateSpecialMovesStructure(currentChar);
                if (!currentValidation.valid) {
                    return {
                        valid: false,
                        message: 'Special moves data is corrupted: ' + currentValidation.errors.join(', ')
                    };
                }

                var currentMoves = currentChar.specialMoves[type] || [];
                if (currentMoves.length >= MAX_SPECIAL_MOVES) {
                    return {
                        valid: false,
                        message: 'Maximum of ' + MAX_SPECIAL_MOVES + ' ' + type + ' moves reached.'
                    };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                // Repair malformed structure (after snapshot)
                if (!currentChar.specialMoves || typeof currentChar.specialMoves !== 'object' || Array.isArray(currentChar.specialMoves)) {
                    currentChar.specialMoves = { physical: [], magical: [] };
                }
                if (!Array.isArray(currentChar.specialMoves.physical)) {
                    currentChar.specialMoves.physical = [];
                }
                if (!Array.isArray(currentChar.specialMoves.magical)) {
                    currentChar.specialMoves.magical = [];
                }

                if (!currentChar.specialMoves[type] || !Array.isArray(currentChar.specialMoves[type])) {
                    currentChar.specialMoves[type] = [];
                }

                var move = {
                    id: IdUtils.generateId('move'),
                    name: nameTruncated,
                    description: descTruncated
                };

                currentChar.specialMoves[type].push(move);

                return {
                    move: move,
                    type: type,
                    characterId: charId
                };
            },

            logMessage: function(result) {
                return 'Added ' + type + ' move "' + nameTruncated + '" to ' + displayName;
            },

            successMessage: function(result) {
                return type.charAt(0).toUpperCase() + type.slice(1) + ' move added!';
            },
            failureMessage: 'Failed to add move.'
        });
    }

    /**
     * Update a special move.
     * 
     * @param {string} charId - Character ID
     * @param {string} type - 'physical' or 'magical'
     * @param {string} moveId - Move ID
     * @param {string} name - New move name
     * @param {string} description - New move description (optional)
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function updateSpecialMove(charId, type, moveId, name, description) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        if (type !== 'physical' && type !== 'magical') {
            return Promise.resolve({
                success: false,
                message: 'Invalid move type.'
            });
        }

        if (!moveId) {
            return Promise.resolve({
                success: false,
                message: 'Move ID is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var structureValidation = validateSpecialMovesStructure(char);
        if (!structureValidation.valid) {
            return Promise.resolve({
                success: false,
                message: 'Special moves data is corrupted: ' + structureValidation.errors.join(', ')
            });
        }

        var moves = char.specialMoves[type] || [];
        var moveIndex = -1;
        var existingMove = null;

        for (var i = 0; i < moves.length; i++) {
            if (moves[i] && String(moves[i].id) === String(moveId)) {
                moveIndex = i;
                existingMove = moves[i];
                break;
            }
        }

        if (!existingMove) {
            return Promise.resolve({
                success: false,
                message: 'Move not found.'
            });
        }

        var newName = name !== undefined && name !== null ? String(name).trim() : existingMove.name;
        var newDesc = description !== undefined ? String(description).trim() : existingMove.description;

        if (!newName) {
            return Promise.resolve({
                success: false,
                message: 'Move name is required.'
            });
        }

        var displayName = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                var currentValidation = validateSpecialMovesStructure(currentChar);
                if (!currentValidation.valid) {
                    return {
                        valid: false,
                        message: 'Special moves data is corrupted: ' + currentValidation.errors.join(', ')
                    };
                }

                var currentMoves = currentChar.specialMoves[type] || [];
                var found = false;
                for (var i = 0; i < currentMoves.length; i++) {
                    if (currentMoves[i] && String(currentMoves[i].id) === String(moveId)) {
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    return {
                        valid: false,
                        message: 'Move no longer exists.'
                    };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
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
                    return {
                        valid: false,
                        message: 'No ' + type + ' moves found.'
                    };
                }

                var found = false;
                for (var i = 0; i < currentChar.specialMoves[type].length; i++) {
                    if (currentChar.specialMoves[type][i] && String(currentChar.specialMoves[type][i].id) === String(moveId)) {
                        currentChar.specialMoves[type][i].name = newName.slice(0, MAX_MOVE_NAME_LENGTH);
                        currentChar.specialMoves[type][i].description = newDesc.slice(0, MAX_MOVE_DESCRIPTION_LENGTH);
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    throw new Error('Move not found.');
                }

                return {
                    moveId: moveId,
                    type: type,
                    characterId: charId,
                    name: newName,
                    description: newDesc
                };
            },

            logMessage: function(result) {
                return 'Updated ' + type + ' move on ' + displayName;
            },

            successMessage: function(result) {
                return type.charAt(0).toUpperCase() + type.slice(1) + ' move updated!';
            },
            failureMessage: 'Failed to update move.'
        });
    }

    /**
     * Remove a special move.
     * 
     * @param {string} charId - Character ID
     * @param {string} type - 'physical' or 'magical'
     * @param {string} moveId - Move ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function removeSpecialMove(charId, type, moveId) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded. Please refresh the page.'
            });
        }

        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }

        if (type !== 'physical' && type !== 'magical') {
            return Promise.resolve({
                success: false,
                message: 'Invalid move type.'
            });
        }

        if (!moveId) {
            return Promise.resolve({
                success: false,
                message: 'Move ID is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var structureValidation = validateSpecialMovesStructure(char);
        if (!structureValidation.valid) {
            return Promise.resolve({
                success: false,
                message: 'Special moves data is corrupted: ' + structureValidation.errors.join(', ')
            });
        }

        var moves = char.specialMoves[type] || [];
        var found = false;
        var moveName = '';

        for (var i = 0; i < moves.length; i++) {
            if (moves[i] && String(moves[i].id) === String(moveId)) {
                found = true;
                moveName = moves[i].name || 'Unnamed move';
                break;
            }
        }

        if (!found) {
            return Promise.resolve({
                success: false,
                message: 'Move not found.'
            });
        }

        var displayName = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
            validate: function(data) {
                var currentChar = CharacterQueries.getCharacterById(charId);
                if (!currentChar) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }

                var currentValidation = validateSpecialMovesStructure(currentChar);
                if (!currentValidation.valid) {
                    return {
                        valid: false,
                        message: 'Special moves data is corrupted: ' + currentValidation.errors.join(', ')
                    };
                }

                var currentMoves = currentChar.specialMoves[type] || [];
                var found = false;
                for (var i = 0; i < currentMoves.length; i++) {
                    if (currentMoves[i] && String(currentMoves[i].id) === String(moveId)) {
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    return {
                        valid: false,
                        message: 'Move no longer exists.'
                    };
                }

                return { valid: true };
            },

            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });

                if (!currentChar) {
                    throw new Error('Character not found in data store.');
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
                    throw new Error('No ' + type + ' moves found.');
                }

                var found = false;
                var removedMove = null;
                currentChar.specialMoves[type] = currentChar.specialMoves[type].filter(function(m) {
                    if (m && String(m.id) === String(moveId)) {
                        found = true;
                        removedMove = m;
                        return false;
                    }
                    return true;
                });

                if (!found) {
                    throw new Error('Move not found.');
                }

                return {
                    moveId: moveId,
                    type: type,
                    characterId: charId,
                    moveName: removedMove ? removedMove.name : 'Unnamed move'
                };
            },

            logMessage: function(result) {
                return 'Removed ' + type + ' move "' + result.moveName + '" from ' + displayName;
            },

            successMessage: function(result) {
                return type.charAt(0).toUpperCase() + type.slice(1) + ' move removed.';
            },
            failureMessage: 'Failed to remove move.'
        });
    }

    // ============================================================
    // MAGIC TYPE HELPERS (delegate to constants)
    // ============================================================

    function getMagicTypeKeys() {
        return MagicConstants.getTypeKeys() || MAGIC_TYPE_KEYS.slice();
    }

    function getMagicCategoryTypes(category) {
        return MagicConstants.getCategoryTypes(category) || [];
    }

    function getMagicTypeLabel(key) {
        return MagicConstants.getTypeLabel(key) || key;
    }

    function getMagicCategoryLabel(category) {
        return MagicConstants.getCategoryLabel(category) || category;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStats = {
        // Constants (read-only, from CharacterConstants)
        MAGIC_MAX: MAGIC_MAX,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        BALANCED_MAGE_THRESHOLD: BALANCED_MAGE_THRESHOLD,
        MAGIC_CATEGORY_MULTIPLIERS: MAGIC_CATEGORY_MULTIPLIERS,
        MAGIC_POWER_THRESHOLDS: MAGIC_POWER_THRESHOLDS,

        // Magic type helpers
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicCategoryTypes: getMagicCategoryTypes,
        getMagicTypeLabel: getMagicTypeLabel,
        getMagicCategoryLabel: getMagicCategoryLabel,

        // Stats
        getDefaultStats: getDefaultStats,
        getCharacterStats: getCharacterStats,
        getAbilityModifier: getAbilityModifier,
        getModifierDisplay: getModifierDisplay,

        // Class suggestion
        suggestClass: suggestClass,

        // Class application (pure)
        applyClassRequirements: applyClassRequirements,
        applyMagicClassRequirements: applyMagicClassRequirements,

        // Magic
        getDefaultMagicProficiencies: getDefaultMagicProficiencies,
        getCharacterMagic: getCharacterMagic,
        calculateMagicPower: calculateMagicPower,
        getMagicRank: getMagicRank,
        suggestMagicClass: suggestMagicClass,

        // Special moves - ID-based APIs with save
        getSpecialMoves: getSpecialMoves,
        addSpecialMove: addSpecialMove,
        updateSpecialMove: updateSpecialMove,
        removeSpecialMove: removeSpecialMove
    };

})();