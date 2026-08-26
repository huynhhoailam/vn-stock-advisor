// --- MAIN APP LOGIC ---

let mainChartInstance = null;
let vnindexChartInstance = null;
let scannedResults = []; // Cache for scanner
let currentMarketRegime = null;
let marketBenchmarkCandles = [];
let analysisViewRequestId = 0;

// Format functions
const fmtPrice = (val) => new Intl.NumberFormat('vi-VN').format(val * 1000);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const safeExternalUrl = value => {
    try {
        const url = new URL(value, window.location.href);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch (_) {
        return '#';
    }
};

function setupSymbolAutocomplete() {
    const input = document.getElementById('search-symbol');
    const dropdown = document.getElementById('symbol-suggestions');
    const wrapper = document.getElementById('symbol-search-wrap');
    if (!input || !dropdown || !wrapper) return;
    let matches = [];
    let activeIndex = -1;

    const getSymbols = () => {
        const held = new Set((typeof portfolio !== 'undefined' ? portfolio : []).map(item => item.symbol));
        const scanned = new Set((typeof scannedResults !== 'undefined' ? scannedResults : []).map(item => item.symbol));
        const symbols = [...new Set([...(typeof ALL_HOSE_SYMBOLS !== 'undefined' ? ALL_HOSE_SYMBOLS : []), ...held, ...scanned])];
        return symbols.map(symbol => ({ symbol, held: held.has(symbol), scanned: scanned.has(symbol) }));
    };

    const close = () => {
        dropdown.classList.add('hidden');
        dropdown.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        activeIndex = -1;
    };

    const select = symbol => {
        input.value = symbol;
        close();
        analyzeSymbol(symbol);
    };

    const render = () => {
        const query = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        input.value = query;
        if (!query) return close();
        matches = getSymbols()
            .filter(item => item.symbol.includes(query))
            .sort((a, b) => Number(b.symbol.startsWith(query)) - Number(a.symbol.startsWith(query)) || Number(b.held) - Number(a.held) || Number(b.scanned) - Number(a.scanned) || a.symbol.localeCompare(b.symbol))
            .slice(0, 8);
        activeIndex = -1;
        if (!matches.length) {
            dropdown.innerHTML = '<div class="px-3 py-2.5 text-xs text-gray-500">Không tìm thấy mã phù hợp</div>';
        } else {
            dropdown.innerHTML = matches.map((item, index) => `<button type="button" role="option" data-index="${index}" class="symbol-suggestion w-full flex justify-between items-center px-3 py-2.5 text-left border-b border-dark-border/50 last:border-0 hover:bg-blue-500/10"><b class="text-white">${item.symbol}</b><span class="text-[9px] ${item.held ? 'text-green-400' : (item.scanned ? 'text-blue-300' : 'text-gray-600')}">${item.held ? 'Trong danh mục' : (item.scanned ? 'Đã quét' : 'HOSE')}</span></button>`).join('');
        }
        dropdown.classList.remove('hidden');
        input.setAttribute('aria-expanded', 'true');
        dropdown.querySelectorAll('.symbol-suggestion').forEach(button => button.addEventListener('mousedown', event => {
            event.preventDefault();
            select(matches[Number(button.dataset.index)].symbol);
        }));
    };

    const paintActive = () => dropdown.querySelectorAll('.symbol-suggestion').forEach((button, index) => {
        button.classList.toggle('bg-blue-500/15', index === activeIndex);
        button.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
    });

    input.addEventListener('input', render);
    input.addEventListener('focus', () => { if (input.value) render(); });
    input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' && matches.length && !dropdown.classList.contains('hidden')) {
            event.preventDefault(); activeIndex = (activeIndex + 1) % matches.length; paintActive();
        } else if (event.key === 'ArrowUp' && matches.length && !dropdown.classList.contains('hidden')) {
            event.preventDefault(); activeIndex = (activeIndex - 1 + matches.length) % matches.length; paintActive();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            if (!dropdown.classList.contains('hidden') && activeIndex >= 0) select(matches[activeIndex].symbol);
            else if (input.value) { close(); analyzeSymbol(input.value); }
        } else if (event.key === 'Escape') close();
    });
    document.addEventListener('mousedown', event => { if (!wrapper.contains(event.target)) close(); });
}

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
            if (targetId === 'tab-paper') {
                renderPaperTrading();
            }
        });
    });

    // 2. Tải VN-Index và trạng thái thị trường khi khởi động.
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
    renderSignalHistoryStats();
    setTimeout(async () => {
        try {
            const updated = await refreshSignalOutcomes();
            if (updated > 0) await renderSignalHistoryStats();
        } catch (error) {
            console.warn('Không thể cập nhật hiệu suất tín hiệu:', error.message);
        }
    }, 8000);

    // 7. Setup Gemini Settings Modal
    const modalSettings = document.getElementById('modal-settings');
    const keyInput = document.getElementById('gemini-key-input');

    // Hàm cập nhật badge trạng thái Key
    const updateKeyStatusBadge = () => {
        const statusEl = document.getElementById('ai-key-status');
        if (!statusEl) return;
        const savedKey = sessionStorage.getItem('geminiApiKey') || '';
        const isValidKey = savedKey.length >= 20 && !savedKey.includes(' ');
        if (isValidKey) {
            statusEl.className = 'mb-3 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-green-500/10 text-green-400 border border-green-500/30';
            statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Đã lưu Key trong tab — Gemini sẽ được kiểm tra khi phân tích mã';
        } else {
            statusEl.className = 'mb-3 px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30';
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Chưa có Key — Đang dùng bộ phân tích TA nội bộ';
        }
        statusEl.classList.remove('hidden');
    };

    const openSettings = () => {
        if (keyInput) keyInput.value = sessionStorage.getItem('geminiApiKey') || '';
        updateKeyStatusBadge();
        if (window.location.protocol === 'file:') {
            const statusEl = document.getElementById('ai-key-status');
            statusEl.className = 'mb-3 px-3 py-2 rounded-lg text-xs font-semibold flex items-start gap-1.5 bg-amber-500/10 text-amber-300 border border-amber-500/30';
            statusEl.innerHTML = '<i class="fas fa-triangle-exclamation mt-0.5"></i><span>Trang đang mở bằng <b>file://</b>. Gemini có thể bị CORS chặn; nên chạy ứng dụng qua <b>http://localhost</b>.</span>';
        }
        modalSettings?.classList.remove('hidden');
    };

    document.getElementById('btn-open-settings')?.addEventListener('click', openSettings);
    document.getElementById('btn-config-ai')?.addEventListener('click', openSettings);
    document.getElementById('btn-close-settings')?.addEventListener('click', () => modalSettings?.classList.add('hidden'));
    modalSettings?.addEventListener('click', event => {
        if (event.target === modalSettings) modalSettings.classList.add('hidden');
    });
    setupSymbolAutocomplete();
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            modalSettings?.classList.add('hidden');
            document.getElementById('modal-portfolio')?.classList.add('hidden');
            document.getElementById('modal-paper-order')?.classList.add('hidden');
            document.getElementById('modal-paper-capital')?.classList.add('hidden');
        }
    });

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
            sessionStorage.setItem('geminiApiKey', val);
        } else {
            sessionStorage.removeItem('geminiApiKey');
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
        sessionStorage.removeItem('geminiApiKey');
        if (keyInput) keyInput.value = '';
        Object.keys(sessionStorage).filter(k => k.startsWith('ai_news_')).forEach(k => sessionStorage.removeItem(k));
        updateKeyStatusBadge();
        modalSettings?.classList.add('hidden');
    });

    // Auto-open Settings nếu chưa từng nhập Key (lần đầu dùng app)
    // Không giữ API key lâu dài trong localStorage; xóa dữ liệu từ phiên bản cũ nếu có.
    localStorage.removeItem('geminiApiKey');
    if (!sessionStorage.getItem('geminiApiKey') && !localStorage.getItem('ai_setup_done')) {
        setTimeout(() => {
            localStorage.setItem('ai_setup_done', '1');
            openSettings();
        }, 2000);
    }
});

