// --- AI TRỢ LÝ PHÂN TÍCH TIN TỨC & SENTIMENT ---
// Kiến trúc: TA-first AI (dùng chỉ báo kỹ thuật sẵn có) + News nếu lấy được

// 1. Tải tin tức trực tiếp. Không chuyển dữ liệu qua CORS proxy công cộng.
async function fetchStockNews(symbol, size = 5) {
    symbol = symbol.toUpperCase().trim();
    const targetUrl = `https://finfo-api.vndirect.com.vn/v4/news?q=code:${symbol}&size=${size}&sort=newsDate:desc`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch(targetUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) return [];
        const raw = await response.json();
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
    } catch (error) {
        console.info(`Nguồn tin trực tiếp không khả dụng cho ${symbol}:`, error.message);
    } finally {
        clearTimeout(timeoutId);
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
    const { rsi, macd, volPercent, foreignNet } = indicators || {};

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
    const hasNews = newsList.length > 0;
    const newsText = hasNews
        ? newsList.map((n, i) => `${i+1}. [${n.date}] ${n.title}: ${n.summary}`).join("\n")
        : "Không có tin tức thời gian thực. Chỉ diễn giải dữ liệu kỹ thuật đã cung cấp, không được tạo sự kiện doanh nghiệp.";

    const promptText = `Bạn là trợ lý đọc tin tức chứng khoán Việt Nam. Phân tích mã [${symbol}]:

Chỉ báo kỹ thuật: ${taContext}
Tin tức: ${newsText}

Trả về JSON duy nhất, không markdown:
${hasNews
    ? 'Chỉ sử dụng dữ kiện xuất hiện trong phần Tin tức và chỉ báo kỹ thuật. Không tự suy diễn số liệu hay sự kiện.'
    : 'Chỉ diễn giải chỉ báo kỹ thuật. Phải nói rõ hiện không có dữ liệu tin tức và không được suy diễn sự kiện doanh nghiệp.'}
Không khẳng định chắc chắn giá sẽ tăng/giảm. Nêu rõ rủi ro và nếu dữ kiện không đủ thì phải nói rõ.

{"sentimentScore":10,"summary":"Phân tích ngắn gọn 1-2 câu","catalyst":"LOẠI SỰ KIỆN","risk":"Rủi ro quan trọng nhất"}

sentimentScore: số nguyên -20 đến +20`;

    const fallbackWithError = reason => ({ ...ruleBasedNewsAnalysis(symbol, newsList, taResult), aiUnavailableReason: reason });
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: {
                    maxOutputTokens: 1024,
                    temperature: 0.1,
                    responseMimeType: 'application/json'
                }
            })
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            let apiMessage = '';
            try {
                const errorBody = await response.json();
                apiMessage = String(errorBody?.error?.message || '').replace(/\s+/g, ' ').trim().slice(0, 180);
            } catch (_) {}
            if (response.status === 400 && /api key not valid/i.test(apiMessage)) return fallbackWithError('API key Gemini không hợp lệ.');
            if (response.status === 400 && /failed_precondition|free tier|billing/i.test(apiMessage)) return fallbackWithError('Tài khoản Gemini cần bật thanh toán hoặc không hỗ trợ free tier tại khu vực hiện tại.');
            if (response.status === 403) return fallbackWithError('API key không có quyền gọi Gemini hoặc đã bị chặn.');
            if (response.status === 429) return fallbackWithError('Gemini đã hết hạn mức hoặc đang bị giới hạn tần suất.');
            return fallbackWithError(`Gemini lỗi HTTP ${response.status}${apiMessage ? `: ${apiMessage}` : ''}`);
        }

        let data;
        try {
            data = await response.json();
        } catch (_) {
            return fallbackWithError('Gemini đã kết nối nhưng trả về dữ liệu HTTP không đọc được.');
        }
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!rawText.trim()) {
            const blockReason = data.candidates?.[0]?.finishReason;
            return fallbackWithError(`Gemini không trả nội dung${blockReason ? ` (${blockReason})` : ''}.`);
        }
        let parsed;
        try {
            parsed = JSON.parse(rawText.replace(/```json/gi, '').replace(/```/g, '').trim());
        } catch (_) {
            return fallbackWithError('Gemini đã kết nối nhưng nội dung trả về không đúng định dạng JSON.');
        }
            const score = Math.min(20, Math.max(-20, parseInt(parsed.sentimentScore, 10) || 0));
            const sentiment = score >= 3 ? 'POSITIVE' : (score <= -3 ? 'NEGATIVE' : 'NEUTRAL');
            const presentation = sentiment === 'POSITIVE'
                ? { text: score >= 8 ? 'RẤT TÍCH CỰC 🔥' : 'TÍCH CỰC 🟢', css: score >= 8 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-green-500/20 text-green-400 border-green-500/40' }
                : sentiment === 'NEGATIVE'
                    ? { text: score <= -8 ? 'RẤT TIÊU CỰC 🔻' : 'TIÊU CỰC ⚠️', css: score <= -8 ? 'bg-red-500/20 text-red-400 border-red-500/40' : 'bg-amber-500/20 text-amber-400 border-amber-500/40' }
                    : { text: 'TRUNG TÍNH', css: 'bg-gray-500/20 text-gray-300 border-gray-500/40' };
        return {
                sentiment,
                sentimentScore: score,
                sentimentText: presentation.text,
                sentimentClass: presentation.css,
                summary: String(parsed.summary || '').slice(0, 600),
                catalyst: String(parsed.catalyst || 'TIN TỨC DOANH NGHIỆP').slice(0, 120),
                risk: String(parsed.risk || 'Cần kiểm tra lại thông tin từ nguồn công bố chính thức.').slice(0, 400),
                isAIGenerated: true
        };
    } catch (err) {
        console.warn(`Gemini API error:`, err.message);
        const reason = err?.name === 'AbortError'
            ? 'Gemini phản hồi quá chậm và đã hết thời gian chờ.'
            : (window.location.protocol === 'file:'
                ? 'Không thể kết nối Gemini khi ứng dụng đang mở bằng file://. Hãy chạy trang qua http://localhost để trình duyệt xử lý CORS đúng cách.'
                : `Không kết nối được Gemini do CORS hoặc mạng${err?.message ? `: ${String(err.message).slice(0, 120)}` : ''}.`);
        return fallbackWithError(reason);
    }
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
    const geminiKey = sessionStorage.getItem('geminiApiKey') || '';

    let analysis;
    if (geminiKey && geminiKey.trim().length >= 20 && !geminiKey.includes(' ')) {
        analysis = await analyzeNewsWithGemini(symbol, newsList, geminiKey.trim(), taResult);
    } else if (newsList.length > 0) {
        analysis = ruleBasedNewsAnalysis(symbol, newsList, taResult);
    } else {
        // Luôn có phân tích TA ngay cả khi không có tin tức và không có Gemini Key
        analysis = taBasedAnalysis(symbol, taResult);
    }

    const validNewsDates = newsList.map(item => new Date(item.date).getTime()).filter(Number.isFinite);
    const newestAgeDays = validNewsDates.length ? (Date.now() - Math.max(...validNewsDates)) / 86400000 : Infinity;
    const evidenceLevel = newsList.length >= 3 && newestAgeDays <= 7 ? 'CAO' : (newsList.length > 0 && newestAgeDays <= 30 ? 'TRUNG BÌNH' : 'THẤP');
    const result = { newsList, analysis: { ...analysis, evidenceLevel } };
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: result })); } catch (_) {}
    return result;
}
