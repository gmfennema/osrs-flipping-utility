import { describe, it, expect } from 'vitest';
import { computeEdge, edgeVetoes, EDGE_CONFIG } from '../src/calc/edge.js';
import { buildPlan, capacityFor, orderPair, currentBuyWindow, BUY_WINDOWS } from '../src/calc/plan.js';
import { shortlist } from '../src/calc/shortlist.js';

function series(spec, startTs = 1_700_000_000) {
    return spec.map((s, i) => ({
        timestamp: startTs + i * 21600,
        avgHighPrice: s.high,
        avgLowPrice: s.low,
        highPriceVolume: s.hv ?? s.vol ?? 5000,
        lowPriceVolume: s.lv ?? s.vol ?? 5000
    }));
}

const flat = (n, high, low, vol) =>
    computeEdge(series(Array.from({ length: n }, () => ({ high, low, vol }))));

const item = (over = {}) => ({ id: 1, name: 'Test item', icon: 'Test.png', limit: 10_000, members: false, ...over });

describe('capacityFor', () => {
    it('takes the tighter of the buy limit and the tradeable flow', () => {
        const edge = flat(130, 42, 38, 100_000);      // thin flow 100k/bucket -> 800k/48h
        const limited = capacityFor(edge, item({ limit: 1000 }));
        expect(limited.qty).toBe(1000 * EDGE_CONFIG.limitWindows);
        expect(limited.boundBy).toBe('limit');

        const flowBound = capacityFor(flat(130, 42, 38, 500), item({ limit: 1_000_000 }));
        expect(flowBound.boundBy).toBe('flow');
        expect(flowBound.qty).toBe(Math.floor(500 * 8 * EDGE_CONFIG.maxFlowShare));
    });

    it('treats a missing buy limit as unlimited and falls back to flow', () => {
        const capacity = capacityFor(flat(130, 42, 38, 10_000), item({ limit: 0 }));
        expect(capacity.byLimit).toBeNull();
        expect(capacity.boundBy).toBe('flow');
    });
});

describe('orderPair', () => {
    it('uses the market ask when it already clears the tax', () => {
        const pair = orderPair(flat(130, 42, 38, 10_000));
        expect(pair).toMatchObject({ bid: 38, ask: 42, margin: 4, needsMove: false });
    });

    it('stretches the ask and flags it when one tick cannot clear the tax', () => {
        const pair = orderPair(flat(130, 1001, 1000, 10_000));
        expect(pair.needsMove).toBe(true);
        expect(pair.ask).toBeGreaterThan(1001);
        expect(pair.margin).toBeGreaterThanOrEqual(1);
        expect(pair.movePct).toBeGreaterThan(0);
    });
});

