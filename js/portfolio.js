// --- QUẢN LÝ DANH MỤC & GỢI Ý ĐẦU TƯ (SMART PORTFOLIO ADVISOR) ---

// Helpers định dạng số
const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value);

let portfolio = JSON.parse(localStorage.getItem('vnStockPortfolio')) || [];
let editingIndex = null; // null: Thêm mới, number: Đang chỉnh sửa vị trí index

function savePortfolio() {
    localStorage.setItem('vnStockPortfolio', JSON.stringify(portfolio));
}

async function readBackupStore(storeName) {
    const db = await openSignalDB();
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    const rows = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return rows;
}

async function exportLocalData() {
    const [signals, paperAccounts, paperTrades, backtestRuns] = await Promise.all([
        readBackupStore('signals'),
        readBackupStore('paperAccounts'),
        readBackupStore('paperTrades'),
        readBackupStore('backtestRuns')
    ]);
    const backup = {
        app: 'vn-stock-advisor',
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        portfolio,
        signals,
        paperAccounts,
        paperTrades,
        backtestRuns
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vn-stock-advisor-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importLocalData(file) {
    const backup = JSON.parse(await file.text());
    if (backup?.app !== 'vn-stock-advisor' || !Array.isArray(backup.portfolio)) {
        throw new Error('File sao lưu không đúng định dạng.');
    }
    const cleanPortfolio = backup.portfolio.map(item => ({
        symbol: String(item.symbol || '').toUpperCase().trim(),
        buyPrice: Number(item.buyPrice),
        volume: Number(item.volume)
    })).filter(item => /^[A-Z0-9]{2,10}$/.test(item.symbol) && item.buyPrice > 0 && item.volume > 0);

    if (cleanPortfolio.length !== backup.portfolio.length) {
        throw new Error('File chứa mã, giá hoặc số lượng không hợp lệ.');
    }
    portfolio = cleanPortfolio;
    savePortfolio();
    if (backup.schemaVersion >= 2) {
        const db = await openSignalDB();
        const storeNames = ['signals', 'paperAccounts', 'paperTrades', 'backtestRuns'];
        const transaction = db.transaction(storeNames, 'readwrite');
        const completion = new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        storeNames.forEach(storeName => {
            const store = transaction.objectStore(storeName);
            store.clear();
            const rows = Array.isArray(backup[storeName]) ? backup[storeName] : [];
            rows.forEach(row => store.put(row));
        });
        await completion;
        db.close();
    }
    await renderPortfolio();
    if (typeof renderSignalHistoryStats === 'function') await renderSignalHistoryStats();
}

function addStockToPortfolio(symbol, buyPrice, volume) {
    symbol = symbol.toUpperCase().trim();
    const existingIndex = portfolio.findIndex(p => p.symbol === symbol);
    if (existingIndex >= 0) {
        // Giá vốn bình quân gia quyền
        const existing = portfolio[existingIndex];
        const totalCost = (existing.buyPrice * existing.volume) + (buyPrice * volume);
        existing.volume += volume;
        existing.buyPrice = totalCost / existing.volume;
    } else {
        portfolio.push({ symbol, buyPrice, volume });
    }
    savePortfolio();
    renderPortfolio();
}

function removeStockFromPortfolio(symbol) {
    if (confirm(`Bạn có chắc muốn xóa mã ${symbol} khỏi danh mục?`)) {
        portfolio = portfolio.filter(p => p.symbol !== symbol);
        savePortfolio();
        renderPortfolio();
    }
}

function openEditModal(index) {
    editingIndex = index;
    const item = portfolio[index];
    document.getElementById('modal-port-title').textContent = `Chỉnh Sửa Mã ${item.symbol}`;
    const symbolInput = document.getElementById('port-symbol');
    symbolInput.value = item.symbol;
    symbolInput.disabled = true; // Không sửa tên mã khi đang chỉnh sửa
    document.getElementById('port-price').value = item.buyPrice;
    document.getElementById('port-vol').value = item.volume;
    document.getElementById('modal-portfolio').classList.remove('hidden');
}

async function renderPortfolio() {
    const listEl = document.getElementById('portfolio-list');
    const totalEl = document.getElementById('portfolio-total');
    const plEl = document.getElementById('portfolio-pl');

    if (!listEl) return;

    if (portfolio.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-500 py-10 text-sm">Chưa có mã nào trong danh mục. Bấm "+ Thêm mã" để quản lý!</div>';
        totalEl.textContent = '0 ₫';
        plEl.textContent = '0 ₫ (0%)';
        plEl.className = 'font-semibold text-gray-300';
        return;
    }

    listEl.innerHTML = '<div class="text-center text-gray-500 text-xs py-8">Đang cập nhật giá & phân tích kỹ thuật...</div>';

    let totalCurrentValue = 0;
    let totalInvestedValue = 0;
    let html = '';

    for (let idx = 0; idx < portfolio.length; idx++) {
        const item = portfolio[idx];
        // Lấy lịch sử 60 phiên để phân tích kỹ thuật
        const candles = await fetchStockHistory(item.symbol, 60);
        let currentPrice = item.buyPrice; // fallback
        let dailyChangePercent = null;
        let evalResult = null;

        if (candles && candles.length > 0) {
            currentPrice = candles[candles.length - 1].close * 1000;
            if (candles.length >= 2) {
                const latestClose = candles[candles.length - 1].close;
                const previousClose = candles[candles.length - 2].close;
                if (previousClose > 0) dailyChangePercent = (latestClose - previousClose) / previousClose * 100;
            }
            evalResult = evaluateStock(item.symbol, candles, null, typeof currentMarketRegime !== 'undefined' ? currentMarketRegime : null, typeof marketBenchmarkCandles !== 'undefined' ? marketBenchmarkCandles : null);
        }

        const currentVal = currentPrice * item.volume;
        const investedVal = item.buyPrice * item.volume;
        
        totalCurrentValue += currentVal;
        totalInvestedValue += investedVal;

        const pl = currentVal - investedVal;
        const plPercent = investedVal > 0 ? (pl / investedVal) * 100 : 0;
        const isUp = pl >= 0;
        const colorClass = isUp ? 'text-brand-up' : 'text-brand-down';
        const isDailyUp = dailyChangePercent != null && dailyChangePercent >= 0;
        const dailyColorClass = dailyChangePercent == null ? 'text-gray-500' : (isDailyUp ? 'text-brand-up' : 'text-brand-down');

        // 🧠 TẠO GỢI Ý THÔNG MINH CHO TỪNG MÃ (SMART ADVISOR ADVICE)
        let adviceTag = '';
        let adviceText = '';
        let adviceClass = '';

        if (evalResult) {
            const score = evalResult.score;
            const signal = evalResult.signal;

            if (isUp && (signal === 'SELL' || signal === 'STRONG_SELL' || (evalResult.indicators.rsi && evalResult.indicators.rsi > 70))) {
                adviceTag = '💡 CÂN NHẮC CHỐT LỜI';
                adviceClass = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
                adviceText = `Đang lãi <b>+${plPercent.toFixed(1)}%</b>, chỉ báo chạm vùng quá mua/suy yếu. Khuyên chốt lời/hạ tỷ trọng bảo vệ thành quả.`;
            } else if (!isUp && (signal === 'STRONG_SELL' || score < 42)) {
                adviceTag = '⚠️ CẢNH BÁO CẮT LỖ';
                adviceClass = 'bg-red-500/20 text-red-400 border-red-500/40';
                adviceText = `Đang lỗ <b>${plPercent.toFixed(1)}%</b> và xu hướng vi phạm vùng hỗ trợ (${score}Đ). Khuyên hạ tỷ trọng cắt lỗ bảo vệ vốn.`;
            } else if (signal === 'STRONG_BUY' || signal === 'BUY') {
                adviceTag = '🚀 THEO DÕI GIA TĂNG';
                adviceClass = 'bg-blue-500/20 text-blue-400 border-blue-500/40';
                adviceText = `Tín hiệu kỹ thuật tích cực (${score}Đ). Chỉ cân nhắc gia tăng ở vùng vào hợp lý và trong giới hạn rủi ro danh mục.`;
            } else {
                adviceTag = '🔒 TIẾP TỤC NẮM GIỮ';
                adviceClass = 'bg-gray-500/20 text-gray-300 border-gray-500/40';
                adviceText = `Xu hướng đi ngang/ổn định (${score}Đ). Tiếp tục nắm giữ quan sát mốc hỗ trợ.`;
            }
        }

        const strategyBadges = (evalResult?.strategies || []).map(s =>
            `<span class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${s.badgeClass}">${s.label}</span>`
        ).join(' ');

        html += `
            <div class="bg-dark-card border border-dark-border rounded-xl p-4 space-y-3">
                <!-- Hàng 1: Mã, Số lượng & Lãi/Lỗ -->
                <div class="flex justify-between items-start">
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-bold text-white text-xl uppercase cursor-pointer hover:text-brand-primary" onclick="analyzeSymbol('${item.symbol}')">${item.symbol}</h4>
                            ${evalResult ? `<span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${evalResult.signalClass}">${evalResult.signalText} (${evalResult.score}Đ)</span>` : ''}
                        </div>
                        <div class="text-xs text-gray-400 mt-1">SL: <span class="text-white font-semibold">${formatNumber(item.volume)}</span> | Giá vốn: <span class="text-white font-semibold">${formatNumber(item.buyPrice)}</span></div>
                        <div class="portfolio-live-price text-xs mt-1 flex items-center gap-3 whitespace-nowrap">
                            <span class="text-gray-500 min-w-0">Giá hiện tại: <b class="text-white">${formatNumber(currentPrice)}</b></span>
                            <span class="${dailyColorClass} flex-shrink-0">Hôm nay: <b>${dailyChangePercent == null ? '---' : `${isDailyUp ? '+' : ''}${dailyChangePercent.toFixed(2)}%`}</b></span>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="font-bold text-white text-base">${formatCurrency(currentVal)}</div>
                        <div class="text-xs font-bold ${colorClass} mt-0.5">
                            ${isUp ? '+' : ''}${formatCurrency(pl)} (${isUp ? '+' : ''}${plPercent.toFixed(2)}%)
                        </div>
                    </div>
                </div>

                ${strategyBadges ? `<div class="flex flex-wrap gap-1">${strategyBadges}</div>` : ''}

                <!-- Hàng 2: Gợi Ý Khuyên Dùng Chuyên Gia -->
                ${adviceTag ? `
                    <div class="bg-[#0B0E14] border ${adviceClass} border rounded-lg p-2.5 text-xs">
                        <div class="font-bold mb-0.5 flex items-center gap-1.5">
                            <span>${adviceTag}</span>
                        </div>
                        <div class="text-gray-300 leading-relaxed">${adviceText}</div>
                    </div>
                ` : ''}

                <!-- Hàng 3: Nút Hành Động -->
                <div class="flex justify-between items-center pt-1 border-t border-dark-border/50 text-xs">
                    <button onclick="analyzeSymbol('${item.symbol}')" class="text-brand-primary font-semibold hover:underline flex items-center gap-1">
                        <i class="fas fa-chart-line"></i> Xem biểu đồ
                    </button>
                    <div class="flex gap-3">
                        <button onclick="openEditModal(${idx})" class="text-gray-400 hover:text-amber-400 font-medium flex items-center gap-1">
                            <i class="fas fa-edit"></i> Sửa
                        </button>
                        <button onclick="removeStockFromPortfolio('${item.symbol}')" class="text-gray-400 hover:text-red-400 font-medium flex items-center gap-1">
                            <i class="fas fa-trash"></i> Xóa
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    listEl.innerHTML = html;

    const totalPL = totalCurrentValue - totalInvestedValue;
    const totalPLPercent = totalInvestedValue > 0 ? (totalPL / totalInvestedValue) * 100 : 0;
    
    totalEl.textContent = formatCurrency(totalCurrentValue);
    
    const isTotalUp = totalPL >= 0;
    plEl.textContent = `${isTotalUp ? '+' : ''}${formatCurrency(totalPL)} (${isTotalUp ? '+' : ''}${totalPLPercent.toFixed(2)}%)`;
    plEl.className = `font-semibold ${isTotalUp ? 'text-brand-up' : 'text-brand-down'}`;
}

// Modal handling
document.getElementById('btn-add-stock')?.addEventListener('click', () => {
    editingIndex = null;
    document.getElementById('modal-port-title').textContent = 'Thêm Cổ Phiếu';
    const symbolInput = document.getElementById('port-symbol');
    symbolInput.value = '';
    symbolInput.disabled = false;
    document.getElementById('port-price').value = '';
    document.getElementById('port-vol').value = '';
    document.getElementById('modal-portfolio').classList.remove('hidden');
});

document.getElementById('btn-cancel-port')?.addEventListener('click', () => {
    document.getElementById('modal-portfolio').classList.add('hidden');
});

document.getElementById('btn-save-port')?.addEventListener('click', () => {
    const symbolInput = document.getElementById('port-symbol');
    const symbol = symbolInput.value.toUpperCase().trim();
    const price = parseFloat(document.getElementById('port-price').value);
    const vol = parseFloat(document.getElementById('port-vol').value);

    if (!symbol || !(price > 0) || !(vol > 0)) {
        alert('Vui lòng nhập đầy đủ Mã cổ phiếu, Giá mua và Số lượng hợp lệ!');
        return;
    }

    if (editingIndex !== null) {
        // Cập nhật mã đang sửa
        portfolio[editingIndex].buyPrice = price;
        portfolio[editingIndex].volume = vol;
        savePortfolio();
        renderPortfolio();
    } else {
        // Thêm mã mới
        addStockToPortfolio(symbol, price, vol);
    }

    document.getElementById('modal-portfolio').classList.add('hidden');
    symbolInput.value = '';
    document.getElementById('port-price').value = '';
    document.getElementById('port-vol').value = '';
});

document.getElementById('btn-export-data')?.addEventListener('click', exportLocalData);
document.getElementById('btn-import-data')?.addEventListener('click', () => {
    document.getElementById('input-import-data')?.click();
});
document.getElementById('input-import-data')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
        await importLocalData(file);
        alert(`Đã khôi phục ${portfolio.length} mã trong danh mục.`);
    } catch (error) {
        alert(error.message || 'Không thể đọc file sao lưu.');
    } finally {
        event.target.value = '';
    }
});
