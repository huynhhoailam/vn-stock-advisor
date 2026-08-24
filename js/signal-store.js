// Lưu lịch sử tín hiệu hoàn toàn trong trình duyệt bằng IndexedDB.
const SIGNAL_DB_NAME = 'vnStockAdvisorDB';
const SIGNAL_DB_VERSION = 3;
const SIGNAL_STORE = 'signals';
const SIGNAL_FEE_RATE = 0.0015;
const SIGNAL_SELL_TAX_RATE = 0.001;
const SIGNAL_SLIPPAGE_RATE = 0.0005;

function openSignalDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(SIGNAL_DB_NAME, SIGNAL_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(SIGNAL_STORE)) {
                const store = db.createObjectStore(SIGNAL_STORE, { keyPath: 'id' });
                store.createIndex('createdAt', 'createdAt');
                store.createIndex('symbol', 'symbol');
            }
            if (!db.objectStoreNames.contains('paperAccounts')) {
                db.createObjectStore('paperAccounts', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('paperTrades')) {
                const tradeStore = db.createObjectStore('paperTrades', { keyPath: 'id', autoIncrement: true });
                tradeStore.createIndex('createdAt', 'createdAt');
            }
            if (!db.objectStoreNames.contains('backtestRuns')) {
                const backtestStore = db.createObjectStore('backtestRuns', { keyPath: 'id', autoIncrement: true });
                backtestStore.createIndex('createdAt', 'createdAt');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveSignalBatch(results, marketRegime) {
    if (!Array.isArray(results) || results.length === 0) return;
    // Hiệu suất mua chỉ được tính từ tín hiệu mua thực sự, không trộn HOLD/SELL.
    const eligibleResults = results.filter(result => result.signal === 'BUY' || result.signal === 'STRONG_BUY');
    if (eligibleResults.length === 0) return;
    const db = await openSignalDB();
    const transaction = db.transaction(SIGNAL_STORE, 'readwrite');
    const store = transaction.objectStore(SIGNAL_STORE);
    const sessionDate = new Date().toISOString().slice(0, 10);

    const existingRequest = store.getAll();
    existingRequest.onsuccess = () => {
        existingRequest.result
            .filter(row => row.sessionDate === sessionDate)
            .forEach(row => store.delete(row.id));

        eligibleResults.forEach(result => store.put({
            id: `${sessionDate}:${result.symbol}`,
            createdAt: new Date().toISOString(),
            sessionDate,
            symbol: result.symbol,
            price: result.price,
            score: result.score,
            signal: result.signal,
            strategies: (result.strategies || []).map(item => item.type),
            tradePlan: result.tradePlan,
            marketRegime: marketRegime?.type || 'NEUTRAL'
        }));
    };

    await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    db.close();
}

async function getSignalStats() {
    const db = await openSignalDB();
    const transaction = db.transaction(SIGNAL_STORE, 'readonly');
    const request = transaction.objectStore(SIGNAL_STORE).getAll();
    const rows = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
    db.close();
    const buyRows = rows.filter(row => row.signal === 'BUY' || row.signal === 'STRONG_BUY');

    const strategyCounts = {};
    buyRows.forEach(row => (row.strategies || []).forEach(type => {
        strategyCounts[type] = (strategyCounts[type] || 0) + 1;
    }));
    const latest = buyRows.reduce((value, row) => !value || row.createdAt > value ? row.createdAt : value, '');
    const horizons = [5, 10, 20];
    const performance = {};
    horizons.forEach(horizon => {
        const evaluated = buyRows.filter(row => row.outcomes?.[horizon]);
        const wins = evaluated.filter(row => row.outcomes[horizon].returnPct > 0).length;
        const averageReturn = evaluated.length
            ? evaluated.reduce((sum, row) => sum + row.outcomes[horizon].returnPct, 0) / evaluated.length
            : 0;
        performance[horizon] = {
            count: evaluated.length,
            wins,
            winRate: evaluated.length ? wins / evaluated.length * 100 : 0,
            averageReturn
        };
    });

    const strategyPerformance = {};
    const strategyLabels = ['MONEY_FLOW', 'LEADER', 'BOTTOM', 'BB_BREAKOUT'];
    strategyLabels.forEach(strategy => {
        const samples = buyRows.filter(row => (row.strategies || []).includes(strategy));
        const observations = samples.map(row => row.outcomes?.[20] || row.outcomes?.[10] || row.outcomes?.[5]).filter(Boolean);
        if (!observations.length) return;
        const wins = observations.filter(value => value.returnPct > 0).length;
        strategyPerformance[strategy] = {
            count: observations.length,
            winRate: wins / observations.length * 100,
            averageReturn: observations.reduce((sum, value) => sum + value.returnPct, 0) / observations.length
        };
    });
    return { total: buyRows.length, latest, strategyCounts, performance, strategyPerformance };
}

function calculateOutcome(row, candles, horizon) {
    const futureCandles = candles.filter(candle => new Date(candle.time).toISOString().slice(0, 10) > row.sessionDate);
    if (futureCandles.length < horizon) return null;
    const windowCandles = futureCandles.slice(0, horizon);
    const entryCandle = windowCandles[0];
    const entryPrice = entryCandle.open * (1 + SIGNAL_SLIPPAGE_RATE);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || (row.tradePlan?.stopLoss && entryPrice <= row.tradePlan.stopLoss)) return null;
    const exitCandle = windowCandles[horizon - 1];
    let status = 'TIME_EXIT';
    let exitPrice = exitCandle.close;
    let evaluatedDate = new Date(exitCandle.time).toISOString().slice(0, 10);

    // Bắt đầu từ phiên sau phiên vào để tránh dùng high/low đã xảy ra trước lúc khớp lệnh.
    for (const candle of windowCandles.slice(1)) {
        if (row.tradePlan?.stopLoss && (candle.open <= row.tradePlan.stopLoss || candle.low <= row.tradePlan.stopLoss)) {
            status = 'STOP';
            exitPrice = candle.open <= row.tradePlan.stopLoss ? candle.open : row.tradePlan.stopLoss;
            evaluatedDate = new Date(candle.time).toISOString().slice(0, 10);
            break;
        }
        if (row.tradePlan?.target1 && candle.high >= row.tradePlan.target1) {
            status = 'TARGET';
            exitPrice = row.tradePlan.target1;
            evaluatedDate = new Date(candle.time).toISOString().slice(0, 10);
            break;
        }
    }
    const executionExitPrice = exitPrice * (1 - SIGNAL_SLIPPAGE_RATE);
    const grossReturn = (executionExitPrice - entryPrice) / entryPrice;
    const netReturn = grossReturn - SIGNAL_FEE_RATE * 2 - SIGNAL_SELL_TAX_RATE;
    return {
        horizon,
        status,
        entryPrice,
        exitPrice: executionExitPrice,
        evaluatedDate,
        returnPct: netReturn * 100
    };
}

async function refreshSignalOutcomes() {
    const db = await openSignalDB();
    const readTransaction = db.transaction(SIGNAL_STORE, 'readonly');
    const request = readTransaction.objectStore(SIGNAL_STORE).getAll();
    const rows = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
    db.close();

    const today = new Date();
    const isBuySignal = row => row.signal === 'BUY' || row.signal === 'STRONG_BUY';
    const dueRows = rows.filter(row => {
        if (!isBuySignal(row)) return false;
        const ageDays = (today - new Date(`${row.sessionDate}T00:00:00`)) / 86400000;
        return (ageDays >= 6 && !row.outcomes?.[5]) || (ageDays >= 13 && !row.outcomes?.[10]) || (ageDays >= 27 && !row.outcomes?.[20]);
    });
    if (!dueRows.length) return 0;

    const symbols = [...new Set(dueRows.map(row => row.symbol))];
    const histories = {};
    for (let index = 0; index < symbols.length; index += 8) {
        const batch = symbols.slice(index, index + 8);
        await Promise.all(batch.map(async symbol => {
            histories[symbol] = await fetchStockHistory(symbol, 120);
        }));
    }

    const writeDb = await openSignalDB();
    const transaction = writeDb.transaction(SIGNAL_STORE, 'readwrite');
    const store = transaction.objectStore(SIGNAL_STORE);
    let updated = 0;
    dueRows.forEach(row => {
        const candles = histories[row.symbol];
        if (!candles?.length) return;
        const outcomes = { ...(row.outcomes || {}) };
        [5, 10, 20].forEach(horizon => {
            if (!outcomes[horizon]) outcomes[horizon] = calculateOutcome(row, candles, horizon);
        });
        Object.keys(outcomes).forEach(key => { if (!outcomes[key]) delete outcomes[key]; });
        if (Object.keys(outcomes).length > Object.keys(row.outcomes || {}).length) {
            store.put({ ...row, outcomes, lastOutcomeCheck: new Date().toISOString() });
            updated++;
        }
    });
    await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    writeDb.close();
    return updated;
}

async function renderSignalHistoryStats() {
    const element = document.getElementById('signal-history-stats');
    if (!element || !('indexedDB' in window)) return;
    try {
        const stats = await getSignalStats();
        if (!stats.total) {
            element.textContent = 'Chưa có lịch sử quét. Kết quả đạt tiêu chuẩn sẽ được lưu trên thiết bị này.';
            return;
        }
        const labels = { MONEY_FLOW: 'Dòng tiền', LEADER: 'Cổ mạnh', BOTTOM: 'Bắt đáy', BB_BREAKOUT: 'Breakout' };
        const breakdown = Object.entries(stats.strategyCounts)
            .map(([key, value]) => `${labels[key] || key}: ${value}`)
            .join(' · ');
        element.innerHTML = `<div class="flex justify-between"><b class="text-white">Lịch sử tín hiệu: ${stats.total} mã</b><span>${new Date(stats.latest).toLocaleDateString('vi-VN')}</span></div>${breakdown ? `<div class="mt-1 text-[10px]">${breakdown}</div>` : ''}`;
        renderStrategyPerformance(stats);
    } catch (error) {
        console.warn('Không thể đọc lịch sử tín hiệu:', error.message);
    }
}

function renderStrategyPerformance(stats) {
    const card = document.getElementById('strategy-performance');
    const content = document.getElementById('strategy-performance-content');
    if (!card || !content) return;
    const horizonRows = [5, 10, 20].filter(horizon => stats.performance[horizon].count > 0);
    if (!horizonRows.length) {
        card.classList.remove('hidden');
        content.textContent = 'Chưa có tín hiệu đủ 5 phiên để đánh giá. Hệ thống sẽ tự cập nhật khi dữ liệu đến hạn.';
        return;
    }
    const horizonHtml = horizonRows.map(horizon => {
        const item = stats.performance[horizon];
        const color = item.averageReturn >= 0 ? 'text-green-400' : 'text-red-400';
        return `<div class="bg-[#0B0E14] rounded-lg p-2 text-center"><div class="text-gray-500">Sau ${horizon} phiên (${item.count})</div><b class="${color}">${item.winRate.toFixed(0)}% thắng · ${item.averageReturn >= 0 ? '+' : ''}${item.averageReturn.toFixed(2)}%</b></div>`;
    }).join('');
    const labels = { MONEY_FLOW: 'Dòng tiền', LEADER: 'Xu hướng', BOTTOM: 'Bắt đáy', BB_BREAKOUT: 'Breakout' };
    const strategyHtml = Object.entries(stats.strategyPerformance).map(([key, item]) =>
        `<div class="flex justify-between border-t border-dark-border/50 py-1.5"><span>${labels[key] || key} (${item.count})</span><b class="${item.averageReturn >= 0 ? 'text-green-400' : 'text-red-400'}">${item.winRate.toFixed(0)}% thắng · ${item.averageReturn >= 0 ? '+' : ''}${item.averageReturn.toFixed(2)}%</b></div>`
    ).join('');
    card.classList.remove('hidden');
    content.innerHTML = `<div class="grid grid-cols-3 gap-2">${horizonHtml}</div>${strategyHtml ? `<div class="mt-2">${strategyHtml}</div>` : ''}`;
}
