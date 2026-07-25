import { describe, it, expect } from 'vitest';
import {
    cleanBucket, cleanSeries, computeEdge, askFor, bucketSpread,
    jumpConcentration, edgeRate, edgeScore, edgeVetoes, askReachRatio, EDGE_CONFIG
} from '../src/calc/edge.js';

/** Build a synthetic 6h series. `spec` entries are {high, low, vol}. */
function series(spec, startTs = 1_700_000_000) {
    return spec.map((s, i) => ({
        timestamp: startTs + i * 21600,
        avgHighPrice: s.high,
        avgLowPrice: s.low,
        highPriceVolume: s.hv ?? s.vol ?? 5000,
        lowPriceVolume: s.lv ?? s.vol ?? 5000
    }));
}

/** A healthy, liquid, gently oscillating item priced well under the tax line. */
function healthySpec(n = 130) {
    return Array.from({ length: n }, (_, i) => ({
        high: 42 + (i % 4), low: 38 + (i % 4), vol: 8000
    }));
}

describe('cleanBucket', () => {
    it('accepts a two-sided bucket', () => {
        expect(cleanBucket({ timestamp: 1, avgHighPrice: 110, avgLowPrice: 100, highPriceVolume: 5, lowPriceVolume: 7 }))
            .toMatchObject({ high: 110, low: 100, mid: 105, sellFlow: 5, buyFlow: 7, volume: 12 });
    });

    it('rejects a one-sided bucket — a spread needs both sides to have printed', () => {
        expect(cleanBucket({ timestamp: 1, avgHighPrice: 110, avgLowPrice: null, highPriceVolume: 5, lowPriceVolume: 0 })).toBeNull();
        expect(cleanBucket({ timestamp: 1, avgHighPrice: 110, avgLowPrice: 100, highPriceVolume: 0, lowPriceVolume: 7 })).toBeNull();
        expect(cleanBucket({ timestamp: 1, avgHighPrice: 110, avgLowPrice: 100, highPriceVolume: 5, lowPriceVolume: 0 })).toBeNull();
    });

    it('rejects an inverted bucket as bad data', () => {
        expect(cleanBucket({ timestamp: 1, avgHighPrice: 1, avgLowPrice: 2, highPriceVolume: 5, lowPriceVolume: 5 })).toBeNull();
    });

    it('sorts and drops unusable rows', () => {
        const cleaned = cleanSeries([
            { timestamp: 300, avgHighPrice: 110, avgLowPrice: 100, highPriceVolume: 5, lowPriceVolume: 5 },
            { timestamp: 100, avgHighPrice: 108, avgLowPrice: 101, highPriceVolume: 5, lowPriceVolume: 5 },
            { timestamp: 200, avgHighPrice: null, avgLowPrice: 100, highPriceVolume: 5, lowPriceVolume: 5 }
        ]);
        expect(cleaned.map((b) => b.ts)).toEqual([100, 300]);
    });
});

describe('askFor — the 50gp tax cliff', () => {
    it('lets a single tick pay below the tax threshold', () => {
        expect(askFor(5)).toBe(6);
        expect(askFor(20)).toBe(21);
        expect(askFor(40)).toBe(41);
    });

    it('needs roughly 2% above the tax threshold, because one tick is a loss there', () => {
        // At 100gp the tax is 2gp, so selling at 101 nets 99 — a loss.
        expect(askFor(100)).toBe(103);
        expect(askFor(1000)).toBe(1021);
        expect(askFor(20_000)).toBe(20_409);
    });

    it('returns null when no sane ask clears the requested profit', () => {
        expect(askFor(0)).toBeNull();
        expect(askFor(-5)).toBeNull();
    });

    it('produces an ask that really does clear the profit after tax', () => {
        for (const bid of [5, 49, 50, 99, 100, 517, 5000, 123_456]) {
            const ask = askFor(bid, 1);
            expect(ask).not.toBeNull();
            expect(ask - Math.floor(ask * 0.02) - bid).toBeGreaterThanOrEqual(1);
        }
    });
});

