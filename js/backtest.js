// Backtest walk-forward: chỉ dùng dữ liệu đã có tại thời điểm tạo tín hiệu.
let backtestBenchmarkCache = null;

async function getBacktestBenchmark(days) {
    if (backtestBenchmarkCache?.days >= days) return backtestBenchmarkCache.candles;
    const candles = await fetchStockHistory('VNINDEX', days);
    backtestBenchmarkCache = { days, candles: candles || [] };
    return backtestBenchmarkCache.candles;
}

function runWalkForwardBacktest(symbol, candles, benchmarkCandles = [], strategyFilter = 'TREND') {
    const trades = [];
    let equity = 100;
    let peakEquity = equity;
    let maxDrawdown = 0;
    const riskBudgetFraction = 0.01;
    const maxPositionWeight = 0.25;

    for (let signalIndex = 60; signalIndex < candles.length - 2; signalIndex++) {
        const knownData = candles.slice(0, signalIndex + 1);
        const signalTime = candles[signalIndex].time;
        const knownBenchmark = benchmarkCandles.filter(candle => candle.time <= signalTime);
        const regime = knownBenchmark.length >= 50 ? evaluateMarketRegime(knownBenchmark) : null;
        const result = evaluateStock(symbol, knownData, null, regime, knownBenchmark);
        const isBottom = result?.strategies.some(strategy => strategy.type === 'BOTTOM');
        const marketAllowsTrade = regime?.type !== 'BEAR' || isBottom;
        const strategyTypes = result?.strategies.map(strategy => strategy.type) || [];
        const matchesStrategy = strategyFilter === 'ALL'
            || (strategyFilter === 'TREND' && strategyTypes.includes('LEADER'))
            || (strategyFilter === 'BREAKOUT' && (strategyTypes.includes('MONEY_FLOW') || strategyTypes.includes('BB_BREAKOUT')))
            || (strategyFilter === 'BOTTOM' && strategyTypes.includes('BOTTOM'));
        const isBottomProbe = strategyFilter === 'BOTTOM'
            && isBottom
            && (result?.signal === 'BUY' || result?.signal === 'STRONG_BUY')
            && result.score >= 66;
        const hasSetup = result && marketAllowsTrade && matchesStrategy && result.strategies.length > 0
            && ((result.signal === 'STRONG_BUY' && result.score >= 82) || isBottomProbe);
        if (!hasSetup) continue;

        let entryIndex = -1;
        let rawEntryPrice = 0;
        for (let pendingIndex = signalIndex + 1; pendingIndex <= Math.min(signalIndex + 3, candles.length - 1); pendingIndex++) {
            const pendingCandle = candles[pendingIndex];
            if (pendingCandle.open >= result.tradePlan.entryLow && pendingCandle.open <= result.tradePlan.entryHigh) {
                entryIndex = pendingIndex;
                rawEntryPrice = pendingCandle.open;
                break;
            }
            if (pendingCandle.low <= result.tradePlan.entryHigh && pendingCandle.high >= result.tradePlan.entryLow) {
                entryIndex = pendingIndex;
                rawEntryPrice = result.tradePlan.entryHigh;
                break;
            }
        }
        if (entryIndex < 0 || rawEntryPrice <= result.tradePlan.stopLoss) continue;
        const entryCandle = candles[entryIndex];
        const entryPrice = rawEntryPrice * (1 + PAPER_SLIPPAGE_RATE);
        const stopLoss = result.tradePlan.stopLoss;
        const target = result.tradePlan.target1;
        const initialRisk = Math.max(entryPrice - stopLoss, entryPrice * 0.01);
        let activeStop = stopLoss;
        let breakevenArmed = false;
        const stopRiskFraction = Math.max((entryPrice - stopLoss) / entryPrice, 0.01);
        const positionWeight = Math.min(maxPositionWeight, riskBudgetFraction / stopRiskFraction);
        const equityBeforeTrade = equity;
        const lastExitIndex = Math.min(entryIndex + 19, candles.length - 1);
        let exitIndex = lastExitIndex;
        let rawExitPrice = candles[lastExitIndex].close;
        let exitReason = 'TIME';

        // Không dùng high/low của nến khớp lệnh vì không biết biến động xảy ra trước hay sau thời điểm khớp.
        for (let index = entryIndex + 1; index <= lastExitIndex; index++) {
            const candle = candles[index];
            const markedReturn = ((candle.close - entryPrice) / entryPrice) * positionWeight;
            const markedEquity = equityBeforeTrade * (1 + markedReturn);
            peakEquity = Math.max(peakEquity, markedEquity);
            const lowReturn = ((candle.low - entryPrice) / entryPrice) * positionWeight;
            const lowEquity = equityBeforeTrade * (1 + lowReturn);
            maxDrawdown = Math.max(maxDrawdown, (peakEquity - lowEquity) / peakEquity * 100);

            if (candle.open <= activeStop || candle.low <= activeStop) {
                rawExitPrice = candle.open <= activeStop ? candle.open : activeStop;
                exitIndex = index;
                exitReason = breakevenArmed ? 'BREAKEVEN' : 'STOP';
                break;
            }
            if (candle.open >= target || candle.high >= target) {
                rawExitPrice = target;
                exitIndex = index;
                exitReason = 'TARGET';
                break;
            }
            // Chỉ dời stop từ phiên kế tiếp sau khi giá đã đi được ít nhất 1R,
            // tránh giả định sai thứ tự high/low trong cùng một nến ngày.
            if (!breakevenArmed && candle.high >= entryPrice + initialRisk) {
                activeStop = entryPrice;
                breakevenArmed = true;
            }
        }

        const exitPrice = rawExitPrice * (1 - PAPER_SLIPPAGE_RATE);
        const grossReturn = (exitPrice - entryPrice) / entryPrice;
        const netReturn = grossReturn - PAPER_FEE_RATE * 2 - PAPER_SELL_TAX_RATE;
        const netReturnPct = netReturn * 100;
        const portfolioReturn = netReturn * positionWeight;
        equity = equityBeforeTrade * (1 + portfolioReturn);
        peakEquity = Math.max(peakEquity, equity);
        maxDrawdown = Math.max(maxDrawdown, (peakEquity - equity) / peakEquity * 100);

        trades.push({
            symbol,
            signalDate: new Date(candles[signalIndex].time).toISOString().slice(0, 10),
            entryDate: new Date(entryCandle.time).toISOString().slice(0, 10),
            exitDate: new Date(candles[exitIndex].time).toISOString().slice(0, 10),
            entryPrice,
            exitPrice,
            exitReason,
            netReturnPct,
            portfolioReturnPct: portfolioReturn * 100,
            positionWeightPct: positionWeight * 100,
            score: result.score,
            strategies: result.strategies.map(strategy => strategy.type)
            ,marketRegime: regime?.type || 'NEUTRAL'
        });
        signalIndex = exitIndex;
    }

    const wins = trades.filter(trade => trade.netReturnPct > 0);
    const losses = trades.filter(trade => trade.netReturnPct <= 0);
    const grossProfit = wins.reduce((sum, trade) => sum + trade.portfolioReturnPct, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.portfolioReturnPct, 0));
    return {
        trades,
        totalReturnPct: equity - 100,
        winRate: trades.length ? wins.length / trades.length * 100 : 0,
        averageReturn: trades.length ? trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / trades.length : 0,
        maxDrawdown,
        profitFactor: grossLoss ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0)
    };
}

