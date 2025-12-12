let currentItemId = parseInt(localStorage.getItem('osrs_currentItemId')) || 888; // Default: Mithril arrows
let currentTimeRange = localStorage.getItem('osrs_currentTimeRange') || '24h';
let viewMode = localStorage.getItem('osrs_viewMode') || 'timeline'; // 'timeline' or 'time-of-day'
let itemMapping = [];
let latestPrices = {};
let volumeData = {}; // Stores 24h volume
let volume1hData = {}; // Stores 1h volume
let chartInstance = null;
let currentItemHistory = []; // Store history for trend calc

function smoothSeries(data, key, windowSize = 1) {
    if (windowSize <= 1 || data.length === 0) {
        return data.map(point => point[key]);
    }
    const half = Math.floor(windowSize / 2);
    return data.map((point, idx) => {
        let sum = 0;
        let count = 0;
        for (let i = Math.max(0, idx - half); i <= Math.min(data.length - 1, idx + half); i++) {
            const value = data[i][key];
            if (value !== null && value !== undefined) {
                sum += value;
                count++;
            }
        }
        return count > 0 ? sum / count : null;
    });
}

function calculateNetSellPrice(price) {
    if (typeof price !== 'number') return 0;
    return price >= 50 ? Math.floor(price * 0.98) : price;
}

// Sort/Filter State
let sortColumn = 'score'; // Default sort by AI Score
let sortDirection = 'desc';

const API_BASE = 'https://prices.runescape.wiki/api/v1/osrs';

// Chart.js configuration
Chart.defaults.color = '#475569';
Chart.defaults.borderColor = 'rgba(226, 232, 240, 0.7)';
Chart.defaults.font.family = "'Outfit', sans-serif";
Chart.defaults.font.size = 13;

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

