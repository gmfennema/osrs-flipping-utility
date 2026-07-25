import { describe, it, expect } from 'vitest';
import {
    splitVolume, volumeBalance, affordableQty, estimateFillHours, analyzeFlip,
    BUY_LIMIT_WINDOW_HOURS, DEFAULT_MARKET_SHARE
} from '../src/calc/liquidity.js';

describe('splitVolume', () => {
    it('maps high-price volume to your sell side and low-price to your buy side', () => {
        const result = splitVolume({ highPriceVolume: 300, lowPriceVolume: 700 });
        expect(result.sellSide).toBe(300);
        expect(result.buySide).toBe(700);
        expect(result.total).toBe(1000);
    });

    it('treats a missing record as zero', () => {
        expect(splitVolume(undefined)).toEqual({ buySide: 0, sellSide: 0, total: 0 });
    });
});

describe('volumeBalance', () => {
    it('scores an even book at 1', () => {
        expect(volumeBalance({ highPriceVolume: 500, lowPriceVolume: 500 })).toBe(1);
    });

    it('scores a one-sided dump near 0', () => {
        expect(volumeBalance({ highPriceVolume: 5, lowPriceVolume: 9995 })).toBeCloseTo(0.001, 3);
    });

    it('scores no volume at 0', () => {
        expect(volumeBalance({ highPriceVolume: 0, lowPriceVolume: 0 })).toBe(0);
    });
});

describe('affordableQty', () => {
    it('is capped by the buy limit when capital is plentiful', () => {
        expect(affordableQty({ capital: 1e9, buyLimit: 13000, buyPrice: 100 }))
            .toEqual({ qty: 13000, boundBy: 'limit' });
    });

    it('is capped by capital when the bankroll is small', () => {
        expect(affordableQty({ capital: 100_000, buyLimit: 13000, buyPrice: 100 }))
            .toEqual({ qty: 1000, boundBy: 'capital' });
    });

    it('reports both when they coincide', () => {
        expect(affordableQty({ capital: 1000, buyLimit: 10, buyPrice: 100 }).boundBy).toBe('both');
    });

    it('treats null capital as unlimited', () => {
        expect(affordableQty({ capital: null, buyLimit: 50, buyPrice: 1e6 }).qty).toBe(50);
    });

    it('returns zero when a single unit is unaffordable', () => {
        expect(affordableQty({ capital: 500, buyLimit: 10, buyPrice: 1000 }).qty).toBe(0);
    });
});

describe('estimateFillHours', () => {
    it('divides the quantity by your share of hourly flow', () => {
        // 1000 units, 5000/h flowing, 20% share = 1000/h captured = 1 hour.
        expect(estimateFillHours({ qty: 1000, hourlyVolume: 5000, marketShare: 0.2 })).toBe(1);
    });

    it('is infinite when nothing is flowing', () => {
        expect(estimateFillHours({ qty: 100, hourlyVolume: 0 })).toBe(Infinity);
    });

    it('is zero for nothing to trade', () => {
        expect(estimateFillHours({ qty: 0, hourlyVolume: 0 })).toBe(0);
    });
});

describe('analyzeFlip', () => {
    const liquidVolume = { highPriceVolume: 480_000, lowPriceVolume: 480_000 }; // 20k/h each side

    it('computes profit per cycle as margin x quantity', () => {
        const result = analyzeFlip({
            margin: 5, buyPrice: 100, buyLimit: 13000,
            volume24h: liquidVolume, capital: null
        });
        expect(result.qty).toBe(13000);
        expect(result.cycleProfit).toBe(65_000);
        expect(result.capitalRequired).toBe(1_300_000);
    });

    it('floors the cycle at the 4h limit reset when limit-bound', () => {
        const result = analyzeFlip({
            margin: 5, buyPrice: 100, buyLimit: 100,
            volume24h: liquidVolume, capital: null
        });
        // 100 units at 4000/h captured fills in minutes, but the limit gates it.
        expect(result.boundBy).toBe('limit');
        expect(result.cycleHours).toBe(BUY_LIMIT_WINDOW_HOURS);
        expect(result.gpPerHour).toBe(500 / BUY_LIMIT_WINDOW_HOURS);
    });

    it('does not apply the 4h floor when capital is the constraint', () => {
        const result = analyzeFlip({
            margin: 5, buyPrice: 100, buyLimit: 13000,
            volume24h: liquidVolume, capital: 10_000
        });
        expect(result.boundBy).toBe('capital');
        expect(result.qty).toBe(100);
        expect(result.cycleHours).toBeLessThan(BUY_LIMIT_WINDOW_HOURS);
    });

    it('reports an infinite cycle when one side of the book is dead', () => {
        const result = analyzeFlip({
            margin: 50, buyPrice: 1000, buyLimit: 100,
            volume24h: { highPriceVolume: 0, lowPriceVolume: 100_000 },
            capital: null
        });
        expect(result.sellFillHours).toBe(Infinity);
        expect(result.cycleHours).toBe(Infinity);
        expect(result.gpPerHour).toBe(0);
    });

    it('scales throughput with capital', () => {
        const small = analyzeFlip({ margin: 5, buyPrice: 100, buyLimit: 13000, volume24h: liquidVolume, capital: 100_000 });
        const large = analyzeFlip({ margin: 5, buyPrice: 100, buyLimit: 13000, volume24h: liquidVolume, capital: 1_000_000 });
        expect(large.cycleProfit).toBeGreaterThan(small.cycleProfit);
    });

    it('uses the documented default market share', () => {
        expect(DEFAULT_MARKET_SHARE).toBe(0.2);
        const result = analyzeFlip({ margin: 1, buyPrice: 10, buyLimit: 4000, volume24h: liquidVolume, capital: null });
        // 4000 units / (20000/h * 0.2) = 1h per side.
        expect(result.buyFillHours).toBe(1);
        expect(result.sellFillHours).toBe(1);
    });
});
