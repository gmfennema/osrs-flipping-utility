// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { state, setCapital } from '../src/state.js';
import { bindCapitalInput } from '../src/ui/capital.js';

function field(id) {
    const input = document.createElement('input');
    input.id = id;
    const hint = document.createElement('span');
    document.body.append(input, hint);
    return { input, hint };
}

const type = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('change'));
};

beforeEach(() => {
    document.body.innerHTML = '';
    setCapital(null);
});

describe('bindCapitalInput', () => {
    it('accepts shorthand and stores the gp value', () => {
        const { input, hint } = field('a');
        bindCapitalInput({ input, hint });

        type(input, '9m');
        expect(state.capital).toBe(9_000_000);
        expect(hint.textContent).toBe('9,000,000 gp');
    });

    it('treats an empty or junk value as no bankroll', () => {
        const { input, hint } = field('a');
        bindCapitalInput({ input, hint, emptyHint: 'Required' });

        type(input, '5m');
        type(input, '');
        expect(state.capital).toBeNull();
        expect(hint.textContent).toBe('Required');

        type(input, 'lots');
        expect(state.capital).toBeNull();
    });

    it('mirrors a value typed into another copy of the field', () => {
        // The Plan tab and the Flip Finder both offer the bankroll box. A phone
        // user who only ever opens the Plan tab must not have to find the other.
        const planner = field('plan-capital');
        const finder = field('filter-capital');
        bindCapitalInput({ input: planner.input, hint: planner.hint });
        bindCapitalInput({ input: finder.input, hint: finder.hint });

        type(planner.input, '2.5m');

        expect(state.capital).toBe(2_500_000);
        expect(finder.input.value).toBe('2500000');
        expect(finder.hint.textContent).toBe('2,500,000 gp');
    });

    it('does not overwrite the copy the user is currently typing into', () => {
        const planner = field('plan-capital');
        const finder = field('filter-capital');
        bindCapitalInput({ input: planner.input, hint: planner.hint });
        bindCapitalInput({ input: finder.input, hint: finder.hint });

        finder.input.focus();
        finder.input.value = '12';
        type(planner.input, '4m');

        expect(finder.input.value).toBe('12');
    });

    it('announces a change once so dependent views rebuild', () => {
        const { input } = field('a');
        bindCapitalInput({ input });
        const onChange = vi.fn();
        window.addEventListener('osrs:capital-changed', onChange);

        type(input, '1m');
        expect(onChange).toHaveBeenCalledTimes(1);

        // Re-applying the same value is not a change; rebuilding on it would
        // throw away a good plan every time the field lost focus.
        input.dispatchEvent(new Event('blur'));
        expect(onChange).toHaveBeenCalledTimes(1);

        window.removeEventListener('osrs:capital-changed', onChange);
    });

    it('shows a bankroll restored from a previous visit', () => {
        setCapital(7_000_000);
        const { input, hint } = field('a');
        bindCapitalInput({ input, hint });

        expect(input.value).toBe('7000000');
        expect(hint.textContent).toBe('7,000,000 gp');
    });

    it('is a no-op when the field is absent', () => {
        expect(() => bindCapitalInput({ input: null })).not.toThrow();
    });
});
