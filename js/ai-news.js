// --- AI TRỢ LÝ PHÂN TÍCH TIN TỨC & SENTIMENT ---
// Kiến trúc: TA-first AI (dùng chỉ báo kỹ thuật sẵn có) + News nếu lấy được

// 1. Tải tin tức (thử nhiều CORS proxy, nếu fail thì bỏ qua nhẹ nhàng)
async function fetchStockNews(symbol, size = 5) {
    symbol = symbol.toUpperCase().trim();
    const targetUrl = `https://finfo-api.vndirect.com.vn/v4/news?q=code:${symbol}&size=${size}&sort=newsDate:desc`;
    
    const proxyUrls = [
        `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
        `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`
    ];

    for (const proxyUrl of proxyUrls) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) continue;

            const wrapper = await response.json();
            // allorigins trả về { contents: "..." }
            const raw = wrapper.contents ? JSON.parse(wrapper.contents) : wrapper;
            const items = raw?.data || raw;

            if (Array.isArray(items) && items.length > 0) {
                const normalized = items.map(item => ({
                    title: item.title || item.newsTitle || '',
                    date: item.newsDate || item.createdDate || item.date,
                    summary: item.summary || item.newsSummary || '',
                    url: item.newsUrl || item.url || `https://cafef.vn/tim-kiem.chn?keywords=${symbol}`,
                    source: 'VNDirect'
                })).filter(n => n.title);
                const seenTitles = new Set();
                return normalized.filter(news => {
                    const key = news.title.toLowerCase().replace(/\s+/g, ' ').trim();
                    if (seenTitles.has(key)) return false;
                    seenTitles.add(key);
                    return true;
                });
            }
        } catch (e) {
            clearTimeout(timeoutId);
        }
    }
    return []; // trả về rỗng, sẽ dùng TA analysis
}

