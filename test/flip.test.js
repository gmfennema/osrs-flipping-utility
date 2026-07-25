import { describe, it, expect } from 'vitest';
import { buildFlip, quoteAge } from '../src/calc/flip.js';

const NOW = 1_700_000_000;

const natureRune = { id: 561, name: 'Nature rune', icon: 'Nature rune.png', limit: 12_000, members: false };

const liquid = { highPriceVolume: 480_000, lowPriceVolume: 480_000 };

function flip(overrides = {}) {
    return buildFlip({
        item: natureRune,
        quote: { high: 1000, low: 900, highTime: NOW - 30, lowTime: NOW - 60 },
        vol24: liquid,
        vol1h: { highPriceVolume: 20_000, lowPriceVolume: 20_000 },
        capital: null,
        now: NOW,
        ...overrides
    });
}

describe('quoteAge', () => {
    it('uses the more stale of the two sides', () => {
        expect(quoteAge({ highTime: NOW - 10, lowTime: NOW - 500 }, NOW)).toBe(500);
    });

    it('is null when the API gives no timestamps', () => {
        expect(quoteAge({}, NOW)).toBeNull();
    });
});

describe('buildFlip', () => {
    it('derives post-tax economics from the raw pieces', () => {
        const result = flip();
        expect(result.netHigh).toBe(980);
        expect(result.margin).toBe(80);
        expect(result.qty).toBe(12_000);
        expect(result.cycleProfit).toBe(960_000);
        expect(result.gpPerHour).toBeGreaterThan(0);
        expect(result.quoteAgeSeconds).toBe(60);
    });

    it('sizes the flip to the supplied capital', () => {
        const result = flip({ capital: 900_000 });
        expect(result.qty).toBe(1000);
        expect(result.boundBy).toBe('capital');
        expect(result.cycleProfit).toBe(80_000);
    });

    it('returns null when the item has no usable quote', () => {
        expect(flip({ quote: undefined })).toBeNull();
        expect(flip({ quote: { high: null, low: null } })).toBeNull();
    });

    it('normalises an inverted quote rather than reporting a negative margin', () => {
        const result = flip({ quote: { high: 900, low: 1000, highTime: NOW, lowTime: NOW } });
        expect(result.inverted).toBe(true);
        expect(result.high).toBe(1000);
        expect(result.low).toBe(900);
        expect(result.margin).toBe(80);
    });

    it('separates the two sides of the book', () => {
        const result = flip({ vol24: { highPriceVolume: 100, lowPriceVolume: 900 } });
        expect(result.sellSideVolume).toBe(100);
        expect(result.buySideVolume).toBe(900);
        expect(result.minSideVolume).toBe(100);
        expect(result.volume).toBe(1000);
        expect(result.balance).toBeCloseTo(0.2, 6);
    });

    it('scores lower once the quote goes stale', () => {
        const fresh = flip().score;
        const stale = flip({ quote: { high: 1000, low: 900, highTime: NOW - 4 * 3600, lowTime: NOW - 4 * 3600 } }).score;
        expect(stale).toBeLessThan(fresh);
    });

    it('includes spread stability in the score when it is known', () => {
        const without = flip().scoreComponents;
        const with_ = flip({ stability: 0.9 }).scoreComponents;
        expect(without.some((c) => c.key === 'stability')).toBe(false);
        expect(with_.some((c) => c.key === 'stability')).toBe(true);
    });

    it('scores a taxed-away margin at zero', () => {
        const result = flip({ quote: { high: 1000, low: 995, highTime: NOW, lowTime: NOW } });
        expect(result.margin).toBeLessThan(0);
        expect(result.score).toBe(0);
    });
});
