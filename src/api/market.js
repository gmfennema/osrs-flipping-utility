/**
 * Wiki API access layer.
 *
 * Two caching tiers:
 *   - The item mapping is ~4000 rows that change maybe once a week, so it goes
 *     to localStorage with a 24h TTL and is stripped of fields we never render.
 *   - Prices, volumes and timeseries live in an in-memory MemoCache that also
 *     coalesces duplicate in-flight requests.
 */

import { MemoCache, cacheKey, readCache, writeCache } from './cache.js';
import { TIMESTEP_FOR_RANGE } from '../calc/series.js';

const API_BASE = 'https://prices.runescape.wiki/api/v1/osrs';
const USER_AGENT_NOTE = 'osrs-market-pulse';

const MAPPING_TTL_MS = 24 * 60 * 60 * 1000;
const MAPPING_KEY = cacheKey('mapping');

/**
 * A phone radio does not refuse a connection, it stalls one. Without a deadline
 * a single hung request parks a worker forever and the whole planner sits on a
 * spinner that never resolves — the desktop-works/mobile-hangs failure mode.
 */
const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAYS_MS = [400, 1_200];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 4xx means we asked wrongly; retrying will not help. 429 and 5xx will. */
function worthRetrying(error) {
    const status = error?.status;
    if (typeof status !== 'number') return true; // network error or timeout
    return status === 429 || status >= 500;
}

/** Timeseries staleness tolerance, by timestep. */
const TIMESERIES_TTL_MS = {
    '5m': 2 * 60_000,
    '1h': 10 * 60_000,
    '6h': 30 * 60_000,
    '24h': 60 * 60_000
};

const timeseriesCache = new MemoCache();
const consistencyCache = new MemoCache(30 * 60_000);

/**
 * One GET with a deadline and a couple of retries.
 *
 * @param {string} path
 * @param {{timeoutMs?: number, retries?: number, signal?: AbortSignal}} [options]
 */
