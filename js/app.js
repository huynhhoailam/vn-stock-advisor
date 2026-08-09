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

    // 2. Load VN-INDEX on start (dùng DEFAULT_HOSE_SYMBOLS làm nền cho scanner)
    await loadVNIndex();

    // 3. Setup Scanner Button
    document.getElementById('btn-scan').addEventListener('click', runScanner);
    
    // 4. Setup Analyze Button
    document.getElementById('btn-analyze').addEventListener('click', () => {
        const symbol = document.getElementById('search-symbol').value;
        if(symbol) analyzeSymbol(symbol);
    });

    document.getElementById('filter-signal').addEventListener('change', renderScannerResults);

    // 5. Setup Strategy Chip Filters
    window._activeStrategy = 'ALL';
    document.querySelectorAll('.strategy-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.strategy-chip').forEach(c => c.classList.remove('active-chip', 'ring-2', 'ring-white/30'));
            chip.classList.add('active-chip', 'ring-2', 'ring-white/30');
            window._activeStrategy = chip.dataset.strategy;
            renderScannerResults();
        });
    });

    // 6. Setup Top Market Switcher on Overview Tab
    document.getElementById('btn-top-val')?.addEventListener('click', () => loadOverviewTopMarket('val'));
    document.getElementById('btn-top-vol')?.addEventListener('click', () => loadOverviewTopMarket('vol'));
    loadOverviewTopMarket('val');

    // 7. Setup Gemini Settings Modal
    const modalSettings = document.getElementById('modal-settings');
    const keyInput = document.getElementById('gemini-key-input');

    // Hàm cập nhật badge trạng thái Key
    const updateKeyStatusBadge = () => {
        const statusEl = document.getElementById('ai-key-status');
        if (!statusEl) return;
        const savedKey = localStorage.getItem('geminiApiKey') || '';
        const isValidKey = savedKey.length >= 20 && !savedKey.includes(' ');
        if (isValidKey) {
            statusEl.className = 'mb-3 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-green-500/10 text-green-400 border border-green-500/30';
            statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Gemini AI đã kích hoạt — Phân tích thông minh đang hoạt động';
        } else {
            statusEl.className = 'mb-3 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30';
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Chưa có Key — Đang dùng bộ phân tích TA nội bộ';
        }
        statusEl.classList.remove('hidden');
    };

    const openSettings = () => {
        if (keyInput) keyInput.value = localStorage.getItem('geminiApiKey') || '';
        updateKeyStatusBadge();
        modalSettings?.classList.remove('hidden');
    };

    document.getElementById('btn-open-settings')?.addEventListener('click', openSettings);
    document.getElementById('btn-config-ai')?.addEventListener('click', openSettings);
    document.getElementById('btn-close-settings')?.addEventListener('click', () => modalSettings?.classList.add('hidden'));

    // Toggle show/hide key
    document.getElementById('btn-toggle-key-visibility')?.addEventListener('click', () => {
        const icon = document.querySelector('#btn-toggle-key-visibility i');
        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            icon?.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            keyInput.type = 'password';
            icon?.classList.replace('fa-eye-slash', 'fa-eye');
        }
    });

    document.getElementById('btn-save-gemini-key')?.addEventListener('click', () => {
        const val = keyInput?.value.trim() || '';
        if (val && (val.length < 20 || val.includes(' '))) {
            alert('⚠️ API Key không đúng định dạng!\nKey Gemini AI phải có ít nhất 20 ký tự và không chứa khoảng trắng.\nVào aistudio.google.com/api-keys để lấy Key đúng.');
            return;
        }
        // Xóa session cache để re-analyze với key mới
        Object.keys(sessionStorage).filter(k => k.startsWith('ai_news_')).forEach(k => sessionStorage.removeItem(k));

        if (val) {
            localStorage.setItem('geminiApiKey', val);
        } else {
            localStorage.removeItem('geminiApiKey');
        }
        updateKeyStatusBadge();
        modalSettings?.classList.add('hidden');

        // Tự động re-analyze nếu đang xem một mã
        const currentSymbol = document.getElementById('search-symbol')?.value?.trim()?.toUpperCase();
        const detailCard = document.getElementById('detail-card');
        if (currentSymbol && detailCard && !detailCard.classList.contains('hidden')) {
            setTimeout(() => analyzeSymbol(currentSymbol), 200);
        }
    });

    document.getElementById('btn-clear-gemini-key')?.addEventListener('click', () => {
        localStorage.removeItem('geminiApiKey');
        if (keyInput) keyInput.value = '';
        Object.keys(sessionStorage).filter(k => k.startsWith('ai_news_')).forEach(k => sessionStorage.removeItem(k));
        updateKeyStatusBadge();
        modalSettings?.classList.add('hidden');
    });

    // Auto-open Settings nếu chưa từng nhập Key (lần đầu dùng app)
    if (!localStorage.getItem('geminiApiKey') && !localStorage.getItem('ai_setup_done')) {
        setTimeout(() => {
            localStorage.setItem('ai_setup_done', '1');
            openSettings();
        }, 2000);
    }
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

