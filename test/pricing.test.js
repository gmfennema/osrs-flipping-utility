import { describe, it, expect } from 'vitest';
import { geTax, netSellPrice, normalizeQuote, marginFor, parseGp, GE_TAX_CAP } from '../src/calc/pricing.js';

describe('geTax', () => {
    it('charges nothing below the 50gp threshold', () => {
        expect(geTax(49)).toBe(0);
        expect(geTax(1)).toBe(0);
    });

    it('charges 2% rounded down at and above the threshold', () => {
        expect(geTax(50)).toBe(1);
        expect(geTax(199)).toBe(3); // 3.98 floors to 3
        expect(geTax(1000)).toBe(20);
    });

    it('caps at 5m per item', () => {
        expect(geTax(1_700_000_000)).toBe(GE_TAX_CAP);
        expect(geTax(250_000_000)).toBe(GE_TAX_CAP);
        expect(geTax(249_000_000)).toBe(4_980_000);
    });

    it('ignores non-numeric input', () => {
        expect(geTax(null)).toBe(0);
        expect(geTax(undefined)).toBe(0);
        expect(geTax(NaN)).toBe(0);
    });
});

describe('netSellPrice', () => {
    it('returns the full price under the threshold', () => {
        expect(netSellPrice(49)).toBe(49);
    });

    it('deducts the tax above it', () => {
        expect(netSellPrice(1000)).toBe(980);
    });
});

describe('normalizeQuote', () => {
    it('leaves a well-formed quote alone', () => {
        const result = normalizeQuote({ high: 200, low: 180, highTime: 20, lowTime: 10 });
        expect(result).toMatchObject({ high: 200, low: 180, highTime: 20, lowTime: 10, inverted: false });
    });

    it('swaps an inverted quote and its timestamps', () => {
        const result = normalizeQuote({ high: 180, low: 200, highTime: 20, lowTime: 10 });
        expect(result.high).toBe(200);
        expect(result.low).toBe(180);
        // The 200 price came with lowTime, so it must carry that timestamp.
        expect(result.highTime).toBe(10);
        expect(result.lowTime).toBe(20);
        expect(result.inverted).toBe(true);
    });

    it('handles one-sided quotes', () => {
        expect(normalizeQuote({ high: 100, low: null }).low).toBe(100);
        expect(normalizeQuote({ high: null, low: 100 }).high).toBe(100);
    });

    it('returns null when there is nothing to work with', () => {
        expect(normalizeQuote(null)).toBeNull();
        expect(normalizeQuote({ high: null, low: null })).toBeNull();
    });
});

describe('marginFor', () => {
    it('nets out the tax before computing the margin', () => {
        const { netHigh, margin, roi } = marginFor(1000, 900);
        expect(netHigh).toBe(980);
        expect(margin).toBe(80);
        expect(roi).toBeCloseTo(8.888, 2);
    });

    it('reports a negative margin when the tax eats the spread', () => {
        expect(marginFor(1000, 990).margin).toBe(-10);
    });
});

describe('parseGp', () => {
    it('parses shorthand suffixes', () => {
        expect(parseGp('10m')).toBe(10_000_000);
        expect(parseGp('500k')).toBe(500_000);
        expect(parseGp('1.5b')).toBe(1_500_000_000);
        expect(parseGp('2.5M')).toBe(2_500_000);
    });

    it('parses plain and comma-separated numbers', () => {
        expect(parseGp('2000')).toBe(2000);
        expect(parseGp('1,250,000')).toBe(1_250_000);
        expect(parseGp(5000)).toBe(5000);
    });

    it('rejects junk', () => {
        expect(parseGp('')).toBeNull();
        expect(parseGp('abc')).toBeNull();
        expect(parseGp('10x')).toBeNull();
        expect(parseGp(null)).toBeNull();
    });
});
