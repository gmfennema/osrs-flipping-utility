/**
 * The OSRS quest graph.
 *
 * One entry per quest. `requires` lists only the quests the wiki names as
 * direct requirements — the transitive set is derived at runtime, so an entry
 * never needs to repeat what its own prerequisites already imply. (Several
 * wiki pages do repeat them; the graph module strips those redundant edges
 * before drawing, so listing an implied quest here is harmless, just noise.)
 *
 * `skills` are the levels the quest itself asks for, not the levels its
 * prerequisites ask for — the requirements view rolls the chain up.
 *
 * `qpNeeded` is a quest-point gate, which is a different kind of wall: it is
 * not satisfied by the chain, only by having done enough quests overall.
 *
 * Miniquests award no quest points but do gate real quests, so the four that
 * sit on a path are included and flagged.
 *
 * Difficulty and quest points follow the wiki's own ratings. This is a
 * hand-maintained snapshot rather than a live feed; see DATA_AS_OF.
 */

export const DATA_AS_OF = 'May 2026';

export const QUESTS = [
    // ---------------------------------------------------------------- F2P ---
    {
        name: 'Below Ice Mountain',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Black Knights\' Fortress',
        members: false,
        difficulty: 'novice',
        qp: 3,
        qpNeeded: 12,
        requires: []
    },
    {
        name: 'Cook\'s Assistant',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'The Corsair Curse',
        members: false,
        difficulty: 'novice',
        qp: 2,
        requires: []
    },
    {
        name: 'Daddy\'s Home',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Demon Slayer',
        members: false,
        difficulty: 'novice',
        qp: 3,
        requires: []
    },
    {
        name: 'Doric\'s Quest',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        skills: { Mining: 15 }
    },
    {
        name: 'Dragon Slayer I',
        members: false,
        difficulty: 'experienced',
        qp: 2,
        qpNeeded: 32,
        requires: [],
        series: 'Dragonkin'
    },
    {
        name: 'Ernest the Chicken',
        members: false,
        difficulty: 'novice',
        qp: 4,
        requires: []
    },
    {
        name: 'Ethically Acquired Antiquities',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Goblin Diplomacy',
        members: false,
        difficulty: 'novice',
        qp: 5,
        requires: [],
        series: 'Dorgeshuun'
    },
    {
        name: 'Imp Catcher',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'The Knight\'s Sword',
        members: false,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Mining: 10 }
    },
    {
        name: 'Misthalin Mystery',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Pirate\'s Treasure',
        members: false,
        difficulty: 'novice',
        qp: 2,
        requires: [],
        series: 'Pirate'
    },
    {
        name: 'Prince Ali Rescue',
        members: false,
        difficulty: 'novice',
        qp: 3,
        requires: []
    },
    {
        name: 'The Restless Ghost',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Romeo & Juliet',
        members: false,
        difficulty: 'novice',
        qp: 5,
        requires: []
    },
    {
        name: 'Rune Mysteries',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Sheep Shearer',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Shield of Arrav',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        series: 'Arrav'
    },
    {
        name: 'Vampyre Slayer',
        members: false,
        difficulty: 'novice',
        qp: 3,
        requires: [],
        series: 'Myreque'
    },
    {
        name: 'Witch\'s Potion',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'X Marks the Spot',
        members: false,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        series: 'Great Kourend'
    },

    // ------------------------------------------------- Members: standalone ---
    {
        name: 'Big Chompy Bird Hunting',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Fletching: 5, Cooking: 30, Ranged: 30 }
    },
    {
        name: 'Clock Tower',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Cold War',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Hunter: 10, Agility: 30, Crafting: 30, Construction: 34, Thieving: 15 },
        series: 'Penguin'
    },
    {
        name: 'The Dig Site',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Agility: 10, Herblore: 10, Thieving: 25 }
    },
    {
        name: 'Druidic Ritual',
        members: true,
        difficulty: 'novice',
        qp: 4,
        requires: []
    },
    {
        name: 'Dwarf Cannon',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        series: 'Dwarf'
    },
    {
        name: 'Eagles\' Peak',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Hunter: 27 }
    },
    {
        name: 'Elemental Workshop I',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Mining: 20, Smithing: 20, Crafting: 20 },
        series: 'Elemental Workshop'
    },
    {
        name: 'Enakhra\'s Lament',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Crafting: 50, Firemaking: 45, Prayer: 43, Magic: 39, Mining: 45 },
        series: 'Desert'
    },
    {
        name: 'Enlightened Journey',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        qpNeeded: 20,
        requires: [],
        skills: { Firemaking: 20, Crafting: 36, Farming: 30 },
        series: 'Balloon'
    },
    {
        name: 'Family Crest',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: [],
        skills: { Mining: 40, Smithing: 40, Magic: 59, Crafting: 40 }
    },
    {
        name: 'The Feud',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Thieving: 30 },
        series: 'Desert'
    },
    {
        name: 'Fight Arena',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        series: 'Mahjarrat'
    },
    {
        name: 'Fishing Contest',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        skills: { Fishing: 10 },
        series: 'Dwarf'
    },
    {
        name: 'The Fremennik Trials',
        members: true,
        difficulty: 'experienced',
        qp: 3,
        requires: [],
        skills: { Woodcutting: 40, Crafting: 40, Fletching: 25 },
        series: 'Fremennik'
    },
    {
        name: 'The Garden of Death',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Farming: 40 }
    },
    {
        name: 'Gertrude\'s Cat',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        series: 'Cat'
    },
    {
        name: 'Getting Ahead',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Crafting: 30, Construction: 26 }
    },
    {
        name: 'The Giant Dwarf',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Crafting: 12, Firemaking: 16, Magic: 33, Thieving: 14 },
        series: 'Dwarf'
    },
    {
        name: 'The Golem',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Crafting: 20, Thieving: 25 },
        series: 'Desert'
    },
    {
        name: 'The Grand Tree',
        members: true,
        difficulty: 'experienced',
        qp: 5,
        requires: [],
        skills: { Agility: 25 },
        series: 'Gnome'
    },
    {
        name: 'The Hand in the Sand',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Thieving: 17, Crafting: 49 }
    },
    {
        name: 'Hazeel Cult',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        series: 'Mahjarrat'
    },
    {
        name: 'Lost City',
        members: true,
        difficulty: 'experienced',
        qp: 3,
        requires: [],
        skills: { Crafting: 31, Woodcutting: 36 }
    },
    {
        name: 'Merlin\'s Crystal',
        members: true,
        difficulty: 'intermediate',
        qp: 6,
        requires: [],
        series: 'Camelot'
    },
    {
        name: 'Mountain Daughter',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Agility: 20 },
        series: 'Fremennik'
    },
    {
        name: 'Murder Mystery',
        members: true,
        difficulty: 'novice',
        qp: 3,
        requires: []
    },
    {
        name: 'Observatory Quest',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Crafting: 10 }
    },
    {
        name: 'Plague City',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        series: 'Elf'
    },
    {
        name: 'A Porcine of Interest',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: []
    },
    {
        name: 'Priest in Peril',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        series: 'Morytania'
    },
    {
        name: 'Rag and Bone Man I',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: []
    },
    {
        name: 'The Ribbiting Tale of a Lily Pad Labour Dispute',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        skills: { Woodcutting: 15 }
    },
    {
        name: 'Sea Slug',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Firemaking: 30 },
        series: 'Sea Slug'
    },
    {
        name: 'Sheep Herder',
        members: true,
        difficulty: 'novice',
        qp: 4,
        requires: []
    },
    {
        name: 'Sleeping Giants',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        skills: { Smithing: 15 }
    },
    {
        name: 'A Soul\'s Bane',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: []
    },
    {
        name: 'Spirits of the Elid',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Magic: 33, Ranged: 37, Mining: 37, Thieving: 37 },
        series: 'Desert'
    },
    {
        name: 'Temple of Ikov',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: [],
        skills: { Thieving: 42, Ranged: 40 }
    },
    {
        name: 'The Tourist Trap',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: [],
        skills: { Fletching: 10, Smithing: 20 },
        series: 'Desert'
    },
    {
        name: 'Tower of Life',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        skills: { Construction: 10 }
    },
    {
        name: 'Tears of Guthix',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        qpNeeded: 43,
        requires: [],
        skills: { Firemaking: 49, Crafting: 20, Mining: 20 }
    },
    {
        name: 'Tree Gnome Village',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: [],
        series: 'Gnome'
    },
    {
        name: 'Tribal Totem',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Thieving: 21 }
    },
    {
        name: 'Watchtower',
        members: true,
        difficulty: 'intermediate',
        qp: 4,
        requires: [],
        skills: { Magic: 15, Thieving: 15, Agility: 25, Herblore: 14, Mining: 40 }
    },
    {
        name: 'Waterfall Quest',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        series: 'Elf'
    },
    {
        name: 'Witch\'s House',
        members: true,
        difficulty: 'intermediate',
        qp: 4,
        requires: []
    },

    // -------------------------------------------------- Members: miniquest ---
    {
        name: 'Alfred Grimhand\'s Barcrawl',
        members: true,
        difficulty: 'novice',
        qp: 0,
        miniquest: true,
        requires: []
    },
    {
        name: 'Enter the Abyss',
        members: true,
        difficulty: 'intermediate',
        qp: 0,
        miniquest: true,
        requires: ['Rune Mysteries']
    },
    {
        name: 'Curse of the Empty Lord',
        members: true,
        difficulty: 'experienced',
        qp: 0,
        miniquest: true,
        requires: ['Desert Treasure I'],
        series: 'Mahjarrat'
    },
    {
        name: 'The General\'s Shadow',
        members: true,
        difficulty: 'experienced',
        qp: 0,
        miniquest: true,
        requires: ['Fight Arena', 'Curse of the Empty Lord'],
        series: 'Mahjarrat'
    },

    // ---------------------------------------------------- Members: chained ---
    {
        name: 'Animal Magnetism',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['The Restless Ghost', 'Ernest the Chicken', 'Priest in Peril'],
        skills: { Slayer: 18, Crafting: 19, Ranged: 30, Woodcutting: 35 }
    },
    {
        name: 'Another Slice of H.A.M.',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Death to the Dorgeshuun', 'The Dig Site'],
        skills: { Attack: 15, Prayer: 25, Mining: 20 },
        series: 'Dorgeshuun'
    },
    {
        name: 'The Ascent of Arceuus',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Client of Kourend'],
        skills: { Hunter: 12 },
        series: 'Great Kourend'
    },
    {
        name: 'At First Light',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Children of the Sun', 'Eagles\' Peak'],
        skills: { Hunter: 46, Herblore: 30, Construction: 27 },
        series: 'Varlamore'
    },
    {
        name: 'Beneath Cursed Sands',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Contact!'],
        skills: { Agility: 62, Crafting: 55, Firemaking: 62, Mining: 55 },
        series: 'Desert'
    },
    {
        name: 'Between a Rock...',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Dwarf Cannon', 'Fishing Contest'],
        skills: { Defence: 30, Mining: 40, Smithing: 50 },
        series: 'Dwarf'
    },
    {
        name: 'Biohazard',
        members: true,
        difficulty: 'intermediate',
        qp: 3,
        requires: ['Plague City'],
        series: 'Elf'
    },
    {
        name: 'Bone Voyage',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['The Dig Site']
    },
    {
        name: 'Cabin Fever',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Pirate\'s Treasure', 'Rum Deal'],
        skills: { Agility: 42, Crafting: 45, Smithing: 50, Ranged: 40 },
        series: 'Pirate'
    },
    {
        name: 'Children of the Sun',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: [],
        series: 'Varlamore'
    },
    {
        name: 'Client of Kourend',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: ['X Marks the Spot'],
        series: 'Great Kourend'
    },
    {
        name: 'Contact!',
        members: true,
        difficulty: 'master',
        qp: 1,
        requires: ['Prince Ali Rescue', 'Icthlarin\'s Little Helper'],
        series: 'Desert'
    },
    {
        name: 'Creature of Fenkenstrain',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['The Restless Ghost', 'Priest in Peril'],
        skills: { Crafting: 20, Thieving: 25 },
        series: 'Morytania'
    },
    {
        name: 'The Curse of Arrav',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Defender of Varrock', 'Making Friends with My Arm'],
        skills: { Agility: 64, Mining: 64, Ranged: 62, Slayer: 62, Strength: 64, Thieving: 64 },
        series: 'Arrav'
    },
    {
        name: 'Darkness of Hallowvale',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['In Aid of the Myreque'],
        skills: { Construction: 5, Mining: 20, Thieving: 22, Agility: 26, Crafting: 32, Magic: 33, Strength: 40 },
        series: 'Myreque'
    },
    {
        name: 'Death on the Isle',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Children of the Sun'],
        skills: { Thieving: 34, Agility: 32 },
        series: 'Varlamore'
    },
    {
        name: 'Death Plateau',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: [],
        skills: { Agility: 20 },
        series: 'Troll'
    },
    {
        name: 'Death to the Dorgeshuun',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['The Lost Tribe'],
        skills: { Agility: 23, Thieving: 23 },
        series: 'Dorgeshuun'
    },
    {
        name: 'Defender of Varrock',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Demon Slayer', 'Romeo & Juliet', 'Shield of Arrav', 'What Lies Below', 'Dragon Slayer I'],
        skills: { Smithing: 55, Hunter: 50, Magic: 45, Crafting: 40, Agility: 40 },
        series: 'Arrav'
    },
    {
        name: 'The Depths of Despair',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: ['Client of Kourend'],
        skills: { Agility: 18 },
        series: 'Great Kourend'
    },
    {
        name: 'Desert Treasure I',
        members: true,
        difficulty: 'master',
        qp: 3,
        requires: ['The Dig Site', 'Temple of Ikov', 'The Tourist Trap', 'Troll Stronghold', 'Priest in Peril', 'Waterfall Quest'],
        skills: { Slayer: 10, Firemaking: 50, Magic: 50, Thieving: 53 },
        series: 'Mahjarrat'
    },
    {
        name: 'Desert Treasure II - The Fallen Empire',
        members: true,
        difficulty: 'grandmaster',
        qp: 5,
        requires: ['Desert Treasure I', 'Secrets of the North', 'Enakhra\'s Lament', 'Temple of the Eye', 'The Garden of Death', 'Below Ice Mountain'],
        skills: { Magic: 75, Cooking: 62, Firemaking: 60, Herblore: 62, Runecraft: 60, Construction: 60, Thieving: 70, Slayer: 90 },
        series: 'Mahjarrat'
    },
    {
        name: 'Devious Minds',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Wanted!', 'Troll Stronghold', 'Doric\'s Quest', 'Enter the Abyss'],
        skills: { Smithing: 65, Runecraft: 50, Fletching: 50 }
    },
    {
        name: 'Dragon Slayer II',
        members: true,
        difficulty: 'grandmaster',
        qp: 5,
        qpNeeded: 200,
        requires: ['Legends\' Quest', 'Dream Mentor', 'A Tail of Two Cats', 'Animal Magnetism', 'Ghosts Ahoy', 'Bone Voyage', 'Client of Kourend'],
        skills: { Magic: 75, Smithing: 70, Mining: 68, Crafting: 62, Agility: 60, Thieving: 60, Construction: 50, Hunter: 50 },
        series: 'Dragonkin'
    },
    {
        name: 'Dream Mentor',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Lunar Diplomacy', 'Eadgar\'s Ruse'],
        series: 'Fremennik'
    },
    {
        name: 'Eadgar\'s Ruse',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: ['Druidic Ritual', 'Troll Stronghold'],
        skills: { Herblore: 31 },
        series: 'Troll'
    },
    {
        name: 'Elemental Workshop II',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Elemental Workshop I'],
        skills: { Magic: 20, Smithing: 30 },
        series: 'Elemental Workshop'
    },
    {
        name: 'The Eyes of Glouphrie',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['The Grand Tree'],
        skills: { Construction: 5, Magic: 46, Woodcutting: 45 },
        series: 'Gnome'
    },
    {
        name: 'Fairytale I - Growing Pains',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Lost City', 'Nature Spirit'],
        series: 'Fairy Tale'
    },
    {
        name: 'Fairytale II - Cure a Queen',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Fairytale I - Growing Pains'],
        skills: { Thieving: 40, Farming: 49, Herblore: 57 },
        series: 'Fairy Tale'
    },
    {
        name: 'The Final Dawn',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['The Heart of Darkness'],
        skills: { Agility: 70, Mining: 60, Thieving: 60 },
        series: 'Varlamore'
    },
    {
        name: 'Forgettable Tale of a Drunken Dwarf',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['The Giant Dwarf', 'Fishing Contest'],
        skills: { Cooking: 22, Farming: 17 },
        series: 'Dwarf'
    },
    {
        name: 'The Forsaken Tower',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Client of Kourend'],
        series: 'Great Kourend'
    },
    {
        name: 'The Fremennik Exiles',
        members: true,
        difficulty: 'grandmaster',
        qp: 2,
        requires: ['The Fremennik Isles', 'Lunar Diplomacy', 'Mountain Daughter', 'Heroes\' Quest'],
        skills: { Slayer: 65, Crafting: 65, Smithing: 60, Fishing: 60, Runecraft: 55 },
        series: 'Fremennik'
    },
    {
        name: 'The Fremennik Isles',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: ['The Fremennik Trials'],
        skills: { Construction: 20, Agility: 40, Crafting: 46, Woodcutting: 56 },
        series: 'Fremennik'
    },
    {
        name: 'Garden of Tranquillity',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['Creature of Fenkenstrain'],
        skills: { Farming: 25 }
    },
    {
        name: 'Ghosts Ahoy',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['The Restless Ghost', 'Priest in Peril'],
        skills: { Agility: 25, Cooking: 20 },
        series: 'Morytania'
    },
    {
        name: 'The Great Brain Robbery',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Creature of Fenkenstrain', 'Cabin Fever'],
        skills: { Construction: 30, Crafting: 16, Prayer: 50 },
        series: 'Pirate'
    },
    {
        name: 'Grim Tales',
        members: true,
        difficulty: 'master',
        qp: 1,
        requires: ['Witch\'s House'],
        skills: { Farming: 45, Herblore: 52, Thieving: 58, Agility: 59, Woodcutting: 71 }
    },
    {
        name: 'Haunted Mine',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Priest in Peril'],
        skills: { Agility: 15, Crafting: 35 },
        series: 'Morytania'
    },
    {
        name: 'The Heart of Darkness',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Twilight\'s Promise', 'Perilous Moons'],
        skills: { Slayer: 55, Mining: 55, Thieving: 52, Magic: 50 },
        series: 'Varlamore'
    },
    {
        name: 'Heroes\' Quest',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        qpNeeded: 55,
        requires: ['Shield of Arrav', 'Lost City', 'Merlin\'s Crystal', 'Dragon Slayer I'],
        skills: { Cooking: 53, Fishing: 53, Herblore: 25, Mining: 50 }
    },
    {
        name: 'Holy Grail',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['Merlin\'s Crystal'],
        skills: { Attack: 20 },
        series: 'Camelot'
    },
    {
        name: 'Horror from the Deep',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['Alfred Grimhand\'s Barcrawl'],
        skills: { Agility: 35 }
    },
    {
        name: 'Icthlarin\'s Little Helper',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['Gertrude\'s Cat'],
        series: 'Desert'
    },
    {
        name: 'In Aid of the Myreque',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['In Search of the Myreque'],
        skills: { Crafting: 25, Mining: 15, Magic: 7 },
        series: 'Myreque'
    },
    {
        name: 'In Search of the Myreque',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['Nature Spirit'],
        skills: { Agility: 25 },
        series: 'Myreque'
    },
    {
        name: 'Jungle Potion',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Druidic Ritual'],
        skills: { Herblore: 3 },
        series: 'Karamja'
    },
    {
        name: 'A Kingdom Divided',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['The Ascent of Arceuus', 'The Forsaken Tower', 'The Depths of Despair', 'The Queen of Thieves', 'Tale of the Righteous'],
        skills: { Agility: 54, Herblore: 52, Mining: 42, Woodcutting: 38, Crafting: 38, Magic: 35 },
        series: 'Great Kourend'
    },
    {
        name: 'King\'s Ransom',
        members: true,
        difficulty: 'master',
        qp: 1,
        requires: ['Black Knights\' Fortress', 'Holy Grail', 'Murder Mystery', 'One Small Favour'],
        skills: { Defence: 65, Magic: 45 },
        series: 'Camelot'
    },
    {
        name: 'Land of the Goblins',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Another Slice of H.A.M.', 'Fishing Contest'],
        skills: { Agility: 38, Fishing: 40, Herblore: 48, Prayer: 30, Thieving: 37 },
        series: 'Dorgeshuun'
    },
    {
        name: 'Legends\' Quest',
        members: true,
        difficulty: 'master',
        qp: 4,
        qpNeeded: 107,
        requires: ['Family Crest', 'Heroes\' Quest', 'Shilo Village', 'Underground Pass', 'Waterfall Quest'],
        skills: { Agility: 50, Crafting: 50, Herblore: 45, Magic: 56, Mining: 52, Prayer: 42, Smithing: 50, Strength: 50, Thieving: 50, Woodcutting: 50 }
    },
    {
        name: 'The Lost Tribe',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Goblin Diplomacy', 'Rune Mysteries'],
        skills: { Agility: 13, Thieving: 13, Mining: 17 },
        series: 'Dorgeshuun'
    },
    {
        name: 'Lunar Diplomacy',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['The Fremennik Trials', 'Lost City', 'Rune Mysteries', 'Shilo Village'],
        skills: { Crafting: 61, Defence: 40, Firemaking: 49, Herblore: 5, Magic: 65, Mining: 60, Woodcutting: 55 },
        series: 'Fremennik'
    },
    {
        name: 'Making Friends with My Arm',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['My Arm\'s Big Adventure', 'Swan Song', 'Cold War', 'Romeo & Juliet'],
        skills: { Firemaking: 66, Mining: 72, Construction: 35, Agility: 68 },
        series: 'Troll'
    },
    {
        name: 'Making History',
        members: true,
        difficulty: 'intermediate',
        qp: 3,
        requires: ['Priest in Peril', 'The Restless Ghost']
    },
    {
        name: 'Monkey Madness I',
        members: true,
        difficulty: 'master',
        qp: 3,
        requires: ['The Grand Tree', 'Tree Gnome Village'],
        series: 'Gnome'
    },
    {
        name: 'Monkey Madness II',
        members: true,
        difficulty: 'grandmaster',
        qp: 4,
        requires: ['Monkey Madness I', 'Enlightened Journey', 'The Eyes of Glouphrie', 'Recipe for Disaster', 'Troll Stronghold', 'Watchtower'],
        skills: { Slayer: 69, Crafting: 70, Hunter: 60, Agility: 55, Thieving: 55, Firemaking: 60 },
        series: 'Gnome'
    },
    {
        name: 'Mourning\'s End Part I',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Roving Elves', 'Big Chompy Bird Hunting', 'Sheep Herder'],
        skills: { Ranged: 60, Thieving: 50 },
        series: 'Elf'
    },
    {
        name: 'Mourning\'s End Part II',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Mourning\'s End Part I'],
        series: 'Elf'
    },
    {
        name: 'My Arm\'s Big Adventure',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: ['Eadgar\'s Ruse', 'The Feud', 'Jungle Potion'],
        skills: { Farming: 29, Woodcutting: 10 },
        series: 'Troll'
    },
    {
        name: 'Nature Spirit',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['Priest in Peril', 'The Restless Ghost'],
        skills: { Crafting: 18 },
        series: 'Morytania'
    },
    {
        name: 'A Night at the Theatre',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['A Taste of Hope'],
        series: 'Myreque'
    },
    {
        name: 'Olaf\'s Quest',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['The Fremennik Trials'],
        skills: { Firemaking: 40, Woodcutting: 50 },
        series: 'Fremennik'
    },
    {
        name: 'One Small Favour',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Rune Mysteries', 'Shilo Village', 'Druidic Ritual'],
        skills: { Agility: 36, Crafting: 25, Herblore: 18, Smithing: 30 }
    },
    {
        name: 'The Path of Glouphrie',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['The Eyes of Glouphrie', 'Waterfall Quest', 'Tree Gnome Village'],
        skills: { Strength: 60, Slayer: 56, Thieving: 56, Ranged: 47, Agility: 45 },
        series: 'Gnome'
    },
    {
        name: 'Perilous Moons',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Twilight\'s Promise'],
        skills: { Slayer: 48, Construction: 20, Hunter: 20, Fishing: 10, Runecraft: 20 },
        series: 'Varlamore'
    },
    {
        name: 'The Queen of Thieves',
        members: true,
        difficulty: 'novice',
        qp: 1,
        requires: ['Client of Kourend'],
        skills: { Thieving: 20 },
        series: 'Great Kourend'
    },
    {
        name: 'Rag and Bone Man II',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: ['Rag and Bone Man I'],
        skills: { Slayer: 40, Prayer: 40 }
    },
    {
        name: 'Ratcatchers',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Icthlarin\'s Little Helper'],
        series: 'Cat'
    },
    {
        name: 'Recipe for Disaster',
        members: true,
        difficulty: 'grandmaster',
        qp: 10,
        qpNeeded: 175,
        requires: [
            'Cook\'s Assistant', 'Fishing Contest', 'Goblin Diplomacy', 'Gertrude\'s Cat',
            'Shadow of the Storm', 'Big Chompy Bird Hunting', 'Legends\' Quest',
            'Monkey Madness I', 'Desert Treasure I', 'Horror from the Deep',
            'Nature Spirit', 'Demon Slayer', 'Murder Mystery', 'Biohazard',
            'Priest in Peril', 'The Restless Ghost', 'Family Crest', 'Heroes\' Quest',
            'Underground Pass', 'Waterfall Quest', 'Shilo Village', 'Lost City',
            'Merlin\'s Crystal', 'Dragon Slayer I'
        ],
        skills: { Cooking: 70, Agility: 48, Crafting: 40, Fishing: 53, Firemaking: 50, Magic: 59, Mining: 50, Ranged: 40, Slayer: 25, Thieving: 53, Herblore: 25 }
    },
    {
        name: 'Recruitment Drive',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        qpNeeded: 12,
        requires: ['Black Knights\' Fortress', 'Druidic Ritual'],
        series: 'Temple Knight'
    },
    {
        name: 'Regicide',
        members: true,
        difficulty: 'master',
        qp: 3,
        requires: ['Underground Pass'],
        skills: { Agility: 56, Crafting: 10 },
        series: 'Elf'
    },
    {
        name: 'Roving Elves',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: ['Regicide', 'Waterfall Quest'],
        series: 'Elf'
    },
    {
        name: 'Royal Trouble',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: ['Throne of Miscellania'],
        skills: { Agility: 40, Slayer: 40 },
        series: 'Fremennik'
    },
    {
        name: 'Rum Deal',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Zogre Flesh Eaters', 'Priest in Peril'],
        skills: { Crafting: 42, Fishing: 50, Farming: 40, Prayer: 47, Slayer: 42 },
        series: 'Pirate'
    },
    {
        name: 'Scorpion Catcher',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Alfred Grimhand\'s Barcrawl'],
        skills: { Prayer: 31 }
    },
    {
        name: 'Secrets of the North',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['Making Friends with My Arm', 'The General\'s Shadow', 'Hazeel Cult', 'Death Plateau'],
        skills: { Agility: 69, Thieving: 64, Hunter: 56 },
        series: 'Mahjarrat'
    },
    {
        name: 'Shades of Mort\'ton',
        members: true,
        difficulty: 'intermediate',
        qp: 3,
        requires: ['Priest in Peril'],
        skills: { Crafting: 20, Herblore: 15, Firemaking: 5 },
        series: 'Morytania'
    },
    {
        name: 'Shadow of the Storm',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['The Golem', 'Demon Slayer'],
        skills: { Crafting: 30 },
        series: 'Desert'
    },
    {
        name: 'Shilo Village',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Jungle Potion'],
        skills: { Agility: 32, Crafting: 20 },
        series: 'Karamja'
    },
    {
        name: 'Sins of the Father',
        members: true,
        difficulty: 'master',
        qp: 2,
        requires: ['A Taste of Hope', 'Vampyre Slayer'],
        skills: { Woodcutting: 62, Fletching: 60, Crafting: 56, Agility: 52, Attack: 50, Slayer: 50, Magic: 49 },
        series: 'Myreque'
    },
    {
        name: 'The Slug Menace',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: ['Wanted!', 'Sea Slug'],
        skills: { Crafting: 30, Runecraft: 30, Slayer: 30, Thieving: 30 },
        series: 'Sea Slug'
    },
    {
        name: 'Song of the Elves',
        members: true,
        difficulty: 'grandmaster',
        qp: 4,
        requires: ['Mourning\'s End Part II', 'Making History'],
        skills: { Agility: 70, Construction: 70, Farming: 70, Herblore: 70, Hunter: 70, Mining: 70, Smithing: 70, Woodcutting: 70 },
        series: 'Elf'
    },
    {
        name: 'Swan Song',
        members: true,
        difficulty: 'master',
        qp: 2,
        qpNeeded: 100,
        requires: ['One Small Favour', 'Garden of Tranquillity'],
        skills: { Magic: 66, Cooking: 62, Fishing: 62, Smithing: 45, Firemaking: 42, Crafting: 40 }
    },
    {
        name: 'Tai Bwo Wannai Trio',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Jungle Potion'],
        skills: { Agility: 15, Cooking: 30, Fishing: 5 },
        series: 'Karamja'
    },
    {
        name: 'A Tail of Two Cats',
        members: true,
        difficulty: 'intermediate',
        qp: 2,
        requires: ['Icthlarin\'s Little Helper', 'Priest in Peril'],
        series: 'Cat'
    },
    {
        name: 'Tale of the Righteous',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Client of Kourend'],
        skills: { Strength: 16, Mining: 10 },
        series: 'Great Kourend'
    },
    {
        name: 'A Taste of Hope',
        members: true,
        difficulty: 'master',
        qp: 1,
        requires: ['Darkness of Hallowvale'],
        skills: { Crafting: 48, Agility: 45, Attack: 40, Herblore: 40, Slayer: 38 },
        series: 'Myreque'
    },
    {
        name: 'Temple of the Eye',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Enter the Abyss'],
        skills: { Runecraft: 10 }
    },
    {
        name: 'Throne of Miscellania',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        requires: ['The Fremennik Trials', 'Heroes\' Quest'],
        series: 'Fremennik'
    },
    {
        name: 'Troll Romance',
        members: true,
        difficulty: 'experienced',
        qp: 2,
        requires: ['Troll Stronghold'],
        skills: { Agility: 28 },
        series: 'Troll'
    },
    {
        name: 'Troll Stronghold',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Death Plateau'],
        skills: { Agility: 15 },
        series: 'Troll'
    },
    {
        name: 'Twilight\'s Promise',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Children of the Sun'],
        series: 'Varlamore'
    },
    {
        name: 'Underground Pass',
        members: true,
        difficulty: 'experienced',
        qp: 5,
        requires: ['Biohazard'],
        skills: { Ranged: 25 },
        series: 'Elf'
    },
    {
        name: 'Wanted!',
        members: true,
        difficulty: 'experienced',
        qp: 1,
        qpNeeded: 32,
        requires: ['Recruitment Drive', 'The Lost Tribe', 'Priest in Peril', 'Enter the Abyss'],
        series: 'Temple Knight'
    },
    {
        name: 'What Lies Below',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Rune Mysteries'],
        skills: { Runecraft: 35, Mining: 42 }
    },
    {
        name: 'While Guthix Sleeps',
        members: true,
        difficulty: 'grandmaster',
        qp: 5,
        requires: ['Defender of Varrock', 'Dream Mentor', 'Temple of Ikov', 'The Path of Glouphrie', 'King\'s Ransom', 'The Curse of Arrav'],
        skills: { Agility: 79, Herblore: 78, Thieving: 76, Hunter: 72, Magic: 75, Slayer: 72, Farming: 65, Mining: 70, Strength: 76 },
        series: 'Mahjarrat'
    },
    {
        name: 'Zogre Flesh Eaters',
        members: true,
        difficulty: 'intermediate',
        qp: 1,
        requires: ['Big Chompy Bird Hunting'],
        skills: { Ranged: 30, Smithing: 4, Herblore: 8, Fletching: 30 }
    }
];
