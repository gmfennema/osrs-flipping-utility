// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, setItemPool, ITEM_POOLS } from '../src/state.js';
import { bindPoolSelect, POOL_CHANGED, POOL_LABELS } from '../src/ui/pool.js';

function field(id) {
    const select = document.createElement('select');
    select.id = id;
    const hint = document.createElement('span');
    document.body.append(select, hint);
    return { select, hint };
}

const pick = (select, value) => {
    select.value = value;
    select.dispatchEvent(new Event('change'));
};

beforeEach(() => {
    document.body.innerHTML = '';
    setItemPool('all');
});

describe('bindPoolSelect', () => {
    it('offers every pool, with all items as the default', () => {
        const { select } = field('filter-pool');
        bindPoolSelect({ select });

        expect([...select.options].map((o) => o.value)).toEqual(ITEM_POOLS);
        expect(select.value).toBe('all');
        expect([...select.options].map((o) => o.textContent)).toEqual(
            ITEM_POOLS.map((pool) => POOL_LABELS[pool])
        );
    });

    it('stores the chosen pool', () => {
        const { select, hint } = field('filter-pool');
        bindPoolSelect({ select, hint });

        pick(select, 'p2p');
        expect(state.itemPool).toBe('p2p');
        expect(hint.textContent).toBe('Members items only');
    });

    it('mirrors a pool chosen on another tab', () => {
        // The Plan tab and the Flip Finder both offer the selector, and a plan
        // built from a different pool than the table shows is a lie about which
        // market you are looking at.
        const planner = field('plan-pool');
        const finder = field('filter-pool');
        bindPoolSelect({ select: planner.select, hint: planner.hint });
        bindPoolSelect({ select: finder.select, hint: finder.hint });

        pick(planner.select, 'f2p');

        expect(state.itemPool).toBe('f2p');
        expect(finder.select.value).toBe('f2p');
        expect(finder.hint.textContent).toBe('Nothing that needs membership');
    });

    it('announces a change once so dependent views rebuild', () => {
        const { select } = field('filter-pool');
        bindPoolSelect({ select });
        const onChange = vi.fn();
        window.addEventListener(POOL_CHANGED, onChange);

        pick(select, 'p2p');
        expect(onChange).toHaveBeenCalledTimes(1);

        // Re-picking the same pool is not a change; rebuilding on it would throw
        // away a good plan and re-measure a hundred items for nothing.
        pick(select, 'p2p');
        expect(onChange).toHaveBeenCalledTimes(1);

        window.removeEventListener(POOL_CHANGED, onChange);
    });

    it('ignores a pool it cannot filter by', () => {
        const { select } = field('filter-pool');
        bindPoolSelect({ select });

        select.innerHTML += '<option value="nonsense">Nonsense</option>';
        pick(select, 'nonsense');

        expect(state.itemPool).toBe('all');
        expect(select.value).toBe('all');
    });

    it('shows the pool restored from a previous visit', () => {
        setItemPool('p2p');
        const { select, hint } = field('filter-pool');
        bindPoolSelect({ select, hint });

        expect(select.value).toBe('p2p');
        expect(hint.textContent).toBe('Members items only');
    });

    it('is a no-op when the selector is absent', () => {
        expect(() => bindPoolSelect({ select: null })).not.toThrow();
    });
});
