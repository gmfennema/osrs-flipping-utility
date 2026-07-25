import { describe, it, expect } from 'vitest';
import { hours, gpShort, signed, pct, relativeTime, MAX_DISPLAY_DAYS } from '../src/ui/format.js';

describe('hours', () => {
    it('shows sub-hour estimates in minutes', () => {
        expect(hours(0.5)).toBe('30m');
        expect(hours(0.05)).toBe('3m');
        // Never round a real wait down to "0m".
        expect(hours(0.001)).toBe('1m');
    });

    it('shows same-day estimates in hours', () => {
        expect(hours(1)).toBe('1.0h');
        expect(hours(4)).toBe('4.0h');
        expect(hours(23.9)).toBe('23.9h');
    });

    // Previously everything past a day collapsed to ">24h", which hid the
    // difference between a two-day flip and a two-month one.
    it('shows multi-day estimates in days', () => {
        expect(hours(24)).toBe('1.0d');
        expect(hours(36)).toBe('1.5d');
        expect(hours(84)).toBe('3.5d');
    });

    it('drops the decimal past ten days', () => {
        expect(hours(240)).toBe('10d');
        expect(hours(650)).toBe('27d');
    });

    it('caps at fifty days', () => {
        expect(hours(50 * 24)).toBe('50d');
        expect(hours(51 * 24)).toBe(`>${MAX_DISPLAY_DAYS}d`);
        expect(hours(5000)).toBe('>50d');
    });

    it('marks a dead book as infinite', () => {
        expect(hours(Infinity)).toBe('∞');
        expect(hours(NaN)).toBe('∞');
    });
});

describe('gpShort', () => {
    it('compacts large values', () => {
        expect(gpShort(1_500_000_000)).toBe('1.50b');
        expect(gpShort(24_650_000)).toBe('24.65m');
        expect(gpShort(340_000)).toBe('340k');
        expect(gpShort(1500)).toBe('1.5k');
        expect(gpShort(812)).toBe('812');
    });

    it('keeps the sign', () => {
        expect(gpShort(-24_650_000)).toBe('-24.65m');
    });
});

describe('signed / pct', () => {
    it('prefixes positives with a plus', () => {
        expect(signed(80)).toBe('+80');
        expect(signed(-80)).toBe('-80');
        expect(pct(2.5)).toBe('+2.50%');
        expect(pct(-2.5)).toBe('-2.50%');
    });

    it('falls back for non-numbers', () => {
        expect(signed(NaN)).toBe('--');
        expect(pct(Infinity)).toBe('--');
    });
});

describe('relativeTime', () => {
    it('scales the unit to the age', () => {
        expect(relativeTime(30)).toBe('30s ago');
        expect(relativeTime(240)).toBe('4m ago');
        expect(relativeTime(7200)).toBe('2.0h ago');
        expect(relativeTime(172800)).toBe('2d ago');
    });
});
