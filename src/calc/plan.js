/**
 * Bankroll allocation.
 *
 * The hard lesson from backtesting is that ranking is the easy half. A ranking
 * alone hands you the single best percentage opportunity, which on a 9m F2P
 * bankroll is usually an item whose buy limit caps you at 250k of exposure —
 * so you "win" on a rate that applies to 3% of your gold and the other 8.7m
 * earns nothing. Percentage-first rankings deployed as little as 185k of a 9m
 * bankroll in testing and returned a rounding error in absolute gp.
 *
 * So this is a knapsack, not a sort. Each item gets a capacity (what its buy
 * limit and its actual traded flow can absorb) and a rate (expected return per
 * gp). Capital fills by rate until it runs out. On F2P that means 25-40
 * simultaneous positions, which is the real reason the strategy works: no
 * single F2P item can absorb 9m, so breadth is not diversification garnish, it
 * is the mechanism.
 */

import { netSellPrice } from './pricing.js';
import { EDGE_CONFIG, edgeRate, edgeScore, edgeVetoes, askFor, askReachRatio } from './edge.js';

/** GE buy limits reset on a rolling 4h window. */
export const LIMIT_WINDOW_HOURS = 4;

/**
 * How many units this item can absorb over the hold, and what that costs.
 *
 * Two independent ceilings:
 *   - buy limit × the number of 4h windows you will actually be around for
 *   - a capped share of the flow that genuinely traded on the thinner side
 *
 * The flow ceiling is the one that matters. Removing it lets capital pile into
 * items that cannot absorb it, and in backtest that alone cut mean profit per
 * cycle from ~440k to ~107k and turned the worst cycle from +10k to -352k.
 */
export function capacityFor(edge, item, config = EDGE_CONFIG) {
    const limit = Number.isFinite(item?.limit) && item.limit > 0 ? item.limit : Infinity;
    const byLimit = limit * config.limitWindows;
    const byFlow = Math.floor(edge.thinFlow48h * config.maxFlowShare);
    const qty = Math.max(0, Math.min(byLimit, byFlow));
    return {
        qty,
        gp: qty * edge.bid,
        byLimit: Number.isFinite(byLimit) ? byLimit : null,
        byFlow,
        boundBy: byLimit <= byFlow ? 'limit' : 'flow'
    };
}

/**
 * The concrete order pair for one item: what to bid, what to ask, what each
 * unit clears after tax.
 *
 * The ask is the recent high print. When that does not clear a gp after tax —
 * which is the normal case for anything over 50gp with a one-tick spread — we
 * step up to the cheapest ask that does, and report it so the UI can say the
 * flip needs the price to move rather than pretending it is available now.
 */
export function orderPair(edge, minProfit = 1) {
    const bid = edge.bid;
    if (!Number.isFinite(bid) || bid <= 0) return null;

    const marketAsk = edge.ask;
    if (netSellPrice(marketAsk) - bid >= minProfit) {
        return { bid, ask: marketAsk, margin: netSellPrice(marketAsk) - bid, needsMove: false };
    }
    const stretched = askFor(bid, minProfit);
    if (stretched === null) return null;
    return {
        bid,
        ask: stretched,
        margin: netSellPrice(stretched) - bid,
        needsMove: true,
        movePct: ((stretched - marketAsk) / marketAsk) * 100
    };
}

/**
 * Build the full 48h buy plan.
 *
 * @param {object} args
 * @param {Array<{item: object, edge: object}>} args.candidates Items with computed edges.
 * @param {number} args.capital Bankroll in gp.
 * @param {object} [args.config]
 * @returns {{ positions: Array, skipped: Array, totals: object }}
 */
