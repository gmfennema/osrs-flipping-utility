/**
 * Candidate shortlisting from bulk data.
 *
 * The edge model needs per-item 6h history, which costs one request each. The
 * F2P pool alone is ~820 items and the whole game is ~4,200, so measuring
 * everything would be rude to the wiki and slow for you; the bulk endpoints
 * (`/latest`, `/24h`) narrow it first.
 *
 * The shortlist is deliberately over-inclusive. It exists to bound the request
 * count, not to make judgements — every real decision happens later against
 * measured history. Two things keep it from quietly hiding good trades:
 *
 *   1. `/latest` *overstates* the achievable spread (systematically, and worse
 *      the thinner the item), so using it as an upper-bound screen only ever
 *      lets extra candidates through. It cannot filter out a genuine flip.
 *   2. The list is a union of "best apparent spread" and "most traded", so the
 *      liquid staples — runes, ores, logs, food — are always evaluated even
 *      when their apparent spread rounds to nothing.
 */

import { normalizeQuote, marginFor } from './pricing.js';
import { splitVolume } from './liquidity.js';
import { EDGE_CONFIG } from './edge.js';

export const SHORTLIST_CONFIG = {
    /** Candidates taken by apparent spread. */
    bySpread: 50,
    /** Candidates taken by raw traded volume, so staples are never missed. */
    byVolume: 40,
    /**
     * Both counts above were sized against the F2P pool. A members-inclusive
     * pool is about five times larger, so holding the funnel at 90 slots would
     * mean the plan sees a *smaller* share of a bigger market — the two rankings
     * would be dominated by the same handful of extremes and the plan would have
     * fewer distinct items to spread 40 positions across.
     *
     * The cost of widening is exactly one request per extra candidate, so this
     * is deliberately a modest bump rather than proportional: 135 requests at a
     * concurrency of four, not 450.
     */
    largePoolFactor: 1.5,
    /**
     * 24h volume floor. The real gate is 20k units per 48h measured from
     * history; 8k over 24h is a deliberately loose proxy for it, set low
     * enough that nothing which would survive the real gate gets cut here.
     */
    minVolume24h: 8_000,
    /** Skip items too small to be worth an order slot at all. */
    minPositionGp: 20_000
};

/**
 * @param {object} args
 * @param {Array} args.items Mapping rows.
 * @param {object} args.latestPrices Raw `/latest` map.
 * @param {object} args.volume24h Raw `/24h` map.
 * @param {number} args.capital
 * @param {'f2p'|'p2p'|'all'} [args.pool]
 * @returns {Array<{item: object, quote: object, apparentSpread: number, volume: number}>}
 */
export function shortlist({
    items,
    latestPrices,
    volume24h,
    capital,
    pool = 'all',
    config = SHORTLIST_CONFIG,
    edgeConfig = EDGE_CONFIG
}) {
    const viable = [];

    for (const item of items) {
        if (pool === 'f2p' && item.members) continue;
        if (pool === 'p2p' && !item.members) continue;

        const quote = normalizeQuote(latestPrices?.[item.id]);
        if (!quote || !quote.high || !quote.low) continue;
        if (quote.low > capital) continue;

        const volume = splitVolume(volume24h?.[item.id]).total;
        if (volume < config.minVolume24h) continue;

        // Can this item hold a position worth bothering with?
        const limit = Number.isFinite(item.limit) && item.limit > 0 ? item.limit : Infinity;
        const absorb = Math.min(limit * edgeConfig.limitWindows, volume * edgeConfig.maxFlowShare);
        if (absorb * quote.low < config.minPositionGp) continue;

        const { roi } = marginFor(quote.high, quote.low);
        viable.push({ item, quote, apparentSpread: roi, volume });
    }

    const widen = pool === 'f2p' ? 1 : (config.largePoolFactor ?? 1);
    const bySpread = [...viable].sort((a, b) => b.apparentSpread - a.apparentSpread)
        .slice(0, Math.round(config.bySpread * widen));
    const byVolume = [...viable].sort((a, b) => b.volume - a.volume)
        .slice(0, Math.round(config.byVolume * widen));

    const seen = new Set();
    const merged = [];
    for (const row of [...bySpread, ...byVolume]) {
        if (seen.has(row.item.id)) continue;
        seen.add(row.item.id);
        merged.push(row);
    }
    return merged;
}
