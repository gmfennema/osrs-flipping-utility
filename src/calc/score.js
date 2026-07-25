/**
 * Flip score.
 *
 * The old score was `log10(volume) * 8 + min(roi, 10) * 4`, which knew nothing
 * about how recently the item traded, whether the two sides of the book were
 * balanced, whether the spread survives more than one tick, or whether you can
 * afford enough units for the margin to matter.
 *
 * This version is a weighted blend of named components, each normalised to
 * 0..1, so the number can be explained rather than just trusted. Components
 * that cannot be computed (stability needs a timeseries we do not fetch for
 * every row) are dropped and the remaining weights renormalised.
 */

export const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** Interpolate on a log10 scale between `floor` and `ceiling`. */
export function logScore(value, floor, ceiling) {
    if (!Number.isFinite(value) || value <= floor) return 0;
    if (value >= ceiling) return 1;
    return Math.log10(value / floor) / Math.log10(ceiling / floor);
}

/** Interpolate linearly between `floor` and `ceiling`. */
export function linScore(value, floor, ceiling) {
    if (!Number.isFinite(value)) return 0;
    return clamp01((value - floor) / (ceiling - floor));
}

/**
 * How much to trust a quote given how long ago it last traded.
 * Fresh inside 5 minutes, worthless past 6 hours, log decay between.
 */
export function freshnessScore(ageSeconds) {
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 0;
    const FRESH = 300;
    const DEAD = 6 * 3600;
    if (ageSeconds <= FRESH) return 1;
    if (ageSeconds >= DEAD) return 0;
    return clamp01(1 - Math.log(ageSeconds / FRESH) / Math.log(DEAD / FRESH));
}

const WEIGHTS = {
    throughput: 0.30,
    liquidity: 0.22,
    freshness: 0.18,
    margin: 0.12,
    balance: 0.10,
    stability: 0.08
};

const LABELS = {
    throughput: 'Throughput',
    liquidity: 'Liquidity',
    freshness: 'Freshness',
    margin: 'Margin',
    balance: 'Book balance',
    stability: 'Spread stability'
};

const NOTES = {
    throughput: 'Estimated gp/hour for your bankroll',
    liquidity: 'Thinner side of the order book, 24h',
    freshness: 'How recently the item actually traded',
    margin: 'Post-tax ROI per unit',
    balance: 'Buy flow vs sell flow — lopsided is a dump, not a flip',
    stability: 'Does the spread survive across intervals'
};

/**
 * @param {object} input
 * @param {number} input.gpPerHour     From analyzeFlip.
 * @param {number} input.minSideVolume 24h volume on the thinner side.
 * @param {number} input.roi           Post-tax ROI, percent.
 * @param {number} input.balance       0..1 from volumeBalance.
 * @param {number|null} input.quoteAgeSeconds Age of the most stale side of the quote.
 * @param {number|null} [input.stability] 0..1, omitted when no history is loaded.
 */
export function computeScore(input) {
    const raw = {
        // Floor at 1k rather than 10k so modest flips still get gradation
        // instead of all collapsing to zero on the heaviest-weighted component.
        throughput: logScore(input.gpPerHour, 1_000, 5_000_000),
        liquidity: logScore(input.minSideVolume, 100, 500_000),
        freshness: input.quoteAgeSeconds === null || input.quoteAgeSeconds === undefined
            ? null
            : freshnessScore(input.quoteAgeSeconds),
        margin: input.roi > 0 ? linScore(input.roi, 0, 5) : 0,
        balance: clamp01(input.balance ?? 0),
        stability: input.stability === null || input.stability === undefined
            ? null
            : clamp01(input.stability)
    };

    const present = Object.keys(WEIGHTS).filter((key) => raw[key] !== null);
    const totalWeight = present.reduce((sum, key) => sum + WEIGHTS[key], 0);
    if (totalWeight === 0) return { score: 0, components: [] };

    let weighted = 0;
    const components = present.map((key) => {
        const share = WEIGHTS[key] / totalWeight;
        weighted += raw[key] * share;
        return {
            key,
            label: LABELS[key],
            note: NOTES[key],
            value: raw[key],
            weight: share,
            contribution: raw[key] * share * 100
        };
    });

    // A flip that cannot make money is not a flip, whatever the volume says.
    const score = input.roi <= 0 ? 0 : Math.round(weighted * 100);

    return { score: Math.min(100, Math.max(0, score)), components };
}
