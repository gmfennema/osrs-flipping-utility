import { describe, it, expect } from 'vitest';
import { calculateTrend, nearestPricedPoint, midPrice, HOUR } from '../src/calc/trend.js';

const NOW = 1_700_000_000;

/** Build a series with `count` points spaced `stepSeconds` apart, ending at NOW. */
function series(count, stepSeconds, priceAt) {
    return Array.from({ length: count }, (_, i) => {
        const timestamp = NOW - (count - 1 - i) * stepSeconds;
        const price = priceAt(i);
        return { timestamp, avgHighPrice: price + 10, avgLowPrice: price - 10 };
    });
}

describe('midPrice', () => {
    it('averages both sides when present', () => {
        expect(midPrice({ avgHighPrice: 110, avgLowPrice: 90 })).toBe(100);
    });

    it('falls back to whichever side exists', () => {
        expect(midPrice({ avgHighPrice: 110, avgLowPrice: null })).toBe(110);
        expect(midPrice({ avgHighPrice: null, avgLowPrice: 90 })).toBe(90);
    });

    it('returns null for an empty interval', () => {
        expect(midPrice({ avgHighPrice: null, avgLowPrice: null })).toBeNull();
    });
});

describe('nearestPricedPoint', () => {
    it('picks the closest point, not the first one past the cutoff', () => {
        const data = [
            { timestamp: 100, avgHighPrice: 1, avgLowPrice: 1 },
            { timestamp: 900, avgHighPrice: 2, avgLowPrice: 2 },
            { timestamp: 1000, avgHighPrice: 3, avgLowPrice: 3 }
        ];
        expect(nearestPricedPoint(data, 950, Infinity).point.timestamp).toBe(900);
    });

    it('skips points with no price at all', () => {
        const data = [
            { timestamp: 950, avgHighPrice: null, avgLowPrice: null },
            { timestamp: 800, avgHighPrice: 5, avgLowPrice: 5 }
        ];
        expect(nearestPricedPoint(data, 950, Infinity).point.timestamp).toBe(800);
    });

    it('refuses a point outside the allowed gap', () => {
        const data = [{ timestamp: 100, avgHighPrice: 1, avgLowPrice: 1 }];
        expect(nearestPricedPoint(data, 10_000, 500)).toBeNull();
    });
});

describe('calculateTrend', () => {
    it('measures the change over the requested window', () => {
        // 5m steps across 24h, price rising 1gp per step.
        const data = series(288, 300, (i) => 1000 + i);
        const result = calculateTrend(data, { hoursBack: 12, now: NOW });

        expect(result.ok).toBe(true);
        // 12h back = 144 steps = 144gp lower, from a base of 1143.
        expect(result.changePct).toBeCloseTo((144 / 1143) * 100, 1);
        expect(result.toTs - result.fromTs).toBe(12 * HOUR);
    });

    // This is the bug the old implementation had: on a wide series it took the
    // first point after the cutoff, which is days old rather than 12h old.
    it('does not reach back days on a 30d series', () => {
        // 6h steps across 30d, price rising 100gp per step.
        const data = series(120, 6 * HOUR, (i) => 1000 + i * 100);
        const result = calculateTrend(data, { hoursBack: 12, now: NOW });

        expect(result.ok).toBe(true);
        // Exactly two 6h steps back = 200gp, not the 11,900gp a 30d reach gives.
        const latest = 1000 + 119 * 100;
        const reference = 1000 + 117 * 100;
        expect(result.changePct).toBeCloseTo(((latest - reference) / reference) * 100, 6);
        expect(result.toTs - result.fromTs).toBe(12 * HOUR);
    });

    it('reports unavailable rather than guessing when the series is too short', () => {
        // Only 2h of 5m data — nothing anywhere near the 12h mark.
        const data = series(24, 300, () => 1000);
        const result = calculateTrend(data, { hoursBack: 12, now: NOW });

        expect(result.ok).toBe(false);
        expect(result.changePct).toBeNull();
        expect(result.reason).toMatch(/no data within/);
    });

    it('tolerates a reference point inside the allowed gap', () => {
        // 1h steps over 7d: the 12h mark lands exactly on a sample.
        const data = series(168, HOUR, (i) => 500 + i);
        const result = calculateTrend(data, { hoursBack: 12, now: NOW });
        expect(result.ok).toBe(true);
        expect(result.gapHours).toBe(0);
    });

    it('handles empty and unpriced input', () => {
        expect(calculateTrend([], { now: NOW }).ok).toBe(false);
        expect(calculateTrend(null, { now: NOW }).ok).toBe(false);
        const blank = [{ timestamp: NOW, avgHighPrice: null, avgLowPrice: null }];
        expect(calculateTrend(blank, { now: NOW }).ok).toBe(false);
    });

    it('does not mutate the caller\'s array', () => {
        const data = [
            { timestamp: NOW, avgHighPrice: 2, avgLowPrice: 2 },
            { timestamp: NOW - 12 * HOUR, avgHighPrice: 1, avgLowPrice: 1 }
        ];
        const order = data.map((d) => d.timestamp);
        calculateTrend(data, { now: NOW });
        expect(data.map((d) => d.timestamp)).toEqual(order);
    });
});
