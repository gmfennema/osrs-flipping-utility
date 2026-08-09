import { describe, it, expect } from 'vitest';

import { QUESTS } from '../src/data/quests.js';
import {
    buildQuestGraph,
    prerequisitePlan,
    reducedEdges,
    unlockSummary,
    chainRequirements,
    questPointGates,
    chainQuestPoints,
    keystones,
    searchQuests,
    matchesMembers,
    wikiUrl,
    STAGES,
    DIFFICULTY_RANK
} from '../src/calc/questGraph.js';

const graph = buildQuestGraph();

describe('quest dataset', () => {
    it('resolves every requirement to a known quest and finds no cycles', () => {
        expect(graph.warnings).toEqual([]);
    });

    it('has unique names', () => {
        expect(new Set(QUESTS.map((q) => q.name)).size).toBe(QUESTS.length);
    });

    it('uses known difficulty ratings and sane quest points', () => {
        for (const quest of QUESTS) {
            expect(DIFFICULTY_RANK).toHaveProperty(quest.difficulty);
            expect(quest.qp).toBeGreaterThanOrEqual(0);
            // Only miniquests award nothing.
            if (quest.qp === 0) expect(quest.miniquest).toBe(true);
        }
    });

    it('never lists a quest as its own requirement', () => {
        for (const quest of QUESTS) {
            expect(quest.requires ?? []).not.toContain(quest.name);
        }
    });

    it('covers both free and members content', () => {
        expect(QUESTS.some((q) => !q.members)).toBe(true);
        expect(QUESTS.filter((q) => q.members).length).toBeGreaterThan(100);
    });

    it('never gates a free quest behind a members quest', () => {
        for (const quest of QUESTS.filter((q) => !q.members)) {
            for (const req of quest.requires ?? []) {
                expect(graph.byName.get(req).members).toBe(false);
            }
        }
    });
});

describe('closures', () => {
    it('agrees in both directions', () => {
        for (const quest of graph.quests) {
            for (const ancestor of graph.ancestors.get(quest.name)) {
                expect(graph.descendants.get(ancestor).has(quest.name)).toBe(true);
            }
        }
    });

    it('includes indirect prerequisites', () => {
        // Dragon Slayer II -> Legends' Quest -> Heroes' Quest -> Dragon Slayer I
        const ancestors = graph.ancestors.get('Dragon Slayer II');
        expect(ancestors.has('Legends\' Quest')).toBe(true);
        expect(ancestors.has('Heroes\' Quest')).toBe(true);
        expect(ancestors.has('Dragon Slayer I')).toBe(true);
    });

    it('excludes a quest from its own ancestry', () => {
        for (const quest of graph.quests) {
            expect(graph.ancestors.get(quest.name).has(quest.name)).toBe(false);
        }
    });
});

describe('prerequisitePlan', () => {
    const plan = prerequisitePlan(graph, 'Dragon Slayer II');

    it('returns null for an unknown quest', () => {
        expect(prerequisitePlan(graph, 'Not A Quest')).toBeNull();
    });

    it('puts the target alone on the final tier', () => {
        expect(plan.tiers.at(-1)).toEqual(['Dragon Slayer II']);
    });

    it('places every prerequisite strictly before the quests that need it', () => {
        const tierOf = new Map();
        plan.tiers.forEach((tier, index) => tier.forEach((name) => tierOf.set(name, index)));

        for (const name of plan.nodes) {
            for (const req of graph.requires.get(name)) {
                expect(tierOf.get(req)).toBeLessThan(tierOf.get(name));
            }
        }
    });

    it('lists every ancestor exactly once across the tiers', () => {
        const flat = plan.tiers.flat();
        expect(new Set(flat).size).toBe(flat.length);
        expect(flat.length).toBe(plan.total + 1);
    });

    it('counts only outstanding prerequisites as remaining', () => {
        const done = new Set(['Priest in Peril', 'The Restless Ghost', 'Dragon Slayer II']);
        const tracked = prerequisitePlan(graph, 'Dragon Slayer II', done);
        expect(tracked.total).toBe(plan.total);
        // The target itself is not one of its own prerequisites.
        expect(tracked.done).toBe(2);
        expect(tracked.remaining).toHaveLength(plan.total - 2);
        expect(tracked.remaining).not.toContain('Priest in Peril');
    });

    it('reports a quest with no requirements as immediately startable', () => {
        const cooks = prerequisitePlan(graph, 'Cook\'s Assistant');
        expect(cooks.total).toBe(0);
        expect(cooks.tiers).toEqual([['Cook\'s Assistant']]);
        expect(cooks.edges).toEqual([]);
    });
});

