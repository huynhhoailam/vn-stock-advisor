// --- MAIN APP LOGIC ---

let mainChartInstance = null;
let vnindexChartInstance = null;
let scannedResults = []; // Cache for scanner

// Format functions
const fmtPrice = (val) => new Intl.NumberFormat('vi-VN').format(val * 1000);

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Setup Tab Navigation
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active classes
            navItems.forEach(nav => nav.classList.remove('active'));
            tabContents.forEach(tab => {
                tab.classList.remove('active');
                tab.classList.add('hidden');
            });

            // Add active class to current
            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            const targetTab = document.getElementById(targetId);
            targetTab.classList.remove('hidden');
            // Slight delay for animation
            setTimeout(() => targetTab.classList.add('active'), 10);

            // Special actions when entering tabs
            if (targetId === 'tab-portfolio') {
                renderPortfolio();
            }
        });
    });

    // 2. Load VN-INDEX on start
    await loadVNIndex();

    // 3. Setup Scanner Button
    document.getElementById('btn-scan').addEventListener('click', runScanner);
    
    // 4. Setup Analyze Button
    document.getElementById('btn-analyze').addEventListener('click', () => {
        const symbol = document.getElementById('search-symbol').value;
        if(symbol) analyzeSymbol(symbol);
    });

    document.getElementById('filter-signal').addEventListener('change', renderScannerResults);
});

// Load VN-INDEX
async function loadVNIndex() {
    const candles = await fetchStockHistory('VNINDEX', 30);
    if (!candles || candles.length < 2) return;

    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const change = current.close - prev.close;
    const changePct = (change / prev.close) * 100;

    const valEl = document.getElementById('vnindex-value');
    const changeEl = document.getElementById('vnindex-change');

    valEl.textContent = current.close.toFixed(2);
    
    const isUp = change >= 0;
    changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)} (${isUp ? '+' : ''}${changePct.toFixed(2)}%)`;
    changeEl.className = `text-sm font-semibold mb-1 ${isUp ? 'text-brand-up' : 'text-brand-down'}`;

    // Render Mini Chart
    renderMiniChart('vnindexChart', candles.slice(-20), isUp ? '#00C853' : '#FF3D00');
}

// Scanner Logic
async function runScanner() {
    const btn = document.getElementById('btn-scan');
    const progressDiv = document.getElementById('scan-progress');
    const progressBar = document.getElementById('scan-progress-bar');
    const percentEl = document.getElementById('scan-percent');
    
    btn.classList.add('hidden');
    progressDiv.classList.remove('hidden');
    
    scannedResults = []; // reset
    const total = HOSE_SYMBOLS.length;
    let completed = 0;

    // Use small batches to avoid blocking UI completely
    const batchSize = 5;
    for (let i = 0; i < total; i += batchSize) {
        const batch = HOSE_SYMBOLS.slice(i, i + batchSize);
        const promises = batch.map(async (symbol) => {
            const candles = await fetchStockHistory(symbol, 60); // 60 days is enough for TA
            if (candles) {
                const result = evaluateStock(symbol, candles);
                if (result) scannedResults.push(result);
            }
            completed++;
            const pct = Math.round((completed / total) * 100);
            progressBar.style.width = `${pct}%`;
            percentEl.textContent = `${pct}%`;
        });
        
        await Promise.all(promises);
    }

    // Sort by Score (Desc) and then by Volume Trend
    scannedResults.sort((a, b) => b.score - a.score || b.indicators.volPercent - a.indicators.volPercent);

    progressDiv.classList.add('hidden');
    btn.classList.remove('hidden');
    btn.innerHTML = '<i class="fas fa-check mr-2"></i> Đã Quét Xong';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-search mr-2"></i> Chạy Quét Lại'; }, 3000);

    // Switch to Scanner Tab automatically
    document.querySelector('[data-target="tab-scanner"]').click();
    renderScannerResults();
}

function renderScannerResults() {
    const container = document.getElementById('scanner-results');
    const filter = document.getElementById('filter-signal').value;

    if (scannedResults.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">Không có dữ liệu. Hãy chạy quét chuyên gia.</div>';
        return;
    }

    let filtered = scannedResults;
    if (filter === 'BUY') filtered = scannedResults.filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY');
    if (filter === 'SELL') filtered = scannedResults.filter(r => r.signal === 'SELL' || r.signal === 'STRONG_SELL');

    // Only take top 30 to display to keep DOM light
    filtered = filtered.slice(0, 30);

    let html = '';
    filtered.forEach((res, index) => {
        const up = res.indicators.macd && res.indicators.macd.macd > res.indicators.macd.signal;
        html += `
            <div class="bg-dark-card border border-dark-border rounded-xl p-4 flex items-center justify-between" onclick="analyzeSymbol('${res.symbol}')">
                <div class="flex items-center gap-3">
                    <div class="text-xs font-bold text-gray-500 w-4">${index + 1}</div>
                    <div>
                        <div class="font-bold text-white text-lg">${res.symbol}</div>
                        <div class="text-xs text-gray-400 mt-0.5">Điểm: <span class="font-bold ${res.score >= 60 ? 'text-brand-up' : (res.score <= 40 ? 'text-brand-down' : 'text-brand-ref')}">${res.score}/100</span></div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-semibold text-white">${fmtPrice(res.price)}</div>
                    <div class="text-[10px] px-2 py-1 rounded mt-1 font-bold inline-block ${res.signalClass}">
                        ${res.signalText}
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// Chart Analysis
async function analyzeSymbol(symbol) {
    symbol = symbol.toUpperCase().trim();
    document.getElementById('search-symbol').value = symbol;
    
    // Switch to chart tab
    document.querySelector('[data-target="tab-chart"]').click();
    
    const card = document.getElementById('detail-card');
    card.classList.remove('hidden');
    
    document.getElementById('detail-symbol').textContent = 'Đang tải...';
    
    const candles = await fetchStockHistory(symbol, 100);
    if (!candles || candles.length === 0) {
        document.getElementById('detail-symbol').textContent = 'Không tìm thấy mã';
        return;
    }

    const result = evaluateStock(symbol, candles);
    if (!result) return;

    document.getElementById('detail-symbol').textContent = symbol;
    document.getElementById('detail-price').textContent = fmtPrice(result.price) + ' VNĐ';
    
    const badge = document.getElementById('detail-signal-badge');
    badge.textContent = result.signalText + ` (${result.score}Đ)`;
    badge.className = `px-3 py-1 rounded-full text-xs font-bold ${result.signalClass}`;

    // Fill Indicators
    const indEl = document.getElementById('detail-indicators');
    indEl.innerHTML = `
        <div class="bg-[#0B0E14] p-3 rounded-lg border border-dark-border">
            <div class="text-xs text-gray-500 mb-1">RSI (14)</div>
            <div class="font-bold ${result.indicators.rsi > 70 ? 'text-brand-down' : (result.indicators.rsi < 30 ? 'text-brand-up' : 'text-white')}">${result.indicators.rsi ? result.indicators.rsi.toFixed(2) : '-'}</div>
        </div>
        <div class="bg-[#0B0E14] p-3 rounded-lg border border-dark-border">
            <div class="text-xs text-gray-500 mb-1">MACD</div>
            <div class="font-bold ${result.indicators.macd && result.indicators.macd.macd > result.indicators.macd.signal ? 'text-brand-up' : 'text-brand-down'}">
                ${result.indicators.macd ? result.indicators.macd.macd.toFixed(2) : '-'}
            </div>
        </div>
        <div class="bg-[#0B0E14] p-3 rounded-lg border border-dark-border">
            <div class="text-xs text-gray-500 mb-1">MA 20</div>
            <div class="font-bold ${result.price > result.indicators.sma20 ? 'text-brand-up' : 'text-brand-down'}">${result.indicators.sma20 ? fmtPrice(result.indicators.sma20) : '-'}</div>
        </div>
        <div class="bg-[#0B0E14] p-3 rounded-lg border border-dark-border">
            <div class="text-xs text-gray-500 mb-1">Vol vs TB</div>
            <div class="font-bold ${result.indicators.volPercent > 100 ? 'text-brand-up' : 'text-gray-400'}">${result.indicators.volPercent ? result.indicators.volPercent.toFixed(0) + '%' : '-'}</div>
        </div>
        <div class="col-span-2 bg-[#0B0E14] p-3 rounded-lg border border-dark-border">
            <div class="text-xs text-gray-500 mb-1">Nhận định chuyên gia</div>
            <ul class="list-disc list-inside ml-4 text-xs space-y-1 text-gray-300">
                ${result.reasons.map(r => `<li>${r}</li>`).join('')}
            </ul>
        </div>
    `;

    renderMainChart('mainChart', candles);
}

