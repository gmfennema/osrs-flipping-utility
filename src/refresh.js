/**
 * Background price refresh.
 *
 * The wiki `/latest` endpoint updates continuously and `/1h` and `/24h` roll
 * every few minutes, so a page loaded once and left open was showing prices
 * that could be hours stale behind a "Live Data" badge. This polls on an
 * interval, pauses while the tab is hidden, and catches up immediately when
 * the tab comes back.
 */

import { state } from './state.js';
import { loadLatest, loadVolume } from './api/market.js';

const PRICE_INTERVAL_MS = 60_000;
/** Volume windows move far more slowly than spot prices. */
const VOLUME_EVERY_N_TICKS = 5;

let timer = null;
let tickCount = 0;
let running = false;
let onUpdate = () => {};

function setStatus(kind, text, title = '') {
    const indicator = document.getElementById('live-status');
    if (!indicator) return;
    indicator.dataset.state = kind;
    const label = indicator.querySelector('.status-text');
    if (label) label.textContent = text;
    indicator.title = title;
}

function describeAge(timestampMs) {
    const seconds = Math.round((Date.now() - timestampMs) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.round(seconds / 60)}m ago`;
}

/** Ids whose buy or sell price moved between two `/latest` snapshots. */
export function diffQuotes(before, after) {
    const changed = new Set();
    for (const [id, quote] of Object.entries(after)) {
        const old = before[id];
        if (!old) { changed.add(Number(id)); continue; }
        if (old.high !== quote.high || old.low !== quote.low) changed.add(Number(id));
    }
    return changed;
}

async function tick({ force = false } = {}) {
    if (running) return;
    running = true;
    setStatus('loading', 'Updating…');

    try {
        const previous = state.latestPrices;
        const latest = await loadLatest();
        const changed = diffQuotes(previous, latest);
        state.latestPrices = latest;
        state.lastPriceUpdate = Date.now();

        const wantVolumes = force || tickCount % VOLUME_EVERY_N_TICKS === 0;
        if (wantVolumes) {
            const [vol24, vol1h] = await Promise.all([loadVolume('24h'), loadVolume('1h')]);
            state.volume24h = vol24;
            state.volume1h = vol1h;
        }

        tickCount++;
        setStatus('live', `Live · ${describeAge(state.lastPriceUpdate)}`,
            `${changed.size} price${changed.size === 1 ? '' : 's'} moved on the last tick`);

        onUpdate({ changed, volumesRefreshed: wantVolumes });
    } catch (error) {
        console.error('Refresh failed', error);
        const age = state.lastPriceUpdate ? describeAge(state.lastPriceUpdate) : 'never';
        setStatus('error', `Stale · ${age}`, String(error?.message ?? error));
    } finally {
        running = false;
    }
}

function schedule() {
    clearInterval(timer);
    timer = setInterval(() => {
        if (document.hidden) return; // Do not burn requests on a background tab.
        tick();
    }, PRICE_INTERVAL_MS);
}

/**
 * @param {(info: {changed: Set<number>, volumesRefreshed: boolean}) => void} handler
 */
export function startAutoRefresh(handler) {
    onUpdate = handler;
    state.lastPriceUpdate = Date.now();
    setStatus('live', `Live · ${describeAge(state.lastPriceUpdate)}`);
    schedule();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        // Catch up on whatever was missed while the tab was in the background.
        const staleFor = Date.now() - (state.lastPriceUpdate ?? 0);
        if (staleFor > PRICE_INTERVAL_MS) tick();
    });

    // Keep the relative timestamp honest between ticks.
    setInterval(() => {
        if (running || !state.lastPriceUpdate) return;
        const indicator = document.getElementById('live-status');
        if (indicator?.dataset.state === 'live') {
            setStatus('live', `Live · ${describeAge(state.lastPriceUpdate)}`);
        }
    }, 10_000);
}

export function refreshNow() {
    return tick({ force: true });
}
