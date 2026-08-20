// Paper Trading: mô phỏng giao dịch hoàn toàn cục bộ.
const PAPER_INITIAL_CASH = 500000000;
const PAPER_FEE_RATE = 0.0015;
const PAPER_SELL_TAX_RATE = 0.001;
const PAPER_SLIPPAGE_RATE = 0.0005;
let paperOrderSide = 'BUY';
let paperReferencePrice = 0;

const paperCurrency = value => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
const paperPrice = value => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);

async function paperDbAction(storeNames, mode, callback) {
    const db = await openSignalDB();
    const transaction = db.transaction(storeNames, mode);
    const completion = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    const result = await callback(transaction);
    await completion;
    db.close();
    return result;
}

async function getPaperAccount() {
    const account = await paperDbAction(['paperAccounts'], 'readonly', transaction => new Promise((resolve, reject) => {
        const request = transaction.objectStore('paperAccounts').get('main');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
    if (account) return account;
    const fresh = { id: 'main', initialCash: PAPER_INITIAL_CASH, cash: PAPER_INITIAL_CASH, realizedPL: 0, positions: {}, updatedAt: new Date().toISOString() };
    await savePaperAccount(fresh);
    return fresh;
}

async function savePaperAccount(account) {
    account.updatedAt = new Date().toISOString();
    await paperDbAction(['paperAccounts'], 'readwrite', transaction => {
        transaction.objectStore('paperAccounts').put(account);
    });
}

async function getPaperTrades() {
    const trades = await paperDbAction(['paperTrades'], 'readonly', transaction => new Promise((resolve, reject) => {
        const request = transaction.objectStore('paperTrades').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    }));
    return trades.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getPaperEstimatedEquity(account) {
    const positions = Object.values(account.positions || {});
    const values = await Promise.all(positions.map(async position => {
        try {
            return (await getPaperPrice(position.symbol)) * position.volume;
        } catch (_) {
            return position.avgPrice * position.volume;
        }
    }));
    return account.cash + values.reduce((sum, value) => sum + value, 0);
}

async function getPaperQuote(symbol) {
    const candles = await fetchStockHistory(symbol, 10);
    if (!candles?.length) throw new Error(`Không lấy được giá ${symbol}.`);
    const latestClose = candles[candles.length - 1].close;
    const previousClose = candles.length > 1 ? candles[candles.length - 2].close : null;
    return {
        price: latestClose * 1000,
        dailyChangePercent: previousClose > 0 ? (latestClose - previousClose) / previousClose * 100 : null
    };
}

async function getPaperPrice(symbol) {
    return (await getPaperQuote(symbol)).price;
}

async function executePaperOrder(symbol, side, volume) {
    symbol = symbol.toUpperCase().trim();
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error('Mã cổ phiếu không hợp lệ.');
    if (!Number.isInteger(volume) || volume <= 0 || volume % 100 !== 0) throw new Error('Số lượng phải là bội số của 100.');

    const marketPrice = await getPaperPrice(symbol);
    const executionPrice = marketPrice * (side === 'BUY' ? 1 + PAPER_SLIPPAGE_RATE : 1 - PAPER_SLIPPAGE_RATE);
    const grossValue = executionPrice * volume;
    const fee = grossValue * PAPER_FEE_RATE;
    const tax = side === 'SELL' ? grossValue * PAPER_SELL_TAX_RATE : 0;
    const account = await getPaperAccount();
    const current = account.positions[symbol] || { symbol, volume: 0, avgPrice: 0 };
    let tradeRealizedPL = 0;

    if (side === 'BUY') {
        const totalCost = grossValue + fee;
        if (account.cash < totalCost) throw new Error(`Không đủ tiền mặt. Cần ${paperCurrency(totalCost)}.`);
        const existingCost = current.avgPrice * current.volume;
        const currentEquity = await getPaperEstimatedEquity(account);
        const projectedWeight = currentEquity > 0 ? (existingCost + totalCost) / currentEquity * 100 : 100;
        if (projectedWeight > 30) throw new Error(`Lệnh khiến ${symbol} vượt 30% vốn ban đầu (${projectedWeight.toFixed(1)}%). Hãy giảm số lượng.`);
        const newVolume = current.volume + volume;
        current.avgPrice = (current.avgPrice * current.volume + grossValue + fee) / newVolume;
        current.volume = newVolume;
        const scanResult = typeof scannedResults !== 'undefined' ? scannedResults.find(item => item.symbol === symbol) : null;
        if (scanResult?.tradePlan) {
            current.stopLoss = scanResult.tradePlan.stopLoss * 1000;
            current.target = scanResult.tradePlan.target1 * 1000;
        }
        account.cash -= totalCost;
        account.positions[symbol] = current;
    } else {
        if (current.volume < volume) throw new Error(`Chỉ đang giữ ${current.volume || 0} cổ phiếu ${symbol}.`);
        account.cash += grossValue - fee - tax;
        tradeRealizedPL = (executionPrice - current.avgPrice) * volume - fee - tax;
        account.realizedPL = (account.realizedPL || 0) + tradeRealizedPL;
        current.volume -= volume;
        if (current.volume === 0) delete account.positions[symbol];
        else account.positions[symbol] = current;
    }

    const trade = { createdAt: new Date().toISOString(), symbol, side, volume, marketPrice, executionPrice, grossValue, fee, tax, realizedPL: side === 'SELL' ? tradeRealizedPL : null };
    await paperDbAction(['paperAccounts', 'paperTrades'], 'readwrite', transaction => {
        transaction.objectStore('paperAccounts').put({ ...account, updatedAt: new Date().toISOString() });
        transaction.objectStore('paperTrades').add(trade);
    });
    return trade;
}

async function renderPaperTrading() {
    const positionsElement = document.getElementById('paper-positions');
    if (!positionsElement) return;
    positionsElement.innerHTML = '<div class="text-center text-gray-500 text-xs py-6">Đang cập nhật giá...</div>';
    const [account, trades] = await Promise.all([getPaperAccount(), getPaperTrades()]);
    const positions = Object.values(account.positions || {});
    let marketValue = 0;
    let positionHtml = '';
    const maxPositionWeight = 25;

    for (const position of positions) {
        let price = position.avgPrice;
        let dailyChangePercent = null;
        try {
            const quote = await getPaperQuote(position.symbol);
            price = quote.price;
            dailyChangePercent = quote.dailyChangePercent;
        } catch (_) {}
        const value = price * position.volume;
        const cost = position.avgPrice * position.volume;
        const pl = value - cost;
        const plPercent = cost ? pl / cost * 100 : 0;
        const planStatus = position.stopLoss && price <= position.stopLoss
            ? '<span class="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-400">VI PHẠM STOP</span>'
            : (position.target && price >= position.target
                ? '<span class="text-[10px] px-2 py-0.5 rounded bg-green-500/15 text-green-400">ĐẠT MỤC TIÊU</span>'
                : '');
        marketValue += value;
        const provisionalAssets = account.cash + Object.values(account.positions || {}).reduce((sum, item) => sum + item.avgPrice * item.volume, 0);
        const positionWeight = provisionalAssets ? value / provisionalAssets * 100 : 0;
        const dailyChangeClass = dailyChangePercent == null ? 'text-gray-500' : (dailyChangePercent >= 0 ? 'text-brand-up' : 'text-brand-down');
        const dailyChangeText = dailyChangePercent == null ? '---' : `${dailyChangePercent >= 0 ? '+' : ''}${dailyChangePercent.toFixed(2)}%`;
        positionHtml += `<div class="bg-dark-card border border-dark-border rounded-xl p-3">
            <div class="flex justify-between"><div class="min-w-0"><div class="flex items-center gap-2"><b class="text-white text-lg">${position.symbol}</b>${planStatus}</div><div class="text-[10px] text-gray-500">${position.volume} CP · Giá vốn ${paperCurrency(position.avgPrice)}</div><div class="paper-live-price text-xs mt-1 flex items-center gap-3 whitespace-nowrap"><span class="text-gray-500">Giá hiện tại: <b class="text-white">${paperPrice(price)}</b></span><span class="${dailyChangeClass} flex-shrink-0">Hôm nay: <b>${dailyChangeText}</b></span></div></div><div class="text-right flex-shrink-0"><b class="text-white">${paperCurrency(value)}</b><div class="text-xs ${pl >= 0 ? 'text-green-400' : 'text-red-400'}">${pl >= 0 ? '+' : ''}${paperCurrency(pl)} (${plPercent.toFixed(2)}%)</div></div></div>
            ${(position.stopLoss || position.target) ? `<div class="text-[10px] text-gray-500 mt-2">Dừng lỗ: <span class="text-red-400">${paperCurrency(position.stopLoss || 0)}</span> · Mục tiêu: <span class="text-green-400">${paperCurrency(position.target || 0)}</span></div>` : ''}
            <div class="text-[10px] mt-1 ${positionWeight > maxPositionWeight ? 'text-amber-400' : 'text-gray-500'}">Tỷ trọng ước tính: ${positionWeight.toFixed(1)}%${positionWeight > maxPositionWeight ? ' · Tập trung cao' : ''}</div>
            <button onclick="openPaperOrder('${position.symbol}','SELL')" class="mt-2 text-xs text-red-400 border border-red-500/30 rounded-lg px-3 py-1.5">Bán thử</button>
        </div>`;
    }

    const totalAssets = account.cash + marketValue;
    const totalPl = totalAssets - account.initialCash;
    const totalPlPercent = account.initialCash ? totalPl / account.initialCash * 100 : 0;
    document.getElementById('paper-total-assets').textContent = paperCurrency(totalAssets);
    document.getElementById('paper-cash').textContent = paperCurrency(account.cash);
    document.getElementById('paper-market-value').textContent = paperCurrency(marketValue);
    const realizedElement = document.getElementById('paper-realized-pl');
    const realizedPL = account.realizedPL || 0;
    realizedElement.textContent = `${realizedPL >= 0 ? '+' : ''}${paperCurrency(realizedPL)}`;
    realizedElement.className = realizedPL >= 0 ? 'text-green-400' : 'text-red-400';
    document.getElementById('paper-cash-ratio').textContent = totalAssets ? `${(account.cash / totalAssets * 100).toFixed(1)}%` : '0%';
    const totalPlElement = document.getElementById('paper-total-pl');
    totalPlElement.textContent = `Lãi/lỗ: ${totalPl >= 0 ? '+' : ''}${paperCurrency(totalPl)} (${totalPlPercent.toFixed(2)}%)`;
    totalPlElement.className = `text-xs mt-1 ${totalPl >= 0 ? 'text-green-400' : 'text-red-400'}`;
    positionsElement.innerHTML = positionHtml || '<div class="text-center text-gray-500 text-xs py-6">Chưa có vị thế</div>';

    document.getElementById('paper-trades').innerHTML = trades.slice(0, 30).map(trade => `<div class="bg-dark-card border border-dark-border rounded-lg p-2.5 flex justify-between text-xs"><div><b class="${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}">${trade.side === 'BUY' ? 'MUA' : 'BÁN'} ${trade.symbol}</b><div class="text-gray-500">${new Date(trade.createdAt).toLocaleString('vi-VN')}</div></div><div class="text-right text-gray-300">${trade.volume} × ${paperCurrency(trade.executionPrice)}<div class="text-[10px] text-gray-500">Phí/thuế ${paperCurrency(trade.fee + trade.tax)}</div></div></div>`).join('') || '<div class="text-center text-gray-500 text-xs py-6">Chưa có giao dịch</div>';
}

async function updatePaperOrderEstimate() {
    const symbol = document.getElementById('paper-symbol').value.toUpperCase().trim();
    const volume = Number(document.getElementById('paper-volume').value);
    const estimate = document.getElementById('paper-order-estimate');
    if (!symbol || !volume) return;
    try {
        paperReferencePrice = await getPaperPrice(symbol);
        document.getElementById('paper-reference-price').textContent = paperCurrency(paperReferencePrice);
        const executionPrice = paperReferencePrice * (paperOrderSide === 'BUY' ? 1 + PAPER_SLIPPAGE_RATE : 1 - PAPER_SLIPPAGE_RATE);
        const gross = executionPrice * volume;
        const costs = gross * PAPER_FEE_RATE + (paperOrderSide === 'SELL' ? gross * PAPER_SELL_TAX_RATE : 0);
        estimate.textContent = `${paperOrderSide === 'BUY' ? 'Tổng tiền dự kiến' : 'Tiền nhận dự kiến'}: ${paperCurrency(paperOrderSide === 'BUY' ? gross + costs : gross - costs)}`;
    } catch (error) {
        estimate.textContent = error.message;
    }
}

async function applyPaperRiskSizing() {
    const symbol = document.getElementById('paper-symbol').value.toUpperCase().trim();
    if (!symbol) {
        alert('Nhập mã cổ phiếu trước khi tính khối lượng.');
        return;
    }
    try {
        const [account, price] = await Promise.all([getPaperAccount(), getPaperPrice(symbol)]);
        const currentEquity = await getPaperEstimatedEquity(account);
        const riskPercent = Number(document.getElementById('paper-risk-percent').value) / 100;
        const scanResult = typeof scannedResults !== 'undefined' ? scannedResults.find(item => item.symbol === symbol) : null;
        const stopLoss = scanResult?.tradePlan?.stopLoss ? scanResult.tradePlan.stopLoss * 1000 : price * 0.95;
        const perShareRisk = Math.max(price - stopLoss, price * 0.01);
        const riskBudget = currentEquity * riskPercent;
        const riskVolume = Math.floor(riskBudget / perShareRisk / 100) * 100;
        const cashVolume = Math.floor(account.cash / (price * (1 + PAPER_SLIPPAGE_RATE + PAPER_FEE_RATE)) / 100) * 100;
        const volume = Math.max(0, Math.min(riskVolume, cashVolume));
        if (volume < 100) throw new Error('Tài khoản không đủ tiền cho lô 100 cổ phiếu trong giới hạn rủi ro đã chọn.');
        document.getElementById('paper-volume').value = volume;
        paperReferencePrice = price;
        await updatePaperOrderEstimate();
        document.getElementById('paper-order-estimate').innerHTML += `<div class="mt-1 text-blue-300">Khối lượng theo rủi ro ${(riskPercent * 100).toFixed(1)}% · stop ${paperCurrency(stopLoss)} · ngân sách rủi ro ${paperCurrency(riskBudget)}</div>`;
    } catch (error) {
        alert(error.message);
    }
}

function setPaperOrderSide(side) {
    paperOrderSide = side;
    const buy = document.getElementById('paper-side-buy');
    const sell = document.getElementById('paper-side-sell');
    buy.className = side === 'BUY' ? 'py-2 rounded-lg bg-green-500/20 text-green-400 border border-green-500/40 font-bold' : 'py-2 rounded-lg bg-dark-border text-gray-400 font-bold';
    sell.className = side === 'SELL' ? 'py-2 rounded-lg bg-red-500/20 text-red-400 border border-red-500/40 font-bold' : 'py-2 rounded-lg bg-dark-border text-gray-400 font-bold';
    updatePaperOrderEstimate();
}

function openPaperOrder(symbol = '', side = 'BUY') {
    document.getElementById('paper-symbol').value = symbol;
    document.getElementById('paper-volume').value = '100';
    document.getElementById('paper-reference-price').textContent = '---';
    document.getElementById('modal-paper-order').classList.remove('hidden');
    setPaperOrderSide(side);
    if (symbol) updatePaperOrderEstimate();
}

document.getElementById('btn-paper-buy')?.addEventListener('click', () => openPaperOrder('', 'BUY'));
document.getElementById('btn-close-paper-order')?.addEventListener('click', () => document.getElementById('modal-paper-order').classList.add('hidden'));
document.getElementById('paper-side-buy')?.addEventListener('click', () => setPaperOrderSide('BUY'));
document.getElementById('paper-side-sell')?.addEventListener('click', () => setPaperOrderSide('SELL'));
document.getElementById('paper-symbol')?.addEventListener('change', updatePaperOrderEstimate);
document.getElementById('paper-volume')?.addEventListener('input', updatePaperOrderEstimate);
document.getElementById('btn-paper-risk-size')?.addEventListener('click', applyPaperRiskSizing);
document.getElementById('btn-submit-paper-order')?.addEventListener('click', async () => {
    const button = document.getElementById('btn-submit-paper-order');
    try {
        button.disabled = true;
        button.textContent = 'Đang khớp lệnh...';
        await executePaperOrder(document.getElementById('paper-symbol').value, paperOrderSide, Number(document.getElementById('paper-volume').value));
        document.getElementById('modal-paper-order').classList.add('hidden');
        await renderPaperTrading();
    } catch (error) {
        alert(error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Xác nhận lệnh thử';
    }
});
async function resetPaperAccount(initialCash) {
    await paperDbAction(['paperAccounts', 'paperTrades'], 'readwrite', transaction => {
        transaction.objectStore('paperAccounts').clear();
        transaction.objectStore('paperTrades').clear();
        transaction.objectStore('paperAccounts').put({ id: 'main', initialCash, cash: initialCash, realizedPL: 0, positions: {}, updatedAt: new Date().toISOString() });
    });
    await renderPaperTrading();
}

document.getElementById('btn-reset-paper')?.addEventListener('click', async () => {
    const account = await getPaperAccount();
    document.getElementById('paper-initial-capital').value = Math.round(account.initialCash);
    document.getElementById('modal-paper-capital').classList.remove('hidden');
});
document.getElementById('btn-cancel-paper-capital')?.addEventListener('click', () => {
    document.getElementById('modal-paper-capital').classList.add('hidden');
});
document.getElementById('btn-save-paper-capital')?.addEventListener('click', async () => {
    const initialCash = Number(document.getElementById('paper-initial-capital').value);
    if (!Number.isFinite(initialCash) || initialCash < 1000000 || initialCash > 10000000000000) {
        alert('Vốn thử nghiệm phải từ 1 triệu đến 10.000 tỷ đồng.');
        return;
    }
    await resetPaperAccount(initialCash);
    document.getElementById('modal-paper-capital').classList.add('hidden');
});
