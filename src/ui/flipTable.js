/**
 * Flip Finder table.
 *
 * Rows are keyed by item id and reconciled rather than rebuilt from an
 * innerHTML blob, so an auto-refresh tick can update the cells that actually
 * moved and flash them, instead of throwing away the DOM (and the scroll
 * position) every sixty seconds.
 */

import { state, setSort, setCapital, setMembersFilter, setCurrentItem } from '../state.js';
import { buildFlip } from '../calc/flip.js';
import { parseGp } from '../calc/pricing.js';
import { gp, gpShort, signed, pct, hours, relativeTime, scoreColor, iconUrl } from './format.js';

const MAX_ROWS = 150;

/** column key -> cell renderer */
const COLUMNS = [
    {
        key: 'name', label: 'Item', className: 'col-item',
        render: (f) => `<div class="item-cell"><img src="${iconUrl(f.icon)}" alt="" loading="lazy"><span>${f.name}</span></div>`
    },
    {
        key: 'score', label: 'Score', title: 'Weighted blend of throughput, liquidity, freshness, margin, book balance',
        render: (f) => `<span class="score-pill" style="color:${scoreColor(f.score)}">${f.score}</span>`
    },
    { key: 'low', label: 'Buy', title: 'Target buy price', render: (f) => gp(f.low) },
    { key: 'netHigh', label: 'Sell (net)', title: 'Sell price after the 2% GE tax', render: (f) => gp(f.netHigh) },
    {
        key: 'margin', label: 'Margin', title: 'Post-tax profit per unit',
        render: (f) => `<span class="${f.margin >= 0 ? 'positive' : 'negative'}">${signed(f.margin)}</span>`
    },
    { key: 'roi', label: 'ROI', render: (f) => pct(f.roi, 1) },
    {
        key: 'qty', label: 'Qty', title: 'Units you can buy in one 4h limit window, given your capital',
        render: (f) => `${gp(f.qty)}<span class="bound-tag bound-${f.boundBy}">${f.boundBy === 'capital' ? '$' : f.boundBy === 'unknown' ? '?' : 'L'}</span>`
    },
    {
        key: 'cycleProfit', label: 'Profit / cycle', title: 'Margin × quantity — what one full 4h limit cycle is worth',
        render: (f) => `<span class="${f.cycleProfit >= 0 ? 'positive' : 'negative'}">${signed(f.cycleProfit, gpShort)}</span>`
    },
    {
        key: 'gpPerHour', label: 'GP / hour', title: 'Profit per cycle divided by estimated cycle time',
        render: (f) => `<span class="${f.gpPerHour >= 0 ? 'positive' : 'negative'}">${signed(f.gpPerHour, gpShort)}</span>`
    },
    {
        key: 'cycleHours', label: 'Cycle', title: 'Estimated hours to fill both sides, floored by the 4h limit reset',
        render: (f) => hours(f.cycleHours)
    },
    {
        key: 'quoteAgeSeconds', label: 'Traded', title: 'How long ago this item last traded',
        render: (f) => `<span class="${f.quoteAgeSeconds > 1800 ? 'stale' : ''}">${relativeTime(f.quoteAgeSeconds)}</span>`
    },
    { key: 'volume', label: 'Vol 24h', render: (f) => gpShort(f.volume) },
    { key: 'limit', label: 'Limit', render: (f) => (f.limit ? gp(f.limit) : '—') }
];

/** Values compared between refreshes to decide which cells flash. */
const FLASH_KEYS = ['low', 'netHigh', 'margin', 'cycleProfit', 'gpPerHour', 'score'];

const rowNodes = new Map();      // itemId -> <tr>
let previousValues = new Map();  // itemId -> { key: value }
let tbody = null;

function readFilters() {
    const num = (id, fallback = 0) => {
        const value = parseInt(document.getElementById(id)?.value, 10);
        return Number.isFinite(value) ? value : fallback;
    };
    return {
        minVolume: num('filter-volume'),
        minMargin: num('filter-margin'),
        minLimit: num('filter-limit'),
        // Entered in days, compared against cycleHours.
        maxCycleHours: (() => {
            const days = parseFloat(document.getElementById('filter-cycle')?.value);
            return Number.isFinite(days) && days > 0 ? days * 24 : Infinity;
        })(),
        maxAgeMinutes: (() => {
            const raw = parseInt(document.getElementById('filter-age')?.value, 10);
            return Number.isFinite(raw) && raw > 0 ? raw : Infinity;
        })()
    };
}

/** Build, filter and sort every candidate flip. Pure apart from reading state. */
export function computeRows() {
    const filters = readFilters();
    const rows = [];

    for (const item of state.itemMapping) {
        if (state.membersFilter === 'f2p' && item.members) continue;
        if (state.membersFilter === 'p2p' && !item.members) continue;

        const quote = state.latestPrices[item.id];
        if (!quote) continue;

        const flip = buildFlip({
            item,
            quote,
            vol24: state.volume24h[item.id],
            vol1h: state.volume1h[item.id],
            capital: state.capital
        });
        if (!flip) continue;

        if (flip.volume < filters.minVolume) continue;
        if (flip.margin < filters.minMargin) continue;
        if ((flip.limit ?? 0) < filters.minLimit) continue;
        if (flip.cycleHours > filters.maxCycleHours) continue;
        if (flip.quoteAgeSeconds !== null && flip.quoteAgeSeconds / 60 > filters.maxAgeMinutes) continue;
        if (state.capital !== null && flip.qty <= 0) continue;

        rows.push(flip);
    }

    const { sortColumn, sortDirection } = state;
    const direction = sortDirection === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
        let valueA = a[sortColumn];
        let valueB = b[sortColumn];
        // Infinite cycle times should always sink to the bottom, not the top.
        if (!Number.isFinite(valueA) && typeof valueA !== 'string') valueA = direction === 1 ? Infinity : -Infinity;
        if (!Number.isFinite(valueB) && typeof valueB !== 'string') valueB = direction === 1 ? Infinity : -Infinity;
        if (typeof valueA === 'string') valueA = valueA.toLowerCase();
        if (typeof valueB === 'string') valueB = valueB.toLowerCase();
        if (valueA < valueB) return -1 * direction;
        if (valueA > valueB) return 1 * direction;
        return 0;
    });

    return rows.slice(0, MAX_ROWS);
}

