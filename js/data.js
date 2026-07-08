// Danh sách các mã phổ biến / VN100 trên HOSE để quét (giảm tải)
const HOSE_SYMBOLS = [
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
