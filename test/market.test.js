import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadEdgeHistories, clearTimeseriesCaches } from '../src/api/market.js';

/**
 * A fetch stand-in driven by a per-id script of outcomes, so a test can say
 * "this item fails once then succeeds" the way a lossy mobile connection does.
 */
function fakeFetch(plan) {
    const calls = [];
    return {
        calls,
        fetch: vi.fn(async (url, options) => {
            const id = Number(new URL(url).searchParams.get('id'));
            calls.push(id);
            const outcome = Array.isArray(plan[id]) ? plan[id].shift() : plan[id];

            if (outcome === 'error') throw new TypeError('Failed to fetch');
            if (outcome === 'stall') {
                // Resolve only when the caller's deadline fires.
                return new Promise((_, reject) => {
                    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                });
            }
            if (typeof outcome === 'number') {
                return { ok: false, status: outcome, json: async () => ({}) };
            }
            return { ok: true, status: 200, json: async () => ({ data: [{ timestamp: 1, id }] }) };
        })
    };
}

afterEach(() => {
    clearTimeseriesCaches();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('loadEdgeHistories', () => {
    it('returns a history per id that resolved', async () => {
        const { fetch } = fakeFetch({ 1: 'ok', 2: 'ok' });
        vi.stubGlobal('fetch', fetch);

        const { histories, failed, gaveUp } = await loadEdgeHistories([1, 2]);
        expect([...histories.keys()]).toEqual([1, 2]);
        expect(failed).toEqual([]);
        expect(gaveUp).toBe(false);
    });

    it('reports a failed id instead of handing back an empty history for it', async () => {
        // 'error' twice: the request plus its one retry.
        const { fetch } = fakeFetch({ 1: 'ok', 2: ['error', 'error'] });
        vi.stubGlobal('fetch', fetch);

        const { histories, failed } = await loadEdgeHistories([1, 2]);
        expect(failed).toEqual([2]);
        expect(histories.has(2)).toBe(false);
        // An unmeasured item must not look like a measured-and-empty one, or the
        // planner rejects it for "no usable history" and the user is never told.
        expect(histories.get(2)).toBeUndefined();
    });

    it('retries a transient failure rather than giving up on the item', async () => {
        const { fetch } = fakeFetch({ 1: ['error', 'ok'] });
        vi.stubGlobal('fetch', fetch);

        const { histories, failed } = await loadEdgeHistories([1]);
        expect(failed).toEqual([]);
        expect(histories.get(1)).toEqual([{ timestamp: 1, id: 1 }]);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry a 404, which cannot come good', async () => {
        const { fetch } = fakeFetch({ 1: 404 });
        vi.stubGlobal('fetch', fetch);

        const { failed } = await loadEdgeHistories([1]);
        expect(failed).toEqual([1]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failure, so a rebuild can recover the item', async () => {
        const { fetch } = fakeFetch({ 7: ['error', 'error', 'ok'] });
        vi.stubGlobal('fetch', fetch);

        const first = await loadEdgeHistories([7]);
        expect(first.failed).toEqual([7]);

        // This is the bug that made the plan permanently short on mobile: the
        // null was cached, so "Rebuild plan" re-served the same failure.
        const second = await loadEdgeHistories([7]);
        expect(second.failed).toEqual([]);
        expect(second.histories.get(7)).toEqual([{ timestamp: 1, id: 7 }]);
    });

    it('caches a success, so a rebuild does not refetch it', async () => {
        const { fetch } = fakeFetch({ 9: 'ok' });
        vi.stubGlobal('fetch', fetch);

        await loadEdgeHistories([9]);
        await loadEdgeHistories([9]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('stops the batch once requests fail back to back', async () => {
        const plan = {};
        const ids = Array.from({ length: 60 }, (_, i) => 100 + i);
        for (const id of ids) plan[id] = ['error', 'error'];
        const { fetch } = fakeFetch(plan);
        vi.stubGlobal('fetch', fetch);

        const { failed, gaveUp, histories } = await loadEdgeHistories(ids);
        expect(gaveUp).toBe(true);
        expect(histories.size).toBe(0);
        // Well short of 60 — the point is not to grind through every timeout.
        expect(failed.length).toBeLessThan(20);
    });

    it('abandons a stalled request instead of hanging on it forever', async () => {
        vi.useFakeTimers();
        const { fetch } = fakeFetch({ 1: 'stall', 2: 'stall' });
        vi.stubGlobal('fetch', fetch);

        const pending = loadEdgeHistories([1, 2]);
        // Past the 10s history deadline, its retry, and the backoff between them.
        await vi.advanceTimersByTimeAsync(60_000);

        const { failed } = await pending;
        expect(failed).toEqual([1, 2]);
    });

    it('stops early when the caller aborts', async () => {
        const controller = new AbortController();
        const ids = Array.from({ length: 40 }, (_, i) => 200 + i);
        const { fetch, calls } = fakeFetch(Object.fromEntries(ids.map((id) => [id, 'ok'])));
        vi.stubGlobal('fetch', fetch);

        const pending = loadEdgeHistories(ids, (done) => {
            if (done === 4) controller.abort();
        }, { signal: controller.signal });

        const { aborted } = await pending;
        expect(aborted).toBe(true);
        expect(calls.length).toBeLessThan(ids.length);
    });

    it('reports progress as items land', async () => {
        const { fetch } = fakeFetch({ 1: 'ok', 2: 'ok', 3: 'ok' });
        vi.stubGlobal('fetch', fetch);

        const seen = [];
        await loadEdgeHistories([1, 2, 3], (done, total) => seen.push([done, total]));
        expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
    });
});
