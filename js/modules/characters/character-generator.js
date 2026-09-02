/**
 * modules/characters/character-generator.js - Character Generator
 * Dedicated module for random character generation
 * Path: js/modules/characters/character-generator.js
 * 
 * This module is responsible for:
 *   - Generating random physical appearance data
 *   - Generating random personality traits
 *   - Generating random stats
 *   - Generating random magic proficiencies
 *   - Generating complete random characters (for testing/quick creation)
 * 
 * IMPORTANT:
 *   - This module GENERATES DATA only - it does NOT save or mutate state
 *   - All functions are PURE (return data, no side effects)
 *   - No DOM manipulation
 *   - No persistence calls
 *   - Results can be used by CharacterForm or CharacterStats
 * 
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js)
 *   - window.CoreUtils (from core-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterGeneratorLoaded) {
        return;
    }
    window.__characterGeneratorLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!window.CharacterConstants) {
            missing.push('CharacterConstants');
        }

        if (!window.CoreUtils || typeof window.CoreUtils.generateId !== 'function') {
            missing.push('CoreUtils.generateId');
        }

        if (missing.length > 0) {
            console.warn('CharacterGenerator: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // GENERATION POOLS
    // ============================================================

    var PHYSICAL_POOLS = {
        genders: ['Male', 'Female', 'Non-binary', 'Genderfluid', 'Agender', 'Other'],
        eyeColours: [
            'Blue', 'Brown', 'Green', 'Grey', 'Hazel', 'Amber', 'Violet', 
            'Black', 'Honey', 'Silver', 'Gold', 'Heterochromia'
        ],
        hairColours: [
            'Blonde', 'Brown', 'Black', 'Red', 'Auburn', 'Chestnut', 
            'Silver', 'White', 'Platinum', 'Honey', 'Strawberry Blonde', 
            'Raven', 'Salt and Pepper', 'Ginger'
        ],
        skinTones: [
            'Fair', 'Olive', 'Light Brown', 'Dark Brown', 'Pale', 'Tan', 
            'Ebony', 'Porcelain', 'Warm Beige', 'Cool Beige', 'Golden'
        ],
        builds: [
            'Slim', 'Athletic', 'Broad', 'Stocky', 'Lithe', 'Muscular', 
            'Willowy', 'Compact', 'Heavy', 'Lean', 'Hourglass', 'Pear-shaped',
            'Apple-shaped', 'Rugged'
        ],
        heights: [
            '152cm', '155cm', '158cm', '160cm', '163cm', '165cm', '168cm', 
            '170cm', '173cm', '175cm', '178cm', '180cm', '183cm', '185cm', 
            '188cm', '190cm', '193cm', '195cm', '198cm'
        ],
        weights: [
            '52kg', '55kg', '58kg', '60kg', '63kg', '65kg', '68kg', '70kg', 
            '73kg', '75kg', '78kg', '80kg', '83kg', '85kg', '88kg', '90kg', 
            '93kg', '95kg', '98kg', '100kg'
        ]
    };

    var PERSONALITY_POOLS = {
        traits: [
            'Brave, Honest, Loyal', 'Cunning, Ambitious, Charming', 
            'Wise, Patient, Kind', 'Fierce, Proud, Determined', 
            'Quiet, Observant, Clever', 'Bold, Reckless, Passionate',
            'Calm, Collected, Strategic', 'Playful, Curious, Optimistic', 
            'Gruff, Loyal, Protective', 'Elegant, Diplomatic, Calculating',
            'Wild, Free-spirited, Intuitive', 'Stoic, Disciplined, Focused',
            'Warm, Empathetic, Nurturing', 'Sharp, Witty, Sarcastic',
            'Brooding, Intense, Mysterious', 'Cheerful, Bubbly, Energetic'
        ],
        ideals: [
            'Honor and Duty', 'Freedom and Choice', 'Knowledge and Truth',
            'Justice and Fairness', 'Power and Ambition', 'Peace and Harmony',
            'Tradition and Order', 'Change and Progress', 'Loyalty and Family',
            'Individuality and Expression', 'Balance and Moderation',
            'Courage and Sacrifice', 'Wisdom and Understanding'
        ],
        bonds: [
            'Protecting their family', 'A childhood friend', 'Their homeland',
            'A mentor who saved them', 'A sacred oath', 'Their closest ally',
            'A lost loved one', 'Their honor', 'A promise made',
            'Their community', 'A beloved pet', 'A treasured artifact',
            'A secret they must protect', 'A rival they respect'
        ],
        flaws: [
            'Too trusting', 'Quick to anger', 'Afraid of failure',
            'Reckless in pursuit of goals', 'Too proud to ask for help',
            'Haunted by a past mistake', 'Perfectionist', 'Distrustful of others',
            'Impulsive', 'Overly cautious', 'Self-doubting', 'Stubborn',
            'Vengeful', 'Secretive', 'Overconfident', 'Indecisive'
        ],
        alignments: [
            'Lawful Good', 'Neutral Good', 'Chaotic Good',
            'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
            'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'
        ],
        likes: [
            'Music', 'Books', 'Nature', 'Art', 'Animals', 'Good Food', 
            'Stories', 'Games', 'Dancing', 'Travel', 'History', 'Science',
            'Crafting', 'Gardening', 'Cooking', 'Meditation', 'Training'
        ],
        dislikes: [
            'Lies', 'Cruelty', 'Arrogance', 'Crowds', 'Loud Noises', 
            'Injustice', 'Boredom', 'Betrayal', 'Ignorance', 'Greed',
            'Dishonesty', 'Haste', 'Chaos', 'Complacency'
        ],
        habits: [
            'Hums while working', 'Taps fingers when thinking', 
            'Collects small trinkets', 'Talks to themselves', 
            'Fidgets with a lucky charm', 'Paces while thinking',
            'Cracks knuckles', 'Twirls hair', 'Adjusts glasses',
            'Chews lip', 'Drumming fingers', 'Whistles tunelessly'
        ],
        fears: [
            'Heights', 'Spiders', 'Claustrophobia', 'Being forgotten', 
            'Failure', 'Loss of control', 'Drowning', 'Fire', 'Darkness',
            'Rejection', 'Betrayal', 'Being trapped', 'The unknown',
            'Losing loved ones', 'Becoming a monster', 'Madness'
        ],
        goals: [
            'To protect the innocent', 'To achieve greatness', 
            'To find purpose', 'To restore honor', 'To discover truth', 
            'To build something lasting', 'To master a craft',
            'To find redemption', 'To explore the unknown',
            'To create a better world', 'To prove themselves worthy'
        ]
    };

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================

    function pickRandom(arr) {
        if (!Array.isArray(arr) || arr.length === 0) {
            return null;
        }
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // ============================================================
    // GENERATION FUNCTIONS
    // ============================================================

    /**
     * Generate random physical appearance data.
     * @returns {object} Physical appearance data
     */
    function generatePhysical() {
        return {
            gender: pickRandom(PHYSICAL_POOLS.genders) || 'Other',
            eyes: pickRandom(PHYSICAL_POOLS.eyeColours) || 'Brown',
            hair: pickRandom(PHYSICAL_POOLS.hairColours) || 'Brown',
            skin: pickRandom(PHYSICAL_POOLS.skinTones) || 'Fair',
            height: pickRandom(PHYSICAL_POOLS.heights) || '175cm',
            weight: pickRandom(PHYSICAL_POOLS.weights) || '70kg',
            build: pickRandom(PHYSICAL_POOLS.builds) || 'Slim'
        };
    }

    /**
     * Generate random personality data.
     * @returns {object} Personality data
     */
    function generatePersonality() {
        return {
            traits: pickRandom(PERSONALITY_POOLS.traits) || 'Brave, Honest, Loyal',
            ideals: pickRandom(PERSONALITY_POOLS.ideals) || 'Honor and Duty',
            bonds: pickRandom(PERSONALITY_POOLS.bonds) || 'Protecting their family',
            flaws: pickRandom(PERSONALITY_POOLS.flaws) || 'Too trusting',
            alignment: pickRandom(PERSONALITY_POOLS.alignments) || 'Neutral Good',
            likes: pickRandom(PERSONALITY_POOLS.likes) || 'Music',
            dislikes: pickRandom(PERSONALITY_POOLS.dislikes) || 'Lies',
            habits: pickRandom(PERSONALITY_POOLS.habits) || 'Hums while working',
            fears: pickRandom(PERSONALITY_POOLS.fears) || 'Heights',
            goals: pickRandom(PERSONALITY_POOLS.goals) || 'To protect the innocent'
        };
    }

    /**
     * Generate random stats (6-18 range, 3d6 style).
     * @returns {object} Stats object with str, dex, con, int, wis, cha
     */
    function generateStats() {
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        var stats = {};

        statKeys.forEach(function(key) {
            // 3d6 style: sum of 3 random numbers 1-6
            var roll = randomInt(1, 6) + randomInt(1, 6) + randomInt(1, 6);
            stats[key] = clamp(roll, 6, 18);
        });

        return stats;
    }

    /**
     * Generate random stats using the 4d6-drop-lowest method.
     * @returns {object} Stats object with str, dex, con, int, wis, cha
     */
    function generateStats4d6() {
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        var stats = {};

        statKeys.forEach(function(key) {
            // 4d6 drop lowest: roll 4 dice, keep highest 3
            var rolls = [
                randomInt(1, 6),
                randomInt(1, 6),
                randomInt(1, 6),
                randomInt(1, 6)
            ];
            rolls.sort(function(a, b) { return b - a; });
            var sum = rolls[0] + rolls[1] + rolls[2];
            stats[key] = clamp(sum, 6, 18);
        });

        return stats;
    }

    /**
     * Generate random magic proficiencies.
     * @param {string} category - Optional category to favour ('elemental', 'body', 'aether')
     * @returns {object} Magic proficiencies object
     */
    function generateMagic(category) {
        var magicTypeKeys = window.CharacterConstants 
            ? window.CharacterConstants.MAGIC_TYPE_KEYS 
            : [];

        if (magicTypeKeys.length === 0) {
            // Fallback if constants not available
            return {};
        }

        var magic = {};
        var categoryTypes = [];

        if (category && window.CharacterConstants) {
            var cat = window.CharacterConstants.MAGIC_CATEGORIES[category];
            if (cat) {
                categoryTypes = cat.types.slice();
            }
        }

        magicTypeKeys.forEach(function(key) {
            var roll = Math.random();
            var isFavoured = categoryTypes.indexOf(key) !== -1;

            if (isFavoured) {
                // Favoured category: higher chance of higher values
                if (roll < 0.15) {
                    magic[key] = 0;
                } else if (roll < 0.35) {
                    magic[key] = randomInt(1, 3);
                } else if (roll < 0.60) {
                    magic[key] = randomInt(4, 6);
                } else if (roll < 0.80) {
                    magic[key] = randomInt(7, 8);
                } else {
                    magic[key] = randomInt(9, 10);
                }
            } else {
                // Non-favoured: lower values
                if (roll < 0.40) {
                    magic[key] = 0;
                } else if (roll < 0.70) {
                    magic[key] = randomInt(1, 3);
                } else if (roll < 0.90) {
                    magic[key] = randomInt(4, 6);
                } else {
                    magic[key] = randomInt(7, 8);
                }
            }
        });

        return magic;
    }

    /**
     * Generate random magic for a specific category only.
     * @param {string} category - Category to generate ('elemental', 'body', 'aether')
     * @returns {object} Magic proficiencies for that category
     */
    function generateMagicCategory(category) {
        return generateMagic(category);
    }

    /**
     * Generate a complete random character.
     * @param {object} options - Generation options
     * @param {boolean} options.includeStats - Generate stats (default: true)
     * @param {boolean} options.includeMagic - Generate magic (default: true)
     * @param {boolean} options.includePersonality - Generate personality (default: true)
     * @param {boolean} options.includePhysical - Generate physical (default: true)
     * @param {string} options.magicCategory - Magic category to favour
     * @param {string} options.statsMethod - '3d6' or '4d6' (default: '3d6')
     * @returns {object} Complete character data
     */
    function generateCharacter(options) {
        options = options || {};

        var includeStats = options.includeStats !== false;
        var includeMagic = options.includeMagic !== false;
        var includePersonality = options.includePersonality !== false;
        var includePhysical = options.includePhysical !== false;
        var magicCategory = options.magicCategory || null;
        var statsMethod = options.statsMethod || '3d6';

        var character = {
            firstName: '',
            lastName: '',
            middleName: '',
            nickname: '',
            alias: '',
            previousNames: [],
            nameFormat: 'firstlast',
            birthYear: '',
            gender: '',
            attraction: '',
            sexuality: '',
            eyes: '',
            hair: '',
            skin: '',
            height: '',
            weight: '',
            build: '',
            appearanceNotes: '',
            notes: '',
            deceased: false,
            deathYear: '',
            deathCause: '',
            deathAge: '',
            deathWeek: '',
            careerStatus: [],
            specialty: '',
            classIds: [],
            personality: {},
            stats: {},
            magic: {},
            specialMoves: {
                physical: [],
                magical: []
            }
        };

        // Generate name components (with some randomness)
        var firstNames = ['Aria', 'Bastian', 'Celine', 'Dorian', 'Elara', 'Finn', 'Gwen', 'Hugo', 'Iris', 'Jasper', 'Kira', 'Liam', 'Mira', 'Nico', 'Orion', 'Piper', 'Quinn', 'Raven', 'Sage', 'Theo', 'Uma', 'Valor', 'Willow', 'Xen', 'Yara', 'Zane'];
        var lastNames = ['Blackwood', 'Crest', 'Darkmoon', 'Ember', 'Frost', 'Grey', 'Hawthorne', 'Ironwood', 'Jade', 'Knight', 'Light', 'Morrow', 'Night', 'Oak', 'Phoenix', 'Raven', 'Silver', 'Thorne', 'Umbra', 'Valor', 'Wilde', 'Winter', 'Ashford', 'Bright', 'Cinder'];

        character.firstName = pickRandom(firstNames) || 'Aria';
        character.lastName = pickRandom(lastNames) || 'Blackwood';

        // 20% chance of nickname
        if (Math.random() < 0.2) {
            var nicknames = ['Ari', 'Baz', 'Celly', 'Dory', 'Elle', 'Finn', 'G', 'Hugh', 'Irie', 'Jazz', 'Kiki', 'Lio', 'Mimi', 'Nick', 'Ori', 'Pip', 'Quin', 'Rae', 'Sage', 'Theo', 'Val', 'Willow', 'Z'];
            character.nickname = pickRandom(nicknames) || '';
        }

        // 15% chance of alias
        if (Math.random() < 0.15) {
            var aliases = ['The Shadow', 'Night\'s Edge', 'The Wraith', 'Stormcaller', 'The Veil', 'Ironheart', 'The Whisper', 'Flamebearer', 'The Sentinel', 'Duskwalker'];
            character.alias = pickRandom(aliases) || '';
        }

        // Birth year: random 18-30 years ago from current year
        var currentYear = new Date().getFullYear();
        var age = randomInt(18, 45);
        character.birthYear = String(currentYear - age);

        // Gender
        if (includePhysical) {
            var physical = generatePhysical();
            character.gender = physical.gender;
            character.eyes = physical.eyes;
            character.hair = physical.hair;
            character.skin = physical.skin;
            character.height = physical.height;
            character.weight = physical.weight;
            character.build = physical.build;
        }

        // Personality
        if (includePersonality) {
            var personality = generatePersonality();
            character.personality = personality;
        }

        // Stats
        if (includeStats) {
            character.stats = statsMethod === '4d6' 
                ? generateStats4d6() 
                : generateStats();
        }

        // Magic
        if (includeMagic) {
            character.magic = generateMagic(magicCategory);
        }

        // Random specialty
        var specialties = ['Combat', 'Arcane Studies', 'Healing', 'Crafting', 'Leadership', 'Stealth', 'Diplomacy', 'Research'];
        character.specialty = pickRandom(specialties) || '';

        // Random career status - most characters start as trainees
        var statuses = ['trainee', 'rookie', 'junior', 'senior', 'instructor'];
        var careerStatus = {
            status: pickRandom(statuses) || 'trainee',
            startYear: String(parseInt(character.birthYear, 10) + randomInt(18, 22)),
            endYear: ''
        };
        character.careerStatus = [careerStatus];

        // Some characters have multiple career entries
        if (Math.random() < 0.2) {
            var secondStatus = {
                status: pickRandom(['senior', 'instructor']) || 'senior',
                startYear: String(parseInt(careerStatus.startYear, 10) + randomInt(4, 8)),
                endYear: ''
            };
            character.careerStatus.push(secondStatus);
        }

        return character;
    }

    /**
     * Generate a display name for a generated character.
     * @param {object} char - Character data
     * @returns {string} Display name
     */
    function getDisplayName(char) {
        if (!char) return 'Unknown';

        var firstName = char.firstName || '';
        var lastName = char.lastName || '';
        var nickname = char.nickname || '';
        var alias = char.alias || '';
        var format = char.nameFormat || 'firstlast';

        switch (format) {
            case 'lastfirst':
                return lastName && firstName ? lastName + ', ' + firstName : lastName || firstName || 'Unknown';
            case 'nicklast':
                return [nickname || firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
            case 'firstnick':
                if (!firstName && !nickname) return lastName || 'Unknown';
                if (!nickname) return [firstName, lastName].filter(Boolean).join(' ');
                return firstName 
                    ? firstName + ' "' + nickname + '"' + (lastName ? ' ' + lastName : '')
                    : '"' + nickname + '"' + (lastName ? ' ' + lastName : '');
            case 'alias':
                return alias || [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
            default:
                return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterGenerator = {
        // Generation
        generatePhysical: generatePhysical,
        generatePersonality: generatePersonality,
        generateStats: generateStats,
        generateStats4d6: generateStats4d6,
        generateMagic: generateMagic,
        generateMagicCategory: generateMagicCategory,
        generateCharacter: generateCharacter,

        // Utility
        getDisplayName: getDisplayName,
        pickRandom: pickRandom,
        randomInt: randomInt,

        // Pools (for extension/customisation)
        PHYSICAL_POOLS: PHYSICAL_POOLS,
        PERSONALITY_POOLS: PERSONALITY_POOLS
    };

})();