// Widget Top Thị Trường Realtime trên Tab Tổng Quan
let overviewMarketData = []; // Cache VPS snapshot
async function loadOverviewTopMarket(type = 'val') {
    const btnVal = document.getElementById('btn-top-val');
    const btnVol = document.getElementById('btn-top-vol');
    const listContainer = document.getElementById('top-market-list');

    if (!listContainer) return;

    if (type === 'val') {
        if (btnVal) btnVal.className = 'px-2.5 py-1 rounded-lg font-semibold bg-brand-primary text-white transition-colors';
        if (btnVol) btnVol.className = 'px-2.5 py-1 rounded-lg font-semibold text-gray-400 hover:text-white transition-colors';
    } else {
        if (btnVol) btnVol.className = 'px-2.5 py-1 rounded-lg font-semibold bg-brand-primary text-white transition-colors';
        if (btnVal) btnVal.className = 'px-2.5 py-1 rounded-lg font-semibold text-gray-400 hover:text-white transition-colors';
    }

    // Tải dữ liệu bảng giá VPS nếu chưa có
    if (overviewMarketData.length === 0) {
        listContainer.innerHTML = '<div class="text-center text-gray-500 text-xs py-4">Đang tải bảng giá realtime VPS...</div>';
        const res = await getTopLiquidityHoseSymbols(60);
        overviewMarketData = Object.values(res.vpsMap || {});
    }

    if (overviewMarketData.length === 0) {
        listContainer.innerHTML = '<div class="text-center text-gray-500 text-xs py-4">Không thể tải dữ liệu thị trường realtime.</div>';
        return;
    }

    // Sắp xếp theo Giá trị hoặc Khối lượng
    const sorted = [...overviewMarketData].sort((a, b) => {
        return type === 'val' ? b.tradingValue - a.tradingValue : b.lot - a.lot;
    }).slice(0, 5);

    let html = '';
    sorted.forEach((item, index) => {
        const isUp = item.changePc >= 0;
        const colorClass = isUp ? 'text-brand-up' : 'text-brand-down';
        const valFormatted = (item.tradingValue / 1000000000).toFixed(1) + ' tỷ';
        const volFormatted = (item.lot * 100 / 1000000).toFixed(2) + ' tr CP';

        html += `
            <div class="bg-[#0B0E14] border border-dark-border/80 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:border-brand-primary transition-colors" onclick="analyzeSymbol('${item.symbol}')">
                <div class="flex items-center gap-3">
                    <div class="w-5 text-center text-xs font-bold text-gray-500">${index + 1}</div>
                    <div>
                        <div class="font-bold text-white text-base">${item.symbol}</div>
                        <div class="text-[11px] text-gray-400 mt-0.5">${type === 'val' ? 'GTGD: <span class="text-white font-medium">' + valFormatted + '</span>' : 'KLGD: <span class="text-white font-medium">' + volFormatted + '</span>'}</div>
                    </div>
                </div>
                <div class="text-right">
                    <div class="font-semibold text-white text-sm">${fmtPrice(item.price)}</div>
                    <div class="text-xs font-bold ${colorClass} mt-0.5">
                        ${isUp ? '+' : ''}${item.changePc.toFixed(2)}%
                    </div>
                </div>
            </div>
        `;
    });

    listContainer.innerHTML = html;
}

