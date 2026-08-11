# Where the edge comes from

Notes behind `src/calc/edge.js` and `src/calc/plan.js`. Everything here was
measured, not reasoned about, so the numbers are reproducible and the mistakes
are findable.

## Setup

- **Universe**: all F2P items with a two-sided quote, a price under 9m, and at
  least 2,000 units of 24h volume — 304 items.
- **Data**: 91 days of 6h timeseries buckets per item (`/timeseries?timestep=6h`),
  plus 365 days of daily bars for the trend and seasonality work.
- **Target profile**: 9m bankroll, F2P only, 24–48h holding period. The app is no
  longer limited to that pool — see [Applying this to members items](#applying-this-to-members-items).
- **Validation**: parameters chosen on the first half of the window, reported on
  the held-out second half. Every headline figure is quoted under two fill
  models, one of which is deliberately punitive.

### The two fill models

A backtest of limit-order flipping lives or dies on when it decides your sell
offer filled, so both bounds are reported throughout:

- **Base** — your ask fills when a later bucket's *average high* reaches it.
  This is the realistic reading: the average insta-buy price in that window was
  at or above your offer.
- **Harsh** — your ask fills only when a later bucket's *average low* reaches
  it, i.e. the entire market moved above your offer. This is far stricter than
  reality and exists to prove the edge is not an artifact of the fill rule.

Unfilled positions are liquidated by crossing the spread at the end of the hold
and booked at a loss. No position is quietly held past the horizon.

## What was already wrong

The app ranked by `margin × quantity` computed from `/latest`. Two problems, and
the second is the serious one.

**1. `/latest` systematically overstates the spread.** It is two last-trade
prints that can be hours apart. Comparing the `/latest` spread against the same
item's 7-day median spread across the F2P pool:

| 48h flow | median gap | median `/latest` | median sustained |
|---|---|---|---|
| under 5k | **10.37pp** | 13.15% | 8.29% |
| 5k–20k | 7.11pp | 10.08% | 6.07% |
| 20k–100k | 2.68pp | 2.13% | 1.32% |
| 100k–1m | 1.51pp | 1.04% | 0.77% |
| over 1m | 0.85pp | 0.00% | 0.00% |

The error is worst exactly where the ranking was most confident. 47% of F2P
items showed an overstatement above 0.5pp; 73 items showed more than 3× their
sustained spread. This is why a 286gp "margin" on an item that last traded 15
hours ago reached the top of the list.

**2. The ranking lost money.** Run as a strategy — pick by `margin × quantity`,
deploy 9m, hold 48h — it returned **−5.5k gp per cycle**, a 60% win rate, and a
worst cycle of **−1.87m**, under the harsh fill model.

## The findings

### 1. The 50gp tax cliff is the biggest structural fact in F2P

GE tax is 2% of the sale, rounded down, and **charged only at 50gp and above**.
That makes a one-tick flip mean completely different things either side of the
line:

| Price | Tax | Profit selling one tick up | Gross spread needed to clear 1gp |
|---|---|---|---|
| 5 | 0 | **+1 (20% ROI)** | 1 (20%) |
| 20 | 0 | **+1 (5% ROI)** | 1 (5%) |
| 49 | 0 | **+1** | 1 |
| 50 | 1 | 0 | 2 (4.0%) |
| 100 | 2 | **−1** | 3 (3.0%) |
| 1,000 | 20 | **−19** | 21 (2.1%) |
| 100,000 | 2,000 | **−1,999** | 2,041 (2.04%) |

Below 50gp a single tick is pure profit. At or above it you need better than 2%
gross before the flip breaks even at all. Restricting the plan to sub-50gp items
returned 405k per cycle against 146k for items above the line.

### 2. Liquidity is the highest-impact filter, by a wide margin

Requiring at least 20,000 units of traded flow over the 48h hold, measured from
history rather than quoted volume:

| Flow gate | Mean gp/cycle (harsh) | Worst cycle | Capital deployed |
|---|---|---|---|
| none | 176k | −264k | 2.40m |
| 5k | 247k | −1.13m | 4.74m |
| **20k** | **361k** | **−144k** | **8.76m** |
| 100k | 333k | −257k | 8.86m |
| 500k | 205k | −457k | 9.00m |

Both directions hurt. Too loose and capital piles into items that cannot absorb
it; too tight and you are left holding only the mega-liquid items whose spread
has been arbitraged to zero. 20k sits on a broad plateau, not a spike.

### 3. Allocation matters more than ranking

This was the biggest surprise. Percentage-first rankings pick the best *rate*,
which on a 9m F2P bankroll is usually an item whose buy limit caps exposure at a
few hundred thousand gp. Measured capital deployed by ranking method:

| Ranking | Capital deployed | Mean gp/cycle |
|---|---|---|
| sustained spread % | 185k | 36k |
| biggest daily swing | 114k | 17k |
| current spread % | 2.01m | 426k |
| greedy fill by rate, capacity-bounded | **8.87m** | **440k** |

Position count follows directly:

| Max positions | Mean gp/cycle |
|---|---|
| 5 | 32k |
| 10 | 96k |
| 25 | 278k |
| 40 | 428k |

No single F2P item can absorb 9m. Breadth is the mechanism, not a hedge — hence
`buildPlan` is a knapsack rather than a sort.

### 4. Mean reversion is real on the 30-day horizon

From 365 days of daily bars, trailing 30d trend against the next 48h move:

| 30d trend | Median next 48h | Win rate |
|---|---|---|
| below −20% | **+2.00%** | 55% |
| −20% to −5% | 0.00% | 50% |
| −5% to +5% | 0.00% | 45% |
| +5% to +20% | −0.19% | 41% |
| above +20% | **−2.20%** | 36% |

Cleanly monotone. Buying something that has already run up 20% in a month is a
reliable way to lose. Note the *means* in the crash bucket are outlier garbage
(+87%); only the medians and win rates are trustworthy here.

Applied as a mild tilt — `(1.2 − pctRank)` — this adds little to average return
but consistently repairs the tail: worst cycle went from −307k to −66k and the
win rate from 97% to 100%. It is a risk control, not an alpha source.

### 5. Two components of the old score were actively harmful

**Spread "stability" is non-monotone.** The instinct that an always-positive
spread is the best kind is backwards — those are the mega-liquid items with no
spread left. Gating on it:

| Required share of intervals with a positive spread | Mean gp/cycle |
|---|---|
| none | 247k |
| ≥ 0.6 | 185k |
| ≥ 0.75 | 106k |
| ≥ 0.9 | **−36k** (42% win rate) |

**Volatility is required, not merely tolerated.** Gating on the coefficient of
variation of the mid price:

| Required cv | Mean gp/cycle |
|---|---|
| ≤ 0.02 | **−78k** (27% win rate) |
| ≤ 0.05 | 126k |
| ≤ 0.10 | 366k |
| ≤ 0.25 | **448k** |
| unbounded | 440k |

A perfectly calm item has nothing to harvest. The useful zone is bounded on both
sides, which is why `durabilityScore` in `score.js` is a band and `maxCv` is a
ceiling rather than a target.

### 6. Fill probability belongs in the reporting, not the ranking

Gating on how often an item's price has actually reached the proposed ask:

| Required fill rate | Mean gp/cycle (harsh) | (base) |
|---|---|---|
| > 0 only | **447k** | **792k** |
| ≥ 0.20 | 428k | 747k |
| ≥ 0.50 | 408k | 668k |
| ≥ 0.70 | 339k | 575k |

Reliable fills and wide spreads are opposites, so filtering for reliability
throws away the positions that carry the return. Excluding *only* asks that have
never once been reached helps in all four panels — that is a dead position, not
a long shot. So the plan drops exact zeros and otherwise uses the measured fill
rate purely to discount the reported expectation, which would otherwise overstate
the plan by about a third.

### 7. Time of day is worth ~28%, day of week is worth nothing

Same items, same strategy, varying only the 6h block the buy order goes in:

| Entry window (UTC) | Mean gp/cycle | Win rate |
|---|---|---|
| **00:00–06:00** | **440k** | 100% |
| 18:00–00:00 | 415k | 98% |
| 12:00–18:00 | 386k | 93% |
| 06:00–12:00 | 343k | 88% |

Prices sag about 0.4% and spreads widen ~0.16pp when the game is empty. Free
money for bidding at an inconvenient hour.

Day of week showed **no usable signal** — median spread sat between 1.9% and
2.0% across all seven days. The mean daily returns look dramatic (Saturday
+7.9%) but that is entirely outlier-driven and does not survive using medians.

### 8. Some items move only in jumps, and they are untradeable on a schedule

Share of a year's total price movement occurring on its five largest days.
Median across the pool is 12.2%, but the distribution has a long tail:

- **Jump-driven**: Strength potion(1) 83%, Oak shortbow 78%, Yellow dye 63%,
  Emerald ring 61%. These do everything in two or three sudden moves.
- **Smooth**: Vial 5.7%, Fishing bait 6.4%, Iron ore 6.5%, Rune scimitar 6.8%,
  Coal 7.1%, Gold bar 7.0%, Mithril ore 7.1%.

The jump-driven ones are not necessarily bad trades, but they are wrong for a
fixed 24–48h cycle: you hold dead money through the flat stretch and the jump
lands whenever it lands. Surfaced as a `jumpy` flag rather than a veto, since it
is a fit question rather than a quality one.

## Result

Held-out second half, 9m bankroll, 48h holds:

| | Mean gp/cycle | Median | Win rate | Worst cycle | Deployed | Return |
|---|---|---|---|---|---|---|
| **Harsh fill** | 456k | 461k | 100% | +33k | 9.00m | **5.07%** |
| **Base fill** | 815k | 823k | 100% | +390k | 9.00m | **9.05%** |
| Old ranking (harsh) | −5.5k | 27k | 60% | −1.87m | 8.59m | −0.06% |

Holding longer keeps helping (24h: 2.62%, 48h: 4.88%, 72h: 6.22% under harsh
fill), so 48h is a choice about attention, not the optimum.

## Applying this to members items

The measurements above are all F2P. The app defaults to the whole game, so it is
worth being explicit about which findings are properties of the *market* and
which are properties of the *pool they were measured in*.

Carries over unchanged — these are mechanical or were measured on effects that
have nothing to do with membership:

- **The 50gp tax cliff** (finding 1). A rule of the GE, identical everywhere.
  The consequence is not identical, though: F2P has a lot of sub-50gp staples and
  the members pool has far more genuinely expensive items, so a members-inclusive
  plan leans harder on clearing 2% gross than on the exemption.
- **The liquidity gate** (finding 2), the **volatility band** and the
  **stability taper** (finding 5), and the **fill-rate asymmetry** (finding 6).
  All three are gates on measured per-item history, and the history is fetched
  the same way for a members item as for a free one.
- **Time of day** (finding 7). It is a fact about when players are logged in.
- **Mean reversion** and the **jumpiness flag** (findings 4 and 8) are computed
  per item from its own 30d and 365d behaviour, so they travel.

Does *not* carry over, and is now stated pool-relative in the code:

- **"No single F2P item can absorb 9m"** (finding 3). This was the load-bearing
  argument for breadth, and it is a fact about F2P buy limits, not about the
  game. Plenty of members items will happily take a 9m position in one order.
  Breadth is still enforced — `maxFlowShare` caps a position at 10% of what
  actually trades on the thin side and `maxBankrollShare` caps it at 15% of the
  bankroll — but on a members pool those caps are doing the work that F2P buy
  limits used to do for free. The knapsack is still the right shape; the reason
  it is has changed.
- **The shortlist width.** The funnel was 90 candidates against an ~820-item
  pool. The whole game is ~4,200 items, so the non-F2P pools widen it by
  `largePoolFactor` (135 candidates, one request each). This bounds request
  count, not quality — everything downstream is still decided against measured
  history.
- **The headline return figures.** 5.07% harsh / 9.05% base per 48h cycle were
  produced by this code over the F2P universe. Nothing here claims the same
  numbers on a members-inclusive pool, and no members backtest has been run.
  Treat the ranking as ported, and the return figures as F2P-only.

## Caveats worth keeping in mind

- **91 days, one market regime.** No major update, no bond price shock, no
  bot-ban wave in the window. Buy-limit or tax changes would invalidate the
  tuning outright.
- **The backtest is a single agent.** It assumes your orders do not move the
  price and that nobody is competing for the same fills. The 10%-of-flow cap is
  the defence, but it is an assumption, not a measurement.
- **Entry fills are assumed, not modelled.** The bid is the price at which
  insta-sells actually printed in that bucket, so it is achievable, but the
  backtest does not model waiting for your buy offer.
- **Percentage returns on 2gp items flatter themselves.** A 1gp tick on a 2gp
  item is +50%, which is real but caps out at whatever the buy limit allows. This
  is why every headline figure is denominated in gp, not percent.
- **The dip tilt is a tail control.** It will look like it is costing you return
  on any individual good week. Its value shows up in the bad ones.

## Reproducing

The research scripts are not in this repo — they hit the wiki API directly and
cache to disk. To rebuild: pull `/mapping`, `/latest`, `/24h`, then
`/timeseries?timestep=6h` per item, and drive `computeEdge` / `buildPlan` from
`src/calc/` over the cached history. The production modules are the same code
the numbers above came from.
