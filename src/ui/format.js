/** Display formatting helpers. */

export function gp(value) {
    if (!Number.isFinite(value)) return '--';
    return Math.round(value).toLocaleString();
}

/** Compact gp for dense table cells: 1.2m, 340k, 812. */
export function gpShort(value) {
    if (!Number.isFinite(value)) return '--';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}b`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}m`;
    if (abs >= 1e4) return `${sign}${Math.round(abs / 1e3)}k`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}k`;
    return `${sign}${Math.round(abs)}`;
}

export function signed(value, formatter = gp) {
    if (!Number.isFinite(value)) return '--';
    return `${value >= 0 ? '+' : ''}${formatter(value)}`;
}

export function pct(value, digits = 2) {
    if (!Number.isFinite(value)) return '--';
    return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** "2.4h", "18m", "> 24h" for fill-time estimates. */
export function hours(value) {
    if (!Number.isFinite(value)) return '∞';
    if (value >= 24) return '>24h';
    if (value >= 1) return `${value.toFixed(1)}h`;
    return `${Math.max(1, Math.round(value * 60))}m`;
}

/** "12s ago", "4m ago", "3h ago". */
export function relativeTime(seconds) {
    if (!Number.isFinite(seconds)) return 'unknown';
    if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
}

export function trendClass(value, threshold = 0.5) {
    if (!Number.isFinite(value)) return 'trend-flat';
    if (value > threshold) return 'trend-up';
    if (value < -threshold) return 'trend-down';
    return 'trend-flat';
}

export function scoreColor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 50) return '#ca8a04';
    return '#dc2626';
}

export function iconUrl(icon) {
    return `https://oldschool.runescape.wiki/images/${String(icon ?? '').replace(/ /g, '_')}`;
}
