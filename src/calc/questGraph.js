/**
 * Quest dependency graph.
 *
 * The dataset stores one edge list — "what does this quest ask for" — and
 * everything the UI shows is derived here: the reverse edges, the transitive
 * closure in both directions, the tier each quest sits on, and the game stage
 * it belongs to.
 *
 * Two derivations are worth calling out:
 *
 *   - Tiers. A quest's tier is the longest prerequisite chain behind it, not
 *     the shortest. Using the longest path is what makes a tier readable as
 *     "everything on this row can be done in any order, and nothing on the next
 *     row can start until this row is finished".
 *
 *   - Reduced edges. Wiki pages often name a requirement that another named
 *     requirement already implies (Recipe for Disaster lists both Legends'
 *     Quest and Heroes' Quest, and Legends' Quest needs Heroes' Quest anyway).
 *     Drawing those edges turns the tree into a hairball, so the transitive
 *     reduction drops any edge that is already implied by a longer path. The
 *     dependency itself is unchanged — only the line is redundant.
 */

import { QUESTS } from '../data/quests.js';

export const DIFFICULTY_RANK = {
    novice: 0,
    intermediate: 1,
    experienced: 2,
    master: 3,
    grandmaster: 4
};

export const DIFFICULTY_LABEL = {
    novice: 'Novice',
    intermediate: 'Intermediate',
    experienced: 'Experienced',
    master: 'Master',
    grandmaster: 'Grandmaster'
};

/**
 * Four buckets a newcomer can actually reason about. The boundaries are a blend
 * of the wiki's own difficulty rating and how deep the quest sits in the graph,
 * because neither alone is honest: a Novice quest buried under eight others is
 * not an early quest, and a shallow Grandmaster quest is not a starter.
 */
export const STAGES = [
    { key: 'early', label: 'Early game', blurb: 'Start here. Little or nothing required first.' },
    { key: 'mid', label: 'Mid game', blurb: 'A few quests deep, moderate skill levels.' },
    { key: 'late', label: 'Late game', blurb: 'Long chains and serious skill requirements.' },
    { key: 'endgame', label: 'End game', blurb: 'The capstones almost everything else feeds into.' }
];

const STAGE_CUTOFFS = [
    { key: 'early', max: 2 },
    { key: 'mid', max: 5 },
    { key: 'late', max: 9 },
    { key: 'endgame', max: Infinity }
];

function stageForScore(score) {
    return STAGE_CUTOFFS.find((cut) => score <= cut.max).key;
}

/**
 * @param {Array} [quests]
 * @returns {object} graph
 */
export function buildQuestGraph(quests = QUESTS) {
    const byName = new Map();
    const warnings = [];

    for (const quest of quests) {
        if (byName.has(quest.name)) warnings.push(`Duplicate quest: ${quest.name}`);
        byName.set(quest.name, quest);
    }

    // Drop requirements that name a quest we do not carry rather than letting a
    // typo silently create a dangling node.
    const requires = new Map();
    for (const quest of quests) {
        const kept = [];
        for (const req of quest.requires ?? []) {
            if (byName.has(req)) kept.push(req);
            else warnings.push(`${quest.name} requires unknown quest "${req}"`);
        }
        requires.set(quest.name, kept);
    }

    const unlocks = new Map(quests.map((q) => [q.name, []]));
    for (const [name, reqs] of requires) {
        for (const req of reqs) unlocks.get(req).push(name);
    }

    const { depth, cycles } = computeDepths(requires);
    warnings.push(...cycles);

    const ancestors = closure(requires, depth);
    const descendants = closure(unlocks, invertOrder(depth));

    const stage = stageMap(quests, requires, depth);

    return {
        quests: [...quests].sort((a, b) => a.name.localeCompare(b.name)),
        byName,
        requires,
        unlocks,
        depth,
        ancestors,
        descendants,
        stage,
        warnings
    };
}

/**
 * A quest's own difficulty is not always the whole story: the wiki rates
 * Devious Minds as Intermediate, but it sits behind Wanted!, which is rated
 * Experienced. Filing it as mid-game would tell a reader they could get to it
 * earlier than they actually can.
 *
 * So a quest's score is raised to that of its hardest prerequisite. Stages then
 * only ever move forward along the graph, which is the property that makes the
 * four buckets mean "when can I reach this" rather than "how hard is the fight
 * at the end".
 */
