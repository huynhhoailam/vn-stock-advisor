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

const atrCandles = Array.from({ length: 40 }, (_, index) => ({
    ...candle(index + 1, 100 + index * 0.15, 1000),
    high: 102 + index * 0.15,
    low: 98 + index * 0.15
}));
const atr = calculateATR(atrCandles, 14);
const atrPlan = buildTradePlan(atrCandles, atrCandles.at(-1).close, 'BUY', [{ type: 'LEADER' }]);
assert(Number.isFinite(atr) && atr > 0, 'ATR phải phản ánh độ biến động dương.');
assert(atrPlan.stopLoss >= atrCandles.at(-1).close - atr * 2 - 1e-9, 'Dừng lỗ không được rộng hơn giới hạn 2 ATR.');

const originalDetectStrategies = detectStrategies;
const originalRSI = calculateRSI;
const originalMACD = calculateMACD;
const originalVolumeTrend = getVolumeTrend;
detectStrategies = () => [{ type: 'LEADER' }, { type: 'MONEY_FLOW' }, { type: 'BB_BREAKOUT' }];
calculateRSI = () => 60;
calculateMACD = () => ({ macd: 2, signal: 1, hist: 1, prevHist: 0.5, isBullishCross: false });
getVolumeTrend = () => 160;
const strongCandles = Array.from({ length: 80 }, (_, index) => candle(index + 1, 100 + index, 1000));
const flatBenchmark = Array.from({ length: 80 }, (_, index) => candle(index + 1, 100, 1000));
const bearBlocked = evaluateStock('TEST', strongCandles, null, { type: 'BEAR', adjustment: -8 }, flatBenchmark);
assert(bearBlocked.signal !== 'STRONG_BUY' && bearBlocked.signal !== 'BUY', 'Thị trường BEAR phải chặn tín hiệu mua theo xu hướng/breakout.');
assert(bearBlocked.riskFlags.marketBlocked === true, 'Tín hiệu bị thị trường chặn phải có cờ rủi ro.');
detectStrategies = originalDetectStrategies;
calculateRSI = originalRSI;
calculateMACD = originalMACD;
getVolumeTrend = originalVolumeTrend;

const flatCandles = Array.from({ length: 80 }, (_, index) => candle(index + 1, 100, 1000));
const unattractive = evaluateStock('FLAT', flatCandles, null, { type: 'NEUTRAL', adjustment: 0 }, flatBenchmark);
assert(unattractive.score < 48, 'Mẫu đi ngang phải có điểm cơ hội thấp.');
assert(unattractive.signal !== 'SELL' && unattractive.signal !== 'STRONG_SELL', 'Điểm cơ hội thấp không được tự động biến thành tín hiệu bán.');

const fallingCandles = Array.from({ length: 80 }, (_, index) => {
    const close = 180 - index;
    return { ...candle(index + 1, close, index === 79 ? 1600 : 1000), open: close + 0.5, high: close + 1, low: close - 1 };
});
const confirmedExit = evaluateStock('WEAK', fallingCandles, null, { type: 'BEAR', adjustment: -8 }, flatBenchmark);
assert(confirmedExit.exitRisk.score >= 70, 'Xu hướng giảm có nhiều xác nhận phải tạo rủi ro thoát vị thế cao.');
assert(confirmedExit.signal === 'STRONG_SELL', 'Chỉ tín hiệu suy yếu được xác nhận mới được gắn BÁN MẠNH.');
console.log('Algorithm tests passed.');
