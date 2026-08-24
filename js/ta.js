// --- CÁC HÀM TÍNH TOÁN CHỈ BÁO KỸ THUẬT NÂNG CAO CHUYÊN GIA (EXPERT TA ENGINE) ---
var OPPORTUNITY_THRESHOLDS = Object.freeze({ STRONG_BUY: 82, BUY: 66, NEUTRAL: 48 });
var EXIT_RISK_THRESHOLDS = Object.freeze({ STRONG_SELL: 70, SELL: 50 });

// 1. Đường trung bình động đơn giản (SMA)
function calculateSMA(data, period) {
    if (!data || data.length < period) return null;
    let sum = 0;
    for (let i = data.length - period; i < data.length; i++) {
        sum += data[i].close;
    }
    return sum / period;
}

// 2. Đường trung bình động hàm mũ (EMA)
function calculateEMA(data, period) {
    if (!data || data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data[0].close;
    for (let i = 1; i < data.length; i++) {
        ema = (data[i].close * k) + (ema * (1 - k));
    }
    return ema;
}

// 3. RSI chuẩn Wilder's Smoothing (Chuẩn xác như TradingView / SSI / VNDirect)
function calculateRSI(data, period = 14) {
    if (!data || data.length <= period) return null;
    let gains = 0, losses = 0;

    // Chu kỳ khởi tạo đầu tiên
    for (let i = 1; i <= period; i++) {
        const diff = data[i].close - data[i - 1].close;
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Wilder's Smoothing cho các nến tiếp theo
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i].close - data[i - 1].close;
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// 4. MACD & Signal chuẩn xác (Full EMA Array Calculation)
function calculateMACD(data, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
    if (!data || data.length <= longPeriod + signalPeriod) return null;
    
    const kShort = 2 / (shortPeriod + 1);
    const kLong = 2 / (longPeriod + 1);
    
    let emaShort = data[0].close;
    let emaLong = data[0].close;
    const macdLine = [];

    for (let i = 1; i < data.length; i++) {
        emaShort = (data[i].close * kShort) + (emaShort * (1 - kShort));
        emaLong = (data[i].close * kLong) + (emaLong * (1 - kLong));
        if (i >= longPeriod - 1) {
            macdLine.push(emaShort - emaLong);
        }
    }

    if (macdLine.length < signalPeriod) return null;

    // Tính Signal Line (EMA 9 của mảng MACD Line)
    const kSignal = 2 / (signalPeriod + 1);
    let signalEma = macdLine[0];
    const signalLine = [signalEma];

    for (let i = 1; i < macdLine.length; i++) {
        signalEma = (macdLine[i] * kSignal) + (signalEma * (1 - kSignal));
        signalLine.push(signalEma);
    }

    const currentMACD = macdLine[macdLine.length - 1];
    const prevMACD = macdLine[macdLine.length - 2];
    const currentSignal = signalLine[signalLine.length - 1];
    const prevSignal = signalLine[signalLine.length - 2];

    return { 
        macd: currentMACD, 
        signal: currentSignal, 
        hist: currentMACD - currentSignal,
        prevHist: prevMACD - prevSignal,
        isBullishCross: prevMACD <= prevSignal && currentMACD > currentSignal,
        isBearishCross: prevMACD >= prevSignal && currentMACD < currentSignal
    };
}

// 5. Bollinger Bands (20, 2)
function calculateBollingerBands(data, period = 20, multiplier = 2) {
    if (!data || data.length < period) return null;
    const slice = data.slice(data.length - period);
    const mean = slice.reduce((sum, d) => sum + d.close, 0) / period;
    const variance = slice.reduce((sum, d) => sum + Math.pow(d.close - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
        middle: mean,
        upper: mean + (multiplier * stdDev),
        lower: mean - (multiplier * stdDev),
        bandwidth: (2 * multiplier * stdDev) / mean
    };
}

// 6. Xu hướng Volume (Tỷ lệ % so với trung bình 20 phiên)
function getVolumeTrend(data, period = 20) {
    if (!data || data.length <= period) return 0;
    const previousVolumes = data.slice(-(period + 1), -1).map(candle => Number(candle.volume) || 0);
    const avgVol = previousVolumes.reduce((sum, volume) => sum + volume, 0) / period;
    const currentVol = data[data.length - 1].volume;
    return avgVol > 0 ? (currentVol / avgVol) * 100 : 0;
}

function calculateATR(data, period = 14) {
    if (!data || data.length <= period) return null;
    const trueRanges = [];
    for (let index = 1; index < data.length; index++) {
        const candle = data[index];
        const previousClose = data[index - 1].close;
        trueRanges.push(Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose)));
    }
    if (trueRanges.length < period) return null;
    let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    for (let index = period; index < trueRanges.length; index++) atr = ((atr * (period - 1)) + trueRanges[index]) / period;
    return atr;
}

function findCandleAtOrBefore(candles, timestamp) {
    for (let index = candles.length - 1; index >= 0; index--) {
        if (candles[index].time <= timestamp) return candles[index];
    }
    return null;
}

function buildTradePlan(candles, currentPrice, signal, strategies = []) {
    const recent = candles.slice(-20);
    const recentLow = Math.min(...recent.map(c => c.low));
    const isBottom = strategies.some(s => s.type === 'BOTTOM');
    const entryLow = currentPrice * (isBottom ? 0.985 : 0.99);
    const entryHigh = currentPrice * (isBottom ? 1.01 : 1.015);
    const structuralStop = recentLow * 0.995;
    const maxRiskStop = currentPrice * (isBottom ? 0.94 : 0.95);
    const atr = calculateATR(candles, 14);
    const volatilityStop = atr ? currentPrice - atr * (isBottom ? 1.5 : 2) : maxRiskStop;
    const stopLoss = Math.max(structuralStop, maxRiskStop, volatilityStop);
    const risk = Math.max(currentPrice - stopLoss, currentPrice * 0.01);
    const actionable = signal === 'BUY' || signal === 'STRONG_BUY';

    return {
        status: actionable ? (isBottom ? 'MUA THĂM DÒ' : 'CHỜ ĐIỂM VÀO') : 'THEO DÕI',
        entryLow,
        entryHigh,
        stopLoss,
        target1: currentPrice + risk * 1.5,
        target2: currentPrice + risk * 2.5,
        riskPercent: ((currentPrice - stopLoss) / currentPrice) * 100,
        atr,
        note: isBottom
            ? 'Bắt đáy rủi ro cao: chỉ giải ngân thăm dò khi có nến xác nhận.'
            : 'Không mua đuổi ngoài vùng vào; hủy kế hoạch nếu thủng điểm dừng lỗ.'
    };
}

function evaluateMarketRegime(candles) {
    if (!candles || candles.length < 50) {
        return { type: 'NEUTRAL', label: 'TRUNG TÍNH', adjustment: 0, confidence: 0, advice: 'Chưa đủ dữ liệu để xác định xu hướng thị trường.' };
    }
    const price = candles[candles.length - 1].close;
    const sma20 = calculateSMA(candles, 20);
    const sma50 = calculateSMA(candles, 50);
    const rsi = calculateRSI(candles, 14);
    const above20 = price > sma20;
    const alignedUp = above20 && sma20 > sma50;
    const alignedDown = price < sma20 && sma20 < sma50;

    if (alignedUp && rsi >= 50) {
        return { type: 'BULL', label: 'THUẬN XU HƯỚNG', adjustment: 7, confidence: Math.min(100, Math.round(60 + (rsi - 50) * 2)), advice: 'Có thể ưu tiên cổ phiếu mạnh và breakout, nhưng vẫn tránh mua đuổi.' };
    }
    if (alignedDown || (price < sma20 && rsi < 45)) {
        return { type: 'BEAR', label: 'RỦI RO CAO', adjustment: -8, confidence: Math.min(100, Math.round(60 + Math.max(0, 45 - rsi) * 2)), advice: 'Ưu tiên tiền mặt; nếu bắt đáy chỉ nên thăm dò và tuân thủ dừng lỗ.' };
    }
    return { type: 'NEUTRAL', label: 'ĐI NGANG / CHƯA RÕ', adjustment: 0, confidence: 55, advice: 'Chỉ chọn tín hiệu có thanh khoản xác nhận và tỷ lệ lợi nhuận/rủi ro tốt.' };
}

// 7. Nhận diện mô hình nến Price Action chuẩn VSA/Pinbar
function detectCandlePattern(lastCandle, prevCandle) {
    if (!lastCandle) return { isPinbar: false, isEngulfing: false, isStrongClose: false };
    
    const range = lastCandle.high - lastCandle.low;
    if (range === 0) return { isPinbar: false, isEngulfing: false, isStrongClose: false };

    const lowerShadow = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
    
    // Nến Rút Chân chuẩn / Bullish Pinbar: Bóng dưới dài >= 50% tổng nến & Nến xanh
    const isPinbar = (lowerShadow / range) >= 0.50 && lastCandle.close >= lastCandle.open;

    // Nến Phủ Nhập Tăng / Bullish Engulfing
    let isEngulfing = false;
    if (prevCandle) {
        isEngulfing = prevCandle.close < prevCandle.open && 
                      lastCandle.close > lastCandle.open && 
                      lastCandle.close > prevCandle.open && 
                      lastCandle.open <= prevCandle.close;
    }

    // Giá đóng cửa nằm ở vùng cao nhất của phiên (>= 65% thân nến) -> Không bị xả nến cụt đầu
    const isStrongClose = ((lastCandle.close - lastCandle.low) / range) >= 0.65;

    return { isPinbar, isEngulfing, isStrongClose };
}

// --- BỘ PHÁT HIỆN TÍN HIỆU CHIẾN LƯỢC CHUYÊN GIA TINH LỌC (EXPERT STRATEGIES) ---
function detectStrategies(candles, currentPrice, sma10, sma20, sma50, rsi, macd, volPercent, bb, vpsInfo) {
    const tags = [];
    if (!candles || candles.length < 20) return tags;

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const priceChangePct = (vpsInfo && vpsInfo.changePc !== 0) 
        ? vpsInfo.changePc 
        : (prevCandle ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100 : 0);
    const pattern = detectCandlePattern(lastCandle, prevCandle);

    // Tính giá đỉnh 20 phiên
    const slice20 = candles.slice(candles.length - 20);
    const max20High = Math.max(...slice20.map(c => c.high));

    // 1. 🎯 BẮT ĐÁY CHUẨN KỸ THUẬT (Strict Bottom Reversal)
    const isNearBBLower = bb && currentPrice <= bb.lower * 1.025;
    const isOversoldRSI = rsi && rsi <= 40;
    const hasReversalPattern = pattern.isPinbar || pattern.isEngulfing || (isNearBBLower && isBullishCandle && pattern.isStrongClose);
    const momentumImproving = macd && macd.hist > macd.prevHist;
    const recentFive = candles.slice(-5);
    const priorFive = candles.slice(-10, -5);
    const recentLow = Math.min(...recentFive.map(candle => candle.low));
    const priorLow = priorFive.length ? Math.min(...priorFive.map(candle => candle.low)) : recentLow;
    const isStabilizing = recentLow >= priorLow * 0.985 && currentPrice >= recentLow * 1.015;

    if (sma20 && currentPrice < sma20 * 1.01 && volPercent >= 70 && momentumImproving && hasReversalPattern && isStabilizing && (isOversoldRSI || (rsi && rsi < 44))) {
        let descStr = `RSI vùng giá thấp (${rsi.toFixed(1)})`;
        if (pattern.isPinbar) descStr += ' + Nến Pinbar rút chân đáy';
        else if (pattern.isEngulfing) descStr += ' + Nến Phủ Nhập Tăng';
        else if (isNearBBLower) descStr += ' + Chạm dải dưới Bollinger Bands';
        else descStr += ' + Tín hiệu đảo chiều tăng';

        tags.push({
            type: "BOTTOM",
            label: "🎯 BẮT ĐÁY",
            badgeClass: "bg-purple-500/20 text-purple-400 border border-purple-500/40",
            desc: descStr
        });
    }

    // 2. 🚀 NỔ DÒNG TIỀN (Volume Surge & Momentum Breakout)
    if (volPercent >= 125 && priceChangePct >= 1.0 && pattern.isStrongClose && macd && macd.macd > macd.signal) {
        tags.push({
            type: "MONEY_FLOW",
            label: "🚀 NỔ DÒNG TIỀN",
            badgeClass: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
            desc: `Volume nổ ${volPercent.toFixed(0)}% TB20 + Tăng giá +${priceChangePct.toFixed(1)}%`
        });
    }

    // 3. 👑 CỔ MẠNH DẪN DẮT (Market Leader / Outperformer)
    const isMAAlignment = sma20 && sma50 && currentPrice > sma20 && sma20 > sma50;
    const isNear20DayHigh = currentPrice >= max20High * 0.95;

    if (isMAAlignment && isNear20DayHigh && macd && macd.macd > macd.signal && rsi >= 52 && rsi <= 74) {
        tags.push({
            type: "LEADER",
            label: "👑 CỔ MẠNH DẪN DẮT",
            badgeClass: "bg-amber-500/20 text-amber-400 border border-amber-500/40",
            desc: "Đang ở vùng Đỉnh 20 phiên + Kênh tăng vững chắc (Giá > MA20 > MA50)"
        });
    }

    // 4. 💥 BỨT PHÁ NỀN BOLLINGER (Bollinger Upper Breakout)
    if (bb && prevCandle && currentPrice > prevCandle.high && currentPrice >= bb.upper * 0.998 && priceChangePct >= 1.0 && volPercent >= 120 && pattern.isStrongClose) {
        tags.push({
            type: "BB_BREAKOUT",
            label: "💥 VỠ DẢI TRÊN",
            badgeClass: "bg-blue-500/20 text-blue-400 border border-blue-500/40",
            desc: `Vượt dải trên Bollinger Bands +${priceChangePct.toFixed(1)}% với Volume ${volPercent.toFixed(0)}%`
        });
    }

    return tags;
}

// --- THUẬT TOÁN CHẤM ĐIỂM CHUYÊN GIA ĐA TIÊU CHÍ CHUẨN XÁC (STRICT EXPERT SCORING) ---
function evaluateStock(symbol, candles, vpsInfo = null, marketRegime = null, benchmarkCandles = null) {
    if (!candles || candles.length < 20) return null;

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const currentPrice = lastCandle.close;
    
    // Tính các chỉ báo kỹ thuật chuẩn xác
    const sma10 = calculateSMA(candles, 10);
    const sma20 = calculateSMA(candles, 20);
    const sma50 = calculateSMA(candles, 50);
    const rsi = calculateRSI(candles, 14);
    const macd = calculateMACD(candles);
    const bb = calculateBollingerBands(candles, 20, 2);
    const volPercent = getVolumeTrend(candles, 20);

    // Phát hiện chiến lược
    const strategies = detectStrategies(candles, currentPrice, sma10, sma20, sma50, rsi, macd, volPercent, bb, vpsInfo);

    let score = 0;
    const reasons = [];

    // Mỗi nhóm có trần riêng để tránh cộng trùng cùng một hiện tượng.
    // ── 1. XU HƯỚNG (Tối đa 25 điểm) ──
    if (sma10 && currentPrice > sma10) score += 8;
    if (sma20 && currentPrice > sma20) {
        score += 8;
        reasons.push("Giá giữ vững trên MA20");
    } else {
        reasons.push("Giá nằm dưới MA20");
    }
    if (sma50 && currentPrice > sma50) {
        score += 9;
        reasons.push("Nằm trong xu hướng tăng trung hạn (Trên MA50)");
    }

    // ── 2. ĐỘNG LƯỢNG (Tối đa 20 điểm) ──
    if (rsi) {
        if (rsi >= 54 && rsi <= 68) {
            score += 8;
            reasons.push(`RSI vào vùng đà tăng đẹp (${rsi.toFixed(1)})`);
        } else if (rsi > 42 && rsi < 54) {
            score += 5;
            reasons.push(`RSI mức trung tính (${rsi.toFixed(1)})`);
        } else if (rsi <= 42) {
            score += 3;
            reasons.push(`RSI vùng thấp quá bán (${rsi.toFixed(1)})`);
        } else if (rsi > 68) {
            reasons.push(`RSI quá mua (${rsi.toFixed(1)}) - Thận trọng rung lắc`);
        }
    }

    if (macd && macd.macd > macd.signal) {
        score += 12;
        if (macd.isBullishCross) reasons.push("MACD vừa CẮT LÊN Signal (Xác nhận Mua)");
        else reasons.push("MACD duy trì xu hướng tăng trên Signal");
    }

    // ── 3. THANH KHOẢN (Tối đa 20 điểm) ──
    if (volPercent >= 150) {
        score += 20;
        reasons.push(`Thanh khoản nổ đột biến (${volPercent.toFixed(0)}% TB20)`);
    } else if (volPercent >= 110) {
        score += 14;
        reasons.push(`Thanh khoản gia tăng tốt (${volPercent.toFixed(0)}% TB20)`);
    } else if (volPercent >= 80) {
        score += 8;
        reasons.push("Thanh khoản mức bình thường");
    } else {
        reasons.push("Thanh khoản sụt giảm so với trung bình");
    }

    // Dữ liệu Realtime Mua Ròng Khối Ngoại từ VPS
    if (vpsInfo && vpsInfo.foreignNet > 50000) {
        score += 5;
        reasons.unshift(`🌐 Khối ngoại gom Mua Ròng mạnh ${(vpsInfo.foreignNet / 1000).toFixed(0)}k lô trong phiên`);
    }

    // ── 4. XÁC NHẬN THIẾT LẬP (chỉ lấy mức cao nhất, tối đa 10 điểm) ──
    let setupBonus = 0;
    if (strategies.some(s => s.type === "MONEY_FLOW")) {
        setupBonus = Math.max(setupBonus, 8);
        reasons.unshift("🚀 Giá và thanh khoản cùng tăng mạnh so với trung bình");
    }
    if (strategies.some(s => s.type === "LEADER")) {
        setupBonus = Math.max(setupBonus, 10);
        reasons.unshift("👑 Cổ phiếu dẫn dắt đỉnh 20 phiên với trend hoàn hảo");
    }
    if (strategies.some(s => s.type === "BOTTOM")) {
        setupBonus = Math.max(setupBonus, 7);
        reasons.unshift("🎯 Tín hiệu nẩy giá đảo chiều chuẩn từ vùng đáy");
    }
    if (strategies.some(s => s.type === "BB_BREAKOUT")) {
        setupBonus = Math.max(setupBonus, 6);
        reasons.unshift("💥 Vỡ dải trên Bollinger Bands gia tăng đà bứt phá");
    }
    score += setupBonus;

    const isOverextended = Boolean(sma20 && currentPrice > sma20 * 1.12);
    const isThinVolume = volPercent > 0 && volPercent < 60;
    if (isOverextended) {
        score -= 10;
        reasons.unshift('⚠️ Giá đã cách MA20 trên 12%: rủi ro mua đuổi cao');
    }
    if (isThinVolume) {
        score -= 5;
        reasons.push('Thanh khoản dưới 60% trung bình: tín hiệu kém tin cậy');
    }

    let relativeStrength20 = null;
    if (benchmarkCandles?.length >= 21 && candles.length >= 21) {
        const stockStartCandle = candles[candles.length - 21];
        const stockEndCandle = candles[candles.length - 1];
        const benchmarkStartCandle = findCandleAtOrBefore(benchmarkCandles, stockStartCandle.time);
        const benchmarkEndCandle = findCandleAtOrBefore(benchmarkCandles, stockEndCandle.time);
        const stockStart = stockStartCandle.close;
        const benchmarkStart = benchmarkStartCandle?.close;
        const stockReturn = (currentPrice - stockStart) / stockStart * 100;
        const benchmarkReturn = benchmarkStart > 0 && benchmarkEndCandle
            ? (benchmarkEndCandle.close - benchmarkStart) / benchmarkStart * 100
            : null;
        relativeStrength20 = benchmarkReturn == null ? null : stockReturn - benchmarkReturn;
        if (relativeStrength20 == null) {
            reasons.push('Chưa căn chỉnh được dữ liệu VN-Index cùng kỳ');
        } else if (relativeStrength20 >= 5) {
            score += 8;
            reasons.unshift(`🏆 Vượt VN-Index ${relativeStrength20.toFixed(1)}% trong 20 phiên`);
        } else if (relativeStrength20 > 0) {
            score += 4;
            reasons.push(`Sức mạnh tương đối tốt hơn VN-Index ${relativeStrength20.toFixed(1)}%`);
        } else if (relativeStrength20 <= -5) {
            score -= 6;
            reasons.push(`Yếu hơn VN-Index ${Math.abs(relativeStrength20).toFixed(1)}% trong 20 phiên`);
        }
    }

    const hasMomentumSetup = strategies.some(strategy => strategy.type === 'MONEY_FLOW' || strategy.type === 'BB_BREAKOUT');
    const momentumTrendConfirmed = Boolean(sma20 && sma50 && currentPrice > sma20 && sma20 > sma50 && relativeStrength20 != null && relativeStrength20 > 0);
    if (hasMomentumSetup && !momentumTrendConfirmed) {
        score -= 12;
        reasons.unshift('⚠️ Breakout chưa được xu hướng trung hạn và sức mạnh tương đối xác nhận');
    }

    if (marketRegime) {
        const isBottomSetup = strategies.some(s => s.type === 'BOTTOM');
        const adjustment = marketRegime.type === 'BEAR' && isBottomSetup
            ? Math.max(-4, marketRegime.adjustment)
            : marketRegime.adjustment;
        score += adjustment;
        if (adjustment > 0) reasons.unshift(`📈 Thị trường thuận xu hướng: +${adjustment} điểm`);
        if (adjustment < 0) reasons.unshift(`🛡️ Thị trường rủi ro: ${adjustment} điểm`);
    }

    // Điểm rủi ro thoát vị thế độc lập với điểm cơ hội mua.
    // Điểm cơ hội thấp không đồng nghĩa với tín hiệu bán.
    const previousSma20 = candles.length > 20 ? calculateSMA(candles.slice(0, -1), 20) : null;
    const belowSma20 = Boolean(sma20 && currentPrice < sma20);
    const belowSma50 = Boolean(sma50 && currentPrice < sma50);
    const sma20Falling = Boolean(sma20 && previousSma20 && sma20 < previousSma20);
    const bearishMacd = Boolean(macd && macd.macd < macd.signal && macd.hist < macd.prevHist);
    const weakRelativeStrength = relativeStrength20 != null && relativeStrength20 <= -3;
    const distributionDay = Boolean(prevCandle && currentPrice < prevCandle.close && volPercent >= 110);
    const exitReasons = [];
    let exitRiskScore = 0;
    if (belowSma20) { exitRiskScore += 20; exitReasons.push('Giá dưới MA20'); }
    if (belowSma50) { exitRiskScore += 20; exitReasons.push('Giá dưới MA50'); }
    if (sma20Falling) { exitRiskScore += 15; exitReasons.push('MA20 đang dốc xuống'); }
    if (bearishMacd) { exitRiskScore += 15; exitReasons.push('MACD suy yếu'); }
    if (weakRelativeStrength) { exitRiskScore += 15; exitReasons.push('Yếu hơn VN-Index'); }
    if (distributionDay) { exitRiskScore += 15; exitReasons.push('Phiên giảm kèm thanh khoản cao'); }
    if (marketRegime?.type === 'BEAR') exitRiskScore += 5;
    exitRiskScore = Math.min(100, exitRiskScore);

    // Chuẩn hóa điểm 0 - 100
    score = Math.min(100, Math.max(0, Math.round(score)));

    // Phân loại Khuyến Nghị chuẩn mực (Strict Signal Thresholds)
    let signal = "HOLD";
    let signalText = "GIỮ";
    let signalClass = "bg-signal-hold";

    const hasLeaderSetup = strategies.some(strategy => strategy.type === 'LEADER');
    const hasBottomSetup = strategies.some(strategy => strategy.type === 'BOTTOM');
    const breakoutQualityConfirmed = hasMomentumSetup
        && momentumTrendConfirmed
        && relativeStrength20 >= 3
        && volPercent >= 120
        && volPercent <= 220;
    const leaderQualityConfirmed = hasLeaderSetup
        && momentumTrendConfirmed
        && relativeStrength20 >= 3
        && volPercent >= 80;
    const marketSupportsStrongBuy = !marketRegime || marketRegime.type === 'BULL';
    const strongBuyQuality = marketSupportsStrongBuy && (leaderQualityConfirmed || hasBottomSetup || breakoutQualityConfirmed);

    if (exitRiskScore >= EXIT_RISK_THRESHOLDS.STRONG_SELL && belowSma20 && belowSma50) {
        signal = "STRONG_SELL"; signalText = "BÁN MẠNH"; signalClass = "bg-signal-sell";
    } else if (exitRiskScore >= EXIT_RISK_THRESHOLDS.SELL && belowSma20) {
        signal = "SELL"; signalText = "CÂN NHẮC BÁN"; signalClass = "bg-signal-sell";
    } else if (score >= OPPORTUNITY_THRESHOLDS.STRONG_BUY && strongBuyQuality && !isOverextended) {
        signal = "STRONG_BUY"; signalText = "CƠ HỘI MẠNH"; signalClass = "bg-signal-buy";
    } else if (marketRegime?.type === 'BEAR' && score >= OPPORTUNITY_THRESHOLDS.BUY && strategies.length > 0) {
        signal = hasBottomSetup ? "BUY" : "HOLD";
        signalText = hasBottomSetup ? "MUA THĂM DÒ" : "CHỜ THỊ TRƯỜNG";
        signalClass = hasBottomSetup ? "bg-signal-buy" : "bg-signal-hold";
    } else if (score >= OPPORTUNITY_THRESHOLDS.BUY && strategies.length > 0 && !isOverextended) {
        signal = "BUY"; signalText = "THEO DÕI MUA"; signalClass = "bg-signal-buy";
    } else if (score >= OPPORTUNITY_THRESHOLDS.BUY && strategies.length === 0) {
        signal = "HOLD"; signalText = "THEO DÕI"; signalClass = "bg-signal-hold";
    } else if (isOverextended && score >= OPPORTUNITY_THRESHOLDS.BUY) {
        signal = "HOLD"; signalText = "CHỜ ĐIỂM VÀO"; signalClass = "bg-signal-hold";
    } else if (score < OPPORTUNITY_THRESHOLDS.NEUTRAL) {
        signal = "HOLD"; signalText = "CHƯA HẤP DẪN"; signalClass = "bg-signal-hold";
    } else {
        signal = "HOLD"; signalText = "TRUNG TÍNH"; signalClass = "bg-signal-hold";
    }

    return {
        symbol,
        price: currentPrice,
        score,
        signal,
        signalText,
        signalClass,
        reasons,
        strategies,
        tradePlan: buildTradePlan(candles, currentPrice, signal, strategies),
        marketRegime: marketRegime?.type || 'NEUTRAL',
        exitRisk: { score: exitRiskScore, reasons: exitReasons },
        riskFlags: { isOverextended, isThinVolume, unconfirmedMomentum: hasMomentumSetup && !momentumTrendConfirmed, marketBlocked: marketRegime?.type === 'BEAR' && !hasBottomSetup },
        indicators: {
            sma10, sma20, sma50, rsi, macd, bb, volPercent, relativeStrength20
        }
    };
}
