/**
 * Small TTL cache over localStorage, plus an in-memory equivalent.
 *
 * Everything here fails soft: private-mode browsers, a full quota, or a
 * corrupted entry should degrade to "no cache", never to a broken page.
 */

const SCHEMA_VERSION = 2;

function defaultStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null; // Some privacy modes throw on access.
    }
}

export function readCache(key, maxAgeMs, storage = defaultStorage(), now = Date.now()) {
    if (!storage) return null;
    let rawEntry;
    try {
        rawEntry = storage.getItem(key);
    } catch {
        return null;
    }
    if (!rawEntry) return null;

    try {
        const parsed = JSON.parse(rawEntry);
        if (parsed?.v !== SCHEMA_VERSION) return null;
        if (typeof parsed.t !== 'number') return null;
        if (now - parsed.t > maxAgeMs) return null;
        return { data: parsed.d, ageMs: now - parsed.t, storedAt: parsed.t };
    } catch {
        try { storage.removeItem(key); } catch { /* ignore */ }
        return null;
    }
}

export function writeCache(key, data, storage = defaultStorage(), now = Date.now()) {
    if (!storage) return false;
    try {
        storage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, t: now, d: data }));
        return true;
    } catch {
        // Almost always a quota error. Drop our own stale entries and retry once.
        try {
            for (let i = storage.length - 1; i >= 0; i--) {
                const existing = storage.key(i);
                if (existing && existing.startsWith('osrs_cache:') && existing !== key) {
                    storage.removeItem(existing);
                }
            }
            storage.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, t: now, d: data }));
            return true;
        } catch {
            return false;
        }
    }
}

export function cacheKey(name) {
    return `osrs_cache:${name}`;
}

/**
 * In-memory cache that also coalesces concurrent requests for the same key, so
 * clicking three items in a row does not fire three identical fetches.
 */
export class MemoCache {
    constructor(defaultTtlMs = 60_000) {
        this.defaultTtlMs = defaultTtlMs;
        this.entries = new Map();
        this.inflight = new Map();
    }

    get(key, ttlMs = this.defaultTtlMs, now = Date.now()) {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (now - entry.t > ttlMs) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.d;
    }

    set(key, data, now = Date.now()) {
        this.entries.set(key, { t: now, d: data });
        return data;
    }

    /** Resolve from cache, from an in-flight request, or by calling `loader`. */
    async resolve(key, loader, ttlMs = this.defaultTtlMs) {
        const hit = this.get(key, ttlMs);
        if (hit !== undefined) return hit;

        const pending = this.inflight.get(key);
        if (pending) return pending;

        const promise = (async () => {
            try {
                const data = await loader();
                this.set(key, data);
                return data;
            } finally {
                this.inflight.delete(key);
            }
        })();

        this.inflight.set(key, promise);
        return promise;
    }

    invalidate(key) {
        this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }
}
