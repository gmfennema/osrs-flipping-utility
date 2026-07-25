/**
 * The Plan tab: a concrete 48h buy plan for your actual bankroll.
 *
 * This is the opposite of a sortable table. A table asks you to pick; a plan
 * tells you what to buy, how many, at what bid, and what ask to set — because
 * the whole finding of the analysis is that no single F2P item can absorb a 9m
 * bankroll, so the answer is always a basket, never a row.
 */

import { state, setCurrentItem } from '../state.js';
import { loadEdgeHistories } from '../api/market.js';
import { shortlist } from '../calc/shortlist.js';
import { computeEdge, EDGE_CONFIG } from '../calc/edge.js';
import { buildPlan, currentBuyWindow, BUY_WINDOWS, LIMIT_WINDOW_HOURS } from '../calc/plan.js';
import { gp, gpShort, pct, iconUrl, scoreColor } from './format.js';

let running = false;
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

function renderSummary(plan, evaluated) {
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
                <span class="plan-metric-hint">of ${evaluated} evaluated</span>
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
    if (edge.bid < 50) flags.push('<span class="plan-flag plan-flag-good" title="Under 50gp, so the GE takes no tax at all — a single tick is pure profit">tax-free</span>');
    if (orders.needsMove) flags.push(`<span class="plan-flag plan-flag-warn" title="The current ask does not clear the 2% tax. This needs the price to rise about ${orders.movePct.toFixed(1)}% before it pays.">needs +${orders.movePct.toFixed(1)}%</span>`);
    if (edge.pctRank <= 0.25) flags.push('<span class="plan-flag plan-flag-good" title="Trading in the bottom quarter of its 30-day range">near 30d low</span>');
    if (edge.jumpiness !== null && edge.jumpiness > 0.35) flags.push('<span class="plan-flag plan-flag-warn" title="Most of this item\'s movement happens in a few sudden jumps, so a scheduled hold may sit dead">jumpy</span>');

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
            <td><span class="score-pill" style="color:${scoreColor(score)}">${score}</span></td>
            <td class="plan-num">${gp(orders.bid)}</td>
            <td class="plan-num">${gp(orders.ask)}</td>
            <td class="plan-num positive">${gp(orders.margin)}</td>
            <td class="plan-num">${pct(roiPct, 2)}</td>
            <td class="plan-num">${gp(qty)}<span class="bound-tag bound-${boundBy}" title="${bound.title}">${bound.tag}</span></td>
            <td class="plan-num">${gpShort(spend)}</td>
            <td class="plan-num positive">${gpShort(profit)}</td>
            <td class="plan-num">${fill}</td>
            <td class="plan-num">${gpShort(edge.thinFlow48h)}</td>
            <td class="plan-num">${(edge.pctRank * 100).toFixed(0)}%</td>
        </tr>`;
}

function renderPositions(plan) {
    const tbody = document.querySelector('#plan-table tbody');
    if (!tbody) return;

    if (!plan.positions.length) {
        tbody.innerHTML = `<tr><td colspan="11" class="plan-empty">
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

/** Fetch history for the shortlist and render the plan. */
export async function renderPlan({ force = false } = {}) {
    if (running) return;
    if (lastPlan && !force) {
        renderSummary(lastPlan.plan, lastPlan.evaluated);
        renderPositions(lastPlan.plan);
        renderRejected(lastPlan.plan);
        return;
    }

    const capital = state.capital;
    if (!capital || capital <= 0) {
        setStatus('Enter your bankroll in the Flip Finder tab to build a plan.');
        return;
    }

    running = true;
    try {
        const candidates = shortlist({
            items: state.itemMapping,
            latestPrices: state.latestPrices,
            volume24h: state.volume24h,
            capital,
            pool: state.membersFilter
        });

        if (!candidates.length) {
            setStatus('No items passed the initial screen. Check that prices have loaded.');
            renderPositions({ positions: [] });
            return;
        }

        setStatus(`Measuring ${candidates.length} candidates against 30 days of history…`, { busy: true });
        const histories = await loadEdgeHistories(
            candidates.map((c) => c.item.id),
            (done, total) => setStatus(`Measuring history… ${done}/${total}`, { busy: true })
        );

        const withEdges = candidates.map(({ item }) => ({
            item,
            edge: computeEdge(histories.get(item.id) ?? [])
        }));

        const plan = buildPlan({ candidates: withEdges, capital });
        lastPlan = { plan, evaluated: candidates.length, builtAt: Date.now() };

        renderSummary(plan, candidates.length);
        renderPositions(plan);
        renderRejected(plan);
        setStatus(`Plan built from ${candidates.length} candidates · ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        console.error('Plan build failed', error);
        setStatus(`Could not build a plan: ${error?.message ?? error}`);
    } finally {
        running = false;
    }
}

export function invalidatePlan() {
    lastPlan = null;
}

export function initPlanner() {
    document.getElementById('plan-refresh')?.addEventListener('click', () => renderPlan({ force: true }));
    window.addEventListener('osrs:capital-changed', () => {
        invalidatePlan();
        if (state.activeTab === 'planner') renderPlan();
    });
}