function renderBacktestResult(symbol, result) {
    const element = document.getElementById('backtest-results');
    if (!result.trades.length) {
        element.innerHTML = `<div class="text-center text-amber-400 py-3">Không có giao dịch nào thỏa điều kiện nghiêm ngặt trong giai đoạn này.</div>`;
        return;
    }
    const returnClass = result.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400';
    const factor = Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : '∞';
    const recentTrades = result.trades.slice(-5).reverse().map(trade => `<div class="flex justify-between border-t border-dark-border/50 py-1.5"><span>${trade.entryDate} → ${trade.exitDate} · ${trade.exitReason}<small class="block text-[9px] text-gray-600">${trade.score}đ · ${trade.strategies.join('/')} · tỷ trọng ${trade.positionWeightPct.toFixed(1)}%</small></span><b class="${trade.portfolioReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}">${trade.portfolioReturnPct >= 0 ? '+' : ''}${trade.portfolioReturnPct.toFixed(2)}% tài khoản</b></div>`).join('');
    element.innerHTML = `
        <div class="grid grid-cols-2 gap-2">
            <div class="bg-[#0B0E14] rounded-lg p-2"><div class="text-gray-500">Lợi nhuận mô phỏng</div><b class="${returnClass}">${result.totalReturnPct >= 0 ? '+' : ''}${result.totalReturnPct.toFixed(2)}%</b></div>
            <div class="bg-[#0B0E14] rounded-lg p-2"><div class="text-gray-500">Tỷ lệ thắng</div><b class="text-white">${result.winRate.toFixed(1)}% / ${result.trades.length} lệnh</b></div>
            <div class="bg-[#0B0E14] rounded-lg p-2"><div class="text-gray-500">Drawdown lớn nhất</div><b class="text-red-400">-${result.maxDrawdown.toFixed(2)}%</b></div>
            <div class="bg-[#0B0E14] rounded-lg p-2"><div class="text-gray-500">Profit factor</div><b class="text-white">${factor}</b></div>
        </div>
        <div class="mt-2 text-[10px] text-gray-500">Mỗi lệnh rủi ro tối đa 1%, tỷ trọng tối đa 25%; đã gồm phí, thuế, trượt giá và gap qua stop. Kết quả quá khứ không đảm bảo hiệu quả tương lai.</div>
        <div class="mt-2">${recentTrades}</div>`;
}