// Event delegation thay cho inline onclick để CSP có thể chặn script nội tuyến.
document.addEventListener('click', event => {
    const paperButton = event.target.closest?.('[data-paper-symbol]');
    if (paperButton) {
        event.stopPropagation();
        const symbol = String(paperButton.dataset.paperSymbol || '').toUpperCase();
        if (SAFE_SYMBOL_PATTERN.test(symbol)) openPaperOrder(symbol, paperButton.dataset.paperSide === 'SELL' ? 'SELL' : 'BUY');
        return;
    }
    const editButton = event.target.closest?.('[data-edit-portfolio]');
    if (editButton) {
        const index = Number(editButton.dataset.editPortfolio);
        if (Number.isInteger(index) && index >= 0 && index < portfolio.length) openEditModal(index);
        return;
    }
    const removeButton = event.target.closest?.('[data-remove-symbol]');
    if (removeButton) {
        const symbol = String(removeButton.dataset.removeSymbol || '').toUpperCase();
        if (SAFE_SYMBOL_PATTERN.test(symbol)) removeStockFromPortfolio(symbol);
        return;
    }
    const analyzeTarget = event.target.closest?.('[data-analyze-symbol]');
    if (analyzeTarget) {
        const symbol = String(analyzeTarget.dataset.analyzeSymbol || '').toUpperCase();
        if (SAFE_SYMBOL_PATTERN.test(symbol)) analyzeSymbol(symbol);
    }
});


