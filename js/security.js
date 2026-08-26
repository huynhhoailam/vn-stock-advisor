// Helpers bảo mật dùng chung cho dữ liệu nhập từ file/Google Sheets và HTML động.
const BACKUP_MAX_BYTES = 10 * 1024 * 1024;
const BACKUP_MAX_ROWS = 10000;
const SAFE_SYMBOL_PATTERN = /^[A-Z0-9]{2,10}$/;
const SAFE_SIGNALS = new Set(['BUY', 'STRONG_BUY', 'HOLD', 'SELL', 'STRONG_SELL']);
const SAFE_STRATEGIES = new Set(['BOTTOM', 'MONEY_FLOW', 'LEADER', 'BB_BREAKOUT']);

function escapeHtmlSafe(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function finiteNumber(value, fallback = 0, min = -1e15, max = 1e15) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function safeIsoDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function safePlainData(value, depth = 0) {
    if (depth > 8 || value == null) return value == null ? null : undefined;
    if (typeof value === 'string') return value.slice(0, 2000);
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, BACKUP_MAX_ROWS).map(item => safePlainData(item, depth + 1)).filter(item => item !== undefined);
    if (typeof value !== 'object') return undefined;
    const output = {};
    Object.entries(value).slice(0, 500).forEach(([key, item]) => {
        if (['__proto__', 'prototype', 'constructor'].includes(key) || !/^[A-Za-z0-9_.:-]{1,64}$/.test(key)) return;
        const clean = safePlainData(item, depth + 1);
        if (clean !== undefined) output[key] = clean;
    });
    return output;
}

function sanitizePortfolioRows(rows) {
    if (!Array.isArray(rows) || rows.length > BACKUP_MAX_ROWS) throw new Error('Danh mục trong backup không hợp lệ hoặc quá lớn.');
    return rows.map(item => ({
        symbol: String(item?.symbol || '').toUpperCase().trim(),
        buyPrice: finiteNumber(item?.buyPrice, 0, 0.001),
        volume: finiteNumber(item?.volume, 0, 1),
        stopLoss: finiteNumber(item?.stopLoss, 0, 0) || null,
        initialStopLoss: finiteNumber(item?.initialStopLoss, 0, 0) || null,
        target: finiteNumber(item?.target, 0, 0) || null
    })).filter(item => SAFE_SYMBOL_PATTERN.test(item.symbol) && item.buyPrice > 0 && item.volume > 0);
}

function sanitizeSignals(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, BACKUP_MAX_ROWS).map(row => {
        const symbol = String(row?.symbol || '').toUpperCase().trim();
        if (!SAFE_SYMBOL_PATTERN.test(symbol)) return null;
        const strategies = Array.isArray(row.strategies) ? row.strategies.filter(value => SAFE_STRATEGIES.has(value)).slice(0, 10) : [];
        return {
            id: String(row.id || `${safeIsoDate(row.createdAt).slice(0, 10)}:${symbol}`).slice(0, 100),
            createdAt: safeIsoDate(row.createdAt), sessionDate: String(row.sessionDate || '').slice(0, 10), symbol,
            price: finiteNumber(row.price, 0, 0), score: finiteNumber(row.score, 0, 0, 100),
            signal: SAFE_SIGNALS.has(row.signal) ? row.signal : 'HOLD', strategies,
            tradePlan: safePlainData(row.tradePlan), marketRegime: ['BULL', 'BEAR', 'NEUTRAL'].includes(row.marketRegime) ? row.marketRegime : 'NEUTRAL',
            outcomes: safePlainData(row.outcomes), lastOutcomeCheck: row.lastOutcomeCheck ? safeIsoDate(row.lastOutcomeCheck) : undefined
        };
    }).filter(Boolean);
}

function sanitizePaperAccounts(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 10).map(row => {
        const positions = {};
        Object.entries(row?.positions || {}).slice(0, 500).forEach(([key, value]) => {
            const symbol = String(key).toUpperCase().trim();
            if (!SAFE_SYMBOL_PATTERN.test(symbol)) return;
            positions[symbol] = { symbol, volume: finiteNumber(value?.volume, 0, 0), avgPrice: finiteNumber(value?.avgPrice, 0, 0), stopLoss: finiteNumber(value?.stopLoss, 0, 0) || null, target: finiteNumber(value?.target, 0, 0) || null };
        });
        return { id: String(row?.id || 'main').slice(0, 50), initialCash: finiteNumber(row?.initialCash, 0, 0), cash: finiteNumber(row?.cash, 0), realizedPL: finiteNumber(row?.realizedPL), positions, updatedAt: safeIsoDate(row?.updatedAt) };
    });
}

function sanitizePaperTrades(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, BACKUP_MAX_ROWS).map(row => {
        const symbol = String(row?.symbol || '').toUpperCase().trim();
        if (!SAFE_SYMBOL_PATTERN.test(symbol) || !['BUY', 'SELL'].includes(row?.side)) return null;
        const clean = { createdAt: safeIsoDate(row.createdAt), side: row.side, symbol };
        ['volume', 'referencePrice', 'executionPrice', 'gross', 'fee', 'tax', 'realizedPL', 'remainingVolume'].forEach(key => { clean[key] = finiteNumber(row[key]); });
        if (Number.isInteger(Number(row.id)) && Number(row.id) > 0) clean.id = Number(row.id);
        return clean;
    }).filter(Boolean);
}

function sanitizeBacktestRuns(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 1000).map(row => ({
        ...(Number.isInteger(Number(row?.id)) && Number(row.id) > 0 ? { id: Number(row.id) } : {}),
        createdAt: safeIsoDate(row?.createdAt), days: finiteNumber(row?.days, 0, 0, 10000),
        strategyFilter: ['ALL', 'TREND', 'BREAKOUT', 'BOTTOM'].includes(row?.strategyFilter) ? row.strategyFilter : 'TREND',
        symbols: Array.isArray(row?.symbols) ? row.symbols.map(value => String(value).toUpperCase()).filter(value => SAFE_SYMBOL_PATTERN.test(value)).slice(0, 100) : [],
        summary: safePlainData(row?.summary), result: safePlainData(row?.result)
    }));
}

function sanitizeBackup(backup) {
    if (!backup || backup.app !== 'vn-stock-advisor') throw new Error('Backup không đúng định dạng ứng dụng.');
    const portfolio = sanitizePortfolioRows(backup.portfolio);
    if (portfolio.length !== backup.portfolio.length) throw new Error('Backup chứa mã, giá hoặc số lượng danh mục không hợp lệ.');
    return {
        app: 'vn-stock-advisor', schemaVersion: Math.min(4, Math.max(1, finiteNumber(backup.schemaVersion, 1, 1, 100))),
        exportedAt: safeIsoDate(backup.exportedAt), portfolio,
        signals: sanitizeSignals(backup.signals), paperAccounts: sanitizePaperAccounts(backup.paperAccounts),
        paperTrades: sanitizePaperTrades(backup.paperTrades), backtestRuns: sanitizeBacktestRuns(backup.backtestRuns)
    };
}

