let currentItemId = 888; // Default: Mithril arrows
let currentTimeRange = '24h';
let viewMode = 'timeline'; // 'timeline' or 'time-of-day'
let currentDayFilter = 'all'; // 'all' or 0-6 (Sun-Sat)
let itemMapping = [];
let latestPrices = {};
let volumeData = {}; // Stores 24h volume
let volume1hData = {}; // Stores 1h volume
let chartInstance = null;
let histogramChart = null;
let currentItemHistory = []; // Store history for trend calc

// Sort/Filter State
let sortColumn = 'score'; // Default sort by AI Score
let sortDirection = 'desc';

const API_BASE = 'https://prices.runescape.wiki/api/v1/osrs';

// Chart.js configuration
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.05)';
Chart.defaults.font.family = "'Outfit', sans-serif";

// Fetch item mapping on load
async function fetchMapping() {
    try {
        const response = await fetch(`${API_BASE}/mapping`);
        const data = await response.json();
        itemMapping = data;
        console.log("Loaded mapping for", itemMapping.length, "items");
    } catch (error) {
        console.error("Failed to fetch mapping:", error);
    }
}

async function fetchLatestPrices() {
    try {
        const response = await fetch(`${API_BASE}/latest`);
        const json = await response.json();
        latestPrices = json.data;
        console.log("Loaded latest prices");
    } catch (error) {
        console.error("Failed to fetch latest prices:", error);
    }
}

async function fetch24hVolume() {
    try {
        const response = await fetch(`${API_BASE}/24h`);
        const json = await response.json();
        volumeData = json.data;
        console.log("Loaded 24h volume data");
    } catch (error) {
        console.error("Failed to fetch 24h volume:", error);
    }
}

async function fetch1hVolume() {
    try {
        const response = await fetch(`${API_BASE}/1h`);
        const json = await response.json();
        volume1hData = json.data;
        console.log("Loaded 1h volume data");
    } catch (error) {
        console.error("Failed to fetch 1h volume:", error);
    }
}