function stageMap(quests, requires, depth) {
    const score = new Map();
    // Prerequisites always sit at a lower depth, so one pass in depth order is
    // enough for each quest to see its own already-raised requirements.
    const byDepth = [...quests].sort((a, b) => depth.get(a.name) - depth.get(b.name));

    for (const quest of byDepth) {
        const rank = DIFFICULTY_RANK[quest.difficulty] ?? 1;
        let value = rank * 2 + Math.min(depth.get(quest.name), 8);
        for (const req of requires.get(quest.name)) value = Math.max(value, score.get(req) ?? 0);
        score.set(quest.name, value);
    }

    return new Map([...score].map(([name, value]) => [name, stageForScore(value)]));
}

/** Longest path to each node. Nodes inside a cycle are reported and pinned to 0. */
function computeDepths(requires) {
    const depth = new Map();
    const state = new Map(); // 0 = visiting, 1 = done
    const cycles = [];

    function visit(name) {
        const seen = state.get(name);
        if (seen === 1) return depth.get(name);
        if (seen === 0) {
            cycles.push(`Cyclic requirement involving ${name}`);
            return 0;
        }
        state.set(name, 0);
        let best = 0;
        for (const req of requires.get(name) ?? []) best = Math.max(best, visit(req) + 1);
        depth.set(name, best);
        state.set(name, 1);
        return best;
    }

    for (const name of requires.keys()) visit(name);
    return { depth, cycles };
}

/** Rank map that walks the reverse direction, so descendants resolve bottom-up. */
function invertOrder(depth) {
    const inverted = new Map();
    for (const [name, value] of depth) inverted.set(name, -value);
    return inverted;
}

/**
 * Transitive closure of an adjacency map, resolved in dependency order so each
 * node can reuse the sets its neighbours already built.
 */
function closure(adjacency, order) {
    const names = [...adjacency.keys()].sort((a, b) => order.get(a) - order.get(b));
    const result = new Map();

    for (const name of names) {
        const set = new Set();
        for (const next of adjacency.get(name) ?? []) {
            set.add(next);
            for (const inherited of result.get(next) ?? []) set.add(inherited);
        }
        result.set(name, set);
    }

    return result;
}

/**
 * Edges of the sub-graph induced by `nodes`, with edges that a longer path
 * already implies removed.
 *
 * @returns {Array<{from: string, to: string}>}
 */
export function reducedEdges(graph, nodes) {
    const set = nodes instanceof Set ? nodes : new Set(nodes);
    const edges = [];

    for (const to of set) {
        const direct = (graph.requires.get(to) ?? []).filter((from) => set.has(from));
        for (const from of direct) {
            const implied = direct.some(
                (other) => other !== from && graph.ancestors.get(other)?.has(from)
            );
            if (!implied) edges.push({ from, to });
        }
    }

    return edges;
}

/**
 * Everything standing between the player and `name`, laid out as ordered tiers.
 *
 * Tier 0 can be started immediately; nothing in tier n can start before tier
 * n-1 is finished. The target quest is always alone on the final tier.
 *
 * @param {object} graph
 * @param {string} name
 * @param {Set<string>} [completed]
 */
export function prerequisitePlan(graph, name, completed = new Set()) {
    const quest = graph.byName.get(name);
    if (!quest) return null;

    const nodes = new Set(graph.ancestors.get(name));
    nodes.add(name);

    const maxDepth = graph.depth.get(name);
    const tiers = Array.from({ length: maxDepth + 1 }, () => []);
    for (const node of nodes) tiers[graph.depth.get(node)].push(node);
    for (const tier of tiers) tier.sort(byDisplayOrder(graph));

    const prereqs = [...nodes].filter((node) => node !== name);
    const remaining = prereqs.filter((node) => !completed.has(node));

    return {
        target: quest,
        nodes,
        tiers,
        edges: reducedEdges(graph, nodes),
        total: prereqs.length,
        remaining,
        done: prereqs.length - remaining.length,
        members: prereqs.filter((node) => graph.byName.get(node).members).length
    };
}

function byDisplayOrder(graph) {
    return (a, b) => {
        const aq = graph.byName.get(a);
        const bq = graph.byName.get(b);
        // Free quests first inside a tier: they are the ones every reader can do.
        if (aq.members !== bq.members) return aq.members ? 1 : -1;
        return a.localeCompare(b);
    };
}

/**
 * What opens up behind a quest — the other half of the question.
 *
 * `direct` names the quests that list it themselves; `downstream` is everything
 * further along that still cannot be reached without it.
 */
