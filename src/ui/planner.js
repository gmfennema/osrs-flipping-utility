/**
 * The Plan tab: a concrete 48h buy plan for your actual bankroll.
 *
 * This is the opposite of a sortable table. A table asks you to pick; a plan
 * tells you what to buy, how many, at what bid, and what ask to set — because
 * the whole finding of the analysis is that very few items can absorb a whole
 * bankroll on their own, so the answer is always a basket, never a row.
 */

import { state, setCurrentItem } from '../state.js';
import { loadEdgeHistories } from '../api/market.js';
import { shortlist } from '../calc/shortlist.js';
import { computeEdge, EDGE_CONFIG } from '../calc/edge.js';
import { buildPlan, currentBuyWindow, BUY_WINDOWS, LIMIT_WINDOW_HOURS } from '../calc/plan.js';
import { bindCapitalInput } from './capital.js';
import { bindPoolSelect, POOL_CHANGED, POOL_LABELS } from './pool.js';
import { gp, gpShort, pct, iconUrl, scoreColor } from './format.js';

/** The in-flight build, if any: `{ controller, promise }`. */
let activeRun = null;
let lastPlan = null;

const BOUND_LABELS = {
    limit: { tag: 'L', title: 'Capped by the GE buy limit over the windows you will use' },
    flow: { tag: 'F', title: 'Capped by how much genuinely trades — taking more would move the price against you' },
    capital: { tag: '$', title: 'Capped by the gold left in your bankroll' },
    concentration: { tag: '%', title: 'Capped by the per-item share of your bankroll' }
};

