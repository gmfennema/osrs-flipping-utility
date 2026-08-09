/**
 * The Quest Tree tab.
 *
 * The question this answers is not "what are the requirements for quest X" —
 * the wiki already prints that, one page at a time. It is "what does the whole
 * shape look like", which needs two directions at once: everything standing in
 * front of a quest, and everything waiting behind it.
 *
 * So the tab has exactly two modes. Browsing shows the landscape — the four
 * game stages, and the keystone quests that gate the most other quests, which
 * is the only sensible entry point for a reader who does not yet know a single
 * quest name. Selecting a quest shows its own sub-graph, laid out as tiers you
 * can read top to bottom as a plan.
 *
 * Layout is phone-first throughout: one column, one focus, tap targets over
 * hover targets, and the browser is replaced by the detail view rather than
 * pushed below it, so there is never a long scroll back to where you were.
 */

import {
    state,
    setQuestSelection,
    setQuestPanel,
    setQuestFilter,
    setQuestSearch,
    toggleQuestDone,
    clearQuestsDone
} from '../state.js';
import {
    buildQuestGraph,
    prerequisitePlan,
    unlockSummary,
    chainRequirements,
    questPointGates,
    chainQuestPoints,
    keystones,
    searchQuests,
    matchesMembers,
    wikiUrl,
    STAGES,
    DIFFICULTY_LABEL
} from '../calc/questGraph.js';
import { DATA_AS_OF } from '../data/quests.js';

const graph = buildQuestGraph();

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const TOTAL_QP = graph.quests.reduce((sum, quest) => sum + (quest.qp ?? 0), 0);

/**
 * Edges of the tree currently on screen. `pendingEdges` is what the last render
 * pass produced; `visibleEdges` is what is actually mounted and being drawn.
 * They are kept here rather than in the DOM so a redraw costs no parsing.
 */
let pendingEdges = [];
let visibleEdges = [];
let treeObserver = null;

/**
 * Where "back" goes after drilling from one quest into another. Only one step
 * is kept: the reader wants the quest they came from, not a full history.
 */
let cameFrom = null;

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function initQuestTree() {
    const view = document.getElementById('quests-view');
    if (!view) return;

    const search = document.getElementById('quest-search');
    search?.addEventListener('input', (event) => {
        setQuestSearch(event.target.value);
        renderQuestTree();
    });

    view.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-action]');
        if (!trigger || !view.contains(trigger)) return;
        handleAction(trigger.dataset.action, trigger.dataset, search);
    });

    window.addEventListener('resize', scheduleEdgeRedraw);
    // The webfont lands after first paint and reflows every chip with it.
    document.fonts?.ready.then(scheduleEdgeRedraw);
}

function handleAction(action, data, search) {
    switch (action) {
        case 'select':
            cameFrom = state.questSelection && state.questSelection !== data.quest
                ? state.questSelection
                : cameFrom;
            setQuestSelection(data.quest);
            if (search?.value) {
                search.value = '';
                setQuestSearch('');
            }
            scrollViewToTop();
            break;
        case 'back':
            setQuestSelection(data.quest || null);
            cameFrom = null;
            scrollViewToTop();
            break;
        case 'toggle-done':
            toggleQuestDone(data.quest);
            break;
        case 'set-panel':
            setQuestPanel(data.value);
            break;
        case 'set-filter':
            setQuestFilter(data.key, data.value);
            break;
        case 'toggle-hide-done':
            setQuestFilter('questHideDone', !state.questHideDone);
            break;
        case 'reset-progress':
            clearQuestsDone();
            break;
        default:
            return;
    }
    renderQuestTree();
}

