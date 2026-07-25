/**
 * Entry point: load market data, wire the views, start the refresh loop.
 */

import './style.css';

import { state, indexMapping, setTimeRange, setViewMode, setActiveTab, getItem } from './state.js';
import { loadMapping, loadLatest, loadVolume } from './api/market.js';
import { showItem, refreshCurrentSnapshot, redrawChart } from './ui/analyzer.js';
import { renderFlipTable, initFlipControls, resetFlipTable } from './ui/flipTable.js';
import { initSearch } from './ui/search.js';
import { startAutoRefresh } from './refresh.js';

function initTabs() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.view-section').forEach((el) => el.classList.remove('active'));
            document.getElementById(`${btn.dataset.tab}-view`)?.classList.add('active');

            setActiveTab(btn.dataset.tab);
            if (btn.dataset.tab === 'flipper') renderFlipTable();
        });
    });
}

function initRangeControls() {
    document.querySelectorAll('.range-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            setTimeRange(btn.dataset.range);
            redrawChart();
        });
    });

    document.getElementById('mode-toggle')?.addEventListener('change', (event) => {
        setViewMode(event.target.checked ? 'time-of-day' : 'timeline');
        redrawChart();
    });
}

function restoreControlState() {
    document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector(`.range-btn[data-range="${state.currentTimeRange}"]`)?.classList.add('active');

    const modeToggle = document.getElementById('mode-toggle');
    if (modeToggle) modeToggle.checked = state.viewMode === 'time-of-day';

    const tabButton = document.querySelector(`.nav-btn[data-tab="${state.activeTab}"]`);
    if (tabButton) tabButton.click();
}

function showFatalError(message) {
    const banner = document.getElementById('load-error');
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = false;
}

async function boot() {
    initTabs();
    initRangeControls();
    initSearch((id) => showItem(id));

    // Clicking a row in the Flip Finder jumps to the analyzer.
    window.addEventListener('osrs:select-item', (event) => showItem(event.detail.id));
    // Changing your bankroll changes every derived number on the analyzer too.
    window.addEventListener('osrs:capital-changed', () => refreshCurrentSnapshot());

    let mapping;
    try {
        mapping = await loadMapping();
    } catch (error) {
        console.error(error);
        showFatalError('Could not load the item list from the wiki API. Check your connection and reload.');
        return;
    }
    indexMapping(mapping.items);
    if (mapping.fromCache) {
        console.info(`Item mapping served from cache (${Math.round(mapping.ageMs / 60000)}m old)`);
    }

    try {
        const [latest, vol24, vol1h] = await Promise.all([
            loadLatest(),
            loadVolume('24h'),
            loadVolume('1h')
        ]);
        state.latestPrices = latest;
        state.volume24h = vol24;
        state.volume1h = vol1h;
    } catch (error) {
        console.error(error);
        showFatalError('Could not load current prices. Retrying automatically.');
    }

    initFlipControls();
    restoreControlState();

    if (!getItem(state.currentItemId)) state.currentItemId = 888;
    showItem(state.currentItemId);
    if (state.activeTab === 'flipper') renderFlipTable();

    startAutoRefresh(({ volumesRefreshed }) => {
        refreshCurrentSnapshot();
        if (state.activeTab === 'flipper') renderFlipTable({ flash: true });
        // A fresh mapping is never needed mid-session, but stale volume windows
        // change the sort order enough to be worth a clean rebuild.
        if (volumesRefreshed && state.activeTab !== 'flipper') resetFlipTable();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => redrawChart(), 250);
    });
}

boot();