async function fetchData(id, range, mode = 'timeline') {
    let timestep = '5m';

    if (mode === 'time-of-day') {
        // Time-of-day needs hourly granularity to build a full 24-hour profile
        timestep = range === '24h' ? '5m' : '1h';
    } else {
        if (range === '7d') timestep = '1h';
        if (range === '30d') timestep = '6h';
        if (range === 'ytd') timestep = '24h';
    }

    const url = `${API_BASE}/timeseries?timestep=${timestep}&id=${id}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const json = await response.json();
        return json.data;
    } catch (error) {
        console.error("Failed to fetch data:", error);
        return [];
    }
}

function filterDataByRange(data, range) {
    const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);

    const now = Math.floor(Date.now() / 1000);
    let startTime;

    if (range === '24h') startTime = now - (24 * 60 * 60);
    else if (range === '7d') startTime = now - (7 * 24 * 60 * 60);
    else if (range === '30d') startTime = now - (30 * 24 * 60 * 60);
    else if (range === 'ytd') {
        const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
        startTime = startOfYear;
    }

    return sorted.filter(d => d.timestamp > startTime);
}

function processData(filteredData, mode, dayFilter = 'all') {
    if (mode === 'timeline') {
        return filteredData.map(d => ({
            x: d.timestamp * 1000,
            volume: (d.highPriceVolume || 0) + (d.lowPriceVolume || 0),
            priceHigh: d.avgHighPrice,
            priceLow: d.avgLowPrice
        }));
    }

    const dayFilteredData = dayFilter === 'all'
        ? filteredData
        : filteredData.filter(d => new Date(d.timestamp * 1000).getDay() === Number(dayFilter));

    const hourlyBuckets = new Array(24).fill(0).map(() => ({
        totalVolume: 0,
        totalHigh: 0, countHigh: 0,
        totalLow: 0, countLow: 0,
        count: 0
    }));

    dayFilteredData.forEach(d => {
        const date = new Date(d.timestamp * 1000);
        const hour = date.getHours();

        const vol = (d.highPriceVolume || 0) + (d.lowPriceVolume || 0);
        hourlyBuckets[hour].totalVolume += vol;
        hourlyBuckets[hour].count += 1;

        if (d.avgHighPrice) {
            hourlyBuckets[hour].totalHigh += d.avgHighPrice;
            hourlyBuckets[hour].countHigh++;
        }
        if (d.avgLowPrice) {
            hourlyBuckets[hour].totalLow += d.avgLowPrice;
            hourlyBuckets[hour].countLow++;
        }
    });

    const today = new Date();
    today.setMinutes(0, 0, 0);

    return hourlyBuckets.map((bucket, hour) => {
        const avgVolume = bucket.count > 0 ? bucket.totalVolume / bucket.count : 0;
        const avgHigh = bucket.countHigh > 0 ? bucket.totalHigh / bucket.countHigh : null;
        const avgLow = bucket.countLow > 0 ? bucket.totalLow / bucket.countLow : null;

        const pointDate = new Date(today);
        pointDate.setHours(hour);

        return {
            x: pointDate.getTime(),
            volume: avgVolume,
            priceHigh: avgHigh,
            priceLow: avgLow
        };
    }).sort((a, b) => a.x - b.x);
}

function formatPrice(value) {
    if (value === null || value === undefined) return '--';
    if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M';
    if (Math.abs(value) >= 1_000) return Math.round(value / 1_000) + 'k';
    return Math.round(value).toLocaleString();
}

function formatHistogramValue(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';

    // Keep labels distinct to avoid collapsed ranges like "10k - 10k" on flat items.
    if (Math.abs(value) >= 1_000_000) {
        return (value / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'M';
    }
    if (Math.abs(value) >= 100_000) {
        return Math.round(value / 1_000).toLocaleString() + 'k';
    }
    if (Math.abs(value) >= 10_000) {
        return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    if (Math.abs(value) >= 1_000) {
        return (value / 1_000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + 'k';
    }

    return Math.round(value).toLocaleString();
}

function generateCombinedHistogram(data) {
    const highPrices = data
        .map(d => d.avgHighPrice)
        .filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    const lowPrices = data
        .map(d => d.avgLowPrice)
        .filter(v => v !== null && v !== undefined && !Number.isNaN(v));

    const hasHigh = highPrices.length > 0;
    const hasLow = lowPrices.length > 0;

    if (!hasHigh && !hasLow) {
        return { labels: [], highCounts: [], lowCounts: [], hasHigh: false, hasLow: false };
    }

    const allPrices = [...highPrices, ...lowPrices];
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);

    if (min === max) {
        const label = `${formatHistogramValue(min)} - ${formatHistogramValue(max)}`;
        return {
            labels: [label],
            highCounts: hasHigh ? [highPrices.length] : [0],
            lowCounts: hasLow ? [lowPrices.length] : [0],
            hasHigh,
            hasLow
        };
    }

    const targetBinCount = Math.min(10, Math.max(6, Math.ceil(Math.sqrt(allPrices.length))));
    const priceRange = max - min;
    const rawBinSize = priceRange / targetBinCount;

    // Snap bin size to a "nice" step so high-variance items group cleanly (e.g., Rune Med Helm).
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawBinSize)));
    const normalized = rawBinSize / magnitude;
    let niceStep;

    if (normalized <= 1) niceStep = 1;
    else if (normalized <= 2) niceStep = 2;
    else if (normalized <= 2.5) niceStep = 2.5;
    else if (normalized <= 5) niceStep = 5;
    else niceStep = 10;

    const binSize = Math.max(1, niceStep * magnitude);
    const start = Math.floor(min / binSize) * binSize;
    const end = Math.ceil(max / binSize) * binSize;
    const binCount = Math.max(1, Math.ceil((end - start) / binSize));

    const countPricesInBins = (prices) => {
        const bins = Array(binCount).fill(0);
        prices.forEach(price => {
            let index = Math.floor((price - start) / binSize);
            if (index >= binCount) index = binCount - 1;
            bins[index]++;
        });
        return bins;
    };

    const labels = Array.from({ length: binCount }, (_, i) => {
        const rangeStart = start + (binSize * i);
        const rangeEnd = rangeStart + binSize;
        return `${formatHistogramValue(rangeStart)} - ${formatHistogramValue(rangeEnd)}`;
    });

    return {
        labels,
        highCounts: countPricesInBins(highPrices),
        lowCounts: countPricesInBins(lowPrices),
        hasHigh,
        hasLow
    };
}

function renderHistogramCharts(filteredData) {
    const histogramCtx = document.getElementById('combinedHistogramChart').getContext('2d');
    const emptyMessage = document.getElementById('combined-hist-empty');
    const histogramCanvas = document.getElementById('combinedHistogramChart');

    const histogram = generateCombinedHistogram(filteredData);

    if (histogramChart) histogramChart.destroy();

    const hasData = (histogram.hasHigh && histogram.highCounts.some(count => count > 0))
        || (histogram.hasLow && histogram.lowCounts.some(count => count > 0));

    emptyMessage.style.display = hasData ? 'none' : 'block';
    histogramCanvas.style.display = hasData ? 'block' : 'none';

    if (!hasData) {
        histogramChart = null;
        return;
    }

    const isMobile = window.innerWidth < 768;
    const fontSize = isMobile ? 10 : 12;
    const maxCount = Math.max(0, ...histogram.highCounts, ...histogram.lowCounts);

    histogramChart = new Chart(histogramCtx, {
        type: 'bar',
        data: {
            labels: histogram.labels,
            datasets: [
                {
                    label: 'High Price',
                    data: histogram.highCounts,
                    backgroundColor: 'rgba(74, 222, 128, 0.6)',
                    borderColor: '#4ade80',
                    borderWidth: 1.5,
                    borderRadius: 6,
                    hidden: !histogram.hasHigh
                },
                {
                    label: 'Low Price',
                    data: histogram.lowCounts,
                    backgroundColor: 'rgba(244, 114, 182, 0.6)',
                    borderColor: '#f472b6',
                    borderWidth: 1.5,
                    borderRadius: 6,
                    hidden: !histogram.hasLow
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#cbd5e1',
                        font: { size: fontSize }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: isMobile ? 8 : 12,
                    titleFont: { size: fontSize + 2 },
                    bodyFont: { size: fontSize }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { size: fontSize } },
                    grid: { display: false },
                    stacked: false
                },
                y: {
                    ticks: { color: '#64748b', font: { size: fontSize } },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    beginAtZero: true,
                    suggestedMax: maxCount > 0 ? Math.ceil(maxCount * 1.1) : 1,
                    grace: '5%'
                }
            }
        }
    });
}

// AI Logic
function calculateAiScore(item) {
    const volScore = item.volume > 0 ? Math.log10(item.volume) : 0;
    const roiScore = Math.min(item.roi, 10);
    let rawScore = (volScore * 8) + (roiScore * 4);
    return Math.min(Math.round(rawScore), 100);
}

function calculateTrend(history) {
    if (!history || history.length === 0) return 0;

    // Sort by timestamp just in case
    history.sort((a, b) => a.timestamp - b.timestamp);

    const now = Math.floor(Date.now() / 1000);
    const twelveHoursAgo = now - (12 * 60 * 60);

    // Find data point closest to 12h ago
    // We use avgHighPrice as the reference price
    let oldPrice = null;
    let currentPrice = null;

    // Get most recent price
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].avgHighPrice) {
            currentPrice = history[i].avgHighPrice;
            break;
        }
    }

    // Get price ~12h ago
    const oldPoint = history.find(d => d.timestamp >= twelveHoursAgo && d.avgHighPrice);
    if (oldPoint) {
        oldPrice = oldPoint.avgHighPrice;
    }

    if (currentPrice && oldPrice) {
        return ((currentPrice - oldPrice) / oldPrice) * 100;
    }
    return 0;
}

// Volume Consistency Analysis
async function analyzeVolumeConsistency(id) {
    // Fetch 30d data for analysis (covers both 7d and 30d)
    const data = await fetchData(id, '30d');

    // Aggregate by day
    const dailyVolumes = {};
    data.forEach(d => {
        const date = new Date(d.timestamp * 1000).toDateString();
        const vol = (d.highPriceVolume || 0) + (d.lowPriceVolume || 0);
        if (!dailyVolumes[date]) dailyVolumes[date] = 0;
        dailyVolumes[date] += vol;
    });

    const volumes = Object.values(dailyVolumes);
    if (volumes.length === 0) return { avg7d: 0, avg30d: 0, consistency: 'Unknown', isSpike: false };

    // Calculate 30d Avg
    const sum30d = volumes.reduce((a, b) => a + b, 0);
    const avg30d = sum30d / volumes.length;

    // Calculate 7d Avg (last 7 days)
    const volumes7d = volumes.slice(-7);
    const sum7d = volumes7d.reduce((a, b) => a + b, 0);
    const avg7d = volumes7d.length > 0 ? sum7d / volumes7d.length : 0;

    // Calculate StdDev (using 30d data for better consistency check)
    const squareDiffs = volumes.map(v => Math.pow(v - avg30d, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
    const stdDev = Math.sqrt(avgSquareDiff);

    // Coefficient of Variation (CV)
    const cv = avg30d > 0 ? stdDev / avg30d : 0;

    let consistency = 'High';
    if (cv > 0.5) consistency = 'Moderate';
    if (cv > 1.0) consistency = 'Volatile';

    // Check for spike (compare last 24h to 7d avg)
    const current24h = volumeData[id] ? (volumeData[id].highPriceVolume + volumeData[id].lowPriceVolume) : 0;
    const isSpike = current24h > (avg7d * 2);

    return { avg7d, avg30d, consistency, isSpike };
}

function generateAiReasoning(item, trend, analysis) {
    const vol = item.volume;
    const roi = item.roi;
    const limit = item.limit || 0;

    let trendText = "";
    if (trend > 5) trendText = " 📈 <strong>Surging:</strong> Price is up >5% in 12h.";
    else if (trend < -5) trendText = " 📉 <strong>Crashing:</strong> Price dropped >5% in 12h.";
    else trendText = " ➡️ <strong>Stable:</strong> Price is relatively flat.";

    let typeText = "";
    if (limit >= 1000) typeText = `📦 <strong>Bulk Commodity:</strong> High buy limit (${limit.toLocaleString()}).`;
    else if (limit < 100) typeText = `⚔️ <strong>One-off:</strong> Low buy limit (${limit}).`;
    else typeText = `⚖️ <strong>Standard:</strong> Moderate buy limit (${limit}).`;

    let consistencyText = "";
    if (analysis.isSpike) consistencyText = "<br>⚠️ <strong>Volume Spike:</strong> Today's volume is abnormally high (>2x avg). Be careful of fake trends.";
    else if (analysis.consistency === 'Volatile') consistencyText = "<br>⚡ <strong>Volatile:</strong> Volume fluctuates wildly. Hard to predict.";
    else consistencyText = "<br>✅ <strong>Consistent:</strong> Reliable daily trading volume.";

    // Long-term trend check
    if (analysis.avg7d > analysis.avg30d * 1.2) {
        consistencyText += " <br>🔥 <strong>Trending Up:</strong> 7d volume is >20% higher than 30d avg.";
    } else if (analysis.avg7d < analysis.avg30d * 0.8) {
        consistencyText += " <br>❄️ <strong>Cooling Down:</strong> 7d volume is <80% of 30d avg.";
    }

    if (vol > 100000 && roi > 2) {
        return `${typeText}<br>🔥 <strong>Hot Flip:</strong> Incredible demand meets solid ROI.${trendText}${consistencyText}`;
    }
    if (vol > 500000) {
        return `${typeText}<br>💎 <strong>Safe Bet:</strong> Massive liquidity. Instant flips.${trendText}${consistencyText}`;
    }
    if (roi > 10 && vol > 1000) {
        return `${typeText}<br>🚀 <strong>High Yield:</strong> Huge ${roi.toFixed(1)}% ROI! Be patient.${trendText}${consistencyText}`;
    }
    return `${typeText}<br>📊 <strong>Analysis:</strong> ${roi.toFixed(1)}% ROI with ${vol.toLocaleString()} daily volume.${trendText}${consistencyText}`;
}

async function updateItemInfo(item) {
    document.getElementById('item-name').textContent = item.name;
    const filename = item.icon.replace(/ /g, '_');
    document.getElementById('item-icon').src = `https://oldschool.runescape.wiki/images/${filename}`;

    // Update Stats
    const prices = latestPrices[item.id];
    let aiScore = 0;
    let aiReasoning = "Loading...";
    let trend = 0;

    if (prices) {
        const high = prices.high || 0;
        const low = prices.low || 0;
        const margin = high - low;
        const roi = low > 0 ? (margin / low) * 100 : 0;

        // Get Volume for AI
        const volInfo = volumeData[item.id];
        const volume = volInfo ? (volInfo.highPriceVolume + volInfo.lowPriceVolume) : 0;

        // Calculate Trend
        trend = calculateTrend(currentItemHistory);

        // Analyze Consistency
        const analysis = await analyzeVolumeConsistency(item.id);

        const itemWithStats = { ...item, roi, volume, margin };
        aiScore = calculateAiScore(itemWithStats);
        aiReasoning = generateAiReasoning(itemWithStats, trend, analysis);

        document.getElementById('stat-high').textContent = high.toLocaleString();
        document.getElementById('stat-low').textContent = low.toLocaleString();
        document.getElementById('stat-margin').textContent = margin.toLocaleString();
        document.getElementById('stat-roi').textContent = roi.toFixed(2) + '%';
        document.getElementById('stat-limit').textContent = (item.limit || 'Unknown').toLocaleString();
        document.getElementById('stat-avg-vol').textContent = Math.round(analysis.avg7d).toLocaleString();
        document.getElementById('stat-avg-30d').textContent = Math.round(analysis.avg30d).toLocaleString();
        document.getElementById('stat-consistency').textContent = analysis.consistency;

        // Update Trend UI
        const trendEl = document.getElementById('stat-trend');
        trendEl.textContent = (trend > 0 ? '+' : '') + trend.toFixed(2) + '%';
        trendEl.className = 'stat-value'; // Reset
        if (trend > 0.5) trendEl.classList.add('trend-up');
        else if (trend < -0.5) trendEl.classList.add('trend-down');
        else trendEl.classList.add('trend-flat');

    } else {
        ['stat-high', 'stat-low', 'stat-margin', 'stat-roi', 'stat-trend', 'stat-limit', 'stat-avg-vol', 'stat-avg-30d', 'stat-consistency'].forEach(id => document.getElementById(id).textContent = '--');
    }

    // Update AI Card
    document.getElementById('ai-reasoning').innerHTML = aiReasoning;
    document.getElementById('ai-score-display').textContent = `Score: ${aiScore}/100`;

    // Color code score
    const badge = document.getElementById('ai-score-display');
    if (aiScore >= 80) badge.style.color = '#4ade80'; // Green
    else if (aiScore >= 50) badge.style.color = '#facc15'; // Yellow
    else badge.style.color = '#f87171'; // Red
}

