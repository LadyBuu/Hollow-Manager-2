/**
 * modules/characters/character-generator.js - Character Generator
 * Dedicated module for random character generation
 * Path: js/modules/characters/character-generator.js
 *
 * This module is responsible for:
 *   - Generating coherent physical appearance data
 *   - Generating personality data across fourteen fields
 *   - Generating stats
 *   - Generating magic proficiencies
 *   - Generating complete random characters
 *   - Regenerating a SINGLE physical field while keeping the
 *     rest of the body coherent
 *
 * IMPORTANT:
 *   - This module GENERATES DATA only - it does NOT save or mutate state
 *   - All functions are PURE (return data, no side effects)
 *   - No DOM manipulation
 *   - No persistence calls
 *   - Results can be used by CharacterForm or CharacterStats
 *   - USES CharacterConstants for domain constants
 *   - No ID generation here - that belongs to IdUtils at creation time
 *
 * PHYSICAL MODEL:
 *   Height, weight, and build are correlated through BODY_PROFILES.
 *   Each profile declares:
 *
 *     - a height range in cm
 *     - a weight-to-height ratio range (BMI-shaped internally)
 *     - a list of build words that fit this profile
 *
 *   Generation order is:
 *
 *     profile → height → weight → build
 *
 *   Height picks first, then the profile's ratio range converts to
 *   a concrete weight range for that specific height, then weight
 *   picks from that range, then build picks from the profile's
 *   build list.
 *
 *   This eliminates combinations like 190cm + 55kg + Rugged
 *   because 190cm lands in a profile whose weight range starts at
 *   ~78kg and whose build list does not contain Willowy.
 *
 *   BMI is not exposed to the character. It is the internal
 *   mechanism, not a stored field.
 *
 * PER-FIELD REROLL:
 *   generatePhysicalField(field, current) rerolls ONE field while
 *   respecting the current body:
 *
 *     - Reroll height: keeps current weight and build, picks a new
 *       height from the profile range that can accommodate them.
 *     - Reroll weight: keeps current height and build, picks a new
 *       weight from the range that fits that height + build.
 *     - Reroll build: keeps current height and weight, picks a new
 *       build from the ones compatible with both.
 *
 *   Each reroll reads the current body state from the character
 *   form before generating. The form-side wiring is in
 *   character-events.js.
 *
 * PERSONALITY MODEL:
 *   Fourteen fields, generated from independent weighted pools:
 *
 *     traits        (weighted: 70% core, 30% behavioural)
 *     ideals
 *     bonds
 *     flaws
 *     alignment
 *     likes
 *     dislikes
 *     habits
 *     fears
 *     goals
 *     authority       (new)
 *     conflictStyle   (new)
 *     socialStyle     (new)
 *     quirks          (new)
 *
 *   No archetype system yet. No hidden dimensions. The new fields
 *   are picked independently, exactly like the existing ones. The
 *   point of this release is to see whether more varied vocabulary
 *   produces more distinctive characters before adding structural
 *   machinery on top.
 *
 * COMPLEXION MODEL:
 *   Unchanged from the previous release. Skin tone, hair colour,
 *   and eye colour are correlated through COMPLEXION_TIERS. Each
 *   tier's pools are weighted by repetition, so a rare combination
 *   is possible but not uniform.
 *
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *
 * USAGE:
 *   var generator = window.CharacterGenerator;
 *   var physical = generator.generatePhysical();
 *   var personality = generator.generatePersonality();
 *   var character = generator.generateCharacter({ currentYear: 1927 });
 *
 *   // Reroll one physical field, respecting the current body:
 *   var newHeight = generator.generatePhysicalField('height', {
 *       height: '175cm', weight: '72kg', build: 'Athletic',
 *       skin: 'Olive', hair: 'Brown', eyes: 'Brown', gender: 'Male'
 *   });
 */