// Scanner Logic
async function runScanner() {
    const btn = document.getElementById('btn-scan');
    const progressDiv = document.getElementById('scan-progress');
    const progressBar = document.getElementById('scan-progress-bar');
    const percentEl = document.getElementById('scan-percent');
    const statusTextEl = document.getElementById('scan-status-text');

    btn.classList.add('hidden');
    progressDiv.classList.remove('hidden');

    scannedResults = []; // reset

    // 2. Lọc Top 60 mã HOSE thanh khoản cao nhất qua VPS API & lấy realtime metadata
    const { topSymbols, vpsMap } = await getTopLiquidityHoseSymbols(60, (pct, msg) => {
        progressBar.style.width = `${pct}%`;
        percentEl.textContent = `${pct}%`;
        statusTextEl.textContent = msg;
    });

    // 3. Phân tích kỹ thuật chuyên sâu (120 ngày) cho Top mã thanh khoản
    const total = topSymbols.length;
    let completed = 0;
    const batchSize = 20; // 20 mã song song/đợt -> Chỉ 3 đợt lặp là xong toàn bộ

    for (let i = 0; i < total; i += batchSize) {
        const batch = topSymbols.slice(i, i + batchSize);
        const promises = batch.map(async (symbol) => {
            try {
                const candles = await fetchStockHistory(symbol, 120);
                if (candles && candles.length >= 20) {
                    const vpsInfo = vpsMap[symbol] || null;
                    const result = evaluateStock(symbol, candles, vpsInfo);
                    if (result) scannedResults.push(result);
                }
            } catch (err) {
                console.warn(`Lỗi khi phân tích ${symbol}:`, err);
            }
            completed++;
            const pct = 40 + Math.round((completed / total) * 60); // 40% -> 100%
            progressBar.style.width = `${pct}%`;
            percentEl.textContent = `${pct}%`;
            statusTextEl.textContent = `Bước 2/2: Đang phân tích kỹ thuật... (${completed}/${total})`;
        });

        await Promise.all(promises);
    }

    // Sắp xếp kết quả theo Điểm Chuyên Gia (Giảm dần)
    scannedResults.sort((a, b) => b.score - a.score || b.indicators.volPercent - a.indicators.volPercent);

    progressDiv.classList.add('hidden');
    btn.classList.remove('hidden');
    btn.innerHTML = '<i class="fas fa-check mr-2"></i> Đã Quét Xong';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-search mr-2"></i> Chạy Quét Lại'; }, 3000);

    // Chuyển sang Tab Bộ lọc để hiển thị kết quả
    document.querySelector('[data-target="tab-scanner"]').click();
    renderScannerResults();
}