describe('bucketSpread', () => {
    it('is tax-free below 50gp', () => {
        // buy 38, sell 42, no tax: 4gp on a mid of 40.
        expect(bucketSpread({ high: 42, low: 38, mid: 40 })).toBeCloseTo(4 / 40, 9);
    });

    it('subtracts the tax above 50gp', () => {
        // buy 1000, sell 1100, tax 22 -> 78gp on a mid of 1050.
        expect(bucketSpread({ high: 1100, low: 1000, mid: 1050 })).toBeCloseTo(78 / 1050, 9);
    });
});

describe('jumpConcentration', () => {
    it('is low when movement is spread evenly', () => {
        const buckets = Array.from({ length: 60 }, (_, i) => ({ mid: 100 + (i % 2) }));
        expect(jumpConcentration(buckets)).toBeLessThan(0.2);
    });

    it('is high when one jump dominates', () => {
        const buckets = Array.from({ length: 60 }, (_, i) => ({ mid: i === 30 ? 1000 : 100 }));
        expect(jumpConcentration(buckets)).toBeGreaterThan(0.8);
    });

    it('returns null without enough history to judge', () => {
        expect(jumpConcentration([{ mid: 1 }, { mid: 2 }])).toBeNull();
    });
});

describe('computeEdge', () => {
    it('returns null without enough clean history', () => {
        expect(computeEdge([])).toBeNull();
        expect(computeEdge(series(healthySpec(5)))).toBeNull();
    });

    it('measures the spread from history rather than the last print', () => {
        const edge = computeEdge(series(healthySpec()));
        expect(edge.medSpread).toBeGreaterThan(0);
        expect(edge.spreadNow).toBeGreaterThan(0);
        expect(edge.flow48h).toBeCloseTo(16000 * 8, 6);
    });

    it('places pctRank at the bottom of the 30d range for an item at its low', () => {
        // Ramp down from 200 to 100, so the final bucket is the range low.
        const spec = Array.from({ length: 130 }, (_, i) => ({ high: 200 - i, low: 195 - i, vol: 8000 }));
        const edge = computeEdge(series(spec));
        expect(edge.pctRank).toBeLessThan(0.05);
        expect(edge.change7d).toBeLessThan(0);
    });

    it('places pctRank at the top after a run-up', () => {
        const spec = Array.from({ length: 130 }, (_, i) => ({ high: 100 + i, low: 95 + i, vol: 8000 }));
        const edge = computeEdge(series(spec));
        expect(edge.pctRank).toBeGreaterThan(0.95);
        expect(edge.change7d).toBeGreaterThan(0);
    });

    it('reports the thinner side of the book separately', () => {
        const spec = Array.from({ length: 130 }, () => ({ high: 42, low: 38, hv: 9000, lv: 1000 }));
        const edge = computeEdge(series(spec));
        expect(edge.thinFlow48h).toBeCloseTo(1000 * 8, 6);
        expect(edge.flow48h).toBeCloseTo(10000 * 8, 6);
    });
});