// Load VN-INDEX
async function loadVNIndex() {
    const candles = await fetchStockHistory('VNINDEX', 80);
    if (!candles || candles.length < 2) {
        const status = document.getElementById('market-status');
        if (status) {
            status.textContent = 'Mất dữ liệu';
            status.className = 'text-xs font-semibold px-2 py-1 rounded bg-red-500/20 text-red-400';
        }
        return;
    }

    const current = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const change = current.close - prev.close;
    const changePct = (change / prev.close) * 100;

    const valEl = document.getElementById('vnindex-value');
    const changeEl = document.getElementById('vnindex-change');

    valEl.textContent = current.close.toFixed(2);
    const updatedEl = document.getElementById('market-updated-at');
    if (updatedEl) {
        updatedEl.textContent = `Dữ liệu phiên: ${new Date(current.time).toLocaleDateString('vi-VN')} · cập nhật ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    }
    currentMarketRegime = evaluateMarketRegime(candles);
    marketBenchmarkCandles = candles;
    renderMarketRegime(currentMarketRegime);
    
    const isUp = change >= 0;
    const status = document.getElementById('market-status');
    if (status) {
        status.textContent = 'Dữ liệu hoạt động';
        status.className = 'text-xs font-semibold px-2 py-1 rounded bg-green-500/20 text-green-400';
    }
    changeEl.textContent = `${isUp ? '+' : ''}${change.toFixed(2)} (${isUp ? '+' : ''}${changePct.toFixed(2)}%)`;
    changeEl.className = `text-sm font-semibold mb-1 ${isUp ? 'text-brand-up' : 'text-brand-down'}`;

    // Render Mini Chart
    renderMiniChart('vnindexChart', candles.slice(-20), isUp ? '#00C853' : '#FF3D00');
}

function renderMarketRegime(regime) {
    const label = document.getElementById('market-regime-label');
    const score = document.getElementById('market-regime-score');
    const advice = document.getElementById('market-regime-advice');
    if (!label || !score || !advice || !regime) return;
    const styles = {
        BULL: ['text-green-400', 'bg-green-500/10 text-green-400'],
        BEAR: ['text-red-400', 'bg-red-500/10 text-red-400'],
        NEUTRAL: ['text-amber-400', 'bg-amber-500/10 text-amber-400']
    };
    const selected = styles[regime.type] || styles.NEUTRAL;
    label.textContent = regime.label;
    label.className = `font-bold mt-1 ${selected[0]}`;
    score.textContent = `Tin cậy ${regime.confidence}%`;
    score.className = `text-xs px-2.5 py-1 rounded-full ${selected[1]}`;
    advice.textContent = regime.advice;
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
        const status = document.getElementById('market-status');
        if (status && res.dataSource === 'VNDirect dự phòng') {
            status.textContent = 'Nguồn dự phòng';
            status.className = 'text-xs font-semibold px-2 py-1 rounded bg-amber-500/20 text-amber-400';
        }
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
            <div class="bg-[#0B0E14] border border-dark-border/80 rounded-xl p-3 flex items-center justify-between cursor-pointer hover:border-brand-primary transition-colors" data-analyze-symbol="${item.symbol}">
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
                    const result = evaluateStock(symbol, candles, vpsInfo, currentMarketRegime, marketBenchmarkCandles);
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
    try {
        await saveSignalBatch(scannedResults, currentMarketRegime);
        await renderSignalHistoryStats();
    } catch (error) {
        console.warn('Không thể lưu lịch sử quét:', error.message);
    }

    progressDiv.classList.add('hidden');
    btn.classList.remove('hidden');
    btn.innerHTML = '<i class="fas fa-check mr-2"></i> Đã Quét Xong';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-search mr-2"></i> Quét Cơ Hội Lại'; }, 3000);

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
        filtered = filtered.filter(result => {
            const types = (result.strategies || []).map(strategy => strategy.type);
            if (strategyFilter === 'BREAKOUT') return types.includes('MONEY_FLOW') || types.includes('BB_BREAKOUT');
            if (strategyFilter === 'TREND') return types.includes('LEADER');
            return types.includes(strategyFilter);
        });
    }

    // Bộ lọc bán xếp theo rủi ro thoát vị thế; các bộ lọc khác xếp theo cơ hội mua.
    const signalWeight = { 'STRONG_BUY': 4, 'BUY': 3, 'HOLD': 2, 'SELL': 1, 'STRONG_SELL': 0 };
    filtered.sort((a, b) => {
        if (filter === 'SELL') return (b.exitRisk?.score || 0) - (a.exitRisk?.score || 0);
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
        const isExitSignal = res.signal === 'SELL' || res.signal === 'STRONG_SELL';
        const strategyBadges = (!isExitSignal ? (res.strategies || []) : []).map(s =>
            `<span class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${s.badgeClass}">${s.label}</span>`
        ).join(' ');

        const isTopPick = index < 3 && (res.signal === 'STRONG_BUY' || res.signal === 'BUY');
        const rankBadge = isTopPick 
            ? `<span class="bg-amber-500/20 text-amber-400 text-[10px] font-extrabold px-1.5 py-0.5 rounded border border-amber-500/40">#${index + 1} TOP PICK</span>`
            : `<span class="text-xs font-bold text-gray-500 w-4">${index + 1}</span>`;

        const topReason = isExitSignal ? (res.exitRisk?.reasons?.[0] || '') : (res.reasons?.[0] || '');
        const plan = res.tradePlan;

        html += `
            <div class="bg-dark-card border border-dark-border rounded-xl p-4 active:scale-[0.98] transition-transform cursor-pointer hover:border-brand-primary/50" data-analyze-symbol="${res.symbol}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        ${rankBadge}
                        <div>
                            <div class="font-bold text-white text-lg flex items-center gap-1.5">
                                ${res.symbol}
                            </div>
                            <div class="text-xs text-gray-400 mt-0.5">${isExitSignal ? 'Rủi ro' : 'Điểm cơ hội'}: <span class="font-bold ${isExitSignal ? 'text-brand-down' : (res.score >= 70 ? 'text-brand-up' : (res.score <= 40 ? 'text-brand-down' : 'text-brand-ref'))}">${isExitSignal ? (res.exitRisk?.score || 0) : res.score}/100</span></div>
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
                ${plan && (res.signal === 'BUY' || res.signal === 'STRONG_BUY') ? `<div class="grid grid-cols-3 gap-2 mt-2 text-[10px] text-center">
                    <div class="bg-blue-500/10 rounded p-1.5"><div class="text-gray-500">Vùng vào</div><b class="text-blue-300">${fmtPrice(plan.entryLow)}–${fmtPrice(plan.entryHigh)}</b></div>
                    <div class="bg-red-500/10 rounded p-1.5"><div class="text-gray-500">Dừng lỗ</div><b class="text-red-300">${fmtPrice(plan.stopLoss)}</b></div>
                    <div class="bg-green-500/10 rounded p-1.5"><div class="text-gray-500">Mục tiêu</div><b class="text-green-300">${fmtPrice(plan.target1)}</b></div>
                </div>` : ''}
                ${isExitSignal ? `<div class="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-[10px] text-red-200"><b>Cơ sở cảnh báo:</b> ${(res.exitRisk?.reasons || []).join(' · ') || 'Xu hướng suy yếu'}</div>` : ''}
                ${(res.signal === 'BUY' || res.signal === 'STRONG_BUY') ? `<button data-paper-symbol="${res.symbol}" data-paper-side="BUY" class="mt-2 w-full text-xs font-bold text-blue-300 border border-blue-500/30 bg-blue-500/10 rounded-lg py-2"><i class="fas fa-flask mr-1"></i>Mua thử ${res.symbol}</button>` : ''}
            </div>
        `;
    });

    container.innerHTML = html;
}

