// --- CÁC HÀM TÍNH TOÁN CHỈ BÁO KỸ THUẬT NÂNG CAO CHUYÊN GIA (EXPERT TA ENGINE) ---

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
    if (!data || data.length < period) return 0;
    let sum = 0;
    for (let i = data.length - period; i < data.length; i++) {
        sum += data[i].volume;
    }
    const avgVol = sum / period;
    const currentVol = data[data.length - 1].volume;
    return avgVol > 0 ? (currentVol / avgVol) * 100 : 0;
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

// --- BỘ PHÁT HIỆN TÍN HIỆU CHIẾN LƯỢC CHUYÊN GIA TINH LỌC (STRICT EXPERT STRATEGIES) ---
function detectStrategies(candles, currentPrice, sma10, sma20, sma50, rsi, macd, volPercent, bb, vpsInfo) {
    const tags = [];
    if (!candles || candles.length < 20) return tags;

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const priceChangePct = prevCandle ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100 : 0;
    const pattern = detectCandlePattern(lastCandle, prevCandle);

    // Tính giá đỉnh 20 phiên
    const slice20 = candles.slice(candles.length - 20);
    const max20High = Math.max(...slice20.map(c => c.high));

    // 1. 🎯 BẮT ĐÁY CHUẨN KỸ THUẬT (Strict Bottom Reversal)
    // ĐIỀU KIỆN NGHIÊM NGẶT:
    // - RSI nằm ở vùng quá bán (RSI < 38) HOẶC (RSI < 42 VÀ có nến rút chân Pinbar / Phủ nhập Engulfing / Chạm dải dưới Bollinger)
    // - Giá nằm dưới MA20 (đang ở sóng chỉnh/đáy)
    // - LOẠI BỎ các mã nến xanh yếu ớt thông thường!
    const isNearBBLower = bb && currentPrice <= bb.lower * 1.02;
    const isOversoldRSI = rsi && rsi <= 38;
    const hasReversalPattern = pattern.isPinbar || pattern.isEngulfing || isNearBBLower;

    if (sma20 && currentPrice < sma20 && (isOversoldRSI || (rsi && rsi < 42 && hasReversalPattern))) {
        let descStr = `RSI vùng đáy (${rsi.toFixed(1)})`;
        if (pattern.isPinbar) descStr += ' + Nến Pinbar rút chân đáy';
        else if (pattern.isEngulfing) descStr += ' + Nến Phủ Nhập Tăng';
        else if (isNearBBLower) descStr += ' + Chạm dải dưới Bollinger Bands';
        else descStr += ' + Tín hiệu đảo chiều';

        tags.push({
            type: "BOTTOM",
            label: "🎯 BẮT ĐÁY",
            badgeClass: "bg-purple-500/20 text-purple-400 border border-purple-500/40",
            desc: descStr
        });
    }

    // 2. 🚀 NỔ DÒNG TIỀN (Strict Volume Surge & Momentum Breakout)
    // ĐIỀU KIỆN NGHIÊM NGẶT:
    // - Volume NỔ VỌT: Vol % >= 150% (gấp 1.5 lần trung bình 20 phiên)
    // - Giá TĂNG MẠNH: Tăng >= 2.0%
    // - Nến đóng ở vùng cao trong phiên (Strong Close, không bị cụt đầu)
    // - MACD Histogram đang mở rộng tăng (macd.hist > macd.prevHist)
    if (volPercent >= 150 && priceChangePct >= 2.0 && pattern.isStrongClose && macd && macd.hist > 0) {
        tags.push({
            type: "MONEY_FLOW",
            label: "🚀 NỔ DÒNG TIỀN",
            badgeClass: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
            desc: `Volume nổ ${volPercent.toFixed(0)}% TB20 + Tăng đứt dứt +${priceChangePct.toFixed(1)}%`
        });
    }

    // 3. 👑 CỔ MẠNH DẪN DẮT (Strict Market Leader / Outperformer)
    // ĐIỀU KIỆN NGHIÊM NGẶT:
    // - Xếp hàng kênh tăng chuẩn: Giá > MA10 > MA20 > MA50
    // - Đang ở vùng ĐỈNH 20 PHIÊN (Price >= 97% Đỉnh 20 phiên) -> Thể hiện sức mạnh dẫn dắt toàn thị trường
    // - RSI nằm ở vùng mua mạnh (56 <= RSI <= 72)
    // - MACD nằm trên Signal
    const isMAAlignment = sma10 && sma20 && sma50 && currentPrice > sma10 && sma10 > sma20 && sma20 > sma50;
    const isNear20DayHigh = currentPrice >= max20High * 0.97;

    if (isMAAlignment && isNear20DayHigh && macd && macd.macd > macd.signal && rsi >= 56 && rsi <= 72) {
        tags.push({
            type: "LEADER",
            label: "👑 CỔ MẠNH DẪN DẮT",
            badgeClass: "bg-amber-500/20 text-amber-400 border border-amber-500/40",
            desc: "Đang ở vùng Đỉnh 20 phiên + Trend xếp hàng hoàn hảo (Giá > MA10 > MA20 > MA50)"
        });
    }

    // 4. 💥 BỨT PHÁ NỀN BOLLINGER (Strict Bollinger Upper Breakout)
    // ĐIỀU KIỆN NGHIÊM NGẶT:
    // - Giá đóng cửa vượt hẳn trên dải Upper Bollinger Bands (>= +0.4%)
    // - Volume lớn >= 140% TB20 + Giá tăng >= 1.5%
    if (bb && currentPrice >= bb.upper * 1.004 && priceChangePct >= 1.5 && volPercent >= 140) {
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
function evaluateStock(symbol, candles, vpsInfo = null) {
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

    // ── 1. ĐIỂM XU HƯỚNG / TREND SCORE (Tối đa 30 điểm) ──
    if (sma10 && currentPrice > sma10) score += 10;
    if (sma20 && currentPrice > sma20) {
        score += 10;
        reasons.push("Giá giữ vững trên MA20");
    } else {
        reasons.push("Giá nằm dưới MA20");
    }
    if (sma50 && currentPrice > sma50) {
        score += 10;
        reasons.push("Nằm trong xu hướng tăng trung hạn (Trên MA50)");
    }

    // ── 2. ĐIỂM ĐỘNG LƯỢNG & MACD / MOMENTUM SCORE (Tối đa 25 điểm) ──
    if (rsi) {
        if (rsi >= 54 && rsi <= 68) {
            score += 13;
            reasons.push(`RSI vào vùng đà tăng đẹp (${rsi.toFixed(1)})`);
        } else if (rsi > 42 && rsi < 54) {
            score += 8;
            reasons.push(`RSI mức trung tính (${rsi.toFixed(1)})`);
        } else if (rsi <= 42) {
            score += 5;
            reasons.push(`RSI vùng thấp quá bán (${rsi.toFixed(1)})`);
        } else if (rsi > 70) {
            reasons.push(`RSI quá mua (${rsi.toFixed(1)}) - Thận trọng rung lắc`);
        }
    }

    if (macd && macd.macd > macd.signal) {
        score += 12;
        if (macd.isBullishCross) reasons.push("MACD vừa CẮT LÊN Signal (Xác nhận Mua)");
        else reasons.push("MACD duy trì xu hướng tăng trên Signal");
    }

    // ── 3. ĐIỂM THANH KHOẢN & DÒNG TIỀN / VOLUME & MONEY FLOW (Tối đa 25 điểm) ──
    if (volPercent >= 150) {
        score += 25;
        reasons.push(`Thanh khoản nổ đột biến (${volPercent.toFixed(0)}% TB20)`);
    } else if (volPercent >= 110) {
        score += 18;
        reasons.push(`Thanh khoản gia tăng tốt (${volPercent.toFixed(0)}% TB20)`);
    } else if (volPercent >= 80) {
        score += 10;
        reasons.push("Thanh khoản mức bình thường");
    } else {
        reasons.push("Thanh khoản sụt giảm so với trung bình");
    }

    // Dữ liệu Realtime Mua Ròng Khối Ngoại từ VPS
    if (vpsInfo && vpsInfo.foreignNet > 50000) {
        score += 5;
        reasons.unshift(`🌐 Khối ngoại gom Mua Ròng mạnh ${(vpsInfo.foreignNet / 1000).toFixed(0)}k lô trong phiên`);
    }

    // ── 4. ĐIỂM CHIẾN LƯỢC & PRICE ACTION / STRATEGY BONUS (Tối đa 20 điểm) ──
    if (strategies.some(s => s.type === "MONEY_FLOW")) {
        score += 10;
        reasons.unshift("🚀 Dòng tiền cá mập/tổ chức nổ khối lượng kéo giá");
    }
    if (strategies.some(s => s.type === "LEADER")) {
        score += 10;
        reasons.unshift("👑 Cổ phiếu dẫn dắt đỉnh 20 phiên với trend hoàn hảo");
    }
    if (strategies.some(s => s.type === "BOTTOM")) {
        score += 8;
        reasons.unshift("🎯 Tín hiệu nẩy giá đảo chiều chuẩn từ vùng đáy");
    }
    if (strategies.some(s => s.type === "BB_BREAKOUT")) {
        score += 5;
        reasons.unshift("💥 Vỡ dải trên Bollinger Bands gia tăng đà bứt phá");
    }

    // Chuẩn hóa điểm 0 - 100
    score = Math.min(100, Math.max(0, Math.round(score)));

    // Phân loại Khuyến Nghị chuẩn mực (Strict Signal Thresholds)
    let signal = "HOLD";
    let signalText = "GIỮ";
    let signalClass = "bg-signal-hold";

    if (score >= 82) {
        signal = "STRONG_BUY"; signalText = "MUA MẠNH"; signalClass = "bg-signal-buy";
    } else if (score >= 66) {
        signal = "BUY"; signalText = "MUA"; signalClass = "bg-signal-buy";
    } else if (score <= 32) {
        signal = "STRONG_SELL"; signalText = "BÁN MẠNH"; signalClass = "bg-signal-sell";
    } else if (score < 48) {
        signal = "SELL"; signalText = "BÁN"; signalClass = "bg-signal-sell";
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
        indicators: {
            sma10, sma20, sma50, rsi, macd, bb, volPercent
        }
    };
}