document.getElementById('btn-run-backtest')?.addEventListener('click', async () => {
    const button = document.getElementById('btn-run-backtest');
    const symbol = document.getElementById('backtest-symbol').value.toUpperCase().trim();
    const days = Number(document.getElementById('backtest-days').value);
    const strategyFilter = document.getElementById('backtest-strategy').value;
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
        alert('Vui lòng nhập mã cổ phiếu hợp lệ.');
        return;
    }
    try {
        button.disabled = true;
        button.textContent = 'Đang tải và chạy backtest...';
        document.getElementById('backtest-results').textContent = 'Đang mô phỏng từng phiên, không sử dụng dữ liệu tương lai...';
        const [candles, benchmark] = await Promise.all([fetchStockHistory(symbol, days), getBacktestBenchmark(days)]);
        if (!candles || candles.length < 100) throw new Error('Không đủ dữ liệu lịch sử để backtest.');
        await new Promise(resolve => setTimeout(resolve, 20));
        renderBacktestResult(symbol, runWalkForwardBacktest(symbol, candles, benchmark, strategyFilter));
    } catch (error) {
        document.getElementById('backtest-results').innerHTML = `<div class="text-red-400">${error.message}</div>`;
    } finally {
        button.disabled = false;
        button.textContent = 'Chạy backtest';
    }
});

function aggregateBatchBacktests(items) {
    const allTrades = items.flatMap(item => item.result.trades.map(trade => ({ ...trade, symbol: item.symbol })));
    const wins = allTrades.filter(trade => trade.netReturnPct > 0);
    const strategyStats = {};
    const exitReasons = {};
    allTrades.forEach(trade => { exitReasons[trade.exitReason] = (exitReasons[trade.exitReason] || 0) + 1; });
    allTrades.forEach(trade => trade.strategies.forEach(strategy => {
        const entry = strategyStats[strategy] || { count: 0, wins: 0, totalReturn: 0 };
        entry.count++;
        if (trade.netReturnPct > 0) entry.wins++;
        entry.totalReturn += trade.netReturnPct;
        strategyStats[strategy] = entry;
    }));
    return {
        symbolCount: items.length,
        tradeCount: allTrades.length,
        winRate: allTrades.length ? wins.length / allTrades.length * 100 : 0,
        averageTrade: allTrades.length ? allTrades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / allTrades.length : 0,
        averagePortfolioReturn: items.length ? items.reduce((sum, item) => sum + item.result.totalReturnPct, 0) / items.length : 0,
        worstDrawdown: items.length ? Math.max(...items.map(item => item.result.maxDrawdown)) : 0,
        strategyStats,
        exitReasons,
        symbols: items.map(item => ({ symbol: item.symbol, trades: item.result.trades.length, totalReturnPct: item.result.totalReturnPct, winRate: item.result.winRate }))
    };
}

