import { describe, it, expect, vi } from 'vitest';
import { readCache, writeCache, cacheKey, MemoCache } from '../src/api/cache.js';

/** Minimal localStorage stand-in with an optional write failure. */
function makeStorage({ failWrites = false } = {}) {
    const map = new Map();
    return {
        map,
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
            if (failWrites) throw new DOMException('quota', 'QuotaExceededError');
            map.set(k, v);
        },
        removeItem: (k) => map.delete(k)
    };
}

describe('localStorage cache', () => {
    it('round-trips a value within the TTL', () => {
        const storage = makeStorage();
        writeCache('k', { a: 1 }, storage, 1000);
        const hit = readCache('k', 5000, storage, 3000);
        expect(hit.data).toEqual({ a: 1 });
        expect(hit.ageMs).toBe(2000);
    });

    it('misses once the entry is older than the TTL', () => {
        const storage = makeStorage();
        writeCache('k', 'v', storage, 1000);
        expect(readCache('k', 500, storage, 3000)).toBeNull();
    });

    it('misses on a schema version bump', () => {
        const storage = makeStorage();
        storage.setItem('k', JSON.stringify({ v: 0, t: Date.now(), d: 'old' }));
        expect(readCache('k', 1e9, storage)).toBeNull();
    });

    it('discards corrupted entries instead of throwing', () => {
        const storage = makeStorage();
        storage.setItem('k', 'not json');
        expect(readCache('k', 1e9, storage)).toBeNull();
        expect(storage.getItem('k')).toBeNull();
    });

    it('fails soft when there is no storage at all', () => {
        expect(readCache('k', 1000, null)).toBeNull();
        expect(writeCache('k', 'v', null)).toBe(false);
    });

    it('evicts its own stale entries and retries on a quota error', () => {
        const map = new Map([
            [cacheKey('old'), 'junk'],
            ['unrelated', 'keep me']
        ]);
        let attempts = 0;
        const storage = {
            get length() { return map.size; },
            key: (i) => [...map.keys()][i] ?? null,
            getItem: (k) => map.get(k) ?? null,
            removeItem: (k) => map.delete(k),
            setItem: (k, v) => {
                attempts += 1;
                if (attempts === 1) throw new DOMException('quota', 'QuotaExceededError');
                map.set(k, v);
            }
        };

        expect(writeCache(cacheKey('mapping'), [1, 2, 3], storage)).toBe(true);
        expect(map.has(cacheKey('old'))).toBe(false);
        expect(map.get('unrelated')).toBe('keep me'); // Not ours, left alone.
    });

    it('reports failure when even the retry cannot write', () => {
        expect(writeCache('k', 'v', makeStorage({ failWrites: true }))).toBe(false);
    });
});

describe('MemoCache', () => {
    it('serves a value inside the TTL and refetches after it', async () => {
        const cache = new MemoCache(1000);
        const loader = vi.fn().mockResolvedValue('data');

        expect(await cache.resolve('k', loader)).toBe('data');
        expect(await cache.resolve('k', loader)).toBe('data');
        expect(loader).toHaveBeenCalledTimes(1);

        cache.invalidate('k');
        expect(await cache.resolve('k', loader)).toBe('data');
        expect(loader).toHaveBeenCalledTimes(2);
    });

    // This is what stops rapid item clicks from firing duplicate 30d fetches.
    it('coalesces concurrent requests for the same key', async () => {
        const cache = new MemoCache();
        let resolveLoader;
        const loader = vi.fn(() => new Promise((resolve) => { resolveLoader = resolve; }));

        const a = cache.resolve('k', loader);
        const b = cache.resolve('k', loader);
        const c = cache.resolve('k', loader);

        expect(loader).toHaveBeenCalledTimes(1);
        resolveLoader('shared');
        expect(await Promise.all([a, b, c])).toEqual(['shared', 'shared', 'shared']);
    });

    it('does not cache a rejected load', async () => {
        const cache = new MemoCache();
        const loader = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('ok');

        await expect(cache.resolve('k', loader)).rejects.toThrow('boom');
        expect(await cache.resolve('k', loader)).toBe('ok');
    });

    it('expires entries by age', () => {
        const cache = new MemoCache(1000);
        cache.set('k', 'v', 0);
        expect(cache.get('k', 1000, 500)).toBe('v');
        expect(cache.get('k', 1000, 2000)).toBeUndefined();
    });
});