async function updateChart() {
    // Fetch data first so we have history for trend calc
    const rawData = await fetchData(currentItemId, currentTimeRange, viewMode);
    currentItemHistory = rawData; // Store for trend calc

    const filteredData = filterDataByRange(rawData, currentTimeRange);
    const chartData = processData(filteredData, viewMode, currentDayFilter);

    // Now update info (which uses currentItemHistory)
    const item = itemMapping.find(i => i.id === currentItemId);
    if (item) updateItemInfo(item);

    const ctx = document.getElementById('volumeChart').getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.5)');
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    if (chartInstance) {
        chartInstance.destroy();
    }

    let timeUnit = 'hour';
    let displayFormat = { hour: 'h a' };

    if (viewMode === 'timeline') {
        if (currentTimeRange === '7d') {
            timeUnit = 'day';
            displayFormat = { day: 'MMM d' };
        } else if (currentTimeRange === '30d' || currentTimeRange === 'ytd') {
            timeUnit = 'day';
            displayFormat = { day: 'MMM d' };
        }
    }

    let volLabel = viewMode === 'time-of-day' ? 'Avg Volume' : 'Volume';

    const isMobile = window.innerWidth < 768;
    const fontSize = isMobile ? 10 : 12;
    const tooltipPadding = isMobile ? 8 : 12;

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: volLabel,
                    data: chartData.map(d => ({ x: d.x, y: d.volume })),
                    borderColor: '#38bdf8',
                    backgroundColor: gradient,
                    borderWidth: 2,
                    fill: true,
                    yAxisID: 'y',
                    tension: 0.4, // Smooth curves
                    order: 2
                },
                {
                    label: 'Target Sell',
                    data: chartData.map(d => ({ x: d.x, y: d.priceHigh })),
                    borderColor: '#4ade80',
                    borderWidth: 1.5, // Thinner, solid line
                    pointRadius: 0,
                    yAxisID: 'y1',
                    tension: 0.4,
                    fill: {
                        target: '+1', // Fill to the next dataset (Target Buy)
                        above: 'rgba(74, 222, 128, 0.1)' // Green glow for profit zone
                    },
                    order: 1
                },
                {
                    label: 'Target Buy',
                    data: chartData.map(d => ({ x: d.x, y: d.priceLow })),
                    borderColor: '#f472b6',
                    borderWidth: 1.5, // Thinner, solid line
                    pointRadius: 0,
                    yAxisID: 'y1',
                    tension: 0.4,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: tooltipPadding,
                    displayColors: true,
                    titleFont: { size: fontSize + 2 },
                    bodyFont: { size: fontSize },
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += Math.round(context.parsed.y).toLocaleString();
                            }
                            return label;
                        },
                        title: function (context) {
                            const date = new Date(context[0].parsed.x);
                            if (viewMode === 'time-of-day') {
                                return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                            }
                            return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                        }
                    }
                },
                legend: {
                    labels: {
                        color: '#94a3b8',
                        font: {
                            family: "'Outfit', sans-serif",
                            size: fontSize
                        },
                        boxWidth: isMobile ? 8 : 12,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    },
                    onClick: function (e, legendItem, legend) {
                        const index = legendItem.datasetIndex;
                        const ci = legend.chart;
                        if (ci.isDatasetVisible(index)) {
                            ci.hide(index);
                            legendItem.hidden = true;
                        } else {
                            ci.show(index);
                            legendItem.hidden = false;
                        }

                        // Dynamic Axis Visibility
                        const isVolumeVisible = ci.isDatasetVisible(0); // Volume is index 0
                        ci.options.scales.y.display = isVolumeVisible;

                        ci.update();
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: timeUnit,
                        displayFormats: displayFormat,
                        tooltipFormat: 'MMM d, h:mm a'
                    },
                    grid: { display: false },
                    ticks: {
                        color: '#64748b',
                        font: { size: fontSize }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: !isMobile, text: 'Volume', color: '#38bdf8', font: { size: fontSize } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    beginAtZero: true,
                    grace: '5%',
                    ticks: {
                        color: '#64748b',
                        font: { size: fontSize },
                        callback: function (value) {
                            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                            if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
                            return value;
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: !isMobile, text: 'Price (GP)', color: '#4ade80', font: { size: fontSize } },
                    grid: { drawOnChartArea: false },
                    grace: '5%',
                    ticks: {
                        color: '#64748b',
                        font: { size: fontSize },
                        callback: function (value) {
                            if (value >= 1000000) return (value / 1000000).toFixed(2) + 'M';
                            if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
                            return value;
                        }
                    }
                }
            }
        }
    });

    renderHistogramCharts(filteredData);
}

