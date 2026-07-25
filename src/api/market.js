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

/** Timeseries staleness tolerance, by timestep. */
const TIMESERIES_TTL_MS = {
    '5m': 2 * 60_000,
    '1h': 10 * 60_000,
    '6h': 30 * 60_000,
    '24h': 60 * 60_000
};

const timeseriesCache = new MemoCache();
const consistencyCache = new MemoCache(30 * 60_000);

async function getJson(path) {
    const response = await fetch(`${API_BASE}${path}`, {
        headers: { Accept: 'application/json', 'X-Client': USER_AGENT_NOTE }
    });
    if (!response.ok) throw new Error(`${path} failed: HTTP ${response.status}`);
    return response.json();
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

    return timeseriesCache.resolve(key, async () => {
        try {
            const json = await getJson(`/timeseries?timestep=${timestep}&id=${id}`);
            return json.data ?? [];
        } catch (error) {
            console.error('Timeseries fetch failed', error);
            return [];
        }
    }, ttl);
}

/**
 * 30d history used for volume-consistency analysis. Cached separately and for
 * longer than the chart series, because it is expensive and slow-moving —
 * clicking the same item repeatedly must not refetch it.
 */
export async function loadConsistencyHistory(id) {
    return consistencyCache.resolve(`consistency:${id}`, async () => {
        try {
            const json = await getJson(`/timeseries?timestep=6h&id=${id}`);
            return json.data ?? [];
        } catch (error) {
            console.error('Consistency history fetch failed', error);
            return [];
        }
    });
}

export function clearTimeseriesCaches() {
    timeseriesCache.clear();
    consistencyCache.clear();
}