describe('buildPlan', () => {
    const goodEdge = flat(130, 42, 38, 20_000);

    it('spreads a bankroll across many positions rather than one', () => {
        const candidates = Array.from({ length: 30 }, (_, i) => ({
            item: item({ id: i + 1, name: `Item ${i}`, limit: 10_000 }),
            edge: goodEdge
        }));
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        expect(plan.positions.length).toBeGreaterThan(5);
        expect(plan.totals.expectedProfit).toBeGreaterThan(0);
    });

    it('never puts more than the configured share of the bankroll in one item', () => {
        // One item with effectively unlimited capacity.
        const candidates = [{ item: item({ limit: 100_000_000 }), edge: flat(130, 42, 38, 50_000_000) }];
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        expect(plan.positions[0].spend).toBeLessThanOrEqual(9_000_000 * EDGE_CONFIG.maxBankrollShare + 42);
        expect(plan.positions[0].boundBy).toBe('concentration');
    });

    it('never spends more than the bankroll', () => {
        const candidates = Array.from({ length: 60 }, (_, i) => ({
            item: item({ id: i + 1, limit: 1_000_000 }),
            edge: flat(130, 42, 38, 5_000_000)
        }));
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        expect(plan.totals.deployed).toBeLessThanOrEqual(9_000_000);
        expect(plan.totals.idle).toBeGreaterThanOrEqual(0);
    });

    it('caps the number of positions', () => {
        const candidates = Array.from({ length: 200 }, (_, i) => ({
            item: item({ id: i + 1, limit: 100 }),
            edge: flat(130, 42, 38, 20_000)
        }));
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        expect(plan.positions.length).toBeLessThanOrEqual(EDGE_CONFIG.maxPositions);
    });

    it('ranks by expected return per gp, not by absolute profit', () => {
        const candidates = [
            { item: item({ id: 1, name: 'Thin margin', limit: 10_000 }), edge: flat(130, 39, 38, 20_000) },
            { item: item({ id: 2, name: 'Fat margin', limit: 10_000 }), edge: flat(130, 46, 38, 20_000) }
        ];
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        expect(plan.positions[0].item.name).toBe('Fat margin');
    });

    it('records why each rejected candidate was dropped', () => {
        const candidates = [
            { item: item({ id: 1 }), edge: flat(130, 42, 38, 20) },              // thin
            { item: item({ id: 2 }), edge: flat(130, 1001, 1000, 20_000) },      // no real spread
            { item: item({ id: 3 }), edge: null }                                 // no history
        ];
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        expect(plan.positions).toHaveLength(0);
        expect(plan.skipped.length).toBeGreaterThan(0);
        plan.skipped.forEach((s) => expect(s.reasons.length).toBeGreaterThan(0));
    });

    it('reports an honest empty plan rather than inventing one', () => {
        const plan = buildPlan({ candidates: [], capital: 9_000_000 });
        expect(plan.positions).toEqual([]);
        expect(plan.totals).toMatchObject({ deployed: 0, expectedProfit: 0, positionCount: 0 });
        expect(plan.totals.idle).toBe(9_000_000);
    });

    it('skips items it cannot afford a single unit of', () => {
        const candidates = [{ item: item({ limit: 10 }), edge: flat(130, 5_000_000, 4_000_000, 20_000) }];
        const plan = buildPlan({ candidates, capital: 1000 });
        expect(plan.positions).toHaveLength(0);
    });

    it('discounts expected profit by the measured fill rate', () => {
        // The final bucket printed 46, so that becomes the ask — but only a
        // quarter of the trailing buckets ever reached it. (130 % 4 === 2, so
        // `i % 4 === 1` is what lands on the last index.)
        const spec = Array.from({ length: 130 }, (_, i) => ({
            high: i % 4 === 1 ? 46 : 41, low: 38, vol: 20_000
        }));
        const candidates = [{ item: item({ limit: 10_000 }), edge: computeEdge(series(spec)) }];
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        const position = plan.positions[0];

        expect(position.fillProbability).toBeGreaterThan(0);
        expect(position.fillProbability).toBeLessThan(1);
        expect(position.profit).toBeLessThan(position.grossProfit);
        expect(position.profit).toBeCloseTo(position.grossProfit * position.fillProbability, 6);
        expect(plan.totals.expectedProfit).toBeLessThan(plan.totals.grossProfit);
    });

    it('does not let the fill discount reorder the ranking', () => {
        // Ranking is validated on the spread and the dip, not on fill odds —
        // weighting by fill probability measurably reduced returns in backtest.
        const wide = computeEdge(series(Array.from({ length: 130 }, (_, i) => ({
            high: i % 4 === 1 ? 60 : 41, low: 38, vol: 20_000
        }))));
        const narrow = computeEdge(series(Array.from({ length: 130 }, () => ({
            high: 41, low: 38, vol: 20_000
        }))));
        const plan = buildPlan({
            candidates: [
                { item: item({ id: 1, name: 'Narrow but certain', limit: 10_000 }), edge: narrow },
                { item: item({ id: 2, name: 'Wide but patchy', limit: 10_000 }), edge: wide }
            ],
            capital: 9_000_000
        });
        expect(plan.positions[0].item.name).toBe('Wide but patchy');
    });

    it('drops an ask the market has not reached once all week', () => {
        /*
         * The week traded 5/6, so the spread history looks fine — but the latest
         * bucket printed 6/6, leaving no spread to sell into. The ask stretches
         * to 7, which nothing all week has reached. This is the real shape of a
         * dead position, and it survives the spread veto.
         */
        const spec = [
            ...Array.from({ length: 129 }, () => ({ high: 6, low: 5, vol: 20_000 })),
            { high: 6, low: 6, vol: 20_000 }
        ];
        const edge = computeEdge(series(spec));
        expect(edge.medSpread).toBeGreaterThan(0);   // not caught by the spread veto
        expect(edgeVetoes(edge)).toEqual([]);

        const plan = buildPlan({ candidates: [{ item: item({ limit: 10_000 }), edge }], capital: 9_000_000 });
        expect(plan.positions).toHaveLength(0);
        expect(plan.skipped.some((s) => s.reasons.includes('ask never reached this week'))).toBe(true);
    });

    it('keeps a wide spread that only fills occasionally', () => {
        // A single-digit fill rate is a long shot, not a dead position — and
        // backtesting says these carry the returns, so they must survive.
        // 129 % 14 === 3, so that residue is what lands on the final bucket.
        const spec = Array.from({ length: 130 }, (_, i) => ({
            high: i % 14 === 3 ? 80 : 41, low: 38, vol: 20_000
        }));
        const plan = buildPlan({
            candidates: [{ item: item({ limit: 10_000 }), edge: computeEdge(series(spec)) }],
            capital: 9_000_000
        });
        expect(plan.positions).toHaveLength(1);
        expect(plan.positions[0].fillProbability).toBeGreaterThan(0);
        expect(plan.positions[0].fillProbability).toBeLessThan(0.2);
    });

    it('refuses positions too small to be worth an order slot', () => {
        // Capacity of 2 units at 5gp is 10gp of exposure — not a position.
        const candidates = [{ item: item({ limit: 1 }), edge: flat(130, 6, 5, 20_000) }];
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        expect(plan.positions).toHaveLength(0);
    });

    it('totals are internally consistent', () => {
        const candidates = Array.from({ length: 20 }, (_, i) => ({
            item: item({ id: i + 1, limit: 10_000 }), edge: goodEdge
        }));
        const plan = buildPlan({ candidates, capital: 9_000_000 });
        const spend = plan.positions.reduce((s, p) => s + p.spend, 0);
        const profit = plan.positions.reduce((s, p) => s + p.profit, 0);
        expect(plan.totals.deployed).toBe(spend);
        expect(plan.totals.expectedProfit).toBe(profit);
        expect(plan.totals.positionCount).toBe(plan.positions.length);
        expect(plan.totals.expectedReturnPct).toBeCloseTo((profit / 9_000_000) * 100, 9);
    });
});

