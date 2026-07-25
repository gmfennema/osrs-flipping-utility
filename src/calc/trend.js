/**
 * Price trend over a lookback window.
 *
 * The previous implementation used `history.find(d => d.timestamp >= cutoff)`,
 * which returns the FIRST point at or after the cutoff. On a 7d or 30d series
 * that is a point from six days ago, not twelve hours ago, so the "12h trend"
 * silently became a multi-day trend. We now pick the point NEAREST the target
 * timestamp and refuse to report a number when the nearest point is too far
 * away to mean anything.
 */

export const HOUR = 3600;

/** Mid price for a timeseries point, tolerating one-sided intervals. */
export function midPrice(point) {
    if (!point) return null;
    const high = typeof point.avgHighPrice === 'number' ? point.avgHighPrice : null;
    const low = typeof point.avgLowPrice === 'number' ? point.avgLowPrice : null;
    if (high !== null && low !== null) return (high + low) / 2;
    return high ?? low;
}

/**
 * Find the priced point closest to `targetTs`, within `maxGapSeconds`.
 * Returns null when nothing is close enough.
 */
export function nearestPricedPoint(history, targetTs, maxGapSeconds) {
    if (!Array.isArray(history) || history.length === 0) return null;

    let best = null;
    let bestGap = Infinity;

    for (const point of history) {
        if (typeof point?.timestamp !== 'number') continue;
        if (midPrice(point) === null) continue;

        const gap = Math.abs(point.timestamp - targetTs);
        if (gap < bestGap) {
            bestGap = gap;
            best = point;
        }
    }

    if (!best || bestGap > maxGapSeconds) return null;
    return { point: best, gapSeconds: bestGap };
}

/**
 * Percentage price change over `hoursBack`.
 *
 * @returns {{ ok: boolean, changePct: number|null, reason?: string,
 *             fromTs?: number, toTs?: number, gapHours?: number }}
 */
export function calculateTrend(history, options = {}) {
    const {
        hoursBack = 12,
        now = Math.floor(Date.now() / 1000),
        // Allow the reference point to be off by up to a quarter of the window.
        maxGapSeconds = Math.max(hoursBack * HOUR * 0.25, 30 * 60)
    } = options;

    if (!Array.isArray(history) || history.length === 0) {
        return { ok: false, changePct: null, reason: 'no history' };
    }

    const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

    const latest = nearestPricedPoint(sorted, now, Infinity);
    if (!latest) return { ok: false, changePct: null, reason: 'no priced points' };

    const targetTs = latest.point.timestamp - hoursBack * HOUR;
    const reference = nearestPricedPoint(sorted, targetTs, maxGapSeconds);
    if (!reference) {
        return {
            ok: false,
            changePct: null,
            reason: `no data within ${(maxGapSeconds / HOUR).toFixed(1)}h of the ${hoursBack}h mark`
        };
    }

    if (reference.point.timestamp === latest.point.timestamp) {
        return { ok: false, changePct: null, reason: 'series too short for this window' };
    }

    const oldPrice = midPrice(reference.point);
    const newPrice = midPrice(latest.point);
    if (!oldPrice) return { ok: false, changePct: null, reason: 'reference price is zero' };

    return {
        ok: true,
        changePct: ((newPrice - oldPrice) / oldPrice) * 100,
        fromTs: reference.point.timestamp,
        toTs: latest.point.timestamp,
        gapHours: reference.gapSeconds / HOUR
    };
}
