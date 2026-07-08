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

// --- THUẬT TOÁN CHẤM ĐIỂM CHUYÊN GIA ---
// Trả về điểm 0-100 và Nhận định (MUA/BÁN/GIỮ)
function evaluateStock(symbol, candles) {
    if (!candles || candles.length < 50) return null;

    const currentPrice = candles[candles.length - 1].close;
    
    // Tính các chỉ báo
    const sma20 = calculateSMA(candles, 20);
    const sma50 = calculateSMA(candles, 50);
    const rsi = calculateRSI(candles, 14);
    const macd = calculateMACD(candles);
    const volPercent = getVolumeTrend(candles, 20);

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
        indicators: {
            sma20, sma50, rsi, macd, volPercent
        }
    };
}
