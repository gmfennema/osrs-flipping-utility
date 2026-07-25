import { describe, it, expect } from 'vitest';
import { computeScore, freshnessScore, logScore, linScore } from '../src/calc/score.js';

const healthy = {
    gpPerHour: 1_000_000,
    minSideVolume: 200_000,
    roi: 3,
    balance: 0.9,
    quoteAgeSeconds: 60,
    stability: 0.9
};

describe('logScore / linScore', () => {
    it('clamps to the ends of the range', () => {
        expect(logScore(50, 100, 1000)).toBe(0);
        expect(logScore(5000, 100, 1000)).toBe(1);
        expect(linScore(-5, 0, 10)).toBe(0);
        expect(linScore(50, 0, 10)).toBe(1);
    });

    it('interpolates on the log scale', () => {
        expect(logScore(1000, 100, 10_000)).toBeCloseTo(0.5, 6);
    });
});

describe('freshnessScore', () => {
    it('is full inside five minutes', () => {
        expect(freshnessScore(0)).toBe(1);
        expect(freshnessScore(300)).toBe(1);
    });

    it('is zero past six hours', () => {
        expect(freshnessScore(6 * 3600)).toBe(0);
        expect(freshnessScore(48 * 3600)).toBe(0);
    });

    it('decays in between', () => {
        const oneHour = freshnessScore(3600);
        expect(oneHour).toBeGreaterThan(0);
        expect(oneHour).toBeLessThan(1);
        expect(freshnessScore(1800)).toBeGreaterThan(oneHour);
    });
});

describe('computeScore', () => {
    it('rates a healthy flip highly', () => {
        expect(computeScore(healthy).score).toBeGreaterThan(75);
    });

    it('zeroes anything with no post-tax margin', () => {
        expect(computeScore({ ...healthy, roi: 0 }).score).toBe(0);
        expect(computeScore({ ...healthy, roi: -2 }).score).toBe(0);
    });

    // The old score could not see any of these.
    it('penalises a stale quote', () => {
        const fresh = computeScore(healthy).score;
        const stale = computeScore({ ...healthy, quoteAgeSeconds: 5 * 3600 }).score;
        expect(stale).toBeLessThan(fresh);
    });

    it('penalises a one-sided book', () => {
        const balanced = computeScore(healthy).score;
        const lopsided = computeScore({ ...healthy, balance: 0.02 }).score;
        expect(lopsided).toBeLessThan(balanced);
    });

    it('penalises a fragile spread', () => {
        const durable = computeScore(healthy).score;
        const fragile = computeScore({ ...healthy, stability: 0.05 }).score;
        expect(fragile).toBeLessThan(durable);
    });

    /*
     * Spread durability is a band, not a ladder. Measured over 91 days of F2P
     * history, requiring a spread that is positive in over 90% of intervals
     * selects the mega-liquid items whose spread has been arbitraged to nothing,
     * and it turned a +440k/cycle strategy into -36k/cycle. So a perfectly
     * reliable spread has to score *below* a merely reliable one.
     */
    it('does not reward a perfectly reliable spread over a merely reliable one', () => {
        const useful = computeScore({ ...healthy, stability: 0.7 }).score;
        const suspiciouslyPerfect = computeScore({ ...healthy, stability: 1 }).score;
        expect(suspiciouslyPerfect).toBeLessThan(useful);
    });

    it('still prefers a reliable spread to a mostly-negative one', () => {
        const perfect = computeScore({ ...healthy, stability: 1 }).score;
        const noise = computeScore({ ...healthy, stability: 0.1 }).score;
        expect(perfect).toBeGreaterThan(noise);
    });

    /*
     * Illiquidity vetoes rather than deducts. A wide quoted margin on a thin
     * item is the symptom of two stale prints, so it must not be able to
     * outvote the thin volume that produced it.
     */
    it('gates thin items no matter how good every other component looks', () => {
        const liquid = computeScore({ ...healthy, minSideVolume: 200_000 }).score;
        const thin = computeScore({ ...healthy, minSideVolume: 400, roi: 200 }).score;
        expect(thin).toBeLessThan(liquid * 0.4);
    });

    it('applies no liquidity penalty once the item genuinely trades', () => {
        const atGate = computeScore({ ...healthy, minSideVolume: 10_000 });
        const wellOver = computeScore({ ...healthy, minSideVolume: 10_001 });
        expect(atGate.score).toBe(wellOver.score);
    });

    it('penalises low throughput even when volume is huge', () => {
        const high = computeScore(healthy).score;
        const low = computeScore({ ...healthy, gpPerHour: 5_000 }).score;
        expect(low).toBeLessThan(high);
    });

    it('drops missing components and renormalises the weights', () => {
        const withStability = computeScore(healthy);
        const withoutStability = computeScore({ ...healthy, stability: null });

        expect(withStability.components).toHaveLength(6);
        expect(withoutStability.components).toHaveLength(5);

        const totalWeight = withoutStability.components.reduce((sum, c) => sum + c.weight, 0);
        expect(totalWeight).toBeCloseTo(1, 6);
        expect(withoutStability.components.some((c) => c.key === 'stability')).toBe(false);
    });

    it('keeps the score inside 0..100', () => {
        // stability sits at the peak of the durability band; 1.0 deliberately
        // scores lower, so it could never reach 100.
        const maxed = computeScore({
            gpPerHour: 1e12, minSideVolume: 1e9, roi: 500, balance: 1,
            quoteAgeSeconds: 0, stability: 0.7
        });
        expect(maxed.score).toBe(100);

        const absurd = computeScore({
            gpPerHour: 1e18, minSideVolume: 1e15, roi: 1e6, balance: 5,
            quoteAgeSeconds: 0, stability: 0.7
        });
        expect(absurd.score).toBeLessThanOrEqual(100);
    });

    it('exposes a labelled breakdown that sums to the score', () => {
        const { score, components } = computeScore(healthy);
        const summed = components.reduce((sum, c) => sum + c.contribution, 0);
        expect(Math.round(summed)).toBe(score);
        components.forEach((c) => {
            expect(c.label).toBeTruthy();
            expect(c.note).toBeTruthy();
        });
    });
});