async function getJson(path, { timeoutMs = REQUEST_TIMEOUT_MS, retries = RETRY_DELAYS_MS.length, signal } = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        // Callers may pass a real AbortSignal or the plain `{ aborted }` flag the
        // batch loader polls between items; only the former can be listened to.
        const forward = () => controller.abort();
        const relays = typeof signal?.addEventListener === 'function';
        if (relays) signal.addEventListener('abort', forward);

        try {
            const response = await fetch(`${API_BASE}${path}`, {
                headers: { Accept: 'application/json', 'X-Client': USER_AGENT_NOTE },
                signal: controller.signal
            });
            if (!response.ok) {
                const error = new Error(`${path} failed: HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            return await response.json();
        } catch (error) {
            // The caller cancelled: propagate rather than burning retries on it.
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            lastError = controller.signal.aborted
                ? new Error(`${path} timed out after ${timeoutMs}ms`)
                : error;
            if (attempt >= retries || !worthRetrying(lastError)) break;
            await delay(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
        } finally {
            clearTimeout(timer);
            if (relays) signal.removeEventListener('abort', forward);
        }
    }

    throw lastError;
}

/** Keep only the fields the app renders — roughly halves the cached payload. */
function slimMapping(rows) {
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        icon: row.icon,
        limit: row.limit,
        members: row.members,
        value: row.value,
        highalch: row.highalch,
        lowalch: row.lowalch
    }));
}

/**
 * @returns {Promise<{ items: Array, fromCache: boolean, ageMs: number }>}
 */
export async function loadMapping({ force = false } = {}) {
    if (!force) {
        const cached = readCache(MAPPING_KEY, MAPPING_TTL_MS);
        if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
            return { items: cached.data, fromCache: true, ageMs: cached.ageMs };
        }
    }

    const rows = await getJson('/mapping');
    const items = slimMapping(rows);
    writeCache(MAPPING_KEY, items);
    return { items, fromCache: false, ageMs: 0 };
}

export async function loadLatest() {
    const json = await getJson('/latest');
    return json.data ?? {};
}

export async function loadVolume(window) {
    const json = await getJson(`/${window}`);
    return json.data ?? {};
}

/**
 * Timeseries for one item at the timestep matching `range`.
 * Repeated calls inside the TTL reuse the cached rows, and simultaneous calls
 * share a single request.
 */
export async function loadTimeseries(id, range) {
    const timestep = TIMESTEP_FOR_RANGE[range] ?? '5m';
    const key = `${id}:${timestep}`;
    const ttl = TIMESERIES_TTL_MS[timestep] ?? 5 * 60_000;

    // The catch sits outside `resolve` on purpose: a failure must not be cached,
    // or one dropped request blanks the chart until the TTL expires.
    try {
        return await timeseriesCache.resolve(key, async () => {
            const json = await getJson(`/timeseries?timestep=${timestep}&id=${id}`);
            return json.data ?? [];
        }, ttl);
    } catch (error) {
        console.error('Timeseries fetch failed', error);
        return [];
    }
}

/**
 * 30d history used for volume-consistency analysis. Cached separately and for
 * longer than the chart series, because it is expensive and slow-moving —
 * clicking the same item repeatedly must not refetch it.
 */
export async function loadConsistencyHistory(id) {
    try {
        return await consistencyCache.resolve(`consistency:${id}`, async () => {
            const json = await getJson(`/timeseries?timestep=6h&id=${id}`);
            return json.data ?? [];
        });
    } catch (error) {
        console.error('Consistency history fetch failed', error);
        return [];
    }
}

/**
 * 6h history for the edge model. Same endpoint as the consistency history, but
 * kept in its own cache with a long TTL: the planner asks for dozens of items
 * at once and the 6h buckets only roll four times a day, so refetching them on
 * every visit would be pure waste.
 */
const edgeCache = new MemoCache(45 * 60_000);

/**
 * A history request that fails is *not* cached. Caching the failure was the
 * reason a lossy mobile connection produced a permanently short plan: the items
 * whose requests dropped came back as "no usable history" and "Rebuild plan"
 * re-served those same failures from cache for the next 45 minutes.
 *
 * @throws when the history cannot be fetched.
 */
export async function loadEdgeHistory(id, { signal } = {}) {
    return edgeCache.resolve(`edge:${id}`, async () => {
        const json = await getJson(`/timeseries?timestep=6h&id=${id}`, {
            timeoutMs: 10_000,
            retries: 1,
            signal
        });
        return json.data ?? [];
    });
}

/** Give up on the batch once this many requests fail back to back. */
const FAILURE_STREAK_LIMIT = 8;

/**
 * Fetch 6h history for many items with bounded concurrency.
 *
 * The planner needs per-item history, which means one request per candidate.
 * The wiki asks for restraint, so this runs a small worker pool rather than
 * firing sixty requests at once, and reports progress so the UI can show it
 * instead of appearing hung.
 *
 * Failures are reported rather than swallowed. The planner cannot tell a
 * genuinely untradeable item from one it simply failed to measure, so it has to
 * be told which is which instead of quietly ranking a partial universe.
 *
 * @param {number[]} ids
 * @param {(done: number, total: number) => void} [onProgress]
 * @param {{concurrency?: number, signal?: AbortSignal|{aborted: boolean}}} [options]
 * @returns {Promise<{histories: Map<number, Array>, failed: number[], aborted: boolean, gaveUp: boolean}>}
 */
export async function loadEdgeHistories(ids, onProgress = () => {}, options = {}) {
    const { concurrency = 4, signal = null } = options;
    const histories = new Map();
    const failed = [];
    const queue = [...ids];
    const total = queue.length;
    let done = 0;
    let failureStreak = 0;
    let gaveUp = false;

    async function worker() {
        while (queue.length) {
            if (signal?.aborted || gaveUp) return;
            const id = queue.shift();
            try {
                histories.set(id, await loadEdgeHistory(id, { signal }));
                failureStreak = 0;
            } catch (error) {
                if (signal?.aborted) return;
                console.error('Edge history fetch failed', id, error);
                failed.push(id);
                // A run of consecutive failures means the connection is gone,
                // not that this item is odd. Stop rather than grinding through
                // sixty more timeouts.
                if (++failureStreak >= FAILURE_STREAK_LIMIT) gaveUp = true;
            }
            done++;
            onProgress(done, total);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
    return { histories, failed, aborted: Boolean(signal?.aborted), gaveUp };
}

export function clearTimeseriesCaches() {
    timeseriesCache.clear();
    consistencyCache.clear();
    edgeCache.clear();
}
