/**
 * The price / volume / spread chart.
 *
 * The spread series is the reason this chart is useful for flipping: it plots
 * the post-tax margin per interval, so a durable 3gp spread is visually
 * distinguishable from a 60gp spread that existed for one five-minute bucket.
 */

import {
    Chart,
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    TimeScale,
    Filler,
    Legend,
    Tooltip,
    Decimation
} from 'chart.js';
import 'chartjs-adapter-date-fns';

import { smoothSeries } from '../calc/series.js';

Chart.register(
    LineController, LineElement, PointElement, LinearScale, TimeScale,
    Filler, Legend, Tooltip, Decimation
);

Chart.defaults.color = '#475569';
Chart.defaults.borderColor = 'rgba(226, 232, 240, 0.7)';
Chart.defaults.font.family = "'Outfit', sans-serif";
Chart.defaults.font.size = 13;

const AXIS_FOR_DATASET = ['y', 'y1', 'y1', 'y2'];

let chartInstance = null;

function smoothingWindow(viewMode, range) {
    if (viewMode !== 'timeline') return 1;
    if (range === '24h') return 7;
    if (range === '7d') return 3;
    return 1;
}

/** Keep each y-axis visible only while at least one series using it is shown. */
function syncAxisVisibility(chart) {
    const used = new Set();
    chart.data.datasets.forEach((_, index) => {
        if (chart.isDatasetVisible(index)) used.add(AXIS_FOR_DATASET[index]);
    });
    ['y', 'y1', 'y2'].forEach((axis) => {
        if (chart.options.scales[axis]) chart.options.scales[axis].display = used.has(axis);
    });
}

export function renderChart(canvas, points, { viewMode, range }) {
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 400);
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.25)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.02)');

    if (chartInstance) chartInstance.destroy();

    const isMobile = window.innerWidth < 768;
    const fontSize = isMobile ? 11 : 13;

    const window_ = smoothingWindow(viewMode, range);
    const smoothedHigh = smoothSeries(points, 'priceHigh', window_);
    const smoothedLow = smoothSeries(points, 'priceLow', window_);
    const smoothedSpread = smoothSeries(points, 'spread', window_);

    let timeUnit = 'hour';
    let displayFormat = { hour: 'h a' };
    if (viewMode === 'timeline' && range !== '24h') {
        timeUnit = 'day';
        displayFormat = { day: 'MMM d' };
    }

    const volLabel = viewMode === 'time-of-day' ? 'Avg Volume' : 'Volume';
    const tickCompact = (value) => {
        if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}m`;
        if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
        return Math.round(value);
    };

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: volLabel,
                    data: points.map((d) => ({ x: d.x, y: d.volume })),
                    borderColor: '#2563eb',
                    backgroundColor: gradient,
                    borderWidth: 2.5,
                    fill: true,
                    yAxisID: 'y',
                    tension: 0.5,
                    cubicInterpolationMode: 'monotone',
                    spanGaps: true,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    order: 4
                },
                {
                    label: 'Target Sell',
                    data: points.map((d, i) => ({ x: d.x, y: smoothedHigh[i] })),
                    borderColor: '#059669',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    yAxisID: 'y1',
                    tension: 0.45,
                    cubicInterpolationMode: 'monotone',
                    spanGaps: true,
                    order: 2
                },
                {
                    label: 'Target Buy',
                    data: points.map((d, i) => ({ x: d.x, y: smoothedLow[i] })),
                    borderColor: '#f97316',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    yAxisID: 'y1',
                    tension: 0.45,
                    cubicInterpolationMode: 'monotone',
                    spanGaps: true,
                    order: 3,
                    fill: {
                        target: '-1',
                        above: 'rgba(16, 185, 129, 0.08)',
                        below: 'transparent'
                    }
                },
                {
                    label: 'Net Spread',
                    data: points.map((d, i) => ({ x: d.x, y: smoothedSpread[i] })),
                    borderColor: '#7c3aed',
                    backgroundColor: 'rgba(124, 58, 237, 0.10)',
                    borderWidth: 2,
                    borderDash: [5, 3],
                    fill: 'origin',
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    yAxisID: 'y2',
                    tension: 0.4,
                    cubicInterpolationMode: 'monotone',
                    spanGaps: true,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 500, easing: 'easeOutQuart' },
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                decimation: { enabled: true, algorithm: 'lttb', samples: 250 },
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: 'rgba(148, 163, 184, 0.4)',
                    borderWidth: 1,
                    padding: isMobile ? 8 : 14,
                    titleFont: { size: fontSize + 1, weight: '600' },
                    bodyFont: { size: fontSize },
                    callbacks: {
                        label(context) {
                            const value = context.parsed.y;
                            if (value === null || value === undefined) return null;
                            const suffix = context.dataset.label === 'Net Spread' ? ' gp/unit' : '';
                            return `${context.dataset.label}: ${Math.round(value).toLocaleString()}${suffix}`;
                        },
                        title(context) {
                            const date = new Date(context[0].parsed.x);
                            if (viewMode === 'time-of-day') {
                                return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                            }
                            return date.toLocaleString([], {
                                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                            });
                        }
                    }
                },
                legend: {
                    labels: {
                        color: '#475569',
                        font: { family: "'Outfit', sans-serif", size: fontSize },
                        boxWidth: isMobile ? 8 : 12,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    },
                    onClick(_event, legendItem, legend) {
                        const chart = legend.chart;
                        const index = legendItem.datasetIndex;
                        const visible = chart.isDatasetVisible(index);
                        if (visible) chart.hide(index);
                        else chart.show(index);
                        legendItem.hidden = visible;
                        syncAxisVisibility(chart);
                        chart.update();
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { unit: timeUnit, displayFormats: displayFormat, tooltipFormat: 'MMM d, h:mm a' },
                    grid: { color: 'rgba(226, 232, 240, 0.5)' },
                    ticks: { color: '#94a3b8', font: { size: fontSize } }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    title: { display: !isMobile, text: volLabel, color: '#2563eb', font: { size: fontSize } },
                    grid: { color: 'rgba(226, 232, 240, 0.5)' },
                    beginAtZero: true,
                    grace: '5%',
                    ticks: { color: '#94a3b8', font: { size: fontSize }, callback: tickCompact }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: { display: !isMobile, text: 'Price (gp)', color: '#0f172a', font: { size: fontSize } },
                    grid: { drawOnChartArea: false },
                    grace: '5%',
                    ticks: { color: '#94a3b8', font: { size: fontSize }, callback: tickCompact }
                },
                y2: {
                    type: 'linear',
                    position: 'right',
                    title: { display: !isMobile, text: 'Net spread (gp)', color: '#7c3aed', font: { size: fontSize } },
                    grid: { drawOnChartArea: false },
                    grace: '10%',
                    ticks: { color: '#a78bfa', font: { size: fontSize }, callback: tickCompact }
                }
            }
        }
    });

    syncAxisVisibility(chartInstance);
    chartInstance.update();

    if (import.meta.env?.DEV) window.__osrsChart = chartInstance;
    return chartInstance;
}

/** The live Chart instance, or null. Exposed for debugging and tests. */
export function getChartInstance() {
    return chartInstance;
}

export function destroyChart() {
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}