describe('reducedEdges', () => {
    it('drops an edge that a longer path already implies', () => {
        const nodes = new Set(graph.ancestors.get('Recipe for Disaster'));
        nodes.add('Recipe for Disaster');
        const edges = reducedEdges(graph, nodes);

        // Recipe for Disaster names both, but Legends' Quest requires Heroes'
        // Quest, so only the Legends' edge should survive.
        const into = edges.filter((edge) => edge.to === 'Recipe for Disaster').map((edge) => edge.from);
        expect(into).toContain('Legends\' Quest');
        expect(into).not.toContain('Heroes\' Quest');
    });

    it('keeps every edge reachable and adds none', () => {
        const nodes = new Set(graph.ancestors.get('While Guthix Sleeps'));
        nodes.add('While Guthix Sleeps');
        for (const edge of reducedEdges(graph, nodes)) {
            expect(graph.requires.get(edge.to)).toContain(edge.from);
            expect(nodes.has(edge.from)).toBe(true);
        }
    });

    it('ignores edges leaving the given node set', () => {
        const edges = reducedEdges(graph, new Set(['Troll Stronghold']));
        expect(edges).toEqual([]);
    });
});

describe('unlockSummary', () => {
    it('separates direct dependents from downstream ones', () => {
        const summary = unlockSummary(graph, 'Priest in Peril');
        expect(summary.direct).toContain('Nature Spirit');
        // Two steps down the Myreque line, so downstream rather than direct.
        expect(summary.direct).not.toContain('Darkness of Hallowvale');
        expect(summary.downstream).toContain('Darkness of Hallowvale');
        expect(summary.total).toBe(summary.direct.length + summary.downstream.length);
    });

    it('reports an empty summary for a quest nothing needs', () => {
        const summary = unlockSummary(graph, 'Song of the Elves');
        expect(summary.total).toBe(0);
        expect(summary.byStage).toEqual([]);
    });

    it('groups dependents into stages that add up to the total', () => {
        const summary = unlockSummary(graph, 'Rune Mysteries');
        const grouped = summary.byStage.reduce((sum, group) => sum + group.quests.length, 0);
        expect(grouped).toBe(summary.total);
    });
});

describe('chainRequirements', () => {
    it('reports the highest level any quest on the path asks for', () => {
        const plan = prerequisitePlan(graph, 'Dragon Slayer II');
        const rows = chainRequirements(graph, plan.nodes);
        const magic = rows.find((row) => row.skill === 'Magic');

        const highest = Math.max(...[...plan.nodes].map((name) => graph.byName.get(name).skills?.Magic ?? 0));
        expect(magic.level).toBe(highest);
        expect(graph.byName.get(magic.quest).skills.Magic).toBe(highest);
    });

    it('sorts by level, hardest first', () => {
        const plan = prerequisitePlan(graph, 'Song of the Elves');
        const levels = chainRequirements(graph, plan.nodes).map((row) => row.level);
        expect(levels).toEqual([...levels].sort((a, b) => b - a));
    });
});

