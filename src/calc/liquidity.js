/**
 * Capital-aware flip economics: how many you can actually buy, how long it
 * takes to fill both sides, and what that works out to per hour.
 *
 * Volume semantics from the wiki API, which are easy to get backwards:
 *   highPriceVolume — units traded at the HIGH price, i.e. people buying
 *                     instantly. That flow is what fills YOUR sell offer.
 *   lowPriceVolume  — units traded at the LOW price, i.e. people selling
 *                     instantly. That flow is what fills YOUR buy offer.
 * Summing the two (as the old code did) overstates liquidity on any item whose
 * flow is one-sided.
 */

/** GE buy limits reset on a rolling 4 hour window. */
export const BUY_LIMIT_WINDOW_HOURS = 4;

/** Assumed share of market flow a single flipper can capture. */
export const DEFAULT_MARKET_SHARE = 0.2;

/** Nobody fills both sides of a flip in under ~3 minutes. */
const MIN_CYCLE_HOURS = 0.05;

/** Split a wiki volume record into the two directions that matter. */
export function splitVolume(record) {
    const sellSide = record?.highPriceVolume ?? 0; // fills your sell offer
    const buySide = record?.lowPriceVolume ?? 0;   // fills your buy offer
    return { buySide, sellSide, total: buySide + sellSide };
}

/**
 * Balance between the two sides of the book, 0 (totally one-sided) to 1
 * (perfectly even). A high-volume item that is 95% instant-sells is a dump,
 * not a flip.
 */
export function volumeBalance(record) {
    const { buySide, sellSide } = splitVolume(record);
    const total = buySide + sellSide;
    if (total <= 0) return 0;
    return Math.min(buySide, sellSide) / (total / 2);
}

/**
 * How many units you can buy in one limit window given your bankroll.
 * `capital` of null/Infinity means "unconstrained".
 */
export function affordableQty({ capital, buyLimit, buyPrice }) {
    const limit = Number.isFinite(buyLimit) && buyLimit > 0 ? buyLimit : Infinity;
    const byCapital = (capital === null || !Number.isFinite(capital) || buyPrice <= 0)
        ? Infinity
        : Math.floor(capital / buyPrice);

    if (limit === Infinity && byCapital === Infinity) {
        return { qty: 0, boundBy: 'unknown' };
    }

    const qty = Math.max(0, Math.min(limit, byCapital));
    let boundBy = 'limit';
    if (byCapital < limit) boundBy = 'capital';
    else if (byCapital === limit) boundBy = 'both';

    return { qty, boundBy };
}

/**
 * Hours to move `qty` units given `hourlyVolume` flowing through that side of
 * the book, assuming you capture `marketShare` of it.
 */
export function estimateFillHours({ qty, hourlyVolume, marketShare = DEFAULT_MARKET_SHARE }) {
    if (qty <= 0) return 0;
    const throughput = (hourlyVolume ?? 0) * marketShare;
    if (throughput <= 0) return Infinity;
    return qty / throughput;
}

/**
 * Full flip economics for one item.
 *
 * @param {object} args
 * @param {number} args.margin      Net profit per unit, after tax.
 * @param {number} args.buyPrice    Price you buy at.
 * @param {number} args.buyLimit    GE buy limit (per 4h).
 * @param {object} args.volume24h   Raw `/24h` record for the item.
 * @param {number|null} args.capital Bankroll in gp, or null for unlimited.
 * @param {number} [args.marketShare]
 */
export function analyzeFlip({ margin, buyPrice, buyLimit, volume24h, capital = null, marketShare = DEFAULT_MARKET_SHARE }) {
    const { buySide, sellSide, total } = splitVolume(volume24h);
    const hourlyBuySide = buySide / 24;
    const hourlySellSide = sellSide / 24;

    const { qty, boundBy } = affordableQty({ capital, buyLimit, buyPrice });

    const cycleProfit = margin * qty;
    const capitalRequired = buyPrice * qty;

    const buyFillHours = estimateFillHours({ qty, hourlyVolume: hourlyBuySide, marketShare });
    const sellFillHours = estimateFillHours({ qty, hourlyVolume: hourlySellSide, marketShare });
    const tradeHours = buyFillHours + sellFillHours;

    // If the buy limit is what stops you, the 4h reset sets the floor on how
    // often you can run the flip. If your bankroll is the constraint, you can
    // start again the moment the previous lot clears.
    const limitBound = boundBy === 'limit' || boundBy === 'both';
    const cycleHours = limitBound
        ? Math.max(tradeHours, BUY_LIMIT_WINDOW_HOURS)
        : Math.max(tradeHours, MIN_CYCLE_HOURS);

    const gpPerHour = Number.isFinite(cycleHours) && cycleHours > 0
        ? cycleProfit / cycleHours
        : 0;

    return {
        qty,
        boundBy,
        capitalRequired,
        cycleProfit,
        buyFillHours,
        sellFillHours,
        tradeHours,
        cycleHours,
        gpPerHour,
        hourlyBuySide,
        hourlySellSide,
        volumeTotal: total,
        balance: volumeBalance(volume24h)
    };
}
