/**
 * App state and its localStorage persistence.
 * UI modules read from here; nothing else keeps its own copy.
 */

const PREFIX = 'osrs_';

function readPref(key, fallback) {
    try {
        const value = localStorage.getItem(PREFIX + key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

function writePref(key, value) {
    try {
        if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
        else localStorage.setItem(PREFIX + key, String(value));
    } catch { /* private mode — preferences just will not persist */ }
}

export const state = {
    // Selection
    currentItemId: parseInt(readPref('currentItemId', '888'), 10) || 888,
    currentTimeRange: readPref('currentTimeRange', '24h'),
    viewMode: readPref('viewMode', 'timeline'),
    activeTab: readPref('activeTab', 'analyzer'),

    // Bankroll (null = unconstrained)
    capital: (() => {
        const raw = readPref('capital', '');
        const parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    })(),

    // Flip table
    sortColumn: readPref('sortColumn', 'cycleProfit'),
    sortDirection: readPref('sortDirection', 'desc'),
    membersFilter: readPref('membersFilter', 'f2p'),

    // Quest tree
    questSelection: readPref('questSelection', '') || null,
    questPanel: readPref('questPanel', 'path'),
    questMembers: readPref('questMembers', 'all'),
    questStage: readPref('questStage', 'all'),
    questSearch: '',
    questHideDone: readPref('questHideDone', 'false') === 'true',
    // Quests the player has ticked off. A Set so membership tests stay cheap in
    // the tree renderer, persisted as a JSON array.
    questsDone: (() => {
        try {
            const parsed = JSON.parse(readPref('questsDone', '[]'));
            return new Set(Array.isArray(parsed) ? parsed : []);
        } catch {
            return new Set();
        }
    })(),

    // Market data
    itemMapping: [],
    itemsById: new Map(),
    latestPrices: {},
    volume24h: {},
    volume1h: {},
    lastPriceUpdate: null,

    // Per-item derived data for the analyzer
    currentItemHistory: [],
    currentStability: null,
    analyzerToken: 0
};

export function setCurrentItem(id) {
    state.currentItemId = id;
    writePref('currentItemId', id);
}

export function setTimeRange(range) {
    state.currentTimeRange = range;
    writePref('currentTimeRange', range);
}

export function setViewMode(mode) {
    state.viewMode = mode;
    writePref('viewMode', mode);
}

export function setActiveTab(tab) {
    state.activeTab = tab;
    writePref('activeTab', tab);
}

export function setCapital(gp) {
    state.capital = gp;
    writePref('capital', gp);
}

export function setSort(column, direction) {
    state.sortColumn = column;
    state.sortDirection = direction;
    writePref('sortColumn', column);
    writePref('sortDirection', direction);
}

export function setMembersFilter(value) {
    state.membersFilter = value;
    writePref('membersFilter', value);
}

export function setQuestSelection(name) {
    state.questSelection = name;
    writePref('questSelection', name);
}

export function setQuestPanel(panel) {
    state.questPanel = panel;
    writePref('questPanel', panel);
}

export function setQuestFilter(key, value) {
    state[key] = value;
    writePref(key, value);
}

export function setQuestSearch(term) {
    // Deliberately not persisted: a stale search term on reload hides the whole
    // browser behind a filter the reader did not type.
    state.questSearch = term;
}

export function toggleQuestDone(name) {
    if (state.questsDone.has(name)) state.questsDone.delete(name);
    else state.questsDone.add(name);
    persistQuestsDone();
    return state.questsDone.has(name);
}

export function clearQuestsDone() {
    state.questsDone.clear();
    persistQuestsDone();
}

function persistQuestsDone() {
    writePref('questsDone', JSON.stringify([...state.questsDone]));
}

export function indexMapping(items) {
    state.itemMapping = items;
    state.itemsById = new Map(items.map((item) => [item.id, item]));
}

export function getItem(id) {
    return state.itemsById.get(id) ?? null;
}