describe('questPointGates', () => {
    const plan = prerequisitePlan(graph, 'Dragon Slayer II');

    it('only counts points from quests that must already be finished', () => {
        const heroes = questPointGates(graph, plan.nodes).find((gate) => gate.quest === 'Heroes\' Quest');
        const earned = [...graph.ancestors.get('Heroes\' Quest')]
            .reduce((sum, name) => sum + graph.byName.get(name).qp, 0);

        expect(heroes.needed).toBe(55);
        expect(heroes.fromChain).toBe(earned);
        expect(heroes.shortfall).toBe(55 - earned);
    });

    it('credits completed quests from outside the chain', () => {
        const outside = graph.quests
            .filter((quest) => !plan.nodes.has(quest.name))
            .map((quest) => quest.name);
        const gates = questPointGates(graph, plan.nodes, new Set(outside));

        // Every quest in the game done bar the chain itself clears every gate.
        expect(gates.every((gate) => gate.shortfall === 0)).toBe(true);
    });

    it('does not double count a completed quest that is already in the chain', () => {
        const withChainDone = questPointGates(graph, plan.nodes, new Set(plan.nodes));
        const withNothingDone = questPointGates(graph, plan.nodes);
        expect(withChainDone).toEqual(withNothingDone);
    });

    it('sorts the worst shortfall first', () => {
        const shortfalls = questPointGates(graph, plan.nodes).map((gate) => gate.shortfall);
        expect(shortfalls).toEqual([...shortfalls].sort((a, b) => b - a));
    });

    it('returns nothing when no quest on the path has a gate', () => {
        expect(questPointGates(graph, new Set(['Cook\'s Assistant']))).toEqual([]);
    });
});

describe('chainQuestPoints', () => {
    it('sums the points every quest on the path awards', () => {
        const plan = prerequisitePlan(graph, 'Heroes\' Quest');
        const expected = [...plan.nodes].reduce((sum, name) => sum + graph.byName.get(name).qp, 0);
        expect(chainQuestPoints(graph, plan.nodes)).toBe(expected);
    });

    it('ignores names it does not recognise', () => {
        expect(chainQuestPoints(graph, ['Not A Quest'])).toBe(0);
    });
});

describe('keystones', () => {
    it('ranks by how many quests are gated behind each one', () => {
        const rows = keystones(graph, { limit: 5 });
        expect(rows[0].quest.name).toBe('Priest in Peril');
        expect(rows.map((row) => row.unlocks)).toEqual([...rows.map((row) => row.unlocks)].sort((a, b) => b - a));
    });

    it('honours the members filter and the limit', () => {
        const free = keystones(graph, { limit: 4, membersFilter: 'f2p' });
        expect(free).toHaveLength(4);
        expect(free.every((row) => !row.quest.members)).toBe(true);
    });

    it('omits quests that gate nothing', () => {
        expect(keystones(graph, { limit: 200 }).every((row) => row.unlocks > 0)).toBe(true);
    });
});

describe('stages', () => {
    it('assigns every quest to a known stage', () => {
        const keys = new Set(STAGES.map((stage) => stage.key));
        for (const quest of graph.quests) expect(keys.has(graph.stage.get(quest.name))).toBe(true);
    });

    it('files a shallow novice quest as early and a deep grandmaster one as endgame', () => {
        expect(graph.stage.get('Cook\'s Assistant')).toBe('early');
        expect(graph.stage.get('Song of the Elves')).toBe('endgame');
    });

    it('never files a quest earlier than one of its own prerequisites', () => {
        const rank = (name) => STAGES.findIndex((stage) => stage.key === graph.stage.get(name));
        for (const quest of graph.quests) {
            for (const req of graph.requires.get(quest.name)) {
                expect(rank(quest.name)).toBeGreaterThanOrEqual(rank(req));
            }
        }
    });
});

describe('searchQuests', () => {
    it('ranks prefix matches above mid-word ones', () => {
        const results = searchQuests(graph, 'dragon');
        expect(results[0].name.toLowerCase().startsWith('dragon')).toBe(true);
    });

    it('is case insensitive and matches partial words', () => {
        expect(searchQuests(graph, 'MYREQUE').length).toBeGreaterThan(1);
    });

    it('returns nothing for an empty term', () => {
        expect(searchQuests(graph, '   ')).toEqual([]);
    });
});

describe('helpers', () => {
    it('filters by membership', () => {
        const free = { members: false };
        expect(matchesMembers(free, 'f2p')).toBe(true);
        expect(matchesMembers(free, 'p2p')).toBe(false);
        expect(matchesMembers(free, 'all')).toBe(true);
    });

    it('builds wiki urls with underscores and escaping', () => {
        expect(wikiUrl('Cook\'s Assistant')).toBe('https://oldschool.runescape.wiki/w/Cook\'s_Assistant');
        expect(wikiUrl('Desert Treasure II - The Fallen Empire'))
            .toBe('https://oldschool.runescape.wiki/w/Desert_Treasure_II_-_The_Fallen_Empire');
    });
});
