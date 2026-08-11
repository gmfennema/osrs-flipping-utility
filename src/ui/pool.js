/**
 * The item-pool selector, which more than one tab offers.
 *
 * The Flip Finder and the 48h Plan both work over one pool. While the control
 * lived only on the Flip Finder, the Plan silently inherited whatever that tab
 * was last set to — so a visitor who only ever opened the Plan tab had no way
 * to reach members items at all, and no way to tell which market the plan in
 * front of them was drawn from. Both copies read and write the same state, and
 * a change announces itself so every dependent view can rebuild.
 */

import { state, setItemPool, ITEM_POOLS } from '../state.js';

export const POOL_CHANGED = 'osrs:pool-changed';

export const POOL_LABELS = {
    all: 'All items',
    f2p: 'Free-to-play only',
    p2p: 'Members only'
};

const POOL_HINTS = {
    all: 'Free and members items',
    f2p: 'Nothing that needs membership',
    p2p: 'Members items only'
};

/**
 * @param {object} args
 * @param {HTMLSelectElement|null} args.select
 * @param {HTMLElement|null} [args.hint]
 * @param {() => void} [args.onApply] Run after every apply, changed or not.
 * @returns {() => void} `apply`, for callers that want to force a re-read.
 */
export function bindPoolSelect({ select, hint = null, onApply } = {}) {
    if (!select) return () => {};

    // The options are built here rather than in the markup: two hand-written
    // copies of the same list is how they drift apart.
    select.innerHTML = ITEM_POOLS
        .map((pool) => `<option value="${pool}">${POOL_LABELS[pool]}</option>`)
        .join('');

    const paint = () => {
        select.value = state.itemPool;
        if (hint) hint.textContent = POOL_HINTS[state.itemPool] ?? '';
    };

    const apply = () => {
        const changed = select.value !== state.itemPool;
        setItemPool(select.value);
        // Repaint before announcing, so a rejected value snaps back rather than
        // leaving the box showing a pool nothing is filtered by.
        paint();
        onApply?.();
        if (changed) window.dispatchEvent(new CustomEvent(POOL_CHANGED));
    };

    select.addEventListener('change', apply);
    window.addEventListener(POOL_CHANGED, paint);

    paint();
    return apply;
}