function renderFlipTable() {
    const tbody = document.querySelector('#flip-table tbody');
    tbody.innerHTML = '';

    // Get filter values
    const minVolume = parseInt(document.getElementById('filter-volume').value) || 0;
    const minRoi = parseFloat(document.getElementById('filter-roi').value) || 0;
    const minMargin = parseInt(document.getElementById('filter-margin').value) || 0;
    const minLimit = parseInt(document.getElementById('filter-limit').value) || 0;
    const maxBuyPriceInput = parseInt(document.getElementById('filter-max-buy').value);
    const maxBuyPrice = isNaN(maxBuyPriceInput) ? Infinity : maxBuyPriceInput;

    // Filter F2P items with valid prices
    let flips = itemMapping.filter(item =>
        !item.members &&
        latestPrices[item.id] &&
        latestPrices[item.id].high &&
        latestPrices[item.id].low
    ).map(item => {
        const prices = latestPrices[item.id];
        const margin = prices.high - prices.low;
        const roi = (margin / prices.low) * 100;
        const limit = item.limit || 0;

        // Get 24h volume
        const volInfo = volumeData[item.id];
        const volume = volInfo ? (volInfo.highPriceVolume + volInfo.lowPriceVolume) : 0;

        // Get 1h volume
        const vol1hInfo = volume1hData[item.id];
        const vol1h = vol1hInfo ? (vol1hInfo.highPriceVolume + vol1hInfo.lowPriceVolume) : 0;

        const itemWithStats = { ...item, roi, volume, margin };
        const score = calculateAiScore(itemWithStats);

        return { ...item, ...prices, margin, roi, volume, vol1h, score };
    });

    // Apply Filters
    flips = flips.filter(item =>
        item.volume >= minVolume &&
        item.roi >= minRoi &&
        item.margin >= minMargin &&
        (item.limit || 0) >= minLimit &&
        item.low <= maxBuyPrice
    );

    // Sort
    flips.sort((a, b) => {
        let valA = a[sortColumn];
        let valB = b[sortColumn];

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    // Update Headers UI
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sort === sortColumn) {
            th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });

    // Render top 100
    flips.slice(0, 100).forEach(item => {
        const tr = document.createElement('tr');
        const iconUrl = `https://oldschool.runescape.wiki/images/${item.icon.replace(/ /g, '_')}`;

        // Color code score
        let scoreColor = '#f87171';
        if (item.score >= 80) scoreColor = '#4ade80';
        else if (item.score >= 50) scoreColor = '#facc15';

        // Activity Indicators
        let activityIcon = '';
        if (item.vol1h * 24 > item.volume * 2) activityIcon = '⚡'; // Spike
        else if (item.vol1h === 0 && item.volume > 1000) activityIcon = '💤'; // Dormant

        tr.innerHTML = `
            <td>
                <div class="item-cell">
                    <img src="${iconUrl}" alt="${item.name}">
                    <span>${item.name}</span>
                </div>
            </td>
            <td style="color: ${scoreColor}; font-weight: bold;">${item.score}</td>
            <td>${(item.limit || 'Unknown').toLocaleString()}</td>
            <td>${item.high.toLocaleString()}</td>
            <td>${item.low.toLocaleString()}</td>
            <td class="positive">+${item.margin.toLocaleString()}</td>
            <td class="${item.roi > 5 ? 'positive' : ''}">${item.roi.toFixed(2)}%</td>
            <td>${item.volume.toLocaleString()}</td>
            <td>${item.vol1h.toLocaleString()} ${activityIcon}</td>
        `;

        // Click to analyze
        tr.style.cursor = 'pointer';
        tr.onclick = () => {
            currentItemId = item.id;
            updateItemInfo(item);
            updateChart();
            // Switch tab
            document.querySelector('[data-tab="analyzer"]').click();
        };

        tbody.appendChild(tr);
    });
}