// 2. Phân tích Sentiment từ Chỉ Báo Kỹ Thuật (TA-based - luôn có dữ liệu)
function taBasedAnalysis(symbol, taResult) {
    if (!taResult) {
        return {
            sentiment: "NEUTRAL", sentimentScore: 0,
            sentimentText: "TRUNG TÍNH", sentimentClass: "bg-gray-500/20 text-gray-300 border-gray-500/40",
            summary: `Chưa có dữ liệu kỹ thuật để phân tích mã ${symbol}.`,
            catalyst: "CHƯA PHÂN TÍCH", confidence: 0, risk: 'Thiếu dữ liệu để đánh giá.'
        };
    }

    const { score, signal, indicators, strategies, reasons } = taResult;
    const { rsi, macd, sma20, sma50, volPercent, foreignNet } = indicators || {};

    // Tính sentiment score từ TA score (0-100 → -20 đến +20)
    const sentimentScore = Math.round((score - 50) * 0.4); // 0→-20, 50→0, 100→+20
    const clampedScore = Math.min(20, Math.max(-20, sentimentScore));

    let sentimentText = "TRUNG TÍNH";
    let sentimentClass = "bg-gray-500/20 text-gray-300 border-gray-500/40";
    let catalyst = "PHÂN TÍCH KỸ THUẬT";

    if (clampedScore >= 12) { sentimentText = "RẤT TÍCH CỰC 🔥"; sentimentClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"; }
    else if (clampedScore >= 5) { sentimentText = "TÍCH CỰC 🟢"; sentimentClass = "bg-green-500/20 text-green-400 border-green-500/40"; }
    else if (clampedScore <= -12) { sentimentText = "RẤT TIÊU CỰC 🔻"; sentimentClass = "bg-red-500/20 text-red-400 border-red-500/40"; }
    else if (clampedScore <= -5) { sentimentText = "TIÊU CỰC ⚠️"; sentimentClass = "bg-amber-500/20 text-amber-400 border-amber-500/40"; }

    // Phát hiện catalyst từ chiến lược phát hiện được
    if (strategies && strategies.length > 0) {
        const s = strategies[0];
        if (s.type === 'MONEY_FLOW') catalyst = "NỔ DÒNG TIỀN / BREAKOUT";
        else if (s.type === 'LEADER') catalyst = "CỔ PHIẾU DẪN DẮT THỊ TRƯỜNG";
        else if (s.type === 'BOTTOM') catalyst = "TÍN HIỆU ĐẢO CHIỀU ĐÁY";
        else if (s.type === 'BB_BREAKOUT') catalyst = "PHÁ VỠ KHÁNG CỰ BOLLINGER";
    }

    // Xây dựng summary thông minh từ indicators
    const summaryParts = [];
    if (rsi) {
        if (rsi < 35) summaryParts.push(`RSI ${rsi.toFixed(1)} – đang ở vùng quá bán (tiềm năng hồi phục)`);
        else if (rsi > 70) summaryParts.push(`RSI ${rsi.toFixed(1)} – đang ở vùng quá mua (thận trọng)`);
        else summaryParts.push(`RSI ${rsi.toFixed(1)} – động lượng ổn định`);
    }
    if (macd) {
        const macdDiff = macd.macd - macd.signal;
        summaryParts.push(macdDiff > 0 ? `MACD dương (+${macdDiff.toFixed(2)}) – xu hướng tăng` : `MACD âm (${macdDiff.toFixed(2)}) – xu hướng yếu`);
    }
    if (volPercent > 0) {
        summaryParts.push(volPercent >= 120 ? `Khối lượng NỔ ${volPercent.toFixed(0)}% TB20 – dòng tiền vào mạnh` : `Khối lượng ${volPercent.toFixed(0)}% TB20`);
    }
    if (foreignNet !== undefined && foreignNet !== 0) {
        summaryParts.push(foreignNet > 0 ? `🌐 Khối ngoại MUA RÒNG ${(foreignNet * 100).toFixed(0)} nghìn CP` : `🌐 Khối ngoại BÁN RÒNG`);
    }
    if (strategies && strategies.length > 0) {
        summaryParts.push(`Tín hiệu chiến lược: ${strategies.map(s => s.label).join(', ')}`);
    }

    const summary = summaryParts.length > 0
        ? summaryParts.join('. ') + '.'
        : reasons?.[0] || `Điểm kỹ thuật ${score}/100 – tín hiệu ${signal}.`;

    return {
        sentiment: clampedScore >= 5 ? "POSITIVE" : (clampedScore <= -5 ? "NEGATIVE" : "NEUTRAL"),
        sentimentScore: clampedScore,
        sentimentText,
        sentimentClass,
        summary,
        catalyst,
        confidence: Math.min(90, Math.max(35, Math.round(50 + Math.abs(clampedScore) * 2))),
        risk: score >= 70 ? 'Giá có thể rung lắc nếu thanh khoản suy yếu hoặc thị trường đảo chiều.' : 'Tín hiệu chưa đủ mạnh; cần chờ xác nhận về giá và thanh khoản.'
    };
}

// 3. NLP Tin tức Tiếng Việt (dùng khi có tin tức thực)
function ruleBasedNewsAnalysis(symbol, newsList, taResult) {
    if (!newsList || newsList.length === 0) return taBasedAnalysis(symbol, taResult);

    const posKeywords = ["lãi", "lợi nhuận", "tăng trưởng", "kỷ lục", "bứt phá", "cổ tức", "ký kết", "hợp đồng", "mở rộng", "mua vào", "nâng hạng", "doanh thu", "vượt kế hoạch"];
    const negKeywords = ["lỗ", "sụt giảm", "giảm mạnh", "bị phạt", "vi phạm", "bán chui", "thanh tra", "đình chỉ", "cảnh báo", "nợ xấu", "thua lỗ", "khởi tố"];

    let score = 0, posCount = 0, negCount = 0;
    let identifiedCatalyst = "TIN TỨC DOANH NGHIỆP";
    const validDates = newsList.map(news => new Date(news.date).getTime()).filter(Number.isFinite);
    const newestNewsAge = validDates.length ? Math.max(0, (Date.now() - Math.max(...validDates)) / 86400000) : Infinity;

    newsList.forEach(news => {
        const text = ((news.title || '') + " " + (news.summary || '')).toLowerCase();
        posKeywords.forEach(kw => { if (text.includes(kw)) { score += 3; posCount++; } });
        negKeywords.forEach(kw => { if (text.includes(kw)) { score -= 5; negCount++; } });
        if (text.includes("cổ tức")) identifiedCatalyst = "CỔ TỨC & QUYỀN LỢI";
        else if (text.includes("lợi nhuận") || text.includes("doanh thu") || text.includes("kết quả kinh doanh")) identifiedCatalyst = "BÁO CÁO TÀI CHÍNH";
        else if (text.includes("hợp đồng") || text.includes("dự án") || text.includes("ký kết")) identifiedCatalyst = "DỰ ÁN & HỢP ĐỒNG";
    });

    score = Math.min(20, Math.max(-20, score));
    let sentiment = "NEUTRAL", sentimentText = "TRUNG TÍNH", sentimentClass = "bg-gray-500/20 text-gray-300 border-gray-500/40";
    if (score >= 8) { sentiment = "POSITIVE"; sentimentText = "RẤT TÍCH CỰC 🔥"; sentimentClass = "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"; }
    else if (score >= 3) { sentiment = "POSITIVE"; sentimentText = "TÍCH CỰC 🟢"; sentimentClass = "bg-green-500/20 text-green-400 border-green-500/40"; }
    else if (score <= -8) { sentiment = "NEGATIVE"; sentimentText = "RẤT TIÊU CỰC 🔻"; sentimentClass = "bg-red-500/20 text-red-400 border-red-500/40"; }
    else if (score <= -3) { sentiment = "NEGATIVE"; sentimentText = "TIÊU CỰC ⚠️"; sentimentClass = "bg-amber-500/20 text-amber-400 border-amber-500/40"; }

    return {
        sentiment, sentimentScore: score, sentimentText, sentimentClass,
        summary: `Phát hiện ${posCount} tín hiệu tích cực, ${negCount} cảnh báo trong ${newsList.length} tin tức mới nhất.`,
        catalyst: identifiedCatalyst,
        confidence: Math.max(20, Math.min(85, 40 + (posCount + negCount) * 8 - (newestNewsAge > 30 ? 20 : 0))),
        risk: newestNewsAge > 30
            ? 'Tin gần nhất đã quá 30 ngày; không nên dùng làm chất xúc tác giao dịch hiện tại.'
            : (negCount > 0 ? `Có ${negCount} cụm thông tin tiêu cực cần kiểm tra lại từ nguồn công bố chính thức.` : 'Chưa phát hiện từ khóa rủi ro rõ ràng; vẫn cần đọc bản tin gốc.')
    };
}

// 3. Phân tích bằng Gemini AI (Key hợp lệ từ Google AI Studio)
async function analyzeNewsWithGemini(symbol, newsList, apiKey, taResult) {
    apiKey = (apiKey || '').trim();
    // Key hợp lệ: tối thiểu 20 ký tự, không có khoảng trắng (AIzaSy... hoặc AQ....)
    if (!apiKey || apiKey.length < 20 || apiKey.includes(' ')) {
        return ruleBasedNewsAnalysis(symbol, newsList, taResult);
    }

    const taContext = taResult ? `Điểm TA: ${taResult.score}/100, Tín hiệu: ${taResult.signal}, RSI: ${taResult.indicators?.rsi?.toFixed(1)}, Chiến lược: ${(taResult.strategies||[]).map(s=>s.label).join('|') || 'Không có'}` : '';
    const newsText = newsList.length > 0
        ? newsList.map((n, i) => `${i+1}. [${n.date}] ${n.title}: ${n.summary}`).join("\n")
        : "(Không có tin tức thời gian thực)";

    const promptText = `Bạn là chuyên gia phân tích chứng khoán Việt Nam. Phân tích mã [${symbol}]:

Chỉ báo kỹ thuật: ${taContext}
Tin tức: ${newsText}

Trả về JSON duy nhất, không markdown:
Chỉ sử dụng dữ kiện xuất hiện trong phần Tin tức. Không tự suy diễn số liệu, không khẳng định chắc chắn giá sẽ tăng/giảm. Nêu rõ rủi ro và mức độ tin cậy.

{"sentimentScore":10,"sentimentText":"TÍCH CỰC 🟢","sentimentClass":"bg-green-500/20 text-green-400 border-green-500/40","summary":"Phân tích ngắn gọn 1-2 câu","catalyst":"LOẠI SỰ KIỆN","risk":"Rủi ro quan trọng nhất","confidence":65}

sentimentScore: số nguyên -20 đến +20`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { maxOutputTokens: 200, temperature: 0.1 }
            })
        });
        clearTimeout(timeoutId);

        if (response.status === 429 || response.status === 400 || response.status === 403) {
            return ruleBasedNewsAnalysis(symbol, newsList, taResult);
        }

        if (response.ok) {
            const data = await response.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const parsed = JSON.parse(rawText.replace(/```json/gi, '').replace(/```/g, '').trim());
            return {
                sentiment: parsed.sentimentScore >= 3 ? "POSITIVE" : (parsed.sentimentScore <= -3 ? "NEGATIVE" : "NEUTRAL"),
                sentimentScore: Math.min(20, Math.max(-20, parseInt(parsed.sentimentScore) || 0)),
                sentimentText: parsed.sentimentText || "TÍCH CỰC",
                sentimentClass: parsed.sentimentClass || "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
                summary: parsed.summary || "",
                catalyst: parsed.catalyst || "PHÂN TÍCH KỸ THUẬT",
                risk: parsed.risk || 'Cần kiểm tra lại thông tin từ nguồn công bố chính thức.',
                confidence: Math.min(95, Math.max(0, parseInt(parsed.confidence) || 50)),
                isAIGenerated: true
            };
        }
    } catch (err) {
        console.warn(`Gemini API error:`, err.message);
    }

    return ruleBasedNewsAnalysis(symbol, newsList, taResult);
}

// 5. Entry point – nhận thêm taResult từ evaluateStock
async function getAINewsAnalysis(symbol, taResult = null) {
    symbol = symbol.toUpperCase().trim();
    const cacheKey = `ai_news_${symbol}_${taResult?.score ?? 'na'}_${taResult?.signal ?? 'na'}`;

    // Session cache 10 phút
    try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            const { timestamp, data } = JSON.parse(cached);
            if (Date.now() - timestamp < 10 * 60 * 1000) return data;
        }
    } catch (_) {}

    const newsList = await fetchStockNews(symbol, 5);
    const geminiKey = localStorage.getItem('geminiApiKey') || '';

    let analysis;
    if (geminiKey && geminiKey.trim().length >= 20 && !geminiKey.includes(' ')) {
        analysis = await analyzeNewsWithGemini(symbol, newsList, geminiKey.trim(), taResult);
    } else if (newsList.length > 0) {
        analysis = ruleBasedNewsAnalysis(symbol, newsList, taResult);
    } else {
        // Luôn có phân tích TA ngay cả khi không có tin tức và không có Gemini Key
        analysis = taBasedAnalysis(symbol, taResult);
    }

    const result = { newsList, analysis };
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: result })); } catch (_) {}
    return result;
}
