/**
 * The Market Pulse (analyzer) view.
 *
 * Rendering is split in two on purpose. Everything derivable from the already
 * loaded `/latest` and `/24h` snapshots paints immediately; the 30d history
 * needed for the trend, spread stability and consistency arrives afterwards
 * and patches the view in place. Previously the whole header awaited a fresh
 * 30d fetch on every click.
 */

import { state, getItem } from '../state.js';
import { loadTimeseries, loadConsistencyHistory } from '../api/market.js';
import { buildFlip } from '../calc/flip.js';
import { calculateTrend } from '../calc/trend.js';
import { processData, spreadStats, volumeConsistency } from '../calc/series.js';
import { buildReasoning } from '../calc/reasoning.js';
import { splitVolume } from '../calc/liquidity.js';
import { renderChart } from './chart.js';
import { gp, gpShort, signed, pct, hours, relativeTime, trendClass, scoreColor, iconUrl } from './format.js';

const el = (id) => document.getElementById(id);

const PENDING = '…';

function setStat(id, value, className) {
    const node = el(id);
    if (!node) return;
    node.textContent = value;
    if (className !== undefined) node.className = `stat-value ${className}`.trim();
}

function renderScoreBadge(score) {
    const badge = el('ai-score-display');
    if (!badge) return;
    badge.textContent = `Score: ${score}/100`;
    badge.style.color = scoreColor(score);
}

function renderBreakdown(components) {
    const host = el('score-breakdown');
    if (!host) return;

    if (!components || components.length === 0) {
        host.innerHTML = '';
        return;
    }

    host.innerHTML = components.map((c) => `
        <div class="score-component" title="${c.note}">
            <div class="score-component-head">
                <span class="score-component-label">${c.label}</span>
                <span class="score-component-value">${Math.round(c.value * 100)}</span>
            </div>
            <div class="score-bar"><div class="score-bar-fill" style="width:${Math.round(c.value * 100)}%"></div></div>
            <span class="score-component-weight">weight ${Math.round(c.weight * 100)}%</span>
        </div>
    `).join('');
}

function renderReasoning(lines) {
    const host = el('ai-reasoning');
    if (!host) return;
    host.innerHTML = lines.map((line) => `
        <li class="reason-line reason-${line.tone}">
            <span class="reason-icon">${line.icon}</span>
            <span><strong>${line.title}:</strong> ${line.text}</span>
        </li>
    `).join('');
}

function clearStats() {
    [
        'stat-high', 'stat-net-high', 'stat-low', 'stat-margin', 'stat-roi',
        'stat-qty', 'stat-cycle-profit', 'stat-gp-hour', 'stat-fill-time',
        'stat-trend', 'stat-avg-vol', 'stat-limit-display', 'stat-consistency',
        'stat-stability', 'stat-balance', 'stat-freshness'
    ].forEach((id) => setStat(id, '--', ''));
}

/**
 * Paint everything available from the current price snapshot. Synchronous.
 *
 * `resetPending` blanks the history-derived stats to a spinner glyph; an
 * auto-refresh tick passes false so it does not wipe values already hydrated.
 *
 * @returns {object|null} the derived flip, or null if the item has no quote
 */
export function renderItemSnapshot(item, { resetPending = true } = {}) {
    el('item-name').textContent = item.name;
    el('item-icon').src = iconUrl(item.icon);
    el('item-icon').alt = item.name;

    // The search box and the Flip Finder both reach members items, and nothing
    // else on this screen says whether you can place the order at all.
    const poolNote = el('item-pool-note');
    if (poolNote) {
        poolNote.textContent = item.members ? 'Members item' : 'Free-to-play item';
        poolNote.dataset.members = String(Boolean(item.members));
    }

    const flip = buildFlip({
        item,
        quote: state.latestPrices[item.id],
        vol24: state.volume24h[item.id],
        vol1h: state.volume1h[item.id],
        capital: state.capital,
        stability: state.currentStability
    });

    if (!flip) {
        clearStats();
        renderScoreBadge(0);
        renderBreakdown([]);
        renderReasoning([{
            icon: '🕳️', tone: 'bad', title: 'No recent trades',
            text: 'The wiki API has no current buy/sell quote for this item.'
        }]);
        return null;
    }

    setStat('stat-high', gp(flip.high));
    setStat('stat-net-high', gp(flip.netHigh));
    setStat('stat-low', gp(flip.low));
    setStat('stat-margin', signed(flip.margin), trendClass(flip.margin, 0));
    setStat('stat-roi', pct(flip.roi), trendClass(flip.roi));

    setStat('stat-qty', gp(flip.qty), flip.qty > 0 ? '' : 'trend-down');
    setStat('stat-cycle-profit', signed(flip.cycleProfit, gpShort), trendClass(flip.cycleProfit, 0));
    setStat('stat-gp-hour', signed(flip.gpPerHour, gpShort), trendClass(flip.gpPerHour, 0));
    setStat('stat-fill-time', hours(flip.cycleHours));

    setStat('stat-limit-display', flip.limit ? gp(flip.limit) : 'Unknown');
    setStat('stat-balance', `${Math.round(flip.balance * 100)}%`, flip.balance >= 0.5 ? 'trend-up' : 'trend-down');
    setStat('stat-freshness', relativeTime(flip.quoteAgeSeconds), flip.quoteAgeSeconds > 1800 ? 'trend-down' : 'trend-up');

    if (resetPending) {
        // Filled in by the async pass.
        setStat('stat-trend', PENDING, '');
        setStat('stat-avg-vol', PENDING, '');
        setStat('stat-consistency', PENDING, '');
        setStat('stat-stability', PENDING, '');
    }

    renderScoreBadge(flip.score);
    renderBreakdown(flip.scoreComponents);

    const boundLabel = { capital: 'capital', limit: 'buy limit', both: 'both', unknown: 'unknown' }[flip.boundBy];
    const qtyHint = el('qty-hint');
    if (qtyHint) qtyHint.textContent = flip.qty > 0 ? `bound by ${boundLabel}` : '';

    return flip;
}