export function unlockSummary(graph, name) {
    const all = graph.descendants.get(name) ?? new Set();
    const direct = (graph.unlocks.get(name) ?? []).slice().sort(byDisplayOrder(graph));
    const directSet = new Set(direct);
    const downstream = [...all].filter((q) => !directSet.has(q)).sort(byDisplayOrder(graph));

    return {
        direct,
        downstream,
        total: all.size,
        byStage: STAGES.map((stage) => ({
            ...stage,
            quests: [...all].filter((q) => graph.stage.get(q) === stage.key).sort(byDisplayOrder(graph))
        })).filter((group) => group.quests.length > 0)
    };
}

/**
 * The skill wall for a whole chain: the highest level each skill is asked for
 * anywhere in it, and which quest asks for it.
 */
export function chainRequirements(graph, nodes) {
    const skills = new Map();

    for (const name of nodes) {
        const quest = graph.byName.get(name);
        for (const [skill, level] of Object.entries(quest.skills ?? {})) {
            const current = skills.get(skill);
            if (!current || level > current.level) skills.set(skill, { skill, level, quest: name });
        }
    }

    return [...skills.values()].sort((a, b) => b.level - a.level || a.skill.localeCompare(b.skill));
}

/**
 * Quest-point gates are the one requirement a prerequisite chain cannot satisfy
 * on its own — they are met by having done enough quests overall, so a chain
 * that clears every other requirement can still stall on one.
 *
 * For each gate in the chain this reports the points the chain itself supplies
 * by the time that gate is reached, so a shortfall shows up as "you will need
 * side quests worth N more points" rather than as a surprise in game.
 *
 * @param {Set<string>|Array<string>} nodes  the chain, target included
 * @param {Set<string>} [completed]          quests already done outside it
 */
export function questPointGates(graph, nodes, completed = new Set()) {
    const chain = nodes instanceof Set ? nodes : new Set(nodes);
    const outsidePoints = [...completed]
        .filter((name) => !chain.has(name) && graph.byName.has(name))
        .reduce((sum, name) => sum + (graph.byName.get(name).qp ?? 0), 0);

    const gates = [];
    for (const name of chain) {
        const quest = graph.byName.get(name);
        if (!quest.qpNeeded) continue;

        // Only what must already be finished when this gate is reached counts.
        const earned = [...graph.ancestors.get(name)]
            .filter((prior) => chain.has(prior))
            .reduce((sum, prior) => sum + (graph.byName.get(prior).qp ?? 0), 0);

        const available = earned + outsidePoints;
        gates.push({
            quest: name,
            needed: quest.qpNeeded,
            fromChain: earned,
            available,
            shortfall: Math.max(0, quest.qpNeeded - available)
        });
    }

    return gates.sort((a, b) => b.shortfall - a.shortfall || b.needed - a.needed);
}

/** Quest points the chain hands back, which is what pays for those gates. */
export function chainQuestPoints(graph, nodes) {
    let total = 0;
    for (const name of nodes) total += graph.byName.get(name)?.qp ?? 0;
    return total;
}

/**
 * The quests the most other quests depend on. This is the answer to "pick an
 * early quest and see how much it opens up", and it is the best possible
 * starting list for someone with no idea where to begin.
 */
export function keystones(graph, { limit = 12, membersFilter = 'all' } = {}) {
    return graph.quests
        .filter((quest) => matchesMembers(quest, membersFilter))
        .map((quest) => ({
            quest,
            unlocks: graph.descendants.get(quest.name).size,
            direct: graph.unlocks.get(quest.name).length
        }))
        .filter((row) => row.unlocks > 0)
        .sort((a, b) => b.unlocks - a.unlocks || a.quest.name.localeCompare(b.quest.name))
        .slice(0, limit);
}

export function matchesMembers(quest, filter) {
    if (filter === 'f2p') return !quest.members;
    if (filter === 'p2p') return quest.members;
    return true;
}

/**
 * Substring search over quest names. Prefix matches rank above the rest so
 * typing "dragon" puts Dragon Slayer at the top rather than under a quest that
 * merely contains the word.
 */
export function searchQuests(graph, term) {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];

    return graph.quests
        .map((quest) => {
            const haystack = quest.name.toLowerCase();
            const index = haystack.indexOf(needle);
            return index === -1 ? null : { quest, index };
        })
        .filter(Boolean)
        .sort((a, b) => a.index - b.index || a.quest.name.localeCompare(b.quest.name))
        .map((row) => row.quest);
}

/** Wiki page for a quest, used for the "read the guide" link on every card. */
export function wikiUrl(name) {
    return `https://oldschool.runescape.wiki/w/${encodeURIComponent(name.replace(/ /g, '_'))}`;
}