// Chart Analysis
async function analyzeSymbol(symbol) {
    const requestId = ++analysisViewRequestId;
    symbol = symbol.toUpperCase().trim();
    document.getElementById('search-symbol').value = symbol;
    
    // Switch to chart tab
    document.querySelector('[data-target="tab-chart"]').click();
    
    const card = document.getElementById('detail-card');
    card.classList.remove('hidden');
    
    document.getElementById('detail-symbol').textContent = 'Đang tải...';
    
    const candles = await fetchStockHistory(symbol, 100);
    if (requestId !== analysisViewRequestId) return;
    if (!candles || candles.length === 0) {
        document.getElementById('detail-symbol').textContent = 'Không tìm thấy mã';
        return;
    }

    const result = evaluateStock(symbol, candles, null, currentMarketRegime, marketBenchmarkCandles);
    if (!result) return;

    document.getElementById('detail-symbol').textContent = symbol;
    document.getElementById('detail-price').textContent = fmtPrice(result.price) + ' VNĐ';
    
    const badge = document.getElementById('detail-signal-badge');
    const isExitSignal = result.signal === 'SELL' || result.signal === 'STRONG_SELL';
    badge.textContent = isExitSignal
        ? `${result.signalText} (Rủi ro ${result.exitRisk?.score || 0}/100)`
        : `${result.signalText} (${result.score}Đ)`;
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

    const plan = result.tradePlan;
    const isBuySignal = result.signal === 'BUY' || result.signal === 'STRONG_BUY';
    const tradePlanHtml = isExitSignal ? `
        <div class="bg-red-500/10 border border-red-500/25 rounded-xl p-3">
            <div class="flex justify-between items-center"><b class="text-sm text-red-300">Quản trị vị thế</b><span class="text-[10px] text-red-400">RR ${result.exitRisk?.score || 0}/100</span></div>
            <div class="text-xs text-gray-300 mt-2">${(result.exitRisk?.reasons || []).join(' · ') || 'Xu hướng đang suy yếu.'}</div>
            <div class="text-[10px] text-gray-500 mt-2">Nếu đang nắm giữ, ưu tiên mức stop đã đặt trong Danh mục; không dùng vùng vào mới khi tín hiệu rủi ro cao.</div>
        </div>` : isBuySignal && plan ? `
        <div class="bg-[#0B0E14] border border-dark-border rounded-xl p-3">
            <div class="flex justify-between items-center mb-2"><b class="text-sm text-white">Kế hoạch giao dịch tham khảo</b><span class="text-[10px] px-2 py-1 rounded bg-blue-500/15 text-blue-300">${plan.status}</span></div>
            <div class="grid grid-cols-2 gap-2 text-xs">
                <div><span class="text-gray-500">Vùng vào:</span> <b class="text-white">${fmtPrice(plan.entryLow)}–${fmtPrice(plan.entryHigh)}</b></div>
                <div><span class="text-gray-500">Dừng lỗ:</span> <b class="text-red-400">${fmtPrice(plan.stopLoss)} (-${plan.riskPercent.toFixed(1)}%)</b></div>
                <div><span class="text-gray-500">Mục tiêu 1:</span> <b class="text-green-400">${fmtPrice(plan.target1)}</b></div>
                <div><span class="text-gray-500">Mục tiêu 2:</span> <b class="text-green-400">${fmtPrice(plan.target2)}</b></div>
            </div>
            <div class="text-[10px] text-gray-500 mt-2">${plan.note}</div>
        </div>` : plan ? `
        <div class="bg-[#0B0E14] border border-dark-border rounded-xl p-3">
            <div class="flex justify-between items-center"><b class="text-sm text-white">Vùng theo dõi</b><span class="text-[10px] px-2 py-1 rounded bg-gray-500/15 text-gray-300">${result.signalText}</span></div>
            <div class="text-xs text-gray-400 mt-2">Chưa có hành động mua/bán rõ ràng. Mốc hỗ trợ kỹ thuật tham khảo: <b class="text-red-300">${fmtPrice(plan.stopLoss)}</b>.</div>
        </div>` : '';
    document.getElementById('detail-trade-plan').innerHTML = tradePlanHtml;

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
            <div class="text-xs text-gray-500 mb-1">Sức mạnh tương đối 20 phiên so với VN-Index</div>
            <div class="font-bold ${result.indicators.relativeStrength20 >= 0 ? 'text-brand-up' : 'text-brand-down'}">${result.indicators.relativeStrength20 == null ? 'Chưa đủ dữ liệu' : `${result.indicators.relativeStrength20 >= 0 ? '+' : ''}${result.indicators.relativeStrength20.toFixed(2)}%`}</div>
        </div>
        <div class="col-span-2 bg-[#0B0E14] p-3 rounded-lg border border-dark-border">
            <div class="text-xs text-gray-500 mb-1">Cơ sở chấm điểm kỹ thuật</div>
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
            if (requestId !== analysisViewRequestId || document.getElementById('detail-symbol')?.textContent !== symbol) return;
            let newsItemsHtml = '';
            if (newsList && newsList.length > 0) {
                newsItemsHtml = newsList.slice(0, 3).map(n => `
                    <div class="border-b border-dark-border/40 pb-1.5 last:border-b-0">
                        <a href="${safeExternalUrl(n.url)}" target="_blank" rel="noopener noreferrer" class="text-gray-200 hover:text-brand-primary font-medium line-clamp-1 block">
                            <i class="fas fa-newspaper text-gray-500 text-[10px] mr-1"></i>${escapeHtml(n.title)}
                        </a>
                        <div class="text-[10px] text-gray-500 mt-0.5">${n.date ? new Date(n.date).toLocaleDateString('vi-VN') : ''}</div>
                    </div>
                `).join('');
            } else {
                newsItemsHtml = '<div class="text-gray-500 text-[11px]">Chưa ghi nhận tin tức nổi bật gần nhất.</div>';
            }

            // Quyết định label nguồn phân tích
            const sourceLabel = analysis.isAIGenerated
                ? `<span class="text-[9px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/30">✨ Gemini AI${newsList.length ? ' · Tin tức' : ' · Kỹ thuật'}</span>`
                : analysis.aiUnavailableReason
                    ? '<span class="text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">⚠ Gemini lỗi · Đang dự phòng</span>'
                : newsList.length > 0
                    ? '<span class="text-[9px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">📰 NLP Tin tức</span>'
                    : '<span class="text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">📊 Phân tích TA</span>';

            // Tin tức section hoặc link tìm kiếm báo
            let newsSection = '';
            const officialSources = `<div class="grid grid-cols-2 gap-2 mt-2">
                <a href="https://www.hsx.vn/vi/quan-ly-niem-yet/co-phieu" target="_blank" rel="noopener noreferrer" class="text-center text-[10px] text-blue-300 border border-blue-500/20 rounded-lg py-1.5">HOSE · Niêm yết/CBTT</a>
                <a href="https://www.hnx.vn/vi-vn/co-phieu.html" target="_blank" rel="noopener noreferrer" class="text-center text-[10px] text-blue-300 border border-blue-500/20 rounded-lg py-1.5">HNX · Công bố tin</a>
            </div>`;
            if (newsList.length > 0) {
                const newsItems = newsList.slice(0, 3).map(n => `
                    <div class="border-b border-dark-border/40 pb-1.5 last:border-b-0">
                        <a href="${safeExternalUrl(n.url)}" target="_blank" rel="noopener noreferrer" class="text-gray-200 hover:text-brand-primary font-medium line-clamp-1 block text-[11px]">
                            <i class="fas fa-newspaper text-gray-500 text-[10px] mr-1"></i>${escapeHtml(n.title)}
                        </a>
                        <div class="text-[10px] text-gray-500 mt-0.5">${n.date ? new Date(n.date).toLocaleDateString('vi-VN') : ''}</div>
                    </div>
                `).join('');
                newsSection = `<div class="space-y-1.5">${newsItems}</div>${officialSources}`;
            } else {
                newsSection = `
                    <div class="flex gap-2">
                        <a href="https://cafef.vn/tim-kiem.chn?keywords=${symbol}" target="_blank" rel="noopener noreferrer"
                            class="flex-1 text-center text-[11px] text-brand-primary border border-brand-primary/30 bg-brand-primary/5 rounded-lg py-1.5 hover:bg-brand-primary/10 transition-colors">
                            <i class="fas fa-search mr-1"></i>Tìm tin trên CafeF
                        </a>
                        <a href="https://vndirect.com.vn/catalog/cp/cp-${symbol.toLowerCase()}.shtml" target="_blank" rel="noopener noreferrer"
                            class="flex-1 text-center text-[11px] text-purple-400 border border-purple-500/30 bg-purple-500/5 rounded-lg py-1.5 hover:bg-purple-500/10 transition-colors">
                            <i class="fas fa-chart-bar mr-1"></i>Hồ sơ VNDirect
                        </a>
                    </div>${officialSources}`;
            }

            const safeSentimentMap = {
                POSITIVE: 'bg-green-500/20 text-green-400 border-green-500/40',
                NEGATIVE: 'bg-red-500/20 text-red-400 border-red-500/40',
                NEUTRAL: 'bg-gray-500/20 text-gray-300 border-gray-500/40'
            };
            const safeSentimentClass = safeSentimentMap[analysis.sentiment] || safeSentimentMap.NEUTRAL;
            aiNewsEl.innerHTML = `
                <div class="bg-[#0B0E14] border border-dark-border rounded-xl p-3 space-y-2.5">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-gray-300 text-xs">Sắc thái dữ liệu:</span>
                        <span class="text-[10px] px-2 py-0.5 rounded-full font-bold border ${safeSentimentClass}">
                            ${escapeHtml(analysis.sentimentText)} (${analysis.sentimentScore > 0 ? '+' : ''}${analysis.sentimentScore})
                        </span>
                    </div>
                    <div class="text-xs text-gray-300 leading-relaxed bg-dark-card/50 p-2.5 rounded-lg border border-dark-border/60">
                        <div class="font-semibold text-purple-300 mb-1 flex items-center justify-between">
                            <span>🤖 ${escapeHtml(analysis.catalyst || 'PHÂN TÍCH KỸ THUẬT')}</span>
                            ${sourceLabel}
                        </div>
                        <div class="text-gray-300">${escapeHtml(analysis.summary)}</div>
                        <div class="mt-2 pt-2 border-t border-dark-border/50 text-amber-300/90"><b>Rủi ro:</b> ${escapeHtml(analysis.risk || 'Cần kiểm tra thông tin và quản trị điểm dừng lỗ.')}</div>
                        ${analysis.aiUnavailableReason ? `<div class="mt-1 text-[10px] text-amber-400">${escapeHtml(analysis.aiUnavailableReason)}</div>` : ''}
                        <div class="text-[10px] text-gray-500 mt-1">Mức dữ liệu tham khảo: ${escapeHtml(analysis.evidenceLevel || 'THẤP')}</div>
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
            if (requestId !== analysisViewRequestId) return;
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
