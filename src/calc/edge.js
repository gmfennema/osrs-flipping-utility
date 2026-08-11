/**
 * Sustained-market metrics — the inputs the ranking actually trusts.
 *
 * Why this module exists at all: `/latest` is a single pair of last-trade
 * prints, and on a thin item those two prints can be hours apart and nowhere
 * near each other. Measured across the F2P universe, the spread implied by
 * `/latest` overstates the spread you can actually repeat by a median of
 * 10.4 percentage points on items trading under 5k units/48h, and the error
 * shrinks monotonically with liquidity (0.85pp on items above 1m/48h).
 *
 * That single bias is what puts dead cosmetics and stale arrow prices at the
 * top of a naive margin ranking. Everything here is computed from 6h
 * timeseries buckets instead, so a "margin" only counts if the market printed
 * both sides of it repeatedly.
 *
 * Parameters were fitted on 91 days of 6h history for the tradeable F2P
 * universe and checked on a held-out second half; see `docs/EDGE.md`.
 */

import { netSellPrice } from './pricing.js';

/** 6h buckets in the short (7 day) statistics window. */
export const TRAIL_BUCKETS = 28;
/** 6h buckets in the long (30 day) range window used for percentile rank. */
export const RANGE_BUCKETS = 120;
/** Buckets in a 48h holding period. */
export const HORIZON_BUCKETS = 8;

/**
 * A bucket only counts when the market printed both sides of it.
 * A one-sided bucket has an avgHighPrice with no avgLowPrice (or vice versa),
 * which makes any spread computed from it fictional. An inverted bucket
 * (low > high) is bad data outright and shows up on sub-5gp items.
 */
export function cleanBucket(point) {
    const high = point?.avgHighPrice;
    const low = point?.avgLowPrice;
    if (typeof high !== 'number' || typeof low !== 'number') return null;
    if (high <= 0 || low <= 0) return null;
    if (low > high) return null;
    const sellFlow = point.highPriceVolume || 0;
    const buyFlow = point.lowPriceVolume || 0;
    if (sellFlow <= 0 || buyFlow <= 0) return null;

    return {
        ts: point.timestamp,
        high: Math.round(high),
        low: Math.round(low),
        mid: (high + low) / 2,
        sellFlow,   // units bought instantly by others — fills YOUR sell offer
        buyFlow,    // units sold instantly by others — fills YOUR buy offer
        volume: sellFlow + buyFlow
    };
}