(function() {
    'use strict';

    if (window.__characterGeneratorLoaded) {
        return;
    }
    window.__characterGeneratorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CC = window.CharacterConstants;

    function checkDependencies() {
        var missing = [];
        if (!CC) { missing.push('CharacterConstants'); }
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
    // GENDERS
    // ============================================================

    var GENDERS = [
        'Male',
        'Female',
        'Non-binary',
        'Genderfluid',
        'Genderqueer',
        'Agender',
        'Bigender',
        'Demiboy',
        'Demigirl',
        'Two-Spirit',
        'Questioning',
        'Prefer not to say',
        'Other'
    ];

    // ============================================================
    // BODY PROFILES
    // ============================================================
    //
    // Each profile declares a height range, a weight-to-height
    // ratio range (the internal mechanic; BMI-shaped, but not
    // exposed as a domain concept), and a list of build words that
    // fit this profile.
    //
    // The `weight` field on each profile is the relative pick
    // frequency. Average is the most common. Extreme profiles are
    // rarer but not absent.
    //
    // Ratio ranges are inclusive at both ends. They are expressed
    // as [min, max] and used to derive a concrete weight range
    // once a height has been picked.

    var BODY_PROFILES = {
        petite: {
            weight: 10,
            height: [145, 165],
            ratio: [17.5, 22.5],
            builds: ['Slim', 'Slight', 'Willowy', 'Lithe', 'Compact']
        },

        lean: {
            weight: 18,
            height: [155, 180],
            ratio: [18.0, 23.0],
            builds: ['Lean', 'Lithe', 'Wiry', 'Athletic', 'Angular']
        },

        average: {
            weight: 35,
            height: [160, 185],
            ratio: [20.0, 27.0],
            builds: ['Average', 'Soft', 'Angular', 'Athletic', 'Plush']
        },

        athletic: {
            weight: 18,
            height: [165, 195],
            ratio: [22.0, 29.0],
            builds: ['Athletic', 'Muscular', 'Broad-Shouldered', 'Well-Built']
        },

        stocky: {
            weight: 12,
            height: [155, 190],
            ratio: [25.0, 34.0],
            builds: ['Stocky', 'Burly', 'Heavy', 'Well-Built', 'Broad-Shouldered']
        },

        heavy: {
            weight: 7,
            height: [155, 190],
            ratio: [30.0, 42.0],
            builds: ['Heavy', 'Round', 'Full-figured', 'Stocky', 'Plush']
        }
    };

    // ============================================================
    // COMPLEXION TIERS
    // ============================================================
    //
    // Unchanged from the previous release. Skin tone, hair colour,
    // and eye colour are correlated through three tiers. Values
    // can appear in more than one tier where plausible; repetition
    // within a pool weights a value up.

    var COMPLEXION_TIERS = {
        fair: {
            weight: 30,
            skinTones: [
                'Porcelain', 'Pale', 'Fair', 'Ivory',
                'Cool Beige', 'Warm Beige', 'Neutral Beige'
            ],
            hairColours: [
                'Blonde', 'Blonde',
                'Platinum Blonde', 'Ash Blonde',
                'Strawberry Blonde', 'Honey Blonde',
                'Golden', 'Golden',
                'Brown', 'Brown', 'Brown',
                'Chestnut', 'Chestnut',
                'Auburn', 'Chocolate', 'Mahogany', 'Walnut',
                'Red', 'Ginger', 'Copper', 'Oxblood',
                'Grey', 'Silver', 'Iron Grey',
                'White', 'Milk White', 'Salt and Pepper',
                'Two-tone', 'Streaked',
                'Jet Black', 'Blue-Black', 'Espresso'
            ],
            eyeColours: [
                'Brown', 'Brown',
                'Blue', 'Blue',
                'Green', 'Green',
                'Grey', 'Hazel',
                'Amber', 'Honey', 'Gold', 'Copper',
                'Ice Blue', 'Storm Grey', 'Steel', 'Silver',
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
                'Brown', 'Brown', 'Brown',
                'Chestnut', 'Chestnut', 'Auburn',
                'Chocolate', 'Mahogany', 'Walnut',
                'Black', 'Black', 'Black',
                'Raven', 'Jet Black', 'Blue-Black',
                'Red', 'Ginger', 'Copper', 'Oxblood',
                'Blonde', 'Ash Blonde', 'Honey Blonde', 'Golden',
                'Grey', 'Silver', 'Salt and Pepper',
                'Two-tone', 'Streaked'
            ],
            eyeColours: [
                'Brown', 'Brown', 'Brown',
                'Hazel', 'Hazel',
                'Green', 'Green',
                'Amber', 'Honey', 'Gold',
                'Black', 'Jet',
                'Copper', 'Bronze',
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
                'Black', 'Black', 'Black', 'Black',
                'Raven', 'Jet Black', 'Blue-Black',
                'Dark Brown', 'Dark Brown',
                'Cocoa', 'Espresso',
                'Brown', 'Chestnut', 'Mahogany', 'Walnut',
                'Red', 'Ginger', 'Copper', 'Oxblood',
                'Grey', 'Silver', 'Salt and Pepper',
                'Streaked'
            ],
            eyeColours: [
                'Brown', 'Brown', 'Brown', 'Brown',
                'Dark Brown', 'Dark Brown',
                'Black', 'Jet',
                'Hazel',
                'Amber', 'Copper', 'Bronze',
                'Heterochromia'
            ]
        }
    };

    // ============================================================
    // TRAIT POOLS
    // ============================================================
    //
    // Two pools, weighted. The core pool is the existing vocabulary
    // (virtues and mannerisms that read as "ordinary person"). The
    // behavioural pool is new material that implies how the person
    // actually behaves, not just what they are like.
    //
    // A single trait pick is:
    //   - 70% chance: pick 3 items from the core pool
    //   - 30% chance: pick 3 items from the behavioural pool
    //
    // The weights are tunable. If generated characters feel too
    // bland, raise the behavioural weight. If they feel too
    // intense, lower it.

    var TRAIT_CORE_WEIGHT = 70;
    var TRAIT_BEHAVIOURAL_WEIGHT = 30;

    var TRAIT_POOL_CORE = [
        'Brave, Honest, Loyal',
        'Reliable, Patient, Grounded',
        'Calm, Collected, Strategic',
        'Stoic, Disciplined, Focused',
        'Dependable, Steady, Kind',
        'Fierce, Proud, Determined',
        'Bold, Reckless, Passionate',
        'Driven, Ambitious, Intense',
        'Passionate, Loyal, Bold',
        'Ferocious, Protective, Devoted',
        'Wise, Patient, Kind',
        'Quiet, Observant, Clever',
        'Sharp, Witty, Sarcastic',
        'Calculating, Elegant, Diplomatic',
        'Cerebral, Curious, Precise',
        'Wild, Free-spirited, Intuitive',
        'Playful, Curious, Optimistic',
        'Cheerful, Bubbly, Energetic',
        'Impish, Mischievous, Bold',
        'Adventurous, Restless, Bright',
        'Warm, Empathetic, Nurturing',
        'Gentle, Thoughtful, Steady',
        'Affectionate, Protective, Warm',
        'Compassionate, Honest, Generous',
        'Brooding, Intense, Mysterious',
        'Cynical, Wary, Sharp',
        'Acerbic, Brilliant, Guarded',
        'Melancholic, Deep, Introspective',
        'Cunning, Ambitious, Charming',
        'Sly, Charmingly, Deceptive',
        'Smooth, Silver-tongued, Watchful',
        'Manipulative, Clever, Cold',
        'Honorable, Stubborn, Just',
        'Righteous, Stern, Unyielding',
        'Dutiful, Formal, Loyal',
        'Principled, Reserved, Steadfast'
    ];

    var TRAIT_POOL_BEHAVIOURAL = [
        'Confrontational, Protective, Intensely Private',
        'Perceptive, Suspicious, Patient',
        'Competitive, Easily Provoked, Relentless',
        'Generous, Frugal, Status-Conscious',
        'Charming, Socially Awkward, Observant',
        'Brilliant, Pedantic, Irritable',
        'Compassionate, Controlling, Anxious',
        'Independent, Defiant, Resourceful',
        'Earnest, Superstitious, Loyal',
        'Restless, Sentimental, Adaptable',
        'Blunt, Impatient, Dependable',
        'Diplomatic, Avoidant, Kind',
        'Vain, Perceptive, Generous',
        'Nosy, Warm, Tactless',
        'Fatalistic, Practical, Dry-humoured',
        'Idealistic, Stubborn, Earnest',
        'Possessive, Devoted, Watchful',
        'Irreverent, Loyal, Sharp-tongued',
        'Romantic, Cynical, Observant',
        'Self-deprecating, Ambitious, Tireless',
        'Patient, Territorial, Forgiving',
        'Vindictive, Charming, Patient',
        'Awkward, Generous, Secretly Proud',
        'Dramatic, Loyal, Easily Distracted',
        'Pragmatic, Sentimental, Guarded',
        'Cautious, Warm, Territorial'
    ];

    // ============================================================
    // PERSONALITY POOLS
    // ============================================================
    //
    // Ten existing pools (unchanged) plus four new ones. The four
    // new pools are picked independently, same as the existing
    // ten. No archetype system, no hidden dimensions.

    var PERSONALITY_POOLS = {
        ideals: [
            'Honor and Duty',
            'Justice and Fairness',
            'Courage and Sacrifice',
            'Wisdom and Understanding',
            'Compassion and Mercy',
            'Freedom and Choice',
            'Individuality and Expression',
            'Change and Progress',
            'Self-determination and Autonomy',
            'Tradition and Order',
            'Structure and Hierarchy',
            'Law and Stability',
            'Knowledge and Truth',
            'Discovery and Inquiry',
            'Learning and Mastery',
            'Power and Ambition',
            'Greatness and Legacy',
            'Excellence and Renown',
            'Loyalty and Family',
            'Community and Belonging',
            'Friendship and Trust',
            'Peace and Harmony',
            'Balance and Moderation',
            'Coexistence and Tolerance',
            'Craftsmanship and Art',
            'Beauty and Expression',
            'Precision and Excellence',
            'Faith and Devotion',
            'Tradition and Ritual',
            'Connection to the Divine',
            'Survival and Endurance',
            'Strength and Resilience'
        ],

        bonds: [
            'Protecting their family',
            'A parent they lost',
            'A sibling they protect',
            'A child they left behind',
            'A family name to restore',
            'A childhood friend',
            'Their closest ally',
            'A friendship they broke',
            'A companion through dark times',
            'A lost love',
            'A promise to a partner',
            'A beloved they cannot return to',
            'A mentor who saved them',
            'A student they failed',
            'A teacher\'s legacy to honor',
            'A sacred oath',
            'Their honor',
            'A promise made',
            'A duty to their homeland',
            'Their homeland',
            'Their community',
            'A village they abandoned',
            'A place they can never return to',
            'A treasured artifact',
            'A keepsake from a loved one',
            'A weapon with a story',
            'A journal they carry',
            'A secret they must protect',
            'A truth they cannot speak',
            'A rival they respect',
            'A rival they must surpass'
        ],

        flaws: [
            'Too trusting',
            'Distrustful of others',
            'Too proud to ask for help',
            'Quick to anger',
            'Vengeful',
            'Holds grudges',
            'Afraid of failure',
            'Self-doubting',
            'Fearful of being forgotten',
            'Reckless in pursuit of goals',
            'Impulsive',
            'Overconfident',
            'Overly cautious',
            'Indecisive',
            'Slow to act',
            'Stubborn',
            'Perfectionist',
            'Cannot admit fault',
            'Secretive',
            'Cannot ask for help',
            'Hides their true self',
            'Haunted by a past mistake',
            'Carries guilt from a failure',
            'Cannot forgive themselves',
            'Obsessive',
            'Unhealthily devoted',
            'All-consuming focus',
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
            'Music', 'Art', 'Poetry', 'Dance', 'Theatre', 'Sculpture',
            'Stories', 'Nature', 'Animals', 'Flowers', 'Stargazing',
            'The Sea', 'Forests', 'Mountains', 'Books', 'History',
            'Science', 'Languages', 'Riddles', 'Debate', 'Philosophy',
            'Good Food', 'Cooking', 'Gardening', 'Crafting', 'Baking',
            'Tea', 'Wine', 'Training', 'Running', 'Swimming',
            'Climbing', 'Sparring', 'Games', 'Gossip', 'Feasts',
            'Travel', 'Festivals', 'Company', 'Meditation', 'Solitude',
            'Journaling', 'Long walks', 'Rainy days'
        ],

        dislikes: [
            'Lies', 'Cruelty', 'Injustice', 'Betrayal', 'Greed',
            'Dishonesty', 'Hypocrisy', 'Bullying', 'Arrogance',
            'Crowds', 'Small talk', 'Fawning', 'Rudeness',
            'Pretension', 'Loud Noises', 'Strong smells',
            'Bright lights', 'Bad Weather', 'Cold', 'Heat', 'Damp',
            'Ignorance', 'Stupidity', 'Wasted potential',
            'Rigid thinking', 'Boredom', 'Haste', 'Chaos',
            'Complacency', 'Indecision', 'Idleness', 'Weakness',
            'Slovenliness'
        ],

        habits: [
            'Hums while working',
            'Talks to themselves',
            'Whistles tunelessly',
            'Repeats words back',
            'Mutters when reading',
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
            'Collects small trinkets',
            'Keeps every receipt',
            'Picks up smooth stones',
            'Pockets interesting leaves',
            'Touches a talisman before danger',
            'Counts steps on stairs',
            'Checks locks twice',
            'Sleeps with a weapon nearby',
            'Wakes before dawn',
            'Laughs at their own jokes',
            'Apologizes unnecessarily',
            'Says goodbye three times',
            'Remembers small favors',
            'Speaks to animals',
            'Names their weapons',
            'Writes in the margins',
            'Keeps a dream journal'
        ],

        fears: [
            'Heights', 'Spiders', 'Claustrophobia', 'Drowning',
            'Fire', 'Darkness', 'Deep water', 'Enclosed spaces',
            'Open spaces', 'Being forgotten', 'Failure',
            'Loss of control', 'The unknown', 'Madness',
            'Meaninglessness', 'Outliving their purpose',
            'Rejection', 'Betrayal', 'Losing loved ones',
            'Disappointing their family', 'Being a burden',
            'Being alone', 'Becoming a monster',
            'Losing themselves', 'Losing their memories',
            'Being seen as they truly are',
            'Committing an unforgivable act',
            'Becoming the villain',
            'Hurting those they love',
            'Poverty', 'Poverty in old age',
            'Failing their dependents',
            'The dead', 'Magic itself',
            'Becoming a vessel', 'Prophetic dreams'
        ],

        goals: [
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
            'To become a legend',
            'To surpass their mentor',
            'To lead their people',
            'To found a school',
            'To write the definitive account',
            'To reconcile with their family',
            'To find a lost sibling',
            'To avenge a wrong',
            'To repay a debt',
            'To keep a promise',
            'To master forbidden knowledge',
            'To catalogue every species',
            'To translate an ancient text',
            'To find a lost city',
            'To undo an old mistake',
            'To heal a wound they caused',
            'To rebuild what was destroyed',
            'To live quietly',
            'To raise a family',
            'To die well',
            'To see one more sunrise'
        ],

        // ---- New: relationship to authority ----

        authority: [
            'Respectful of authority',
            'Suspicious of authority',
            'Obedient when supervised',
            'Cooperative but independent',
            'Defiant toward authority',
            'Enjoys having authority',
            'Distrusts institutions but respects individuals',
            'Follows rules they consider legitimate',
            'Tests boundaries constantly',
            'Sees hierarchy as necessary',
            'Sees hierarchy as a game',
            'Ignores authority until forced to acknowledge it',
            'Prefers to lead rather than be led',
            'Loyal to people, not positions',
            'Polite to superiors, dismissive of peers'
        ],

        // ---- New: how they handle conflict ----

        conflictStyle: [
            'Confronts problems immediately',
            'Avoids conflict until forced to act',
            'Negotiates first',
            'Uses humour to defuse tension',
            'Becomes colder under pressure',
            'Escalates when challenged',
            'Looks for a third option',
            'Lets resentment build quietly',
            'Withdraws and returns later',
            'Fights fair even when losing',
            'Fights dirty and wins',
            'Never raises their voice',
            'Never raises their hand first',
            'Treats arguments as puzzles',
            'Treats arguments as battles'
        ],

        // ---- New: how they relate socially ----

        socialStyle: [
            'Warm with strangers',
            'Reserved until trust is earned',
            'Naturally charismatic',
            'Blunt and unintentionally intimidating',
            'Friendly but emotionally private',
            'Suspicious of friendliness',
            'Flirtatious without meaning to be',
            'Prefers one-to-one conversation',
            'Thrives in groups',
            'Listens more than they speak',
            'Fills every silence',
            'Reads people quickly and correctly',
            'Reads people slowly but accurately',
            'Adapts their manner to each person',
            'Is exactly the same with everyone'
        ],

        // ---- New: behavioural oddities ----
        //
        // Distinct from habits. Habits describe physical mannerisms
        // (taps fingers). Quirks describe character-level
        // behaviours (cannot resist correcting pronunciation).
        // Both are worth having; they are not the same thing.

        quirks: [
            'Cannot resist correcting pronunciation',
            'Makes jokes at inappropriate moments',
            'Remembers birthdays, forgets appointments',
            'Refuses to sit with their back to a door',
            'Talks more when nervous',
            'Goes unnaturally quiet when angry',
            'Pretends not to care about things they care about',
            'Becomes competitive over trivial things',
            'Always has a story that starts with "This reminds me..."',
            'Cannot throw away anything that might be useful',
            'Treats strangers more politely than friends',
            'Becomes suspicious when someone is too nice',
            'Hates owing anyone a favour',
            'Collects information they have no use for',
            'Never uses the last of anything',
            'Has an irrational hatred of being interrupted',
            'Will help someone while insisting they are not helping',
            'Gets attached to places rather than people',
            'Has difficulty recognising flirting',
            'Remembers insults for years, compliments for minutes',
            'Lies badly but believes they are convincing',
            'Becomes more polite when furious',
            'Cannot resist a mystery',
            'Always negotiates, even when there is nothing to negotiate',
            'Treats rules as suggestions unless personally agreed with'
        ]
    };

    // ============================================================
    // UTILITIES
    // ============================================================

    function pickRandom(arr) {
        if (!Array.isArray(arr) || arr.length === 0) { return null; }
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

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
            if (roll < acc) { return tiers[keys[j]]; }
        }
        return tiers[keys[keys.length - 1]];
    }

    /**
     * Pick a single trait phrase. Weights the two pools:
     * core 70%, behavioural 30%.
     */
    function pickTraitPhrase() {
        var total = TRAIT_CORE_WEIGHT + TRAIT_BEHAVIOURAL_WEIGHT;
        var roll = Math.random() * total;
        if (roll < TRAIT_CORE_WEIGHT) {
            return pickRandom(TRAIT_POOL_CORE);
        }
        return pickRandom(TRAIT_POOL_BEHAVIOURAL);
    }

    // ============================================================
    // PHYSICAL HELPERS
    // ============================================================

    /**
     * Parse "175cm" to 175. Returns null on failure.
     */
    function parseHeightCm(heightStr) {
        if (typeof heightStr !== 'string') { return null; }
        var m = heightStr.match(/^(\d+)\s*cm$/i);
        if (!m) { return null; }
        var n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) { return null; }
        return n;
    }

    /**
     * Parse "72kg" to 72. Returns null on failure.
     */
    function parseWeightKg(weightStr) {
        if (typeof weightStr !== 'string') { return null; }
        var m = weightStr.match(/^(\d+)\s*kg$/i);
        if (!m) { return null; }
        var n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) { return null; }
        return n;
    }

    /**
     * Compute the weight range (in kg) for a given height (in cm)
     * and profile ratio range. Uses the profile's ratio as the
     * internal multiplier against height² — this is the same
     * mechanism as BMI, but it is not exposed as a domain concept.
     */
    function calculateWeightRange(heightCm, ratioRange) {
        var heightM = heightCm / 100;
        var sq = heightM * heightM;
        var minWeight = Math.round(ratioRange[0] * sq);
        var maxWeight = Math.round(ratioRange[1] * sq);
        if (maxWeight < minWeight) { maxWeight = minWeight; }
        return [minWeight, maxWeight];
    }

    /**
     * Which profile best contains this height?
     * Used by per-field reroll to preserve the current body shape.
     */
    function findProfilesForHeight(heightCm) {
        var result = [];
        var keys = Object.keys(BODY_PROFILES);
        for (var i = 0; i < keys.length; i++) {
            var p = BODY_PROFILES[keys[i]];
            if (heightCm >= p.height[0] && heightCm <= p.height[1]) {
                result.push(p);
            }
        }
        return result;
    }

    /**
     * Which profiles contain both this height AND a weight range
     * that includes this weight?
     */
    function findProfilesForHeightAndWeight(heightCm, weightKg) {
        var result = [];
        var keys = Object.keys(BODY_PROFILES);
        for (var i = 0; i < keys.length; i++) {
            var p = BODY_PROFILES[keys[i]];
            if (heightCm < p.height[0] || heightCm > p.height[1]) {
                continue;
            }
            var range = calculateWeightRange(heightCm, p.ratio);
            if (weightKg >= range[0] && weightKg <= range[1]) {
                result.push(p);
            }
        }
        return result;
    }

    function findComplexionTierForSkin(skin) {
        if (typeof skin !== 'string') { return null; }
        var keys = Object.keys(COMPLEXION_TIERS);
        for (var i = 0; i < keys.length; i++) {
            var tones = COMPLEXION_TIERS[keys[i]].skinTones;
            if (tones.indexOf(skin) !== -1) {
                return COMPLEXION_TIERS[keys[i]];
            }
        }
        return null;
    }

    function unionComplexionField(fieldName) {
        var seen = Object.create(null);
        var out = [];
        var keys = Object.keys(COMPLEXION_TIERS);
        for (var i = 0; i < keys.length; i++) {
            var list = COMPLEXION_TIERS[keys[i]][fieldName] || [];
            for (var j = 0; j < list.length; j++) {
                if (!seen[list[j]]) {
                    seen[list[j]] = true;
                    out.push(list[j]);
                }
            }
        }
        return out;
    }

    // ============================================================
    // PHYSICAL GENERATION
    // ============================================================

    /**
     * Generate a full physical profile from scratch:
     *   profile → height → weight → build
     * then complexion → skin → hair → eyes
     */
    function generatePhysical() {
        var profile = pickWeightedTier(BODY_PROFILES);
        var complexion = pickWeightedTier(COMPLEXION_TIERS);

        var heightCm = randomInt(profile.height[0], profile.height[1]);
        var weightRange = calculateWeightRange(heightCm, profile.ratio);
        var weightKg = randomInt(weightRange[0], weightRange[1]);
        var build = pickRandom(profile.builds) || 'Average';

        return {
            gender: pickRandom(GENDERS) || 'Other',
            skin: pickRandom(complexion.skinTones) || 'Fair',
            hair: pickRandom(complexion.hairColours) || 'Brown',
            eyes: pickRandom(complexion.eyeColours) || 'Brown',
            height: heightCm + 'cm',
            weight: weightKg + 'kg',
            build: build
        };
    }

    /**
     * Reroll ONE physical field while keeping the current body
     * coherent.
     *
     * HEIGHT:
     *   - Read current weight and build.
     *   - Find profiles whose height range includes a plausible
     *     window for this weight (via findProfilesForHeightAndWeight,
     *     which requires the profile to accept the current weight).
     *   - If no profile fits, fall back to a full generatePhysical().
     *   - Pick a new height from the intersection of that profile
     *     and the current weight.
     *
     *   Weight and build are NOT changed by a height reroll. The
     *   user asked for a new height, not a new body.
     *
     * WEIGHT:
     *   - Read current height and build.
     *   - Find profiles that contain the current height.
     *   - Pick from the union of those profiles' weight ranges at
     *     that height, preferring profiles whose build list
     *     contains the current build.
     *   - Weight reroll does NOT change height or build.
     *
     * BUILD:
     *   - Read current height and weight.
     *   - Find profiles whose height range contains the height AND
     *     whose derived weight range contains the weight.
     *   - Pick a build from the union of those profiles' build
     *     lists.
     *   - Build reroll does NOT change height or weight.
     *
     * GENDER, SKIN, HAIR, EYES:
     *   - Skin and hair and eyes use the existing complexion tier
     *     logic. Gender is a flat pick.
     *
     * @param {string} field - 'height' | 'weight' | 'build' |
     *                         'skin' | 'hair' | 'eyes' | 'gender'
     * @param {object} current - The current physical object
     * @returns {string|null} The new value, or null
     */
    function generatePhysicalField(field, current) {
        current = current || {};

        // ---- Flat pick ----
        if (field === 'gender') {
            return pickRandom(GENDERS) || 'Other';
        }

        // ---- Height ----
        if (field === 'height') {
            var curWeight = parseWeightKg(current.weight);
            var candidates = [];

            if (curWeight !== null) {
                var allProfiles = Object.keys(BODY_PROFILES);
                for (var i = 0; i < allProfiles.length; i++) {
                    var p = BODY_PROFILES[allProfiles[i]];
                    var minH = p.height[0];
                    var maxH = p.height[1];
                    for (var h = minH; h <= maxH; h++) {
                        var range = calculateWeightRange(h, p.ratio);
                        if (curWeight >= range[0] && curWeight <= range[1]) {
                            candidates.push(h);
                        }
                    }
                }
            }

            if (candidates.length > 0) {
                return pickRandom(candidates) + 'cm';
            }

            // Fallback: full re-roll of the body.
            var fresh = generatePhysical();
            return fresh.height;
        }

        // ---- Weight ----
        if (field === 'weight') {
            var curHeight = parseHeightCm(current.height);
            var curBuild = current.build || '';

            if (curHeight !== null) {
                var profilesForHeight = findProfilesForHeight(curHeight);
                if (profilesForHeight.length > 0) {
                    // Prefer profiles that accept the current build.
                    var preferred = [];
                    for (var pi = 0; pi < profilesForHeight.length; pi++) {
                        if (profilesForHeight[pi].builds.indexOf(curBuild) !== -1) {
                            preferred.push(profilesForHeight[pi]);
                        }
                    }
                    var pool = preferred.length > 0
                        ? preferred
                        : profilesForHeight;

                    // Gather weight values from all profiles in pool.
                    var weights = [];
                    for (var wi = 0; wi < pool.length; wi++) {
                        var wr = calculateWeightRange(curHeight, pool[wi].ratio);
                        for (var w = wr[0]; w <= wr[1]; w += 1) {
                            weights.push(w);
                        }
                    }
                    if (weights.length > 0) {
                        return pickRandom(weights) + 'kg';
                    }
                }
            }

            // Fallback: full re-roll.
            var freshW = generatePhysical();
            return freshW.weight;
        }

        // ---- Build ----
        if (field === 'build') {
            var curHeightB = parseHeightCm(current.height);
            var curWeightB = parseWeightKg(current.weight);

            if (curHeightB !== null && curWeightB !== null) {
                var profiles = findProfilesForHeightAndWeight(
                    curHeightB, curWeightB
                );

                if (profiles.length > 0) {
                    var builds = [];
                    var seen = Object.create(null);
                    for (var bi = 0; bi < profiles.length; bi++) {
                        var bList = profiles[bi].builds;
                        for (var bj = 0; bj < bList.length; bj++) {
                            if (!seen[bList[bj]]) {
                                seen[bList[bj]] = true;
                                builds.push(bList[bj]);
                            }
                        }
                    }
                    if (builds.length > 0) {
                        return pickRandom(builds);
                    }
                }
            }

            // Fallback: full re-roll.
            var freshB = generatePhysical();
            return freshB.build;
        }

        // ---- Complexion-tier fields ----
        if (field === 'skin' || field === 'hair' || field === 'eyes') {
            var complexion = findComplexionTierForSkin(current.skin);

            var poolName = field === 'skin'
                ? 'skinTones'
                : (field === 'hair' ? 'hairColours' : 'eyeColours');

            if (complexion && Math.random() < 0.7) {
                return pickRandom(complexion[poolName]);
            }

            return pickRandom(unionComplexionField(poolName));
        }

        return null;
    }

    // ============================================================
    // PERSONALITY
    // ============================================================

    /**
     * Generate a full personality record. Fourteen independent
     * picks. No archetype system, no hidden dimensions.
     */
    function generatePersonality() {
        return {
            traits: pickTraitPhrase() || 'Brave, Honest, Loyal',
            ideals: pickRandom(PERSONALITY_POOLS.ideals) || 'Honor and Duty',
            bonds: pickRandom(PERSONALITY_POOLS.bonds) || 'Protecting their family',
            flaws: pickRandom(PERSONALITY_POOLS.flaws) || 'Too trusting',
            alignment: pickRandom(PERSONALITY_POOLS.alignments) || 'Neutral Good',
            likes: pickRandom(PERSONALITY_POOLS.likes) || 'Music',
            dislikes: pickRandom(PERSONALITY_POOLS.dislikes) || 'Lies',
            habits: pickRandom(PERSONALITY_POOLS.habits) || 'Hums while working',
            fears: pickRandom(PERSONALITY_POOLS.fears) || 'Heights',
            goals: pickRandom(PERSONALITY_POOLS.goals) || 'To protect the innocent',
            authority: pickRandom(PERSONALITY_POOLS.authority) || 'Cooperative but independent',
            conflictStyle: pickRandom(PERSONALITY_POOLS.conflictStyle) || 'Negotiates first',
            socialStyle: pickRandom(PERSONALITY_POOLS.socialStyle) || 'Warm with strangers',
            quirks: pickRandom(PERSONALITY_POOLS.quirks) || 'Collects information they have no use for'
        };
    }

    /**
     * Reroll one personality field.
     *
     * `traits` uses the weighted core/behavioural pick. Everything
     * else is a uniform pool pick.
     */
    function generatePersonalityField(field) {
        if (field === 'traits') {
            return pickTraitPhrase();
        }
        var pool = PERSONALITY_POOLS[field];
        if (!Array.isArray(pool)) { return null; }
        return pickRandom(pool);
    }

    // ============================================================
    // STATS
    // ============================================================

    function generateStats3d6() {
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        var stats = {};
        var statMin = CC ? CC.STAT_MIN : 1;
        var statMax = CC ? CC.STAT_MAX : 50;

        for (var i = 0; i < statKeys.length; i++) {
            var roll = randomInt(1, 6) + randomInt(1, 6) + randomInt(1, 6);
            stats[statKeys[i]] = clamp(
                roll,
                Math.max(6, statMin),
                Math.min(18, statMax)
            );
        }
        return stats;
    }

    function generateStats4d6() {
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        var stats = {};
        var statMin = CC ? CC.STAT_MIN : 1;
        var statMax = CC ? CC.STAT_MAX : 50;

        for (var i = 0; i < statKeys.length; i++) {
            var rolls = [
                randomInt(1, 6), randomInt(1, 6),
                randomInt(1, 6), randomInt(1, 6)
            ];
            rolls.sort(function(a, b) { return b - a; });
            var sum = rolls[0] + rolls[1] + rolls[2];
            stats[statKeys[i]] = clamp(
                sum,
                Math.max(6, statMin),
                Math.min(18, statMax)
            );
        }
        return stats;
    }

    // ============================================================
    // MAGIC
    // ============================================================

    function generateMagic(category) {
        if (!CC || !CC.MAGIC_TYPE_KEYS) {
            console.warn(
                'CharacterGenerator: CharacterConstants.MAGIC_TYPE_KEYS ' +
                'not available.'
            );
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

        for (var i = 0; i < magicTypeKeys.length; i++) {
            var key = magicTypeKeys[i];
            var roll = Math.random();
            var isFavoured = categoryTypes.indexOf(key) !== -1;

            if (isFavoured) {
                if (roll < 0.15) { magic[key] = 0; }
                else if (roll < 0.35) { magic[key] = randomInt(1, 3); }
                else if (roll < 0.60) { magic[key] = randomInt(4, 6); }
                else if (roll < 0.80) { magic[key] = randomInt(7, 8); }
                else { magic[key] = randomInt(9, 10); }
            } else {
                if (roll < 0.40) { magic[key] = 0; }
                else if (roll < 0.70) { magic[key] = randomInt(1, 3); }
                else if (roll < 0.90) { magic[key] = randomInt(4, 6); }
                else { magic[key] = randomInt(7, 8); }
            }

            magic[key] = Math.min(magic[key], magicMax);
        }

        return magic;
    }

    function generateMagicCategory(category) {
        return generateMagic(category);
    }

    // ============================================================
    // FULL CHARACTER
    // ============================================================

    function generateCharacter(options) {
        options = options || {};

        if (options.currentYear === undefined || options.currentYear === null) {
            console.warn(
                'CharacterGenerator.generateCharacter: currentYear is ' +
                'required. Using fallback.'
            );
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

        var firstNames = [
            'Aria', 'Bastian', 'Celine', 'Dorian', 'Elara', 'Finn',
            'Gwen', 'Hugo', 'Iris', 'Jasper', 'Kira', 'Liam',
            'Mira', 'Nico', 'Orion', 'Piper', 'Quinn', 'Raven',
            'Sage', 'Theo', 'Uma', 'Valor', 'Willow', 'Xen',
            'Yara', 'Zane'
        ];
        var lastNames = [
            'Blackwood', 'Crest', 'Darkmoon', 'Ember', 'Frost',
            'Grey', 'Hawthorne', 'Ironwood', 'Jade', 'Knight',
            'Light', 'Morrow', 'Night', 'Oak', 'Phoenix', 'Raven',
            'Silver', 'Thorne', 'Umbra', 'Valor', 'Wilde',
            'Winter', 'Ashford', 'Bright', 'Cinder'
        ];

        character.firstName = pickRandom(firstNames) || 'Aria';
        character.lastName = pickRandom(lastNames) || 'Blackwood';

        if (Math.random() < 0.2) {
            var nicknames = [
                'Ari', 'Baz', 'Celly', 'Dory', 'Elle', 'Finn', 'G',
                'Hugh', 'Irie', 'Jazz', 'Kiki', 'Lio', 'Mimi', 'Nick',
                'Ori', 'Pip', 'Quin', 'Rae', 'Sage', 'Theo', 'Val',
                'Willow', 'Z'
            ];
            character.nickname = pickRandom(nicknames) || '';
        }

        if (Math.random() < 0.15) {
            var aliases = [
                'The Shadow', 'Night\'s Edge', 'The Wraith',
                'Stormcaller', 'The Veil', 'Ironheart', 'The Whisper',
                'Flamebearer', 'The Sentinel', 'Duskwalker'
            ];
            character.alias = pickRandom(aliases) || '';
        }

        var age = randomInt(18, 45);
        character.birthYear = String(currentYear - age);

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

        if (includePersonality) {
            character.personality = generatePersonality();
        }

        if (includeStats) {
            character.stats = statsMethod === '4d6'
                ? generateStats4d6()
                : generateStats3d6();
        }

        if (includeMagic) {
            character.magic = generateMagic(magicCategory);
        }

        var specialties = [
            'Combat', 'Arcane Studies', 'Healing', 'Crafting',
            'Leadership', 'Stealth', 'Diplomacy', 'Research'
        ];
        character.specialty = pickRandom(specialties) || '';

        var statuses = ['trainee', 'rookie', 'junior', 'senior', 'instructor'];
        var careerStatus = {
            status: pickRandom(statuses) || 'trainee',
            startYear: String(parseInt(character.birthYear, 10) + randomInt(18, 22)),
            endYear: ''
        };
        character.careerStatus = [careerStatus];

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

        // Utilities (exposed for testing and extensibility)
        pickRandom: pickRandom,
        randomInt: randomInt
    };

})();
