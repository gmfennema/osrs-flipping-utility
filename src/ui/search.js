/** Item search box. */

import { state, setCurrentItem } from '../state.js';
import { iconUrl } from './format.js';

const MAX_RESULTS = 10;

export function initSearch(onSelect) {
    const input = document.getElementById('item-search');
    const results = document.getElementById('search-results');
    if (!input || !results) return;

    const close = () => { results.style.display = 'none'; };

    input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        if (query.length < 2) { close(); return; }

        // Prefix matches first — typing "nat" should surface nature runes, not
        // every item with "nat" buried in the middle of its name.
        const matches = state.itemMapping
            .filter((item) => item.name.toLowerCase().includes(query))
            .sort((a, b) => {
                const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
                const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
                return aStarts - bStarts || a.name.length - b.name.length;
            })
            .slice(0, MAX_RESULTS);

        if (matches.length === 0) { close(); return; }

        results.innerHTML = '';
        matches.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'search-result-item';
            row.innerHTML = `<img src="${iconUrl(item.icon)}" alt=""><span>${item.name}</span>`;
            row.addEventListener('click', () => {
                setCurrentItem(item.id);
                input.value = '';
                close();
                document.querySelector('[data-tab="analyzer"]')?.click();
                onSelect(item.id);
            });
            results.appendChild(row);
        });
        results.style.display = 'block';
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close();
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.search-container')) close();
    });
}