function setStatus(text, { busy = false } = {}) {
    const el = document.getElementById('plan-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.busy = busy ? 'true' : 'false';
}

function windowBanner() {
    const now = new Date();
    const current = currentBuyWindow(now);
    const best = BUY_WINDOWS[0];
    const hour = now.getUTCHours();

    if (current.quality === 'best') {
        return { tone: 'good', text: `You are in the best buying window (${best.fromUtc}:00–${best.toUtc}:00 UTC) — ${best.note}.` };
    }
    const hoursUntil = (24 - hour) % 24;
    const tone = current.quality === 'worst' ? 'warn' : 'neutral';
    return {
        tone,
        text: `Current window ${current.fromUtc}:00–${current.toUtc}:00 UTC is ${current.quality} for buying (${current.note}). `
            + `The best window opens in ${hoursUntil}h — entries there averaged about 28% more profit per cycle.`
    };
}

function renderSummary(plan, evaluated, pool) {
    const el = document.getElementById('plan-summary');
    if (!el) return;
    const { totals } = plan;
    const banner = windowBanner();

    el.innerHTML = `
        <div class="plan-banner plan-banner-${banner.tone}">${banner.text}</div>
        <div class="plan-metrics">
            <div class="plan-metric">
                <span class="plan-metric-label">Positions</span>
                <span class="plan-metric-value">${totals.positionCount}</span>
                <span class="plan-metric-hint">of ${evaluated} evaluated · ${POOL_LABELS[pool] ?? pool}</span>
            </div>
            <div class="plan-metric">
                <span class="plan-metric-label">Capital deployed</span>
                <span class="plan-metric-value">${gpShort(totals.deployed)}</span>
                <span class="plan-metric-hint">${gpShort(totals.idle)} idle</span>
            </div>
            <div class="plan-metric accent">
                <span class="plan-metric-label">Expected profit / 48h</span>
                <span class="plan-metric-value">${gpShort(totals.expectedProfit)}</span>
                <span class="plan-metric-hint" title="Each position is discounted by how often this item's price has actually reached the ask. If every sell offer filled you would clear ${gpShort(totals.grossProfit)}.">${totals.expectedReturnPct.toFixed(2)}% on bankroll · ${gpShort(totals.grossProfit)} if all fill</span>
            </div>
            <div class="plan-metric">
                <span class="plan-metric-label">Buy-limit windows assumed</span>
                <span class="plan-metric-value">${EDGE_CONFIG.limitWindows}</span>
                <span class="plan-metric-hint">${EDGE_CONFIG.limitWindows * LIMIT_WINDOW_HOURS}h of re-buying</span>
            </div>
        </div>`;
}

function positionRow(position) {
    const { item, edge, orders, qty, spend, profit, score, boundBy, roiPct, fillProbability } = position;
    const bound = BOUND_LABELS[boundBy] ?? BOUND_LABELS.capital;
    const fill = fillProbability === null ? '—' : `${Math.round(fillProbability * 100)}%`;

    const flags = [];
    // First, because it is the only flag that decides whether you can place the
    // order at all rather than how good it is.
    if (item.members) flags.push('<span class="plan-flag" title="Members item — you need a membership to trade this">members</span>');
    if (edge.bid < 50) flags.push('<span class="plan-flag plan-flag-good" title="Under 50gp, so the GE takes no tax at all — a single tick is pure profit">tax-free</span>');
    if (orders.needsMove) flags.push(`<span class="plan-flag plan-flag-warn" title="The current ask does not clear the 2% tax. This needs the price to rise about ${orders.movePct.toFixed(1)}% before it pays.">needs +${orders.movePct.toFixed(1)}%</span>`);
    if (edge.pctRank <= 0.25) flags.push('<span class="plan-flag plan-flag-good" title="Trading in the bottom quarter of its 30-day range">near 30d low</span>');
    if (edge.jumpiness !== null && edge.jumpiness > 0.35) flags.push('<span class="plan-flag plan-flag-warn" title="Most of this item\'s movement happens in a few sudden jumps, so a scheduled hold may sit dead">jumpy</span>');

    // `data-label` is what lets the narrow-screen stylesheet drop the header row
    // and print each cell as a labelled line — a 12-column table is unreadable
    // on a phone, and the bid and qty are the whole point of the plan.
    return `
        <tr data-item-id="${item.id}">
            <td class="col-item">
                <div class="item-cell">
                    <img src="${iconUrl(item.icon)}" alt="" loading="lazy">
                    <div>
                        <span>${item.name}</span>
                        ${flags.length ? `<div class="plan-flags">${flags.join('')}</div>` : ''}
                    </div>
                </div>
            </td>
            <td data-label="Edge"><span class="score-pill" style="color:${scoreColor(score)}">${score}</span></td>
            <td class="plan-num" data-label="Bid">${gp(orders.bid)}</td>
            <td class="plan-num" data-label="Ask">${gp(orders.ask)}</td>
            <td class="plan-num positive" data-label="Margin">${gp(orders.margin)}</td>
            <td class="plan-num" data-label="ROI">${pct(roiPct, 2)}</td>
            <td class="plan-num" data-label="Qty">${gp(qty)}<span class="bound-tag bound-${boundBy}" title="${bound.title}">${bound.tag}</span></td>
            <td class="plan-num" data-label="Spend">${gpShort(spend)}</td>
            <td class="plan-num positive" data-label="Profit">${gpShort(profit)}</td>
            <td class="plan-num" data-label="Fill">${fill}</td>
            <td class="plan-num" data-label="Thin flow">${gpShort(edge.thinFlow48h)}</td>
            <td class="plan-num" data-label="30d pos">${(edge.pctRank * 100).toFixed(0)}%</td>
        </tr>`;
}

/** Replace the table body with a single explanatory row. */
function renderNotice(html) {
    const tbody = document.querySelector('#plan-table tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" class="plan-empty">${html}</td></tr>`;
    const summary = document.getElementById('plan-summary');
    if (summary) summary.innerHTML = '';
    const rejected = document.getElementById('plan-rejected');
    if (rejected) rejected.innerHTML = '';
}

function renderPositions(plan) {
    const tbody = document.querySelector('#plan-table tbody');
    if (!tbody) return;

    if (!plan.positions.length) {
        tbody.innerHTML = `<tr><td colspan="12" class="plan-empty">
            Nothing clears the bar right now. Every candidate was rejected for thin flow, an erratic price,
            or no post-tax spread. That is a real answer — on a quiet day the correct position is no position.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = plan.positions.map(positionRow).join('');
    tbody.querySelectorAll('tr[data-item-id]').forEach((tr) => {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => {
            const id = Number(tr.dataset.itemId);
            setCurrentItem(id);
            document.querySelector('[data-tab="analyzer"]')?.click();
            window.dispatchEvent(new CustomEvent('osrs:select-item', { detail: { id } }));
        });
    });
}

function renderRejected(plan) {
    const el = document.getElementById('plan-rejected');
    if (!el) return;

    const counts = new Map();
    for (const row of plan.skipped) {
        for (const reason of row.reasons) {
            const key = reason.replace(/~?[\d,]+/g, 'N').replace(/\d+%/g, 'N%');
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    if (!counts.size) { el.innerHTML = ''; return; }

    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `<li><strong>${count}</strong> ${reason}</li>`).join('');
    el.innerHTML = `<details><summary>Why ${plan.skipped.length} candidates were rejected</summary><ul>${rows}</ul></details>`;
}

function renderCached() {
    const measured = lastPlan.measured;
    renderSummary(lastPlan.plan, measured, lastPlan.pool);
    renderPositions(lastPlan.plan);
    renderRejected(lastPlan.plan);
    setStatus(`Plan built from ${measured} of ${lastPlan.evaluated} candidates`
        + `${lastPlan.failed ? ` · ${lastPlan.failed} could not be measured` : ''}`
        + ` · ${new Date(lastPlan.builtAt).toLocaleTimeString()}`);
}

async function build(signal) {
    const capital = state.capital;
    const pool = state.itemPool;

    const candidates = shortlist({
        items: state.itemMapping,
        latestPrices: state.latestPrices,
        volume24h: state.volume24h,
        capital,
        pool
    });

    if (!candidates.length) {
        setStatus('No items passed the initial screen. Check that prices have loaded.');
        renderNotice('No items passed the initial screen. Either prices have not loaded yet, or your bankroll'
            + ' is too small to take a worthwhile position in anything in this pool.'
            + (pool === 'all' ? '' : ' Widening <strong>Item pool</strong> to all items gives the screen'
                + ' the rest of the market to work with.'));
        return;
    }

    setStatus(`Measuring ${candidates.length} candidates against 30 days of history…`, { busy: true });
    const { histories, failed, aborted, gaveUp } = await loadEdgeHistories(
        candidates.map((c) => c.item.id),
        (done, total) => setStatus(`Measuring history… ${done}/${total}`, { busy: true }),
        { signal }
    );

    // A cancelled run must not repaint over whatever replaced it.
    if (aborted || signal.aborted) return;

    if (gaveUp && !histories.size) {
        setStatus('Could not reach the wiki API to measure history. Check your connection and tap Rebuild plan.');
        renderNotice('Could not measure any history — every request failed, so there is nothing to rank.'
            + ' This is a connection problem, not a quiet market. Tap <strong>Rebuild plan</strong> to retry.');
        return;
    }

    // Only items we actually measured are ranked. An item whose request dropped
    // is unknown, not untradeable, so it is counted as a gap rather than being
    // silently rejected for "no usable history".
    const measured = candidates.filter(({ item }) => histories.has(item.id));
    const withEdges = measured.map(({ item }) => ({
        item,
        edge: computeEdge(histories.get(item.id))
    }));

    const plan = buildPlan({ candidates: withEdges, capital });
    lastPlan = {
        plan,
        pool,
        evaluated: candidates.length,
        measured: measured.length,
        failed: failed.length,
        builtAt: Date.now()
    };

    renderSummary(plan, measured.length, pool);
    renderPositions(plan);
    renderRejected(plan);

    const gap = failed.length
        ? ` · ${failed.length} could not be measured${gaveUp ? ' (connection dropped)' : ''} — tap Rebuild plan to retry`
        : '';
    setStatus(`Plan built from ${measured.length} of ${candidates.length} candidates${gap}`
        + ` · ${new Date().toLocaleTimeString()}`);
}

/**
 * Fetch history for the shortlist and render the plan.
 *
 * `force` cancels a build already in flight instead of being ignored, so a
 * stalled run is something the Rebuild button can actually get you out of.
 */
export async function renderPlan({ force = false } = {}) {
    if (activeRun && !force) return activeRun.promise;

    if (activeRun) {
        activeRun.controller.abort();
        try { await activeRun.promise; } catch { /* superseded */ }
    }

    // A plan is only ever valid for the pool it was drawn from. The pool change
    // itself invalidates it; this is the belt to that braces, so no path can
    // serve an F2P basket as though it were the whole market.
    if (lastPlan && lastPlan.pool !== state.itemPool) lastPlan = null;

    if (lastPlan && !force) {
        renderCached();
        return;
    }

    if (!state.capital || state.capital <= 0) {
        setStatus('Enter your bankroll above to build a plan.');
        renderNotice('Every figure in the plan is sized to your bankroll, so there is nothing to compute yet.'
            + ' Enter what you have to spend in <strong>Your capital</strong> above — <code>9m</code> and'
            + ' <code>9000000</code> both work.');
        return;
    }

    const controller = new AbortController();
    const run = { controller, promise: null };
    run.promise = (async () => {
        try {
            await build(controller.signal);
        } catch (error) {
            if (controller.signal.aborted) return;
            console.error('Plan build failed', error);
            setStatus(`Could not build a plan: ${error?.message ?? error}`);
        } finally {
            if (activeRun === run) activeRun = null;
        }
    })();
    activeRun = run;
    return run.promise;
}

export function invalidatePlan() {
    lastPlan = null;
}

export function initPlanner() {
    bindCapitalInput({
        input: document.getElementById('plan-capital'),
        hint: document.getElementById('plan-capital-hint'),
        emptyHint: 'Required — the plan is sized to your bankroll'
    });

    bindPoolSelect({
        select: document.getElementById('plan-pool'),
        hint: document.getElementById('plan-pool-hint')
    });

    document.getElementById('plan-refresh')?.addEventListener('click', () => renderPlan({ force: true }));
    window.addEventListener('osrs:capital-changed', () => {
        invalidatePlan();
        if (state.activeTab === 'planner') renderPlan({ force: true });
    });
    // A different pool is a different shortlist, so the whole plan has to be
    // measured again — the cached one is about a market you are no longer asking
    // about.
    window.addEventListener(POOL_CHANGED, () => {
        invalidatePlan();
        if (state.activeTab === 'planner') renderPlan({ force: true });
    });
}