function renderBatchBacktest(summary) {
    const element = document.getElementById('batch-backtest-results');
    const labels = { MONEY_FLOW: 'Dòng tiền', LEADER: 'Xu hướng', BOTTOM: 'Bắt đáy', BB_BREAKOUT: 'Breakout' };
    const strategies = Object.entries(summary.strategyStats).map(([key, value]) => `<div class="flex justify-between py-1 border-t border-dark-border/40"><span>${labels[key] || key} (${value.count})</span><b class="${value.totalReturn >= 0 ? 'text-green-400' : 'text-red-400'}">${(value.wins / value.count * 100).toFixed(0)}% thắng · ${(value.totalReturn / value.count).toFixed(2)}%/lệnh</b></div>`).join('');
    const symbols = [...summary.symbols].sort((a, b) => b.totalReturnPct - a.totalReturnPct).map(item => `<div class="flex justify-between py-1"><span>${item.symbol} · ${item.trades} lệnh</span><b class="${item.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}">${item.totalReturnPct >= 0 ? '+' : ''}${item.totalReturnPct.toFixed(2)}%</b></div>`).join('');
    const exitLabels = { TARGET: 'Mục tiêu', STOP: 'Dừng lỗ', BREAKEVEN: 'Hòa vốn', TIME: 'Hết thời gian' };
    const exits = Object.entries(summary.exitReasons || {}).map(([key, value]) => `${exitLabels[key] || key}: ${value}`).join(' · ');
    const hasEvidence = summary.tradeCount >= 30;
    const positiveEdge = hasEvidence && summary.averageTrade > 0 && summary.averagePortfolioReturn > 0;
    const verdict = !hasEvidence
        ? '<div class="mb-2 p-2 rounded-lg bg-amber-500/10 text-amber-300">Mẫu còn nhỏ; chưa đủ cơ sở kết luận chiến lược có lợi thế.</div>'
        : positiveEdge
            ? '<div class="mb-2 p-2 rounded-lg bg-green-500/10 text-green-300">Có dấu hiệu lợi thế trên mẫu kiểm tra; cần tiếp tục paper trading để xác nhận.</div>'
            : '<div class="mb-2 p-2 rounded-lg bg-red-500/10 text-red-300">Chưa chứng minh được lợi thế. Không nên dùng kết quả này để tự động mua.</div>';
    element.innerHTML = `${verdict}<div class="grid grid-cols-2 gap-2"><div class="bg-[#0B0E14] rounded p-2"><div class="text-gray-500">TB danh mục</div><b class="${summary.averagePortfolioReturn >= 0 ? 'text-green-400' : 'text-red-400'}">${summary.averagePortfolioReturn.toFixed(2)}%</b></div><div class="bg-[#0B0E14] rounded p-2"><div class="text-gray-500">Tỷ lệ thắng</div><b>${summary.winRate.toFixed(1)}% / ${summary.tradeCount} lệnh</b></div><div class="bg-[#0B0E14] rounded p-2"><div class="text-gray-500">TB mỗi lệnh</div><b>${summary.averageTrade.toFixed(2)}%</b></div><div class="bg-[#0B0E14] rounded p-2"><div class="text-gray-500">Drawdown xấu nhất</div><b class="text-red-400">-${summary.worstDrawdown.toFixed(2)}%</b></div></div><div class="mt-2 text-[10px] text-gray-500">${exits}</div><div class="mt-2"><b class="text-white">Theo chiến lược</b>${strategies || '<div class="text-gray-500">Chưa đủ mẫu</div>'}</div><details class="mt-2"><summary class="text-blue-300 cursor-pointer">Chi tiết từng mã</summary><div class="mt-1">${symbols}</div></details>`;
}

document.getElementById('btn-run-batch-backtest')?.addEventListener('click', async () => {
    const button = document.getElementById('btn-run-batch-backtest');
    const output = document.getElementById('batch-backtest-results');
    const symbols = [...new Set(document.getElementById('batch-backtest-symbols').value.toUpperCase().split(/[\s,;]+/).filter(symbol => /^[A-Z0-9]{2,10}$/.test(symbol)))].slice(0, 20);
    if (symbols.length < 2) {
        alert('Nhập ít nhất 2 mã hợp lệ để chạy batch backtest.');
        return;
    }
    const days = Number(document.getElementById('backtest-days').value);
    const strategyFilter = document.getElementById('backtest-strategy').value;
    const items = [];
    try {
        button.disabled = true;
        const benchmark = await getBacktestBenchmark(days);
        for (let index = 0; index < symbols.length; index += 3) {
            const batch = symbols.slice(index, index + 3);
            output.textContent = `Đang kiểm chứng ${Math.min(index + 3, symbols.length)}/${symbols.length} mã...`;
            const results = await Promise.all(batch.map(async symbol => {
                const candles = await fetchStockHistory(symbol, days);
                return candles?.length >= 100 ? { symbol, result: runWalkForwardBacktest(symbol, candles, benchmark, strategyFilter) } : null;
            }));
            items.push(...results.filter(Boolean));
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        if (!items.length) throw new Error('Không có mã nào đủ dữ liệu để backtest.');
        const summary = aggregateBatchBacktests(items);
        renderBatchBacktest(summary);
        await paperDbAction(['backtestRuns'], 'readwrite', transaction => transaction.objectStore('backtestRuns').add({ createdAt: new Date().toISOString(), days, strategyFilter, symbols, summary }));
    } catch (error) {
        output.innerHTML = `<div class="text-red-400">${error.message}</div>`;
    } finally {
        button.disabled = false;
        button.textContent = 'Chạy batch backtest';
    }
});