/**
 * Fetch history and patch in the derived stats. Guarded by `token` so a slow
 * response for a previously selected item cannot overwrite the current one.
 */
async function hydrate(item, token) {
    const [series, history] = await Promise.all([
        loadTimeseries(item.id, state.currentTimeRange),
        loadConsistencyHistory(item.id)
    ]);

    if (token !== state.analyzerToken) return; // Superseded by a newer selection.

    state.currentItemHistory = series;
    state.currentStability = null;

    const points = processData(series, state.currentTimeRange, state.viewMode);
    renderChart(el('volumeChart'), points, {
        viewMode: state.viewMode,
        range: state.currentTimeRange
    });

    // Spread stability comes from the chart's own range so it matches what the
    // user is looking at; the trend always uses the 12h window.
    const spread = spreadStats(points);
    const trend = calculateTrend(series, { hoursBack: 12 });

    const current24h = splitVolume(state.volume24h[item.id]).total;
    const consistency = volumeConsistency(history, current24h);

    if (trend.ok) {
        setStat('stat-trend', pct(trend.changePct), trendClass(trend.changePct));
    } else {
        setStat('stat-trend', 'n/a', 'trend-flat');
    }
    const trendNote = el('trend-note');
    if (trendNote) trendNote.textContent = trend.ok ? '' : trend.reason;

    setStat('stat-avg-vol', consistency.days > 0 ? gpShort(consistency.avg7d) : 'n/a');
    setStat('stat-consistency', consistency.consistency);
    setStat('stat-stability', spread.stability === null ? 'n/a' : `${Math.round(spread.stability * 100)}%`,
        spread.stability >= 0.6 ? 'trend-up' : spread.stability >= 0.3 ? 'trend-flat' : 'trend-down');

    // Rescore now that spread stability is known, and remember it so refresh
    // ticks keep the refined score instead of dropping back to the rough one.
    state.currentStability = spread.stability;
    const flip = buildFlip({
        item,
        quote: state.latestPrices[item.id],
        vol24: state.volume24h[item.id],
        vol1h: state.volume1h[item.id],
        capital: state.capital,
        stability: spread.stability
    });

    if (!flip) return;

    renderScoreBadge(flip.score);
    renderBreakdown(flip.scoreComponents);
    renderReasoning(buildReasoning({ flip, trend, consistency, spread }));
}

/** Render the analyzer for `itemId`, painting immediately and hydrating after. */
export function showItem(itemId) {
    const item = getItem(itemId);
    if (!item) return;

    const token = ++state.analyzerToken;
    state.currentStability = null;
    renderItemSnapshot(item);
    renderReasoning([{ icon: '⏳', tone: 'neutral', title: 'Loading history', text: 'Fetching trend, spread stability and volume consistency…' }]);

    hydrate(item, token).catch((error) => {
        console.error('Analyzer hydration failed', error);
        if (token !== state.analyzerToken) return;
        renderReasoning([{ icon: '⚠️', tone: 'bad', title: 'History unavailable', text: 'Could not load timeseries data. Prices above are still current.' }]);
    });
}

/** Re-render only the price-derived parts, e.g. after an auto-refresh tick. */
export function refreshCurrentSnapshot() {
    const item = getItem(state.currentItemId);
    if (!item) return;
    renderItemSnapshot(item, { resetPending: false });
}

/** Redraw the chart for the current range/mode without refetching prices. */
export function redrawChart() {
    showItem(state.currentItemId);
}