// Event Listeners for Sorting
document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
        const column = th.dataset.sort;
        if (sortColumn === column) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortColumn = column;
            sortDirection = 'desc'; // Default to desc for new column
        }
        renderFlipTable();
    });
});

// Event Listeners for Filters
['filter-volume', 'filter-roi', 'filter-margin', 'filter-limit', 'filter-max-buy'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderFlipTable);
});

// Search Functionality
const searchInput = document.getElementById('item-search');
const searchResults = document.getElementById('search-results');

searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (query.length < 2) {
        searchResults.style.display = 'none';
        return;
    }

    const matches = itemMapping.filter(item => item.name.toLowerCase().includes(query)).slice(0, 10);

    searchResults.innerHTML = '';
    if (matches.length > 0) {
        matches.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            const iconUrl = `https://oldschool.runescape.wiki/images/${item.icon.replace(/ /g, '_')}`;
            div.innerHTML = `<img src="${iconUrl}" alt="${item.name}"><span>${item.name}</span>`;
            div.onclick = () => {
                currentItemId = item.id;
                updateItemInfo(item);
                updateChart();
                searchInput.value = '';
                searchResults.style.display = 'none';
                // Switch to Analyzer tab
                document.querySelector('[data-tab="analyzer"]').click();
            };
            searchResults.appendChild(div);
        });
        searchResults.style.display = 'block';
    } else {
        searchResults.style.display = 'none';
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
        searchResults.style.display = 'none';
    }
});