describe('currentBuyWindow', () => {
    it('flags the quiet overnight block as the best time to bid', () => {
        expect(currentBuyWindow(new Date('2026-01-01T02:00:00Z')).quality).toBe('best');
    });

    it('flags the busy morning block as the worst', () => {
        expect(currentBuyWindow(new Date('2026-01-01T09:00:00Z')).quality).toBe('worst');
    });

    it('covers every hour of the day', () => {
        for (let hour = 0; hour < 24; hour++) {
            const found = currentBuyWindow(new Date(Date.UTC(2026, 0, 1, hour)));
            expect(found).toBeTruthy();
            expect(BUY_WINDOWS).toContain(found);
        }
    });
});

describe('shortlist', () => {
    const items = [
        item({ id: 1, name: 'Liquid f2p', limit: 10_000, members: false }),
        item({ id: 2, name: 'Members item', limit: 10_000, members: true }),
        item({ id: 3, name: 'Too thin', limit: 10_000, members: false }),
        item({ id: 4, name: 'Unaffordable', limit: 10_000, members: false })
    ];
    const latestPrices = {
        1: { high: 42, low: 38, highTime: 1, lowTime: 1 },
        2: { high: 42, low: 38, highTime: 1, lowTime: 1 },
        3: { high: 42, low: 38, highTime: 1, lowTime: 1 },
        4: { high: 90_000_000, low: 80_000_000, highTime: 1, lowTime: 1 }
    };
    const volume24h = {
        1: { highPriceVolume: 60_000, lowPriceVolume: 60_000 },
        2: { highPriceVolume: 60_000, lowPriceVolume: 60_000 },
        3: { highPriceVolume: 10, lowPriceVolume: 10 },
        4: { highPriceVolume: 60_000, lowPriceVolume: 60_000 }
    };

    const run = (pool) => shortlist({ items, latestPrices, volume24h, capital: 9_000_000, pool })
        .map((r) => r.item.name);

    it('keeps liquid, affordable items in the requested pool', () => {
        expect(run('f2p')).toContain('Liquid f2p');
    });

    it('excludes members items from an f2p plan', () => {
        expect(run('f2p')).not.toContain('Members item');
        expect(run('p2p')).toContain('Members item');
    });

    it('excludes items with no meaningful volume', () => {
        expect(run('f2p')).not.toContain('Too thin');
    });

    it('excludes items you cannot afford', () => {
        expect(run('f2p')).not.toContain('Unaffordable');
    });

    it('returns each item at most once despite merging two rankings', () => {
        const names = run('all');
        expect(new Set(names).size).toBe(names.length);
    });
});
