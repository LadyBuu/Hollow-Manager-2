/**
 * js/modules/characters/character-stats.js - Character Stats & Magic System
 * Handles physical stats, magic proficiencies, class suggestions, special moves
 * Path: js/modules/characters/character-stats.js
 * 
 * This module is responsible for:
 *   - Physical stat management (STR, DEX, CON, INT, WIS, CHA)
 *   - Magic proficiency management (18 types across 3 categories)
 *   - Class suggestion based on stats
 *   - Magic class suggestion based on proficiencies
 *   - Magic power calculation and display
 *   - Special moves management (physical and magical)
 *   - UI event binding for stats/magic controls
 * 
 * IMPORTANT: All user-controlled data in special moves must be escaped.
 * Class/magic suggestions are read-only - persistence handled by parent form.
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterStatsLoaded) {
        return;
    }
    window.__characterStatsLoaded = true;

    // ============================================================
    // HTML ESCAPING - Prevents XSS in special moves
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // STAT DEFINITIONS
    // ============================================================

    var STAT_DEFINITIONS = {
        'str': { label: 'Strength', abbr: 'STR' },
        'dex': { label: 'Dexterity', abbr: 'DEX' },
        'con': { label: 'Constitution', abbr: 'CON' },
        'int': { label: 'Intelligence', abbr: 'INT' },
        'wis': { label: 'Wisdom', abbr: 'WIS' },
        'cha': { label: 'Charisma', abbr: 'CHA' }
    };

    var CLASS_DEFINITIONS = [
        { 
            id: 'warrior', 
            label: 'Warrior', 
            icon: '⚔', 
            primaryStats: ['str', 'con'], 
            secondaryStats: ['dex'], 
            statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, 
            minStats: { str: 13, con: 12 }, 
            description: 'Masters of combat who rely on strength and endurance to overpower their foes.' 
        },
        { 
            id: 'skirmisher', 
            label: 'Skirmisher', 
            icon: '🏹', 
            primaryStats: ['dex', 'wis'], 
            secondaryStats: ['con', 'str'], 
            statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, 
            minStats: { dex: 13, wis: 12 }, 
            description: 'Agile fighters who excel at ranged combat and hit-and-run tactics.' 
        },
        { 
            id: 'protector', 
            label: 'Protector', 
            icon: '🛡', 
            primaryStats: ['str', 'con'], 
            secondaryStats: ['wis', 'cha'], 
            statWeights: { str: 0.3, con: 0.3, wis: 0.2, cha: 0.15, dex: 0.05 }, 
            minStats: { str: 13, con: 12 }, 
            description: 'Defenders who shield others from harm and stand firm against any threat.' 
        },
        { 
            id: 'sage', 
            label: 'Sage', 
            icon: '📚', 
            primaryStats: ['int', 'wis'], 
            secondaryStats: ['con', 'dex'], 
            statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, 
            minStats: { int: 13, wis: 12 }, 
            description: 'Scholars and keepers of ancient knowledge who wield intellect as their weapon.' 
        },
        { 
            id: 'mystic', 
            label: 'Mystic', 
            icon: '✦', 
            primaryStats: ['wis', 'cha'], 
            secondaryStats: ['con', 'int'], 
            statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05 }, 
            minStats: { wis: 13, cha: 12 }, 
            description: 'Channelers of spiritual and arcane forces who draw power from within.' 
        },
        { 
            id: 'stalker', 
            label: 'Stalker', 
            icon: '🗡', 
            primaryStats: ['dex', 'int'], 
            secondaryStats: ['cha', 'wis'], 
            statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, 
            minStats: { dex: 13, int: 12 }, 
            description: 'Masters of stealth and subterfuge who strike from the shadows.' 
        },
        { 
            id: 'spellblade', 
            label: 'Spellblade', 
            icon: '⚡', 
            primaryStats: ['str', 'int'], 
            secondaryStats: ['dex', 'con'], 
            statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05 }, 
            minStats: { str: 13, int: 12 }, 
            description: 'Warriors who weave magic into combat, blending steel and sorcery.' 
        },
        { 
            id: 'channeler', 
            label: 'Channeler', 
            icon: '✦', 
            primaryStats: ['cha', 'con'], 
            secondaryStats: ['dex', 'int'], 
            statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, 
            minStats: { cha: 13, con: 12 }, 
            description: 'Mages who channel raw magical energy through force of personality.' 
        },
        { 
            id: 'warden', 
            label: 'Warden', 
            icon: '⚔', 
            primaryStats: ['str', 'wis'], 
            secondaryStats: ['con', 'dex'], 
            statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, 
            minStats: { str: 13, wis: 12 }, 
            description: 'Guardians of nature and natural order who protect the wild places.' 
        },
        { 
            id: 'adept', 
            label: 'Adept', 
            icon: '✦', 
            primaryStats: ['dex', 'wis'], 
            secondaryStats: ['con', 'str'], 
            statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, 
            minStats: { dex: 13, wis: 13 }, 
            description: 'Masters of mind-body discipline who achieve perfection through training.' 
        },
        { 
            id: 'artificer', 
            label: 'Artificer', 
            icon: '⚙', 
            primaryStats: ['int', 'dex'], 
            secondaryStats: ['con', 'wis'], 
            statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05 }, 
            minStats: { int: 13, dex: 12 }, 
            description: 'Inventors and creators of wondrous devices who blend magic with craft.' 
        },
        { 
            id: 'occultist', 
            label: 'Occultist', 
            icon: '✦', 
            primaryStats: ['int', 'cha'], 
            secondaryStats: ['con', 'dex'], 
            statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05 }, 
            minStats: { int: 13, cha: 13 }, 
            description: 'Seekers of forbidden and hidden knowledge who bargain with dark powers.' 
        },
        { 
            id: 'blade_dancer', 
            label: 'Blade Dancer', 
            icon: '🗡', 
            primaryStats: ['dex', 'cha'], 
            secondaryStats: ['str', 'con'], 
            statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05 }, 
            minStats: { dex: 13, cha: 12 }, 
            description: 'Graceful warriors who move like the wind, turning combat into art.' 
        },
        { 
            id: 'elementalist', 
            label: 'Elementalist', 
            icon: '✦', 
            primaryStats: ['int', 'wis'], 
            secondaryStats: ['con', 'dex'], 
            statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, 
            minStats: { int: 13, wis: 12 }, 
            description: 'Masters of the primal elements who command fire, water, earth, and air.' 
        },
        { 
            id: 'sentinel', 
            label: 'Sentinel', 
            icon: '🛡', 
            primaryStats: ['str', 'con'], 
            secondaryStats: ['wis', 'dex'], 
            statWeights: { str: 0.3, con: 0.3, wis: 0.2, dex: 0.15, cha: 0.05 }, 
            minStats: { str: 13, con: 12 }, 
            description: 'Unyielding guardians and protectors who never retreat from their duty.' 
        }
    ];

    // ============================================================
    // MAGIC DEFINITIONS
    // ============================================================

    var MAGIC_TYPES = {
        earth: { id: 'earth', label: 'Earth Magic', category: 'elemental', color: '#8B7355' },
        water: { id: 'water', label: 'Water Magic', category: 'elemental', color: '#4A9BC7' },
        fire: { id: 'fire', label: 'Fire Magic', category: 'elemental', color: '#E67E22' },
        air: { id: 'air', label: 'Air Magic', category: 'elemental', color: '#A8D5E2' },
        metal: { id: 'metal', label: 'Metal Magic', category: 'elemental', color: '#95A5A6' },
        wood: { id: 'wood', label: 'Wood Magic', category: 'elemental', color: '#27AE60' },
        blood: { id: 'blood', label: 'Blood Magic', category: 'body', color: '#C0392B' },
        bone: { id: 'bone', label: 'Bone Magic', category: 'body', color: '#F5F5DC' },
        mind: { id: 'mind', label: 'Mind Magic', category: 'body', color: '#8E44AD' },
        morphic: { id: 'morphic', label: 'Morphic Magic', category: 'body', color: '#1ABC9C' },
        life: { id: 'life', label: 'Life Magic', category: 'body', color: '#2ECC71' },
        death: { id: 'death', label: 'Death Magic', category: 'body', color: '#2C3E50' },
        space: { id: 'space', label: 'Space Magic', category: 'aether', color: '#3498DB' },
        time: { id: 'time', label: 'Time Magic', category: 'aether', color: '#F39C12' },
        dimension: { id: 'dimension', label: 'Dimension Magic', category: 'aether', color: '#9B59B6' },
        void: { id: 'void', label: 'Void Magic', category: 'aether', color: '#1A1A2E' },
        reality: { id: 'reality', label: 'Reality Magic', category: 'aether', color: '#F1C40F' },
        transference: { id: 'transference', label: 'Transference Magic', category: 'aether', color: '#E74C3C' }
    };

    var MAGIC_CATEGORIES = {
        elemental: { label: 'Elemental Magic', color: '#8cbb3a' },
        body: { label: 'Body Magic', color: '#c1453c' },
        aether: { label: 'Aether Magic', color: '#4a9bc7' }
    };

    // ============================================================
    // MAGIC TYPE HELPERS
    // ============================================================

    function getMagicTypeKeys() {
        return Object.keys(MAGIC_TYPES);
    }

    function getMagicCategoryTypes(category) {
        var result = [];
        for (var key in MAGIC_TYPES) {
            if (MAGIC_TYPES[key].category === category) {
                result.push(key);
            }
        }
        return result;
    }

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
            return char.stats;
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

    function updateClassSuggestion() {
        var str = parseInt(document.getElementById('char-str') ? document.getElementById('char-str').value : 10) || 10;
        var dex = parseInt(document.getElementById('char-dex') ? document.getElementById('char-dex').value : 10) || 10;
        var con = parseInt(document.getElementById('char-con') ? document.getElementById('char-con').value : 10) || 10;
        var int = parseInt(document.getElementById('char-int') ? document.getElementById('char-int').value : 10) || 10;
        var wis = parseInt(document.getElementById('char-wis') ? document.getElementById('char-wis').value : 10) || 10;
        var cha = parseInt(document.getElementById('char-cha') ? document.getElementById('char-cha').value : 10) || 10;

        var stats = { str: str, dex: dex, con: con, int: int, wis: wis, cha: cha };
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
        var keys = getMagicTypeKeys();
        keys.forEach(function(key) {
            proficiencies[key] = 0;
        });
        return proficiencies;
    }

    function getCharacterMagic(char) {
        if (!char) return getDefaultMagicProficiencies();
        if (!char.magic) {
            char.magic = getDefaultMagicProficiencies();
            return char.magic;
        }

        var keys = getMagicTypeKeys();
        var hasAll = true;
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
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
        var keys = getMagicTypeKeys();
        keys.forEach(function(key) {
            total += parseInt(magic[key]) || 0;
        });
        return total;
    }

    function getMagicPowerDisplay(char) {
        var power = calculateMagicPower(char);
        var maxPower = getMagicTypeKeys().length * 10;
        var percentage = Math.min(100, Math.round((power / maxPower) * 100));
        var filledCount = Math.ceil(percentage / 20);

        var display = '';
        for (var i = 0; i < 5; i++) {
            display += i < filledCount ? '●' : '○';
        }

        return display + ' (' + power + '/' + maxPower + ')';
    }

    function updateMagicPowerDisplay() {
        var el = document.getElementById('magic-power-display-text');
        if (!el) return;

        var magic = {};
        var keys = getMagicTypeKeys();
        keys.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            magic[key] = input ? parseInt(input.value) || 0 : 0;
        });

        var tempChar = { magic: magic };
        el.textContent = getMagicPowerDisplay(tempChar);
    }

    function suggestMagicClass(char) {
        var magic = getCharacterMagic(char);
        if (!magic) return null;

        var scores = {};
        var keys = getMagicTypeKeys();
        keys.forEach(function(key) {
            scores[key] = parseInt(magic[key]) || 0;
        });

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

        // Find winning category by average
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

        // Find highest type WITHIN the winning category
        var highestType = null;
        var highestScore = -1;
        for (var key in scores) {
            if (MAGIC_TYPES[key].category !== highestCategory) continue;
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

    function updateMagicClassSuggestion() {
        var magic = {};
        var keys = getMagicTypeKeys();
        keys.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            magic[key] = input ? parseInt(input.value) || 0 : 0;
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
        var categoryTypes = getMagicCategoryTypes(category);
        var magic = {};
        categoryTypes.forEach(function(key) {
            var roll = Math.random();
            if (roll < 0.3) {
                magic[key] = 0;
            } else if (roll < 0.6) {
                magic[key] = Math.floor(Math.random() * 3) + 1;  // 1-3
            } else if (roll < 0.85) {
                magic[key] = Math.floor(Math.random() * 3) + 4;  // 4-6
            } else {
                magic[key] = Math.floor(Math.random() * 3) + 7;  // 7-9
            }
        });
        return magic;
    }

    // ============================================================
    // SPECIAL MOVES FUNCTIONS - WITH XSS PROTECTION
    // ============================================================

    function getSpecialMoves(char) {
        if (!char) return { physical: [], magical: [] };
        if (!char.specialMoves) {
            char.specialMoves = { physical: [], magical: [] };
        }
        if (!char.specialMoves.physical) char.specialMoves.physical = [];
        if (!char.specialMoves.magical) char.specialMoves.magical = [];
        return char.specialMoves;
    }

    function addSpecialMove(char, type, name, description) {
        if (!char) return false;
        var moves = getSpecialMoves(char);
        if (!moves[type]) moves[type] = [];
        moves[type].push({
            name: name || 'Unnamed Move',
            description: description || ''
        });
        return true;
    }

    function removeSpecialMove(char, type, index) {
        if (!char) return false;
        var moves = getSpecialMoves(char);
        if (!moves[type]) return false;
        if (index < 0 || index >= moves[type].length) return false;
        moves[type].splice(index, 1);
        return true;
    }

    function renderSpecialMoves(containerId, moves, type) {
        var container = document.getElementById(containerId);
        if (!container) return;

        if (!moves || moves.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p>';
            return;
        }

        var color = type === 'physical' ? 'var(--accent)' : 'var(--info)';
        var html = '';
        moves.forEach(function(move, index) {
            html += '<div class="special-move-entry" style="display:flex;justify-content:space-between;align-items:center;padding:2px 4px;border-left:2px solid ' + color + ';background:var(--bg);border-radius:3px;margin-bottom:2px;font-size:0.65rem;">';
            html += '<div><span class="move-name" style="font-weight:600;">' + escapeHtml(move.name) + '</span> <span class="move-desc" style="color:var(--text-dim);font-size:0.55rem;">' + escapeHtml(move.description || '') + '</span></div>';
            html += '<button class="remove-special-move small" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;" data-type="' + type + '" data-index="' + index + '">✕</button>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.remove-special-move').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var form = document.getElementById('char-form');
                var editId = form ? form.dataset.editId : null;
                if (!editId) {
                    alert('Please save the character first.');
                    return;
                }
                var char = window.getCharacterById(editId);
                if (!char) return;
                var type = this.dataset.type;
                var index = parseInt(this.dataset.index);
                removeSpecialMove(char, type, index);
                var moves = getSpecialMoves(char);
                renderSpecialMoves('physical-moves-list', moves.physical, 'physical');
                renderSpecialMoves('magical-moves-list', moves.magical, 'magical');
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
            });
        });
    }

    // ============================================================
    // STATS TAB HTML
    // ============================================================

    function getStatsTabHTML() {
        return `
            <div class="stat-input-group" style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;">
                ${['str','dex','con','int','wis','cha'].map(function(stat) {
                    return `
                        <div class="form-group">
                            <label style="font-size:0.55rem;text-align:center;display:block;">${stat.toUpperCase()}</label>
                            <input type="number" id="char-${stat}" min="1" max="30" value="10" 
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
                        <input type="number" id="magic-${key}" min="0" max="10" value="0" 
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
                </select>
                <button type="button" id="recalculate-magic-class-btn" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Recalc</button>
            </div>
            <div class="magic-power-display" style="margin-top:6px;font-size:0.7rem;color:var(--text-dim);">
                Magic Power: <span id="magic-power-display-text">○○○○○ (0/180)</span>
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
                    <div id="physical-moves-list" class="moves-list" style="margin-top:2px;max-height:70px;overflow-y:auto;"><p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p></div>
                    <div class="move-input-group" style="margin-top:4px;">
                        <input type="text" id="physical-move-name" placeholder="Move name" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <input type="text" id="physical-move-desc" placeholder="Description" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <button type="button" id="add-physical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                    </div>
                </div>
                <div class="moves-column" style="background:var(--panel-alt);padding:6px;border-radius:6px;border:1px solid var(--border-soft);">
                    <label class="move-label magical" style="font-size:0.65rem;font-weight:600;color:var(--info);">Magical Moves</label>
                    <div id="magical-moves-list" class="moves-list" style="margin-top:2px;max-height:70px;overflow-y:auto;"><p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p></div>
                    <div class="move-input-group" style="margin-top:4px;">
                        <input type="text" id="magical-move-name" placeholder="Move name" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <input type="text" id="magical-move-desc" placeholder="Description" style="width:100%;padding:2px 4px;font-size:0.6rem;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;margin-bottom:2px;" />
                        <button type="button" id="add-magical-move-btn" class="small primary" style="font-size:0.6rem;padding:2px 8px;">+ Add</button>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // EVENT INITIALIZATION
    // ============================================================

    function initStatsEvents() {
        var statInputs = ['char-str', 'char-dex', 'char-con', 'char-int', 'char-wis', 'char-cha'];
        statInputs.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', function() {
                    var val = parseInt(this.value);
                    if (isNaN(val)) val = 10;
                    if (val < 1) val = 1;
                    if (val > 30) val = 30;
                    this.value = val;
                    updateClassSuggestion();
                });
            }
        });

        var classSelect = document.getElementById('manual-class-select');
        if (classSelect) {
            populateClassSelect();
            classSelect.addEventListener('change', function() {
                var display = document.getElementById('suggested-class');
                var descDisplay = document.getElementById('class-description-display');
                
                if (this.value) {
                    var selected = CLASS_DEFINITIONS.find(function(c) { return c.id === this.value; }.bind(this));
                    if (selected) {
                        display.textContent = (selected.icon || '') + ' ' + (selected.label || '');
                        display.style.color = 'var(--accent)';
                        display.style.background = 'var(--accent-soft)';
                        display.style.borderColor = 'var(--accent)';
                        if (descDisplay) {
                            descDisplay.textContent = selected.description || 'No description available.';
                            descDisplay.style.borderLeftColor = 'var(--accent)';
                            descDisplay.style.color = 'var(--text)';
                        }
                    }
                } else {
                    updateClassSuggestion();
                    if (descDisplay) {
                        descDisplay.textContent = 'Select a class to see its description here.';
                        descDisplay.style.borderLeftColor = 'var(--accent)';
                        descDisplay.style.color = 'var(--text-dim)';
                    }
                }
            });
        }

        var recalcBtn = document.getElementById('recalculate-class-btn');
        if (recalcBtn) {
            recalcBtn.addEventListener('click', updateClassSuggestion);
        }

        var randomBtn = document.getElementById('random-stats-btn');
        if (randomBtn) {
            randomBtn.addEventListener('click', function() {
                var stats = generateRandomStats();
                document.getElementById('char-str').value = stats.str;
                document.getElementById('char-dex').value = stats.dex;
                document.getElementById('char-con').value = stats.con;
                document.getElementById('char-int').value = stats.int;
                document.getElementById('char-wis').value = stats.wis;
                document.getElementById('char-cha').value = stats.cha;
                updateClassSuggestion();
            });
        }
    }

    function populateClassSelect() {
        var select = document.getElementById('manual-class-select');
        if (!select) return;
        
        var currentValue = select.value || '';
        select.innerHTML = '<option value="">Auto-suggest</option>';
        
        CLASS_DEFINITIONS.forEach(function(cls) {
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

    function initMagicEvents() {
        var magicInputs = getMagicTypeKeys();
        magicInputs.forEach(function(key) {
            var id = 'magic-' + key;
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', function() {
                    var val = parseInt(this.value);
                    if (isNaN(val)) val = 0;
                    if (val < 0) val = 0;
                    if (val > 10) val = 10;
                    this.value = val;
                    updateMagicClassSuggestion();
                    updateMagicPowerDisplay();
                });
            }
        });

        var magicClassSelect = document.getElementById('manual-magic-class-select');
        if (magicClassSelect) {
            var magicOptions = [
                { value: '', label: 'Auto-suggest' },
                { value: 'elementalist', label: 'Elementalist' },
                { value: 'body_mage', label: 'Body Mage' },
                { value: 'aether_mage', label: 'Aether Mage' }
            ];
            var classMap = {
                elemental: { earth: 'Geomancer', water: 'Hydromancer', fire: 'Pyromancer',
                    air: 'Aeromancer', metal: 'Ferromancer', wood: 'Dendromancer' },
                body: { blood: 'Hemomancer', bone: 'Osteomancer', mind: 'Psychomancer',
                    morphic: 'Morphomancer', life: 'Vitalmancer', death: 'Necromancer' },
                aether: { space: 'Spatiomancer', time: 'Chronomancer', dimension: 'Dimensionist',
                    void: 'Voidmancer', reality: 'Reality Weaver', transference: 'Transference Mage' }
            };
            for (var cat in classMap) {
                for (var type in classMap[cat]) {
                    magicOptions.push({ value: type, label: classMap[cat][type] });
                }
            }
            magicClassSelect.innerHTML = '';
            magicOptions.forEach(function(opt) {
                var option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                magicClassSelect.appendChild(option);
            });
            magicClassSelect.addEventListener('change', function() {
                var display = document.getElementById('suggested-magic-class');
                if (this.value) {
                    var selected = magicOptions.find(function(o) { return o.value === this.value; }.bind(this));
                    if (selected) {
                        display.textContent = selected.label;
                        display.style.color = 'var(--info)';
                        display.style.background = 'var(--info-soft)';
                        display.style.borderColor = 'var(--info)';
                    }
                } else {
                    updateMagicClassSuggestion();
                }
            });
        }

        var recalcMagicBtn = document.getElementById('recalculate-magic-class-btn');
        if (recalcMagicBtn) {
            recalcMagicBtn.addEventListener('click', function() {
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();
            });
        }

        var randomElementalBtn = document.getElementById('random-elemental-btn');
        if (randomElementalBtn) {
            randomElementalBtn.addEventListener('click', function() {
                var magic = generateRandomMagicCategory('elemental');
                var types = getMagicCategoryTypes('elemental');
                types.forEach(function(key) {
                    var input = document.getElementById('magic-' + key);
                    if (input && magic[key] !== undefined) {
                        input.value = magic[key];
                    }
                });
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();
            });
        }

        var randomBodyBtn = document.getElementById('random-body-btn');
        if (randomBodyBtn) {
            randomBodyBtn.addEventListener('click', function() {
                var magic = generateRandomMagicCategory('body');
                var types = getMagicCategoryTypes('body');
                types.forEach(function(key) {
                    var input = document.getElementById('magic-' + key);
                    if (input && magic[key] !== undefined) {
                        input.value = magic[key];
                    }
                });
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();
            });
        }

        var randomAetherBtn = document.getElementById('random-aether-btn');
        if (randomAetherBtn) {
            randomAetherBtn.addEventListener('click', function() {
                var magic = generateRandomMagicCategory('aether');
                var types = getMagicCategoryTypes('aether');
                types.forEach(function(key) {
                    var input = document.getElementById('magic-' + key);
                    if (input && magic[key] !== undefined) {
                        input.value = magic[key];
                    }
                });
                updateMagicClassSuggestion();
                updateMagicPowerDisplay();
            });
        }
    }

    function initSpecialMovesEvents() {
        var addPhysicalBtn = document.getElementById('add-physical-move-btn');
        if (addPhysicalBtn) {
            addPhysicalBtn.addEventListener('click', function() {
                var form = document.getElementById('char-form');
                var editId = form ? form.dataset.editId : null;
                if (!editId) {
                    alert('Please save the character first.');
                    return;
                }
                var char = window.getCharacterById(editId);
                if (!char) return;
                var name = document.getElementById('physical-move-name').value.trim();
                var desc = document.getElementById('physical-move-desc').value.trim();
                if (!name) { alert('Please enter a move name.'); return; }
                addSpecialMove(char, 'physical', name, desc);
                var moves = getSpecialMoves(char);
                renderSpecialMoves('physical-moves-list', moves.physical, 'physical');
                document.getElementById('physical-move-name').value = '';
                document.getElementById('physical-move-desc').value = '';
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
            });
        }

        var addMagicalBtn = document.getElementById('add-magical-move-btn');
        if (addMagicalBtn) {
            addMagicalBtn.addEventListener('click', function() {
                var form = document.getElementById('char-form');
                var editId = form ? form.dataset.editId : null;
                if (!editId) {
                    alert('Please save the character first.');
                    return;
                }
                var char = window.getCharacterById(editId);
                if (!char) return;
                var name = document.getElementById('magical-move-name').value.trim();
                var desc = document.getElementById('magical-move-desc').value.trim();
                if (!name) { alert('Please enter a move name.'); return; }
                addSpecialMove(char, 'magical', name, desc);
                var moves = getSpecialMoves(char);
                renderSpecialMoves('magical-moves-list', moves.magical, 'magical');
                document.getElementById('magical-move-name').value = '';
                document.getElementById('magical-move-desc').value = '';
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStats = {
        // Stat definitions
        STAT_DEFINITIONS: STAT_DEFINITIONS,
        CLASS_DEFINITIONS: CLASS_DEFINITIONS,
        MAGIC_TYPES: MAGIC_TYPES,
        MAGIC_CATEGORIES: MAGIC_CATEGORIES,

        // Magic helpers
        getMagicTypeKeys: getMagicTypeKeys,
        getMagicCategoryTypes: getMagicCategoryTypes,

        // Stat functions
        getDefaultStats: getDefaultStats,
        getCharacterStats: getCharacterStats,
        getAbilityModifier: getAbilityModifier,
        getModifierDisplay: getModifierDisplay,
        generateRandomStats: generateRandomStats,

        // Class suggestion
        suggestClass: suggestClass,
        updateClassSuggestion: updateClassSuggestion,

        // Magic functions
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

        // Special moves
        getSpecialMoves: getSpecialMoves,
        addSpecialMove: addSpecialMove,
        removeSpecialMove: removeSpecialMove,
        renderSpecialMoves: renderSpecialMoves,

        // HTML generation
        getStatsTabHTML: getStatsTabHTML,
        getMagicTabHTML: getMagicTabHTML,
        getSpecialMovesHTML: getSpecialMovesHTML,

        // Event initialization
        initStatsEvents: initStatsEvents,
        initMagicEvents: initMagicEvents,
        initSpecialMovesEvents: initSpecialMovesEvents,
        populateClassSelect: populateClassSelect
    };

})();