function renderScannerResults() {
    const container = document.getElementById('scanner-results');
    const filter = document.getElementById('filter-signal').value;
    const strategyFilter = window._activeStrategy || 'ALL';

    if (scannedResults.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-10">Không có dữ liệu. Hãy bấm "Chạy Quét Chuyên Gia" ở tab Tổng quan.</div>';
        return;
    }

    let filtered = [...scannedResults];

    // Lọc theo Tín hiệu Mua/Bán
    if (filter === 'BUY') filtered = filtered.filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY');
    if (filter === 'SELL') filtered = filtered.filter(r => r.signal === 'SELL' || r.signal === 'STRONG_SELL');

    // Lọc theo Tín hiệu Chiến lược
    if (strategyFilter !== 'ALL') {
        filtered = filtered.filter(r => r.strategies && r.strategies.some(s => s.type === strategyFilter));
    }

    // Sắp xếp ưu tiên: STRONG_BUY > BUY > KHÁC, sau đó theo Điểm Chuyên Gia giảm dần
    const signalWeight = { 'STRONG_BUY': 4, 'BUY': 3, 'HOLD': 2, 'SELL': 1, 'STRONG_SELL': 0 };
    filtered.sort((a, b) => {
        const wA = signalWeight[a.signal] || 0;
        const wB = signalWeight[b.signal] || 0;
        if (wA !== wB) return wB - wA;
        return b.score - a.score || b.indicators.volPercent - a.indicators.volPercent;
    });

    // Chỉ giữ Top 15 mã xuất sắc nhất để người dùng dễ tập trung
    filtered = filtered.slice(0, 15);

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center py-10">
            <div class="text-3xl mb-2">⚠️</div>
            <div class="text-gray-400 text-sm">Không có mã nào đạt tiêu chí xuất sắc ở bộ lọc này.<br>Hãy thử chuyển sang bộ lọc khác hoặc chọn Tất cả.</div>
        </div>`;
        return;
    }

    let html = '';
    filtered.forEach((res, index) => {
        const strategyBadges = (res.strategies || []).map(s =>
            `<span class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${s.badgeClass}">${s.label}</span>`
        ).join(' ');

        const isTopPick = index < 3 && (res.signal === 'STRONG_BUY' || res.signal === 'BUY');
        const rankBadge = isTopPick 
            ? `<span class="bg-amber-500/20 text-amber-400 text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-amber-500/40">#${index + 1} TOP PICK</span>`
            : `<span class="text-xs font-bold text-gray-500 w-4">${index + 1}</span>`;

        const topReason = res.reasons && res.reasons.length > 0 ? res.reasons[0] : '';

        html += `
            <div class="bg-dark-card border border-dark-border rounded-xl p-4 active:scale-[0.98] transition-transform cursor-pointer hover:border-brand-primary/50" onclick="analyzeSymbol('${res.symbol}')">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        ${rankBadge}
                        <div>
                            <div class="font-bold text-white text-lg flex items-center gap-1.5">
                                ${res.symbol}
                            </div>
                            <div class="text-xs text-gray-400 mt-0.5">Điểm: <span class="font-bold ${res.score >= 70 ? 'text-brand-up' : (res.score <= 40 ? 'text-brand-down' : 'text-brand-ref')}">${res.score}/100</span></div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="font-semibold text-white">${fmtPrice(res.price)}</div>
                        <div class="text-[10px] px-2 py-0.5 rounded mt-1 font-bold inline-block ${res.signalClass}">
                            ${res.signalText}
                        </div>
                    </div>
                </div>

                ${topReason ? `
                    <div class="text-xs text-gray-300 mt-2.5 pt-2 border-t border-dark-border/40 flex items-center gap-1">
                        <span class="text-amber-400 font-bold">●</span> <span class="truncate">${topReason}</span>
                    </div>
                ` : ''}

                ${strategyBadges ? `<div class="flex flex-wrap gap-1.5 mt-2">${strategyBadges}</div>` : ''}
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

    // Render Strategy Tags
    const tagsEl = document.getElementById('detail-strategy-tags');
    if (result.strategies && result.strategies.length > 0) {
        tagsEl.innerHTML = result.strategies.map(s =>
            `<span class="px-2 py-1 rounded-full text-xs font-semibold ${s.badgeClass}" title="${s.desc}">${s.label}</span>`
        ).join('');
    } else {
        tagsEl.innerHTML = '';
    }

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

    // Render AI News & Sentiment Analysis
    const aiNewsEl = document.getElementById('detail-ai-news');
    if (aiNewsEl) {
        aiNewsEl.innerHTML = '<div class="text-center text-gray-500 py-3 text-xs"><i class="fas fa-spinner fa-spin mr-1 text-purple-400"></i> AI đang phân tích...</div>';
        getAINewsAnalysis(symbol, result).then(({ newsList, analysis }) => {
            let newsItemsHtml = '';
            if (newsList && newsList.length > 0) {
                newsItemsHtml = newsList.slice(0, 3).map(n => `
                    <div class="border-b border-dark-border/40 pb-1.5 last:border-b-0">
                        <a href="${n.url}" target="_blank" class="text-gray-200 hover:text-brand-primary font-medium line-clamp-1 block">
                            <i class="fas fa-newspaper text-gray-500 text-[10px] mr-1"></i>${n.title}
                        </a>
                        <div class="text-[10px] text-gray-500 mt-0.5">${n.date ? new Date(n.date).toLocaleDateString('vi-VN') : ''}</div>
                    </div>
                `).join('');
            } else {
                newsItemsHtml = '<div class="text-gray-500 text-[11px]">Chưa ghi nhận tin tức nổi bật gần nhất.</div>';
            }

            // Quyết định label nguồn phân tích
            const sourceLabel = analysis.isAIGenerated 
                ? '<span class="text-[9px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/30">✨ Gemini AI</span>'
                : newsList.length > 0
                    ? '<span class="text-[9px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">📰 NLP Tin tức</span>'
                    : '<span class="text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">📊 Phân tích TA</span>';

            // Tin tức section hoặc link tìm kiếm báo
            let newsSection = '';
            if (newsList.length > 0) {
                const newsItems = newsList.slice(0, 3).map(n => `
                    <div class="border-b border-dark-border/40 pb-1.5 last:border-b-0">
                        <a href="${n.url}" target="_blank" class="text-gray-200 hover:text-brand-primary font-medium line-clamp-1 block text-[11px]">
                            <i class="fas fa-newspaper text-gray-500 text-[10px] mr-1"></i>${n.title}
                        </a>
                        <div class="text-[10px] text-gray-500 mt-0.5">${n.date ? new Date(n.date).toLocaleDateString('vi-VN') : ''}</div>
                    </div>
                `).join('');
                newsSection = `<div class="space-y-1.5">${newsItems}</div>`;
            } else {
                newsSection = `
                    <div class="flex gap-2">
                        <a href="https://cafef.vn/tim-kiem.chn?keywords=${symbol}" target="_blank" 
                            class="flex-1 text-center text-[11px] text-brand-primary border border-brand-primary/30 bg-brand-primary/5 rounded-lg py-1.5 hover:bg-brand-primary/10 transition-colors">
                            <i class="fas fa-search mr-1"></i>Tìm tin trên CafeF
                        </a>
                        <a href="https://vndirect.com.vn/catalog/cp/cp-${symbol.toLowerCase()}.shtml" target="_blank"
                            class="flex-1 text-center text-[11px] text-purple-400 border border-purple-500/30 bg-purple-500/5 rounded-lg py-1.5 hover:bg-purple-500/10 transition-colors">
                            <i class="fas fa-chart-bar mr-1"></i>Hồ sơ VNDirect
                        </a>
                    </div>`;
            }

            aiNewsEl.innerHTML = `
                <div class="bg-[#0B0E14] border border-dark-border rounded-xl p-3 space-y-2.5">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-gray-300 text-xs">Tín Hiệu Đánh Giá:</span>
                        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold border ${analysis.sentimentClass}">
                            ${analysis.sentimentText} (${analysis.sentimentScore > 0 ? '+' : ''}${analysis.sentimentScore})
                        </span>
                    </div>
                    <div class="text-xs text-gray-300 leading-relaxed bg-dark-card/50 p-2.5 rounded-lg border border-dark-border/60">
                        <div class="font-semibold text-purple-300 mb-1 flex items-center justify-between">
                            <span>🤖 ${analysis.catalyst || 'PHÂN TÍCH KỸ THUẬT'}</span>
                            ${sourceLabel}
                        </div>
                        <div class="text-gray-300">${analysis.summary}</div>
                    </div>
                    <div>
                        <div class="text-[11px] font-semibold text-gray-400 mb-1.5">
                            ${newsList.length > 0 ? `📰 Tin tức doanh nghiệp (${newsList.length} bài):` : '🔗 Tra cứu tin tức:'}
                        </div>
                        ${newsSection}
                    </div>
                </div>
            `;
        }).catch(err => {
            console.warn("⚠️ AI News rendering error:", err);
            aiNewsEl.innerHTML = '<div class="text-gray-500 text-xs py-2">Không thể tải phân tích AI.</div>';
        });
    }
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
