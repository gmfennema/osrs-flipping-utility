import { describe, it, expect } from 'vitest';
import {
    processData, pointSpread, spreadStats, volumeConsistency, smoothSeries, rangeStart
} from '../src/calc/series.js';

const NOW = Math.floor(Date.UTC(2024, 5, 15, 12, 0, 0) / 1000);
const HOUR = 3600;

function row(offsetSeconds, high, low, highVol = 100, lowVol = 100) {
    return {
        timestamp: NOW - offsetSeconds,
        avgHighPrice: high,
        avgLowPrice: low,
        highPriceVolume: highVol,
        lowPriceVolume: lowVol
    };
}

describe('rangeStart', () => {
    it('walks back the right window', () => {
        expect(rangeStart('24h', NOW)).toBe(NOW - 24 * HOUR);
        expect(rangeStart('7d', NOW)).toBe(NOW - 7 * 86400);
        expect(rangeStart('30d', NOW)).toBe(NOW - 30 * 86400);
    });
});

describe('smoothSeries', () => {
    it('passes values through when the window is 1', () => {
        const data = [{ v: 1 }, { v: 2 }, { v: 3 }];
        expect(smoothSeries(data, 'v', 1)).toEqual([1, 2, 3]);
    });

    it('averages across the window and ignores gaps', () => {
        const data = [{ v: 1 }, { v: null }, { v: 3 }];
        expect(smoothSeries(data, 'v', 3)).toEqual([1, 2, 3]);
    });
});

describe('pointSpread', () => {
    it('is the post-tax margin for the interval', () => {
        // 1000 sells net 980, buying at 900 leaves 80.
        expect(pointSpread({ priceHigh: 1000, priceLow: 900 })).toBe(80);
    });

    it('is null when either side of the interval is missing', () => {
        expect(pointSpread({ priceHigh: 1000, priceLow: null })).toBeNull();
        expect(pointSpread({ priceHigh: null, priceLow: 900 })).toBeNull();
    });
});

describe('processData timeline mode', () => {
    it('splits volume by side and attaches a spread to every point', () => {
        const data = [row(3600, 1000, 900, 40, 60), row(1800, 1010, 905, 10, 90)];
        const points = processData(data, '24h', 'timeline', NOW);

        expect(points).toHaveLength(2);
        expect(points[0]).toMatchObject({ sellVolume: 40, buyVolume: 60, volume: 100 });
        expect(points[0].spread).toBe(80);
        expect(points[1].spread).toBe(1010 - Math.floor(1010 * 0.02) - 905);
    });

    it('drops rows outside the requested range', () => {
        const data = [row(48 * HOUR, 1000, 900), row(HOUR, 1000, 900)];
        expect(processData(data, '24h', 'timeline', NOW)).toHaveLength(1);
    });

    it('survives empty input', () => {
        expect(processData([], '24h', 'timeline', NOW)).toEqual([]);
        expect(processData(null, '24h', 'timeline', NOW)).toEqual([]);
    });
});

describe('processData time-of-day mode', () => {
    it('produces 24 hourly buckets with spreads', () => {
        const data = Array.from({ length: 24 }, (_, i) => row(i * HOUR, 1000, 900));
        const points = processData(data, '24h', 'time-of-day', NOW);

        expect(points).toHaveLength(24);
        const priced = points.filter((p) => p.spread !== null);
        expect(priced.length).toBeGreaterThan(0);
        priced.forEach((p) => expect(p.spread).toBe(80));
    });
});

describe('spreadStats', () => {
    it('flags a durable spread', () => {
        const points = Array.from({ length: 20 }, () => ({ spread: 50 }));
        const stats = spreadStats(points);

        expect(stats.samples).toBe(20);
        expect(stats.positiveRatio).toBe(1);
        expect(stats.median).toBe(50);
        expect(stats.cv).toBe(0);
        expect(stats.stability).toBe(1);
    });

    it('flags a spread that only exists occasionally', () => {
        // One 400gp spike, nineteen negatives.
        const points = [{ spread: 400 }, ...Array.from({ length: 19 }, () => ({ spread: -5 }))];
        const stats = spreadStats(points);

        expect(stats.positiveRatio).toBeCloseTo(0.05, 6);
        expect(stats.stability).toBeLessThan(0.05);
    });

    it('ignores intervals with no spread at all', () => {
        const stats = spreadStats([{ spread: null }, { spread: 10 }, { spread: undefined }]);
        expect(stats.samples).toBe(1);
    });

    it('returns a null stability when there is nothing to measure', () => {
        expect(spreadStats([]).stability).toBeNull();
    });
});

describe('volumeConsistency', () => {
    function days(volumes) {
        // One row per day, oldest first, ending yesterday.
        return volumes.map((vol, i) => ({
            timestamp: NOW - (volumes.length - i) * 86400,
            highPriceVolume: vol / 2,
            lowPriceVolume: vol / 2
        }));
    }

    it('rates steady volume as high consistency', () => {
        const result = volumeConsistency(days(Array(30).fill(10_000)), 10_000, NOW);
        expect(result.consistency).toBe('High');
        expect(result.avg30d).toBe(10_000);
        expect(result.avg7d).toBe(10_000);
        expect(result.isSpike).toBe(false);
    });

    it('rates choppy volume as moderate', () => {
        // Alternating 100 / 100k lands at CV ~1.0, just inside Moderate.
        const choppy = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 100_000));
        expect(volumeConsistency(days(choppy), 50_000, NOW).consistency).toBe('Moderate');
    });

    it('rates spiky volume as volatile', () => {
        // Dead most days, one enormous day: CV well above 1.
        const spiky = Array.from({ length: 30 }, (_, i) => (i === 15 ? 300_000 : 0));
        const result = volumeConsistency(days(spiky), 300_000, NOW);
        expect(result.cv).toBeGreaterThan(1);
        expect(result.consistency).toBe('Volatile');
    });

    it('detects a spike against the 7d average', () => {
        const result = volumeConsistency(days(Array(30).fill(10_000)), 50_000, NOW);
        expect(result.isSpike).toBe(true);
    });

    it('excludes the partial current day from the averages', () => {
        const history = [
            ...days(Array(7).fill(10_000)),
            // A sliver of today's volume that would drag the average down.
            { timestamp: NOW, highPriceVolume: 5, lowPriceVolume: 5 }
        ];
        const result = volumeConsistency(history, 10_000, NOW);
        expect(result.avg7d).toBe(10_000);
        expect(result.days).toBe(7);
    });

    // The 6h endpoint hands back ~91 days, which would turn "30d avg" into a
    // quarterly average if it were not trimmed.
    it('trims history to the last 30 days', () => {
        const long = days([...Array(61).fill(1_000_000), ...Array(30).fill(10_000)]);
        const result = volumeConsistency(long, 10_000, NOW);
        expect(result.days).toBe(30);
        expect(result.avg30d).toBe(10_000);
    });

    it('handles no data', () => {
        expect(volumeConsistency([], 0, NOW).consistency).toBe('Unknown');
    });
});
