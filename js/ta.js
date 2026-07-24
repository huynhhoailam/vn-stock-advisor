// --- CÁC HÀM TÍNH TOÁN CHỈ BÁO KỸ THUẬT (TA) ---

function calculateSMA(data, period) {
    if (data.length < period) return null;
    let sum = 0;
    for (let i = data.length - period; i < data.length; i++) {
        sum += data[i].close;
    }
    return sum / period;
}

function calculateEMA(data, period) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data[0].close; // Simple initialization
    for (let i = 1; i < data.length; i++) {
        ema = (data[i].close * k) + (ema * (1 - k));
    }
    return ema;
}

function calculateRSI(data, period = 14) {
    if (data.length <= period) return null;
    let gains = 0, losses = 0;

    for (let i = data.length - period; i < data.length; i++) {
        let diff = data[i].close - data[i - 1].close;
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(data, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
    if (data.length <= longPeriod + signalPeriod) return null;
    
    // Tính EMA 12 và 26 cho từng điểm
    let macdLine = [];
    const kShort = 2 / (shortPeriod + 1);
    const kLong = 2 / (longPeriod + 1);
    
    let emaShort = data[0].close;
    let emaLong = data[0].close;

    for (let i = 1; i < data.length; i++) {
        emaShort = (data[i].close * kShort) + (emaShort * (1 - kShort));
        emaLong = (data[i].close * kLong) + (emaLong * (1 - kLong));
        macdLine.push(emaShort - emaLong);
    }

    // Tính Signal (EMA 9 của MACD line)
    const kSignal = 2 / (signalPeriod + 1);
    let signalLine = macdLine[0];
    
    for (let i = 1; i < macdLine.length; i++) {
        signalLine = (macdLine[i] * kSignal) + (signalLine * (1 - kSignal));
    }

    const currentMACD = macdLine[macdLine.length - 1];
    const prevMACD = macdLine[macdLine.length - 2];
    const currentSignal = signalLine;
    const prevSignal = (macdLine[macdLine.length - 2] * kSignal) + (signalLine * (1 - kSignal)); // Approximation for previous signal

    return { 
        macd: currentMACD, 
        signal: currentSignal, 
        hist: currentMACD - currentSignal,
        isBullishCross: prevMACD <= prevSignal && currentMACD > currentSignal,
        isBearishCross: prevMACD >= prevSignal && currentMACD < currentSignal
    };
}

function getVolumeTrend(data, period = 20) {
    if (data.length < period) return 0;
    let sum = 0;
    for (let i = data.length - period; i < data.length; i++) {
        sum += data[i].volume;
    }
    const avgVol = sum / period;
    const currentVol = data[data.length - 1].volume;
    return (currentVol / avgVol) * 100; // Tỷ lệ % so với trung bình
}

// --- BỘ PHÁT HIỆN TÍN HIỆU CHIẾN LƯỢC ĐẶC BIỆT ---
function detectStrategies(candles, currentPrice, sma20, sma50, rsi, macd, volPercent) {
    const tags = [];
    if (candles.length < 2) return tags;

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const priceChangePct = prevCandle ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100 : 0;

    // 1. Tín hiệu: 🎯 BẮT ĐÁY (Bottom Reversal / Oversold Bounce)
    // Điều kiện: RSI quá bán (< 40) hoặc đảo chiều nến xanh từ vùng đáy
    if (rsi && rsi < 42 && isBullishCandle) {
        tags.push({
            type: "BOTTOM",
            label: "🎯 BẮT ĐÁY",
            badgeClass: "bg-purple-500/20 text-purple-400 border border-purple-500/40",
            desc: `RSI thấp (${rsi.toFixed(1)}) + Nến đảo chiều tăng từ đáy`
        });
    }

    // 2. Tín hiệu: 🚀 DÒNG TIỀN ĐỘT BIẾN (Volume Surge & Momentum Breakout)
    // Điều kiện: Vol > 135% so với trung bình 20 phiên + Giá tăng mạnh (> 1.2%)
    if (volPercent >= 135 && priceChangePct > 1.2) {
        tags.push({
            type: "MONEY_FLOW",
            label: "🚀 NỔ DÒNG TIỀN",
            badgeClass: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
            desc: `Volume nổ ${volPercent.toFixed(0)}% TB20 + Tăng giá ${priceChangePct.toFixed(1)}%`
        });
    }

    // 3. Tín hiệu: 👑 CỔ XU HƯỚNG MẠNH (Leader / Strong Uptrend)
    // Điều kiện: Price > MA20 > MA50 + MACD > Signal + RSI > 52
    if (sma20 && sma50 && currentPrice > sma20 && sma20 > sma50 && macd && macd.macd > macd.signal && rsi > 52) {
        tags.push({
            type: "LEADER",
            label: "👑 CỔ MẠNH DẪN DẮT",
            badgeClass: "bg-amber-500/20 text-amber-400 border border-amber-500/40",
            desc: "Uptrend hoàn hảo: Giá > MA20 > MA50 & MACD tăng mở rộng"
        });
    }

    return tags;
}

// --- THUẬT TOÁN CHẤM ĐIỂM CHUYÊN GIA ---
// Trả về điểm 0-100, Tín hiệu và các Chiến lược áp dụng
function evaluateStock(symbol, candles) {
    if (!candles || candles.length < 20) return null;

    const currentPrice = candles[candles.length - 1].close;
    
    // Tính các chỉ báo
    const sma20 = calculateSMA(candles, 20);
    const sma50 = calculateSMA(candles, 50);
    const rsi = calculateRSI(candles, 14);
    const macd = calculateMACD(candles);
    const volPercent = getVolumeTrend(candles, 20);

    // Phát hiện chiến lược đặc biệt
    const strategies = detectStrategies(candles, currentPrice, sma20, sma50, rsi, macd, volPercent);

    let score = 0;
    let reasons = [];

    // 1. Trend Score (Max 30)
    if (sma20 && currentPrice > sma20) { score += 15; reasons.push("Giá nằm trên MA20"); }
    else { reasons.push("Giá nằm dưới MA20"); }
    
    if (sma50 && currentPrice > sma50) { score += 15; reasons.push("Giá nằm trên MA50 (Xu hướng tăng)"); }

    // 2. Momentum Score (Max 30)
    if (rsi) {
        if (rsi > 40 && rsi < 70) { score += 15; reasons.push(`RSI đẹp (${rsi.toFixed(1)})`); }
        else if (rsi <= 40) { score += 5; reasons.push(`RSI thấp (${rsi.toFixed(1)}) - Vùng quá bán`); }
        else { reasons.push(`RSI cao (${rsi.toFixed(1)}) - Vùng quá mua`); }
    }

    if (macd && macd.macd > macd.signal) { 
        score += 15; 
        if (macd.isBullishCross) reasons.push("MACD vừa cắt lên Signal (MUA)");
        else reasons.push("MACD nằm trên Signal");
    }

    // 3. Volume Score (Max 40)
    if (volPercent > 120) { 
        score += 40; reasons.push(`Volume nổ đột biến (${volPercent.toFixed(0)}%)`); 
    } else if (volPercent > 80) {
        score += 20; reasons.push(`Volume ổn định (${volPercent.toFixed(0)}%)`);
    } else {
        reasons.push("Thanh khoản yếu");
    }

    // Cộng điểm thưởng nếu thỏa mãn chiến lược dòng tiền hoặc dẫn dắt
    if (strategies.some(s => s.type === "MONEY_FLOW")) {
        score += 15;
        reasons.unshift("🚀 Dòng tiền cá mập/tổ chức nổ khối lượng gia nhập");
    }
    if (strategies.some(s => s.type === "LEADER")) {
        score += 15;
        reasons.unshift("👑 Cổ phiếu nằm trong kênh Up-trend dẫn dắt");
    }
    if (strategies.some(s => s.type === "BOTTOM")) {
        score += 10;
        reasons.unshift("🎯 Tín hiệu nảy từ vùng quá bán (Bắt đáy)");
    }
    score = Math.min(100, score);

    // Determine Signal
    let signal = "HOLD";
    let signalText = "GIỮ";
    let signalClass = "bg-signal-hold";

    if (score >= 80) {
        signal = "STRONG_BUY"; signalText = "MUA MẠNH"; signalClass = "bg-signal-buy";
    } else if (score >= 60) {
        signal = "BUY"; signalText = "MUA"; signalClass = "bg-signal-buy";
    } else if (score <= 30) {
        signal = "STRONG_SELL"; signalText = "BÁN MẠNH"; signalClass = "bg-signal-sell";
    } else if (score < 50) {
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
            sma20, sma50, rsi, macd, volPercent
        }
    };
}