// Time Range Controls
document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTimeRange = btn.dataset.range;

        // Update whichever chart is active
        if (document.getElementById('type-analysis-view').style.display !== 'none') {
            updateTypeChart();
        } else {
            updateChart();
        }
    });
});

// View Mode Toggle
document.getElementById('mode-toggle').addEventListener('change', (e) => {
    viewMode = e.target.checked ? 'time-of-day' : 'timeline';
    updateChart();
});

// Day Filter for Time-of-Day Analysis
document.getElementById('day-filter-select').addEventListener('change', (e) => {
    currentDayFilter = e.target.value;
    updateChart();
});

// Tab Switching
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
        document.getElementById(`${btn.dataset.tab}-view`).style.display = 'block';

        // Toggle Global Search Visibility
        const globalSearch = document.querySelector('header .search-container');
        if (btn.dataset.tab === 'type-analysis') {
            globalSearch.style.display = 'none';
        } else {
            globalSearch.style.display = 'block';
        }

        if (btn.dataset.tab === 'flipper') {
            renderFlipTable();
        } else if (btn.dataset.tab === 'type-analysis') {
            // If we have a query, ensure chart is rendered/updated
            if (currentTypeQuery) {
                // Small delay to ensure container is visible for Chart.js
                setTimeout(() => {
                    if (typeChartInstance) typeChartInstance.resize();
                }, 50);
            }
        }
    });
});

