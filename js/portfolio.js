// --- QUẢN LÝ DANH MỤC (PORTFOLIO) ---

let portfolio = JSON.parse(localStorage.getItem('vnStockPortfolio')) || [];

function savePortfolio() {
    localStorage.setItem('vnStockPortfolio', JSON.stringify(portfolio));
}

function addStockToPortfolio(symbol, buyPrice, volume) {
    symbol = symbol.toUpperCase().trim();
    // Check if exists
    const existing = portfolio.find(p => p.symbol === symbol);
    if (existing) {
        // Average down/up
        const totalCost = (existing.buyPrice * existing.volume) + (buyPrice * volume);
        existing.volume += volume;
        existing.buyPrice = totalCost / existing.volume;
    } else {
        portfolio.push({ symbol, buyPrice, volume });
    }
    savePortfolio();
    renderPortfolio();
}

function removeStockFromPortfolio(symbol) {
    portfolio = portfolio.filter(p => p.symbol !== symbol);
    savePortfolio();
    renderPortfolio();
}

async function renderPortfolio() {
    const listEl = document.getElementById('portfolio-list');
    const totalEl = document.getElementById('portfolio-total');
    const plEl = document.getElementById('portfolio-pl');

    if (portfolio.length === 0) {
        listEl.innerHTML = '<div class="text-center text-gray-500 py-10">Chưa có mã nào trong danh mục</div>';
        totalEl.textContent = '0 ₫';
        plEl.textContent = '0 ₫ (0%)';
        plEl.className = 'font-semibold text-gray-300';
        return;
    }

    listEl.innerHTML = '<div class="text-center text-gray-500 text-xs">Đang cập nhật giá...</div>';

    let totalCurrentValue = 0;
    let totalInvestedValue = 0;

    let html = '';

    for (const item of portfolio) {
        // Fetch current price (using our history fetcher and getting the last close)
        const candles = await fetchStockHistory(item.symbol, 5); // 5 days is enough to get latest
        let currentPrice = item.buyPrice; // fallback
        let latestDate = "";
        
        if (candles && candles.length > 0) {
            currentPrice = candles[candles.length - 1].close * 1000; // VNDirect API is usually /1000
        }

        const currentVal = currentPrice * item.volume;
        const investedVal = item.buyPrice * item.volume;
        
        totalCurrentValue += currentVal;
        totalInvestedValue += investedVal;

        const pl = currentVal - investedVal;
        const plPercent = (pl / investedVal) * 100;
        
        const isUp = pl >= 0;
        const colorClass = isUp ? 'text-brand-up' : 'text-brand-down';

        html += `
            <div class="bg-dark-card border border-dark-border rounded-xl p-4 flex justify-between items-center">
                <div>
                    <h4 class="font-bold text-white text-lg">${item.symbol}</h4>
                    <div class="text-xs text-gray-400 mt-1">SL: ${formatNumber(item.volume)} | Giá vốn: ${formatNumber(item.buyPrice)}</div>
                </div>
                <div class="text-right">
                    <div class="font-semibold text-white">${formatCurrency(currentVal)}</div>
                    <div class="text-sm font-bold ${colorClass}">
                        ${isUp ? '+' : ''}${formatCurrency(pl)} (${isUp ? '+' : ''}${plPercent.toFixed(2)}%)
                    </div>
                </div>
                <button onclick="removeStockFromPortfolio('${item.symbol}')" class="ml-3 text-gray-500 hover:text-red-500">
                    <i class="fas fa-trash"></i> Xóa
                </button>
            </div>
        `;
    }

    listEl.innerHTML = html;

    const totalPL = totalCurrentValue - totalInvestedValue;
    const totalPLPercent = totalInvestedValue > 0 ? (totalPL / totalInvestedValue) * 100 : 0;
    
    totalEl.textContent = formatCurrency(totalCurrentValue);
    
    const isTotalUp = totalPL >= 0;
    plEl.textContent = `${isTotalUp ? '+' : ''}${formatCurrency(totalPL)} (${isTotalUp ? '+' : ''}${totalPLPercent.toFixed(2)}%)`;
    plEl.className = `font-semibold ${isTotalUp ? 'text-brand-up' : 'text-brand-down'}`;
}

// Modal handling
document.getElementById('btn-add-stock').addEventListener('click', () => {
    document.getElementById('modal-portfolio').classList.remove('hidden');
});

document.getElementById('btn-cancel-port').addEventListener('click', () => {
    document.getElementById('modal-portfolio').classList.add('hidden');
});

document.getElementById('btn-save-port').addEventListener('click', () => {
    const symbol = document.getElementById('port-symbol').value;
    const price = parseFloat(document.getElementById('port-price').value);
    const vol = parseFloat(document.getElementById('port-vol').value);

    if (symbol && price > 0 && vol > 0) {
        addStockToPortfolio(symbol, price, vol);
        document.getElementById('modal-portfolio').classList.add('hidden');
        document.getElementById('port-symbol').value = '';
        document.getElementById('port-price').value = '';
        document.getElementById('port-vol').value = '';
    } else {
        alert('Vui lòng nhập đầy đủ thông tin hợp lệ!');
    }
});