async function fetchData(id, range) {
    let timestep = '5m';
    if (range === '7d') timestep = '1h';
    if (range === '30d') timestep = '6h';
    if (range === 'ytd') timestep = '24h';

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

function processData(data, range, mode) {
    data.sort((a, b) => a.timestamp - b.timestamp);

    const now = Math.floor(Date.now() / 1000);
    let startTime;

    if (range === '24h') startTime = now - (24 * 60 * 60);
    else if (range === '7d') startTime = now - (7 * 24 * 60 * 60);
    else if (range === '30d') startTime = now - (30 * 24 * 60 * 60);
    else if (range === 'ytd') {
        const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime() / 1000;
        startTime = startOfYear;
    }

    const filteredData = data.filter(d => d.timestamp > startTime);

    if (mode === 'timeline') {
        return filteredData.map(d => ({
            x: d.timestamp * 1000,
            volume: (d.highPriceVolume || 0) + (d.lowPriceVolume || 0),
            priceHigh: d.avgHighPrice,
            priceLow: d.avgLowPrice
        }));
    }

    const hourlyBuckets = new Array(24).fill(0).map(() => ({
        totalVolume: 0,
        totalHigh: 0, countHigh: 0,
        totalLow: 0, countLow: 0,
        count: 0
    }));

    filteredData.forEach(d => {
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
        const netHigh = calculateNetSellPrice(high);
        const margin = netHigh - low;
        const roi = low > 0 ? (margin / low) * 100 : 0;

        // Get Volume for AI
        const volInfo = volumeData[item.id];
        const volume = volInfo ? (volInfo.highPriceVolume + volInfo.lowPriceVolume) : 0;

        // Calculate Trend
        trend = calculateTrend(currentItemHistory);

        // Analyze Consistency
        const analysis = await analyzeVolumeConsistency(item.id);

        const itemWithStats = { ...item, roi, volume, margin, netHigh };
        aiScore = calculateAiScore(itemWithStats);
        aiReasoning = generateAiReasoning(itemWithStats, trend, analysis);

        document.getElementById('stat-high').textContent = high.toLocaleString();
        document.getElementById('stat-net-high').textContent = netHigh.toLocaleString();
        document.getElementById('stat-low').textContent = low.toLocaleString();

        const marginEl = document.getElementById('stat-margin');
        marginEl.textContent = `${margin >= 0 ? '+' : ''}${margin.toLocaleString()}`;
        marginEl.className = 'stat-value';
        if (margin > 0) marginEl.classList.add('trend-up');
        else if (margin < 0) marginEl.classList.add('trend-down');
        else marginEl.classList.add('trend-flat');

        const roiEl = document.getElementById('stat-roi');
        roiEl.textContent = `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%`;
        roiEl.className = 'stat-value';
        if (roi > 0.5) roiEl.classList.add('trend-up');
        else if (roi < -0.5) roiEl.classList.add('trend-down');
        else roiEl.classList.add('trend-flat');

        document.getElementById('stat-limit-display').textContent = (item.limit || 'Unknown').toLocaleString();
        document.getElementById('stat-avg-vol').textContent = Math.round(analysis.avg7d).toLocaleString();
        document.getElementById('stat-consistency').textContent = analysis.consistency;

        // Update Trend UI
        const trendEl = document.getElementById('stat-trend');
        trendEl.textContent = (trend > 0 ? '+' : '') + trend.toFixed(2) + '%';
        trendEl.className = 'stat-value'; // Reset
        if (trend > 0.5) trendEl.classList.add('trend-up');
        else if (trend < -0.5) trendEl.classList.add('trend-down');
        else trendEl.classList.add('trend-flat');

    } else {
        ['stat-high', 'stat-net-high', 'stat-low', 'stat-margin', 'stat-roi', 'stat-trend', 'stat-limit-display', 'stat-avg-vol', 'stat-consistency'].forEach(id => document.getElementById(id).textContent = '--');
        document.getElementById('stat-margin').className = 'stat-value';
        document.getElementById('stat-roi').className = 'stat-value';
        document.getElementById('stat-trend').className = 'stat-value';
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
    const rawData = await fetchData(currentItemId, currentTimeRange);
    currentItemHistory = rawData; // Store for trend calc

    const chartData = processData(rawData, currentTimeRange, viewMode);

    // Now update info (which uses currentItemHistory)
    const item = itemMapping.find(i => i.id === currentItemId);
    if (item) updateItemInfo(item);

    const ctx = document.getElementById('volumeChart').getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height || 400);
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.25)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.02)');

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
    const fontSize = isMobile ? 11 : 13;
    const tooltipPadding = isMobile ? 8 : 14;

    const smoothingWindow = (viewMode === 'timeline' && currentTimeRange === '24h') ? 7 : 1;
    const smoothedHigh = smoothSeries(chartData, 'priceHigh', smoothingWindow);
    const smoothedLow = smoothSeries(chartData, 'priceLow', smoothingWindow);

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: volLabel,
                    data: chartData.map(d => ({ x: d.x, y: d.volume })),
                    borderColor: '#2563eb',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    fill: true,
                    yAxisID: 'y',
                    tension: 0.5,
                    cubicInterpolationMode: 'monotone',
                    spanGaps: true,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    pointHoverBackgroundColor: '#2563eb',
                    order: 3
                },
                {
                    label: 'Target Sell',
                    data: chartData.map((d, idx) => ({ x: d.x, y: smoothedHigh[idx] })),
                    borderColor: '#059669',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    yAxisID: 'y1',
                    tension: 0.45,
                    cubicInterpolationMode: 'monotone',
                    spanGaps: true,
                    order: 1
                },
                {
                    label: 'Target Buy',
                    data: chartData.map((d, idx) => ({ x: d.x, y: smoothedLow[idx] })),
                    borderColor: '#f97316',
                    borderWidth: 2.2,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    yAxisID: 'y1',
                    tension: 0.45,
                    cubicInterpolationMode: 'monotone',
                    spanGaps: true,
                    order: 2,
                    fill: {
                        target: '-1',
                        above: 'rgba(16, 185, 129, 0.08)',
                        below: 'transparent'
                    }
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 600,
                easing: 'easeOutQuart'
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                decimation: {
                    enabled: true,
                    algorithm: 'lttb',
                    samples: 250
                },
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: 'rgba(148, 163, 184, 0.4)',
                    borderWidth: 1,
                    padding: tooltipPadding,
                    displayColors: true,
                    titleFont: { size: fontSize + 1, weight: '600' },
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
                        color: '#475569',
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
                    grid: { color: 'rgba(226, 232, 240, 0.5)' },
                    ticks: {
                        color: '#94a3b8',
                        font: { size: fontSize }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: { display: !isMobile, text: volLabel, color: '#2563eb', font: { size: fontSize } },
                    grid: { color: 'rgba(226, 232, 240, 0.5)' },
                    beginAtZero: true,
                    grace: '5%',
                    ticks: {
                        color: '#94a3b8',
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
                    title: { display: !isMobile, text: 'Price (GP)', color: '#0f172a', font: { size: fontSize } },
                    grid: { drawOnChartArea: false },
                    grace: '5%',
                    ticks: {
                        color: '#94a3b8',
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
}

function renderFlipTable() {
    const tbody = document.querySelector('#flip-table tbody');
    tbody.innerHTML = '';

    // Get filter values
    const minVolume = parseInt(document.getElementById('filter-volume').value) || 0;
    const minMargin = parseInt(document.getElementById('filter-margin').value) || 0;
    const minLimit = parseInt(document.getElementById('filter-limit').value) || 0;

    // Filter F2P items with valid prices
    let flips = itemMapping.filter(item =>
        !item.members &&
        latestPrices[item.id] &&
        latestPrices[item.id].high &&
        latestPrices[item.id].low
    ).map(item => {
        const prices = latestPrices[item.id];
        const highPrice = prices.high || 0;
        const lowPrice = prices.low || 0;
        const netSell = calculateNetSellPrice(highPrice);
        const margin = netSell - lowPrice;
        const roi = lowPrice > 0 ? (margin / lowPrice) * 100 : 0;

        // Get 24h volume
        const volInfo = volumeData[item.id];
        const volume = volInfo ? (volInfo.highPriceVolume + volInfo.lowPriceVolume) : 0;

        // Get 1h volume
        const vol1hInfo = volume1hData[item.id];
        const vol1h = vol1hInfo ? (vol1hInfo.highPriceVolume + vol1hInfo.lowPriceVolume) : 0;

        const itemWithStats = { ...item, roi, volume, margin };
        const score = calculateAiScore(itemWithStats);

        return { ...item, ...prices, netSell, margin, roi, volume, vol1h, score };
    });

    // Apply Filters
    flips = flips.filter(item =>
        item.volume >= minVolume &&
        item.margin >= minMargin &&
        (item.limit || 0) >= minLimit
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

        const marginClass = item.margin >= 0 ? 'positive' : 'negative';
        const marginDisplay = `${item.margin >= 0 ? '+' : ''}${item.margin.toLocaleString()}`;

        tr.innerHTML = `
            <td>
                <div class="item-cell">
                    <img src="${iconUrl}" alt="${item.name}">
                    <span>${item.name}</span>
                </div>
            </td>
            <td style="color: ${scoreColor}; font-weight: bold;">${item.score}</td>
            <td>${item.high.toLocaleString()}</td>
            <td>${item.low.toLocaleString()}</td>
            <td class="${marginClass}">${marginDisplay}</td>
            <td>${item.volume.toLocaleString()}</td>
            <td>${(item.limit || 'Unknown').toLocaleString()}</td>
        `;

        // Click to analyze
        tr.style.cursor = 'pointer';
        tr.onclick = () => {
            currentItemId = item.id;
            localStorage.setItem('osrs_currentItemId', currentItemId);
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
['filter-volume', 'filter-margin', 'filter-limit'].forEach(id => {
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
                localStorage.setItem('osrs_currentItemId', currentItemId);
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
        localStorage.setItem('osrs_currentTimeRange', currentTimeRange);
        updateChart();
    });
});

// View Mode Toggle
document.getElementById('mode-toggle').addEventListener('change', (e) => {
    viewMode = e.target.checked ? 'time-of-day' : 'timeline';
    localStorage.setItem('osrs_viewMode', viewMode);
    updateChart();
});

// Tab Switching
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        const targetView = document.getElementById(`${btn.dataset.tab}-view`);
        if (targetView) targetView.classList.add('active');

        // Save active tab to localStorage
        localStorage.setItem('osrs_activeTab', btn.dataset.tab);

        if (btn.dataset.tab === 'flipper') {
            renderFlipTable();
        }
    });
});

// Init
(async () => {
    await fetchMapping();
    await fetchLatestPrices();
    await fetch24hVolume();
    await fetch1hVolume();

    // Restore UI state from localStorage
    // Set active time range button
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    const activeRangeBtn = document.querySelector(`.range-btn[data-range="${currentTimeRange}"]`);
    if (activeRangeBtn) activeRangeBtn.classList.add('active');

    // Set view mode toggle
    const modeToggle = document.getElementById('mode-toggle');
    if (modeToggle) modeToggle.checked = (viewMode === 'time-of-day');

    // Restore active tab
    const savedTab = localStorage.getItem('osrs_activeTab');
    if (savedTab) {
        const tabBtn = document.querySelector(`.nav-btn[data-tab="${savedTab}"]`);
        if (tabBtn) tabBtn.click();
    }

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
        }, 250);
    });
})();
