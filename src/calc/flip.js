/**
 * Assembles one fully-derived flip row from the raw API pieces.
 * Both the Flip Finder table and the analyzer header go through this, so the
 * two views can never disagree about a margin.
 */

import { normalizeQuote, marginFor } from './pricing.js';
import { analyzeFlip, splitVolume } from './liquidity.js';
import { computeScore } from './score.js';

/** Seconds since the more stale of the two sides of the quote last traded. */
export function quoteAge(quote, now = Math.floor(Date.now() / 1000)) {
    const times = [quote?.highTime, quote?.lowTime].filter((t) => typeof t === 'number' && t > 0);
    if (times.length === 0) return null;
    return Math.max(0, now - Math.min(...times));
}

/**
 * @param {object} args
 * @param {object} args.item      Mapping row.
 * @param {object} args.quote     Raw `/latest` record.
 * @param {object} args.vol24     Raw `/24h` record.
 * @param {object} [args.vol1h]   Raw `/1h` record.
 * @param {number|null} [args.capital]
 * @param {number|null} [args.stability] 0..1 when a timeseries has been loaded.
 * @returns {object|null} null when the item has no usable quote.
 */
export function buildFlip({ item, quote, vol24, vol1h, capital = null, stability = null, now = Math.floor(Date.now() / 1000) }) {
    const normalized = normalizeQuote(quote);
    if (!normalized || !normalized.high || !normalized.low) return null;

    const { high, low } = normalized;
    const { netHigh, margin, roi } = marginFor(high, low);

    const { buySide, sellSide, total } = splitVolume(vol24);
    const minSideVolume = Math.min(buySide, sellSide);

    const economics = analyzeFlip({
        margin,
        buyPrice: low,
        buyLimit: item.limit,
        volume24h: vol24,
        capital
    });

    const ageSeconds = quoteAge(normalized, now);

    const { score, components } = computeScore({
        gpPerHour: economics.gpPerHour,
        minSideVolume,
        roi,
        balance: economics.balance,
        quoteAgeSeconds: ageSeconds,
        stability
    });

    const hourly1h = splitVolume(vol1h);

    return {
        id: item.id,
        name: item.name,
        icon: item.icon,
        limit: item.limit ?? null,
        members: item.members,

        high,
        low,
        netHigh,
        margin,
        roi,
        inverted: normalized.inverted,
        quoteAgeSeconds: ageSeconds,

        volume: total,
        buySideVolume: buySide,
        sellSideVolume: sellSide,
        minSideVolume,
        volume1h: hourly1h.total,
        balance: economics.balance,

        qty: economics.qty,
        boundBy: economics.boundBy,
        capitalRequired: economics.capitalRequired,
        cycleProfit: economics.cycleProfit,
        buyFillHours: economics.buyFillHours,
        sellFillHours: economics.sellFillHours,
        cycleHours: economics.cycleHours,
        gpPerHour: economics.gpPerHour,

        score,
        scoreComponents: components
    };
}
