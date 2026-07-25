/**
 * Timeseries shaping: range filtering, the two view modes, the post-tax spread
 * series, and the volume-consistency stats.
 */

import { netSellPrice } from './pricing.js';

const DAY = 86400;

export const RANGE_SECONDS = {
    '24h': 24 * 3600,
    '7d': 7 * DAY,
    '30d': 30 * DAY
};

export const TIMESTEP_FOR_RANGE = {
    '24h': '5m',
    '7d': '1h',
    '30d': '6h',
    ytd: '24h'
};

/** Centred moving average over one key of a point array. */
export function smoothSeries(data, key, windowSize = 1) {
    if (windowSize <= 1 || data.length === 0) {
        return data.map((point) => point[key]);
    }
    const half = Math.floor(windowSize / 2);
    return data.map((_, idx) => {
        let sum = 0;
        let count = 0;
        for (let i = Math.max(0, idx - half); i <= Math.min(data.length - 1, idx + half); i++) {
            const value = data[i][key];
            if (value !== null && value !== undefined) {
                sum += value;
                count++;
            }
        }
        return count > 0 ? sum / count : null;
    });
}

/** Post-tax spread for one interval: what you'd clear buying low, selling high. */
export function pointSpread(point) {
    if (point.priceHigh === null || point.priceHigh === undefined) return null;
    if (point.priceLow === null || point.priceLow === undefined) return null;
    return netSellPrice(point.priceHigh) - point.priceLow;
}

export function rangeStart(range, now = Math.floor(Date.now() / 1000)) {
    if (range === 'ytd') {
        return Math.floor(new Date(new Date(now * 1000).getUTCFullYear(), 0, 1).getTime() / 1000);
    }
    return now - (RANGE_SECONDS[range] ?? RANGE_SECONDS['24h']);
}

/**
 * Turn raw wiki timeseries rows into chart-ready points.
 *
 * @param {'timeline'|'time-of-day'} mode
 */
export function processData(data, range, mode, now = Math.floor(Date.now() / 1000)) {
    if (!Array.isArray(data) || data.length === 0) return [];

    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const startTime = rangeStart(range, now);
    const filtered = sorted.filter((d) => d.timestamp > startTime);

    if (mode === 'timeline') {
        return filtered.map((d) => {
            const point = {
                x: d.timestamp * 1000,
                buyVolume: d.lowPriceVolume || 0,
                sellVolume: d.highPriceVolume || 0,
                volume: (d.highPriceVolume || 0) + (d.lowPriceVolume || 0),
                priceHigh: d.avgHighPrice ?? null,
                priceLow: d.avgLowPrice ?? null
            };
            point.spread = pointSpread(point);
            return point;
        });
    }

    const buckets = Array.from({ length: 24 }, () => ({
        totalVolume: 0, totalBuy: 0, totalSell: 0,
        totalHigh: 0, countHigh: 0,
        totalLow: 0, countLow: 0,
        count: 0
    }));

    filtered.forEach((d) => {
        const hour = new Date(d.timestamp * 1000).getHours();
        const bucket = buckets[hour];
        bucket.totalBuy += d.lowPriceVolume || 0;
        bucket.totalSell += d.highPriceVolume || 0;
        bucket.totalVolume += (d.highPriceVolume || 0) + (d.lowPriceVolume || 0);
        bucket.count += 1;
        if (d.avgHighPrice) { bucket.totalHigh += d.avgHighPrice; bucket.countHigh++; }
        if (d.avgLowPrice) { bucket.totalLow += d.avgLowPrice; bucket.countLow++; }
    });

    const anchor = new Date(now * 1000);
    anchor.setMinutes(0, 0, 0);

    return buckets.map((bucket, hour) => {
        const pointDate = new Date(anchor);
        pointDate.setHours(hour);
        const point = {
            x: pointDate.getTime(),
            buyVolume: bucket.count > 0 ? bucket.totalBuy / bucket.count : 0,
            sellVolume: bucket.count > 0 ? bucket.totalSell / bucket.count : 0,
            volume: bucket.count > 0 ? bucket.totalVolume / bucket.count : 0,
            priceHigh: bucket.countHigh > 0 ? bucket.totalHigh / bucket.countHigh : null,
            priceLow: bucket.countLow > 0 ? bucket.totalLow / bucket.countLow : null
        };
        point.spread = pointSpread(point);
        return point;
    }).sort((a, b) => a.x - b.x);
}

/**
 * How dependable the spread is over the sampled window. A durable 3gp margin
 * beats a 60gp margin that exists in one interval out of forty.
 *
 * @returns {{ samples, positiveRatio, mean, median, cv, stability }}
 */
export function spreadStats(points) {
    const spreads = (points ?? [])
        .map((p) => p.spread)
        .filter((s) => s !== null && s !== undefined && Number.isFinite(s));

    if (spreads.length === 0) {
        return { samples: 0, positiveRatio: 0, mean: 0, median: 0, cv: 0, stability: null };
    }

    const positiveRatio = spreads.filter((s) => s > 0).length / spreads.length;
    const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;

    const sorted = [...spreads].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    const variance = spreads.reduce((sum, s) => sum + (s - mean) ** 2, 0) / spreads.length;
    const cv = Math.abs(mean) > 0 ? Math.sqrt(variance) / Math.abs(mean) : 0;

    // Reward "positive most of the time", punish "wildly variable".
    const stability = Math.min(1, Math.max(0, positiveRatio * (1 - Math.min(cv, 1))));

    return { samples: spreads.length, positiveRatio, mean, median, cv, stability };
}

/**
 * Daily volume consistency over the supplied history.
 *
 * The current UTC day is excluded from the averages because it is partial and
 * would drag them down; the live rolling 24h figure is used for spike checks.
 * History is trimmed to `maxDays` because the 6h timeseries endpoint returns
 * 365 points (about 91 days), which would silently make "30d avg" a quarterly
 * average.
 */
export function volumeConsistency(data, current24hVolume = 0, now = Math.floor(Date.now() / 1000), maxDays = 30) {
    const empty = { avg7d: 0, avg30d: 0, consistency: 'Unknown', isSpike: false, cv: 0, days: 0 };
    if (!Array.isArray(data) || data.length === 0) return empty;

    const dailyVolumes = new Map();
    for (const d of data) {
        if (typeof d?.timestamp !== 'number') continue;
        const key = new Date(d.timestamp * 1000).toISOString().slice(0, 10);
        const vol = (d.highPriceVolume || 0) + (d.lowPriceVolume || 0);
        dailyVolumes.set(key, (dailyVolumes.get(key) ?? 0) + vol);
    }

    const todayKey = new Date(now * 1000).toISOString().slice(0, 10);
    dailyVolumes.delete(todayKey);

    const volumes = [...dailyVolumes.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, v]) => v)
        .slice(-maxDays);

    if (volumes.length === 0) return empty;

    const avg30d = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const volumes7d = volumes.slice(-7);
    const avg7d = volumes7d.reduce((a, b) => a + b, 0) / volumes7d.length;

    const variance = volumes.reduce((sum, v) => sum + (v - avg30d) ** 2, 0) / volumes.length;
    const cv = avg30d > 0 ? Math.sqrt(variance) / avg30d : 0;

    let consistency = 'High';
    if (cv > 0.5) consistency = 'Moderate';
    if (cv > 1.0) consistency = 'Volatile';

    return {
        avg7d,
        avg30d,
        consistency,
        cv,
        days: volumes.length,
        isSpike: avg7d > 0 && current24hVolume > avg7d * 2
    };
}