function scrollViewToTop() {
    document.getElementById('quests-view')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export function renderQuestTree() {
    const body = document.getElementById('quest-body');
    if (!body) return;

    const term = state.questSearch.trim();
    const selected = graph.byName.has(state.questSelection) ? state.questSelection : null;

    // A search is always a request to look at the list, whatever is selected.
    body.innerHTML = term || !selected ? browseHtml(term) : detailHtml(selected);

    visibleEdges = [];
    if (treeObserver) {
        treeObserver.disconnect();
        treeObserver = null;
    }

    const tree = body.querySelector('.qt-tree');
    if (tree) {
        visibleEdges = pendingEdges;
        scheduleEdgeRedraw();
        if (typeof ResizeObserver === 'function') {
            treeObserver = new ResizeObserver(drawTreeEdges);
            treeObserver.observe(tree);
        }
    }
}

// ----------------------------------------------------------------- browse ---

function browseHtml(term) {
    const matches = term ? searchQuests(graph, term) : filteredQuests();

    return `
        ${progressHtml()}
        ${term ? '' : filterHtml()}
        ${term ? '' : stageCardsHtml()}
        ${term ? '' : keystoneHtml()}
        <section class="qt-block">
            <div class="qt-block-head">
                <h3 class="qt-block-title">${term ? `Matching “${escapeHtml(term)}”` : 'Every quest'}</h3>
                <span class="qt-block-count">${plural(matches.length, 'quest')}</span>
            </div>
            ${matches.length
                ? `<ul class="qt-list">${matches.map(listRowHtml).join('')}</ul>`
                : '<p class="qt-empty">No quest matches that. Try part of the name — “myreque”, “dragon”, “troll”.</p>'}
        </section>
        <p class="qt-footnote">
            Quest requirements are a hand-checked snapshot from the OSRS Wiki (${escapeHtml(DATA_AS_OF)}).
            Every card links to the live wiki page for the walkthrough itself.
        </p>
    `;
}

function filteredQuests() {
    return graph.quests
        .filter((quest) => matchesMembers(quest, state.questMembers))
        .filter((quest) => state.questStage === 'all' || graph.stage.get(quest.name) === state.questStage)
        .sort((a, b) => {
            const stageDelta = STAGES.findIndex((s) => s.key === graph.stage.get(a.name))
                - STAGES.findIndex((s) => s.key === graph.stage.get(b.name));
            if (stageDelta !== 0) return stageDelta;
            const unlockDelta = graph.descendants.get(b.name).size - graph.descendants.get(a.name).size;
            if (unlockDelta !== 0) return unlockDelta;
            return a.name.localeCompare(b.name);
        });
}

function progressHtml() {
    const done = [...state.questsDone].filter((name) => graph.byName.has(name));
    const points = done.reduce((sum, name) => sum + (graph.byName.get(name).qp ?? 0), 0);
    const pct = Math.round((done.length / graph.quests.length) * 100);

    return `
        <section class="qt-progress">
            <div class="qt-progress-head">
                <span class="qt-progress-label">Your progress</span>
                ${done.length ? '<button class="qt-link" data-action="reset-progress">Reset</button>' : ''}
            </div>
            <div class="qt-progress-bar"><span style="width:${pct}%"></span></div>
            <p class="qt-progress-note">
                ${done.length
                    ? `${done.length} of ${graph.quests.length} quests ticked off · ${points} of ${TOTAL_QP} quest points`
                    : 'Tick quests off as you finish them and every chain below shows only what you have left.'}
            </p>
        </section>
    `;
}

function filterHtml() {
    const memberOptions = [
        { value: 'all', label: 'All quests' },
        { value: 'f2p', label: 'Free' },
        { value: 'p2p', label: 'Members' }
    ];
    const stageOptions = [{ value: 'all', label: 'Any stage' }, ...STAGES.map((s) => ({ value: s.key, label: s.label }))];

    return `
        <div class="qt-filters">
            <div class="qt-chip-row">
                ${memberOptions.map((option) => chipHtml(option, 'questMembers', state.questMembers)).join('')}
            </div>
            <div class="qt-chip-row">
                ${stageOptions.map((option) => chipHtml(option, 'questStage', state.questStage)).join('')}
            </div>
        </div>
    `;
}

function chipHtml(option, key, current) {
    return `<button class="qt-chip${option.value === current ? ' active' : ''}"
        data-action="set-filter" data-key="${key}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`;
}

function stageCardsHtml() {
    const cards = STAGES.map((stage) => {
        const count = graph.quests.filter((quest) => graph.stage.get(quest.name) === stage.key
            && matchesMembers(quest, state.questMembers)).length;
        const active = state.questStage === stage.key;
        return `
            <button class="qt-stage-card${active ? ' active' : ''}" data-stage="${stage.key}"
                data-action="set-filter" data-key="questStage" data-value="${active ? 'all' : stage.key}">
                <span class="qt-stage-count">${count}</span>
                <span class="qt-stage-name">${escapeHtml(stage.label)}</span>
                <span class="qt-stage-blurb">${escapeHtml(stage.blurb)}</span>
            </button>
        `;
    }).join('');

    return `
        <section class="qt-block">
            <div class="qt-block-head">
                <h3 class="qt-block-title">Where quests sit in the game</h3>
            </div>
            <p class="qt-block-note">
                A quest's stage blends its wiki difficulty with how deep it sits in the chain, so a Novice
                quest buried under eight others is not filed as a starter. Tap one to filter the list.
            </p>
            <div class="qt-stage-cards">${cards}</div>
        </section>
    `;
}

function keystoneHtml() {
    const rows = keystones(graph, { limit: 10, membersFilter: state.questMembers });
    if (!rows.length) return '';
    const most = rows[0].unlocks;

    return `
        <section class="qt-block">
            <div class="qt-block-head">
                <h3 class="qt-block-title">Keystone quests</h3>
            </div>
            <p class="qt-block-note">
                The quests the most other quests are waiting on. Doing these early is what stops a later
                quest from turning into a week of unrelated errands.
            </p>
            <ul class="qt-keystones">
                ${rows.map((row) => `
                    <li>
                        <button class="qt-keystone" data-action="select" data-quest="${escapeHtml(row.quest.name)}">
                            <span class="qt-keystone-top">
                                <span class="qt-keystone-name">${escapeHtml(row.quest.name)}</span>
                                <span class="qt-keystone-count">${row.unlocks}</span>
                            </span>
                            <span class="qt-keystone-bar"><span style="width:${Math.round((row.unlocks / most) * 100)}%"></span></span>
                            <span class="qt-keystone-note">
                                gates ${plural(row.unlocks, 'quest')} · ${row.direct} directly · ${escapeHtml(memberLabel(row.quest))}
                            </span>
                        </button>
                    </li>
                `).join('')}
            </ul>
        </section>
    `;
}

function listRowHtml(quest) {
    const name = quest.name;
    const before = graph.ancestors.get(name).size;
    const after = graph.descendants.get(name).size;
    const done = state.questsDone.has(name);

    return `
        <li class="qt-row" data-done="${done}">
            <button class="qt-row-check" data-action="toggle-done" data-quest="${escapeHtml(name)}"
                aria-pressed="${done}" aria-label="Mark ${escapeHtml(name)} complete">${done ? '✓' : ''}</button>
            <button class="qt-row-open" data-action="select" data-quest="${escapeHtml(name)}">
                <span class="qt-row-name">${escapeHtml(name)}${quest.miniquest ? ' <span class="qt-mini">miniquest</span>' : ''}</span>
                <span class="qt-row-meta">
                    <span class="qt-pill" data-stage="${graph.stage.get(name)}">${escapeHtml(STAGE_LABEL[graph.stage.get(name)])}</span>
                    <span class="qt-pill" data-members="${quest.members}">${escapeHtml(memberLabel(quest))}</span>
                    <span class="qt-pill">${escapeHtml(DIFFICULTY_LABEL[quest.difficulty])}</span>
                </span>
                <span class="qt-row-counts">
                    <span title="Quests you must finish first">${before} before</span>
                    <span title="Quests that cannot be done without this one">${after} after</span>
                </span>
            </button>
        </li>
    `;
}

const memberLabel = (quest) => (quest.members ? 'Members' : 'Free');

// ----------------------------------------------------------------- detail ---

function detailHtml(name) {
    const quest = graph.byName.get(name);
    const plan = prerequisitePlan(graph, name, state.questsDone);
    const unlocks = unlockSummary(graph, name);
    const done = state.questsDone.has(name);
    const panel = ['path', 'unlocks', 'requirements'].includes(state.questPanel) ? state.questPanel : 'path';

    pendingEdges = [];
    const panels = {
        path: () => pathPanelHtml(plan),
        unlocks: () => unlocksPanelHtml(quest, unlocks),
        requirements: () => requirementsPanelHtml(plan)
    };
    const panelBody = panels[panel]();

    return `
        <div class="qt-detail">
            <div class="qt-detail-nav">
                <button class="qt-back" data-action="back">← All quests</button>
                ${cameFrom && cameFrom !== name
                    ? `<button class="qt-back" data-action="select" data-quest="${escapeHtml(cameFrom)}">↩ ${escapeHtml(cameFrom)}</button>`
                    : ''}
            </div>

            <header class="qt-hero" data-stage="${graph.stage.get(name)}">
                <p class="qt-hero-kicker">
                    ${escapeHtml(STAGE_LABEL[graph.stage.get(name)])}${quest.series ? ` · ${escapeHtml(quest.series)} series` : ''}
                </p>
                <h3 class="qt-hero-name">${escapeHtml(name)}</h3>
                <div class="qt-badges">
                    <span class="qt-pill" data-members="${quest.members}">${escapeHtml(memberLabel(quest))}</span>
                    <span class="qt-pill">${escapeHtml(DIFFICULTY_LABEL[quest.difficulty])}</span>
                    <span class="qt-pill">${quest.miniquest ? 'Miniquest · no QP' : `${quest.qp} quest ${quest.qp === 1 ? 'point' : 'points'}`}</span>
                    ${quest.qpNeeded ? `<span class="qt-pill" data-warn="true">${quest.qpNeeded} QP to start</span>` : ''}
                </div>
                <p class="qt-hero-line">${heroLine(plan, unlocks)}</p>
                <div class="qt-hero-actions">
                    <button class="qt-action${done ? ' is-done' : ''}" data-action="toggle-done" data-quest="${escapeHtml(name)}">
                        ${done ? '✓ Completed' : 'Mark complete'}
                    </button>
                    <a class="qt-action qt-action-link" href="${wikiUrl(name)}" target="_blank" rel="noreferrer">Wiki guide ↗</a>
                </div>
            </header>

            <div class="qt-stats">
                <div class="qt-stat">
                    <span class="qt-stat-value">${plan.total}</span>
                    <span class="qt-stat-label">quests before it</span>
                </div>
                <div class="qt-stat">
                    <span class="qt-stat-value">${unlocks.total}</span>
                    <span class="qt-stat-label">quests need it</span>
                </div>
                <div class="qt-stat" data-accent="${plan.remaining.length > 0}">
                    <span class="qt-stat-value">${plan.remaining.length}</span>
                    <span class="qt-stat-label">left for you</span>
                </div>
            </div>

            <div class="qt-chip-row qt-panel-tabs">
                ${[
                    { value: 'path', label: `Path (${plan.total})` },
                    { value: 'unlocks', label: `Unlocks (${unlocks.total})` },
                    { value: 'requirements', label: 'Requirements' }
                ].map((option) => `
                    <button class="qt-chip${option.value === panel ? ' active' : ''}"
                        data-action="set-panel" data-value="${option.value}">${escapeHtml(option.label)}</button>
                `).join('')}
            </div>

            <div class="qt-panel">${panelBody}</div>
        </div>
    `;
}

function heroLine(plan, unlocks) {
    const parts = [];

    if (plan.total === 0) {
        parts.push('Nothing has to be done first — you can start this one today.');
    } else {
        const steps = plan.tiers.filter((tier) => tier.length).length - 1;
        parts.push(`${plural(plan.total, 'quest')} stand in front of it, ${plural(steps, 'step')} deep.`);
    }

    if (unlocks.total > 0) parts.push(`Finishing it opens up ${plural(unlocks.total, 'quest')}.`);
    else parts.push('Nothing else is waiting on it — this is an end of the line.');

    return escapeHtml(parts.join(' '));
}

function pathPanelHtml(plan) {
    if (plan.total === 0) {
        return `
            <p class="qt-empty">
                <strong>${escapeHtml(plan.target.name)}</strong> has no quest requirements at all. Whatever else it asks for
                is skill levels and quest points, both on the Requirements tab.
            </p>
        `;
    }

    const hideDone = state.questHideDone;
    const tiers = plan.tiers
        .map((tier, index) => ({
            index,
            names: tier.filter((name) => !(hideDone && name !== plan.target.name && state.questsDone.has(name)))
        }))
        .filter((tier) => tier.names.length);

    const visible = new Set(tiers.flatMap((tier) => tier.names));
    pendingEdges = plan.edges
        .filter((edge) => visible.has(edge.from) && visible.has(edge.to))
        .map((edge) => [edge.from, edge.to]);

    const lastIndex = tiers[tiers.length - 1].index;

    return `
        <p class="qt-panel-note">
            Read this top to bottom. Everything on one row can be done in any order; nothing on a row can start
            until the row above it is finished.
        </p>
        ${gateBannerHtml(plan)}
        <div class="qt-panel-controls">
            <span class="qt-progress-note">${plan.done} of ${plan.total} prerequisites ticked off</span>
            <button class="qt-link" data-action="toggle-hide-done">${hideDone ? 'Show completed' : 'Hide completed'}</button>
        </div>
        <div class="qt-tree">
            <svg class="qt-tree-edges" aria-hidden="true" focusable="false"></svg>
            ${tiers.map((tier) => `
                <div class="qt-tier">
                    <div class="qt-tier-head">
                        <span>${tier.index === lastIndex ? 'Your goal' : `Step ${tier.index + 1}`}</span>
                        <span class="qt-tier-count">${tier.index === lastIndex && tier.names.length === 1
                            ? '' : `${plural(tier.names.length, 'quest')} · any order`}</span>
                    </div>
                    <div class="qt-tier-nodes">
                        ${tier.names.map((name) => nodeHtml(name, name === plan.target.name)).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function nodeHtml(name, isTarget) {
    const quest = graph.byName.get(name);
    const done = state.questsDone.has(name);

    return `
        <div class="qt-node" data-quest="${escapeHtml(name)}" data-done="${done}" data-role="${isTarget ? 'target' : 'step'}">
            <button class="qt-node-check" data-action="toggle-done" data-quest="${escapeHtml(name)}"
                aria-pressed="${done}" aria-label="Mark ${escapeHtml(name)} complete">${done ? '✓' : ''}</button>
            <button class="qt-node-open" data-action="select" data-quest="${escapeHtml(name)}">
                <span class="qt-node-name">${escapeHtml(name)}</span>
                <span class="qt-node-tags">${escapeHtml(memberLabel(quest))} · ${escapeHtml(DIFFICULTY_LABEL[quest.difficulty])}</span>
            </button>
        </div>
    `;
}

/**
 * Quest-point gates are the failure mode nobody sees coming: the chain can be
 * complete and the quest still refuses to start, because points come from
 * quests outside it. Worth a banner rather than a line in a table.
 */
function gateBannerHtml(plan) {
    const gates = questPointGates(graph, plan.nodes, state.questsDone).filter((gate) => gate.shortfall > 0);
    if (!gates.length) {
        const total = questPointGates(graph, plan.nodes, state.questsDone);
        if (!total.length) return '';
        return `<p class="qt-banner qt-banner-good">Every quest-point gate on this path is already covered by the chain itself.</p>`;
    }

    const worst = gates[0];
    const chainPoints = chainQuestPoints(graph, plan.nodes);

    return `
        <div class="qt-banner qt-banner-warn">
            <strong>${escapeHtml(worst.quest)} needs ${worst.needed} quest points</strong>, and this path only supplies
            ${worst.available} by the time you reach it — you will need roughly ${worst.shortfall} more points from quests
            outside the chain first.
            ${gates.length > 1 ? `(${gates.length - 1} other ${gates.length === 2 ? 'gate' : 'gates'} on this path fall short too.)` : ''}
            The whole chain is worth ${chainPoints} points once finished.
        </div>
    `;
}

function unlocksPanelHtml(quest, unlocks) {
    if (unlocks.total === 0) {
        return `
            <p class="qt-empty">
                No other quest lists <strong>${escapeHtml(quest.name)}</strong> as a requirement. It is worth doing for its own
                rewards, not as a stepping stone.
            </p>
        `;
    }

    return `
        <p class="qt-panel-note">
            ${plural(unlocks.total, 'quest')} cannot be done without this one — ${unlocks.direct.length} name it directly,
            the rest sit further downstream.
        </p>
        <section class="qt-block">
            <div class="qt-block-head">
                <h4 class="qt-block-title">Directly blocked by it</h4>
                <span class="qt-block-count">${unlocks.direct.length}</span>
            </div>
            <div class="qt-tier-nodes">${unlocks.direct.map((name) => nodeHtml(name, false)).join('')}</div>
        </section>
        ${unlocks.byStage.map((group) => `
            <section class="qt-block">
                <div class="qt-block-head">
                    <h4 class="qt-block-title">${escapeHtml(group.label)}</h4>
                    <span class="qt-block-count">${group.quests.length}</span>
                </div>
                <p class="qt-block-note">${escapeHtml(group.blurb)}</p>
                <div class="qt-tier-nodes">${group.quests.map((name) => nodeHtml(name, false)).join('')}</div>
            </section>
        `).join('')}
    `;
}

function requirementsPanelHtml(plan) {
    const skills = chainRequirements(graph, plan.nodes);
    const gates = questPointGates(graph, plan.nodes, state.questsDone);
    const chainPoints = chainQuestPoints(graph, plan.nodes);
    const membersOnly = plan.members + (plan.target.members ? 1 : 0);

    return `
        <p class="qt-panel-note">
            Everything the whole path asks for, rolled up — not just the final quest. The level shown is the highest
            any single quest on the path demands.
        </p>
        <div class="qt-stats qt-stats-quad">
            <div class="qt-stat">
                <span class="qt-stat-value">${plan.total + 1}</span>
                <span class="qt-stat-label">quests in total</span>
            </div>
            <div class="qt-stat">
                <span class="qt-stat-value">${membersOnly}</span>
                <span class="qt-stat-label">need membership</span>
            </div>
            <div class="qt-stat">
                <span class="qt-stat-value">${chainPoints}</span>
                <span class="qt-stat-label">quest points earned</span>
            </div>
            <div class="qt-stat">
                <span class="qt-stat-value">${skills.length}</span>
                <span class="qt-stat-label">skills gated</span>
            </div>
        </div>

        ${gates.length ? `
            <section class="qt-block">
                <div class="qt-block-head"><h4 class="qt-block-title">Quest-point gates</h4></div>
                <p class="qt-block-note">
                    These are not satisfied by the path itself — points come from any quests you have finished.
                </p>
                <ul class="qt-gates">
                    ${gates.map((gate) => `
                        <li data-short="${gate.shortfall > 0}">
                            <button class="qt-gate" data-action="select" data-quest="${escapeHtml(gate.quest)}">
                                <span class="qt-gate-name">${escapeHtml(gate.quest)}</span>
                                <span class="qt-gate-need">${gate.needed} QP</span>
                                <span class="qt-gate-note">${gate.shortfall > 0
                                    ? `${gate.shortfall} short — the path supplies ${gate.available}`
                                    : `covered (${gate.available} available)`}</span>
                            </button>
                        </li>
                    `).join('')}
                </ul>
            </section>
        ` : ''}

        ${skills.length ? `
            <section class="qt-block">
                <div class="qt-block-head">
                    <h4 class="qt-block-title">Skill levels needed somewhere on the path</h4>
                    <span class="qt-block-count">${skills.length}</span>
                </div>
                <ul class="qt-skills">
                    ${skills.map((row) => `
                        <li>
                            <span class="qt-skill-level">${row.level}</span>
                            <span class="qt-skill-name">${escapeHtml(row.skill)}</span>
                            <button class="qt-skill-source" data-action="select" data-quest="${escapeHtml(row.quest)}">
                                ${escapeHtml(row.quest)}
                            </button>
                        </li>
                    `).join('')}
                </ul>
            </section>
        ` : '<p class="qt-empty">Nothing on this path has a skill requirement.</p>'}
    `;
}

// ------------------------------------------------------------------ edges ---

let redrawHandle = null;

function scheduleEdgeRedraw() {
    if (redrawHandle) cancelAnimationFrame(redrawHandle);
    redrawHandle = requestAnimationFrame(() => {
        redrawHandle = null;
        drawTreeEdges();
    });
}

/**
 * Connector lines are drawn after layout rather than positioned by CSS, because
 * the chips wrap: how many fit on a row — and therefore where a line has to
 * start and end — is only known once the browser has laid them out. Nothing
 * depends on the lines being there, so a failed measurement degrades to a plain
 * list of tiers rather than a broken view.
 */
function drawTreeEdges() {
    const tree = document.querySelector('#quest-body .qt-tree');
    const svg = tree?.querySelector('.qt-tree-edges');
    if (!tree || !svg) return;

    const bounds = tree.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const anchors = new Map();
    for (const node of tree.querySelectorAll('.qt-node')) {
        const rect = node.getBoundingClientRect();
        anchors.set(node.dataset.quest, {
            x: rect.left - bounds.left + rect.width / 2,
            top: rect.top - bounds.top,
            bottom: rect.bottom - bounds.top
        });
    }

    const paths = visibleEdges.map(([from, to]) => {
        const a = anchors.get(from);
        const b = anchors.get(to);
        if (!a || !b) return '';
        const lift = Math.max(14, (b.top - a.bottom) * 0.6);
        const d = `M${a.x.toFixed(1)},${a.bottom.toFixed(1)} `
            + `C${a.x.toFixed(1)},${(a.bottom + lift).toFixed(1)} `
            + `${b.x.toFixed(1)},${(b.top - lift).toFixed(1)} `
            + `${b.x.toFixed(1)},${b.top.toFixed(1)}`;
        return `<path d="${d}" data-from="${escapeHtml(from)}" data-to="${escapeHtml(to)}" />`;
    }).join('');

    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    svg.setAttribute('width', String(bounds.width));
    svg.setAttribute('height', String(bounds.height));
    svg.innerHTML = paths;

    highlightOnHover(tree, svg);
}

/** Lighting up a node's own lines is the difference between a diagram and a picture. */
function highlightOnHover(tree, svg) {
    if (tree.dataset.lit === 'true') return;
    tree.dataset.lit = 'true';

    const setLit = (quest) => {
        for (const path of svg.querySelectorAll('path')) {
            const on = quest && (path.dataset.from === quest || path.dataset.to === quest);
            path.classList.toggle('is-lit', Boolean(on));
        }
    };

    tree.addEventListener('pointerover', (event) => {
        setLit(event.target.closest('.qt-node')?.dataset.quest ?? null);
    });
    // Touch has no hover, so the press itself lights the lines: hold a quest to
    // trace it, lift to open it.
    tree.addEventListener('pointerdown', (event) => {
        setLit(event.target.closest('.qt-node')?.dataset.quest ?? null);
    });
    tree.addEventListener('pointerleave', () => setLit(null));
    tree.addEventListener('focusin', (event) => {
        setLit(event.target.closest('.qt-node')?.dataset.quest ?? null);
    });
}
