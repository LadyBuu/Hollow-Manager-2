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
 *   - Regenerating a SINGLE physical field, biased toward the
 *     character's current build / complexion tier
 *
 * IMPORTANT:
 *   - This module GENERATES DATA only - it does NOT save or mutate state
 *   - All functions are PURE (return data, no side effects)
 *   - No DOM manipulation
 *   - No persistence calls
 *   - Results can be used by CharacterForm or CharacterStats
 *   - USES CharacterConstants for domain constants
 *   - No ID generation here - that belongs to IdUtils at creation time
 *   - No display name formatting here - that belongs to CharacterQueries
 *
 * TIER MODEL:
 *   The old generator picked height, weight, and build independently
 *   from flat pools. That produced implausible combinations:
 *   190cm + 55kg + Rugged. Skin, hair, and eyes had the same problem
 *   in a different domain: Porcelain + Ebony + Violet on uniform
 *   sampling.
 *
 *   The current model groups the physical attributes into two
 *   independent tier systems:
 *
 *     BUILD_TIERS      (slight / average / sturdy / heavy)
 *       Each tier carries its own heights, weights, and build words.
 *       A 190cm pick comes from the sturdy tier, whose weight pool
 *       starts at 78kg and whose build pool does not contain
 *       "Willowy".
 *
 *     COMPLEXION_TIERS (fair / medium / deep)
 *       Each tier carries its own skin tones, hair colours, and eye
 *       colours. A porcelain-skin pick comes from the fair tier,
 *       whose eye pool does not contain "Jet" and whose hair pool
 *       weights dark colours low.
 *
 *   The two tier systems are INDEPENDENT. Real people span every
 *   combination of build and complexion. The implausibility was
 *   always within a domain, never across.
 *
 *   Values CAN appear in more than one tier. A build word like
 *   "Athletic" fits a slight gymnast AND a sturdy weightlifter.
 *   The pools reflect reality, not a clean partition.
 *
 *   Within a tier, picks are uniform. Repetition in the pool
 *   array weights a value up (Jet Black listed once in the fair
 *   hair pool against thirty other entries is rare; listing it
 *   three times would make it common).
 *
 * FIELD REROLL:
 *   generatePhysicalField(field, current) rerolls ONE field.
 *   For the seven physical fields, it uses a 70/30 bias: 70%
 *   from the current tier, 30% from the full union of all tiers.
 *   This makes a single click a plausible nudge, and two or
 *   three clicks a real change.
 *
 *   For the ten personality fields, it is a uniform pick from
 *   that field's pool. There is no tier system for personality.
 *
 * PERSONALITY IS UNCHANGED:
 *   The personality pools are whole-phrase entries (e.g. "Brave,
 *   Honest, Loyal"). Each pool entry is a coherent set on its
 *   own. Field reroll replaces the value with another entry from
 *   the same pool. No coherence logic is applied.
 *
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *
 * USAGE:
 *   var generator = window.CharacterGenerator;
 *   var stats = generator.generateStats3d6();
 *   var magic = generator.generateMagic('elemental');
 *   var character = generator.generateCharacter({ currentYear: 1927 });
 *
 *   // Per-field reroll
 *   var newHeight = generator.generatePhysicalField('height', {
 *       height: '175cm',
 *       weight: '72kg',
 *       build: 'Athletic',
 *       skin: 'Olive',
 *       hair: 'Brown',
 *       eyes: 'Brown',
 *       gender: 'Male'
 *   });
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterGeneratorLoaded) {
        return;
    }
    window.__characterGeneratorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CC = window.CharacterConstants;

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CC) {
            missing.push('CharacterConstants');
        }

        if (CC && typeof CC.MAGIC_TYPE_KEYS === 'undefined') {
            missing.push('CharacterConstants.MAGIC_TYPE_KEYS');
        }

        if (CC && typeof CC.MAGIC_CATEGORIES === 'undefined') {
            missing.push('CharacterConstants.MAGIC_CATEGORIES');
        }

        if (missing.length > 0) {
            console.warn('CharacterGenerator: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // GENDER POOL
    // ============================================================

    var GENDERS = [
        // Traditional binary
        'Male',
        'Female',
        // Non-binary umbrella
        'Non-binary',
        'Genderfluid',
        'Genderqueer',
        'Agender',
        'Bigender',
        // Specific identities
        'Demiboy',
        'Demigirl',
        'Two-Spirit',
        // Neutral / open
        'Questioning',
        'Prefer not to say',
        'Other'
    ];

    // ============================================================
    // COMPLEXION TIERS
    // ============================================================
    //
    // Skin tone, hair colour, and eye colour are correlated. Fair
    // skin tends to pair with lighter hair and eyes; deep skin
    // tends to pair with darker hair and eyes. The tiers below
    // encode those tendencies WITHOUT excluding unusual
    // combinations — an unusual pair is simply one entry among
    // many instead of the whole pool being uniform.
    //
    // Values may appear in more than one tier where they are
    // plausible. A value listed more than once in the same pool
    // is weighted up.

    var COMPLEXION_TIERS = {
        fair: {
            weight: 30,

            skinTones: [
                'Porcelain', 'Pale', 'Fair', 'Ivory',
                'Cool Beige', 'Warm Beige', 'Neutral Beige'
            ],

            hairColours: [
                // Blonde family, weighted up
                'Blonde', 'Blonde',
                'Platinum Blonde', 'Ash Blonde',
                'Strawberry Blonde', 'Honey Blonde',
                'Golden', 'Golden',
                // Brown family, weighted up
                'Brown', 'Brown', 'Brown',
                'Chestnut', 'Chestnut',
                'Auburn', 'Chocolate', 'Mahogany', 'Walnut',
                // Red family
                'Red', 'Ginger', 'Copper', 'Oxblood',
                // Grey / white
                'Grey', 'Silver', 'Iron Grey',
                'White', 'Milk White', 'Salt and Pepper',
                // Mixed
                'Two-tone', 'Streaked',
                // Dark hair with fair skin is common in reality.
                // Included, but weighted low (single entries in a
                // pool of ~30).
                'Jet Black', 'Blue-Black', 'Espresso'
            ],

            eyeColours: [
                // Common
                'Brown', 'Brown',
                'Blue', 'Blue',
                'Green', 'Green',
                'Grey', 'Hazel',
                // Warm
                'Amber', 'Honey', 'Gold', 'Copper',
                // Cool / unusual
                'Ice Blue', 'Storm Grey', 'Steel', 'Silver',
                // Rare (single entries against the pool size)
                'Violet', 'Rose', 'Wine', 'Tea-coloured',
                'Heterochromia',
                'Black'
            ]
        },

        medium: {
            weight: 45,

            skinTones: [
                'Olive', 'Olive', 'Warm Olive', 'Cool Olive',
                'Tan', 'Tan',
                'Golden', 'Warm Sand',
                'Neutral', 'Neutral Beige'
            ],

            hairColours: [
                // Brown family, weighted up
                'Brown', 'Brown', 'Brown',
                'Chestnut', 'Chestnut', 'Auburn',
                'Chocolate', 'Mahogany', 'Walnut',
                // Dark family, weighted up
                'Black', 'Black', 'Black',
                'Raven', 'Jet Black', 'Blue-Black',
                // Red family
                'Red', 'Ginger', 'Copper', 'Oxblood',
                // Blonde is present but less common
                'Blonde', 'Ash Blonde', 'Honey Blonde', 'Golden',
                // Grey / white
                'Grey', 'Silver', 'Salt and Pepper',
                // Mixed
                'Two-tone', 'Streaked'
            ],

            eyeColours: [
                // Common
                'Brown', 'Brown', 'Brown',
                'Hazel', 'Hazel',
                'Green', 'Green',
                // Warm
                'Amber', 'Honey', 'Gold',
                // Dark
                'Black', 'Jet',
                'Copper', 'Bronze',
                // Rare
                'Violet',
                'Heterochromia'
            ]
        },

        deep: {
            weight: 25,

            skinTones: [
                'Light Brown', 'Sienna', 'Amber', 'Bronze',
                'Dark Brown', 'Dark Brown',
                'Cocoa', 'Umber', 'Chestnut',
                'Espresso', 'Ebony', 'Mahogany',
                'Cool Grey', 'Warm Rose'
            ],

            hairColours: [
                // Black family, weighted up
                'Black', 'Black', 'Black', 'Black',
                'Raven', 'Jet Black', 'Blue-Black',
                // Dark brown
                'Dark Brown', 'Dark Brown',
                'Cocoa', 'Espresso',
                // Brown family
                'Brown', 'Chestnut', 'Mahogany', 'Walnut',
                // Red family
                'Red', 'Ginger', 'Copper', 'Oxblood',
                // Grey / white
                'Grey', 'Silver', 'Salt and Pepper',
                // Mixed
                'Streaked'
            ],

            eyeColours: [
                // Brown family, weighted up
                'Brown', 'Brown', 'Brown', 'Brown',
                'Dark Brown', 'Dark Brown',
                // Dark
                'Black', 'Jet',
                'Hazel',
                // Warm
                'Amber', 'Copper', 'Bronze',
                // Rare
                'Heterochromia'
            ]
        }
    };

    // ============================================================
    // BUILD TIERS
    // ============================================================
    //
    // Height, weight, and build word are correlated. A 190cm
    // person is not described as "Willowy"; a 145cm person is not
    // described as "Rugged". The tiers group these attributes
    // into plausible neighbourhoods.
    //
    // Values can appear in more than one tier. A build word like
    // "Athletic" fits a slight gymnast AND a sturdy weightlifter.
    // That overlap is deliberate: it keeps the model from
    // over-fitting to a single body shape per height.

    var BUILD_TIERS = {
        slight: {
            weight: 25,

            heights: [
                '145cm', '148cm', '150cm', '152cm', '155cm',
                '158cm', '160cm', '162cm', '163cm', '165cm'
            ],

            weights: [
                '45kg', '48kg', '50kg', '52kg', '55kg',
                '57kg', '58kg', '60kg', '62kg', '65kg',
                '67kg', '68kg'
            ],

            builds: [
                'Slim', 'Slight', 'Willowy', 'Wispy',
                'Lean', 'Lithe', 'Wiry', 'Compact',
                'Athletic'
            ]
        },

        average: {
            weight: 50,

            heights: [
                '167cm', '168cm', '170cm', '172cm', '173cm',
                '175cm', '177cm', '178cm', '180cm', '182cm'
            ],

            weights: [
                '60kg', '62kg', '65kg', '67kg', '68kg',
                '70kg', '72kg', '75kg', '77kg', '78kg',
                '80kg', '82kg', '85kg', '87kg', '88kg'
            ],

            builds: [
                'Athletic', 'Soft', 'Plush', 'Angular',
                'Hourglass', 'Pear-shaped', 'Apple-shaped',
                'Inverted Triangle', 'Average', 'Rugged'
            ]
        },

        sturdy: {
            weight: 20,

            heights: [
                '183cm', '185cm', '187cm', '188cm',
                '190cm', '193cm', '195cm', '198cm', '200cm'
            ],

            weights: [
                '78kg', '80kg', '82kg', '85kg', '87kg', '88kg',
                '90kg', '92kg', '95kg', '98kg', '100kg',
                '105kg', '110kg'
            ],

            builds: [
                'Muscular', 'Broad-Shouldered', 'Statuesque',
                'Well-Built', 'Stocky', 'Burly', 'Rugged',
                'Athletic'
            ]
        },

        heavy: {
            weight: 5,

            heights: [
                '155cm', '160cm', '165cm', '168cm', '170cm',
                '173cm', '175cm', '178cm', '180cm', '183cm', '185cm'
            ],

            weights: [
                '95kg', '98kg', '100kg', '105kg',
                '110kg', '115kg', '120kg', '125kg', '130kg'
            ],

            builds: [
                'Heavy', 'Round', 'Full-figured',
                'Stocky', 'Burly', 'Plush', 'Athletic'
            ]
        }
    };

    // ============================================================
    // PERSONALITY POOLS (unchanged)
    // ============================================================

    var PERSONALITY_POOLS = {
        traits: [
            // Steady / grounded
            'Brave, Honest, Loyal',
            'Reliable, Patient, Grounded',
            'Calm, Collected, Strategic',
            'Stoic, Disciplined, Focused',
            'Dependable, Steady, Kind',
            // Passionate / driven
            'Fierce, Proud, Determined',
            'Bold, Reckless, Passionate',
            'Driven, Ambitious, Intense',
            'Passionate, Loyal, Bold',
            'Ferocious, Protective, Devoted',
            // Analytical / clever
            'Wise, Patient, Kind',
            'Quiet, Observant, Clever',
            'Sharp, Witty, Sarcastic',
            'Calculating, Elegant, Diplomatic',
            'Cerebral, Curious, Precise',
            // Wild / free
            'Wild, Free-spirited, Intuitive',
            'Playful, Curious, Optimistic',
            'Cheerful, Bubbly, Energetic',
            'Impish, Mischievous, Bold',
            'Adventurous, Restless, Bright',
            // Warm / nurturing
            'Warm, Empathetic, Nurturing',
            'Gentle, Thoughtful, Steady',
            'Affectionate, Protective, Warm',
            'Compassionate, Honest, Generous',
            // Dark / brooding
            'Brooding, Intense, Mysterious',
            'Cynical, Wary, Sharp',
            'Acerbic, Brilliant, Guarded',
            'Melancholic, Deep, Introspective',
            // Cunning / ambiguous
            'Cunning, Ambitious, Charming',
            'Sly, Charmingly, Deceptive',
            'Smooth, Silver-tongued, Watchful',
            'Manipulative, Clever, Cold',
            // Principled
            'Honorable, Stubborn, Just',
            'Righteous, Stern, Unyielding',
            'Dutiful, Formal, Loyal',
            'Principled, Reserved, Steadfast'
        ],

        ideals: [
            // Virtue
            'Honor and Duty',
            'Justice and Fairness',
            'Courage and Sacrifice',
            'Wisdom and Understanding',
            'Compassion and Mercy',
            // Freedom
            'Freedom and Choice',
            'Individuality and Expression',
            'Change and Progress',
            'Self-determination and Autonomy',
            // Order
            'Tradition and Order',
            'Structure and Hierarchy',
            'Law and Stability',
            // Knowledge
            'Knowledge and Truth',
            'Discovery and Inquiry',
            'Learning and Mastery',
            // Ambition
            'Power and Ambition',
            'Greatness and Legacy',
            'Excellence and Renown',
            // Belonging
            'Loyalty and Family',
            'Community and Belonging',
            'Friendship and Trust',
            // Harmony
            'Peace and Harmony',
            'Balance and Moderation',
            'Coexistence and Tolerance',
            // Craft
            'Craftsmanship and Art',
            'Beauty and Expression',
            'Precision and Excellence',
            // Faith
            'Faith and Devotion',
            'Tradition and Ritual',
            'Connection to the Divine',
            // Survival
            'Survival and Endurance',
            'Strength and Resilience'
        ],

        bonds: [
            // Family
            'Protecting their family',
            'A parent they lost',
            'A sibling they protect',
            'A child they left behind',
            'A family name to restore',
            // Friendship
            'A childhood friend',
            'Their closest ally',
            'A friendship they broke',
            'A companion through dark times',
            // Romance
            'A lost love',
            'A promise to a partner',
            'A beloved they cannot return to',
            // Mentorship
            'A mentor who saved them',
            'A student they failed',
            'A teacher\'s legacy to honor',
            // Duty
            'A sacred oath',
            'Their honor',
            'A promise made',
            'A duty to their homeland',
            // Place
            'Their homeland',
            'Their community',
            'A village they abandoned',
            'A place they can never return to',
            // Objects
            'A treasured artifact',
            'A keepsake from a loved one',
            'A weapon with a story',
            'A journal they carry',
            // Secrets
            'A secret they must protect',
            'A truth they cannot speak',
            // Rivals
            'A rival they respect',
            'A rival they must surpass'
        ],

        flaws: [
            // Trust
            'Too trusting',
            'Distrustful of others',
            'Too proud to ask for help',
            // Anger
            'Quick to anger',
            'Vengeful',
            'Holds grudges',
            // Fear
            'Afraid of failure',
            'Self-doubting',
            'Fearful of being forgotten',
            // Impulse
            'Reckless in pursuit of goals',
            'Impulsive',
            'Overconfident',
            // Hesitation
            'Overly cautious',
            'Indecisive',
            'Slow to act',
            // Pride
            'Stubborn',
            'Perfectionist',
            'Cannot admit fault',
            // Secrecy
            'Secretive',
            'Cannot ask for help',
            'Hides their true self',
            // Guilt
            'Haunted by a past mistake',
            'Carries guilt from a failure',
            'Cannot forgive themselves',
            // Intensity
            'Obsessive',
            'Unhealthily devoted',
            'All-consuming focus',
            // Detachment
            'Cold',
            'Emotionally distant',
            'Struggles to connect'
        ],

        alignments: [
            'Lawful Good', 'Neutral Good', 'Chaotic Good',
            'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
            'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'
        ],

        likes: [
            // Arts
            'Music',
            'Art',
            'Poetry',
            'Dance',
            'Theatre',
            'Sculpture',
            'Stories',
            // Nature
            'Nature',
            'Animals',
            'Flowers',
            'Stargazing',
            'The Sea',
            'Forests',
            'Mountains',
            // Intellectual
            'Books',
            'History',
            'Science',
            'Languages',
            'Riddles',
            'Debate',
            'Philosophy',
            // Domestic
            'Good Food',
            'Cooking',
            'Gardening',
            'Crafting',
            'Baking',
            'Tea',
            'Wine',
            // Physical
            'Training',
            'Running',
            'Swimming',
            'Climbing',
            'Sparring',
            // Social
            'Games',
            'Gossip',
            'Feasts',
            'Travel',
            'Festivals',
            'Company',
            // Quiet
            'Meditation',
            'Solitude',
            'Journaling',
            'Long walks',
            'Rainy days'
        ],

        dislikes: [
            // Ethical
            'Lies',
            'Cruelty',
            'Injustice',
            'Betrayal',
            'Greed',
            'Dishonesty',
            'Hypocrisy',
            'Bullying',
            // Social
            'Arrogance',
            'Crowds',
            'Small talk',
            'Fawning',
            'Rudeness',
            'Pretension',
            // Sensory
            'Loud Noises',
            'Strong smells',
            'Bright lights',
            'Bad Weather',
            'Cold',
            'Heat',
            'Damp',
            // Intellectual
            'Ignorance',
            'Stupidity',
            'Wasted potential',
            'Rigid thinking',
            // Temperamental
            'Boredom',
            'Haste',
            'Chaos',
            'Complacency',
            'Indecision',
            // Physical
            'Idleness',
            'Weakness',
            'Slovenliness'
        ],

        habits: [
            // Verbal
            'Hums while working',
            'Talks to themselves',
            'Whistles tunelessly',
            'Repeats words back',
            'Mutters when reading',
            // Manual
            'Taps fingers when thinking',
            'Fidgets with a lucky charm',
            'Cracks knuckles',
            'Twirls hair',
            'Adjusts glasses',
            'Chews lip',
            'Drumming fingers',
            'Paces while thinking',
            'Rubs their chin',
            'Taps foot when impatient',
            // Collections
            'Collects small trinkets',
            'Keeps every receipt',
            'Picks up smooth stones',
            'Pockets interesting leaves',
            // Ritual
            'Touches a talisman before danger',
            'Counts steps on stairs',
            'Checks locks twice',
            'Sleeps with a weapon nearby',
            'Wakes before dawn',
            // Social
            'Laughs at their own jokes',
            'Apologizes unnecessarily',
            'Says goodbye three times',
            'Remembers small favors',
            // Idiosyncratic
            'Speaks to animals',
            'Names their weapons',
            'Writes in the margins',
            'Keeps a dream journal'
        ],

        fears: [
            // Physical
            'Heights',
            'Spiders',
            'Claustrophobia',
            'Drowning',
            'Fire',
            'Darkness',
            'Deep water',
            'Enclosed spaces',
            'Open spaces',
            // Existential
            'Being forgotten',
            'Failure',
            'Loss of control',
            'The unknown',
            'Madness',
            'Meaninglessness',
            'Outliving their purpose',
            // Relational
            'Rejection',
            'Betrayal',
            'Losing loved ones',
            'Disappointing their family',
            'Being a burden',
            'Being alone',
            // Identity
            'Becoming a monster',
            'Losing themselves',
            'Losing their memories',
            'Being seen as they truly are',
            // Moral
            'Committing an unforgivable act',
            'Becoming the villain',
            'Hurting those they love',
            // Practical
            'Poverty',
            'Poverty in old age',
            'Failing their dependents',
            // Supernatural
            'The dead',
            'Magic itself',
            'Becoming a vessel',
            'Prophetic dreams'
        ],

        goals: [
            // Virtuous
            'To protect the innocent',
            'To achieve greatness',
            'To find purpose',
            'To restore honor',
            'To discover truth',
            'To build something lasting',
            'To master a craft',
            'To find redemption',
            'To explore the unknown',
            'To create a better world',
            'To prove themselves worthy',
            // Ambitious
            'To become a legend',
            'To surpass their mentor',
            'To lead their people',
            'To found a school',
            'To write the definitive account',
            // Personal
            'To reconcile with their family',
            'To find a lost sibling',
            'To avenge a wrong',
            'To repay a debt',
            'To keep a promise',
            // Knowledge
            'To master forbidden knowledge',
            'To catalogue every species',
            'To translate an ancient text',
            'To find a lost city',
            // Restorative
            'To undo an old mistake',
            'To heal a wound they caused',
            'To rebuild what was destroyed',
            // Simple
            'To live quietly',
            'To raise a family',
            'To die well',
            'To see one more sunrise'
        ]
    };

    // ============================================================
    // UTILITY FUNCTIONS - Internal only
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

    /**
     * Pick a tier from a tier map, weighted by each tier's .weight.
     */
    function pickWeightedTier(tiers) {
        var keys = Object.keys(tiers);
        if (keys.length === 0) { return null; }

        var total = 0;
        for (var i = 0; i < keys.length; i++) {
            total += tiers[keys[i]].weight;
        }
        if (total <= 0) { return tiers[keys[0]]; }

        var roll = Math.random() * total;
        var acc = 0;
        for (var j = 0; j < keys.length; j++) {
            acc += tiers[keys[j]].weight;
            if (roll < acc) {
                return tiers[keys[j]];
            }
        }
        return tiers[keys[keys.length - 1]];
    }

    /**
     * Which build tier contains this height value?
     * Returns the tier key, or null.
     */
    function findBuildTierForHeight(height) {
        if (typeof height !== 'string') { return null; }
        var keys = Object.keys(BUILD_TIERS);
        for (var i = 0; i < keys.length; i++) {
            var heights = BUILD_TIERS[keys[i]].heights;
            if (heights.indexOf(height) !== -1) {
                return keys[i];
            }
        }
        return null;
    }

    /**
     * Which complexion tier contains this skin tone?
     * Returns the tier key, or null.
     */
    function findComplexionTierForSkin(skin) {
        if (typeof skin !== 'string') { return null; }
        var keys = Object.keys(COMPLEXION_TIERS);
        for (var i = 0; i < keys.length; i++) {
            var tones = COMPLEXION_TIERS[keys[i]].skinTones;
            if (tones.indexOf(skin) !== -1) {
                return keys[i];
            }
        }
        return null;
    }

    /**
     * Union of a named array across all build tiers.
     * Deduplicated.
     */
    function unionBuildField(fieldName) {
        var seen = Object.create(null);
        var out = [];
        var keys = Object.keys(BUILD_TIERS);
        for (var i = 0; i < keys.length; i++) {
            var list = BUILD_TIERS[keys[i]][fieldName] || [];
            for (var j = 0; j < list.length; j++) {
                var v = list[j];
                if (!seen[v]) {
                    seen[v] = true;
                    out.push(v);
                }
            }
        }
        return out;
    }

    /**
     * Union of a named array across all complexion tiers.
     * Deduplicated.
     */
    function unionComplexionField(fieldName) {
        var seen = Object.create(null);
        var out = [];
        var keys = Object.keys(COMPLEXION_TIERS);
        for (var i = 0; i < keys.length; i++) {
            var list = COMPLEXION_TIERS[keys[i]][fieldName] || [];
            for (var j = 0; j < list.length; j++) {
                var v = list[j];
                if (!seen[v]) {
                    seen[v] = true;
                    out.push(v);
                }
            }
        }
        return out;
    }

    // ============================================================
    // GENERATION FUNCTIONS
    // ============================================================

    /**
     * Generate random physical appearance data.
     *
     * Picks a complexion tier and a build tier independently,
     * then picks each field from within its tier. The two tier
     * picks are independent — a fair-skinned weightlifter is as
     * plausible as a deep-skinned one.
     *
     * @returns {object} Physical appearance data
     */
    function generatePhysical() {
        var complexion = pickWeightedTier(COMPLEXION_TIERS);
        var build = pickWeightedTier(BUILD_TIERS);

        return {
            gender: pickRandom(GENDERS) || 'Other',
            eyes: pickRandom(complexion.eyeColours) || 'Brown',
            hair: pickRandom(complexion.hairColours) || 'Brown',
            skin: pickRandom(complexion.skinTones) || 'Fair',
            height: pickRandom(build.heights) || '175cm',
            weight: pickRandom(build.weights) || '70kg',
            build: pickRandom(build.builds) || 'Average'
        };
    }

    /**
     * Reroll ONE physical field, biased toward the character's
     * current tier.
     *
     * BIAS:
     *   For build-tier fields (height, weight, build), 70% of
     *   picks come from the current build tier; 30% from the full
     *   union of all tiers. If the current height cannot be
     *   located in any tier, the bias is skipped and the pick is
     *   uniform from the union.
     *
     *   Same pattern for complexion-tier fields (skin, hair,
     *   eyes), keyed off the current skin tone.
     *
     *   The gender field is a flat pick — no tier applies.
     *
     * EFFECT:
     *   One click = a plausible variation of the current shape.
     *   Two or three clicks = a real change of shape, because the
     *   30% full-pool branch keeps coming up.
     *
     * @param {string} field - 'height' | 'weight' | 'build' |
     *                         'skin' | 'hair' | 'eyes' | 'gender'
     * @param {object} current - The current physical object
     * @returns {string|null} The new value, or null if the field
     *   is unrecognised
     */
    function generatePhysicalField(field, current) {
        current = current || {};

        // ---- Flat pick ----
        if (field === 'gender') {
            return pickRandom(GENDERS) || 'Other';
        }

        // ---- Build-tier fields ----
        if (field === 'height' || field === 'weight' || field === 'build') {
            var buildTierKey = findBuildTierForHeight(current.height);
            var buildTier = buildTierKey
                ? BUILD_TIERS[buildTierKey]
                : null;

            if (buildTier && Math.random() < 0.7) {
                return pickRandom(buildTier[field + 's']) ||
                    pickRandom(buildTier[field === 'build' ? 'builds' : field + 's']);
            }

            var buildPool = unionBuildField(
                field === 'build' ? 'builds' : field + 's'
            );
            return pickRandom(buildPool);
        }

        // ---- Complexion-tier fields ----
        if (field === 'skin' || field === 'hair' || field === 'eyes') {
            var complexionKey = findComplexionTierForSkin(current.skin);
            var complexion = complexionKey
                ? COMPLEXION_TIERS[complexionKey]
                : null;

            var poolName = field === 'skin'
                ? 'skinTones'
                : (field === 'hair' ? 'hairColours' : 'eyeColours');

            if (complexion && Math.random() < 0.7) {
                return pickRandom(complexion[poolName]);
            }

            var complexionPool = unionComplexionField(poolName);
            return pickRandom(complexionPool);
        }

        return null;
    }

    /**
     * Reroll ONE personality field. Pure pool pick; no tier
     * logic applies.
     *
     * @param {string} field - one of the PERSONALITY_POOLS keys
     * @returns {string|null}
     */
    function generatePersonalityField(field) {
        var pool = PERSONALITY_POOLS[field];
        if (!Array.isArray(pool)) { return null; }
        return pickRandom(pool);
    }

    /**
     * Generate random personality data.
     *
     * Each field is picked independently from its pool. No
     * coherence logic is applied: the pools hold whole-phrase
     * entries, and each entry is coherent on its own. A
     * contradictory pairing across fields (Chaotic Evil with a
     * soft spot for orphans) is left to the user to reroll if
     * they dislike it.
     *
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
     * Generate random stats (3d6 style, clamped 6-18).
     * This is the application's canonical stat generation method.
     * @returns {object} Stats object with str, dex, con, int, wis, cha
     */
    function generateStats3d6() {
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        var stats = {};

        statKeys.forEach(function(key) {
            // 3d6 style: sum of 3 random numbers 1-6
            var roll = randomInt(1, 6) + randomInt(1, 6) + randomInt(1, 6);
            // Clamp to application's stat range (6-18)
            var statMin = CC ? CC.STAT_MIN : 1;
            var statMax = CC ? CC.STAT_MAX : 50;
            stats[key] = clamp(roll, Math.max(6, statMin), Math.min(18, statMax));
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
            // Clamp to application's stat range
            var statMin = CC ? CC.STAT_MIN : 1;
            var statMax = CC ? CC.STAT_MAX : 50;
            stats[key] = clamp(sum, Math.max(6, statMin), Math.min(18, statMax));
        });

        return stats;
    }

    /**
     * Generate random magic proficiencies.
     * Uses CharacterConstants for magic type keys and categories.
     *
     * @param {string} category - Optional category to favour ('elemental', 'body', 'aether')
     * @returns {object} Magic proficiencies object
     */
    function generateMagic(category) {
        // Ensure dependencies are available
        if (!CC || !CC.MAGIC_TYPE_KEYS) {
            console.warn('CharacterGenerator: CharacterConstants.MAGIC_TYPE_KEYS not available.');
            return {};
        }

        var magicTypeKeys = CC.MAGIC_TYPE_KEYS;
        var magicCategories = CC.MAGIC_CATEGORIES || {};
        var magicMax = CC.MAGIC_MAX || 10;

        var magic = {};
        var categoryTypes = [];

        if (category && magicCategories[category]) {
            categoryTypes = magicCategories[category].types || [];
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

            // Clamp to application's magic max
            magic[key] = Math.min(magic[key], magicMax);
        });

        return magic;
    }

    /**
     * Generate random magic for a specific category only.
     *
     * @param {string} category - Category to generate ('elemental', 'body', 'aether')
     * @returns {object} Magic proficiencies for that category
     */
    function generateMagicCategory(category) {
        return generateMagic(category);
    }

    /**
     * Generate a complete random character.
     * Returns a character DTO with generated values.
     * Does NOT include application-specific fields (id, classIds, etc.)
     *
     * @param {object} options - Generation options
     * @param {number} options.currentYear - Application current year (required)
     * @param {boolean} options.includeStats - Generate stats (default: true)
     * @param {boolean} options.includeMagic - Generate magic (default: true)
     * @param {boolean} options.includePersonality - Generate personality (default: true)
     * @param {boolean} options.includePhysical - Generate physical (default: true)
     * @param {string} options.magicCategory - Magic category to favour
     * @param {string} options.statsMethod - '3d6' or '4d6' (default: '3d6')
     * @returns {object} Complete character DTO
     */
    function generateCharacter(options) {
        options = options || {};

        // Validate required options
        if (options.currentYear === undefined || options.currentYear === null) {
            console.warn('CharacterGenerator.generateCharacter: currentYear is required. Using fallback.');
        }

        var currentYear = options.currentYear || new Date().getFullYear();

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

        // Birth year: random 18-45 years ago from current year
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
                : generateStats3d6();
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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterGenerator = {
        // Full-object generation
        generatePhysical: generatePhysical,
        generatePersonality: generatePersonality,
        generateStats3d6: generateStats3d6,
        generateStats4d6: generateStats4d6,
        generateMagic: generateMagic,
        generateMagicCategory: generateMagicCategory,
        generateCharacter: generateCharacter,

        // Per-field reroll
        generatePhysicalField: generatePhysicalField,
        generatePersonalityField: generatePersonalityField,

        // Utility (internal helpers exposed for testing/extensibility)
        pickRandom: pickRandom,
        randomInt: randomInt
    };

})();
