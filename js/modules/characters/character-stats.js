/**
 * js/modules/characters/character-stats.js - Character Stats & Magic System
 * Merged from stats.js and magic.js
 * Path: js/modules/characters/character-stats.js
 */

(function() {
    'use strict';

    // ============================================================
    // STAT DEFINITIONS
    // ============================================================

    var STAT_DEFINITIONS = {
        'str': { label: 'Strength', icon: '\uD83D\uDCAA', abbr: 'STR' },
        'dex': { label: 'Dexterity', icon: '\uD83C\uDFAF', abbr: 'DEX' },
        'con': { label: 'Constitution', icon: '\uD83D\uDCAA', abbr: 'CON' },
        'int': { label: 'Intelligence', icon: '\uD83E\uDDE0', abbr: 'INT' },
        'wis': { label: 'Wisdom', icon: '\uD83E\uDDD8', abbr: 'WIS' },
        'cha': { label: 'Charisma', icon: '\uD83D\uDCAC', abbr: 'CHA' }
    };

    var CLASS_DEFINITIONS = [
        { id: 'barbarian', label: 'Barbarian', icon: '\uD83D\uDE08', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 } },
        { id: 'bard', label: 'Bard', icon: '\uD83C\uDFB8', primaryStats: ['cha', 'dex'], secondaryStats: ['int', 'wis'], statWeights: { cha: 0.35, dex: 0.25, int: 0.2, wis: 0.15, con: 0.05 }, minStats: { cha: 13, dex: 12 } },
        { id: 'cleric', label: 'Cleric', icon: '\u2728', primaryStats: ['wis', 'con'], secondaryStats: ['str', 'cha'], statWeights: { wis: 0.35, con: 0.25, str: 0.2, cha: 0.15, dex: 0.05 }, minStats: { wis: 13, con: 12 } },
        { id: 'druid', label: 'Druid', icon: '\uD83C\uDF31', primaryStats: ['wis', 'con'], secondaryStats: ['int', 'dex'], statWeights: { wis: 0.35, con: 0.25, int: 0.2, dex: 0.15, str: 0.05 }, minStats: { wis: 13, con: 12 } },
        { id: 'fighter', label: 'Fighter', icon: '\uD83D\uDDE1\uFE0F', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.35, con: 0.3, dex: 0.25, wis: 0.1 }, minStats: { str: 13, con: 12 } },
        { id: 'monk', label: 'Monk', icon: '\uD83E\uDDD8', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.3, con: 0.2, str: 0.15 }, minStats: { dex: 13, wis: 13 } },
        { id: 'paladin', label: 'Paladin', icon: '\uD83D\uDEE1\uFE0F', primaryStats: ['str', 'cha'], secondaryStats: ['con', 'wis'], statWeights: { str: 0.3, cha: 0.3, con: 0.2, wis: 0.15, dex: 0.05 }, minStats: { str: 13, cha: 13 } },
        { id: 'ranger', label: 'Ranger', icon: '\uD83C\uDFF7\uFE0F', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 } },
        { id: 'rogue', label: 'Rogue', icon: '\uD83D\uDD77\uFE0F', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
        { id: 'sorcerer', label: 'Sorcerer', icon: '\uD83D\uDD25', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.4, con: 0.2, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
        { id: 'warlock', label: 'Warlock', icon: '\uD83D\uDD6F\uFE0F', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
        { id: 'wizard', label: 'Wizard', icon: '\uD83E\uDDE0', primaryStats: ['int', 'con'], secondaryStats: ['dex', 'wis'], statWeights: { int: 0.4, con: 0.2, dex: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, con: 12 } },
        { id: 'artificer', label: 'Artificer', icon: '\uD83D\uDD27', primaryStats: ['int', 'con'], secondaryStats: ['dex', 'wis'], statWeights: { int: 0.35, con: 0.25, dex: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, con: 12 } },
        { id: 'blood_hunter', label: 'Blood Hunter', icon: '\uD83D\uDD2A', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
        { id: 'gunslinger', label: 'Gunslinger', icon: '\uD83D\uDD2B', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'int'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, int: 0.15, str: 0.05 }, minStats: { dex: 13, wis: 12 } },
        { id: 'inquisitive', label: 'Inquisitive', icon: '\uD83D\uDD0D', primaryStats: ['int', 'wis'], secondaryStats: ['dex', 'cha'], statWeights: { int: 0.3, wis: 0.3, dex: 0.2, cha: 0.15, con: 0.05 }, minStats: { int: 13, wis: 13 } },
        { id: 'mystic', label: 'Mystic', icon: '\uD83E\uDDF8', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'cha'], statWeights: { int: 0.3, wis: 0.3, con: 0.2, cha: 0.15, dex: 0.05 }, minStats: { int: 13, wis: 13 } },
        { id: 'samurai', label: 'Samurai', icon: '\uD83D\uDDE1\uFE0F', primaryStats: ['str', 'wis'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, wis: 0.25, dex: 0.2, con: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
        { id: 'shadow_weaver', label: 'Shadow Weaver', icon: '\uD83C\uDF03', primaryStats: ['int', 'dex'], secondaryStats: ['cha', 'con'], statWeights: { int: 0.3, dex: 0.25, cha: 0.2, con: 0.15, wis: 0.1 }, minStats: { int: 13, dex: 13 } },
        { id: 'warden', label: 'Warden', icon: '\uD83C\uDF33', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
        { id: 'witch_hunter', label: 'Witch Hunter', icon: '\uD83D\uDD6F\uFE0F', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'int'], statWeights: { dex: 0.3, wis: 0.25, con: 0.2, int: 0.15, str: 0.1 }, minStats: { dex: 13, wis: 12 } }
    ];

    // ============================================================
    // MAGIC DEFINITIONS
    // ============================================================

    var MAGIC_TYPES = {
        earth: { id: 'earth', label: 'Earth Magic', icon: '\u26F6\uFE0F', category: 'elemental', color: '#8B7355' },
        water: { id: 'water', label: 'Water Magic', icon: '\uD83D\uDCA7', category: 'elemental', color: '#4A9BC7' },
        fire: { id: 'fire', label: 'Fire Magic', icon: '\uD83D\uDD25', category: 'elemental', color: '#E67E22' },
        air: { id: 'air', label: 'Air Magic', icon: '\uD83C\uDF2A\uFE0F', category: 'elemental', color: '#A8D5E2' },
        metal: { id: 'metal', label: 'Metal Magic', icon: '\u2692\uFE0F', category: 'elemental', color: '#95A5A6' },
        wood: { id: 'wood', label: 'Wood Magic', icon: '\uD83C\uDF33', category: 'elemental', color: '#27AE60' },
        blood: { id: 'blood', label: 'Blood Magic', icon: '\uD83E\uDE78', category: 'body', color: '#C0392B' },
        bone: { id: 'bone', label: 'Bone Magic', icon: '\uD83E\uDDB4', category: 'body', color: '#F5F5DC' },
        mind: { id: 'mind', label: 'Mind Magic', icon: '\uD83E\uDDE0', category: 'body', color: '#8E44AD' },
        morphic: { id: 'morphic', label: 'Morphic Magic', icon: '\uD83E\uDDF8', category: 'body', color: '#1ABC9C' },
        life: { id: 'life', label: 'Life Magic', icon: '\u2728', category: 'body', color: '#2ECC71' },
        death: { id: 'death', label: 'Death Magic', icon: '\u2620\uFE0F', category: 'body', color: '#2C3E50' },
        space: { id: 'space', label: 'Space Magic', icon: '\uD83C\uDF0C', category: 'aether', color: '#3498DB' },
        time: { id: 'time', label: 'Time Magic', icon: '\u23F3', category: 'aether', color: '#F39C12' },
        dimension: { id: 'dimension', label: 'Dimension Magic', icon: '\uD83C\uDF10', category: 'aether', color: '#9B59B6' },
        void: { id: 'void', label: 'Void Magic', icon: '\u25CF', category: 'aether', color: '#1A1A2E' },
        reality: { id: 'reality', label: 'Reality Magic', icon: '\uD83C\uDF0D', category: 'aether', color: '#F1C40F' },
        transference: { id: 'transference', label: 'Transference Magic', icon: '\uD83D\uDD77\uFE0F', category: 'aether', color: '#E74C3C' }
    };

    var MAGIC_CATEGORIES = {
        elemental: { label: 'Elemental Magic', icon: '\u26A1', color: '#8cbb3a' },
        body: { label: 'Body Magic', icon: '\uD83D\uDCAA', color: '#c1453c' },
        aether: { label: 'Aether Magic', icon: '\u2728', color: '#4a9bc7' }
    };

    // ============================================================
    // STAT FUNCTIONS
    // ============================================================

    function getDefaultStats() {
        return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
    }

    function getCharacterStats(char) {
        if (!char) return getDefaultStats();
        if (!char.stats) {
            char.stats = getDefaultStats();
        }
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        var hasAll = true;
        for (var i = 0; i < statKeys.length; i++) {
            if (char.stats[statKeys[i]] === undefined || char.stats[statKeys[i]] === null) {
                hasAll = false;
                break;
            }
        }
        if (!hasAll) {
            var defaultStats = getDefaultStats();
            for (var key in defaultStats) {
                if (char.stats[key] === undefined || char.stats[key] === null) {
                    char.stats[key] = defaultStats[key];
                }
            }
        }
        return char.stats;
    }

    function getAbilityModifier(score) {
        return Math.floor((parseInt(score) - 10) / 2);
    }

    function getModifierDisplay(score) {
        var mod = getAbilityModifier(score);
        return (mod >= 0 ? '+' : '') + mod;
    }

    function suggestClass(stats) {
        if (!stats) return null;

        var scores = {
            str: parseInt(stats.str) || 10,
            dex: parseInt(stats.dex) || 10,
            con: parseInt(stats.con) || 10,
            int: parseInt(stats.int) || 10,
            wis: parseInt(stats.wis) || 10,
            cha: parseInt(stats.cha) || 10
        };

        var bestClass = null;
        var bestScore = -Infinity;

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

            if (finalScore > bestScore) {
                bestScore = finalScore;
                bestClass = cls;
            }
        });

        if (!bestClass) {
            var fallbackScore = -Infinity;
            CLASS_DEFINITIONS.forEach(function(cls) {
                var total = 0;
                var totalWeight = 0;
                for (var stat in cls.statWeights) {
                    var weight = cls.statWeights[stat] || 0;
                    var score = scores[stat] || 10;
                    total += (score - 10) * weight;
                    totalWeight += weight;
                }
                var normalized = totalWeight > 0 ? total / totalWeight : 0;
                if (normalized > fallbackScore) {
                    fallbackScore = normalized;
                    bestClass = cls;
                }
            });
        }

        return bestClass;
    }

    function calculatePowerLevel(char) {
        if (!char) return 0;

        var stats = getCharacterStats(char);
        var scores = {
            str: parseInt(stats.str) || 10,
            dex: parseInt(stats.dex) || 10,
            con: parseInt(stats.con) || 10,
            int: parseInt(stats.int) || 10,
            wis: parseInt(stats.wis) || 10,
            cha: parseInt(stats.cha) || 10
        };

        var total = 0;
        for (var key in scores) {
            total += scores[key];
        }

        var classBonus = 0;
        if (char.classId) {
            var cls = CLASS_DEFINITIONS.find(function(c) { return c.id === char.classId; });
            if (cls) {
                var matchScore = 0;
                for (var stat in cls.statWeights) {
                    var weight = cls.statWeights[stat] || 0;
                    var score = scores[stat] || 10;
                    matchScore += (score - 10) * weight;
                }
                classBonus = matchScore * 0.5;
            }
        }

        return total + classBonus;
    }

    function getPowerLevelDisplay(char) {
        var power = calculatePowerLevel(char);
        var maxPower = 180;
        var percentage = Math.min(100, Math.round((power / maxPower) * 100));
        var level = Math.floor(percentage / 20);
        if (level > 4) level = 4;
        if (level < 0) level = 0;

        var filled = '\u25CF';
        var empty = '\u25CB';

        var display = '';
        for (var i = 0; i < 5; i++) {
            display += (i <= level) ? filled : empty;
        }

        return display;
    }

    function getPowerLevelFromDisplay(display) {
        var count = 0;
        for (var i = 0; i < display.length; i++) {
            if (display[i] === '\u25CF') count++;
        }
        return count || 1;
    }

    function getPowerLevelColor(level) {
        var colors = [
            'var(--text-dim)',
            'var(--warning)',
            'var(--accent)',
            'var(--info)',
            'var(--danger)'
        ];
        return colors[Math.min(level - 1, 4)] || 'var(--text-dim)';
    }

    // ============================================================
    // MAGIC FUNCTIONS
    // ============================================================

    function getDefaultMagicProficiencies() {
        var proficiencies = {};
        for (var key in MAGIC_TYPES) {
            proficiencies[key] = 0;
        }
        return proficiencies;
    }

    function getCharacterMagic(char) {
        if (!char) return getDefaultMagicProficiencies();
        if (!char.magic) {
            char.magic = getDefaultMagicProficiencies();
        }

        var hasAll = true;
        for (var key in MAGIC_TYPES) {
            if (char.magic[key] === undefined || char.magic[key] === null) {
                hasAll = false;
                break;
            }
        }

        if (!hasAll) {
            var defaultMagic = getDefaultMagicProficiencies();
            for (var key in defaultMagic) {
                if (char.magic[key] === undefined || char.magic[key] === null) {
                    char.magic[key] = defaultMagic[key];
                }
            }
        }

        return char.magic;
    }

    function calculateMagicPower(char) {
        var magic = getCharacterMagic(char);
        var total = 0;
        for (var key in magic) {
            total += parseInt(magic[key]) || 0;
        }
        return total;
    }

    function getMagicPowerDisplay(char) {
        var power = calculateMagicPower(char);
        var maxPower = MAGIC_TYPES.length * 10;
        var percentage = Math.min(100, Math.round((power / maxPower) * 100));
        var level = Math.floor(percentage / 20);
        if (level > 4) level = 4;
        if (level < 0) level = 0;

        var filled = '\u25CF';
        var empty = '\u25CB';

        var display = '';
        for (var i = 0; i < 5; i++) {
            display += (i <= level) ? filled : empty;
        }

        return display;
    }

    function suggestMagicClass(char) {
        var magic = getCharacterMagic(char);
        if (!magic) return null;

        var scores = {};
        for (var key in magic) {
            scores[key] = parseInt(magic[key]) || 0;
        }

        var categoryScores = { elemental: 0, body: 0, aether: 0 };
        var categoryCounts = { elemental: 0, body: 0, aether: 0 };

        for (var key in MAGIC_TYPES) {
            var type = MAGIC_TYPES[key];
            var score = scores[key] || 0;
            if (categoryScores[type.category] !== undefined) {
                categoryScores[type.category] += score;
                categoryCounts[type.category]++;
            }
        }

        var highestCategory = 'elemental';
        var highestAvg = 0;
        for (var cat in categoryScores) {
            if (categoryCounts[cat] > 0) {
                var avg = categoryScores[cat] / categoryCounts[cat];
                if (avg > highestAvg) {
                    highestAvg = avg;
                    highestCategory = cat;
                }
            }
        }

        var highestType = null;
        var highestScore = 0;
        for (var key in scores) {
            if (scores[key] > highestScore) {
                highestScore = scores[key];
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
            score: highestScore
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

    // ============================================================
    // EXPOSE FUNCTIONS GLOBALLY
    // ============================================================

    window.STAT_DEFINITIONS = STAT_DEFINITIONS;
    window.CLASS_DEFINITIONS = CLASS_DEFINITIONS;
    window.MAGIC_TYPES = MAGIC_TYPES;
    window.MAGIC_CATEGORIES = MAGIC_CATEGORIES;

    window.getDefaultStats = getDefaultStats;
    window.getCharacterStats = getCharacterStats;
    window.getAbilityModifier = getAbilityModifier;
    window.getModifierDisplay = getModifierDisplay;
    window.suggestClass = suggestClass;
    window.calculatePowerLevel = calculatePowerLevel;
    window.getPowerLevelDisplay = getPowerLevelDisplay;
    window.getPowerLevelFromDisplay = getPowerLevelFromDisplay;
    window.getPowerLevelColor = getPowerLevelColor;

    window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;
    window.getCharacterMagic = getCharacterMagic;
    window.calculateMagicPower = calculateMagicPower;
    window.getMagicPowerDisplay = getMagicPowerDisplay;
    window.suggestMagicClass = suggestMagicClass;
    window.getMagicLevelLabel = getMagicLevelLabel;
    window.getMagicLevelColor = getMagicLevelColor;

})();