export function buildPlan({ candidates, capital, config = EDGE_CONFIG }) {
    const scored = [];
    const skipped = [];

    for (const { item, edge } of candidates) {
        if (!edge) continue;
        const vetoes = edgeVetoes(edge, config);
        if (vetoes.length) {
            skipped.push({ item, edge, reasons: vetoes });
            continue;
        }
        const rate = edgeRate(edge, config);
        if (rate <= 0) {
            skipped.push({ item, edge, reasons: ['no expected edge'] });
            continue;
        }
        const orders = orderPair(edge);
        if (!orders) {
            skipped.push({ item, edge, reasons: ['no ask clears the tax'] });
            continue;
        }
        const capacity = capacityFor(edge, item, config);
        if (capacity.qty <= 0) {
            skipped.push({ item, edge, reasons: ['cannot absorb a position'] });
            continue;
        }
        scored.push({ item, edge, rate, orders, capacity, score: edgeScore(edge, config) });
    }

    scored.sort((a, b) => b.rate - a.rate);

    const perItemCap = capital * config.maxBankrollShare;
    const positions = [];
    let remaining = capital;

    for (const candidate of scored) {
        if (positions.length >= config.maxPositions) break;
        if (remaining < candidate.orders.bid) continue;

        const budget = Math.min(candidate.capacity.gp, remaining, perItemCap);
        const qty = Math.floor(budget / candidate.orders.bid);
        if (qty <= 0) continue;

        const spend = qty * candidate.orders.bid;
        if (spend < config.minPositionGp) continue;

        const grossProfit = qty * candidate.orders.margin;
        /*
         * Discount by how often this item's high print has actually reached the
         * ask. Reporting the undiscounted figure overstates the plan by roughly
         * a third against backtest — the gross number assumes every sell offer
         * completes inside the hold, and in testing 60-90% of them did.
         */
        const fillProbability = askReachRatio(candidate.edge, candidate.orders.ask);

        /*
         * Drop an ask the market has not reached even once in the trailing week:
         * that is not a long shot, it is a position that ties up gold and an
         * order slot for a mathematically certain nothing.
         *
         * Note the asymmetry — this is the *only* fill-rate filter applied, and
         * deliberately so. Requiring a higher fill rate steadily destroys
         * returns (4.88% -> 3.76% per cycle at a 70% threshold, consistent
         * across both fill models and the held-out half) because reliable fills
         * and wide spreads are opposites. Wide-spread, low-fill positions are
         * positive expectation and belong in the plan.
         */
        if (fillProbability === 0) {
            skipped.push({ item: candidate.item, edge: candidate.edge, reasons: ['ask never reached this week'] });
            continue;
        }

        const profit = fillProbability === null ? grossProfit : grossProfit * fillProbability;

        positions.push({
            ...candidate,
            qty,
            spend,
            profit,
            grossProfit,
            fillProbability,
            // Which of the three ceilings actually bound this position.
            boundBy: qty === Math.floor(candidate.capacity.gp / candidate.orders.bid)
                ? candidate.capacity.boundBy
                : (budget === perItemCap ? 'concentration' : 'capital'),
            roiPct: (candidate.orders.margin / candidate.orders.bid) * 100
        });
        remaining -= spend;
    }

    const deployed = positions.reduce((sum, p) => sum + p.spend, 0);
    const expected = positions.reduce((sum, p) => sum + p.profit, 0);
    const gross = positions.reduce((sum, p) => sum + p.grossProfit, 0);

    return {
        positions,
        skipped,
        totals: {
            deployed,
            idle: capital - deployed,
            expectedProfit: expected,
            grossProfit: gross,
            expectedReturnPct: capital > 0 ? (expected / capital) * 100 : 0,
            grossReturnPct: capital > 0 ? (gross / capital) * 100 : 0,
            positionCount: positions.length,
            candidateCount: scored.length
        }
    };
}

/**
 * Best 6h window to place buys, in UTC.
 *
 * Entering during the quiet 00:00-06:00 UTC block returned ~440k per cycle in
 * backtest against ~343k for the 06:00-12:00 block — the same items, 28% more
 * profit, purely from when the order went in. Prices sag about 0.4% and spreads
 * widen when the game is empty, which is exactly when you want to be bidding.
 */
export const BUY_WINDOWS = [
    { fromUtc: 0, toUtc: 6, quality: 'best', note: 'quietest hours — prices sag and spreads widen' },
    { fromUtc: 18, toUtc: 24, quality: 'good', note: 'evening lull, second-best entry' },
    { fromUtc: 12, toUtc: 18, quality: 'fair', note: 'busy — spreads are tightest here' },
    { fromUtc: 6, toUtc: 12, quality: 'worst', note: 'prices peak; better for selling than buying' }
];

export function currentBuyWindow(now = new Date()) {
    const hour = now.getUTCHours();
    return BUY_WINDOWS.find((w) => hour >= w.fromUtc && hour < w.toUtc) ?? BUY_WINDOWS[0];
}
