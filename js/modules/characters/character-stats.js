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
        'str': { label: 'Strength', icon: '💪', abbr: 'STR' },
        'dex': { label: 'Dexterity', icon: '🎯', abbr: 'DEX' },
        'con': { label: 'Constitution', icon: '🛡️', abbr: 'CON' },
        'int': { label: 'Intelligence', icon: '🧠', abbr: 'INT' },
        'wis': { label: 'Wisdom', icon: '🧘', abbr: 'WIS' },
        'cha': { label: 'Charisma', icon: '💬', abbr: 'CHA' }
    };

    // Updated class definitions - more generic, removed culturally specific names
    var CLASS_DEFINITIONS = [
        { id: 'warrior', label: 'Warrior', icon: '⚔️', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 }, description: 'Masters of combat and physical prowess' },
        { id: 'skirmisher', label: 'Skirmisher', icon: '🏹', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 }, description: 'Agile fighters who excel at ranged combat' },
        { id: 'protector', label: 'Protector', icon: '🛡️', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'cha'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, cha: 0.15, dex: 0.05 }, minStats: { str: 13, con: 12 }, description: 'Defenders who shield others from harm' },
        { id: 'sage', label: 'Sage', icon: '📚', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 }, description: 'Scholars and keepers of ancient knowledge' },
        { id: 'mystic', label: 'Mystic', icon: '🔮', primaryStats: ['wis', 'cha'], secondaryStats: ['con', 'int'], statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05 }, minStats: { wis: 13, cha: 12 }, description: 'Channelers of spiritual and arcane forces' },
        { id: 'stalker', label: 'Stalker', icon: '🗡️', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 }, description: 'Masters of stealth and subterfuge' },
        { id: 'spellblade', label: 'Spellblade', icon: '⚡', primaryStats: ['str', 'int'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05 }, minStats: { str: 13, int: 12 }, description: 'Warriors who weave magic into combat' },
        { id: 'channeler', label: 'Channeler', icon: '🌀', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 }, description: 'Mages who channel raw magical energy' },
        { id: 'warden', label: 'Warden', icon: '🌿', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 }, description: 'Guardians of nature and natural order' },
        { id: 'adept', label: 'Adept', icon: '🧘', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 }, description: 'Masters of mind-body discipline' },
        { id: 'artificer', label: 'Artificer', icon: '🔧', primaryStats: ['int', 'dex'], secondaryStats: ['con', 'wis'], statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, dex: 12 }, description: 'Inventors and creators of wondrous devices' },
        { id: 'occultist', label: 'Occultist', icon: '🌙', primaryStats: ['int', 'cha'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05 }, minStats: { int: 13, cha: 13 }, description: 'Seekers of forbidden and hidden knowledge' },
        { id: 'blade_dancer', label: 'Blade Dancer', icon: '🗡️', primaryStats: ['dex', 'cha'], secondaryStats: ['str', 'con'], statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05 }, minStats: { dex: 13, cha: 12 }, description: 'Graceful warriors who move like the wind' },
        { id: 'elementalist', label: 'Elementalist', icon: '🌪️', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 }, description: 'Masters of the primal elements' },
        { id: 'sentinel', label: 'Sentinel', icon: '🏰', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'dex'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, dex: 0.15, cha: 0.05 }, minStats: { str: 13, con: 12 }, description: 'Unyielding guardians and protectors' }
    ];

    // ============================================================
    // MAGIC DEFINITIONS
    // ============================================================

    var MAGIC_TYPES = {
        earth: { id: 'earth', label: 'Earth Magic', icon: '⛰️', category: 'elemental', color: '#8B7355' },
        water: { id: 'water', label: 'Water Magic', icon: '🌊', category: 'elemental', color: '#4A9BC7' },
        fire: { id: 'fire', label: 'Fire Magic', icon: '🔥', category: 'elemental', color: '#E67E22' },
        air: { id: 'air', label: 'Air Magic', icon: '🌬️', category: 'elemental', color: '#A8D5E2' },
        metal: { id: 'metal', label: 'Metal Magic', icon: '⚙️', category: 'elemental', color: '#95A5A6' },
        wood: { id: 'wood', label: 'Wood Magic', icon: '🌳', category: 'elemental', color: '#27AE60' },
        blood: { id: 'blood', label: 'Blood Magic', icon: '🩸', category: 'body', color: '#C0392B' },
        bone: { id: 'bone', label: 'Bone Magic', icon: '🦴', category: 'body', color: '#F5F5DC' },
        mind: { id: 'mind', label: 'Mind Magic', icon: '🧠', category: 'body', color: '#8E44AD' },
        morphic: { id: 'morphic', label: 'Morphic Magic', icon: '🌀', category: 'body', color: '#1ABC9C' },
        life: { id: 'life', label: 'Life Magic', icon: '✨', category: 'body', color: '#2ECC71' },
        death: { id: 'death', label: 'Death Magic', icon: '💀', category: 'body', color: '#2C3E50' },
        space: { id: 'space', label: 'Space Magic', icon: '🌌', category: 'aether', color: '#3498DB' },
        time: { id: 'time', label: 'Time Magic', icon: '⏳', category: 'aether', color: '#F39C12' },
        dimension: { id: 'dimension', label: 'Dimension Magic', icon: '🌐', category: 'aether', color: '#9B59B6' },
        void: { id: 'void', label: 'Void Magic', icon: '⚫', category: 'aether', color: '#1A1A2E' },
        reality: { id: 'reality', label: 'Reality Magic', icon: '🌀', category: 'aether', color: '#F1C40F' },
        transference: { id: 'transference', label: 'Transference Magic', icon: '🔄', category: 'aether', color: '#E74C3C' }
    };

    var MAGIC_CATEGORIES = {
        elemental: { label: 'Elemental Magic', icon: '⚡', color: '#8cbb3a' },
        body: { label: 'Body Magic', icon: '💪', color: '#c1453c' },
        aether: { label: 'Aether Magic', icon: '✨', color: '#4a9bc7' }
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

        var filled = '●';
        var empty = '○';

        var display = '';
        for (var i = 0; i < 5; i++) {
            display += (i <= level) ? filled : empty;
        }

        return display;
    }

    function getPowerLevelFromDisplay(display) {
        var count = 0;
        for (var i = 0; i < display.length; i++) {
            if (display[i] === '●') count++;
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

    function getClassDescription(classId) {
        var cls = CLASS_DEFINITIONS.find(function(c) { return c.id === classId; });
        return cls ? cls.description : '';
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

        var filled = '●';
        var empty = '○';

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
    window.getClassDescription = getClassDescription;

    window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;
    window.getCharacterMagic = getCharacterMagic;
    window.calculateMagicPower = calculateMagicPower;
    window.getMagicPowerDisplay = getMagicPowerDisplay;
    window.suggestMagicClass = suggestMagicClass;
    window.getMagicLevelLabel = getMagicLevelLabel;
    window.getMagicLevelColor = getMagicLevelColor;

    console.log('character-stats.js loaded');

})();
