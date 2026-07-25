import { describe, it, expect } from 'vitest';
import { diffQuotes } from '../src/refresh.js';

describe('diffQuotes', () => {
    it('reports ids whose buy or sell price moved', () => {
        const before = { 1: { high: 100, low: 90 }, 2: { high: 50, low: 40 } };
        const after = { 1: { high: 105, low: 90 }, 2: { high: 50, low: 40 } };
        expect([...diffQuotes(before, after)]).toEqual([1]);
    });

    it('treats a newly listed item as changed', () => {
        expect([...diffQuotes({}, { 7: { high: 1, low: 1 } })]).toEqual([7]);
    });

    it('reports nothing when the snapshot is identical', () => {
        const snapshot = { 1: { high: 100, low: 90 } };
        expect(diffQuotes(snapshot, { ...snapshot }).size).toBe(0);
    });

    it('notices a move on the buy side alone', () => {
        const before = { 3: { high: 100, low: 90 } };
        const after = { 3: { high: 100, low: 95 } };
        expect([...diffQuotes(before, after)]).toEqual([3]);
    });

    it('returns numeric ids, not the string keys the API hands back', () => {
        const changed = diffQuotes({}, { 561: { high: 1, low: 1 } });
        expect(changed.has(561)).toBe(true);
        expect(changed.has('561')).toBe(false);
    });
});
