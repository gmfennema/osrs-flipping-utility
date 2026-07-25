/**
 * Grand Exchange pricing and tax rules.
 *
 * The GE takes 2% of the sale price, rounded down, on any item selling for
 * 50gp or more. The tax is capped at 5,000,000gp per item, which only bites on
 * items above 250M (twisted bow, third age, etc.) but is a real cap.
 */

export const GE_TAX_RATE = 0.02;
export const GE_TAX_THRESHOLD = 50;
export const GE_TAX_CAP = 5_000_000;

/** Tax charged when selling one unit at `price`. */
export function geTax(price) {
    if (typeof price !== 'number' || !Number.isFinite(price) || price < GE_TAX_THRESHOLD) return 0;
    return Math.min(Math.floor(price * GE_TAX_RATE), GE_TAX_CAP);
}

/** What you actually receive after tax when selling one unit at `price`. */
export function netSellPrice(price) {
    if (typeof price !== 'number' || !Number.isFinite(price)) return 0;
    return price - geTax(price);
}

/**
 * The `/latest` endpoint can return low > high during volatile minutes, which
 * would produce a phantom negative margin. Normalise so buy <= sell and carry
 * the trade timestamps through.
 */
export function normalizeQuote(quote) {
    if (!quote) return null;
    const rawHigh = typeof quote.high === 'number' ? quote.high : null;
    const rawLow = typeof quote.low === 'number' ? quote.low : null;
    if (rawHigh === null && rawLow === null) return null;

    const a = rawHigh ?? rawLow;
    const b = rawLow ?? rawHigh;
    const flipped = rawHigh !== null && rawLow !== null && rawLow > rawHigh;

    return {
        high: Math.max(a, b),
        low: Math.min(a, b),
        // Timestamps follow their price, so swap them too when the quote is inverted.
        highTime: flipped ? (quote.lowTime ?? null) : (quote.highTime ?? null),
        lowTime: flipped ? (quote.highTime ?? null) : (quote.lowTime ?? null),
        inverted: flipped
    };
}

/**
 * Margin and ROI for buying at `low` and selling at `high`, after tax.
 */
export function marginFor(high, low) {
    const netHigh = netSellPrice(high);
    const margin = netHigh - low;
    const roi = low > 0 ? (margin / low) * 100 : 0;
    return { netHigh, margin, roi };
}

/**
 * Parse a gp amount that may use OSRS shorthand: "10m", "500k", "1.5b", "2,000".
 * Returns null when the input is not a usable number.
 */
export function parseGp(input) {
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input !== 'string') return null;

    const cleaned = input.trim().toLowerCase().replace(/[,\s_]/g, '');
    if (!cleaned) return null;

    const match = cleaned.match(/^(-?\d*\.?\d+)([kmb])?$/);
    if (!match) return null;

    const value = parseFloat(match[1]);
    if (!Number.isFinite(value)) return null;

    const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[match[2]] ?? 1;
    return Math.round(value * multiplier);
}
