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
 *   Generation order is: profile -> height -> weight -> build.
 *   BMI is not exposed to the character. It is the internal
 *   mechanism, not a stored field.
 *
 * PER-FIELD REROLL:
 *   generatePhysicalField(field, current) rerolls ONE field while
 *   respecting the current body.
 *
 * PERSONALITY MODEL:
 *   Fourteen fields, generated from independent pools. No
 *   archetype system. No hidden dimensions.
 *
 *   Trait picks are weighted 70/30 core-to-behavioural.
 *
 * TRAIT POOLS (this revision):
 *   The trait pools are expanded with descriptors mined from the
 *   graduates file. Existing rows are preserved in their original
 *   order; new rows are appended at the end of each pool under an
 *   "EXPANSION" banner. Row format is unchanged: three short
 *   descriptors, comma-joined, forming one coherent character
 *   sketch. pickTraitPhrase() still picks ONE row, not three
 *   independent descriptors.
 *
 * COMPLEXION MODEL:
 *   Skin tone, hair colour, and eye colour are correlated through
 *   COMPLEXION_TIERS. Weights are expressed by repetition.
 *
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
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
    // Two pools, weighted 70/30 core-to-behavioural.
    //
    // Trait entries are 2-3 short adjectives - this pool is the
    // exception to the "one tag per value" rule. A trait row
    // reads as a comma list and its brevity is the point.
    //
    // pickTraitPhrase() picks ONE row from the winning pool. It
    // does not pick three independent descriptors. The row is
    // authored to describe one coherent person; picking three
    // adjectives independently would produce noise.
    //
    // Rows marked "EXPANSION" were mined from the graduates file's
    // descriptor vocabulary. Existing rows are preserved in their
    // original order so habits about which rows come up often are
    // undisturbed.

    var TRAIT_CORE_WEIGHT = 70;
    var TRAIT_BEHAVIOURAL_WEIGHT = 30;

    var TRAIT_POOL_CORE = [
        // --- Steadfast ---
        'Brave, Honest, Loyal',
        'Reliable, Patient, Grounded',
        'Calm, Collected, Strategic',
        'Stoic, Disciplined, Focused',
        'Dependable, Steady, Kind',
        'Wise, Patient, Kind',
        'Gentle, Thoughtful, Steady',
        'Affectionate, Protective, Warm',
        'Compassionate, Honest, Generous',
        'Humble, Quiet, Modest',
        'Earnest, Simple, True',
        'Faithful, Devout, Steadfast',
        'Cordial, Warm, Open',
        'Patient, Enduring, Kind',
        'Practical, Resourceful, Steady',
        'Direct, Honest, Dependable',
        'Steadfast, Unshakeable, True',
        'Firm, Steady, Just',
        'Just, Fair, Honest',
        'Fair, Balanced, Reasoned',

        // --- Fierce ---
        'Fierce, Proud, Determined',
        'Bold, Reckless, Passionate',
        'Driven, Ambitious, Intense',
        'Passionate, Loyal, Bold',
        'Ferocious, Protective, Devoted',
        'Warm, Empathetic, Nurturing',
        'Righteous, Stern, Unyielding',
        'Dutiful, Formal, Loyal',
        'Honorable, Stubborn, Just',
        'Fierce, Loyal, Protective',
        'Fiercely, Loyal, Protective',
        'Devoted, Protective, Fierce',
        'Devoted, Loyal, Steadfast',
        'Loyal, Protective, Devoted',
        'Confident, Blunt, Sociable',
        'Brash, Loyal, Protective',
        'Fierce, Loyal, Impulsive',
        'Competitive, Bold, Determined',
        'Bold, Daring, Reckless',
        'Daring, Bold, Gallant',
        'Gallant, Chivalrous, Bold',
        'Noble, Honorable, Just',
        'Honorable, True, Brave',
        'True, Loyal, Brave',
        'Brave, True, Steadfast',
        'Outspoken, Bold, Brave',
        'Relentless, Tireless, Fierce',
        'Tireless, Devoted, Patient',
        'Devoted, Single-minded, Fierce',
        'Ambitious, Driven, Focused',
        'Focused, Determined, Unstoppable',
        'Self-reliant, Capable, Steady',
        'Capable, Reliable, Steady',
        'Independent, Self-reliant, Bold',

        // --- Edged ---
        'Cunning, Ambitious, Charming',
        'Sly, Charming, Deceptive',
        'Smooth, Silver-tongued, Watchful',
        'Manipulative, Clever, Cold',
        'Brooding, Intense, Mysterious',
        'Cynical, Wary, Sharp',
        'Acerbic, Brilliant, Guarded',
        'Melancholic, Deep, Introspective',
        'Sardonic, Clever, Bitter',
        'Bitter, Sharp, Haunted',
        'Sombre, Thoughtful, Deep',
        'Wounded, Guarded, Fierce',
        'Haunted, Determined, Protective',
        'Sombre, Quiet, Steadfast',
        'Cynical, Dry, Amused',
        'Wry, Sardonic, Observant',
        'Sarcastic, Sharp, Loyal',
        'Irreverent, Bold, Sharp-tongued',
        'Charming, Manipulative, Watchful',
        'Elegant, Calculating, Diplomatic',
        'Proud, Unyielding, Honorable',
        'Stern, Dutiful, Unyielding',
        'Stubborn, Willful, Bold',
        'Willful, Independent, Bold',
        'Single-minded, Stubborn, Bold',

        // --- Quiet ---
        'Quiet, Observant, Clever',
        'Sharp, Witty, Sarcastic',
        'Calculating, Elegant, Diplomatic',
        'Cerebral, Curious, Precise',
        'Brooding, Silent, Deep',
        'Silent, Observant, Perceptive',
        'Perceptive, Unnerving, Still',
        'Still, Quiet, Deep',
        'Quiet, Watchful, Patient',
        'Sharp, Watchful, Quiet',
        'Clever, Observant, Unassuming',
        'Quiet, Dependable, Kind',
        'Stoic, Silent, Reliable',
        'Silent, Steady, Unmoving',
        'Still, Watchful, Unblinking',
        'Impassive, Cold, Composed',
        'Composed, Still, Controlled',
        'Reserved, Careful, Measured',
        'Measured, Deliberate, Careful',
        'Controlled, Deliberate, Precise',

        // --- Minds ---
        'Wild, Free-spirited, Intuitive',
        'Playful, Curious, Optimistic',
        'Cheerful, Bubbly, Energetic',
        'Impish, Mischievous, Bold',
        'Adventurous, Restless, Bright',
        'Inquisitive, Enthusiastic, Brilliant',
        'Brilliant, Curious, Scattered',
        'Genius, Oblivious, Warm',
        'Inventive, Creative, Bright',
        'Artistic, Creative, Sensitive',
        'Creative, Imaginative, Bright',
        'Imaginative, Dreamy, Distant',
        'Dreamy, Distant, Gentle',
        'Otherworldly, Strange, Quiet',
        'Odd, Quiet, Kind',
        'Eccentric, Bright, Scattered',
        'Visionary, Restless, Brilliant',
        'Eager, Earnest, Bright',
        'Bright, Eager, Optimistic',

        // --- Open ---
        'Sunny, Optimistic, Warm',
        'Cheerful, Bubbly, Warm',
        'Playful, Mischievous, Bright',
        'Impish, Playful, Bold',
        'Warm, Empathetic, Open',
        'Open-hearted, Generous, Kind',
        'Compassionate, Warm, Selfless',
        'Generous, Giving, Warm',
        'Selfless, Devoted, Patient',
        'Patient, Understanding, Wise',
        'Wise, Knowing, Calm',
        'Knowing, Quiet, Kind',
        'Insightful, Perceptive, Deep',
        'Thoughtful, Quiet, Gentle',
        'Gentle, Soft, Kind',
        'Soft-spoken, Gentle, Wise',
        'Mild, Quiet, Unassuming',
        'Unassuming, Humble, Kind',
        'Retiring, Shy, Thoughtful',
        'Shy, Quiet, Kind',
        'Bookish, Quiet, Earnest',
        'Studious, Quiet, Patient',
        'Academic, Precise, Curious',
        'Analytical, Precise, Methodical',
        'Logical, Precise, Calm',

        // --- Deliberate ---
        'Sensible, Practical, Dry',
        'Pragmatic, Steady, Unflappable',
        'Grounded, Sensible, Reliable',
        'Unflappable, Calm, Steady',
        'Calm, Unshakeable, Patient',
        'Steady, Grounded, Warm',
        'Gentle, Generous, Loyal',
        'Warm, Nurturing, Fierce',
        'Blunt, Practical, Loyal',
        'Dry, Amused, Sharp',
        'Amused, Wry, Observant',
        'Observant, Curious, Clever',
        'Curious, Inquisitive, Bright',
        'Bright, Quick, Clever',
        'Quick, Sharp, Bold',
        'Sharp, Cutting, Frank',
        'Frank, Direct, Blunt',
        'Blunt, Honest, Forthright',
        'Forthright, Bold, Frank',
        'Brave, Bold, Reckless',
        'Reckless, Daring, Foolhardy',
        'Careful, Cautious, Wary',
        'Cautious, Watchful, Quiet',
        'Wary, Suspicious, Careful',
        'Vigilant, Watchful, Silent',
        'Vigilant, Protective, Alert',
        'Alert, Aware, Attentive',
        'Attentive, Patient, Kind',

        // --- Mixed (soft + hard in one person) ---
        'Blunt, Tender, Awkward',
        'Warm, Stubborn, Soft',
        'Guarded, Gentle, Exact',
        'Bright, Bruised, Brave',
        'Measured, Warm, Distant',
        'Tangled, Honest, Deep',
        'Simple, Stubborn, Good',
        'Wry, Kind, Closed',
        'Weary, Steady, Kind',
        'Intense, Soft-spoken, Firm',
        'Cynical, Loyal, Quiet',
        'Hopeful, Hard, Practical',
        'Shy, Stubborn, Bright',
        'Feral, Focused, True',
        'Mild, Iron, Patient',
        'Devoted, Difficult, Soft',
        'Clear, Cold, Just',
        'Quiet, Fierce, Loyal',
        'Proud, Careful, Kind',
        'Restless, Honest, Hungry',
        'Cold, Principled, Still',
        'Playful, Private, Sharp',
        'Calm, Cutting, Fair',
        'Earnest, Awkward, True',
        'Stoic, Dry, Reliable',

        // ================================================
        // EXPANSION — mined from the graduates file
        // ================================================

        // --- Analytical minds (Agile, Robert, Caria) ---
        'Analytical, Composed, Perceptive',
        'Analytical, Deliberate, Quietly Stubborn',
        'Strategic, Methodical, Understated',
        'Deliberate, Measured, Diplomatic',
        'Quietly Confident, Diplomatic, Private',
        'Curious, Brilliant, Easily Distracted',
        'Associative, Eccentric, Warm',
        'Obsessive, Inquisitive, Scattered',
        'Researcher-Minded, Eccentric, Open',
        'Socially Open, Curious, Oblivious',
        'Intelligent, Distracted, Generous',
        'Bookish, Brilliant, Absent-Minded',
        'Studious, Introspective, Clinical',
        'Sharp, Exact, Medically Minded',

        // --- Stoic labourers (Charlie, Ronan, Axis, Gale) ---
        'Stoic, Patient, Observant',
        'Hardworking, Stubborn, Deeply Kind',
        'Quiet, Practical, Dependable',
        'Unflappable, Steady, Dry',
        'Practical, Resilient, Easygoing',
        'Level-Headed, Patient, Reserved',
        'Grounded, Self-Sufficient, Gentle',
        'Stubborn, Blunt, Loyal',
        'Slow to Anger, Formidable, Kind',
        'Physically Confident, Relaxed, Dependable',
        'Dependable, Quiet, Observant',
        'Introverted, Practical, Dependable',
        'Rural-Practical, Unhurried, Steady',

        // --- Competitive pressure (Fallow, Danielle, Weiss, Ibex) ---
        'Relentless, Disciplined, Self-Critical',
        'Fiercely Loyal, Impulsive, Guarded',
        'Competitive, Prickly, Proud',
        'Proud, Disciplined, Defensive',
        'Self-Controlled, Prickly, Sharp',
        'Competitive, Cutting, Guarded',
        'Sharp-Tongued, Competitive, Loyal',
        'Restless, Proud, Defensive',
        'Restless, Driven, Independent',
        'Independently Proud, Cutting, Restless',
        'Blunt, Abrasive, Generous',
        'Pragmatic, Blunt, Physically Fearless',
        'Socially Confident, Pragmatic, Abrasive',
        'Confident, Restless, Resourceful',

        // --- Quiet observers (Jinx, Axis, Ronan, Wisteria) ---
        'Quiet, Perceptive, Calm',
        'Reserved, Watchful, Patient',
        'Silent, Attentive, Self-Sufficient',
        'Quiet, Grounded, Unflappable',
        'Still, Patient, Perceptive',
        'Calm, Reserved, Practical',
        'Observant, Wry, Precise',
        'Watchful, Dry, Self-Contained',
        'Perceptive, Quiet, Warm-In-Private',
        'Attentive, Silent, Unassuming',

        // --- Warm social (Basil, Caria, Tatiana, Robert) ---
        'Curious, Enthusiastic, Fearless',
        'Friendly, Socially Confident, Sharp',
        'Warm, Energetic, Blunt',
        'Empathetic, Socially Confident, Mischievous',
        'Talkative, Warm, Practical',
        'Sociable, Resourceful, Abrasive',
        'Confident, Comfortable, Generous',
        'Open, Attentive, Perceptive',
        'Optimistic, Generous, Oblivious',
        'Cheerful, Direct, Distractible',

        // --- Guarded warmth (Jinx, Charlie, Axis, Ibex) ---
        'Guarded, Warm-In-Private, Devoted',
        'Self-Sufficient, Patient, Loyal',
        'Independent, Unhurried, Difficult to Rattle',
        'Reserved, Dependable, Quietly Devoted',
        'Difficult to Rattle, Steady, Private',
        'Slow to Trust, Warm-Once-Committed, Private',
        'Reserved, Honest, Warm-Underneath',
        'Watchful, Loyal, Slow to Warm',

        // --- Friction and edge (Agile/Danielle, Weiss/Robert, Ibex/Danielle) ---
        'Diplomatic, Guarded, Quietly Stubborn',
        'Composed, Analytical, Dryly Amused',
        'Confident, Cutting, Reserved',
        'Wounded, Proud, Fiercely Loyal',
        'Prickly, Loyal, Slow to Forgive',
        'Irritable, Brilliant, Quietly Tender',
        'Proud, Wounded, Fiercely Protective',
        'Arrogant, Observant, Deeply Insecure',
        'Cutting, Self-Controlled, Privately Kind',
        'Jealous, Loyal, Slow to Trust',

        // --- Physically grounded (Fallow, Gale, Charlie, Tatiana) ---
        'Physically Confident, Disciplined, Reliable',
        'Physically Fearless, Pragmatic, Competitive',
        'Relaxed, Tough, Practical',
        'Resilient, Casual, Perceptive',
        'Enduring, Patient, Physically Confident',
        'Grounded, Hardworking, Self-Effacing',
        'Abrasive, Practical, Fiercely Loyal',

        // --- Odd / creative (Robert, Basil) ---
        'Enthusiastic, Oblivious, Warm',
        'Curious, Distracted, Fearless',
        'Optimistic, Associative, Scattered',
        'Inventive, Restless, Easily Amused',

        // --- Eldritch / composed (Weiss, Agile, Wisteria) ---
        'Composed, Controlled, Aggressive',
        'Prickly, Proud, Self-Disciplined',
        'Controlled, Sharp, Slow to Trust',
        'Compact, Aggressive, Physically Dominant',
        'Self-Possessed, Cutting, Deeply Guarded'
    ];

    var TRAIT_POOL_BEHAVIOURAL = [
        // --- Pressure responses ---
        'Confrontational, Protective, Private',
        'Perceptive, Suspicious, Patient',
        'Competitive, Provoked, Relentless',
        'Generous, Frugal, Status-Conscious',
        'Charming, Awkward, Observant',
        'Brilliant, Pedantic, Irritable',
        'Compassionate, Controlling, Anxious',
        'Independent, Defiant, Resourceful',
        'Earnest, Superstitious, Loyal',
        'Restless, Sentimental, Adaptable',
        'Blunt, Impatient, Dependable',
        'Diplomatic, Avoidant, Kind',
        'Vain, Perceptive, Generous',
        'Nosy, Warm, Tactless',
        'Fatalistic, Practical, Dry',
        'Idealistic, Stubborn, Earnest',
        'Possessive, Devoted, Watchful',
        'Irreverent, Loyal, Sharp-tongued',
        'Romantic, Cynical, Observant',
        'Self-deprecating, Ambitious, Tireless',
        'Patient, Territorial, Forgiving',
        'Vindictive, Charming, Patient',
        'Awkward, Generous, Proud',
        'Dramatic, Loyal, Distracted',
        'Pragmatic, Sentimental, Guarded',
        'Cautious, Warm, Territorial',

        // --- Contradictions ---
        'Loyal, Withholding, Testing',
        'Devoted, Demanding, Watchful',
        'Protective, Possessive, Quiet',
        'Fierce, Gentle, Private',
        'Warm, Withdrawn, Waiting',
        'Cold, Considered, Cutting',
        'Sharp, Sly, Smiling',
        'Quiet, Quick, Unnerving',
        'Silent, Perceptive, Unsettling',
        'Loud, Loose, Irreverent',
        'Bright, Brash, Bruising',
        'Blunt, Blithe, Careless',
        'Careless, Warm, Forgetful',
        'Forgetful, Warm, Apologetic',
        'Apologetic, Anxious, Kind',
        'Anxious, Watchful, Careful',
        'Nervous, Quiet, Observant',
        'Timid, Careful, Hesitant',
        'Hesitant, Quiet, Wary',
        'Wary, Wounded, Guarded',
        'Guarded, Cold, Composed',
        'Composed, Distant, Watchful',
        'Distant, Kind, Unreachable',
        'Kind, Cutting, Inconsistent',
        'Inconsistent, Warm, Frustrating',
        'Frustrating, Brilliant, Oblivious',
        'Oblivious, Warm, Enthusiastic',
        'Enthusiastic, Scattered, Bright',
        'Scattered, Brilliant, Careless',
        'Pedantic, Precise, Annoying',

        // --- Competence ---
        'Precise, Controlled, Cold',
        'Controlled, Deliberate, Cutting',
        'Deliberate, Slow, Steady',
        'Slow, Patient, Unshakeable',
        'Territorial, Fierce, Protective',
        'Fierce, Competitive, Bold',
        'Competitive, Relentless, Focused',
        'Focused, Intense, Demanding',
        'Intense, Brooding, Watchful',
        'Silent, Haunted, Still',
        'Haunted, Driven, Desperate',
        'Driven, Reckless, Brilliant',
        'Bold, Loud, Unstoppable',
        'Unstoppable, Tireless, Fierce',
        'Tireless, Relentless, Devoted',
        'Devoted, Selfless, Martyr',
        'Selfless, Generous, Guilt-ridden',
        'Guilt-ridden, Kind, Wounded',
        'Wounded, Warm, Withholding',
        'Warm, Present, Patient',
        'Present, Quiet, Kind',
        'Quiet, Still, Knowing',
        'Knowing, Amused, Quiet',
        'Amused, Wry, Patient',
        'Wry, Sharp, Observant',
        'Sharp, Silly, Sudden',
        'Silly, Warm, Bright',
        'Bright, Brief, Blazing',
        'Blazing, Fierce, Brief',
        'Fierce, Sudden, Devastating',
        'Sudden, Quiet, Deadly',
        'Deadly, Patient, Precise',
        'Precise, Cold, Efficient',
        'Efficient, Ruthless, Calm',
        'Ruthless, Efficient, Just',
        'Just, Stern, Unyielding',
        'Stern, Disciplined, Cold',
        'Disciplined, Focused, Silent',
        'Unmoving, Patient, Stone',
        'Stone, Still, Enduring',
        'Enduring, Patient, Quiet',
        'Quiet, Deep, Rooted',
        'Rooted, Reaching, Restless',
        'Restless, Reaching, Wistful',
        'Wistful, Dreamy, Distant',
        'Distant, Cold, Kind',
        'Kind, Hesitant, Wounded',
        'Hesitant, Tender, Testing',
        'Testing, Careful, Kept',
        'Kept, Guarded, Holding',
        'Holding, Waiting, Patient',
        'Waiting, Watchful, Wary',
        'Wary, Warm, Wondering',
        'Wondering, Curious, Careful',
        'Careful, Cat-like, Quiet',
        'Cat-like, Quick, Silent',
        'Silent, Quick, Deadly',
        'Deadly, Kind, Contradictory',
        'Contradictory, Warm, Cold',

        // ================================================
        // EXPANSION — mined from the graduates file
        // ================================================

        // --- Under pressure (Fallow, Ibex, Danielle, Weiss) ---
        'Escalates When Challenged, Relentless, Self-Critical',
        'Pushes Past Exhaustion, Disciplined, Self-Doubting',
        'Interprets Rest as Weakness, Competitive, Driven',
        'Blunt When Frustrated, Loyal, Self-Critical',
        'Confrontational, Defensive, Proud',
        'Takes Criticism Personally, Proud, Sharp',
        'Competitive When Cornered, Cutting, Restless',
        'Aggressive When Threatened, Protective, Controlled',
        'Difficult to Provoke, Deadly, Patient',
        'Slow to Anger, Formidable, Restrained',

        // --- Guarded under warmth (Jinx, Axis, Ronan) ---
        'Withdrawn Under Stress, Patient, Quietly Present',
        'Goes Silent When Frightened, Perceptive, Steady',
        'Moves Quietly, Watches Closely, Withholds Words',
        'Keeps Distance, Watches Hands, Waits',
        'Retreats Into Silence, Practical, Self-Contained',
        'Overly Cautious, Attentive, Difficult to Reassure',
        'Avoids Confrontation, Measured, Loyal',
        'Says Little, Notices Much, Forgives Slowly',

        // --- Oblivious to self (Robert, Basil) ---
        'Curiosity Overrides Caution, Obsessive, Warm',
        'Distracted by Questions, Brilliant, Oblivious',
        'Pushes Past Own Limits, Enthusiastic, Well-Meaning',
        'Blind to Subtext, Warm, Curious',
        'Genuinely Kind, Slightly Insensitive, Absent-Minded',
        'Skips Meals While Researching, Obsessive, Gentle',
        'Talks Past People, Enthusiastic, Brilliant',
        'Approaches Danger as Curiosity, Fearless, Oblivious',

        // --- Protective pressure (Charlie, Gale, Tatiana, Fallow) ---
        'Steps in Front First, Protective, Quiet',
        'Physically Inserts Self, Loyal, Unhesitating',
        'Protects Without Comment, Stoic, Fierce-Underneath',
        'Endures Instead of Asking, Patient, Martyr-Prone',
        'Takes Responsibility for Others, Loyal, Burdened',
        'Says Nothing, Does Everything, Quietly Exhausted',
        'Anchors Others, Steady, Slow to Show Strain',
        'Protects First, Reflects After, Rarely Regrets',

        // --- Composure under strain (Agile, Ronan, Jinx) ---
        'Composed Under Pressure, Analytical, Withholding',
        'Calm in Crisis, Deliberate, Private',
        'Reads the Room, Says Little, Decides Slowly',
        'Thinks First, Speaks Second, Rarely Regrets',
        'Patient With Everyone, Impatient With Self',
        'Waits for Certainty, Deliberate, Frustrated by Chaos',
        'Analyses Before Acting, Slow to Panic, Withholding',

        // --- Sharpened edge (Ibex, Weiss, Danielle) ---
        'Sharp-Tongued When Wounded, Loyal, Slow to Forgive',
        'Turns Vulnerability Into an Argument, Proud, Wounded',
        'Jokes When Uncomfortable, Dry, Guarded',
        'Cutting When Cornered, Brilliant, Ashamed Afterward',
        'Defensive When Praised, Prickly, Privately Pleased',
        'Argumentative When Vulnerable, Loyal, Guarded',
        'Pushes People Away, Resents Being Alone, Loyal',
        'Provokes When Uncertain, Restless, Seeking Confirmation',

        // --- Warm in private (Charlie, Jinx, Axis, Ronan) ---
        'Warm When Safe, Guarded Otherwise, Devoted',
        'Shows Affection Through Action, Quiet, Unhurried',
        'Present Without Words, Patient, Watching',
        'Affectionate in Private, Reserved in Public, Loyal',
        'Cooks for People Instead of Talking, Practical, Kind',
        'Fixes Things for People Instead of Explaining, Quiet, Attentive',
        'Notices Small Needs, Acts Without Announcing, Private',

        // --- Tactical under strain (Agile, Jinx, Axis) ---
        'Controls Variables Before Committing, Analytical, Frustrated by Improvisation',
        'Prepares for Every Outcome, Methodical, Slow to Adjust',
        'Forces Movement Through Terrain, Patient, Calculating',
        'Shapes the Battlefield Before the Fight, Perceptive, Withholding',
        'Positions Before Acting, Observant, Reserved',
        'Reads Opponents, Waits for Openings, Precise',

        // --- Passive under love (Charlie, Ronan, Axis) ---
        'Indispensable to Everyone, Passive in Own Life, Loving',
        'Confuses Usefulness With Worth, Devoted, Working On It',
        'Tolerates What Should Be Refused, Loyal, Learning Boundaries',
        'Makes Self Necessary, Quietly Drowning, Warm',

        // --- Curious-brave (Basil, Robert, Ibex) ---
        'Investigates Before Retreating, Curious, Reckless',
        'Takes Physical Risks for Knowledge, Fearless, Oblivious',
        'Handles Dangerous Things Gently, Patient, Unflinching',
        'Approaches the Strange Without Prejudice, Curious, Kind',

        // --- Composed-aggressive (Wisteria, Weiss, Fallow) ---
        'Closes Distance Fast, Aggressive, Physically Dominant',
        'Overwhelms Before Being Overwhelmed, Competitive, Focused',
        'Uses Terrain to Isolate, Aggressive, Tactically Narrow',
        'Sets Up Opening Then Strikes, Aggressive, Controlled'
    ];

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

    function parseHeightCm(heightStr) {
        if (typeof heightStr !== 'string') { return null; }
        var m = heightStr.match(/^(\d+)\s*cm$/i);
        if (!m) { return null; }
        var n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) { return null; }
        return n;
    }

    function parseWeightKg(weightStr) {
        if (typeof weightStr !== 'string') { return null; }
        var m = weightStr.match(/^(\d+)\s*kg$/i);
        if (!m) { return null; }
        var n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) { return null; }
        return n;
    }

    function calculateWeightRange(heightCm, ratioRange) {
        var heightM = heightCm / 100;
        var sq = heightM * heightM;
        var minWeight = Math.round(ratioRange[0] * sq);
        var maxWeight = Math.round(ratioRange[1] * sq);
        if (maxWeight < minWeight) { maxWeight = minWeight; }
        return [minWeight, maxWeight];
    }

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

    function generatePhysicalField(field, current) {
        current = current || {};

        if (field === 'gender') {
            return pickRandom(GENDERS) || 'Other';
        }

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

            var fresh = generatePhysical();
            return fresh.height;
        }

        if (field === 'weight') {
            var curHeight = parseHeightCm(current.height);
            var curBuild = current.build || '';

            if (curHeight !== null) {
                var profilesForHeight = findProfilesForHeight(curHeight);
                if (profilesForHeight.length > 0) {
                    var preferred = [];
                    for (var pi = 0; pi < profilesForHeight.length; pi++) {
                        if (profilesForHeight[pi].builds.indexOf(curBuild) !== -1) {
                            preferred.push(profilesForHeight[pi]);
                        }
                    }
                    var pool = preferred.length > 0
                        ? preferred
                        : profilesForHeight;

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

            var freshW = generatePhysical();
            return freshW.weight;
        }

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

            var freshB = generatePhysical();
            return freshB.build;
        }

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

    function generatePersonality() {
        return {
            traits: pickTraitPhrase() || 'Brave, Honest, Loyal',
            ideals: pickRandom(PERSONALITY_POOLS.ideals) || 'Honor',
            bonds: pickRandom(PERSONALITY_POOLS.bonds) || 'Family',
            flaws: pickRandom(PERSONALITY_POOLS.flaws) || 'Proud',
            alignment: pickRandom(PERSONALITY_POOLS.alignments) || 'Neutral Good',
            likes: pickRandom(PERSONALITY_POOLS.likes) || 'Music',
            dislikes: pickRandom(PERSONALITY_POOLS.dislikes) || 'Lies',
            habits: pickRandom(PERSONALITY_POOLS.habits) || 'Hums',
            fears: pickRandom(PERSONALITY_POOLS.fears) || 'Heights',
            goals: pickRandom(PERSONALITY_POOLS.goals) || 'Find purpose',
            authority: pickRandom(PERSONALITY_POOLS.authority) || 'Cooperative',
            conflictStyle: pickRandom(PERSONALITY_POOLS.conflictStyle) || 'Negotiates',
            socialStyle: pickRandom(PERSONALITY_POOLS.socialStyle) || 'Warm',
            quirks: pickRandom(PERSONALITY_POOLS.quirks) || 'Corrects pronunciation'
        };
    }

    function generatePersonalityField(field) {
        if (field === 'traits') {
            return pickTraitPhrase();
        }
        var pool = PERSONALITY_POOLS[field];
        if (!Array.isArray(pool)) { return null; }
        return pickRandom(pool);
    }

    // ============================================================
    // PERSONALITY POOLS
    // ============================================================

    var PERSONALITY_POOLS = {
        ideals: [
            'Honor', 'Duty', 'Justice', 'Fairness',
            'Courage', 'Sacrifice', 'Wisdom', 'Understanding',
            'Compassion', 'Mercy', 'Freedom', 'Choice',
            'Individuality', 'Expression', 'Progress', 'Change',
            'Autonomy', 'Tradition', 'Order', 'Structure',
            'Hierarchy', 'Law', 'Stability', 'Knowledge',
            'Truth', 'Discovery', 'Inquiry', 'Learning',
            'Mastery', 'Power', 'Ambition', 'Greatness',
            'Legacy', 'Renown', 'Excellence', 'Loyalty',
            'Family', 'Community', 'Belonging', 'Friendship',
            'Trust', 'Peace', 'Harmony', 'Balance',
            'Moderation', 'Coexistence', 'Tolerance', 'Craft',
            'Art', 'Beauty', 'Precision', 'Faith',
            'Devotion', 'Ritual', 'Divinity', 'Survival',
            'Endurance', 'Strength', 'Resilience', 'Atonement',
            'Redemption', 'Vengeance', 'The past', 'The future',
            'The present', 'The old ways', 'The new ways',
            'The middle path', 'Suffering', 'Joy',
            'Service', 'Dominion', 'Rebellion', 'Silence',
            'Speech', 'Stillness', 'Motion', 'The written word',
            'The spoken word', 'The unsaid', 'The unknown',
            'The known', 'The self', 'The world'
        ],

        bonds: [
            'Family', 'Lost parent', 'Sibling', 'Child left behind',
            'Family name', 'Childhood friend', 'Closest ally',
            'Broken friendship', 'Companion', 'Lost love',
            'Promised partner', 'Unreachable beloved', 'Mentor',
            'Failed student', 'Teacher\'s legacy', 'Sacred oath',
            'Honor', 'Promise made', 'Homeland', 'Home village',
            'Community', 'Abandoned village', 'Unreachable place',
            'Treasured artifact', 'Keepsake', 'Storied weapon',
            'Carried journal', 'Kept secret', 'Unspoken truth',
            'Respected rival', 'Unbeaten rival', 'Unpaid debt',
            'Refused debt', 'Owed favor', 'Refused favor',
            'Held grudge', 'Unhealed wound', 'Visited grave',
            'Remembered song', 'Left house', 'Unentered room',
            'Unsent letter', 'Unanswered question', 'Unspoken name',
            'Unforgotten face', 'Remembered voice', 'Returning smell',
            'Missed season', 'Once-home', 'Lost pet',
            'Old crew', 'Old unit', 'Left guild', 'Cast-out clan',
            'Old school', 'Old trade', 'Old craft', 'Tended garden',
            'Old ship', 'Old library', 'Unfinished map',
            'Unfinished translation', 'Unfinished book',
            'Unfinished painting', 'Unfinished tale', 'Chosen life',
            'Unchosen life', 'Absent friend', 'Distant relative',
            'Kept promise', 'Broken promise', 'Borrowed thing',
            'Lent thing', 'Family trade', 'Family grave'
        ],

        flaws: [
            'Trusting', 'Distrustful', 'Proud', 'Cannot ask',
            'Quick-tempered', 'Vengeful', 'Grudge-keeping',
            'Failure-fearing', 'Self-doubting', 'Forgotten-fearing',
            'Reckless', 'Impulsive', 'Overconfident', 'Overcautious',
            'Indecisive', 'Slow', 'Stubborn', 'Perfectionist',
            'Cannot admit fault', 'Secretive', 'Hides self',
            'Haunted', 'Guilt-ridden', 'Cannot forgive self',
            'Obsessive', 'Over-devoted', 'Consumed', 'Cold',
            'Distant', 'Cannot connect', 'Vain', 'Jealous',
            'Envious', 'Resentful', 'Bitter', 'Suspicious',
            'Paranoid', 'Naive', 'Gullible', 'Idealist',
            'Cynic', 'Fatalist', 'Defeatist', 'Cowardly',
            'Rigid', 'Controlling', 'Smothering', 'Absent',
            'Neglectful', 'Cruel', 'Callous', 'Manipulative',
            'Deceitful', 'Treacherous', 'Disloyal', 'Fickle',
            'Wavering', 'Unreliable', 'Lazy', 'Aimless',
            'Without drive', 'Without purpose', 'Drifting',
            'Coward', 'Bully', 'Sycophant', 'Proud to a fault',
            'Honest to a fault', 'Loyal to a fault',
            'Generous to a fault', 'Stoic to a fault',
            'Selfless to a fault', 'Drunkard', 'Addict',
            'Glutton', 'Miser', 'Spendthrift', 'Gossip',
            'Busybody', 'Meddler', 'Schemer', 'Brooder',
            'Worrier', 'Hypochondriac', 'Fatalistic'
        ],

        alignments: [
            'Lawful Good', 'Neutral Good', 'Chaotic Good',
            'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
            'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'
        ],

        likes: [
            'Music', 'Art', 'Poetry', 'Dance', 'Theatre',
            'Sculpture', 'Stories', 'Nature', 'Animals',
            'Flowers', 'Stargazing', 'The sea', 'Forests',
            'Mountains', 'Rivers', 'Rain', 'Snow', 'Sunrise',
            'Sunset', 'Clouds', 'Thunder', 'Books',
            'History', 'Science', 'Languages', 'Riddles',
            'Debate', 'Philosophy', 'Good food', 'Cooking',
            'Baking', 'Gardening', 'Crafting', 'Sewing',
            'Woodwork', 'Smithing', 'Tea', 'Coffee', 'Wine',
            'Ale', 'Whiskey', 'Training', 'Running',
            'Swimming', 'Climbing', 'Riding', 'Sparring',
            'Wrestling', 'Archery', 'Games', 'Gossip',
            'Feasts', 'Travel', 'Festivals', 'Company',
            'Solitude', 'Meditation', 'Journaling',
            'Long walks', 'Rainy days', 'Cold mornings',
            'Warm nights', 'Fires', 'Old maps', 'Old books',
            'Fresh bread', 'Wild honey', 'Sharp knives',
            'Good boots', 'Soft blankets', 'Small rooms',
            'Tall windows', 'Deep chairs', 'Quiet rooms',
            'Lively halls', 'Libraries', 'Forge-heat',
            'Sea air', 'Pine', 'Lavender', 'Sage',
            'Cardamom', 'Cinnamon', 'Smoke', 'Old wood',
            'Wet stone', 'Fresh ink', 'Leather', 'Wool',
            'Silk', 'Bright colors', 'Muted tones',
            'Contrast', 'Symmetry', 'Asymmetry',
            'Broken things', 'Whole things', 'Fixed things',
            'Unfinished things', 'Riddles', 'Questions',
            'Answers', 'Silence', 'Song', 'Laughter',
            'Weeping', 'Sleeping late', 'Rising early'
        ],

        dislikes: [
            'Lies', 'Cruelty', 'Injustice', 'Betrayal',
            'Greed', 'Dishonesty', 'Hypocrisy', 'Bullying',
            'Arrogance', 'Crowds', 'Small talk', 'Fawning',
            'Rudeness', 'Pretension', 'Loud noises',
            'Strong smells', 'Bright lights', 'Bad weather',
            'Cold', 'Heat', 'Damp', 'Mud', 'Dust',
            'Ignorance', 'Stupidity', 'Wasted potential',
            'Rigid thinking', 'Boredom', 'Haste', 'Chaos',
            'Complacency', 'Indecision', 'Idleness',
            'Weakness', 'Slovenliness', 'Filth', 'Gossip',
            'Meddling', 'Nosiness', 'Sermons', 'Lectures',
            'Pity', 'Condescension', 'Sycophancy',
            'Flattery', 'Boasting', 'Posturing', 'Posing',
            'Ceremony', 'Ritual', 'Tradition', 'Novelty',
            'Fashion', 'Frivolity', 'Waste', 'Luxury',
            'Poverty', 'Wealth', 'Titles', 'Rank',
            'Authority', 'Obedience', 'Rebellion',
            'Fighting', 'Silence', 'Noise', 'Waiting',
            'Rushing', 'Interruption', 'Delay', 'Bad wine',
            'Weak tea', 'Burned food', 'Sour milk',
            'Raw meat', 'Overcooked meat', 'Sweet things',
            'Bitter things', 'Bland food', 'Spice',
            'Strangers', 'Familiarity', 'Questions',
            'Answers', 'Promises', 'Debts', 'Favors'
        ],

        habits: [
            'Hums', 'Whistles', 'Mutters', 'Talks to self',
            'Repeats words', 'Finishes sentences', 'Taps fingers',
            'Fidgets', 'Paces', 'Cracks knuckles', 'Twirls hair',
            'Adjusts glasses', 'Chews lip', 'Rubs chin',
            'Taps foot', 'Counts steps', 'Checks locks',
            'Checks doors', 'Checks windows', 'Pats pockets',
            'Touches talisman', 'Touches weapon', 'Names weapons',
            'Rises early', 'Sleeps late', 'Sleeps badly',
            'Sleeps with weapon', 'Walks daily', 'Trains daily',
            'Reads nightly', 'Writes nightly', 'Keeps a journal',
            'Keeps a dream journal', 'Collects trinkets',
            'Collects stones', 'Collects leaves', 'Collects books',
            'Collects receipts', 'Keeps letters', 'Keeps lists',
            'Keeps time', 'Keeps silence', 'Fills silence',
            'Laughs at own jokes', 'Apologizes unnecessarily',
            'Says goodbye thrice', 'Remembers favors',
            'Remembers slights', 'Speaks to animals',
            'Speaks to plants', 'Names animals', 'Names places',
            'Names things', 'Corrects grammar', 'Corrects facts',
            'Corrects names', 'Tells long stories',
            'Starts stories', 'Ends stories', 'Repeats stories',
            'Sings old songs', 'Quotes old texts',
            'Quotes old friends', 'Recites lists', 'Recites poems',
            'Recites prayers', 'Counts coins', 'Counts days',
            'Marks calendars', 'Maps routes', 'Draws in margins',
            'Writes in margins', 'Underlines books',
            'Dog-ears pages', 'Straightens things',
            'Aligns things', 'Sorts things', 'Orders things',
            'Moves things', 'Hides things', 'Finds things',
            'Loses things', 'Saves things', 'Hoards things',
            'Gives things away', 'Cleans when nervous',
            'Eats when nervous', 'Drinks when nervous'
        ],

        fears: [
            'Heights', 'Spiders', 'Snakes', 'Rats', 'Birds',
            'Claustrophobia', 'Drowning', 'Fire', 'Darkness',
            'Deep water', 'Enclosed spaces', 'Open spaces',
            'Crowds', 'Solitude', 'Being forgotten', 'Failure',
            'Loss of control', 'The unknown', 'Madness',
            'Meaninglessness', 'Outliving purpose', 'Rejection',
            'Betrayal', 'Losing loved ones', 'Disappointing family',
            'Being a burden', 'Being alone', 'Becoming a monster',
            'Losing self', 'Losing memories',
            'Being seen truly', 'Unforgivable acts',
            'Becoming the villain', 'Hurting loved ones',
            'Poverty', 'Poverty in age', 'Failing dependents',
            'The dead', 'Magic', 'Becoming a vessel',
            'Prophetic dreams', 'Silence', 'Noise',
            'Stillness', 'Motion', 'Change', 'Stagnation',
            'The past', 'The future', 'The present',
            'Old age', 'Youth', 'Sickness', 'Weakness',
            'Blindness', 'Deafness', 'Forgetting',
            'Being forgotten', 'Being remembered wrong',
            'Speaking falsely', 'Speaking truly', 'Silence after',
            'The wrong word', 'The wrong tone', 'The wrong face',
            'Anger', 'Coldness', 'Grief', 'Joy',
            'Happiness', 'Contentment', 'Peace', 'War',
            'Battles', 'Blood', 'Wounds', 'Scars',
            'Pain', 'Numbness', 'Sleep', 'Waking',
            'Dreams', 'Nightmares', 'Waking nightmares',
            'Loss', 'Return', 'Being found', 'Being sought',
            'Being wanted', 'Being unwanted', 'Being loved',
            'Being unloved', 'Being needed', 'Being unneeded'
        ],

        goals: [
            'Protect the innocent', 'Achieve greatness',
            'Find purpose', 'Restore honor', 'Discover truth',
            'Build something lasting', 'Master a craft',
            'Find redemption', 'Explore the unknown',
            'Create a better world', 'Prove worthy', 'Become legend',
            'Surpass mentor', 'Lead people', 'Found a school',
            'Write the account', 'Reconcile family',
            'Find lost sibling', 'Avenge a wrong', 'Repay a debt',
            'Keep a promise', 'Master forbidden lore',
            'Catalogue species', 'Translate ancient text',
            'Find lost city', 'Undo old mistake', 'Heal a wound',
            'Rebuild what was destroyed', 'Live quietly',
            'Raise a family', 'Die well', 'See one more sunrise',
            'Retire in peace', 'Die in glory', 'Die in battle',
            'Die at home', 'Kill the enemy', 'Spare the enemy',
            'Save the enemy', 'Betray the cause', 'Serve the cause',
            'Lead the cause', 'Burn it down', 'Build it up',
            'Leave no trace', 'Leave a mark', 'Sink into obscurity',
            'Rise into legend', 'Escape the past',
            'Return to the past', 'Write the future',
            'Read every book', 'Learn every language',
            'Master every weapon', 'Master one weapon',
            'Master no weapon', 'Win the argument',
            'End the argument', 'Start the argument',
            'Keep the peace', 'Shatter the peace',
            'Find the answer', 'Ask the question',
            'Silence the question', 'Speak the truth',
            'Bury the truth', 'Find what was lost',
            'Lose what was found', 'See the world',
            'Never leave home', 'Return home', 'Build a home',
            'Burn the home down', 'Plant a tree', 'Cut the tree',
            'Build the bridge', 'Burn the bridge',
            'Cross the bridge', 'Meet the maker', 'Become the maker',
            'Kill the maker', 'Forgive the maker'
        ],

        authority: [
            'Respectful', 'Suspicious', 'Obedient',
            'Cooperative', 'Defiant', 'Enjoys authority',
            'Distrusts institutions', 'Follows rules', 'Tests rules',
            'Sees hierarchy', 'Sees through hierarchy',
            'Ignores until forced', 'Prefers to lead',
            'Loyal to people', 'Loyal to positions',
            'Polite to superiors', 'Dismissive of peers',
            'Kind to subordinates', 'Harsh to subordinates',
            'Formal with strangers', 'Casual with friends',
            'Stiff with strangers', 'Warm with friends',
            'Playing a role', 'Being themselves',
            'Watching always', 'Speaking plainly',
            'Speaking carefully', 'Saying nothing',
            'Saying everything', 'Holding ground', 'Giving ground',
            'Stepping forward', 'Stepping back', 'Stepping aside',
            'Going around', 'Going through', 'Going over',
            'Going under', 'Going quiet', 'Going loud',
            'Going cold', 'Going warm', 'Going still',
            'Going fast', 'Going slow', 'Going in circles',
            'Going straight', 'Going home', 'Going away'
        ],

        conflictStyle: [
            'Confronts', 'Avoids', 'Negotiates', 'Humours',
            'Grows cold', 'Escalates', 'Withdraws', 'Falls silent',
            'Fights fair', 'Fights dirty', 'Fights harder',
            'Fights softer', 'Never raises voice',
            'Never raises hand', 'Raises both', 'Walks away',
            'Stays rooted', 'Steps forward', 'Steps back',
            'Looks for third option', 'Looks for weakness',
            'Looks for exit', 'Looks for ally',
            'Looks for cause', 'Blames self', 'Blames other',
            'Blames circumstance', 'Forgives quickly',
            'Forgives slowly', 'Never forgives',
            'Keeps score', 'Forgets score', 'Holds the line',
            'Moves the line', 'Erases the line',
            'Draws a new line', 'Wins at cost', 'Wins cheaply',
            'Wins honestly', 'Loses gracefully', 'Loses badly',
            'Refuses to lose', 'Refuses to win', 'Refuses to play',
            'Waits out', 'Talks out', 'Walks out',
            'Fights out', 'Burns out', 'Cools down',
            'Warms up', 'Draws close', 'Pushes away',
            'Bridges the gap', 'Widens the gap'
        ],

        socialStyle: [
            'Warm', 'Reserved', 'Charismatic', 'Blunt',
            'Private', 'Suspicious', 'Flirtatious',
            'One-to-one', 'Group-loving', 'Listens more',
            'Fills silences', 'Reads fast', 'Reads slow',
            'Adapts', 'Same with everyone',
            'Open book', 'Closed book', 'Half-open book',
            'Slow to warm', 'Fast to warm', 'Warm then cold',
            'Cold then warm', 'Always the same',
            'A different person', 'A careful person',
            'A careless person', 'A curious person',
            'An indifferent person', 'A hungry person',
            'A sated person', 'A wondering person',
            'A knowing person', 'A doubting person',
            'A certain person', 'A haunted person',
            'A hopeful person', 'A hopeless person',
            'A practical person', 'A dreamy person',
            'A sharp person', 'A soft person',
            'A hard person', 'A yielding person',
            'A stubborn person', 'A flexible person',
            'A loud person', 'A quiet person',
            'A bright person', 'A dim person'
        ],

        quirks: [
            'Corrects pronunciation', 'Hates being interrupted',
            'Remembers birthdays', 'Forgets appointments',
            'Avoids back-to-door seats', 'Talks when nervous',
            'Goes quiet when angry', 'Pretends not to care',
            'Competitive over trivia', 'Reminisces constantly',
            'Keeps everything', 'Strangers over friends',
            'Suspicious of kindness', 'Hates owing favors',
            'Collects useless facts', 'Never uses the last of',
            'Fiercely territorial', 'Helps while denying help',
            'Attached to places', 'Misses flirting',
            'Remembers insults', 'Forgets compliments',
            'Lies badly', 'Believes their lies',
            'Polite when furious', 'Cannot resist mysteries',
            'Negotiates everything', 'Rules as suggestions',
            'Always early', 'Always late', 'Always rushing',
            'Always waiting', 'Always reading', 'Always moving',
            'Always still', 'Always asking', 'Never asking',
            'Always telling', 'Never telling', 'Always laughing',
            'Never laughing', 'Always crying', 'Never crying',
            'Always watching', 'Never watching', 'Always listening',
            'Never listening', 'Speaks only when asked',
            'Speaks over everyone', 'Waits for silence',
            'Breaks silence', 'Fills gaps', 'Leaves gaps',
            'Finishes sentences', 'Starts sentences',
            'Ends conversations', 'Extends conversations',
            'Leaves too soon', 'Stays too long', 'Arrives late',
            'Departs early', 'Brings gifts', 'Refuses gifts',
            'Gives gifts', 'Forgets names', 'Remembers faces',
            'Remembers names', 'Forgets faces'
        ]
    };

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
