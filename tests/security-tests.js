const fs = require('fs');
const vm = require('vm');
vm.runInThisContext(fs.readFileSync('js/security.js', 'utf8'));

function assert(condition, message) { if (!condition) throw new Error(message); }

const malicious = {
    app: 'vn-stock-advisor', schemaVersion: 4, exportedAt: new Date().toISOString(),
    portfolio: [{ symbol: 'FPT', buyPrice: 100000, volume: 100 }],
    signals: [{ id: 'x', symbol: 'FPT', signal: 'BUY', strategies: ['<img src=x onerror=alert(1)>', 'LEADER'] }],
    paperAccounts: [{ id: 'main', initialCash: 1, cash: 1, positions: { '<img>': {}, FPT: { volume: 100, avgPrice: 100 } } }],
    paperTrades: [{ id: 1, side: 'BUY', symbol: '<img src=x onerror=alert(1)>', volume: 100 }, { id: 2, side: 'BUY', symbol: 'FPT', volume: 100 }],
    backtestRuns: [{ id: 1, strategyFilter: '<script>', symbols: ['FPT', '<IMG>'], summary: { '__proto__': { polluted: true }, note: '<img onerror=alert(1)>' } }]
};
const clean = sanitizeBackup(malicious);
assert(clean.signals[0].strategies.length === 1 && clean.signals[0].strategies[0] === 'LEADER', 'Strategy phải dùng whitelist.');
assert(clean.paperTrades.length === 1 && clean.paperTrades[0].symbol === 'FPT', 'Giao dịch có symbol độc hại phải bị loại.');
assert(Object.keys(clean.paperAccounts[0].positions).length === 1, 'Position key độc hại phải bị loại.');
assert(clean.backtestRuns[0].strategyFilter === 'TREND', 'Strategy backtest không hợp lệ phải có fallback.');
assert(escapeHtmlSafe('<img onerror="x">').includes('&lt;img'), 'HTML phải được escape.');
assert(({}).polluted === undefined, 'Không được prototype pollution.');
console.log('Security tests passed.');