// Init
(async () => {
    await fetchMapping();
    await fetchLatestPrices();
    await fetch24hVolume();
    await fetch1hVolume();

    // Set initial item info with prices
    const initialItem = itemMapping.find(i => i.id === currentItemId);
    // Initial fetch to populate history for trend
    const rawData = await fetchData(currentItemId, currentTimeRange);
    currentItemHistory = rawData;

    if (initialItem) updateItemInfo(initialItem);

    updateChart();

    // Resize listener
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            updateChart();
            if (typeChartInstance) updateTypeChart(); // Update type chart on resize too
        }, 250);
    });
})();

// --- Item Type Analysis Logic ---

let typeChartInstance = null;
let currentTypeQuery = '';
let currentTypeData = null; // Store aggregated data

// Search Input Listener
const typeSearchInput = document.getElementById('type-search');
const typeSearchBtn = document.getElementById('type-search-btn');

function triggerTypeSearch() {
    const query = typeSearchInput.value.trim();
    if (query.length > 2) {
        analyzeItemType(query);
    } else {
        alert("Please enter at least 3 characters.");
    }
}

typeSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        triggerTypeSearch();
    }
});

typeSearchBtn.addEventListener('click', triggerTypeSearch);

async function analyzeItemType(query) {
    currentTypeQuery = query;
    const statsContainer = document.getElementById('type-stats');
    const btn = document.getElementById('type-search-btn');

    statsContainer.style.display = 'none'; // Hide while loading
    const originalBtnText = btn.textContent;
    btn.textContent = "Loading...";
    btn.disabled = true;

    try {
        // 1. Find matching items
        const matches = itemMapping.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));

        if (matches.length === 0) {
            alert("No items found matching that type.");
            return;
        }

        // 2. Filter for active items (must have 24h volume) and Sort by Volume
        // We limit to top 20 to avoid API spam and keep performance high
        const activeMatches = matches
            .map(item => {
                const volInfo = volumeData[item.id];
                const volume = volInfo ? (volInfo.highPriceVolume + volInfo.lowPriceVolume) : 0;
                return { ...item, volume };
            })
            .filter(item => item.volume > 0)
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 20);

        if (activeMatches.length === 0) {
            alert("No active items found for this type.");
            return;
        }

        // 3. Fetch Timeseries Data for all top items
        // We'll use the current global `currentTimeRange`
        const promises = activeMatches.map(item => fetchData(item.id, currentTimeRange));
        const allSeries = await Promise.all(promises);

        // 4. Aggregate Data
        // We need to combine volumes and calculate avg price at each timestamp
        // Since timestamps might not align perfectly, we'll bucket them.

        // Determine bucket size based on range (same logic as processData)
        let bucketSize = 300; // 5m
        if (currentTimeRange === '7d') bucketSize = 3600; // 1h
        if (currentTimeRange === '30d') bucketSize = 21600; // 6h

        const aggregatedMap = new Map(); // timestamp -> { totalVol, totalPriceVol, count }

        allSeries.forEach((series, index) => {
            if (!series) return;
            series.forEach(d => {
                // Normalize timestamp to bucket
                const timestamp = Math.floor(d.timestamp / bucketSize) * bucketSize;

                if (!aggregatedMap.has(timestamp)) {
                    aggregatedMap.set(timestamp, { totalVol: 0, totalPriceSum: 0, totalVolForPrice: 0 });
                }

                const bucket = aggregatedMap.get(timestamp);
                const vol = (d.highPriceVolume || 0) + (d.lowPriceVolume || 0);
                const price = d.avgHighPrice || d.avgLowPrice || 0;

                bucket.totalVol += vol;
                if (price > 0 && vol > 0) {
                    bucket.totalPriceSum += (price * vol);
                    bucket.totalVolForPrice += vol;
                }
            });
        });

        // Convert map to array and sort
        const aggregatedData = Array.from(aggregatedMap.entries())
            .map(([timestamp, data]) => ({
                x: timestamp * 1000,
                volume: data.totalVol,
                price: data.totalVolForPrice > 0 ? data.totalPriceSum / data.totalVolForPrice : 0
            }))
            .sort((a, b) => a.x - b.x);

        currentTypeData = aggregatedData; // Store for re-rendering

        // 5. Update UI
        renderTypeChart(aggregatedData);
        updateTypeStats(activeMatches, aggregatedData);
        renderTypeTable(activeMatches);

        statsContainer.style.display = 'grid';
    } catch (error) {
        console.error("Type Analysis Error:", error);
        alert("An error occurred while analyzing.");
    } finally {
        btn.textContent = originalBtnText;
        btn.disabled = false;
    }
}

