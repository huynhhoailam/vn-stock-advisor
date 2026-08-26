// --- QUẢN LÝ DANH MỤC & GỢI Ý ĐẦU TƯ (SMART PORTFOLIO ADVISOR) ---

// Helpers định dạng số
const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(value);

let portfolio = JSON.parse(localStorage.getItem('vnStockPortfolio')) || [];
let editingIndex = null; // null: Thêm mới, number: Đang chỉnh sửa vị trí index
let portfolioRenderRequestId = 0;

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
    const backup = await buildLocalBackup();
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

async function buildLocalBackup() {
    const [signals, paperAccounts, paperTrades, backtestRuns] = await Promise.all([
        readBackupStore('signals'),
        readBackupStore('paperAccounts'),
        readBackupStore('paperTrades'),
        readBackupStore('backtestRuns')
    ]);
    return {
        app: 'vn-stock-advisor',
        schemaVersion: 3,
        exportedAt: new Date().toISOString(),
        portfolio,
        signals,
        paperAccounts,
        paperTrades,
        backtestRuns
    };
}

async function saveSafetyBackup(reason, backup = null) {
    const snapshot = backup || await buildLocalBackup();
    const db = await openSignalDB();
    const transaction = db.transaction('safetyBackups', 'readwrite');
    const store = transaction.objectStore('safetyBackups');
    const createdAt = new Date().toISOString();
    store.put({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt, reason, backup: snapshot });
    const allRequest = store.getAll();
    allRequest.onsuccess = () => {
        const oldRows = (allRequest.result || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(5);
        oldRows.forEach(row => store.delete(row.id));
    };
    await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    document.getElementById('btn-restore-safety')?.classList.remove('hidden');
    return createdAt;
}

async function getLatestSafetyBackup() {
    const rows = await readBackupStore('safetyBackups');
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
}

async function restoreLatestSafetyBackup() {
    const snapshot = await getLatestSafetyBackup();
    if (!snapshot) throw new Error('Chưa có bản an toàn trên thiết bị này.');
    if (!confirm(`Khôi phục bản an toàn ${new Date(snapshot.createdAt).toLocaleString('vi-VN')} (${snapshot.reason})?`)) return;
    await restoreLocalBackup(snapshot.backup);
    alert('Đã khôi phục bản an toàn trên thiết bị.');
}

async function importLocalData(file) {
    return restoreLocalBackup(JSON.parse(await file.text()));
}

async function restoreLocalBackup(backup) {
    if (backup?.app !== 'vn-stock-advisor' || !Array.isArray(backup.portfolio)) {
        throw new Error('File sao lưu không đúng định dạng.');
    }
    const cleanPortfolio = backup.portfolio.map(item => ({
        symbol: String(item.symbol || '').toUpperCase().trim(),
        buyPrice: Number(item.buyPrice),
        volume: Number(item.volume),
        stopLoss: Number(item.stopLoss) > 0 ? Number(item.stopLoss) : null,
        initialStopLoss: Number(item.initialStopLoss) > 0 ? Number(item.initialStopLoss) : null,
        target: Number(item.target) > 0 ? Number(item.target) : null
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
    if (typeof renderPaperTrading === 'function') await renderPaperTrading();
}

function addStockToPortfolio(symbol, buyPrice, volume, stopLoss = null, target = null) {
    symbol = symbol.toUpperCase().trim();
    const existingIndex = portfolio.findIndex(p => p.symbol === symbol);
    if (existingIndex >= 0) {
        // Giá vốn bình quân gia quyền
        const existing = portfolio[existingIndex];
        const totalCost = (existing.buyPrice * existing.volume) + (buyPrice * volume);
        existing.volume += volume;
        existing.buyPrice = totalCost / existing.volume;
    } else {
        portfolio.push({ symbol, buyPrice, volume, stopLoss, initialStopLoss: stopLoss, target });
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
    document.getElementById('port-stop').value = item.stopLoss || '';
    document.getElementById('port-target').value = item.target || '';
    document.getElementById('modal-portfolio').classList.remove('hidden');
}

async function renderPortfolio() {
    const requestId = ++portfolioRenderRequestId;
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
    let portfolioPlanChanged = false;
    const portfolioHistories = await Promise.all(portfolio.map(item =>
        fetchStockHistory(item.symbol, 60).catch(() => null)
    ));
    if (requestId !== portfolioRenderRequestId) return;
    const estimatedPortfolioValue = portfolio.reduce((sum, item, index) => {
        const candles = portfolioHistories[index];
        const price = candles?.length ? candles[candles.length - 1].close * 1000 : item.buyPrice;
        return sum + price * item.volume;
    }, 0);

    for (let idx = 0; idx < portfolio.length; idx++) {
        const item = portfolio[idx];
        const candles = portfolioHistories[idx];
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
        const technicalStop = evalResult?.tradePlan?.stopLoss ? evalResult.tradePlan.stopLoss * 1000 : null;
        const technicalTarget = evalResult?.tradePlan?.target1 ? evalResult.tradePlan.target1 * 1000 : null;
        if (!item.stopLoss && technicalStop) {
            item.stopLoss = technicalStop;
            item.initialStopLoss = technicalStop;
            portfolioPlanChanged = true;
        } else if (item.stopLoss && technicalStop && technicalStop > item.stopLoss && currentPrice > item.stopLoss) {
            item.stopLoss = Math.min(technicalStop, currentPrice * 0.995);
            portfolioPlanChanged = true;
        }
        if (!item.initialStopLoss && item.stopLoss) {
            item.initialStopLoss = item.stopLoss;
            portfolioPlanChanged = true;
        }
        if (!item.target && technicalTarget) {
            item.target = technicalTarget;
            portfolioPlanChanged = true;
        }
        let suggestedStop = item.stopLoss || null;
        const suggestedTarget = item.target || null;
        const stopBreached = Boolean(suggestedStop && currentPrice <= suggestedStop);
        const initialRisk = item.initialStopLoss ? Math.max(item.buyPrice - item.initialStopLoss, item.buyPrice * 0.01) : null;
        const profitR = initialRisk ? (currentPrice - item.buyPrice) / initialRisk : null;
        if (!stopBreached && profitR >= 1 && item.stopLoss < item.buyPrice) {
            item.stopLoss = item.buyPrice;
            suggestedStop = item.stopLoss;
            portfolioPlanChanged = true;
        }
        const isExitSignal = evalResult?.signal === 'SELL' || evalResult?.signal === 'STRONG_SELL';
        const isBuySignal = evalResult?.signal === 'BUY' || evalResult?.signal === 'STRONG_BUY';
        const inEntryZone = Boolean(evalResult?.tradePlan && currentPrice >= evalResult.tradePlan.entryLow * 1000 && currentPrice <= evalResult.tradePlan.entryHigh * 1000);
        const positionWeight = estimatedPortfolioValue ? currentVal / estimatedPortfolioValue * 100 : 0;
        const canAddPosition = isBuySignal && inEntryZone && positionWeight < 25 && !evalResult?.riskFlags?.marketBlocked;
        let portfolioBadgeText = 'THEO DÕI';
        let portfolioBadgeClass = 'bg-signal-hold';
        let portfolioBadgeMetric = evalResult ? `${evalResult.score}Đ` : '';
        if (stopBreached || evalResult?.signal === 'STRONG_SELL') {
            portfolioBadgeText = 'ƯU TIÊN BÁN';
            portfolioBadgeClass = 'bg-signal-sell';
            portfolioBadgeMetric = stopBreached ? 'THỦNG STOP' : `RR ${evalResult.exitRisk?.score || 0}`;
        } else if (evalResult?.signal === 'SELL') {
            portfolioBadgeText = 'CÂN NHẮC BÁN';
            portfolioBadgeClass = 'bg-signal-sell';
            portfolioBadgeMetric = `RR ${evalResult.exitRisk?.score || 0}`;
        } else if (canAddPosition) {
            portfolioBadgeText = 'CÂN NHẮC MUA THÊM';
            portfolioBadgeClass = 'bg-signal-buy';
        } else if (isBuySignal) {
            portfolioBadgeText = 'TIẾP TỤC GIỮ';
            portfolioBadgeClass = 'bg-signal-buy';
        } else if (evalResult?.signalText === 'TRUNG TÍNH') {
            portfolioBadgeText = 'TIẾP TỤC GIỮ';
        }

        // 🧠 TẠO GỢI Ý THÔNG MINH CHO TỪNG MÃ (SMART ADVISOR ADVICE)
        let adviceTag = '';
        let adviceText = '';
        let adviceClass = '';

        if (evalResult) {
            const score = evalResult.score;
            const signal = evalResult.signal;

            if (stopBreached) {
                adviceTag = '🛑 VI PHẠM DỪNG LỖ';
                adviceClass = 'bg-red-500/20 text-red-400 border-red-500/50';
                adviceText = `Giá hiện tại đã xuống dưới mức dừng lỗ <b>${formatNumber(suggestedStop)}</b>. Không tự hạ stop; cân nhắc thoát hoặc giảm vị thế theo kế hoạch.`;
            } else if (isUp && (signal === 'SELL' || signal === 'STRONG_SELL' || (evalResult.indicators.rsi && evalResult.indicators.rsi > 70))) {
                adviceTag = '💡 CÂN NHẮC CHỐT LỜI';
                adviceClass = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
                adviceText = `Đang lãi <b>+${plPercent.toFixed(1)}%</b>, chỉ báo chạm vùng quá mua/suy yếu. Khuyên chốt lời/hạ tỷ trọng bảo vệ thành quả.`;
            } else if (!isUp && (signal === 'SELL' || signal === 'STRONG_SELL')) {
                adviceTag = '⚠️ RỦI RO THOÁT VỊ THẾ';
                adviceClass = 'bg-red-500/20 text-red-400 border-red-500/40';
                adviceText = `Đang lỗ <b>${plPercent.toFixed(1)}%</b>, điểm rủi ro thoát vị thế <b>${evalResult.exitRisk?.score || 0}/100</b>. Theo dõi stop và cân nhắc hạ tỷ trọng nếu xu hướng tiếp tục xấu.`;
            } else if (canAddPosition) {
                adviceTag = '➕ CÂN NHẮC MUA THÊM';
                adviceClass = 'bg-blue-500/20 text-blue-400 border-blue-500/40';
                adviceText = `Điểm cơ hội <b>${score}/100</b>, giá đang trong vùng vào và tỷ trọng hiện tại khoảng <b>${positionWeight.toFixed(1)}%</b>. Chỉ mua thêm nếu tổng rủi ro danh mục vẫn trong giới hạn.`;
            } else if (signal === 'STRONG_BUY' || signal === 'BUY') {
                adviceTag = '✅ TIẾP TỤC GIỮ';
                adviceClass = 'bg-green-500/20 text-green-400 border-green-500/40';
                adviceText = `Tín hiệu còn tích cực (${score}/100) nhưng ${!inEntryZone ? 'giá chưa nằm trong vùng mua thêm' : `tỷ trọng đã khoảng ${positionWeight.toFixed(1)}%`}. Chưa nên gia tăng lúc này.`;
            } else {
                adviceTag = evalResult.signalText === 'CHƯA HẤP DẪN' ? '👀 THEO DÕI SÁT' : '🔒 TIẾP TỤC GIỮ';
                adviceClass = 'bg-gray-500/20 text-gray-300 border-gray-500/40';
                adviceText = `${evalResult.signalText === 'CHƯA HẤP DẪN' ? 'Điểm cơ hội hiện thấp, nhưng chưa có đủ xác nhận bán.' : 'Tín hiệu hiện ở trạng thái trung tính/chờ xác nhận.'} Tiếp tục quản trị theo mức dừng lỗ ${suggestedStop ? `<b>${formatNumber(suggestedStop)}</b>` : 'đã đặt'}.`;
            }
        }

        const strategyBadges = (!stopBreached && !isExitSignal ? (evalResult?.strategies || []) : []).map(s =>
            `<span class="text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${s.badgeClass}">${s.label}</span>`
        ).join(' ');

        html += `
            <div class="bg-dark-card border border-dark-border rounded-xl p-3 space-y-2.5">
                <div class="flex justify-between items-start gap-3">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <h4 class="font-bold text-white text-lg uppercase cursor-pointer hover:text-brand-primary" onclick="analyzeSymbol('${item.symbol}')">${item.symbol}</h4>
                            ${evalResult ? `<span class="text-[9px] px-1.5 py-0.5 rounded-full font-bold ${portfolioBadgeClass}">${portfolioBadgeText} · ${portfolioBadgeMetric}</span>` : ''}
                        </div>
                        <div class="text-[10px] text-gray-500">${formatNumber(item.volume)} CP</div>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <div class="font-bold text-white text-sm">${formatCurrency(currentVal)}</div>
                        <div class="text-xs font-bold ${colorClass}">${isUp ? '+' : ''}${formatCurrency(pl)} · ${isUp ? '+' : ''}${plPercent.toFixed(2)}%</div>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-1.5 text-[10px]">
                    <div class="bg-black/20 rounded-md px-2 py-1"><span class="text-gray-500 block">Giá vốn</span><b class="text-gray-200">${formatNumber(item.buyPrice)}</b></div>
                    <div class="bg-black/20 rounded-md px-2 py-1"><span class="text-gray-500 block">Hiện tại</span><b class="text-white">${formatNumber(currentPrice)}</b></div>
                    <div class="bg-black/20 rounded-md px-2 py-1"><span class="text-gray-500 block">Hôm nay</span><b class="${dailyColorClass}">${dailyChangePercent == null ? '---' : `${isDailyUp ? '+' : ''}${dailyChangePercent.toFixed(2)}%`}</b></div>
                </div>

                ${(suggestedStop && suggestedTarget) ? `
                    <div class="flex items-center justify-between gap-2 text-[10px] px-1 ${stopBreached ? 'bg-red-500/10 border border-red-500/30 rounded-md py-1.5' : ''}">
                        <span class="${stopBreached ? 'text-red-300 font-semibold' : 'text-gray-500'}">${stopBreached ? 'Đã thủng stop' : 'Dừng lỗ'} <b class="text-red-400 ml-1">${formatNumber(suggestedStop)}</b></span>
                        <span class="text-gray-500">Mục tiêu <b class="text-green-400 ml-1">${formatNumber(suggestedTarget)}</b></span>
                    </div>
                ` : ''}

                ${(adviceTag || strategyBadges) ? `
                    <details class="group border-t border-dark-border/60 pt-2">
                        <summary class="cursor-pointer list-none flex justify-between items-center text-[11px] text-blue-300">
                            <span><i class="fas fa-chevron-right mr-1.5 transition-transform group-open:rotate-90"></i>Xem phân tích & gợi ý</span>
                            ${evalResult ? `<span class="text-gray-500">${evalResult.score} điểm</span>` : ''}
                        </summary>
                        <div class="mt-2 space-y-2">
                            ${strategyBadges ? `<div class="flex flex-wrap gap-1">${strategyBadges}</div>` : ''}
                            ${adviceTag ? `<div class="bg-[#0B0E14] border ${adviceClass} rounded-lg p-2 text-xs"><div class="font-bold mb-0.5">${adviceTag}</div><div class="text-gray-300 leading-relaxed">${adviceText}</div></div>` : ''}
                            <div class="text-[9px] text-gray-600">Các mức kỹ thuật chỉ mang tính tham khảo.</div>
                        </div>
                    </details>
                ` : ''}

                <div class="flex justify-between items-center pt-1 text-[11px]">
                    <button onclick="analyzeSymbol('${item.symbol}')" class="text-brand-primary font-semibold"><i class="fas fa-chart-line mr-1"></i>Biểu đồ</button>
                    <div class="flex gap-4">
                        <button onclick="openEditModal(${idx})" class="text-gray-400 hover:text-amber-400"><i class="fas fa-edit mr-1"></i>Sửa</button>
                        <button onclick="removeStockFromPortfolio('${item.symbol}')" class="text-gray-400 hover:text-red-400"><i class="fas fa-trash mr-1"></i>Xóa</button>
                    </div>
                </div>
            </div>
        `;
    }

    if (portfolioPlanChanged) savePortfolio();
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
    document.getElementById('port-stop').value = '';
    document.getElementById('port-target').value = '';
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
    const stopValue = parseFloat(document.getElementById('port-stop').value);
    const targetValue = parseFloat(document.getElementById('port-target').value);
    const stopLoss = Number.isFinite(stopValue) && stopValue > 0 ? stopValue : null;
    const target = Number.isFinite(targetValue) && targetValue > 0 ? targetValue : null;

    if (!symbol || !(price > 0) || !(vol > 0)) {
        alert('Vui lòng nhập đầy đủ Mã cổ phiếu, Giá mua và Số lượng hợp lệ!');
        return;
    }

    if (stopLoss && target && stopLoss >= target) {
        alert('Mức dừng lỗ phải thấp hơn mục tiêu.');
        return;
    }

    if (editingIndex !== null) {
        // Cập nhật mã đang sửa
        portfolio[editingIndex].buyPrice = price;
        portfolio[editingIndex].volume = vol;
        portfolio[editingIndex].stopLoss = stopLoss;
        portfolio[editingIndex].initialStopLoss = stopLoss;
        portfolio[editingIndex].target = target;
        savePortfolio();
        renderPortfolio();
    } else {
        // Thêm mã mới
        addStockToPortfolio(symbol, price, vol, stopLoss, target);
    }

    document.getElementById('modal-portfolio').classList.add('hidden');
    symbolInput.value = '';
    document.getElementById('port-price').value = '';
    document.getElementById('port-vol').value = '';
    document.getElementById('port-stop').value = '';
    document.getElementById('port-target').value = '';
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
