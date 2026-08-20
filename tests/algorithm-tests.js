const fs = require('fs');
const path = require('path');

global.document = { getElementById: () => null };

const projectRoot = path.resolve(__dirname, '..');
eval(fs.readFileSync(path.join(projectRoot, 'js', 'ta.js'), 'utf8'));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function candle(day, close, volume = 100) {
    return {
        time: Date.UTC(2025, 0, day),
        open: close,
        high: close * 1.01,
        low: close * 0.99,
        close,
        volume
    };
}

const volumeCandles = Array.from({ length: 20 }, (_, index) => candle(index + 1, 10, 100));
volumeCandles.push(candle(21, 10, 200));
assert(Math.abs(getVolumeTrend(volumeCandles, 20) - 200) < 1e-9, 'Volume phải so với 20 phiên trước, không gồm phiên hiện tại.');

const benchmark = Array.from({ length: 30 }, (_, index) => candle(index + 1, 100 + index));
const missingSessionStock = Array.from({ length: 30 }, (_, index) => candle(index + 1 + (index >= 10 ? 1 : 0), 50 + index));
const aligned = findCandleAtOrBefore(benchmark, missingSessionStock[10].time);
assert(aligned && aligned.time <= missingSessionStock[10].time, 'Benchmark phải căn chỉnh theo timestamp.');

const PAPER_FEE_RATE = 0.0015;
const PAPER_SELL_TAX_RATE = 0.001;
const PAPER_SLIPPAGE_RATE = 0.0005;
eval(fs.readFileSync(path.join(projectRoot, 'js', 'backtest.js'), 'utf8'));

const originalEvaluateStock = evaluateStock;
evaluateStock = (_symbol, knownData) => {
    const price = knownData[knownData.length - 1].close;
    return {
        signal: 'STRONG_BUY',
        score: 90,
        strategies: [{ type: 'LEADER' }],
        tradePlan: {
            entryLow: price * 0.99,
            entryHigh: price * 1.02,
            stopLoss: price * 0.95,
            target1: price * 1.08
        }
    };
};

const risingCandles = Array.from({ length: 100 }, (_, index) => {
    const close = 100 + index * 0.4;
    return { ...candle(index + 1, close, 1000), open: close * 1.001, high: close * 1.02, low: close * 0.995 };
});
const backtestResult = runWalkForwardBacktest('TEST', risingCandles, benchmark, 'TREND');
assert(backtestResult.trades.length > 0, 'Backtest phải tạo được giao dịch thử.');
assert(backtestResult.trades.every(trade => trade.positionWeightPct <= 25.000001), 'Tỷ trọng mỗi lệnh không được vượt 25%.');
assert(backtestResult.trades.every(trade => Number.isFinite(trade.portfolioReturnPct)), 'Lợi nhuận đóng góp danh mục phải hợp lệ.');
assert(backtestResult.maxDrawdown >= 0, 'Drawdown không được âm.');

evaluateStock = originalEvaluateStock;
console.log('Algorithm tests passed.');