function renderTypeChart(data) {
    const ctx = document.getElementById('typeChart').getContext('2d');

    if (typeChartInstance) {
        typeChartInstance.destroy();
    }

    const isMobile = window.innerWidth < 768;
    const fontSize = isMobile ? 10 : 12;

    // Determine time unit
    let timeUnit = 'hour';
    let displayFormat = { hour: 'h a' };
    if (currentTimeRange === '7d' || currentTimeRange === '30d') {
        timeUnit = 'day';
        displayFormat = { day: 'MMM d' };
    }

    typeChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Total Volume',
                    data: data.map(d => ({ x: d.x, y: d.volume })),
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    yAxisID: 'y',
                    tension: 0.4
                },
                {
                    label: 'Avg Price',
                    data: data.map(d => ({ x: d.x, y: d.price })),
                    borderColor: '#facc15', // Yellow for price
                    borderWidth: 2,
                    yAxisID: 'y1',
                    tension: 0.4,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    titleFont: { size: fontSize + 2 },
                    bodyFont: { size: fontSize }
                },
                legend: {
                    labels: {
                        color: '#94a3b8',
                        font: { family: "'Outfit', sans-serif", size: fontSize }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: timeUnit,
                        displayFormats: displayFormat
                    },
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { size: fontSize } }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: !isMobile, text: 'Total Volume', color: '#38bdf8', font: { size: fontSize } },
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: { color: '#64748b', font: { size: fontSize } }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: { display: !isMobile, text: 'Avg Price', color: '#facc15', font: { size: fontSize } },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#64748b', font: { size: fontSize } }
                }
            }
        }
    });
}

function updateTypeStats(items, data) {
    // Calculate totals from the aggregated data
    const totalVolume = data.reduce((sum, d) => sum + d.volume, 0);
    const avgPrice = data.length > 0 ? data[data.length - 1].price : 0; // Current avg price

    document.getElementById('type-total-vol').textContent = totalVolume.toLocaleString();
    document.getElementById('type-avg-price').textContent = Math.round(avgPrice).toLocaleString();
    document.getElementById('type-item-count').textContent = items.length;
}

function renderTypeTable(items) {
    const tbody = document.querySelector('#type-table tbody');
    tbody.innerHTML = '';

    items.forEach(item => {
        const tr = document.createElement('tr');
        const iconUrl = `https://oldschool.runescape.wiki/images/${item.icon.replace(/ /g, '_')}`;

        // Get latest price
        const price = latestPrices[item.id] ? latestPrices[item.id].high : 0;

        tr.innerHTML = `
            <td>
                <div class="item-cell">
                    <img src="${iconUrl}" alt="${item.name}">
                    <span>${item.name}</span>
                </div>
            </td>
            <td>${price.toLocaleString()}</td>
            <td>${item.volume.toLocaleString()}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Update Type Chart when time range changes (if active)
function updateTypeChart() {
    if (currentTypeQuery && document.getElementById('type-analysis-view').style.display !== 'none') {
        analyzeItemType(currentTypeQuery);
    }
}
