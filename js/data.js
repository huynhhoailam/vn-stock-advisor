// Danh sách toàn bộ các mã cổ phiếu đang giao dịch trên sàn HOSE
const ALL_HOSE_SYMBOLS = [
    "AAA","AAM","AAN","AAT","ABS","ACB","ACC","ACG","ACL","ADG","ADP","ADS","AFX","AGG","ANT","ANV","APH","ASP","AST",
    "BCM","BIC","BID","BKG","BMP","BSI","BTT","BVB","CCL","CTG","CII","C4G","CEO","CTR","CTS","DBC","DBD","DC4","DGC",
    "DGW","DHA","DHG","DHM","DMC","DPM","DQC","DTT","DVP","DXG","DXS","DXV","EIB","ELC","EVE","EVF","EVG","FCM","FCN",
    "FDC","FIR","FIT","FMC","FPT","FRT","FTS","GAS","GDT","GEE","GEG","GEL","GEX","GHC","GIL","GMD","GMH","GSP","GTA",
    "GVR","HAH","HAS","HAG","HCD","HCM","HDB","HDG","HHP","HII","HPA","HPG","HPX","HSG","HVN","ICT","IDI","IJC","ILB",
    "IMP","ITA","ITC","ITD","KBC","KDC","KDH","KHG","KHP","KLB","KMR","KOS","KSB","L10","LAF","LBM","LCG","LDG","LGC",
    "LGL","LHG","LIX","LM8","LPB","LSS","MBB","MCM","MCP","MDG","MHC","MSB","MSN","MWG","MZG","NAB","NAF","NAV","NBB",
    "NCT","NHA","NKG","NLG","NNC","NO1","NSC","NT2","NVL","OCB","ORS","PAN","PC1","PDG","PDR","PET","PGD","PGV","PHR",
    "PLX","PNJ","POW","PPC","PTB","PVT","QCG","QNP","RAL","REE","RYG","S4A","SAB","SAV","SBV","SC5","SCR","SCS","SGR",
    "SHB","SIP","SKG","SMC","SRF","SSB","SSC","SSI","STB","STK","SVD","SZC","SZL","TBC","TCB","TCL","TCO","TCT","TDC",
    "TDG","TDH","THG","TIP","TIX","TMT","TNH","TPB","TRA","TSA","TVS","TYA","VCB","VCA","VCG","VCI","VCS","VHC","VHM",
    "VIB","VIC","VIX","VJC","VND","VNG","VNL","VNM","VPB","VPI","VRE","VSC","VSH","VTB","YBM","YEG"
];

// ============================================================
// Lọc Top Thanh Khoản HOSE siêu tốc dùng VPS bgapidatafeed (CORS: *)
// API: /getliststockdata/{sym1,sym2,...} → trả lot + avePrice + foreignNet
// ============================================================
async function getTopLiquidityHoseSymbols(topLimit = 60, updateProgressFn) {
    const VPS_API = 'https://bgapidatafeed.vps.com.vn/getliststockdata/';

    if (updateProgressFn) updateProgressFn(5, 'Bước 1/2: Đang tải bảng giá VPS cho toàn bộ sàn HOSE...');

    const candidates = ALL_HOSE_SYMBOLS;
    const liquidityList = [];
    const vpsMap = {};

    if (updateProgressFn) updateProgressFn(15, `Bước 1/2: Đang lọc thanh khoản realtime ${candidates.length} mã qua VPS...`);

    // VPS chấp nhận ~60 mã/call → chia thành các batch gửi song song
    const batchSize = 60;
    const batches = [];
    for (let i = 0; i < candidates.length; i += batchSize) {
        batches.push(candidates.slice(i, i + batchSize));
    }

    try {
        const batchResults = await Promise.all(batches.map(async (batch, idx) => {
            const url = VPS_API + batch.join(',');
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`VPS batch ${idx} error ${res.status}`);
                return await res.json();
            } catch (e) {
                console.warn(`⚠️ VPS batch ${idx} failed:`, e.message);
                return [];
            }
        }));

        // Gộp tất cả kết quả, tính giá trị giao dịch & lưu metadata realtime
        batchResults.flat().forEach(item => {
            const lot = parseFloat(item.lot) || 0;
            const price = parseFloat(item.avePrice) || parseFloat(item.lastPrice) || 0;
            const changePc = parseFloat(item.changePc) || 0;
            const fBuy = parseFloat(item.fBVol) || 0;
            const fSell = parseFloat(item.fSVolume) || 0;
            const foreignNet = fBuy - fSell; // Khối ngoại mua/bán ròng
            const sym = (item.sym || '').toUpperCase();

            if (sym && price > 0) {
                const tradingValue = lot * price * 1000;
                vpsMap[sym] = { symbol: sym, lot, price, changePc, foreignNet, tradingValue };
                if (lot > 0) {
                    liquidityList.push({ symbol: sym, tradingValue, lot, changePc });
                }
            }
        });

        if (liquidityList.length > 0) {
            liquidityList.sort((a, b) => b.tradingValue - a.tradingValue);
            const topSymbols = liquidityList.slice(0, topLimit).map(i => i.symbol);
            console.log(`✅ VPS API: Top ${topLimit} mã thanh khoản HOSE từ ${candidates.length} mã động → ${topSymbols.join(', ')}`);
            if (updateProgressFn) updateProgressFn(40, `Bước 1/2: Hoàn tất! Lọc Top ${topSymbols.length} mã thanh khoản.`);
            return { topSymbols, vpsMap };
        }
    } catch (e) {
        console.warn('⚠️ VPS API thất bại, dùng dchart fallback:', e);
    }

    // ── Fallback: dchart-api từng batch 40 song song ──
    if (updateProgressFn) updateProgressFn(10, 'Bước 1/2: Dùng dchart dự phòng...');
    const fallbackBatchSize = 40;
    for (let i = 0; i < candidates.length; i += fallbackBatchSize) {
        const batch = candidates.slice(i, i + fallbackBatchSize);
        await Promise.all(batch.map(async (symbol) => {
            try {
                const candles = await fetchStockHistory(symbol, 5);
                if (candles && candles.length > 0) {
                    const last = candles[candles.length - 1];
                    const tv = last.volume * last.close;
                    if (tv > 0) liquidityList.push({ symbol, tradingValue: tv });
                }
            } catch (err) {}
        }));
        if (updateProgressFn) {
            const pct = Math.round(((i + fallbackBatchSize) / candidates.length) * 40);
            updateProgressFn(pct, `Bước 1/2: Fallback dchart... (${Math.min(i + fallbackBatchSize, candidates.length)}/${candidates.length})`);
        }
    }
    liquidityList.sort((a, b) => b.tradingValue - a.tradingValue);
    const topSymbols = liquidityList.slice(0, topLimit).map(item => item.symbol);
    return { topSymbols, vpsMap: {} };
}

// Hàm lấy dữ liệu nến (OHLCV) từ dchart-api của VNDirect
// Dữ liệu mở hoàn toàn CORS, không cần token!
async function fetchStockHistory(symbol, tradingDays = 100) {
    // Nhân 1.5× để bù ngày nghỉ/cuối tuần (thực tế ~2/3 ngày lịch là phiên giao dịch)
    const calendarDays = Math.ceil(tradingDays * 1.5);
    const to = Math.floor(Date.now() / 1000);
    const from = to - (calendarDays * 24 * 60 * 60);

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