// Render Mini Line Chart for VN-Index
function renderMiniChart(canvasId, data, color) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (vnindexChartInstance) vnindexChartInstance.destroy();

    const labels = data.map(d => new Date(d.time).toLocaleDateString('vi-VN'));
    const prices = data.map(d => d.close);

    vnindexChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: prices,
                borderColor: color,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3,
                fill: true,
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 100);
                    gradient.addColorStop(0, color + '40'); // 40 = 25% opacity
                    gradient.addColorStop(1, color + '00');
                    return gradient;
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: { x: { display: false }, y: { display: false } },
            layout: { padding: 0 }
        }
    });
}

// Render Main Candlestick approximation (Line chart with filling)
function renderMainChart(canvasId, data) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (mainChartInstance) mainChartInstance.destroy();

    // Chart.js default doesn't have Candlestick without plugins, so we use a Line chart with close price
    // which is usually enough for retail mobile apps.
    const labels = data.map(d => new Date(d.time).toLocaleDateString('vi-VN'));
    const prices = data.map(d => d.close);

    const isUp = prices[prices.length-1] >= prices[0];
    const color = isUp ? '#00C853' : '#FF3D00';

    mainChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Giá',
                data: prices,
                borderColor: color,
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 10,
                tension: 0.1,
                fill: true,
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
                    gradient.addColorStop(0, color + '50'); 
                    gradient.addColorStop(1, '#0B0E1400');
                    return gradient;
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: { 
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#151924',
                    titleColor: '#D1D5DB',
                    bodyColor: '#fff',
                    borderColor: '#2A2E39',
                    borderWidth: 1
                }
            },
            scales: { 
                x: { 
                    display: true, 
                    grid: { display: false, drawBorder: false },
                    ticks: { maxTicksLimit: 5, color: '#6B7280' }
                }, 
                y: { 
                    display: true, 
                    position: 'right',
                    grid: { color: '#2A2E39', drawBorder: false },
                    ticks: { color: '#6B7280' }
                } 
            },
        }
    });
}
