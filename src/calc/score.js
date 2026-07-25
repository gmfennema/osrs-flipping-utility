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

/**
 * Below this much 24h flow on the thinner side, a quoted margin is not a
 * tradeable margin — you are reading two prints that happened hours apart.
 * Backtesting the F2P pool, dropping this gate cut mean profit per 48h cycle
 * from ~440k to ~107k and turned the worst cycle from +10k into -352k.
 */
export const MIN_TRADEABLE_THIN_VOLUME = 10_000;

/**
 * Spread durability, scored as a band rather than "more is better".
 *
 * The intuition that a spread which is *always* positive is the best kind is
 * wrong, and measurably so. Items whose post-tax spread is positive in over 90%
 * of intervals are the mega-liquid ones — runes and ores where the spread has
 * been arbitraged down to nothing. Requiring that as a virtue selected exactly
 * those items and turned a +440k/cycle strategy into -36k/cycle with a 42% win
 * rate. Meanwhile a spread positive under 25% of the time really is noise
 * (median outcome -1.67%).
 *
 * So the useful zone is the middle: reliable enough to repeat, wide enough to
 * be worth repeating.
 */
export function durabilityScore(stability) {
    if (stability === null || stability === undefined || !Number.isFinite(stability)) return null;
    const s = clamp01(stability);
    const PEAK = 0.7;
    if (s <= PEAK) return linScore(s, 0.05, PEAK);
    // Taper past the peak instead of rewarding it — never below 0.45, because
    // an always-positive spread is still better than a mostly-negative one.
    return clamp01(1 - ((s - PEAK) / (1 - PEAK)) * 0.55);
}

const WEIGHTS = {
    throughput: 0.28,
    liquidity: 0.26,
    freshness: 0.14,
    margin: 0.12,
    balance: 0.10,
    stability: 0.10
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
    stability: 'Spread durability — best in the middle, not at the extremes'
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
        stability: durabilityScore(input.stability)
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
    if (input.roi <= 0) return { score: 0, components };

    /*
     * Illiquidity is a veto, not a deduction.
     *
     * As a weighted component, thin flow could always be outvoted by a large
     * quoted margin — which is precisely backwards, because a large quoted
     * margin on a thin item is the *symptom* of two stale prints rather than a
     * real opportunity. That is how a 286gp "margin" on an item that last
     * traded 15 hours ago reaches the top of the list.
     */
    const thin = input.minSideVolume ?? 0;
    const gate = thin >= MIN_TRADEABLE_THIN_VOLUME
        ? 1
        : clamp01(0.15 + 0.85 * (thin / MIN_TRADEABLE_THIN_VOLUME) ** 2);

    const score = Math.round(weighted * gate * 100);
    return { score: Math.min(100, Math.max(0, score)), components };
}