describe('edgeVetoes', () => {
    const healthy = computeEdge(series(healthySpec()));

    it('passes a liquid, calm, cheap item', () => {
        expect(edgeVetoes(healthy)).toEqual([]);
    });

    it('vetoes thin flow — the highest-impact filter in backtest', () => {
        const thin = computeEdge(series(healthySpec().map((s) => ({ ...s, vol: 50 }))));
        expect(edgeVetoes(thin).join(' ')).toMatch(/units trade/);
    });

    it('vetoes an item that has already run up this week', () => {
        // Compounding ~1.5% per 6h bucket is over +50% across the trailing week,
        // with the spread held proportional so a real margin still exists — the
        // veto has to fire on the run-up itself, not on a vanished spread.
        const spec = Array.from({ length: 130 }, (_, i) => {
            const base = Math.round(100 * 1.015 ** i);
            return { high: Math.round(base * 1.12), low: base, vol: 8000 };
        });
        const edge = computeEdge(series(spec));
        expect(edge.medSpread).toBeGreaterThan(0);
        expect(edgeVetoes(edge).join(' ')).toMatch(/already up/);
    });

    it('vetoes an erratic price', () => {
        const spec = Array.from({ length: 130 }, (_, i) => ({
            high: i % 2 ? 900 : 120, low: i % 2 ? 800 : 100, vol: 8000
        }));
        expect(edgeVetoes(computeEdge(series(spec))).join(' ')).toMatch(/erratic/);
    });

    it('vetoes missing history outright', () => {
        expect(edgeVetoes(null)).toEqual(['no usable history']);
    });
});

describe('askReachRatio', () => {
    it('is 1 when the ask sits at a level the market always reaches', () => {
        expect(askReachRatio(computeEdge(series(healthySpec())), 40)).toBe(1);
    });

    it('is 0 when the ask is above anything the market has printed', () => {
        expect(askReachRatio(computeEdge(series(healthySpec())), 10_000)).toBe(0);
    });

    it('measures the share of intervals that reached the ask', () => {
        const spec = Array.from({ length: 130 }, (_, i) => ({
            high: i % 4 === 0 ? 60 : 41, low: 38, vol: 8000
        }));
        expect(askReachRatio(computeEdge(series(spec)), 60)).toBeCloseTo(0.25, 2);
    });

    it('returns null when there is no history to measure against', () => {
        expect(askReachRatio(null, 50)).toBeNull();
        expect(askReachRatio({}, 50)).toBeNull();
    });
});

describe('edgeRate', () => {
    it('is zero when there is no post-tax spread to capture', () => {
        // 1000/1001 is inside the 2% tax, so every bucket is negative.
        const spec = Array.from({ length: 130 }, () => ({ high: 1001, low: 1000, vol: 8000 }));
        expect(edgeRate(computeEdge(series(spec)))).toBe(0);
    });

    it('prefers the same spread nearer the bottom of its range', () => {
        const flat = computeEdge(series(Array.from({ length: 130 }, () => ({ high: 42, low: 38, vol: 8000 }))));
        const dipped = computeEdge(series([
            ...Array.from({ length: 120 }, () => ({ high: 52, low: 48, vol: 8000 })),
            ...Array.from({ length: 10 }, () => ({ high: 42, low: 38, vol: 8000 }))
        ]));
        expect(edgeRate(dipped)).toBeGreaterThan(edgeRate(flat));
    });

    it('is monotone with the score, so ranking never disagrees with display', () => {
        const wide = computeEdge(series(Array.from({ length: 130 }, () => ({ high: 46, low: 38, vol: 8000 }))));
        const narrow = computeEdge(series(Array.from({ length: 130 }, () => ({ high: 40, low: 38, vol: 8000 }))));
        expect(edgeRate(wide)).toBeGreaterThan(edgeRate(narrow));
        expect(edgeScore(wide)).toBeGreaterThan(edgeScore(narrow));
    });

    it('keeps the score inside 1..100', () => {
        const huge = computeEdge(series(Array.from({ length: 130 }, () => ({ high: 400, low: 10, vol: 8000 }))));
        expect(edgeScore(huge)).toBeLessThanOrEqual(100);
        expect(edgeScore(huge)).toBeGreaterThanOrEqual(1);
        expect(edgeScore(null)).toBe(0);
    });

    it('respects a config override', () => {
        const edge = computeEdge(series(healthySpec()));
        const tilted = edgeRate(edge, { ...EDGE_CONFIG, dipTilt: 5 });
        expect(tilted).toBeGreaterThan(edgeRate(edge));
    });
});