export function cleanSeries(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
        .filter((row) => typeof row?.timestamp === 'number')
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(cleanBucket)
        .filter(Boolean);
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdev(values) {
    if (values.length < 2) return 0;
    const mu = mean(values);
    return Math.sqrt(values.reduce((sum, v) => sum + (v - mu) ** 2, 0) / (values.length - 1));
}

/** Post-tax spread of one bucket as a fraction of its mid price. */
export function bucketSpread(bucket) {
    return (netSellPrice(bucket.high) - bucket.low) / bucket.mid;
}

/**
 * Cheapest whole-gp ask that clears at least `minProfit` after tax over `bid`.
 *
 * Below 50gp the GE takes nothing, so a single tick is pure profit — a 1gp
 * tick on a 5gp rune is a 20% return. At and above 50gp the 2% cut means one
 * tick is a *loss*, and you need the ask to be ~2% clear of the bid before the
 * flip breaks even at all. Returns null when no sane ask works.
 */
export function askFor(bid, minProfit = 1) {
    if (!Number.isFinite(bid) || bid <= 0) return null;
    const ceiling = bid + Math.ceil(bid * 0.5) + 60;
    for (let ask = bid + 1; ask <= ceiling; ask++) {
        if (netSellPrice(ask) - bid >= minProfit) return ask;
    }
    return null;
}

/**
 * Share of all price movement concentrated in the few largest single moves.
 *
 * An item at 0.8 spends almost all its time flat and does everything in two or
 * three sudden jumps. Those are real moves, but they are unschedulable: on a
 * fixed 24-48h cycle you hold dead money through the flat stretch and the jump
 * lands whenever it lands. Items in the smooth tail (Coal, Iron ore, Gold bar,
 * Mithril ore, around 0.07) move continuously and can be traded on a routine.
 */
export function jumpConcentration(buckets, topN = 5) {
    if (buckets.length < topN * 3) return null;
    const moves = [];
    for (let i = 1; i < buckets.length; i++) {
        const previous = buckets[i - 1].mid;
        if (previous > 0) moves.push(Math.abs((buckets[i].mid - previous) / previous));
    }
    const total = moves.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const top = [...moves].sort((a, b) => b - a).slice(0, topN).reduce((a, b) => a + b, 0);
    return top / total;
}

/**
 * Everything the ranking needs about one item, from its 6h history.
 *
 * @param {Array} rows Raw wiki `/timeseries?timestep=6h` rows.
 * @returns {object|null} null when there is not enough clean history to judge.
 */
export function computeEdge(rows) {
    const series = cleanSeries(rows);
    if (series.length < 12) return null;

    const trail = series.slice(-TRAIL_BUCKETS);
    const range = series.slice(-RANGE_BUCKETS);
    const latest = series[series.length - 1];

    const trailMids = trail.map((b) => b.mid);
    const rangeMids = range.map((b) => b.mid);
    const spreads = trail.map(bucketSpread);

    const lowest = Math.min(...rangeMids);
    const highest = Math.max(...rangeMids);
    const mu = mean(trailMids);
    const sigma = stdev(trailMids);

    // Expected flow on the thinner side over a 48h hold. The 0.5 assumes an
    // even split; sizing later uses the measured split instead, but the gate
    // only needs the order of magnitude.
    const perBucketVolume = mean(trail.map((b) => b.volume));
    const flow48h = perBucketVolume * HORIZON_BUCKETS;

    const buyFlow48h = mean(trail.map((b) => b.buyFlow)) * HORIZON_BUCKETS;
    const sellFlow48h = mean(trail.map((b) => b.sellFlow)) * HORIZON_BUCKETS;

    const at = (bucketsBack) => {
        const index = series.length - 1 - bucketsBack;
        return index >= 0 ? series[index].mid : null;
    };
    const changeOver = (bucketsBack) => {
        const then = at(bucketsBack);
        return then && then > 0 ? (latest.mid - then) / then : null;
    };

    return {
        samples: series.length,
        trailSamples: trail.length,
        lastTs: latest.ts,

        // Prices the backtest actually traded: bid at the recent low print,
        // ask at the recent high print.
        bid: latest.low,
        ask: latest.high,
        mid: latest.mid,

        /**
         * Trailing high prints, kept so a proposed ask can be checked against
         * the levels this item has actually reached. This is the same test the
         * backtest used to decide whether a sell offer filled.
         */
        trailHighs: trail.map((b) => b.high),

        /** Post-tax spread of the most recent complete bucket, as a fraction. */
        spreadNow: bucketSpread(latest),
        /** Typical post-tax spread over the trailing week. */
        medSpread: median(spreads),
        /**
         * How often the post-tax spread is positive. Reported for context only.
         * Gating on it *hurts*: items whose spread is positive 90%+ of the time
         * are the mega-liquid ones where the spread rounds to zero, and forcing
         * that gate turned a +440k/cycle strategy into -36k/cycle in backtest.
         */
        posSpreadRatio: spreads.filter((s) => s > 0).length / spreads.length,

        /** Where today sits inside the 30d range: 0 = the low, 1 = the high. */
        pctRank: highest > lowest ? (latest.mid - lowest) / (highest - lowest) : 0.5,
        zScore: sigma > 0 ? (latest.mid - mu) / sigma : 0,
        rangeLow: lowest,
        rangeHigh: highest,

        change24h: changeOver(4),
        change48h: changeOver(8),
        change7d: changeOver(28),

        flow48h,
        buyFlow48h,
        sellFlow48h,
        thinFlow48h: Math.min(buyFlow48h, sellFlow48h),

        /**
         * Coefficient of variation of the mid over the trailing week. Needs to
         * sit in a band: below ~0.02 there is no movement to harvest at all
         * (backtest: -78k/cycle, 27% win rate), above ~0.25 the item is too
         * erratic to schedule around.
         */
        cv: mu > 0 ? sigma / mu : 0,
        jumpiness: jumpConcentration(series)
    };
}

/**
 * Share of recent intervals in which the market's high print reached `ask`.
 *
 * This is a fill probability, measured rather than assumed, and it is the same
 * condition the backtest used to decide whether a sell offer completed. It is
 * deliberately kept out of the ranking — weighting candidates by fill
 * probability was tested and mildly *reduced* returns, because it biases toward
 * items whose spread is narrow enough to always fill. It is used only to report
 * an honest expected profit instead of a best case.
 */
export function askReachRatio(edge, ask) {
    const highs = edge?.trailHighs;
    if (!Array.isArray(highs) || !highs.length) return null;
    return highs.filter((high) => high >= ask).length / highs.length;
}

/** Tuned on 91d of F2P history, verified on a held-out half. */
export const EDGE_CONFIG = {
    /** Minimum units traded over 48h. The single highest-impact filter. */
    minFlow48h: 20_000,
    /** Above this the item is too erratic to hold on a schedule. */
    maxCv: 0.25,
    /** Skip anything that has already run this far in a week. */
    maxRunUp7d: 0.30,
    /** Weight on the current spread vs the trailing-week median spread. */
    spreadNowWeight: 0.75,
    /** Strength of the buy-the-dip tilt: multiplier is (dipTilt - pctRank). */
    dipTilt: 1.2,
    /** Never take more than this share of realised flow on the thin side. */
    maxFlowShare: 0.10,
    /** Never put more than this share of the bankroll into one item. */
    maxBankrollShare: 0.15,
    /**
     * Positions to hold at once. F2P buy limits make breadth mandatory; on a
     * members pool `maxFlowShare` and `maxBankrollShare` above enforce it
     * instead, since a single members item can absorb a whole bankroll.
     */
    maxPositions: 40,
    /** Buy-limit windows you expect to use inside the hold. 48h allows 12. */
    limitWindows: 2,
    /**
     * Do not bother with a position this small. Without a floor the allocator
     * spends the last few thousand gp on a one-unit order worth 1gp, which costs
     * an order slot and your attention for nothing.
     */
    minPositionGp: 10_000
};

/**
 * Reasons an item is not worth holding for 48h. Empty array = tradeable.
 * Returned as strings so the UI can explain a rejection instead of silently
 * dropping the row.
 */
export function edgeVetoes(edge, config = EDGE_CONFIG) {
    const vetoes = [];
    if (!edge) return ['no usable history'];
    if (edge.trailSamples < 12) vetoes.push('under 3 days of two-sided prints');
    if (edge.flow48h < config.minFlow48h) {
        vetoes.push(`only ~${Math.round(edge.flow48h).toLocaleString()} units trade per 48h`);
    }
    if (edge.cv > config.maxCv) vetoes.push('price too erratic to schedule');
    if (edge.change7d !== null && edge.change7d > config.maxRunUp7d) {
        vetoes.push(`already up ${(edge.change7d * 100).toFixed(0)}% this week`);
    }
    if (edge.spreadNow <= 0 && edge.medSpread <= 0) vetoes.push('no post-tax spread to capture');
    return vetoes;
}

/**
 * Expected return per gp of capital over one 48h hold.
 *
 * Blending the current spread with the trailing median is what makes this
 * robust: the current spread carries most of the signal about what is
 * available right now, and the median stops a single wide print from
 * dominating. The dip tilt contributes little to the average return but
 * reliably improves the worst case, because a 30d trend above +20% mean-reverts
 * (median next-48h move -2.2%, only 36% of those periods positive).
 */
export function edgeRate(edge, config = EDGE_CONFIG) {
    if (!edge) return 0;
    const blended = config.spreadNowWeight * edge.spreadNow
        + (1 - config.spreadNowWeight) * edge.medSpread;
    if (blended <= 0) return 0;
    return blended * Math.max(0.05, config.dipTilt - edge.pctRank);
}

/**
 * 0..100 presentation score. Monotone in `edgeRate`, so it never disagrees
 * with the ranking. 6% expected return on capital over 48h pins the top.
 */
export function edgeScore(edge, config = EDGE_CONFIG) {
    const rate = edgeRate(edge, config);
    if (rate <= 0) return 0;
    return Math.max(1, Math.min(100, Math.round((rate / 0.06) * 100)));
}
