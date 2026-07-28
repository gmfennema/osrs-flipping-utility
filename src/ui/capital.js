/**
 * The bankroll field, which more than one tab offers.
 *
 * Every number in this app is sized to your capital, and the 48h Plan cannot be
 * built without it at all. Keeping the only input on the Flip Finder tab made
 * the Plan tab dead on any browser that had never visited that tab and saved a
 * value — which on a phone is every first visit. So the field appears wherever
 * it is needed and all copies read and write the same state.
 */

import { state, setCapital } from '../state.js';
import { parseGp } from '../calc/pricing.js';
import { gp } from './format.js';

const CAPITAL_CHANGED = 'osrs:capital-changed';

/**
 * @param {object} args
 * @param {HTMLInputElement|null} args.input
 * @param {HTMLElement|null} [args.hint]
 * @param {string} [args.emptyHint] Shown while no bankroll is set.
 * @param {() => void} [args.onApply] Run after every apply, changed or not.
 * @returns {() => void} `apply`, for callers that want to force a re-read.
 */
export function bindCapitalInput({ input, hint = null, emptyHint = 'Unlimited', onApply } = {}) {
    if (!input) return () => {};

    const paint = () => {
        // Never fight the user mid-typing; only mirror when the field is idle.
        if (document.activeElement !== input) {
            input.value = state.capital === null ? '' : String(state.capital);
        }
        if (hint) hint.textContent = state.capital === null ? emptyHint : `${gp(state.capital)} gp`;
    };

    const apply = () => {
        const parsed = parseGp(input.value);
        const next = parsed !== null && parsed > 0 ? parsed : null;
        const changed = next !== state.capital;
        setCapital(next);
        paint();
        onApply?.();
        if (changed) window.dispatchEvent(new CustomEvent(CAPITAL_CHANGED));
    };

    input.addEventListener('change', apply);
    input.addEventListener('blur', apply);
    // Mobile keyboards submit rather than blur, and the value must land either way.
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
    });
    window.addEventListener(CAPITAL_CHANGED, paint);

    paint();
    return apply;
}
