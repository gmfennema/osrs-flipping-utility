/**
 * Plain-language read of a flip. Returns structured lines rather than an HTML
 * string so it can be unit tested and restyled independently.
 *
 * @returns {Array<{icon: string, title: string, text: string, tone: 'good'|'bad'|'warn'|'neutral'}>}
 */

import { BUY_LIMIT_WINDOW_HOURS } from './liquidity.js';

const gp = (n) => Math.round(n).toLocaleString();

export function buildReasoning({ flip, trend, consistency, spread }) {
    const lines = [];

    // What kind of item this is.
    const limit = flip.limit ?? 0;
    if (limit >= 1000) {
        lines.push({
            icon: '📦', tone: 'neutral', title: 'Bulk commodity',
            text: `Buy limit ${gp(limit)} per ${BUY_LIMIT_WINDOW_HOURS}h — margin per unit matters less than throughput.`
        });
    } else if (limit > 0 && limit < 100) {
        lines.push({
            icon: '⚔️', tone: 'neutral', title: 'Low limit',
            text: `Only ${gp(limit)} per ${BUY_LIMIT_WINDOW_HOURS}h, so the per-unit margin has to carry the flip.`
        });
    } else {
        lines.push({
            icon: '⚖️', tone: 'neutral', title: 'Standard limit',
            text: `${limit ? gp(limit) : 'Unknown'} per ${BUY_LIMIT_WINDOW_HOURS}h.`
        });
    }

    // The number that actually matters.
    if (flip.qty > 0 && flip.cycleProfit > 0) {
        lines.push({
            icon: '💰', tone: 'good', title: 'Per cycle',
            text: `${gp(flip.qty)} units × ${gp(flip.margin)}gp = ${gp(flip.cycleProfit)}gp, ` +
                `tying up ${gp(flip.capitalRequired)}gp. Roughly ${gp(flip.gpPerHour)}gp/hour ` +
                `at an estimated ${flip.cycleHours >= 1 ? `${flip.cycleHours.toFixed(1)}h` : `${Math.round(flip.cycleHours * 60)}m`} per cycle.`
        });
    } else if (flip.margin <= 0) {
        lines.push({
            icon: '🚫', tone: 'bad', title: 'No margin',
            text: 'After the 2% tax this spread is negative. Not a flip at current prices.'
        });
    } else if (flip.qty === 0) {
        lines.push({
            icon: '💸', tone: 'warn', title: 'Out of budget',
            text: `You cannot afford a single unit at ${gp(flip.low)}gp with your stated bankroll.`
        });
    }

    // What the bottleneck is.
    if (flip.qty > 0) {
        if (flip.boundBy === 'capital') {
            lines.push({
                icon: '🏦', tone: 'warn', title: 'Capital bound',
                text: `Your bankroll caps you at ${gp(flip.qty)} of the ${gp(flip.limit ?? 0)} limit. More gp scales this flip directly.`
            });
        } else if (flip.boundBy === 'limit' || flip.boundBy === 'both') {
            lines.push({
                icon: '⏳', tone: 'neutral', title: 'Limit bound',
                text: `You can max the buy limit, so the ${BUY_LIMIT_WINDOW_HOURS}h reset sets your ceiling. Run it alongside other flips.`
            });
        }
    }

    // Liquidity shape.
    if (flip.balance < 0.4 && flip.volume > 0) {
        const heavy = flip.buySideVolume > flip.sellSideVolume ? 'instant-sells' : 'instant-buys';
        lines.push({
            icon: '⚠️', tone: 'warn', title: 'One-sided book',
            text: `Flow is mostly ${heavy} (${gp(flip.buySideVolume)} vs ${gp(flip.sellSideVolume)} over 24h). One side of your flip will sit unfilled.`
        });
    }

    if (Number.isFinite(flip.buyFillHours) && Number.isFinite(flip.sellFillHours)) {
        const slow = Math.max(flip.buyFillHours, flip.sellFillHours);
        if (slow > 6) {
            lines.push({
                icon: '🐌', tone: 'warn', title: 'Slow fill',
                text: `At 20% of market flow the slower side takes about ${slow.toFixed(1)}h to clear.`
            });
        }
    } else {
        lines.push({
            icon: '🚱', tone: 'bad', title: 'Dead side',
            text: 'One side of the book had no volume in the last 24h — you may not get filled at all.'
        });
    }

    // Trend.
    if (trend?.ok) {
        if (trend.changePct > 5) {
            lines.push({ icon: '📈', tone: 'good', title: 'Surging', text: `Up ${trend.changePct.toFixed(1)}% over 12h.` });
        } else if (trend.changePct < -5) {
            lines.push({ icon: '📉', tone: 'bad', title: 'Crashing', text: `Down ${Math.abs(trend.changePct).toFixed(1)}% over 12h — buying into a falling price.` });
        } else {
            lines.push({ icon: '➡️', tone: 'neutral', title: 'Stable', text: `${trend.changePct >= 0 ? '+' : ''}${trend.changePct.toFixed(1)}% over 12h.` });
        }
    } else if (trend) {
        lines.push({ icon: '❔', tone: 'neutral', title: 'Trend unavailable', text: `${trend.reason}.` });
    }

    // Spread durability.
    if (spread && spread.samples > 0) {
        const pctPositive = Math.round(spread.positiveRatio * 100);
        if (spread.positiveRatio >= 0.8 && spread.cv < 0.6) {
            lines.push({
                icon: '🧱', tone: 'good', title: 'Durable spread',
                text: `Positive in ${pctPositive}% of intervals, median ${gp(spread.median)}gp. This margin is repeatable.`
            });
        } else if (spread.positiveRatio < 0.5) {
            lines.push({
                icon: '🎲', tone: 'bad', title: 'Fragile spread',
                text: `Only positive in ${pctPositive}% of intervals — the current margin is mostly noise.`
            });
        } else {
            lines.push({
                icon: '〰️', tone: 'warn', title: 'Choppy spread',
                text: `Positive in ${pctPositive}% of intervals, median ${gp(spread.median)}gp, but it swings a lot.`
            });
        }
    }

    // Volume consistency.
    if (consistency && consistency.days > 0) {
        if (consistency.isSpike) {
            lines.push({ icon: '🚨', tone: 'warn', title: 'Volume spike', text: 'Today is more than 2× the 7d average. Treat the trend as suspect.' });
        } else if (consistency.consistency === 'Volatile') {
            lines.push({ icon: '⚡', tone: 'warn', title: 'Volatile volume', text: 'Daily volume swings wildly, so fill times are unpredictable.' });
        } else {
            lines.push({ icon: '✅', tone: 'good', title: 'Consistent volume', text: `${consistency.consistency.toLowerCase()} day-to-day reliability over ${consistency.days} days.` });
        }

        if (consistency.avg7d > consistency.avg30d * 1.2) {
            lines.push({ icon: '🔥', tone: 'good', title: 'Heating up', text: '7d volume is more than 20% above the 30d average.' });
        } else if (consistency.avg7d < consistency.avg30d * 0.8) {
            lines.push({ icon: '❄️', tone: 'warn', title: 'Cooling down', text: '7d volume is under 80% of the 30d average.' });
        }
    }

    return lines;
}
