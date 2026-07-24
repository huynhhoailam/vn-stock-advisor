// Danh sách các mã phổ biến / VN100 trên HOSE (Dự phòng/Fallback)
const DEFAULT_HOSE_SYMBOLS = [
    "VCB","FPT","HPG","HDB","CTG","TCB","VPB","MBB","ACB","MWG",
    "VNM","VIC","VHM","VRE","STB","SSI","VND","HCM","VCI","SHB",
    "LPB","TPB","MSB","EIB","OCB","VIB","MSN","PNJ","SAB","GVR",
    "DGC","KDH","REE","GAS","PLX","POW","VJC","BCM","KBC","NLG",
    "NVL","DIG","DXG","PDR","CEO","VCG","KOS","HDG","CII","DGW",
    "VHC","HVN","DPM","DCM","DBC","BSR","NT2","GEG","VPI","SSB",
    "HAH","ANV","IDI","PAN","ASM","VSC","PVT","GMD","VCS","PC1",
    "DPG","GIL","SZC","IDC","TIP","PHR","NTL","SIP","BWE","TDM",
    "VSH","IJC","CTR","TV2","LCG","FCN","HHV","C4G","VIX","AGR",
    "ORS","BSI","CTS","FTS","BAF","HAG","HSG","ITA","SBT","NKG",
    "TLH","PET","FRT","DHA","TCM","SMC","TNH"
];

// Danh sách mã cổ phiếu HOSE sẽ được tự động cập nhật động từ API
let HOSE_SYMBOLS = [...DEFAULT_HOSE_SYMBOLS];

// Hàm lấy tự động danh sách mã trên sàn HOSE (Động 100% từ dchart-api mở CORS)
async function fetchHoseSymbols() {
    try {
        // Gọi API search của dchart-api (Open CORS 100%) theo các chữ cái tiếng Anh
        const letters = ['A','B','C','D','E','F','G','H','I','K','L','M','N','P','Q','R','S','T','V','X','Y'];
        const promises = letters.map(char => 
            fetch(`https://dchart-api.vndirect.com.vn/dchart/search?query=${char}&limit=200`)
                .then(r => r.ok ? r.json() : [])
                .catch(() => [])
        );

        const results = await Promise.all(promises);
        const hoseSet = new Set();

        results.flat().forEach(item => {
            if (item && item.exchange === "HOSE" && item.type === "CỔ PHIẾU" && item.symbol && item.symbol.length === 3) {
                hoseSet.add(item.symbol.toUpperCase());
            }
        });

        if (hoseSet.size > 0) {
            HOSE_SYMBOLS = Array.from(hoseSet);
            console.log(`✅ Đã tải động thành công ${HOSE_SYMBOLS.length} mã cổ phiếu sàn HOSE từ dchart API.`);
            return HOSE_SYMBOLS;
        }
    } catch (error) {
        console.warn("⚠️ Lỗi khi tải danh sách động, dùng danh sách mặc định:", error);
    }

    HOSE_SYMBOLS = [...DEFAULT_HOSE_SYMBOLS];
    return HOSE_SYMBOLS;
}

// Thuật toán lọc Top mã HOSE theo thanh khoản dùng dchart-api (Open CORS 100%)
// Gộp danh sách động + fallback, batch 35 song song -> ~3 đợt là xong
async function getTopLiquidityHoseSymbols(allSymbols, topLimit = 60, updateProgressFn) {
    if (updateProgressFn) updateProgressFn(5, 'Bước 1/2: Đang tính thanh khoản Top HOSE...');

    // Gộp danh sách động từ API + DEFAULT để đảm bảo không bỏ sót mã active
    const candidates = Array.from(new Set([...DEFAULT_HOSE_SYMBOLS, ...allSymbols])).slice(0, 120);
    const liquidityList = [];
    const batchSize = 40; // 40 song song -> chỉ ~3 đợt lặp (~1-1.5s)

    for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        const promises = batch.map(async (symbol) => {
            try {
                // Tải nhẹ 5 ngày để lấy volume & giá gần nhất (payload rất nhỏ)
                const candles = await fetchStockHistory(symbol, 5);
                if (candles && candles.length > 0) {
                    const last = candles[candles.length - 1];
                    const tradingValue = last.volume * last.close; // Giá trị giao dịch tiền thực
                    if (tradingValue > 0) liquidityList.push({ symbol, tradingValue });
                }
            } catch (err) {}
        });
        await Promise.all(promises);

        if (updateProgressFn) {
            const pct = Math.round(((i + batch.length) / candidates.length) * 40);
            updateProgressFn(pct, `Bước 1/2: Lọc thanh khoản... (${Math.min(i + batch.length, candidates.length)}/${candidates.length})`);
        }
    }

    // Sắp xếp giảm dần theo Giá trị giao dịch -> lấy Top mã thanh khoản cao nhất
    liquidityList.sort((a, b) => b.tradingValue - a.tradingValue);
    console.log(`✅ Top ${topLimit} mã thanh khoản:`, liquidityList.slice(0, topLimit).map(i => i.symbol).join(', '));
    return liquidityList.slice(0, topLimit).map(item => item.symbol);
}

// Hàm lấy dữ liệu nến (OHLCV) từ dchart-api của VNDirect
// Dữ liệu mở hoàn toàn CORS, không cần token!
async function fetchStockHistory(symbol, days = 100) {
    // Tính toán thời gian (Unix timestamp)
    const to = Math.floor(Date.now() / 1000);
    const from = to - (days * 24 * 60 * 60);

    const url = `https://dchart-api.vndirect.com.vn/dchart/history?resolution=D&symbol=${symbol}&from=${from}&to=${to}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response was not ok");
        const data = await response.json();
        
        if (data.s !== "ok") {
            return null; // Không có dữ liệu
        }

        // Parse data thành mảng object cho dễ sử dụng
        const candles = [];
        for (let i = 0; i < data.t.length; i++) {
            candles.push({
                time: data.t[i] * 1000, // Đổi sang ms
                open: data.o[i],
                high: data.h[i],
                low: data.l[i],
                close: data.c[i],
                volume: data.v[i]
            });
        }
        return candles;

    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
        return null;
    }
}

// Hàm format tiền tệ
function formatCurrency(value) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

function formatNumber(value) {
    return new Intl.NumberFormat('vi-VN').format(value);
}