function createRow(flip) {
    const tr = document.createElement('tr');
    tr.dataset.itemId = String(flip.id);
    tr.style.cursor = 'pointer';
    COLUMNS.forEach((column) => {
        const td = document.createElement('td');
        td.dataset.col = column.key;
        tr.appendChild(td);
    });
    tr.addEventListener('click', () => {
        setCurrentItem(flip.id);
        document.querySelector('[data-tab="analyzer"]')?.click();
        window.dispatchEvent(new CustomEvent('osrs:select-item', { detail: { id: flip.id } }));
    });
    return tr;
}

function paintRow(tr, flip, { flash }) {
    const previous = previousValues.get(flip.id);
    COLUMNS.forEach((column) => {
        const td = tr.querySelector(`[data-col="${column.key}"]`);
        if (!td) return;
        const html = column.render(flip);
        if (td.innerHTML !== html) td.innerHTML = html;
    });

    if (flash && previous) {
        for (const key of FLASH_KEYS) {
            if (previous[key] === flip[key]) continue;
            const td = tr.querySelector(`[data-col="${key}"]`);
            if (!td) continue;
            const direction = flip[key] > previous[key] ? 'flash-up' : 'flash-down';
            td.classList.remove('flash-up', 'flash-down');
            // Force a reflow so the animation restarts on consecutive ticks.
            void td.offsetWidth;
            td.classList.add(direction);
            setTimeout(() => td.classList.remove(direction), 1500);
        }
    }

    previousValues.set(flip.id, Object.fromEntries(FLASH_KEYS.map((key) => [key, flip[key]])));
}

function renderHeaders() {
    const thead = document.querySelector('#flip-table thead tr');
    if (!thead || thead.dataset.built === 'true') return;
    thead.innerHTML = COLUMNS.map((column) =>
        `<th data-sort="${column.key}"${column.title ? ` title="${column.title}"` : ''}>${column.label}</th>`
    ).join('');
    thead.dataset.built = 'true';

    thead.querySelectorAll('th[data-sort]').forEach((th) => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (state.sortColumn === column) {
                setSort(column, state.sortDirection === 'asc' ? 'desc' : 'asc');
            } else {
                setSort(column, 'desc');
            }
            renderFlipTable();
        });
    });
}

function updateSortIndicators() {
    document.querySelectorAll('#flip-table th[data-sort]').forEach((th) => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sort === state.sortColumn) {
            th.classList.add(state.sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });
}

/**
 * @param {object} [options]
 * @param {boolean} [options.flash] Highlight cells whose value changed.
 */
export function renderFlipTable({ flash = false } = {}) {
    tbody ??= document.querySelector('#flip-table tbody');
    if (!tbody) return;

    renderHeaders();
    updateSortIndicators();

    const rows = computeRows();
    const seen = new Set();

    rows.forEach((flip, index) => {
        seen.add(flip.id);
        let tr = rowNodes.get(flip.id);
        if (!tr) {
            tr = createRow(flip);
            rowNodes.set(flip.id, tr);
        }
        paintRow(tr, flip, { flash });

        // Move into position only when it is actually out of order.
        const current = tbody.children[index];
        if (current !== tr) tbody.insertBefore(tr, current ?? null);
    });

    for (const [id, tr] of rowNodes) {
        if (!seen.has(id)) {
            tr.remove();
            rowNodes.delete(id);
            previousValues.delete(id);
        }
    }

    const count = document.getElementById('flip-count');
    if (count) {
        count.textContent = rows.length >= MAX_ROWS
            ? `Showing the top ${MAX_ROWS} matches`
            : `${rows.length} match${rows.length === 1 ? '' : 'es'}`;
    }
}

/** Wire filter inputs, including the capital box with k/m/b shorthand. */
export function initFlipControls() {
    ['filter-volume', 'filter-margin', 'filter-limit', 'filter-cycle', 'filter-age'].forEach((id) => {
        document.getElementById(id)?.addEventListener('input', () => renderFlipTable());
    });

    const capitalInput = document.getElementById('filter-capital');
    if (capitalInput) {
        if (state.capital !== null) capitalInput.value = String(state.capital);
        const apply = () => {
            const parsed = parseGp(capitalInput.value);
            setCapital(parsed !== null && parsed > 0 ? parsed : null);
            const hint = document.getElementById('capital-hint');
            if (hint) {
                hint.textContent = state.capital === null
                    ? 'Unlimited — showing full buy limits'
                    : `${gp(state.capital)} gp`;
            }
            renderFlipTable();
            window.dispatchEvent(new CustomEvent('osrs:capital-changed'));
        };
        capitalInput.addEventListener('change', apply);
        capitalInput.addEventListener('blur', apply);
        apply();
    }

    const membersSelect = document.getElementById('filter-members');
    if (membersSelect) {
        membersSelect.value = state.membersFilter;
        membersSelect.addEventListener('change', () => {
            setMembersFilter(membersSelect.value);
            renderFlipTable();
        });
    }
}

/** Drop cached DOM so the next render rebuilds from scratch. */
export function resetFlipTable() {
    rowNodes.forEach((tr) => tr.remove());
    rowNodes.clear();
    previousValues = new Map();
}
